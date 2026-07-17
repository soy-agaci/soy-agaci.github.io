begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(42);

create function pg_temp.submit_family_edit(uuid, uuid, jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
select public.submit_family_edit(
  $1, $2, $3, 'synthetic-actor-secret-000000000000000000000001'
)
$$;

select ok(
  has_function_privilege('anon', 'public.submit_family_edit(uuid, uuid, jsonb, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.submit_family_edit(uuid, uuid, jsonb, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.approve_family_submission(uuid, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.approve_family_submission(uuid, text)', 'EXECUTE'),
  'submit is public and moderation is authenticated-only'
);
select ok(
  not has_table_privilege('anon', 'public.submissions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.person_revisions', 'INSERT')
  and not has_table_privilege('authenticated', 'public.admins', 'SELECT'),
  'API roles have no direct table or admin access'
);

select jsonb_array_length(public.get_family_graph(
  array['10000000-0000-0000-0000-000000000001']::uuid[]
)->'people') as approved_people_before \gset

set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  $bundle$
  {
    "message":"Add synthetic spouse and child",
    "people":[
      {"ref":"a0000000-0000-4000-8000-000000000001","display_name":"Synthetic Spouse","given_name":"Synthetic","family_name":"Spouse","privacy":"public"},
      {"ref":"a0000000-0000-4000-8000-000000000002","display_name":"Synthetic Child","given_name":"Synthetic","family_name":"Child","privacy":"public"}
    ],
    "events":[
      {"ref":"e0000000-0000-4000-8000-000000000001","person_ref":"a0000000-0000-4000-8000-000000000002","event_type":"birth","date_text":"circa 2012","place_text":"Example Place"},
      {"ref":"e0000000-0000-4000-8000-000000000002","person_ref":"a0000000-0000-4000-8000-000000000001","event_type":"occupation","details":"Synthetic occupation"}
    ],
    "partnerships":[
      {"ref":"b0000000-0000-4000-8000-000000000001","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"a0000000-0000-4000-8000-000000000001","partnership_type":"marriage","date_text":"Spring 2010","status_text":"current"}
    ],
    "parent_links":[
      {"ref":"c0000000-0000-4000-8000-000000000001","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"a0000000-0000-4000-8000-000000000002","relationship_type":"biological"},
      {"ref":"c0000000-0000-4000-8000-000000000002","parent_ref":"a0000000-0000-4000-8000-000000000001","child_ref":"a0000000-0000-4000-8000-000000000002","relationship_type":"biological"}
    ],
    "memberships":[
      {"ref":"a1000000-0000-4000-8000-000000000001","person_ref":"a0000000-0000-4000-8000-000000000001"}
    ],
    "sources":[{"title":"Synthetic source","url":"https://example.invalid/source","citation":"Synthetic citation"}],
    "media":[{"person_ref":"a0000000-0000-4000-8000-000000000002","url":"https://example.invalid/child.jpg","mime_type":"image/jpeg","caption":"Synthetic"}]
  }$bundle$::jsonb
) as spouse_result \gset
reset role;

select is(:'spouse_result'::jsonb->>'status', 'pending', 'anonymous spouse/child bundle is pending');
select is(
  jsonb_array_length(public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])->'people'),
  :approved_people_before::integer,
  'approved-only graph is unchanged before approval'
);
select ok(
  position('Synthetic Spouse' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0
  and position('Synthetic Child' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0,
  'include_pending exposes new public people'
);
select ok(
  jsonb_array_length(public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)->'partnerships') = 1
  and jsonb_array_length(public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)->'parent_links') = 3,
  'include_pending exposes spouse and two-parent child links'
);
select is(
  public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)#>>'{submissions,0,status}',
  'pending',
  'include_pending exposes safe submission status'
);
select ok(
  position('submitter_contact' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0
  and position('circa 2012' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0,
  'pending graph retains date_text without internal submission fields'
);
select ok(
  jsonb_array_length(public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])->'sources') = 0
  and public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)#>>'{sources,0,title}' = 'Synthetic source'
  and public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)#>>'{sources,0,submission_status}' = 'pending',
  'sources are keyed by id and pending sources require include_pending'
);
select ok(
  position('submitter_contact' in (public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)->'sources')::text) = 0,
  'source graph omits restricted submission metadata'
);
select is(
  (select count(*) from public.family_membership_revisions
   where submission_id = (:'spouse_result'::jsonb->>'submission_id')::uuid),
  2::bigint,
  'explicit new-person membership replaces only that implicit membership'
);

