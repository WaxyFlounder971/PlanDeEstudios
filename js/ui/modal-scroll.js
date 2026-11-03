/**
 * v3.27.5 — Bloqueo del scroll de fondo mientras haya un modal abierto.
 *
 * Los modales (`.modal-overlay`) no bloqueaban el scroll de la página: con un
 * modal abierto el dedo seguía moviendo el contenido de atrás. Como hay modales
 * fijos en el HTML (solo alternan la clase "oculto") y otros armados al vuelo
 * con createElement, un único observer detecta ambos casos sin tocar cada
 * modal. Usa su propia clase (`modal-abierto`) y no `scroll-bloqueado`, para
 * que cerrar el menú móvil no desbloquee la página con un modal todavía abierto.
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

function inicializarBloqueoScrollModales() {
  if (instalado) return; // main.js puede llamar a las inicializaciones dos veces (re-login)
  instalado = true;
  new MutationObserver(programarSincronizacion).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style", "hidden"],
  });
  sincronizarBloqueoScrollModal();
}

export { inicializarBloqueoScrollModales };
