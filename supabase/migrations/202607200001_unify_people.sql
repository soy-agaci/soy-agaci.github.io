-- Migration: Unify duplicate/alias people across families

create or replace function public.unify_person(
  p_source_person_id uuid,
  p_target_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source public.people%rowtype;
  v_target public.people%rowtype;
  v_memberships_moved integer := 0;
  v_parent_links_moved integer := 0;
  v_partnerships_moved integer := 0;
  v_life_events_moved integer := 0;
  v_media_moved integer := 0;
begin
  if p_source_person_id is null or p_target_person_id is null then
    raise exception 'source and target person IDs are required';
  end if;

  if p_source_person_id = p_target_person_id then
    raise exception 'source and target person IDs must be distinct';
  end if;

  select * into v_source from public.people where id = p_source_person_id;
  select * into v_target from public.people where id = p_target_person_id;

  if v_source.id is null or v_target.id is null then
    raise exception 'source or target person does not exist';
  end if;

  -- Disable system triggers and immutable triggers during unification transaction
  set local session_replication_role = 'replica';

  -- 1. Family Memberships
  delete from public.family_membership_revisions
  where person_id = p_source_person_id
    and family_id in (select family_id from public.family_memberships where person_id = p_target_person_id);

  delete from public.family_memberships
  where person_id = p_source_person_id
    and family_id in (select family_id from public.family_memberships where person_id = p_target_person_id);

  update public.family_memberships set person_id = p_target_person_id where person_id = p_source_person_id;
  get diagnostics v_memberships_moved = row_count;

  update public.family_membership_revisions set person_id = p_target_person_id where person_id = p_source_person_id;

  -- 2. Parent Links (source as child)
  delete from public.parent_link_revisions
  where child_id = p_source_person_id
    and parent_link_id in (
      select l.id from public.parent_links l
      where l.child_id = p_source_person_id
        and exists (select 1 from public.parent_links e where e.parent_id = l.parent_id and e.child_id = p_target_person_id)
    );

  delete from public.parent_links
  where child_id = p_source_person_id
    and exists (select 1 from public.parent_links e where e.parent_id = parent_links.parent_id and e.child_id = p_target_person_id);

  update public.parent_link_revisions set child_id = p_target_person_id where child_id = p_source_person_id;
  update public.parent_links set child_id = p_target_person_id where child_id = p_source_person_id;
  get diagnostics v_parent_links_moved = row_count;

  -- Parent Links (source as parent)
  delete from public.parent_link_revisions
  where parent_id = p_source_person_id
    and parent_link_id in (
      select l.id from public.parent_links l
      where l.parent_id = p_source_person_id
        and exists (select 1 from public.parent_links e where e.parent_id = p_target_person_id and e.child_id = l.child_id)
    );

  delete from public.parent_links
  where parent_id = p_source_person_id
    and exists (select 1 from public.parent_links e where e.parent_id = p_target_person_id and e.child_id = parent_links.child_id);

  update public.parent_link_revisions set parent_id = p_target_person_id where parent_id = p_source_person_id;
  update public.parent_links set parent_id = p_target_person_id where parent_id = p_source_person_id;

  -- 3. Partnerships
  delete from public.partnership_revisions
  where (person1_id = p_source_person_id or person2_id = p_source_person_id)
    and partnership_id in (
      select p.id from public.partnerships p
      where (p.person1_id = p_source_person_id or p.person2_id = p_source_person_id)
        and exists (
          select 1 from public.partnerships e
          where e.person1_id = least(p_target_person_id, case when p.person1_id = p_source_person_id then p.person2_id else p.person1_id end)
            and e.person2_id = greatest(p_target_person_id, case when p.person1_id = p_source_person_id then p.person2_id else p.person1_id end)
        )
    );

  delete from public.partnerships
  where (person1_id = p_source_person_id or person2_id = p_source_person_id)
    and exists (
      select 1 from public.partnerships e
      where e.person1_id = least(p_target_person_id, case when partnerships.person1_id = p_source_person_id then partnerships.person2_id else partnerships.person1_id end)
        and e.person2_id = greatest(p_target_person_id, case when partnerships.person1_id = p_source_person_id then partnerships.person2_id else partnerships.person1_id end)
    );

  update public.partnership_revisions
  set person1_id = least(p_target_person_id, case when person1_id = p_source_person_id then person2_id else person1_id end),
      person2_id = greatest(p_target_person_id, case when person1_id = p_source_person_id then person2_id else person1_id end)
  where person1_id = p_source_person_id or person2_id = p_source_person_id;

  update public.partnerships
  set person1_id = least(p_target_person_id, case when person1_id = p_source_person_id then person2_id else person1_id end),
      person2_id = greatest(p_target_person_id, case when person1_id = p_source_person_id then person2_id else person1_id end)
  where person1_id = p_source_person_id or person2_id = p_source_person_id;
  get diagnostics v_partnerships_moved = row_count;

  -- 4. Life Events
  update public.life_events set person_id = p_target_person_id where person_id = p_source_person_id;
  get diagnostics v_life_events_moved = row_count;

  -- 5. Media Revisions
  update public.media_revisions set person_id = p_target_person_id where person_id = p_source_person_id;
  get diagnostics v_media_moved = row_count;

  -- 6. Update target person's revision aliases if source has aliases
  with source_aliases as (
    select distinct unnest(r.aliases) as alias
    from public.person_revisions r
    where r.person_id = p_source_person_id
  ),
  target_aliases as (
    select distinct unnest(r.aliases) as alias
    from public.person_revisions r
    where r.person_id = p_target_person_id
  ),
  combined as (
    select alias from source_aliases union select alias from target_aliases
  )
  update public.person_revisions
  set aliases = array(select alias from combined)
  where person_id = p_target_person_id;

  -- 7. Mark source person as merged
  update public.people
  set merged_into_person_id = p_target_person_id
  where id = p_source_person_id;

  -- Restore normal session_replication_role
  set local session_replication_role = 'origin';

  return jsonb_build_object(
    'source_person_id', p_source_person_id,
    'target_person_id', p_target_person_id,
    'memberships_moved', v_memberships_moved,
    'parent_links_moved', v_parent_links_moved,
    'partnerships_moved', v_partnerships_moved,
    'life_events_moved', v_life_events_moved,
    'media_moved', v_media_moved,
    'success', true
  );
exception
  when others then
    set local session_replication_role = 'origin';
    raise;
end;
$$;

create or replace function public.unify_person_by_legacy_id(
  p_source_family_slug text,
  p_source_legacy_id text,
  p_target_family_slug text,
  p_target_legacy_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source_id uuid;
  v_target_id uuid;
begin
  select id into v_source_id from public.people where legacy_id in (p_source_legacy_id, 'mem_' || p_source_legacy_id) limit 1;
  if v_source_id is null then
    v_source_id := md5('soyagaci:' || p_source_family_slug || ':person:' || p_source_legacy_id)::uuid;
  end if;

  select id into v_target_id from public.people where legacy_id in (p_target_legacy_id, 'mem_' || p_target_legacy_id) limit 1;
  if v_target_id is null then
    v_target_id := md5('soyagaci:' || p_target_family_slug || ':person:' || p_target_legacy_id)::uuid;
  end if;

  return public.unify_person(v_source_id, v_target_id);
end;
$$;

grant execute on function public.unify_person(uuid, uuid) to service_role;
grant execute on function public.unify_person_by_legacy_id(text, text, text, text) to service_role;

notify pgrst, 'reload schema';
