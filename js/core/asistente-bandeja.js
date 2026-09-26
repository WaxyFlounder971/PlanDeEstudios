/* =========================================================================
   BANDEJA PENDIENTE (Captura por voz — Atajo de Siri / Google Assistant)
   -------------------------------------------------------------------------
   Puente entre el buzón crudo del Worker (bandeja_pendiente, ver
   worker-notificaciones-agenda/src/index.js, endpoints /bandeja) y el
   Asistente IA ya construido (asistente.js): trae los ítems de texto/audio
   crudos que el Atajo de Siri fue dejando mientras la app estaba cerrada,
   los interpreta con el MISMO pipeline de Gemini que ya usa el chat en
   vivo (transcribirBase64ConGemini / extraerEventosDeTexto /
   guardarItemExtraidoComoEvento — nunca se duplica esa lógica acá), y deja
   cada evento ya guardado en Agenda.

   100% best-effort: se llama desde mostrarApp() (main.js) en cada arranque
   (sesión restaurada desde caché o login recién completado), sin await y
   sin bloquear nada del resto del arranque. Cualquier fallo (Worker caído,
   sin conexión, clave de Gemini vencida, un ítem puntual corrupto) se
   loguea y se salta — nunca debe tirar un error hacia afuera, ni frenar el
   resto de la sincronización de este ítem ni de los que siguen.

   El Worker NUNCA ve datos académicos ni la clave de Gemini del usuario:
   solo guarda/devuelve el texto o audio crudo tal cual llegó del Atajo, y
   este archivo hace toda la interpretación del lado del cliente, con la
   clave propia del usuario — mismo principio que notificaciones-push.js
   respecto al Worker de notificaciones (que de hecho es el MISMO Worker,
   ver worker-notificaciones-agenda: A.1/A.2/A.3/A.4 en el prompt original).
   ========================================================================= */

import { estado } from "./storage.js";
import { mostrarToastAccion } from "../ui/componentes.js";
import { extraerEventosDeTexto, guardarItemExtraidoComoEvento, transcribirBase64ConGemini } from "../asistente/asistente.js";

// Mismo Worker que ya usa core/notificaciones-push.js — un solo lugar de
// verdad para esta URL estaría mejor, pero notificaciones-push.js no la
// exporta (queda como constante interna de ese archivo) y duplicarla acá
// es más simple que forzar un export cruzado solo para esto. Si el Worker
// alguna vez cambia de subdominio, hay que actualizar los dos archivos —
// ver worker-notificaciones-agenda/README.md, paso 6.
const URL_WORKER_NOTIFICACIONES = "https://worker-notificaciones-agenda.appacademica.workers.dev";

// Evita sincronizar dos veces en paralelo (ej. mostrarApp() se llama tanto
// en el camino de caché como, más tarde, cuando termina el login real —
// ver comentario en main.js) y evita machacar la cuota de la API de Gemini
// del usuario si algo dispara esto más de una vez seguida por error.
let sincronizacionEnCurso = false;

/**
 * Trae los ítems crudos pendientes del buzón de este usuario. Devuelve un
 * arreglo (vacío si no hay nada o si el Worker no respondió bien) — nunca
 * tira, para que sincronizarBandejaPendiente() decida en un solo lugar qué
 * hacer con un fallo de red.
 */
async function obtenerItemsPendientes(idBandeja) {
  const respuesta = await fetch(`${URL_WORKER_NOTIFICACIONES}/bandeja/${encodeURIComponent(idBandeja)}`);
  if (!respuesta.ok) {
    throw new Error(`El Worker respondió ${respuesta.status} al listar la bandeja.`);
  }
  const datos = await respuesta.json().catch(() => null);
  return Array.isArray(datos) ? datos : Array.isArray(datos?.items) ? datos.items : [];
}

/** Borra del Worker un ítem ya procesado (confirmado, descartado, o que no
 *  arrojó ningún evento reconocible) — ver A.4 del prompt original. Nunca
 *  tira: si el borrado falla, el ítem simplemente se vuelve a ver en la
 *  próxima sincronización (mejor un duplicado ocasional que perder el
 *  registro de qué ya se procesó). */
async function borrarItemDeBandeja(idBandeja, itemId) {
  try {
    await fetch(`${URL_WORKER_NOTIFICACIONES}/bandeja/${encodeURIComponent(idBandeja)}/${encodeURIComponent(itemId)}`, {
      method: "DELETE",
    });
  } catch (e) {
    console.warn("[bandeja] No se pudo borrar el ítem ya procesado del Worker (no crítico):", e);
  }
}

