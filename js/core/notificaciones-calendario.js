/* =========================================================================
   SINCRONIZACIÓN CON GOOGLE CALENDAR (cliente)
   -------------------------------------------------------------------------
   2026-08-25 — Reemplaza por completo al viejo notificaciones-push.js
   (Web Push + VAPID + Cloudflare Worker con Cron). La entrega de avisos
   pasa a ser un Calendario Secundario de Google ("AppAcademica") por
   usuario: cada tarea/examen/evento con fecha se refleja como un evento en
   ese calendario, con un recordatorio popup nativo — lo procesa el propio
   sistema operativo con máxima prioridad, evitando Doze Mode en Android y
   las restricciones de Safari/iOS que hacían que Web Push no llegara de
   forma confiable en la práctica.

   Este archivo habla DIRECTO contra la API de Google Calendar (helpers
   crudos en auth.js: crearCalendarioSecundario/insertarEventoCalendar/
   actualizarEventoCalendar/eliminarEventoCalendar) usando el access_token
   de la sesión ya autenticada — a diferencia del viejo archivo, YA NO
   habla con el Worker de Cloudflare para nada de esto (el Worker sigue
   existiendo solo para /oauth/exchange y /oauth/refresh, ver auth.js).

   Toda llamada de red de este archivo sigue siendo "best-effort" (mismo
   criterio que el archivo viejo): si Google Calendar no responde (sin
   internet, token vencido y el refresh también falla, error de API) NUNCA
   se bloquea ni se revierte la acción real del usuario en Agenda (guardar/
   completar/borrar) — el EventoAgenda ya se guardó en el JSON local/Drive
   ANTES de que se llame a cualquier función de este archivo (fuente de
   verdad), y el próximo sync exitoso reintenta reflejar lo que haya
   quedado pendiente. Como mucho, ese evento puntual no queda espejado en
   Calendar todavía, y se avisa por console.warn.

   *** CORRECCIÓN 2026-08-25 (misma sesión): la primera versión de este
   archivo asumía un `obtenerAccessTokenActual()` en storage-sync.js que no
   está confirmado — al revisar MAPA_FUNCIONES.md apareció la integración
   real ya documentada: storage.js expone `estado.token` directo, y
   storage-sync.js ya tiene `asegurarTokenValido()` (consigue/refresca un
   token válido sin popup) y `conReintentoSi401(operacion)` (envuelve una
   llamada; si da 401, refresca y reintenta una vez) — pensados para Drive,
   pero genéricos, así que se reusan tal cual acá para Calendar. Mismo
   patrón, un solo lugar. Si `conReintentoSi401` resultara ser específico
   de Drive en el código real (no visto en esta sesión), ajustar acá. ***
   ========================================================================= */

import {
  sellarTimestamp,
  NOMBRE_CALENDARIO_SECUNDARIO,
  COLOR_ID_GOOGLE_CALENDAR_POR_TIPO,
  OFFSETS_RECORDATORIO_AGENDA,
} from "./schema.js";
import { marcarCambioPendiente, asegurarTokenValido, conReintentoSi401 } from "./storage-sync.js";
import { estado } from "./storage.js";
import { aplicarFormatoTexto } from "./utils.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
// 2026-08-26: import circular intencional (mismo patrón ya usado por
// storage-sync.js con main.js, ver ARQUITECTURA.md) — se necesita
// cerrarSesion() para que el aviso de "falta permiso de Calendar" (ver
// avisarFaltaPermisoCalendar) pueda ofrecer cerrar sesión con una sola
// acción, en vez de solo indicarle al usuario que lo haga a mano desde el
// menú de perfil.
import { cerrarSesion } from "../main.js";
import {
  tieneScopeCalendarOtorgado,
  crearCalendarioSecundario,
  insertarEventoCalendar,
  actualizarEventoCalendar,
  eliminarEventoCalendar,
} from "./auth.js";

// *** VER NOTA DE INTEGRACIÓN ARRIBA *** — confirmar contra el ruteo real.
// Mismo patrón que ya usa main.js para el deep link de una notificación
// push tocada (`?abrir=agenda`, ver mostrarApp() en MAPA_FUNCIONES.md) —
// se reusa la misma convención de query param en vez de un hash, para el
// Resumen Diario (`?abrir=resumen`). OJO: mostrarApp() tendría que sumar
// el caso "resumen" a ese mismo `if` que hoy solo mira "agenda" — no visto
// en esta sesión, confirmar/ajustar en main.js.
const ORIGEN_APP = "https://waxyflounder971.github.io";
const DEEP_LINK_RESUMEN = `${ORIGEN_APP}/?abrir=resumen`;

