insert into public.parent_links (id, parent_id, child_id)
select relationship.id, relationship.parent_id, relationship.child_id
from (values
  ('b43124d1-0ded-441e-a359-169851f5af01'::uuid, '6a03a061-42f0-f8cb-4eb7-3d563af018f7'::uuid, '859b9de5-a4a3-f47d-6b8a-74f7213a6ca4'::uuid),
  ('b43124d1-0ded-441e-a359-169851f5af02'::uuid, '6a03a061-42f0-f8cb-4eb7-3d563af018f7'::uuid, '917ea827-b2bb-bb74-7bff-6e54a4a4a429'::uuid)
) relationship(id, parent_id, child_id)
join public.people parent on parent.id = relationship.parent_id
join public.people child on child.id = relationship.child_id
on conflict (parent_id, child_id) do nothing;

insert into public.parent_link_revisions (
  id, parent_link_id, status, parent_id, child_id, relationship_type, certainty
)
select
  case child_id
    when '859b9de5-a4a3-f47d-6b8a-74f7213a6ca4' then 'c43124d1-0ded-441e-a359-169851f5af01'::uuid
    else 'c43124d1-0ded-441e-a359-169851f5af02'::uuid
  end,
  id, 'approved', parent_id, child_id, 'biological', 1
from public.parent_links
where parent_id = '6a03a061-42f0-f8cb-4eb7-3d563af018f7'
  and child_id in (
    '859b9de5-a4a3-f47d-6b8a-74f7213a6ca4',
    '917ea827-b2bb-bb74-7bff-6e54a4a4a429'
  )
  and current_revision_id is null
on conflict (id) do nothing;

update public.parent_links link
set current_revision_id = revision.id
from public.parent_link_revisions revision
where revision.parent_link_id = link.id
  and revision.id in (
    'c43124d1-0ded-441e-a359-169851f5af01',
    'c43124d1-0ded-441e-a359-169851f5af02'
  )
  and link.current_revision_id is null;
