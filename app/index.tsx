import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Appear } from '../components/ui/appear';
import { ProgressBar } from '../components/ui/progress-bar';
import { PressableScale } from '../components/ui/pressable-scale';
import { Segmented } from '../components/ui/segmented';
import { Sheet } from '../components/ui/sheet';
import { Book, useBooks } from '../src/BookContext';
import { confirmDialog } from '../src/dialog';
import { selectFeedback } from '../src/haptics';
import { useTheme } from '../src/PreferencesContext';
import { layoutFor, motion, shadow, Theme } from '../src/theme';
import { resolveUri } from '../src/webFiles';

const MAX_CONTENT_WIDTH = 1180;
const GAP = 14;
/** Ancho mínimo con el que una portada todavía se lee bien. */
const MIN_CARD_WIDTH = 158;
/** A partir de acá dejamos de escalonar la entrada: ya nadie mira tan abajo. */
const MAX_STAGGERED = 12;

type SortMode = 'recent' | 'title' | 'progress';
type LibraryTab = 'reading' | 'archived';

const SORT_LABELS: Record<SortMode, string> = {
  recent: 'Recientes',
  title: 'A-Z',
  progress: 'Progreso',
};

const progressPct = (book: Book) => {
  if (book.isFinished) return 1;
  if (book.totalPages && book.totalPages > 1) {
    return Math.min(1, (book.currentPage + 1) / book.totalPages);
  }
  return book.currentPage > 0 ? 0.01 : 0;
};

