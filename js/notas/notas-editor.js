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
  const scrollBloqueado = { y: window.scrollY, body: { overflow: document.body.style.overflow, position: document.body.style.position, top: document.body.style.top, width: document.body.style.width, paddingRight: document.body.style.paddingRight }, htmlOverflow: document.documentElement.style.overflow };
  const anchoBarra = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  document.documentElement.style.overflow = "hidden";
  document.body.style.overflow = "hidden";
  document.body.style.position = "fixed";
  document.body.style.top = `-${scrollBloqueado.y}px`;
  document.body.style.width = "100%";
  if (anchoBarra) document.body.style.paddingRight = `${anchoBarra}px`;
  const registroOriginal = notaId ? obtenerNota(notaId) : null;
  const original = registroOriginal ? JSON.parse(JSON.stringify(registroOriginal)) : null;
  const borrador = original ? { ...original } : crearNota({ vence_en: opcionesNotas().vencimiento_default ? fechaRelativa(opcionesNotas().plazo_default) : null });
  const instantaneaInicial = instantanea([borrador.id]); // para Ctrl+Z global: toda la sesión de edición es una sola entrada
  let guardado = false, cerrado = false, eliminando = false, descartandoCambios = false, timer = null, handlerTeclas = null, capaTinta = null, editarVence = false, preguntandoCerrar = false, ocrController = null;
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
    <div class="nt-lienzo-viewport"><div class="notas-cuerpo" contenteditable="true" role="textbox" aria-multiline="true" data-placeholder="${tr("Escribe aquí…")}"></div></div>
    <footer class="notas-editor-foot"><div class="notas-palette notas-editor-tools" aria-label="${tr("Color de nota")}"></div><div class="notas-editor-foot-row"><div class="nt-vencimiento-area"><button type="button" class="nt-vencimiento-btn" data-action="vencimiento">${ICONOS.reloj}<span>${tr("Vencimiento")}</span></button><span class="nt-vencimiento-pick nt-oculto"><button type="button" class="nt-elegir-fecha">${tr("Elegir fecha")}</button></span><span class="nt-vencimiento-actual nt-oculto"></span><span class="nt-vencimiento-editar nt-oculto"><button type="button" class="nt-eliminar-vencimiento">${tr("Eliminar fecha de vencimiento")}</button></span></div><div class="notas-editor-actions"><button class="btn btn-secondary" data-action="send" aria-label="${tr("Wapper")}" title="${tr("Wapper")}">${ICONOS.wapper}</button><button class="btn btn-secondary" data-action="share" aria-label="${tr("Compartir")}" title="${tr("Compartir")}">${ICONOS.compartir}</button><button class="btn btn-secondary" data-action="duplicate" aria-label="${tr("Duplicar")}" title="${tr("Duplicar")}">${ICONOS.duplicar}</button><button class="btn btn-danger" data-action="delete" aria-label="${tr("Eliminar")}" title="${tr("Eliminar")}">${ICONOS.papelera}</button></div></div></footer>`;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const titulo = modal.querySelector(".notas-titulo"), cuerpo = modal.querySelector(".notas-cuerpo"), viewportLienzo=modal.querySelector(".nt-lienzo-viewport"), paleta = modal.querySelector(".notas-palette"), pin = modal.querySelector('[data-action="pin"]');
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
  const menuFiguraContexto=document.createElement("div");menuFiguraContexto.className="nt-figura-contexto nt-oculto";menuFiguraContexto.setAttribute("role","menu");const eliminarFiguraContexto=document.createElement("button");eliminarFiguraContexto.type="button";eliminarFiguraContexto.textContent=tr("Eliminar figura");const cambiarColorFigura=document.createElement("label");cambiarColorFigura.className="nt-figura-color-opcion";cambiarColorFigura.append(document.createTextNode(tr("Cambiar color")));const colorFiguraInput=document.createElement("input");colorFiguraInput.type="color";colorFiguraInput.setAttribute("aria-label",tr("Cambiar color de figura"));cambiarColorFigura.append(colorFiguraInput);menuFiguraContexto.append(eliminarFiguraContexto,cambiarColorFigura);document.body.append(menuFiguraContexto);
  const editarFigurasLabel=document.createElement("label"); editarFigurasLabel.className="nt-editar-figuras-toggle"; const editarFigurasInput=document.createElement("input"); editarFigurasInput.type="checkbox"; const editarFigurasTexto=document.createElement("span"); editarFigurasTexto.textContent=tr("Habilitar edición de figura"); editarFigurasLabel.append(editarFigurasInput,editarFigurasTexto); const eliminarFiguraBtn=document.createElement("button"); eliminarFiguraBtn.type="button"; eliminarFiguraBtn.className="nt-eliminar-figura nt-oculto"; eliminarFiguraBtn.textContent=tr("Eliminar figura seleccionada");
  const btnSubirSticker = document.createElement("button"); btnSubirSticker.type = "button"; btnSubirSticker.className = "nt-sticker-subir"; btnSubirSticker.textContent = tr("Stickers"); btnSubirSticker.setAttribute("role", "menuitem");
  const inputSticker = document.createElement("input"); inputSticker.type = "file"; inputSticker.accept = "image/*"; inputSticker.multiple = true; inputSticker.hidden = true;
  const btnImagenUnica = document.createElement("button"); btnImagenUnica.type = "button"; btnImagenUnica.className = "nt-imagen-subir"; btnImagenUnica.textContent = tr("Imágenes"); btnImagenUnica.setAttribute("role", "menuitem");
  const inputImagenUnica = document.createElement("input"); inputImagenUnica.type = "file"; inputImagenUnica.accept = "image/*"; inputImagenUnica.multiple = true; inputImagenUnica.hidden = true;
  btnImagenUnica.onclick = () => inputImagenUnica.click(); menuFiguras.append(editarFigurasLabel, eliminarFiguraBtn, btnSubirSticker, btnImagenUnica, inputSticker, inputImagenUnica);
  const botonesForma = [];
  for (const [grupo, formas] of [[tr("Líneas"),[["linea","╱","Línea"],["flecha","↗","Flecha"]]],[tr("Básicas"),[["rectangulo","▱","Rectángulo"],["cuadrado","□","Cuadrado"],["circulo","○","Círculo"],["elipse","⬭","Elipse"],["triangulo","△","Triángulo"],["rombo","◇","Rombo"]]],[tr("Especiales"),[["estrella","☆","Estrella"],["corazon","♡","Corazón"]]]]) {
    const encabezado=document.createElement("strong");encabezado.className="nt-figuras-grupo-titulo";encabezado.textContent=grupo;menuFiguras.append(encabezado);
    for (const [modo, simbolo, nombre] of formas) { const b = document.createElement("button"); b.type = "button"; b.dataset.forma = modo; const icono=document.createElement("span");icono.className="nt-figura-icono";icono.textContent=simbolo;const etiqueta=document.createElement("span");etiqueta.textContent=tr(nombre);b.append(icono,etiqueta);b.title=tr(nombre);b.setAttribute("aria-label",tr(nombre));b.setAttribute("aria-pressed","false");b.setAttribute("role","menuitem");menuFiguras.append(b);botonesForma.push(b); }
  }
  barraTinta.append(btnFiguras, btnHerramientas);
  const [sepTexto, sepListas, sepTinta] = barraTinta.querySelectorAll(".notas-sep");
  const botonesUndoRedo = [barraTinta.querySelector('[data-cmd="undo"]'), barraTinta.querySelector('[data-cmd="redo"]')];
  const botonesFormato = [barraTinta.querySelector('[data-cmd="bold"]'), barraTinta.querySelector('[data-cmd="italic"]'), barraTinta.querySelector('[data-cmd="underline"]')];
  const botonesLista = [barraTinta.querySelector('[data-cmd="insertUnorderedList"]'), barraTinta.querySelector('[data-cmd="insertOrderedList"]'), barraTinta.querySelector('[data-cmd="check"]')];
  const botonLapizBarra = barraTinta.querySelector('[data-tool="lapiz"]'), botonBorradorBarra = barraTinta.querySelector('[data-tool="borrador"]');
  const grupoToolbar = (clase, etiqueta, nodos) => { const g=document.createElement("div");g.className=`nt-toolbar-grupo ${clase}`;g.setAttribute("role","group");g.setAttribute("aria-label",tr(etiqueta));g.append(...nodos);return g; };
  const gruposToolbar = [grupoToolbar("nt-toolbar-herr", "Herramientas y deshacer", [btnHerramientas,...botonesUndoRedo]), grupoToolbar("nt-toolbar-formato", "Formato", botonesFormato), grupoToolbar("nt-toolbar-listas", "Listas", botonesLista), grupoToolbar("nt-toolbar-tinta", "Tinta y figuras", [botonLapizBarra,botonBorradorBarra,btnFiguras])];
  const filaToolbar1=document.createElement("div"),filaToolbar2=document.createElement("div");filaToolbar1.className=filaToolbar2.className="nt-toolbar-fila";
  sepTinta.classList.add("nt-sep-desktop");filaToolbar1.append(gruposToolbar[0],sepTexto,gruposToolbar[1],sepTinta);filaToolbar2.append(gruposToolbar[2],sepListas,gruposToolbar[3]);barraTinta.replaceChildren(filaToolbar1,filaToolbar2);
  document.body.append(menuFiguras);
  const contenedorBarraToolbar=modal.querySelector(".nt-barra-fila");let observadorToolbar=null,rafMedirToolbar=0;
  const medirToolbar=()=>{cancelAnimationFrame(rafMedirToolbar);rafMedirToolbar=requestAnimationFrame(()=>{const disponible=contenedorBarraToolbar.clientWidth;const anchoNatural=gruposToolbar.reduce((n,g)=>n+g.getBoundingClientRect().width,0)+[sepTexto,sepListas,sepTinta].reduce((n,x)=>n+x.getBoundingClientRect().width+20,0)+48;barraTinta.classList.toggle("nt-toolbar-dos-filas",anchoNatural>disponible+1);});};
  if(typeof ResizeObserver==="function"){observadorToolbar=new ResizeObserver(medirToolbar);observadorToolbar.observe(contenedorBarraToolbar);gruposToolbar.forEach(g=>observadorToolbar.observe(g));}window.addEventListener("resize",medirToolbar);medirToolbar();
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
  grupoGrosor.append(sliderGrosor, valorGrosor);
  const grupoZoom=document.createElement("div");grupoZoom.className="nt-zoom-grupo";grupoZoom.setAttribute("aria-label",tr("Tamaño de nota y zoom del lienzo"));
  const crearBotonZoom=(signo,etiqueta,ampliacion=false)=>{const b=document.createElement("button");b.type="button";b.className=`nt-zoom-btn ${ampliacion?"nt-lienzo-zoom":"nt-nota-zoom"} nt-zoom-${signo}`;b.title=tr(etiqueta);b.setAttribute("aria-label",tr(etiqueta));b.innerHTML=ampliacion?(signo==="menos"?'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5M8 10.8h5.6"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 5 5M8 10.8h5.6M10.8 8v5.6"/></svg>'):`<span aria-hidden="true">${signo==="menos"?"−":"+"}</span>`;return b;};
  const btnZoomMenos=crearBotonZoom("menos","Reducir alto del lienzo"),btnZoomMas=crearBotonZoom("mas","Aumentar alto del lienzo");
  const btnLienzoMenos=crearBotonZoom("menos","Alejar lienzo",true),btnLienzoMas=crearBotonZoom("mas","Acercar lienzo",true);grupoZoom.append(btnZoomMenos,btnZoomMas,btnLienzoMenos,btnLienzoMas,grupoGrosor);
  let factorZoom=1,extensionLienzo=0;const actualizarBotonesZoom=()=>{btnZoomMenos.disabled=extensionLienzo<=0;btnZoomMas.disabled=extensionLienzo>=1600;btnZoomMenos.setAttribute("aria-label",tr("Reducir alto del lienzo"));btnZoomMas.setAttribute("aria-label",tr("Aumentar alto del lienzo"));};
  const aplicarExtension=(delta)=>{extensionLienzo=Math.max(0,Math.min(1600,extensionLienzo+delta));cuerpo.style.paddingBottom=`${12+extensionLienzo}px`;actualizarBotonesZoom();};
  btnZoomMenos.onclick=()=>aplicarExtension(-180);btnZoomMas.onclick=()=>aplicarExtension(180);
  const mini=document.createElement("div");mini.className="nt-minimapa nt-oculto";mini.setAttribute("aria-label",tr("Vista general del lienzo"));const miniContenido=document.createElement("div");miniContenido.className="nt-minimapa-contenido";const miniMarco=document.createElement("div");miniMarco.className="nt-minimapa-marco";mini.append(miniContenido,miniMarco);modal.append(mini);
  const actualizarMini=()=>{mini.classList.toggle("nt-oculto",factorZoom<=1.001);if(factorZoom<=1.001)return;const r=viewportLienzo.getBoundingClientRect(),w=viewportLienzo.clientWidth,h=viewportLienzo.clientHeight,fullW=Math.max(w,cuerpo.scrollWidth),fullH=Math.max(h,cuerpo.scrollHeight),escala=Math.min((mini.clientWidth-8)/fullW,(mini.clientHeight-8)/fullH);mini.style.left=`${Math.max(4,r.right-mini.clientWidth-10)}px`;mini.style.top=`${Math.max(4,r.bottom-mini.clientHeight-10)}px`;miniContenido.replaceChildren();const clon=cuerpo.cloneNode(true);clon.removeAttribute("contenteditable");clon.querySelectorAll("[contenteditable],.nt-sticker-marco").forEach(n=>n.remove());Object.assign(clon.style,{position:"absolute",left:"0",top:"0",width:`${fullW}px`,minHeight:`${fullH}px`,maxHeight:"none",overflow:"visible",zoom:"1",transform:`scale(${escala})`,transformOrigin:"top left",pointerEvents:"none"});miniContenido.append(clon);miniContenido.style.width=`${fullW*escala}px`;miniContenido.style.height=`${fullH*escala}px`;const miniTinta=document.createElement("canvas");miniTinta.className="nt-minimapa-tinta";miniTinta.width=Math.max(1,Math.ceil(fullW*escala));miniTinta.height=Math.max(1,Math.ceil(fullH*escala));miniTinta.style.width=`${fullW*escala}px`;miniTinta.style.height=`${fullH*escala}px`;const ctxMini=miniTinta.getContext("2d");if(ctxMini){ctxMini.scale(escala,escala);capaTinta?.dibujarMiniMapa?.(ctxMini,fullW);}miniContenido.append(miniTinta);miniMarco.style.width=`${Math.max(12,w/factorZoom*escala)}px`;miniMarco.style.height=`${Math.max(12,h/factorZoom*escala)}px`;miniMarco.style.left=`${viewportLienzo.scrollLeft/factorZoom*escala}px`;miniMarco.style.top=`${viewportLienzo.scrollTop/factorZoom*escala}px`;};
  let arrastrandoMini=false,miniPunto=null,miniTimer=0;const actualizarMiniEditado=()=>{clearTimeout(miniTimer);miniTimer=setTimeout(actualizarMini,120);};miniMarco.addEventListener("pointerdown",e=>{e.preventDefault();e.stopPropagation();arrastrandoMini=true;miniPunto={x:e.clientX,y:e.clientY};miniMarco.setPointerCapture?.(e.pointerId);});miniMarco.addEventListener("pointermove",e=>{if(!arrastrandoMini||!miniPunto)return;const dx=e.clientX-miniPunto.x,dy=e.clientY-miniPunto.y,w=viewportLienzo.clientWidth,h=viewportLienzo.clientHeight,fullW=Math.max(w,cuerpo.scrollWidth),fullH=Math.max(h,cuerpo.scrollHeight),escala=Math.min((mini.clientWidth-8)/fullW,(mini.clientHeight-8)/fullH);viewportLienzo.scrollLeft=Math.max(0,Math.min(viewportLienzo.scrollWidth-w,viewportLienzo.scrollLeft+dx/escala*factorZoom));viewportLienzo.scrollTop=Math.max(0,Math.min(viewportLienzo.scrollHeight-h,viewportLienzo.scrollTop+dy/escala*factorZoom));miniPunto={x:e.clientX,y:e.clientY};actualizarMini();});const soltarMini=()=>{arrastrandoMini=false;miniPunto=null;};miniMarco.addEventListener("pointerup",soltarMini);miniMarco.addEventListener("pointercancel",soltarMini);cuerpo.addEventListener("input",actualizarMiniEditado);window.addEventListener("resize",actualizarMini);const observadorMini=typeof MutationObserver==="function"?new MutationObserver(actualizarMiniEditado):null;observadorMini?.observe(cuerpo,{childList:true,subtree:true,attributes:true,attributeFilter:["style","src","width","height"]});
  const actualizarBotonesLienzo=()=>{const z=factorZoom;btnLienzoMenos.disabled=z<=.5;btnLienzoMas.disabled=z>=4;btnLienzoMenos.setAttribute("aria-label",`${tr("Alejar lienzo")}, ${Math.round(z*100)}%`);btnLienzoMas.setAttribute("aria-label",`${tr("Acercar lienzo")}, ${Math.round(z*100)}%`);};
  const establecerZoomLienzo=(v,x=null,y=null)=>{const nuevo=Math.max(.5,Math.min(4,Math.round(v*20)/20));if(nuevo===factorZoom)return factorZoom;const r=viewportLienzo.getBoundingClientRect(),px=x??r.left+r.width/2,py=y??r.top+r.height/2,rx=px-r.left,ry=py-r.top,anterior=factorZoom,sx=viewportLienzo.scrollLeft,sy=viewportLienzo.scrollTop;factorZoom=nuevo;cuerpo.style.transform=`scale(${factorZoom})`;cuerpo.style.transformOrigin="top left";capaTinta?.establecerZoomLienzo(factorZoom,r.left,r.top);requestAnimationFrame(()=>{viewportLienzo.scrollLeft=(sx+rx)*nuevo/anterior-rx;viewportLienzo.scrollTop=(sy+ry)*nuevo/anterior-ry;capaTinta?.ubicar();posicionarMarcoSticker();actualizarMini();actualizarBotonesLienzo();});return factorZoom;};
  btnLienzoMenos.onclick=()=>establecerZoomLienzo(factorZoom-.25);btnLienzoMas.onclick=()=>establecerZoomLienzo(factorZoom+.25);
  const wheelZoom=(e)=>{if(!e.ctrlKey)return;const r=viewportLienzo.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)return;e.preventDefault();e.stopPropagation();establecerZoomLienzo(factorZoom+(e.deltaY<0?.2:-.2),e.clientX,e.clientY);};modal.addEventListener("wheel",wheelZoom,{capture:true,passive:false});
  let puntosZoom=new Map(),pinchZoom=null;const dentroLienzo=(e)=>{const r=viewportLienzo.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;};const iniciarPinch=(e)=>{if(!dentroLienzo(e))return;puntosZoom.set(e.pointerId,{x:e.clientX,y:e.clientY});if(puntosZoom.size===2){const [a,b]=[...puntosZoom.values()];pinchZoom={dist:Math.hypot(a.x-b.x),zoom:factorZoom};capaTinta?.iniciarZoomDosDedos();if(e.cancelable)e.preventDefault();}};const moverPinch=(e)=>{if(!puntosZoom.has(e.pointerId))return;puntosZoom.set(e.pointerId,{x:e.clientX,y:e.clientY});if(puntosZoom.size===2){if(e.cancelable)e.preventDefault();const [a,b]=[...puntosZoom.values()],d=Math.hypot(a.x-b.x),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;if(pinchZoom&&pinchZoom.dist>0)establecerZoomLienzo(pinchZoom.zoom*d/pinchZoom.dist,cx,cy);}};const terminarPinch=(e)=>{puntosZoom.delete(e.pointerId);if(puntosZoom.size<2&&pinchZoom){pinchZoom=null;capaTinta?.terminarZoomDosDedos();}};modal.addEventListener("pointerdown",iniciarPinch,true);modal.addEventListener("pointermove",moverPinch,true);modal.addEventListener("pointerup",terminarPinch,true);modal.addEventListener("pointercancel",terminarPinch,true);viewportLienzo.addEventListener("scroll",actualizarMini,{passive:true});actualizarBotonesZoom();actualizarBotonesLienzo();
  const footerRow=modal.querySelector(".notas-editor-foot-row"),areaVence=modal.querySelector(".nt-vencimiento-area"),accionesPie=modal.querySelector(".notas-editor-actions");let observerFooter=null;
  const medirFooter=()=>{const needs=areaVence.scrollWidth+accionesPie.scrollWidth+12>footerRow.clientWidth+1;footerRow.classList.toggle("nt-pie-dos-filas",needs);};observerFooter=typeof ResizeObserver==="function"?new ResizeObserver(medirFooter):null;observerFooter?.observe(footerRow);observerFooter?.observe(areaVence);observerFooter?.observe(accionesPie);window.addEventListener("resize",medirFooter);requestAnimationFrame(medirFooter);
  const marcadores = crearMarcadores({ cuerpo });
  const herramientas = crearHerramientas({ cuerpo, boton: btnHerramientas, obtenerTitulo: () => titulo.value, completadasAlFinal: () => opcionesNotas().completadas_al_final, alCambiar: () => { ultimoTipo = "t"; persistir(); guardarPasoHistorial("texto"); }, avisar: mostrarAvisoSuperior, extras:()=>[{id:"ocr-tinta",texto:"Escritura a texto",disponible:(borrador.tinta||[]).length>0,ejecutar:convertirTintaATexto}] });
  titulo.value = borrador.titulo || "";
  renderizarHTMLNota(cuerpo, borrador.contenido || "");
  cuerpo.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = false; });
  cuerpo.contentEditable = "true";
  const firmaEditor = () => JSON.stringify({ titulo: titulo.value.trim(), contenido: sanearHTMLNota(cuerpo.innerHTML), tinta: borrador.tinta || [], capa_tinta_z: Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5, color: borrador.color || COLOR_DEFECTO, color_texto: borrador.color_texto || null, vence_en: borrador.vence_en || null, fijada: !!borrador.fijada });
  const firmaInicialEditor = firmaEditor();
  let firmaUltimoGuardado = firmaInicialEditor;

  /* --- Persistencia --- */
  let fechaVence = deValorFecha(original?.vence_en || fechaRelativa(opcionesNotas().plazo_default));
  const persistirAhora = () => {
    if (eliminando || cerrado) return;
    const firmaActual = firmaEditor();
    if (original && firmaActual === firmaUltimoGuardado) return;
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
      firmaUltimoGuardado = firmaEditor();
      pintarModificada();
      guardado = true;
    } catch (error) { mostrarToast(tr(error.message)); }
  };
  const persistir = () => { clearTimeout(timer); timer = setTimeout(persistirAhora, 500); };
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
    clearTimeout(timer);clearTimeout(timerAvisoOCR);ocrController?.abort();ocrController=null;avisoOCRActivo?.remove();avisoOCRActivo=null;
    if (!eliminando) { try { persistirAhora(); } catch (err) { console.error(err); } }
    cerrado = true;
    try { if (guardado) flujoAnalitico?.completar("guardado"); else flujoAnalitico?.cancelar("cancelado"); } catch (err) { console.error(err); }
    flujoAnalitico = null;
    window.removeEventListener("pagehide", guardarAlSalir);
    document.removeEventListener("visibilitychange", guardarAlSalir);
    document.removeEventListener("selectionchange", selCambio);
    if (handlerTeclas) document.removeEventListener("keydown", handlerTeclas);
    campoCreada?.destruir?.(); campoMod?.destruir?.(); campoVence?.destruir?.();observadorFechas?.disconnect();window.removeEventListener("resize",medirFechas);dialogoFechas.remove();
    try { capaTinta?.destruir(); } catch (err) { console.error(err); }
    try { marcadores.destruir(); herramientas.destruir(); } catch (err) { console.error(err); }
    cerrarMenuFiguras(); menuFiguras.remove();menuFiguraContexto.remove();document.removeEventListener("pointerdown",cerrarContextoFuera,true); accionesExtra.remove(); stickersOverlay.remove(); marcoSticker.remove(); mini.remove();clearTimeout(miniTimer);observadorMini?.disconnect();cuerpo.removeEventListener("input",actualizarMiniEditado);viewportLienzo.removeEventListener("scroll",actualizarMini);window.removeEventListener("resize",actualizarMini);document.removeEventListener("scroll",actualizarMini,true);document.removeEventListener("scroll",posicionarMarcoSticker,true); window.removeEventListener("resize",posicionarMarcoSticker); observadorToolbar?.disconnect();observerFooter?.disconnect();window.removeEventListener("resize",medirFooter);cancelAnimationFrame(rafMedirToolbar);window.removeEventListener("resize",medirToolbar);observadorBarraInferior?.disconnect();window.removeEventListener("resize",medirBarraInferior);modal.removeEventListener("wheel",wheelZoom,true);modal.removeEventListener("pointerdown",iniciarPinch,true);modal.removeEventListener("pointermove",moverPinch,true);modal.removeEventListener("pointerup",terminarPinch,true);modal.removeEventListener("pointercancel",terminarPinch,true);modal.removeEventListener("pointerdown",ponerTintaAlFrente,true);roSticker?.disconnect();
    try { if (!descartandoCambios) registrarCambio(eliminando ? "Eliminar nota" : original ? "Editar nota" : "Nueva nota", instantaneaInicial); } catch (err) { console.error(err); }
    setTimeout(() => { overlay.remove(); document.documentElement.style.overflow = scrollBloqueado.htmlOverflow; Object.assign(document.body.style, scrollBloqueado.body); window.scrollTo(0, scrollBloqueado.y); alCerrar(); }, 0); // siempre se cierra, pase lo que pase arriba
  };
  window.addEventListener("pagehide", guardarAlSalir);
  document.addEventListener("visibilitychange", guardarAlSalir);
  document.addEventListener("selectionchange", selCambio);

  /* --- Fechas: creada y modificada (editables, formato "Lun 19, oct 2026, 12:54 pm") --- */
  const filaTiempos = modal.querySelector(".nt-tiempos");
  const campoCreada = crearCampoFecha({ etiqueta: tr("Creada"), tipo: "datetime-local", ms: borrador.creada_en || Date.now(), alCambiar: (ms) => { borrador.creada_en = ms; persistir(); } });
  const campoMod = crearCampoFecha({ etiqueta: tr("Modificada"), tipo: "datetime-local", ms: borrador.modificada_en || Date.now(), alCambiar: (ms) => { borrador.modificada_en = ms; borrador._mod_manual = true; persistir(); } });
  const camposFechaNota=[];if(opcionesNotas().mostrar_creada!==false)camposFechaNota.push(campoCreada.el);if(opcionesNotas().mostrar_modificada!==false)camposFechaNota.push(campoMod.el);
  filaTiempos.replaceChildren(...camposFechaNota);const botonFechasCompacto=document.createElement("button");botonFechasCompacto.type="button";botonFechasCompacto.className="nt-fecha-compacta nt-fecha-btn";botonFechasCompacto.textContent=tr("Fecha");
  const dialogoFechas=document.createElement("div");dialogoFechas.className="nt-fechas-overlay nt-oculto";dialogoFechas.setAttribute("role","dialog");dialogoFechas.setAttribute("aria-modal","true");
  const panelFechas=document.createElement("section");panelFechas.className="nt-fechas-panel";const cabFechas=document.createElement("header");const tituloFechas=document.createElement("strong");tituloFechas.textContent=tr("Fechas de la nota");const cerrarFechas=document.createElement("button");cerrarFechas.type="button";cerrarFechas.className="nt-fechas-cerrar";cerrarFechas.textContent="×";cerrarFechas.setAttribute("aria-label",tr("Cerrar"));const contenidoFechas=document.createElement("div");contenidoFechas.className="nt-fechas-contenido";cabFechas.append(tituloFechas,cerrarFechas);panelFechas.append(cabFechas,contenidoFechas);dialogoFechas.append(panelFechas);document.body.append(dialogoFechas);
  const cerrarDialogoFechas=()=>dialogoFechas.classList.add("nt-oculto");cerrarFechas.onclick=cerrarDialogoFechas;dialogoFechas.addEventListener("click",e=>{if(e.target===dialogoFechas)cerrarDialogoFechas();});botonFechasCompacto.onclick=()=>dialogoFechas.classList.remove("nt-oculto");
  let fechasCompactas=false;const medirFechas=()=>{const natural=camposFechaNota.reduce((n,x)=>{const copia=x.cloneNode(true);copia.style.cssText+=";position:fixed!important;left:-10000px!important;top:0!important;width:max-content!important;max-width:none!important;visibility:hidden!important;flex:none!important";document.body.append(copia);const w=copia.getBoundingClientRect().width||copia.scrollWidth;copia.remove();return n+w;},0)+Math.max(0,camposFechaNota.length-1)*12;const compacto=camposFechaNota.length>0&&natural>filaTiempos.clientWidth+1;botonFechasCompacto.classList.toggle("nt-fecha-visible",compacto);if(compacto===fechasCompactas)return;fechasCompactas=compacto;if(compacto){filaTiempos.replaceChildren(botonFechasCompacto);contenidoFechas.replaceChildren(...camposFechaNota);}else{cerrarDialogoFechas();contenidoFechas.replaceChildren();filaTiempos.replaceChildren(...camposFechaNota);}};
  const observadorFechas=typeof ResizeObserver==="function"?new ResizeObserver(medirFechas):null;observadorFechas?.observe(filaTiempos);window.addEventListener("resize",medirFechas);requestAnimationFrame(medirFechas);
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
  const grupoColores = document.createElement("div"); grupoColores.className="nt-colores-grupo";
  presets.forEach((c) => grupoColores.append(crearBotonColor(c)));
  const sepColor = document.createElement("span");
  sepColor.className = "notas-sep notas-sep-color"; sepColor.setAttribute("aria-hidden", "true");
  grupoColores.append(sepColor);
  recientes.forEach((c) => grupoColores.append(crearBotonColor(c)));
  const colorCustom = document.createElement("input");
  colorCustom.type = "color"; colorCustom.value = resolverColorNota(borrador.color || COLOR_DEFECTO); colorCustom.className = "notas-color-custom";
  colorCustom.style.cssText = "width:calc(var(--notas-dot,28px)*2);height:var(--notas-dot,28px);border-radius:999px;padding:0;border:2px solid rgba(255,255,255,.25);overflow:hidden;cursor:pointer;background:none;appearance:none;-webkit-appearance:none";
  colorCustom.title = tr("Elegir color"); colorCustom.setAttribute("aria-label", tr("Elegir color personalizado"));
  colorCustom.oninput = () => aplicarColorNota(colorCustom.value);
  grupoColores.append(colorCustom); paleta.append(grupoColores);
  // Orden DOM exacto de la barra: paleta completa y luego el paquete de zoom.
  toolsFooter.append(grupoZoom);
  // grupoColores debe existir antes de medir u observar la barra. Antes, el
  // observer se configuraba arriba, antes de esta declaración `const`, lo
  // que lanzaba ReferenceError y abortaba la creación de fechas, paleta y
  // handlers restantes del editor.
  const medirBarraInferior=()=>{const necesita=grupoColores.scrollWidth+grupoZoom.scrollWidth+16>toolsFooter.clientWidth+1;toolsFooter.classList.toggle("nt-tools-dos-filas",necesita);};
  const observadorBarraInferior=typeof ResizeObserver==="function"?new ResizeObserver(medirBarraInferior):null;observadorBarraInferior?.observe(toolsFooter);observadorBarraInferior?.observe(grupoColores);observadorBarraInferior?.observe(grupoZoom);window.addEventListener("resize",medirBarraInferior);requestAnimationFrame(medirBarraInferior);
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
  let restaurandoHistorial = false, forzandoPasosPegado = false, insertandoCapaVisual = false, ultimaCategoriaHistorial = "", ultimoTiempoHistorial = 0;
  const nivelImagenNuevo = () => { const niveles = [...cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")].map((x) => Number.isFinite(Number(x.dataset.z)) && x.dataset.z !== "" ? Number(x.dataset.z) : 10); niveles.push(Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5, 1); return Math.min(1999, Math.max(...niveles) + 1); };
  const tomarEstadoEditor = () => ({ titulo: titulo.value, contenido: cuerpo.innerHTML, tinta: JSON.parse(JSON.stringify(borrador.tinta || [])), capa_tinta_z: Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5, color: borrador.color || COLOR_DEFECTO, color_texto: borrador.color_texto || null });
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
    const html = `<img data-nota-sticker="1" data-z="${nivelImagenNuevo()}" src="${sticker.src}" alt="Sticker" width="${ancho}" height="${alto}"><br>`;
    const s = getSelection(), dentro = !!(s?.rangeCount && cuerpo.contains(s.anchorNode));
    cuerpo.focus(); recuperarSeleccion(dentro); insertandoCapaVisual = true; try { document.execCommand("insertHTML", false, html); } finally { insertandoCapaVisual = false; }
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
    const nivelInicial = nivelImagenNuevo();
    const html = imagenes.map(({src,ancho,alto},i) => `<img data-nota-image="1" data-z="${Math.min(2000,nivelInicial+i)}" src="${src}" alt="" width="${ancho}" height="${alto}" data-move-x="${(i*0.006).toFixed(3)}"><br>`).join("");
    const s = getSelection(), dentro = !!(s?.rangeCount && cuerpo.contains(s.anchorNode));
    cuerpo.focus(); recuperarSeleccion(dentro); insertandoCapaVisual = true; try { document.execCommand("insertHTML", false, html); } finally { insertandoCapaVisual = false; }
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
    img.style.position = "relative"; img.style.zIndex = String(Number.isFinite(Number(img.dataset.z)) && img.dataset.z !== "" ? Number(img.dataset.z) : 10); img.style.resize = "none"; img.style.maxWidth = "none"; img.style.maxHeight = "none"; img.style.objectFit = "fill";
    img.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg) scale(${sx},${sy})`;
  };
  const enviarTextoAlFrente = () => {
    const imagenes = [...cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")];
    imagenes.forEach((img) => { img.dataset.z = "0"; aplicarTransformacionSticker(img); });
    borrador.capa_tinta_z = -1; capaTinta?.establecerNivel?.(borrador.capa_tinta_z); persistir();
  };
  cuerpo.addEventListener("beforeinput", (e) => { if (!insertandoCapaVisual && String(e.inputType || "").startsWith("insert")) enviarTextoAlFrente(); });
  const marcoSticker = document.createElement("div"); marcoSticker.className = "nt-sticker-marco"; marcoSticker.hidden = true; marcoSticker.setAttribute("aria-label", tr("Cambiar tamaño del sticker"));
  const asasSticker = new Map();
  for (const [id, x, y, cursor] of [["nw",-1,-1,"nwse-resize"],["n",0,-1,"ns-resize"],["ne",1,-1,"nesw-resize"],["e",1,0,"ew-resize"],["se",1,1,"nwse-resize"],["s",0,1,"ns-resize"],["sw",-1,1,"nesw-resize"],["w",-1,0,"ew-resize"]]) {
    const asa=document.createElement("button"); asa.type="button"; asa.className=`nt-sticker-asa nt-sticker-asa-${id}`; asa.dataset.x=String(x); asa.dataset.y=String(y); asa.setAttribute("aria-label",tr(`Redimensionar ${id}`)); asa.style.cursor=cursor; marcoSticker.append(asa); asasSticker.set(id,asa);
  }
  document.body.append(marcoSticker);
  let stickerSeleccionado = null;
  const posicionarMarcoSticker = () => {
    const img=stickerSeleccionado;
    if(!img?.isConnected || !img.classList.contains("nt-sticker-seleccionado")){marcoSticker.hidden=true;return;}
    const r=img.getBoundingClientRect(), w=img.offsetWidth||Number(img.getAttribute("width"))||1, h=img.offsetHeight||Number(img.getAttribute("height"))||1, a=(Number(img.dataset.rot)||0)*Math.PI/180;
    const escala=r.width/Math.max(1,w*Math.abs(Math.cos(a))+h*Math.abs(Math.sin(a)));
    const cx=(r.left+r.right)/2,cy=(r.top+r.bottom)/2;
    Object.assign(marcoSticker.style,{left:`${cx-w*escala/2}px`,top:`${cy-h*escala/2}px`,width:`${w*escala}px`,height:`${h*escala}px`,transform:`rotate(${Number(img.dataset.rot)||0}deg) scale(${img.dataset.flipH==="1"?-1:1},${img.dataset.flipV==="1"?-1:1})`});
    const fh=img.dataset.flipH==="1"?-1:1,fv=img.dataset.flipV==="1"?-1:1,ux=[Math.cos(a)*fh,Math.sin(a)*fh],uy=[-Math.sin(a)*fv,Math.cos(a)*fv];
    for(const asa of asasSticker.values()){const hx=Number(asa.dataset.x),hy=Number(asa.dataset.y),v=hx&&hy?[hx*ux[0]+hy*uy[0],hx*ux[1]+hy*uy[1]]:hx?ux:uy;let deg=(Math.atan2(v[1],v[0])*180/Math.PI%180+180)%180;const orient=Math.round(deg/45)%4;asa.style.cursor=["ew-resize","nwse-resize","ns-resize","nesw-resize"][orient];}
    marcoSticker.hidden=false;
  };
  const seleccionarSticker = (img) => {
    cuerpo.querySelectorAll("img[data-nota-sticker].nt-sticker-seleccionado,img[data-nota-image].nt-sticker-seleccionado").forEach(x=>x.classList.remove("nt-sticker-seleccionado"));
    stickerSeleccionado=img||null;
    if(img){img.classList.add("nt-sticker-seleccionado");img.contentEditable="false";aplicarTransformacionSticker(img);}
    posicionarMarcoSticker();
  };
  const actualizarSticker = (img) => { aplicarTransformacionSticker(img); if(stickerSeleccionado===img) posicionarMarcoSticker(); persistir(); guardarPasoHistorial("sticker"); };
  let roSticker=null; if (typeof ResizeObserver === "function") { roSticker = new ResizeObserver(() => { cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]").forEach(aplicarTransformacionSticker); posicionarMarcoSticker(); }); roSticker.observe(cuerpo); }
  const cerrarMenuSticker = () => { menuSticker?.remove(); menuSticker = null; document.removeEventListener("pointerdown", fueraMenuSticker, true); };
  const fueraMenuSticker = (e) => { if (menuSticker && !menuSticker.contains(e.target)) cerrarMenuSticker(); };
  const abrirMenuSticker = (img, x, y) => {
    cerrarMenuSticker(); stickerActivo = img;
    const menu = document.createElement("div"); menu.className = "nt-sticker-contexto"; menu.setAttribute("role", "menu");
    Object.assign(menu.style, { position: "fixed", left: `${Math.max(8, Math.min(x, innerWidth - 230))}px`, top: `${Math.max(8, Math.min(y, innerHeight - 320))}px`, zIndex: "100220", display: "grid", gap: "4px", minWidth: "210px", padding: "9px", borderRadius: "14px", background: "var(--bg-card,#211e2d)", color: "inherit", boxShadow: "0 12px 32px #0009", border: "1px solid var(--border-glass,rgba(255,255,255,.18))" });
    const item = (label, fn) => { const b = document.createElement("button"); b.type = "button"; b.textContent = tr(label); b.setAttribute("role", "menuitem"); Object.assign(b.style, { minHeight: "34px", border: "0", borderRadius: "9px", padding: "6px 9px", background: "transparent", color: "inherit", textAlign: "left", font: "inherit", cursor: "pointer" }); b.onclick = fn; menu.append(b); return b; };
    item("Seleccionar", () => { seleccionarSticker(img.classList.contains("nt-sticker-seleccionado") ? null : img); });
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
    const capasImagenes = () => [...cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")];
    const moverCapa = (direccion) => { const actual = Number.isFinite(Number(img.dataset.z)) && img.dataset.z !== "" ? Number(img.dataset.z) : 10; const capas = capasImagenes().filter((x) => x !== img).map((x) => Number.isFinite(Number(x.dataset.z)) && x.dataset.z !== "" ? Number(x.dataset.z) : 10); capas.push(Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5, 1); const destino = direccion > 0 ? capas.filter((z) => z > actual).sort((a,b) => a-b)[0] : capas.filter((z) => z < actual).sort((a,b) => b-a)[0]; img.dataset.z = String(Math.max(0, Math.min(2000, destino === undefined ? actual + direccion : destino + direccion))); actualizarSticker(img); };
    item("Mover atrás", () => moverCapa(-1));
    item("Mover adelante", () => moverCapa(1));
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
  const imagenNota = (target) => target?.closest?.("img[data-nota-sticker],img[data-nota-image]");
  cuerpo.addEventListener("click", (e) => { const img=imagenNota(e.target); if(img&&!img.classList.contains("nt-sticker-seleccionado")) seleccionarSticker(img); });
  cuerpo.addEventListener("pointerdown", (e) => {
    const img=imagenNota(e.target);
    if(!img){if(stickerSeleccionado)seleccionarSticker(null);return;}
    if(!img.classList.contains("nt-sticker-seleccionado") || (e.button!==0&&e.pointerType==="mouse"))return;
    e.preventDefault(); const sx=e.clientX,sy=e.clientY,unidad=cuerpo.clientWidth||700,ox=Number(img.dataset.moveX)||0,oy=Number(img.dataset.moveY)||0; let movio=false;
    try{img.setPointerCapture(e.pointerId);}catch(_){}
    const mover=(ev)=>{if(ev.pointerId!==e.pointerId)return;const dx=ev.clientX-sx,dy=ev.clientY-sy;if(Math.hypot(dx,dy)>2)movio=true;img.dataset.moveX=String(Math.max(-3,Math.min(3,ox+dx/unidad)));img.dataset.moveY=String(Math.max(-3,Math.min(3,oy+dy/unidad)));aplicarTransformacionSticker(img);posicionarMarcoSticker();};
    const soltar=(ev)=>{if(ev.pointerId!==e.pointerId)return;img.removeEventListener("pointermove",mover);img.removeEventListener("pointerup",soltar);img.removeEventListener("pointercancel",soltar);if(movio){persistir();guardarPasoHistorial("texto");}};
    img.addEventListener("pointermove",mover);img.addEventListener("pointerup",soltar);img.addEventListener("pointercancel",soltar);
  });
  for(const asa of asasSticker.values()) asa.addEventListener("pointerdown",(e)=>{
    const img=stickerSeleccionado;if(!img)return;e.preventDefault();e.stopPropagation();try{asa.setPointerCapture(e.pointerId);}catch(_){}
    const startW=img.offsetWidth||img.width,startH=img.offsetHeight||img.height,aspect=startW/Math.max(1,startH),angle=(Number(img.dataset.rot)||0)*Math.PI/180,fh=img.dataset.flipH==="1"?-1:1,fv=img.dataset.flipV==="1"?-1:1;
    const rr=img.getBoundingClientRect(),cx0=(rr.left+rr.right)/2,cy0=(rr.top+rr.bottom)/2,zoom=rr.width/Math.max(1,startW*Math.abs(Math.cos(angle))+startH*Math.abs(Math.sin(angle)));
    const ux=[Math.cos(angle)*fh,Math.sin(angle)*fh],uy=[-Math.sin(angle)*fv,Math.cos(angle)*fv],hx=Number(asa.dataset.x),hy=Number(asa.dataset.y),px=e.clientX,py=e.clientY;
    const limite=Math.max(160,(cuerpo.clientWidth||700)*4),min=16;let cambio=false;
    const mover=(ev)=>{if(ev.pointerId!==e.pointerId)return;const dx=((ev.clientX-px)*ux[0]+(ev.clientY-py)*ux[1])/Math.max(.01,zoom),dy=((ev.clientX-px)*uy[0]+(ev.clientY-py)*uy[1])/Math.max(.01,zoom);let nw=startW,nh=startH,dcx=0,dcy=0;
      if(hx&&hy){let k=(hx*dx+hy*dy/aspect)/(1+1/(aspect*aspect));nw=Math.max(min,Math.min(limite,startW+k));nh=nw/aspect;const dw=nw-startW,dh=nh-startH;dcx=ux[0]*hx*dw/2+uy[0]*hy*dh/2;dcy=ux[1]*hx*dw/2+uy[1]*hy*dh/2;}
      else if(hx){nw=Math.max(min,Math.min(limite,startW+hx*dx));dcx=ux[0]*hx*(nw-startW)/2;dcy=ux[1]*hx*(nw-startW)/2;}
      else {nh=Math.max(min,Math.min(limite,startH+hy*dy));dcx=uy[0]*hy*(nh-startH)/2;dcy=uy[1]*hy*(nh-startH)/2;}
      const targetX=cx0+dcx,targetY=cy0+dcy;img.style.width=`${nw}px`;img.style.height=`${nh}px`;const actual=img.getBoundingClientRect(),cx=(actual.left+actual.right)/2,cy=(actual.top+actual.bottom)/2,base=cuerpo.clientWidth||700;img.dataset.moveX=String((Number(img.dataset.moveX)||0)+(targetX-cx)/base);img.dataset.moveY=String((Number(img.dataset.moveY)||0)+(targetY-cy)/base);aplicarTransformacionSticker(img);posicionarMarcoSticker();cambio=true;
    };
    const soltar=(ev)=>{if(ev.pointerId!==e.pointerId)return;asa.removeEventListener("pointermove",mover);asa.removeEventListener("pointerup",soltar);asa.removeEventListener("pointercancel",soltar);if(cambio){img.style.width=`${img.offsetWidth}px`;img.style.height=`${img.offsetHeight}px`;img.setAttribute("width",String(Math.round(img.offsetWidth)));img.setAttribute("height",String(Math.round(img.offsetHeight)));persistir();guardarPasoHistorial("sticker");}};
    asa.addEventListener("pointermove",mover);asa.addEventListener("pointerup",soltar);asa.addEventListener("pointercancel",soltar);
  });
  document.addEventListener("scroll",posicionarMarcoSticker,true);window.addEventListener("resize",posicionarMarcoSticker);

  function aplicarEstadoEditor(s) {
    restaurandoHistorial = true;
    try {
      titulo.value = s.titulo; cuerpo.innerHTML = s.contenido;
      cuerpo.querySelectorAll('input[type="checkbox"]').forEach((c) => { c.disabled = false; });
      borrador.tinta.splice(0, borrador.tinta.length, ...JSON.parse(JSON.stringify(s.tinta || [])));
      borrador.capa_tinta_z = Number.isFinite(Number(s.capa_tinta_z)) ? Number(s.capa_tinta_z) : 5; capaTinta?.establecerNivel?.(borrador.capa_tinta_z);
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
    guardarAlSalir();
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
  const pedirCerrar = () => { if (cerrado || preguntandoCerrar) return; clearTimeout(timer); if (firmaEditor() === firmaInicialEditor) { descartandoCambios = true; cerrarEditor(); return; } if (!original) { guardarAlSalir(); cerrarEditor(); return; } preguntandoCerrar = true; dialogoCerrar.classList.remove("nt-oculto"); dialogoCerrar.querySelector('[data-close="save"]').focus(); };
  dialogoCerrar.addEventListener("click", async (e) => {
    if (e.target === dialogoCerrar) { preguntandoCerrar = false; dialogoCerrar.classList.add("nt-oculto"); return; }
    const accion = e.target.closest("[data-close]")?.dataset.close; if (!accion) return;
    if (accion === "discard") {
      clearTimeout(timer); eliminando = true; descartandoCambios = true;
      try { const actual = obtenerNota(borrador.id); if (original) guardarNota({ ...original, _mod_manual: true }); else if (actual) eliminarDefinitiva(actual); }
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
    if (e.key === "Escape") { if (!menuFiguraContexto.classList.contains("nt-oculto")) { e.preventDefault(); menuFiguraContexto.classList.add("nt-oculto"); return; } if(capaTinta?.obtenerModo?.()){e.preventDefault();fijarModo(null);return;} if (!dialogoFechas.classList.contains("nt-oculto")) { e.preventDefault(); cerrarDialogoFechas(); return; } if (!accionesExtra.classList.contains("nt-oculto")) { e.preventDefault(); cerrarMenuCompartir(); modal.querySelector('[data-action="share"]')?.focus({ preventScroll: true }); return; } if (preguntandoCerrar) { e.preventDefault(); preguntandoCerrar = false; dialogoCerrar.classList.add("nt-oculto"); return; } if (mostrarElegirFecha || editarVence) { e.preventDefault(); mostrarElegirFecha = false; editarVence = false; pintarVencimiento(); return; } pedirCerrar(); return; }
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

  let avisoOCRActivo=null,timerAvisoOCR=0;
  function mostrarAvisoSuperior(texto){const a=document.createElement("div");a.className="nt-aviso-superior nt-aviso-error";a.setAttribute("role","status");a.textContent=tr(texto);document.body.append(a);setTimeout(()=>a.remove(),6000);}
  async function convertirTintaATexto(){
    if(!(borrador.tinta||[]).length){mostrarAvisoSuperior("No hay tinta que convertir.");return;}
    if(ocrController)return;
    clearTimeout(timerAvisoOCR);avisoOCRActivo?.remove();const aviso=document.createElement("div");avisoOCRActivo=aviso;aviso.className="nt-aviso-superior nt-aviso-procesando";aviso.setAttribute("role","status");aviso.setAttribute("aria-live","polite");aviso.setAttribute("aria-atomic","true");aviso.setAttribute("aria-busy","true");aviso.textContent=tr("Preparando la conversión de escritura…");document.body.append(aviso);
    ocrController?.abort();ocrController=new AbortController();const controller=ocrController;
    try{await new Promise(resolve=>requestAnimationFrame(resolve));if(controller.signal.aborted)return;const {transcribirTintaGemini}=await import("./notas-ocr.js");if(controller.signal.aborted)return;aviso.textContent=tr("Reconociendo escritura manuscrita…");const imagen=capaTinta.exportarImagenOCR();const texto=await transcribirTintaGemini(imagen,borrador.tinta,{signal:controller.signal});if(cerrado||controller.signal.aborted){aviso.remove();return;}aviso.classList.remove("nt-aviso-procesando");aviso.setAttribute("aria-busy","false");aviso.textContent=`${tr("Texto convertido. Pulsa Deshacer si no te gusta.")}\n${texto}`;aviso.classList.add("nt-aviso-resultado");aviso.setAttribute("aria-label",tr("Texto convertido; deshaz si no te gusta"));timerAvisoOCR=setTimeout(()=>{aviso.remove();if(avisoOCRActivo===aviso)avisoOCRActivo=null;},6000);
      const sel=getSelection();if(rangoGuardado&&cuerpo.contains(rangoGuardado.startContainer)){cuerpo.focus();sel.removeAllRanges();sel.addRange(rangoGuardado);document.execCommand("insertText",false,texto);}else{const p=document.createElement("p");p.textContent=texto;cuerpo.append(p);}
      borrador.tinta.splice(0,borrador.tinta.length);capaTinta.redibujar();ultimoTipo="t";persistir();guardarPasoHistorial("ocr");
    }catch(e){if(cerrado||controller.signal.aborted){aviso.remove();return;}aviso.classList.remove("nt-aviso-procesando");aviso.setAttribute("aria-busy","false");aviso.textContent=tr(e.message||"No se pudo convertir la tinta. La tinta se conservó sin cambios.");aviso.classList.add("nt-aviso-error");timerAvisoOCR=setTimeout(()=>{aviso.remove();if(avisoOCRActivo===aviso)avisoOCRActivo=null;},8000);}finally{if(ocrController===controller)ocrController=null;}
  }

  /* --- Tinta: lápiz y borrador (el selector de color vive a la derecha, siempre visible) --- */
  borrador.tinta = JSON.parse(JSON.stringify(borrador.tinta || []));
  capaTinta = crearCapaTinta({ cuerpo, viewport:viewportLienzo, modal, obtenerTrazos: () => borrador.tinta, alCambiar: () => { const nivelesImagenes = [...cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")].map((img) => Number.isFinite(Number(img.dataset.z)) && img.dataset.z !== "" ? Number(img.dataset.z) : 10); const nivelActual = Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5; const nivelMaximo = Math.max(1, ...nivelesImagenes); borrador.capa_tinta_z = Math.min(2000, Math.max(nivelActual, nivelMaximo) + (nivelActual >= nivelMaximo ? 0 : 1)); capaTinta?.establecerNivel?.(borrador.capa_tinta_z); ultimoTipo = "i"; persistir(); guardarPasoHistorial("tinta"); } });
  borrador.capa_tinta_z = Number.isFinite(Number(borrador.capa_tinta_z)) ? Number(borrador.capa_tinta_z) : 5; capaTinta.establecerNivel?.(borrador.capa_tinta_z);
  const ponerTintaAlFrente = (e) => { if (!e.target.classList?.contains("nt-tinta-canvas") || (capaTinta.obtenerModo() === "borrador")) return; const niveles = [...cuerpo.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")].map((img) => Number.isFinite(Number(img.dataset.z)) && img.dataset.z !== "" ? Number(img.dataset.z) : 10); borrador.capa_tinta_z = Math.min(2000, Math.max(1, ...niveles) + 1); capaTinta.establecerNivel(borrador.capa_tinta_z); };
  modal.addEventListener("pointerdown", ponerTintaAlFrente, true);
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
  const simbolosForma={linea:"╱",flecha:"↗",rectangulo:"▱",cuadrado:"□",circulo:"○",elipse:"⬭",triangulo:"△",rombo:"◇",estrella:"☆",corazon:"♡"};
  const fijarModo = (m) => { capaTinta.establecerModo(m); cuerpo.contentEditable = m ? "false" : "true"; btnLapiz.setAttribute("aria-pressed", String(m === "lapiz")); btnBorrador.setAttribute("aria-pressed", String(m === "borrador")); botonesForma.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.forma === m)));btnFiguras.innerHTML=m&&simbolosForma[m]?`<span class="nt-figura-activa" aria-hidden="true">${simbolosForma[m]}</span>`:ICONOS.figuras;btnFiguras.classList.toggle("nt-herramienta-activa",!!m&&!!simbolosForma[m]); };
  editarFigurasInput.onchange=()=>{ if(editarFigurasInput.checked) fijarModo(null); capaTinta.establecerEdicionFiguras(editarFigurasInput.checked); eliminarFiguraBtn.classList.toggle("nt-oculto",!editarFigurasInput.checked); };
  eliminarFiguraBtn.onclick=()=>{ if(!capaTinta.eliminarFiguraSeleccionada()) mostrarToast(tr("Selecciona una figura para eliminar")); };
  modal.addEventListener("nt:figura-contexto",(e)=>{const {figura,x,y}=e.detail||{};if(!figura)return;colorFiguraInput.value=/^#[\da-f]{6}$/i.test(figura.c||"")?figura.c:"#172033";menuFiguraContexto.classList.remove("nt-oculto");const w=menuFiguraContexto.offsetWidth,h=menuFiguraContexto.offsetHeight;menuFiguraContexto.style.left=`${Math.max(8,Math.min(x,innerWidth-w-8))}px`;menuFiguraContexto.style.top=`${Math.max(8,Math.min(y,innerHeight-h-8))}px`;});
  const cerrarContextoFuera=(e)=>{if(!menuFiguraContexto.contains(e.target))menuFiguraContexto.classList.add("nt-oculto");};document.addEventListener("pointerdown",cerrarContextoFuera,true);
  eliminarFiguraContexto.onclick=()=>{capaTinta.eliminarFiguraSeleccionada();menuFiguraContexto.classList.add("nt-oculto");};colorFiguraInput.onchange=()=>{capaTinta.cambiarColorFiguraSeleccionada(colorFiguraInput.value);menuFiguraContexto.classList.add("nt-oculto");};
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
