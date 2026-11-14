-- Card rarity (normal / rare / legend), stored in each card's props as
-- "rarity", by value per AP: every effect is scored in damage-equivalent
-- points and divided by what the card costs, relative to a plain 1-AP,
-- 3-damage attack (see RARITY in src/model/cardTypes.ts). Below 1.4 is
-- normal, 1.4 to 2.0 rare, 2.0 and up legend. Mirrors RARITY_BY_CARD in
-- src/model/catalogData.ts.

update public.cards set props = coalesce(props, '{}'::jsonb) || '{"rarity":"normal"}'::jsonb;

update public.cards set props = props || '{"rarity":"rare"}'::jsonb
where id in (
  'ignite', 'spring_trap', 'ember_dart', 'barrier_field', 'bone_shield',
  'iron_wall', 'hex_ward', 'forge_hammer', 'shield_bash', 'shield_rush'
);

update public.cards set props = props || '{"rarity":"legend"}'::jsonb
where id in (
  'tinker', 'meditate', 'mana_tap', 'dark_pact', 'whetstone', 'riveted_plate',
  'iron_skin', 'rivet_gun', 'soul_siphon', 'masterwork_blade', 'vampiric_touch',
  'curse_of_weakness'
);
