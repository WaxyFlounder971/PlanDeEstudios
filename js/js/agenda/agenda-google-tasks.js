/* =========================================================================
   GOOGLE TASKS — Sincronización de solo lectura
   -------------------------------------------------------------------------
   Trae las tareas de la lista de Google Tasks elegida por el usuario en
   Ajustes (configuracion.google_tasks_sync, ver config-ajustes.js) y las
   ofrece como propuestas de EventoAgenda — copia 1:1 del nombre tal cual
   está en Google, SIN pasar por Gemini (a diferencia de Bandeja Pendiente,
   acá no hay lenguaje natural que interpretar: cada tarea de Google YA es
   un ítem individual). Scope tasks.readonly (ver auth.js/
   pedirAccessTokenGoogleTasks): esta app nunca escribe, completa ni borra
   nada del lado de Google Tasks.

   Confirmación liviana (decisión ya tomada con el usuario): en vez de
   crear los eventos directo, se devuelve la lista de propuestas para que
   la UI (un modal/lista con checkboxes, análogo a la de Bandeja Pendiente)
   las muestre y el usuario confirme/descarte antes de guardar — así,
   si falla la llamada a la API, el usuario lo ve ahí mismo en vez de que
   pase en silencio.

   Dedupe: configuracion.google_tasks_sync.ids_procesados guarda los ids de
   tareas de Google YA revisadas (confirmadas, descartadas, o sin nada
   reconocible) — como el scope es de solo lectura, esta lista es la ÚNICA
   forma de no volver a proponer la misma tarea en cada sincronización (ver
   comentario completo en schema.js, junto a ese campo).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { crearEventoAgenda, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { programarRecordatorioPush } from "../core/notificaciones-push.js";
import { pedirAccessTokenGoogleTasks, haySesionGoogleTasksEnMemoria } from "../core/auth.js";

const API_BASE = "https://tasks.googleapis.com/tasks/v1";

async function llamarTasksAPI(token, ruta) {
  const respuesta = await fetch(`${API_BASE}${ruta}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Google Tasks respondió ${respuesta.status}: ${cuerpo}`);
    error.status = respuesta.status;
    throw error;
  }
  return respuesta.json();
}

/**
 * Lista las listas de tareas del usuario (selector en Ajustes, ver
 * inicializarGoogleTasksAjustes en config-ajustes.js). Devuelve
 * [{ id, title }] — arreglo vacío si la cuenta no tiene ninguna lista
 * (caso borde real, toda cuenta de Google Tasks trae al menos "Mis
 * tareas" por defecto, pero no se asume).
 */
async function listarListasGoogleTasks(token) {
  const datos = await llamarTasksAPI(token, "/users/@me/lists?maxResults=100");
  return (datos.items || []).map((lista) => ({ id: lista.id, title: lista.title || "Sin nombre" }));
}

/**
 * "YYYY-MM-DD" a partir del campo `due` de Google Tasks (RFC3339, ej.
 * "2026-08-25T00:00:00.000Z") — Google Tasks NUNCA maneja hora real para
 * `due` (siempre queda en medianoche UTC, sin importar qué hora local
 * eligiera el usuario al ponerla en Google) así que se toma solo la parte
 * de fecha, sin intentar convertir un huso horario que no tiene
 * información real detrás. `null` si la tarea no tiene fecha en absoluto.
 */
function fechaDesdeDueGoogle(due) {
  if (!due || typeof due !== "string") return null;
  const [fecha] = due.split("T");
  return /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null;
}

/**
 * Trae las tareas NO completadas de la lista elegida y filtra las que ya
 * se procesaron antes (ids_procesados). Devuelve un arreglo de propuestas
 * listas para mostrar en la UI de confirmación:
 *   [{ googleTaskId, nombre, fecha }]
 * Nunca crea eventos acá — eso lo hace confirmarTareasGoogleImportadas()
 * más abajo, una vez que el usuario elige cuáles de estas propuestas
 * confirmar.
 */
async function obtenerPropuestasGoogleTasks() {
  const cfg = estado.datos?.configuracion?.google_tasks_sync;
  if (!cfg || !cfg.activo || !cfg.lista_id) return [];

  const token = haySesionGoogleTasksEnMemoria()
    ? await pedirAccessTokenGoogleTasks({ interactivo: false })
    : await pedirAccessTokenGoogleTasks({ interactivo: false });
  if (!token) return [];

  const datos = await llamarTasksAPI(
    token,
    `/lists/${encodeURIComponent(cfg.lista_id)}/tasks?showCompleted=false&showHidden=false&maxResults=100`
  );
  const procesados = new Set(cfg.ids_procesados || []);

  return (datos.items || [])
    .filter((tarea) => !procesados.has(tarea.id) && tarea.title && tarea.title.trim())
    .map((tarea) => ({
      googleTaskId: tarea.id,
      nombre: tarea.title.trim(),
      fecha: fechaDesdeDueGoogle(tarea.due),
    }));
}

/**
 * Marca un conjunto de ids de tareas de Google como ya procesados (se
 * llame confirmando, descartando, o simplemente para no volver a
 * mostrarlas) — único punto de escritura de ids_procesados, para no
 * duplicar este patrón en cada lugar que lo necesite.
 */
function marcarComoProcesados(idsGoogle) {
  const cfg = estado.datos.configuracion.google_tasks_sync;
  const procesados = new Set(cfg.ids_procesados || []);
  idsGoogle.forEach((id) => procesados.add(id));
  cfg.ids_procesados = Array.from(procesados);
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
}

/**
 * Crea los EventoAgenda reales para las propuestas que el usuario confirmó
 * (checkboxes marcados en la UI de confirmación) y descarta el resto —
 * TODAS las propuestas mostradas (confirmadas o no) se marcan como
 * procesadas, para que un "no, gracias" no la haga reaparecer en la
 * próxima sincronización. Sin fecha si Google Tasks no la tiene, sin
 * materia vinculada (el usuario puede vincularla después a mano) — mismo
 * criterio del prompt original.
 */
function confirmarTareasGoogleImportadas(propuestas, idsConfirmados) {
  const confirmadosSet = new Set(idsConfirmados);
  const hoy = new Date();
  const fechaHoyIso = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, "0")}-${String(hoy.getDate()).padStart(2, "0")}`;

  estado.datos.agenda = estado.datos.agenda || [];
  propuestas
    .filter((p) => confirmadosSet.has(p.googleTaskId))
    .forEach((p) => {
      const evento = crearEventoAgenda({
        tipo: "tarea",
        nombre: p.nombre,
        fecha: p.fecha || fechaHoyIso,
        hora: null,
        materiaMatriculadaId: null,
        semestreId: null,
        notas: "",
        googleTaskId: p.googleTaskId,
      });
      estado.datos.agenda.push(evento);
      programarRecordatorioPush(evento);
    });

  marcarComoProcesados(propuestas.map((p) => p.googleTaskId));
  marcarCambioPendiente();
  window.renderizarAgenda?.();
  window.renderizarResumen?.();
}

export { listarListasGoogleTasks, obtenerPropuestasGoogleTasks, confirmarTareasGoogleImportadas, marcarComoProcesados };
