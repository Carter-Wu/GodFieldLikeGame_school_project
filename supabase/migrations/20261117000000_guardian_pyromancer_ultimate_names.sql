-- Names for the two placeholder ("TBD") ultimates: Guardian's is
-- Unbreakable Bastion, Pyromancer's is Cataclysm. Only the name and
-- description change; cost, damage and effects stay as they are (the
-- description reads the damage from the row). Matches src/model/catalogData.ts.
-- Safe to run more than once.

update public.classes
set ultimate = ultimate || jsonb_build_object(
  'name', 'Unbreakable Bastion',
  'description', format('The Guardian becomes an unbreakable wall and crashes forward: %s damage.', ultimate ->> 'damage')
)
where id = 'guardian';

update public.classes
set ultimate = ultimate || jsonb_build_object(
  'name', 'Cataclysm',
  'description', format('The sky splits and rains fire: %s damage.', ultimate ->> 'damage')
)
where id = 'pyromancer';
