REPORTE DE IMPLEMENTACIÓN Y VERIFICACIÓN — NOTAS RONDA 3
Carpeta revisada: v3.24.32 - USO PARA CHAT GPT
Alcance: solo esta carpeta. No se modificó v3.24.26, otra copia ni el repositorio.

Criterio de estado
- IMPLEMENTADO + VERIFICADO (estático): el código contiene la implementación y pasó la verificación indicada.
- IMPLEMENTADO + NO VERIFICADO: está implementado en código, pero requiere inspección/medición en navegador real.
- PARCIAL + NO VERIFICADO: hay una implementación inicial, pero falta un requisito del documento o una prueba imprescindible.

VERIFICACIONES EJECUTADAS
- Sintaxis JavaScript: `node --check` pasó en los 20 módulos de `js/notas/`.
- Reconocimiento geométrico sintético repetido en esta revisión: triángulo → `triangulo`, rombo → `rombo`, rectángulo no cuadrado → `rectangulo`, cuadrado → `cuadrado`.
- Comprobación estática: presentes icono vectorial de +, 8 asas, barra de 2 filas, controles/gestos de zoom, exportación OCR, acción de escritura a texto, menú Otros, fechas compactas, guardado 500 ms y limpieza de observadores.
- Revisión general de todos los renglones A–L de este reporte y lectura del documento Ronda 3. Los estados se mantienen por criterio; esta pasada no convierte comprobaciones de código en verificación visual.
- Optimización nueva: los segmentos de tinta se agrupan y pintan en `requestAnimationFrame`; el scroll agrupa el redibujado; la solicitud OCR se cancela al cerrar el editor y no altera la nota si se cancela.
- Feedback OCR reforzado: aviso superior con spinner animado, `aria-live`/`aria-busy`, una pausa de un fotograma para permitir que se pinte antes de iniciar el trabajo y estados separados de preparación/reconocimiento/resultado/error.
- Localización: se añadieron traducciones de la interfaz de notas y del OCR a inglés, francés e italiano; el español sigue siendo el idioma fuente.
- No hay `package.json` ni suite de pruebas automatizadas en esta carpeta.
- No se ejecutó navegador real. Por ello no se midieron rectángulos, `scrollWidth/clientWidth`, marcos, gestos, visualización, rendimiento ni los anchos de teléfono. No marcar como visualmente confirmado.

