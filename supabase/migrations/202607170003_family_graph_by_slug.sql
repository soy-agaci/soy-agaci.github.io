create function public.get_family_graph_by_slugs(
  p_family_slugs text[],
  p_include_pending boolean default false
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
select public.get_family_graph(
  coalesce((
    select array_agg(family.id order by requested.ordinality)
    from unnest(coalesce(p_family_slugs, '{}'::text[])) with ordinality requested(slug, ordinality)
    join public.families family on family.slug = requested.slug
  ), '{}'::uuid[]),
  p_include_pending
);
$$;

revoke all on function public.get_family_graph_by_slugs(text[], boolean) from public;
grant execute on function public.get_family_graph_by_slugs(text[], boolean) to anon, authenticated;
