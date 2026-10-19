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
    .sort(comparadorNotas());
}

// Orden de la lista: las fijadas van primero en el orden que les diste (arrastrando); las demás por fecha, ascendente o descendente.
function comparadorNotas() {
  const { dir = "desc" } = opcionesNotas().orden || {}; const campo = "modificada";
  const valor = (n) => (campo === "creada" ? n.creada_en || 0 : campo === "vence" ? (n.vence_en ? Date.parse(`${n.vence_en}T12:00:00`) : null) : n.modificada_en || 0);
  return (a, b) => {
    if (a.fijada !== b.fijada) return Number(b.fijada) - Number(a.fijada);
    if (a.fijada) return (a.orden_fijada || 0) - (b.orden_fijada || 0);
    const va = valor(a), vb = valor(b);
    if (va === null || vb === null) { if (va === vb) return (b.modificada_en || 0) - (a.modificada_en || 0); return va === null ? 1 : -1; } // sin fecha, siempre al final
    return (va === vb ? 0 : dir === "asc" ? va - vb : vb - va) || (b.modificada_en || 0) - (a.modificada_en || 0);
  };
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
// Importante: al acomodar en vivo la tarjeta (y su asa) se MUEVEN en el DOM, y el navegador suelta la captura del puntero
// de un nodo que se mueve; por eso los eventos van en window y la captura en <body> (que nunca se mueve).
let arrastreActivo = null; // función que limpia el arrastre en curso sin guardar nada
const abortarArrastre = () => arrastreActivo?.();
function limpiarArrastresHuerfanos() {
  document.querySelectorAll("body > .nota-arrastrando").forEach((n) => n.remove());
  document.body.classList.remove("nota-arrastrando-body");
}

function iniciarArrastre(e, card) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const grid = card.parentElement;
  if (!grid) return;
  abortarArrastre();
  e.preventDefault(); e.stopPropagation();
  const id = e.pointerId;
  const r = card.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
  const ghost = card.cloneNode(true);
  ghost.classList.add("nota-arrastrando"); ghost.removeAttribute("data-id"); ghost.removeAttribute("data-fijada");
  Object.assign(ghost.style, { position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, margin: "0", pointerEvents: "none", zIndex: "1000" });
  document.body.append(ghost);
  card.style.opacity = ".28";
  document.body.classList.add("nota-arrastrando-body");
  try { document.body.setPointerCapture(id); } catch (_) {}
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
  const limpiar = () => {
    if (terminado) return;
    terminado = true;
    arrastreActivo = null;
    cancelAnimationFrame(raf); ghost.remove(); card.style.opacity = "";
    document.body.classList.remove("nota-arrastrando-body");
    window.removeEventListener("pointermove", mover, true); window.removeEventListener("pointerup", soltar, true); window.removeEventListener("pointercancel", cancelar, true);
    window.removeEventListener("blur", cancelar); window.removeEventListener("contextmenu", cancelarMenu, true);
    document.removeEventListener("keydown", teclas, true); document.removeEventListener("visibilitychange", alOcultar);
    try { document.body.releasePointerCapture(id); } catch (_) {}
  };
  const soltar = (ev) => {
    if (terminado || (ev && ev.pointerId !== id)) return;
    limpiar();
    const ids = [...grid.querySelectorAll('.nota-card[data-fijada="1"]')].map((c) => c.dataset.id);
    conHistorial("Reordenar notas fijadas", ids, () => {
      ids.forEach((nid, i) => { const n = notasActuales().find((x) => x.id === nid); if (n && n.orden_fijada !== i + 1) { n.orden_fijada = i + 1; n._mod_manual = true; guardarNota(n); } });
    });
    renderizarNotas();
  };
  const cancelar = () => { if (terminado) return; limpiar(); renderizarNotas(); };
  const mover = (ev) => {
    if (ev.pointerId !== id) return;
    // Si el botón ya se soltó pero el evento se perdió (ventana, menú, otra app), se termina aquí.
    if (ev.pointerType === "mouse" && ev.buttons === 0) { soltar(ev); return; }
    ultimo = ev; acomodar();
  };
  const cancelarMenu = (ev) => { ev.preventDefault(); cancelar(); };
  const teclas = (k) => { if (k.key === "Escape") { k.preventDefault(); k.stopPropagation(); cancelar(); } };
  const alOcultar = () => { if (document.hidden) cancelar(); };
  arrastreActivo = limpiar;
  window.addEventListener("pointermove", mover, true); window.addEventListener("pointerup", soltar, true); window.addEventListener("pointercancel", cancelar, true);
  window.addEventListener("blur", cancelar); window.addEventListener("contextmenu", cancelarMenu, true);
  document.addEventListener("keydown", teclas, true); document.addEventListener("visibilitychange", alOcultar);
  raf = requestAnimationFrame(auto);
}

