/* =========================================================================
   UI — CREAR MI PALETA (v1.13)
   Panel para construir una paleta de colores propia (15ª opción del selector
   de paletas). Se genera 100% por JS (overlay + modal) porque index.html no
   forma parte de los archivos que se tocaron en esta iteración — así no hace
   falta ninguna marca nueva en el HTML para que esto funcione.
   ========================================================================= */

import { PALETAS_DISPONIBLES, sellarTimestamp } from "../core/schema.js";
import { actualizarIndicadorSync, marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import {
  COLORES_PREVIEW_PALETA,
  FONDO_PREVIEW_AZUCARADO,
  aplicarPaleta,
  calcularVariablesDerivadas,
  colorAHex,
  compositarSobreFondo,
  hexAHsl,
  hslAHex,
  mezclarHex,
} from "./tema.js";

/* ------------------------------ Construcción de UI ------------------------------ */

/**
 * BUG FIX v1.15.3 (bug 4): antes cada campo eran 2 sliders (tono +
 * claridad) con la saturación fijada UNA vez al abrir el editor — eso
 * dejaba colores enteros fuera de alcance (blancos/negros/grises puros,
 * o cualquier saturación distinta a la del color inicial). Se reemplaza
 * por un selector de color nativo (mismo control que ya se usa para el
 * degradado): acceso a cualquier color, sin restricciones ni superficie
 * nueva que mantener.
 *
 * `onCambio(hex)` se dispara con el color resultante ya en hex.
 */
function crearGrupoColor({ etiqueta, hexInicial, onCambio }) {
  const wrap = document.createElement("div");
  wrap.className = "ppz-grupo";

  const label = document.createElement("label");
  label.className = "ppz-grupo-label";
  label.textContent = etiqueta;
  wrap.appendChild(label);

  const fila = document.createElement("div");
  fila.className = "ppz-fila-slider";

  const swatch = document.createElement("div");
  swatch.className = "ppz-swatch-vivo";
  swatch.style.background = hexInicial;

  const input = document.createElement("input");
  input.type = "color";
  input.className = "ppz-color-nativo";
  input.value = colorAHex(hexInicial);
  input.addEventListener("input", () => {
    swatch.style.background = input.value;
    onCambio(input.value);
  });

  fila.appendChild(swatch);
  fila.appendChild(input);
  wrap.appendChild(fila);

  return { elemento: wrap };
}

/* ------------------------------ v1.15 (Parte 2): Degradado configurable ------------------------------ */

/** Switch reutilizable, mismo markup/clases que ya usa el resto de la app
 *  (config-ajustes.js) para que este toggle se vea idéntico a cualquier
 *  otro switch del sistema — nada nuevo que mantener en el CSS. */
function crearSwitch({ activo, onCambio }) {
  const label = document.createElement("label");
  label.className = "switch";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = !!activo;

  const track = document.createElement("span");
  track.className = "track";
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  track.appendChild(thumb);

  input.addEventListener("change", () => onCambio(input.checked));

  label.appendChild(input);
  label.appendChild(track);
  return label;
}

/** Slider de intensidad (0-100): reutiliza .ppz-slider pero con su propio
 *  degradado de fondo (negro→color→blanco no aplica acá — el fondo de esta
 *  barra se pinta con los 3 colores reales del degradado, así el usuario ve
 *  de una vez dónde va a caer el color del medio). */
function crearBarraIntensidad({ valor, onCambio }) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "100";
  input.step = "1";
  input.value = String(Math.round(valor));
  input.className = "ppz-slider ppz-slider-intensidad";
  input.addEventListener("input", () => onCambio(Number(input.value)));
  return input;
}

function pintarFondoIntensidad(input, { accent1, color }) {
  // v1.15.8 (pedido explícito): abajo (0%) va el color de "Detalles"
  // (accent1) tal cual, sin mezclar con accent2 — y arriba (100%) el color
  // del degradado elegido, puro. Antes iba una mezcla accent1/accent2 como
  // "neutro" abajo; ahora la barra muestra directamente los 2 colores
  // reales entre los que se mueve el degradado, para que sea obvio de un
  // vistazo qué representa cada extremo.
  input.style.background = `linear-gradient(to top, ${accent1}, ${color})`;
  // Mismo mecanismo que pintarColorAguja en la rueda: el thumb del slider
  // se tiñe con el color elegido del degradado, para que ambos controles
  // se sientan parte de un mismo lenguaje visual en vez de un slider
  // genérico del navegador.
  input.style.setProperty("--ppz-intensidad-thumb", color);
}

