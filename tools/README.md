# Cómo preparar un libro nuevo (runbook)

Pipeline para convertir los chunks crudos de un PDF en los tres archivos que
consume la app: **texto limpio**, **audiolibro** y **archivo de tiempos**.

> 📁 **Ubicación de los libros.** Cada libro vive en `LIBROS/<NOMBRE>/` (p. ej.
> `LIBROS/DE LA BREVEDAD DE LA VIDA/`), con su PDF, `CHUNKS/`, `CHUNKS_PDF/`,
> `SALIDA/`, `reglas.json` y la portada adentro. En este runbook se escribe
> `LIBROn/` como abreviatura para que los ejemplos entren en una línea, pero la
> ruta real es la de `LIBROS/<NOMBRE>/`. (Antes cada libro era una carpeta suelta
> `LIBRO1`…`LIBRO9` en la raíz; el usuario las movió a `LIBROS/`.)

```
PDF original  ──extraer_pdf_plano.py (o extraer_pdf.py)──→  LIBROn/CHUNKS_PDF/CHUNK_N.txt
   (o los CHUNK_N.txt que salen de n8n, si pasan el Paso 1b)
        │
        ├─ procesar_libro.py --reglas LIBROn/reglas.json
        │       └─→ LIBROn/SALIDA/LIBRO.txt  +  SALIDA/PARTES/PARTE_NNN.txt
        │
        └─ generar_audio.py
                └─→ LIBROn/SALIDA/AUDIOLIBRO.mp3  +  AUDIOLIBRO.srt
```

> **Si sos una IA retomando esto: leé primero la sección "Paso 2", que es el
> único paso que NO se puede automatizar a ciegas.** El resto es mecánico.

> ⚠️ **Antes que nada, verificá la calidad de los chunks (Paso 1b).** En LIBRO2
> los chunks de n8n venían tan degradados que no había limpieza que los
> salvara: hubo que volver al PDF.

---

## Paso 0 — Entorno (ya instalado en esta máquina)

| Herramienta | Estado | Nota |
|---|---|---|
| `edge-tts` | instalado | TTS online gratis de Microsoft |
| `ffmpeg` | instalado, **NO está en el PATH** | `C:\Users\Diego\Downloads\MEDIA_Y_AUDIO\FFMPEG_8_1_ESSENTIALS\bin\ffmpeg.exe` |
| `python` | 3.10 | |
| `kokoro` + `torch` (CPU) | instalado | TTS local alternativo, no se usa en el pipeline actual |
| GPU | **no hay** (Radeon integrada) | descarta XTTS-v2, F5-TTS y similares |

`generar_audio.py` **no necesita ffmpeg**: mide la duración parseando los frames
MPEG. ffmpeg solo hace falta para experimentar con muestras.

---

## Paso 1 — Ubicar los chunks

Cada libro va en su carpeta con los `CHUNK_N.txt` que salen del flujo de n8n
(extracción del PDF):

```
LIBRO2/
  CHUNKS/
    CHUNK_1.txt … CHUNK_37.txt
```

---

## Paso 1b — Comprobar que los chunks sirven ⚠️ HACELO SIEMPRE

Los chunks de n8n pueden llegar rotos de formas que la limpieza NO arregla.
Tres chequeos rápidos, comparando contra un libro sano (LIBRO1):

```bash
python - <<'EOF'
import glob, re, sys, collections
sys.stdout.reconfigure(encoding='utf-8')
fs = sorted(glob.glob('LIBRO2/CHUNKS/CHUNK_*.txt'),
            key=lambda f: int(re.findall(r'\d+', f)[0]))
t = ''.join(open(f, encoding='utf-8').read() + '\n' for f in fs)

# 1. puntuacion: LIBRO1 ronda 19,8 puntos y 12 comas por cada 1000 chars
print('puntos/1000:', round(1000*t.count('.')/len(t), 1),
      '| comas/1000:', round(1000*t.count(',')/len(t), 1))

# 2. texto sin descifrar: mayusculas donde deberia haber minusculas
raro = [w for w in re.findall(r'\S+', t)
        if len(w) > 3 and sum(c.isupper() for c in w) > len(w)*0.6]
print('tokens sospechosos:', len(raro), raro[:5])

# 3. duplicacion y relleno: ventanas de 14 palabras repetidas
pal = ' '.join(t.split()).split(' ')
vis = collections.Counter(' '.join(pal[i:i+14]) for i in range(len(pal)-14))
rep = sum(v for v in vis.values() if v > 1)
print(f'ventanas repetidas: {rep} de {len(pal)} ({100*rep/len(pal):.1f}%)')
EOF
```

