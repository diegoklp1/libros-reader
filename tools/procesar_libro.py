# -*- coding: utf-8 -*-
"""
Procesa los chunks crudos extraidos de un PDF y devuelve un TXT limpio y
estructurado, listo para leer y para generar audio.

Que hace, en orden:
  1. Une los CHUNK_N.txt en orden numerico.
  2. Repara el texto: guiones de corte, espacios, comillas, puntuacion.
  3. Elimina el "ruido" editorial por anclas explicitas (promos, antipirateria,
     redes, pedidos de resena, datos de contacto).
  4. Reconstruye los parrafos, que la extraccion del PDF destruyo.
  5. Escribe el TXT completo y lo divide en PARTES para el TTS.

Las anclas son explicitas a proposito: si el libro cambia y una no aparece,
el script avisa en vez de recortar de menos en silencio.

El ruido a eliminar CAMBIA EN CADA LIBRO, por eso no va hardcodeado: se define
en un archivo `reglas.json` por libro (ver tools/README.md).

Uso:
    python procesar_libro.py <carpeta_CHUNKS> <carpeta_salida> [--reglas reglas.json]
"""
import argparse
import json
import os
import re
import sys
import unicodedata

# ---------------------------------------------------------------- utilidades

def leer_chunks(carpeta, excluir=()):
    """
    Une los CHUNK_N.txt en orden numerico real (1,2,...,10) y no alfabetico.

    `excluir` saca chunks enteros por numero: sirve cuando un chunk no es parte
    de la obra (relleno de la extraccion), donde las anclas de texto no aplican.
    """
    archivos = [f for f in os.listdir(carpeta) if re.match(r'^CHUNK_\d+\.txt$', f)]
    if not archivos:
        raise SystemExit(f'No se encontraron CHUNK_*.txt en {carpeta}')
    archivos.sort(key=lambda f: int(re.findall(r'\d+', f)[0]))
    if excluir:
        antes = len(archivos)
        archivos = [f for f in archivos
                    if int(re.findall(r'\d+', f)[0]) not in set(excluir)]
        print(f'  chunks excluidos: {sorted(excluir)} ({antes - len(archivos)} archivos)')
    partes = []
    for f in archivos:
        with open(os.path.join(carpeta, f), encoding='utf-8') as fh:
            partes.append(fh.read().strip())

    # El corte entre chunks no respeta las oraciones: parte frases al medio. Si
    # el chunk siguiente arranca en minuscula es que continua la frase anterior,
    # asi que se pega con un espacio en vez de abrir parrafo.
    texto, pegados = '', 0
    for trozo in partes:
        if not trozo:
            continue
        if not texto:
            texto = trozo
        elif trozo[0].islower():
            texto += ' ' + trozo
            pegados += 1
        else:
            texto += '\n\n' + trozo
    print(f'  chunks unidos: {len(archivos)}' +
          (f' ({pegados} pegados a mitad de frase)' if pegados else ''))
    return texto


def reparar_texto(t):
    """Arregla los destrozos tipicos de una extraccion de PDF."""
    t = t.replace('\r\n', '\n').replace('\r', '\n')
    t = unicodedata.normalize('NFC', t)
    # Palabras cortadas por guion al final del renglon: "diccio-\nnario"
    t = re.sub(r'(\w)-\s*\n\s*(\w)', r'\1\2', t)
    # Comillas y puntos suspensivos tipograficos -> formas simples y estables
    t = t.replace('“', '"').replace('”', '"').replace('«', '"').replace('»', '"')
    t = t.replace('’', "'").replace('‘', "'")
    t = t.replace('…', '...')
    # Espacios raros (no-break, tabs)
    t = t.replace(' ', ' ').replace('\t', ' ')
    # Espacio antes de puntuacion de cierre
    t = re.sub(r'\s+([,.;:!?)])', r'\1', t)
    # Espacios multiples, respetando los saltos de linea
    t = re.sub(r'[ ]{2,}', ' ', t)
    t = re.sub(r'\n{3,}', '\n\n', t)
    return t.strip()


