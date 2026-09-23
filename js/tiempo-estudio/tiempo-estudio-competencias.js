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

   2026-09-21 — REDISEÑO VISUAL (prototipo-competencias-v2.html):
     - La tarjeta ahora es marcador con podio/lista (selector arriba a la
       derecha, la elección se recuerda), avatares con la foto de Google y
       dos íconos en la cabecera: trofeo → Historial (podio de cada semana
       cerrada, desde GET /competencias/:id/podios) y engranaje → Gestionar.
     - El botón "Enlace" salió de la tarjeta: la invitación vive ahora
       arriba de todo en el menú Gestionar (tiempo-estudio-competencias-
       gestion.js).
     - Foto: se manda `foto_url` (la de `estado.datos.perfil`) al crear y al
       unirse, y si cambia se refresca sola con POST .../participantes/:id/
       foto y color (ver `sincronizarPerfilPropio`). Sin foto → inicial de color.
     - Color: el color de acento de la paleta de cada usuario (`--accent-1`)
       pinta su pedestal, su aro y su barra en el podio de todos.

   2026-09-22 — FIX pedido por el dueño del proyecto: `obtenerMiColor()`
   mandaba SIEMPRE el `--accent-1` computado, incluso cuando esa persona
   nunca tocó nada y sigue con la paleta default de la app (que es
   justamente el mismo violeta `#6c5cf0` que ya usan como "color de marca"
   .cp-accent/.cp-me-halo en todo este módulo). Resultado visible: alguien
   que jamás eligió un color de competencia terminaba con el podio pintado
   de violeta igual, como si SÍ tuviera uno propio — indistinguible, a
   simple vista, de alguien que realmente configuró ese tono. Ahora se
   trata la paleta default como "sin color propio" (null, mismo camino que
   ya usaba `tonosDeColor()` para dorado/plata/bronce de siempre) y el
   violeta pasa a verse SOLO cuando alguien de verdad eligió esa paleta a
   propósito entre las otras 12 o la personalizada.

   Sigue siendo Parte 1 (crear/unirse/ver lista/copiar invitación/salir) +
   ahora también Parte 2 (marcador en vivo vía GET, salón de la fama vía
   GET /historial, y el envío de horas vía POST /actualizar-horas después
   de cada sesión).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente, intentarSincronizar } from "../core/storage-sync.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";
import { mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import { copiarAlPortapapelesBlindado, abrirModalCopiaManualPortapapeles } from "../core/clipboard.js";
import { calcularMinutosTotalesEnRango, obtenerRangoSemana } from "./tiempo-estudio-estadisticas.js";
// 2026-09-17 — Partes 3/4/5. Los dos son imports circulares intencionales
// con este archivo (gestion importa helpers de acá); seguros porque nada
// se usa en el nivel superior del archivo, solo adentro de funciones.
import { abrirModalGestionCompetencia, construirRegistroCompetencias } from "./tiempo-estudio-competencias-gestion.js";
import { construirAvisosResultados, construirBotonesSimulacion, mostrarAnimacionUnirseCompetencia } from "./tiempo-estudio-celebracion.js";
// 2026-09-21 — Rediseño (prototipo-competencias-v2): todo lo que se dibuja
// (avatares con foto, podio, tarjeta, hoja modal, historial) vive en el
// módulo visual, que no importa nada de acá (sin ciclos). Acá queda la
// lógica: red, estado y permisos.
import {
  esc,
  normalizarFotoUrl,
  normalizarColorHex,
  leerColorAcentoActual,
  leerVistaPreferida,
  guardarVistaPreferida,
  pintarTarjeta,
  abrirHoja,
  pintarHistorial,
  avatarHTML,
  activarFallbackAvatares,
  asegurarEstilosCompetenciasVisual,
  COLOR_PALETA_DEFAULT,
} from "./tiempo-estudio-competencias-visual.js";

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

// 2026-09-23 — easter egg pedido por el dueño: los "botones de simulación"
// (construirBotonesSimulacion, tiempo-estudio-celebracion.js) dejaron de
// mostrarse por defecto — quedan solo para quien sabe que existen. Mantener
// presionado 5s el título "Competencias" los revela para esa carga de la
// pestaña; no se persiste entre visitas (ni localStorage ni estado global
// entre re-renders de construirVistaCompetencias) — cada vez que se vuelve
// a entrar a la pestaña hay que repetir el long-press, a propósito.
const DURACION_LONGPRESS_SIMULACION_MS = 5000;

/**
 * Cuelga un long-press de `duracionMs` sobre `elemento`. `alCompletar` se
 * llama una sola vez si el press se sostiene el tiempo completo (se cancela
 * con soltar, salir del elemento, o el cancel nativo de pointer events —
 * cubre mouse y touch por igual, sin listeners separados).
 */
function activarLongPress(elemento, duracionMs, alCompletar) {
  let temporizador = null;
  const cancelar = () => {
    if (temporizador === null) return;
    clearTimeout(temporizador);
    temporizador = null;
  };
  elemento.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return; // solo click primario / touch
    cancelar();
    temporizador = setTimeout(() => {
      temporizador = null;
      alCompletar();
    }, duracionMs);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => elemento.addEventListener(ev, cancelar));
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

/**
 * URL de la foto de Google del usuario, o null. `obtenerPerfilGoogle`
 * (core/auth.js) devuelve `{ nombre, foto_url }` y `estado.datos.perfil`
 * guarda el perfil; se prueban varios nombres de campo por si el guardado
 * usa otro (SUPUESTO — sin auth.js/main.js a la vista no pude confirmar
 * cuál es; si ninguno coincide, simplemente no hay foto y se ve la inicial).
 */
function obtenerMiFotoUrl() {
  const p = (estado.datos && estado.datos.perfil) || {};
  return normalizarFotoUrl(p.foto_url || p.foto || p.picture || p.imagen || "");
}

/**
 * Color de acento de la paleta activa (2.ª ronda, 2026-09-21): es el color
 * "favorito" de esta persona en el podio y en las barras. Sale de la
 * variable `--accent-1` de la app (ver leerColorAcentoActual), así que
 * acompaña a las 13 paletas, a la personalizada y al modo claro/oscuro.
 *
 * FIX 2026-09-22: la paleta DEFAULT de la app se trata como "sin color
 * propio" (null) — ver la nota grande de cabecera del archivo. Así el
 * podio de alguien que nunca eligió paleta se sigue viendo con el dorado/
 * plata/bronce de siempre, en vez de un violeta que en realidad no eligió.
 * (COLOR_PALETA_DEFAULT vive en tiempo-estudio-competencias-visual.js
 * desde el 2026-09-22 — es el mismo filtro que usa tonosDeColor() al
 * PINTAR el color de cualquier participante, no solo al mandar el propio.)
 */
function obtenerMiColor() {
  const color = leerColorAcentoActual();
  return color === COLOR_PALETA_DEFAULT ? null : color;
}

// Combinaciones "competencia|foto|color" que ya se mandaron en esta sesión:
// evita repetir el POST cada vez que se redibuja la tarjeta.
const perfilesSincronizados = new Set();

/**
 * Best-effort: si lo que guarda el Worker (foto y/o color) no es lo actual,
 * lo sube con un solo POST /perfil. `cambios` = { foto_url?, color? } con
 * SOLO lo que difiere.
 */
async function sincronizarPerfilPropio(competencia, cambios) {
  const clave = `${competencia.id}|${JSON.stringify(cambios)}`;
  if (perfilesSincronizados.has(clave)) return;
  perfilesSincronizados.add(clave);
  try {
    const respuesta = await fetchConTimeout(
      `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/participantes/${encodeURIComponent(competencia.participante_id)}/perfil`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identificador_usuario: estado.datos.perfil.correo, ...cambios }),
      }
    );
    if (!respuesta.ok) {
      perfilesSincronizados.delete(clave); // se reintenta la próxima vez
      console.warn(`[competencias] No se pudo actualizar foto/color (${respuesta.status}) en "${competencia.nombre}".`);
    }
  } catch (e) {
    perfilesSincronizados.delete(clave);
    console.warn("[competencias] Falló actualizar foto/color — se reintenta la próxima vez:", e);
  }
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

