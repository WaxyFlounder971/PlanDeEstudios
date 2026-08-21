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
  buscarOCrearCarpetaEnDrive,
  descargarArchivoBinarioDeDrive,
  eliminarArchivoDeDriveConId,
  subirArchivoBinarioADrive,
} from "./auth.js";
import { conReintentoSi401, marcarCambioPendiente, registrarHookPostFusion } from "./storage-sync.js";
import { estado } from "./storage.js";

// Fix 2026-08-08: el import de arriba estaba pero nunca se USABA — faltaba
// esta línea. Sin ella, storage-sync.js nunca se enteraba de que este
// módulo quería correr algo tras cada fusión remota, así que
// procesarTumbasDriveHuerfanas() nunca se disparaba sola (solo quedaba
// disponible para llamarla a mano). Se registra acá, a nivel de módulo, así
// que corre una sola vez apenas se importa storage-adjuntos.js en la app —
// mismo momento en el que ya conviene tener el hook listo.
registrarHookPostFusion(procesarTumbasDriveHuerfanas);

/* ------------------------- Carpeta dedicada en Drive ------------------------- */

// Nombre fijo, mismo criterio que NOMBRE_CARPETA_BACKUP en auth.js — todos
// los adjuntos (de cualquier materia/evento) vivven juntos acá adentro en
// vez de sueltos en la raíz visible de la app, para que Drive quede
// ordenado y sea fácil de encontrar/limpiar a mano si hiciera falta.
const NOMBRE_CARPETA_ADJUNTOS = "ArchivosAdjuntos";

// Se resuelve una sola vez por sesión (buscarOCrearCarpetaEnDrive ya es
// idempotente del lado de Drive, pero cachear acá evita una llamada de red
// extra por cada archivo que se sube en la misma pestaña).
let folderIdAdjuntosCache = null;

async function obtenerCarpetaAdjuntos(token) {
  if (folderIdAdjuntosCache) return folderIdAdjuntosCache;
  folderIdAdjuntosCache = await conReintentoSi401(() => buscarOCrearCarpetaEnDrive(token, NOMBRE_CARPETA_ADJUNTOS));
  return folderIdAdjuntosCache;
}

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
 *
 * `nombrePersonalizado` (opcional, pedido explícito — antes el pill SIEMPRE
 * mostraba el nombre crudo del archivo elegido, sin forma de renombrarlo):
 * si viene con texto, se usa tal cual como `nombre` de la referencia; si
 * viene vacío/undefined, cae al nombre original del archivo (`archivo.name`,
 * comportamiento de siempre). El binario en Drive SIEMPRE se sube con el
 * nombre real del archivo — esto solo cambia la ETIQUETA que se muestra en
 * la app, nunca el archivo físico.
 *
 * `emojiPersonalizado` (opcional, 2026-08-19, pedido explícito — reemplaza
 * el emoji GLOBAL de configuracion.agendaAdjuntarEmoji que se pedía con un
 * window.prompt() nativo, que rompía el diseño): emoji propio de ESTE
 * adjunto puntual, elegido en el mismo campo de texto que el nombre (ver
 * crearCampoEmojiModal en ui/adjuntos-ui.js) — nunca un diálogo del
 * navegador. `null` si se deja vacío (nunca string vacío), para que el
 * resto de la UI pueda hacer un simple `adjunto.emoji || iconoPorDefecto`
 * sin distinguir "" de null/undefined.
 */
function adjuntarArchivo(archivo, entidadTipo, entidadId, nombrePersonalizado, emojiPersonalizado) {
  const limiteBytes = LIMITE_MB_ADJUNTO * 1024 * 1024;
  if (archivo.size > limiteBytes) {
    throw new Error(`El archivo pesa más de ${LIMITE_MB_ADJUNTO}MB — elegí uno más liviano.`);
  }

  const nombreLimpio = (nombrePersonalizado || "").trim();

  const nuevo = crearAdjunto({
    nombre: nombreLimpio || archivo.name,
    mimeType: archivo.type,
    tamanoBytes: archivo.size,
    entidadTipo,
    entidadId,
  });
  // Sin acceso a schema.js en esta sesión para agregarle este campo a la
  // firma de crearAdjunto() — se asigna acá como un campo plano más sobre
  // el objeto ya creado (misma colección JSON sin esquema estricto que ya
  // usa el resto de la app para campos opcionales). Recomendado: si en
  // algún momento se toca schema.js, mover esto al `crearAdjunto({...})`
  // de arriba para que quede documentado ahí también.
  nuevo.emoji = (emojiPersonalizado || "").trim() || null;
  sellarTimestamp(nuevo);

  if (!Array.isArray(estado.datos.adjuntos)) estado.datos.adjuntos = [];
  estado.datos.adjuntos.push(nuevo);
  marcarCambioPendiente(); // sube la REFERENCIA (liviana) ya mismo

  colaSubidaPendiente.push({ adjuntoId: nuevo.id, archivo });
  procesarColaSubidas(); // intenta subir el BINARIO ya mismo, sin esperar

  return nuevo;
}

