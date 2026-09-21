import { createClient } from '@supabase/supabase-js';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const libraryRoot = path.resolve(process.argv[2] ?? 'LibrosAPP');

if (!supabaseUrl || !serviceKey) {
  throw new Error('Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function cyrb53(value, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

function contentType(kind, ext) {
  if (kind === 'text') return 'text/plain; charset=utf-8';
  if (kind === 'cues') return ext === 'json' ? 'application/json' : 'text/plain; charset=utf-8';
  if (kind === 'audio') {
    if (ext === 'm4a' || ext === 'mp4') return 'audio/mp4';
    if (ext === 'ogg' || ext === 'opus') return 'audio/ogg';
    if (ext === 'wav') return 'audio/wav';
    return 'audio/mpeg';
  }
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  return 'image/jpeg';
}

async function uploadFile(userId, bookKey, kind, relativePath) {
  if (!relativePath) return { cloudPath: null, size: null };
  const localPath = path.resolve(libraryRoot, relativePath);
  const extension = path.extname(localPath).slice(1).toLowerCase() || 'bin';
  const body = await readFile(localPath);
  const cloudPath = `${userId}/${bookKey}/${kind}-seed-v1.${extension}`;
  const { error } = await supabase.storage.from('book-files').upload(cloudPath, body, {
    upsert: true,
    cacheControl: '3600',
    contentType: contentType(kind, extension),
  });
  if (error) throw new Error(`${kind}: ${error.message}`);
  return { cloudPath, size: body.byteLength };
}

const manifest = JSON.parse(await readFile(path.join(libraryRoot, 'manifest.json'), 'utf8'));
if (!Array.isArray(manifest.libros) || manifest.libros.length === 0) {
  throw new Error('El manifest no contiene libros.');
}

const { data: usersPage, error: usersError } = await supabase.auth.admin.listUsers({ page: 1, perPage: 100 });
if (usersError) throw usersError;
const users = usersPage?.users ?? [];
if (users.length !== 1) {
  throw new Error(`Se esperaba exactamente una cuenta en el proyecto y hay ${users.length}.`);
}
const userId = users[0].id;

const { data: existingRows, error: existingError } = await supabase
  .from('books')
  .select('*')
  .eq('user_id', userId);
if (existingError) throw existingError;
const existingByKey = new Map((existingRows ?? []).map((row) => [row.book_key, row]));

let uploadedBytes = 0;
let completed = 0;

for (const book of manifest.libros) {
  const textPath = path.resolve(libraryRoot, book.txt);
  const textBody = await readFile(textPath);
  const textInfo = await stat(textPath);
  const chunk = textBody.subarray(0, 4096).toString('utf8');
  const bookKey = `c_${cyrb53(`${textInfo.size}:${chunk}`)}`;

  const text = await uploadFile(userId, bookKey, 'text', book.txt);
  const cover = await uploadFile(userId, bookKey, 'cover', book.portada);
  const cues = await uploadFile(userId, bookKey, 'cues', book.srt);
  const audio = await uploadFile(userId, bookKey, 'audio', book.audio);
  uploadedBytes += (text.size ?? 0) + (cover.size ?? 0) + (cues.size ?? 0) + (audio.size ?? 0);

  const existing = existingByKey.get(bookKey);
  const row = {
    user_id: userId,
    book_key: bookKey,
    title: book.titulo,
    author: book.autor || null,
    description: book.descripcion || null,
    category: book.categoria || 'General',
    current_page: existing?.current_page ?? 0,
    total_pages: existing?.total_pages ?? null,
    audio_position: existing?.audio_position ?? 0,
    is_archived: existing?.is_archived ?? false,
    is_finished: existing?.is_finished ?? false,
    sync_anchors: existing?.sync_anchors ?? null,
    created_at: existing?.created_at ?? new Date().toISOString(),
    last_opened_at: existing?.last_opened_at ?? null,
    content_path: text.cloudPath,
    cover_path: cover.cloudPath,
    audio_path: audio.cloudPath,
    cues_path: cues.cloudPath,
    audio_size: audio.size,
    deleted_at: null,
  };
  const { error: rowError } = await supabase.from('books').upsert(row, { onConflict: 'user_id,book_key' });
  if (rowError) throw new Error(`${book.titulo}: ${rowError.message}`);

  completed += 1;
  console.log(`[${completed}/${manifest.libros.length}] ${book.titulo} (${(audio.size / 1024 / 1024).toFixed(1)} MB de audio)`);
}

const { count, error: countError } = await supabase
  .from('books')
  .select('*', { count: 'exact', head: true })
  .eq('user_id', userId)
  .is('deleted_at', null);
if (countError) throw countError;

console.log(`OK: ${completed} libros cargados, ${count} libros activos en la nube, ${(uploadedBytes / 1024 / 1024).toFixed(1)} MB transferidos.`);
