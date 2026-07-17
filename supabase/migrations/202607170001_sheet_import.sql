alter table public.families
  add column root_person_id uuid references public.people (id) on delete set null,
  add column import_fingerprint text;

alter table public.people add column legacy_numeric_id bigint;
alter table public.partnership_revisions add column date_text text;

alter table public.media_revisions
  drop constraint media_revisions_storage_path,
  alter column storage_path drop not null,
  add column legacy_uri text,
  add constraint media_revisions_location check (
    num_nonnulls(storage_path, legacy_uri) = 1
    and coalesce(storage_path, legacy_uri) <> ''
  );

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
),
visible_source_submission_ids as (
  select r.submission_id
  from public.family_membership_revisions r
  join visible_memberships m on m.id = r.family_membership_id
  where (r.status in ('approved', 'superseded') or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
  union
  select r.submission_id
  from public.person_revisions r
  join visible_people p on p.person_id = r.person_id
  where r.privacy = 'public'
    and (r.status in ('approved', 'superseded') or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
  union
  select r.submission_id
  from public.life_event_revisions r
  join selected_life_events e on e.id = r.life_event_id
  where (r.status in ('approved', 'superseded') or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
  union
  select r.submission_id
  from public.partnership_revisions r
  join selected_partnerships e on e.id = r.partnership_id
  where (r.status in ('approved', 'superseded') or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
  union
  select r.submission_id
  from public.parent_link_revisions r
  join selected_parent_links e on e.id = r.parent_link_id
  where (r.status in ('approved', 'superseded') or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
  union
  select r.submission_id
  from public.media_revisions r
  join visible_people p on p.person_id = r.person_id
  where (r.status = 'approved' or (p_include_pending and r.status = 'pending'))
    and r.submission_id is not null
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
    from visible_memberships m
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
  'sources', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', source.id, 'submission_id', source.submission_id,
      'submission_status', submission.status, 'title', source.title,
      'url', source.url, 'citation', source.citation, 'created_at', source.created_at
    ) order by source.created_at, source.id)
    from public.sources source
    join public.submissions submission on submission.id = source.submission_id
    join visible_source_submission_ids visible on visible.submission_id = source.submission_id
    where submission.status = 'approved'
       or (p_include_pending and submission.status = 'pending')
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

create function public.import_family_sheet(
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
  v_family public.families%rowtype;
  v_family_id uuid := md5('soyagaci:family:' || p_family_slug)::uuid;
  v_fingerprint text := md5(jsonb_build_object('name', p_family_name, 'payload', p_payload)::text);
  v_report jsonb;
begin
  if p_payload is null or p_family_slug is null or p_family_name is null
     or p_family_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or btrim(p_family_name) = '' then
    raise exception 'invalid family import arguments';
  end if;

  perform pg_advisory_xact_lock(hashtext('family-import:' || p_family_slug));

  v_report := jsonb_build_object(
    'rows', (p_payload->>'source_rows')::integer,
    'people', jsonb_array_length(coalesce(p_payload->'people', '[]'::jsonb)),
    'unions', (p_payload->>'union_count')::integer,
    'partnerships', jsonb_array_length(coalesce(p_payload->'partnerships', '[]'::jsonb)),
    'parent_links', jsonb_array_length(coalesce(p_payload->'parent_links', '[]'::jsonb)),
    'life_events', jsonb_array_length(coalesce(p_payload->'life_events', '[]'::jsonb)),
    'media', jsonb_array_length(coalesce(p_payload->'media', '[]'::jsonb)),
    'warnings', jsonb_array_length(coalesce(p_payload->'warnings', '[]'::jsonb))
  );

  select * into v_family from public.families where slug = p_family_slug;
  if found then
    if v_family.import_fingerprint = v_fingerprint then
      return v_report || jsonb_build_object('no_op', true);
    end if;
    raise exception 'conflicting family already exists for slug %', p_family_slug;
  end if;

  if not exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'people', '[]'::jsonb)) person
    where person->>'legacy_id' = p_payload->>'root_person_legacy_id'
  ) then
    raise exception 'root person is missing from import people';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_payload->'people', '[]'::jsonb)) person
    where nullif(person->>'legacy_id', '') is null
       or person->>'privacy' is null
       or person->>'privacy' not in ('public', 'family', 'private')
  ) then
    raise exception 'every imported person requires a legacy ID and explicit valid privacy';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_payload->'people') person
    group by person->>'legacy_id'
    having count(*) > 1
  ) then
    raise exception 'duplicate legacy IDs within imported family';
  end if;

  insert into public.families (id, slug, name, import_fingerprint)
  values (v_family_id, p_family_slug, p_family_name, v_fingerprint);

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'people') as person(
      legacy_id text,
      legacy_numeric_id bigint,
      given_name text,
      family_name text,
      display_name text,
      aliases jsonb,
      gender text,
      is_living boolean,
      summary text,
      privacy public.privacy_level
    )
  )
  insert into public.people (id, legacy_id, legacy_numeric_id)
  select md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid,
         legacy_id,
         legacy_numeric_id
  from input;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'people') as person(
      legacy_id text,
      given_name text,
      family_name text,
      display_name text,
      aliases jsonb,
      gender text,
      is_living boolean,
      summary text,
      privacy public.privacy_level
    )
  )
  insert into public.person_revisions (
    id, person_id, status, given_name, family_name, display_name,
    aliases, gender, is_living, summary, privacy
  )
  select md5('soyagaci:' || p_family_slug || ':person-revision:' || legacy_id)::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid,
         'approved',
         given_name,
         family_name,
         display_name,
         array(select jsonb_array_elements_text(coalesce(aliases, '[]'::jsonb))),
         gender,
         is_living,
         summary,
         privacy
  from input;

  update public.people person
  set current_revision_id = md5(
    'soyagaci:' || p_family_slug || ':person-revision:' || person.legacy_id
  )::uuid
  where person.id in (
    select md5('soyagaci:' || p_family_slug || ':person:' || (item->>'legacy_id'))::uuid
    from jsonb_array_elements(p_payload->'people') item
  );

  with input as (
    select item->>'legacy_id' as legacy_id,
           (item->>'legacy_numeric_id')::bigint as legacy_numeric_id
    from jsonb_array_elements(p_payload->'people') item
  )
  insert into public.family_memberships (
    id, family_id, person_id, legacy_id, legacy_numeric_id
  )
  select md5('soyagaci:' || p_family_slug || ':membership:' || legacy_id)::uuid,
         v_family_id,
         md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid,
         legacy_id,
         legacy_numeric_id
  from input;

  with input as (
    select item->>'legacy_id' as legacy_id
    from jsonb_array_elements(p_payload->'people') item
  )
  insert into public.family_membership_revisions (
    id, family_membership_id, status, person_id, family_id
  )
  select md5('soyagaci:' || p_family_slug || ':membership-revision:' || legacy_id)::uuid,
         md5('soyagaci:' || p_family_slug || ':membership:' || legacy_id)::uuid,
         'approved',
         md5('soyagaci:' || p_family_slug || ':person:' || legacy_id)::uuid,
         v_family_id
  from input;

  update public.family_memberships membership
  set current_revision_id = md5(
    'soyagaci:' || p_family_slug || ':membership-revision:' || person.legacy_id
  )::uuid
  from public.people person
  where membership.family_id = v_family_id and person.id = membership.person_id;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'life_events') as event(
      key text,
      person_legacy_id text,
      event_type public.life_event_type,
      date_start text,
      date_text text,
      place_text text,
      details text
    )
  )
  insert into public.life_events (id, person_id)
  select md5('soyagaci:' || p_family_slug || ':event:' || key)::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || person_legacy_id)::uuid
  from input;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'life_events') as event(
      key text,
      person_legacy_id text,
      event_type public.life_event_type,
      date_start text,
      date_text text,
      place_text text,
      details text
    )
  )
  insert into public.life_event_revisions (
    id, life_event_id, status, event_type, date_start, date_end,
    date_text, place_text, details, certainty
  )
  select md5('soyagaci:' || p_family_slug || ':event-revision:' || key)::uuid,
         md5('soyagaci:' || p_family_slug || ':event:' || key)::uuid,
         'approved',
         event_type,
         nullif(date_start, '')::date,
         nullif(date_start, '')::date,
         date_text,
         place_text,
         details,
         case when date_start is null then null else 1 end
  from input;

  update public.life_events event
  set current_revision_id = md5(
    'soyagaci:' || p_family_slug || ':event-revision:' || input.key
  )::uuid
  from jsonb_to_recordset(p_payload->'life_events') as input(key text)
  where event.id = md5('soyagaci:' || p_family_slug || ':event:' || input.key)::uuid;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'partnerships') as partnership(
      key text,
      person1_legacy_id text,
      person2_legacy_id text,
      date_start text,
      date_text text
    )
  ),
  ids as (
    select key,
           least(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person1_id,
           greatest(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person2_id
    from input
  )
  insert into public.partnerships (id, person1_id, person2_id)
  select md5('soyagaci:' || p_family_slug || ':partnership:' || key)::uuid,
         person1_id,
         person2_id
  from ids;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'partnerships') as partnership(
      key text,
      person1_legacy_id text,
      person2_legacy_id text,
      date_start text,
      date_text text
    )
  ),
  ids as (
    select *,
           least(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person1_id,
           greatest(
             md5('soyagaci:' || p_family_slug || ':person:' || person1_legacy_id)::uuid,
             md5('soyagaci:' || p_family_slug || ':person:' || person2_legacy_id)::uuid
           ) as person2_id
    from input
  )
  insert into public.partnership_revisions (
    id, partnership_id, status, person1_id, person2_id,
    partnership_type, date_start, date_end, date_text
  )
  select md5('soyagaci:' || p_family_slug || ':partnership-revision:' || key)::uuid,
         md5('soyagaci:' || p_family_slug || ':partnership:' || key)::uuid,
         'approved',
         person1_id,
         person2_id,
         'marriage',
         nullif(date_start, '')::date,
         nullif(date_start, '')::date,
         date_text
  from ids;

  update public.partnerships partnership
  set current_revision_id = md5(
    'soyagaci:' || p_family_slug || ':partnership-revision:' || input.key
  )::uuid
  from jsonb_to_recordset(p_payload->'partnerships') as input(key text)
  where partnership.id = md5(
    'soyagaci:' || p_family_slug || ':partnership:' || input.key
  )::uuid;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'parent_links') as link(
      parent_legacy_id text,
      child_legacy_id text
    )
  )
  insert into public.parent_links (id, parent_id, child_id)
  select md5(
           'soyagaci:' || p_family_slug || ':parent-link:' ||
           parent_legacy_id || ':' || child_legacy_id
         )::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || parent_legacy_id)::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || child_legacy_id)::uuid
  from input;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'parent_links') as link(
      parent_legacy_id text,
      child_legacy_id text
    )
  )
  insert into public.parent_link_revisions (
    id, parent_link_id, status, parent_id, child_id, relationship_type, certainty
  )
  select md5(
           'soyagaci:' || p_family_slug || ':parent-link-revision:' ||
           parent_legacy_id || ':' || child_legacy_id
         )::uuid,
         md5(
           'soyagaci:' || p_family_slug || ':parent-link:' ||
           parent_legacy_id || ':' || child_legacy_id
         )::uuid,
         'approved',
         md5('soyagaci:' || p_family_slug || ':person:' || parent_legacy_id)::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || child_legacy_id)::uuid,
         'biological',
         1
  from input;

  update public.parent_links link
  set current_revision_id = md5(
    'soyagaci:' || p_family_slug || ':parent-link-revision:' ||
    input.parent_legacy_id || ':' || input.child_legacy_id
  )::uuid
  from jsonb_to_recordset(p_payload->'parent_links') as input(
    parent_legacy_id text,
    child_legacy_id text
  )
  where link.id = md5(
    'soyagaci:' || p_family_slug || ':parent-link:' ||
    input.parent_legacy_id || ':' || input.child_legacy_id
  )::uuid;

  with input as (
    select *
    from jsonb_to_recordset(p_payload->'media') as media(
      person_legacy_id text,
      legacy_uri text
    )
  )
  insert into public.media_revisions (
    id, person_id, status, storage_path, legacy_uri, mime_type, caption
  )
  select md5('soyagaci:' || p_family_slug || ':media:' || person_legacy_id)::uuid,
         md5('soyagaci:' || p_family_slug || ':person:' || person_legacy_id)::uuid,
         'approved',
         null,
         legacy_uri,
         'application/x-legacy-image-reference',
         'Legacy sheet image reference'
  from input;

  update public.families
  set root_person_id = md5(
    'soyagaci:' || p_family_slug || ':person:' || (p_payload->>'root_person_legacy_id')
  )::uuid
  where id = v_family_id;

  return v_report || jsonb_build_object('no_op', false);
end;
$$;

revoke all on function public.import_family_sheet(jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.import_family_sheet(jsonb, text, text)
  to service_role;
