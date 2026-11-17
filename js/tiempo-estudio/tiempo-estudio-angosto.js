/* =========================================================================
   TIEMPO DE ESTUDIO EN VERSIÓN ANGOSTA (solo < 900px)
   -------------------------------------------------------------------------
   Mismo patrón que js/agenda/agenda-angosta.js: solo cambian POSICIONES, no la lógica de Tiempo.

   Lista (Materias · Estadísticas · Competencias):
   - La barra superior móvil deja de mostrar el logo "Wapper" y pasa a mostrar, entre ☰ y 🔗:
       izquierda  → lo que antes iba a la izquierda del encabezado (racha 🔥; en Competencias queda vacío: "Unirse" va al pie de la lista)
       centro     → semestre (tocable) · "Semana N" · rango de fechas
       derecha    → ⋮ (ajustes de Tiempo)
   - El "+" pasa a ser un botón flotante abajo a la derecha, al lado de la barra inferior.
   - El switch de 3 pestañas (#seccion-tiempo-estudio .pill-switch-binario) pasa a ser la barra inferior:
     mismos botones, mismo gesto de deslizar entre vistas (solo cambia cómo se ve; ver css/design-system.css,
     bloque «Tiempo de Estudio angosto»).

   Detalle de una materia (el timer):
   - El encabezado de la materia sube a la barra superior: ◀ (volver) · código sobre nombre · ⋮, entre ☰ y 🔗.
   - Toda la paleta toma el color de la materia (body.te-angosto-detalle + --te-det-color) y la barra superior
     lleva una línea gruesa de ese color en su borde inferior.
   - Se conserva la barra inferior (tocar una pestaña sale del detalle) y el "+" registra una sesión pasada.

   Cómo funciona: se MUEVEN los mismos nodos que ya arma tiempo-estudio.js (no se clonan), así conservan
   sus listeners. El encabezado se vuelve a armar en cada render, por eso tiempo-estudio.js llama a
   acomodarEncabezadoTE / acomodarDetalleTE justo después de construirlo. Al ensanchar la ventana (>= 900px)
   o salir de la sección se vacían los contenedores de la barra superior y se pide un repintado, de modo
   que en pantalla grande todo queda exactamente como siempre.
   ========================================================================= */

const MQ_ANGOSTO = window.matchMedia("(max-width: 899.98px)");
const porId = (id) => document.getElementById(id);

let activo = false;
let repintar = null; // renderizarTiempoEstudio, registrado por tiempo-estudio.js

const SVG = (cuerpo) => `<svg class="te-nav-ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${cuerpo}</svg>`;
const ICONOS_VISTA = {
  materias: SVG('<path d="M12 6.6C10.3 5.2 7.9 4.6 4 4.9v12.8c3.9-.3 6.3.3 8 1.7 1.7-1.4 4.1-2 8-1.7V4.9c-3.9-.3-6.3.3-8 1.7z" fill="currentColor" fill-opacity=".28"/><path d="M12 6.6v12.8"/>'),
  estadisticas: SVG('<rect x="4" y="11" width="4" height="9" rx="1.2" fill="currentColor" fill-opacity=".28"/><rect x="10" y="4" width="4" height="16" rx="1.2" fill="currentColor" fill-opacity=".28"/><rect x="16" y="8" width="4" height="12" rx="1.2" fill="currentColor" fill-opacity=".28"/>'),
  competencias: SVG('<path d="M7 4h10v5a5 5 0 0 1-10 0z" fill="currentColor" fill-opacity=".28"/><path d="M7 6H4.5v1.5a3 3 0 0 0 3 3M17 6h2.5v1.5a3 3 0 0 1-3 3M12 14v3.5M8.5 20h7M9.5 17.5h5"/>'),
};

/** Icono (SVG en texto) de cada pestaña; en pantalla grande el CSS lo oculta. */
export function iconoVistaTE(vista) {
  return ICONOS_VISTA[vista] || "";
}

export function registrarRepintadoTE(fn) {
  repintar = typeof fn === "function" ? fn : null;
}