/**
 * Rueda de ángulo (0-360°) con arrastre libre y snapping suave cada 5°, más
 * flechas de teclado para accesibilidad. `onCambio(angulo)` se dispara con
 * el valor ya snapeado. La aguja se pinta con el color del degradado para
 * que la rueda misma se sienta parte de la vista previa, no un control
 * aparte.
 */
function crearRuedaAngulo({ valorInicial, onCambio }) {
  const SNAP = 5;
  let angulo = ((Number(valorInicial) || 0) % 360 + 360) % 360;

  const contenedor = document.createElement("div");
  contenedor.className = "ppz-rueda-wrap";

  const rueda = document.createElement("div");
  rueda.className = "ppz-rueda";
  rueda.tabIndex = 0;
  rueda.setAttribute("role", "slider");
  rueda.setAttribute("aria-label", "Ángulo del degradado");
  rueda.setAttribute("aria-valuemin", "0");
  rueda.setAttribute("aria-valuemax", "360");

  const aguja = document.createElement("div");
  aguja.className = "ppz-rueda-aguja";
  const perilla = document.createElement("div");
  perilla.className = "ppz-rueda-perilla";
  aguja.appendChild(perilla);
  rueda.appendChild(aguja);
  const lectura = document.createElement("span");
  lectura.className = "ppz-rueda-lectura";
  // v1.15.8 (pedido: "grados e intensidad en la misma línea, no grados
  // abajo e intensidad arriba"): antes esta lectura se agregaba DESPUÉS de
  // `rueda` (quedaba debajo del círculo), mientras que la etiqueta
  // "Intensidad" del control vecino va ARRIBA de su barra — así quedaban
  // a distinta altura. Ahora se agrega ANTES, para que ambas etiquetas
  // queden en la misma línea superior.
  contenedor.appendChild(lectura);
  contenedor.appendChild(rueda);

  const actualizarVisual = () => {
    aguja.style.transform = `rotate(${angulo}deg)`;
    lectura.textContent = `${Math.round(angulo)}°`;
    rueda.setAttribute("aria-valuenow", String(Math.round(angulo)));
  };

  const fijarAngulo = (nuevo) => {
    angulo = ((Math.round(nuevo / SNAP) * SNAP) % 360 + 360) % 360;
    actualizarVisual();
    onCambio(angulo);
  };

  // Convención CSS: 0deg apunta hacia arriba y el ángulo crece en sentido
  // horario (90deg = derecha) — atan2(dx, -dy) replica exactamente eso.
  const anguloDesdeEvento = (ev) => {
    const rect = rueda.getBoundingClientRect();
    const dx = ev.clientX - (rect.left + rect.width / 2);
    const dy = ev.clientY - (rect.top + rect.height / 2);
    let deg = Math.atan2(dx, -dy) * (180 / Math.PI);
    if (deg < 0) deg += 360;
    return deg;
  };

  let arrastrando = false;
  rueda.addEventListener("pointerdown", (ev) => {
    arrastrando = true;
    rueda.setPointerCapture(ev.pointerId);
    fijarAngulo(anguloDesdeEvento(ev));
  });
  rueda.addEventListener("pointermove", (ev) => {
    if (arrastrando) fijarAngulo(anguloDesdeEvento(ev));
  });
  const soltar = () => { arrastrando = false; };
  rueda.addEventListener("pointerup", soltar);
  rueda.addEventListener("pointercancel", soltar);
  rueda.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
      fijarAngulo(angulo + SNAP);
      ev.preventDefault();
    } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
      fijarAngulo(angulo - SNAP);
      ev.preventDefault();
    }
  });

  actualizarVisual();
  return {
    elemento: contenedor,
    pintarColorAguja: (colorCss) => aguja.style.setProperty("--ppz-rueda-color", colorCss),
  };
}

/**
 * v1.15.6 (pedido: "el botón de degradado debe estar DEBAJO de todas las
 * paletas, justo debajo de Borde y justo arriba de vista previa, para que
 * el color nuevo coincida en el lugar que queda disponible"): la sección
 * vuelve a ser UN SOLO bloque, a ancho completo, fuera de las 2 columnas —
 * ya no se reparte el toggle en la columna 2 y el resto abajo. Devuelve
 * `elemento` único que abrirPanelDeEdicion agrega debajo de `.ppz-campos-
 * columnas` y arriba de la vista previa.
 *
 * BUG FIX v1.15.6 (rueda/intensidad dejaban de verse al activar): la
 * versión anterior tenía DOS elementos hermanos (`contenido` con
 * rueda+intensidad, y `campoColor` con el color) que había que ocultar/
 * mostrar por separado llamando dos veces `classList.toggle("oculto", …)`.
 * Cualquier desincronización entre esas dos llamadas (o un reflow a medio
 * camino) dejaba uno visible y el otro no. Ahora hay un solo contenedor
 * plegable (`cuerpo`) con el color + la rueda + la intensidad todos
 * adentro, y una única bandera de visibilidad — no hay forma de que unos
 * controles aparezcan y otros no.
 *
 * Muta `colores.degradado` in-place y llama `refrescarPreview()`/
 * `marcarTocado()` en cada cambio. `colores.degradado` ya debe venir
 * inicializado (ver abrirPanelDeEdicion).
 */
