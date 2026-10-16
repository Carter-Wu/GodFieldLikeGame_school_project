// Local copy of the game catalog, in the exact row shape of the Supabase
// catalog tables (supabase/migrations/*_game_catalog.sql). The database is
// the source of truth; this copy is only
//   - the offline fallback when the browser can't reach Supabase (vs-CPU
//     still works), and
//   - what `npm run catalog:sql` turns into seed SQL.
// Balance changes made in the dashboard don't flow back here on their own.
//
// Classes and cards follow the "Card Design" doc: every card has an AP cost,
// some charge the ultimate meter extra, attacks/monsters can carry an element
// and statuses, and there's a general card set every class gets (GENERAL_DECK
// below). Numbers are first-pass, not tuned balance.

import { CARD_CATEGORY, STACKING } from "./cardTypes.ts";
import { DAMAGE_TYPE, ELEMENT } from "./damageTypes.ts";
import {
  MODIFIER_MODE,
  STATUS,
  applyStatus,
  cleanse,
  draw,
  energyRegen,
  gainAp,
  heal,
  meterSiphon,
  statModifier,
  summon,
} from "./effects.ts";
import type { CatalogRows } from "./catalog.ts";

const { ATTACK, DEFEND, BUFF, DEBUFF, MONSTER } = CARD_CATEGORY;
const { PHYSICAL, MAGIC, ELEMENT: ELEMENTAL } = DAMAGE_TYPE;
const { FLAT, PERCENT } = MODIFIER_MODE;

