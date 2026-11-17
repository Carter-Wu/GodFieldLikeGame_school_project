-- Artwork for the Guardian's ultimate (Unbreakable Bastion), served by the
-- site itself from public/cards/guardian_ultimate.jpg. An ultimate's
-- `imageUrl` works like a card's image_url (a full URL or a site path);
-- without one the gold ultimate card shows the ultimate icon. Matches
-- src/model/catalogData.ts. Safe to run more than once.

update public.classes
set ultimate = ultimate || jsonb_build_object('imageUrl', '/cards/guardian_ultimate.jpg')
where id = 'guardian';
