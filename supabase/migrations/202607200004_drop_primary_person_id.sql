-- Migration: Drop primary_person_id column from partnership_revisions
-- Spousal / primary status is computed dynamically in the application view layer based on active family root/lineage.

alter table public.partnership_revisions
  drop column if exists primary_person_id;

-- Update get_family_graph to remove primary_person_id from partnership JSON payload
create or replace function public.get_family_graph(
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
  where exists (
    select 1
    from public.family_memberships membership
    join public.family_membership_revisions membership_revision
      on membership_revision.id = membership.current_revision_id
      and membership_revision.status = 'approved'
    join public.people person on person.id = membership.person_id
    join public.person_revisions person_revision
      on person_revision.id = person.current_revision_id
      and person_revision.status = 'approved'
      and person_revision.privacy = 'public'
    where membership.family_id = requested.id
  )
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
selected_memberships_final as (
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
  select r.submission_id from public.family_membership_revisions r
  join selected_memberships_final m on m.id = r.family_membership_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union select r.submission_id from public.person_revisions r
  join visible_people p on p.person_id = r.person_id
  where p_include_pending and r.status = 'pending' and r.privacy = 'public' and r.submission_id is not null
  union select r.submission_id from public.life_event_revisions r
  join selected_life_events e on e.id = r.life_event_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union select r.submission_id from public.partnership_revisions r
  join selected_partnerships e on e.id = r.partnership_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union select r.submission_id from public.parent_link_revisions r
  join selected_parent_links e on e.id = r.parent_link_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
  union select r.submission_id from public.media_revisions r
  join visible_people p on p.person_id = r.person_id
  where p_include_pending and r.status = 'pending' and r.submission_id is not null
)
select jsonb_build_object(
  'families', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', f.id, 'slug', f.slug, 'name', f.name,
      'root_person_id', case when exists (
        select 1 from visible_people visible where visible.person_id = f.root_person_id
      ) then f.root_person_id else null end,
      'created_at', f.created_at
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
          'aliases', r.aliases, 'gender', r.gender,
          'is_living', r.is_living, 'summary', r.summary,
          'privacy', r.privacy
        ) order by r.created_at, r.id)
        from public.person_revisions r
        where p_include_pending and r.person_id = p.id and r.status = 'pending' and r.privacy = 'public'
      ), '[]'::jsonb)
    ) order by p.id)
    from visible_people vp
    join public.people p on p.id = vp.person_id
    left join public.person_revisions current on current.id = p.current_revision_id
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
        'date_text', current.date_text, 'status_text', current.status_text
      ) end,
      'pending_revisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', r.id, 'submission_id', r.submission_id,
          'base_revision_id', r.base_revision_id, 'status', r.status,
          'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
          'partnership_type', r.partnership_type,
          'date_start', r.date_start, 'date_end', r.date_end,
          'date_text', r.date_text, 'status_text', r.status_text
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
    from selected_memberships_final m
    left join public.family_membership_revisions current on current.id = m.current_revision_id
  ), '[]'::jsonb),
  'media', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'person_id', r.person_id, 'submission_id', r.submission_id,
      'base_revision_id', r.base_revision_id, 'status', r.status,
      'created_at', r.created_at, 'reviewed_at', r.reviewed_at,
      'storage_path', r.storage_path, 'legacy_uri', r.legacy_uri, 'mime_type', r.mime_type,
      'caption', r.caption
    ) order by r.created_at, r.id)
    from public.media_revisions r
    join visible_people p on p.person_id = r.person_id
    where r.status = 'approved' or (p_include_pending and r.status = 'pending')
  ), '[]'::jsonb),
  'sources', '[]'::jsonb,
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

grant execute on function public.get_family_graph(uuid[], boolean) to anon, authenticated, service_role;

-- Update import_family_sheet to remove primary_person_id handling
drop function if exists public.import_family_sheet(text, text, jsonb);
drop function if exists public.import_family_sheet(jsonb, text, text);

