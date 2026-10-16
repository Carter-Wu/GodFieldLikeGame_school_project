// End-of-round recap: replays what each fighter did in the round that just
// resolved, one play at a time -- each card appears on its side's arena
// slot, then an effect per card type runs (a projectile + hit for attacks, a
// shield ring for defends, rising sparks for buffs, a curse for debuffs, a
// class-specific cut-in and effect for ultimates, see ultimateFx.ts) -- with
// synthesized sound effects (src/fx/sound.ts).
//
// Driven entirely by each fighter's `lastTurn` (see TurnRecord in
// engine.ts), so it works the same for vs-CPU and online battles. Steps
// play in the engine's own resolution order: both sides' defend / buff /
// debuff / monster cards first (yours, then theirs, each in pick order),
// then every attack and ultimate in strike order, then monsters, then
// statuses.
//
// It plays at the viewer's chosen speed (setRecapSpeed, the battle screen's
// speed button); clicking anywhere during the recap fast-forwards it.

import Phaser from "phaser";
import { CARD_ICON_KEY } from "../phaserIcons.ts";
import { playSfx } from "../fx/sound.ts";
import { MODIFIER_MODE } from "../model/effects.ts";
import { STATUS_LABEL, type PlayRecord, type TurnRecord } from "../model/engine.ts";
import { COLORS, TEXT, FONT_FAMILY, GAME_WIDTH } from "./theme.ts";
import { actionFace, drawCardFace } from "./cardFace.ts";
import { burstParticles, fmt, hex, projectile, tween, wait, type PanelRect, type RecapRun } from "./recapUtil.ts";
import { playUltimate } from "./ultimateFx.ts";

const CARD_W = 124; // caption offset from the slot's center
const SKIP_SPEED = 6;

const EFFECT_COLOR = {
  hit: 0xff5a4f,
  block: 0x8fd3ff,
  defend: 0x6ec6ff,
  buff: 0x6be39a,
  debuff: 0xb98cff,
  ap: 0x4a95e0,
  monster: 0xd9a441,
};

export interface RecapPanel extends PanelRect {
  container: Phaser.GameObjects.Container;
  setHp: (hp: number) => void;
}

export interface RecapSide {
  turn: TurnRecord; // the fighter's lastTurn
  who: string; // "You" / "CPU" / "Opponent"
  classId: string;
  className: string;
  ultimateName: string;
  hp: number; // HP shown before this round (counted down as hits land)
  panel: () => RecapPanel;
  fieldCenter: () => { x: number; y: number }; // middle of this side's monster field
  slot: RecapSlot; // where this side's cards appear
}

// A side's arena slot, and the size its card faces are drawn at.
export interface RecapSlot {
  x: number;
  y: number;
  w: number;
  h: number;
  faceW: number;
  faceH: number;
}

export interface RoundRecap {
  round: number;
  stage: { y: number; h: number }; // screen band the recap covers
  sides: { player: RecapSide; cpu: RecapSide };
  speed?: number; // playback speed, 1 = normal
}

export interface RoundRecapRun extends RecapRun {
  recap: RoundRecap;
  skipping: boolean;
}

// Scenes that can host a recap: BattleScene (and its OnlineBattleScene
// subclass) stash the active run on themselves for speed/skip control.
export type RecapCapableScene = Phaser.Scene & { recapRun: RoundRecapRun | null };

type Key = "player" | "cpu";

