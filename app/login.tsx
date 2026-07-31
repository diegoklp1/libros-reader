import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PressableScale } from '../components/ui/pressable-scale';
import { useAuth } from '../src/AuthContext';
import { selectFeedback } from '../src/haptics';
import { useTheme } from '../src/PreferencesContext';
import { shadow, Theme } from '../src/theme';

/**
 * Login únicamente: la app es de un solo usuario (vos), la cuenta se crea a
 * mano desde el dashboard de Supabase. No hay pantalla de registro a propósito.
 */
export default function LoginScreen() {
  const { signIn } = useAuth();
  const theme = useTheme();
  const styles = useMemo(() => makeStyles(theme), [theme]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Reemplaza el contorno azul por defecto del navegador por uno propio: sigue
  // siendo visible al navegar con teclado, pero habla el mismo idioma visual
  // que el resto de la app en vez de romper la paleta.
  const [focusedField, setFocusedField] = useState<'email' | 'password' | null>(null);

  const handleSubmit = async () => {
    if (!email.trim() || !password) {
      setError('Completá email y contraseña.');
      return;
    }
    setError(null);
    setIsSubmitting(true);
    const { error: signInError } = await signIn(email.trim(), password);
    setIsSubmitting(false);
    if (signInError) {
      selectFeedback();
      setError(
        signInError.toLowerCase().includes('invalid')
          ? 'Email o contraseña incorrectos.'
          : signInError
      );
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.content}>
          <View style={styles.iconWrap}>
            <Ionicons name="book" size={30} color={theme.colors.primary} />
          </View>
          <Text style={styles.title}>LectorLibros</Text>
          <Text style={styles.subtitle}>Iniciá sesión para sincronizar tu progreso entre dispositivos.</Text>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={[styles.input, focusedField === 'email' && styles.inputFocused]}
              value={email}
              onChangeText={setEmail}
              onFocus={() => setFocusedField('email')}
              onBlur={() => setFocusedField(null)}
              placeholder="tu@email.com"
              placeholderTextColor={theme.colors.textMuted}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!isSubmitting}
            />

            <Text style={[styles.label, { marginTop: 14 }]}>Contraseña</Text>
            <TextInput
              style={[styles.input, focusedField === 'password' && styles.inputFocused]}
              value={password}
              onChangeText={setPassword}
              onFocus={() => setFocusedField('password')}
              onBlur={() => setFocusedField(null)}
              placeholder="••••••••"
              placeholderTextColor={theme.colors.textMuted}
              secureTextEntry
              editable={!isSubmitting}
              onSubmitEditing={handleSubmit}
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <PressableScale
              style={[styles.button, isSubmitting && { opacity: 0.7 }]}
              scaleTo={0.97}
              accessibilityRole="button"
              disabled={isSubmitting}
              onPress={handleSubmit}
            >
              {isSubmitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Ingresar</Text>
              )}
            </PressableScale>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    container: { flex: 1, backgroundColor: t.colors.background },
    content: {
      flex: 1,
      justifyContent: 'center',
      padding: t.spacing.xl,
      width: '100%',
      maxWidth: 420,
      alignSelf: 'center',
    },
    iconWrap: {
      width: 60, height: 60, borderRadius: 30, backgroundColor: t.colors.primarySoft,
      alignItems: 'center', justifyContent: 'center', alignSelf: 'center', marginBottom: 14,
    },
    title: { fontFamily: t.fonts.display, fontSize: 26, color: t.colors.text, textAlign: 'center' },
    subtitle: {
      fontFamily: t.fonts.regular, fontSize: 13, color: t.colors.textSecondary,
      textAlign: 'center', marginTop: 6, marginBottom: 28, lineHeight: 18,
    },
    card: {
      backgroundColor: t.colors.surface, borderRadius: t.radius.lg, padding: 20,
      borderWidth: StyleSheet.hairlineWidth, borderColor: t.colors.border, ...shadow(2),
    },
    label: { fontFamily: t.fonts.semibold, fontSize: 13, color: t.colors.textSecondary },
    input: {
      marginTop: 6, borderWidth: 1.5, borderColor: t.colors.border, borderRadius: t.radius.md,
      paddingHorizontal: 14, paddingVertical: 11, fontFamily: t.fonts.regular, fontSize: 15,
      color: t.colors.text, backgroundColor: t.colors.background,
      ...(Platform.OS === 'web' ? { outlineStyle: 'none' as any } : {}),
    },
    inputFocused: { borderColor: t.colors.primary },
    error: { fontFamily: t.fonts.medium, fontSize: 12.5, color: t.colors.danger, marginTop: 12 },
    button: {
      marginTop: 20, backgroundColor: t.colors.primary, borderRadius: t.radius.md,
      paddingVertical: 13, alignItems: 'center', justifyContent: 'center',
    },
    buttonText: { fontFamily: t.fonts.bold, fontSize: 15, color: '#fff' },
  });
