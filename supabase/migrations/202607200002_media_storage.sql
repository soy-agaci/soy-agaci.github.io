insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

create policy "public media is readable"
on storage.objects for select
to public
using (bucket_id = 'media');

create policy "public edits may upload media"
on storage.objects for insert
to anon, authenticated
with check (bucket_id = 'media');