Si la puntuación está muy por debajo de la referencia, si hay tokens sin
descifrar o si la duplicación pasa del 1 %, **no sigas con estos chunks**:
volvé al PDF con `extraer_pdf.py` (abajo).

### Extraer del PDF cuando el texto sale plano (caso normal)

```bash
python tools/extraer_pdf_plano.py "ruta/al/LIBRO.pdf" LIBROn/CHUNKS_PDF
```

Hace tres cosas además de extraer:

- **Saca el mobiliario de página**: encabezados, pies y folios. No pueden ir en
  `reglas.json` porque `"Página 1 de 184"` tiene una variante por página y las
  anclas son literales. Hay dos criterios:
  1. la línea se repite en ≥60 % de las páginas (encabezados y pies fijos);
  2. la firma es un folio (`"# I LEY N° #"`), se repite en ≥15 páginas **y cae
     siempre en el margen** (10 % superior o inferior de la página).

  La condición de margen no es opcional. Sin ella, el criterio 2 se lleva
  puestos los encabezados de capítulo: en LIBRO9 `DIA 1` … `DIA 160` comparten
  la firma `DIA #` y se repiten 160 veces, pero son contenido. En LIBRO6 los
  folios (`30 I LEY N° 1`) van incrustados a mitad de frase y sin sacarlos el
  TTS lee *"…ser opacado por su treinta I ley número uno ministro de Finanzas"*.

  El script imprime lo que descartó — **revisalo siempre**, y comprobá que los
  encabezados de capítulo siguen en el texto.
- **Despega los llamados a nota al pie** que quedan pegados a la palabra
  (`publicación1`, `desea10`). Sin esto el TTS lee *"publicación uno"*. Saltea
  los tokens que parecen URL, donde los dígitos pegados son parte de la
  dirección (`.../olympics/summer08/...`).
- **Reúne las palabras cortadas con guion** al final del renglón
  (`fundamen-\ntalmente`). Se hace acá y no en `procesar_libro.py` para que los
  chunks ya queden con las palabras enteras: si no, la salida deja de ser
  subsecuencia de su entrada y `verificar_fidelidad.py` marca un fallo que en
  realidad es una mejora.
- **Pega las oraciones cortadas entre páginas**, igual que `extraer_pdf.py`.

### Extraer del PDF cuando la fuente no trae mapa a Unicode

Es lo que pasó con LIBRO2. El PDF usa una fuente embebida sin `ToUnicode` y con
nombres de glifo opacos (`G03`), así que **ningún extractor da texto legible**:

| Extractor | Resultado |
|---|---|
| `pdftotext` / n8n | texto desplazado +29 (`VDOYDQGR` → `salvando`) y **tira la puntuación**, que en esta fuente son caracteres de control |
| PyMuPDF | conserva todo, puntuación incluida, pero devuelve los códigos crudos del content stream |

`tools/extraer_pdf.py` lee con PyMuPDF y traduce con una tabla de glifos
(`TABLA_GLIFOS`) derivada alineando ambas salidas: son el mismo texto, así que
cada código se resuelve por votación palabra a palabra.

```bash
python tools/extraer_pdf.py "ruta/al/LIBRO.pdf" LIBRO2/CHUNKS_PDF
```

**La tabla es por PDF.** Si aparece otro libro con este problema, hay que
derivarla de nuevo (el procedimiento está documentado en el docstring del
script). Señal de que la tabla está incompleta: letras que faltan en la salida
(`igura` en vez de `Figura`).

Qué se ganó en LIBRO2 al volver al PDF:

| | chunks n8n | desde el PDF |
|---|---|---|
| Puntos/1000 chars | 2,6 | **5,6** |
| Oraciones | 263 | **583** |
| Oración más larga | 4.064 chars | **739** |
| Párrafos cortados a mitad de frase | 32 de 90 | **1 de 138** |
| Pasajes duplicados | 7 % | **0 %** |
| Relleno generado que no es del autor | 9.700 chars | **0** |

---

## Paso 2 — Escribir las reglas de limpieza ⚠️ ESTE PASO ES POR LIBRO

**El ruido editorial cambia en cada libro.** No hay reglas genéricas: promos,
avisos de piratería, redes sociales y datos de contacto están redactados
distinto en cada obra. Si corrés el script sin `--reglas`, avisa y **no elimina
nada**.

