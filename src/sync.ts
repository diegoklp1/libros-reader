// --- MOTOR DE SINCRONIZACIÓN AUDIO ↔ TEXTO ---
// Segmenta el texto en bloques (oraciones agrupadas) y construye una línea de
// tiempo que mapea "segundo de audio" -> "bloque de texto".
//
// Fuentes de tiempos, en orden de precisión:
//   1. Archivo de cues (.json / .srt / .vtt) provisto junto al libro.
//   2. Anclas de calibración manual que el usuario marca desde el lector.
//   3. Estimación proporcional por cantidad de caracteres (siempre disponible).
//
// Todo se reduce a "anclas" (posición en caracteres <-> segundo), y entre anclas
// se interpola linealmente. Así las tres fuentes usan el mismo algoritmo.

export interface Block {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  paragraph: number;
}

export interface Anchor {
  char: number; // offset en el texto normalizado
  time: number; // segundos
}

export interface Cue {
  start: number; // segundos
  text?: string;
  block?: number;
}

const TARGET_BLOCK_CHARS = 280; // tamaño ideal de un bloque resaltable
const MAX_BLOCK_CHARS = 700;

/** Divide un párrafo en oraciones sin usar lookbehind (compatible con Hermes). */
function splitSentences(p: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  while (i < p.length) {
    const c = p[i];
    if (c === '.' || c === '!' || c === '?' || c === '…') {
      let j = i + 1;
      // Absorbe comillas/paréntesis de cierre y signos repetidos (ej. "?!").
      while (j < p.length && '.!?…"\'”’)]»'.includes(p[j])) j++;
      if (j >= p.length || /\s/.test(p[j])) {
        const piece = p.slice(start, j).trim();
        if (piece) out.push(piece);
        start = j;
        i = j;
        continue;
      }
      i = j;
      continue;
    }
    i++;
  }
  const tail = p.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Convierte el texto crudo en bloques. Respeta los párrafos (líneas en blanco)
 * y agrupa oraciones hasta ~TARGET_BLOCK_CHARS.
 *
 * Devuelve también el texto normalizado: los `charStart` de cada bloque son
 * offsets dentro de ese string, y se reutilizan para alinear cues y anclas.
 */
export function segmentBlocks(rawText: string): { blocks: Block[]; normalized: string } {
  const paragraphs = rawText
    .replace(/\r\n?/g, '\n')
    .split(/\n[ \t]*\n+/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length > 0);

  const blocks: Block[] = [];
  let normalized = '';

  paragraphs.forEach((paragraph, pIdx) => {
    if (pIdx > 0) normalized += '\n\n';

    const sentences = splitSentences(paragraph);
    const grouped: string[] = [];
    let current = '';

    for (const sentence of sentences) {
      if (sentence.length > MAX_BLOCK_CHARS) {
        // Oración enorme (texto sin puntuación): la partimos por palabras.
        if (current) { grouped.push(current); current = ''; }
        const words = sentence.split(' ');
        let chunk = '';
        for (const w of words) {
          if (chunk && (chunk.length + 1 + w.length) > TARGET_BLOCK_CHARS) {
            grouped.push(chunk);
            chunk = w;
          } else {
            chunk = chunk ? `${chunk} ${w}` : w;
          }
        }
        if (chunk) grouped.push(chunk);
        continue;
      }
      if (!current) {
        current = sentence;
      } else if (current.length + 1 + sentence.length <= TARGET_BLOCK_CHARS) {
        current = `${current} ${sentence}`;
      } else {
        grouped.push(current);
        current = sentence;
      }
    }
    if (current) grouped.push(current);

    grouped.forEach((text, i) => {
      if (i > 0) normalized += ' ';
      const charStart = normalized.length;
      normalized += text;
      blocks.push({
        index: blocks.length,
        text,
        charStart,
        charEnd: normalized.length,
        paragraph: pIdx,
      });
    });
  });

  return { blocks, normalized };
}

/** Acepta segundos numéricos o "hh:mm:ss,mmm" / "mm:ss.mmm". */
function parseTimeValue(value: unknown): number | null {
  if (typeof value === 'number' && isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const h = m[1] ? parseInt(m[1], 10) : 0;
  const min = parseInt(m[2], 10);
  const sec = parseInt(m[3], 10);
  const ms = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0;
  return h * 3600 + min * 60 + sec + ms / 1000;
}

function parseSrtOrVtt(content: string): Cue[] {
  const cues: Cue[] = [];
  const normalized = content.replace(/\r\n?/g, '\n');
  const arrow = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}[.,]\d{1,3}|\d{1,2}:\d{2}:\d{2})\s*-->\s*(\S+)/;

  for (const chunk of normalized.split(/\n\s*\n/)) {
    const lines = chunk.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const timeLineIdx = lines.findIndex((l) => arrow.test(l));
    if (timeLineIdx === -1) continue;
    const match = arrow.exec(lines[timeLineIdx]);
    if (!match) continue;
    const start = parseTimeValue(match[1]);
    if (start === null) continue;
    const text = lines.slice(timeLineIdx + 1).join(' ').trim();
    if (text) cues.push({ start, text });
  }
  return cues;
}

