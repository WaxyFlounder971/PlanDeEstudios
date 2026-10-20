import { MAX_CARACTERES_NOTA, COLOR_DEFECTO, resolverColorNota, coloresPaletaNota, opcionesNotas, crearNota, obtenerNota, guardarNota, marcarEliminada } from "./notas-datos.js";
import { sanearHTMLNota, textoPlanoNota, renderizarHTMLNota } from "./notas-sanitizar.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { iniciarProcesoAnalitico, registrarAnaliticaUso } from "../core/analitica.js";
import { compartirNotaFuera } from "./notas-compartir.js";
import { crearCapaTinta } from "./notas-tinta.js";
import { crearCampoFecha, aValorFecha, deValorFecha } from "./notas-fechas.js";
import { instantanea, registrarCambio } from "./notas-historial.js";
import { ICONOS, contraste } from "./notas-ui.js";
import "./notas-estilos.js";
import { mostrarToast } from "../ui/componentes.js";

const tr = (x) => t(x);
const OPCIONES_PLAZO = [["manana", "Mañana"], ["3_dias", "En 3 días"], ["una_semana", "En una semana"], ["proximo_mes", "El próximo mes"], ["fecha", "Elegir fecha"]];
const ICONO_LAPIZ = '<svg class="nt-ico nt-ico-solido" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 17.5l.9-3.7L13.6 3.6l3 3L6.2 16.6l-3.7.9z"/><path d="M14.7 2.5l.7-.7a1.5 1.5 0 012.1 0l.7.7a1.5 1.5 0 010 2.1l-.7.7-3.1-3.1z"/></svg>';

