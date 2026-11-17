# OPTIMIZACION.md — Auditoría estática y medición (v3.28.0)

Auditoría hecha **solo leyendo código** (rama `dev`, HEAD d504404). Nada se midió en dispositivo: los impactos son estimaciones por lectura y deben confirmarse con el procedimiento de abajo. Modo existente `data-rendimiento="reducido"` (Optimizado): se respeta y se refuerza.

## 1. Hallazgos priorizados
Impacto/Esfuerzo: A = alto, M = medio, B = bajo. Zona: A Finanzas/asistente · B navegación · C tiempo · D notas · Otra = núcleo/raíz.

| # | Hallazgo | Dónde | Impacto | Esfuerzo | Zona | Estado |
|---|----------|-------|---------|----------|------|--------|
| 1 | Capas de Notas con `backdrop-filter` sin contraparte en modo Optimizado (confirmar cierre, compartir, stickers, confirmar sticker) | `js/notas/notas-estilos.js:338, 437, 445, 446` | M (blur a pantalla completa en gama baja) | B | D | **Aplicado en D4** |
| 2 | Dos temporizadores llaman a `sondearCambiosRemotos` (cada 9 s y cada 20 s) y el sondeo ya no se detiene con la app en segundo plano (decisión deliberada, fix 2026-09-28) | `js/main.js:660` y `:673`; `js/core/storage/storage-sync.js:1253` | A (red + CPU + batería con app abierta) | M | Otra | Recomendado. No tocar sin aprobación: hubo pedido explícito de «máximo 30 s» entre dispositivos. Idea segura: un solo temporizador y, oculta la pestaña, ≥60 s (el sondeo al volver a primer plano y al reconectar ya existe) |
| 3 | 45 usos de `backdrop-filter` en `design-system.css` frente a 37 reglas `[data-rendimiento="reducido"]`: hay que comprobar selector por selector cuáles quedan con blur en modo Optimizado | `css/design-system.css` (grep `backdrop-filter`) | A | M | Otra (A/B/C según sección) | Recomendado |
| 4 | PiP de Android: canvas de 880×400 redibujado cada 1 s y `captureStream(2)`; el ancho de píxeles es mayor de lo que muestra un PiP | `js/tiempo-estudio/tiempo-estudio-indicador.js:407-409` | M | B | C | Recomendado (C4 ya rediseña este canvas: reducir tamaño ahí) |
| 5 | `will-change: transform` permanente en varios elementos (capas de GPU fijas) | `css/design-system.css:524, 3816, 5545`; `js/notas/notas-estilos.js:195` (`.nt-flotante`); `js/tiempo-estudio/tiempo-estudio-racha-ui.js:212` | M | B | Otra/D/C | Recomendado: ponerlo solo mientras se arrastra/anima (el drawer ya lo hace bien: `design-system.css:7280, 7309`) |
| 6 | Carga: 149 módulos JS (5,1 MB), 40 `import` estáticos en `main.js` y 20 `import()` dinámicos; sin `modulepreload` | `js/main.js`, `index.html:1867` | A en primer arranque | M | Otra | Recomendado: medir cascada en Network; precargar solo la sección inicial |
| 7 | `css/css/design-system.css` (333 KB) es un duplicado viejo versionado en git y **sin ninguna referencia** (`index.html:65` y el SW usan `css/design-system.css`) | `css/css/design-system.css` | B (peso del repo/despliegue, no del runtime) | B | Otra | Recomendado: borrar tras confirmar que nada lo enlaza |
| 8 | `audio/ganador.mp3` pesa 2,3 MB; no encontré referencia literal en `js/` ni `index.html` (puede armarse la ruta por texto) | `audio/ganador.mp3` | B-M (solo si se descarga) | B | C | Por verificar y, si se usa, recomprimir |
| 9 | Temporizador por tarjeta de competencias: confirmar que se limpia al repintar | `js/tiempo-estudio/tiempo-estudio-competencias.js:1503` | por confirmar | B | C | No verificado (no leí su limpieza) |
| 10 | `crearMiniTinta`: un canvas por nota con tinta (hasta 2400 px de ancho) y un `ResizeObserver` por canvas sin `disconnect` | `js/notas/notas-tinta.js:549, 562` | B (memoria en listas largas; el observador se libera con el nodo) | B | D | Recomendado, baja prioridad |
| 11 | Latido de 1 s que pinta 1 px para mantener vivo el stream del PiP de nota | `js/notas/notas-flotante.js:578` | B (solo con PiP abierto) | — | D | Aceptado: es necesario |
| 12 | Reintento cada 500 ms (máx. 40 veces) al arrancar para restaurar notas flotantes | `js/notas/notas.js:805` | B | B | D | Aceptado |
| 13 | 50 llamadas a `localStorage.setItem` en `js/`: no revisé una por una cuáles son síncronas en caliente | `js/` (grep) | por confirmar | M | Otra | No verificado |

