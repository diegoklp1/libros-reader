// --- ARCHIVOS DE LOS LIBROS EN WEB ---
//
// En Android los archivos se copian a `documentDirectory` y la ruta guardada
// sigue siendo válida para siempre. En el navegador no hay sistema de archivos,
// y lo que devuelve el selector es `URL.createObjectURL(file)`: un puntero
// `blob:` que apunta al archivo en el disco del usuario y que el navegador
// anula al destruir la pestaña. Guardarlo sería guardar una URL que muere al
// recargar — el libro queda en la biblioteca pero ya no se puede abrir.
//
// Así que en web se guardan los BYTES en IndexedDB (no localStorage: ese tiene
// ~5 MB y un audiolibro no entra ni de casualidad) y en el libro se anota una
// URI propia `idb://<libro>-<tipo>`. Al arrancar se convierte cada archivo
// guardado en una URL utilizable de esta sesión.

import { Platform } from 'react-native';

const DB_NAME = 'lectorlibros';
const STORE = 'files';
const SCHEME = 'idb://';

const isWeb = Platform.OS === 'web';

/** URI guardada -> URL utilizable en la sesión actual. Se llena en `primeWebFiles`. */
const objectUrls = new Map<string, string>();

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      })
  );
}

/** `idb://libro-tipo` es una URI nuestra, no algo que el navegador entienda. */
export const isWebFileUri = (uri: string | null | undefined): boolean =>
  !!uri && uri.startsWith(SCHEME);

const keyOf = (uri: string) => uri.slice(SCHEME.length);

/**
 * Guarda el contenido de una URI temporal (`blob:` o `data:`) y devuelve la
 * URI estable con la que hay que anotarla en el libro.
 */
export async function saveWebFile(sourceUri: string, key: string): Promise<string> {
  const blob = await fetch(sourceUri).then((r) => r.blob());
  await run('readwrite', (store) => store.put(blob, key));

  const previous = objectUrls.get(key);
  if (previous) URL.revokeObjectURL(previous);
  objectUrls.set(key, URL.createObjectURL(blob));

  return `${SCHEME}${key}`;
}

/**
 * Prepara todos los archivos guardados para esta sesión. Hay que esperarlo
 * antes de mostrar la biblioteca: si no, las portadas y los textos se pedirían
 * con una URI que todavía no se puede resolver.
 */
export async function primeWebFiles(): Promise<void> {
  if (!isWeb) return;
  try {
    const keys = (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) || [];
    const blobs = (await run<Blob[]>('readonly', (store) => store.getAll())) || [];
    keys.forEach((key, index) => {
      const blob = blobs[index];
      if (!blob) return;
      objectUrls.set(String(key), URL.createObjectURL(blob));
    });
  } catch (error) {
    console.error('No se pudieron preparar los archivos guardados', error);
  }
}

/**
 * Traduce la URI guardada a una que se pueda usar ahora (`<Image>`, el
 * reproductor de audio, `fetch`). Cualquier otra URI pasa de largo, así que es
 * seguro llamarla siempre, en cualquier plataforma.
 */
export function resolveUri(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (!isWebFileUri(uri)) return uri;
  return objectUrls.get(keyOf(uri)) ?? null;
}

/** Borra los archivos de un libro. Las claves son `<idLibro>-<tipo>`. */
export async function deleteWebFiles(bookId: string): Promise<void> {
  if (!isWeb) return;
  try {
    const keys = (await run<IDBValidKey[]>('readonly', (store) => store.getAllKeys())) || [];
    const mine = keys.map(String).filter((key) => key.startsWith(`${bookId}-`));
    await Promise.all(mine.map((key) => run('readwrite', (store) => store.delete(key))));
    mine.forEach((key) => {
      const url = objectUrls.get(key);
      if (url) URL.revokeObjectURL(url);
      objectUrls.delete(key);
    });
  } catch (error) {
    console.error('No se pudieron borrar los archivos del libro', error);
  }
}

/** Vacía el almacén completo (restablecer de fábrica). */
export async function clearWebFiles(): Promise<void> {
  if (!isWeb) return;
  try {
    await run('readwrite', (store) => store.clear());
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls.clear();
  } catch (error) {
    console.error('No se pudo vaciar el almacén de archivos', error);
  }
}
