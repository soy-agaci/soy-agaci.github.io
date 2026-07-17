begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(36);

create function pg_temp.submit_family_edit(uuid, uuid, jsonb)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
select public.submit_family_edit(
  $1, $2, $3, 'qa-actor-secret-000000000000000000000000000001'
)
$$;

select ok(
  not has_table_privilege('service_role', 'public.people', 'INSERT')
  and not has_table_privilege('service_role', 'public.people', 'UPDATE')
  and not has_table_privilege('service_role', 'public.person_revisions', 'UPDATE')
  and not has_table_privilege('service_role', 'public.submissions', 'INSERT')
  and not has_table_privilege('service_role', 'public.admins', 'INSERT')
  and not has_table_privilege('service_role', 'public.admin_bootstrap_state', 'SELECT')
  and not has_table_privilege('service_role', 'public.admin_bootstrap_state', 'UPDATE')
  and has_function_privilege('service_role', 'public.bootstrap_first_google_admin(uuid)', 'EXECUTE'),
  'service role can only provision the first admin through the bootstrap RPC'
);

set local role service_role;
select throws_like(
  $$insert into public.people (id) values ('8a000000-0000-4000-8000-000000000001')$$,
  '%permission denied for table people%',
  'service role cannot insert stable entities'
);
select throws_like(
  $$update public.people set current_revision_id = null where id = '20000000-0000-0000-0000-000000000003'$$,
  '%permission denied for table people%',
  'service role cannot mutate current pointers'
);
select throws_like(
  $$update public.person_revisions set status = 'rejected' where id = '21000000-0000-0000-0000-000000000003'$$,
  '%permission denied for table person_revisions%',
  'service role cannot transition revisions directly'
);
select throws_like(
  $$insert into public.submissions (id) values ('8a000000-0000-4000-8000-000000000002')$$,
  '%permission denied for table submissions%',
  'service role cannot insert submissions directly'
);
select throws_like(
  $$insert into public.sources (id, submission_id, title) values (
    '8a000000-0000-4000-8000-000000000003',
    '8a000000-0000-4000-8000-000000000002', 'Denied'
  )$$,
  '%permission denied for table sources%',
  'service role cannot insert sources directly'
);
select throws_like(
  $$insert into public.media_revisions (id, person_id, legacy_uri, mime_type) values (
    '8a000000-0000-4000-8000-000000000004',
    '20000000-0000-0000-0000-000000000003',
    'https://example.invalid/denied.jpg', 'image/jpeg'
  )$$,
  '%permission denied for table media_revisions%',
  'service role cannot insert media revisions directly'
);
reset role;

select is(
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = any (array[
    'person_revisions_submission_entity_idx',
    'life_event_revisions_submission_entity_idx',
    'partnership_revisions_submission_entity_idx',
    'parent_link_revisions_submission_entity_idx',
    'family_membership_revisions_submission_entity_idx',
    'media_revisions_submission_reference_idx',
    'sources_submission_reference_idx'
  ])),
  7::bigint,
  'every submitted entity/reference kind has database uniqueness protection'
);