set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000001',
  $bundle$
  {
    "message":"Add synthetic spouse and child",
    "people":[
      {"ref":"a0000000-0000-4000-8000-000000000001","display_name":"Synthetic Spouse","given_name":"Synthetic","family_name":"Spouse","privacy":"public"},
      {"ref":"a0000000-0000-4000-8000-000000000002","display_name":"Synthetic Child","given_name":"Synthetic","family_name":"Child","privacy":"public"}
    ],
    "events":[
      {"ref":"e0000000-0000-4000-8000-000000000001","person_ref":"a0000000-0000-4000-8000-000000000002","event_type":"birth","date_text":"circa 2012","place_text":"Example Place"},
      {"ref":"e0000000-0000-4000-8000-000000000002","person_ref":"a0000000-0000-4000-8000-000000000001","event_type":"occupation","details":"Synthetic occupation"}
    ],
    "partnerships":[
      {"ref":"b0000000-0000-4000-8000-000000000001","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"a0000000-0000-4000-8000-000000000001","partnership_type":"marriage","date_text":"Spring 2010","status_text":"current"}
    ],
    "parent_links":[
      {"ref":"c0000000-0000-4000-8000-000000000001","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"a0000000-0000-4000-8000-000000000002","relationship_type":"biological"},
      {"ref":"c0000000-0000-4000-8000-000000000002","parent_ref":"a0000000-0000-4000-8000-000000000001","child_ref":"a0000000-0000-4000-8000-000000000002","relationship_type":"biological"}
    ],
    "memberships":[
      {"ref":"a1000000-0000-4000-8000-000000000001","person_ref":"a0000000-0000-4000-8000-000000000001"}
    ],
    "sources":[{"title":"Synthetic source","url":"https://example.invalid/source","citation":"Synthetic citation"}],
    "media":[{"person_ref":"a0000000-0000-4000-8000-000000000002","url":"https://example.invalid/child.jpg","mime_type":"image/jpeg","caption":"Synthetic"}]
  }$bundle$::jsonb
) as idempotent_result \gset
reset role;
select is(
  :'idempotent_result'::jsonb->>'submission_id',
  :'spouse_result'::jsonb->>'submission_id',
  'same anonymous family/request/payload is idempotent'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    'd0000000-0000-4000-8000-000000000001',
    '{"people":[{"ref":"a0000000-0000-4000-8000-000000000009","display_name":"Different"}]}'::jsonb
  )$$,
  '%different request%',
  'idempotency key rejects a different payload'
);

select count(*) as submissions_before_invalid from public.submissions \gset
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    'd0000000-0000-4000-8000-000000000002',
    '{"parent_links":[{"ref":"c0000000-0000-4000-8000-000000000009","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"20000000-0000-0000-0000-000000000003","relationship_type":"biological"}]}'::jsonb
  )$$,
  '%invalid parent link edit%',
  'self-parent bundle is rejected'
);
select is((select count(*) from public.submissions), :submissions_before_invalid::bigint, 'invalid bundle rolls back without a submission');
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    'd0000000-0000-4000-8000-000000000003',
    '{"people":[{"ref":"a0000000-0000-4000-8000-000000000003","display_name":"Unsafe"}],"media":[{"person_ref":"a0000000-0000-4000-8000-000000000003","url":"javascript:alert(1)","mime_type":"image/jpeg"}]}'::jsonb
  )$$,
  '%invalid media reference%',
  'unsafe media URL is rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    'd0000000-0000-4000-8000-000000000008',
    '{"people":[{"ref":"a0000000-0000-4000-8000-000000000008","display_name":"Too Many Parents"},{"ref":"a0000000-0000-4000-8000-000000000009","display_name":"Third Parent"}],"parent_links":[
      {"ref":"c0000000-0000-4000-8000-000000000081","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"a0000000-0000-4000-8000-000000000008","relationship_type":"biological"},
      {"ref":"c0000000-0000-4000-8000-000000000082","parent_ref":"20000000-0000-0000-0000-000000000005","child_ref":"a0000000-0000-4000-8000-000000000008","relationship_type":"biological"},
      {"ref":"c0000000-0000-4000-8000-000000000083","parent_ref":"a0000000-0000-4000-8000-000000000009","child_ref":"a0000000-0000-4000-8000-000000000008","relationship_type":"biological"}
    ]}'::jsonb
  )$$,
  '%invalid or duplicate parent set%',
  'bundle cannot assign more than two parents'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    'd0000000-0000-4000-8000-000000000009',
    '{"parent_links":[{"ref":"c0000000-0000-4000-8000-000000000009","parent_ref":"20000000-0000-0000-0000-000000000005","child_ref":"20000000-0000-0000-0000-000000000003","relationship_type":"biological"}]}'::jsonb
  )$$,
  '%parent links would create a cycle%',
  'bundle cannot create an ancestry cycle'
);

