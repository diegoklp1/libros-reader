# -*- coding: utf-8 -*-
"""
Genera el audiolibro y su archivo de tiempos a partir de las PARTES de texto.

Por cada PARTE_NNN.txt llama a edge-tts pidiendole el audio y los subtitulos.
Los subtitulos de edge-tts traen los tiempos REALES de la sintesis (una entrada
por oracion), asi que no hace falta transcribir con Whisper ni estimar nada.

Al final une los MP3 y arma un unico .srt desplazando los tiempos de cada parte
por la duracion acumulada. La duracion se mide parseando los frames del MP3
(no hace falta ffmpeg) para que el desfase sea exacto.

Es reanudable: si una parte ya tiene su .mp3 y su .srt, se saltea.

Uso:
    python generar_audio.py <carpeta_SALIDA> [--voz es-AR-TomasNeural] [--solo N]
"""
import argparse
import os
import re
import subprocess
import sys

# ------------------------------------------------------- duracion real de MP3

BITRATES = {
    # (version_id, layer) -> tabla de bitrates en kbps
    (3, 1): [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
    (3, 2): [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
    (3, 3): [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
    (2, 1): [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
    (2, 2): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
    (2, 3): [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
}
SAMPLERATES = {3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000]}


def duracion_mp3(ruta):
    """Suma la duracion de cada frame MPEG. Exacto tambien con bitrate variable."""
    with open(ruta, 'rb') as fh:
        data = fh.read()

    i = 0
    # Saltea una etiqueta ID3v2 si esta presente
    if data[:3] == b'ID3':
        size = ((data[6] & 0x7F) << 21) | ((data[7] & 0x7F) << 14) | \
               ((data[8] & 0x7F) << 7) | (data[9] & 0x7F)
        i = 10 + size

    total = 0.0
    n = len(data)
    while i + 4 <= n:
        if data[i] != 0xFF or (data[i + 1] & 0xE0) != 0xE0:
            i += 1
            continue
        ver = (data[i + 1] >> 3) & 0x03      # 3=MPEG1, 2=MPEG2, 0=MPEG2.5
        layer = (data[i + 1] >> 1) & 0x03    # 1=LayerIII
        br_i = (data[i + 2] >> 4) & 0x0F
        sr_i = (data[i + 2] >> 2) & 0x03
        pad = (data[i + 2] >> 1) & 0x01

        if ver == 1 or layer == 0 or br_i in (0, 15) or sr_i == 3:
            i += 1
            continue
        layer_num = 4 - layer                # 1,2,3
        key = (3 if ver == 3 else 2, layer_num)
        if key not in BITRATES:
            i += 1
            continue
        bitrate = BITRATES[key][br_i] * 1000
        samplerate = SAMPLERATES[ver][sr_i]
        if not bitrate or not samplerate:
            i += 1
            continue

        samples = 1152 if (ver == 3 and layer_num == 3) else (576 if layer_num == 3 else 1152)
        largo = (samples // 8 * bitrate) // samplerate + pad
        if largo <= 4:
            i += 1
            continue
        total += samples / samplerate
        i += largo
    return total


# ------------------------------------------------------------------- SRT

RE_TIEMPO = re.compile(r'(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})')


def leer_srt(ruta):
    """Devuelve [(inicio_seg, fin_seg, texto), ...]."""
    with open(ruta, encoding='utf-8') as fh:
        contenido = fh.read().replace('\r\n', '\n')
    cues = []
    for bloque in re.split(r'\n\s*\n', contenido):
        lineas = [l for l in bloque.split('\n') if l.strip()]
        if not lineas:
            continue
        idx = next((k for k, l in enumerate(lineas) if RE_TIEMPO.search(l)), None)
        if idx is None:
            continue
        m = RE_TIEMPO.search(lineas[idx])
        ini = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000
        fin = int(m.group(5)) * 3600 + int(m.group(6)) * 60 + int(m.group(7)) + int(m.group(8)) / 1000
        texto = ' '.join(lineas[idx + 1:]).strip()
        if texto:
            cues.append((ini, fin, texto))
    return cues


def fmt(t):
    h = int(t // 3600)
    m = int((t % 3600) // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        ms, s = 0, s + 1
    return f'{h:02d}:{m:02d}:{s:02d},{ms:03d}'


# ------------------------------------------------------------------- proceso

def sintetizar(txt, mp3, srt, voz, reintentos=3):
    for intento in range(1, reintentos + 1):
        r = subprocess.run(
            ['edge-tts', '--voice', voz, '--file', txt,
             '--write-media', mp3, '--write-subtitles', srt],
            capture_output=True, text=True)
        if r.returncode == 0 and os.path.exists(mp3) and os.path.getsize(mp3) > 1000:
            return True
        print(f'    reintento {intento}/{reintentos}: {(r.stderr or "").strip()[:120]}')
        for f in (mp3, srt):
            if os.path.exists(f):
                os.remove(f)
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('salida')
    ap.add_argument('--voz', default='es-MX-JorgeNeural',
                    help='voz de edge-tts (elegida tras comparar las 22 masculinas en espanol)')
    ap.add_argument('--solo', type=int, default=0, help='procesar solo las primeras N partes')
    args = ap.parse_args()

    dir_partes = os.path.join(args.salida, 'PARTES')
    dir_audio = os.path.join(args.salida, 'AUDIO')
    os.makedirs(dir_audio, exist_ok=True)

    partes = sorted(f for f in os.listdir(dir_partes) if re.match(r'^PARTE_\d+\.txt$', f))
    if args.solo:
        partes = partes[:args.solo]
    print(f'Partes a procesar: {len(partes)}  (voz: {args.voz})')

    generadas = []
    for k, nombre in enumerate(partes, 1):
        base = nombre[:-4]
        txt = os.path.join(dir_partes, nombre)
        mp3 = os.path.join(dir_audio, base + '.mp3')
        srt = os.path.join(dir_audio, base + '.srt')

        if os.path.exists(mp3) and os.path.exists(srt) and os.path.getsize(mp3) > 1000:
            print(f'  [{k}/{len(partes)}] {base}: ya existe, se saltea')
        else:
            print(f'  [{k}/{len(partes)}] {base}: sintetizando...', flush=True)
            if not sintetizar(txt, mp3, srt, args.voz):
                print(f'  [X] FALLO en {base}. Volve a correr el script para reintentar.')
                return 1
        generadas.append((mp3, srt))

    print('\nUniendo audio y armando el .srt global...')
    mp3_final = os.path.join(args.salida, 'AUDIOLIBRO.mp3')
    srt_final = os.path.join(args.salida, 'AUDIOLIBRO.srt')

    offset = 0.0
    todos = []
    with open(mp3_final, 'wb') as out:
        for mp3, srt in generadas:
            with open(mp3, 'rb') as fh:
                out.write(fh.read())
            for ini, fin, texto in leer_srt(srt):
                todos.append((ini + offset, fin + offset, texto))
            offset += duracion_mp3(mp3)

    with open(srt_final, 'w', encoding='utf-8') as fh:
        for i, (ini, fin, texto) in enumerate(todos, 1):
            fh.write(f'{i}\n{fmt(ini)} --> {fmt(fin)}\n{texto}\n\n')

    print()
    print('--- RESUMEN ---')
    print(f'  audio:    {mp3_final}')
    print(f'  duracion: {int(offset // 60)}:{int(offset % 60):02d}  ({os.path.getsize(mp3_final) / 1e6:.1f} MB)')
    print(f'  cues:     {len(todos)}')
    print(f'  srt:      {srt_final}')
    return 0


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    sys.exit(main())
