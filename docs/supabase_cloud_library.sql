-- Migración: biblioteca completa en la nube para LectorLibros.
-- Es idempotente: se puede ejecutar más de una vez en el SQL Editor.

alter table public.books add column if not exists content_path text;
alter table public.books add column if not exists cover_path text;
alter table public.books add column if not exists audio_path text;
alter table public.books add column if not exists cues_path text;
alter table public.books add column if not exists audio_size bigint;
alter table public.books add column if not exists deleted_at timestamptz;

create index if not exists books_user_updated_idx
  on public.books (user_id, updated_at desc);

-- Bucket privado. La app entrega URLs temporales solo al dueño autenticado.
insert into storage.buckets (id, name, public, file_size_limit)
values ('book-files', 'book-files', false, 5368709120)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit;

drop policy if exists "book-files: leer propios" on storage.objects;
drop policy if exists "book-files: subir propios" on storage.objects;
drop policy if exists "book-files: actualizar propios" on storage.objects;
drop policy if exists "book-files: borrar propios" on storage.objects;

create policy "book-files: leer propios" on storage.objects
  for select to authenticated
  using (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "book-files: subir propios" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "book-files: actualizar propios" on storage.objects
  for update to authenticated
  using (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "book-files: borrar propios" on storage.objects
  for delete to authenticated
  using (bucket_id = 'book-files' and (storage.foldername(name))[1] = auth.uid()::text);

