// Battle screen: renders src/model/engine.ts's battle state and turns clicks
// into playRound() calls. Every render() call wipes and rebuilds the dynamic
// containers (fighter panels, hand, log) rather than diffing them -- this is
// a low-frequency turn-based UI, so that's simpler.
//
// After each round resolves, the round recap (roundRecap.ts) replays both
// fighters' actions with animation and narration before the new state is
// shown; HP bars count down as the hits land.

import Phaser from "phaser";
import {
  computeCurrentStats,
  canUseUltimate,
  createBattle,
  cardAction,
  ultimateAction,
  playRound,
  describeCard,
  describeEffect,
  isBattleOver,
  fighterName,
  type Action,
  type Battle,
  type Fighter,
  type LastAction,
} from "../model/engine.ts";
import { EFFECT_KIND, MODIFIER_MODE } from "../model/effects.ts";
import { RESIST_STAT } from "../model/damageTypes.ts";
import type { StatKey } from "../model/stats.ts";
import type { Card, DefendCard } from "../model/cardTypes.ts";
import type { ClassDef } from "../model/classes.ts";
import { allCards, allClasses } from "../model/catalog.ts";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY, CARD_ICON_KEY } from "../phaserIcons.ts";
import { loadCardArt } from "../cardArt.ts";
import { isMuted, playSfx, setMuted } from "../fx/sound.ts";
import {
  COLORS,
  TEXT,
  FONT_FAMILY,
  BACKGROUNDS,
  GAME_WIDTH,
  GAME_HEIGHT,
  addBackground,
  preloadBackground,
  roundedRect,
  createButton,
  textShadow,
  useRenderScale,
  type Button,
} from "./theme.ts";
import { drawCardFace } from "./cardFace.ts";
import { playRoundRecap, setRecapSpeed, type RecapPanel, type RecapSide, type RecapSlotView, type RoundRecapRun } from "./roundRecap.ts";

// 1280x720 board layout: CPU strip top-center, player strip lower-center,
// portraits in the left column, battle log in the right column, hand along
// the bottom-center, buttons mid-left. The 720px height budget means fighter
// info lives in compact 124px strips (header + HP + chips + effects + meter)
// instead of the old 200px panels -- same data and drawing helpers, tighter
// rows. The middle arena band stays empty for the recap until Phase 3 slots.
const STRIP_X = 240;
const STRIP_W = 816;
const STRIP_H = 124;
const STRIP_PAD = 16;
const CPU_STRIP_Y = 44;
const PLAYER_STRIP_Y = 414;
const STATUS_Y = 176;

// Left-column portraits: identity at a glance (icon + name + HP + ultimate).
const PORTRAIT_X = 16;
const PORTRAIT_W = 208;
const PORTRAIT_H = 200;
const CPU_PORTRAIT_Y = 44;
const PLAYER_PORTRAIT_Y = 476;

// Left-column buttons, between the portraits.
const BUTTON_X = 24;
const BUTTON_W = 176;
const BUTTON_H = 40;
const ULTIMATE_BUTTON_Y = 296;
const LEAVE_BUTTON_Y = 346;

const HAND_Y = 548;
const CARD_W = 112;
const CARD_H = 160;

// Fanned bottom hand + preview-then-commit: cards overlap horizontally; hover
// lifts slightly (mouse only); click/tap pops the card into a full preview
// (raised, enlarged, gold ring) and a second click/tap commits it.
const FAN_OVERLAP = 44;
const HOVER_LIFT = 12;
const POP_SCALE = 1.4;
const POP_LIFT = 104;
const PREVIEW_RING = 0xc49b3a;

// Middle arena slots holding each side's last resolved card (Phase 3). Fed
// solely by post-resolution lastAction -- vacant pre-first-commit -- so the CPU slot
// can never leak a face before reveal.
const SLOT_W = 150;
const SLOT_H = 190;
const SLOT_Y = 195;
const SLOT_GAP = 20;
const SLOT_TOTAL_W = SLOT_W * 2 + SLOT_GAP;

// Commit flight: hand card tosses into its slot before resolution (~260ms).
const FLIGHT_DURATION = 260;

export interface PendingPlay {
  playerCard: Card | null; // committed card (null for ultimates: nothing to fly)
  round: number; // battle.round at commit; validates the CPU face source
  cpuRevealed: boolean; // flip done -- rebuilds may draw the face, not the back
}

const LOG_X = 1072;
const LOG_Y = 44;
const LOG_W = 192;
const LOG_H = 628;
// Wheel scroll step, px. Entries have variable (word-wrapped) heights, so
// scrolling is a pixel offset, not a line index -- see renderLog.
const LOG_SCROLL_STEP = 60;
const LOG_ENTRY_GAP = 6;

// The band the round recap covers: status line, arena, player strip and hand.
const RECAP_STAGE = { y: STATUS_Y - 8, h: 400 };

const STAT_CHIPS: Array<{ key: StatKey; label: string; color: number }> = [
  { key: "def", label: "DEF", color: 0xc9c9c9 },
  { key: "mr", label: "MR", color: 0xb388ff },
  { key: "er", label: "ER", color: 0xff9d4d },
  { key: "ur", label: "UR", color: 0xffe066 },
];

const CHIP_COLOR = {
  guard: 0x2f6f8f,
  up: 0x3a8f5a,
  down: 0x8a3a52,
  synergy: 0x4a5573,
  synergyActive: 0xa8842f,
};

const GUARD_COLOR = 0x6ec6ff;

// Where the background's wall torches are painted -- keep in sync with
// TORCHES in scripts/backgrounds.ts.
const TORCHES = [
  { x: 278, y: 322 },
  { x: 1002, y: 322 },
];
const TORCH_GLOW_KEY = "torch-glow";

// Round-recap playback speeds the Speed button cycles through; the choice is
// remembered per browser.
const RECAP_SPEEDS = [1, 1.5, 2, 3];
const RECAP_SPEED_KEY = "godfield.recapSpeed";

function readRecapSpeed(): number {
  try {
    const value = Number(window.localStorage.getItem(RECAP_SPEED_KEY));
    return RECAP_SPEEDS.includes(value) ? value : 1;
  } catch {
    return 1;
  }
}

function saveRecapSpeed(value: number): void {
  try {
    window.localStorage.setItem(RECAP_SPEED_KEY, String(value));
  } catch {
    // storage unavailable (private window etc.) -- just don't remember it
  }
}

const RESULT: Record<"win" | "lose" | "draw", { title: string; color: number; sfx: string }> = {
  win: { title: "VICTORY", color: 0xffd23f, sfx: "victory" },
  lose: { title: "DEFEAT", color: 0xff5a4f, sfx: "defeat" },
  draw: { title: "DRAW", color: 0xc9cfe0, sfx: "draw" },
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shortName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, "");

function hpColor(pct: number): number {
  if (pct > 0.5) return 0x4caf6a;
  if (pct > 0.25) return 0xe0a030;
  return 0xd9483b;
}

// "+5" for a flat guard, "30%" for a percent one.
function guardAmount(card: Pick<DefendCard, "mode" | "amount">): string {
  return card.mode === MODIFIER_MODE.PERCENT ? `${Math.round(card.amount * 100)}%` : `+${fmt(card.amount)}`;
}

