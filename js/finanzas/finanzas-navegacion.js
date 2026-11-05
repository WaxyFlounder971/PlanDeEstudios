/* =========================================================================
   FINANZAS — Navegación (sub-barra lateral en escritorio, barra inferior en teléfono)

   Antes: una fila de hasta 9 pestañas con scroll horizontal y una fila de botones sueltos.
   Ahora la navegación se agrupa por lo que la persona quiere hacer:

     Inicio
     MI DINERO     Movimientos · Cuentas · Deudas
     PLANIFICAR    Plan · Presupuesto · Metas
     UNIVERSIDAD   Semestres · Beneficios

   Escritorio (≥ 900 px): sub-barra pegada a la barra principal, que se contrae a solo iconos
     mientras estás en Finanzas y vuelve a como estaba al salir.
   Teléfono (< 900 px): barra inferior (Inicio · Movimientos · ＋ · Plan/Metas · Más) y una hoja
     «Más» con todas las secciones agrupadas.

   Este archivo solo dibuja la navegación; qué pestañas hay y qué hace cada botón lo decide
   finanzas.js (renderizarFinanzas) y se lo pasa a configurarNavegacionFinanzas().
   Los botones llevan .finanzas-nav-item[data-valor] y la clase .active en el actual
   (el recorrido guiado de onboarding.js se apoya en eso).
   ========================================================================= */

import { traducirTextoInterfaz } from "../core/i18n.js";

const NS = "http://www.w3.org/2000/svg";
const CLAVE_SIDEBAR_COLAPSADA = "sidebar_colapsada"; // la misma que usa ui/componentes.js

const ICONOS = {
  resumen: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"/><path d="M10 20v-5h4v5"/>',
  "gastos-u": '<path d="M7 20V5m0 0L3.5 8.5M7 5l3.5 3.5"/><path d="M17 4v15m0 0-3.5-3.5M17 19l3.5-3.5"/>',
  cuentas: '<path d="M3 9.5 12 4l9 5.5"/><path d="M5.5 11v6M9.8 11v6M14.2 11v6M18.5 11v6M3.5 20h17"/>',
  deudas: '<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M3 10.5h18M7 15h3"/>',
  plan: '<rect x="4" y="5.5" width="16" height="14.5" rx="3"/><path d="M8 3.5V7M16 3.5V7M4 10.5h16"/><path d="m9.5 15 1.8 1.8 3.2-3.4"/>',
  presupuesto: '<path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5H12z"/><path d="M15 3.8A8.5 8.5 0 0 1 20.2 9H15z"/>',
  metas: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1" fill="currentColor"/>',
  semestres: '<path d="M12 5 2.5 9.5 12 14l9.5-4.5z"/><path d="M6.5 12v4.2c0 1.2 2.4 2.8 5.5 2.8s5.5-1.6 5.5-2.8V12"/>',
  "gastos-estudiantiles": '<path d="m12 3.5 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8z"/>',
  mas: '<circle cx="6" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="18" cy="12" r="1.4" fill="currentColor"/>',
  anadir: '<path d="M12 5v14M5 12h14"/>',
  matricula: '<path d="M6 4h9l3 3v13H6z"/><path d="M9 11h6M9 15h6"/>',
  beca: '<path d="M12 3v18M16.5 7.5c0-1.7-2-3-4.5-3s-4.5 1.3-4.5 3 2 2.7 4.5 3.2 4.5 1.5 4.5 3.3-2 3-4.5 3-4.5-1.3-4.5-3"/>',
};

function crearIcono(nombre) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "finanzas-nav-ico");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.innerHTML = ICONOS[nombre] || "";
  return svg;
}

/** Qué hace cada sección, en una frase: se muestra bajo el título de la pantalla. */
export const INFO_SECCIONES_FINANZAS = {
  resumen: { etiqueta: "Inicio", ayuda: "Cuánto tienes y qué viene pronto." },
  "gastos-u": { etiqueta: "Movimientos", ayuda: "Todo lo que gastas, ganas y ahorras." },
  cuentas: { etiqueta: "Cuentas", ayuda: "Dónde está tu dinero: efectivo, bancos y tarjetas." },
  deudas: { etiqueta: "Deudas", ayuda: "Lo que prestas, lo que te prestan y gastos divididos." },
  plan: { etiqueta: "Plan", ayuda: "Pagos e ingresos que vienen, con su fecha." },
  presupuesto: { etiqueta: "Presupuesto", ayuda: "Cuánto puedes gastar en cada categoría." },
  metas: { etiqueta: "Metas", ayuda: "Lo que estás ahorrando y hacia dónde vas." },
  semestres: { etiqueta: "Semestres", ayuda: "Matrícula y becas de cada semestre." },
  "gastos-estudiantiles": { etiqueta: "Beneficios", ayuda: "Ayudas y gastos estudiantiles." },
};

