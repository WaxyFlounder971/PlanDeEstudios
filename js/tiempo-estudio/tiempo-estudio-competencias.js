/* =========================================================================
   TIEMPO DE ESTUDIO — Competencias (Parte 1 + Parte 2)
   -------------------------------------------------------------------------
   2026-09-09: contrato reescrito de cero contra el Worker REAL
   (worker-notificaciones-agenda/src/index.js, "Competencias — Parte 4/4
   del spec de Tiempo de Estudio", ya desplegado con 3 tablas D1 y cron de
   cierre semanal) — la versión anterior de este archivo había ADIVINADO
   un contrato distinto (POST /competencias/crear con Bearer token) antes
   de que el Worker existiera. Diferencias clave con lo adivinado:
     - Sin Authorization: Bearer — el Worker no valida el access_token de
       Google en absoluto, solo el Origin (CORS gate). La "identidad" que
       usa para todo es `identificador_usuario` (el correo de Google,
       `estado.datos.perfil.correo`) viajando en el BODY de cada request.
     - Rutas y campos en snake_case tal cual la tabla D1: `token_creador`,
       `participante_id`, `horas_semana_actual`, `offset_minutos_utc`.
     - POST /competencias/:id/unirse NO devuelve `nombre` — hay que pedirlo
       aparte con GET /competencias/:id.
     - Una competencia es sobre horas TOTALES de la semana (todas las
       materias juntas), no una materia puntual — ver
       `sincronizarHorasCompetencias()` más abajo.
     - El corte semanal lo cierra el propio Worker con un cron por hora,
       anclado a la hora local del CREADOR (`offset_minutos_utc` que se
       manda al crear) — el cliente nunca resetea nada, solo lee/escribe
       `horas_semana_actual` tal cual está en cada momento.

   Sigue siendo Parte 1 (crear/unirse/ver lista/copiar invitación/salir) +
   ahora también Parte 2 (marcador en vivo vía GET, salón de la fama vía
   GET /historial, y el envío de horas vía POST /actualizar-horas después
   de cada sesión).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";
import { mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import { copiarAlPortapapelesBlindado, abrirModalCopiaManualPortapapeles } from "../core/clipboard.js";
import { calcularMinutosTotalesEnRango, obtenerRangoSemana } from "./tiempo-estudio-estadisticas.js";

const TIMEOUT_MS = 12000;
const CLAVE_TOKEN_CREADOR_PREFIJO = "tokenCreadorCompetencia_"; // + id, ver nota en schema.js

/** Mismo blindaje de timeout que ya usa core/auth.js (`fetchConTimeout`,
 * privada allá) — se duplica acá por el mismo motivo que URL_WORKER_OAUTH
 * se exportó: no vale la pena tocar el export list de auth.js por una
 * función interna de 10 líneas. */
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

/**
 * El Worker espera `offset_minutos_utc` = local menos UTC en minutos
 * (offset > 0 = adelantado respecto a UTC — ver calcularUltimoLunesLocalUtcMs
 * en index.js). `Date.prototype.getTimezoneOffset()` de JS usa la
 * convención EXACTAMENTE opuesta (UTC menos local), de ahí el signo
 * invertido acá.
 */
function obtenerOffsetMinutosUtc() {
  return -new Date().getTimezoneOffset();
}

