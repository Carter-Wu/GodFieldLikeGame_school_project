// Battle engine wiring the class/card/synergy model above into an actual
// playable loop. See docs/DESIGN.md for the design this is built from.
//
// Turns are simultaneous: each round, the player commits a turn -- any number
// of cards their AP pays for, plus their ultimate if it's charged -- and the
// CPU independently picks its own (from state alone -- chooseCpuAction never
// looks at the player's chosen turn), then both resolve together.
//
// The same engine also runs online PvP, server-side in the Supabase Edge
// Function (supabase/functions/game/): there the two sides are two humans,
// still stored in the `player` / `cpu` slots (player 1 / player 2), and
// resolveRound is called with both humans' turns instead of going through
// playRound's CPU. See "Online PvP" in README.md.
//
// A round, in order:
//   1. durations of defends / buffs / debuffs tick down
//   2. setup: each side's cards are paid for (AP, plus HP or ultimate meter
//      for some) in the order they were picked, and their defends, buffs,
//      debuffs and monster summons take effect
//   3. damage: every attack card and ultimate from both sides, the higher
//      priority first. Where the two sides tie on priority, each side's die
//      roll (one per side per round) decides; a side's own strikes keep the
//      order they were picked in. A fighter knocked out mid-phase gets none
//      of their remaining strikes, and a landed "interrupts" card cancels the
//      opponent's next attack card
//   4. monsters on the field attack, fastest first
//   5. statuses: burning / poison deal their damage, every status ticks down
//   6. AP refills (with one more max AP), ultimate meter regens, and both
//      sides draw back up to a full hand
//
// AP (action points, docs: "as seen in Hearthstone"): every card costs AP.
// Max AP starts at AP_RULES.start and grows by AP_RULES.growth every round up
// to AP_RULES.max; AP refills to the max at the start of each turn, and AP
// left unspent is lost. "Gain AP" effects add to this turn's AP right away,
// so they pay for cards picked after them.
//
// Other simplifications vs. docs/DESIGN.md (kept deliberately, not silently
// dropped):
// - No fog of war / troop placement yet.
// - No QTE / clash when both players fire their ultimate in the same round;
//   they just resolve by priority like attacks.
// - A defend card fully replaces any earlier active defend of the same damage
//   type rather than adding to it, even when `stacking` is STACKABLE -- true
//   stacking amounts aren't modeled yet either (STACKABLE currently only
//   means "don't consume this on the first hit it blocks").
// - CONDITIONAL effects are accepted but are currently no-ops.

import { shuffle } from "./util.ts";
import { resolveSynergies } from "./synergies.ts";
import { EFFECT_KIND, MODIFIER_MODE, STATUS, type ApplyStatusEffect, type Effect, type StatusId } from "./effects.ts";
import { computeEffectiveStats, type ClassDef } from "./classes.ts";
import {
  applyDefend,
  cardCost,
  CARD_CATEGORY,
  STACKING,
  type AttackCard,
  type Card,
  type DefendCard,
  type MonsterCard,
} from "./cardTypes.ts";
import { ELEMENT, RESIST_STAT, type DamageType, type Element } from "./damageTypes.ts";
import { buildDeckForClass, findCardById } from "./catalog.ts";
import type { Stats } from "./stats.ts";

const HAND_SIZE = 6; // drawn back up to this every round
const MAX_HAND = 8; // "draw" effects can go over HAND_SIZE, up to this

export const AP_RULES = {
  start: 2, // max AP in round 1
  growth: 1, // +max AP per round
  max: 10,
} as const;

export const FIELD_SIZE = 3; // monsters per side
const ULTIMATE_PRIORITY = 1;

// Dice rolls and the CPU's choices. Tests swap in a seeded source.
let random: () => number = Math.random;
export function setRandomSource(source: (() => number) | null): void {
  random = source ?? Math.random;
}
const rollDie = (): number => 1 + Math.floor(random() * 6);

export const STATUS_LABEL: Record<StatusId, string> = {
  [STATUS.BURNING]: "Burn",
  [STATUS.POISON]: "Poison",
  [STATUS.WET]: "Wet",
  [STATUS.ACID]: "Acid",
  [STATUS.SLOWED]: "Slow",
  [STATUS.BLIND]: "Blind",
};

// --- fighter state -----------------------------------------------------

export interface TempModifier {
  effect: Effect;
  remaining: number;
}

export interface ActiveDefend {
  card: Card;
  remaining: number;
}

export interface StatusState {
  potency: number;
  remaining: number; // rounds left, counting the current one
}

export interface Monster {
  uid: number; // unique within its owner's field
  cardId: string | null;
  name: string;
  hp: number;
  maxHp: number;
  atk: number;
  speed: number;
  damageType: DamageType;
  element: Element | null;
  applies: ApplyStatusEffect[];
  guard: boolean;
  summonedRound: number; // acts from the round after this one
}

export interface GuardInfo {
  amount: number;
  mode: string;
  duration: number;
}

// A monster's attack in the monster phase. `order` is the position among
// every monster attack this round (both sides), so the recap can replay
// them in the order they happened.
export interface MonsterHit {
  order: number;
  attacker: string;
  target: string; // a monster's name, or "fighter"
  damage: number;
  guarded: number;
  resisted: number;
  killed: boolean;
  damageType: DamageType;
}

// An attack card hitting a monster instead of the fighter (a sweep, or a
// guard monster stepping in).
export interface FieldHit {
  target: string;
  damage: number;
  killed: boolean;
}

export interface StatusTick {
  status: StatusId;
  damage: number;
}