A. STICKERS E IMÁGENES — PRIORIDAD 0

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| A1. Marco de selección punteado | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-editor.js:600-603`; `js/notas/notas-estilos.js:366-371` | Seleccionar sticker/imagen y medir el marco en navegador. |
| A1. Cuatro asas de esquina y cuatro de lado | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-editor.js:601-603` | Confirmar 8 asas visibles y colocadas sobre el marco. |
| A1. Área táctil de cada asa ≥28 px | IMPLEMENTADO + NO VERIFICADO | `.nt-sticker-asa` mide 28×28 en `js/notas/notas-estilos.js:370` | Medir `getBoundingClientRect()`; la regla CSS no demuestra el tamaño visual final. |
| A1. Asas/marco constantes con zoom | IMPLEMENTADO + NO VERIFICADO | El marco es `position:fixed`; zoom se aplica al contenido, no al marco. | Medir al 100 % y al 200 %. |
| A2. Esquinas conservan proporción actual | IMPLEMENTADO + NO VERIFICADO | Cálculo de redimensionado en `js/notas/notas-editor.js:681-688` | Ejecutar pruebas con sticker 200×100 y con proporción previamente estirada. |
| A2. Asas medias cambian solo ancho o solo alto | IMPLEMENTADO + NO VERIFICADO | Cálculo separado por `hx`/`hy`, `js/notas/notas-editor.js:685-688` | Medir dimensiones antes y después. |
| A2. El lado opuesto permanece anclado | IMPLEMENTADO + NO VERIFICADO | Centro ajustado por desplazamiento en ejes locales, `js/notas/notas-editor.js:685-688` | Medir ±1 px con rotación y espejo. |
| A2. Redimensionado con rotación y espejos | IMPLEMENTADO + NO VERIFICADO | Ejes locales, banderas `flipH/flipV`, `js/notas/notas-editor.js:592-603, 681-688` | Probar 30°, espejo horizontal y vertical en navegador. |
| A2. Mínimo 16 px y máximo 4× ancho disponible | IMPLEMENTADO + NO VERIFICADO | Límites en `js/notas/notas-editor.js:684` | Medir extremos; confirmar que la escala CSS/zoom no altera el límite lógico. |
| A2. Cursores según orientación | IMPLEMENTADO + NO VERIFICADO | Cursor recalculado al posicionar el marco, `js/notas/notas-editor.js:600-603` | Inspección visual con ángulos intermedios. |
| A2. Captura de puntero para mouse/táctil/lápiz | IMPLEMENTADO + NO VERIFICADO | `setPointerCapture`, `js/notas/notas-editor.js:681-683` | Probar los tres tipos de entrada. |
| A2. Un gesto equivale a una operación de deshacer | IMPLEMENTADO + NO VERIFICADO | Guardado una vez al soltar, `js/notas/notas-editor.js:688` | Confirmar con Ctrl+Z en navegador. |
| A2. Mover y rotar el objeto sigue disponible | IMPLEMENTADO + NO VERIFICADO | Arrastre del objeto y control de rotación existentes, `js/notas/notas-editor.js:634-680` | Probar con selección activa. |
| A2. Dimensiones guardadas en `em` | IMPLEMENTADO + NO VERIFICADO | Conversión al soltar, `js/notas/notas-editor.js:688` | Guardar, cerrar y reabrir; comprobar escala y tamaño. |
| A3. Esquina SE 200×100 → 300×150 | IMPLEMENTADO + NO VERIFICADO | Lógica A2 | Prueba visual/medida pendiente. |
| A3. Repetición en las otras tres esquinas | IMPLEMENTADO + NO VERIFICADO | Lógica A2 | Prueba visual/medida pendiente. |
| A3. Asa E cambia ancho y conserva alto | IMPLEMENTADO + NO VERIFICADO | Lógica A2 | Prueba visual/medida pendiente. |
| A3. Esquina conserva relación 3.0 tras estirar | IMPLEMENTADO + NO VERIFICADO | Proporción basada en tamaño actual | Prueba visual/medida pendiente. |
| A3. Ancla ±1 px con giro 30° y espejo | IMPLEMENTADO + NO VERIFICADO | Proyección a ejes locales | Prueba visual/medida pendiente. |
| A3. Un Ctrl+Z revierte un redimensionado | IMPLEMENTADO + NO VERIFICADO | Una captura de historial al terminar gesto | Prueba funcional pendiente. |
| A3. Asas mantienen tamaño en zoom 200 % | IMPLEMENTADO + NO VERIFICADO | Marco fijo fuera del área escalada | Medición pendiente. |

B. BARRA SUPERIOR

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| B1. Orden de 12 botones, 3·3·3·3 y Herramientas primero | IMPLEMENTADO + NO VERIFICADO | Construcción de grupos en `js/notas/notas-editor.js:84-94` | Medir posición y centrado en navegador. |
| B1. Divisores entre grupos | IMPLEMENTADO + NO VERIFICADO | Separadores reutilizados en filas | Confirmar aspecto final. |
| B2. Una fila en escritorio cuando cabe | IMPLEMENTADO + NO VERIFICADO | `ResizeObserver` mide grupos en `js/notas/notas-editor.js:96`; CSS `display:contents`, `js/notas/notas-estilos.js:352-354` | Confirmar a 1280 px que queda en una línea y centrada ±2 px. |
| B2. Dos filas explícitas de seis cuando no cabe | IMPLEMENTADO + NO VERIFICADO | Dos contenedores y clase de medición | Confirmar 6+6, sin scroll, a 360/320/280 px. |
| B2. Botones con tamaño adaptable | IMPLEMENTADO + NO VERIFICADO | `clamp(32px,9.5vw,40px)`, `js/notas/notas-estilos.js:355` | Medir dimensiones y desbordamiento en viewport. |

