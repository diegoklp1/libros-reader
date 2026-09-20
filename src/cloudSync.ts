import { bookContentKey } from './bookFingerprint';
import type { Book, BookNote, DailyStat } from './BookContext';
import { uploadBodyForUri } from './storage';
import { supabase } from './supabaseClient';

const BUCKET = 'book-files';
const SIGNED_URL_SECONDS = 60 * 60 * 24 * 7;
const failedAudioUploads = new Map<string, string>();

type BookAssetUpdate = Pick<
  Book,
  'bookKey' | 'cloudTextPath' | 'cloudCoverPath' | 'cloudAudioPath' | 'cloudCuesPath' | 'audioSize'
>;

export interface PushResult {
  bookUpdates: Record<string, Partial<BookAssetUpdate>>;
  warnings: string[];
}

interface RemoteBook {
  id: string;
  book_key: string;
  title: string;
  author: string | null;
  description: string | null;
  category: string | null;
  current_page: number;
  total_pages: number | null;
  audio_position: number;
  is_archived: boolean;
  is_finished: boolean;
  sync_anchors: { char: number; time: number }[] | null;
  created_at: string;
  last_opened_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  content_path: string | null;
  cover_path: string | null;
  audio_path: string | null;
  cues_path: string | null;
  audio_size: number | null;
}

const noteUpdatedAt = (n: BookNote) => n.date ?? 0;

function extensionFromUri(uri: string, fallback: string) {
  const clean = uri.split('?')[0].split('#')[0];
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(clean);
  return match?.[1]?.toLowerCase() || fallback;
}

function contentType(kind: 'text' | 'cover' | 'audio' | 'cues', ext: string) {
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

async function uploadAsset(
  userId: string,
  book: Book,
  bookKey: string,
  kind: 'text' | 'cover' | 'audio' | 'cues',
  uri: string
): Promise<{ path: string; size: number }> {
  const fallback = kind === 'text' ? 'txt' : kind === 'cover' ? 'jpg' : kind === 'audio' ? 'mp3' : 'json';
  const ext = extensionFromUri(uri, fallback);
  const revision = book.updatedAt ?? book.createdAt ?? Date.now();
  const path = `${userId}/${bookKey}/${kind}-${revision}.${ext}`;
  const body = await uploadBodyForUri(uri);
  const size = body instanceof Blob ? body.size : body.byteLength;
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    upsert: true,
    cacheControl: '3600',
    contentType: contentType(kind, ext),
  });
  if (error) {
    if (/bucket|not found|row-level security|policy/i.test(error.message)) {
      throw new Error('Falta habilitar el almacenamiento en Supabase. Aplicá docs/supabase_cloud_library.sql.');
    }
    throw error;
  }
  return { path, size };
}

async function syncAssets(userId: string, book: Book, bookKey: string) {
  const update: Partial<BookAssetUpdate> = {};
  const warnings: string[] = [];

  if (book.bookKey !== bookKey) update.bookKey = bookKey;

  if (book.txtUri && !book.cloudTextPath) {
    update.cloudTextPath = (await uploadAsset(userId, book, bookKey, 'text', book.txtUri)).path;
  }
  if (book.coverUri && !book.cloudCoverPath) {
    update.cloudCoverPath = (await uploadAsset(userId, book, bookKey, 'cover', book.coverUri)).path;
  }
  if (book.cuesUri && !book.cloudCuesPath) {
    update.cloudCuesPath = (await uploadAsset(userId, book, bookKey, 'cues', book.cuesUri)).path;
  }
  if (book.audioUri && !book.cloudAudioPath) {
    const previousFailure = failedAudioUploads.get(book.audioUri);
    if (previousFailure) {
      warnings.push(previousFailure);
    } else {
      try {
        const uploaded = await uploadAsset(userId, book, bookKey, 'audio', book.audioUri);
        update.cloudAudioPath = uploaded.path;
        update.audioSize = uploaded.size;
      } catch (error: any) {
        const message = `${book.title}: el libro se sincronizó, pero el audio quedó pendiente (${error?.message ?? 'falló la subida'}).`;
        failedAudioUploads.set(book.audioUri, message);
        warnings.push(message);
      }
    }
  }

  return { update, warnings };
}

async function signedUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error) throw error;
  return data.signedUrl;
}

async function signedAssets(remote: RemoteBook) {
  const [text, cover, audio, cues] = await Promise.all([
    signedUrl(remote.content_path),
    signedUrl(remote.cover_path),
    signedUrl(remote.audio_path),
    signedUrl(remote.cues_path),
  ]);
  return { text, cover, audio, cues };
}

