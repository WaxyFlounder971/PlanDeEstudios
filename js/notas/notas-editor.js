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
    <footer class="notas-editor-foot"><div class="notas-editor-tools"><div class="notas-palette" aria-label="${tr("Color de nota")}"></div><label class="btn btn-secondary notas-vencimiento" role="button" title="${tr("Agregar vencimiento")}"><input type="checkbox" style="position:absolute;opacity:0;pointer-events:none"> <span>⏳ ${tr("Vencimiento")}</span></label><span class="nt-plazo"><button type="button" class="nt-chip nt-plazo-btn" aria-haspopup="listbox" aria-expanded="false"><span class="nt-plazo-txt"></span>${ICONOS.chevron}</button><div class="nt-menu nt-oculto" role="listbox" aria-label="${tr("Plazo de vencimiento")}"></div></span></div><div class="notas-editor-actions"><div class="notas-editor-share"><button class="btn btn-secondary" data-action="send">${ICONOS.wapper}<span>${tr("Enviar a Wapper")}</span></button><button class="btn btn-secondary" data-action="share">${ICONOS.compartir}<span>${tr("Compartir")}</span></button></div><div class="nt-acc-der"><button class="btn btn-secondary" data-action="duplicate">${ICONOS.duplicar}<span>${tr("Duplicar")}</span></button><button class="btn btn-danger" data-action="delete">${ICONOS.papelera}<span>${tr("Eliminar")}</span></button></div></div></footer>`;
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
    if (eliminando) return;
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
  const selCambio = () => { const s = getSelection(); if (s.rangeCount && cuerpo.contains(s.anchorNode)) rangoGuardado = s.getRangeAt(0).cloneRange(); };

  const cerrarEditor = () => {
    if (cerrado) return;
    clearTimeout(timer);
    persistirAhora();
    cerrado = true;
    if (guardado) flujoAnalitico?.completar("guardado"); else flujoAnalitico?.cancelar("cancelado");
    flujoAnalitico = null;
    window.removeEventListener("pagehide", guardarAlSalir);
    document.removeEventListener("visibilitychange", guardarAlSalir);
    document.removeEventListener("selectionchange", selCambio);
    if (handlerTeclas) document.removeEventListener("keydown", handlerTeclas);
    capaTinta?.destruir();
    registrarCambio(eliminando ? "Eliminar nota" : original ? "Editar nota" : "Nueva nota", instantaneaInicial);
    setTimeout(() => { overlay.remove(); alCerrar(); }, 0);
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
  const refrescarSwatchTexto = () => { const c = swTexto.dataset.manual === "1" ? inpTexto.value : contraste(resolverColorNota(borrador.color || opcionesNotas().color_default)); inpTexto.value = c; swTexto.style.setProperty("--sw", c); swTexto.style.setProperty("--sw-fg", contraste(c)); };
  const presets = coloresPaletaNota();
  const recientes = (opcionesNotas().colores_recientes || []).filter((c) => resolverColorNota(c) === c && !presets.includes(c)).slice(0, 4);
  const actual = resolverColorNota(borrador.color || opcionesNotas().color_default);
  const aplicarColorNota = (color) => {
    borrador.color = color;
    modal.style.setProperty("--nota-color", color);
    opcionesNotas().colores_recientes = [color, ...(opcionesNotas().colores_recientes || []).filter((x) => x !== color)].slice(0, 8);
    paleta.querySelectorAll("[aria-pressed]").forEach((x) => x.setAttribute("aria-pressed", "false"));
    refrescarSwatchTexto();
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
    swTexto.dataset.manual = "1";
    swTexto.style.setProperty("--sw", inpTexto.value); swTexto.style.setProperty("--sw-fg", contraste(inpTexto.value));
    cuerpo.focus();
    if (rangoGuardado) { const s = getSelection(); s.removeAllRanges(); s.addRange(rangoGuardado); }
    document.execCommand("styleWithCSS", false, false);
    document.execCommand("foreColor", false, inpTexto.value);
    ultimoTipo = "t";
    persistir();
  });

  /* --- Texto: pegar sin formato, pendientes, listas automáticas --- */
  titulo.addEventListener("input", persistir);
  cuerpo.addEventListener("input", (e) => {
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

  cuerpo.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const li = window.getSelection()?.anchorNode?.parentElement?.closest("li");
    if (!li || !li.querySelector('input[type="checkbox"]')) return;
    const contenidoLi = textoPlanoNota(li.innerHTML).replace(/^☐\s*|^☑\s*/, "").trim();
    if (!contenidoLi) {
      e.preventDefault();
      const p = document.createElement("p"); p.innerHTML = "<br>";
      li.parentElement.after(p);
      const rango = document.createRange(); rango.selectNodeContents(p); rango.collapse(true);
      const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rango);
      persistir(); return;
    }
    e.preventDefault();
    const nuevo = document.createElement("li");
    nuevo.innerHTML = '<input type="checkbox" data-nota-check="1"> ';
    li.after(nuevo);
    const rango = document.createRange(); rango.selectNodeContents(nuevo); rango.collapse(false);
    const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(rango);
    persistir();
  });
  cuerpo.addEventListener("change", (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.toggleAttribute("checked", e.target.checked);
      if (opcionesNotas().completadas_al_final && e.target.checked) { const li = e.target.closest("li"); if (li && li.parentElement) li.parentElement.append(li); }
      persistir();
    }
  });

  /* --- Deshacer / rehacer: actúan sobre lo último que tocaste (tinta o texto) --- */
  const deshacerEditor = () => { if (ultimoTipo === "i" && capaTinta.puedeDeshacer()) { capaTinta.deshacer(); return; } cuerpo.focus(); document.execCommand("undo"); persistir(); };
  const rehacerEditor = () => { if (ultimoTipo === "i" && capaTinta.puedeRehacer()) { capaTinta.rehacer(); return; } cuerpo.focus(); document.execCommand("redo"); persistir(); };

  modal.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => {
    const cmd = b.dataset.cmd;
    if (cmd === "undo") return deshacerEditor();
    if (cmd === "redo") return rehacerEditor();
    cuerpo.focus();
    if (cmd === "check") document.execCommand("insertHTML", false, '<ul><li><input type="checkbox" data-nota-check="1"> </li></ul>');
    else document.execCommand(cmd, false, null);
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
    clearTimeout(timer);
    const enLista = obtenerNota(borrador.id);
    if (enLista) { marcarEliminada(enLista); window.dispatchEvent(new Event("notas:actualizadas")); }
    eliminando = true; // evita que el guardado al cerrar "reviva" la nota
    cerrarEditor();
  };
  modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = cerrarEditor);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrarEditor(); });

  handlerTeclas = function teclas(e) {
    if (e.key === "Escape") { if (menuPlazoAbierto) { e.preventDefault(); cerrarMenuPlazo(); return; } cerrarEditor(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") { e.preventDefault(); persistir(); return; }
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
  inpTinta.value = opcionesNotas().color_tinta || "#172033";
  capaTinta.establecerColor(inpTinta.value); pintarSwTinta();
  const fijarModo = (m) => { capaTinta.establecerModo(m); btnLapiz.setAttribute("aria-pressed", String(m === "lapiz")); btnBorrador.setAttribute("aria-pressed", String(m === "borrador")); };
  btnLapiz.onclick = () => fijarModo(capaTinta.obtenerModo() === "lapiz" ? null : "lapiz");
  btnBorrador.onclick = () => fijarModo(capaTinta.obtenerModo() === "borrador" ? null : "borrador");
  inpTinta.oninput = () => { capaTinta.establecerColor(inpTinta.value); opcionesNotas().color_tinta = inpTinta.value; pintarSwTinta(); if (capaTinta.obtenerModo() !== "lapiz") fijarModo("lapiz"); };
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