/**
 * Convierte UN ítem crudo del buzón (texto o audio) en texto plano listo
 * para extraerEventosDeTexto — si es audio, primero lo transcribe con el
 * mismo camino de Gemini que ya usa el botón de micrófono del chat (ver
 * transcribirBase64ConGemini en asistente.js). Devuelve `null` si el ítem
 * no trae ni texto ni audio (dato corrupto) o si la transcripción falla.
 */
async function resolverTextoDelItem(item) {
  if (item.texto && item.texto.trim()) return item.texto.trim();
  if (item.audio_base64) {
    try {
      const texto = await transcribirBase64ConGemini(item.audio_base64, item.mime_type || "audio/webm");
      return texto && texto.trim() ? texto.trim() : null;
    } catch (e) {
      console.warn(`[bandeja] No se pudo transcribir el audio del ítem ${item.id}:`, e);
      return null;
    }
  }
  return null;
}

/**
 * Procesa UN ítem completo: texto/audio -> Gemini -> eventos guardados en
 * Agenda -> borrado del buzón. Devuelve la cantidad de eventos que terminó
 * guardando (0 si no se reconoció nada, o si algo falló) — nunca tira,
 * para que un ítem puntual corrupto no aborte el resto de la bandeja.
 */
async function procesarItemBandeja(idBandeja, item) {
  try {
    const texto = await resolverTextoDelItem(item);
    if (!texto) {
      // Ni texto ni audio transcribible: no hay nada que reconstruir de
      // este ítem — se descarta igual que un ítem ya revisado, para que no
      // quede repitiéndose en cada sincronización sin nunca poder resolverse.
      await borrarItemDeBandeja(idBandeja, item.id);
      return 0;
    }

    const resultado = await extraerEventosDeTexto(texto);
    // resultado.items === [] (sin aclaración real, o con una que nadie va
    // a contestar porque este flujo no es conversacional) también cuenta
    // como "revisado" — no tiene sentido dejarlo pendiente para siempre.
    resultado.items.forEach((item) => guardarItemExtraidoComoEvento(item));

    await borrarItemDeBandeja(idBandeja, item.id);
    return resultado.items.length;
  } catch (e) {
    // Fallo real (Gemini caído, clave inválida, sin red): a propósito NO
    // se borra el ítem del Worker — se reintenta en la próxima
    // sincronización en vez de perderlo silenciosamente.
    console.warn(`[bandeja] No se pudo procesar el ítem ${item.id}:`, e);
    return 0;
  }
}

/**
 * Punto de entrada — llamado desde mostrarApp() (main.js) en cada arranque.
 * No hace nada si el switch de Captura por voz está apagado, si todavía no
 * hay id_bandeja generado, o si no hay clave de Gemini guardada (sin eso no
 * hay forma de interpretar nada, igual que el chat del Asistente).
 */
async function sincronizarBandejaPendiente() {
  if (sincronizacionEnCurso) return;

  const cfg = estado.datos?.configuracion?.bandeja_voz;
  if (!cfg || !cfg.activo || !cfg.id_bandeja) return;
  if (!estado.datos?.configuracion?.gemini_api_key) return;

  sincronizacionEnCurso = true;
  try {
    const items = await obtenerItemsPendientes(cfg.id_bandeja);
    if (items.length === 0) return;

    let totalEventosGuardados = 0;
    // Secuencial (no Promise.all) a propósito: cada ítem dispara su propia
    // llamada a Gemini, y de a una es más fácil no chocar contra el límite
    // de tasa de la clave del usuario si el buzón trae varios ítems juntos
    // (ej. varios días sin abrir la app).
    for (const item of items) {
      totalEventosGuardados += await procesarItemBandeja(cfg.id_bandeja, item);
    }

    if (totalEventosGuardados > 0) {
      const mensaje =
        totalEventosGuardados === 1
          ? "Se agregó 1 tarea desde tu bandeja de voz."
          : `Se agregaron ${totalEventosGuardados} tareas desde tu bandeja de voz.`;
      mostrarToastAccion(mensaje, "Revisar en Asistente", () => {
        window.mostrarSeccion?.("asistente");
      });
    }
  } catch (e) {
    console.warn("[bandeja] No se pudo sincronizar la bandeja pendiente (no crítico):", e);
  } finally {
    sincronizacionEnCurso = false;
  }
}

export { sincronizarBandejaPendiente };