function formatearHoras(horas) {
  const totalMin = Math.max(0, Math.round((Number(horas) || 0) * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

function guardarTokenCreador(competenciaId, tokenCreador) {
  try {
    localStorage.setItem(CLAVE_TOKEN_CREADOR_PREFIJO + competenciaId, tokenCreador);
  } catch (e) {
    // localStorage puede fallar en modo privado agresivo de algunos
    // navegadores — no crítico para poder participar, solo afecta poder
    // borrar la competencia entera más adelante desde ESTE dispositivo.
    console.warn("[competencias] No se pudo guardar el token de creador:", e);
  }
}

function leerTokenCreador(competenciaId) {
  try {
    return localStorage.getItem(CLAVE_TOKEN_CREADOR_PREFIJO + competenciaId);
  } catch (e) {
    return null;
  }
}

function construirLinkInvitacion(competenciaId) {
  const url = new URL(location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("comp", competenciaId);
  return url.toString();
}

/** Acepta tanto un link completo (con "?comp=<id>") como el id pelado. */
function extraerIdCompetenciaDeTexto(texto) {
  const limpio = String(texto || "").trim();
  if (!limpio) return null;
  try {
    const url = new URL(limpio);
    const id = url.searchParams.get("comp");
    if (id) return id;
  } catch (e) {
    // no era una URL válida — se interpreta como id pelado
  }
  return limpio;
}

async function copiarLinkInvitacion(competencia) {
  const link = construirLinkInvitacion(competencia.id);
  const exito = await copiarAlPortapapelesBlindado(link);
  if (exito) mostrarToast("✓ Link de invitación copiado");
  else abrirModalCopiaManualPortapapeles(link);
}

/**
 * Envía a cada competencia unida el total de horas estudiadas ESTA semana
 * (todas las materias juntas — una competencia es sobre horas totales,
 * no una materia puntual, ver `calcularMinutosTotalesEnRango` en
 * tiempo-estudio-estadisticas.js). Llamar después de crear, editar o
 * borrar cualquier sesión — ver los 6 puntos que la llaman en
 * tiempo-estudio-timer.js y tiempo-estudio-registro.js.
 *
 * Best-effort A PROPÓSITO (mismo criterio que documenta el propio Worker
 * en `manejarActualizarHoras`): nunca bloquea al usuario ni muestra un
 * error si falla, y manda el TOTAL recalculado (no un delta) — así, si
 * una llamada se pierde por un corte de red puntual, la siguiente sesión
 * guardada autocorrige el número sola, sin necesidad de reintentar acá.
 */
async function sincronizarHorasCompetencias() {
  const competencias = estado.datos.competencias_unidas;
  if (!competencias || competencias.length === 0) return;

  const { inicio, fin } = obtenerRangoSemana(0);
  const horas = calcularMinutosTotalesEnRango(inicio, fin) / 60;
  const identificador_usuario = estado.datos.perfil.correo;

  await Promise.all(
    competencias.map(async (competencia) => {
      try {
        const respuesta = await fetchConTimeout(
          `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/actualizar-horas`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identificador_usuario, horas_semana_actual: horas }),
          }
        );
        if (!respuesta.ok) {
          console.warn(`[competencias] actualizar-horas respondió ${respuesta.status} para "${competencia.nombre}" — se autocorrige con la próxima sesión.`);
        }
      } catch (e) {
        console.warn(`[competencias] Falló actualizar-horas para "${competencia.nombre}" — se autocorrige con la próxima sesión:`, e);
      }
    })
  );
}

function salirDeCompetencia(competencia, refrescar) {
  abrirConfirmacion({
    titulo: "Salir de la competencia",
    mensaje: competencia.es_creador
      ? `¿Salir de "${competencia.nombre}"? Vos la creaste — esto NO la borra para los demás participantes, solo te saca a vos. Si querés borrarla entera para todos, usá "Borrar para todos".`
      : `¿Salir de "${competencia.nombre}"? Podés volver a unirte más tarde con el mismo link.`,
    textoConfirmar: "Salir",
    claseConfirmar: "btn-danger",
    onConfirmar: async () => {
      try {
        const respuesta = await fetchConTimeout(
          `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/participantes/${encodeURIComponent(competencia.participante_id)}`,
          {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ identificador_usuario: estado.datos.perfil.correo }),
          }
        );
        if (!respuesta.ok && respuesta.status !== 404) {
          // 404 = el Worker ya no lo tiene como participante por lo que
          // sea (ej. ya se había salido desde otro dispositivo) — igual
          // se saca de la lista local, no tiene sentido bloquear por eso.
          throw new Error(`El Worker respondió ${respuesta.status}`);
        }
      } catch (e) {
        console.warn("[competencias] No se pudo avisarle al Worker de la salida (se saca igual de la lista local):", e);
      }

      const idx = estado.datos.competencias_unidas.findIndex((c) => c.id === competencia.id);
      if (idx !== -1) estado.datos.competencias_unidas.splice(idx, 1);
      // Tumba (regla obligatoria de sync, ver MAPA_FUNCIONES.md "Borrado =
      // tumba"): {id, eliminadoEn}, nunca el id pelado (ver el bug de
      // 2026-09-08 en tiempo-estudio-registro.js).
      estado.datos._eliminados_competencias_unidas.push({ id: competencia.id, eliminadoEn: Date.now() });
      marcarCambioPendiente();
      mostrarToast("Saliste de la competencia");
      if (refrescar) refrescar();
    },
  });
}

