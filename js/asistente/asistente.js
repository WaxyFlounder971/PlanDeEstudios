/* =========================================================================
   ASISTENTE IA (Gemini) — Interfaz de chat
   Convierte lenguaje natural en tareas/exámenes/eventos de Agenda. Llama a
   la API de Gemini con la clave propia del usuario
   (estado.datos.configuracion.gemini_api_key, ver config/config-ajustes.js),
   parsea un JSON estructurado (items[] + aclaracion) y por cada ítem abre
   abrirModalEventoAgenda con datosIniciales para que el usuario revise/edite
   antes de guardar de verdad — este módulo NUNCA escribe directo en
   estado.datos.agenda, esa responsabilidad sigue siendo 100% del modal real
   (ver comentario de datosIniciales en agenda/agenda-modal.js).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { crearEventoAgenda } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { programarRecordatorioPush } from "../core/notificaciones-push.js";
import { mostrarToast } from "../ui/componentes.js";
import { abrirModalEventoAgenda, confirmarBorrarEventoAgenda, obtenerNombreMateriaEvento } from "../agenda/agenda-modal.js";
import {
  formatearHoraAmPm,
  obtenerMateriasVinculablesAgenda,
  obtenerSemestresSeleccionadosAgenda,
  obtenerSemestreActivoAgenda,
  obtenerFechaInicioSemanaAgenda,
} from "../agenda/agenda-utils.js";
import { fechaLocalDesdeISO, obtenerEtiquetaModalidad } from "../horario/horario.js";
// obtenerClasesEfectivasSemana (2026-08-29, consulta de modalidad de solo
// lectura): mismo import directo que ya hace horario.js — fusiona la
// modalidad de PLANTILLA con la excepción puntual de Cronograma para una
// semana real, en vez de leer solo la plantilla (ver resolverConsultaModalidad).
import { obtenerClasesEfectivasSemana } from "../core/schema.js";
// Editar modalidad por voz/texto (2026-08-29): mismas dos funciones que ya
// usa Cronograma a mano (ver construirZonaCronograma) — nunca se reescribe
// esta lógica acá, solo se resuelve el bloque/semana/fecha correctos y se
// llama a lo mismo que ya existe.
import { aplicarModalidadDia, calcularNumeroSemanaSinAcotarParaFecha } from "../horario/horario-modal.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";

/**
 * Modelo de Gemini (revisado 2026-08-22, bug real en producción):
 * gemini-3.1-flash-lite.
 *
 * gemini-2.5-flash (elección original) empezó a devolver 404 en claves de
 * API nuevas — Google lo está bloqueando de a poco de cara a su apagado
 * oficial del 16-oct-2026, y las claves creadas después de ese bloqueo ya
 * ni siquiera llegan a usarlo una vez. No es viable dejarlo ni como
 * fallback.
 *
 * Se descartó gemini-2.5-flash-lite por el mismo motivo (toda la familia
 * 2.5 comparte fecha de apagado) y porque el resto de este comentario
 * (débil siguiendo instrucciones al pie de la letra) seguía aplicando en
 * su momento. gemini-3.1-flash-lite es generación actual (no tiene fecha
 * de apagado anunciada), y a $0.25/$1.50 por millón de tokens sigue
 * siendo barato para lo que hace este módulo (extraer texto corto a
 * JSON) — el usuario prácticamente no lo nota en su cuota. Se descartó
 * gemini-3.1-pro/gemini-3.x-flash "grande" por costo/latencia
 * innecesarios para esta tarea puntual.
 *
 * Si en el futuro la extracción falla seguido en casos ambiguos (fechas
 * mal resueltas, desambiguación de materias que no dispara), el primer
 * paso es subir a gemini-3.5-flash antes de tocar el prompt.
 */
const MODELO_GEMINI = "gemini-3.1-flash-lite";

/**
 * Historial de conversación (2026-08-22): vive SOLO en localStorage de
 * este dispositivo, nunca en estado.datos/Drive — mismo criterio que el
 * token de Google o cualquier otro dato que sea "contexto de este
 * aparato" y no tenga sentido sincronizar entre dispositivos. Se guarda
 * solo si hubo al menos un intercambio real (usuario habló Y Gemini
 * respondió, ver guardarHistorialLocal) y expira sola pasada 1 hora desde
 * el último mensaje (ver VIGENCIA_HISTORIAL_MS).
 */
const CLAVE_HISTORIAL_ASISTENTE = "asistente_historial_dispositivo";
const VIGENCIA_HISTORIAL_MS = 60 * 60 * 1000; // 1 hora

const NOMBRES_DIA_SEMANA = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

// Valores reales de modalidad que acepta aplicarModalidadDia (horario-modal.js,
// ETIQUETAS_MODALIDAD_CRONOGRAMA) — la misma lista se usa para validar lo que
// devuelve Gemini en cambioModalidad.modalidadNueva, nunca se confía en el
// string suelto sin chequearlo contra esto.
const MODALIDADES_VALIDAS_ASISTENTE = ["presencial", "virtual", "asincronica", "sin_clase"];

/**
 * Personalidad de Wapper (2026-08-29). Separada A PROPÓSITO del prompt de
 * extracción (construirSystemInstruction/ESQUEMA_RESPUESTA_GEMINI, que
 * sigue frío y preciso, sin tocar) — ver comentario de
 * generarRespuestaConversacionalWapper más abajo para dónde se usa
 * realmente este system prompt.
 */
const PROMPT_PERSONALIDAD_WAPPER = `Eres Wapper, un asistente académico simple, cálido y amable. Ayudas a organizar tareas, exámenes y eventos. Habla de forma clara y cercana, sin jerga ni modismos regionales de ningún país, sin exagerar el entusiasmo. Diríjete al usuario siempre de tú, nunca de vos ni de usted. Mantente siempre dentro de tu propósito académico, no te desvíes a otros temas, y no inventes información que no tienes.`;

/**
 * Nombre por el que Wapper se dirige al usuario (2026-08-29, trato
 * cercano): por defecto el primer nombre de su cuenta de Google (el mismo
 * que ya se muestra en el sidebar — confirmado con main.js:
 * estado.datos.perfil.nombre, lo pone obtenerPerfilGoogle/auth.js justo
 * después del login). Si el usuario le pide a Wapper que lo llame de otra
 * forma (accion "actualizar_nombre" más abajo), ese apodo queda GUARDADO
 * PERMANENTE en estado.datos.configuracion.asistente_nombre_preferido —
 * a propósito en una clave DISTINTA a estado.datos.perfil.nombre: pedido
 * explícito de que "cambiar nombre desde Asistente" nunca toque el nombre
 * que se ve en el sidebar (ese sigue siendo 100% el de la cuenta de
 * Google), solo cómo se dirige Wapper al usuario.
 */
function obtenerNombrePerfilGoogleCrudo() {
  return (estado.datos && estado.datos.perfil && estado.datos.perfil.nombre) || null;
}

/** "Fernanda Rodríguez Solano" → "Fernanda" — para un trato cercano no hace
 * falta el nombre completo. */
function obtenerPrimerNombre(nombreCompleto) {
  const limpio = String(nombreCompleto || "").trim();
  if (!limpio) return null;
  return limpio.split(/\s+/)[0];
}

/** El nombre/apodo con el que Wapper se dirige al usuario ahora mismo: el
 * que el usuario pidió explícitamente (permanente, ver arriba) si hay uno,
 * si no el primer nombre de su cuenta de Google, si no null (Wapper sigue
 * funcionando igual sin nombre, solo no lo usa). */
function obtenerNombreParaDirigirse() {
  const preferido = estado.datos && estado.datos.configuracion && estado.datos.configuracion.asistente_nombre_preferido;
  if (preferido && String(preferido).trim()) return String(preferido).trim();
  return obtenerPrimerNombre(obtenerNombrePerfilGoogleCrudo());
}

/**
 * Resuelve accion "actualizar_nombre": guarda el apodo pedido en
 * estado.datos.configuracion.asistente_nombre_preferido (PERMANENTE, se
 * sincroniza igual que cualquier otro cambio de configuración — pedido
 * explícito: queda así hasta que el usuario pida cambiarlo de nuevo, nunca
 * se resetea solo) y dispara marcarCambioPendiente(), mismo mecanismo que
 * ya usa guardarItemExtraidoComoEvento para persistir cambios reales. A
 * propósito NUNCA toca estado.perfil (el nombre de cuenta de Google que se
 * ve en el sidebar) — esto es solo cómo se dirige Wapper al usuario.
 */
function resolverActualizacionNombre(nombreNuevo) {
  const limpio = String(nombreNuevo || "").trim();
  if (!limpio) return { ok: false, motivo: "No entendí bien qué nombre quieres que use." };
  if (limpio.length > 40) return { ok: false, motivo: "Ese nombre es un poco largo — dame algo más cortito." };
  estado.datos.configuracion = estado.datos.configuracion || {};
  estado.datos.configuracion.asistente_nombre_preferido = limpio;
  marcarCambioPendiente();
  return { ok: true, nombreNuevo: limpio };
}

/**
 * System prompt de personalidad + el nombre del usuario, armado en cada
 * llamada (nunca se cachea: si el usuario acaba de pedir un apodo nuevo,
 * la siguiente respuesta conversacional ya debe usarlo). El texto base
 * (PROMPT_PERSONALIDAD_WAPPER) queda intacto — esto solo le agrega una
 * frase aparte con el nombre y dos instrucciones puntuales (humor liviano
 * si el nombre es gracioso/tipo apodo, y qué contestar si preguntan de
 * dónde salió el nombre), nunca se reescribe el prompt base.
 */
function construirPromptPersonalidadWapper() {
  const nombre = obtenerNombreParaDirigirse();
  if (!nombre) return PROMPT_PERSONALIDAD_WAPPER;
  return `${PROMPT_PERSONALIDAD_WAPPER} El usuario se llama ${nombre} — puedes usar ese nombre de vez en cuando para un trato más cercano, sin forzarlo en cada respuesta; si te parece un nombre gracioso o con onda de apodo, puedes seguirle la broma con humor liviano y cariñoso, nunca burlón. Si te pregunta de dónde sacaste su nombre, dile que lo tomaste de su cuenta de Google.`;
}

/** Punto 4 del brief de personalidad: saludo simple → respuesta fija, sin llamar a Gemini. */
function construirMensajeSaludoWapper() {
  const nombre = obtenerNombreParaDirigirse();
  return nombre ? `¡Hola ${nombre}! ¿En qué te ayudo hoy?` : "¡Hola! ¿En qué te ayudo hoy?";
}

/** Reemplaza al antiguo MENSAJE_FALLBACK (voseo) — ahora en tuteo, y solo se usa como
 *  red de seguridad si generarRespuestaConversacionalWapper no devuelve nada. */
const MENSAJE_FALLBACK_WAPPER =
  'No logré identificar una tarea, examen o evento en tu mensaje. ¿Puedes darme más detalles? Por ejemplo: "tengo examen de anatomía el jueves a las 2pm".';

/**
 * Mensaje de bienvenida (punto 2 del brief) — el texto base NO lleva
 * personalidad extra más allá de lo pedido textual, para no reinterpretarlo;
 * 2026-08-29 lo único que se agrega es el nombre al inicio si se conoce.
 */
function construirMensajeBienvenidaWapper() {
  const nombre = obtenerNombreParaDirigirse();
  return nombre
    ? `¡Hola ${nombre}! Soy Wapper 👋, tu asistente académico personal. \n¿Tienes alguna tarea, examen o evento que quieras agregar?`
    : "¡Hola! Soy Wapper 👋, tu asistente académico personal. \nDime, ¿tienes alguna tarea, examen o evento que quieras agregar?";
}

/**
 * Las 12 plantillas de ejemplo del brief, tal cual, salvo "Agregale" →
 * "Agrégale" (punto 5: tuteo en todo texto de interfaz — la plantilla tal
 * como se pidió traía esa única forma en voseo). Cada `{materia}` se
 * reemplaza en construirEjemplosBienvenida rotando entre las materias
 * reales matriculadas (o los genéricos de respaldo si no hay ninguna) —
 * cada OCURRENCIA cuenta como un turno de la rotación, no cada plantilla
 * (la #11 tiene dos ocurrencias propias).
 */
const PLANTILLAS_EJEMPLOS_BIENVENIDA_WAPPER = [
  "Tengo examen de {materia} el jueves a las 2pm",
  "Recuérdame entregar el ensayo de {materia} el lunes",
  "Mañana tengo proyecto de {materia}, no quiero que se me olvide",
  "Quiz de {materia} en dos semanas",
  "Reunión de grupo de {materia} el sábado a las 10am",
  "Se me olvida siempre, ponme una tarea de {materia} para el viernes",
  "El próximo martes hay entrega de proyecto final de {materia}",
  "Cumpleaños de mi compañera de cuarto el 15",
  "Examen final de {materia} la otra semana, todavía no sé el día exacto",
  "Tengo que estudiar para el parcial de {materia} el 3 de setiembre",
  "Agrégale que tengo tarea de {materia} para la próxima clase y examen de {materia} en semana 7",
  "Ponle que para mañana hay quiz de {materia} a las 9am y 3 horas después tengo que ir a una reunión.",
];

/** Genéricos de respaldo (punto 2, "caso sin materias matriculadas"). */
const MATERIAS_GENERICAS_RESPALDO = ["Anatomía", "Historia", "Química", "Cálculo", "Estadística", "Física"];

/**
 * Nombres a usar en los ejemplos de bienvenida: materias REALES
 * matriculadas del usuario si tiene (mismo criterio/fuente que ya usa
 * construirSystemInstruction para saber qué materias existen —
 * obtenerMateriasVinculablesAgenda, agenda-utils.js — no se inventa una
 * lectura nueva de semestres.js aparte), o si no tiene ninguna, los 6
 * genéricos de respaldo. Nunca se mezclan a medias entre sí.
 */
function obtenerNombresMateriasParaEjemplosBienvenida() {
  const nombresReales = obtenerMateriasVinculablesAgenda()
    .map((m) => m.nombre)
    .filter(Boolean);
  return nombresReales.length > 0 ? nombresReales : MATERIAS_GENERICAS_RESPALDO;
}

/**
 * Sustituye cada `{materia}` de las plantillas rotando entre los nombres
 * disponibles (si hay menos nombres que huecos, se repiten en el mismo
 * orden — nunca se deja un hueco sin nombre ni se completa con genéricos a
 * medias, ver comentario de arriba).
 */
function construirEjemplosBienvenida() {
  const nombres = obtenerNombresMateriasParaEjemplosBienvenida();
  let indice = 0;
  return PLANTILLAS_EJEMPLOS_BIENVENIDA_WAPPER.map((plantilla) =>
    plantilla.replace(/\{materia\}/g, () => nombres[indice++ % nombres.length])
  );
}

/**
 * Punto 4 del brief: si el usuario SOLO saluda, no se intenta extraer nada
 * (ni siquiera se llama a Gemini) — se normaliza el texto (sin acentos,
 * sin puntuación, colapsando repeticiones de letra como "holaaa") y se
 * compara contra un set cerrado de saludos completos. Un mensaje que
 * ADEMÁS de saludar trae contenido real ("hola, tengo examen el jueves")
 * NO matchea ninguno de estos patrones completos, así que sigue el camino
 * normal de extracción.
 */
const PATRONES_SALUDO_SIMPLE = [
  /^h+o+l+a+( wapper)?$/,
  /^hey+$/,
  /^hi$/,
  /^hello$/,
  /^buenas$/,
  /^buenos dias$/,
  /^buenas tardes$/,
  /^buenas noches$/,
  /^que tal$/,
  /^como estas$/,
  /^como andas$/,
];

function esSaludoSimple(textoOriginal) {
  const normalizado = String(textoOriginal || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¡!¿?.,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizado) return false;
  return PATRONES_SALUDO_SIMPLE.some((patron) => patron.test(normalizado));
}

/**
 * Punto 7 del brief (2026-08-31): capacidades reales de Wapper, como
 * estructura mantenible (no texto fijo enterrado en el prompt) — para sumar
 * una capacidad nueva en el futuro (ej. Tiempo de Estudio) alcanza con
 * agregar una entrada acá, sin reescribir construirMensajeCapacidadesWapper
 * ni el mensaje entero. Cada entrada es una capacidad YA implementada (no
 * aspiracional), con un ejemplo concreto y real de uso.
 */
/**
 * Apodos de ejemplo para la capacidad "actualizar_nombre" — al menos 20,
 * pedido explícito, para que el ejemplo salga distinto cada vez que se
 * muestra la lista de capacidades en vez de repetir siempre "Fer".
 */
const APODOS_EJEMPLO_CAPACIDADES = [
  "Fer", "Pipo", "Juanjo", "Male", "Santi", "Naty", "Pao", "Andy",
  "Nacho", "Kike", "Meli", "Fabi", "Caro", "Tavo", "Rodri", "Gaby", "Chepe",
  "Mafe", "Toño", "Vicky", "Lalo", "Beto",
];

const CAPACIDADES_WAPPER = [
  {
    descripcion: "Crear tareas, exámenes y eventos",
    ejemplo: "tengo examen de anatomía el jueves",
  },
  {
    descripcion: "Consultar qué tareas o exámenes tienes en una semana puntual",
    ejemplo: "qué exámenes tengo esta semana",
  },
  {
    descripcion: "Buscar un examen o tarea puntual y cuánto falta para esa fecha",
    ejemplo: "cuándo es el segundo parcial de cálculo",
  },
  {
    descripcion: "Consultar si una clase próxima es virtual o presencial",
    ejemplo: "mi próxima clase de bases de datos es virtual o presencial",
  },
  {
    descripcion: "Cambiar la modalidad de una clase en tu Cronograma",
    ejemplo: "la clase de física del martes va virtual",
  },
  {
    descripcion: "Cambiar cómo me dirijo a ti",
    // "ejemplo" es una FUNCIÓN acá en vez de un string fijo — se resuelve al
    // vuelo (ver construirMensajeCapacidadesWapper) para que cada vez que
    // se muestre la lista salga un apodo al azar de APODOS_EJEMPLO_CAPACIDADES,
    // en vez de repetir siempre el mismo.
    ejemplo: () => `llámame ${APODOS_EJEMPLO_CAPACIDADES[Math.floor(Math.random() * APODOS_EJEMPLO_CAPACIDADES.length)]}`,
  },
];

/**
 * Arma el texto de "Puedo ayudarte con: ..." a partir de CAPACIDADES_WAPPER
 * — viñeta "•", con el ejemplo en su propia línea debajo de la descripción
 * (ajuste 2026-08-31, pedido explícito de formato). `c.ejemplo` puede ser
 * un string fijo o una función (ver "Cambiar cómo me dirijo a ti" arriba)
 * que se resuelve en cada llamada, nunca cacheada.
 */
function construirMensajeCapacidadesWapper() {
  const items = CAPACIDADES_WAPPER.map((c) => {
    const ejemplo = typeof c.ejemplo === "function" ? c.ejemplo() : c.ejemplo;
    return `• ${c.descripcion}.\nEjemplo: "${ejemplo}"`;
  }).join("\n\n");
  return `Puedo ayudarte con:\n\n${items}`;
}

/**
 * Detecta una pregunta por las capacidades del asistente ("¿qué podés
 * hacer?", "¿para qué servís?", "ayuda", etc.) — mismo criterio que
 * esSaludoSimple: SOLO matchea si el mensaje es (casi) exclusivamente eso,
 * para no interceptar un mensaje real que de paso mencione "ayuda" (ej.
 * "ayúdame a poner un examen el jueves" sigue el camino normal de
 * extracción). Se acepta tanto voseo como tuteo en la ENTRADA del usuario
 * (el texto de salida de Wapper sigue siendo siempre tuteo, sin cambios).
 */
const PATRONES_PREGUNTA_CAPACIDADES = [
  /^que (podes|puedes) hacer( wapper)?$/,
  /^que sabes hacer$/,
  /^para que (servis|sirves)$/,
  /^en que (me )?(podes|puedes) ayudar$/,
  /^ayuda$/,
  /^help$/,
  /^que haces$/,
  /^cuales son tus (funciones|capacidades)$/,
  /^que funciones tenes$/,
];

function esPreguntaCapacidades(textoOriginal) {
  const normalizado = String(textoOriginal || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[¡!¿?.,;:]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalizado) return false;
  return PATRONES_PREGUNTA_CAPACIDADES.some((patron) => patron.test(normalizado));
}

