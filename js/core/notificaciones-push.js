/* =========================================================================
   NOTIFICACIONES PUSH REALES (cliente)
   -------------------------------------------------------------------------
   Habla con el Worker de Cloudflare (proyecto SEPARADO, ver
   worker-notificaciones/README.md — no vive en este repo). Este archivo es
   la ÚNICA parte de la app que hace fetch() contra ese Worker: agenda.js y
   agenda-modal.js solo llaman a programarRecordatorioPush/
   cancelarRecordatorioPush, nunca arman la llamada HTTP ellos mismos.

   El Worker nunca ve datos académicos reales — solo lo que se manda acá:
   una suscripción push, una fecha/hora, y el título/cuerpo cortos del
   recordatorio (nombre del evento + nombre de la materia vinculada, si
   tiene). Nada de notas, adjuntos, calificaciones, etc.

   Toda llamada de red de este archivo es "best-effort": si el Worker no
   responde (sin internet, Worker caído, todavía no desplegado) NUNCA se
   bloquea ni se revierte la acción real del usuario en Agenda (guardar/
   completar/borrar) — como mucho, ese recordatorio puntual no llega a
   programarse/cancelarse del lado del servidor, y solo se avisa por
   console.warn. Guardar una tarea no puede depender de que un servicio de
   notificaciones de terceros esté disponible en ese momento.
   ========================================================================= */

import { sellarTimestamp } from "./schema.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { estado } from "./storage.js";
import { aplicarFormatoTexto } from "./utils.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";

// *** COMPLETAR DESPUÉS DE DESPLEGAR EL WORKER ***
// Ver worker-notificaciones/README.md, paso 6 (URL) — la clave pública ya
// viene puesta porque coincide con el par VAPID que te dejé generado; si
// generaste tu propio par en el Worker, actualizala acá también (paso
// opcional del README).
const URL_WORKER_NOTIFICACIONES = "https://worker-notificaciones-agenda.appacademica.workers.dev";
const VAPID_CLAVE_PUBLICA = "BMbmYWYDGscYiMy9jFXkSqLHzNZZEgRt2Ax22VcKpQJ666e2jdTzcv00sBTQf3l0oLudBu39V7kip2NFj5Z5nZM";

function convertirClaveVapidAUint8Array(base64url) {
  const padding = "=".repeat((4 - (base64url.length % 4)) % 4);
  const base64 = (base64url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(base64);
  const salida = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) salida[i] = crudo.charCodeAt(i);
  return salida;
}

function soportaNotificacionesPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

/** Fuente de verdad del switch de Ajustes — ver config/config-ajustes.js. */
function notificacionesPushActivas() {
  return Boolean(estado.datos?.configuracion?.notificaciones_push_activas);
}

/**
 * Mismo criterio de "nombre legible de la materia vinculada" que ya usaba
 * agenda-modal.js (obtenerNombreMateriaEvento) — se resuelve acá mismo, en
 * vez de importarla desde agenda/, para que este archivo no dependa de
 * agenda-modal.js/agenda.js (evita un import circular: agenda.js/
 * agenda-modal.js son los que llaman A este archivo).
 */
function resolverNombreMateriaEvento(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? aplicarFormatoTexto(materia.nombre) : "";
}

/**
 * fecha_hora_utc (timestamp Unix en SEGUNDOS) para el Worker: hora exacta
 * del evento si tiene hora definida; si es de día completo, 8:00 AM hora
 * local de ese día (criterio default acordado — ver prompt original,
 * punto B.3, ajustable acá mismo si en algún momento se prefiere otro).
 * Se arma la fecha a mano con los componentes del ISO (en vez de
 * `new Date(evento.fecha)`, que Chrome interpreta como UTC medianoche y
 * termina corriendo un día para atrás en zonas horarias negativas) —
 * mismo motivo por el que el resto de Agenda usa fechaLocalDesdeISO en
 * horario.js.
 */