set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000004',
  '{"people":[{"ref":"a0000000-0000-4000-8000-000000000004","display_name":"One Parent Child","privacy":"public"}],"parent_links":[{"ref":"c0000000-0000-4000-8000-000000000004","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"a0000000-0000-4000-8000-000000000004","relationship_type":"biological"}],"sources":[{"title":"Rejected source","url":"https://example.invalid/rejected"}]}'::jsonb
) as one_parent_result \gset
reset role;
select ok(
  position('One Parent Child' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0
  and position('One Parent Child' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) = 0,
  'one-parent child is pending-only'
);

set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000014',
  '{"memberships":[{"ref":"a1000000-0000-4000-8000-000000000014","person_ref":"20000000-0000-0000-0000-000000000004"}],"sources":[{"title":"Rejected membership source","url":"https://example.invalid/membership-rejected"}]}'::jsonb
) as membership_reject_result \gset
reset role;
select ok(
  position('Parent Beta' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) = 0
  and position('Parent Beta' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0
  and position('Rejected membership source' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) > 0,
  'explicit existing global-person membership is pending-only'
);
select family_membership_id as rejected_membership_id
from public.family_membership_revisions
where submission_id = (:'membership_reject_result'::jsonb->>'submission_id')::uuid \gset

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.invalid', '', now(), '{}', '{}', now(), now()),
  ('00000000-0000-0000-0000-000000000000', 'f0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'nonadmin@example.invalid', '', now(), '{}', '{}', now(), now());
insert into public.admins (user_id) values ('f0000000-0000-4000-8000-000000000001');

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000002","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select throws_like(
  format('select public.approve_family_submission(%L::uuid)', :'spouse_result'::jsonb->>'submission_id'),
  '%admin authorization required%',
  'authenticated non-admin cannot moderate'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.approve_family_submission(
  (:'spouse_result'::jsonb->>'submission_id')::uuid, 'Synthetic approval'
) as approved_result \gset
reset role;
select is(:'approved_result'::jsonb->>'status', 'approved', 'active admin approves the whole submission');
select ok(
  position('Synthetic Spouse' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) > 0
  and position('Synthetic Child' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) > 0,
  'approval makes new people canonical'
);
select ok(
  public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])#>>'{sources,0,title}' = 'Synthetic source'
  and public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])#>>'{sources,0,submission_status}' = 'approved',
  'approved source is visible without include_pending'
);
select ok(
  exists (
    select 1 from public.submissions where id = (:'spouse_result'::jsonb->>'submission_id')::uuid
      and reviewed_at is not null and reviewed_by = 'f0000000-0000-4000-8000-000000000001'
  )
  and not exists (
    select 1 from public.person_revisions where submission_id = (:'spouse_result'::jsonb->>'submission_id')::uuid
      and status <> 'approved'
  ),
  'approval records audit and transitions all person revisions'
);

