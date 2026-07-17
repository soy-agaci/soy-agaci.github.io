create table public.family_creation_proposals (
  id uuid primary key,
  submission_id uuid not null unique references public.submissions (id) on delete restrict,
  slug text not null,
  name text not null,
  root_person_id uuid not null references public.people (id) on delete restrict,
  source_family_id uuid not null references public.families (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint family_creation_proposals_slug check (
    char_length(slug) between 1 and 100 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint family_creation_proposals_name check (
    char_length(name) between 1 and 200 and name = btrim(name)
  )
);

create index family_creation_proposals_source_idx
  on public.family_creation_proposals (source_family_id, created_at);
create index family_creation_proposals_slug_idx
  on public.family_creation_proposals (slug);

alter table public.family_creation_proposals enable row level security;
revoke all on table public.family_creation_proposals from public, anon, authenticated, service_role;

create function public.submit_family_creation(
  p_source_family_id uuid,
  p_root_person_id uuid,
  p_client_request_id uuid,
  p_name text,
  p_slug text,
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
  v_actor_digest bytea;
  v_hash bytea;
  v_existing public.submissions%rowtype;
  v_name text := btrim(p_name);
begin
  if p_source_family_id is null or p_root_person_id is null or p_client_request_id is null
     or p_name is null or p_slug is null
     or octet_length(p_name) > 800 or octet_length(p_slug) > 400
     or char_length(v_name) not between 1 and 200
     or char_length(p_slug) not between 1 and 100
     or p_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' then
    raise exception 'invalid family creation request';
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

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_source_family_id::text || ':' || encode(v_actor_digest, 'hex') || ':' || p_client_request_id::text, 0
  ));
  v_hash := extensions.digest(jsonb_build_object(
    'root_person_id', p_root_person_id, 'name', v_name, 'slug', p_slug
  )::text, 'sha256');
  select * into v_existing from public.submissions s
  where s.family_id = p_source_family_id
    and s.idempotency_actor_digest = v_actor_digest
    and s.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> v_hash then
      raise exception 'client_request_id was already used with a different request';
    end if;
    if not exists (
      select 1 from public.family_creation_proposals where submission_id = v_existing.id
    ) then
      raise exception 'client_request_id was already used with a different request';
    end if;
    return jsonb_build_object('submission_id', v_existing.id, 'status', v_existing.status);
  end if;

  if not exists (
    select 1
    from public.family_memberships m
    join public.family_membership_revisions mr on mr.id = m.current_revision_id
    join public.people p on p.id = m.person_id
    join public.person_revisions pr on pr.id = p.current_revision_id
    where m.family_id = p_source_family_id and m.person_id = p_root_person_id
      and mr.status = 'approved' and pr.status = 'approved' and pr.privacy = 'public'
  ) then
    raise exception 'root person is not a visible current source-family member';
  end if;
  if exists (select 1 from public.families where slug = p_slug) then
    raise exception 'family slug already exists';
  end if;

  insert into public.submissions (
    id, family_id, client_request_id, idempotency_actor_digest, request_hash, submitter_user_id
  ) values (
    v_submission_id, p_source_family_id, p_client_request_id, v_actor_digest, v_hash, v_user_id
  );
  insert into public.family_creation_proposals (
    id, submission_id, slug, name, root_person_id, source_family_id
  ) values (
    pg_catalog.gen_random_uuid(), v_submission_id, p_slug, v_name, p_root_person_id, p_source_family_id
  );
  return jsonb_build_object('submission_id', v_submission_id, 'status', 'pending');
end;
$$;

create function public.list_family_creation_proposals(p_source_family_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', proposal.id,
    'submission_id', submission.id,
    'status', submission.status,
    'slug', proposal.slug,
    'name', proposal.name,
    'root_person_id', proposal.root_person_id,
    'root_display_name', person_revision.display_name,
    'source_family_id', source_family.id,
    'source_family_slug', source_family.slug,
    'source_family_name', source_family.name,
    'created_at', proposal.created_at,
    'updated_at', submission.updated_at,
    'reviewed_at', submission.reviewed_at
  ) order by proposal.created_at, proposal.id), '[]'::jsonb)
  from public.family_creation_proposals proposal
  join public.submissions submission on submission.id = proposal.submission_id
  join public.families source_family on source_family.id = proposal.source_family_id
  join public.people person on person.id = proposal.root_person_id
  join public.person_revisions person_revision on person_revision.id = person.current_revision_id
  where proposal.source_family_id = any(coalesce(p_source_family_ids, '{}'::uuid[]))
    and submission.status = 'pending'
    and person_revision.status = 'approved' and person_revision.privacy = 'public'
    and exists (
      select 1 from public.family_memberships root_membership
      join public.family_membership_revisions root_revision
        on root_revision.id = root_membership.current_revision_id
      where root_membership.family_id = proposal.source_family_id
        and root_membership.person_id = proposal.root_person_id
        and root_revision.status = 'approved'
    )
    and exists (
      select 1 from public.family_memberships visible_membership
      join public.family_membership_revisions visible_membership_revision
        on visible_membership_revision.id = visible_membership.current_revision_id
      join public.people visible_person on visible_person.id = visible_membership.person_id
      join public.person_revisions visible_person_revision
        on visible_person_revision.id = visible_person.current_revision_id
      where visible_membership.family_id = proposal.source_family_id
        and visible_membership_revision.status = 'approved'
        and visible_person_revision.status = 'approved'
        and visible_person_revision.privacy = 'public'
    )
