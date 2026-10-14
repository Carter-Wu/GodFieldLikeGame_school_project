// Stat schema shared by every class. A stats object always has exactly these
// keys; a class or effect that doesn't care about a given stat just uses 0.
// See docs/DESIGN.md ("Basic stats").

export type StatKey = "hp" | "def" | "mr" | "er" | "ur" | "crit";

export interface Stats {
  hp: number;
  def: number;
  mr: number;
  er: number;
  ur: number;
  crit: number;
}

export const STAT_KEYS: StatKey[] = ["hp", "def", "mr", "er", "ur", "crit"];
// hp   - health points
// def  - physical defense
// mr   - magic resist
// er   - element resist
// ur   - ultimate regen rate
// crit - crit chance (open question in docs/DESIGN.md -- still deciding if this ships)

// Create a stats object with every key defaulting to 0, overridden by `values`.
export function createStats(values: Partial<Stats> = {}): Stats {
  return {
    hp: values.hp ?? 0,
    def: values.def ?? 0,
    mr: values.mr ?? 0,
    er: values.er ?? 0,
    ur: values.ur ?? 0,
    crit: values.crit ?? 0,
  };
}
