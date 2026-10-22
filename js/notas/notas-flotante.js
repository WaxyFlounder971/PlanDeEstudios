// Sticky (al tocar una nota) y notas flotantes dentro de la app.
// - abrirSticky: la nota "se levanta" como un post-it, sin marco, con botón Editar.
// - Flotantes: la nota queda suelta sobre toda la app (también al cambiar de sección), se arrastra, se inclina
//   con la velocidad y, si la lanzas muy rápido, sigue de largo hasta la pared y se queda pegada.
//   La posición se guarda por dispositivo (localStorage), no se sincroniza.
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { notasActuales, resolverColorNota, COLOR_DEFECTO, guardarNota, grosorTrazoPreferido, guardarGrosorTrazoPreferido } from "./notas-datos.js";
import { renderizarHTMLNota } from "./notas-sanitizar.js";
import { crearMiniTinta, crearCapaTinta, dibujarTrazos, GROSOR_BASE } from "./notas-tinta.js";
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
  s.cleanup?.();
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
  const composicion = el("div", "nota-composicion nt-sticky-composicion");
  const preview = el("div", "nota-preview nt-sticky-texto");
  renderizarHTMLNota(preview, nota.contenido, { visual: !!nota.tinta?.length, tinta: nota.tinta, maxAltura:()=>Math.max(120,Math.min(520,window.innerHeight*.62-(nota.titulo?56:20)-(nota.vence_en?28:0))) });
  enlazarChecks(preview, nota);
  composicion.append(preview);
  const mini = crearMiniTinta(nota.tinta, { alinear: true });
  const visualPreview = preview.classList.contains("nt-preview-escalado");
  const ajustarMiniVisual = () => { if (mini && visualPreview) { mini.style.width = "700px"; mini.style.transformOrigin = "top left"; mini.style.transform = `translate(${preview.style.getPropertyValue("--nt-preview-x")},${preview.style.getPropertyValue("--nt-preview-y")}) scale(${preview.style.getPropertyValue("--nt-preview-escala") || 1})`; } };
  ajustarMiniVisual();
  if (mini) (visualPreview ? preview : composicion).append(mini);
  cuerpo.append(composicion);
  const ajustarComposicion = () => {
    const altoPreview = preview.offsetHeight;
    ajustarMiniVisual();
    const altoTinta = visualPreview ? 0 : mini?.getBoundingClientRect().height || 0;
    composicion.style.height = `${Math.max(40, altoPreview, altoTinta)}px`;
  };
  preview.addEventListener("nt:encuadre", ajustarComposicion);
  let cleanup = null;
  if (typeof ResizeObserver === "function") {
    const ro = new ResizeObserver(ajustarComposicion);
    ro.observe(preview);
    if (mini) ro.observe(mini);
    cleanup = () => ro.disconnect();
  }
  requestAnimationFrame(ajustarComposicion);
  hoja.append(barra, cuerpo);
  if (nota.vence_en) { const vence = el("span", "nt-sticky-vence"); vence.innerHTML = ICONOS.reloj; vence.append(document.createTextNode(fechaCorta(nota.vence_en))); hoja.append(vence); }

  overlay.append(hoja);
  overlay.addEventListener("pointerdown", (e) => { if (e.target === overlay) cerrarSticky(); });
  const teclas = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cerrarSticky(); } };
  document.addEventListener("keydown", teclas, true);
  document.body.append(overlay);
  stickyActual = { overlay, hoja, teclas, cleanup };

  if (!reducirMovimiento()) {
    overlay.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180 });
    if (origen) { // la nota se levanta desde su lugar en la lista
      const a = origen.getBoundingClientRect(), b = hoja.getBoundingClientRect();
      hoja.animate([
        { transform: `translate(${a.left - b.left}px, ${a.top - b.top}px) scale(${a.width / b.width}, ${a.height / b.height}) rotate(0deg)` },
        { transform: "translate(0,0) scale(1) rotate(-1.2deg)" },
      ], { duration: 320, easing: "cubic-bezier(.2,.9,.25,1.12)" }).finished.then(() => { preview._refrescarEncuadreVisual?.(); }).catch(() => {});
    }
  }
  editar.focus({ preventScroll: true });
}

/* ===================== Notas flotantes ===================== */
const flotantes = new Map(); // id -> estado de la nota flotante
const ventanasPiP = new Map();
const capasPiP = new Map();
const edicionesPiP = new Set();
let zTop = 700;

const leerGuardado = () => { try { return JSON.parse(localStorage.getItem(CLAVE) || "{}") || {}; } catch (_) { return {}; } };
const escribirGuardado = (o) => { try { localStorage.setItem(CLAVE, JSON.stringify(o)); } catch (_) {} };

const estaFlotando = (id) => flotantes.has(id);

