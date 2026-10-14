// General card schema: attack / defend / buff / debuff, per docs/DESIGN.md
// ("General card types").

import { MODIFIER_MODE, type Effect, type ModifierMode } from "./effects.ts";
import type { DamageType } from "./damageTypes.ts";

let modelCardIdCounter = 0;

export const CARD_CATEGORY = {
  ATTACK: "attack",
  DEFEND: "defend",
  BUFF: "buff",
  DEBUFF: "debuff",
} as const;

export type CardCategory = (typeof CARD_CATEGORY)[keyof typeof CARD_CATEGORY];

export const STACKING = {
  STACKABLE: "stackable",
  NONSTACKABLE: "nonstackable",
} as const;

export type Stacking = (typeof STACKING)[keyof typeof STACKING];

export interface AttackCard {
  id: number;
  cardId?: string;
  category: "attack";
  name: string;
  damageType: DamageType;
  value: number;
  imageUrl?: string | null;
}

export interface DefendCard {
  id: number;
  cardId?: string;
  category: "defend";
  name: string;
  damageType: DamageType;
  mode: ModifierMode; // MODIFIER_MODE.FLAT | MODIFIER_MODE.PERCENT
  amount: number;
  stacking: Stacking; // STACKING.STACKABLE | STACKING.NONSTACKABLE
  duration: number; // number of turns this defend lasts
  imageUrl?: string | null;
}

export interface BuffCard {
  id: number;
  cardId?: string;
  category: "buff";
  name: string;
  effects: Effect[];
  duration: number;
  imageUrl?: string | null;
}

export interface DebuffCard {
  id: number;
  cardId?: string;
  category: "debuff";
  name: string;
  effects: Effect[];
  duration: number;
  imageUrl?: string | null;
}

export type Card = AttackCard | DefendCard | BuffCard | DebuffCard;

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