/**
 * *** INTEGRACIÓN PENDIENTE DE VERIFICAR (no tuve acceso a agenda.js/
 * agenda-modal.js en esta sesión) ***
 * Antes llamaban a programarRecordatorioPush(evento)/
 * cancelarRecordatorioPush(evento.id). Ahora deben llamar a
 * sincronizarEventoCalendario(evento) igual que antes, PERO
 * eliminarEventoCalendarizado(evento) en el borrado YA NO acepta solo el
 * id — necesita el objeto evento COMPLETO (con google_calendar_event_id)
 * ANTES de sacarlo de estado.datos.agenda, porque a diferencia del id
 * compuesto que usaba el Worker, acá hace falta el id real que asignó
 * Google. Revisar y actualizar esos 2 archivos como parte de esta misma
 * migración.
 */

/** Fuente de verdad del switch de Ajustes — ver config/config-ajustes.js.
 *  Reemplaza a notificacionesPushActivas(); el campo viejo
 *  (notificaciones_push_activas, nunca declarado de fábrica en schema.js)
 *  se migra una sola vez a sincronizar_calendario_google en
 *  migrarDatosAntiguos (schema.js). */
function sincronizacionCalendarActiva() {
  return Boolean(estado.datos?.configuracion?.sincronizar_calendario_google);
}

/**
 * Mismo criterio de "nombre legible de la materia vinculada" que ya usaba
 * agenda-modal.js (obtenerNombreMateriaEvento) — se resuelve acá mismo,
 * igual que en el archivo viejo, para no depender de agenda.js/
 * agenda-modal.js (evita un import circular: son ellos los que llaman A
 * este archivo).
 */
function resolverNombreMateriaEvento(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? aplicarFormatoTexto(materia.nombre) : "";
}

/** "tarea"/"examen"/"evento", pero un evento con es_feriado usa su propio
 *  set de offsets/color — mismo criterio que ya usaba configuracion.
 *  notificaciones_recordatorios (4 claves: tarea/examen/evento/feriado). */
function tipoEfectivoParaNotificaciones(evento) {
  return evento.es_feriado ? "feriado" : evento.tipo;
}

/**
 * Arma reminders.overrides a partir de los offsets configurados (multi-
 * selección por tipo, ver configuracion.notificaciones_recordatorios) —
 * cada offset activo es un popup separado, tal como pedía B.2. Offsets
 * fuera de OFFSETS_RECORDATORIO_AGENDA se ignoran en silencio, mismo
 * criterio que ya documentaba schema.js para el mecanismo viejo.
 */
function construirRecordatoriosGoogle(tipoEfectivo) {
  const offsetsActivos = estado.datos?.configuracion?.notificaciones_recordatorios?.[tipoEfectivo] || [];
  const overrides = offsetsActivos
    .map((offsetId) => OFFSETS_RECORDATORIO_AGENDA.find((o) => o.id === offsetId))
    .filter(Boolean)
    .map((offset) => ({ method: "popup", minutes: offset.minutosAntes }));

  // Sin ningún offset activo para este tipo: se manda igual
  // reminders.useDefault=false con overrides vacío — así el evento NO
  // hereda los recordatorios default del calendario (que podrían no
  // coincidir con lo que el usuario configuró), en vez de dejarlo con
  // reminders implícitos fuera de nuestro control.
  return overrides;
}

/**
 * Traduce un EventoAgenda al payload que espera events.insert/update de
 * Google Calendar (Parte B.1-B.3). `hora: null` (día completo) usa
 * start/end.date; con hora puntual usa start/end.dateTime con una
 * duración fija de 30 min (Calendar exige end > start; la app no modela
 * duración de eventos de Agenda, así que 30 min es un placeholder
 * razonable — ajustable acá si en algún momento se agrega ese campo).
 *
 * OJO con eventos de día completo: el offset "antes" se calcula desde la
 * medianoche de ese día (ej. "1 hora antes" dispara 23:00 del día previo)
 * — es una limitación conocida de reusar los mismos offsets para ambos
 * casos, no algo que el spec haya pedido resolver de otra forma.
 */