export function esTEAngosto() {
  return activo;
}

function seccionVisible() {
  const seccion = porId("seccion-tiempo-estudio");
  return Boolean(seccion && !seccion.classList.contains("oculto"));
}

function quitarDetalle() {
  document.body.classList.remove("te-angosto-detalle");
  document.body.style.removeProperty("--te-det-color");
}

function limpiarContenedores() {
  ["topbar-estudio", "topbar-estudio-izq", "topbar-estudio-der", "te-fab"].forEach((id) => porId(id)?.replaceChildren());
  quitarDetalle();
}

/** Recalcula si el modo angosto está activo. Devuelve true solo si CAMBIÓ (así nunca se repinta en bucle). */
function sincronizar() {
  const nuevo = MQ_ANGOSTO.matches && seccionVisible();
  if (nuevo === activo) return false;
  activo = nuevo;
  document.body.classList.toggle("te-angosto", activo);
  if (!activo) limpiarContenedores();
  return true;
}

function asegurarFab() {
  let fab = porId("te-fab");
  if (!fab) {
    fab = document.createElement("div");
    fab.id = "te-fab";
    fab.className = "te-fab-host";
    document.body.appendChild(fab);
  }
  return fab;
}

/**
 * Lista: se llama justo después de construirEncabezado(host, …) (ver pintarEncabezadoTE en tiempo-estudio.js).
 * `host` es el contenedor del encabezado dentro de la sección.
 */
export function acomodarEncabezadoTE(host) {
  sincronizar();
  quitarDetalle();
  if (!host) return;
  if (!activo) {
    host.style.display = "";
    return;
  }
  const enc = host.querySelector(":scope > .app-encabezado");
  const cuerpo = porId("topbar-estudio");
  const lugarIzq = porId("topbar-estudio-izq");
  const lugarDer = porId("topbar-estudio-der");
  if (!enc || !cuerpo || !lugarIzq || !lugarDer) {
    host.style.display = "";
    return;
  }
  const semestre = enc.querySelector(":scope > .app-encabezado__semestre");
  const centro = enc.querySelector(".app-encabezado__centro");
  const izq = enc.querySelector(".app-encabezado__izq");
  const der = enc.querySelector(".app-encabezado__der");
  const mas = der?.querySelector(".app-encabezado__mas") || null;

  cuerpo.replaceChildren(...[semestre, centro].filter(Boolean));
  lugarIzq.replaceChildren(...(izq ? [...izq.childNodes] : []));
  lugarDer.replaceChildren(...(der ? [...der.childNodes].filter((n) => n !== mas) : []));
  asegurarFab().replaceChildren(...(mas ? [mas] : []));
  host.style.display = "none"; // el encabezado original ya quedó vacío: no debe ocupar lugar ni sumar separación
}

/**
 * Detalle de materia: se llama justo después de construirEncabezadoDetalle.
 *   tarjeta / btnVolver / titulo / btnConfig → los nodos que arma esa función (se mueven, no se clonan)
 *   codigo, nombre, color                      → código, nombre (corto) de la materia y su color
 *   alAgregar                                  → acción del "+" flotante (registrar sesión pasada)
 */