const GRUPOS = [
  { titulo: null, ids: ["resumen"] },
  { titulo: "Mi dinero", ids: ["gastos-u", "cuentas", "deudas"] },
  { titulo: "Planificar", ids: ["plan", "presupuesto", "metas"] },
  { titulo: "Universidad", ids: ["semestres", "gastos-estudiantiles"] },
];

// Prioridad para rellenar la barra inferior del teléfono con lo más usado que esté disponible.
const PRIORIDAD_BARRA = ["resumen", "gastos-u", "plan", "metas", "presupuesto", "semestres"];

const T = (texto) => traducirTextoInterfaz(texto);

let config = null; // última configuración recibida de finanzas.js
let shellListo = false; // false en onboarding / paso de saldo inicial: ahí no hay navegación
let sidebarAutoColapsada = false;
let elSubnav = null;
let elBarra = null;
let elHoja = null;
let elHojaOverlay = null;

function crearBotonNav(id, { clase = "", etiquetaCorta = false } = {}) {
  const info = INFO_SECCIONES_FINANZAS[id];
  const activo = config && config.activa === id;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "finanzas-nav-item" + (clase ? " " + clase : "") + (activo ? " active" : "");
  btn.dataset.valor = id;
  btn.title = T(info.ayuda);
  if (activo) btn.setAttribute("aria-current", "page");
  const etiqueta = document.createElement("span");
  etiqueta.className = "finanzas-nav-texto";
  etiqueta.textContent = T(info.etiqueta);
  btn.append(crearIcono(id), etiqueta);
  btn.addEventListener("click", () => {
    cerrarHoja();
    config && config.alElegir(id);
  });
  return btn;
}

function crearBotonAccion(texto, icono, clase, alClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = clase;
  const etiqueta = document.createElement("span");
  etiqueta.className = "finanzas-nav-texto";
  etiqueta.textContent = T(texto);
  btn.append(crearIcono(icono), etiqueta);
  btn.addEventListener("click", () => { cerrarHoja(); alClick(); });
  return btn;
}

/** Los grupos con sus secciones visibles (un grupo sin secciones visibles no se muestra). */
function gruposVisibles() {
  const visibles = new Set(config.visibles);
  return GRUPOS
    .map((g) => ({ titulo: g.titulo, ids: g.ids.filter((id) => visibles.has(id)) }))
    .filter((g) => g.ids.length);
}

function construirSubnav() {
  const caja = elSubnav;
  caja.replaceChildren();

  const cab = document.createElement("div");
  cab.className = "finanzas-subnav-cab";
  const titulo = document.createElement("h2");
  titulo.className = "finanzas-subnav-titulo texto-encabezado-seccion";
  titulo.textContent = T("Finanzas");
  cab.appendChild(titulo);
  caja.appendChild(cab);

  const lista = document.createElement("div");
  lista.className = "finanzas-subnav-lista";
  lista.setAttribute("data-finanzas-nav", "");
  gruposVisibles().forEach((g) => {
    const grupo = document.createElement("div");
    grupo.className = "finanzas-nav-grupo";
    grupo.setAttribute("role", "group");
    if (g.titulo) {
      const t = document.createElement("div");
      t.className = "finanzas-nav-grupo-titulo";
      t.textContent = T(g.titulo);
      grupo.setAttribute("aria-label", T(g.titulo));
      grupo.appendChild(t);
    }
    g.ids.forEach((id) => grupo.appendChild(crearBotonNav(id)));
    lista.appendChild(grupo);
  });
  caja.appendChild(lista);

  // «Atajos» queda fijo al fondo (fuera del área con scroll); «Añadir movimiento» es siempre el último.
  if (config.atajos.length || config.anadir) {
    const pie = document.createElement("div");
    pie.className = "finanzas-nav-grupo finanzas-subnav-pie";
    const t = document.createElement("div");
    t.className = "finanzas-nav-grupo-titulo";
    t.textContent = T("Atajos");
    pie.appendChild(t);
    config.atajos.forEach((a) => pie.appendChild(crearBotonAccion(a.texto, a.icono, "finanzas-nav-item finanzas-nav-atajo", a.alClick)));
    if (config.anadir) pie.appendChild(crearBotonAccion("Añadir movimiento", "anadir", "finanzas-nav-item finanzas-nav-atajo finanzas-nav-cta", config.anadir));
    caja.appendChild(pie);
  }
}

