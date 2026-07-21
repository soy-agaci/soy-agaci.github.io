create or replace function public.list_pending_admin_submissions(
  p_limit integer default 25,
  p_after_created_at timestamptz default null,
  p_after_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not public.is_google_admin() then raise exception 'admin authorization required'; end if;
  if p_limit < 1 or p_limit > 100 or ((p_after_created_at is null) <> (p_after_id is null)) then
    raise exception 'invalid review pagination';
  end if;
  with page as (
    select s.id, s.created_at, s.status, s.family_id, f.slug family_slug, f.name family_name,
      s.message, s.submitter_name,
      (select count(*) from public.person_revisions r
       left join public.person_revisions base on base.id = r.base_revision_id
       where r.submission_id = s.id and (base.id is null or
         (to_jsonb(r) - array['id','submission_id','base_revision_id','status','created_at','reviewed_at','reviewed_by'])
         is distinct from
         (to_jsonb(base) - array['id','submission_id','base_revision_id','status','created_at','reviewed_at','reviewed_by'])))
      + (select count(*) from public.life_event_revisions r where r.submission_id = s.id)
      + (select count(*) from public.partnership_revisions r where r.submission_id = s.id)
      + (select count(*) from public.parent_link_revisions r where r.submission_id = s.id)
      + (select count(*) from public.family_membership_revisions r where r.submission_id = s.id)
      + (select count(*) from public.media_revisions r where r.submission_id = s.id)
      + (select count(*) from public.sources src where src.submission_id = s.id)
      + (select count(*) from public.family_creation_proposals p where p.submission_id = s.id) entity_count,
      (select p.name from public.family_creation_proposals p where p.submission_id = s.id) proposed_family_name
    from public.submissions s
    join public.families f on f.id = s.family_id
    where s.status = 'pending'
      and (p_after_created_at is null or (s.created_at, s.id) > (p_after_created_at, p_after_id))
    order by s.created_at, s.id limit p_limit + 1
  ), visible as (select * from page order by created_at, id limit p_limit)
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(to_jsonb(visible) order by created_at, id), '[]'::jsonb),
    'next_cursor', case when (select count(*) from page) > p_limit then (
      select jsonb_build_object('created_at', created_at, 'id', id)
      from visible order by created_at desc, id desc limit 1
    ) end
  ) into v_result from visible;
  return v_result;
end;
$$;
