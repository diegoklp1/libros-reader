import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from './AuthContext';
import {
  cacheLibraryForOffline,
  deleteBookRemote,
  deleteStatsRemote,
  isBookReadyOffline,
  pullAndMerge,
  pullProgressForBook,
  pushAll,
} from './cloudSync';
import { deleteBookFiles } from './storage';
import { clearWebFiles, primeWebFiles, requestPersistentWebStorage } from './webFiles';

// --- INTERFACES DE LIBROS Y NOTAS ---
export interface BookNote {
  id: string;
  page: number;
  /** Comentario del lector. En un resaltado recién hecho todavía está vacío. */
  text: string;
  date: number;
  /**
   * Fragmento del libro que quedó marcado. Las notas escritas a mano antes de
   * existir los resaltados no lo tienen, y por eso es opcional: la app las
   * sigue mostrando igual.
   */
  quote?: string;
  /**
   * Rango de bloques resaltado, ambos inclusive. Se guarda el índice de bloque
   * y no la página porque el bloque no se mueve: sale de segmentar el texto
   * (ver src/sync.ts) y no depende del tamaño de letra ni de la orientación.
   */
  blockStart?: number;
  blockEnd?: number;
}

/** Una nota que nació de marcar texto, y no de escribirla a mano. */
export const esResaltado = (n: BookNote): boolean => n.blockStart !== undefined;

export interface Book {
  id: string;
  title: string;
  author?: string;
  description: string;
  coverUri: string | null;
  txtUri: string | null;
  audioUri: string | null;
  /** Archivo opcional de tiempos (.json/.srt/.vtt) para sincronizar audio y texto. */
  cuesUri?: string | null;
  /** Anclas de calibración manual: posición en caracteres <-> segundo de audio. */
  syncAnchors?: { char: number; time: number }[];
  currentPage: number;
  totalPages?: number;
  audioPosition: number;
  isArchived?: boolean;
  isFinished?: boolean;
  notes?: BookNote[];
  category?: string;
  createdAt?: number;
  lastOpenedAt?: number;
  /** Última modificación local, en ms. Sirve para resolver conflictos al sincronizar con Supabase. */
  updatedAt?: number;
  /** Huella estable compartida por todos los dispositivos. */
  bookKey?: string;
  /** Rutas privadas en Supabase Storage (las URI locales se conservan para offline). */
  cloudTextPath?: string | null;
  cloudCoverPath?: string | null;
  cloudAudioPath?: string | null;
  cloudCuesPath?: string | null;
  audioSize?: number | null;
}

export interface NewBook {
  title: string;
  author?: string;
  description: string;
  coverUri: string | null;
  txtUri: string | null;
  audioUri: string | null;
  cuesUri?: string | null;
  category?: string;
}

// --- ESTADÍSTICAS ---
// Actividad agrupada por día (ej. "2026-03-15")
export interface DailyStat {
  date: string;
  minutesListened: number;
  pagesRead: number;
  highlightsMade: number;
  booksOpened: string[]; // IDs de los libros que abriste este día
}

export interface OfflineDownloadState {
  ready: number;
  total: number;
  isDownloading: boolean;
  error: string | null;
}

interface BookContextType {
  books: Book[];
  dailyStats: Record<string, DailyStat>;
  isLoading: boolean;
  addBook: (book: NewBook, id?: string) => Promise<string>;
  deleteBook: (id: string) => void;
  updateProgress: (id: string, currentPage: number, audioPosition: number, totalPages?: number) => void;
  updateBook: (id: string, updatedData: Partial<Book>) => void;
  logActivity: (bookId: string, type: 'listen' | 'read' | 'highlight', value: number) => void;
  clearBooks: () => Promise<void>;
  clearStats: () => Promise<void>;
  resetAllData: () => Promise<void>;
  isSyncing: boolean;
  lastSyncedAt: number | null;
  syncError: string | null;
  syncWarning: string | null;
  offlineDownload: OfflineDownloadState;
  syncNow: () => Promise<void>;
}

const BookContext = createContext<BookContextType | undefined>(undefined);

export const genId = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/**
 * Clave "YYYY-MM-DD" del día, en horario local.
 *
 * `toISOString()` convierte a UTC: leyendo a las 22:00 en Argentina el registro
 * caía en el día siguiente, y la racha se cortaba sola. Se calcula a mano para
 * que el día sea el que el lector tiene en su reloj.
 */