export default function HomeScreen() {
  const { books, deleteBook, updateBook } = useBooks();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();

  /**
   * El ancho sale de medir el contenedor, no de `useWindowDimensions`.
   * Las dimensiones de ventana no siempre se actualizan (pantalla dividida,
   * plegables, redimensionar la ventana en PC), y ahí la grilla quedaría
   * calculada para un ancho que ya no existe. `onLayout` siempre dice la verdad.
   */
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || windowWidth;

  const layout = useMemo(() => layoutFor(width), [width]);
  const styles = useMemo(() => makeStyles(theme, insets.top, layout.gutter), [theme, insets.top, layout.gutter]);

  // La cantidad de columnas sale del ancho disponible, no de suponer "esto es
  // un teléfono": así funciona igual al rotar o al agrandar la ventana.
  const contentWidth = Math.min(width, MAX_CONTENT_WIDTH);
  const usable = contentWidth - layout.gutter * 2;
  const columns = Math.max(2, Math.min(6, Math.floor((usable + GAP) / (MIN_CARD_WIDTH + GAP))));
  const cardWidth = Math.floor((usable - GAP * (columns - 1)) / columns);

  const [tab, setTab] = useState<LibraryTab>('reading');
  const [selectedCategory, setSelectedCategory] = useState('Todos');
  const [search, setSearch] = useState('');
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [menuBook, setMenuBook] = useState<Book | null>(null);

  const showArchived = tab === 'archived';

  const uniqueCategories = useMemo(() => {
    const cats = books.filter((b) => !!b.isArchived === showArchived).map((b) => b.category || 'General');
    return ['Todos', ...Array.from(new Set(cats)).sort()];
  }, [books, showArchived]);

  const displayedBooks = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = books.filter((book) => {
      const matchesStatus = showArchived ? !!book.isArchived : !book.isArchived;
      const bookCat = book.category || 'General';
      const matchesCategory = selectedCategory === 'Todos' || bookCat === selectedCategory;
      const matchesSearch =
        !q || book.title.toLowerCase().includes(q) || (book.author || '').toLowerCase().includes(q);
      return matchesStatus && matchesCategory && matchesSearch;
    });

    const sorted = [...filtered];
    if (sortMode === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
    else if (sortMode === 'progress') sorted.sort((a, b) => progressPct(b) - progressPct(a));
    else sorted.sort((a, b) => (b.lastOpenedAt || b.createdAt || 0) - (a.lastOpenedAt || a.createdAt || 0));
    return sorted;
  }, [books, showArchived, selectedCategory, search, sortMode]);

  /**
   * El libro que estabas leyendo. Es lo que casi siempre se viene a buscar, así
   * que se muestra entero arriba en lugar de obligar a encontrarlo en la grilla.
   * Solo aparece con la vista "limpia": si filtraste o buscaste, estorbaría.
   */
  const continueBook = useMemo(() => {
    if (showArchived || search.trim() || selectedCategory !== 'Todos') return null;
    return (
      books
        .filter((b) => !b.isArchived && !b.isFinished && b.currentPage > 0 && b.lastOpenedAt)
        .sort((a, b) => (b.lastOpenedAt || 0) - (a.lastOpenedAt || 0))[0] || null
    );
  }, [books, showArchived, search, selectedCategory]);

  const cycleSort = () => {
    selectFeedback();
    const order: SortMode[] = ['recent', 'title', 'progress'];
    setSortMode((prev) => order[(order.indexOf(prev) + 1) % order.length]);
  };

  const switchTab = (next: LibraryTab) => {
    setTab(next);
    setSelectedCategory('Todos');
  };

  const openBook = (book: Book) => router.push({ pathname: '/reader', params: { id: book.id } });

  const requestDelete = (book: Book) => {
    setMenuBook(null);
    confirmDialog({
      title: 'Eliminar libro',
      message: `¿Seguro que querés eliminar "${book.title}"? Esta acción no se puede deshacer.`,
      confirmText: 'Eliminar',
      destructive: true,
      onConfirm: () => deleteBook(book.id),
    });
  };

  // --- TARJETA DE LIBRO ---
  const renderBook = ({ item, index }: { item: Book; index: number }) => {
    const hasStarted = item.currentPage > 0;
    const pct = progressPct(item);
    const cover = resolveUri(item.coverUri);
    const accent = item.isFinished
      ? theme.colors.success
      : hasStarted
        ? theme.colors.primary
        : theme.colors.textMuted;
    const statusText = item.isFinished
      ? 'Terminado'
      : hasStarted
        ? `${Math.round(pct * 100)}%`
        : 'Sin empezar';

    return (
      <Appear
        delay={index < MAX_STAGGERED ? index * motion.stagger : 0}
        style={{ width: cardWidth }}
      >
        <PressableScale
          style={styles.bookCard}
          scaleTo={0.955}
          accessibilityRole="button"
          accessibilityLabel={`${item.title}${item.author ? `, de ${item.author}` : ''}. ${statusText}`}
          onPress={() => openBook(item)}
          onLongPress={() => setMenuBook(item)}
        >
          <View style={[styles.coverContainer, { height: Math.round(cardWidth * 1.45) }]}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
            ) : (
              <View style={styles.noCoverPlaceholder}>
                <Ionicons name="book-outline" size={26} color={theme.colors.textMuted} />
                <Text style={styles.noCoverText} numberOfLines={3}>{item.title}</Text>
              </View>
            )}

            <View style={styles.coverBadges}>
              {item.audioUri ? (
                <View style={styles.badge}>
                  <Ionicons name="headset" size={11} color="#fff" />
                </View>
              ) : null}
              {item.isFinished ? (
                <View style={[styles.badge, { backgroundColor: theme.colors.success }]}>
                  <Ionicons name="checkmark" size={12} color="#fff" />
                </View>
              ) : null}
            </View>

            <PressableScale
              style={styles.menuBtn}
              scaleTo={0.85}
              hitSlop={8}
              accessibilityLabel={`Opciones de ${item.title}`}
              onPress={() => setMenuBook(item)}
            >
              <Ionicons name="ellipsis-horizontal" size={15} color="#fff" />
            </PressableScale>
          </View>

          <View style={styles.bookInfo}>
            <Text style={styles.bookTitle} numberOfLines={2}>{item.title}</Text>
            {item.author ? (
              <Text style={styles.bookAuthor} numberOfLines={1}>{item.author}</Text>
            ) : null}

            <ProgressBar
              value={pct}
              color={accent}
              trackColor={theme.colors.surfaceAlt}
              style={{ marginTop: 8, marginBottom: 6 }}
            />

            <View style={styles.pageBadge}>
              <Ionicons
                name={item.isFinished ? 'checkmark-circle' : hasStarted ? 'bookmark' : 'bookmark-outline'}
                size={12}
                color={accent}
              />
              <Text style={[styles.progressText, { color: accent }]} numberOfLines={1}>
                {statusText}
              </Text>
            </View>
          </View>
        </PressableScale>
      </Appear>
    );
  };

  // --- TARJETA "CONTINUAR LEYENDO" ---
  const renderContinue = () => {
    if (!continueBook) return null;
    const pct = progressPct(continueBook);
    const cover = resolveUri(continueBook.coverUri);
    return (
      <Appear>
        <Text style={styles.sectionLabel}>Continuar leyendo</Text>
        <PressableScale
          style={styles.continueCard}
          scaleTo={0.98}
          haptic
          accessibilityRole="button"
          accessibilityLabel={`Continuar ${continueBook.title}`}
          onPress={() => openBook(continueBook)}
        >
          <View style={styles.continueCover}>
            {cover ? (
              <Image source={{ uri: cover }} style={styles.cover} resizeMode="cover" />
            ) : (
              <Ionicons name="book" size={26} color={theme.colors.textMuted} />
            )}
          </View>

          <View style={styles.continueBody}>
            <Text style={styles.continueTitle} numberOfLines={2}>{continueBook.title}</Text>
            {continueBook.author ? (
              <Text style={styles.continueAuthor} numberOfLines={1}>{continueBook.author}</Text>
            ) : null}
            <ProgressBar
              value={pct}
              color={theme.colors.primary}
              trackColor={theme.colors.surfaceAlt}
              height={5}
              style={{ marginTop: 10 }}
            />
            <Text style={styles.continueMeta}>
              Página {continueBook.currentPage + 1}
              {continueBook.totalPages ? ` de ${continueBook.totalPages}` : ''} · {Math.round(pct * 100)}%
            </Text>
          </View>

          <View style={styles.continueAction}>
            <Ionicons name="play" size={20} color={theme.colors.onPrimary} style={{ marginLeft: 2 }} />
          </View>
        </PressableScale>
      </Appear>
    );
  };

  return (
    <View
      style={styles.container}
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
    >
      {/* --- ENCABEZADO --- */}
      <View style={styles.header}>
        <View style={styles.headerInner}>
          <View style={styles.headerTop}>
            <View style={{ flex: 1 }}>
              <Text style={styles.headerEyebrow}>Tu colección</Text>
              <Text style={styles.headerTitle}>Mi Biblioteca</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <PressableScale
                style={styles.actionButton}
                scaleTo={0.9}
                haptic
                accessibilityLabel="Estadísticas"
                onPress={() => router.push('/stats')}
              >
                <Ionicons name="stats-chart" size={20} color={theme.colors.primary} />
              </PressableScale>
              <PressableScale
                style={styles.actionButton}
                scaleTo={0.9}
                haptic
                accessibilityLabel="Configuración"
                onPress={() => router.push('/settings')}
              >
                <Ionicons name="settings-outline" size={20} color={theme.colors.primary} />
              </PressableScale>
            </View>
          </View>

          <View style={styles.searchBar}>
            <Ionicons name="search" size={17} color={theme.colors.textMuted} />
            <TextInput
              style={styles.searchInput}
              placeholder="Buscar por título o autor…"
              placeholderTextColor={theme.colors.textMuted}
              value={search}
              onChangeText={setSearch}
              returnKeyType="search"
              accessibilityLabel="Buscar en la biblioteca"
            />
            {search.length > 0 && (
              <PressableScale scaleTo={0.85} hitSlop={8} onPress={() => setSearch('')} accessibilityLabel="Limpiar búsqueda">
                <Ionicons name="close-circle" size={18} color={theme.colors.textMuted} />
              </PressableScale>
            )}
          </View>

          <View style={styles.controlsRow}>
            <Segmented
              theme={theme}
              value={tab}
              onChange={switchTab}
              style={{ flex: 1 }}
              options={[
                { key: 'reading', label: 'Leyendo', icon: 'book-outline' },
                { key: 'archived', label: 'Archivados', icon: 'archive-outline' },
              ]}
            />
            <PressableScale
              style={styles.sortBtn}
              scaleTo={0.94}
              accessibilityLabel={`Ordenar por ${SORT_LABELS[sortMode]}`}
              onPress={cycleSort}
            >
              <Ionicons name="swap-vertical" size={15} color={theme.colors.textSecondary} />
              <Text style={styles.sortText}>{SORT_LABELS[sortMode]}</Text>
            </PressableScale>
          </View>

          {/* Las categorías como chips en fila: se ven todas de un vistazo y se
              cambian con un toque, en lugar de abrir un diálogo para elegir una. */}
          {uniqueCategories.length > 1 && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipsScroll}
              contentContainerStyle={styles.chipsRow}
            >
              {uniqueCategories.map((cat) => {
                const active = cat === selectedCategory;
                return (
                  <PressableScale
                    key={cat}
                    scaleTo={0.93}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => { selectFeedback(); setSelectedCategory(cat); }}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{cat}</Text>
                  </PressableScale>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {/* --- GRILLA --- */}
      <FlatList
        key={columns}
        data={displayedBooks}
        keyExtractor={(item) => item.id}
        renderItem={renderBook}
        numColumns={columns}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        ListHeaderComponent={renderContinue}
        ListEmptyComponent={
          <Appear distance={8} style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name={search ? 'search-outline' : showArchived ? 'archive-outline' : 'library-outline'}
                size={38}
                color={theme.colors.textMuted}
              />
            </View>
            <Text style={styles.emptyText}>
              {search
                ? 'Sin resultados para tu búsqueda.'
                : showArchived
                  ? 'No tenés libros archivados.'
                  : 'Tu biblioteca está vacía.'}
            </Text>
            {!showArchived && !search && (
              <>
                <Text style={styles.emptySubText}>
                  Agregá un .txt y, si tenés, su audio: la app los sincroniza para que puedas leer y escuchar a la vez.
                </Text>
                <PressableScale style={styles.emptyCta} scaleTo={0.96} haptic onPress={() => router.push('/add-book')}>
                  <Ionicons name="add" size={20} color={theme.colors.onPrimary} />
                  <Text style={styles.emptyCtaText}>Agregar mi primer libro</Text>
                </PressableScale>
              </>
            )}
          </Appear>
        }
      />

      {!showArchived && books.length > 0 && (
        <Appear delay={200} distance={20} style={[styles.fabWrap, { bottom: insets.bottom + 24 }]}>
          <PressableScale
            style={styles.fab}
            scaleTo={0.9}
            haptic
            accessibilityRole="button"
            accessibilityLabel="Agregar libro"
            onPress={() => router.push('/add-book')}
          >
            <Ionicons name="add" size={28} color={theme.colors.onPrimary} />
          </PressableScale>
        </Appear>
      )}

      {/* --- ACCIONES DEL LIBRO --- */}
      <Sheet visible={!!menuBook} onClose={() => setMenuBook(null)} theme={theme}>
        {menuBook && (
          <>
            <Text style={styles.sheetTitle} numberOfLines={2}>{menuBook.title}</Text>
            {menuBook.author ? <Text style={styles.sheetSub}>{menuBook.author}</Text> : null}

            <View style={{ height: 8 }} />

            <SheetAction
              theme={theme}
              icon="create-outline"
              label="Editar"
              onPress={() => {
                const b = menuBook;
                setMenuBook(null);
                router.push({ pathname: '/add-book', params: { id: b.id } });
              }}
            />
            <SheetAction
              theme={theme}
              icon={menuBook.isArchived ? 'arrow-undo-outline' : 'archive-outline'}
              label={menuBook.isArchived ? 'Desarchivar' : 'Archivar'}
              onPress={() => {
                updateBook(menuBook.id, { isArchived: !menuBook.isArchived });
                setMenuBook(null);
              }}
            />
            <SheetAction
              theme={theme}
              icon={menuBook.isFinished ? 'refresh-outline' : 'checkmark-done-outline'}
              label={menuBook.isFinished ? 'Marcar como no leído' : 'Marcar como terminado'}
              onPress={() => {
                updateBook(menuBook.id, { isFinished: !menuBook.isFinished });
                setMenuBook(null);
              }}
            />
            <SheetAction
              theme={theme}
              icon="trash-outline"
              label="Eliminar"
              destructive
              onPress={() => requestDelete(menuBook)}
            />
          </>
        )}
      </Sheet>
    </View>
  );
}

// --- FILA DE ACCIÓN DENTRO DE UN PANEL ---
const SheetAction: React.FC<{
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  destructive?: boolean;
  onPress: () => void;
}> = ({ theme, icon, label, destructive, onPress }) => {
  const color = destructive ? theme.colors.danger : theme.colors.text;
  return (
    <PressableScale
      scaleTo={0.98}
      haptic
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 15,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: theme.colors.border,
      }}
    >
      <Ionicons name={icon} size={21} color={color} />
      <Text style={{ fontFamily: theme.fonts.semibold, fontSize: 16, color }}>{label}</Text>
    </PressableScale>
  );
};

