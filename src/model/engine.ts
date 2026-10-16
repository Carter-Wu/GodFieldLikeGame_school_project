// Battle engine wiring the class/card/synergy model above into an actual
// playable loop. See docs/DESIGN.md for the design this is built from.
//
// Turns are simultaneous: each round, the player commits one action and the
// CPU independently picks its own (from state alone -- chooseCpuAction never
// looks at the player's chosen action), then both resolve together.
//
// The same engine also runs online PvP, server-side in the Supabase Edge
// Function (supabase/functions/game/): there the two sides are two humans,
// still stored in the `player` / `cpu` slots (player 1 / player 2), and
// resolveRound is called with both humans' actions instead of going through
// playRound's CPU. See "Online PvP" in README.md.
//
// A round, in order:
//   1. durations of defends / buffs / debuffs tick down
//   2. setup: both sides pay for their card (AP, plus HP or ultimate meter
//      for some cards) and their defends, buffs, debuffs and monster
//      summons take effect, all at once
//   3. damage: attack cards and ultimates. The higher priority strikes first
//      (ties: both roll a die); if the first strike knocks the other fighter
//      out -- or is an "interrupts" card that lands -- the second one never
//      happens
//   4. monsters on the field attack, fastest first
//   5. statuses: burning / poison deal their damage, every status ticks down
//   6. both sides gain AP and ultimate meter and draw back up to a full hand
//
// AP (action points, docs: "as seen in Hearthstone"): every card costs AP.
// You start with AP_RULES.start, gain AP_RULES.perRound every round (up to
// AP_RULES.max), and unspent AP carries over -- so cheap rounds pay for big
// ones. You still play one card per round; "Rest" plays nothing for a little
// extra AP.
//
// Other simplifications vs. docs/DESIGN.md (kept deliberately, not silently
// dropped):
// - One card per round, not as many as your AP allows -- the round recap
//   and the online protocol are built around one move per side.
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

const HAND_SIZE = 5; // drawn back up to this every round
const MAX_HAND = 7; // "draw" effects can go over HAND_SIZE, up to this

export const AP_RULES = {
  start: 3,
  perRound: 2,
  max: 10,
  restBonus: 1, // extra AP for resting instead of playing a card
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

export interface LastAction {
  round: number;
  kind: string;
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
  // Damage phase: 1 = struck first, 2 = second, null = no attack this round.
  order: number | null;
  dice: number | null; // the die this side rolled for a priority tie
  cancelled: "interrupted" | "knocked_out" | null;
  healed: number;
  apGained: number;
  summoned: string[];
  fieldHits: FieldHit[];
  statusesApplied: StatusId[];
  monsterHits: MonsterHit[]; // made by this fighter's monsters
  statusTicks: StatusTick[]; // end-of-round status damage this fighter took
}

export interface Fighter {
  classDef: ClassDef;
  label: string | null;
  hp: number;
  maxHp: number;
  ap: number;
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
  lastAction: LastAction | null; // what this fighter did in the last resolved round -- see recordAction
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
    lastAction: null, // what this fighter did in the last resolved round -- see recordAction
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

// null if `fighter` can play `card` right now, otherwise why not (shown on
// the battle screen).
export function unplayableReason(fighter: Fighter, card: Card): string | null {
  const cost = cardCost(card);
  if (fighter.ap < cost) return `needs ${cost} AP`;
  if ((card.hpCost ?? 0) > 0 && fighter.hp <= (card.hpCost ?? 0)) return `needs more than ${card.hpCost} HP`;
  if (fighter.ultimateMeter < (card.meterCost ?? 0)) return `needs ${card.meterCost} ultimate meter`;
  if (card.category === CARD_CATEGORY.MONSTER && fighter.field.length >= FIELD_SIZE) return "your field is full";
  return null;
}

export function canPlayCard(fighter: Fighter, card: Card): boolean {
  return unplayableReason(fighter, card) === null;
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

// What happened to one fighter this round, collected while it resolves and
// written into lastAction at the end (see recordAction).
interface RoundNotes {
  hit: HitResult | null;
  order: number | null;
  dice: number | null;
  cancelled: LastAction["cancelled"];
  healed: number;
  apGained: number;
  summoned: string[];
  fieldHits: FieldHit[];
  statusesApplied: StatusId[];
  monsterHits: MonsterHit[];
  statusTicks: StatusTick[];
}

function newNotes(): RoundNotes {
  return {
    hit: null,
    order: null,
    dice: null,
    cancelled: null,
    healed: 0,
    apGained: 0,
    summoned: [],
    fieldHits: [],
    statusesApplied: [],
    monsterHits: [],
    statusTicks: [],
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
  notes: RoundNotes,
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
        if (addStatus(target, effect)) notes.statusesApplied.push(effect.status);
        break;
      case EFFECT_KIND.HEAL:
        notes.healed += healFighter(target, effect.amount);
        break;
      case EFFECT_KIND.GAIN_AP:
        notes.apGained += gainAp(actor, effect.amount);
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
          if (monster) notes.summoned.push(monster.name);
        }
        break;
      }
      default:
        // CONDITIONAL: not implemented yet, see docs/DESIGN.md.
        break;
    }
  }
}

