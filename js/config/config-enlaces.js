/* =========================================================================
   CONFIGURACIÓN — ENLACES RÁPIDOS
   ========================================================================= */

import { LIMITE_ENLACES_RAPIDOS, crearEnlaceRapido } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { convertirArchivoABase64 } from "../core/utils.js";

/* --------------------------- Enlaces rápidos --------------------------- */

function renderizarEnlacesRapidos() {
  const enlaces = estado.datos.configuracion.enlaces_rapidos;

  renderizarListaEnlacesEn("lista-enlaces", enlaces, true);
  renderizarListaEnlacesEn("lista-enlaces-lateral", enlaces, false);
  // Drawer de Enlaces rápidos en móvil (2026-08-07): mismo criterio que el
  // panel lateral fijo de escritorio — es acceso rápido, no edición, así
  // que va sin el lápiz (conEditar = false). Si el contenedor no existe
  // (ej. una vista que no cargó el drawer), renderizarListaEnlacesEn ya
  // resuelve el `if (!cont) return;` sin romper nada.
  renderizarListaEnlacesEn("lista-enlaces-drawer-movil", enlaces, false);

  const btnAgregar = document.getElementById("btn-agregar-enlace");
  btnAgregar.disabled = enlaces.length >= LIMITE_ENLACES_RAPIDOS;
  btnAgregar.onclick = () => abrirModalEnlace();
}

/** Dibuja la lista de enlaces rápidos dentro de `contenedorId`. `conEditar`
 *  controla si aparece el lápiz de edición (sí en Configuración, no en el
 *  panel lateral fijo, que es solo de acceso rápido — v5 #2). */

