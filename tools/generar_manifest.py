# -*- coding: utf-8 -*-
"""
Genera el manifest.json que consume la importacion masiva de la app
(Configuracion -> Biblioteca -> Importar desde una carpeta).

Recorre una carpeta raiz con la convencion plana de LIBROS/ (sin CHUNKS ni
SALIDA/PARTES, ver runbook en tools/README.md):

    LIBROS/
      NOMBRE DEL LIBRO/
        <algo>.pdf              (opcional, el PDF original)
        LIBRO.txt
        AUDIOLIBRO.mp3          (opcional)
        AUDIOLIBRO.srt          (opcional)
        portada.jpg             (opcional, cualquier .jpg/.jpeg/.png/.webp)

Por cada subcarpeta con un LIBRO.txt escribe una entrada. El titulo sale del
nombre de la subcarpeta (Title Case); autor y categoria quedan vacios porque
no hay forma de adivinarlos del nombre de archivo, asi que conviene revisar
el manifest.json generado antes de importar.

Uso:
    python tools/generar_manifest.py <carpeta_raiz> [salida.json]
"""
import json
import sys
from pathlib import Path


def titulo_desde_carpeta(nombre: str) -> str:
    return ' '.join(w.capitalize() for w in nombre.split())


def buscar_portada(carpeta: Path):
    # .svg de ultima porque <Image> de React Native no lo renderiza sin una
    # libreria aparte; sirve como archivo pero no como portada en la app.
    for ext in ('*.jpg', '*.jpeg', '*.png', '*.webp', '*.svg'):
        encontradas = list(carpeta.glob(ext))
        if encontradas:
            return encontradas[0]
    return None


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        return 1
    raiz = Path(sys.argv[1])
    salida = Path(sys.argv[2]) if len(sys.argv) > 2 else raiz / 'manifest.json'

    if not raiz.is_dir():
        print(f'No es una carpeta: {raiz}')
        return 1

    libros = []
    for carpeta in sorted(p for p in raiz.iterdir() if p.is_dir()):
        txt = carpeta / 'LIBRO.txt'
        if not txt.exists():
            continue

        audio = carpeta / 'AUDIOLIBRO.mp3'
        srt = carpeta / 'AUDIOLIBRO.srt'
        portada = buscar_portada(carpeta)

        entrada = {
            'titulo': titulo_desde_carpeta(carpeta.name),
            'autor': '',
            'categoria': '',
            'descripcion': '',
            'txt': str(txt.relative_to(raiz)).replace('\\', '/'),
        }
        if audio.exists():
            entrada['audio'] = str(audio.relative_to(raiz)).replace('\\', '/')
        if srt.exists():
            entrada['srt'] = str(srt.relative_to(raiz)).replace('\\', '/')
        if portada:
            entrada['portada'] = str(portada.relative_to(raiz)).replace('\\', '/')

        libros.append(entrada)
        print(f'  + {entrada["titulo"]}'
              f'{" (con audio)" if audio.exists() else " (sin audio)"}')

    if not libros:
        print(f'No se encontro ningun LIBRO.txt debajo de {raiz}')
        return 1

    salida.write_text(json.dumps({'libros': libros}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'\n{len(libros)} libros -> {salida}')
    print('Revisa autor/categoria antes de importar: quedaron vacios.')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    raise SystemExit(main())
