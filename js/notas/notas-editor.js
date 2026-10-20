import { prepararPegado } from "./notas-pegado.js";
import { MAX_CARACTERES_NOTA, COLOR_DEFECTO, resolverColorNota, coloresPaletaNota, opcionesNotas, grosorTrazoPreferido, guardarGrosorTrazoPreferido, obtenerStickersNotas, guardarStickerNota, guardarOrdenStickersNotas, eliminarStickerNota, formatoAutomatico, crearNota, obtenerNota, guardarNota, marcarEliminada, eliminarDefinitiva } from "./notas-datos.js";
import { sanearHTMLNota, textoPlanoNota, renderizarHTMLNota, escaparHTMLNota } from "./notas-sanitizar.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { iniciarProcesoAnalitico, registrarAnaliticaUso } from "../core/analitica.js";
import { compartirNotaFuera } from "./notas-compartir.js";
import { crearCapaTinta, GROSOR_BASE } from "./notas-tinta.js";
import { crearHerramientas, crearMarcadores } from "./notas-herramientas.js";
import { descargarWapper, leerWapper, compartirImagenNota } from "./notas-wapper.js";
import { crearCampoFecha, aValorFecha, deValorFecha, formatear } from "./notas-fechas.js";
import { instantanea, registrarCambio } from "./notas-historial.js";
import { ICONOS, contraste } from "./notas-ui.js";
import "./notas-estilos.js";
import { mostrarToast } from "../ui/componentes.js";

const tr = (x) => t(x);
const ICONO_LAPIZ = '<svg class="nt-ico nt-ico-solido" viewBox="0 0 20 20" aria-hidden="true"><path d="M2.5 17.5l.9-3.7L13.6 3.6l3 3L6.2 16.6l-3.7.9z"/><path d="M14.7 2.5l.7-.7a1.5 1.5 0 012.1 0l.7.7a1.5 1.5 0 010 2.1l-.7.7-3.1-3.1z"/></svg>';

