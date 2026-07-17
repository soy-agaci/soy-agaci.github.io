begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(18);

insert into public.submissions (
  id, message, submitter_name, submitter_contact, created_at
) values
  ('70000000-0000-0000-0000-000000000001', 'person change', 'Secret One', 'one@example.invalid', '2026-01-01'),
  ('70000000-0000-0000-0000-000000000002', 'membership change', 'Secret Two', 'two@example.invalid', '2026-01-02'),
  ('70000000-0000-0000-0000-000000000003', 'media change', 'Secret Three', 'three@example.invalid', '2026-01-03'),
  ('70000000-0000-0000-0000-000000000004', 'unrelated', 'Secret Four', 'four@example.invalid', '2026-01-04'),
  ('70000000-0000-0000-0000-000000000005', 'private change', 'Secret Five', 'five@example.invalid', '2026-01-05');

insert into public.families (id, slug, name, created_at) values
  ('71000000-0000-0000-0000-000000000001', 'graph-read', 'Graph Read', '2026-01-01'),
  ('71000000-0000-0000-0000-000000000002', 'outside-graph', 'Outside Graph', '2026-01-02'),
  ('71000000-0000-0000-0000-000000000003', 'restricted-only', 'Restricted Only', '2026-01-03');

insert into public.people (id, created_at) values
  ('72000000-0000-0000-0000-000000000001', '2026-01-01'),
  ('72000000-0000-0000-0000-000000000002', '2042-02-02 02:02:02+00'),
  ('72000000-0000-0000-0000-000000000003', '2026-01-03'),
  ('72000000-0000-0000-0000-000000000004', '2026-01-04'),
  ('72000000-0000-0000-0000-000000000005', '2026-01-05');

insert into public.person_revisions (
  id, person_id, submission_id, status, created_at, display_name, privacy
) values
  ('72100000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', null, 'approved', '2026-01-01', 'Public Current', 'public'),
  ('72100000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000002', null, 'approved', '2042-02-02 02:02:02+00', 'Family Current', 'family'),
  ('72100000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000001', 'pending', '2026-01-03', 'Pending Public', 'public'),
  ('72100000-0000-0000-0000-000000000004', '72000000-0000-0000-0000-000000000004', null, 'approved', '2026-01-04', 'Outside', 'public'),
  ('72100000-0000-0000-0000-000000000005', '72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000005', 'pending', '2026-01-05', 'Hidden Pending', 'private'),
  ('72100000-0000-0000-0000-000000000006', '72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000001', 'pending', '2026-01-04', 'Visible Pending', 'public'),
  ('72100000-0000-0000-0000-000000000007', '72000000-0000-0000-0000-000000000005', null, 'approved', '2026-01-05', 'Restricted Only Person', 'family');

update public.people p set current_revision_id = r.id
from public.person_revisions r
where r.person_id = p.id and r.status = 'approved';

