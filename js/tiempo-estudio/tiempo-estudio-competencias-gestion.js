/* =========================================================================
   TIEMPO — Gestión de competencias + Registro de finalizadas
   (2026-09-17, Partes 4 y 5)
   -------------------------------------------------------------------------
   Se separó de `tiempo-estudio-competencias.js` porque ese archivo ya
   estaba en ~1100 líneas, bastante por encima del límite de 800 del
   proyecto (ver "Límite de 800 líneas por archivo" en MAPA_FUNCIONES.md).
   El corte es por responsabilidad, no por tamaño arbitrario: allá queda
   "participar" (crear / unirse / marcador / historial / enviar horas),
   acá queda "administrar" (el menú Gestionar con sus 6 acciones) y el
   archivo muerto (Registro de competencias finalizadas).

   Import circular a propósito con tiempo-estudio-competencias.js (allá se
   importa `abrirModalGestionCompetencia` para el botón de la tarjeta, acá
   se importan sus helpers de fetch/modal/tokens). Es seguro porque ningún
   nombre importado se usa en el nivel superior del archivo, solo adentro
   de funciones — mismo criterio ya documentado para el resto del proyecto.

   PERMISOS (punto 4.2) — un solo lugar donde se deciden, `opcionesGestion()`:
     Solo el creador : Renombrar · Sacar usuario · Finalizar/Reactivar · Borrar
     Cualquiera      : Cambiar apodo (el propio) · Salir
   "Creador" acá es `competencia.es_creador` + tener el `token_creador` en
   ESTE dispositivo; el Worker vuelve a validar el token en cada endpoint,
   así que esconder botones es comodidad, nunca la seguridad real.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";
import { mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import {
  construirCajaModal,
  fetchConTimeout,
  formatearHoras,
  leerTokenCreador,
  salirDeCompetencia,
  borrarCompetenciaEntera,
  copiarLinkInvitacion,
  construirLinkInvitacion,
} from "./tiempo-estudio-competencias.js";
// 2026-09-21 — Rediseño: el menú Gestionar usa la hoja del módulo visual.
import { abrirHoja, esc, ICONO } from "./tiempo-estudio-competencias-visual.js";

/* ===================== Menú "Gestionar" (punto 4.1) ===================== */

/**
 * Las opciones que se muestran, ya filtradas por permiso (4.2) y por
 * estado de la competencia (4.3: si está finalizada, "Finalizar" se
 * reemplaza por "Reactivar", y las acciones que modifican la competencia
 * viva pierden sentido).
 */
function opcionesGestion(competencia) {
  const esCreador = Boolean(competencia.es_creador);
  const finalizada = competencia.estado === "finalizada";
  const opciones = [];

  if (esCreador) {
    opciones.push({ id: "renombrar", emoji: "✏️", etiqueta: "Renombrar competencia" });
  }
  // El apodo propio se puede cambiar siempre, incluso archivada: es cómo
  // te ve el resto en el marcador y en el historial que sigue en pantalla.
  opciones.push({ id: "apodo", emoji: "🏷️", etiqueta: "Cambiar mi apodo" });

  if (esCreador) {
    opciones.push(
      finalizada
        ? { id: "reactivar", emoji: "🔄", etiqueta: "Reactivar competencia" }
        : { id: "finalizar", emoji: "🏁", etiqueta: "Finalizar competencia" }
    );
    if (!finalizada) {
      opciones.push({ id: "sacar", emoji: "👤", etiqueta: "Sacar usuario" });
    }
  }

  opciones.push({ id: "salir", emoji: "🚪", etiqueta: "Salir de la competencia" });
  if (esCreador) {
    opciones.push({ id: "borrar", emoji: "💥", etiqueta: "Borrar competencia", peligro: true });
  }
  return opciones;
}

