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
import { fijarFinanzasAbierta } from "../ui/layout-lateral.js";
import { estado } from "../core/storage/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";

const NS = "http://www.w3.org/2000/svg";

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
  ajustes: '<circle cx="12" cy="5.5" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="18.5" r="1.5" fill="currentColor"/>',
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

/* ------------------------- Favoritos de la barra inferior (fix10) ------------------------- */

const CLAVE_FAVORITOS = "finanzas_barra_favoritos";
const FAVORITOS_DEFAULT = ["resumen", "gastos-u"];

/** Orden en que se recorren las secciones al deslizar: el mismo de la lista «Más» (solo las visibles). */
function idsEnOrden() {
  return gruposVisibles().flatMap((g) => g.ids);
}

/** Los 2 favoritos válidos (visibles) de la barra; si faltan, se completan con los predeterminados. */
function leerFavoritos() {
  const visibles = new Set(config.visibles);
  const guardados = estado.datos && estado.datos.configuracion ? estado.datos.configuracion[CLAVE_FAVORITOS] : null;
  const salida = [];
  [...(Array.isArray(guardados) ? guardados : []), ...FAVORITOS_DEFAULT, ...PRIORIDAD_BARRA].forEach((id) => {
    if (salida.length < 2 && visibles.has(id) && !salida.includes(id)) salida.push(id);
  });
  return salida;
}

function guardarFavoritos(ids) {
  if (!estado.datos.configuracion) estado.datos.configuracion = {};
  estado.datos.configuracion[CLAVE_FAVORITOS] = ids.slice(0, 2);
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
}

let config = null; // última configuración recibida de finanzas.js
let shellListo = false; // false en onboarding / paso de saldo inicial: ahí no hay navegación
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
  const elegidas = leerFavoritos();
  const izquierda = elegidas;
  const derecha = [];

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
  const cabecera = document.createElement("div");
  cabecera.className = "finanzas-hoja-cab";
  const h = document.createElement("h2");
  h.className = "finanzas-hoja-titulo texto-encabezado-seccion";
  h.textContent = modoAjustesHoja ? T("Ajustes de Finanzas") : T("Finanzas");
  const btnAjustes = document.createElement("button");
  btnAjustes.type = "button";
  btnAjustes.className = "finanzas-hoja-ajustes";
  btnAjustes.setAttribute("aria-label", modoAjustesHoja ? T("Volver") : T("Ajustes de Finanzas"));
  btnAjustes.title = btnAjustes.getAttribute("aria-label");
  if (modoAjustesHoja) btnAjustes.textContent = "✕";
  else btnAjustes.appendChild(crearIcono("ajustes"));
  btnAjustes.addEventListener("click", () => { modoAjustesHoja = !modoAjustesHoja; construirHoja(); });
  cabecera.append(h, btnAjustes);
  hoja.appendChild(cabecera);

  if (modoAjustesHoja) { construirPanelAjustes(hoja); return; }

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

let modoAjustesHoja = false;

