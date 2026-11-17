# MAPA_CSS.md — Índice de `css/design-system.css`
v3.28.0 - Parche A3 - Tarjetas tocables de Finanzas: .fin-tarjeta-tocable, .fin-chevron y aviso de .fin-sin-asignar negativo, con foco visible y estados hover.
v3.28.0 - Parche C2 - Timer plegado: design-system.css aplica el color de la materia al círculo plegado (44 px), con tinte, aro y modo Optimizado sin blur/sombra.
v3.28.0 - Parche C6 - Avisos del timer: design-system.css añade animaciones Onda y píldora de descanso, con soporte para rendimiento y movimiento reducidos.
v3.28.0 - Parche D1 - Estilos de Notas (en `js/notas/notas-estilos.js`): canvas de tinta transparente; .nt-tinta-vacia oculta el lienzo sin trazos; el editor declara color-scheme claro u oscuro según data-mode.
v3.28.0 - Parche D4 - Estilos de Notas (en `js/notas/notas-estilos.js`): en Optimizado, las capas de cierre, compartir y stickers usan fondo opaco sin desenfoque; modo normal sin cambios.

## Notas rápidas (actualizado 2026-11-07)

`design-system.css` incorpora `notas-grid`/`notas-lista`, tarjetas tipo post-it con vista expandible, barra de selección, editor modal adaptable, paleta, estados de pin/arrastre, filtros y aviso de contenido compartido. El fondo de cada tarjeta proviene del color de nota y el JS calcula texto claro u oscuro para mantener contraste.

Cambios del 2026-11-06/07: la lista de materias de Semestres sangra 16 px por lado en móvil; el mini-timer del encabezado no recibe un fondo teñido en Modo Optimizado; los chips de categorías del Plan usan flex-wrap centrado y los botones del encabezado/selector de orden comparten altura; el caret general se oculta salvo en campos editables. El PiP de Android se dibuja en canvas en `tiempo-estudio-indicador.js`, no como tarjeta CSS. Finanzas conserva tres favoritos con el «＋» centrado en todos los anchos de su barra móvil.

Cambios v3.28.0 B: los Enlaces rápidos adoptan el tratamiento de navegación sin borde y toda la fila abre su enlace; los encabezados usan `--bg-encabezado` oscuro; el menú lateral se expande como capa por pulsación larga; los botones del Plan quedan en 36 px; el drawer de Enlaces reutiliza la expansión y se corrigen los clics lentos.

> Adaptación del formato de `MAPA_FUNCIONES.md` a CSS: en vez de funciones se listan las **variables (custom properties)** y las **clases de componente reutilizables** que otros archivos (HTML/JS) consumen. No se documentan reglas de un solo uso ni ajustes puntuales de layout — esas quedan "internas" del archivo, igual que una función privada de un `.js`.

---

## css/design-system.css (7555 líneas al 2026-11-07)
Propósito: sistema de diseño único de la app — base glassmorphism (tarjetas translúcidas + blur), botones, pills, badges, switches, modales, y estilos específicos de cada sección (Plan de Estudios, Agenda, Horario, paleta personalizada, etc.). Soporta 13 paletas de color × 2 modos (claro/oscuro) vía atributos en `<html>`.
Depende de: nada (CSS puro, sin imports). Se referencia desde `index.html` y `amigos.html`.

Componente añadido 2026-10-18: `.wapper-cola-bienvenida` anima la entrada del modal offline con una transición breve; desactiva la animación cuando el usuario prefiere movimiento reducido o usa el modo de rendimiento reducido.

### Sistema de theming (clave para conectar cualquier color nuevo)
Activado con atributos en `<html>`: `data-palette="azul|verde|rojo|gris|negro|blanco|cyan|morado|rosado|indigo|amarillo|dorado|azucarado"` + `data-mode="dark|light"`. Cada combinación (26 bloques `[data-palette="x"][data-mode="y"]`) redefine el mismo set fijo de variables:

* `--bg-canvas` — fondo general de la página.
* `--bg-card` / `--bg-panel` — fondos de `.glass-card` / `.glass-panel`.
* `--bg-header-solido` — fondo sólido de headers sticky.
* `--border-glass` — borde translúcido estándar.
* `--text-primary` / `--text-secondary` / `--text-muted` — jerarquía tipográfica.
* `--accent-1` / `--accent-2` — colores de acento primario/secundario, `--gradient-accent` combina ambos.
* `--accent-glow-1` / `--accent-glow-2` — glows de fondo (radial-gradient del body).
* `--accent-1-10` / `--accent-1-20` — variantes de opacidad del acento (10%/20%) para fondos resaltados.
* `--color-danger` — color de error/peligro por paleta (contraste ajustado por paleta).
* `--on-accent` — color de texto sobre fondo de acento (siempre blanco en las paletas actuales).

Variables globales fijas (no dependen de paleta, definidas en `:root`): `--radius-sm/md/lg/pill`, `--font-display` (Sora), `--font-body` (Inter), `--shadow-glass`, `--shadow-float`, `--transition-fast` (0.18s), `--transition-med` (0.28s).

Otros atributos de `<html>` que el CSS lee: `data-rendimiento="reducido"` (Modo de Rendimiento — apaga blur/sombras/transiciones animadas en equipos con GPU integrada; la estética de color/forma/tamaño no cambia).