/**
 * Solo para `es_creador` — borra la competencia ENTERA del lado del
 * Worker (todos los participantes, todo el historial) usando el
 * `token_creador` guardado en localStorage. Si ese token se perdió en
 * este dispositivo (ej. se limpió el storage del navegador), no hay forma
 * de recuperarlo — el Worker nunca lo vuelve a exponer después de crearla.
 */
function borrarCompetenciaEntera(competencia, refrescar) {
  const tokenCreador = leerTokenCreador(competencia.id);
  if (!tokenCreador) {
    mostrarToast("No se encontró el permiso de borrado en este dispositivo — probá salir en vez de borrar.");
    return;
  }

  abrirConfirmacion({
    titulo: "Borrar competencia para todos",
    mensaje: `¿Borrar "${competencia.nombre}" para TODOS los participantes? Se pierde el historial de ganadores. No se puede deshacer.`,
    textoConfirmar: "Borrar para todos",
    claseConfirmar: "btn-danger",
    onConfirmar: async () => {
      try {
        const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_creador: tokenCreador }),
        });
        if (!respuesta.ok && respuesta.status !== 404) throw new Error(`El Worker respondió ${respuesta.status}`);
      } catch (e) {
        console.error("[competencias] Falló borrar la competencia:", e);
        mostrarToast("No se pudo borrar la competencia. Revisá tu conexión e intentá de nuevo.");
        return;
      }

      const idx = estado.datos.competencias_unidas.findIndex((c) => c.id === competencia.id);
      if (idx !== -1) estado.datos.competencias_unidas.splice(idx, 1);
      estado.datos._eliminados_competencias_unidas.push({ id: competencia.id, eliminadoEn: Date.now() });
      marcarCambioPendiente();
      mostrarToast("Competencia borrada");
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

/** Modal "Crear competencia": nombre + apodo → POST /competencias. */
function abrirModalCrearCompetencia(refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Crear competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Vos y quien invites compiten por horas de estudio de la semana.
        Podés invitar gente después copiando el link.
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
      const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre,
          apodo,
          identificador_usuario: estado.datos.perfil.correo,
          offset_minutos_utc: obtenerOffsetMinutosUtc(),
        }),
      });
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
      const datos = await respuesta.json(); // { id, token_creador, participante_id }

      const entrada = sellarTimestamp({
        id: datos.id,
        participante_id: datos.participante_id,
        apodo,
        nombre,
        es_creador: true,
      });
      estado.datos.competencias_unidas.push(entrada);
      guardarTokenCreador(datos.id, datos.token_creador);
      marcarCambioPendiente();

      cerrar();
      mostrarToast("✓ Competencia creada");
      if (refrescar) refrescar();
      copiarLinkInvitacion(entrada);
      sincronizarHorasCompetencias(); // por si ya venía estudiando esta semana antes de crearla
    } catch (e) {
      console.error("[competencias] Falló crear competencia:", e);
      mostrarToast("No se pudo crear la competencia. Revisá tu conexión e intentá de nuevo.");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Crear";
    }
  });
}

