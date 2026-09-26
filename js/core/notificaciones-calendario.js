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
  parchearEventoCalendar,
  buscarInstanciaEventoCalendar,
  listarEventosCalendarSecundario,
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
 * Arma reminders.overrides a partir de los offsets configurados para este
 * tipo (configuracion.notificaciones_recordatorios[tipoEfectivo]).
 *
 * FIX 2026-09-25 (auditoría de Ajustes — "se guarda pero no actualiza"):
 * esta función ya esperaba un ARREGLO de ids con `.map()` directo, y eso
 * es correcto — CONFIRMADO contra core/schema.js que el formato real y
 * vigente de `notificaciones_recordatorios[tipo]` es un arreglo (default
 * en `crearDatosUsuarioNuevo`, y `migrarDatosAntiguos` lo fuerza a
 * arreglo en cada carga, local o remota). El bug real estaba del otro
 * lado: config/config-ajustes.js, al migrar de chips (arreglo) a un
 * <select> único, había quedado escribiendo un STRING plano en vez de un
 * arreglo de un elemento. Ese string sobrevivía en memoria durante la
 * sesión (parecía "guardarse"), pero `migrarDatosAntiguos` lo detectaba
 * en la siguiente carga/sync y lo reseteaba a `["1_dia"]` — de ahí "se
 * guarda pero no actualiza". Mientras tanto, acá, ese mismo string hacía
 * fallar `.map()` (TypeError, atrapado en silencio por el try/catch de
 * sincronizarEventoCalendario) y el evento tampoco reflejaba el offset
 * elegido en Calendar. Fix real aplicado en config-ajustes.js (vuelve a
 * escribir `[valor]`); acá solo se suma tolerancia defensiva a un string
 * suelto, por si quedara algún dato a medio migrar en el momento exacto
 * de la carga.
 */
