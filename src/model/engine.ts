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
// Other simplifications vs. docs/DESIGN.md (kept deliberately, not silently
// dropped):
// - No fog of war / troop placement yet.
// - A defend card fully replaces any earlier active defend of the same damage
//   type rather than adding to it, even when `stacking` is STACKABLE -- true
//   stacking amounts aren't modeled yet either (STACKABLE currently only
//   means "don't consume this on the first hit it blocks").
// - CONDITIONAL and SUMMON effects are accepted but are currently no-ops.

import { shuffle } from "./util.ts";
import { resolveSynergies } from "./synergies.ts";
import { EFFECT_KIND, MODIFIER_MODE, type Effect } from "./effects.ts";
import { computeEffectiveStats, type ClassDef } from "./classes.ts";
import { applyDefend, CARD_CATEGORY, STACKING, type AttackCard, type Card, type DefendCard } from "./cardTypes.ts";
import { RESIST_STAT, type DamageType } from "./damageTypes.ts";
import { buildDeckForClass } from "./catalog.ts";
import type { Stats } from "./stats.ts";

const HAND_SIZE = 5;

// --- fighter state -----------------------------------------------------

export interface TempModifier {
  effect: Effect;
  remaining: number;
}

export interface ActiveDefend {
  card: Card;
  remaining: number;
}

export interface GuardInfo {
  amount: number;
  mode: string;
  duration: number;
}

export interface LastAction {
  round: number;
  kind: string;
  cardId: string | null;
  name: string | null;
  category: string | null;
  damageType: DamageType | null;
  description: string | null;
  damage: number | null;
  guarded: number; // absorbed by the target's defend card
  resisted: number; // absorbed by the target's DEF/MR/ER
  guard: GuardInfo | null;
}