insert into public.family_memberships (id, family_id, person_id, created_at) values
  ('73000000-0000-0000-0000-000000000001', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '2026-01-01'),
  ('73000000-0000-0000-0000-000000000002', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', '2042-02-02 02:02:02+00'),
  ('73000000-0000-0000-0000-000000000003', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000003', '2026-01-03'),
  ('73000000-0000-0000-0000-000000000004', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000004', '2026-01-04'),
  ('73000000-0000-0000-0000-000000000005', '71000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000005', '2026-01-05');

insert into public.family_membership_revisions (
  id, family_membership_id, submission_id, status, created_at, family_id, person_id
) values
  ('73100000-0000-0000-0000-000000000001', '73000000-0000-0000-0000-000000000001', null, 'approved', '2026-01-01', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001'),
  ('73100000-0000-0000-0000-000000000002', '73000000-0000-0000-0000-000000000002', null, 'approved', '2042-02-02 02:02:02+00', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002'),
  ('73100000-0000-0000-0000-000000000003', '73000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-000000000002', 'pending', '2026-01-03', '71000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000003'),
  ('73100000-0000-0000-0000-000000000004', '73000000-0000-0000-0000-000000000004', null, 'approved', '2026-01-04', '71000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000004'),
  ('73100000-0000-0000-0000-000000000005', '73000000-0000-0000-0000-000000000005', null, 'approved', '2026-01-05', '71000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000005');

update public.family_memberships m set current_revision_id = r.id
from public.family_membership_revisions r
where r.family_membership_id = m.id and r.status = 'approved';

update public.families
set root_person_id = '72000000-0000-0000-0000-000000000005'
where id = '71000000-0000-0000-0000-000000000003';

insert into public.partnerships (id, person1_id, person2_id, created_at) values
  ('74000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', '2042-02-02 02:02:02+00'),
  ('74000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000004', '2026-01-02');
insert into public.partnership_revisions (
  id, partnership_id, status, created_at, person1_id, person2_id, partnership_type
) values
  ('74100000-0000-0000-0000-000000000001', '74000000-0000-0000-0000-000000000001', 'approved', '2042-02-02 02:02:02+00', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000002', 'marriage'),
  ('74100000-0000-0000-0000-000000000002', '74000000-0000-0000-0000-000000000002', 'approved', '2026-01-02', '72000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000004', 'other');
update public.partnerships p set current_revision_id = r.id
from public.partnership_revisions r where r.partnership_id = p.id;

insert into public.parent_links (id, parent_id, child_id, created_at) values (
  '75000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000003', '2026-01-01'
);
insert into public.parent_link_revisions (
  id, parent_link_id, submission_id, status, created_at,
  parent_id, child_id, relationship_type
) values (
  '75100000-0000-0000-0000-000000000001',
  '75000000-0000-0000-0000-000000000001',
  '70000000-0000-0000-0000-000000000002', 'pending', '2026-01-01',
  '72000000-0000-0000-0000-000000000001',
  '72000000-0000-0000-0000-000000000003', 'biological'
);

insert into public.life_events (id, person_id, created_at) values
  ('76000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', '2026-01-01'),
  ('76000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000002', '2042-02-02 02:02:02+00');

insert into public.life_event_revisions (
  id, life_event_id, status, created_at, event_type, date_start
) values
  ('76100000-0000-0000-0000-000000000001', '76000000-0000-0000-0000-000000000001', 'approved', '2026-01-01', 'birth', '2000-01-01'),
  ('76100000-0000-0000-0000-000000000002', '76000000-0000-0000-0000-000000000002', 'approved', '2042-02-02 02:02:02+00', 'birth', '2001-01-01');
update public.life_events e set current_revision_id = r.id
from public.life_event_revisions r where r.life_event_id = e.id;

insert into public.media_revisions (
  id, person_id, submission_id, status, created_at, storage_path, mime_type
) values
  ('77000000-0000-0000-0000-000000000001', '72000000-0000-0000-0000-000000000001', null, 'approved', '2026-01-01', 'public/current.jpg', 'image/jpeg'),
  ('77000000-0000-0000-0000-000000000002', '72000000-0000-0000-0000-000000000001', '70000000-0000-0000-0000-000000000003', 'pending', '2026-01-02', 'public/pending.jpg', 'image/jpeg'),
  ('77000000-0000-0000-0000-000000000003', '72000000-0000-0000-0000-000000000002', null, 'approved', '2042-02-02 02:02:02+00', 'hidden/current.jpg', 'image/jpeg');

select is(
  public.get_family_graph(null),
  '{"families":[],"people":[],"life_events":[],"partnerships":[],"parent_links":[],"memberships":[],"media":[],"sources":[],"submissions":[]}'::jsonb,
  'null family IDs return the empty graph'
);
select is(
  public.get_family_graph('{}'::uuid[]),
  public.get_family_graph(null),
  'empty family IDs return the empty graph'
);

select is(
  jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[])->'people'),
  1,
  'only approved memberships with public current people are visible by default'
);
select ok(
  position('72000000-0000-0000-0000-000000000002' in public.get_family_graph(
    array['71000000-0000-0000-0000-000000000001']::uuid[], true
  )::text) = 0
  and position('2042-02-02' in public.get_family_graph(
    array['71000000-0000-0000-0000-000000000001']::uuid[], true
  )::text) = 0,
  'family/private people leave no IDs, timestamps, memberships, media, events, or relationships'
);
select ok(
  not jsonb_path_exists(
    public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[]),
    '$.**.pending_revisions[*]'
  )
  and jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[])->'parent_links') = 0
  and jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[])->'submissions') = 0,
  'pending false returns no pending-only entities, revisions, or submissions'
);

