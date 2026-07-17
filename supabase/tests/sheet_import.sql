begin;
create extension if not exists pgtap with schema extensions;
select plan(27);

select has_column('public', 'families', 'root_person_id', 'families have an explicit root person');
select has_column('public', 'people', 'legacy_numeric_id', 'numeric sheet IDs are preserved');
select has_column('public', 'partnership_revisions', 'date_text', 'partnership source dates are preserved');
select has_column('public', 'media_revisions', 'legacy_uri', 'legacy media references are explicit');
select has_column('public', 'family_memberships', 'legacy_id', 'membership preserves the family-scoped legacy ID');
select has_column('public', 'family_memberships', 'legacy_numeric_id', 'membership preserves the numeric legacy ID');
select ok(
  exists (select 1 from public.families where slug = 'demo-alpha')
  and not exists (select 1 from public.families where slug = 'selcuk'),
  'seed family slugs cannot collide with the real import'
);
select ok(
  has_function_privilege('service_role', 'public.import_family_sheet(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.import_family_sheet(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.import_family_sheet(jsonb,text,text)', 'EXECUTE')
  and not has_function_privilege('public', 'public.import_family_sheet(jsonb,text,text)', 'EXECUTE'),
  'only service_role can execute the import RPC'
);

create temp table import_payload (payload jsonb not null);
insert into import_payload values ('{
  "source_rows": 4,
  "root_person_legacy_id": "mem_101",
  "union_count": 2,
  "warnings": [],
  "people": [
    {"legacy_id":"mem_101","legacy_numeric_id":101,"given_name":"Parent","family_name":"One","display_name":"Parent One","aliases":[],"gender":"male","is_living":null,"summary":null,"privacy":"public"},
    {"legacy_id":"mem_102","legacy_numeric_id":102,"given_name":"Parent","family_name":"Two","display_name":"Parent Two","aliases":[],"gender":"female","is_living":null,"summary":null,"privacy":"public"},
    {"legacy_id":"mem_103","legacy_numeric_id":103,"given_name":"Child","family_name":"One","display_name":"Child One","aliases":["Alias"],"gender":null,"is_living":false,"summary":"Synthetic note","privacy":"public"},
    {"legacy_id":"mem_104","legacy_numeric_id":104,"given_name":"Child","family_name":"Two","display_name":"Child Two","aliases":[],"gender":null,"is_living":null,"summary":null,"privacy":"public"}
  ],
  "partnerships": [
    {"key":"u_pair","person1_legacy_id":"mem_101","person2_legacy_id":"mem_102","date_start":null,"date_text":"circa 1980"}
  ],
  "parent_links": [
    {"parent_legacy_id":"mem_101","child_legacy_id":"mem_103"},
    {"parent_legacy_id":"mem_102","child_legacy_id":"mem_103"},
    {"parent_legacy_id":"mem_103","child_legacy_id":"mem_104"}
  ],
  "life_events": [
    {"key":"mem_103:birth","person_legacy_id":"mem_103","event_type":"birth","date_start":null,"date_text":"about 2000","place_text":"Test Place","details":null},
    {"key":"mem_103:death","person_legacy_id":"mem_103","event_type":"death","date_start":"2020-01-02","date_text":"2020-01-02","place_text":null,"details":null}
  ],
  "media": [
    {"person_legacy_id":"mem_103","legacy_uri":"legacy/test.jpg"}
  ]
}'::jsonb);

