import { estado } from "../core/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { registrarAnaliticaUso } from "../core/analitica.js";
import { notasActuales, opcionesNotas, guardarNota, marcarEliminada, restaurarNota, eliminarDefinitiva, procesarCicloVidaNotas, agendaNotas, COLOR_DEFECTO, resolverColorNota } from "./notas-datos.js";
import "./notas-estilos.js";
import { textoPlanoNota, renderizarHTMLNota } from "./notas-sanitizar.js";
import { abrirEditorNota } from "./notas-editor.js";
import { crearMiniTinta } from "./notas-tinta.js";
import { mostrarPapelera } from "./notas-papelera.js";
import { mostrarAjustesNotas } from "./notas-ajustes.js";
import { procesarCompartidos, compartirNotaFuera } from "./notas-compartir.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { conHistorial, registrarCambio, deshacer, rehacer } from "./notas-historial.js";
import { abrirSticky, alternarFlotante, estaFlotando, restaurarFlotantes } from "./notas-flotante.js";
import { ICONOS, el, contraste, botonIcono, enlazarChecks } from "./notas-ui.js";

const tr = (x) => t(x);
let seleccion = new Set();
let enPapelera = false;

function normalizar(s) { return String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(); }

function notasVisibles() {
  const q = normalizar(document.querySelector("#notas-busqueda")?.value);
  const color = document.querySelector("#notas-filtro-color")?.dataset.value;
  const vence = document.querySelector("#notas-filtro-vence")?.getAttribute("aria-pressed") === "true";
  return notasActuales()
    .filter((n) => (enPapelera ? !!n.eliminada_en : !n.eliminada_en))
    .filter((n) => !q || normalizar(n.titulo + " " + textoPlanoNota(n.contenido)).includes(q))
    .filter((n) => !color || n.color === color)
    .filter((n) => !vence || !!n.vence_en)
    .sort((a, b) => Number(b.fijada) - Number(a.fijada) || (a.fijada && b.fijada ? (a.orden_fijada || 0) - (b.orden_fijada || 0) : (b.modificada_en || 0) - (a.modificada_en || 0)));
}

function confirmarNota(mensaje, { titulo = tr("Confirmar"), textoConfirmar = tr("Continuar"), claseConfirmar = "btn-primary" } = {}) {
  return new Promise((resolve) => abrirConfirmacion({ titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar: () => resolve(true), onCancelar: () => resolve(false) }));
}

async function enviarNotaAWapper(nota, texto) {
  const key = estado.datos.configuracion?.gemini_api_key;
  if (!key) {
    if (await confirmarNota(tr("Para usar Wapper necesitas configurar tu clave de Gemini. ¿Abrir Ajustes?"), { titulo: tr("Configurar Wapper"), textoConfirmar: tr("Abrir Ajustes") })) window.mostrarSeccion?.("configuracion");
    return false;
  }
  if (nota.enviada_a_wapper_en) {
    const f = new Intl.DateTimeFormat(document.documentElement.lang || "es", { day: "numeric", month: "short" }).format(new Date(nota.enviada_a_wapper_en));
    if (!await confirmarNota(tr("Ya enviaste esta nota a Wapper el {fecha}. ¿Enviarla de nuevo?").replace("{fecha}", f), { titulo: tr("Enviar de nuevo"), textoConfirmar: tr("Enviar") })) return false;
  }
  const ok = window.enviarTextoAWapper?.(texto);
  if (!ok) return false;
  nota.enviada_a_wapper_en = Date.now();
  guardarNota(nota);
  registrarAnaliticaUso("notas", "Enviar a Wapper");
  renderizarNotas();
  if (opcionesNotas().papelera_despues_wapper) marcarEliminada(nota);
  return true;
}
window.enviarNotaAWapper = enviarNotaAWapper;