function construirRecordatoriosGoogle(tipoEfectivo) {
  const valorGuardado = estado.datos?.configuracion?.notificaciones_recordatorios?.[tipoEfectivo];
  const idsOffset = Array.isArray(valorGuardado) ? valorGuardado : valorGuardado ? [valorGuardado] : [];

  const overrides = idsOffset
    .map((offsetId) => OFFSETS_RECORDATORIO_AGENDA.find((o) => o.id === offsetId))
    .filter(Boolean)
    .map((offset) => ({ method: "popup", minutes: offset.minutosAntes }));

  // Sin ningún offset configurado para este tipo: se manda igual
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
/**
 * FIX 2026-09-25 (reportado: "recibo una notificación pero no me dice
 * cuándo es y me confunde"): con varios offsets configurados para el mismo
 * tipo (ej. "3 días antes" + "1 día antes"), el MISMO evento dispara varias
 * notificaciones con el summary a secas — sin ninguna pista de a qué fecha
 * corresponde cada una, así que dos avisos de tareas distintas (o dos
 * avisos del mismo evento en momentos distintos) se ven idénticos en la
 * notificación del sistema. Se mete la fecha (y la hora, si el evento la
 * tiene) directo en el summary — así la notificación es autocontenida sin
 * depender de si el cliente de Calendar decide mostrar o no esa info por
 * su cuenta.
 */
function formatearFechaCortaEvento(evento) {
  const formateador = new Intl.DateTimeFormat("es-CR", { weekday: "short", day: "numeric", month: "short" });
  const texto = formateador.format(new Date(`${evento.fecha}T00:00:00`));
  return evento.hora ? `${texto}, ${evento.hora}` : texto;
}

function construirEventoGoogleDesdeAgenda(evento) {
  const tipoEfectivo = tipoEfectivoParaNotificaciones(evento);
  const nombreMateria = resolverNombreMateriaEvento(evento);
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const cuerpo = {
    summary: `${evento.nombre || "Evento de Agenda"} · ${formatearFechaCortaEvento(evento)}`,
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
 * Si el evento está completado o PERDIDO (2026-09-21, estado "Perdido" de
 * Agenda), se elimina su espejo en vez de actualizarlo (mismo criterio que
 * el archivo viejo con cancelarRecordatorioPush): una tarea que la persona
 * ya no va a hacer no debe seguir avisando en Calendar. Al restaurarla a
 * pendiente este mismo camino la vuelve a crear (insert/update).
 *
 * Best-effort (Parte B.4): cualquier fallo de red/API queda en
 * console.warn, nunca se propaga — el EventoAgenda ya está guardado en la
 * fuente de verdad (JSON local/Drive) antes de que esto se llame.
 */
async function sincronizarEventoCalendario(evento) {
  if (!sincronizacionCalendarActiva()) return;
  if (!tieneScopeCalendarOtorgado()) return;
  if (evento.completada || evento.perdida) return eliminarEventoCalendarizado(evento);
  if (!evento.fecha) return;

  try {
    const calendarId = await asegurarCalendarioSecundario();
    const cuerpo = construirEventoGoogleDesdeAgenda(evento);

    if (evento.google_calendar_event_id) {
      try {
        await conTokenValido((token) => actualizarEventoCalendar(token, calendarId, evento.google_calendar_event_id, cuerpo));
        await sincronizarResumenParaFechaEvento(evento.fecha);
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
    await sincronizarResumenParaFechaEvento(evento.fecha);
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
 *
 * FIX 2026-09-25 (reportado: "borré muchos y no se borraron de Calendar,
 * aunque según la app ni servía porque salía bloqueado"): esta función
 * cortaba de entrada con `if (!sincronizacionCalendarActiva()) return;` —
 * si el switch general estaba (o parecía estar) apagado en el momento del
 * borrado, el evento de Calendar quedaba huérfano PARA SIEMPRE, sin
 * ningún mecanismo que lo volviera a intentar después (a diferencia de
 * sincronizarEventoCalendario, donde no sincronizar mientras está apagado
 * es el comportamiento correcto). Borrar un espejo ya existente debe
 * intentarse SIEMPRE que haya un id guardado, sin importar el estado del
 * switch — el switch controla si se crean/actualizan eventos nuevos, no si
 * se limpian los que ya no deberían existir. Se saca el guard.
 *
 * FIX 2026-09-26 (Resumen Diario reactivo): al final, si el evento tiene
 * fecha, también se recalcula la instancia del Resumen Diario del día
 * anterior (sincronizarResumenParaFechaEvento) — completar, marcar
 * "perdida" o borrar un evento puede ser justo lo que hace que ya no quede
 * nada pendiente para esa fecha (o, con varios eventos el mismo día, que
 * el listado deba achicarse), y antes nada disparaba ese recálculo hasta
 * que llegara el día. Se llama SIEMPRE que haya fecha, incluso si este
 * evento puntual nunca tuvo espejo en Calendar (`google_calendar_event_id`
 * ausente, ej. se creó con la sincronización apagada) — lo que importa acá
 * no es si había algo que borrar, sino si su estado pudo cambiar el conteo
 * de esa fecha; la función de recálculo ya sabe no hacer nada si el
 * Resumen Diario está apagado.
 */
async function eliminarEventoCalendarizado(evento) {
  if (!evento) return;
  if (evento.google_calendar_event_id) {
    try {
      const calendarId = await asegurarCalendarioSecundario();
      await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, evento.google_calendar_event_id));
      evento.google_calendar_event_id = null;
    } catch (e) {
      console.warn(`No se pudo eliminar de Google Calendar el evento "${evento.id}" (no crítico):`, e);
    }
  }
  if (evento.fecha) await sincronizarResumenParaFechaEvento(evento.fecha);
}

/**
 * Recorre TODA la agenda (todos los semestres, mismo criterio que el
 * archivo viejo para operaciones en lote) y sincroniza contra Calendar los
 * eventos pendientes. Se llama una única vez, justo después de activar el
 * switch de Ajustes — antes de eso no había calendario secundario contra
 * el cual sincronizar nada.
 *
 * FIX 2026-09-25 (reportado: "hay muchos eventos en Calendar que no
 * concuerdan con lo que está en la app... algunas se duplicaron y nada que
 * ver"): antes esta función solo recorría eventos NO completados/perdidos
 * (`continue` para el resto) — nunca limpiaba el espejo de uno que sí lo
 * estuviera, y nunca detectaba nada que existiera en Calendar sin
 * corresponder a NINGÚN EventoAgenda vivo (huérfanos de borrados viejos, o
 * duplicados de una re-sincronización fallida que insertó de más — ver el
 * fix de eliminarEventoCalendarizado más arriba, causa directa de los
 * huérfanos). Ahora, además de sincronizar lo vigente: (a) limpia el
 * espejo de cualquier evento completado/perdido que todavía tuviera uno
 * (arrastrado de cuando el guard roto de arriba lo dejaba pasar), y (b) al
 * final llama a limpiarEventosCalendarHuerfanos(), que compara TODO lo que
 * hay en el calendario secundario contra la app y borra cualquier cosa que
 * no corresponda — la app es la única fuente de verdad, si algo no existe
 * acá no debería existir en Calendar.
 */
async function resincronizarTodaLaAgendaConCalendar() {
  const eventos = estado.datos.agenda || [];
  for (const evento of eventos) {
    if (evento.completada || evento.perdida) {
      if (evento.google_calendar_event_id) await eliminarEventoCalendarizado(evento);
      continue;
    }
    await sincronizarEventoCalendario(evento);
  }
  await limpiarEventosCalendarHuerfanos();
}

/** Por encima de esta cantidad de borrados "reales" detectados en una sola
 *  pasada, limpiarEventosCalendarHuerfanos() NO borra nada solo — pide
 *  confirmación explícita (ver FIX 2026-09-26 más abajo). Unos pocos
 *  huérfanos/duplicados sueltos son el caso normal y se limpian solos, sin
 *  friccionar al usuario; un número grande de golpe es la señal de que algo
 *  sistémico está mal (un bug, un id que dejó de guardarse para muchos
 *  eventos a la vez, una lectura incompleta de la agenda, etc.) y ahí es
 *  preferible parar y mostrar qué se iba a borrar antes que confiar en la
 *  heurística a ciegas. */
const UMBRAL_CONFIRMACION_BORRADO_MASIVO = 5;

/**
 * Reconciliación completa (fix 2026-09-25): borra de Calendar cualquier
 * evento del calendario secundario que no corresponda a un EventoAgenda
 * vigente. El evento recurrente del Resumen Diario se preserva por su id
 * guardado en `google_calendar_resumen_evento_id`.
 *
 * FIX 2026-09-26 (reportado: "pedí que se limpiaran duplicados/huérfanos y
 * de repente desaparecieron LA MAYORÍA de los eventos de Calendar — pero
 * siguen en la app"). Causa raíz: la versión anterior consideraba
 * "huérfano" a todo lo que no matcheara por `google_calendar_event_id`
 * guardado LOCALMENTE — y ese campo se puede perder sin que el evento deje
 * de ser real (falla de red a medio guardar, dato viejo de antes de algún
 * fix anterior, etc.). Un EventoAgenda perfectamente vigente cuyo id local
 * se perdió era indistinguible de un huérfano de verdad, y se borraba su
 * espejo en Calendar igual — de ahí "sigue en la app pero no en Calendar".
 *
 * Esta versión reconcilia por DOS caminos en vez de uno solo:
 *   1. `google_calendar_event_id` guardado (camino normal, rápido).
 *   2. `extendedProperties.private.app_evento_id` que
 *      `construirEventoGoogleDesdeAgenda()` ya graba en cada evento que crea
 *      — una referencia estable al EventoAgenda que sobrevive aunque el id
 *      local se pierda. Si un item de Calendar no matchea por (1) pero SÍ
 *      corresponde por (2) a un EventoAgenda vivo, NO se borra: se
 *      **reconecta** (se reescribe `evento.google_calendar_event_id`) y se
 *      sigue de largo. Recién si ninguno de los dos caminos lo reconoce, o
 *      si ya existe otro item reconectado con el mismo `app_evento_id`
 *      (duplicado real), se lo marca para borrar.
 *
 * Las reconexiones se aplican siempre (no destruyen nada). El borrado, en
 * cambio, pasa por un freno de emergencia: si hay más de
 * UMBRAL_CONFIRMACION_BORRADO_MASIVO candidatos a borrar en la misma
 * pasada, no se borra nada automáticamente — se le pide confirmación
 * explícita al usuario mostrando cuántos y cuáles, precisamente para que un
 * bug futuro (o una lectura parcial de la agenda, ej. antes de que
 * terminara de cargar) no pueda volver a borrar "la mayoría" de un saque
 * sin que nadie se entere hasta después.
 *
 * No borra nada si el calendario secundario ni siquiera existe todavía
 * (`google_calendar_id` sin setear). Sin scope de Calendar, tampoco intenta
 * nada. Paginado vía listarEventosCalendarSecundario (auth.js). Best-effort:
 * un fallo puntual (de listar, reconectar o borrar un item) queda en
 * console.warn y no interrumpe el resto.
 */
async function limpiarEventosCalendarHuerfanos() {
  if (!tieneScopeCalendarOtorgado()) return;
  const calendarId = estado.datos?.configuracion?.google_calendar_id;
  if (!calendarId) return;

  // --- Paso 1: qué reconoce la app AHORA MISMO como vigente, por los dos
  // caminos posibles (id de Google guardado, y app_evento_id estable). ---
  const idsValidosPorGoogleId = new Set();
  const eventosVivosPorAppId = new Map();
  for (const evento of estado.datos.agenda || []) {
    if (evento.completada || evento.perdida) continue;
    if (evento.google_calendar_event_id) idsValidosPorGoogleId.add(evento.google_calendar_event_id);
    eventosVivosPorAppId.set(evento.id, evento);
  }
  const idResumen = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (idResumen) idsValidosPorGoogleId.add(idResumen);

  // --- Paso 2: recorrer TODO Calendar y clasificar cada item, sin borrar
  // todavía nada — separar "reparar" de "borrar" antes de tocar nada. ---
  const aReconectar = []; // { item, evento } — evento real, le faltaba el id local
  const aBorrar = []; // { item, motivo } — huérfano real o duplicado de más
  const yaReconectadoPorAppId = new Map(); // app_evento_id -> item ya aceptado en esta pasada

  let pageToken;
  try {
    do {
      const pagina = await conTokenValido((token) => listarEventosCalendarSecundario(token, calendarId, pageToken));
      pageToken = pagina.nextPageToken;
      for (const item of pagina.items || []) {
        if (item.status === "cancelled" || idsValidosPorGoogleId.has(item.id)) continue;

        const appEventoId = item.extendedProperties?.private?.app_evento_id;
        const eventoVivo = appEventoId ? eventosVivosPorAppId.get(appEventoId) : null;

        if (!eventoVivo) {
          aBorrar.push({ item, motivo: "no corresponde a ningún evento vigente de la app" });
        } else if (yaReconectadoPorAppId.has(appEventoId)) {
          aBorrar.push({ item, motivo: `copia duplicada de "${eventoVivo.nombre}" (id app ${appEventoId})` });
        } else {
          yaReconectadoPorAppId.set(appEventoId, item);
          aReconectar.push({ item, evento: eventoVivo });
        }
      }
    } while (pageToken);
  } catch (e) {
    console.warn("No se pudo completar la limpieza de eventos huérfanos en Calendar (no crítico):", e);
    return;
  }

  // --- Paso 3: reconectar primero — nunca se pierde nada acá. ---
  if (aReconectar.length) {
    for (const { item, evento } of aReconectar) {
      evento.google_calendar_event_id = item.id;
      console.info(
        `Calendar: reconectado "${evento.nombre}" (id app ${evento.id}) con el evento existente "${item.id}" — le faltaba el id local, no era un huérfano real.`
      );
    }
    sellarTimestamp(estado.datos);
    marcarCambioPendiente();
  }

  if (!aBorrar.length) return;

  // --- Paso 4: borrar, pero con freno de emergencia por encima del umbral. ---
  const ejecutarBorrado = async () => {
    let borrados = 0;
    for (const { item, motivo } of aBorrar) {
      try {
        await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, item.id));
        borrados++;
      } catch (e) {
        console.warn(`No se pudo borrar el evento huérfano "${item.id}" (${motivo}) de Calendar (no crítico):`, e);
      }
    }
    console.info(
      `Calendar: limpieza terminada — ${aReconectar.length} reconectado(s), ${borrados}/${aBorrar.length} huérfano(s)/duplicado(s) real(es) eliminado(s).`
    );
    mostrarToast(
      aReconectar.length
        ? `Calendar: se reconectaron ${aReconectar.length} evento(s) y se limpiaron ${borrados} huérfano(s).`
        : `Calendar: se limpiaron ${borrados} evento(s) que ya no correspondían.`
    );
  };

  if (aBorrar.length <= UMBRAL_CONFIRMACION_BORRADO_MASIVO) {
    await ejecutarBorrado();
    return;
  }

  // Más de UMBRAL_CONFIRMACION_BORRADO_MASIVO de golpe: no se asume nada,
  // se muestra la lista (acotada) y se espera confirmación explícita.
  const detalle = aBorrar
    .slice(0, 10)
    .map(({ item }) => `• ${item.summary || item.id}`)
    .join("\n");
  const resto = aBorrar.length > 10 ? `\n… y ${aBorrar.length - 10} más.` : "";
  console.warn(
    `Calendar: se detectaron ${aBorrar.length} eventos para borrar en una sola pasada (por encima del umbral de ${UMBRAL_CONFIRMACION_BORRADO_MASIVO}) — se pausó el borrado automático y se pidió confirmación al usuario.`,
    aBorrar
  );
  abrirConfirmacion({
    titulo: "Revisar antes de borrar en Calendar",
    mensaje:
      `Se detectaron ${aBorrar.length} eventos en Google Calendar que no corresponden a ningún evento vigente de la app. ` +
      `Es más de lo normal para una limpieza de rutina, así que se pausó el borrado automático por seguridad.\n\n${detalle}${resto}\n\n` +
      "¿Confirmás que estos ya no existen en la app y se pueden borrar de Calendar?",
    textoConfirmar: `Borrar los ${aBorrar.length}`,
    onConfirmar: () => ejecutarBorrado(),
  });
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
 * nuevo (Parte C.1).
 *
 * 2026-08-26 (reportado: "llena todo el calendario hasta que me muera"):
 * antes la recurrencia no tenía fin (`RRULE:FREQ=DAILY` a secas), así que
 * Google/Samsung Calendar la mostraban repitiéndose literalmente para
 * siempre al scrollear hacia adelante. Ahora lleva un `UNTIL` acotado a
 * HORIZONTE_DIAS_RESUMEN días — y se renueva solo, sin que el usuario lo
 * note, cada vez que actualizarResumenDiarioDelDia() corre (una vez por
 * día, al abrir la app): como sigue siendo un PUT completo contra el MISMO
 * id de evento, "renovar" es simplemente volver a llamar a esta función,
 * que recalcula el UNTIL desde hoy.
 */
const HORIZONTE_DIAS_RESUMEN = 120; // ~4 meses de recurrencia visible a la vez

/**
 * FIX 2026-09-26 (reportado: "toca y no pasa nada / no muestra info real"):
 * las 4 fechas "de hoy"/"de mañana" de esta sección se calculaban con
 * `new Date().toISOString().slice(0, 10)` — eso da la fecha en UTC, NO la
 * fecha local. Para cualquier huso horario negativo (Costa Rica, UTC-6),
 * entre las 18:00 y la medianoche hora local el reloj UTC ya cruzó a "mañana"
 * — exactamente la ventana en la que suena la alarma del Resumen Diario (el
 * ejemplo reportado era a las 8pm). Efecto real: `actualizarResumenDiarioDelDia`
 * calculaba `hoyIso` ya adelantado un día, armaba la ventana de búsqueda
 * (`timeMin`/`timeMax`) para la instancia de MAÑANA en vez de la de HOY, no
 * encontraba coincidencia (o parcheaba la instancia equivocada) — la
 * instancia de hoy, la que el usuario tenía adelante tocando la
 * notificación, se quedaba para siempre con el texto genérico de fallback.
 * Mismo bug afectaba a `generarTextoResumenHoy` (calculaba mal "mañana", por
 * lo que el listado de tareas podía corresponder al día equivocado) y a
 * `construirCuerpoResumenDiario` (fecha de anclaje del evento). Se reemplaza
 * por este helper, que usa los getters LOCALES de Date (getFullYear/
 * getMonth/getDate) en vez de convertir a UTC primero.
 */
function fechaLocalISO(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Arma el body de events.insert/update para el evento recurrente del
 *  Resumen Diario. `descripcion` es opcional — si no se pasa, usa el texto
 *  genérico de fallback (lo que ve cualquier día que la app no se haya
 *  abierto antes de que suene la alarma, ver generarTextoResumenHoy). */
function construirCuerpoResumenDiario(cfgResumen, descripcion) {
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hora = cfgResumen.hora || "20:00";
  const hoyIso = fechaLocalISO();
  const [h, m] = hora.split(":").map(Number);
  const finDate = new Date(`${hoyIso}T00:00:00`);
  finDate.setHours(h, m + 15, 0, 0);
  const finHora = `${String(finDate.getHours()).padStart(2, "0")}:${String(finDate.getMinutes()).padStart(2, "0")}:00`;

  // UNTIL en formato RFC5545 (YYYYMMDDTHHMMSSZ, UTC) — Google lo exige así
  // para eventos con dateTime (a diferencia de eventos de día completo,
  // que usarían YYYYMMDD a secas).
  const untilDate = new Date(`${hoyIso}T${hora}:00`);
  untilDate.setDate(untilDate.getDate() + HORIZONTE_DIAS_RESUMEN);
  const untilStr = untilDate.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";

  return {
    summary: "📚 Tu resumen académico de hoy",
    description: descripcion || "Toca para ver tu resumen académico de hoy 👋",
    start: { dateTime: `${hoyIso}T${hora}:00`, timeZone: zonaHoraria },
    end: { dateTime: `${hoyIso}T${finHora}`, timeZone: zonaHoraria },
    recurrence: [`RRULE:FREQ=DAILY;UNTIL=${untilStr}`],
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    source: { url: DEEP_LINK_RESUMEN, title: "Resumen académico" },
  };
}

/**
 * Se llama desde renderizarNotificacionesResumenDiario en config-ajustes.js
 * cada vez que cambia el switch o la hora elegida — mismo punto de entrada
 * que tenía el archivo viejo. También la reusa internamente
 * actualizarResumenDiarioDelDia() (ver abajo) para renovar el horizonte de
 * la recurrencia una vez por día, con el texto genérico (el contenido real
 * del día lo pisa después esa misma función, parcheando SOLO la instancia
 * de hoy).
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
    const cuerpo = construirCuerpoResumenDiario(cfgResumen);

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

/**
 * Arma el texto real del Resumen Diario de HOY (2026-08-26 — antes era
 * siempre el mismo texto genérico "Toca para ver tu resumen académico de
 * hoy"). Mira los eventos de MAÑANA — la alarma suena hoy en la
 * tarde/noche, así que avisar lo que se viene tiene más sentido que
 * repetir lo de hoy — y si no hay nada mañana, busca el próximo evento
 * pendiente más cercano en cualquier fecha futura para no dejar el aviso
 * vacío sin necesidad.
 */
/**
 * FIX 2026-09-25 (pedido explícito: "la idea de esto es que te diga cómo,
 * tienes x pendientes para mañana y si no tiene pendientes ni decirle
 * nada"): antes, sin nada para mañana, igual devolvía un texto (el
 * "próximo evento en cualquier fecha futura", o un "🎉 no tenés nada" a
 * secas) — texto real pero no la información que se pidió, y en ningún
 * caso "nada". Ahora esta función SOLO mira mañana: si hay algo, devuelve
 * el conteo + listado; si no hay nada, devuelve `null` explícito para que
 * quien la llama (actualizarResumenDiarioDelDia) sepa que no debe avisar
 * nada ese día — no hay más fallback "para no dejarlo vacío".
 */
/**
 * FIX 2026-09-26 (Resumen Diario reactivo): generalizada de "siempre
 * mañana respecto de hoy" a "los pendientes de CUALQUIER fecha puntual" —
 * sigue usándose para el caso de siempre (mañana respecto de hoy, ver
 * actualizarResumenDiarioDelDia) pero ahora también la reusa
 * sincronizarResumenParaFechaEvento para recalcular la instancia del día
 * anterior a un evento recién creado/editado/completado, sin esperar a que
 * llegue esa fecha. Recalcular siempre desde cero contra TODOS los eventos
 * de `fechaIso` (no solo el que disparó el cambio) es lo que hace que "ya
 * había otro evento ese día" simplemente funcione, sin ningún caso
 * especial: la próxima llamada ve los dos y arma el listado con ambos.
 */
function generarTextoResumenParaFecha(fechaIso) {
  const deEsaFecha = (estado.datos.agenda || []).filter((e) => !e.completada && !e.perdida && e.fecha === fechaIso);
  if (deEsaFecha.length === 0) return null;

  const nombres = deEsaFecha.map((e) => e.nombre || "Evento de Agenda");
  const listado =
    nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  const etiquetaCantidad = deEsaFecha.length === 1 ? "1 pendiente" : `${deEsaFecha.length} pendientes`;
  return `Tenés ${etiquetaCantidad} para mañana: ${listado} 📌`;
}

/**
 * Se llama UNA vez por día, la primera vez que la app arranca ese día (ver
 * main.js, justo después de mostrarApp()) — deduplicada contra
 * configuracion.resumen_diario_actualizado_el para no pegarle a la API de
 * Calendar en cada carga. Hace 2 cosas, ambas "mejor esfuerzo" (mismo
 * criterio que el resto del archivo):
 *
 *   1. Renueva el horizonte de la recurrencia (vía sincronizarResumenDiario
 *      — mismo id de evento, así que es un PUT que solo extiende el UNTIL,
 *      nunca crea uno nuevo).
 *   2. Busca la instancia de HOY del evento recurrente y le parchea SOLO
 *      la descripción con el contenido real del día (events.patch) — el
 *      evento maestro sigue con el texto genérico de fallback, para
 *      cualquier día en que la app no se haya abierto antes de que suene
 *      la alarma (limitación conocida: sin un disparador del lado del
 *      servidor —que es justo lo que esta migración eliminó a propósito—
 *      no hay forma de garantizar el contenido real si el usuario no abre
 *      la app ese día).
 */
async function actualizarResumenDiarioDelDia() {
  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) return;
  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen?.activo) return;
  const idEvento = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (!idEvento) return;

  const hoyIso = fechaLocalISO();
  if (estado.datos.configuracion.resumen_diario_actualizado_el === hoyIso) return; // ya se hizo hoy

  try {
    await sincronizarResumenDiario(); // 1) renueva el horizonte

    const calendarId = await asegurarCalendarioSecundario();
    const mañanaDate = new Date(`${hoyIso}T00:00:00`);
    mañanaDate.setDate(mañanaDate.getDate() + 1);
    const mañanaIso = fechaLocalISO(mañanaDate);
    const timeMin = new Date(`${hoyIso}T00:00:00`).toISOString();
    const timeMax = new Date(`${hoyIso}T23:59:59`).toISOString();
    const instancia = await conTokenValido((token) =>
      buscarInstanciaEventoCalendar(token, calendarId, idEvento, timeMin, timeMax)
    );

    if (instancia) {
      const descripcion = generarTextoResumenParaFecha(mañanaIso);
      if (descripcion) {
        // status: "confirmed" por si esta instancia ya había quedado
        // cancelada (ver sincronizarResumenParaFechaEvento) y ahora sí hay
        // algo pendiente para mañana — sin esto, un PATCH de solo
        // description no necesariamente la reactiva.
        await conTokenValido((token) =>
          parchearEventoCalendar(token, calendarId, instancia.id, { description: descripcion, status: "confirmed" })
        );
      } else {
        // FIX 2026-09-25 (pedido explícito: "si no tiene pendientes ni
        // decirle nada"): sin nada para mañana, la alarma de HOY no aporta
        // nada - en vez de dejarla sonar con el texto genérico de
        // fallback, se cancela SOLO esta ocurrencia puntual. events.delete
        // sobre el id de una INSTANCIA (no del evento maestro) cancela
        // nada más que el día de hoy - la recurrencia sigue intacta, mañana
        // se vuelve a evaluar de cero (con contenido real, o cancelada de
        // nuevo si tampoco hay nada pasado mañana).
        await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, instancia.id));
      }
    }

    estado.datos.configuracion.resumen_diario_actualizado_el = hoyIso;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  } catch (e) {
    console.warn("No se pudo actualizar el Resumen Diario de hoy (no crítico):", e);
  }
}

/**
 * FIX 2026-09-26 (pedido explícito: "el resumen sigue sin ser útil...
 * cuando creas algo se cree el resumen el día anterior y si ya existía es
 * porque hay más de un evento"). Hasta acá, el contenido REAL de una
 * instancia del Resumen Diario solo se calculaba una vez por día, la
 * primera vez que se abría la app ESE día puntual
 * (actualizarResumenDiarioDelDia, arriba) — si la persona no abría la app
 * justo el día anterior a un evento, esa alarma sonaba para siempre con el
 * texto genérico de fallback (limitación que sigue documentada arriba,
 * porque no desaparece del todo: ver el aviso al final de este comentario).
 *
 * Ahora, además de eso, esto se llama cada vez que se crea, edita, completa
 * o borra un EventoAgenda con fecha (ver sincronizarEventoCalendario y
 * eliminarEventoCalendarizado, los dos únicos puntos de entrada desde
 * agenda.js/agenda-modal.js) — apenas pasa cualquiera de esas cosas, se
 * recalcula DE UNA la instancia del Resumen Diario correspondiente al DÍA
 * ANTERIOR a la fecha de ESE evento, sin esperar a que llegue ese día.
 *
 * El recálculo siempre vuelve a mirar TODOS los eventos pendientes de esa
 * fecha (generarTextoResumenParaFecha), no solo el que disparó el cambio —
 * por eso "si ya existía es porque hay más de un evento" no necesita ningún
 * caso especial: sea el primer evento de esa fecha o el quinto, el
 * resultado siempre es el listado completo y correcto de ese día. Si el
 * recálculo da `null` (ej. se completó el único evento que quedaba
 * pendiente para esa fecha), la instancia se cancela puntualmente en vez de
 * dejarla con contenido viejo — mismo criterio que
 * actualizarResumenDiarioDelDia. Si en cambio SÍ hay contenido y la
 * instancia había quedado cancelada de una pasada anterior, se reactiva
 * (`status: "confirmed"`) en el mismo PATCH.
 *
 * Limitación que NO se resuelve acá: si un evento CAMBIA de fecha (una
 * edición que lo mueve de día), esto arregla la instancia de la fecha
 * NUEVA, pero no tiene forma de saber cuál era la fecha VIEJA para
 * recalcular esa otra instancia — sincronizarEventoCalendario recibe el
 * evento ya con la fecha nueva puesta, sin rastro de la anterior (haría
 * falta que agenda-modal.js la pasara explícitamente, y ese archivo no
 * forma parte de esta sesión). Esa instancia vieja queda con el listado de
 * antes hasta que: (a) llegue su día y actualizarResumenDiarioDelDia la
 * recalcule de cero al abrir la app, o (b) algún OTRO evento de esa misma
 * fecha vieja dispare este mismo camino antes. Es el mismo tipo de
 * ventana que ya existía, solo que más chica.
 *
 * No hace nada si el switch general, el scope, o el Resumen Diario en
 * particular están apagados, ni si la fecha del evento ya pasó (no hay
 * alarma que ajustar). Best-effort: nunca bloquea el guardado real del
 * EventoAgenda, que ya ocurrió antes de llegar acá.
 */
async function sincronizarResumenParaFechaEvento(fechaEventoIso) {
  if (!fechaEventoIso) return;
  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) return;

  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen?.activo) return;

  const idEvento = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (!idEvento) return; // el resumen recién se crea la próxima vez que corra sincronizarResumenDiario/actualizarResumenDiarioDelDia

  const fechaAlarmaDate = new Date(`${fechaEventoIso}T00:00:00`);
  fechaAlarmaDate.setDate(fechaAlarmaDate.getDate() - 1);
  const fechaAlarmaIso = fechaLocalISO(fechaAlarmaDate);

  if (fechaAlarmaIso < fechaLocalISO()) return; // esa alarma ya pasó, no hay nada que ajustar

  try {
    const calendarId = await asegurarCalendarioSecundario();
    const timeMin = new Date(`${fechaAlarmaIso}T00:00:00`).toISOString();
    const timeMax = new Date(`${fechaAlarmaIso}T23:59:59`).toISOString();
    const instancia = await conTokenValido((token) =>
      buscarInstanciaEventoCalendar(token, calendarId, idEvento, timeMin, timeMax)
    );
    // null típicamente significa que esa fecha todavía está fuera del
    // horizonte de la recurrencia (UNTIL) — se corrige solo la próxima vez
    // que sincronizarResumenDiario renueve el horizonte (una vez por día).
    if (!instancia) return;

    const descripcion = generarTextoResumenParaFecha(fechaEventoIso);
    if (descripcion) {
      await conTokenValido((token) =>
        parchearEventoCalendar(token, calendarId, instancia.id, { description: descripcion, status: "confirmed" })
      );
    } else if (instancia.status !== "cancelled") {
      await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, instancia.id));
    }
  } catch (e) {
    console.warn(`No se pudo actualizar el Resumen Diario del ${fechaAlarmaIso} (no crítico):`, e);
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
  actualizarResumenDiarioDelDia,
  avisarFaltaPermisoCalendar,
  desactivarSincronizacionCalendario,
  eliminarEventoCalendarizado,
  inicializarModalPermisoCalendario,
  limpiarEventosCalendarHuerfanos,
  ofrecerActivarSincronizacionCalendario,
  sincronizacionCalendarActiva,
  sincronizarEventoCalendario,
  sincronizarResumenDiario,
};
