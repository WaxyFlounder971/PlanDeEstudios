// Interfaz de las herramientas 🛠 del editor y selección de marcadores (viñetas, números y casillas).
// La lógica de texto vive en notas-operaciones.js (sin interfaz); aquí solo se conecta con el editor.
import { transformarHTML, lineasDeNota, textoDeNota, estadisticas, formatoLectura } from "./notas-operaciones.js";
import { sanearHTMLNota } from "./notas-sanitizar.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";

const tr = (x) => t(x);

const GRUPOS = [
  ["Ordenar", [["ordenar-az", "Ordenar A → Z"], ["ordenar-za", "Ordenar Z → A"]]],
  ["Texto", [["mayus", "MAYÚSCULAS"], ["minus", "minúsculas"], ["titulo", "Tipo Título"], ["oracion", "Tipo oración"]]],
  ["Líneas", [["dup", "Quitar líneas duplicadas"], ["vacias", "Eliminar líneas vacías"]]],
  ["Pendientes", [["marcar", "Marcar o desmarcar todos"], ["borrar-completados", "Borrar los completados"]]],
  ["Nota", [["contar", "Contar texto"], ["copiar", "Copiar todo el texto"]]],
];

const CSS = `
.nt-herr-menu{position:fixed;z-index:100000;width:min(260px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow:auto;display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:16px;background:rgba(22,20,34,.98);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 40px rgba(0,0,0,.55);color:#fff;font:inherit}
.nt-herr-tit{padding:8px 10px 2px;font-size:.7rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;opacity:.55}
.nt-herr-menu button{padding:10px 12px;min-height:40px;border:0;border-radius:11px;background:transparent;color:#fff;font:inherit;font-size:.92rem;font-weight:600;text-align:left;cursor:pointer}
.nt-herr-menu button:hover,.nt-herr-menu button:focus-visible{background:rgba(255,255,255,.12);outline:none}
.nt-herr-fila{display:flex;justify-content:space-between;gap:16px;padding:9px 12px;border-radius:11px;font-size:.92rem}
.nt-herr-fila:nth-child(odd){background:rgba(255,255,255,.06)}
.nt-herr-fila b{font-variant-numeric:tabular-nums}
.nt-herr-alcance{padding:6px 12px 4px;font-size:.8rem;opacity:.7}
.notas-cuerpo input[data-nota-check]{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none}
.notas-cuerpo.nt-marcando ::selection{background:transparent}
.notas-cuerpo [data-marc]{background:linear-gradient(90deg,color-mix(in srgb,currentColor 24%,transparent) 0,color-mix(in srgb,currentColor 24%,transparent) var(--marc-w,2.4em),transparent var(--marc-w,2.4em));border-radius:8px}
.notas-cuerpo [data-marc]>li::marker{font-weight:800}
.notas-cuerpo [data-marc] input[data-nota-check]{box-shadow:0 0 0 3px color-mix(in srgb,currentColor 35%,transparent);opacity:1}
`;
let estilosListos = false;
function inyectarEstilos() {
  if (estilosListos || document.getElementById("nt-herr-estilos")) { estilosListos = true; return; }
  const s = document.createElement("style");
  s.id = "nt-herr-estilos";
  s.textContent = CSS;
  document.head.append(s);
  estilosListos = true;
}

