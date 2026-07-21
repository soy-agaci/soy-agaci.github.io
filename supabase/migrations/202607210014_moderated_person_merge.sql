create table public.person_merge_proposals (
  id uuid primary key default pg_catalog.gen_random_uuid(),
  submission_id uuid not null unique references public.submissions (id) on delete restrict,
  source_person_id uuid not null references public.people (id) on delete restrict,
  target_person_id uuid not null references public.people (id) on delete restrict,
  source_base_revision_id uuid not null,
  target_base_revision_id uuid not null,
  source_fields jsonb not null,
  target_fields jsonb not null,
  fields jsonb not null,
  created_at timestamptz not null default now(),
  constraint person_merge_distinct_people check (source_person_id <> target_person_id),
  foreign key (source_person_id, source_base_revision_id)
    references public.person_revisions (person_id, id),
  foreign key (target_person_id, target_base_revision_id)
    references public.person_revisions (person_id, id)
);

alter table public.person_merge_proposals enable row level security;
revoke all on table public.person_merge_proposals from public, anon, authenticated, service_role;

create function public.person_merge_fields(p_person_id uuid)
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'given_name', revision.given_name, 'middle_names', revision.middle_names,
    'family_name', revision.family_name, 'gender', revision.gender,
    'is_living', revision.is_living, 'summary', revision.summary, 'aliases', revision.aliases,
    'birth_date', (select event_revision.date_text from public.life_events event
      join public.life_event_revisions event_revision on event_revision.id = event.current_revision_id
      where event.person_id = person.id and event_revision.event_type = 'birth' order by event.id limit 1),
    'birthplace', (select event_revision.place_text from public.life_events event
      join public.life_event_revisions event_revision on event_revision.id = event.current_revision_id
      where event.person_id = person.id and event_revision.event_type = 'birth' order by event.id limit 1),
    'death_date', (select event_revision.date_text from public.life_events event
      join public.life_event_revisions event_revision on event_revision.id = event.current_revision_id
      where event.person_id = person.id and event_revision.event_type = 'death' order by event.id limit 1),
    'death_place', (select event_revision.place_text from public.life_events event
      join public.life_event_revisions event_revision on event_revision.id = event.current_revision_id
      where event.person_id = person.id and event_revision.event_type = 'death' order by event.id limit 1),
    'occupation', (select event_revision.details from public.life_events event
      join public.life_event_revisions event_revision on event_revision.id = event.current_revision_id
      where event.person_id = person.id and event_revision.event_type = 'occupation' order by event.id limit 1)
  ) from public.people person
  join public.person_revisions revision on revision.id = person.current_revision_id
  where person.id = p_person_id
$$;
revoke all on function public.person_merge_fields(uuid) from public, anon, authenticated, service_role;

