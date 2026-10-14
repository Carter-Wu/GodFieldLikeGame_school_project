-- Player accounts' custom decks.
--
--   decks        -- one row per custom deck a player built for a class.
--                   Each player reads/writes only their own rows, straight
--                   from the browser (deck builder). At most 3 per class per
--                   player (trigger below). Every class also has its starter
--                   deck (class_deck_cards), which isn't stored here and
--                   doesn't count toward the 3.
--   match_decks  -- the deck list each player brought into a match, copied
--                   when they create/join it, so editing a deck later
--                   doesn't change a match. No policies: only the `game`
--                   Edge Function can read it (the opponent's deck stays
--                   hidden, like match_secrets).
--
-- `cards` is a deck list, [{ "cardId": "shield_bash", "copies": 4 }, ...].
-- The browser can write anything into it, so the Edge Function re-checks it
-- with validateDeckList() (src/model/decks.ts) before a match uses it.

create table public.decks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  class_id    text not null references public.classes (id) on delete cascade,
  name        text not null check (char_length(btrim(name)) between 1 and 40),
  cards       jsonb not null default '[]'::jsonb check (jsonb_typeof(cards) = 'array'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index decks_user_class_idx on public.decks (user_id, class_id);

create trigger decks_touch before update on public.decks
  for each row execute function public.touch_updated_at();

-- Max 3 custom decks per (player, class). The advisory lock serializes two
-- inserts for the same player+class, so they can't both see "2" and both
-- get in.
create function public.enforce_deck_limit() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.user_id = old.user_id and new.class_id = old.class_id then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text || ':' || new.class_id, 0));
  if (select count(*) from public.decks d
      where d.user_id = new.user_id and d.class_id = new.class_id and d.id <> new.id) >= 3 then
    raise exception 'deck_limit: at most 3 decks per class' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger decks_limit before insert or update on public.decks
  for each row execute function public.enforce_deck_limit();

alter table public.decks enable row level security;

create policy "players can read their own decks"
  on public.decks for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "players can create their own decks"
  on public.decks for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "players can edit their own decks"
  on public.decks for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "players can delete their own decks"
  on public.decks for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.decks from anon, authenticated;
grant select, insert, update, delete on public.decks to authenticated;

create table public.match_decks (
  match_id  uuid not null references public.matches (id) on delete cascade,
  player    uuid not null references auth.users (id) on delete cascade,
  cards     jsonb not null, -- validated deck list; no row = that player uses the starter deck
  primary key (match_id, player)
);

alter table public.match_decks enable row level security;
revoke all on public.match_decks from anon, authenticated;