### Revisado y sin hallazgo
- Timer de estudio: el tiempo sale de marcas (`inicioFase` vs `Date.now()`), no de contar ticks, y hay alarma `setTimeout` aparte para segundo plano (`tiempo-estudio-timer.js:607, 650`).
- Intervalos de 60 s de Agenda y Horario: se limpian al re-renderizar o solo corren con la sección visible (`js/agenda/agenda.js:1025`, `js/horario/horario.js:2463`); avisos globales saltan con pestaña oculta (`js/core/analitica.js:262`).
- Tinta de Notas: `cajaTrazo` está cacheada por trazo (`notas-tinta.js:123-135`), así que el repintado por scroll no recorre todos los puntos.
- Editor de Notas: `cerrarEditor` retira todos sus listeners de `window`/`document` y desconecta sus observadores (`notas-editor.js:221-238`).
- Service Worker: cascarón mínimo de ~20 archivos y el resto se cachea al primer uso (`service-worker.js:60-83`).
- Capa de tinta vacía: a partir de D1 se oculta (`visibility:hidden`) y ya no usa `desynchronized` por defecto.

## 2. Qué se aplica y qué queda recomendado
- **Aplicado (zona D):** D4 = contraparte Optimizado para las 4 capas con blur de Notas.
- **Recomendado, fuera de mi zona (para A/B/C/otra):** hallazgos 2, 3, 4, 5, 6, 7, 8, 9, 13.
- **Recomendado, dentro de D, baja prioridad:** 10 (límite de píxeles de la mini-tinta y desconexión del observador).

## 3. Presupuestos sugeridos (a calibrar con la primera medición)
| Métrica (360×780, CPU 6×, Slow 4G) | Presupuesto |
|---|---|
| LCP del arranque | ≤ 2,5 s |
| INP al abrir/cerrar overlays y editor de Notas | ≤ 200 ms |
| Tareas largas (>50 ms) al abrir una sección | ≤ 2 |
| CPU en reposo, sin timer activo | ≈ 0 % salvo sondeos |
| CPU en reposo, con timer activo | ≤ 3 % |
| `backdrop-filter` activos con `data-rendimiento="reducido"` | 0 |
| Transferencia JS del primer arranque (gzip) | a fijar tras medir; objetivo de bajar |

## 4. Procedimiento de medición (quien integra)
Usar siempre datos de prueba o una cuenta de fixtures, **nunca los datos reales de Drive**.
1. Chromium, DevTools → modo dispositivo 360×780; Performance → CPU **6× slowdown**; Network → **Slow 4G**; Lighthouse en modo móvil.
2. Arranque: Lighthouse móvil (3 corridas, mediana) y panel Network (cuántos módulos JS en cascada, tiempo hasta el último).
3. Capas con blur: panel Performance, grabar 5 s abriendo/cerrando el overlay de compartir y el de stickers, con `data-rendimiento="normal"` y luego `"reducido"` (se cambia en Ajustes → Optimizado). Anotar ms de Paint + Composite por frame.
4. Batería (proxy): panel Performance con la sección en reposo 30 s, una vez sin timer activo y otra con timer activo; anotar % de CPU y número de timers (pestaña Memory/Performance Monitor).
5. Repetir cada medición antes y después de cada parche de optimización.

### Tabla «antes / después» (rellenar)
| Medición | Antes | Después | Parche |
|---|---|---|---|
| Lighthouse móvil: LCP | | | |
| Lighthouse móvil: TBT | | | |
| Módulos JS en cascada al arrancar | | | |
| Frame (Paint+Composite) al abrir overlay de compartir, normal | | | D4 |
| Frame (Paint+Composite) al abrir overlay de compartir, Optimizado | | | D4 |
| CPU reposo sin timer (%) | | | |
| CPU reposo con timer (%) | | | |
| Timers activos en reposo | | | |