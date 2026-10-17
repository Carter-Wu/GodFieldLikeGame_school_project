// Smoke tests for the game model: the offline catalog loads, the defend math
// is right, a battle can be played to the end, and battle state survives the
// JSON round trip online PvP relies on.

import { beforeAll, describe, expect, it } from "vitest";
import { applyDefend } from "../src/model/cardTypes.ts";
import { DAMAGE_TYPE } from "../src/model/damageTypes.ts";
import { MODIFIER_MODE } from "../src/model/effects.ts";
import { allClasses, useLocalCatalog } from "../src/model/catalog.ts";
import type { ClassDef } from "../src/model/classes.ts";
import { canPlayCard, cardAction, createBattle, isBattleOver, planAction, playRound } from "../src/model/engine.ts";
import type { Card } from "../src/model/cardTypes.ts";
import { deserializeBattle, serializeBattle } from "../src/model/serialize.ts";

function firstTwoClasses(): [ClassDef, ClassDef] {
  const classes = allClasses();
  if (classes.length < 2) throw new Error("expected at least two classes in the test catalog");
  return [classes[0] as ClassDef, classes[1] as ClassDef];
}

beforeAll(() => {
  useLocalCatalog();
});

describe("applyDefend", () => {
  const attack = { damageType: DAMAGE_TYPE.PHYSICAL, value: 10 };

  it("subtracts a flat defend of the same damage type", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.FLAT, amount: 4 })).toBe(6);
  });

  it("scales by a percent defend", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.PERCENT, amount: 0.5 })).toBe(5);
  });

  it("ignores a defend of a different damage type", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.MAGIC, mode: MODIFIER_MODE.FLAT, amount: 4 })).toBe(10);
  });

  it("never goes below zero", () => {
    expect(applyDefend(attack, { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.FLAT, amount: 99 })).toBe(0);
  });
});

describe("local catalog", () => {
  it("has at least two classes", () => {
    expect(allClasses().length).toBeGreaterThanOrEqual(2);
  });
});

describe("battle engine", () => {
  it("starts both fighters with full HP and a hand", () => {
    const [a, b] = firstTwoClasses();
    const battle = createBattle(a, b);
    expect(battle.player.hp).toBe(a.baseStats.hp);
    expect(battle.cpu.hp).toBe(b.baseStats.hp);
    expect(battle.player.hand.length).toBeGreaterThan(0);
    expect(isBattleOver(battle)).toBe(false);
  });

  it("finishes a game when the player plays every card it can afford each turn", () => {
    const [a, b] = firstTwoClasses();
    const battle = createBattle(a, b);
    for (let i = 0; i < 500 && !isBattleOver(battle); i++) {
      const picked: Card[] = [];
      for (const card of battle.player.hand) if (canPlayCard(battle.player, card, picked)) picked.push(card);
      const ids = picked.map((c) => c.id);
      playRound(battle, planAction(battle.player, ids, true) ?? planAction(battle.player, ids));
    }
    expect(isBattleOver(battle)).toBe(true);
  });

  it("records each fighter's turn for the round recap", () => {
    const [a, b] = firstTwoClasses();
    const battle = createBattle(a, b);
    const card = battle.player.hand.find((c) => canPlayCard(battle.player, c));
    if (!card) throw new Error("expected an affordable card in the starting hand");
    playRound(battle, cardAction(battle.player, card.id));

    expect(battle.player.lastTurn?.round).toBe(1);
    expect(battle.player.lastTurn?.plays).toHaveLength(1);
    const play = battle.player.lastTurn!.plays[0]!;
    expect(play).toMatchObject({ kind: "card", cardId: card.cardId, name: card.name });
    // An attack the CPU interrupted never lands, so it has no damage either.
    expect(play.damage === null).toBe(card.category !== "attack" || play.cancelled !== null);
    expect(play.guard === null).toBe(card.category !== "defend");
    expect(battle.cpu.lastTurn!.round).toBe(1);

    const restored = deserializeBattle(JSON.parse(JSON.stringify(serializeBattle(battle))));
    expect(restored.player.lastTurn).toEqual(battle.player.lastTurn);
  });

  it("survives serialize -> JSON -> deserialize", () => {
    const [a, b] = firstTwoClasses();
    const battle = createBattle(a, b);
    const restored = deserializeBattle(JSON.parse(JSON.stringify(serializeBattle(battle))));
    expect(restored.player.classDef.id).toBe(a.id);
    expect(restored.player.hand.map((c) => c.id)).toEqual(battle.player.hand.map((c) => c.id));
    expect(restored.round).toBe(battle.round);
  });
});
