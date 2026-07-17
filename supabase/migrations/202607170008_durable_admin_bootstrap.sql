create table public.admin_bootstrap_state (
  singleton boolean primary key default true check (singleton),
  completed_at timestamptz,
  admin_user_id uuid references auth.users (id) on delete restrict,
  constraint admin_bootstrap_completion_valid check (
    (completed_at is null and admin_user_id is null)
    or (completed_at is not null and admin_user_id is not null)
  )
);

insert into public.admin_bootstrap_state (singleton, completed_at, admin_user_id)
select true, a.created_at, a.user_id from public.admins a
order by a.created_at, a.user_id limit 1;
insert into public.admin_bootstrap_state (singleton) values (true) on conflict do nothing;

alter table public.admin_bootstrap_state enable row level security;
revoke all on table public.admin_bootstrap_state from public, anon, authenticated, service_role;

create function public.enforce_admin_bootstrap_state_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'admin bootstrap state cannot be deleted'; end if;
  if old.completed_at is not null or new.singleton is distinct from old.singleton
     or new.completed_at is null or new.admin_user_id is null then
    raise exception 'admin bootstrap state is immutable';
  end if;
  return new;
end;
$$;

create trigger admin_bootstrap_state_mutation_guard
before update or delete on public.admin_bootstrap_state
for each row execute function public.enforce_admin_bootstrap_state_mutation();

create or replace function public.bootstrap_first_google_admin(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_state public.admin_bootstrap_state%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'bootstrap authorization required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('first-google-admin-bootstrap'));
  select * into strict v_state from public.admin_bootstrap_state where singleton for update;
  if v_state.completed_at is not null then raise exception 'admin bootstrap already completed'; end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'provider' = 'google'
      and coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
  ) then raise exception 'verified Google user required'; end if;
  insert into public.admins (user_id, is_active) values (p_user_id, true);
  update public.admin_bootstrap_state
  set completed_at = now(), admin_user_id = p_user_id where singleton;
  return jsonb_build_object('is_admin', true);
end;
$$;

revoke all on function public.enforce_admin_bootstrap_state_mutation() from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_first_google_admin(uuid) from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_google_admin(uuid) to service_role;
