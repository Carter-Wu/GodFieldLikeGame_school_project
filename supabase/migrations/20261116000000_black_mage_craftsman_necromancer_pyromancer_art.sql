-- Painted artwork for the Black Mage, Master Craftsman, Necromancer and
-- Pyromancer cards, served by the site itself from public/cards/ (see
-- *_iron_skin_art.sql for how this works). With these, every card has
-- painted art.

-- Black Mage
update public.cards set image_url = '/cards/acid_rain.jpg' where id = 'acid_rain';
update public.cards set image_url = '/cards/curse_of_weakness.jpg' where id = 'curse_of_weakness';
update public.cards set image_url = '/cards/dark_pact.jpg' where id = 'dark_pact';
update public.cards set image_url = '/cards/eldritch_blast.jpg' where id = 'eldritch_blast';
update public.cards set image_url = '/cards/hex_ward.jpg' where id = 'hex_ward';
update public.cards set image_url = '/cards/mana_tap.jpg' where id = 'mana_tap';
update public.cards set image_url = '/cards/nightmare.jpg' where id = 'nightmare';
update public.cards set image_url = '/cards/shadow_bolt.jpg' where id = 'shadow_bolt';
update public.cards set image_url = '/cards/soul_siphon.jpg' where id = 'soul_siphon';
update public.cards set image_url = '/cards/vampiric_touch.jpg' where id = 'vampiric_touch';

-- Master Craftsman
update public.cards set image_url = '/cards/caltrops.jpg' where id = 'caltrops';
update public.cards set image_url = '/cards/clockwork_golem.jpg' where id = 'clockwork_golem';
update public.cards set image_url = '/cards/forge_hammer.jpg' where id = 'forge_hammer';
update public.cards set image_url = '/cards/masterwork_blade.jpg' where id = 'masterwork_blade';
update public.cards set image_url = '/cards/rivet_gun.jpg' where id = 'rivet_gun';
update public.cards set image_url = '/cards/riveted_plate.jpg' where id = 'riveted_plate';
update public.cards set image_url = '/cards/spring_trap.jpg' where id = 'spring_trap';
update public.cards set image_url = '/cards/tinker.jpg' where id = 'tinker';
update public.cards set image_url = '/cards/whetstone.jpg' where id = 'whetstone';

-- Necromancer
update public.cards set image_url = '/cards/dark_ritual.jpg' where id = 'dark_ritual';
update public.cards set image_url = '/cards/raise_skeleton.jpg' where id = 'raise_skeleton';
update public.cards set image_url = '/cards/bone_shield.jpg' where id = 'bone_shield';
update public.cards set image_url = '/cards/bone_spear.jpg' where id = 'bone_spear';
update public.cards set image_url = '/cards/death_coil.jpg' where id = 'death_coil';
update public.cards set image_url = '/cards/grave_guard.jpg' where id = 'grave_guard';
update public.cards set image_url = '/cards/plague_cloud.jpg' where id = 'plague_cloud';
update public.cards set image_url = '/cards/shambling_zombie.jpg' where id = 'shambling_zombie';
update public.cards set image_url = '/cards/soul_harvest.jpg' where id = 'soul_harvest';
update public.cards set image_url = '/cards/wither.jpg' where id = 'wither';

-- Pyromancer
update public.cards set image_url = '/cards/ember_dart.jpg' where id = 'ember_dart';
update public.cards set image_url = '/cards/fire_lance.jpg' where id = 'fire_lance';
update public.cards set image_url = '/cards/fireball.jpg' where id = 'fireball';
update public.cards set image_url = '/cards/flame_imp.jpg' where id = 'flame_imp';
update public.cards set image_url = '/cards/flare.jpg' where id = 'flare';
update public.cards set image_url = '/cards/heat_shroud.jpg' where id = 'heat_shroud';
update public.cards set image_url = '/cards/ignite.jpg' where id = 'ignite';
update public.cards set image_url = '/cards/inferno.jpg' where id = 'inferno';
update public.cards set image_url = '/cards/scorch.jpg' where id = 'scorch';
update public.cards set image_url = '/cards/stoke_the_flame.jpg' where id = 'stoke_the_flame';
