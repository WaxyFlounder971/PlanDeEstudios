/* =========================================================================
   ADJUNTOS — UI compartida (2026-08-19)
   -------------------------------------------------------------------------
   Todo lo visual del sistema de adjuntos que NO depende de dónde se use
   (Cronograma de una materia, un evento/tarea de Agenda, o cualquier otra
   entidad futura que quiera soportar adjuntos) vive acá — un solo lugar
   para el modal "Adjuntar" y el menú de gestión, en vez de reconstruirlos
   por separado en cada pantalla. La lógica de datos (subir, guardar
   enlace, reordenar, activar/desactivar, borrar) ya vive en
   core/storage-adjuntos.js; este archivo solo arma el DOM y llama a esas
   funciones.

   No se clona crearModalDinamico (semestres-tarjetas.js) porque no está
   exportado de ahí — se arma acá un modal chico propio, con las mismas
   clases CSS (.modal-overlay/.glass-card.modal-card/.modal-x-close) para
   que se vea idéntico al resto de la app sin duplicar esa función entera.
   ========================================================================= */

import {
  adjuntarArchivo,
  agregarEnlaceAdjunto,
  alternarActivoAdjunto,
  descargarAdjunto,
  editarAdjunto,
  eliminarAdjunto,
  obtenerAdjuntosDe,
  reordenarAdjuntos,
} from "../core/storage-adjuntos.js";
import { abrirConfirmacion, mostrarToast } from "./componentes.js";

/* ------------------------------- Abrir uno ------------------------------- */

/**
 * Resuelve y abre un adjunto puntual — mismo comportamiento sin importar
 * desde dónde se lo toque (pill del Cronograma, chip de una tarjeta de
 * evento, fila del menú de gestión). Un enlace abre directo; un archivo se
 * descarga bajo demanda (ver core/storage-adjuntos.js/descargarAdjunto) y
 * se abre en pestaña nueva, revocando el Blob URL apenas el navegador
 * tuvo tiempo de usarlo — no hace falta guardarlo más que eso.
 */
async function abrirAdjunto(adjunto) {
  if (adjunto.tipo === "enlace") {
    window.open(adjunto.url, "_blank", "noopener");
    return;
  }
  if (adjunto.subidaPendiente || !adjunto.driveFileId) {
    mostrarToast(`"${adjunto.nombre}" todavía se está subiendo — probá de nuevo en un momento.`);
    return;
  }
  try {
    const blobUrl = await descargarAdjunto(adjunto);
    window.open(blobUrl, "_blank", "noopener");
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) {
    mostrarToast(`No se pudo abrir "${adjunto.nombre}" — probá de nuevo.`);
    console.warn(e);
  }
}

/* ------------------------------ Modal "Adjuntar" ------------------------------ */

/**
 * `cerrarAlTocarAfuera` (pedido explícito, "que cuando toco afuera no se
 * salga"): antes SIEMPRE se cerraba al tocar fuera de la tarjeta, sin
 * excepción — perdiendo lo que la persona llevaba escrito a medio llenar
 * un formulario (nombre/enlace/emoji) con un toque afuera sin querer.
 * Los modales de FORMULARIO (abrirModalAdjuntar, abrirModalEditarAdjunto)
 * lo pasan en `false`: la única forma de salir es la ✕ o guardando/
 * cancelando. El menú de gestión (abrirMenuAdjuntos) no tiene texto a
 * medio escribir — cada acción (switch, editar, borrar, reordenar) ya
 * queda guardada al toque, así que ese sigue cerrando al tocar afuera
 * (valor por defecto, sin cambios de comportamiento ahí).
 */
function crearOverlayModalChico(tituloTexto, { cerrarAlTocarAfuera = true } = {}) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const card = document.createElement("div");
  card.className = "glass-card modal-card stack";
  card.style.gap = "14px";

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.className = "modal-x-close";
  btnX.setAttribute("aria-label", "Cerrar");
  btnX.textContent = "✕";
  btnX.addEventListener("click", () => overlay.remove());
  card.appendChild(btnX);

  if (tituloTexto) {
    const h = document.createElement("h3");
    h.style.margin = "0";
    h.textContent = tituloTexto;
    card.appendChild(h);
  }

  overlay.appendChild(card);
  if (cerrarAlTocarAfuera) {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
  }
  document.body.appendChild(overlay);
  return { overlay, card };
}