function activarLapiz(ref) {
  const capa = ref?.capaTinta;
  if (!capa) return;
  const activo = !capa.obtenerModo();
  capa.establecerModo(activo ? "lapiz" : null);
  ref.controles?.actualizarModo(activo ? "lapiz" : null);
  ref.boton?.classList.toggle("activo", activo);
  ref.boton?.setAttribute("aria-pressed", String(activo));
  ref.onModo?.(activo ? "lapiz" : null);
}

const ultimoHostPorDoc = new WeakMap();
const docsConAtajos = new WeakSet();
// Ctrl+Z / Ctrl+Y (o Ctrl+Shift+Z) sobre la última nota flotante o PiP que tocaste.
function enlazarAtajosDeshacer(doc) {
  if (docsConAtajos.has(doc)) return;
  docsConAtajos.add(doc);
  doc.addEventListener("pointerdown", (e) => {
    const h = e.target?.closest?.(".nt-flotante,.nt-pip-nota");
    if (h) ultimoHostPorDoc.set(doc, h);
  }, true);
  doc.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
    const k = String(e.key).toLowerCase();
    if (k !== "z" && k !== "y") return;
    if (doc.querySelector(".notas-editor")) return; // el editor completo tiene su propio historial
    if (e.target?.closest?.("input:not([type=range]),textarea,[contenteditable]")) return;
    const host = ultimoHostPorDoc.get(doc);
    const capa = host?._capaTinta;
    if (!host?.isConnected || !capa) return;
    e.preventDefault(); e.stopPropagation();
    if (k === "y" || e.shiftKey) capa.rehacer(); else capa.deshacer();
    host._actualizarDeshacer?.();
  }, true);
}