function construirEventoGoogleDesdeAgenda(evento) {
  const tipoEfectivo = tipoEfectivoParaNotificaciones(evento);
  const nombreMateria = resolverNombreMateriaEvento(evento);
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cuerpo = {
    summary: evento.nombre || "Evento de Agenda",
    description: [nombreMateria, evento.notas].filter(Boolean).join("\n\n"),
    colorId: COLOR_ID_GOOGLE_CALENDAR_POR_TIPO[tipoEfectivo] || undefined,
    reminders: {
      useDefault: false,
      overrides: construirRecordatoriosGoogle(tipoEfectivo),
    },
    // Referencia cruzada para poder reconciliar manualmente si hiciera
    // falta (ej. debug, o una futura reconstrucción del índice) — Google
    // conserva extendedProperties.private en updates/reads normales.
    extendedProperties: { private: { app_evento_id: evento.id } },
  };

  if (evento.hora) {
    const inicio = `${evento.fecha}T${evento.hora}:00`;
    const [h, m] = evento.hora.split(":").map(Number);
    const finDate = new Date(`${evento.fecha}T00:00:00`);
    finDate.setHours(h, m + 30, 0, 0);
    const fin = `${finDate.getFullYear()}-${String(finDate.getMonth() + 1).padStart(2, "0")}-${String(finDate.getDate()).padStart(2, "0")}T${String(finDate.getHours()).padStart(2, "0")}:${String(finDate.getMinutes()).padStart(2, "0")}:00`;
    cuerpo.start = { dateTime: inicio, timeZone: zonaHoraria };
    cuerpo.end = { dateTime: fin, timeZone: zonaHoraria };
  } else {
    const finDate = new Date(`${evento.fecha}T00:00:00`);
    finDate.setDate(finDate.getDate() + 1); // Calendar: end.date es EXCLUSIVO
    const finIso = `${finDate.getFullYear()}-${String(finDate.getMonth() + 1).padStart(2, "0")}-${String(finDate.getDate()).padStart(2, "0")}`;
    cuerpo.start = { date: evento.fecha };
    cuerpo.end = { date: finIso };
  }

  return cuerpo;
}

/**
 * Asegura un token utilizable ANTES de armar el payload (asegurarTokenValido
 * ya deduplica refrescos en paralelo y muestra el aviso de reconexión si
 * hiciera falta, mismo comportamiento que ya usa el resto de la app contra
 * Drive) y envuelve la llamada real con conReintentoSi401 — reintenta una
 * vez sola si Google Calendar responde 401 con un token que resultó estar
 * vencido pese al chequeo previo (race condition rara, pero conReintentoSi401
 * ya cubre ese caso para Drive, se reusa igual acá).
 */
async function conTokenValido(fn) {
  const listo = await asegurarTokenValido();
  if (!listo) throw new Error("No hay sesión de Google activa.");
  return conReintentoSi401(() => fn(estado.token));
}

/**
 * Devuelve el id del calendario secundario "AppAcademica", creándolo la
 * PRIMERA vez que hace falta (Parte A.2) — se revisa
 * estado.datos.configuracion.google_calendar_id antes de crear nada, para
 * no duplicar el calendario en cada sesión/dispositivo. Si dos
 * dispositivos llegaran a crear el calendario en paralelo antes de
 * sincronizar entre sí, quedarían 2 calendarios "AppAcademica" separados
 * en la cuenta — caso borde no resuelto acá (best-effort, mismo espíritu
 * que el resto de la app con conflictos de sync), el usuario podría
 * borrar el duplicado a mano desde Google Calendar si llegara a pasar.
 */
async function asegurarCalendarioSecundario() {
  const idExistente = estado.datos?.configuracion?.google_calendar_id;
  if (idExistente) return idExistente;

  const calendario = await conTokenValido((token) => crearCalendarioSecundario(token, NOMBRE_CALENDARIO_SECUNDARIO));
  estado.datos.configuracion.google_calendar_id = calendario.id;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
  return calendario.id;
}

/**
 * Crea/actualiza el evento espejo de `evento` en el calendario secundario
 * (Parte B.1). Se llama desde agenda-modal.js al guardar (alta o edición)
 * y desde agenda.js/agenda-modal.js al completar/des-completar una tarea
 * — mismo punto de entrada único que tenía programarRecordatorioPush.
 *
 * No hace nada (silencioso, no es un error) si:
 *   - La sincronización con Calendar está desactivada en Ajustes.
 *   - El usuario nunca otorgó el scope de Calendar (login viejo, o lo
 *     destildó en el consentimiento).
 *   - El evento no tiene fecha.
 * Si el evento está completado, se elimina su espejo en vez de
 * actualizarlo (mismo criterio que el archivo viejo con
 * cancelarRecordatorioPush).
 *
 * Best-effort (Parte B.4): cualquier fallo de red/API queda en
 * console.warn, nunca se propaga — el EventoAgenda ya está guardado en la
 * fuente de verdad (JSON local/Drive) antes de que esto se llame.
 */