// En memoria, la conversación visible AHORA MISMO en el chat — se llena al
// arrancar (blanco o restaurada desde el historial local) y se persiste a
// localStorage después de cada intercambio real completo.
let conversacionActual = [];
let enviandoMensaje = false;

/* ===================== Voz (Web Speech API, nativo del navegador) =====================
 * Sin costo: no pasa por Gemini ni por ninguna API paga — el navegador
 * transcribe localmente/vía su propio motor (Chrome usa el de Google,
 * Samsung Internet el suyo, gratis y sin la clave del usuario de por
 * medio). Sigue siendo el camino PRIMARIO en todo navegador que lo
 * soporte — nada de esto cambió.
 *
 * Fallback con Gemini (2026-08-22, pedido explícito): en navegadores donde
 * el motor nativo no tiene un backend de voz confiable en la red/equipo del
 * usuario (caso real: Edge, que depende del servicio de voz de Microsoft en
 * vez del de Google, y ahí falla con error "network" aunque el permiso de
 * micrófono esté bien dado), en vez de resignarse al toast de error se
 * graba el audio con MediaRecorder (API distinta, no depende de ningún
 * backend de voz de Google/Microsoft) y se manda a transcribir a Gemini con
 * la clave que el usuario ya tiene guardada — mismo proveedor que ya usa el
 * resto del asistente, un solo lugar de configuración.
 *
 * Trade-offs reales de este fallback (ya aceptados): consume algo de la
 * cuota de Gemini del usuario (transcribir audio pesa más que el texto que
 * ya manda la extracción normal), y no hay texto en vivo mientras se habla
 * — recién se llena el input cuando se suelta el botón y Gemini responde.
 * Si ni siquiera MediaRecorder está disponible (navegador viejo/raro), cae
 * al mismo criterio de siempre: degradación silenciosa a "solo texto".
 */
const ReconocimientoVozAPI = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let reconocimientoVoz = null;
let grabandoVoz = false;

// Una vez que el motor nativo demuestra en esta sesión del navegador que no
// sirve (error real, no un simple "no hablaste nada"), no tiene sentido
// hacerlo fallar de nuevo cada vez que el usuario toca el micrófono — de
// acá en adelante se va directo al fallback de Gemini.
let usarFallbackTranscripcionGemini = false;
let mediaRecorderVoz = null;
let chunksAudioVoz = [];

function crearReconocimientoVoz() {
  const r = new ReconocimientoVozAPI();
  r.lang = "es-419";
  // continuous:true (antes false) — pedido explícito: no cortar solo
  // porque el usuario hizo una pausa/muletilla al hablar. Con esto la
  // única forma de terminar la grabación es tocar el botón de nuevo
  // (ver btn.onclick, que ya llama a reconocimientoVoz.stop() ahí).
  r.continuous = true;
  r.interimResults = true;
  return r;
}

function soportaFallbackGrabacion() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

/**
 * Núcleo de la transcripción con Gemini, ya con el audio en base64 (mismo
 * modelo/clave que usa llamarGemini para la extracción) — llamada de una
 * sola vez, sin historial ni schema JSON, solo se le pide el texto plano
 * de lo que se dijo. Tira Error si no hay clave, si la red falla, o si
 * Gemini devuelve error.
 *
 * Separado de transcribirAudioConGemini (2026-08-23, Bandeja pendiente):
 * asistente-bandeja.js ya recibe el audio en base64 directo desde el
 * Worker (bandeja_pendiente.audio_base64) — no tiene un Blob real del que
 * partir, así que repetir el viaje por FileReader no tendría sentido.
 * transcribirAudioConGemini (abajo) sigue siendo el punto de entrada para
 * el botón de micrófono del propio chat, que sí arranca de un Blob real
 * de MediaRecorder.
 */
async function transcribirBase64ConGemini(base64, mimeType) {
  const claveApi = estado.datos.configuracion.gemini_api_key;
  if (!claveApi) throw new Error("No hay clave de Gemini guardada.");
  // Mismo chequeo explícito que llamarGemini — ver comentario ahí.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Sin conexión a internet.");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${encodeURIComponent(claveApi)}`;
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: mimeType || "audio/webm", data: base64 } },
            {
              text: "Transcribí EXACTAMENTE lo que se dice en este audio, en español. Devolvé únicamente el texto transcrito, sin comillas ni comentarios adicionales.",
            },
          ],
        },
      ],
    }),
  });

  const datos = await respuesta.json().catch(() => null);
  if (!respuesta.ok) {
    throw new Error((datos && datos.error && datos.error.message) || "Error de Gemini transcribiendo el audio.");
  }
  const candidato = datos && datos.candidates && datos.candidates[0];
  const parte = candidato && candidato.content && candidato.content.parts && candidato.content.parts[0];
  return ((parte && parte.text) || "").trim();
}

/**
 * Transcribe un Blob de audio con Gemini — wrapper de transcribirBase64ConGemini
 * que arranca de un Blob real (MediaRecorder del botón de micrófono, ver
 * crearBotonVoz más abajo) en vez de base64 ya listo.
 */
async function transcribirAudioConGemini(blob) {
  const base64 = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onloadend = () => resolve(String(lector.result).split(",")[1] || "");
    lector.onerror = () => reject(lector.error || new Error("No se pudo leer el audio grabado."));
    lector.readAsDataURL(blob);
  });
  return transcribirBase64ConGemini(base64, blob.type || "audio/webm");
}

/**
 * Botón de micrófono — vive al lado del input, mismo tratamiento visual
 * "solo símbolo, sin fondo de botón" que se le dio a 🔄 Nueva. Toca
 * directo input.value con el texto reconocido (final o parcial mientras
 * graba) para que el usuario vea/edite antes de tocar Enviar — mismo
 * principio de "nunca actuar solo" que el resto del módulo. Sigue vivo si
 * hay motor nativo O fallback de grabación disponible; si no hay NINGUNO
 * de los dos, no se dibuja (degradación silenciosa a solo texto).
 */
function crearBotonVoz(input) {
  if (!ReconocimientoVozAPI && !soportaFallbackGrabacion()) return null;

  const btn = document.createElement("button");
  btn.id = "btn-asistente-voz";
  btn.title = "Dictar por voz";
  btn.setAttribute("aria-label", "Dictar por voz");
  btn.textContent = "🎙️";
  btn.style.cssText =
    "background:none; border:none; font-size:1.4rem; line-height:1; cursor:pointer; padding:2px 8px; flex-shrink:0;";

  // true mientras hay una grabación de MediaRecorder en curso (fallback) —
  // separado de grabandoVoz (que cubre ambos caminos) porque btn.onclick
  // necesita saber A CUÁL de los dos motores mandarle el "parar".
  let grabandoConFallback = false;
  // true solo durante la ventana entre "el nativo tiró error real" y "el
  // fallback ya tomó control de la UI" — evita que el onend del nativo
  // (que dispara igual después de un error) pise el ícono de "grabando"
  // que el fallback recién está por poner.
  let transicionandoAFallback = false;
  // Pedido explícito (2026-08-23): este botón es un ALTERNAR (toggle) —
  // arranca al tocarlo, para SOLO al volver a tocarlo, nunca por cuenta
  // propia. `paradaManual` es la única señal que le dice a onend "esto lo
  // frenó el usuario, quedate quieto"; si onend dispara con esto en false,
  // significa que el motor cortó solo (silencio largo, timeout interno de
  // Android, lo que sea) y hay que reiniciar la escucha de forma
  // transparente, sin que se note ni se pierda una palabra de lo ya
  // dictado. Se resetea a false cada vez que arranca una escucha nueva
  // (manual o auto-reinicio) y solo pasa a true en el branch de "parar" de
  // btn.onclick o si el error es terminal (permiso denegado).
  let paradaManual = false;
  // Freno de seguridad contra loop de reinicios: si el motor termina
  // una y otra vez CASI apenas arranca (sin llegar a onresult ni una
  // vez), reiniciarlo indefinidamente solo quemaría batería sin lograr
  // nada — a partir del 3er reinicio consecutivo sin resultado real, se
  // corta y se avisa en vez de seguir en loop silencioso.
  let reiniciosSeguidosSinResultado = 0;

  /**
   * BUG REAL #3 (2026-08-23, reportado en celular, seguía pasando incluso
   * con el fix anterior — texto creciendo sobre sí mismo tipo "póngale
   * póngale que póngale que para..."): el fix anterior (reconstruir todo
   * desde e.results[0] en cada evento, sumando cada resultado marcado
   * isFinal) asumía que cada entrada final es un pedazo NUEVO e
   * incremental (así se comporta en desktop: results[0]="póngale",
   * results[1]="que", results[2]="para"...). En este celular puntual el
   * motor no se comporta así: cada vez que reemite un resultado final,
   * esa entrada es la frase ENTERA dicha hasta ese momento, no solo lo
   * nuevo (results[0]="póngale", results[1]="póngale que",
   * results[2]="póngale que para"...) — sumar todas esas entradas
   * duplica sobre sí mismo exactamente con el patrón reportado.
   *
   * Como no hay forma de saber de antemano cuál de los dos
   * comportamientos va a dar un motor/dispositivo dado, esta función es
   * robusta a AMBOS: descarta cualquier transcripción final que sea
   * prefijo (o igual) de una posterior — en el caso "cada entrada es la
   * frase entera", eso colapsa todo a la última entrada (la más
   * completa); en el caso incremental normal, ninguna es prefijo de la
   * siguiente, así que no se descarta nada y se concatenan todas como
   * siempre.
   */
  function colapsarFinalesSuperpuestos(finales) {
    const limpios = finales.map((f) => f.trim()).filter(Boolean);
    return limpios.filter((actual, i) => !limpios.slice(i + 1).some((posterior) => posterior.startsWith(actual)));
  }

  function iniciarFallbackGrabacion(textoPrevioAlInput) {
    if (!soportaFallbackGrabacion()) {
      mostrarToast("El micrófono no está disponible en este navegador.");
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        transicionandoAFallback = false;
        chunksAudioVoz = [];
        mediaRecorderVoz = new MediaRecorder(stream);
        grabandoConFallback = true;
        grabandoVoz = true;
        btn.textContent = "🔴";
        btn.title = "Grabando… toca para detener";

        mediaRecorderVoz.ondataavailable = (e) => {
          if (e.data.size > 0) chunksAudioVoz.push(e.data);
        };
        mediaRecorderVoz.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          grabandoConFallback = false;
          grabandoVoz = false;
          btn.disabled = true;
          btn.textContent = "⏳";
          btn.title = "Transcribiendo…";
          try {
            const blob = new Blob(chunksAudioVoz, { type: mediaRecorderVoz.mimeType || "audio/webm" });
            const texto = await transcribirAudioConGemini(blob);
            input.value = textoPrevioAlInput + texto;
          } catch (e) {
            console.warn("[asistente] Error transcribiendo audio con Gemini:", e);
            mostrarToast(
              typeof navigator !== "undefined" && navigator.onLine === false
                ? "No tienes conexión a internet."
                : "No se pudo transcribir el audio grabado."
            );
          } finally {
            btn.disabled = false;
            btn.textContent = "🎙️";
            btn.title = "Dictar por voz";
            input.focus();
          }
        };
        mediaRecorderVoz.start();
      })
      .catch((e) => {
        transicionandoAFallback = false;
        grabandoConFallback = false;
        grabandoVoz = false;
        btn.textContent = "🎙️";
        btn.title = "Dictar por voz";
        console.warn("[asistente] No se pudo acceder al micrófono (fallback):", e);
        mostrarToast(e && e.name === "NotAllowedError" ? "Permiso de micrófono denegado" : "No se pudo usar el micrófono");
      });
  }

  function iniciarReconocimientoNativo(textoPrevioAlInput) {
    paradaManual = false;
    reconocimientoVoz = crearReconocimientoVoz();
    let huboResultadoEstaVez = false;

    reconocimientoVoz.onstart = () => {
      grabandoVoz = true;
      btn.textContent = "🔴";
      btn.title = "Grabando… toca para detener";
    };
    reconocimientoVoz.onresult = (e) => {
      huboResultadoEstaVez = true;
      reiniciosSeguidosSinResultado = 0;
      const finales = [];
      let interina = "";
      for (let i = 0; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) finales.push(transcript);
        else interina += transcript;
      }
      const transcripcionFinal = colapsarFinalesSuperpuestos(finales).join(" ");
      input.value = textoPrevioAlInput + (transcripcionFinal ? transcripcionFinal + " " : "") + interina;
    };
    reconocimientoVoz.onerror = (e) => {
      // Antes esto no quedaba en consola de ninguna forma — el toast
      // genérico no distingue causa. Con este log alcanza con abrir la
      // consola y mirar qué dice e.error para saber la causa real.
      console.warn("[asistente] Error de reconocimiento de voz:", e.error, e);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        paradaManual = true; // terminal: sin permiso no tiene sentido reintentar solo
        mostrarToast("Permiso de micrófono denegado");
        return;
      }
      // "no-speech"/"aborted" NO se marcan como parada manual a propósito:
      // son justo el tipo de corte que el pedido de "nunca debe cortar el
      // audio solo" quiere que se auto-repare en onend, no que apague el
      // botón.
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Fallo real del motor nativo (ej. "network", "audio-capture"): se
      // marca este navegador para usar el fallback de acá en adelante y se
      // reintenta YA con Gemini, sin que el usuario tenga que volver a
      // tocar el botón.
      usarFallbackTranscripcionGemini = true;
      transicionandoAFallback = true;
      paradaManual = true; // el reintento de acá en más lo maneja el fallback, no el auto-reinicio nativo
      mostrarToast("El micrófono nativo falló, probando transcripción alternativa…");
      iniciarFallbackGrabacion(textoPrevioAlInput);
    };
    reconocimientoVoz.onend = () => {
      // Si justo se está armando el fallback (ver onerror de arriba), no
      // tocar nada acá — el fallback maneja su propio ícono/estado.
      if (transicionandoAFallback) return;
      if (paradaManual) {
        grabandoVoz = false;
        btn.textContent = "🎙️";
        btn.title = "Dictar por voz";
        input.focus();
        return;
      }
      // Pedido explícito: botón de ALTERNAR, nunca debe cortar la
      // grabación por su cuenta — silencios largos, timeout interno del
      // motor (típico en Android incluso con continuous:true), lo que
      // sea. Si llegamos acá es porque el motor terminó SOLO, sin que el
      // usuario tocara nada: se reinicia de forma transparente, sin tocar
      // el ícono (sigue en "🔴 Grabando…") ni perder una palabra de lo ya
      // dictado — input.value tal como quedó pasa a ser el nuevo texto
      // previo del reinicio, exactamente el mismo mecanismo que usa un
      // arranque manual.
      if (!huboResultadoEstaVez) {
        reiniciosSeguidosSinResultado++;
        if (reiniciosSeguidosSinResultado >= 3) {
          reiniciosSeguidosSinResultado = 0;
          grabandoVoz = false;
          btn.textContent = "🎙️";
          btn.title = "Dictar por voz";
          mostrarToast("No se pudo mantener la escucha activa. Prueba de nuevo.");
          return;
        }
      }
      iniciarReconocimientoNativo(input.value ? `${input.value} ` : "");
    };
    reconocimientoVoz.start();
  }

  btn.onclick = () => {
    if (grabandoConFallback) {
      mediaRecorderVoz?.stop();
      return;
    }
    if (grabandoVoz) {
      paradaManual = true;
      reconocimientoVoz?.stop();
      return;
    }
    // Lo que ya había en el input (escrito a mano o de una grabación
    // anterior) se respeta — antes onresult pisaba todo con el texto
    // reconocido de la sesión actual. Se congela ACÁ (antes de empezar)
    // y cada actualización se le suma encima, nunca lo borra. Vale para
    // ambos caminos (nativo y fallback).
    const textoPrevioAlInput = input.value ? `${input.value} ` : "";

    if (usarFallbackTranscripcionGemini || !ReconocimientoVozAPI) {
      iniciarFallbackGrabacion(textoPrevioAlInput);
      return;
    }

    iniciarReconocimientoNativo(textoPrevioAlInput);
  };

  return btn;
}

/* ===================== Historial local (device-only) ===================== */

function leerHistorialLocalVigente() {
  try {
    const crudo = localStorage.getItem(CLAVE_HISTORIAL_ASISTENTE);
    if (!crudo) return null;
    const datos = JSON.parse(crudo);
    if (!datos || !Array.isArray(datos.turnos) || datos.turnos.length === 0) return null;
    if (!datos.ultimoMensajeEn || Date.now() - datos.ultimoMensajeEn > VIGENCIA_HISTORIAL_MS) {
      localStorage.removeItem(CLAVE_HISTORIAL_ASISTENTE);
      return null;
    }
    return datos;
  } catch (e) {
    console.warn("[asistente] Historial local corrupto, se descarta:", e);
    localStorage.removeItem(CLAVE_HISTORIAL_ASISTENTE);
    return null;
  }
}

/** Solo persiste si YA hay al menos un turno de cada rol — nunca por solo
 *  entrar y salir de la sección sin escribir nada. */
function guardarHistorialLocal() {
  const huboIntercambioReal =
    conversacionActual.some((t) => t.rol === "usuario") && conversacionActual.some((t) => t.rol === "modelo");
  if (!huboIntercambioReal) return;
  localStorage.setItem(
    CLAVE_HISTORIAL_ASISTENTE,
    JSON.stringify({ ultimoMensajeEn: Date.now(), turnos: conversacionActual })
  );
}

function borrarHistorialLocal() {
  localStorage.removeItem(CLAVE_HISTORIAL_ASISTENTE);
}

/* ===================== Contexto real para el prompt ===================== */

function obtenerContextoFechaHoy() {
  const hoy = new Date();
  const y = hoy.getFullYear();
  const m = String(hoy.getMonth() + 1).padStart(2, "0");
  const d = String(hoy.getDate()).padStart(2, "0");
  return { iso: `${y}-${m}-${d}`, diaSemana: NOMBRES_DIA_SEMANA[hoy.getDay()] };
}

