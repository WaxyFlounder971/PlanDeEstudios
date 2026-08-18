## JS — UI

### componentes.js
Propósito: Componentes de UI reutilizables en toda la app — modal de confirmación genérico, toasts, long-press, flechas de scroll horizontal, layout responsivo del sidebar/drawer, selector de modalidad de horario.
Depende de: main.js, core/schema.js
Exporta:

* `CLAVE_SIDEBAR_COLAPSADA` — clave de localStorage donde se guarda si el sidebar está colapsado.
* `abrirConfirmacion({titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar})` — abre el modal de confirmación reutilizable.
* `abrirDrawerEnlacesMovil()` — abre el drawer móvil de Enlaces rápidos con su propio overlay y bloquea el scroll de fondo.
* `agregarLongPress(el, callback, duracionMs=500)` — ejecuta `callback` al mantener presionado (~500ms) o hacer clic derecho sobre un elemento.
* `callbackConfirmacionActual` — referencia al callback pendiente del modal de confirmación actualmente abierto.
* `cerrarConfirmacion()` — cierra el modal de confirmación y limpia el callback pendiente.
* `cerrarDrawerEnlacesMovil()` — cierra el drawer móvil de Enlaces rápidos.
* `cerrarSidebarMovil()` — cierra el sidebar principal en vista móvil.
* `construirSelectorModalidad(valorInicial, onCambiar)` — arma el selector de modalidad de horario; devuelve `{ elemento, obtenerValor() }`.
* `desplazarYResaltarElemento(selector, intentosRestantes=15)` — hace scroll hasta un elemento y lo resalta, reintentando varios frames si aún no existe en el DOM.
* `envolverConFlechasScroll(elementoScroll)` — agrega flechas de scroll horizontal que solo aparecen cuando el contenido desborda el ancho disponible.
* `inicializarAutoScrollSelectoresEnModales()` — activa el auto-scroll hacia el ítem activo dentro de selectores ubicados en modales.
* `inicializarBotonesCerrarModal()` — engancha los botones "X" de cierre de modales, reutilizando los listeners de "clic afuera cierra" ya existentes.
* `inicializarLayoutResponsivo()` — configura el comportamiento responsivo del sidebar/drawer según el tamaño de pantalla.
* `inicializarModalConfirmacion()` — engancha los listeners del modal de confirmación (botón, clic afuera).
* `inicializarNavegacionBotonesMouse()` — habilita la navegación con los botones de mouse (adelante/atrás) respetando el orden/visibilidad configurados en Ajustes.
* `mostrarToast(mensaje, duracionMs=2400)` — muestra un toast temporal.
* `mostrarToastAccion(mensaje, textoBoton, alConfirmar)` — muestra un toast persistente con un botón de acción, para avisos que requieren confirmación del usuario en vez de desvanecerse solos.
* `restaurarEstadoSidebar()` — restaura el estado colapsado/expandido del sidebar guardado en localStorage.

### paleta-personalizada.js
Propósito: Flujo para crear una paleta de colores personalizada ("Crear mi paleta", 15ª opción del selector de paletas), generado 100% por JS (overlay + modal).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, ui/tema.js
Exporta:

* `iniciarFlujoPaletaPersonalizada({alGuardar}?)` — punto de entrada llamado desde config-ajustes.js; abre el overlay del flujo de creación de paleta. `alGuardar` es un callback (típicamente `renderizarAjustes`) para refrescar el grid de paletas al terminar.

### tema.js
Propósito: Aplicación de paletas y modo claro/oscuro sobre `<html>`, más utilidades puras de color (conversión, mezcla, derivación de variables CSS) usadas tanto por el tema fijo como por la paleta personalizada.
Depende de: (ninguno — funciones puras + DOM/localStorage)
Exporta:

* `COLORES_PREVIEW_PALETA` — mapa paleta → colores reales, para pintar cada cuadro del selector con su propio color sin depender de la paleta activa.
* `FONDO_PREVIEW_AZUCARADO` — degradado CSS de manchas de color usado como preview de la paleta "azucarado".
* `TEXTO_PREVIEW_PALETA` — mapa paleta → color de texto legible sobre su degradado (ej. "blanco" necesita texto oscuro).
* `aplicarPaleta(paleta, modo, coloresPersonalizados?)` — setea `data-palette`/`data-mode` en `<html>`, persiste en localStorage y aplica o limpia los colores personalizados inline.
* `aplicarTemaGuardadoLocalmente()` — aplica al arranque la paleta/modo guardados en localStorage (incluye colores personalizados si corresponde).
* `actualizarThemeColorMeta()` — sincroniza `<meta name="theme-color">` con `--bg-header-solido` de la paleta activa, para que la barra del sistema combine en PWA.
* `hexARgb(hex)` — convierte un color hex a `{r,g,b}`.
* `colorARgb(color)` — convierte hex o `rgb()`/`rgba()` a `{r,g,b}`, ignorando el canal alfa.
* `colorARgba(color)` — igual que `colorARgb` pero conservando el canal alfa real (`{r,g,b,a}`).
* `compositarSobreFondo(colorConAlpha, colorFondoHex)` — compone un color translúcido sobre un fondo dado y devuelve el hex sólido visualmente equivalente.
* `rgbAHex(r, g, b)` — convierte `{r,g,b}` a hex de 6 dígitos.
* `colorAHex(color)` — convierte cualquier color (hex o rgba string) a hex sólido de 6 dígitos.
* `rgbAHsl(r, g, b)` — convierte `{r,g,b}` a `{h,s,l}`.
* `hexAHsl(hex)` — convierte hex a `{h,s,l}`.
* `hslARgb(h, s, l)` — convierte `{h,s,l}` a `{r,g,b}`.
* `hslAHex(h, s, l)` — convierte `{h,s,l}` a hex.
* `mezclarHex(colorA, colorB, factor)` — mezcla lineal entre dos colores hex (factor 0 = colorA puro, 1 = colorB puro).
* `hexARgba(color, alpha)` — convierte un color a string `rgba(...)` con la opacidad indicada.
* `luminanciaRelativa(color)` — calcula la luminancia relativa (WCAG) de un color.
* `esColorClaro(color)` — indica si un color es "claro" según su luminancia relativa (>0.5).
* `calcularGradientesAcento({accent1, accent2, degradado})` — genera las 3 variantes de gradiente de acento (`--gradient-accent`/`-alt`/`-alt2`) según los colores base y el degradado configurado.
* `calcularVariablesDerivadas(colores)` — a partir de los 6 colores elegidos por el usuario, calcula todas las variables CSS derivadas que necesita una paleta (texto, paneles, glows, badges, etc.).
* `aplicarColoresPersonalizadosInline(colores)` — aplica las variables derivadas como estilos inline sobre `:root` (mayor prioridad que las reglas `[data-palette]`).
* `limpiarColoresPersonalizadosInline()` — remueve todas las variables CSS inline de la paleta personalizada, para volver limpio a una paleta fija.
