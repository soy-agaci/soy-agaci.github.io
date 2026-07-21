create function pg_temp.fix_turkish_text(value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  value := replace(value, 'Ağıralıoğlu', 'Ağıralioğlu');
  value := replace(value, 'Akıfe', 'Akife');
  value := replace(value, 'Ali Serıf', 'Ali Şerif');
  value := replace(value, 'Ayse Guldehen', 'Ayşe Güldehen');
  value := replace(value, 'Aysegül', 'Ayşegül');
  value := replace(value, 'Balci', 'Balcı');
  value := replace(value, 'Catal', 'Çatal');
  value := replace(value, 'Celik', 'Çelik');
  value := replace(value, 'Cerkez', 'Çerkez');
  value := replace(value, 'Gedi̇k', 'Gedik');
  value := replace(value, 'GEDIK', 'GEDİK');
  value := replace(value, 'Gokcen', 'Gökçen');
  value := replace(value, 'Gulcan', 'Gülcan');
  value := replace(value, 'Hamıde', 'Hamide');
  value := replace(value, 'Hanıfe', 'Hanife');
  value := replace(value, 'Hüseyıin', 'Hüseyin');
  value := replace(value, 'Hüseyınoğlu', 'Hüseyinoğlu');
  value := replace(value, 'Irem', 'İrem');
  value := replace(value, 'Keskın', 'Keskin');
  value := replace(value, 'Kürsat', 'Kürşat');
  value := replace(value, 'Nerıman', 'Neriman');
  value := replace(value, 'Nilgun', 'Nilgün');
  value := replace(value, 'Niyazı', 'Niyazi');
  value := replace(value, 'Sakir', 'Şakir');
  value := replace(value, 'Selcuk', 'Selçuk');
  value := replace(value, 'SEÇUK', 'SELÇUK');
  value := replace(value, 'SElÇUK', 'Selçuk');
  value := replace(value, 'Sisman', 'Şişman');
  return value;
end;
$$;

create temporary table turkish_person_fixes as
select revision.*,
  md5('soyagaci:turkish-text-fix:20260721:person:' || person.id)::uuid as new_revision_id,
  pg_temp.fix_turkish_text(revision.given_name) as fixed_given_name,
  pg_temp.fix_turkish_text(revision.middle_names) as fixed_middle_names,
  pg_temp.fix_turkish_text(revision.family_name) as fixed_family_name,
  pg_temp.fix_turkish_text(revision.display_name) as fixed_display_name,
  array(select pg_temp.fix_turkish_text(alias) from unnest(revision.aliases) alias) as fixed_aliases,
  pg_temp.fix_turkish_text(revision.summary) as fixed_summary
from public.people person
join public.person_revisions revision on revision.id = person.current_revision_id
where (revision.given_name, revision.middle_names, revision.family_name,
       revision.display_name, revision.aliases, revision.summary)
  is distinct from
      (pg_temp.fix_turkish_text(revision.given_name),
       pg_temp.fix_turkish_text(revision.middle_names),
       pg_temp.fix_turkish_text(revision.family_name),
       pg_temp.fix_turkish_text(revision.display_name),
       array(select pg_temp.fix_turkish_text(alias) from unnest(revision.aliases) alias),
       pg_temp.fix_turkish_text(revision.summary));

insert into public.person_revisions (
  id, person_id, submission_id, base_revision_id, status, created_at,
  given_name, middle_names, family_name, display_name, aliases, gender,
  is_living, summary, privacy
)
select new_revision_id, person_id, null, id, 'approved', now(),
  fixed_given_name, fixed_middle_names, fixed_family_name, fixed_display_name,
  fixed_aliases, gender, is_living, fixed_summary, privacy
from turkish_person_fixes;

update public.people person
set current_revision_id = fix.new_revision_id
from turkish_person_fixes fix
where person.id = fix.person_id;

update public.person_revisions revision
set status = 'superseded'
from turkish_person_fixes fix
where revision.id = fix.id;

create temporary table turkish_place_fixes as
select revision.*,
  md5('soyagaci:turkish-text-fix:20260721:event:' || event.id)::uuid as new_revision_id,
  case revision.place_text
    when '#NAME?' then null
    when 'Oh' then 'Of'
    when 'Krabudak/OF' then 'Karabudak/Of'
    when 'Istanbul' then 'İstanbul'
    when 'istanbul' then 'İstanbul'
    when 'Izmit' then 'İzmit'
    when 'çaykara' then 'Çaykara'
  end as fixed_place_text
from public.life_events event
join public.life_event_revisions revision on revision.id = event.current_revision_id
where revision.place_text in ('#NAME?', 'Oh', 'Krabudak/OF', 'Istanbul', 'istanbul', 'Izmit', 'çaykara');

insert into public.life_event_revisions (
  id, life_event_id, submission_id, base_revision_id, status, created_at,
  event_type, date_start, date_end, date_text, place_text, details, certainty
)
select new_revision_id, life_event_id, null, id, 'approved', now(),
  event_type, date_start, date_end, date_text, fixed_place_text, details, certainty
from turkish_place_fixes;

update public.life_events event
set current_revision_id = fix.new_revision_id
from turkish_place_fixes fix
where event.id = fix.life_event_id;

update public.life_event_revisions revision
set status = 'superseded'
from turkish_place_fixes fix
where revision.id = fix.id;
