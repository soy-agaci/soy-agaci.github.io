begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(23);

select ok(
  (select count(*) from (
    select person_id
    from public.family_memberships
    group by person_id
    having count(distinct family_id) > 1
  ) overlap_people) >= 1
  and not exists (
    select 1 from public.people e left join public.person_revisions r
      on (r.person_id, r.id) = (e.id, e.current_revision_id)
    where r.status is distinct from 'approved'
  )
  and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relrowsecurity
      and c.relname = any (array[
        'submissions', 'sources', 'families', 'people', 'life_events',
        'partnerships', 'parent_links', 'family_memberships', 'person_revisions',
        'life_event_revisions', 'partnership_revisions', 'parent_link_revisions',
        'family_membership_revisions', 'media_revisions'
      ])) = 14,
  'seed overlap, approved person pointers, and RLS are present'
);

do $$
begin
  begin
    insert into public.life_event_revisions (
      id, life_event_id, status, event_type, date_start, date_end
    ) values (
      '90000000-0000-0000-0000-000000000001',
      '30000000-0000-0000-0000-000000000001',
      'approved', 'other', '2020-01-02', '2020-01-01'
    );
    raise exception 'date order accepted';
  exception when check_violation then null;
  end;
end;
$$;
select pass('date start must not exceed date end');

do $$
begin
  begin
    insert into public.life_event_revisions (
      id, life_event_id, status, event_type, certainty
    ) values (
      '90000000-0000-0000-0000-000000000002',
      '30000000-0000-0000-0000-000000000001', 'approved', 'other', -0.001
    );
    raise exception 'negative certainty accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.life_event_revisions (
      id, life_event_id, status, event_type, certainty
    ) values (
      '90000000-0000-0000-0000-000000000003',
      '30000000-0000-0000-0000-000000000001', 'approved', 'other', 1.001
    );
    raise exception 'certainty above one accepted';
  exception when check_violation then null;
  end;
end;
$$;
select pass('certainty is bounded from zero through one');

do $$
begin
  begin
    update public.people
    set current_revision_id = '21000000-0000-0000-0000-000000000002'
    where id = '20000000-0000-0000-0000-000000000001';
    set constraints people_current_revision_fk immediate;
    raise exception 'cross-entity current pointer accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('current revision pointers cannot cross entities');

do $$
begin
  begin
    insert into public.person_revisions (
      id, person_id, base_revision_id, display_name
    ) values (
      '90000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000001',
      '21000000-0000-0000-0000-000000000002',
      'Invalid Base'
    );
    set constraints person_revisions_base_fk immediate;
    raise exception 'cross-entity base revision accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('base revisions cannot cross stable entities');

do $$
begin
  insert into public.media_revisions (
    id, person_id, storage_path, mime_type
  ) values (
    '90000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001', 'test/one.jpg', 'image/jpeg'
  );
  begin
    insert into public.media_revisions (
      id, person_id, base_revision_id, storage_path, mime_type
    ) values (
      '90000000-0000-0000-0000-000000000006',
      '20000000-0000-0000-0000-000000000002',
      '90000000-0000-0000-0000-000000000005', 'test/two.jpg', 'image/jpeg'
    );
    set constraints media_revisions_base_fk immediate;
    raise exception 'cross-person media base accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('media base revisions cannot cross people');

do $$
begin
  begin
    insert into public.partnership_revisions (
      id, partnership_id, person1_id, person2_id, partnership_type
    ) values (
      '90000000-0000-0000-0000-000000000007',
      '40000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000004', 'other'
    );
    raise exception 'partnership endpoint mismatch accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('partnership revision endpoints match the stable entity');

do $$
begin
  begin
    insert into public.parent_link_revisions (
      id, parent_link_id, parent_id, child_id, relationship_type
    ) values (
      '90000000-0000-0000-0000-000000000008',
      '50000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000005', 'biological'
    );
    raise exception 'parent endpoint mismatch accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('parent-link revision endpoints match the stable entity');

