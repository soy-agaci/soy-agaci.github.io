insert into storage.buckets (id, name, public)
values ('media', 'media', true)
on conflict (id) do update set public = true;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public media is readable'
  ) then
    create policy "public media is readable"
    on storage.objects for select
    to public
    using (bucket_id = 'media');
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'public edits may upload media'
  ) then
    create policy "public edits may upload media"
    on storage.objects for insert
    to anon, authenticated
    with check (bucket_id = 'media');
  end if;
end $$;