def quitar_tramo(texto, desde, hasta, etiqueta, inclusivo=True, hasta_ultima=False):
    """
    Elimina el tramo entre dos anclas de texto. Si alguna no aparece, avisa y
    deja el texto intacto (mejor no borrar que borrar de mas).
    `hasta=None` recorta hasta el final del documento.
    `hasta_ultima` engancha la ULTIMA aparicion de `hasta` en vez de la primera:
    hace falta cuando el tramo a sacar repite la misma frase varias veces.
    """
    i = texto.find(desde)
    if i == -1:
        print(f'  [!] ancla inicial NO encontrada ({etiqueta}): "{desde[:45]}..."')
        return texto
    if hasta is None:
        j = len(texto)
    else:
        j = texto.rfind(hasta) if hasta_ultima else texto.find(hasta, i)
        if j == -1 or j < i:
            print(f'  [!] ancla final NO encontrada ({etiqueta}): "{hasta[:45]}..."')
            return texto
        j = j + len(hasta) if inclusivo else j
    print(f'  - {etiqueta}: {j - i} chars')
    return texto[:i] + texto[j:]


# ------------------------------------------------------- reconstruir parrafos

FIN_ORACION = '.!?'


def partir_oraciones(p):
    """Divide en oraciones sin lookbehind (portable) respetando comillas."""
    out, ini, i = [], 0, 0
    while i < len(p):
        if p[i] in FIN_ORACION:
            # Puntos suspensivos: en este texto suelen ir EN MEDIO de la frase.
            # Solo cortan oracion si lo que sigue arranca en mayuscula.
            if p[i] == '.':
                ini_run = i
                while ini_run > 0 and p[ini_run - 1] == '.':
                    ini_run -= 1
                fin_run = i
                while fin_run + 1 < len(p) and p[fin_run + 1] == '.':
                    fin_run += 1
                if fin_run - ini_run + 1 >= 2:
                    k = fin_run + 1
                    while k < len(p) and p[k].isspace():
                        k += 1
                    if k < len(p) and not p[k].isupper():
                        i = fin_run + 1
                        continue
                    i = fin_run          # corta al final de la corrida
            j = i + 1
            # absorbe puntuacion/comillas de cierre pegadas
            while j < len(p) and p[j] in '.!?"\')]':
                j += 1
            if j >= len(p) or p[j].isspace():
                frag = p[ini:j].strip()
                if frag:
                    out.append(frag)
                ini, i = j, j
                continue
            i = j
            continue
        i += 1
    cola = p[ini:].strip()
    if cola:
        out.append(cola)
    return out


# "- Nombre Apellido (Obra)" al final de una oracion => cierre de cita
RE_ATRIBUCION = re.compile(r'[–—-]\s*[A-ZÁÉÍÓÚÑ][^.!?]{2,60}$')


def reconstruir_parrafos(texto, objetivo=520, maximo=900):
    """
    La extraccion dejo bloques de decenas de miles de caracteres. Reagrupa las
    oraciones en parrafos legibles, cortando siempre en limite de oracion y
    forzando corte cuando empieza una cita o termina una atribucion de autor.
    """
    bloques = [b for b in re.split(r'\n\s*\n', texto) if b.strip()]
    parrafos = []

    for bloque in bloques:
        bloque = re.sub(r'\s*\n\s*', ' ', bloque).strip()
        if not bloque:
            continue
        oraciones = partir_oraciones(bloque)
        actual = ''
        for o in oraciones:
            empieza_cita = o.startswith('"')
            cierra_cita = bool(RE_ATRIBUCION.search(o))

            if actual and (empieza_cita or len(actual) + 1 + len(o) > maximo
                           or (len(actual) >= objetivo and not cierra_cita)):
                parrafos.append(actual)
                actual = o
            else:
                actual = f'{actual} {o}'.strip() if actual else o

            if cierra_cita and actual:
                parrafos.append(actual)
                actual = ''
        if actual:
            parrafos.append(actual)

    return parrafos


# --------------------------------------------------------------- duplicados

def quitar_duplicados(parrafos):
    """
    Saca parrafos repetidos, conservando la primera aparicion.

    Algunas extracciones repiten pasajes enteros (el mismo parrafo aparece dos o
    tres veces en distintos puntos). Va por `reglas.json` y no por defecto,
    porque en otro libro una repeticion puede ser deliberada.
    """
    vistos, salida, quitados = set(), [], 0
    for p in parrafos:
        clave = ' '.join(p.split()).lower()
        # Los parrafos muy cortos (titulos, numeros de carta) repiten de forma
        # legitima: no se tocan.
        if len(clave) > 80 and clave in vistos:
            quitados += 1
            continue
        vistos.add(clave)
        salida.append(p)
    if quitados:
        print(f'  - parrafos duplicados: {quitados}')
    return salida


# ------------------------------------------------------------------ titulos