function construirBarra() {
  const barra = elBarra;
  barra.replaceChildren();
  barra.setAttribute("data-finanzas-nav", "");
  const visibles = new Set(config.visibles);
  const elegidas = PRIORIDAD_BARRA.filter((id) => visibles.has(id)).slice(0, 3);
  const izquierda = elegidas.slice(0, 2);
  const derecha = elegidas.slice(2);

  izquierda.forEach((id) => barra.appendChild(crearBotonNav(id, { clase: "finanzas-bar-item" })));
  if (config.anadir) {
    const fab = crearBotonAccion("Añadir", "anadir", "finanzas-bar-fab", config.anadir);
    fab.setAttribute("aria-label", T("Añadir movimiento"));
    barra.appendChild(fab);
  }
  derecha.forEach((id) => barra.appendChild(crearBotonNav(id, { clase: "finanzas-bar-item" })));

  const activaEnBarra = elegidas.includes(config.activa);
  const mas = document.createElement("button");
  mas.type = "button";
  mas.className = "finanzas-nav-item finanzas-bar-item finanzas-bar-mas" + (activaEnBarra ? "" : " active");
  mas.setAttribute("aria-haspopup", "dialog");
  const et = document.createElement("span");
  et.className = "finanzas-nav-texto";
  et.textContent = activaEnBarra ? T("Más") : T(INFO_SECCIONES_FINANZAS[config.activa].etiqueta);
  mas.append(crearIcono("mas"), et);
  mas.addEventListener("click", abrirHoja);
  barra.appendChild(mas);
}

function construirHoja() {
  const hoja = elHoja;
  hoja.replaceChildren();
  const asa = document.createElement("div");
  asa.className = "finanzas-hoja-asa";
  asa.setAttribute("aria-hidden", "true");
  hoja.appendChild(asa);
  const h = document.createElement("h2");
  h.className = "finanzas-hoja-titulo texto-encabezado-seccion";
  h.textContent = T("Finanzas");
  hoja.appendChild(h);

  gruposVisibles().forEach((g) => {
    const grupo = document.createElement("div");
    grupo.className = "finanzas-nav-grupo";
    if (g.titulo) {
      const t = document.createElement("div");
      t.className = "finanzas-nav-grupo-titulo";
      t.textContent = T(g.titulo);
      grupo.appendChild(t);
    }
    const rejilla = document.createElement("div");
    rejilla.className = "finanzas-hoja-rejilla";
    g.ids.forEach((id) => rejilla.appendChild(crearBotonNav(id, { clase: "finanzas-hoja-item" })));
    grupo.appendChild(rejilla);
    hoja.appendChild(grupo);
  });

  if (config.atajos.length) {
    const grupo = document.createElement("div");
    grupo.className = "finanzas-nav-grupo";
    const t = document.createElement("div");
    t.className = "finanzas-nav-grupo-titulo";
    t.textContent = T("Atajos");
    grupo.appendChild(t);
    const rejilla = document.createElement("div");
    rejilla.className = "finanzas-hoja-rejilla";
    config.atajos.forEach((a) => rejilla.appendChild(crearBotonAccion(a.texto, a.icono, "finanzas-nav-item finanzas-hoja-item", a.alClick)));
    grupo.appendChild(rejilla);
    hoja.appendChild(grupo);
  }
}

function asegurarElementos() {
  if (!elSubnav) {
    elSubnav = document.createElement("aside");
    elSubnav.id = "finanzas-subnav";
    elSubnav.className = "finanzas-subnav glass-panel";
    elSubnav.setAttribute("aria-label", T("Secciones de Finanzas"));
    elSubnav.hidden = true;
    const sidebar = document.getElementById("app-sidebar");
    if (sidebar && sidebar.parentNode) sidebar.after(elSubnav);
    else document.body.appendChild(elSubnav);
  }
  if (!elBarra) {
    elBarra = document.createElement("nav");
    elBarra.id = "finanzas-bottombar";
    elBarra.className = "finanzas-bottombar";
    elBarra.setAttribute("aria-label", T("Secciones de Finanzas"));
    document.body.appendChild(elBarra);
  }
  if (!elHoja) {
    elHojaOverlay = document.createElement("div");
    elHojaOverlay.className = "finanzas-hoja-overlay";
    elHojaOverlay.addEventListener("click", cerrarHoja);
    elHoja = document.createElement("div");
    elHoja.id = "finanzas-hoja";
    elHoja.className = "finanzas-hoja";
    elHoja.setAttribute("role", "dialog");
    elHoja.setAttribute("aria-modal", "true");
    elHoja.setAttribute("aria-label", T("Secciones de Finanzas"));
    document.body.append(elHojaOverlay, elHoja);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") cerrarHoja(); });
  }
}

