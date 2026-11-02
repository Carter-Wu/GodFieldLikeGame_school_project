-- Painted artwork for Shield Bash and Heavy Slam, served by the site itself
-- from public/cards/ (see *_iron_skin_art.sql for how this works).

update public.cards set image_url = '/cards/shield_bash.jpg' where id = 'shield_bash';
update public.cards set image_url = '/cards/heavy_slam.jpg' where id = 'heavy_slam';
