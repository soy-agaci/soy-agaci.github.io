begin;
select plan(39);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'google-admin@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'email-admin@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'google-user@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', '90000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'inactive-google-admin@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());
insert into public.admins (user_id) values
('90000000-0000-4000-8000-000000000001'), ('90000000-0000-4000-8000-000000000002');
insert into public.admins (user_id, is_active) values ('90000000-0000-4000-8000-000000000004', false);

select ok(not has_function_privilege('anon', 'public.list_pending_admin_submissions(integer,timestamp with time zone,uuid)', 'EXECUTE'), 'anon has no list grant');
select ok(not has_function_privilege('anon', 'public.get_admin_submission(uuid)', 'EXECUTE'), 'anon has no detail grant');
select ok(not has_function_privilege('anon', 'public.approve_family_submission(uuid,text)', 'EXECUTE'), 'anon has no approve grant');
select ok(not has_function_privilege('anon', 'public.reject_family_submission(uuid,text)', 'EXECUTE'), 'anon has no reject grant');
select ok(not has_function_privilege('service_role', 'public.list_pending_admin_submissions(integer,timestamp with time zone,uuid)', 'EXECUTE'), 'service role has no list grant');
select ok(not has_function_privilege('service_role', 'public.get_admin_submission(uuid)', 'EXECUTE'), 'service role has no detail grant');
select ok(not has_function_privilege('service_role', 'public.approve_family_submission(uuid,text)', 'EXECUTE'), 'service role has no approve grant');
select ok(not has_function_privilege('service_role', 'public.reject_family_submission(uuid,text)', 'EXECUTE'), 'service role has no reject grant');
select ok(not has_table_privilege('authenticated', 'public.submissions', 'SELECT'), 'browser cannot read submissions directly');

set local role anon;
select throws_like($$select public.get_admin_profile()$$, '%permission denied%', 'anon profile is rejected');
select throws_like($$select public.list_pending_admin_submissions()$$, '%permission denied%', 'anon list is rejected');
reset role;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000002","role":"authenticated","email":"email-admin@example.invalid","app_metadata":{"provider":"email","providers":["email"]}}', true);
set local role authenticated;
select throws_like($$select public.get_admin_profile()$$, '%Google authentication required%', 'non-Google active admin profile is rejected');
select throws_like($$select public.list_pending_admin_submissions()$$, '%admin authorization required%', 'non-Google active admin list is rejected');
select throws_like($$select public.get_admin_submission('91000000-0000-4000-8000-000000000001')$$, '%admin authorization required%', 'non-Google active admin detail is rejected');
select throws_like($$select public.approve_family_submission('91000000-0000-4000-8000-000000000001')$$, '%admin authorization required%', 'non-Google active admin moderation is rejected');
select throws_like($$select public.reject_family_submission('91000000-0000-4000-8000-000000000001', 'No')$$, '%admin authorization required%', 'non-Google active admin rejection is rejected');
reset role;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000003","role":"authenticated","email":"google-user@example.invalid","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.get_admin_profile()->>'is_admin', 'false', 'Google non-admin receives only inactive profile');
select throws_like($$select public.list_pending_admin_submissions()$$, '%admin authorization required%', 'Google non-admin list is rejected');
select throws_like($$select public.get_admin_submission('91000000-0000-4000-8000-000000000001')$$, '%admin authorization required%', 'Google non-admin detail is rejected');
select throws_like($$select public.approve_family_submission('91000000-0000-4000-8000-000000000001')$$, '%admin authorization required%', 'Google non-admin approval is rejected');
select throws_like($$select public.reject_family_submission('91000000-0000-4000-8000-000000000001', 'No')$$, '%admin authorization required%', 'Google non-admin rejection is rejected');
reset role;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000004","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select throws_like($$select public.list_pending_admin_submissions()$$, '%admin authorization required%', 'inactive Google admin is rejected');
reset role;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["email"]}}', true);
set local role authenticated;
select throws_like($$select public.list_pending_admin_submissions()$$, '%admin authorization required%', 'Google provider without Google providers claim is rejected');
reset role;

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"email","providers":["google"]}}', true);
set local role authenticated;
select throws_like($$select public.list_pending_admin_submissions()$$, '%admin authorization required%', 'Google providers claim without Google provider is rejected');
reset role;

insert into public.submissions (id, family_id, status, created_at, submitter_contact) values
('91000000-0000-4000-8000-000000000002', '10000000-0000-0000-0000-000000000001', 'pending', '2026-07-17 12:00:00+00', 'private-two@example.invalid'),
('91000000-0000-4000-8000-000000000001', '10000000-0000-0000-0000-000000000001', 'pending', '2026-07-17 12:00:00+00', 'private-one@example.invalid'),
('91000000-0000-4000-8000-000000000003', '10000000-0000-0000-0000-000000000001', 'pending', '2026-07-17 12:01:00+00', 'private-three@example.invalid'),
('91000000-0000-4000-8000-000000000004', '10000000-0000-0000-0000-000000000001', 'pending', '2026-07-17 12:02:00+00', null);

