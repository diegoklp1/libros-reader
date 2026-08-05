"""Extrae el texto de un PDF que ya viene en texto plano.

Para PDFs cuya fuente SI trae mapa a Unicode, que es el caso normal. Si el texto
sale como simbolos ('VDOYDQGR' en vez de 'salvando'), este script no sirve: hace
falta `extraer_pdf.py`, que reconstruye la tabla de glifos.

Lo unico que hace, mas alla de extraer, es sacar el "mobiliario de pagina":
encabezados, pies y folios que se repiten en casi todas las paginas. No van por
`reglas.json` porque son cientos de variantes ('Pagina 1 de 184', 'Pagina 2 de
184', ...) y las anclas de texto son literales.

Uso:
    python tools/extraer_pdf_plano.py <archivo.pdf> <carpeta_CHUNKS>
"""

import argparse
import re
import sys
from collections import Counter
from pathlib import Path

# Una linea es mobiliario si aparece en al menos esta fraccion de las paginas.
UMBRAL_MOBILIARIO = 0.6
# Solo se descartan lineas cortas: un parrafo repetido es contenido, no un pie.
MAX_CHARS_MOBILIARIO = 120


def firma(linea: str) -> str:
    """Normaliza los digitos para que 'Pagina 3 de 184' y 'Pagina 4 de 184' sean lo mismo."""
    return re.sub(r'\d+', '#', ' '.join(linea.split()))


# Un folio o titulillo vive en el margen. Fraccion de alto de pagina que se
# considera margen, arriba y abajo.
MARGEN = 0.10
# Repeticiones a partir de las cuales una linea de margen es mobiliario.
MIN_REPETICIONES_FOLIO = 15


def es_folio(s: str) -> bool:
    """
    Reconoce folios y titulillos: '30 I LEY N° 1', 'LEY N° 2 I 39'.

    Recibe la FIRMA, no la linea: los digitos ya vienen como '#'.

    Se piden numero Y letras para no confundirlos con los items de una lista
    numerada ('1.', '2.'), que no llevan letras en la firma y son contenido.
    """
    return (len(s) <= 40
            and '#' in s
            and sum(c.isalpha() for c in s) >= 3)


def detectar_mobiliario(paginas: list[list[tuple[str, float]]]) -> set[str]:
    """
    `paginas` trae, por pagina, las lineas con su posicion vertical relativa.

    Se combinan dos criterios. El primero, por repeticion pura, agarra los
    encabezados y pies fijos. El segundo agarra los folios, que no llegan al
    umbral general porque el titulillo cambia por seccion; ahi se exige ademas
    que la linea este SIEMPRE en el margen.

    Sin la condicion de margen este segundo criterio se lleva por delante los
    encabezados de capitulo: en LIBRO9, 'DIA 1' ... 'DIA 160' comparten la firma
    'DIA #' y se repiten 160 veces, pero son contenido y van en el cuerpo.
    """
    veces = Counter()
    en_margen = Counter()
    for lineas in paginas:
        vistas = {firma(t) for t, _ in lineas if t.strip()}
        veces.update(vistas)
        # una firma cuenta como "de margen" en esta pagina solo si todas sus
        # apariciones aca estan en el margen
        centro = {firma(t) for t, y in lineas if t.strip() and MARGEN < y < 1 - MARGEN}
        en_margen.update(vistas - centro)

    minimo = max(2, int(len(paginas) * UMBRAL_MOBILIARIO))
    mobiliario = {s for s, n in veces.items()
                  if n >= minimo and len(s) <= MAX_CHARS_MOBILIARIO}
    mobiliario |= {s for s, n in veces.items()
                   if n >= MIN_REPETICIONES_FOLIO and es_folio(s)
                   and en_margen[s] == n}
    return mobiliario


