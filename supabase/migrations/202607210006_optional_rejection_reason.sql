create or replace function public.moderate_family_submission(
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
begin
  select * into v_proposal from public.family_creation_proposals where submission_id = p_submission_id;
  if not found then return public.moderate_family_edit_submission(p_submission_id, p_decision, p_review_note); end if;
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000 then
    raise exception 'invalid moderation request';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('family-submission-moderation'));
  select * into v_submission from public.submissions where id = p_submission_id for update;
  if v_submission.status <> 'pending' then raise exception 'submission is already %', v_submission.status; end if;
  if p_decision = 'reject' then
    update public.submissions set status = 'rejected', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'rejected');
  end if;
  if exists (select 1 from public.families where slug = v_proposal.slug)
     or not exists (
       select 1 from public.family_memberships m
       join public.family_membership_revisions mr on mr.id = m.current_revision_id
       join public.people p on p.id = m.person_id
       join public.person_revisions pr on pr.id = p.current_revision_id
       where m.family_id = v_proposal.source_family_id and m.person_id = v_proposal.root_person_id
         and mr.status = 'approved' and pr.status = 'approved' and pr.privacy = 'public'
     ) then
    update public.submissions set status = 'conflict', updated_at = v_now, reviewed_at = v_now,
      reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
    return jsonb_build_object('submission_id', p_submission_id, 'status', 'conflict');
  end if;
  v_family_id := pg_catalog.gen_random_uuid();
  insert into public.families (id, slug, name, root_person_id) values (v_family_id, v_proposal.slug, v_proposal.name, null);
  perform public.add_paternal_lineage_members(v_family_id, v_proposal.root_person_id, p_submission_id);
  perform public.add_family_tree_members(v_family_id, v_proposal.source_family_id, v_proposal.root_person_id,
    p_submission_id, v_reviewer, v_now);
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '') where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;
