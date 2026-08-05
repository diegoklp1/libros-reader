# Sincronización audio ↔ texto

El lector resalta el **bloque de texto** (un párrafo corto / grupo de oraciones, ~250
caracteres) que se está narrando, avanza de página solo y hace scroll para mantenerlo a
la vista.

> **Respuesta corta:** no necesitás cambiar nada en tus archivos. Con el `.txt` y el
> `.mp3` de siempre ya funciona. El archivo de tiempos es **opcional** y solo mejora la
> precisión.

---

## Los 3 niveles de precisión

### Nivel 1 — Solo `.txt` + audio (lo que ya tenés)

La app estima la posición **proporcionalmente**: reparte la duración del audio entre los
caracteres del texto.

- ✅ Cero trabajo extra.
- ⚠️ Se desincroniza si el audio tiene introducción, música, pausas largas o ritmo
  variable. El error se acumula a lo largo del libro.

### Nivel 2 — `.txt` + audio + **calibración manual** (recomendado, sin herramientas)

Dentro del lector, **mantené presionado un párrafo** → *"El audio está acá ahora"*.
Eso crea un **ancla** que fija "este párrafo ↔ este segundo".

- La app interpola entre anclas, así que **2 o 3 anclas** (principio, medio, fin) ya
  corrigen casi toda la deriva.
- Las anclas se guardan con el libro y persisten.
- También podés hacer *"Reproducir desde acá"* para saltar el audio a un párrafo.

Este es el mejor costo/beneficio: no requiere ninguna herramienta externa.

### Nivel 3 — `.txt` + audio + archivo de tiempos (máxima precisión)

Al agregar o editar el libro, cuando cargás un audio aparece el selector
**"Tiempos .srt/.vtt/.json"**. Se aceptan tres formatos.

#### Opción A: `.srt` o `.vtt` (lo más práctico)

Es el formato estándar de subtítulos. Lo podés generar automáticamente desde el audio con
[Whisper](https://github.com/openai/whisper):

```bash
# Genera Audio_CARPEDIEM_compressed.srt junto al mp3
whisper Audio_CARPEDIEM_compressed.mp3 --language Spanish --output_format srt
```

La app alinea el texto de cada subtítulo contra tu `.txt` para ubicar el momento exacto.
El matching **ignora tildes, ñ y puntuación**, así que las diferencias típicas de una
transcripción automática no rompen la alineación. Los subtítulos que no matcheen
simplemente se ignoran; con que matcheen algunos, ya mejora mucho.

#### Opción B: `.json` propio

```json
{
  "version": 1,
  "cues": [
    { "start": 0,     "text": "CARPE DIEM Aprovecha el Presente" },
    { "start": 12.5,  "text": "Recoge los días como quien junta rosas" },
    { "start": 100,   "text": "Este no es un libro común" }
  ]
}
```

Campos:

| Campo   | Requerido | Descripción |
|---------|-----------|-------------|
| `start` | sí | Segundo de inicio. Acepta número (`12.5`) o texto (`"00:01:40,000"`, `"01:40"`). |
| `text`  | sí* | Fragmento del texto que se narra en ese momento. Basta con las primeras palabras. |
| `block` | sí* | Alternativa a `text`: índice exacto del bloque (0, 1, 2…). |

\* Tenés que usar `text` **o** `block`. `block` es exacto pero depende de la
segmentación; `text` es más robusto y es el recomendado.

También se acepta un array pelado: `[{ "start": 0, "text": "..." }, ...]`.

---

## Cómo debe estar formateado el `.txt`

**No hace falta ningún formato especial.** La app segmenta sola: separa por párrafos
(líneas en blanco) y dentro de cada párrafo agrupa oraciones hasta ~280 caracteres.

Aun así, el resultado es mejor si:

- **Separás los párrafos con una línea en blanco.** Si el texto viene con saltos de línea
  "duros" a mitad de oración (texto envuelto), la app los une igual, pero los párrafos
  reales quedan mejor delimitados con líneas en blanco.
- **Usás puntuación normal** (`.`, `?`, `!`). Es lo que define los cortes de bloque.
- El texto del `.txt` **corresponde a lo que se narra**. Si el audio saltea partes o
  agrega una introducción larga, conviene usar anclas (Nivel 2) o cues (Nivel 3).

Ejemplo probado con `LIBRO1/Texto_CARPEDIEM.txt` (92.337 caracteres):
**383 bloques**, tamaño mediano de 247 caracteres. Ideal para resaltar.

---

## Controles en el lector

| Acción | Cómo |
|---|---|
| Activar/desactivar seguimiento | Ícono 🔗 en la barra superior |
| Ajustar la sincronización | Mantener presionado un párrafo → *"El audio está acá ahora"* |
| Saltar el audio a un párrafo | Mantener presionado un párrafo → *"Reproducir desde acá"* |
| Borrar la calibración | Mantener presionado un párrafo → *"Borrar calibración"* |

Con el seguimiento activo, el bloque narrado se resalta, la página avanza sola y el
scroll acompaña.