function crearBarraHerramientas({ doc, capa, nota, host }) {
  enlazarAtajosDeshacer(doc);
  host._capaTinta = capa;
  host.tabIndex = -1;
  const barra = doc.createElement("div"); barra.className = "nt-flot-herramientas"; barra.setAttribute("role", "toolbar"); barra.setAttribute("aria-label", tr("Herramientas de tinta"));
  const boton = (icono, texto, clase = "") => { const b=doc.createElement("button"); b.type="button"; b.className=`nt-flot-herr-btn ${clase}`.trim(); b.innerHTML=icono; b.title=tr(texto); b.setAttribute("aria-label",tr(texto)); return b; };
  const lapiz = boton(ICONOS.editar, "Lápiz", "nt-flot-lapiz");
  const borrador = boton('<svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="m11.6 3.4 5 5a1.4 1.4 0 0 1 0 2l-5.2 5.2H7.4l-4-4a1.4 1.4 0 0 1 0-2l6.2-6.2a1.4 1.4 0 0 1 2 0z"/><path d="m6.2 7.6 6.2 6.2M8 16.6h9"/></svg>', "Borrador");
  const svgFlecha = (d) => `<svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="${d}"/></svg>`;
  const deshacerBtn = boton(svgFlecha("M7 4 3.5 7.5 7 11M3.5 7.5H12a4.5 4.5 0 0 1 0 9H8"), "Deshacer");
  const rehacerBtn = boton(svgFlecha("m13 4 3.5 3.5L13 11m3.5-3.5H8a4.5 4.5 0 0 0 0 9h4"), "Rehacer");
  const refrescarDeshacer = () => { deshacerBtn.disabled = !capa.puedeDeshacer(); rehacerBtn.disabled = !capa.puedeRehacer(); };
  deshacerBtn.onclick = () => { capa.deshacer(); refrescarDeshacer(); };
  rehacerBtn.onclick = () => { capa.rehacer(); refrescarDeshacer(); };
  host._actualizarDeshacer = refrescarDeshacer;
  // alCambiar de la capa se dispara en pointerup del canvas, que llega aquí al burbujear.
  host.addEventListener("pointerup", () => setTimeout(refrescarDeshacer, 0));
  refrescarDeshacer();
  const figuras = boton(ICONOS.figuras, "Figuras", "nt-flot-figuras"); figuras.setAttribute("aria-haspopup","menu");
  const menu = doc.createElement("div"); menu.className="nt-flot-figuras-menu nt-oculto"; menu.setAttribute("role","menu");
  const opciones = [["linea","╱","Línea"],["flecha","↗","Flecha"],["rectangulo","▱","Rectángulo"],["cuadrado","□","Cuadrado"],["circulo","○","Círculo"],["elipse","⬭","Elipse"],["triangulo","△","Triángulo"],["rombo","◇","Rombo"],["estrella","☆","Estrella"],["corazon","♡","Corazón"]];
  for (const [modo,simbolo,nombre] of opciones) { const op=doc.createElement("button"); op.type="button"; op.setAttribute("role","menuitem"); op.dataset.modo=modo; op.textContent=`${simbolo} ${tr(nombre)}`; op.onclick=()=>{ if(host.classList.contains("nt-pip-nota"))capa.ubicar?.();capa.establecerModo(modo); barra.actualizarModo(modo); menu.classList.add("nt-oculto"); figuras.setAttribute("aria-expanded","false"); host.focus?.({preventScroll:true}); }; menu.append(op); }
  figuras.onclick=()=>{ const abrir=menu.classList.contains("nt-oculto"); menu.classList.toggle("nt-oculto",!abrir); figuras.setAttribute("aria-expanded",String(abrir)); };
  const grosor=doc.createElement("label"); grosor.className="nt-flot-grosor"; grosor.title=tr("Tamaño de trazo"); grosor.setAttribute("aria-label",tr("Tamaño de trazo"));
  const slider=doc.createElement("input"); slider.type="range"; slider.min="0.5"; slider.max="3"; slider.step="0.05"; slider.value=String(grosorTrazoPreferido()); slider.setAttribute("aria-label",tr("Tamaño de trazo"));
  const valor=doc.createElement("output"); const mostrar=()=>{valor.textContent=`${Number(slider.value).toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}×`;}; mostrar();
  slider.oninput=()=>{mostrar();capa.establecerGrosor(GROSOR_BASE*Number(slider.value));}; slider.onchange=()=>guardarGrosorTrazoPreferido(slider.value); grosor.append(slider,valor);
  borrador.onclick=()=>{ const activo=capa.obtenerModo()!=="borrador"; capa.establecerModo(activo?"borrador":null); barra.actualizarModo(activo?"borrador":null); };
  lapiz.onclick=()=>activarLapiz({capaTinta:capa,controles:barra,onModo:(modo)=>{if(host.classList.contains("nt-pip-nota")){if(modo)edicionesPiP.add(nota.id);else edicionesPiP.delete(nota.id);}else{const f=flotantes.get(nota.id);fijarEdicion(f,!!modo);}}});
  barra.actualizarModo=(modo)=>{ barra.style.display=modo?"":"none"; lapiz.classList.toggle("activo",modo==="lapiz"); borrador.classList.toggle("activo",modo==="borrador"); figuras.classList.toggle("activo",opciones.some(([m])=>m===modo)); for(const b of menu.children)b.setAttribute("aria-checked",String(b.dataset.modo===modo)); const editar=host.querySelector(".nt-flot-barra .nt-flot-btn"); editar?.classList.toggle("activo",!!modo); editar?.setAttribute("aria-pressed",String(!!modo)); if(host.classList.contains("nt-pip-nota")){if(modo)edicionesPiP.add(nota.id);else edicionesPiP.delete(nota.id);}else{const f=flotantes.get(nota.id);fijarEdicion(f,!!modo);} };
  host.addEventListener("keydown",(e)=>{if(e.key==="Escape"){capa.establecerModo(null);barra.actualizarModo(null);menu.classList.add("nt-oculto");if(host.classList.contains("nt-pip-nota"))edicionesPiP.delete(nota.id);else{const f=flotantes.get(nota.id);fijarEdicion(f,false);}window.dispatchEvent(new Event("notas:actualizadas-ui"));}});
  barra.append(deshacerBtn,rehacerBtn,lapiz,borrador,figuras,grosor,menu);
  barra.style.display=capa.obtenerModo()?"":"none"; // modo edición falso: la barra no se muestra
  return barra;
}

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

// Mientras se dibuja, la tarjeta queda fija (sin inclinación ni arrastre desde el cuerpo) y solo se mueve desde la barra superior.
function fijarEdicion(f, activo) {
  if (!f) return;
  f.editando = !!activo;
  f.el.classList.toggle("nt-flot-editando", !!activo);
  if (f.arrastrando || f.inercia) return;
  f.ang = activo ? 0 : f.reposo;
  f.el.style.transition = reducirMovimiento() ? "none" : "transform .2s ease-out";
  aplicar(f);
}