function notesFromRows(rows: any[]): BookNote[] {
  return rows.map((rn) => ({
    id: rn.local_note_id,
    page: rn.page,
    text: rn.text,
    date: rn.note_date,
    quote: rn.quote ?? undefined,
    blockStart: rn.block_start ?? undefined,
    blockEnd: rn.block_end ?? undefined,
  }));
}

function preferLocalAsset(
  localUri: string | null | undefined,
  localPath: string | null | undefined,
  remotePath: string | null,
  remoteUrl: string | null
) {
  // Una fila creada por la versión anterior solo tiene metadatos/progreso.
  // Nunca debe borrar el archivo local por traer una ruta cloud vacía.
  if (!remotePath) return localUri ?? null;
  return localUri && localPath === remotePath ? localUri : remoteUrl;
}

// ------------------------------------------------------------------- pushAll

/** Sube biblioteca, archivos y progreso. Los audios fallidos no bloquean el texto. */
export async function pushAll(
  userId: string,
  books: Book[],
  dailyStats: Record<string, DailyStat>
): Promise<PushResult> {
  const keys = await Promise.all(books.map((b) => bookContentKey(b)));
  const bookUpdates: Record<string, Partial<BookAssetUpdate>> = {};
  const warnings: string[] = [];

  for (let i = 0; i < books.length; i++) {
    const result = await syncAssets(userId, books[i], keys[i]);
    if (Object.keys(result.update).length) bookUpdates[books[i].id] = result.update;
    warnings.push(...result.warnings);
  }

  const bookRows = books.map((b, i) => {
    const cloud = { ...b, ...bookUpdates[b.id] };
    return {
      user_id: userId,
      book_key: keys[i],
      title: b.title,
      author: b.author ?? null,
      description: b.description ?? null,
      category: b.category ?? null,
      current_page: b.currentPage ?? 0,
      total_pages: b.totalPages ?? null,
      audio_position: b.audioPosition ?? 0,
      is_archived: !!b.isArchived,
      is_finished: !!b.isFinished,
      sync_anchors: b.syncAnchors ?? null,
      created_at: new Date(b.createdAt ?? Date.now()).toISOString(),
      last_opened_at: b.lastOpenedAt ? new Date(b.lastOpenedAt).toISOString() : null,
      content_path: cloud.cloudTextPath ?? null,
      cover_path: cloud.cloudCoverPath ?? null,
      audio_path: cloud.cloudAudioPath ?? null,
      cues_path: cloud.cloudCuesPath ?? null,
      audio_size: cloud.audioSize ?? null,
      deleted_at: null,
    };
  });

  if (bookRows.length) {
    const { error } = await supabase.from('books').upsert(bookRows, { onConflict: 'user_id,book_key' });
    if (error) {
      if (/column|schema cache|content_path/i.test(error.message)) {
        throw new Error('Falta actualizar el esquema de Supabase. Aplicá docs/supabase_cloud_library.sql.');
      }
      throw error;
    }
  }

  for (let i = 0; i < books.length; i++) {
    const bookKey = keys[i];
    const notes = books[i].notes ?? [];
    const { error: deleteError } = await supabase.from('notes').delete().eq('user_id', userId).eq('book_key', bookKey);
    if (deleteError) throw deleteError;
    if (notes.length) {
      const noteRows = notes.map((n) => ({
        user_id: userId,
        book_key: bookKey,
        local_note_id: n.id,
        page: n.page ?? 0,
        text: n.text ?? '',
        quote: n.quote ?? null,
        block_start: n.blockStart ?? null,
        block_end: n.blockEnd ?? null,
        note_date: n.date ?? Date.now(),
      }));
      const { error } = await supabase.from('notes').insert(noteRows);
      if (error) throw error;
    }
  }

  const statRows = Object.values(dailyStats).map((s) => ({
    user_id: userId,
    stat_date: s.date,
    minutes_listened: s.minutesListened,
    pages_read: s.pagesRead,
    highlights_made: s.highlightsMade,
    books_opened: s.booksOpened,
  }));
  if (statRows.length) {
    const { error } = await supabase.from('daily_stats').upsert(statRows, { onConflict: 'user_id,stat_date' });
    if (error) throw error;
  }

  return { bookUpdates, warnings };
}

// -------------------------------------------------------------- pullAndMerge

