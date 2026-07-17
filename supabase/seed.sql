begin;

insert into public.families (id, slug, name, root_person_id) values
  ('10000000-0000-0000-0000-000000000001', 'demo-alpha', 'Selçuk', null),
  ('10000000-0000-0000-0000-000000000002', 'demo-beta', 'Second Demo', null);

insert into public.people (id, legacy_id) values
  ('20000000-0000-0000-0000-000000000001', 'SYN-ALPHA-1'),
  ('20000000-0000-0000-0000-000000000002', 'SYN-BETA-1'),
  ('20000000-0000-0000-0000-000000000003', 'SYN-PARENT-A'),
  ('20000000-0000-0000-0000-000000000004', 'SYN-PARENT-B'),
  ('20000000-0000-0000-0000-000000000005', 'SYN-SHARED');

insert into public.person_revisions (
  id, person_id, status, display_name, given_name, family_name, is_living, privacy
) values
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'approved', 'Alpha Example', 'Alpha', 'Example', false, 'family'),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'approved', 'Beta Example', 'Beta', 'Example', false, 'family'),
  ('21000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000003', 'approved', 'Parent Alpha', 'Parent', 'Alpha', true, 'public'),
  ('21000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000004', 'approved', 'Parent Beta', 'Parent', 'Beta', true, 'public'),
  ('21000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000005', 'approved', 'Shared Child', 'Shared', 'Child', true, 'public');

update public.people p
set current_revision_id = r.id
from public.person_revisions r
where r.person_id = p.id;

insert into public.life_events (id, person_id) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005');
insert into public.life_event_revisions (
  id, life_event_id, status, event_type, date_start, date_end, place_text, certainty
) values (
  '31000000-0000-0000-0000-000000000001',
  '30000000-0000-0000-0000-000000000001',
  'approved', 'birth', '2010-01-01', '2010-01-01', 'Example Town', 1
);
update public.life_events
set current_revision_id = '31000000-0000-0000-0000-000000000001'
where id = '30000000-0000-0000-0000-000000000001';

insert into public.partnerships (id, person1_id, person2_id) values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004'
);
insert into public.partnership_revisions (
  id, partnership_id, status, person1_id, person2_id, partnership_type, date_start, status_text
) values (
  '41000000-0000-0000-0000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'approved',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004',
  'marriage', '2008-01-01', 'Current'
);
update public.partnerships
set current_revision_id = '41000000-0000-0000-0000-000000000001'
where id = '40000000-0000-0000-0000-000000000001';

insert into public.parent_links (id, parent_id, child_id) values
  ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000005'),
  ('50000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005');
insert into public.parent_link_revisions (
  id, parent_link_id, status, parent_id, child_id, relationship_type, certainty
) values
  ('51000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', 'approved', '20000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000005', 'biological', 1),
  ('51000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'approved', '20000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000005', 'biological', 1);
update public.parent_links p
set current_revision_id = r.id
from public.parent_link_revisions r
where r.parent_link_id = p.id;

insert into public.family_memberships (id, family_id, person_id) values
  ('60000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001'),
  ('60000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000003'),
  ('60000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002'),
  ('60000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000004'),
  ('60000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000005'),
  ('60000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000005');
insert into public.family_membership_revisions (
  id, family_membership_id, status, person_id, family_id
) select
  ('61000000-0000-0000-0000-' || lpad(row_number() over (order by id)::text, 12, '0'))::uuid,
  id,
  'approved',
  person_id,
  family_id
from public.family_memberships;
update public.family_memberships m
set current_revision_id = r.id
from public.family_membership_revisions r
where r.family_membership_id = m.id;

update public.families
set root_person_id = case slug
  when 'demo-alpha' then '20000000-0000-0000-0000-000000000003'::uuid
  when 'demo-beta' then '20000000-0000-0000-0000-000000000004'::uuid
end;

commit;
