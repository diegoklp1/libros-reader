import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { router, Stack } from 'expo-router';
import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Appear } from '../components/ui/appear';
import { PressableScale } from '../components/ui/pressable-scale';
import { Segmented } from '../components/ui/segmented';
import { useAuth } from '../src/AuthContext';
import { useBooks } from '../src/BookContext';
import { confirmDialog, notifyDialog } from '../src/dialog';
import { selectFeedback } from '../src/haptics';
import { ReadingMode, ThemeMode, usePreferences, useTheme } from '../src/PreferencesContext';
import { READING_FONT_ORDER, READING_FONTS, ReadingFontKey, shadow, Theme } from '../src/theme';

const APP_VERSION = Constants.expoConfig?.version ?? '2.3.0';

export default function SettingsScreen() {
  const { books, dailyStats, clearBooks, clearStats, resetAllData, isSyncing, lastSyncedAt, syncError, syncWarning, syncNow } = useBooks();
  const { session, signOut } = useAuth();
  const { prefs, setPreference } = usePreferences();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const confirmAction = (title: string, message: string, action: () => void) => {
    confirmDialog({
      title,
      message,
      confirmText: 'Sí, borrar',
      destructive: true,
      onConfirm: async () => {
        await action();
        notifyDialog('Listo', 'Los datos se eliminaron correctamente.');
      },
    });
  };

  // Decir qué se va a borrar exactamente pesa más que decir "todos los datos".
  const notesCount = books.reduce((acc, b) => acc + (b.notes?.length || 0), 0);
  const daysCount = Object.keys(dailyStats).length;

  let delay = 0;
  const nextDelay = () => (delay += 60);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <PressableScale onPress={() => router.back()} style={styles.backBtn} scaleTo={0.88} accessibilityLabel="Volver">
          <Ionicons name="arrow-back" size={24} color={theme.colors.text} />
        </PressableScale>
        <Text style={styles.headerTitle}>Configuración</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* --- APARIENCIA --- */}
        <Appear delay={nextDelay()}>
          <Text style={styles.sectionTitle}>Apariencia</Text>
          <View style={styles.card}>
            <Text style={styles.settingLabel}>Tema de la aplicación</Text>
            <Text style={styles.settingSub}>No afecta al lector: el papel se elige dentro del libro.</Text>
            <Segmented
              theme={theme}
              variant="solid"
              value={prefs.themeMode}
              onChange={(v) => setPreference('themeMode', v as ThemeMode)}
              style={{ marginTop: 12 }}
              options={[
                { key: 'system', label: 'Sistema', icon: 'phone-portrait-outline' },
                { key: 'light', label: 'Claro', icon: 'sunny-outline' },
                { key: 'dark', label: 'Oscuro', icon: 'moon-outline' },
              ]}
            />
          </View>
        </Appear>

        {/* --- LECTURA --- */}
        <Appear delay={nextDelay()}>
          <Text style={styles.sectionTitle}>Lectura</Text>
          <View style={styles.card}>
            <Text style={styles.settingLabel}>Tipografía del texto</Text>
            <Text style={styles.settingSub}>Se aplica a todos los libros. Podés cambiarla también desde el lector.</Text>
            <View style={{ marginTop: 12, gap: 8 }}>
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
                    style={[styles.fontRow, active && styles.fontRowActive]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: font.regular, fontSize: 17, color: theme.colors.text }}>
                        {font.label}
                      </Text>
                      <Text style={styles.fontNote}>{font.note}</Text>
                    </View>
                    {active && <Ionicons name="checkmark-circle" size={21} color={theme.colors.primary} />}
                  </PressableScale>
                );
              })}
            </View>

            <View style={styles.divider} />

            <Text style={styles.settingLabel}>Modo de lectura</Text>
            <Text style={styles.settingSub}>Pasar páginas de a una, o desplazarse sin cortes.</Text>
            <Segmented
              theme={theme}
              value={prefs.readingMode}
              onChange={(v) => setPreference('readingMode', v as ReadingMode)}
              style={{ marginTop: 12 }}
              options={[
                { key: 'paged', label: 'Páginas', icon: 'book-outline' },
                { key: 'scroll', label: 'Continuo', icon: 'reorder-four-outline' },
              ]}
            />
          </View>
        </Appear>

        {/* --- PREFERENCIAS --- */}
        <Appear delay={nextDelay()}>
          <Text style={styles.sectionTitle}>Preferencias</Text>
          <View style={styles.card}>
            <ToggleRow
              theme={theme}
              icon="archive-outline"
              label="Auto-archivar al terminar"
              sub="Mueve el libro a Archivados al llegar al final."
              value={prefs.autoArchive}
              onChange={(v) => setPreference('autoArchive', v)}
            />
            <View style={styles.divider} />
            <ToggleRow
              theme={theme}
              icon="phone-portrait-outline"
              label="Vibración al interactuar"
              sub="Respuesta táctil al marcar, pasar de página o elegir una opción."
              value={prefs.haptics}
              onChange={(v) => setPreference('haptics', v)}
            />
          </View>
        </Appear>

        {/* --- CUENTA --- */}
        <Appear delay={nextDelay()}>
          <Text style={styles.sectionTitle}>Cuenta</Text>
          <View style={styles.card}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <Ionicons name="cloud-done-outline" size={21} color={theme.colors.textSecondary} />
              <View style={{ flex: 1 }}>
                <Text style={styles.settingLabel}>{session?.user.email}</Text>
                <Text style={styles.settingSub}>
                  {syncError
                    ? `Error al sincronizar: ${syncError}`
                    : syncWarning
                      ? syncWarning
                    : isSyncing
                      ? 'Sincronizando…'
                      : lastSyncedAt
                        ? `Sincronizado a las ${new Date(lastSyncedAt).toLocaleTimeString()}`
                        : 'Biblioteca, archivos y progreso sincronizados entre tus dispositivos.'}
                </Text>
              </View>
            </View>

            <PressableScale
              style={styles.signOutButton}
              scaleTo={0.97}
              accessibilityRole="button"
              disabled={isSyncing}
              onPress={syncNow}
            >
              <Ionicons name="sync-outline" size={19} color={theme.colors.primary} />
              <Text style={[styles.signOutText, { color: theme.colors.primary }]}>Sincronizar ahora</Text>
            </PressableScale>

            <PressableScale
              style={styles.signOutButton}
              scaleTo={0.97}
              accessibilityRole="button"
              onPress={() =>
                confirmDialog({
                  title: 'Cerrar sesión',
                  message: 'Tus libros y progreso siguen guardados en este dispositivo.',
                  confirmText: 'Cerrar sesión',
                  onConfirm: signOut,
                })
              }
            >
              <Ionicons name="log-out-outline" size={19} color={theme.colors.text} />
              <Text style={styles.signOutText}>Cerrar sesión</Text>
            </PressableScale>
          </View>
        </Appear>

        {/* --- BIBLIOTECA --- */}
        <Appear delay={nextDelay()}>
          <Text style={styles.sectionTitle}>Biblioteca</Text>
          <View style={styles.card}>
            <DangerRow
              theme={theme}
              icon="folder-open-outline"
              label="Importar desde una carpeta"
              sub="Cargá varios libros de una a partir de un manifest.json (Android y PC)."
              onPress={() => router.push('/import-library')}
              tone="normal"
            />
          </View>
        </Appear>

        {/* --- GESTIÓN DE DATOS --- */}
        <Appear delay={nextDelay()}>
          <Text style={[styles.sectionTitle, { color: theme.colors.danger }]}>Gestión de datos</Text>
          <View style={[styles.card, { borderColor: theme.colors.danger + '55' }]}>
            <DangerRow
              theme={theme}
              icon="book-outline"
              label="Borrar todos los libros"
              sub={`${books.length} ${books.length === 1 ? 'libro' : 'libros'} y ${notesCount} ${notesCount === 1 ? 'nota' : 'notas'}. Tus estadísticas se mantienen.`}
              onPress={() =>
                confirmAction(
                  'Borrar libros',
                  'Se eliminarán todos los libros y notas, pero conservarás tus estadísticas y rachas.',
                  clearBooks
                )
              }
            />
            <View style={styles.divider} />
            <DangerRow
              theme={theme}
              icon="bar-chart-outline"
              label="Reiniciar estadísticas"
              sub={`${daysCount} ${daysCount === 1 ? 'día registrado' : 'días registrados'}. Tus libros se mantienen.`}
              onPress={() =>
                confirmAction(
                  'Reiniciar estadísticas',
                  'Tu historial mensual, minutos y racha volverán a cero. Tus libros se mantendrán.',
                  clearStats
                )
              }
            />

            <PressableScale
              style={styles.resetButton}
              scaleTo={0.97}
              accessibilityRole="button"
              onPress={() =>
                confirmAction(
                  'Restablecer de fábrica',
                  'Esto eliminará absolutamente toda la información de la aplicación para siempre.',
                  () => { resetAllData(); router.replace('/'); }
                )
              }
            >
              <Ionicons name="warning-outline" size={21} color={theme.colors.danger} />
              <Text style={styles.resetText}>Restablecer de fábrica</Text>
            </PressableScale>
          </View>
        </Appear>

        <Appear delay={nextDelay()} style={styles.aboutSection}>
          <View style={styles.aboutIcon}>
            <Ionicons name="book" size={26} color={theme.colors.primary} />
          </View>
          <Text style={styles.appName}>LectorLibros</Text>
          <Text style={styles.appVersion}>Versión {APP_VERSION}</Text>
          <Text style={styles.appCredit}>Lectura y audio sincronizados, sin conexión</Text>
        </Appear>
      </ScrollView>
    </SafeAreaView>
  );
}

