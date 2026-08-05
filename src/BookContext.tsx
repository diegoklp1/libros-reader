import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { deleteBookFiles } from './storage';
import { clearWebFiles, primeWebFiles } from './webFiles';

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

interface BookContextType {
  books: Book[];
  dailyStats: Record<string, DailyStat>;
  isLoading: boolean;
  addBook: (book: NewBook, id?: string) => string;
  deleteBook: (id: string) => void;
  updateProgress: (id: string, currentPage: number, audioPosition: number, totalPages?: number) => void;
  updateBook: (id: string, updatedData: Partial<Book>) => void;
  logActivity: (bookId: string, type: 'listen' | 'read' | 'highlight', value: number) => void;
  clearBooks: () => Promise<void>;
  clearStats: () => Promise<void>;
  resetAllData: () => Promise<void>;
}

const BookContext = createContext<BookContextType | undefined>(undefined);

const genId = () =>
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
        if (storedBooks) setBooks(JSON.parse(storedBooks));
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

  // Guardar Estadísticas (solo tras hidratar)
  useEffect(() => {
    if (!hydrated.current) return;
    AsyncStorage.setItem('@dailyStats', JSON.stringify(dailyStats)).catch((e) =>
      console.error('Error saving stats', e)
    );
  }, [dailyStats]);

  const addBook = (newBook: NewBook, id?: string) => {
    const bookId = id ?? genId();
    setBooks((prev) => [
      ...prev,
      {
        ...newBook,
        id: bookId,
        currentPage: 0,
        audioPosition: 0,
        isArchived: false,
        isFinished: false,
        notes: [],
        createdAt: Date.now(),
      },
    ]);
    return bookId;
  };

  const deleteBook = (id: string) => {
    setBooks((prev) => prev.filter((book) => book.id !== id));
    deleteBookFiles(id).catch(() => {});
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
            }
          : book
      )
    );
  };

  const updateBook = (id: string, updatedData: Partial<Book>) => {
    setBooks((prev) =>
      prev.map((book) => (book.id === id ? { ...book, ...updatedData } : book))
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
      await AsyncStorage.removeItem('@books');
      setBooks([]);
      await Promise.all(ids.map((id) => deleteBookFiles(id)));
    } catch (error) {
      console.error(error);
    }
  };

  const clearStats = async () => {
    try {
      await AsyncStorage.removeItem('@dailyStats');
      setDailyStats({});
    } catch (error) {
      console.error(error);
    }
  };

  const resetAllData = async () => {
    try {
      const ids = books.map((b) => b.id);
      await AsyncStorage.multiRemove(['@books', '@dailyStats']);
      setBooks([]);
      setDailyStats({});
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