/**
 * Punto de entrada para un adjunto tipo "enlace" (URL externa: PDF ya
 * alojado en otro lado, link a la librería del curso, etc.) — a diferencia
 * de adjuntarArchivo, esto nunca toca Drive ni la cola de subida: la
 * referencia queda lista y sincronizable de una sola vez, igual que
 * cualquier otra entidad simple de este JSON (ver crearEnlaceRapido).
 */
function agregarEnlaceAdjunto({ nombre, url, entidadTipo, entidadId, emoji }) {
  if (!url || !/^https?:\/\//i.test(url.trim())) {
    throw new Error("El enlace debe ser una URL válida (empezar con http:// o https://).");
  }
  const nuevo = crearAdjunto({ nombre, url: url.trim(), entidadTipo, entidadId, tipo: "enlace" });
  // Mismo criterio y misma limitación (sin schema.js a mano) que en
  // adjuntarArchivo — ver ese comentario para el detalle.
  nuevo.emoji = (emoji || "").trim() || null;
  sellarTimestamp(nuevo);

  if (!Array.isArray(estado.datos.adjuntos)) estado.datos.adjuntos = [];
  estado.datos.adjuntos.push(nuevo);
  marcarCambioPendiente();

  return nuevo;
}

/**
 * Reordenamiento (drag-and-drop en el menú de adjuntos): recibe la lista de
 * ids YA en el orden final que dejó el usuario y reescribe `orden` en cada
 * referencia afectada como 0,1,2... — más simple y menos propenso a
 * colisiones que tratar de "insertar entre dos" con decimales. Solo toca
 * los adjuntos pasados (se espera la lista completa de una misma
 * entidad/vista, ver obtenerAdjuntosActivosDe), nunca la colección global.
 */
function reordenarAdjuntos(idsEnNuevoOrden) {
  const mapa = new Map((estado.datos.adjuntos || []).map((a) => [a.id, a]));
  idsEnNuevoOrden.forEach((id, indice) => {
    const referencia = mapa.get(id);
    if (!referencia) return;
    referencia.orden = indice;
    sellarTimestamp(referencia);
  });
  marcarCambioPendiente();
}

/** Ocultar/mostrar un adjunto sin borrarlo (ver comentario de `activo` en
 *  schema.js/crearAdjunto) — distinto de eliminarAdjunto, que sí borra de
 *  verdad. No toca Drive ni la cola de subida para nada. */