function resolveAttackCard(attacker: Fighter, defender: Fighter, card: AttackCard, notes: RoundNotes): HitResult {
  const stats = computeCurrentStats(attacker);
  const value = Math.max(0, blinded(attacker, card.value + (card.value > 0 ? stats.atk : 0)));

  if (card.target === "field") {
    for (const monster of [...defender.field]) notes.fieldHits.push(damageMonster(defender, monster, value));
    return { damage: 0, guarded: 0, resisted: 0 };
  }

  const guard = blockingMonster(defender);
  if (guard) {
    notes.fieldHits.push(damageMonster(defender, guard, value));
    return { damage: 0, guarded: 0, resisted: 0 };
  }

  const hit = strikeFighter(defender, applyElement(defender, value, card.element), card.damageType);
  if (card.lifesteal) notes.healed += healFighter(attacker, Math.floor(hit.damage * card.lifesteal));
  for (const status of card.applies ?? []) {
    if (addStatus(defender, status)) notes.statusesApplied.push(status.status);
  }
  return hit;
}

// Remove a played card from hand into the discard pile, pay for it, and
// count it toward its category's synergy. Shared by every card category --
// attack cards get this too, even though their actual effect is resolved
// later (see resolveDamagePhase) so that both sides' attacks use post-setup
// state.
function commitCardHousekeeping(actor: Fighter, card: Card): void {
  actor.ap -= cardCost(card);
  actor.hp = Math.max(1, actor.hp - (card.hpCost ?? 0));
  actor.ultimateMeter = Math.max(0, actor.ultimateMeter - (card.meterCost ?? 0)) + (card.uaCharge ?? 0);
  actor.cardsPlayedByCategory[card.category] = (actor.cardsPlayedByCategory[card.category] ?? 0) + 1;
  const index = actor.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) actor.hand.splice(index, 1);
  actor.discard.push(card);
}

function useUltimate(actor: Fighter, opponent: Fighter, notes: RoundNotes, round: number): HitResult {
  const ultimate = actor.classDef.ultimate;
  actor.ultimateMeter -= ultimate.cost;
  const damage = ultimate.damage ?? 0;
  opponent.hp = Math.max(0, opponent.hp - damage);
  if (ultimate.effects?.length) applyEffects(actor, actor, ultimate.effects, ultimate.duration ?? 3, notes, round);
  return { damage, guarded: 0, resisted: 0 };
}

// Tick every duration a fighter is carrying (active defends, temporary
// buff/debuff modifiers, disabled synergies) down by one. Called at the
// START of that fighter's own turn -- NOT right after they play the card
// that created them -- so e.g. a duration:1 defend card actually survives to
// see the opponent's next attack instead of expiring before the opponent
// ever gets a turn. (Statuses tick at the END of the round instead -- see
// tickStatuses.)
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
function tickStatuses(fighter: Fighter, notes: RoundNotes): void {
  for (const id of Object.keys(fighter.statuses) as StatusId[]) {
    const state = fighter.statuses[id];
    if (!state) continue;
    if (id === STATUS.BURNING || id === STATUS.POISON) {
      const damage = Math.min(fighter.hp, state.potency);
      fighter.hp -= damage;
      notes.statusTicks.push({ status: id, damage });
    }
    state.remaining -= 1;
    if (state.remaining <= 0) delete fighter.statuses[id];
  }
}

// After the round: AP and ultimate meter come in and the hand refills.
// (Duration ticking is deliberately NOT here -- see tickStatusDurations.)
function regenAndDraw(fighter: Fighter): void {
  gainAp(fighter, AP_RULES.perRound);
  fighter.ultimateMeter += currentUltimateRegen(fighter);
  drawUpTo(fighter);
}

