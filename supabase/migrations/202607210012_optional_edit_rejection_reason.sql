do $migration$
declare
  definition text;
  patched text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.moderate_family_edit_submission(uuid,text,text)'::regprocedure
  );
  patched := replace(
    definition,
    $find$if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000
     or (p_decision = 'reject' and nullif(btrim(p_review_note), '') is null) then$find$,
    $replace$if p_decision not in ('approve', 'reject') or char_length(coalesce(p_review_note, '')) > 2000 then$replace$
  );
  if patched = definition then
    raise exception 'moderate_family_edit_submission rejection-note check was not found';
  end if;
  execute patched;
end;
$migration$;