function abrirEditorNota(notaId, alCerrar = () => {}) {
  const registroOriginal = notaId ? obtenerNota(notaId) : null;
  const original = registroOriginal ? JSON.parse(JSON.stringify(registroOriginal)) : null;
  const borrador = original ? { ...original } : crearNota({ vence_en: opcionesNotas().vencimiento_default ? fechaRelativa(opcionesNotas().plazo_default) : null });
  const instantaneaInicial = instantanea([borrador.id]); // para Ctrl+Z global: toda la sesión de edición es una sola entrada
  let guardado = false, cerrado = false, eliminando = false, descartandoCambios = false, timer = null, handlerTeclas = null, capaTinta = null, editarVence = false, preguntandoCerrar = false;
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
  modal.innerHTML = `<header class="notas-editor-cab"><button class="btn btn-secondary nt-pin" data-action="pin" aria-pressed="false">${ICONOS.anclar}</button><input class="form-input notas-titulo" maxlength="180" placeholder="${tr("Título (opcional)")}"><button class="btn btn-secondary nt-close-round" data-action="close" aria-label="${tr("Cerrar nota")}" title="${tr("Cerrar nota")}">×</button></header>
    <div class="nt-meta-row"><label class="nt-swatch nt-swatch-texto" title="${tr("Color de texto")}"><span class="nt-swatch-ico"><b>A</b></span><input type="color" class="nt-input-color nt-texto-color" aria-label="${tr("Color de texto")}"></label><div class="nt-tiempos"></div><label class="nt-swatch nt-swatch-tinta" title="${tr("Color de tinta")}"><span class="nt-swatch-ico">${ICONO_LAPIZ}</span><input type="color" class="nt-input-color nt-tinta-color" aria-label="${tr("Color de tinta")}"></label></div>
    <div class="nt-barra-fila"><div class="notas-toolbar" role="toolbar" aria-label="${tr("Formato de nota")}"><button data-cmd="undo" title="${tr("Deshacer")} (Ctrl+Z)">↶</button><button data-cmd="redo" title="${tr("Rehacer")} (Ctrl+Y)">↷</button><span class="notas-sep" aria-hidden="true"></span><button data-cmd="bold" title="${tr("Negrita")}"><b>B</b></button><button data-cmd="italic" title="${tr("Cursiva")}"><i>I</i></button><button data-cmd="underline" title="${tr("Subrayado")}"><u>U</u></button><span class="notas-sep" aria-hidden="true"></span><button data-cmd="insertUnorderedList" title="${tr("Viñetas")}" aria-label="${tr("Viñetas")}"><span class="nt-punto"></span></button><button data-cmd="insertOrderedList" title="${tr("Lista numerada")}">1.</button><button data-cmd="check" title="${tr("Lista de pendientes")}" aria-label="${tr("Lista de pendientes")}"><svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5"/><path d="M6.6 10.3l2.3 2.3 4.5-4.9"/></svg></button><span class="notas-sep" aria-hidden="true"></span><button data-tool="lapiz" aria-pressed="false" title="${tr("Lápiz")}" aria-label="${tr("Lápiz")}">${ICONO_LAPIZ}</button><button data-tool="borrador" aria-pressed="false" title="${tr("Borrador")}" aria-label="${tr("Borrador")}"><svg class="nt-ico" viewBox="0 0 20 20" aria-hidden="true"><path d="M11.6 3.4l5 5a1.4 1.4 0 010 2l-5.2 5.2H7.4L3.4 11.6a1.4 1.4 0 010-2l6.2-6.2a1.4 1.4 0 012 0z" fill="currentColor" fill-opacity=".25"/><path d="M6.2 7.6l6.2 6.2M8 16.6h9"/></svg></button></div></div>
    <div class="notas-cuerpo" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${tr("Escribe aquí…")}"></div>
    <footer class="notas-editor-foot"><div class="notas-palette notas-editor-tools" aria-label="${tr("Color de nota")}"></div><div class="notas-editor-foot-row"><div class="nt-vencimiento-area"><button type="button" class="nt-vencimiento-btn" data-action="vencimiento">${ICONOS.reloj}<span>${tr("Vencimiento")}</span></button><span class="nt-vencimiento-pick nt-oculto"><button type="button" class="nt-elegir-fecha">${tr("Elegir fecha")}</button></span><span class="nt-vencimiento-actual nt-oculto"></span><span class="nt-vencimiento-editar nt-oculto"><button type="button" class="nt-eliminar-vencimiento">${tr("Eliminar fecha de vencimiento")}</button></span></div><div class="notas-editor-actions"><button class="btn btn-secondary" data-action="send" aria-label="${tr("Wapper")}" title="${tr("Wapper")}">${ICONOS.wapper}</button><button class="btn btn-secondary" data-action="share" aria-label="${tr("Compartir")}" title="${tr("Compartir")}">${ICONOS.compartir}</button><button class="btn btn-secondary" data-action="duplicate" aria-label="${tr("Duplicar")}" title="${tr("Duplicar")}">${ICONOS.duplicar}</button><button class="btn btn-danger" data-action="delete" aria-label="${tr("Eliminar")}" title="${tr("Eliminar")}">${ICONOS.papelera}</button></div></div></footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const titulo = modal.querySelector(".notas-titulo"), cuerpo = modal.querySelector(".notas-cuerpo"), paleta = modal.querySelector(".notas-palette"), pin = modal.querySelector('[data-action="pin"]');
  const btnVencimiento = modal.querySelector(".nt-vencimiento-btn"), pickerVencimiento = modal.querySelector(".nt-vencimiento-pick"), venceActual = modal.querySelector(".nt-vencimiento-actual"), editarVencimiento = modal.querySelector(".nt-vencimiento-editar"), btnElegirFecha = modal.querySelector(".nt-elegir-fecha"), btnEliminarVencimiento = modal.querySelector(".nt-eliminar-vencimiento");
  const toolsFooter = modal.querySelector(".notas-editor-tools");
  const accionesExtra = document.createElement("div"); accionesExtra.className = "nt-share-overlay nt-oculto"; accionesExtra.setAttribute("role", "dialog"); accionesExtra.setAttribute("aria-modal", "true"); accionesExtra.setAttribute("aria-label", tr("Compartir"));
  const tarjetaCompartir = document.createElement("section"); tarjetaCompartir.className = "nt-share-menu-card";
  const cabeceraCompartir = document.createElement("header"); const tituloCompartir = document.createElement("strong"); tituloCompartir.textContent = tr("Compartir");
  const cerrarCompartir = document.createElement("button"); cerrarCompartir.type = "button"; cerrarCompartir.className = "nt-share-close"; cerrarCompartir.textContent = "×"; cerrarCompartir.setAttribute("aria-label", tr("Cerrar"));
  cabeceraCompartir.append(tituloCompartir, cerrarCompartir); tarjetaCompartir.append(cabeceraCompartir); accionesExtra.append(tarjetaCompartir);
  const crearAccionExtra = (texto) => { const b = document.createElement("button"); b.type = "button"; b.className = "btn btn-secondary"; b.textContent = tr(texto); tarjetaCompartir.append(b); return b; };
  const cerrarMenuCompartir = () => { accionesExtra.classList.add("nt-oculto"); modal.querySelector('[data-action="share"]')?.setAttribute("aria-expanded", "false"); };
  cerrarCompartir.onclick = cerrarMenuCompartir;
  accionesExtra.addEventListener("click", (e) => { if (e.target === accionesExtra) cerrarMenuCompartir(); });
  const btnTextoSimple = crearAccionExtra("Compartir texto simple");
  const btnWapperArchivo = crearAccionExtra("Compartir como Wapper Note");
  const btnImagenNota = crearAccionExtra("Compartir imagen");
  document.body.append(accionesExtra);
  btnWapperArchivo.onclick = () => { cerrarMenuCompartir(); descargarWapper({ ...borrador, titulo: titulo.value.trim(), contenido: sanearHTMLNota(cuerpo.innerHTML) }); };
  btnImagenNota.onclick = async () => {
    cerrarMenuCompartir();
    try { const r = await compartirImagenNota({ titulo: titulo.value.trim(), contenido: cuerpo.innerHTML, color: borrador.color || COLOR_DEFECTO, colorTexto: borrador.color_texto || contraste(resolverColorNota(borrador.color || COLOR_DEFECTO)), trazos: borrador.tinta || [], marcaAgua: opcionesNotas().sin_marca_agua !== true }); mostrarToast(tr(r === "compartida" ? "Imagen compartida" : "Imagen descargada")); }
    catch (e) { if (e.name !== "AbortError") mostrarToast(tr("No se pudo compartir la imagen")); }
  };
  const btnHerramientas = document.createElement("button");
  btnHerramientas.type = "button"; btnHerramientas.className = "nt-herr-btn"; btnHerramientas.textContent = "🛠";
  btnHerramientas.title = tr("Herramientas"); btnHerramientas.setAttribute("aria-label", tr("Herramientas"));
  btnHerramientas.setAttribute("aria-haspopup", "menu"); btnHerramientas.setAttribute("aria-expanded", "false");
  const barraTinta = modal.querySelector(".notas-toolbar");
  const btnFiguras = document.createElement("button"); btnFiguras.type = "button"; btnFiguras.className = "nt-figuras-btn"; btnFiguras.innerHTML = ICONOS.figuras;
  btnFiguras.title = tr("Figuras y stickers"); btnFiguras.setAttribute("aria-label", tr("Figuras y stickers")); btnFiguras.setAttribute("aria-haspopup", "menu"); btnFiguras.setAttribute("aria-expanded", "false");
  const menuFiguras = document.createElement("div"); menuFiguras.className = "nt-figuras-menu nt-oculto"; menuFiguras.setAttribute("role", "menu"); menuFiguras.setAttribute("aria-label", tr("Figuras y stickers"));
  const editarFigurasLabel=document.createElement("label"); editarFigurasLabel.className="nt-editar-figuras-toggle"; const editarFigurasInput=document.createElement("input"); editarFigurasInput.type="checkbox"; const editarFigurasTexto=document.createElement("span"); editarFigurasTexto.textContent=tr("Habilitar edición de figura"); editarFigurasLabel.append(editarFigurasInput,editarFigurasTexto); const eliminarFiguraBtn=document.createElement("button"); eliminarFiguraBtn.type="button"; eliminarFiguraBtn.className="nt-eliminar-figura nt-oculto"; eliminarFiguraBtn.textContent=tr("Eliminar figura seleccionada");
  const btnSubirSticker = document.createElement("button"); btnSubirSticker.type = "button"; btnSubirSticker.className = "nt-sticker-subir"; btnSubirSticker.textContent = tr("Stickers"); btnSubirSticker.setAttribute("role", "menuitem");
  const inputSticker = document.createElement("input"); inputSticker.type = "file"; inputSticker.accept = "image/*"; inputSticker.multiple = true; inputSticker.hidden = true;
  const btnImagenUnica = document.createElement("button"); btnImagenUnica.type = "button"; btnImagenUnica.className = "nt-imagen-subir"; btnImagenUnica.textContent = tr("Imágenes"); btnImagenUnica.setAttribute("role", "menuitem");
  const inputImagenUnica = document.createElement("input"); inputImagenUnica.type = "file"; inputImagenUnica.accept = "image/*"; inputImagenUnica.multiple = true; inputImagenUnica.hidden = true;
  btnImagenUnica.onclick = () => inputImagenUnica.click(); menuFiguras.append(editarFigurasLabel, eliminarFiguraBtn, btnSubirSticker, btnImagenUnica, inputSticker, inputImagenUnica);
  const botonesForma = [];
  for (const [modo, simbolo, nombre] of [["linea", "╱", "Línea recta"], ["flecha", "↗", "Flecha"], ["rectangulo", "▱", "Rectángulo"]]) {
    const b = document.createElement("button"); b.type = "button"; b.dataset.forma = modo; b.textContent = simbolo; b.title = tr(nombre); b.setAttribute("aria-label", tr(nombre)); b.setAttribute("aria-pressed", "false"); b.setAttribute("role", "menuitem"); menuFiguras.append(b); botonesForma.push(b);
  }
  barraTinta.append(btnFiguras, btnHerramientas); document.body.append(menuFiguras);
  const stickersOverlay=document.createElement("div");stickersOverlay.className="nt-stickers-overlay nt-oculto";stickersOverlay.setAttribute("role","dialog");stickersOverlay.setAttribute("aria-modal","true");
  const stickersPanel=document.createElement("section");stickersPanel.className="nt-stickers-panel";
  const stickersHead=document.createElement("header"),stickersTitulo=document.createElement("strong"),stickersEditar=document.createElement("button"),stickersCerrar=document.createElement("button"),stickersGrid=document.createElement("div");
  stickersTitulo.textContent=tr("Stickers");stickersEditar.type="button";stickersEditar.textContent=tr("Editar");stickersCerrar.type="button";stickersCerrar.className="nt-stickers-cerrar";stickersCerrar.textContent="×";stickersCerrar.setAttribute("aria-label",tr("Cerrar"));stickersGrid.className="nt-stickers-grid";
  stickersHead.append(stickersTitulo,stickersEditar,stickersCerrar);stickersPanel.append(stickersHead,stickersGrid);stickersOverlay.append(stickersPanel);document.body.append(stickersOverlay);
  let editarBibliotecaStickers=false,stickerArrastrado=null;
  const cerrarVentanaStickers=()=>{stickersOverlay.classList.add("nt-oculto");editarBibliotecaStickers=false;stickersEditar.textContent=tr("Editar");};
  stickersCerrar.onclick=cerrarVentanaStickers;stickersOverlay.addEventListener("click",e=>{if(e.target===stickersOverlay)cerrarVentanaStickers();});
  const figurasFuera = (e) => { if (!menuFiguras.contains(e.target) && !btnFiguras.contains(e.target)) cerrarMenuFiguras(); };
  const cerrarMenuFiguras = () => { menuFiguras.classList.add("nt-oculto"); btnFiguras.setAttribute("aria-expanded", "false"); document.removeEventListener("pointerdown", figurasFuera, true); };
  const posicionarFiguras = () => { const r = btnFiguras.getBoundingClientRect(); menuFiguras.style.left = `${Math.max(8, Math.min(r.left, innerWidth - menuFiguras.offsetWidth - 8))}px`; menuFiguras.style.top = `${Math.max(8, Math.min(r.bottom + 6, innerHeight - menuFiguras.offsetHeight - 8))}px`; };
  const pintarStickers = () => {
    stickersGrid.replaceChildren();
    if (!editarBibliotecaStickers) { const agregar = document.createElement("button"); agregar.type = "button"; agregar.className = "nt-sticker-agregar"; agregar.textContent = `＋\n${tr("Agregar sticker")}`; agregar.onclick = () => inputSticker.click(); stickersGrid.append(agregar); }
    for (const sticker of obtenerStickersNotas()) {
      const tile = document.createElement("div"); tile.className = "nt-sticker-celda"; tile.draggable = editarBibliotecaStickers; tile.style.touchAction = editarBibliotecaStickers ? "none" : ""; tile.dataset.stickerId = sticker.id;
      const b = document.createElement("button"); b.type = "button"; b.className = "nt-sticker-item"; b.setAttribute("aria-label", tr("Insertar sticker"));
      const img = document.createElement("img"); img.src = sticker.src; img.alt = ""; b.append(img); b.onclick = () => { if (!editarBibliotecaStickers) { insertarSticker(sticker); cerrarVentanaStickers(); } };
      tile.append(b);
      if (editarBibliotecaStickers) { const quitar = document.createElement("button"); quitar.type = "button"; quitar.className = "nt-sticker-quitar"; quitar.textContent = "×"; quitar.title = tr("Quitar sticker de la biblioteca"); quitar.setAttribute("aria-label", tr("Quitar sticker")); quitar.onclick = async (e) => { e.stopPropagation(); if (await confirmarQuitarSticker()) { eliminarStickerNota(sticker.id); pintarStickers(); } }; tile.append(quitar); }
      tile.draggable = false;
      let gesto = null;
      tile.addEventListener("pointerdown", (e) => { if (!editarBibliotecaStickers || e.target.closest(".nt-sticker-quitar") || (e.pointerType === "mouse" && e.button !== 0)) return; gesto = { id: sticker.id, x: e.clientX, y: e.clientY, moviendo: false }; try { tile.setPointerCapture(e.pointerId); } catch (_) {} });
      tile.addEventListener("pointermove", (e) => { if (!gesto || !editarBibliotecaStickers) return; if (!gesto.moviendo && Math.hypot(e.clientX-gesto.x,e.clientY-gesto.y)>8) { gesto.moviendo=true; tile.classList.add("arrastrando"); } if (gesto.moviendo) { const destino=document.elementFromPoint(e.clientX,e.clientY)?.closest(".nt-sticker-celda"); stickersGrid.querySelectorAll(".nt-sticker-celda.sobre-destino").forEach(x=>x.classList.remove("sobre-destino")); destino?.classList.add("sobre-destino"); } });
      const terminarReorden = (e) => { if (!gesto) return; const g=gesto; gesto=null; tile.classList.remove("arrastrando"); stickersGrid.querySelectorAll(".nt-sticker-celda.sobre-destino").forEach(x=>x.classList.remove("sobre-destino")); if(!g.moviendo)return; const destino=document.elementFromPoint(e.clientX,e.clientY)?.closest(".nt-sticker-celda"); if(!destino)return; const ids=obtenerStickersNotas().map(s=>s.id),from=ids.indexOf(g.id),to=ids.indexOf(destino.dataset.stickerId); if(from<0||to<0||from===to)return; ids.splice(to,0,...ids.splice(from,1)); guardarOrdenStickersNotas(ids); pintarStickers(); };
      tile.addEventListener("pointerup", terminarReorden); tile.addEventListener("pointercancel", terminarReorden);
      stickersGrid.append(tile);
    }
  };
  const confirmarQuitarSticker = () => new Promise((resolve) => {
    const dialogo=document.createElement("div"); dialogo.className="nt-sticker-confirmar"; dialogo.setAttribute("role","alertdialog"); dialogo.setAttribute("aria-modal","true");
    const caja=document.createElement("section"), mensaje=document.createElement("p"), acciones=document.createElement("div"), cancelar=document.createElement("button"), quitar=document.createElement("button");
    mensaje.textContent=tr("Se quitará de tu biblioteca. Las notas que ya lo usan no cambian."); cancelar.type="button"; cancelar.textContent=tr("Cancelar"); quitar.type="button"; quitar.textContent=tr("Quitar"); quitar.className="nt-sticker-confirmar-quitar";
    const cerrar=(valor)=>{dialogo.remove();resolve(valor);}; cancelar.onclick=()=>cerrar(false); quitar.onclick=()=>cerrar(true); dialogo.addEventListener("click",e=>{if(e.target===dialogo)cerrar(false);});
    acciones.append(cancelar,quitar); caja.append(mensaje,acciones); dialogo.append(caja); stickersPanel.append(dialogo); quitar.focus({preventScroll:true});
  });
  stickersEditar.onclick = () => { editarBibliotecaStickers=!editarBibliotecaStickers; stickersEditar.textContent=tr(editarBibliotecaStickers?"Listo":"Editar"); pintarStickers(); };
  btnSubirSticker.onclick = () => { cerrarMenuFiguras(); pintarStickers(); stickersOverlay.classList.remove("nt-oculto"); };
  btnFiguras.onclick = () => { const abrir = menuFiguras.classList.contains("nt-oculto"); if (!abrir) return cerrarMenuFiguras(); menuFiguras.classList.remove("nt-oculto"); posicionarFiguras(); btnFiguras.setAttribute("aria-expanded", "true"); document.addEventListener("pointerdown", figurasFuera, true); };
  menuFiguras.addEventListener("mousedown", (e) => e.preventDefault());
  menuFiguras.addEventListener("keydown", (e) => { if (e.key === "Escape") { cerrarMenuFiguras(); btnFiguras.focus({ preventScroll: true }); } });
  const grupoGrosor = document.createElement("label"); grupoGrosor.className = "nt-tinta-tamanos"; grupoGrosor.setAttribute("aria-label", tr("Tamaño de trazo"));
  const valorGrosor = document.createElement("output"); valorGrosor.className = "nt-tinta-valor"; valorGrosor.value = "1×"; valorGrosor.textContent = "1×";
  const sliderGrosor = document.createElement("input"); sliderGrosor.type = "range"; sliderGrosor.min = "0.5"; sliderGrosor.max = "3"; sliderGrosor.step = "0.05"; sliderGrosor.value = String(grosorTrazoPreferido()); sliderGrosor.title = tr("Tamaño de trazo"); sliderGrosor.setAttribute("aria-label", tr("Tamaño de trazo"));
  sliderGrosor.oninput = () => { const factor = Number(sliderGrosor.value); valorGrosor.value = `${factor.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}×`; valorGrosor.textContent = valorGrosor.value; capaTinta?.establecerGrosor(GROSOR_BASE * factor); };
  sliderGrosor.onchange = () => guardarGrosorTrazoPreferido(sliderGrosor.value);
  sliderGrosor.oninput();
  grupoGrosor.append(sliderGrosor, valorGrosor); toolsFooter.append(grupoGrosor);
  const marcadores = crearMarcadores({ cuerpo });
  const herramientas = crearHerramientas({ cuerpo, boton: btnHerramientas, obtenerTitulo: () => titulo.value, completadasAlFinal: () => opcionesNotas().completadas_al_final, alCambiar: () => { ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto"); }, avisar: mostrarToast });
  titulo.value = borrador.titulo || "";
  renderizarHTMLNota(cuerpo, borrador.contenido || "");
  cuerpo.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = false; });
  cuerpo.contentEditable = "true";
  const firmaEditor = () => JSON.stringify({ titulo: titulo.value.trim(), contenido: sanearHTMLNota(cuerpo.innerHTML), tinta: borrador.tinta || [], color: borrador.color || COLOR_DEFECTO, color_texto: borrador.color_texto || null, vence_en: borrador.vence_en || null, fijada: !!borrador.fijada });
  const firmaInicialEditor = firmaEditor();

  /* --- Persistencia --- */
  let fechaVence = deValorFecha(original?.vence_en || fechaRelativa(opcionesNotas().plazo_default));
  const persistirAhora = () => {
    if (eliminando || cerrado) return;
    const texto = textoPlanoNota(cuerpo.innerHTML), tit = titulo.value.trim();
    if (!texto && !tit && !(borrador.tinta && borrador.tinta.length)) return;
    try {
      borrador.titulo = tit;
      borrador.contenido = sanearHTMLNota(cuerpo.innerHTML);
      borrador.vence_en = borrador.vence_en || null;
      const n = guardarNota(borrador);
      window.dispatchEvent(new Event("notas:actualizadas-ui"));
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
    if (!eliminando) { try { persistirAhora(); } catch (err) { console.error(err); } }
    cerrado = true;
    try { if (guardado) flujoAnalitico?.completar("guardado"); else flujoAnalitico?.cancelar("cancelado"); } catch (err) { console.error(err); }
    flujoAnalitico = null;
    window.removeEventListener("pagehide", guardarAlSalir);
    document.removeEventListener("visibilitychange", guardarAlSalir);
    document.removeEventListener("selectionchange", selCambio);
    if (handlerTeclas) document.removeEventListener("keydown", handlerTeclas);
    campoCreada?.destruir?.(); campoMod?.destruir?.(); campoVence?.destruir?.();
    try { capaTinta?.destruir(); } catch (err) { console.error(err); }
    try { marcadores.destruir(); herramientas.destruir(); } catch (err) { console.error(err); }
    cerrarMenuFiguras(); menuFiguras.remove(); accionesExtra.remove(); stickersOverlay.remove();
    try { if (!descartandoCambios) registrarCambio(eliminando ? "Eliminar nota" : original ? "Editar nota" : "Nueva nota", instantaneaInicial); } catch (err) { console.error(err); }
    setTimeout(() => { overlay.remove(); alCerrar(); }, 0); // siempre se cierra, pase lo que pase arriba
  };
  window.addEventListener("pagehide", guardarAlSalir);
  document.addEventListener("visibilitychange", guardarAlSalir);
  document.addEventListener("selectionchange", selCambio);

  /* --- Fechas: creada y modificada (editables, formato "Lun 19, oct 2026, 12:54 pm") --- */
  const filaTiempos = modal.querySelector(".nt-tiempos");
  const campoCreada = crearCampoFecha({ etiqueta: tr("Creada"), tipo: "datetime-local", ms: borrador.creada_en || Date.now(), alCambiar: (ms) => { borrador.creada_en = ms; persistir(); } });
  const campoMod = crearCampoFecha({ etiqueta: tr("Modificada"), tipo: "datetime-local", ms: borrador.modificada_en || Date.now(), alCambiar: (ms) => { borrador.modificada_en = ms; borrador._mod_manual = true; persistir(); } });
  if (opcionesNotas().mostrar_creada !== false) filaTiempos.append(campoCreada.el);
  if (opcionesNotas().mostrar_modificada !== false) filaTiempos.append(campoMod.el);
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
  const recientes = (opcionesNotas().colores_recientes || []).filter((c) => resolverColorNota(c) === c && !presets.includes(c)).slice(0, 3);
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
    opcionesNotas().colores_recientes = [color, ...(opcionesNotas().colores_recientes || []).filter((x) => x !== color)].slice(0, 3);
    const ahora = Date.now();
    if (ahora - ultColorT < 700 && ic > 0) pilaColor[ic] = color; else { pilaColor.length = ic + 1; pilaColor.push(color); ic++; }
    ultColorT = ahora; ultimoTipo = "c";
    pintarColorNota(color);
    persistir();
    guardarPasoHistorial("color");
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
    if (marcadores.activo()) {
      marcadores.establecerColor(c); swTexto.style.setProperty("--sw", c); swTexto.style.setProperty("--sw-fg", contraste(c));
      ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto"); return;
    }
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
    guardarPasoHistorial("color");
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
  cuerpo.addEventListener("paste", (e) => {
    e.preventDefault();
    const cb = e.clipboardData || window.clipboardData;
    const html = cb.getData("text/html"), texto = cb.getData("text/plain");
    if (!html && !texto) return;
    const fmt = formatoAutomatico();
    const { literal, convertido, hayConversion } = prepararPegado({ html, texto }, { corchetes: fmt, whatsapp: fmt });
    if (!literal && !convertido) return;
    forzandoPasosPegado = true;
    if (!hayConversion) { document.execCommand("insertHTML", false, literal); guardarPasoHistorial("pegado-literal"); forzandoPasosPegado = false; }
    else {
      // Dos pasos: primero se pega con los "[]" como texto y luego se convierten en casillas.
      // Así Ctrl+Z deshace solo la conversión y deja los "[]" tal como venían.
      let ini = null;
      try { const s = getSelection(); if (s.rangeCount) { ini = s.getRangeAt(0).cloneRange(); ini.collapse(true); } } catch (_) {}
      document.execCommand("insertHTML", false, literal);
      guardarPasoHistorial("pegado-literal");
      try {
        const s = getSelection();
        if (!ini || !s.rangeCount) throw new Error("sin rango");
        const r = ini.cloneRange(); r.setEnd(s.anchorNode, s.anchorOffset);
        s.removeAllRanges(); s.addRange(r);
        document.execCommand("insertHTML", false, convertido);
        guardarPasoHistorial("pegado-conversion");
      } catch (_) { /* si no se pudo convertir, queda el texto pegado tal cual */ }
      forzandoPasosPegado = false;
    }
    limpiarEstilos(); ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto");
  });

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
  const limpiarEstilos = () => cuerpo.querySelectorAll("[style]:not(img[data-nota-sticker]):not(img[data-nota-image])").forEach((n) => { const colorMarcador = n.matches("ul[data-marc-color],ol[data-marc-color]") ? n.getAttribute("data-marc-color") : null; n.removeAttribute("style"); if (/^#[\da-f]{6}$/i.test(colorMarcador || "")) n.style.setProperty("--nt-marker-color", colorMarcador); }); // conserva los tamaños ajustados de stickers e imágenes
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
    limpiarEstilos(); ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto");
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
      persistir(); guardarPasoHistorial("texto"); return;
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
    limpiarEstilos(); ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto");
  });
  cuerpo.addEventListener("change", (e) => {
    if (e.target.matches('input[type="checkbox"]')) {
      e.target.toggleAttribute("checked", e.target.checked);
      if (opcionesNotas().completadas_al_final && e.target.checked) { const li = e.target.closest("li"); if (li && li.parentElement) li.parentElement.append(li); }
      persistir();
    }
  });

  /* --- Deshacer / rehacer: actúan sobre lo último que tocaste (tinta o texto) --- */
  const historialEditor = [], futuroEditor = [];
  let restaurandoHistorial = false, forzandoPasosPegado = false, ultimaCategoriaHistorial = "", ultimoTiempoHistorial = 0;
  const tomarEstadoEditor = () => ({ titulo: titulo.value, contenido: cuerpo.innerHTML, tinta: JSON.parse(JSON.stringify(borrador.tinta || [])), color: borrador.color || COLOR_DEFECTO, color_texto: borrador.color_texto || null });
  const claveEstadoEditor = (s) => JSON.stringify(s);
  function guardarPasoHistorial(categoria = "texto") {
    if (restaurandoHistorial) return;
    const actual = tomarEstadoEditor(), clave = claveEstadoEditor(actual), ultimo = historialEditor.at(-1);
    if (ultimo && claveEstadoEditor(ultimo) === clave) return;
    const ahora = Date.now();
    if (ultimo && categoria === ultimaCategoriaHistorial && ahora - ultimoTiempoHistorial < 650) historialEditor[historialEditor.length - 1] = actual;
    else { historialEditor.push(actual); if (historialEditor.length > 100) historialEditor.shift(); }
    futuroEditor.length = 0; ultimaCategoriaHistorial = categoria; ultimoTiempoHistorial = ahora;
  }
  function insertarSticker(sticker) {
    const naturalW = Number(sticker.ancho) || 512, naturalH = Number(sticker.alto) || 512;
    const ancho = Math.min(240, naturalW), alto = Math.max(24, Math.round(ancho * naturalH / Math.max(1, naturalW)));
    const html = `<img data-nota-sticker="1" src="${sticker.src}" alt="Sticker" width="${ancho}" height="${alto}"><br>`;
    const s = getSelection(), dentro = !!(s?.rangeCount && cuerpo.contains(s.anchorNode));
    cuerpo.focus(); recuperarSeleccion(dentro); document.execCommand("insertHTML", false, html);
    limpiarEstilos(); persistir(); guardarPasoHistorial("texto"); cerrarMenuFiguras();
  }
  const convertirImagenArchivo = async (file, limite = 1024) => {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      const factor = Math.min(1, limite / Math.max(bitmap.width, bitmap.height));
      let resultado = null;
      for (const escala of [factor, factor * .8, factor * .62]) {
        const ancho = Math.max(1, Math.round(bitmap.width * escala)), alto = Math.max(1, Math.round(bitmap.height * escala));
        const canvas = document.createElement("canvas"); canvas.width = ancho; canvas.height = alto;
        const ctx = canvas.getContext("2d", { alpha: true }); ctx.drawImage(bitmap, 0, 0, ancho, alto);
        const pixeles = ctx.getImageData(0, 0, ancho, alto).data; let transparente = false;
        for (let i = 3; i < pixeles.length; i += 4) if (pixeles[i] < 255) { transparente = true; break; }
        const tipo = transparente ? "image/png" : "image/webp";
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, tipo, .85));
        if (!blob) continue;
        const src = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(blob); });
        if (String(src).length <= 2_000_000) { resultado = { src, ancho, alto }; break; }
      }
      bitmap.close?.();
      if (!resultado) throw new Error("La imagen sigue siendo demasiado pesada después de reducirla");
      return resultado;
    } finally { bitmap?.close?.(); }
  };
  inputSticker.onchange = async () => {
    const files = [...(inputSticker.files || [])]; inputSticker.value = ""; if (!files.length) return;
    try {
      const nuevos = [];
      for (const file of files) { const imagen = await convertirImagenArchivo(file, 1024); nuevos.push(guardarStickerNota({ nombre: file.name, ...imagen })); }
      pintarStickers(); nuevos.forEach(insertarSticker); mostrarToast(tr("Sticker guardado en tu cuenta"));
    } catch (error) { mostrarToast(tr(error.message || "No se pudo guardar el sticker")); }
  };
  const insertarImagenesUnicas = async (files) => {
    const imagenes = [];
    for (const file of files) imagenes.push(await convertirImagenArchivo(file, 1600));
    const html = imagenes.map(({src,ancho,alto},i) => `<img data-nota-image="1" src="${src}" alt="" width="${ancho}" height="${alto}" data-move-x="${(i*0.006).toFixed(3)}"><br>`).join("");
    const s = getSelection(), dentro = !!(s?.rangeCount && cuerpo.contains(s.anchorNode));
    cuerpo.focus(); recuperarSeleccion(dentro); document.execCommand("insertHTML", false, html);
    limpiarEstilos(); persistir(); guardarPasoHistorial("texto");
  };
  inputImagenUnica.onchange = async () => {
    const files = [...(inputImagenUnica.files || [])]; inputImagenUnica.value = ""; if (!files.length) return;
    try { await insertarImagenesUnicas(files); cerrarMenuFiguras(); }
    catch (error) { mostrarToast(tr(error.message || "No se pudo insertar la imagen")); }
  };
  cuerpo.addEventListener("paste", async (e) => {
    const data = e.clipboardData; if (!data || (data.getData("text/plain") || "").length) return;
    const files = [...(data.files || [])];
    for (const item of [...(data.items || [])]) if (item.kind === "file" && item.type.startsWith("image/")) { const file = item.getAsFile(); if (file && !files.some((x) => x === file)) files.push(file); }
    const imagenes = files.filter((file) => file.type.startsWith("image/")); if (!imagenes.length) return;
    e.preventDefault();
    try { await insertarImagenesUnicas(imagenes); }
    catch (error) { mostrarToast(tr("No se pudo pegar la imagen")); }
  }, true);
  let stickerActivo = null, menuSticker = null;
  const aplicarTransformacionSticker = (img) => {
    const rot = Number(img.dataset.rot) || 0, sx = img.dataset.flipH === "1" ? -1 : 1, sy = img.dataset.flipV === "1" ? -1 : 1;
    const anchoNota = cuerpo.clientWidth || 700, x = (Number(img.dataset.moveX) || 0) * anchoNota, y = (Number(img.dataset.moveY) || 0) * anchoNota;
    img.style.position = "relative"; img.style.zIndex = String(Number(img.dataset.z) || 0);
    img.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg) scale(${sx},${sy})`;
  };
  if (typeof ResizeObserver === "function") { const roSticker = new ResizeObserver(() => cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]").forEach(aplicarTransformacionSticker)); roSticker.observe(cuerpo); }
  const cerrarMenuSticker = () => { menuSticker?.remove(); menuSticker = null; document.removeEventListener("pointerdown", fueraMenuSticker, true); };
  const fueraMenuSticker = (e) => { if (menuSticker && !menuSticker.contains(e.target)) cerrarMenuSticker(); };
  const actualizarSticker = (img) => { aplicarTransformacionSticker(img); persistir(); guardarPasoHistorial("sticker"); };
  const abrirMenuSticker = (img, x, y) => {
    cerrarMenuSticker(); stickerActivo = img;
    const menu = document.createElement("div"); menu.className = "nt-sticker-contexto"; menu.setAttribute("role", "menu");
    Object.assign(menu.style, { position: "fixed", left: `${Math.max(8, Math.min(x, innerWidth - 230))}px`, top: `${Math.max(8, Math.min(y, innerHeight - 320))}px`, zIndex: "100050", display: "grid", gap: "4px", minWidth: "210px", padding: "9px", borderRadius: "14px", background: "var(--bg-card,#211e2d)", color: "inherit", boxShadow: "0 12px 32px #0009", border: "1px solid var(--border-glass,rgba(255,255,255,.18))" });
    const item = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = tr(label); b.setAttribute("role", "menuitem"); Object.assign(b.style, { minHeight: "34px", border: "0", borderRadius: "9px", padding: "6px 9px", background: "transparent", color: "inherit", textAlign: "left", font: "inherit", cursor: "pointer" }); b.onclick = fn; menu.append(b); return b; };
    item("Seleccionar", () => { img.classList.toggle("nt-sticker-seleccionado"); img.contentEditable = img.classList.contains("nt-sticker-seleccionado") ? "false" : "true"; });
    item("Espejear horizontal", () => { img.dataset.flipH = img.dataset.flipH === "1" ? "0" : "1"; actualizarSticker(img); });
    item("Espejear vertical", () => { img.dataset.flipV = img.dataset.flipV === "1" ? "0" : "1"; actualizarSticker(img); });
    const rotacion = document.createElement("label"); rotacion.className = "nt-rotacion-control";
    const tituloRotacion = document.createElement("span");
    const rango = document.createElement("input"); rango.type = "range"; rango.min = "0"; rango.max = "359"; rango.step = "1"; rango.value = String(Number(img.dataset.rot) || 0); rango.setAttribute("aria-label", tr("Rotar"));
    const grados = document.createElement("span"); grados.className = "nt-rotacion-grados";
    const menos = document.createElement("button"); menos.type = "button"; menos.textContent = "−"; menos.setAttribute("aria-label", tr("Reducir un grado"));
    const campoGrados = document.createElement("input"); campoGrados.type = "number"; campoGrados.min = "0"; campoGrados.max = "359"; campoGrados.step = "1"; campoGrados.value = rango.value; campoGrados.setAttribute("aria-label", tr("Rotación en grados"));
    const sufijoGrados = document.createElement("span"); sufijoGrados.textContent = "°";
    const mas = document.createElement("button"); mas.type = "button"; mas.textContent = "+"; mas.setAttribute("aria-label", tr("Aumentar un grado"));
    grados.append(menos, campoGrados, sufijoGrados, mas);
    const normalizarGrados = (valor) => (Math.round(Number(valor) || 0) % 360 + 360) % 360;
    const previsualizarGiro = (valor) => { const n = normalizarGrados(valor); img.dataset.rot = String(n); rango.value = String(n); campoGrados.value = String(n); tituloRotacion.textContent = `${tr("Rotar")} ${n}°`; aplicarTransformacionSticker(img); };
    const confirmarGiro = () => { previsualizarGiro(campoGrados.value); actualizarSticker(img); };
    tituloRotacion.className = "nt-rotacion-titulo"; rotacion.append(tituloRotacion, rango, grados);
    rango.oninput = () => previsualizarGiro(rango.value); rango.onchange = confirmarGiro;
    campoGrados.oninput = () => previsualizarGiro(campoGrados.value); campoGrados.onchange = confirmarGiro; campoGrados.onblur = confirmarGiro;
    campoGrados.onkeydown = (e) => { if (e.key === "ArrowUp" || e.key === "ArrowDown") { e.preventDefault(); const salto = e.shiftKey ? 15 : 1; previsualizarGiro(normalizarGrados(campoGrados.value) + (e.key === "ArrowUp" ? salto : -salto)); confirmarGiro(); } else if (e.key === "Enter") { e.preventDefault(); confirmarGiro(); campoGrados.blur(); } else if (e.key === "Escape") { previsualizarGiro(img.dataset.rot); cerrarMenuSticker(); } };
    menos.onclick = () => { previsualizarGiro(normalizarGrados(campoGrados.value) - 1); confirmarGiro(); };
    mas.onclick = () => { previsualizarGiro(normalizarGrados(campoGrados.value) + 1); confirmarGiro(); };
    menu.append(rotacion); previsualizarGiro(rango.value);
    item("Borrar", () => { img.remove(); cerrarMenuSticker(); persistir(); guardarPasoHistorial("texto"); });
    item("Mover atrás", () => { img.dataset.z = String(Math.max(-100, (Number(img.dataset.z) || 0) - 1)); actualizarSticker(img); });
    item("Mover adelante", () => { img.dataset.z = String(Math.min(100, (Number(img.dataset.z) || 0) + 1)); actualizarSticker(img); });
    document.body.append(menu); menuSticker = menu; setTimeout(() => document.addEventListener("pointerdown", fueraMenuSticker, true), 0);
  };
  cuerpo.addEventListener("contextmenu", (e) => { const img = e.target.closest?.("img[data-nota-sticker],img[data-nota-image]"); if (!img) return; e.preventDefault(); e.stopPropagation(); abrirMenuSticker(img, e.clientX, e.clientY); });
  let toqueLargoSticker = null;
  cuerpo.addEventListener("pointerdown", (e) => {
    const img = e.target.closest?.("img[data-nota-sticker],img[data-nota-image]"); if (!img || e.pointerType === "mouse") return;
    clearTimeout(toqueLargoSticker?.timer); const espera = { x: e.clientX, y: e.clientY, img, px: e.clientX, py: e.clientY };
    espera.timer = setTimeout(() => { abrirMenuSticker(espera.img, espera.x, espera.y); toqueLargoSticker = null; }, 550); toqueLargoSticker = espera;
  });
  cuerpo.addEventListener("pointermove", (e) => { if (toqueLargoSticker && Math.hypot(e.clientX - toqueLargoSticker.px, e.clientY - toqueLargoSticker.py) > 10) { clearTimeout(toqueLargoSticker.timer); toqueLargoSticker = null; } });
  const cancelarToqueLargoSticker = () => { clearTimeout(toqueLargoSticker?.timer); toqueLargoSticker = null; };
  cuerpo.addEventListener("pointerup", cancelarToqueLargoSticker);
  cuerpo.addEventListener("pointercancel", cancelarToqueLargoSticker);
  cuerpo.addEventListener("pointerdown", (e) => {
    const img = e.target.closest?.("img[data-nota-sticker].nt-sticker-seleccionado,img[data-nota-image].nt-sticker-seleccionado"); if (!img || (e.button !== 0 && e.pointerType === "mouse")) return;
    const r = img.getBoundingClientRect(); if (e.clientX > r.right - 20 && e.clientY > r.bottom - 20) return; // conserva el control nativo de resize
    e.preventDefault(); const sx = e.clientX, sy = e.clientY, unidad = cuerpo.clientWidth || 700, ox = Number(img.dataset.moveX) || 0, oy = Number(img.dataset.moveY) || 0; let movio = false;
    const mover = (ev) => { if (ev.pointerId !== e.pointerId) return; const dx = ev.clientX - sx, dy = ev.clientY - sy; if (Math.hypot(dx,dy) > 2) movio = true; img.dataset.moveX = String(Math.max(-3, Math.min(3, ox + dx / unidad))); img.dataset.moveY = String(Math.max(-3, Math.min(3, oy + dy / unidad))); aplicarTransformacionSticker(img); };
    const soltar = (ev) => { if (ev.pointerId !== e.pointerId) return; window.removeEventListener("pointermove", mover, true); window.removeEventListener("pointerup", soltar, true); window.removeEventListener("pointercancel", soltar, true); if (movio) { persistir(); guardarPasoHistorial("texto"); } };
    window.addEventListener("pointermove", mover, true); window.addEventListener("pointerup", soltar, true); window.addEventListener("pointercancel", soltar, true);
  });
  cuerpo.addEventListener("pointerup", (e) => { const img=e.target.closest?.("img[data-nota-sticker],img[data-nota-image]"); if (!img) return; setTimeout(() => { const w=Math.round(parseFloat(img.style.width)||img.width),h=Math.round(parseFloat(img.style.height)||img.height); if(w>0&&h>0&&(w!==Number(img.getAttribute("width"))||h!==Number(img.getAttribute("height")))){img.setAttribute("width",String(w));img.setAttribute("height",String(h));persistir();guardarPasoHistorial("texto");} }, 0); });

  function aplicarEstadoEditor(s) {
    restaurandoHistorial = true;
    try {
      titulo.value = s.titulo; cuerpo.innerHTML = s.contenido;
      cuerpo.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = false; });
      borrador.tinta.splice(0, borrador.tinta.length, ...JSON.parse(JSON.stringify(s.tinta || [])));
      borrador.color_texto = s.color_texto; pintarColorNota(resolverColorNota(s.color));
      inpTexto.value = s.color_texto || contraste(resolverColorNota(s.color)); refrescarSwatchTexto();
      capaTinta?.redibujar();
      persistir();
    } finally { restaurandoHistorial = false; }
  }
  const deshacerEditor = () => {
    if (historialEditor.length < 2) return;
    futuroEditor.push(historialEditor.pop()); aplicarEstadoEditor(historialEditor.at(-1));
  };
  const rehacerEditor = () => {
    if (!futuroEditor.length) return;
    const s = futuroEditor.pop(); historialEditor.push(s); aplicarEstadoEditor(s);
  };

  modal.querySelectorAll("[data-cmd]").forEach((b) => b.addEventListener("mousedown", (ev) => ev.preventDefault())); // el botón no le quita la selección al texto
  modal.querySelectorAll("[data-cmd]").forEach((b) => b.onclick = () => {
    const cmd = b.dataset.cmd;
    if (cmd === "undo") return deshacerEditor();
    if (cmd === "redo") return rehacerEditor();
    const dentro = cuerpo.contains(getSelection().anchorNode);
    cuerpo.focus(); recuperarSeleccion(dentro);
    if (marcadores.activo() && ["check", "insertUnorderedList", "insertOrderedList"].includes(cmd)) marcadores.aplicar(() => { if (cmd === "check") alternarChecklist(); else alternarLista(cmd); });
    else if (cmd === "check") alternarChecklist();
    else if (cmd === "insertUnorderedList" || cmd === "insertOrderedList") alternarLista(cmd);
    else document.execCommand(cmd, false, null);
    limpiarEstilos();
    ultimoTipo = "t"; actualizarFormato();
    persistir(); guardarPasoHistorial("texto");
  });

  /* --- Vencimiento: discreto al pie y editable desde la fecha --- */
  const campoVence = crearCampoFecha({ tipo: "date", ms: fechaVence, clase: "nt-fecha-venc", alCambiar: (ms) => {
    fechaVence = ms; borrador.vence_en = aValorFecha(ms); editarVence = false; mostrarElegirFecha = false; persistir(); pintarVencimiento();
  } });
  let mostrarElegirFecha = false;
  editarVencimiento.append(campoVence.el, btnEliminarVencimiento);
  const pintarVencimiento = () => {
    const tieneFecha = !!borrador.vence_en;
    btnVencimiento.classList.toggle("nt-oculto", tieneFecha || mostrarElegirFecha);
    pickerVencimiento.classList.toggle("nt-oculto", tieneFecha || !mostrarElegirFecha);
    venceActual.classList.toggle("nt-oculto", !tieneFecha);
    editarVencimiento.classList.toggle("nt-oculto", !tieneFecha || !editarVence);
    venceActual.replaceChildren();
    if (tieneFecha) {
      const b = document.createElement("button"); b.type = "button"; b.className = "nt-vencimiento-fecha";
      b.textContent = `${tr("Vence")} ${formatear(deValorFecha(borrador.vence_en), false)}`;
      b.setAttribute("aria-label", `${tr("Editar vencimiento")}: ${b.textContent}`);
      b.onclick = () => { editarVence = !editarVence; pintarVencimiento(); };
      venceActual.append(b);
    }
  };
  btnVencimiento.onclick = () => { mostrarElegirFecha = true; pintarVencimiento(); };
  btnElegirFecha.onclick = () => campoVence.abrir(btnElegirFecha);
  btnEliminarVencimiento.onclick = () => { borrador.vence_en = null; fechaVence = deValorFecha(fechaRelativa(opcionesNotas().plazo_default)); editarVence = false; mostrarElegirFecha = false; persistir(); pintarVencimiento(); };
  if (borrador.vence_en) campoVence.establecer(deValorFecha(borrador.vence_en));
  pintarVencimiento();

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
  modal.querySelector('[data-action="share"]').onclick = () => {
    accionesExtra.classList.remove("nt-oculto");
    modal.querySelector('[data-action="share"]').setAttribute("aria-expanded", "true");
    cerrarCompartir.focus({ preventScroll: true });
  };
  btnTextoSimple.onclick = async () => { cerrarMenuCompartir(); const ok = await compartirNotaFuera([titulo.value.trim(), textoPlanoNota(cuerpo.innerHTML)].filter(Boolean).join("\n"), titulo.value); if (ok) registrarAnaliticaUso("notas", "Compartir nota"); };
  modal.querySelector('[data-action="duplicate"]').onclick = () => {
    clearTimeout(timer); persistirAhora();
    const n = guardarNota(crearNota({ ...borrador, id: undefined, titulo: titulo.value ? `${titulo.value} (${tr("copia")})` : "", creada_en: undefined }));
    registrarCambio("Duplicar nota", [{ id: n.id, nota: null }]);
    flujoAnalitico?.completar("duplicado"); flujoAnalitico = null;
    window.dispatchEvent(new CustomEvent("notas:abrir", { detail: n.id }));
    cerrarEditor();
  };
  modal.querySelector('[data-action="delete"]').onclick = () => {
    if (eliminando) return;
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
  const dialogoCerrar = document.createElement("div");
  dialogoCerrar.className = "nt-confirmar-cierre nt-oculto";
  dialogoCerrar.setAttribute("role", "alertdialog"); dialogoCerrar.setAttribute("aria-modal", "true");
  dialogoCerrar.innerHTML = `<section><strong>${tr("¿Guardar los cambios?")}</strong><div><button type="button" data-close="save">${tr("Guardar")}</button><button type="button" data-close="discard">${tr("Deshacer cambios")}</button></div></section>`;
  modal.append(dialogoCerrar);
  const pedirCerrar = () => { if (cerrado || preguntandoCerrar) return; clearTimeout(timer); if (firmaEditor() === firmaInicialEditor) { descartandoCambios = true; cerrarEditor(); return; } preguntandoCerrar = true; dialogoCerrar.classList.remove("nt-oculto"); dialogoCerrar.querySelector('[data-close="save"]').focus(); };
  dialogoCerrar.addEventListener("click", async (e) => {
    if (e.target === dialogoCerrar) { preguntandoCerrar = false; dialogoCerrar.classList.add("nt-oculto"); return; }
    const accion = e.target.closest("[data-close]")?.dataset.close; if (!accion) return;
    if (accion === "discard") {
      clearTimeout(timer); eliminando = true; descartandoCambios = true;
      try { const actual = obtenerNota(borrador.id); if (original) guardarNota({ ...original }); else if (actual) eliminarDefinitiva(actual); }
      catch (err) { eliminando = false; mostrarToast(tr("No se pudieron deshacer los cambios")); console.error(err); return; }
      window.dispatchEvent(new Event("notas:actualizadas-ui"));
    } else guardarAlSalir();
    preguntandoCerrar = false; cerrarEditor();
  });
  modal.querySelectorAll('[data-action="close"]').forEach((b) => b.onclick = pedirCerrar);
  let punteroInicioFuera = null;
  overlay.addEventListener("pointerdown", (e) => { punteroInicioFuera = e.target === overlay ? e.pointerId : null; }, true);
  overlay.addEventListener("pointerup", (e) => {
    const cerrarPorFuera = punteroInicioFuera === e.pointerId && e.target === overlay;
    punteroInicioFuera = null;
    if (cerrarPorFuera) pedirCerrar();
  }, true);
  overlay.addEventListener("pointercancel", () => { punteroInicioFuera = null; }, true);

  handlerTeclas = function teclas(e) {
    if (e.key === "Escape") { if (!accionesExtra.classList.contains("nt-oculto")) { e.preventDefault(); cerrarMenuCompartir(); modal.querySelector('[data-action="share"]')?.focus({ preventScroll: true }); return; } if (preguntandoCerrar) { e.preventDefault(); preguntandoCerrar = false; dialogoCerrar.classList.add("nt-oculto"); return; } if (mostrarElegirFecha || editarVence) { e.preventDefault(); mostrarElegirFecha = false; editarVence = false; pintarVencimiento(); return; } pedirCerrar(); return; }
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === "s") { e.preventDefault(); persistir(); return; }
    // Ctrl+B negrita · Ctrl+K (y Ctrl+I) cursiva · Ctrl+U subrayado: aplican a la selección, o a lo que escribas a continuación.
    const ac = document.activeElement;
    if ((ac === cuerpo || cuerpo.contains(ac)) && !e.altKey && !e.shiftKey) {
      const cmd = { b: "bold", i: "italic", k: "italic", u: "underline" }[k];
      if (cmd) { e.preventDefault(); document.execCommand(cmd, false, null); ultimoTipo = "t"; actualizarFormato(); persistir(); guardarPasoHistorial("texto"); return; }
    }
    if ((k === "z" || k === "y") && !e.altKey) {
      e.preventDefault();
      if (k === "y" || e.shiftKey) rehacerEditor(); else deshacerEditor();
    }
  };
  document.addEventListener("keydown", handlerTeclas);

  /* --- Tinta: lápiz y borrador (el selector de color vive a la derecha, siempre visible) --- */
  borrador.tinta = JSON.parse(JSON.stringify(borrador.tinta || []));
  capaTinta = crearCapaTinta({ cuerpo, modal, obtenerTrazos: () => borrador.tinta, alCambiar: () => { ultimoTipo = "i"; persistir(); guardarPasoHistorial("tinta"); } });
  capaTinta.establecerGrosor(GROSOR_BASE * grosorTrazoPreferido());
  const btnLapiz = modal.querySelector('[data-tool="lapiz"]'), btnBorrador = modal.querySelector('[data-tool="borrador"]');
  const swTinta = modal.querySelector(".nt-swatch-tinta"), inpTinta = modal.querySelector(".nt-tinta-color");
  const pintarSwTinta = () => { swTinta.style.setProperty("--sw", inpTinta.value); swTinta.style.setProperty("--sw-fg", contraste(inpTinta.value)); };
  // Tinta: clara sobre notas fuertes (modo oscuro) y oscura sobre notas suaves, hasta que elijas un color de tinta a mano.
  let tintaManual = false;
  const tintaAuto = () => contraste(resolverColorNota(borrador.color || opcionesNotas().color_default));
  inpTinta.value = tintaAuto();
  capaTinta.establecerColor(inpTinta.value); pintarSwTinta();
  ajustarTintaAuto = () => { if (tintaManual) return; inpTinta.value = tintaAuto(); capaTinta.establecerColor(inpTinta.value); pintarSwTinta(); };
  let lapizDesactivadoManualmente = false;
  const fijarModo = (m) => { capaTinta.establecerModo(m); cuerpo.contentEditable = m ? "false" : "true"; btnLapiz.setAttribute("aria-pressed", String(m === "lapiz")); btnBorrador.setAttribute("aria-pressed", String(m === "borrador")); botonesForma.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.forma === m))); };
  editarFigurasInput.onchange=()=>{ if(editarFigurasInput.checked) fijarModo(null); capaTinta.establecerEdicionFiguras(editarFigurasInput.checked); eliminarFiguraBtn.classList.toggle("nt-oculto",!editarFigurasInput.checked); };
  eliminarFiguraBtn.onclick=()=>{ if(!capaTinta.eliminarFiguraSeleccionada()) mostrarToast(tr("Selecciona una figura para eliminar")); };
  btnLapiz.onclick = () => { const apagar = capaTinta.obtenerModo() === "lapiz"; lapizDesactivadoManualmente = apagar; fijarModo(apagar ? null : "lapiz"); };
  btnBorrador.onclick = () => fijarModo(capaTinta.obtenerModo() === "borrador" ? null : "borrador");
  botonesForma.forEach((b) => { b.onclick = () => { cerrarMenuFiguras(); fijarModo(capaTinta.obtenerModo() === b.dataset.forma ? null : b.dataset.forma); }; });
  inpTinta.oninput = () => { tintaManual = true; capaTinta.establecerColor(inpTinta.value); pintarSwTinta(); if (capaTinta.obtenerModo() !== "lapiz") fijarModo("lapiz"); };
  cuerpo.addEventListener("pointermove", (e) => { if (e.pointerType === "pen" && !lapizDesactivadoManualmente && !capaTinta.obtenerModo()) fijarModo("lapiz"); });
  titulo.addEventListener("input", () => guardarPasoHistorial("titulo"));
  cuerpo.addEventListener("input", () => { if (!forzandoPasosPegado) guardarPasoHistorial("texto"); });
  cuerpo.addEventListener("change", (e) => { if (e.target.matches('input[type="checkbox"]')) guardarPasoHistorial("texto"); });
  // El primer estado se captura después de montar el editor para incluir todas sus conversiones iniciales.
  historialEditor.push(tomarEstadoEditor());
  requestAnimationFrame(() => cuerpo.focus());
}

function fechaRelativa(opcion = "3_dias") {
  const d = new Date(); d.setHours(12, 0, 0, 0);
  const dias = { manana: 1, "3_dias": 3, una_semana: 7, proximo_mes: 30 }[opcion] || 3;
  d.setDate(d.getDate() + dias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export { abrirEditorNota, fechaRelativa };
