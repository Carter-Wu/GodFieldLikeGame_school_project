// Guided practice match: a vs-CPU battle against a Training Dummy where the
// hands and the dummy's turns are scripted, and a coach panel (over the
// battle log column) says what to do next and highlights where to click.
// Clicks that don't fit the current step are refused with a nudge, so every
// lesson happens in order: playing a card, AP, End turn, resistances,
// defending, monsters and their orders, targets, statuses, the ultimate.
//
// Each scripted round is a list of steps. "Info" steps wait for Next; the
// others are done when the turn being planned satisfies them (a card picked,
// a monster ordered), so taking a card back simply steps the coach back.
// Once the script runs out (or if the dummy somehow survives it) the match
// carries on as a normal vs-CPU game.

import Phaser from "phaser";
import { BattleScene, LAYOUT, type BattleSceneData, type ResultAction } from "./BattleScene.ts";
import {
  createBattle,
  isBattleOver,
  passAction,
  planAction,
  resolveRound,
  setRandomSource,
  type Action,
  type Battle,
  type MonsterOrder,
  type Target,
} from "../model/engine.ts";
import { buildCatalog, findCardById, type Catalog } from "../model/catalog.ts";
import { LOCAL_CATALOG_ROWS } from "../model/catalogData.ts";
import { createCardInstance, type Card } from "../model/cardTypes.ts";
import type { ClassDef } from "../model/classes.ts";
import { COLORS, FONT_DISPLAY, FONT_FAMILY, FONT_NUM, GOLD, GOLD_CSS, UI_COLORS, createButton, textShadow } from "./theme.ts";

const PLAYER_CLASS = "pyromancer";
const DUMMY_LABEL = "Training Dummy";
// Soft on purpose: the scripted rounds bring it down by round 5.
const DUMMY_STATS = { hp: 30, def: 1, mr: 1, er: 1 };

// Cards that sit in the hand without being part of the lesson.
const FILLER = ["stoke_the_flame", "scorch", "fireball"];

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

type Allow =
  | { kind: "card"; cardId: string; target?: Target["kind"] }
  | { kind: "order"; use: MonsterOrder["use"]; target?: Target["kind"] }
  | { kind: "ultimate" }
  | { kind: "endTurn" };

interface Step {
  id: string;
  title: string;
  text: (s: TutorialBattleScene) => string;
  info?: boolean; // waits for Next
  done?: (s: TutorialBattleScene) => boolean;
  allow?: Allow;
  focus?: (s: TutorialBattleScene) => Rect | null;
}

interface ScriptedRound {
  hand: string[]; // the player's hand this round
  cpu: (s: TutorialBattleScene) => Action;
  steps: Step[];
}

// --- step helpers ------------------------------------------------------------

const stagedCount = (s: TutorialBattleScene, cardId: string): number => s.staged.filter((c) => c.cardId === cardId).length;
const previewing = (s: TutorialBattleScene, cardId: string): boolean =>
  s.battle.player.hand.find((c) => c.id === s.previewedCardId)?.cardId === cardId;
const aiming = (s: TutorialBattleScene): boolean => s.targeting !== null;
const hasOrder = (s: TutorialBattleScene, use: MonsterOrder["use"]): boolean => s.orders.some((o) => o.use === use);

// "Click X" until it's open in the middle, then "click it again".
function pickCardText(cardName: string, intro: string, extra = ""): (s: TutorialBattleScene) => string {
  return (s) => {
    const id = s.battle.player.hand.find((c) => c.name === cardName)?.cardId ?? "";
    if (previewing(s, id)) return `Click ${cardName} again to play it.${extra ? ` ${extra}` : ""}\n\nThe blue gem in its corner is its AP cost.`;
    return `${intro}\n\nClick ${cardName} in your hand to look at it.`;
  };
}

const focusHandCard = (cardId: string) => (s: TutorialBattleScene): Rect | null =>
  previewing(s, cardId) ? null : s.handCardRect(cardId);
const focusApPanel = (): Rect => {
  const { x, y, w, h } = LAYOUT.apPanel;
  return { x, y, w, h };
};
const focusEndTurn = (): Rect => {
  const { x, y, w, h } = LAYOUT.endTurn;
  return { x, y, w, h };
};
const endTurnStep = (id: string, text: string): Step => ({
  id,
  title: "End your turn",
  text: () => text,
  allow: { kind: "endTurn" },
  focus: focusEndTurn,
});