$$;

alter function public.moderate_family_submission(uuid, text, text)
  rename to moderate_family_edit_submission;

create function public.moderate_family_submission(
  p_submission_id uuid, p_decision text, p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.family_creation_proposals%rowtype;
  v_submission public.submissions%rowtype;
  v_reviewer uuid := auth.uid();
  v_now timestamptz := now();
  v_family_id uuid;
  v_membership_id uuid;
  v_revision_id uuid;
begin
  select * into v_proposal from public.family_creation_proposals
  where submission_id = p_submission_id;
  if not found then
    return public.moderate_family_edit_submission(p_submission_id, p_decision, p_review_note);
  end if;
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000
     or (p_decision = 'reject' and nullif(btrim(p_review_note), '') is null) then
    raise exception 'invalid moderation request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family-submission-moderation'));
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.status <> 'pending' then
    raise exception 'submission is already %', v_submission.status;
  end if;
  if p_decision = 'reject' then
    update public.submissions set status = 'rejected', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = btrim(p_review_note) where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
  end if;

  if exists (select 1 from public.families where slug = v_proposal.slug)
     or not exists (
       select 1 from public.family_memberships m
       join public.family_membership_revisions mr on mr.id = m.current_revision_id
       join public.people p on p.id = m.person_id
       join public.person_revisions pr on pr.id = p.current_revision_id
       where m.family_id = v_proposal.source_family_id
         and m.person_id = v_proposal.root_person_id
         and mr.status = 'approved' and pr.status = 'approved' and pr.privacy = 'public'
     ) then
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '')
    where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict');
  end if;

  v_family_id := pg_catalog.gen_random_uuid();
  v_membership_id := pg_catalog.gen_random_uuid();
  v_revision_id := pg_catalog.gen_random_uuid();
  insert into public.families (id, slug, name, root_person_id)
  values (v_family_id, v_proposal.slug, v_proposal.name, v_proposal.root_person_id);
  insert into public.family_memberships (id, family_id, person_id)
  values (v_membership_id, v_family_id, v_proposal.root_person_id);
  insert into public.family_membership_revisions (
    id, family_membership_id, submission_id, status, reviewed_at, reviewed_by,
    person_id, family_id
  ) values (
    v_revision_id, v_membership_id, p_submission_id, 'approved', v_now, v_reviewer,
    v_proposal.root_person_id, v_family_id
  );
  update public.family_memberships set current_revision_id = v_revision_id
  where id = v_membership_id;
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '')
  where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