const ToggleRow: React.FC<{
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  value: boolean;
  onChange: (v: boolean) => void;
}> = ({ theme, icon, label, sub, value, onChange }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 }}>
    <Ionicons name={icon} size={21} color={theme.colors.textSecondary} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: theme.fonts.semibold, fontSize: 15, color: theme.colors.text }}>{label}</Text>
      <Text style={{ fontFamily: theme.fonts.regular, fontSize: 12, color: theme.colors.textSecondary, marginTop: 2, lineHeight: 17 }}>
        {sub}
      </Text>
    </View>
    <Switch
      value={value}
      onValueChange={(v) => { selectFeedback(); onChange(v); }}
      trackColor={{ false: theme.colors.border, true: theme.colors.primary }}
      thumbColor="#fff"
    />
  </View>
);

const DangerRow: React.FC<{
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  onPress: () => void;
  /** 'normal' para acciones que no borran nada (ej. importar). */
  tone?: 'danger' | 'normal';
}> = ({ theme, icon, label, sub, onPress, tone = 'danger' }) => (
  <PressableScale
    scaleTo={0.98}
    accessibilityRole="button"
    accessibilityLabel={label}
    onPress={onPress}
    style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }}
  >
    <Ionicons name={icon} size={21} color={tone === 'danger' ? theme.colors.danger : theme.colors.primary} />
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: theme.fonts.semibold, fontSize: 15, color: theme.colors.text }}>{label}</Text>
      <Text style={{ fontFamily: theme.fonts.regular, fontSize: 12, color: theme.colors.textSecondary, marginTop: 2, lineHeight: 17 }}>
        {sub}
      </Text>
    </View>
    <Ionicons name="chevron-forward" size={19} color={theme.colors.textMuted} />
  </PressableScale>
);

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
    scrollContent: { padding: t.spacing.xl, paddingBottom: 48, width: '100%', maxWidth: 720, alignSelf: 'center' },

    sectionTitle: {
      fontFamily: t.fonts.bold, fontSize: 12, color: t.colors.textSecondary,
      letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 10, marginLeft: 4,
    },
    card: {
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 16, marginBottom: 24,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(2),
    },

    settingLabel: { fontFamily: t.fonts.semibold, fontSize: 15, color: t.colors.text },
    settingSub: { fontFamily: t.fonts.regular, fontSize: 12, color: t.colors.textSecondary, marginTop: 3, lineHeight: 17 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border, marginVertical: 16 },

    fontRow: {
      flexDirection: 'row', alignItems: 'center', gap: 12,
      paddingVertical: 11, paddingHorizontal: 14,
      borderRadius: t.radius.md, borderWidth: 1, borderColor: t.colors.border,
    },
    fontRowActive: { borderColor: t.colors.primary, backgroundColor: t.colors.primarySoft },
    fontNote: { fontFamily: t.fonts.regular, fontSize: 11.5, color: t.colors.textMuted, marginTop: 2 },

    signOutButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
      backgroundColor: t.colors.background, borderWidth: 1, borderColor: t.colors.border,
      padding: 12, borderRadius: t.radius.md, marginTop: 16,
    },
    signOutText: { fontFamily: t.fonts.semibold, fontSize: 14, color: t.colors.text },

    resetButton: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9,
      backgroundColor: t.colors.dangerSoft, padding: 14, borderRadius: t.radius.md, marginTop: 16,
    },
    resetText: { fontFamily: t.fonts.bold, fontSize: 15, color: t.colors.danger },

    aboutSection: { alignItems: 'center', marginTop: 8 },
    aboutIcon: {
      width: 54, height: 54, borderRadius: 27, backgroundColor: t.colors.primarySoft,
      alignItems: 'center', justifyContent: 'center', marginBottom: 12,
    },
    appName: { fontFamily: t.fonts.display, fontSize: 17, color: t.colors.text },
    appVersion: { fontFamily: t.fonts.medium, fontSize: 13, color: t.colors.textMuted, marginTop: 3 },
    appCredit: { fontFamily: t.fonts.regular, fontSize: 12, color: t.colors.textMuted, marginTop: 6 },
  });