/** "YYYY-MM-DD" a partir de una fecha local (inverso de fechaLocalDesdeISO). */
function fechaISODesdeLocal(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Bug real reportado (2026-08-22): el usuario dijo "a partir de semana 5"
 * (semana ACADÉMICA del semestre, no de un mes calendario) y Gemini calculó
 * mal — puso semana 8/9/10. Nunca fue un problema de "no entendió la
 * instrucción", fue que le pedíamos hacer aritmética de fechas encadenada
 * (día de hoy → offset de semanas → fecha calendario) a mano, y ahí un LLM
 * se resbala fácil.
 *
 * La solución no es pedirle que calcule mejor: es no dejarlo calcular. Acá
 * se arma, con datos REALES de cada semestre (fecha_inicio +
 * duracion_semanas, mismos campos que usa calcularNumeroSemanaSemestre en
 * core/schema.js), una tabla ya resuelta "semana N empieza el YYYY-MM-DD
 * (lunes)" para CADA semestre que Agenda tiene seleccionado ahora mismo.
 * Gemini ya no calcula la fecha de una semana académica: la busca en la
 * tabla y como mucho le suma el offset de día-de-semana (lunes+1=martes,
 * etc.), que es la única aritmética que sí le sale bien de forma
 * consistente.
 */
function construirContextoSemanasSemestres() {
  const semestres = obtenerSemestresSeleccionadosAgenda();
  if (semestres.length === 0) return "";

  const bloques = semestres.map((semestre) => {
    const inicio = fechaLocalDesdeISO(semestre.fecha_inicio);
    if (isNaN(inicio.getTime())) return null;
    const totalSemanas = Number(semestre.duracion_semanas) || 16;

    const filas = [];
    for (let n = 1; n <= totalSemanas; n++) {
      const inicioSemana = new Date(inicio);
      inicioSemana.setDate(inicioSemana.getDate() + (n - 1) * 7);
      filas.push(`  Semana ${n}: lunes ${fechaISODesdeLocal(inicioSemana)}`);
    }
    return `Semestre "${semestre.nombre || "Semestre"}" (empieza ${semestre.fecha_inicio}):\n${filas.join("\n")}`;
  }).filter(Boolean);

  if (bloques.length === 0) return "";

  return `\n\nTabla de semanas académicas (para resolver frases como "a partir de la
semana 5", "semana 8", etc. — SIEMPRE es semana del semestre, nunca de un
mes calendario). Cada fila da el lunes de esa semana; si piden un día
puntual, sumale los días que correspondan a partir de ESE lunes (ej. "el
martes de la semana 5" = lunes de la semana 5 + 1 día). NUNCA calcules la
fecha de una semana a mano contando desde hoy — buscá la semana en esta
tabla:\n${bloques.join("\n\n")}`;
}


/**
 * Bug real reportado (2026-08-22): el usuario pidió "quiz de cálculo para
 * la próxima clase" (refiriéndose a la próxima clase REAL de esa materia
 * puntual, según su horario) y Gemini lo interpretó como "el próximo lunes"
 * (primer día de la semana calendario) — puso el quiz un lunes en el que ni
 * siquiera hay clase de esa materia.
 *
 * Mismo principio que construirContextoSemanasSemestres de arriba: esto NO
 * es un problema de instrucción poco clara, es pedirle a un LLM que
 * adivine un dato que no tiene (el horario real del usuario) — la solución
 * es no dejarlo adivinar. Acá se calcula en JS, con los bloques_horario
 * reales de cada materia matriculada (mismos datos que ya usa
 * resolverHoraDefaultDesdeHorario más abajo), la fecha de la PRÓXIMA vez
 * que esa materia tiene clase a partir de hoy (buscando hasta 14 días
 * hacia adelante — cubre incluso materias que solo se ven cada 2 semanas).
 * Gemini ya no calcula esa fecha: la busca en esta tabla.
 */
function construirContextoProximasClases() {
  const materias = obtenerMateriasVinculablesAgenda();
  if (materias.length === 0) return "";

  const hoy = fechaLocalDesdeISO(obtenerContextoFechaHoy().iso);

  const filas = materias
    .map((materiaVinculada) => {
      const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
      const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
      if (!semestre || !mm) return null;

      const diasConClase = new Set();
      (semestre.bloques_horario || [])
        .filter((b) => b.materia_id === mm.materia_id && b.plan_estudio_id === mm.plan_estudio_id)
        .forEach((b) => (b.dias || []).forEach((d) => d.dia && diasConClase.add(d.dia)));
      if (diasConClase.size === 0) return null;

      for (let offset = 0; offset <= 14; offset++) {
        const candidata = new Date(hoy);
        candidata.setDate(candidata.getDate() + offset);
        const codigoDia = DIAS_SEMANA_CONFIG[(candidata.getDay() + 6) % 7].abrevDefault;
        if (diasConClase.has(codigoDia)) {
          return `- ${materiaVinculada.nombre}: ${fechaISODesdeLocal(candidata)}`;
        }
      }
      return null;
    })
    .filter(Boolean);

  if (filas.length === 0) return "";

  return `\n\nPróxima clase real de cada materia (para resolver frases como "la
próxima clase de X", "en la próxima clase de X", "antes de mi próxima
clase de X" — SIEMPRE es la fecha de esta tabla para esa materia
puntual, NUNCA el próximo lunes ni el primer día de la semana
calendario; cada materia tiene su propia próxima clase, según SU
horario real):\n${filas.join("\n")}`;
}

/**
 * Bug real reportado (2026-08-22): el usuario le puso un apodo a una
 * materia en Horario (ej. "Natación" para "Educación Física II", ver
 * campo `apodo` de crearBloqueHorario/obtenerNombreBloque en
 * horario/horario.js) y al usarlo en el chat ("tengo tarea de natación")
 * Gemini no lo reconocía como esa materia — porque solo se le pasaba el
 * nombre OFICIAL de cada una (obtenerMateriasVinculablesAgenda), nunca sus
 * apodos. Acá se juntan los apodos reales de cada materia (recorriendo sus
 * bloques de Horario — puede tener más de uno si tiene varios bloques con
 * apodos distintos, ej. teoría/práctica) para poder mostrárselos a Gemini
 * junto al nombre oficial. Devuelve un Map nombreOficial -> Set(apodos).
 */
function construirMapaApodosMaterias(materiasVinculables) {
  const apodosPorMateria = new Map();

  materiasVinculables.forEach((materiaVinculada) => {
    const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
    const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
    if (!semestre || !mm) return;

    const apodos = new Set();
    (semestre.bloques_horario || [])
      .filter((b) => b.materia_id === mm.materia_id && b.plan_estudio_id === mm.plan_estudio_id)
      .forEach((b) => {
        if (b.apodo && b.apodo.trim()) apodos.add(b.apodo.trim());
      });

    if (apodos.size > 0) apodosPorMateria.set(materiaVinculada.nombre, apodos);
  });

  return apodosPorMateria;
}

/**
 * Lista de materias para el prompt, con apodo(s) entre paréntesis cuando
 * la materia tiene alguno. Gemini sigue devolviendo SIEMPRE el nombre
 * OFICIAL en "materia" (nunca el apodo) — esto solo lo ayuda a identificar
 * a cuál materia se refiere el usuario cuando usa el apodo.
 */
function construirListaMateriasConApodos(materiasVinculables) {
  if (materiasVinculables.length === 0) {
    return "(el usuario no tiene materias matriculadas en los semestres que Agenda tiene seleccionados ahora)";
  }
  const apodosPorMateria = construirMapaApodosMaterias(materiasVinculables);
  return materiasVinculables
    .map((m) => {
      const apodos = apodosPorMateria.get(m.nombre);
      if (!apodos || apodos.size === 0) return `- ${m.nombre}`;
      return `- ${m.nombre} (${apodos.size === 1 ? "apodo" : "apodos"}: ${Array.from(apodos).join(", ")})`;
    })
    .join("\n");
}

/**
 * Caso límite real (pedido explícito): si el MISMO apodo quedó puesto en
 * dos materias distintas (ej. el usuario le dijo "Nata" tanto a Natación
 * como a otra), no hay forma de saber cuál quiso decir con solo el apodo.
 * Se arma una advertencia puntual por cada apodo duplicado (comparación
 * sin distinguir mayúsculas/acentos de más) para que Gemini pregunte en
 * vez de adivinar — mismo principio que ya usa la regla de materias
 * ambiguas por nombre parecido ("Cálculo I" vs "Cálculo II").
 */
function construirAvisoApodosDuplicados(materiasVinculables) {
  const apodosPorMateria = construirMapaApodosMaterias(materiasVinculables);
  const materiasPorApodo = new Map();

  apodosPorMateria.forEach((apodos, nombreMateria) => {
    apodos.forEach((apodo) => {
      const clave = apodo.toLowerCase();
      if (!materiasPorApodo.has(clave)) materiasPorApodo.set(clave, { apodo, materias: [] });
      materiasPorApodo.get(clave).materias.push(nombreMateria);
    });
  });

  const duplicados = Array.from(materiasPorApodo.values()).filter((entrada) => entrada.materias.length > 1);
  if (duplicados.length === 0) return "";

  const filas = duplicados
    .map((d) => `- "${d.apodo}" lo tienen tanto ${d.materias.join(" como ")}`)
    .join("\n");

  return `\n\n⚠️ Apodos duplicados (dos o más materias comparten el mismo apodo):
${filas}
Si el usuario usa uno de estos apodos SIN aclarar de cuál habla (ej. no
menciona nada más que lo distinga), NO adivines cuál es: devolvé "items":
[] y preguntá en "aclaracion" cuál de las dos es, nombrando el nombre
OFICIAL de cada una (ej. "Le pusiste 'Nata' tanto a Natación como a Vóley
playa, ¿a cuál te refieres?").`;
}

/**
 * Días reales de clase de cada materia vinculable, con su modalidad de
 * PLANTILLA (bloque.dias[].modalidad — la modalidad "de base", la que el
 * usuario reconoce como normal) — NUNCA la de Cronograma (excepciones
 * puntuales de una semana ya ajustada), porque para identificar a qué día
 * se refiere el usuario ("mi clase de anatomía del jueves") lo que importa
 * es si esa materia REALMENTE tiene clase ese día de la semana, no si esa
 * semana puntual ya tiene un ajuste.
 *
 * Agregada 2026-08-29 (editar modalidad por voz/texto): es el único
 * contexto nuevo que necesita Gemini para la acción "editar_modalidad" —
 * sin esto no podría saber si "el jueves" es un día válido para esa
 * materia, ni qué modalidad tiene hoy para armar la tarjeta de
 * confirmación ("presencial → virtual").
 */
function construirContextoDiasModalidadMaterias(materiasVinculables) {
  if (materiasVinculables.length === 0) return "";

  const filas = materiasVinculables
    .map((materiaVinculada) => {
      const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
      const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
      if (!semestre || !mm) return null;

      // Un mismo día puede repetirse en más de un bloque (ej. teoría y
      // práctica el mismo jueves) — Map por código de día para quedarse
      // con uno solo por día en el texto que ve Gemini (el primero que
      // aparezca; desambiguar cuál bloque puntual es no es su trabajo,
      // eso lo resuelve resolverCambioModalidad en JS con datos reales).
      const modalidadPorDia = new Map();
      (semestre.bloques_horario || [])
        .filter((b) => b.materia_id === mm.materia_id && b.plan_estudio_id === mm.plan_estudio_id)
        .forEach((b) => {
          (b.dias || []).forEach((d) => {
            if (!d.dia || modalidadPorDia.has(d.dia)) return;
            const nombreDia = nombreDiaDesdeCodigo(d.dia);
            if (nombreDia) modalidadPorDia.set(d.dia, { nombreDia, modalidad: d.modalidad || "presencial" });
          });
        });

      if (modalidadPorDia.size === 0) return null;
      const partes = Array.from(modalidadPorDia.values()).map(
        (info) => `${info.nombreDia} (${obtenerEtiquetaModalidad(info.modalidad).toLowerCase()})`
      );
      return `- ${materiaVinculada.nombre}: ${partes.join(", ")}`;
    })
    .filter(Boolean);

  if (filas.length === 0) return "";
  return `\n\nDías reales de clase de cada materia, con su modalidad actual (para
"editar_modalidad" — cambiá SOLO lo que el usuario pida, y solo si el día que
menciona está en esta lista para esa materia puntual):\n${filas.join("\n")}`;
}

/**
 * Construye el system prompt de extracción con contexto REAL del usuario
 * (fecha de hoy + materias matriculadas de los semestres que Agenda tiene
 * seleccionados ahora mismo, ver obtenerMateriasVinculablesAgenda en
 * agenda-utils.js) — se arma de nuevo en CADA llamada, no una sola vez al
 * abrir el chat, porque tanto la fecha como las materias pueden cambiar a
 * mitad de una conversación larga (medianoche, o el usuario cambia de
 * semestre seleccionado en otra pestaña).
 *
 * Revisado 2026-08-22 (bug real reportado en producción): antes Gemini
 * metía el nombre de la materia DENTRO de "nombre" (ej. "Examen de Cálculo
 * I") y la vinculación real (materia_matriculada_id) nunca pasaba — quedaba
 * como texto suelto, no vinculada de verdad en Agenda. Ahora "materia" es
 * un campo propio: Gemini solo identifica CUÁL materia de la lista aplica
 * (o null), y la vinculación real (buscar el mmId/semestreId exacto) la
 * hace resolverMateriaVinculada() en JS — Gemini nunca decide el id, solo
 * el nombre visible, mismo principio anti-alucinación de siempre.
 *
 * "hora" sigue siendo SOLO lo que el usuario dijo explícitamente. Si viene
 * null, el default (hora de inicio de esa clase según Horario, si la
 * materia quedó vinculada) se resuelve después en JS con datos reales del
 * horario — Gemini no tiene ni debe tener ese dato, así que nunca se le
 * pide inventarlo.
 */
function construirSystemInstruction() {
  const { iso, diaSemana } = obtenerContextoFechaHoy();
  const materiasVinculables = obtenerMateriasVinculablesAgenda();
  const listaMaterias = construirListaMateriasConApodos(materiasVinculables);
  const avisoApodosDuplicados = construirAvisoApodosDuplicados(materiasVinculables);
  const contextoDiasModalidad = construirContextoDiasModalidadMaterias(materiasVinculables);

  return `Sos el Asistente IA de una app académica. Tu función es leer un
mensaje en lenguaje natural de un estudiante universitario y, según lo que
pida, extraer tareas/exámenes/eventos para su Agenda, detectar un pedido de
cambiar la modalidad de una clase puntual en su Horario, o reconocer una
CONSULTA de solo lectura sobre lo que ya tiene guardado (tareas/eventos de
una semana, o la modalidad de una clase próxima).

Hoy es ${iso} (${diaSemana}). Usá esta fecha como referencia para resolver
cualquier fecha relativa ("mañana", "el jueves", "en 2 semanas", "el
próximo lunes", etc.). Si el usuario describe algo que se repite (ej. "los
martes durante 3 semanas seguidas"), devolvé UN ítem por cada ocurrencia
real, cada uno con su propia fecha.${construirContextoSemanasSemestres()}${construirContextoProximasClases()}

Materias matriculadas reales del usuario ahora mismo (nombre oficial —
entre paréntesis, el/los apodo(s) que el usuario le puso en Horario, si
tiene):
${listaMaterias}${avisoApodosDuplicados}${contextoDiasModalidad}

Devolvé ÚNICAMENTE un JSON con esta forma exacta:
{
  "accion": "crear_eventos" | "editar_modalidad" | "consultar" | "actualizar_nombre",
  "items": [
    {
      "tipo": "evento" | "tarea" | "examen",
      "nombre": "string corto, SOLO el título de la tarea/examen/evento",
      "materia": "nombre EXACTO de la lista de arriba, o null",
      "fecha": "YYYY-MM-DD",
      "hora": "HH:MM" | null,
      "notas": "string, vacío salvo que aplique la regla de abajo",
      "esFeriado": true | false
    }
  ],
  "cambioModalidad": {
    "materia": "nombre EXACTO de la lista de arriba, o null",
    "dia": "lunes" | "martes" | "miércoles" | "jueves" | "viernes" | "sábado" | "domingo",
    "modalidadNueva": "presencial" | "virtual" | "asincronica" | "sin_clase"
  } | null,
  "consulta": {
    "tipo": "tareas_eventos" | "modalidad_clase" | "buscar_evento",
    "semana": number | null,
    "alcance": "todo" | null,
    "materia": "nombre EXACTO de la lista de arriba, o null",
    "dia": "lunes" | "martes" | "miércoles" | "jueves" | "viernes" | "sábado" | "domingo" | null,
    "tipoItem": "examen" | "tarea" | "evento" | null,
    "numeroOrdinal": number | null,
    "proximo": true | false | null,
    "palabrasClave": "string" | null
  } | null,
  "nombrePreferido": "string" | null,
  "aclaracion": "string" | null
}

Regla de "accion" (elegí una sola por mensaje):
- "actualizar_nombre": el usuario pide EXPLÍCITAMENTE que lo llames de otra
  forma (ej. "llámame Fer", "decime Pipo de ahora en más", "ya no me digas
  Juan, decime Juanjo", "prefiero que me digas..."). "items": [],
  "cambioModalidad": null, "consulta": null, "aclaracion": null, y
  "nombrePreferido" lleva el nombre/apodo EXACTO que pidió usar, tal como
  lo dijo (con mayúscula inicial si aplica). Una pregunta SOBRE el nombre
  (ej. "¿de dónde sacaste mi nombre?", "¿cómo sabes cómo me llamo?") NO es
  esto — no pide cambiar nada, cae al default de "crear_eventos" con
  "items": [] más abajo (se responde por el otro lado, conversacional).
- "consulta": el usuario PREGUNTA por algo que ya existe (nunca pide crear
  ni cambiar nada) — ej. "qué tareas tengo para esta semana", "qué tengo
  para la semana 8", "qué exámenes hay esta semana", "qué modalidad es mi
  próxima clase de bases de datos", "los jueves de historia son
  presenciales o virtuales". En este caso "items" va SIEMPRE en [],
  "cambioModalidad" va en null, y "consulta" lleva el detalle:
  - "tipo": "tareas_eventos" si pregunta por tareas/exámenes/eventos
    guardados EN GENERAL para un período (ej. "qué tengo esta semana",
    "qué tareas hay en la semana 8" — sin nombrar un ítem puntual);
    "modalidad_clase" si pregunta por la modalidad de una clase;
    "buscar_evento" si pregunta CUÁNDO ES o por el detalle de UN ítem
    puntual que ya tiene guardado, identificándolo por su nombre/número
    (ej. "cuándo es el tercer parcial de cálculo", "qué día era el
    laboratorio 4 de bd", "ya pasé el cotidiano de bd?") — la señal es que
    el usuario nombra algo específico (un tipo de ítem + alguna pista de
    cuál, como un número/ordinal o palabra del título), no que pida "todo
    lo que tengo".
  - "semana" (solo aplica a "tareas_eventos"): SOLO si el usuario menciona
    una "semana N" académica explícita (usá la tabla de semanas de arriba
    para saber que existe, pero NO calcules fechas vos, eso lo hace el
    sistema con el número). Si no menciona ninguna semana puntual (ej.
    "esta semana", "esta nueva semana", o no dice nada), "semana" es null
    (el sistema asume la semana actual) — EXCEPTO si aplica "alcance":
    "todo" (ver abajo), en cuyo caso "semana" se ignora igual.
  - "alcance" (solo aplica a "tareas_eventos", 2026-08-31): "todo" SOLO si
    el usuario pide EXPLÍCITAMENTE que no se limite a ninguna semana (ej.
    "todos mis exámenes", "todo lo que tengo pendiente", "todo el
    semestre", "todos los futuros exámenes", "cualquier tarea sin importar
    la semana", o insiste después de una respuesta limitada a una semana
    con algo como "no, TODO"/"de todo el semestre"). En ese caso "semana"
    se ignora (el sistema no aplica ningún filtro de fecha, trae TODO lo
    guardado que matchee materia/tipoItem). Si no lo pide explícitamente,
    "alcance" es null (comportamiento normal, limitado a una semana).
  - "materia" (opcional en "tareas_eventos"/"buscar_evento", para filtrar
    por una materia puntual si el usuario lo pide; SIEMPRE requerido en
    "modalidad_clase"): el nombre OFICIAL exacto de la lista de arriba —
    pero puede llegar por varios caminos, todos válidos mientras resuelva
    a UNA SOLA materia sin ambigüedad:
    * nombre oficial completo o apodo (como siempre);
    * nombrar solo PARTE del nombre oficial (ej. "el parcial de derecho"
      con "Derecho Informático Y Mercantil" en la lista → "materia":
      "Derecho Informático Y Mercantil");
    * una palabra truncada/abreviada obvia de una palabra del nombre
      oficial (ej. "admin de proyectos" → "administración" truncado a
      "admin" — si SOLO una materia de la lista empieza con "Admin...",
      es "Administración de Proyectos 2", no hace falta el nombre
      completo);
    * las INICIALES mostradas entre paréntesis junto a cada materia (ej.
      "AP2" o simplemente "ap" → la materia que muestre "(iniciales: AP2)"
      en la lista de arriba) — estas iniciales las calcula el sistema, no
      son un apodo que el usuario haya puesto, así que reconocelas igual.
    Estos tres caminos son igual de válidos que un nombre completo — NO
    son "adivinar", son lectura normal de una abreviatura obvia. Lo que
    SIGUE prohibido es elegir entre dos o más materias que podrían encajar
    igual de bien (ahí sí es ambigüedad real): si no matchea claro con una
    sola materia por NINGUNO de estos caminos, NO adivines: "consulta":
    null, "items": [], y preguntá en "aclaracion" cuál es.
  - "dia" (solo aplica a "modalidad_clase"): SOLO si el usuario nombra un
    día puntual (ej. "los jueves de bd"). Si pregunta por "la próxima
    clase" sin nombrar día, "dia" es null (el sistema busca la próxima
    clase real de esa materia, igual que para crear_eventos).
  - "tipoItem" (aplica a "tareas_eventos" Y a "buscar_evento"): "examen" |
    "tarea" | "evento" si el usuario pidió explícitamente un tipo puntual
    (ej. "qué EXÁMENES tengo esta semana" → "examen"; "parcial"/"quiz" →
    "examen"; "laboratorio"/"tarea" → "tarea"), o null si pidió todo sin
    distinguir tipo (ej. "qué TENGO esta semana").
  - "numeroOrdinal" (solo aplica a "buscar_evento"): SOLO si el usuario
    menciona un número u ordinal identificando cuál ítem es (ej. "el
    TERCER parcial" → 3, "laboratorio 4" → 4, "cotidiano 4" → 4, "Parcial
    I" → 1, "el parcial II" → 2, "examen III" → 3). Convertí a número tanto
    los ordinales en palabras como los números romanos. null si no
    menciona ninguno.
  - "proximo" (solo aplica a "buscar_evento", 2026-08-31): true SOLO si el
    usuario pregunta por "el PRÓXIMO"/"el SIGUIENTE" ítem (opcionalmente de
    una materia puntual, y opcionalmente un tipo) SIN nombrar un título
    puntual ni un número/ordinal — ej. "cuándo es el próximo examen de
    AP2", "cuánto falta para el siguiente parcial de física", "cuál es mi
    próxima tarea de bd", pero TAMBIÉN sin mencionar ninguna materia, ej.
    "cuánto falta para el próximo examen" (a secas, cualquier materia) o
    "cuál es mi próxima tarea" — en ese caso "materia" simplemente queda
    null como siempre que no se menciona una, "proximo" sigue siendo true
    igual, NUNCA caigas a tratar "examen"/"tarea" como si fueran
    "palabrasClave" del título solo porque no hay materia. En cualquiera de
    los dos casos "numeroOrdinal" y "palabrasClave" van en null (el sistema
    busca el ítem más cercano en el futuro que matchee materia/tipoItem, no
    hace falta más pista). Si el usuario SÍ da un título/ordinal puntual
    (ej. "el tercer parcial", "el laboratorio 4"), "proximo" es null/false
    — ese caso sigue siendo "numeroOrdinal"/"palabrasClave" como siempre,
    NO "proximo".
  - "palabrasClave" (solo aplica a "buscar_evento", y solo cuando "proximo"
    NO es true): las palabras del título del ítem que busca, SIN el
    número/ordinal (eso va aparte en "numeroOrdinal") ni el nombre de la
    materia (eso va en "materia") — ej. para "el tercer parcial de
    cálculo", "palabrasClave" es "parcial".
- "editar_modalidad": el usuario pide CAMBIAR la modalidad de una clase que
  YA existe en su Horario (ej. "cambiá mi clase de anatomía del jueves a
  virtual", "la clase de cálculo ahora es presencial", "poné asincrónica la
  clase de historia del lunes"). En este caso "items" va SIEMPRE en [] y
  "cambioModalidad" lleva el detalle. Solo se refiere a UNA clase puntual
  (el próximo día de esa materia que caiga en semana), nunca a "todos los
  jueves para siempre" — no hace falta que lo aclares, el sistema ya lo
  interpreta así.
  - "materia": igual criterio que en "items" (nombre oficial exacto o
    apodo → nombre oficial). Si no matchea claro con una sola materia de
    la lista de "Días reales de clase" de arriba, NO adivines:
    "cambioModalidad": null, "items": [], y preguntá en "aclaracion" cuál
    es (mismo criterio que la regla de materias ambiguas de abajo).
  - "dia": el día de la semana que el usuario mencionó, en minúscula, uno
    de los 7 nombres exactos de arriba. Si el día que menciona NO aparece
    en la lista de "Días reales de clase" para esa materia (ej. dice
    "viernes" pero esa materia no tiene clase los viernes), NO inventes:
    "cambioModalidad": null y explicá el problema en "aclaracion" (ej.
    "Anatomía no tiene clase los viernes según tu Horario — ¿los días que
    sí tiene clase, cuál es el que quieres cambiar?").
  - "modalidadNueva": SOLO uno de los 4 valores listados arriba, según lo
    que pida el usuario (virtual/presencial/asincrónica/sin clase o
    equivalentes como "no hay clase", "cancelada", "queda suspendida").
- "crear_eventos": cualquier otro pedido de agendar una tarea/examen/
  evento — "items" lleva el detalle como siempre, "cambioModalidad",
  "consulta" y "nombrePreferido" van en null. Es el valor por defecto para
  todo lo que no sea explícitamente un cambio de nombre, una consulta o un
  cambio de modalidad (incluye charla suelta, preguntas generales y
  preguntas SOBRE el nombre — "items" queda en [] en esos casos).

Reglas de "items" (solo aplican cuando accion es "crear_eventos"):
- Si el mensaje menciona una "semana N" (semana 5, semana 8, etc.), es
  SIEMPRE semana académica del semestre — buscá esa semana en la tabla de
  arriba (si hay una) y calculá la fecha desde ahí, NUNCA contando semanas
  a mano desde la fecha de hoy.
- Si el mensaje dice "la próxima clase de X" (o "en/antes de mi próxima
  clase de X"), sin decir un día puntual, la fecha es la de la tabla
  "Próxima clase real de cada materia" de arriba para ESA materia
  específica — NUNCA el próximo lunes ni el primer día de la semana
  calendario. Cada materia tiene su propio próximo día de clase, no
  asumas que todas caen el mismo día.
- "examen" para exámenes/parciales/quices; "tarea" para tareas/entregas/
  proyectos; "evento" para cualquier otra cosa (charlas, reuniones, citas,
  etc.).
- "nombre": SOLO el título de la tarea/examen/evento en sí (ej. "Prueba
  1", "Proyecto final", "Entrega de laboratorio"). NUNCA metas el nombre
  de la materia acá — eso va aparte, en "materia".
- "materia": si el mensaje nombra una materia —por su nombre OFICIAL, por
  su APODO (el que el usuario le puso en Horario, mostrado entre
  paréntesis en la lista de arriba), por sus INICIALES calculadas por el
  sistema (también entre paréntesis en la lista, ej. "AP2" para
  "Administración de Proyectos 2" — no son un apodo, las calcula el
  sistema, pero se reconocen igual), o por una palabra truncada/abreviada
  obvia de una palabra del nombre oficial (ej. "admin de proyectos" →
  "admin" truncado de "Administración")— que coincide claramente con UNA
  SOLA de la lista, usá SIEMPRE el nombre OFICIAL exacto de la lista en
  "materia", nunca el apodo/iniciales/abreviatura (ej. si dice "tarea de
  natación" y en la lista está "Educación Física II (apodo: Natación)",
  "materia" es "Educación Física II", no "Natación"). Estos caminos son
  igual de válidos que un nombre completo — no son "adivinar", son lectura
  normal de una abreviatura obvia. Si no se menciona materia o no hay
  forma de saber cuál, "materia" es null.
- Si el mensaje es realmente ambiguo entre 2 o más materias de la lista
  (ej. existen "Cálculo I" y "Cálculo II" y el usuario solo dijo
  "cálculo", sin forma de saber cuál con el resto del mensaje; o usa un
  apodo/inicial/abreviatura que podría ser de más de una), NO adivines:
  devolvé "items": [] y explicá la duda en "aclaracion" con una pregunta
  corta y directa (ej. "¿Te refieres a Cálculo I o Cálculo II?").
- "hora": SOLO si el usuario mencionó una hora puntual explícita (ej. "a
  las 2pm", "a las 14:00"). Si no la mencionó, "hora" es null SIEMPRE —
  nunca trates de adivinar a qué hora es una clase, eso no es tu trabajo.
- "notas": vacío ("") por defecto. SOLO ponés algo acá si el usuario pidió
  EXPLÍCITAMENTE guardar una nota o aclaración puntual (ej. "y anotá que
  es grupal", "poné en notas que hay que llevar la calculadora"). NUNCA
  inventes ni infieras contexto por tu cuenta (número de semana, motivo,
  suposiciones) — si el usuario no lo pidió como nota, no va.
- "esFeriado": true SOLO si el usuario indica explícitamente que es un
  feriado/día no lectivo/asueto (ej. "el lunes es feriado", "marcá el 15
  de setiembre como feriado", "no hay clases por el feriado de..."). Para
  cualquier tarea/examen/evento normal (aunque caiga en fin de semana),
  "esFeriado" es false. Un feriado casi siempre es "tipo": "evento" y
  "materia": null — nunca lo relaciones con una materia salvo que el
  usuario lo pida explícitamente.
- Un solo mensaje puede describir más de un ítem — devolvé todos los que
  encuentres en "items".
- Si el mensaje no describe ninguna tarea/examen/evento reconocible, ni un
  cambio de modalidad, ni una consulta de solo lectura (saludo, pregunta
  suelta sin relación con tareas/horario, charla sin fecha ni intención
  real de agendar/cambiar/consultar algo), devolvé "accion":
  "crear_eventos", "items": [] y "aclaracion": null.
- "aclaracion" es SOLO para preguntar algo puntual que te impide resolver
  bien un ítem o un cambio de modalidad por ambigüedad real. Si ya tenés
  todo claro, "aclaracion" va en null aunque "items" o "cambioModalidad"
  tengan resultados.`;
}

/* ===================== Llamada a la API de Gemini ===================== */

const ESQUEMA_RESPUESTA_GEMINI = {
  type: "OBJECT",
  properties: {
    accion: { type: "STRING", enum: ["crear_eventos", "editar_modalidad", "consultar", "actualizar_nombre"] },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          tipo: { type: "STRING", enum: ["evento", "tarea", "examen"] },
          nombre: { type: "STRING" },
          materia: { type: "STRING", nullable: true },
          fecha: { type: "STRING" },
          hora: { type: "STRING", nullable: true },
          notas: { type: "STRING" },
          esFeriado: { type: "BOOLEAN" },
        },
        required: ["tipo", "nombre", "fecha"],
      },
    },
    // editar_modalidad (2026-08-29): "dia" y "modalidadNueva" van sin enum
    // acá porque el modo JSON nativo de Gemini es más confiable devolviendo
    // string libre que forzando un enum sobre un campo que además puede
    // venir null si la materia no matcheó — la validación real (contra
    // NOMBRES_DIA_SEMANA y MODALIDADES_VALIDAS_ASISTENTE) se hace en JS en
    // resolverCambioModalidad, mismo principio anti-alucinación que
    // resolverMateriaVinculada.
    cambioModalidad: {
      type: "OBJECT",
      nullable: true,
      properties: {
        materia: { type: "STRING", nullable: true },
        dia: { type: "STRING" },
        modalidadNueva: { type: "STRING" },
      },
      required: ["dia", "modalidadNueva"],
    },
    // consultar (2026-08-29, bug real: preguntas de solo lectura caían al
    // fallback conversacional sin contexto real). "semana"/"materia"/"dia"
    // sin enum ni required estrictos: Gemini solo aporta la INTENCIÓN
    // (qué tipo de consulta, qué semana/materia/día mencionó), la
    // resolución real contra estado.datos.agenda/Horario la hace JS
    // (resolverConsultaTareasEventos/resolverConsultaModalidad) — mismo
    // principio anti-alucinación de siempre, Gemini nunca inventa qué
    // tareas existen.
    consulta: {
      type: "OBJECT",
      nullable: true,
      properties: {
        tipo: { type: "STRING", enum: ["tareas_eventos", "modalidad_clase", "buscar_evento"] },
        semana: { type: "NUMBER", nullable: true },
        materia: { type: "STRING", nullable: true },
        dia: { type: "STRING", nullable: true },
        tipoItem: { type: "STRING", enum: ["examen", "tarea", "evento"], nullable: true },
        numeroOrdinal: { type: "NUMBER", nullable: true },
        palabrasClave: { type: "STRING", nullable: true },
        // "alcance" (2026-08-31, bug real: "todos los exámenes"/"todo el
        // semestre" seguía devolviendo solo la semana actual porque no
        // había forma de pedir "sin límite de fecha") — solo aplica a
        // "tareas_eventos", ver instrucciones abajo.
        alcance: { type: "STRING", enum: ["todo"], nullable: true },
        // "proximo" (2026-08-31, bug real: "cuánto falta para el próximo
        // examen de AP" no tenía forma de pedirse sin nombrar un
        // título/ordinal puntual) — solo aplica a "buscar_evento".
        proximo: { type: "BOOLEAN", nullable: true },
      },
      required: ["tipo"],
    },
    nombrePreferido: { type: "STRING", nullable: true },
    aclaracion: { type: "STRING", nullable: true },
  },
  required: ["accion", "items"],
};