function crearCampoModal(card, etiquetaTexto, tipo, placeholder) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = etiquetaTexto;
  wrap.appendChild(label);
  const input = document.createElement("input");
  input.type = tipo || "text";
  input.className = "form-input";
  if (placeholder) input.placeholder = placeholder;
  wrap.appendChild(input);
  card.appendChild(wrap);
  return input;
}

// Paleta de accesos rápidos (pedido explícito: "facilitales un botón para
// poner emojis en caso de que su dispositivo no traiga a mano") — un
// puñado de emojis típicos de material de estudio; tocar uno lo escribe
// directo en el campo de texto de al lado.
const EMOJIS_RAPIDOS_ADJUNTO = ["📄", "🔗", "📘", "📝", "📚", "🎥", "🔊", "🗂️", "✅", "⭐"];

/**
 * Campo de emoji del adjunto (2026-08-19, pedido explícito): antes, tocar
 * el emoji de la fila "Adjuntar" abría el prompt() NATIVO del navegador
 * para pedirlo — eso "mataba el diseño" (un diálogo del sistema operativo,
 * ajeno a toda la app) y encima era el emoji de un botón GLOBAL, no de
 * CADA adjunto. Ahora es un campo más de este mismo modal — el MISMO tipo
 * de input de texto que "Nombre" — con esta paleta de accesos rápidos al
 * lado para quien no tenga a mano el teclado de emojis: nunca un diálogo
 * nativo, todo vive dentro de la propia tarjeta del modal. Vacío = sin
 * emoji (queda el ícono por defecto según el tipo de adjunto).
 */
function crearCampoEmojiModal(card, valorInicial) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = "Emoji (opcional)";
  wrap.appendChild(label);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-input";
  input.placeholder = "Sin emoji";
  input.style.cssText = "text-align:center; font-size:1.1rem;";
  input.maxLength = 4; // margen para emojis compuestos (banderas, tono de piel), no solo 1 code point
  if (valorInicial) input.value = valorInicial;
  wrap.appendChild(input);

  const paleta = document.createElement("div");
  paleta.className = "adjunto-emoji-paleta";
  EMOJIS_RAPIDOS_ADJUNTO.forEach((emoji) => {
    const btnEmoji = document.createElement("button");
    btnEmoji.type = "button";
    btnEmoji.className = "adjunto-emoji-opcion";
    btnEmoji.textContent = emoji;
    btnEmoji.title = `Usar ${emoji}`;
    btnEmoji.addEventListener("click", () => {
      input.value = emoji;
      input.focus();
    });
    paleta.appendChild(btnEmoji);
  });
  wrap.appendChild(paleta);

  card.appendChild(wrap);
  return input;
}

/**
 * El botón "Adjuntar": arranca en 2 botones (archivo / enlace) — pedido
 * explícito. Elegir "archivo" abre el picker nativo y, apenas se elige un
 * archivo, pide un nombre (pre-llenado con el nombre real del archivo,
 * editable) antes de subirlo — fix reportado: antes se subía directo con
 * el nombre crudo del archivo, sin forma de ponerle una etiqueta propia
 * (ver adjuntarArchivo en storage-adjuntos.js, que ahora acepta ese nombre
 * personalizado). Elegir "enlace" sigue pidiendo nombre igual que siempre
 * — a diferencia de un archivo, una URL sola no es una etiqueta usable
 * para el botón/pill que va a mostrarla después.
 */