function crearSeccionDegradado({ colores, refrescarPreview, marcarTocado }) {
  const bloqueInferior = document.createElement("div");
  bloqueInferior.className = "ppz-degradado-bloque";

  const filaToggle = document.createElement("div");
  filaToggle.className = "ppz-degradado-toggle-fila";
  const label = document.createElement("label");
  label.className = "ppz-grupo-label";
  label.textContent = "Degradado";
  filaToggle.appendChild(label);

  const cuerpo = document.createElement("div");
  cuerpo.className = "ppz-degradado-contenido";

  const actualizarFondosVivos = () => {
    pintarFondoIntensidad(sliderIntensidad, {
      accent1: colores.accent1,
      accent2: colores.accent2,
      color: colores.degradado.color,
    });
    rueda.pintarColorAguja(colores.degradado.color);
  };

  // ---- Color libre del degradado — pedido: vive DENTRO de la columna 2
  // (mismo aspecto que Detalles/Luz, .ppz-grupo), no en el bloque de abajo.
  // El toggle y la rueda+intensidad sí se quedan abajo. ----
  const campoColor = document.createElement("div");
  campoColor.className = "ppz-grupo ppz-degradado-color-inline";
  const etiquetaColor = document.createElement("label");
  etiquetaColor.className = "ppz-grupo-label";
  etiquetaColor.textContent = "Color del degradado";
  const filaColor = document.createElement("div");
  filaColor.className = "ppz-fila-slider";
  const swatchColor = document.createElement("div");
  swatchColor.className = "ppz-swatch-vivo";
  swatchColor.style.background = colores.degradado.color;
  const inputColor = document.createElement("input");
  inputColor.type = "color";
  inputColor.className = "ppz-color-nativo";
  inputColor.value = colores.degradado.color;
  inputColor.addEventListener("input", () => {
    colores.degradado.color = inputColor.value;
    swatchColor.style.background = inputColor.value;
    actualizarFondosVivos();
    marcarTocado();
    refrescarPreview();
  });
  filaColor.appendChild(swatchColor);
  filaColor.appendChild(inputColor);
  campoColor.appendChild(etiquetaColor);
  campoColor.appendChild(filaColor);

  // ---- Ángulo (rueda circular) + Intensidad (barra vertical), agrupadas
  // juntas — se quedan en el bloque de ancho completo, no entran cómodas
  // en una columna angosta ----
  const controlesDerecha = document.createElement("div");
  controlesDerecha.className = "ppz-degradado-controles-derecha";

  const rueda = crearRuedaAngulo({
    valorInicial: colores.degradado.angulo,
    onCambio: (v) => {
      colores.degradado.angulo = v;
      marcarTocado();
      refrescarPreview();
    },
  });

  const colIntensidad = document.createElement("div");
  colIntensidad.className = "ppz-intensidad-vertical-wrap";
  const etiquetaIntensidad = document.createElement("label");
  etiquetaIntensidad.className = "ppz-grupo-label ppz-subetiqueta";
  etiquetaIntensidad.textContent = "Intensidad";
  const sliderIntensidad = crearBarraIntensidad({
    valor: colores.degradado.intensidad,
    onCambio: (v) => {
      colores.degradado.intensidad = v;
      marcarTocado();
      refrescarPreview();
    },
  });
  sliderIntensidad.classList.add("ppz-slider-vertical");
  const pistaVertical = document.createElement("div");
  pistaVertical.className = "ppz-intensidad-vertical-pista";
  pistaVertical.appendChild(sliderIntensidad);
  colIntensidad.appendChild(etiquetaIntensidad);
  colIntensidad.appendChild(pistaVertical);

  controlesDerecha.appendChild(rueda.elemento);
  controlesDerecha.appendChild(colIntensidad);

  // Cuerpo plegable de abajo: solo rueda + intensidad (el color ya no vive
  // acá, ver campoColor arriba).
  cuerpo.appendChild(controlesDerecha);
  actualizarFondosVivos();

  // Sigue siendo UNA sola función la que decide visibilidad — toca 2
  // elementos (cuerpo abajo + campoColor en la columna 2), pero desde el
  // mismo lugar y en el mismo tick, así nunca quedan desincronizados.
  const sincronizarVisibilidad = () => {
    const oculto = !colores.degradado.activo;
    cuerpo.classList.toggle("oculto", oculto);
    campoColor.classList.toggle("oculto", oculto);
  };
  sincronizarVisibilidad();

  const toggle = crearSwitch({
    activo: colores.degradado.activo,
    onCambio: (activo) => {
      colores.degradado.activo = activo;
      sincronizarVisibilidad();
      marcarTocado();
      refrescarPreview();
    },
  });
  filaToggle.appendChild(toggle);
  bloqueInferior.appendChild(filaToggle);
  bloqueInferior.appendChild(cuerpo);

  return { colorElemento: campoColor, bloqueInferior, actualizarFondosVivos };
}

