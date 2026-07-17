begin;
select plan(34);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'admin@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'invitee@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'other@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000004', 'authenticated', 'authenticated', 'email-provider@example.invalid', '', now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000005', 'authenticated', 'authenticated', 'unverified@example.invalid', '', null, '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000006', 'authenticated', 'authenticated', 'bootstrap@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());
insert into public.admins (user_id) values ('a0000000-0000-4000-8000-000000000001');
update public.admin_bootstrap_state set completed_at = now(), admin_user_id = 'a0000000-0000-4000-8000-000000000001';

select ok(not has_table_privilege('anon', 'public.admin_invitations', 'SELECT'), 'anon has no invitation table access');
select ok(not has_table_privilege('authenticated', 'public.admin_invitations', 'SELECT'), 'authenticated has no invitation table access');
select ok(not has_table_privilege('service_role', 'public.admin_invitations', 'SELECT'), 'service role has no invitation table access');
select ok(not has_table_privilege('service_role', 'public.admins', 'INSERT'), 'service role has no direct admin provisioning');
select ok(not has_function_privilege('anon', 'public.accept_admin_invitation()', 'EXECUTE'), 'anon cannot accept');
select ok(not has_function_privilege('service_role', 'public.create_admin_invitation(text,timestamp with time zone)', 'EXECUTE'), 'service role cannot invite');
select ok(has_function_privilege('service_role', 'public.bootstrap_first_google_admin(uuid)', 'EXECUTE'), 'service role has bootstrap only');

set local role anon;
select throws_like($$select public.list_admin_invitations()$$, '%permission denied%', 'anon cannot list');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select throws_like($$select public.create_admin_invitation('denied@example.invalid')$$, '%admin authorization required%', 'nonadmin cannot create');
select throws_like($$select public.list_admin_invitations()$$, '%admin authorization required%', 'nonadmin cannot list');
select throws_like($$select public.revoke_admin_invitation('b0000000-0000-4000-8000-000000000001')$$, '%admin authorization required%', 'nonadmin cannot revoke');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select throws_like($$select public.create_admin_invitation('not-an-email')$$, '%invalid admin invitation%', 'invalid email is rejected');
select throws_like($$select public.create_admin_invitation('future@example.invalid', now() + interval '91 days')$$, '%invalid admin invitation%', 'unsafe expiry is rejected');
select is(public.create_admin_invitation('  Invitee@Example.Invalid  ')->>'email', 'invitee@example.invalid', 'email is normalized');
select is(
  public.create_admin_invitation('INVITEE@example.invalid')->>'id',
  public.create_admin_invitation('invitee@example.invalid')->>'id',
  'repeated creation returns the one effective invite'
);
select is(jsonb_array_length(public.list_admin_invitations()), 1, 'admin lists invitations');
select is(public.list_admin_invitations()#>>'{0,status}', 'pending', 'list reports pending state');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000004","role":"authenticated","email":"invitee@example.invalid","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.accept_admin_invitation()->>'is_admin', 'false', 'trusted email-provider identity cannot spoof Google with JWT claims');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000005","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.accept_admin_invitation()->>'is_admin', 'false', 'unverified Google email is denied');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","email":"invitee@example.invalid","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.accept_admin_invitation()->>'is_admin', 'false', 'JWT email cannot replace verified auth user email');
reset role;

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000002","role":"authenticated","email":"wrong@example.invalid","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.accept_admin_invitation()->>'is_admin', 'true', 'matching verified Google user accepts despite an untrusted JWT email');
select is(public.accept_admin_invitation()->>'is_admin', 'true', 'repeated acceptance is idempotent');
reset role;
select is((select status from public.admin_invitations where email = 'invitee@example.invalid'), 'accepted', 'invite is atomically accepted');
select is((select accepted_by::text from public.admin_invitations where email = 'invitee@example.invalid'), 'a0000000-0000-4000-8000-000000000002', 'accepter is audited');
select ok((select is_active from public.admins where user_id = 'a0000000-0000-4000-8000-000000000002'), 'accepted user is active admin');
select throws_like($$delete from public.admin_invitations where email = 'invitee@example.invalid'$$, '%cannot be deleted%', 'invitations cannot be deleted');
select throws_like($$update public.admin_invitations set email = 'changed@example.invalid' where email = 'invitee@example.invalid'$$, '%audit fields are immutable%', 'invitation identity is immutable');

select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000001","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select public.create_admin_invitation('revoked@example.invalid');
select lives_ok($$select public.revoke_admin_invitation((public.create_admin_invitation('revoked@example.invalid')->>'id')::uuid)$$, 'admin revokes invite');
reset role;
select is((select status from public.admin_invitations where email = 'revoked@example.invalid'), 'revoked', 'revoked state is terminal');
select is((select revoked_by::text from public.admin_invitations where email = 'revoked@example.invalid'), 'a0000000-0000-4000-8000-000000000001', 'revoker is audited');
set local role authenticated;
select is(public.create_admin_invitation('revoked@example.invalid')->>'status', 'pending', 'revoked email can receive one new invite');
reset role;

insert into public.admin_invitations (email, invited_by, created_at, expires_at)
values ('other@example.invalid', 'a0000000-0000-4000-8000-000000000001', now() - interval '2 days', now() - interval '1 day');
select set_config('request.jwt.claims', '{"sub":"a0000000-0000-4000-8000-000000000003","role":"authenticated","app_metadata":{"provider":"google","providers":["google"]}}', true);
set local role authenticated;
select is(public.accept_admin_invitation()->>'is_admin', 'false', 'expired invite is denied generically');
reset role;
select is((select status from public.admin_invitations where email = 'other@example.invalid'), 'expired', 'expired attempt is audited');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select throws_like($$select public.bootstrap_first_google_admin('a0000000-0000-4000-8000-000000000006')$$, '%admin bootstrap already completed%', 'completed bootstrap cannot add a later admin');
reset role;

select * from finish();
rollback;