/* ---------- Selección por arrastre (solo mouse): dibuja un rectángulo sobre el espacio libre y selecciona las notas que toca ---------- */
const ZONA_LIBRE = ".notas-seccion, .notas-grupos, .notas-grid, .nt-divisor";
function iniciarMarquesina(e) {
  if (e.pointerType !== "mouse" || e.button !== 0 || arrastreActivo) return;
  const root = document.getElementById("seccion-notas");
  if (!root || !root.contains(e.target) || !e.target.matches(ZONA_LIBRE)) return;
  const scroller = contenedorScroll(root);
  const st0 = scroller ? scroller.scrollTop : scrollY, sx = e.clientX, sy = e.clientY;
  const aditivo = e.ctrlKey || e.metaKey || e.shiftKey;
  const base = aditivo ? new Set(seleccion) : new Set();
  let ux = sx, uy = sy, activo = false, caja = null, raf = 0, terminado = false;
  const scrollAhora = () => (scroller ? scroller.scrollTop : scrollY);
  const tarjetas = () => [...root.querySelectorAll(".nota-card[data-id]")];
  const pintar = () => {
    const y0 = sy - (scrollAhora() - st0);
    const L = Math.min(sx, ux), R = Math.max(sx, ux), T = Math.min(y0, uy), B = Math.max(y0, uy);
    Object.assign(caja.style, { left: `${L}px`, top: `${T}px`, width: `${R - L}px`, height: `${B - T}px` });
    const dentro = new Set(base);
    for (const c of tarjetas()) {
      const r = c.getBoundingClientRect();
      if (r.right >= L && r.left <= R && r.bottom >= T && r.top <= B) dentro.add(c.dataset.id);
      c.classList.toggle("seleccionada", dentro.has(c.dataset.id));
    }
    return dentro;
  };
  const auto = () => {
    if (terminado) return;
    if (activo) {
      const alto = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: innerHeight };
      let v = 0;
      if (uy < alto.top + 60) v = -Math.min(22, (alto.top + 60 - uy) / 3); else if (uy > alto.bottom - 60) v = Math.min(22, (uy - (alto.bottom - 60)) / 3);
      if (v) { if (scroller) scroller.scrollTop += v; else scrollBy(0, v); pintar(); }
    }
    raf = requestAnimationFrame(auto);
  };
  const quitar = () => {
    terminado = true; cancelAnimationFrame(raf); caja?.remove();
    document.body.classList.remove("nota-marquesina-body");
    window.removeEventListener("pointermove", mover, true); window.removeEventListener("pointerup", soltar, true); window.removeEventListener("pointercancel", cancelar, true);
    document.removeEventListener("keydown", teclas, true);
  };
  const mover = (ev) => {
    if (ev.pointerType !== "mouse") return;
    if (ev.buttons === 0) { soltar(ev); return; }
    ux = ev.clientX; uy = ev.clientY;
    if (!activo) {
      if (Math.hypot(ux - sx, uy - sy) < 6) return;
      activo = true;
      caja = el("div", "nt-marquesina"); document.body.append(caja);
      document.body.classList.add("nota-marquesina-body");
      window.getSelection()?.removeAllRanges();
      raf = requestAnimationFrame(auto);
    }
    pintar();
  };
  const soltar = () => {
    if (terminado) return;
    const era = activo, ids = era ? pintar() : null;
    quitar();
    if (!era) return;
    const antes = seleccion.size;
    seleccion = new Set(ids);
    if (!antes && seleccion.size) history.pushState({ appNav: true, appSeccion: "notas", notasSeleccion: true }, "", location.href);
    if (!seleccion.size) {
      document.body.classList.remove("notas-seleccionando");
      if (history.state?.notasSeleccion) history.replaceState({ appNav: true, appSeccion: "notas" }, "", location.href);
    } else document.body.classList.add("notas-seleccionando");
    renderizarNotas();
  };
  const cancelar = () => { if (terminado) return; const era = activo; quitar(); if (era) renderizarNotas(); };
  const teclas = (k) => { if (k.key === "Escape") { k.stopPropagation(); cancelar(); } };
  window.addEventListener("pointermove", mover, true); window.addEventListener("pointerup", soltar, true); window.addEventListener("pointercancel", cancelar, true);
  document.addEventListener("keydown", teclas, true);
  e.preventDefault(); // evita seleccionar texto mientras se arrastra
}

