import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) throw new Error('Faltan las credenciales de Supabase.');

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const normalizeTitle = (value) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();

const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
if (usersError) throw usersError;
const users = usersPage?.users ?? [];
if (users.length !== 1) throw new Error(`Se esperaba una cuenta y hay ${users.length}.`);
const userId = users[0].id;

const [{ data: books, error: booksError }, { data: notes, error: notesError }] = await Promise.all([
  supabase.from('books').select('*').eq('user_id', userId).is('deleted_at', null),
  supabase.from('notes').select('*').eq('user_id', userId),
]);
if (booksError) throw booksError;
if (notesError) throw notesError;

const groups = new Map();
for (const book of books ?? []) {
  const key = normalizeTitle(book.title);
  const group = groups.get(key) ?? [];
  group.push(book);
  groups.set(key, group);
}

let consolidated = 0;
let migratedNotes = 0;
const now = new Date().toISOString();

for (const group of groups.values()) {
  const targets = group.filter((book) => book.content_path && book.audio_path);
  if (targets.length !== 1) {
    throw new Error(`No se pudo identificar una ficha cloud unica para "${group[0].title}".`);
  }
  const target = targets[0];
  const oldRows = group.filter((book) => book.id !== target.id);
  if (!oldRows.length) continue;

  const mostRecentlyOpened = [...group]
    .filter((book) => book.last_opened_at)
    .sort((a, b) => new Date(b.last_opened_at) - new Date(a.last_opened_at))[0];
  const createdAt = [...group]
    .map((book) => book.created_at)
    .filter(Boolean)
    .sort()[0] ?? target.created_at;

  const { error: targetError } = await supabase
    .from('books')
    .update({
      current_page: Math.max(...group.map((book) => book.current_page ?? 0)),
      total_pages: Math.max(...group.map((book) => book.total_pages ?? 0)) || null,
      audio_position: Math.max(...group.map((book) => book.audio_position ?? 0)),
      is_finished: group.some((book) => book.is_finished),
      is_archived: mostRecentlyOpened?.is_archived ?? target.is_archived,
      sync_anchors: mostRecentlyOpened?.sync_anchors ?? target.sync_anchors,
      created_at: createdAt,
      last_opened_at: mostRecentlyOpened?.last_opened_at ?? target.last_opened_at,
    })
    .eq('id', target.id);
  if (targetError) throw new Error(`${target.title}: ${targetError.message}`);

  const oldKeys = oldRows.map((book) => book.book_key);
  const noteRows = (notes ?? [])
    .filter((note) => oldKeys.includes(note.book_key))
    .map((note) => ({
      user_id: userId,
      book_key: target.book_key,
      local_note_id: note.local_note_id,
      page: note.page,
      text: note.text,
      quote: note.quote,
      block_start: note.block_start,
      block_end: note.block_end,
      note_date: note.note_date,
    }));
  if (noteRows.length) {
    const { error: noteUpsertError } = await supabase
      .from('notes')
      .upsert(noteRows, { onConflict: 'user_id,book_key,local_note_id' });
    if (noteUpsertError) throw new Error(`${target.title} (notas): ${noteUpsertError.message}`);
    migratedNotes += noteRows.length;
  }

  const { error: oldRowsError } = await supabase
    .from('books')
    .update({ deleted_at: now, content_path: null, cover_path: null, audio_path: null, cues_path: null })
    .in('id', oldRows.map((book) => book.id));
  if (oldRowsError) throw new Error(`${target.title} (duplicados): ${oldRowsError.message}`);

  consolidated += oldRows.length;
  console.log(`${target.title}: ${oldRows.length} ficha(s) anterior(es) consolidada(s).`);
}

const { count, error: countError } = await supabase
  .from('books')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', userId)
  .is('deleted_at', null);
if (countError) throw countError;

console.log(`OK: ${consolidated} duplicados archivados, ${migratedNotes} notas migradas y ${count} libros activos.`);
