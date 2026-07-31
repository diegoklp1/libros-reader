import { Ionicons } from '@expo/vector-icons';
import Slider from '@react-native-community/slider';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as NavigationBar from 'expo-navigation-bar';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  FlatList,
  Keyboard,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Appear } from '../components/ui/appear';
import { PressableScale } from '../components/ui/pressable-scale';
import { Segmented } from '../components/ui/segmented';
import { Sheet } from '../components/ui/sheet';
import { BookNote, useBooks } from '../src/BookContext';
import { selectFeedback, successFeedback, tapFeedback } from '../src/haptics';
import { readTextFile } from '../src/storage';
import { ReadingMode, TextWidth, usePreferences } from '../src/PreferencesContext';
import {
  Anchor,
  Block,
  blockAtTime,
  buildTimeline,
  cuesToAnchors,
  parseCues,
  segmentBlocks,
} from '../src/sync';
import {
  layoutFor,
  motion,
  READER_THEME_ORDER,
  READER_THEMES,
  READING_FONT_ORDER,
  READING_FONTS,
  ReaderThemeName,
  ReadingFontKey,
  shadow,
  USE_NATIVE_DRIVER,
} from '../src/theme';
import { resolveUri } from '../src/webFiles';

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Marcar dos fragmentos seguidos cae dentro del mismo milisegundo, asi que
// Date.now() solo no alcanza como identificador.
const genNoteId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const CHARS_PER_PAGE = 4000;

/**
 * Caracteres que lee una persona por minuto en español (~200 palabras a ~5,5
 * caracteres cada una). Es una estimación: sirve para "te faltan 12 min", no
 * para prometer exactitud.
 */
const CHARS_PER_MINUTE = 1100;

/** Ancho de la columna de texto. Un renglón muy largo cansa: el ojo pierde el salto. */
const TEXT_WIDTHS: Record<TextWidth, number> = { narrow: 560, normal: 700, wide: 900 };

const LINE_HEIGHTS = [
  { key: '1.4', label: 'Compacto', value: 1.4 },
  { key: '1.6', label: 'Normal', value: 1.6 },
  { key: '1.9', label: 'Amplio', value: 1.9 },
] as const;

/** Fracción de pantalla, a cada lado, que pasa de página al tocarla. */
const TAP_ZONE = 0.24;

/** Agrupa bloques en páginas sin partir ningún bloque. */
function groupIntoPages(blocks: Block[]): Block[][] {
  const pages: Block[][] = [];
  let current: Block[] = [];
  let count = 0;
  for (const b of blocks) {
    const len = b.text.length;
    if (current.length > 0 && count + len > CHARS_PER_PAGE) {
      pages.push(current);
      current = [];
      count = 0;
    }
    current.push(b);
    count += len;
  }
  if (current.length) pages.push(current);
  return pages;
}

