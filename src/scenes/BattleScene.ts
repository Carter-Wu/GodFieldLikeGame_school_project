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
  checkPlan,
  planAction,
  canPlayCard,
  unplayableReason,
  cardNeedsTarget,
  orderNeedsTarget,
  orderCost,
  targetProblem,
  describeAbility,
  playRound,
  describeEffect,
  isBattleOver,
  fighterName,
  FIELD_SIZE,
  STATUS_LABEL,
  type Action,
  type Battle,
  type Fighter,
  type TurnRecord,
  type Monster,
  type MonsterOrder,
  type Target,
} from "../model/engine.ts";
import { EFFECT_KIND, MODIFIER_MODE, STATUS, type StatusId } from "../model/effects.ts";
import { RESIST_STAT } from "../model/damageTypes.ts";
import type { StatKey } from "../model/stats.ts";
import { cardCost, type Card, type DefendCard } from "../model/cardTypes.ts";
import type { ClassDef } from "../model/classes.ts";
import { allCards, allClasses } from "../model/catalog.ts";
import { preloadIcons, classIconKey, ULTIMATE_ICON_KEY, CARD_ICON_KEY } from "../phaserIcons.ts";
import { loadCardArt, loadedArtKey } from "../cardArt.ts";
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
  createCircleButton,
  textShadow,
  useRenderScale,
  type Button,
} from "./theme.ts";
import { AP_GEM_COLOR, cardFaceData, drawCardFace, type CardFaceData } from "./cardFace.ts";
import { playRoundRecap, setRecapSpeed, type RecapPanel, type RecapSide, type RoundRecapRun } from "./roundRecap.ts";

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

// Left-column portrait for the opponent: identity at a glance (icon + name +
// HP + ultimate). You don't get one: your strip runs the full width from the
// left column instead, with your class badge under its left end.
const PORTRAIT_X = 16;
const PORTRAIT_W = 208;
const PORTRAIT_H = 200;
const CPU_PORTRAIT_Y = 44;
const PLAYER_STRIP_X = PORTRAIT_X;
const PLAYER_STRIP_W = STRIP_X + STRIP_W - PLAYER_STRIP_X;

// Left-column buttons, between the portraits.
const BUTTON_X = 24;
const BUTTON_W = 176;
const BUTTON_H = 40;
const LEAVE_BUTTON_Y = 296;

const HAND_Y = 548;
const CARD_W = 112;
const CARD_H = 160;

// The hand (docs "Card Position"): cards fanned out from the bottom center;
// hover expands a card; a click moves it to the middle of the screen in full
// view (at most a third of the screen tall, with space above and below);
// clicking it again plays it onto your side of the arena, clicking anywhere
// else puts it back.
const FAN_OVERLAP = 44;

// Your class badge, under the player strip and left of the hand: icon + name,
// ringed by a yellow gauge for the ultimate meter. Once it's full the badge
// glows and pulses, and clicking it toggles the ultimate for this turn.
const CLASS_BADGE = { x: PORTRAIT_X, y: HAND_Y, w: PORTRAIT_W, h: CARD_H };
const BADGE_RADIUS = 12;
const ULT_RING_W = 5;
const ULT_RING_LIVE = 0xffd23f;

// The round End turn button, right of the hand, ringed by a yellow gauge:
// one segment per AP this turn, lit = AP left, pulsing = about to be spent
// on the card you're looking at, dark = spent on this turn's picks.
const END_TURN = { x: STRIP_X + STRIP_W - 64, y: HAND_Y + CARD_H / 2, r: 44 };
const END_TURN_RING_R = 53;
const END_TURN_RING_W = 9;
const END_TURN_RING_GAP = 0.06; // radians between segments
const AP_RING_LIVE = 0xffd23f;
const AP_RING_SPENT = 0x3a3220;
const HOVER_LIFT = 14;
const HOVER_SCALE = 1.12;
const PREVIEW_SCALE = 1.45; // 160px card -> 232px, under a third of 720
const PREVIEW_RING = 0xc49b3a;
const STAGE_SCALE = 0.6; // picked cards, shrunk onto the player's slot

// Middle arena slots: the player's holds the cards picked this turn; once
// the turn is sent, the opponent's shows a face-down card until the recap.
const SLOT_W = 150;
const SLOT_H = 190;
const SLOT_Y = 195;
const SLOT_GAP = 20;
const SLOT_TOTAL_W = SLOT_W * 2 + SLOT_GAP;

// Monster fields, flanking the arena slots on the side of their owner's
// slot: the CPU's to the left, the player's to the right.
const FIELD_W = 228;
const FIELD_Y = 206;
const FIELD_H = 176;
const CPU_FIELD_X = STRIP_X;
const PLAYER_FIELD_X = STRIP_X + STRIP_W - FIELD_W;
const MONSTER_W = 72;
const MONSTER_H = 136;
const MONSTER_GAP = (FIELD_W - MONSTER_W * FIELD_SIZE) / (FIELD_SIZE - 1);
const MONSTER_GUARD = 0x6ec6ff;

const STATUS_COLOR: Record<StatusId, number> = {
  [STATUS.BURNING]: 0xc4511d,
  [STATUS.POISON]: 0x4f8a2e,
  [STATUS.WET]: 0x2f6fb0,
  [STATUS.ACID]: 0x8a9a1e,
  [STATUS.SLOWED]: 0x56658a,
  [STATUS.BLIND]: 0x4a4f60,
};

// A turn that's been sent: the slots keep showing it (and a face-down card
// for the opponent) until the round's recap has played.
export interface PendingTurn {
  cards: Card[];
  ultimate: boolean;
  round: number; // battle.round at commit
}

const LOG_X = 1072;
const LOG_Y = 44;
const LOG_W = 192;
const LOG_H = 628;
// Wheel scroll step, px. Entries have variable (word-wrapped) heights, so
// scrolling is a pixel offset, not a line index -- see renderLog.
const LOG_SCROLL_STEP = 60;
// The log's dark backing; the whole panel slides right by its width (plus a
// margin) to hide, leaving just the toggle button in its top-right corner.
const LOG_BOX = { x: LOG_X - 14, y: LOG_Y - 32, w: LOG_W + 28, h: LOG_H + 42 };
const LOG_HIDE_DX = LOG_BOX.w + 16;
const LOG_TOGGLE = { w: 28, h: 22 };
const LOG_ENTRY_GAP = 6;

// The band the round recap covers: status line, arena, player strip and hand.
const RECAP_STAGE = { y: STATUS_Y - 8, h: 400 };

const STAT_CHIPS: Array<{ key: StatKey; label: string; color: number }> = [
  { key: "def", label: "DEF", color: 0xc9c9c9 },
  { key: "mr", label: "MR", color: 0xb388ff },
  { key: "er", label: "ER", color: 0xff9d4d },
  { key: "ur", label: "UR", color: 0xffe066 },
  { key: "atk", label: "ATK", color: 0xff6b5f },
];

// Full names and explanations for the stat chips (hover / click).
const STAT_INFO: Record<StatKey, { label: string; name: string; description: string }> = {
  hp: { label: "HP", name: "Health", description: "How much damage you can take. Drop to 0 and you lose the battle." },
  def: {
    label: "DEF",
    name: "Defense",
    description: "Reduces incoming physical damage. Each hit loses DEF points of damage (after any guard), down to 0.",
  },
  mr: {
    label: "MR",
    name: "Magic Resistance",
    description: "Reduces incoming magic damage. Each hit loses MR points of damage (after any guard), down to 0.",
  },
  er: {
    label: "ER",
    name: "Elemental Resistance",
    description: "Reduces incoming element damage. Each hit loses ER points of damage (after any guard), down to 0.",
  },
  ur: {
    label: "UR",
    name: "Ultimate Recharge",
    description: "How much your ultimate meter fills each round. Higher UR means you can use your ultimate sooner.",
  },
  atk: {
    label: "ATK",
    name: "Attack",
    description: "Bonus damage added to every attack card you play (cards that deal 0 damage don't get it).",
  },
  crit: { label: "CRIT", name: "Critical Chance", description: "The chance for an attack to land a critical hit." },
};

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

// Whether the battle log is slid away; also remembered per browser.
const LOG_HIDDEN_KEY = "godfield.logHidden";