function alternarActivoAdjunto(adjuntoId) {
  const referencia = (estado.datos.adjuntos || []).find((a) => a.id === adjuntoId);
  if (!referencia) return;
  referencia.activo = !referencia.activo;
  sellarTimestamp(referencia);
  marcarCambioPendiente();
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
        const folderId = await obtenerCarpetaAdjuntos(estado.token);
        const driveFileId = await conReintentoSi401(() => subirArchivoBinarioADrive(estado.token, archivo, folderId));
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

/**
 * Edita un adjunto YA EXISTENTE — nombre, emoji y (si aplica) el enlace
 * (pedido explícito, 2026-08-19: antes solo se podía crear, activar/
 * desactivar, reordenar o borrar — para corregir un nombre mal escrito o
 * el emoji había que borrar el adjunto entero y crearlo de nuevo, perdiendo
 * de paso el archivo real ya subido a Drive si era de tipo "archivo").
 * `url` se ignora si el adjunto no es de tipo "enlace" — un archivo no
 * tiene URL editable, su binario ya vive subido en Drive (cambiar el
 * archivo en sí requeriría borrar y volver a adjuntar, fuera de alcance
 * acá). Nunca toca Drive ni la cola de subida — solo la referencia liviana.
 */
function editarAdjunto(adjuntoId, { nombre, url, emoji }) {
  const referencia = (estado.datos.adjuntos || []).find((a) => a.id === adjuntoId);
  if (!referencia) throw new Error("Este adjunto ya no existe — puede que se haya eliminado desde otro dispositivo.");

  const nombreLimpio = (nombre || "").trim();
  if (!nombreLimpio) throw new Error("Ponele un nombre al adjunto.");
  referencia.nombre = nombreLimpio;

  if (referencia.tipo === "enlace") {
    const urlLimpia = (url || "").trim();
    if (!urlLimpia || !/^https?:\/\//i.test(urlLimpia)) {
      throw new Error("El enlace debe ser una URL válida (empezar con http:// o https://).");
    }
    referencia.url = urlLimpia;
  }

  referencia.emoji = (emoji || "").trim() || null;

  sellarTimestamp(referencia);
  marcarCambioPendiente();
  return referencia;
}

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

  // FIX (404 repetido en cada arranque): antes esta función solo anotaba
  // el id acá arriba, en un Set que vive EN MEMORIA — se resetea en cada
  // arranque, así que la tumba nunca quedaba resuelta de verdad más allá
  // de la sesión actual, y procesarTumbasDriveHuerfanas() la volvía a
  // intentar (y a pegarle un 404, ya inofensivo pero repetido) para
  // siempre. Ahora se persiste la resolución en la tumba misma: se pone
  // driveFileId a null (el guard "if (!tumba.driveFileId) continue" de
  // procesarTumbasDriveHuerfanas, más abajo, ya la salta con esto) y se
  // sube el cambio con marcarCambioPendiente(), para que otros
  // dispositivos que compartan esta misma tumba también dejen de
  // reintentarla. Se muta el campo en vez de sacar la tumba entera del
  // array a propósito: fusionarTumbas (storage-merge.js) resuelve por
  // "más reciente gana" sobre eliminadoEn, y ante empate se queda con la
  // entrada local — mutar sobrevive esa fusión, borrar el objeto entero
  // se puede resucitar si otro dispositivo todavía trae la versión vieja
  // con el driveFileId puesto.
  const tumba = (estado.datos._eliminados_adjuntos || []).find((t) => t.id === adjuntoId);
  if (tumba && tumba.driveFileId !== null) {
    tumba.driveFileId = null;
    marcarCambioPendiente();
  }
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
 *  de una entidad puntual (ej. una materia, un evento de agenda) — TODOS,
 *  incluidos los desactivados. Para pintar la UI normal usar
 *  obtenerAdjuntosActivosDe; este queda para el menú de gestión (que sí
 *  necesita ver también los desactivados, para poder reactivarlos). */
function obtenerAdjuntosDe(entidadTipo, entidadId) {
  return (estado.datos.adjuntos || []).filter(
    (a) => a.entidadTipo === entidadTipo && a.entidadId === entidadId
  );
}

/** Igual que obtenerAdjuntosDe, pero solo los activos y ya ordenados por
 *  `orden` — lo que efectivamente debe pintarse como pills/chips en la
 *  tarjeta o el cronograma. */
function obtenerAdjuntosActivosDe(entidadTipo, entidadId) {
  return obtenerAdjuntosDe(entidadTipo, entidadId)
    .filter((a) => a.activo !== false)
    .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
}

/** Ajustes → "Liberar espacio": true en cuanto haya AL MENOS un adjunto
 *  guardado (activo o no) — controla si esa sección se muestra en
 *  Ajustes generales o no (pedido explícito: no mostrar una opción vacía
 *  sin sentido). */
function hayAdjuntosGuardados() {
  return (estado.datos.adjuntos || []).length > 0;
}

/* --------------------- Limpieza masiva ("Liberar espacio") --------------------- */

/**
 * Borra en lote una lista de adjuntos ya filtrada por quien llama —
 * reusa eliminarAdjunto() uno por uno (misma tumba + intento de borrado en
 * Drive que ya tiene cada borrado individual) en vez de duplicar esa
 * lógica acá. Secuencial a propósito (no Promise.all): eliminarAdjunto ya
 * hace su propia llamada de red a Drive por cada uno, y en lote pueden ser
 * bastantes — ir de a uno evita saturar la API de Drive con ráfagas
 * paralelas grandes. Devuelve cuántos se borraron, para que la UI pueda
 * confirmarle al usuario "se liberaron N archivos".
 */
async function eliminarVariosAdjuntos(adjuntoIds) {
  let borrados = 0;
  for (const id of adjuntoIds) {
    await eliminarAdjunto(id);
    borrados++;
  }
  return borrados;
}

/** Ids de materia_matriculada + ids de evento de Agenda que pertenecen a
 *  un semestre puntual — la relación real vive en agenda.js/semestres.js,
 *  pero acá solo hace falta leer estado.datos directo (misma colección
 *  plana de siempre), sin importar esos módulos, para no crear un ciclo
 *  (agenda.js ya podría llegar a importar de storage-adjuntos.js). */
function idsDeMateriaYEventosDelSemestre(semestreId) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === semestreId);
  const mmIds = new Set((semestre?.materias_matriculadas || []).map((mm) => mm.id));
  const eventoIds = (estado.datos.agenda || [])
    .filter((ev) => ev.materia_matriculada_id && mmIds.has(ev.materia_matriculada_id))
    .map((ev) => ev.id);
  return { mmIds, eventoIds };
}

