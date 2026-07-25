create or replace function public.add_paternal_lineage_members(
  p_family_id uuid, p_person_id uuid, p_submission_id uuid default null
)
returns void
language sql
security definer
set search_path = ''
as $$
  with recursive paternal_ancestors(person_id) as (
    select p_person_id
    union
    select link.parent_id
    from paternal_ancestors child
    join public.parent_links link on link.child_id = child.person_id
    join public.parent_link_revisions link_revision
      on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
    join public.people parent on parent.id = link.parent_id
    join public.person_revisions parent_revision on parent_revision.id = parent.current_revision_id
    where lower(coalesce(parent_revision.gender, '')) in ('male', 'm', 'erkek', 'e')
  ), male_line(person_id) as (
    select ancestor.person_id
    from paternal_ancestors ancestor
    join public.people person on person.id = ancestor.person_id
    join public.person_revisions revision on revision.id = person.current_revision_id
    where lower(coalesce(revision.gender, '')) in ('male', 'm', 'erkek', 'e')
    union
    select link.child_id
    from male_line father
    join public.parent_links link on link.parent_id = father.person_id
    join public.parent_link_revisions link_revision
      on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
    join public.people child on child.id = link.child_id
    join public.person_revisions child_revision on child_revision.id = child.current_revision_id
    where lower(coalesce(child_revision.gender, '')) in ('male', 'm', 'erkek', 'e')
  ), lineage(person_id) as (
    select person_id from male_line
    union
    select link.child_id
    from male_line father
    join public.parent_links link on link.parent_id = father.person_id
    join public.parent_link_revisions link_revision
      on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
    union select p_person_id
  )
  insert into public.family_lineage_members (family_id, person_id, source_submission_id)
  select p_family_id, lineage.person_id, p_submission_id
  from lineage
  join public.people person on person.id = lineage.person_id
  join public.person_revisions revision on revision.id = person.current_revision_id
  where revision.status = 'approved' and revision.privacy = 'public'
  on conflict (family_id, person_id) do nothing;
$$;

do $$
declare family record;
begin
  for family in
    select id, root_person_id from public.families where root_person_id is not null
  loop
    perform public.refresh_family_paternal_lineage(family.id, family.root_person_id);
  end loop;
end;
$$;