### 2.1 Analizar el ruido antes de escribir reglas

```bash
python - <<'EOF'
import glob, re, sys
sys.stdout.reconfigure(encoding='utf-8')
fs = sorted(glob.glob('LIBRO2/CHUNKS/CHUNK_*.txt'),
            key=lambda f: int(re.findall(r'\d+', f)[0]))
full = ''.join(open(f, encoding='utf-8').read() + '\n' for f in fs)
print('chars:', len(full))
# 1. dónde está el ruido típico
for k in ['Instagram','@','Amazon','reseña','pirat','edición','Kindle','PDF',
          'www','http','correo','comunidad','suscr','WhatsApp','Telegram','QR']:
    pos = [m.start() for m in re.finditer(k, full, re.I)]
    if pos: print(f'{k:<14} x{len(pos):<3} {pos[:10]}')
# 2. estructura (títulos, partes, capítulos)
for m in re.finditer(r'\b[A-ZÁÉÍÓÚÑ]{4,}(?:\s+[A-ZÁÉÍÓÚÑ]{2,}){0,4}\b', full):
    print(m.start(), m.group(0))
EOF
```

Después mirá el contexto de cada cluster (`full[inicio:fin]`) para encontrar la
frase exacta donde **empieza** y donde **termina** cada bloque de ruido.

### 2.2 Escribir `LIBROn/reglas.json`

```json
{
  "quitar": [
    {
      "etiqueta": "antipirateria / promo edicion fisica",
      "desde": "Gracias por estar aquí. Si estás leyendo Carpe Diem",
      "hasta": "continúe en Carpe Diem."
    },
    {
      "etiqueta": "cierre comercial + contacto",
      "desde": "Este proyecto nació para acompañarte en lo real",
      "hasta": null
    }
  ],
  "reemplazar": [
    { "de": "Para soltar CONCLUSIÓN", "por": "CONCLUSIÓN" }
  ]
}
```

- `desde` / `hasta`: **texto literal**, se borra el tramo incluyendo ambos extremos.
- `hasta: null` → borra desde `desde` hasta el final del documento.
- `hasta_ultima: true` → engancha la **última** aparición de `hasta`. Hace falta
  cuando el tramo a sacar repite la misma frase varias veces.
- Si un ancla no aparece, el script **avisa y no borra** (nunca recorta de más en silencio).

Además hay dos claves fuera de `quitar` / `reemplazar`:

- `"excluir_chunks": [1, 16]` → saca chunks enteros por número. Para cuando un
  chunk no es parte de la obra y las anclas de texto no aplican.
- `"deduplicar": true` → elimina párrafos repetidos, conservando el primero.
  Va por libro y no por defecto, porque en otro libro una repetición puede ser
  deliberada.

> ⚠️ No uses `reemplazar` para arreglos cosméticos: cualquier cambio que no sea
> un borrado rompe la garantía de `verificar_fidelidad.py`.

**Criterio editorial usado hasta ahora:** se conserva todo lo que escribió el
autor (poemas, introducción, conclusión) y se elimina lo comercial (promos de
otras ediciones, redes, pedidos de reseña, avisos de piratería, contacto).

Ver ejemplo real completo en [`LIBRO1/reglas.json`](../LIBRO1/reglas.json).

---

## Paso 3 — Generar el TXT

```bash
python tools/procesar_libro.py LIBRO2/CHUNKS LIBRO2/SALIDA --reglas LIBRO2/reglas.json
```

Qué hace:

1. **Une** los `CHUNK_N.txt` en orden numérico real (1, 2, …, 10; no alfabético).
   Si un chunk arranca en minúscula es que continúa la frase del anterior, así
   que lo pega con un espacio en vez de abrir párrafo: los cortes entre chunks
   no respetan las oraciones. En LIBRO3 esto bajó los párrafos cortados a mitad
   de frase de 24 a 4.
2. **Repara** la extracción: palabras cortadas por guion (`diccio-\nnario`),
   comillas tipográficas, espacios duros, espacio antes de puntuación.
3. **Elimina el ruido** según `reglas.json`.
4. **Reconstruye los párrafos**: el PDF suele dejar bloques corridos de decenas
   de miles de caracteres. Reagrupa por oraciones (~520 chars) cortando siempre
   en límite de oración, con dos reglas propias del género:
   - los **puntos suspensivos solo cortan oración si lo que sigue empieza en
     mayúscula** (si no, parten frases al medio);
   - se fuerza corte al **abrir una cita** o al **cerrar una atribución** de autor.
