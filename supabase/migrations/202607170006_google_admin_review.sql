create or replace function public.is_google_identity()
returns boolean
language sql
stable
set search_path = ''
as $$
  select auth.role() = 'authenticated'
    and auth.uid() is not null
    and auth.jwt()->'app_metadata'->>'provider' = 'google'
    and coalesce(auth.jwt()->'app_metadata'->'providers', '[]'::jsonb) ? 'google'
$$;

create or replace function public.is_google_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_google_identity() and exists (
    select 1 from public.admins
    where user_id = auth.uid() and is_active
  )
$$;

revoke all on function public.is_google_identity() from public, anon, authenticated, service_role;
revoke all on function public.is_google_admin() from public, anon, authenticated, service_role;

create or replace function public.get_admin_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_admin public.admins%rowtype;
begin
  if not public.is_google_identity() then
    raise exception 'Google authentication required';
  end if;
  select * into v_admin from public.admins where user_id = auth.uid();
  return jsonb_build_object(
    'user_id', auth.uid(),
    'email', auth.jwt()->>'email',
    'name', auth.jwt()->'user_metadata'->>'full_name',
    'avatar_url', auth.jwt()->'user_metadata'->>'avatar_url',
    'is_admin', coalesce(v_admin.is_active, false),
    'admin_created_at', v_admin.created_at
  );
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
      + (select count(*) from public.sources src where src.submission_id = s.id) entity_count
    from public.submissions s
    join public.families f on f.id = s.family_id
    where s.status = 'pending'
      and (p_after_created_at is null or (s.created_at, s.id) > (p_after_created_at, p_after_id))
    order by s.created_at, s.id
    limit p_limit + 1
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
    'people', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.person_revisions r join public.people e on e.id = r.person_id left join public.person_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id left join public.person_revisions c on c.person_id = r.person_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.life_event_revisions r join public.life_events e on e.id = r.life_event_id left join public.life_event_revisions b on b.life_event_id = r.life_event_id and b.id = r.base_revision_id left join public.life_event_revisions c on c.life_event_id = r.life_event_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'partnerships', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.partnership_revisions r join public.partnerships e on e.id = r.partnership_id left join public.partnership_revisions b on b.partnership_id = r.partnership_id and b.id = r.base_revision_id left join public.partnership_revisions c on c.partnership_id = r.partnership_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'parent_links', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.parent_link_revisions r join public.parent_links e on e.id = r.parent_link_id left join public.parent_link_revisions b on b.parent_link_id = r.parent_link_id and b.id = r.base_revision_id left join public.parent_link_revisions c on c.parent_link_id = r.parent_link_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'memberships', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', to_jsonb(c), 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.family_membership_revisions r join public.family_memberships e on e.id = r.family_membership_id left join public.family_membership_revisions b on b.family_membership_id = r.family_membership_id and b.id = r.base_revision_id left join public.family_membership_revisions c on c.family_membership_id = r.family_membership_id and c.id = e.current_revision_id where r.submission_id = s.id),
    'media', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', null, 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.media_revisions r left join public.media_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id where r.submission_id = s.id),
    'sources', (select coalesce(jsonb_agg(jsonb_build_object('base', null, 'current', null, 'proposed', to_jsonb(src)) order by src.created_at, src.id), '[]'::jsonb) from public.sources src where src.submission_id = s.id)
  ) into v_result
  from public.submissions s join public.families f on f.id = s.family_id
  where s.id = p_submission_id;
  if v_result is null then raise exception 'submission not found'; end if;
  return v_result;
end;
$$;

create or replace function public.moderate_family_submission(
  p_submission_id uuid, p_decision text, p_review_note text default null
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
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000
     or (p_decision = 'reject' and nullif(btrim(p_review_note), '') is null) then
    raise exception 'invalid moderation request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family-submission-moderation'));
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if v_submission.status <> 'pending' then raise exception 'submission is already %', v_submission.status; end if;

  if p_decision = 'reject' then
    update public.person_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.family_membership_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.life_event_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.partnership_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.parent_link_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.media_revisions set status = 'rejected', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.submissions set status = 'rejected', updated_at = v_now, reviewed_at = v_now, reviewed_by = v_reviewer, review_note = btrim(p_review_note) where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
  end if;

  if exists (
    select 1 from public.person_revisions r join public.people e on e.id = r.person_id where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.family_membership_revisions r join public.family_memberships e on e.id = r.family_membership_id where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.life_event_revisions r join public.life_events e on e.id = r.life_event_id where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.partnership_revisions r join public.partnerships e on e.id = r.partnership_id where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
    union all select 1 from public.parent_link_revisions r join public.parent_links e on e.id = r.parent_link_id where r.submission_id = p_submission_id and r.status = 'pending' and r.base_revision_id is distinct from e.current_revision_id
  ) or exists (
    select 1 from public.parent_link_revisions proposed join public.parent_links proposed_link on proposed_link.id = proposed.parent_link_id
    where proposed.submission_id = p_submission_id and proposed.status = 'pending' group by proposed.child_id
    having count(*) filter (where proposed_link.current_revision_id is null) + (select count(*) from public.parent_links current_link where current_link.child_id = proposed.child_id and current_link.current_revision_id is not null) > 2
  ) or exists (
    with recursive edges(parent_id, child_id) as (
      select parent_id, child_id from public.parent_links where current_revision_id is not null
      union select r.parent_id, r.child_id from public.parent_link_revisions r join public.parent_links link on link.id = r.parent_link_id where r.submission_id = p_submission_id and r.status = 'pending' and link.current_revision_id is null
    ), reach(root, node) as (
      select parent_id, child_id from edges union select reach.root, edges.child_id from reach join edges on edges.parent_id = reach.node
    ) select 1 from reach where root = node
  ) then
    update public.person_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.family_membership_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.life_event_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.partnership_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.parent_link_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.media_revisions set status = 'conflict', reviewed_at = v_now, reviewed_by = v_reviewer where submission_id = p_submission_id and status = 'pending';
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now, reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict');
  end if;

  create temporary table if not exists pg_temp.moderation_old_revisions (kind text, entity_id uuid, revision_id uuid) on commit drop;
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
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now, reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

revoke all on function public.get_admin_profile() from public, anon, authenticated, service_role;
revoke all on function public.list_pending_admin_submissions(integer, timestamptz, uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_submission(uuid) from public, anon, authenticated, service_role;
revoke all on function public.moderate_family_submission(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.approve_family_submission(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.reject_family_submission(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_profile() to authenticated;
grant execute on function public.list_pending_admin_submissions(integer, timestamptz, uuid) to authenticated;
grant execute on function public.get_admin_submission(uuid) to authenticated;
grant execute on function public.approve_family_submission(uuid, text) to authenticated;
grant execute on function public.reject_family_submission(uuid, text) to authenticated;
