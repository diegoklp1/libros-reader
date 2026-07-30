import { bookContentKey } from './bookFingerprint';
import type { Book, BookNote, DailyStat } from './BookContext';
import { supabase } from './supabaseClient';

const noteUpdatedAt = (n: BookNote) => n.date ?? 0;

// ------------------------------------------------------------------- pushAll

/** Sube el estado local completo a Supabase. Se llama tras cada cambio relevante. */
export async function pushAll(
  userId: string,
  books: Book[],
  dailyStats: Record<string, DailyStat>
): Promise<void> {
  const keys = await Promise.all(books.map((b) => bookContentKey(b)));

  const bookRows = books.map((b, i) => ({
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
  }));

  if (bookRows.length) {
    const { error } = await supabase.from('books').upsert(bookRows, { onConflict: 'user_id,book_key' });
    if (error) throw error;
  }

  // Las notas se reemplazan por libro: el merge ya pasó en el pull, así que a
  // esta altura el estado local es la fuente de verdad para lo que se sube.
  for (let i = 0; i < books.length; i++) {
    const bookKey = keys[i];
    const notes = books[i].notes ?? [];
    await supabase.from('notes').delete().eq('user_id', userId).eq('book_key', bookKey);
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
}

// -------------------------------------------------------------- pullAndMerge

interface MergeResult {
  books: Book[];
  dailyStats: Record<string, DailyStat>;
  changed: boolean;
}

/**
 * Trae lo que haya en Supabase y lo combina con el estado local.
 *
 * Solo actualiza libros que YA EXISTEN localmente (mismo book_key, derivado
 * del contenido del archivo): el progreso remoto de un libro que este
 * dispositivo nunca importó no sirve de nada sin el archivo, así que se
 * ignora hasta que alguien lo importe acá (ver `pullProgressForBook`, que se
 * usa justo para ese momento).
 */
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

  let changed = false;
  const notesByBookKey = new Map<string, typeof remoteNotes>();
  for (const n of remoteNotes ?? []) {
    const list = notesByBookKey.get(n.book_key) ?? [];
    list.push(n);
    notesByBookKey.set(n.book_key, list);
  }
  const remoteBookByKey = new Map((remoteBooks ?? []).map((r) => [r.book_key, r]));

  const localKeys = await Promise.all(localBooks.map((b) => bookContentKey(b)));

  const mergedBooks = localBooks.map((local, i) => {
    const bookKey = localKeys[i];
    const remote = remoteBookByKey.get(bookKey);
    let merged = local;

    if (remote) {
      const localUpdatedAt = local.updatedAt ?? local.lastOpenedAt ?? local.createdAt ?? 0;
      const remoteUpdatedAt = new Date(remote.updated_at).getTime();
      if (remoteUpdatedAt > localUpdatedAt) {
        changed = true;
        merged = {
          ...local,
          // El título/autor NO se toma del remoto: es lo único que puede
          // legítimamente diferir entre dispositivos (uno le puso un nombre
          // distinto) y no tiene sentido de "progreso" a sincronizar.
          currentPage: remote.current_page,
          totalPages: remote.total_pages ?? local.totalPages,
          audioPosition: remote.audio_position,
          isArchived: remote.is_archived,
          isFinished: remote.is_finished,
          syncAnchors: remote.sync_anchors ?? local.syncAnchors,
          lastOpenedAt: remote.last_opened_at ? new Date(remote.last_opened_at).getTime() : local.lastOpenedAt,
          updatedAt: remoteUpdatedAt,
        };
      }
    }

    const remoteNotesForBook = notesByBookKey.get(bookKey) ?? [];
    if (remoteNotesForBook.length) {
      const byId = new Map((merged.notes ?? []).map((n) => [n.id, n]));
      for (const rn of remoteNotesForBook) {
        const existing = byId.get(rn.local_note_id);
        const remoteNote: BookNote = {
          id: rn.local_note_id,
          page: rn.page,
          text: rn.text,
          date: rn.note_date,
          quote: rn.quote ?? undefined,
          blockStart: rn.block_start ?? undefined,
          blockEnd: rn.block_end ?? undefined,
        };
        if (!existing || noteUpdatedAt(remoteNote) > noteUpdatedAt(existing)) {
          if (!existing) changed = true;
          byId.set(rn.local_note_id, remoteNote);
        }
      }
      const mergedNotes = Array.from(byId.values());
      if (mergedNotes.length !== (merged.notes ?? []).length || merged !== local) {
        merged = { ...merged, notes: mergedNotes };
      }
    }

    return merged;
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
      const combinedBooksOpened = Array.from(new Set([...local.booksOpened, ...rs.books_opened]));
      const next: DailyStat = {
        date: rs.stat_date,
        minutesListened: Math.max(local.minutesListened, rs.minutes_listened),
        pagesRead: Math.max(local.pagesRead, rs.pages_read),
        highlightsMade: Math.max(local.highlightsMade, rs.highlights_made),
        booksOpened: combinedBooksOpened,
      };
      if (
        next.minutesListened !== local.minutesListened ||
        next.pagesRead !== local.pagesRead ||
        next.highlightsMade !== local.highlightsMade ||
        next.booksOpened.length !== local.booksOpened.length
      ) {
        changed = true;
      }
      mergedStats[rs.stat_date] = next;
    }
  }

  return { books: mergedBooks, dailyStats: mergedStats, changed };
}

// -------------------------------------------------------- pullProgressForBook

/**
 * Se llama justo después de importar un libro nuevo en este dispositivo: si
 * el mismo archivo ya tiene progreso guardado en la nube desde otro
 * dispositivo, lo trae para no arrancar de cero.
 */
export async function pullProgressForBook(
  userId: string,
  book: { id: string; title: string; author?: string; txtUri: string | null }
): Promise<Partial<Book> | null> {
  const bookKey = await bookContentKey(book);
  const [{ data: remote }, { data: remoteNotes }] = await Promise.all([
    supabase.from('books').select('*').eq('user_id', userId).eq('book_key', bookKey).maybeSingle(),
    supabase.from('notes').select('*').eq('user_id', userId).eq('book_key', bookKey),
  ]);
  if (!remote) return null;

  return {
    currentPage: remote.current_page,
    totalPages: remote.total_pages ?? undefined,
    audioPosition: remote.audio_position,
    isArchived: remote.is_archived,
    isFinished: remote.is_finished,
    syncAnchors: remote.sync_anchors ?? undefined,
    lastOpenedAt: remote.last_opened_at ? new Date(remote.last_opened_at).getTime() : undefined,
    updatedAt: new Date(remote.updated_at).getTime(),
    notes: (remoteNotes ?? []).map((rn) => ({
      id: rn.local_note_id,
      page: rn.page,
      text: rn.text,
      date: rn.note_date,
      quote: rn.quote ?? undefined,
      blockStart: rn.block_start ?? undefined,
      blockEnd: rn.block_end ?? undefined,
    })),
  };
}

/** Borra de Supabase el progreso de un libro (se llama al borrarlo localmente). */
export async function deleteBookRemote(
  userId: string,
  book: { id: string; title: string; author?: string; txtUri: string | null }
): Promise<void> {
  const bookKey = await bookContentKey(book);
  await supabase.from('notes').delete().eq('user_id', userId).eq('book_key', bookKey);
  await supabase.from('books').delete().eq('user_id', userId).eq('book_key', bookKey);
}
