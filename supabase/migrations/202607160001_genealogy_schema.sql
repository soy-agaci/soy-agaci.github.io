create type public.moderation_status as enum (
  'pending', 'approved', 'rejected', 'superseded', 'conflict'
);
create type public.privacy_level as enum ('public', 'family', 'private');
create type public.life_event_type as enum (
  'birth', 'death', 'residence', 'education', 'occupation', 'other'
);
create type public.parent_relationship_type as enum (
  'biological', 'adoptive', 'step', 'foster', 'guardian'
);
create type public.partnership_type as enum (
  'marriage', 'civil_union', 'domestic_partnership', 'other'
);

create table public.submissions (
  id uuid primary key,
  status public.moderation_status not null default 'pending',
  message text,
  submitter_user_id uuid references auth.users (id) on delete set null,
  submitter_name text,
  submitter_contact text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  review_note text
);

create table public.sources (
  id uuid primary key,
  submission_id uuid not null references public.submissions (id) on delete cascade,
  title text not null,
  url text,
  citation text,
  created_at timestamptz not null default now()
);

create table public.families (
  id uuid primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  constraint families_slug_format check (
    char_length(slug) <= 100 and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  )
);

create table public.people (
  id uuid primary key,
  legacy_id text unique,
  merged_into_person_id uuid references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint people_not_merged_into_self check (merged_into_person_id is distinct from id)
);