async function sincronizarEventoCalendario(evento) {
  if (!sincronizacionCalendarActiva()) return;
  if (!tieneScopeCalendarOtorgado()) return;
  if (evento.completada) return eliminarEventoCalendarizado(evento);
  if (!evento.fecha) return;

  try {
    const calendarId = await asegurarCalendarioSecundario();
    const cuerpo = construirEventoGoogleDesdeAgenda(evento);

    if (evento.google_calendar_event_id) {
      try {
        await conTokenValido((token) => actualizarEventoCalendar(token, calendarId, evento.google_calendar_event_id, cuerpo));
        return;
      } catch (e) {
        // El evento fue borrado del lado de Calendar por fuera de la app
        // (ej. el usuario lo borró a mano) — se limpia el id guardado y se
        // cae al insert de abajo para recrearlo, en vez de quedar
        // apuntando a un id muerto para siempre.
        if (e && (e.status === 404 || e.status === 410)) {
          evento.google_calendar_event_id = null;
        } else {
          throw e;
        }
      }
    }

    const creado = await conTokenValido((token) => insertarEventoCalendar(token, calendarId, cuerpo));
    evento.google_calendar_event_id = creado.id;
    sellarTimestamp(evento);
    marcarCambioPendiente();
  } catch (e) {
    console.warn(`No se pudo sincronizar el evento "${evento.id}" con Google Calendar (no crítico):`, e);
  }
}

/**
 * Elimina el espejo de `evento` en Calendar (al borrar el EventoAgenda de
 * Agenda, o al completar una tarea — ver sincronizarEventoCalendario).
 * A DIFERENCIA del viejo cancelarRecordatorioPush(eventoId), necesita el
 * objeto `evento` COMPLETO (con su google_calendar_event_id), no solo el
 * id — ver nota de integración al inicio del archivo: agenda.js/
 * agenda-modal.js deben llamar a esto ANTES de sacar el evento de
 * estado.datos.agenda.
 */
async function eliminarEventoCalendarizado(evento) {
  if (!sincronizacionCalendarActiva()) return;
  if (!evento || !evento.google_calendar_event_id) return;
  try {
    const calendarId = await asegurarCalendarioSecundario();
    await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, evento.google_calendar_event_id));
    evento.google_calendar_event_id = null;
  } catch (e) {
    console.warn(`No se pudo eliminar de Google Calendar el evento "${evento.id}" (no crítico):`, e);
  }
}

/**
 * Recorre TODA la agenda (todos los semestres, mismo criterio que el
 * archivo viejo para operaciones en lote) y sincroniza contra Calendar los
 * eventos pendientes. Se llama una única vez, justo después de activar el
 * switch de Ajustes — antes de eso no había calendario secundario contra
 * el cual sincronizar nada.
 */
async function resincronizarTodaLaAgendaConCalendar() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    if (evento.completada) continue;
    await sincronizarEventoCalendario(evento);
  }
}

/** Contraparte de arriba — se usa al desactivar el switch de Ajustes: borra
 *  de Calendar todos los eventos espejados (el calendario secundario en sí
 *  NO se borra, para no perder el ID guardado ni tener que recrearlo si el
 *  usuario vuelve a activar la sincronización después). */
async function eliminarTodosLosEventosCalendarizados() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    if (!evento.google_calendar_event_id) continue;
    try {
      const calendarId = await asegurarCalendarioSecundario();
      await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, evento.google_calendar_event_id));
    } catch (e) {
      console.warn(`No se pudo eliminar de Google Calendar el evento "${evento.id}" (no crítico):`, e);
    }
    evento.google_calendar_event_id = null;
  }
  sellarTimestamp(estado.datos);
  marcarCambioPendiente();
}

/**
 * Notificaciones — Resumen diario (Parte C): UN solo evento recurrente
 * (RRULE:FREQ=DAILY) en vez de un evento por día — si el usuario cambia la
 * hora, se actualiza ESE MISMO evento (events.update), nunca se crea uno
 * nuevo (Parte C.1). Contenido fijo y genérico + source.url con el deep
 * link a la sección Resumen (Parte C.2) — el contenido real se genera al
 * vuelo cuando el usuario realmente abre la app (Parte C.3, sin cambios
 * ahí).
 *
 * Se llama desde renderizarNotificacionesResumenDiario en
 * config-ajustes.js cada vez que cambia el switch o la hora elegida —
 * mismo punto de entrada que tenía el archivo viejo.
 */