function asentar(f) {
  f.ultimo = 0;
  f.el.classList.remove("arrastrando");
  f.el.style.transition = reducirMovimiento() ? "none" : "transform .55s cubic-bezier(.3,1.5,.5,1)";
  f.ang = f.editando ? 0 : f.reposo;
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
    if (f.editando && !e.target.closest(".nt-flot-barra")) return; // editando: el cuerpo es solo para dibujar
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
  f.capaTinta?.destruir(); f.capaTinta = null;
  f.el.replaceChildren();

  const barra = el("div", "nt-flot-barra");
  const asa = el("span", "nt-flot-asa"); asa.innerHTML = ICONOS.asa; asa.setAttribute("aria-hidden", "true");
  let editar;
  editar = botonIcono({ icono: ICONOS.editar, titulo: tr("Dibujar en la nota"), clase: "nt-flot-btn", onclick: () => activarLapiz({ capaTinta: f.capaTinta, controles: f.barraHerramientas, boton: editar, onModo: (modo) => { fijarEdicion(f, !!modo); } }) });
  const pip = botonIcono({ icono: ICONOS.pip, titulo: tr("Abrir en ventana PiP"), clase: "nt-flot-btn", onclick: () => abrirNotaPictureInPicture(nota.id, f.el) });
  const soltar = botonIcono({ icono: ICONOS.quitarFlotante, titulo: tr("Quitar de flotante"), clase: "nt-flot-btn", onclick: () => { desflotarNota(nota.id); refrescarLista(); } });
  barra.append(asa, editar, pip, soltar);
  f.el.append(barra);
  if (nota.titulo) f.el.append(el("strong", "nt-flot-titulo", nota.titulo));
  const cuerpo = el("div", "nota-preview nt-flot-cuerpo");
  renderizarHTMLNota(cuerpo, nota.contenido, { visual: !!nota.tinta?.length, tinta: nota.tinta });
  enlazarChecks(cuerpo, nota);
  f.el.append(cuerpo);
  cuerpo.classList.add("nota-composicion");
  f.capaTinta = crearCapaTinta({ cuerpo, modal: f.el, obtenerTrazos: () => nota.tinta || (nota.tinta = []), alCambiar: () => { guardarNota(nota); window.dispatchEvent(new Event("notas:actualizadas-ui")); } });
  f.capaTinta.establecerColor(contraste(color));
  f.capaTinta.establecerGrosor(GROSOR_BASE * grosorTrazoPreferido());
  f.barraHerramientas = crearBarraHerramientas({ doc: document, capa: f.capaTinta, nota, host: f.el });
  f.el.append(f.barraHerramientas);
  return true;
}