// One card (or the ultimate) a fighter played in the last resolved round.
export interface PlayRecord {
  kind: "card" | "ultimate";
  cardId: string | null;
  name: string | null;
  category: string | null;
  damageType: DamageType | null;
  element: Element | null;
  cost: number | null;
  description: string | null;
  damage: number | null;
  guarded: number; // absorbed by the target's defend card
  resisted: number; // absorbed by the target's DEF/MR/ER
  guard: GuardInfo | null;
  // Damage phase: position among both sides' strikes (1 = first), null for
  // cards that don't strike.
  order: number | null;
  cancelled: "interrupted" | "knocked_out" | null;
  healed: number;
  apGained: number;
  summoned: string[];
  fieldHits: FieldHit[];
  statusesApplied: StatusId[];
}

// What a fighter did in the last resolved round -- kept on the fighter as
// `lastTurn` so the UI can replay the round once it resolves. It's public:
// the same information is already in the battle log.
export interface TurnRecord {
  round: number;
  plays: PlayRecord[]; // in the order they were picked
  dice: number | null; // this side's die, if it was needed for a priority tie
  monsterHits: MonsterHit[]; // made by this fighter's monsters
  statusTicks: StatusTick[]; // end-of-round status damage this fighter took
}

export interface Fighter {
  classDef: ClassDef;
  label: string | null;
  hp: number;
  maxHp: number;
  ap: number;
  maxAp: number;
  deck: Card[];
  discard: Card[];
  hand: Card[];
  field: Monster[];
  statuses: Partial<Record<StatusId, StatusState>>;
  ultimateMeter: number;
  cardsPlayedByCategory: Record<string, number>;
  activeDefends: Record<string, ActiveDefend>; // damageType -> { card, remaining }
  tempModifiers: TempModifier[]; // [{ effect, remaining }] from buff/debuff cards
  disabledSynergies: Set<string>;
  disabledSynergyTimers: Record<string, number>; // synergyId -> remaining turns
  lastTurn: TurnRecord | null; // what this fighter did in the last resolved round
  handCount?: number;
}

// `label` is an optional display name for the battle log -- used online when
// both players pick the same class, so the log can tell them apart.
export function createFighter(classDef: ClassDef, deck: Card[], label: string | null = null): Fighter {
  return {
    classDef,
    label,
    hp: classDef.baseStats.hp,
    maxHp: classDef.baseStats.hp,
    ap: AP_RULES.start,
    maxAp: AP_RULES.start,
    deck,
    discard: [],
    hand: [],
    field: [],
    statuses: {},
    ultimateMeter: 0,
    cardsPlayedByCategory: { attack: 0, defend: 0, buff: 0, debuff: 0, monster: 0 },
    activeDefends: {}, // damageType -> { card, remaining }
    tempModifiers: [], // [{ effect, remaining }] from buff/debuff cards
    disabledSynergies: new Set<string>(),
    disabledSynergyTimers: {}, // synergyId -> remaining turns
    lastTurn: null,
  };
}

export function fighterName(fighter: Fighter): string {
  return fighter.label ?? fighter.classDef.name;
}

function drawCard(fighter: Fighter): Card | null {
  if (fighter.deck.length === 0) {
    if (fighter.discard.length === 0) return null;
    fighter.deck = shuffle(fighter.discard);
    fighter.discard = [];
  }
  return fighter.deck.pop() ?? null;
}

function drawUpTo(fighter: Fighter, size = HAND_SIZE): void {
  while (fighter.hand.length < size) {
    const card = drawCard(fighter);
    if (!card) break;
    fighter.hand.push(card);
  }
}

export function statusPotency(fighter: Fighter, status: StatusId): number {
  return fighter.statuses[status]?.potency ?? 0;
}

const hasStatus = (fighter: Fighter, status: StatusId): boolean => Boolean(fighter.statuses[status]);

// --- stats, derived from class + active synergies + temporary effects --

function computeActiveSynergyEffects(fighter: Fighter): Effect[] {
  const pool = fighter.classDef.synergyPool.filter((s) => !fighter.disabledSynergies.has(s.id));
  const activeCounts: Record<string, number> = {};
  for (const synergy of pool) {
    activeCounts[synergy.id] = fighter.cardsPlayedByCategory[synergy.countsCategory] ?? 0;
  }
  return resolveSynergies(pool, activeCounts);
}

export function computeCurrentStats(fighter: Fighter): Stats {
  const synergyEffects = computeActiveSynergyEffects(fighter);
  const tempStatEffects = fighter.tempModifiers
    .map((m) => m.effect)
    .filter((e): e is Extract<Effect, { kind: "stat_modifier" }> => e.kind === EFFECT_KIND.STAT_MODIFIER);
  const stats = computeEffectiveStats(fighter.classDef, [...synergyEffects, ...tempStatEffects]);
  const acid = statusPotency(fighter, STATUS.ACID);
  stats.def -= acid;
  stats.er -= acid;
  return stats;
}

function currentUltimateRegen(fighter: Fighter): number {
  const stats = computeCurrentStats(fighter);
  let regen = stats.ur;
  for (const mod of fighter.tempModifiers) {
    if (mod.effect.kind === EFFECT_KIND.ENERGY_REGEN) {
      regen += mod.effect.mode === MODIFIER_MODE.PERCENT ? stats.ur * mod.effect.amount : mod.effect.amount;
    }
  }
  return regen;
}

export function canUseUltimate(fighter: Fighter): boolean {
  return fighter.ultimateMeter >= fighter.classDef.ultimate.cost;
}

// --- planning a turn -----------------------------------------------------
//
// A turn is the cards a fighter picks, in order, plus whether they also
// fire their ultimate. Playing them one after another has to stay payable
// the whole way: AP, HP (never down to 0), ultimate meter, field slots.

