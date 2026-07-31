/* =========================================================================
   UI — CREAR MI PALETA (v1.13)
   Panel para construir una paleta de colores propia (15ª opción del selector
   de paletas). Se genera 100% por JS (overlay + modal) porque index.html no
   forma parte de los archivos que se tocaron en esta iteración — así no hace
   falta ninguna marca nueva en el HTML para que esto funcione.
   ========================================================================= */

import { PALETAS_DISPONIBLES } from "../core/schema.js";
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
} from "./tema.js";

/* ------------------------- Estado interno del panel ------------------------- */

// Saturación de cada campo: se toma UNA vez del color inicial y se mantiene
// fija mientras el usuario mueve los sliders — así el control secundario
// (claridad) queda simple, tal como pide el prompt, sin agregar un tercer
// slider de saturación por campo.
function crearCampoColor(hexInicial) {
  const { h, s, l } = hexAHsl(hexInicial);
  return { h, s, l };
}

/* ------------------------------ Construcción de UI ------------------------------ */

function crearBarraArcoiris({ valor, onCambio }) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = "0";
  input.max = "360";
  input.step = "1";
  input.value = String(Math.round(valor));
  input.className = "ppz-slider ppz-slider-hue";
  input.addEventListener("input", () => onCambio(Number(input.value)));
  return input;
}

function crearBarraClaridad({ valor, hue, sat, onCambio }) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = "5";
  input.max = "95";
  input.step = "1";
  input.value = String(Math.round(valor));
  input.className = "ppz-slider ppz-slider-luz";
  input.style.setProperty("--ppz-hue-actual", `hsl(${hue}, ${sat}%, 50%)`);
  input.addEventListener("input", () => onCambio(Number(input.value)));
  return input;
}

/**
 * Crea un grupo completo (etiqueta + barra de tono + barra de claridad) para
 * un campo de color. `onCambio(hex)` se dispara cada vez que el usuario
 * mueve cualquiera de las 2 barras, con el color resultante ya en hex.
 */