/**
 * Modal "Unirse a competencia": pega un link (o el id pelado) + apodo →
 * POST /competencias/:id/unirse. Esa respuesta NO trae el nombre (ver
 * contrato real arriba) — se pide aparte con un GET antes de cerrar el
 * modal, así la tarjeta ya aparece con el nombre real desde el vamos.
 */
function abrirModalUnirseCompetencia(refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Unirse a una competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Pegá el link (o el código) que te compartieron.</p>
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
      const respuestaUnirse = await fetchConTimeout(
        `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(idCompetencia)}/unirse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apodo,
            identificador_usuario: estado.datos.perfil.correo,
            offset_minutos_utc: obtenerOffsetMinutosUtc(),
          }),
        }
      );
      if (respuestaUnirse.status === 404) throw new Error("Esa competencia no existe (¿el link está completo?)");
      if (respuestaUnirse.status === 409) throw new Error("Ya sos parte de esta competencia (desde otro dispositivo).");
      if (!respuestaUnirse.ok) throw new Error(`El Worker respondió ${respuestaUnirse.status}`);
      const { participante_id } = await respuestaUnirse.json();

      // El nombre real no vino en la respuesta de /unirse — se pide aparte.
      let nombre = "(competencia)";
      try {
        const respuestaGet = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(idCompetencia)}`);
        if (respuestaGet.ok) nombre = (await respuestaGet.json()).nombre;
      } catch (e) {
        console.warn("[competencias] Te uniste bien pero no se pudo traer el nombre todavía:", e);
      }

      estado.datos.competencias_unidas.push(
        sellarTimestamp({ id: idCompetencia, participante_id, apodo, nombre, es_creador: false })
      );
      marcarCambioPendiente();

      cerrar();
      mostrarToast(`✓ Te uniste a "${nombre}"`);
      if (refrescar) refrescar();
      sincronizarHorasCompetencias(); // por si ya venía estudiando esta semana antes de unirse
    } catch (e) {
      console.error("[competencias] Falló unirse a competencia:", e);
      mostrarToast(e.message || "No se pudo unir a la competencia.");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Unirme";
    }
  });
}

/** Modal "Salón de la fama": GET /competencias/:id/historial. */
async function abrirModalHistorial(competencia) {
  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">🏆 Historial — ${competencia.nombre}</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Ganador de cada semana cerrada, más reciente primero.</p>
    </div>
    <div id="comp-historial-lista" class="stack" style="gap:8px;"><p class="muted">Cargando…</p></div>
    <button type="button" class="btn btn-secondary" id="comp-historial-cerrar">Cerrar</button>
  `;
  document.body.appendChild(overlay);
  caja.querySelector("#comp-historial-cerrar").addEventListener("click", cerrar);

  const cont = caja.querySelector("#comp-historial-lista");
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/historial`);
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    const { historial } = await respuesta.json();
    cont.innerHTML = "";
    if (!historial || historial.length === 0) {
      cont.innerHTML = `<p class="muted">Todavía no se cerró ninguna semana.</p>`;
      return;
    }
    historial.forEach((fila) => {
      const item = document.createElement("div");
      item.className = "row-between";
      const fecha = new Date(fila.semana_cerrada_en).toLocaleDateString("es", { day: "numeric", month: "short", year: "numeric" });
      item.innerHTML = `<span>🏆 ${fila.apodo}</span><span class="muted" style="font-size:0.85rem;">${formatearHoras(fila.horas)} · ${fecha}</span>`;
      cont.appendChild(item);
    });
  } catch (e) {
    console.error("[competencias] Falló cargar el historial:", e);
    cont.innerHTML = `<p class="muted">No se pudo cargar el historial. Revisá tu conexión.</p>`;
  }
}

