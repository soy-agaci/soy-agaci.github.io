do $migration$
declare
  definition text;
  patched text;
begin
  definition := pg_catalog.pg_get_functiondef(
    'public.get_admin_submission(uuid)'::regprocedure
  );
  patched := replace(
    definition,
    $find$'media', (select coalesce(jsonb_agg(jsonb_build_object('base', to_jsonb(b), 'current', null, 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.media_revisions r left join public.media_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id where r.submission_id = s.id)$find$,
    $replace$'media', (select coalesce(jsonb_agg(jsonb_build_object('base', case when b.id is null then to_jsonb(previous) else to_jsonb(b) end, 'current', null, 'proposed', to_jsonb(r)) order by r.id), '[]'::jsonb) from public.media_revisions r left join public.media_revisions b on b.person_id = r.person_id and b.id = r.base_revision_id left join lateral (select candidate.* from public.media_revisions candidate where candidate.person_id = r.person_id and candidate.status = 'approved' and (candidate.created_at, candidate.id) < (r.created_at, r.id) order by candidate.created_at desc, candidate.id desc limit 1) previous on true where r.submission_id = s.id)$replace$
  );
  if patched = definition then
    raise exception 'get_admin_submission media comparison was not found';
  end if;
  execute patched;
end;
$migration$;
