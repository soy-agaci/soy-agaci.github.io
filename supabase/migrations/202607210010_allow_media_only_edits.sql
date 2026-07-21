do $migration$
declare
  definition text;
  patched text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.submit_family_edit(uuid,uuid,jsonb,text)'::regprocedure
  );
  patched := replace(
    definition,
    $find$+ jsonb_array_length(coalesce(p_bundle->'memberships', '[]'::jsonb)) = 0$find$,
    $replace$+ jsonb_array_length(coalesce(p_bundle->'memberships', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'sources', '[]'::jsonb))
        + jsonb_array_length(coalesce(p_bundle->'media', '[]'::jsonb)) = 0$replace$
  );
  if patched = definition then
    raise exception 'submit_family_edit size predicate was not found';
  end if;
  execute patched;
end;
$migration$;
