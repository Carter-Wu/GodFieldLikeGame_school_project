-- Deck rarity budget (DECK_RULES in src/model/decks.ts): every copy of a
-- rare card costs 1 point, of a legend 2, and a deck may hold at most 12
-- points. Starter decks follow the same rule, so the Black Mage and Master
-- Craftsman starter decks drop their strongest legends -- but those cards
-- stay in the class's card pool for custom decks: a class_deck_cards row with
-- 0 copies now means "in the pool, not in the starter deck". Mirrors
-- CLASS_DECKS in src/model/catalogData.ts.

alter table public.class_deck_cards drop constraint if exists class_deck_cards_copies_check;
alter table public.class_deck_cards add constraint class_deck_cards_copies_check check (copies >= 0);

update public.class_deck_cards set copies = 0
where (class_id, card_id) in (
  ('black_mage', 'mana_tap'),
  ('craftsman', 'masterwork_blade'),
  ('craftsman', 'tinker')
);