/* ===================== Seleccionar solo marcadores ===================== */
// Tocar el hueco de una viñeta o número, o mantener presionada una casilla, marca los marcadores de esa lista
// (sin seleccionar el texto). Mientras está activo, los botones de viñetas / numerada / pendientes cambian solo eso.
function crearMarcadores({ cuerpo }) {
  inyectarEstilos();
  let listas = [], aplicando = false, pulsado = null;
  const activo = () => listas.length > 0 && listas.every((l) => l.isConnected);
  const LARGO_MS = 450;

  function pintar() {
    cuerpo.querySelectorAll("[data-marc]").forEach((l) => { l.removeAttribute("data-marc"); l.style.removeProperty("--marc-w"); });
    listas.forEach((l) => { l.setAttribute("data-marc", "1"); l.style.setProperty("--marc-w", getComputedStyle(l).paddingLeft || "2.4em"); });
    cuerpo.classList.toggle("nt-marcando", listas.length > 0);
  }
  function salir() { if (!listas.length) return; listas = []; pintar(); }
  function activar(lista) {
    if (!lista || !cuerpo.contains(lista)) return;
    listas = [lista];
    pintar();
    getSelection()?.removeAllRanges();
    try { navigator.vibrate?.(10); } catch (_) {}
  }
  /** Ejecuta `fn` (un comando de lista) sobre los marcadores marcados y deja marcadas las listas resultantes. */
  function aplicar(fn) {
    if (!activo()) return fn();
    aplicando = true;
    try {
      const s = getSelection(), r = document.createRange(), ult = listas[listas.length - 1];
      r.setStart(listas[0], 0); r.setEnd(ult, ult.childNodes.length);
      cuerpo.focus(); s.removeAllRanges(); s.addRange(r);
      fn();
      const rr = s.rangeCount ? s.getRangeAt(0) : null;
      listas = rr ? [...cuerpo.querySelectorAll("ul,ol")].filter((l) => rr.intersectsNode(l)) : [];
      pintar();
      s.removeAllRanges();
    } finally { aplicando = false; }
  }

  const zona = (e) => { // clic en el hueco de viñeta/número: cae en la lista, a la izquierda de sus ítems
    const l = e.target;
    if (!l || !(l.tagName === "UL" || l.tagName === "OL") || !cuerpo.contains(l)) return null;
    const li = [...l.children].find((x) => x.tagName === "LI");
    return li && e.clientX < li.getBoundingClientRect().left ? l : null;
  };
  const casilla = (e) => e.target?.closest?.("input[data-nota-check]");
  const soltar = () => { if (pulsado) clearTimeout(pulsado.timer); };

  cuerpo.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const cb = casilla(e);
    if (cb) {
      soltar();
      pulsado = { x: e.clientX, y: e.clientY, largo: false, timer: setTimeout(() => { pulsado.largo = true; activar(cb.closest("ul,ol")); }, LARGO_MS) };
    } else if (zona(e)) e.preventDefault();
    else if (activo()) salir();
  }, true);
  cuerpo.addEventListener("pointermove", (e) => { if (pulsado && !pulsado.largo && Math.hypot(e.clientX - pulsado.x, e.clientY - pulsado.y) > 10) soltar(); });
  cuerpo.addEventListener("pointerup", soltar);
  cuerpo.addEventListener("pointercancel", soltar);
  cuerpo.addEventListener("mousedown", (e) => { if (zona(e)) e.preventDefault(); }, true);
  cuerpo.addEventListener("contextmenu", (e) => { if (casilla(e)) e.preventDefault(); });
  cuerpo.addEventListener("click", (e) => {
    if (pulsado?.largo) { e.preventDefault(); e.stopPropagation(); pulsado = null; return; } // era una pulsación larga: no cambia la casilla
    const l = zona(e);
    if (l) { e.preventDefault(); activar(l); return; }
    if (casilla(e) && activo()) salir();
  }, true);
  cuerpo.addEventListener("input", () => { if (!aplicando && activo()) salir(); });

  const teclas = (e) => {
    if (!activo()) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); salir(); return; }
    if (!(e.target === cuerpo || cuerpo.contains(e.target)) || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length === 1 || ["Backspace", "Delete", "Enter", "Tab"].includes(e.key)) { e.preventDefault(); salir(); } // no escribir encima de la selección
  };
  document.addEventListener("keydown", teclas, true);

  return { activo, salir, aplicar, establecerColor(color) { if (!activo() || !/^#[\da-f]{6}$/i.test(color)) return false; listas.forEach((l) => { l.setAttribute("data-marc-color", color.toLowerCase()); l.style.setProperty("--nt-marker-color", color.toLowerCase()); }); return true; }, destruir: () => { document.removeEventListener("keydown", teclas, true); salir(); } };
}

/* ===================== Menú 🛠 ===================== */
function crearHerramientas({ cuerpo, boton, obtenerTitulo = () => "", completadasAlFinal = () => true, alCambiar = () => {}, avisar = () => {}, alAbrir = () => {}, extras = () => [] }) {
  inyectarEstilos();
  let menu = null, ocupado = false;

  const rangoActual = () => {
    const s = getSelection();
    if (!s.rangeCount || s.isCollapsed) return null;
    const r = s.getRangeAt(0);
    return cuerpo.contains(r.commonAncestorContainer) ? r : null;
  };
  const alcance = () => { // posiciones de texto de la selección (si no hay, se trabaja con toda la nota)
    const r = rangoActual();
    if (!r) return {};
    const pos = (nodo, off) => { const x = document.createRange(); x.setStart(cuerpo, 0); x.setEnd(nodo, off); return x.toString().length; };
    return { desde: pos(r.startContainer, r.startOffset), hasta: pos(r.endContainer, r.endOffset) };
  };
  const htmlSeleccion = (r) => { const d = document.createElement("div"); d.append(r.cloneContents()); return d.innerHTML; };

  /** Desarma listas y citas antes de reemplazar el HTML; evita que el navegador mezcle los bloques viejos y nuevos. */
  function reemplazar(html) {
    const antes = cuerpo.innerHTML;
    let pasos = 0;
    ocupado = true;
    try {
      cuerpo.focus();
      const s = getSelection(), r = document.createRange();
      const todo = () => { r.selectNodeContents(cuerpo); s.removeAllRanges(); s.addRange(r); };
      todo();
      for (let i = 0; i < 8; i++) {
        const cmd = cuerpo.querySelector("ul") ? "insertUnorderedList" : cuerpo.querySelector("ol") ? "insertOrderedList" : cuerpo.querySelector("blockquote") ? "outdent" : null;
        if (!cmd) break;
        document.execCommand(cmd); pasos++; todo();
      }
      if (html.trim()) document.execCommand("insertHTML", false, html); else document.execCommand("delete");
      pasos++;
      const ult = cuerpo.lastChild;
      if (html.trim() && ult && ult.nodeName === "DIV" && !ult.childNodes.length && s.anchorNode === ult) { document.execCommand("delete"); pasos++; }
    } finally { ocupado = false; }
    alCambiar({ antes, pasos });
  }

  const motivoNoDisponible=(id)=>({"ordenar-az":"Se necesitan al menos dos líneas de texto.","ordenar-za":"Se necesitan al menos dos líneas de texto.",dup:"No hay líneas duplicadas que quitar.",vacias:"No hay líneas vacías que eliminar.",marcar:"No hay casillas en esta nota.","borrar-completados":"No hay casillas completadas que borrar.","ocr-tinta":"No hay tinta manuscrita para convertir.",mayus:"No hay texto para transformar.",minus:"No hay texto para transformar.",titulo:"No hay texto para transformar.",oracion:"No hay texto para transformar.",contar:"No hay texto para contar.",copiar:"No hay texto para copiar."}[id]||"Esta herramienta no se puede aplicar a la nota actual.");

  const MENSAJES = {
    "ordenar-az": () => tr("Ordenado A → Z"),
    "ordenar-za": () => tr("Ordenado Z → A"),
    mayus: () => tr("Texto en MAYÚSCULAS"),
    minus: () => tr("Texto en minúsculas"),
    titulo: () => tr("Texto en Tipo Título"),
    oracion: () => tr("Texto en Tipo oración"),
    dup: (r) => tr("Líneas duplicadas quitadas: {n}").replace("{n}", r.cambios),
    vacias: (r) => tr("Líneas vacías eliminadas: {n}").replace("{n}", r.cambios),
    marcar: (r) => tr(r.marcado ? "Pendientes marcados: {n}" : "Pendientes desmarcados: {n}").replace("{n}", r.cambios),
    "borrar-completados": (r) => tr("Completados borrados: {n}").replace("{n}", r.cambios),
  };

  async function copiar() {
    const texto = [obtenerTitulo().trim(), textoDeNota(sanearHTMLNota(cuerpo.innerHTML))].filter(Boolean).join("\n\n");
    if (!texto) return avisar(tr("No hay texto para copiar"));
    let ok = false;
    try { await navigator.clipboard.writeText(texto); ok = true; } catch (_) {
      const ta = document.createElement("textarea");
      ta.value = texto; ta.style.cssText = "position:fixed;opacity:0;pointer-events:none";
      document.body.append(ta); ta.select();
      try { ok = document.execCommand("copy"); } catch (_) {}
      ta.remove();
    }
    avisar(ok ? tr("Texto copiado") : tr("No se pudo copiar"));
  }

  function ejecutar(accion) {
    if (accion === "contar") return pintarConteo();
    cerrar();
    if (accion === "copiar") return copiar();
    const html = sanearHTMLNota(cuerpo.innerHTML);
    let r;
    try { r = transformarHTML(accion, html, { ...alcance(), completadasAlFinal: completadasAlFinal() }); } catch (err) { console.error(err); return avisar(tr("No se pudo aplicar")); }
    if (!r.cambios) return avisar(tr("No hay nada que cambiar"));
    reemplazar(r.html);
    avisar(MENSAJES[accion](r));
  }

  const fila = (a, b) => { const f = document.createElement("div"); f.className = "nt-herr-fila"; const x = document.createElement("span"); x.textContent = a; const y = document.createElement("b"); y.textContent = b; f.append(x, y); return f; };
  const boton_ = (texto, onclick) => { const b = document.createElement("button"); b.type = "button"; b.setAttribute("role", "menuitem"); b.textContent = texto; b.onclick = onclick; return b; };

  function pintarLista() {
    menu.replaceChildren();
    const html = sanearHTMLNota(cuerpo.innerHTML), cont = document.createElement("div"); cont.innerHTML = html;
    const texto = textoDeNota(html), hayTexto = !!(texto.trim() || obtenerTitulo().trim());
    const lineas = lineasDeNota(html, { marcadores: false });
    const checks = [...cont.querySelectorAll('input[data-nota-check]')];
    const disponibles = new Set();
    if (hayTexto) { ["mayus", "minus", "titulo", "oracion", "contar", "copiar"].forEach((x) => disponibles.add(x)); }
    if (lineas.filter((x) => x.trim()).length > 1) { disponibles.add("ordenar-az"); disponibles.add("ordenar-za"); }
    if (transformarHTML("dup", html).cambios) disponibles.add("dup");
    if (transformarHTML("vacias", html).cambios) disponibles.add("vacias");
    if (checks.length) disponibles.add("marcar");
    if (checks.some((x) => x.checked || x.hasAttribute("checked"))) disponibles.add("borrar-completados");
    for (const [titulo, items] of GRUPOS) {
      const visibles = items.filter(([id]) => disponibles.has(id));
      if (!visibles.length) continue;
      const h = document.createElement("div"); h.className = "nt-herr-tit"; h.textContent = tr(titulo); menu.append(h);
      for (const [id, texto] of visibles) menu.append(boton_(tr(texto), () => ejecutar(id)));
    }
    const extrasActuales=typeof extras==="function"?extras():[];const extraDisponible=extrasActuales.filter(x=>x.disponible);
    if(extraDisponible.length){const h=document.createElement("div");h.className="nt-herr-tit";h.textContent=tr("Tinta");menu.append(h);for(const x of extraDisponible)menu.append(boton_(tr(x.texto),()=>{cerrar();x.ejecutar();}));}
    const faltantes=[...GRUPOS.flatMap(([titulo,items])=>items.map(([id,texto])=>({titulo,id,texto}))).filter(x=>!disponibles.has(x.id)),...extrasActuales.filter(x=>!x.disponible).map(x=>({titulo:tr("Tinta"),id:x.id,texto:x.texto,extra:x}))];
    if(faltantes.length){const otros=document.createElement("button");otros.type="button";otros.className="nt-herr-otros";otros.textContent=tr("Otros");otros.setAttribute("aria-expanded","false");const detalle=document.createElement("div");detalle.className="nt-herr-otros-lista nt-oculto";let grupo="";for(const item of faltantes){if(item.titulo!==grupo){grupo=item.titulo;const h=document.createElement("div");h.className="nt-herr-tit";h.textContent=tr(grupo);detalle.append(h);}const b=boton_(tr(item.texto),()=>{if(item.extra){cerrar();item.extra.ejecutar();return;}const antes=transformarHTML(item.id,sanearHTMLNota(cuerpo.innerHTML)).cambios;cerrar();if(antes)ejecutar(item.id);else avisar(tr(motivoNoDisponible(item.id)));});b.classList.add("nt-herr-no-disponible");b.title=tr(motivoNoDisponible(item.id));detalle.append(b);}otros.onclick=()=>{const abrir=detalle.classList.contains("nt-oculto");detalle.classList.toggle("nt-oculto",!abrir);otros.setAttribute("aria-expanded",String(abrir));if(menu?.isConnected)posicionar();};menu.append(otros,detalle);}
    if (!menu.children.length) menu.append(boton_(tr("No hay herramientas disponibles para esta nota"), cerrar));
  }
  function pintarConteo() {
    const r = rangoActual();
    const lineas = lineasDeNota(r ? htmlSeleccion(r) : sanearHTMLNota(cuerpo.innerHTML), { marcadores: false });
    const e = estadisticas(lineas);
    const n = (v) => v.toLocaleString(document.documentElement.lang || "es");
    menu.replaceChildren();
    const h = document.createElement("div"); h.className = "nt-herr-alcance"; h.textContent = r ? tr("Contar texto · Selección") : tr("Contar texto · Toda la nota"); menu.append(h);
    menu.append(fila(tr("Palabras"), n(e.palabras)), fila(tr("Caracteres"), n(e.caracteres)), fila(tr("Sin espacios"), n(e.sinEspacios)), fila(tr("Líneas"), n(e.lineas)), fila(tr("Tiempo de lectura"), formatoLectura(e.segundos)));
    menu.append(boton_("‹ " + tr("Volver"), pintarLista));
  }

  const fuera = (e) => { if (menu && !menu.contains(e.target) && !boton.contains(e.target)) cerrar(); };
  const tecla = (e) => { if (e.key === "Escape" && menu) { e.preventDefault(); e.stopPropagation(); cerrar(); boton.focus({ preventScroll: true }); } };

  function posicionar() {
    const b = boton.getBoundingClientRect(), w = menu.offsetWidth, m = 8;
    const alto = menu.offsetHeight;
    let top = b.bottom + 6;
    if (top + alto > innerHeight - m) top = Math.max(m, b.top - alto - 6);
    menu.style.top = `${top}px`;
    menu.style.left = `${Math.max(m, Math.min(b.left + b.width / 2 - w / 2, innerWidth - w - m))}px`;
  }
  function abrir() {
    alAbrir();
    menu = document.createElement("div");
    menu.className = "nt-herr-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("aria-label", tr("Herramientas"));
    menu.addEventListener("mousedown", (e) => e.preventDefault()); // no le quita la selección al texto
    pintarLista();
    document.body.append(menu);
    posicionar();
    boton.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", fuera, true);
    document.addEventListener("keydown", tecla, true);
  }
  function cerrar() {
    if (!menu) return;
    menu.remove(); menu = null;
    boton.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", fuera, true);
    document.removeEventListener("keydown", tecla, true);
  }

  boton.addEventListener("mousedown", (e) => e.preventDefault());
  boton.addEventListener("click", () => (menu ? cerrar() : abrir()));
  return { abrir, cerrar, ejecutar, ocupado: () => ocupado, destruir: cerrar };
}

export { crearHerramientas, crearMarcadores };