/**
 * Menú Gestionar (rediseño 2026-09-21). Una hoja con dos bloques:
 *   1. Invitar — el enlace de invitación (antes era el botón "Enlace" de la
 *      tarjeta; ahora vive acá, arriba de todo).
 *   2. Opciones — las mismas acciones de siempre, ya filtradas por permiso
 *      (`opcionesGestion`); cada una cierra la hoja antes de abrir lo que
 *      sigue (los sub-modales siguen siendo los de siempre).
 * Una competencia finalizada no acepta gente nueva: en vez del enlace se
 * explica por qué (mismo criterio que tenía el botón "Enlace").
 */
function abrirModalGestionCompetencia(competencia, refrescar) {
  asegurarEstilosGestion();
  const finalizada = competencia.estado === "finalizada";

  const bloqueInvitar = finalizada
    ? `<div class="cp-lk">
         <div class="cp-lk-top">
           <div class="cp-lk-ic">${ICONO.link}</div>
           <div><div class="cp-lk-t">Enlace de invitación</div>
           <div class="cp-lk-s">Esta competencia está finalizada — no acepta gente nueva.</div></div>
         </div>
       </div>`
    : `<div class="cp-lk">
         <div class="cp-lk-top">
           <div class="cp-lk-ic">${ICONO.link}</div>
           <div><div class="cp-lk-t">Enlace de invitación</div>
           <div class="cp-lk-s">Quien lo abra puede unirse a la competencia.</div></div>
         </div>
         <div class="cp-lk-row"><code>${esc(construirLinkInvitacion(competencia.id))}</code><button type="button" class="cp-lk-copy" data-cp="copiar">Copiar</button></div>
       </div>`;

  const opciones = opcionesGestion(competencia);
  const hoja = abrirHoja({
    icono: "gear",
    tono: "acc",
    titulo: "Gestionar",
    subtitulo: competencia.nombre + (finalizada ? " · finalizada" : ""),
    cuerpoHTML: `
      <div class="cp-grp">Invitar</div>
      ${bloqueInvitar}
      <div class="cp-grp">Opciones</div>
      ${opciones
        .map(
          (o) =>
            `<button type="button" class="cp-opt${o.peligro ? " cp-peligro" : ""}" data-opcion="${o.id}"><span class="cp-opt-emoji">${o.emoji}</span><span>${esc(o.etiqueta)}</span></button>`
        )
        .join("")}`,
  });

  const btnCopiar = hoja.cuerpo.querySelector('[data-cp="copiar"]');
  if (btnCopiar) {
    btnCopiar.addEventListener("click", async () => {
      const copiado = await copiarLinkInvitacion(competencia);
      if (!copiado) return; // se abrió el modal de copia manual; la hoja se queda debajo
      btnCopiar.textContent = "¡Copiado!";
      setTimeout(() => {
        if (btnCopiar.isConnected) btnCopiar.textContent = "Copiar";
      }, 1600);
    });
  }

  hoja.cuerpo.querySelectorAll("[data-opcion]").forEach((btn) =>
    btn.addEventListener("click", () => {
      hoja.cerrar(); // el menú siempre se va antes de abrir lo que sigue
      ejecutarOpcionGestion(btn.dataset.opcion, competencia, refrescar);
    })
  );
}

function ejecutarOpcionGestion(id, competencia, refrescar) {
  switch (id) {
    case "renombrar":
      abrirModalRenombrarCompetencia(competencia, refrescar);
      break;
    case "apodo":
      abrirModalCambiarApodo(competencia, refrescar);
      break;
    case "finalizar":
      confirmarCambioDeEstado(competencia, "finalizada", refrescar);
      break;
    case "reactivar":
      confirmarCambioDeEstado(competencia, "activa", refrescar);
      break;
    case "sacar":
      abrirModalSacarUsuario(competencia, refrescar);
      break;
    case "salir":
      salirDeCompetencia(competencia, refrescar);
      break;
    case "borrar":
      borrarCompetenciaEntera(competencia, refrescar);
      break;
    default:
      break;
  }
}

/* ===================== Renombrar competencia ===================== */

