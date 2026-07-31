import { Ionicons } from '@expo/vector-icons';
import { router, Stack } from 'expo-router';
import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Appear } from '../components/ui/appear';
import { PressableScale } from '../components/ui/pressable-scale';
import { useBooks } from '../src/BookContext';
import {
  buildImportPlan,
  ImportPlanItem,
  materializeImportItem,
  pickLibraryFolder,
} from '../src/bulkImport';
import { selectFeedback, successFeedback, warningFeedback } from '../src/haptics';
import { useTheme } from '../src/PreferencesContext';
import { shadow, Theme } from '../src/theme';

type Stage = 'idle' | 'scanning' | 'reviewing' | 'importing' | 'done';

export default function ImportLibraryScreen() {
  const { books, addBook } = useBooks();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [stage, setStage] = useState<Stage>('idle');
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<ImportPlanItem[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState({ imported: 0, failed: 0, failedTitles: [] as string[] });

  const startPicking = async () => {
    setError(null);
    setStage('scanning');
    try {
      const { manifest, fileMap } = await pickLibraryFolder();
      const built = buildImportPlan(manifest, fileMap, books);
      setPlan(built);
      setSelected(new Set(built.map((item, i) => i).filter((i) => !built[i].missingTxt && !built[i].alreadyExists)));
      setStage('reviewing');
    } catch (e: any) {
      if (e?.message === 'cancelado') {
        setStage('idle');
        return;
      }
      setError(e?.message || 'No se pudo leer la carpeta.');
      setStage('idle');
    }
  };

  const toggle = (i: number) => {
    selectFeedback();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const runImport = async () => {
    const items = [...selected].map((i) => plan[i]);
    if (items.length === 0) return;
    setStage('importing');
    setProgress({ done: 0, total: items.length });
    let imported = 0;
    const failedTitles: string[] = [];

    for (const item of items) {
      try {
        const { bookId, data } = await materializeImportItem(item);
        addBook(data, bookId);
        imported++;
      } catch {
        failedTitles.push(item.entry.titulo);
      }
      setProgress((p) => ({ ...p, done: p.done + 1 }));
    }

    setSummary({ imported, failed: failedTitles.length, failedTitles });
    if (failedTitles.length === 0) successFeedback();
    else warningFeedback();
    setStage('done');
  };

  const selectableCount = plan.filter((p) => !p.missingTxt).length;

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} style={styles.backBtn} scaleTo={0.88} accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </PressableScale>
        <Text style={styles.headerTitle}>Importar biblioteca</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {stage === 'idle' && (
          <Appear>
            <View style={styles.card}>
              <Ionicons name="folder-open-outline" size={34} color={theme.colors.primary} />
              <Text style={styles.introTitle}>Cargá varios libros de una</Text>
              <Text style={styles.introText}>
                Elegí la carpeta raíz que tiene una subcarpeta por libro y un{' '}
                <Text style={styles.mono}>manifest.json</Text> que dice dónde está el texto, el audio y el{' '}
                <Text style={styles.mono}>.srt</Text> de cada uno.
              </Text>
              {Platform.OS === 'ios' && (
                <Text style={styles.warnText}>
                  En iOS todavía no hay forma de elegir una carpeta completa: importá los libros uno por uno desde
                  “Agregar libro”.
                </Text>
              )}
              {error && <Text style={styles.errorText}>{error}</Text>}
              <PressableScale
                style={[styles.primaryBtn, Platform.OS === 'ios' && { opacity: 0.4 }]}
                scaleTo={0.97}
                haptic
                disabled={Platform.OS === 'ios'}
                onPress={startPicking}
              >
                <Ionicons name="folder-open" size={18} color={theme.colors.onPrimary} />
                <Text style={styles.primaryBtnText}>Elegir carpeta</Text>
              </PressableScale>
            </View>
          </Appear>
        )}

        {stage === 'scanning' && (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.introText}>Leyendo la carpeta…</Text>
          </View>
        )}

        {stage === 'reviewing' && (
          <Appear>
            <Text style={styles.reviewSummary}>
              {plan.length} {plan.length === 1 ? 'libro encontrado' : 'libros encontrados'} · {selected.size} de{' '}
              {selectableCount} para importar
            </Text>
            {plan.map((item, i) => (
              <PlanRow key={i} item={item} checked={selected.has(i)} onToggle={() => toggle(i)} theme={theme} styles={styles} />
            ))}

            <PressableScale
              style={[styles.primaryBtn, selected.size === 0 && { opacity: 0.4 }]}
              scaleTo={0.97}
              haptic
              disabled={selected.size === 0}
              onPress={runImport}
            >
              <Ionicons name="download-outline" size={18} color={theme.colors.onPrimary} />
              <Text style={styles.primaryBtnText}>
                Importar {selected.size} {selected.size === 1 ? 'libro' : 'libros'}
              </Text>
            </PressableScale>
          </Appear>
        )}

        {stage === 'importing' && (
          <View style={styles.centerBlock}>
            <ActivityIndicator size="large" color={theme.colors.primary} />
            <Text style={styles.introText}>
              Importando {progress.done} de {progress.total}…
            </Text>
          </View>
        )}

        {stage === 'done' && (
          <Appear style={styles.centerBlock}>
            <Ionicons
              name={summary.failed === 0 ? 'checkmark-circle' : 'alert-circle'}
              size={44}
              color={summary.failed === 0 ? theme.colors.success : theme.colors.warning}
            />
            <Text style={styles.introTitle}>
              {summary.imported} {summary.imported === 1 ? 'libro importado' : 'libros importados'}
            </Text>
            {summary.failed > 0 && (
              <Text style={styles.warnText}>
                No se pudieron importar: {summary.failedTitles.join(', ')}
              </Text>
            )}
            <PressableScale style={styles.primaryBtn} scaleTo={0.97} haptic onPress={() => router.replace('/')}>
              <Text style={styles.primaryBtnText}>Ir a la biblioteca</Text>
            </PressableScale>
          </Appear>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const PlanRow: React.FC<{
  item: ImportPlanItem;
  checked: boolean;
  onToggle: () => void;
  theme: Theme;
  styles: ReturnType<typeof makeStyles>;
}> = ({ item, checked, onToggle, theme, styles }) => {
  const disabled = item.missingTxt;
  return (
    <PressableScale
      style={[styles.planRow, disabled && { opacity: 0.5 }]}
      scaleTo={0.98}
      disabled={disabled}
      onPress={onToggle}
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
    >
      <Ionicons
        name={checked ? 'checkbox' : 'square-outline'}
        size={22}
        color={checked ? theme.colors.primary : theme.colors.textMuted}
      />
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={styles.planTitle} numberOfLines={1}>{item.entry.titulo}</Text>
        {item.entry.autor && <Text style={styles.planAuthor} numberOfLines={1}>{item.entry.autor}</Text>}
        <View style={styles.planBadges}>
          {item.missingTxt && <Badge text="Sin .txt: no se puede importar" tone="danger" theme={theme} />}
          {item.alreadyExists && !item.missingTxt && <Badge text="Ya está en tu biblioteca" tone="warning" theme={theme} />}
          {!item.audioUri && !item.missingTxt && <Badge text="Sin audio" tone="muted" theme={theme} />}
          {!item.coverUri && !item.missingTxt && <Badge text="Sin portada" tone="muted" theme={theme} />}
        </View>
      </View>
    </PressableScale>
  );
};

const Badge: React.FC<{ text: string; tone: 'danger' | 'warning' | 'muted'; theme: Theme }> = ({ text, tone, theme }) => {
  const color = tone === 'danger' ? theme.colors.danger : tone === 'warning' ? theme.colors.warning : theme.colors.textMuted;
  return (
    <View style={{ backgroundColor: color + '18', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999, marginRight: 6, marginTop: 4 }}>
      <Text style={{ fontFamily: 'InterSemi', fontSize: 10.5, color }}>{text}</Text>
    </View>
  );
};

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    header: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
      paddingHorizontal: t.spacing.xl, paddingVertical: 14,
      backgroundColor: t.colors.surface,
      borderBottomWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    },
    backBtn: { padding: 5 },
    headerTitle: { fontFamily: t.fonts.display, fontSize: 20, color: t.colors.text },
    scrollContent: { padding: t.spacing.xl, paddingBottom: 48, width: '100%', maxWidth: 640, alignSelf: 'center' },

    card: {
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 22, alignItems: 'center',
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(2),
    },
    introTitle: { fontFamily: t.fonts.bold, fontSize: 18, color: t.colors.text, marginTop: 14, textAlign: 'center' },
    introText: { fontFamily: t.fonts.regular, fontSize: 14, color: t.colors.textSecondary, marginTop: 8, textAlign: 'center', lineHeight: 20 },
    mono: { fontFamily: 'InterSemi' },
    warnText: { fontFamily: t.fonts.medium, fontSize: 12.5, color: t.colors.warning, marginTop: 12, textAlign: 'center', lineHeight: 18 },
    errorText: { fontFamily: t.fonts.medium, fontSize: 13, color: t.colors.danger, marginTop: 12, textAlign: 'center' },

    primaryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      backgroundColor: t.colors.primary, paddingVertical: 14, paddingHorizontal: 20,
      borderRadius: t.radius.md, marginTop: 20, alignSelf: 'stretch',
    },
    primaryBtnText: { fontFamily: t.fonts.bold, fontSize: 15, color: t.colors.onPrimary },

    centerBlock: { alignItems: 'center', paddingVertical: 60, gap: 6 },

    reviewSummary: { fontFamily: t.fonts.semibold, fontSize: 13, color: t.colors.textSecondary, marginBottom: 14 },
    planRow: {
      flexDirection: 'row', alignItems: 'flex-start', backgroundColor: t.colors.surface,
      borderRadius: t.radius.md, padding: 14, marginBottom: 10,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    },
    planTitle: { fontFamily: t.fonts.bold, fontSize: 15, color: t.colors.text },
    planAuthor: { fontFamily: t.fonts.regular, fontSize: 12.5, color: t.colors.textMuted, marginTop: 1 },
    planBadges: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 },
  });