create function public.submit_person_merge(
  p_family_id uuid,
  p_client_request_id uuid,
  p_source_person_id uuid,
  p_target_person_id uuid,
  p_fields jsonb,
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
  v_source_revision uuid;
  v_target_revision uuid;
begin
  if p_family_id is null or p_client_request_id is null or p_source_person_id is null
     or p_target_person_id is null or p_source_person_id = p_target_person_id
     or p_fields is null or jsonb_typeof(p_fields) <> 'object' or octet_length(p_fields::text) > 20000
     or exists (select 1 from jsonb_object_keys(p_fields) key where key not in (
       'given_name', 'middle_names', 'family_name', 'gender', 'is_living', 'summary', 'aliases',
       'birth_date', 'birthplace', 'death_date', 'death_place', 'occupation'))
     or jsonb_typeof(coalesce(p_fields->'aliases', '[]'::jsonb)) <> 'array'
     or jsonb_array_length(coalesce(p_fields->'aliases', '[]'::jsonb)) > 20
     or char_length(coalesce(p_fields->>'given_name', '')) > 200
     or char_length(coalesce(p_fields->>'middle_names', '')) > 300
     or char_length(coalesce(p_fields->>'family_name', '')) > 200
     or char_length(coalesce(p_fields->>'gender', '')) > 50
     or char_length(coalesce(p_fields->>'summary', '')) > 5000
     or char_length(coalesce(p_fields->>'birth_date', '')) > 200
     or char_length(coalesce(p_fields->>'birthplace', '')) > 500
     or char_length(coalesce(p_fields->>'death_date', '')) > 200
     or char_length(coalesce(p_fields->>'death_place', '')) > 500
     or char_length(coalesce(p_fields->>'occupation', '')) > 2000
     or nullif(btrim(concat_ws(' ', p_fields->>'given_name', p_fields->>'middle_names', p_fields->>'family_name')), '') is null
     or (p_fields->'is_living' is not null and jsonb_typeof(p_fields->'is_living') not in ('boolean', 'null'))
     or exists (select 1 from jsonb_array_elements_text(coalesce(p_fields->'aliases', '[]'::jsonb)) alias where char_length(alias) > 200) then
    raise exception 'invalid person merge request';
  end if;
  if v_user_id is null then
    if p_anonymous_actor_secret is null or char_length(p_anonymous_actor_secret) not between 32 and 256 then
      raise exception 'anonymous actor secret must contain 32 to 256 characters';
    end if;
    v_actor_digest := extensions.digest('anonymous:' || p_anonymous_actor_secret, 'sha256');
  else
    v_actor_digest := extensions.digest('authenticated:' || v_user_id::text, 'sha256');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    p_family_id::text || ':' || encode(v_actor_digest, 'hex') || ':' || p_client_request_id::text, 0));
  v_hash := extensions.digest(jsonb_build_object(
    'source', p_source_person_id, 'target', p_target_person_id, 'fields', p_fields)::text, 'sha256');
  select * into v_existing from public.submissions submission
  where submission.family_id = p_family_id and submission.idempotency_actor_digest = v_actor_digest
    and submission.client_request_id = p_client_request_id;
  if found then
    if v_existing.request_hash <> v_hash or not exists (
      select 1 from public.person_merge_proposals where submission_id = v_existing.id
    ) then raise exception 'client_request_id was already used with a different request'; end if;
    return jsonb_build_object('submission_id', v_existing.id, 'status', v_existing.status);
  end if;
  select person.current_revision_id into v_source_revision from public.people person
  join public.person_revisions revision on revision.id = person.current_revision_id
  where person.id = p_source_person_id and person.merged_into_person_id is null
    and revision.status = 'approved' and revision.privacy = 'public';
  select person.current_revision_id into v_target_revision from public.people person
  join public.person_revisions revision on revision.id = person.current_revision_id
  where person.id = p_target_person_id and person.merged_into_person_id is null
    and revision.status = 'approved' and revision.privacy = 'public';
  if v_source_revision is null or v_target_revision is null or not exists (
    select 1 from public.family_memberships membership
    join public.family_membership_revisions revision on revision.id = membership.current_revision_id
    where membership.family_id = p_family_id and revision.status = 'approved'
      and membership.person_id in (p_source_person_id, p_target_person_id)
    group by membership.family_id having count(distinct membership.person_id) = 2
  ) then raise exception 'people are not visible current members of the target family'; end if;
  if exists (
    select 1 from public.person_merge_proposals proposal
    join public.submissions submission on submission.id = proposal.submission_id
    where submission.status = 'pending' and (proposal.source_person_id in (p_source_person_id, p_target_person_id)
      or proposal.target_person_id in (p_source_person_id, p_target_person_id))
  ) then raise exception 'a merge proposal already exists for one of these people'; end if;
  insert into public.submissions (
    id, family_id, client_request_id, idempotency_actor_digest, request_hash, submitter_user_id
  ) values (v_submission_id, p_family_id, p_client_request_id, v_actor_digest, v_hash, v_user_id);
  insert into public.person_merge_proposals (
    submission_id, source_person_id, target_person_id, source_base_revision_id,
    target_base_revision_id, source_fields, target_fields, fields
  ) values (
    v_submission_id, p_source_person_id, p_target_person_id, v_source_revision,
    v_target_revision, public.person_merge_fields(p_source_person_id),
    public.person_merge_fields(p_target_person_id), p_fields
  );
  return jsonb_build_object('submission_id', v_submission_id, 'status', 'pending');
end;
$$;

alter function public.moderate_family_submission(uuid, text, text)
  rename to moderate_family_nonmerge_submission;

create function public.moderate_family_submission(
  p_submission_id uuid, p_decision text, p_review_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_proposal public.person_merge_proposals%rowtype;
  v_submission public.submissions%rowtype;
  v_now timestamptz := now();
begin
  select * into v_proposal from public.person_merge_proposals where submission_id = p_submission_id;
  if not found then return public.moderate_family_nonmerge_submission(p_submission_id, p_decision, p_review_note); end if;
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000 then
    raise exception 'invalid moderation request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family-submission-moderation'));
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.status <> 'pending' then raise exception 'submission is already %', v_submission.status; end if;
  if p_decision = 'reject' then
    update public.submissions set status = 'rejected', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
  end if;
  if not exists (select 1 from public.people where id = v_proposal.source_person_id
      and current_revision_id = v_proposal.source_base_revision_id and merged_into_person_id is null)
     or not exists (select 1 from public.people where id = v_proposal.target_person_id
      and current_revision_id = v_proposal.target_base_revision_id and merged_into_person_id is null) then
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict');
  end if;
  perform public.admin_unify_person_resolved(
    v_proposal.source_person_id, v_proposal.target_person_id, v_proposal.fields);
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

