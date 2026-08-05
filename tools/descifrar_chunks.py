"""Descifra los CHUNK_N.txt de LIBRO2 antes de pasarlos por procesar_libro.py.

La extraccion del PDF quedo con la fuente sin mapear: buena parte del texto no
esta en claro sino desplazado. Conviven tres codificaciones en el mismo archivo
(a veces en la misma linea):

  - texto en claro
  - desplazamiento +29 (el mas comun): 'VDOYDQGR' -> 'salvando'
  - Cesar -3 (solo en CHUNK_35):       'Dfxpugdwh' -> 'Acuerdate'

En el +29 el espacio aparece indistintamente como 0x20 o como 0x03, y los
acentos no siguen el desplazamiento porque la fuente es un subset: van por
tabla (ACENTOS).

Se decide token por token, eligiendo la variante que mas se parece a espanol
segun bigramas frecuentes. Uso:

    python tools/descifrar_chunks.py LIBRO2/CHUNKS LIBRO2/CHUNKS_CLARO
"""

import argparse
import re
import sys
import unicodedata
from pathlib import Path

# Glifos acentuados: la fuente es un subset, no siguen el +29.
ACENTOS = {
    'i': 'á', 'p': 'é', 't': 'í', 'y': 'ó', '~': 'ú',
    'x': 'ñ', '\x81': 'ü', '¢': '¿', '£': '¡',
}

# Bigramas frecuentes del espanol, para puntuar candidatos.
BIGRAMAS = {
    'de', 'es', 'en', 'el', 'la', 'os', 'as', 'ar', 'er', 'ra', 'an', 'al',
    'ad', 'co', 'nt', 'te', 'do', 'or', 'qu', 'ue', 'st', 'ci', 'on', 'ta',
    'ro', 'se', 'no', 'lo', 're', 'to', 'da', 'ie', 'ic', 'ma', 'na', 'so',
    'pa', 'ri', 'me', 'un', 'sa', 'le', 'po', 'ntr', 'ien', 'que', 'ado',
}


def desplazar_29(texto: str) -> str:
    salida = []
    for car in texto:
        cod = ord(car)
        if car in ACENTOS:
            salida.append(ACENTOS[car])
        elif cod == 0x20:
            salida.append(' ')
        elif 0x02 <= cod <= 0x1F or 0x21 <= cod <= 0x5F:
            salida.append(chr(cod + 29))
        else:
            salida.append(car)
    return ''.join(salida)


def cesar(texto: str, k: int = -3) -> str:
    salida = []
    for car in texto:
        if 'a' <= car <= 'z':
            salida.append(chr((ord(car) - 97 + k) % 26 + 97))
        elif 'A' <= car <= 'Z':
            salida.append(chr((ord(car) - 65 + k) % 26 + 65))
        else:
            salida.append(car)
    return ''.join(salida)


# Puntuacion / smoothing
# ----------------------
# Las tres codificaciones aparecen en tramos contiguos, no alternadas palabra a
# palabra. Por eso se puntua cada token con cada cifrado, pero los tokens cortos
# ('a', 'y', 'de') no tienen evidencia suficiente y se resuelven heredando el
# cifrado del tramo que los rodea.

CIFRADOS = ('claro', 'mas29', 'cesar')

# Basura tipica que queda cuando se aplica el cifrado equivocado.
RAROS = set('[]\\{}|@#$%^&*_=<>~`')


def aplicar(token: str, cifrado: str) -> str:
    if cifrado == 'mas29':
        return desplazar_29(token)
    if cifrado == 'cesar':
        return cesar(token)
    return token


def puntuar(token: str) -> float:
    """Cuanto se parece un token a una palabra en espanol."""
    plano = unicodedata.normalize('NFD', token.lower())
    plano = ''.join(c for c in plano if not unicodedata.combining(c))
    letras = ''.join(c for c in plano if c.isalpha())
    if not letras:
        return 0.0
    # Simbolos sueltos en medio de una palabra delatan el cifrado equivocado.
    basura = sum(1 for c in token if c in RAROS) / len(token)
    # Mayusculas en medio de palabra: mismo sintoma.
    interior = token[1:]
    gritos = sum(1 for c in interior if c.isupper()) / max(len(interior), 1)

    vocales = sum(1 for c in letras if c in 'aeiou') / len(letras)
    v_score = 1.0 - min(abs(vocales - 0.45) / 0.45, 1.0)

    if len(letras) >= 2:
        pares = [letras[i:i + 2] for i in range(len(letras) - 1)]
        b_score = sum(1 for p in pares if p in BIGRAMAS) / len(pares)
    else:
        b_score = 0.0

    return b_score + v_score - 2.0 * basura - 1.5 * gritos


