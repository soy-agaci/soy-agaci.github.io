create or replace function public.move_merged_person_lineage()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.merged_into_person_id is null or new.merged_into_person_id is not distinct from old.merged_into_person_id then
    return new;
  end if;
  delete from public.family_lineage_members source
  where source.person_id = new.id
    and exists (
      select 1 from public.family_lineage_members target
      where target.family_id = source.family_id and target.person_id = new.merged_into_person_id
    );
  update public.family_lineage_members set person_id = new.merged_into_person_id where person_id = new.id;
  return new;
end;
$$;

drop trigger if exists people_move_merged_lineage on public.people;
create trigger people_move_merged_lineage
after update of merged_into_person_id on public.people
for each row execute function public.move_merged_person_lineage();
