begin;
select plan(10);

select ok((select relrowsecurity from pg_class where oid = 'public.family_creation_proposals'::regclass),
  'proposal table has RLS enabled');
select ok(not has_table_privilege('anon', 'public.family_creation_proposals', 'SELECT'),
  'anon cannot read proposals directly');
select ok(not has_table_privilege('authenticated', 'public.family_creation_proposals', 'INSERT'),
  'authenticated users cannot inject proposals');
select ok(not has_table_privilege('service_role', 'public.family_creation_proposals', 'INSERT'),
  'service role cannot bypass the proposal RPC');
select ok(has_function_privilege('anon', 'public.submit_family_creation(uuid,uuid,uuid,text,text,text)', 'EXECUTE'),
  'anon may submit family creation');
select ok(has_function_privilege('authenticated', 'public.list_family_creation_proposals(uuid[])', 'EXECUTE'),
  'authenticated users may query safe pending proposals');
select ok(not has_function_privilege('anon', 'public.moderate_family_submission(uuid,text,text)', 'EXECUTE'),
  'anon cannot invoke moderation directly');

set local role anon;
select is(
  public.submit_family_creation(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '90000000-0000-4000-8000-000000000001',
    'SQL Proposed Family', 'sql-proposed-family', repeat('a', 32)
  )->>'status', 'pending', 'public RPC creates only a pending submission'
);
select is(
  jsonb_array_length(public.list_family_creation_proposals(
    array['10000000-0000-0000-0000-000000000001'::uuid]
  )), 1, 'pending proposal is safely queryable for its visible source family'
);
select throws_like($$
  select public.submit_family_creation(
    '10000000-0000-0000-0000-000000000001',
    '20000000-0000-0000-0000-000000000003',
    '90000000-0000-4000-8000-000000000001',
    'Changed Payload', 'changed-payload', repeat('a', 32)
  )
$$, '%different request%', 'same idempotency key rejects a changed payload');
reset role;

select * from finish();
rollback;
