-- Painted artwork for Iron Wall, served by the site itself from
-- public/cards/ (see *_iron_skin_art.sql for how this works).

update public.cards set image_url = '/cards/iron_wall.jpg' where id = 'iron_wall';
