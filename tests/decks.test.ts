// Deck-building rules (src/model/decks.ts): the starter deck is legal, bad
// lists are rejected, and a custom deck is what a battle actually deals from.

import { beforeAll, describe, expect, it } from "vitest";
import { allClasses, useLocalCatalog } from "../src/model/catalog.ts";
import type { ClassDef } from "../src/model/classes.ts";
import { createBattle } from "../src/model/engine.ts";
import {
  DECK_RULES,
  buildDeckFromList,
  classCardPool,
  deckSize,
  starterDeckList,
  validateDeckList,
} from "../src/model/decks.ts";

let guardian: ClassDef;
let other: ClassDef;

beforeAll(() => {
  useLocalCatalog();
  [guardian, other] = allClasses() as [ClassDef, ClassDef];
});

describe("deck rules", () => {
  it("accepts every class's starter deck", () => {
    for (const classDef of allClasses()) {
      expect(validateDeckList(classDef, starterDeckList(classDef))).toBeNull();
    }
  });

  it("rejects another class's cards", () => {
    const foreign = classCardPool(other)[0]!;
    const list = [...starterDeckList(guardian), { cardId: foreign.id, copies: 1 }];
    expect(validateDeckList(guardian, list)).toMatch(/isn't a/);
  });

  it("rejects too many copies, too few cards, and duplicates", () => {
    const [first] = starterDeckList(guardian);
    expect(validateDeckList(guardian, [{ ...first!, copies: DECK_RULES.maxCopies + 1 }])).toMatch(/copies/);
    expect(validateDeckList(guardian, [{ ...first!, copies: 1 }])).toMatch(/at least/);
    expect(validateDeckList(guardian, [...starterDeckList(guardian), first])).toMatch(/twice/);
    expect(validateDeckList(guardian, "nope")).toMatch(/malformed/);
  });

  it("rejects decks over the size limit", () => {
    const maxed = classCardPool(guardian).map((c) => ({ cardId: c.id, copies: DECK_RULES.maxCopies }));
    if (deckSize(maxed) > DECK_RULES.maxCards) expect(validateDeckList(guardian, maxed)).toMatch(/at most/);
  });

  it("builds and deals from a custom deck", () => {
    const [first] = classCardPool(guardian);
    const list = [{ cardId: first!.id, copies: DECK_RULES.minCards }];
    const deck = buildDeckFromList(list);
    expect(deck).toHaveLength(DECK_RULES.minCards);
    const battle = createBattle(guardian, other, { playerDeck: deck });
    const dealt = [...battle.player.hand, ...battle.player.deck];
    expect(dealt.every((c) => c.cardId === first!.id)).toBe(true);
  });
});
