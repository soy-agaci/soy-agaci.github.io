create extension if not exists pgcrypto with schema extensions;

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;
revoke all on table public.admins from public, anon, authenticated;
grant select, insert, update on table public.admins to service_role;

alter table public.submissions
  add column family_id uuid references public.families (id) on delete restrict,
  add column client_request_id uuid,
  add column idempotency_actor_digest bytea,
  add column request_hash bytea;

create unique index submissions_idempotency_idx
  on public.submissions (family_id, idempotency_actor_digest, client_request_id)
  where family_id is not null and client_request_id is not null;

create unique index person_revisions_submission_entity_idx
  on public.person_revisions (submission_id, person_id) where submission_id is not null;
create unique index life_event_revisions_submission_entity_idx
  on public.life_event_revisions (submission_id, life_event_id) where submission_id is not null;
create unique index partnership_revisions_submission_entity_idx
  on public.partnership_revisions (submission_id, partnership_id) where submission_id is not null;
create unique index parent_link_revisions_submission_entity_idx
  on public.parent_link_revisions (submission_id, parent_link_id) where submission_id is not null;
create unique index family_membership_revisions_submission_entity_idx
  on public.family_membership_revisions (submission_id, family_membership_id) where submission_id is not null;
create unique index media_revisions_submission_reference_idx
  on public.media_revisions (submission_id, person_id, legacy_uri) where submission_id is not null;
create unique index sources_submission_reference_idx
  on public.sources (submission_id, title, coalesce(url, ''), coalesce(citation, ''));

revoke insert, update, delete, truncate, references, trigger on table
  public.submissions,
  public.sources,
  public.families,
  public.people,
  public.life_events,
  public.partnerships,
  public.parent_links,
  public.family_memberships,
  public.person_revisions,
  public.life_event_revisions,
  public.partnership_revisions,
  public.parent_link_revisions,
  public.family_membership_revisions,
  public.media_revisions
from service_role;

create or replace function public.enforce_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted', tg_table_name;
  end if;
  if (to_jsonb(new) - array['status', 'reviewed_at', 'reviewed_by'])
      is distinct from
     (to_jsonb(old) - array['status', 'reviewed_at', 'reviewed_by']) then
    raise exception '% revision payload is immutable', tg_table_name;
  end if;
  if not (
    (old.status = 'pending' and new.status in ('approved', 'rejected', 'conflict'))
    or (old.status = 'approved' and new.status = 'superseded')
    or (old.status = 'conflict' and new.status = 'rejected')
  ) then
    raise exception 'invalid % status transition: % -> %',
      tg_table_name, old.status, new.status;
  end if;
  if old.submission_id is not null and (
    new.reviewed_at is null
    or new.reviewed_by is null
    or new.reviewed_by is distinct from auth.uid()
    or not exists (
      select 1 from public.admins
      where user_id = auth.uid() and is_active
    )
  ) then
    raise exception '% moderation requires an authenticated active admin reviewer', tg_table_name;
  end if;
  return new;
end;
$$;

create function public.edit_uuid(p_seed text)
returns uuid
language sql
immutable
set search_path = ''
as $$
select substr(encode(extensions.digest(p_seed, 'sha256'), 'hex'), 1, 32)::uuid
$$;
revoke all on function public.edit_uuid(text) from public, anon, authenticated, service_role;

create function public.enforce_submission_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'submissions cannot be deleted';
  end if;
  if (to_jsonb(new) - array['status', 'updated_at', 'reviewed_at', 'reviewed_by', 'review_note'])
      is distinct from
     (to_jsonb(old) - array['status', 'updated_at', 'reviewed_at', 'reviewed_by', 'review_note']) then
    raise exception 'submission payload is immutable';
  end if;
  if old.status <> 'pending' or new.status not in ('approved', 'rejected', 'conflict') then
    raise exception 'invalid submission status transition: % -> %', old.status, new.status;
  end if;
  if new.reviewed_at is null or new.reviewed_by is null then
    raise exception 'submission moderation requires reviewer audit fields';
  end if;
  return new;
end;
$$;

create trigger submissions_immutable
before update or delete on public.submissions
for each row execute function public.enforce_submission_mutation();

create function public.enforce_source_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'sources are immutable';
end;
$$;

create trigger sources_immutable
before update or delete on public.sources
for each row execute function public.enforce_source_mutation();

revoke all on function public.enforce_submission_mutation() from public, anon, authenticated;
revoke all on function public.enforce_source_mutation() from public, anon, authenticated;

