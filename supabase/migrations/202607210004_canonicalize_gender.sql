-- One-time repair of legacy revision payloads before enforcing canonical values.
alter table public.person_revisions disable trigger person_revisions_immutable;
update public.person_revisions
set gender = case
  when lower(trim(gender)) in ('male', 'm', 'erkek', 'e') then 'E'
  when lower(trim(gender)) in ('female', 'f', 'kadın', 'kadin', 'k') then 'K'
  else 'U'
end
where gender is not null;
alter table public.person_revisions enable trigger person_revisions_immutable;

alter table public.person_revisions
  add constraint person_revisions_canonical_gender
  check (gender is null or gender in ('E', 'K', 'U'));
