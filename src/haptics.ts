// --- FEEDBACK HÁPTICO ---
// Envoltorio sobre expo-haptics con dos responsabilidades: respetar la
// preferencia del usuario y no reventar en web, donde la API no existe.
//
// El estado vive en un módulo y no en el contexto porque las vibraciones se
// disparan desde callbacks y worklets, donde no hay hooks disponibles.

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

let enabled = true;

/** La llama el PreferencesProvider cada vez que cambia la preferencia. */
export const setHapticsEnabled = (value: boolean) => {
  enabled = value;
};

const available = () => enabled && Platform.OS !== 'web';

/** Tocar un botón, pasar de página. */
export const tapFeedback = () => {
  if (available()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
};

/** Elegir una opción dentro de un selector. */
export const selectFeedback = () => {
  if (available()) Haptics.selectionAsync().catch(() => {});
};

/** Abrir un menú contextual con pulsación larga. */
export const longPressFeedback = () => {
  if (available()) Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
};

/** Guardar algo, terminar un libro. */
export const successFeedback = () => {
  if (available()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
};

/** Borrar, o una acción que no se pudo completar. */
export const warningFeedback = () => {
  if (available()) Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
};