function abrirModalRenombrarCompetencia(competencia, refrescar) {
  const tokenCreador = leerTokenCreador(competencia.id);
  if (!tokenCreador) {
    mostrarToast("No se encontró el permiso de creador en este dispositivo.");
    return;
  }

  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Renombrar competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Lo ven todos los participantes.</p>
    </div>
    <div>
      <span class="form-label">Nombre</span>
      <input type="text" id="comp-renombrar-nombre" class="form-input" maxlength="60" autocomplete="off" value="${competencia.nombre || ""}">
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-renombrar-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="comp-renombrar-guardar" style="flex:1;">Guardar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  caja.querySelector("#comp-renombrar-cancelar").addEventListener("click", cerrar);

  const btn = caja.querySelector("#comp-renombrar-guardar");
  btn.addEventListener("click", async () => {
    const nombre = caja.querySelector("#comp-renombrar-nombre").value.trim();
    if (!nombre) {
      mostrarToast("Poné un nombre");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      const respuesta = await fetchConTimeout(
        `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/renombrar`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_creador: tokenCreador, nombre }),
        }
      );
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    } catch (e) {
      console.error("[competencias] Falló renombrar:", e);
      mostrarToast("No se pudo renombrar. Revisá tu conexión e intentá de nuevo.");
      btn.disabled = false;
      btn.textContent = "Guardar";
      return;
    }

    // Relectura de entidad viva (patrón obligatorio del proyecto): el
    // objeto del closure puede haber sido reemplazado por un sondeo remoto
    // mientras el modal estaba abierto.
    const viva = estado.datos.competencias_unidas.find((c) => c.id === competencia.id);
    if (viva) {
      viva.nombre = nombre;
      sellarTimestamp(viva);
      marcarCambioPendiente();
    }
    cerrar();
    mostrarToast("✓ Competencia renombrada");
    if (refrescar) refrescar();
  });
}

/* ===================== Cambiar apodo propio ===================== */