async function sincronizarResumenDiario() {
  const idGuardado = estado.datos?.configuracion?.google_calendar_resumen_evento_id;

  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) {
    // La sincronización general está apagada (o nunca se autorizó
    // Calendar): si había un evento recurrente de una activación previa,
    // se borra igual acá (no depende de cfgResumen.activo) — si no,
    // quedaría huérfano en Calendar sin que el switch general lo sepa.
    if (idGuardado) await eliminarEventoResumenSiExiste();
    return;
  }

  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen) return;

  try {
    if (!cfgResumen.activo) {
      await eliminarEventoResumenSiExiste();
      return;
    }

    const calendarId = await asegurarCalendarioSecundario();
    const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const hora = cfgResumen.hora || "20:00";
    const hoyIso = new Date().toISOString().slice(0, 10);
    const [h, m] = hora.split(":").map(Number);
    const finDate = new Date(`${hoyIso}T00:00:00`);
    finDate.setHours(h, m + 15, 0, 0);
    const finHora = `${String(finDate.getHours()).padStart(2, "0")}:${String(finDate.getMinutes()).padStart(2, "0")}:00`;

    const cuerpo = {
      summary: "📚 Tu resumen académico de hoy",
      description: "Toca para ver tu resumen académico de hoy 👋",
      start: { dateTime: `${hoyIso}T${hora}:00`, timeZone: zonaHoraria },
      end: { dateTime: `${hoyIso}T${finHora}`, timeZone: zonaHoraria },
      recurrence: ["RRULE:FREQ=DAILY"],
      reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
      source: { url: DEEP_LINK_RESUMEN, title: "Resumen académico" },
    };

    if (idGuardado) {
      await conTokenValido((token) => actualizarEventoCalendar(token, calendarId, idGuardado, cuerpo));
      return;
    }

    const creado = await conTokenValido((token) => insertarEventoCalendar(token, calendarId, cuerpo));
    estado.datos.configuracion.google_calendar_resumen_evento_id = creado.id;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  } catch (e) {
    console.warn("No se pudo sincronizar el Resumen Diario con Google Calendar (no crítico):", e);
  }
}

/** Borra el evento recurrente del Resumen Diario si existe, y limpia el id
 *  guardado — factoreado aparte porque sincronizarResumenDiario lo llama
 *  desde 2 casos distintos (switch general apagado, o switch de resumen
 *  apagado en particular). */
async function eliminarEventoResumenSiExiste() {
  const idGuardado = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (!idGuardado) return;
  try {
    const calendarId = await asegurarCalendarioSecundario();
    await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, idGuardado));
  } catch (e) {
    console.warn("No se pudo borrar el evento recurrente del Resumen Diario (no crítico):", e);
  } finally {
    estado.datos.configuracion.google_calendar_resumen_evento_id = null;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }
}

/**
 * Prende el switch de Ajustes, crea el calendario secundario si hace
 * falta, y sincroniza todo lo pendiente + el Resumen Diario. Se usa tanto
 * desde el onboarding (ofrecerActivarSincronizacionCalendario) como desde
 * el switch de Ajustes Avanzados.
 */
async function activarSincronizacionCalendario() {
  if (!tieneScopeCalendarOtorgado()) {
    // A diferencia de Drive (obligatorio desde el primer login), Calendar
    // es un scope agregado en esta migración — una cuenta que inició
    // sesión ANTES de este cambio no lo tiene todavía. No hay forma de
    // pedir el permiso adicional sin pasar de nuevo por el login completo
    // en este flujo (ver auth.js) — 2026-08-26: antes esto era un simple
    // toast (fácil de ignorar sin darse cuenta de qué pasó); ahora es un
    // aviso explícito con una acción concreta (ver avisarFaltaPermisoCalendar).
    avisarFaltaPermisoCalendar();
    return false;
  }

  try {
    await asegurarCalendarioSecundario();
  } catch (e) {
    // 2026-08-26: caso puntual de configuración del proyecto de Google
    // Cloud (API de Calendar sin habilitar) — no es un problema de
    // permisos del usuario, así que NO se ofrece cerrar sesión acá (no
    // resolvería nada); se distingue explícitamente del resto de errores
    // (red, cuota, etc.) para no mandar al usuario a "intentar de nuevo"
    // cuando reintentar no va a cambiar nada hasta que se habilite la API.
    console.error("No se pudo crear el calendario secundario en Google Calendar:", e);
    if (e && e.apiDeshabilitada) {
      console.error(
        "Google Calendar API no está habilitada en el proyecto de Google Cloud — hace falta habilitarla una sola vez desde la consola" +
          (e.urlActivacion ? `: ${e.urlActivacion}` : " (ver el link en el error de arriba).")
      );
      mostrarToast("Google Calendar todavía no está habilitado en el proyecto. Avisale al desarrollador de la app.");
    } else {
      mostrarToast("No se pudo activar la sincronización con Google Calendar. Intentá de nuevo.");
    }
    return false;
  }

  estado.datos.configuracion.sincronizar_calendario_google = true;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();

  mostrarToast("Sincronización con Google Calendar activada");

  resincronizarTodaLaAgendaConCalendar();
  sincronizarResumenDiario();
  return true;
}