// One side's scripted turn: these hand cards (by catalog id), aimed at the
// opponent's fighter, plus monster orders.
function cpuTurn(s: TutorialBattleScene, cardIds: string[], orders: MonsterOrder[] = []): Action {
  const cpu = s.battle.cpu;
  const ids: number[] = [];
  const targets: Record<number, Target> = {};
  for (const cardId of cardIds) {
    const card = cpu.hand.find((c) => c.cardId === cardId && !ids.includes(c.id));
    if (!card) continue;
    ids.push(card.id);
    targets[card.id] = { kind: "fighter" };
  }
  return planAction(cpu, ids, false, { targets, orders, opponent: s.battle.player }) ?? passAction();
}

const SCRIPT: ScriptedRound[] = [
  // Round 1 (2 AP): the board, playing a card, AP, End turn.
  {
    hand: ["ember_dart", "fire_lance", "heat_shroud", ...FILLER],
    cpu: (s) => cpuTurn(s, ["ember_dart"]),
    steps: [
      {
        id: "welcome",
        title: "Welcome!",
        info: true,
        text: () =>
          `This practice match walks you through a real battle against a ${DUMMY_LABEL}.\n\n` +
          "Bring its HP to 0 to win. Each step here tells you what to do next.",
      },
      {
        id: "you",
        title: "This is you",
        info: true,
        text: (s) =>
          `You're playing ${s.playerClassName}. Your strip shows your HP, AP and stats (click a stat to read about it).\n\n` +
          "Your class badge at the bottom right, above End turn, fills up with your ultimate meter.",
        focus: () => LAYOUT.playerStrip,
      },
      {
        id: "dummy",
        title: "Your opponent",
        info: true,
        text: () =>
          `The ${DUMMY_LABEL} is at the top. Every round you both plan a turn at the same time, ` +
          "without seeing each other's picks, and then both turns play out together.",
        focus: () => LAYOUT.cpuStrip,
      },
      {
        id: "play-dart",
        title: "Play a card",
        text: pickCardText("Ember Dart", "Your hand is along the bottom. Ember Dart is a 1 AP fire attack."),
        allow: { kind: "card", cardId: "ember_dart" },
        done: (s) => stagedCount(s, "ember_dart") >= 1,
        focus: focusHandCard("ember_dart"),
      },
      {
        id: "ap",
        title: "AP",
        info: true,
        text: () =>
          "Cards cost AP. The crystals above End turn show yours: 2 this round, and Ember Dart has reserved 1 (the dashed gold one).\n\n" +
          "Max AP goes up by 1 every round (up to 10). AP you don't spend is lost when the turn ends.",
        focus: focusApPanel,
      },
      endTurnStep("end-1", "Press End turn to lock in your turn. Then watch the replay of both turns."),
    ],
  },
  // Round 2 (3 AP): resistances, defending, several cards in one turn.
  {
    hand: ["heat_shroud", "ember_dart", "ember_dart", ...FILLER],
    cpu: (s) => cpuTurn(s, ["fire_lance"]),
    steps: [
      {
        id: "resist",
        title: "Damage and resistances",
        info: true,
        text: () =>
          "Both darts landed. Damage is lowered by the matching resistance:\n\n" +
          "• Physical by DEF\n• Magic by MR\n• Element (fire, water, electric) by ER\n• True damage ignores them\n\n" +
          "The dummy has hardly any ER, so your fire hits it hard.",
        focus: () => LAYOUT.cpuStrip,
      },
      {
        id: "telegraph",
        title: "Defend cards",
        info: true,
        text: () =>
          "The dummy is winding up a big Fire Lance this round.\n\n" +
          "A defend card blocks one damage type. Turns happen at the same time, so a defend you play now " +
          "already blocks an attack made this round.",
      },
      {
        id: "shroud",
        title: "Block the fire",
        text: pickCardText("Heat Shroud", "Heat Shroud blocks element damage."),
        allow: { kind: "card", cardId: "heat_shroud" },
        done: (s) => stagedCount(s, "heat_shroud") >= 1,
        focus: focusHandCard("heat_shroud"),
      },
      {
        id: "darts",
        title: "Play more cards",
        text: (s) =>
          previewing(s, "ember_dart")
            ? "Click Ember Dart again to play it."
            : `You have 3 AP this round, so you can play several cards in one turn. Add ${
                stagedCount(s, "ember_dart") === 0 ? "both Ember Darts" : "the other Ember Dart"
              }.`,
        allow: { kind: "card", cardId: "ember_dart" },
        done: (s) => stagedCount(s, "ember_dart") >= 2,
        focus: focusHandCard("ember_dart"),
      },
      endTurnStep("end-2", "That's all 3 AP. Press End turn."),
    ],
  },
  // Round 3 (4 AP): summoning a monster.
  {
    hand: ["flame_imp", "ember_dart", "heat_shroud", ...FILLER],
    cpu: (s) => cpuTurn(s, ["flame_imp", "ember_dart"]),
    steps: [
      {
        id: "blocked",
        title: "Blocked!",
        info: true,
        text: () =>
          "Heat Shroud soaked up the Fire Lance, and your ER handled the rest.\n\n" +
          "A defend card only stops its own damage type, so match it to what's coming.",
      },
      {
        id: "imp",
        title: "Monsters",
        text: pickCardText("Flame Imp", "Monster cards summon a monster onto your field (up to 3)."),
        allow: { kind: "card", cardId: "flame_imp" },
        done: (s) => stagedCount(s, "flame_imp") >= 1,
        focus: focusHandCard("flame_imp"),
      },
      {
        id: "dart-3",
        title: "Spend the rest",
        text: pickCardText("Ember Dart", "One AP left: add an Ember Dart."),
        allow: { kind: "card", cardId: "ember_dart" },
        done: (s) => stagedCount(s, "ember_dart") >= 1,
        focus: focusHandCard("ember_dart"),
      },
      endTurnStep("end-3", "Press End turn."),
    ],
  },
  // Round 4 (5 AP): targets, monster orders, statuses.
  {
    hand: ["fire_lance", "ember_dart", "heat_shroud", ...FILLER],
    cpu: (s) => {
      const imp = s.battle.cpu.field[0];
      return cpuTurn(s, ["ember_dart"], imp ? [{ uid: imp.uid, use: "attack", target: { kind: "fighter" } }] : []);
    },
    steps: [
      {
        id: "fields",
        title: "Monsters on the field",
        info: true,
        text: () =>
          "You both have a Flame Imp now. A monster can't act the round it arrives. From the next round on, " +
          "you give it an order each turn, paid with AP.",
        focus: (s) => s.monsterRect("player", 0),
      },
      {
        id: "lance",
        title: "Pick a target",
        text: (s) => {
          if (aiming(s) && s.targeting?.kind === "card")
            return "Click the dummy's Flame Imp.\n\nAttack cards hit before monsters act, so it won't get to attack you.";
          if (previewing(s, "fire_lance")) return "Click Fire Lance again, then pick its target.";
          return "Attacks can hit the enemy fighter or one of their monsters.\n\nClick Fire Lance, then aim it at the dummy's Flame Imp.";
        },
        allow: { kind: "card", cardId: "fire_lance", target: "monster" },
        done: (s) => stagedCount(s, "fire_lance") >= 1,
        focus: (s) => (aiming(s) ? s.monsterRect("cpu", 0) : focusHandCard("fire_lance")(s)),
      },
      {
        id: "breath",
        title: "Give an order",
        text: (s) => {
          if (s.targeting?.kind === "order") return `Aim it at the ${DUMMY_LABEL}.`;
          if (s.monsterMenuUid !== null)
            return "Choose Fire Breath. It deals fire damage and sets the target Burning.";
          return "Now click your Flame Imp to give it an order.";
        },
        allow: { kind: "order", use: "ability", target: "fighter" },
        done: (s) => hasOrder(s, "ability"),
        focus: (s) => {
          if (s.targeting?.kind === "order") return LAYOUT.cpuStrip;
          return s.monsterMenuUid === null ? s.monsterRect("player", 0) : null;
        },
      },
      {
        id: "guard",
        title: "Guard monsters",
        info: true,
        text: () =>
          "Good to know: some monsters are guards (blue frame). While one is on the field, attacks have to hit it first.",
      },
      endTurnStep("end-4", "Press End turn.\n\nYour ultimate is already charged (the glowing badge). Save it for next round."),
    ],
  },
  // Round 5 (6 AP): statuses, synergy, the ultimate.
  {
    hand: ["ember_dart", "fire_lance", "heat_shroud", ...FILLER],
    cpu: (s) => cpuTurn(s, ["ember_dart"]),
    steps: [
      {
        id: "burn",
        title: "Statuses",
        info: true,
        text: () =>
          "The dummy is Burning: it takes damage at the end of every round for a while.\n\n" +
          "Others: Poison (also damage each round), Wet, Acid, Slow and Blind. Click a status on a strip to see what it does.",
        focus: () => LAYOUT.cpuStrip,
      },
      {
        id: "synergy",
        title: "Synergy",
        info: true,
        text: (s) => {
          const synergy = s.battle.player.classDef.synergyPool[0];
          const name = synergy ? synergy.name.replace(/\s*\(.*\)\s*$/, "") : "Your synergy";
          return `${name}: your class gets stronger the more you play the card type it rewards${
            synergy?.description ? `.\n\n${synergy.description}` : "."
          }`;
        },
        focus: () => LAYOUT.playerStrip,
      },
      {
        id: "ult",
        title: "Ultimate",
        text: () =>
          "Your ultimate is charged! The meter around your class badge fills every round.\n\n" +
          "Click your class badge to add your ultimate to this turn. It doesn't cost AP.",
        allow: { kind: "ultimate" },
        done: (s) => s.stagedUltimate,
        focus: () => LAYOUT.classBadge,
      },
      {
        id: "imp-attack",
        title: "Attack order",
        text: (s) => {
          if (s.targeting?.kind === "order") return `Aim it at the ${DUMMY_LABEL}.`;
          if (s.monsterMenuUid !== null) return "Choose Attack.";
          return "Click your Flame Imp and give it an Attack order too.";
        },
        allow: { kind: "order", use: "attack", target: "fighter" },
        done: (s) => hasOrder(s, "attack"),
        focus: (s) => {
          if (s.targeting?.kind === "order") return LAYOUT.cpuStrip;
          return s.monsterMenuUid === null ? s.monsterRect("player", 0) : null;
        },
      },
      endTurnStep("end-5", "Finish it! Press End turn."),
    ],
  },
];