/** Se usa al delegar el permiso de borrado a otro participante — quien
 * delega deja de tener un token válido apenas el Worker pisa la columna
 * (ver manejarDelegarBorrado), así que no tiene sentido dejarlo dando
 * vueltas en localStorage de este dispositivo. */
function borrarTokenCreador(competenciaId) {
  try {
    localStorage.removeItem(CLAVE_TOKEN_CREADOR_PREFIJO + competenciaId);
  } catch (e) {
    // no crítico — a lo sumo queda un token viejo e inútil dando vueltas.
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
  return Boolean(exito); // 2026-09-21: el menú Gestionar cambia el botón a "¡Copiado!"
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
 *
 * FIX 2026-09-11 (bug real: una competencia "perdió" sus horas guardadas
 * frente a una stakeholder, tras agregar una sesión de 1 minuto): esto
 * calculaba el total leyendo `estado.datos.sesiones_estudio` de inmediato,
 * en paralelo a la bajada+fusión que `marcarCambioPendiente()` ya había
 * disparado un instante antes (siempre se llama justo después, ver los 6
 * puntos) — sin esperarla. Si el estado local de ESTE dispositivo todavía
 * no tenía fusionado algo que ya había en Drive (otra sesión de esta
 * semana, de este u otro dispositivo), el total salía chico y, como el
 * Worker manda el TOTAL sin comparar contra nada (a propósito, ver arriba),
 * pisaba el valor real que ya estaba guardado — indistinguible de "se
 * borró lo que tenía". Ahora se espera a que termine esa sincronización
 * ANTES de calcular: `intentarSincronizar()` está deduplicada del lado de
 * storage-sync.js (mismo patrón que `asegurarTokenValido`), así que este
 * `await` se "sube" a la sincronización que `marcarCambioPendiente()` ya
 * había arrancado en vez de disparar una segunda en paralelo.
 */
async function sincronizarHorasCompetencias() {
  // 2026-09-17 (punto 4.3): una competencia `finalizada` deja de aceptar
  // horas nuevas. El Worker igual las ignora (ver manejarActualizarHoras),
  // pero filtrarlas acá evita N requests inútiles en cada sesión guardada.
  const competencias = (estado.datos.competencias_unidas || []).filter((c) => c.estado !== "finalizada");
  if (competencias.length === 0) return;

  await intentarSincronizar();

  const { inicio, fin } = obtenerRangoSemana(0);
  const horas = calcularMinutosTotalesEnRango(inicio, fin) / 60;
  const identificador_usuario = estado.datos.perfil.correo;

  let huboDelegacionRecibida = false;

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
          return;
        }

        // Buzón de delegación (ver manejarActualizarHoras en el Worker):
        // si alguien nos delegó el permiso de borrado de esta competencia
        // (abrirModalDelegarAntesDeSalir), viaja acá solo, sin que
        // tengamos que hacer nada — se guarda en este dispositivo y se le
        // pone la corona local a la competencia.
        const datos = await respuesta.json();
        if (datos.token_creador_delegado) {
          guardarTokenCreador(competencia.id, datos.token_creador_delegado);
          competencia.es_creador = true;
          huboDelegacionRecibida = true;
        }
      } catch (e) {
        console.warn(`[competencias] Falló actualizar-horas para "${competencia.nombre}" — se autocorrige con la próxima sesión:`, e);
      }
    })
  );

  if (huboDelegacionRecibida) {
    marcarCambioPendiente();
    mostrarToast("✓ Ahora tenés permiso para borrar una de tus competencias para todos");
  }
}

