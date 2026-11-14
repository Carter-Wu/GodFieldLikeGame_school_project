-- Deck copy limits by rarity (DECK_RULES.maxCopies in src/model/decks.ts):
-- at most 3 of a normal card, 2 of a rare, 1 of a legend. The starter decks
-- go down to those limits, filled back up with more normal cards where the
-- class has them. Mirrors CLASS_DECKS in src/model/catalogData.ts. Saved
-- custom decks over a limit fail validateDeckList() until they're edited.

update public.class_deck_cards set copies = c.copies
from (values
  ('guardian', 'shield_bash', 2),
  ('guardian', 'heavy_slam', 3),
  ('pyromancer', 'ember_dart', 2),
  ('pyromancer', 'fire_lance', 3),
  ('black_mage', 'vampiric_touch', 1),
  ('black_mage', 'eldritch_blast', 3),
  ('black_mage', 'dark_pact', 1),
  ('black_mage', 'curse_of_weakness', 1),
  ('black_mage', 'acid_rain', 3),
  ('black_mage', 'soul_siphon', 1),
  ('black_mage', 'nightmare', 2),
  ('craftsman', 'forge_hammer', 2),
  ('craftsman', 'rivet_gun', 1),
  ('craftsman', 'riveted_plate', 1),
  ('craftsman', 'whetstone', 1),
  ('craftsman', 'tinker', 1),
  ('craftsman', 'caltrops', 3),
  ('craftsman', 'clockwork_golem', 3)
) as c(class_id, card_id, copies)
where class_deck_cards.class_id = c.class_id and class_deck_cards.card_id = c.card_id;
