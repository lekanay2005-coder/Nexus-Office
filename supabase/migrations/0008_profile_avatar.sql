-- Addendum 10 Phase 3: avatar storage.
-- Public avatars bucket so profile pages can show uploaded avatars without
-- auth headers. Row-level storage policies are restrictive by default; we add
-- a broad "authenticated users can upload" policy here.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, ARRAY['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do nothing;

create policy "avatar_upload_enabled"
on storage.objects for insert
with check (
  bucket_id = 'avatars'
  and auth.role() = 'authenticated'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy "avatar_read_enabled"
on storage.objects for select
using (bucket_id = 'avatars');

create policy "avatar_update_enabled"
on storage.objects for update
using (bucket_id = 'avatars' and auth.role() = 'authenticated');

create policy "avatar_delete_enabled"
on storage.objects for delete
using (bucket_id = 'avatars' and auth.role() = 'authenticated' and (storage.foldername(name))[1] = auth.uid()::text);