function readLogHidden(): boolean {
  try {
    return window.localStorage.getItem(LOG_HIDDEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveLogHidden(hidden: boolean): void {
  try {
    window.localStorage.setItem(LOG_HIDDEN_KEY, hidden ? "1" : "0");
  } catch {
    // storage unavailable -- just don't remember it
  }
}

const RESULT: Record<"win" | "lose" | "draw", { title: string; color: number; sfx: string }> = {
  win: { title: "VICTORY", color: 0xffd23f, sfx: "victory" },
  lose: { title: "DEFEAT", color: 0xff5a4f, sfx: "defeat" },
  draw: { title: "DRAW", color: 0xc9cfe0, sfx: "draw" },
};

const fmt = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(1));
const shortName = (name: string): string => name.replace(/\s*\(.*\)\s*$/, "");

// Points along a w x h rounded rectangle's edge, clockwise from top center,
// covering `fraction` (0..1) of the way round -- for gauges drawn on a box.
function roundedRectPath(w: number, h: number, r: number, fraction: number): Phaser.Math.Vector2[] {
  // Every point after the start, in order; the last one is the start again.
  const all: Phaser.Math.Vector2[] = [];
  const corner = (cx: number, cy: number, from: number): void => {
    for (let i = 0; i <= 8; i++) {
      const a = from + (i / 8) * (Math.PI / 2);
      all.push(new Phaser.Math.Vector2(cx + Math.cos(a) * r, cy + Math.sin(a) * r));
    }
  };
  corner(w - r, r, -Math.PI / 2);
  corner(w - r, h - r, 0);
  corner(r, h - r, Math.PI / 2);
  corner(r, r, Math.PI);
  all.push(new Phaser.Math.Vector2(w / 2, 0));

  const start = new Phaser.Math.Vector2(w / 2, 0);
  let total = 0;
  let prev = start;
  for (const p of all) {
    total += p.distance(prev);
    prev = p;
  }
  let left = total * Math.max(0, Math.min(1, fraction));
  const out = [start];
  prev = start;
  for (const p of all) {
    if (left <= 0) break;
    const seg = p.distance(prev);
    out.push(seg <= left ? p : prev.clone().lerp(p, left / seg));
    left -= seg;
    prev = p;
  }
  return out;
}

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
  playerDeck?: Card[] | null; // a custom deck (decks.ts); null/absent = starter deck
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
  statInfo: { key: StatKey; chip: Phaser.GameObjects.Container; layer: Phaser.GameObjects.Container } | null = null; // open stat explainer
  resultDismissed = false; // closed with "View board"
  cpuPanel!: Phaser.GameObjects.Container;
  playerPanel!: Phaser.GameObjects.Container;
  cpuPortrait!: Phaser.GameObjects.Container;
  statusText!: Phaser.GameObjects.Text;
  handContainer!: Phaser.GameObjects.Container;
  endTurnRing!: Phaser.GameObjects.Container; // the AP ring around End turn
  slotsContainer!: Phaser.GameObjects.Container;
  fieldContainer!: Phaser.GameObjects.Container;
  classBadge!: Phaser.GameObjects.Container; // also the ultimate toggle
  endTurnButton!: Button;
  handHint: string | null = null; // why the card just clicked can't be played
  // This turn's plan, built up card by card: confirmed cards move from the
  // hand onto the player's arena slot (only this client sees them) until
  // "End turn" sends the whole turn.
  staged: Card[] = [];
  stagedUltimate = false;
  stagedTargets: Record<number, Target> = {}; // attack card id -> who it's aimed at
  orders: MonsterOrder[] = []; // this turn's orders for your monsters
  // Picking a target: for an attack card being played, or a monster order.
  targeting: { kind: "card"; card: Card } | { kind: "order"; uid: number; use: MonsterOrder["use"] } | null = null;
  monsterMenuUid: number | null = null; // your monster whose command menu is open
  previewedCardId: number | null = null; // hand card shown big in the middle, waiting for a confirm click
  previewLayer!: Phaser.GameObjects.Container; // the center preview, above everything else
  pendingTurn: PendingTurn | null = null; // committed turn being resolved/replayed
  logScrollIndex = 0; // pixel offset into the measured log content
  logMaxScrollIndex = 0; // max pixel offset (content height - box height)
  logTotalHeight = 0; // measured content height, set by renderLog
  logContainer!: Phaser.GameObjects.Container;
  logPanel!: Phaser.GameObjects.Container; // everything in the log column, slid as one
  logHidden = false;
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
    return createBattle(playerClass, cpuClass, { playerDeck: data.playerDeck ?? null });
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

  // Send this turn. vs-CPU resolves it right away; OnlineBattleScene
  // overrides this to send it to the server.
  commitAction(action: Action): void {
    this.clearPlanning();
    this.pendingTurn = { cards: action.cards, ultimate: action.ultimate, round: this.battle.round };
    const before = this.currentHp();
    playRound(this.battle, action);
    this.presentRound(before);
  }

  // Forget the turn being planned (the cards are all still in hand).
  clearPlanning(): void {
    this.handHint = null;
    this.previewedCardId = null;
    this.staged = [];
    this.stagedUltimate = false;
    this.stagedTargets = {};
    this.orders = [];
    this.targeting = null;
    this.monsterMenuUid = null;
  }

  // Cancel the center preview (the card goes back to the hand), a target
  // pick, or a monster's command menu.
  dismissPreview(): void {
    if (this.previewedCardId === null && !this.targeting && this.monsterMenuUid === null) return;
    this.previewedCardId = null;
    this.targeting = null;
    this.monsterMenuUid = null;
    this.render();
  }

  onLeave(): void {
    // React shell supplies onExit so Back returns to the menu; fall back to
    // the in-Phaser menu when launched standalone (legacy/dev path).
    if (this.onExit) {
      this.onExit();
      return;
    }
    this.scene.start("ClassSelectScene");
  }

  // AP left after the cards picked so far.
  plannedAp(): number {
    return checkPlan(this.battle.player, this.staged, false, this.orders).ap;
  }

  statusMessage(): string {
    if (this.battle.winner) return `${fighterName(this.battle.winner)} wins! Press "Restart" to play again.`;
    if (this.battle.draw) return `Draw! Press "Restart" to play again.`;
    if (this.handHint) return `Round ${this.battle.round} — ${this.handHint}`;
    return `Round ${this.battle.round} — ${this.plannedAp()}/${this.battle.player.maxAp} AP left. Play cards or click your monsters to give orders, then End turn.`;
  }

  // --- scene ---------------------------------------------------------------

  create(data: BattleSceneData): void {
    useRenderScale(this);
    this.onExit = data.onExit ?? null;
    this.recapPlaying = false;
    this.clearPlanning();
    this.pendingTurn = null;
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
    // The log's pieces keep their screen coordinates inside logPanel, which
    // only ever moves sideways to hide / show the whole column.
    this.logHidden = readLogHidden();
    this.logPanel = this.add.container(this.logHidden ? LOG_HIDE_DX : 0, 0);
    const logBacking = this.add.graphics();
    logBacking.fillStyle(0x0b0d15, 0.72);
    logBacking.fillRoundedRect(LOG_BOX.x, LOG_BOX.y, LOG_BOX.w, LOG_BOX.h, 12);
    this.logPanel.add(logBacking);

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

    this.statusText = textShadow(
      this.add
        .text(GAME_WIDTH / 2, STATUS_Y, "", { fontFamily: FONT_FAMILY, fontSize: "14px", fontStyle: "700", color: TEXT.white, align: "center" })
        .setOrigin(0.5, 0)
    );

    this.classBadge = this.add.container(CLASS_BADGE.x, CLASS_BADGE.y);
    this.handContainer = this.add.container(0, HAND_Y);
    this.fieldContainer = this.add.container(0, 0);
    this.slotsContainer = this.add.container(0, 0);

    // Above the preview / targeting overlay (depth 900), so the AP ring stays
    // readable while you decide on a card.
    this.endTurnRing = this.add.container(0, 0).setDepth(901);
    this.endTurnButton = createCircleButton(this, END_TURN.x, END_TURN.y, END_TURN.r, "End turn", {
      color: AP_GEM_COLOR,
      hoverColor: 0x4a95e0,
      onClick: () => this.onEndTurnClick(),
    });

    createButton(this, BUTTON_X, LEAVE_BUTTON_Y, BUTTON_W, BUTTON_H, this.leaveLabel, {
      color: COLORS.restart,
      hoverColor: COLORS.restartHover,
      onClick: () => this.onLeave(),
    });

    this.logPanel.add(
      this.add.text(LOG_X, LOG_Y - 24, "Battle log", { fontFamily: FONT_FAMILY, fontSize: "14px", color: TEXT.muted }).setOrigin(0, 0)
    );

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
    this.logPanel.add([this.logContainer, this.logScrollTrack, this.logScrollThumb]);

    // Hide / show toggle, fixed in the log's top-right corner whether the
    // log is there or not: ▶ slides it off to the right, ◀ brings it back.
    const toggleLabel = (): string => (this.logHidden ? "◀" : "▶");
    const logToggle = createButton(
      this,
      LOG_BOX.x + LOG_BOX.w - LOG_TOGGLE.w - 6,
      LOG_BOX.y + 6,
      LOG_TOGGLE.w,
      LOG_TOGGLE.h,
      toggleLabel(),
      {
        color: COLORS.restart,
        hoverColor: COLORS.restartHover,
        onClick: () => {
          this.logHidden = !this.logHidden;
          saveLogHidden(this.logHidden);
          (logToggle.container.getAt(1) as Phaser.GameObjects.Text).setText(toggleLabel());
          this.tweens.killTweensOf(this.logPanel);
          this.tweens.add({ targets: this.logPanel, x: this.logHidden ? LOG_HIDE_DX : 0, duration: 280, ease: "Cubic.easeInOut" });
        },
      }
    );

    // Only scroll the log when the pointer is over it, so it doesn't hijack
    // wheel input over the rest of the page.
    // pointer.x/y are canvas pixels, so convert them into the camera's
    // (zoomed) layout coordinates before comparing to the log's box.
    this.input.on("wheel", (pointer: Phaser.Input.Pointer, _objects: unknown, _dx: number, dy: number) => {
      void _objects;
      void _dx;
      const { x, y } = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      if (this.logHidden || x < LOG_X || x > LOG_X + LOG_W || y < LOG_Y || y > LOG_Y + LOG_H) {
        return;
      }
      this.scrollLog(Math.sign(dy) * LOG_SCROLL_STEP);
    });

    // The center card preview sits above everything else.
    this.previewLayer = this.add.container(0, 0).setDepth(900);

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

  // A hand card was clicked: show it big in the middle of the screen.
  onCardClick(cardId: number): void {
    if (!this.canAct()) return;
    this.previewedCardId = cardId;
    this.handHint = null;
    this.render();
  }

  // The previewed card was clicked again: play it onto the arena slot (it
  // only leaves the hand for real when the turn resolves).
  confirmPreview(): void {
    const card = this.battle.player.hand.find((c) => c.id === this.previewedCardId);
    this.previewedCardId = null;
    if (!card || !this.canAct()) return this.render();
    const reason = unplayableReason(this.battle.player, card, this.staged, this.orders);
    if (reason) {
      this.handHint = `can't play ${card.name}: ${reason}.`;
      return this.render();
    }
    // A single-target attack: pick who it hits first (automatic when the
    // only possible target is the enemy fighter).
    if (cardNeedsTarget(card)) return this.startTargeting({ kind: "card", card });
    this.stageCard(card, null);
  }

  stageCard(card: Card, target: Target | null): void {
    this.staged = [...this.staged, card];
    if (target) this.stagedTargets = { ...this.stagedTargets, [card.id]: target };
    playSfx("card");
    this.render();
  }

  // Enter target picking, or skip it when the enemy has no monsters.
  startTargeting(targeting: NonNullable<BattleScene["targeting"]>): void {
    this.monsterMenuUid = null;
    if (this.battle.cpu.field.length === 0) return this.chooseTarget({ kind: "fighter" }, targeting);
    this.targeting = targeting;
    this.handHint = null;
    this.render();
  }

  chooseTarget(target: Target, targeting = this.targeting): void {
    this.targeting = null;
    if (!targeting) return this.render();
    if (targeting.kind === "card") return this.stageCard(targeting.card, target);
    this.orders = [...this.orders.filter((o) => o.uid !== targeting.uid), { uid: targeting.uid, use: targeting.use, target }];
    playSfx("card");
    this.render();
  }

  // Keep only the picks that are still payable, in order (after a card or
  // order was taken back).
  prunePlan(): void {
    const player = this.battle.player;
    const kept: Card[] = [];
    for (const card of this.staged) if (canPlayCard(player, card, kept)) kept.push(card);
    this.staged = kept;
    const keptIds = new Set(kept.map((c) => c.id));
    this.stagedTargets = Object.fromEntries(Object.entries(this.stagedTargets).filter(([id]) => keptIds.has(Number(id))));
    const orders: MonsterOrder[] = [];
    for (const order of this.orders) if (!checkPlan(player, kept, false, [...orders, order]).problem) orders.push(order);
    this.orders = orders;
    if (this.stagedUltimate && checkPlan(player, kept, true, orders).problem) this.stagedUltimate = false;
  }

  // A picked card was clicked on the arena slot: take it back. Cards picked
  // after it stay only if the turn is still payable without it.
  unstage(cardId: number): void {
    if (!this.canAct()) return;
    this.staged = this.staged.filter((c) => c.id !== cardId);
    this.prunePlan();
    this.handHint = null;
    this.render();
  }

  // One of your monsters was clicked: cancel its order if it has one,
  // otherwise open its command menu.
  onMonsterClick(monster: Monster): void {
    if (!this.canAct()) return;
    if (!monster.ready) {
      this.handHint = `${monster.name} was just summoned -- it can act next round.`;
      return this.render();
    }
    if (this.orders.some((o) => o.uid === monster.uid)) {
      this.orders = this.orders.filter((o) => o.uid !== monster.uid);
      this.prunePlan();
      return this.render();
    }
    this.previewedCardId = null;
    this.monsterMenuUid = monster.uid;
    this.handHint = null;
    this.render();
  }

  giveOrder(monster: Monster, use: MonsterOrder["use"]): void {
    this.monsterMenuUid = null;
    const problem = checkPlan(this.battle.player, this.staged, false, [...this.orders, { uid: monster.uid, use, target: null }]).problem;
    if (problem) {
      this.handHint = `${problem}.`;
      return this.render();
    }
    if (orderNeedsTarget(monster, use)) return this.startTargeting({ kind: "order", uid: monster.uid, use });
    this.orders = [...this.orders, { uid: monster.uid, use, target: null }];
    playSfx("card");
    this.render();
  }

  // Ultimate is a toggle: it joins this turn when it's ended.
  onUltimateClick(): void {
    if (!this.canAct()) return;
    if (!this.stagedUltimate && checkPlan(this.battle.player, this.staged, true, this.orders).problem) return;
    this.stagedUltimate = !this.stagedUltimate;
    this.render();
  }

  onEndTurnClick(): void {
    if (!this.canAct()) return;
    const action = planAction(this.battle.player, this.staged.map((c) => c.id), this.stagedUltimate, {
      targets: this.stagedTargets,
      orders: this.orders,
      opponent: this.battle.cpu,
    });
    if (!action) {
      this.handHint = "that turn can't be paid for any more -- take a card back.";
      this.render();
      return;
    }
    this.commitAction(action);
  }

  // --- round recap -----------------------------------------------------------

  currentHp(): HpPair {
    return { player: this.battle.player.hp, cpu: this.battle.cpu.hp };
  }

  // Show the round that just resolved: draw the new state with the HP from
  // `before`, play the recap (which counts HP down as hits land), then draw
  // the final state. Without both sides' lastTurn (e.g. an online match on
  // a server that doesn't send it yet) it just redraws.
  async presentRound(before: HpPair): Promise<void> {
    const b = this.battle;
    const playerTurn: TurnRecord | null = b.player.lastTurn;
    const cpuTurn: TurnRecord | null = b.cpu.lastTurn;
    if (!playerTurn || !cpuTurn) {
      this.pendingTurn = null;
      this.render();
      return;
    }

    this.recapPlaying = true;
    this.shownHp = { ...before };
    this.render();
    this.slotsContainer.setVisible(false); // the recap draws each play itself

    const slotX = (key: "player" | "cpu"): number =>
      key === "cpu" ? GAME_WIDTH / 2 - SLOT_TOTAL_W / 2 : GAME_WIDTH / 2 + SLOT_TOTAL_W / 2 - SLOT_W;
    const side = (key: "player" | "cpu", fighter: Fighter, who: string): RecapSide => ({
      turn: key === "player" ? playerTurn : cpuTurn,
      who,
      classId: fighter.classDef.id,
      className: shortName(fighter.classDef.name),
      ultimateName: ultimateName(fighter.classDef),
      hp: before[key],
      panel: () => this.panelViews[key] as RecapPanel,
      fieldCenter: () => ({ x: (key === "cpu" ? CPU_FIELD_X : PLAYER_FIELD_X) + FIELD_W / 2, y: FIELD_Y + FIELD_H / 2 }),
      slot: { x: slotX(key), y: SLOT_Y, w: SLOT_W, h: SLOT_H, faceW: CARD_W, faceH: CARD_H },
    });

    playRoundRecap(this, {
      round: playerTurn.round,
      stage: RECAP_STAGE,
      sides: {
        player: side("player", b.player, "You"),
        cpu: side("cpu", b.cpu, this.opponentLabel),
      },
      speed: this.recapSpeed,
    }).finally(() => {
      this.recapPlaying = false;
      this.shownHp = null;
      this.pendingTurn = null; // slots empty again until the next turn
      this.slotsContainer.setVisible(true);
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
    this.renderFighterPanel("player", this.playerPanel, PLAYER_STRIP_X, PLAYER_STRIP_Y, PLAYER_STRIP_W, this.battle.player);
    this.drawPortrait(this.cpuPortrait, PORTRAIT_X, CPU_PORTRAIT_Y, this.battle.cpu, this.opponentLabel);
    this.drawFields();
    this.drawSlots();
    this.renderHand(locked);
    this.renderLog();
    this.drawEndTurnRing();
    this.drawClassBadge(locked);
    this.drawPreview(locked);
    if (!locked) {
      this.drawTargeting();
      this.drawMonsterMenu();
    }

    this.statusText.setText(this.statusMessage());
    this.endTurnButton.setEnabled(!locked);
    const plays = this.staged.length + (this.stagedUltimate ? 1 : 0) + this.orders.length;
    (this.endTurnButton.container.getAt(1) as Phaser.GameObjects.Text).setText(plays > 0 ? `End turn\n(${plays})` : "End turn\n(pass)");

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

    // Header row: name, AP pill, HP bar, GUARD badge (while one's up), Hand N.
    const header = this.drawPanelHeader(container, fighter, w);
    const hpRight = this.drawGuardFrame(container, fighter, w, header.right);
    const setHp = this.drawHpBar(container, key, fighter, header.left, hpRight);
    this.drawStatChips(container, fighter, w);
    // Bottom row is shared: effect chips on the left, ultimate meter right.
    // Your meter is the ring around your class badge instead.
    if (key === "player") {
      this.drawEffectChips(container, fighter, w, 92, w - STRIP_PAD);
    } else {
      this.drawEffectChips(container, fighter, w, 92, w * 0.55);
      this.drawUltimateMeter(container, fighter, w * 0.58, 97, w - w * 0.58 - STRIP_PAD);
    }

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

  // Returns the gap left between the AP pill and "Hand N" (for the HP bar).
  drawPanelHeader(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): { left: number; right: number } {
    const name = this.add.text(STRIP_PAD, 6, shortName(fighter.classDef.name), {
      fontFamily: FONT_FAMILY,
      fontSize: "14px",
      fontStyle: "700",
      color: TEXT.white,
    });
    container.add(name);

    // AP pill beside the name: left this turn / this turn's max (for you,
    // after the cards picked so far).
    const apText = this.add
      .text(0, 0, `AP ${fmt(fighter === this.battle.player && !this.pendingTurn ? this.plannedAp() : fighter.ap)}/${fighter.maxAp ?? fighter.ap}`, { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "800", color: TEXT.white })
      .setOrigin(0, 0.5);
    const pillX = STRIP_PAD + name.width + 10;
    const pillW = apText.width + 16;
    const pill = this.add.graphics();
    pill.fillStyle(AP_GEM_COLOR, 1);
    pill.fillRoundedRect(pillX, 5, pillW, 18, 9);
    apText.setPosition(pillX + 8, 14);
    container.add([pill, apText]);

    const handCount = fighter.handCount ?? fighter.hand.length;
    const hand = this.add
      .text(w - STRIP_PAD, 8, `Hand ${handCount}`, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
      .setOrigin(1, 0);
    container.add(hand);
    return { left: pillX + pillW + 10, right: w - STRIP_PAD - hand.width - 12 };
  }

  // While a defend card is up: a pulsing blue frame around the strip and a
  // "GUARD +5" badge in the header ending at `right`, so it's obvious at a
  // glance. Returns where the header's free space now ends.
  drawGuardFrame(container: Phaser.GameObjects.Container, fighter: Fighter, w: number, right: number): number {
    const guards = Object.values(fighter.activeDefends);
    if (guards.length === 0) return right;

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
    const x = right - wBadge;
    const y = 3;
    const pill = this.add.graphics();
    pill.fillStyle(GUARD_COLOR, 1);
    pill.fillRoundedRect(x, y, wBadge, h, h / 2);
    container.add(pill);
    if (this.textures.exists(CARD_ICON_KEY.defend)) {
      container.add(this.add.image(x + 8 + iconSize / 2, y + h / 2, CARD_ICON_KEY.defend).setDisplaySize(iconSize, iconSize).setTint(0x0b1b26));
    }
    text.setPosition(x + 12 + iconSize, y + h / 2);
    container.add(text);
    return x - 10;
  }

  // HP bar in the header, from `left` to `right`. Returns setHp(value), which
  // animates the bar to a new value (with a pale "ghost" of the lost HP that
  // drains a moment later) -- the round recap calls it as each hit lands.
  drawHpBar(
    container: Phaser.GameObjects.Container,
    key: "player" | "cpu",
    fighter: Fighter,
    left: number,
    right: number
  ): (next: number) => void {
    const pad = left;
    const barW = right - left;
    const y = 4;
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

  // DEF / MR / ER / UR / ATK, each with its change from the class's base
  // value (synergies, buffs and debuffs) as a green/red arrow. Each chip
  // pulses gently; hovering fills it with the stat's color and spells out the
  // name, and clicking opens an info box above it (see toggleStatInfo).
  drawStatChips(container: Phaser.GameObjects.Container, fighter: Fighter, w: number): void {
    const pad = STRIP_PAD;
    const barW = w - pad * 2;
    const y = 38;
    const h = 38;
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
      // Each chip is its own container, centred on the chip so it pulses in
      // place; children are drawn relative to its top-left corner (x, top).
      const box = this.add.container(pad + i * (cw + gap) + cw / 2, y + h / 2);
      container.add(box);
      const x = -cw / 2;
      const top = -h / 2;
      const delta = stats[chip.key] - (base[chip.key] ?? 0);
      const guard = guardByStat[chip.key];
      const g = this.add.graphics();
      g.fillStyle(guard ? 0x16384d : COLORS.meterTrack, 1);
      g.fillRoundedRect(x, top, cw, h, 7);
      g.fillStyle(chip.color, 1);
      g.fillRoundedRect(x, top, 4, h, { tl: 7, bl: 7, tr: 0, br: 0 });
      const outline = guard ? GUARD_COLOR : delta > 0 ? 0x6be39a : delta < 0 ? 0xff6b5f : null;
      if (outline !== null) {
        g.lineStyle(2, outline, 1);
        g.strokeRoundedRect(x + 1, top + 1, cw - 2, h - 2, 7);
      }
      box.add(g);

      if (guard) {
        box.add(
          this.add
            .text(x + cw - 7, top + 4, `🛡${guardAmount(guard)}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "10px",
              fontStyle: "800",
              color: "#8fd3ff",
            })
            .setOrigin(1, 0)
        );
      }

      box.add(
        this.add.text(x + 10, top + 5, chip.label, { fontFamily: FONT_FAMILY, fontSize: "9px", fontStyle: "700", color: TEXT.muted })
      );
      box.add(
        this.add.text(x + 10, top + 16, fmt(stats[chip.key]), {
          fontFamily: FONT_FAMILY,
          fontSize: "16px",
          fontStyle: "800",
          color: delta > 0 ? "#6be39a" : delta < 0 ? "#ff6b5f" : TEXT.white,
        })
      );

      if (delta !== 0) {
        box.add(
          this.add
            .text(x + cw - 6, top + h - 5, `${delta > 0 ? "▲" : "▼"}${fmt(Math.abs(delta))}`, {
              fontFamily: FONT_FAMILY,
              fontSize: "11px",
              fontStyle: "700",
              color: delta > 0 ? "#6be39a" : "#ff6b5f",
            })
            .setOrigin(1, 1)
        );
      }

      // Hover: the stat color sweeps across the chip, then the full name fades in.
      const fill = this.add.graphics();
      const name = this.add
        .text(0, 0, STAT_INFO[chip.key].name, {
          fontFamily: FONT_FAMILY,
          fontSize: "13px",
          fontStyle: "800",
          color: "#11131c",
          align: "center",
          wordWrap: { width: cw - 12 },
        })
        .setOrigin(0.5)
        .setAlpha(0);
      box.add([fill, name]);
      const sweep = { p: 0 };
      const drawFill = (): void => {
        fill.clear();
        const fw = cw * sweep.p;
        if (fw <= 0) return;
        fill.fillStyle(chip.color, 1);
        fill.fillRoundedRect(x, top, fw, h, Math.min(7, fw / 2));
      };
      const hoverTo = (p: number): void => {
        this.tweens.killTweensOf([sweep, name]);
        this.tweens.add({ targets: sweep, p, duration: 220, ease: "Cubic.easeOut", onUpdate: () => fill.active && drawFill() });
        this.tweens.add({ targets: name, alpha: p, delay: p ? 120 : 0, duration: p ? 160 : 100 });
      };

      const pulse = this.tweens.add({
        targets: box,
        scale: 1.04,
        duration: 900,
        delay: i * 150,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      box.once("destroy", () => this.tweens.killTweensOf([box, sweep, name]));

      const hit = this.add.zone(x, top, cw, h).setOrigin(0).setInteractive({ useHandCursor: true });
      box.add(hit);
      hit.on("pointerover", () => {
        pulse.pause();
        box.setScale(1.06);
        hoverTo(1);
      });
      hit.on("pointerout", () => {
        box.setScale(1);
        pulse.resume();
        hoverTo(0);
      });
      hit.on("pointerdown", () => this.toggleStatInfo(container, box, chip.key, chip.color, cw, h));
    });
  }

  // The info box a clicked stat chip opens directly above itself (below, on
  // the CPU strip where there's no room above), joined to it by a short stem.
  // Clicking the same chip (or the box) closes it; one is open at a time, and
  // it goes away whenever the strip is rebuilt.
  toggleStatInfo(
    container: Phaser.GameObjects.Container,
    chip: Phaser.GameObjects.Container,
    key: StatKey,
    color: number,
    cw: number,
    ch: number
  ): void {
    const wasOpen = this.statInfo?.key === key && this.statInfo.chip === chip;
    this.closeStatInfo();
    if (wasOpen) return;

    const info = STAT_INFO[key];
    const boxW = Math.max(cw, 240);
    const textPad = 12;
    const stem = 10;
    const title = this.add.text(0, 0, `${info.label} — ${info.name}`, {
      fontFamily: FONT_FAMILY,
      fontSize: "13px",
      fontStyle: "800",
      color: Phaser.Display.Color.IntegerToColor(color).rgba,
    });
    const body = this.add.text(0, 0, info.description, {
      fontFamily: FONT_FAMILY,
      fontSize: "12px",
      color: TEXT.white,
      lineSpacing: 2,
      wordWrap: { width: boxW - textPad * 2 },
    });
    const boxH = textPad * 2 + title.height + 6 + body.height;

    // World position of the chip's top-centre; keep the box on screen.
    const chipX = container.x + chip.x;
    const chipTop = container.y + chip.y - ch / 2;
    const left = Phaser.Math.Clamp(chipX - boxW / 2, 8, GAME_WIDTH - boxW - 8);
    const above = chipTop - stem - boxH >= 8;
    const top = above ? chipTop - stem - boxH : chipTop + ch + stem;

    const layer = this.add.container(left, top).setDepth(900);
    const g = this.add.graphics();
    g.fillStyle(COLORS.panel, 0.97);
    g.fillRoundedRect(0, 0, boxW, boxH, 10);
    g.lineStyle(2, color, 1);
    g.strokeRoundedRect(0, 0, boxW, boxH, 10);
    // Stem connecting the box to the chip.
    const sx = chipX - left;
    g.fillStyle(color, 1);
    if (above) {
      g.fillRect(sx - 2, boxH, 4, stem);
      g.fillTriangle(sx - 8, boxH - 1, sx + 8, boxH - 1, sx, boxH + 7);
    } else {
      g.fillRect(sx - 2, -stem, 4, stem);
      g.fillTriangle(sx - 8, 1, sx + 8, 1, sx, -7);
    }
    title.setPosition(textPad, textPad);
    body.setPosition(textPad, textPad + title.height + 6);
    layer.add([g, title, body]);
    g.setInteractive(new Phaser.Geom.Rectangle(0, 0, boxW, boxH), Phaser.Geom.Rectangle.Contains);
    g.on("pointerdown", () => this.closeStatInfo());

    // Grow out of the chip.
    layer.setAlpha(0).setY(top + (above ? 12 : -12));
    this.tweens.add({ targets: layer, alpha: 1, y: top, duration: 180, ease: "Cubic.easeOut" });

    this.statInfo = { key, chip, layer };
    chip.once("destroy", () => {
      if (this.statInfo?.layer === layer) this.closeStatInfo();
    });
  }

  closeStatInfo(): void {
    if (!this.statInfo) return;
    const { layer } = this.statInfo;
    this.statInfo = null;
    this.tweens.killTweensOf(layer);
    layer.destroy(true);
  }

  // One row of chips: synergy progress, active defends, temporary
  // buffs/debuffs and disabled synergies, each with turns remaining.
  // Shares the strip's bottom row with the ultimate meter (see maxX).
  drawEffectChips(container: Phaser.GameObjects.Container, fighter: Fighter, w: number, y: number, maxX: number): void {
    const chips: Array<{ text: string; color: number }> = [];

    // Statuses first: they're what most needs noticing.
    for (const [id, state] of Object.entries(fighter.statuses ?? {}) as Array<[StatusId, { potency: number; remaining: number }]>) {
      const potency = id === STATUS.WET || id === STATUS.BLIND ? "" : ` ${state.potency}`;
      chips.push({ text: `${STATUS_LABEL[id] ?? id}${potency} · ${state.remaining}t`, color: STATUS_COLOR[id] ?? CHIP_COLOR.down });
    }

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
      // Only stat modifiers and regen end up here (see applyEffects).
      const positive =
        effect.kind === EFFECT_KIND.ENERGY_REGEN || (effect.kind === EFFECT_KIND.STAT_MODIFIER && effect.amount >= 0);
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

  // AP this turn would spend on what's being looked at right now: the
  // previewed card, or the card / monster order whose target is being picked.
  pendingSpend(): number {
    const player = this.battle.player;
    const previewed = player.hand.find((c) => c.id === this.previewedCardId);
    if (previewed) return cardCost(previewed);
    const t = this.targeting;
    if (t?.kind === "card") return cardCost(t.card);
    if (t?.kind === "order") {
      const monster = player.field.find((m) => m.uid === t.uid);
      return monster ? orderCost(monster, t.use) : 0;
    }
    return 0;
  }

  // Like the CPU portrait minus HP (that's on your strip right above): class
  // icon, side label, name and ultimate status, with the meter as a yellow
  // ring around the edge. Clicking it toggles the ultimate when it's usable.
  drawClassBadge(locked: boolean): void {
    const { w, h } = CLASS_BADGE;
    const c = this.classBadge;
    c.removeAll(true);
    const player = this.battle.player;
    const cost = player.classDef.ultimate.cost;
    const ready = canUseUltimate(player);
    const usable = !locked && (this.stagedUltimate || !checkPlan(player, this.staged, true, this.orders).problem);

    const bg = this.add.graphics();
    bg.fillStyle(COLORS.panel, 1);
    bg.fillRoundedRect(0, 0, w, h, BADGE_RADIUS);
    if (ready) {
      bg.fillStyle(ULT_RING_LIVE, this.stagedUltimate ? 0.22 : 0.12);
      bg.fillRoundedRect(0, 0, w, h, BADGE_RADIUS);
    }
    c.add(bg);

    // The meter: clockwise from top center, full = the whole edge.
    const ring = this.add.graphics();
    ring.lineStyle(ULT_RING_W, COLORS.meterTrack, 1);
    ring.strokeRoundedRect(0, 0, w, h, BADGE_RADIUS);
    const fill = Math.min(1, player.ultimateMeter / cost);
    if (fill > 0) {
      const points = roundedRectPath(w, h, BADGE_RADIUS, fill);
      ring.lineStyle(ULT_RING_W, ULT_RING_LIVE, 1);
      ring.strokePoints(points, fill >= 1, fill >= 1);
    }
    c.add(ring);

    if (ready) {
      // A copy of the full ring that grows out from the badge and fades, on
      // repeat, centered so it scales from the middle.
      const pulse = this.add.graphics({ x: w / 2, y: h / 2 });
      pulse.lineStyle(ULT_RING_W, ULT_RING_LIVE, 1);
      pulse.strokeRoundedRect(-w / 2, -h / 2, w, h, BADGE_RADIUS);
      this.tweens.add({ targets: pulse, scaleX: 1.08, scaleY: 1.12, alpha: { from: 0.9, to: 0 }, duration: 1100, repeat: -1 });
      pulse.once("destroy", () => this.tweens.killTweensOf(pulse));
      c.add(pulse);
    }

    const cx = w / 2;
    c.add(this.add.circle(cx, 48, 32, COLORS.meterTrack));
    const iconKey = classIconKey(player.classDef.id);
    if (this.textures.exists(iconKey)) {
      c.add(this.add.image(cx, 48, iconKey).setDisplaySize(44, 44));
    }
    c.add(
      this.add.text(cx, 86, this.playerLabel.toUpperCase(), { fontFamily: FONT_FAMILY, fontSize: "11px", fontStyle: "700", color: TEXT.muted }).setOrigin(0.5, 0)
    );
    c.add(
      this.add.text(cx, 102, shortName(player.classDef.name), {
        fontFamily: FONT_FAMILY,
        fontSize: "15px",
        fontStyle: "700",
        color: TEXT.white,
        align: "center",
        wordWrap: { width: w - 24 },
      }).setOrigin(0.5, 0)
    );
    let ult: string;
    if (this.stagedUltimate) ult = "ULTIMATE ✓ · click to undo";
    else if (ready && usable) ult = "ULTIMATE READY · click";
    else if (ready) ult = "ULTIMATE READY";
    else ult = `ULT ${fmt(player.ultimateMeter)}/${cost}`;
    c.add(
      this.add
        .text(cx, 130, ult, { fontFamily: FONT_FAMILY, fontSize: "12px", fontStyle: "800", color: ready ? "#ffd23f" : TEXT.muted })
        .setOrigin(0.5, 0)
    );

    if (usable) {
      bg.setInteractive(new Phaser.Geom.Rectangle(0, 0, w, h), Phaser.Geom.Rectangle.Contains);
      bg.input!.cursor = "pointer";
      bg.on("pointerdown", () => this.onUltimateClick());
    }
  }

  drawEndTurnRing(): void {
    const c = this.endTurnRing;
    c.removeAll(true);
    const player = this.battle.player;
    const max = player.maxAp ?? player.ap;
    if (max <= 0) return;
    const planning = !this.pendingTurn && this.canAct();
    const left = planning ? this.plannedAp() : player.ap;
    const preview = planning ? Math.min(left, this.pendingSpend()) : 0;

    // Starts at 12 o'clock and runs clockwise, like a timer.
    const seg = (Math.PI * 2) / max;
    const gap = max > 1 ? END_TURN_RING_GAP : 0;
    const { x, y } = END_TURN;
    for (let i = 0; i < max; i++) {
      const start = -Math.PI / 2 + i * seg + gap / 2;
      const end = start + seg - gap;
      const arc = this.add.graphics();
      if (i < left) {
        arc.lineStyle(END_TURN_RING_W, AP_RING_LIVE, 1);
        if (i >= left - preview) {
          this.tweens.add({ targets: arc, alpha: 0.35, duration: 380, yoyo: true, repeat: -1 });
          arc.once("destroy", () => this.tweens.killTweensOf(arc));
        }
      } else {
        arc.lineStyle(END_TURN_RING_W, AP_RING_SPENT, 1);
      }
      arc.beginPath();
      arc.arc(x, y, END_TURN_RING_R, start, end, false);
      arc.strokePath();
      c.add(arc);
    }
  }

  renderHand(locked: boolean): void {
    this.handContainer.removeAll(true);
    // Picked cards have moved onto the arena slot.
    const stagedIds = new Set(this.staged.map((c) => c.id));
    const cards = this.battle.player.hand.filter((c) => !stagedIds.has(c.id) && c.id !== this.previewedCardId);
    // Between the class badge on the left and the End turn ring on the right;
    // a hand too big for that squeezes its overlap instead of covering them.
    const minX = CLASS_BADGE.x + CLASS_BADGE.w + 8;
    const maxX = END_TURN.x - END_TURN_RING_R - END_TURN_RING_W / 2 - 12;
    let step = CARD_W - FAN_OVERLAP;
    if (cards.length > 1 && (cards.length - 1) * step + CARD_W > maxX - minX) {
      step = (maxX - minX - CARD_W) / (cards.length - 1);
    }
    const totalW = cards.length > 0 ? (cards.length - 1) * step + CARD_W : 0;
    // Centered on the board, shifted aside if it would reach the badge or ring.
    const x0 = Math.max(minX, Math.min(GAME_WIDTH / 2 - totalW / 2, maxX - totalW));
    cards.forEach((card, i) => this.drawHandCard(card, x0 + i * step, locked));
  }

  // Face data for a hand card, with its cost gem red when this turn's AP
  // left can't pay for it.
  handFace(card: Card): CardFaceData {
    return { ...cardFaceData(card), costShort: !this.pendingTurn && cardCost(card) > this.plannedAp() };
  }

  drawHandCard(card: Card, x: number, locked: boolean): void {
    const { container: cardContainer, bg } = drawCardFace(this, this.handFace(card), CARD_W, CARD_H);
    cardContainer.setPosition(x, 0);
    if (locked) {
      cardContainer.setAlpha(0.5);
      bg.disableInteractive();
    } else {
      // Can't be paid for after what's already picked: dimmed, but it can
      // still be opened to read (the preview says why it can't be played).
      if (unplayableReason(this.battle.player, card, this.staged, this.orders)) cardContainer.setAlpha(0.55);
      // Hover expands the card, growing up from its bottom edge.
      bg.on("pointerover", (pointer: Phaser.Input.Pointer) => {
        if (pointer.wasTouch) return;
        this.handContainer.bringToTop(cardContainer);
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({
          targets: cardContainer,
          x: x - (CARD_W * (HOVER_SCALE - 1)) / 2,
          y: -HOVER_LIFT - CARD_H * (HOVER_SCALE - 1),
          scale: HOVER_SCALE,
          duration: 100,
        });
      });
      bg.on("pointerout", () => {
        this.tweens.killTweensOf(cardContainer);
        this.tweens.add({ targets: cardContainer, x, y: 0, scale: 1, duration: 100 });
      });
      bg.on("pointerdown", () => this.onCardClick(card.id));
    }
    this.handContainer.add(cardContainer);
  }

  // The previewed card, full size in the middle of the screen over a dimmed
  // board: click it to play it, click anywhere else to put it back.
  drawPreview(locked: boolean): void {
    this.previewLayer.removeAll(true);
    const card = this.battle.player.hand.find((c) => c.id === this.previewedCardId);
    if (!card || locked) return;

    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070d, 0.6).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const w = CARD_W * PREVIEW_SCALE;
    const h = CARD_H * PREVIEW_SCALE;
    const x = GAME_WIDTH / 2 - w / 2;
    const y = GAME_HEIGHT / 2 - h / 2 - 20;
    const { container, bg } = drawCardFace(this, this.handFace(card), w, h, { scale: PREVIEW_SCALE });
    const ring = this.add.graphics();
    ring.lineStyle(4, PREVIEW_RING, 1);
    ring.strokeRoundedRect(-7, -7, w + 14, h + 14, 16);
    container.add(ring);
    bg.on("pointerdown", () => this.confirmPreview());
    this.previewLayer.add(container);

    const reason = unplayableReason(this.battle.player, card, this.staged, this.orders);
    const after = checkPlan(this.battle.player, [...this.staged, card], false, this.orders).ap;
    const aim = cardNeedsTarget(card) && this.battle.cpu.field.length > 0 ? " -- then pick its target" : "";
    const hint = reason
      ? `Can't play this now: ${reason}.\nClick anywhere to put it back.`
      : `Click the card to play it (AP ${this.plannedAp()} → ${after})${aim}.\nClick anywhere else to put it back.`;
    this.previewLayer.add(
      textShadow(
        this.add
          .text(GAME_WIDTH / 2, y + h + 22, hint, {
            fontFamily: FONT_FAMILY,
            fontSize: "15px",
            fontStyle: "700",
            color: reason ? "#ff8a80" : TEXT.white,
            align: "center",
          })
          .setOrigin(0.5, 0)
      )
    );

    // Pop in from slightly smaller, centered.
    container.setAlpha(0).setScale(0.85).setPosition(x + (w * 0.15) / 2, y + (h * 0.15) / 2);
    this.tweens.add({ targets: container, alpha: 1, scale: 1, x, y, duration: 140, ease: "Back.easeOut" });
  }

  // Picking a target: the board dims, and every legal target on the enemy
  // side (their fighter -- strip or portrait -- and their monsters) lights up
  // to be clicked. A guard monster has to be picked first. Clicking anywhere
  // else cancels.
  drawTargeting(): void {
    const targeting = this.targeting;
    if (!targeting) return;
    const opponent = this.battle.cpu;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070d, 0.55).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const box = (x: number, y: number, w: number, h: number, target: Target): void => {
      const legal = !targetProblem(opponent, target);
      const g = this.add.graphics();
      if (legal) {
        g.fillStyle(0xff5a4f, 0.16);
        g.fillRoundedRect(x, y, w, h, 10);
        g.lineStyle(3, 0xff5a4f, 1);
        g.strokeRoundedRect(x, y, w, h, 10);
        g.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains);
        g.on("pointerdown", () => this.chooseTarget(target));
        this.tweens.add({ targets: g, alpha: 0.55, duration: 500, yoyo: true, repeat: -1 });
        g.once("destroy", () => this.tweens.killTweensOf(g));
      } else {
        g.fillStyle(0x05070d, 0.45);
        g.fillRoundedRect(x, y, w, h, 10);
      }
      this.previewLayer.add(g);
    };
    box(STRIP_X, CPU_STRIP_Y, STRIP_W, STRIP_H, { kind: "fighter" });
    box(PORTRAIT_X, CPU_PORTRAIT_Y, PORTRAIT_W, PORTRAIT_H, { kind: "fighter" });
    opponent.field.forEach((monster, i) => {
      const pos = this.monsterPos("cpu", i);
      box(pos.x - 3, pos.y - 3, MONSTER_W + 6, MONSTER_H + 6, { kind: "monster", uid: monster.uid });
    });

    let what: string;
    if (targeting.kind === "card") {
      what = targeting.card.name;
    } else {
      const monster = this.battle.player.field.find((m) => m.uid === targeting.uid);
      what = `${monster?.name ?? "your monster"}'s ${targeting.use === "attack" ? "attack" : (monster?.ability?.name ?? "ability")}`;
    }
    const guard = opponent.field.some((m) => m.guard) ? "\nA guard monster is in the way: it has to be hit first." : "";
    this.previewLayer.add(
      textShadow(
        this.add
          .text(GAME_WIDTH / 2, 470, `Choose a target for ${what}.${guard}\nClick anywhere else to cancel.`, {
            fontFamily: FONT_FAMILY,
            fontSize: "16px",
            fontStyle: "800",
            color: TEXT.white,
            align: "center",
          })
          .setOrigin(0.5, 0)
      )
    );
  }

  // Your monster's command menu: attack, its ability, or cancel -- each
  // with its AP cost, greyed out when this turn can't pay for it.
  drawMonsterMenu(): void {
    const player = this.battle.player;
    const index = player.field.findIndex((m) => m.uid === this.monsterMenuUid);
    const monster = player.field[index];
    if (!monster) return;
    const dim = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x05070d, 0.45).setOrigin(0, 0).setInteractive();
    dim.on("pointerdown", () => this.dismissPreview());
    this.previewLayer.add(dim);

    const w = 236;
    const ability = monster.ability;
    const h = ability ? 214 : 150;
    const pos = this.monsterPos("player", index);
    const x = Math.max(STRIP_X, pos.x + MONSTER_W / 2 - w / 2 - 120);
    const y = FIELD_Y - 10;
    const panel = this.add.graphics();
    panel.fillStyle(COLORS.panel, 0.98);
    panel.fillRoundedRect(x, y, w, h, 12);
    panel.lineStyle(2, PREVIEW_RING, 1);
    panel.strokeRoundedRect(x, y, w, h, 12);
    panel.setInteractive(new Phaser.Geom.Rectangle(x, y, w, h), Phaser.Geom.Rectangle.Contains); // clicks on the panel don't cancel
    this.previewLayer.add(panel);
    this.previewLayer.add(
      this.add.text(x + 14, y + 10, monster.name, { fontFamily: FONT_FAMILY, fontSize: "15px", fontStyle: "800", color: TEXT.white })
    );
    this.previewLayer.add(
      this.add.text(x + 14, y + 31, `${Math.ceil(monster.hp)}/${monster.maxHp} HP · ATK ${monster.atk} · SPD ${monster.speed}`, {
        fontFamily: FONT_FAMILY,
        fontSize: "11px",
        color: TEXT.muted,
      })
    );

    const affordable = (use: MonsterOrder["use"]): boolean =>
      !checkPlan(player, this.staged, false, [...this.orders, { uid: monster.uid, use, target: null }]).problem;
    let by = y + 52;
    const option = (label: string, enabled: boolean, onClick: () => void, color: number, hover: number): void => {
      const button = createButton(this, x + 14, by, w - 28, 34, label, { color, hoverColor: hover, onClick });
      button.setEnabled(enabled);
      this.previewLayer.add(button.container);
      by += 42;
    };
    option(`Attack (${monster.atk} dmg) — ${orderCost(monster, "attack")} AP`, affordable("attack"), () => this.giveOrder(monster, "attack"), 0xb5423a, 0xcc5a50);
    if (ability) {
      option(`${ability.name} — ${ability.cost} AP`, affordable("ability"), () => this.giveOrder(monster, "ability"), 0x6a4a94, 0x8060aa);
      this.previewLayer.add(
        this.add.text(x + 14, by - 6, describeAbility(ability) + (ability.target === "self" ? " (on you)" : ""), {
          fontFamily: FONT_FAMILY,
          fontSize: "11px",
          color: TEXT.muted,
          wordWrap: { width: w - 28 },
        })
      );
      by += 22;
    }
    option("Cancel", true, () => this.dismissPreview(), COLORS.restart, COLORS.restartHover);
  }

  // Face-down card for the opponent's slot while a sent turn resolves.
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

  // Arena slots. Yours holds the cards picked this turn (shrunk and fanned;
  // click one to take it back) -- only this client sees them. Once the turn
  // is sent, the opponent's slot shows a face-down card until the recap.
  drawSlots(): void {
    this.slotsContainer.removeAll(true);
    const pending = this.pendingTurn;
    const muted = (x: number, text: string): Phaser.GameObjects.Text =>
      this.add
        .text(x + SLOT_W / 2, SLOT_Y + SLOT_H / 2, text, { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted, align: "center" })
        .setOrigin(0.5);
    const sides: Array<{ key: "player" | "cpu"; x: number }> = [
      { key: "cpu", x: GAME_WIDTH / 2 - SLOT_TOTAL_W / 2 },
      { key: "player", x: GAME_WIDTH / 2 + SLOT_TOTAL_W / 2 - SLOT_W },
    ];
    for (const { key, x } of sides) {
      const frame = this.add.graphics();
      frame.lineStyle(2, 0x4a5573, 1);
      frame.strokeRoundedRect(x, SLOT_Y, SLOT_W, SLOT_H, 10);
      this.slotsContainer.add(frame);

      if (key === "cpu") {
        if (pending) {
          const back = this.drawCardBack();
          back.setPosition(x + (SLOT_W - CARD_W) / 2, SLOT_Y + (SLOT_H - CARD_H) / 2);
          this.slotsContainer.add(back);
        } else {
          this.slotsContainer.add(muted(x, "—"));
        }
        continue;
      }

      const cards = pending ? pending.cards : this.staged;
      const ultimate = pending ? pending.ultimate : this.stagedUltimate;
      const faces: Array<{ data: CardFaceData; cardId: number | null }> = cards.map((c) => ({ data: cardFaceData(c), cardId: c.id }));
      if (ultimate) {
        faces.push({ data: { category: "ultimate", name: ultimateName(this.battle.player.classDef), description: "" }, cardId: null });
      }
      if (faces.length === 0) {
        this.slotsContainer.add(muted(x, pending ? "Pass" : "Click a card,\nthen click it again\nto play it here"));
        continue;
      }
      const w = CARD_W * STAGE_SCALE;
      const h = CARD_H * STAGE_SCALE;
      const step = faces.length > 1 ? Math.min(w + 4, (SLOT_W - 10 - w) / (faces.length - 1)) : 0;
      const x0 = x + (SLOT_W - (w + step * (faces.length - 1))) / 2;
      faces.forEach(({ data, cardId }, i) => {
        const { container, bg } = drawCardFace(this, data, w, h, { scale: STAGE_SCALE });
        container.setPosition(x0 + i * step, SLOT_Y + (SLOT_H - h) / 2 + 8);
        if (!pending && this.canAct()) {
          bg.on("pointerdown", () => (cardId === null ? this.onUltimateClick() : this.unstage(cardId)));
        } else {
          bg.disableInteractive();
        }
        this.slotsContainer.add(container);
        const target = cardId !== null && !pending ? this.stagedTargets[cardId] : undefined;
        if (target) {
          this.slotsContainer.add(
            this.add
              .text(x0 + i * step + w / 2, SLOT_Y + (SLOT_H - h) / 2 + 8 + h + 3, `→ ${this.targetName(target)}`, {
                fontFamily: FONT_FAMILY,
                fontSize: "9px",
                fontStyle: "800",
                color: "#ffd23f",
                stroke: "#000000",
                strokeThickness: 2,
              })
              .setOrigin(0.5, 0)
          );
        }
      });
      this.slotsContainer.add(
        this.add
          .text(x + SLOT_W / 2, SLOT_Y + 6, pending ? "SENT" : "CLICK ONE TO TAKE IT BACK", {
            fontFamily: FONT_FAMILY,
            fontSize: "9px",
            fontStyle: "700",
            color: TEXT.muted,
          })
          .setOrigin(0.5, 0)
      );
    }
  }

  // Both monster fields, beside their owner's arena slot.
  drawFields(): void {
    this.fieldContainer.removeAll(true);
    const sides: Array<{ fighter: Fighter; x: number; label: string }> = [
      { fighter: this.battle.cpu, x: CPU_FIELD_X, label: `${this.opponentLabel} field` },
      { fighter: this.battle.player, x: PLAYER_FIELD_X, label: "Your field" },
    ];
    for (const { fighter, x, label } of sides) {
      const field = fighter.field ?? [];
      const backing = this.add.graphics();
      backing.fillStyle(0x0b0d15, 0.5);
      backing.fillRoundedRect(x, FIELD_Y, FIELD_W, FIELD_H, 10);
      this.fieldContainer.add(backing);
      this.fieldContainer.add(
        this.add.text(x + 8, FIELD_Y + 5, `${label.toUpperCase()} ${field.length}/${FIELD_SIZE}`, {
          fontFamily: FONT_FAMILY,
          fontSize: "10px",
          fontStyle: "700",
          color: TEXT.muted,
        })
      );
      if (field.length === 0) {
        this.fieldContainer.add(
          this.add
            .text(x + FIELD_W / 2, FIELD_Y + FIELD_H / 2 + 8, "no monsters", { fontFamily: FONT_FAMILY, fontSize: "11px", color: TEXT.muted })
            .setOrigin(0.5)
            .setAlpha(0.7)
        );
      }
      field.forEach((monster, i) => {
        const pos = this.monsterPos(fighter === this.battle.player ? "player" : "cpu", i);
        this.drawMonster(monster, pos.x, pos.y, !monster.ready, fighter === this.battle.player);
      });
    }
  }

  // Top-left of the i-th monster token on a side's field.
  monsterPos(key: "player" | "cpu", index: number): { x: number; y: number } {
    const x = key === "cpu" ? CPU_FIELD_X : PLAYER_FIELD_X;
    return { x: x + index * (MONSTER_W + MONSTER_GAP), y: FIELD_Y + 26 };
  }

  targetName(target: Target): string {
    if (target.kind === "fighter") return this.opponentLabel;
    return this.battle.cpu.field.find((m) => m.uid === target.uid)?.name ?? "monster";
  }

  // One monster token: art, name, HP bar, ATK/SPD, and a blue frame for a
  // guard. `fresh`: summoned this round, so it can only act from the next
  // one. Your own ready monsters are clickable (command menu); one with an
  // order this turn gets a gold frame and says what it'll do.
  drawMonster(monster: Monster, x: number, y: number, fresh: boolean, own: boolean): void {
    const c = this.add.container(x, y);
    const order = own && !this.pendingTurn ? this.orders.find((o) => o.uid === monster.uid) : undefined;
    const g = this.add.graphics();
    g.fillStyle(COLORS.card.monster, 1);
    g.fillRoundedRect(0, 0, MONSTER_W, MONSTER_H, 8);
    if (monster.guard) {
      g.lineStyle(3, MONSTER_GUARD, 1);
      g.strokeRoundedRect(1.5, 1.5, MONSTER_W - 3, MONSTER_H - 3, 8);
    }
    if (order || this.monsterMenuUid === monster.uid) {
      g.lineStyle(3, PREVIEW_RING, 1);
      g.strokeRoundedRect(-2, -2, MONSTER_W + 4, MONSTER_H + 4, 10);
    }
    if (own && this.canAct() && !this.pendingTurn) {
      g.setInteractive(new Phaser.Geom.Rectangle(0, 0, MONSTER_W, MONSTER_H), Phaser.Geom.Rectangle.Contains);
      g.on("pointerdown", () => this.onMonsterClick(monster));
    }
    c.add(g);
    if (order) {
      // One short line under the token: "ATK → Skeleton", "Fortify".
      const what = order.use === "attack" ? "ATK" : (monster.ability?.name ?? "Ability");
      const name = order.target ? this.targetName(order.target) : "";
      const aim = order.target ? ` → ${name.length > 9 ? `${name.slice(0, 8)}…` : name}` : "";
      c.add(
        this.add
          .text(MONSTER_W / 2, MONSTER_H + 2, `${what}${aim}`, {
            fontFamily: FONT_FAMILY,
            fontSize: "9px",
            fontStyle: "800",
            color: "#ffd23f",
            stroke: "#000000",
            strokeThickness: 3,
          })
          .setOrigin(0.5, 0)
      );
    }

    const artW = MONSTER_W - 8;
    const artH = Math.round(artW * 0.75);
    const box = this.add.graphics();
    box.fillStyle(COLORS.background, 0.45);
    box.fillRoundedRect(4, 4, artW, artH, 6);
    c.add(box);
    const artKey = loadedArtKey(this, monster.cardId);
    if (artKey) {
      c.add(this.add.image(4 + artW / 2, 4 + artH / 2, artKey).setDisplaySize(artW - 2, artH - 2));
    } else if (this.textures.exists(CARD_ICON_KEY.monster)) {
      c.add(this.add.image(4 + artW / 2, 4 + artH / 2, CARD_ICON_KEY.monster).setDisplaySize(30, 30));
    }

    c.add(
      this.add
        .text(MONSTER_W / 2, artH + 7, monster.name, {
          fontFamily: FONT_FAMILY,
          fontSize: "10px",
          fontStyle: "700",
          color: TEXT.white,
          align: "center",
          wordWrap: { width: MONSTER_W - 6 },
        })
        .setOrigin(0.5, 0)
    );

    const tags = [monster.guard ? "GUARD" : "", fresh ? "NEW" : ""].filter(Boolean).join(" · ");
    if (tags) {
      c.add(
        this.add
          .text(MONSTER_W / 2, MONSTER_H - 48, tags, { fontFamily: FONT_FAMILY, fontSize: "9px", fontStyle: "800", color: monster.guard ? "#8fd3ff" : "#ffe9a8" })
          .setOrigin(0.5, 0)
      );
    }

    const barX = 5;
    const barW = MONSTER_W - 10;
    const barY = MONSTER_H - 34;
    const bar = this.add.graphics();
    bar.fillStyle(COLORS.meterTrack, 1);
    bar.fillRoundedRect(barX, barY, barW, 12, 5);
    const pct = Phaser.Math.Clamp(monster.hp / monster.maxHp, 0, 1);
    if (pct > 0) {
      bar.fillStyle(hpColor(pct), 1);
      bar.fillRoundedRect(barX, barY, barW * pct, 12, Math.min(5, (barW * pct) / 2));
    }
    c.add(bar);
    c.add(
      this.add
        .text(MONSTER_W / 2, barY + 6, `${Math.ceil(monster.hp)}/${monster.maxHp}`, {
          fontFamily: FONT_FAMILY,
          fontSize: "9px",
          fontStyle: "800",
          color: TEXT.white,
          stroke: "#000000",
          strokeThickness: 2,
        })
        .setOrigin(0.5)
    );
    c.add(
      this.add
        .text(MONSTER_W / 2, MONSTER_H - 17, `ATK ${monster.atk} · SPD ${monster.speed}`, {
          fontFamily: FONT_FAMILY,
          fontSize: "9px",
          fontStyle: "700",
          color: TEXT.white,
        })
        .setOrigin(0.5, 0)
    );
    if (fresh) c.setAlpha(0.8);
    this.fieldContainer.add(c);
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
