-- Painted artwork for Healing Potion and Shield Rush, served by the site
-- itself from public/cards/ (see *_iron_skin_art.sql for how this works).

update public.cards set image_url = '/cards/healing_potion.jpg' where id = 'healing_potion';
update public.cards set image_url = '/cards/shield_rush.jpg' where id = 'shield_rush';
