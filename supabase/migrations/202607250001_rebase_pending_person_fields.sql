-- Concurrent person edits keep their own changed columns and inherit approved columns.
alter function public.moderate_family_nonmerge_submission(uuid, text, text)
  rename to moderate_family_nonmerge_submission_base;

create function public.moderate_family_nonmerge_submission(
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
  v_pending public.person_revisions%rowtype;
  v_current public.person_revisions%rowtype;
  v_pending_event public.life_event_revisions%rowtype;
  v_current_event public.life_event_revisions%rowtype;
  v_rebased_id uuid;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000 then
    raise exception 'invalid moderation request';
  end if;
  if p_decision <> 'approve' then
    return public.moderate_family_nonmerge_submission_base(p_submission_id, p_decision, p_review_note);
  end if;

  -- ponytail: moderation is infrequent; retain the existing global lock for shared-family consistency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family-submission-moderation'));
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if not found then raise exception 'submission not found'; end if;
  if v_submission.status <> 'pending' then raise exception 'submission is already %', v_submission.status; end if;

  for v_pending in
    select pending.*
    from public.person_revisions pending
    join public.people person on person.id = pending.person_id
    where pending.submission_id = p_submission_id and pending.status = 'pending'
      and pending.base_revision_id is not null
      and pending.base_revision_id is distinct from person.current_revision_id
  loop
    select * into v_current from public.person_revisions where id = (
      select current_revision_id from public.people where id = v_pending.person_id
    );
    v_rebased_id := pg_catalog.gen_random_uuid();
    insert into public.person_revisions (
      id, person_id, base_revision_id, status, reviewed_at, reviewed_by,
      given_name, middle_names, family_name, display_name, aliases, gender, is_living, summary, privacy
    ) values (
      v_rebased_id, v_pending.person_id, v_current.id, 'approved', v_now, v_reviewer,
      case when v_pending.given_name is distinct from (select given_name from public.person_revisions where id = v_pending.base_revision_id) then v_pending.given_name else v_current.given_name end,
      case when v_pending.middle_names is distinct from (select middle_names from public.person_revisions where id = v_pending.base_revision_id) then v_pending.middle_names else v_current.middle_names end,
      case when v_pending.family_name is distinct from (select family_name from public.person_revisions where id = v_pending.base_revision_id) then v_pending.family_name else v_current.family_name end,
      case when v_pending.display_name is distinct from (select display_name from public.person_revisions where id = v_pending.base_revision_id) then v_pending.display_name else v_current.display_name end,
      case when v_pending.aliases is distinct from (select aliases from public.person_revisions where id = v_pending.base_revision_id) then v_pending.aliases else v_current.aliases end,
      case when v_pending.gender is distinct from (select gender from public.person_revisions where id = v_pending.base_revision_id) then v_pending.gender else v_current.gender end,
      case when v_pending.is_living is distinct from (select is_living from public.person_revisions where id = v_pending.base_revision_id) then v_pending.is_living else v_current.is_living end,
      case when v_pending.summary is distinct from (select summary from public.person_revisions where id = v_pending.base_revision_id) then v_pending.summary else v_current.summary end,
      case when v_pending.privacy is distinct from (select privacy from public.person_revisions where id = v_pending.base_revision_id) then v_pending.privacy else v_current.privacy end
    );
    update public.person_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where id = v_pending.id;
    update public.person_revisions set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer where id in (v_pending.id, v_current.id);
    update public.people set current_revision_id = v_rebased_id where id = v_pending.person_id;
  end loop;

  for v_pending_event in
    select pending.*
    from public.life_event_revisions pending
    join public.life_events event on event.id = pending.life_event_id
    where pending.submission_id = p_submission_id and pending.status = 'pending'
      and pending.base_revision_id is not null
      and pending.base_revision_id is distinct from event.current_revision_id
  loop
    select * into v_current_event from public.life_event_revisions where id = (
      select current_revision_id from public.life_events where id = v_pending_event.life_event_id
    );
    v_rebased_id := pg_catalog.gen_random_uuid();
    insert into public.life_event_revisions (
      id, life_event_id, base_revision_id, status, reviewed_at, reviewed_by,
      event_type, date_start, date_end, date_text, place_text, details, certainty
    ) values (
      v_rebased_id, v_pending_event.life_event_id, v_current_event.id, 'approved', v_now, v_reviewer,
      case when v_pending_event.event_type is distinct from (select event_type from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.event_type else v_current_event.event_type end,
      case when v_pending_event.date_start is distinct from (select date_start from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.date_start else v_current_event.date_start end,
      case when v_pending_event.date_end is distinct from (select date_end from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.date_end else v_current_event.date_end end,
      case when v_pending_event.date_text is distinct from (select date_text from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.date_text else v_current_event.date_text end,
      case when v_pending_event.place_text is distinct from (select place_text from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.place_text else v_current_event.place_text end,
      case when v_pending_event.details is distinct from (select details from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.details else v_current_event.details end,
      case when v_pending_event.certainty is distinct from (select certainty from public.life_event_revisions where id = v_pending_event.base_revision_id) then v_pending_event.certainty else v_current_event.certainty end
    );
    update public.life_event_revisions set status = 'approved', reviewed_at = v_now, reviewed_by = v_reviewer where id = v_pending_event.id;
    update public.life_event_revisions set status = 'superseded', reviewed_at = v_now, reviewed_by = v_reviewer where id in (v_pending_event.id, v_current_event.id);
    update public.life_events set current_revision_id = v_rebased_id where id = v_pending_event.life_event_id;
  end loop;

  return public.moderate_family_nonmerge_submission_base(p_submission_id, p_decision, p_review_note);
end;
$$;

revoke all on function public.moderate_family_nonmerge_submission_base(uuid, text, text) from public, anon, authenticated, service_role;
revoke all on function public.moderate_family_nonmerge_submission(uuid, text, text) from public, anon, authenticated, service_role;