def formatear_titulos(parrafos):
    """Pone los encabezados detectados en su propia linea/parrafo."""
    salida = []
    for p in parrafos:
        m = re.match(r'^(PARTE\s+\d+)\s+([A-ZÁÉÍÓÚÑ][^.]{3,45}?)\s+(DÍA\s+\d+)\s+(.*)$', p, re.S)
        if m:
            salida.append(f'{m.group(1)} — {m.group(2).strip()}')
            salida.append(m.group(3))
            if m.group(4).strip():
                salida.append(m.group(4).strip())
            continue
        m = re.match(r'^(CONCLUSIÓN)\s+(.*)$', p, re.S)
        if m:
            salida.append(m.group(1))
            if m.group(2).strip():
                salida.append(m.group(2).strip())
            continue
        salida.append(p)
    return salida


# -------------------------------------------------------------------- partes

def dividir_en_partes(parrafos, max_chars=3500):
    """Agrupa parrafos completos en partes para el TTS (nunca parte un parrafo)."""
    partes, actual, n = [], [], 0
    for p in parrafos:
        if actual and n + len(p) > max_chars:
            partes.append(actual)
            actual, n = [], 0
        actual.append(p)
        n += len(p) + 2
    if actual:
        partes.append(actual)
    return partes


# ---------------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('chunks')
    ap.add_argument('salida')
    ap.add_argument('--reglas', default='', help='JSON con el ruido a eliminar en ESTE libro')
    ap.add_argument('--titulo', default='')
    ap.add_argument('--max-parte', type=int, default=3500)
    args = ap.parse_args()

    reglas = {'quitar': [], 'reemplazar': []}
    if args.reglas:
        with open(args.reglas, encoding='utf-8') as fh:
            reglas.update(json.load(fh))
    else:
        print('  [!] Sin --reglas: NO se eliminara ruido editorial.')
        print('      Cada libro trae su propio ruido; ver tools/README.md')

    print('1) Uniendo chunks...')
    texto = leer_chunks(args.chunks, reglas.get('excluir_chunks', ()))
    original = len(texto)

    print('2) Reparando texto...')
    texto = reparar_texto(texto)

    print('3) Eliminando ruido editorial...')
    for r in reglas['quitar']:
        texto = quitar_tramo(texto, r['desde'], r.get('hasta'),
                             r.get('etiqueta', r['desde'][:30]),
                             hasta_ultima=r.get('hasta_ultima', False))
    for r in reglas['reemplazar']:
        texto = texto.replace(r['de'], r['por'])

    print('4) Reconstruyendo parrafos...')
    # El poema inicial conserva sus saltos de linea; el resto es prosa.
    corte = texto.find('Este no es un libro común')
    if corte == -1:
        poema, prosa = '', texto
    else:
        poema, prosa = texto[:corte].strip(), texto[corte:]

    parrafos = reconstruir_parrafos(prosa, maximo=args.max_parte)
    if reglas.get('deduplicar'):
        parrafos = quitar_duplicados(parrafos)
    parrafos = formatear_titulos(parrafos)

    os.makedirs(args.salida, exist_ok=True)
    bloques_finales = []
    if args.titulo:
        bloques_finales.append(args.titulo)
    if poema:
        bloques_finales.append(poema)
    bloques_finales.extend(parrafos)

    final = '\n\n'.join(bloques_finales).strip() + '\n'
    ruta_txt = os.path.join(args.salida, 'LIBRO.txt')
    with open(ruta_txt, 'w', encoding='utf-8') as fh:
        fh.write(final)

    print('5) Generando partes para TTS...')
    dir_partes = os.path.join(args.salida, 'PARTES')
    os.makedirs(dir_partes, exist_ok=True)
    for viejo in os.listdir(dir_partes):
        if re.match(r'^PARTE_\d+\.txt$', viejo):
            os.remove(os.path.join(dir_partes, viejo))

    partes = dividir_en_partes(bloques_finales, args.max_parte)
    for i, grupo in enumerate(partes, 1):
        with open(os.path.join(dir_partes, f'PARTE_{i:03d}.txt'), 'w', encoding='utf-8') as fh:
            fh.write('\n\n'.join(grupo).strip() + '\n')

    largos = sorted(len(p) for p in parrafos)
    print()
    print('--- RESUMEN ---')
    print(f'  entrada:        {original:>7} chars')
    print(f'  salida limpia:  {len(final):>7} chars  ({100 * len(final) / original:.1f}%)')
    print(f'  ruido quitado:  {original - len(final):>7} chars')
    print(f'  parrafos:       {len(parrafos):>7}')
    if largos:
        print(f'  largo parrafo:  min {largos[0]} / mediana {largos[len(largos)//2]} / max {largos[-1]}')
    print(f'  partes TTS:     {len(partes):>7}')
    print(f'  TXT -> {ruta_txt}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
