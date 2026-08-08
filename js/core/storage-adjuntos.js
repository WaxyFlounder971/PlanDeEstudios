/* =========================================================================
   ADJUNTOS — orquestación (2026-08-08)
   -------------------------------------------------------------------------
   Piezas ya existentes que este módulo conecta, sin duplicar nada de ellas:
     - schema.js:        crearAdjunto() / sellarTimestamp() → la referencia
                          liviana que SÍ vive en el JSON central.
     - auth.js:           subirArchivoBinarioADrive/descargarArchivoBinarioDeDrive/
                          eliminarArchivoDeDriveConId → el contenido real,
                          que vive en SU PROPIO archivo de Drive, aparte.
     - storage-merge.js:  adjuntos ya se funde como cualquier otra colección
                          plana (fusionarColeccion) — cero lógica de fusión
                          nueva acá.
     - storage-sync.js:   conReintentoSi401 (reintento tras token vencido) +
                          marcarCambioPendiente (sube la referencia liviana
                          al JSON central, igual que cualquier otra edición).

   Lo que SÍ es nuevo acá es el ciclo de vida del BINARIO, que nunca pasa
   por marcarCambioPendiente()/intentarSincronizar() (esos son solo para el
   JSON central):
     1. Elegís un archivo → la referencia se crea y aparece YA en la UI,
        con subidaPendiente:true. El binario se sube aparte, en segundo
        plano (colaSubidaPendiente, en memoria de esta pestaña).
     2. Ver/descargar un adjunto → se pide bajo demanda, nunca de antemano.
     3. Borrar un adjunto → tumba en el JSON (igual que enlaces rápidos) +
        intento de borrar el archivo real de Drive. Si ese intento falla
        (sin conexión, etc.), el archivo queda huérfano hasta que ESTE u
        OTRO dispositivo procese la tumba (ver procesarTumbasDriveHuerfanas).

   LIMITACIÓN CONOCIDA (léase antes de usar en producción): colaSubidaPendiente
   vive en memoria, no en localStorage — si el usuario cierra la pestaña o
   pierde conexión ANTES de que la subida termine, esa referencia queda
   con subidaPendiente:true "para siempre" en el JSON hasta que abra la app
   de nuevo EN ESE MISMO DISPOSITIVO (el `File` original no sobrevive un
   reload; no se puede reanudar la subida desde otro dispositivo). Si esto
   te llega a pasar seguido, la solución real es cachear los bytes del
   archivo en IndexedDB antes de intentar subir — lo dejo fuera de este
   diseño a propósito para no aumentar el alcance sin que lo pidas, pero
   avisame si lo querés agregar.
   ========================================================================= */

import { crearAdjunto, LIMITE_MB_ADJUNTO, sellarTimestamp } from "./schema.js";
import {
  descargarArchivoBinarioDeDrive,
  eliminarArchivoDeDriveConId,
  subirArchivoBinarioADrive,
} from "./auth.js";
import { conReintentoSi401, marcarCambioPendiente, registrarHookPostFusion } from "./storage-sync.js";
import { estado } from "./storage.js";

/* ------------------------- Cola de subida (en memoria) ------------------------- */

// { adjuntoId, archivo }[] — solo dura mientras esta pestaña está abierta,
// ver limitación conocida arriba.
const colaSubidaPendiente = [];

// Evita que dos llamadas simultáneas a procesarColaSubidas() (ej. un
// 'online' disparándose justo cuando ya había una subida en curso) procesen
// la misma cola en paralelo y dupliquen intentos.
let procesandoColaSubidas = false;

/**
 * Punto de entrada: el usuario eligió un archivo para adjuntar. Crea la
 * referencia local YA (la UI responde al instante, con subidaPendiente:true)
 * y encola el binario para subir aparte. Devuelve la referencia creada por
 * si quien llama quiere pintarla de inmediato sin esperar a re-renderizar
 * toda la lista.
 */
function adjuntarArchivo(archivo, entidadTipo, entidadId) {
  const limiteBytes = LIMITE_MB_ADJUNTO * 1024 * 1024;
  if (archivo.size > limiteBytes) {
    throw new Error(`El archivo pesa más de ${LIMITE_MB_ADJUNTO}MB — elegí uno más liviano.`);
  }

  const nuevo = crearAdjunto({
    nombre: archivo.name,
    mimeType: archivo.type,
    tamanoBytes: archivo.size,
    entidadTipo,
    entidadId,
  });
  sellarTimestamp(nuevo);

  if (!Array.isArray(estado.datos.adjuntos)) estado.datos.adjuntos = [];
  estado.datos.adjuntos.push(nuevo);
  marcarCambioPendiente(); // sube la REFERENCIA (liviana) ya mismo

  colaSubidaPendiente.push({ adjuntoId: nuevo.id, archivo });
  procesarColaSubidas(); // intenta subir el BINARIO ya mismo, sin esperar

  return nuevo;
}

