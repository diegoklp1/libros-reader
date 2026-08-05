import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Appear } from '../components/ui/appear';
import { PressableScale } from '../components/ui/pressable-scale';
import { ProgressBar } from '../components/ui/progress-bar';
import { DailyStat, dateKey, useBooks } from '../src/BookContext';
import { useTheme } from '../src/PreferencesContext';
import { layoutFor, shadow, Theme } from '../src/theme';

const MONTH_NAMES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const WEEKDAY_LABELS = ['L', '', 'M', '', 'V', '', 'D'];

/** Días que muestra el gráfico de barras. Dos semanas entran sin apretarse. */
const CHART_DAYS = 14;
/** Semanas del mapa de actividad. */
const HEATMAP_WEEKS = 16;

/** Cuánto "pesa" un día. Une páginas, minutos y notas en un solo número comparable. */
const dayScore = (s?: DailyStat) =>
  s ? s.pagesRead + s.minutesListened * 2 + s.highlightsMade * 5 : 0;

export default function StatsScreen() {
  const { books, dailyStats } = useBooks();
  const theme = useTheme();
  const { width: windowWidth } = useWindowDimensions();
  // Medido, no supuesto: el mapa de actividad tiene que caber en la tarjeta
  // aunque se rote el teléfono o se redimensione la ventana.
  const [measuredWidth, setMeasuredWidth] = useState(0);
  const width = measuredWidth || windowWidth;
  const layout = useMemo(() => layoutFor(width), [width]);
  const styles = useMemo(() => makeStyles(theme, layout.gutter), [theme, layout.gutter]);

  const stats = useMemo(() => {
    const today = new Date();
    const currentYear = today.getFullYear();
    const todayStr = dateKey(today);

    const totalDaysActive = Object.keys(dailyStats).length;
    const finishedBooksCount = books.filter((b) => b.isFinished).length;
    const totalNotes = books.reduce((acc, b) => acc + (b.notes?.length || 0), 0);

    // Racha actual (días consecutivos con actividad)
    const activeDates = new Set(Object.keys(dailyStats));
    let currentStreak = 0;
    const cursor = new Date();
    if (!activeDates.has(todayStr)) cursor.setDate(cursor.getDate() - 1);
    while (activeDates.has(dateKey(cursor))) {
      currentStreak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // Racha más larga registrada: da contexto a la actual.
    const sortedDates = Object.keys(dailyStats).sort();
    let bestStreak = 0;
    let run = 0;
    let prev: Date | null = null;
    for (const key of sortedDates) {
      const d = new Date(key + 'T12:00:00');
      const consecutive = prev && Math.round((d.getTime() - prev.getTime()) / 86400000) === 1;
      run = consecutive ? run + 1 : 1;
      if (run > bestStreak) bestStreak = run;
      prev = d;
    }

    let totalMinutes = 0;
    let totalPages = 0;
    const monthlyBooks: Record<number, Set<string>> = {};
    const monthlyData: Record<number, { mins: number; pages: number; highlights: number; score: number }> = {};
    for (let i = 0; i < 12; i++) {
      monthlyBooks[i] = new Set();
      monthlyData[i] = { mins: 0, pages: 0, highlights: 0, score: 0 };
    }

    Object.values(dailyStats).forEach((stat) => {
      totalMinutes += stat.minutesListened;
      totalPages += stat.pagesRead;
      const statDate = new Date(stat.date + 'T12:00:00');
      if (statDate.getFullYear() === currentYear) {
        const m = statDate.getMonth();
        stat.booksOpened.forEach((bId) => monthlyBooks[m].add(bId));
        monthlyData[m].mins += stat.minutesListened;
        monthlyData[m].pages += stat.pagesRead;
        monthlyData[m].highlights += stat.highlightsMade;
        monthlyData[m].score += dayScore(stat);
      }
    });

    let bestMonthIdx = -1;
    let maxScore = -1;
    for (let i = 0; i < 12; i++) {
      if (monthlyData[i].score > maxScore && monthlyData[i].score > 0) {
        maxScore = monthlyData[i].score;
        bestMonthIdx = i;
      }
    }
    const wrappedData = bestMonthIdx !== -1 ? { name: MONTH_NAMES[bestMonthIdx], ...monthlyData[bestMonthIdx] } : null;

    // --- Últimos días, para el gráfico de barras ---
    const recentDays: { key: string; label: string; stat?: DailyStat; score: number; isToday: boolean }[] = [];
    for (let i = CHART_DAYS - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const stat = dailyStats[key];
      recentDays.push({
        key,
        label: String(d.getDate()),
        stat,
        score: dayScore(stat),
        isToday: i === 0,
      });
    }
    const maxRecentScore = Math.max(1, ...recentDays.map((d) => d.score));

    // --- Mapa de actividad: columnas = semanas, filas = día de la semana ---
    const heatmap: { key: string; score: number; inFuture: boolean }[][] = [];
    const start = new Date();
    // Retrocede hasta el lunes de la semana de hace HEATMAP_WEEKS.
    start.setDate(start.getDate() - (HEATMAP_WEEKS - 1) * 7);
    const weekdayOffset = (start.getDay() + 6) % 7; // 0 = lunes
    start.setDate(start.getDate() - weekdayOffset);

    const todayTime = new Date().setHours(23, 59, 59, 999);
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const column: { key: string; score: number; inFuture: boolean }[] = [];
      for (let d = 0; d < 7; d++) {
        const cell = new Date(start);
        cell.setDate(start.getDate() + w * 7 + d);
        const key = dateKey(cell);
        column.push({ key, score: dayScore(dailyStats[key]), inFuture: cell.getTime() > todayTime });
      }
      heatmap.push(column);
    }
    const maxHeatScore = Math.max(1, ...heatmap.flat().map((c) => c.score));

    return {
      totalDaysActive, finishedBooksCount, totalMinutes, totalPages, totalNotes,
      currentStreak, bestStreak, wrappedData, monthlyBooks, currentYear,
      recentDays, maxRecentScore, heatmap, maxHeatScore,
    };
  }, [dailyStats, books]);

  const getBookTitle = (id: string) => books.find((b) => b.id === id)?.title || 'Libro eliminado';

  const formatTime = (mins: number) => (mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`);

  const hasAnyActivity = stats.totalDaysActive > 0;

  let delay = 0;
  const nextDelay = () => (delay += 70);

  // El mapa se adapta al ancho: en un teléfono las celdas se achican, en una
  // tablet respiran, y en ningún caso se sale de la tarjeta.
  const heatCell = Math.max(
    9,
    Math.min(18, Math.floor((Math.min(width, 900) - layout.gutter * 2 - 32 - 18 - HEATMAP_WEEKS * 3) / HEATMAP_WEEKS))
  );

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
      onLayout={(e) => setMeasuredWidth(e.nativeEvent.layout.width)}
    >
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} style={styles.backBtn} scaleTo={0.88} accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </PressableScale>
        <Text style={styles.headerTitle}>Tu rendimiento</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {!hasAnyActivity ? (
          <Appear distance={8} style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="stats-chart-outline" size={36} color={theme.colors.textMuted} />
            </View>
            <Text style={styles.emptyTitle}>Todavía no hay nada que medir</Text>
            <Text style={styles.emptyText}>
              Abrí un libro y empezá a leer: acá vas a ver tu racha, las páginas que avanzaste y los meses en los que más leíste.
            </Text>
            <PressableScale style={styles.emptyCta} scaleTo={0.96} haptic onPress={() => router.replace('/')}>
              <Ionicons name="library-outline" size={19} color={theme.colors.onPrimary} />
              <Text style={styles.emptyCtaText}>Ir a mi biblioteca</Text>
            </PressableScale>
          </Appear>
        ) : (
          <>
            {/* --- RACHA --- */}
            <Appear delay={nextDelay()}>
              <View style={styles.streakCard}>
                <View style={styles.streakIcon}>
                  <Ionicons name="flame" size={30} color="#EF4444" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.streakValue}>
                    {stats.currentStreak} <Text style={styles.streakUnit}>{stats.currentStreak === 1 ? 'día' : 'días'}</Text>
                  </Text>
                  <Text style={styles.streakDesc}>
                    {stats.currentStreak > 0
                      ? `Racha activa. Tu mejor marca es de ${stats.bestStreak} ${stats.bestStreak === 1 ? 'día' : 'días'}.`
                      : `Hoy todavía no leíste. Tu mejor racha fue de ${stats.bestStreak} ${stats.bestStreak === 1 ? 'día' : 'días'}.`}
                  </Text>
                  {stats.bestStreak > 0 && (
                    <ProgressBar
                      value={stats.currentStreak / stats.bestStreak}
                      color="#EF4444"
                      trackColor={theme.colors.surfaceAlt}
                      height={5}
                      style={{ marginTop: 10 }}
                    />
                  )}
                </View>
              </View>
            </Appear>

            {/* --- MÉTRICAS --- */}
            <Appear delay={nextDelay()}>
              <Text style={styles.sectionTitle}>Vista general</Text>
              <View style={styles.grid}>
                <StatBox theme={theme} icon="reader-outline" color={theme.colors.primary} value={String(stats.totalPages)} label="Páginas leídas" />
                <StatBox theme={theme} icon="headset-outline" color="#8B5CF6" value={formatTime(stats.totalMinutes)} label="Escuchados" />
                <StatBox theme={theme} icon="checkmark-done-outline" color={theme.colors.success} value={String(stats.finishedBooksCount)} label="Terminados" />
              </View>
              <View style={styles.grid}>
                <StatBox theme={theme} icon="calendar-outline" color={theme.colors.primary} value={String(stats.totalDaysActive)} label="Días activos" />
                <StatBox theme={theme} icon="journal-outline" color={theme.colors.warning} value={String(stats.totalNotes)} label="Notas" />
                <StatBox theme={theme} icon="library-outline" color={theme.colors.textSecondary} value={String(books.length)} label="En biblioteca" />
              </View>
            </Appear>

            {/* --- ÚLTIMAS DOS SEMANAS --- */}
            <Appear delay={nextDelay()}>
              <Text style={styles.sectionTitle}>Últimas dos semanas</Text>
              <View style={styles.card}>
                <View style={styles.chartRow}>
                  {stats.recentDays.map((day, i) => {
                    const ratio = day.score / stats.maxRecentScore;
                    return (
                      <View key={day.key} style={styles.chartColumn}>
                        <View style={styles.chartBarTrack}>
                          <Appear
                            delay={i * 35} distance={14}
                            style={[
                              styles.chartBar,
                              {
                                // Un día con actividad mínima igual tiene que verse.
                                height: `${Math.max(day.score > 0 ? 8 : 2, ratio * 100)}%`,
                                backgroundColor: day.score === 0
                                  ? theme.colors.surfaceAlt
                                  : day.isToday
                                    ? theme.colors.success
                                    : theme.colors.primary,
                              },
                            ]}
                          />
                        </View>
                        <Text style={[styles.chartLabel, day.isToday && { color: theme.colors.success, fontFamily: theme.fonts.bold }]}>
                          {day.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
                <Text style={styles.chartCaption}>
                  Actividad diaria combinando páginas, minutos de audio y notas.
                </Text>
              </View>
            </Appear>

            {/* --- MAPA DE ACTIVIDAD --- */}
            <Appear delay={nextDelay()}>
              <Text style={styles.sectionTitle}>Constancia</Text>
              <View style={styles.card}>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  <View style={{ gap: 3, paddingTop: 1 }}>
                    {WEEKDAY_LABELS.map((label, i) => (
                      <View key={i} style={{ height: heatCell, justifyContent: 'center' }}>
                        <Text style={styles.heatWeekday}>{label}</Text>
                      </View>
                    ))}
                  </View>

                  <View style={{ flexDirection: 'row', gap: 3, flex: 1 }}>
                    {stats.heatmap.map((week, wIdx) => (
                      <View key={wIdx} style={{ gap: 3 }}>
                        {week.map((cell) => {
                          const intensity = cell.score / stats.maxHeatScore;
                          return (
                            <Appear
                              key={cell.key}
                              delay={wIdx * 18} distance={6}
                              style={{
                                width: heatCell,
                                height: heatCell,
                                borderRadius: 3,
                                opacity: cell.inFuture ? 0.25 : 1,
                                backgroundColor:
                                  cell.score === 0
                                    ? theme.colors.surfaceAlt
                                    : theme.colors.primary + intensityAlpha(intensity),
                              }}
                            />
                          );
                        })}
                      </View>
                    ))}
                  </View>
                </View>

                <View style={styles.heatLegend}>
                  <Text style={styles.heatLegendText}>Menos</Text>
                  {[0, 0.25, 0.5, 0.75, 1].map((v) => (
                    <View
                      key={v}
                      style={{
                        width: 11, height: 11, borderRadius: 3,
                        backgroundColor: v === 0 ? theme.colors.surfaceAlt : theme.colors.primary + intensityAlpha(v),
                      }}
                    />
                  ))}
                  <Text style={styles.heatLegendText}>Más</Text>
                </View>
              </View>
            </Appear>

            {/* --- RESUMEN ANUAL --- */}
            {stats.wrappedData && (
              <Appear delay={nextDelay()}>
                <Text style={styles.sectionTitle}>Tu resumen anual</Text>
                <View style={styles.wrappedCard}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
                    <Ionicons name="sparkles" size={22} color="#FBBF24" />
                    <Text style={styles.wrappedTitle}>El rey de {stats.wrappedData.name}</Text>
                  </View>
                  <Text style={styles.wrappedDesc}>
                    Tu mes más productivo fue <Text style={styles.wrappedHi}>{stats.wrappedData.name}</Text>. Escuchaste{' '}
                    <Text style={styles.wrappedHi}>{formatTime(stats.wrappedData.mins)}</Text>, avanzaste{' '}
                    <Text style={styles.wrappedHi}>{stats.wrappedData.pages}</Text> páginas y guardaste{' '}
                    <Text style={styles.wrappedHi}>{stats.wrappedData.highlights}</Text> notas.
                  </Text>
                </View>
              </Appear>
            )}

            {/* --- HISTORIAL --- */}
            <Appear delay={nextDelay()}>
              <Text style={styles.sectionTitle}>Historial de libros ({stats.currentYear})</Text>
              <View style={styles.card}>
                {MONTH_NAMES.map((month, index) => {
                  const booksInMonth = Array.from(stats.monthlyBooks[index]);
                  if (booksInMonth.length === 0) return null;
                  return (
                    <View key={index} style={styles.monthBlock}>
                      <Text style={styles.monthTitle}>{month}</Text>
                      {booksInMonth.map((bookId) => (
                        <View key={bookId} style={styles.bookRow}>
                          <Ionicons name="book" size={14} color={theme.colors.textMuted} />
                          <Text style={styles.bookHistoryTitle} numberOfLines={1}>{getBookTitle(bookId)}</Text>
                        </View>
                      ))}
                    </View>
                  );
                })}
                {Object.values(stats.monthlyBooks).every((set) => set.size === 0) && (
                  <Text style={styles.emptyHistory}>Aún no hay historial registrado para este año.</Text>
                )}
              </View>
            </Appear>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** Alfa en hexadecimal para teñir una celda del mapa según su intensidad. */
const intensityAlpha = (ratio: number) => {
  const clamped = Math.max(0, Math.min(1, ratio));
  // Piso de 0.28 para que el día flojo se distinga del día vacío.
  const alpha = Math.round((0.28 + clamped * 0.72) * 255);
  return alpha.toString(16).padStart(2, '0').toUpperCase();
};

const StatBox: React.FC<{
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  value: string;
  label: string;
}> = ({ theme, icon, color, value, label }) => (
  <View
    style={{
      flex: 1, backgroundColor: theme.colors.surface, paddingVertical: 15, paddingHorizontal: 10,
      borderRadius: theme.radius.md, alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth, borderColor: theme.colors.border, ...shadow(2),
    }}
  >
    <Ionicons name={icon} size={20} color={color} />
    <Text style={{ fontFamily: theme.fonts.bold, fontSize: 19, color: theme.colors.text, marginTop: 8 }} numberOfLines={1}>
      {value}
    </Text>
    <Text style={{ fontFamily: theme.fonts.regular, fontSize: 11, color: theme.colors.textSecondary, marginTop: 2, textAlign: 'center' }}>
      {label}
    </Text>
  </View>
);

const makeStyles = (t: Theme, gutter: number) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: t.spacing.xl, paddingVertical: 14,
      backgroundColor: t.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    },
    backBtn: { padding: 5 },
    headerTitle: { fontFamily: t.fonts.bold, fontSize: 19, color: t.colors.text },
    scrollContent: { padding: gutter, paddingBottom: 48, width: '100%', maxWidth: 900, alignSelf: 'center' },

    sectionTitle: {
      fontFamily: t.fonts.bold, fontSize: 12, color: t.colors.textSecondary,
      letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4,
    },
    card: {
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 16, marginBottom: 24,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(2),
    },
    grid: { flexDirection: 'row', gap: 10, marginBottom: 10 },

    streakCard: {
      flexDirection: 'row', alignItems: 'center', gap: 14,
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 18, marginBottom: 24,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(3),
    },
    streakIcon: {
      width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.dangerSoft,
      alignItems: 'center', justifyContent: 'center',
    },
    streakValue: { fontFamily: t.fonts.bold, fontSize: 26, color: t.colors.text, letterSpacing: -0.6 },
    streakUnit: { fontFamily: t.fonts.medium, fontSize: 15, color: t.colors.textSecondary },
    streakDesc: { fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary, marginTop: 2, lineHeight: 19 },

    chartRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 132 },
    chartColumn: { flex: 1, alignItems: 'center', height: '100%', justifyContent: 'flex-end' },
    chartBarTrack: { flex: 1, width: '100%', justifyContent: 'flex-end' },
    chartBar: { width: '100%', borderRadius: 4, minHeight: 3 },
    chartLabel: { fontFamily: t.fonts.medium, fontSize: 10, color: t.colors.textMuted, marginTop: 6 },
    chartCaption: { fontFamily: t.fonts.regular, fontSize: 11.5, color: t.colors.textMuted, marginTop: 14, textAlign: 'center' },

    heatWeekday: { fontFamily: t.fonts.medium, fontSize: 9, color: t.colors.textMuted },
    heatLegend: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 4, marginTop: 14 },
    heatLegendText: { fontFamily: t.fonts.regular, fontSize: 10.5, color: t.colors.textMuted, marginHorizontal: 3 },

    wrappedCard: {
      backgroundColor: '#1F2937', padding: 20, borderRadius: t.radius.lg, marginBottom: 24,
      borderWidth: 1, borderColor: '#374151',
    },
    wrappedTitle: { fontFamily: t.fonts.bold, fontSize: 16, color: '#fff', marginLeft: 10 },
    wrappedDesc: { fontFamily: t.fonts.regular, fontSize: 14, color: '#D1D5DB', lineHeight: 22 },
    wrappedHi: { fontFamily: t.fonts.bold, color: '#fff' },

    monthBlock: { marginBottom: 14 },
    monthTitle: {
      fontFamily: t.fonts.bold, fontSize: 14, color: t.colors.text, marginBottom: 8,
      borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border, paddingBottom: 6,
    },
    bookRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6, paddingLeft: 4 },
    bookHistoryTitle: { fontFamily: t.fonts.regular, fontSize: 13.5, color: t.colors.textSecondary, flex: 1 },
    emptyHistory: { fontFamily: t.fonts.regular, fontSize: 13.5, color: t.colors.textMuted, textAlign: 'center', fontStyle: 'italic' },

    emptyState: { alignItems: 'center', marginTop: 60, paddingHorizontal: 20 },
    emptyIcon: {
      width: 80, height: 80, borderRadius: 40, backgroundColor: t.colors.surfaceAlt,
      alignItems: 'center', justifyContent: 'center', marginBottom: 18,
    },
    emptyTitle: { fontFamily: t.fonts.bold, fontSize: 17, color: t.colors.text, textAlign: 'center' },
    emptyText: { fontFamily: t.fonts.regular, fontSize: 14, color: t.colors.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 21, maxWidth: 380 },
    emptyCta: {
      flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22,
      backgroundColor: t.colors.primary, paddingHorizontal: 20, paddingVertical: 13,
      borderRadius: t.radius.pill, ...shadow(4),
    },
    emptyCtaText: { fontFamily: t.fonts.bold, fontSize: 15, color: t.colors.onPrimary },
  });