/**
 * Llama a generateContent con el historial completo de la conversación
 * visible + el mensaje nuevo. `responseMimeType: "application/json"` +
 * `responseSchema` (modo JSON nativo de Gemini, no un simple "por favor
 * devolvé JSON" dentro del texto del prompt) es lo que de verdad
 * garantiza que la respuesta sea SIEMPRE JSON parseable con esta forma
 * exacta — mucho más confiable que confiar en que el modelo obedezca una
 * instrucción de formato metida en el prompt.
 *
 * Devuelve { items, aclaracion, crudo } en éxito. Tira un Error con
 * `.tipoError` ("clave" | "limite" | "red" | "desconocido") en falla, para
 * que quien llama pueda mostrar un mensaje distinto según el caso (ver
 * mensajeParaError).
 */
/**
 * Núcleo real de la llamada a generateContent, ya con `contents` armado por
 * quien llama — no sabe ni le importa si eso vino del historial del chat en
 * vivo o de un solo turno suelto. Separado de llamarGemini (2026-08-23,
 * Bandeja Pendiente) para poder agregar extraerEventosDeTexto (abajo) sin
 * duplicar todo el manejo de errores/parseo de respuesta.
 */
async function ejecutarGeneracionGemini(contents) {
  const claveApi = estado.datos.configuracion.gemini_api_key;
  if (!claveApi) {
    const err = new Error("No hay clave de Gemini guardada.");
    err.tipoError = "clave";
    throw err;
  }

  // Chequeo explícito de conexión (2026-08-22, pedido: "cubrir el caso de
  // si no tenés wifi"): antes se dependía de que el fetch fallara con un
  // TypeError de red para que mensajeParaError mostrara el texto correcto
  // ("No se pudo conectar con Gemini...") — en la práctica no siempre pasa
  // así de inmediato (algunos navegadores tardan en tirar el error o lo
  // tiran distinto), y el usuario terminaba viendo el genérico "Algo salió
  // mal de mi lado". navigator.onLine no es 100% infalible (puede decir
  // true con wifi conectado pero sin salida real a internet), así que esto
  // es un atajo rápido para el caso más común (avión, sin datos/wifi), no
  // un reemplazo del try/catch de abajo — si igual falla la conexión real,
  // el catch de fetch sigue cubriendo ese caso con el mismo tipoError.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    const err = new Error("Sin conexión a internet.");
    err.tipoError = "red";
    throw err;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${encodeURIComponent(claveApi)}`;

  // Bug real reportado (2026-08-31): "modalidad de la próxima clase de
  // inglés"/"¿tengo que ir presencial?" cayeron en "Algo salió mal de mi
  // lado" — la consola mostraba 503 de generativelanguage.googleapis.com
  // (servidor de Gemini saturado momentáneamente, no un error de la app).
  // Un 503/UNAVAILABLE es por definición transitorio, así que antes de
  // rendirse con tipoError "desconocido" se reintenta un par de veces con
  // una pausa corta — un error real (clave inválida, límite, etc.) nunca
  // entra acá porque esos códigos no cuentan como transitorios.
  const MAX_REINTENTOS_GEMINI_TRANSITORIO = 2;
  const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  let respuesta;
  let datos;
  for (let intento = 0; ; intento++) {
    try {
      respuesta = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: construirSystemInstruction() }] },
          contents,
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: ESQUEMA_RESPUESTA_GEMINI,
            temperature: 0.2,
          },
        }),
      });
    } catch (e) {
      const err = new Error("No se pudo conectar con Gemini.");
      err.tipoError = "red";
      throw err;
    }

    try {
      datos = await respuesta.json();
    } catch (e) {
      const err = new Error("Gemini devolvió una respuesta inválida.");
      err.tipoError = "desconocido";
      throw err;
    }

    if (respuesta.ok) break;

    const codigo = datos && datos.error && datos.error.code;
    const estadoError = datos && datos.error && datos.error.status;
    const esTransitorio = codigo === 503 || codigo === 500 || estadoError === "UNAVAILABLE";
    if (esTransitorio && intento < MAX_REINTENTOS_GEMINI_TRANSITORIO) {
      await esperar(700 * (intento + 1)); // 700ms, luego 1400ms
      continue;
    }

    const err = new Error((datos && datos.error && datos.error.message) || "Error de Gemini");
    err.tipoError = codigo === 400 || codigo === 401 || codigo === 403 ? "clave" : codigo === 429 ? "limite" : "desconocido";
    throw err;
  }

  const candidato = datos.candidates && datos.candidates[0];
  const parte = candidato && candidato.content && candidato.content.parts && candidato.content.parts[0];
  const texto = parte && parte.text;
  if (!texto) {
    const err = new Error("Gemini no devolvió contenido (posible bloqueo de seguridad).");
    err.tipoError = "desconocido";
    throw err;
  }

  let parseado;
  try {
    parseado = JSON.parse(texto);
  } catch (e) {
    const err = new Error("No se pudo interpretar la respuesta de Gemini.");
    err.tipoError = "desconocido";
    throw err;
  }

  return {
    // Default "crear_eventos" (2026-08-29): protege contra un turno viejo
    // reconstruido desde historial guardado ANTES de este cambio, donde
    // `accion` no existe en el JSON crudo guardado (ver
    // reconstruirChatDesdeHistorial) — ese caso puntual siempre fue/debe
    // seguir comportándose como creación de eventos.
    accion:
      parseado.accion === "editar_modalidad"
        ? "editar_modalidad"
        : parseado.accion === "consultar"
        ? "consultar"
        : parseado.accion === "actualizar_nombre"
        ? "actualizar_nombre"
        : "crear_eventos",
    items: Array.isArray(parseado.items) ? parseado.items : [],
    cambioModalidad: parseado.cambioModalidad || null,
    consulta: parseado.consulta || null,
    nombrePreferido: parseado.nombrePreferido || null,
    aclaracion: parseado.aclaracion || null,
    crudo: texto,
  };
}

/**
 * Llamada "en vivo" del chat — arma `contents` con TODO el historial visible
 * en pantalla (conversacionActual) más el mensaje nuevo. Sigue siendo el
 * único punto de entrada para manejarEnvioMensaje (el chat interactivo).
 */
async function llamarGemini(mensajeNuevo) {
  const contents = conversacionActual.map((turno) => ({
    role: turno.rol === "usuario" ? "user" : "model",
    parts: [{ text: turno.rol === "usuario" ? turno.texto : turno.crudo }],
  }));
  contents.push({ role: "user", parts: [{ text: mensajeNuevo }] });
  return ejecutarGeneracionGemini(contents);
}

/**
 * Variante STATELESS de llamarGemini — nunca lee ni toca conversacionActual
 * (el historial visible del chat en pantalla de este dispositivo). Un solo
 * turno con el texto recibido, sin ningún contexto de otros mensajes.
 *
 * Agregada 2026-08-23 para Bandeja Pendiente (asistente-bandeja.js): cada
 * ítem del buzón (texto suelto capturado por el Atajo de Siri, o ya
 * transcrito desde audio con transcribirBase64ConGemini) se procesa como un
 * mensaje aislado, independiente de cualquier chat que el usuario pueda
 * tener abierto en este momento en la sección Asistente — usar llamarGemini
 * acá mezclaría (o pisaría) esa conversación en vivo, que es justo lo que
 * esto evita. Misma clave, mismo modelo, mismo esquema de respuesta.
 */
async function extraerEventosDeTexto(texto) {
  return ejecutarGeneracionGemini([{ role: "user", parts: [{ text: texto }] }]);
}

/**
 * Punto 3 del brief de personalidad Wapper (2026-08-29): "un system prompt
 * aparte para las respuestas conversacionales normales" — se usa SOLO
 * cuando la extracción (llamarGemini, arriba) ya devolvió "items": [] y
 * "aclaracion": null (charla suelta, sin tarea/examen/evento reconocible
 * ni cambio de modalidad — ver rama de fallback en
 * mostrarResultadoEventosEnChat). Llamada COMPLETAMENTE APARTE de la de
 * extracción: mismo modelo/clave, pero con PROMPT_PERSONALIDAD_WAPPER como
 * system_instruction en vez de construirSystemInstruction, y SIN
 * responseSchema (texto libre, no JSON) — así la personalidad nunca se
 * mezcla con el prompt frío que arma el JSON estructurado, tal como pide
 * el punto 1 del brief.
 *
 * Devuelve el texto de Wapper, o `null` si algo falla (clave inválida, sin
 * red, respuesta vacía/bloqueada, etc.) — el caller decide el mensaje de
 * respaldo (MENSAJE_FALLBACK_WAPPER) en ese caso, nunca se propaga un
 * error acá para no duplicar el manejo de errores que ya tiene
 * ejecutarGeneracionGemini para la ruta principal.
 */
async function generarRespuestaConversacionalWapper(textoUsuario) {
  const claveApi = estado.datos.configuracion.gemini_api_key;
  if (!claveApi) return null;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${encodeURIComponent(claveApi)}`;
  try {
    const respuesta = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: construirPromptPersonalidadWapper() }] },
        contents: [{ role: "user", parts: [{ text: textoUsuario }] }],
        generationConfig: { temperature: 0.6 },
      }),
    });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    const candidato = datos.candidates && datos.candidates[0];
    const parte = candidato && candidato.content && candidato.content.parts && candidato.content.parts[0];
    const texto = parte && parte.text && parte.text.trim();
    return texto || null;
  } catch (e) {
    return null;
  }
}

