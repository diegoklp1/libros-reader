import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Appear } from '../components/ui/appear';
import { PressableScale } from '../components/ui/pressable-scale';
import { Sheet } from '../components/ui/sheet';
import { NewBook, useBooks } from '../src/BookContext';
import { selectFeedback, successFeedback, warningFeedback } from '../src/haptics';
import { useTheme } from '../src/PreferencesContext';
import { persistFile } from '../src/storage';
import { shadow, Theme } from '../src/theme';
import { resolveUri } from '../src/webFiles';

export default function AddBookScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { books, addBook, updateBook } = useBooks();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const editingBook = id ? books.find((b) => b.id === id) : null;

  const [title, setTitle] = useState(editingBook?.title || '');
  const [author, setAuthor] = useState(editingBook?.author || '');
  const [category, setCategory] = useState(editingBook?.category || 'General');
  const [description, setDescription] = useState(editingBook?.description || '');
  const [coverUri, setCoverUri] = useState<string | null>(editingBook?.coverUri || null);
  const [txtUri, setTxtUri] = useState<string | null>(editingBook?.txtUri || null);
  const [audioUri, setAudioUri] = useState<string | null>(editingBook?.audioUri || null);
  const [cuesUri, setCuesUri] = useState<string | null>(editingBook?.cuesUri || null);

  const [isProcessing, setIsProcessing] = useState(false);
  // Reemplaza el contorno azul por defecto del navegador (ver `outlineStyle`
  // más abajo) por uno propio, coherente con la paleta de la app.
  const [focusedField, setFocusedField] = useState<string | null>(null);
  const focusHandlers = (name: string) => ({
    onFocus: () => setFocusedField(name),
    onBlur: () => setFocusedField((f) => (f === name ? null : f)),
  });
  const [showCategorySheet, setShowCategorySheet] = useState(false);
  const [isCreatingNewCategory, setIsCreatingNewCategory] = useState(false);

  const uniqueCategories = useMemo(() => {
    const cats = books.map((b) => b.category || 'General');
    return Array.from(new Set(cats)).sort();
  }, [books]);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [2, 3],
      quality: 0.8,
    });
    if (!result.canceled) { setCoverUri(result.assets[0].uri); selectFeedback(); }
  };

  const pickDocument = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'text/plain', copyToCacheDirectory: true });
    if (!result.canceled) { setTxtUri(result.assets[0].uri); selectFeedback(); }
  };

  const pickAudio = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: 'audio/*', copyToCacheDirectory: true });
    if (!result.canceled) { setAudioUri(result.assets[0].uri); selectFeedback(); }
  };

  const pickCues = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled) return;
    const name = (result.assets[0].name || '').toLowerCase();
    if (!/\.(json|srt|vtt)$/.test(name)) {
      warningFeedback();
      Alert.alert('Formato no válido', 'El archivo de sincronización debe ser .json, .srt o .vtt');
      return;
    }
    setCuesUri(result.assets[0].uri);
    selectFeedback();
  };

  // El botón de guardar se apaga hasta que estén los dos datos imprescindibles,
  // en vez de dejar pulsarlo y responder con un error.
  const canSave = !!title.trim() && !!txtUri && !isProcessing;

  // Al editar, la portada ya guardada llega como URI nuestra; recién elegida,
  // como URI del selector. `resolveUri` deja pasar la segunda tal cual.
  const coverPreview = resolveUri(coverUri);

  const handleSave = async () => {
    if (!title.trim()) {
      warningFeedback();
      Alert.alert('Faltan datos', 'El libro debe tener al menos un título.');
      return;
    }
    if (!txtUri) {
      warningFeedback();
      Alert.alert('Falta el texto', 'Seleccioná un archivo .txt para poder leerlo.');
      return;
    }

    setIsProcessing(true);
    try {
      const bookId = editingBook?.id ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

      // Copia los archivos a almacenamiento permanente (offline-first).
      const [finalCover, finalTxt, finalAudio, finalCues] = await Promise.all([
        persistFile(coverUri, 'cover', bookId),
        persistFile(txtUri, 'text', bookId),
        persistFile(audioUri, 'audio', bookId),
        persistFile(cuesUri, 'cues', bookId),
      ]);

      const data = {
        title: title.trim(),
        author: author.trim(),
        category: category.trim() || 'General',
        description: description.trim(),
        coverUri: finalCover,
        txtUri: finalTxt,
        audioUri: finalAudio,
        cuesUri: finalCues,
      };

      if (editingBook) updateBook(editingBook.id, data);
      else addBook(data as NewBook, bookId);

      successFeedback();
      if (router.canGoBack()) router.back();
      else router.replace('/');
    } catch (error) {
      console.error(error);
      warningFeedback();
      // El libro no se guarda si alguno de sus archivos no se pudo copiar:
      // guardarlo a medias produce una ficha que se abre hoy y falla mañana.
      Alert.alert(
        'No se pudo guardar',
        'Hubo un problema al copiar los archivos del libro. Revisá que siga disponible el archivo que elegiste y probá de nuevo.'
      );
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: editingBook ? 'Editar libro' : 'Nuevo libro' }} />

      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* --- ARCHIVOS --- */}
        <Appear>
          <Text style={styles.sectionTitle}>Archivos</Text>

          <View style={styles.filesRow}>
            <PressableScale style={styles.coverPicker} scaleTo={0.97} onPress={pickImage} disabled={isProcessing}>
              {coverPreview ? (
                <Image source={{ uri: coverPreview }} style={styles.coverImage} resizeMode="cover" />
              ) : (
                <>
                  <Ionicons name="image-outline" size={26} color={theme.colors.textMuted} />
                  <Text style={styles.coverPickerText}>Portada</Text>
                </>
              )}
              {coverUri && (
                <View style={styles.coverEditBadge}>
                  <Ionicons name="pencil" size={12} color="#fff" />
                </View>
              )}
            </PressableScale>

            <View style={{ flex: 1, gap: 10 }}>
              <FilePicker
                theme={theme}
                icon="document-text"
                label="Texto del libro"
                hint=".txt — obligatorio"
                selected={!!txtUri}
                required
                onPress={pickDocument}
                disabled={isProcessing}
              />
              <FilePicker
                theme={theme}
                icon="musical-notes"
                label="Audiolibro"
                hint="mp3, m4a… — opcional"
                selected={!!audioUri}
                onPress={pickAudio}
                disabled={isProcessing}
              />
              {!!audioUri && (
                <Appear distance={8}>
                  <FilePicker
                    theme={theme}
                    icon="git-compare"
                    label="Tiempos de sincronización"
                    hint=".srt, .vtt o .json — opcional"
                    selected={!!cuesUri}
                    onPress={pickCues}
                    disabled={isProcessing}
                  />
                </Appear>
              )}
            </View>
          </View>

          {!!audioUri && !cuesUri && (
            <Appear distance={8} style={styles.hintBox}>
              <Ionicons name="information-circle-outline" size={17} color={theme.colors.primary} />
              <Text style={styles.hintText}>
                Sin archivo de tiempos, la app estima la sincronización por longitud del texto y podés ajustarla
                manteniendo presionado un párrafo en el lector.
              </Text>
            </Appear>
          )}
        </Appear>

        {/* --- DATOS --- */}
        <Appear delay={70}>
          <Text style={styles.sectionTitle}>Datos del libro</Text>

          <Text style={styles.label}>Título</Text>
          <TextInput
            style={[styles.input, focusedField === 'title' && styles.inputFocused]}
            placeholder="Ej: Meditaciones"
            placeholderTextColor={theme.colors.textMuted}
            value={title}
            onChangeText={setTitle}
            editable={!isProcessing}
            {...focusHandlers('title')}
          />

          <Text style={styles.label}>Autor (opcional)</Text>
          <TextInput
            style={[styles.input, focusedField === 'author' && styles.inputFocused]}
            placeholder="Ej: Marco Aurelio"
            placeholderTextColor={theme.colors.textMuted}
            value={author}
            onChangeText={setAuthor}
            editable={!isProcessing}
            {...focusHandlers('author')}
          />

          <Text style={styles.label}>Categoría</Text>
          {isCreatingNewCategory ? (
            <View style={styles.newCategoryRow}>
              <TextInput
                style={[
                  styles.input,
                  { flex: 1, marginBottom: 0 },
                  focusedField === 'category' && styles.inputFocused,
                ]}
                placeholder="Escribí la nueva categoría…"
                placeholderTextColor={theme.colors.textMuted}
                value={category}
                onChangeText={setCategory}
                editable={!isProcessing}
                autoFocus
                {...focusHandlers('category')}
              />
              <PressableScale
                style={{ padding: 5 }}
                scaleTo={0.88}
                onPress={() => {
                  setIsCreatingNewCategory(false);
                  setCategory(editingBook?.category || 'General');
                }}
              >
                <Ionicons name="close-circle" size={27} color={theme.colors.danger} />
              </PressableScale>
            </View>
          ) : (
            <PressableScale
              style={styles.dropdownInput}
              scaleTo={0.98}
              onPress={() => setShowCategorySheet(true)}
              disabled={isProcessing}
            >
              <Text style={styles.dropdownInputText}>{category || 'Seleccionar…'}</Text>
              <Ionicons name="chevron-down" size={19} color={theme.colors.textSecondary} />
            </PressableScale>
          )}

          <View style={{ height: 16 }} />

          <Text style={styles.label}>Descripción breve (opcional)</Text>
          <TextInput
            style={[styles.input, styles.textArea, focusedField === 'description' && styles.inputFocused]}
            placeholder="¿De qué trata este libro?"
            placeholderTextColor={theme.colors.textMuted}
            value={description}
            onChangeText={setDescription}
            multiline
            editable={!isProcessing}
            {...focusHandlers('description')}
          />
        </Appear>
      </ScrollView>

      <View style={styles.footer}>
        {!canSave && !isProcessing && (
          <Text style={styles.footerHint}>
            {!title.trim() ? 'Falta el título' : 'Falta el archivo de texto'}
          </Text>
        )}
        <PressableScale
          style={[styles.saveButton, !canSave && styles.saveButtonDisabled]}
          scaleTo={0.97}
          onPress={handleSave}
          disabled={!canSave}
        >
          {isProcessing ? (
            <ActivityIndicator color={theme.colors.onPrimary} />
          ) : (
            <>
              <Ionicons name={editingBook ? 'save-outline' : 'checkmark-circle-outline'} size={22} color={theme.colors.onPrimary} />
              <Text style={styles.saveButtonText}>{editingBook ? 'Guardar cambios' : 'Guardar en biblioteca'}</Text>
            </>
          )}
        </PressableScale>
      </View>

      {/* --- CATEGORÍAS --- */}
      <Sheet visible={showCategorySheet} onClose={() => setShowCategorySheet(false)} theme={theme} draggable={false}>
        <Text style={styles.sheetTitle}>Seleccionar categoría</Text>

        <FlatList
          data={uniqueCategories}
          keyExtractor={(item) => item}
          style={{ maxHeight: 280, marginTop: 12 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<Text style={styles.emptyCats}>Todavía no hay categorías.</Text>}
          renderItem={({ item }) => {
            const active = category === item && !isCreatingNewCategory;
            return (
              <PressableScale
                style={styles.sheetItem}
                scaleTo={0.98}
                onPress={() => {
                  selectFeedback();
                  setCategory(item);
                  setIsCreatingNewCategory(false);
                  setShowCategorySheet(false);
                }}
              >
                <Text style={[styles.sheetItemText, active && styles.sheetItemTextActive]}>{item}</Text>
                {active && <Ionicons name="checkmark" size={20} color={theme.colors.primary} />}
              </PressableScale>
            );
          }}
        />

        <PressableScale
          style={styles.addCategoryBtn}
          scaleTo={0.97}
          haptic
          onPress={() => {
            setShowCategorySheet(false);
            setCategory('');
            setIsCreatingNewCategory(true);
          }}
        >
          <Ionicons name="add-circle-outline" size={20} color={theme.colors.primary} />
          <Text style={styles.addCategoryBtnText}>Crear nueva categoría</Text>
        </PressableScale>
      </Sheet>
    </KeyboardAvoidingView>
  );
}

