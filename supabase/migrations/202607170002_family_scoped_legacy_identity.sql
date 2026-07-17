alter table public.people drop constraint people_legacy_id_key;

alter table public.family_memberships
  add column legacy_id text,
  add column legacy_numeric_id bigint,
  add constraint family_memberships_family_legacy_key unique (family_id, legacy_id);
