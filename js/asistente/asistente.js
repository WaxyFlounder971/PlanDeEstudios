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
import { mostrarToast } from "../ui/componentes.js";
import { abrirModalEventoAgenda } from "../agenda/agenda-modal.js";
import { obtenerMateriasVinculablesAgenda } from "../agenda/agenda-utils.js";

/**
 * Modelo de Gemini (decisión de diseño, 2026-08-22): gemini-2.5-flash.
 *
 * Se descartó gemini-2.5-flash-lite (o el equivalente 2.0) por ser más
 * débil siguiendo instrucciones al pie de la letra — acá eso importa de
 * verdad: el prompt exige JSON estricto + reglas de desambiguación, y
 * "casi bien" en este caso significa un evento con la fecha mal resuelta.
 * Se descartó gemini-2.5-pro por costo/latencia innecesarios para extraer
 * texto corto (la clave la paga el usuario mismo con su cuota gratuita de
 * AI Studio, y esto no necesita razonamiento profundo).
 * gemini-2.5-flash es el punto medio: lo bastante barato/rápido para que
 * el usuario prácticamente no lo note, y lo bastante capaz para no fallar
 * la extracción ni la desambiguación.
 */
const MODELO_GEMINI = "gemini-2.5-flash";

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
 * `materia_matriculada_id` queda fuera del JSON a propósito (decisión ya
 * tomada): el usuario vincula la materia a mano en el modal de
 * confirmación, Gemini nunca adivina esa parte. La lista de materias acá
 * solo se usa para dos cosas: (1) que el campo "nombre" use el nombre real
 * tal como está matriculado, no una variante inventada, y (2) para que, si
 * el mensaje es ambiguo entre 2+ materias reales que se parecen, el
 * modelo pregunte en vez de adivinar (ver "aclaracion" más abajo — esta es
 * la pieza central del fallback anti-alucinación acordado).
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
próximo lunes", etc.).

Materias matriculadas reales del usuario ahora mismo:
${listaMaterias}

Devolvé ÚNICAMENTE un JSON con esta forma exacta:
{
  "items": [
    {
      "tipo": "evento" | "tarea" | "examen",
      "nombre": "string corto y descriptivo",
      "fecha": "YYYY-MM-DD",
      "hora": "HH:MM" | null,
      "notas": "string, puede ser vacío"
    }
  ],
  "aclaracion": "string" | null
}

Reglas:
- "examen" para exámenes/parciales/quices; "tarea" para tareas/entregas/
  proyectos; "evento" para cualquier otra cosa (charlas, reuniones, citas,
  etc.).
- Si no se menciona hora puntual, "hora" es null (día completo).
- Un solo mensaje puede describir más de un ítem — devolvé todos los que
  encuentres en "items".
- Si el mensaje nombra una materia que coincide claramente con una de la
  lista de arriba, usá el nombre EXACTO de la lista dentro del campo
  "nombre" (ejemplo: si dice "examen de cálculo" y en la lista está
  "Cálculo I", el nombre del ítem debe ser "Examen de Cálculo I", no una
  variante inventada).
- Si el mensaje es realmente ambiguo entre 2 o más materias de la lista
  (ej. existen "Cálculo I" y "Cálculo II" y el usuario solo dijo
  "cálculo", sin forma de saber cuál con el resto del mensaje), NO
  adivines: devolvé "items": [] y explicá la duda en "aclaracion" con una
  pregunta corta y directa (ej. "¿Te referís a Cálculo I o Cálculo II?").
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
 * Tarjeta de confirmación de UN ítem extraído — no crea nada en Agenda
 * directamente. "Agregar a Agenda" abre el modal real con datosIniciales
 * precargado (ver abrirModalEventoAgenda en agenda-modal.js), para que el
 * usuario revise/edite/vincule materia antes de guardar de verdad.
 */
