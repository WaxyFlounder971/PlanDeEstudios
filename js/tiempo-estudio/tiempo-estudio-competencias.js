/* =========================================================================
   TIEMPO DE ESTUDIO — Competencias (Parte 1)
   -------------------------------------------------------------------------
   Una "competencia" es un grupo de horas-de-estudio compartido entre
   varias personas (no necesariamente "amigos" en el sentido de Drive) —
   vive del lado del Worker (`worker-notificaciones-agenda`), NO en el
   Drive de cada usuario. Esta app es la que crea/consulta esa competencia
   vía HTTP; lo único que persiste localmente (y sincroniza por Drive,
   como el resto de estado.datos) es la LISTA de a qué competencias este
   usuario está unido — ver `competencias_unidas` en core/schema.js.

   ALCANCE DE ESTA PARTE (1/2): crear una competencia, unirse a una vía
   link/código, ver la lista de las que ya te uniste, copiar el link de
   invitación. Lo que queda para la Parte 2: la tabla de posiciones en sí
   (GET horas normalizadas por semana de cada participante) y el envío
   periódico de horas trabajadas (POST /competencias/:id/actualizar-horas,
   que dispararía cada vez que se guarda una sesión — mismo punto donde hoy
   se llama revisarFelicitacionMeta() en tiempo-estudio-timer.js/
   tiempo-estudio-registro.js).

   ⚠️ CONTRATO CON EL WORKER — TODAVÍA NO EXISTE DEL LADO SERVIDOR:
   `worker-notificaciones-agenda` hoy (ver core/auth.js) solo tiene
   `/oauth/exchange` y `/oauth/refresh`. Las 2 rutas que este archivo
   necesita son nuevas y hay que agregarlas en ESE proyecto (repo aparte,
   no incluido acá) antes de que "Crear"/"Unirse" funcionen de verdad:

   POST /competencias/crear
     body:     { nombre, apodo, correo }
     response: { id, tokenCreador, participanteId }
     201 si se creó bien. `tokenCreador` es un secreto de un solo uso que
     el cliente guarda en localStorage (nunca en estado.datos — ver
     comentario de competencias_unidas en schema.js) para poder borrar la
     competencia entera más adelante (Parte 2).

   POST /competencias/:id/unirse
     body:     { apodo, correo }
     response: { participanteId, nombre }
     200 si se unió bien, 404 si el id no existe. `nombre` en la respuesta
     es el nombre real de la competencia (el que puso quien la creó) — el
     cliente nunca lo inventa, lo pide.

   Ambas rutas van con header `Authorization: Bearer <estado.token>` —
   mismo access_token de Google que ya usa el resto de la app (no hace
   falta un login separado); el Worker lo valida contra la misma cuenta.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";
import { mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import { copiarAlPortapapelesBlindado, abrirModalCopiaManualPortapapeles } from "../core/clipboard.js";

const TIMEOUT_MS = 12000;
const CLAVE_TOKEN_CREADOR_PREFIJO = "tokenCreadorCompetencia_"; // + id, ver nota en schema.js

/**
 * Mismo blindaje de timeout que ya usa core/auth.js (`fetchConTimeout`,
 * privada allá) — un `fetch()` sin timeout que se cuelga deja a la persona
 * mirando un botón "Creando..." para siempre si el Worker no responde. Se
 * duplica acá en vez de importar la versión privada de auth.js (no está
 * exportada, y agregarla a su export list para una sola función interna no
 * vale la pena — mismo criterio que URL_WORKER_OAUTH, que si se exportó,
 * porque a esa sí la necesitan 2 archivos distintos con el mismo literal).
 */
async function fetchConTimeout(url, opciones = {}) {
  const controlador = new AbortController();
  const idTimeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`El Worker no respondió en ${TIMEOUT_MS / 1000}s (timeout).`);
    }
    throw e;
  } finally {
    clearTimeout(idTimeout);
  }
}