/** Opción 1 de Ajustes: TODO lo relacionado a un semestre — adjuntos de sus
 *  materias (cronograma/reglas/libros) + adjuntos de los eventos/tareas
 *  vinculados a esas materias. Eventos sueltos (sin materia) nunca entran
 *  acá — ver eliminarAdjuntosDeEventosSueltos para esos. */
async function eliminarAdjuntosDeSemestre(semestreId) {
  const { mmIds, eventoIds } = idsDeMateriaYEventosDelSemestre(semestreId);
  const ids = (estado.datos.adjuntos || [])
    .filter(
      (a) =>
        (a.entidadTipo === "materia" && mmIds.has(a.entidadId)) ||
        (a.entidadTipo === "evento" && eventoIds.includes(a.entidadId))
    )
    .map((a) => a.id);
  return eliminarVariosAdjuntos(ids);
}

/** Opción 2: solo los archivos de tareas/eventos (entidadTipo "evento") de
 *  ese semestre — deja intactos cronograma/reglas/libros de las materias. */
async function eliminarAdjuntosDeTareasDeSemestre(semestreId) {
  const { eventoIds } = idsDeMateriaYEventosDelSemestre(semestreId);
  const ids = (estado.datos.adjuntos || [])
    .filter((a) => a.entidadTipo === "evento" && eventoIds.includes(a.entidadId))
    .map((a) => a.id);
  return eliminarVariosAdjuntos(ids);
}

/** Opción 3: solo los adjuntos de materia (cronograma/reglas/libros —
 *  entidadTipo "materia") de ese semestre — deja intactos los de tareas. */
async function eliminarAdjuntosDeCronogramaDeSemestre(semestreId) {
  const { mmIds } = idsDeMateriaYEventosDelSemestre(semestreId);
  const ids = (estado.datos.adjuntos || [])
    .filter((a) => a.entidadTipo === "materia" && mmIds.has(a.entidadId))
    .map((a) => a.id);
  return eliminarVariosAdjuntos(ids);
}

/** Opción 4: archivos de tareas/eventos SIN materia vinculada (no
 *  pertenecen a ningún semestre por esa vía) — global, no depende del
 *  selector de semestre de Ajustes. Solo borra los ADJUNTOS, nunca la
 *  tarea/evento en sí. */
async function eliminarAdjuntosDeEventosSueltos() {
  const idsEventosConMateria = new Set(
    (estado.datos.agenda || []).filter((ev) => ev.materia_matriculada_id).map((ev) => ev.id)
  );
  const idsEventoTodos = new Set((estado.datos.agenda || []).map((ev) => ev.id));
  const ids = (estado.datos.adjuntos || [])
    .filter(
      (a) =>
        a.entidadTipo === "evento" && idsEventoTodos.has(a.entidadId) && !idsEventosConMateria.has(a.entidadId)
    )
    .map((a) => a.id);
  return eliminarVariosAdjuntos(ids);
}

export {
  adjuntarArchivo,
  agregarEnlaceAdjunto,
  alternarActivoAdjunto,
  descargarAdjunto,
  editarAdjunto,
  eliminarAdjunto,
  eliminarAdjuntosDeCronogramaDeSemestre,
  eliminarAdjuntosDeEventosSueltos,
  eliminarAdjuntosDeSemestre,
  eliminarAdjuntosDeTareasDeSemestre,
  hayAdjuntosGuardados,
  obtenerAdjuntosActivosDe,
  obtenerAdjuntosDe,
  procesarColaSubidas,
  procesarTumbasDriveHuerfanas,
  reordenarAdjuntos,
};
