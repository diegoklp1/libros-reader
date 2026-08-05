import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { setHapticsEnabled } from './haptics';
import { darkTheme, lightTheme, ReaderThemeName, ReadingFontKey, Theme } from './theme';

export type ThemeMode = 'system' | 'light' | 'dark';

/** Paginado horizontal (como un libro) o scroll vertical continuo. */
export type ReadingMode = 'paged' | 'scroll';

/** Ancho de la columna de texto. En pantallas grandes es lo que evita renglones interminables. */
export type TextWidth = 'narrow' | 'normal' | 'wide';

export interface Preferences {
  themeMode: ThemeMode;
  autoArchive: boolean;
  // Defaults del lector (se recuerdan entre libros)
  readerTheme: ReaderThemeName;
  readingFont: ReadingFontKey;
  readingMode: ReadingMode;
  textWidth: TextWidth;
  fontSize: number;
  lineHeight: number;
  /** Texto justificado a ambos márgenes. */
  justify: boolean;
  /** Tocar el borde izquierdo/derecho pasa de página (solo en modo paginado). */
  tapToTurn: boolean;
  /** Vibración corta al marcar, cambiar de página o elegir una opción. */
  haptics: boolean;
}

const DEFAULTS: Preferences = {
  themeMode: 'system',
  autoArchive: false,
  readerTheme: 'light',
  readingFont: 'literata',
  readingMode: 'paged',
  textWidth: 'normal',
  fontSize: 18,
  lineHeight: 1.6,
  justify: true,
  tapToTurn: true,
  haptics: true,
};

const STORAGE_KEY = '@preferences';

interface PreferencesContextType {
  prefs: Preferences;
  isReady: boolean;
  setPreference: <K extends keyof Preferences>(key: K, value: Preferences[K]) => void;
}

const PreferencesContext = createContext<PreferencesContextType | undefined>(undefined);

export const PreferencesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prefs, setPrefs] = useState<Preferences>(DEFAULTS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(STORAGE_KEY);
        if (stored) setPrefs({ ...DEFAULTS, ...JSON.parse(stored) });
      } catch (error) {
        console.error('Error loading preferences', error);
      } finally {
        setIsReady(true);
      }
    })();
  }, []);

  // El módulo de haptics no puede leer el contexto: se lo mantiene al día acá.
  useEffect(() => {
    setHapticsEnabled(prefs.haptics);
  }, [prefs.haptics]);

  const setPreference = <K extends keyof Preferences>(key: K, value: Preferences[K]) => {
    setPrefs((prev) => {
      const next = { ...prev, [key]: value };
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next)).catch((e) =>
        console.error('Error saving preferences', e)
      );
      return next;
    });
  };

  return (
    <PreferencesContext.Provider value={{ prefs, isReady, setPreference }}>
      {children}
    </PreferencesContext.Provider>
  );
};

export const usePreferences = () => {
  const ctx = useContext(PreferencesContext);
  if (!ctx) throw new Error('usePreferences must be used within a PreferencesProvider');
  return ctx;
};

// Devuelve el tema activo de la app resolviendo 'system' contra el esquema del SO.
export const useTheme = (): Theme => {
  const { prefs } = usePreferences();
  const systemScheme = useColorScheme();
  return useMemo(() => {
    const effective =
      prefs.themeMode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : prefs.themeMode;
    return effective === 'dark' ? darkTheme : lightTheme;
  }, [prefs.themeMode, systemScheme]);
};