/**
 * Carga el marcador en vivo (GET /competencias/:id) DENTRO de la tarjeta
 * ya pintada — se llama después de armar el DOM sincrónico de cada
 * tarjeta, para no bloquear el render de toda la lista esperando a las N
 * competencias a la vez (cada una carga a su propio ritmo).
 */
async function cargarMarcadorEnTarjeta(competencia, contMarcador) {
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}`);
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    const datos = await respuesta.json(); // { id, nombre, participantes: [{id, apodo, horas_semana_actual}] }

    contMarcador.innerHTML = "";
    (datos.participantes || []).forEach((p, i) => {
      const esYo = p.id === competencia.participante_id;
      const fila = document.createElement("div");
      fila.className = "row-between";
      fila.style.cssText = `padding:4px 0;${esYo ? " font-weight:600;" : ""}`;
      const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
      fila.innerHTML = `<span>${medalla} ${p.apodo}${esYo ? " (vos)" : ""}</span><span>${formatearHoras(p.horas_semana_actual)}</span>`;
      contMarcador.appendChild(fila);
    });
  } catch (e) {
    console.error("[competencias] Falló cargar el marcador:", e);
    contMarcador.innerHTML = `<p class="muted" style="margin:0; font-size:0.82rem;">No se pudo cargar el marcador. Revisá tu conexión.</p>`;
  }
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
    tarjeta.style.cssText = "padding:14px 16px; display:flex; flex-direction:column; gap:10px;";

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

    const contMarcador = document.createElement("div");
    contMarcador.className = "stack";
    contMarcador.style.cssText = "gap:2px; border-top:1px solid var(--borde-sutil, rgba(255,255,255,0.08)); padding-top:8px;";
    contMarcador.innerHTML = `<p class="muted" style="margin:0; font-size:0.82rem;">Cargando marcador…</p>`;
    tarjeta.appendChild(contMarcador);
    cargarMarcadorEnTarjeta(competencia, contMarcador);

    const filaBotones = document.createElement("div");
    filaBotones.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";

    const btnCopiar = document.createElement("button");
    btnCopiar.type = "button";
    btnCopiar.className = "btn btn-secondary";
    btnCopiar.style.flex = "1";
    btnCopiar.textContent = "Copiar invitación";
    btnCopiar.addEventListener("click", () => copiarLinkInvitacion(competencia));
    filaBotones.appendChild(btnCopiar);

    const btnHistorial = document.createElement("button");
    btnHistorial.type = "button";
    btnHistorial.className = "te-btn-icono te-btn-icono-fantasma";
    btnHistorial.title = "Ver historial de ganadores";
    btnHistorial.setAttribute("aria-label", "Ver historial de ganadores");
    btnHistorial.textContent = "🏆";
    btnHistorial.addEventListener("click", () => abrirModalHistorial(competencia));
    filaBotones.appendChild(btnHistorial);

    if (competencia.es_creador) {
      const btnBorrar = document.createElement("button");
      btnBorrar.type = "button";
      btnBorrar.className = "te-btn-icono te-btn-icono-fantasma";
      btnBorrar.title = "Borrar para todos";
      btnBorrar.setAttribute("aria-label", "Borrar competencia para todos");
      btnBorrar.textContent = "💥";
      btnBorrar.addEventListener("click", () => borrarCompetenciaEntera(competencia, refrescar));
      filaBotones.appendChild(btnBorrar);
    }

    const btnSalir = document.createElement("button");
    btnSalir.type = "button";
    btnSalir.className = "te-btn-icono te-btn-icono-fantasma";
    btnSalir.title = "Salir";
    btnSalir.setAttribute("aria-label", "Salir de esta competencia");
    btnSalir.textContent = "🚪";
    btnSalir.addEventListener("click", () => salirDeCompetencia(competencia, refrescar));
    filaBotones.appendChild(btnSalir);

    tarjeta.appendChild(filaBotones);
    lista.appendChild(tarjeta);
  });

  cont.appendChild(lista);
}

export { construirVistaCompetencias, sincronizarHorasCompetencias };