export interface Action {
  cards: Card[];
  ultimate: boolean;
}

// Client wire action (what the browser sends the server -- card identities
// only, since the server re-checks them against its own copy).
export interface ClientAction {
  cardIds: number[];
  ultimate: boolean;
}

export interface PlanCheck {
  problem: string | null; // why the plan can't be played, or null
  ap: number; // AP left after it
  meter: number; // ultimate meter left after its cards (before the ultimate)
}

function selfEffects(card: Card): Effect[] {
  return card.category === CARD_CATEGORY.BUFF || card.category === CARD_CATEGORY.DEBUFF ? (card.effects ?? []) : [];
}

export function checkPlan(fighter: Fighter, cards: Card[], ultimate = false): PlanCheck {
  let ap = fighter.ap;
  let hp = fighter.hp;
  let meter = fighter.ultimateMeter;
  let field = fighter.field.length;
  const seen = new Set<number>();
  for (const card of cards) {
    const fail = (problem: string): PlanCheck => ({ problem, ap, meter });
    if (seen.has(card.id) || !fighter.hand.some((c) => c.id === card.id)) return fail(`${card.name} isn't in your hand`);
    seen.add(card.id);
    const cost = cardCost(card);
    if (ap < cost) return fail(`${card.name} needs ${cost} AP`);
    if ((card.hpCost ?? 0) > 0 && hp <= (card.hpCost ?? 0)) return fail(`${card.name} needs more than ${card.hpCost} HP`);
    if (meter < (card.meterCost ?? 0)) return fail(`${card.name} needs ${card.meterCost} ultimate meter`);
    if (card.category === CARD_CATEGORY.MONSTER && field >= FIELD_SIZE) return fail("your field is full");
    ap -= cost;
    hp -= card.hpCost ?? 0;
    meter = meter - (card.meterCost ?? 0) + (card.uaCharge ?? 0);
    if (card.category === CARD_CATEGORY.MONSTER) field += 1;
    for (const effect of selfEffects(card)) {
      if (effect.kind === EFFECT_KIND.GAIN_AP) ap = Math.min(AP_RULES.max, ap + effect.amount);
      if (effect.kind === EFFECT_KIND.SUMMON) field = Math.min(FIELD_SIZE, field + (effect.count ?? 1));
    }
  }
  if (ultimate && meter < fighter.classDef.ultimate.cost) return { problem: "your ultimate isn't charged", ap, meter };
  return { problem: null, ap, meter };
}

// null if `card` can be added after the already-picked `picked` cards,
// otherwise why not (shown on the battle screen).
export function unplayableReason(fighter: Fighter, card: Card, picked: Card[] = []): string | null {
  return checkPlan(fighter, [...picked, card]).problem;
}

export function canPlayCard(fighter: Fighter, card: Card, picked: Card[] = []): boolean {
  return unplayableReason(fighter, card, picked) === null;
}

// A turn from hand card ids, or null if it can't be played.
export function planAction(fighter: Fighter, cardIds: number[], ultimate = false): Action | null {
  const cards: Card[] = [];
  for (const id of cardIds) {
    const card = fighter.hand.find((c) => c.id === id);
    if (!card) return null;
    cards.push(card);
  }
  return checkPlan(fighter, cards, ultimate).problem === null ? { cards, ultimate } : null;
}

// Shorthands: a turn of just one card, just the ultimate, or nothing.
export function cardAction(fighter: Fighter, cardId: number): Action | null {
  return planAction(fighter, [cardId]);
}

export function ultimateAction(fighter: Fighter): Action | null {
  return planAction(fighter, [], true);
}

export function passAction(): Action {
  return { cards: [], ultimate: false };
}

export function toClientAction(action: Action): ClientAction {
  return { cardIds: action.cards.map((c) => c.id), ultimate: action.ultimate };
}

// --- statuses, monsters, and hitting things ------------------------------

// Returns false if the status didn't take (burning on a Wet target).
function addStatus(target: Fighter, { status, potency, duration }: ApplyStatusEffect): boolean {
  if (status === STATUS.BURNING && target.statuses.wet) {
    delete target.statuses.wet; // the fire just dries them off
    return false;
  }
  if (status === STATUS.WET) delete target.statuses.burning;
  const current = target.statuses[status];
  if (current) {
    current.potency = status === STATUS.POISON ? current.potency + potency : Math.max(current.potency, potency);
    current.remaining = Math.max(current.remaining, duration);
  } else {
    target.statuses[status] = { potency, remaining: duration };
  }
  return true;
}

// Element vs. the target's statuses: electric shocks the Wet harder, fire
// fizzles on them (and dries them), water puts out Burning.
function applyElement(target: Fighter, value: number, element: Element | null | undefined): number {
  if (element === ELEMENT.ELECTRIC && target.statuses.wet) return Math.round(value * 1.5);
  if (element === ELEMENT.FIRE && target.statuses.wet) {
    delete target.statuses.wet;
    return Math.round(value * 0.5);
  }
  if (element === ELEMENT.WATER) delete target.statuses.burning;
  return value;
}

const blinded = (fighter: Fighter, value: number): number => (hasStatus(fighter, STATUS.BLIND) ? Math.floor(value / 2) : value);

function healFighter(fighter: Fighter, amount: number): number {
  const before = fighter.hp;
  fighter.hp = Math.min(fighter.maxHp, fighter.hp + Math.max(0, amount));
  return fighter.hp - before;
}

