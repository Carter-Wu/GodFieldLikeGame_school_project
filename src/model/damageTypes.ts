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