function mensajeParaError(e) {
  if (e.tipoError === "clave") return "Tu clave de Gemini parece inválida o vencida. Revisala en Ajustes > Asistente IA.";
  if (e.tipoError === "limite") return "Se alcanzó el límite de uso de Gemini por ahora. Esperá un momento y probá de nuevo.";
  if (e.tipoError === "red") return "No se pudo conectar con Gemini. Revisá tu conexión e intentá de nuevo.";
  return "Algo salió mal de mi lado. Intentá de nuevo en un momento.";
}

/* ===================== Guardado real del ítem extraído ===================== */

/**
 * Cruza el "nombre" de materia que devolvió Gemini contra la lista real de
 * materias vinculables (mismo criterio que ya usa el prompt para restringir
 * qué puede contestar) — nunca se confía en un match hecho por el modelo,
 * se vuelve a resolver acá con datos reales.
 */
function resolverMateriaVinculada(nombreMateria) {
  if (!nombreMateria) return null;
  const materias = obtenerMateriasVinculablesAgenda();
  const exacta = materias.find((m) => m.nombre === nombreMateria);
  if (exacta) return exacta;
  // Red de seguridad (2026-08-31): Gemini debe devolver el nombre oficial
  // EXACTO de la lista que se le pasó, pero un espacio de más, una
  // mayúscula distinta o un acento que se comió por el camino no debería
  // tirar "no pude identificar la materia" si en realidad es clarísimo cuál
  // es — match normalizado (sin acentos, minúsculas, espacios colapsados)
  // SOLO si resuelve a una única materia sin ambigüedad.
  const normalizada = normalizarTexto(nombreMateria).replace(/\s+/g, " ").trim();
  const candidatas = materias.filter(
    (m) => normalizarTexto(m.nombre).replace(/\s+/g, " ").trim() === normalizada
  );
  return candidatas.length === 1 ? candidatas[0] : null;
}

/**
 * Cruza el cambioModalidad que devolvió Gemini contra datos REALES de
 * Horario — nunca se confía en que "dia"/"materia" sean válidos solo
 * porque Gemini los devolvió así (mismo principio que resolverMateriaVinculada
 * de arriba). Devuelve { ok: true, ...datos para armar la tarjeta y para
 * llamar a aplicarModalidadDia } o { ok: false, motivo } con un motivo en
 * texto listo para mostrar en el chat.
 *
 * Si la materia tiene más de un bloque con clase ese mismo día (ej. teoría
 * y práctica), se toma el primero que aparezca en bloques_horario — caso
 * borde no resuelto con más precisión porque el prompt no le pide a Gemini
 * distinguir grupos/bloques, solo materia+día.
 */
function resolverCambioModalidad(cambioModalidad) {
  if (!cambioModalidad) return { ok: false, motivo: "No entendí bien qué cambio de modalidad quieres hacer." };

  const materiaVinculada = resolverMateriaVinculada(cambioModalidad.materia);
  if (!materiaVinculada) {
    return { ok: false, motivo: "No pude identificar de forma clara a qué materia te refieres." };
  }

  const idxDiaSemana = indiceDiaSemanaDesdeNombre(cambioModalidad.dia);
  if (idxDiaSemana === null) {
    return { ok: false, motivo: "No reconocí el día que mencionaste." };
  }
  const diaCodigo = DIAS_SEMANA_CONFIG[(idxDiaSemana + 6) % 7].abrevDefault;

  const modalidadNueva = MODALIDADES_VALIDAS_ASISTENTE.includes(cambioModalidad.modalidadNueva)
    ? cambioModalidad.modalidadNueva
    : null;
  if (!modalidadNueva) {
    return { ok: false, motivo: "No reconocí la modalidad nueva que pediste." };
  }

  const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
  if (!semestre || !mm) {
    return { ok: false, motivo: "Esa materia ya no está matriculada en el semestre actual." };
  }

  const bloque = (semestre.bloques_horario || []).find(
    (b) => b.materia_id === mm.materia_id && b.plan_estudio_id === mm.plan_estudio_id && (b.dias || []).some((d) => d.dia === diaCodigo)
  );
  if (!bloque) {
    return { ok: false, motivo: `${materiaVinculada.nombre} no tiene clase los ${cambioModalidad.dia} según tu Horario.` };
  }
  const diaPlantilla = bloque.dias.find((d) => d.dia === diaCodigo);
  const modalidadActual = diaPlantilla.modalidad || "presencial";

  // Próxima fecha real en la que cae ese día de la semana (hoy cuenta como
  // válido si hoy mismo es ese día) — mismo horizonte de 14 días que ya usa
  // construirContextoProximasClases más arriba.
  const hoy = new Date();
  let fechaObjetivo = null;
  for (let offset = 0; offset <= 13; offset++) {
    const candidata = new Date(hoy);
    candidata.setDate(candidata.getDate() + offset);
    if (candidata.getDay() === idxDiaSemana) {
      fechaObjetivo = candidata;
      break;
    }
  }
  if (!fechaObjetivo) {
    return { ok: false, motivo: "No pude calcular la próxima fecha de esa clase." };
  }

  const numeroSemana = calcularNumeroSemanaSinAcotarParaFecha(semestre, fechaObjetivo);
  if (numeroSemana == null || numeroSemana < 1) {
    return { ok: false, motivo: "Esa fecha cae fuera del rango de semanas del semestre." };
  }

  return {
    ok: true,
    materiaVinculada,
    semestreId: semestre.id,
    bloqueId: bloque.id,
    diaCodigo,
    diaNombre: cambioModalidad.dia,
    fechaObjetivo,
    numeroSemana,
    modalidadActual,
    modalidadNueva,
  };
}

/**
 * Rango de fechas (Date, inicio/fin ambos inclusive) para "consulta" de
 * tareas_eventos (2026-08-29, bug real: "qué tareas tengo esta semana"/
 * "semana 8" caían al fallback conversacional sin acceso real a los datos).
 *
 * - `numeroSemana` puntual (el usuario dijo "semana 8"): se calcula sobre
 *   el SEMESTRE ACTIVO (obtenerSemestreActivoAgenda — mismo criterio que ya
 *   usa el resto de Agenda para "Semana N", ver agenda-utils.js) con la
 *   misma fórmula (fecha_inicio + (N-1)*7 días) que ya usa
 *   construirContextoSemanasSemestres para la tabla que ve Gemini — Gemini
 *   NUNCA calcula la fecha acá, solo dice qué número de semana mencionó el
 *   usuario (o null), este cálculo es 100% determinístico en JS.
 * - `numeroSemana` null (el usuario no mencionó una semana puntual, ej.
 *   "esta semana"): usa obtenerFechaInicioSemanaAgenda(0), la MISMA función
 *   que ya usa la vista Lista de Agenda para decidir qué es "esta semana"
 *   ahora mismo — así una consulta del Asistente siempre coincide con lo
 *   que el usuario ya ve en Agenda, en vez de inventar su propia noción de
 *   "semana calendario".
 *
 * Devuelve null si no hay semestre activo (usuario sin semestres
 * seleccionados) y se pidió una semana puntual — no hay fecha_inicio de la
 * que partir.
 */
function resolverRangoConsulta(numeroSemana) {
  if (numeroSemana) {
    const semestre = obtenerSemestreActivoAgenda();
    if (!semestre) return null;
    const inicioSemestre = fechaLocalDesdeISO(semestre.fecha_inicio);
    if (isNaN(inicioSemestre.getTime())) return null;
    const inicio = new Date(inicioSemestre);
    inicio.setDate(inicio.getDate() + (numeroSemana - 1) * 7);
    const fin = new Date(inicio);
    fin.setDate(fin.getDate() + 6);
    return { inicio, fin, numeroSemana, etiqueta: `la semana ${numeroSemana}` };
  }
  const inicio = obtenerFechaInicioSemanaAgenda(0);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 6);
  return { inicio, fin, numeroSemana: null, etiqueta: "esta semana" };
}

/** "1 sep." — "7 sep." — para el encabezado de una consulta por semana. */
function formatearRangoConsulta(inicio, fin) {
  const opciones = { day: "numeric", month: "short" };
  const textoInicio = inicio.toLocaleDateString("es-CR", opciones).replace(/\.$/, "");
  const textoFin = fin.toLocaleDateString("es-CR", opciones).replace(/\.$/, "");
  return `${textoInicio} - ${textoFin}`;
}

/**
 * Nombres/género de cada tipo de ítem, para armar frases naturales en el
 * encabezado de "tareas_eventos" cuando el usuario pidió un tipo puntual
 * (2026-08-29: "tengo EXÁMENES para semana 8" → "tienes estos exámenes",
 * no el genérico "tienes estas 4 cosas" que antes mezclaba tareas y
 * exámenes sin distinguir).
 */
const FRASES_TIPO_ITEM = {
  examen: { singular: "examen", plural: "exámenes", genero: "m" },
  tarea: { singular: "tarea", plural: "tareas", genero: "f" },
  evento: { singular: "evento", plural: "eventos", genero: "m" },
};
const FRASES_TIPO_ITEM_PLURAL = Object.fromEntries(
  Object.entries(FRASES_TIPO_ITEM).map(([tipo, f]) => [tipo, f.plural])
);

/** "estos exámenes" / "esta tarea" / "este evento" — null si tipoItem es
 * null (caso genérico, "qué tengo" sin distinguir tipo). */
function fraseDemostrativaTipoItem(tipoItem, cantidad) {
  const f = FRASES_TIPO_ITEM[tipoItem];
  if (!f) return null;
  const plural = cantidad !== 1;
  const sustantivo = plural ? f.plural : f.singular;
  const demostrativo = f.genero === "f" ? (plural ? "estas" : "esta") : plural ? "estos" : "este";
  return `${demostrativo} ${sustantivo}`;
}

/**
 * Resuelve accion "consultar", tipo "tareas_eventos": lee DIRECTO
 * estado.datos.agenda (nunca se le pasa esta lista a Gemini — ver
 * comentario del schema) filtrando por el rango de fechas real
 * (resolverRangoConsulta), opcionalmente por materia (resolverMateriaVinculada,
 * mismo criterio anti-alucinación de siempre) y opcionalmente por tipo de
 * ítem (2026-08-29: "tengo EXÁMENES para semana 8" no debía traer tareas
 * también — mismo campo "tipoItem" que ya usaba "buscar_evento"). Devuelve
 * los eventos ordenados por fecha/hora — la UI
 * (mostrarResultadoConsultaEnChat) los pinta con crearTarjetaEventoGuardado,
 * la MISMA tarjeta editable/borrable que usa la creación, no una vista de
 * solo texto aparte.
 */
function resolverConsultaTareasEventos(consulta) {
  const materiaVinculada = consulta.materia ? resolverMateriaVinculada(consulta.materia) : null;
  if (consulta.materia && !materiaVinculada) {
    return { ok: false, motivo: "No pude identificar de forma clara a qué materia te refieres." };
  }
  const tipoItem = ["examen", "tarea", "evento"].includes(consulta.tipoItem) ? consulta.tipoItem : null;

  // "alcance": "todo" (2026-08-31, bug real: "todos los exámenes"/"todo el
  // semestre" seguía devolviendo solo la semana actual porque este resolver
  // nunca leía el campo — quedó agregado al schema/prompt en la ronda
  // anterior pero no conectado acá). Cuando aplica, se ignora
  // resolverRangoConsulta por completo (nunca se llama: no hay "semana" que
  // resolver) y se trae TODO estado.datos.agenda sin filtro de fecha, tal
  // cual pide el usuario con "TODO" — incluye pasado y futuro a propósito,
  // el filtro de materia/tipo sigue aplicando igual.
  if (consulta.alcance === "todo") {
    const eventos = (estado.datos.agenda || [])
      .filter((ev) => !materiaVinculada || ev.materiaMatriculadaId === materiaVinculada.mmId)
      .filter((ev) => !tipoItem || ev.tipo === tipoItem)
      .sort((a, b) => `${a.fecha} ${a.hora || ""}`.localeCompare(`${b.fecha} ${b.hora || ""}`));
    const rango = { inicio: null, fin: null, numeroSemana: null, etiqueta: "todo el semestre" };
    return { ok: true, rango, materiaVinculada, tipoItem, eventos };
  }

  const rango = resolverRangoConsulta(consulta.semana || null);
  if (!rango) {
    return { ok: false, motivo: "No tienes un semestre activo seleccionado para calcular esa semana." };
  }

  const inicioIso = fechaISODesdeLocal(rango.inicio);
  const finIso = fechaISODesdeLocal(rango.fin);
  const eventos = (estado.datos.agenda || [])
    .filter((ev) => ev.fecha >= inicioIso && ev.fecha <= finIso)
    .filter((ev) => !materiaVinculada || ev.materiaMatriculadaId === materiaVinculada.mmId)
    .filter((ev) => !tipoItem || ev.tipo === tipoItem)
    .sort((a, b) => `${a.fecha} ${a.hora || ""}`.localeCompare(`${b.fecha} ${b.hora || ""}`));

  return { ok: true, rango, materiaVinculada, tipoItem, eventos };
}

/**
 * Quita acentos y pasa a minúsculas — mismo criterio que ya usa
 * esSaludoSimple/indiceDiaSemanaDesdeNombre para comparar texto sin
 * depender de que el usuario (o Gemini) tilden igual.
 */
