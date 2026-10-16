// General card schema: attack / defend / buff / debuff / monster, per
// docs/DESIGN.md ("General card types").

import { MODIFIER_MODE, type ApplyStatusEffect, type Effect, type ModifierMode } from "./effects.ts";
import type { DamageType, Element } from "./damageTypes.ts";

let modelCardIdCounter = 0;

export const CARD_CATEGORY = {
  ATTACK: "attack",
  DEFEND: "defend",
  BUFF: "buff",
  DEBUFF: "debuff",
  MONSTER: "monster",
} as const;

export type CardCategory = (typeof CARD_CATEGORY)[keyof typeof CARD_CATEGORY];

export const STACKING = {
  STACKABLE: "stackable",
  NONSTACKABLE: "nonstackable",
} as const;

export type Stacking = (typeof STACKING)[keyof typeof STACKING];

// Props every category may carry. All optional so older catalog rows (and
// cards added in the dashboard without them) still load; missing = 0 / none.
//   cost      - action points (AP) it takes to play (see engine.ts "AP")
//   uaCharge  - extra ultimate meter gained when it's played
//   priority  - attack cards only matter here: the higher one strikes first;
//               ties are settled with a dice roll
//   hpCost    - HP paid to play it (Black Mage); can't be played if it would
//               leave you at 0
//   meterCost - ultimate meter paid to play it
//   element   - fire / water / electric affinity (see damageTypes.ts)
export interface CardCommon {
  id: number;
  cardId?: string;
  name: string;
  imageUrl?: string | null;
  cost?: number;
  uaCharge?: number;
  priority?: number;
  hpCost?: number;
  meterCost?: number;
  element?: Element | null;
}

// Attack card: deals `value` damage of `damageType` (+ the attacker's ATK).
//   applies    - statuses put on the target when it lands
//   lifesteal  - heal for this fraction of the damage actually dealt
//   interrupts - if it strikes first and deals damage, the opponent's attack
//                card this round is cancelled
//   target     - "field" hits every enemy monster instead of the fighter;
//                otherwise the player picks the target when playing it
export interface AttackCard extends CardCommon {
  category: "attack";
  damageType: DamageType;
  value: number;
  applies?: ApplyStatusEffect[];
  lifesteal?: number;
  interrupts?: boolean;
  target?: "fighter" | "field";
}

export interface DefendCard extends CardCommon {
  category: "defend";
  damageType: DamageType;
  mode: ModifierMode; // MODIFIER_MODE.FLAT | MODIFIER_MODE.PERCENT
  amount: number;
  stacking: Stacking; // STACKING.STACKABLE | STACKING.NONSTACKABLE
  duration: number; // number of turns this defend lasts
}

export interface BuffCard extends CardCommon {
  category: "buff";
  effects: Effect[];
  duration: number;
}

export interface DebuffCard extends CardCommon {
  category: "debuff";
  effects: Effect[];
  duration: number;
}

// A monster's special move, used instead of a plain attack (for its own AP
// cost). "enemy" moves with `damage` hit a target you pick, like an attack;
// their `effects` (and every "self" move's) work like a debuff / buff card
// played by the monster's owner, lasting `duration` rounds.
export interface MonsterAbility {
  name: string;
  cost: number;
  target: "enemy" | "self";
  damage?: number;
  damageType?: DamageType;
  element?: Element | null;
  applies?: ApplyStatusEffect[];
  effects?: Effect[];
  duration?: number;
}

// Monster card: puts a monster on the player's field (docs: "Monster Card
// (HP, Speed)"). From the round after it's summoned, its owner can order it
// once per round -- an attack for `attackCost` AP (default 1), or its
// `ability` for the ability's cost -- at a target they pick: an enemy
// monster, or the enemy fighter (whose DEF/MR/ER it gets past; a defend card
// still blocks it). Ordered monsters act after the attack cards, fastest
// first.
//   guard - enemy attacks (cards and monsters) have to target this monster
export interface MonsterCard extends CardCommon {
  category: "monster";
  hp: number;
  atk: number;
  speed: number;
  damageType: DamageType;
  applies?: ApplyStatusEffect[];
  guard?: boolean;
  attackCost?: number;
  ability?: MonsterAbility | null;
}

export type Card = AttackCard | DefendCard | BuffCard | DebuffCard | MonsterCard;

// Attack card: deals `value` damage of `damageType`.
export function createAttackCard({
  name,
  damageType,
  value,
}: {
  name: string;
  damageType: DamageType;
  value: number;
}): AttackCard {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.ATTACK,
    name,
    damageType,
    value,
  };
}

// Defend card: reduces incoming damage of `damageType` for `duration` turns.
export function createDefendCard({
  name,
  damageType,
  mode,
  amount,
  stacking,
  duration,
}: {
  name: string;
  damageType: DamageType;
  mode: ModifierMode;
  amount: number;
  stacking: Stacking;
  duration: number;
}): DefendCard {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.DEFEND,
    name,
    damageType,
    mode,
    amount,
    stacking,
    duration,
    // number of turns this defend lasts
  };
}

// Buff card: grants one or more positive effects for `duration` turns.
export function createBuffCard({
  name,
  effects,
  duration,
}: {
  name: string;
  effects: Effect[];
  duration: number;
}): BuffCard {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.BUFF,
    name,
    effects,
    duration,
  };
}

// Debuff card: grants one or more negative effects for `duration` turns.
export function createDebuffCard({
  name,
  effects,
  duration,
}: {
  name: string;
  effects: Effect[];
  duration: number;
}): DebuffCard {
  return {
    id: ++modelCardIdCounter,
    category: CARD_CATEGORY.DEBUFF,
    name,
    effects,
    duration,
  };
}

export interface CardDefinition {
  id: string;
  name: string;
  category: CardCategory;
  props: Record<string, never>;
  imageUrl?: string | null;
}

// One playable copy of a catalog card definition (a `cards` row: { id, name,
// category, props }). Props are spread flat so an instance has the same shape
// the create*Card helpers above produce; `id` is this copy's per-battle
// number and `cardId` the catalog id it came from.
export function createCardInstance(definition: {
  id: string;
  name: string;
  category: string;
  props?: Record<string, unknown>;
  imageUrl?: string | null;
}): Card {
  return {
    ...(definition.props ?? {}),
    id: ++modelCardIdCounter,
    cardId: definition.id,
    category: definition.category,
    name: definition.name,
    imageUrl: definition.imageUrl ?? null,
  } as Card;
}

// Resolve a defend card against an incoming attack card, returning the damage
// that actually gets through. A defend card only applies to a matching
// damageType (a "physical" defend does nothing against "magic" damage, and
// "true" damage only gets blocked by a defend card that explicitly names
// "true"). Stacking multiple simultaneous defend cards is intentionally not
// modeled yet -- see docs/DESIGN.md.
export function applyDefend(
  attackCard: Pick<AttackCard, "damageType" | "value">,
  defendCard: Pick<DefendCard, "damageType" | "mode" | "amount"> | null | undefined
): number {
  if (!defendCard || defendCard.damageType !== attackCard.damageType) {
    return attackCard.value;
  }
  if (defendCard.mode === MODIFIER_MODE.PERCENT) {
    return Math.max(0, attackCard.value * (1 - defendCard.amount));
  }
  return Math.max(0, attackCard.value - defendCard.amount);
}

// AP needed to play a card (0 for older rows without a cost).
export function cardCost(card: Pick<CardCommon, "cost">): number {
  return Math.max(0, card.cost ?? 0);
}