interface MergeResult {
  books: Book[];
  dailyStats: Record<string, DailyStat>;
  changed: boolean;
}

/** Trae la biblioteca completa, firma sus archivos privados y combina progreso. */
export async function pullAndMerge(
  userId: string,
  localBooks: Book[],
  localDailyStats: Record<string, DailyStat>
): Promise<MergeResult> {
  const [{ data: remoteBooks, error: e1 }, { data: remoteNotes, error: e2 }, { data: remoteStats, error: e3 }] =
    await Promise.all([
      supabase.from('books').select('*').eq('user_id', userId),
      supabase.from('notes').select('*').eq('user_id', userId),
      supabase.from('daily_stats').select('*').eq('user_id', userId),
    ]);
  if (e1) throw e1;
  if (e2) throw e2;
  if (e3) throw e3;

  const remotes = (remoteBooks ?? []) as RemoteBook[];
  const notesByBookKey = new Map<string, any[]>();
  for (const n of remoteNotes ?? []) {
    const list = notesByBookKey.get(n.book_key) ?? [];
    list.push(n);
    notesByBookKey.set(n.book_key, list);
  }

  const localKeys = await Promise.all(localBooks.map((b) => bookContentKey(b)));
  const localByKey = new Map(localKeys.map((key, index) => [key, localBooks[index]]));
  const seen = new Set<string>();
  const mergedBooks: Book[] = [];
  let changed = false;

  for (const remote of remotes) {
    const local = localByKey.get(remote.book_key);
    seen.add(remote.book_key);
    const remoteUpdatedAt = new Date(remote.updated_at).getTime();
    const deletedAt = remote.deleted_at ? new Date(remote.deleted_at).getTime() : 0;

    if (deletedAt) {
      if (local) changed = true;
      continue;
    }

    if (!local && !remote.content_path) continue;

    const urls = await signedAssets(remote);
    const remoteNotesForBook = notesFromRows(notesByBookKey.get(remote.book_key) ?? []);

    if (!local) {
      changed = true;
      mergedBooks.push({
        id: remote.id,
        bookKey: remote.book_key,
        title: remote.title,
        author: remote.author ?? undefined,
        description: remote.description ?? '',
        category: remote.category ?? 'General',
        coverUri: urls.cover,
        txtUri: urls.text,
        audioUri: urls.audio,
        cuesUri: urls.cues,
        cloudTextPath: remote.content_path,
        cloudCoverPath: remote.cover_path,
        cloudAudioPath: remote.audio_path,
        cloudCuesPath: remote.cues_path,
        audioSize: remote.audio_size,
        currentPage: remote.current_page,
        totalPages: remote.total_pages ?? undefined,
        audioPosition: remote.audio_position,
        isArchived: remote.is_archived,
        isFinished: remote.is_finished,
        syncAnchors: remote.sync_anchors ?? undefined,
        notes: remoteNotesForBook,
        createdAt: new Date(remote.created_at).getTime(),
        lastOpenedAt: remote.last_opened_at ? new Date(remote.last_opened_at).getTime() : undefined,
        updatedAt: remoteUpdatedAt,
      });
      continue;
    }

    const localUpdatedAt = local.updatedAt ?? local.lastOpenedAt ?? local.createdAt ?? 0;
    const remoteIsNewer = remoteUpdatedAt > localUpdatedAt;
    let merged = local;
    if (remoteIsNewer) {
      changed = true;
      merged = {
        ...local,
        bookKey: remote.book_key,
        title: remote.title,
        author: remote.author ?? undefined,
        description: remote.description ?? '',
        category: remote.category ?? 'General',
        currentPage: remote.current_page,
        totalPages: remote.total_pages ?? local.totalPages,
        audioPosition: remote.audio_position,
        isArchived: remote.is_archived,
        isFinished: remote.is_finished,
        syncAnchors: remote.sync_anchors ?? local.syncAnchors,
        lastOpenedAt: remote.last_opened_at ? new Date(remote.last_opened_at).getTime() : local.lastOpenedAt,
        updatedAt: remoteUpdatedAt,
        coverUri: preferLocalAsset(local.coverUri, local.cloudCoverPath, remote.cover_path, urls.cover),
        txtUri: preferLocalAsset(local.txtUri, local.cloudTextPath, remote.content_path, urls.text),
        audioUri: preferLocalAsset(local.audioUri, local.cloudAudioPath, remote.audio_path, urls.audio),
        cuesUri: preferLocalAsset(local.cuesUri, local.cloudCuesPath, remote.cues_path, urls.cues),
        cloudTextPath: remote.content_path,
        cloudCoverPath: remote.cover_path,
        cloudAudioPath: remote.audio_path,
        cloudCuesPath: remote.cues_path,
        audioSize: remote.audio_size,
        notes: remoteNotesForBook,
      };
    }

    if (!remoteIsNewer && remoteNotesForBook.length) {
      const byId = new Map((merged.notes ?? []).map((n) => [n.id, n]));
      for (const remoteNote of remoteNotesForBook) {
        const existing = byId.get(remoteNote.id);
        if (!existing || noteUpdatedAt(remoteNote) > noteUpdatedAt(existing)) byId.set(remoteNote.id, remoteNote);
      }
      const notes = Array.from(byId.values());
      if (notes.length !== (merged.notes ?? []).length) changed = true;
      merged = { ...merged, notes };
    }
    mergedBooks.push(merged);
  }

  localBooks.forEach((book, index) => {
    if (!seen.has(localKeys[index])) mergedBooks.push(book);
  });

  const mergedStats = { ...localDailyStats };
  for (const rs of remoteStats ?? []) {
    const local = mergedStats[rs.stat_date];
    if (!local) {
      changed = true;
      mergedStats[rs.stat_date] = {
        date: rs.stat_date,
        minutesListened: rs.minutes_listened,
        pagesRead: rs.pages_read,
        highlightsMade: rs.highlights_made,
        booksOpened: rs.books_opened,
      };
    } else {
      const booksOpened = Array.from(new Set([...local.booksOpened, ...rs.books_opened]));
      const next: DailyStat = {
        date: rs.stat_date,
        minutesListened: Math.max(local.minutesListened, rs.minutes_listened),
        pagesRead: Math.max(local.pagesRead, rs.pages_read),
        highlightsMade: Math.max(local.highlightsMade, rs.highlights_made),
        booksOpened,
      };
      if (JSON.stringify(next) !== JSON.stringify(local)) changed = true;
      mergedStats[rs.stat_date] = next;
    }
  }

  return { books: mergedBooks, dailyStats: mergedStats, changed };
}