/** Reintenta cualquier subida pendiente — se llama sola tras adjuntarArchivo,
 *  y conviene engancharla también al evento 'online' (ver abajo) y, si
 *  querés, a un intervalo corto desde main.js, mismo patrón que ya usa
 *  intentarSincronizar() en storage-sync.js. */
async function procesarColaSubidas() {
  if (procesandoColaSubidas) return;
  procesandoColaSubidas = true;
  try {
    // Se recorre por índice y se van sacando de a uno para no perder de
    // vista un ítem si otra llamada se dispara a mitad de camino (ej. el
    // usuario adjunta un 2do archivo mientras el 1ro todavía está subiendo).
    while (colaSubidaPendiente.length > 0) {
      const { adjuntoId, archivo } = colaSubidaPendiente[0];
      const referencia = (estado.datos.adjuntos || []).find((a) => a.id === adjuntoId);

      // La referencia ya no existe (el usuario lo borró mientras esperaba
      // en cola) — no tiene sentido subir un binario para algo que ya se
      // tumbó localmente. Se descarta de la cola sin subir nada.
      if (!referencia) {
        colaSubidaPendiente.shift();
        continue;
      }

      try {
        if (!estado.token) break; // sin sesión de Drive todavía: se reintenta en el próximo llamado
        const driveFileId = await conReintentoSi401(() => subirArchivoBinarioADrive(estado.token, archivo));
        referencia.driveFileId = driveFileId;
        referencia.subidaPendiente = false;
        sellarTimestamp(referencia);
        marcarCambioPendiente(); // avisa al resto de dispositivos que el adjunto ya está listo
        colaSubidaPendiente.shift();
      } catch (e) {
        console.warn(`No se pudo subir el adjunto "${referencia.nombre}", se reintentará:`, e.status || e.message || e);
        break; // se deja al frente de la cola — se reintenta en el próximo llamado, no se pierde el orden
      }
    }
  } finally {
    procesandoColaSubidas = false;
  }
}

// Reintento oportunista al recuperar conexión — mismo criterio que
// marcarCambioPendiente() en storage-sync.js (`if (navigator.onLine)
// intentarSincronizar()`), pero para el binario en vez del JSON central.
window.addEventListener("online", () => {
  if (colaSubidaPendiente.length > 0) procesarColaSubidas();
});

/* ------------------------------- Descarga ------------------------------- */

/**
 * Descarga bajo demanda el contenido real de un adjunto y devuelve un
 * Blob URL listo para abrir en una pestaña nueva o asignar a un <a href>
 * con `download`. Quien llama es responsable de revocar la URL
 * (URL.revokeObjectURL) cuando ya no la necesite, para no dejar memoria
 * reservada de más si el usuario descarga varios adjuntos en la sesión.
 */
async function descargarAdjunto(adjunto) {
  if (!adjunto.driveFileId) {
    throw new Error("Este adjunto todavía se está subiendo — probá de nuevo en un momento.");
  }
  const blob = await conReintentoSi401(() => descargarArchivoBinarioDeDrive(estado.token, adjunto.driveFileId));
  return URL.createObjectURL(blob);
}

/* -------------------------------- Borrado -------------------------------- */

/**
 * Borra un adjunto: tumba real en el JSON (mismo patrón ya usado para
 * enlaces rápidos — sellarTimestamp sobre un objeto liviano para conseguir
 * un contador de Lamport válido, ya que avanzarRelojLogico no está
 * exportado de schema.js) + intento best-effort de borrar el archivo real
 * de Drive. Si ese intento falla ahora (sin red, token vencido sin poder
 * renovarse, etc.), no revienta nada: el driveFileId queda guardado EN LA
 * TUMBA MISMA (no solo en la referencia, que ya se va a borrar) para que
 * procesarTumbasDriveHuerfanas() —de este dispositivo u otro— lo intente
 * de nuevo más adelante.
 */