function pintarPiP(id, win) {
  const nota = buscar(id);
  if (!nota || win.closed) { capasPiP.get(id)?.destruir(); capasPiP.delete(id); try { win.close(); } catch (_) {} ventanasPiP.delete(id); edicionesPiP.delete(id); return; }
  if (edicionesPiP.has(id)) return;
  capasPiP.get(id)?.destruir(); capasPiP.delete(id);
  const doc = win.document;
  const hoja = doc.createElement("article");
  hoja.className = "nt-pip-nota";
  const color = resolverColorNota(nota.color || COLOR_DEFECTO);
  hoja.style.setProperty("--nt-nota", color); hoja.style.color = colorTextoNota(nota, color);
  const barra = doc.createElement("header"); barra.className = "nt-flot-barra";
  let capaTinta = null, barraHerramientas = null;
  let editar;
  editar = botonIcono({ icono: ICONOS.editar, titulo: tr("Dibujar en la nota"), clase: "nt-flot-btn", onclick: () => activarLapiz({ capaTinta, controles: barraHerramientas, boton: editar, onModo: (modo) => modo ? edicionesPiP.add(id) : edicionesPiP.delete(id) }) });
  const volver = botonIcono({ icono: ICONOS.flotar, titulo: tr("Volver a flotante en la app"), clase: "nt-flot-btn", onclick: () => { flotarNota(id); ventanasPiP.delete(id); win.close(); refrescarLista(); } });
  const cerrar = botonIcono({ icono: ICONOS.cerrar, titulo: tr("Cerrar nota flotante"), clase: "nt-flot-btn", onclick: () => { desflotarNota(id); ventanasPiP.delete(id); win.close(); refrescarLista(); } });
  const resetear = botonIcono({ icono: ICONOS.resetTamano, titulo: tr("Restablecer tamaño"), clase: "nt-flot-btn", onclick: () => { try { win.resizeTo(320, 420); } catch (_) {} } });
  barra.append(editar, volver, cerrar, resetear);
  if (nota.titulo) { const titulo = doc.createElement("strong"); titulo.className = "nt-flot-titulo"; titulo.textContent = nota.titulo; hoja.append(barra, titulo); }
  else hoja.append(barra);
  const cuerpo = doc.createElement("div"); cuerpo.className = "nota-preview nt-flot-cuerpo";
  renderizarHTMLNota(cuerpo, nota.contenido, { visual: !!nota.tinta?.length, tinta: nota.tinta }); enlazarChecks(cuerpo, nota, () => window.dispatchEvent(new Event("notas:actualizadas-ui"))); hoja.append(cuerpo);
  cuerpo.classList.add("nota-composicion");
  capaTinta = crearCapaTinta({ cuerpo, modal: hoja, obtenerTrazos: () => nota.tinta || (nota.tinta = []), alCambiar: () => { guardarNota(nota); window.dispatchEvent(new Event("notas:actualizadas-ui")); } });
  capasPiP.set(id, capaTinta);
  capaTinta.establecerColor(contraste(color)); capaTinta.establecerGrosor(GROSOR_BASE * grosorTrazoPreferido());
  barraHerramientas = crearBarraHerramientas({ doc, capa: capaTinta, nota, host: hoja });
  barraHerramientas.actualizarModo(capaTinta.obtenerModo());
  hoja.append(barraHerramientas);
  doc.body.replaceChildren(hoja);
  // La capa se construye antes de montar `hoja`; recalcular ya conectada evita que el canvas conserve tamaño 1×1 en el PiP.
  capaTinta.ubicar();
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
    estilo.textContent = `html,body{box-sizing:border-box;margin:0;width:100%;height:100%;min-width:0;min-height:0;overflow:hidden;background:#171923;color:#f7f7f7;font:14px system-ui,sans-serif}.nt-pip-nota{box-sizing:border-box;display:flex;flex-direction:column;gap:8px;width:100%;height:100%;min-width:0;min-height:0;padding:10px 14px;background:var(--nt-nota,#fff594);border-radius:14px;overflow:hidden;overflow-wrap:anywhere}.nt-pip-nota .nt-flot-barra{display:flex;align-items:center;gap:6px;position:sticky;top:0;background:inherit;flex:none}.nt-pip-nota .nt-flot-barra>*:first-child{margin-right:auto}.nt-pip-nota .nt-flot-btn{display:inline-grid;place-items:center;width:34px;height:34px;border:0;border-radius:50%;background:rgba(0,0,0,.1);color:inherit;cursor:pointer;flex:none}.nt-pip-nota .nt-flot-btn.activo{background:#8b72e8;color:#fff}.nt-pip-nota .nt-flot-btn .nt-ico{width:18px;height:18px}.nt-pip-nota .nota-preview{position:relative;max-height:none;min-height:0;flex:1 1 auto;overflow:auto}.nt-pip-nota .nota-composicion{min-height:0;flex:1 1 auto;overflow:auto}.nt-pip-nota .nota-tinta-mini.nota-tinta-alineada{position:absolute;left:0;top:0;width:100%;height:auto;margin:0}.nt-pip-nota .nt-flot-herramientas{position:relative;z-index:12;flex:none;align-self:center;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:auto;padding:4px 9px;border:1px solid #ffffff35;border-radius:999px;background:color-mix(in srgb,var(--nt-nota,#fff594) 86%,#111);box-shadow:0 3px 10px #0003;touch-action:manipulation}.nt-pip-nota .nt-flot-herr-btn{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:#0002;color:inherit;cursor:pointer}.nt-pip-nota .nt-flot-herr-btn .nt-ico{width:17px;height:17px}.nt-pip-nota .nt-flot-herr-btn.activo{background:#8b72e8;color:#fff;box-shadow:0 0 0 2px #ffffff70}.nt-pip-nota .nt-flot-grosor{display:flex;align-items:center;gap:5px;min-width:100px;font-size:.68rem}.nt-pip-nota .nt-flot-grosor input{width:75px;min-width:55px;accent-color:#8b72e8}.nt-pip-nota .nt-flot-grosor output{min-width:22px;text-align:right}.nt-pip-nota .nt-flot-figuras-menu{position:absolute;bottom:calc(100% + 7px);left:50%;z-index:30;display:grid;grid-template-columns:repeat(2,minmax(105px,1fr));gap:3px;width:min(250px,calc(100vw - 28px));max-height:min(42vh,260px);overflow:auto;padding:7px;border:1px solid #ffffff35;border-radius:12px;background:#171923;color:#fff;box-shadow:0 8px 25px #0008;transform:translateX(-50%)}.nt-pip-nota .nt-flot-figuras-menu.nt-oculto{display:none}.nt-pip-nota .nt-flot-figuras-menu button{min-height:32px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}.nt-pip-nota .nt-flot-figuras-menu button:hover,.nt-pip-nota .nt-flot-figuras-menu button[aria-checked="true"]{background:#ffffff20}`;
    estilo.textContent += `.nt-pip-nota .nota-preview,.nt-pip-nota .nota-composicion{overflow:visible!important;scrollbar-width:none!important;-ms-overflow-style:none!important}.nt-pip-nota .nota-preview::-webkit-scrollbar,.nt-pip-nota .nota-composicion::-webkit-scrollbar{display:none!important}`;
    win.document.head.append(estilo);
    win.addEventListener("resize", () => { if (!win.closed) { win.document.documentElement.style.width = "100%"; win.document.body.style.width = "100%"; } });
    ventanasPiP.set(id, win); win.addEventListener("pagehide", () => { if (ventanasPiP.get(id) === win) ventanasPiP.delete(id); capasPiP.get(id)?.destruir(); capasPiP.delete(id); edicionesPiP.delete(id); const guardar = buscar(id); if (guardar) { try { guardarNota(guardar); } catch (_) {} } }, { once: true });
    pintarPiP(id, win); return win;
}