function abrirModalCambiarApodo(competencia, refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Cambiar mi apodo</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Solo cambia cómo te ven en "${competencia.nombre}". El historial de semanas ya cerradas queda con el apodo que tenías entonces.
      </p>
    </div>
    <div>
      <span class="form-label">Tu apodo</span>
      <input type="text" id="comp-apodo-nuevo" class="form-input" maxlength="30" autocomplete="off" value="${competencia.apodo || ""}">
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-apodo-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="comp-apodo-guardar" style="flex:1;">Guardar</button>
    </div>
  `;
  document.body.appendChild(overlay);
  caja.querySelector("#comp-apodo-cancelar").addEventListener("click", cerrar);

  const btn = caja.querySelector("#comp-apodo-guardar");
  btn.addEventListener("click", async () => {
    const apodo = caja.querySelector("#comp-apodo-nuevo").value.trim();
    if (!apodo) {
      mostrarToast("Poné un apodo");
      return;
    }
    btn.disabled = true;
    btn.textContent = "Guardando…";
    try {
      const respuesta = await fetchConTimeout(
        `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/participantes/${encodeURIComponent(
          competencia.participante_id
        )}/apodo`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identificador_usuario: estado.datos.perfil.correo, apodo }),
        }
      );
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    } catch (e) {
      console.error("[competencias] Falló cambiar el apodo:", e);
      mostrarToast("No se pudo cambiar el apodo. Revisá tu conexión e intentá de nuevo.");
      btn.disabled = false;
      btn.textContent = "Guardar";
      return;
    }

    const viva = estado.datos.competencias_unidas.find((c) => c.id === competencia.id);
    if (viva) {
      viva.apodo = apodo;
      sellarTimestamp(viva);
      marcarCambioPendiente();
    }
    cerrar();
    mostrarToast("✓ Apodo actualizado");
    if (refrescar) refrescar();
  });
}

/* ===================== Finalizar / Reactivar (punto 4.3) ===================== */

function confirmarCambioDeEstado(competencia, estadoNuevo, refrescar) {
  const finalizando = estadoNuevo === "finalizada";
  abrirConfirmacion({
    titulo: finalizando ? "Finalizar competencia" : "Reactivar competencia",
    mensaje: finalizando
      ? `"${competencia.nombre}" deja de contar horas nuevas y pasa al Registro de competencias. No se borra nada y se puede reactivar cuando quieras.`
      : `"${competencia.nombre}" vuelve a contar horas. La semana arranca de cero para todos, el historial viejo queda igual.`,
    textoConfirmar: finalizando ? "Finalizar" : "Reactivar",
    claseConfirmar: finalizando ? "btn-danger" : "btn-primary",
    onConfirmar: () => cambiarEstadoCompetencia(competencia, estadoNuevo, refrescar),
  });
}

async function cambiarEstadoCompetencia(competencia, estadoNuevo, refrescar) {
  const tokenCreador = leerTokenCreador(competencia.id);
  if (!tokenCreador) {
    mostrarToast("No se encontró el permiso de creador en este dispositivo.");
    return;
  }

  try {
    const respuesta = await fetchConTimeout(
      `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/estado`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token_creador: tokenCreador, estado: estadoNuevo }),
      }
    );
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
  } catch (e) {
    console.error("[competencias] Falló cambiar el estado:", e);
    mostrarToast("No se pudo cambiar el estado. Revisá tu conexión e intentá de nuevo.");
    return;
  }

  const viva = estado.datos.competencias_unidas.find((c) => c.id === competencia.id);
  if (viva) {
    viva.estado = estadoNuevo;
    sellarTimestamp(viva);
    marcarCambioPendiente();
  }
  mostrarToast(estadoNuevo === "finalizada" ? "🏁 Competencia finalizada" : "🔄 Competencia reactivada");
  if (refrescar) refrescar();
}

/* ===================== Sacar usuario ===================== */

/**
 * Solo el creador. Usa el MISMO endpoint que "salir"
 * (DELETE /competencias/:id/participantes/:participanteId) — del lado del
 * Worker se amplió para aceptar `token_creador` como autorización
 * alternativa a `identificador_usuario`, así no hay dos rutas que borren
 * participantes (ver manejarSalirCompetencia en el Worker).
 */
async function abrirModalSacarUsuario(competencia, refrescar) {
  const tokenCreador = leerTokenCreador(competencia.id);
  if (!tokenCreador) {
    mostrarToast("No se encontró el permiso de creador en este dispositivo.");
    return;
  }

  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Sacar usuario</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Cargando participantes…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  let participantes = [];
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}`);
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    participantes = (await respuesta.json()).participantes || [];
  } catch (e) {
    console.error("[competencias] Falló cargar participantes:", e);
    caja.innerHTML = `
      <div>
        <h2 style="margin:0;">Sacar usuario</h2>
        <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">No se pudo cargar la lista. Revisá tu conexión.</p>
      </div>
      <button type="button" class="btn btn-secondary" id="comp-sacar-cerrar" style="width:100%;">Cerrar</button>
    `;
    caja.querySelector("#comp-sacar-cerrar").addEventListener("click", cerrar);
    return;
  }

  // Uno mismo nunca aparece en esta lista: para irse está "Salir".
  const otros = participantes.filter((p) => p.id !== competencia.participante_id);
  if (otros.length === 0) {
    caja.innerHTML = `
      <div>
        <h2 style="margin:0;">Sacar usuario</h2>
        <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Sos la única persona en esta competencia.</p>
      </div>
      <button type="button" class="btn btn-secondary" id="comp-sacar-cerrar" style="width:100%;">Cerrar</button>
    `;
    caja.querySelector("#comp-sacar-cerrar").addEventListener("click", cerrar);
    return;
  }

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Sacar usuario</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Quien saques pierde sus horas de la semana en curso. Puede volver a unirse con el link si querés.
      </p>
    </div>
    <div class="stack" style="gap:2px;">
      ${otros
        .map(
          (p, i) => `<label class="row-between" style="padding:4px 0; cursor:pointer;">
          <span><input type="radio" name="comp-sacar-elegido" value="${p.id}" ${i === 0 ? "checked" : ""}> ${p.apodo}</span>
          <span class="muted" style="font-size:0.85rem;">${formatearHoras(p.horas_semana_actual)}</span>
        </label>`
        )
        .join("")}
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-sacar-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-danger" id="comp-sacar-confirmar" style="flex:1;">Sacar</button>
    </div>
  `;
  caja.querySelector("#comp-sacar-cancelar").addEventListener("click", cerrar);

  const btn = caja.querySelector("#comp-sacar-confirmar");
  btn.addEventListener("click", () => {
    const elegido = caja.querySelector('input[name="comp-sacar-elegido"]:checked');
    if (!elegido) {
      mostrarToast("Elegí a alguien primero");
      return;
    }
    const participanteId = elegido.value;
    const apodo = (otros.find((p) => p.id === participanteId) || {}).apodo || "esa persona";

    abrirConfirmacion({
      titulo: "Sacar de la competencia",
      mensaje: `¿Sacar a ${apodo} de "${competencia.nombre}"?`,
      textoConfirmar: "Sacar",
      claseConfirmar: "btn-danger",
      onConfirmar: async () => {
        btn.disabled = true;
        btn.textContent = "Sacando…";
        try {
          const respuesta = await fetchConTimeout(
            `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/participantes/${encodeURIComponent(
              participanteId
            )}`,
            {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token_creador: tokenCreador }),
            }
          );
          if (!respuesta.ok && respuesta.status !== 404) throw new Error(`El Worker respondió ${respuesta.status}`);
        } catch (e) {
          console.error("[competencias] Falló sacar al participante:", e);
          mostrarToast("No se pudo sacar a esa persona. Revisá tu conexión e intentá de nuevo.");
          btn.disabled = false;
          btn.textContent = "Sacar";
          return;
        }
        cerrar();
        mostrarToast(`${apodo} ya no está en la competencia`);
        if (refrescar) refrescar();
      },
    });
  });
}

/* ===================== Registro de competencias (Parte 5) ===================== */

// Colapsada por default (pedido explícito). Módulo-nivel, no persistida —
// mismo criterio que `vistaSeccionTE` en tiempo-estudio.js: es "qué estás
// mirando ahora", no un dato del usuario.
let registroAbierto = false;

/**
 * "Recuperar historial" (2026-09-22) — repuebla `competencias_unidas` con
 * lo que el Worker sabe que sos vos (`GET /identificadores/:correo/
 * competencias`, nuevo endpoint de solo lectura) y que el puntero LOCAL
 * perdió en el camino: una tumba vieja de antes del fix de
 * `podarTumbasSuperadasPorAltas` (2026-09-19), un dispositivo nuevo, o
 * cualquier otro bug de sync — el contenido de una competencia siempre
 * vivió 100% en D1, lo único que puede perderse es el puntero.
 *
 * A propósito es SOLO ADITIVO: agrega lo que el Worker devuelve y que no
 * está ya en la lista local por `id`; nunca pisa ni borra nada existente.
 * No hay forma de distinguir acá "salí a propósito de esta" vs. "se perdió
 * el puntero" (el Worker no guarda eso), así que en teoría una competencia
 * de la que alguien salió hace mucho y cuya tumba ya se purgó podría
 * reaparecer - aceptable para el caso de uso real (grupo de amigos, salir
 * de nuevo es un botón), y muchísimo mejor que perder el historial de
 * verdad. Las recuperadas entran sin `token_creador` (no lo tiene este
 * endpoint) y por lo tanto sin permisos de creador acá — mismo criterio de
 * siempre: el Worker es la autoridad real, esconder botones es comodidad.
 */
async function recuperarCompetenciasPerdidas(refrescar) {
  const correo = estado.datos.perfil && estado.datos.perfil.correo;
  if (!correo) {
    mostrarToast("No se encontró tu correo. Iniciá sesión de nuevo e intentá otra vez.");
    return;
  }

  let datos;
  try {
    const respuesta = await fetchConTimeout(
      `${URL_WORKER_OAUTH}/identificadores/${encodeURIComponent(correo)}/competencias`
    );
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    datos = await respuesta.json();
  } catch (e) {
    console.error("[competencias] Falló recuperar historial:", e);
    mostrarToast("No se pudo buscar el historial. Revisá tu conexión e intentá de nuevo.");
    return;
  }

  const remotas = datos.competencias || [];
  const idsLocales = new Set((estado.datos.competencias_unidas || []).map((c) => c.id));
  const nuevas = remotas.filter((c) => !idsLocales.has(c.id));

  if (nuevas.length === 0) {
    mostrarToast("No había ninguna competencia perdida para recuperar.");
    return;
  }

  nuevas.forEach((c) => {
    estado.datos.competencias_unidas.push(
      sellarTimestamp({
        id: c.id,
        nombre: c.nombre,
        apodo: c.apodo,
        participante_id: c.participante_id,
        estado: c.estado,
        es_creador: false,
        unido_en: Date.now(),
      })
    );
  });
  marcarCambioPendiente();

  mostrarToast(`Se recuperaron ${nuevas.length} competencia${nuevas.length === 1 ? "" : "s"}.`);
  if (refrescar) refrescar();
}

/**
 * Sección "Registro de competencias": una tarjeta chica por cada
 * competencia `finalizada`, con SOLO su nombre. Al tocar una se abre el
 * modal con todas sus semanas y el resumen general
 * (`abrirModalCompetenciaFinalizada`).
 *
 * 2026-09-22: la sección ahora se dibuja SIEMPRE (antes: nada si no había
 * ninguna finalizada localmente). Es la única entrada a "Recuperar
 * historial" - si dependiera de ya tener algo localmente, quien perdió el
 * puntero nunca vería el botón para recuperarlo.
 */
function construirRegistroCompetencias(cont, refrescar) {
  const finalizadas = (estado.datos.competencias_unidas || []).filter((c) => c.estado === "finalizada");

  asegurarEstilosGestion();

  const seccion = document.createElement("div");
  seccion.className = "stack";
  seccion.style.cssText = "gap:8px; margin-top:16px;";

  const cabecera = document.createElement("button");
  cabecera.type = "button";
  cabecera.className = "te-registro-cabecera";
  cabecera.innerHTML = `
    <span style="flex:1; text-align:left; font-weight:600;">Registro de competencias</span>
    <span class="muted" style="font-size:0.8rem;">${finalizadas.length}</span>
    <span class="te-registro-flecha">${registroAbierto ? "▾" : "▸"}</span>
  `;
  cabecera.addEventListener("click", () => {
    registroAbierto = !registroAbierto;
    if (refrescar) refrescar();
  });
  seccion.appendChild(cabecera);

  if (registroAbierto) {
    if (finalizadas.length > 0) {
      const lista = document.createElement("div");
      lista.className = "stack";
      lista.style.gap = "6px";
      finalizadas.forEach((competencia) => {
        const tarjeta = document.createElement("button");
        tarjeta.type = "button";
        tarjeta.className = "te-registro-item";
        tarjeta.innerHTML = `<span style="flex:1; text-align:left;">${competencia.nombre}</span><span class="muted">›</span>`;
        tarjeta.addEventListener("click", () => abrirModalCompetenciaFinalizada(competencia, refrescar));
        lista.appendChild(tarjeta);
      });
      seccion.appendChild(lista);
    } else {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.cssText = "margin:0; font-size:0.85rem;";
      vacio.textContent = "No hay ninguna localmente.";
      seccion.appendChild(vacio);
    }

    const btnRecuperar = document.createElement("button");
    btnRecuperar.type = "button";
    btnRecuperar.className = "te-registro-item";
    btnRecuperar.style.cssText = "justify-content:center; font-size:0.82rem; opacity:0.85;";
    btnRecuperar.innerHTML = `<span>🔄 Recuperar historial</span>`;
    btnRecuperar.addEventListener("click", () => {
      btnRecuperar.disabled = true;
      btnRecuperar.innerHTML = `<span>Buscando…</span>`;
      recuperarCompetenciasPerdidas(refrescar).finally(() => {
        if (btnRecuperar.isConnected) {
          btnRecuperar.disabled = false;
          btnRecuperar.innerHTML = `<span>🔄 Recuperar historial</span>`;
        }
      });
    });
    seccion.appendChild(btnRecuperar);
  }

  cont.appendChild(seccion);
}

/**
 * Ficha completa de una competencia archivada: todas las semanas que tuvo
 * con su ganador, y abajo un resumen general. Un solo viaje al Worker:
 * `GET /competencias/:id/resumen` devuelve nombre + estado + creado_en +
 * historial completo + participantes con sus horas acumuladas de toda la
 * vida de la competencia (`horas_totales_historicas`, columna nueva de
 * esta ronda — ver schema.sql).
 */
async function abrirModalCompetenciaFinalizada(competencia, refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">${competencia.nombre}</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Cargando…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  let datos;
  try {
    const respuesta = await fetchConTimeout(
      `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/resumen`
    );
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    datos = await respuesta.json();
  } catch (e) {
    console.error("[competencias] Falló cargar el resumen:", e);
    caja.innerHTML = `
      <div>
        <h2 style="margin:0;">${competencia.nombre}</h2>
        <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">No se pudo cargar. Revisá tu conexión e intentá de nuevo.</p>
      </div>
      <button type="button" class="btn btn-secondary" id="comp-final-cerrar" style="width:100%;">Cerrar</button>
    `;
    caja.querySelector("#comp-final-cerrar").addEventListener("click", cerrar);
    return;
  }

  const historial = datos.historial || [];
  const participantes = datos.participantes || [];
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">${datos.nombre || competencia.nombre}</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Competencia finalizada · archivada</p>
    </div>
    ${construirHtmlSemanas(historial)}
    ${construirHtmlResumenGeneral(historial, participantes, datos.creado_en)}
    <button type="button" class="btn btn-secondary" id="comp-final-cerrar" style="width:100%;">Cerrar</button>
  `;
  caja.querySelector("#comp-final-cerrar").addEventListener("click", cerrar);
}