/* ------------------------------ Vista previa en vivo ------------------------------ */

/**
 * BUG FIX v1.15.3 (bug 3): la vista previa anterior era un solo
 * .glass-card — mostraba nada más el color de fondo de la tarjeta, sin
 * distinguirse de nada. Ahora son 2 capas, igual que en la app real: un
 * "lienzo" (representa el <body>, con el mismo glow radial de fondo) y una
 * tarjeta flotando encima (representa .glass-card) — así se ve de un
 * vistazo cuál es el fondo, cuál la tarjeta, el borde, los 3 tonos de
 * texto, el panel interno, el botón con el degradado y hasta el color de
 * alerta, todo en la misma vista previa.
 */
function crearVistaPrevia() {
  const contenedor = document.createElement("div");
  contenedor.className = "ppz-preview";
  contenedor.innerHTML = `
    <h3 class="ppz-preview-titulo">Vista previa</h3>
    <p class="ppz-preview-texto">Así se va a ver tu paleta en toda la app.</p>
    <div class="ppz-preview-lienzo">
      <div class="ppz-preview-card glass-card">
        <h4 class="ppz-preview-card-titulo">Tarjeta de ejemplo</h4>
        <p class="ppz-preview-card-texto">Texto secundario, para leer con calma.</p>
        <div class="ppz-preview-panel">Panel interno — texto muted</div>
        <div class="ppz-preview-fila">
          <button type="button" class="btn btn-primary ppz-preview-btn">Botón</button>
          <span class="ppz-preview-badge">Insignia</span>
        </div>
        <p class="ppz-preview-danger">Ejemplo de alerta</p>
      </div>
    </div>
  `;
  return contenedor;
}

function pintarVistaPrevia(contenedor, colores) {
  const lienzo = contenedor.querySelector(".ppz-preview-lienzo");
  const derivadas = calcularVariablesDerivadas(colores);
  // Las variables se setean en el lienzo (representa :root/body) y bajan
  // por herencia de custom properties a la tarjeta de adentro — mismo
  // mecanismo que usa la app real entre <html> y cualquier .glass-card.
  Object.entries(derivadas).forEach(([variable, valor]) => {
    lienzo.style.setProperty(variable, valor);
  });
}

/* ------------------------------ Paso 1: elegir paleta base ------------------------------ */

function crearSwatchBase(paleta, onClick) {
  const sw = document.createElement("div");
  sw.className = "palette-swatch ppz-swatch-base";
  sw.style.background = paleta === "azucarado"
    ? FONDO_PREVIEW_AZUCARADO
    : `linear-gradient(135deg, ${COLORES_PREVIEW_PALETA[paleta].join(", ")})`;
  sw.textContent = paleta;
  sw.addEventListener("click", () => onClick(paleta));
  return sw;
}

/**
 * Botón "Editar actual" — solo se crea si ya existe una paleta personalizada
 * guardada (ver abrirPasoElegirBase). Pedido explícito del usuario: al
 * entrar a este flujo, la opción de retomar la paleta que ya tenía debe
 * convivir en el MISMO paso 1 que las paletas base, no reemplazarlo ni
 * llevar a una pantalla aparte.
 */
function crearSwatchEditarActual(paletaPersonalizada, onClick) {
  const sw = document.createElement("div");
  sw.className = "palette-swatch ppz-swatch-base ppz-swatch-editar-actual";
  const colores = paletaPersonalizada.colores;
  sw.style.background = colores.degradado && colores.degradado.activo
    ? `linear-gradient(135deg, ${colores.accent1}, ${colores.degradado.color})`
    : `linear-gradient(135deg, ${colores.accent1}, ${colores.accent2})`;
  sw.textContent = "✏️ Editar actual";
  sw.addEventListener("click", () => onClick());
  return sw;
}

