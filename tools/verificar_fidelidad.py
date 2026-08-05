# -*- coding: utf-8 -*-
"""
Comprueba que el TXT limpio no inventa ni reescribe nada: sus palabras deben
aparecer en el original, en el mismo orden (o sea, ser una subsecuencia).

Sirve como red de seguridad del pipeline: si alguien agrega un paso que
parafrasea o reordena el texto, este chequeo falla.

Uso:
    python verificar_fidelidad.py <carpeta_CHUNKS> <LIBRO.txt>
"""
import glob
import os
import re
import sys
import unicodedata


def palabras(s):
    s = unicodedata.normalize('NFC', s).lower()
    s = s.replace('…', '...').replace('“', '"').replace('”', '"')
    return re.findall(r'[a-záéíóúñü0-9]+', s)


def main():
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    carpeta, txt = sys.argv[1], sys.argv[2]

    archivos = sorted(glob.glob(os.path.join(carpeta, 'CHUNK_*.txt')),
                      key=lambda f: int(re.findall(r'\d+', os.path.basename(f))[0]))
    if not archivos:
        raise SystemExit(f'No hay CHUNK_*.txt en {carpeta}')

    origen = ''.join(open(f, encoding='utf-8').read() + ' ' for f in archivos)
    salida = open(txt, encoding='utf-8').read()

    A, B = palabras(origen), palabras(salida)

    i, faltan = 0, []
    for w in B:
        j = i
        while j < len(A) and A[j] != w:
            j += 1
        if j < len(A):
            i = j + 1
        else:
            faltan.append(w)

    print(f'palabras original : {len(A)}')
    print(f'palabras salida   : {len(B)}')
    print(f'palabras quitadas : {len(A) - len(B)} (ruido editorial)')
    print()
    if faltan:
        print(f'[X] FALLA: {len(faltan)} palabras de la salida no estan en el original en orden.')
        print('    ejemplos:', faltan[:15])
        return 1
    print('[OK] La salida es subsecuencia exacta del original: no se invento ni reescribio texto.')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
