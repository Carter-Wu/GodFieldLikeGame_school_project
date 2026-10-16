// Damage / resistance typing shared by attack and defend cards.
// See docs/DESIGN.md ("General card types").

import type { StatKey } from "./stats.ts";

export const DAMAGE_TYPE = {
  PHYSICAL: "physical",
  MAGIC: "magic",
  ELEMENT: "element",
  TRUE: "true", // ignores all resistances
} as const;

export type DamageType = (typeof DAMAGE_TYPE)[keyof typeof DAMAGE_TYPE];

// Which stat resists each damage type. TRUE damage has no entry here -- it is
// never reduced by a stat, only by an explicit defend card that targets "true".
export const RESIST_STAT: Record<Exclude<DamageType, "true">, StatKey> = {
  [DAMAGE_TYPE.PHYSICAL]: "def",
  [DAMAGE_TYPE.MAGIC]: "mr",
  [DAMAGE_TYPE.ELEMENT]: "er",
};

// Elemental affinity, on top of the damage type (docs: "Element/Type ... fire,
// water, electric"). Optional on attack and monster cards; it only matters
// through the status interactions in engine.ts:
//   - electric damage against a Wet target deals +50%
//   - fire damage against a Wet target deals -50% and dries it (removes Wet)
//   - water damage puts out Burning
export const ELEMENT = {
  FIRE: "fire",
  WATER: "water",
  ELECTRIC: "electric",
} as const;

export type Element = (typeof ELEMENT)[keyof typeof ELEMENT];