function construirHtmlSemanas(historial) {
  if (historial.length === 0) {
    return `<p class="muted" style="margin:0; font-size:0.85rem;">No llegó a cerrarse ninguna semana.</p>`;
  }
  // El Worker devuelve DESC; acá se muestra de la primera a la última,
  // que es cómo se lee una historia.
  const enOrden = [...historial].sort((a, b) => a.semana_cerrada_en - b.semana_cerrada_en);
  const filas = enOrden
    .map((fila, i) => {
      const fecha = new Date(fila.semana_cerrada_en).toLocaleDateString("es", {
        day: "numeric",
        month: "short",
        year: "numeric",
      });
      return `<div class="row-between" style="padding:3px 0;">
        <span><span class="muted" style="font-size:0.8rem;">Semana ${i + 1}</span> · 🏆 ${fila.apodo}</span>
        <span class="muted" style="font-size:0.82rem;">${formatearHoras(fila.horas)} · ${fecha}</span>
      </div>`;
    })
    .join("");

  return `
    <div class="stack" style="gap:2px;">
      <p class="muted" style="margin:0 0 4px; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.03em;">Semanas</p>
      ${filas}
    </div>
  `;
}

/**
 * Resumen general con lo que se puede armar de verdad con los datos que
 * hay guardados: semanas jugadas, quién ganó más (con empate contemplado),
 * horas totales de TODOS los participantes en toda la vida de la
 * competencia, la mejor semana de la historia, y cuánto duró.
 */
