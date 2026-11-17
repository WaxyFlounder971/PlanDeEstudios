/* =========================================================================
   LAYOUT LATERAL — quién se muestra a los lados según el ancho disponible
   (sin dependencias: lo usan finanzas-navegacion.js, config-ajustes.js y config-enlaces.js)

   Barra principal (izquierda): solo se contrae en escritorio (>= 900 px) y solo si la persona no eligió «No contraer»:
     · con Finanzas abierta (su sub-barra ocupa ese espacio), o
     · en un ancho medio (900–1100 px).
   Enlaces rápidos (derecha), de más a menos espacio:
     completo (260 px, >= 1500 px) → riel (solo iconos) → botón flotante → (< 900 px) cajón del teléfono.
     Cada paso se da cuando lo anterior dejaría el centro más angosto que MIN_CENTRO.
   El resultado se publica en body[data-enlaces-lateral] y en la clase .colapsada de #app-sidebar.
   ========================================================================= */

const CLAVE_NO_CONTRAER = "menu_lateral_no_contraer_v1";
const ANCHO_ESCRITORIO = 900;
const ANCHO_MEDIO_MAX = 1100;      // por debajo (y en escritorio) la barra principal va contraída
const ANCHO_BARRA_COLAPSADA = 82;  // = .app-sidebar.colapsada
const ANCHO_BARRA_MIN = 230;       // = ancho expandido mínimo (main.js lo sube con letra grande)
const ANCHO_SUBBARRA_FINANZAS = 236;
const ANCHO_ENLACES_COMPLETO = 260;
const ANCHO_ENLACES_RIEL = 68;     // 56 del riel + 12 de aire a la derecha
const MIN_CENTRO = 760;            // 704 de contenido + 2 × 28 de relleno

let finanzasAbierta = false;
let pendiente = 0;

export function menuLateralNoContraer() {
  try { return localStorage.getItem(CLAVE_NO_CONTRAER) === "1"; } catch (e) { return false; }
}

export function fijarMenuLateralNoContraer(valor) {
  try { localStorage.setItem(CLAVE_NO_CONTRAER, valor ? "1" : "0"); } catch (e) { /* sin storage */ }
  actualizarLayoutLateral();
}

export function fijarFinanzasAbierta(valor) {
  finanzasAbierta = Boolean(valor);
  actualizarLayoutLateral();
}

function hayEnlaces() {
  return document.querySelectorAll("#lista-enlaces-lateral a").length > 0;
}

export function actualizarLayoutLateral() {
  const ancho = window.innerWidth;
  const escritorio = ancho >= ANCHO_ESCRITORIO;

  const sidebar = document.getElementById("app-sidebar");
  const colapsar = escritorio && !menuLateralNoContraer() && (finanzasAbierta || ancho < ANCHO_MEDIO_MAX);
  if (sidebar) sidebar.classList.toggle("colapsada", colapsar);

  if (!escritorio) {
    delete document.body.dataset.enlacesLateral;
    return;
  }
  const anchoVariable = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sidebar-ancho"));
  const izquierda = (colapsar ? ANCHO_BARRA_COLAPSADA : (anchoVariable || ANCHO_BARRA_MIN))
    + (finanzasAbierta ? ANCHO_SUBBARRA_FINANZAS : 0);
  const centroCon = (derecha) => ancho - izquierda - derecha;

  let modo = "oculto";
  if (ancho >= 1500 && centroCon(ANCHO_ENLACES_COMPLETO) >= MIN_CENTRO) modo = "completo";
  else if (hayEnlaces() && centroCon(ANCHO_ENLACES_RIEL) >= MIN_CENTRO) modo = "riel";
  document.body.dataset.enlacesLateral = modo;
}

window.actualizarLayoutLateral = actualizarLayoutLateral;
window.addEventListener("resize", () => {
  clearTimeout(pendiente);
  pendiente = setTimeout(actualizarLayoutLateral, 80);
});
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", actualizarLayoutLateral);
else actualizarLayoutLateral();