5. **Divide en PARTES** (~3500 chars) sin partir nunca un párrafo.

### Verificar antes de seguir

```bash
python tools/verificar_fidelidad.py LIBRO2/CHUNKS LIBRO2/SALIDA/LIBRO.txt
```

Confirma que la salida es **subsecuencia exacta** del original: el pipeline solo
borra, nunca reescribe ni parafrasea. Si esto falla, **frená**: algo está
alterando el texto del autor.

Revisá también que no queden párrafos cortados a la mitad:

```bash
python -c "
t=open('LIBRO2/SALIDA/LIBRO.txt',encoding='utf-8').read()
ps=[p.strip() for p in t.split('\n\n') if p.strip()]
malos=[p for p in ps if p and p[0].islower()]
print('parrafos:',len(ps),'| cortados a mitad de frase:',len(malos))
"
```

Debe dar **0 cortados**.

---

## Paso 4 — Generar audio y SRT

```bash
python tools/generar_audio.py LIBRO2/SALIDA
```

Voz por defecto: **`es-MX-JorgeNeural`** (elegida tras comparar las 22 voces
masculinas en español de edge-tts). Se cambia con `--voz`.

Por cada parte llama a `edge-tts` pidiendo audio **y subtítulos**. Los subtítulos
traen los tiempos **reales de la síntesis** (una entrada por oración): no hace
falta transcribir con Whisper ni estimar por longitud de texto. Al final une los
MP3 y arma un único `.srt` desplazando los tiempos de cada parte por la duración
acumulada, medida **parseando los frames MPEG** (sin ffmpeg).

- **Es reanudable**: si una parte ya tiene `.mp3` y `.srt`, se saltea.
- Reintenta 3 veces por parte ante fallos de red.
- Rendimiento: ~30 s por parte; un libro de ~96 min tarda ~12 min.

> ⚠️ Si cambiás el TXT y regenerás las PARTES, **borrá `SALIDA/AUDIO/` antes de
> re-lanzar**, porque el script saltea por nombre de archivo y mezclaría audio
> viejo con texto nuevo.

> ⚠️ Los flags de edge-tts con valores negativos necesitan `=`:
> `--rate=-8%` funciona, `--rate -8%` falla (argparse lo toma como opción).

### Verificar el resultado

```bash
python - <<'EOF'
import sys; sys.path.insert(0, 'tools')
from generar_audio import duracion_mp3, leer_srt
import re, unicodedata
d = duracion_mp3('LIBRO2/SALIDA/AUDIOLIBRO.mp3')
c = leer_srt('LIBRO2/SALIDA/AUDIOLIBRO.srt')
txt = open('LIBRO2/SALIDA/LIBRO.txt', encoding='utf-8').read()
pal = lambda s: re.findall(r'[a-záéíóúñü0-9]+',
                           unicodedata.normalize('NFC', s).lower())
print(f'audio {int(d//60)}:{int(d%60):02d} | cues {len(c)}')
print('monotonos     :', all(c[i][0] >= c[i-1][0] for i in range(1, len(c))))
print('dentro audio  :', c[-1][1] <= d + 1)
print('huecos >30s   :', sum(1 for i in range(1, len(c)) if c[i][0]-c[i-1][1] > 30))
print(f'cobertura     : {100*sum(len(pal(x[2])) for x in c)/len(pal(txt)):.1f}%')
EOF
```

Valores esperados: monótonos `True`, dentro del audio `True`, huecos `0`,
cobertura **~100%** (los cues cubren todo el texto).

---

## Paso 5 — Cargar en la app

Al agregar el libro, seleccionar:

| Campo en la app | Archivo |
|---|---|
| Texto | `SALIDA/LIBRO.txt` |
| Audio | `SALIDA/AUDIOLIBRO.mp3` |
| Tiempos (opcional) | `SALIDA/AUDIOLIBRO.srt` |

Como el `.srt` sale del mismo TTS que generó el audio, la sincronización es
exacta y **no necesita calibración manual**. Ver
[`docs/SINCRONIZACION.md`](../docs/SINCRONIZACION.md).

---

## Resultado de referencia (LIBRO1 — Carpe Diem)

