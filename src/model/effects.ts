// Generic effect objects used by synergy tiers, class passives, buff cards,
// debuff cards and ultimates. An "effect" describes one small rule change; a
// card or synergy tier is just a list of these. See docs/DESIGN.md ("Buff" /
// "Debuff" / "Status effects").

import type { StatKey } from "./stats.ts";

export const EFFECT_KIND = {
  STAT_MODIFIER: "stat_modifier", // add/scale one of the base stats
  ENERGY_REGEN: "energy_regen", // change ultimate regen rate
  SYNERGY_DISABLE: "synergy_disable", // turn off a target synergy for its duration
  METER_SIPHON: "meter_siphon", // drain ultimate meter from the target
  SUMMON: "summon", // put a monster card's monster on the actor's field
  CONDITIONAL: "conditional", // only applies if `condition(context)` is true
  APPLY_STATUS: "apply_status", // burning / poison / wet / acid / slowed / blind on the target
  HEAL: "heal", // restore HP to the target (never above max)
  GAIN_AP: "gain_ap", // the actor gains action points right away
  DRAW: "draw", // the actor draws cards right away
  CLEANSE: "cleanse", // remove every status from the target
} as const;

export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];

// Flat vs percent, reused by stat modifiers and defend cards.
export const MODIFIER_MODE = {
  FLAT: "flat",
  PERCENT: "percent",
} as const;

export type ModifierMode = (typeof MODIFIER_MODE)[keyof typeof MODIFIER_MODE];

// Lingering conditions on a fighter (docs: "Effect - burning, wet, acid,
// poison, slowed, blind"). Each lasts `duration` rounds and has a `potency`:
//   burning - takes `potency` damage at the end of every round; put out by
//             water damage, and can't catch on a Wet target
//   poison  - takes `potency` damage at the end of every round; re-applying
//             adds to the potency (it stacks), unlike every other status
//   wet     - takes +50% electric damage and -50% fire damage (fire dries it)
//   acid    - DEF and ER lowered by `potency`
//   slowed  - this fighter's cards and monsters act `potency` priority/speed later
//   blind   - this fighter's attack cards and monsters deal half damage
export const STATUS = {
  BURNING: "burning",
  POISON: "poison",
  WET: "wet",
  ACID: "acid",
  SLOWED: "slowed",
  BLIND: "blind",
} as const;

export type StatusId = (typeof STATUS)[keyof typeof STATUS];

export interface StatModifierEffect {
  kind: "stat_modifier";
  stat: StatKey;
  mode: ModifierMode;
  amount: number;
}

export interface EnergyRegenEffect {
  kind: "energy_regen";
  mode: ModifierMode;
  amount: number;
}

export interface SynergyDisableEffect {
  kind: "synergy_disable";
  synergyId: string;
}

export interface MeterSiphonEffect {
  kind: "meter_siphon";
  amount: number;
}

// `cardId` names a monster card in the catalog; its monster is summoned
// `count` times (as long as the field has room).
export interface SummonEffect {
  kind: "summon";
  cardId: string;
  count: number;
}

export interface ConditionalEffect {
  kind: "conditional";
  condition: (context: unknown) => boolean;
  effect: Effect;
}

export interface ApplyStatusEffect {
  kind: "apply_status";
  status: StatusId;
  potency: number;
  duration: number;
}

export interface HealEffect {
  kind: "heal";
  amount: number;
}

export interface GainApEffect {
  kind: "gain_ap";
  amount: number;
}

export interface DrawEffect {
  kind: "draw";
  count: number;
}

export interface CleanseEffect {
  kind: "cleanse";
}

export type Effect =
  | StatModifierEffect
  | EnergyRegenEffect
  | SynergyDisableEffect
  | MeterSiphonEffect
  | SummonEffect
  | ConditionalEffect
  | ApplyStatusEffect
  | HealEffect
  | GainApEffect
  | DrawEffect
  | CleanseEffect;

// +amount (flat) or +amount*100% (percent) to `stat`.
export function statModifier(stat: StatKey, mode: ModifierMode, amount: number): StatModifierEffect {
  return { kind: EFFECT_KIND.STAT_MODIFIER, stat, mode, amount };
}

export function energyRegen(mode: ModifierMode, amount: number): EnergyRegenEffect {
  return { kind: EFFECT_KIND.ENERGY_REGEN, mode, amount };
}

export function synergyDisable(synergyId: string): SynergyDisableEffect {
  return { kind: EFFECT_KIND.SYNERGY_DISABLE, synergyId };
}

export function meterSiphon(amount: number): MeterSiphonEffect {
  return { kind: EFFECT_KIND.METER_SIPHON, amount };
}

export function summon(cardId: string, count = 1): SummonEffect {
  return { kind: EFFECT_KIND.SUMMON, cardId, count };
}

export function applyStatus(status: StatusId, potency: number, duration: number): ApplyStatusEffect {
  return { kind: EFFECT_KIND.APPLY_STATUS, status, potency, duration };
}

export function heal(amount: number): HealEffect {
  return { kind: EFFECT_KIND.HEAL, amount };
}

export function gainAp(amount: number): GainApEffect {
  return { kind: EFFECT_KIND.GAIN_AP, amount };
}

export function draw(count: number): DrawEffect {
  return { kind: EFFECT_KIND.DRAW, count };
}

export function cleanse(): CleanseEffect {
  return { kind: EFFECT_KIND.CLEANSE };
}

// `condition` is an open-ended predicate the engine will call later:
// (context) => boolean. Left unresolved on purpose -- see docs/DESIGN.md.
export function conditional(condition: (context: unknown) => boolean, effect: Effect): ConditionalEffect {
  return { kind: EFFECT_KIND.CONDITIONAL, condition, effect };
}
