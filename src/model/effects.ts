// Generic effect objects used by synergy tiers, class passives, buff cards, and
// debuff cards. An "effect" describes one small rule change; a card or synergy
// tier is just a list of these. See docs/DESIGN.md ("Buff" / "Debuff").

import type { StatKey } from "./stats.ts";

export const EFFECT_KIND = {
  STAT_MODIFIER: "stat_modifier", // add/scale one of the base stats
  ENERGY_REGEN: "energy_regen", // change ultimate regen rate
  SYNERGY_DISABLE: "synergy_disable", // turn off a target synergy for its duration
  METER_SIPHON: "meter_siphon", // drain ultimate meter from the target
  SUMMON: "summon", // spawn a helper unit (placeholder, unresolved)
  CONDITIONAL: "conditional", // only applies if `condition(context)` is true
} as const;

export type EffectKind = (typeof EFFECT_KIND)[keyof typeof EFFECT_KIND];

// Flat vs percent, reused by stat modifiers and defend cards.
export const MODIFIER_MODE = {
  FLAT: "flat",
  PERCENT: "percent",
} as const;

export type ModifierMode = (typeof MODIFIER_MODE)[keyof typeof MODIFIER_MODE];

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

export interface SummonEffect {
  kind: "summon";
  // Open-ended payload — unresolved placeholder (see docs/DESIGN.md).
  [key: string]: unknown;
}

export interface ConditionalEffect {
  kind: "conditional";
  condition: (context: unknown) => boolean;
  effect: Effect;
}

export type Effect =
  | StatModifierEffect
  | EnergyRegenEffect
  | SynergyDisableEffect
  | MeterSiphonEffect
  | SummonEffect
  | ConditionalEffect;

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

// `condition` is an open-ended predicate the engine will call later:
// (context) => boolean. Left unresolved on purpose -- see docs/DESIGN.md.
export function conditional(condition: (context: unknown) => boolean, effect: Effect): ConditionalEffect {
  return { kind: EFFECT_KIND.CONDITIONAL, condition, effect };
}
