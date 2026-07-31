// --- IMPORTACIÓN MASIVA DESDE CARPETA RAÍZ ---
//
// Idea: en vez de cargar cada libro a mano desde `add-book.tsx`, se elige UNA
// carpeta raíz que adentro tiene una subcarpeta por libro (como ya arma
// `tools/procesar_libro.py`) y un `manifest.json` en la raíz que dice, para
// cada libro, dónde está su .txt, su audio y su .srt (rutas relativas a esa
// raíz). La app lee ese JSON y los carga todos de una.
//
// La forma de "elegir una carpeta y leer todo lo que hay adentro" es la parte
// que cambia por plataforma:
//   - Web: un <input type="file" webkitdirectory> deja elegir una carpeta
//     completa y da todos sus archivos con `webkitRelativePath`.
//   - Android: Storage Access Framework (`expo-file-system`) permite lo mismo,
//     pero hay que recorrer el árbol a mano (ver `pickFolderAndroid`).
//   - iOS no tiene un picker de carpetas equivalente sin un módulo nativo
//     aparte, así que no está soportado acá.

import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { genId } from './BookContext';
import { persistFile } from './storage';

export interface ManifestEntry {
  titulo: string;
  autor?: string;
  categoria?: string;
  descripcion?: string;
  /** Rutas relativas a la carpeta raíz elegida. */
  txt: string;
  audio?: string;
  srt?: string;
  portada?: string;
}

export interface Manifest {
  libros: ManifestEntry[];
}

export interface ImportPlanItem {
  entry: ManifestEntry;
  txtUri: string | null;
  audioUri: string | null;
  srtUri: string | null;
  coverUri: string | null;
  /** El .txt es el único archivo obligatorio: sin texto no hay libro que mostrar. */
  missingTxt: boolean;
  /** Ya existe un libro con el mismo título y autor en la biblioteca. */
  alreadyExists: boolean;
}

const normalizePath = (p: string) => p.replace(/\\/g, '/').replace(/^\/+/, '').trim().toLowerCase();

const bookIdentity = (title: string, author?: string) =>
  `${title.trim().toLowerCase()}__${(author || '').trim().toLowerCase()}`;

export function parseManifest(raw: string): Manifest {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('manifest.json no es un JSON válido.');
  }
  const libros = (data as any)?.libros;
  if (!Array.isArray(libros)) {
    throw new Error('manifest.json debe tener un array "libros".');
  }
  libros.forEach((l, i) => {
    if (!l || typeof l.titulo !== 'string' || !l.titulo.trim()) {
      throw new Error(`El libro en la posición ${i + 1} no tiene "titulo".`);
    }
    if (typeof l.txt !== 'string' || !l.txt.trim()) {
      throw new Error(`"${l.titulo}" no tiene "txt" (es el único archivo obligatorio).`);
    }
  });
  return { libros };
}

/** Cruza el manifest con los archivos realmente encontrados en la carpeta elegida. */
export function buildImportPlan(
  manifest: Manifest,
  fileMap: Map<string, string>,
  existingBooks: { title: string; author?: string }[]
): ImportPlanItem[] {
  const existing = new Set(existingBooks.map((b) => bookIdentity(b.title, b.author)));
  const resolve = (rel?: string) => (rel ? fileMap.get(normalizePath(rel)) ?? null : null);

  return manifest.libros.map((entry) => ({
    entry,
    txtUri: resolve(entry.txt),
    audioUri: resolve(entry.audio),
    srtUri: resolve(entry.srt),
    coverUri: resolve(entry.portada),
    missingTxt: !resolve(entry.txt),
    alreadyExists: existing.has(bookIdentity(entry.titulo, entry.autor)),
  }));
}

/** Persiste los archivos de un ítem del plan y devuelve los datos listos para `addBook`. */
export async function materializeImportItem(item: ImportPlanItem) {
  const bookId = genId();
  const [coverUri, txtUri, audioUri, cuesUri] = await Promise.all([
    item.coverUri ? persistFile(item.coverUri, 'cover', bookId) : Promise.resolve(null),
    item.txtUri ? persistFile(item.txtUri, 'text', bookId) : Promise.resolve(null),
    item.audioUri ? persistFile(item.audioUri, 'audio', bookId) : Promise.resolve(null),
    item.srtUri ? persistFile(item.srtUri, 'cues', bookId) : Promise.resolve(null),
  ]);
  return {
    bookId,
    data: {
      title: item.entry.titulo,
      author: item.entry.autor?.trim() || undefined,
      category: item.entry.categoria?.trim() || 'General',
      description: item.entry.descripcion?.trim() || '',
      coverUri,
      txtUri,
      audioUri,
      cuesUri,
    },
  };
}

