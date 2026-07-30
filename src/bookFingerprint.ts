import * as FileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';
import { resolveUri } from './webFiles';

/**
 * cyrb53: hash rápido de 53 bits, no criptográfico. Alcanza y sobra para
 * distinguir archivos de texto entre sí (no hay adversario, solo hace falta
 * que el mismo contenido dé siempre el mismo resultado). Implementación de
 * dominio público (bryc, https://github.com/bryc/code/blob/master/jshash).
 */
function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

const CHUNK_BYTES = 4096;

async function readChunk(txtUri: string): Promise<{ size: number; chunk: string } | null> {
  try {
    if (Platform.OS === 'web') {
      const resolved = resolveUri(txtUri);
      if (!resolved) return null;
      const blob = await fetch(resolved).then((r) => r.blob());
      const chunk = await blob.slice(0, CHUNK_BYTES).text();
      return { size: blob.size, chunk };
    }
    const info = await FileSystem.getInfoAsync(txtUri);
    if (!info.exists) return null;
    const chunk = await FileSystem.readAsStringAsync(txtUri, { length: CHUNK_BYTES, position: 0 });
    return { size: 'size' in info ? info.size : chunk.length, chunk };
  } catch {
    return null;
  }
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

// Un libro cuyo archivo no se pudo leer todavía (fallback) usa título/autor:
// se recalcula la próxima vez, así que no queda pegado a ese fallback para siempre.
const cache = new Map<string, string>();

/**
 * Identifica un libro entre dispositivos por el CONTENIDO de su archivo de
 * texto (tamaño + primeros bytes), no por título/autor. Dos dispositivos que
 * importan el mismo .txt obtienen la misma clave sin importar qué título le
 * pongas después: renombrar el libro ya no rompe el enlace con su progreso
 * sincronizado, que era el problema del esquema anterior.
 *
 * Si el archivo no se puede leer (p. ej. se está copiando todavía), cae en
 * título+autor como respaldo temporal; no se cachea ese resultado para volver
 * a intentar la huella real la próxima vez que se llame.
 */
export async function bookContentKey(book: {
  id: string;
  title: string;
  author?: string;
  txtUri: string | null;
}): Promise<string> {
  const cached = cache.get(book.id);
  if (cached) return cached;

  const data = book.txtUri ? await readChunk(book.txtUri) : null;
  if (!data) {
    return `t_${slug(book.title)}__${slug(book.author || '')}`;
  }
  const key = `c_${cyrb53(`${data.size}:${data.chunk}`)}`;
  cache.set(book.id, key);
  return key;
}