C. BARRA INFERIOR

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| C1. Presets, divisor, personalizados (máx. 3), selector | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-editor.js:259-270`; recientes limitados a 3 | Verificar orden real y límite visual. |
| C1. Colores a la izquierda y zoom/grosor a la derecha | IMPLEMENTADO + NO VERIFICADO | Grupo de colores antes del grupo de zoom; CSS `space-between` y `margin-left:auto` | Medir bordes contra el lienzo ±2 px. |
| C1. Grosor 0.5×–3× y etiqueta numérica | IMPLEMENTADO + NO VERIFICADO | Slider y `output`, `js/notas/notas-editor.js:138-145` | Mover slider y confirmar trazo y número. |
| C1. Selector de color circular y selector usable | IMPLEMENTADO + NO VERIFICADO | `input[type=color]`, `js/notas/notas-editor.js:265-270` | Confirmar interacción en táctil. |
| C1. Botones circulares Alejar/Acercar | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-editor.js:146-148`; SVG y CSS | Inspección visual pendiente. |
| C2. Dos filas cuando el ancho medido no alcanza | IMPLEMENTADO + NO VERIFICADO | `ResizeObserver`, `js/notas/notas-editor.js:150-151` | Confirmar por medición en 280–360 px. |
| C2. Colores arriba y zoom/slider abajo; sin tercer renglón | PARCIAL + NO VERIFICADO | Dos filas y reducción de bolitas están definidas en `js/notas/notas-estilos.js:356-364` | Falta medir la combinación máxima de seis presets + tres recientes + selector a 280 px. |

D. ZOOM DEL LIENZO

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| D1. Zoom −/+ por pasos de 25 %, 50–400 %, abre al 100 % | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-editor.js:148-154` | Probar límites y reinicio al abrir otra nota. |
| D1. Ctrl+rueda limitado al lienzo | IMPLEMENTADO + NO VERIFICADO | Listener no pasivo, comprobación de límites y `preventDefault`, `js/notas/notas-editor.js:154` | Confirmar que no hace zoom de página fuera del lienzo. |
| D1. Zoom centrado en cursor/centro del gesto | IMPLEMENTADO + NO VERIFICADO | Ajuste de scroll en `aplicarZoom`, línea 153 | Medir punto de anclaje ±2 px. |
| D1. Pellizco con dos dedos y paneo | PARCIAL + NO VERIFICADO | Seguimiento de dos punteros y scroll, `js/notas/notas-editor.js:155`; el navegador puede cancelar eventos según `touch-action` | Probar en teléfono real iOS/Android. |
| D1. El segundo dedo no dibuja; cancela trazo en curso | IMPLEMENTADO + NO VERIFICADO | `iniciarZoomDosDedos`, `js/notas/notas-tinta.js` cerca de 390; integra con modal | Verificar con lápiz y dedo simultáneos. |
| D2. Texto e tinta se escalan sin editar datos almacenados | IMPLEMENTADO + NO VERIFICADO | Zoom visual aplicado al cuerpo y la capa se recoloca/redibuja | Confirmar todos los tipos de contenido. |
| D2. Tinta, borrador, selección, asas y sticker siguen alineados | PARCIAL + NO VERIFICADO | Capa se recoloca y asas siguen al elemento; aún requiere comprobación conjunta | Medir dibujo bajo el puntero a 200 %. |
| D2. Indicador temporal del porcentaje | NO IMPLEMENTADO | Es opcional en el documento. | No aplica. |

E. FECHAS EN TELÉFONO

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| E1. Se conservan chips si caben y se muestra “Fecha” solo si no caben | IMPLEMENTADO + NO VERIFICADO | Medición de ancho natural y `ResizeObserver`, `js/notas/notas-editor.js:224-231` | Confirmar 360 px vs escritorio mediante `getBoundingClientRect()`. |
| E1. Respeta Ajustes; si ambos están apagados no muestra nada | IMPLEMENTADO + NO VERIFICADO | `camposFechaNota` usa `mostrar_creada`/`mostrar_modificada`, línea 224 | Probar las cuatro combinaciones de ajustes. |
| E2. Diálogo vertical editable sobre el editor | IMPLEMENTADO + NO VERIFICADO | Diálogo y reubicación de campos, `js/notas/notas-editor.js:225-231`; CSS `js/notas/notas-estilos.js:345` | Abrir, editar ambas fechas y confirmar orden. |
| E2. Usa calendario/reloj integrados; no controles nativos nuevos | IMPLEMENTADO + NO VERIFICADO | Reutiliza `crearCampoFecha`; calendario elevado a z-index superior | Probar que calendario no queda bajo el diálogo. |
| E2. Cambios persisten y “Modificada” se actualiza con contenido | IMPLEMENTADO + NO VERIFICADO | callbacks existentes y guardado, `js/notas/notas-editor.js:218-223` | Confirmar guardado tras reabrir. |

F. MENÚ HERRAMIENTAS / “OTROS”

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| F1. Menú principal solo incluye herramientas aplicables | IMPLEMENTADO + NO VERIFICADO | Disponibilidad calculada en `js/notas/notas-herramientas.js:211-226` | Probar nota vacía, texto, listas y casillas. |
| F2. “Otros” aparece al final con separador | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-herramientas.js:230`; CSS en `js/notas/notas-estilos.js:346` | Inspección visual pendiente. |
| F3. Se omite “Otros” si no hay faltantes | IMPLEMENTADO + NO VERIFICADO | Condición `if(faltantes.length)` | Crear una nota con todas las herramientas aplicables. |
| F4. Expande las herramientas faltantes agrupadas y atenuadas | IMPLEMENTADO + NO VERIFICADO | Agrupación, botón de expansión y clase atenuada, `js/notas/notas-herramientas.js:229-230` | Confirmar lista completa y aspecto. |
| F4. Al tocar una faltante se intenta aplicar y se explica por qué no se pudo | IMPLEMENTADO + NO VERIFICADO | Ejecuta transformación si produce cambios; si no, motivo por acción; aviso sobre editor | Probar cada motivo y comprobar visibilidad. |
| F5. Menú con altura limitada y scroll interno | IMPLEMENTADO + NO VERIFICADO | `max-height:min(70dvh,calc(100dvh - 16px))`, `js/notas/notas-estilos.js:346` | Probar posición superior/inferior y scroll táctil. |