function crearGrupoColor({ etiqueta, hexInicial, onCambio }) {
  const campo = crearCampoColor(hexInicial);

  const wrap = document.createElement("div");
  wrap.className = "ppz-grupo";

  const label = document.createElement("label");
  label.className = "ppz-grupo-label";
  label.textContent = etiqueta;
  wrap.appendChild(label);

  const filaHue = document.createElement("div");
  filaHue.className = "ppz-fila-slider";

  const swatch = document.createElement("div");
  swatch.className = "ppz-swatch-vivo";
  const actualizarSwatch = () => {
    swatch.style.background = hslAHex(campo.h, campo.s, campo.l);
  };
  actualizarSwatch();

  const emitir = () => onCambio(hslAHex(campo.h, campo.s, campo.l));

  const sliderHue = crearBarraArcoiris({
    valor: campo.h,
    onCambio: (h) => {
      campo.h = h;
      actualizarSwatch();
      sliderLuz.style.setProperty("--ppz-hue-actual", `hsl(${campo.h}, ${campo.s}%, 50%)`);
      emitir();
    },
  });

  filaHue.appendChild(swatch);
  filaHue.appendChild(sliderHue);
  wrap.appendChild(filaHue);

  const sliderLuz = crearBarraClaridad({
    valor: campo.l,
    hue: campo.h,
    sat: campo.s,
    onCambio: (l) => {
      campo.l = l;
      actualizarSwatch();
      emitir();
    },
  });
  wrap.appendChild(sliderLuz);

  return { elemento: wrap, campo };
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

function pintarFondoIntensidad(input, { accent1, accent2, color }) {
  input.style.background = `linear-gradient(to right, ${accent1}, ${color}, ${accent2})`;
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
  contenedor.appendChild(rueda);

  const lectura = document.createElement("span");
  lectura.className = "ppz-rueda-lectura";
  contenedor.appendChild(lectura);

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
 * Sección completa del degradado: toggle + (si está activo) color libre +
 * intensidad + rueda de ángulo. Muta `colores.degradado` in-place y llama
 * `refrescarPreview()` en cada cambio — mismo patrón que crearGrupoColor.
 * `colores.degradado` ya debe venir inicializado (ver abrirPanelDeEdicion).
 */
function crearSeccionDegradado({ colores, refrescarPreview }) {
  const wrap = document.createElement("div");
  wrap.className = "ppz-grupo ppz-degradado";

  const filaToggle = document.createElement("div");
  filaToggle.className = "ppz-degradado-toggle-fila";
  const label = document.createElement("label");
  label.className = "ppz-grupo-label";
  label.textContent = "¿Desea degradado?";
  filaToggle.appendChild(label);

  const contenido = document.createElement("div");
  contenido.className = "ppz-degradado-contenido";

  const actualizarFondosVivos = () => {
    pintarFondoIntensidad(sliderIntensidad, {
      accent1: colores.accent1,
      accent2: colores.accent2,
      color: colores.degradado.color,
    });
    rueda.pintarColorAguja(colores.degradado.color);
  };

  // ---- Color libre del degradado ----
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
    refrescarPreview();
  });
  filaColor.appendChild(swatchColor);
  filaColor.appendChild(inputColor);

  // ---- Intensidad (dónde cae el stop del color del medio) ----
  const etiquetaIntensidad = document.createElement("label");
  etiquetaIntensidad.className = "ppz-grupo-label ppz-subetiqueta";
  etiquetaIntensidad.textContent = "Intensidad";
  const sliderIntensidad = crearBarraIntensidad({
    valor: colores.degradado.intensidad,
    onCambio: (v) => {
      colores.degradado.intensidad = v;
      refrescarPreview();
    },
  });

  // ---- Ángulo (dirección, rueda circular) ----
  const etiquetaAngulo = document.createElement("label");
  etiquetaAngulo.className = "ppz-grupo-label ppz-subetiqueta";
  etiquetaAngulo.textContent = "Dirección";
  const rueda = crearRuedaAngulo({
    valorInicial: colores.degradado.angulo,
    onCambio: (v) => {
      colores.degradado.angulo = v;
      refrescarPreview();
    },
  });

  contenido.appendChild(filaColor);
  contenido.appendChild(etiquetaIntensidad);
  contenido.appendChild(sliderIntensidad);
  contenido.appendChild(etiquetaAngulo);
  contenido.appendChild(rueda.elemento);
  actualizarFondosVivos();

  const sincronizarVisibilidad = () => {
    contenido.classList.toggle("oculto", !colores.degradado.activo);
  };
  sincronizarVisibilidad();

  const toggle = crearSwitch({
    activo: colores.degradado.activo,
    onCambio: (activo) => {
      colores.degradado.activo = activo;
      sincronizarVisibilidad();
      refrescarPreview();
    },
  });
  filaToggle.appendChild(toggle);

  wrap.appendChild(filaToggle);
  wrap.appendChild(contenido);
  return { elemento: wrap, actualizarFondosVivos };
}

/* ------------------------------ Vista previa en vivo ------------------------------ */

function crearVistaPrevia() {
  const contenedor = document.createElement("div");
  contenedor.className = "ppz-preview glass-card";
  contenedor.innerHTML = `
    <h3 class="ppz-preview-titulo">Vista previa</h3>
    <p class="ppz-preview-texto">Así se va a ver tu paleta en toda la app.</p>
    <button type="button" class="btn btn-primary ppz-preview-btn">Botón de ejemplo</button>
  `;
  return contenedor;
}

