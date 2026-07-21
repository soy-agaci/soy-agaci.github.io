create or replace function public.initialize_imported_family_lineage(
  p_family_slug text, p_root_person_legacy_id text default null
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_person_id uuid;
  v_count integer;
begin
  if auth.role() <> 'service_role' then raise exception 'service role required'; end if;
  select family.id, coalesce(person.merged_into_person_id, person.id, family.root_person_id)
  into v_family_id, v_person_id
  from public.families family
  left join public.people person on person.id = case when p_root_person_legacy_id is not null
    then md5('soyagaci:' || p_family_slug || ':person:' || p_root_person_legacy_id)::uuid
    else family.root_person_id end
  where family.slug = p_family_slug;
  if v_family_id is null or v_person_id is null then
    raise exception 'imported family or display start not found';
  end if;

  delete from public.family_lineage_members where family_id = v_family_id;
  perform public.add_family_tree_members(v_family_id, null, v_person_id, null, null, null);
  perform public.add_paternal_lineage_members(v_family_id, v_person_id, null);
  update public.families set root_person_id = null where id = v_family_id;
  select count(*) into v_count from public.family_lineage_members where family_id = v_family_id;
  if v_count = 0 then raise exception 'imported display start did not produce family lineage'; end if;
  return v_count;
end;
$$;

revoke all on function public.initialize_imported_family_lineage(text, text) from public, anon, authenticated;
grant execute on function public.initialize_imported_family_lineage(text, text) to service_role;
