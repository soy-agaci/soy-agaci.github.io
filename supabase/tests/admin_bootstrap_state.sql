begin;
select plan(15);

insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'first@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now()),
('00000000-0000-0000-0000-000000000000', 'b0000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'second@example.invalid', '', now(), '{"provider":"google","providers":["google"]}', '{}', now(), now());

select is((select count(*) from public.admin_bootstrap_state), 1::bigint, 'bootstrap marker is a singleton');
select ok((select completed_at is null and admin_user_id is null from public.admin_bootstrap_state), 'fresh marker starts incomplete');
select ok(not has_table_privilege('anon', 'public.admin_bootstrap_state', 'SELECT'), 'anon cannot read bootstrap marker');
select ok(not has_table_privilege('authenticated', 'public.admin_bootstrap_state', 'SELECT'), 'authenticated cannot read bootstrap marker');
select ok(not has_table_privilege('service_role', 'public.admin_bootstrap_state', 'SELECT'), 'service role cannot read bootstrap marker');
select ok(not has_table_privilege('service_role', 'public.admin_bootstrap_state', 'UPDATE'), 'service role cannot write bootstrap marker');

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(public.bootstrap_first_google_admin('b0000000-0000-4000-8000-000000000001')->>'is_admin', 'true', 'first bootstrap succeeds');
select throws_like($$select public.bootstrap_first_google_admin('b0000000-0000-4000-8000-000000000002')$$, '%admin bootstrap already completed%', 'second bootstrap is permanently denied');
reset role;

select is((select admin_user_id::text from public.admin_bootstrap_state), 'b0000000-0000-4000-8000-000000000001', 'marker records first admin');
select ok((select completed_at is not null from public.admin_bootstrap_state), 'marker records completion time');
update public.admins set is_active = false where user_id = 'b0000000-0000-4000-8000-000000000001';

set local role service_role;
select throws_like($$select public.bootstrap_first_google_admin('b0000000-0000-4000-8000-000000000001')$$, '%admin bootstrap already completed%', 'inactive sole admin cannot be bootstrapped again');
reset role;
select is((select is_active from public.admins where user_id = 'b0000000-0000-4000-8000-000000000001'), false, 'bootstrap does not reactivate inactive admin');
select throws_like($$delete from public.admin_bootstrap_state$$, '%cannot be deleted%', 'bootstrap marker cannot be deleted');
select throws_like($$update public.admin_bootstrap_state set completed_at = now()$$, '%immutable%', 'completed marker cannot be changed');
select is((select count(*) from public.admins), 1::bigint, 'failed bootstrap creates no additional admin');

select * from finish();
rollback;
