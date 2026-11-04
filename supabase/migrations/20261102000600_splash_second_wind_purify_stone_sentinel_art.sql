-- Painted artwork for Splash, Second Wind, Purify and Stone Sentinel,
-- served by the site itself from public/cards/ (see *_iron_skin_art.sql for
-- how this works).

update public.cards set image_url = '/cards/splash.jpg' where id = 'splash';
update public.cards set image_url = '/cards/second_wind.jpg' where id = 'second_wind';
update public.cards set image_url = '/cards/purify.jpg' where id = 'purify';
update public.cards set image_url = '/cards/stone_sentinel.jpg' where id = 'stone_sentinel';