function summonMonster(owner: Fighter, card: Omit<MonsterCard, "id" | "category">, round: number): Monster | null {
  if (owner.field.length >= FIELD_SIZE) return null;
  const monster: Monster = {
    uid: owner.field.reduce((max, m) => Math.max(max, m.uid), 0) + 1,
    cardId: card.cardId ?? null,
    name: card.name,
    hp: card.hp,
    maxHp: card.hp,
    atk: card.atk,
    speed: card.speed ?? 0,
    damageType: card.damageType,
    element: card.element ?? null,
    applies: card.applies ?? [],
    guard: Boolean(card.guard),
    summonedRound: round,
  };
  owner.field.push(monster);
  return monster;
}

function damageMonster(owner: Fighter, monster: Monster, amount: number): FieldHit {
  const damage = Math.max(0, amount);
  monster.hp = Math.max(0, monster.hp - damage);
  const killed = monster.hp <= 0;
  if (killed) owner.field = owner.field.filter((m) => m !== monster);
  return { target: monster.name, damage, killed };
}

// The monster that has to take a hit aimed at `owner`: a guard first.
const blockingMonster = (owner: Fighter): Monster | undefined => owner.field.find((m) => m.guard);

// Returns { damage, guarded, resisted }: the damage dealt, and how much the
// defender's active defend card and resistance stat each absorbed (shown in
// the round recap).
export interface HitResult {
  damage: number;
  guarded: number;
  resisted: number;
}

// `resist`: false for monster attacks -- they get past armor (DEF/MR/ER), so a
// few points of ATK still matter; only a defend card stops them.
function strikeFighter(defender: Fighter, value: number, damageType: DamageType, resist = true): HitResult {
  const defenderStats = computeCurrentStats(defender);
  const activeDefend = defender.activeDefends[damageType] ?? null;
  const afterDefend = applyDefend({ damageType, value }, (activeDefend ? activeDefend.card : null) as DefendCard | null);
  let dealt = afterDefend;

  const resistKey = (RESIST_STAT as Partial<Record<DamageType, keyof Stats>>)[damageType]; // undefined for TRUE damage
  if (resistKey && resist) {
    dealt = Math.max(0, dealt - defenderStats[resistKey]);
  }

  if (activeDefend && (activeDefend.card as DefendCard).stacking === STACKING.NONSTACKABLE) {
    delete defender.activeDefends[damageType];
  }

  defender.hp = Math.max(0, defender.hp - dealt);
  return { damage: dealt, guarded: value - afterDefend, resisted: afterDefend - dealt };
}

function newPlay(card: Card | null): PlayRecord {
  const isDefend = card?.category === CARD_CATEGORY.DEFEND;
  const defendCard = isDefend ? (card as DefendCard) : null;
  return {
    kind: card ? "card" : "ultimate",
    cardId: card?.cardId ?? null,
    name: card?.name ?? null,
    category: card?.category ?? null,
    damageType: (card as { damageType?: DamageType } | null)?.damageType ?? null,
    element: card?.element ?? null,
    cost: card ? cardCost(card) : null,
    description: card ? describeCard(card) : null,
    damage: null,
    guarded: 0,
    resisted: 0,
    guard: defendCard ? { amount: defendCard.amount, mode: defendCard.mode, duration: defendCard.duration } : null,
    order: null,
    cancelled: null,
    healed: 0,
    apGained: 0,
    summoned: [],
    fieldHits: [],
    statusesApplied: [],
  };
}

function gainAp(fighter: Fighter, amount: number): number {
  const before = fighter.ap;
  fighter.ap = Math.min(AP_RULES.max, fighter.ap + amount);
  return fighter.ap - before;
}

// Apply a buff/debuff/ultimate's effects. `target` is who the card aims at
// (yourself for a buff, the opponent for a debuff); AP, draws and summons
// always go to the actor.
function applyEffects(
  actor: Fighter,
  target: Fighter,
  effects: Effect[],
  duration: number,
  play: PlayRecord,
  round: number
): void {
  for (const effect of effects) {
    switch (effect.kind) {
      case EFFECT_KIND.METER_SIPHON:
        target.ultimateMeter = Math.max(0, target.ultimateMeter - effect.amount);
        break;
      case EFFECT_KIND.SYNERGY_DISABLE:
        target.disabledSynergies.add(effect.synergyId);
        target.disabledSynergyTimers[effect.synergyId] = duration;
        break;
      case EFFECT_KIND.STAT_MODIFIER:
      case EFFECT_KIND.ENERGY_REGEN:
        target.tempModifiers.push({ effect, remaining: duration });
        break;
      case EFFECT_KIND.APPLY_STATUS:
        if (addStatus(target, effect)) play.statusesApplied.push(effect.status);
        break;
      case EFFECT_KIND.HEAL:
        play.healed += healFighter(target, effect.amount);
        break;
      case EFFECT_KIND.GAIN_AP:
        play.apGained += gainAp(actor, effect.amount);
        break;
      case EFFECT_KIND.DRAW:
        drawUpTo(actor, Math.min(MAX_HAND, actor.hand.length + effect.count));
        break;
      case EFFECT_KIND.CLEANSE:
        target.statuses = {};
        break;
      case EFFECT_KIND.SUMMON: {
        const entry = findCardById(effect.cardId);
        if (!entry || entry.category !== CARD_CATEGORY.MONSTER) break;
        for (let i = 0; i < (effect.count ?? 1); i++) {
          const card = { ...(entry.props as Omit<MonsterCard, "id" | "category" | "name">), name: entry.name, cardId: entry.id };
          const monster = summonMonster(actor, card, round);
          if (monster) play.summoned.push(monster.name);
        }
        break;
      }
      default:
        // CONDITIONAL: not implemented yet, see docs/DESIGN.md.
        break;
    }
  }
}