select count(*) as submissions_before_duplicates from public.submissions \gset
set local role anon;
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000001',
    '{"people":[
      {"ref":"8c000000-0000-4000-8000-000000000001","display_name":"Duplicate"},
      {"ref":"8c000000-0000-4000-8000-000000000001","display_name":"Duplicate Again"}
    ]}'::jsonb
  )$$,
  '%duplicate person ref%',
  'duplicate person targets are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000002',
    '{"events":[
      {"ref":"8c000000-0000-4000-8000-000000000002","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"birth"},
      {"ref":"8c000000-0000-4000-8000-000000000002","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"death"}
    ]}'::jsonb
  )$$,
  '%duplicate life event target%',
  'duplicate event targets are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000003',
    '{"partnerships":[
      {"ref":"8c000000-0000-4000-8000-000000000003","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"20000000-0000-0000-0000-000000000005","partnership_type":"marriage"},
      {"ref":"8c000000-0000-4000-8000-000000000004","person1_ref":"20000000-0000-0000-0000-000000000005","person2_ref":"20000000-0000-0000-0000-000000000003","partnership_type":"other"}
    ]}'::jsonb
  )$$,
  '%duplicate partnership target%',
  'duplicate partnership endpoints are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000004',
    '{"parent_links":[
      {"ref":"8c000000-0000-4000-8000-000000000005","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"20000000-0000-0000-0000-000000000005","relationship_type":"biological"},
      {"ref":"8c000000-0000-4000-8000-000000000006","parent_ref":"20000000-0000-0000-0000-000000000003","child_ref":"20000000-0000-0000-0000-000000000005","relationship_type":"adoptive"}
    ]}'::jsonb
  )$$,
  '%invalid or duplicate parent set%',
  'duplicate parent-link endpoints are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000018',
    '{"memberships":[
      {"ref":"8c000000-0000-4000-8000-000000000018","person_ref":"20000000-0000-0000-0000-000000000004"},
      {"ref":"8c000000-0000-4000-8000-000000000019","person_ref":"20000000-0000-0000-0000-000000000004"}
    ]}'::jsonb
  )$$,
  '%duplicate membership target%',
  'duplicate membership targets are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000005',
    '{"people":[{"ref":"8c000000-0000-4000-8000-000000000007","display_name":"Source Target"}],
      "sources":[{"title":"Same","url":"https://example.invalid/source"},{"title":"Same","url":"https://example.invalid/source"}]}'::jsonb
  )$$,
  '%duplicate source%',
  'duplicate sources are rejected'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000006',
    '{"people":[{"ref":"8c000000-0000-4000-8000-000000000008","display_name":"Media Target"}],
      "media":[
        {"person_ref":"8c000000-0000-4000-8000-000000000008","url":"https://example.invalid/same.jpg","mime_type":"image/jpeg"},
        {"person_ref":"8c000000-0000-4000-8000-000000000008","url":"https://example.invalid/same.jpg","mime_type":"image/jpeg"}
      ]}'::jsonb
  )$$,
  '%duplicate media reference%',
  'duplicate media references are rejected'
);
reset role;
select is(
  (select count(*) from public.submissions),
  :submissions_before_duplicates::bigint,
  'all duplicate-target failures roll back atomically'
);

select count(*) as submissions_before_mixed_source from public.submissions \gset
select count(*) as sources_before_mixed_source from public.sources \gset
select count(*) as people_before_mixed_source from public.people \gset
set local role anon;
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000019',
    '{"people":[
      {"ref":"8c000000-0000-4000-8000-000000000020","display_name":"Mixed Public","privacy":"public"},
      {"ref":"8c000000-0000-4000-8000-000000000021","display_name":"MIXED PRIVATE SOURCE SENTINEL","privacy":"private"}
    ],"sources":[{"title":"MIXED SOURCE SENTINEL","url":"https://example.invalid/mixed"}]}'::jsonb
  )$$,
  '%sources require an entirely public edit bundle%',
  'mixed public/private source bundle is rejected before pending state'
);
reset role;
select ok(
  (select count(*) from public.submissions) = :submissions_before_mixed_source::bigint
  and (select count(*) from public.sources) = :sources_before_mixed_source::bigint
  and (select count(*) from public.people) = :people_before_mixed_source::bigint,
  'mixed source rejection leaves no submission, source, or canonical approval target'
);

set local role anon;
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000007',
    '{"events":[{"ref":"8d000000-0000-4000-8000-000000000001","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"birth","date_text":"circa 1900","date_start":"1900-01-01"}]}'::jsonb
  )$$,
  '%invalid life event edit%',
  'circa text cannot carry invented exact precision'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000008',
    '{"events":[{"ref":"8d000000-0000-4000-8000-000000000002","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"birth","date_text":"1900","date_start":"1900-01-01"}]}'::jsonb
  )$$,
  '%invalid life event edit%',
  'year-only text cannot carry invented exact precision'
);
select throws_like(
  $$select pg_temp.submit_family_edit(
    '10000000-0000-0000-0000-000000000001',
    '8b000000-0000-4000-8000-000000000009',
    '{"partnerships":[{"ref":"8d000000-0000-4000-8000-000000000003","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"20000000-0000-0000-0000-000000000005","partnership_type":"marriage","date_text":"1900s","date_start":"1900-01-01","date_end":"1909-12-31"}]}'::jsonb
  )$$,
  '%invalid partnership edit%',
  'imprecise range text cannot carry invented range endpoints'
);
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000010',
  '{"events":[{"ref":"8d000000-0000-4000-8000-000000000004","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"birth","date_text":"1900-01-02","date_start":"1900-01-02"}]}'::jsonb
) as exact_point \gset
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000011',
  '{"events":[{"ref":"8d000000-0000-4000-8000-000000000005","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"residence","date_text":"1900-01-01/1900-12-31","date_start":"1900-01-01","date_end":"1900-12-31"}]}'::jsonb
) as exact_range \gset
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000012',
  '{"events":[{"ref":"8d000000-0000-4000-8000-000000000006","person_ref":"20000000-0000-0000-0000-000000000003","event_type":"birth","date_text":"circa 1900"}]}'::jsonb
) as imprecise_text \gset
reset role;
select is(:'exact_point'::jsonb->>'status', 'pending', 'canonical exact point date is accepted');
select is(:'exact_range'::jsonb->>'status', 'pending', 'canonical exact range date is accepted');
select is(:'imprecise_text'::jsonb->>'status', 'pending', 'imprecise text without exact fields is accepted');
select ok(
  exists (
    select 1 from public.submissions
    where id = (:'exact_point'::jsonb->>'submission_id')::uuid
      and octet_length(idempotency_actor_digest) = 32
      and octet_length(request_hash) = 32
      and position('qa-actor-secret' in row_to_json(submissions)::text) = 0
  ),
  'only SHA-256 actor/request digests are stored'
);
select throws_like(
  format(
    'update public.life_event_revisions set status = %L, reviewed_at = now() where submission_id = %L::uuid',
    'approved', :'exact_point'::jsonb->>'submission_id'
  ),
  '%moderation requires an authenticated active admin reviewer%',
  'revision trigger rejects moderation without active auth reviewer context'
);