function normalizarTexto(texto) {
  return String(texto || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/**
 * Convierte ordinales en palabras a número (para poder reconocer "Tercer
 * Parcial" tanto si el usuario dice "el tercer parcial" como si el ítem
 * guardado usa el dígito, ej. "Parcial 3").
 */
const PALABRAS_ORDINALES_A_NUMERO = {
  primero: 1, primer: 1, segundo: 2, tercero: 3, tercer: 3, cuarto: 4,
  quinto: 5, sexto: 6, septimo: 7, octavo: 8, noveno: 9, decimo: 10,
};

/**
 * Números romanos I–XX (2026-08-29: "Parcial I" = "primer parcial" =
 * "Parcial 1" = "I parcial", todas la misma interpretación) — cubre el
 * rango normal de parciales/laboratorios/cotidianos, no hace falta más.
 */
const NUMEROS_A_ROMANO = [
  "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X",
  "XI", "XII", "XIII", "XIV", "XV", "XVI", "XVII", "XVIII", "XIX", "XX",
];

/** true si el nombre de un evento hace referencia a `numero`, ya sea como
 * dígito ("Parcial 3"), palabra ordinal ("Tercer Parcial") o número romano
 * ("Parcial III") — las tres formas son la misma interpretación. */
function nombreEventoMencionaNumero(nombreEvento, numero) {
  const normalizado = normalizarTexto(nombreEvento);
  if (new RegExp(`(^|\\D)${numero}(\\D|$)`).test(nombreEvento || "")) return true;
  const coincideOrdinalPalabra = Object.entries(PALABRAS_ORDINALES_A_NUMERO).some(
    ([palabra, num]) => num === numero && new RegExp(`\\b${palabra}\\b`).test(normalizado)
  );
  if (coincideOrdinalPalabra) return true;
  const romano = NUMEROS_A_ROMANO[numero];
  return !!romano && new RegExp(`\\b${romano}\\b`, "i").test(nombreEvento || "");
}

/**
 * "buscar_evento" busca UN ítem puntual por diseño — si aun así el filtro
 * no logra acotar a pocos candidatos (2026-08-29, bug real reportado: "el
 * primer parcial de derecho" devolvió 8 resultados de materias/tipos que no
 * tenían nada que ver, porque Gemini no resolvió bien "materia"/
 * "numeroOrdinal" en ese turno), NO se le muestran todos al usuario — se le
 * pide precisar en vez de volcarle una lista larga (pedido explícito: "no
 * quiero que me muestre todos si solo le pedí uno específico"). Esto es una
 * red de seguridad en JS, no reemplaza que Gemini resuelva bien materia/
 * número — solo evita el peor caso cuando no lo logra.
 */
const LIMITE_RESULTADOS_BUSQUEDA_EVENTO = 3;

/**
 * Resuelve accion "consultar", tipo "buscar_evento" (2026-08-29, bug real:
 * "¿cuándo es el tercer parcial de cálculo?" caía en "tareas_eventos" de la
 * semana actual porque ese era el único tipo que existía — no había forma
 * de pedir UN ítem puntual por nombre). Busca en TODO estado.datos.agenda
 * (sin límite de fecha/semana — quien pregunta "cuándo es X" no sabe de
 * antemano en qué semana cae), filtrando por materia (si se pidió), tipo de
 * ítem (si se pudo inferir) y las palabras clave del título — Gemini nunca
 * decide CUÁL ítem es el correcto, solo aporta los criterios de búsqueda;
 * la búsqueda real (y por lo tanto la fecha exacta que se muestra) sale
 * siempre de un evento real ya guardado, mismo principio anti-alucinación
 * de siempre.
 *
 * "numeroOrdinal" SOLO desempata cuando ya hay más de un candidato por
 * materia+tipo+palabrasClave — nunca descarta el único resultado que ya
 * matcheó por texto (ej. si el único examen de Cálculo que dice "parcial"
 * se llama "Tercer Parcial" sin dígito, igual se devuelve aunque el
 * desempate por número no lo reconozca).
 */
function resolverBusquedaEvento(consulta) {
  const materiaVinculada = consulta.materia ? resolverMateriaVinculada(consulta.materia) : null;
  if (consulta.materia && !materiaVinculada) {
    return { ok: false, motivo: "No pude identificar de forma clara a qué materia te refieres." };
  }
  const tipoItem = ["examen", "tarea", "evento"].includes(consulta.tipoItem) ? consulta.tipoItem : null;
  const palabrasClave = normalizarTexto(consulta.palabrasClave).split(/\s+/).filter(Boolean);
  const numeroOrdinal = Number.isFinite(consulta.numeroOrdinal) ? consulta.numeroOrdinal : null;

  let eventos = (estado.datos.agenda || [])
    .filter((ev) => !materiaVinculada || ev.materiaMatriculadaId === materiaVinculada.mmId)
    .filter((ev) => !tipoItem || ev.tipo === tipoItem)
    .filter((ev) => palabrasClave.every((palabra) => normalizarTexto(ev.nombre).includes(palabra)));

  if (numeroOrdinal !== null && eventos.length > 1) {
    const angostado = eventos.filter((ev) => nombreEventoMencionaNumero(ev.nombre, numeroOrdinal));
    if (angostado.length > 0) eventos = angostado;
  }

  eventos = eventos.slice().sort((a, b) => `${a.fecha} ${a.hora || ""}`.localeCompare(`${b.fecha} ${b.hora || ""}`));

  // "proximo" (2026-08-31, bug real: "cuánto falta para el próximo examen de
  // AP2" devolvía TODOS los exámenes de AP2 — pasados incluidos — porque
  // este resolver nunca leía el campo, aunque ya estaba en el schema/prompt
  // desde la ronda anterior. Acotar a partir de HOY (fecha de hoy incluida:
  // un examen de hoy sigue siendo "el próximo") y quedarse con el más
  // cercano — mismo criterio anti-alucinación de siempre: JS decide cuál es
  // "el próximo" comparando fechas reales, Gemini nunca lo calcula, solo
  // marca la intención.
  if (consulta.proximo) {
    const hoyIso = obtenerContextoFechaHoy().iso;
    eventos = eventos.filter((ev) => ev.fecha >= hoyIso);
    if (eventos.length > 0) eventos = eventos.slice(0, 1);
  }

  return { ok: true, materiaVinculada, tipoItem, proximo: !!consulta.proximo, eventos };
}

/**
 * Resuelve accion "consultar", tipo "modalidad_clase": SOLO LECTURA, nunca
 * cambia nada (a diferencia de resolverCambioModalidad, que arma la misma
 * búsqueda pero para preparar un cambio). Mismo horizonte de 14 días hacia
 * adelante que construirContextoProximasClases/resolverCambioModalidad.
 *
 * 2026-08-29: usa la modalidad EFECTIVA de esa semana puntual
 * (obtenerClasesEfectivasSemana, core/schema.js — fusiona la plantilla con
 * el Cronograma), no la de plantilla — si esa semana ya tiene una
 * excepción aplicada (ej. por resolverCambioModalidad/editar_modalidad,
 * más arriba), la consulta refleja el cambio real, no lo que dice el
 * Horario "normal".
 */
function resolverConsultaModalidad(materiaNombre, diaNombreOpcional) {
  const materiaVinculada = resolverMateriaVinculada(materiaNombre);
  if (!materiaVinculada) {
    return { ok: false, motivo: "No pude identificar de forma clara a qué materia te refieres." };
  }
  const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
  if (!semestre || !mm) {
    return { ok: false, motivo: "Esa materia ya no está matriculada en el semestre actual." };
  }

  let diaCodigoFijo = null;
  if (diaNombreOpcional) {
    const idxDiaSemana = indiceDiaSemanaDesdeNombre(diaNombreOpcional);
    if (idxDiaSemana === null) return { ok: false, motivo: "No reconocí el día que mencionaste." };
    diaCodigoFijo = DIAS_SEMANA_CONFIG[(idxDiaSemana + 6) % 7].abrevDefault;
    const tieneClaseEseDia = (semestre.bloques_horario || []).some(
      (b) =>
        b.materia_id === mm.materia_id &&
        b.plan_estudio_id === mm.plan_estudio_id &&
        (b.dias || []).some((d) => d.dia === diaCodigoFijo)
    );
    if (!tieneClaseEseDia) {
      return { ok: false, motivo: `${materiaVinculada.nombre} no tiene clase los ${diaNombreOpcional} según tu Horario.` };
    }
  }

  const hoy = new Date();
  let fechaObjetivo = null;
  let codigoEncontrado = null;
  for (let offset = 0; offset <= 13; offset++) {
    const candidata = new Date(hoy);
    candidata.setDate(candidata.getDate() + offset);
    const codigoCandidata = DIAS_SEMANA_CONFIG[(candidata.getDay() + 6) % 7].abrevDefault;
    if (diaCodigoFijo && codigoCandidata !== diaCodigoFijo) continue;
    const tieneClase = (semestre.bloques_horario || []).some(
      (b) =>
        b.materia_id === mm.materia_id &&
        b.plan_estudio_id === mm.plan_estudio_id &&
        (b.dias || []).some((d) => d.dia === codigoCandidata)
    );
    if (!tieneClase) continue;
    fechaObjetivo = candidata;
    codigoEncontrado = codigoCandidata;
    break;
  }
  if (!fechaObjetivo) {
    return {
      ok: false,
      motivo: `No encontré una próxima clase de ${materiaVinculada.nombre}${diaNombreOpcional ? ` los ${diaNombreOpcional}` : ""} en los próximos 14 días.`,
    };
  }

  const bloque = (semestre.bloques_horario || []).find(
    (b) =>
      b.materia_id === mm.materia_id &&
      b.plan_estudio_id === mm.plan_estudio_id &&
      (b.dias || []).some((d) => d.dia === codigoEncontrado)
  );

  // Modalidad EFECTIVA de esa semana puntual, no la de plantilla — ver
  // comentario de la función. numeroSemana calculado con la misma función
  // que ya usa resolverCambioModalidad para lo mismo (fechaObjetivo puede
  // caer en la semana actual o la siguiente, según qué tan lejos esté el
  // próximo día de clase).
  const numeroSemana = calcularNumeroSemanaSinAcotarParaFecha(semestre, fechaObjetivo);
  const claseEfectiva = obtenerClasesEfectivasSemana(bloque, numeroSemana).find((c) => c.dia === codigoEncontrado);
  // Fallback defensivo a la plantilla si por lo que sea la semana calculada
  // no trae esa clase (no debería pasar: ya se confirmó arriba que ese día
  // tiene clase en el bloque) — mejor mostrar algo que romper la consulta.
  const diaPlantilla = bloque.dias.find((d) => d.dia === codigoEncontrado);
  const modalidad = (claseEfectiva && claseEfectiva.modalidad) || diaPlantilla.modalidad || "presencial";

  return {
    ok: true,
    materiaVinculada,
    fechaObjetivo,
    diaNombre: nombreDiaDesdeCodigo(codigoEncontrado),
    modalidad,
  };
}

/** "L" | "K" | "M" | "J" | "V" | "S" | "D" real de una fecha "YYYY-MM-DD". */
function codigoDiaDesdeFecha(fechaIso) {
  const fecha = fechaLocalDesdeISO(fechaIso);
  return DIAS_SEMANA_CONFIG[(fecha.getDay() + 6) % 7].abrevDefault;
}

/**
 * Nombre en español ("jueves") de un código de día de DIAS_SEMANA_CONFIG
 * ("L"/"K"/etc, según abrevDefault) — inverso de codigoDiaDesdeFecha,
 * agregado para editar_modalidad (2026-08-29): necesito mostrarle al
 * usuario en la tarjeta de confirmación el nombre del día, partiendo de un
 * código de bloque.dias, no de una fecha. Mismo giro (+1)%7 que ya usa
 * codigoDiaDesdeFecha para pasar de DIAS_SEMANA_CONFIG (lunes=0..domingo=6)
 * a Date.getDay()/NOMBRES_DIA_SEMANA (domingo=0..sábado=6), solo que acá al
 * revés.
 */
function nombreDiaDesdeCodigo(codigo) {
  const idx = DIAS_SEMANA_CONFIG.findIndex((d) => d.abrevDefault === codigo);
  return idx === -1 ? null : NOMBRES_DIA_SEMANA[(idx + 1) % 7];
}

/**
 * Índice de Date.getDay() (0=domingo..6=sábado) de un nombre de día en
 * español, sin sensibilidad a acentos/mayúsculas (Gemini debería devolver
 * el nombre tal cual salió del prompt, pero no hay que confiar 100% en
 * eso). null si no matchea ninguno de los 7.
 */
function indiceDiaSemanaDesdeNombre(nombre) {
  const normalizado = String(nombre || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const idx = NOMBRES_DIA_SEMANA.findIndex(
    (n) => n.normalize("NFD").replace(/[\u0300-\u036f]/g, "") === normalizado
  );
  return idx === -1 ? null : idx;
}

/**
 * Default de hora pedido explícitamente: si la materia quedó vinculada y el
 * usuario no dijo una hora puntual, se busca a qué hora arranca esa materia
 * ESE día de la semana según los bloques reales de Horario (semestre.
 * bloques_horario, ver crearBloqueHorario/obtenerClasesEfectivasSemana en
 * core/schema.js). Si hay más de un bloque ese día (raro, pero posible con
 * grupos/laboratorios aparte), se toma el más temprano. null si no hay
 * materia vinculada o no hay clase ese día — el evento queda "todo el día",
 * nunca se inventa una hora.
 */
function resolverHoraDefaultDesdeHorario(materiaVinculada, fechaIso) {
  if (!materiaVinculada) return null;
  const semestre = (estado.datos.semestres || []).find((s) => s.id === materiaVinculada.semestreId);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === materiaVinculada.mmId);
  if (!semestre || !mm) return null;

  const codigoDia = codigoDiaDesdeFecha(fechaIso);
  const horasDelDia = (semestre.bloques_horario || [])
    .filter((b) => b.materia_id === mm.materia_id && b.plan_estudio_id === mm.plan_estudio_id)
    .flatMap((b) => (b.dias || []).filter((d) => d.dia === codigoDia).map((d) => d.hora_inicio))
    .filter(Boolean)
    .sort();

  return horasDelDia[0] || null;
}

/** "2026-08-22" -> "Martes 22 de agosto del 2026" — nunca el ISO crudo. */
function formatearFechaLarga(fechaIso) {
  const fecha = fechaLocalDesdeISO(fechaIso);
  const texto = fecha.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "long" }).replace(",", "");
  return `${texto.charAt(0).toUpperCase()}${texto.slice(1)} del ${fecha.getFullYear()}`;
}

/**
 * "Agregado por asistente" SIEMPRE en la primera línea, y solo si el
 * usuario pidió explícitamente guardar algo puntual (Gemini ya filtra esto
 * en el prompt, nunca inventa notas) va en la línea de abajo.
 */
function construirNotasFinal(notasUsuario) {
  return notasUsuario ? `Agregado por asistente\n${notasUsuario}` : "Agregado por asistente";
}

/**
 * Guarda de una un ítem extraído como EventoAgenda real — ya NO pasa por el
 * modal, el usuario revisa/edita/borra desde la tarjeta del chat (ver
 * crearTarjetaEventoGuardado) usando el mismo modal real de Agenda
 * (abrirModalEventoAgenda/confirmarBorrarEventoAgenda, ya expuestos por
 * agenda-modal.js) — nunca se duplica esa lógica acá. Devuelve el id del
 * evento recién creado.
 */
function guardarItemExtraidoComoEvento(item, googleTaskId = null) {
  const materiaVinculada = resolverMateriaVinculada(item.materia);
  const horaFinal = item.hora || resolverHoraDefaultDesdeHorario(materiaVinculada, item.fecha);

  estado.datos.agenda = estado.datos.agenda || [];
  const evento = crearEventoAgenda({
    tipo: item.tipo,
    nombre: item.nombre,
    fecha: item.fecha,
    hora: horaFinal,
    materiaMatriculadaId: materiaVinculada ? materiaVinculada.mmId : null,
    semestreId: materiaVinculada ? materiaVinculada.semestreId : null,
    notas: construirNotasFinal(item.notas),
    // item.esFeriado puede venir undefined si Gemini omitió el campo (no es
    // "required" en el schema) — se trata como false, nunca se asume feriado
    // por default.
    esFeriado: item.esFeriado === true,
    // googleTaskId (2026-08-23, integración Google Tasks): null para el
    // chat en vivo y para Bandeja Pendiente — solo agenda-google-tasks.js
    // lo pasa, para dejar trazabilidad de qué tarea de Google originó este
    // evento (ver comentario completo en crearEventoAgenda, schema.js).
    googleTaskId,
  });
  estado.datos.agenda.push(evento);

  marcarCambioPendiente();
  programarRecordatorioPush(evento);
  window.renderizarAgenda?.();
  window.renderizarResumen?.();

  return evento.id;
}

/* ===================== UI: burbujas y tarjetas ===================== */

function crearBurbuja(rol, texto, esError = false) {
  const div = document.createElement("div");
  const esUsuario = rol === "usuario";
  div.style.cssText = `
    max-width: 82%;
    padding: 9px 13px;
    border-radius: 14px;
    white-space: pre-wrap;
    word-break: break-word;
    align-self: ${esUsuario ? "flex-end" : "flex-start"};
    background: ${esUsuario ? "var(--color-luz, #6d5efc)" : "var(--bg-panel, rgba(148,163,184,0.15))"};
    color: ${esUsuario ? "#fff" : "inherit"};
    border: 1px solid ${esError ? "var(--color-danger, #dc2626)" : esUsuario ? "transparent" : "var(--border-glass, rgba(148,163,184,0.25))"};
    border-bottom-right-radius: ${esUsuario ? "4px" : "14px"};
    border-bottom-left-radius: ${esUsuario ? "14px" : "4px"};
  `;
  div.textContent = texto;
  return div;
}

/**
 * Corrección 2026-08-29: los ejemplos NO van como 12 chips clicables — es
 * un único ejemplo, elegido al azar de PLANTILLAS_EJEMPLOS_BIENVENIDA_WAPPER
 * (ya con la materia real sustituida), mostrado como texto plano ("Ejemplo:
 * ..."), sin botón ni acción de click. Se usa tanto para la línea debajo
 * del saludo (mostrarSaludoInicial) como para el placeholder del input
 * (construirEsqueletoAsistente) — cada uno pide su propio random
 * independiente, así que normalmente no van a coincidir entre sí.
 */
function elegirEjemploBienvenidaAlAzar() {
  const ejemplos = construirEjemplosBienvenida();
  return ejemplos[Math.floor(Math.random() * ejemplos.length)];
}

function crearIndicadorEscribiendo() {
  const div = document.createElement("div");
  div.style.cssText = `
    align-self: flex-start;
    padding: 9px 13px;
    border-radius: 14px;
    border: 1px solid var(--border-glass, rgba(148,163,184,0.25));
    background: var(--bg-panel, rgba(148,163,184,0.15));
    font-style: italic;
  `;
  div.className = "muted";
  div.textContent = "Pensando…";
  return div;
}

/**
 * Tarjeta de UN evento YA guardado en Agenda (ver guardarItemExtraidoComoEvento)
 * — se relee siempre por id contra estado.datos.agenda, nunca contra el item
 * crudo de Gemini, para que si el usuario lo edita desde acá (Editar abre el
 * modal REAL, mismo que usa Agenda) la próxima vez que se reconstruya esta
 * tarjeta (ver reconstruirChatDesdeHistorial) se vea el dato actualizado, y
 * para poder detectar que ya no existe si lo borró.
 */
function crearTarjetaEventoGuardado(eventoId) {
  const card = document.createElement("div");
  card.className = "glass-card stack";
  card.style.cssText = "align-self: stretch; padding: 10px 12px; gap: 6px;";

  const evento = (estado.datos.agenda || []).find((ev) => ev.id === eventoId);
  if (!evento) {
    const p = document.createElement("div");
    p.className = "muted";
    p.textContent = "Este ítem ya no existe (se eliminó).";
    card.appendChild(p);
    return card;
  }

  // Feriado tiene prioridad visual sobre tipo — un feriado marcado como
  // "evento" (caso normal) NUNCA debe verse igual (📌) que un evento
  // cualquiera, o se pierde la distinción que pidió el usuario.
  const emojiTipo = evento.esFeriado ? "🎉" : evento.tipo === "examen" ? "📝" : evento.tipo === "tarea" ? "✅" : "📌";
  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  titulo.textContent = `${emojiTipo} ${evento.nombre}`;
  card.appendChild(titulo);

  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.fontSize = "0.85rem";
  const partes = [formatearFechaLarga(evento.fecha), evento.hora ? formatearHoraAmPm(evento.hora) : "Todo el día"];
  if (evento.esFeriado) partes.push("Feriado");
  const nombreMateria = obtenerNombreMateriaEvento(evento);
  if (nombreMateria) partes.push(nombreMateria);
  detalle.textContent = partes.join(" · ");
  card.appendChild(detalle);

  if (evento.notas) {
    const notas = document.createElement("div");
    notas.className = "muted";
    notas.style.fontSize = "0.82rem";
    notas.style.whiteSpace = "pre-wrap";
    notas.textContent = evento.notas;
    card.appendChild(notas);
  }

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.cssText = "gap:6px; justify-content:flex-end;";

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn-discreto";
  btnEditar.style.flex = "none";
  btnEditar.textContent = "Editar";
  btnEditar.onclick = () => abrirModalEventoAgenda({ eventoId: evento.id });
  filaBotones.appendChild(btnEditar);

  const btnEliminar = document.createElement("button");
  btnEliminar.className = "btn-discreto btn-discreto-peligro";
  btnEliminar.style.flex = "none";
  btnEliminar.textContent = "Eliminar";
  // onBorrado (segundo argumento, ver agenda-modal.js) solo dispara si de
  // verdad se confirmó el borrado en el diálogo — recién ahí esta tarjeta
  // puntual pasa a "Eliminado" al toque, sin esperar a reabrir Asistente.
  btnEliminar.onclick = () => {
    confirmarBorrarEventoAgenda(evento, () => marcarTarjetaComoEliminada(card));
  };
  filaBotones.appendChild(btnEliminar);

  card.appendChild(filaBotones);
  return card;
}

/**
 * Reemplaza el contenido de una tarjeta ya guardada por un estado visual
 * "Eliminado" — se llama SOLO desde el callback onBorrado de
 * confirmarBorrarEventoAgenda (ver arriba), nunca antes de que el borrado
 * sea real.
 */
function marcarTarjetaComoEliminada(card) {
  card.innerHTML = "";
  card.style.opacity = "0.55";
  const p = document.createElement("div");
  p.className = "muted";
  p.textContent = "🗑️ Eliminado";
  card.appendChild(p);
}

/**
 * `resolverCambioModalidad` devuelve `fechaObjetivo` como Date real — no
 * serializable tal cual en el turno que va a `guardarHistorialLocal`
 * (localStorage guarda texto). Estas dos son el ida/vuelta para poder
 * congelar la decisión resuelta UNA sola vez (ver mostrarResultadoModalidadEnChat)
 * y reconstruirla igual de la primera vez, sin volver a llamar
 * resolverCambioModalidad contra el estado actual de Horario/materias, que
 * puede haber cambiado desde entonces (mismo criterio que ya usa
 * eventosGuardados para no volver a crear ítems al reconstruir).
 */
function serializarResueltoModalidad(resuelto) {
  const { fechaObjetivo, ...resto } = resuelto;
  return { ...resto, fechaObjetivoIso: fechaISODesdeLocal(fechaObjetivo) };
}

function deserializarResueltoModalidad(serializado) {
  const { fechaObjetivoIso, ...resto } = serializado;
  return { ...resto, fechaObjetivo: fechaLocalDesdeISO(fechaObjetivoIso) };
}

/**
 * Tarjeta de confirmación para editar_modalidad — a diferencia de
 * crearTarjetaEventoGuardado (que muestra algo YA guardado, con
 * Editar/Eliminar), esta tarjeta se muestra ANTES de aplicar nada: el
 * cambio real (aplicarModalidadDia) recién se dispara si el usuario toca
 * "Aplicar cambio". Nunca se aplica solo por mostrarse en pantalla.
 *
 * `estadoInicial`: "pendiente" | "aplicado" | "cancelado" — al reconstruir
 * desde historial (ver reconstruirChatDesdeHistorial) puede venir ya
 * decidido; en ese caso la tarjeta se pinta directo en su estado final,
 * SIN botones, y sin volver a llamar aplicarModalidadDia (esa función solo
 * se llama una vez, al click real de "Aplicar cambio").
 *
 * `onDecision(estadoNuevo)`: callback para que el caller persista el
 * cambio de estado en conversacionActual + historial local.
 */
function crearTarjetaConfirmacionModalidad(resuelto, estadoInicial, onDecision) {
  const card = document.createElement("div");
  card.className = "glass-card stack";
  card.style.cssText = "align-self: stretch; padding: 10px 12px; gap: 6px;";

  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  const diaCapitalizado = resuelto.diaNombre.charAt(0).toUpperCase() + resuelto.diaNombre.slice(1);
  titulo.textContent = `📅 ${resuelto.materiaVinculada.nombre}, ${diaCapitalizado}`;
  card.appendChild(titulo);

  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.fontSize = "0.85rem";
  detalle.textContent = `${obtenerEtiquetaModalidad(resuelto.modalidadActual)} → ${obtenerEtiquetaModalidad(resuelto.modalidadNueva)} · ${formatearFechaLarga(fechaISODesdeLocal(resuelto.fechaObjetivo))}`;
  card.appendChild(detalle);

  const zonaAccion = document.createElement("div");
  card.appendChild(zonaAccion);

  function pintarEstado(estado) {
    zonaAccion.innerHTML = "";
    if (estado === "pendiente") {
      const filaBotones = document.createElement("div");
      filaBotones.className = "row";
      filaBotones.style.cssText = "gap:6px; justify-content:flex-end; margin-top:2px;";

      const btnCancelar = document.createElement("button");
      btnCancelar.className = "btn-discreto";
      btnCancelar.style.flex = "none";
      btnCancelar.textContent = "Cancelar";
      btnCancelar.onclick = () => {
        pintarEstado("cancelado");
        onDecision("cancelado");
      };
      filaBotones.appendChild(btnCancelar);

      const btnAplicar = document.createElement("button");
      btnAplicar.className = "btn btn-primary";
      btnAplicar.style.flex = "none";
      btnAplicar.textContent = "Aplicar cambio";
      btnAplicar.onclick = () => {
        aplicarModalidadDia(resuelto.bloqueId, resuelto.semestreId, resuelto.numeroSemana, resuelto.diaCodigo, resuelto.modalidadNueva);
        pintarEstado("aplicado");
        onDecision("aplicado");
      };
      filaBotones.appendChild(btnAplicar);
      zonaAccion.appendChild(filaBotones);
      return;
    }

    const p = document.createElement("div");
    p.className = "muted";
    p.style.fontSize = "0.82rem";
    p.textContent = estado === "aplicado" ? "✅ Cambio aplicado" : "Cambio cancelado";
    zonaAccion.appendChild(p);
  }

  pintarEstado(estadoInicial || "pendiente");
  return card;
}

