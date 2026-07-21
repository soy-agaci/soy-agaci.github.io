create or replace function public.admin_unify_person_resolved(
  p_source_person_id uuid,
  p_target_person_id uuid,
  p_fields jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_target public.people%rowtype;
  v_revision_id uuid;
  v_event jsonb;
  v_event_id uuid;
  v_event_base uuid;
  v_found boolean;
  v_now timestamptz := now();
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_fields is null or jsonb_typeof(p_fields) <> 'object'
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
     or (p_fields->'is_living' is not null and jsonb_typeof(p_fields->'is_living') not in ('boolean', 'null'))
     or exists (select 1 from jsonb_array_elements_text(coalesce(p_fields->'aliases', '[]'::jsonb)) alias where char_length(alias) > 200) then
    raise exception 'invalid resolved person fields';
  end if;

  v_result := public.unify_person(p_source_person_id, p_target_person_id);
  select * into strict v_target from public.people where id = p_target_person_id;
  if nullif(btrim(concat_ws(' ', p_fields->>'given_name', p_fields->>'middle_names', p_fields->>'family_name')), '') is null then
    raise exception 'resolved person name is required';
  end if;

  v_revision_id := pg_catalog.gen_random_uuid();
  insert into public.person_revisions (
    id, person_id, base_revision_id, status, reviewed_at, reviewed_by,
    given_name, middle_names, family_name, display_name, aliases, gender,
    is_living, summary, privacy
  ) values (
    v_revision_id, p_target_person_id, v_target.current_revision_id, 'approved', v_now, auth.uid(),
    nullif(btrim(p_fields->>'given_name'), ''), nullif(btrim(p_fields->>'middle_names'), ''),
    nullif(btrim(p_fields->>'family_name'), ''),
    btrim(concat_ws(' ', p_fields->>'given_name', p_fields->>'middle_names', p_fields->>'family_name')),
    array(select jsonb_array_elements_text(coalesce(p_fields->'aliases', '[]'::jsonb))),
    nullif(btrim(p_fields->>'gender'), ''), (p_fields->>'is_living')::boolean,
    nullif(btrim(p_fields->>'summary'), ''), 'public'
  );
  update public.people set current_revision_id = v_revision_id where id = p_target_person_id;

  for v_event in select value from jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('type', 'birth', 'date', p_fields->'birth_date', 'place', p_fields->'birthplace'),
    jsonb_build_object('type', 'death', 'date', p_fields->'death_date', 'place', p_fields->'death_place'),
    jsonb_build_object('type', 'occupation', 'details', p_fields->'occupation')
  )) loop
    if nullif(btrim(coalesce(v_event->>'date', v_event->>'place', v_event->>'details', '')), '') is null then continue; end if;
    v_found := false;
    for v_event_id, v_event_base in
      select event.id, event.current_revision_id
      from public.life_events event
      join public.life_event_revisions revision on revision.id = event.current_revision_id
      where event.person_id = p_target_person_id and revision.event_type::text = v_event->>'type'
    loop
      v_found := true;
      v_revision_id := pg_catalog.gen_random_uuid();
      insert into public.life_event_revisions (
        id, life_event_id, base_revision_id, status, reviewed_at, reviewed_by,
        event_type, date_text, place_text, details
      ) values (
        v_revision_id, v_event_id, v_event_base, 'approved', v_now, auth.uid(),
        (v_event->>'type')::public.life_event_type, nullif(btrim(v_event->>'date'), ''),
        nullif(btrim(v_event->>'place'), ''), nullif(btrim(v_event->>'details'), '')
      );
      update public.life_events set current_revision_id = v_revision_id where id = v_event_id;
    end loop;
    if not v_found then
      v_event_id := pg_catalog.gen_random_uuid();
      v_revision_id := pg_catalog.gen_random_uuid();
      insert into public.life_events (id, person_id) values (v_event_id, p_target_person_id);
      insert into public.life_event_revisions (
        id, life_event_id, status, reviewed_at, reviewed_by, event_type, date_text, place_text, details
      ) values (
        v_revision_id, v_event_id, 'approved', v_now, auth.uid(),
        (v_event->>'type')::public.life_event_type, nullif(btrim(v_event->>'date'), ''),
        nullif(btrim(v_event->>'place'), ''), nullif(btrim(v_event->>'details'), '')
      );
      update public.life_events set current_revision_id = v_revision_id where id = v_event_id;
    end if;
  end loop;
  return v_result || jsonb_build_object('profile_merged', true);
end;
$$;

revoke all on function public.admin_unify_person_resolved(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
grant execute on function public.admin_unify_person_resolved(uuid, uuid, jsonb) to authenticated, service_role;