function abrirModalAdjuntar({ entidadTipo, entidadId, onListo }) {
  const { overlay, card } = crearOverlayModalChico("Adjuntar", { cerrarAlTocarAfuera: false });

  const vistaInicial = document.createElement("div");
  vistaInicial.className = "stack";
  vistaInicial.style.gap = "10px";

  const btnArchivo = document.createElement("button");
  btnArchivo.type = "button";
  btnArchivo.className = "btn btn-secondary btn-block";
  btnArchivo.textContent = "📄 Subir archivo";

  const btnEnlace = document.createElement("button");
  btnEnlace.type = "button";
  btnEnlace.className = "btn btn-secondary btn-block";
  btnEnlace.textContent = "🔗 Agregar enlace";

  vistaInicial.append(btnArchivo, btnEnlace);
  card.appendChild(vistaInicial);

  const inputFile = document.createElement("input");
  inputFile.type = "file";
  inputFile.style.display = "none";
  inputFile.addEventListener("change", () => {
    const archivo = inputFile.files[0];
    inputFile.value = ""; // permite re-elegir el mismo archivo dos veces seguidas si hiciera falta
    if (!archivo) return;

    vistaInicial.remove();

    const inputNombre = crearCampoModal(card, "Nombre", "text", "Ej. Libro del curso");
    inputNombre.value = archivo.name;

    const inputEmoji = crearCampoEmojiModal(card, "");

    const btnGuardar = document.createElement("button");
    btnGuardar.type = "button";
    btnGuardar.className = "btn btn-primary btn-block";
    btnGuardar.textContent = "Adjuntar";
    btnGuardar.addEventListener("click", () => {
      try {
        adjuntarArchivo(archivo, entidadTipo, entidadId, inputNombre.value.trim(), inputEmoji.value.trim());
        mostrarToast(`Adjuntando "${inputNombre.value.trim() || archivo.name}"…`);
        overlay.remove();
        onListo?.();
      } catch (e) {
        mostrarToast(e.message);
      }
    });
    card.appendChild(btnGuardar);

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnGuardar.click();
      }
    });
    inputNombre.focus();
    inputNombre.select();
  });
  card.appendChild(inputFile);
  btnArchivo.addEventListener("click", () => inputFile.click());

  btnEnlace.addEventListener("click", () => {
    vistaInicial.remove();

    const inputNombre = crearCampoModal(card, "Nombre", "text", "Ej. Libro del curso");
    const inputUrl = crearCampoModal(card, "Enlace", "url", "https://…");
    const inputEmoji = crearCampoEmojiModal(card, "");

    const btnGuardar = document.createElement("button");
    btnGuardar.type = "button";
    btnGuardar.className = "btn btn-primary btn-block";
    btnGuardar.textContent = "Guardar";
    btnGuardar.addEventListener("click", () => {
      try {
        agregarEnlaceAdjunto({
          nombre: inputNombre.value.trim() || inputUrl.value.trim(),
          url: inputUrl.value.trim(),
          entidadTipo,
          entidadId,
          emoji: inputEmoji.value.trim(),
        });
        overlay.remove();
        onListo?.();
      } catch (e) {
        mostrarToast(e.message);
      }
    });
    card.appendChild(btnGuardar);

    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        btnGuardar.click();
      }
    });
    inputNombre.focus();
  });
}

/**
 * Edita un adjunto YA EXISTENTE (pedido explícito, 2026-08-19: hasta ahora
 * no había forma de corregir un nombre, el enlace o el emoji sin borrar el
 * adjunto entero y crearlo de nuevo). Mismo modal chico y mismos campos que
 * abrirModalAdjuntar (crearCampoModal/crearCampoEmojiModal) — se siente
 * como el mismo formulario, ahora pre-llenado.
 *
 * Cambiar de tipo (pedido explícito, 2026-09-26: "poder editar enlaces o
 * cambiar a archivos y viceversa"): arriba de todo hay ahora un selector
 * Enlace/Archivo. Mientras se deja en el tipo original, esto sigue siendo
 * la edición liviana de siempre (editarAdjunto — nombre/url/emoji, sin
 * tocar Drive). Si se cambia de tipo, por debajo NO hay forma de
 * "convertir" un archivo real de Drive en una URL ni viceversa (ver
 * editarAdjunto en storage-adjuntos.js) — se hace un reemplazo completo:
 * primero se crea el adjunto nuevo (con el archivo elegido o la URL
 * escrita) y RECIÉN si eso sale bien se borra el original, en ese orden,
 * para no perder el adjunto original si la URL es inválida o el archivo
 * pesa de más. El reemplazo queda en el mismo lugar del orden y con el
 * mismo estado activo/inactivo que tenía el original, para que el cambio
 * de tipo no se note "por debajo" más que en su ícono/comportamiento.
 */
