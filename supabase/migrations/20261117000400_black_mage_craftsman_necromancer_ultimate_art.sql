-- Artwork for the Black Mage (Eclipse), Master Craftsman (Masterpiece) and
-- Necromancer (Army of the Dead) ultimates, served by the site itself from
-- public/cards/<class id>_ultimate.jpg (see *_guardian_ultimate_art.sql for
-- how ultimate art works). With these, every ultimate has artwork. Matches
-- src/model/catalogData.ts. Safe to run more than once.

update public.classes
set ultimate = ultimate || jsonb_build_object('imageUrl', '/cards/black_mage_ultimate.jpg')
where id = 'black_mage';

update public.classes
set ultimate = ultimate || jsonb_build_object('imageUrl', '/cards/craftsman_ultimate.jpg')
where id = 'craftsman';

update public.classes
set ultimate = ultimate || jsonb_build_object('imageUrl', '/cards/necromancer_ultimate.jpg')
where id = 'necromancer';
