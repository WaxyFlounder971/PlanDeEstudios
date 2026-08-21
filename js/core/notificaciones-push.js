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

   Ronda 2026-08-20 — Recordatorios configurables por tipo + Resumen
   diario: cambios respecto a la versión anterior de este archivo:
     - programarRecordatorioPush ya NO manda un solo recordatorio: lee
       configuracion.notificaciones_recordatorios[tipo] (ver core/schema.js)
       y programa UNA fila en el Worker por cada offset activo, con id
       compuesto "eventoId::offset" (POST /programar, uno por offset).
     - cancelarRecordatorioPush pasa a llamar a
       DELETE /programar-evento/:eventoId (cancela TODOS los offsets de
       ese evento de una vez) en vez de DELETE /programar/:id — el Worker
       es quien sabe encontrarlos todos por prefijo, el cliente no
       necesita enumerar qué offsets estaban activos.
     - programarRecordatorioPush también manda fecha_evento + evento_id en
       CADA llamada a /programar (mismo dato repetido en cada offset, el
       Worker solo se queda con la última vía upsert) para alimentar
       eventos_activos, que el resumen diario del Worker usa para saber
       "¿hay algo mañana?".
     - Nuevas funciones: sincronizarResumenDiario() (upsert/borrado de la
       preferencia de resumen en el Worker) y activarNotificacionesPush ya
       la llama una vez al activar el switch general, si el resumen diario
       ya estaba marcado como activo desde antes.
   ========================================================================= */

import { sellarTimestamp, OFFSETS_RECORDATORIO_AGENDA, SEPARADOR_ID_RECORDATORIO_OFFSET } from "./schema.js";
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
 * A diferencia de notificacionesPushActivas() (que lee un flag de
 * estado.datos.configuracion y por lo tanto sincroniza por Drive entre
 * TODOS los dispositivos de la cuenta), esto chequea si ESTE navegador en
 * particular tiene de verdad el permiso concedido Y una suscripción push
 * viva. Necesario porque el permiso del navegador es por dispositivo: si
 * activaste notificaciones desde el celular, la config sincronizada dice
 * "activas" también en la PC aunque la PC nunca haya dado el permiso ni
 * tenga suscripción propia — sin este chequeo, el switch de Ajustes
 * mostraría "prendido" en un dispositivo que en realidad no va a recibir
 * nada. Usar en el render del switch en vez de notificacionesPushActivas()
 * a secas.
 */
async function notificacionesPushActivasEnEsteDispositivo() {
  if (!notificacionesPushActivas()) return false;
  if (!soportaNotificacionesPush()) return false;
  if (Notification.permission !== "granted") return false;
  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    return Boolean(suscripcion);
  } catch (e) {
    return false;
  }
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
 * fecha_hora_utc (timestamp Unix en SEGUNDOS) del momento EXACTO del
 * evento — hora real si tiene hora definida; si es de día completo, 8:00
 * AM hora local de ese día (criterio default acordado, sin cambios de la
 * versión anterior). Se arma la fecha a mano con los componentes del ISO
 * (en vez de `new Date(evento.fecha)`, que Chrome interpreta como UTC
 * medianoche y termina corriendo un día para atrás en zonas horarias
 * negativas) — mismo motivo por el que el resto de Agenda usa
 * fechaLocalDesdeISO en horario.js.
 *
 * Ronda 2026-08-20: esta función ahora es la base sobre la que se restan
 * los minutosAntes de cada offset (ver
 * calcularFechaHoraUtcConOffset más abajo) — antes era el único cálculo
 * que existía, ahora es un paso intermedio.
 */