# Cambiar de cifrado a mitad de un tramo es raro: cobrar peaje por hacerlo evita
# que una palabra corta ambigua arrastre a las vecinas.
PEAJE_CAMBIO = 1.2
# El texto en claro es la hipotesis por defecto: en minusculas los cifrados casi
# no lo tocan, asi que sin evidencia hay que dejarlo como esta.
PREMIO_CLARO = 0.35


def descifrar(texto: str) -> str:
    # Los caracteres de control solo existen en +29, donde codifican el espacio
    # (0x03) y la puntuacion (0x0F ',', 0x11 '.', 0x1E ';'...). No son texto
    # valido en ninguna otra codificacion, asi que se resuelven de entrada.
    # Hay que hacerlo ANTES de tokenizar: Python considera 0x1C-0x1F como
    # espacios, de modo que re.split los tomaria por separadores y nunca
    # llegarian al Viterbi.
    # Se guardan en un area de uso privado para que el Viterbi no vuelva a
    # desplazarlos; se restauran al final.
    texto = ''.join(' ' if c == '\x03' else
                    chr(0xE000 + ord(c) + 29) if 0x02 <= ord(c) <= 0x1F and c not in '\t\n'
                    else c
                    for c in texto)
    partes = re.split(r'(\s+)', texto)
    idx = [i for i, p in enumerate(partes) if p and not p.isspace()]
    if not idx:
        return texto

    # Viterbi sobre la secuencia de tokens: cada uno elige cifrado segun lo
    # espanol que queda, pero pagando PEAJE_CAMBIO si difiere del anterior.
    # El premio a 'claro' solo aplica si el token tiene letras: los tokens sin
    # letras ('17.', '5/40') no son evidencia de nada y deben seguir al tramo.
    emision = []
    for i in idx:
        token = partes[i]
        sesgo = PREMIO_CLARO if any(c.isalpha() for c in token) else 0.0
        emision.append({c: puntuar(aplicar(token, c)) + (sesgo if c == 'claro' else 0.0)
                        for c in CIFRADOS})

    coste = {c: emision[0][c] for c in CIFRADOS}
    camino = {c: [c] for c in CIFRADOS}
    for paso in emision[1:]:
        nuevo_coste, nuevo_camino = {}, {}
        for c in CIFRADOS:
            previo = max(
                CIFRADOS,
                key=lambda p: coste[p] + (0.0 if p == c else -PEAJE_CAMBIO),
            )
            nuevo_coste[c] = (coste[previo] + paso[c]
                              + (0.0 if previo == c else -PEAJE_CAMBIO))
            nuevo_camino[c] = camino[previo] + [c]
        coste, camino = nuevo_coste, nuevo_camino

    mejor = max(CIFRADOS, key=lambda c: coste[c])
    for j, i in enumerate(idx):
        partes[i] = aplicar(partes[i], camino[mejor][j])
    salida = ''.join(partes)
    return ''.join(chr(ord(c) - 0xE000) if 0xE000 <= ord(c) <= 0xE0FF else c
                   for c in salida)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('entrada', type=Path, help='carpeta con los CHUNK_N.txt')
    ap.add_argument('salida', type=Path, help='carpeta destino')
    args = ap.parse_args()

    chunks = sorted(args.entrada.glob('CHUNK_*.txt'),
                    key=lambda f: int(re.search(r'CHUNK_(\d+)', f.name).group(1)))
    if not chunks:
        print(f'error: no hay CHUNK_*.txt en {args.entrada}', file=sys.stderr)
        return 1

    args.salida.mkdir(parents=True, exist_ok=True)
    for origen in chunks:
        claro = descifrar(origen.read_text(encoding='utf-8'))
        (args.salida / origen.name).write_text(claro, encoding='utf-8')
    print(f'{len(chunks)} chunks descifrados en {args.salida}')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