insert into public.people (id) values ('8e000000-0000-4000-8000-000000000001');
insert into public.person_revisions (
  id, person_id, status, display_name, privacy
) values (
  '8e100000-0000-4000-8000-000000000001',
  '8e000000-0000-4000-8000-000000000001',
  'approved', 'QA Public Third', 'public'
);
update public.people set current_revision_id = '8e100000-0000-4000-8000-000000000001'
where id = '8e000000-0000-4000-8000-000000000001';
insert into public.family_memberships (
  id, family_id, person_id
) values (
  '8e200000-0000-4000-8000-000000000001',
  '10000000-0000-0000-0000-000000000001',
  '8e000000-0000-4000-8000-000000000001'
);
insert into public.family_membership_revisions (
  id, family_membership_id, status, family_id, person_id
) values (
  '8e300000-0000-4000-8000-000000000001',
  '8e200000-0000-4000-8000-000000000001',
  'approved',
  '10000000-0000-0000-0000-000000000001',
  '8e000000-0000-4000-8000-000000000001'
);
update public.family_memberships
set current_revision_id = '8e300000-0000-4000-8000-000000000001'
where id = '8e200000-0000-4000-8000-000000000001';

set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000020',
  '{"partnerships":[{"ref":"8f000000-0000-4000-8000-000000000001","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"8e000000-0000-4000-8000-000000000001","partnership_type":"marriage"}],
    "parent_links":[{"ref":"8f000000-0000-4000-8000-000000000002","parent_ref":"20000000-0000-0000-0000-000000000005","child_ref":"8e000000-0000-4000-8000-000000000001","relationship_type":"biological"}]}'::jsonb
) as relationship_first \gset
reset role;
select is(:'relationship_first'::jsonb->>'status', 'pending', 'first relationship proposal is pending');

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  '8f100000-0000-4000-8000-000000000001',
  'authenticated', 'authenticated', 'qa-admin@example.invalid', '',
  now(), '{}', '{}', now(), now()
);
insert into public.admins (user_id) values ('8f100000-0000-4000-8000-000000000001');
select set_config('request.jwt.claims', '{"sub":"8f100000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.reject_family_submission(
  (:'relationship_first'::jsonb->>'submission_id')::uuid, 'Relationship cannot be verified'
) as relationship_rejected \gset
reset role;
select is(:'relationship_rejected'::jsonb->>'status', 'rejected', 'relationship proposal rejects atomically');
select ok(
  not exists (
    select 1 from public.partnerships where person1_id in (
      '20000000-0000-0000-0000-000000000003', '8e000000-0000-4000-8000-000000000001'
    ) and person2_id in (
      '20000000-0000-0000-0000-000000000003', '8e000000-0000-4000-8000-000000000001'
    ) and current_revision_id is not null
  )
  and not exists (
    select 1 from public.parent_links
    where parent_id = '20000000-0000-0000-0000-000000000005'
      and child_id = '8e000000-0000-4000-8000-000000000001'
      and current_revision_id is not null
  ),
  'rejected relationship stable rows remain reusable and non-current'
);