select is(
  (select array_agg(person->>'id')
   from jsonb_array_elements(public.get_family_graph(
     array['71000000-0000-0000-0000-000000000001']::uuid[], true
   )->'people') person),
  array[
    '72000000-0000-0000-0000-000000000001',
    '72000000-0000-0000-0000-000000000003'
  ],
  'public pending revisions make pending membership people visible in stable ID order'
);
select ok(
  not exists (
    select 1
    from jsonb_array_elements(public.get_family_graph(
      array['71000000-0000-0000-0000-000000000001']::uuid[], true
    )->'people') person
    left join lateral jsonb_array_elements(person->'pending_revisions') pending on true
    where (person->'current_revision' <> 'null'::jsonb
      and person#>>'{current_revision,privacy}' <> 'public')
      or (pending is not null and pending->>'privacy' <> 'public')
  ),
  'only public person revisions are returned'
);
select is(
  jsonb_array_length(public.get_family_graph(
    array['71000000-0000-0000-0000-000000000001']::uuid[], true
  )->'partnerships'),
  0,
  'relationships require both visible endpoints'
);
select is(
  jsonb_array_length(public.get_family_graph(
    array['71000000-0000-0000-0000-000000000001']::uuid[], true
  )->'parent_links'),
  1,
  'pending-only relationships are representable'
);
select ok(
  jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[], true)->'life_events') = 1
  and jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[], true)->'media') = 2,
  'life events and media are scoped to selected people'
);
select ok(
  (select array_agg(submission->>'id')
   from jsonb_array_elements(public.get_family_graph(
     array['71000000-0000-0000-0000-000000000001']::uuid[], true
   )->'submissions') submission) = array[
     '70000000-0000-0000-0000-000000000001',
     '70000000-0000-0000-0000-000000000002',
     '70000000-0000-0000-0000-000000000003'
   ]
  and position('70000000-0000-0000-0000-000000000005' in public.get_family_graph(
    array['71000000-0000-0000-0000-000000000001']::uuid[], true
  )::text) = 0
  and not exists (
    select 1
    from jsonb_array_elements(public.get_family_graph(
      array['71000000-0000-0000-0000-000000000001']::uuid[], true
    )->'submissions') submission
    where submission ?| array[
      'message', 'submitter_name', 'submitter_contact', 'submitter_user_id',
      'review_note', 'reviewed_by'
    ]
  ),
  'only visible pending submissions and safe moderation metadata are returned'
);
select ok(
  has_function_privilege('anon', 'public.get_family_graph(uuid[], boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_family_graph(uuid[], boolean)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_family_graph(uuid[], boolean)', 'EXECUTE'),
  'only API roles can execute the graph RPC'
);
select ok(
  has_function_privilege('anon', 'public.get_family_graph_by_slugs(text[], boolean)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_family_graph_by_slugs(text[], boolean)', 'EXECUTE')
  and not has_function_privilege('public', 'public.get_family_graph_by_slugs(text[], boolean)', 'EXECUTE'),
  'only API roles can execute the slug graph RPC'
);
select is(
  public.get_family_graph_by_slugs(array['graph-read'])#>>'{families,0,slug}',
  'graph-read',
  'family slugs resolve through the secure graph RPC'
);
set local role anon;
select ok(
  position('restricted-only' in public.get_family_graph_by_slugs(array['restricted-only'])::text) = 0
  and position('71000000-0000-0000-0000-000000000003' in public.get_family_graph_by_slugs(array['restricted-only'])::text) = 0
  and position('72000000-0000-0000-0000-000000000005' in public.get_family_graph_by_slugs(array['restricted-only'])::text) = 0,
  'restricted-only slugs return no family metadata, root, or stable IDs'
);
select is(
  public.get_family_graph_by_slugs(array['restricted-only']),
  public.get_family_graph_by_slugs(array['unknown-family']),
  'restricted-only and unknown slugs are indistinguishable'
);
select ok(
  not has_table_privilege('anon', 'public.people', 'SELECT')
  and not has_table_privilege('authenticated', 'public.people', 'SELECT'),
  'the RPC grants no direct table reads'
);

select is(
  jsonb_array_length(public.get_family_graph(array['71000000-0000-0000-0000-000000000001']::uuid[])->'families'),
  1,
  'anon can read the graph through the security-definer RPC'
);

select * from finish();
rollback;
