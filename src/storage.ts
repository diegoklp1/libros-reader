import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { deleteWebFiles, isWebFileUri, resolveUri, saveWebFile } from './webFiles';

// Carpeta permanente donde vive el contenido importado de cada libro.
// Los pickers devuelven URIs de caché temporal que el SO puede borrar;
// copiamos los archivos aquí para que la biblioteca siga funcionando offline.
const LIBRARY_DIR = FileSystem.documentDirectory ? `${FileSystem.documentDirectory}library/` : null;

async function ensureLibraryDir() {
  if (!LIBRARY_DIR) return;
  const info = await FileSystem.getInfoAsync(LIBRARY_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(LIBRARY_DIR, { intermediates: true });
  }
}

function extensionFromUri(uri: string, fallback: string) {
  const clean = uri.split('?')[0].split('#')[0];
  const match = /\.([a-zA-Z0-9]{1,5})$/.exec(clean);
  return match ? match[1].toLowerCase() : fallback;
}

/**
 * Copia un archivo elegido por el usuario a almacenamiento permanente y
 * devuelve la nueva URI. Si el archivo ya vive donde tiene que vivir, no se
 * vuelve a copiar.
 *
 * Lanza si no puede persistirlo. Antes devolvía la URI original como respaldo,
 * pero esa URI apunta a la caché del selector: el libro quedaba guardado,
 * andaba en el momento, y moría cuando el sistema limpiaba la caché. Es mejor
 * fallar acá, donde todavía se le puede avisar a quien lo está cargando.
 */
export async function persistFile(
  sourceUri: string | null,
  kind: 'cover' | 'text' | 'audio' | 'cues',
  bookId: string
): Promise<string | null> {
  if (!sourceUri) return null;

  // En web no hay sistema de archivos: los bytes van a IndexedDB (ver webFiles.ts).
  if (Platform.OS === 'web') {
    if (isWebFileUri(sourceUri)) return sourceUri;
    return saveWebFile(sourceUri, `${bookId}-${kind}`);
  }

  if (!LIBRARY_DIR) return sourceUri;
  if (sourceUri.startsWith(LIBRARY_DIR)) return sourceUri;

  await ensureLibraryDir();
  const fallbackExt =
    kind === 'cover' ? 'jpg' : kind === 'audio' ? 'mp3' : kind === 'cues' ? 'json' : 'txt';
  const ext = extensionFromUri(sourceUri, fallbackExt);
  const dest = `${LIBRARY_DIR}${bookId}-${kind}.${ext}`;
  // Limpia una versión previa del mismo tipo (evita huérfanos al reemplazar).
  const existing = await FileSystem.getInfoAsync(dest);
  if (existing.exists) await FileSystem.deleteAsync(dest, { idempotent: true });
  await FileSystem.copyAsync({ from: sourceUri, to: dest });
  return dest;
}

/** Lee el contenido de un .txt guardado, sea cual sea la plataforma. */
export async function readTextFile(uri: string): Promise<string> {
  // Los libros sincronizados se sirven mediante URLs firmadas de Supabase en
  // cualquier plataforma. `FileSystem.readAsStringAsync` no lee https, por lo
  // que esos recursos se resuelven con fetch también en Android/iOS.
  if (Platform.OS === 'web' || /^(https?:|blob:|data:)/i.test(uri)) {
    // En web la URI guardada apunta a IndexedDB: hay que traducirla primero.
    const usable = resolveUri(uri);
    if (!usable) throw new Error(`No se encontró el archivo guardado (${uri})`);
    const response = await fetch(usable);
    return response.text();
  }
  return FileSystem.readAsStringAsync(uri);
}

/**
 * Devuelve un cuerpo que Supabase Storage puede subir. En web conservamos el
 * Blob para que el navegador pueda transmitir archivos grandes sin duplicar
 * todo el audiolibro en memoria. En nativo usamos ArrayBuffer, compatible con
 * storage-js y con las URI file/content de los selectores de Expo.
 */
export async function uploadBodyForUri(uri: string): Promise<Blob | ArrayBuffer> {
  const usable = resolveUri(uri) ?? uri;
  const response = await fetch(usable);
  if (!response.ok) throw new Error(`No se pudo leer el archivo (${response.status})`);
  return Platform.OS === 'web' ? response.blob() : response.arrayBuffer();
}

// Elimina todos los archivos asociados a un libro (al borrarlo de la biblioteca).
export async function deleteBookFiles(bookId: string): Promise<void> {
  if (Platform.OS === 'web') return deleteWebFiles(bookId);
  if (!LIBRARY_DIR) return;
  try {
    const dir = await FileSystem.getInfoAsync(LIBRARY_DIR);
    if (!dir.exists) return;
    const entries = await FileSystem.readDirectoryAsync(LIBRARY_DIR);
    await Promise.all(
      entries
        .filter((name) => name.startsWith(`${bookId}-`))
        .map((name) => FileSystem.deleteAsync(`${LIBRARY_DIR}${name}`, { idempotent: true }))
    );
  } catch (error) {
    console.error('No se pudieron borrar los archivos del libro', error);
  }
}
