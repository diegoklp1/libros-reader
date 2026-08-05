"""Extrae el texto de un PDF cuya fuente no trae mapa a Unicode.

El PDF de LIBRO2 ('DE LA BREVEDAD DE LA VIDA - Seneca.pdf') usa una fuente
embebida (MSTT31c4c900) sin ToUnicode y con nombres de glifo opacos ('G03'),
asi que ningun extractor devuelve texto legible:

  - pdftotext  -> texto desplazado +29 ('VDOYDQGR') y TIRA la puntuacion,
                  que en esta fuente son caracteres de control.
  - PyMuPDF    -> conserva TODO (puntuacion incluida) pero devuelve los codigos
                  crudos del content stream, en otro espacio de codigos.

De ahi que los chunks de n8n, que vienen de una extraccion tipo pdftotext,
hayan llegado sin puntuacion de oracion.

La tabla de abajo (TABLA_GLIFOS) traduce los codigos de PyMuPDF a caracteres.
Se derivo alineando la salida de PyMuPDF con la de pdftotext descifrada: son el
mismo texto, asi que cada codigo se resuelve por votacion palabra a palabra. La
puntuacion no aparece en pdftotext, asi que esos codigos se identificaron
leyendo su contexto una vez resueltas las letras.

Uso:
    python tools/extraer_pdf.py <archivo.pdf> <carpeta_CHUNKS>
"""

import argparse
import re
import sys
from pathlib import Path

FUENTE_CUERPO = 'MSTT31c4c900'

# Codigo del content stream -> caracter real.
TABLA_GLIFOS = {
    0x02: 'F', 0x03: 'i', 0x04: 'g', 0x05: 'u', 0x06: 'r', 0x07: 'a',
    0x08: 'd', 0x09: 'e', 0x0A: 'l', 0x0B: 'n', 0x0C: 't', 0x0D: 'ü',
    0x0E: 'G', 0x0F: 'c', 0x10: 'o', 0x11: 'm', 0x13: 'í', 0x14: 's',
    0x15: 'f', 0x16: 'x', 0x17: 'ó', 0x18: 'é', 0x19: 'p', 0x1A: 'h',
    0x1B: 'b', 0x1C: 'z', 0x1E: 'S', 0x1F: 'E', 0x21: 'y', 0x22: 'v',
    0x23: 'á', 0x27: 'q', 0x29: 'H', 0x2A: 'ú', 0x2B: 'ñ', 0x2C: 'I',
    0x2D: 'R', 0x2E: 'N', 0x2F: 'L', 0x30: 'O', 0x31: 'A', 0x32: 'V',
    0x33: 'J', 0x34: 'P', 0x35: 'D', 0x36: 'C', 0x37: 'Q', 0x3C: 'T',
    0x3D: 'M', 0x43: 'X', 0x45: 'Y', 0x46: 'U', 0x52: 'É', 0x53: 'l',
    0x54: 'Z', 0x55: 'Á', 0x4C: '(', 0x4D: ')',
    # digitos: solo salen en las fechas del prologo y en los numeros de seccion
    0x38: '1', 0x39: '9', 0x3B: '9', 0x3F: '4', 0x40: '5', 0x41: '0',
    0x4E: '6', 0x4F: '7', 0x50: '8', 0x51: '9',
    # puntuacion (identificada leyendo el contexto)
    0x12: ',', 0x1D: '.', 0x28: ',', 0x24: ':', 0x48: '?', 0x4B: '!',
    0x47: '¿', 0x4A: '¡', 0x25: '"', 0x26: '"', 0x49: '"',
}

# Palabras que empiezan con 'j' en esta obra. Hacen falta para desambiguar el
# codigo 0x20 al principio de palabra (ver descifrar).
PREFIJOS_J = (
    'ust', 'uic', 'uríd', 'uzg', 'uvent', 'uec', 'uez', 'unt', 'amás',
    'oven', 'úbil', 'ubil', 'uego', 'orna', 'urad', 'uio', 'ulio', 'unio',
    'unio', 'urisd', 'uram', 'actan',
)

