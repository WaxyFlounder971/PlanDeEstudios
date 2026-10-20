// Sticky (al tocar una nota) y notas flotantes dentro de la app.
// - abrirSticky: la nota "se levanta" como un post-it, sin marco, con botón Editar.
// - Flotantes: la nota queda suelta sobre toda la app (también al cambiar de sección), se arrastra, se inclina
//   con la velocidad y, si la lanzas muy rápido, sigue de largo hasta la pared y se queda pegada.
//   La posición se guarda por dispositivo (localStorage), no se sincroniza.
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { notasActuales, resolverColorNota, COLOR_DEFECTO } from "./notas-datos.js";
import { renderizarHTMLNota } from "./notas-sanitizar.js";
import { crearMiniTinta } from "./notas-tinta.js";
import { abrirEditorNota } from "./notas-editor.js";
import { ICONOS, el, contraste, colorTextoNota, botonIcono, enlazarChecks } from "./notas-ui.js";
import { velocidad, limitarVel, esLanzamiento, limites, acotar, pasoInercia } from "./notas-fisica.js";
import "./notas-estilos.js";

const tr = (x) => t(x);
const CLAVE = "notas_flotantes_v1";
const reducirMovimiento = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
const refrescarLista = () => window.renderizarNotas?.();
const buscar = (id) => notasActuales().find((n) => n.id === id && !n.eliminada_en) || null;

function fechaCorta(iso) {
  return new Intl.DateTimeFormat(document.documentElement.lang || "es", { day: "numeric", month: "short" }).format(new Date(`${iso}T12:00:00`));
}

/* ===================== Sticky (vista al tocar) ===================== */
let stickyActual = null;

function cerrarSticky(rapido = false) {
  const s = stickyActual;
  if (!s) return;
  stickyActual = null;
  document.removeEventListener("keydown", s.teclas, true);
  if (rapido || reducirMovimiento()) { s.overlay.remove(); return; }
  const a = s.overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140 });
  s.hoja.animate([{ transform: "rotate(-1.2deg) scale(1)" }, { transform: "rotate(0deg) scale(.96)" }], { duration: 140 });
  a.onfinish = () => s.overlay.remove();
}