### Clases de componente reutilizables (usables desde cualquier módulo nuevo)
* `.glass-card` — tarjeta principal (blur 16px, sombra, padding 24px). Base de casi todos los modales y paneles.
* `.glass-panel` — panel secundario más liviano (blur 10px, sin padding fijo). Base del sidebar y contenedores de grid.
* `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-danger`, `.btn-block` — sistema de botones. `.btn-primary` usa `--gradient-accent`.
* `.modal-overlay`, `.modal-card` — patrón estándar de modal (usado en los ~25 `#modal-*` de `index.html`).
* `.form-input`, `.form-label` — inputs y labels de formulario.
* `.badge`, `.badge-success`, `.badge-danger`, `.badge-accent` — chips de estado (ej. indicador de sync).
* `.pill-item`, `.pill-group` — selectores tipo píldora (días, filtros).
* `.stack`, `.row`, `.row-between` — utilidades de layout flex (columna / fila / fila con espacio entre extremos).
* `.oculto` — utilidad de visibilidad (`display: none !important`), el mecanismo estándar de show/hide de toda la app en vez de manipular `style.display` directo.
* `.switch`, `.switch-tema` — toggles tipo interruptor.
* `.btn-icono-fantasma`, `.btn-topbar-icono` — botones "fantasma" sin fondo/borde, solo el ícono/emoji.
* `.handle-mover`, `.arrastrando`, `.arrastre-placeholder` — motor compartido de drag-and-drop (Fase 8: criterios/asignaciones del Plan y switches de navegación reordenables en Ajustes reusan el mismo trío de clases).

### Secciones del archivo (por bloque, línea aproximada de inicio)
| Línea | Sección |
|---|---|
| 1 | Base del sistema (`:root`, reset, tipografía, `.glass-card`/`.glass-panel`/`.btn`) |
| 1136 | Paletas — los 26 bloques `[data-palette][data-mode]` |
| 1504 | Navegación y sidebar |
| 1869 | Breakpoint < 900px — sidebar pasa a drawer móvil |
| 1999 | Vista del Plan de Estudios |
| 2867 | Agenda |
| 3631 | Vista de Mapa interactivo del Plan de Estudios |
| 3682 | Finanzas: pestañas y accesos responsivos |
| 4253 | Crear mi paleta: selección de paleta base |
| 4444 | Panel de personalización de paleta |
| 4977 | Tiempo de Estudio |
| 6163 | Notas rápidas |
| 6521 | Encabezados compartidos de Agenda, Horario y Tiempo |
| 7320 | Animación del drawer móvil y overlay |
| 7345 | Animación del drawer de Enlaces y timer flotante |
| 7373 | Expansión del menú lateral por pulsación larga |

---

## Patrones transversales (CSS)
- Nunca hardcodear un color en hex fuera de los bloques de paleta — todo color visible debe salir de una variable (`var(--accent-1)`, etc.) para que las 13 paletas × 2 modos lo hereden automáticamente.
- Visibilidad se maneja con la clase `.oculto`, no con `style.display` inline, salvo casos puntuales ya documentados en el propio CSS.
- Cualquier elemento animado (transform/box-shadow/backdrop-filter) debe tener su contraparte apagada bajo `[data-rendimiento="reducido"]` si se agrega a una sección nueva, siguiendo el mismo criterio ya aplicado al resto del sistema.
- El archivo crece por bloques con separador `/* ===== ... ===== */` fechados o versionados (v8.3, v1.14.1, etc.) — al agregar una sección nueva grande, seguir ese mismo patrón de encabezado para que seas rastreable en este índice.

Cambio 2026-11-13: la barra superior móvil (`.mobile-topbar`, <900px) mide lo mismo en todas las secciones: el alto de la barra de Horario/Agenda/Tiempo (82.5 px con letra mediana), por la variable `--enc-alto-barra-movil` (`calc(27.3px + 3.45rem)`, bloque final de `css/design-system.css`). La vista extendida (≥900px) no cambia.

Cambio 2026-11-13 (Comunidad angosta): en <900px la barra superior muestra «Comunidad» + conteos (sin el logo «Wapper»), el encabezado de la página se oculta, ⋮ va junto al switch Profesores/Compañeros y «+» es un botón flotante abajo a la derecha (como Notas). Bloque final de `css/design-system.css`; `comunidad` se agregó a `SECCIONES_CON_CTX` en `js/ui/topbar-contexto.js`. La vista extendida no cambia.

Cambio 2026-11-13 (Horario angosto): «+» de la barra inferior sin resplandor; botón de descarga de 34px separado 6px del borde (sobresale sobre la columna del primer día; en `horario.js` el espaciador de 28px alinea a la izquierda); esquinas inferiores de la barra superior rellenas con `--bg-header-solido` (`.mobile-topbar::before`). Bloque final de `css/design-system.css`.

Cambio 2026-11-13 (alineación de la barra superior móvil): ◀ (`.te-det-volver`) y ⋮ (`.agenda-btn-ajustes`, `.te-det-config` dentro de `.mobile-topbar`) se dibujan con CSS (puntos/triángulo centrados en su caja) en vez de caracteres, para que queden al mismo nivel que ☰ y 🔗 sin depender de la tipografía. Bloque final de `css/design-system.css`.

Cambio 2026-11-13 (Finanzas angosta): en <900px la barra superior muestra título + subtítulo de la pantalla de Finanzas activa en vez del logo «Wapper» (`finanzas` en `SECCIONES_CON_CTX`, publicado desde `construirEncabezadoFinanzas`), el encabezado de la página se oculta y el ojo de «Ocultar importes» pasa a la esquina superior derecha de la primera tarjeta de Inicio (`.finanzas-ojo--tarjeta`). Movimientos ya no tiene fila propia de título + «Añadir movimiento». Bloque final de `css/design-system.css`.
