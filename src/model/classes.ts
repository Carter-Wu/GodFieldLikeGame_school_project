// Class definitions: base stats + which synergies a class can draw on + a
// unique ultimate + class-based passives. See docs/DESIGN.md ("Class system /
// deck synergy system", "Basic stats").

import { createStats, type Stats, type StatKey } from "./stats.ts";
import { EFFECT_KIND, MODIFIER_MODE, type Effect } from "./effects.ts";
import type { Synergy } from "./synergies.ts";

export interface Ultimate {
  id: string;
  name: string;
  description: string;
  cost: number;
  damage?: number;
}

export interface ClassDef {
  id: string;
  name: string;
  baseStats: Stats;
  synergyPool: Synergy[];
  ultimate: Ultimate;
  passives: Effect[];
}

export function createClass({
  id,
  name,
  baseStats,
  synergyPool,
  ultimate,
  passives = [],
}: {
  id: string;
  name: string;
  baseStats: Partial<Stats>;
  synergyPool: Synergy[];
  ultimate: Ultimate;
  passives?: Effect[];
}): ClassDef {
  return {
    id,
    name,
    baseStats: createStats(baseStats),
    synergyPool,
    ultimate,
    passives,
  };
}

// Placeholder ultimate shape -- naming/theme is still an open question
// (docs/DESIGN.md: "name it something related to all in aspect maybe").
// `damage` is a placeholder generic effect (flat true damage) just so the
// meter-fills-then-use mechanic is demonstrable end to end; real ultimate
// design (and whether it's even damage-shaped) is still undecided.
export function createUltimate({
  id,
  name,
  description,
  cost,
  damage = 0,
}: {
  id: string;
  name: string;
  description: string;
  cost: number;
  damage?: number;
}): Ultimate {
  return { id, name, description, cost, damage };
}

// Apply a list of effects on top of a class's base stats. Only STAT_MODIFIER
// effects change the stat block here -- other kinds (energy regen, synergy
// disable, meter siphon, ...) belong to other systems and are left alone.
export function computeEffectiveStats(classDef: ClassDef, effects: Effect[]): Stats {
  const stats = createStats(classDef.baseStats);
  for (const effect of effects) {
    if (effect.kind !== EFFECT_KIND.STAT_MODIFIER) continue;
    const stat = effect.stat as StatKey;
    if (effect.mode === MODIFIER_MODE.PERCENT) {
      stats[stat] += classDef.baseStats[stat] * effect.amount;
    } else {
      stats[stat] += effect.amount;
    }
  }
  return stats;
}
