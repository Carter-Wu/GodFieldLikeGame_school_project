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
// number of copies up to its rarity's limit (DECK_RULES.maxCopies), as long
// as the deck's rare and legend cards fit the rarity budget
// (DECK_RULES.maxRarityPoints).

import { cardRarity, createCardInstance, RARITY_LABEL, type Card, type Rarity } from "./cardTypes.ts";
import { getCatalog, type CatalogCardEntry } from "./catalog.ts";
import type { ClassDef } from "./classes.ts";
import { shuffle } from "./util.ts";

export const DECK_RULES = {
  minCards: 12,
  maxCards: 24,
  // Copies of one card, by its rarity.
  maxCopies: { normal: 3, rare: 2, legend: 1 } as Readonly<Record<Rarity, number>>,
  // Rarity budget: every copy of a rare card costs 1 point, of a legend 2,
  // and a deck's total has to stay within maxRarityPoints.
  rarityPoints: { normal: 0, rare: 1, legend: 2 } as Readonly<Record<Rarity, number>>,
  maxRarityPoints: 12,
  maxDecksPerClass: 3, // custom decks; the starter deck doesn't count (also enforced by the decks table)
  maxNameLength: 40,
} as const;

// How many copies of this card a deck may hold.
export function maxCopiesOf(card: Pick<CatalogCardEntry, "props"> | null | undefined): number {
  return DECK_RULES.maxCopies[cardRarity(card?.props)];
}

// Rarity points one copy of this card costs (see DECK_RULES.rarityPoints).
export function rarityPointsOf(card: Pick<CatalogCardEntry, "props"> | null | undefined): number {
  return DECK_RULES.rarityPoints[cardRarity(card?.props)];
}

// A deck list's total rarity points. Cards missing from the catalog count 0.
export function deckRarityPoints(list: DeckListEntry[]): number {
  const cards = getCatalog().cards;
  return list.reduce((sum, e) => sum + rarityPointsOf(cards.get(e.cardId)) * e.copies, 0);
}

// One line of a deck list, as stored in decks.cards.
export interface DeckListEntry {
  cardId: string;
  copies: number;
}

// Cards a class may put in a custom deck.
export function classCardPool(classDef: ClassDef): CatalogCardEntry[] {
  return (getCatalog().deckByClass.get(classDef.id) ?? []).map((e) => e.card);
}

// The class's starter deck as a deck list (the "basic deck" every player
// has). A class_deck_cards row with 0 copies puts a card in the class's pool
// without putting it in the starter deck.
export function starterDeckList(classDef: ClassDef): DeckListEntry[] {
  return (getCatalog().deckByClass.get(classDef.id) ?? [])
    .filter((e) => e.copies > 0)
    .map((e) => ({ cardId: e.card.id, copies: e.copies }));
}

export function deckSize(list: DeckListEntry[]): number {
  return list.reduce((sum, e) => sum + e.copies, 0);
}

// null if the list is a legal deck for this class, otherwise why it isn't.
export function validateDeckList(classDef: ClassDef, list: unknown): string | null {
  if (!Array.isArray(list)) return "The deck list is malformed.";
  const pool = new Map(classCardPool(classDef).map((c) => [c.id, c]));
  const seen = new Set<string>();
  let total = 0;
  for (const raw of list as Partial<DeckListEntry>[]) {
    const cardId = String(raw?.cardId ?? "");
    const copies = Number(raw?.copies);
    if (!pool.has(cardId)) return `"${cardId}" isn't a ${classDef.name} card.`;
    if (seen.has(cardId)) return `"${cardId}" is listed twice.`;
    seen.add(cardId);
    if (!Number.isInteger(copies) || copies < 1) return `Bad number of copies for "${cardId}".`;
    const card = pool.get(cardId)!;
    const limit = maxCopiesOf(card);
    if (copies > limit) {
      const rarity = RARITY_LABEL[cardRarity(card.props)].toLowerCase();
      return `At most ${limit} ${limit === 1 ? "copy" : "copies"} of ${card.name} (a ${rarity} card).`;
    }
    total += copies;
  }
  const points = deckRarityPoints(list as DeckListEntry[]);
  if (points > DECK_RULES.maxRarityPoints) {
    return `Rare and legend cards are over budget: ${points}/${DECK_RULES.maxRarityPoints} points (rare 1, legend 2 each).`;
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