export async function playRoundRecap(scene: RecapCapableScene, recap: RoundRecap): Promise<void> {
  const layer = scene.add.container(0, 0);
  const run: RoundRecapRun = { scene, recap, layer, skipping: false };
  scene.recapRun = run;
  applySpeed(scene, recap.speed ?? 1);

  const { y: stageY, h: stageH } = recap.stage;
  const overlay = scene.add.rectangle(0, stageY, GAME_WIDTH, stageH, COLORS.background, 0.86).setOrigin(0, 0);
  overlay.setInteractive();
  overlay.on("pointerdown", () => skip(run));
  const hint = scene.add
    .text(944, stageY + stageH - 8, "click to skip", { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
    .setOrigin(1, 1);
  layer.add([overlay, hint]);
  overlay.setAlpha(0);
  await tween(run, { targets: overlay, alpha: 1, duration: 150 });

  await roundBanner(run);

  // Same order the engine resolved things in.
  const keys: Key[] = ["player", "cpu"];
  for (const key of keys) {
    const plays = recap.sides[key].turn.plays ?? [];
    if (plays.length === 0) await passStep(run, key);
    for (const play of plays) if (!dealsDamage(play)) await playStep(run, key, play);
  }
  const strikes = keys
    .flatMap((key) => (recap.sides[key].turn.plays ?? []).filter(dealsDamage).map((play) => ({ key, play })))
    .sort((a, b) => (a.play.order ?? 99) - (b.play.order ?? 99));
  if (strikes.length > 0 && recap.sides.player.turn.dice !== null && recap.sides.cpu.turn.dice !== null) await diceBanner(run);
  for (const { key, play } of strikes) await playStep(run, key, play);
  await playMonsterHits(run);
  await playStatusTicks(run);

  await tween(run, { targets: layer, alpha: 0, duration: 200 });
  layer.destroy(true);
  scene.recapRun = null;
  applySpeed(scene, 1);
}

// Change the speed of a recap that's playing (no-op if none is, or if it's
// already being fast-forwarded).
export function setRecapSpeed(scene: RecapCapableScene, speed: number): void {
  const run = scene.recapRun;
  if (run && !run.skipping) applySpeed(scene, speed);
}

function applySpeed(scene: Phaser.Scene, speed: number): void {
  scene.tweens.timeScale = speed;
  scene.time.timeScale = speed;
}

function dealsDamage(play: PlayRecord): boolean {
  return play.kind === "ultimate" || play.category === "attack";
}

function skip(run: RoundRecapRun): void {
  if (run.skipping) return;
  run.skipping = true;
  applySpeed(run.scene, Math.max(SKIP_SPEED, run.scene.tweens.timeScale));
}

// --- banners -------------------------------------------------------------------

async function roundBanner(run: RoundRecapRun): Promise<void> {
  const { scene, recap, layer } = run;
  const cy = recap.stage.y + recap.stage.h / 2;
  const text = scene.add
    .text(GAME_WIDTH / 2, cy, `Round ${recap.round}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "40px",
      fontStyle: "800",
      color: TEXT.white,
      stroke: "#000000",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setScale(0.6)
    .setAlpha(0);
  layer.add(text);
  await tween(run, { targets: text, scale: 1, alpha: 1, duration: 220, ease: "Back.easeOut" });
  await wait(run, 350);
  await tween(run, { targets: text, alpha: 0, y: cy - 20, duration: 180 });
  text.destroy();
}

// The dice that settled a priority tie between the two sides.
async function diceBanner(run: RoundRecapRun): Promise<void> {
  const { scene, recap, layer } = run;
  const { player, cpu } = recap.sides;
  const winner = (player.turn.dice ?? 0) > (cpu.turn.dice ?? 0) ? player : cpu;
  const cy = recap.stage.y + recap.stage.h / 2;
  const text = scene.add
    .text(
      GAME_WIDTH / 2,
      cy,
      `Dice: ${player.who} ${player.turn.dice} · ${cpu.who} ${cpu.turn.dice}\n${winner.who} win${winner.who === "You" ? "" : "s"} the ties!`,
      {
        fontFamily: FONT_FAMILY,
        fontSize: "28px",
        fontStyle: "800",
        color: TEXT.white,
        align: "center",
        stroke: "#000000",
        strokeThickness: 6,
      }
    )
    .setOrigin(0.5)
    .setAlpha(0);
  layer.add(text);
  playSfx("card");
  await tween(run, { targets: text, alpha: 1, duration: 180 });
  await wait(run, 650);
  await tween(run, { targets: text, alpha: 0, duration: 180 });
  text.destroy();
}

// --- one play ----------------------------------------------------------------

function captionFor(run: RoundRecapRun, side: RecapSide, title: string): {
  caption: Phaser.GameObjects.Container;
  resultText: Phaser.GameObjects.Text;
} {
  const { scene, recap, layer } = run;
  const scx = side.slot.x + side.slot.w / 2;
  const cy = recap.stage.y + recap.stage.h / 2 + 4;
  const leftSide = scx < GAME_WIDTH / 2;
  // Beside the slot, toward the middle of the screen.
  const caption = scene.add.container(leftSide ? scx + CARD_W / 2 + 24 : scx - CARD_W / 2 - 24, cy - 44).setAlpha(0);
  const align = leftSide ? 0 : 1;
  const whoText = scene.add.text(0, 0, side.who, { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted }).setOrigin(align, 0);
  const titleText = scene.add
    .text(0, 20, title, { fontFamily: FONT_FAMILY, fontSize: "26px", fontStyle: "800", color: TEXT.white })
    .setOrigin(align, 0);
  const resultText = scene.add
    .text(0, 56, "", { fontFamily: FONT_FAMILY, fontSize: "18px", fontStyle: "700", color: TEXT.white })
    .setOrigin(align, 0);
  caption.add([whoText, titleText, resultText]);
  layer.add(caption);
  return { caption, resultText };
}

// A side that played nothing this round.
async function passStep(run: RoundRecapRun, key: Key): Promise<void> {
  const side = run.recap.sides[key];
  const { caption, resultText } = captionFor(run, side, "Pass");
  resultText.setText("No cards played").setColor(hex(0xa9adc1));
  await tween(run, { targets: caption, alpha: 1, duration: 200 });
  await wait(run, 450);
  await tween(run, { targets: caption, alpha: 0, duration: 150 });
  caption.destroy(true);
}

async function playStep(run: RoundRecapRun, key: Key, play: PlayRecord): Promise<void> {
  const { scene, recap, layer } = run;
  const side = recap.sides[key];
  const target = recap.sides[key === "player" ? "cpu" : "player"];
  const { slot } = side;
  const scx = slot.x + slot.w / 2;
  const scy = slot.y + slot.h / 2;

  const { caption, resultText } = captionFor(run, side, play.kind === "ultimate" ? side.ultimateName : (play.name ?? ""));

  // The card appears on its slot, rises for its moment, then fades.
  const face = drawCardFace(scene, actionFace(play, side.ultimateName), slot.faceW, slot.faceH).container;
  face.setPosition(slot.x + (slot.w - slot.faceW) / 2, slot.y + (slot.h - slot.faceH) / 2).setAlpha(0);
  layer.add(face);
  await tween(run, { targets: face, alpha: 1, duration: 120 });
  await tween(run, { targets: face, y: "-=14", duration: 140, yoyo: true, ease: "Sine.easeOut" });
  playSfx("card");

  await tween(run, { targets: caption, alpha: 1, duration: 200 });

  const result = await playEffect(run, side, target, play, { x: scx, y: scy });
  if (result) {
    resultText.setText(result.text).setColor(hex(result.color));
    resultText.setScale(1.3);
    scene.tweens.add({ targets: resultText, scale: 1, duration: 200, ease: "Back.easeOut" });
  }

  await wait(run, 500);
  await tween(run, { targets: [face, caption], alpha: 0, duration: 180 });
  face.destroy(true);
  caption.destroy(true);
}

interface EffectResult {
  text: string;
  color: number;
}

// Runs the effect for one action; returns the caption's result line.
async function playEffect(
  run: RoundRecapRun,
  side: RecapSide,
  target: RecapSide,
  action: PlayRecord,
  from: { x: number; y: number }
): Promise<EffectResult | null> {
  if (action.cancelled) {
    playSfx("block");
    return { text: action.cancelled === "interrupted" ? "Interrupted!" : "Too late -- knocked out", color: 0xa9adc1 };
  }

  if (action.kind === "ultimate") {
    await playUltimate(run, side, target, from);
    const result = hit(run, target, action, { quiet: true });
    return withExtras(run, side, action, result);
  }

  switch (action.category) {
    case "attack": {
      const fieldHits = action.fieldHits ?? [];
      if (fieldHits.length > 0) {
        await projectile(run, from, fieldRect(target), accentFor(action), 12);
        await monsterDamage(run, target.fieldCenter(), fieldHits);
        const killed = fieldHits.filter((h) => h.killed).length;
        return { text: `Hit ${fieldHits.map((h) => h.target).join(", ")}${killed ? ` (${killed} destroyed)` : ""}`, color: EFFECT_COLOR.hit };
      }
      await projectile(run, from, target.panel(), accentFor(action), 12);
      return withExtras(run, side, action, hit(run, target, action));
    }
    case "defend":
      playSfx("shield");
      await shieldRing(run, side.panel(), action);
      return { text: `Guard ${guardText(action.guard)} ${action.damageType}`, color: EFFECT_COLOR.defend };
    case "buff":
      playSfx("buff");
      await sparkle(run, side.panel(), EFFECT_COLOR.buff, "up");
      return withExtras(run, side, action, { text: "Powered up!", color: EFFECT_COLOR.buff });
    case "debuff":
      await projectile(run, from, target.panel(), EFFECT_COLOR.debuff, 10);
      playSfx("debuff");
      await sparkle(run, target.panel(), EFFECT_COLOR.debuff, "down");
      return withExtras(run, side, action, { text: `${target.who} weakened`, color: EFFECT_COLOR.debuff });
    case "monster": {
      playSfx("buff");
      const center = side.fieldCenter();
      burstParticles(run, center.x, center.y, { colors: [EFFECT_COLOR.monster, 0xffffff], count: 16, maxDist: 100 });
      await iconPop(run, CARD_ICON_KEY.monster, center.x, center.y, EFFECT_COLOR.monster);
      return { text: (action.summoned ?? []).length > 0 ? "Summoned!" : "The field is full", color: EFFECT_COLOR.monster };
    }
    default:
      return null;
  }
}

// The field as a panel-shaped rect, for projectiles aimed at it.
function fieldRect(side: RecapSide): PanelRect {
  const { x, y } = side.fieldCenter();
  return { x: x - 10, y: y - 10, w: 20, h: 20 };
}

// Add what else an action did to its caption -- heals (and the HP bar going
// up), AP gained, summons, statuses put on the target.
function withExtras(run: RoundRecapRun, side: RecapSide, action: PlayRecord, result: EffectResult): EffectResult {
  const extras: string[] = [];
  if ((action.healed ?? 0) > 0) {
    extras.push(`+${fmt(action.healed)} HP`);
    side.hp += action.healed;
    side.panel().setHp(side.hp);
    floatText(run, side.panel(), `+${fmt(action.healed)}`, EFFECT_COLOR.buff, 30);
  }
  if ((action.apGained ?? 0) > 0) extras.push(`+${fmt(action.apGained)} AP`);
  const summoned = action.summoned ?? [];
  if (summoned.length > 0) extras.push(`${summoned.join(", ")} rise${summoned.length === 1 ? "s" : ""}`);
  const statuses = action.statusesApplied ?? [];
  if (statuses.length > 0) extras.push(statuses.map((s) => STATUS_LABEL[s] ?? s).join(", "));
  if (extras.length === 0) return result;
  const text = result.text === "Powered up!" || result.text.endsWith("weakened") ? extras.join(" · ") : `${result.text} ${extras.join(" · ")}`;
  return { text, color: result.color };
}

// Small damage numbers over a monster field.
async function monsterDamage(run: RoundRecapRun, at: { x: number; y: number }, hits: Array<{ damage: number; killed: boolean }>): Promise<void> {
  playSfx("hit");
  hits.forEach((h, i) => {
    const x = at.x + (i - (hits.length - 1) / 2) * 60;
    burstParticles(run, x, at.y, { colors: [EFFECT_COLOR.hit], count: 8, maxDist: 50 });
    floatText(run, { x: x - 30, y: at.y - 30, w: 60, h: 60 }, h.killed ? `-${fmt(h.damage)} KO` : `-${fmt(h.damage)}`, EFFECT_COLOR.hit, 26);
  });
  await wait(run, 350);
}

// A number that pops over a rect and floats up.
function floatText(run: RoundRecapRun, rect: PanelRect, text: string, color: number, size: number): void {
  const { scene, layer } = run;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const label = scene.add
    .text(cx, cy, text, {
      fontFamily: FONT_FAMILY,
      fontSize: `${size}px`,
      fontStyle: "800",
      color: hex(color),
      stroke: "#000000",
      strokeThickness: 5,
    })
    .setOrigin(0.5)
    .setScale(0.5);
  layer.add(label);
  scene.tweens.add({ targets: label, scale: 1, duration: 160, ease: "Back.easeOut" });
  scene.tweens.add({ targets: label, y: cy - 40, alpha: 0, delay: 550, duration: 450, onComplete: () => label.destroy() });
}

// --- after the cards: monsters, then statuses ---------------------------------

async function playMonsterHits(run: RoundRecapRun): Promise<void> {
  const { recap } = run;
  const hits = (["player", "cpu"] as const)
    .flatMap((key) => (recap.sides[key].turn.monsterHits ?? []).map((h) => ({ key, h })))
    .sort((a, b) => a.h.order - b.h.order);
  if (hits.length === 0) return;
  await phaseBanner(run, "Monsters act");
  for (const { key, h } of hits) {
    const side = recap.sides[key];
    const target = recap.sides[key === "player" ? "cpu" : "player"];
    const from = side.fieldCenter();
    // Name the move over the attacker's field: "Flame Imp: Fire Breath".
    floatText(run, { x: from.x - 60, y: from.y - 90, w: 120, h: 30 }, `${h.attacker}: ${h.ability ?? "Attack"}`, EFFECT_COLOR.monster, 16);
    if (h.target === "self") {
      playSfx("buff");
      await sparkle(run, side.panel(), EFFECT_COLOR.buff, "up");
      if (h.effects) floatText(run, side.panel(), h.effects, EFFECT_COLOR.buff, 22);
      await wait(run, 250);
      continue;
    }
    if (h.target === "fighter") {
      await projectile(run, from, target.panel(), EFFECT_COLOR.monster, 9, { duration: 300 });
      hit(run, target, { damage: h.damage, guarded: h.guarded, resisted: h.resisted, damageType: h.damageType });
    } else {
      await projectile(run, from, fieldRect(target), EFFECT_COLOR.monster, 9, { duration: 300 });
      await monsterDamage(run, target.fieldCenter(), [h]);
    }
    await wait(run, 250);
  }
}

async function playStatusTicks(run: RoundRecapRun): Promise<void> {
  const { recap } = run;
  const sides = (["player", "cpu"] as const).filter((key) => (recap.sides[key].turn.statusTicks ?? []).some((t) => t.damage > 0));
  if (sides.length === 0) return;
  for (const key of sides) {
    const side = recap.sides[key];
    for (const tick of side.turn.statusTicks ?? []) {
      if (tick.damage <= 0) continue;
      const color = tick.status === "burning" ? 0xff7a1a : 0x7fcf4f;
      playSfx("debuff");
      const panel = side.panel();
      burstParticles(run, panel.x + panel.w / 2, panel.y + panel.h / 2, { colors: [color], count: 10 });
      floatText(run, panel, `${STATUS_LABEL[tick.status] ?? tick.status} -${fmt(tick.damage)}`, color, 30);
      side.hp = Math.max(0, side.hp - tick.damage);
      panel.setHp(side.hp);
      await wait(run, 600);
    }
  }
}

async function phaseBanner(run: RoundRecapRun, label: string): Promise<void> {
  const { scene, recap, layer } = run;
  const cy = recap.stage.y + recap.stage.h / 2;
  const text = scene.add
    .text(GAME_WIDTH / 2, cy, label, { fontFamily: FONT_FAMILY, fontSize: "30px", fontStyle: "800", color: TEXT.white, stroke: "#000000", strokeThickness: 6 })
    .setOrigin(0.5)
    .setAlpha(0);
  layer.add(text);
  await tween(run, { targets: text, alpha: 1, duration: 150 });
  await wait(run, 400);
  await tween(run, { targets: text, alpha: 0, duration: 150 });
  text.destroy();
}

// "+5" for a flat guard, "30%" for a percent one.
function guardText(guard: PlayRecord["guard"]): string {
  if (!guard) return "";
  return guard.mode === MODIFIER_MODE.PERCENT ? `${Math.round(guard.amount * 100)}%` : `+${fmt(guard.amount)}`;
}

const RESIST_LABEL: Record<string, string> = { physical: "DEF", magic: "MR", element: "ER" };

function accentFor(action: PlayRecord): number {
  return (
    ({ physical: 0xe6e9f0, magic: 0xb388ff, element: 0xff9d4d, true: 0xffe066 } as Record<string, number>)[
      action.damageType ?? ""
    ] ?? EFFECT_COLOR.hit
  );
}

// --- effect pieces -----------------------------------------------------------

// `quiet`: skip the impact sound/particles (an ultimate already did its own).
function hit(
  run: RoundRecapRun,
  target: RecapSide,
  action: Pick<PlayRecord, "damage" | "guarded" | "resisted" | "damageType">,
  { quiet = false }: { quiet?: boolean } = {}
): EffectResult {
  const { scene, layer } = run;
  const damage = action.damage ?? 0;
  const guarded = action.guarded ?? 0;
  const resisted = action.resisted ?? 0;
  const panel = target.panel();
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;
  const blocked = damage <= 0;
  const color = blocked ? EFFECT_COLOR.block : EFFECT_COLOR.hit;

  if (!quiet) {
    playSfx(blocked ? "block" : "hit");
    burstParticles(run, cx, cy, { colors: [color] });
  }

  // Flash the panel and shake it.
  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, color, 0.45).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 400, onComplete: () => flash.destroy() });
  if (!blocked) {
    scene.tweens.add({ targets: panel.container, x: panel.x + 8, duration: 40, yoyo: true, repeat: 3, onComplete: () => panel.container.setX(panel.x) });
  }

  // Floating number.
  const label = scene.add
    .text(cx, cy - 10, blocked ? "BLOCKED" : `-${fmt(damage)}`, {
      fontFamily: FONT_FAMILY,
      fontSize: blocked ? "28px" : "40px",
      fontStyle: "800",
      color: hex(color),
      stroke: "#000000",
      strokeThickness: 6,
    })
    .setOrigin(0.5)
    .setScale(0.5);
  layer.add(label);
  scene.tweens.add({ targets: label, scale: 1, duration: 160, ease: "Back.easeOut" });
  scene.tweens.add({ targets: label, y: cy - 60, alpha: 0, delay: 600, duration: 500, onComplete: () => label.destroy() });

  // What the target's defenses soaked up: a shield bubble for a defend card,
  // and a line under the number, e.g. "Shield −5 · DEF −2".
  if (guarded > 0) shieldBubble(run, cx, cy);
  const absorbed: string[] = [];
  if (guarded > 0) absorbed.push(`Shield −${fmt(guarded)}`);
  if (resisted > 0) absorbed.push(`${RESIST_LABEL[action.damageType ?? ""] ?? "Resist"} −${fmt(resisted)}`);
  if (absorbed.length > 0) {
    const note = scene.add
      .text(cx, cy + 26, absorbed.join(" · "), {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        fontStyle: "800",
        color: hex(EFFECT_COLOR.defend),
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    layer.add(note);
    scene.tweens.add({ targets: note, alpha: 1, duration: 150, delay: 120 });
    scene.tweens.add({ targets: note, alpha: 0, delay: 1000, duration: 400, onComplete: () => note.destroy() });
  }

  if (!blocked) {
    target.hp = Math.max(0, target.hp - damage);
    panel.setHp(target.hp);
  }
  return blocked ? { text: "Blocked!", color } : { text: `${fmt(damage)} damage!`, color };
}

// A bubble that flashes over the impact point when a defend card absorbs
// part of a hit.
function shieldBubble(run: RoundRecapRun, x: number, y: number): void {
  const { scene, layer } = run;
  const bubble = scene.add.circle(x, y, 46, EFFECT_COLOR.defend, 0.25).setStrokeStyle(4, EFFECT_COLOR.defend);
  layer.add(bubble);
  bubble.setScale(0.4);
  scene.tweens.add({ targets: bubble, scale: 1.2, duration: 220, ease: "Back.easeOut" });
  scene.tweens.add({ targets: bubble, alpha: 0, delay: 350, duration: 350, onComplete: () => bubble.destroy() });
}

async function shieldRing(run: RoundRecapRun, panel: RecapPanel, action: PlayRecord): Promise<void> {
  const { scene, layer } = run;
  const cx = panel.x + panel.w / 2;
  const cy = panel.y + panel.h / 2;

  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, EFFECT_COLOR.defend, 0.35).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 700, onComplete: () => flash.destroy() });

  // Big "GUARD +5" with the damage type and duration under it.
  const title = scene.add
    .text(cx, cy - 6, `GUARD ${guardText(action.guard)}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "38px",
      fontStyle: "800",
      color: hex(EFFECT_COLOR.defend),
      stroke: "#000000",
      strokeThickness: 7,
    })
    .setOrigin(0.5)
    .setScale(0.4);
  const turns = action.guard?.duration ?? 1;
  const sub = scene.add
    .text(cx, cy + 30, `${action.damageType} · ${turns} turn${turns === 1 ? "" : "s"}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "16px",
      fontStyle: "700",
      color: TEXT.white,
      stroke: "#000000",
      strokeThickness: 4,
    })
    .setOrigin(0.5)
    .setAlpha(0);
  layer.add([title, sub]);
  scene.tweens.add({ targets: title, scale: 1, duration: 260, ease: "Back.easeOut" });
  scene.tweens.add({ targets: sub, alpha: 1, delay: 150, duration: 200 });
  scene.tweens.add({ targets: [title, sub], alpha: 0, delay: 1100, duration: 350, onComplete: () => { title.destroy(); sub.destroy(); } });

  for (let i = 0; i < 3; i++) {
    const ring = scene.add.graphics();
    ring.lineStyle(5, EFFECT_COLOR.defend, 1);
    ring.strokeRoundedRect(-panel.w / 2, -panel.h / 2, panel.w, panel.h, 14);
    const holder = scene.add.container(cx, cy, [ring]).setAlpha(0.9);
    layer.add(holder);
    scene.tweens.add({
      targets: holder,
      scaleX: 1.06,
      scaleY: 1.12,
      alpha: 0,
      delay: i * 220,
      duration: 600,
      onComplete: () => holder.destroy(true),
    });
  }
  await iconPop(run, CARD_ICON_KEY.defend, panel.x + 48, cy, EFFECT_COLOR.defend);
  await wait(run, 350);
}

async function sparkle(run: RoundRecapRun, panel: RecapPanel, color: number, direction: "up" | "down"): Promise<void> {
  const { scene, layer } = run;
  const up = direction === "up";
  for (let i = 0; i < 16; i++) {
    const x = panel.x + Phaser.Math.Between(20, panel.w - 20);
    const y = up ? panel.y + panel.h - Phaser.Math.Between(0, 30) : panel.y + Phaser.Math.Between(0, 30);
    const p = scene.add.circle(x, y, Phaser.Math.Between(3, 6), color);
    layer.add(p);
    scene.tweens.add({
      targets: p,
      y: y + (up ? -1 : 1) * Phaser.Math.Between(60, 110),
      alpha: 0,
      delay: Phaser.Math.Between(0, 250),
      duration: 650,
      ease: "Sine.easeOut",
      onComplete: () => p.destroy(),
    });
  }
  const flash = scene.add.rectangle(panel.x, panel.y, panel.w, panel.h, color, 0.3).setOrigin(0, 0);
  layer.add(flash);
  scene.tweens.add({ targets: flash, alpha: 0, duration: 500, onComplete: () => flash.destroy() });
  await iconPop(run, CARD_ICON_KEY[up ? "buff" : "debuff"], panel.x + panel.w / 2, panel.y + panel.h / 2, color);
}

async function iconPop(run: RoundRecapRun, key: string, x: number, y: number, color: number): Promise<void> {
  const { scene, layer } = run;
  if (!scene.textures.exists(key)) return wait(run, 400);
  const glow = scene.add.circle(x, y, 34, color, 0.35);
  const icon = scene.add.image(x, y, key).setDisplaySize(48, 48);
  const holder = scene.add.container(0, 0, [glow, icon]).setAlpha(0);
  layer.add(holder);
  await tween(run, { targets: holder, alpha: 1, duration: 150 });
  await tween(run, { targets: [glow], scale: 1.6, duration: 300, ease: "Sine.easeOut" });
  await tween(run, { targets: holder, alpha: 0, duration: 250 });
  holder.destroy(true);
}