const textoDe = (n) => [n.titulo, textoPlanoNota(n.contenido)].filter(Boolean).join("\n");
const siguienteOrdenFijada = () => Math.max(0, ...notasActuales().filter((n) => n.fijada).map((n) => n.orden_fijada || 0)) + 1;

/* ---------- Acciones sobre una nota (todas entran al historial: Ctrl+Z / Ctrl+Y) ---------- */
function alternarFijada(nota) {
  conHistorial(nota.fijada ? "Desfijar nota" : "Fijar nota", [nota.id], () => {
    nota.fijada = !nota.fijada;
    nota.orden_fijada = nota.fijada ? siguienteOrdenFijada() : null;
    guardarNota(nota);
  });
  renderizarNotas();
}
function clonarNota(nota) {
  const { id, ...copia } = nota;
  const n = guardarNota({ ...copia, id: null, titulo: nota.titulo ? `${nota.titulo} (${tr("copia")})` : "", eliminada_en: null, creada_en: Date.now() });
  registrarCambio("Duplicar nota", [{ id: n.id, nota: null }]); // antes: la copia no existía
  renderizarNotas();
}
async function eliminarConConfirmacion(nota) {
  if (await confirmarNota(tr("¿Enviar esta nota a la Papelera?"), { titulo: tr("Eliminar nota"), textoConfirmar: tr("Eliminar"), claseConfirmar: "btn-danger" })) {
    conHistorial("Eliminar nota", [nota.id], () => marcarEliminada(nota));
    renderizarNotas();
  }
}
const compartirNota = async (nota) => { if (await compartirNotaFuera(textoDe(nota), nota.titulo)) registrarAnaliticaUso("notas", "Compartir nota"); };
const wapperNota = (nota) => conHistorial("Enviar a Wapper", [nota.id], () => enviarNotaAWapper(nota, textoDe(nota)));
function moverFijada(nota, delta) {
  const pins = notasActuales().filter((n) => n.fijada).sort((a, b) => (a.orden_fijada || 0) - (b.orden_fijada || 0));
  const i = pins.indexOf(nota), j = Math.max(0, Math.min(pins.length - 1, i + delta));
  if (i === j) return;
  conHistorial("Reordenar notas fijadas", pins.map((n) => n.id), () => {
    [pins[i], pins[j]] = [pins[j], pins[i]];
    pins.forEach((n, k) => { n.orden_fijada = k + 1; n._mod_manual = true; guardarNota(n); });
  });
  renderizarNotas();
}

function contenedorScroll(nodo) {
  for (let n = nodo.parentElement; n && n !== document.body; n = n.parentElement) {
    const o = getComputedStyle(n).overflowY;
    if ((o === "auto" || o === "scroll") && n.scrollHeight > n.clientHeight + 1) return n;
  }
  return null;
}

