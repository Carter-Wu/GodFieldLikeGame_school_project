// The Card Design mechanics: AP costs, priority + dice, interrupts,
// elements and statuses, monsters, and the new classes' starter decks.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCardInstance, type Card } from "../src/model/cardTypes.ts";
import { allClasses, findCardById, findClassById, useLocalCatalog } from "../src/model/catalog.ts";
import {
  AP_RULES,
  cardAction,
  createBattle,
  resolveRound,
  restAction,
  setRandomSource,
  ultimateAction,
  type Action,
  type Battle,
  type Fighter,
} from "../src/model/engine.ts";
import { deserializeBattle, serializeBattle } from "../src/model/serialize.ts";
import { starterDeckList, validateDeckList } from "../src/model/decks.ts";

beforeAll(() => {
  useLocalCatalog();
});

afterEach(() => {
  setRandomSource(null);
});

// A battle with empty decks and hands, so each test deals exactly the cards
// it needs. Both sides get plenty of AP unless the test says otherwise.
function freshBattle(playerClass = "guardian", cpuClass = "pyromancer"): Battle {
  const battle = createBattle(findClassById(playerClass), findClassById(cpuClass), { playerDeck: [], cpuDeck: [] });
  battle.player.ap = AP_RULES.max;
  battle.cpu.ap = AP_RULES.max;
  return battle;
}

function give(fighter: Fighter, cardId: string): Card {
  const entry = findCardById(cardId);
  if (!entry) throw new Error(`no card ${cardId}`);
  const card = createCardInstance(entry);
  fighter.hand.push(card);
  return card;
}

function play(fighter: Fighter, cardId: string): Action {
  const action = cardAction(fighter, give(fighter, cardId).id);
  if (!action) throw new Error(`can't play ${cardId}`);
  return action;
}

const NOTHING: Action = { kind: "none" };

describe("new classes", () => {
  it("adds Black Mage, Master Craftsman and Necromancer with legal starter decks", () => {
    const ids = allClasses().map((c) => c.id);
    expect(ids).toEqual(expect.arrayContaining(["black_mage", "craftsman", "necromancer"]));
    for (const classDef of allClasses()) expect(validateDeckList(classDef, starterDeckList(classDef))).toBeNull();
  });

  it("puts the general cards in every class's deck", () => {
    for (const classDef of allClasses()) {
      const ids = starterDeckList(classDef).map((e) => e.cardId);
      expect(ids).toEqual(expect.arrayContaining(["quick_jab", "splash", "spark", "healing_potion", "meditate", "smoke_bomb"]));
    }
  });
});

describe("AP", () => {
  it("spends a card's cost and regains AP each round", () => {
    const b = freshBattle();
    b.player.ap = 3;
    resolveRound(b, play(b.player, "heavy_slam"), NOTHING); // costs 3
    expect(b.player.ap).toBe(AP_RULES.perRound);
  });

  it("won't play a card you can't afford", () => {
    const b = freshBattle();
    b.player.ap = 2;
    const card = give(b.player, "heavy_slam");
    expect(cardAction(b.player, card.id)).toBeNull();
  });

  it("rest gives bonus AP, capped at the max", () => {
    const b = freshBattle();
    b.player.ap = 1;
    resolveRound(b, restAction(), NOTHING);
    expect(b.player.ap).toBe(1 + AP_RULES.restBonus + AP_RULES.perRound);
    b.player.ap = AP_RULES.max;
    resolveRound(b, restAction(), NOTHING);
    expect(b.player.ap).toBe(AP_RULES.max);
  });

  it("Dark Pact trades HP for AP and a card", () => {
    const b = freshBattle("black_mage");
    b.player.ap = 0;
    const hp = b.player.hp;
    b.player.deck = [createCardInstance(findCardById("shadow_bolt")!)];
    resolveRound(b, play(b.player, "dark_pact"), NOTHING);
    expect(b.player.hp).toBe(hp - 4);
    expect(b.player.ap).toBe(3 + AP_RULES.perRound);
    expect(b.player.hand.map((c) => c.cardId)).toContain("shadow_bolt");
  });

  it("adds a card's ultimate charge to the meter", () => {
    const b = freshBattle("craftsman");
    const regen = b.player.classDef.baseStats.ur;
    resolveRound(b, play(b.player, "whetstone"), NOTHING); // +4 UR
    expect(b.player.ultimateMeter).toBe(4 + regen);
  });
});