select partnership_id::text as qa_partnership_id
from public.partnership_revisions
where submission_id = (:'relationship_first'::jsonb->>'submission_id')::uuid \gset
select parent_link_id::text as qa_parent_link_id
from public.parent_link_revisions
where submission_id = (:'relationship_first'::jsonb->>'submission_id')::uuid \gset

select set_config('request.jwt.claims', '{}', true);
set local role anon;
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000021',
  '{"partnerships":[{"ref":"8f000000-0000-4000-8000-000000000011","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"8e000000-0000-4000-8000-000000000001","partnership_type":"marriage"}],
    "parent_links":[{"ref":"8f000000-0000-4000-8000-000000000012","parent_ref":"20000000-0000-0000-0000-000000000005","child_ref":"8e000000-0000-4000-8000-000000000001","relationship_type":"biological"}]}'::jsonb
) as relationship_second \gset
select pg_temp.submit_family_edit(
  '10000000-0000-0000-0000-000000000001',
  '8b000000-0000-4000-8000-000000000022',
  '{"partnerships":[{"ref":"8f000000-0000-4000-8000-000000000021","person1_ref":"20000000-0000-0000-0000-000000000003","person2_ref":"8e000000-0000-4000-8000-000000000001","partnership_type":"other"}],
    "parent_links":[{"ref":"8f000000-0000-4000-8000-000000000022","parent_ref":"20000000-0000-0000-0000-000000000005","child_ref":"8e000000-0000-4000-8000-000000000001","relationship_type":"adoptive"}]}'::jsonb
) as relationship_competing \gset
reset role;
select ok(
  (select partnership_id::text from public.partnership_revisions
   where submission_id = (:'relationship_second'::jsonb->>'submission_id')::uuid) = :'qa_partnership_id'
  and (select parent_link_id::text from public.parent_link_revisions
   where submission_id = (:'relationship_second'::jsonb->>'submission_id')::uuid) = :'qa_parent_link_id',
  'resubmission reuses rejected partnership and parent-link stable rows'
);
select ok(
  (select partnership_id::text from public.partnership_revisions
   where submission_id = (:'relationship_competing'::jsonb->>'submission_id')::uuid) = :'qa_partnership_id'
  and (select parent_link_id::text from public.parent_link_revisions
   where submission_id = (:'relationship_competing'::jsonb->>'submission_id')::uuid) = :'qa_parent_link_id',
  'competing proposals share the same unresolved stable endpoints'
);

select set_config('request.jwt.claims', '{"sub":"8f100000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.approve_family_submission(
  (:'relationship_second'::jsonb->>'submission_id')::uuid
) as relationship_approved \gset
select public.approve_family_submission(
  (:'relationship_competing'::jsonb->>'submission_id')::uuid
) as relationship_conflict \gset
reset role;
select is(:'relationship_approved'::jsonb->>'status', 'approved', 'resubmitted relationship approves');
select is(:'relationship_conflict'::jsonb->>'status', 'conflict', 'competing relationship conflicts after winner approval');
select ok(
  (select current_revision_id from public.partnerships where id = :'qa_partnership_id'::uuid)
    = (select id from public.partnership_revisions
       where submission_id = (:'relationship_second'::jsonb->>'submission_id')::uuid)
  and (select current_revision_id from public.parent_links where id = :'qa_parent_link_id'::uuid)
    = (select id from public.parent_link_revisions
       where submission_id = (:'relationship_second'::jsonb->>'submission_id')::uuid),
  'winner revisions are the deterministic current pointers'
);
select ok(
  not exists (
    select 1 from (
      select reviewed_by, reviewed_at from public.partnership_revisions
      where submission_id in (
        (:'relationship_second'::jsonb->>'submission_id')::uuid,
        (:'relationship_competing'::jsonb->>'submission_id')::uuid
      )
      union all
      select reviewed_by, reviewed_at from public.parent_link_revisions
      where submission_id in (
        (:'relationship_second'::jsonb->>'submission_id')::uuid,
        (:'relationship_competing'::jsonb->>'submission_id')::uuid
      )
    ) audited where reviewed_by is null or reviewed_at is null
  ),
  'approved and conflicted relationship revisions retain reviewer audit fields'
);
select ok(
  not has_function_privilege('service_role', 'public.approve_family_submission(uuid, text)', 'EXECUTE'),
  'service role cannot invoke moderation RPC without authenticated admin context'
);

select * from finish();
rollback;
