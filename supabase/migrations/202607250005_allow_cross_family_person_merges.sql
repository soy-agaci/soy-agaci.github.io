create or replace function public.submit_person_merge(
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
  ) then raise exception 'neither person is visible in the target family'; end if;
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

revoke all on function public.submit_person_merge(uuid, uuid, uuid, uuid, jsonb, text) from public;
grant execute on function public.submit_person_merge(uuid, uuid, uuid, uuid, jsonb, text) to anon, authenticated;