create or replace function public.approve_family_submission(p_submission_id uuid, p_review_note text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select public.moderate_family_submission(p_submission_id, 'approve', p_review_note) $$;
create or replace function public.reject_family_submission(p_submission_id uuid, p_review_note text default null)
returns jsonb language sql security definer set search_path = ''
as $$ select public.moderate_family_submission(p_submission_id, 'reject', p_review_note) $$;

create or replace function public.list_pending_admin_submissions(
  p_limit integer default 25, p_after_created_at timestamptz default null, p_after_id uuid default null
)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_limit < 1 or p_limit > 100 or ((p_after_created_at is null) <> (p_after_id is null)) then raise exception 'invalid review pagination'; end if;
  with page as (
    select s.id, s.created_at, s.status, s.family_id, f.slug family_slug, f.name family_name,
      s.message, s.submitter_name,
      (select count(*) from public.person_revisions r left join public.person_revisions base on base.id = r.base_revision_id
       where r.submission_id = s.id and (base.id is null or
         (to_jsonb(r) - array['id','submission_id','base_revision_id','status','created_at','reviewed_at','reviewed_by']) is distinct from
         (to_jsonb(base) - array['id','submission_id','base_revision_id','status','created_at','reviewed_at','reviewed_by'])))
      + (select count(*) from public.life_event_revisions r where r.submission_id = s.id)
      + (select count(*) from public.partnership_revisionS r where r.submission_id = s.id)
      + (select count(*) from public.parent_link_revisions r where r.submission_id = s.id)
      + (select count(*) from public.family_membership_revisions r where r.submission_id = s.id)
      + (select count(*) from public.media_revisions r where r.submission_id = s.id)
      + (select count(*) from public.sources src where src.submission_id = s.id)
      + (select count(*) from public.family_creation_proposals p where p.submission_id = s.id)
      + (select count(*) from public.person_merge_proposals p where p.submission_id = s.id) entity_count,
      coalesce((select p.name from public.family_creation_proposals p where p.submission_id = s.id),
        case when exists (select 1 from public.person_merge_proposals p where p.submission_id = s.id) then 'Kişi birleştirme' end) proposed_family_name
    from public.submissions s join public.families f on f.id = s.family_id
    where s.status = 'pending' and (p_after_created_at is null or (s.created_at, s.id) > (p_after_created_at, p_after_id))
    order by s.created_at, s.id limit p_limit + 1
  ), visible as (select * from page order by created_at, id limit p_limit)
  select jsonb_build_object('items', coalesce(jsonb_agg(to_jsonb(visible) order by created_at, id), '[]'::jsonb),
    'next_cursor', case when (select count(*) from page) > p_limit then (
      select jsonb_build_object('created_at', created_at, 'id', id) from visible order by created_at desc, id desc limit 1) end)
  into v_result from visible;
  return v_result;
end;
$$;

do $migration$
declare definition text; patched text;
begin
  definition := pg_catalog.pg_get_functiondef('public.get_admin_submission(uuid)'::regprocedure);
  patched := replace(definition, $find$    'people', ($find$,
    $replace$    'person_merge', (select jsonb_build_object(
      'id', proposal.id, 'fields', proposal.fields,
      'source_fields', proposal.source_fields, 'target_fields', proposal.target_fields,
      'source_person', jsonb_build_object('id', proposal.source_person_id, 'revision', to_jsonb(source_revision)),
      'target_person', jsonb_build_object('id', proposal.target_person_id, 'revision', to_jsonb(target_revision))
    ) from public.person_merge_proposals proposal
      join public.person_revisions source_revision on source_revision.id = proposal.source_base_revision_id
      join public.person_revisions target_revision on target_revision.id = proposal.target_base_revision_id
      where proposal.submission_id = s.id),
    'people', ($replace$);
  if patched = definition then raise exception 'get_admin_submission insertion point was not found'; end if;
  execute patched;
end;
$migration$;

revoke all on function public.submit_person_merge(uuid, uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.submit_person_merge(uuid, uuid, uuid, uuid, jsonb, text) to anon, authenticated;
revoke all on function public.moderate_family_nonmerge_submission(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.moderate_family_submission(uuid, text, text) from public, anon, authenticated, service_role;
grant execute on function public.approve_family_submission(uuid, text) to authenticated;
grant execute on function public.reject_family_submission(uuid, text) to authenticated;
