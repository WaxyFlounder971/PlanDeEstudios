/* =========================================================================
   v3.28.0 B (L1 + L2): mantener presionado para expandir el menú lateral y los Enlaces rápidos (escritorio).
   - Menú izquierdo (riel de iconos): se expande ENCIMA del contenido. Un espaciador conserva el ancho del riel,
     así que ningún elemento se mueve (sin reflow). Telón (#sidebar-overlay) detrás, como en el teléfono.
   - Enlaces rápidos (riel derecho): reutiliza el cajón del teléfono (#drawer-enlaces-movil), que ya es una capa
     elevada con telón y animación de transform + opacity. Sus filas usan el mismo diseño que el panel (E1).
   Cierra: tocar fuera, Esc, otra pulsación larga sobre el panel, o el atajo de teclado.
   Teclado: Alt+Mayús+M (menú) y Alt+Mayús+E (enlaces). El toque corto sigue navegando; mover el puntero cancela.
   Sin dependencias circulares: componentes.js le pasa abrir/cerrar del cajón de enlaces.
   ========================================================================= */

import { actualizarLayoutLateral } from "./layout-lateral.js";

const DURACION_HOLD_MS = 500;      // igual que agregarLongPress
const UMBRAL_MOVIMIENTO_PX = 10;   // más que esto es scroll/arrastre, no una pulsación larga
const DURACION_SALIDA_MS = 160;    // = animación sidebar-expansion-sale (design-system.css)
const ANCHO_ESCRITORIO = 900;      // = layout-lateral.js

let iniciado = false;
let cajonEnlaces = { abrir: null, cerrar: null };
let sidebarExpandida = false;
let espaciador = null;
let tSalida = 0;

// Gesto en curso
let timerHold = 0;
let origenX = 0;
let origenY = 0;
let clickSuprimido = false; // el hold ya resolvió el gesto: se descarta el click que llega al soltar

function esEscritorio() {
  return window.innerWidth >= ANCHO_ESCRITORIO;
}

function sinMovimiento() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
    || document.documentElement.dataset.rendimiento === "reducido";
}

function cajonEnlacesAbierto() {
  const cajon = document.getElementById("drawer-enlaces-movil");
  return Boolean(cajon && cajon.classList.contains("abierta"));
}

function hayModalAbierto() {
  return Boolean(document.querySelector(".modal-overlay:not(.oculto)"));
}

/* ---------- Menú izquierdo ---------- */

function abrirSidebarExpandida() {
  const sidebar = document.getElementById("app-sidebar");
  if (!sidebar || sidebarExpandida || !esEscritorio()) return;
  if (!sidebar.classList.contains("colapsada")) return; // ya está expandida: nada que hacer
  if (cajonEnlacesAbierto() && cajonEnlaces.cerrar) cajonEnlaces.cerrar();

  const caja = sidebar.getBoundingClientRect();
  // El espaciador ocupa el sitio del riel mientras éste flota: el resto del layout no se entera.
  espaciador = document.createElement("div");
  espaciador.className = "sidebar-espaciador-expansion";
  espaciador.setAttribute("aria-hidden", "true");
  espaciador.style.flex = "0 0 " + caja.width + "px";
  espaciador.style.width = caja.width + "px";
  sidebar.insertAdjacentElement("afterend", espaciador);

  sidebar.style.setProperty("--exp-izq", caja.left + "px");
  sidebar.classList.add("expansion-sin-transicion", "expandida-overlay");
  sidebar.classList.remove("colapsada");
  document.body.classList.add("sidebar-expandida-activa");
  void sidebar.offsetWidth; // fija el estado sin animar ancho; la entrada la hace la animación de opacity/transform
  sidebar.classList.remove("expansion-sin-transicion");
  sidebarExpandida = true;
}

function limpiarSidebarExpandida() {
  clearTimeout(tSalida);
  const sidebar = document.getElementById("app-sidebar");
  sidebarExpandida = false;
  if (sidebar) {
    sidebar.classList.add("expansion-sin-transicion");
    sidebar.classList.remove("expandida-overlay", "expandida-saliendo");
    sidebar.style.removeProperty("--exp-izq");
  }
  if (espaciador) {
    espaciador.remove();
    espaciador = null;
  }
  document.body.classList.remove("sidebar-expandida-activa", "sidebar-expandida-saliendo");
  actualizarLayoutLateral(); // vuelve a decidir .colapsada según el ancho y Finanzas
  if (sidebar) {
    void sidebar.offsetWidth;
    sidebar.classList.remove("expansion-sin-transicion");
  }
}

function cerrarSidebarExpandida(inmediato = false) {
  if (!sidebarExpandida) return;
  const sidebar = document.getElementById("app-sidebar");
  if (inmediato || !sidebar || sinMovimiento()) {
    limpiarSidebarExpandida();
    return;
  }
  sidebar.classList.add("expandida-saliendo");
  document.body.classList.add("sidebar-expandida-saliendo");
  clearTimeout(tSalida);
  tSalida = setTimeout(limpiarSidebarExpandida, DURACION_SALIDA_MS);
}

/* ---------- Enlaces rápidos (cajón) ---------- */

function enlacesExpandibles() {
  return esEscritorio() && document.body.dataset.enlacesLateral !== "completo";
}

