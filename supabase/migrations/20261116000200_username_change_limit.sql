-- Display name changes are limited to 3 per rolling 30 days.
--
-- The display name stays where everything already reads it (the `username`
-- in the user's auth metadata: src/online/authApi.ts, server/BattleRoom.ts,
-- player_display_name()). What changes is how it's written:
--
--   - public.change_username(new_name) is the only way to change it. It
--     checks the limit, logs the change in public.username_changes and then
--     updates the metadata.
--   - A trigger on auth.users quietly keeps the old name when anything else
--     tries to change it (e.g. supabase.auth.updateUser({ data: { username } })
--     from the browser), so the limit can't be skipped.
--
-- Picking the name at sign-up isn't a change and isn't counted.
-- USERNAME_CHANGES_PER_WINDOW / USERNAME_CHANGE_WINDOW_DAYS in
-- src/online/profileApi.ts must match the numbers below.
--
-- Safe to run more than once (e.g. pasted into the SQL Editor and later
-- applied again by `supabase db push`): every statement checks or replaces
-- what's already there, and the change log is kept.

create table if not exists public.username_changes (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  old_name text,
  new_name text not null,
  changed_at timestamptz not null default now()
);

create index if not exists username_changes_user_time on public.username_changes (user_id, changed_at desc);

alter table public.username_changes enable row level security;

drop policy if exists "username changes: read own" on public.username_changes;
create policy "username changes: read own" on public.username_changes
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Players can read their own log; only change_username() writes to it.
revoke all on public.username_changes from anon, authenticated;
grant select on public.username_changes to authenticated;
grant select, insert, update, delete on public.username_changes to service_role;

-- How many changes the logged-in player has left in the current window, and
-- when the oldest counted change drops out of it (null if they have changes
-- left).
create or replace function public.username_change_status()
  returns table (changes_left int, next_change_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with recent as (
    select c.changed_at
    from public.username_changes c
    where c.user_id = (select auth.uid())
      and c.changed_at > now() - interval '30 days'
  )
  select
    greatest(0, 3 - (select count(*) from recent))::int,
    case when (select count(*) from recent) >= 3
      then (select min(r.changed_at) from (select changed_at from recent order by changed_at desc limit 3) r) + interval '30 days'
    end;
$$;

create or replace function public.change_username(new_name text)
  returns table (changes_left int, next_change_at timestamptz)
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  name text := btrim(coalesce(new_name, ''));
  current_name text;
  used int;
  next_at timestamptz;
begin
  if uid is null then
    raise exception 'Log in to change your display name.';
  end if;
  if char_length(name) < 2 then
    raise exception 'Pick a name of at least 2 characters.';
  end if;
  if char_length(name) > 20 then
    raise exception 'Keep the name to 20 characters or fewer.';
  end if;

  -- One change at a time per player, so two quick requests can't both pass
  -- the limit check.
  perform pg_advisory_xact_lock(hashtext('change_username:' || uid::text));

  select u.raw_user_meta_data ->> 'username' into current_name from auth.users u where u.id = uid;
  if current_name is not distinct from name then
    raise exception 'That''s already your display name.';
  end if;

  select count(*), min(r.changed_at) + interval '30 days'
    into used, next_at
  from (
    select c.changed_at
    from public.username_changes c
    where c.user_id = uid and c.changed_at > now() - interval '30 days'
    order by c.changed_at desc
    limit 3
  ) r;
  if used >= 3 then
    raise exception 'You''ve used all 3 display name changes for the last 30 days. You can change it again on %.',
      to_char(next_at at time zone 'UTC', 'FMMonth FMDD, YYYY "at" HH24:MI "UTC"');
  end if;

  insert into public.username_changes (user_id, old_name, new_name) values (uid, current_name, name);

  -- Tells the guard trigger below that this update is allowed.
  perform set_config('app.username_change', 'on', true);
  update auth.users
    set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', name)
    where id = uid;
  perform set_config('app.username_change', 'off', true);

  return query select * from public.username_change_status();
end;
$$;

revoke all on function public.change_username(text) from public, anon;
revoke all on function public.username_change_status() from public, anon;
grant execute on function public.change_username(text) to authenticated;
grant execute on function public.username_change_status() to authenticated;

-- Guard: keep the old username on any update that didn't come through
-- change_username(). Other metadata (avatar_url, tutorial_seen) still
-- updates normally.
create or replace function public.guard_username_change() returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if (new.raw_user_meta_data ->> 'username') is distinct from (old.raw_user_meta_data ->> 'username')
     and coalesce(current_setting('app.username_change', true), 'off') <> 'on' then
    if old.raw_user_meta_data ? 'username' then
      new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb)
        || jsonb_build_object('username', old.raw_user_meta_data -> 'username');
    else
      new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) - 'username';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_username_change on auth.users;
create trigger guard_username_change before update of raw_user_meta_data on auth.users
  for each row execute function public.guard_username_change();
