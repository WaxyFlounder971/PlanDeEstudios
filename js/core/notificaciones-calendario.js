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
import {
  tieneScopeCalendarOtorgado,
  crearCalendarioSecundario,
  insertarEventoCalendar,
  actualizarEventoCalendar,
  eliminarEventoCalendar,
  listarEventosCalendarSecundario,
  solicitarPermisoCalendar,
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
 * vigente. Los eventos del Resumen Diario (uno por noche con contenido
 * real, ver rediseño 2026-09-26 más abajo) se preservan tanto por sus ids
 * guardados en `google_calendar_resumen_eventos` como por la marca
 * `extendedProperties.private.es_resumen_diario` de cada uno.
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
  // Legado: si por algún motivo la migración a eventos individuales
  // (migrarResumenRecurrenteAntiguo) no llegó a correr todavía, no se debe
  // tratar el viejo evento recurrente como huérfano mientras tanto.
  const idResumenViejo = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (idResumenViejo) idsValidosPorGoogleId.add(idResumenViejo);
  for (const id of Object.values(estado.datos?.configuracion?.google_calendar_resumen_eventos || {})) {
    idsValidosPorGoogleId.add(id);
  }

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
        // Eventos individuales del Resumen Diario: se reconocen por esta
        // marca aunque por algún motivo no aparecieran en el mapa guardado
        // (ej. una escritura de estado.datos.configuracion que no llegó a
        // guardarse) — nunca son huérfanos de Agenda, los gestiona aparte
        // sincronizarResumenDiario/sincronizarResumenParaFechaEvento.
        if (item.extendedProperties?.private?.es_resumen_diario) continue;

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
 * REDISEÑO 2026-09-26 (reportado: "no tiene un resumen real y además se
 * pone a diario aunque no exista nada" — pedido explícito: "que el aviso
 * sea 'tienes pendientes para mañana' y solo aparezca cuando EN SERIO haya
 * algo pendiente").
 *
 * Se abandona por completo el diseño anterior de UN evento recurrente
 * (RRULE:FREQ=DAILY) con texto genérico de fallback + parcheo puntual de la
 * instancia de hoy. Ese diseño tenía un defecto de fondo, no solo un bug: la
 * recurrencia hacía que CUALQUIER día dentro del horizonte (120 días)
 * apareciera visible por default con el texto genérico ("Toca para ver tu
 * resumen académico de hoy") — solo el día puntual en que la persona
 * abriera la app se corregía (con contenido real, o cancelándose si no
 * había nada). Todos los demás días quedaban con la alarma genérica
 * sonando igual, sin corresponder a nada real. No era arreglable con un
 * parche chico: mientras exista una recurrencia diaria, "no aparecer
 * cuando no hay nada" y "aparecer automáticamente sin depender de que se
 * abra la app ese día puntual" son objetivos en tensión directa.
 *
 * Diseño nuevo: NADA de recurrencia. Un evento INDIVIDUAL (sin RRULE) por
 * cada fecha que de verdad tiene algo pendiente para el día siguiente — se
 * crea solo cuando corresponde, se borra solo cuando deja de corresponder,
 * y su texto siempre es el contenido real (nunca un texto genérico de
 * relleno, porque si no hay contenido real directamente no se crea nada).
 *
 * `estado.datos.configuracion.google_calendar_resumen_eventos` reemplaza al
 * viejo campo único `google_calendar_resumen_evento_id`: ahora es un mapa
 * `{ "AAAA-MM-DD" (fecha de la ALARMA, la noche anterior) -> id de Google }`,
 * uno por cada noche que efectivamente tiene un evento creado.
 *
 * Dos caminos alimentan este mapa, y se complementan (no se reemplazan):
 *   - sincronizarResumenParaFechaEvento(fechaEventoIso), reactivo: se sigue
 *     llamando desde sincronizarEventoCalendario/eliminarEventoCalendarizado
 *     (agenda.js/agenda-modal.js) cada vez que se crea/edita/completa/borra
 *     un EventoAgenda — recalcula DE UNA la noche anterior a ESA fecha
 *     puntual, sin esperar a que llegue el día.
 *   - sincronizarResumenDiario(), resync completo: recorre TODAS las fechas
 *     con algo pendiente de hoy en adelante (más las que ya tuviéramos
 *     guardadas, para poder detectar las que dejaron de tener contenido) y
 *     reconcilia cada una — se sigue llamando desde config-ajustes.js al
 *     tocar el switch/hora del Resumen, y ahora también una vez por día
 *     (ver actualizarResumenDiarioDelDia) como red de seguridad genérica
 *     (cubre cambios de hora, arrastres de una sesión vieja, etc.), ya que
 *     al no depender de una recurrencia no hace falta "renovar horizonte"
 *     — cada fecha es un evento independiente.
 */

/** Migración única: si queda el evento recurrente del diseño viejo
 *  (`google_calendar_resumen_evento_id`), se borra de Calendar — ya no se
 *  renueva ni se mantiene, y dejarlo suelto sería justo el bug reportado
 *  (sigue sonando a diario con texto genérico para siempre). Se llama al
 *  principio de sincronizarResumenDiario, así corre sola la primera vez que
 *  esta versión toca el Resumen Diario de una cuenta existente, sin pedirle
 *  nada al usuario. */
async function migrarResumenRecurrenteAntiguo() {
  const idViejo = estado.datos?.configuracion?.google_calendar_resumen_evento_id;
  if (!idViejo) return;
  try {
    const calendarId = await asegurarCalendarioSecundario();
    await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, idViejo));
    console.info(
      "Calendar: se borró el viejo evento recurrente del Resumen Diario (reemplazado por eventos individuales por fecha, solo cuando hay contenido real)."
    );
  } catch (e) {
    console.warn("No se pudo borrar el viejo evento recurrente del Resumen Diario durante la migración (no crítico):", e);
  } finally {
    estado.datos.configuracion.google_calendar_resumen_evento_id = null;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }
}

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
function construirCuerpoResumenIndividual(cfgResumen, fechaAlarmaIso, resumen) {
  const zonaHoraria = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const hora = cfgResumen.hora || "20:00";
  const [h, m] = hora.split(":").map(Number);
  const finDate = new Date(`${fechaAlarmaIso}T00:00:00`);
  finDate.setHours(h, m + 15, 0, 0);
  const finHora = `${String(finDate.getHours()).padStart(2, "0")}:${String(finDate.getMinutes()).padStart(2, "0")}:00`;

  return {
    summary: resumen.summary,
    description: resumen.description,
    start: { dateTime: `${fechaAlarmaIso}T${hora}:00`, timeZone: zonaHoraria },
    end: { dateTime: `${fechaAlarmaIso}T${finHora}`, timeZone: zonaHoraria },
    reminders: { useDefault: false, overrides: [{ method: "popup", minutes: 0 }] },
    source: { url: DEEP_LINK_RESUMEN, title: "Resumen académico" },
    // Marca este evento como "Resumen Diario" de forma estable — la usa
    // limpiarEventosCalendarHuerfanos() para reconocerlo y no tratarlo
    // nunca como huérfano de Agenda (no tiene app_evento_id porque no
    // corresponde a ningún EventoAgenda puntual), sin depender únicamente
    // de tener su id anotado en el mapa local.
    extendedProperties: { private: { es_resumen_diario: "1", fecha_alarma: fechaAlarmaIso } },
  };
}

/**
 * Arma el resumen real de lo pendiente para `fechaEventoIso` (2026-08-26 —
 * antes era siempre el mismo texto genérico "Toca para ver tu resumen
 * académico de hoy"; 2026-09-25 — pedido explícito: "que te diga tienes x
 * pendientes para mañana y si no tiene pendientes ni decirle nada", ahora
 * cumplido de raíz: si no hay nada, no se devuelve texto — no se crea
 * ningún evento en Calendar, en vez de un evento con contenido de relleno).
 * Devuelve `null` si no hay nada pendiente esa fecha; si no, un
 * `{ summary, description }` listo para el evento de Calendar — el summary
 * ya dice "Tenés pendientes para mañana" (visible en la notificación sin
 * tener que tocarla), y la descripción trae el listado completo.
 */
function generarResumenParaFecha(fechaEventoIso) {
  const deEsaFecha = (estado.datos.agenda || []).filter((e) => !e.completada && !e.perdida && e.fecha === fechaEventoIso);
  if (deEsaFecha.length === 0) return null;

  const nombres = deEsaFecha.map((e) => e.nombre || "Evento de Agenda");
  const listado =
    nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]}`;
  const etiquetaCantidad = deEsaFecha.length === 1 ? "1 pendiente" : `${deEsaFecha.length} pendientes`;
  return {
    summary: `📌 Tenés ${etiquetaCantidad} para mañana`,
    description: `${listado} 👋`,
  };
}

/**
 * Núcleo del Resumen Diario nuevo: reconcilia UNA fecha de alarma puntual
 * (`fechaAlarmaIso`, la noche en la que sonaría) contra lo que de verdad
 * está pendiente para el día siguiente (`fechaEventoIso`) —
 * `estado.datos.configuracion.google_calendar_resumen_eventos` guarda el
 * mapa `fechaAlarmaIso -> id de Google` de los eventos individuales creados
 * hasta ahora.
 *
 *   - Si hay algo pendiente: crea el evento individual de esa noche si no
 *     existía, o lo actualiza (PUT completo — cubre también un cambio de
 *     hora en Ajustes) si ya existía.
 *   - Si NO hay nada pendiente: si había un evento de una pasada anterior
 *     (ej. la tarea que lo generó se completó o se borró después), se
 *     borra; si nunca hubo nada que mostrar esa noche, no se toca Calendar
 *     para nada — este es el caso que antes "aparecía igual" y ahora
 *     directamente nunca llega a crear un evento.
 *
 * No hace nada si el switch general, el scope, o el Resumen Diario en
 * particular están apagados, ni si `fechaAlarmaIso` ya pasó (no hay alarma
 * que ajustar). Best-effort: nunca bloquea el guardado real de lo que haya
 * disparado la llamada, que ya ocurrió antes de llegar acá.
 */
async function sincronizarResumenParaFechaAlarma(fechaAlarmaIso, fechaEventoIso) {
  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) return;
  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen?.activo) return;
  if (fechaAlarmaIso < fechaLocalISO()) return; // esa alarma ya pasó, no hay nada que ajustar

  const idsGuardados = (estado.datos.configuracion.google_calendar_resumen_eventos ||= {});
  const idExistente = idsGuardados[fechaAlarmaIso];
  const resumen = generarResumenParaFecha(fechaEventoIso);

  try {
    const calendarId = await asegurarCalendarioSecundario();

    if (!resumen) {
      if (!idExistente) return; // nunca hubo nada que mostrar esa noche, nada que borrar
      await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, idExistente));
      delete idsGuardados[fechaAlarmaIso];
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      return;
    }

    const cuerpo = construirCuerpoResumenIndividual(cfgResumen, fechaAlarmaIso, resumen);

    if (idExistente) {
      try {
        await conTokenValido((token) => actualizarEventoCalendar(token, calendarId, idExistente, cuerpo));
        return;
      } catch (e) {
        // El evento fue borrado del lado de Calendar por fuera de la app —
        // se limpia el id guardado y se cae al insert de abajo para
        // recrearlo, mismo criterio que sincronizarEventoCalendario.
        if (!(e && (e.status === 404 || e.status === 410))) throw e;
        delete idsGuardados[fechaAlarmaIso];
      }
    }

    const creado = await conTokenValido((token) => insertarEventoCalendar(token, calendarId, cuerpo));
    idsGuardados[fechaAlarmaIso] = creado.id;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  } catch (e) {
    console.warn(`No se pudo sincronizar el Resumen Diario del ${fechaAlarmaIso} (no crítico):`, e);
  }
}

/** Borra TODOS los eventos individuales del Resumen Diario creados hasta
 *  ahora y vacía el mapa — reemplaza a la vieja eliminarEventoResumenSiExiste
 *  (que borraba un único evento recurrente). Se usa cuando se apaga el
 *  switch general o el del Resumen en particular. */
async function eliminarTodosLosResumenes() {
  const idsGuardados = estado.datos?.configuracion?.google_calendar_resumen_eventos;
  if (!idsGuardados || !Object.keys(idsGuardados).length) return;
  try {
    const calendarId = await asegurarCalendarioSecundario();
    for (const [fecha, id] of Object.entries(idsGuardados)) {
      try {
        await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, id));
      } catch (e) {
        console.warn(`No se pudo borrar el Resumen Diario del ${fecha} (no crítico):`, e);
      }
    }
  } catch (e) {
    console.warn("No se pudieron borrar los eventos del Resumen Diario (no crítico):", e);
  } finally {
    estado.datos.configuracion.google_calendar_resumen_eventos = {};
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }
}

/**
 * Se llama desde renderizarNotificacionesResumenDiario en config-ajustes.js
 * cada vez que cambia el switch o la hora elegida — mismo punto de entrada
 * que tenía el archivo viejo — y también una vez por día desde
 * actualizarResumenDiarioDelDia() como resync completo de red de seguridad
 * (ya no hace falta "renovar un horizonte de recurrencia": cada fecha es un
 * evento independiente, así que barrer todas las fechas relevantes y
 * reconciliar cada una alcanza).
 *
 * Recorre dos conjuntos de fechas de alarma: las que ya teníamos guardadas
 * (para poder detectar y borrar las que dejaron de tener contenido, o
 * quedaron vencidas) y las que corresponden a la noche anterior a cada
 * fecha con algo pendiente de hoy en adelante (para crear las que falten).
 * Además corre, una única vez, la migración del viejo evento recurrente si
 * quedó alguno de una versión anterior de la app.
 */
async function sincronizarResumenDiario() {
  await migrarResumenRecurrenteAntiguo();

  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) {
    await eliminarTodosLosResumenes();
    return;
  }

  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen?.activo) {
    await eliminarTodosLosResumenes();
    return;
  }

  const idsGuardados = (estado.datos.configuracion.google_calendar_resumen_eventos ||= {});
  const hoyIso = fechaLocalISO();

  const fechasConPendientes = new Set(
    (estado.datos.agenda || [])
      .filter((e) => !e.completada && !e.perdida && e.fecha && e.fecha >= hoyIso)
      .map((e) => e.fecha)
  );

  const fechasAlarma = new Set(Object.keys(idsGuardados));
  for (const fechaEvento of fechasConPendientes) {
    const d = new Date(`${fechaEvento}T00:00:00`);
    d.setDate(d.getDate() - 1);
    fechasAlarma.add(fechaLocalISO(d));
  }

  for (const fechaAlarmaIso of fechasAlarma) {
    if (fechaAlarmaIso < hoyIso) {
      // Quedó vieja (esa noche ya pasó): se limpia la referencia, y si el
      // evento puntual todavía existiera en Calendar por algún motivo
      // (ej. la app estuvo cerrada y nadie llegó a borrarlo a tiempo), se
      // borra también en vez de dejarlo suelto para siempre.
      const idViejo = idsGuardados[fechaAlarmaIso];
      if (idViejo) {
        try {
          const calendarId = await asegurarCalendarioSecundario();
          await conTokenValido((token) => eliminarEventoCalendar(token, calendarId, idViejo));
        } catch (e) {
          console.warn(`No se pudo borrar el Resumen Diario vencido del ${fechaAlarmaIso} (no crítico):`, e);
        }
        delete idsGuardados[fechaAlarmaIso];
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
      }
      continue;
    }
    const d = new Date(`${fechaAlarmaIso}T00:00:00`);
    d.setDate(d.getDate() + 1);
    const fechaEventoIso = fechaLocalISO(d);
    await sincronizarResumenParaFechaAlarma(fechaAlarmaIso, fechaEventoIso);
  }
}

/**
 * Se llama UNA vez por día, la primera vez que la app arranca ese día (ver
 * main.js, justo después de mostrarApp()) — deduplicada contra
 * configuracion.resumen_diario_actualizado_el para no pegarle a la API de
 * Calendar en cada carga. Ahora es solo el wrapper de deduplicación diaria
 * sobre sincronizarResumenDiario() (resync completo) — ya no hace falta
 * ninguna lógica propia acá, porque al no haber recurrencia el resync
 * completo YA cubre "hoy/mañana" como un caso más entre todas las fechas
 * con contenido pendiente.
 */
async function actualizarResumenDiarioDelDia() {
  if (!sincronizacionCalendarActiva() || !tieneScopeCalendarOtorgado()) return;
  const cfgResumen = estado.datos?.configuracion?.notificaciones_resumen_diario;
  if (!cfgResumen?.activo) return;

  const hoyIso = fechaLocalISO();
  if (estado.datos.configuracion.resumen_diario_actualizado_el === hoyIso) return; // ya se hizo hoy

  try {
    await sincronizarResumenDiario();
    estado.datos.configuracion.resumen_diario_actualizado_el = hoyIso;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  } catch (e) {
    console.warn("No se pudo actualizar el Resumen Diario de hoy (no crítico):", e);
  }
}

/**
 * Reactivo: se sigue llamando desde sincronizarEventoCalendario y
 * eliminarEventoCalendarizado (agenda.js/agenda-modal.js) cada vez que se
 * crea, edita, completa o borra un EventoAgenda con fecha — recalcula DE
 * UNA la noche anterior a ESA fecha puntual, sin esperar al resync diario.
 * También la llama guardarEventoAgenda (agenda-modal.js) con la fecha VIEJA
 * de un evento que se movió de día, para que esa noche también se
 * recalcule (por si ese evento era el único pendiente que le quedaba).
 *
 * El recálculo (generarResumenParaFecha, adentro de
 * sincronizarResumenParaFechaAlarma) siempre vuelve a mirar TODOS los
 * eventos pendientes de `fechaEventoIso`, no solo el que disparó el cambio
 * — por eso "ya había otro evento ese día" no necesita ningún caso
 * especial: la próxima llamada arma el listado completo con todos.
 */
async function sincronizarResumenParaFechaEvento(fechaEventoIso) {
  if (!fechaEventoIso) return;
  const fechaAlarmaDate = new Date(`${fechaEventoIso}T00:00:00`);
  fechaAlarmaDate.setDate(fechaAlarmaDate.getDate() - 1);
  const fechaAlarmaIso = fechaLocalISO(fechaAlarmaDate);
  await sincronizarResumenParaFechaAlarma(fechaAlarmaIso, fechaEventoIso);
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
    // sesión ANTES de este cambio no lo tiene todavía. Se solicita el scope
    // adicional mediante consentimiento incremental, conservando la sesión
    // y los datos actuales (ver solicitarPermisoCalendar en auth.js).
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

  await eliminarTodosLosResumenes();
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
 * Se presenta en un modal dedicado. El usuario puede continuar sin activar
 * Calendar o solicitar su permiso con la sesión actual; no se cierra la
 * sesión ni se borran credenciales o datos locales.
 */
function avisarFaltaPermisoCalendar() {
  document.getElementById("modal-permiso-calendario").classList.remove("oculto");
}

/** Engancha el botón de autorización incremental — se llama una vez al
 *  arrancar la app (ver lista de inicializadores en el DOMContentLoaded
 *  de main.js, mismo criterio que inicializarModalCompletarUniversidades). */
function inicializarModalPermisoCalendario() {
  document.getElementById("btn-posponer-calendario").addEventListener("click", () => {
    document.getElementById("modal-permiso-calendario").classList.add("oculto");
  });
  document.getElementById("btn-autorizar-calendario").addEventListener("click", () => {
    document.getElementById("modal-permiso-calendario").classList.add("oculto");
    // GIS abre el consentimiento desde este gesto del usuario y conserva
    // el estado local/Drive mientras agrega el scope faltante.
    solicitarPermisoCalendar();
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
  sincronizarResumenParaFechaEvento,
};