function parseJsonCues(content: string): Cue[] {
  const data = JSON.parse(content);
  const rawList: any[] = Array.isArray(data) ? data : Array.isArray(data?.cues) ? data.cues : [];
  const cues: Cue[] = [];
  for (const item of rawList) {
    if (!item || typeof item !== 'object') continue;
    const start = parseTimeValue(item.start ?? item.time ?? item.begin);
    if (start === null) continue;
    const cue: Cue = { start };
    if (typeof item.block === 'number') cue.block = item.block;
    if (typeof item.text === 'string') cue.text = item.text;
    cues.push(cue);
  }
  return cues;
}

/** Parsea un archivo de tiempos (.json, .srt o .vtt). Devuelve [] si no se pudo. */
export function parseCues(content: string, filename = ''): Cue[] {
  const lower = filename.toLowerCase();
  try {
    if (lower.endsWith('.json')) return parseJsonCues(content);
    if (lower.endsWith('.srt') || lower.endsWith('.vtt')) return parseSrtOrVtt(content);
    // Sin extensión conocida: intentamos JSON y si falla, SRT/VTT.
    const trimmed = content.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) return parseJsonCues(content);
    return parseSrtOrVtt(content);
  } catch {
    return [];
  }
}

const WORD_RE = /[\p{L}\p{N}]+/gu;

/**
 * Quita tildes/diacríticos SIN alterar la longitud del string, para que los
 * índices sigan alineados con el texto original. Se usa solo para comparar
 * (ej. un .srt transcripto puede escribir "manana" en lugar de "mañana").
 */
function foldDiacritics(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
    out += base.length === 1 ? base : ch; // conserva 1 char por posición
  }
  return out;
}

/**
 * Convierte cues en anclas ubicando el texto de cada cue dentro del texto
 * normalizado. La búsqueda es tolerante a diferencias de puntuación (útil
 * cuando el .srt viene de una transcripción automática tipo Whisper).
 */
export function cuesToAnchors(cues: Cue[], normalized: string, blocks: Block[]): Anchor[] {
  const anchors: Anchor[] = [];
  const haystack = foldDiacritics(normalized.toLowerCase());
  let cursor = 0;

  for (const cue of cues) {
    // Caso exacto: el cue referencia el índice de bloque directamente.
    if (typeof cue.block === 'number') {
      const b = blocks[cue.block];
      if (b) anchors.push({ char: b.charStart, time: cue.start });
      continue;
    }
    if (!cue.text) continue;

    const words = (foldDiacritics(cue.text.toLowerCase()).match(WORD_RE) || []).slice(0, 6);
    if (words.length < 2) continue;

    // Permite cualquier separador (espacios/puntuación) entre palabras.
    const pattern = words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+');
    let re: RegExp;
    try {
      re = new RegExp(pattern, 'gu');
    } catch {
      continue;
    }
    re.lastIndex = cursor;
    const found = re.exec(haystack);
    if (found) {
      anchors.push({ char: found.index, time: cue.start });
      cursor = found.index + 1;
    }
  }
  return anchors;
}

/** Deja las anclas ordenadas y estrictamente crecientes en char y time. */
function sanitizeAnchors(anchors: Anchor[], totalChars: number, duration: number): Anchor[] {
  const sorted = [...anchors]
    .filter((a) => a.char >= 0 && a.char <= totalChars && a.time >= 0 && isFinite(a.time))
    .sort((a, b) => a.char - b.char || a.time - b.time);

  const points: Anchor[] = [{ char: 0, time: 0 }];
  for (const a of sorted) {
    const last = points[points.length - 1];
    if (a.char <= last.char || a.time <= last.time) continue; // descarta no monótonas
    if (duration > 0 && a.time >= duration) continue;
    points.push(a);
  }
  if (duration > 0) {
    const last = points[points.length - 1];
    if (totalChars > last.char && duration > last.time) {
      points.push({ char: totalChars, time: duration });
    }
  }
  return points;
}

/**
 * Devuelve el segundo de inicio estimado de cada bloque.
 * Sin anclas ni cues, equivale a un reparto proporcional por caracteres.
 */
export function buildTimeline(blocks: Block[], anchors: Anchor[], duration: number): number[] {
  if (blocks.length === 0) return [];
  const totalChars = blocks[blocks.length - 1].charEnd;
  const points = sanitizeAnchors(anchors, totalChars, duration);

  if (points.length < 2) {
    // Solo tenemos (0,0): sin duración no podemos estimar nada.
    return blocks.map(() => 0);
  }

  const timeline: number[] = [];
  let seg = 0;
  for (const b of blocks) {
    while (seg < points.length - 2 && b.charStart > points[seg + 1].char) seg++;
    const a = points[seg];
    const c = points[seg + 1];
    const span = c.char - a.char;
    const ratio = span > 0 ? (b.charStart - a.char) / span : 0;
    timeline.push(a.time + Math.max(0, Math.min(1, ratio)) * (c.time - a.time));
  }
  return timeline;
}

/** Índice del bloque que corresponde al segundo `t` (búsqueda binaria). */
export function blockAtTime(timeline: number[], t: number): number {
  if (timeline.length === 0) return -1;
  let lo = 0;
  let hi = timeline.length - 1;
  let result = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (timeline[mid] <= t) {
      result = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}