function guardarTokenCreador(competenciaId, token) {
  try {
    localStorage.setItem(CLAVE_TOKEN_CREADOR_PREFIJO + competenciaId, token);
  } catch (e) {
    // localStorage puede fallar en modo privado agresivo de algunos
    // navegadores — no es crítico para Parte 1 (solo afecta poder borrar
    // la competencia más adelante, Parte 2), así que no se interrumpe el
    // flujo de creación por esto.
    console.warn("[competencias] No se pudo guardar el token de creador:", e);
  }
}

function construirLinkInvitacion(competenciaId) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("comp", competenciaId);
  return url.toString();
}

/**
 * Acepta tanto un link completo (con "?comp=<id>") como el id pelado —
 * la persona puede pegar cualquiera de los dos en el modal de "Unirse".
 */
function extraerIdCompetenciaDeTexto(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return null;
  try {
    const url = new URL(limpio);
    const id = url.searchParams.get("comp");
    if (id) return id;
  } catch (e) {
    // no era una URL válida — se interpreta como id pelado, sigue abajo
  }
  return limpio;
}

/**
 * Copia el link de invitación con el mismo blindaje de 2 capas que ya usa
 * el flujo "Enviar a Claude" (core/clipboard.js): si falla la copia
 * automática por cualquier motivo, abre el modal de copia manual en vez
 * de dejar a la persona sin ninguna pista.
 */
async function copiarLinkInvitacion(competencia) {
  const link = construirLinkInvitacion(competencia.id);
  const exito = await copiarAlPortapapelesBlindado(link);
  if (exito) {
    mostrarToast("✓ Link de invitación copiado");
  } else {
    abrirModalCopiaManualPortapapeles(link);
  }
}

/**
 * Deja de ver esta competencia en ESTE dispositivo (y, tras sincronizar,
 * en todos los del usuario) — NO borra la competencia del lado del Worker
 * ni afecta a los demás participantes. Borrar la competencia entera es
 * Parte 2 (necesita el tokenCreador y solo lo puede hacer quien la creó).
 */
function salirDeCompetencia(competencia, refrescar) {
  abrirConfirmacion({
    titulo: "Dejar de ver esta competencia",
    mensaje: competencia.es_creador
      ? `¿Dejar de ver "${competencia.nombre}" en este dispositivo? Vos la creaste — esto NO la borra para los demás participantes, solo deja de aparecer acá.`
      : `¿Dejar de ver "${competencia.nombre}" en este dispositivo? Podés volver a unirte más tarde con el mismo link.`,
    textoConfirmar: "Dejar de ver",
    claseConfirmar: "btn-danger",
    onConfirmar: () => {
      const idx = estado.datos.competencias_unidas.findIndex((c) => c.id === competencia.id);
      if (idx !== -1) estado.datos.competencias_unidas.splice(idx, 1);
      // Tumba (regla obligatoria de sync, ver MAPA_FUNCIONES.md "Borrado =
      // tumba" — y el bug de 2026-09-08 en tiempo-estudio-registro.js que
      // costó un round de debugging entero por empujar el id pelado en vez
      // de este objeto: {id, eliminadoEn} es la forma correcta, siempre).
      estado.datos._eliminados_competencias_unidas.push({ id: competencia.id, eliminadoEn: Date.now() });
      marcarCambioPendiente();
      mostrarToast("Competencia ocultada");
      if (refrescar) refrescar();
    },
  });
}

function construirCajaModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:440px; width:100%; max-height:85vh; overflow-y:auto; gap:16px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  overlay.appendChild(caja);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  return { overlay, caja, cerrar };
}

/**
 * Modal "Crear competencia": nombre + tu apodo → POST /competencias/crear.
 * Al terminar bien, ofrece copiar el link de invitación de una — no tiene
 * sentido crear una competencia y no invitar a nadie.
 */
