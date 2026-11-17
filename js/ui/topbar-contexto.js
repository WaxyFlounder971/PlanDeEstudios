/* =========================================================================
   BARRA SUPERIOR CONTEXTUAL (solo versión angosta, < 900px)
   -------------------------------------------------------------------------
   En Resumen, Asistente y Notas rápidas la barra superior móvil deja de
   mostrar el logo "Wapper" y pasa a mostrar el encabezado de la sección:
   título + subtítulo entre la hamburguesa (☰) y el acceso a enlaces (🔗), que
   NUNCA se ocultan. En Resumen además dibuja el progreso del semestre sobre
   el borde inferior de la barra.

   Cómo funciona (cero acoplamiento con el resto):
   - main.js avisa qué sección se abrió:  window.sincronizarTopbarCtx(nombre)
   - cada sección publica su contenido:   window.actualizarTopbarCtx(nombre, datos)
       datos = { titulo: string | string[], sub?: string | string[], progreso?: 0..100 }
       Un array son candidatos de MÁS largo a MÁS corto: se usa el primero que
       entre en UNA sola línea (el texto nunca se corta ni baja de renglón).
       datos = null  → esa sección no usa la barra contextual (vuelve el logo).
   - Se marca <body data-topbar-ctx="resumen|asistente|notas"> y el CSS
     (css/design-system.css, bloque «Barra superior contextual») hace el resto.
   - En >= 900px la barra móvil no existe (display:none), así que nada cambia.
   ========================================================================= */

const SECCIONES_CON_CTX = new Set(["resumen", "asistente", "notas", "comunidad", "finanzas", "agenda", "tiempo-estudio"]); // "agenda": solo marca el body, su encabezado lo monta js/agenda/agenda-angosta.js
const contenidos = {};
let seccionActual = null;

const porId = (id) => document.getElementById(id);
const aLista = (v) => (Array.isArray(v) ? v : v == null || v === "" ? [] : [v]).map(String);

let lienzo = null;
function anchoTexto(texto, elemento) {
  lienzo = lienzo || document.createElement("canvas").getContext("2d");
  if (!lienzo) return 0; // sin canvas no se puede medir: se usa el texto largo
  const e = getComputedStyle(elemento);
  lienzo.font = `${e.fontStyle} ${e.fontWeight} ${e.fontSize} ${e.fontFamily}`;
  return lienzo.measureText(texto).width;
}

/** Primer candidato (de más largo a más corto) que cabe en `ancho`. Sin medida
 *  disponible (barra oculta) se usa el más largo; si ninguno cabe, el más corto. */
function elegirQueEntre(candidatos, elemento, ancho) {
  if (!candidatos.length) return "";
  if (!(ancho > 0)) return candidatos[0];
  for (const c of candidatos) if (anchoTexto(c, elemento) <= ancho) return c;
  return candidatos[candidatos.length - 1];
}

function pintar() {
  const ctx = porId("topbar-ctx");
  const titulo = porId("topbar-ctx-titulo");
  const sub = porId("topbar-ctx-sub");
  const barra = porId("topbar-progreso");
  if (!ctx || !titulo || !sub || !barra) return;

  const datos = SECCIONES_CON_CTX.has(seccionActual) ? contenidos[seccionActual] : null;
  const titulos = aLista(datos?.titulo);
  if (!datos || !titulos.length) {
    document.body.removeAttribute("data-topbar-ctx");
    ctx.hidden = true;
    barra.hidden = true;
    return;
  }

  document.body.setAttribute("data-topbar-ctx", seccionActual);
  ctx.hidden = false;
  const ancho = ctx.getBoundingClientRect().width;
  titulo.textContent = elegirQueEntre(titulos, titulo, ancho);
  const subs = aLista(datos.sub);
  sub.textContent = elegirQueEntre(subs, sub, ancho);
  sub.hidden = !subs.length;

  const p = Number(datos.progreso);
  if (datos.progreso == null || Number.isNaN(p)) {
    barra.hidden = true;
  } else {
    const pct = Math.min(100, Math.max(0, p));
    barra.hidden = false;
    barra.style.setProperty("--p", `${pct}%`);
    barra.setAttribute("aria-valuenow", String(Math.round(pct)));
  }
}

export function actualizarTopbarCtx(seccion, datos) {
  contenidos[seccion] = datos || null;
  if (seccion === seccionActual) pintar();
}

export function sincronizarTopbarCtx(seccion) {
  seccionActual = seccion;
  pintar();
}

let esperaRedimension = null;
window.addEventListener("resize", () => {
  clearTimeout(esperaRedimension);
  esperaRedimension = setTimeout(pintar, 100);
});
// Al terminar de cargar la tipografía cambian los anchos reales: se vuelve a decidir qué texto entra.
document.fonts?.ready?.then(pintar);

window.actualizarTopbarCtx = actualizarTopbarCtx;
window.sincronizarTopbarCtx = sincronizarTopbarCtx;
