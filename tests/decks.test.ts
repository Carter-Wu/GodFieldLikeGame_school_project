// Deck-building rules (src/model/decks.ts): the starter deck is legal, bad
// lists are rejected, and a custom deck is what a battle actually deals from.

import { beforeAll, describe, expect, it } from "vitest";
import { allClasses, findCardById, useLocalCatalog } from "../src/model/catalog.ts";
import type { ClassDef } from "../src/model/classes.ts";
import { createBattle } from "../src/model/engine.ts";
import {
  DECK_RULES,
  buildDeckFromList,
  classCardPool,
  deckRarityPoints,
  deckSize,
  maxCopiesOf,
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

  it("limits copies by rarity: normal 3, rare 2, legend 1", () => {
    expect(DECK_RULES.maxCopies).toEqual({ normal: 3, rare: 2, legend: 1 });
    const filler = [{ cardId: "heavy_slam", copies: 3 }, { cardId: "brace", copies: 2 }, { cardId: "taunt", copies: 3 }, { cardId: "purify", copies: 3 }];
    const deck = (cardId: string, copies: number) => [...filler, { cardId, copies }];
    expect(validateDeckList(guardian, deck("stone_sentinel", 3))).toBeNull(); // normal
    expect(validateDeckList(guardian, deck("stone_sentinel", 4))).toMatch(/At most 3 copies of Stone Sentinel/);
    expect(validateDeckList(guardian, deck("shield_bash", 2))).toBeNull(); // rare
    expect(validateDeckList(guardian, deck("shield_bash", 3))).toMatch(/At most 2 copies .* rare/);
    expect(validateDeckList(guardian, deck("iron_skin", 1))).toBeNull(); // legend
    expect(validateDeckList(guardian, deck("iron_skin", 2))).toMatch(/At most 1 copy of Iron Skin \(a legend card\)/);
    expect(maxCopiesOf(findCardById("iron_skin"))).toBe(1);
  });

  it("keeps rare and legend cards within the 12-point rarity budget", () => {
    const blackMage = allClasses().find((c) => c.id === "black_mage")!;
    const filler = [{ cardId: "shadow_bolt", copies: 3 }, { cardId: "eldritch_blast", copies: 3 }, { cardId: "acid_rain", copies: 3 }];
    // 6 legends (12 points) fit...
    const legends = ["vampiric_touch", "dark_pact", "mana_tap", "curse_of_weakness", "soul_siphon", "meditate"].map((cardId) => ({ cardId, copies: 1 }));
    expect(deckRarityPoints(legends)).toBe(12);
    expect(validateDeckList(blackMage, [...filler, ...legends])).toBeNull();
    // ...and one rare more doesn't.
    const over = [...filler, ...legends, { cardId: "hex_ward", copies: 1 }];
    expect(validateDeckList(blackMage, over)).toMatch(/over budget: 13\/12/);
  });

  it("keeps a 0-copy starter card in the pool but out of the starter deck", () => {
    const craftsman = allClasses().find((c) => c.id === "craftsman")!;
    expect(classCardPool(craftsman).map((c) => c.id)).toContain("tinker");
    expect(starterDeckList(craftsman).map((e) => e.cardId)).not.toContain("tinker");
    for (const classDef of allClasses()) expect(deckRarityPoints(starterDeckList(classDef))).toBeLessThanOrEqual(DECK_RULES.maxRarityPoints);
  });

  it("rejects too many copies, too few cards, and duplicates", () => {
    const [first] = starterDeckList(guardian);
    expect(validateDeckList(guardian, [{ ...first!, copies: DECK_RULES.maxCopies.normal + 1 }])).toMatch(/copies/);
    expect(validateDeckList(guardian, [{ ...first!, copies: 1 }])).toMatch(/at least/);
    expect(validateDeckList(guardian, [...starterDeckList(guardian), first])).toMatch(/twice/);
    expect(validateDeckList(guardian, "nope")).toMatch(/malformed/);
  });

  it("rejects decks over the size limit", () => {
    const maxed = classCardPool(guardian).map((c) => ({ cardId: c.id, copies: maxCopiesOf(c) }));
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
