create function public.list_public_families()
returns table (id uuid, slug text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select family.id, family.slug, family.name
  from public.families family
  where exists (
    select 1
    from public.family_memberships membership
    join public.family_membership_revisions membership_revision
      on membership_revision.id = membership.current_revision_id
    join public.people person on person.id = membership.person_id
    join public.person_revisions person_revision
      on person_revision.id = person.current_revision_id
    where membership.family_id = family.id
      and membership_revision.status = 'approved'
      and person_revision.status = 'approved'
      and person_revision.privacy = 'public'
  )
  order by family.name, family.slug;
$$;

revoke all on function public.list_public_families() from public;
grant execute on function public.list_public_families() to anon, authenticated;