describe("priority and dice", () => {
  it("the higher priority strikes first, and a knockout cancels the other attack", () => {
    const b = freshBattle();
    b.cpu.hp = 1;
    resolveRound(b, play(b.player, "quick_jab"), play(b.cpu, "fire_lance"));
    expect(b.winner).toBe(b.player);
    expect(b.player.hp).toBe(b.player.maxHp);
    expect(b.player.lastAction?.order).toBe(1);
    expect(b.cpu.lastAction?.cancelled).toBe("knocked_out");
  });

  it("equal priority rolls dice, highest first", () => {
    const b = freshBattle();
    const rolls = [0.1, 0.9]; // player 1, cpu 6
    setRandomSource(() => rolls.shift() ?? 0.5);
    resolveRound(b, play(b.player, "shield_bash"), play(b.cpu, "ember_dart"));
    expect(b.player.lastAction?.dice).toBe(1);
    expect(b.cpu.lastAction?.dice).toBe(6);
    expect(b.cpu.lastAction?.order).toBe(1);
    expect(b.player.lastAction?.order).toBe(2);
  });

  it("an interrupting attack that lands cancels the slower attack card", () => {
    const b = freshBattle("guardian", "black_mage");
    const hp = b.player.hp;
    resolveRound(b, play(b.player, "shield_rush"), play(b.cpu, "shadow_bolt"));
    expect(b.cpu.lastAction?.cancelled).toBe("interrupted");
    expect(b.player.hp).toBe(hp);
  });

  it("slowed lowers priority", () => {
    const b = freshBattle();
    b.player.statuses.slowed = { potency: 2, remaining: 2 };
    setRandomSource(() => 0.5);
    resolveRound(b, play(b.player, "quick_jab"), play(b.cpu, "ember_dart"));
    expect(b.cpu.lastAction?.order).toBe(1);
  });
});

describe("elements and statuses", () => {
  it("burning ticks at the end of the round and wears off", () => {
    const b = freshBattle();
    const hp = b.player.hp;
    resolveRound(b, NOTHING, play(b.cpu, "ignite")); // burn 3 for 3 rounds
    expect(b.player.hp).toBe(hp - 3);
    expect(b.player.lastAction?.statusTicks).toEqual([{ status: "burning", damage: 3 }]);
    resolveRound(b, NOTHING, NOTHING);
    resolveRound(b, NOTHING, NOTHING);
    expect(b.player.hp).toBe(hp - 9);
    expect(b.player.statuses.burning).toBeUndefined();
  });

  it("poison stacks", () => {
    const b = freshBattle("guardian", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "plague_cloud"));
    resolveRound(b, NOTHING, play(b.cpu, "plague_cloud"));
    expect(b.player.statuses.poison?.potency).toBe(4);
  });

  it("wet targets take +50% electric damage", () => {
    const b = freshBattle("pyromancer", "guardian");
    b.cpu.statuses.wet = { potency: 1, remaining: 2 };
    const hp = b.cpu.hp;
    resolveRound(b, play(b.player, "spark"), NOTHING); // magic 3 -> 4.5 -> 5, minus MR 2
    expect(hp - b.cpu.hp).toBe(3);
  });

  it("water puts out burning, and burning can't catch on a wet target", () => {
    const b = freshBattle();
    b.cpu.statuses.burning = { potency: 3, remaining: 3 };
    resolveRound(b, play(b.player, "splash"), NOTHING);
    expect(b.cpu.statuses.burning).toBeUndefined();
    expect(b.cpu.statuses.wet).toBeDefined();
    resolveRound(b, NOTHING, NOTHING);
    b.cpu.statuses.wet = { potency: 1, remaining: 2 };
    resolveRound(b, play(b.player, "ignite"), NOTHING);
    expect(b.cpu.statuses.burning).toBeUndefined();
    expect(b.cpu.statuses.wet).toBeUndefined(); // the fire dried them instead
  });

  it("blind halves attack damage", () => {
    const b = freshBattle("guardian", "black_mage");
    b.player.statuses.blind = { potency: 1, remaining: 2 };
    const hp = b.cpu.hp;
    resolveRound(b, play(b.player, "heavy_slam"), NOTHING); // 9 -> 4, minus DEF 1
    expect(hp - b.cpu.hp).toBe(3);
  });

  it("lifesteal heals the attacker", () => {
    const b = freshBattle("black_mage", "guardian");
    b.player.hp = 10;
    resolveRound(b, play(b.player, "vampiric_touch"), NOTHING); // magic 5 - MR 2 = 3
    expect(b.player.hp).toBe(13);
  });
});