async function eliminarAdjunto(adjuntoId) {
  const referencia = (estado.datos.adjuntos || []).find((a) => a.id === adjuntoId);
  if (!referencia) return;

  const tumba = sellarTimestamp({ id: adjuntoId });
  if (!Array.isArray(estado.datos._eliminados_adjuntos)) estado.datos._eliminados_adjuntos = [];
  estado.datos._eliminados_adjuntos.push({
    id: adjuntoId,
    eliminadoEn: tumba._actualizadoEn,
    driveFileId: referencia.driveFileId, // null si todavía no había terminado de subir
  });

  estado.datos.adjuntos = estado.datos.adjuntos.filter((a) => a.id !== adjuntoId);
  marcarCambioPendiente();

  // Saca cualquier subida pendiente de este adjunto de la cola — ya no
  // tiene sentido subir el binario de algo recién borrado.
  const idxEnCola = colaSubidaPendiente.findIndex((c) => c.adjuntoId === adjuntoId);
  if (idxEnCola !== -1) colaSubidaPendiente.splice(idxEnCola, 1);

  if (referencia.driveFileId) {
    try {
      await conReintentoSi401(() => eliminarArchivoDeDriveConId(estado.token, referencia.driveFileId));
      marcarTumbaDriveComoProcesada(adjuntoId);
    } catch (e) {
      // No crítico — queda para que procesarTumbasDriveHuerfanas() lo
      // reintente (acá mismo, en el próximo sync, o desde otro dispositivo).
      console.warn(`No se pudo borrar de Drive el archivo del adjunto "${referencia.nombre}" todavía:`, e.status || e.message || e);
    }
  }
}

/* ------------------- Limpieza de archivos huérfanos en Drive ------------------- */

// Set en memoria — evita reintentar en la MISMA sesión una tumba que ya se
// procesó (con éxito o con un 404 que ya cuenta como éxito). No hace falta
// persistirlo: si de verdad falló, la tumba sigue en _eliminados_adjuntos
// (viaja con el sync normal del JSON) y se reintenta en la próxima sesión.
const tumbasDriveIntentadasEnEstaSesion = new Set();

function marcarTumbaDriveComoProcesada(adjuntoId) {
  tumbasDriveIntentadasEnEstaSesion.add(adjuntoId);
}

/**
 * Recorre las tumbas de adjuntos buscando archivos de Drive que quedaron
 * huérfanos (el borrado se registró en el JSON pero el archivo real nunca
 * se llegó a borrar — típicamente porque el dispositivo que borró estaba
 * offline en ese momento) y los borra. CUALQUIER dispositivo puede procesar
 * la tumba de CUALQUIER otro — borrar un archivo de Drive es una llamada
 * autenticada genérica, no depende de tener el archivo original en memoria
 * (a diferencia de subirlo). Pensada para llamarse después de cada fusión
 * remota (ver el hook en storage-sync.js/aplicarDatosRemotosFrescos) — se
 * ejecuta en segundo plano, sin bloquear ni avisar nada al usuario.
 */
async function procesarTumbasDriveHuerfanas() {
  if (!estado.token) return;
  const tumbas = estado.datos && estado.datos._eliminados_adjuntos;
  if (!Array.isArray(tumbas)) return;

  for (const tumba of tumbas) {
    if (!tumba.driveFileId) continue; // nunca llegó a subirse: no hay nada que borrar en Drive
    if (tumbasDriveIntentadasEnEstaSesion.has(tumba.id)) continue;
    try {
      await conReintentoSi401(() => eliminarArchivoDeDriveConId(estado.token, tumba.driveFileId));
      marcarTumbaDriveComoProcesada(tumba.id);
    } catch (e) {
      console.warn(`No se pudo limpiar el archivo huérfano de Drive de la tumba "${tumba.id}":`, e.status || e.message || e);
      // Sin marcar como procesada: se reintenta en la próxima fusión remota.
    }
  }
}

/* -------------------------------- Lectura -------------------------------- */

/** Helper de renderizado: adjuntos vigentes (ya fundidos, sin los borrados)
 *  de una entidad puntual (ej. una materia, un evento de agenda). */
function obtenerAdjuntosDe(entidadTipo, entidadId) {
  return (estado.datos.adjuntos || []).filter(
    (a) => a.entidadTipo === entidadTipo && a.entidadId === entidadId
  );
}

export {
  adjuntarArchivo,
  descargarAdjunto,
  eliminarAdjunto,
  obtenerAdjuntosDe,
  procesarColaSubidas,
  procesarTumbasDriveHuerfanas,
};
