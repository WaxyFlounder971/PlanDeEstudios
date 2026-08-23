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
import { formatearHoraAmPm, obtenerMateriasVinculablesAgenda, obtenerSemestresSeleccionadosAgenda } from "../agenda/agenda-utils.js";
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
 * Transcribe un Blob de audio con Gemini (mismo modelo/clave que usa
 * llamarGemini para la extracción) — llamada de una sola vez, sin
 * historial ni schema JSON, solo se le pide el texto plano de lo que se
 * dijo. Tira Error si no hay clave, si la red falla, o si Gemini devuelve
 * error.
 */
async function transcribirAudioConGemini(blob) {
  const claveApi = estado.datos.configuracion.gemini_api_key;
  if (!claveApi) throw new Error("No hay clave de Gemini guardada.");
  // Mismo chequeo explícito que llamarGemini — ver comentario ahí.
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new Error("Sin conexión a internet.");
  }

  const base64 = await new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onloadend = () => resolve(String(lector.result).split(",")[1] || "");
    lector.onerror = () => reject(lector.error || new Error("No se pudo leer el audio grabado."));
    lector.readAsDataURL(blob);
  });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_GEMINI}:generateContent?key=${encodeURIComponent(claveApi)}`;
  const respuesta = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [
            { inline_data: { mime_type: blob.type || "audio/webm", data: base64 } },
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
        btn.title = "Grabando… tocá para detener";

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
                ? "No tenés conexión a internet."
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

  btn.onclick = () => {
    if (grabandoConFallback) {
      mediaRecorderVoz?.stop();
      return;
    }
    if (grabandoVoz) {
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

    reconocimientoVoz = crearReconocimientoVoz();
    // Bug real reportado (2026-08-22, Android/Chrome): el texto quedaba
    // duplicándose sobre sí mismo ("apúntame apúntame que apúntame que
    // tengo..."). Causa: antes se reconstruía TODO el texto desde
    // e.results[0] en CADA evento onresult, incluyendo resultados que en
    // Android no se "reemplazan en el lugar" de forma confiable como en
    // desktop — cada evento intermedio iba sumando de nuevo texto que ya
    // estaba. La forma correcta (recomendada por la propia spec de la Web
    // Speech API): separar transcripción FINAL (se acumula UNA sola vez,
    // apenas isFinal pasa a true) de la interina (se recalcula de cero en
    // cada evento, nunca se acumula), y recorrer solo desde e.resultIndex
    // (los resultados que cambiaron en ESTE evento), no desde 0.
    let transcripcionFinal = "";
    reconocimientoVoz.onstart = () => {
      grabandoVoz = true;
      btn.textContent = "🔴";
      btn.title = "Grabando… tocá para detener";
    };
    reconocimientoVoz.onresult = (e) => {
      let interina = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const transcript = e.results[i][0].transcript;
        if (e.results[i].isFinal) {
          transcripcionFinal += transcript + " ";
        } else {
          interina += transcript;
        }
      }
      input.value = textoPrevioAlInput + transcripcionFinal + interina;
    };
    reconocimientoVoz.onerror = (e) => {
      // Antes esto no quedaba en consola de ninguna forma — el toast
      // genérico no distingue causa. Con este log alcanza con abrir la
      // consola y mirar qué dice e.error para saber la causa real.
      console.warn("[asistente] Error de reconocimiento de voz:", e.error, e);
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        mostrarToast("Permiso de micrófono denegado");
        return;
      }
      if (e.error === "no-speech" || e.error === "aborted") return;
      // Fallo real del motor nativo (ej. "network", "audio-capture"): se
      // marca este navegador para usar el fallback de acá en adelante y se
      // reintenta YA con Gemini, sin que el usuario tenga que volver a
      // tocar el botón.
      usarFallbackTranscripcionGemini = true;
      transicionandoAFallback = true;
      mostrarToast("El micrófono nativo falló, probando transcripción alternativa…");
      iniciarFallbackGrabacion(textoPrevioAlInput);
    };
    reconocimientoVoz.onend = () => {
      grabandoVoz = false;
      // Si justo se está armando el fallback (ver onerror de arriba), no
      // tocar el ícono — el fallback lo va a poner en "🔴" apenas
      // getUserMedia resuelva, pisarlo acá lo dejaría parpadeando a
      // "🎙️" un instante antes de volver a "🔴".
      if (transicionandoAFallback) return;
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
real, cada uno con su propia fecha.${construirContextoSemanasSemestres()}${construirContextoProximasClases()}

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
      "notas": "string, vacío salvo que aplique la regla de abajo",
      "esFeriado": true | false
    }
  ],
  "aclaracion": "string" | null
}

Reglas:
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
- "esFeriado": true SOLO si el usuario indica explícitamente que es un
  feriado/día no lectivo/asueto (ej. "el lunes es feriado", "marcá el 15
  de setiembre como feriado", "no hay clases por el feriado de..."). Para
  cualquier tarea/examen/evento normal (aunque caiga en fin de semana),
  "esFeriado" es false. Un feriado casi siempre es "tipo": "evento" y
  "materia": null — nunca lo relaciones con una materia salvo que el
  usuario lo pida explícitamente.
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
          esFeriado: { type: "BOOLEAN" },
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
    // item.esFeriado puede venir undefined si Gemini omitió el campo (no es
    // "required" en el schema) — se trata como false, nunca se asume feriado
    // por default.
    esFeriado: item.esFeriado === true,
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