/** Lista completa de variables derivadas que cualquier paleta (fija o
 *  personalizada) necesita para verse completa. Se usa para snapshotear la
 *  paleta base tal cual (BUG FIX v1.15.4) y para limpiar overrides inline. */
const VARIABLES_DERIVADAS = [
  "--bg-canvas", "--bg-card", "--bg-panel", "--border-glass",
  "--text-primary", "--text-secondary", "--text-muted",
  "--accent-1", "--accent-2",
  "--gradient-accent", "--gradient-accent-alt", "--gradient-accent-alt2",
  "--on-accent", "--accent-glow-1", "--accent-glow-2",
  "--accent-1-10", "--accent-1-20", "--color-danger",
];

/**
 * Lee los valores REALES ya aplicados en :root para una paleta (los toma tal
 * cual están en design-system.css vía getComputedStyle) — así el punto de
 * partida de los 5 selectores siempre es fiel al CSS actual, sin duplicar la
 * tabla de colores acá en JS.
 *
 * BUG FIX v1.15.4: cada paleta fija afina a mano --text-primary, --gradient-
 * accent(-alt/-alt2), --bg-panel, los glow, etc. — NO son una fórmula sobre
 * accent1/accent2 (ej. azucarado: accent-1:#C599E8 pero gradient-accent usa
 * #F5A9D0/#B8A6F0, colores completamente distintos). La fórmula genérica de
 * calcularVariablesDerivadas() es una BUENA APROXIMACIÓN una vez el usuario
 * empieza a tocar colores, pero mientras no toque nada no hay razón para
 * aproximar: acá se guarda el snapshot COMPLETO y literal (`derivadosBase`)
 * para poder reproducir la paleta base sin un solo píxel de diferencia
 * hasta que el usuario decida cambiar algo.
 */
function leerColoresBaseDesdeCSS() {
  const estilos = getComputedStyle(document.documentElement);
  const leer = (variable) => estilos.getPropertyValue(variable).trim();
  const fondoCanvas = colorAHex(leer("--bg-canvas"));

  const derivadosBase = {};
  VARIABLES_DERIVADAS.forEach((variable) => {
    const valor = leer(variable);
    if (valor) derivadosBase[variable] = valor;
  });

  return {
    fondoCanvas,
    // FIX v1.15 (Parte 1): --bg-card y --border-glass son rgba() de baja
    // opacidad (glassmorphism) en casi todas las paletas. Leerlos con
    // colorAHex a secas tira el alfa y los vuelve sólidos/saturados —
    // compositarSobreFondo los pinta tal cual se ven de verdad sobre
    // --bg-canvas, así el punto de partida del editor es fiel al pixel.
    // (Esto sigue haciendo falta para los 5 selectores editables en sí;
    // derivadosBase de arriba guarda el rgba() ORIGINAL sin tocar, que es
    // aún más fiel cuando no hay edición.)
    fondoCard: compositarSobreFondo(leer("--bg-card"), fondoCanvas),
    borde: compositarSobreFondo(leer("--border-glass"), fondoCanvas),
    accent1: colorAHex(leer("--accent-1")),
    accent2: colorAHex(leer("--accent-2")),
    derivadosBase,
  };
}

/* ------------------------------ Panel principal ------------------------------ */

function construirOverlay() {
  const overlay = document.createElement("div");
  overlay.className = "ppz-overlay";
  const panel = document.createElement("div");
  panel.className = "ppz-panel glass-card";
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  // BUG FIX v1.15.3 (Parte 1): sin esto, arrastrar la rueda de ángulo o
  // simplemente scrollear el panel en móvil dejaba pasar el gesto al body
  // de fondo — al llegar arriba del todo, el navegador lo interpretaba
  // como "pull to refresh" y recargaba la página a mitad de la edición.
  // Mismo mecanismo que ya usa el drawer del sidebar (componentes.js).
  document.body.classList.add("scroll-bloqueado");
  return { overlay, panel };
}

function cerrarOverlay(overlay) {
  overlay.remove();
  document.body.classList.remove("scroll-bloqueado");
}

/** Restaura en pantalla la paleta que el usuario tenía guardada antes de
 *  entrar a este flujo (se usa al cancelar, y también entre el paso 1 y 2
 *  para no dejar la app pintada con una paleta de referencia a medias). */
