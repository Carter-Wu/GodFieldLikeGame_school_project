-- Painted artwork for Brace and Taunt, served by the site itself from
-- public/cards/ (see *_iron_skin_art.sql for how this works).

update public.cards set image_url = '/cards/brace.jpg' where id = 'brace';
update public.cards set image_url = '/cards/taunt.jpg' where id = 'taunt';