| Métrica | Valor |
|---|---|
| Entrada | 89.730 chars (28 chunks) |
| Salida limpia | 84.695 chars — se quitaron 5.035 (907 palabras de ruido) |
| Párrafos | 174 (mediana 533 chars), 0 cortados a mitad de frase |
| Audio | 96:10 min, 34,6 MB |
| Cues | 1.356, cobertura 100 % |
| Concatenación | 0,0000 s de error |
| Sync en la app | 429 bloques, 98 % de cues resueltos como anclas |

## Resultado de referencia (LIBRO2 — De la brevedad de la vida)

Extraído del PDF con `extraer_pdf.py`; los chunks de n8n se descartaron (ver Paso 1b).

| Métrica | Valor |
|---|---|
| Entrada | 84.123 chars (10 chunks desde el PDF) |
| Salida limpia | 84.123 chars — **0 de ruido**: el PDF no trae material comercial |
| Párrafos | 138 (mediana 600 chars), 1 cortado a mitad de frase |
| Fidelidad | subsecuencia exacta, 0 palabras inventadas |
| Audio | 88:37 min, 31,9 MB |
| Cues | 562, cobertura 100 % |
| Huecos > 30 s | 0 |

Que `reglas.json` quede vacío es el resultado esperado cuando se extrae del PDF:
el ruido editorial que había que quitar en LIBRO1 (promos, redes, antipiratería)
no existe en esta edición, y el relleno y los duplicados que traían los chunks
los había inyectado n8n.

## Resultado de referencia (LIBRO3 — El hombre en busca de sentido)

Acá los chunks de n8n **sí sirvieron**: pasaron el Paso 1b (0 % duplicación,
0 caracteres de control, completos y en orden contra el PDF).

| Métrica | Valor |
|---|---|
| Entrada | 261.069 chars (69 chunks, 2 excluidos) |
| Salida limpia | 253.428 chars — se quitaron 7.641 (créditos, índice, bibliografía) |
| Párrafos | 497 (mediana 570 chars), 4 cortados a mitad de frase |
| Fidelidad | subsecuencia exacta, 0 palabras inventadas |
| Audio | 261:56 min, 94,3 MB |
| Cues | 1.860, cobertura 100 % |

⚠️ **Los chunks traen ~30 palabras corrompidas** respecto del PDF (`tocaba` →
`tocía`, `se aferró` → `se afectó`, `barracón` → `barbacán`) y les faltan ~336
palabras. Es el 0,07 % del texto y algunas cambian el sentido. Pasaron por una
herramienta que a la vez corrigió erratas del OCR (`psycbology` → `psychology`)
e introdujo otras. Si hace falta el texto exacto, reextraer del PDF: éste sale
en texto plano, sin el problema de fuente de LIBRO2.

### Cómo detectar palabras corrompidas en los chunks

El Paso 1b no las ve (son texto válido). Hay que diferenciar contra el PDF:

```bash
python - <<'EOF'
import sys, fitz, glob, re, os, difflib
sys.stdout.reconfigure(encoding='utf-8')
num = lambda f: int(re.findall(r'\d+', os.path.basename(f))[0])   # OJO: basename
d = fitz.open('LIBRO3/HOMBRE EN BUSCA.pdf')
pdf = ' '.join((''.join(p.get_text() + '\n' for p in d)).split()).split(' ')
fs = sorted(glob.glob('LIBRO3/CHUNKS/CHUNK_*.txt'), key=num)
ch = ' '.join((''.join(open(f, encoding='utf-8').read() + '\n' for f in fs)).split()).split(' ')
for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(a=pdf, b=ch, autojunk=False).get_opcodes():
    if tag == 'replace' and (i2-i1) <= 3 and (j2-j1) <= 3:
        print(f'PDF {" ".join(pdf[i1:i2])!r:<30} -> CHUNKS {" ".join(ch[j1:j2])!r}')
EOF
```

> ⚠️ Ordená los chunks por el **basename**. `re.findall(r'\d+', ruta)[0]` toma el
> dígito de `LIBRO3/` y deja todo en orden alfabético: da un texto barajado que
> parece contenido faltante y desordenado. (`procesar_libro.py` lo hace bien;
> el error es fácil de cometer en los scripts sueltos de verificación.)

## Resultado de referencia (LIBRO4 y LIBRO5)