function construirHtmlResumenGeneral(historial, participantes, creadoEn) {
  const totalSemanas = historial.length;

  const vecesPorApodo = new Map();
  historial.forEach((fila) => {
    vecesPorApodo.set(fila.apodo, (vecesPorApodo.get(fila.apodo) || 0) + 1);
  });
  let maxVeces = 0;
  vecesPorApodo.forEach((veces) => {
    if (veces > maxVeces) maxVeces = veces;
  });
  const masGanadores = [...vecesPorApodo.entries()].filter(([, veces]) => veces === maxVeces).map(([apodo]) => apodo);

  const horasTotales = participantes.reduce((acc, p) => acc + (Number(p.horas_totales_historicas) || 0), 0);
  const mejorSemana = historial.reduce((mejor, fila) => (!mejor || fila.horas > mejor.horas ? fila : mejor), null);

  const duracionTexto = (() => {
    if (!creadoEn || totalSemanas === 0) return null;
    const ultima = historial.reduce((max, f) => Math.max(max, f.semana_cerrada_en), 0);
    const dias = Math.max(1, Math.round((ultima - creadoEn) / 86400000));
    return `${dias} día${dias === 1 ? "" : "s"}`;
  })();

  const filas = [
    { etiqueta: "Semanas jugadas", valor: String(totalSemanas) },
    totalSemanas > 0
      ? {
          etiqueta: masGanadores.length > 1 ? "Empatados arriba" : "Más semanas ganadas",
          valor: `${masGanadores.join(", ")} (${maxVeces})`,
        }
      : null,
    { etiqueta: "Horas entre todos", valor: formatearHoras(horasTotales) },
    mejorSemana
      ? { etiqueta: "Mejor semana", valor: `${mejorSemana.apodo} · ${formatearHoras(mejorSemana.horas)}` }
      : null,
    { etiqueta: "Participantes", valor: String(participantes.length) },
    duracionTexto ? { etiqueta: "Duró", valor: duracionTexto } : null,
  ].filter(Boolean);

  return `
    <div class="glass-panel stack" style="padding:12px; gap:4px;">
      <p class="muted" style="margin:0 0 4px; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.03em;">Resumen</p>
      ${filas
        .map(
          (f) =>
            `<div class="row-between"><span class="muted" style="font-size:0.85rem;">${f.etiqueta}</span><span style="font-weight:600; font-size:0.88rem;">${f.valor}</span></div>`
        )
        .join("")}
    </div>
  `;
}