// --- battle-level state --------------------------------------------------
//
// An "action" a fighter commits to a round is one of:
//   { kind: "card", card }
//   { kind: "ultimate" }
//   { kind: "rest" }        -- play nothing, gain AP_RULES.restBonus extra AP
//   { kind: "none" }        -- nothing available to play (empty hand)

export type Action = { kind: "card"; card: Card } | { kind: "ultimate" } | { kind: "rest" } | { kind: "none" };

export interface Battle {
  player: Fighter;
  cpu: Fighter;
  round: number;
  winner: Fighter | null; // the winning fighter, or null while the game is ongoing
  draw: boolean; // true if both fighters ran out of HP in the same round
  log: string[];
}

// Client wire action (what the browser sends the server — card identity only,
// since the server re-checks it against its own copy).
export type ClientAction = { kind: "card"; cardId: number } | { kind: "ultimate" } | { kind: "rest" };

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

// --- committing an action (without resolving it yet) ----------------------

// null if the card isn't in hand or can't be paid for.
export function cardAction(fighter: Fighter, cardId: number): Action | null {
  const card = fighter.hand.find((c) => c.id === cardId);
  return card && canPlayCard(fighter, card) ? { kind: "card", card } : null;
}

export function ultimateAction(fighter: Fighter): Action | null {
  return canUseUltimate(fighter) ? { kind: "ultimate" } : null;
}

export function restAction(): Action {
  return { kind: "rest" };
}

// Very simple CPU: use its ultimate the moment it's ready, otherwise defend
// when low on HP, otherwise summon or favor its strongest attack, with
// occasional debuff/buff plays -- among the cards it can afford, resting
// when it can't afford any. Deliberately reads only battle.cpu's own state
// -- never the player's pending action -- so this is a fair simultaneous
// decision, not a reaction to what the player is about to do.
function chooseCpuAction(battle: Battle): Action {
  const cpu = battle.cpu;
  if (canUseUltimate(cpu)) return { kind: "ultimate" };

  if (cpu.hand.length === 0) return { kind: "none" };
  const hand = cpu.hand.filter((c) => canPlayCard(cpu, c));
  if (hand.length === 0) return { kind: "rest" };

  const attacks = hand.filter((c) => c.category === CARD_CATEGORY.ATTACK) as AttackCard[];
  const defends = hand.filter((c) => c.category === CARD_CATEGORY.DEFEND) as DefendCard[];
  const monsters = hand.filter((c) => c.category === CARD_CATEGORY.MONSTER) as MonsterCard[];
  const debuffs = hand.filter((c) => c.category === CARD_CATEGORY.DEBUFF);
  const buffs = hand.filter((c) => c.category === CARD_CATEGORY.BUFF);
  const lowHp = cpu.hp <= cpu.maxHp * 0.4;

  let card: Card;
  if (lowHp && defends.length > 0) {
    card = defends.reduce((a, b) => (a.amount >= b.amount ? a : b));
  } else if (monsters.length > 0 && random() < 0.6) {
    card = monsters.reduce((a, b) => (a.atk + a.hp >= b.atk + b.hp ? a : b));
  } else if (attacks.length > 0 && random() < 0.7) {
    card = attacks.reduce((a, b) => (a.value >= b.value ? a : b));
  } else if (debuffs.length > 0 && random() < 0.5) {
    card = debuffs[0] as Card; // length checked above
  } else if (buffs.length > 0) {
    card = buffs[0] as Card; // length checked above
  } else {
    card = hand[0] as Card; // empty hand returned above
  }
  return { kind: "card", card };
}

// --- resolving a round ------------------------------------------------------