export function acomodarDetalleTE({ tarjeta, btnVolver, titulo, btnConfig, codigo, nombre, color, alAgregar }) {
  sincronizar();
  // Pantalla grande: no se toca NADA (borrar el display en línea de la tarjeta la dejaba apilada en 3 líneas).
  if (!activo) {
    quitarDetalle();
    return;
  }
  const cuerpo = porId("topbar-estudio");
  const lugarIzq = porId("topbar-estudio-izq");
  const lugarDer = porId("topbar-estudio-der");
  if (!cuerpo || !lugarIzq || !lugarDer) return;

  document.body.classList.add("te-angosto-detalle");
  document.body.style.setProperty("--te-det-color", color);

  const centro = document.createElement("div");
  centro.className = "te-det-centro";
  const cod = document.createElement("small");
  cod.className = "te-det-codigo";
  cod.textContent = codigo || "";
  cod.hidden = !codigo;
  // El código es funcional, como en la tarjeta de la lista: abre "Buscar materia en..." (lo hace el botón del título).
  if (titulo.tagName === "BUTTON" && codigo) {
    cod.classList.add("te-codigo-clickeable");
    cod.setAttribute("role", "button");
    cod.tabIndex = 0;
    cod.addEventListener("click", () => titulo.click());
    cod.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); titulo.click(); } });
  }
  // Los estilos en línea de la tarjeta de siempre (centrado, tamaño, relleno) no aplican en la barra superior.
  titulo.style.cssText = "background:none; border:0; padding:0; margin:0; cursor:pointer; color:inherit;";
  titulo.classList.add("te-det-nombre");
  if (nombre) titulo.textContent = nombre; // el código ya va arriba, en su propia línea
  centro.append(cod, titulo);
  cuerpo.replaceChildren(centro);

  // En la barra superior el tamaño lo da el CSS (el anclaje a los lados es del encabezado de pantalla grande).
  [btnVolver, btnConfig].forEach((b) => b.classList.remove("te-det-lado", "te-det-lado--izq", "te-det-lado--der"));
  btnVolver.classList.add("te-det-volver");
  btnConfig.style.fontSize = "";
  btnConfig.classList.add("te-det-config");
  lugarIzq.replaceChildren(btnVolver);
  lugarDer.replaceChildren(btnConfig);
  if (tarjeta) tarjeta.style.display = "none";

  const mas = document.createElement("button");
  mas.type = "button";
  mas.className = "btn btn-primary app-encabezado__mas";
  mas.title = "Registrar sesión pasada";
  mas.setAttribute("aria-label", "Registrar sesión pasada");
  mas.textContent = "+";
  mas.addEventListener("click", () => alAgregar?.());
  asegurarFab().replaceChildren(mas);
}

/**
 * Barra inferior para la pantalla de detalle (la lista usa el switch de siempre): mismas 3 pestañas;
 * tocar cualquiera sale del detalle hacia esa vista. En pantalla grande no se crea.
 */
export function construirBarraDetalleTE(alElegir) {
  if (!activo) return null;
  const barra = document.createElement("div");
  barra.className = "pill-group pill-group-fijo pill-switch-binario te-barra-detalle";
  barra.dataset.opciones = "3";
  [["materias", "Materias"], ["estadisticas", "Estadísticas"], ["competencias", "Competencias"]].forEach(([vista, texto]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (vista === "materias" ? " active" : "");
    btn.dataset.vista = vista;
    btn.setAttribute("aria-pressed", String(vista === "materias"));
    btn.innerHTML = `${iconoVistaTE(vista)}<span class="te-nav-texto"></span>`;
    btn.querySelector(".te-nav-texto").textContent = texto;
    btn.addEventListener("click", () => alElegir?.(vista));
    barra.appendChild(btn);
  });
  return barra;
}

/* ---------- Arranque ---------- */

// Igual que Agenda: este módulo solo necesita que <body data-topbar-ctx="tiempo-estudio"> marque cuándo
// está abierta la sección (el texto de la barra contextual se oculta por CSS: aquí el encabezado son los
// propios nodos de Tiempo).
window.actualizarTopbarCtx?.("tiempo-estudio", { titulo: "Tiempo" });

function alCambiar() {
  const cambio = sincronizar();
  // Ya activo y todavía sin acomodar (se abrió la sección, o se achicó la ventana): rearmar el encabezado.
  // Al ensanchar o salir de la sección no hace falta repintar si la sección está oculta (se repinta al volver).
  if (cambio && seccionVisible()) repintar?.();
}

MQ_ANGOSTO.addEventListener?.("change", alCambiar);

const seccion = porId("seccion-tiempo-estudio");
if (seccion && typeof MutationObserver === "function") {
  // Solo se actúa cuando el estado cambió de verdad (sincronizar() devuelve false si no): sin bucles.
  new MutationObserver(alCambiar).observe(seccion, { attributes: true, attributeFilter: ["class"] });
}
