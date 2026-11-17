/**
 * v3.27.5 — Bloqueo del scroll de fondo mientras haya un modal abierto.
 *
 * Los modales (`.modal-overlay`) no bloqueaban el scroll de la página: con un
 * modal abierto el dedo seguía moviendo el contenido de atrás. Como hay modales
 * fijos en el HTML (solo alternan la clase "oculto") y otros armados al vuelo
 * con createElement, un único observer detecta ambos casos sin tocar cada
 * modal. Usa su propia clase (`modal-abierto`) y no `scroll-bloqueado`, para
 * que cerrar el menú móvil no desbloquee la página con un modal todavía abierto.
 *
 * Ajuste posterior: con body{overflow:hidden} solo, en el teléfono el fondo seguía moviéndose (el gesto "encadenaba" desde la
 * tarjeta del modal hacia la página al llegar a su tope). Ahora el CSS también bloquea html y frena el encadenado en la
 * tarjeta, y acá hay un respaldo táctil para los navegadores que no respetan eso.
 */
const CLASE_MODAL_ABIERTO = "modal-abierto";
let programado = false;
let instalado = false;

function hayModalVisible() {
  for (const overlay of document.querySelectorAll(".modal-overlay")) {
    if (overlay.classList.contains("oculto")) continue;
    // getClientRects() está vacío si el overlay (o un ancestro) tiene display:none.
    if (overlay.getClientRects().length > 0) return true;
  }
  return false;
}

function sincronizarBloqueoScrollModal() {
  programado = false;
  document.body.classList.toggle(CLASE_MODAL_ABIERTO, hayModalVisible());
}

function programarSincronizacion() {
  if (programado) return;
  programado = true;
  requestAnimationFrame(sincronizarBloqueoScrollModal);
}

// Respaldo táctil: cuando el gesto empieza dentro de un modal y ninguna capa desplazable (entre el dedo y el modal) puede seguir
// moviéndose en esa dirección, se cancela el gesto para que no llegue a la página de atrás. Los gestos horizontales no se tocan.
let inicioX = 0;
let inicioY = 0;

function alTocarConModal(e) {
  if (e.touches.length !== 1) return;
  inicioX = e.touches[0].clientX;
  inicioY = e.touches[0].clientY;
}

function alMoverDedoConModal(e) {
  if (!document.body.classList.contains(CLASE_MODAL_ABIERTO) || e.touches.length !== 1) return;
  const overlay = e.target instanceof Element ? e.target.closest(".modal-overlay") : null;
  if (!overlay) return;
  const dx = e.touches[0].clientX - inicioX;
  const dy = e.touches[0].clientY - inicioY;
  inicioX = e.touches[0].clientX;
  inicioY = e.touches[0].clientY;
  if (dy === 0 || Math.abs(dx) > Math.abs(dy)) return;
  for (let el = e.target; el instanceof Element; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) {
      const alTope = el.scrollTop <= 0;
      const alFondo = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
      if (!((dy > 0 && alTope) || (dy < 0 && alFondo))) return; // todavía puede desplazarse en esa dirección
    }
    if (el === overlay) break;
  }
  if (e.cancelable) e.preventDefault();
}

function inicializarBloqueoScrollModales() {
  if (instalado) return; // main.js puede llamar a las inicializaciones dos veces (re-login)
  instalado = true;
  new MutationObserver(programarSincronizacion).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
  document.addEventListener("touchstart", alTocarConModal, { passive: true });
  document.addEventListener("touchmove", alMoverDedoConModal, { passive: false });
  sincronizarBloqueoScrollModal();
}

export { inicializarBloqueoScrollModales };