/* ===================== PiP estático (Android y otros sin Document PiP) =====================
   La nota se dibuja en un canvas, se emite como video silencioso y se envía al PiP de video del navegador.
   Es solo para ver: la ventana no es interactiva y se vuelve a dibujar sola cuando la nota cambia. */
const VP_ANCHO = 700, VP_TITULO = 52, VP_MAX_ALTO = 1600, VP_MIN_ALTO = 220;
let sesionVideoPiP = null;

const puedeVideoPiP = () => !!(document.pictureInPictureEnabled && typeof HTMLVideoElement.prototype.requestPictureInPicture === "function" && typeof HTMLCanvasElement.prototype.captureStream === "function");

const esperarImagen = (img) => (img.decode ? img.decode().catch(() => {}) : Promise.resolve());

// Maquetea la nota en un contenedor oculto de 700 px (el mismo ancho base de la tinta) y lee posiciones reales.
async function medirNotaVideo(nota, colorTexto) {
  const cont = document.createElement("div");
  cont.className = "notas-cuerpo";
  cont.style.cssText = `position:fixed;left:-10000px;top:0;width:${VP_ANCHO}px;box-sizing:border-box;padding:12px;margin:0;border:0;min-height:0;height:auto;background:none;font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:${colorTexto};overflow-wrap:anywhere;visibility:hidden;pointer-events:none`;
  document.body.append(cont);
  try {
    const html = nota.contenido || "";
    const imgs = () => [...cont.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")];
    renderizarHTMLNota(cont, html);
    if (imgs().length) { await Promise.all(imgs().map(esperarImagen)); renderizarHTMLNota(cont, html); await Promise.all(imgs().map(esperarImagen)); }
    const caja = cont.getBoundingClientRect();
    const rel = (r) => ({ l: r.left - caja.left, t: r.top - caja.top, r: r.right - caja.left, b: r.bottom - caja.top });
    const ops = { textos: [], formas: [], imagenes: [] };
    let maxY = 0;

    const recorrido = document.createTreeWalker(cont, NodeFilter.SHOW_TEXT);
    const rango = document.createRange();
    while (recorrido.nextNode()) {
      const nodo = recorrido.currentNode, txt = nodo.nodeValue, padre = nodo.parentElement;
      if (!padre || !txt.trim()) continue;
      const cs = getComputedStyle(padre);
      const fuente = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const subrayado = !!padre.closest("u") || String(cs.textDecorationLine || "").includes("underline");
      let tramo = null;
      for (let i = 0; i < txt.length; i++) {
        rango.setStart(nodo, i); rango.setEnd(nodo, i + 1);
        const rs = rango.getClientRects();
        if (!rs.length) continue; // espacios colapsados
        const r = rel(rs[0]);
        if (r.r - r.l <= 0) continue;
        const ch = txt[i] === "\u00a0" ? " " : txt[i];
        if (tramo && Math.abs(tramo.t - r.t) < 3 && r.l >= tramo.r - 2) { tramo.s += ch; tramo.r = r.r; }
        else { tramo = { s: ch, l: r.l, t: r.t, b: r.b, r: r.r, fuente, color: cs.color, subrayado }; ops.textos.push(tramo); }
        maxY = Math.max(maxY, r.b);
      }
    }
    cont.querySelectorAll("input[type=checkbox]").forEach((c) => {
      const r = rel(c.getBoundingClientRect());
      ops.formas.push({ k: "check", ...r, marcado: c.checked, color: c.closest("ul,ol")?.getAttribute("data-marc-color") || null, texto: getComputedStyle(c).color });
      maxY = Math.max(maxY, r.b);
    });
    cont.querySelectorAll("li").forEach((li) => {
      const lista = li.parentElement;
      if (!lista || !/^(UL|OL)$/.test(lista.tagName)) return;
      if ([...li.querySelectorAll("input[data-nota-check]")].some((i) => i.closest("li") === li)) return; // los pendientes usan su círculo
      const r = rel(li.getBoundingClientRect()), cs = getComputedStyle(li);
      const alto = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.45, cy = r.t + alto / 2;
      const color = lista.getAttribute("data-marc-color") || cs.color;
      if (lista.tagName === "UL") ops.formas.push({ k: "punto", x: r.l - 13, y: cy, color });
      else {
        const inicio = parseInt(lista.getAttribute("start"), 10) || 1;
        const n = inicio + [...lista.children].filter((h) => h.tagName === "LI").indexOf(li);
        ops.formas.push({ k: "num", s: `${n}.`, x: r.l - 6, y: cy, color, fuente: `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}` });
      }
    });
    cont.querySelectorAll("blockquote").forEach((b) => { const r = rel(b.getBoundingClientRect()); ops.formas.push({ k: "cita", x: r.l, t: r.t, b: r.b, color: getComputedStyle(b).color }); });
    imgs().forEach((img) => {
      const r = rel(img.getBoundingClientRect());
      const w = Number(img.getAttribute("width")) || img.naturalWidth || 220, h = Number(img.getAttribute("height")) || img.naturalHeight || 160;
      const z = Number(img.dataset.z);
      ops.imagenes.push({ img, cx: (r.l + r.r) / 2, cy: (r.t + r.b) / 2, w, h, rot: Number(img.dataset.rot) || 0, fh: img.dataset.flipH === "1", fv: img.dataset.flipV === "1", z: img.dataset.z !== "" && img.dataset.z != null && Number.isFinite(z) ? z : 10 });
      maxY = Math.max(maxY, r.b);
    });
    for (const t of nota.tinta || []) for (const q of t.p || []) maxY = Math.max(maxY, q[1] * VP_ANCHO + Math.max(2, (Number(t.w) || 0.004) * VP_ANCHO));
    return { ops, maxY };
  } finally { cont.remove(); }
}

function pintarNotaVideo(canvas, nota, med, color, colorTexto) {
  const tituloAlto = nota.titulo ? VP_TITULO : 0;
  const alto = Math.min(VP_MAX_ALTO, Math.max(VP_MIN_ALTO, Math.ceil(med.maxY + 16) + tituloAlto));
  if (canvas.width !== VP_ANCHO) canvas.width = VP_ANCHO;
  if (canvas.height !== alto) canvas.height = alto;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, VP_ANCHO, alto);
  ctx.fillStyle = color; ctx.fillRect(0, 0, VP_ANCHO, alto);
  if (nota.titulo) {
    ctx.fillStyle = colorTexto; ctx.textBaseline = "alphabetic"; ctx.font = '700 26px system-ui,-apple-system,"Segoe UI",sans-serif';
    let t = String(nota.titulo); while (t.length > 1 && ctx.measureText(t).width > VP_ANCHO - 36) t = t.slice(0, -2) + "…";
    ctx.fillText(t, 18, 36);
  }
  ctx.save(); ctx.translate(0, tituloAlto);
  ctx.textBaseline = "alphabetic";
  for (const r of med.ops.textos) {
    ctx.font = r.fuente; ctx.fillStyle = r.color;
    const asc = ctx.measureText("Hg").fontBoundingBoxAscent ?? (r.b - r.t) * 0.8;
    ctx.fillText(r.s, r.l, r.t + asc);
    if (r.subrayado) ctx.fillRect(r.l, r.t + asc + 2, r.r - r.l, 1.5);
  }
  for (const f of med.ops.formas) {
    if (f.k === "check") {
      const cx = (f.l + f.r) / 2, cy = (f.t + f.b) / 2, rad = Math.max(3, Math.min(f.r - f.l, f.b - f.t) / 2 - 1);
      ctx.beginPath(); ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      if (f.marcado) { ctx.fillStyle = f.color || "#b7a5f4"; ctx.fill(); ctx.strokeStyle = "#1b1530"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath(); ctx.moveTo(cx - rad * 0.42, cy + rad * 0.02); ctx.lineTo(cx - rad * 0.1, cy + rad * 0.34); ctx.lineTo(cx + rad * 0.45, cy - rad * 0.3); ctx.stroke(); }
      else { ctx.strokeStyle = f.color || f.texto; ctx.globalAlpha = 0.85; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1; }
    } else if (f.k === "punto") { ctx.fillStyle = f.color; ctx.beginPath(); ctx.arc(f.x, f.y, 3.2, 0, Math.PI * 2); ctx.fill(); }
    else if (f.k === "num") { ctx.font = f.fuente; ctx.fillStyle = f.color; ctx.textAlign = "right"; ctx.textBaseline = "middle"; ctx.fillText(f.s, f.x, f.y); ctx.textAlign = "left"; ctx.textBaseline = "alphabetic"; }
    else if (f.k === "cita") { ctx.globalAlpha = 0.45; ctx.fillStyle = f.color; ctx.fillRect(f.x, f.t, 3, f.b - f.t); ctx.globalAlpha = 1; }
  }
  const nivelTinta = Number.isFinite(Number(nota.capa_tinta_z)) ? Number(nota.capa_tinta_z) : 5;
  const imagenes = [...med.ops.imagenes].sort((a, b) => a.z - b.z);
  const dibujarImagen = (i) => {
    ctx.save(); ctx.translate(i.cx, i.cy); ctx.rotate(i.rot * Math.PI / 180); ctx.scale(i.fh ? -1 : 1, i.fv ? -1 : 1);
    try { ctx.drawImage(i.img, -i.w / 2, -i.h / 2, i.w, i.h); } catch (_) {}
    ctx.restore();
  };
  imagenes.filter((i) => i.z < nivelTinta).forEach(dibujarImagen);
  if (nota.tinta?.length) dibujarTrazos(ctx, nota.tinta, VP_ANCHO, 0, 1);
  imagenes.filter((i) => i.z >= nivelTinta).forEach(dibujarImagen);
  ctx.restore();
}