export const dateKey = (d: Date = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const BookProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [books, setBooks] = useState<Book[]>([]);
  const [dailyStats, setDailyStats] = useState<Record<string, DailyStat>>({});
  const [isLoading, setIsLoading] = useState(true);
  // Evita que los efectos de guardado sobrescriban el almacenamiento con
  // los valores iniciales vacíos antes de terminar la carga (condición de carrera).
  const hydrated = useRef(false);

  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const [offlineDownload, setOfflineDownload] = useState<OfflineDownloadState>({
    ready: 0,
    total: 0,
    isDownloading: false,
    error: null,
  });
  // El pull inicial (al loguear) mezcla estado remoto en el local. Sin esta
  // marca, el efecto de push vería ese cambio de estado y lo subiría de
  // vuelta antes de que termine de asentarse, generando un round-trip inútil.
  const pulledForUser = useRef<string | null>(null);
  const pushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pullInFlight = useRef<Promise<void> | null>(null);
  const lastPullStartedAt = useRef(0);

  // Cargar datos al iniciar
  useEffect(() => {
    const loadData = async () => {
      try {
        const [storedBooks, storedStats] = await Promise.all([
          AsyncStorage.getItem('@books'),
          AsyncStorage.getItem('@dailyStats'),
          // En web hay que dejar listos los archivos guardados antes de mostrar
          // nada: sus URIs no se pueden resolver hasta que esto termina.
          primeWebFiles(),
        ]);
        if (storedBooks) {
          const parsed = JSON.parse(storedBooks) as Book[];
          setBooks(parsed);
          setOfflineDownload({
            ready: parsed.filter(isBookReadyOffline).length,
            total: parsed.length,
            isDownloading: false,
            error: null,
          });
        }
        if (storedStats) setDailyStats(JSON.parse(storedStats));
      } catch (error) {
        console.error('Error loading data', error);
      } finally {
        hydrated.current = true;
        setIsLoading(false);
      }
    };
    loadData();
  }, []);

  // Guardar Libros (solo tras hidratar)
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem('@books', JSON.stringify(books)).catch((e) =>
      console.error('Error saving books', e)
    );
  }, [books]);

  useEffect(() => {
    if (!hydrated.current || offlineDownload.isDownloading) return;
    const ready = books.filter(isBookReadyOffline).length;
    setOfflineDownload((current) => (
      current.ready === ready && current.total === books.length
        ? current
        : { ...current, ready, total: books.length }
    ));
  }, [books, offlineDownload.isDownloading]);

  // Guardar Estadísticas (solo tras hidratar)
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem('@dailyStats', JSON.stringify(dailyStats)).catch((e) =>
      console.error('Error saving stats', e)
    );
  }, [dailyStats]);

  // Sincronización bidireccional: primero combina nube/local, después sube el
  // resultado (incluido el progreso hecho offline) y finalmente deja una copia
  // permanente de cada archivo privado en el dispositivo.
  const syncNow = useCallback(async () => {
    if (isLoading || !userId) return;
    if (pullInFlight.current) return pullInFlight.current;
    lastPullStartedAt.current = Date.now();
    setIsSyncing(true);

    const task = (async () => {
      try {
        const pulled = await pullAndMerge(userId, books, dailyStats);
        let merged = pulled.books;
        setBooks(merged);
        setDailyStats(pulled.dailyStats);

        const pushed = await pushAll(userId, merged, pulled.dailyStats);
        if (Object.keys(pushed.bookUpdates).length) {
          merged = merged.map((book) => (
            pushed.bookUpdates[book.id] ? { ...book, ...pushed.bookUpdates[book.id] } : book
          ));
          setBooks(merged);
        }

        setSyncError(null);
        setLastSyncedAt(Date.now());
        setIsSyncing(false);
        await requestPersistentWebStorage();
        setOfflineDownload({
          ready: merged.filter(isBookReadyOffline).length,
          total: merged.length,
          isDownloading: true,
          error: null,
        });

        const cached = await cacheLibraryForOffline(merged, (cachedBook, ready, total) => {
          setBooks((current) => current.map((book) => (
            book.id === cachedBook.id
              ? {
                  ...book,
                  txtUri: cachedBook.txtUri,
                  coverUri: cachedBook.coverUri,
                  audioUri: cachedBook.audioUri,
                  cuesUri: cachedBook.cuesUri,
                }
              : book
          )));
          setOfflineDownload({ ready, total, isDownloading: true, error: null });
        });

        const warnings = [...pushed.warnings, ...cached.warnings];
        setSyncWarning(warnings.length ? warnings.join(' · ') : null);
        setOfflineDownload({
          ready: cached.ready,
          total: cached.total,
          isDownloading: false,
          error: cached.warnings.length ? 'Algunos archivos quedaron pendientes.' : null,
        });
      } catch (e: any) {
        console.error('Error sincronizando con Supabase (pull)', e);
        setSyncError(e?.message ?? 'No se pudo sincronizar');
        setOfflineDownload((current) => ({ ...current, isDownloading: false }));
      } finally {
        pullInFlight.current = null;
        setIsSyncing(false);
      }
    })();
    pullInFlight.current = task;
    return task;
  }, [userId, isLoading, books, dailyStats]);

  useEffect(() => {
    if (isLoading || !userId || pulledForUser.current === userId) return;
    pulledForUser.current = userId;
    syncNow();
  }, [userId, isLoading, syncNow]);

  // Una biblioteca agregada desde la PC aparece al volver al celular, aunque
  // la sesión haya quedado abierta. El límite evita pulls duplicados al alternar
  // rápidamente entre ventanas.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && Date.now() - lastPullStartedAt.current > 10_000) syncNow();
    });
    return () => subscription.remove();
  }, [syncNow]);

  // Una PWA puede recuperar Internet sin pasar a segundo plano. En ese caso el
  // evento online dispara el mismo merge y sube lo leído durante el viaje.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const handleOnline = () => {
      if (Date.now() - lastPullStartedAt.current > 3_000) syncNow();
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [syncNow]);

  // Al cerrar sesión, permite que el próximo login vuelva a traer datos.
  useEffect(() => {
    if (!userId) pulledForUser.current = null;
  }, [userId]);

  // Sube los cambios locales a Supabase, con un pequeño debounce para no
  // disparar una llamada por cada tecla o cada segundo de audio.
  useEffect(() => {
    if (isLoading || !userId || pulledForUser.current !== userId || offlineDownload.isDownloading) return;
    if (pushTimer.current) clearTimeout(pushTimer.current);
    pushTimer.current = setTimeout(() => {
      setIsSyncing(true);
      pushAll(userId, books, dailyStats)
        .then(({ bookUpdates, warnings }) => {
          if (Object.keys(bookUpdates).length) {
            setBooks((current) => current.map((book) => (
              bookUpdates[book.id] ? { ...book, ...bookUpdates[book.id] } : book
            )));
          }
          setSyncError(null);
          setSyncWarning(warnings.length ? warnings.join(' · ') : null);
          setLastSyncedAt(Date.now());
        })
        .catch((e) => {
          console.error('Error sincronizando con Supabase (push)', e);
          setSyncError(e?.message ?? 'No se pudo sincronizar');
        })
        .finally(() => setIsSyncing(false));
    }, 1500);
    return () => {
      if (pushTimer.current) clearTimeout(pushTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [books, dailyStats, userId, offlineDownload.isDownloading]);

  const addBook = async (newBook: NewBook, id?: string) => {
    const bookId = id ?? genId();
    const now = Date.now();
    let book: Book = {
      ...newBook,
      id: bookId,
      currentPage: 0,
      audioPosition: 0,
      isArchived: false,
      isFinished: false,
      notes: [],
      createdAt: now,
      updatedAt: now,
    };

    if (userId) {
      try {
        const progress = await pullProgressForBook(userId, book);
        if (progress) book = { ...book, ...progress };
      } catch (e) {
        // La primera migración puede todavía no estar aplicada. El alta local
        // sigue siendo válida y el push de abajo mostrará el error accionable.
        console.error('Error trayendo progreso previo del libro', e);
      }
    }

    setBooks((prev) => [...prev, book]);

    // Confirma el alta remota antes de que la pantalla de carga se cierre. Así
    // el usuario puede cerrar la pestaña apenas vuelve a la biblioteca sin
    // cortar la transferencia del texto/portada (y del audio si entra).
    if (userId) {
      setIsSyncing(true);
      try {
        const { bookUpdates, warnings } = await pushAll(userId, [book], {});
        const update = bookUpdates[bookId];
        if (update) setBooks((current) => current.map((item) => item.id === bookId ? { ...item, ...update } : item));
        setSyncError(null);
        setSyncWarning(warnings.length ? warnings.join(' · ') : null);
        setLastSyncedAt(Date.now());
      } catch (e: any) {
        console.error('Error subiendo el libro nuevo', e);
        setSyncError(e?.message ?? 'El libro quedó local, pero no se pudo subir');
      } finally {
        setIsSyncing(false);
      }
    }

    return bookId;
  };

  const deleteBook = (id: string) => {
    const book = books.find((b) => b.id === id);
    setBooks((prev) => prev.filter((book) => book.id !== id));
    deleteBookFiles(id).catch(() => {});
    if (userId && book) {
      deleteBookRemote(userId, book).catch((e) =>
        console.error('Error borrando el libro en Supabase', e)
      );
    }
  };

  const updateProgress = (id: string, currentPage: number, audioPosition: number, totalPages?: number) => {
    setBooks((prev) =>
      prev.map((book) =>
        book.id === id
          ? {
              ...book,
              currentPage,
              audioPosition,
              ...(totalPages !== undefined ? { totalPages } : {}),
              lastOpenedAt: Date.now(),
              updatedAt: Date.now(),
            }
          : book
      )
    );
  };

  const updateBook = (id: string, updatedData: Partial<Book>) => {
    setBooks((prev) =>
      prev.map((book) =>
        book.id === id
          ? { ...book, ...updatedData, updatedAt: updatedData.updatedAt ?? Date.now() }
          : book
      )
    );
  };

  // --- EL NÚCLEO DEL TRACKING ---
  const logActivity = (bookId: string, type: 'listen' | 'read' | 'highlight', value: number = 1) => {
    const today = dateKey();

    setDailyStats((prev) => {
      const todayStat = prev[today] || {
        date: today,
        minutesListened: 0,
        pagesRead: 0,
        highlightsMade: 0,
        booksOpened: [],
      };

      const updatedBooksOpened = todayStat.booksOpened.includes(bookId)
        ? todayStat.booksOpened
        : [...todayStat.booksOpened, bookId];

      return {
        ...prev,
        [today]: {
          ...todayStat,
          booksOpened: updatedBooksOpened,
          minutesListened: type === 'listen' ? todayStat.minutesListened + value : todayStat.minutesListened,
          pagesRead: type === 'read' ? todayStat.pagesRead + value : todayStat.pagesRead,
          highlightsMade: type === 'highlight' ? todayStat.highlightsMade + value : todayStat.highlightsMade,
        },
      };
    });
  };

  // --- FUNCIONES DE BORRADO ---
  const clearBooks = async () => {
    try {
      const ids = books.map((b) => b.id);
      if (userId) await Promise.all(books.map((book) => deleteBookRemote(userId, book)));
      await AsyncStorage.removeItem('@books');
      setBooks([]);
      setOfflineDownload({ ready: 0, total: 0, isDownloading: false, error: null });
      await Promise.all(ids.map((id) => deleteBookFiles(id)));
    } catch (error) {
      console.error(error);
    }
  };

  const clearStats = async () => {
    try {
      if (userId) await deleteStatsRemote(userId);
      await AsyncStorage.removeItem('@dailyStats');
      setDailyStats({});
    } catch (error) {
      console.error(error);
    }
  };

  const resetAllData = async () => {
    try {
      const ids = books.map((b) => b.id);
      if (userId) {
        await Promise.all(books.map((book) => deleteBookRemote(userId, book)));
        await deleteStatsRemote(userId);
      }
      await AsyncStorage.multiRemove(['@books', '@dailyStats']);
      setBooks([]);
      setDailyStats({});
      setOfflineDownload({ ready: 0, total: 0, isDownloading: false, error: null });
      await Promise.all(ids.map((id) => deleteBookFiles(id)));
      // Barre también lo que hubiera quedado suelto de libros ya borrados.
      await clearWebFiles();
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <BookContext.Provider
      value={{
        books,
        dailyStats,
        isLoading,
        addBook,
        deleteBook,
        updateProgress,
        updateBook,
        logActivity,
        clearBooks,
        clearStats,
        resetAllData,
        isSyncing,
        lastSyncedAt,
        syncError,
        syncWarning,
        offlineDownload,
        syncNow,
      }}
    >
      {children}
    </BookContext.Provider>
  );
};

export const useBooks = () => {
  const context = useContext(BookContext);
  if (!context) throw new Error('useBooks must be used within a BookProvider');
  return context;
};
