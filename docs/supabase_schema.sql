-- Esquema de sincronización para LectorLibros (biblioteca y archivos en nube).
-- Correr una sola vez en el SQL Editor de Supabase.

create table if not exists public.books (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Huella del contenido del .txt (tamaño + hash de sus primeros bytes), no
  -- del título/autor: renombrar el libro no debe romper el enlace con su
  -- progreso ya sincronizado. Ver src/bookFingerprint.ts.
  book_key text not null,
  title text not null,
  author text,
  description text,
  category text,
  current_page integer not null default 0,
  total_pages integer,
  audio_position double precision not null default 0,
  is_archived boolean not null default false,
  is_finished boolean not null default false,
  sync_anchors jsonb,
  created_at timestamptz not null default now(),
  last_opened_at timestamptz,
  updated_at timestamptz not null default now(),
  content_path text,
  cover_path text,
  audio_path text,
  cues_path text,
  audio_size bigint,
  deleted_at timestamptz,
  unique (user_id, book_key)
);

create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  book_key text not null,
  local_note_id text not null,
  page integer not null default 0,
  text text not null default '',
  quote text,
  block_start integer,
  block_end integer,
  note_date bigint not null,
  updated_at timestamptz not null default now(),
  unique (user_id, book_key, local_note_id)
);

create table if not exists public.daily_stats (
  user_id uuid not null references auth.users(id) on delete cascade,
  stat_date date not null,
  minutes_listened integer not null default 0,
  pages_read integer not null default 0,
  highlights_made integer not null default 0,
  books_opened text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, stat_date)
);

-- Row Level Security: cada usuario solo ve y toca sus propias filas.
alter table public.books enable row level security;
alter table public.notes enable row level security;
alter table public.daily_stats enable row level security;

create policy "books: propias filas" on public.books
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "notes: propias filas" on public.notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "daily_stats: propias filas" on public.daily_stats
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Mantiene updated_at al dia en cada UPDATE.
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger books_set_updated_at before update on public.books
  for each row execute function public.set_updated_at();
create trigger notes_set_updated_at before update on public.notes
  for each row execute function public.set_updated_at();
create trigger daily_stats_set_updated_at before update on public.daily_stats
  for each row execute function public.set_updated_at();

-- Después de crear las tablas, ejecutar también `supabase_cloud_library.sql`
-- para crear el bucket privado y sus políticas de acceso.