function abrirModalEditarAdjunto(adjunto, onListo) {
  const { overlay, card } = crearOverlayModalChico("Editar adjunto", { cerrarAlTocarAfuera: false });

  const tipoOriginal = adjunto.tipo === "enlace" ? "enlace" : "archivo";
  let tipoElegido = tipoOriginal;
  let archivoElegido = null;

  const selectorTipo = document.createElement("div");
  selectorTipo.style.cssText = "display:flex; gap:8px;";
  const btnTipoEnlace = document.createElement("button");
  btnTipoEnlace.type = "button";
  btnTipoEnlace.textContent = "🔗 Enlace";
  const btnTipoArchivo = document.createElement("button");
  btnTipoArchivo.type = "button";
  btnTipoArchivo.textContent = "📄 Archivo";
  selectorTipo.append(btnTipoEnlace, btnTipoArchivo);
  card.appendChild(selectorTipo);

  const inputNombre = crearCampoModal(card, "Nombre", "text", "Ej. Libro del curso");
  inputNombre.value = adjunto.nombre || "";

  // Zona de campos que cambia según tipoElegido — se reconstruye entera
  // cada vez que se toca una pestaña (más simple que llevar 2 juegos de
  // inputs escondidos con display:none a la vez).
  const zonaTipo = document.createElement("div");
  card.appendChild(zonaTipo);

  let inputUrl = null;
  let inputFileOculto = null;

  function pintarSelectorTipo() {
    btnTipoEnlace.className = "btn btn-block " + (tipoElegido === "enlace" ? "btn-primary" : "btn-secondary");
    btnTipoArchivo.className = "btn btn-block " + (tipoElegido === "archivo" ? "btn-primary" : "btn-secondary");
  }

  function pintarZonaTipo() {
    zonaTipo.innerHTML = "";
    inputUrl = null;
    inputFileOculto = null;

    if (tipoElegido === "enlace") {
      inputUrl = crearCampoModal(zonaTipo, "Enlace", "url", "https://…");
      // Si ya era un enlace y no se cambió de pestaña, precarga la URL
      // actual; si se está convirtiendo desde un archivo, arranca vacío —
      // no hay URL previa que ofrecer.
      inputUrl.value = tipoOriginal === "enlace" ? adjunto.url || "" : "";
      return;
    }

    const wrapArchivo = document.createElement("div");
    wrapArchivo.className = "stack";
    wrapArchivo.style.gap = "6px";

    const siguoSiendoArchivo = tipoOriginal === "archivo";
    const etiquetaArchivo = document.createElement("p");
    etiquetaArchivo.className = "muted";
    etiquetaArchivo.style.cssText = "margin:0; font-size:0.82rem;";
    etiquetaArchivo.textContent = siguoSiendoArchivo
      ? "El archivo ya subido se mantiene igual — esto solo edita nombre/emoji."
      : "Elegí el archivo para este adjunto.";
    wrapArchivo.appendChild(etiquetaArchivo);

    // Solo hace falta elegir un archivo nuevo cuando se está CONVIRTIENDO
    // desde un enlace — no hay contenido previo del que partir. Si el
    // adjunto ya era un archivo y no se cambió de pestaña, no se ofrece acá
    // "reemplazar el archivo" (eso sigue fuera de alcance, ver editarAdjunto)
    // — solo nombre/emoji, como siempre.
    if (!siguoSiendoArchivo) {
      const btnElegirArchivo = document.createElement("button");
      btnElegirArchivo.type = "button";
      btnElegirArchivo.className = "btn btn-secondary btn-block";
      btnElegirArchivo.textContent = archivoElegido ? `📄 ${archivoElegido.name}` : "📄 Elegir archivo";
      wrapArchivo.appendChild(btnElegirArchivo);

      inputFileOculto = document.createElement("input");
      inputFileOculto.type = "file";
      inputFileOculto.style.display = "none";
      inputFileOculto.addEventListener("change", () => {
        archivoElegido = inputFileOculto.files[0] || null;
        if (archivoElegido) {
          btnElegirArchivo.textContent = `📄 ${archivoElegido.name}`;
          if (!inputNombre.value.trim()) inputNombre.value = archivoElegido.name;
        }
      });
      wrapArchivo.appendChild(inputFileOculto);
      btnElegirArchivo.addEventListener("click", () => inputFileOculto.click());
    }

    zonaTipo.appendChild(wrapArchivo);
  }

  btnTipoEnlace.addEventListener("click", () => {
    if (tipoElegido === "enlace") return;
    tipoElegido = "enlace";
    pintarSelectorTipo();
    pintarZonaTipo();
  });
  btnTipoArchivo.addEventListener("click", () => {
    if (tipoElegido === "archivo") return;
    tipoElegido = "archivo";
    pintarSelectorTipo();
    pintarZonaTipo();
  });

  pintarSelectorTipo();
  pintarZonaTipo();

  const inputEmoji = crearCampoEmojiModal(card, adjunto.emoji || "");

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", async () => {
    const nombreLimpio = inputNombre.value.trim();
    const emojiLimpio = inputEmoji.value.trim();

    if (tipoElegido === tipoOriginal) {
      // Mismo tipo de siempre: edición liviana in situ, sin tocar Drive ni
      // el orden — el camino de siempre.
      try {
        editarAdjunto(adjunto.id, {
          nombre: nombreLimpio,
          url: inputUrl ? inputUrl.value.trim() : undefined,
          emoji: emojiLimpio,
        });
        overlay.remove();
        onListo?.();
      } catch (e) {
        mostrarToast(e.message);
      }
      return;
    }

    // Cambia de tipo: se crea el reemplazo PRIMERO — si la URL es inválida
    // o el archivo pesa de más, ambas funciones tiran error ACÁ, antes de
    // tocar el original para nada.
    try {
      let nuevo;
      if (tipoElegido === "archivo") {
        if (!archivoElegido) throw new Error("Elegí un archivo.");
        nuevo = adjuntarArchivo(archivoElegido, adjunto.entidadTipo, adjunto.entidadId, nombreLimpio, emojiLimpio);
      } else {
        nuevo = agregarEnlaceAdjunto({
          nombre: nombreLimpio,
          url: inputUrl.value.trim(),
          entidadTipo: adjunto.entidadTipo,
          entidadId: adjunto.entidadId,
          emoji: emojiLimpio,
        });
      }

      // Mismo lugar en el orden que tenía el original (sustituyéndolo en
      // la misma posición, no al final de la lista) + mismo estado activo/
      // inactivo. En este punto obtenerAdjuntosDe todavía trae AMBOS (el
      // viejo, que se borra recién abajo, y el nuevo, recién creado al
      // final) — se reemplaza el id viejo por el nuevo en su lugar y se
      // descarta la aparición extra del nuevo al final con el Set.
      const vistos = new Set();
      const idsFinal = obtenerAdjuntosDe(adjunto.entidadTipo, adjunto.entidadId)
        .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0))
        .map((a) => (a.id === adjunto.id ? nuevo.id : a.id))
        .filter((id) => (vistos.has(id) ? false : (vistos.add(id), true)));

      // fijarActivoAdjunto (estado EXACTO) todavía no existe en
      // storage-adjuntos.js — hasta que se agregue, se logra lo mismo acá:
      // alternarActivoAdjunto solo NIEGA el valor actual, así que se
      // compara contra el estado deseado y se llama solo si hace falta
      // cambiarlo (nunca 2 veces, nunca "a ciegas").
      const estadoDeseado = adjunto.activo !== false;
      const estadoActualNuevo = nuevo.activo !== false;
      if (estadoActualNuevo !== estadoDeseado) alternarActivoAdjunto(nuevo.id);
      await eliminarAdjunto(adjunto.id);
      reordenarAdjuntos(idsFinal);

      overlay.remove();
      onListo?.();
    } catch (e) {
      mostrarToast(e.message);
    }
  });
  card.appendChild(btnGuardar);

  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      btnGuardar.click();
    }
  });
  inputNombre.focus();
  inputNombre.select();
}