create or replace function public.import_family_sheet(
  p_payload jsonb,
  p_family_slug text,
  p_family_name text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_now timestamptz := now();
  v_root_legacy_id text;
  v_root_person_id uuid;
  v_people_inserted integer := 0;
  v_memberships_inserted integer := 0;
  v_life_events_inserted integer := 0;
  v_partnerships_inserted integer := 0;
  v_parent_links_inserted integer := 0;
  v_media_inserted integer := 0;
  v_existing_person_count integer := 0;
  v_existing_media_count integer := 0;
begin
  if p_family_name is null or trim(p_family_name) = '' then
    raise exception 'family_name is required';
  end if;

  if p_family_slug is null or trim(p_family_slug) = '' then
    raise exception 'family_slug is required';
  end if;

  v_root_legacy_id := p_payload->'family'->>'root_legacy_id';
  if v_root_legacy_id is not null then
    v_root_person_id := md5('soyagaci:' || p_family_slug || ':person:' || v_root_legacy_id)::uuid;
  end if;

  v_family_id := md5('soyagaci:family:' || p_family_slug)::uuid;
  insert into public.families (id, slug, name, root_person_id, created_at)
  values (v_family_id, p_family_slug, p_family_name, v_root_person_id, v_now)
  on conflict (slug) do update
  set name = excluded.name,
      root_person_id = coalesce(excluded.root_person_id, public.families.root_person_id);

  select count(*) into v_existing_person_count
  from public.family_memberships m
  join public.people p on p.id = m.person_id
  where m.family_id = v_family_id;

  select count(*) into v_existing_media_count
  from public.media_revisions r
  join public.family_memberships m on m.person_id = r.person_id
  where m.family_id = v_family_id;

  -- 1. Insert People & Person Revisions
  with input as (
    select value->>'legacy_id' as legacy_id,
           value->>'given_name' as given_name,
           value->>'middle_names' as middle_names,
           value->>'family_name' as family_name,
           value->>'display_name' as display_name,
           value->>'gender' as gender,
           coalesce((value->>'is_living')::boolean, true) as is_living,
           value->>'summary' as summary,
           coalesce(value->'aliases', '[]'::jsonb) as aliases,
           coalesce(value->>'privacy', 'public') as privacy
    from jsonb_array_elements(p_payload->'people') as value
  ),
  prepared as (
    select md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid as person_id,
           md5('soyagaci:' || p_family_slug || ':person-revision:' || legacy_id)::uuid as revision_id,
           legacy_id, given_name, middle_names, family_name, display_name,
           gender, is_living, summary, aliases, privacy
    from input
  ),
  inserted_people as (
    insert into public.people (id, legacy_id, created_at)
    select person_id, legacy_id, v_now from prepared
    on conflict (id) do update set legacy_id = excluded.legacy_id
    returning id
  )
  insert into public.person_revisions (
    id, person_id, status, created_at, given_name, middle_names,
    family_name, display_name, aliases, gender, is_living, summary, privacy
  )
  select revision_id, person_id, 'approved', v_now, given_name, middle_names,
         family_name, display_name,
         array(select jsonb_array_elements_text(aliases)),
         gender, is_living, summary,
         privacy::public.privacy_level
  from prepared
  on conflict (person_id, id) do nothing;

  update public.people p
  set current_revision_id = md5('soyagaci:' || p_family_slug || ':person-revision:' || p.legacy_id)::uuid
  from jsonb_array_elements(p_payload->'people') as input
  where p.id = md5('soyagaci:' || p_family_slug || ':person:' || (input->>'legacy_id'))::uuid;

  -- 2. Insert Memberships
  with input as (
    select value->>'legacy_id' as legacy_id,
           coalesce(value->>'role', 'member') as role
    from jsonb_array_elements(p_payload->'people') as value
  ),
  prepared as (
    select md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid as person_id,
           md5('soyagaci:' || p_family_slug || ':membership:' || legacy_id)::uuid as membership_id,
           md5('soyagaci:' || p_family_slug || ':membership-revision:' || legacy_id)::uuid as revision_id,
           role
    from input
  ),
  inserted_memberships as (
    insert into public.family_memberships (id, family_id, person_id, created_at)
    select membership_id, v_family_id, person_id, v_now from prepared
    on conflict (family_id, person_id) do update set created_at = v_now
    returning id
  )
  insert into public.family_membership_revisions (
    id, family_membership_id, family_id, person_id, status, created_at
  )
  select revision_id, membership_id, v_family_id, person_id, 'approved', v_now
  from prepared
  on conflict (family_membership_id, id) do nothing;

  update public.family_memberships m
  set current_revision_id = md5('soyagaci:' || p_family_slug || ':membership-revision:' || (input->>'legacy_id'))::uuid
  from jsonb_array_elements(p_payload->'people') as input
  where m.family_id = v_family_id
    and m.person_id = md5('soyagaci:' || p_family_slug || ':person:' || (input->>'legacy_id'))::uuid;

  -- 3. Insert Life Events
  with input as (
    select value->>'key' as key,
           value->>'person_legacy_id' as person_legacy_id,
           value->>'event_type' as event_type,
           value->>'date_start' as date_start,
           value->>'date_text' as date_text,
           value->>'place_text' as place_text,
           value->>'details' as details
    from jsonb_array_elements(p_payload->'life_events') as value
  ),
  prepared as (
    select md5('soyagaci:' || p_family_slug || ':life-event:' || key)::uuid as event_id,
           md5('soyagaci:' || p_family_slug || ':life-event-revision:' || key)::uuid as revision_id,
           md5('soyagaci:' || p_family_slug || ':person:' || person_legacy_id)::uuid as person_id,
           event_type, date_start, date_text, place_text, details
    from input
  ),
  inserted_events as (
    insert into public.life_events (id, person_id, created_at)
    select event_id, person_id, v_now from prepared
    on conflict (id) do update set person_id = excluded.person_id
    returning id
  )
  insert into public.life_event_revisions (
    id, life_event_id, status, event_type, date_start, date_text, place_text, details, created_at
  )
  select revision_id, event_id, 'approved', event_type::public.life_event_type,
         nullif(date_start, '')::date, date_text, place_text, details, v_now
  from prepared
  on conflict (life_event_id, id) do nothing;

  update public.life_events event
  set current_revision_id = md5('soyagaci:' || p_family_slug || ':life-event-revision:' || input.key)::uuid
  from jsonb_to_recordset(p_payload->'life_events') as input(key text)
  where event.id = md5('soyagaci:' || p_family_slug || ':life-event:' || input.key)::uuid;

  -- 4. Insert Partnerships
  with input as (
    select value->>'key' as key,
           value->>'person1_legacy_id' as person1_legacy_id,
           value->>'person2_legacy_id' as person2_legacy_id,
           value->>'date_start' as date_start,
           value->>'date_text' as date_text
    from jsonb_array_elements(p_payload->'partnerships') as value
  ),
  ids as (
    select key, date_start, date_text,
           least(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person1_id,
           greatest(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person2_id
    from input
  ),
  inserted_partnerships as (
    insert into public.partnerships (id, person1_id, person2_id, created_at)
    select md5('soyagaci:' || p_family_slug || ':partnership:' || key)::uuid,
           person1_id, person2_id, v_now
    from ids
    on conflict (person1_id, person2_id) do update set created_at = v_now
    returning id
  )
  insert into public.partnership_revisions (
    id, partnership_id, status, person1_id, person2_id,
    partnership_type, date_start, date_end, date_text, created_at
  )
  select md5('soyagaci:' || p_family_slug || ':partnership-revision:' || key)::uuid,
         md5('soyagaci:' || p_family_slug || ':partnership:' || key)::uuid,
         'approved',
         person1_id,
         person2_id,
         'marriage',
         nullif(date_start, '')::date,
         nullif(date_start, '')::date,
         date_text,
         v_now
  from ids
  on conflict (partnership_id, id) do nothing;

  update public.partnerships partnership
  set current_revision_id = md5('soyagaci:' || p_family_slug || ':partnership-revision:' || input.key)::uuid
  from jsonb_to_recordset(p_payload->'partnerships') as input(key text)
  where partnership.id = md5('soyagaci:' || p_family_slug || ':partnership:' || input.key)::uuid;

  -- 5. Insert Parent Links
  with input as (
    select value->>'parent_legacy_id' as parent_legacy_id,
           value->>'child_legacy_id' as child_legacy_id
    from jsonb_array_elements(p_payload->'parent_links') as value
  ),
  ids as (
    select (parent_legacy_id || ':' || child_legacy_id) as key,
           md5('soyagaci:' || p_family_slug || ':person:' || parent_legacy_id)::uuid as parent_id,
           md5('soyagaci:' || p_family_slug || ':person:' || child_legacy_id)::uuid as child_id
    from input
  ),
  inserted_parent_links as (
    insert into public.parent_links (id, parent_id, child_id, created_at)
    select md5('soyagaci:' || p_family_slug || ':parent-link:' || key)::uuid,
           parent_id, child_id, v_now
    from ids
    on conflict (parent_id, child_id) do update set created_at = v_now
    returning id
  )
  insert into public.parent_link_revisions (
    id, parent_link_id, status, parent_id, child_id, relationship_type, created_at
  )
  select md5('soyagaci:' || p_family_slug || ':parent-link-revision:' || key)::uuid,
         md5('soyagaci:' || p_family_slug || ':parent-link:' || key)::uuid,
         'approved',
         parent_id,
         child_id,
         'biological',
         v_now
  from ids
  on conflict (parent_link_id, id) do nothing;

  update public.parent_links parent_link
  set current_revision_id = md5('soyagaci:' || p_family_slug || ':parent-link-revision:' || (input->>'parent_legacy_id') || ':' || (input->>'child_legacy_id'))::uuid
  from jsonb_array_elements(p_payload->'parent_links') as input
  where parent_link.id = md5('soyagaci:' || p_family_slug || ':parent-link:' || (input->>'parent_legacy_id') || ':' || (input->>'child_legacy_id'))::uuid;

  -- 6. Insert Media
  with input as (
    select value->>'person_legacy_id' as person_legacy_id,
           value->>'storage_path' as storage_path,
           value->>'legacy_uri' as legacy_uri,
           coalesce(value->>'mime_type', 'image/jpeg') as mime_type,
           coalesce(value->>'caption', 'Legacy sheet image reference') as caption
    from jsonb_array_elements(p_payload->'media') as value
  ),
  prepared as (
    select md5('soyagaci:' || p_family_slug || ':person:' || person_legacy_id)::uuid as person_id,
           md5('soyagaci:' || p_family_slug || ':media-revision:' || person_legacy_id || ':' || coalesce(storage_path, legacy_uri))::uuid as media_id,
           storage_path, legacy_uri, mime_type, caption
    from input
  )
  insert into public.media_revisions (
    id, person_id, status, storage_path, legacy_uri, mime_type, caption, created_at
  )
  select media_id, person_id, 'approved', storage_path, legacy_uri, mime_type, caption, v_now
  from prepared
  on conflict (id) do nothing;

  select count(*) into v_people_inserted
  from public.family_memberships m
  where m.family_id = v_family_id;
  v_people_inserted := v_people_inserted - v_existing_person_count;

  select count(*) into v_media_inserted
  from public.media_revisions r
  join public.family_memberships m on m.person_id = r.person_id
  where m.family_id = v_family_id;
  v_media_inserted := v_media_inserted - v_existing_media_count;

  select count(*) into v_memberships_inserted from public.family_memberships where family_id = v_family_id;
  select count(*) into v_life_events_inserted
  from public.life_events e
  join public.family_memberships m on m.person_id = e.person_id
  where m.family_id = v_family_id;

  select count(*) into v_partnerships_inserted
  from public.partnerships p
  join public.family_memberships m1 on m1.person_id = p.person1_id
  join public.family_memberships m2 on m2.person_id = p.person2_id
  where m1.family_id = v_family_id and m2.family_id = v_family_id;

  select count(*) into v_parent_links_inserted
  from public.parent_links pl
  join public.family_memberships m1 on m1.person_id = pl.parent_id
  join public.family_memberships m2 on m2.person_id = pl.child_id
  where m1.family_id = v_family_id and m2.family_id = v_family_id;

  return jsonb_build_object(
    'no_op', v_people_inserted = 0 and v_media_inserted = 0,
    'people', v_people_inserted,
    'memberships', v_memberships_inserted,
    'life_events', v_life_events_inserted,
    'partnerships', v_partnerships_inserted,
    'parent_links', v_parent_links_inserted,
    'media', v_media_inserted
  );
end;
$$;

notify pgrst, 'reload schema';