function resolveAttackCard(attacker: Fighter, defender: Fighter, card: AttackCard, play: PlayRecord): HitResult {
  const stats = computeCurrentStats(attacker);
  const value = Math.max(0, blinded(attacker, card.value + (card.value > 0 ? stats.atk : 0)));

  if (card.target === "field") {
    for (const monster of [...defender.field]) play.fieldHits.push(damageMonster(defender, monster, value));
    return { damage: 0, guarded: 0, resisted: 0 };
  }

  const guard = blockingMonster(defender);
  if (guard) {
    play.fieldHits.push(damageMonster(defender, guard, value));
    return { damage: 0, guarded: 0, resisted: 0 };
  }

  const hit = strikeFighter(defender, applyElement(defender, value, card.element), card.damageType);
  if (card.lifesteal) play.healed += healFighter(attacker, Math.floor(hit.damage * card.lifesteal));
  for (const status of card.applies ?? []) {
    if (addStatus(defender, status)) play.statusesApplied.push(status.status);
  }
  return hit;
}

// Remove a played card from hand into the discard pile, pay for it, and
// count it toward its category's synergy. Shared by every card category --
// attack cards get this too, even though their actual effect is resolved
// later (see resolveDamagePhase) so that both sides' attacks use post-setup
// state.
function commitCardHousekeeping(actor: Fighter, card: Card): void {
  actor.ap = Math.max(0, actor.ap - cardCost(card));
  actor.hp = Math.max(1, actor.hp - (card.hpCost ?? 0));
  actor.ultimateMeter = Math.max(0, actor.ultimateMeter - (card.meterCost ?? 0)) + (card.uaCharge ?? 0);
  actor.cardsPlayedByCategory[card.category] = (actor.cardsPlayedByCategory[card.category] ?? 0) + 1;
  const index = actor.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) actor.hand.splice(index, 1);
  actor.discard.push(card);
}

function useUltimate(actor: Fighter, opponent: Fighter, play: PlayRecord, round: number): HitResult {
  const ultimate = actor.classDef.ultimate;
  actor.ultimateMeter -= ultimate.cost;
  const damage = ultimate.damage ?? 0;
  opponent.hp = Math.max(0, opponent.hp - damage);
  if (ultimate.effects?.length) applyEffects(actor, actor, ultimate.effects, ultimate.duration ?? 3, play, round);
  return { damage, guarded: 0, resisted: 0 };
}

// Tick every duration a fighter is carrying (active defends, temporary
// buff/debuff modifiers, disabled synergies) down by one. Called at the
// START of the round -- NOT right after they play the card that created
// them -- so e.g. a duration:1 defend card actually survives to see the
// opponent's next attack instead of expiring before the opponent ever gets a
// turn. (Statuses tick at the END of the round instead -- see tickStatuses.)
function tickStatusDurations(fighter: Fighter): void {
  for (const type of Object.keys(fighter.activeDefends)) {
    const entry = fighter.activeDefends[type];
    if (!entry) continue; // Object.keys snapshot -- entry always present
    entry.remaining -= 1;
    if (entry.remaining <= 0) delete fighter.activeDefends[type];
  }

  fighter.tempModifiers = fighter.tempModifiers
    .map((m) => ({ effect: m.effect, remaining: m.remaining - 1 }))
    .filter((m) => m.remaining > 0);

  for (const id of Object.keys(fighter.disabledSynergyTimers)) {
    const timer = fighter.disabledSynergyTimers[id];
    if (timer === undefined) continue;
    const next = timer - 1;
    if (next <= 0) {
      fighter.disabledSynergies.delete(id);
      delete fighter.disabledSynergyTimers[id];
    } else {
      fighter.disabledSynergyTimers[id] = next;
    }
  }
}

// End of round: burning and poison hurt, then every status ticks down. A
// status applied this round with duration 1 is gone after this.
function tickStatuses(fighter: Fighter, turn: TurnRecord): void {
  for (const id of Object.keys(fighter.statuses) as StatusId[]) {
    const state = fighter.statuses[id];
    if (!state) continue;
    if (id === STATUS.BURNING || id === STATUS.POISON) {
      const damage = Math.min(fighter.hp, state.potency);
      fighter.hp -= damage;
      turn.statusTicks.push({ status: id, damage });
    }
    state.remaining -= 1;
    if (state.remaining <= 0) delete fighter.statuses[id];
  }
}

// After the round: max AP grows and AP refills, ultimate meter comes in and
// the hand refills. (Duration ticking is deliberately NOT here -- see
// tickStatusDurations.)
function regenAndDraw(fighter: Fighter): void {
  fighter.maxAp = Math.min(AP_RULES.max, fighter.maxAp + AP_RULES.growth);
  fighter.ap = fighter.maxAp;
  fighter.ultimateMeter += currentUltimateRegen(fighter);
  drawUpTo(fighter);
}

// --- battle-level state --------------------------------------------------

export interface Battle {
  player: Fighter;
  cpu: Fighter;
  round: number;
  winner: Fighter | null; // the winning fighter, or null while the game is ongoing
  draw: boolean; // true if both fighters ran out of HP in the same round
  log: string[];
}

export function createBattle(
  playerClass: ClassDef,
  cpuClass: ClassDef,
  {
    playerLabel = null,
    cpuLabel = null,
    playerDeck = null,
    cpuDeck = null,
  }: {
    playerLabel?: string | null;
    cpuLabel?: string | null;
    // Prebuilt card instances (a player's custom deck, see decks.ts);
    // null = the class's starter deck.
    playerDeck?: Card[] | null;
    cpuDeck?: Card[] | null;
  } = {}
): Battle {
  const battle: Battle = {
    player: createFighter(playerClass, playerDeck ?? buildDeckForClass(playerClass), playerLabel),
    cpu: createFighter(cpuClass, cpuDeck ?? buildDeckForClass(cpuClass), cpuLabel),
    round: 1,
    winner: null, // the winning fighter, or null while the game is ongoing
    draw: false, // true if both fighters ran out of HP in the same round
    log: [],
  };
  drawUpTo(battle.player);
  drawUpTo(battle.cpu);
  addLog(battle, `${fighterName(battle.player)} vs ${fighterName(battle.cpu)}. Fight!`);
  return battle;
}