function crearTarjetaItemExtraido(item) {
  const emojiTipo = item.tipo === "examen" ? "📝" : item.tipo === "tarea" ? "✅" : "📌";
  const card = document.createElement("div");
  card.className = "glass-card stack";
  card.style.cssText = "align-self: stretch; padding: 10px 12px; gap: 6px;";

  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  titulo.textContent = `${emojiTipo} ${item.nombre}`;
  card.appendChild(titulo);

  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.fontSize = "0.85rem";
  const partesFecha = [item.fecha];
  if (item.hora) partesFecha.push(item.hora);
  detalle.textContent = partesFecha.join(" · ");
  card.appendChild(detalle);

  if (item.notas) {
    const notas = document.createElement("div");
    notas.className = "muted";
    notas.style.fontSize = "0.82rem";
    notas.textContent = item.notas;
    card.appendChild(notas);
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.className = "btn btn-primary btn-block";
  btnAgregar.textContent = "Agregar a Agenda";
  btnAgregar.onclick = () => {
    abrirModalEventoAgenda({
      datosIniciales: {
        tipo: item.tipo,
        nombre: item.nombre,
        fecha: item.fecha,
        hora: item.hora || null,
        notas: item.notas || "",
      },
    });
  };
  card.appendChild(btnAgregar);

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
 * como la reconstrucción desde historial (reconstruirChatDesdeHistorial),
 * para que ambos caminos terminen viéndose exactamente igual.
 */
function mostrarResultadoEnChat(resultado) {
  if (resultado.items.length === 0 && resultado.aclaracion) {
    agregarBurbujaAlDom(crearBurbuja("modelo", resultado.aclaracion));
  } else if (resultado.items.length === 0) {
    agregarBurbujaAlDom(crearBurbuja("modelo", MENSAJE_FALLBACK));
  } else {
    const resumen = resultado.items.length === 1 ? "Encontré esto:" : `Encontré ${resultado.items.length} cosas:`;
    agregarBurbujaAlDom(crearBurbuja("modelo", resumen));
    resultado.items.forEach((item) => agregarBurbujaAlDom(crearTarjetaItemExtraido(item)));
  }
}

/* ===================== Envío de mensajes ===================== */

function actualizarEstadoEnvio() {
  const input = document.getElementById("input-asistente-mensaje");
  const btn = document.getElementById("btn-asistente-enviar");
  if (input) input.disabled = enviandoMensaje;
  if (btn) btn.disabled = enviandoMensaje;
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
    conversacionActual.push({ rol: "modelo", texto: resultado.crudo, crudo: resultado.crudo });
    mostrarResultadoEnChat(resultado);
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
  tarjeta.className = "glass-card stack";
  tarjeta.style.gap = "10px";

  const encabezado = document.createElement("div");
  encabezado.className = "row-between";
  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.textContent = "✨ Asistente IA";
  encabezado.appendChild(titulo);
  const btnNueva = document.createElement("button");
  btnNueva.className = "btn btn-secondary";
  btnNueva.title = "Nueva conversación";
  btnNueva.textContent = "🔄 Nueva";
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
    "display:flex; flex-direction:column; gap:8px; overflow-y:auto; min-height:320px; max-height:calc(100vh - 300px); padding:4px 2px;";
  tarjeta.appendChild(scroll);

  const filaInput = document.createElement("div");
  filaInput.className = "row";
  filaInput.style.gap = "8px";
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
  btnEnviar.className = "btn btn-primary";
  btnEnviar.textContent = "Enviar";
  btnEnviar.onclick = manejarEnvioMensaje;
  filaInput.appendChild(input);
  filaInput.appendChild(btnEnviar);
  tarjeta.appendChild(filaInput);

  contenedor.appendChild(tarjeta);
}

function mostrarSaludoInicial() {
  agregarBurbujaAlDom(
    crearBurbuja(
      "modelo",
      'Contame qué tarea, examen o evento querés agregar y te armo el borrador. Por ejemplo: "tengo examen de anatomía el jueves a las 2pm".'
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
      mostrarResultadoEnChat({
        items: Array.isArray(parseado.items) ? parseado.items : [],
        aclaracion: parseado.aclaracion || null,
      });
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
