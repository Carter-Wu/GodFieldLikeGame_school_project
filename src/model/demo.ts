// Tiny in-browser smoke test for the data model in src/model/*. Renders
// pass/fail lines to the page (model-demo.html) -- enough to prove the
// pieces fit together, not a real test framework. Runs against the local
// catalog copy (catalogData.ts), not Supabase.

import { computeEffectiveStats } from "./classes.ts";
import { useLocalCatalog, findClassById, buildDeckForClass } from "./catalog.ts";
import { resolveSynergies } from "./synergies.ts";
import { applyDefend, createDefendCard, createAttackCard, STACKING } from "./cardTypes.ts";
import { DAMAGE_TYPE } from "./damageTypes.ts";
import { MODIFIER_MODE } from "./effects.ts";

useLocalCatalog();
const exampleClassGuardian = findClassById("guardian");
const exampleAttackCard = createAttackCard({ name: "Slash", damageType: DAMAGE_TYPE.PHYSICAL, value: 10 });
const exampleDefendCard = createDefendCard({
  name: "Iron Wall",
  damageType: DAMAGE_TYPE.PHYSICAL,
  mode: MODIFIER_MODE.FLAT,
  amount: 4,
  stacking: STACKING.NONSTACKABLE,
  duration: 1,
});

const results: { label: string; pass: boolean }[] = [];

function check(label: string, condition: unknown): void {
  results.push({ label, pass: Boolean(condition) });
}

// 1. Base stats come through unmodified with no active synergy.
const baseStats = computeEffectiveStats(exampleClassGuardian, []);
check("base DEF is 6 with no synergy active", baseStats.def === 6);

// 2. Tier-2 Bulwark synergy adds +5 flat DEF.
const tier2Effects = resolveSynergies(exampleClassGuardian.synergyPool, { bulwark: 2 });
const withTier2 = computeEffectiveStats(exampleClassGuardian, tier2Effects);
check("tier-2 Bulwark raises DEF to 11", withTier2.def === 11);

// 3. Tier-4 Bulwark replaces it with +12 flat DEF (highest tier reached wins).
const tier4Effects = resolveSynergies(exampleClassGuardian.synergyPool, { bulwark: 4 });
const withTier4 = computeEffectiveStats(exampleClassGuardian, tier4Effects);
check("tier-4 Bulwark raises DEF to 18", withTier4.def === 18);

// 4. Flat defend card reduces same-type attack damage.
const dmgWithDefend = applyDefend(exampleAttackCard, exampleDefendCard);
check("Iron Wall reduces 10 physical to 6", dmgWithDefend === 6);

// 5. A defend card of a different damage type does nothing.
const magicDefend = createDefendCard({
  name: "Ward",
  damageType: DAMAGE_TYPE.MAGIC,
  mode: MODIFIER_MODE.FLAT,
  amount: 4,
  stacking: STACKING.NONSTACKABLE,
  duration: 1,
});
const dmgWrongType = applyDefend(exampleAttackCard, magicDefend);
check("a magic defend card does not block physical damage", dmgWrongType === 10);

// 6. Percent defend card reduces damage proportionally.
const percentDefend = createDefendCard({
  name: "Deflect",
  damageType: DAMAGE_TYPE.PHYSICAL,
  mode: MODIFIER_MODE.PERCENT,
  amount: 0.3,
  stacking: STACKING.NONSTACKABLE,
  duration: 1,
});
const dmgWithPercent = applyDefend(exampleAttackCard, percentDefend);
check("a 30% defend card reduces 10 physical to 7", dmgWithPercent === 7);

// 7. True damage ignores a defend card that names a different type.
const trueAttack = createAttackCard({ name: "Execute", damageType: DAMAGE_TYPE.TRUE, value: 8 });
const dmgTrueVsPhysicalDefend = applyDefend(trueAttack, exampleDefendCard);
check("a physical defend card does not block true damage", dmgTrueVsPhysicalDefend === 8);

// 8. Decks are built from the catalog's class_deck_cards rows.
const guardianDeck = buildDeckForClass(exampleClassGuardian);
check("Guardian's catalog deck has 18 cards", guardianDeck.length === 18);
check(
  "catalog card instances carry their catalog id and props",
  guardianDeck.some((c) => c.cardId === "iron_wall" && c.category === "defend" && (c as { amount?: number }).amount === 5)
);

// Render results to the page.
const list = document.getElementById("results")!;
for (const { label, pass } of results) {
  const li = document.createElement("li");
  li.textContent = `${pass ? "PASS" : "FAIL"} -- ${label}`;
  li.className = pass ? "pass" : "fail";
  list.appendChild(li);
}

const failCount = results.filter((r) => !r.pass).length;
document.getElementById("summary")!.textContent =
  failCount === 0
    ? `All ${results.length} checks passed.`
    : `${failCount} of ${results.length} checks FAILED.`;
