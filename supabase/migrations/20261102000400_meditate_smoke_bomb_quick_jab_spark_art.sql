-- Painted artwork for Meditate, Smoke Bomb, Quick Jab and Spark, served by
-- the site itself from public/cards/ (see *_iron_skin_art.sql for how this
-- works).

update public.cards set image_url = '/cards/meditate.jpg' where id = 'meditate';
update public.cards set image_url = '/cards/smoke_bomb.jpg' where id = 'smoke_bomb';
update public.cards set image_url = '/cards/quick_jab.jpg' where id = 'quick_jab';
update public.cards set image_url = '/cards/spark.jpg' where id = 'spark';