function addLog(battle: Battle, message: string): void {
  battle.log.unshift(message);
}

export function isBattleOver(battle: Battle): boolean {
  return Boolean(battle.winner) || battle.draw;
}

// Very simple CPU: fires its ultimate the moment it's ready, then goes
// through its hand by preference -- defends first when low on HP, then
// monsters, attacks (strongest first), debuffs and buffs, with some
// randomness -- adding every card it can still pay for. Deliberately reads
// only battle.cpu's own state -- never the player's pending turn -- so this
// is a fair simultaneous decision, not a reaction to what the player is
// about to do.
function chooseCpuAction(battle: Battle): Action {
  const cpu = battle.cpu;
  const lowHp = cpu.hp <= cpu.maxHp * 0.4;
  const score = (card: Card): number => {
    const jitter = random() * 2;
    switch (card.category) {
      case CARD_CATEGORY.DEFEND:
        return (lowHp ? 12 : 3) + jitter;
      case CARD_CATEGORY.MONSTER:
        return 8 + jitter;
      case CARD_CATEGORY.ATTACK:
        return 5 + card.value / 2 + jitter;
      default:
        return 4 + jitter;
    }
  };
  const ranked = cpu.hand.map((card) => ({ card, s: score(card) })).sort((a, b) => b.s - a.s);

  const picked: Card[] = [];
  const guardedTypes = new Set<string>();
  for (const { card } of ranked) {
    // Two defends of one damage type would just replace each other.
    if (card.category === CARD_CATEGORY.DEFEND && guardedTypes.has(card.damageType)) continue;
    if (!canPlayCard(cpu, card, picked)) continue;
    picked.push(card);
    if (card.category === CARD_CATEGORY.DEFEND) guardedTypes.add(card.damageType);
  }
  return { cards: picked, ultimate: checkPlan(cpu, picked, true).problem === null };
}

// --- resolving a round ------------------------------------------------------

interface Side {
  actor: Fighter;
  opponent: Fighter;
  action: Action;
  turn: TurnRecord;
  // (card, its play record) for every card, in pick order; the ultimate's
  // record is `ultimatePlay`.
  cardPlays: Array<{ card: Card; play: PlayRecord }>;
  ultimatePlay: PlayRecord | null;
  interruptsPending: number; // the opponent landed this many "interrupts" cards
}

// Defends, buffs/debuffs and summons go live immediately (the "setup"
// phase); attacks and ultimates are resolved afterwards for both sides (the
// "damage" phase). Running every card's setup before anyone's damage is what
// makes a defend card played this round able to block an attack played this
// same round, instead of only protecting against the opponent's *next*
// round -- the two sides' choices are hidden from each other but resolve
// together.
function applySetupPhase(side: Side, battle: Battle): void {
  const { actor, opponent } = side;
  for (const { card, play } of side.cardPlays) {
    commitCardHousekeeping(actor, card);
    switch (card.category) {
      case CARD_CATEGORY.DEFEND:
        actor.activeDefends[card.damageType] = { card, remaining: card.duration };
        addLog(battle, `${fighterName(actor)} sets up ${card.name} (defend).`);
        break;
      case CARD_CATEGORY.BUFF:
        applyEffects(actor, actor, card.effects, card.duration ?? 1, play, battle.round);
        addLog(battle, `${fighterName(actor)} plays ${card.name} (buff).`);
        break;
      case CARD_CATEGORY.DEBUFF:
        applyEffects(actor, opponent, card.effects, card.duration ?? 1, play, battle.round);
        addLog(battle, `${fighterName(actor)} plays ${card.name} (debuff).`);
        break;
      case CARD_CATEGORY.MONSTER:
        if (summonMonster(actor, card, battle.round)) play.summoned.push(card.name);
        addLog(battle, `${fighterName(actor)} summons ${card.name}.`);
        break;
      // ATTACK is resolved in resolveDamagePhase, once both sides' defends and
      // buffs/debuffs for this round are already in place.
    }
  }
  if (side.cardPlays.length === 0 && !side.action.ultimate) addLog(battle, `${fighterName(actor)} passes.`);
}

interface Strike {
  side: Side;
  card: AttackCard | null; // null = the ultimate
  play: PlayRecord;
  priority: number;
  index: number; // pick order within the side
}