create table public.life_events (
  id uuid primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.partnerships (
  id uuid primary key,
  person1_id uuid not null references public.people (id) on delete restrict,
  person2_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint partnerships_canonical_order check (person1_id < person2_id),
  constraint partnerships_unique_pair unique (person1_id, person2_id),
  constraint partnerships_entity_endpoints unique (id, person1_id, person2_id)
);

create table public.parent_links (
  id uuid primary key,
  parent_id uuid not null references public.people (id) on delete restrict,
  child_id uuid not null references public.people (id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint parent_links_not_self check (parent_id <> child_id),
  constraint parent_links_unique_pair unique (parent_id, child_id),
  constraint parent_links_entity_endpoints unique (id, parent_id, child_id)
);

create table public.family_memberships (
  id uuid primary key,
  family_id uuid not null references public.families (id) on delete cascade,
  person_id uuid not null references public.people (id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint family_memberships_unique_person unique (family_id, person_id),
  constraint family_memberships_entity_endpoints unique (id, family_id, person_id)
);

create table public.person_revisions (
  id uuid primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  given_name text,
  middle_names text,
  family_name text,
  display_name text not null,
  aliases text[] not null default '{}',
  gender text,
  is_living boolean,
  summary text,
  privacy public.privacy_level not null default 'family',
  constraint person_revisions_entity_id unique (person_id, id),
  constraint person_revisions_current_target unique (person_id, id, status),
  constraint person_revisions_base_fk foreign key (person_id, base_revision_id)
    references public.person_revisions (person_id, id)
    deferrable initially deferred
);

create table public.life_event_revisions (
  id uuid primary key,
  life_event_id uuid not null references public.life_events (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  event_type public.life_event_type not null,
  date_start date,
  date_end date,
  date_text text,
  place_text text,
  details text,
  certainty numeric(4, 3),
  constraint life_event_revisions_date_order check (
    date_start is null or date_end is null or date_start <= date_end
  ),
  constraint life_event_revisions_certainty check (certainty between 0 and 1),
  constraint life_event_revisions_entity_id unique (life_event_id, id),
  constraint life_event_revisions_current_target unique (life_event_id, id, status),
  constraint life_event_revisions_base_fk foreign key (life_event_id, base_revision_id)
    references public.life_event_revisions (life_event_id, id)
    deferrable initially deferred
);

create table public.partnership_revisions (
  id uuid primary key,
  partnership_id uuid not null,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  person1_id uuid not null references public.people (id) on delete restrict,
  person2_id uuid not null references public.people (id) on delete restrict,
  partnership_type public.partnership_type not null,
  date_start date,
  date_end date,
  status_text text,
  constraint partnership_revisions_canonical_order check (person1_id < person2_id),
  constraint partnership_revisions_date_order check (
    date_start is null or date_end is null or date_start <= date_end
  ),
  constraint partnership_revisions_stable_fk foreign key (
    partnership_id, person1_id, person2_id
  ) references public.partnerships (id, person1_id, person2_id),
  constraint partnership_revisions_entity_id unique (partnership_id, id),
  constraint partnership_revisions_current_target unique (partnership_id, id, status),
  constraint partnership_revisions_base_fk foreign key (partnership_id, base_revision_id)
    references public.partnership_revisions (partnership_id, id)
    deferrable initially deferred
);

create table public.parent_link_revisions (
  id uuid primary key,
  parent_link_id uuid not null,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  parent_id uuid not null references public.people (id) on delete restrict,
  child_id uuid not null references public.people (id) on delete restrict,
  relationship_type public.parent_relationship_type not null,
  certainty numeric(4, 3),
  constraint parent_link_revisions_not_self check (parent_id <> child_id),
  constraint parent_link_revisions_certainty check (certainty between 0 and 1),
  constraint parent_link_revisions_stable_fk foreign key (
    parent_link_id, parent_id, child_id
  ) references public.parent_links (id, parent_id, child_id),
  constraint parent_link_revisions_entity_id unique (parent_link_id, id),
  constraint parent_link_revisions_current_target unique (parent_link_id, id, status),
  constraint parent_link_revisions_base_fk foreign key (parent_link_id, base_revision_id)
    references public.parent_link_revisions (parent_link_id, id)
    deferrable initially deferred
);

create table public.family_membership_revisions (
  id uuid primary key,
  family_membership_id uuid not null,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  person_id uuid not null references public.people (id) on delete restrict,
  family_id uuid not null references public.families (id) on delete restrict,
  constraint family_membership_revisions_stable_fk foreign key (
    family_membership_id, family_id, person_id
  ) references public.family_memberships (id, family_id, person_id),
  constraint family_membership_revisions_entity_id unique (family_membership_id, id),
  constraint family_membership_revisions_current_target unique (
    family_membership_id, id, status
  ),
  constraint family_membership_revisions_base_fk foreign key (
    family_membership_id, base_revision_id
  ) references public.family_membership_revisions (family_membership_id, id)
    deferrable initially deferred
);

create table public.media_revisions (
  id uuid primary key,
  person_id uuid not null references public.people (id) on delete cascade,
  submission_id uuid references public.submissions (id) on delete restrict,
  base_revision_id uuid,
  status public.moderation_status not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete restrict,
  storage_path text not null,
  mime_type text not null,
  caption text,
  constraint media_revisions_storage_path check (storage_path <> ''),
  constraint media_revisions_mime_type check (mime_type ~ '^[^/]+/[^/]+$'),
  constraint media_revisions_entity_id unique (person_id, id),
  constraint media_revisions_base_fk foreign key (person_id, base_revision_id)
    references public.media_revisions (person_id, id)
    deferrable initially deferred
);

alter table public.people add column current_revision_id uuid;
alter table public.people add column current_revision_status public.moderation_status
  generated always as (
    case when current_revision_id is null then null else 'approved'::public.moderation_status end
  ) stored;
alter table public.people add constraint people_current_revision_fk
  foreign key (id, current_revision_id, current_revision_status)
  references public.person_revisions (person_id, id, status)
  deferrable initially deferred;

alter table public.life_events add column current_revision_id uuid;
alter table public.life_events add column current_revision_status public.moderation_status
  generated always as (
    case when current_revision_id is null then null else 'approved'::public.moderation_status end
  ) stored;
alter table public.life_events add constraint life_events_current_revision_fk
  foreign key (id, current_revision_id, current_revision_status)
  references public.life_event_revisions (life_event_id, id, status)
  deferrable initially deferred;

alter table public.partnerships add column current_revision_id uuid;
alter table public.partnerships add column current_revision_status public.moderation_status
  generated always as (
    case when current_revision_id is null then null else 'approved'::public.moderation_status end
  ) stored;
alter table public.partnerships add constraint partnerships_current_revision_fk
  foreign key (id, current_revision_id, current_revision_status)
  references public.partnership_revisions (partnership_id, id, status)
  deferrable initially deferred;

alter table public.parent_links add column current_revision_id uuid;
alter table public.parent_links add column current_revision_status public.moderation_status
  generated always as (
    case when current_revision_id is null then null else 'approved'::public.moderation_status end
  ) stored;
alter table public.parent_links add constraint parent_links_current_revision_fk
  foreign key (id, current_revision_id, current_revision_status)
  references public.parent_link_revisions (parent_link_id, id, status)
  deferrable initially deferred;

alter table public.family_memberships add column current_revision_id uuid;
alter table public.family_memberships add column current_revision_status public.moderation_status
  generated always as (
    case when current_revision_id is null then null else 'approved'::public.moderation_status end
  ) stored;
alter table public.family_memberships add constraint family_memberships_current_revision_fk
  foreign key (id, current_revision_id, current_revision_status)
  references public.family_membership_revisions (family_membership_id, id, status)
  deferrable initially deferred;

create function public.enforce_revision_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% rows cannot be deleted', tg_table_name;
  end if;

  if (to_jsonb(new) - array['status', 'reviewed_at', 'reviewed_by'])
      is distinct from
     (to_jsonb(old) - array['status', 'reviewed_at', 'reviewed_by']) then
    raise exception '% revision payload is immutable', tg_table_name;
  end if;

  if not (
    (old.status = 'pending' and new.status in ('approved', 'rejected', 'conflict'))
    or (old.status = 'approved' and new.status = 'superseded')
    or (old.status = 'conflict' and new.status = 'rejected')
  ) then
    raise exception 'invalid % status transition: % -> %',
      tg_table_name, old.status, new.status;
  end if;

  return new;
end;
$$;

create trigger person_revisions_immutable
before update or delete on public.person_revisions
for each row execute function public.enforce_revision_mutation();
create trigger life_event_revisions_immutable
before update or delete on public.life_event_revisions
for each row execute function public.enforce_revision_mutation();
create trigger partnership_revisions_immutable
before update or delete on public.partnership_revisions
for each row execute function public.enforce_revision_mutation();
create trigger parent_link_revisions_immutable
before update or delete on public.parent_link_revisions
for each row execute function public.enforce_revision_mutation();
create trigger family_membership_revisions_immutable
before update or delete on public.family_membership_revisions
for each row execute function public.enforce_revision_mutation();
create trigger media_revisions_immutable
before update or delete on public.media_revisions
for each row execute function public.enforce_revision_mutation();

create index submissions_status_idx on public.submissions (status);
create index submissions_submitter_user_idx on public.submissions (submitter_user_id);
create index submissions_reviewer_idx on public.submissions (reviewed_by);
create index sources_submission_idx on public.sources (submission_id);
create index people_merged_into_idx on public.people (merged_into_person_id);
create index life_events_person_idx on public.life_events (person_id);
create index partnerships_person2_idx on public.partnerships (person2_id);
create index parent_links_child_idx on public.parent_links (child_id);
create index family_memberships_person_idx on public.family_memberships (person_id);
create index person_revisions_status_idx on public.person_revisions (status);
create index person_revisions_submission_idx on public.person_revisions (submission_id);
create index life_event_revisions_status_idx on public.life_event_revisions (status);
create index life_event_revisions_submission_idx on public.life_event_revisions (submission_id);
create index partnership_revisions_status_idx on public.partnership_revisions (status);
create index partnership_revisions_submission_idx on public.partnership_revisions (submission_id);
create index partnership_revisions_person2_idx on public.partnership_revisions (person2_id);
create index parent_link_revisions_status_idx on public.parent_link_revisions (status);
create index parent_link_revisions_submission_idx on public.parent_link_revisions (submission_id);
create index parent_link_revisions_child_idx on public.parent_link_revisions (child_id);
create index family_membership_revisions_status_idx
  on public.family_membership_revisions (status);
create index family_membership_revisions_submission_idx
  on public.family_membership_revisions (submission_id);
create index family_membership_revisions_person_idx
  on public.family_membership_revisions (person_id);
create index media_revisions_person_idx on public.media_revisions (person_id);
create index media_revisions_status_idx on public.media_revisions (status);
create index media_revisions_submission_idx on public.media_revisions (submission_id);

alter table public.submissions enable row level security;
alter table public.sources enable row level security;
alter table public.families enable row level security;
alter table public.people enable row level security;
alter table public.life_events enable row level security;
alter table public.partnerships enable row level security;
alter table public.parent_links enable row level security;
alter table public.family_memberships enable row level security;
alter table public.person_revisions enable row level security;
alter table public.life_event_revisions enable row level security;
alter table public.partnership_revisions enable row level security;
alter table public.parent_link_revisions enable row level security;
alter table public.family_membership_revisions enable row level security;
alter table public.media_revisions enable row level security;

revoke all on table
  public.submissions,
  public.sources,
  public.families,
  public.people,
  public.life_events,
  public.partnerships,
  public.parent_links,
  public.family_memberships,
  public.person_revisions,
  public.life_event_revisions,
  public.partnership_revisions,
  public.parent_link_revisions,
  public.family_membership_revisions,
  public.media_revisions
from anon, authenticated;
revoke all on function public.enforce_revision_mutation() from public, anon, authenticated;
