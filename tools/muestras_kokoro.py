# -*- coding: utf-8 -*-
"""
Genera muestras comparativas de Kokoro leyendo el mismo texto en espanol.

Kokoro fonemiza con espeak segun el idioma (lang_code='e' = espanol), y el
"voice" solo aporta el timbre. Por eso se pueden usar embeddings de otros
idiomas leyendo espanol: las voces de portugues BR e italiano suelen sonar
muy naturales por cercania fonetica.

Tambien mezcla embeddings (promedio ponderado) para crear voces nuevas.

Uso:
    python muestras_kokoro.py <texto.txt> <carpeta_salida> [--ffmpeg RUTA]
"""
import argparse
import os
import subprocess
import sys
import warnings

warnings.filterwarnings('ignore')

# (etiqueta, voz, velocidad)
MUESTRAS = [
    # --- nativas espanol ---
    ('ES_em_alex',            'em_alex',    1.00),
    ('ES_em_alex_lento',      'em_alex',    0.90),
    ('ES_em_santa',           'em_santa',   1.00),
    ('ES_ef_dora',            'ef_dora',    1.00),
    ('ES_ef_dora_lento',      'ef_dora',    0.90),
    # --- portugues BR (fonetica cercana) ---
    ('PT_pm_alex',            'pm_alex',    1.00),
    ('PT_pm_santa',           'pm_santa',   1.00),
    ('PT_pf_dora',            'pf_dora',    1.00),
    # --- italiano ---
    ('IT_im_nicola',          'im_nicola',  1.00),
    ('IT_if_sara',            'if_sara',    1.00),
    # --- ingles (timbres mas trabajados del modelo) ---
    ('EN_am_michael',         'am_michael', 1.00),
    ('EN_am_fenrir',          'am_fenrir',  1.00),
    ('EN_bm_george',          'bm_george',  1.00),
    ('EN_am_puck',            'am_puck',    1.00),
]

# mezclas: (etiqueta, [(voz, peso), ...], velocidad)
MEZCLAS = [
    ('MIX_alex_michael',   [('em_alex', 0.6), ('am_michael', 0.4)], 1.00),
    ('MIX_alex_nicola',    [('em_alex', 0.5), ('im_nicola', 0.5)],  1.00),
    ('MIX_santa_george',   [('em_santa', 0.6), ('bm_george', 0.4)], 0.95),
]


def a_mp3(ffmpeg, wav, mp3):
    r = subprocess.run([ffmpeg, '-y', '-loglevel', 'error', '-i', wav,
                        '-codec:a', 'libmp3lame', '-b:a', '64k', '-ar', '24000', '-ac', '1', mp3],
                       capture_output=True, text=True)
    if r.returncode == 0:
        os.remove(wav)
        return True
    print('    ffmpeg fallo:', (r.stderr or '')[:120])
    return False


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('texto')
    ap.add_argument('salida')
    ap.add_argument('--ffmpeg', default='')
    args = ap.parse_args()

    from kokoro import KPipeline
    import soundfile as sf
    import numpy as np
    import torch

    texto = open(args.texto, encoding='utf-8').read().strip()
    os.makedirs(args.salida, exist_ok=True)
    pipe = KPipeline(lang_code='e', repo_id='hexgrad/Kokoro-82M')

    def sintetizar(etiqueta, voz, velocidad):
        import time
        t0 = time.time()
        trozos = [t[2] for t in pipe(texto, voice=voz, speed=velocidad)]
        w = np.concatenate(trozos)
        wav = os.path.join(args.salida, f'K_{etiqueta}.wav')
        sf.write(wav, w, 24000)
        dur = len(w) / 24000
        destino = wav
        if args.ffmpeg:
            mp3 = os.path.join(args.salida, f'K_{etiqueta}.mp3')
            if a_mp3(args.ffmpeg, wav, mp3):
                destino = mp3
        print(f'  {etiqueta:<22} {dur:5.1f}s audio  ({dur / max(0.01, time.time() - t0):.1f}x)  -> {os.path.basename(destino)}')

    print(f'Voces individuales ({len(MUESTRAS)}):')
    for etiqueta, voz, vel in MUESTRAS:
        try:
            sintetizar(etiqueta, voz, vel)
        except Exception as e:
            print(f'  {etiqueta:<22} FALLO: {type(e).__name__}: {str(e)[:90]}')

    print(f'\nMezclas de voces ({len(MEZCLAS)}):')
    for etiqueta, componentes, vel in MEZCLAS:
        try:
            mezcla = None
            for voz, peso in componentes:
                t = pipe.load_voice(voz)
                mezcla = t * peso if mezcla is None else mezcla + t * peso
            sintetizar(etiqueta, mezcla, vel)
        except Exception as e:
            print(f'  {etiqueta:<22} FALLO: {type(e).__name__}: {str(e)[:90]}')


if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
