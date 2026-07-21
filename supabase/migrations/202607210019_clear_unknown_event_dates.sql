create temporary table unknown_event_date_fixes as
select revision.*,
  md5('soyagaci:unknown-event-date-fix:20260721:' || event.id)::uuid as new_revision_id
from public.life_events event
join public.life_event_revisions revision on revision.id = event.current_revision_id
where revision.date_text = '?';

insert into public.life_event_revisions (
  id, life_event_id, submission_id, base_revision_id, status, created_at,
  event_type, date_start, date_end, date_text, place_text, details, certainty
)
select new_revision_id, life_event_id, null, id, 'approved', now(),
  event_type, date_start, date_end, null, place_text, details, certainty
from unknown_event_date_fixes;

update public.life_events event
set current_revision_id = fix.new_revision_id
from unknown_event_date_fixes fix
where event.id = fix.life_event_id;

update public.life_event_revisions revision
set status = 'superseded'
from unknown_event_date_fixes fix
where revision.id = fix.id;