function abrirSticky(nota, origen) {
  cerrarSticky(true);
  const color = resolverColorNota(nota.color || COLOR_DEFECTO);
  const overlay = el("div", "nt-sticky-overlay");
  const hoja = el("article", "nt-sticky");
  hoja.style.setProperty("--nt-nota", color);
  hoja.style.color = colorTextoNota(nota, color);
  hoja.setAttribute("role", "dialog");
  hoja.setAttribute("aria-modal", "true");
  hoja.setAttribute("aria-label", nota.titulo || tr("Nota"));

  const barra = el("div", "nt-sticky-barra");
  const editar = el("button", "nt-sticky-btn nt-sticky-editar");
  editar.type = "button";
  editar.innerHTML = ICONOS.editar;
  editar.append(el("span", "", tr("Editar")));
  editar.onclick = () => { cerrarSticky(true); abrirEditorNota(nota.id, refrescarLista); };
  const flotar = botonIcono({
    icono: estaFlotando(nota.id) ? ICONOS.quitarFlotante : ICONOS.flotar,
    titulo: tr(estaFlotando(nota.id) ? "Quitar de flotante" : "Dejar flotante"),
    clase: "nt-sticky-btn nt-sticky-icono",
    onclick: () => { const r = hoja.getBoundingClientRect(); cerrarSticky(true); alternarFlotante(nota.id, r); refrescarLista(); },
  });
  const cerrar = botonIcono({ icono: ICONOS.cerrar, titulo: tr("Cerrar"), clase: "nt-sticky-btn nt-sticky-icono", onclick: () => cerrarSticky() });
  barra.append(editar, flotar, cerrar);

  const cuerpo = el("div", "nt-sticky-cuerpo");
  if (nota.titulo) cuerpo.append(el("strong", "nt-sticky-titulo", nota.titulo));
  const preview = el("div", "nota-preview nt-sticky-texto");
  renderizarHTMLNota(preview, nota.contenido);
  enlazarChecks(preview, nota);
  cuerpo.append(preview);
  const mini = crearMiniTinta(nota.tinta);
  if (mini) cuerpo.append(mini);
  hoja.append(barra, cuerpo);
  if (nota.vence_en) { const vence = el("span", "nt-sticky-vence"); vence.innerHTML = ICONOS.reloj; vence.append(document.createTextNode(fechaCorta(nota.vence_en))); hoja.append(vence); }

  overlay.append(hoja);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) cerrarSticky(); });
  const teclas = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrarSticky(); } };
  document.addEventListener("keydown", teclas, true);
  document.body.append(overlay);
  stickyActual = { overlay, hoja, teclas };

  if (!reducirMovimiento()) {
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    if (origen) { // la nota se levanta desde su lugar en la lista
      const a = origen.getBoundingClientRect(), b = hoja.getBoundingClientRect();
      hoja.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height}) rotate(0deg)` },
        { transform: "translate(0,0) scale(1) rotate(-1.2deg)" },
      ], { duration: 320, easing: "cubic-bezier(.2,.9,.25,1.12)" });
    }
  }
  editar.focus({ preventScroll: true });
}

/* ===================== Notas flotantes ===================== */
const flotantes = new Map(); // id -> estado de la nota flotante
const ventanasPiP = new Map();
let zTop = 700;

const leerGuardado = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch (_) { return {}; } };
const escribirGuardado = (o) => { try { localStorage.setItem(CLAVE, JSON.stringify(o)); } catch (_) {} };

const estaFlotando = (id) => flotantes.has(id);
const limitesDe = (f) => limites(innerWidth, innerHeight, f.el.offsetWidth, f.el.offsetHeight);
const reposoDe = (id) => { let h = 0; for (const c of id) h = (h * 31 + c.charCodeAt(0)) | 0; return ((Math.abs(h) % 7) - 3) * 0.6; }; // ±1.8°

function aplicar(f) { f.el.style.transform = `translate3d(${f.x}px, ${f.y}px, 0) rotate(${f.ang}deg)`; }

function guardarPos(f) {
  const l = limitesDe(f);
  f.fx = acotar((f.x - l.minX) / Math.max(1, l.maxX - l.minX), 0, 1);
  f.fy = acotar((f.y - l.minY) / Math.max(1, l.maxY - l.minY), 0, 1);
  const g = leerGuardado();
  g[f.id] = { fx: +f.fx.toFixed(4), fy: +f.fy.toFixed(4) };
  escribirGuardado(g);
}

function reubicar(f) {
  const l = limitesDe(f);
  f.x = l.minX + f.fx * (l.maxX - l.minX);
  f.y = l.minY + f.fy * (l.maxY - l.minY);
  aplicar(f);
}

function golpe(f) {
  try { navigator.vibrate?.(8); } catch (_) {}
  if (reducirMovimiento()) return;
  f.el.animate([{ scale: "1" }, { scale: "1.035 .965" }, { scale: "1" }], { duration: 240, easing: "ease-out" });
}

function asentar(f) {
  f.ultimo = 0;
  f.el.classList.remove("arrastrando");
  f.el.style.transition = reducirMovimiento() ? "none" : "transform .55s cubic-bezier(.3,1.5,.5,1)";
  f.ang = f.reposo;
  aplicar(f);
  guardarPos(f);
}

function bucle(f, ahora) {
  const dt = Math.min(34, Math.max(1, ahora - (f.ultimo || ahora - 16)));
  f.ultimo = ahora;
  let objetivo = 0;
  if (f.arrastrando) {
    objetivo = acotar(velocidad(f.muestras, ahora).x * 5, -12, 12);
  } else if (f.inercia) {
    const r = pasoInercia(f, dt, limitesDe(f));
    objetivo = acotar(f.vx * 5, -12, 12);
    if (r === "pared") { golpe(f); f.inercia = false; } else if (r === "fin") f.inercia = false;
  }
  f.ang += (objetivo - f.ang) * Math.min(1, dt / 90);
  aplicar(f);
  if (f.arrastrando || f.inercia) f.raf = requestAnimationFrame((tt) => bucle(f, tt));
  else { f.raf = 0; asentar(f); }
}

function arrancarBucle(f) { if (!f.raf) { f.ultimo = 0; f.raf = requestAnimationFrame((tt) => bucle(f, tt)); } }

function enlazarArrastre(f) {
  const nodo = f.el;
  nodo.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest("button, a, input, textarea, [contenteditable]")) return;
    e.preventDefault();
    try { nodo.setPointerCapture(e.pointerId); } catch (_) {}
    nodo.style.transition = "none";
    nodo.style.zIndex = String(++zTop);
    nodo.classList.add("arrastrando");
    f.inercia = false; f.vx = f.vy = 0;
    f.arrastrando = true;
    f.muestras = [{ t: e.timeStamp, x: e.clientX, y: e.clientY }];
    const dx = e.clientX - f.x, dy = e.clientY - f.y;
    arrancarBucle(f);

    const mover = (ev) => {
      const l = limitesDe(f);
      f.x = acotar(ev.clientX - dx, l.minX, l.maxX);
      f.y = acotar(ev.clientY - dy, l.minY, l.maxY);
      f.muestras.push({ t: ev.timeStamp, x: ev.clientX, y: ev.clientY });
      if (f.muestras.length > 24) f.muestras.shift();
      aplicar(f);
    };
    const soltar = (ev) => {
      nodo.removeEventListener("pointermove", mover);
      nodo.removeEventListener("pointerup", soltar);
      nodo.removeEventListener("pointercancel", soltar);
      try { nodo.releasePointerCapture(e.pointerId); } catch (_) {}
      f.arrastrando = false;
      const v = limitarVel(velocidad(f.muestras, ev.timeStamp));
      if (ev.type === "pointerup" && esLanzamiento(v)) { f.vx = v.x; f.vy = v.y; f.inercia = true; }
      arrancarBucle(f);
    };
    nodo.addEventListener("pointermove", mover);
    nodo.addEventListener("pointerup", soltar);
    nodo.addEventListener("pointercancel", soltar);
  });
}

function pintar(f) {
  const nota = buscar(f.id);
  if (!nota) return false;
  const color = resolverColorNota(nota.color || COLOR_DEFECTO);
  f.el.style.setProperty("--nt-nota", color);
  f.el.style.color = colorTextoNota(nota, color);
  f.el.setAttribute("aria-label", nota.titulo || tr("Nota flotante"));
  f.el.replaceChildren();

  const barra = el("div", "nt-flot-barra");
  const asa = el("span", "nt-flot-asa"); asa.innerHTML = ICONOS.asa; asa.setAttribute("aria-hidden", "true");
  const editar = botonIcono({ icono: ICONOS.editar, titulo: tr("Editar"), clase: "nt-flot-btn", onclick: () => abrirEditorNota(nota.id, refrescarLista) });
  const pip = botonIcono({ icono: ICONOS.pip, titulo: tr("Abrir en ventana PiP"), clase: "nt-flot-btn", onclick: () => abrirNotaPictureInPicture(nota.id, f.el) });
  const soltar = botonIcono({ icono: ICONOS.quitarFlotante, titulo: tr("Quitar de flotante"), clase: "nt-flot-btn", onclick: () => { desflotarNota(nota.id); refrescarLista(); } });
  barra.append(asa, editar, pip, soltar);
  f.el.append(barra);
  if (nota.titulo) f.el.append(el("strong", "nt-flot-titulo", nota.titulo));
  const cuerpo = el("div", "nota-preview nt-flot-cuerpo");
  renderizarHTMLNota(cuerpo, nota.contenido);
  enlazarChecks(cuerpo, nota);
  f.el.append(cuerpo);
  const mini = crearMiniTinta(nota.tinta, { alinear: true });
  if (mini) { cuerpo.classList.add("nota-composicion"); cuerpo.append(mini); const ajustar=()=>{cuerpo.style.minHeight="";cuerpo.style.minHeight=`${Math.max(cuerpo.scrollHeight,mini.getBoundingClientRect().height,40)}px`;}; ajustar(); if(typeof ResizeObserver==="function"){const ro=new ResizeObserver(ajustar);ro.observe(cuerpo);ro.observe(mini);} }
  return true;
}

function pintarPiP(id, win) {
  const nota = buscar(id);
  if (!nota || win.closed) { try { win.close(); } catch (_) {} ventanasPiP.delete(id); return; }
  const doc = win.document;
  const hoja = doc.createElement("article");
  hoja.className = "nt-pip-nota";
  const color = resolverColorNota(nota.color || COLOR_DEFECTO);
  hoja.style.setProperty("--nt-nota", color); hoja.style.color = colorTextoNota(nota, color);
  const barra = doc.createElement("header"); barra.className = "nt-flot-barra";
  const editar = botonIcono({ icono: ICONOS.editar, titulo: tr("Editar"), clase: "nt-flot-btn", onclick: () => abrirEditorNota(id, refrescarLista) });
  const volver = botonIcono({ icono: ICONOS.flotar, titulo: tr("Volver a flotante en la app"), clase: "nt-flot-btn", onclick: () => { flotarNota(id); ventanasPiP.delete(id); win.close(); refrescarLista(); } });
  const cerrar = botonIcono({ icono: ICONOS.cerrar, titulo: tr("Cerrar nota flotante"), clase: "nt-flot-btn", onclick: () => { desflotarNota(id); ventanasPiP.delete(id); win.close(); refrescarLista(); } });
  const resetear = botonIcono({ icono: ICONOS.resetTamano, titulo: tr("Restablecer tamaño"), clase: "nt-flot-btn", onclick: () => { try { win.resizeTo(320, 420); } catch (_) {} } });
  barra.append(editar, volver, cerrar, resetear);
  if (nota.titulo) { const titulo = doc.createElement("strong"); titulo.className = "nt-flot-titulo"; titulo.textContent = nota.titulo; hoja.append(barra, titulo); }
  else hoja.append(barra);
  const cuerpo = doc.createElement("div"); cuerpo.className = "nota-preview nt-flot-cuerpo";
  renderizarHTMLNota(cuerpo, nota.contenido); enlazarChecks(cuerpo, nota, () => window.dispatchEvent(new Event("notas:actualizadas-ui"))); hoja.append(cuerpo);
  const mini = crearMiniTinta(nota.tinta, { alinear: true }); if (mini) { cuerpo.classList.add("nota-composicion"); cuerpo.append(doc.adoptNode(mini)); const ajustar=()=>{cuerpo.style.minHeight="";cuerpo.style.minHeight=`${Math.max(cuerpo.scrollHeight,mini.getBoundingClientRect().height,40)}px`;}; ajustar(); if(typeof win.ResizeObserver==="function"){const ro=new win.ResizeObserver(ajustar);ro.observe(cuerpo);ro.observe(mini);} }
  doc.body.replaceChildren(hoja);
}

async function abrirPiP(id) {
  const api = window.documentPictureInPicture;
  if (!api || typeof api.requestWindow !== "function") return null;
  for (const [anteriorId, anterior] of [...ventanasPiP]) {
    ventanasPiP.delete(anteriorId); try { anterior.close(); } catch (_) {}
  }
  const win = await api.requestWindow({ width: 320, height: 420, preferInitialWindowPlacement: true });
    win.document.title = buscar(id)?.titulo || tr("Nota flotante");
    for (const n of document.head.querySelectorAll('link[rel="stylesheet"],style')) {
      const copia = win.document.importNode(n, true);
      if (copia.tagName === "LINK") copia.href = n.href;
      win.document.head.append(copia);
    }
    const estilo = win.document.createElement("style");
    estilo.textContent = `html,body{box-sizing:border-box;margin:0;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:#171923;color:#f7f7f7;font:14px system-ui,sans-serif}.nt-pip-nota{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-width:0;min-height:0;padding:10px 14px;background:var(--nt-nota,#fff594);border-radius:14px;overflow:hidden;overflow-wrap:anywhere}.nt-pip-nota .nt-flot-barra{display:flex;align-items:center;gap:6px;position:sticky;top:0;background:inherit;flex:none}.nt-pip-nota .nt-flot-barra>*:first-child{margin-right:auto}.nt-pip-nota .nt-flot-btn{display:inline-grid;place-items:center;width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.1);color:inherit;cursor:pointer;flex:none}.nt-pip-nota .nt-flot-btn .nt-ico{width:18px;height:18px}.nt-pip-nota .nota-preview{max-height:none;min-height:0;flex:1 1 auto;overflow:auto}.nt-pip-nota .nota-composicion{min-height:0;flex:1 1 auto;overflow:auto}.nt-pip-nota .nota-tinta-mini.nota-tinta-alineada{position:absolute;left:0;top:0;width:100%;height:auto;margin:0}`;
    win.document.head.append(estilo);
    win.addEventListener("resize", () => { if (!win.closed) { win.document.documentElement.style.width = "100%"; win.document.body.style.width = "100%"; } });
    ventanasPiP.set(id, win); win.addEventListener("pagehide", () => { if (ventanasPiP.get(id) === win) ventanasPiP.delete(id); }, { once: true });
    pintarPiP(id, win); return win;
}

