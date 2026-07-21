create or replace function public.admin_unify_person(
  p_source_person_id uuid, p_target_person_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  return public.unify_person(p_source_person_id, p_target_person_id);
end;
$$;

revoke all on function public.admin_unify_person(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.admin_unify_person(uuid, uuid) to authenticated, service_role;
