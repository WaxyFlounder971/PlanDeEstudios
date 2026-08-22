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
import { formatearHoraAmPm, obtenerMateriasVinculablesAgenda } from "../agenda/agenda-utils.js";
import { fechaLocalDesdeISO } from "../horario/horario.js";
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

const MENSAJE_FALLBACK = 'No entendí, ¿podés reformular? Por ejemplo: "tengo examen de anatomía el jueves a las 2pm".';

// En memoria, la conversación visible AHORA MISMO en el chat — se llena al
// arrancar (blanco o restaurada desde el historial local) y se persiste a
// localStorage después de cada intercambio real completo.
let conversacionActual = [];
let enviandoMensaje = false;

/* ===================== Voz (Web Speech API, nativo del navegador) =====================
 * Sin costo: no pasa por Gemini ni por ninguna API paga — el navegador
 * transcribe localmente/vía su propio motor (Chrome usa el de Google, pero
 * gratis y sin la clave del usuario de por medio). Si el navegador no lo
 * soporta (ej. Firefox de escritorio), el botón de micrófono directamente
 * no se dibuja (ver crearBotonVoz) — no hay fallback, degradación
 * silenciosa a "solo texto", que es como funcionaba antes.
 */
const ReconocimientoVozAPI = window.SpeechRecognition || window.webkitSpeechRecognition || null;
let reconocimientoVoz = null;
let grabandoVoz = false;

function crearReconocimientoVoz() {
  const r = new ReconocimientoVozAPI();
  r.lang = "es-419";
  r.continuous = false;
  r.interimResults = true;
  return r;
}

/**
 * Botón de micrófono — vive al lado del input, mismo tratamiento visual
 * "solo símbolo, sin fondo de botón" que se le dio a 🔄 Nueva. Toca
 * directo input.value con el texto reconocido (final o parcial mientras
 * graba) para que el usuario vea/edite antes de tocar Enviar — mismo
 * principio de "nunca actuar solo" que el resto del módulo.
 */