function agregarBurbujaAlDom(elemento) {
  const cont = document.getElementById("asistente-chat-scroll");
  if (!cont) return;
  cont.appendChild(elemento);
  cont.scrollTop = cont.scrollHeight;
}

/**
 * Rama "crear_eventos" de mostrarResultadoEnChat (ver ahí el contrato de
 * `turno`) — comportamiento sin cambios respecto de antes de
 * "editar_modalidad", solo que ahora lee/escribe `turno.eventosGuardados`
 * directo en vez de recibirlo/devolverlo como parámetro/retorno aparte.
 */
async function mostrarResultadoEventosEnChat(resultado, turno, textoUsuario) {
  if (resultado.items.length === 0 && resultado.aclaracion) {
    agregarBurbujaAlDom(crearBurbuja("modelo", resultado.aclaracion));
    return;
  }
  if (resultado.items.length === 0) {
    // Charla suelta sin tarea/examen/evento reconocible (punto 3,
    // personalidad Wapper): respuesta en su voz, generada aparte de la
    // extracción (ver generarRespuestaConversacionalWapper). Se genera UNA
    // sola vez por turno y se congela en `turno.respuestaConversacional`
    // (mismo criterio que `eventosGuardados`/`cambioModalidadResuelto`) —
    // si `textoUsuario` no viene (reconstrucción desde historial), nunca
    // se vuelve a llamar a Gemini, se usa directo el respaldo estático.
    if (typeof turno.respuestaConversacional !== "string") {
      turno.respuestaConversacional = textoUsuario
        ? (await generarRespuestaConversacionalWapper(textoUsuario)) || MENSAJE_FALLBACK_WAPPER
        : MENSAJE_FALLBACK_WAPPER;
    }
    agregarBurbujaAlDom(crearBurbuja("modelo", turno.respuestaConversacional));
    return;
  }

  const resumen = resultado.items.length === 1 ? "Guardé esto en tu Agenda:" : `Guardé ${resultado.items.length} cosas en tu Agenda:`;
  agregarBurbujaAlDom(crearBurbuja("modelo", resumen));

  // Array.isArray(turno.eventosGuardados): CRÍTICO para no duplicar
  // guardados. En vivo el turno llega recién creado (sin este campo) → acá
  // mismo se crean los eventos reales (guardarItemExtraidoComoEvento) y sus
  // ids quedan en el turno para que guardarHistorialLocal los persista. Al
  // reconstruir desde historial (reabrir Asistente con una conversación
  // reciente) YA existen esos eventos — vienen los ids guardados en el
  // propio turno, así que acá NUNCA se vuelve a llamar
  // guardarItemExtraidoComoEvento, solo se re-renderizan las tarjetas
  // contra el estado real actual (ver crearTarjetaEventoGuardado). Un turno
  // de un historial guardado ANTES de que este campo existiera tampoco lo
  // tiene — cae al mismo camino de "crear de nuevo" que el turno en vivo;
  // ventana real de choque: menos de 1 hora desde el deploy de ese fix (ver
  // VIGENCIA_HISTORIAL_MS), después ya no puede pasar.
  const eventosGuardados = Array.isArray(turno.eventosGuardados)
    ? turno.eventosGuardados
    : resultado.items.map((item) => guardarItemExtraidoComoEvento(item));
  turno.eventosGuardados = eventosGuardados;

  eventosGuardados.forEach((id) => agregarBurbujaAlDom(crearTarjetaEventoGuardado(id)));
}

/**
 * Rama "editar_modalidad" de mostrarResultadoEnChat — agregada 2026-08-29.
 * Nunca aplica el cambio sola: solo resuelve contra datos reales de Horario
 * (resolverCambioModalidad) y pinta la tarjeta de confirmación
 * (crearTarjetaConfirmacionModalidad); el cambio real solo se dispara si el
 * usuario toca "Aplicar cambio" en esa tarjeta.
 *
 * `turno.cambioModalidadResuelto`: la decisión resuelta, CONGELADA la
 * primera vez (turno en vivo, `cambioModalidadResuelto` todavía no existe)
 * y nunca vuelta a calcular al reconstruir desde historial — igual que
 * `eventosGuardados` de arriba, pero acá importa más: si se recalculara en
 * cada reconstrucción, un cambio posterior en Horario (la materia se borró,
 * ese día ya no tiene clase, etc.) podría hacer que la MISMA tarjeta
 * muestre un mensaje distinto al que el usuario vio la primera vez, o que
 * "Aplicar cambio" ya no sepa a qué bloque/semana apuntar.
 *
 * `turno.estadoModalidad`: "pendiente" (default) | "aplicado" | "cancelado"
 * — se actualiza en el callback `onDecision` de la tarjeta y se persiste al
 * toque (guardarHistorialLocal), para que reabrir el chat dentro de la 1h
 * de vigencia del historial muestre la tarjeta ya en su estado final, sin
 * botones y sin poder volver a aplicar el mismo cambio dos veces.
 */
function mostrarResultadoModalidadEnChat(resultado, turno) {
  if (resultado.aclaracion) {
    agregarBurbujaAlDom(crearBurbuja("modelo", resultado.aclaracion));
    return;
  }

  if (!turno.cambioModalidadResuelto) {
    const resuelto = resolverCambioModalidad(resultado.cambioModalidad);
    if (!resuelto.ok) {
      agregarBurbujaAlDom(crearBurbuja("modelo", resuelto.motivo));
      return;
    }
    turno.cambioModalidadResuelto = serializarResueltoModalidad(resuelto);
  }

  agregarBurbujaAlDom(
    crearTarjetaConfirmacionModalidad(
      deserializarResueltoModalidad(turno.cambioModalidadResuelto),
      turno.estadoModalidad || "pendiente",
      (nuevoEstado) => {
        turno.estadoModalidad = nuevoEstado;
        guardarHistorialLocal();
      }
    )
  );
}

/**
 * Rama "consultar" de mostrarResultadoEnChat — agregada 2026-08-29 (bug
 * real: preguntas de solo lectura como "qué tareas tengo esta semana" o
 * "qué modalidad es mi próxima clase de bd" caían al fallback conversacional
 * de Wapper, que no tiene acceso real a los datos y por eso respondía "no
 * tengo acceso"). Nunca crea ni cambia nada — solo lee.
 *
 * `turno.consultaEventoIds` (tipo "tareas_eventos"): ids ya resueltos la
 * primera vez, mismo patrón que `eventosGuardados` — reabrir el chat
 * reusa los mismos ids y los vuelve a pintar contra el estado REAL actual
 * (crearTarjetaEventoGuardado ya maneja el caso de que se haya borrado
 * uno). `turno.consultaModalidadResuelto` (tipo "modalidad_clase"): el
 * resultado de solo-lectura ya congelado, sin objetos Date (ver
 * serializarResueltoModalidad/deserializarResueltoModalidad, mismo
 * patrón).
 */
/**
 * "faltan 6 días" / "es hoy" / "fue hace 2 días" — usa fechaLocalDesdeISO
 * (mismo helper que ya usa todo el archivo para no pelear con zona
 * horaria) contra la fecha real de HOY en el momento de pintar el mensaje,
 * nunca congelada — así "cuántos días faltan" sigue siendo correcto si el
 * chat se reabre días después.
 */
function formatearDiasFaltantes(fechaEventoIso) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const fechaEvento = fechaLocalDesdeISO(fechaEventoIso);
  const diffDias = Math.round((fechaEvento - hoy) / 86400000);
  if (diffDias === 0) return "es hoy";
  if (diffDias > 0) return `falta${diffDias === 1 ? "" : "n"} ${diffDias} día${diffDias === 1 ? "" : "s"}`;
  const dias = Math.abs(diffDias);
  return `fue hace ${dias} día${dias === 1 ? "" : "s"}`;
}

/**
 * Punto extra (2026-08-29): "¿cuántos días faltan para el 3 parcial de
 * cálculo?" es el MISMO caso que "¿cuándo es...?" (buscar_evento) — no
 * agrego un campo nuevo al esquema de Gemini para distinguir la intención
 * (arriesgaría el parseo por poco beneficio); en vez de eso, la cuenta de
 * días SIEMPRE acompaña un resultado de buscar_evento con un único
 * ítem, sea que el usuario haya preguntado por la fecha o por los días
 * restantes — no hace daño mostrarla de más y cubre ambos casos con una
 * sola rama de código.
 */
function mostrarResultadoConsultaEnChat(resultado, turno) {
  if (resultado.aclaracion) {
    agregarBurbujaAlDom(crearBurbuja("modelo", resultado.aclaracion));
    return;
  }
  const consulta = resultado.consulta || {};

  if (consulta.tipo === "modalidad_clase") {
    if (!turno.consultaModalidadResuelto) {
      const resuelto = resolverConsultaModalidad(consulta.materia, consulta.dia);
      if (!resuelto.ok) {
        agregarBurbujaAlDom(crearBurbuja("modelo", resuelto.motivo));
        return;
      }
      turno.consultaModalidadResuelto = {
        materiaNombre: resuelto.materiaVinculada.nombre,
        fechaObjetivoIso: fechaISODesdeLocal(resuelto.fechaObjetivo),
        diaNombre: resuelto.diaNombre,
        modalidad: resuelto.modalidad,
      };
    }
    const r = turno.consultaModalidadResuelto;
    const diaCapitalizado = r.diaNombre.charAt(0).toUpperCase() + r.diaNombre.slice(1);
    agregarBurbujaAlDom(
      crearBurbuja(
        "modelo",
        `📅 ${r.materiaNombre} — ${diaCapitalizado} ${formatearFechaLarga(r.fechaObjetivoIso)}: ${obtenerEtiquetaModalidad(r.modalidad)}`
      )
    );
    return;
  }

  // tipo "tareas_eventos" o "buscar_evento" (default a "tareas_eventos" si
  // Gemini omitió "tipo" por algún motivo) — mismo render de tarjetas para
  // ambos, solo cambia cómo se resuelve la lista y el texto del encabezado.
  const esBusqueda = consulta.tipo === "buscar_evento";
  if (!Array.isArray(turno.consultaEventoIds) && !turno.consultaBusquedaDemasiados) {
    const resuelto = esBusqueda ? resolverBusquedaEvento(consulta) : resolverConsultaTareasEventos(consulta);
    if (!resuelto.ok) {
      agregarBurbujaAlDom(crearBurbuja("modelo", resuelto.motivo));
      return;
    }
    // Ver comentario de LIMITE_RESULTADOS_BUSQUEDA_EVENTO — "buscar_evento"
    // es por diseño UN ítem puntual, así que si igual salen demasiados
    // candidatos no se listan todos, se le pide precisar al usuario.
    if (esBusqueda && resuelto.eventos.length > LIMITE_RESULTADOS_BUSQUEDA_EVENTO) {
      turno.consultaBusquedaDemasiados = resuelto.eventos.length;
    } else {
      turno.consultaEventoIds = resuelto.eventos.map((ev) => ev.id);
      turno.consultaEsBusqueda = esBusqueda;
      if (esBusqueda) {
        // Para el caso "proximo" (ver resolverBusquedaEvento) el mensaje de
        // "no encontré nada" genérico ("revisa si está escrito distinto")
        // es engañoso cuando en realidad SÍ se entendió bien la pregunta y
        // simplemente no quedan ítems futuros — se guardan estos datos para
        // armar un mensaje correcto en ese caso puntual (ver abajo).
        turno.consultaBusquedaProximo = !!resuelto.proximo;
        turno.consultaTipoItem = resuelto.tipoItem || null;
        turno.consultaMateriaNombre = resuelto.materiaVinculada ? resuelto.materiaVinculada.nombre : null;
      } else {
        turno.consultaTipoItem = resuelto.tipoItem || null;
        // "alcance: todo" no tiene rango de fechas real (ver
        // resolverConsultaTareasEventos) — no hay "X - Y" que mostrar, solo
        // la etiqueta "todo el semestre" sola.
        turno.consultaRangoTexto = resuelto.rango.inicio
          ? `${resuelto.rango.etiqueta} (${formatearRangoConsulta(resuelto.rango.inicio, resuelto.rango.fin)})`
          : resuelto.rango.etiqueta;
      }
    }
  }

  if (turno.consultaBusquedaDemasiados) {
    agregarBurbujaAlDom(
      crearBurbuja(
        "modelo",
        `Encontré ${turno.consultaBusquedaDemasiados} coincidencias con eso — dime la materia o el nombre/número exacto para ubicar la que buscas.`
      )
    );
    return;
  }

  const eventosGuardados = turno.consultaEventoIds;
  if (eventosGuardados.length === 0) {
    const etiquetaTipoVacio = FRASES_TIPO_ITEM_PLURAL[turno.consultaTipoItem] || null;
    let mensajeVacio;
    if (turno.consultaEsBusqueda && turno.consultaBusquedaProximo) {
      // "proximo" sin resultados futuros: a diferencia de una búsqueda por
      // nombre que no matcheó nada (posible error de tipeo), acá SÍ se
      // entendió bien la pregunta — simplemente no queda ningún ítem futuro
      // que cumpla el filtro. Mismo tono positivo que ya usa la rama
      // "tareas_eventos" para su caso vacío, en vez de sugerir revisar la
      // ortografía.
      const etiquetaTipo = FRASES_TIPO_ITEM_PLURAL[turno.consultaTipoItem] || "cosas";
      const sufijoMateria = turno.consultaMateriaNombre ? ` de ${turno.consultaMateriaNombre}` : "";
      mensajeVacio = `¡Buenas noticias! No tienes más ${etiquetaTipo}${sufijoMateria} pendientes 🎉`;
    } else if (turno.consultaEsBusqueda) {
      mensajeVacio = "No encontré nada con ese nombre en tu Agenda — revisa si está escrito distinto, o dime la materia.";
    } else if (etiquetaTipoVacio) {
      mensajeVacio = `¡Buenas noticias! No tienes ${etiquetaTipoVacio} para ${turno.consultaRangoTexto || "esa semana"} 🎉`;
    } else {
      mensajeVacio = `No tienes nada guardado para ${turno.consultaRangoTexto || "esa semana"}.`;
    }
    agregarBurbujaAlDom(crearBurbuja("modelo", mensajeVacio));
    return;
  }

  let textoEncabezado;
  if (turno.consultaEsBusqueda) {
    if (eventosGuardados.length === 1) {
      const eventoEncontrado = (estado.datos.agenda || []).find((ev) => ev.id === eventosGuardados[0]);
      const sufijoDias = eventoEncontrado ? ` (${formatearDiasFaltantes(eventoEncontrado.fecha)})` : "";
      textoEncabezado = `Encontré esto${sufijoDias}:`;
    } else {
      textoEncabezado = `Encontré ${eventosGuardados.length} coincidencias:`;
    }
  } else {
    const fraseTipo = fraseDemostrativaTipoItem(turno.consultaTipoItem, eventosGuardados.length);
    textoEncabezado = `Para ${turno.consultaRangoTexto} tienes ${
      fraseTipo || (eventosGuardados.length === 1 ? "esto" : `estas ${eventosGuardados.length} cosas`)
    }:`;
  }
  agregarBurbujaAlDom(crearBurbuja("modelo", textoEncabezado));
  eventosGuardados.forEach((id) => agregarBurbujaAlDom(crearTarjetaEventoGuardado(id)));
}

/**
 * Muestra en el chat el resultado ya interpretado de un turno de Gemini —
 * la usan tanto el envío en vivo (manejarEnvioMensaje) como la
 * reconstrucción desde historial (reconstruirChatDesdeHistorial). Rama por
 * `resultado.accion` a una de las tres funciones de arriba.
 *
 * `turno`: el objeto REAL de conversacionActual (o el reconstruido desde
 * historial.turnos) para este turno de "modelo" — YA debe estar en el
 * array antes de llamar esto (ver manejarEnvioMensaje), porque las tres
 * ramas mutan campos directo sobre esta misma referencia
 * (`eventosGuardados`, `cambioModalidadResuelto`, `estadoModalidad`,
 * `consultaEventoIds`, `consultaModalidadResuelto`) para que
 * guardarHistorialLocal() los persista tal cual, sin un valor de retorno
 * aparte que el caller tenga que acordarse de pegar de vuelta.
 */
/**
 * Rama "actualizar_nombre" de mostrarResultadoEnChat — el cambio ya se
 * aplicó (o falló) en resolverActualizacionNombre, esta función solo
 * confirma en el chat. `turno.nombrePreferidoAplicado` congela el nombre
 * ya aplicado para que reabrir el chat (reconstruirChatDesdeHistorial)
 * muestre la MISMA confirmación sin volver a escribir en
 * estado.datos.configuracion ni disparar marcarCambioPendiente() de nuevo
 * (mismo principio que cambioModalidadResuelto: no repetir side-effects al
 * reconstruir).
 */
function mostrarResultadoActualizarNombreEnChat(resultado, turno) {
  if (!turno.nombrePreferidoAplicado) {
    const resuelto = resolverActualizacionNombre(resultado.nombrePreferido);
    if (!resuelto.ok) {
      agregarBurbujaAlDom(crearBurbuja("modelo", resuelto.motivo));
      return;
    }
    turno.nombrePreferidoAplicado = resuelto.nombreNuevo;
  }
  agregarBurbujaAlDom(crearBurbuja("modelo", `¡Listo! De ahora en más te digo ${turno.nombrePreferidoAplicado} 😊`));
}

async function mostrarResultadoEnChat(resultado, turno, textoUsuario) {
  if (resultado.accion === "saludo") {
    // Punto 4, personalidad Wapper: nunca llega acá vía Gemini (el schema
    // solo admite "crear_eventos"/"editar_modalidad"/"consultar"/
    // "actualizar_nombre") — es un marcador puramente local para el saludo
    // simple, ver esSaludoSimple/manejarEnvioMensaje.
    agregarBurbujaAlDom(crearBurbuja("modelo", construirMensajeSaludoWapper()));
    return;
  }
  if (resultado.accion === "capacidades") {
    // Punto 7 del brief: mismo mecanismo que "saludo" — marcador puramente
    // local (nunca lo devuelve Gemini), ver esPreguntaCapacidades/
    // manejarEnvioMensaje. Texto armado en vivo desde CAPACIDADES_WAPPER,
    // así que ya incluye cualquier capacidad agregada después.
    agregarBurbujaAlDom(crearBurbuja("modelo", construirMensajeCapacidadesWapper()));
    return;
  }
  if (resultado.accion === "editar_modalidad") {
    mostrarResultadoModalidadEnChat(resultado, turno);
    return;
  }
  if (resultado.accion === "consultar") {
    mostrarResultadoConsultaEnChat(resultado, turno);
    return;
  }
  if (resultado.accion === "actualizar_nombre") {
    mostrarResultadoActualizarNombreEnChat(resultado, turno);
    return;
  }
  await mostrarResultadoEventosEnChat(resultado, turno, textoUsuario);
}

/* ===================== Envío de mensajes ===================== */

function actualizarEstadoEnvio() {
  const input = document.getElementById("input-asistente-mensaje");
  const btn = document.getElementById("btn-asistente-enviar");
  const btnVoz = document.getElementById("btn-asistente-voz");
  if (input) input.disabled = enviandoMensaje;
  if (btn) {
    btn.disabled = enviandoMensaje;
    btn.style.opacity = enviandoMensaje ? "0.4" : "1";
  }
  if (btnVoz) {
    btnVoz.disabled = enviandoMensaje;
    btnVoz.style.opacity = enviandoMensaje ? "0.4" : "1";
  }
}