function restaurarPaletaGuardada() {
  const cfg = estado.datos.configuracion;
  aplicarPaleta(cfg.paleta, cfg.modo, cfg.paleta_personalizada ? cfg.paleta_personalizada.colores : undefined);
}

/**
 * `coloresExistentes` (nuevo): cuando viene con datos (flujo "Editar
 * actual"), el panel arranca con ESOS colores en vez de leer la paleta
 * base desde el CSS — así lo que el usuario ya tenía nunca se borra ni se
 * reemplaza por la paleta de referencia. En ese caso `tocado` arranca en
 * `true` de entrada: si el usuario abre para editar y le da "Guardar" sin
 * tocar nada, debe conservar exactamente lo que ya tenía (nunca debe caer
 * en la rama de "no se tocó nada, usar la paleta fija tal cual" — eso
 * borraría justo lo que se quiere conservar). `paletaBase` sigue guardándose
 * como referencia informativa ("basada en"), no como fuente de los colores.
 */
function abrirPanelDeEdicion(overlay, panel, paletaBase, alGuardar, coloresExistentes) {
  panel.innerHTML = "";

  const editandoExistente = !!coloresExistentes;

  const titulo = document.createElement("h2");
  titulo.className = "ppz-titulo";
  titulo.textContent = editandoExistente ? "Editar mi paleta" : "Crear mi paleta";
  panel.appendChild(titulo);

  const subtitulo = document.createElement("p");
  subtitulo.className = "ppz-subtitulo";
  subtitulo.textContent = editandoExistente
    ? "Estás editando tu paleta guardada — los cambios se aplican sobre lo que ya tenías."
    : `Basada en "${paletaBase}" — ajustá lo que quieras, los colores de texto se calculan solos.`;
  panel.appendChild(subtitulo);

  const base = editandoExistente ? null : leerColoresBaseDesdeCSS();
  const colorLuzInicial = editandoExistente ? coloresExistentes.luz : base.accent2; // "si no existe todavía como propia, sepárala de --accent-2"
  // v1.15.9 (pedido: selector manual de "Fuente"): punto de partida del
  // color de texto. Para "Editar actual" sobre una paleta guardada ANTES
  // de que existiera este campo, coloresExistentes.fuente no existe — se
  // usa el --text-primary real que está aplicado en pantalla en este mismo
  // instante (la paleta vieja sigue activa mientras se abre el editor), así
  // no hay salto visual al abrir. Para paleta nueva, igual: el --text-
  // primary ya calculado de la paleta base de referencia.
  const colorFuenteInicial = editandoExistente
    ? coloresExistentes.fuente || colorAHex(getComputedStyle(document.documentElement).getPropertyValue("--text-primary"))
    : colorAHex(base.derivadosBase["--text-primary"] || getComputedStyle(document.documentElement).getPropertyValue("--text-primary"));

  // BUG FIX v1.15.4: `colores` guarda solo los 5 campos editables + luz +
  // degradado — NUNCA se le mezcla `base.derivadosBase` (eso se consulta
  // aparte, ver `tocado` más abajo), para no guardar basura en lo que se
  // persiste al final.
  // Editar actual: se clona coloresExistentes (incluido degradado) en vez
  // de leer la paleta base — así lo guardado antes queda intacto como
  // punto de partida real, no una aproximación desde CSS.
  const colores = editandoExistente
    ? {
        fondoCanvas: coloresExistentes.fondoCanvas,
        fondoCard: coloresExistentes.fondoCard,
        borde: coloresExistentes.borde,
        accent1: coloresExistentes.accent1,
        accent2: coloresExistentes.accent2,
        luz: colorLuzInicial,
        fuente: colorFuenteInicial,
        degradado: { ...coloresExistentes.degradado },
      }
    : {
        fondoCanvas: base.fondoCanvas,
        fondoCard: base.fondoCard,
        borde: base.borde,
        accent1: base.accent1,
        accent2: base.accent2,
        luz: colorLuzInicial,
        fuente: colorFuenteInicial,
        degradado: { activo: false, color: base.accent2, intensidad: 50, angulo: 90 },
      };

  // BUG FIX v1.15.4 (bug crítico — "se aplica 1 segundo y vuelve a blanco"):
  // cada paleta fija afina a mano text-primary, gradient-accent, el panel,
  // el glow, etc. — no son una fórmula sobre accent1/accent2. Mientras el
  // usuario no toque NADA, no hay razón para aproximar nada: se muestra y
  // se guarda la paleta base real, literal. En cuanto toca cualquier
  // control, `tocado` pasa a true y ahí sí entra la fórmula de siempre
  // (calcularVariablesDerivadas), que es una aproximación esperada y
  // aceptada una vez que el usuario está genuinamente personalizando.
  //
  // Editar actual: arranca en `true` directamente — no hay "paleta fija de
  // referencia" de la cual partir en este flujo, así que la rama de
  // "no tocado" (que reemplazaría todo por una paleta base) nunca debe
  // dispararse aquí; lo que ya existía se guarda tal cual si no se cambia
  // nada.
  let tocado = editandoExistente;
  const marcarTocado = () => { tocado = true; };

  const vistaPrevia = crearVistaPrevia();
  const lienzoPrevia = vistaPrevia.querySelector(".ppz-preview-lienzo");

  const refrescarPreview = () => {
    if (!tocado) {
      Object.entries(base.derivadosBase).forEach(([variable, valor]) => {
        lienzoPrevia.style.setProperty(variable, valor);
      });
    } else {
      pintarVistaPrevia(vistaPrevia, colores);
    }
  };

  const columnas = document.createElement("div");
  columnas.className = "ppz-campos-columnas";
  const columna1 = document.createElement("div");
  columna1.className = "ppz-columna";
  const columna2 = document.createElement("div");
  columna2.className = "ppz-columna";

  const gFondo = crearGrupoColor({
    etiqueta: "Fondo",
    hexInicial: colores.fondoCanvas,
    onCambio: (hex) => { colores.fondoCanvas = hex; marcarTocado(); refrescarPreview(); },
  });
  const gTarjetas = crearGrupoColor({
    etiqueta: "Tarjeta",
    hexInicial: colores.fondoCard,
    onCambio: (hex) => { colores.fondoCard = hex; marcarTocado(); refrescarPreview(); },
  });
  const gBorde = crearGrupoColor({
    etiqueta: "Borde",
    hexInicial: colores.borde,
    onCambio: (hex) => { colores.borde = hex; marcarTocado(); refrescarPreview(); },
  });
  // Un solo selector de "acento" controla accent-1 y accent-2 (los 2 extremos
  // del degradado): accent-2 se deriva del mismo tono, un poco más claro y
  // saturado, para que el degradado siga viéndose vivo con un solo control.
  const gAcento = crearGrupoColor({
    etiqueta: "Detalles",
    hexInicial: colores.accent1,
    onCambio: (hex) => {
      colores.accent1 = hex;
      const { h, s, l } = hexAHsl(hex);
      colores.accent2 = hslAHex(h, Math.min(100, s + 5), Math.min(90, l + 16));
      marcarTocado();
      seccionDegradado.actualizarFondosVivos();
      refrescarPreview();
    },
  });
  const gLuz = crearGrupoColor({
    etiqueta: "Luz",
    hexInicial: colorLuzInicial,
    onCambio: (hex) => { colores.luz = hex; marcarTocado(); refrescarPreview(); },
  });
  // v1.15.9 (pedido: "agregar en el menú de paleta para que la gente pueda
  // elegir el color de fuente"): selector manual del color de texto
  // principal de toda la app (--text-primary — ver calcularVariablesDerivadas
  // en tema.js, que ahora usa esto si viene definido, y si no cae al cálculo
  // automático de siempre para no romper las paletas fijas ni las
  // personalizadas creadas antes de que existiera este campo).
  const gFuente = crearGrupoColor({
    etiqueta: "Fuente",
    hexInicial: colores.fuente,
    onCambio: (hex) => { colores.fuente = hex; marcarTocado(); refrescarPreview(); },
  });

  const seccionDegradado = crearSeccionDegradado({ colores, refrescarPreview, marcarTocado });

  // Orden pedido — columna izquierda: Fondo, Tarjeta, Bordes, Detalles.
  // Columna derecha: Luz, Fuente, (color del) Degradado.
  columna1.appendChild(gFondo.elemento);
  columna1.appendChild(gTarjetas.elemento);
  columna1.appendChild(gBorde.elemento);
  columna1.appendChild(gAcento.elemento);
  columna2.appendChild(gLuz.elemento);
  columna2.appendChild(gFuente.elemento);
  columna2.appendChild(seccionDegradado.colorElemento);
  columnas.appendChild(columna1);
  columnas.appendChild(columna2);

  panel.appendChild(columnas);
  // Toggle + rueda + intensidad van debajo de las 2 columnas, arriba de la
  // vista previa. El color del degradado (arriba) va DENTRO de la columna 2.
  panel.appendChild(seccionDegradado.bloqueInferior);
  panel.appendChild(vistaPrevia);
  refrescarPreview();

  const filaBotones = document.createElement("div");
  filaBotones.className = "ppz-fila-botones";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", () => {
    restaurarPaletaGuardada();
    cerrarOverlay(overlay);
  });

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = "Guardar mi paleta";
  btnGuardar.addEventListener("click", () => {
    if (!tocado) {
      // BUG FIX v1.15.4: no se tocó nada — usar la paleta fija real tal
      // cual (100% fiel por definición, sale directo del CSS) en vez de
      // fabricar una "personalizada" aproximada que termina viéndose
      // distinta sin ninguna razón para el usuario. (Esta rama nunca se
      // alcanza en el flujo "Editar actual", ver `tocado` más arriba.)
      estado.datos.configuracion.paleta = paletaBase;
      aplicarPaleta(paletaBase, estado.datos.configuracion.modo);
    } else {
      estado.datos.configuracion.paleta_personalizada = {
        basadaEn: paletaBase,
        colores: { ...colores },
      };
      estado.datos.configuracion.paleta = "personalizada";
      aplicarPaleta("personalizada", estado.datos.configuracion.modo, colores);
    }
    // BUG FIX v1.15.3 (Parte 1): faltaba sellarTimestamp() acá — sin sellar,
    // este cambio queda con _actualizadoEn desactualizado y el próximo merge
    // de sync puede pisarlo con lo que traiga Drive. Mismo patrón que ya usa
    // config-ajustes.js en cada cambio de configuracion.
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    actualizarIndicadorSync();
    cerrarOverlay(overlay);
    if (typeof alGuardar === "function") alGuardar();
  });

  filaBotones.appendChild(btnCancelar);
  filaBotones.appendChild(btnGuardar);
  panel.appendChild(filaBotones);
}