function abrirModalCrearCompetencia(refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Crear competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Vos y quien invites compiten por horas de estudio. Podés invitar
        gente después copiando el link.
      </p>
    </div>
    <div>
      <span class="form-label">Nombre de la competencia</span>
      <input type="text" id="comp-crear-nombre" class="form-input" placeholder="Ej. Parciales de setiembre" maxlength="60">
    </div>
    <div>
      <span class="form-label">Tu apodo (así te van a ver los demás)</span>
      <input type="text" id="comp-crear-apodo" class="form-input" placeholder="Ej. Wagner" maxlength="30">
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-crear-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="comp-crear-guardar" style="flex:1;">Crear</button>
    </div>
  `;

  document.body.appendChild(overlay);
  caja.querySelector("#comp-crear-cancelar").addEventListener("click", cerrar);

  const btnGuardar = caja.querySelector("#comp-crear-guardar");
  btnGuardar.addEventListener("click", async () => {
    const nombre = caja.querySelector("#comp-crear-nombre").value.trim();
    const apodo = caja.querySelector("#comp-crear-apodo").value.trim();
    if (!nombre || !apodo) {
      mostrarToast("Completá nombre y apodo");
      return;
    }

    btnGuardar.disabled = true;
    btnGuardar.textContent = "Creando…";
    try {
      const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/crear`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${estado.token}`,
        },
        body: JSON.stringify({ nombre, apodo, correo: estado.datos.perfil.correo }),
      });
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
      const datos = await respuesta.json();

      const entrada = sellarTimestamp({
        id: datos.id,
        participante_id: datos.participanteId,
        apodo,
        nombre,
        es_creador: true,
      });
      estado.datos.competencias_unidas.push(entrada);
      guardarTokenCreador(datos.id, datos.tokenCreador);
      marcarCambioPendiente();

      cerrar();
      mostrarToast("✓ Competencia creada");
      if (refrescar) refrescar();
      copiarLinkInvitacion(entrada);
    } catch (e) {
      console.error("[competencias] Falló crear competencia:", e);
      mostrarToast("No se pudo crear la competencia. Revisá tu conexión e intentá de nuevo.");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Crear";
    }
  });
}

/**
 * Modal "Unirse a competencia": pega un link (o el id pelado) + tu apodo
 * → POST /competencias/:id/unirse. El nombre de la competencia lo devuelve
 * el Worker — nunca se inventa del lado del cliente.
 */
function abrirModalUnirseCompetencia(refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Unirse a una competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Pegá el link (o el código) que te compartieron.
      </p>
    </div>
    <div>
      <span class="form-label">Link o código de invitación</span>
      <input type="text" id="comp-unirse-link" class="form-input" placeholder="Pegá acá el link">
    </div>
    <div>
      <span class="form-label">Tu apodo (así te van a ver los demás)</span>
      <input type="text" id="comp-unirse-apodo" class="form-input" placeholder="Ej. Wagner" maxlength="30">
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-unirse-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="comp-unirse-guardar" style="flex:1;">Unirme</button>
    </div>
  `;

  document.body.appendChild(overlay);
  caja.querySelector("#comp-unirse-cancelar").addEventListener("click", cerrar);

  const btnGuardar = caja.querySelector("#comp-unirse-guardar");
  btnGuardar.addEventListener("click", async () => {
    const idCompetencia = extraerIdCompetenciaDeTexto(caja.querySelector("#comp-unirse-link").value);
    const apodo = caja.querySelector("#comp-unirse-apodo").value.trim();
    if (!idCompetencia || !apodo) {
      mostrarToast("Completá el link/código y tu apodo");
      return;
    }
    if (estado.datos.competencias_unidas.some((c) => c.id === idCompetencia)) {
      mostrarToast("Ya estás en esta competencia");
      return;
    }

    btnGuardar.disabled = true;
    btnGuardar.textContent = "Uniéndote…";
    try {
      const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(idCompetencia)}/unirse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${estado.token}`,
        },
        body: JSON.stringify({ apodo, correo: estado.datos.perfil.correo }),
      });
      if (respuesta.status === 404) throw new Error("Esa competencia no existe (¿el link está completo?)");
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
      const datos = await respuesta.json();

      estado.datos.competencias_unidas.push(
        sellarTimestamp({
          id: idCompetencia,
          participante_id: datos.participanteId,
          apodo,
          nombre: datos.nombre,
          es_creador: false,
        })
      );
      marcarCambioPendiente();

      cerrar();
      mostrarToast(`✓ Te uniste a "${datos.nombre}"`);
      if (refrescar) refrescar();
    } catch (e) {
      console.error("[competencias] Falló unirse a competencia:", e);
      mostrarToast(e.message || "No se pudo unir a la competencia.");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Unirme";
    }
  });
}

/**
 * Punto de entrada — llamado desde tiempo-estudio.js cuando el pill
 * superior está en "Competencias". `refrescar` es el mismo callback sin
 * argumentos (`renderizarTiempoEstudio`) que ya usan Materias/Estadísticas.
 */
function construirVistaCompetencias(cont, refrescar) {
  const encabezado = document.createElement("div");
  encabezado.className = "row-between";
  encabezado.style.cssText = "align-items:center; margin-bottom:12px;";
  encabezado.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Competencias</h3>`;

  const botones = document.createElement("div");
  botones.style.cssText = "display:flex; gap:8px;";
  const btnUnirse = document.createElement("button");
  btnUnirse.type = "button";
  btnUnirse.className = "btn btn-secondary";
  btnUnirse.textContent = "Unirse";
  btnUnirse.addEventListener("click", () => abrirModalUnirseCompetencia(refrescar));
  const btnCrear = document.createElement("button");
  btnCrear.type = "button";
  btnCrear.className = "btn btn-primary";
  btnCrear.textContent = "+ Crear";
  btnCrear.addEventListener("click", () => abrirModalCrearCompetencia(refrescar));
  botones.appendChild(btnUnirse);
  botones.appendChild(btnCrear);
  encabezado.appendChild(botones);
  cont.appendChild(encabezado);

  const competencias = estado.datos.competencias_unidas;
  if (competencias.length === 0) {
    const vacio = document.createElement("div");
    vacio.className = "glass-card stack";
    vacio.style.cssText = "text-align:center; padding:24px 16px;";
    vacio.innerHTML = `
      <p class="muted" style="margin:0;">Todavía no te uniste a ninguna competencia.</p>
      <p class="muted" style="margin:0; font-size:0.82rem;">Creá una y compartí el link, o unite con uno que te pasen.</p>
    `;
    cont.appendChild(vacio);
    return;
  }

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "10px";

  competencias.forEach((competencia) => {
    const tarjeta = document.createElement("div");
    tarjeta.className = "glass-card";
    tarjeta.style.cssText = "padding:14px 16px; display:flex; flex-direction:column; gap:8px;";

    const fila = document.createElement("div");
    fila.className = "row-between";
    fila.style.alignItems = "center";
    fila.innerHTML = `
      <div>
        <p style="margin:0; font-weight:600;">${competencia.nombre}${competencia.es_creador ? " 👑" : ""}</p>
        <p class="muted" style="margin:2px 0 0; font-size:0.8rem;">Tu apodo ahí: ${competencia.apodo}</p>
      </div>
    `;
    tarjeta.appendChild(fila);

    // Tabla de posiciones en sí — Parte 2 (necesita GET al Worker con las
    // horas normalizadas de cada participante). Por ahora la tarjeta solo
    // confirma que estás adentro y deja copiar/salir.
    const filaBotones = document.createElement("div");
    filaBotones.style.cssText = "display:flex; gap:8px;";
    const btnCopiar = document.createElement("button");
    btnCopiar.type = "button";
    btnCopiar.className = "btn btn-secondary";
    btnCopiar.style.flex = "1";
    btnCopiar.textContent = "Copiar invitación";
    btnCopiar.addEventListener("click", () => copiarLinkInvitacion(competencia));
    const btnSalir = document.createElement("button");
    btnSalir.type = "button";
    btnSalir.className = "te-btn-icono te-btn-icono-fantasma";
    btnSalir.title = "Dejar de ver";
    btnSalir.setAttribute("aria-label", "Dejar de ver esta competencia");
    btnSalir.textContent = "🗑️";
    btnSalir.addEventListener("click", () => salirDeCompetencia(competencia, refrescar));
    filaBotones.appendChild(btnCopiar);
    filaBotones.appendChild(btnSalir);
    tarjeta.appendChild(filaBotones);

    lista.appendChild(tarjeta);
  });

  cont.appendChild(lista);
}

export { construirVistaCompetencias };
