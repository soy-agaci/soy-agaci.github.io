begin;
select plan(3);

select set_eq(
  $$select slug from public.list_public_families()$$,
  $$values ('demo-alpha'::text), ('demo-beta'::text)$$,
  'lists only families with approved public members'
);

insert into public.families (id, slug, name) values
  ('10000000-0000-0000-0000-000000000099', 'restricted-only', 'Restricted Only');
insert into public.family_memberships (id, family_id, person_id, current_revision_id)
values (
  '60000000-0000-0000-0000-000000000099',
  '10000000-0000-0000-0000-000000000099',
  '20000000-0000-0000-0000-000000000001',
  null
);
insert into public.family_membership_revisions (
  id, family_membership_id, status, person_id, family_id
) values (
  '61000000-0000-0000-0000-000000000099',
  '60000000-0000-0000-0000-000000000099',
  'approved',
  '20000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000099'
);
update public.family_memberships
set current_revision_id = '61000000-0000-0000-0000-000000000099'
where id = '60000000-0000-0000-0000-000000000099';

select is(
  (select count(*) from public.list_public_families() where slug = 'restricted-only'),
  0::bigint,
  'does not reveal a family whose approved member is restricted'
);

select ok(
  has_function_privilege('anon', 'public.list_public_families()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.list_public_families()', 'EXECUTE'),
  'public roles can discover safe families'
);

select * from finish();
rollback;
