do $$
declare
  creation record;
begin
  for creation in
    select target.id family_id, source.family_id source_family_id, target.root_person_id
    from public.families target
    join lateral (
      select membership.family_id
      from public.family_memberships membership
      join public.family_membership_revisions revision
        on revision.id = membership.current_revision_id and revision.status = 'approved'
      where membership.person_id = target.root_person_id
        and membership.family_id <> target.id
      order by (
        select count(*) from public.family_memberships source_member
        where source_member.family_id = membership.family_id
      ) desc
      limit 1
    ) source on true
    where target.root_person_id is not null
      and 1 = (
        select count(*)
        from public.family_memberships membership
        join public.family_membership_revisions revision
          on revision.id = membership.current_revision_id and revision.status = 'approved'
        where membership.family_id = target.id
      )
  loop
    perform public.add_family_tree_members(
      creation.family_id, creation.source_family_id, creation.root_person_id,
      null, null, now()
    );
  end loop;
end;
$$;