/* ---------- Ancho de nota: arrastra el borde derecho para que ocupe 2 o 3 columnas ---------- */
// Se guarda el ancho deseado (nota.ancho = 2 | 3); al mostrarla se recorta a las columnas que caben (en teléfono, hasta donde quepa).
const MAX_ANCHO = 3;
let observadorAnchos = null;
const columnasDe = (grid) => {
  const c = getComputedStyle(grid).gridTemplateColumns;
  return !c || c === "none" ? 1 : c.split(" ").filter(Boolean).length;
};
const anchoVisible = (grid, deseado) => (grid.classList.contains("notas-lista") ? 1 : Math.max(1, Math.min(Number(deseado) || 1, MAX_ANCHO, columnasDe(grid))));
function geometria(grid) {
  const cs = getComputedStyle(grid), cols = columnasDe(grid), hueco = parseFloat(cs.columnGap) || 0;
  const izq = grid.getBoundingClientRect().left + (parseFloat(cs.paddingLeft) || 0);
  const util = grid.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  return { cols, hueco, izq, colW: (util - hueco * (cols - 1)) / cols };
}
// Los tiradores aparecen del lado donde hay espacio: a la derecha si la nota está pegada a la izquierda, a la izquierda si está pegada a la derecha, a ambos lados si está en medio.
function aplicarAnchos(grid) {
  if (!grid.isConnected) return;
  const cards = [...grid.querySelectorAll(":scope > .nota-card")];
  for (const c of cards) {
    const w = anchoVisible(grid, c.dataset.ancho);
    c.style.gridColumn = w > 1 ? `span ${w}` : "";
    c.classList.toggle("nota-ancha", w > 1);
  }
  const g = geometria(grid);
  for (const c of cards) {
    const w = anchoVisible(grid, c.dataset.ancho);
    const col = Math.max(0, Math.min(g.cols - 1, Math.round((c.getBoundingClientRect().left - g.izq) / (g.colW + g.hueco))));
    const hayIzq = g.cols > 1 && col > 0, hayDer = g.cols > 1 && col + w - 1 < g.cols - 1;
    c.dataset.lados = hayIzq && hayDer ? "ambos" : hayIzq ? "izq" : "der";
  }
}
const aplicarTodosAnchos = (cont) => cont.querySelectorAll(".notas-grid").forEach(aplicarAnchos);

function iniciarEstirar(e, card, nota, lado) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  const grid = card.parentElement;
  if (!grid) return;
  const cols = columnasDe(grid), tope = Math.min(MAX_ANCHO, cols);
  if (tope < 2 || grid.classList.contains("notas-lista")) return;
  abortarArrastre();
  e.preventDefault(); e.stopPropagation();
  const id = e.pointerId, asa = e.currentTarget;
  try { asa.setPointerCapture(id); } catch (_) {}
  const { colW, hueco } = geometria(grid), signo = lado === "izq" ? -1 : 1;
  const inicio = anchoVisible(grid, card.dataset.ancho), x0 = e.clientX;
  let span = inicio, terminado = false;
  card.classList.add("nota-estirando");
  const fin = (guardar) => {
    if (terminado) return;
    terminado = true;
    card.classList.remove("nota-estirando");
    asa.removeEventListener("pointermove", mover); asa.removeEventListener("pointerup", soltar); asa.removeEventListener("pointercancel", cancelar);
    try { asa.releasePointerCapture(id); } catch (_) {}
    if (!guardar || span === inicio) { aplicarAnchos(grid); return; }
    conHistorial("Cambiar ancho de nota", [nota.id], () => { nota.ancho = span > 1 ? span : null; nota._mod_manual = true; guardarNota(nota); });
    renderizarNotas();
  };
  const mover = (ev) => {
    if (ev.pointerId !== id) return;
    const px = inicio * colW + (inicio - 1) * hueco + signo * (ev.clientX - x0);
    span = Math.max(1, Math.min(tope, Math.round((px + hueco) / (colW + hueco))));
    card.style.gridColumn = span > 1 ? `span ${span}` : "";
  };
  const soltar = (ev) => { if (ev.pointerId === id) fin(true); };
  const cancelar = () => fin(false);
  asa.addEventListener("pointermove", mover); asa.addEventListener("pointerup", soltar); asa.addEventListener("pointercancel", cancelar);
}

