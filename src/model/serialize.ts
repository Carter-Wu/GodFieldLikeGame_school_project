// Plain-JSON conversion for engine.js battle state, used by online PvP: the
// Supabase Edge Function (supabase/functions/game/) stores a whole battle in
// Postgres between rounds, and the browser rebuilds a read-only view of it
// from what the database lets that player see.
//
// A live fighter holds its full class definition and a Set, neither of which
// survive JSON.stringify, so a stored fighter keeps just the class id (looked
// back up in catalog.js) and an array.
//
// "Private" fighter data -- hand, deck, discard -- is only included when
// asked for. The server's own copy of the battle has it; the public copy both
// players can read has card counts instead, so neither side's client ever
// receives the other's cards.

import { findClassById } from "./catalog.ts";
import type { Battle, Fighter, LastAction } from "./engine.ts";
import type { Card } from "./cardTypes.ts";

export interface SerializedFighter {
  classId: string;
  label: string | null;
  hp: number;
  maxHp: number;
  ultimateMeter: number;
  cardsPlayedByCategory: Record<string, number>;
  activeDefends: Fighter["activeDefends"];
  tempModifiers: Fighter["tempModifiers"];
  disabledSynergies: string[];
  disabledSynergyTimers: Record<string, number>;
  handCount: number;
  deckCount: number;
  lastAction: LastAction | null;
  hand?: Card[];
  deck?: Card[];
  discard?: Card[];
}

export interface SerializedBattle {
  player: SerializedFighter;
  cpu: SerializedFighter;
  round: number;
  winner: "player" | "cpu" | null;
  draw: boolean;
  log: string[];
}

export function serializeFighter(
  fighter: Fighter,
  { includePrivate = false }: { includePrivate?: boolean } = {}
): SerializedFighter {
  const data: SerializedFighter = {
    classId: fighter.classDef.id,
    label: fighter.label ?? null,
    hp: fighter.hp,
    maxHp: fighter.maxHp,
    ultimateMeter: fighter.ultimateMeter,
    cardsPlayedByCategory: fighter.cardsPlayedByCategory,
    activeDefends: fighter.activeDefends,
    tempModifiers: fighter.tempModifiers,
    disabledSynergies: [...fighter.disabledSynergies],
    disabledSynergyTimers: fighter.disabledSynergyTimers,
    handCount: fighter.hand.length,
    deckCount: fighter.deck.length,
    lastAction: fighter.lastAction ?? null,
  };
  if (includePrivate) {
    data.hand = fighter.hand;
    data.deck = fighter.deck;
    data.discard = fighter.discard;
  }
  return data;
}

// Rebuild an engine fighter. A public (no private data) fighter comes back
// with an empty deck/discard and whatever `hand` the caller supplies -- enough
// for computeCurrentStats / canUseUltimate and the battle screen, not for
// resolving rounds.
export function deserializeFighter(data: SerializedFighter, hand: Card[] = data.hand ?? []): Fighter {
  return {
    classDef: findClassById(data.classId),
    label: data.label ?? null,
    hp: data.hp,
    maxHp: data.maxHp,
    deck: data.deck ?? [],
    discard: data.discard ?? [],
    hand,
    ultimateMeter: data.ultimateMeter,
    cardsPlayedByCategory: data.cardsPlayedByCategory,
    activeDefends: data.activeDefends,
    tempModifiers: data.tempModifiers,
    disabledSynergies: new Set(data.disabledSynergies),
    disabledSynergyTimers: data.disabledSynergyTimers,
    lastAction: data.lastAction ?? null,
    // Only meaningful on a public fighter, whose hand/deck aren't sent.
    handCount: data.handCount ?? hand.length,
  };
}

// The server's full copy of a battle, hands and decks included.
export function serializeBattle(battle: Battle): SerializedBattle {
  return {
    player: serializeFighter(battle.player, { includePrivate: true }),
    cpu: serializeFighter(battle.cpu, { includePrivate: true }),
    round: battle.round,
    winner: battle.winner === battle.player ? "player" : battle.winner === battle.cpu ? "cpu" : null,
    draw: battle.draw,
    log: battle.log,
  };
}

export function deserializeBattle(data: SerializedBattle): Battle {
  const battle: Battle = {
    player: deserializeFighter(data.player),
    cpu: deserializeFighter(data.cpu),
    round: data.round,
    winner: null,
    draw: data.draw,
    log: data.log,
  };
  if (data.winner) battle.winner = battle[data.winner];
  return battle;
}

// The part of a battle both players are allowed to see.
export function publicFighters(battle: Battle): { player: SerializedFighter; cpu: SerializedFighter } {
  return {
    player: serializeFighter(battle.player),
    cpu: serializeFighter(battle.cpu),
  };
}