/**
 * Punto de entrada del botón "Salir". Si quien se va NO es el creador,
 * es el flujo de siempre. Si SÍ lo es, primero hay que ver si hay alguien
 * más adentro a quien delegarle el permiso de borrado — ver
 * verificarSiHaceFaltaDelegarAntesDeSalir.
 */
function salirDeCompetencia(competencia, refrescar) {
  if (competencia.es_creador) {
    verificarSiHaceFaltaDelegarAntesDeSalir(competencia, refrescar);
    return;
  }
  confirmarYEjecutarSalida(competencia, refrescar);
}

/**
 * Solo se llama cuando `competencia.es_creador` es true. Se fija con un
 * GET /competencias/:id (trae el marcador completo) si hay otros
 * participantes: si está solo, no hay a quién delegarle nada y sale
 * derecho. Si hay más gente, el "Borrar para todos" quedaría huérfano
 * para siempre si se va sin delegar (el Worker nunca vuelve a exponer
 * `token_creador` fuera de este flujo, ver manejarBorrarCompetencia) — se
 * lo manda primero a abrirModalDelegarAntesDeSalir.
 */
async function verificarSiHaceFaltaDelegarAntesDeSalir(competencia, refrescar) {
  let participantes = [];
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}`);
    if (respuesta.ok) {
      const datos = await respuesta.json();
      participantes = datos.participantes || [];
    }
  } catch (e) {
    console.warn("[competencias] No se pudo chequear participantes antes de salir:", e);
  }

  const otros = participantes.filter((p) => p.id !== competencia.participante_id);
  if (otros.length === 0) {
    confirmarYEjecutarSalida(competencia, refrescar);
    return;
  }

  abrirModalDelegarAntesDeSalir(competencia, otros, refrescar);
}

function confirmarYEjecutarSalida(competencia, refrescar) {
  abrirConfirmacion({
    titulo: "Salir de la competencia",
    mensaje: competencia.es_creador
      ? `¿Salir de "${competencia.nombre}"? Ya delegaste el permiso de borrado — esto solo te saca a vos, la competencia sigue igual para los demás.`
      : `¿Salir de "${competencia.nombre}"? Podés volver a unirte más tarde con el mismo link.`,
    textoConfirmar: "Salir",
    claseConfirmar: "btn-danger",
    onConfirmar: () => ejecutarSalidaCompetencia(competencia, refrescar),
  });
}

/** El DELETE real + limpieza local — compartido por el flujo directo
 * (confirmarYEjecutarSalida) y por el que pasa primero por la delegación
 * (abrirModalDelegarAntesDeSalir).
 *
 * FIX 2026-09-19 (Parte A, punto 3): antes CUALQUIER fallo del DELETE
 * (sin red, timeout, 5xx) se tragaba con un `console.warn` y la
 * competencia se sacaba igual de la lista local. Resultado: la fila del
 * participante quedaba VIVA en D1 (con sus horas viejas) y en el cliente
 * ya no había ningún puntero a ella — un "fantasma" que aparecía en el
 * marcador de los demás y hacía fallar el siguiente "Unirse" con 409.
 * Ahora solo se saca de la lista local si el Worker CONFIRMÓ que la fila ya
 * no está (2xx, o 404 = ya no existía). Ante cualquier otro resultado se
 * deja todo como estaba y se avisa, para que se pueda reintentar.
 * Devuelve true si efectivamente salió. */
async function ejecutarSalidaCompetencia(competencia, refrescar) {
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
      // 404 = el Worker ya no lo tiene como participante (ej. ya se había
      // salido desde otro dispositivo): el estado deseado ya se cumple.
      throw new Error(`El Worker respondió ${respuesta.status}`);
    }
  } catch (e) {
    console.warn("[competencias] No se pudo confirmar la salida con el Worker — se mantiene en la lista local:", e);
    mostrarToast("No se pudo salir de la competencia. Revisá tu conexión e intentá de nuevo.");
    return false;
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
  return true;
}

/**
 * Se abre en vez del confirm de "Salir" cuando quien se quiere ir ES el
 * creador Y hay más gente en la competencia. Primero elige a quién
 * delegarle `token_creador` (POST .../delegar-borrado invalida el viejo
 * de una), después arma un link de "reclamo" (mismo patrón que el link de
 * invitación con "?comp="): POST .../delegar-borrado deja el token nuevo
 * "estacionado" en el Worker (columna `token_creador_pendiente` de la fila
 * del participante elegido) y su propio dispositivo lo recoge solo en su
 * próxima sincronización (ver sincronizarHorasCompetencias) — cero acción
 * manual de esa persona, no hace falta armar ni mandar ningún link.
 *
 * Por eso "Delegar" y "Salir" son un solo botón: una vez que el Worker
 * confirmó la delegación no queda nada más por hacer del lado de quien se
 * va, así que se sale de una. El modal bloquea el cierre por click afuera
 * (`bloquearClickAfuera`) — la única forma de salir sin delegar es el
 * botón explícito "Ahora no".
 */
function abrirModalDelegarAntesDeSalir(competencia, otrosParticipantes, refrescar) {
  const { overlay, caja, cerrar } = construirCajaModal();

  const opcionesHtml = otrosParticipantes
    .map(
      (p, i) => `<label class="row-between" style="padding:4px 0; cursor:pointer;">
      <span><input type="radio" name="comp-delegar-elegido" value="${p.id}" ${i === 0 ? "checked" : ""}> ${p.apodo}</span>
      <span class="muted" style="font-size:0.85rem;">${formatearHoras(p.horas_semana_actual)}</span>
    </label>`
    )
    .join("");

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Delegá antes de salir</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Sos quien puede borrar "${competencia.nombre}" para todos. Si te vas sin pasarle ese permiso a alguien más, la competencia queda sin nadie que la pueda borrar nunca.
      </p>
    </div>
    <div class="stack" style="gap:2px;">
      <p class="muted" style="margin:0 0 4px; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.03em;">Elegí a quién delegarle</p>
      ${opcionesHtml}
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-delegar-cancelar" style="flex:1;">Ahora no</button>
      <button type="button" class="btn btn-danger" id="comp-delegar-confirmar" style="flex:1;">Delegar y salir</button>
    </div>
  `;
  document.body.appendChild(overlay);
  caja.querySelector("#comp-delegar-cancelar").addEventListener("click", cerrar);

  const btnConfirmar = caja.querySelector("#comp-delegar-confirmar");
  const btnCancelar = caja.querySelector("#comp-delegar-cancelar");
  btnConfirmar.addEventListener("click", async () => {
    const elegido = caja.querySelector('input[name="comp-delegar-elegido"]:checked');
    if (!elegido) {
      mostrarToast("Elegí a alguien primero");
      return;
    }
    const participanteId = elegido.value;

    const tokenCreador = leerTokenCreador(competencia.id);
    if (!tokenCreador) {
      mostrarToast("No se encontró el permiso de borrado en este dispositivo — no se puede delegar desde acá.");
      return;
    }

    // Se bloquean los dos botones (no solo el de confirmar) mientras el
    // pedido está en vuelo — con el click afuera ya bloqueado, es la
    // única forma que quedaba de "escaparse" a mitad de camino.
    btnConfirmar.disabled = true;
    btnCancelar.disabled = true;
    btnConfirmar.textContent = "Delegando…";
    try {
      const respuesta = await fetchConTimeout(
        `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/delegar-borrado`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token_creador: tokenCreador, participante_id: participanteId }),
        }
      );
      if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    } catch (e) {
      console.error("[competencias] Falló delegar el borrado:", e);
      mostrarToast("No se pudo delegar. Revisá tu conexión e intentá de nuevo.");
      btnConfirmar.disabled = false;
      btnCancelar.disabled = false;
      btnConfirmar.textContent = "Delegar y salir";
      return;
    }

    // Éxito: el token viejo de este dispositivo ya no sirve (el Worker lo
    // pisó), se limpia acá. La competencia está a punto de sacarse de la
    // lista local de una (ejecutarSalidaCompetencia), así que no hace
    // falta tocar `es_creador` a mano.
    borrarTokenCreador(competencia.id);
    cerrar();
    const salio = await ejecutarSalidaCompetencia(competencia, refrescar);
    if (!salio) {
      // FIX 2026-09-19 (Parte A, punto 3): la delegación YA se hizo pero el
      // DELETE falló y la competencia sigue en la lista local. Sin este
      // paso, un reintento de "Salir" volvería a abrir este modal y chocaría
      // con "no se encontró el permiso de borrado" (el token ya se limpió
      // arriba). Como el permiso efectivamente ya no es de esta persona, se
      // deja de marcarla como creadora (relectura de entidad viva) y el
      // reintento va por el flujo directo.
      const viva = estado.datos.competencias_unidas.find((c) => c.id === competencia.id);
      if (viva && viva.es_creador) {
        viva.es_creador = false;
        sellarTimestamp(viva);
        marcarCambioPendiente();
      }
    }
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