export interface Fighter {
  classDef: ClassDef;
  label: string | null;
  hp: number;
  maxHp: number;
  deck: Card[];
  discard: Card[];
  hand: Card[];
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
    deck,
    discard: [],
    hand: [],
    ultimateMeter: 0,
    cardsPlayedByCategory: { attack: 0, defend: 0, buff: 0, debuff: 0 },
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

function drawUpTo(fighter: Fighter): void {
  while (fighter.hand.length < HAND_SIZE) {
    const card = drawCard(fighter);
    if (!card) break;
    fighter.hand.push(card);
  }
}

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
  return computeEffectiveStats(fighter.classDef, [...synergyEffects, ...tempStatEffects]);
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

// --- resolving a played card --------------------------------------------

// Returns { damage, guarded, resisted }: the damage dealt, and how much of
// the card's value the defender's active defend card and resistance stat
// each absorbed (shown in the round recap).
export interface HitResult {
  damage: number;
  guarded: number;
  resisted: number;
}

function resolveAttack(attacker: Fighter, defender: Fighter, card: AttackCard): HitResult {
  void attacker;
  const defenderStats = computeCurrentStats(defender);
  const activeDefend = defender.activeDefends[card.damageType] ?? null;
  const afterDefend = applyDefend(card, (activeDefend ? activeDefend.card : null) as DefendCard | null);
  let value = afterDefend;

  const resistKey = (RESIST_STAT as Partial<Record<DamageType, keyof Stats>>)[card.damageType]; // undefined for TRUE damage
  if (resistKey) {
    value = Math.max(0, value - defenderStats[resistKey]);
  }

  if (activeDefend && (activeDefend.card as DefendCard).stacking === STACKING.NONSTACKABLE) {
    delete defender.activeDefends[card.damageType];
  }

  defender.hp = Math.max(0, defender.hp - value);
  return { damage: value, guarded: card.value - afterDefend, resisted: afterDefend - value };
}

function resolveDefend(actor: Fighter, card: DefendCard): void {
  actor.activeDefends[card.damageType] = {
    card,
    remaining: card.duration,
  };
}

function resolveStatusEffects(actor: Fighter, target: Fighter, card: Card): void {
  void actor;
  const stream = card as { effects?: Effect[]; duration?: number };
  for (const effect of stream.effects ?? []) {
    switch (effect.kind) {
      case EFFECT_KIND.METER_SIPHON:
        target.ultimateMeter = Math.max(0, target.ultimateMeter - effect.amount);
        break;
      case EFFECT_KIND.SYNERGY_DISABLE:
        target.disabledSynergies.add(effect.synergyId);
        target.disabledSynergyTimers[effect.synergyId] = stream.duration ?? 1;
        break;
      case EFFECT_KIND.STAT_MODIFIER:
      case EFFECT_KIND.ENERGY_REGEN:
        target.tempModifiers.push({ effect, remaining: stream.duration ?? 1 });
        break;
      default:
        // CONDITIONAL / SUMMON: not implemented yet, see docs/DESIGN.md.
        break;
    }
  }
}

// Remove a played card from hand into the discard pile and count it toward
// its category's synergy. Shared by every card category -- attack cards get
// this too, even though their actual effect is resolved later (see
// applyDamagePhase) so that both sides' attacks use post-setup state.
function commitCardHousekeeping(actor: Fighter, card: Card): void {
  actor.cardsPlayedByCategory[card.category] = (actor.cardsPlayedByCategory[card.category] ?? 0) + 1;
  const index = actor.hand.findIndex((c) => c.id === card.id);
  if (index !== -1) actor.hand.splice(index, 1);
  actor.discard.push(card);
}

function useUltimate(actor: Fighter, opponent: Fighter): number {
  actor.ultimateMeter -= actor.classDef.ultimate.cost;
  const damage = actor.classDef.ultimate.damage ?? 0;
  opponent.hp = Math.max(0, opponent.hp - damage);
  return damage;
}

// Tick every duration a fighter is carrying (active defends, temporary
// buff/debuff modifiers, disabled synergies) down by one. Called at the
// START of that fighter's own turn -- NOT right after they play the card
// that created them -- so e.g. a duration:1 defend card actually survives to
// see the opponent's next attack instead of expiring before the opponent
// ever gets a turn.
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

// Right after a fighter's own action: regen their ultimate meter and refill
// their hand. (Duration ticking is deliberately NOT here -- see
// tickStatusDurations above.)
function regenAndDraw(fighter: Fighter): void {
  fighter.ultimateMeter += currentUltimateRegen(fighter);
  drawUpTo(fighter);
}

// --- battle-level state --------------------------------------------------
//
// An "action" a fighter commits to a round is one of:
//   { kind: "card", card }
//   { kind: "ultimate" }
//   { kind: "none" }        -- nothing available to play (empty hand)

export type Action = { kind: "card"; card: Card } | { kind: "ultimate" } | { kind: "none" };

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
export type ClientAction = { kind: "card"; cardId: number } | { kind: "ultimate" };

export function createBattle(
  playerClass: ClassDef,
  cpuClass: ClassDef,
  { playerLabel = null, cpuLabel = null }: { playerLabel?: string | null; cpuLabel?: string | null } = {}
): Battle {
  const battle: Battle = {
    player: createFighter(playerClass, buildDeckForClass(playerClass), playerLabel),
    cpu: createFighter(cpuClass, buildDeckForClass(cpuClass), cpuLabel),
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

export function cardAction(fighter: Fighter, cardId: number): Action | null {
  const card = fighter.hand.find((c) => c.id === cardId);
  return card ? { kind: "card", card } : null;
}

export function ultimateAction(fighter: Fighter): Action | null {
  return canUseUltimate(fighter) ? { kind: "ultimate" } : null;
}

// Very simple CPU: use its ultimate the moment it's ready, otherwise defend
// when low on HP, otherwise favor its strongest attack, with occasional
// debuff/buff plays. Deliberately reads only battle.cpu's own state -- never
// the player's pending action -- so this is a fair simultaneous decision, not
// a reaction to what the player is about to do.
function chooseCpuAction(battle: Battle): Action {
  const cpu = battle.cpu;
  if (canUseUltimate(cpu)) return { kind: "ultimate" };

  const hand = cpu.hand;
  if (hand.length === 0) return { kind: "none" };

  const attacks = hand.filter((c) => c.category === CARD_CATEGORY.ATTACK) as AttackCard[];
  const defends = hand.filter((c) => c.category === CARD_CATEGORY.DEFEND) as DefendCard[];
  const debuffs = hand.filter((c) => c.category === CARD_CATEGORY.DEBUFF);
  const buffs = hand.filter((c) => c.category === CARD_CATEGORY.BUFF);
  const lowHp = cpu.hp <= cpu.maxHp * 0.4;

  let card: Card;
  if (lowHp && defends.length > 0) {
    card = defends.reduce((a, b) => (a.amount >= b.amount ? a : b));
  } else if (attacks.length > 0 && Math.random() < 0.7) {
    card = attacks.reduce((a, b) => (a.value >= b.value ? a : b));
  } else if (debuffs.length > 0 && Math.random() < 0.5) {
    card = debuffs[0] as Card; // length checked above
  } else if (buffs.length > 0) {
    card = buffs[0] as Card; // length checked above
  } else {
    card = hand[0] as Card; // empty hand returned "none" above
  }
  return { kind: "card", card };
}

// --- resolving a round ------------------------------------------------------

// Defends and buffs/debuffs from an action go live immediately (the "setup"
// phase); attacks and ultimates are resolved afterwards for both sides (the
// "damage" phase). Running every action's setup before anyone's damage is
// what makes a defend card played this round able to block an attack played
// this same round, instead of only protecting against the opponent's *next*
// round -- the two sides' choices are hidden from each other but resolve
// together.
function applySetupPhase(actor: Fighter, opponent: Fighter, action: Action, battle: Battle): void {
  if (action.kind !== "card") return;
  const card = action.card;
  commitCardHousekeeping(actor, card);

  switch (card.category) {
    case CARD_CATEGORY.DEFEND:
      resolveDefend(actor, card);
      addLog(battle, `${fighterName(actor)} sets up ${card.name} (defend).`);
      break;
    case CARD_CATEGORY.BUFF:
      resolveStatusEffects(actor, actor, card);
      addLog(battle, `${fighterName(actor)} plays ${card.name} (buff).`);
      break;
    case CARD_CATEGORY.DEBUFF:
      resolveStatusEffects(actor, opponent, card);
      addLog(battle, `${fighterName(actor)} plays ${card.name} (debuff).`);
      break;
    // ATTACK is resolved in applyDamagePhase, once both sides' defends and
    // buffs/debuffs for this round are already in place.
  }
}

// Returns { damage, guarded, resisted } (see resolveAttack), or null for
// actions that don't deal damage.
function applyDamagePhase(actor: Fighter, opponent: Fighter, action: Action, battle: Battle): HitResult | null {
  if (action.kind === "ultimate") {
    const damage = useUltimate(actor, opponent);
    addLog(battle, `${fighterName(actor)} unleashes its ultimate for ${damage} damage!`);
    return { damage, guarded: 0, resisted: 0 };
  }
  if (action.kind === "card" && action.card.category === CARD_CATEGORY.ATTACK) {
    const hit = resolveAttack(actor, opponent, action.card as AttackCard);
    addLog(battle, `${fighterName(actor)} hits with ${action.card.name} for ${hit.damage} damage.`);
    return hit;
  }
  return null;
}

// A plain-JSON summary of what a fighter did this round, kept on the fighter
// as `lastAction` so the UI can replay the round (animation) once it
// resolves. It's public: the same information is already in the battle log.
function recordAction(fighter: Fighter, action: Action, round: number, hit: HitResult | null): void {
  const card = action.kind === "card" ? action.card : null;
  const isDefend = card?.category === CARD_CATEGORY.DEFEND;
  const defendCard = isDefend ? (card as DefendCard) : null;
  fighter.lastAction = {
    round,
    kind: action.kind,
    cardId: card?.cardId ?? null,
    name: card?.name ?? null,
    category: card?.category ?? null,
    damageType: (card as { damageType?: DamageType } | null)?.damageType ?? null,
    description: card ? describeCard(card) : null,
    damage: hit?.damage ?? null,
    guarded: hit?.guarded ?? 0, // absorbed by the target's defend card
    resisted: hit?.resisted ?? 0, // absorbed by the target's DEF/MR/ER
    guard: isDefend && defendCard ? { amount: defendCard.amount, mode: defendCard.mode, duration: defendCard.duration } : null,
  };
}

function checkOutcome(battle: Battle): void {
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

  addLog(battle, `-- Round ${battle.round} --`);
  applySetupPhase(battle.player, battle.cpu, playerAction, battle);
  applySetupPhase(battle.cpu, battle.player, cpuAction, battle);
  const playerHit = applyDamagePhase(battle.player, battle.cpu, playerAction, battle);
  const cpuHit = applyDamagePhase(battle.cpu, battle.player, cpuAction, battle);
  recordAction(battle.player, playerAction, battle.round, playerHit);
  recordAction(battle.cpu, cpuAction, battle.round, cpuHit);

  checkOutcome(battle);
  if (isBattleOver(battle)) return;

  regenAndDraw(battle.player);
  regenAndDraw(battle.cpu);
  battle.round += 1;
}

// --- small text helpers used by the UI -----------------------------------

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
    default:
      return effect.kind;
  }
}

export function describeCard(card: Card): string {
  switch (card.category) {
    case CARD_CATEGORY.ATTACK: {
      const atk = card as AttackCard;
      return `${atk.damageType} ${atk.value}`;
    }
    case CARD_CATEGORY.DEFEND: {
      const def = card as DefendCard;
      const amount = def.mode === MODIFIER_MODE.PERCENT ? `${def.amount * 100}%` : def.amount;
      return `${def.damageType} block ${amount} (${def.duration}t)`;
    }
    case CARD_CATEGORY.BUFF:
    case CARD_CATEGORY.DEBUFF: {
      const fx = card as { effects: Effect[] };
      return fx.effects.map(describeEffect).join(", ");
    }
    default:
      return "";
  }
}