function abrirHoja() {
  if (!elHoja) return;
  elHoja.classList.add("abierta");
  elHojaOverlay.classList.add("abierta");
}

function cerrarHoja() {
  if (!elHoja) return;
  elHoja.classList.remove("abierta");
  elHojaOverlay.classList.remove("abierta");
}

/* ------------------------- Barra principal contraída ------------------------- */

function esEscritorio() {
  return window.innerWidth >= 900;
}

function ajustarBarraPrincipal(mostrar) {
  const sidebar = document.getElementById("app-sidebar");
  if (!sidebar) return;
  if (mostrar && esEscritorio()) {
    if (!sidebar.classList.contains("colapsada")) {
      sidebar.classList.add("colapsada");
      sidebarAutoColapsada = true;
    }
  } else if (sidebarAutoColapsada) {
    // Se devuelve a la preferencia guardada de la persona (el botón ⟨⟨ la escribe en localStorage).
    let guardada = false;
    try { guardada = localStorage.getItem(CLAVE_SIDEBAR_COLAPSADA) === "1"; } catch (e) { /* sin storage */ }
    sidebar.classList.toggle("colapsada", guardada);
    sidebarAutoColapsada = false;
  }
}

/** Muestra u oculta la navegación según la sección activa y si el shell de Finanzas está pintado. */
function aplicarVisibilidad(seccion) {
  const actual = seccion || window.__appSeccionActiva;
  const mostrar = shellListo && actual === "finanzas" && Boolean(config);
  document.body.classList.toggle("finanzas-subnav-activa", mostrar);
  if (elSubnav) mostrarSubnav(mostrar);
  if (!mostrar) cerrarHoja();
  ajustarBarraPrincipal(mostrar);
}

/** La sub-barra entra y sale animada (en paralelo a la barra principal que se contrae/expande). */
function mostrarSubnav(mostrar) {
  const sinAnimacion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches || !esEscritorio();
  if (mostrar) {
    const eraVisible = !elSubnav.hidden && !elSubnav.classList.contains("saliendo");
    elSubnav.classList.remove("saliendo");
    if (!eraVisible) {
      elSubnav.hidden = false;
      // Reinicia la animación de entrada.
      elSubnav.style.animation = "none"; void elSubnav.offsetWidth; elSubnav.style.animation = "";
    }
    return;
  }
  if (elSubnav.hidden || elSubnav.classList.contains("saliendo")) return;
  if (sinAnimacion) { elSubnav.hidden = true; return; }
  elSubnav.classList.add("saliendo");
  const terminar = () => {
    if (elSubnav.classList.contains("saliendo")) { elSubnav.hidden = true; elSubnav.classList.remove("saliendo"); }
  };
  elSubnav.addEventListener("animationend", terminar, { once: true });
  setTimeout(terminar, 400); // red de seguridad si el evento no llega
}

/**
 * finanzas.js llama a esto en cada render del shell.
 * @param {{visibles:string[], activa:string, alElegir:(id:string)=>void, anadir:(()=>void)|null,
 *          atajos:{texto:string, icono:string, alClick:()=>void}[]}} nueva
 */
export function configurarNavegacionFinanzas(nueva) {
  config = { ...nueva, atajos: nueva.atajos || [] };
  shellListo = true;
  asegurarElementos();
  construirSubnav();
  construirBarra();
  construirHoja();
  aplicarVisibilidad();
}

/** Onboarding de Finanzas / paso de saldo inicial: no hay navegación que mostrar. */
export function ocultarNavegacionFinanzas() {
  shellListo = false;
  aplicarVisibilidad();
}

/** Lo llama mostrarSeccion() de main.js al cambiar de sección. */
export function sincronizarNavegacionFinanzasPorSeccion(nombre) {
  aplicarVisibilidad(nombre);
}
window.sincronizarNavFinanzas = sincronizarNavegacionFinanzasPorSeccion;

let temporizadorResize = 0;
window.addEventListener("resize", () => {
  clearTimeout(temporizadorResize);
  temporizadorResize = setTimeout(() => aplicarVisibilidad(), 120);
});