export default function ReaderScreen() {
  const { id, q } = useLocalSearchParams<{ id: string; q?: string }>();
  const { books, isLoading, updateProgress, updateBook, logActivity } = useBooks();
  const { prefs, setPreference } = usePreferences();

  const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = useWindowDimensions();
  const orientationKey = SCREEN_WIDTH > SCREEN_HEIGHT ? 'landscape' : 'portrait';

  const realBook = books.find((b) => b.id === id);
  const book =
    realBook || { id: '0', title: 'Libro', currentPage: 0, audioPosition: 0, txtUri: null, audioUri: null, cuesUri: null, notes: [], isFinished: false, syncAnchors: [] };

  // --- AJUSTES DE LECTURA ---
  // Se leen directo de las preferencias: son la única fuente de verdad y así
  // quedan iguales al volver a abrir el libro o al pasar a otro.
  const themeName = prefs.readerTheme;
  const currentTheme = READER_THEMES[themeName] ?? READER_THEMES.light;
  const readingFont = READING_FONTS[prefs.readingFont] ?? READING_FONTS.literata;
  const readingMode = prefs.readingMode;
  const isScrollMode = readingMode === 'scroll';

  // Cada familia rinde distinto al mismo cuerpo: el factor iguala la altura-x
  // para que cambiar de fuente no parezca cambiar el tamaño.
  const effectiveFontSize = Math.round(prefs.fontSize * readingFont.scale * 10) / 10;
  const lineHeightMult = prefs.lineHeight;

  const columnWidth = TEXT_WIDTHS[prefs.textWidth];

  // Los paneles del lector se pintan con los colores del papel, no con los de
  // la app: abrir un panel blanco sobre un libro en modo noche encandila.
  const sheetTheme = useMemo(() => readerSheetTheme(currentTheme), [currentTheme]);

  const [showControls, setShowControls] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showGoToPage, setShowGoToPage] = useState(false);
  const [pageInput, setPageInput] = useState('');

  // --- TEMPORIZADOR DE APAGADO ---
  // Cuenta en reloj de pared (no en tiempo de reproducción): pensado para "que
  // se apague cuando me duerma", no para pausarse solo si frenás el audio un
  // momento. Se apaga solo, no queda prendido de una sesión a la siguiente.
  const [showSleepSheet, setShowSleepSheet] = useState(false);
  const [sleepEndAt, setSleepEndAt] = useState<number | null>(null);
  const [sleepRemainingMs, setSleepRemainingMs] = useState(0);

  /**
   * Las barras se quedan montadas y entran/salen deslizándose, en vez de
   * aparecer y desaparecer de golpe. Un solo valor las mueve a las dos, así
   * entran y salen a la par.
   */
  const controlsAnim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.timing(controlsAnim, {
      toValue: showControls ? 1 : 0,
      duration: motion.normal,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: USE_NATIVE_DRIVER,
    });
    animation.start();
    return () => animation.stop();
  }, [showControls]); // eslint-disable-line react-hooks/exhaustive-deps

  const topBarStyle = {
    opacity: controlsAnim,
    transform: [{ translateY: controlsAnim.interpolate({ inputRange: [0, 1], outputRange: [-64, 0] }) }],
  };

  const bottomBarStyle = {
    opacity: controlsAnim,
    transform: [{ translateY: controlsAnim.interpolate({ inputRange: [0, 1], outputRange: [220, 0] }) }],
  };

  // --- AUDIO (expo-audio; tiempos en SEGUNDOS) ---
  // El reproductor necesita una URL que pueda abrir ahora: en web la de
  // IndexedDB se traduce a una URL de esta sesión.
  const audioSource = useMemo(() => resolveUri(book.audioUri), [book.audioUri]);
  const player = useAudioPlayer(audioSource ? { uri: audioSource } : null);
  const status = useAudioPlayerStatus(player);
  const isPlaying = status.playing;
  const position = status.currentTime || 0;
  const duration = status.duration || 0;
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const audioRestored = useRef(false);

  useEffect(() => {
    // shouldPlayInBackground: en Android arma el servicio de MediaSession que ya
    // trae expo-audio (controles en notificacion/pantalla de bloqueo); en iOS
    // depende de declarar `UIBackgroundModes: ['audio']` en app.json.
    setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!audioRestored.current && status.isLoaded && book.audioUri && realBook && book.audioPosition > 0) {
      const dur = status.duration || 0;
      let saved = book.audioPosition;
      if (dur > 0 && saved > dur) saved = saved / 1000; // compat con versiones que guardaban ms
      player.seekTo(Math.min(Math.max(0, saved), dur || saved));
      audioRestored.current = true;
    }
  }, [status.isLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const accumulatedAudioSeconds = useRef(0);
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => {
        accumulatedAudioSeconds.current += 1;
        if (accumulatedAudioSeconds.current >= 60) {
          if (realBook) logActivity(book.id, 'listen', 1);
          accumulatedAudioSeconds.current = 0;
        }
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]); // eslint-disable-line react-hooks/exhaustive-deps

  // --- TEXTO EN BLOQUES ---
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [pages, setPages] = useState<Block[][]>([]);
  const [cueAnchors, setCueAnchors] = useState<Anchor[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoadingText, setIsLoadingText] = useState(true);
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [containerWidth, setContainerWidth] = useState(SCREEN_WIDTH);
  const [containerHeight, setContainerHeight] = useState(SCREEN_HEIGHT);
  const pageInitialized = useRef(false);

  // El margen del texto sale del ancho real del lector, medido con onLayout:
  // así se ajusta al rotar o en pantalla dividida, no solo al abrir el libro.
  const marginHorizontal = layoutFor(containerWidth).isCompact ? 22 : 32;

  // Mapa bloque -> página, para saber a qué página saltar al sincronizar.
  const blockPage = useMemo(() => {
    const map: number[] = [];
    pages.forEach((page, pIdx) => page.forEach((b) => { map[b.index] = pIdx; }));
    return map;
  }, [pages]);

  /** Caracteres acumulados hasta el inicio de cada página, para estimar lo que falta. */
  const charsBeforePage = useMemo(() => {
    const acc: number[] = [];
    let total = 0;
    for (const page of pages) {
      acc.push(total);
      total += page.reduce((sum, b) => sum + b.text.length, 0);
    }
    acc.push(total); // total del libro al final
    return acc;
  }, [pages]);

  const totalChars = charsBeforePage[charsBeforePage.length - 1] || 0;
  const minutesLeft = Math.max(
    0,
    Math.round((totalChars - (charsBeforePage[currentPageIndex] || 0)) / CHARS_PER_MINUTE)
  );

  // --- SINCRONIZACIÓN ---
  const [syncEnabled, setSyncEnabled] = useState(true);
  const [menuBlock, setMenuBlock] = useState<Block | null>(null);
  const scrollRefs = useRef<Record<number, ScrollView | null>>({});
  const blockY = useRef<Record<number, number>>({});
  const autoScrollUntil = useRef(0);

  const anchors = useMemo<Anchor[]>(
    () => [...cueAnchors, ...(realBook?.syncAnchors || [])],
    [cueAnchors, realBook?.syncAnchors]
  );

  const timeline = useMemo(
    () => buildTimeline(blocks, anchors, duration),
    [blocks, anchors, duration]
  );

  const hasAudio = !!book.audioUri;
  const syncActive = hasAudio && syncEnabled && duration > 0 && timeline.length > 0;
  const activeBlock = syncActive ? blockAtTime(timeline, position) : -1;

  // --- BÚSQUEDA Y NOTAS ---
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<number[]>([]);
  const [currentResultIndex, setCurrentResultIndex] = useState(0);
  const [showNotesModal, setShowNotesModal] = useState(false);
  const [newNoteText, setNewNoteText] = useState('');

  // --- RESALTADOS ---
  const [editingNote, setEditingNote] = useState<BookNote | null>(null);
  const [editingText, setEditingText] = useState('');

  const notes = useMemo(() => book.notes || [], [book.notes]);

  /**
   * Bloque -> nota que lo marca. Se arma una vez por cambio de notas para no
   * recorrerlas en cada bloque que se dibuja.
   */
  const markByBlock = useMemo(() => {
    const map: Record<number, BookNote> = {};
    for (const n of notes) {
      if (n.blockStart === undefined) continue;
      for (let i = n.blockStart; i <= (n.blockEnd ?? n.blockStart); i++) map[i] = n;
    }
    return map;
  }, [notes]);

  function blockOfPage(page: number) {
    return pages[page]?.[0]?.index ?? page * 1000;
  }

  /** Notas ordenadas por su lugar en el libro; las escritas a mano, por página. */
  const notesInOrder = useMemo(
    () => [...notes].sort((a, b) => (a.blockStart ?? blockOfPage(a.page)) - (b.blockStart ?? blockOfPage(b.page))),
    [notes, pages] // eslint-disable-line react-hooks/exhaustive-deps
  );

  /**
   * La marca anterior más cercana que todavía no llega hasta `block`. Es lo que
   * habilita "extender": se marca un bloque y después se estira hasta acá.
   */
  const extendableInto = (block: Block): BookNote | null => {
    let mejor: BookNote | null = null;
    for (const n of notes) {
      if (n.blockStart === undefined) continue;
      const fin = n.blockEnd ?? n.blockStart;
      if (fin < block.index && (!mejor || fin > (mejor.blockEnd ?? mejor.blockStart!))) mejor = n;
    }
    if (!mejor) return null;
    // Solo si está cerca: estirar una marca por medio libro nunca es la intención.
    return block.index - (mejor.blockEnd ?? mejor.blockStart!) <= 12 ? mejor : null;
  };

  const pagedListRef = useRef<FlatList>(null);
  const scrollListRef = useRef<FlatList>(null);
  const styles = useMemo(() => makeStyles(), []);

  /**
   * Desplaza a una página concreta (modo paginado).
   * - Usamos scrollToOffset en vez de scrollToIndex: en react-native-web este
   *   último no llega a mover el contenedor.
   * - En web forzamos animated:false porque el scroll suave se cancela contra
   *   el `scroll-snap-type: x mandatory` que RNW aplica por `pagingEnabled`.
   */
  const scrollToPage = useCallback((index: number, animated = true) => {
    pagedListRef.current?.scrollToOffset({
      offset: index * containerWidth,
      animated: Platform.OS === 'web' ? false : animated,
    });
  }, [containerWidth]);

  /** Lleva la vista a un bloque, sirva el modo que sirva. */
  const goToBlock = useCallback((blockIndex: number, animated = true) => {
    if (isScrollMode) {
      scrollListRef.current?.scrollToIndex({ index: blockIndex, animated, viewPosition: 0.25 });
      return;
    }
    const page = blockPage[blockIndex];
    if (page === undefined) return;
    scrollToPage(page, animated);
    const y = blockY.current[blockIndex];
    if (y !== undefined) {
      scrollRefs.current[page]?.scrollTo({ y: Math.max(0, y - SCREEN_HEIGHT * 0.3), animated });
    }
  }, [isScrollMode, blockPage, scrollToPage, SCREEN_HEIGHT]);

  // Carga texto + cues.
  useEffect(() => {
    if (isLoading) return;
    let cancelled = false;

    async function load() {
      setIsLoadingText(true);
      setLoadError(null);

      if (!book.txtUri) {
        if (!cancelled) {
          setLoadError('Este libro no tiene un archivo de texto asociado.');
          setIsLoadingText(false);
        }
        return;
      }

      try {
        const raw = await readTextFile(book.txtUri);
        if (cancelled) return;

        const { blocks: segmented, normalized } = segmentBlocks(raw);
        const paged = groupIntoPages(segmented);
        setBlocks(segmented);
        setPages(paged);

        // Archivo de tiempos opcional.
        if (book.cuesUri) {
          try {
            const cueRaw = await readTextFile(book.cuesUri);
            if (!cancelled) {
              const parsed = parseCues(cueRaw, book.cuesUri);
              setCueAnchors(cuesToAnchors(parsed, normalized, segmented));
            }
          } catch {
            if (!cancelled) setCueAnchors([]);
          }
        } else {
          setCueAnchors([]);
        }

        if (cancelled) return;
        if (!pageInitialized.current) {
          const start = realBook ? Math.min(Math.max(0, realBook.currentPage || 0), Math.max(0, paged.length - 1)) : 0;
          setCurrentPageIndex(start);
          pageInitialized.current = true;
          if (realBook) logActivity(book.id, 'read', 0);
        }
        if (realBook && paged.length && realBook.totalPages !== paged.length) {
          updateBook(book.id, { totalPages: paged.length });
        }
      } catch {
        if (!cancelled) {
          setLoadError(
            'Hubo un error al abrir el archivo de texto. Puede que el archivo original ya no exista: volvé a cargarlo editando el libro.'
          );
        }
      } finally {
        if (!cancelled) setIsLoadingText(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [book.txtUri, book.cuesUri, isLoading]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sigue el bloque activo: cambia de página y hace scroll para mantenerlo a la vista.
  useEffect(() => {
    if (!syncActive || activeBlock < 0 || pages.length === 0) return;

    if (isScrollMode) {
      autoScrollUntil.current = Date.now() + 1200;
      goToBlock(activeBlock);
      const page = blockPage[activeBlock];
      if (page !== undefined && page !== currentPageIndex) setCurrentPageIndex(page);
      return;
    }

    const targetPage = blockPage[activeBlock];
    if (targetPage === undefined) return;

    if (targetPage !== currentPageIndex) {
      autoScrollUntil.current = Date.now() + 1200; // evita contar la página como "leída"
      scrollToPage(targetPage);
      setCurrentPageIndex(targetPage);
    }

    const y = blockY.current[activeBlock];
    if (y !== undefined) {
      const target = Math.max(0, y - SCREEN_HEIGHT * 0.32);
      scrollRefs.current[targetPage]?.scrollTo({ y: target, animated: true });
    }
  }, [activeBlock, syncActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // Si se llegó desde la búsqueda de toda la biblioteca (index.tsx), abre la
  // búsqueda ya con esa palabra en cuanto el texto terminó de cargar.
  useEffect(() => {
    if (isLoadingText || !q || !q.trim()) return;
    setIsSearching(true);
    setSearchQuery(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoadingText, q]);

  // --- BÚSQUEDA ---
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setCurrentResultIndex(0);
      return;
    }
    const query = searchQuery.toLowerCase();
    const results: number[] = [];
    pages.forEach((page, index) => {
      if (page.some((b) => b.text.toLowerCase().includes(query))) results.push(index);
    });
    setSearchResults(results);
    setCurrentResultIndex(0);
    if (results.length > 0) jumpToPage(results[0]);
  }, [searchQuery, pages]); // eslint-disable-line react-hooks/exhaustive-deps

  const jumpToPage = (index: number) => {
    if (isScrollMode) goToBlock(blockOfPage(index));
    else scrollToPage(index);
    setCurrentPageIndex(index);
  };

  const nextSearchResult = () => {
    if (searchResults.length === 0) return;
    const nextIdx = (currentResultIndex + 1) % searchResults.length;
    setCurrentResultIndex(nextIdx);
    jumpToPage(searchResults[nextIdx]);
  };

  const prevSearchResult = () => {
    if (searchResults.length === 0) return;
    const prevIdx = (currentResultIndex - 1 + searchResults.length) % searchResults.length;
    setCurrentResultIndex(prevIdx);
    jumpToPage(searchResults[prevIdx]);
  };

  const renderHighlightedText = (text: string) => {
    if (!searchQuery.trim() || !isSearching) return text;
    const parts = text.split(new RegExp(`(${escapeRegExp(searchQuery)})`, 'gi'));
    return parts.map((part, index) =>
      part.toLowerCase() === searchQuery.toLowerCase() ? (
        <Text key={index} style={{ backgroundColor: currentTheme.highlight, fontFamily: readingFont.bold }}>
          {part}
        </Text>
      ) : (
        <Text key={index}>{part}</Text>
      )
    );
  };

  const toggleControls = () => {
    if (isSearching) Keyboard.dismiss();
    setShowControls((v) => !v);
  };

  /**
   * Un toque sobre el texto hace tres cosas distintas según dónde caiga:
   * los bordes pasan de página y el centro muestra los controles. Es el gesto
   * que ya tienen los lectores de e-book, y evita cruzar la pantalla entera
   * para avanzar.
   */
  const handleTextTap = (pageX: number) => {
    if (isScrollMode || !prefs.tapToTurn || isSearching) {
      toggleControls();
      return;
    }
    if (pageX < containerWidth * TAP_ZONE) {
      if (currentPageIndex > 0) { tapFeedback(); goToPage(currentPageIndex - 1); }
      else toggleControls();
      return;
    }
    if (pageX > containerWidth * (1 - TAP_ZONE)) {
      if (currentPageIndex < pages.length - 1) { tapFeedback(); goToPage(currentPageIndex + 1); }
      else toggleControls();
      return;
    }
    toggleControls();
  };

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    NavigationBar.setVisibilityAsync(showControls ? 'visible' : 'hidden').catch(() => {});
  }, [showControls]);

  useEffect(() => {
    return () => {
      if (Platform.OS === 'android') NavigationBar.setVisibilityAsync('visible').catch(() => {});
    };
  }, []);

  // Cuenta regresiva del temporizador de apagado. Corre en reloj de pared:
  // si pausás el audio un momento, no se detiene ni se reinicia solo.
  useEffect(() => {
    if (!sleepEndAt) return;
    const tick = () => {
      const remaining = sleepEndAt - Date.now();
      if (remaining <= 0) {
        setSleepRemainingMs(0);
        setSleepEndAt(null);
        if (isPlaying) player.pause();
        return;
      }
      setSleepRemainingMs(remaining);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sleepEndAt]);

  const startSleepTimer = (minutes: number) => {
    selectFeedback();
    setPreference('sleepTimerMinutes', minutes);
    setSleepEndAt(Date.now() + minutes * 60_000);
    setShowSleepSheet(false);
  };

  const cancelSleepTimer = () => {
    selectFeedback();
    setSleepEndAt(null);
    setShowSleepSheet(false);
  };

  const extendSleepTimer = (minutes: number) => {
    selectFeedback();
    setSleepEndAt((prev) => (prev ?? Date.now()) + minutes * 60_000);
  };

  const handlePlayPause = () => {
    if (!hasAudio) return;
    tapFeedback();
    if (isPlaying) player.pause();
    else player.play();
  };

  const seekAudio = (seconds: number) => {
    if (!hasAudio) return;
    let newPos = position + seconds;
    if (newPos < 0) newPos = 0;
    if (duration && newPos > duration) newPos = duration;
    player.seekTo(newPos);
  };

  const cycleSpeed = () => {
    if (!hasAudio) return;
    selectFeedback();
    const nextSpeed = playbackSpeed === 1.0 ? 1.25 : playbackSpeed === 1.25 ? 1.5 : playbackSpeed === 1.5 ? 2.0 : 1.0;
    setPlaybackSpeed(nextSpeed);
    player.shouldCorrectPitch = true;
    player.setPlaybackRate(nextSpeed);
  };

  const formatTime = (totalSeconds: number) => {
    const s = Math.max(0, Math.floor(totalSeconds));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // --- ACCIONES DE CALIBRACIÓN ---
  const playFromBlock = async (block: Block) => {
    setMenuBlock(null);
    if (!hasAudio || timeline.length === 0) return;
    // Clamp defensivo: nunca saltar al final exacto ni fuera de rango.
    const raw = timeline[block.index] || 0;
    const target = duration > 0 ? Math.min(Math.max(0, raw), Math.max(0, duration - 0.5)) : Math.max(0, raw);
    try {
      // Hay que ESPERAR el salto antes de reproducir: si el audio estaba pausado,
      // llamar a play() antes de que termine el seek deja el reproductor en silencio.
      await player.seekTo(target);
    } catch {
      // Si el seek falla igual intentamos reproducir desde donde esté.
    }
    player.play();
  };

  const anchorHere = (block: Block) => {
    setMenuBlock(null);
    if (!hasAudio || !realBook) return;
    const next = [...(realBook.syncAnchors || []).filter((a) => Math.abs(a.char - block.charStart) > 50), { char: block.charStart, time: position }];
    next.sort((a, b) => a.char - b.char);
    updateBook(book.id, { syncAnchors: next });
    successFeedback();
  };

  const clearAnchors = () => {
    setMenuBlock(null);
    if (realBook) updateBook(book.id, { syncAnchors: [] });
  };

  // --- NAVEGACIÓN ---
  const commitPage = (newPageIndex: number, countAsRead: boolean) => {
    if (newPageIndex === currentPageIndex) return;
    const isAuto = Date.now() < autoScrollUntil.current;
    if (countAsRead && !isAuto && newPageIndex > currentPageIndex && realBook) {
      logActivity(book.id, 'read', newPageIndex - currentPageIndex);
    }
    setCurrentPageIndex(newPageIndex);
    if (realBook) updateProgress(book.id, newPageIndex, position, pages.length);
    if (newPageIndex === pages.length - 1 && realBook && !book.isFinished) {
      successFeedback();
      updateBook(book.id, { isFinished: true, ...(prefs.autoArchive ? { isArchived: true } : {}) });
    }
  };

  const handleScrollEnd = (event: any) => {
    const newPageIndex = Math.round(event.nativeEvent.contentOffset.x / containerWidth);
    commitPage(newPageIndex, true);
  };

  /** Bloque que está arriba de todo en scroll continuo; de ahí sale la "página". */
  const viewableBlockRef = useRef(-1);

  // La referencia al callback tiene que ser estable: FlatList no admite que
  // `onViewableItemsChanged` cambie de identidad entre renders.
  const onViewableBlocksChanged = useRef(({ viewableItems }: any) => {
    const first = viewableItems?.[0]?.item as Block | undefined;
    if (first) viewableBlockRef.current = first.index;
  }).current;

  useEffect(() => {
    if (!isScrollMode || pages.length === 0) return;
    // El bloque visible cambia constantemente al desplazarse: mirarlo cada medio
    // segundo alcanza y evita re-renderizar el lector en cada fotograma.
    const timer = setInterval(() => {
      const blockIndex = viewableBlockRef.current;
      if (blockIndex < 0) return;
      const page = blockPage[blockIndex];
      if (page !== undefined && page !== currentPageIndex) commitPage(page, true);
    }, 500);
    return () => clearInterval(timer);
  }, [isScrollMode, pages.length, blockPage, currentPageIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (pages.length === 0 || isScrollMode) return;
    const timer = setTimeout(() => scrollToPage(currentPageIndex, false), 120);
    return () => clearTimeout(timer);
  }, [containerWidth, isScrollMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Ubica la vista en la página guardada. Corre al terminar de cargar el texto
   * y cada vez que se cambia de modo: en los dos casos la lista se monta de
   * cero y volvería al principio del libro.
   *
   * El retardo existe porque la lista todavía no midió sus filas; sin él, el
   * salto cae en cualquier lado.
   */
  useEffect(() => {
    if (isLoadingText || pages.length === 0 || !pageInitialized.current) return;
    const timer = setTimeout(() => {
      if (isScrollMode) {
        const target = blockOfPage(currentPageIndex);
        scrollListRef.current?.scrollToIndex({ index: target, animated: false, viewPosition: 0 });
      } else {
        scrollToPage(currentPageIndex, false);
      }
    }, 180);
    return () => clearTimeout(timer);
  }, [isScrollMode, isLoadingText]); // eslint-disable-line react-hooks/exhaustive-deps

  const goToPage = (target: number) => {
    if (target < 0 || target > pages.length - 1) return;
    if (isScrollMode) goToBlock(blockOfPage(target));
    else scrollToPage(target);
    setCurrentPageIndex(target);
    if (realBook) updateProgress(book.id, target, position, pages.length);
  };

  const handleBack = () => {
    if (hasAudio) player.pause();
    if (realBook) updateProgress(book.id, currentPageIndex, position, pages.length);
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const saveNote = () => {
    if (!newNoteText.trim() || !realBook) return;
    const newNote: BookNote = { id: genNoteId(), page: currentPageIndex, text: newNoteText.trim(), date: Date.now() };
    updateBook(book.id, { notes: [...(book.notes || []), newNote] });
    logActivity(book.id, 'highlight', 1);
    setNewNoteText('');
    successFeedback();
    Keyboard.dismiss();
  };

  const deleteNote = (noteId: string) => {
    updateBook(book.id, { notes: (book.notes || []).filter((n) => n.id !== noteId) });
  };

  // --- RESALTAR ---
  const guardarNotas = (siguientes: BookNote[]) => updateBook(book.id, { notes: siguientes });

  /** Texto del libro entre dos bloques, para guardarlo como cita. */
  const citaDe = (desde: number, hasta: number) =>
    blocks.slice(desde, hasta + 1).map((b) => b.text).join(' ');

  const marcarBloque = (block: Block) => {
    if (!realBook) return;
    const nota: BookNote = {
      id: genNoteId(),
      page: blockPage[block.index] ?? currentPageIndex,
      text: '',
      date: Date.now(),
      quote: block.text,
      blockStart: block.index,
      blockEnd: block.index,
    };
    guardarNotas([...notes, nota]);
    logActivity(book.id, 'highlight', 1);
    successFeedback();
    setMenuBlock(null);
    abrirComentario(nota);
  };

  const extenderHasta = (nota: BookNote, block: Block) => {
    const desde = nota.blockStart!;
    const actualizada: BookNote = {
      ...nota,
      blockEnd: block.index,
      quote: citaDe(desde, block.index),
    };
    guardarNotas(notes.map((n) => (n.id === nota.id ? actualizada : n)));
    setMenuBlock(null);
    abrirComentario(actualizada);
  };

  const quitarMarca = (nota: BookNote) => {
    guardarNotas(notes.filter((n) => n.id !== nota.id));
    setMenuBlock(null);
  };

  const abrirComentario = (nota: BookNote) => {
    setEditingNote(nota);
    setEditingText(nota.text);
  };

  const guardarComentario = () => {
    if (!editingNote) return;
    guardarNotas(notes.map((n) => (n.id === editingNote.id ? { ...n, text: editingText.trim() } : n)));
    setEditingNote(null);
    setEditingText('');
    Keyboard.dismiss();
  };

  /**
   * Lleva a la nota: primero a su página y después al bloque dentro de ella.
   * El scroll va con un respiro porque la página tiene que montarse antes de
   * que `blockY` sepa dónde quedó el bloque.
   */
  const irANota = (nota: BookNote) => {
    const destino = nota.blockStart !== undefined ? blockPage[nota.blockStart] : nota.page;
    if (destino === undefined) return;
    jumpToPage(destino);
    setShowNotesModal(false);
    if (nota.blockStart === undefined) return;

    if (isScrollMode) {
      setTimeout(() => goToBlock(nota.blockStart!), 250);
      return;
    }

    // La página destino puede no estar montada todavía, y hasta que no lo esté
    // `blockY` no tiene su altura. Se reintenta unas pocas veces antes de
    // rendirse; si no llega, igual quedaste en la página correcta.
    let intentos = 0;
    const acercar = () => {
      const y = blockY.current[nota.blockStart!];
      if (y !== undefined) {
        scrollRefs.current[destino]?.scrollTo({ y: Math.max(0, y - SCREEN_HEIGHT * 0.28), animated: true });
        return;
      }
      if (++intentos < 6) setTimeout(acercar, 150);
    };
    setTimeout(acercar, 250);
  };

  const readingProgress = pages.length > 1 ? (currentPageIndex + 1) / pages.length : 0;
  const anchorCount = realBook?.syncAnchors?.length || 0;

  // --- RENDER DE UN BLOQUE ---
  const renderBlock = (block: Block) => {
    const isActive = block.index === activeBlock;
    const marca = markByBlock[block.index];
    return (
      <View
        key={block.index}
        onLayout={(e) => { blockY.current[block.index] = e.nativeEvent.layout.y; }}
        // La barra al margen es lo que hace reconocible la marca sin teñir el
        // texto: el fondo solo la acompaña.
        style={marca && {
          backgroundColor: currentTheme.markBg,
          borderLeftWidth: 3,
          borderLeftColor: currentTheme.markBar,
          paddingLeft: 10,
          marginLeft: -13,
          borderRadius: 2,
        }}
      >
        <Pressable
          onPress={(e) => handleTextTap(e.nativeEvent.pageX)}
          onLongPress={() => setMenuBlock(block)}
          delayLongPress={350}
        >
          <Text
            selectable
            style={[
              styles.blockText,
              {
                color: currentTheme.text,
                fontFamily: readingFont.regular,
                fontSize: effectiveFontSize,
                lineHeight: effectiveFontSize * lineHeightMult,
                textAlign: prefs.justify ? 'justify' : 'left',
              },
              // El bloque que narra el audio gana sobre la marca: es lo que se
              // mueve, y perderlo de vista molesta mas.
              isActive && {
                backgroundColor: currentTheme.syncHighlight,
                color: currentTheme.syncText,
              },
            ]}
          >
            {renderHighlightedText(block.text)}
          </Text>
        </Pressable>
        {!!marca?.text && (
          <Text style={[styles.markComment, { color: currentTheme.markBar }]} numberOfLines={3}>
            {marca.text}
          </Text>
        )}
      </View>
    );
  };

  const columnStyle = { width: '100%' as const, maxWidth: columnWidth, alignSelf: 'center' as const };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: currentTheme.background }]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar hidden={!showControls} animated barStyle={themeName === 'light' || themeName === 'sepia' ? 'dark-content' : 'light-content'} />

      <View
        style={{ flex: 1 }}
        onLayout={(e) => {
          setContainerWidth(e.nativeEvent.layout.width);
          setContainerHeight(e.nativeEvent.layout.height);
        }}
      >
        {isLoadingText ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={currentTheme.tint} />
            <Text style={[styles.loadingText, { color: currentTheme.text }]}>Preparando el libro…</Text>
          </View>
        ) : loadError ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle-outline" size={48} color={currentTheme.tint} />
            <Text style={[styles.errorText, { color: currentTheme.text }]}>{loadError}</Text>
            <PressableScale style={[styles.errorBtn, { backgroundColor: currentTheme.tint }]} onPress={handleBack} haptic>
              <Text style={styles.errorBtnText}>Volver a la biblioteca</Text>
            </PressableScale>
          </View>
        ) : isScrollMode ? (
          /* --- LECTURA CONTINUA --- */
          <FlatList
            ref={scrollListRef}
            data={blocks}
            keyExtractor={(b) => String(b.index)}
            renderItem={({ item }) => <View style={columnStyle}>{renderBlock(item)}</View>}
            contentContainerStyle={{ paddingHorizontal: marginHorizontal, paddingTop: 80, paddingBottom: 180 }}
            showsVerticalScrollIndicator
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={9}
            onViewableItemsChanged={onViewableBlocksChanged}
            viewabilityConfig={{ itemVisiblePercentThreshold: 10 }}
            // Los bloques tienen alturas distintas: si el salto se pasa de largo,
            // se reintenta una vez que la lista ya midió lo que hay en el medio.
            onScrollToIndexFailed={(info) => {
              setTimeout(() => {
                scrollListRef.current?.scrollToIndex({ index: info.index, animated: false, viewPosition: 0.25 });
              }, 250);
            }}
            ListHeaderComponent={
              <View style={columnStyle}>
                <Text style={[styles.bookTitle, { color: currentTheme.text, fontFamily: readingFont.bold }]}>
                  {book.title}
                </Text>
              </View>
            }
          />
        ) : (
          /* --- LECTURA PAGINADA --- */
          <FlatList
            key={orientationKey}
            ref={pagedListRef}
            data={pages}
            keyExtractor={(_, index) => index.toString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={handleScrollEnd}
            initialScrollIndex={currentPageIndex}
            getItemLayout={(_, index) => ({ length: containerWidth, offset: containerWidth * index, index })}
            initialNumToRender={1}
            maxToRenderPerBatch={1}
            windowSize={3}
            removeClippedSubviews
            renderItem={({ item: pageBlocks, index: pageIdx }) => (
              // Altura explícita: dentro de un FlatList horizontal, `flex: 1` no acota
              // la altura y el ScrollView interno crecería hasta el alto del contenido,
              // dejándolo recortado y sin poder desplazarse.
              <View style={{ width: containerWidth, height: containerHeight }}>
                <ScrollView
                  ref={(r) => { scrollRefs.current[pageIdx] = r; }}
                  style={{ flex: 1 }}
                  contentContainerStyle={{ paddingHorizontal: marginHorizontal, paddingTop: 78, paddingBottom: 170 }}
                  showsVerticalScrollIndicator
                >
                  <View style={columnStyle}>
                    {pageIdx === 0 && (
                      <Text style={[styles.bookTitle, { color: currentTheme.text, fontFamily: readingFont.bold }]}>
                        {book.title}
                      </Text>
                    )}
                    {pageBlocks.map(renderBlock)}
                  </View>
                </ScrollView>
              </View>
            )}
          />
        )}
      </View>

      {/* Línea de progreso al pie: la referencia constante cuando no hay controles. */}
      {!isLoadingText && !loadError && !showControls && (
        <View
          style={[styles.readingProgressTrack, { backgroundColor: currentTheme.text + '1A' }]}
          pointerEvents="none"
        >
          <View style={[styles.readingProgressFill, { width: `${readingProgress * 100}%`, backgroundColor: currentTheme.tint }]} />
        </View>
      )}

      {/* --- BARRA SUPERIOR --- */}
      {!isLoadingText && !loadError && (
        <Animated.View
          pointerEvents={showControls ? 'auto' : 'none'}
          style={[styles.topBar, { backgroundColor: currentTheme.controlBg, borderColor: currentTheme.text + '14' }, topBarStyle]}
        >
          <SafeAreaView edges={['top']}>
            {isSearching ? (
              <View style={styles.barRow}>
                <PressableScale onPress={() => { setIsSearching(false); setSearchQuery(''); }} style={styles.iconButton} scaleTo={0.88}>
                  <Ionicons name="close" size={24} color={currentTheme.text} />
                </PressableScale>
                <TextInput
                  style={[styles.searchInput, { color: currentTheme.text, borderColor: currentTheme.text + '33' }]}
                  placeholder="Buscar palabra…"
                  placeholderTextColor={currentTheme.text + '80'}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus
                />
                <Text style={[styles.searchCount, { color: currentTheme.text }]}>
                  {searchResults.length > 0 ? `${currentResultIndex + 1}/${searchResults.length}` : '0/0'}
                </Text>
                <PressableScale onPress={prevSearchResult} style={styles.iconButton} scaleTo={0.88}>
                  <Ionicons name="chevron-up" size={22} color={currentTheme.text} />
                </PressableScale>
                <PressableScale onPress={nextSearchResult} style={styles.iconButton} scaleTo={0.88}>
                  <Ionicons name="chevron-down" size={22} color={currentTheme.text} />
                </PressableScale>
              </View>
            ) : (
              <View style={styles.barRow}>
                <PressableScale onPress={handleBack} style={styles.iconButton} scaleTo={0.88} accessibilityLabel="Volver">
                  <Ionicons name="chevron-back" size={26} color={currentTheme.text} />
                </PressableScale>

                <PressableScale
                  style={styles.titleBox}
                  scaleTo={0.97}
                  disabled={pages.length <= 1}
                  accessibilityRole="button"
                  accessibilityLabel="Ir a una página"
                  onPress={() => { selectFeedback(); setPageInput(String(currentPageIndex + 1)); setShowGoToPage(true); }}
                >
                  <Text style={[styles.barTitle, { color: currentTheme.text }]} numberOfLines={1}>{book.title}</Text>
                  <Text style={[styles.barSub, { color: currentTheme.text }]} numberOfLines={1}>
                    {pages.length > 0 ? `Pág ${currentPageIndex + 1} de ${pages.length}` : ''}
                    {minutesLeft > 0 ? ` · ~${minutesLeft} min restantes` : ''}
                    {pages.length > 1 ? '  ›' : ''}
                  </Text>
                </PressableScale>

                {/* Solo cuatro acciones: entran cómodas hasta en la pantalla más
                    angosta. El resto vive en el panel de ajustes. */}
                <PressableScale onPress={() => setIsSearching(true)} style={styles.iconButton} scaleTo={0.88} accessibilityLabel="Buscar">
                  <Ionicons name="search" size={21} color={currentTheme.text} />
                </PressableScale>
                <PressableScale onPress={() => setShowNotesModal(true)} style={styles.iconButton} scaleTo={0.88} accessibilityLabel="Notas">
                  <Ionicons name="journal-outline" size={21} color={currentTheme.text} />
                  {notes.length > 0 && (
                    <View style={[styles.dot, { backgroundColor: currentTheme.tint }]} />
                  )}
                </PressableScale>
                <PressableScale onPress={() => { selectFeedback(); setShowSettings(true); }} style={styles.iconButton} scaleTo={0.88} accessibilityLabel="Ajustes de lectura">
                  <Ionicons name="text" size={21} color={currentTheme.text} />
                </PressableScale>
              </View>
            )}
          </SafeAreaView>
        </Animated.View>
      )}

      {/* --- BARRA INFERIOR --- */}
      {!isSearching && !isLoadingText && !loadError && (
        <Animated.View
          pointerEvents={showControls ? 'auto' : 'none'}
          style={[styles.bottomBar, { backgroundColor: currentTheme.controlBg, borderColor: currentTheme.text + '14' }, bottomBarStyle]}
        >
          <SafeAreaView edges={['bottom']}>
            {hasAudio && (
              <View style={styles.audioSection}>
                <View style={styles.sliderRow}>
                  <Text style={[styles.timeText, { color: currentTheme.text }]}>{formatTime(position)}</Text>
                  <Slider
                    style={styles.slider}
                    minimumValue={0}
                    maximumValue={duration || 1}
                    value={Math.min(position, duration || 1)}
                    minimumTrackTintColor={currentTheme.tint}
                    maximumTrackTintColor={currentTheme.text + '33'}
                    thumbTintColor={currentTheme.tint}
                    onSlidingComplete={(val) => player.seekTo(val)}
                  />
                  <Text style={[styles.timeText, { color: currentTheme.text }]}>{formatTime(duration)}</Text>
                </View>

                <View style={styles.transportRow}>
                  <PressableScale onPress={cycleSpeed} style={styles.speedBtn} scaleTo={0.88} accessibilityLabel="Velocidad de reproducción">
                    <Text style={{ color: currentTheme.text, fontFamily: 'InterBold', fontSize: 13 }}>{playbackSpeed}x</Text>
                  </PressableScale>
                  <PressableScale onPress={() => seekAudio(-15)} style={styles.mediaBtn} scaleTo={0.85} accessibilityLabel="Retroceder 15 segundos">
                    <Ionicons name="play-back" size={26} color={currentTheme.text} />
                  </PressableScale>
                  <PressableScale
                    onPress={handlePlayPause}
                    style={[styles.playBtn, { backgroundColor: currentTheme.tint }]}
                    scaleTo={0.9}
                    accessibilityLabel={isPlaying ? 'Pausar' : 'Reproducir'}
                  >
                    <Ionicons name={isPlaying ? 'pause' : 'play'} size={30} color={currentTheme.background} style={{ marginLeft: isPlaying ? 0 : 3 }} />
                  </PressableScale>
                  <PressableScale onPress={() => seekAudio(15)} style={styles.mediaBtn} scaleTo={0.85} accessibilityLabel="Adelantar 15 segundos">
                    <Ionicons name="play-forward" size={26} color={currentTheme.text} />
                  </PressableScale>
                  <PressableScale
                    onPress={() => { selectFeedback(); setSyncEnabled((v) => !v); }}
                    style={styles.speedBtn}
                    scaleTo={0.88}
                    accessibilityLabel={syncEnabled ? 'Desactivar seguimiento' : 'Activar seguimiento'}
                  >
                    <Ionicons name={syncEnabled ? 'link' : 'unlink'} size={20} color={syncEnabled ? currentTheme.tint : currentTheme.text} />
                  </PressableScale>
                  <PressableScale
                    onPress={() => setShowSleepSheet(true)}
                    style={styles.speedBtn}
                    scaleTo={0.88}
                    accessibilityLabel={sleepEndAt ? 'Temporizador de apagado activo' : 'Temporizador de apagado'}
                  >
                    <Ionicons name={sleepEndAt ? 'moon' : 'moon-outline'} size={20} color={sleepEndAt ? currentTheme.tint : currentTheme.text} />
                  </PressableScale>
                </View>

                <Text style={[styles.syncHint, { color: currentTheme.text }]} numberOfLines={1}>
                  {syncEnabled
                    ? anchorCount > 0
                      ? `Sincronización calibrada (${anchorCount} ${anchorCount === 1 ? 'ajuste' : 'ajustes'})`
                      : 'Mantené presionado un párrafo para ajustar la sincronización'
                    : 'Seguimiento desactivado'}
                </Text>

                {sleepEndAt && (
                  <PressableScale onPress={() => setShowSleepSheet(true)} scaleTo={0.97} accessibilityLabel="Ajustar temporizador de apagado">
                    <Text style={[styles.syncHint, { color: currentTheme.tint, marginTop: 2 }]} numberOfLines={1}>
                      Se apaga en {formatTime(sleepRemainingMs / 1000)}
                    </Text>
                  </PressableScale>
                )}
              </View>
            )}

            {/* El avance del libro entero ahora se ve y se controla desde el
                indicador "Pág X de Y" del header (abre el panel de ir a página):
                un deslizador de a 1 paso sobre 365 páginas no permitía llegar a
                una página puntual, así que no ganaba nada frente a los toques en
                los bordes del texto. */}
          </SafeAreaView>
        </Animated.View>
      )}

      {/* --- PANEL DE AJUSTES DE LECTURA --- */}
      <Sheet
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        theme={sheetTheme}
        background={currentTheme.controlBg}
        handleColor={currentTheme.text + '33'}
        draggable={false}
      >
        <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: SCREEN_HEIGHT * 0.68 }}>
          <SettingGroup label="Tema" color={currentTheme.text}>
            <View style={styles.themeRow}>
              {READER_THEME_ORDER.map(({ key, label }) => {
                const t = READER_THEMES[key];
                const active = key === themeName;
                return (
                  <PressableScale
                    key={key}
                    scaleTo={0.93}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    accessibilityLabel={`Tema ${label}`}
                    onPress={() => { selectFeedback(); setPreference('readerTheme', key as ReaderThemeName); }}
                    style={[
                      styles.themeChip,
                      { backgroundColor: t.background, borderColor: active ? currentTheme.tint : currentTheme.text + '25', borderWidth: active ? 2 : 1 },
                    ]}
                  >
                    <Text style={{ fontFamily: 'InterSemi', fontSize: 13, color: t.text }}>{label}</Text>
                  </PressableScale>
                );
              })}
            </View>
          </SettingGroup>

          <SettingGroup label="Tipografía" color={currentTheme.text}>
            {READING_FONT_ORDER.map((key) => {
              const font = READING_FONTS[key];
              const active = key === prefs.readingFont;
              return (
                <PressableScale
                  key={key}
                  scaleTo={0.98}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => { selectFeedback(); setPreference('readingFont', key as ReadingFontKey); }}
                  style={[
                    styles.fontRow,
                    { borderColor: active ? currentTheme.tint : currentTheme.text + '18', backgroundColor: active ? currentTheme.tint + '14' : 'transparent' },
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontFamily: font.regular, fontSize: 17, color: currentTheme.text }}>
                      {font.label}
                    </Text>
                    <Text style={{ fontFamily: 'Inter', fontSize: 11.5, color: currentTheme.text, opacity: 0.55, marginTop: 2 }}>
                      {font.note}
                    </Text>
                  </View>
                  {active && <Ionicons name="checkmark-circle" size={21} color={currentTheme.tint} />}
                </PressableScale>
              );
            })}
          </SettingGroup>

          <SettingGroup label="Tamaño del texto" color={currentTheme.text}>
            <View style={styles.stepperRow}>
              <PressableScale
                style={[styles.stepperBtn, { borderColor: currentTheme.text + '25' }]}
                scaleTo={0.9}
                onPress={() => { tapFeedback(); setPreference('fontSize', Math.max(14, prefs.fontSize - 1)); }}
                accessibilityLabel="Reducir tamaño"
              >
                <Text style={{ fontFamily: 'InterSemi', fontSize: 15, color: currentTheme.text }}>A</Text>
              </PressableScale>

              <View style={{ flex: 1, alignItems: 'center' }}>
                <Text style={{ fontFamily: readingFont.regular, fontSize: Math.min(26, effectiveFontSize), color: currentTheme.text }}>
                  Aa
                </Text>
                <Text style={{ fontFamily: 'Inter', fontSize: 11, color: currentTheme.text, opacity: 0.55, marginTop: 2 }}>
                  {prefs.fontSize} pt
                </Text>
              </View>

              <PressableScale
                style={[styles.stepperBtn, { borderColor: currentTheme.text + '25' }]}
                scaleTo={0.9}
                onPress={() => { tapFeedback(); setPreference('fontSize', Math.min(34, prefs.fontSize + 1)); }}
                accessibilityLabel="Aumentar tamaño"
              >
                <Text style={{ fontFamily: 'InterBold', fontSize: 23, color: currentTheme.text }}>A</Text>
              </PressableScale>
            </View>
          </SettingGroup>

          <SettingGroup label="Interlineado" color={currentTheme.text}>
            <Segmented
              theme={sheetTheme}
              value={String(lineHeightMult)}
              onChange={(v) => setPreference('lineHeight', parseFloat(v))}
              options={LINE_HEIGHTS.map((l) => ({ key: l.key, label: l.label }))}
            />
          </SettingGroup>

          <SettingGroup label="Ancho de la columna" color={currentTheme.text}>
            <Segmented
              theme={sheetTheme}
              value={prefs.textWidth}
              onChange={(v) => setPreference('textWidth', v as TextWidth)}
              options={[
                { key: 'narrow', label: 'Angosta' },
                { key: 'normal', label: 'Normal' },
                { key: 'wide', label: 'Ancha' },
              ]}
            />
          </SettingGroup>

          <SettingGroup label="Modo de lectura" color={currentTheme.text}>
            <Segmented
              theme={sheetTheme}
              value={readingMode}
              onChange={(v) => setPreference('readingMode', v as ReadingMode)}
              options={[
                { key: 'paged', label: 'Páginas', icon: 'book-outline' },
                { key: 'scroll', label: 'Continuo', icon: 'reorder-four-outline' },
              ]}
            />
          </SettingGroup>

          <ToggleRow
            label="Texto justificado"
            hint="Alinea ambos márgenes, como un libro impreso."
            value={prefs.justify}
            onChange={(v) => setPreference('justify', v)}
            theme={currentTheme}
          />

          {!isScrollMode && (
            <ToggleRow
              label="Tocar los bordes pasa de página"
              hint="El centro de la pantalla sigue mostrando los controles."
              value={prefs.tapToTurn}
              onChange={(v) => setPreference('tapToTurn', v)}
              theme={currentTheme}
            />
          )}

          <ToggleRow
            label="Vibración al interactuar"
            hint="Respuesta táctil al marcar, pasar de página o elegir."
            value={prefs.haptics}
            onChange={(v) => setPreference('haptics', v)}
            theme={currentTheme}
          />

          <View style={{ height: 12 }} />
        </ScrollView>
      </Sheet>

      {/* --- IR A LA PÁGINA --- */}
      <Sheet
        visible={showGoToPage}
        onClose={() => setShowGoToPage(false)}
        theme={sheetTheme}
        background={currentTheme.controlBg}
        handleColor={currentTheme.text + '33'}
        draggable={false}
      >
        <Text style={[styles.goToPageTitle, { color: currentTheme.text }]}>Ir a la página</Text>
        <Text style={[styles.goToPageSub, { color: currentTheme.text }]}>
          {pages.length} páginas · {Math.round(readingProgress * 100)}% leído
        </Text>

        <View style={styles.goToPageRow}>
          <TextInput
            style={[styles.goToPageInput, { color: currentTheme.text, borderColor: currentTheme.text + '33' }]}
            value={pageInput}
            onChangeText={(v) => setPageInput(v.replace(/[^0-9]/g, ''))}
            keyboardType="number-pad"
            maxLength={String(pages.length).length}
            selectTextOnFocus
            autoFocus
            accessibilityLabel="Número de página"
            onSubmitEditing={() => {
              const target = parseInt(pageInput, 10);
              if (!target) return;
              goToPage(Math.min(Math.max(target, 1), pages.length) - 1);
              setShowGoToPage(false);
            }}
          />
          <Text style={[styles.goToPageOf, { color: currentTheme.text }]}>de {pages.length}</Text>
        </View>

        <Slider
          style={{ height: 36, marginTop: 4 }}
          minimumValue={1}
          maximumValue={pages.length}
          step={1}
          value={parseInt(pageInput, 10) || currentPageIndex + 1}
          minimumTrackTintColor={currentTheme.tint}
          maximumTrackTintColor={currentTheme.text + '33'}
          thumbTintColor={currentTheme.tint}
          onValueChange={(v) => setPageInput(String(Math.round(v)))}
        />

        <PressableScale
          style={[styles.goToPageBtn, { backgroundColor: currentTheme.tint }]}
          scaleTo={0.97}
          haptic
          accessibilityRole="button"
          onPress={() => {
            const target = parseInt(pageInput, 10);
            if (!target) return;
            goToPage(Math.min(Math.max(target, 1), pages.length) - 1);
            setShowGoToPage(false);
          }}
        >
          <Text style={[styles.goToPageBtnText, { color: currentTheme.background }]}>Ir</Text>
        </PressableScale>
      </Sheet>

      {/* --- TEMPORIZADOR DE APAGADO --- */}
      <Sheet
        visible={showSleepSheet}
        onClose={() => setShowSleepSheet(false)}
        theme={sheetTheme}
        background={currentTheme.controlBg}
        handleColor={currentTheme.text + '33'}
      >
        <Text style={[styles.goToPageTitle, { color: currentTheme.text }]}>Temporizador de apagado</Text>

        {sleepEndAt ? (
          <>
            <Text style={[styles.goToPageSub, { color: currentTheme.text, marginBottom: 4 }]}>
              El audio se detiene en
            </Text>
            <Text style={[styles.sleepCountdown, { color: currentTheme.tint }]}>
              {formatTime(sleepRemainingMs / 1000)}
            </Text>

            <View style={styles.sleepChipsRow}>
              {[5, 10, 15].map((m) => (
                <PressableScale
                  key={m}
                  style={[styles.sleepChip, { borderColor: currentTheme.text + '33' }]}
                  scaleTo={0.94}
                  onPress={() => extendSleepTimer(m)}
                >
                  <Text style={[styles.sleepChipText, { color: currentTheme.text }]}>+{m} min</Text>
                </PressableScale>
              ))}
            </View>

            <PressableScale
              style={[styles.goToPageBtn, { backgroundColor: currentTheme.text + '14', marginTop: 20 }]}
              scaleTo={0.97}
              onPress={cancelSleepTimer}
            >
              <Text style={[styles.goToPageBtnText, { color: currentTheme.text }]}>Desactivar</Text>
            </PressableScale>
          </>
        ) : (
          <>
            <Text style={[styles.goToPageSub, { color: currentTheme.text }]}>
              El audio se pausa solo al cumplirse el tiempo. Útil para dormir escuchando; para sesiones largas
              (viajes, por ejemplo) simplemente no lo actives.
            </Text>

            <View style={styles.sleepChipsRow}>
              {[10, 15, 30, 45, 60, 90].map((m) => (
                <PressableScale
                  key={m}
                  style={[
                    styles.sleepChip,
                    { borderColor: currentTheme.text + '33' },
                    m === prefs.sleepTimerMinutes && { borderColor: currentTheme.tint, backgroundColor: currentTheme.tint + '18' },
                  ]}
                  scaleTo={0.94}
                  onPress={() => startSleepTimer(m)}
                >
                  <Text style={[styles.sleepChipText, { color: currentTheme.text }]}>{m} min</Text>
                </PressableScale>
              ))}
            </View>
          </>
        )}
      </Sheet>

      {/* --- MENÚ DE BLOQUE (marcar y sincronización) --- */}
      <Sheet
        visible={!!menuBlock}
        onClose={() => setMenuBlock(null)}
        theme={sheetTheme}
        background={currentTheme.controlBg}
        handleColor={currentTheme.text + '33'}
      >
        {menuBlock && (() => {
          const marcado = markByBlock[menuBlock.index];
          const extensible = marcado ? null : extendableInto(menuBlock);
          return (
            <>
              <Text style={[styles.blockMenuTitle, { color: currentTheme.text, fontFamily: readingFont.regular }]} numberOfLines={2}>
                “{menuBlock.text.slice(0, 90)}{menuBlock.text.length > 90 ? '…' : ''}”
              </Text>

              {marcado ? (
                <>
                  <BlockAction icon="create-outline" color={currentTheme.markBar} textColor={currentTheme.text}
                    label={marcado.text ? 'Editar comentario' : 'Agregar comentario'}
                    onPress={() => { setMenuBlock(null); abrirComentario(marcado); }} />
                  <BlockAction icon="bookmark" color="#dc3545" textColor="#dc3545"
                    label="Quitar la marca" onPress={() => quitarMarca(marcado)} />
                </>
              ) : (
                <>
                  <BlockAction icon="bookmark-outline" color={currentTheme.markBar} textColor={currentTheme.text}
                    label="Recordar esta parte" onPress={() => marcarBloque(menuBlock)} />
                  {extensible && (
                    <BlockAction
                      icon="arrow-down-outline"
                      color={currentTheme.markBar}
                      textColor={currentTheme.text}
                      label="Extender la marca hasta acá"
                      sub={`Suma ${menuBlock.index - (extensible.blockEnd ?? extensible.blockStart!)} bloque${
                        menuBlock.index - (extensible.blockEnd ?? extensible.blockStart!) === 1 ? '' : 's'
                      } a la marca anterior`}
                      onPress={() => extenderHasta(extensible, menuBlock)}
                    />
                  )}
                </>
              )}

              {hasAudio && (
                <>
                  <View style={[styles.blockMenuDivider, { backgroundColor: currentTheme.text + '18' }]} />
                  <BlockAction icon="play-circle-outline" color={currentTheme.tint} textColor={currentTheme.text}
                    label="Reproducir desde acá" onPress={() => playFromBlock(menuBlock)} />
                  <BlockAction
                    icon="locate-outline"
                    color={currentTheme.tint}
                    textColor={currentTheme.text}
                    label="El audio está acá ahora"
                    sub={`Ajusta la sincronización usando el minuto ${formatTime(position)}`}
                    onPress={() => anchorHere(menuBlock)}
                  />
                  {anchorCount > 0 && (
                    <BlockAction icon="refresh-outline" color="#dc3545" textColor="#dc3545"
                      label={`Borrar calibración (${anchorCount})`} onPress={clearAnchors} />
                  )}
                </>
              )}
            </>
          );
        })()}
      </Sheet>

      {/* --- COMENTARIO DE UN FRAGMENTO MARCADO --- */}
      <Sheet
        visible={!!editingNote}
        onClose={() => { setEditingNote(null); setEditingText(''); }}
        theme={sheetTheme}
        background={currentTheme.controlBg}
        handleColor={currentTheme.text + '33'}
        draggable={false}
      >
        {editingNote && (
          <>
            <View style={[styles.markQuoteBox, { borderLeftColor: currentTheme.markBar, backgroundColor: currentTheme.markBg }]}>
              <Text style={[styles.markQuoteText, { color: currentTheme.text, fontFamily: readingFont.regular }]} numberOfLines={5}>
                {editingNote.quote}
              </Text>
            </View>
            <TextInput
              style={[styles.input, { color: currentTheme.text, borderColor: currentTheme.text + '30', minHeight: 90 }]}
              placeholder="¿Por qué te importa este fragmento?"
              placeholderTextColor={currentTheme.text + '80'}
              value={editingText}
              onChangeText={setEditingText}
              multiline
              autoFocus
            />
            <View style={styles.markActions}>
              <PressableScale onPress={() => { setEditingNote(null); setEditingText(''); }} style={styles.markSecondaryBtn} scaleTo={0.95}>
                <Text style={{ color: currentTheme.text, fontFamily: 'InterSemi' }}>Después</Text>
              </PressableScale>
              <PressableScale onPress={guardarComentario} style={[styles.saveNoteBtn, { backgroundColor: currentTheme.tint, flex: 1 }]} scaleTo={0.97} haptic>
                <Text style={styles.saveNoteBtnText}>Guardar comentario</Text>
              </PressableScale>
            </View>
          </>
        )}
      </Sheet>

      {/* --- NOTAS --- */}
      <Modal visible={showNotesModal} animationType="slide" transparent onRequestClose={() => setShowNotesModal(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalContent, { backgroundColor: currentTheme.controlBg }]}>
            <View style={styles.modalHeader}>
              <View>
                <Text style={[styles.modalTitle, { color: currentTheme.text }]}>Mis notas</Text>
                <Text style={{ fontFamily: 'Inter', fontSize: 12, color: currentTheme.text, opacity: 0.55, marginTop: 2 }}>
                  {notes.length === 0 ? 'Ninguna todavía' : `${notes.length} en este libro`}
                </Text>
              </View>
              <PressableScale onPress={() => setShowNotesModal(false)} scaleTo={0.88} accessibilityLabel="Cerrar notas">
                <Ionicons name="close-circle" size={28} color={currentTheme.text} />
              </PressableScale>
            </View>

            <FlatList
              data={notesInOrder}
              keyExtractor={(item) => item.id}
              style={styles.notesList}
              showsVerticalScrollIndicator={false}
              ListEmptyComponent={
                <View style={{ alignItems: 'center', marginTop: 40, paddingHorizontal: 20 }}>
                  <Ionicons name="bookmark-outline" size={38} color={currentTheme.text} style={{ opacity: 0.35 }} />
                  <Text style={{ color: currentTheme.text, textAlign: 'center', marginTop: 14, opacity: 0.7, fontFamily: 'Inter', lineHeight: 21 }}>
                    Todavía no tenés notas en este libro.{'\n'}
                    Mantené presionado un párrafo y elegí “Recordar esta parte”.
                  </Text>
                </View>
              }
              renderItem={({ item, index }) => {
                const esMarca = item.blockStart !== undefined;
                return (
                  <Appear delay={Math.min(index, 8) * 30} duration={motion.normal}>
                    <PressableScale
                      scaleTo={0.98}
                      style={[
                        styles.noteCard,
                        {
                          backgroundColor: currentTheme.noteBg,
                          borderColor: esMarca ? currentTheme.markBar + '55' : currentTheme.tint + '40',
                        },
                      ]}
                      onPress={() => irANota(item)}
                    >
                      <View style={styles.noteHeader}>
                        <Text style={[styles.notePage, { color: esMarca ? currentTheme.markBar : currentTheme.tint }]}>
                          {esMarca && <Ionicons name="bookmark" size={12} />} Página {item.page + 1}
                        </Text>
                        <PressableScale onPress={() => deleteNote(item.id)} hitSlop={8} scaleTo={0.85}>
                          <Ionicons name="trash-outline" size={18} color="#dc3545" />
                        </PressableScale>
                      </View>

                      {!!item.quote && (
                        <View style={[styles.markQuoteBox, { borderLeftColor: currentTheme.markBar, backgroundColor: currentTheme.markBg }]}>
                          <Text style={[styles.markQuoteText, { color: currentTheme.text, fontFamily: readingFont.regular }]} numberOfLines={4}>
                            {item.quote}
                          </Text>
                        </View>
                      )}

                      {item.text ? (
                        <Text style={[styles.noteText, { color: currentTheme.text }]}>{item.text}</Text>
                      ) : (
                        <Pressable onPress={() => { setShowNotesModal(false); abrirComentario(item); }}>
                          <Text style={[styles.noteText, { color: currentTheme.text, opacity: 0.6, fontStyle: 'italic' }]}>
                            Sin comentario todavía — tocá para escribir uno
                          </Text>
                        </Pressable>
                      )}
                    </PressableScale>
                  </Appear>
                );
              }}
            />

            <View style={[styles.noteInputContainer, { backgroundColor: currentTheme.background }]}>
              <Text style={{ fontFamily: 'InterSemi', fontSize: 12, color: currentTheme.tint, marginBottom: 6 }}>
                Agregar nota en la página {currentPageIndex + 1}
              </Text>
              <TextInput
                style={[styles.noteInput, { color: currentTheme.text, borderColor: currentTheme.text + '30' }]}
                placeholder="Escribí tu resumen o pegá una frase acá…"
                placeholderTextColor={currentTheme.text + '60'}
                value={newNoteText}
                onChangeText={setNewNoteText}
                multiline
              />
              <PressableScale style={[styles.saveNoteBtn, { backgroundColor: currentTheme.tint }]} onPress={saveNote} scaleTo={0.97}>
                <Text style={styles.saveNoteBtnText}>Guardar nota</Text>
              </PressableScale>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// --- PIEZAS DEL PANEL DE AJUSTES ---

const SettingGroup: React.FC<{ label: string; color: string; children: React.ReactNode }> = ({ label, color, children }) => (
  <View style={{ marginBottom: 22 }}>
    <Text style={{ fontFamily: 'InterBold', fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color, opacity: 0.5, marginBottom: 10 }}>
      {label}
    </Text>
    {children}
  </View>
);

const ToggleRow: React.FC<{
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
  theme: { text: string; tint: string };
}> = ({ label, hint, value, onChange, theme }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 10, marginBottom: 6 }}>
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: 'InterSemi', fontSize: 14.5, color: theme.text }}>{label}</Text>
      <Text style={{ fontFamily: 'Inter', fontSize: 11.5, color: theme.text, opacity: 0.55, marginTop: 2, lineHeight: 16 }}>{hint}</Text>
    </View>
    <Switch
      value={value}
      onValueChange={(v) => { selectFeedback(); onChange(v); }}
      trackColor={{ false: theme.text + '30', true: theme.tint }}
      thumbColor="#fff"
    />
  </View>
);

