create table public.admin_invitations (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by uuid not null references auth.users (id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  accepted_by uuid references auth.users (id) on delete restrict,
  accepted_at timestamptz,
  revoked_by uuid references auth.users (id) on delete restrict,
  revoked_at timestamptz,
  expired_at timestamptz,
  constraint admin_invitation_email_valid check (
    email = lower(btrim(email)) and char_length(email) between 3 and 254
    and email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  constraint admin_invitation_expiry_valid check (expires_at > created_at),
  constraint admin_invitation_transition_valid check (
    (status = 'pending' and accepted_by is null and accepted_at is null and revoked_by is null and revoked_at is null and expired_at is null)
    or (status = 'accepted' and accepted_by is not null and accepted_at is not null and revoked_by is null and revoked_at is null and expired_at is null)
    or (status = 'revoked' and accepted_by is null and accepted_at is null and revoked_by is not null and revoked_at is not null and expired_at is null)
    or (status = 'expired' and accepted_by is null and accepted_at is null and revoked_by is null and revoked_at is null and expired_at is not null)
  )
);

create unique index admin_invitations_one_pending_email
  on public.admin_invitations (email) where status = 'pending';

alter table public.admin_invitations enable row level security;
revoke all on table public.admin_invitations from public, anon, authenticated, service_role;
revoke all on table public.admins from service_role;

create function public.enforce_admin_invitation_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then raise exception 'admin invitations cannot be deleted'; end if;
  if tg_op = 'UPDATE' then
    if old.id <> new.id or old.email <> new.email or old.invited_by <> new.invited_by
       or old.created_at <> new.created_at or old.expires_at <> new.expires_at
       or old.status <> 'pending' or new.status not in ('accepted', 'revoked', 'expired') then
      raise exception 'admin invitation audit fields are immutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger admin_invitation_mutation_guard
before update or delete on public.admin_invitations
for each row execute function public.enforce_admin_invitation_mutation();

create function public.bootstrap_first_google_admin(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.role() <> 'service_role' then raise exception 'bootstrap authorization required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('first-google-admin-bootstrap'));
  if exists (select 1 from public.admins where is_active) then raise exception 'an active admin already exists'; end if;
  if not exists (
    select 1 from auth.users u where u.id = p_user_id and u.email_confirmed_at is not null
      and u.raw_app_meta_data->>'provider' = 'google'
      and coalesce(u.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google'
  ) then raise exception 'verified Google user required'; end if;
  insert into public.admins (user_id, is_active) values (p_user_id, true)
  on conflict (user_id) do update set is_active = true;
  return jsonb_build_object('is_admin', true);
end;
$$;

create function public.create_admin_invitation(p_email text, p_expires_at timestamptz default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(btrim(p_email));
  v_now timestamptz := now();
  v_expires_at timestamptz := coalesce(p_expires_at, now() + interval '7 days');
  v_invite public.admin_invitations%rowtype;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if v_email is null or char_length(v_email) not between 3 and 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+$'
     or v_expires_at <= v_now or v_expires_at > v_now + interval '90 days' then
    raise exception 'invalid admin invitation';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_email));
  update public.admin_invitations set status = 'expired', expired_at = v_now
  where email = v_email and status = 'pending' and expires_at <= v_now;
  select * into v_invite from public.admin_invitations where email = v_email and status = 'pending';
  if not found then
    insert into public.admin_invitations (email, invited_by, expires_at)
    values (v_email, auth.uid(), v_expires_at) returning * into v_invite;
  end if;
  return jsonb_build_object('id', v_invite.id, 'email', v_invite.email, 'status', v_invite.status,
    'created_at', v_invite.created_at, 'expires_at', v_invite.expires_at);
end;
$$;

create function public.list_admin_invitations()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  update public.admin_invitations set status = 'expired', expired_at = now()
  where status = 'pending' and expires_at <= now();
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'email', i.email, 'status', i.status, 'created_at', i.created_at,
    'expires_at', i.expires_at, 'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at,
    'expired_at', i.expired_at
  ) order by i.created_at desc, i.id desc), '[]'::jsonb)
  into v_result from (select * from public.admin_invitations order by created_at desc, id desc limit 100) i;
  return v_result;
end;
$$;

create function public.revoke_admin_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invite public.admin_invitations%rowtype;
  v_now timestamptz := now();
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  select * into v_invite from public.admin_invitations where id = p_invitation_id;
  if not found then raise exception 'admin invitation not found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_invite.email));
  select * into v_invite from public.admin_invitations where id = p_invitation_id for update;
  if v_invite.status = 'pending' and v_invite.expires_at <= v_now then
    update public.admin_invitations set status = 'expired', expired_at = v_now where id = v_invite.id;
  elsif v_invite.status = 'pending' then
    update public.admin_invitations set status = 'revoked', revoked_by = auth.uid(), revoked_at = v_now where id = v_invite.id;
  end if;
  return jsonb_build_object('id', v_invite.id);
end;
$$;

create function public.accept_admin_invitation()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user auth.users%rowtype;
  v_invite public.admin_invitations%rowtype;
  v_now timestamptz := now();
  v_email text;
  v_is_admin boolean;
begin
  if auth.role() <> 'authenticated' or auth.uid() is null then return jsonb_build_object('is_admin', false); end if;
  select * into v_user from auth.users where id = auth.uid();
  if not found or v_user.email is null or v_user.email_confirmed_at is null
     or v_user.raw_app_meta_data->>'provider' <> 'google'
     or not (coalesce(v_user.raw_app_meta_data->'providers', '[]'::jsonb) ? 'google') then
    return jsonb_build_object('is_admin', false);
  end if;
  v_email := lower(btrim(v_user.email::text));
  select exists (select 1 from public.admins where user_id = auth.uid() and is_active) into v_is_admin;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_email));
  select * into v_invite from public.admin_invitations
  where email = v_email and status = 'pending' for update;
  if not found then return jsonb_build_object('is_admin', v_is_admin); end if;
  if v_invite.expires_at <= v_now then
    update public.admin_invitations set status = 'expired', expired_at = v_now where id = v_invite.id;
    return jsonb_build_object('is_admin', v_is_admin);
  end if;
  if not v_is_admin then
    insert into public.admins (user_id, is_active) values (auth.uid(), true)
    on conflict (user_id) do update set is_active = true;
  end if;
  update public.admin_invitations set status = 'accepted', accepted_by = auth.uid(), accepted_at = v_now
  where id = v_invite.id;
  return jsonb_build_object('is_admin', true);
end;
$$;

revoke all on function public.enforce_admin_invitation_mutation() from public, anon, authenticated, service_role;
revoke all on function public.bootstrap_first_google_admin(uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_admin_invitation(text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.list_admin_invitations() from public, anon, authenticated, service_role;
revoke all on function public.revoke_admin_invitation(uuid) from public, anon, authenticated, service_role;
revoke all on function public.accept_admin_invitation() from public, anon, authenticated, service_role;
grant execute on function public.bootstrap_first_google_admin(uuid) to service_role;
grant execute on function public.create_admin_invitation(text, timestamptz) to authenticated;
grant execute on function public.list_admin_invitations() to authenticated;
grant execute on function public.revoke_admin_invitation(uuid) to authenticated;
grant execute on function public.accept_admin_invitation() to authenticated;