function calcularFechaHoraUtcRecordatorio(evento) {
  const [anio, mes, dia] = evento.fecha.split("-").map(Number);
  let horas = 8;
  let minutos = 0;
  if (evento.hora) {
    const [h, m] = evento.hora.split(":").map(Number);
    horas = h;
    minutos = m;
  }
  const fecha = new Date(anio, mes - 1, dia, horas, minutos, 0, 0);
  return Math.floor(fecha.getTime() / 1000);
}

async function obtenerSuscripcionPushActiva() {
  if (!soportaNotificacionesPush()) return null;
  const registro = await navigator.serviceWorker.ready;
  return registro.pushManager.getSubscription();
}

/**
 * A diferencia de notificacionesPushActivas() (que solo lee el flag de la
 * CUENTA, sincronizado por Drive entre dispositivos), esto chequea si ESTE
 * dispositivo en particular tiene una suscripción push real activa en el
 * navegador — el permiso/suscripción es por dispositivo, así que el flag
 * de cuenta puede decir "activas" aunque este navegador nunca haya dado el
 * permiso (ej. se activó desde el celular). Usado en config-ajustes.js
 * para no mostrar el switch prendido en un dispositivo que en realidad no
 * va a recibir nada.
 */
async function notificacionesPushActivasEnEsteDispositivo() {
  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    return Boolean(suscripcion);
  } catch (e) {
    return false;
  }
}

/**
 * Programa (o reprograma) el recordatorio push de `evento` contra el
 * Worker. Se llama desde agenda-modal.js al guardar (alta o edición) y
 * desde agenda.js/agenda-modal.js al des-completar una tarea. No hace
 * nada si:
 *   - "Notificaciones reales" está desactivado en Ajustes.
 *   - El evento está completado (no tiene sentido recordarlo).
 *   - El evento no tiene fecha, o esa fecha/hora ya pasó.
 *   - Por lo que sea, todavía no hay una suscripción push activa (ej. el
 *     usuario activó el switch pero el navegador tardó en confirmar el
 *     permiso) — no bloquea el guardado del evento, simplemente ese
 *     recordatorio puntual no queda programado.
 */