function abrirPasoElegirBase(overlay, panel, alGuardar) {
  panel.innerHTML = "";

  const titulo = document.createElement("h2");
  titulo.className = "ppz-titulo";
  titulo.textContent = "Elegí un punto de partida";
  panel.appendChild(titulo);

  const subtitulo = document.createElement("p");
  subtitulo.className = "ppz-subtitulo";
  subtitulo.textContent = "Vas a poder cambiar cualquier color después — esto es solo una referencia de una combinación que ya funciona bien.";
  panel.appendChild(subtitulo);

  const grid = document.createElement("div");
  grid.className = "ppz-grid-base";

  // Pedido del usuario: si ya existe una paleta personalizada guardada, se
  // agrega "Editar actual" DENTRO de este mismo paso 1 (mismo grid que las
  // paletas base) — nunca reemplaza esta pantalla ni lleva a una aparte.
  // Abre el editor directo con los colores YA GUARDADOS, sin pasar por
  // leerColoresBaseDesdeCSS ni por ninguna paleta base — así lo que el
  // usuario ya tenía no se toca hasta que él mismo cambie algo.
  const paletaPersonalizadaGuardada = estado.datos.configuracion.paleta_personalizada;
  if (paletaPersonalizadaGuardada) {
    grid.appendChild(crearSwatchEditarActual(paletaPersonalizadaGuardada, () => {
      abrirPanelDeEdicion(
        overlay,
        panel,
        paletaPersonalizadaGuardada.basadaEn,
        alGuardar,
        paletaPersonalizadaGuardada.colores
      );
    }));
  }

  PALETAS_DISPONIBLES.forEach((paleta) => {
    grid.appendChild(crearSwatchBase(paleta, (paletaElegida) => {
      aplicarPaleta(paletaElegida, estado.datos.configuracion.modo);
      abrirPanelDeEdicion(overlay, panel, paletaElegida, alGuardar);
    }));
  });
  panel.appendChild(grid);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary ppz-cancelar-base";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", () => {
    restaurarPaletaGuardada();
    cerrarOverlay(overlay);
  });
  panel.appendChild(btnCancelar);
}

/**
 * Punto de entrada — llamado desde config-ajustes.js al hacer clic en la 15ª
 * opción "+ Crear mi paleta". `alGuardar` es un callback (típicamente
 * renderizarAjustes) para refrescar el grid de paletas después de guardar,
 * evitando que este archivo tenga que importar de vuelta a config-ajustes.js.
 */
function iniciarFlujoPaletaPersonalizada({ alGuardar } = {}) {
  const { overlay, panel } = construirOverlay();
  abrirPasoElegirBase(overlay, panel, alGuardar);
}

export {
  iniciarFlujoPaletaPersonalizada,
};