/** Lee el contenido de texto de una URI "de paso" (blob: en web, content:// en Android). */
async function readUriAsText(uri: string): Promise<string> {
  if (Platform.OS === 'web') return fetch(uri).then((r) => r.text());
  return FileSystem.readAsStringAsync(uri);
}

// ------------------------------------------------------------------- web

/**
 * Abre el selector de carpetas del navegador (`webkitdirectory`) y devuelve
 * un mapa "ruta relativa normalizada -> URL utilizable" (un object URL por
 * archivo) más el manifest ya parseado.
 */
export function pickFolderWeb(): Promise<{ manifest: Manifest; fileMap: Map<string, string> }> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    // `webkitdirectory` no está en el tipo TS de HTMLInputElement.
    (input as any).webkitdirectory = true;

    input.onchange = async () => {
      const files = Array.from(input.files || []);
      if (files.length === 0) {
        reject(new Error('No se eligió ninguna carpeta.'));
        return;
      }
      // `webkitRelativePath` viene como "NombreCarpetaRaiz/sub/archivo.ext":
      // se saca el primer segmento para que quede relativo a la raíz elegida.
      const fileMap = new Map<string, string>();
      let manifestFile: File | null = null;
      for (const file of files) {
        const rel = (file as any).webkitRelativePath as string;
        const withoutRoot = rel.split('/').slice(1).join('/');
        const key = normalizePath(withoutRoot);
        fileMap.set(key, URL.createObjectURL(file));
        if (key === 'manifest.json') manifestFile = file;
      }
      if (!manifestFile) {
        reject(new Error('No se encontró manifest.json en la raíz de la carpeta elegida.'));
        return;
      }
      try {
        const manifest = parseManifest(await manifestFile.text());
        resolve({ manifest, fileMap });
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => reject(new Error('cancelado'));
    input.click();
  });
}

// --------------------------------------------------------------- android

/**
 * Pide permiso sobre una carpeta vía Storage Access Framework y recorre todo
 * su árbol. No hay forma de distinguir "archivo" de "carpeta" en la respuesta
 * de `readDirectoryAsync`: se intenta leer cada URI como carpeta, y si falla,
 * se la trata como archivo. Es un poco un rodeo, pero es lo que da la API.
 */
export async function pickFolderAndroid(): Promise<{ manifest: Manifest; fileMap: Map<string, string> }> {
  const SAF = FileSystem.StorageAccessFramework;
  const perm = await SAF.requestDirectoryPermissionsAsync();
  if (!perm.granted) throw new Error('No se otorgó acceso a la carpeta.');

  const rootUri = perm.directoryUri;
  // La URI de la raíz es un "tree" (.../tree/primary%3ALIBROS), no un
  // "document" como sus hijos (.../document/primary%3ALIBROS%2Fsub%2Farchivo):
  // hay que decodificarla desde el segmento que le corresponde a ELLA, si no
  // el prefijo a descontar de cada hijo sale mal y todas las rutas relativas
  // quedan rotas.
  const rootDocId = decodeURIComponent(rootUri.split('/tree/')[1] ?? '');
  const rootPath = rootDocId.includes(':') ? rootDocId.split(':')[1] : rootDocId;

  const fileMap = new Map<string, string>();

  const relativePathOf = (uri: string) => {
    const docId = decodeURIComponent(uri.split('/document/')[1] ?? '');
    const fullPath = docId.includes(':') ? docId.split(':')[1] : docId;
    return fullPath.startsWith(rootPath) ? fullPath.slice(rootPath.length).replace(/^\/+/, '') : fullPath;
  };

  const walk = async (dirUri: string) => {
    const children = await SAF.readDirectoryAsync(dirUri);
    for (const childUri of children) {
      try {
        // Si esto no tira, era una carpeta: se sigue recorriendo.
        await SAF.readDirectoryAsync(childUri);
        await walk(childUri);
      } catch {
        // Si tira, es un archivo: se registra con su ruta relativa a la raíz.
        fileMap.set(normalizePath(relativePathOf(childUri)), childUri);
      }
    }
  };
  await walk(rootUri);

  const manifestKey = [...fileMap.keys()].find((k) => k === 'manifest.json');
  if (!manifestKey) throw new Error('No se encontró manifest.json en la raíz de la carpeta elegida.');
  const manifest = parseManifest(await readUriAsText(fileMap.get(manifestKey)!));
  return { manifest, fileMap };
}

export const bulkImportSupported = Platform.OS === 'web' || Platform.OS === 'android';

export function pickLibraryFolder() {
  if (Platform.OS === 'web') return pickFolderWeb();
  if (Platform.OS === 'android') return pickFolderAndroid();
  return Promise.reject(new Error('La importación por carpeta no está disponible en iOS todavía.'));
}