| | LIBRO4 — Ganar amigos | LIBRO5 — Los estoicos |
|---|---|---|
| Fuente | chunks de n8n | PDF (`extraer_pdf_plano.py`) |
| Entrada | 456.458 chars (92 chunks) | 514.706 chars (106 chunks) |
| Ruido quitado | 4.891 (contratapa, índice, cursos) | 8.434 (prólogo del sello) |
| Párrafos | 1.077 (mediana 520), 3 cortados | 863 (mediana 580), 3 cortados |
| Fidelidad | subsecuencia exacta | subsecuencia exacta |
| Audio | 490:31 min, 176,6 MB | 544:13 min, 195,9 MB |
| Cues | 4.632, cobertura 100 % | 3.940, cobertura 100 % |

> **LIBRO3 y LIBRO4 se rehicieron desde el PDF.** Los chunks de n8n estaban
> incompletos y con palabras cambiadas; el detalle está en cada `reglas.json`.
> Es el mismo patrón de LIBRO2: **cuando el PDF está disponible, es mejor fuente
> que los chunks**, aun cuando éstos pasen el Paso 1b.

## Resultado de referencia (LIBRO6 a LIBRO9)

Los cuatro extraídos del PDF con `extraer_pdf_plano.py`.

| | L6 · 48 Leyes | L7 · El Obstáculo | L8 · Hábitos Atómicos | L9 · Memento Mori |
|---|---|---|---|---|
| Entrada | 1.488.404 | 288.420 | 525.034 | 211.413 |
| Salida limpia | 1.430.471 (96 %) | 264.435 (92 %) | 430.325 (82 %) | 206.948 (98 %) |
| Párrafos | 2.696 | 525 | 825 | 453 |
| Fidelidad | exacta | exacta | exacta | exacta |
| Audio | 1536:56 min | 292:01 min | 460:04 min | 223:15 min |
| Cues | 11.398 (100 %) | 3.027 (100 %) | 4.092 (100 %) | 1.991 (99,8 %) |

Notas por libro:

- **L6** es un escaneo con OCR: el cuerpo sale bien, la portada trae erratas
  (`Traducoon`, `DOROTEA PLACK!N`), pero cae dentro del bloque legal que se
  elimina igual. Traía 239 folios incrustados a mitad de frase; quedan 9.
- **L7** trae el índice **al final**, después de la bibliografía y de varias
  promos de otros títulos. Todo eso sale en un solo tramo `hasta: null`.
- **L8** pierde 92.455 chars (18 %) en notas finales: son referencias y URLs,
  no texto de Clear.
- **L9** es del mismo sello que LIBRO1 y repite sus patrones comerciales
  (grupo de WhatsApp, pedidos de reseña, redes).

### Correr dos libros en paralelo

Baja el tiempo casi a la mitad y **suele** funcionar: LIBRO4 (140 partes) y
LIBRO5 (161) salieron sin un solo reintento. Pero no es gratis: con LIBRO6 (443
partes) en paralelo con LIBRO8, la parte 263 agotó los 3 reintentos y el script
cortó. Cuanto más largo el libro, más chances de encontrarse con un corte.

> ⚠️ **`generar_audio.py` termina con código 0 aunque falle.** Imprime
> `[X] FALLO en PARTE_NNN` y sale sin armar el `.mp3`. Un orquestador que mire
> solo el código de salida lo va a dar por bueno. **Verificá siempre que exista
> `SALIDA/AUDIOLIBRO.mp3`** antes de cantar victoria.

Recuperarse es barato: el script saltea las partes que ya tienen `.mp3` y `.srt`,
así que basta con volver a lanzarlo y sigue donde quedó.

---

## Alternativas de voz evaluadas

- **edge-tts** (actual): gratis, online, rápido. 22 voces masculinas en español.
- **Kokoro** (instalado, Apache 2.0): local, sin límites, **2,4-2,9x tiempo
  real en esta CPU**. Solo 3 voces nativas en español (`em_alex`, `em_santa`,
  `ef_dora`); se pueden usar embeddings de otros idiomas y mezclarlos, pero las
  voces inglesas arrastran las sílabas al forzar fonemas españoles.
  Script de muestras: `tools/muestras_kokoro.py`.
- **Descartados por hardware**: XTTS-v2, F5-TTS, Chatterbox (requieren GPU).
- **Piper**: muy rápido pero suena más robótico que edge-tts.

### Pendiente / mejora conocida

La **fluidez de las pausas** no depende de la voz: hoy se sintetiza por partes
de ~3500 chars y los cortes de párrafo quedan a criterio del motor. La mejora
sería sintetizar **por párrafo** e insertar silencio controlado (600-900 ms)
entre ellos, más `--rate=-8%`. No está implementado.