function calcularFechaHoraUtcMomentoExacto(evento) {
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

/** fecha_hora_utc del AVISO, restando minutosAntes al momento exacto del evento. */
function calcularFechaHoraUtcConOffset(evento, minutosAntes) {
  return calcularFechaHoraUtcMomentoExacto(evento) - minutosAntes * 60;
}

async function obtenerSuscripcionPushActiva() {
  if (!soportaNotificacionesPush()) return null;
  const registro = await navigator.serviceWorker.ready;
  return registro.pushManager.getSubscription();
}

/**
 * Offsets activos para el TIPO de `evento` — lee
 * configuracion.notificaciones_recordatorios[tipo] y filtra contra
 * OFFSETS_RECORDATORIO_AGENDA (por si quedó guardado algún id que ya no
 * existe más, ej. una versión vieja de la lista de offsets). Un evento
 * tipo "evento" con es_feriado:true usa el conjunto de "feriado" en vez de
 * "evento" — mismo criterio de subtipo especial que ya usa el resto de
 * Agenda para "Es feriado" (ver crearEventoAgenda en core/schema.js).
 */
function obtenerOffsetsActivosParaEvento(evento) {
  const tipoConfig = evento.tipo === "evento" && evento.es_feriado ? "feriado" : evento.tipo;
  const idsGuardados = estado.datos?.configuracion?.notificaciones_recordatorios?.[tipoConfig] || ["1_dia"];
  return OFFSETS_RECORDATORIO_AGENDA.filter((o) => idsGuardados.includes(o.id));
}

/**
 * Programa (o reprograma) TODOS los recordatorios activos de `evento`
 * contra el Worker — uno por cada offset configurado para su tipo (ver
 * obtenerOffsetsActivosParaEvento). Se llama desde agenda-modal.js al
 * guardar (alta o edición) y desde agenda.js/agenda-modal.js al
 * des-completar una tarea.
 *
 * Primero cancela lo que hubiera antes (DELETE /programar-evento/:id) y
 * recién después programa el set nuevo — más simple y más robusto que
 * intentar diffear "qué offset se agregó/quitó" contra lo que el Worker
 * ya tenía: si el usuario cambió la config de offsets entre un guardado y
 * otro, un diff a ciegas podría dejar huérfano un offset viejo que ya no
 * corresponde. Es más tráfico de red, pero estas llamadas son poco
 * frecuentes (una por guardado de evento, no por tecla) y best-effort de
 * cualquier forma.
 *
 * No hace nada si:
 *   - "Notificaciones reales" está desactivado en Ajustes.
 *   - El evento está completado (no tiene sentido recordarlo).
 *   - El evento no tiene fecha.
 *   - Por lo que sea, todavía no hay una suscripción push activa (ej. el
 *     usuario activó el switch pero el navegador tardó en confirmar el
 *     permiso) — no bloquea el guardado del evento, simplemente esos
 *     recordatorios puntuales no quedan programados.
 * Offsets cuya fecha_hora_utc calculada ya pasó se saltan individualmente
 * (ej. "1 día antes" ya pasó pero "15 min antes" todavía no) — no todo o
 * nada por evento.
 */
async function programarRecordatorioPush(evento) {
  if (!notificacionesPushActivas()) return;
  if (evento.completada) return cancelarRecordatorioPush(evento.id);
  if (!evento.fecha) return;

  // Cancela lo anterior primero — ver comentario arriba sobre por qué no
  // se intenta diffear offset por offset.
  await cancelarRecordatorioPush(evento.id);

  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    if (!suscripcion) return;

    const nombreMateria = resolverNombreMateriaEvento(evento);
    const ahoraSegundos = Math.floor(Date.now() / 1000);
    const offsets = obtenerOffsetsActivosParaEvento(evento);

    for (const offset of offsets) {
      const fechaHoraUtc = calcularFechaHoraUtcConOffset(evento, offset.minutosAntes);
      if (fechaHoraUtc <= ahoraSegundos) continue; // este offset puntual ya pasó — se salta, no todo el evento

      await fetch(`${URL_WORKER_NOTIFICACIONES}/programar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: `${evento.id}${SEPARADOR_ID_RECORDATORIO_OFFSET}${offset.id}`,
          suscripcion_push: suscripcion.toJSON(),
          fecha_hora_utc: fechaHoraUtc,
          titulo: evento.nombre || "Recordatorio de Agenda",
          cuerpo: nombreMateria || "Agenda",
          // Alimenta eventos_activos del Worker (para el resumen diario) —
          // mismo evento_id/fecha_evento en cada offset, el Worker hace
          // upsert por evento_id así que solo se queda con la última
          // escritura (da igual el orden entre offsets).
          evento_id: evento.id,
          fecha_evento: evento.fecha,
        }),
      });
    }
  } catch (e) {
    console.warn(`No se pudo programar los recordatorios push de "${evento.id}" (no crítico):`, e);
  }
}

/**
 * Cancela TODOS los recordatorios push de un evento (todos los offsets a
 * la vez) y su fila de eventos_activos — un solo request al Worker (ver
 * DELETE /programar-evento/:eventoId en worker-notificaciones/index.js),
 * en vez de tener que conocer y borrar cada offset por separado.
 */
async function cancelarRecordatorioPush(eventoId) {
  if (!notificacionesPushActivas()) return;
  try {
    await fetch(`${URL_WORKER_NOTIFICACIONES}/programar-evento/${encodeURIComponent(eventoId)}`, { method: "DELETE" });
  } catch (e) {
    console.warn(`No se pudo cancelar los recordatorios push de "${eventoId}" (no crítico):`, e);
  }
}

/**
 * Notificaciones — Resumen diario (2026-08-20): sincroniza contra el
 * Worker la preferencia actual (configuracion.notificaciones_resumen_diario)
 * de ESTE dispositivo. Se llama:
 *   - Al guardar el ajuste en Configuraciones (switch activo / hora
 *     elegida) — ver config/config-ajustes.js.
 *   - Al activar notificaciones push por primera vez, si el resumen ya
 *     estaba marcado como activo desde otra sesión/dispositivo (para que
 *     el Worker tenga la suscripción de ESTE dispositivo nueva, no la de
 *     antes).
 *
 * Manda offset_minutos_utc de ESTE navegador (Date.getTimezoneOffset(),
 * mismo signo/convención que usa el Worker — ver schema.sql del Worker)
 * porque el servidor no tiene otra forma de saber la zona horaria real del
 * usuario. Si notificaciones_resumen_diario.activo es false, en vez de
 * upsertear se llama a DELETE /resumen-config — apagar el switch no debe
 * dejar una fila "inactiva" dando vueltas indefinidamente en el Worker.
 */
async function sincronizarResumenDiario() {
  if (!notificacionesPushActivas()) return;
  const config = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!config) return;

  try {
    if (!config.activo) {
      const suscripcion = await obtenerSuscripcionPushActiva();
      if (suscripcion) {
        await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: suscripcion.toJSON().endpoint }),
        });
      }
      return;
    }

    const suscripcion = await obtenerSuscripcionPushActiva();
    if (!suscripcion) return; // switch general activo pero esta suscripción puntual todavía no está lista

    await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        suscripcion_push: suscripcion.toJSON(),
        hora_local: config.hora || "20:00",
        offset_minutos_utc: new Date().getTimezoneOffset(),
        activo: true,
      }),
    });
  } catch (e) {
    console.warn("No se pudo sincronizar el resumen diario (no crítico):", e);
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

/**
 * Contraparte de arriba: se usa al desactivar el switch de Ajustes.
 * Ronda 2026-08-20: usa el mismo endpoint de cancelación por evento
 * (/programar-evento) que cancelarRecordatorioPush, así también se limpia
 * eventos_activos y no solo recordatorios sueltos.
 */
async function cancelarTodosLosRecordatoriosPendientes() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    try {
      await fetch(`${URL_WORKER_NOTIFICACIONES}/programar-evento/${encodeURIComponent(evento.id)}`, { method: "DELETE" });
    } catch (e) {
      // best-effort — no crítico, ver comentario al inicio del archivo.
    }
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
    // la suscripción (eso solo prueba el lado del cliente). Si la prueba
    // falla, se corta acá — a propósito NO se marca
    // notificaciones_push_activas = true: dejar el switch prendido cuando
    // el pipeline real no funciona (permiso + suscripción sin Worker
    // funcionando del otro lado) es peor que dejarlo apagado, porque el
    // usuario cree que le va a llegar el aviso y nunca le llega. El
    // switch en Ajustes ya se encarga de destildarse solo cuando esta
    // función devuelve false.
    const pruebaOk = await enviarNotificacionDePrueba(suscripcion);
    if (!pruebaOk) {
      mostrarToast(
        "El permiso se concedió, pero la prueba no llegó al Worker — no se activaron las notificaciones. Revisá que esté desplegado y bien configurado, y probá de nuevo."
      );
      return false;
    }

    estado.datos.configuracion.notificaciones_push_activas = true;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();

    mostrarToast("Notificaciones activadas — deberías recibir un aviso de confirmación en unos segundos");

    reprogramarTodosLosRecordatoriosPendientes();
    // Ronda 2026-08-20: si el resumen diario ya estaba marcado como activo
    // (ej. reactivando notificaciones después de haberlas desactivado, con
    // la preferencia de resumen todavía en true), se vuelve a sincronizar
    // contra el Worker con la suscripción nueva de este dispositivo.
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

  // Se cancela el resumen diario ANTES de desuscribirse (necesita la
  // suscripción todavía viva para poder mandar su endpoint al Worker) —
  // mismo orden de dependencia que cancelarTodosLosRecordatoriosPendientes
  // justo debajo, que también corre antes del unsubscribe().
  await sincronizarResumenDiarioApagado();
  await cancelarTodosLosRecordatoriosPendientes();

  try {
    if (soportaNotificacionesPush()) {
      const registro = await navigator.serviceWorker.ready;
      const suscripcion = await registro.pushManager.getSubscription();
      if (suscripcion) await suscripcion.unsubscribe();
    }
  } catch (e) {
    console.warn("No se pudo desuscribir del push (no crítico):", e);
  }
}

/**
 * Variante interna de sincronizarResumenDiario() usada SOLO desde
 * desactivarNotificacionesPush(): a diferencia de la función pública (que
 * lee config.activo de estado.datos para decidir upsert vs. delete), acá
 * se fuerza el DELETE sin importar qué diga notificaciones_resumen_diario
 * — al apagar el switch GENERAL, el resumen diario de ESTE dispositivo se
 * cancela sí o sí en el Worker, aunque la preferencia guardada siga en
 * `activo: true` para cuando se vuelva a activar más adelante (no se toca
 * ese campo acá, es intencional: es la preferencia del usuario, no el
 * estado actual de la suscripción).
 */
async function sincronizarResumenDiarioApagado() {
  try {
    const suscripcion = await obtenerSuscripcionPushActiva();
    if (!suscripcion) return;
    await fetch(`${URL_WORKER_NOTIFICACIONES}/resumen-config`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: suscripcion.toJSON().endpoint }),
    });
  } catch (e) {
    console.warn("No se pudo cancelar el resumen diario (no crítico):", e);
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
};