// Reordenar fijadas con punteros (mouse, dedo y lápiz): la tarjeta sigue al cursor y las demás se acomodan en vivo.
function iniciarArrastre(e, card, asa) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const grid = card.parentElement;
  if (!grid) return;
  e.preventDefault(); e.stopPropagation();
  const r = card.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const ghost = card.cloneNode(true);
  ghost.classList.add("nota-arrastrando"); ghost.removeAttribute("data-id"); ghost.removeAttribute("data-fijada");
  Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", pointerEvents: "none", zIndex: "1000" });
  document.body.append(ghost);
  card.style.opacity = ".28";
  document.body.classList.add("nota-arrastrando-body");
  try { asa.setPointerCapture(e.pointerId); } catch (_) {}
  const scroller = contenedorScroll(grid);
  let ultimo = e, raf = 0, terminado = false;
  const esLista = grid.classList.contains("notas-lista");
  const acomodar = () => {
    ghost.style.left = `${ultimo.clientX - dx}px`; ghost.style.top = `${ultimo.clientY - dy}px`;
    const bajo = document.elementsFromPoint(ultimo.clientX, ultimo.clientY).find((n) => n !== card && n.matches?.('.nota-card[data-fijada="1"]') && n.parentElement === grid);
    if (!bajo) return;
    const b = bajo.getBoundingClientRect();
    const antes = esLista ? ultimo.clientY < b.top + b.height / 2 : ultimo.clientX < b.left + b.width / 2;
    if (antes) { if (bajo.previousElementSibling !== card) bajo.before(card); } else if (bajo.nextElementSibling !== card) bajo.after(card);
  };
  const auto = () => {
    if (terminado) return;
    const alto = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const y = ultimo.clientY, borde = 70;
    let v = 0;
    if (y < alto.top + borde) v = -Math.min(24, (alto.top + borde - y) / 3); else if (y > alto.bottom - borde) v = Math.min(24, (y - (alto.bottom - borde)) / 3);
    if (v) { if (scroller) scroller.scrollTop += v; else scrollBy(0, v); acomodar(); }
    raf = requestAnimationFrame(auto);
  };
  const mover = (ev) => { ultimo = ev; acomodar(); };
  const limpiar = () => {
    terminado = true; cancelAnimationFrame(raf); ghost.remove(); card.style.opacity = "";
    document.body.classList.remove("nota-arrastrando-body");
    asa.removeEventListener("pointermove", mover); asa.removeEventListener("pointerup", soltar); asa.removeEventListener("pointercancel", cancelar);
    document.removeEventListener("keydown", teclas);
    try { asa.releasePointerCapture(e.pointerId); } catch (_) {}
  };
  const soltar = () => {
    limpiar();
    const ids = [...grid.querySelectorAll('.nota-card[data-fijada="1"]')].map((c) => c.dataset.id);
    conHistorial("Reordenar notas fijadas", ids, () => {
      ids.forEach((id, i) => { const n = notasActuales().find((x) => x.id === id); if (n && n.orden_fijada !== i + 1) { n.orden_fijada = i + 1; n._mod_manual = true; guardarNota(n); } });
    });
    renderizarNotas();
  };
  const cancelar = () => { limpiar(); renderizarNotas(); };
  const teclas = (k) => { if (k.key === "Escape") { k.preventDefault(); cancelar(); } };
  asa.addEventListener("pointermove", mover); asa.addEventListener("pointerup", soltar); asa.addEventListener("pointercancel", cancelar);
  document.addEventListener("keydown", teclas);
  raf = requestAnimationFrame(auto);
}

const fechaCorta = (iso) => new Intl.DateTimeFormat(document.documentElement.lang || "es", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));