select is(
  (public.import_family_sheet((select payload from import_payload), 'demo-sheet-import', 'Sheet Import')->>'no_op')::boolean,
  false,
  'first import inserts the family'
);
select is(
  public.import_family_sheet((select payload from import_payload), 'demo-sheet-import', 'Sheet Import'),
  '{"rows":4,"people":4,"unions":2,"partnerships":1,"parent_links":3,"life_events":2,"media":1,"warnings":0,"no_op":true}'::jsonb,
  'exact repeat is a no-op with the same aggregate counts'
);
select is(
  (select count(*) from public.family_memberships membership
   join public.families family on family.id = membership.family_id
   where family.slug = 'demo-sheet-import'),
  4::bigint,
  'all people receive family memberships'
);
select ok(
  (select family.root_person_id = person.id
   from public.families family
   join public.people person on person.legacy_id = 'mem_101'
   where family.slug = 'demo-sheet-import'),
  'family root references the imported root person'
);
select ok(
  (select revision.date_text = 'about 2000' and revision.date_start is null
   from public.life_event_revisions revision
   where revision.date_text = 'about 2000'),
  'imprecise life-event dates retain text without invented precision'
);
select ok(
  (select revision.date_text = 'circa 1980' and revision.date_start is null
   from public.partnership_revisions revision
   where revision.date_text = 'circa 1980'),
  'imprecise partnership dates retain text without invented precision'
);
select ok(
  (select revision.status = 'approved'
      and revision.storage_path is null
      and revision.legacy_uri = 'legacy/test.jpg'
   from public.media_revisions revision
   where revision.legacy_uri = 'legacy/test.jpg'),
  'legacy media is approved and remains an external reference'
);
select is(
  (select jsonb_array_length(public.get_family_graph(array[family.id])->'parent_links')
   from public.families family where family.slug = 'demo-sheet-import'),
  3,
  'two-parent and one-parent unions become typed parent links'
);
select ok(
  (select public.get_family_graph(array[family.id])#>>'{families,0,root_person_id}' is not null
   from public.families family where family.slug = 'demo-sheet-import'),
  'family graph output includes the root person'
);
select throws_ok(
  $$select public.import_family_sheet(
      (select payload from import_payload), 'demo-sheet-import', 'Conflicting Name'
    )$$,
  'conflicting family already exists for slug demo-sheet-import',
  'conflicting target family aborts'
);
select is(
  (select count(*) from public.people where legacy_id like 'mem_10%'),
  4::bigint,
  'conflict leaves the prior import unchanged'
);
select throws_ok(
  $$select public.import_family_sheet(
      jsonb_set(
        (select payload from import_payload),
        '{people,0}',
        ((select payload from import_payload)#>'{people,0}') - 'privacy'
      ),
      'demo-missing-privacy',
      'Missing Privacy'
    )$$,
  'every imported person requires a legacy ID and explicit valid privacy',
  'RPC rejects person input without explicit privacy'
);

select is(
  (public.import_family_sheet(
    jsonb_set(
      (select payload from import_payload),
      '{people}',
      (select jsonb_agg(person || '{"privacy":"family"}'::jsonb)
       from jsonb_array_elements((select payload from import_payload)->'people') person)
    ),
    'demo-overlap-family',
    'Overlap Family'
  )->>'no_op')::boolean,
  false,
  'a family-private import can reuse sheet-local legacy IDs'
);
select is(
  (public.import_family_sheet(
    jsonb_set(
      (select payload from import_payload),
      '{people}',
      (select jsonb_agg(person || '{"privacy":"private"}'::jsonb)
       from jsonb_array_elements((select payload from import_payload)->'people') person)
    ),
    'demo-overlap-private',
    'Overlap Private'
  )->>'no_op')::boolean,
  false,
  'a private import can reuse sheet-local legacy IDs'
);
select ok(
  (select count(*) = 3 and count(distinct id) = 3
   from public.people where legacy_id = 'mem_101'),
  'overlapping legacy IDs create distinct slug-qualified people'
);
select ok(
  (select count(*) = 3 and count(distinct membership.person_id) = 3
   from public.family_memberships membership
   where membership.legacy_id = 'mem_101' and membership.legacy_numeric_id = 101),
  'family memberships retain distinct composite legacy identities'
);
select ok(
  (select count(*) = 8
   from public.person_revisions revision
   join public.family_memberships membership on membership.person_id = revision.person_id
   join public.families family on family.id = membership.family_id
   where (family.slug = 'demo-overlap-family' and revision.privacy = 'family')
      or (family.slug = 'demo-overlap-private' and revision.privacy = 'private'))
  and (select count(*) = 4
       from public.life_events event
       join public.family_memberships membership on membership.person_id = event.person_id
       join public.families family on family.id = membership.family_id
       where family.slug in ('demo-overlap-family', 'demo-overlap-private'))
  and (select count(*) = 2
       from public.media_revisions media
       join public.family_memberships membership on membership.person_id = media.person_id
       join public.families family on family.id = membership.family_id
       where family.slug in ('demo-overlap-family', 'demo-overlap-private')),
  'restricted privacy and approved related records are preserved in storage'
);

set local role anon;
select ok(
  jsonb_array_length(public.get_family_graph(array[
    md5('soyagaci:family:demo-overlap-family')::uuid,
    md5('soyagaci:family:demo-overlap-private')::uuid
  ])->'people') = 0
  and jsonb_array_length(public.get_family_graph(array[
    md5('soyagaci:family:demo-overlap-family')::uuid,
    md5('soyagaci:family:demo-overlap-private')::uuid
  ])->'life_events') = 0
  and jsonb_array_length(public.get_family_graph(array[
    md5('soyagaci:family:demo-overlap-family')::uuid,
    md5('soyagaci:family:demo-overlap-private')::uuid
  ])->'media') = 0
  and not exists (
    select 1
    from jsonb_array_elements(public.get_family_graph(array[
      md5('soyagaci:family:demo-overlap-family')::uuid,
      md5('soyagaci:family:demo-overlap-private')::uuid
    ])->'families') family
    where family->'root_person_id' <> 'null'::jsonb
  ),
  'anonymous graph hides family/private people, events, media, and root IDs'
);
select is(
  jsonb_array_length(public.get_family_graph(array[
    md5('soyagaci:family:demo-sheet-import')::uuid
  ])->'people'),
  4,
  'anonymous graph still exposes explicitly public imports'
);
reset role;

select * from finish();
rollback;