do $$
begin
  begin
    insert into public.family_membership_revisions (
      id, family_membership_id, family_id, person_id
    ) values (
      '90000000-0000-0000-0000-000000000009',
      '60000000-0000-0000-0000-000000000001',
      '10000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000001'
    );
    raise exception 'membership endpoint mismatch accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('family-membership revision endpoints match the stable entity');

insert into public.person_revisions (
  id, person_id, status, display_name
) values
  ('92000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 'pending', 'Pending Pointer'),
  ('92000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 'approved', 'Approved Pointer');

do $$
begin
  begin
    update public.people
    set current_revision_id = '92000000-0000-0000-0000-000000000001'
    where id = '20000000-0000-0000-0000-000000000002';
    set constraints people_current_revision_fk immediate;
    raise exception 'pending current revision accepted';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('pending revisions cannot become current');

do $$
begin
  update public.people
  set current_revision_id = '92000000-0000-0000-0000-000000000002'
  where id = '20000000-0000-0000-0000-000000000002';
  set constraints people_current_revision_fk immediate;
  if (select current_revision_status from public.people
      where id = '20000000-0000-0000-0000-000000000002') <> 'approved' then
    raise exception 'approved current revision was not retained';
  end if;
end;
$$;
select pass('approved revisions can become current');

do $$
begin
  begin
    update public.person_revisions
    set status = 'superseded', reviewed_at = '2026-02-01'
    where id = '92000000-0000-0000-0000-000000000002';
    raise exception 'current approved revision was superseded';
  exception when foreign_key_violation then null;
  end;
end;
$$;
select pass('current approved revisions cannot be superseded');

do $$
begin
  update public.people
  set current_revision_id = '21000000-0000-0000-0000-000000000002'
  where id = '20000000-0000-0000-0000-000000000002';
  update public.person_revisions
  set status = 'superseded', reviewed_at = '2026-02-01'
  where id = '92000000-0000-0000-0000-000000000002';
  if (select status from public.person_revisions
      where id = '92000000-0000-0000-0000-000000000002') <> 'superseded' then
    raise exception 'unreferenced approved revision was not superseded';
  end if;
end;
$$;
select pass('old approved revision can be superseded after pointer movement');

do $$
declare
  reviewer_id constant uuid := '93000000-0000-0000-0000-000000000001';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
  ) values (
    '00000000-0000-0000-0000-000000000000', reviewer_id,
    'authenticated', 'authenticated', 'qa-reviewer@example.invalid', '',
    now(), '{}', '{}', now(), now()
  );
  insert into public.person_revisions (
    id, person_id, display_name, reviewed_at, reviewed_by
  ) values (
    '93000000-0000-0000-0000-000000000002',
    '20000000-0000-0000-0000-000000000001', 'Reviewed Revision', now(), reviewer_id
  );
  insert into public.submissions (id, reviewed_at, reviewed_by) values (
    '93000000-0000-0000-0000-000000000003', now(), reviewer_id
  );
  begin
    delete from auth.users where id = reviewer_id;
    raise exception 'referenced reviewer deletion accepted';
  exception when foreign_key_violation then null;
  end;
  if (select count(*)
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
      join pg_attribute a on a.attrelid = t.oid
        and a.attname = 'reviewed_by' and a.attnum = any (c.conkey)
      where n.nspname = 'public' and c.contype = 'f' and c.confdeltype = 'r') <> 7 then
    raise exception 'not every reviewer FK uses ON DELETE RESTRICT';
  end if;
end;
$$;
select pass('reviewed records restrict reviewer deletion');

do $$
begin
  insert into public.person_revisions (id, person_id, display_name) values
    ('91000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Approve Path'),
    ('91000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Reject Path'),
    ('91000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'Conflict Path'),
    ('91000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000001', 'Pending Path');

  update public.person_revisions set status = 'approved', reviewed_at = '2026-01-01'
  where id = '91000000-0000-0000-0000-000000000001';
  update public.person_revisions set status = 'superseded', reviewed_at = '2026-01-02'
  where id = '91000000-0000-0000-0000-000000000001';
  update public.person_revisions set status = 'rejected', reviewed_at = '2026-01-01'
  where id = '91000000-0000-0000-0000-000000000002';
  update public.person_revisions set status = 'conflict', reviewed_at = '2026-01-01'
  where id = '91000000-0000-0000-0000-000000000003';
  update public.person_revisions set status = 'rejected', reviewed_at = '2026-01-02'
  where id = '91000000-0000-0000-0000-000000000003';

  if (select array_agg(status order by id) from public.person_revisions
      where id between '91000000-0000-0000-0000-000000000001'
        and '91000000-0000-0000-0000-000000000003')
      <> array['superseded', 'rejected', 'rejected']::public.moderation_status[] then
    raise exception 'valid moderation transitions produced wrong statuses';
  end if;
end;
$$;
select pass('all allowed moderation transitions succeed');

do $$
begin
  begin
    update public.person_revisions set status = 'approved'
    where id = '91000000-0000-0000-0000-000000000001';
    raise exception 'status reversal accepted';
  exception when raise_exception then
    if sqlerrm not like 'invalid % status transition:%' then raise; end if;
  end;
end;
$$;
select pass('status reversals are rejected');

do $$
begin
  begin
    update public.person_revisions set display_name = 'Edited Payload'
    where id = '91000000-0000-0000-0000-000000000003';
    raise exception 'payload edit accepted';
  exception when raise_exception then
    if sqlerrm not like '%revision payload is immutable' then raise; end if;
  end;
end;
$$;
select pass('revision payload edits are rejected');

do $$
begin
  begin
    update public.person_revisions set reviewed_at = '2026-01-01'
    where id = '91000000-0000-0000-0000-000000000004';
    raise exception 'review metadata without transition accepted';
  exception when raise_exception then
    if sqlerrm not like 'invalid % status transition:%' then raise; end if;
  end;
end;
$$;
select pass('review metadata changes require a valid transition');

do $$
begin
  begin
    delete from public.person_revisions
    where id = '91000000-0000-0000-0000-000000000004';
    raise exception 'revision delete accepted';
  exception when raise_exception then
    if sqlerrm not like '%rows cannot be deleted' then raise; end if;
  end;
end;
$$;
select pass('revision deletes are rejected');

do $$
begin
  begin
    insert into public.parent_links (id, parent_id, child_id) values (
      '90000000-0000-0000-0000-000000000010',
      '20000000-0000-0000-0000-000000000005',
      '20000000-0000-0000-0000-000000000005'
    );
    raise exception 'self-parent link accepted';
  exception when check_violation then null;
  end;
end;
$$;
select pass('self-parent links are rejected');

do $$
begin
  begin
    insert into public.partnerships (id, person1_id, person2_id) values (
      '90000000-0000-0000-0000-000000000011',
      '20000000-0000-0000-0000-000000000004',
      '20000000-0000-0000-0000-000000000003'
    );
    raise exception 'noncanonical partnership accepted';
  exception when check_violation then null;
  end;
end;
$$;
select pass('partnership UUID ordering is canonical');

select ok(
  not exists (
    select 1
    from unnest(array['anon', 'authenticated']) role_name
    cross join unnest(array[
      'submissions', 'sources', 'families', 'people', 'life_events',
      'partnerships', 'parent_links', 'family_memberships', 'person_revisions',
      'life_event_revisions', 'partnership_revisions', 'parent_link_revisions',
      'family_membership_revisions', 'media_revisions'
    ]) table_name
    where has_table_privilege(
      role_name, format('public.%I', table_name), 'INSERT, UPDATE, DELETE'
    )
  ),
  'anon and authenticated direct writes are revoked on every table'
);
select ok(
  not exists (select 1 from pg_policies where schemaname = 'public'),
  'RLS has no permissive policies'
);

select * from finish();
rollback;