function abrirNotaPictureInPicture(id, origen) {
  if (!window.documentPictureInPicture?.requestWindow) {
    flotarNota(id, origen); refrescarLista(); return Promise.resolve(false);
  }
  return abrirPiP(id).then(() => true).catch(() => { flotarNota(id, origen); refrescarLista(); return false; });
}

function montar(nota, { fx, fy, x, y } = {}) {
  const nodo = el("article", "nt-flotante");
  nodo.dataset.id = nota.id;
  nodo.setAttribute("role", "group");
  nodo.style.zIndex = String(++zTop);
  const f = { id: nota.id, el: nodo, x: 0, y: 0, vx: 0, vy: 0, ang: 0, reposo: reposoDe(nota.id), fx: fx ?? 0.5, fy: fy ?? 0.3, muestras: [], arrastrando: false, inercia: false, raf: 0, ultimo: 0 };
  f.ang = f.reposo;
  flotantes.set(nota.id, f);
  if (!pintar(f)) { flotantes.delete(nota.id); return null; }
  document.body.append(nodo);
  if (x != null) { const l = limitesDe(f); f.x = acotar(x, l.minX, l.maxX); f.y = acotar(y, l.minY, l.maxY); guardarPos(f); aplicar(f); }
  else reubicar(f);
  enlazarArrastre(f);
  if (!reducirMovimiento() && x != null) nodo.animate([{ opacity: 0.4, scale: ".9" }, { opacity: 1, scale: "1" }], { duration: 220, easing: "ease-out" });
  return f;
}