function ultimateName(classDef: ClassDef): string {
  const name = classDef.ultimate.name;
  return name && name !== "TBD" ? name : "Ultimate";
}

export interface BattleSceneData {
  playerClass: ClassDef;
  onExit?: (() => void) | null;
}

export interface HpPair {
  player: number;
  cpu: number;
}

// vs-CPU battle. OnlineBattleScene (src/scenes/OnlineBattleScene.ts) reuses
// all of the drawing below and only overrides the hooks in the "battle
// source" section: where the battle comes from, what a click does, and the
// status line.
export class BattleScene extends Phaser.Scene {
  battle!: Battle;
  onExit: (() => void) | null = null;
  recapPlaying = false;
  recapRun: RoundRecapRun | null = null; // active recap (speed/skip control) -- see roundRecap.ts
  shownHp: HpPair | null = null; // { player, cpu } while a recap is counting HP down
  panelViews: Record<string, RecapPanel> = {};
  recapSpeed = 1;
  resultLayer: Phaser.GameObjects.Container | null = null; // the end-of-game screen, once shown
  resultDismissed = false; // closed with "View board"
  cpuPanel!: Phaser.GameObjects.Container;
  playerPanel!: Phaser.GameObjects.Container;
  cpuPortrait!: Phaser.GameObjects.Container;
  playerPortrait!: Phaser.GameObjects.Container;
  statusText!: Phaser.GameObjects.Text;
  handContainer!: Phaser.GameObjects.Container;
  slotsContainer!: Phaser.GameObjects.Container;
  ultimateButton!: Button;
  previewedCardId: number | null = null; // card id held in full preview (click/tap once; commits on second)
  animatePreview = false; // tween the pop-in only on the selecting render, never on rebuilds
  previewedView: Phaser.GameObjects.Container | null = null; // live popped container, for glide-back dismiss
  previewedSlotX = 0; // its slot x, the dismiss target
  dismissTween: Phaser.Tweens.Tween | null = null; // in-flight glide-back, killed on any rebuild
  flightLayer!: Phaser.GameObjects.Container; // commit-flight clones; never rebuilt by render()
  pendingPlay: PendingPlay | null = null; // committed round in flight: slots show it until the recap fades it
  slotViews: Record<"player" | "cpu", { card: Phaser.GameObjects.Container | null; isBack: boolean }> = {
    player: { card: null, isBack: false },
    cpu: { card: null, isBack: false },
  };
  flightSeq = 0; // invalidates stale flight continuations (leave/restart mid-flight)
  flightTween: Phaser.Tweens.Tween | null = null;
  flightView: Phaser.GameObjects.Container | null = null;
  flightPromise: Promise<void> | null = null;
  flightResolve: (() => void) | null = null;
  logScrollIndex = 0; // pixel offset into the measured log content
  logMaxScrollIndex = 0; // max pixel offset (content height - box height)
  logTotalHeight = 0; // measured content height, set by renderLog
  logContainer!: Phaser.GameObjects.Container;
  logScrollTrack!: Phaser.GameObjects.Rectangle;
  logScrollThumb!: Phaser.GameObjects.Rectangle;

  constructor(key = "BattleScene") {
    super(key);
  }

  preload(): void {
    preloadIcons(this, allClasses());
    preloadBackground(this, BACKGROUNDS.battle);
  }