/** Panel «Ajustes de Finanzas»: elegir los 2 favoritos de la barra inferior y reabrir la guía. */
function construirPanelAjustes(hoja) {
  const intro = document.createElement("p");
  intro.className = "muted";
  intro.style.margin = "0";
  intro.textContent = T("Elige 2 favoritos para la barra de abajo. El resto sigue en «Más» y también puedes llegar deslizando a los lados.");
  hoja.appendChild(intro);

  const rejilla = document.createElement("div");
  rejilla.className = "finanzas-hoja-rejilla";
  const pintar = () => {
    rejilla.replaceChildren();
    const favs = leerFavoritos();
    idsEnOrden().forEach((id) => {
      const info = INFO_SECCIONES_FINANZAS[id];
      const btn = document.createElement("button");
      btn.type = "button";
      const elegido = favs.includes(id);
      btn.className = "finanzas-nav-item finanzas-hoja-item finanzas-fav-opcion" + (elegido ? " active" : "");
      btn.setAttribute("aria-pressed", String(elegido));
      const et = document.createElement("span");
      et.className = "finanzas-nav-texto";
      et.textContent = T(info.etiqueta);
      btn.append(crearIcono(id), et);
      btn.addEventListener("click", () => {
        let nuevos = leerFavoritos();
        if (nuevos.includes(id)) {
          if (nuevos.length <= 1) return; // siempre quedan 2 (o 1 si solo hay 1 visible)
          nuevos = nuevos.filter((x) => x !== id);
          // se completa con el siguiente predeterminado para mantener 2
          const relleno = [...FAVORITOS_DEFAULT, ...PRIORIDAD_BARRA].find((x) => x !== id && !nuevos.includes(x) && new Set(config.visibles).has(x));
          if (relleno) nuevos.push(relleno);
        } else {
          nuevos = [nuevos[nuevos.length - 1], id]; // el más viejo sale, entra el nuevo
        }
        guardarFavoritos(nuevos.filter(Boolean));
        pintar();
        construirBarra();
      });
      rejilla.appendChild(btn);
    });
  };
  pintar();
  hoja.appendChild(rejilla);

  const acciones = document.createElement("div");
  acciones.className = "row";
  acciones.style.cssText = "gap:8px; flex-wrap:wrap; margin-top:8px;";
  const restablecer = document.createElement("button");
  restablecer.type = "button";
  restablecer.className = "btn btn-secondary";
  restablecer.textContent = T("Restablecer");
  restablecer.addEventListener("click", () => { guardarFavoritos(FAVORITOS_DEFAULT.filter((id) => new Set(config.visibles).has(id))); pintar(); construirBarra(); });
  const guia = document.createElement("button");
  guia.type = "button";
  guia.className = "btn btn-secondary";
  guia.textContent = T("Cómo funciona Finanzas");
  guia.addEventListener("click", () => { cerrarHoja(); modoAjustesHoja = false; construirHoja(); config.alAbrirGuia && config.alAbrirGuia(); });
  const listo = document.createElement("button");
  listo.type = "button";
  listo.className = "btn btn-primary";
  listo.textContent = T("Listo");
  listo.addEventListener("click", () => { modoAjustesHoja = false; construirHoja(); });
  acciones.append(restablecer, guia, listo);
  hoja.appendChild(acciones);
}

/* ------------------------- Gesto de deslizar entre secciones (teléfono) ------------------------- */

let gestoInstalado = false;
function hayCapaAbierta() {
  return Boolean(
    (elHoja && elHoja.classList.contains("abierta")) ||
    document.querySelector(".modal-overlay:not(.oculto):not([hidden]), .onboarding-overlay, .app-sidebar.abierta, .drawer-enlaces-movil.abierta")
  );
}
function dentroDeScrollHorizontal(el) {
  for (let n = el; n && n !== document.body; n = n.parentElement) {
    if (n.matches && n.matches("input, textarea, select, canvas, [contenteditable='true'], .select-custom-lista, [data-no-deslizar]")) return true;
    const cs = n.nodeType === 1 ? getComputedStyle(n) : null;
    if (cs && /(auto|scroll)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 2) return true;
  }
  return false;
}
function instalarGestoDeslizar() {
  if (gestoInstalado) return;
  gestoInstalado = true;
  let ini = null;
  document.addEventListener("touchstart", (e) => {
    ini = null;
    if (esEscritorio() || !config || !shellListo || window.__appSeccionActiva !== "finanzas" || e.touches.length !== 1) return;
    const t = e.touches[0];
    if (t.clientX < 28 || t.clientX > window.innerWidth - 28) return; // bordes: gestos del sistema
    if (hayCapaAbierta() || dentroDeScrollHorizontal(e.target)) return;
    ini = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, { passive: true });
  document.addEventListener("touchend", (e) => {
    if (!ini) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - ini.x, dy = t.clientY - ini.y, dt = Date.now() - ini.t;
    ini = null;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.55 || dt > 700) return;
    const ids = idsEnOrden();
    const i = ids.indexOf(config.activa);
    if (i < 0) return;
    const j = dx < 0 ? i + 1 : i - 1; // deslizar a la izquierda = siguiente
    if (j < 0 || j >= ids.length) return;
    config.alElegir(ids[j]);
    const sec = document.getElementById("seccion-finanzas");
    if (sec && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      sec.classList.remove("finanzas-desliza-sig", "finanzas-desliza-ant");
      void sec.offsetWidth;
      sec.classList.add(dx < 0 ? "finanzas-desliza-sig" : "finanzas-desliza-ant");
    }
  }, { passive: true });
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
  if (modoAjustesHoja) { modoAjustesHoja = false; construirHoja(); }
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

/** Quién contrae la barra principal (y los Enlaces rápidos de la derecha) vive en ui/layout-lateral.js. */
function ajustarBarraPrincipal(mostrarFinanzas) {
  fijarFinanzasAbierta(mostrarFinanzas);
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
  instalarGestoDeslizar();
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

// Estado inicial (la barra contraída por ancho debe verse desde que carga la app, sin esperar a Finanzas).
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => aplicarVisibilidad());
else aplicarVisibilidad();