async function manejarEnvioMensaje() {
  if (enviandoMensaje) return;
  const input = document.getElementById("input-asistente-mensaje");
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;

  input.value = "";
  agregarBurbujaAlDom(crearBurbuja("usuario", texto));
  conversacionActual.push({ rol: "usuario", texto });

  enviandoMensaje = true;
  actualizarEstadoEnvio();

  try {
    // Punto 4, personalidad Wapper: saludo simple → respuesta fija, SIN
    // intentar extraer nada (ni siquiera se llama a Gemini). El turno se
    // guarda igual que cualquier otro ("crudo" con un accion:"saludo"
    // puramente local, ver esSaludoSimple) para que el historial y su
    // reconstrucción lo traten parejo con el resto de turnos "modelo".
    if (esSaludoSimple(texto)) {
      const turno = { rol: "modelo", texto: construirMensajeSaludoWapper(), crudo: JSON.stringify({ accion: "saludo" }) };
      conversacionActual.push(turno);
      await mostrarResultadoEnChat({ accion: "saludo" }, turno, texto);
      guardarHistorialLocal();
      return;
    }

    // Punto 7 del brief: "¿qué podés hacer?"/"ayuda"/etc. → lista de
    // capacidades, SIN llamar a Gemini (mismo atajo que esSaludoSimple).
    if (esPreguntaCapacidades(texto)) {
      const turno = {
        rol: "modelo",
        texto: construirMensajeCapacidadesWapper(),
        crudo: JSON.stringify({ accion: "capacidades" }),
      };
      conversacionActual.push(turno);
      await mostrarResultadoEnChat({ accion: "capacidades" }, turno, texto);
      guardarHistorialLocal();
      return;
    }

    const indicador = crearIndicadorEscribiendo();
    agregarBurbujaAlDom(indicador);

    try {
      const resultado = await llamarGemini(texto);
      indicador.remove();
      // El turno se pushea ANTES de renderizar (no después, como antes de
      // "editar_modalidad") porque mostrarResultadoEnChat ahora muta este
      // mismo objeto por referencia (eventosGuardados / cambioModalidadResuelto
      // / estadoModalidad / respuestaConversacional) — la tarjeta de
      // modalidad necesita un turno real ya en conversacionActual para
      // poder actualizarlo al tocar Aplicar/Cancelar y volver a guardar el
      // historial en ese momento.
      const turno = { rol: "modelo", texto: resultado.crudo, crudo: resultado.crudo };
      conversacionActual.push(turno);
      // Se pasa `texto` (el mensaje original del usuario) para que, si
      // resultado.items viene vacío sin aclaración, la rama conversacional
      // de Wapper tenga con qué generar la respuesta (ver
      // generarRespuestaConversacionalWapper).
      await mostrarResultadoEnChat(resultado, turno, texto);
      guardarHistorialLocal();
    } catch (e) {
      indicador.remove();
      // Un error de Gemini NO se guarda como intercambio real (ver
      // guardarHistorialLocal: exige un turno de cada rol) — se saca el
      // turno de usuario que quedó sin respuesta real, para que el próximo
      // intento no le mande a Gemini una pregunta huérfana sin su
      // respuesta como contexto.
      conversacionActual.pop();
      agregarBurbujaAlDom(crearBurbuja("modelo", mensajeParaError(e), true));
    }
  } finally {
    enviandoMensaje = false;
    actualizarEstadoEnvio();
  }
}

/* ===================== Construcción del DOM de la sección ===================== */

function construirEsqueletoAsistente(contenedor) {
  contenedor.innerHTML = "";

  const tarjeta = document.createElement("section");
  tarjeta.id = "asistente-tarjeta";
  tarjeta.className = "glass-card stack";
  // Flex column fijo: encabezado y fila de input NUNCA achican (flex-shrink:0,
  // ver más abajo), el scroll del medio se queda con todo lo que sobra
  // (flex:1 + min-height:0, si no min-height:0 el flex item no deja que su
  // hijo con overflow-y:auto scrollee de verdad y en cambio empuja el alto
  // de la tarjeta entera).
  tarjeta.style.cssText = "gap:10px; display:flex; flex-direction:column; overflow:hidden;";

  const encabezado = document.createElement("div");
  encabezado.className = "row-between";
  encabezado.style.flexShrink = "0";
  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.textContent = "✨ Asistente IA";
  encabezado.appendChild(titulo);
  const btnNueva = document.createElement("button");
  btnNueva.title = "Nueva conversación";
  btnNueva.setAttribute("aria-label", "Nueva conversación");
  btnNueva.textContent = "⟳";
  btnNueva.style.cssText =
    "background:none; border:none; font-size:1.5rem; line-height:1; cursor:pointer; padding:2px 4px; color:var(--color-luz, #6d5efc);";
  btnNueva.onclick = () => {
    const habiaAlgo = conversacionActual.length > 0;
    iniciarConversacionNueva(contenedor);
    if (habiaAlgo) mostrarToast("Conversación reiniciada");
  };
  encabezado.appendChild(btnNueva);
  tarjeta.appendChild(encabezado);

  const scroll = document.createElement("div");
  scroll.id = "asistente-chat-scroll";
  scroll.style.cssText =
    "display:flex; flex-direction:column; gap:8px; overflow-y:auto; min-height:0; flex:1; padding:4px 2px;";
  tarjeta.appendChild(scroll);

  const filaInput = document.createElement("div");
  filaInput.className = "row";
  filaInput.style.gap = "8px";
  filaInput.style.flexShrink = "0";
  const input = document.createElement("input");
  input.id = "input-asistente-mensaje";
  input.className = "form-input";
  input.placeholder = `Ejemplo: ${elegirEjemploBienvenidaAlAzar()}`;
  input.autocomplete = "off";
  input.style.flex = "1";
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      manejarEnvioMensaje();
    }
  });
  const btnEnviar = document.createElement("button");
  btnEnviar.id = "btn-asistente-enviar";
  btnEnviar.title = "Enviar";
  btnEnviar.setAttribute("aria-label", "Enviar");
  btnEnviar.textContent = "➤";
  btnEnviar.style.cssText =
    "background:none; border:none; font-size:1.6rem; line-height:1; cursor:pointer; padding:2px 6px; flex-shrink:0; color:var(--color-luz, #6d5efc);";
  btnEnviar.onclick = manejarEnvioMensaje;
  filaInput.appendChild(input);
  const btnVoz = crearBotonVoz(input);
  if (btnVoz) filaInput.appendChild(btnVoz);
  filaInput.appendChild(btnEnviar);
  tarjeta.appendChild(filaInput);

  contenedor.appendChild(tarjeta);
  instalarObservadorVisibilidadAsistente(tarjeta);
  sincronizarEstadoAsistente();
}

/**
 * Ronda 3 — reemplaza el criterio "medir 1 sola vez y quedarse estático" de
 * la ronda anterior: en celular eso rompía de 2 formas reales que reportó
 * el usuario:
 *   1. `window.innerHeight` en mobile incluye la barra de direcciones del
 *      navegador, que se expande/colapsa sola al hacer scroll — un alto
 *      medido una sola vez queda desactualizado apenas eso cambia, y ahí
 *      aparece el "scroll fantasma" (se puede scrollear hacia abajo aunque
 *      no haya nada, porque el documento termina midiendo más que la
 *      pantalla real visible).
 *   2. Al abrir el teclado en un input, el navegador achica el viewport
 *      VISUAL (no el viewport de layout) — sin escuchar ese cambio, la
 *      tarjeta se queda con su alto viejo (de antes de que el teclado
 *      empujara todo hacia arriba), y ahí aparece tanto el hueco vacío
 *      abajo (una franja sin color) como el chat empujado fuera de
 *      pantalla.
 *
 * La solución correcta para ambos casos es la Visual Viewport API
 * (`window.visualViewport`) — a diferencia de escuchar el resize genérico
 * de `window` (que fue lo que se sacó a propósito en la ronda anterior por
 * ruidoso/innecesario), `visualViewport.resize` SOLO dispara cuando el
 * espacio realmente visible cambia (teclado abriendo/cerrando, zoom,
 * colapso real de la barra de direcciones) — es la señal correcta, no el
 * resize genérico. Si el navegador no soporta la API (Safari desktop
 * viejo, por las dudas), cae a `window.innerHeight` sin escuchar nada, que
 * es el comportamiento que ya había.
 *
 * No hay CSS del layout general (design-system.css) a la vista acá, así
 * que en vez de inventar un `calc(100vh - Npx)` a ciegas, se mide en JS la
 * posición real de la tarjeta y se le da exactamente el espacio que sobra
 * hasta abajo del viewport VISIBLE ahora mismo — funciona sin importar
 * cuánto midan el header/nav reales, y se recalcula solo cuando ese
 * espacio visible de verdad cambia. El flex interno (encabezado/scroll/
 * input, ver construirEsqueletoAsistente) reparte ese alto entre las 3
 * franjas.
 *
 * Ronda 4 — 2 bugs reales reportados sobre lo de arriba:
 *
 *   3. "Scroll fantasma": se podía scrollear el documento aunque no hubiera
 *      nada más abajo. Causa real: nada acá tocaba el scroll del propio
 *      `body` — `body` en design-system.css usa `min-height:100vh`, así que
 *      apenas la tarjeta (ya con su alto fijo) más el resto del layout no
 *      llenan exactos los 100vh (redondeos, barra de direcciones, etc.), el
 *      documento queda scrolleable esos pocos px de sobra. La sección de
 *      Asistente se pensó como bloque ESTÁTICO de pantalla completa, así
 *      que mientras esté visible el scroll del documento se bloquea
 *      directo (clase `asistente-bloqueo-scroll` en `body`, ver
 *      design-system.css) — no hace falta nada más fino que eso.
 *
 *   4. Teclado en celular: al enfocar el input, el navegador no encoge el
 *      viewport de LAYOUT (solo el visual) y en cambio empuja/scrollea la
 *      página para que el input quede visible sobre el teclado — de ahí
 *      la franja sin color abajo y el chat empujado fuera de pantalla. La
 *      solución de fondo (bloquear el scroll del documento, punto 3) ya
 *      evita el empujón real; lo único que queda es, mientras el teclado
 *      esté abierto, ocultar el header de accesos rápidos (.mobile-topbar,
 *      hamburguesa + botón de Enlaces) para no desperdiciar ese espacio, y
 *      re-medir la tarjeta usando el alto VISUAL (que sí encoge con el
 *      teclado) para que la tarjeta entera cambie de tamaño y siga cabiendo
 *      completa arriba del teclado.
 *
 * "Teclado abierto" se infiere comparando `window.innerHeight` (layout,
 * no cambia con el teclado) contra `visualViewport.height` (si el
 * navegador no soporta la API, cae a innerHeight y nunca se detecta
 * teclado — igual que el comportamiento viejo). Una diferencia chica
 * (rotación, colapso normal de la barra de direcciones) no cuenta como
 * teclado; se pide un salto de más de UMBRAL_TECLADO_ABIERTO_PX.
 *
 * Visibilidad real de la sección: este módulo no tiene ningún hook de
 * "salida" que avise cuándo se navega a otra sección (main.js no llama a
 * nada acá al respecto), así que en vez de asumir "si el nodo existe en el
 * DOM, la sección está activa" (falso si la app oculta secciones con
 * display:none en vez de desmontarlas), se usa un IntersectionObserver
 * sobre la tarjeta — dispara solo con cambios reales de visibilidad
 * (desmontado, display:none, o de verdad scrolleado fuera de vista), y es
 * el único momento en que se limpia el bloqueo/estado (`limpiarEstadoAsistente`)
 * para no dejar el documento entero sin poder scrollear en otra sección.
 */
const MARGEN_INFERIOR_CHAT_PX = 16;
const UMBRAL_TECLADO_ABIERTO_PX = 120;
let listenerViewportAsistenteInstalado = false;
let observadorVisibilidadAsistente = null;

function limpiarEstadoAsistente() {
  document.body.classList.remove("asistente-bloqueo-scroll", "asistente-teclado-abierto");
}

function sincronizarEstadoAsistente() {
  const tarjeta = document.getElementById("asistente-tarjeta");
  // offsetParent === null cubre tanto "ya no está en el DOM" como "un
  // ancestro tiene display:none" (sección oculta pero no desmontada) —
  // en cualquiera de los 2 casos, Asistente no está realmente visible.
  if (!tarjeta || tarjeta.offsetParent === null) {
    limpiarEstadoAsistente();
    return;
  }

  document.body.classList.add("asistente-bloqueo-scroll");

  const alturaLayout = window.innerHeight;
  const alturaVisual = window.visualViewport ? window.visualViewport.height : alturaLayout;
  const tecladoAbierto = alturaLayout - alturaVisual > UMBRAL_TECLADO_ABIERTO_PX;
  document.body.classList.toggle("asistente-teclado-abierto", tecladoAbierto);

  // Se mide DESPUÉS de decidir si el topbar se oculta: ocultarlo cambia el
  // "top" real de la tarjeta (sube), así que medir antes le daría menos
  // alto del que en realidad queda disponible.
  const top = tarjeta.getBoundingClientRect().top;
  const alturaDisponible = alturaVisual - top - MARGEN_INFERIOR_CHAT_PX;
  tarjeta.style.height = `${Math.max(240, alturaDisponible)}px`;
}

function instalarListenerViewportAsistente() {
  if (listenerViewportAsistenteInstalado) return;
  listenerViewportAsistenteInstalado = true;
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", sincronizarEstadoAsistente);
    window.visualViewport.addEventListener("scroll", sincronizarEstadoAsistente);
  } else {
    window.addEventListener("resize", sincronizarEstadoAsistente);
  }
}
instalarListenerViewportAsistente();

/** Se re-crea en cada construcción del esqueleto (tarjeta nueva cada vez). */
function instalarObservadorVisibilidadAsistente(tarjeta) {
  if (observadorVisibilidadAsistente) observadorVisibilidadAsistente.disconnect();
  observadorVisibilidadAsistente = new IntersectionObserver(
    (entradas) => {
      const visible = entradas[0] && entradas[0].isIntersecting;
      if (visible) sincronizarEstadoAsistente();
      else limpiarEstadoAsistente();
    },
    { threshold: [0] }
  );
  observadorVisibilidadAsistente.observe(tarjeta);
}

/**
 * Punto 2 del brief de personalidad Wapper + corrección 2026-08-29: texto
 * fijo + UN solo ejemplo random debajo ("Ejemplo: ..."), texto plano, sin
 * botón — con materias REALES del usuario (o genéricos de respaldo si
 * todavía no matriculó ninguna).
 */
function mostrarSaludoInicial() {
  agregarBurbujaAlDom(crearBurbuja("modelo", construirMensajeBienvenidaWapper()));
  agregarBurbujaAlDom(crearBurbuja("modelo", `Ejemplo: ${elegirEjemploBienvenidaAlAzar()}`));
  // Punto 8 del brief (2026-08-31): agregado, no reemplazo, del ejemplo de
  // arriba — invita a descubrir el resto de capacidades (punto 7) sin tener
  // que adivinar. En tuteo, como el resto de la interfaz de Wapper.
  agregarBurbujaAlDom(crearBurbuja("modelo", "¿No sabes por dónde empezar? Pregúntame qué puedo hacer."));
}

/**
 * Reconstruye la vista del chat a partir de un historial guardado —
 * reutiliza mostrarResultadoEnChat para que un turno restaurado se vea
 * IDÉNTICO a como se vio la primera vez que se generó en vivo.
 */
function reconstruirChatDesdeHistorial(historial) {
  historial.turnos.forEach((turno) => {
    if (turno.rol === "usuario") {
      agregarBurbujaAlDom(crearBurbuja("usuario", turno.texto));
      return;
    }
    try {
      const parseado = JSON.parse(turno.crudo);
      // Mismo shape que arma ejecutarGeneracionGemini en vivo — un turno de
      // un historial guardado ANTES de "editar_modalidad"/"consultar" no
      // tiene `accion` en el crudo (undefined) y cae a "crear_eventos" por
      // defecto, igual que en vivo. "saludo" (personalidad Wapper,
      // 2026-08-29) es un marcador puramente local que nunca devuelve
      // Gemini — solo aparece acá si el turno se generó vía el atajo de
      // esSaludoSimple.
      const resultado = {
        accion:
          parseado.accion === "editar_modalidad"
            ? "editar_modalidad"
            : parseado.accion === "consultar"
            ? "consultar"
            : parseado.accion === "actualizar_nombre"
            ? "actualizar_nombre"
            : parseado.accion === "saludo"
            ? "saludo"
            : parseado.accion === "capacidades"
            ? "capacidades"
            : "crear_eventos",
        items: Array.isArray(parseado.items) ? parseado.items : [],
        cambioModalidad: parseado.cambioModalidad || null,
        consulta: parseado.consulta || null,
        nombrePreferido: parseado.nombrePreferido || null,
        aclaracion: parseado.aclaracion || null,
      };
      // `turno` es el objeto real de historial.turnos (ver más abajo,
      // conversacionActual = historial.turnos.slice()) — mostrarResultadoEnChat
      // lo muta directo (eventosGuardados/cambioModalidadResuelto/estadoModalidad/
      // consultaEventoIds/consultaModalidadResuelto), así que la tarjeta
      // reconstruida queda pintada en su estado real y "Aplicar cambio"
      // sigue funcionando sobre el mismo turno.
      mostrarResultadoEnChat(resultado, turno);
    } catch (e) {
      // Turno puntual corrupto en el historial guardado — se ignora ESE
      // turno de visualización sin romper la reconstrucción del resto.
    }
  });
}

function iniciarConversacionNueva(contenedor) {
  borrarHistorialLocal();
  conversacionActual = [];
  construirEsqueletoAsistente(contenedor);
  mostrarSaludoInicial();
}

function mostrarAvisoContinuar(contenedor, historial) {
  const scroll = document.getElementById("asistente-chat-scroll");
  if (!scroll) return;

  const aviso = document.createElement("div");
  aviso.className = "glass-card stack";
  aviso.style.cssText = "align-self:center; text-align:center; gap:8px; padding:14px;";

  const texto = document.createElement("p");
  texto.className = "muted";
  texto.textContent = "Tenés una conversación reciente con el Asistente.";
  aviso.appendChild(texto);

  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.cssText = "gap:8px; justify-content:center;";

  const btnContinuar = document.createElement("button");
  btnContinuar.className = "btn btn-primary";
  btnContinuar.textContent = "Continuar";
  btnContinuar.onclick = () => {
    aviso.remove();
    conversacionActual = historial.turnos.slice();
    reconstruirChatDesdeHistorial(historial);
  };

  const btnNueva = document.createElement("button");
  btnNueva.className = "btn btn-secondary";
  btnNueva.textContent = "Nueva conversación";
  btnNueva.onclick = () => {
    aviso.remove();
    iniciarConversacionNueva(contenedor);
  };

  fila.appendChild(btnContinuar);
  fila.appendChild(btnNueva);
  aviso.appendChild(fila);
  scroll.appendChild(aviso);
}

/**
 * Entry point — llamada por mostrarSeccion() (main.js) cada vez que se
 * entra a Asistente. SIEMPRE reconstruye el DOM de cero (nunca deja
 * restos de una visita anterior colgando), pero antes de arrancar en
 * blanco revisa si hay una conversación guardada en este dispositivo con
 * menos de 1 hora desde el último mensaje (leerHistorialLocalVigente) —
 * si la hay, ofrece continuarla o arrancar una nueva; si no, arranca
 * directo en blanco con el saludo inicial.
 */
function renderizarAsistente() {
  const contenedor = document.getElementById("seccion-asistente");
  if (!contenedor) return;

  if (!estado.datos.configuracion.gemini_api_key) {
    // Defensivo: el nav ya gatea esto (aplicarVisibilidadNavegacion en
    // main.js), pero si se llegara igual (ej. estado a medio sincronizar)
    // no tiene sentido mostrar un chat que no puede llamar a nada.
    contenedor.innerHTML = "";
    const aviso = document.createElement("div");
    aviso.className = "glass-card stack";
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Todavía no guardaste una clave de Gemini.";
    aviso.appendChild(p);
    const btn = document.createElement("button");
    btn.className = "btn btn-primary";
    btn.textContent = "Ir a Ajustes";
    btn.onclick = () => window.mostrarSeccion?.("configuracion");
    aviso.appendChild(btn);
    contenedor.appendChild(aviso);
    return;
  }

  construirEsqueletoAsistente(contenedor);

  const historial = leerHistorialLocalVigente();
  if (historial) {
    conversacionActual = [];
    mostrarAvisoContinuar(contenedor, historial);
  } else {
    conversacionActual = [];
    mostrarSaludoInicial();
  }
}

// Se expone en window por el mismo motivo que renderizarHorario/
// renderizarAgenda (ver horario.js/agenda.js): mostrarSeccion() en main.js
// la llama así para no tener que importar cada módulo de sección ahí
// directo — el import real de este archivo (abajo, en main.js) solo
// existe para que el navegador cargue el módulo y esta línea se ejecute.
window.renderizarAsistente = renderizarAsistente;

export {
  renderizarAsistente,
  // Ronda 2026-08-23 (Bandeja pendiente / Captura por voz): asistente-bandeja.js
  // reusa estas tres para no duplicar el pipeline de extracción ni el
  // guardado real de eventos — un solo lugar de verdad para "texto/audio
  // crudo -> EventoAgenda real", ya sea que venga del chat en vivo o del
  // buzón del Worker.
  transcribirBase64ConGemini,
  extraerEventosDeTexto,
  guardarItemExtraidoComoEvento,
  mensajeParaError,
};
