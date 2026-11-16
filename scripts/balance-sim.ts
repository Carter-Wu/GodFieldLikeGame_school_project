// Class balance simulator: plays many CPU-vs-CPU matches between every pair
// of classes (starter decks, both sides driven by the engine's CPU logic)
// and prints how often each class wins. Run with `npm run balance`, e.g.
//
//   npm run balance                    # 1000 games per matchup
//   npm run balance -- --games 4000    # more games, tighter numbers
//
// Uses the local catalog (src/model/catalogData.ts), so it measures the
// numbers in that file -- edit base_stats there and rerun. The CPU is simple
// (see chooseCpuAction in src/model/engine.ts), so treat the results as a
// guide to how the stats compare, not as how good players would do.

import { pathToFileURL } from "node:url";
import { allClasses, useLocalCatalog } from "../src/model/catalog.ts";
import { chooseAiAction, createBattle, isBattleOver, resolveRound, setRandomSource } from "../src/model/engine.ts";
import type { ClassDef } from "../src/model/classes.ts";
import type { Stats } from "../src/model/stats.ts";

// A match still going after this many rounds counts as a draw.
const ROUND_CAP = 60;

export type StatOverrides = Record<string, Partial<Stats>>;

export interface MatchupResult {
  wins: number; // for the row class
  losses: number;
  draws: number;
  rounds: number; // total, for the average
}

export interface BalanceReport {
  classes: ClassDef[];
  matchups: Record<string, Record<string, MatchupResult>>; // [row][col], row's point of view
  overall: Record<string, number>; // win rate vs everyone else, draws counting half
}

// mulberry32: a small seeded PRNG so runs are repeatable.
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function withStats(classDef: ClassDef, overrides: StatOverrides): ClassDef {
  const extra = overrides[classDef.id];
  return extra ? { ...classDef, baseStats: { ...classDef.baseStats, ...extra } } : classDef;
}

// One match; returns 1 if `a` won, 0 if `b` won, 0.5 for a draw, plus rounds.
function playMatch(a: ClassDef, b: ClassDef, aFirst: boolean): { score: number; rounds: number } {
  const battle = aFirst ? createBattle(a, b) : createBattle(b, a);
  while (!isBattleOver(battle) && battle.round <= ROUND_CAP) {
    resolveRound(battle, chooseAiAction(battle.player, battle.cpu), chooseAiAction(battle.cpu, battle.player));
  }
  const rounds = battle.round - 1;
  if (!battle.winner) return { score: 0.5, rounds };
  const aWon = (battle.winner === battle.player) === aFirst;
  return { score: aWon ? 1 : 0, rounds };
}

// Every pair of different classes, `games` matches each, alternating which
// one sits in the player seat.
export function runBalance(games: number, overrides: StatOverrides = {}, seed = 416): BalanceReport {
  useLocalCatalog();
  // Seed the engine's dice and the deck shuffles (Math.random), so two runs
  // with different stats see the same luck and only the stats differ.
  setRandomSource(seeded(seed));
  const mathRandom = Math.random;
  Math.random = seeded(seed + 1);
  try {
    return runAll(games, overrides);
  } finally {
    Math.random = mathRandom;
    setRandomSource(null);
  }
}

function runAll(games: number, overrides: StatOverrides): BalanceReport {
  const classes = allClasses().map((c) => withStats(c, overrides));
  const matchups: BalanceReport["matchups"] = {};
  for (const c of classes) matchups[c.id] = {};

  for (let i = 0; i < classes.length; i++) {
    for (let j = i + 1; j < classes.length; j++) {
      const a = classes[i] as ClassDef;
      const b = classes[j] as ClassDef;
      const ab: MatchupResult = { wins: 0, losses: 0, draws: 0, rounds: 0 };
      for (let g = 0; g < games; g++) {
        const { score, rounds } = playMatch(a, b, g % 2 === 0);
        if (score === 1) ab.wins++;
        else if (score === 0) ab.losses++;
        else ab.draws++;
        ab.rounds += rounds;
      }
      (matchups[a.id] as Record<string, MatchupResult>)[b.id] = ab;
      (matchups[b.id] as Record<string, MatchupResult>)[a.id] = { wins: ab.losses, losses: ab.wins, draws: ab.draws, rounds: ab.rounds };
    }
  }

  const overall: Record<string, number> = {};
  for (const c of classes) {
    let points = 0;
    let total = 0;
    for (const r of Object.values(matchups[c.id] ?? {})) {
      points += r.wins + r.draws / 2;
      total += r.wins + r.losses + r.draws;
    }
    overall[c.id] = total ? points / total : 0.5;
  }
  return { classes, matchups, overall };
}

export const winRate = (r: MatchupResult): number => (r.wins + r.draws / 2) / Math.max(1, r.wins + r.losses + r.draws);

export function formatReport(report: BalanceReport): string {
  const short = (c: ClassDef): string => c.name.replace(/\s*\(.*\)\s*$/, "");
  const w = Math.max(...report.classes.map((c) => short(c).length)) + 2;
  const pct = (x: number): string => `${(x * 100).toFixed(1)}%`.padStart(8);
  const lines: string[] = [];
  lines.push("Win rate of the row class vs the column class (draws count half):");
  lines.push("".padEnd(w) + report.classes.map((c) => short(c).slice(0, 7).padStart(8)).join("") + "   overall");
  for (const row of report.classes) {
    let line = short(row).padEnd(w);
    for (const col of report.classes) {
      const r = report.matchups[row.id]?.[col.id];
      line += r ? pct(winRate(r)) : "       -";
    }
    lines.push(`${line}   ${pct(report.overall[row.id] ?? 0.5)}`);
  }
  let rounds = 0;
  let games = 0;
  let draws = 0;
  for (let i = 0; i < report.classes.length; i++) {
    for (let j = i + 1; j < report.classes.length; j++) {
      const r = report.matchups[report.classes[i]!.id]?.[report.classes[j]!.id];
      if (!r) continue;
      rounds += r.rounds;
      games += r.wins + r.losses + r.draws;
      draws += r.draws;
    }
  }
  lines.push("");
  lines.push(`${games} games, ${(rounds / Math.max(1, games)).toFixed(1)} rounds on average, ${((draws / Math.max(1, games)) * 100).toFixed(1)}% draws`);
  lines.push("");
  lines.push("Base stats:");
  for (const c of report.classes) {
    const s = c.baseStats;
    lines.push(`  ${short(c).padEnd(w)} HP ${s.hp}  DEF ${s.def}  MR ${s.mr}  ER ${s.er}  UR ${s.ur}  ATK ${s.atk}`);
  }
  return lines.join("\n");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const args = process.argv.slice(2);
  const gamesFlag = args.indexOf("--games");
  const games = gamesFlag >= 0 ? Number(args[gamesFlag + 1]) : 1000;
  console.log(formatReport(runBalance(games)));
}
