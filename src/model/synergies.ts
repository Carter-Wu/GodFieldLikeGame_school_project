// Synergy definitions, per docs/DESIGN.md ("Class system / deck synergy
// system"). A class has access to a pool of synergies, and each synergy
// unlocks stronger effects at higher tiers as more copies of it become active
// (modeled after tiered trait/synergy systems in auto-battlers).
//
// Open question (docs/DESIGN.md): can more than one synergy be active on a
// class at the same time? Nothing here prevents it -- `resolveSynergies` just
// resolves each synergy in the pool independently, so the caller decides how
// many can be active at once.

import type { CardCategory } from "./cardTypes.ts";
import type { Effect } from "./effects.ts";

export interface SynergyTier {
  count: number;
  effects: Effect[];
}

// tiers: [{ count, effects }], meant to be given in ascending order of
// `count`. `countsCategory` is read by the engine (src/model/engine.ts) to
// know which card category played this match counts toward this synergy's
// tier -- resolveSynergies below doesn't touch it directly, it just takes
// whatever activeCounts the caller hands it.
export interface Synergy {
  id: string;
  name: string;
  description: string;
  tiers: SynergyTier[];
  countsCategory: CardCategory;
}

export function createSynergy({
  id,
  name,
  description,
  tiers,
  countsCategory,
}: {
  id: string;
  name: string;
  description: string;
  tiers: SynergyTier[];
  countsCategory: CardCategory;
}): Synergy {
  return { id, name, description, tiers, countsCategory };
}

// Given how many pieces of a synergy are currently active (e.g. cards of that
// synergy in play), return the highest tier reached, or null if none.
export function getActiveTier(synergy: Synergy, activeCount: number): SynergyTier | null {
  let best: SynergyTier | null = null;
  for (const tier of synergy.tiers) {
    if (activeCount >= tier.count) {
      best = tier;
    }
  }
  return best;
}

// Resolve every synergy in a pool against a map of { synergyId: activeCount }
// and return the flat list of effects granted by whichever tier each synergy
// reached.
export function resolveSynergies(
  synergyPool: Synergy[],
  activeCounts: Record<string, number>
): Effect[] {
  const effects: Effect[] = [];
  for (const synergy of synergyPool) {
    const tier = getActiveTier(synergy, activeCounts[synergy.id] ?? 0);
    if (tier) effects.push(...tier.effects);
  }
  return effects;
}