/**
 * PEDIDO 2.2 (2026-09-17): tocar fuera del modal ya NO cierra NINGÚN modal
 * de la sección Tiempo. El parámetro `bloquearClickAfuera` quedó invertido
 * de default (antes `false`, ahora siempre bloqueado) y se conserva
 * solamente para no romper las llamadas que ya lo pasaban explícito, como
 * `abrirModalDelegarAntesDeSalir`.
 *
 * Como algunos de estos modales tienen estados donde todavía no hay
 * botones dibujados (ej. el "Cargando…" de abrirModalInvitacionRecibida o
 * de abrirModalSacarUsuario), y sin el clic afuera quedarían sin ninguna
 * salida, se agrega acá una "✕" propia en la esquina — mismo rol que la
 * que `inicializarBotonesCerrarModal()` (ui/componentes.js) le pone a los
 * modales fijos de index.html, que a estos no los alcanza porque se crean
 * dinámicamente.
 */
function construirCajaModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "position:relative; max-width:440px; width:100%; max-height:85vh; overflow-y:auto; gap:16px;";
  caja.addEventListener("click", (e) => e.stopPropagation());
  overlay.appendChild(caja);

  function cerrar() {
    overlay.remove();
  }

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.className = "modal-x-close";
  btnX.setAttribute("aria-label", "Cerrar");
  btnX.textContent = "✕";
  btnX.style.cssText = "position:absolute; top:8px; right:8px; z-index:2;";
  btnX.addEventListener("click", cerrar);
  // Se re-inserta al principio cada vez que el modal se repinta con
  // innerHTML (varios de estos reemplazan el contenido entero después de
  // un fetch), así la "✕" nunca se pierde en el camino.
  const observador = new MutationObserver(() => {
    if (!caja.contains(btnX)) caja.prepend(btnX);
  });
  observador.observe(caja, { childList: true });
  caja.prepend(btnX);

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
      <input type="text" id="comp-crear-nombre" class="form-input" placeholder="Ej. Parciales de setiembre" maxlength="60" autocomplete="off">
    </div>
    <div>
      <span class="form-label">Tu apodo (así te van a ver los demás)</span>
      <input type="text" id="comp-crear-apodo" class="form-input" placeholder="Ej. Wagner" maxlength="30" autocomplete="off">
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
          foto_url: obtenerMiFotoUrl(),
          color: obtenerMiColor(),
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
        // 2026-09-17 (punto 4.3): caché local del estado de la competencia
        // — la verdad vive en D1, esto solo permite separar activas de
        // archivadas sin esperar a la red (ver cargarMarcadorEnTarjeta).
        estado: "activa",
        // FIX 2026-09-19 (Parte A, estado fantasma): momento del alta, en ms.
        // Es lo que le permite a `fusionarDatos` distinguir esta membresía de
        // una tumba VIEJA con el mismo id (ver `podarTumbasSuperadasPorAltas`).
        unido_en: Date.now(),
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
      <input type="text" id="comp-unirse-link" class="form-input" placeholder="Pegá acá el link" autocomplete="off">
    </div>
    <div>
      <span class="form-label">Tu apodo (así te van a ver los demás)</span>
      <input type="text" id="comp-unirse-apodo" class="form-input" placeholder="Ej. Wagner" maxlength="30" autocomplete="off">
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
            foto_url: obtenerMiFotoUrl(),
            color: obtenerMiColor(),
          }),
        }
      );
      if (respuestaUnirse.status === 404) throw new Error("Esa competencia no existe (¿el link está completo?)");
      if (respuestaUnirse.status === 409) throw new Error("Ya sos parte de esta competencia (desde otro dispositivo).");
      if (!respuestaUnirse.ok) throw new Error(`El Worker respondió ${respuestaUnirse.status}`);
      const { participante_id } = await respuestaUnirse.json();

      // El nombre real no vino en la respuesta de /unirse — se pide aparte.
      // Ese mismo GET ya trae "participantes" (mismo shape que usa
      // abrirModalInvitacionRecibida más abajo), así que se reusa acá para
      // la animación de unión en vez de pedirlo de nuevo.
      let nombre = "(competencia)";
      let participantes = [];
      try {
        const respuestaGet = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(idCompetencia)}`);
        if (respuestaGet.ok) {
          const datosCompetencia = await respuestaGet.json();
          nombre = datosCompetencia.nombre;
          participantes = datosCompetencia.participantes || [];
        }
      } catch (e) {
        console.warn("[competencias] Te uniste bien pero no se pudo traer el nombre todavía:", e);
      }

      estado.datos.competencias_unidas.push(
        sellarTimestamp({ id: idCompetencia, participante_id, apodo, nombre, es_creador: false, estado: "activa", unido_en: Date.now() })
      );
      marcarCambioPendiente();

      cerrar();
      if (refrescar) refrescar();
      mostrarAnimacionUnirseCompetencia({
        nombreCompetencia: nombre,
        apodoPropio: apodo,
        miFoto: obtenerMiFotoUrl(),
        miColor: obtenerMiColor(),
        participantes,
      });
      sincronizarHorasCompetencias(); // por si ya venía estudiando esta semana antes de unirse
    } catch (e) {
      console.error("[competencias] Falló unirse a competencia:", e);
      mostrarToast(e.message || "No se pudo unir a la competencia.");
      btnGuardar.disabled = false;
      btnGuardar.textContent = "Unirme";
    }
  });
}

let _yaProcesadoLinkInvitacion = false; // se llama una sola vez desde DOMContentLoaded en main.js

/**
 * Deep link de invitación: si la URL actual trae "?comp=<id>" (el mismo
 * link que arma `construirLinkInvitacion`), muestra un modal de
 * confirmación con el nombre de la competencia y el marcador ANTES de
 * unirse, en vez de obligar a copiar/pegar el link a mano en el modal
 * "Unirse a competencia" (`abrirModalUnirseCompetencia`, que sigue
 * existiendo tal cual para el caso de pegar un código a mano).
 *
 * Llamar una sola vez desde el DOMContentLoaded de main.js, DESPUÉS de
 * que `estado` ya haya terminado de cargar (usa `estado.datos.perfil.correo`
 * y `estado.datos.competencias_unidas` para no duplicar altas).
 *
 * El "comp" se saca de la URL con replaceState apenas se lee, así un F5
 * posterior no vuelve a abrir el modal ni reintenta unirse solo.
 */
async function revisarLinkInvitacionAlCargar(refrescar) {
  if (_yaProcesadoLinkInvitacion) return;
  _yaProcesadoLinkInvitacion = true;

  const url = new URL(location.href);
  const id = url.searchParams.get("comp");
  if (!id) return;

  url.searchParams.delete("comp");
  history.replaceState(null, "", url.toString());

  if (estado.datos.competencias_unidas.some((c) => c.id === id)) {
    mostrarToast("Ya sos parte de esta competencia");
    return;
  }

  abrirModalInvitacionRecibida(id, refrescar);
}

/**
 * Modal que dispara `revisarLinkInvitacionAlCargar`: GET /competencias/:id
 * para traer nombre + marcador ANTES de decidir, y recién ahí unirse (mismo
 * POST /unirse que usa `abrirModalUnirseCompetencia`, con el id ya fijo —
 * acá no hace falta pegar nada, solo poner el apodo).
 */
async function abrirModalInvitacionRecibida(id, refrescar) {
  asegurarEstilosCompetenciasVisual(); // por si esta invitación se abre antes de que pintarTarjeta() haya corrido
  const { overlay, caja, cerrar } = construirCajaModal();
  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Te invitaron a una competencia</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">Cargando…</p>
    </div>
  `;
  document.body.appendChild(overlay);

  let datos;
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(id)}`);
    if (respuesta.status === 404) throw new Error("Esa competencia ya no existe (¿el link venció?)");
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    datos = await respuesta.json(); // { id, nombre, participantes: [{id, apodo, horas_semana_actual}] }
  } catch (e) {
    console.error("[competencias] Falló cargar la invitación:", e);
    caja.innerHTML = `
      <div>
        <h2 style="margin:0;">No se pudo abrir la invitación</h2>
        <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">${e.message || "Revisá tu conexión e intentá de nuevo."}</p>
      </div>
      <button type="button" class="btn btn-secondary" id="comp-invitacion-cerrar">Cerrar</button>
    `;
    caja.querySelector("#comp-invitacion-cerrar").addEventListener("click", cerrar);
    return;
  }

  // Ordenado por horas de esta semana, igual criterio que el marcador de
  // la tarjeta (`cargarMarcadorEnTarjeta`) — el Worker ya lo devuelve así,
  // pero se ordena de nuevo acá por las dudas (no depender de ese detalle).
  const participantes = [...(datos.participantes || [])].sort(
    (a, b) => (b.horas_semana_actual || 0) - (a.horas_semana_actual || 0)
  );

  const listaHtml = participantes.length
    ? participantes
        .map((p, i) => {
          const medalla = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}.`;
          return `<div class="row-between" style="padding:4px 0; align-items:center; gap:8px;">
            <span style="display:flex; align-items:center; gap:8px; min-width:0;">
              <span class="muted" style="font-size:0.8rem; width:16px; text-align:center; flex-shrink:0;">${medalla}</span>
              ${avatarHTML({ apodo: p.apodo, foto_url: p.foto_url, color: p.color }, 26)}
              <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${esc(p.apodo)}</span>
            </span>
            <span class="muted" style="font-size:0.85rem; flex-shrink:0;">${formatearHoras(p.horas_semana_actual)}</span>
          </div>`;
        })
        .join("")
    : `<p class="muted" style="margin:0; font-size:0.82rem;">Todavía nadie tiene horas esta semana.</p>`;

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">${esc(datos.nombre)}</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">¿Deseas unirte?</p>
    </div>
    <div class="stack" style="gap:2px;">
      <p class="muted" style="margin:0 0 4px; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.03em;">Miembros actuales</p>
      ${listaHtml}
    </div>
    <div>
      <span class="form-label">Tu apodo (así te van a ver los demás)</span>
      <input type="text" id="comp-invitacion-apodo" class="form-input" placeholder="Ej. Wagner" maxlength="30" autocomplete="off">
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="comp-invitacion-cancelar" style="flex:1;">Ahora no</button>
      <button type="button" class="btn btn-primary" id="comp-invitacion-unirme" style="flex:1;">Unirme</button>
    </div>
  `;
  activarFallbackAvatares(caja);
  caja.querySelector("#comp-invitacion-cancelar").addEventListener("click", cerrar);

  const btnUnirme = caja.querySelector("#comp-invitacion-unirme");
  btnUnirme.addEventListener("click", async () => {
    const apodo = caja.querySelector("#comp-invitacion-apodo").value.trim();
    if (!apodo) {
      mostrarToast("Completá tu apodo");
      return;
    }

    btnUnirme.disabled = true;
    btnUnirme.textContent = "Uniéndote…";
    try {
      const respuestaUnirse = await fetchConTimeout(
        `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(id)}/unirse`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apodo,
            identificador_usuario: estado.datos.perfil.correo,
            offset_minutos_utc: obtenerOffsetMinutosUtc(),
            foto_url: obtenerMiFotoUrl(),
            color: obtenerMiColor(),
          }),
        }
      );
      if (respuestaUnirse.status === 409) throw new Error("Ya sos parte de esta competencia (desde otro dispositivo).");
      if (!respuestaUnirse.ok) throw new Error(`El Worker respondió ${respuestaUnirse.status}`);
      const { participante_id } = await respuestaUnirse.json();

      estado.datos.competencias_unidas.push(
        sellarTimestamp({ id, participante_id, apodo, nombre: datos.nombre, es_creador: false, estado: "activa", unido_en: Date.now() })
      );
      marcarCambioPendiente();

      cerrar();
      if (refrescar) refrescar();
      mostrarAnimacionUnirseCompetencia({
        nombreCompetencia: datos.nombre,
        apodoPropio: apodo,
        miFoto: obtenerMiFotoUrl(),
        miColor: obtenerMiColor(),
        participantes: datos.participantes,
      });
      sincronizarHorasCompetencias(); // por si ya venía estudiando esta semana antes de unirse
    } catch (e) {
      console.error("[competencias] Falló unirse desde la invitación:", e);
      mostrarToast(e.message || "No se pudo unir a la competencia.");
      btnUnirme.disabled = false;
      btnUnirme.textContent = "Unirme";
    }
  });
}

/**
 * Historial (trofeo de la tarjeta): el podio COMPLETO de cada semana
 * cerrada, en hojas desplegables — GET /competencias/:id/podios (2026-09-21;
 * antes: solo el ganador, GET /historial). `abrirEn` (opcional) =
 * semana_cerrada_en a desplegar de entrada, para que el aviso de resultado
 * abra directo la semana que anuncia.
 */
async function abrirModalHistorial(competencia, abrirEn) {
  const hoja = abrirHoja({
    icono: "trophy",
    tono: "",
    titulo: "Historial",
    subtitulo: competencia.nombre,
    cuerpoHTML: `<p class="cp-msg">Cargando…</p>`,
  });
  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/podios`);
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    const { podios } = await respuesta.json();
    pintarHistorial(hoja, podios, competencia.participante_id, abrirEn);
  } catch (e) {
    console.error("[competencias] Falló cargar el historial:", e);
    hoja.cuerpo.innerHTML = `<p class="cp-msg">No se pudo cargar el historial. Revisá tu conexión.</p>`;
  }
}

