// Player-built decks: the rules a custom deck has to follow, and turning a
// saved deck list into the shuffled card instances a battle plays with.
//
// Shared by the browser (deck builder, vs-CPU) and the `game` Edge Function,
// which re-checks every deck with validateDeckList() before a match uses it --
// the deck rows themselves are written straight from the browser, so the
// server never trusts them as-is.
//
// A class's card pool is the set of cards in its starter deck
// (class_deck_cards): a custom deck can use any of those cards, in any
// number of copies up to DECK_RULES.maxCopies.

import { createCardInstance, type Card } from "./cardTypes.ts";
import { getCatalog, type CatalogCardEntry } from "./catalog.ts";
import type { ClassDef } from "./classes.ts";
import { shuffle } from "./util.ts";

export const DECK_RULES = {
  minCards: 12,
  maxCards: 24,
  maxCopies: 4,
  maxDecksPerClass: 3, // custom decks; the starter deck doesn't count (also enforced by the decks table)
  maxNameLength: 40,
} as const;

// One line of a deck list, as stored in decks.cards.
export interface DeckListEntry {
  cardId: string;
  copies: number;
}

// Cards a class may put in a custom deck.
export function classCardPool(classDef: ClassDef): CatalogCardEntry[] {
  return (getCatalog().deckByClass.get(classDef.id) ?? []).map((e) => e.card);
}

// The class's starter deck as a deck list (the "basic deck" every player has).
export function starterDeckList(classDef: ClassDef): DeckListEntry[] {
  return (getCatalog().deckByClass.get(classDef.id) ?? []).map((e) => ({ cardId: e.card.id, copies: e.copies }));
}

export function deckSize(list: DeckListEntry[]): number {
  return list.reduce((sum, e) => sum + e.copies, 0);
}

// null if the list is a legal deck for this class, otherwise why it isn't.
export function validateDeckList(classDef: ClassDef, list: unknown): string | null {
  if (!Array.isArray(list)) return "The deck list is malformed.";
  const pool = new Set(classCardPool(classDef).map((c) => c.id));
  const seen = new Set<string>();
  let total = 0;
  for (const raw of list as Partial<DeckListEntry>[]) {
    const cardId = String(raw?.cardId ?? "");
    const copies = Number(raw?.copies);
    if (!pool.has(cardId)) return `"${cardId}" isn't a ${classDef.name} card.`;
    if (seen.has(cardId)) return `"${cardId}" is listed twice.`;
    seen.add(cardId);
    if (!Number.isInteger(copies) || copies < 1) return `Bad number of copies for "${cardId}".`;
    if (copies > DECK_RULES.maxCopies) return `At most ${DECK_RULES.maxCopies} copies of each card.`;
    total += copies;
  }
  if (total < DECK_RULES.minCards) return `A deck needs at least ${DECK_RULES.minCards} cards (has ${total}).`;
  if (total > DECK_RULES.maxCards) return `A deck can have at most ${DECK_RULES.maxCards} cards (has ${total}).`;
  return null;
}

// A fresh shuffled deck of card instances from a list that passed
// validateDeckList(). Cards missing from the catalog are skipped.
export function buildDeckFromList(list: DeckListEntry[]): Card[] {
  const cards = getCatalog().cards;
  const deck: Card[] = [];
  for (const { cardId, copies } of list) {
    const card = cards.get(cardId);
    if (!card) continue;
    for (let i = 0; i < copies; i++) deck.push(createCardInstance(card));
  }
  return shuffle(deck);
}
