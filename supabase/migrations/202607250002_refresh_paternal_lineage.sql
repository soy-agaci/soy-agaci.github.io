-- Memberships keep the connected display graph (spouses and maternal branches).
-- family_lineage_members is the actual family assignment: paternal line only.

create or replace function public.refresh_family_paternal_lineage(
  p_family_id uuid,
  p_root_person_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.family_lineage_members where family_id = p_family_id;
  perform public.add_paternal_lineage_members(p_family_id, p_root_person_id, null);
end;
$$;

revoke all on function public.refresh_family_paternal_lineage(uuid, uuid) from public, anon, authenticated;

update public.families family
set root_person_id = revision.person_id
from public.person_revisions revision
join public.people person on person.current_revision_id = revision.id
where revision.status = 'approved'
  and ((family.slug = 'selcuk' and revision.display_name = 'Hüseyin Efendi Hüseyinoğlu')
    or (family.slug = 'agiralioglu' and revision.display_name = 'Dursun Ağıralioğlu'));

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

create or replace function public.refresh_paternal_lineage_after_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare family record;
begin
  if old.status = new.status or new.status <> 'approved' then return new; end if;
  for family in
    select id, root_person_id from public.families where root_person_id is not null
  loop
    perform public.refresh_family_paternal_lineage(family.id, family.root_person_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.refresh_paternal_lineage_after_approval() from public, anon, authenticated;

create trigger submissions_refresh_paternal_lineage
after update of status on public.submissions
for each row execute function public.refresh_paternal_lineage_after_approval();