describe("monsters", () => {
  it("are summoned, wait a round, then attack the enemy fighter", () => {
    const b = freshBattle("necromancer", "pyromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), NOTHING);
    expect(b.player.field.map((m) => m.name)).toEqual(["Raise Skeleton"]);
    const hp = b.cpu.hp;
    resolveRound(b, NOTHING, NOTHING); // skeleton: 2 physical, ignores DEF
    expect(hp - b.cpu.hp).toBe(2);
    expect(b.player.lastAction?.monsterHits).toHaveLength(1);
  });

  it("fight the enemy's monsters before the enemy fighter", () => {
    const b = freshBattle("necromancer", "pyromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), play(b.cpu, "flame_imp"));
    const hp = b.cpu.hp;
    resolveRound(b, NOTHING, NOTHING);
    expect(b.cpu.hp).toBe(hp);
    expect(b.cpu.field[0]?.hp).toBe(6 - 2);
  });

  it("a guard monster takes attack cards aimed at its owner", () => {
    const b = freshBattle("guardian", "pyromancer");
    resolveRound(b, play(b.player, "stone_sentinel"), NOTHING);
    const hp = b.player.hp;
    resolveRound(b, NOTHING, play(b.cpu, "fire_lance"));
    expect(b.player.hp).toBe(hp);
    expect(b.player.field[0]?.hp).toBe(12 - 8);
  });

  it("field attacks hit every enemy monster", () => {
    const b = freshBattle("pyromancer", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "raise_skeleton"));
    resolveRound(b, NOTHING, play(b.cpu, "grave_guard"));
    resolveRound(b, play(b.player, "inferno"), NOTHING);
    expect(b.cpu.field.map((m) => m.name)).toEqual(["Grave Guard"]);
  });

  it("can't be played onto a full field", () => {
    const b = freshBattle("necromancer");
    for (let i = 0; i < 3; i++) resolveRound(b, play(b.player, "raise_skeleton"), NOTHING);
    b.player.ap = AP_RULES.max;
    expect(cardAction(b.player, give(b.player, "raise_skeleton").id)).toBeNull();
  });

  it("Necromancer's ultimate raises two skeletons", () => {
    const b = freshBattle("necromancer");
    b.player.ultimateMeter = 99;
    resolveRound(b, ultimateAction(b.player)!, NOTHING);
    expect(b.player.field).toHaveLength(2);
  });
});

describe("serialization", () => {
  it("keeps AP, monsters and statuses", () => {
    const b = freshBattle("necromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), play(b.cpu, "ignite"));
    const restored = deserializeBattle(JSON.parse(JSON.stringify(serializeBattle(b))));
    expect(restored.player.ap).toBe(b.player.ap);
    expect(restored.player.field).toEqual(b.player.field);
    expect(restored.player.statuses).toEqual(b.player.statuses);
    expect(restored.player.lastAction).toEqual(b.player.lastAction);
  });
});
