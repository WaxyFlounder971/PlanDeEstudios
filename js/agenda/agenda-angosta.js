/* =========================================================================
   AGENDA EN VERSIÓN ANGOSTA (solo < 900px)
   -------------------------------------------------------------------------
   Rediseño SOLO de posición (no de lógica ni de estilo de los elementos):

   - La barra superior móvil deja de mostrar el logo "Wapper" y pasa a mostrar el encabezado de
     Agenda: semestre (tocable) · "Semana N" (con ‹ › si corresponde) · rango + "Hoy", entre la
     hamburguesa (☰) y el acceso a enlaces (🔗), que NUNCA se ocultan. El botón ⋮ (ajustes de Agenda)
     queda justo a la izquierda de 🔗.
   - El botón "+" (agregar) pasa a ser un botón flotante abajo a la derecha, al lado de la barra
     inferior de 3 botones (Lista · Calendario · Cronograma) que reemplaza al switch pill. Esa barra
     ES el mismo #pills-agenda-vista de siempre (mismos .pill-item, mismo thumb y mismo gesto de
     deslizar de agenda.js): solo cambia cómo se ve (css/design-system.css, bloque «Agenda angosta»).

   Cómo funciona (cero acoplamiento con la lógica de Agenda):
   - Se MUEVEN los mismos nodos del DOM (no se clonan), así conservan sus listeners e ids y
     agenda.js sigue pintando en ellos exactamente igual. Al ensanchar la ventana (>= 900px) cada
     nodo vuelve a su lugar original; ahí nada cambia.
   - La barra contextual (js/ui/topbar-contexto.js) marca <body data-topbar-ctx="agenda"> cuando
     Agenda está abierta; el CSS usa eso para mostrar u ocultar las piezas de la barra superior.
   - El nombre del semestre NUNCA se corta ni baja de renglón: si no entra, se usa una versión más
     corta (mismo criterio que la barra contextual de Resumen / Asistente / Notas).
   - agenda.js avisa los nombres con window.actualizarTopbarAgenda(partes | null).
   ========================================================================= */

const MQ_ANGOSTO = window.matchMedia("(max-width: 899.98px)");
const porId = (id) => document.getElementById(id);

let montado = false;
let nombresSemestre = null; // string[] con los semestres mostrados, o null (texto de relleno: "Sin semestres"…)
const marcas = new Map(); // id → comentario que guarda el lugar original del nodo

/** Mueve `nodo` a `destino` (antes de `antesDe`, o al final) dejando una marca para devolverlo luego. */
function mover(nodo, destino, antesDe = null) {
  if (!nodo || !destino) return;
  if (!marcas.has(nodo.id)) {
    const marca = document.createComment(`agenda-angosta:${nodo.id}`);
    nodo.replaceWith(marca);
    marcas.set(nodo.id, marca);
  }
  if (antesDe) antesDe.before(nodo);
  else destino.append(nodo);
}

function devolver(id) {
  const marca = marcas.get(id);
  const nodo = porId(id);
  if (marca && nodo) {
    marca.replaceWith(nodo);
    marcas.delete(id);
  }
}

function montar() {
  if (montado) return;
  const contenedor = porId("topbar-agenda");
  const semestre = porId("agenda-nombre-semestre");
  const sub = porId("agenda-subheader-dinamico");
  const ajustes = porId("btn-agenda-ajustes");
  const agregar = porId("btn-agenda-agregar");
  const seccion = porId("seccion-agenda");
  const enlaces = porId("btn-topbar-enlaces");
  if (!contenedor || !semestre || !sub || !ajustes || !agregar || !seccion || !enlaces) return;

  mover(semestre, contenedor);
  mover(sub, contenedor);
  mover(ajustes, enlaces.parentNode, enlaces);
  mover(agregar, seccion);
  ajustes.classList.add("btn-topbar-icono");
  agregar.classList.add("agenda-fab");
  document.body.classList.add("agenda-angosta");
  montado = true;
  ajustarSemestre();
}