const fechaCorta = (iso) => new Intl.DateTimeFormat(document.documentElement.lang || "es", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));

function construirTarjeta(nota) {
  const card = el("article", "glass-card nota-card");
  card.dataset.id = nota.id;
  card.dataset.fijada = nota.fijada ? "1" : "0";
  if (nota.ancho > 1) card.dataset.ancho = String(nota.ancho);
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
    botonIcono({ icono: ICONOS.wapper, titulo: tr("Enviar a Wapper"), onclick: (e) => { e.stopPropagation(); wapperNota(nota); } }),
    botonIcono({ icono: ICONOS.compartir, titulo: tr("Compartir"), onclick: (e) => { e.stopPropagation(); compartirNota(nota); } }),
    sep(),
    botonIcono({ icono: ICONOS.duplicar, titulo: tr("Duplicar"), onclick: (e) => { e.stopPropagation(); clonarNota(nota); } }),
    botonIcono({ icono: ICONOS.papelera, titulo: tr("Eliminar"), clase: "nota-eliminar-action", onclick: (e) => { e.stopPropagation(); eliminarConConfirmacion(nota); } }),
  );
  foot.append(acciones);

  const mini = crearMiniTinta(nota.tinta);
  card.append(...[top, h, preview, mini, expand, foot].filter(Boolean));
  if (!enPapelera) {
    for (const lado of ["izq", "der"]) {
      const estirar = el("span", `nota-resize nota-resize-${lado}`);
      estirar.title = tr("Arrastra para ensanchar"); estirar.setAttribute("aria-hidden", "true");
      estirar.addEventListener("pointerdown", (e) => iniciarEstirar(e, card, nota, lado));
      estirar.addEventListener("click", (e) => e.stopPropagation());
      card.append(estirar);
    }
  }

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
    [ICONOS.wapper, tr("Enviar a Wapper"), () => wapperNota(nota)],
    [ICONOS.compartir, tr("Compartir"), () => compartirNota(nota)],
    [ICONOS.anclar, nota.fijada ? tr("Desfijar") : tr("Fijar"), () => alternarFijada(nota)],
    [flotando ? ICONOS.quitarFlotante : ICONOS.flotar, flotando ? tr("Quitar de flotante") : tr("Dejar flotante"), () => { alternarFlotante(nota.id, card); renderizarNotas(); }],
    [ICONOS.duplicar, tr("Duplicar"), () => clonarNota(nota)],
    [ICONOS.papelera, tr("Eliminar"), () => eliminarConConfirmacion(nota)],
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