create function public.submit_family_edit(
  p_family_id uuid,
  p_client_request_id uuid,
  p_bundle jsonb,
  p_anonymous_actor_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission_id uuid := pg_catalog.gen_random_uuid();
  v_user_id uuid := auth.uid();
  v_hash bytea;
  v_actor_digest bytea;
  v_existing public.submissions%rowtype;
  v_item jsonb;
  v_person_id uuid;
  v_ref uuid;
  v_entity_id uuid;
  v_base_id uuid;
  v_person1 uuid;
  v_person2 uuid;
  v_old_count integer;
begin
  if p_family_id is null or p_client_request_id is null or p_bundle is null
     or jsonb_typeof(p_bundle) <> 'object'
     or octet_length(p_bundle::text) > 100000 then
    raise exception 'invalid edit request';
  end if;
  if v_user_id is null then
    if p_anonymous_actor_secret is null
       or char_length(p_anonymous_actor_secret) < 32
       or char_length(p_anonymous_actor_secret) > 256 then
      raise exception 'anonymous actor secret must contain 32 to 256 characters';
    end if;
    v_actor_digest := extensions.digest('anonymous:' || p_anonymous_actor_secret, 'sha256');
  else
    v_actor_digest := extensions.digest('authenticated:' || v_user_id::text, 'sha256');
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_bundle) key
    where key not in ('message', 'submitter_name', 'submitter_contact', 'people',
      'events', 'partnerships', 'parent_links', 'memberships', 'sources', 'media')
  ) then
    raise exception 'edit request contains unsupported fields';
  end if;
  if jsonb_typeof(coalesce(p_bundle->'people', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'events', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'partnerships', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'parent_links', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'memberships', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'sources', '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_bundle->'media', '[]'::jsonb)) <> 'array' then
    raise exception 'edit collections must be arrays';
  end if;
  if jsonb_array_length(coalesce(p_bundle->'people', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_bundle->'events', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_bundle->'partnerships', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_bundle->'parent_links', '[]'::jsonb)) > 40
     or jsonb_array_length(coalesce(p_bundle->'memberships', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_bundle->'sources', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_bundle->'media', '[]'::jsonb)) > 20
     or jsonb_array_length(coalesce(p_bundle->'people', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'events', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'partnerships', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'parent_links', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'memberships', '[]'::jsonb)) = 0 then
    raise exception 'edit request size is outside allowed limits';
  end if;
  if char_length(coalesce(p_bundle->>'message', '')) > 2000
     or char_length(coalesce(p_bundle->>'submitter_name', '')) > 200
     or char_length(coalesce(p_bundle->>'submitter_contact', '')) > 320 then
    raise exception 'submission metadata is too long';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_family_id::text || ':' || encode(v_actor_digest, 'hex') || ':' || p_client_request_id::text,
      0
    )
  );
  v_hash := extensions.digest(p_bundle::text, 'sha256');
  select * into v_existing
  from public.submissions s
  where s.family_id = p_family_id
    and s.idempotency_actor_digest = v_actor_digest
    and s.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'client_request_id was already used with a different request';
    end if;
    return jsonb_build_object('submission_id', v_existing.id, 'status', v_existing.status);
  end if;
  -- ponytail: relationship stable allocation is rare; use ordered endpoint locks if submission throughput matters.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('family-edit-relationship-stables')
  );

  if not exists (
    select 1
    from public.family_memberships m
    join public.family_membership_revisions mr on mr.id = m.current_revision_id
    join public.people p on p.id = m.person_id
    join public.person_revisions pr on pr.id = p.current_revision_id
    where m.family_id = p_family_id and mr.status = 'approved'
      and pr.status = 'approved' and pr.privacy = 'public'
  ) then
    raise exception 'family is not visible';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in (
         'ref', 'person_id', 'base_revision_id', 'given_name', 'middle_names',
         'family_name', 'display_name', 'aliases', 'gender', 'is_living', 'summary', 'privacy'))
       or nullif(item->>'ref', '') is null
       or nullif(item->>'display_name', '') is null
       or char_length(item->>'display_name') > 300
       or char_length(coalesce(item->>'given_name', '')) > 200
       or char_length(coalesce(item->>'middle_names', '')) > 300
       or char_length(coalesce(item->>'family_name', '')) > 200
       or char_length(coalesce(item->>'gender', '')) > 50
       or char_length(coalesce(item->>'summary', '')) > 5000
       or coalesce(item->>'privacy', 'public') not in ('public', 'family', 'private')
       or (item ? 'aliases' and jsonb_typeof(item->'aliases') <> 'array')
       or jsonb_array_length(coalesce(item->'aliases', '[]'::jsonb)) > 20
       or exists (select 1 from jsonb_array_elements_text(coalesce(item->'aliases', '[]'::jsonb)) alias where char_length(alias) > 200)
  ) then
    raise exception 'invalid person edit';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) item
    group by item->>'ref' having count(*) > 1
  ) then
    raise exception 'duplicate person ref';
  end if;
  if jsonb_array_length(coalesce(p_bundle->'sources', '[]'::jsonb)) > 0
     and exists (
       select 1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) item
       where coalesce(item->>'privacy', 'public') <> 'public'
     ) then
    raise exception 'sources require an entirely public edit bundle';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) loop
    v_ref := (v_item->>'ref')::uuid;
    v_person_id := nullif(v_item->>'person_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_person_id is null then
      if v_base_id is not null then raise exception 'new person cannot have a base revision'; end if;
    else
      if v_ref <> v_person_id or v_base_id is null then
        raise exception 'existing person ref and base revision are required';
      end if;
      if not exists (
        select 1 from public.family_memberships m
        join public.family_membership_revisions mr on mr.id = m.current_revision_id
        join public.people p on p.id = m.person_id
        join public.person_revisions pr on pr.id = p.current_revision_id
        where m.family_id = p_family_id and m.person_id = v_person_id
          and mr.status = 'approved' and pr.status = 'approved' and pr.privacy = 'public'
          and p.current_revision_id = v_base_id
      ) then
        raise exception 'person target is not a visible current family member';
      end if;
    end if;
  end loop;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in (
         'ref', 'membership_id', 'base_revision_id', 'person_ref'))
       or nullif(item->>'ref', '') is null
       or nullif(item->>'person_ref', '') is null
       or ((item ? 'membership_id') <> (item ? 'base_revision_id'))
       or (item ? 'membership_id' and item->>'ref' <> item->>'membership_id')
  ) then
    raise exception 'invalid membership edit';
  end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) item
    group by item->>'ref' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) item
    where item ? 'membership_id' group by item->>'membership_id' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) item
    group by item->>'person_ref' having count(*) > 1
  ) then
    raise exception 'duplicate membership target';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) loop
    v_ref := (v_item->>'person_ref')::uuid;
    select coalesce(nullif(person_item->>'person_id', '')::uuid,
      public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person_id
    from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) person_item
    where person_item->>'ref' = v_ref::text;
    v_person_id := coalesce(v_person_id, v_ref);
    v_entity_id := nullif(v_item->>'membership_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;

    if v_entity_id is null then
      if not exists (
        select 1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) person_item
        where person_item->>'ref' = v_ref::text
      ) and not exists (
        select 1
        from public.people person
        join public.person_revisions person_revision on person_revision.id = person.current_revision_id
        where person.id = v_person_id and person_revision.status = 'approved'
          and person_revision.privacy = 'public'
          and exists (
            select 1 from public.family_memberships membership
            join public.family_membership_revisions membership_revision
              on membership_revision.id = membership.current_revision_id
            where membership.person_id = person.id and membership_revision.status = 'approved'
          )
      ) then
        raise exception 'invalid membership edit';
      end if;
      if exists (
        select 1 from public.family_memberships membership
        where membership.family_id = p_family_id and membership.person_id = v_person_id
          and membership.current_revision_id is not null
      ) then
        raise exception 'invalid membership edit';
      end if;
    elsif not exists (
      select 1
      from public.family_memberships membership
      join public.people person on person.id = membership.person_id
      join public.person_revisions person_revision on person_revision.id = person.current_revision_id
      where membership.id = v_entity_id and membership.family_id = p_family_id
        and membership.person_id = v_person_id and membership.current_revision_id = v_base_id
        and person_revision.status = 'approved' and person_revision.privacy = 'public'
    ) then
      raise exception 'membership target is not a visible current family membership';
    end if;
  end loop;

  if exists (
    select 1 from (
      select item->>'person_ref' ref from jsonb_array_elements(coalesce(p_bundle->'events', '[]'::jsonb)) item
      union all select item->>'person_ref' from jsonb_array_elements(coalesce(p_bundle->'media', '[]'::jsonb)) item
      union all select item->>'person1_ref' from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
      union all select item->>'person2_ref' from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
      union all select item->>'parent_ref' from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
      union all select item->>'child_ref' from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    ) refs
    where nullif(ref, '') is null or not (
      exists (select 1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = refs.ref)
      or exists (select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) m where m->>'person_ref' = refs.ref)
      or exists (
        select 1 from public.family_memberships m
        join public.family_membership_revisions mr on mr.id = m.current_revision_id
        join public.people p on p.id = m.person_id
        join public.person_revisions pr on pr.id = p.current_revision_id
        where m.family_id = p_family_id and m.person_id = refs.ref::uuid
          and mr.status = 'approved' and pr.status = 'approved' and pr.privacy = 'public'
      )
    )
  ) then
    raise exception 'person reference is not a visible family member or bundle person';
  end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'events', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in (
         'ref', 'event_id', 'base_revision_id', 'person_ref', 'event_type',
         'date_start', 'date_end', 'date_text', 'place_text', 'details', 'certainty'))
       or nullif(item->>'ref', '') is null or nullif(item->>'person_ref', '') is null
       or item->>'event_type' not in ('birth', 'death', 'residence', 'education', 'occupation', 'other')
       or char_length(coalesce(item->>'date_text', '')) > 200
       or char_length(coalesce(item->>'place_text', '')) > 500
       or char_length(coalesce(item->>'details', '')) > 2000
       or (item ? 'certainty' and (item->>'certainty')::numeric not between 0 and 1)
       or (item ? 'date_start' and (item->>'date_start')::date::text <> item->>'date_start')
       or (item ? 'date_end' and (item->>'date_end')::date::text <> item->>'date_end')
       or (item ? 'date_end' and not item ? 'date_start')
       or ((item ? 'date_start') and (item ? 'date_end') and (item->>'date_start')::date > (item->>'date_end')::date)
       or (nullif(item->>'date_text', '') is not null
           and nullif(item->>'date_start', '') is not null
           and not (
             (item->>'date_text' = item->>'date_start'
               and (nullif(item->>'date_end', '') is null
                 or item->>'date_end' = item->>'date_start'))
             or (nullif(item->>'date_end', '') is not null
               and item->>'date_end' <> item->>'date_start'
               and item->>'date_text' = (item->>'date_start') || '/' || (item->>'date_end'))
           ))
  ) then raise exception 'invalid life event edit'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'events', '[]'::jsonb)) item
    group by item->>'ref' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'events', '[]'::jsonb)) item
    where item ? 'event_id' group by item->>'event_id' having count(*) > 1
  ) then raise exception 'duplicate life event target'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in (
         'ref', 'partnership_id', 'base_revision_id', 'person1_ref', 'person2_ref',
         'partnership_type', 'date_start', 'date_end', 'date_text', 'status_text'))
       or nullif(item->>'ref', '') is null or nullif(item->>'person1_ref', '') is null
       or nullif(item->>'person2_ref', '') is null or item->>'person1_ref' = item->>'person2_ref'
       or item->>'partnership_type' not in ('marriage', 'civil_union', 'domestic_partnership', 'other')
       or char_length(coalesce(item->>'date_text', '')) > 200
       or char_length(coalesce(item->>'status_text', '')) > 200
       or (item ? 'date_start' and (item->>'date_start')::date::text <> item->>'date_start')
       or (item ? 'date_end' and (item->>'date_end')::date::text <> item->>'date_end')
       or (item ? 'date_end' and not item ? 'date_start')
       or ((item ? 'date_start') and (item ? 'date_end') and (item->>'date_start')::date > (item->>'date_end')::date)
       or (nullif(item->>'date_text', '') is not null
           and nullif(item->>'date_start', '') is not null
           and not (
             (item->>'date_text' = item->>'date_start'
               and (nullif(item->>'date_end', '') is null
                 or item->>'date_end' = item->>'date_start'))
             or (nullif(item->>'date_end', '') is not null
               and item->>'date_end' <> item->>'date_start'
               and item->>'date_text' = (item->>'date_start') || '/' || (item->>'date_end'))
           ))
  ) then raise exception 'invalid partnership edit'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
    group by item->>'ref' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
    where item ? 'partnership_id' group by item->>'partnership_id' having count(*) > 1
  ) or exists (
    select 1
    from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) item
    group by least(item->>'person1_ref', item->>'person2_ref'),
      greatest(item->>'person1_ref', item->>'person2_ref')
    having count(*) > 1
  ) then raise exception 'duplicate partnership target'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in (
         'ref', 'parent_link_id', 'base_revision_id', 'parent_ref', 'child_ref',
         'relationship_type', 'certainty'))
       or nullif(item->>'ref', '') is null or nullif(item->>'parent_ref', '') is null
       or nullif(item->>'child_ref', '') is null or item->>'parent_ref' = item->>'child_ref'
       or item->>'relationship_type' not in ('biological', 'adoptive', 'step', 'foster', 'guardian')
       or (item ? 'certainty' and (item->>'certainty')::numeric not between 0 and 1)
  ) then raise exception 'invalid parent link edit'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    group by item->>'child_ref', item->>'parent_ref' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    group by item->>'child_ref' having count(distinct item->>'parent_ref') > 2
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    group by item->>'ref' having count(*) > 1
  ) or exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    where item ? 'parent_link_id' group by item->>'parent_link_id' having count(*) > 1
  ) then raise exception 'invalid or duplicate parent set'; end if;
  if exists (
    with recursive edges(parent_ref, child_ref) as (
      select parent_id::text, child_id::text
      from public.parent_links where current_revision_id is not null
      union
      select item->>'parent_ref', item->>'child_ref'
      from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) item
    ), reach(root, node) as (
      select parent_ref, child_ref from edges
      union
      select reach.root, edges.child_ref from reach join edges on edges.parent_ref = reach.node
    )
    select 1 from reach where root = node
  ) then raise exception 'parent links would create a cycle'; end if;

  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'sources', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in ('title', 'url', 'citation'))
       or nullif(item->>'title', '') is null or char_length(item->>'title') > 500
       or char_length(coalesce(item->>'citation', '')) > 2000
       or (item ? 'url' and (char_length(item->>'url') > 2000 or item->>'url' !~ '^https://[^[:space:]]+$'))
  ) then raise exception 'invalid source'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'sources', '[]'::jsonb)) item
    group by item->>'title', coalesce(item->>'url', ''), coalesce(item->>'citation', '')
    having count(*) > 1
  ) then raise exception 'duplicate source'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'media', '[]'::jsonb)) item
    where jsonb_typeof(item) <> 'object'
       or exists (select 1 from jsonb_object_keys(item) key where key not in ('person_ref', 'url', 'mime_type', 'caption'))
       or nullif(item->>'person_ref', '') is null or nullif(item->>'url', '') is null
       or char_length(item->>'url') > 2000 or item->>'url' !~ '^https://[^[:space:]]+$'
       or item->>'mime_type' not in ('image/jpeg', 'image/png', 'image/webp', 'image/gif')
       or char_length(coalesce(item->>'caption', '')) > 500
  ) then raise exception 'invalid media reference'; end if;
  if exists (
    select 1 from jsonb_array_elements(coalesce(p_bundle->'media', '[]'::jsonb)) item
    group by item->>'person_ref', item->>'url' having count(*) > 1
  ) then raise exception 'duplicate media reference'; end if;

  insert into public.submissions (
    id, family_id, client_request_id, idempotency_actor_digest, request_hash, message,
    submitter_user_id, submitter_name, submitter_contact
  ) values (
    v_submission_id, p_family_id, p_client_request_id, v_actor_digest, v_hash,
    nullif(p_bundle->>'message', ''), v_user_id,
    nullif(p_bundle->>'submitter_name', ''), nullif(p_bundle->>'submitter_contact', '')
  );

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) loop
    v_ref := (v_item->>'ref')::uuid;
    v_person_id := nullif(v_item->>'person_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_person_id is null then
      v_person_id := public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text);
      insert into public.people (id) values (v_person_id);
      if not exists (
        select 1 from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) membership
        where membership->>'person_ref' = v_ref::text
      ) then
        v_entity_id := public.edit_uuid(v_submission_id::text || ':membership:' || v_ref::text);
        insert into public.family_memberships (id, family_id, person_id)
        values (v_entity_id, p_family_id, v_person_id);
        insert into public.family_membership_revisions (
          id, family_membership_id, submission_id, person_id, family_id
        ) values (
          public.edit_uuid(v_submission_id::text || ':membership-revision:' || v_ref::text),
          v_entity_id, v_submission_id, v_person_id, p_family_id
        );
      end if;
    end if;
    insert into public.person_revisions (
      id, person_id, submission_id, base_revision_id, given_name, middle_names,
      family_name, display_name, aliases, gender, is_living, summary, privacy
    ) values (
      public.edit_uuid(v_submission_id::text || ':person-revision:' || v_ref::text),
      v_person_id, v_submission_id, v_base_id, nullif(v_item->>'given_name', ''),
      nullif(v_item->>'middle_names', ''), nullif(v_item->>'family_name', ''),
      v_item->>'display_name', array(select jsonb_array_elements_text(coalesce(v_item->'aliases', '[]'::jsonb))),
      nullif(v_item->>'gender', ''), nullif(v_item->>'is_living', '')::boolean,
      nullif(v_item->>'summary', ''), coalesce((v_item->>'privacy')::public.privacy_level, 'public')
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'memberships', '[]'::jsonb)) loop
    v_ref := (v_item->>'person_ref')::uuid;
    select coalesce(nullif(person_item->>'person_id', '')::uuid,
      public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person_id
    from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) person_item
    where person_item->>'ref' = v_ref::text;
    v_person_id := coalesce(v_person_id, v_ref);
    v_entity_id := nullif(v_item->>'membership_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_entity_id is null then
      select membership.id into v_entity_id
      from public.family_memberships membership
      where membership.family_id = p_family_id and membership.person_id = v_person_id;
      if v_entity_id is null then
        v_entity_id := public.edit_uuid(v_submission_id::text || ':membership:' || (v_item->>'ref'));
        insert into public.family_memberships (id, family_id, person_id)
        values (v_entity_id, p_family_id, v_person_id);
      end if;
    end if;
    insert into public.family_membership_revisions (
      id, family_membership_id, submission_id, base_revision_id, person_id, family_id
    ) values (
      public.edit_uuid(v_submission_id::text || ':membership-revision:' || (v_item->>'ref')),
      v_entity_id, v_submission_id, v_base_id, v_person_id, p_family_id
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'events', '[]'::jsonb)) loop
    v_ref := (v_item->>'person_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid,
      public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person_id
    from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person_id := coalesce(v_person_id, v_ref);
    v_entity_id := nullif(v_item->>'event_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_entity_id is null then
      if v_base_id is not null then raise exception 'new event cannot have a base revision'; end if;
      v_entity_id := public.edit_uuid(v_submission_id::text || ':event:' || (v_item->>'ref'));
      insert into public.life_events (id, person_id) values (v_entity_id, v_person_id);
    elsif not exists (
      select 1 from public.life_events e where e.id = v_entity_id
        and e.person_id = v_person_id and e.current_revision_id = v_base_id
    ) then raise exception 'event target/base mismatch'; end if;
    insert into public.life_event_revisions (
      id, life_event_id, submission_id, base_revision_id, event_type,
      date_start, date_end, date_text, place_text, details, certainty
    ) values (
      public.edit_uuid(v_submission_id::text || ':event-revision:' || (v_item->>'ref')),
      v_entity_id, v_submission_id, v_base_id, (v_item->>'event_type')::public.life_event_type,
      nullif(v_item->>'date_start', '')::date, nullif(v_item->>'date_end', '')::date,
      nullif(v_item->>'date_text', ''), nullif(v_item->>'place_text', ''),
      nullif(v_item->>'details', ''), nullif(v_item->>'certainty', '')::numeric
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'partnerships', '[]'::jsonb)) loop
    v_ref := (v_item->>'person1_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid, public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person1 := coalesce(v_person1, v_ref);
    v_ref := (v_item->>'person2_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid, public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person2 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person2 := coalesce(v_person2, v_ref);
    if v_person1 > v_person2 then v_ref := v_person1; v_person1 := v_person2; v_person2 := v_ref; end if;
    v_entity_id := nullif(v_item->>'partnership_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_entity_id is null then
      if v_base_id is not null then raise exception 'new partnership cannot have a base revision'; end if;
      select id into v_entity_id
      from public.partnerships
      where person1_id = v_person1 and person2_id = v_person2;
      if v_entity_id is not null and exists (
        select 1 from public.partnerships
        where id = v_entity_id and current_revision_id is not null
      ) then
        raise exception 'partnership already exists';
      end if;
      if v_entity_id is null then
        v_entity_id := public.edit_uuid(v_submission_id::text || ':partnership:' || (v_item->>'ref'));
        insert into public.partnerships (id, person1_id, person2_id)
        values (v_entity_id, v_person1, v_person2);
      end if;
    elsif not exists (
      select 1 from public.partnerships p where p.id = v_entity_id and p.person1_id = v_person1
        and p.person2_id = v_person2 and p.current_revision_id = v_base_id
    ) then raise exception 'partnership target/base mismatch'; end if;
    insert into public.partnership_revisions (
      id, partnership_id, submission_id, base_revision_id, person1_id, person2_id,
      partnership_type, date_start, date_end, date_text, status_text
    ) values (
      public.edit_uuid(v_submission_id::text || ':partnership-revision:' || (v_item->>'ref')),
      v_entity_id, v_submission_id, v_base_id, v_person1, v_person2,
      (v_item->>'partnership_type')::public.partnership_type,
      nullif(v_item->>'date_start', '')::date, nullif(v_item->>'date_end', '')::date,
      nullif(v_item->>'date_text', ''), nullif(v_item->>'status_text', '')
    );
  end loop;

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) loop
    v_ref := (v_item->>'parent_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid, public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person1 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person1 := coalesce(v_person1, v_ref);
    v_ref := (v_item->>'child_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid, public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person2 from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person2 := coalesce(v_person2, v_ref);
    v_entity_id := nullif(v_item->>'parent_link_id', '')::uuid;
    v_base_id := nullif(v_item->>'base_revision_id', '')::uuid;
    if v_entity_id is null then
      if v_base_id is not null then raise exception 'new parent link cannot have a base revision'; end if;
      select id into v_entity_id
      from public.parent_links
      where parent_id = v_person1 and child_id = v_person2;
      if v_entity_id is not null and exists (
        select 1 from public.parent_links
        where id = v_entity_id and current_revision_id is not null
      ) then
        raise exception 'parent link already exists';
      end if;
      select count(*) into v_old_count from public.parent_links where child_id = v_person2 and current_revision_id is not null;
      if v_old_count + (select count(*) from jsonb_array_elements(coalesce(p_bundle->'parent_links', '[]'::jsonb)) x where x->>'child_ref' = v_item->>'child_ref' and not x ? 'parent_link_id') > 2 then
        raise exception 'child cannot have more than two parents';
      end if;
      if exists (select 1 from public.parent_links where parent_id = v_person2 and child_id = v_person1 and current_revision_id is not null) then
        raise exception 'reverse parent link exists';
      end if;
      if v_entity_id is null then
        v_entity_id := public.edit_uuid(v_submission_id::text || ':parent-link:' || (v_item->>'ref'));
        insert into public.parent_links (id, parent_id, child_id)
        values (v_entity_id, v_person1, v_person2);
      end if;
    elsif not exists (
      select 1 from public.parent_links p where p.id = v_entity_id and p.parent_id = v_person1
        and p.child_id = v_person2 and p.current_revision_id = v_base_id
    ) then raise exception 'parent link target/base mismatch'; end if;
    insert into public.parent_link_revisions (
      id, parent_link_id, submission_id, base_revision_id, parent_id, child_id,
      relationship_type, certainty
    ) values (
      public.edit_uuid(v_submission_id::text || ':parent-link-revision:' || (v_item->>'ref')),
      v_entity_id, v_submission_id, v_base_id, v_person1, v_person2,
      (v_item->>'relationship_type')::public.parent_relationship_type,
      nullif(v_item->>'certainty', '')::numeric
    );
  end loop;

  insert into public.sources (id, submission_id, title, url, citation)
  select public.edit_uuid(v_submission_id::text || ':source:' || ordinality::text),
    v_submission_id, item->>'title', nullif(item->>'url', ''), nullif(item->>'citation', '')
  from jsonb_array_elements(coalesce(p_bundle->'sources', '[]'::jsonb)) with ordinality source(item, ordinality);

  for v_item in select value from jsonb_array_elements(coalesce(p_bundle->'media', '[]'::jsonb)) loop
    v_ref := (v_item->>'person_ref')::uuid;
    select coalesce(nullif(p->>'person_id', '')::uuid, public.edit_uuid(v_submission_id::text || ':person:' || v_ref::text))
      into v_person_id from jsonb_array_elements(coalesce(p_bundle->'people', '[]'::jsonb)) p where p->>'ref' = v_ref::text;
    v_person_id := coalesce(v_person_id, v_ref);
    insert into public.media_revisions (
      id, person_id, submission_id, legacy_uri, mime_type, caption
    ) values (
      public.edit_uuid(v_submission_id::text || ':media:' || v_ref::text || ':' || (v_item->>'url')),
      v_person_id, v_submission_id, v_item->>'url', v_item->>'mime_type', nullif(v_item->>'caption', '')
    );
  end loop;

  return jsonb_build_object('submission_id', v_submission_id, 'status', 'pending');
end;
$$;

revoke all on function public.submit_family_edit(uuid, uuid, jsonb, text) from public;
grant execute on function public.submit_family_edit(uuid, uuid, jsonb, text) to anon, authenticated;

create function public.moderate_family_submission(
  p_submission_id uuid,
  p_decision text,
  p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_submission public.submissions%rowtype;
  v_reviewer uuid := auth.uid();
  v_now timestamptz := now();
begin
  if v_reviewer is null or not exists (
    select 1 from public.admins where user_id = v_reviewer and is_active
  ) then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000 then
    raise exception 'invalid moderation request';
  end if;
  -- ponytail: global lock preserves cross-family shared-person invariants; use entity locks if moderation throughput matters.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('family-submission-moderation')
  );
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if v_submission.status <> 'pending' then
    raise exception 'submission is already %', v_submission.status;
  end if;

  if p_decision = 'reject' then
    update public.person_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.family_membership_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.life_event_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.partnership_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.parent_link_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.media_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.submissions set status = 'rejected', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = nullif(p_review_note, '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
  end if;

  if exists (
    select 1 from public.person_revisions r join public.people e on e.id = r.person_id
      where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.family_membership_revisions r join public.family_memberships e on e.id = r.family_membership_id
      where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.life_event_revisions r join public.life_events e on e.id = r.life_event_id
      where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.partnership_revisions r join public.partnerships e on e.id = r.partnership_id
      where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.parent_link_revisions r join public.parent_links e on e.id = r.parent_link_id
      where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
  ) or exists (
    select 1
    from public.parent_link_revisions proposed
    join public.parent_links proposed_link on proposed_link.id = proposed.parent_link_id
    where proposed.submission_id = p_submission_id and proposed.status = 'pending'
    group by proposed.child_id
    having count(*) filter (where proposed_link.current_revision_id is null)
      + (select count(*) from public.parent_links current_link
         where current_link.child_id = proposed.child_id
           and current_link.current_revision_id is not null) > 2
  ) or exists (
    with recursive edges(parent_id, child_id) as (
      select parent_id, child_id
      from public.parent_links where current_revision_id is not null
      union
      select r.parent_id, r.child_id
      from public.parent_link_revisions r
      join public.parent_links link on link.id = r.parent_link_id
      where r.submission_id = p_submission_id and r.status = 'pending'
        and link.current_revision_id is null
    ), reach(root, node) as (
      select parent_id, child_id from edges
      union
      select reach.root, edges.child_id
      from reach join edges on edges.parent_id = reach.node
    )
    select 1 from reach where root = node
  ) then
    update public.person_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.family_membership_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.life_event_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.partnership_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.parent_link_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.media_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = nullif(p_review_note, '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict');
  end if;

  create temporary table if not exists pg_temp.moderation_old_revisions (
    kind text, entity_id uuid, revision_id uuid
  ) on commit drop;
  truncate pg_temp.moderation_old_revisions;
  insert into pg_temp.moderation_old_revisions
    select 'person', e.id, e.current_revision_id from public.people e join public.person_revisions r on r.person_id = e.id where r.submission_id = p_submission_id and r.status = 'pending' and e.current_revision_id is not null
    union all select 'membership', e.id, e.current_revision_id from public.family_memberships e join public.family_membership_revisions r on r.family_membership_id = e.id where r.submission_id = p_submission_id and r.status = 'pending' and e.current_revision_id is not null
    union all select 'event', e.id, e.current_revision_id from public.life_events e join public.life_event_revisions r on r.life_event_id = e.id where r.submission_id = p_submission_id and r.status = 'pending' and e.current_revision_id is not null
    union all select 'partnership', e.id, e.current_revision_id from public.partnerships e join public.partnership_revisions r on r.partnership_id = e.id where r.submission_id = p_submission_id and r.status = 'pending' and e.current_revision_id is not null
    union all select 'parent', e.id, e.current_revision_id from public.parent_links e join public.parent_link_revisions r on r.parent_link_id = e.id where r.submission_id = p_submission_id and r.status = 'pending' and e.current_revision_id is not null;

  update public.person_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
  update public.family_membership_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
  update public.life_event_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
  update public.partnership_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
  update public.parent_link_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
  update public.media_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';

  update public.people e set current_revision_id = r.id from public.person_revisions r where r.submission_id = p_submission_id and r.person_id = e.id;
  update public.family_memberships e set current_revision_id = r.id from public.family_membership_revisions r where r.submission_id = p_submission_id and r.family_membership_id = e.id;
  update public.life_events e set current_revision_id = r.id from public.life_event_revisions r where r.submission_id = p_submission_id and r.life_event_id = e.id;
  update public.partnerships e set current_revision_id = r.id from public.partnership_revisions r where r.submission_id = p_submission_id and r.partnership_id = e.id;
  update public.parent_links e set current_revision_id = r.id from public.parent_link_revisions r where r.submission_id = p_submission_id and r.parent_link_id = e.id;

  update public.person_revisions r set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer from pg_temp.moderation_old_revisions old where old.kind = 'person' and old.revision_id = r.id;
  update public.family_membership_revisions r set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer from pg_temp.moderation_old_revisions old where old.kind = 'membership' and old.revision_id = r.id;
  update public.life_event_revisions r set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer from pg_temp.moderation_old_revisions old where old.kind = 'event' and old.revision_id = r.id;
  update public.partnership_revisions r set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer from pg_temp.moderation_old_revisions old where old.kind = 'partnership' and old.revision_id = r.id;
  update public.parent_link_revisions r set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer from pg_temp.moderation_old_revisions old where old.kind = 'parent' and old.revision_id = r.id;

  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = v_reviewer, review_note = nullif(p_review_note, '') where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

create function public.approve_family_submission(p_submission_id uuid, p_review_note text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select public.moderate_family_submission(p_submission_id, 'approve', p_review_note) $$;

create function public.reject_family_submission(p_submission_id uuid, p_review_note text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select public.moderate_family_submission(p_submission_id, 'reject', p_review_note) $$;

revoke all on function public.moderate_family_submission(uuid, text, text) from public, anon, authenticated;
revoke all on function public.approve_family_submission(uuid, text) from public;
revoke all on function public.reject_family_submission(uuid, text) from public;
grant execute on function public.approve_family_submission(uuid, text) to authenticated;
grant execute on function public.reject_family_submission(uuid, text) to authenticated;