create or replace function public.list_pending_admin_submissions(
  p_limit integer default 25,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_limit < 1 or p_limit > 100 or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception 'invalid review pagination';
  end if;
  with page as (
    select s.id, s.created_at, s.status, s.family_id, f.slug family_slug, f.name family_name,
      s.message, s.submitter_name,
      (select count(*) from public.person_revisions r where r.submission_id = s.id)
      + (select count(*) from public.life_event_revisions r where r.submission_id = s.id)
      + (select count(*) from public.partnership_revisions r where r.submission_id = s.id)
      + (select count(*) from public.parent_link_revisions r where r.submission_id = s.id)
      + (select count(*) from public.family_membership_revisions r where r.submission_id = s.id)
      + (select count(*) from public.media_revisions r where r.submission_id = s.id)
      + (select count(*) from public.sources src where src.submission_id = s.id)
      + (select count(*) from public.family_creation_proposals p where p.submission_id = s.id) entity_count,
      (select p.name from public.family_creation_proposals p where p.submission_id = s.id) proposed_family_name
    from public.submissions s
    join public.families f on f.id = s.family_id
    where s.status = 'pending'
      and (p_after_created_at is null or (s.created_at, s.id) > (p_after_created_at, p_after_id))
    order by s.created_at, s.id limit p_limit + 1
  ), visible as (select * from page order by created_at, id limit p_limit)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(visible) order by created_at, id), '[]'::jsonb),
    'next_cursor', case when (select count(*) from page) > p_limit then (
      select jsonb_build_object('created_at', created_at, 'id', id)
      from visible order by created_at desc, id desc limit 1
    ) end
  ) into v_result from visible;
  return v_result;
end;
$$;

create or replace function public.get_admin_submission(p_submission_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  select jsonb_build_object(
    'submission', to_jsonb(s) - array['idempotency_actor_digest', 'request_hash'],
    'family', jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name),
    'family_creation', (select jsonb_build_object(
      'id', p.id, 'slug', p.slug, 'name', p.name,
      'source_family', jsonb_build_object('id', f.id, 'slug', f.slug, 'name', f.name),
      'root_person', jsonb_build_object('id', person.id, 'display_name', revision.display_name)
    ) from public.family_creation_proposals p
      join public.people person on person.id = p.root_person_id
      join public.person_revisions revision on revision.id = person.current_revision_id
      where p.submission_id = s.id),
    'people', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.person_revisions r join public.people e on e.id = r.person_id left join public.person_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id left join public.person_revisions c on c.person_id = r.person_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.life_event_revisions r join public.life_events e on e.id = r.life_event_id left join public.life_event_revisions b on b.life_event_id = r.life_event_id and b.id = r.base_revision_id left join public.life_event_revisions c on c.life_event_id = r.life_event_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'partnerships', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.partnership_revisions r join public.partnerships e on e.id = r.partnership_id left join public.partnership_revisions b on b.partnership_id = r.partnership_id and b.id = r.base_revision_id left join public.partnership_revisions c on c.partnership_id = r.partnership_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'parent_links', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.parent_link_revisions r join public.parent_links e on e.id = r.parent_link_id left join public.parent_link_revisions b on b.parent_link_id = r.parent_link_id and b.id = r.base_revision_id left join public.parent_link_revisions c on c.parent_link_id = r.parent_link_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.family_membership_revisions r join public.family_memberships e on e.id = r.family_membership_id left join public.family_membership_revisions b on b.family_membership_id = r.family_membership_id and b.id = r.base_revision_id left join public.family_membership_revisions c on c.family_membership_id = r.family_membership_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', null, 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.media_revisions r left join public.media_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id where r.submission_id = s.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('base', null, 'current', null, 'proposed', to_jsonb(src)) order by src.created_at, src.id), '[]'::jsonb) from public.sources src where src.submission_id = s.id)
  ) into v_result from public.submissions s join public.families f on f.id = s.family_id
  where s.id = p_submission_id;
  if v_result is null then raise exception 'submission not found'; end if;
  return v_result;
end;
$$;

revoke all on function public.submit_family_creation(uuid, uuid, uuid, text, text, text) from public;
revoke all on function public.list_family_creation_proposals(uuid[]) from public;
revoke all on function public.moderate_family_edit_submission(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.moderate_family_submission(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.submit_family_creation(uuid, uuid, uuid, text, text, text) to anon, authenticated;
grant execute on function public.list_family_creation_proposals(uuid[]) to anon, authenticated;