G. FIGURAS

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| G1. Conserva edición, borrar figura, Stickers e Imágenes | IMPLEMENTADO + NO VERIFICADO | Controles existentes y lista ampliada, `js/notas/notas-editor.js:74-83` | Probar acciones previas. |
| G1. Diez formas con nombre y orden por grupos | IMPLEMENTADO + NO VERIFICADO | Líneas, básicas y especiales, `js/notas/notas-editor.js:80-84` | Confirmar que aparecen todas y en orden. |
| G1. Iconos uniformes 24×24 y filas legibles | IMPLEMENTADO + NO VERIFICADO | CSS `.nt-figura-icono`, `js/notas/notas-estilos.js:346` | Medir y comprobar en teléfono. |
| G2. Línea/flecha/rectángulo/cuadrado/círculo/elipse/triángulo/rombo/estrella/corazón dibujables | IMPLEMENTADO + NO VERIFICADO | Geometrías en `js/notas/notas-tinta.js:121-138, 326, 346` | Dibujar y exportar cada forma. |
| G2. Triángulo isósceles, rombo por puntos medios, estrella regular y corazón | IMPLEMENTADO + NO VERIFICADO | Geometría calculada desde la caja en `js/notas/notas-tinta.js:121-138` | Medir proporciones visuales. |
| G3. Círculo/cuadrado/estrella/corazón conservan proporción en edición | IMPLEMENTADO + NO VERIFICADO | Restricción de escala en `js/notas/notas-tinta.js:219` | Probar esquinas de selección. |
| G3. Rectángulo/elipse/triángulo/rombo se estiran libremente | IMPLEMENTADO + NO VERIFICADO | No aplican restricción de proporción | Probar edición. |
| G4. Reconoce triángulo y rombo; estrella/corazón solo son herramientas explícitas | IMPLEMENTADO + VERIFICADO (sintético parcial) | `js/notas/notas-formas.js:139,147,264-280`; prueba sintética de triángulo y rombo pasó | Falta reconocimiento en trazos reales y prueba para estrella/corazón. |

H. CIERRE / AUTOGUARDADO

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| H1. Nota nueva con contenido guarda y cierra sin diálogo | IMPLEMENTADO + NO VERIFICADO | Rama `!original`, `js/notas/notas-editor.js:813` | Escribir y cerrar con X/fuera/Esc. |
| H2. Nota existente editada pregunta Guardar / Deshacer cambios | IMPLEMENTADO + NO VERIFICADO | Diálogo y handler sin rediseño, `js/notas/notas-editor.js:811-822` | Probar ambos botones. |
| H2. Clic fuera/Esc del diálogo mantiene la edición abierta | IMPLEMENTADO + NO VERIFICADO | Listener de diálogo y handler de Escape, líneas 815-836 | Probar. |
| H2. Sin cambios cierra directo | IMPLEMENTADO + NO VERIFICADO | Comparación de firma antes de pedir cierre, línea 813 | Abrir y cerrar sin editar. |
| H3. Solo se cambia cuándo aparece el diálogo, no su diseño | IMPLEMENTADO + NO VERIFICADO | El HTML de diálogo conserva los dos botones existentes | Comparación visual pendiente. |
| H4. Nota nueva completamente vacía se descarta | IMPLEMENTADO + NO VERIFICADO | Firma igual y guardado ignora nota vacía | Confirmar que no aparece en lista. |
| H5. Una nota ya guardada se trata como existente al reabrir | IMPLEMENTADO + NO VERIFICADO | Se determina por `original` al abrir | Cerrar/reabrir y editar. |