/* ===================== Estilos ===================== */

/** Inyectados una sola vez (guard por id), mismo patrón que
 * asegurarEstilosBotonesCompetencia en tiempo-estudio-competencias.js —
 * este grupo de archivos no tiene hoja .css propia. */
function asegurarEstilosGestion() {
  if (document.getElementById("te-estilos-gestion-competencia")) return;
  const estilo = document.createElement("style");
  estilo.id = "te-estilos-gestion-competencia";
  estilo.textContent = `
    .te-opcion-gestion {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 11px 12px;
      border-radius: 10px;
      border: 1px solid var(--borde-sutil, rgba(255,255,255,0.12));
      background: var(--fondo-sutil, rgba(255,255,255,0.05));
      color: inherit;
      font: inherit;
      font-size: 0.9rem;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .te-opcion-gestion:hover { background: var(--fondo-hover, rgba(255,255,255,0.1)); }
    .te-opcion-gestion:active { transform: scale(0.99); }
    .te-opcion-gestion-peligro:hover {
      background: rgba(239,68,68,0.16);
      border-color: rgba(239,68,68,0.45);
    }
    .te-opcion-gestion-emoji { font-size: 1.05rem; line-height: 1; flex: none; }
    .te-registro-cabecera, .te-registro-item {
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--borde-sutil, rgba(255,255,255,0.1));
      background: var(--fondo-sutil, rgba(255,255,255,0.04));
      color: inherit;
      font: inherit;
      cursor: pointer;
    }
    .te-registro-cabecera:hover, .te-registro-item:hover { background: var(--fondo-hover, rgba(255,255,255,0.09)); }
    .te-registro-item { font-size: 0.88rem; }
    .te-registro-flecha { font-size: 0.8rem; opacity: 0.7; }
  `;
  document.head.appendChild(estilo);
}

export { abrirModalGestionCompetencia, construirRegistroCompetencias };