# 0x20 es ambiguo: es el glifo 'j' Y el espacio que PyMuPDF inserta en los
# huecos del texto justificado. Se resuelve por posicion (ver descifrar).
CODIGO_J = 0x20
# Espacio propio de la fuente.
CODIGO_ESPACIO = 0x01
# Abren y cierran la referencia de carta ('XLIV'). No tienen glifo propio, pero
# separan la referencia del texto: sin esto queda 'por el.LXIII Una vez'.
CODIGOS_MUDOS = {0x42, 0x44}


def descifrar(crudo: str) -> str:
    salida = []
    for i, car in enumerate(crudo):
        cod = ord(car)
        if cod in CODIGOS_MUDOS:
            salida.append(' ')
            continue
        if cod == CODIGO_ESPACIO:
            salida.append(' ')
        elif cod == CODIGO_J:
            antes = TABLA_GLIFOS.get(ord(crudo[i - 1]), ' ') if i else ' '
            if antes.isalpha():
                salida.append('j')      # dentro de palabra: 'sujeto', 'mujer'
            else:
                # Al principio de palabra el codigo es ambiguo: puede ser la 'j'
                # de 'justo' o el hueco que PyMuPDF inserta en el texto
                # justificado. Se mira lo que sigue.
                # La 'j' pega con la letra siguiente; si lo que sigue es otro
                # hueco, esto era un hueco (el texto justificado encadena varios).
                sigue = TABLA_GLIFOS.get(ord(crudo[i + 1]), '') if i + 1 < len(crudo) else ''
                resto = ''.join(TABLA_GLIFOS.get(ord(c), '')
                                for c in crudo[i + 1:i + 12])
                es_j = sigue.isalpha() and resto.lower().startswith(PREFIJOS_J)
                salida.append('j' if es_j else ' ')
        else:
            salida.append(TABLA_GLIFOS.get(cod, ''))
    return ''.join(salida)


def texto_del_pdf(ruta: Path) -> str:
    import fitz

    doc = fitz.open(ruta)
    paginas = []
    for pagina in doc:
        trozos = []
        for bloque in pagina.get_text('rawdict')['blocks']:
            for linea in bloque.get('lines', []):
                for span in linea['spans']:
                    if span['font'] != FUENTE_CUERPO:
                        continue  # encabezados y folios van en otra fuente
                    trozos.append(''.join(c['c'] for c in span['chars']))
        if trozos:
            paginas.append(descifrar(' '.join(trozos)))

    # Una oracion puede seguir de una pagina a la otra. Solo se abre parrafo
    # cuando la pagina anterior cerro con puntuacion de fin de oracion; si no,
    # se pega con un espacio y la frase queda entera.
    texto = ''
    for pagina in paginas:
        pagina = pagina.strip()
        if not pagina:
            continue
        if not texto:
            texto = pagina
        elif texto.rstrip().endswith(('.', '!', '?', '"', ':')):
            texto += '\n\n' + pagina
        else:
            texto += ' ' + pagina
    return texto


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('pdf', type=Path)
    ap.add_argument('salida', type=Path, help='carpeta donde escribir los CHUNK_N.txt')
    ap.add_argument('--por-chunk', type=int, default=2500,
                    help='chars por chunk (default 2500)')
    args = ap.parse_args()

    texto = texto_del_pdf(args.pdf)
    texto = re.sub(r'[ \t]{2,}', ' ', texto)
    texto = re.sub(r'\n{3,}', '\n\n', texto).strip()

    # Se reparte en CHUNK_N.txt para que el resto del pipeline no cambie.
    bloques = [b for b in texto.split('\n\n') if b.strip()]
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

    puntos = 1000 * texto.count('.') / max(len(texto), 1)
    print(f'{len(texto)} chars -> {len(chunks)} chunks en {args.salida}')
    print(f'puntuacion: {puntos:.1f} puntos/1000 chars')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