// Attacks and ultimates, higher priority first. Where the two sides tie on
// priority, both roll a die once for the round (rerolling ties) and the
// higher roll goes first (docs: "If the priority level is the same, use
// dice"); a side's own strikes keep their pick order.
function resolveDamagePhase(battle: Battle, sides: [Side, Side]): void {
  const slowed = (f: Fighter): number => statusPotency(f, STATUS.SLOWED);
  const strikes: Strike[] = [];
  for (const side of sides) {
    side.cardPlays.forEach(({ card, play }, index) => {
      if (card.category !== CARD_CATEGORY.ATTACK) return;
      strikes.push({ side, card, play, priority: (card.priority ?? 0) - slowed(side.actor), index });
    });
    if (side.ultimatePlay) {
      strikes.push({ side, card: null, play: side.ultimatePlay, priority: ULTIMATE_PRIORITY - slowed(side.actor), index: side.cardPlays.length });
    }
  }

  const [a, b] = sides;
  const priorities = (s: Side): Set<number> => new Set(strikes.filter((x) => x.side === s).map((x) => x.priority));
  const pb = priorities(b);
  const tie = [...priorities(a)].some((p) => pb.has(p));
  const dice = new Map<Side, number>([
    [a, 0],
    [b, 0],
  ]);
  if (tie) {
    let da = rollDie();
    let db = rollDie();
    for (let i = 0; da === db && i < 20; i++) {
      da = rollDie();
      db = rollDie();
    }
    if (da === db) db = da === 6 ? 5 : da + 1; // vanishingly unlikely; just settle it
    dice.set(a, da);
    dice.set(b, db);
    a.turn.dice = da;
    b.turn.dice = db;
    addLog(battle, `Dice: ${fighterName(a.actor)} ${da}, ${fighterName(b.actor)} ${db}.`);
  }
  strikes.sort((x, y) => y.priority - x.priority || (dice.get(y.side) ?? 0) - (dice.get(x.side) ?? 0) || x.index - y.index);

  strikes.forEach((strike, i) => {
    const { side, card, play } = strike;
    const { actor, opponent } = side;
    play.order = i + 1;
    if (actor.hp <= 0) {
      play.cancelled = "knocked_out";
      return;
    }
    if (card && side.interruptsPending > 0) {
      side.interruptsPending -= 1;
      play.cancelled = "interrupted";
      addLog(battle, `${fighterName(actor)}'s ${card.name} is interrupted!`);
      return;
    }
    if (!card) {
      const hit = useUltimate(actor, opponent, play, battle.round);
      play.damage = hit.damage;
      addLog(battle, `${fighterName(actor)} unleashes its ultimate for ${hit.damage} damage!`);
      return;
    }
    const hit = resolveAttackCard(actor, opponent, card, play);
    Object.assign(play, { damage: hit.damage, guarded: hit.guarded, resisted: hit.resisted });
    if (play.fieldHits.length > 0) {
      addLog(battle, `${fighterName(actor)}'s ${card.name} hits ${play.fieldHits.map((h) => `${h.target} (${h.damage})`).join(", ")}.`);
    } else {
      addLog(battle, `${fighterName(actor)} hits with ${card.name} for ${hit.damage} damage.`);
    }
    if (card.interrupts && hit.damage > 0) {
      const other = sides.find((s) => s !== side);
      if (other) other.interruptsPending += 1;
    }
  });
}

// Every monster that was already on the field when the round started
// attacks once, fastest first (equal speed: dice). It goes for the enemy's
// monsters -- a guard first -- and only hits the enemy fighter once their
// field is empty.
function resolveMonsterPhase(battle: Battle, sides: [Side, Side]): void {
  const acting: Array<{ side: Side; monster: Monster; speed: number; roll: number }> = [];
  for (const side of sides) {
    for (const monster of side.actor.field) {
      if (monster.summonedRound >= battle.round) continue;
      acting.push({ side, monster, speed: monster.speed - statusPotency(side.actor, STATUS.SLOWED), roll: rollDie() });
    }
  }
  acting.sort((a, b) => b.speed - a.speed || b.roll - a.roll);

  let order = 0;
  for (const { side, monster } of acting) {
    const { actor, opponent, turn } = side;
    if (monster.hp <= 0 || actor.hp <= 0 || opponent.hp <= 0) continue;
    const atk = Math.max(0, blinded(actor, monster.atk));
    const target = blockingMonster(opponent) ?? opponent.field[0];
    order += 1;
    if (target) {
      const hit = damageMonster(opponent, target, atk);
      turn.monsterHits.push({ order, attacker: monster.name, target: target.name, damage: hit.damage, guarded: 0, resisted: 0, killed: hit.killed, damageType: monster.damageType });
      addLog(battle, `${monster.name} hits ${target.name} for ${hit.damage}${hit.killed ? " -- destroyed!" : "."}`);
      continue;
    }
    const hit = strikeFighter(opponent, applyElement(opponent, atk, monster.element), monster.damageType, false);
    for (const status of monster.applies) addStatus(opponent, status);
    turn.monsterHits.push({ order, attacker: monster.name, target: "fighter", ...hit, killed: false, damageType: monster.damageType });
    addLog(battle, `${monster.name} hits ${fighterName(opponent)} for ${hit.damage}.`);
  }
}

function checkOutcome(battle: Battle): void {
  if (isBattleOver(battle)) return;
  const playerDown = battle.player.hp <= 0;
  const cpuDown = battle.cpu.hp <= 0;

  if (playerDown && cpuDown) {
    battle.draw = true;
    addLog(battle, "Both fighters go down at the same time -- it's a draw!");
  } else if (cpuDown) {
    battle.winner = battle.player;
    addLog(battle, `${fighterName(battle.player)} wins!`);
  } else if (playerDown) {
    battle.winner = battle.cpu;
    addLog(battle, `${fighterName(battle.cpu)} wins!`);
  }
}

// Commit the player's turn for this round, have the CPU independently
// commit its own, then resolve both together.
export function playRound(battle: Battle, playerAction: Action | null): void {
  if (isBattleOver(battle) || !playerAction) return;
  resolveRound(battle, playerAction, chooseCpuAction(battle));
}

function makeSide(actor: Fighter, opponent: Fighter, action: Action, round: number): Side {
  return {
    actor,
    opponent,
    action,
    turn: { round, plays: [], dice: null, monsterHits: [], statusTicks: [] },
    cardPlays: action.cards.map((card) => ({ card, play: newPlay(card) })),
    ultimatePlay: action.ultimate ? newPlay(null) : null,
    interruptsPending: 0,
  };
}

