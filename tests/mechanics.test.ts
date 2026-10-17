// The Card Design mechanics: multi-card turns paid with AP, priority + dice,
// interrupts, elements and statuses, monsters, and the new classes' decks.

import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createCardInstance, type Card } from "../src/model/cardTypes.ts";
import { allClasses, findCardById, findClassById, useLocalCatalog } from "../src/model/catalog.ts";
import {
  AP_RULES,
  cardAction,
  checkPlan,
  createBattle,
  computeCurrentStats,
  fromClientAction,
  passAction,
  planAction,
  playRound,
  resolveRound,
  setRandomSource,
  toClientAction,
  ultimateAction,
  type Action,
  type Battle,
  type Fighter,
  type MonsterOrder,
  type PlayRecord,
  type Target,
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
// it needs. Both sides get the max AP unless the test says otherwise.
function freshBattle(playerClass = "guardian", cpuClass = "pyromancer"): Battle {
  const battle = createBattle(findClassById(playerClass), findClassById(cpuClass), { playerDeck: [], cpuDeck: [] });
  for (const f of [battle.player, battle.cpu]) {
    f.ap = AP_RULES.max;
    f.maxAp = AP_RULES.max;
  }
  return battle;
}

function give(fighter: Fighter, cardId: string): Card {
  const entry = findCardById(cardId);
  if (!entry) throw new Error(`no card ${cardId}`);
  const card = createCardInstance(entry);
  fighter.hand.push(card);
  return card;
}

// Deal these cards and play them all this turn, in order.
function play(fighter: Fighter, ...cardIds: string[]): Action {
  const action = planAction(
    fighter,
    cardIds.map((id) => give(fighter, id).id)
  );
  if (!action) throw new Error(`can't play ${cardIds.join(", ")}`);
  return action;
}

// A player turn of just these monster orders (targets checked against the CPU).
function orders(b: Battle, list: MonsterOrder[]): Action {
  const action = planAction(b.player, [], false, { orders: list, opponent: b.cpu });
  if (!action) throw new Error("can't give those orders");
  return action;
}

// A player turn of one attack card aimed at `target`.
function aimed(b: Battle, cardId: string, target: Target): Action {
  const card = give(b.player, cardId);
  const action = planAction(b.player, [card.id], false, { targets: { [card.id]: target }, opponent: b.cpu });
  if (!action) throw new Error(`can't aim ${cardId} there`);
  return action;
}

const plays = (fighter: Fighter): PlayRecord[] => fighter.lastTurn?.plays ?? [];
const NOTHING = passAction();

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

describe("AP and multi-card turns", () => {
  it("starts at the start AP, then max AP grows by one a round and refills", () => {
    const b = createBattle(findClassById("guardian"), findClassById("pyromancer"), { playerDeck: [], cpuDeck: [] });
    expect(b.player.ap).toBe(AP_RULES.start);
    resolveRound(b, NOTHING, NOTHING);
    expect(b.player.maxAp).toBe(AP_RULES.start + AP_RULES.growth);
    expect(b.player.ap).toBe(b.player.maxAp);
  });

  it("plays every card of a turn the AP pays for", () => {
    const b = freshBattle("guardian", "black_mage");
    b.player.ap = 4;
    const hp = b.cpu.hp;
    resolveRound(b, play(b.player, "quick_jab", "shield_bash", "iron_wall"), NOTHING); // 1 + 2 + 1
    expect(plays(b.player).map((p) => p.name)).toEqual(["Quick Jab", "Shield Bash", "Iron Wall"]);
    expect(hp - b.cpu.hp).toBe(3 - 1 + (6 - 1)); // both attacks land, minus DEF 1 each
    expect(b.player.activeDefends.physical).toBeDefined();
  });

  it("refuses a turn that costs more AP than you have", () => {
    const b = freshBattle();
    b.player.ap = 5;
    const ids = ["quick_jab", "shield_bash", "heavy_slam"].map((id) => give(b.player, id).id); // 1 + 2 + 3
    expect(planAction(b.player, ids)).toBeNull();
    expect(checkPlan(b.player, b.player.hand).problem).toMatch(/needs 3 AP/);
  });

  it("loses unspent AP: it refills to the new max instead of carrying over", () => {
    const b = freshBattle();
    b.player.ap = 5;
    b.player.maxAp = 5;
    resolveRound(b, NOTHING, NOTHING);
    expect(b.player.ap).toBe(6);
  });

  it("Dark Pact's AP pays for cards picked after it the same turn", () => {
    const b = freshBattle("black_mage");
    b.player.ap = 0;
    const hp = b.player.hp;
    const cpuHp = b.cpu.hp;
    resolveRound(b, play(b.player, "dark_pact", "shadow_bolt"), NOTHING);
    expect(b.player.hp).toBe(hp - 4);
    expect(cpuHp - b.cpu.hp).toBe(6 - 3); // magic 6 minus pyromancer MR 3
  });

  it("can fire the ultimate alongside cards", () => {
    const b = freshBattle("guardian", "black_mage");
    b.player.ultimateMeter = b.player.classDef.ultimate.cost;
    const action = planAction(b.player, [give(b.player, "quick_jab").id], true);
    expect(action).not.toBeNull();
    resolveRound(b, action!, NOTHING);
    expect(plays(b.player).map((p) => p.kind)).toEqual(["card", "ultimate"]);
  });

  it("adds a card's ultimate charge to the meter", () => {
    const b = freshBattle("craftsman");
    const regen = b.player.classDef.baseStats.ur;
    resolveRound(b, play(b.player, "whetstone"), NOTHING); // +4 UR
    expect(b.player.ultimateMeter).toBe(4 + regen);
  });
});

describe("priority and dice", () => {
  it("the higher priority strikes first, and a knockout cancels the other side's strikes", () => {
    const b = freshBattle();
    b.cpu.hp = 1;
    resolveRound(b, play(b.player, "quick_jab"), play(b.cpu, "fire_lance", "ember_dart"));
    expect(b.winner).toBe(b.player);
    expect(b.player.hp).toBe(b.player.maxHp);
    expect(plays(b.player)[0]?.order).toBe(1);
    expect(plays(b.cpu).map((p) => p.cancelled)).toEqual(["knocked_out", "knocked_out"]);
  });

  it("ties between the sides go to the dice; a side's own strikes keep their order", () => {
    const b = freshBattle();
    const rolls = [0.1, 0.9]; // player 1, cpu 6
    setRandomSource(() => rolls.shift() ?? 0.5);
    resolveRound(b, play(b.player, "shield_bash"), play(b.cpu, "ember_dart", "fire_lance"));
    expect(b.player.lastTurn?.dice).toBe(1);
    expect(b.cpu.lastTurn?.dice).toBe(6);
    expect(plays(b.cpu).map((p) => p.order)).toEqual([1, 2]);
    expect(plays(b.player)[0]?.order).toBe(3);
  });

  it("no dice when nothing ties", () => {
    const b = freshBattle();
    resolveRound(b, play(b.player, "quick_jab"), play(b.cpu, "ember_dart"));
    expect(b.player.lastTurn?.dice).toBeNull();
  });

  it("a landed interrupt cancels only the opponent's next attack card", () => {
    const b = freshBattle("guardian", "black_mage");
    const hp = b.player.hp;
    resolveRound(b, play(b.player, "shield_rush"), play(b.cpu, "shadow_bolt", "vampiric_touch"));
    expect(plays(b.cpu).map((p) => p.cancelled)).toEqual(["interrupted", null]);
    expect(hp - b.player.hp).toBe(5 - 2); // Vampiric Touch still lands, minus MR 2
  });

  it("slowed lowers priority", () => {
    const b = freshBattle();
    b.player.statuses.slowed = { potency: 2, remaining: 2 };
    resolveRound(b, play(b.player, "quick_jab"), play(b.cpu, "ember_dart"));
    expect(plays(b.cpu)[0]?.order).toBe(1);
  });
});

describe("elements and statuses", () => {
  it("burning ticks at the end of the round and wears off", () => {
    const b = freshBattle();
    const hp = b.player.hp;
    resolveRound(b, NOTHING, play(b.cpu, "ignite")); // burn 3 for 3 rounds
    expect(b.player.hp).toBe(hp - 3);
    expect(b.player.lastTurn?.statusTicks).toEqual([{ status: "burning", damage: 3 }]);
    resolveRound(b, NOTHING, NOTHING);
    resolveRound(b, NOTHING, NOTHING);
    expect(b.player.hp).toBe(hp - 9);
    expect(b.player.statuses.burning).toBeUndefined();
  });

  it("poison stacks, even twice in one turn", () => {
    const b = freshBattle("guardian", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "plague_cloud", "plague_cloud"));
    expect(b.player.statuses.poison?.potency).toBe(4);
  });

  it("Splash then Spark in one turn: wet makes the shock hit 50% harder", () => {
    const b = freshBattle("pyromancer", "guardian");
    const hp = b.cpu.hp;
    resolveRound(b, play(b.player, "splash", "spark"), NOTHING);
    // splash: magic 2 - MR 2 = 0; spark: 3 -> 4.5 -> 5, minus MR 2 = 3
    expect(hp - b.cpu.hp).toBe(3);
  });

  it("water puts out burning, and burning can't catch on a wet target", () => {
    const b = freshBattle();
    b.cpu.statuses.burning = { potency: 3, remaining: 3 };
    resolveRound(b, play(b.player, "splash"), NOTHING);
    expect(b.cpu.statuses.burning).toBeUndefined();
    expect(b.cpu.statuses.wet).toBeDefined();
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
  it("only act when ordered, and an attack order costs AP", () => {
    const b = freshBattle("necromancer", "pyromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), NOTHING);
    expect(b.player.field.map((m) => m.name)).toEqual(["Raise Skeleton"]);
    const hp = b.cpu.hp;
    resolveRound(b, NOTHING, NOTHING); // no order: the skeleton just stands there
    expect(b.cpu.hp).toBe(hp);

    const skeleton = b.player.field[0]!;
    const action = orders(b, [{ uid: skeleton.uid, use: "attack", target: { kind: "fighter" } }]);
    expect(checkPlan(b.player, [], false, action.orders).ap).toBe(AP_RULES.max - 1);
    resolveRound(b, action, NOTHING); // 2 physical, gets past DEF
    expect(hp - b.cpu.hp).toBe(2);
    expect(b.player.lastTurn?.monsterHits).toHaveLength(1);
  });

  it("can't take orders the round they're summoned", () => {
    const b = freshBattle("necromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), NOTHING);
    b.player.field[0]!.ready = false;
    expect(planAction(b.player, [], false, { orders: [{ uid: b.player.field[0]!.uid, use: "attack", target: null }] })).toBeNull();
  });

  it("attack the monster you aim them at", () => {
    const b = freshBattle("necromancer", "pyromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), play(b.cpu, "flame_imp"));
    const hp = b.cpu.hp;
    const imp = b.cpu.field[0]!;
    resolveRound(b, orders(b, [{ uid: b.player.field[0]!.uid, use: "attack", target: { kind: "monster", uid: imp.uid } }]), NOTHING);
    expect(b.cpu.hp).toBe(hp);
    expect(imp.hp).toBe(6 - 2);
  });

  it("use their ability for its AP cost", () => {
    const b = freshBattle("pyromancer", "guardian");
    resolveRound(b, play(b.player, "flame_imp"), NOTHING);
    const imp = b.player.field[0]!;
    const action = orders(b, [{ uid: imp.uid, use: "ability", target: { kind: "fighter" } }]);
    expect(checkPlan(b.player, [], false, action.orders).ap).toBe(AP_RULES.max - 2);
    const hp = b.cpu.hp;
    resolveRound(b, action, NOTHING); // Fire Breath: 4 fire, then Burn 2 at the end of the round
    expect(hp - b.cpu.hp).toBe(4 + 2);
    expect(b.player.lastTurn?.monsterHits[0]?.ability).toBe("Fire Breath");
  });

  it("can use a self ability without a target", () => {
    const b = freshBattle("guardian");
    resolveRound(b, play(b.player, "stone_sentinel"), NOTHING);
    const def = computeCurrentStats(b.player).def;
    resolveRound(b, orders(b, [{ uid: b.player.field[0]!.uid, use: "ability", target: null }]), NOTHING); // Fortify: DEF +3
    expect(computeCurrentStats(b.player).def).toBe(def + 3);
    expect(b.player.lastTurn?.monsterHits[0]?.target).toBe("self");
  });

  it("the CPU orders its ready monsters", () => {
    const b = freshBattle("guardian", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "raise_skeleton"));
    setRandomSource(() => 0.9);
    playRound(b, NOTHING);
    expect(b.cpu.lastTurn?.monsterHits).toHaveLength(1);
  });
});

describe("targets", () => {
  it("an attack card aimed at a monster hits it instead of the fighter", () => {
    const b = freshBattle("guardian", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "shambling_zombie"));
    const zombie = b.cpu.field[0]!;
    const hp = b.cpu.hp;
    resolveRound(b, aimed(b, "heavy_slam", { kind: "monster", uid: zombie.uid }), NOTHING);
    expect(b.cpu.hp).toBe(hp);
    expect(zombie.hp).toBe(9 - 9);
    expect(b.cpu.field).toHaveLength(0);
    expect(plays(b.player)[0]?.target).toBe("Shambling Zombie");
  });

  it("a guard has to be targeted first", () => {
    const b = freshBattle("pyromancer", "guardian");
    resolveRound(b, NOTHING, play(b.cpu, "stone_sentinel"));
    const card = give(b.player, "fire_lance");
    const opponent = b.cpu;
    expect(planAction(b.player, [card.id], false, { targets: { [card.id]: { kind: "fighter" } }, opponent })).toBeNull();
    const sentinel = b.cpu.field[0]!;
    expect(planAction(b.player, [card.id], false, { targets: { [card.id]: { kind: "monster", uid: sentinel.uid } }, opponent })).not.toBeNull();
  });

  it("a guard monster takes attack cards aimed at its owner", () => {
    const b = freshBattle("guardian", "pyromancer");
    resolveRound(b, play(b.player, "stone_sentinel"), NOTHING);
    const hp = b.player.hp;
    resolveRound(b, NOTHING, play(b.cpu, "fire_lance"));
    expect(b.player.hp).toBe(hp);
    expect(b.player.field[0]?.hp).toBe(12 - 8);
  });

  it("falls back to the fighter when the aimed-at monster is already gone", () => {
    const b = freshBattle("pyromancer", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "raise_skeleton"));
    const skeleton = b.cpu.field[0]!;
    const inferno = give(b.player, "inferno");
    const dart = give(b.player, "ember_dart");
    const action = planAction(b.player, [inferno.id, dart.id], false, {
      targets: { [dart.id]: { kind: "monster", uid: skeleton.uid } },
      opponent: b.cpu,
    })!;
    const hp = b.cpu.hp;
    resolveRound(b, action, NOTHING); // Inferno kills the skeleton first; the dart then hits the fighter
    expect(b.cpu.field).toHaveLength(0);
    expect(b.cpu.hp).toBeLessThan(hp);
    expect(plays(b.player)[1]?.target).toBe("fighter");
  });

  it("survive the trip to the server", () => {
    const b = freshBattle("necromancer", "pyromancer");
    resolveRound(b, play(b.player, "raise_skeleton"), play(b.cpu, "flame_imp"));
    const card = give(b.player, "bone_spear");
    const imp = b.cpu.field[0]!;
    const action = planAction(b.player, [card.id], false, {
      targets: { [card.id]: { kind: "monster", uid: imp.uid } },
      orders: [{ uid: b.player.field[0]!.uid, use: "attack", target: { kind: "fighter" } }],
      opponent: b.cpu,
    })!;
    const wire = JSON.parse(JSON.stringify(toClientAction(action)));
    expect(fromClientAction(b.player, b.cpu, wire)).toEqual(action);
    expect(fromClientAction(b.player, b.cpu, { ...wire, orders: [{ uid: 99, use: "attack", target: null }] })).toBeNull();
  });
});

describe("monster cards", () => {
  it("field attacks hit every enemy monster", () => {
    const b = freshBattle("pyromancer", "necromancer");
    resolveRound(b, NOTHING, play(b.cpu, "raise_skeleton", "grave_guard"));
    resolveRound(b, play(b.player, "inferno"), NOTHING);
    expect(b.cpu.field.map((m) => m.name)).toEqual(["Grave Guard"]);
  });

  it("a turn can't summon past a full field", () => {
    const b = freshBattle("necromancer");
    const ids = ["raise_skeleton", "raise_skeleton", "grave_guard", "raise_skeleton"].map((id) => give(b.player, id).id);
    expect(planAction(b.player, ids.slice(0, 3))).not.toBeNull();
    expect(planAction(b.player, ids)).toBeNull();
    resolveRound(b, planAction(b.player, ids.slice(0, 3))!, NOTHING);
    expect(cardAction(b.player, ids[3]!)).toBeNull();
  });

  it("Necromancer's ultimate raises two skeletons", () => {
    const b = freshBattle("necromancer");
    b.player.ultimateMeter = 99;
    resolveRound(b, ultimateAction(b.player)!, NOTHING);
    expect(b.player.field).toHaveLength(2);
  });
});

describe("serialization", () => {
  it("keeps AP, monsters, statuses and the last turn", () => {
    const b = freshBattle("necromancer");
    resolveRound(b, play(b.player, "raise_skeleton", "bone_spear"), play(b.cpu, "ignite"));
    const restored = deserializeBattle(JSON.parse(JSON.stringify(serializeBattle(b))));
    expect(restored.player.ap).toBe(b.player.ap);
    expect(restored.player.maxAp).toBe(b.player.maxAp);
    expect(restored.player.field).toEqual(b.player.field);
    expect(restored.player.statuses).toEqual(b.player.statuses);
    expect(restored.player.lastTurn).toEqual(b.player.lastTurn);
  });
});