/** Apaga el switch de Ajustes y borra todo lo espejado en Calendar
 *  (eventos + el evento recurrente del Resumen Diario). */
async function desactivarSincronizacionCalendario() {
  estado.datos.configuracion.sincronizar_calendario_google = false;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();

  await eliminarEventoResumenSiExiste();
  await eliminarTodosLosEventosCalendarizados();
}

/**
 * Onboarding — se llama UNA vez, desde main.js, justo después del primer
 * login de una cuenta nueva (esArchivoNuevo). Mismo criterio que el
 * archivo viejo: se acepte o no, el switch sigue disponible después en
 * Ajustes Avanzados en cualquier momento.
 */
function ofrecerActivarSincronizacionCalendario() {
  if (!tieneScopeCalendarOtorgado()) return;
  abrirConfirmacion({
    titulo: "¿Sincronizar con Google Calendar?",
    mensaje:
      "Vas a recibir la alarma nativa de tu calendario cuando se acerque una tarea, examen o evento de tu Agenda — con máxima prioridad, incluso con la app cerrada. Podés activarlo o desactivarlo cuando quieras desde Ajustes.",
    textoConfirmar: "Activar",
    onConfirmar: () => activarSincronizacionCalendario(),
  });
}

/**
 * 2026-08-26 — Aviso al usuario cuando falta el scope de Calendar (cuenta
 * que inició sesión antes de esta migración, o que lo destildó en el
 * consentimiento). Se llama desde activarSincronizacionCalendario, tanto
 * si lo dispara el switch de Ajustes como el onboarding.
 *
 * Genuinamente no saltable (confirmado contra componentes.js, sesión
 * posterior): a diferencia del intento anterior con abrirConfirmacion
 * (que reutiliza el ÚNICO #modal-confirmacion compartido por toda la app,
 * con botón Cancelar y click-afuera cableados una sola vez de forma
 * genérica en inicializarModalConfirmacion — no hay forma de que un uso
 * puntual sea "más bloqueante" que otro ahí), esto usa un modal DEDICADO
 * propio (#modal-permiso-calendario, index.html), con el mismo patrón
 * exacto que modal-completar-universidades: excluido a mano de la "X"
 * automática (ver exclusión en inicializarBotonesCerrarModal,
 * ui/componentes.js) y sin ningún listener de click-afuera registrado acá
 * (a diferencia del resto de los modales de la app, ese listener
 * simplemente no existe para este modal). Único botón: "Cerrar sesión
 * ahora", que llama a cerrarSesion() directo.
 */
function avisarFaltaPermisoCalendar() {
  document.getElementById("modal-permiso-calendario").classList.remove("oculto");
}

/** Engancha el único botón del modal bloqueante — se llama una vez al
 *  arrancar la app (ver lista de inicializadores en el DOMContentLoaded
 *  de main.js, mismo criterio que inicializarModalCompletarUniversidades). */
function inicializarModalPermisoCalendario() {
  document.getElementById("btn-cerrar-sesion-permiso-calendario").addEventListener("click", () => {
    document.getElementById("modal-permiso-calendario").classList.add("oculto");
    cerrarSesion();
  });
}

export {
  activarSincronizacionCalendario,
  avisarFaltaPermisoCalendar,
  desactivarSincronizacionCalendario,
  eliminarEventoCalendarizado,
  inicializarModalPermisoCalendario,
  ofrecerActivarSincronizacionCalendario,
  sincronizacionCalendarActiva,
  sincronizarEventoCalendario,
  sincronizarResumenDiario,
};