I. TARJETAS Y PESTAÑAS DE ANCHO

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| I1. Gap inferior ≥8 px antes de divisoria | IMPLEMENTADO + NO VERIFICADO | `padding-bottom:8px`, `js/notas/notas-estilos.js:71` | Medir contenido y pie en cuatro colores, expandido/contraído. |
| I2. No quita las pestañas de ancho | IMPLEMENTADO + NO VERIFICADO | Asas siguen construyéndose en `js/notas/notas.js:463` | Confirmar visibilidad e interacción. |
| I2. Izquierda→derecha; derecha→izquierda; centro→ambos | IMPLEMENTADO + NO VERIFICADO | Cálculo de columna en `js/notas/notas.js:300-333` | Probar cada posición de grid. |
| I2. Más de dos columnas y fila completa→ambos; una columna→ninguno | IMPLEMENTADO + NO VERIFICADO | Reglas de span/columnas en `js/notas/notas.js:320-333` | Probar grid de 1, 2, 3+ columnas y resize. |
| I2. Área táctil de pestaña ≥24 px | IMPLEMENTADO + NO VERIFICADO | Regla `width:28px` sin hover en `js/notas/notas-estilos.js:229` | Medir área real en teléfono. |
| I2. Recalcula al cambiar columnas y ancho | IMPLEMENTADO + NO VERIFICADO | `ResizeObserver` existente en `js/notas/notas.js:717-719` y reaplicación de anchos | Redimensionar ventana real. |

