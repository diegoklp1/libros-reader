# Changelog

Todas las mejoras y correcciones relevantes de MyLib Reader.
El formato sigue, de forma aproximada, [Keep a Changelog](https://keepachangelog.com/es-ES/).

## [Sin publicar]

### Añadido
- **Selector de tipografía de lectura.** Cinco familias pensadas para leer
  seguido: Literata (nueva por defecto, diseñada para lectores digitales), Lora,
  Merriweather, Inter y Atkinson Hyperlegible (alta legibilidad). Cada una
  declara un factor de corrección óptica en `READING_FONTS` porque la misma
  cantidad de puntos se ve de distinto tamaño según la altura-x: sin eso,
  cambiar de familia parecería cambiar el cuerpo del texto. Suma 1,58 MB.
- **Modo de lectura continuo**, además del paginado. La posición se conserva al
  cambiar de modo: se traduce página ↔ bloque en los dos sentidos.
- **Panel de ajustes del lector** (bottom sheet) con tema, tipografía, tamaño,
  interlineado, ancho de columna, modo, justificado, toque en los bordes y
  vibración. Reemplaza la barra superior, que tenía nueve íconos apretados y no
  entraba en pantallas angostas; ahora quedan cuatro acciones.
- **Tema de lectura “Noche”**: negro puro para pantallas OLED.
- **Zonas de toque** en el lector: los bordes pasan de página, el centro muestra
  los controles. Se puede desactivar.
- **Tiempo estimado restante** en la barra del lector, y deslizador para
  recorrer el libro entero sin pasar de a una página.
- **“Continuar leyendo”** en la biblioteca: el último libro abierto, arriba y
  entero, en lugar de tener que buscarlo en la grilla.
- **Categorías como chips** en fila, en vez de un diálogo para elegir una.
- **Gráfico de los últimos 14 días y mapa de constancia** en Estadísticas, más
  la racha más larga como referencia de la actual.
- **Animaciones de entrada, selección y pulsación** en toda la app
  (`components/ui/`: `Appear`, `PressableScale`, `Segmented`, `ProgressBar`,
  `Sheet`), con tokens de movimiento únicos en `motion`.
- **Resaltados con nota automática en el lector.** Mantener presionado un párrafo
  ofrece “Recordar esta parte”: marca el bloque con una barra al margen y un fondo
  tenue, y crea una nota con la cita. Se puede **extender** la marca a bloques
  siguientes, comentarla, y saltar desde “Mis Notas” al fragmento exacto. El ancla
  es el índice de bloque (`blockStart`/`blockEnd` en `BookNote`), no la página, así
  que no se corre al cambiar tamaño de letra u orientación. `BookNote.quote` y los
  campos de bloque son opcionales: las notas viejas escritas a mano siguen igual.
  Se conectó `logActivity(..., 'highlight', 1)`, que ya existía sin usarse, así que
  cada marca suma al dashboard.
- **Extractores de PDF** para cuando los chunks de n8n no sirven:
  - `tools/extraer_pdf_plano.py` — genérico para PDFs en texto plano. Saca el
    mobiliario de página (encabezados/pies/folios, con criterio geométrico para no
    borrar encabezados de capítulo), despega llamados a nota (`palabra1`), reúne
    palabras cortadas con guion y pega oraciones entre páginas.
  - `tools/extraer_pdf.py` — para PDFs cuya fuente no trae `ToUnicode` (LIBRO2):
    reconstruye la tabla de glifos alineando PyMuPDF contra pdftotext.
  - `tools/descifrar_chunks.py` — descifra chunks de n8n con codificaciones
    mezcladas (quedó como fallback; hoy se prefiere extraer del PDF).
- **`procesar_libro.py`**: `excluir_chunks`, `deduplicar` y `hasta_ultima` en
  `reglas.json`; une chunks pegando los que cortan a mitad de oración.

### Corregido
- **Los días se registraban en UTC.** `logActivity` usaba
  `new Date().toISOString()`, que convierte a UTC: leyendo después de las 21:00
  en Argentina la actividad quedaba asentada al día siguiente y la racha se
  cortaba sola. Ahora la clave del día se arma con la fecha local
  (`dateKey` en `src/BookContext.tsx`).
- **Faltaba `expo-asset`**, dependencia par de `expo-audio`. Fuera de Expo Go la
  app podía romper al reproducir audio.

### Notas de build
- Para compilar el APK de Android en Windows hizo falta actualizar el `ninja` del
  SDK a 1.12+ (el 1.10.2 no soporta rutas largas y el proyecto está muy anidado).
  Detalle completo en la memoria del proyecto (`build-apk-android`).
- Las animaciones usan la API `Animated` de React Native y no las animaciones de
  layout de Reanimated (`entering={FadeInDown…}`). Estas últimas dejan el
  elemento en `visibility: hidden` hasta que la animación arranca: si por lo que
  sea no arranca, el contenido queda invisible **y sin recibir toques**. No es un
  riesgo teórico — pasó durante el desarrollo y dejó la biblioteca en blanco.

### Preparados
- Los 9 libros con sus tres archivos (`LIBRO.txt`, `AUDIOLIBRO.mp3`,
  `AUDIOLIBRO.srt`) en `LIBROS/<NOMBRE>/SALIDA/`, verificados (fidelidad exacta,
  cues monótonos, cobertura ~100 %).

## [2.3.0]

Pipeline propio de preparación de libros: texto limpio, audiolibro y tiempos.

### Añadido
- **`tools/procesar_libro.py`** — convierte los chunks crudos de un PDF en un TXT
  limpio y estructurado:
  - une los chunks en orden numérico real (no alfabético);
  - repara guiones de corte, comillas tipográficas y espaciado;
  - elimina el ruido editorial (promos, antipiratería, redes, contacto) mediante
    **anclas declaradas por libro** en un `reglas.json`; si un ancla no aparece,
    avisa en vez de recortar de menos en silencio;
  - **reconstruye los párrafos** que la extracción del PDF destruye (en el libro
    de prueba había un bloque corrido de 38.867 caracteres). Regla clave del
    género: los puntos suspensivos solo cortan oración si lo que sigue empieza en
    mayúscula, lo que llevó los párrafos cortados a mitad de frase de 17 a 0;
  - divide en partes para el TTS sin partir nunca un párrafo.
- **`tools/generar_audio.py`** — genera el audiolibro y su `.srt`:
  - usa `edge-tts` pidiendo audio **y subtítulos**, así los tiempos son los
    **reales de la síntesis** (no hace falta Whisper ni estimar por longitud);
  - une los MP3 y desplaza los tiempos midiendo la duración con un **parser de
    frames MPEG**, sin depender de ffmpeg (error de concatenación: 0,0000 s);
  - reanudable y con reintentos.
- **`tools/verificar_fidelidad.py`** — comprueba que el TXT limpio es
  **subsecuencia exacta** del original: el pipeline solo borra, nunca reescribe
  ni parafrasea.
- **`tools/muestras_kokoro.py`** — genera muestras comparativas de voces locales
  (Kokoro), incluyendo mezclas de embeddings.
- **`tools/README.md`** — runbook completo para preparar un libro nuevo desde
  cero, pensado para retomarse sin contexto previo.

### Cambiado
- Voz por defecto del audiolibro: **`es-MX-JorgeNeural`**, elegida tras comparar
  las 22 voces masculinas en español de edge-tts.

## [2.2.1]

### Corregido
- **El texto no se podía desplazar verticalmente.** Cada página usaba `flex: 1` dentro
  del `FlatList` horizontal, donde no recibe una altura acotada: el `ScrollView` interno
  crecía hasta el alto del contenido (2270px contra 720px de pantalla) y el texto quedaba
  recortado e inalcanzable. Ahora la página recibe la altura medida del contenedor.
- **"Reproducir desde acá" podía quedar en silencio.** `seekTo` es asíncrono y se llamaba
  a `play()` sin esperarlo, así que con el audio pausado la reproducción podía arrancar
  antes de completarse el salto. Ahora se espera el salto y se acota el destino al rango
  válido del audio.

### Cambiado
- **Resaltado de sincronización gris y minimalista.** El bloque narrado usaba el mismo
  amarillo que las coincidencias de búsqueda, muy invasivo en tema oscuro. Ahora hay un
  color propio (`syncHighlight`) gris sutil en los tres temas de lectura, con un leve
  realce del texto. El amarillo queda reservado para la búsqueda.

## [2.2.0]

Sincronización entre el audiolibro y el texto en pantalla.

### Añadido
- **Seguimiento audio ↔ texto por bloques.** El lector resalta el párrafo/bloque que se
  está narrando (no palabra por palabra), avanza de página automáticamente y hace scroll
  para mantenerlo a la vista. Se activa/desactiva con el ícono 🔗 de la barra superior.
- **Motor de sincronización** (`src/sync.ts`):
  - Segmenta el texto en bloques de ~280 caracteres respetando párrafos y oraciones.
  - Soporta archivos de tiempos **`.srt`, `.vtt` y `.json`** (selector opcional al cargar
    el libro). El matching contra el texto ignora tildes, ñ y puntuación, por lo que
    tolera transcripciones automáticas (ej. Whisper).
  - **Calibración manual:** manteniendo presionado un párrafo se puede fijar
    "el audio está acá ahora"; la app interpola entre anclas. Con 2-3 anclas se corrige
    casi toda la deriva sin herramientas externas.
  - Sin cues ni anclas, estima la posición proporcionalmente por caracteres.
- **"Reproducir desde acá"**: saltar el audio al párrafo elegido.
- Documentación nueva: [`docs/SINCRONIZACION.md`](docs/SINCRONIZACION.md) con los
  formatos aceptados y cómo preparar los libros.

### Cambiado
- **El pipeline de texto ahora preserva la estructura.** Antes se colapsaba todo el
  espacio en blanco y se re-cortaba cada ~350 caracteres de forma arbitraria, destruyendo
  los párrafos originales. Ahora se segmenta por párrafos y oraciones, y las páginas se
  arman agrupando bloques completos (nunca se parte un bloque).
- El progreso de lectura ya no cuenta como "página leída" cuando el avance lo produce la
  sincronización automática del audio.

### Corregido
- **Mensaje de error del lector.** Cuando el archivo de texto ya no existe (por ejemplo
  libros viejos cargados antes de la persistencia de archivos), ahora se muestra una
  pantalla explicativa con el motivo y un botón para volver, en lugar de una página con
  el texto `"Hubo un error al intentar abrir el archivo de texto."`.
- **Los controles del lector no se abrían al tocar el texto** (bug preexistente, visible
  en web). Las barras superior/inferior se mostraban con `Animated`, pero el valor
  animado dejó de propagarse a la vista: se verificó que `fadeAnim.setValue(1)` cambiaba
  el valor interno mientras la opacidad del DOM seguía en `0`. Sin controles, el lector
  quedaba inutilizable (sin volver, sin reproductor). Se eliminó la dependencia de
  `Animated`: ahora las barras se renderizan condicionalmente por estado.
- **El paginado no desplazaba el contenido** (bug preexistente, visible en web). El
  contador de página avanzaba ("Pág 2 / 24") pero el contenido no se movía
  (`scrollLeft` seguía en 0). Dos causas: `scrollToIndex` no mueve el contenedor en
  react-native-web, y el scroll animado se cancela contra el `scroll-snap-type: x
  mandatory` que RNW aplica por `pagingEnabled`. Se centralizó el desplazamiento en un
  helper que usa `scrollToOffset` y desactiva la animación en web.

## [2.1.0]

Migración de audio y correcciones específicas de la web.

### Migrado
- **`expo-av` → `expo-audio`.** `expo-av` estaba deprecado en el SDK 54. El reproductor
  del lector (`app/reader.tsx`) ahora usa los hooks `useAudioPlayer` /
  `useAudioPlayerStatus`. Beneficios:
  - Liberación automática del audio al desmontar (ya no hace falta manejar el `unload`).
  - Los tiempos se manejan en **segundos** (antes eran milisegundos).
  - Compatibilidad hacia atrás: si una posición guardada estaba en milisegundos
    (formato viejo), se detecta y se convierte al restaurar.
  - `expo-av` fue desinstalado del proyecto.

### Corregido
- **Botones de "Gestión de Datos" no hacían nada en la web.** `Alert.alert` **no está
  implementado en react-native-web**, por lo que sus botones nunca disparaban el
  callback. Se agregó `src/dialog.ts` con `confirmDialog` / `notifyDialog`
  (usa `window.confirm` en web y `Alert` en nativo). Aplica a: borrar libros,
  reiniciar estadísticas, restablecer de fábrica y confirmar el borrado de un libro.
- **El menú de acciones del libro (mantener presionado) no funcionaba en web** por la
  misma razón (`Alert.alert` como action sheet). Se reemplazó por un **bottom-sheet
  cross-platform** con las acciones Editar / Archivar / Marcar terminado / Eliminar,
  accesible además desde un botón `⋯` en cada portada.
- **La web no era responsiva.** El ancho de tarjeta se calculaba una sola vez con
  `Dimensions.get('window')` al cargar el módulo → quedaban 2 columnas gigantes en
  desktop y no reaccionaba al redimensionar. Ahora se usa `useWindowDimensions` y las
  columnas se calculan dinámicamente (2 en móvil → hasta 5-6 en pantallas anchas), con
  el contenido centrado y limitado a un ancho máximo. Se aplicó ancho máximo también en
  Ajustes, Estadísticas, Agregar Libro y el texto del lector.
- **Warning `"shadow*" style props are deprecated`.** Se agregó el helper `shadow()`
  en `src/theme.ts` que usa `boxShadow` en web (sin warning) y `elevation`/`shadow*` en
  nativo. Se reemplazaron todas las sombras de la app por este helper.

## [2.0.0]

Rework completo de la app: usabilidad, funcionalidad, diseño y corrección de bugs.

### Añadido
- **Sistema de diseño centralizado** (`src/theme.ts`): tokens de color (claro/oscuro),
  tipografía, espaciado, radios y temas de papel del lector.
- **Modo oscuro real** en toda la app (Sistema / Claro / Oscuro), persistido, con el hook
  `useTheme()` y `src/PreferencesContext.tsx`.
- **Persistencia de preferencias** (`src/PreferencesContext.tsx`): modo de tema,
  auto-archivar y defaults del lector (tema, tamaño de fuente, interlineado) que se
  recuerdan entre libros.
- **Biblioteca mejorada:** buscador por título/autor, ordenamiento (recientes / título /
  progreso), barra de progreso por libro, badge de audiolibro, campo de **autor** y
  opción de marcar terminado / no leído.
- **Lector mejorado:** barra de progreso de lectura, contador `Pág X / N`, ajuste de
  interlineado y auto-archivado opcional al terminar.
- **Estadísticas:** métricas adicionales (páginas leídas, notas totales, total en
  biblioteca).
- **Ajustes:** selector de tema y toggle de auto-archivar reales (reemplazan los toggles
  falsos de sincronización/wifi).

### Corregido
- **Persistencia de archivos (crítico):** portada, `.txt` y audio se guardaban con la URI
  temporal del picker (caché) y se rompían al limpiarse. Ahora se copian a almacenamiento
  permanente (`documentDirectory/library/`) vía `src/storage.ts`, y se borran al eliminar
  el libro.
- **Fuga de memoria de audio:** el cleanup usaba un `sound` capturado en `null` del
  closure; nunca liberaba el recurso.
- **Condición de carrera al iniciar:** una bandera de hidratación evita que los efectos de
  guardado sobrescriban AsyncStorage con datos vacíos durante la carga.
- **Regex de búsqueda sin escapar:** buscar `(`, `.`, `*`, etc. rompía el resaltado.
- **Restauración de la página de lectura** al abrir un libro, con `onScrollToIndexFailed`.
- **Rutas de navegación** (`stats`, `settings`) registradas; se eliminó `app/modal.tsx`
  (plantilla sin uso).
- **API deprecada** de `ImagePicker.MediaTypeOptions` → `['images']`.

### Notas
- Datos y metadatos siguen en `AsyncStorage` vía Context API (offline-first).
