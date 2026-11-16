-- Class balance pass: base stats tuned with scripts/balance-sim.ts
-- (`npm run balance`), CPU-vs-CPU matches between every pair of classes on
-- their starter decks, until each class wins about half its games. Mirrors
-- base_stats in src/model/catalogData.ts.

update public.classes set base_stats = '{"hp":44,"def":6,"mr":2,"er":2,"ur":6,"crit":0,"atk":1}'::jsonb where id = 'guardian';
update public.classes set base_stats = '{"hp":38,"def":0,"mr":2,"er":4,"ur":6,"crit":0,"atk":2}'::jsonb where id = 'pyromancer';
update public.classes set base_stats = '{"hp":38,"def":1,"mr":5,"er":2,"ur":6,"crit":0,"atk":2}'::jsonb where id = 'black_mage';
update public.classes set base_stats = '{"hp":36,"def":4,"mr":2,"er":0,"ur":5,"crit":0,"atk":3}'::jsonb where id = 'craftsman';
update public.classes set base_stats = '{"hp":45,"def":2,"mr":5,"er":3,"ur":7,"crit":0,"atk":3}'::jsonb where id = 'necromancer';