// Defends, buffs/debuffs and summons from an action go live immediately (the
// "setup" phase); attacks and ultimates are resolved afterwards for both
// sides (the "damage" phase). Running every action's setup before anyone's
// damage is what makes a defend card played this round able to block an
// attack played this same round, instead of only protecting against the
// opponent's *next* round -- the two sides' choices are hidden from each
// other but resolve together.
function applySetupPhase(actor: Fighter, opponent: Fighter, action: Action, battle: Battle, notes: RoundNotes): void {
  if (action.kind === "rest") {
    notes.apGained += gainAp(actor, AP_RULES.restBonus);
    addLog(battle, `${fighterName(actor)} rests (+${AP_RULES.restBonus} AP).`);
    return;
  }
  if (action.kind !== "card") return;
  const card = action.card;
  commitCardHousekeeping(actor, card);

  switch (card.category) {
    case CARD_CATEGORY.DEFEND:
      actor.activeDefends[card.damageType] = { card, remaining: card.duration };
      addLog(battle, `${fighterName(actor)} sets up ${card.name} (defend).`);
      break;
    case CARD_CATEGORY.BUFF:
      applyEffects(actor, actor, card.effects, card.duration ?? 1, notes, battle.round);
      addLog(battle, `${fighterName(actor)} plays ${card.name} (buff).`);
      break;
    case CARD_CATEGORY.DEBUFF:
      applyEffects(actor, opponent, card.effects, card.duration ?? 1, notes, battle.round);
      addLog(battle, `${fighterName(actor)} plays ${card.name} (debuff).`);
      break;
    case CARD_CATEGORY.MONSTER:
      if (summonMonster(actor, card, battle.round)) notes.summoned.push(card.name);
      addLog(battle, `${fighterName(actor)} summons ${card.name}.`);
      break;
    // ATTACK is resolved in resolveDamagePhase, once both sides' defends and
    // buffs/debuffs for this round are already in place.
  }
}

function isDamageAction(action: Action): boolean {
  return action.kind === "ultimate" || (action.kind === "card" && action.card.category === CARD_CATEGORY.ATTACK);
}

function actionPriority(fighter: Fighter, action: Action): number {
  const base = action.kind === "ultimate" ? ULTIMATE_PRIORITY : action.kind === "card" ? (action.card.priority ?? 0) : 0;
  return base - statusPotency(fighter, STATUS.SLOWED);
}

interface Side {
  actor: Fighter;
  opponent: Fighter;
  action: Action;
  notes: RoundNotes;
}