function construirTarjeta(nota) {
  const card = el("article", "glass-card nota-card");
  card.dataset.id = nota.id;
  card.dataset.fijada = nota.fijada ? "1" : "0";
  const colorTarjeta = resolverColorNota(nota.color || COLOR_DEFECTO);
  card.style.setProperty("--nota-color", colorTarjeta);
  card.style.setProperty("color", contraste(colorTarjeta), "important");
  card.classList.toggle("seleccionada", seleccion.has(nota.id));
  card.classList.toggle("nota-flotando", estaFlotando(nota.id));

  // Arriba: insignias (vencimiento, pendientes, Wapper, flotante) a la izquierda y el asa de arrastre (solo fijadas) a la derecha.
  let asa = null;
  if (nota.fijada) {
    asa = el("button", "nota-icon-action nota-drag-handle");
    asa.type = "button"; asa.innerHTML = ICONOS.asa; asa.title = tr("Arrastrar para reordenar"); asa.setAttribute("aria-label", asa.title);
    asa.onclick = (e) => e.stopPropagation();
    asa.addEventListener("pointerdown", (e) => iniciarArrastre(e, card, asa));
    asa.addEventListener("keydown", (e) => {
      const d = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 }[e.key];
      if (d) { e.preventDefault(); e.stopPropagation(); moverFijada(nota, d); }
    });
  }

  const h = nota.titulo ? el("strong", "nota-titulo-card", nota.titulo) : null;
  const preview = el("div", "nota-preview");
  renderizarHTMLNota(preview, nota.contenido);
  enlazarChecks(preview, nota);

  const expand = el("button", "nota-expand", "⌄");
  expand.title = tr("Expandir"); expand.setAttribute("aria-label", tr("Expandir"));
  expand.onclick = (e) => {
    e.stopPropagation();
    card.classList.toggle("expandida");
    const abierta = card.classList.contains("expandida");
    const label = tr(abierta ? "Contraer" : "Expandir");
    expand.textContent = abierta ? "⌃" : "⌄"; expand.title = label; expand.setAttribute("aria-label", label);
  };
  requestAnimationFrame(() => { if (preview.scrollHeight <= preview.clientHeight + 1) expand.remove(); });

  // Fila superior: insignias a la izquierda, asa de arrastre a la derecha (solo si hay algo que mostrar).
  const insignias = el("div", "nota-card-badges");
  if (nota.vence_en) insignias.append(el("span", "badge badge-warning", `⏳ ${fechaCorta(nota.vence_en)}`));
  const checks = preview.querySelectorAll("input[type=checkbox]");
  if (checks.length) insignias.append(el("span", "badge badge-info", `${[...checks].filter((c) => c.checked).length}/${checks.length}`));
  if (nota.enviada_a_wapper_en) insignias.append(el("span", "badge badge-purple", `✨ ${tr("Enviada a Wapper")}`));
  const chipFlot = el("span", "nt-chip-flot"); chipFlot.innerHTML = ICONOS.flotar; chipFlot.append(document.createTextNode(tr("Flotante")));
  insignias.append(chipFlot);
  let top = null;
  if (asa || insignias.querySelector(".badge") || estaFlotando(nota.id)) {
    top = el("header", "nota-card-top");
    top.append(insignias);
    if (asa) top.append(asa);
  }

  // Seis botones en tres grupos: Anclar · Flotar | Wapper · Compartir | Duplicar · Borrar
  const foot = el("footer", "nota-card-foot");
  const acciones = el("div", "nota-card-actions");
  const flotando = estaFlotando(nota.id);
  const sep = () => { const s = el("span", "nt-vsep"); s.setAttribute("aria-hidden", "true"); return s; };
  acciones.append(
    botonIcono({ icono: ICONOS.anclar, titulo: tr(nota.fijada ? "Desfijar" : "Fijar"), clase: "nota-pin-action", activo: !!nota.fijada, onclick: (e) => { e.stopPropagation(); alternarFijada(nota); } }),
    botonIcono({ icono: flotando ? ICONOS.quitarFlotante : ICONOS.flotar, titulo: tr(flotando ? "Quitar de flotante" : "Dejar flotante"), clase: "nota-flotar-action", activo: flotando, onclick: (e) => { e.stopPropagation(); alternarFlotante(nota.id, card); renderizarNotas(); } }),
    sep(),
    botonIcono({ icono: "✨", titulo: tr("Enviar a Wapper"), onclick: (e) => { e.stopPropagation(); wapperNota(nota); } }),
    botonIcono({ icono: ICONOS.compartir, titulo: tr("Compartir"), onclick: (e) => { e.stopPropagation(); compartirNota(nota); } }),
    sep(),
    botonIcono({ icono: ICONOS.duplicar, titulo: tr("Duplicar"), onclick: (e) => { e.stopPropagation(); clonarNota(nota); } }),
    botonIcono({ icono: "🗑️", titulo: tr("Eliminar"), clase: "nota-eliminar-action", onclick: (e) => { e.stopPropagation(); eliminarConConfirmacion(nota); } }),
  );
  foot.append(acciones);

  const mini = crearMiniTinta(nota.tinta);
  card.append(...[top, h, preview, mini, expand, foot].filter(Boolean));

  let pressTimer = null, longPress = false;
  card.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button,input,a")) return;
    longPress = false;
    pressTimer = setTimeout(() => { longPress = true; alternarSeleccion(nota.id); }, 550);
  });
  card.addEventListener("pointermove", (e) => { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 10) clearTimeout(pressTimer); });
  ["pointerup", "pointercancel", "pointerleave"].forEach((ev) => card.addEventListener(ev, () => clearTimeout(pressTimer)));
  card.addEventListener("contextmenu", (e) => { e.preventDefault(); abrirMenuNota(nota, e.clientX, e.clientY, card); });
  card.onclick = () => {
    if (longPress) { longPress = false; return; }
    if (seleccion.size) alternarSeleccion(nota.id);
    else abrirSticky(nota, card); // se levanta como un sticky; desde ahí se entra a Editar
  };
  return card;
}