const FilePicker: React.FC<{
  theme: Theme;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  hint: string;
  selected: boolean;
  required?: boolean;
  disabled?: boolean;
  onPress: () => void;
}> = ({ theme, icon, label, hint, selected, required, disabled, onPress }) => (
  <PressableScale
    scaleTo={0.97}
    onPress={onPress}
    disabled={disabled}
    accessibilityRole="button"
    accessibilityLabel={`${label}. ${selected ? 'Cargado' : 'Sin cargar'}`}
    style={{
      flexDirection: 'row', alignItems: 'center', gap: 11,
      backgroundColor: selected ? theme.colors.primarySoft : theme.colors.surface,
      paddingVertical: 12, paddingHorizontal: 13,
      borderRadius: theme.radius.md,
      borderWidth: 1.5,
      borderStyle: selected ? 'solid' : 'dashed',
      borderColor: selected ? theme.colors.primary : required ? theme.colors.border : theme.colors.border,
    }}
  >
    <Ionicons
      name={selected ? icon : (`${icon}-outline` as keyof typeof Ionicons.glyphMap)}
      size={21}
      color={selected ? theme.colors.primary : theme.colors.textSecondary}
    />
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: theme.fonts.semibold, fontSize: 13.5, color: selected ? theme.colors.primary : theme.colors.text }}>
        {label}
      </Text>
      <Text style={{ fontFamily: theme.fonts.regular, fontSize: 11, color: theme.colors.textMuted, marginTop: 1 }}>
        {selected ? 'Cargado · tocá para cambiar' : hint}
      </Text>
    </View>
    {selected && <Ionicons name="checkmark-circle" size={19} color={theme.colors.primary} />}
  </PressableScale>
);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    scrollContent: { padding: t.spacing.xl, paddingBottom: 32, width: '100%', maxWidth: 720, alignSelf: 'center' },

    sectionTitle: {
      fontFamily: t.fonts.bold, fontSize: 12, color: t.colors.textSecondary,
      letterSpacing: 0.7, textTransform: 'uppercase', marginBottom: 12, marginTop: 6,
    },

    filesRow: { flexDirection: 'row', gap: 12 },
    coverPicker: {
      width: 106, height: 158, borderRadius: t.radius.md,
      backgroundColor: t.colors.surface, alignItems: 'center', justifyContent: 'center',
      borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.colors.border, overflow: 'hidden',
    },
    coverImage: { width: '100%', height: '100%' },
    coverPickerText: { fontFamily: t.fonts.semibold, fontSize: 12, color: t.colors.textMuted, marginTop: 6 },
    coverEditBadge: {
      position: 'absolute', bottom: 7, right: 7, width: 24, height: 24, borderRadius: 12,
      backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center',
    },

    hintBox: {
      flexDirection: 'row', gap: 9, alignItems: 'flex-start',
      backgroundColor: t.colors.primarySoft, padding: 12, borderRadius: t.radius.md, marginTop: 12,
    },
    hintText: { flex: 1, fontFamily: t.fonts.regular, fontSize: 12, color: t.colors.textSecondary, lineHeight: 17 },

    label: { fontFamily: t.fonts.semibold, fontSize: 13, color: t.colors.textSecondary, marginBottom: 7 },
    input: {
      backgroundColor: t.colors.surface, fontFamily: t.fonts.regular, fontSize: 16, color: t.colors.text,
      padding: 13, borderRadius: t.radius.md,
      borderWidth: 1.5, borderColor: t.colors.border, marginBottom: 16,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
    },
    inputFocused: { borderColor: t.colors.primary },
    textArea: { minHeight: 96, textAlignVertical: 'top' },

    dropdownInput: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      backgroundColor: t.colors.surface, padding: 14, borderRadius: t.radius.md,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    },
    dropdownInputText: { fontFamily: t.fonts.regular, fontSize: 16, color: t.colors.text },
    newCategoryRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },

    sheetTitle: { fontFamily: t.fonts.bold, fontSize: 18, color: t.colors.text },
    sheetItem: {
      flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border,
    },
    sheetItemText: { fontFamily: t.fonts.regular, fontSize: 16, color: t.colors.textSecondary },
    sheetItemTextActive: { fontFamily: t.fonts.bold, color: t.colors.primary },
    emptyCats: { fontFamily: t.fonts.regular, color: t.colors.textMuted, textAlign: 'center', paddingVertical: 20 },
    addCategoryBtn: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
      marginTop: t.spacing.md, paddingVertical: 14,
      backgroundColor: t.colors.primarySoft, borderRadius: t.radius.md,
    },
    addCategoryBtnText: { fontFamily: t.fonts.semibold, fontSize: 15, color: t.colors.primary },

    footer: {
      paddingHorizontal: t.spacing.xl, paddingTop: 12,
      paddingBottom: Platform.OS === 'ios' ? 30 : 18,
      backgroundColor: t.colors.surface,
      borderTopWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border,
    },
    footerHint: { fontFamily: t.fonts.medium, fontSize: 12, color: t.colors.textMuted, textAlign: 'center', marginBottom: 9 },
    saveButton: {
      backgroundColor: t.colors.primary, flexDirection: 'row', gap: 8, padding: 16,
      borderRadius: t.radius.md, alignItems: 'center', justifyContent: 'center',
      width: '100%', maxWidth: 680, alignSelf: 'center', ...shadow(4),
    },
    saveButtonDisabled: { opacity: 0.45 },
    saveButtonText: { fontFamily: t.fonts.bold, color: t.colors.onPrimary, fontSize: 16 },
  });