function renderizarListaEnlacesEn(contenedorId, enlaces, conEditar) {
  const cont = document.getElementById(contenedorId);
  if (!cont) return;
  cont.innerHTML = "";

  if (enlaces.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no has añadido ningún enlace.</p>`;
    return;
  }

  enlaces.forEach((enlace) => {
    const item = document.createElement("div");
    item.className = "glass-panel row-between";
    item.style.padding = "10px 14px";

    const enlaceAbrir = document.createElement("a");
    enlaceAbrir.href = enlace.url;
    enlaceAbrir.target = "_blank";
    enlaceAbrir.rel = "noopener";
    enlaceAbrir.className = "row";
    enlaceAbrir.style.textDecoration = "none";
    enlaceAbrir.style.flex = "1";
    enlaceAbrir.style.minWidth = "0";
    enlaceAbrir.innerHTML = `<span style="font-size:1.3rem">${
      enlace.icono_tipo === "emoji" ? enlace.icono_valor : `<img src="${enlace.icono_valor}" style="width:24px;height:24px;border-radius:6px">`
    }</span><span class="enlace-rapido-nombre" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${enlace.nombre}</span>`;

    item.appendChild(enlaceAbrir);

    if (conEditar) {
      const btnEditar = document.createElement("button");
      btnEditar.className = "btn btn-secondary";
      btnEditar.title = "Editar enlace";
      btnEditar.textContent = "✏️";
      btnEditar.style.flexShrink = "0";
      btnEditar.addEventListener("click", () => abrirModalEnlace(enlace.id));
      item.appendChild(btnEditar);
    }

    cont.appendChild(item);
  });
}

/* ===================== Modal "Añadir enlace" (punto 7) ===================== */

function inicializarModalEnlace() {
  const modal = document.getElementById("modal-enlace");
  const pillTipo = document.getElementById("pill-tipo-icono");
  const bloqueEmoji = document.getElementById("bloque-icono-emoji");
  const bloqueImagen = document.getElementById("bloque-icono-imagen");

  pillTipo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const esEmoji = btn.dataset.tipo === "emoji";
      bloqueEmoji.classList.toggle("oculto", !esEmoji);
      bloqueImagen.classList.toggle("oculto", esEmoji);
    });
  });

  document.getElementById("btn-cancelar-enlace").addEventListener("click", cerrarModalEnlace);
  document.getElementById("btn-guardar-enlace").addEventListener("click", guardarEnlaceDesdeModal);
  document.getElementById("btn-eliminar-enlace").addEventListener("click", eliminarEnlaceDesdeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModalEnlace();
  });
}

/** Si se pasa `enlaceId`, abre el modal en modo edición precargando sus datos. */

function abrirModalEnlace(enlaceId) {
  const enlace = enlaceId
    ? estado.datos.configuracion.enlaces_rapidos.find((e) => e.id === enlaceId)
    : null;

  estado.enlaceEditandoId = enlace ? enlace.id : null;

  document.getElementById("titulo-modal-enlace").textContent = enlace ? "Editar enlace" : "Añadir enlace";
  document.getElementById("btn-eliminar-enlace").classList.toggle("oculto", !enlace);

  document.getElementById("input-enlace-nombre").value = enlace ? enlace.nombre : "";
  document.getElementById("input-enlace-url").value = enlace ? enlace.url : "";
  document.getElementById("input-enlace-emoji").value = enlace && enlace.icono_tipo === "emoji" ? enlace.icono_valor : "🔗";
  document.getElementById("input-enlace-imagen").value = "";
  document.getElementById("error-modal-enlace").classList.add("oculto");

  const esImagen = enlace && enlace.icono_tipo === "imagen";
  const pillTipo = document.getElementById("pill-tipo-icono");
  pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  pillTipo.querySelector(`[data-tipo="${esImagen ? "imagen" : "emoji"}"]`).classList.add("active");
  document.getElementById("bloque-icono-emoji").classList.toggle("oculto", esImagen);
  document.getElementById("bloque-icono-imagen").classList.toggle("oculto", !esImagen);

  document.getElementById("modal-enlace").classList.remove("oculto");
}

function cerrarModalEnlace() {
  document.getElementById("modal-enlace").classList.add("oculto");
  estado.enlaceEditandoId = null;
}

function eliminarEnlaceDesdeModal() {
  if (!estado.enlaceEditandoId) return;
  estado.datos.configuracion.enlaces_rapidos = estado.datos.configuracion.enlaces_rapidos.filter(
    (e) => e.id !== estado.enlaceEditandoId
  );
  marcarCambioPendiente();
  renderizarEnlacesRapidos();
  cerrarModalEnlace();
}

function mostrarErrorModalEnlace(mensaje) {
  const el = document.getElementById("error-modal-enlace");
  el.textContent = mensaje;
  el.classList.remove("oculto");
}

async function guardarEnlaceDesdeModal() {
  const nombre = document.getElementById("input-enlace-nombre").value.trim();
  const url = document.getElementById("input-enlace-url").value.trim();
  const tipoActivo = document.getElementById("pill-tipo-icono").querySelector(".pill-item.active").dataset.tipo;

  if (!nombre || !url) {
    mostrarErrorModalEnlace("El nombre y la URL son obligatorios.");
    return;
  }

  const enlaceExistente = estado.enlaceEditandoId
    ? estado.datos.configuracion.enlaces_rapidos.find((e) => e.id === estado.enlaceEditandoId)
    : null;

  if (!enlaceExistente && estado.datos.configuracion.enlaces_rapidos.length >= LIMITE_ENLACES_RAPIDOS) {
    mostrarErrorModalEnlace(`Ya tienes el máximo de ${LIMITE_ENLACES_RAPIDOS} enlaces.`);
    return;
  }

  let icono_tipo = "emoji";
  let icono_valor = "🔗";

  if (tipoActivo === "emoji") {
    icono_tipo = "emoji";
    icono_valor = document.getElementById("input-enlace-emoji").value.trim() || "🔗";
  } else {
    const archivo = document.getElementById("input-enlace-imagen").files[0];
    if (!archivo && !(enlaceExistente && enlaceExistente.icono_tipo === "imagen")) {
      mostrarErrorModalEnlace("Selecciona una imagen.");
      return;
    }
    if (archivo) {
      try {
        icono_valor = await convertirArchivoABase64(archivo);
        icono_tipo = "imagen";
      } catch (e) {
        mostrarErrorModalEnlace("No se pudo leer la imagen, intenta con otra.");
        return;
      }
    } else {
      // Se está editando y no se subió una imagen nueva: conserva la anterior.
      icono_tipo = "imagen";
      icono_valor = enlaceExistente.icono_valor;
    }
  }

  if (enlaceExistente) {
    enlaceExistente.nombre = nombre;
    enlaceExistente.url = url;
    enlaceExistente.icono_tipo = icono_tipo;
    enlaceExistente.icono_valor = icono_valor;
  } else {
    estado.datos.configuracion.enlaces_rapidos.push(
      crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor })
    );
  }

  marcarCambioPendiente();
  renderizarEnlacesRapidos();
  cerrarModalEnlace();
}

export {
  abrirModalEnlace,
  cerrarModalEnlace,
  eliminarEnlaceDesdeModal,
  guardarEnlaceDesdeModal,
  inicializarModalEnlace,
  mostrarErrorModalEnlace,
  renderizarEnlacesRapidos,
  renderizarListaEnlacesEn,
};