async function redibujarVideoPiP(s) {
  const n = ++s.n;
  const nota = buscar(s.id);
  if (!nota) { if (sesionVideoPiP === s) cerrarVideoPiP(); return; }
  const color = resolverColorNota(nota.color || COLOR_DEFECTO);
  const colorTexto = nota.color_texto || colorTextoNota(nota, color);
  const med = await medirNotaVideo(nota, colorTexto);
  if (sesionVideoPiP !== s || n !== s.n) return;
  pintarNotaVideo(s.canvas, nota, med, color, colorTexto);
}

function cerrarVideoPiP() {
  const s = sesionVideoPiP;
  if (!s) return;
  sesionVideoPiP = null;
  clearTimeout(s.timer); clearInterval(s.latido);
  if (s.alCambiar) { window.removeEventListener("notas:actualizadas", s.alCambiar); window.removeEventListener("notas:actualizadas-ui", s.alCambiar); }
  try { if (document.pictureInPictureElement === s.video) document.exitPictureInPicture().catch(() => {}); } catch (_) {}
  s.stream?.getTracks().forEach((t) => t.stop());
  s.video.srcObject = null; s.video.remove();
}

/** Abre la nota como ventana flotante de solo lectura usando el PiP de video. Devuelve false si no pudo. */
async function abrirVideoPiP(id) {
  if (!puedeVideoPiP() || !buscar(id)) return false;
  cerrarVideoPiP();
  const canvas = document.createElement("canvas");
  canvas.width = VP_ANCHO; canvas.height = VP_MIN_ALTO;
  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.setAttribute("aria-hidden", "true");
  video.style.cssText = "position:fixed;right:0;bottom:0;width:2px;height:2px;opacity:.01;pointer-events:none";
  document.body.append(video);
  const s = { id, canvas, video, stream: null, timer: 0, latido: 0, alCambiar: null, parpadeo: false, n: 0 };
  sesionVideoPiP = s;
  try {
    await redibujarVideoPiP(s);
    s.stream = canvas.captureStream(10);
    video.srcObject = s.stream;
    await video.play();
    await video.requestPictureInPicture();
  } catch (_) { if (sesionVideoPiP === s) cerrarVideoPiP(); return false; }
  if (sesionVideoPiP !== s) return false;
  video.addEventListener("leavepictureinpicture", () => { if (sesionVideoPiP === s) cerrarVideoPiP(); });
  video.addEventListener("pause", () => { if (sesionVideoPiP === s && document.pictureInPictureElement === video) video.play().catch(() => {}); });
  s.alCambiar = () => { clearTimeout(s.timer); s.timer = setTimeout(() => redibujarVideoPiP(s), 150); };
  window.addEventListener("notas:actualizadas", s.alCambiar);
  window.addEventListener("notas:actualizadas-ui", s.alCambiar);
  // Un píxel casi invisible que alterna mantiene el flujo de video activo aunque la nota no cambie.
  s.latido = setInterval(() => { const c = canvas.getContext("2d"); s.parpadeo = !s.parpadeo; c.fillStyle = s.parpadeo ? "rgba(255,255,255,.02)" : "rgba(0,0,0,.02)"; c.fillRect(0, 0, 1, 1); }, 1000);
  return true;
}