/**
 * Carga el marcador en vivo (GET /competencias/:id) DENTRO de la tarjeta
 * ya pintada — se llama después de armar el DOM sincrónico de cada
 * tarjeta, para no bloquear el render de toda la lista esperando a las N
 * competencias a la vez (cada una carga a su propio ritmo).
 */
async function cargarMarcadorEnTarjeta(competencia, tarjeta, refrescar) {
  const vistaGuardada = leerVistaPreferida();
  const base = {
    nombre: competencia.nombre,
    esCreador: Boolean(competencia.es_creador),
    apodo: competencia.apodo,
    yoId: competencia.participante_id,
    vista: vistaGuardada,
  };
  const cb = {
    alHistorial: () => abrirModalHistorial(competencia),
    alGestionar: () => abrirModalGestionCompetencia(competencia, refrescar),
    alCambiarVista: null, // se asigna abajo, cuando ya hay participantes
  };

  pintarTarjeta(tarjeta, { ...base, participantes: null, estadoCuerpo: "cargando", animar: false }, cb);

  try {
    const respuesta = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}`);
    if (!respuesta.ok) throw new Error(`El Worker respondió ${respuesta.status}`);
    const datos = await respuesta.json(); // { id, nombre, estado, participantes: [{id, apodo, horas_semana_actual, foto_url}] }

    // 2026-09-17 (Parte 4/5): `nombre` y `estado` viven del lado del Worker
    // pero se cachean en `competencias_unidas` para poder pintar la lista
    // (y separar activas de archivadas) sin esperar a la red. Acá se
    // reconcilia ese caché con la verdad: si alguien renombró o finalizó la
    // competencia desde otro dispositivo, esta es la vuelta en que se
    // entera. Solo se re-renderiza si algo cambió de verdad, así no entra
    // en un bucle de refrescos.
    const estadoRemoto = datos.estado === "finalizada" ? "finalizada" : "activa";
    const viva = estado.datos.competencias_unidas.find((c) => c.id === competencia.id);
    if (viva && (viva.nombre !== datos.nombre || viva.estado !== estadoRemoto)) {
      viva.nombre = datos.nombre;
      viva.estado = estadoRemoto;
      sellarTimestamp(viva);
      marcarCambioPendiente();
      if (typeof window.renderizarTiempoEstudio === "function") window.renderizarTiempoEstudio();
      return;
    }

    // El Worker guarda `horas_semana_actual` en HORAS; el módulo visual
    // trabaja con `horas` a secas.
    const participantes = (datos.participantes || []).map((p) => ({
      id: p.id,
      apodo: p.apodo,
      foto_url: p.foto_url || null,
      color: p.color || null,
      horas: p.horas_semana_actual || 0,
    }));

    // ===== DEBUG TEMPORAL (2026-09-22) — BORRAR después de mirar la consola =====
    // Muestra el color CRUDO de cada participante tal cual llega del Worker,
    // y si tonosDeColor() lo reconoce como "sin color propio" o no. Abrí la
    // consola (F12), recargá con Ctrl+Shift+R y buscá la fila de Mochi.
    console.log(
      `[DEBUG color] "${competencia.nombre}":`,
      participantes.map((p) => {
        const normalizado = normalizarColorHex(p.color);
        return {
          apodo: p.apodo,
          color_crudo: JSON.stringify(p.color),
          color_normalizado: normalizado,
          se_va_a_pintar_como_default: normalizado === null || normalizado === COLOR_PALETA_DEFAULT,
        };
      })
    );
    // ===== FIN DEBUG TEMPORAL =====

    // Foto y color propios: si el Worker tiene otros (o ninguno), se sube lo
    // actual de este dispositivo y mientras tanto se muestra directamente.
    //
    // FIX 2026-09-22 (parte 2, la que faltaba): el color SÍ tiene que poder
    // sincronizarse a `null` — a diferencia de la foto (que nunca se borra
    // con un valor vacío), alguien que YA tenía el violeta de marca guardado
    // en D1 de ANTES de que `obtenerMiColor()` empezara a devolver `null`
    // para la paleta default necesita que ese `null` viaje para limpiarlo.
    // Con el guard viejo (`if (miColor && ...)`) esa limpieza nunca se
    // mandaba — el violeta quedaba pegado para siempre en el podio de esa
    // persona aunque el fix ya estuviera activo del lado local.
    const miFoto = obtenerMiFotoUrl();
    const miColor = obtenerMiColor();
    const yo = participantes.find((p) => p.id === competencia.participante_id);
    if (yo) {
      const cambios = {};
      if (miFoto && yo.foto_url !== miFoto) cambios.foto_url = miFoto;
      if (yo.color !== miColor) cambios.color = miColor;
      if (Object.keys(cambios).length > 0) {
        Object.assign(yo, cambios);
        sincronizarPerfilPropio(competencia, cambios);
      }
    }

    let vista = vistaGuardada;
    const dibujar = (animar) =>
      pintarTarjeta(tarjeta, { ...base, vista, participantes, estadoCuerpo: "ok", animar }, cb);
    cb.alCambiarVista = (nueva) => {
      vista = nueva;
      guardarVistaPreferida(nueva);
      dibujar(false);
    };
    dibujar(true);
  } catch (e) {
    console.error("[competencias] Falló cargar el marcador:", e);
    pintarTarjeta(tarjeta, { ...base, participantes: null, estadoCuerpo: "error", animar: false }, cb);
  }
}

/**
 * Punto de entrada — llamado desde tiempo-estudio.js cuando el pill
 * superior está en "Competencias". `refrescar` es el mismo callback sin
 * argumentos (`renderizarTiempoEstudio`) que ya usan Materias/Estadísticas.
 */
function construirVistaCompetencias(cont, refrescar) {
  // Fire-and-forget: además de correr tras cada sesión de estudio, se
  // pincha acá para que una delegación pendiente (ver
  // abrirModalDelegarAntesDeSalir) llegue apenas alguien abre esta
  // pestaña, sin tener que esperar a la próxima vez que estudie.
  sincronizarHorasCompetencias();

  const encabezado = document.createElement("div");
  encabezado.className = "row-between";
  encabezado.style.cssText = "align-items:center; margin-bottom:6px;";
  encabezado.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Competencias</h3>`;
  const tituloCompetencias = encabezado.querySelector("h3");

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

  // Punto 3.3: los avisos de resultado nuevo van arriba de todo, y son el
  // ÚNICO camino a la pantalla de celebración con sonido. Nada suena solo.
  construirAvisosResultados(cont, refrescar, abrirModalHistorial);

  // 2026-09-23 — los botones de simulación (encolan un aviso falso de
  // victoria/derrota para ajustar el diseño de celebración sin esperar a un
  // cierre de semana real) ya NO se muestran por defecto: quedan ocultos
  // detrás de un easter egg — mantener presionado 5s el título "Competencias"
  // los revela para desarrollador.
  // Ancla de comentario (no un <div>): un nodo de comentario no genera caja
  // de render, así que no cuenta como hijo para el `gap` del contenedor y no
  // deja un hueco cuando el easter egg no se activó. El <div> real recién se
  // crea e inserta si el long-press se completa.
  const marcaSimulacion = document.createComment("cp-sim-anchor");
  cont.appendChild(marcaSimulacion);
  let simulacionRevelada = false;
  if (tituloCompetencias) {
    activarLongPress(tituloCompetencias, DURACION_LONGPRESS_SIMULACION_MS, () => {
      if (simulacionRevelada) return;
      simulacionRevelada = true;
      const contenedorSimulacion = document.createElement("div");
      marcaSimulacion.parentNode.insertBefore(contenedorSimulacion, marcaSimulacion.nextSibling);
      construirBotonesSimulacion(contenedorSimulacion, refrescar);
    });
  }

  const todas = estado.datos.competencias_unidas;
  // Parte 5: las finalizadas salen de la lista principal y se muestran en
  // "Registro de competencias", abajo y colapsado.
  const activas = todas.filter((c) => c.estado !== "finalizada");

  if (todas.length === 0) {
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

  if (activas.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "margin:0 0 4px; font-size:0.85rem;";
    vacio.textContent = "No tenés competencias activas — mirá el registro más abajo.";
    cont.appendChild(vacio);
  }

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "14px";

  activas.forEach((competencia) => {
    // 2026-09-21: la tarjeta entera (cabecera, íconos, podio/lista) la
    // dibuja el módulo visual; `cargarMarcadorEnTarjeta` la pinta primero
    // "cargando" y luego con los datos del Worker.
    const tarjeta = document.createElement("article");
    lista.appendChild(tarjeta);
    cargarMarcadorEnTarjeta(competencia, tarjeta, refrescar);
  });

  cont.appendChild(lista);

  // Parte 5 — sección "Registro de competencias" (no dibuja nada si no hay
  // ninguna finalizada; el botón "Recuperar historial" que tuvo brevemente
  // se sacó, no aportaba nada al caso de uso real).
  construirRegistroCompetencias(cont, refrescar);
}

export {
  construirVistaCompetencias,
  sincronizarHorasCompetencias,
  revisarLinkInvitacionAlCargar,
  // Helpers compartidos con tiempo-estudio-competencias-gestion.js
  // (2026-09-17, ver la nota de cabecera de ese archivo sobre por qué se
  // partió en dos). No son API pública de la sección: nadie fuera de ese
  // archivo debería importarlos.
  construirCajaModal,
  fetchConTimeout,
  formatearHoras,
  construirLinkInvitacion,
  copiarLinkInvitacion,
  abrirModalHistorial,
  leerTokenCreador,
  salirDeCompetencia,
  borrarCompetenciaEntera,
};
