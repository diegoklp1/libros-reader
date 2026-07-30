import { AtkinsonHyperlegible_400Regular, AtkinsonHyperlegible_700Bold } from '@expo-google-fonts/atkinson-hyperlegible';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { Literata_400Regular, Literata_400Regular_Italic, Literata_700Bold } from '@expo-google-fonts/literata';
import { Lora_400Regular, Lora_400Regular_Italic, Lora_700Bold } from '@expo-google-fonts/lora';
import { Merriweather_400Regular, Merriweather_700Bold } from '@expo-google-fonts/merriweather';
import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from '../src/AuthContext';
import { BookProvider } from '../src/BookContext';
import { PreferencesProvider, useTheme } from '../src/PreferencesContext';

SplashScreen.preventAutoHideAsync();
// Que el splash se disuelva en vez de cortar de golpe contra la biblioteca.
SplashScreen.setOptions({ duration: 320, fade: true });

function Navigation() {
  const theme = useTheme();
  const { session, isLoading } = useAuth();

  const navTheme = {
    ...(theme.dark ? DarkTheme : DefaultTheme),
    colors: {
      ...(theme.dark ? DarkTheme : DefaultTheme).colors,
      background: theme.colors.background,
      card: theme.colors.surface,
      text: theme.colors.text,
      border: theme.colors.border,
      primary: theme.colors.primary,
    },
  };

  // Mientras se resuelve si hay una sesión guardada, no se sabe todavía si
  // mostrar la biblioteca o el login: mejor esperar un instante en blanco que
  // parpadear entre las dos.
  if (isLoading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  return (
    <ThemeProvider value={navTheme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: theme.colors.surface },
          headerTintColor: theme.colors.text,
          headerTitleStyle: { fontFamily: theme.fonts.bold },
          contentStyle: { backgroundColor: theme.colors.background },
          animation: 'slide_from_right',
          animationDuration: 260,
        }}
      >
        <Stack.Protected guard={!!session}>
          <Stack.Screen name="index" options={{ headerShown: false, animation: 'fade' }} />
          <Stack.Screen name="add-book" options={{ title: 'Agregar Libro', presentation: 'modal', animation: 'slide_from_bottom' }} />
          <Stack.Screen name="reader" options={{ headerShown: false, animation: 'fade_from_bottom' }} />
          <Stack.Screen name="stats" options={{ headerShown: false }} />
          <Stack.Screen name="settings" options={{ headerShown: false }} />
        </Stack.Protected>
        <Stack.Protected guard={!session}>
          <Stack.Screen name="login" options={{ headerShown: false, animation: 'fade' }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}

export default function RootLayout() {
  // Las claves son los nombres que usan `fonts` y `READING_FONTS` en src/theme.ts.
  const [fontsLoaded, fontError] = useFonts({
    Inter: Inter_400Regular,
    InterMedium: Inter_500Medium,
    InterSemi: Inter_600SemiBold,
    InterBold: Inter_700Bold,
    Literata: Literata_400Regular,
    LiterataBold: Literata_700Bold,
    LiterataItalic: Literata_400Regular_Italic,
    Lora: Lora_400Regular,
    LoraBold: Lora_700Bold,
    LoraItalic: Lora_400Regular_Italic,
    Merriweather: Merriweather_400Regular,
    MerriweatherBold: Merriweather_700Bold,
    Atkinson: AtkinsonHyperlegible_400Regular,
    AtkinsonBold: AtkinsonHyperlegible_700Bold,
  });

  // Si alguna fuente falla, arrancar igual: React Native cae a la del sistema y
  // la app sigue siendo usable. Quedarse en el splash para siempre, no.
  const ready = fontsLoaded || !!fontError;

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PreferencesProvider>
          <AuthProvider>
            <BookProvider>
              <Navigation />
            </BookProvider>
          </AuthProvider>
        </PreferencesProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
