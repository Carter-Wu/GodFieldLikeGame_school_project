-- Base ATK for every class. ATK is a flat bonus added to each attack card's
-- damage (src/model/engine.ts); until now every class had 0, so the stat only
-- ever came from buffs. Mirrors base_stats in src/model/catalogData.ts.

update public.classes set base_stats = base_stats || '{"atk":1}'::jsonb where id = 'guardian';
update public.classes set base_stats = base_stats || '{"atk":2}'::jsonb where id = 'pyromancer';
update public.classes set base_stats = base_stats || '{"atk":2}'::jsonb where id = 'black_mage';
update public.classes set base_stats = base_stats || '{"atk":3}'::jsonb where id = 'craftsman';
update public.classes set base_stats = base_stats || '{"atk":1}'::jsonb where id = 'necromancer';