function crearBotonVoz(input) {
  if (!ReconocimientoVozAPI) return null;

  const btn = document.createElement("button");
  btn.id = "btn-asistente-voz";
  btn.title = "Dictar por voz";
  btn.setAttribute("aria-label", "Dictar por voz");
  btn.textContent = "🎙️";
  btn.style.cssText =
    "background:none; border:none; font-size:1.4rem; line-height:1; cursor:pointer; padding:2px 8px; flex-shrink:0;";

  btn.onclick = () => {
    if (grabandoVoz) {
      reconocimientoVoz?.stop();
      return;
    }
    reconocimientoVoz = crearReconocimientoVoz();
    reconocimientoVoz.onstart = () => {
      grabandoVoz = true;
      btn.textContent = "🔴";
      btn.title = "Grabando… tocá para detener";
    };
    reconocimientoVoz.onresult = (e) => {
      let texto = "";
      for (let i = 0; i < e.results.length; i++) texto += e.results[i][0].transcript;
      input.value = texto;
    };
    reconocimientoVoz.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        mostrarToast("Permiso de micrófono denegado");
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        mostrarToast("No se pudo usar el micrófono");
      }
    };
    reconocimientoVoz.onend = () => {
      grabandoVoz = false;
      btn.textContent = "🎙️";
      btn.title = "Dictar por voz";
      input.focus();
    };
    reconocimientoVoz.start();
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
  const materias = obtenerMateriasVinculablesAgenda().map((m) => m.nombre);
  const listaMaterias =
    materias.length > 0
      ? materias.map((n) => `- ${n}`).join("\n")
      : "(el usuario no tiene materias matriculadas en los semestres que Agenda tiene seleccionados ahora)";

  return `Sos el Asistente IA de una app académica. Tu única función es leer un
mensaje en lenguaje natural de un estudiante universitario y extraer de
ahí tareas, exámenes y eventos para su Agenda.

Hoy es ${iso} (${diaSemana}). Usá esta fecha como referencia para resolver
cualquier fecha relativa ("mañana", "el jueves", "en 2 semanas", "el
próximo lunes", etc.). Si el usuario describe algo que se repite (ej. "los
martes durante 3 semanas seguidas"), devolvé UN ítem por cada ocurrencia
real, cada uno con su propia fecha.

Materias matriculadas reales del usuario ahora mismo:
${listaMaterias}

Devolvé ÚNICAMENTE un JSON con esta forma exacta:
{
  "items": [
    {
      "tipo": "evento" | "tarea" | "examen",
      "nombre": "string corto, SOLO el título de la tarea/examen/evento",
      "materia": "nombre EXACTO de la lista de arriba, o null",
      "fecha": "YYYY-MM-DD",
      "hora": "HH:MM" | null,
      "notas": "string, vacío salvo que aplique la regla de abajo"
    }
  ],
  "aclaracion": "string" | null
}

Reglas:
- "examen" para exámenes/parciales/quices; "tarea" para tareas/entregas/
  proyectos; "evento" para cualquier otra cosa (charlas, reuniones, citas,
  etc.).
- "nombre": SOLO el título de la tarea/examen/evento en sí (ej. "Prueba
  1", "Proyecto final", "Entrega de laboratorio"). NUNCA metas el nombre
  de la materia acá — eso va aparte, en "materia".
- "materia": si el mensaje nombra una materia que coincide claramente con
  una de la lista de arriba, usá el nombre EXACTO de la lista (ej. si dice
  "examen de cálculo" y en la lista está "Cálculo I", "materia" es
  "Cálculo I", nunca una variante inventada). Si no se menciona materia o
  no hay forma de saber cuál, "materia" es null.
- Si el mensaje es realmente ambiguo entre 2 o más materias de la lista
  (ej. existen "Cálculo I" y "Cálculo II" y el usuario solo dijo
  "cálculo", sin forma de saber cuál con el resto del mensaje), NO
  adivines: devolvé "items": [] y explicá la duda en "aclaracion" con una
  pregunta corta y directa (ej. "¿Te referís a Cálculo I o Cálculo II?").
- "hora": SOLO si el usuario mencionó una hora puntual explícita (ej. "a
  las 2pm", "a las 14:00"). Si no la mencionó, "hora" es null SIEMPRE —
  nunca trates de adivinar a qué hora es una clase, eso no es tu trabajo.
- "notas": vacío ("") por defecto. SOLO ponés algo acá si el usuario pidió
  EXPLÍCITAMENTE guardar una nota o aclaración puntual (ej. "y anotá que
  es grupal", "poné en notas que hay que llevar la calculadora"). NUNCA
  inventes ni infieras contexto por tu cuenta (número de semana, motivo,
  suposiciones) — si el usuario no lo pidió como nota, no va.
- Un solo mensaje puede describir más de un ítem — devolvé todos los que
  encuentres en "items".
- Si el mensaje no describe ninguna tarea/examen/evento reconocible
  (saludo, pregunta suelta, charla sin fecha ni intención real de agendar
  algo), devolvé "items": [] y "aclaracion": null.
- "aclaracion" es SOLO para preguntar algo puntual que te impide extraer
  bien un ítem por ambigüedad real. Si ya tenés todo claro, "aclaracion"
  va en null aunque "items" tenga resultados.`;
}

/* ===================== Llamada a la API de Gemini ===================== */

