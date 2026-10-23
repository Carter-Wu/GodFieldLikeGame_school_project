-- Explicit service_role grants on every public table.
--
-- From 2026-10-30 Supabase stops auto-granting Data API access to new tables
-- in "public". Live tables keep their grants, but anything that rebuilds the
-- schema from migrations (`supabase db reset`, a new project, a preview
-- branch) would leave service_role without access. service_role bypasses RLS,
-- not table privileges, so the `game` Edge Function and server/BattleRoom.ts
-- would then fail with "permission denied".
--
-- On the live project this is a no-op. New tables should grant service_role
-- in the migration that creates them, next to their anon/authenticated grants.

grant select, insert, update, delete on
  public.matches, public.match_hands, public.match_secrets, public.match_decks,
  public.decks,
  public.synergies, public.classes, public.class_synergies, public.cards, public.class_deck_cards
to service_role;