function abrirMenuNota(nota, x, y, card) {
  document.querySelector(".notas-menu-contextual")?.remove();
  const menu = el("div", "notas-menu-contextual glass-card");
  menu.setAttribute("role", "menu");
  const flotando = estaFlotando(nota.id);
  const acciones = [
    [ICONOS.editar, tr("Editar"), () => abrirEditorNota(nota.id, renderizarNotas)],
    [seleccion.has(nota.id) ? "✖️" : "☑️", seleccion.has(nota.id) ? tr("Quitar selección") : tr("Seleccionar"), () => alternarSeleccion(nota.id)],
    ["✨", tr("Enviar a Wapper"), () => wapperNota(nota)],
    [ICONOS.compartir, tr("Compartir"), () => compartirNota(nota)],
    [ICONOS.anclar, nota.fijada ? tr("Desfijar") : tr("Fijar"), () => alternarFijada(nota)],
    [flotando ? ICONOS.quitarFlotante : ICONOS.flotar, flotando ? tr("Quitar de flotante") : tr("Dejar flotante"), () => { alternarFlotante(nota.id, card); renderizarNotas(); }],
    [ICONOS.duplicar, tr("Duplicar"), () => clonarNota(nota)],
    ["🗑️", tr("Eliminar"), () => eliminarConConfirmacion(nota)],
  ];
  for (const [icono, texto, fn] of acciones) {
    const b = el("button", "notas-menu-item");
    b.type = "button"; b.setAttribute("role", "menuitem");
    const ico = el("span", "nt-mi-ico");
    if (icono.startsWith("<svg")) ico.innerHTML = icono; else ico.textContent = icono;
    ico.setAttribute("aria-hidden", "true");
    b.append(ico, el("span", "", texto));
    b.onclick = () => { menu.remove(); fn(); };
    menu.append(b);
  }
  document.body.append(menu);
  const mr = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(8, Math.min(x, innerWidth - mr.width - 8))}px`;
  menu.style.top = `${Math.max(8, Math.min(y, innerHeight - mr.height - 8))}px`;
  const cerrar = (e) => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener("pointerdown", cerrar, true); } };
  setTimeout(() => document.addEventListener("pointerdown", cerrar, true), 0);
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") menu.remove(); });
  menu.querySelector("button")?.focus();
}

function alternarSeleccion(id) {
  const antes = seleccion.size;
  if (seleccion.has(id)) seleccion.delete(id); else seleccion.add(id);
  if (!antes && seleccion.size) history.pushState({ appNav: true, appSeccion: "notas", notasSeleccion: true }, "", location.href);
  if (!seleccion.size) {
    document.body.classList.remove("notas-seleccionando");
    if (history.state?.notasSeleccion) history.replaceState({ appNav: true, appSeccion: "notas" }, "", location.href);
  } else document.body.classList.add("notas-seleccionando");
  renderizarNotas();
}

function barraSeleccion() {
  const bar = el("div", "notas-seleccion-bar");
  bar.append(el("span", "", tr("{n} seleccionadas").replace("{n}", String(seleccion.size))));
  const boton = (label, fn) => { const b = el("button", "btn btn-secondary", label); b.onclick = fn; bar.append(b); };
  const elegidas = () => notasActuales().filter((n) => seleccion.has(n.id));
  if (enPapelera) {
    boton(tr("Restaurar"), () => { const xs = elegidas(); conHistorial("Restaurar notas", xs.map((n) => n.id), () => xs.forEach(restaurarNota)); seleccion.clear(); renderizarNotas(); });
    boton(tr("Eliminar definitivamente"), async () => {
      if (await confirmarNota(tr("¿Eliminar definitivamente las notas seleccionadas?"), { titulo: tr("Eliminar definitivamente"), textoConfirmar: tr("Eliminar"), claseConfirmar: "btn-danger" })) {
        const xs = elegidas(); conHistorial("Eliminar definitivamente", xs.map((n) => n.id), () => xs.forEach(eliminarDefinitiva)); seleccion.clear(); renderizarNotas();
      }
    });
  } else {
    boton(tr("Eliminar"), async () => {
      if (await confirmarNota(tr("¿Enviar {n} notas a la Papelera?").replace("{n}", String(seleccion.size)), { titulo: tr("Eliminar notas"), textoConfirmar: tr("Eliminar"), claseConfirmar: "btn-danger" })) {
        const xs = elegidas(); conHistorial("Eliminar notas", xs.map((n) => n.id), () => xs.forEach((n) => marcarEliminada(n))); seleccion.clear(); renderizarNotas();
      }
    });
    boton("📌 " + tr("Fijar / desfijar"), () => {
      const xs = elegidas(), fijar = xs.some((n) => !n.fijada);
      conHistorial(fijar ? "Fijar notas" : "Desfijar notas", xs.map((n) => n.id), () => xs.forEach((n, i) => { n.fijada = fijar; n.orden_fijada = fijar ? Date.now() + i : null; guardarNota(n); }));
      seleccion.clear(); renderizarNotas();
    });
    boton(tr("Enviar a Wapper"), async () => {
      const xs = elegidas();
      const texto = xs.map(textoDe).join("\n\n");
      if (xs.length) await conHistorial("Enviar a Wapper", [xs[0].id], () => enviarNotaAWapper(xs[0], texto));
      seleccion.clear(); renderizarNotas();
    });
    const visibles = notasVisibles();
    const todas = visibles.length > 0 && visibles.every((n) => seleccion.has(n.id));
    boton(tr(todas ? "Quitar selección" : "Seleccionar todo"), () => {
      if (todas) visibles.forEach((n) => seleccion.delete(n.id)); else visibles.forEach((n) => seleccion.add(n.id));
      if (!seleccion.size) document.body.classList.remove("notas-seleccionando");
      renderizarNotas();
    });
  }
  boton(tr("Cancelar"), () => { seleccion.clear(); document.body.classList.remove("notas-seleccionando"); renderizarNotas(); });
  return bar;
}

const ICONO_CUADRICULA = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1.6"/><rect x="11" y="2" width="7" height="7" rx="1.6"/><rect x="2" y="11" width="7" height="7" rx="1.6"/><rect x="11" y="11" width="7" height="7" rx="1.6"/></svg>';
const ICONO_LISTA = '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="3" width="16" height="3" rx="1.5"/><rect x="2" y="8.5" width="16" height="3" rx="1.5"/><rect x="2" y="14" width="16" height="3" rx="1.5"/></svg>';

function selectorVista(root) {
  const grupo = el("div", "nt-vista");
  grupo.setAttribute("role", "radiogroup"); grupo.setAttribute("aria-label", tr("Vista"));
  const ops = [["cuadricula", ICONO_CUADRICULA, tr("Cuadrícula")], ["lista", ICONO_LISTA, tr("Lista")]];
  for (const [valor, icono, nombre] of ops) {
    const b = el("button", "nt-vista-op");
    b.type = "button"; b.innerHTML = icono; b.title = nombre; b.setAttribute("aria-label", nombre); b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(opcionesNotas().vista === valor));
    b.onclick = () => {
      if (opcionesNotas().vista === valor) return;
      opcionesNotas().vista = valor; sellarTimestamp(estado.datos.configuracion); marcarCambioPendiente();
      const aplicar = () => {
        root.querySelector(".notas-grid")?.classList.toggle("notas-lista", valor === "lista");
        grupo.querySelectorAll("[role=radio]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      };
      if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(aplicar); else aplicar();
    };
    grupo.append(b);
  }
  return grupo;
}

function renderizarNotas() {
  const root = document.getElementById("seccion-notas");
  if (!root || !estado.datos) return;
  procesarCicloVidaNotas(); procesarCompartidos();
  root.replaceChildren(); root.classList.add("stack", "notas-seccion");

  const cab = el("header", "notas-cabecera");
  const acciones = el("div", "row notas-cab-acciones");
  const add = el("button", "btn btn-primary", "➕");
  add.title = tr("Nueva nota"); add.setAttribute("aria-label", add.title); add.onclick = () => abrirEditorNota(null, renderizarNotas);
  const settings = el("button", "btn btn-secondary", "⚙️");
  settings.title = tr("Ajustes de Notas"); settings.setAttribute("aria-label", settings.title);
  settings.onclick = () => mostrarAjustesNotas(renderizarNotas, () => mostrarPapelera(root, renderizarNotas));
  acciones.append(add, settings);
  cab.append(el("h1", "", tr("Notas rápidas")), acciones);
  root.append(cab);

  const search = el("input", "form-input notas-busqueda visible");
  search.id = "notas-busqueda"; search.type = "search"; search.placeholder = tr("Buscar notas"); search.setAttribute("aria-label", tr("Buscar notas"));
  const barra = el("div", "notas-toolbar-vista");
  barra.append(search, selectorVista(root));
  root.append(barra);

  const filtros = el("div", "row notas-filtros");
  const color = el("div", "notas-palette notas-filtro-colores");
  color.id = "notas-filtro-color"; color.dataset.value = "";
  const dotsBase = [...new Set(notasActuales().filter((n) => !n.eliminada_en).map((n) => n.color).filter(Boolean))];
  const setColor = (v) => { color.dataset.value = v; color.querySelectorAll("[data-color]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.color === v))); color.onchange(); };
  if (dotsBase.length > 1) dotsBase.forEach((c) => {
    const b = el("button", "notas-color");
    b.type = "button"; b.dataset.color = c; b.style.backgroundColor = resolverColorNota(c); b.title = c; b.setAttribute("aria-label", c); b.setAttribute("aria-pressed", "false");
    b.onclick = () => setColor(color.dataset.value === c ? "" : c);
    color.append(b);
  });
  // "Con vencimiento": botón con el mismo estilo que las bolitas de color (se ilumina al activarlo).
  const due = el("button", "notas-color nt-filtro-vence", `⏳ ${tr("Con vencimiento")}`);
  due.id = "notas-filtro-vence"; due.type = "button"; due.setAttribute("aria-pressed", "false");
  due.onclick = () => { due.setAttribute("aria-pressed", String(due.getAttribute("aria-pressed") !== "true")); repintar(); };
  if (color.childElementCount) { filtros.append(color); const s = el("span", "nt-vsep"); s.setAttribute("aria-hidden", "true"); filtros.append(s); }
  filtros.append(due);
  root.append(filtros);

  const lista = el("div", `notas-grid ${opcionesNotas().vista === "lista" ? "notas-lista" : ""}`);
  const items = notasVisibles();
  window.__notasLista = items;
  items.forEach((n) => lista.append(construirTarjeta(n)));
  if (!items.length) {
    const vacio = el("div", "glass-card notas-vacio stack");
    vacio.innerHTML = `<div aria-hidden="true">🗒️</div><h2>${tr("Tus ideas, siempre a mano")}</h2><p>${tr("Toca + para tu primera nota")}</p>`;
    const go = el("button", "btn btn-primary", "＋");
    go.onclick = () => abrirEditorNota(null, renderizarNotas);
    vacio.append(go);
    lista.append(vacio);
  }
  root.append(lista);
  if (seleccion.size) root.append(barraSeleccion());
  const repintar = () => lista.replaceChildren(...notasVisibles().map(construirTarjeta));
  search.oninput = repintar; color.onchange = repintar;
  restaurarFlotantes();
  window.dispatchEvent(new Event("notas:actualizadas-ui"));
}

/** Ctrl+Z / Ctrl+Y sobre la lista de notas (eliminar, editar, fijar, duplicar, reordenar, restaurar…). */
function atajosHistorial(e) {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k !== "z" && k !== "y") return;
  const root = document.getElementById("seccion-notas");
  if (!root || root.offsetParent === null) return; // solo con Notas visible
  if (document.querySelector(".notas-editor, .notas-ajustes, .nt-sticky-overlay")) return; // el editor tiene su propio deshacer
  const a = e.target;
  if (a && (a.isContentEditable || a.matches?.("input, textarea, select"))) return;
  e.preventDefault();
  const rehaciendo = k === "y" || e.shiftKey;
  const etiqueta = rehaciendo ? rehacer() : deshacer();
  mostrarToast(etiqueta ? `${tr(rehaciendo ? "Rehecho" : "Deshecho")}: ${tr(etiqueta)}` : tr(rehaciendo ? "No hay nada que rehacer" : "No hay nada que deshacer"));
}

function inicializarNotas() {
  agendaNotas();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && seleccion.size) { seleccion.clear(); document.body.classList.remove("notas-seleccionando"); renderizarNotas(); } });
  document.addEventListener("keydown", atajosHistorial);
  window.addEventListener("notas:actualizadas", renderizarNotas);
  window.addEventListener("notas:compartido", (e) => { renderizarNotas(); mostrarAvisoCompartido(e.detail); });
  window.addEventListener("notas:abrir", (e) => { window.mostrarSeccion?.("notas"); setTimeout(() => abrirEditorNota(e.detail, renderizarNotas), 100); });
  window.addEventListener("notas:abrir-compartida", (e) => { window.mostrarSeccion?.("notas"); setTimeout(() => abrirEditorNota(e.detail, renderizarNotas), 100); });
  window.addEventListener("popstate", (e) => {
    if (seleccion.size) { seleccion.clear(); document.body.classList.remove("notas-seleccionando"); e.stopImmediatePropagation(); window.history.pushState({ appNav: true, appSeccion: "notas" }, "", window.location.href); renderizarNotas(); }
  });
  // Las notas flotantes reaparecen al abrir la app aunque no entres a Notas (espera a que carguen los datos).
  let intentos = 0;
  const esperar = setInterval(() => { if (restaurarFlotantes() || ++intentos > 40) clearInterval(esperar); }, 500);
}

function mostrarAvisoCompartido(id) {
  const aviso = el("div", "notas-share-toast glass-card");
  const abrir = el("button", "btn btn-secondary", tr("Abrir"));
  abrir.onclick = () => { aviso.remove(); window.mostrarSeccion?.("notas"); window.dispatchEvent(new CustomEvent("notas:abrir", { detail: id })); };
  const deshacerBtn = el("button", "btn btn-secondary", tr("Deshacer"));
  deshacerBtn.onclick = () => { const nota = notasActuales().find((n) => n.id === id); if (nota) conHistorial("Nota compartida", [id], () => marcarEliminada(nota)); aviso.remove(); };
  aviso.append(el("span", "", tr("Guardado en Notas rápidas")), abrir, deshacerBtn);
  document.body.append(aviso);
  setTimeout(() => aviso.remove(), 10000);
}

window.restaurarNotaRapid = restaurarNota; window.eliminarNotaDefinitiva = eliminarDefinitiva; window.procesarNotasCompartidas = procesarCompartidos;
window.renderizarNotas = renderizarNotas;
export { inicializarNotas, renderizarNotas };