const ESQUEMA_RESPUESTA_GEMINI = {
  type: "OBJECT",
  properties: {
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
        },
        required: ["tipo", "nombre", "fecha"],
      },
    },
    aclaracion: { type: "STRING", nullable: true },
  },
  required: ["items"],
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
async function llamarGemini(mensajeNuevo) {
  const claveApi = estado.datos.configuracion.gemini_api_key;
  if (!claveApi) {
    const err = new Error("No hay clave de Gemini guardada.");
    err.tipoError = "clave";
    throw err;
  }

  const contents = conversacionActual.map((turno) => ({
    role: turno.rol === "usuario" ? "user" : "model",
    parts: [{ text: turno.rol === "usuario" ? turno.texto : turno.crudo }],
  }));
  contents.push({ role: "user", parts: [{ text: mensajeNuevo }] });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${encodeURIComponent(claveApi)}`;

  let respuesta;
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

  let datos;
  try {
    datos = await respuesta.json();
  } catch (e) {
    const err = new Error("Gemini devolvió una respuesta inválida.");
    err.tipoError = "desconocido";
    throw err;
  }

  if (!respuesta.ok) {
    const codigo = datos && datos.error && datos.error.code;
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
    items: Array.isArray(parseado.items) ? parseado.items : [],
    aclaracion: parseado.aclaracion || null,
    crudo: texto,
  };
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
  return obtenerMateriasVinculablesAgenda().find((m) => m.nombre === nombreMateria) || null;
}

/** "L" | "K" | "M" | "J" | "V" | "S" | "D" real de una fecha "YYYY-MM-DD". */
function codigoDiaDesdeFecha(fechaIso) {
  const fecha = fechaLocalDesdeISO(fechaIso);
  return DIAS_SEMANA_CONFIG[(fecha.getDay() + 6) % 7].abrevDefault;
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
function guardarItemExtraidoComoEvento(item) {
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
    esFeriado: false,
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

  const emojiTipo = evento.tipo === "examen" ? "📝" : evento.tipo === "tarea" ? "✅" : "📌";
  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  titulo.textContent = `${emojiTipo} ${evento.nombre}`;
  card.appendChild(titulo);

  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.fontSize = "0.85rem";
  const partes = [formatearFechaLarga(evento.fecha), evento.hora ? formatearHoraAmPm(evento.hora) : "Todo el día"];
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
  filaBotones.style.gap = "8px";

  const btnEditar = document.createElement("button");
  btnEditar.className = "btn btn-secondary";
  btnEditar.style.flex = "1";
  btnEditar.textContent = "Editar";
  btnEditar.onclick = () => abrirModalEventoAgenda({ eventoId: evento.id });
  filaBotones.appendChild(btnEditar);

  const btnEliminar = document.createElement("button");
  btnEliminar.className = "btn btn-danger";
  btnEliminar.style.flex = "1";
  btnEliminar.textContent = "Eliminar";
  // No hay forma de engancharse a un "onConfirmar" desde acá (confirmarBorrarEventoAgenda
  // solo recibe el evento), así que esta tarjeta puntual no se atenúa sola
  // al confirmar el borrado en el diálogo — si volvés a entrar a Asistente
  // sí se va a ver como "ya no existe" (arriba). Aviso esto directo, no es
  // un bug silencioso.
  btnEliminar.onclick = () => confirmarBorrarEventoAgenda(evento);
  filaBotones.appendChild(btnEliminar);

  card.appendChild(filaBotones);
  return card;
}

function agregarBurbujaAlDom(elemento) {
  const cont = document.getElementById("asistente-chat-scroll");
  if (!cont) return;
  cont.appendChild(elemento);
  cont.scrollTop = cont.scrollHeight;
}

/**
 * Muestra en el chat el resultado ya interpretado de un turno de Gemini
 * ({items, aclaracion}) — la usan tanto el envío en vivo (manejarEnvioMensaje)
 * como la reconstrucción desde historial (reconstruirChatDesdeHistorial).
 *
 * `eventosGuardadosExistentes`: CRÍTICO para no duplicar guardados. En vivo
 * viene null → acá mismo se crean los eventos reales (guardarItemExtraidoComoEvento)
 * y se devuelven sus ids para que manejarEnvioMensaje los persista junto al
 * turno. Al reconstruir desde historial (reabrir Asistente con una
 * conversación reciente) YA existen esos eventos — vienen los ids guardados
 * en el propio turno del historial, así que acá NUNCA se vuelve a llamar
 * guardarItemExtraidoComoEvento, solo se re-renderizan las tarjetas contra
 * el estado real actual (ver crearTarjetaEventoGuardado).
 *
 * Devuelve el array de ids guardados (vacío si no hubo ítems).
 */
function mostrarResultadoEnChat(resultado, eventosGuardadosExistentes) {
  if (resultado.items.length === 0 && resultado.aclaracion) {
    agregarBurbujaAlDom(crearBurbuja("modelo", resultado.aclaracion));
    return [];
  }
  if (resultado.items.length === 0) {
    agregarBurbujaAlDom(crearBurbuja("modelo", MENSAJE_FALLBACK));
    return [];
  }

  const resumen = resultado.items.length === 1 ? "Guardé esto en tu Agenda:" : `Guardé ${resultado.items.length} cosas en tu Agenda:`;
  agregarBurbujaAlDom(crearBurbuja("modelo", resumen));

  const eventosGuardados = Array.isArray(eventosGuardadosExistentes)
    ? eventosGuardadosExistentes
    : resultado.items.map((item) => guardarItemExtraidoComoEvento(item));

  eventosGuardados.forEach((id) => agregarBurbujaAlDom(crearTarjetaEventoGuardado(id)));
  return eventosGuardados;
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
  const indicador = crearIndicadorEscribiendo();
  agregarBurbujaAlDom(indicador);

  try {
    const resultado = await llamarGemini(texto);
    indicador.remove();
    // null = guardado en vivo (ver mostrarResultadoEnChat): acá SÍ se crean
    // los eventos reales. Los ids que devuelve se guardan en el turno para
    // que una futura reconstrucción desde historial nunca los vuelva a crear.
    const eventosGuardados = mostrarResultadoEnChat(resultado, null);
    conversacionActual.push({ rol: "modelo", texto: resultado.crudo, crudo: resultado.crudo, eventosGuardados });
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
  input.placeholder = 'Ej: tengo examen de anatomía el jueves a las 2pm';
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
  fijarAlturaChatAsistente();
}

/**
 * Pedido explícito (ronda 2): la TARJETA completa (no solo la lista de
 * mensajes) ocupa siempre el espacio disponible hasta abajo de la pantalla
 * — encabezado y fila de input quedan anclados arriba/abajo, y solo el
 * medio (#asistente-chat-scroll) tiene su propio scroll. Se mide UNA SOLA
 * VEZ por cada carga de la sección (al construir el esqueleto) y se queda
 * estático de ahí en adelante — a propósito ya NO hay listener de resize
 * (antes lo había); si el usuario gira el celular o cambia el tamaño de la
 * ventana, el alto no se recalcula solo hasta la próxima vez que entre a
 * la sección o le dé "Nueva conversación".
 *
 * No hay CSS del layout general (design-system.css) a la vista acá, así
 * que en vez de inventar un `calc(100vh - Npx)` a ciegas, se mide en JS la
 * posición real de la tarjeta en el viewport y se le da exactamente el
 * espacio que sobra hasta abajo — funciona sin importar cuánto midan el
 * header/nav reales. El flex interno (encabezado/scroll/input, ver
 * construirEsqueletoAsistente) es lo que reparte ese alto fijo entre las 3
 * franjas.
 */
const MARGEN_INFERIOR_CHAT_PX = 16;

function fijarAlturaChatAsistente() {
  const tarjeta = document.getElementById("asistente-tarjeta");
  if (!tarjeta) return;
  const top = tarjeta.getBoundingClientRect().top;
  const alturaDisponible = window.innerHeight - top - MARGEN_INFERIOR_CHAT_PX;
  tarjeta.style.height = `${Math.max(300, alturaDisponible)}px`;
}

function mostrarSaludoInicial() {
  agregarBurbujaAlDom(
    crearBurbuja(
      "modelo",
      'Contame qué tarea, examen o evento querés agregar y lo guardo directo en tu Agenda. Por ejemplo: "tengo examen de anatomía el jueves a las 2pm".'
    )
  );
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
      mostrarResultadoEnChat(
        { items: Array.isArray(parseado.items) ? parseado.items : [], aclaracion: parseado.aclaracion || null },
        // Historial guardado ANTES de este cambio no tiene eventosGuardados
        // (undefined) — cae a null y, ese caso puntual, sí re-guarda. Ventana
        // real de choque: menos de 1 hora desde el deploy de este fix (ver
        // VIGENCIA_HISTORIAL_MS), después ya no puede pasar.
        Array.isArray(turno.eventosGuardados) ? turno.eventosGuardados : null
      );
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

export { renderizarAsistente };