  // A flickering warm glow over each wall torch painted in the background.
  addTorchLight(): void {
    if (!this.textures.exists(BACKGROUNDS.battle.key)) return;
    if (!this.textures.exists(TORCH_GLOW_KEY)) {
      // A soft radial glow, drawn once into a canvas texture.
      const texture = this.textures.createCanvas(TORCH_GLOW_KEY, 128, 128);
      if (!texture) return;
      const ctx = texture.getContext();
      const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
      gradient.addColorStop(0, "rgba(255, 214, 150, 1)");
      gradient.addColorStop(0.3, "rgba(255, 157, 77, 0.55)");
      gradient.addColorStop(1, "rgba(255, 122, 42, 0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 128, 128);
      texture.refresh();
    }
    for (const { x, y } of TORCHES) {
      const glow = this.add.image(x, y - 16, TORCH_GLOW_KEY).setDisplaySize(190, 190).setBlendMode(Phaser.BlendModes.ADD).setAlpha(0.5);
      // Alpha and size flicker on unrelated periods, so it never looks regular.
      this.tweens.add({ targets: glow, alpha: 0.28, duration: 150 + Math.random() * 90, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({
        targets: glow,
        scale: glow.scale * 0.9,
        duration: 230 + Math.random() * 120,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
        delay: Math.random() * 100,
      });
    }
  }

  // --- battle source (overridden by OnlineBattleScene) ---------------------

  setupBattle(data: BattleSceneData): Battle {
    const playerClass = data.playerClass;
    const cpuClass = allClasses().find((c) => c.id !== playerClass.id) ?? playerClass;
    return createBattle(playerClass, cpuClass);
  }

  get playerLabel(): string {
    return "Player";
  }

  get opponentLabel(): string {
    return "CPU";
  }

  get leaveLabel(): string {
    return "Restart";
  }

  // The line under VICTORY / DEFEAT / DRAW.
  resultSubtitle(): string {
    const b = this.battle;
    const opponent = shortName(b.cpu.classDef.name);
    if (b.draw) return "Both fighters went down at the same time.";
    if (b.winner === b.player) return `You defeated ${this.opponentLabel} (${opponent}) in round ${b.round}.`;
    return `${this.opponentLabel} (${opponent}) wins in round ${b.round}.`;
  }

  // Whether the hand/ultimate should take clicks right now.
  canAct(): boolean {
    return !isBattleOver(this.battle) && !this.recapPlaying;
  }

  commitAction(action: Action): void {
    this.previewedCardId = null;
    this.animatePreview = false;
    this.previewedView = null;
    this.dismissTween?.stop();
    this.dismissTween = null;
    const before = this.currentHp();
    playRound(this.battle, action);
    this.presentRound(before);
  }

  // Glide a held preview back into the fan, then rebuild. Async on purpose:
  // the snap-back was the complaint. Guarded everywhere a rebuild can beat
  // it there -- renderHand kills the tween, commit paths clear the state --
  // so a dead or stale target can never drive a render.
  dismissPreview(): void {
    const view = this.previewedView;
    const slotX = this.previewedSlotX;
    this.previewedCardId = null;
    this.previewedView = null;
    this.dismissTween?.stop();
    this.dismissTween = null;
    if (!view || !view.active || !view.scene) {
      this.render();
      return;
    }
    this.dismissTween = this.tweens.add({
      targets: view,
      x: slotX,
      y: 0,
      scale: 1,
      duration: 120,
      ease: "Sine.easeIn",
      onComplete: () => {
        this.dismissTween = null;
        if (this.previewedCardId !== null || !this.sys.isActive()) return;
        this.render();
      },
    });
  }

  onLeave(): void {
    // Abandon any commit flight: its continuation must not resolve a round
    // for a battle being left.
    this.flightSeq++;
    this.finishFlight();
    // React shell supplies onExit so Back returns to the menu; fall back to
    // the in-Phaser menu when launched standalone (legacy/dev path).
    if (this.onExit) {
      this.onExit();
      return;
    }
    this.scene.start("ClassSelectScene");
  }

  // Settle + clean up any commit flight without landing it. Resolves the
  // flight promise so awaiters never hang; landing is skipped via the seq.
  finishFlight(): void {
    this.flightSeq++;
    this.flightTween?.stop();
    this.flightTween = null;
    this.flightView?.destroy();
    this.flightView = null;
    this.flightResolve?.();
    this.flightResolve = null;
    this.flightPromise = null;
  }

  // Toss the committed card from the fan into its arena slot, then continue.
  // Input stays locked (recapPlaying) from flight start through the recap,
  // so the 250ms window can't double-commit. Blindness is preserved: the CPU
  // still picks at resolve time, seeing nothing.
  beginFlight(card: Card, onLanded: () => void): void {
    this.finishFlight(); // supersede anything stale (defensive; normally idle)
    const seq = ++this.flightSeq;
    // The preview becomes the flight: clear pop state so the fan redraws
    // whole (the card is still in hand until resolve removes it).
    this.previewedCardId = null;
    this.animatePreview = false;
    this.previewedView = null;
    this.dismissTween?.stop();
    this.dismissTween = null;
    this.pendingPlay = { playerCard: card, round: this.battle.round, cpuRevealed: false };
    this.recapPlaying = true;
    this.render();

    const idx = this.battle.player.hand.findIndex((c) => c.id === card.id);
    const step = CARD_W - FAN_OVERLAP;
    const totalW = this.battle.player.hand.length * CARD_W - Math.max(0, this.battle.player.hand.length - 1) * FAN_OVERLAP;
    const fx = GAME_WIDTH / 2 - totalW / 2 + Math.max(0, idx) * step;
    const { container } = drawCardFace(
      this,
      {
        cardId: card.cardId,
        category: card.category,
        name: card.name,
        damageType: "damageType" in card ? card.damageType : null,
        description: describeCard(card),
      },
      CARD_W,
      CARD_H
    );
    container.setPosition(fx, HAND_Y);
    this.flightLayer.add(container);
    this.flightView = container;

    const slotX = GAME_WIDTH / 2 + SLOT_TOTAL_W / 2 - SLOT_W + (SLOT_W - CARD_W) / 2;
    const slotY = SLOT_Y + (SLOT_H - CARD_H) / 2;
    let resolveFlight!: () => void;
    this.flightPromise = new Promise<void>((resolve) => {
      resolveFlight = resolve;
    });
    this.flightResolve = resolveFlight;
    this.flightTween = this.tweens.add({
      targets: container,
      x: slotX,
      y: slotY,
      duration: FLIGHT_DURATION,
      ease: "Cubic.easeOut",
      onComplete: () => {
        this.flightTween = null;
        this.flightView = null;
        container.destroy();
        this.flightPromise = null;
        this.flightResolve = null;
        resolveFlight();
        if (seq !== this.flightSeq || !this.sys.isActive()) return;
        onLanded();
      },
    });
  }

  statusMessage(): string {
    if (this.battle.winner) return `${fighterName(this.battle.winner)} wins! Press "Restart" to play again.`;
    if (this.battle.draw) return `Draw! Press "Restart" to play again.`;
    return `Round ${this.battle.round} — pick a card. The CPU is choosing at the same time.`;
  }

  // --- scene ---------------------------------------------------------------

  create(data: BattleSceneData): void {
    useRenderScale(this);
    this.onExit = data.onExit ?? null;
    this.recapPlaying = false;
    this.previewedCardId = null;
    this.animatePreview = false;
    this.previewedView = null;
    this.dismissTween = null;
    this.pendingPlay = null;
    this.flightSeq++; // abandon any flight continuation from a previous life
    this.flightTween = null;
    this.flightView = null;
    this.flightPromise = null;
    this.flightResolve = null;
    this.slotViews = {
      player: { card: null, isBack: false },
      cpu: { card: null, isBack: false },
    };
    this.previewedView = null;
    this.dismissTween = null;
    this.shownHp = null; // { player, cpu } while a recap is counting HP down
    this.panelViews = {};
    this.recapSpeed = readRecapSpeed();
    this.resultLayer = null; // the end-of-game screen, once shown
    this.resultDismissed = false; // closed with "View board"
    this.battle = this.setupBattle(data);

    this.events.once("shutdown", () => {
      this.tweens.timeScale = 1;
      this.time.timeScale = 1;
    });

    // Bottom-most click catcher: any pointerdown that hits no interactive
    // object (arena, strips, log, background) dismisses a held preview.
    // Cards, buttons, and overlays all sit above it and win their own clicks
    // (input.topOnly), so normal play is a single null-check no-op.
    const dismissZone = this.add.zone(0, 0, GAME_WIDTH, GAME_HEIGHT).setOrigin(0, 0).setInteractive();
    dismissZone.on("pointerdown", () => {
      this.dismissPreview();
    });

    addBackground(this, BACKGROUNDS.battle);
    this.addTorchLight();

    // Dark backing so the battle log reads cleanly over the hall's floor.
    const logBacking = this.add.graphics();
    logBacking.fillStyle(0x0b0d15, 0.72);
    logBacking.fillRoundedRect(LOG_X - 14, LOG_Y - 32, LOG_W + 28, LOG_H + 42, 12);

    textShadow(
      this.add
        .text(GAME_WIDTH / 2, 14, "Godfield-lite", { fontFamily: FONT_FAMILY, fontSize: "20px", fontStyle: "700", color: TEXT.white })
        .setOrigin(0.5, 0)
    );

    const soundLabel = (): string => (isMuted() ? "Sound: off" : "Sound: on");
    // Top-left, clear of the centered title and the right-side log column.
    const soundButton = createButton(this, 24, 12, 110, 26, soundLabel(), {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => {
        setMuted(!isMuted());
        (soundButton.container.getAt(1) as Phaser.GameObjects.Text).setText(soundLabel());
      },
    });

    // Speed of the end-of-round replay; takes effect immediately, even
    // mid-replay.
    const speedLabel = (): string => `Speed ${this.recapSpeed}x`;
    const speedButton = createButton(this, 24 + 110 + 8, 12, 100, 26, speedLabel(), {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => {
        const i = RECAP_SPEEDS.indexOf(this.recapSpeed);
        this.recapSpeed = RECAP_SPEEDS[(i + 1) % RECAP_SPEEDS.length] as number;
        saveRecapSpeed(this.recapSpeed);
        setRecapSpeed(this, this.recapSpeed);
        (speedButton.container.getAt(1) as Phaser.GameObjects.Text).setText(speedLabel());
      },
    });

    this.cpuPanel = this.add.container(0, 0);
    this.playerPanel = this.add.container(0, 0);
    this.cpuPortrait = this.add.container(0, 0);
    this.playerPortrait = this.add.container(0, 0);

    this.statusText = textShadow(
      this.add
        .text(GAME_WIDTH / 2, STATUS_Y, "", { fontFamily: FONT_FAMILY, fontSize: "14px", fontStyle: "700", color: TEXT.white, align: "center" })
        .setOrigin(0.5, 0)
    );

    this.handContainer = this.add.container(0, HAND_Y);
    this.slotsContainer = this.add.container(0, 0);
    this.flightLayer = this.add.container(0, 0);

    const ultimate = createButton(this, BUTTON_X, ULTIMATE_BUTTON_Y, BUTTON_W, BUTTON_H, "Use Ultimate", {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => this.onUltimateClick(),
    });
    this.ultimateButton = ultimate;

    createButton(this, BUTTON_X, LEAVE_BUTTON_Y, BUTTON_W, BUTTON_H, this.leaveLabel, {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.onLeave(),
    });

    this.add
      .text(LOG_X, LOG_Y - 24, "Battle log", { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted })
      .setOrigin(0, 0);

    // Scrolling is done by picking which slice of battle.log to render
    // (index 0 = newest) rather than by pixel-clipping a moving container --
    // Phaser 4's WebGL renderer dropped support for GeometryMask (it wants a
    // texture-based Filter instead), and every log line is a short one-liner
    // anyway, so paging by line is simpler and renderer-agnostic.
    this.logScrollIndex = 0;
    this.logMaxScrollIndex = 0;
    this.logContainer = this.add.container(LOG_X, LOG_Y);

    this.logScrollTrack = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.meterTrack)
      .setOrigin(0, 0)
      .setVisible(false);
    this.logScrollThumb = this.add
      .rectangle(LOG_X + LOG_W - 6, LOG_Y, 4, LOG_H, COLORS.restartHover)
      .setOrigin(0, 0)
      .setVisible(false);

    // Only scroll the log when the pointer is over it, so it doesn't hijack
    // wheel input over the rest of the page.
    // pointer.x/y are canvas pixels, so convert them into the camera's
    // (zoomed) layout coordinates before comparing to the log's box.
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      void _objects;
      void _dx;
      const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (x < LOG_X || x > LOG_X + LOG_W || y < LOG_Y || y > LOG_Y + LOG_H) {
        return;
      }
      this.scrollLog(Math.sign(dy) * LOG_SCROLL_STEP);
    });

    this.render();
    loadCardArt(this, allCards(), () => this.render());
  }

