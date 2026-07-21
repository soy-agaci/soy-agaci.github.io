create or replace function public.moderate_family_submission(
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
  if exists (select 1 from public.people where id in (v_proposal.source_person_id, v_proposal.target_person_id)
      and merged_into_person_id is not null) then
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict', 'conflict_reason', 'already_merged');
  end if;
  if not exists (select 1 from public.people where id = v_proposal.source_person_id
      and current_revision_id = v_proposal.source_base_revision_id)
     or not exists (select 1 from public.people where id = v_proposal.target_person_id
      and current_revision_id = v_proposal.target_base_revision_id) then
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict', 'conflict_reason', 'people_changed');
  end if;
  perform public.admin_unify_person_resolved(v_proposal.source_person_id, v_proposal.target_person_id, v_proposal.fields);
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = auth.uid(), review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

revoke all on function public.moderate_family_submission(uuid, text, text) from public, anon, authenticated, service_role;