insert into public.person_revisions (id, person_id, status, display_name, privacy) values
('92000000-0000-4000-8000-000000000001', '20000000-0000-0000-0000-000000000005', 'approved', 'Current Shared Child', 'public');
update public.people set current_revision_id = '92000000-0000-4000-8000-000000000001'
where id = '20000000-0000-0000-0000-000000000005';
insert into public.person_revisions (id, person_id, submission_id, base_revision_id, status, display_name, privacy) values
('92000000-0000-4000-8000-000000000002', '20000000-0000-0000-0000-000000000005', '91000000-0000-4000-8000-000000000003', '21000000-0000-0000-0000-000000000005', 'pending', 'Proposed Stale Child', 'public');
insert into public.media_revisions (id, person_id, submission_id, status, legacy_uri, mime_type) values
('92000000-0000-4000-8000-000000000003', '20000000-0000-0000-0000-000000000005', '91000000-0000-4000-8000-000000000003', 'pending', 'https://example.invalid/stale.jpg', 'image/jpeg');
insert into public.sources (id, submission_id, title) values
('92000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000003', 'Stale review source'),
('92000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000004', 'Source-only review item');

select set_config('request.jwt.claims', '{"sub":"90000000-0000-4000-8000-000000000001","role":"authenticated","email":"google-admin@example.invalid","app_metadata":{"provider":"google","providers":["google"]},"user_metadata":{"full_name":"Admin"}}', true);
set local role authenticated;
select is(public.get_admin_profile()->>'is_admin', 'true', 'Google active admin is authorized');
select is(public.list_pending_admin_submissions(1)#>>'{items,0,id}', '91000000-0000-4000-8000-000000000001', 'queue ordering is created_at then id');
select is(public.list_pending_admin_submissions(1, '2026-07-17 12:00:00+00', '91000000-0000-4000-8000-000000000001')#>>'{items,0,id}', '91000000-0000-4000-8000-000000000002', 'cursor pagination has no overlap');
select is((select item->>'entity_count' from jsonb_array_elements(public.list_pending_admin_submissions(100)->'items') item where item->>'id' = '91000000-0000-4000-8000-000000000004'), '1', 'source-only queue item counts as one change');
select is(
  (select (item->>'entity_count')::bigint from jsonb_array_elements(public.list_pending_admin_submissions(100)->'items') item where item->>'id' = '91000000-0000-4000-8000-000000000003'),
  (select (jsonb_array_length(detail->'people') + jsonb_array_length(detail->'events') + jsonb_array_length(detail->'partnerships') + jsonb_array_length(detail->'parent_links') + jsonb_array_length(detail->'memberships') + jsonb_array_length(detail->'media') + jsonb_array_length(detail->'sources'))::bigint from (select public.get_admin_submission('91000000-0000-4000-8000-000000000003') detail) x),
  'queue count equals every detail collection counted once'
);
select is(public.get_admin_submission('91000000-0000-4000-8000-000000000001')#>>'{submission,submitter_contact}', 'private-one@example.invalid', 'detail includes private review metadata only for admin');
select is(public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>>'{people,0,base,display_name}', 'Shared Child', 'detail returns proposal base revision');
select is(public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>>'{people,0,current,display_name}', 'Current Shared Child', 'detail returns separately joined current revision');
select is(public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>>'{people,0,proposed,display_name}', 'Proposed Stale Child', 'detail returns proposed revision');
select ok(public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>'{media,0,base}' = 'null'::jsonb and public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>'{media,0,current}' = 'null'::jsonb, 'new media reports unavailable base and current honestly');
select ok(public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>'{sources,0,base}' = 'null'::jsonb and public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>'{sources,0,current}' = 'null'::jsonb and public.get_admin_submission('91000000-0000-4000-8000-000000000003')#>>'{sources,0,proposed,title}' = 'Stale review source', 'source reports unavailable base/current and explicit proposed value');
select throws_like($$select public.reject_family_submission('91000000-0000-4000-8000-000000000001')$$, '%invalid moderation request%', 'reject requires a reason');
select is(public.reject_family_submission('91000000-0000-4000-8000-000000000001', 'Not verifiable')->>'status', 'rejected', 'Google admin rejects atomically');
select is(public.approve_family_submission('91000000-0000-4000-8000-000000000002')->>'status', 'approved', 'Google admin approves atomically');
select throws_like($$select public.approve_family_submission('91000000-0000-4000-8000-000000000002')$$, '%already approved%', 'repeat moderation is rejected');
reset role;

select * from finish();
rollback;