const BlockAction: React.FC<{
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  textColor: string;
  label: string;
  sub?: string;
  onPress: () => void;
}> = ({ icon, color, textColor, label, sub, onPress }) => (
  <PressableScale
    scaleTo={0.98}
    haptic
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 }}
  >
    <Ionicons name={icon} size={23} color={color} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: 'InterSemi', fontSize: 15.5, color: textColor }}>{label}</Text>
      {sub && <Text style={{ fontFamily: 'Inter', fontSize: 12, color: textColor, opacity: 0.6, marginTop: 2 }}>{sub}</Text>}
    </View>
  </PressableScale>
);

/**
 * Los paneles del lector usan los colores del papel, no los de la app: abrir
 * un panel blanco sobre un libro en modo noche encandila. Esto arma el Theme
 * mínimo que piden `Sheet` y `Segmented` a partir del tema de lectura.
 */
const readerSheetTheme = (rt: (typeof READER_THEMES)[ReaderThemeName]): any => ({
  dark: false,
  colors: {
    background: rt.background,
    surface: rt.controlBg,
    surfaceAlt: rt.text + '12',
    border: rt.text + '25',
    text: rt.text,
    textSecondary: rt.text + 'AA',
    textMuted: rt.text + '77',
    primary: rt.tint,
    primarySoft: rt.tint + '22',
    onPrimary: rt.background,
    success: rt.tint,
    successSoft: rt.tint + '22',
    danger: '#dc3545',
    dangerSoft: '#dc354522',
    warning: rt.markBar,
    overlay: 'rgba(0,0,0,0.55)',
    shadow: '#000000',
  },
  fonts: { regular: 'Inter', medium: 'InterMedium', semibold: 'InterSemi', bold: 'InterBold', serif: 'Literata', serifBold: 'LiterataBold' },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 },
  radius: { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 },
  motion,
});