set local role authenticated;
select public.reject_family_submission(
  (:'one_parent_result'::jsonb->>'submission_id')::uuid, 'Synthetic rejection'
) as rejected_result \gset
reset role;
select is(:'rejected_result'::jsonb->>'status', 'rejected', 'active admin rejects the whole submission');
select ok(
  position('One Parent Child' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0,
  'rejected addition never enters either graph'
);
select ok(
  position('Rejected source' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0,
  'rejected source is absent from the pending graph'
);

set local role authenticated;
select public.reject_family_submission(
  (:'membership_reject_result'::jsonb->>'submission_id')::uuid, 'Reject membership'
) as membership_rejected \gset
reset role;
select ok(
  position('Rejected membership source' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0
  and (select current_revision_id is null from public.family_memberships where id = :'rejected_membership_id'::uuid),
  'rejected membership and source remain noncanonical'
);

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000015',
  '{"memberships":[{"ref":"a1000000-0000-4000-8000-000000000015","person_ref":"20000000-0000-0000-0000-000000000004"}],"sources":[{"title":"Approved membership source","url":"https://example.invalid/membership-approved"}]}'::jsonb
) as membership_approve_result \gset
reset role;
select is(
  (select family_membership_id::text from public.family_membership_revisions
   where submission_id = (:'membership_approve_result'::jsonb->>'submission_id')::uuid),
  :'rejected_membership_id',
  'membership resubmission reuses the rejected current-null stable row'
);
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.approve_family_submission(
  (:'membership_approve_result'::jsonb->>'submission_id')::uuid, 'Approve membership'
) as membership_approved \gset
reset role;
select ok(
  position('Parent Beta' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) > 0
  and position('Approved membership source' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) > 0,
  'approved membership and source become canonical'
);

select current_revision_id as membership_base_id
from public.family_memberships where id = :'rejected_membership_id'::uuid \gset
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000016',
  format('{"memberships":[{"ref":"%s","membership_id":"%s","base_revision_id":"%s","person_ref":"20000000-0000-0000-0000-000000000004"}]}',
    :'rejected_membership_id', :'rejected_membership_id', :'membership_base_id')::jsonb
) as membership_update_first \gset
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000017',
  format('{"memberships":[{"ref":"%s","membership_id":"%s","base_revision_id":"%s","person_ref":"20000000-0000-0000-0000-000000000004"}]}',
    :'rejected_membership_id', :'rejected_membership_id', :'membership_base_id')::jsonb
) as membership_update_stale \gset
reset role;
select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.approve_family_submission((:'membership_update_first'::jsonb->>'submission_id')::uuid) as membership_update_approved \gset
select public.approve_family_submission((:'membership_update_stale'::jsonb->>'submission_id')::uuid) as membership_update_conflict \gset
reset role;
select is(:'membership_update_approved'::jsonb->>'status', 'approved', 'membership revision update approves');
select is(:'membership_update_conflict'::jsonb->>'status', 'conflict', 'stale membership revision conflicts');
select throws_like(
  format('select public.approve_family_submission(%L::uuid)', :'spouse_result'::jsonb->>'submission_id'),
  '%already approved%',
  'repeat moderation has deterministic error'
);

reset role;
select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000002',
  'd0000000-0000-4000-8000-000000000005',
  '{"people":[{"ref":"20000000-0000-0000-0000-000000000005","person_id":"20000000-0000-0000-0000-000000000005","base_revision_id":"21000000-0000-0000-0000-000000000005","display_name":"Shared Child First","privacy":"public"}]}'::jsonb
) as overlap_first \gset
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000006',
  '{"people":[{"ref":"20000000-0000-0000-0000-000000000005","person_id":"20000000-0000-0000-0000-000000000005","base_revision_id":"21000000-0000-0000-0000-000000000005","display_name":"Shared Child Competing","privacy":"public"}]}'::jsonb
) as overlap_second \gset
reset role;
select pass('overlapping family accepts competing pending edits');

select set_config('request.jwt.claims', '{"sub":"f0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.approve_family_submission((:'overlap_first'::jsonb->>'submission_id')::uuid) as overlap_approved \gset
select public.approve_family_submission((:'overlap_second'::jsonb->>'submission_id')::uuid) as overlap_conflict \gset
reset role;
select is(:'overlap_approved'::jsonb->>'status', 'approved', 'first competing update approves');
select is(:'overlap_conflict'::jsonb->>'status', 'conflict', 'stale competing update conflicts atomically');
select ok(
  position('Shared Child First' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) > 0
  and position('Shared Child Competing' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[])::text) = 0,
  'stale conflict cannot overwrite canonical revision'
);

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  'd0000000-0000-4000-8000-000000000007',
  '{"people":[{"ref":"a0000000-0000-4000-8000-000000000007","display_name":"PRIVATE SENTINEL","privacy":"private"}]}'::jsonb
) as private_result \gset
reset role;
select ok(
  position('PRIVATE SENTINEL' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0
  and position(:'private_result'::jsonb->>'submission_id' in public.get_family_graph(array['10000000-0000-0000-0000-000000000001']::uuid[], true)::text) = 0,
  'private pending metadata and submission ID do not leak'
);

select throws_like(
  format('update public.submissions set message = %L where id = %L::uuid', 'mutated', :'spouse_result'::jsonb->>'submission_id'),
  '%submission payload is immutable%',
  'submission payload is immutable'
);
select throws_like(
  format('delete from public.sources where submission_id = %L::uuid', :'spouse_result'::jsonb->>'submission_id'),
  '%sources are immutable%',
  'sources cannot be deleted'
);
select ok(
  not has_function_privilege('service_role', 'public.moderate_family_submission(uuid, text, text)', 'EXECUTE')
  and not has_function_privilege('service_role', 'public.approve_family_submission(uuid, text)', 'EXECUTE'),
  'service role cannot bypass audited moderation RPCs'
);

select * from finish();
rollback;
