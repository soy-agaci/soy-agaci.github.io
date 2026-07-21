do $migration$
declare definition text; patched text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.submit_person_merge(uuid,uuid,uuid,uuid,jsonb,text)'::regprocedure
  );
  patched := replace(
    definition,
    'a merge proposal already exists for one of these people',
    'Bu kişilerden biri için zaten bekleyen bir birleştirme isteği var'
  );
  if patched = definition then raise exception 'duplicate merge error was not found'; end if;
  execute patched;
end;
$migration$;