function abrirEnlacesExpandido() {
  if (!enlacesExpandibles() || cajonEnlacesAbierto() || !cajonEnlaces.abrir) return;
  if (sidebarExpandida) cerrarSidebarExpandida(true);
  cajonEnlaces.abrir();
}

function cerrarEnlacesExpandido() {
  if (cajonEnlacesAbierto() && cajonEnlaces.cerrar) cajonEnlaces.cerrar();
}

/* ---------- Gesto de pulsación larga (delegado en document: sobrevive a re-render del DOM) ---------- */

function accionPara(destino) {
  if (!(destino instanceof Element) || !esEscritorio()) return null;
  if (destino.closest("#indicador-sync")) return null; // tiene su propio long-press (forzar sincronización)
  if (destino.closest("#app-sidebar")) {
    // Abierto: solo cierra con una pulsación larga sobre un espacio libre (un clic lento en un botón navega normal).
    if (sidebarExpandida) return destino.closest(".btn-nav, a, button") ? null : () => cerrarSidebarExpandida();
    // Cerrado: solo hay gesto si el menú está de verdad en riel; si ya está expandido, no se traga ningún clic lento.
    const sidebar = document.getElementById("app-sidebar");
    return sidebar && sidebar.classList.contains("colapsada") ? abrirSidebarExpandida : null;
  }
  if (destino.closest("#panel-enlaces-lateral")) {
    return document.body.dataset.enlacesLateral === "riel" ? abrirEnlacesExpandido : null;
  }
  if (destino.closest("#drawer-enlaces-movil") && !destino.closest("a, button") && cajonEnlacesAbierto()) {
    return cerrarEnlacesExpandido;
  }
  return null;
}

function cancelarHold() {
  clearTimeout(timerHold);
  timerHold = 0;
}

function alPulsar(e) {
  clickSuprimido = false;
  cancelarHold();
  if (e.pointerType === "mouse" && e.button !== 0) return; // el clic derecho conserva su menú contextual
  if (e.isPrimary === false) return;
  const accion = accionPara(e.target);
  if (!accion) return;
  origenX = e.clientX;
  origenY = e.clientY;
  timerHold = setTimeout(() => {
    timerHold = 0;
    clickSuprimido = true;
    accion();
  }, DURACION_HOLD_MS);
}

function alMover(e) {
  if (!timerHold) return;
  if (Math.abs(e.clientX - origenX) > UMBRAL_MOVIMIENTO_PX || Math.abs(e.clientY - origenY) > UMBRAL_MOVIMIENTO_PX) {
    cancelarHold();
  }
}

function alSoltar() {
  cancelarHold();
  // El click llega justo después del pointerup: se deja el descarte un instante y luego se apaga.
  if (clickSuprimido) setTimeout(() => { clickSuprimido = false; }, 350);
}

function alHacerClick(e) {
  if (clickSuprimido) {
    clickSuprimido = false;
    e.stopPropagation();
    e.preventDefault();
    return;
  }
  if (!sidebarExpandida) return;
  const destino = e.target instanceof Element ? e.target : null;
  if (!destino) return;
  if (destino.closest("#sidebar-overlay")) cerrarSidebarExpandida();
  else if (destino.closest("#app-sidebar .btn-nav, #app-sidebar a")) cerrarSidebarExpandida(true); // navegar cierra, como en el teléfono
}

function alPulsarTecla(e) {
  if (e.key === "Escape") {
    if (hayModalAbierto()) return;
    if (sidebarExpandida) cerrarSidebarExpandida();
    else if (cajonEnlacesAbierto()) cerrarEnlacesExpandido();
    return;
  }
  if (!e.altKey || !e.shiftKey || e.ctrlKey || e.metaKey) return;
  const el = document.activeElement;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
  const tecla = String(e.key).toLowerCase();
  if (tecla === "m") {
    e.preventDefault();
    if (sidebarExpandida) cerrarSidebarExpandida();
    else abrirSidebarExpandida();
  } else if (tecla === "e") {
    e.preventDefault();
    if (cajonEnlacesAbierto()) cerrarEnlacesExpandido();
    else abrirEnlacesExpandido();
  }
}

/**
 * Idempotente (main.js llama a inicializarLayoutResponsivo en el arranque normal y en la demo).
 * @param {{abrirEnlaces: Function, cerrarEnlaces: Function}} cajon abrir/cerrar del cajón de Enlaces rápidos.
 */
export function inicializarExpansionLateral(cajon) {
  if (iniciado) return;
  iniciado = true;
  cajonEnlaces = { abrir: cajon && cajon.abrirEnlaces, cerrar: cajon && cajon.cerrarEnlaces };

  document.addEventListener("pointerdown", alPulsar, true);
  document.addEventListener("pointermove", alMover, true);
  document.addEventListener("pointerup", alSoltar, true);
  document.addEventListener("pointercancel", cancelarHold, true);
  window.addEventListener("blur", cancelarHold);
  // Captura: el click que sigue al hold se descarta antes de llegar al botón o enlace pulsado.
  document.addEventListener("click", alHacerClick, true);
  // En pantallas táctiles el hold también dispara «contextmenu»: se anula solo si el hold ya expandió algo.
  document.addEventListener("contextmenu", (e) => { if (clickSuprimido) e.preventDefault(); }, true);
  document.addEventListener("keydown", alPulsarTecla);
  window.addEventListener("resize", () => cerrarSidebarExpandida(true));
}