// Attacks and ultimates, the higher priority first. Equal priority: both
// roll a die (rerolling ties), highest goes first (docs: "If the priority
// level is the same, use dice").
function resolveDamagePhase(battle: Battle, sides: [Side, Side]): void {
  const acting = sides.filter((s) => isDamageAction(s.action));
  if (acting.length === 2) {
    const [a, b] = acting as [Side, Side];
    const pa = actionPriority(a.actor, a.action);
    const pb = actionPriority(b.actor, b.action);
    let bFirst = pb > pa;
    if (pa === pb) {
      let da = rollDie();
      let db = rollDie();
      for (let i = 0; da === db && i < 20; i++) {
        da = rollDie();
        db = rollDie();
      }
      if (da === db) db = da === 6 ? 5 : da + 1; // vanishingly unlikely; just settle it
      a.notes.dice = da;
      b.notes.dice = db;
      bFirst = db > da;
      addLog(battle, `Dice: ${fighterName(a.actor)} ${da}, ${fighterName(b.actor)} ${db}.`);
    }
    if (bFirst) acting.reverse();
  }

  let interrupted = false;
  acting.forEach((side, i) => {
    const { actor, opponent, action, notes } = side;
    if (actor.hp <= 0) {
      notes.cancelled = "knocked_out";
      addLog(battle, `${fighterName(actor)} goes down before acting.`);
      return;
    }
    if (interrupted && action.kind === "card") {
      notes.cancelled = "interrupted";
      addLog(battle, `${fighterName(actor)}'s ${action.card.name} is interrupted!`);
      return;
    }
    notes.order = i + 1;
    if (action.kind === "ultimate") {
      notes.hit = useUltimate(actor, opponent, notes, battle.round);
      addLog(battle, `${fighterName(actor)} unleashes its ultimate for ${notes.hit.damage} damage!`);
      return;
    }
    if (action.kind !== "card") return;
    const card = action.card as AttackCard;
    notes.hit = resolveAttackCard(actor, opponent, card, notes);
    if (notes.fieldHits.length > 0) {
      addLog(battle, `${fighterName(actor)}'s ${card.name} hits ${notes.fieldHits.map((h) => `${h.target} (${h.damage})`).join(", ")}.`);
    } else {
      addLog(battle, `${fighterName(actor)} hits with ${card.name} for ${notes.hit.damage} damage.`);
    }
    if (card.interrupts && notes.hit.damage > 0) interrupted = true;
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
    const { actor, opponent, notes } = side;
    if (monster.hp <= 0 || actor.hp <= 0 || opponent.hp <= 0) continue;
    const atk = Math.max(0, blinded(actor, monster.atk));
    const target = blockingMonster(opponent) ?? opponent.field[0];
    order += 1;
    if (target) {
      const hit = damageMonster(opponent, target, atk);
      notes.monsterHits.push({ order, attacker: monster.name, target: target.name, damage: hit.damage, guarded: 0, resisted: 0, killed: hit.killed, damageType: monster.damageType });
      addLog(battle, `${monster.name} hits ${target.name} for ${hit.damage}${hit.killed ? " -- destroyed!" : "."}`);
      continue;
    }
    const hit = strikeFighter(opponent, applyElement(opponent, atk, monster.element), monster.damageType, false);
    for (const status of monster.applies) addStatus(opponent, status);
    notes.monsterHits.push({ order, attacker: monster.name, target: "fighter", ...hit, killed: false, damageType: monster.damageType });
    addLog(battle, `${monster.name} hits ${fighterName(opponent)} for ${hit.damage}.`);
  }
}

// A plain-JSON summary of what a fighter did this round, kept on the fighter
// as `lastAction` so the UI can replay the round (animation) once it
// resolves. It's public: the same information is already in the battle log.
function recordAction(fighter: Fighter, action: Action, round: number, notes: RoundNotes): void {
  const card = action.kind === "card" ? action.card : null;
  const isDefend = card?.category === CARD_CATEGORY.DEFEND;
  const defendCard = isDefend ? (card as DefendCard) : null;
  const hit = notes.hit;
  fighter.lastAction = {
    round,
    kind: action.kind,
    cardId: card?.cardId ?? null,
    name: card?.name ?? null,
    category: card?.category ?? null,
    damageType: (card as { damageType?: DamageType } | null)?.damageType ?? null,
    element: card?.element ?? null,
    cost: card ? cardCost(card) : null,
    description: card ? describeCard(card) : null,
    damage: hit?.damage ?? null,
    guarded: hit?.guarded ?? 0, // absorbed by the target's defend card
    resisted: hit?.resisted ?? 0, // absorbed by the target's DEF/MR/ER
    guard: isDefend && defendCard ? { amount: defendCard.amount, mode: defendCard.mode, duration: defendCard.duration } : null,
    order: notes.order,
    dice: notes.dice,
    cancelled: notes.cancelled,
    healed: notes.healed,
    apGained: notes.apGained,
    summoned: notes.summoned,
    fieldHits: notes.fieldHits,
    statusesApplied: notes.statusesApplied,
    monsterHits: notes.monsterHits,
    statusTicks: notes.statusTicks,
  };
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

// Commit the player's chosen action for this round, have the CPU
// independently commit its own, then resolve both together.
export function playRound(battle: Battle, playerAction: Action | null): void {
  if (isBattleOver(battle) || !playerAction) return;
  resolveRound(battle, playerAction, chooseCpuAction(battle));
}

// Resolve one round from both sides' already-committed actions. playRound
// uses this with the CPU's pick; online PvP calls it directly with both
// players' picks once the server has collected them.
export function resolveRound(battle: Battle, playerAction: Action, cpuAction: Action): void {
  if (isBattleOver(battle)) return;

  // Durations tick down at the start of the round, before either side's
  // choice resolves, so something set up last round is still live for this
  // round's simultaneous resolution and only expires once a full round has
  // passed.
  tickStatusDurations(battle.player);
  tickStatusDurations(battle.cpu);

  const sides: [Side, Side] = [
    { actor: battle.player, opponent: battle.cpu, action: playerAction, notes: newNotes() },
    { actor: battle.cpu, opponent: battle.player, action: cpuAction, notes: newNotes() },
  ];

  addLog(battle, `-- Round ${battle.round} --`);
  applySetupPhase(battle.player, battle.cpu, playerAction, battle, sides[0].notes);
  applySetupPhase(battle.cpu, battle.player, cpuAction, battle, sides[1].notes);
  resolveDamagePhase(battle, sides);
  checkOutcome(battle);
  if (!isBattleOver(battle)) {
    resolveMonsterPhase(battle, sides);
    checkOutcome(battle);
  }
  if (!isBattleOver(battle)) {
    tickStatuses(battle.player, sides[0].notes);
    tickStatuses(battle.cpu, sides[1].notes);
    for (const { actor, notes } of sides) {
      for (const tick of notes.statusTicks) {
        if (tick.damage > 0) addLog(battle, `${fighterName(actor)} takes ${tick.damage} from ${STATUS_LABEL[tick.status]}.`);
      }
    }
    checkOutcome(battle);
  }
  recordAction(battle.player, playerAction, battle.round, sides[0].notes);
  recordAction(battle.cpu, cpuAction, battle.round, sides[1].notes);
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