const makeStyles = (t: Theme, topInset: number, gutter: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },

    header: {
      paddingTop: topInset + 12,
      paddingBottom: t.spacing.md,
      backgroundColor: t.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderColor: t.colors.border,
    },
    headerInner: { width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center', paddingHorizontal: gutter },
    headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: t.spacing.md },
    headerEyebrow: { fontFamily: t.fonts.medium, fontSize: 12, color: t.colors.textMuted, letterSpacing: 0.6, textTransform: 'uppercase' },
    headerTitle: { fontFamily: t.fonts.bold, fontSize: 27, color: t.colors.text, letterSpacing: -0.5, marginTop: 2 },
    actionButton: { padding: 9, backgroundColor: t.colors.primarySoft, borderRadius: t.radius.sm + 2 },

    searchBar: {
      flexDirection: 'row', alignItems: 'center', gap: 8,
      backgroundColor: t.colors.surfaceAlt, borderRadius: t.radius.md,
      paddingHorizontal: t.spacing.md, height: 44, marginBottom: t.spacing.md,
    },
    searchInput: {
      flex: 1, fontFamily: t.fonts.regular, fontSize: 15, color: t.colors.text, padding: 0,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
    },

    controlsRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    sortBtn: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      backgroundColor: t.colors.surfaceAlt, paddingHorizontal: t.spacing.md,
      height: 42, borderRadius: t.radius.sm + 2,
    },
    sortText: { fontFamily: t.fonts.semibold, fontSize: 13, color: t.colors.textSecondary },

    chipsScroll: { marginTop: t.spacing.md, marginHorizontal: -gutter },
    chipsRow: { gap: 8, paddingHorizontal: gutter },
    chip: {
      paddingHorizontal: 14, paddingVertical: 7, borderRadius: t.radius.pill,
      backgroundColor: t.colors.surfaceAlt, borderWidth: StyleSheet.hairlineWidth, borderColor: 'transparent',
    },
    chipActive: { backgroundColor: t.colors.primarySoft, borderColor: t.colors.primary + '55' },
    chipText: { fontFamily: t.fonts.semibold, fontSize: 13, color: t.colors.textSecondary },
    chipTextActive: { color: t.colors.primary },

    sectionLabel: {
      fontFamily: t.fonts.bold, fontSize: 13, color: t.colors.textSecondary,
      letterSpacing: 0.4, textTransform: 'uppercase', marginBottom: 10,
    },

    continueCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 12,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
      marginBottom: t.spacing.xl, ...shadow(3),
    },
    continueCover: {
      width: 62, height: 90, borderRadius: t.radius.sm, overflow: 'hidden',
      backgroundColor: t.colors.surfaceAlt, alignItems: 'center', justifyContent: 'center',
    },
    continueBody: { flex: 1, minWidth: 0 },
    continueTitle: { fontFamily: t.fonts.bold, fontSize: 16, color: t.colors.text, letterSpacing: -0.2 },
    continueAuthor: { fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textMuted, marginTop: 2 },
    continueMeta: { fontFamily: t.fonts.medium, fontSize: 12, color: t.colors.textSecondary, marginTop: 7 },
    continueAction: {
      width: 44, height: 44, borderRadius: 22, backgroundColor: t.colors.primary,
      alignItems: 'center', justifyContent: 'center', ...shadow(3),
    },

    list: {
      paddingHorizontal: gutter, paddingTop: t.spacing.xl, paddingBottom: 120,
      width: '100%', maxWidth: MAX_CONTENT_WIDTH, alignSelf: 'center',
    },
    bookCard: {
      backgroundColor: t.colors.surface, borderRadius: t.radius.md, padding: 9, marginBottom: GAP,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(2),
    },
    coverContainer: {
      width: '100%', backgroundColor: t.colors.surfaceAlt,
      borderRadius: t.radius.sm, overflow: 'hidden', marginBottom: 9,
    },
    cover: { width: '100%', height: '100%' },
    noCoverPlaceholder: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 10 },
    noCoverText: { fontFamily: t.fonts.semibold, color: t.colors.textSecondary, fontSize: 11, marginTop: 6, textAlign: 'center', lineHeight: 15 },

    coverBadges: { position: 'absolute', top: 7, left: 7, flexDirection: 'row', gap: 5 },
    badge: {
      backgroundColor: t.colors.primary, width: 22, height: 22, borderRadius: 11,
      alignItems: 'center', justifyContent: 'center',
    },
    menuBtn: {
      position: 'absolute', top: 7, right: 7, backgroundColor: 'rgba(0,0,0,0.5)',
      width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center',
    },

    bookInfo: { flex: 1 },
    bookTitle: { fontFamily: t.fonts.semibold, fontSize: 13.5, color: t.colors.text, lineHeight: 18 },
    bookAuthor: { fontFamily: t.fonts.regular, fontSize: 11.5, color: t.colors.textMuted, marginTop: 2 },
    pageBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    progressText: { fontFamily: t.fonts.semibold, fontSize: 11.5, flexShrink: 1 },

    emptyState: { alignItems: 'center', marginTop: 60, paddingHorizontal: 24 },
    emptyIcon: {
      width: 80, height: 80, borderRadius: 40, backgroundColor: t.colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    },
    emptyText: { fontFamily: t.fonts.bold, color: t.colors.text, fontSize: 17, textAlign: 'center' },
    emptySubText: { fontFamily: t.fonts.regular, color: t.colors.textSecondary, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 21, maxWidth: 380 },
    emptyCta: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22,
      backgroundColor: t.colors.primary, paddingHorizontal: 20, paddingVertical: 13,
      borderRadius: t.radius.pill, ...shadow(4),
    },
    emptyCtaText: { fontFamily: t.fonts.bold, fontSize: 15, color: t.colors.onPrimary },

    fabWrap: { position: 'absolute', right: 20 },
    fab: {
      backgroundColor: t.colors.primary, width: 58, height: 58, borderRadius: 29,
      justifyContent: 'center', alignItems: 'center', ...shadow(8),
    },

    sheetTitle: { fontFamily: t.fonts.bold, fontSize: 18, color: t.colors.text },
    sheetSub: { fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textMuted, marginTop: 3 },
  });