  scrollLog(deltaPixels: number): void {
    const next = Phaser.Math.Clamp(this.logScrollIndex + deltaPixels, 0, this.logMaxScrollIndex);
    if (next === this.logScrollIndex) return;
    this.logScrollIndex = next;
    this.renderLog();
  }

  updateLogScrollbar(): void {
    const totalH = this.logTotalHeight;
    const maxScroll = this.logMaxScrollIndex;
    const needsScroll = maxScroll > 0;
    this.logScrollTrack.setVisible(needsScroll);
    this.logScrollThumb.setVisible(needsScroll);
    if (!needsScroll) return;

    const thumbH = Math.max(24, (LOG_H / totalH) * LOG_H);
    const thumbY = LOG_Y + (this.logScrollIndex / maxScroll) * (LOG_H - thumbH);
    this.logScrollThumb.setSize(4, thumbH);
    this.logScrollThumb.setPosition(LOG_X + LOG_W - 6, thumbY);
  }

  onCardClick(cardId: number): void {
    if (!this.canAct()) return;
    const action = cardAction(this.battle.player, cardId);
    if (!action || action.kind !== "card") return;
    // Preview state was already cleared by the committing click; fly first,
    // resolve on landing. Ultimate clicks skip the flight (no hand card).
    this.beginFlight(action.card, () => this.commitAction(action));
  }

  onUltimateClick(): void {
    if (!this.canAct()) return;
    const action = ultimateAction(this.battle.player);
    if (!action) return;
    this.pendingPlay = { playerCard: null, round: this.battle.round, cpuRevealed: false };
    this.render();
    this.commitAction(action);
  }

  // --- round recap -----------------------------------------------------------

  currentHp(): HpPair {
    return { player: this.battle.player.hp, cpu: this.battle.cpu.hp };
  }

  // Show the round that just resolved: draw the new state with the HP from
  // `before`, play the recap (which counts HP down as hits land), then draw
  // the final state. Without both sides' lastAction (e.g. an online match on
  // a server that doesn't send it yet) it just redraws.
  async presentRound(before: HpPair): Promise<void> {
    const b = this.battle;
    const playerAction: LastAction | null = b.player.lastAction;
    const cpuAction: LastAction | null = b.cpu.lastAction;
    if (!playerAction || !cpuAction) {
      this.render();
      return;
    }

    this.recapPlaying = true;
    this.shownHp = { ...before };
    this.render();

    // The commit flight may still be landing (slow tween, fast resolve path):
    // the recap must start from settled slot faces, never mid-flight.
    await this.flightPromise;
    if (!this.sys.isActive()) return;

    const slotX = (key: "player" | "cpu"): number =>
      key === "cpu" ? GAME_WIDTH / 2 - SLOT_TOTAL_W / 2 : GAME_WIDTH / 2 + SLOT_TOTAL_W / 2 - SLOT_W;
    const side = (key: "player" | "cpu", fighter: Fighter, who: string): RecapSide => ({
      action: key === "player" ? playerAction : cpuAction,
      who,
      classId: fighter.classDef.id,
      className: shortName(fighter.classDef.name),
      ultimateName: ultimateName(fighter.classDef),
      hp: before[key],
      panel: () => this.panelViews[key] as RecapPanel,
      slot: (): RecapSlotView | null => {
        const view = this.slotViews[key];
        if (!view) return null;
        return { x: slotX(key), y: SLOT_Y, w: SLOT_W, h: SLOT_H, card: view.card, isBack: view.isBack, faceW: CARD_W, faceH: CARD_H };
      },
      revealSlot: (): void => {
        if (this.pendingPlay) this.pendingPlay.cpuRevealed = true;
      },
    });

    playRoundRecap(this, {
      round: playerAction.round,
      stage: RECAP_STAGE,
      sides: {
        player: side("player", b.player, "You"),
        cpu: side("cpu", b.cpu, this.opponentLabel),
      },
      speed: this.recapSpeed,
    }).finally(() => {
      this.recapPlaying = false;
      this.shownHp = null;
      this.pendingPlay = null; // slots empty again until the next commit
      if (this.sys.isActive()) this.render();
    });
  }

  // --- end-of-game screen ------------------------------------------------------

  // VICTORY / DEFEAT / DRAW in the middle of the screen, over everything,
  // once the game is over and the last round's recap has finished. "View
  // board" closes it to look at the final state; the Restart/Leave button
  // under the hand still works after that.
  showResult(): void {
    if (this.resultLayer || this.resultDismissed) return;
    const b = this.battle;
    const result = b.draw ? RESULT.draw : b.winner === b.player ? RESULT.win : RESULT.lose;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2 - 50;

    const layer = this.add.container(0, 0).setDepth(1000);
    this.resultLayer = layer;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070d, 0.75).setOrigin(0, 0).setInteractive();
    layer.add(dim);