const ICONO_PUNTOS = '<svg class="nt-ico nt-ico-solido" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
const ICONO_CUADRICULA ='<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="2" y="2" width="7" height="7" rx="1.6"/><rect x="11" y="2" width="7" height="7" rx="1.6"/><rect x="2" y="11" width="7" height="7" rx="1.6"/><rect x="11" y="11" width="7" height="7" rx="1.6"/></svg>';
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
        root.querySelectorAll(".notas-grid").forEach((g) => g.classList.toggle("notas-lista", valor === "lista"));
        aplicarTodosAnchos(root);
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
  abortarArrastre(); limpiarArrastresHuerfanos(); // si un arrastre quedó a medias, nunca deja la tarjeta fantasma
  procesarCicloVidaNotas(); procesarCompartidos();
  root.replaceChildren(); root.classList.add("stack", "notas-seccion");

  const cab = el("header", "notas-cabecera");
  const acciones = el("div", "row notas-cab-acciones");
  const add = el("button", "btn btn-primary nt-btn-circulo", "➕");
  add.title = tr("Nueva nota"); add.setAttribute("aria-label", add.title); add.onclick = () => abrirEditorNota(null, renderizarNotas);
  const settings = el("button", "btn btn-secondary nt-btn-circulo");
  settings.innerHTML = ICONO_PUNTOS;
  settings.title = tr("Ajustes de Notas"); settings.setAttribute("aria-label", settings.title);
  settings.onclick = () => mostrarAjustesNotas(renderizarNotas, () => mostrarPapelera(root, renderizarNotas));
  acciones.append(add, settings);
  cab.append(el("h1", "", tr("Notas rápidas")), acciones);
  root.append(cab);

  const search = el("input", "form-input notas-busqueda visible");
  search.id = "notas-busqueda"; search.type = "search"; search.placeholder = tr("Buscar notas"); search.setAttribute("aria-label", tr("Buscar notas"));
  const barra = el("div", "notas-toolbar-vista");
  barra.append(search);
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

  // A la derecha de la línea de filtros: ↓ ↑ (orden por fecha de modificación) y cuadrícula / lista.
  const segmentado = (opciones, valor, etiqueta, alCambiar) => {
    const g = el("div", "nt-seg nt-seg-compacto");
    g.setAttribute("role", "radiogroup"); g.setAttribute("aria-label", etiqueta);
    for (const [v, texto] of opciones) {
      const b = el("button", "nt-seg-op", texto);
      b.type = "button"; b.setAttribute("role", "radio"); b.setAttribute("aria-checked", String(v === valor));
      b.onclick = () => { g.querySelectorAll("[role=radio]").forEach((x) => x.setAttribute("aria-checked", String(x === b))); alCambiar(v); };
      g.append(b);
    }
    return g;
  };
  const ordenActual = opcionesNotas().orden || { dir: "desc" };
  const guardarOrden = (cambio) => {
    const o = opcionesNotas();
    o.orden = { campo: "modificada", dir: "desc", ...(o.orden || {}), ...cambio };
    sellarTimestamp(estado.datos.configuracion); marcarCambioPendiente();
    repintar();
  };
  const derecha = el("div", "nt-filtros-der");
  if (notasActuales().filter((n) => !n.eliminada_en).length > 1) {
    const dir = segmentado([["desc", "↓"], ["asc", "↑"]], ordenActual.dir || "desc", tr("Dirección del orden"), (v) => guardarOrden({ dir: v }));
    dir.querySelectorAll("[role=radio]").forEach((b, i) => { const n = tr(i === 0 ? "Descendente" : "Ascendente"); b.title = n; b.setAttribute("aria-label", n); });
    derecha.append(dir);
  }
  derecha.append(selectorVista(root));
  filtros.append(derecha);
  root.append(filtros);

  // Arriba las fijadas, luego una línea divisora y debajo todas las demás notas.
  const contenido = el("div", "notas-grupos");
  const pintarGrupos = () => {
    const items = notasVisibles();
    window.__notasLista = items;
    const claseGrid = `notas-grid ${opcionesNotas().vista === "lista" ? "notas-lista" : ""}`.trim();
    const grupo = (xs, extra) => { const g = el("div", `${claseGrid} ${extra}`); xs.forEach((n) => g.append(construirTarjeta(n))); return g; };
    const fijadas = items.filter((n) => n.fijada), otras = items.filter((n) => !n.fijada);
    const nodos = [];
    if (fijadas.length) nodos.push(grupo(fijadas, "notas-grid-fijadas"));
    if (fijadas.length && otras.length) { const hr = el("hr", "nt-divisor"); hr.setAttribute("aria-hidden", "true"); nodos.push(hr); }
    if (otras.length) nodos.push(grupo(otras, "notas-grid-otras"));
    if (!items.length) {
      const vacio = el("div", "glass-card notas-vacio stack");
      vacio.innerHTML = `<div aria-hidden="true">🗒️</div><h2>${tr("Tus ideas, siempre a mano")}</h2><p>${tr("Toca + para tu primera nota")}</p>`;
      const go = el("button", "btn btn-primary", "＋");
      go.onclick = () => abrirEditorNota(null, renderizarNotas);
      vacio.append(go);
      const g = el("div", claseGrid); g.append(vacio); nodos.push(g);
    }
    contenido.replaceChildren(...nodos);
    if (contenido.isConnected) aplicarTodosAnchos(contenido);
  };
  const repintar = pintarGrupos;
  pintarGrupos();
  root.append(contenido);
  aplicarTodosAnchos(contenido); // ya está en la página: ahora sí se pueden medir las columnas
  observadorAnchos?.disconnect();
  if (typeof ResizeObserver === "function") { // al girar el teléfono o cambiar el tamaño, se recalcula cuántas columnas caben
    let ultimoAncho = contenido.clientWidth;
    observadorAnchos = new ResizeObserver(() => { if (contenido.clientWidth !== ultimoAncho) { ultimoAncho = contenido.clientWidth; aplicarTodosAnchos(contenido); } });
    observadorAnchos.observe(contenido);
  }
  if (seleccion.size) root.append(barraSeleccion());
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
  document.addEventListener("pointerdown", iniciarMarquesina);
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