def texto_del_pdf(ruta: Path) -> tuple[str, set[str]]:
    import fitz

    doc = fitz.open(ruta)

    # Se lee con geometria para saber que lineas caen en el margen.
    paginas = []
    for pagina in doc:
        alto = pagina.rect.height or 1
        lineas = []
        for bloque in pagina.get_text('dict')['blocks']:
            for linea in bloque.get('lines', []):
                texto = ''.join(t['text'] for t in linea['spans'])
                y = (linea['bbox'][1] + linea['bbox'][3]) / 2 / alto
                lineas.append((texto, y))
        paginas.append(lineas)

    mobiliario = detectar_mobiliario(paginas)

    limpias = []
    for lineas in paginas:
        utiles = [t for t, _ in lineas
                  if t.strip() and firma(t) not in mobiliario]
        if utiles:
            limpias.append('\n'.join(utiles))

    # Una oracion puede seguir de una pagina a la otra: solo se abre parrafo
    # cuando la anterior cerro con puntuacion de fin de oracion.
    texto = ''
    for pagina in limpias:
        pagina = pagina.strip()
        if not texto:
            texto = pagina
        elif texto.rstrip().endswith(('.', '!', '?', '"', '»', ':')):
            texto += '\n\n' + pagina
        else:
            texto += '\n' + pagina
    return texto, mobiliario


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf', type=Path)
    ap.add_argument('salida', type=Path, help='carpeta donde escribir los CHUNK_N.txt')
    ap.add_argument('--por-chunk', type=int, default=3000)
    args = ap.parse_args()

    texto, mobiliario = texto_del_pdf(args.pdf)
    print(f'mobiliario de pagina descartado ({len(mobiliario)} lineas):')
    for s in sorted(mobiliario):
        print(f'  - {s[:80]!r}')

    # Los llamados a nota al pie quedan pegados a la palabra ('publicacion1'),
    # y el TTS los lee: "publicacion uno". Se sacan token por token para no
    # tocar las URLs, donde los digitos pegados son parte de la direccion
    # ('.../olympics/summer08/...').
    marcador = re.compile(r'^([a-záéíóúñü]{4,})([1-9]\d?)([.,;:)]?)$')
    quitados = 0
    piezas = []
    es_url = re.compile(r'/|www\.|@')
    for token in re.split(r'(\s+)', texto):
        if not es_url.search(token):
            nuevo, n = marcador.subn(r'\1\3', token)
            quitados += n
            token = nuevo
        piezas.append(token)
    texto = ''.join(piezas)
    print(f'llamados a nota al pie despegados: {quitados}')

    # El PDF corta palabras con guion al final del renglon ('fundamen-\ntalmente').
    # Se unen aca y no en procesar_libro.py para que los chunks ya queden con las
    # palabras enteras: si no, la salida deja de ser subsecuencia de su entrada y
    # verificar_fidelidad.py marca un fallo que en realidad es una mejora.
    unidas = len(re.findall(r'(\w)-\s*\n\s*(\w)', texto))
    texto = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', texto)
    print(f'palabras reunidas tras corte con guion: {unidas}')

    texto = re.sub(r'[ \t]{2,}', ' ', texto)
    texto = re.sub(r'\n{3,}', '\n\n', texto).strip()

    bloques = []
    for bloque in texto.split('\n\n'):
        if not bloque.strip():
            continue
        # Algunos PDFs traen paginas enteras sin corte de parrafo, y un bloque
        # solo puede pesar cientos de miles de chars. Se parte en limite de
        # oracion para que los chunks queden parejos.
        while len(bloque) > args.por_chunk:
            corte = bloque.rfind('. ', 0, args.por_chunk)
            if corte <= 0:
                break
            bloques.append(bloque[:corte + 1])
            bloque = bloque[corte + 2:]
        bloques.append(bloque)

    chunks, actual = [], ''
    for bloque in bloques:
        if actual and len(actual) + len(bloque) > args.por_chunk:
            chunks.append(actual)
            actual = ''
        actual = f'{actual}\n\n{bloque}'.strip()
    if actual:
        chunks.append(actual)

    args.salida.mkdir(parents=True, exist_ok=True)
    for viejo in args.salida.glob('CHUNK_*.txt'):
        viejo.unlink()
    for i, trozo in enumerate(chunks, 1):
        (args.salida / f'CHUNK_{i}.txt').write_text(trozo + '\n', encoding='utf-8')

    print(f'\n{len(texto)} chars -> {len(chunks)} chunks en {args.salida}')
    print(f'puntuacion: {1000 * texto.count(".") / max(len(texto), 1):.1f} puntos/1000 chars')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
