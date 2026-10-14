// Local copy of the game catalog, in the exact row shape of the Supabase
// catalog tables (supabase/migrations/*_game_catalog.sql). The database is
// the source of truth; this copy is only
//   - the offline fallback when the browser can't reach Supabase (vs-CPU
//     still works), and
//   - what `npm run catalog:sql` turns into seed SQL.
// Balance changes made in the dashboard don't flow back here on their own.
//
// Names and numbers are placeholders for wiring the engine end to end, not
// tuned game balance.

import { CARD_CATEGORY, STACKING } from "./cardTypes.ts";
import { DAMAGE_TYPE } from "./damageTypes.ts";
import { MODIFIER_MODE, energyRegen, meterSiphon, statModifier } from "./effects.ts";
import type { CatalogRows } from "./catalog.ts";

const synergies: CatalogRows["synergies"] = [
  {
    id: "bulwark",
    name: "Bulwark (example)",
    description: "Placeholder synergy: rewards playing defend cards.",
    counts_category: CARD_CATEGORY.DEFEND,
    tiers: [
      { count: 2, effects: [statModifier("def", MODIFIER_MODE.FLAT, 5)] },
      { count: 4, effects: [statModifier("def", MODIFIER_MODE.FLAT, 12)] },
    ],
  },
  {
    id: "kindling",
    name: "Kindling (example)",
    description: "Placeholder synergy: aggression (attack cards) fuels ultimate charge.",
    counts_category: CARD_CATEGORY.ATTACK,
    tiers: [
      { count: 2, effects: [statModifier("ur", MODIFIER_MODE.FLAT, 2)] },
      { count: 4, effects: [statModifier("ur", MODIFIER_MODE.FLAT, 5)] },
    ],
  },
];

const classes: CatalogRows["classes"] = [
  {
    id: "guardian",
    name: "Guardian (example)",
    base_stats: { hp: 44, def: 6, mr: 2, er: 2, ur: 6, crit: 0 },
    ultimate: {
      id: "guardian_ultimate",
      name: "TBD",
      description: "Placeholder -- ultimate name/theme is still an open question.",
      cost: 24,
      damage: 14,
    },
    passives: [],
    sort_order: 1,
  },
  {
    id: "pyromancer",
    name: "Pyromancer (example)",
    base_stats: { hp: 34, def: 2, mr: 3, er: 4, ur: 8, crit: 0 },
    ultimate: {
      id: "pyromancer_ultimate",
      name: "TBD",
      description: "Placeholder -- ultimate name/theme is still an open question.",
      cost: 20,
      damage: 18,
    },
    passives: [],
    sort_order: 2,
  },
];

const class_synergies: CatalogRows["class_synergies"] = [
  { class_id: "guardian", synergy_id: "bulwark" },
  { class_id: "pyromancer", synergy_id: "kindling" },
];

const cards: CatalogRows["cards"] = [
  // Guardian
  { id: "shield_bash", name: "Shield Bash", category: CARD_CATEGORY.ATTACK, props: { damageType: DAMAGE_TYPE.PHYSICAL, value: 6 } },
  { id: "heavy_slam", name: "Heavy Slam", category: CARD_CATEGORY.ATTACK, props: { damageType: DAMAGE_TYPE.PHYSICAL, value: 9 } },
  {
    id: "iron_wall",
    name: "Iron Wall",
    category: CARD_CATEGORY.DEFEND,
    props: { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.FLAT, amount: 5, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  {
    id: "brace",
    name: "Brace",
    category: CARD_CATEGORY.DEFEND,
    props: { damageType: DAMAGE_TYPE.PHYSICAL, mode: MODIFIER_MODE.PERCENT, amount: 0.3, stacking: STACKING.NONSTACKABLE, duration: 2 },
  },
  { id: "second_wind", name: "Second Wind", category: CARD_CATEGORY.BUFF, props: { effects: [energyRegen(MODIFIER_MODE.FLAT, 2)], duration: 3 } },
  { id: "taunt", name: "Taunt", category: CARD_CATEGORY.DEBUFF, props: { effects: [meterSiphon(5)], duration: 1 } },
  // Pyromancer
  { id: "ember_dart", name: "Ember Dart", category: CARD_CATEGORY.ATTACK, props: { damageType: DAMAGE_TYPE.ELEMENT, value: 5 } },
  { id: "fire_lance", name: "Fire Lance", category: CARD_CATEGORY.ATTACK, props: { damageType: DAMAGE_TYPE.ELEMENT, value: 8 } },
  {
    id: "heat_shroud",
    name: "Heat Shroud",
    category: CARD_CATEGORY.DEFEND,
    props: { damageType: DAMAGE_TYPE.ELEMENT, mode: MODIFIER_MODE.FLAT, amount: 4, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  {
    id: "stoke_the_flame",
    name: "Stoke the Flame",
    category: CARD_CATEGORY.BUFF,
    props: { effects: [energyRegen(MODIFIER_MODE.FLAT, 3)], duration: 2 },
  },
  {
    id: "scorch",
    name: "Scorch",
    category: CARD_CATEGORY.DEBUFF,
    props: { effects: [statModifier("er", MODIFIER_MODE.FLAT, -2)], duration: 2 },
  },
];

const class_deck_cards: CatalogRows["class_deck_cards"] = [
  { class_id: "guardian", card_id: "shield_bash", copies: 4 },
  { class_id: "guardian", card_id: "heavy_slam", copies: 3 },
  { class_id: "guardian", card_id: "iron_wall", copies: 4 },
  { class_id: "guardian", card_id: "brace", copies: 3 },
  { class_id: "guardian", card_id: "second_wind", copies: 2 },
  { class_id: "guardian", card_id: "taunt", copies: 2 },
  { class_id: "pyromancer", card_id: "ember_dart", copies: 4 },
  { class_id: "pyromancer", card_id: "fire_lance", copies: 3 },
  { class_id: "pyromancer", card_id: "heat_shroud", copies: 3 },
  { class_id: "pyromancer", card_id: "stoke_the_flame", copies: 3 },
  { class_id: "pyromancer", card_id: "scorch", copies: 3 },
];

export const LOCAL_CATALOG_ROWS: CatalogRows = { synergies, classes, class_synergies, cards, class_deck_cards };