// Resolve one round from both sides' already-committed turns. playRound uses
// this with the CPU's pick; online PvP calls it directly with both players'
// picks once the server has collected them. Turns are assumed to have
// passed checkPlan (planAction).
export function resolveRound(battle: Battle, playerAction: Action, cpuAction: Action): void {
  if (isBattleOver(battle)) return;

  // Durations tick down at the start of the round, before either side's
  // choice resolves, so something set up last round is still live for this
  // round's simultaneous resolution and only expires once a full round has
  // passed.
  tickStatusDurations(battle.player);
  tickStatusDurations(battle.cpu);

  const sides: [Side, Side] = [
    makeSide(battle.player, battle.cpu, playerAction, battle.round),
    makeSide(battle.cpu, battle.player, cpuAction, battle.round),
  ];

  addLog(battle, `-- Round ${battle.round} --`);
  applySetupPhase(sides[0], battle);
  applySetupPhase(sides[1], battle);
  resolveDamagePhase(battle, sides);
  checkOutcome(battle);
  if (!isBattleOver(battle)) {
    resolveMonsterPhase(battle, sides);
    checkOutcome(battle);
  }
  if (!isBattleOver(battle)) {
    for (const { actor, turn } of sides) {
      tickStatuses(actor, turn);
      for (const tick of turn.statusTicks) {
        if (tick.damage > 0) addLog(battle, `${fighterName(actor)} takes ${tick.damage} from ${STATUS_LABEL[tick.status]}.`);
      }
    }
    checkOutcome(battle);
  }
  for (const side of sides) {
    side.turn.plays = [...side.cardPlays.map((p) => p.play), ...(side.ultimatePlay ? [side.ultimatePlay] : [])];
    side.actor.lastTurn = side.turn;
  }
  if (isBattleOver(battle)) return;

  regenAndDraw(battle.player);
  regenAndDraw(battle.cpu);
  battle.round += 1;
}

// --- small text helpers used by the UI -----------------------------------

function cardName(cardId: string): string {
  try {
    return findCardById(cardId)?.name ?? cardId;
  } catch {
    return cardId; // catalog not loaded (shouldn't happen in the UI)
  }
}

function describeStatus(status: ApplyStatusEffect): string {
  const label = STATUS_LABEL[status.status] ?? status.status;
  const showPotency = status.status !== STATUS.WET && status.status !== STATUS.BLIND;
  return `${label}${showPotency ? ` ${status.potency}` : ""} ${status.duration}t`;
}

export function describeEffect(effect: Effect): string {
  switch (effect.kind) {
    case EFFECT_KIND.STAT_MODIFIER: {
      const amount = effect.mode === MODIFIER_MODE.PERCENT ? `${effect.amount * 100}%` : effect.amount;
      return `${effect.stat.toUpperCase()} ${effect.amount >= 0 ? "+" : ""}${amount}`;
    }
    case EFFECT_KIND.ENERGY_REGEN:
      return `UR regen +${effect.amount}`;
    case EFFECT_KIND.METER_SIPHON:
      return `Drain ${effect.amount} UR`;
    case EFFECT_KIND.SYNERGY_DISABLE:
      return "Disables a synergy";
    case EFFECT_KIND.APPLY_STATUS:
      return describeStatus(effect);
    case EFFECT_KIND.HEAL:
      return `Heal ${effect.amount}`;
    case EFFECT_KIND.GAIN_AP:
      return `+${effect.amount} AP`;
    case EFFECT_KIND.DRAW:
      return `Draw ${effect.count}`;
    case EFFECT_KIND.CLEANSE:
      return "Cleanse";
    case EFFECT_KIND.SUMMON:
      return `Summon ${effect.count > 1 ? `${effect.count} ` : ""}${cardName(effect.cardId)}`;
    default:
      return effect.kind;
  }
}

// What a card does, short enough for the face of a hand card. The AP cost is
// drawn separately (cost gem), so it isn't repeated here.
export function describeCard(card: Card): string {
  const parts: string[] = [];
  switch (card.category) {
    case CARD_CATEGORY.ATTACK: {
      const atk = card as AttackCard;
      parts.push(`${atk.element ?? atk.damageType} ${atk.value}${atk.target === "field" ? " to all monsters" : ""}`);
      if ((atk.priority ?? 0) > 0) parts.push("fast");
      if (atk.interrupts) parts.push("interrupts");
      if (atk.lifesteal) parts.push("lifesteal");
      for (const status of atk.applies ?? []) parts.push(describeStatus(status));
      break;
    }
    case CARD_CATEGORY.DEFEND: {
      const def = card as DefendCard;
      const amount = def.mode === MODIFIER_MODE.PERCENT ? `${def.amount * 100}%` : def.amount;
      parts.push(`${def.damageType} block ${amount} (${def.duration}t)`);
      break;
    }
    case CARD_CATEGORY.BUFF:
    case CARD_CATEGORY.DEBUFF: {
      const fx = card as { effects?: Effect[] };
      parts.push(...(fx.effects ?? []).map(describeEffect));
      break;
    }
    case CARD_CATEGORY.MONSTER: {
      const mon = card as MonsterCard;
      parts.push(`${mon.hp} HP · ${mon.atk} ATK · SPD ${mon.speed}`);
      if (mon.guard) parts.push("guard");
      if (mon.element) parts.push(mon.element);
      for (const status of mon.applies ?? []) parts.push(describeStatus(status));
      break;
    }
    default:
      return "";
  }
  if (card.hpCost) parts.push(`pay ${card.hpCost} HP`);
  if (card.meterCost) parts.push(`pay ${card.meterCost} UR`);
  if (card.uaCharge) parts.push(`+${card.uaCharge} UR`);
  return parts.join(", ");
}
