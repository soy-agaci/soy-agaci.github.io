create function public.get_family_graph(
  p_family_ids uuid[],
  p_include_pending boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
with
requested_families as (
  select distinct requested.id
  from unnest(coalesce(p_family_ids, '{}'::uuid[])) as requested(id)
),
selected_memberships as (
  select m.*
  from public.family_memberships m
  join requested_families rf on rf.id = m.family_id
  where m.current_revision_id is not null
     or (p_include_pending and exists (
       select 1
       from public.family_membership_revisions r
       where r.family_membership_id = m.id and r.status = 'pending'
     ))
),
membership_people as (
  select distinct selected.person_id
  from (
    select m.person_id
    from selected_memberships m
    where m.current_revision_id is not null
    union all
    select r.person_id
    from public.family_membership_revisions r
    join requested_families rf on rf.id = r.family_id
    where p_include_pending and r.status = 'pending'
  ) selected
),
visible_people as (
  select candidate.person_id
  from membership_people candidate
  join public.people p on p.id = candidate.person_id
  where exists (
      select 1
      from public.person_revisions r
      where r.id = p.current_revision_id and r.privacy = 'public'
    )
    or (p_include_pending and exists (
      select 1
      from public.person_revisions r
      where r.person_id = p.id and r.status = 'pending' and r.privacy = 'public'
    ))
),
visible_memberships as (
  select m.*
  from selected_memberships m
  join visible_people p on p.person_id = m.person_id
),
selected_life_events as (
  select e.*
  from public.life_events e
  join visible_people p on p.person_id = e.person_id
  where e.current_revision_id is not null
     or (p_include_pending and exists (
       select 1 from public.life_event_revisions r
       where r.life_event_id = e.id and r.status = 'pending'
     ))
),
selected_partnerships as (
  select r.*
  from public.partnerships r
  join visible_people p1 on p1.person_id = r.person1_id
  join visible_people p2 on p2.person_id = r.person2_id
  where r.current_revision_id is not null
     or (p_include_pending and exists (
       select 1 from public.partnership_revisions revision
       where revision.partnership_id = r.id and revision.status = 'pending'
     ))
),
selected_parent_links as (
  select r.*
  from public.parent_links r
  join visible_people p1 on p1.person_id = r.parent_id
  join visible_people p2 on p2.person_id = r.child_id
  where r.current_revision_id is not null
     or (p_include_pending and exists (
       select 1 from public.parent_link_revisions revision
       where revision.parent_link_id = r.id and revision.status = 'pending'
     ))
),
pending_submission_ids as (
  select r.submission_id
  from public.family_membership_revisions r
  join visible_memberships m on m.id = r.family_membership_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union
  select r.submission_id
  from public.person_revisions r
  join visible_people p on p.person_id = r.person_id
  where p_include_pending and r.status = 'pending' and r.privacy = 'public'
    and r.submission_id is not null
  union
  select r.submission_id
  from public.life_event_revisions r
  join selected_life_events e on e.id = r.life_event_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union
  select r.submission_id
  from public.partnership_revisions r
  join selected_partnerships e on e.id = r.partnership_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union
  select r.submission_id
  from public.parent_link_revisions r
  join selected_parent_links e on e.id = r.parent_link_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union
  select r.submission_id
  from public.media_revisions r
  join visible_people p on p.person_id = r.person_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
)
select jsonb_build_object(
  'families', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'slug', f.slug, 'name', f.name, 'created_at', f.created_at
    ) order by f.id)
    from public.families f
    join requested_families rf on rf.id = f.id
  ), '[]'::jsonb),
  'people', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', p.id,
      'created_at', p.created_at,
      'current_revision', case when current.id is null then null else jsonb_build_object(
        'id', current.id, 'submission_id', current.submission_id,
        'base_revision_id', current.base_revision_id, 'status', current.status,
        'created_at', current.created_at, 'reviewed_at', current.reviewed_at,
        'given_name', current.given_name, 'middle_names', current.middle_names,
        'family_name', current.family_name, 'display_name', current.display_name,
        'aliases', current.aliases, 'gender', current.gender,
        'is_living', current.is_living, 'summary', current.summary,
        'privacy', current.privacy
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
          'given_name', r.given_name, 'middle_names', r.middle_names,
          'family_name', r.family_name, 'display_name', r.display_name,
          'aliases', r.aliases, 'gender', r.gender, 'is_living', r.is_living,
          'summary', r.summary, 'privacy', r.privacy
        ) order by r.created_at, r.id)
        from public.person_revisions r
        where p_include_pending and r.person_id = p.id
          and r.status = 'pending' and r.privacy = 'public'
      ), '[]'::jsonb)
    ) order by p.id)
    from public.people p
    join visible_people visible on visible.person_id = p.id
    left join public.person_revisions current
      on current.id = p.current_revision_id and current.privacy = 'public'
  ), '[]'::jsonb),
  'life_events', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'person_id', e.person_id, 'created_at', e.created_at,
      'current_revision', case when current.id is null then null else jsonb_build_object(
        'id', current.id, 'submission_id', current.submission_id,
        'base_revision_id', current.base_revision_id, 'status', current.status,
        'created_at', current.created_at, 'reviewed_at', current.reviewed_at,
        'event_type', current.event_type, 'date_start', current.date_start,
        'date_end', current.date_end, 'date_text', current.date_text,
        'place_text', current.place_text, 'details', current.details,
        'certainty', current.certainty
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
          'event_type', r.event_type, 'date_start', r.date_start,
          'date_end', r.date_end, 'date_text', r.date_text,
          'place_text', r.place_text, 'details', r.details,
          'certainty', r.certainty
        ) order by r.created_at, r.id)
        from public.life_event_revisions r
        where p_include_pending and r.life_event_id = e.id and r.status = 'pending'
      ), '[]'::jsonb)
    ) order by e.id)
    from selected_life_events e
    left join public.life_event_revisions current on current.id = e.current_revision_id
  ), '[]'::jsonb),
  'partnerships', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'person1_id', e.person1_id, 'person2_id', e.person2_id,
      'created_at', e.created_at,
      'current_revision', case when current.id is null then null else jsonb_build_object(
        'id', current.id, 'submission_id', current.submission_id,
        'base_revision_id', current.base_revision_id, 'status', current.status,
        'created_at', current.created_at, 'reviewed_at', current.reviewed_at,
        'partnership_type', current.partnership_type,
        'date_start', current.date_start, 'date_end', current.date_end,
        'status_text', current.status_text
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
          'partnership_type', r.partnership_type,
          'date_start', r.date_start, 'date_end', r.date_end,
          'status_text', r.status_text
        ) order by r.created_at, r.id)
        from public.partnership_revisions r
        where p_include_pending and r.partnership_id = e.id and r.status = 'pending'
      ), '[]'::jsonb)
    ) order by e.id)
    from selected_partnerships e
    left join public.partnership_revisions current on current.id = e.current_revision_id
  ), '[]'::jsonb),
  'parent_links', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', e.id, 'parent_id', e.parent_id, 'child_id', e.child_id,
      'created_at', e.created_at,
      'current_revision', case when current.id is null then null else jsonb_build_object(
        'id', current.id, 'submission_id', current.submission_id,
        'base_revision_id', current.base_revision_id, 'status', current.status,
        'created_at', current.created_at, 'reviewed_at', current.reviewed_at,
        'relationship_type', current.relationship_type, 'certainty', current.certainty
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
          'relationship_type', r.relationship_type, 'certainty', r.certainty
        ) order by r.created_at, r.id)
        from public.parent_link_revisions r
        where p_include_pending and r.parent_link_id = e.id and r.status = 'pending'
      ), '[]'::jsonb)
    ) order by e.id)
    from selected_parent_links e
    left join public.parent_link_revisions current on current.id = e.current_revision_id
  ), '[]'::jsonb),
  'memberships', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'family_id', m.family_id, 'person_id', m.person_id,
      'created_at', m.created_at,
      'current_revision', case when current.id is null then null else jsonb_build_object(
        'id', current.id, 'submission_id', current.submission_id,
        'base_revision_id', current.base_revision_id, 'status', current.status,
        'created_at', current.created_at, 'reviewed_at', current.reviewed_at
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at
        ) order by r.created_at, r.id)
        from public.family_membership_revisions r
        where p_include_pending and r.family_membership_id = m.id and r.status = 'pending'
      ), '[]'::jsonb)
    ) order by m.id)
    from visible_memberships m
    left join public.family_membership_revisions current on current.id = m.current_revision_id
  ), '[]'::jsonb),
  'media', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'person_id', r.person_id, 'submission_id', r.submission_id,
      'base_revision_id', r.base_revision_id, 'status', r.status,
      'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
      'storage_path', r.storage_path, 'mime_type', r.mime_type,
      'caption', r.caption
    ) order by r.created_at, r.id)
    from public.media_revisions r
    join visible_people p on p.person_id = r.person_id
    where r.status = 'approved' or (p_include_pending and r.status = 'pending')
  ), '[]'::jsonb),
  'submissions', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'status', s.status, 'created_at', s.created_at,
      'updated_at', s.updated_at, 'reviewed_at', s.reviewed_at
    ) order by s.created_at, s.id)
    from public.submissions s
    join pending_submission_ids pending on pending.submission_id = s.id
  ), '[]'::jsonb)
);
$$;

revoke all on function public.get_family_graph(uuid[], boolean) from public;
grant execute on function public.get_family_graph(uuid[], boolean) to anon, authenticated;