function abrirEditorNota(notaId, alCerrar = () => {}) {
  const original = notaId ? obtenerNota(notaId) : null;
  const borrador = original ? { ...original } : crearNota({ vence_en: opcionesNotas().vencimiento_default ? fechaRelativa(opcionesNotas().plazo_default) : null });
  const instantaneaInicial = instantanea([borrador.id]); // para Ctrl+Z global: toda la sesión de edición es una sola entrada
  let guardado = false, cerrado = false, eliminando = false, timer = null, handlerTeclas = null, capaTinta = null, menuPlazoAbierto = null;
  let ultimoTipo = "t"; // última clase de cambio ("t" texto, "i" tinta): decide a qué afectan Deshacer/Rehacer
  let rangoGuardado = null;
  let ajustarTintaAuto = () => {}; // se define con la tinta: si no elegiste color de tinta, sigue el contraste de la nota
  let flujoAnalitico = iniciarProcesoAnalitico("notas.editor");

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay notas-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  const modal = document.createElement("section");
  modal.className = "glass-card notas-editor stack";
  modal.innerHTML = `<header class="notas-editor-cab"><button class="btn btn-secondary nt-pin" data-action="pin" aria-pressed="false">${ICONOS.anclar}</button><input class="form-input notas-titulo" maxlength="180" placeholder="${tr("Título (opcional)")}"><button class="btn btn-primary" data-action="close">${tr("Listo")}</button></header>
    <div class="nt-tiempos"></div>
    <div class="nt-barra-fila">
      <label class="nt-swatch nt-swatch-texto" title="${tr("Color de texto")}"><span class="nt-swatch-ico"><b>A</b></span><input type="color" class="nt-input-color nt-texto-color" aria-label="${tr("Color de texto")}"></label>
      <div class="notas-toolbar" role="toolbar" aria-label="${tr("Formato de nota")}"><button data-cmd="undo" title="${tr("Deshacer")} (Ctrl+Z)">↶</button><button data-cmd="redo" title="${tr("Rehacer")} (Ctrl+Y)">↷</button><span class="notas-sep" aria-hidden="true"></span><button data-cmd="bold" title="${tr("Negrita")}"><b>B</b></button><button data-cmd="italic" title="${tr("Cursiva")}"><i>I</i></button><button data-cmd="underline" title="${tr("Subrayado")}"><u>U</u></button><span class="notas-sep" aria-hidden="true"></span><button data-cmd="insertUnorderedList" title="${tr("Viñetas")}" aria-label="${tr("Viñetas")}"><span class="nt-punto"></span></button><button data-cmd="insertOrderedList" title="${tr("Lista numerada")}">1.</button><button data-cmd="check" title="${tr("Lista de pendientes")}" aria-label="${tr("Lista de pendientes")}"><svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M6.6 10.3l2.3 2.3 4.5-4.9"/></svg></button><span class="notas-sep" aria-hidden="true"></span><button data-tool="lapiz" aria-pressed="false" title="${tr("Lápiz")}" aria-label="${tr("Lápiz")}">${ICONO_LAPIZ}</button><button data-tool="borrador" aria-pressed="false" title="${tr("Borrador")}" aria-label="${tr("Borrador")}"><svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.6 3.4l5 5a1.4 1.4 0 010 2l-5.2 5.2H7.4L3.4 11.6a1.4 1.4 0 010-2l6.2-6.2a1.4 1.4 0 012 0z" fill="currentColor" fill-opacity=".25"/><path d="M6.2 7.6l6.2 6.2M8 16.6h9"/></svg></button></div>
      <label class="nt-swatch nt-swatch-tinta" title="${tr("Color de tinta")}"><span class="nt-swatch-ico">${ICONO_LAPIZ}</span><input type="color" class="nt-input-color nt-tinta-color" aria-label="${tr("Color de tinta")}"></label>
    </div>
    <div class="notas-cuerpo" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${tr("Escribe aquí…")}"></div>
    <footer class="notas-editor-foot"><div class="notas-editor-tools"><div class="notas-palette" aria-label="${tr("Color de nota")}"></div><label class="btn btn-secondary notas-vencimiento" role="button" title="${tr("Agregar vencimiento")}"><input type="checkbox" style="position:absolute;opacity:0;pointer-events:none"> <span>⏳ ${tr("Vencimiento")}</span></label><span class="nt-plazo"><button type="button" class="nt-chip nt-plazo-btn" aria-haspopup="listbox" aria-expanded="false"><span class="nt-plazo-txt"></span>${ICONOS.chevron}</button><div class="nt-menu nt-oculto" role="listbox" aria-label="${tr("Plazo de vencimiento")}"></div></span></div><div class="notas-editor-actions"><button class="btn btn-secondary" data-action="send">${ICONOS.wapper}<span>${tr("Wapper")}</span></button><button class="btn btn-secondary" data-action="share">${ICONOS.compartir}<span>${tr("Compartir")}</span></button><button class="btn btn-secondary" data-action="duplicate">${ICONOS.duplicar}<span>${tr("Duplicar")}</span></button><button class="btn btn-danger" data-action="delete">${ICONOS.papelera}<span>${tr("Eliminar")}</span></button></div></footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const titulo = modal.querySelector(".notas-titulo"), cuerpo = modal.querySelector(".notas-cuerpo"), checkVence = modal.querySelector(".notas-vencimiento input"), paleta = modal.querySelector(".notas-palette"), pin = modal.querySelector('[data-action="pin"]');
  const plazoWrap = modal.querySelector(".nt-plazo"), plazoBtn = modal.querySelector(".nt-plazo-btn"), plazoTxt = modal.querySelector(".nt-plazo-txt"), plazoMenu = modal.querySelector(".nt-menu");
  titulo.value = borrador.titulo || "";
  renderizarHTMLNota(cuerpo, borrador.contenido || "");
  cuerpo.contentEditable = "true";

  /* --- Persistencia --- */
  let plazoSel = original?.vence_en ? "fecha" : (opcionesNotas().plazo_default || "3_dias");
  let fechaVence = deValorFecha(original?.vence_en || fechaRelativa(opcionesNotas().plazo_default));
  const persistirAhora = () => {
    if (eliminando || cerrado) return;
    const texto = textoPlanoNota(cuerpo.innerHTML), tit = titulo.value.trim();
    if (!texto && !tit && !(borrador.tinta && borrador.tinta.length)) return;
    try {
      borrador.titulo = tit;
      borrador.contenido = sanearHTMLNota(cuerpo.innerHTML);
      borrador.vence_en = checkVence.checked ? (plazoSel === "fecha" ? aValorFecha(fechaVence) : fechaRelativa(plazoSel)) : null;
      const n = guardarNota(borrador);
      borrador.id = n.id;
      borrador.modificada_en = n.modificada_en;
      pintarModificada();
      guardado = true;
    } catch (error) { mostrarToast(tr(error.message)); }
  };
  const persistir = () => { clearTimeout(timer); timer = setTimeout(persistirAhora, 250); };
  const guardarAlSalir = () => { clearTimeout(timer); persistirAhora(); };
  function actualizarFormato() { // negrita / cursiva / subrayado se iluminan según donde esté el cursor
    const s = getSelection();
    if (!s.rangeCount || !cuerpo.contains(s.anchorNode)) return;
    for (const c of ["bold", "italic", "underline"]) {
      const b = modal.querySelector(`[data-cmd="${c}"]`);
      try { b?.setAttribute("aria-pressed", String(document.queryCommandState(c))); } catch (_) {}
    }
  }
  const selCambio = () => { const s = getSelection(); if (s.rangeCount && cuerpo.contains(s.anchorNode)) { rangoGuardado = s.getRangeAt(0).cloneRange(); actualizarFormato(); } };

  const cerrarEditor = () => {
    if (cerrado) return;
    clearTimeout(timer);
    try { persistirAhora(); } catch (err) { console.error(err); }
    cerrado = true;
    try { if (guardado) flujoAnalitico?.completar("guardado"); else flujoAnalitico?.cancelar("cancelado"); } catch (err) { console.error(err); }
    flujoAnalitico = null;
    window.removeEventListener("pagehide", guardarAlSalir);
    document.removeEventListener("visibilitychange", guardarAlSalir);
    document.removeEventListener("selectionchange", selCambio);
    if (handlerTeclas) document.removeEventListener("keydown", handlerTeclas);
    try { capaTinta?.destruir(); } catch (err) { console.error(err); }
    try { registrarCambio(eliminando ? "Eliminar nota" : original ? "Editar nota" : "Nueva nota", instantaneaInicial); } catch (err) { console.error(err); }
    setTimeout(() => { overlay.remove(); alCerrar(); }, 0); // siempre se cierra, pase lo que pase arriba
  };
  window.addEventListener("pagehide", guardarAlSalir);
  document.addEventListener("visibilitychange", guardarAlSalir);
  document.addEventListener("selectionchange", selCambio);

  /* --- Fechas: creada y modificada (editables, formato "Lun 19, oct 2026, 12:54 pm") --- */
  const filaTiempos = modal.querySelector(".nt-tiempos");
  const campoCreada = crearCampoFecha({ etiqueta: tr("Creada"), tipo: "datetime-local", ms: borrador.creada_en || Date.now(), alCambiar: (ms) => { borrador.creada_en = ms; persistir(); } });
  const campoMod = crearCampoFecha({ etiqueta: tr("Modificada"), tipo: "datetime-local", ms: borrador.modificada_en || Date.now(), alCambiar: (ms) => { borrador.modificada_en = ms; borrador._mod_manual = true; persistir(); } });
  filaTiempos.append(campoCreada.el, campoMod.el);
  function pintarModificada() { campoMod.establecer(borrador.modificada_en || Date.now()); }

  /* --- Colores de la nota --- */
  // Color de letra de la nota: el elegido en el selector (borrador.color_texto) o, si no hay, el de mayor contraste con el fondo.
  // Es la base del editor: lo que ves (texto, viñetas, checkboxes, "Escribe aquí…", cursor) sale siempre con el color del selector.
  const colorTextoBase = () => (/^#[\da-f]{6}$/i.test(borrador.color_texto || "") ? borrador.color_texto : contraste(resolverColorNota(borrador.color || opcionesNotas().color_default)));
  const refrescarSwatchTexto = () => {
    const c = colorTextoBase();
    inpTexto.value = c;
    swTexto.style.setProperty("--sw", c); swTexto.style.setProperty("--sw-fg", contraste(c));
    cuerpo.style.setProperty("color", c, "important");
  };
  const presets = coloresPaletaNota();
  const recientes = (opcionesNotas().colores_recientes || []).filter((c) => resolverColorNota(c) === c && !presets.includes(c)).slice(0, 4);
  const actual = resolverColorNota(borrador.color || opcionesNotas().color_default);
  // El color de la nota también entra en Deshacer / Rehacer (los cambios seguidos, como arrastrar el selector, cuentan como uno).
  const pilaColor = [actual]; let ic = 0, ultColorT = 0;
  const pintarColorNota = (color) => {
    borrador.color = color;
    modal.style.setProperty("--nota-color", color);
    paleta.querySelectorAll(".notas-color").forEach((x) => x.setAttribute("aria-pressed", String(x.title === color)));
    refrescarSwatchTexto();
    ajustarTintaAuto();
  };
  const aplicarColorNota = (color) => {
    opcionesNotas().colores_recientes = [color, ...(opcionesNotas().colores_recientes || []).filter((x) => x !== color)].slice(0, 8);
    const ahora = Date.now();
    if (ahora - ultColorT < 700 && ic > 0) pilaColor[ic] = color; else { pilaColor.length = ic + 1; pilaColor.push(color); ic++; }
    ultColorT = ahora; ultimoTipo = "c";
    pintarColorNota(color);
    persistir();
  };
  const crearBotonColor = (color) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "notas-color"; b.style.backgroundColor = color; b.title = color;
    b.setAttribute("aria-label", color); b.setAttribute("aria-pressed", String(actual === color));
    b.onclick = () => { aplicarColorNota(color); b.setAttribute("aria-pressed", "true"); };
    return b;
  };
  presets.forEach((c) => paleta.append(crearBotonColor(c)));
  const sepColor = document.createElement("span");
  sepColor.className = "notas-sep notas-sep-color"; sepColor.setAttribute("aria-hidden", "true");
  paleta.append(sepColor);
  recientes.forEach((c) => paleta.append(crearBotonColor(c)));
  const colorCustom = document.createElement("input");
  colorCustom.type = "color"; colorCustom.value = resolverColorNota(borrador.color || COLOR_DEFECTO); colorCustom.className = "notas-color-custom";
  colorCustom.style.cssText = "width:calc(var(--notas-dot,28px)*2);height:var(--notas-dot,28px);border-radius:999px;padding:0;border:2px solid rgba(255,255,255,.25);overflow:hidden;cursor:pointer;background:none;appearance:none;-webkit-appearance:none";
  colorCustom.title = tr("Elegir color"); colorCustom.setAttribute("aria-label", tr("Elegir color personalizado"));
  colorCustom.oninput = () => aplicarColorNota(colorCustom.value);
  paleta.append(colorCustom);
  requestAnimationFrame(() => { const d = paleta.querySelector(".notas-color"); if (d && d.offsetHeight) paleta.style.setProperty("--notas-dot", d.offsetHeight + "px"); });
  modal.style.setProperty("--nota-color", actual);

  /* --- Color de texto (izquierda): se aplica a la selección o a lo que escribas después --- */
  const swTexto = modal.querySelector(".nt-swatch-texto"), inpTexto = modal.querySelector(".nt-texto-color");
  refrescarSwatchTexto();
  inpTexto.addEventListener("input", () => {
    const c = inpTexto.value;
    cuerpo.focus();
    if (rangoGuardado) { const sl = getSelection(); sl.removeAllRanges(); sl.addRange(rangoGuardado); }
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed && cuerpo.contains(sel.anchorNode)) { // con texto seleccionado: solo esa parte
      document.execCommand("styleWithCSS", false, false);
      document.execCommand("foreColor", false, c);
      swTexto.style.setProperty("--sw", c); swTexto.style.setProperty("--sw-fg", contraste(c));
    } else { // sin selección: es el color de letra de toda la nota
      borrador.color_texto = c;
      refrescarSwatchTexto();
    }
    ultimoTipo = "t";
    persistir();
  });
  inpTexto.addEventListener("change", refrescarSwatchTexto); // al cerrar el selector, vuelve a mostrar el color base

  /* --- Texto: pegar sin formato, pendientes, listas automáticas --- */
  titulo.addEventListener("input", persistir);
  cuerpo.addEventListener("input", (e) => {
    limpiarEstilos();
    if (!e.inputType?.startsWith("history")) ultimoTipo = "t";
    if (e.inputType === "insertText" && /^[\s\u00a0]$/.test(e.data || "")) listaAutomatica();
    persistir();
  });
  cuerpo.addEventListener("blur", persistir);
  cuerpo.addEventListener("change", persistir);
  cuerpo.addEventListener("paste", (e) => { e.preventDefault(); const text = (e.clipboardData || window.clipboardData).getData("text/plain"); document.execCommand("insertText", false, text); });

  /** "1. " empieza una lista numerada (con ese número: "5. " empieza en 5); "- " o "* " empieza viñetas. */
  function listaAutomatica() {
    const sel = getSelection();
    if (!sel.rangeCount || !sel.isCollapsed) return;
    const nodo = sel.anchorNode;
    if (!nodo || nodo.nodeType !== 3 || !cuerpo.contains(nodo) || nodo.parentElement.closest("li")) return;
    const prev = nodo.previousSibling;
    if (prev && prev.nodeName !== "BR") return; // solo al inicio de una línea
    const antes = nodo.data.slice(0, sel.anchorOffset);
    const m = /^(\d{1,3})[.)][\s\u00a0]$/.exec(antes);
    const viñeta = /^[-*•][\s\u00a0]$/.test(antes);
    if (!m && !viñeta) return;
    const inicio = m ? parseInt(m[1], 10) : 1;
    const r = document.createRange();
    r.setStart(nodo, 0); r.setEnd(nodo, sel.anchorOffset); r.deleteContents();
    document.execCommand(m ? "insertOrderedList" : "insertUnorderedList");
    if (m && inicio !== 1) {
      const s2 = getSelection();
      const base = s2.anchorNode?.nodeType === 3 ? s2.anchorNode.parentElement : s2.anchorNode;
      const ol = base?.closest?.("ol");
      if (ol && cuerpo.contains(ol)) ol.setAttribute("start", String(inicio));
    }
  }

  /* --- Listas y pendientes: se aplican a la selección (o a la línea del cursor) sin reemplazar el texto --- */
  const CB = "input[data-nota-check]";
  const limpiarEstilos = () => cuerpo.querySelectorAll("[style]").forEach((n) => n.removeAttribute("style")); // el navegador agrega color fijo al unir líneas: se quita
  const recuperarSeleccion = (dentro) => { if (!dentro && rangoGuardado) { const s = getSelection(); s.removeAllRanges(); s.addRange(rangoGuardado); } };
  const baseDe = (nodo) => (nodo?.nodeType === 3 ? nodo.parentElement : nodo);
  function lisSeleccion() { // elementos de lista tocados por la selección
    const s = getSelection();
    if (!s.rangeCount || !cuerpo.contains(s.anchorNode)) return [];
    if (s.isCollapsed) { const li = baseDe(s.anchorNode)?.closest?.("li"); return li && cuerpo.contains(li) ? [li] : []; }
    const r = s.getRangeAt(0);
    return [...cuerpo.querySelectorAll("li")].filter((li) => r.intersectsNode(li));
  }
  function quitarCheckbox(li) { // borra el checkbox (y el espacio que lo acompaña) sin tocar el resto del texto
    const cb = li.querySelector(CB);
    if (!cb) return;
    const r = document.createRange();
    r.setStartBefore(cb);
    const sig = cb.nextSibling;
    if (sig && sig.nodeType === 3 && /^[\s\u00a0]/.test(sig.data)) r.setEnd(sig, 1); else r.setEndAfter(cb);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand("delete");
  }
  function insertarCheckbox(li) {
    const r = document.createRange();
    r.setStart(li, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    document.execCommand("insertHTML", false, '<input type="checkbox" data-nota-check="1">&nbsp;');
  }
  function alternarChecklist() {
    let lis = lisSeleccion();
    if (lis.length && lis.every((li) => li.querySelector(CB))) { // ya son pendientes: se quitan los checkbox y la lista
      for (const li of lis) {
        const lista = li.parentElement.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList";
        const r = document.createRange(); r.selectNodeContents(li); r.collapse(true);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        quitarCheckbox(li);
        document.execCommand(lista);
      }
      return;
    }
    if (lis.some((li) => li.parentElement?.tagName === "OL")) { document.execCommand("insertOrderedList"); lis = lisSeleccion(); } // numerada -> se apaga y pasa a viñetas
    if (!lis.length || lis.some((li) => li.parentElement?.tagName !== "UL")) { document.execCommand("insertUnorderedList"); lis = lisSeleccion(); }
    if (!lis.length) { document.execCommand("insertHTML", false, '<ul><li><input type="checkbox" data-nota-check="1">&nbsp;</li></ul>'); return; }
    for (const li of lis) if (!li.querySelector(CB)) insertarCheckbox(li);
  }
  function alternarLista(cmd) {
    const lis = lisSeleccion().filter((li) => li.querySelector(CB));
    if (lis.length) {
      const r0 = getSelection().getRangeAt(0).cloneRange();
      lis.forEach(quitarCheckbox);
      const s = getSelection(); s.removeAllRanges(); s.addRange(r0);
      if (cmd === "insertUnorderedList") return; // los pendientes pasan a viñetas normales
    }
    document.execCommand(cmd);
  }
  /* --- Pendientes: cada ítem es un bloque (checkbox + texto). Enter parte el texto en el cursor; Retroceso une con el anterior. --- */
  const NBSP = "\u00a0";
  const hayTexto = (nodos) => nodos.some((n) => (n.textContent || "").replace(/[\s\u00a0]/g, ""));
  const ponerCursor = (nodo, off) => { const r = document.createRange(); r.setStart(nodo, off); r.collapse(true); const sl = getSelection(); sl.removeAllRanges(); sl.addRange(r); };
  const nuevoCheckbox = () => { const cb = document.createElement("input"); cb.type = "checkbox"; cb.setAttribute("data-nota-check", "1"); return cb; };
  const recortarInicio = (raiz) => { const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT); for (let t = w.nextNode(); t; t = w.nextNode()) { t.data = t.data.replace(/^[\s\u00a0]+/, ""); if (t.data) break; } };
  const sinCheckbox = (li) => [...li.childNodes].filter((n) => !(n.nodeType === 1 && n.matches(CB)));

  function fusionarConAnterior(li, prev) {
    const nodos = sinCheckbox(li);
    const frag = document.createDocumentFragment();
    nodos.forEach((n) => frag.append(n));
    recortarInicio(frag);
    const pos = prev.childNodes.length; // el cursor queda justo en la unión
    prev.append(frag);
    li.remove();
    ponerCursor(prev, Math.min(pos, prev.childNodes.length));
  }

  cuerpo.addEventListener("keydown", (e) => {
    if (e.key !== "Backspace" || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
    const s = getSelection();
    if (!s.rangeCount || !s.isCollapsed) return;
    const li = baseDe(s.anchorNode)?.closest?.("li");
    if (!li || !cuerpo.contains(li)) return;
    const r = document.createRange(); r.selectNodeContents(li); r.setEnd(s.anchorNode, s.anchorOffset);
    if (r.cloneContents().textContent.replace(/[\s\u00a0]/g, "")) return; // hay texto antes del cursor: retroceso normal
    e.preventDefault();
    const prev = li.previousElementSibling;
    if (li.querySelector(CB) && prev && prev.tagName === "LI") fusionarConAnterior(li, prev); // une con el ítem de arriba (o lo quita si estaba vacío)
    else { // primer ítem: quita checkbox / viñeta / número y deja el texto
      const lista = li.parentElement.tagName === "OL" ? "insertOrderedList" : "insertUnorderedList";
      if (li.querySelector(CB)) quitarCheckbox(li);
      document.execCommand(lista);
    }
    limpiarEstilos(); ultimoTipo = "t"; persistir();
  });

  cuerpo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    const s = getSelection();
    if (!s.rangeCount || !cuerpo.contains(s.anchorNode)) return;
    let r = s.getRangeAt(0);
    const li = baseDe(r.startContainer)?.closest?.("li");
    if (!li || !cuerpo.contains(li) || !li.querySelector(CB)) return;
    e.preventDefault();
    if (!r.collapsed) { r.deleteContents(); r = s.getRangeAt(0); r.collapse(true); }
    if (!li.isConnected) { persistir(); return; }

    // Ítem vacío: Enter sale de la lista (lo que venga después queda en una lista aparte).
    if (!hayTexto(sinCheckbox(li))) {
      const ul = li.parentElement;
      const p = document.createElement("p"); p.innerHTML = "<br>";
      const resto = []; for (let n = li.nextElementSibling; n; n = n.nextElementSibling) resto.push(n);
      let despues = null;
      if (resto.length) { despues = document.createElement(ul.tagName.toLowerCase()); resto.forEach((n) => despues.append(n)); }
      li.remove();
      ul.after(p); if (despues) p.after(despues);
      if (!ul.querySelector("li")) ul.remove();
      ponerCursor(p, 0);
      persistir(); return;
    }

    // Parte el ítem en el cursor: todo lo que está a la derecha pasa al nuevo ítem (con su propio checkbox).
    const cola = document.createRange();
    cola.setStart(r.endContainer, r.endOffset);
    cola.setEnd(li, li.childNodes.length);
    const frag = cola.extractContents();
    frag.querySelectorAll(CB).forEach((c) => c.remove()); // por si el cursor estaba antes del checkbox
    recortarInicio(frag);
    if (!li.querySelector(CB)) li.prepend(nuevoCheckbox(), document.createTextNode(NBSP));
    const espacio = document.createTextNode(NBSP);
    const nuevo = document.createElement("li");
    nuevo.append(nuevoCheckbox(), espacio, frag);
    li.after(nuevo);
    ponerCursor(espacio, 1);
    limpiarEstilos(); ultimoTipo = "t"; persistir();
  });
  cuerpo.addEventListener("change", (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.toggleAttribute("checked", e.target.checked);
      if (opcionesNotas().completadas_al_final && e.target.checked) { const li = e.target.closest("li"); if (li && li.parentElement) li.parentElement.append(li); }
      persistir();
    }
  });

  /* --- Deshacer / rehacer: actúan sobre lo último que tocaste (tinta o texto) --- */
  const deshacerEditor = () => {
    if (ultimoTipo === "c" && ic > 0) { ic--; pintarColorNota(pilaColor[ic]); persistir(); return; }
    if (ultimoTipo === "i" && capaTinta.puedeDeshacer()) { capaTinta.deshacer(); return; }
    cuerpo.focus(); document.execCommand("undo"); persistir();
  };
  const rehacerEditor = () => {
    if (ultimoTipo === "c" && ic < pilaColor.length - 1) { ic++; pintarColorNota(pilaColor[ic]); persistir(); return; }
    if (ultimoTipo === "i" && capaTinta.puedeRehacer()) { capaTinta.rehacer(); return; }
    cuerpo.focus(); document.execCommand("redo"); persistir();
  };

  modal.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("mousedown", (ev) => ev.preventDefault())); // el botón no le quita la selección al texto
  modal.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => {
    const cmd = b.dataset.cmd;
    if (cmd === "undo") return deshacerEditor();
    if (cmd === "redo") return rehacerEditor();
    const dentro = cuerpo.contains(getSelection().anchorNode);
    cuerpo.focus(); recuperarSeleccion(dentro);
    if (cmd === "check") alternarChecklist();
    else if (cmd === "insertUnorderedList" || cmd === "insertOrderedList") alternarLista(cmd);
    else document.execCommand(cmd, false, null);
    limpiarEstilos();
    ultimoTipo = "t"; actualizarFormato();
    persistir();
  });

  /* --- Vencimiento: interruptor + plazo con menú propio + fecha --- */
  const campoVence = crearCampoFecha({ tipo: "date", ms: fechaVence, alCambiar: (ms) => { fechaVence = ms; persistir(); }, clase: "nt-fecha-venc" });
  plazoWrap.after(campoVence.el);
  const etiquetaPlazo = () => tr((OPCIONES_PLAZO.find(([v]) => v === plazoSel) || OPCIONES_PLAZO[1])[1]);
  const cerrarMenuPlazo = () => { plazoMenu.classList.add("nt-oculto"); plazoBtn.setAttribute("aria-expanded", "false"); menuPlazoAbierto = null; document.removeEventListener("pointerdown", fueraMenu, true); };
  const fueraMenu = (e) => { if (!plazoWrap.contains(e.target)) cerrarMenuPlazo(); };
  const pintarVence = () => {
    const on = checkVence.checked;
    plazoWrap.classList.toggle("nt-oculto", !on);
    campoVence.el.classList.toggle("nt-oculto", !on || plazoSel !== "fecha");
    plazoTxt.textContent = etiquetaPlazo();
    plazoMenu.querySelectorAll("[role=option]").forEach((o) => o.setAttribute("aria-selected", String(o.dataset.valor === plazoSel)));
    const l = checkVence.closest("label");
    l.classList.toggle("activo", on); l.setAttribute("aria-pressed", String(on));
    if (!on) cerrarMenuPlazo();
  };
  for (const [valor, texto] of OPCIONES_PLAZO) {
    const o = document.createElement("button");
    o.type = "button"; o.setAttribute("role", "option"); o.dataset.valor = valor; o.textContent = tr(texto);
    o.onclick = () => {
      plazoSel = valor;
      if (valor !== "fecha") fechaVence = deValorFecha(fechaRelativa(valor));
      campoVence.establecer(fechaVence);
      cerrarMenuPlazo(); pintarVence(); persistir();
      if (valor === "fecha") setTimeout(() => campoVence.abrir(), 0);
    };
    plazoMenu.append(o);
  }
  plazoBtn.onclick = () => {
    if (menuPlazoAbierto) return cerrarMenuPlazo();
    plazoMenu.classList.remove("nt-oculto"); plazoBtn.setAttribute("aria-expanded", "true"); menuPlazoAbierto = true;
    document.addEventListener("pointerdown", fueraMenu, true);
    plazoMenu.querySelector('[aria-selected="true"]')?.focus();
  };
  checkVence.checked = !!borrador.vence_en;
  checkVence.onchange = () => { pintarVence(); persistir(); };
  pintarVence();

  /* --- Fijar, acciones del pie --- */
  const pintarPin = () => { pin.classList.toggle("activo", !!borrador.fijada); pin.setAttribute("aria-pressed", String(!!borrador.fijada)); const txt = tr(borrador.fijada ? "Desfijar" : "Fijar"); pin.title = txt; pin.setAttribute("aria-label", txt); };
  pintarPin();
  pin.onclick = () => {
    borrador.fijada = !borrador.fijada;
    borrador.orden_fijada = borrador.fijada ? (Math.max(0, ...(window.__notasLista?.filter((n) => n.fijada).map((n) => n.orden_fijada || 0) || [0])) + 1) : null;
    pintarPin(); persistir();
  };
  modal.querySelector('[data-action="send"]').onclick = async () => {
    persistir(); await new Promise((r) => setTimeout(r, 280));
    const texto = [titulo.value.trim(), textoPlanoNota(cuerpo.innerHTML)].filter(Boolean).join("\n");
    if (!texto) return;
    const ok = await window.enviarNotaAWapper?.(borrador, texto);
    if (ok) cerrarEditor();
  };
  modal.querySelector('[data-action="share"]').onclick = async () => {
    const ok = await compartirNotaFuera([titulo.value.trim(), textoPlanoNota(cuerpo.innerHTML)].filter(Boolean).join("\n"), titulo.value);
    if (ok) registrarAnaliticaUso("notas", "Compartir nota");
  };
  modal.querySelector('[data-action="duplicate"]').onclick = () => {
    clearTimeout(timer); persistirAhora();
    const n = guardarNota(crearNota({ ...borrador, id: undefined, titulo: titulo.value ? `${titulo.value} (${tr("copia")})` : "", creada_en: undefined }));
    registrarCambio("Duplicar nota", [{ id: n.id, nota: null }]);
    flujoAnalitico?.completar("duplicado"); flujoAnalitico = null;
    window.dispatchEvent(new CustomEvent("notas:abrir", { detail: n.id }));
    cerrarEditor();
  };
  modal.querySelector('[data-action="delete"]').onclick = () => {
    eliminando = true; // lo primero: desde aquí nada puede volver a guardar (y revivir) la nota
    clearTimeout(timer);
    try {
      const enLista = obtenerNota(borrador.id);
      if (enLista) {
        marcarEliminada(enLista);
        borrador.eliminada_en = enLista.eliminada_en; // si algo guardara el borrador por error, seguiría eliminada
        borrador.motivo_eliminacion = enLista.motivo_eliminacion;
      }
    } catch (err) { console.error(err); }
    cerrarEditor();
    window.dispatchEvent(new Event("notas:actualizadas"));
  };
  modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = cerrarEditor);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarEditor(); });

  handlerTeclas = function teclas(e) {
    if (e.key === "Escape") { if (menuPlazoAbierto) { e.preventDefault(); cerrarMenuPlazo(); return; } cerrarEditor(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") { e.preventDefault(); persistir(); return; }
    // Ctrl+B negrita · Ctrl+K (y Ctrl+I) cursiva · Ctrl+U subrayado: aplican a la selección, o a lo que escribas a continuación.
    const ac = document.activeElement;
    if ((ac === cuerpo || cuerpo.contains(ac)) && !e.altKey && !e.shiftKey) {
      const cmd = { b: "bold", i: "italic", k: "italic", u: "underline" }[k];
      if (cmd) { e.preventDefault(); document.execCommand(cmd, false, null); ultimoTipo = "t"; actualizarFormato(); persistir(); return; }
    }
    if ((k === "z" || k === "y") && !e.altKey) {
      if (e.target === titulo || e.target.matches?.("input, textarea")) return; // los campos de texto conservan su deshacer nativo
      e.preventDefault();
      if (k === "y" || e.shiftKey) rehacerEditor(); else deshacerEditor();
    }
  };
  document.addEventListener("keydown", handlerTeclas);

  /* --- Tinta: lápiz y borrador (el selector de color vive a la derecha, siempre visible) --- */
  borrador.tinta = JSON.parse(JSON.stringify(borrador.tinta || []));
  capaTinta = crearCapaTinta({ cuerpo, modal, obtenerTrazos: () => borrador.tinta, alCambiar: () => { ultimoTipo = "i"; persistir(); } });
  const btnLapiz = modal.querySelector('[data-tool="lapiz"]'), btnBorrador = modal.querySelector('[data-tool="borrador"]');
  const swTinta = modal.querySelector(".nt-swatch-tinta"), inpTinta = modal.querySelector(".nt-tinta-color");
  const pintarSwTinta = () => { swTinta.style.setProperty("--sw", inpTinta.value); swTinta.style.setProperty("--sw-fg", contraste(inpTinta.value)); };
  // Tinta: clara sobre notas fuertes (modo oscuro) y oscura sobre notas suaves, hasta que elijas un color de tinta a mano.
  let tintaManual = false;
  const tintaAuto = () => contraste(resolverColorNota(borrador.color || opcionesNotas().color_default));
  inpTinta.value = tintaAuto();
  capaTinta.establecerColor(inpTinta.value); pintarSwTinta();
  ajustarTintaAuto = () => { if (tintaManual) return; inpTinta.value = tintaAuto(); capaTinta.establecerColor(inpTinta.value); pintarSwTinta(); };
  const fijarModo = (m) => { capaTinta.establecerModo(m); btnLapiz.setAttribute("aria-pressed", String(m === "lapiz")); btnBorrador.setAttribute("aria-pressed", String(m === "borrador")); };
  btnLapiz.onclick = () => fijarModo(capaTinta.obtenerModo() === "lapiz" ? null : "lapiz");
  btnBorrador.onclick = () => fijarModo(capaTinta.obtenerModo() === "borrador" ? null : "borrador");
  inpTinta.oninput = () => { tintaManual = true; capaTinta.establecerColor(inpTinta.value); pintarSwTinta(); if (capaTinta.obtenerModo() !== "lapiz") fijarModo("lapiz"); };
  cuerpo.addEventListener("pointermove", (e) => { if (e.pointerType === "pen" && !capaTinta.obtenerModo()) fijarModo("lapiz"); });
  requestAnimationFrame(() => cuerpo.focus());
}

function fechaRelativa(opcion = "3_dias") {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const dias = { manana: 1, "3_dias": 3, una_semana: 7, proximo_mes: 30 }[opcion] || 3;
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export { abrirEditorNota, fechaRelativa };