J. TELÉFONOS Y TABLETAS

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| J1. Matriz 280, 320, 360, 375, 390, 412, 430, 600 y 768 px | NO VERIFICADO | Sin navegador de QA disponible | Ejecutar matriz en Chrome Android/Safari iOS y capturar medidas. |
| J1. Portrait/landscape y teclado abierto | NO VERIFICADO | No se simula con `node --check` | Probar visualViewport y safe areas. |
| J1. `scrollWidth <= innerWidth` | NO VERIFICADO | Requiere DOM real | Medir en cada tamaño. |
| J2. Barra superior 6+6 y sin scroll | IMPLEMENTADO + NO VERIFICADO | Medición `ResizeObserver` y dos filas explícitas | Medir cada ancho. |
| J2. Barra inferior dos filas | PARCIAL + NO VERIFICADO | Implementación presente; aún falta validar combinación máxima de colores a 280 px | Medir `scrollWidth/clientWidth`. |
| J2. Fila de fechas compacta | IMPLEMENTADO + NO VERIFICADO | Sección E | Medir a 360 px. |
| J2. Fila vencimiento/acciones se separa solo si no cabe | IMPLEMENTADO + NO VERIFICADO | Medición y clase `.nt-pie-dos-filas`, `js/notas/notas-editor.js:158-159` | Medir solapamientos. |
| J2. Título pin/título/X sin desbordar | IMPLEMENTADO + NO VERIFICADO | Grid de tres columnas y mínimos adaptables, `js/notas/notas-estilos.js:371-374` | Medir a 280 px. |
| J3. Botones táctiles ≥32 px y colores con área ≥28 px | IMPLEMENTADO + NO VERIFICADO | Reglas adaptables y pseudoelemento del color | Medir áreas finales. |
| J4. Editor usa 100dvh y safe areas en teléfono | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-estilos.js:344` | Abrir con teclado virtual en móvil. |
| J4. Barras visibles mientras aparece teclado | PARCIAL + NO VERIFICADO | Editor pantalla completa y scroll interno; no hay ajuste medido con `visualViewport` | Confirmar y ajustar si el teclado las cubre. |
| J5. Menús/diálogos dentro del viewport | PARCIAL + NO VERIFICADO | Herramientas, figuras, fecha y compartir tienen límites; falta revisar todas las ventanas juntas | Probar sticker, calendario, guardar y compartir en teléfono. |
| J6. Lista a una columna bajo 600 px | IMPLEMENTADO + NO VERIFICADO | `js/notas/notas-estilos.js:343` | Confirmar layout y cabecera. |
| J6. Filtros/cabecera no desbordan horizontalmente | NO VERIFICADO | No se midió `scrollWidth` del DOM | Revisar matriz de anchos. |
| J7. Tabla de medidas por viewport × barra | NO VERIFICADO | Sin navegador para producir números reales | Pendiente de pruebas visuales. |

K. ESCRITURA A MANO → TEXTO — CAMBIO SOLICITADO POR TI

La sección del documento proponía Claude, revisión y confirmación. La instrucción posterior del usuario la reemplaza: conversión con un toque, insertar de inmediato y usar Deshacer si no gusta; usar la clave Gemini ya configurada; español, inglés, francés e italiano.

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| K1/K2. Motor principal basado en imagen de la tinta | IMPLEMENTADO + NO VERIFICADO | Render PNG negro sobre blanco en `js/notas/notas-tinta.js:399`; llamada Gemini en `js/notas/notas-ocr.js:12` | Probar con manuscrita real. |
| K3. Reutiliza clave Gemini que la app ya guarda; no pide otra | IMPLEMENTADO + NO VERIFICADO | Lee `estado.datos.configuracion.gemini_api_key`, `js/notas/notas-ocr.js:12` | Probar con clave presente/ausente sin exponerla. |
| K3/K4. Compatible con español, inglés, francés e italiano | IMPLEMENTADO + NO VERIFICADO (motor principal) | Instrucción de transcripción explícita en `js/notas/notas-ocr.js:17` | Medir CER con muestras de los cuatro idiomas. |
| K4. Respaldo sin conexión | PARCIAL + NO VERIFICADO | Intenta Handwriting Recognition API cuando existe; no incluye modelo local propio | La API nativa no ofrece una cobertura fiable de los cuatro idiomas en todos los navegadores. No se incorporó un modelo local grande, que requeriría descargar/almacenar pesos y validar tamaño, licencia y calidad. |
| K5. Acción accesible desde Herramientas cuando hay tinta | IMPLEMENTADO + NO VERIFICADO | Acción dinámica `Escritura a texto`, `js/notas/notas-editor.js:161`; menú de extras `js/notas/notas-herramientas.js:227-230` | Probar menú en nota con/sin tinta. |
| K5. Un toque inserta texto y elimina tinta; no hay ventana de revisión | IMPLEMENTADO + NO VERIFICADO | `convertirTintaATexto`, `js/notas/notas-editor.js:856-863` | Probar conversión y que el cursor/posición sean adecuados. |
| K5. Un Deshacer devuelve texto y tinta originales | IMPLEMENTADO + NO VERIFICADO | Inserción y borrado de tinta se guardan en historial unificado, línea 861 | Confirmar Ctrl+Z/rehacer. |
| K5/K6. Feedback mientras procesa y si falla conserva tinta con motivo arriba del editor | IMPLEMENTADO + NO VERIFICADO | Aviso fijo `z-index:100300`, spinner, `aria-live` y `aria-busy`; se da un fotograma al navegador antes del OCR, `js/notas/notas-editor.js:854-864`, CSS `js/notas/notas-estilos.js:346` | Confirmar visualmente el spinner y simular sin red, sin clave, timeout y error API. |
| K6. Pruebas CER con muestras, error/timeout/cancelación | PARCIAL + NO VERIFICADO | Timeout/error conservan la tinta; cancelación de Gemini al cerrar y protección ante respuesta tardía, `js/notas/notas-ocr.js` y `js/notas/notas-editor.js` | No hay muestras del usuario ni navegador/API activa para medir CER; la API nativa puede terminar su predicción en curso antes de liberar recursos. |

L. OPTIMIZACIÓN

| Criterio | Estado | Evidencia | Confirmación pendiente |
|---|---|---|---|
| L1. Guardado diferido 400–800 ms y flush al salir | IMPLEMENTADO + VERIFICADO (estático) | 500 ms en `js/notas/notas-editor.js:187`; flush al salir en `js/notas/notas-editor.js:186,773` | Medir número de escrituras/sincronizaciones en uso real. |
| L1. Procesamiento de tinta limitado por puntos e historial | IMPLEMENTADO + VERIFICADO (estático) | `MAX_PUNTOS=60000`, `MAX_HISTORIAL=100`, `js/notas/notas-tinta.js:10-11,160` | Medir FPS con 50+ trazos. |
| L1. Lista carga imágenes de manera diferida | IMPLEMENTADO + VERIFICADO (estático) | `loading=lazy`, `decoding=async`, `js/notas/notas.js:401` | Medir carga/scroll en 200 notas. |
| L1. Observadores de tarjetas se liberan al repintar | IMPLEMENTADO + VERIFICADO (estático) | Disconnect antes de recrear cards, `js/notas/notas.js:452,692` | Hacer 50 ciclos abrir/cerrar y medir memoria. |
| L1. Tinta se dibuja por lotes coalescidos/RAF | IMPLEMENTADO + VERIFICADO (estático) | `getCoalescedEvents()` conserva muestras y `trazarVivo` junta segmentos por fotograma; scroll, borrador y figura también agrupan redibujados, `js/notas/notas-tinta.js:195,239-280,330-350,382-383` | Sin perfilador no se confirma el umbral <4 ms ni 60 FPS. |
| L2.2. Render diferido de tarjetas fuera de pantalla | PARCIAL + VERIFICADO (estático) | Imágenes diferidas y previews ligeras existentes; las tarjetas completas se construyen al renderizar la lista | Aplicar virtualización/render progresivo exige medir tarjetas altas, pestañas y anchos de grid para evitar saltos. |
| L2.7. Imágenes fuera del HTML y sync diferencial | NO IMPLEMENTADO | Las imágenes siguen en el HTML de la nota; no se cambió almacenamiento/sync | Requiere migración compatible y pruebas de ida y vuelta/sincronización para proteger notas existentes. |
| L2. 60 FPS, JS de puntero <4 ms, editor <150 ms, primera pintura 200 notas <300 ms | NO VERIFICADO | No se midió en navegador ni CPU 4× | Entregar tabla antes/después tras perfilado. |
| L2. 50 ciclos abrir/cerrar y limpieza de listeners | PARCIAL + NO VERIFICADO | Se desconectan nuevos observers y listeners al cerrar | Falta ciclo repetido y medición de memoria/listeners. |
| L3. Tabla de métricas antes/después | NO VERIFICADO | No hay mediciones antes/después reproducibles | No inventar cifras; medir en navegador. |

Desglose de la lista L2 del documento (para no dejar criterios agregados sin estado):

| L2 | Estado de esta revisión | Resultado / pendiente |
|---|---|---|
| 1. Tinta: RAF, eventos coalescidos, canvas sin DOM por punto, simplificación, límites | PARCIAL + VERIFICADO (estático) | RAF para segmentos y `getCoalescedEvents()`; canvas y simplificación al soltar; límite total de puntos e historial. No hay límite separado de cantidad de trazos; falta perfilado <4 ms/60 FPS. |
| 2. Listas largas: renderizar solo lo visible y miniaturas ligeras | PARCIAL + VERIFICADO (estático) | Miniatura de tinta y previews limitadas; imágenes `loading=lazy`. Se construyen todas las tarjetas completas; no hay `content-visibility`/`IntersectionObserver` para diferir previews. |
| 3. Imágenes: decodificación asíncrona, límites al guardar, URLs liberadas, miniaturas de stickers | PARCIAL + VERIFICADO (estático) | Imágenes en las tarjetas usan `decoding=async` y `loading=lazy`; stickers aún se muestran desde el recurso completo. No se confirmó reducción de dimensiones ni uso general de `createImageBitmap`/`decode()`. |
| 4. Layout: agrupar lecturas/escrituras, ResizeObserver en RAF, `will-change` temporal | PARCIAL + VERIFICADO (estático) | Medidores nuevos usan RAF o lecturas limitadas; falta auditar y medir todos los observers y escrituras. |
| 5. Eventos: opciones passive apropiadas y limpieza de editor/PiP/flotante | PARCIAL + VERIFICADO (estático) | Scroll pasivo y agrupado; wheel/gestos no pasivos donde llaman `preventDefault`; cierre del editor limpia los observers y handlers nuevos. Falta ciclo de vida repetido en PiP/flotante. |
| 6. Historial: profundidad limitada y pasos compactos | PARCIAL + VERIFICADO (estático) | Historial de tinta con máximo 100 pasos; algunos pasos aún conservan referencias/copiados de trazos, no se midió memoria. |
| 7. Almacenamiento: adjuntos aparte, medir tamaño y sincronizar solo cambios | NO IMPLEMENTADO | HTML de la nota todavía puede contener imágenes base64. Cambiarlo requiere migración compatible y validación de importación, almacenamiento y sync; no se hizo para no arriesgar datos existentes sin pruebas de integración. |
| 8. Carga: OCR y librerías pesadas diferidas; paquete y caché SW | PARCIAL + VERIFICADO (estático) | `notas-ocr.js` ahora se importa dinámicamente al solicitar conversión; no hay motor offline pesado. Sin análisis de paquete/caché no se verifica tamaño o estrategia del service worker. |
| 9. Memoria: 50 ciclos editor/PiP y sin crecimiento sostenido | PARCIAL + NO VERIFICADO | Cierre limpia observers/handlers del editor; no se ejecutaron ciclos ni medición de heap. |
| 10. Teléfono real/emulado con CPU 4× lenta | NO VERIFICADO | Requiere navegador y perfilador; no se midieron dibujo, zoom ni lista. |

Las filas L2 de arquitectura de almacenamiento, render diferido de todas las tarjetas y miniaturas de stickers quedan expuestas como pendientes reales, no como trabajo ya completado. No hay una migración de adjuntos segura que pueda confirmarse solo con sintaxis estática; requiere prueba de ida y vuelta de datos y sincronización antes de activarla.

OBSERVACIONES DE ALCANCE
- La instrucción “falta mover todo lo que es…” está incompleta y no define qué elementos mover.
- Ronda 3 remite a documentos de Ronda 1 y Ronda 2. En Descargas solo está disponible `instrucciones-notas-ronda3.md`; esos dos documentos referidos no existen en la carpeta revisada. Este reporte cubre el documento de Ronda 3 y las instrucciones posteriores que el usuario escribió en el chat.
- La documentación oficial de Chrome indica que su implementación actual en ChromeOS reconoce inglés solamente; no sirve como respaldo multilingüe equivalente a Gemini: https://developer.chrome.com/docs/web-platform/handwriting-recognition
- La copia no es un repositorio Git; no se creó commit, PR ni se tocó el `main`.

ARCHIVOS MODIFICADOS
- `js/notas/notas-editor.js`
- `js/notas/notas-estilos.js`
- `js/notas/notas.js`
- `js/notas/notas-tinta.js`
- `js/notas/notas-formas.js`
- `js/notas/notas-herramientas.js`
- `js/notas/notas-ocr.js` (nuevo, módulo diferido; solo se llama al solicitar la conversión)

REVISIÓN DE ESTA PASADA
- Cambios aplicados: segmentos de lápiz agrupados por `requestAnimationFrame` (se conserva el muestreo coalescido y no se recalcula toda la tinta por segmento); redibujado al desplazar limitado a un callback RAF pendiente (evita repintados duplicados por eventos de rueda y scroll); cancelación de la petición Gemini al cerrar/cancelar OCR; protección contra respuestas tardías y liberación del reconocedor nativo después de cancelar.
- Feedback de OCR: se muestra un indicador animado inmediatamente, se deja pintar un fotograma antes de cargar/procesar y se conserva hasta resultado o error; también informa a lectores de pantalla.
- Traducción final: catálogos EN/FR/IT ampliados con las cadenas de herramientas, formas, controles, fechas, avisos, OCR y errores. Escaneo de las llamadas directas `tr()` en `js/notas/`: 0 claves faltantes en los tres idiomas (las plantillas con `${...}` se comprobaron como `{variable}`). Los cuatro JSON de idioma parsean correctamente.
- Estado teórico general: todavía no está completo. El OCR offline no funciona en todos los navegadores ni cubre los cuatro idiomas; separar adjuntos de la nota exige migración y pruebas de sync. Además faltan las pruebas visuales y de rendimiento enumeradas en A–L.
- Verificación repetida: `node --check` en 20/20 módulos; cuatro figuras sintéticas reconocidas correctamente.
- No verificado en esta pasada: mediciones visuales de A–J, pruebas de la API Gemini y de escritura manuscrita, tamaños de pantalla, interacción táctil y métricas de rendimiento reales. Los criterios correspondientes permanecen marcados `NO VERIFICADO`/`PARCIAL` arriba.