function desmontar() {
  if (!montado) return;
  porId("btn-agenda-ajustes")?.classList.remove("btn-topbar-icono");
  porId("btn-agenda-agregar")?.classList.remove("agenda-fab");
  ["agenda-nombre-semestre", "agenda-subheader-dinamico", "btn-agenda-ajustes", "btn-agenda-agregar"].forEach(devolver);
  document.body.classList.remove("agenda-angosta");
  montado = false;
  ajustarSemestre();
}

/* ---------- Nombre del semestre: versión que entre en UNA línea ---------- */

let lienzo = null;
function anchoTexto(texto, elemento) {
  lienzo = lienzo || document.createElement("canvas").getContext("2d");
  if (!lienzo) return 0;
  const e = getComputedStyle(elemento);
  lienzo.font = `${e.fontStyle} ${e.fontWeight} ${e.fontSize} ${e.fontFamily}`;
  return lienzo.measureText(texto).width;
}

/** De más largo a más corto: "Semestre 2025-A · Semestre 2025-B" → "Semestre 2025-A · 2025-B" → "2025-A · 2025-B" → "2025-A +1". */
function candidatosSemestre(partes) {
  const completo = partes.join(" · ");
  if (partes.length < 2) return [completo];
  const mas = `+${partes.length - 1}`; // último recurso, sin palabras: no depende del idioma
  const palabras = partes.map((p) => p.trim().split(/\s+/));
  const comun = palabras[0][0];
  if (!palabras.every((w) => w.length > 1 && w[0] === comun)) return [completo, `${partes[0]} ${mas}`];
  const resto = palabras.map((w) => w.slice(1).join(" "));
  return [completo, [partes[0], ...resto.slice(1)].join(" · "), resto.join(" · "), `${resto[0]} ${mas}`];
}

function ajustarSemestre() {
  const boton = porId("agenda-nombre-semestre");
  if (!boton || !nombresSemestre?.length) return; // texto de relleno: ya es corto y lo escribe agenda.js
  const lista = candidatosSemestre(nombresSemestre);
  let elegido = lista[0];
  const contenedor = porId("topbar-agenda");
  const ancho = montado && contenedor ? contenedor.clientWidth : 0;
  if (ancho > 0) {
    const e = getComputedStyle(boton);
    const util = ancho - (parseFloat(e.paddingLeft) || 0) - (parseFloat(e.paddingRight) || 0);
    elegido = lista.find((c) => anchoTexto(c, boton) <= util) || lista[lista.length - 1];
  }
  if (boton.textContent !== elegido) boton.textContent = elegido;
}

/** Lo llama renderizarHeaderAgenda (agenda.js) cada vez que escribe el nombre del semestre. */
export function actualizarTopbarAgenda(partes) {
  nombresSemestre = Array.isArray(partes) && partes.length ? partes.map(String) : null;
  ajustarSemestre();
}

/* ---------- Arranque ---------- */

function sincronizar() {
  if (MQ_ANGOSTO.matches) montar();
  else desmontar();
}

sincronizar();
MQ_ANGOSTO.addEventListener?.("change", sincronizar);

// Agenda usa la barra contextual solo para que <body data-topbar-ctx="agenda"> marque cuándo está abierta
// (el texto de esa barra se oculta por CSS: aquí el encabezado son los propios nodos de Agenda).
window.actualizarTopbarCtx?.("agenda", { titulo: "Agenda" });

let esperaRedimension = null;
window.addEventListener("resize", () => {
  clearTimeout(esperaRedimension);
  esperaRedimension = setTimeout(ajustarSemestre, 100);
});
document.fonts?.ready?.then(ajustarSemestre);
// Al abrir Agenda la barra pasa de oculta a visible: recién ahí hay un ancho real que medir.
new MutationObserver(ajustarSemestre).observe(document.body, { attributes: true, attributeFilter: ["data-topbar-ctx"] });

window.actualizarTopbarAgenda = actualizarTopbarAgenda;