const synergies: CatalogRows["synergies"] = [
  {
    id: "bulwark",
    name: "Bulwark (example)",
    description: "Placeholder synergy: rewards playing defend cards.",
    counts_category: DEFEND,
    tiers: [
      { count: 2, effects: [statModifier("def", FLAT, 5)] },
      { count: 4, effects: [statModifier("def", FLAT, 12)] },
    ],
  },
  {
    id: "kindling",
    name: "Kindling (example)",
    description: "Placeholder synergy: aggression (attack cards) fuels ultimate charge.",
    counts_category: ATTACK,
    tiers: [
      { count: 2, effects: [statModifier("ur", FLAT, 2)] },
      { count: 4, effects: [statModifier("ur", FLAT, 5)] },
    ],
  },
  {
    id: "dark_arts",
    name: "Dark Arts",
    description: "Every curse feeds the Black Mage: debuffs raise ultimate regen, then magic resist.",
    counts_category: DEBUFF,
    tiers: [
      { count: 2, effects: [statModifier("ur", FLAT, 2)] },
      { count: 4, effects: [statModifier("ur", FLAT, 4), statModifier("mr", FLAT, 3)] },
    ],
  },
  {
    id: "forge",
    name: "Forge",
    description: "Each tool the Craftsman readies (buff) sharpens every attack: +ATK.",
    counts_category: BUFF,
    tiers: [
      { count: 2, effects: [statModifier("atk", FLAT, 1)] },
      { count: 4, effects: [statModifier("atk", FLAT, 3)] },
    ],
  },
  {
    id: "horde",
    name: "Horde",
    description: "The more the Necromancer summons, the harder they are to put down.",
    counts_category: MONSTER,
    tiers: [
      { count: 2, effects: [statModifier("def", FLAT, 2)] },
      { count: 4, effects: [statModifier("def", FLAT, 4), statModifier("ur", FLAT, 2)] },
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
  {
    id: "black_mage",
    name: "Black Mage",
    base_stats: { hp: 32, def: 1, mr: 5, er: 2, ur: 6, crit: 0 },
    ultimate: {
      id: "black_mage_ultimate",
      name: "Eclipse",
      description: "14 damage, and the darkness mends the caster for 8.",
      cost: 22,
      damage: 14,
      effects: [heal(8)],
      duration: 1,
    },
    passives: [],
    sort_order: 3,
  },
  {
    id: "craftsman",
    name: "Master Craftsman",
    base_stats: { hp: 38, def: 4, mr: 2, er: 2, ur: 5, crit: 0 },
    ultimate: {
      id: "craftsman_ultimate",
      name: "Masterpiece",
      description: "6 damage, then ATK +4 for 3 rounds.",
      cost: 16,
      damage: 6,
      effects: [statModifier("atk", FLAT, 4)],
      duration: 3,
    },
    passives: [],
    sort_order: 4,
  },
  {
    id: "necromancer",
    name: "Necromancer",
    base_stats: { hp: 36, def: 2, mr: 4, er: 3, ur: 5, crit: 0 },
    ultimate: {
      id: "necromancer_ultimate",
      name: "Army of the Dead",
      description: "8 damage, and two Skeletons rise.",
      cost: 20,
      damage: 8,
      effects: [summon("raise_skeleton", 2)],
      duration: 1,
    },
    passives: [],
    sort_order: 5,
  },
];

const class_synergies: CatalogRows["class_synergies"] = [
  { class_id: "guardian", synergy_id: "bulwark" },
  { class_id: "pyromancer", synergy_id: "kindling" },
  { class_id: "black_mage", synergy_id: "dark_arts" },
  { class_id: "craftsman", synergy_id: "forge" },
  { class_id: "necromancer", synergy_id: "horde" },
];

const cards: CatalogRows["cards"] = [
  // General -- in every class's deck
  { id: "quick_jab", name: "Quick Jab", category: ATTACK, props: { cost: 1, damageType: PHYSICAL, value: 3, priority: 1 } },
  {
    id: "splash",
    name: "Splash",
    category: ATTACK,
    props: { cost: 1, damageType: MAGIC, element: ELEMENT.WATER, value: 2, applies: [applyStatus(STATUS.WET, 1, 2)] },
  },
  { id: "spark", name: "Spark", category: ATTACK, props: { cost: 1, damageType: MAGIC, element: ELEMENT.ELECTRIC, value: 3 } },
  { id: "healing_potion", name: "Healing Potion", category: BUFF, props: { cost: 2, effects: [heal(6)], duration: 1 } },
  { id: "meditate", name: "Meditate", category: BUFF, props: { cost: 0, uaCharge: 4, effects: [energyRegen(FLAT, 2)], duration: 2 } },
  { id: "smoke_bomb", name: "Smoke Bomb", category: DEBUFF, props: { cost: 2, effects: [applyStatus(STATUS.BLIND, 1, 2)], duration: 2 } },

  // Guardian
  { id: "shield_bash", name: "Shield Bash", category: ATTACK, props: { cost: 2, uaCharge: 2, damageType: PHYSICAL, value: 6 } },
  { id: "heavy_slam", name: "Heavy Slam", category: ATTACK, props: { cost: 3, damageType: PHYSICAL, value: 9 } },
  {
    id: "shield_rush",
    name: "Shield Rush",
    category: ATTACK,
    props: { cost: 2, damageType: PHYSICAL, value: 4, priority: 2, interrupts: true },
  },
  {
    id: "iron_wall",
    name: "Iron Wall",
    category: DEFEND,
    props: { cost: 1, damageType: PHYSICAL, mode: FLAT, amount: 5, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  {
    id: "brace",
    name: "Brace",
    category: DEFEND,
    props: { cost: 2, damageType: PHYSICAL, mode: PERCENT, amount: 0.3, stacking: STACKING.NONSTACKABLE, duration: 2 },
  },
  {
    id: "barrier_field",
    name: "Barrier Field",
    category: DEFEND,
    props: { cost: 2, damageType: MAGIC, mode: PERCENT, amount: 0.5, stacking: STACKING.STACKABLE, duration: 2 },
  },
  { id: "second_wind", name: "Second Wind", category: BUFF, props: { cost: 1, effects: [energyRegen(FLAT, 2)], duration: 3 } },
  { id: "iron_skin", name: "Iron Skin", category: BUFF, props: { cost: 2, effects: [statModifier("def", FLAT, 4)], duration: 3 } },
  { id: "purify", name: "Purify", category: BUFF, props: { cost: 2, effects: [cleanse(), heal(3)], duration: 1 } },
  { id: "taunt", name: "Taunt", category: DEBUFF, props: { cost: 1, effects: [meterSiphon(5)], duration: 1 } },
  {
    id: "stone_sentinel",
    name: "Stone Sentinel",
    category: MONSTER,
    props: { cost: 4, hp: 12, atk: 2, speed: 1, damageType: PHYSICAL, guard: true },
  },

  // Pyromancer
  { id: "ember_dart", name: "Ember Dart", category: ATTACK, props: { cost: 1, damageType: ELEMENTAL, element: ELEMENT.FIRE, value: 5 } },
  { id: "fire_lance", name: "Fire Lance", category: ATTACK, props: { cost: 3, damageType: ELEMENTAL, element: ELEMENT.FIRE, value: 8 } },
  {
    id: "fireball",
    name: "Fireball",
    category: ATTACK,
    props: { cost: 4, damageType: ELEMENTAL, element: ELEMENT.FIRE, value: 7, applies: [applyStatus(STATUS.BURNING, 2, 2)] },
  },
  {
    id: "flare",
    name: "Flare",
    category: ATTACK,
    props: { cost: 2, damageType: ELEMENTAL, element: ELEMENT.FIRE, value: 3, priority: 2, interrupts: true },
  },
  {
    id: "inferno",
    name: "Inferno",
    category: ATTACK,
    props: { cost: 3, damageType: ELEMENTAL, element: ELEMENT.FIRE, value: 5, target: "field" },
  },
  {
    id: "heat_shroud",
    name: "Heat Shroud",
    category: DEFEND,
    props: { cost: 1, damageType: ELEMENTAL, mode: FLAT, amount: 4, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  { id: "stoke_the_flame", name: "Stoke the Flame", category: BUFF, props: { cost: 1, effects: [energyRegen(FLAT, 3)], duration: 2 } },
  { id: "scorch", name: "Scorch", category: DEBUFF, props: { cost: 2, effects: [statModifier("er", FLAT, -2)], duration: 2 } },
  { id: "ignite", name: "Ignite", category: DEBUFF, props: { cost: 2, effects: [applyStatus(STATUS.BURNING, 3, 3)], duration: 3 } },
  {
    id: "flame_imp",
    name: "Flame Imp",
    category: MONSTER,
    props: { cost: 3, hp: 6, atk: 3, speed: 3, damageType: ELEMENTAL, element: ELEMENT.FIRE, applies: [applyStatus(STATUS.BURNING, 1, 2)] },
  },

  // Black Mage -- trades HP and ultimate meter for AP and cards
  { id: "shadow_bolt", name: "Shadow Bolt", category: ATTACK, props: { cost: 2, damageType: MAGIC, value: 6 } },
  { id: "vampiric_touch", name: "Vampiric Touch", category: ATTACK, props: { cost: 2, damageType: MAGIC, value: 5, lifesteal: 1 } },
  { id: "eldritch_blast", name: "Eldritch Blast", category: ATTACK, props: { cost: 3, hpCost: 3, damageType: MAGIC, value: 10 } },
  {
    id: "hex_ward",
    name: "Hex Ward",
    category: DEFEND,
    props: { cost: 1, damageType: MAGIC, mode: FLAT, amount: 5, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  { id: "dark_pact", name: "Dark Pact", category: BUFF, props: { cost: 0, hpCost: 4, effects: [gainAp(3), draw(1)], duration: 1 } },
  { id: "mana_tap", name: "Mana Tap", category: BUFF, props: { cost: 0, meterCost: 6, effects: [gainAp(4)], duration: 1 } },
  {
    id: "curse_of_weakness",
    name: "Curse of Weakness",
    category: DEBUFF,
    props: { cost: 2, effects: [statModifier("atk", FLAT, -3), statModifier("def", FLAT, -2)], duration: 2 },
  },
  {
    id: "acid_rain",
    name: "Acid Rain",
    category: DEBUFF,
    props: { cost: 3, effects: [applyStatus(STATUS.ACID, 3, 3), applyStatus(STATUS.POISON, 1, 3)], duration: 3 },
  },
  { id: "soul_siphon", name: "Soul Siphon", category: DEBUFF, props: { cost: 1, effects: [meterSiphon(6), gainAp(1)], duration: 1 } },
  {
    id: "nightmare",
    name: "Nightmare",
    category: DEBUFF,
    props: { cost: 2, effects: [applyStatus(STATUS.BLIND, 1, 2), applyStatus(STATUS.SLOWED, 1, 2)], duration: 2 },
  },

  // Master Craftsman -- tools (ATK buffs) and lots of ultimate charge
  { id: "forge_hammer", name: "Forge Hammer", category: ATTACK, props: { cost: 2, uaCharge: 4, damageType: PHYSICAL, value: 5 } },
  {
    id: "rivet_gun",
    name: "Rivet Gun",
    category: ATTACK,
    props: { cost: 1, uaCharge: 3, damageType: PHYSICAL, value: 2, priority: 2, interrupts: true },
  },
  {
    id: "riveted_plate",
    name: "Riveted Plate",
    category: DEFEND,
    props: { cost: 2, uaCharge: 3, damageType: PHYSICAL, mode: FLAT, amount: 6, stacking: STACKING.STACKABLE, duration: 2 },
  },
  {
    id: "spring_trap",
    name: "Spring Trap",
    category: DEFEND,
    props: { cost: 1, uaCharge: 3, damageType: PHYSICAL, mode: PERCENT, amount: 0.5, stacking: STACKING.NONSTACKABLE, duration: 1 },
  },
  { id: "whetstone", name: "Whetstone", category: BUFF, props: { cost: 1, uaCharge: 4, effects: [statModifier("atk", FLAT, 2)], duration: 3 } },
  {
    id: "masterwork_blade",
    name: "Masterwork Blade",
    category: BUFF,
    props: { cost: 3, uaCharge: 5, effects: [statModifier("atk", FLAT, 4)], duration: 3 },
  },
  { id: "tinker", name: "Tinker", category: BUFF, props: { cost: 0, uaCharge: 3, effects: [gainAp(1), draw(1)], duration: 1 } },
  { id: "caltrops", name: "Caltrops", category: DEBUFF, props: { cost: 1, uaCharge: 3, effects: [applyStatus(STATUS.SLOWED, 1, 2)], duration: 2 } },
  {
    id: "clockwork_golem",
    name: "Clockwork Golem",
    category: MONSTER,
    props: { cost: 5, uaCharge: 4, hp: 11, atk: 4, speed: 1, damageType: PHYSICAL },
  },

  // Necromancer -- fills the field fast, wears the enemy down with debuffs
  { id: "bone_spear", name: "Bone Spear", category: ATTACK, props: { cost: 2, damageType: PHYSICAL, value: 5 } },
  { id: "death_coil", name: "Death Coil", category: ATTACK, props: { cost: 2, damageType: MAGIC, value: 4, lifesteal: 0.5 } },
  {
    id: "bone_shield",
    name: "Bone Shield",
    category: DEFEND,
    props: { cost: 2, damageType: PHYSICAL, mode: FLAT, amount: 4, stacking: STACKING.STACKABLE, duration: 2 },
  },
  { id: "dark_ritual", name: "Dark Ritual", category: BUFF, props: { cost: 4, effects: [summon("raise_skeleton", 2)], duration: 1 } },
  { id: "plague_cloud", name: "Plague Cloud", category: DEBUFF, props: { cost: 2, effects: [applyStatus(STATUS.POISON, 2, 3)], duration: 3 } },
  {
    id: "wither",
    name: "Wither",
    category: DEBUFF,
    props: { cost: 2, effects: [statModifier("def", FLAT, -2), applyStatus(STATUS.SLOWED, 1, 2)], duration: 2 },
  },
  { id: "soul_harvest", name: "Soul Harvest", category: DEBUFF, props: { cost: 2, uaCharge: 4, effects: [meterSiphon(6)], duration: 1 } },
  { id: "raise_skeleton", name: "Raise Skeleton", category: MONSTER, props: { cost: 2, hp: 5, atk: 2, speed: 2, damageType: PHYSICAL } },
  {
    id: "shambling_zombie",
    name: "Shambling Zombie",
    category: MONSTER,
    props: { cost: 3, hp: 9, atk: 2, speed: 0, damageType: PHYSICAL, applies: [applyStatus(STATUS.POISON, 1, 2)] },
  },
  { id: "grave_guard", name: "Grave Guard", category: MONSTER, props: { cost: 3, hp: 8, atk: 1, speed: 1, damageType: PHYSICAL, guard: true } },
];

// The general cards, one copy each in every class's starter deck -- that's
// also what puts them in every class's custom-deck card pool (decks.ts).
const GENERAL_DECK = ["quick_jab", "splash", "spark", "healing_potion", "meditate", "smoke_bomb"];

const CLASS_DECKS: Record<string, Record<string, number>> = {
  guardian: {
    shield_bash: 3,
    heavy_slam: 2,
    shield_rush: 2,
    iron_wall: 2,
    brace: 2,
    barrier_field: 1,
    second_wind: 1,
    iron_skin: 1,
    purify: 1,
    taunt: 1,
    stone_sentinel: 2,
  },
  pyromancer: {
    ember_dart: 3,
    fire_lance: 2,
    fireball: 2,
    flare: 1,
    inferno: 1,
    heat_shroud: 2,
    stoke_the_flame: 2,
    scorch: 1,
    ignite: 2,
    flame_imp: 2,
  },
  black_mage: {
    shadow_bolt: 3,
    vampiric_touch: 2,
    eldritch_blast: 1,
    hex_ward: 2,
    dark_pact: 2,
    mana_tap: 1,
    curse_of_weakness: 2,
    acid_rain: 2,
    soul_siphon: 2,
    nightmare: 1,
  },
  craftsman: {
    forge_hammer: 3,
    rivet_gun: 2,
    riveted_plate: 2,
    spring_trap: 2,
    whetstone: 2,
    masterwork_blade: 1,
    tinker: 2,
    caltrops: 2,
    clockwork_golem: 2,
  },
  necromancer: {
    bone_spear: 2,
    death_coil: 2,
    bone_shield: 1,
    dark_ritual: 1,
    plague_cloud: 2,
    wither: 2,
    soul_harvest: 1,
    raise_skeleton: 3,
    shambling_zombie: 2,
    grave_guard: 2,
  },
};

const class_deck_cards: CatalogRows["class_deck_cards"] = Object.entries(CLASS_DECKS).flatMap(([classId, deck]) => [
  ...Object.entries(deck).map(([cardId, copies]) => ({ class_id: classId, card_id: cardId, copies })),
  ...GENERAL_DECK.map((cardId) => ({ class_id: classId, card_id: cardId, copies: 1 })),
]);

export const LOCAL_CATALOG_ROWS: CatalogRows = { synergies, classes, class_synergies, cards, class_deck_cards };
