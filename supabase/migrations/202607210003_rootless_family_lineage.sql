create table public.family_lineage_members (
  family_id uuid not null references public.families (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  source_submission_id uuid references public.submissions (id) on delete restrict,
  created_at timestamptz not null default now(),
  primary key (family_id, person_id)
);

alter table public.family_lineage_members enable row level security;
revoke all on table public.family_lineage_members from public, anon, authenticated, service_role;

with recursive paternal_ancestors(family_id, person_id) as (
  select id, root_person_id from public.families where root_person_id is not null
  union
  select ancestor.family_id, link.parent_id
  from paternal_ancestors ancestor
  join public.parent_links link on link.child_id = ancestor.person_id
  join public.parent_link_revisions link_revision
    on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
  join public.people parent on parent.id = link.parent_id
  join public.person_revisions parent_revision on parent_revision.id = parent.current_revision_id
  where lower(coalesce(parent_revision.gender, '')) in ('male', 'm', 'erkek', 'e')
), male_line(family_id, person_id) as (
  select ancestor.family_id, ancestor.person_id
  from paternal_ancestors ancestor
  join public.people person on person.id = ancestor.person_id
  join public.person_revisions revision on revision.id = person.current_revision_id
  where lower(coalesce(revision.gender, '')) in ('male', 'm', 'erkek', 'e')
  union
  select father.family_id, link.child_id
  from male_line father
  join public.parent_links link on link.parent_id = father.person_id
  join public.parent_link_revisions link_revision
    on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
  join public.people child on child.id = link.child_id
  join public.person_revisions child_revision on child_revision.id = child.current_revision_id
  where lower(coalesce(child_revision.gender, '')) in ('male', 'm', 'erkek', 'e')
), lineage(family_id, person_id) as (
  select family_id, person_id from male_line
  union
  select father.family_id, link.child_id
  from male_line father
  join public.parent_links link on link.parent_id = father.person_id
  join public.parent_link_revisions link_revision
    on link_revision.id = link.current_revision_id and link_revision.status = 'approved'
  union
  select id, root_person_id from public.families where root_person_id is not null
)
insert into public.family_lineage_members (family_id, person_id)
select distinct lineage.family_id, lineage.person_id
from lineage
join public.family_memberships membership
  on membership.family_id = lineage.family_id and membership.person_id = lineage.person_id
join public.family_membership_revisions revision on revision.id = membership.current_revision_id
where revision.status = 'approved';

update public.families set root_person_id = null;

create function public.add_paternal_lineage_members(
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

revoke all on function public.add_paternal_lineage_members(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;

create function public.get_family_lineage_members(p_family_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'family_id', member.family_id, 'person_id', member.person_id
  ) order by member.family_id, member.person_id), '[]'::jsonb)
  from public.family_lineage_members member
  where member.family_id = any(coalesce(p_family_ids, '{}'::uuid[]))
    and exists (
      select 1 from public.family_memberships membership
      join public.family_membership_revisions revision on revision.id = membership.current_revision_id
      where membership.family_id = member.family_id and membership.person_id = member.person_id
        and revision.status = 'approved'
    );
$$;

revoke all on function public.get_family_lineage_members(uuid[]) from public;
grant execute on function public.get_family_lineage_members(uuid[]) to anon, authenticated, service_role;

create function public.record_explicit_family_lineage_join()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_family_id uuid;
  v_person_id uuid;
begin
  if old.status = new.status or new.status <> 'approved' then return new; end if;
  if (select count(*) from public.family_membership_revisions where submission_id = new.id) <> 1
     or exists (select 1 from public.family_creation_proposals where submission_id = new.id)
     or exists (select 1 from public.person_revisions where submission_id = new.id)
     or exists (select 1 from public.life_event_revisions where submission_id = new.id)
     or exists (select 1 from public.partnership_revisions where submission_id = new.id)
     or exists (select 1 from public.parent_link_revisions where submission_id = new.id)
     or exists (select 1 from public.media_revisions where submission_id = new.id) then
    return new;
  end if;

  select family_id, person_id into v_family_id, v_person_id
  from public.family_membership_revisions where submission_id = new.id;
  perform public.add_paternal_lineage_members(v_family_id, v_person_id, new.id);
  perform public.add_family_tree_members(
    v_family_id, null, v_person_id, new.id, new.reviewed_by, new.reviewed_at
  );
  return new;
end;
$$;

create trigger submissions_record_explicit_family_lineage_join
after update of status on public.submissions
for each row execute function public.record_explicit_family_lineage_join();
