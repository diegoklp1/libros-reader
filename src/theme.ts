// --- SISTEMA DE DISEÑO CENTRALIZADO ---
// Tokens de color, tipografía, espaciado y radios usados en toda la app.
// Soporta modo claro y oscuro reales.

import { Platform, ViewStyle } from 'react-native';

/**
 * Sombra cross-platform. En web usa `boxShadow` (las props `shadow*` están
 * deprecadas en react-native-web); en nativo usa elevation + shadow*.
 */
export const shadow = (level = 2, dir: 'up' | 'down' = 'down'): ViewStyle => {
  const y = (dir === 'up' ? -1 : 1) * Math.max(1, Math.round(level / 2));
  if (Platform.OS === 'web') {
    return { boxShadow: `0px ${y}px ${level * 2}px rgba(11,18,32,0.14)` } as ViewStyle;
  }
  return {
    elevation: level,
    shadowColor: '#0B1220',
    shadowOffset: { width: 0, height: y },
    shadowOpacity: 0.14,
    shadowRadius: level,
  };
};

export const fonts = {
  regular: 'Inter',
  medium: 'InterMedium',
  semibold: 'InterSemi',
  bold: 'InterBold',
  serif: 'Literata',
  serifBold: 'LiterataBold',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 28,
} as const;

/**
 * El driver nativo saca la animación del hilo de JS, pero react-native-web no
 * lo implementa y avisa por consola en cada animación. Se decide una vez acá.
 */
export const USE_NATIVE_DRIVER = Platform.OS !== 'web';

// --- MOVIMIENTO ---
// Duraciones y rigideces únicas para toda la app: si todo se mueve con el mismo
// ritmo, la interfaz se siente de una pieza en lugar de un collage.
export const motion = {
  /** Micro-feedback: presionar un botón, marcar un check. */
  fast: 140,
  /** Transición estándar: aparecer/desaparecer una barra, un panel. */
  normal: 240,
  /** Entradas largas: la lista de libros al abrir la biblioteca. */
  slow: 380,
  /** Retardo entre elementos de una entrada escalonada. */
  stagger: 45,
  /** Resorte para lo que el dedo toca: sin rebote visible, solo cuerpo. */
  press: { damping: 18, stiffness: 320, mass: 0.6 },
  /** Resorte para lo que se desliza solo (indicadores, selectores). */
  slide: { damping: 20, stiffness: 200, mass: 0.9 },
} as const;

// --- RESPONSIVE ---
// Un único lugar donde se decide "esto es un teléfono / una tablet / un monitor".
export const breakpoints = { sm: 480, md: 768, lg: 1024 } as const;

export type SizeClass = 'compact' | 'medium' | 'expanded';

export interface Layout {
  /** compact = teléfono, medium = tablet o teléfono apaisado, expanded = PC. */
  size: SizeClass;
  isCompact: boolean;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** Padding lateral coherente con el ancho disponible. */
  gutter: number;
}

export const layoutFor = (width: number): Layout => {
  const size: SizeClass =
    width < breakpoints.md ? 'compact' : width < breakpoints.lg ? 'medium' : 'expanded';
  return {
    size,
    isCompact: size === 'compact',
    isPhone: width < breakpoints.md,
    isTablet: size === 'medium',
    isDesktop: size === 'expanded',
    gutter: width < breakpoints.sm ? 16 : width < breakpoints.md ? 20 : 28,
  };
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
} as const;

export interface ThemeColors {
  background: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  primary: string;
  primarySoft: string;
  onPrimary: string;
  success: string;
  successSoft: string;
  danger: string;
  dangerSoft: string;
  warning: string;
  overlay: string;
  shadow: string;
}

export interface Theme {
  dark: boolean;
  colors: ThemeColors;
  fonts: typeof fonts;
  spacing: typeof spacing;
  radius: typeof radius;
  motion: typeof motion;
}

const lightColors: ThemeColors = {
  background: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceAlt: '#EEF0F3',
  border: '#E4E7EB',
  text: '#141821',
  textSecondary: '#5B6472',
  textMuted: '#9AA1AC',
  primary: '#2F6BFF',
  primarySoft: '#E9F0FF',
  onPrimary: '#FFFFFF',
  success: '#0FA968',
  successSoft: '#E4F7EE',
  danger: '#E4443B',
  dangerSoft: '#FCECEB',
  warning: '#E08A00',
  overlay: 'rgba(16,20,28,0.45)',
  shadow: '#0B1220',
};

const darkColors: ThemeColors = {
  background: '#0E1116',
  surface: '#181D25',
  surfaceAlt: '#212832',
  border: '#2A313C',
  text: '#E8EAED',
  textSecondary: '#A0A9B5',
  textMuted: '#6B7480',
  primary: '#5B8CFF',
  primarySoft: '#1B2534',
  onPrimary: '#0E1116',
  success: '#2BC98A',
  successSoft: '#132A22',
  danger: '#F0655C',
  dangerSoft: '#2E1A1A',
  warning: '#F5B23D',
  overlay: 'rgba(0,0,0,0.6)',
  shadow: '#000000',
};

