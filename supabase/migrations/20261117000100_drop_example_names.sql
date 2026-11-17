-- Drop the "(example)" tag from the Guardian and Pyromancer classes and
-- their synergies (Bulwark, Kindling), and replace the synergies'
-- "Placeholder synergy" descriptions. Ids, stats and effects stay as they
-- are. Matches src/model/catalogData.ts. Safe to run more than once.

update public.classes set name = 'Guardian' where id = 'guardian';
update public.classes set name = 'Pyromancer' where id = 'pyromancer';

update public.synergies
set name = 'Bulwark',
    description = 'Every shield raised hardens the Guardian: defend cards build up DEF.'
where id = 'bulwark';

update public.synergies
set name = 'Kindling',
    description = 'Every strike stokes the flames: attack cards build ultimate regen.'
where id = 'kindling';
