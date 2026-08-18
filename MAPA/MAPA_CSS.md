# MAPA_CSS.md — Índice de `css/design-system.css`

> Adaptación del formato de `MAPA_FUNCIONES.md` a CSS: en vez de funciones se listan las **variables (custom properties)** y las **clases de componente reutilizables** que otros archivos (HTML/JS) consumen. No se documentan reglas de un solo uso ni ajustes puntuales de layout — esas quedan "internas" del archivo, igual que una función privada de un `.js`.

---

## css/design-system.css (3590 líneas)
Propósito: sistema de diseño único de la app — base glassmorphism (tarjetas translúcidas + blur), botones, pills, badges, switches, modales, y estilos específicos de cada sección (Plan de Estudios, Agenda, Horario, paleta personalizada, etc.). Soporta 13 paletas de color × 2 modos (claro/oscuro) vía atributos en `<html>`.
Depende de: nada (CSS puro, sin imports). Se referencia desde `index.html` y `amigos.html`.

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
| 870 | Paletas — los 26 bloques `[data-palette][data-mode]` |
| 1106 | Layout de la app (shell + sidebar), responsivo real |
| 1406 | Breakpoint < 900px — sidebar pasa a drawer superior |
| 1507 | Vista del Plan de Estudios (Iteración 1, Parte 2) |
| 2175 | Agenda |
| 2509 | Vista de Mapa interactivo del Plan de Estudios (B.3) |
| 2927 | Modo de Rendimiento (`[data-rendimiento="reducido"]`) |
| 3012 | Panel "Crear mi paleta" (paleta personalizada) |
| 3236 | Degradado configurable dentro de "Crear mi paleta" |
| 3500 | Horario — núcleo |

---

## Patrones transversales (CSS)
- Nunca hardcodear un color en hex fuera de los bloques de paleta — todo color visible debe salir de una variable (`var(--accent-1)`, etc.) para que las 13 paletas × 2 modos lo hereden automáticamente.
- Visibilidad se maneja con la clase `.oculto`, no con `style.display` inline, salvo casos puntuales ya documentados en el propio CSS.
- Cualquier elemento animado (transform/box-shadow/backdrop-filter) debe tener su contraparte apagada bajo `[data-rendimiento="reducido"]` si se agrega a una sección nueva, siguiendo el mismo criterio ya aplicado al resto del sistema.
- El archivo crece por bloques con separador `/* ===== ... ===== */` fechados o versionados (v8.3, v1.14.1, etc.) — al agregar una sección nueva grande, seguir ese mismo patrón de encabezado para que seas rastreable en este índice.
