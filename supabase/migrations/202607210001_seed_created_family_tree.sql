create or replace function public.add_family_tree_members(
  p_family_id uuid,
  p_source_family_id uuid,
  p_root_person_id uuid,
  p_submission_id uuid,
  p_reviewer uuid,
  p_reviewed_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_person_id uuid;
  v_membership_id uuid;
  v_current_revision_id uuid;
  v_revision_id uuid;
begin
  for v_person_id in
    with recursive paternal_ancestors(person_id) as (
      select p_root_person_id
      union
      select link.parent_id
      from paternal_ancestors child
      join public.parent_links link on link.child_id = child.person_id
      join public.parent_link_revisions link_revision on link_revision.id = link.current_revision_id
      join public.people parent on parent.id = link.parent_id
      join public.person_revisions parent_revision on parent_revision.id = parent.current_revision_id
      where link_revision.status = 'approved'
        and lower(coalesce(parent_revision.gender, '')) in ('male', 'm', 'erkek', 'e')
    ), descendants(person_id) as (
      select person_id from paternal_ancestors
      union
      select link.child_id
      from descendants parent
      join public.parent_links link on link.parent_id = parent.person_id
      join public.parent_link_revisions revision on revision.id = link.current_revision_id
      where revision.status = 'approved'
    ), related(person_id) as (
      select person_id from descendants
      union
      select case when partnership.person1_id = descendant.person_id
        then partnership.person2_id else partnership.person1_id end
      from descendants descendant
      join public.partnerships partnership
        on descendant.person_id in (partnership.person1_id, partnership.person2_id)
      join public.partnership_revisions revision on revision.id = partnership.current_revision_id
      where revision.status = 'approved'
      union
      select link.parent_id
      from descendants descendant
      join public.parent_links link on link.child_id = descendant.person_id
      join public.parent_link_revisions revision on revision.id = link.current_revision_id
      where revision.status = 'approved'
    )
    select distinct related.person_id
    from related
    left join public.family_memberships source_membership
      on source_membership.family_id = p_source_family_id
      and source_membership.person_id = related.person_id
    left join public.family_membership_revisions source_revision
      on source_revision.id = source_membership.current_revision_id
    join public.people person on person.id = related.person_id
    join public.person_revisions person_revision on person_revision.id = person.current_revision_id
    where (p_source_family_id is null or source_revision.status = 'approved')
      and person_revision.status = 'approved'
      and person_revision.privacy = 'public'
  loop
    select id, current_revision_id into v_membership_id, v_current_revision_id
    from public.family_memberships
    where family_id = p_family_id and person_id = v_person_id;

    if not found then
      v_membership_id := pg_catalog.gen_random_uuid();
      insert into public.family_memberships (id, family_id, person_id)
      values (v_membership_id, p_family_id, v_person_id);
    elsif v_current_revision_id is not null then
      continue;
    end if;

    v_revision_id := pg_catalog.gen_random_uuid();
    insert into public.family_membership_revisions (
      id, family_membership_id, submission_id, status, reviewed_at, reviewed_by,
      person_id, family_id
    ) values (
      v_revision_id, v_membership_id, p_submission_id, 'approved', p_reviewed_at,
      p_reviewer, v_person_id, p_family_id
    );
    update public.family_memberships set current_revision_id = v_revision_id
    where id = v_membership_id;
  end loop;
end;
$$;

revoke all on function public.add_family_tree_members(
  uuid, uuid, uuid, uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

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
  insert into public.families (id, slug, name, root_person_id)
  values (v_family_id, v_proposal.slug, v_proposal.name, null);
  perform public.add_paternal_lineage_members(v_family_id, v_proposal.root_person_id, p_submission_id);
  perform public.add_family_tree_members(
    v_family_id, v_proposal.source_family_id, v_proposal.root_person_id,
    p_submission_id, v_reviewer, v_now
  );
  update public.submissions set status = 'approved', updated_at = v_now, reviewed_at = v_now,
    reviewed_by = v_reviewer, review_note = nullif(btrim(p_review_note), '')
  where id = p_submission_id;
  return jsonb_build_object('submission_id', p_submission_id, 'status', 'approved');
end;
$$;

do $$
declare
  creation record;
begin
  for creation in
    select family.id family_id, proposal.source_family_id, proposal.root_person_id,
      proposal.submission_id, submission.reviewed_by, submission.reviewed_at
    from public.family_creation_proposals proposal
    join public.submissions submission on submission.id = proposal.submission_id
    join public.families family
      on family.slug = proposal.slug and family.root_person_id = proposal.root_person_id
    where submission.status = 'approved'
  loop
    perform public.add_family_tree_members(
      creation.family_id, creation.source_family_id, creation.root_person_id,
      creation.submission_id, creation.reviewed_by, creation.reviewed_at
    );
  end loop;
end;
$$;