/** Deja la nota flotante (si x/y vienen de la tarjeta, aparece donde estaba). */
function flotarNota(id, origen) {
  const nota = buscar(id);
  if (!nota || flotantes.has(id)) return;
  const r = origen && (origen.getBoundingClientRect ? origen.getBoundingClientRect() : origen);
  montar(nota, r ? { x: r.left, y: r.top } : {});
}

function desflotarNota(id) {
  const f = flotantes.get(id);
  if (f) { cancelAnimationFrame(f.raf); f.el.remove(); flotantes.delete(id); }
  const g = leerGuardado();
  if (id in g) { delete g[id]; escribirGuardado(g); }
}

function alternarFlotante(id, origen) { if (flotantes.has(id)) desflotarNota(id); else flotarNota(id, origen); }

/** Vuelve a mostrar las flotantes guardadas. Devuelve false si los datos aún no cargaron. */
function restaurarFlotantes() {
  if (!estado.datos) return false;
  const g = leerGuardado();
  let cambio = false;
  for (const [id, pos] of Object.entries(g)) {
    if (flotantes.has(id)) continue;
    const nota = buscar(id);
    if (!nota) { delete g[id]; cambio = true; continue; }
    montar(nota, pos);
  }
  if (cambio) escribirGuardado(g);
  return true;
}

function sincronizar() {
  if (!estado.datos) return;
  for (const [id, win] of [...ventanasPiP]) pintarPiP(id, win);
  for (const f of [...flotantes.values()]) {
    if (!buscar(f.id)) { desflotarNota(f.id); continue; }
    if (f.arrastrando || f.inercia) continue;
    pintar(f);
    const l = limitesDe(f);
    f.x = acotar(f.x, l.minX, l.maxX); f.y = acotar(f.y, l.minY, l.maxY);
    aplicar(f);
  }
}
window.addEventListener("notas:actualizadas", sincronizar);
window.addEventListener("notas:actualizadas-ui", sincronizar);
window.addEventListener("resize", () => flotantes.forEach((f) => { if (!f.arrastrando && !f.inercia) reubicar(f); }));

export { abrirSticky, cerrarSticky, flotarNota, desflotarNota, alternarFlotante, abrirNotaPictureInPicture, estaFlotando, restaurarFlotantes };