const base = { fonts, spacing, radius, motion };

export const lightTheme: Theme = { dark: false, colors: lightColors, ...base };
export const darkTheme: Theme = { dark: true, colors: darkColors, ...base };

// --- FUENTES DE LECTURA ---
// Familias pensadas para leer largo rato, no para titulares. Cada una declara
// un `scale` porque la misma cantidad de puntos se ve de distinto tamaño según
// la altura-x: sin corregirlo, cambiar de fuente parecería cambiar el cuerpo.

export type ReadingFontKey = 'literata' | 'lora' | 'merriweather' | 'inter' | 'atkinson';

export interface ReadingFont {
  label: string;
  /** Para qué sirve, en una línea, dentro del selector. */
  note: string;
  regular: string;
  bold: string;
  italic?: string;
  scale: number;
}

export const READING_FONTS: Record<ReadingFontKey, ReadingFont> = {
  literata: {
    label: 'Literata',
    note: 'Serif diseñada para lectores digitales',
    regular: 'Literata',
    bold: 'LiterataBold',
    italic: 'LiterataItalic',
    scale: 1,
  },
  lora: {
    label: 'Lora',
    note: 'Serif de contraste alto, tono editorial',
    regular: 'Lora',
    bold: 'LoraBold',
    italic: 'LoraItalic',
    scale: 1.04,
  },
  merriweather: {
    label: 'Merriweather',
    note: 'Serif robusta, muy legible en pantallas densas',
    regular: 'Merriweather',
    bold: 'MerriweatherBold',
    scale: 0.94,
  },
  inter: {
    label: 'Inter',
    note: 'Sans neutra, si preferís texto sin remates',
    regular: 'Inter',
    bold: 'InterBold',
    scale: 0.98,
  },
  atkinson: {
    label: 'Atkinson',
    note: 'Alta legibilidad: letras difíciles de confundir',
    regular: 'Atkinson',
    bold: 'AtkinsonBold',
    scale: 1.02,
  },
};

export const READING_FONT_ORDER: ReadingFontKey[] = [
  'literata',
  'lora',
  'merriweather',
  'inter',
  'atkinson',
];

// --- TEMAS DE LECTURA (papel) ---
export type ReaderThemeName = 'light' | 'sepia' | 'dark' | 'night';

export interface ReaderTheme {
  background: string;
  text: string;
  controlBg: string;
  tint: string;
  /** Coincidencias de búsqueda (marcador, alto contraste). */
  highlight: string;
  /** Bloque que está narrando el audio: gris sutil, sin distraer de la lectura. */
  syncHighlight: string;
  /** Color del texto dentro del bloque sincronizado (leve realce). */
  syncText: string;
  noteBg: string;
  /**
   * Fondo de un fragmento marcado por el lector. Tiene que ser mas tenue que
   * `highlight` (busqueda) y distinguirse de `syncHighlight` (audio), porque
   * los tres pueden verse en la misma pagina.
   */
  markBg: string;
  /** Barra al margen del fragmento marcado: es lo que lo hace reconocible. */
  markBar: string;
}

export const READER_THEMES: Record<ReaderThemeName, ReaderTheme> = {
  light: { background: '#FFFFFF', text: '#2A2E35', controlBg: '#FBFBFC', tint: '#2F6BFF', highlight: '#FFE08A', syncHighlight: '#ECEEF1', syncText: '#14181F', noteBg: '#F2F6FF', markBg: '#FFF8E3', markBar: '#E0A93B' },
  sepia: { background: '#F4ECD8', text: '#5B4636', controlBg: '#EBE2CC', tint: '#8B5A2B', highlight: '#E6C388', syncHighlight: '#E6DCC6', syncText: '#3F3025', noteBg: '#FDF7EE', markBg: '#EFE1C0', markBar: '#A9713A' },
  dark: { background: '#121418', text: '#C7CBD1', controlBg: '#1B1E24', tint: '#5B8CFF', highlight: '#4A5B2B', syncHighlight: '#272C34', syncText: '#F0F2F5', noteBg: '#22262E', markBg: '#2B2716', markBar: '#C9A227' },
  // Negro puro: en pantallas OLED los píxeles del fondo quedan apagados, así que
  // de noche no ilumina la cara y consume menos batería. El texto baja a gris
  // medio a propósito — blanco puro sobre negro puro produce halo al leer.
  night: { background: '#000000', text: '#A8ADB5', controlBg: '#0B0D10', tint: '#7FA5FF', highlight: '#4A4520', syncHighlight: '#16191E', syncText: '#DFE3E8', noteBg: '#111419', markBg: '#211D10', markBar: '#B08D1E' },
};

/** Orden y etiquetas del selector de tema en el lector. */
export const READER_THEME_ORDER: { key: ReaderThemeName; label: string }[] = [
  { key: 'light', label: 'Claro' },
  { key: 'sepia', label: 'Sepia' },
  { key: 'dark', label: 'Oscuro' },
  { key: 'night', label: 'Noche' },
];
