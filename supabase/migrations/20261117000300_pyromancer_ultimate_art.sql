-- Artwork for the Pyromancer's ultimate (Cataclysm), served by the site
-- itself from public/cards/pyromancer_ultimate.jpg (see
-- *_guardian_ultimate_art.sql for how ultimate art works). Matches
-- src/model/catalogData.ts. Safe to run more than once.

update public.classes
set ultimate = ultimate || jsonb_build_object('imageUrl', '/cards/pyromancer_ultimate.jpg')
where id = 'pyromancer';