function abrirNotaPictureInPicture(id, origen) {
  if (!window.documentPictureInPicture?.requestWindow) {
    const enApp = () => { flotarNota(id, origen); refrescarLista(); return false; };
    if (!puedeVideoPiP()) return Promise.resolve(enApp());
    return abrirVideoPiP(id).then((ok) => ok || enApp()).catch(enApp);
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
  if (f) { cancelAnimationFrame(f.raf); f.capaTinta?.destruir(); f.el.remove(); flotantes.delete(id); }
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
  for (const [id, win] of [...ventanasPiP]) if (!edicionesPiP.has(id)) pintarPiP(id, win);
  for (const f of [...flotantes.values()]) {
    if (!buscar(f.id)) { desflotarNota(f.id); continue; }
    if (f.arrastrando || f.inercia || f.editando) continue;
    pintar(f);
    const l = limitesDe(f);
    f.x = acotar(f.x, l.minX, l.maxX); f.y = acotar(f.y, l.minY, l.maxY);
    aplicar(f);
  }
}
window.addEventListener("notas:actualizadas", sincronizar);
window.addEventListener("notas:actualizadas-ui", sincronizar);
window.addEventListener("resize", () => flotantes.forEach((f) => { if (!f.arrastrando && !f.inercia && !f.editando) reubicar(f); }));

export { abrirSticky, cerrarSticky, flotarNota, desflotarNota, alternarFlotante, abrirNotaPictureInPicture, estaFlotando, restaurarFlotantes };