const makeStyles = () =>
  StyleSheet.create({
    container: { flex: 1 },

    topBar: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10, borderBottomWidth: StyleSheet.hairlineWidth, ...shadow(5) },
    bottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10, borderTopWidth: StyleSheet.hairlineWidth, ...shadow(8, 'up') },
    barRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, minHeight: 54 },
    iconButton: { padding: 8 },
    titleBox: { flex: 1, paddingHorizontal: 6 },
    barTitle: { fontFamily: 'InterSemi', fontSize: 15 },
    barSub: { fontFamily: 'Inter', fontSize: 11.5, opacity: 0.6, marginTop: 1 },
    dot: { position: 'absolute', top: 6, right: 6, width: 6, height: 6, borderRadius: 3 },

    bookTitle: { fontSize: 23, marginBottom: 28, textAlign: 'center', lineHeight: 32 },
    // El padding/margen negativo va siempre (no solo al resaltar) para que el
    // bloque activo no desplace el texto al aparecer el fondo.
    blockText: { marginBottom: 8, paddingHorizontal: 10, paddingVertical: 6, marginHorizontal: -10, borderRadius: 6 },

    readingProgressTrack: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3, zIndex: 8 },
    readingProgressFill: { height: '100%' },

    loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
    loadingText: { fontFamily: 'Inter', fontSize: 14, opacity: 0.7 },
    errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 16 },
    errorText: { fontFamily: 'Inter', fontSize: 15, textAlign: 'center', lineHeight: 22 },
    errorBtn: { paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
    errorBtnText: { color: '#fff', fontFamily: 'InterBold', fontSize: 14 },

    searchInput: { flex: 1, height: 38, borderWidth: 1, borderRadius: 8, paddingHorizontal: 14, marginHorizontal: 8, fontFamily: 'Inter', fontSize: 14 },
    searchCount: { fontFamily: 'InterSemi', fontSize: 12, marginRight: 4 },

    audioSection: { paddingHorizontal: 18, paddingTop: 12, paddingBottom: 10 },
    sliderRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
    slider: { flex: 1, marginHorizontal: 8, height: 36 },
    timeText: { fontFamily: 'Inter', fontSize: 11.5, width: 42, textAlign: 'center', opacity: 0.75 },
    transportRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4 },
    mediaBtn: { alignItems: 'center', justifyContent: 'center', padding: 6 },
    playBtn: { width: 58, height: 58, borderRadius: 29, justifyContent: 'center', alignItems: 'center', ...shadow(4) },
    speedBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    syncHint: { fontFamily: 'Inter', fontSize: 10.5, textAlign: 'center', opacity: 0.55, marginTop: 8 },

    goToPageTitle: { fontFamily: 'InterBold', fontSize: 17 },
    goToPageSub: { fontFamily: 'Inter', fontSize: 12.5, opacity: 0.6, marginTop: 3, marginBottom: 18 },
    goToPageRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    goToPageInput: {
      flex: 1, borderWidth: 1.5, borderRadius: 12, paddingVertical: 12, paddingHorizontal: 16,
      fontFamily: 'InterBold', fontSize: 20, textAlign: 'center',
    },
    goToPageOf: { fontFamily: 'InterSemi', fontSize: 15, opacity: 0.6 },
    goToPageBtn: { marginTop: 18, borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
    goToPageBtnText: { fontFamily: 'InterBold', fontSize: 16 },

    sleepCountdown: { fontFamily: 'InterBold', fontSize: 40, textAlign: 'center', marginVertical: 14 },
    sleepChipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 },
    sleepChip: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 999, borderWidth: 1.5 },
    sleepChipText: { fontFamily: 'InterSemi', fontSize: 14 },

    themeRow: { flexDirection: 'row', gap: 8 },
    themeChip: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 14, borderRadius: 12 },
    fontRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, marginBottom: 8 },
    stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stepperBtn: { width: 52, height: 52, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },

    blockMenuTitle: { fontSize: 13, opacity: 0.7, marginBottom: 10, fontStyle: 'italic', lineHeight: 19 },
    blockMenuDivider: { height: 1, marginVertical: 6 },
    // Comentario que se ve al pie del fragmento marcado, dentro del texto.
    markComment: { fontFamily: 'InterSemi', fontSize: 12, lineHeight: 17, marginTop: -2, marginBottom: 10, paddingLeft: 2 },
    markQuoteBox: { borderLeftWidth: 3, borderRadius: 4, paddingVertical: 8, paddingHorizontal: 10, marginBottom: 10 },
    markQuoteText: { fontSize: 13, lineHeight: 20 },
    markActions: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    markSecondaryBtn: { paddingVertical: 12, paddingHorizontal: 14 },
    input: { borderWidth: 1, borderRadius: 8, padding: 10, fontFamily: 'Inter', fontSize: 14, textAlignVertical: 'top', marginBottom: 12 },

    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
    modalContent: { height: '82%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, width: '100%', maxWidth: 680, alignSelf: 'center', ...shadow(10, 'up') },
    modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
    modalTitle: { fontFamily: 'InterBold', fontSize: 20 },
    notesList: { flex: 1, marginBottom: 10 },
    noteCard: { padding: 15, borderRadius: 12, marginBottom: 10, borderWidth: 1 },
    noteHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
    notePage: { fontFamily: 'InterBold', fontSize: 12 },
    noteText: { fontFamily: 'Inter', fontSize: 14, lineHeight: 20 },
    noteInputContainer: { padding: 15, borderRadius: 15, ...shadow(5, 'up') },
    noteInput: { borderWidth: 1, borderRadius: 10, padding: 12, minHeight: 70, fontFamily: 'Inter', fontSize: 14, textAlignVertical: 'top', marginBottom: 10 },
    saveNoteBtn: { padding: 13, borderRadius: 9, alignItems: 'center' },
    saveNoteBtnText: { color: '#fff', fontFamily: 'InterBold', fontSize: 14 },
  });