    if (result === RESULT.win) {
      // Slowly turning rays behind the title, and falling confetti.
      const rays = this.add.graphics();
      rays.fillStyle(result.color, 0.13);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const spread = Math.PI / 24;
        rays.fillTriangle(
          0,
          0,
          Math.cos(a - spread) * 520,
          Math.sin(a - spread) * 520,
          Math.cos(a + spread) * 520,
          Math.sin(a + spread) * 520
        );
      }
      const rayHolder = this.add.container(cx, cy, [rays]).setAlpha(0);
      layer.add(rayHolder);
      this.tweens.add({ targets: rayHolder, alpha: 1, duration: 500 });
      this.tweens.add({ targets: rayHolder, angle: 360, duration: 24000, repeat: -1 });

      const confettiColors = [0xffd23f, 0xffffff, 0x6be39a, 0x6ec6ff, 0xff9d4d];
      for (let i = 0; i < 60; i++) {
        const piece = this.add
          .rectangle(Phaser.Math.Between(0, GAME_WIDTH), Phaser.Math.Between(-300, -10), 6, 10, (confettiColors[i % confettiColors.length] as number))
          .setAngle(Phaser.Math.Between(0, 360));
        layer.add(piece);
        this.tweens.add({
          targets: piece,
          y: 800,
          angle: piece.angle + Phaser.Math.Between(180, 720),
          x: piece.x + Phaser.Math.Between(-80, 80),
          delay: Phaser.Math.Between(0, 1500),
          duration: Phaser.Math.Between(2200, 3600),
          ease: "Sine.easeIn",
          onComplete: () => piece.destroy(),
        });
      }
    } else if (result === RESULT.lose) {
      const shade = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x5a0f0f, 0).setOrigin(0, 0);
      layer.add(shade);
      this.tweens.add({ targets: shade, fillAlpha: 0.25, duration: 600 });
    }

    const title = this.add
      .text(cx, cy, result.title, {
        fontFamily: FONT_FAMILY,
        fontSize: "88px",
        fontStyle: "800",
        color: `#${result.color.toString(16).padStart(6, "0")}`,
        stroke: "#000000",
        strokeThickness: 10,
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(cx, cy + 70, this.resultSubtitle(), {
        fontFamily: FONT_FAMILY,
        fontSize: "18px",
        fontStyle: "700",
        color: TEXT.white,
        align: "center",
        wordWrap: { width: 700 },
      })
      .setOrigin(0.5, 0);
    const hp = (f: Fighter): string => `${Math.ceil(f.hp)}/${f.maxHp} HP`;
    const summary = this.add
      .text(cx, cy + 102, `You ${hp(b.player)}   ·   ${this.opponentLabel} ${hp(b.cpu)}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "14px",
        color: TEXT.muted,
      })
      .setOrigin(0.5, 0);
    layer.add([title, subtitle, summary]);

    const primary = createButton(this, cx - 170, cy + 150, 160, 44, "Back to menu", {
      color: COLORS.ultimate,
      hoverColor: COLORS.ultimateHover,
      onClick: () => this.onLeave(),
    });
    const secondary = createButton(this, cx + 10, cy + 150, 160, 44, "View board", {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.hideResult(),
    });
    layer.add([primary.container, secondary.container]);

    // Entrance: a stamp for VICTORY, a heavy drop for DEFEAT, a fade for DRAW.
    const details: Array<Phaser.GameObjects.Container | Phaser.GameObjects.Text> = [subtitle, summary, primary.container, secondary.container];
    details.forEach((o) => o.setAlpha(0));
    dim.setAlpha(0);
    this.tweens.add({ targets: dim, alpha: 1, duration: 250 });
    if (result === RESULT.win) {
      title.setScale(2.4).setAlpha(0);
      this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 420, ease: "Back.easeOut" });
      this.cameras.main.flash(250, 255, 230, 150);
    } else if (result === RESULT.lose) {
      title.setY(cy - 160).setAlpha(0);
      this.tweens.add({ targets: title, y: cy, alpha: 1, duration: 520, ease: "Bounce.easeOut" });
    } else {
      title.setAlpha(0);
      this.tweens.add({ targets: title, alpha: 1, duration: 500 });
    }
    this.tweens.add({ targets: details, alpha: 1, delay: 450, duration: 300 });
    playSfx(result.sfx);
  }

  hideResult(): void {
    this.resultDismissed = true;
    if (!this.resultLayer) return;
    const layer = this.resultLayer;
    this.resultLayer = null;
    this.tweens.add({
      targets: layer,
      alpha: 0,
      duration: 200,
      onComplete: () => {
        this.tweens.killTweensOf(layer.getAll());
        layer.destroy(true);
      },
    });
  }

  // --- drawing ---------------------------------------------------------------

  render(): void {
    const locked = !this.canAct();

    this.renderFighterPanel("cpu", this.cpuPanel, STRIP_X, CPU_STRIP_Y, STRIP_W, this.battle.cpu);
    this.renderFighterPanel("player", this.playerPanel, STRIP_X, PLAYER_STRIP_Y, STRIP_W, this.battle.player);
    this.drawPortrait(this.cpuPortrait, PORTRAIT_X, CPU_PORTRAIT_Y, this.battle.cpu, this.opponentLabel);
    this.drawPortrait(this.playerPortrait, PORTRAIT_X, PLAYER_PORTRAIT_Y, this.battle.player, this.playerLabel);
    this.drawSlots();
    this.renderHand(locked);
    this.renderLog();

    this.statusText.setText(this.statusMessage());
    this.ultimateButton.setEnabled(!locked && canUseUltimate(this.battle.player));

    if (isBattleOver(this.battle) && !this.recapPlaying) this.showResult();
  }

  renderFighterPanel(
    key: "player" | "cpu",
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    w: number,
    fighter: Fighter
  ): void {
    container.removeAll(true);
    container.setPosition(x, y);
    container.add(roundedRect(this, w, STRIP_H, COLORS.panel, 12));

    this.drawPanelHeader(container, fighter, w);
    this.drawGuardFrame(container, fighter, w);
    const setHp = this.drawHpBar(container, key, fighter, w);
    this.drawStatChips(container, fighter, w);
    // Bottom row is shared: effect chips on the left, ultimate meter right.
    this.drawEffectChips(container, fighter, w, 92, w * 0.55);
    this.drawUltimateMeter(container, fighter, w * 0.58, 97, w - w * 0.58 - STRIP_PAD);

    this.panelViews[key] = { x, y, w, h: STRIP_H, container, setHp };
  }

  // Left-column identity block: big class icon, name, side label, HP and
  // ultimate status. The strip beside it carries bars and chips.
  drawPortrait(
    container: Phaser.GameObjects.Container,
    x: number,
    y: number,
    fighter: Fighter,
    label: string
  ): void {
    container.removeAll(true);
    container.setPosition(x, y);
    container.add(roundedRect(this, PORTRAIT_W, PORTRAIT_H, COLORS.panel, 12));

    const cx = PORTRAIT_W / 2;
    container.add(this.add.circle(cx, 52, 34, COLORS.meterTrack));
    const iconKey = classIconKey(fighter.classDef.id);
    if (this.textures.exists(iconKey)) {
      container.add(this.add.image(cx, 52, iconKey).setDisplaySize(48, 48));
    }
    container.add(
      this.add.text(cx, 94, label.toUpperCase(), { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "700", color: TEXT.muted }).setOrigin(0.5, 0)
    );
    container.add(
      this.add.text(cx, 112, shortName(fighter.classDef.name), {
        fontFamily: FONT_FAMILY,
        fontSize: "15px",
        fontStyle: "700",
        color: TEXT.white,
        align: "center",
        wordWrap: { width: PORTRAIT_W - 24 },
      }).setOrigin(0.5, 0)
    );
    container.add(
      this.add.text(cx, 152, `${Math.ceil(fighter.hp)} / ${fighter.maxHp} HP`, {
        fontFamily: FONT_FAMILY,
        fontSize: "16px",
        fontStyle: "800",
        color: TEXT.white,
      }).setOrigin(0.5, 0)
    );
    const ready = canUseUltimate(fighter);
    container.add(
      this.add.text(cx, 176, ready ? "ULT READY" : `ULT ${fmt(fighter.ultimateMeter)}/${fighter.classDef.ultimate.cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "800",
        color: ready ? "#ffd23f" : TEXT.muted,
      }).setOrigin(0.5, 0)
    );
  }

  drawPanelHeader(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): void {
    container.add(
      this.add.text(STRIP_PAD, 6, shortName(fighter.classDef.name), {
        fontFamily: FONT_FAMILY,
        fontSize: "14px",
        fontStyle: "700",
        color: TEXT.white,
      })
    );
    const handCount = fighter.handCount ?? fighter.hand.length;
    container.add(
      this.add
        .text(w - STRIP_PAD, 8, `Hand ${handCount}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
        .setOrigin(1, 0)
    );
  }

  // While a defend card is up: a pulsing blue frame around the strip and a
  // "GUARD +5" badge in the header, so it's obvious at a glance.
  drawGuardFrame(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): void {
    const guards = Object.values(fighter.activeDefends);
    if (guards.length === 0) return;

    const frame = this.add.graphics();
    frame.lineStyle(3, GUARD_COLOR, 1);
    frame.strokeRoundedRect(1.5, 1.5, w - 3, STRIP_H - 3, 12);
    container.add(frame);
    this.tweens.add({ targets: frame, alpha: 0.35, duration: 800, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    frame.once("destroy", () => this.tweens.killTweensOf(frame));

    const text = this.add
      .text(0, 0, `GUARD ${guards.map(({ card }) => guardAmount(card as DefendCard)).join(" / ")}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "12px",
        fontStyle: "800",
        color: "#0b1b26",
      })
      .setOrigin(0, 0.5);
    const iconSize = 14;
    const wBadge = text.width + iconSize + 22;
    const h = 22;
    const x = w - STRIP_PAD - 58 - wBadge; // left of "Hand N"
    const y = 4;
    const pill = this.add.graphics();
    pill.fillStyle(GUARD_COLOR, 1);
    pill.fillRoundedRect(x, y, wBadge, h, h / 2);
    container.add(pill);
    if (this.textures.exists(CARD_ICON_KEY.defend)) {
      container.add(this.add.image(x + 8 + iconSize / 2, y + h / 2, CARD_ICON_KEY.defend).setDisplaySize(iconSize, iconSize).setTint(0x0b1b26));
    }
    text.setPosition(x + 12 + iconSize, y + h / 2);
    container.add(text);
  }

  // Big HP bar. Returns setHp(value), which animates the bar to a new value
  // (with a pale "ghost" of the lost HP that drains a moment later) -- the
  // round recap calls it as each hit lands.
  drawHpBar(
    container: Phaser.GameObjects.Container,
    key: "player" | "cpu",
    fighter: Fighter,
    w: number
  ): (next: number) => void {
    const pad = STRIP_PAD;
    const barW = w - pad * 2;
    const y = 28;
    const h = 20;
    const track = this.add.graphics();
    track.fillStyle(COLORS.meterTrack, 1);
    track.fillRoundedRect(pad, y, barW, h, 7);
    const ghost = this.add.graphics();
    const fill = this.add.graphics();
    const hpLabel = this.add
      .text(pad + 10, y + h / 2, "HP", { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "800", color: TEXT.white })
      .setOrigin(0, 0.5);
    const value = this.add
      .text(pad + barW / 2, y + h / 2, "", {
        fontFamily: FONT_FAMILY,
        fontSize: "13px",
        fontStyle: "800",
        color: TEXT.white,
        stroke: "#000000",
        strokeThickness: 3,
      })
      .setOrigin(0.5);
    container.add([track, ghost, fill, hpLabel, value]);

    const bar = (g: Phaser.GameObjects.Graphics, hp: number, color: number, alpha: number): void => {
      g.clear();
      const bw = barW * Phaser.Math.Clamp(hp / fighter.maxHp, 0, 1);
      if (bw <= 0) return;
      g.fillStyle(color, alpha);
      g.fillRoundedRect(pad, y, bw, h, Math.min(7, bw / 2));
    };
    const draw = (hp: number, ghostHp: number): void => {
      bar(ghost, ghostHp, 0xffffff, 0.35);
      bar(fill, hp, hpColor(hp / fighter.maxHp), 1);
      value.setText(`${Math.ceil(hp)} / ${fighter.maxHp}`);
    };

    let shown = this.shownHp?.[key] ?? fighter.hp;
    draw(shown, shown);

    return (next: number): void => {
      if (this.shownHp) this.shownHp[key] = next;
      const state = { hp: shown, ghost: shown };
      shown = next;
      const update = (): void => {
        if (fill.active) draw(state.hp, state.ghost);
      };
      this.tweens.add({ targets: state, hp: next, duration: 350, ease: "Cubic.easeOut", onUpdate: update });
      this.tweens.add({ targets: state, ghost: next, delay: 400, duration: 450, onUpdate: update });
    };
  }

  // DEF / MR / ER / UR, each with its change from the class's base value
  // (synergies, buffs and debuffs) as a green/red arrow.
  drawStatChips(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): void {
    const pad = STRIP_PAD;
    const barW = w - pad * 2;
    const y = 54;
    const h = 32;
    const gap = 8;
    const cw = (barW - gap * (STAT_CHIPS.length - 1)) / STAT_CHIPS.length;
    const stats = computeCurrentStats(fighter);
    const base = fighter.classDef.baseStats;

    // Active guards by the stat they back up (a physical guard sits on DEF).
    const guardByStat: Partial<Record<StatKey, DefendCard>> = {};
    for (const [type, { card }] of Object.entries(fighter.activeDefends)) {
      const statKey = (RESIST_STAT as Partial<Record<string, StatKey>>)[type];
      if (statKey) guardByStat[statKey] = card as DefendCard;
    }

    STAT_CHIPS.forEach((chip, i) => {
      const x = pad + i * (cw + gap);
      const delta = stats[chip.key] - (base[chip.key] ?? 0);
      const guard = guardByStat[chip.key];
      const g = this.add.graphics();
      g.fillStyle(guard ? 0x16384d : COLORS.meterTrack, 1);
      g.fillRoundedRect(x, y, cw, h, 7);
      g.fillStyle(chip.color, 1);
      g.fillRoundedRect(x, y, 4, h, { tl: 7, bl: 7, tr: 0, br: 0 });
      const outline = guard ? GUARD_COLOR : delta > 0 ? 0x6be39a : delta < 0 ? 0xff6b5f : null;
      if (outline !== null) {
        g.lineStyle(2, outline, 1);
        g.strokeRoundedRect(x + 1, y + 1, cw - 2, h - 2, 7);
      }
      container.add(g);

      if (guard) {
        container.add(
          this.add
            .text(x + cw - 7, y + 4, `🛡${guardAmount(guard)}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "10px",
              fontStyle: "800",
              color: "#8fd3ff",
            })
            .setOrigin(1, 0)
        );
      }

      container.add(
        this.add.text(x + 10, y + 3, chip.label, { fontFamily: FONT_FAMILY, fontSize: "9px", fontStyle: "700", color: TEXT.muted })
      );
      container.add(
        this.add.text(x + 10, y + 13, fmt(stats[chip.key]), {
          fontFamily: FONT_FAMILY,
          fontSize: "16px",
          fontStyle: "800",
          color: delta > 0 ? "#6be39a" : delta < 0 ? "#ff6b5f" : TEXT.white,
        })
      );

      if (delta !== 0) {
        container.add(
          this.add
            .text(x + cw - 6, y + h - 5, `${delta > 0 ? "▲" : "▼"}${fmt(Math.abs(delta))}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "11px",
              fontStyle: "700",
              color: delta > 0 ? "#6be39a" : "#ff6b5f",
            })
            .setOrigin(1, 1)
        );
      }
    });
  }

  // One row of chips: synergy progress, active defends, temporary
  // buffs/debuffs and disabled synergies, each with turns remaining.
  // Shares the strip's bottom row with the ultimate meter (see maxX).
  drawEffectChips(container: Phaser.GameObjects.Container, fighter: Fighter, w: number, y: number, maxX: number): void {
    const chips: Array<{ text: string; color: number }> = [];

    for (const synergy of fighter.classDef.synergyPool) {
      const count = fighter.cardsPlayedByCategory[synergy.countsCategory] ?? 0;
      const disabledFor = fighter.disabledSynergyTimers[synergy.id];
      if (disabledFor) {
        chips.push({ text: `${shortName(synergy.name)} off · ${disabledFor}t`, color: CHIP_COLOR.down });
        continue;
      }
      const reached = synergy.tiers.filter((t) => count >= t.count).length;
      const next = synergy.tiers.find((t) => count < t.count);
      const progress = next ? `${count}/${next.count}` : "max";
      chips.push({
        text: `${shortName(synergy.name)} ${reached > 0 ? `T${reached} ` : ""}${progress}`,
        color: reached > 0 ? CHIP_COLOR.synergyActive : CHIP_COLOR.synergy,
      });
    }

    for (const [type, { card, remaining }] of Object.entries(fighter.activeDefends)) {
      const defend = card as DefendCard;
      const amount = defend.mode === MODIFIER_MODE.PERCENT ? `${defend.amount * 100}%` : defend.amount;
      chips.push({ text: `Guard ${type} −${amount} · ${remaining}t`, color: CHIP_COLOR.guard });
    }

    for (const { effect, remaining } of fighter.tempModifiers) {
      const positive =
        effect.kind === EFFECT_KIND.ENERGY_REGEN ||
        (effect.kind !== EFFECT_KIND.SYNERGY_DISABLE &&
          effect.kind !== EFFECT_KIND.SUMMON &&
          effect.kind !== EFFECT_KIND.CONDITIONAL &&
          effect.amount >= 0);
      chips.push({ text: `${describeEffect(effect)} · ${remaining}t`, color: positive ? CHIP_COLOR.up : CHIP_COLOR.down });
    }

    const h = 18;
    let x = STRIP_PAD;
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      if (!chip) break;
      const text = this.add
        .text(0, y + h / 2, chip.text, { fontFamily: FONT_FAMILY, fontSize: "10px", fontStyle: "600", color: TEXT.white })
        .setOrigin(0, 0.5);
      const w = text.width + 14;
      const moreW = 34;
      if (x + w > maxX - (i < chips.length - 1 ? moreW : 0)) {
        text.destroy();
        container.add(
          this.add
            .text(x, y + h / 2, `+${chips.length - i}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
            .setOrigin(0, 0.5)
        );
        break;
      }
      const bg = this.add.graphics();
      bg.fillStyle(chip.color, 1);
      bg.fillRoundedRect(x, y, w, h, h / 2);
      text.setX(x + 7);
      container.add([bg, text]);
      x += w + 6;
    }
  }

  drawUltimateMeter(container: Phaser.GameObjects.Container, fighter: Fighter, x0: number, y: number, w: number): void {
    const cost = fighter.classDef.ultimate.cost;
    const ready = canUseUltimate(fighter);
    let barX = x0;
    if (this.textures.exists(ULTIMATE_ICON_KEY)) {
      container.add(this.add.image(x0 + 7, y, ULTIMATE_ICON_KEY).setDisplaySize(16, 16));
      barX = x0 + 22;
    }
    const barW = w - (barX - x0) - 64;
    const g = this.add.graphics();
    g.fillStyle(COLORS.meterTrack, 1);
    g.fillRoundedRect(barX, y - 5, barW, 10, 5);
    const bw = barW * Math.min(1, fighter.ultimateMeter / cost);
    if (bw > 0) {
      g.fillStyle(ready ? COLORS.ultimateHover : COLORS.meterFill, 1);
      g.fillRoundedRect(barX, y - 5, bw, 10, Math.min(5, bw / 2));
    }
    container.add(g);

    const label = this.add
      .text(x0 + w - 8, y, ready ? "READY!" : `${fmt(fighter.ultimateMeter)}/${cost}`, {
        fontFamily: FONT_FAMILY,
        fontSize: ready ? "12px" : "11px",
        fontStyle: "800",
        color: ready ? "#ffd23f" : TEXT.muted,
      })
      .setOrigin(1, 0.5);
    container.add(label);
    if (ready) {
      this.tweens.add({ targets: label, alpha: 0.4, duration: 600, yoyo: true, repeat: -1 });
      label.once("destroy", () => this.tweens.killTweensOf(label));
    }
  }

  renderHand(locked: boolean): void {
    // A rebuild invalidates any glide-back target: kill it first so a dead
    // container can never drive (or double-fire) a render.
    this.dismissTween?.stop();
    this.dismissTween = null;
    this.handContainer.removeAll(true);
    const cards = this.battle.player.hand;
    const step = CARD_W - FAN_OVERLAP;
    const totalW = cards.length * CARD_W - Math.max(0, cards.length - 1) * FAN_OVERLAP;
    const x0 = GAME_WIDTH / 2 - totalW / 2;

    // Previewed card renders last so it floats above the fan.
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i] as Card;
      if (card.id === this.previewedCardId) continue;
      this.drawHandCard(card, x0 + i * step, false, locked);
    }
    const pi = cards.findIndex((c) => c.id === this.previewedCardId);
    if (pi !== -1) this.drawHandCard(cards[pi] as Card, x0 + pi * step, true, locked);
  }

  drawHandCard(card: Card, x: number, previewed: boolean, locked: boolean): void {
    const { container: cardContainer, bg } = drawCardFace(
      this,
      {
        cardId: card.cardId,
        category: card.category,
        name: card.name,
        damageType: "damageType" in card ? card.damageType : null,
        description: describeCard(card),
      },
      CARD_W,
      CARD_H
    );
    if (previewed) {
      const ring = this.add.graphics();
      ring.lineStyle(3, PREVIEW_RING, 1);
      ring.strokeRoundedRect(-6, -6, CARD_W + 12, CARD_H + 12, 14);
      cardContainer.add(ring);
      const popX = x - (CARD_W * (POP_SCALE - 1)) / 2;
      this.previewedView = cardContainer;
      this.previewedSlotX = x;
      if (this.animatePreview) {
        // Spring into place from the slot (selection moment only); every
        // other rebuild lands instantly so the pop never replays.
        this.animatePreview = false;
        cardContainer.setPosition(x, 0).setScale(1);
        this.tweens.add({
          targets: cardContainer,
          x: popX,
          y: -POP_LIFT,
          scale: POP_SCALE,
          duration: 140,
          ease: "Back.easeOut",
        });
      } else {
        cardContainer.setPosition(popX, -POP_LIFT).setScale(POP_SCALE);
      }
    } else {
      cardContainer.setPosition(x, 0);
    }

    if (!locked) {
      bg.on("pointerover", (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasTouch || this.previewedCardId === card.id) return;
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({ targets: cardContainer, y: -HOVER_LIFT, duration: 100 });
      });
      bg.on("pointerout", () => {
        if (this.previewedCardId === card.id) return; // keep the pop
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({ targets: cardContainer, y: 0, duration: 100 });
      });
      bg.on("pointerdown", () => {
        if (this.previewedCardId === card.id) {
          this.onCardClick(card.id); // second click commits
          return;
        }
        this.previewedCardId = card.id;
        this.animatePreview = true;
        this.render();
      });
    } else {
      cardContainer.setAlpha(0.5);
      bg.disableInteractive();
    }

    this.handContainer.add(cardContainer);
  }

  // Middle arena slots holding each side's last resolved card. Fed solely by
  // post-resolution lastAction -- vacant pre-first-commit -- so the CPU slot
  // can never leak a face before reveal.
  // Face-down back for the CPU slot: the pending round exists, but the move
  // must stay hidden until the recap's flip reveal.
  drawCardBack(): Phaser.GameObjects.Container {
    const container = this.add.container(0, 0);
    const g = this.add.graphics();
    g.fillStyle(0x1b1f2c, 1);
    g.fillRoundedRect(0, 0, CARD_W, CARD_H, 10);
    g.lineStyle(3, 0xc49b3a, 1);
    g.strokeRoundedRect(0, 0, CARD_W, CARD_H, 10);
    const q = this.add
      .text(CARD_W / 2, CARD_H / 2, "?", {
        fontFamily: FONT_FAMILY,
        fontSize: "40px",
        fontStyle: "800",
        color: "#c49b3a",
      })
      .setOrigin(0.5);
    container.add([g, q]);
    return container;
  }

  // Arena slots show the in-flight round only: the committed player face (or
  // nothing pre-landing... the flight clone covers the gap), the CPU back
  // until the recap flips it, and vacant frames otherwise. lastAction faces
  // are NOT drawn here -- the recap performs from these live objects instead
  // of minting duplicates, then they fade and the slots empty again.
  drawSlots(): void {
    this.slotsContainer.removeAll(true);
    const pending = this.pendingPlay;
    const sides: Array<{ key: "player" | "cpu"; fighter: Fighter; x: number }> = [
      { key: "cpu", fighter: this.battle.cpu, x: GAME_WIDTH / 2 - SLOT_TOTAL_W / 2 },
      { key: "player", fighter: this.battle.player, x: GAME_WIDTH / 2 + SLOT_TOTAL_W / 2 - SLOT_W },
    ];
    for (const { key, fighter, x } of sides) {
      const frame = this.add.graphics();
      frame.lineStyle(2, 0x4a5573, 1);
      frame.strokeRoundedRect(x, SLOT_Y, SLOT_W, SLOT_H, 10);
      this.slotsContainer.add(frame);
      const fx = x + (SLOT_W - CARD_W) / 2;
      const fy = SLOT_Y + (SLOT_H - CARD_H) / 2;

      let card: Phaser.GameObjects.Container | null = null;
      let isBack = false;
      if (key === "player" && pending?.playerCard) {
        const played = pending.playerCard;
        const { container } = drawCardFace(
          this,
          {
            cardId: played.cardId,
            category: played.category,
            name: played.name,
            damageType: "damageType" in played ? played.damageType : null,
            description: describeCard(played),
          },
          CARD_W,
          CARD_H
        );
        container.setPosition(fx, fy);
        this.slotsContainer.add(container);
        card = container;
      } else if (key === "cpu" && pending) {
        const last = fighter.lastAction;
        if (last && last.round === pending.round && pending.cpuRevealed && last.kind !== "none") {
          const face =
            last.kind === "ultimate"
              ? {
                  category: "ultimate",
                  name: ultimateName(fighter.classDef),
                  description: `${fmt(last.damage ?? 0)} damage`,
                }
              : { ...last, category: last.category ?? "" };
          const { container } = drawCardFace(this, face, CARD_W, CARD_H);
          container.setPosition(fx, fy);
          this.slotsContainer.add(container);
          card = container;
        } else {
          const back = this.drawCardBack();
          back.setPosition(fx, fy);
          this.slotsContainer.add(back);
          card = back;
          isBack = true;
        }
      } else {
        const hint = this.add
          .text(x + SLOT_W / 2, SLOT_Y + SLOT_H / 2, "—", {
            fontFamily: FONT_FAMILY,
            fontSize: "12px",
            color: TEXT.muted,
          })
          .setOrigin(0.5);
        this.slotsContainer.add(hint);
      }
      this.slotViews[key] = { card, isBack };
    }
  }

  renderLog(): void {
    this.logContainer.removeAll(true);

    // Measure every entry offscreen first: at 192px wide each line wraps to
    // a different height, so entries advance by measured height, never a
    // fixed step (which piled wrapped lines onto each other).
    const style = {
      fontFamily: FONT_FAMILY,
      fontSize: "12px",
      color: TEXT.body,
      wordWrap: { width: LOG_W - 20 },
    };
    const heights: number[] = [];
    let totalH = 0;
    for (const line of this.battle.log) {
      const probe = this.add.text(0, 0, line, style);
      const h = probe.height;
      probe.destroy();
      heights.push(h);
      totalH += h + LOG_ENTRY_GAP;
    }
    if (heights.length > 0) totalH -= LOG_ENTRY_GAP;
    this.logTotalHeight = totalH;

    this.logMaxScrollIndex = Math.max(0, totalH - LOG_H);
    this.logScrollIndex = Phaser.Math.Clamp(this.logScrollIndex, 0, this.logMaxScrollIndex);

    let y = -this.logScrollIndex;
    for (let i = 0; i < this.battle.log.length; i++) {
      const h = heights[i] as number;
      if (y + h >= 0 && y <= LOG_H) {
        this.logContainer.add(this.add.text(0, y, this.battle.log[i] as string, style));
      }
      y += h + LOG_ENTRY_GAP;
    }

    this.updateLogScrollbar();
  }
}