// -------------------------------------------------------- pullProgressForBook

export async function pullProgressForBook(
  userId: string,
  book: { id: string; title: string; author?: string; txtUri: string | null; bookKey?: string }
): Promise<Partial<Book> | null> {
  const bookKey = await bookContentKey(book);
  const [{ data: remote, error }, { data: remoteNotes }] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId).eq('book_key', bookKey).is('deleted_at', null).maybeSingle(),
    supabase.from('notes').select('*').eq('user_id', userId).eq('book_key', bookKey),
  ]);
  if (error) throw error;
  if (!remote) return null;

  return {
    bookKey,
    currentPage: remote.current_page,
    totalPages: remote.total_pages ?? undefined,
    audioPosition: remote.audio_position,
    isArchived: remote.is_archived,
    isFinished: remote.is_finished,
    syncAnchors: remote.sync_anchors ?? undefined,
    lastOpenedAt: remote.last_opened_at ? new Date(remote.last_opened_at).getTime() : undefined,
    updatedAt: new Date(remote.updated_at).getTime(),
    notes: notesFromRows(remoteNotes ?? []),
    cloudTextPath: remote.content_path,
    cloudCoverPath: remote.cover_path,
    cloudAudioPath: remote.audio_path,
    cloudCuesPath: remote.cues_path,
    audioSize: remote.audio_size,
  };
}

/** Deja una marca de borrado para que otros dispositivos no lo resuciten. */
export async function deleteBookRemote(userId: string, book: Book): Promise<void> {
  const bookKey = await bookContentKey(book);
  const paths = [book.cloudTextPath, book.cloudCoverPath, book.cloudAudioPath, book.cloudCuesPath]
    .filter((path): path is string => !!path);
  if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
  await supabase.from('notes').delete().eq('user_id', userId).eq('book_key', bookKey);
  const { error } = await supabase
    .from('books')
    .update({
      deleted_at: new Date().toISOString(),
      content_path: null,
      cover_path: null,
      audio_path: null,
      cues_path: null,
    })
    .eq('user_id', userId)
    .eq('book_key', bookKey);
  if (error) throw error;
}

export async function deleteStatsRemote(userId: string): Promise<void> {
  const { error } = await supabase.from('daily_stats').delete().eq('user_id', userId);
  if (error) throw error;
}