/* ------------------------------ Menú de gestión ------------------------------ */

/**
 * Lista TODOS los adjuntos de una entidad (activos e inactivos — acá sí
 * hace falta ver los inactivos, para poder reactivarlos) con drag-and-drop
 * para reordenar, un switch para activar/desactivar sin borrar, y un
 * botón de borrado real. Drag-and-drop nativo (HTML5), sin librería —
 * consistente con el resto del proyecto, que no usa ninguna.
 */
function abrirMenuAdjuntos({ entidadTipo, entidadId, onCambiar, titulo }) {
  const { overlay, card } = crearOverlayModalChico(titulo || "Adjuntos");
  card.classList.add("modal-card-ancha");

  const lista = document.createElement("div");
  lista.className = "stack adjuntos-menu-lista";
  card.appendChild(lista);

  let idArrastrando = null;

  function refrescar() {
    const items = obtenerAdjuntosDe(entidadTipo, entidadId).sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    lista.innerHTML = "";

    if (items.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.cssText = "text-align:center; margin:4px 0;";
      vacio.textContent = "No hay adjuntos todavía.";
      lista.appendChild(vacio);
    }

    items.forEach((adjunto) => {
      const fila = document.createElement("div");
      fila.className = "adjunto-fila" + (adjunto.activo === false ? " adjunto-fila-inactiva" : "");
      fila.draggable = true;
      fila.dataset.adjuntoId = adjunto.id;

      const asa = document.createElement("span");
      asa.className = "adjunto-drag-handle";
      asa.textContent = "⠿";
      asa.title = "Arrastrar para reordenar";

      const icono = document.createElement("span");
      // Emoji propio del adjunto si se le puso uno (ver
      // crearCampoEmojiModal) — si no, el ícono por defecto de siempre
      // según el tipo.
      icono.textContent = adjunto.emoji || (adjunto.tipo === "enlace" ? "🔗" : "📄");

      const nombre = document.createElement("span");
      nombre.className = "adjunto-fila-nombre";
      nombre.textContent = adjunto.nombre;
      nombre.title = "Abrir";
      nombre.addEventListener("click", () => abrirAdjunto(adjunto));

      if (adjunto.subidaPendiente) {
        const pendiente = document.createElement("span");
        pendiente.className = "muted";
        pendiente.style.fontSize = "0.72rem";
        pendiente.textContent = "subiendo…";
        nombre.after(pendiente);
      }

      const labelSwitch = document.createElement("label");
      labelSwitch.className = "switch switch-tema";
      labelSwitch.title = adjunto.activo === false ? "Reactivar" : "Desactivar (se oculta sin borrarse)";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = adjunto.activo !== false;
      chk.addEventListener("change", () => {
        alternarActivoAdjunto(adjunto.id);
        onCambiar?.();
        refrescar();
      });
      labelSwitch.appendChild(chk);
      labelSwitch.insertAdjacentHTML("beforeend", '<span class="track"><span class="thumb"></span></span>');

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.className = "adjunto-fila-editar";
      btnEditar.setAttribute("aria-label", "Editar adjunto");
      btnEditar.title = "Editar nombre, enlace y emoji";
      btnEditar.textContent = "✏️";
      btnEditar.addEventListener("click", () => {
        abrirModalEditarAdjunto(adjunto, () => {
          onCambiar?.();
          refrescar();
        });
      });

      const btnEliminar = document.createElement("button");
      btnEliminar.type = "button";
      btnEliminar.className = "adjunto-fila-eliminar";
      btnEliminar.setAttribute("aria-label", "Eliminar adjunto");
      btnEliminar.textContent = "🗑";
      btnEliminar.addEventListener("click", () => {
        abrirConfirmacion({
          titulo: "¿Eliminar adjunto?",
          mensaje: `Se va a borrar "${adjunto.nombre}" — no se puede deshacer.`,
          textoConfirmar: "Eliminar",
          claseConfirmar: "btn-danger",
          onConfirmar: async () => {
            await eliminarAdjunto(adjunto.id);
            onCambiar?.();
            refrescar();
          },
        });
      });

      fila.append(asa, icono, nombre, labelSwitch, btnEditar, btnEliminar);

      fila.addEventListener("dragstart", () => {
        idArrastrando = adjunto.id;
        fila.classList.add("adjunto-fila-arrastrando");
      });
      fila.addEventListener("dragend", () => fila.classList.remove("adjunto-fila-arrastrando"));
      fila.addEventListener("dragover", (e) => e.preventDefault());
      fila.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!idArrastrando || idArrastrando === adjunto.id) return;
        const idsActuales = items.map((it) => it.id);
        const desde = idsActuales.indexOf(idArrastrando);
        const hasta = idsActuales.indexOf(adjunto.id);
        if (desde === -1 || hasta === -1) return;
        idsActuales.splice(hasta, 0, idsActuales.splice(desde, 1)[0]);
        reordenarAdjuntos(idsActuales);
        idArrastrando = null;
        onCambiar?.();
        refrescar();
      });

      lista.appendChild(fila);
    });
  }

  refrescar();

  const btnAgregarOtro = document.createElement("button");
  btnAgregarOtro.type = "button";
  btnAgregarOtro.className = "btn btn-secondary btn-block";
  btnAgregarOtro.textContent = "+ Agregar otro adjunto";
  btnAgregarOtro.addEventListener("click", () => {
    abrirModalAdjuntar({
      entidadTipo,
      entidadId,
      onListo: () => {
        onCambiar?.();
        refrescar();
      },
    });
  });
  card.appendChild(btnAgregarOtro);
}

export { abrirAdjunto, abrirMenuAdjuntos, abrirModalAdjuntar, abrirModalEditarAdjunto };