const TOTAL_STEPS = SCRIPT.reduce((n, r) => n + r.steps.length, 0);

// The tutorial plays from the built-in card data, so its AP math and damage
// stay right whatever the live catalog's numbers are.
let localCatalog: Catalog | null = null;
const local = (): Catalog => (localCatalog ??= buildCatalog(LOCAL_CATALOG_ROWS, "local"));

function cardInstance(cardId: string): Card {
  const entry = local().cards.get(cardId);
  if (!entry) throw new Error(`Tutorial card "${cardId}" is missing from the local catalog`);
  return createCardInstance({ ...entry, imageUrl: findCardById(cardId)?.imageUrl ?? null });
}

// A small seeded PRNG, so priority dice in the tutorial always roll the same.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class TutorialBattleScene extends BattleScene {
  acked = new Set<string>();
  handCardX = new Map<number, number>(); // hand card id -> x of its face this render
  coachLayer: Phaser.GameObjects.Container | null = null;
  highlight: Phaser.GameObjects.Graphics | null = null;
  coachFlash: Phaser.GameObjects.Graphics | null = null;

  constructor() {
    super("TutorialBattleScene");
  }

  get opponentLabel(): string {
    return DUMMY_LABEL;
  }

  get leaveLabel(): string {
    return "Leave Tutorial";
  }

  get playerClassName(): string {
    return this.battle.player.classDef.name.replace(/\s*\(.*\)\s*$/, "");
  }

  setupBattle(_data: BattleSceneData): Battle {
    void _data;
    const playerClass = local().classById.get(PLAYER_CLASS) as ClassDef;
    const dummyClass: ClassDef = {
      ...playerClass,
      name: DUMMY_LABEL,
      baseStats: { ...playerClass.baseStats, ...DUMMY_STATS },
    };
    const deck = (): Card[] => (local().deckByClass.get(PLAYER_CLASS) ?? []).flatMap(({ card, copies }) =>
      Array.from({ length: copies }, () => createCardInstance({ ...card, imageUrl: findCardById(card.id)?.imageUrl ?? null }))
    );
    const battle = createBattle(playerClass, dummyClass, { cpuLabel: DUMMY_LABEL, playerDeck: deck(), cpuDeck: deck() });
    this.battle = battle;
    this.dealRound();
    return battle;
  }

  scripted(): ScriptedRound | null {
    return SCRIPT[this.battle.round - 1] ?? null;
  }

  // Lay out this round's scripted hands (both sides) and keep the dummy's
  // ultimate from ever firing.
  dealRound(): void {
    const round = this.scripted();
    if (!round || isBattleOver(this.battle)) return;
    const { player, cpu } = this.battle;
    player.hand = round.hand.map(cardInstance);
    cpu.hand = ["ember_dart", "ember_dart", "fire_lance", "flame_imp", "heat_shroud", "scorch"].map(cardInstance);
    cpu.ultimateMeter = 0;
  }

  create(data: BattleSceneData): void {
    this.acked = new Set();
    this.coachLayer = null;
    setRandomSource(seeded(416));
    this.events.once("shutdown", () => setRandomSource(null));
    super.create(data);

    // The coach takes over the battle log's column.
    this.logHidden = true;
    this.logPanel.x = LAYOUT.logHideDx;
    this.coachLayer = this.add.container(0, 0).setDepth(940);
    this.highlight = this.add.graphics().setDepth(945);
    this.tweens.add({ targets: this.highlight, alpha: 0.4, duration: 750, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    this.render();
  }

  // No turn timer in the tutorial: take as long as you like.
  onTurnTick(): void {
    if (this.statusText?.active) this.setStatus(this.statusMessage());
  }

  commitAction(action: Action): void {
    const round = this.scripted();
    if (!round) return super.commitAction(action);
    this.clearPlanning();
    this.pendingTurn = { cards: action.cards, ultimate: action.ultimate, round: this.battle.round };
    const before = this.currentHp();
    resolveRound(this.battle, action, round.cpu(this));
    this.dealRound();
    void this.presentRound(before);
  }

  // --- the coach -------------------------------------------------------------

  currentStep(): Step | null {
    const round = this.scripted();
    if (!round) return null;
    return round.steps.find((step) => (step.info ? !this.acked.has(step.id) : !step.done?.(this))) ?? null;
  }

  stepNumber(step: Step): number {
    let n = 0;
    for (const round of SCRIPT) {
      for (const s of round.steps) {
        n++;
        if (s === step) return n;
      }
    }
    return n;
  }

  // Whether a click fits the current step; otherwise nudge and refuse.
  permits(check: (allow: Allow | undefined) => boolean): boolean {
    if (!this.scripted()) return true;
    const step = this.currentStep();
    if (step && check(step.info ? undefined : step.allow)) return true;
    this.nudge();
    return false;
  }

  nudge(): void {
    const flash = this.coachFlash;
    if (!flash) return;
    this.tweens.killTweensOf(flash);
    flash.setAlpha(1);
    this.tweens.add({ targets: flash, alpha: 0, duration: 700, ease: "Cubic.easeIn" });
  }

  handCardRect(cardId: string): Rect | null {
    const card = this.battle.player.hand.find((c) => c.cardId === cardId && !this.staged.includes(c) && this.handCardX.has(c.id));
    if (!card) return null;
    return { x: this.handCardX.get(card.id) as number, y: LAYOUT.handY, w: LAYOUT.card.w, h: LAYOUT.card.h };
  }

  monsterRect(side: "player" | "cpu", index: number): Rect | null {
    const fighter = side === "player" ? this.battle.player : this.battle.cpu;
    if (!fighter.field[index]) return null;
    const { x, y } = this.monsterPos(side, index);
    return { x, y, w: LAYOUT.monster.w, h: LAYOUT.monster.h };
  }

  handCardPlayable(card: Card, locked: boolean): boolean {
    const allow = this.currentStep()?.allow;
    if (this.scripted() && !(allow?.kind === "card" && allow.cardId === card.cardId)) return false;
    return super.handCardPlayable(card, locked);
  }

  drawHandCard(card: Card, x: number, locked: boolean): void {
    super.drawHandCard(card, x, locked);
    this.handCardX.set(card.id, x);
    // Cards the current step isn't about fade back.
    const allow = this.currentStep()?.allow;
    if (!locked && this.scripted() && !(allow?.kind === "card" && allow.cardId === card.cardId)) {
      const face = this.handContainer.list[this.handContainer.list.length - 1] as Phaser.GameObjects.Container | undefined;
      if (face) this.dimCard(face, 0.55);
    }
  }

  render(): void {
    this.handCardX.clear();
    super.render();
    this.drawCoach();
  }

  drawCoach(): void {
    const layer = this.coachLayer;
    if (!layer || !this.highlight) return;
    layer.removeAll(true);
    this.highlight.clear();

    const { x, y, w, h } = LAYOUT.logBox;
    const pad = 16;
    // The coach box: solid ink with a gold hairline, a soft gold glow that
    // breathes around it and a gold accent across the top, so the eye goes
    // to it between moves.
    const glow = this.add.graphics();
    for (let i = 1; i <= 4; i++) {
      glow.lineStyle(i * 3, GOLD, 0.1 - i * 0.018);
      glow.strokeRoundedRect(x - i, y - i, w + i * 2, h + i * 2, 12 + i);
    }
    layer.add(glow);
    this.tweens.add({ targets: glow, alpha: 0.45, duration: 1400, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    glow.once("destroy", () => this.tweens.killTweensOf(glow));

    const bg = this.add.graphics();
    bg.fillStyle(0x0f1014, 0.97);
    bg.fillRoundedRect(x, y, w, h, 12);
    bg.fillStyle(GOLD, 0.06);
    bg.fillRoundedRect(x, y, w, 64, { tl: 12, tr: 12, bl: 0, br: 0 });
    bg.lineStyle(1.5, GOLD, 0.85);
    bg.strokeRoundedRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5, 12);
    bg.fillStyle(GOLD, 1);
    bg.fillRoundedRect(x + w / 2 - 36, y - 1, 72, 3, 1.5);
    bg.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains);
    layer.add(bg);
    this.coachFlash = this.add.graphics();
    this.coachFlash.lineStyle(4, 0xffd23f, 1);
    this.coachFlash.strokeRoundedRect(x - 2, y - 2, w + 4, h + 4, 14);
    this.coachFlash.setAlpha(0);
    layer.add(this.coachFlash);

    const step = this.scripted() ? this.currentStep() : null;
    let heading: string;
    let title: string;
    let body: string;
    if (isBattleOver(this.battle)) {
      heading = "TUTORIAL";
      title = "Tutorial complete";
      body = "Nice work! You know the basics now.";
    } else if (this.recapPlaying) {
      heading = "TUTORIAL";
      title = "Watch the replay";
      body =
        "Both turns play out now. Faster cards go first; when both sides tie, a die roll decides.\n\n" +
        "The replay speed button is at the top left.";
    } else if (step) {
      heading = `TUTORIAL · STEP ${this.stepNumber(step)} OF ${TOTAL_STEPS}`;
      title = step.title;
      body = step.text(this);
    } else {
      heading = "TUTORIAL";
      title = "You're on your own";
      body = `Play cards and press End turn until the ${DUMMY_LABEL} is down.`;
    }

    layer.add(
      this.add
        .text(x + pad, y + pad + 2, heading, { fontFamily: FONT_DISPLAY, fontSize: "11.5px", fontStyle: "700", color: GOLD_CSS })
        .setLetterSpacing(1.4)
    );
    // Step progress, a thin gold bar under the heading.
    if (step) {
      const progress = this.add.graphics();
      const barW = w - pad * 2;
      progress.fillStyle(0xffffff, 0.08);
      progress.fillRoundedRect(x + pad, y + pad + 22, barW, 3, 1.5);
      progress.fillStyle(GOLD, 0.9);
      progress.fillRoundedRect(x + pad, y + pad + 22, Math.max(3, (barW * this.stepNumber(step)) / TOTAL_STEPS), 3, 1.5);
      layer.add(progress);
    }
    const titleText = textShadow(
      this.add.text(x + pad, y + pad + 36, title, {
        fontFamily: FONT_DISPLAY,
        fontSize: "21px",
        fontStyle: "700",
        color: "#f7efdc",
        wordWrap: { width: w - pad * 2 },
      })
    );
    layer.add(titleText);
    const bodyText = this.add.text(x + pad, titleText.y + titleText.height + 12, body, {
      fontFamily: FONT_FAMILY,
      fontSize: "15px",
      fontStyle: "500",
      color: "#eef0f4",
      lineSpacing: 5,
      wordWrap: { width: w - pad * 2 },
    });
    layer.add(bodyText);

    if (step?.info && !this.recapPlaying) {
      const next = createButton(this, x + pad, bodyText.y + bodyText.height + 18, w - pad * 2, 40, "Next →", {
        color: COLORS.ultimate,
        hoverColor: COLORS.ultimateHover,
        onClick: () => {
          this.acked.add(step.id);
          this.render();
        },
      });
      (next.container.getAt(1) as Phaser.GameObjects.Text).setStyle({ fontFamily: FONT_NUM, fontSize: "16px", fontStyle: "700" });
      layer.add(next.container);
    }

    if (!isBattleOver(this.battle)) {
      const skip = createButton(this, x + pad, y + h - pad - 36, w - pad * 2, 36, "Skip tutorial", {
        color: COLORS.restart,
        hoverColor: COLORS.restartHover,
        onClick: () => this.onLeave(),
      });
      layer.add(skip.container);
    }

    // Whatever the step points at gets a soft gold ring that breathes (the
    // tween in create), and End turn lights up gold when it's the move.
    const focus = step && !this.recapPlaying ? step.focus?.(this) : null;
    if (focus) {
      const fx = focus.x - 6;
      const fy = focus.y - 6;
      const fw = focus.w + 12;
      const fh = focus.h + 12;
      this.highlight.lineStyle(10, GOLD, 0.16);
      this.highlight.strokeRoundedRect(fx - 3, fy - 3, fw + 6, fh + 6, 15);
      this.highlight.lineStyle(5, GOLD, 0.35);
      this.highlight.strokeRoundedRect(fx - 1, fy - 1, fw + 2, fh + 2, 13);
      this.highlight.lineStyle(2, 0xf3dca6, 1);
      this.highlight.strokeRoundedRect(fx, fy, fw, fh, 12);
    }
    const endTurnNext = !this.recapPlaying && step?.allow?.kind === "endTurn";
    this.endTurnTitle?.setColor(endTurnNext ? GOLD_CSS : UI_COLORS.ivory);
  }

  // --- gated input -------------------------------------------------------------

  onCardClick(cardId: number): void {
    const card = this.battle.player.hand.find((c) => c.id === cardId);
    if (!this.permits((a) => a?.kind === "card" && a.cardId === card?.cardId)) return;
    super.onCardClick(cardId);
  }

  chooseTarget(target: Target, targeting = this.targeting): void {
    const want = this.currentStep()?.allow;
    const wanted = want && (want.kind === "card" || want.kind === "order") ? want.target : undefined;
    // An automatic pick (no enemy monsters to choose between) always goes through.
    if (this.targeting && wanted && target.kind !== wanted) {
      this.nudge();
      return;
    }
    super.chooseTarget(target, targeting);
  }

  onMonsterClick(monster: Parameters<BattleScene["onMonsterClick"]>[0]): void {
    if (!this.permits((a) => a?.kind === "order")) return;
    super.onMonsterClick(monster);
  }

  giveOrder(monster: Parameters<BattleScene["giveOrder"]>[0], use: MonsterOrder["use"]): void {
    if (!this.permits((a) => a?.kind === "order" && a.use === use)) return;
    super.giveOrder(monster, use);
  }

  onUltimateClick(): void {
    if (!this.permits((a) => a?.kind === "ultimate")) return;
    super.onUltimateClick();
  }

  onEndTurnClick(): void {
    if (!this.permits((a) => a?.kind === "endTurn")) return;
    super.onEndTurnClick();
  }

  // --- end of the match ----------------------------------------------------------

  resultSubtitle(): string {
    if (this.battle.winner === this.battle.player)
      return "Tutorial complete! Pick a class on the home screen and try Play vs CPU or a Random match.";
    return "Not this time, but you've seen how it all works. Try again from the home screen any time.";
  }

  resultActions(): ResultAction[] {
    return [
      { label: "Finish tutorial", color: COLORS.ultimate, hoverColor: COLORS.ultimateHover, onClick: () => this.onLeave() },
      { label: "View board", color: COLORS.restart, hoverColor: COLORS.restartHover, onClick: () => this.hideResult() },
    ];
  }
}