function pintarVistaPrevia(contenedor, colores) {
  const derivadas = calcularVariablesDerivadas(colores);
  Object.entries(derivadas).forEach(([variable, valor]) => {
    contenedor.style.setProperty(variable, valor);
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
 * Lee los valores REALES ya aplicados en :root para una paleta (los toma tal
 * cual están en design-system.css vía getComputedStyle) — así el punto de
 * partida de los 5 selectores siempre es fiel al CSS actual, sin duplicar la
 * tabla de colores acá en JS.
 */
function leerColoresBaseDesdeCSS() {
  const estilos = getComputedStyle(document.documentElement);
  const leer = (variable) => estilos.getPropertyValue(variable).trim();
  const fondoCanvas = colorAHex(leer("--bg-canvas"));
  return {
    fondoCanvas,
    // FIX v1.15 (Parte 1): --bg-card y --border-glass son rgba() de baja
    // opacidad (glassmorphism) en casi todas las paletas. Leerlos con
    // colorAHex a secas tira el alfa y los vuelve sólidos/saturados —
    // compositarSobreFondo los pinta tal cual se ven de verdad sobre
    // --bg-canvas, así el punto de partida del editor es fiel al pixel.
    fondoCard: compositarSobreFondo(leer("--bg-card"), fondoCanvas),
    borde: compositarSobreFondo(leer("--border-glass"), fondoCanvas),
    accent1: colorAHex(leer("--accent-1")),
    accent2: colorAHex(leer("--accent-2")),
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
  return { overlay, panel };
}

function cerrarOverlay(overlay) {
  overlay.remove();
}

/** Restaura en pantalla la paleta que el usuario tenía guardada antes de
 *  entrar a este flujo (se usa al cancelar, y también entre el paso 1 y 2
 *  para no dejar la app pintada con una paleta de referencia a medias). */
function restaurarPaletaGuardada() {
  const cfg = estado.datos.configuracion;
  aplicarPaleta(cfg.paleta, cfg.modo, cfg.paleta_personalizada ? cfg.paleta_personalizada.colores : undefined);
}

function abrirPanelDeEdicion(overlay, panel, paletaBase, alGuardar) {
  panel.innerHTML = "";

  const titulo = document.createElement("h2");
  titulo.className = "ppz-titulo";
  titulo.textContent = "Crear mi paleta";
  panel.appendChild(titulo);

  const subtitulo = document.createElement("p");
  subtitulo.className = "ppz-subtitulo";
  subtitulo.textContent = `Basada en "${paletaBase}" — ajustá lo que quieras, los colores de texto se calculan solos.`;
  panel.appendChild(subtitulo);

  const base = leerColoresBaseDesdeCSS();
  const colorLuzInicial = base.accent2; // "si no existe todavía como propia, sepárala de --accent-2"

  // v1.15 (Parte 2): siempre arranca desactivado ("blanco sólido", igual que
  // hoy) — este panel siempre construye una paleta NUEVA a partir de una
  // fija (nunca reabre una personalizada ya guardada), así que no hay un
  // degradado previo que recuperar. El color por defecto (si el usuario
  // activa el switch sin tocar nada más) es accent2, para que el degradado
  // arranque coherente con el acento ya elegido.
  const colores = {
    ...base,
    luz: colorLuzInicial,
    degradado: { activo: false, color: base.accent2, intensidad: 50, angulo: 90 },
  };
  const vistaPrevia = crearVistaPrevia();

  const refrescarPreview = () => pintarVistaPrevia(vistaPrevia, colores);

  const camposWrap = document.createElement("div");
  camposWrap.className = "ppz-campos";

  const gFondo = crearGrupoColor({
    etiqueta: "Color de fondo",
    hexInicial: base.fondoCanvas,
    onCambio: (hex) => { colores.fondoCanvas = hex; refrescarPreview(); },
  });
  const gTarjetas = crearGrupoColor({
    etiqueta: "Color de tarjetas/objetos",
    hexInicial: base.fondoCard,
    onCambio: (hex) => { colores.fondoCard = hex; refrescarPreview(); },
  });
  const gBorde = crearGrupoColor({
    etiqueta: "Color de borde",
    hexInicial: base.borde,
    onCambio: (hex) => { colores.borde = hex; refrescarPreview(); },
  });
  // Un solo selector de "acento" controla accent-1 y accent-2 (los 2 extremos
  // del degradado): accent-2 se deriva del mismo tono, un poco más claro y
  // saturado, para que el degradado siga viéndose vivo con un solo control.
  const gAcento = crearGrupoColor({
    etiqueta: "Color de detalles/acento",
    hexInicial: base.accent1,
    onCambio: (hex) => {
      colores.accent1 = hex;
      const { h, s, l } = hexAHsl(hex);
      colores.accent2 = hslAHex(h, Math.min(100, s + 5), Math.min(90, l + 16));
      seccionDegradado.actualizarFondosVivos();
      refrescarPreview();
    },
  });
  const gLuz = crearGrupoColor({
    etiqueta: "Color de la luz",
    hexInicial: colorLuzInicial,
    onCambio: (hex) => { colores.luz = hex; refrescarPreview(); },
  });

  const seccionDegradado = crearSeccionDegradado({ colores, refrescarPreview });

  [gFondo, gTarjetas, gBorde, gAcento, gLuz].forEach((g) => camposWrap.appendChild(g.elemento));
  panel.appendChild(camposWrap);
  panel.appendChild(seccionDegradado.elemento);
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
    estado.datos.configuracion.paleta_personalizada = {
      basadaEn: paletaBase,
      colores: { ...colores },
    };
    estado.datos.configuracion.paleta = "personalizada";
    aplicarPaleta("personalizada", estado.datos.configuracion.modo, colores);
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