async function programarRecordatorioPush(evento) {
  if (!notificacionesPushActivas()) return;
  if (evento.completada) return cancelarRecordatorioPush(evento.id);
  if (!evento.fecha) return;

  const fechaHoraUtc = calcularFechaHoraUtcRecordatorio(evento);
  if (fechaHoraUtc <= Math.floor(Date.now() / 1000)) return; // ya pasó, no tiene sentido

  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    if (!suscripcion) return;

    const nombreMateria = resolverNombreMateriaEvento(evento);

    await fetch(`${URL_WORKER_NOTIFICACIONES}/programar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: evento.id,
        suscripcion_push: suscripcion.toJSON(),
        fecha_hora_utc: fechaHoraUtc,
        titulo: evento.nombre || "Recordatorio de Agenda",
        cuerpo: nombreMateria || "Agenda",
      }),
    });
  } catch (e) {
    console.warn(`No se pudo programar el recordatorio push de "${evento.id}" (no crítico):`, e);
  }
}

/** Cancela el recordatorio push de un evento (al completarlo o borrarlo). */
async function cancelarRecordatorioPush(eventoId) {
  if (!notificacionesPushActivas()) return;
  try {
    await fetch(`${URL_WORKER_NOTIFICACIONES}/programar/${encodeURIComponent(eventoId)}`, { method: "DELETE" });
  } catch (e) {
    console.warn(`No se pudo cancelar el recordatorio push de "${eventoId}" (no crítico):`, e);
  }
}

/**
 * Recorre TODA la agenda (todos los semestres, no solo el activo — mismo
 * criterio que el resto de la app para operaciones en lote, ej. "Liberar
 * espacio" en config-ajustes.js) y programa contra el Worker los eventos
 * pendientes con fecha futura. Se llama una única vez, justo después de
 * activar el switch de Ajustes — antes de eso no había con qué
 * programarlos (no existía la suscripción), así que sin este barrido
 * quedarían sin push hasta que cada uno se vuelva a editar a mano.
 */
async function reprogramarTodosLosRecordatoriosPendientes() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    if (evento.completada) continue;
    await programarRecordatorioPush(evento);
  }
}

/** Contraparte de arriba: se usa al desactivar el switch de Ajustes. */
async function cancelarTodosLosRecordatoriosPendientes() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    try {
      await fetch(`${URL_WORKER_NOTIFICACIONES}/programar/${encodeURIComponent(evento.id)}`, { method: "DELETE" });
    } catch (e) {
      // best-effort — no crítico, ver comentario al inicio del archivo.
    }
  }
}

/**
 * Notificaciones — Resumen diario (2026-08-20): sincroniza contra
 * POST/DELETE /resumen-config del Worker la preferencia guardada en
 * estado.datos.configuracion.notificaciones_resumen_diario ({ activo,
 * hora }) — ver renderizarNotificacionesResumenDiario en
 * config-ajustes.js, que llama a esto cada vez que cambia el switch o la
 * hora elegida. Mismo criterio best-effort que el resto del archivo: si
 * el Worker no responde, no revierte nada en la UI, solo console.warn.
 *
 * offset_minutos_utc usa la misma convención que
 * Date.prototype.getTimezoneOffset() (minutos a RESTAR a UTC para llegar
 * a la hora local) — ver el comentario en worker-schema.sql/index.js del
 * Worker sobre por qué hace falta mandarlo.
 */
async function sincronizarResumenDiario() {
  if (!notificacionesPushActivas()) return;
  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen) return;

  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    if (!suscripcion) return; // este dispositivo no tiene suscripción activa, nada que sincronizar

    if (!cfgResumen.activo) {
      await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: suscripcion.toJSON().endpoint }),
      });
      return;
    }

    await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suscripcion_push: suscripcion.toJSON(),
        hora_local: cfgResumen.hora || "20:00",
        offset_minutos_utc: new Date().getTimezoneOffset(),
        activo: true,
      }),
    });
  } catch (e) {
    console.warn("No se pudo sincronizar el resumen diario (no crítico):", e);
  }
}

/**
 * Manda una notificación de bienvenida inmediata contra `POST /prueba` del
 * Worker (no crea ningún recordatorio en D1, ver src/index.js del Worker
 * — es solo una prueba end-to-end). Sirve como feedback inmediato para el
 * usuario ("se activó y ya me llegó algo") y como diagnóstico rápido:
 * si esta notificación no llega, el problema está en las claves VAPID o
 * en el Worker, sin tener que esperar al cron ni crear un evento de
 * Agenda de prueba. Devuelve `true`/`false` según si el Worker aceptó
 * mandarla (no confirma que el sistema operativo la haya mostrado — eso
 * ya escapa a lo que se puede saber desde acá).
 */
async function enviarNotificacionDePrueba(suscripcion) {
  try {
    const respuesta = await fetch(`${URL_WORKER_NOTIFICACIONES}/prueba`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ suscripcion_push: suscripcion.toJSON() }),
    });
    return respuesta.ok;
  } catch (e) {
    console.warn("No se pudo mandar la notificación de prueba (no crítico):", e);
    return false;
  }
}

/**
 * Pide permiso de Notification + suscribe con pushManager. Deja
 * "Notificaciones reales" prendido en Ajustes y reprograma todo lo
 * pendiente. Se usa tanto desde el onboarding (ofrecerActivarNotificacionesPush)
 * como desde el switch de Ajustes Avanzados.
 */
async function activarNotificacionesPush() {
  if (!soportaNotificacionesPush()) {
    mostrarToast("Tu navegador no soporta notificaciones push");
    return false;
  }
  try {
    const permiso = await Notification.requestPermission();
    if (permiso !== "granted") {
      mostrarToast(
        permiso === "denied"
          ? "Notificaciones bloqueadas — revisá los permisos del sitio en tu navegador"
          : "No se activaron las notificaciones"
      );
      return false;
    }

    const registro = await navigator.serviceWorker.ready;
    let suscripcion = await registro.pushManager.getSubscription();
    if (!suscripcion) {
      suscripcion = await registro.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertirClaveVapidAUint8Array(VAPID_CLAVE_PUBLICA),
      });
    }

    // Prueba end-to-end ANTES de dar el switch por activado en la UI: así
    // el toast puede reflejar si el Worker realmente respondió o no, en
    // vez de asumir que todo salió bien solo porque el navegador aceptó
    // la suscripción (eso solo prueba el lado del cliente).
    const pruebaOk = await enviarNotificacionDePrueba(suscripcion);

    estado.datos.configuracion.notificaciones_push_activas = true;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();

    mostrarToast(
      pruebaOk
        ? "Notificaciones activadas — deberías recibir un aviso de confirmación en unos segundos"
        : "Notificaciones activadas, pero la prueba no llegó al Worker — revisá que esté desplegado y bien configurado (no bloquea el resto de la Agenda)"
    );

    reprogramarTodosLosRecordatoriosPendientes();
    sincronizarResumenDiario();
    return true;
  } catch (e) {
    console.error("No se pudo activar las notificaciones push:", e);
    mostrarToast("No se pudo activar las notificaciones. Intenta de nuevo.");
    return false;
  }
}

/** Apaga el switch de Ajustes, cancela lo programado y se desuscribe del push. */
async function desactivarNotificacionesPush() {
  estado.datos.configuracion.notificaciones_push_activas = false;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();

  await cancelarTodosLosRecordatoriosPendientes();

  try {
    if (soportaNotificacionesPush()) {
      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.getSubscription();
      if (suscripcion) {
        // Mismo momento en que se cancelan los recordatorios pendientes —
        // ver comentario de manejarBorrarResumenConfig en index.js del
        // Worker. Se hace ANTES de unsubscribe() porque necesita el
        // endpoint de la suscripción todavía viva.
        await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: suscripcion.toJSON().endpoint }),
        }).catch(() => {}); // best-effort, no crítico
        await suscripcion.unsubscribe();
      }
    }
  } catch (e) {
    console.warn("No se pudo desuscribir del push (no crítico):", e);
  }
}

/**
 * Onboarding — se llama UNA vez, desde main.js, justo después del primer
 * login de una cuenta nueva (esArchivoNuevo). Se acepte o no, el switch
 * sigue disponible después en Ajustes Avanzados en cualquier momento (ver
 * config/config-ajustes.js) — acá solo se ofrece la primera vez para no
 * ser invasivo con logins siguientes.
 */
function ofrecerActivarNotificacionesPush() {
  if (!soportaNotificacionesPush()) return;
  abrirConfirmacion({
    titulo: "¿Activar notificaciones reales?",
    mensaje:
      "Recibí un aviso en tu dispositivo cuando se acerque una tarea, examen o evento de tu Agenda — incluso con la app cerrada. Podés activarlo o desactivarlo cuando quieras desde Ajustes.",
    textoConfirmar: "Activar",
    onConfirmar: () => activarNotificacionesPush(),
  });
}

export {
  activarNotificacionesPush,
  cancelarRecordatorioPush,
  desactivarNotificacionesPush,
  notificacionesPushActivas,
  notificacionesPushActivasEnEsteDispositivo,
  ofrecerActivarNotificacionesPush,
  programarRecordatorioPush,
  sincronizarResumenDiario,
  soportaNotificacionesPush,
  // Ronda 2026-08-23 (Bandeja pendiente / Captura por voz): asistente-bandeja.js
  // reusa esta misma constante para hablar con el Worker en vez de
  // hardcodear una segunda copia de la URL — un solo lugar de verdad.
  URL_WORKER_NOTIFICACIONES,
};
