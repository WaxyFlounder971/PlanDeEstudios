/* =========================================================================
   HORARIO — Núcleo (grid semanal, navegación entre semanas, config de días)
   No incluye "Horario entre Amigos" (prompt aparte).
   ========================================================================= */

import { calcularNumeroSemanaSemestre, obtenerClasesEfectivasSemana, crearDiaCronograma, sellarTimestamp } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { mostrarToast } from "../ui/componentes.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { obtenerSemestresOrdenCronologico, buscarSemestreVivoPorId } from "../semestres/semestres.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import {
  abrirModalBloqueHorario,
  construirZonaCronograma,
  // Re-exportada más abajo para agenda-clases.js (ver comentario en ese
  // export) — vive en horario-modal.js porque es el inverso de
  // calcularFechaClaseSemana, que ya está ahí.
  calcularNumeroSemanaSinAcotarParaFecha,
} from "./horario-modal.js";
import {
  abrirPanelAmigos,
  inicializarHorarioAmigos,
  obtenerListaAmigosParaDiaConjunto,
  refrescarSnapshotsAmigos,
  obtenerSnapshotAmigoPorId,
  obtenerDiasConClaseAmigosVinculados,
  calcularNumeroSemanaAmigo,
  // FIX (reporte: "el switch de ocultar amigo no hace nada"): el toggle
  // "Mostrar/Ocultar en el horario" del panel de Amigos guardaba su
  // preferencia pero nada la leía (la franja superpuesta en el horario
  // propio, que sí la respetaba, se había quitado en otro cambio). Ahora
  // controla si el amigo aparece en Horario conjunto y en su vista
  // individual — ver renderizarConjuntoModoDia/Semana y
  // renderizarVistaIndividualAmigoInterno más abajo.
  obtenerFileIdsOcultos,
} from "./horario-amigos.js";

const PX_POR_MIN_EXPANDIDO = 0.84; // 30% menos que antes (1.2), pedido explícito

/**
 * Rango de horas visibles en el grid (Ajustes → Horario). Antes el grid
 * siempre dibujaba las 24h completas; ahora el usuario puede acortar el
 * rango (ej. 6am–11pm) para no scrollear horas muertas que nunca usa.
 * Guardado como enteros 0-24 (hora_inicio puede ser 0=12am, hora_fin hasta
 * 24=12am del día siguiente). Default: rango completo (ambos "12 am").
 */
function obtenerRangoHorasHorario() {
  const cfg = estado.datos.configuracion || {};
  let horaInicio = Number.isFinite(cfg.horario_hora_inicio) ? cfg.horario_hora_inicio : 0;
  let horaFin = Number.isFinite(cfg.horario_hora_fin) ? cfg.horario_hora_fin : 24;
  horaInicio = Math.min(Math.max(horaInicio, 0), 23);
  horaFin = Math.min(Math.max(horaFin, 1), 24);
  if (horaFin <= horaInicio) horaFin = 24; // rango inválido guardado -> cae a día completo
  return { horaInicio, horaFin };
}

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * visto en el resto de la app): estas 8 líneas estaban a nivel de módulo.
 * Se mueven a una guardia lazy, llamada desde CADA punto de entrada
 * exportado que las toca — no alcanza con ponerla solo en
 * renderizarHorario/inicializarHorario porque obtenerSemestreHorarioActual,
 * activarModoConjunto (alias abrirHorarioConjunto) y
 * activarVistaIndividualAmigo (alias abrirVistaIndividualAmigo) también
 * están exportadas y otros archivos (agenda.js, agenda-calendario.js,
 * agenda-materia.js, resumen.js) pueden llamarlas directo, sin pasar
 * primero por un render de la sección Horario.
 */
function inicializarEstadoHorarioSiHaceFalta() {
  // Qué se está mostrando ahora mismo en Horario.
  if (typeof estado.horarioSemestreId === "undefined") estado.horarioSemestreId = null;
  if (typeof estado.horarioNumeroSemana === "undefined") estado.horarioNumeroSemana = null;
  if (typeof estado.horarioExpandido === "undefined") estado.horarioExpandido = false;
  // Horario conjunto: NO es un modal — reemplaza temporalmente el contenido
  // de #horario-grid (ver renderizarHorarioInterno). horarioModoConjunto
  // indica si está activo ahora mismo; horarioConjuntoDiaIdx es el índice
  // (dentro de obtenerDiasVisiblesOrdenados) del día que se está mostrando
  // ahí. null = todavía no se activó esta sesión.
  if (typeof estado.horarioModoConjunto === "undefined") estado.horarioModoConjunto = false;
  if (typeof estado.horarioConjuntoDiaIdx === "undefined") estado.horarioConjuntoDiaIdx = null;
  // "dia" | "semana" — se resetea a "dia" en cada carga de página a
  // propósito, no se persiste ninguna preferencia.
  if (typeof estado.horarioConjuntoVista === "undefined") estado.horarioConjuntoVista = "dia";
  // Nivel de zoom del modo Semana.
  if (typeof estado.horarioConjuntoSemanaZoom === "undefined") estado.horarioConjuntoSemanaZoom = 1;
  // Vista individual de UN amigo en pantalla completa. null = no está
  // activa. Mutuamente excluyente con horarioModoConjunto.
  if (typeof estado.horarioVistaIndividualAmigoFileId === "undefined") estado.horarioVistaIndividualAmigoFileId = null;
}

// Cache del último semestre/semana renderizados, para que centrarVistaInicial
// no tenga que recalcular nada por su cuenta.
let cacheSemestre = null;
let cacheNumeroSemana = null;

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

function obtenerSemestreHorarioActual() {
  inicializarEstadoHorarioSiHaceFalta();
  if (estado.horarioSemestreId) {
    const vivo = buscarSemestreVivoPorId(estado.horarioSemestreId);
    if (vivo) return vivo;
  }
  const cronologico = obtenerSemestresOrdenCronologico();
  if (cronologico.length === 0) return null;
  const actuales = cronologico.filter((s) => s.estado_manual !== "pasado");
  const elegido = actuales[actuales.length - 1] || cronologico[cronologico.length - 1];
  estado.horarioSemestreId = elegido.id;
  return elegido;
}

function obtenerNumeroSemanaMostrado(semestre) {
  if (estado.horarioNumeroSemana == null) {
    estado.horarioNumeroSemana = calcularNumeroSemanaSemestre(semestre);
  }
  const total = Number(semestre.duracion_semanas) || 16;
  estado.horarioNumeroSemana = Math.min(Math.max(estado.horarioNumeroSemana, 1), total);
  return estado.horarioNumeroSemana;
}

function minutosDesdeHora(horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Parsea "YYYY-MM-DD" como fecha LOCAL (medianoche en el huso horario del
 * usuario), no UTC. `new Date("YYYY-MM-DD")` interpreta el string como UTC
 * medianoche — en cualquier huso horario negativo (ej. Costa Rica, UTC-6)
 * eso cae en el día anterior a las 6pm local, y de ahí en adelante toda
 * cuenta basada en .getDate()/.setDate() queda corrida un día. Este era el
 * bug de "hoy es jueves y aparece marcado/mostrado como viernes".
 */
function fechaLocalDesdeISO(str) {
  const soloFecha = String(str || "").slice(0, 10);
  const [y, m, d] = soloFecha.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/**
 * Línea de hora actual — Núcleo: inverso de fechaLocalDesdeISO, para poder
 * marcar cada columna del grid con su fecha real ("YYYY-MM-DD") sin
 * problemas de zona horaria (Date#toISOString usa UTC, que puede correrse
 * un día — mismo bug de fondo que ya se cazó en TeamPeachesHub con
 * cumpleaños/recordatorios). El actualizador periódico de la línea
 * (actualizarPosicionLineaHoraActual) compara contra esto para saber en
 * cuál columna corresponde dibujarla SIN tener que recalcular fechas de
 * semestre otra vez cada minuto.
 */
function fechaAISOLocal(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function obtenerColorBloque(bloqueEfectivo) {
  if (bloqueEfectivo.color) return bloqueEfectivo.color;
  if (!bloqueEfectivo.materia_id) return "#a78bfa";
  const plan = obtenerPlanPorId(bloqueEfectivo.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === bloqueEfectivo.materia_id);
  const categoria = plan && materia && plan.categorias.find((c) => c.id === materia.categoria_id);
  return (categoria && categoria.color) || "#a78bfa";
}

function obtenerNombreBloque(bloqueEfectivo) {
  if (bloqueEfectivo.apodo) return bloqueEfectivo.apodo;
  if (!bloqueEfectivo.materia_id) return bloqueEfectivo.nombre || "Personalizado";
  const plan = obtenerPlanPorId(bloqueEfectivo.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === bloqueEfectivo.materia_id);
  return (materia && materia.nombre) || "Materia";
}

/** Código de materia del bloque (Parte C / ajuste), o "" si es un bloque
 * personalizado (sin materia_id) — no hay código que mostrar en ese caso. */
function obtenerCodigoBloque(bloqueEfectivo) {
  if (!bloqueEfectivo.materia_id) return "";
  const plan = obtenerPlanPorId(bloqueEfectivo.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === bloqueEfectivo.materia_id);
  return (materia && materia.codigo) || "";
}

/**
 * "Para no gastar espacio": primer nombre + primer apellido completos,
 * cualquier palabra extra (segundo nombre, segundo apellido) se reduce a
 * su inicial. Ej. "Wagner Andrés Obando Salas" -> "Wagner Obando A. S."
 */
function abreviarNombreProfesor(nombreCompleto) {
  const partes = String(nombreCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  const base = partes.slice(0, 2).join(" ");
  const iniciales = partes.slice(2).map((p) => p[0].toUpperCase() + ".").join(" ");
  return `${base} ${iniciales}`;
}

function obtenerNombreProfesor(profesorId) {
  if (!profesorId) return "";
  const prof = (estado.datos.profesores || []).find((p) => p.id === profesorId);
  return prof ? abreviarNombreProfesor(prof.nombre) : "";
}

/**
 * Presencial es el default y no lleva emoji (para no ensuciar la tarjeta
 * en el caso más común). Virtual y Asincrónico sí se marcan en la esquina
 * inferior derecha para que salte a la vista de un vistazo. "sin_clase"
 * (Cronograma, reemplaza al viejo switch `cancelada`) es ahora un valor de
 * modalidad más — viene resuelto ya en el campo `modalidad` de cada clase
 * efectiva (ver obtenerClasesEfectivasSemana en schema.js), así que esta
 * función ya no necesita un segundo parámetro aparte.
 */
function obtenerEmojiModalidad(modalidad) {
  if (modalidad === "sin_clase") return "✖️";
  const normalizado = String(modalidad || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // quita acentos: "asincronico" === "asincrónico"
  if (normalizado.startsWith("virtual")) return "💻";
  if (normalizado.startsWith("asincron")) return "📖";
  return ""; // presencial u otro valor no reconocido: sin emoji
}

/**
 * Rediseño ronda #4 — bug "Sin clase" en las materias inline de Agenda: se
 * mostraba como "Presencial" porque agenda-clases.js armaba el texto con
 * aplicarFormatoTexto (pensado para nombres de materia, no para valores de
 * modalidad) en vez de esta tabla, que ya es la fuente única de verdad para
 * las etiquetas humanas de modalidad en el resto de Horario. Fallback
 * simple (guiones bajos -> espacio, primera letra mayúscula) por si algún
 * día aparece un valor de modalidad que todavía no está en el mapa.
 */
function obtenerEtiquetaModalidad(modalidad) {
  if (ETIQUETAS_MODALIDAD_INFO[modalidad]) return ETIQUETAS_MODALIDAD_INFO[modalidad];
  const texto = String(modalidad || "").replace(/_/g, " ").trim();
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) : "";
}

/**
 * TODOS los 7 días, ordenados según "día de inicio de semana" (Ajustes →
 * Horario) y con la etiqueta corta personalizada aplicada — sin filtrar por
 * "días visibles". Antes esto vivía mezclado dentro de
 * obtenerDiasVisiblesOrdenados(); se separa acá porque el punto 3 del
 * prompt (vista compartida ignora los días ocultos de MI configuración
 * personal) necesita el orden/etiquetas sin el filtro de visibilidad, tanto
 * para el Horario conjunto como para la vista individual de un amigo.
 */
function obtenerDiasOrdenados() {
  const cfg = estado.datos.configuracion;
  const nombres = cfg.nombres_dias_personalizados || {};
  const inicioId = cfg.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const rotado = [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
  return rotado.map((d) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault }));
}

function obtenerDiasVisiblesOrdenados() {
  const cfg = estado.datos.configuracion;
  const visiblesIds = new Set(cfg.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id));
  return obtenerDiasOrdenados().filter((d) => visiblesIds.has(d.id));
}

/**
 * Set de códigos de día ("L","K","M","J","V","S","D") en los que hay al
 * menos un bloque configurado, a partir de una lista de bloques con la
 * misma forma que semestre.bloques_horario o snapshot.bloques (ambos traen
 * `.dias` con `.dia` = código). Reutilizable para "mi" semestre y para el
 * snapshot de un amigo — es la base del punto 3 (mostrar todos los días
 * que ESE horario tenga clases, sin importar configuraciones de
 * visibilidad de nadie).
 */
function obtenerCodigosDiaConClase(bloques) {
  const set = new Set();
  (bloques || []).forEach((b) => {
    (b.dias || []).forEach((d) => {
      if (d && d.dia) set.add(d.dia);
    });
  });
  return set;
}

/**
 * Fecha calendario real de un día dentro de la semana mostrada. ANCLADA al
 * día de la semana REAL de fecha_inicio (vía Date.getDay()), no a la
 * posición que ese día ocupe en la config de "inicio de semana" — antes se
 * asumía que fecha_inicio caía justo en el día configurado como inicio de
 * semana (ej. lunes), pero nada obliga eso al crear un semestre, y cuando
 * no se cumplía TODA la fila de encabezados del grid quedaba corrida
 * (bug real reportado: hoy viernes 14 se mostraba bajo la columna
 * "Sábado"). `diaCodigo` es el código real del día ("L"|"K"|"M"|"J"|"V"|
 * "S"|"D"), no un offset de posición visual.
 */
function calcularFechaDelDia(semestre, numeroSemana, diaCodigo) {
  const inicio = fechaLocalDesdeISO(semestre.fecha_inicio);
  if (isNaN(inicio.getTime())) return null;
  const idxCanonico = DIAS_SEMANA_CONFIG.findIndex((d) => d.abrevDefault === diaCodigo);
  if (idxCanonico === -1) return null;
  // DIAS_SEMANA_CONFIG va lunes→domingo (índices 0-6); Date.getDay() usa
  // domingo=0..sábado=6 — de ahí el +1 % 7 para pasar de un sistema al otro.
  const pesoObjetivo = (idxCanonico + 1) % 7;
  const diffDentroDeSemana = (pesoObjetivo - inicio.getDay() + 7) % 7;
  const fecha = new Date(inicio);
  fecha.setDate(inicio.getDate() + (numeroSemana - 1) * 7 + diffDentroDeSemana);
  return fecha;
}

function esHoy(fecha) {
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() && fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
}

/* ===================== Choques de horario (apilado tipo cartas) ===================== */

function calcularLanesDia(bloquesDia) {
  const ordenados = [...bloquesDia].sort((a, b) => a.inicioMin - b.inicioMin);
  const finesLane = [];
  ordenados.forEach((b) => {
    let lane = finesLane.findIndex((fin) => fin <= b.inicioMin);
    if (lane === -1) {
      lane = finesLane.length;
      finesLane.push(b.finMin);
    } else {
      finesLane[lane] = b.finMin;
    }
    b.lane = lane;
  });
  return ordenados;
}

/* ===================== Construcción del grid ===================== */

/**
 * Lista PLANA de clases efectivas de la semana: una entrada por cada día
 * puntual de cada bloque (no un bloque con .dias anidado como antes) — así
 * cada día ya trae su propia Modalidad resuelta (ver
 * obtenerClasesEfectivasSemana en schema.js, que fusiona la plantilla con
 * el Cronograma de esa semana puntual).
 */
function construirClasesEfectivasSemana(semestre, numeroSemana) {
  return (semestre.bloques_horario || []).flatMap((b) => obtenerClasesEfectivasSemana(b, numeroSemana));
}

function construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango) {
  const col = document.createElement("div");
  col.className = "horario-col-horas";
  col.style.cssText = `position:relative; width:28px; flex-shrink:0; height:${altoGrid}px;`;
  const horaInicio = Math.ceil(minInicioRango / 60);
  const horaFin = Math.floor(minFinRango / 60);
  for (let h = horaInicio; h <= horaFin; h++) {
    const top = (h * 60 - minInicioRango) * pxPorMin;
    // Antes: una sola línea "14:00" en formato 24h. Ahora: dos líneas,
    // número de hora en 12h arriba y am/pm abajo (ej. "2" / "pm"), y con
    // transform:translateY(-50%) las dos líneas quedan centradas
    // verticalmente respecto a la raya que marca esa hora (antes el
    // offset -7px era solo una aproximación para una sola línea).
    const horaMod = h % 24; // h=24 (medianoche del día siguiente) se ve igual que h=0
    const hora12 = horaMod % 12 === 0 ? 12 : horaMod % 12;
    const periodo = horaMod < 12 ? "am" : "pm";
    const etiqueta = document.createElement("div");
    etiqueta.className = "muted";
    // right:2px (antes 6px): ese margen extra era espacio muerto entre el
    // número y el borde de la primera columna de día, sin aportar nada —
    // se recorta al mínimo para que quepa más grid en pantalla, dejando
    // apenas el aire justo para que el texto no se pegue a la línea.
    etiqueta.style.cssText = `position:absolute; top:${top}px; right:2px; transform:translateY(-50%); text-align:center; line-height:1.1;`;
    etiqueta.innerHTML = `<div style="font-size:0.68rem; font-weight:600;">${hora12}</div><div style="font-size:0.56rem;">${periodo}</div>`;
    col.appendChild(etiqueta);
  }
  return col;
}

function construirLineasHorarias(pxPorMin, minInicioRango, minFinRango) {
  const stops = [];
  for (let min = minInicioRango; min <= minFinRango; min += 30) {
    const y = (min - minInicioRango) * pxPorMin;
    const opacidad = min % 60 === 0 ? 0.28 : 0.1;
    stops.push(`linear-gradient(rgba(150,150,170,${opacidad}), rgba(150,150,170,${opacidad})) 0 ${y}px / 100% 1px no-repeat`);
  }
  return stops.join(",\n");
}

/**
 * Línea de hora actual — Núcleo: mismo indicador que Google Calendar, pero
 * pedido explícito: abarca TODO el ancho del grid (todos los días a la
 * vez), no solo la columna de hoy — se posiciona relativa a filaGrid
 * (padre real), con left = ancho de la columna de horas (28px, ver
 * construirColumnaHoras) para no invadir esa columna ni salirse del borde
 * derecho del grid. z-index 35 (ver design-system.css): por encima de las
 * tarjetas de clase (10 + lane) pero por debajo del header sticky (z:50) y
 * de la barra de expandir (z:40) — nunca las tapa.
 */
function construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango) {
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutosAhora < minInicioRango || minutosAhora > minFinRango) return null;
  const top = (minutosAhora - minInicioRango) * pxPorMin;
  const linea = document.createElement("div");
  linea.className = "horario-linea-hora-actual";
  linea.style.top = `${top}px`;
  // 28px: mismo ancho que .horario-col-horas (ver construirColumnaHoras) —
  // sin esto la línea arranca en left:0 de filaGrid (default de la clase
  // CSS), que es el borde IZQUIERDO de la columna de horas, invadiéndola.
  // Con este offset arranca justo donde arranca el primer día, y con
  // right:0 (CSS) llega exacto hasta el borde derecho del último día —
  // nunca se sale de las líneas de borde laterales del grid de días.
  linea.style.left = "28px";
  linea.innerHTML = `<span class="horario-linea-hora-actual-punto"></span>`;
  return linea;
}

/**
 * Mueve la línea cada 60s sin re-renderizar todo el grid (eso perdería la
 * posición de scroll). Ya no hace falta decidir "cuál columna es hoy" acá
 * (la línea siempre abarca el grid entero) — solo si sigue siendo válido
 * mostrarla: que exista (se dibujó porque la semana visible incluye hoy) y
 * que la hora actual siga dentro del rango configurado.
 */
function actualizarPosicionLineaHoraActual() {
  const linea = document.querySelector(".horario-linea-hora-actual");
  if (!linea) return;
  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutosAhora < minInicioRango || minutosAhora > minFinRango) {
    linea.remove();
    return;
  }
  linea.style.top = `${(minutosAhora - minInicioRango) * PX_POR_MIN_EXPANDIDO}px`;
}

// Nota: el horario default (grid semanal de siempre) ya NO muestra nada de
// amigos superpuesto — la franja lateral con los bloques ajenos que vivía
// acá se quitó porque ahora existe una vista dedicada para eso ("Horario
// conjunto", ver más abajo), y mezclar los dos conceptos en la misma
// pantalla generaba ruido visual innecesario en el uso del día a día.

/**
 * Oculta el botón "Entrar" de una tarjeta SOLO si de verdad no cabe — se
 * llama DESPUÉS de que el grid ya está en el DOM, así getBoundingClientRect()
 * da el tamaño real ya renderizado (fuente, padding, ancho de columna real)
 * en vez de adivinar con un breakpoint de pantalla, que escondía el botón
 * incluso en tarjetas donde sí entraba perfecto (pocas materias ese día →
 * columna más ancha → nunca chocan).
 *
 * El límite derecho es el MISMO para todas las tarjetas del grid, tengan o
 * no tengan emoji de modalidad — antes se comparaba cada tarjeta contra SU
 * PROPIO emoji (o su propio borde si no tenía ninguno), y como sin emoji
 * sobra casi toda la tarjeta libre, el botón prácticamente nunca chocaba
 * ahí: en la práctica solo se ocultaba en las materias CON emoji, que son
 * justo las que más necesitan el link (suelen ser las virtuales). Ahora se
 * reserva el mismo ancho de "espacio para emoji" en TODAS las tarjetas —
 * medido del emoji real de cualquier materia que sí lo tenga en este grid,
 * para no hardcodear un número que se desincronice si cambia el font-size —
 * así el criterio de "cabe o no cabe" es uno solo para toda la semana.
 */
function ocultarBotonesEntrarQueChocan(cont) {
  const GAP_ENTRE_BOTON_Y_EMOJI = 3;
  const ANCHO_EMOJI_FALLBACK = 21; // si este grid no tiene NINGÚN emoji visible para medir
  const emojiDeReferencia = cont.querySelector(".horario-emoji-modalidad");
  const anchoReservadoEmoji = emojiDeReferencia
    ? emojiDeReferencia.getBoundingClientRect().width + GAP_ENTRE_BOTON_Y_EMOJI
    : ANCHO_EMOJI_FALLBACK;

  cont.querySelectorAll(".horario-bloque-tarjeta").forEach((tarjeta) => {
    const entrar = tarjeta.querySelector(".horario-btn-entrar-clase");
    if (!entrar) return;
    entrar.style.display = ""; // por si quedó oculto de un render anterior con menos espacio
    const rTarjeta = tarjeta.getBoundingClientRect();
    const rEntrar = entrar.getBoundingClientRect();
    // 5px: mismo margen right:5px que usa el emoji.
    const limiteDerecho = rTarjeta.right - 5 - anchoReservadoEmoji;
    if (rEntrar.right > limiteDerecho) entrar.style.display = "none";
  });
}

function construirColumnaDia(dia, bloquesDia, semestre, pxPorMin, altoGrid, minInicioRango, minFinRango) {
  const col = document.createElement("div");
  col.className = "horario-col-dia";
  col.dataset.diaCodigo = dia.abrevDefault;
  col.style.cssText = `position:relative; flex:1; min-width:56px; height:${altoGrid}px; background:${construirLineasHorarias(pxPorMin, minInicioRango, minFinRango)}; cursor:pointer; border-left:1px solid rgba(150,150,170,0.15);`;

  const conLanes = calcularLanesDia(bloquesDia);
  conLanes.forEach((b) => {
    // Recorte al rango configurado (Ajustes → Horario): un bloque que
    // empieza o termina fuera del rango visible se corta en el borde; si
    // queda enteramente fuera, no se dibuja (sigue existiendo en los datos).
    const inicioClamp = Math.max(b.inicioMin, minInicioRango);
    const finClamp = Math.min(b.finMin, minFinRango);
    if (finClamp <= inicioClamp) return;
    const top = Math.max(0, (inicioClamp - minInicioRango) * pxPorMin);
    const alto = Math.max(24, (finClamp - inicioClamp) * pxPorMin);
    const offsetPx = b.lane * 12;
    const tarjeta = document.createElement("div");
    tarjeta.className = "horario-bloque-tarjeta";
    // Buscar materia en... (Parte C): permite ubicar el bloque de una
    // materia puntual con un selector estable, sin depender de posición.
    if (b.materia_id) tarjeta.dataset.materiaId = b.materia_id;
    // "sin_clase" (Cronograma): la tarjeta sigue ocupando su lugar en el
    // grid (no se oculta, ver obtenerClasesEfectivasSemana en schema.js)
    // pero se atenúa para que salte a la vista que ese día puntual no hay
    // clase, sin tener que leer el emoji chiquito de la esquina.
    const esSinClase = b.modalidad === "sin_clase";
    tarjeta.style.cssText = `position:absolute; top:${top}px; left:${offsetPx}px; right:0; height:${alto}px; z-index:${10 + b.lane};
      background:${b.color}; color:#fff; border-radius:8px; padding:3px 6px; overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.25);
      ${esSinClase ? "opacity:0.45;" : ""}`;
    // Tamaños en rem (no px fijo) para que respeten el mismo escalado que el
    // resto de la app (0.85rem para el nombre, igual que la mayoría del
    // texto "normal" del sistema; 0.72rem para los datos secundarios, igual
    // que las etiquetas pequeñas como .materia-codigo) — antes eran px fijos
    // más grandes que el resto de la UI y en pantallas angostas cortaban
    // palabras. word-break + overflow-wrap dejan que el texto se ajuste en
    // vez de cortarse a la mitad de una palabra.
    const emojiModalidad = obtenerEmojiModalidad(b.modalidad);
    // Botón "Entrar" solo si la tarjeta tiene alto real para mostrarlo sin
    // pisar el nombre/profesor/aula — antes se dibujaba siempre que hubiera
    // b.enlace, y en tarjetas cortas (típico en teléfono, donde pxPorMin es
    // menor) quedaba superpuesto sobre el resto del texto, generando clicks
    // erróneos. Se estima el alto que ya ocupa el contenido de texto
    // (título ~17px + una línea por profesor/aula si existen, más el
    // padding vertical de la tarjeta) y solo se agrega el link si sobra
    // espacio para su propia línea (~16px) sin invadir eso.
    const lineasTexto = 1 + (b.profesorNombre ? 1 : 0) + (b.aula ? 1 : 0);
    const altoTextoEstimado = 6 /* padding vertical */ + lineasTexto * 15;
    const cabeEntrar = alto >= altoTextoEstimado + 16;
    // Punto 4 del ajuste a Horario propio: el ✎ que marcaba "esta semana
    // tiene un ajuste puntual" se sacó de acá (pedido explícito). Se
    // confirmó que no se usa/muestra en ningún otro lugar (ni Agenda ni
    // otro archivo referencian tieneExcepcionEstaSemana), así que se quita
    // del todo en vez de moverlo — no queda ninguna referencia visual a la
    // excepción en el grid de Horario.
    tarjeta.innerHTML = `
      <div style="font-size:0.85rem; font-weight:600; line-height:1.15; display:flex; align-items:center; gap:4px; margin-bottom:2px; overflow-wrap:break-word; word-break:break-word;">
        <span>${b.nombreCorto}</span>
      </div>
      ${b.profesorNombre ? `<div style="font-size:0.72rem; opacity:0.9; overflow-wrap:break-word; word-break:break-word;">${b.profesorNombre}</div>` : ""}
      ${b.aula ? `<div style="font-size:0.72rem; opacity:0.85; overflow-wrap:break-word; word-break:break-word;">${b.aula}</div>` : ""}
      ${emojiModalidad ? `<span class="horario-emoji-modalidad" title="${b.modalidad}" style="position:absolute; right:5px; bottom:3px; font-size:1.17rem; line-height:1;">${emojiModalidad}</span>` : ""}
      ${b.enlace && cabeEntrar ? `<a href="${b.enlace}" target="_blank" rel="noopener" class="horario-btn-entrar-clase" style="position:absolute; left:5px; bottom:3px; line-height:1;" onclick="event.stopPropagation()">Entrar</a>` : ""}
    `;
    tarjeta.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirTarjetaInfoBloque(semestre, cacheNumeroSemana, b);
    });
    col.appendChild(tarjeta);
  });

  col.addEventListener("click", (ev) => {
    if (ev.target !== col) return;
    const rect = col.getBoundingClientRect();
    const offsetY = ev.clientY - rect.top;
    const minutos = minInicioRango + Math.round(offsetY / pxPorMin / 15) * 15;
    mostrarBloqueFlotante(semestre, dia, minutos, ev.clientX, ev.clientY);
  });

  return col;
}

/* ===================== Tarjeta de información (1er tap sobre un bloque existente) ===================== */

/**
 * Antes, tocar una tarjeta ya existente abría directo el editor. Ahora abre
 * primero esta tarjeta de solo-lectura con los datos de la clase — el
 * editor real queda un tap más allá, en el botón "Editar" de acá abajo.
 */
function abrirTarjetaInfoBloque(semestre, numeroSemana, b) {
  document.getElementById("horario-info-overlay")?.remove();

  const emojiModalidad = obtenerEmojiModalidad(b.modalidad);
  const overlay = document.createElement("div");
  overlay.id = "horario-info-overlay";
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="glass-panel modal-card" style="padding:0; overflow:hidden;">
      <div style="height:8px; background:${b.color};"></div>
      <button type="button" class="modal-x-close horario-info-x-plana" id="horario-info-cerrar">✕</button>
      <div style="padding:20px;">
        ${obtenerCodigoBloque(b) ? `<div class="muted" style="font-size:0.78rem;">${obtenerCodigoBloque(b)}</div>` : ""}
        <div style="font-size:1.05rem; font-weight:700; padding-right:28px; overflow-wrap:break-word;">${b.nombreCorto}</div>
        <div class="muted" style="font-size:0.78rem; margin-bottom:16px;">Semana ${numeroSemana}</div>
        <div class="stack" style="gap:12px;">
          ${b.profesorNombre ? `
            <div>
              <div class="muted" style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.02em;">Profesor</div>
              <div style="overflow-wrap:break-word;">${b.profesorNombre}</div>
            </div>` : ""}
          <div>
            <div class="muted" style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.02em;">Modalidad</div>
            <div>${emojiModalidad ? emojiModalidad + " " : ""}${ETIQUETAS_MODALIDAD_INFO[b.modalidad] || b.modalidad || "Presencial"}</div>
          </div>
          ${b.aula ? `
            <div>
              <div class="muted" style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.02em;">Aula</div>
              <div style="overflow-wrap:break-word;">${b.aula}</div>
            </div>` : ""}
          ${b.enlace ? `<a href="${b.enlace}" target="_blank" rel="noopener" class="horario-btn-entrar-clase" style="display:inline-block; width:fit-content; background:${b.color}; color:#fff;">Entrar</a>` : ""}
          ${b.notas ? `
            <div>
              <div class="muted" style="font-size:0.68rem; text-transform:uppercase; letter-spacing:0.02em;">Notas</div>
              <div style="white-space:pre-wrap; overflow-wrap:break-word;">${b.notas}</div>
            </div>` : ""}
        </div>
        <div id="horario-info-cronograma-cont"></div>
        <button type="button" class="btn-discreto" id="horario-info-editar" style="width:100%; margin-top:20px; text-align:center;">✎ Editar</button>
      </div>
    </div>
  `;
  (document.fullscreenElement || document.body).appendChild(overlay);

  // Cronograma de clases: mismo widget del modal de editar, reusado acá en
  // solo-lectura + edición puntual de modalidad (ver construirZonaCronograma
  // en horario-modal.js). Necesita el bloque REAL (con .dias/.cronograma_dias),
  // no la clase efectiva ya aplanada que llega en `b`.
  const bloqueReal = (semestre.bloques_horario || []).find((bl) => bl.id === b.bloqueOriginalId);
  if (bloqueReal) {
    document.getElementById("horario-info-cronograma-cont").appendChild(
      construirZonaCronograma(semestre, bloqueReal, { semanaInicial: numeroSemana })
    );
  }

  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) cerrar(); });
  document.getElementById("horario-info-cerrar").addEventListener("click", cerrar);
  document.getElementById("horario-info-editar").addEventListener("click", () => {
    cerrar();
    abrirModalBloqueHorario({ semestreId: semestre.id, bloqueId: b.bloqueOriginalId, numeroSemanaVista: numeroSemana });
  });
}

const ETIQUETAS_MODALIDAD_INFO = { presencial: "Presencial", virtual: "Virtual", asincronica: "Asincrónica", sin_clase: "Sin clase" };

/* ===================== Bloque flotante (1er tap → borrador; 2do tap → modal) ===================== */

function mostrarBloqueFlotante(semestre, dia, minutosInicio, clientX, clientY) {
  const cont = document.getElementById("modal-bloque-flotante");
  if (!cont) return;
  const plan = obtenerPlanActivo();
  const duracion = (plan && plan.parametros_universidad && plan.parametros_universidad.horario_duracion_bloque_min) || 50;
  const horaInicio = `${String(Math.floor(minutosInicio / 60)).padStart(2, "0")}:${String(minutosInicio % 60).padStart(2, "0")}`;
  const finMin = minutosInicio + duracion;
  const horaFin = `${String(Math.floor(finMin / 60)).padStart(2, "0")}:${String(finMin % 60).padStart(2, "0")}`;

  const ANCHO_TARJETA = 200;
  const ALTO_TARJETA_APROX = 60;
  const left = Math.min(Math.max(8, clientX - ANCHO_TARJETA / 2), window.innerWidth - ANCHO_TARJETA - 8);
  const top = Math.min(Math.max(8, clientY - ALTO_TARJETA_APROX - 12), window.innerHeight - ALTO_TARJETA_APROX - 8);

  cont.classList.remove("oculto");
  cont.innerHTML = `
    <div id="horario-flotante-tarjeta" class="glass-panel" style="position:fixed; z-index:200; padding:8px 12px; border-radius:10px;
      width:${ANCHO_TARJETA}px; backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.3); cursor:pointer;
      box-shadow:0 6px 20px rgba(0,0,0,0.35); top:${top}px; left:${left}px;">
      <div style="font-weight:600; font-size:0.85rem;">Nuevo bloque — ${dia.etiqueta}</div>
      <div class="muted" style="font-size:0.75rem;">${horaInicio} – ${horaFin} · tocá para completar</div>
    </div>
    <div id="horario-flotante-fondo" style="position:fixed; inset:0; z-index:199;"></div>
  `;

  const cerrar = () => {
    cont.classList.add("oculto");
    cont.innerHTML = "";
  };
  document.getElementById("horario-flotante-fondo").addEventListener("click", cerrar);
  document.getElementById("horario-flotante-tarjeta").addEventListener("click", () => {
    cerrar();
    abrirModalBloqueHorario({
      semestreId: semestre.id,
      bloqueId: null,
      diaPreseleccionado: dia.abrevDefault,
      horaInicioPreseleccionada: horaInicio,
      horaFinPreseleccionada: horaFin,
    });
  });
}

/* ===================== Selector de semestre (tap en el nombre) ===================== */

function abrirSelectorSemestre() {
  const modal = document.getElementById("modal-selector-semestre");
  const cont = document.getElementById("selector-semestre-contenido");
  if (!modal || !cont) return;
  // obtenerSemestresOrdenCronologico() es ascendente (más viejo primero) —
  // otras partes del código dependen de ese orden (ej. obtenerSemestreHorarioActual
  // usa el último del arreglo como "el más reciente"), así que no se toca
  // esa función; para este listado se usa una copia invertida, solo para
  // mostrar, de más reciente a más viejo como se pidió.
  const semestres = [...obtenerSemestresOrdenCronologico()].reverse();

  cont.innerHTML = `
    <h3>Elegir semestre</h3>
    <div class="stack" id="selector-semestre-lista" style="gap:8px; max-height:60vh; overflow-y:auto;"></div>
  `;
  const lista = document.getElementById("selector-semestre-lista");
  if (semestres.length === 0) {
    lista.innerHTML = `<p class="muted">No hay semestres todavía.</p>`;
  }
  semestres.forEach((s) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "glass-panel";
    item.style.cssText = "text-align:left; padding:10px 14px; cursor:pointer; border:none; width:100%;";
    const inicio = fechaLocalDesdeISO(s.fecha_inicio);
    const finEstimado = new Date(inicio);
    finEstimado.setDate(inicio.getDate() + (Number(s.duracion_semanas) || 16) * 7);
    const fmt = (d) => (isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" }));
    // Antes no tenía color propio y heredaba negro por defecto (ilegible
    // en modo oscuro) — se fija al color de texto normal del tema, y el
    // nombre queda 20% más grande (0.95rem ≈ 1.2 × 0.78rem, el tamaño base
    // que ya traía la fecha de abajo) tal como se pidió.
    item.innerHTML = `<div style="font-weight:600; font-size:0.95rem; color:var(--text-primary);">${s.nombre}</div><div class="muted" style="font-size:0.78rem;">${fmt(inicio)} – ${fmt(finEstimado)}</div>`;
    item.addEventListener("click", () => {
      estado.horarioSemestreId = s.id;
      estado.horarioNumeroSemana = null; // recalcula al entrar a ese semestre
      modal.classList.add("oculto");
      renderizarHorario();
    });
    lista.appendChild(item);
  });

  modal.classList.remove("oculto");
}

/* ===================== Header ===================== */

function renderizarHeaderHorario(semestre, numeroSemana) {
  const nombreEl = document.getElementById("horario-nombre-semestre");
  const semanaEl = document.getElementById("horario-semana-actual");
  const fechaEl = document.getElementById("horario-fecha-actual");
  if (!semestre) {
    if (nombreEl) nombreEl.textContent = "Sin semestres";
    if (semanaEl) semanaEl.textContent = "—";
    if (fechaEl) fechaEl.textContent = "";
    return;
  }
  if (nombreEl) nombreEl.textContent = semestre.nombre || "";
  if (semanaEl) semanaEl.textContent = `Semana ${numeroSemana}`;
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString("es-CR", { day: "numeric", month: "short" });
}

/* ===================== Vista inicial (centra en la clase más temprana / hora actual) ===================== */

function centrarVistaInicial(contenedor, minutosClases, pxPorMin, minInicioRango, minFinRango) {
  const hoy = new Date();
  // Antes solo miraba las clases de HOY (y si hoy no había, caía a la hora
  // actual) — por eso casi nunca arrancaba en la primera clase real: si hoy
  // no tenías clase a esa hora, se iba a la hora del reloj en vez de a la
  // materia más temprana. Ahora se recibe ya armada la lista de minutos de
  // inicio a considerar (arma esa lista cada llamador: el grid semanal pasa
  // todas las clases de la semana visible; el modo conjunto pasa las del
  // día actual, mías + de todos los amigos) y solo si viene vacía se usa la
  // hora actual como último recurso.
  const minutoReferenciaCrudo = minutosClases.length > 0
    ? Math.min(...minutosClases)
    : hoy.getHours() * 60 + hoy.getMinutes();
  // Recorta la referencia al rango visible configurado, si no el destino de
  // scroll podría caer fuera del alto real del grid.
  const minutoReferencia = Math.min(Math.max(minutoReferenciaCrudo, minInicioRango), minFinRango);
  // Antes restaba 80px de "aire" arriba de la clase — con el zoom actual
  // (pxPorMin ≈ 0.84) eso son ~95 minutos, así que una clase a las 9:30
  // terminaba mostrando la vista arrancando cerca de las 8:00. Se deja un
  // margen chico (~14px, un par de líneas de grid) en vez de casi 1h35.
  const destino = Math.max(0, (minutoReferencia - minInicioRango) * pxPorMin - 14);
  if (document.fullscreenElement) {
    document.fullscreenElement.scrollTop = destino;
  } else if (estado.horarioExpandido) {
    window.scrollTo({ top: window.scrollY + destino - window.innerHeight / 3 });
  } else {
    // Modo cerrado por defecto: ya no comprime todo el día para que quepa,
    // corta a la altura disponible y usa su propio scroll vertical interno,
    // arrancando en la hora más temprana que haya en materias registradas
    // (o la hora actual si no hay ninguna clase registrada).
    contenedor.scrollTop = destino;
  }
}

// FIX (reporte: el botón de salir de pantalla completa "se sobrepone a
// otro botón y se ve roto"): antes vivía con position:absolute; top:8px;
// right:8px colgado directo de #horario-grid-contenedor, flotando sobre
// TODO el contenido (incluida la fila de días, ancha, sin margen
// reservado) — por eso tapaba/pisaba el día más a la derecha en la vista
// propia. Ahora se ancla DENTRO de la fila de título/navegación angosta de
// cada una de las 3 vistas (propia, conjunto, individual de amigo), que sí
// tiene aire libre a la derecha de su contenido centrado. Se reutiliza
// siempre el MISMO nodo (creado una sola vez en inicializarHorario) para no
// perder su listener de click al reubicarlo — appendChild solo lo mueve,
// nunca lo clona.
function anclarBotonSalirFSEnFila(fila) {
  const btn = document.getElementById("btn-horario-salir-pantalla-completa");
  if (!btn || !fila) return;
  fila.style.position = "relative";
  if (btn.parentElement !== fila) fila.appendChild(btn);
}

/* ===================== Render principal ===================== */

function renderizarHorarioInterno() {
  const cont = document.getElementById("horario-grid");
  const contenedor = document.getElementById("horario-grid-contenedor");
  if (!cont || !contenedor) return;
  const semestre = obtenerSemestreHorarioActual();
  const numeroSemana = semestre ? obtenerNumeroSemanaMostrado(semestre) : null;
  cacheSemestre = semestre;
  cacheNumeroSemana = numeroSemana;
  renderizarHeaderHorario(semestre, numeroSemana);
  cont.innerHTML = "";

  if (!semestre) {
    if (estado.horarioModoConjunto) {
      renderizarHorarioConjuntoInterno(cont, null, null);
    } else if (estado.horarioVistaIndividualAmigoFileId) {
      renderizarVistaIndividualAmigoInterno(cont, null, null);
    } else {
      cont.innerHTML = `<p class="muted" style="padding:16px;">Creá un semestre en la sección Semestres para empezar a armar tu horario.</p>`;
    }
    return;
  }

  const dias = obtenerDiasVisiblesOrdenados();
  const clasesEfectivas = construirClasesEfectivasSemana(semestre, numeroSemana);

  // Ya no se comprime el día completo para que "quepa" (se veía feo y
  // amontonado) — siempre se usa el tamaño legible normal. Lo que cambia
  // según el modo es cuánto se ve sin scroll:
  //  - Fullscreen: recorta a 100vh, scroll vertical propio.
  //  - Expandido (barra abierta): sin recorte, scrollea la página entera.
  //  - Cerrado (default): recorta a altoDisponible y scrollea internamente,
  //    arrancando en la clase más temprana del día (ver centrarVistaInicial).
  const pxPorMin = PX_POR_MIN_EXPANDIDO;
  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const altoGrid = (minFinRango - minInicioRango) * pxPorMin;
  // Antes se restaba un estimado fijo (ALTO_RESERVADO_CHROME) del alto de
  // pantalla, que no siempre coincidía con el chrome real arriba del grid
  // (header de horario, nav, etc. cambian de alto según la pantalla). Ahora
  // se mide la posición real del contenedor y se usa TODO el espacio que
  // queda hasta el fondo — así el cuadro siempre llega hasta el final de la
  // pantalla sin tener que abrir el modo expandido.
  const paddingInferior = window.innerWidth <= 768 ? 16 : 28;
  const alturaDisponibleReal = window.innerHeight - contenedor.getBoundingClientRect().top - paddingInferior;
  const altoDisponible = Math.max(280, alturaDisponibleReal);

  if (document.fullscreenElement) {
    contenedor.style.maxHeight = "100vh";
    contenedor.style.overflowY = "auto";
  } else if (estado.horarioExpandido) {
    contenedor.style.maxHeight = "";
    contenedor.style.overflowY = "visible";
  } else {
    contenedor.style.maxHeight = `${altoDisponible}px`;
    contenedor.style.overflowY = "auto";
  }
  // El propio contenedor maneja AMBOS ejes de scroll (antes el scroll
  // horizontal vivía en un div anidado aparte, lo que hacía que el header
  // sticky "top:0" quedara pegado a ESE div en vez del contenedor real que
  // scrollea verticalmente — se despegaba de la pantalla al hacer scroll).
  // Con un solo contenedor para los dos ejes, el header queda siempre
  // visible arriba Y perfectamente sincronizado con las columnas al
  // scrollear de lado.
  contenedor.style.overflowX = "auto";

  // Horario conjunto (mezcla propio + amigos, un día a la vez, columnas por
  // persona) NO es una ventana aparte: reemplaza TEMPORALMENTE este mismo
  // contenido, reutilizando el mismo contenedor/tamaño/scroll de siempre —
  // ver activarModoConjunto/desactivarModoConjunto más abajo.
  if (estado.horarioModoConjunto) {
    renderizarHorarioConjuntoInterno(cont, semestre, numeroSemana);
  } else if (estado.horarioVistaIndividualAmigoFileId) {
    // Vista individual de un amigo (punto 2 del prompt) — NO es una ventana
    // aparte, reemplaza TEMPORALMENTE este mismo contenido, igual criterio
    // que el Horario conjunto de la rama de arriba.
    renderizarVistaIndividualAmigoInterno(cont, semestre, numeroSemana);
  } else {
    const columnaAncha = document.createElement("div");
    columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

    // headerWrap: envoltorio sticky único para el header de días Y (solo en
    // modo pantalla completa) la barra de navegación de semana/semestre.
    // Antes headerFila era ella misma el elemento sticky; ahora el
    // sticky/bg/z-index/border vive acá arriba para que, si se agrega la
    // fila de navegación fullscreen, las dos filas peguen juntas como UN
    // solo bloque (si cada una fuera sticky por separado con top:0, se
    // superpondrían entre sí al scrollear en vez de apilarse).
    const headerWrap = document.createElement("div");
    // Fondo SÓLIDO (no --bg-panel, que es semitransparente en todas las
    // paletas — ver mismo patrón en .mapa-nodo dentro de design-system.css)
    // para que las tarjetas de materia no se transparenten al pasar detrás.
    // z-index por encima del rango de las tarjetas (10 + lane) para que el
    // header quede siempre POR ENCIMA, nunca tapado por una tarjeta.
    // --bg-header-solido: mismo color que se ve al mirar una tarjeta común
    // (--bg-card) sobre el fondo (--bg-canvas), pero ya "aplanado" a un color
    // sólido para esta paleta — se agregó junto a los demás tokens en
    // design-system.css. No es transparente, así que nunca se ve nada de
    // lo que scrollea por debajo.
    headerWrap.style.cssText = "position:sticky; top:0; z-index:50; background:var(--bg-header-solido); border-bottom:1px solid rgba(150,150,170,0.15);";

    // Punto 1 del ajuste a Horario propio: en pantalla completa el header
    // externo (#horario-header, con las flechas ‹ › de semestre/semana)
    // queda fuera de document.fullscreenElement (solo #horario-grid-contenedor
    // entra a pantalla completa) y se vuelve inaccesible. Esta fila
    // reproduce esa misma navegación DENTRO del grid, visible solo mientras
    // se está en pantalla completa — así nunca hace falta salir de ese modo
    // para cambiar de semana. Reusa irASemanaAnterior/irASemanaSiguiente,
    // las mismas funciones que ya usan los botones del header de siempre.
    if (document.fullscreenElement) {
      const navFS = document.createElement("div");
      navFS.style.cssText = "display:flex; align-items:center; justify-content:center; gap:16px; padding:6px 0; border-bottom:1px solid rgba(150,150,170,0.12);";
      const btnAntFS = document.createElement("button");
      btnAntFS.type = "button";
      btnAntFS.className = "btn-icono-fantasma";
      btnAntFS.style.fontSize = "1.2rem";
      btnAntFS.textContent = "‹";
      btnAntFS.setAttribute("aria-label", "Semana anterior");
      btnAntFS.addEventListener("click", irASemanaAnterior);
      const etiquetaFS = document.createElement("span");
      etiquetaFS.style.cssText = "font-size:0.78rem; font-weight:600; min-width:120px; text-align:center;";
      etiquetaFS.textContent = `${semestre.nombre || "Semestre"} · Semana ${numeroSemana}`;
      const btnSigFS = document.createElement("button");
      btnSigFS.type = "button";
      btnSigFS.className = "btn-icono-fantasma";
      btnSigFS.style.fontSize = "1.2rem";
      btnSigFS.textContent = "›";
      btnSigFS.setAttribute("aria-label", "Semana siguiente");
      btnSigFS.addEventListener("click", irASemanaSiguiente);
      navFS.append(btnAntFS, etiquetaFS, btnSigFS);
      anclarBotonSalirFSEnFila(navFS);
      headerWrap.appendChild(navFS);
    }

    const headerFila = document.createElement("div");
    headerFila.style.cssText = "display:flex;";
    const espaciador = document.createElement("div");
    // 28px: mismo ancho que .horario-col-horas (ver construirColumnaHoras),
    // para que este header quede alineado con la columna de horas de abajo.
    espaciador.style.cssText = "width:28px; flex-shrink:0;";
    headerFila.appendChild(espaciador);
    dias.forEach((dia) => {
      const fecha = calcularFechaDelDia(semestre, numeroSemana, dia.abrevDefault);
      const h = document.createElement("div");
      h.style.cssText = "flex:1; min-width:56px; text-align:center; padding:4px 0;";
      h.innerHTML = `
        <div class="${esHoy(fecha) ? "horario-dia-actual-glow" : ""}" style="font-size:0.72rem; font-weight:600;">${dia.etiquetaCorta}</div>
        <div class="muted" style="font-size:0.6rem;">${fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : ""}</div>
      `;
      headerFila.appendChild(h);
    });
    headerWrap.appendChild(headerFila);

    const filaGrid = document.createElement("div");
    filaGrid.style.cssText = "display:flex; position:relative;";
    filaGrid.appendChild(construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango));
    let semanaIncluyeHoy = false;
    dias.forEach((dia) => {
      const fecha = calcularFechaDelDia(semestre, numeroSemana, dia.abrevDefault);
      if (esHoy(fecha)) semanaIncluyeHoy = true;
      // clasesEfectivas ya viene PLANA (una entrada por día puntual, ver
      // obtenerClasesEfectivasSemana en schema.js) — no hay .dias anidado que
      // filtrar/recorrer, cada item ya es la clase de un día concreto.
      const bloquesDia = clasesEfectivas
        .filter((c) => c.dia === dia.abrevDefault)
        .map((c) => ({
          bloqueOriginalId: c.id,
          inicioMin: minutosDesdeHora(c.hora_inicio),
          finMin: minutosDesdeHora(c.hora_fin),
          color: obtenerColorBloque(c),
          nombreCorto: obtenerNombreBloque(c),
          profesorNombre: obtenerNombreProfesor(c.profesor_id),
          aula: c.aula,
          enlace: c.enlace,
          modalidad: c.modalidad,
          notas: c.notas,
        }));
      filaGrid.appendChild(construirColumnaDia(dia, bloquesDia, semestre, pxPorMin, altoGrid, minInicioRango, minFinRango));
    });
    // Línea de hora actual — Núcleo: se agrega DESPUÉS de las columnas (así
    // su z-index queda por encima en el orden natural del DOM) solo si la
    // semana que se está mostrando incluye el día de hoy — mostrarla en una
    // semana pasada/futura no tendría sentido.
    if (semanaIncluyeHoy) {
      const linea = construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango);
      if (linea) filaGrid.appendChild(linea);
    }

    columnaAncha.appendChild(headerWrap);
    columnaAncha.appendChild(filaGrid);
    cont.appendChild(columnaAncha);
  }

  // Barra delgada inferior para expandir/contraer a las 24h reales.
  // Antes quedaba al final del contenido (había que scrollear hasta abajo
  // del todo para verla). Con sticky bottom:0 se queda fija abajo del
  // área visible, igual que el header queda fijo arriba, para que siempre
  // se note que se puede tocar. Se muestra en los dos modos (conjunto
  // también respeta el mismo alto expandido/recortado).
  const barra = document.createElement("div");
  barra.className = "horario-barra-expandir";
  barra.style.cssText = "position:sticky; bottom:0; z-index:40; background:var(--bg-header-solido);";
  barra.innerHTML = `<span class="horario-barra-expandir-icono" style="display:inline-block; transform:rotate(${estado.horarioExpandido ? "90deg" : "-90deg"});">‹</span>`;
  barra.addEventListener("click", () => {
    estado.horarioExpandido = !estado.horarioExpandido;
    renderizarHorarioInterno();
  });
  if (!document.fullscreenElement) cont.appendChild(barra);

  // El auto-scroll del grid semanal completo busca la clase más temprana
  // entre TODOS los días visibles de la semana. El modo conjunto y la vista
  // individual de un amigo tienen su propio auto-scroll (disparado desde
  // adentro de renderizarHorarioConjuntoInterno / renderizarVistaIndividualAmigoInterno)
  // — no aplica acá.
  if (!estado.horarioModoConjunto && !estado.horarioVistaIndividualAmigoFileId) {
    const diasAbrevVisibles = new Set(dias.map((d) => d.abrevDefault));
    const minutosClasesSemana = clasesEfectivas
      .filter((c) => diasAbrevVisibles.has(c.dia))
      .map((c) => minutosDesdeHora(c.hora_inicio));
    requestAnimationFrame(() => {
      centrarVistaInicial(contenedor, minutosClasesSemana, pxPorMin, minInicioRango, minFinRango);
      ocultarBotonesEntrarQueChocan(cont);
    });
  }
}

function renderizarHorario() {
  inicializarEstadoHorarioSiHaceFalta();
  renderizarHorarioInterno();
}

// IDs de los modales que viven fuera de #horario-grid-contenedor en el HTML
// (normalmente colgando directo de <body>). El API de Fullscreen SOLO pinta
// en pantalla document.fullscreenElement y sus descendientes — cualquier
// modal que quede afuera de ese árbol se vuelve invisible mientras el
// horario está en pantalla completa (aunque siga "abierto" en el DOM). Por
// eso se reubican adentro al entrar, y de vuelta a <body> al salir.
const IDS_MODALES_GLOBALES = ["modal-bloque-horario", "modal-selector-semestre", "modal-bloque-flotante"];

function sincronizarModalesConPantallaCompleta() {
  const destino = document.fullscreenElement || document.body;
  IDS_MODALES_GLOBALES.forEach((id) => {
    const el = document.getElementById(id);
    if (el && el.parentElement !== destino) destino.appendChild(el);
  });
}

/* ===================== Inicialización (listeners, una sola vez) ===================== */

/* =========================================================================
   Horario conjunto: mezcla del horario propio + el de todos los amigos
   vinculados, en columnas (una por persona) en vez de por día — se ve un
   solo día a la vez, con navegación "‹ Lunes ›", y scroll horizontal si hay
   muchas columnas. Reutiliza las mismas piezas de construcción del grid
   semanal (construirColumnaHoras, construirLineasHorarias, calcularLanesDia)
   para no duplicar esa lógica.
   ========================================================================= */

/**
 * Punto 3 del prompt: días navegables/mostrados en el Horario conjunto
 * (tanto modo Día como modo Semana). Es la UNIÓN de:
 *  - mis días visibles (Ajustes → Horario) — mi configuración personal
 *    sigue aplicando a MI propio horario, tal como antes;
 *  - cualquier día en el que ALGÚN amigo vinculado tenga clase, sin
 *    importar si yo lo tengo oculto — así un día que solo un amigo usa
 *    nunca queda invisible por una preferencia mía que no tiene nada que
 *    ver con su horario.
 * No filtra por si YO tengo o no clase ese día (mi columna simplemente
 * muestra "Sin clases" si no tengo nada, igual que siempre).
 */
function obtenerDiasModoConjunto() {
  const idsVisibles = new Set(obtenerDiasVisiblesOrdenados().map((d) => d.id));
  const codigosDiaAmigos = obtenerDiasConClaseAmigosVinculados();
  return obtenerDiasOrdenados().filter((d) => idsVisibles.has(d.id) || codigosDiaAmigos.has(d.abrevDefault));
}

function activarModoConjunto() {
  inicializarEstadoHorarioSiHaceFalta();
  if (estado.horarioModoConjunto) return;
  estado.horarioModoConjunto = true;

  if (estado.horarioConjuntoDiaIdx == null) {
    // Primera vez en esta sesión: arranca en el día real de hoy si está
    // entre los días navegables del conjunto (mis días visibles + días con
    // clase de algún amigo, ver obtenerDiasModoConjunto); si no, cae al
    // primero de la lista en vez de romper.
    const dias = obtenerDiasModoConjunto();
    const hoy = new Date();
    const codigoHoy = DIAS_SEMANA_CONFIG[(hoy.getDay() + 6) % 7].abrevDefault; // getDay(): dom=0..sáb=6 -> reordena a L..D
    const idxHoy = dias.findIndex((d) => d.abrevDefault === codigoHoy);
    estado.horarioConjuntoDiaIdx = idxHoy !== -1 ? idxHoy : 0;
  }

  document.getElementById("btn-horario-agregar")?.classList.add("oculto");
  document.getElementById("btn-salir-modo-conjunto")?.classList.remove("oculto");
  renderizarHorarioInterno();

  // Best-effort: refresca los snapshots de amigos por si cambió algo desde
  // el último sondeo de 5 min (ver iniciarRefrescoPeriodicoAmigos en
  // horario-amigos.js) — no bloquea la entrada al modo, se re-renderiza
  // sola al terminar (solo si seguimos en modo conjunto: pudo cerrarse
  // mientras la petición estaba en vuelo).
  refrescarSnapshotsAmigos()
    .then(() => {
      if (estado.horarioModoConjunto) renderizarHorarioInterno();
    })
    .catch(() => {});
}

function desactivarModoConjunto() {
  if (!estado.horarioModoConjunto) return;
  estado.horarioModoConjunto = false;
  document.getElementById("btn-horario-agregar")?.classList.remove("oculto");
  document.getElementById("btn-salir-modo-conjunto")?.classList.add("oculto");
  renderizarHorarioInterno();
}

/* =========================================================================
   Vista individual de un amigo en pantalla completa (punto 2 del prompt):
   a diferencia del Horario conjunto (mezcla TODOS los amigos), esta vista
   muestra el horario de UN SOLO amigo, en un grid semanal normal (como
   amigos.html) con TODOS los días que ESE horario tenga clases (punto 3 —
   nunca limitado por mi configuración personal de días visibles). Entra
   automáticamente a pantalla completa (Fullscreen API sobre el mismo
   #horario-grid-contenedor que ya usa el botón ⛶ del header) — el botón
   "✕ Cerrar" vive DENTRO del propio grid (ver
   renderizarVistaIndividualAmigoInterno), no en el header: el header queda
   fuera del árbol de pantalla completa (ver comentario en
   IDS_MODALES_GLOBALES más abajo) y por lo tanto invisible mientras dura.
   ========================================================================= */

function activarVistaIndividualAmigo(fileId) {
  inicializarEstadoHorarioSiHaceFalta();
  const vinculados = estado.datos?.configuracion?.horario_amigos_vinculados || [];
  if (!vinculados.some((a) => a.file_id === fileId)) return;
  if (estado.horarioModoConjunto) desactivarModoConjunto();

  estado.horarioVistaIndividualAmigoFileId = fileId;
  // Mismo par de botones que usa el modo conjunto (ver activarModoConjunto)
  // — fallback por si Fullscreen no está disponible/falla (ej. algunos
  // navegadores en iframe): con el header todavía visible, esto sigue
  // dando una salida además del ✕ propio de adentro del grid.
  document.getElementById("btn-horario-agregar")?.classList.add("oculto");
  const btnSalir = document.getElementById("btn-salir-modo-conjunto");
  if (btnSalir) {
    btnSalir.textContent = "← Cerrar horario";
    btnSalir.classList.remove("oculto");
  }
  renderizarHorarioInterno();

  const contenedor = document.getElementById("horario-grid-contenedor");
  contenedor?.requestFullscreen?.().catch(() => {
    // Sin soporte o el navegador lo bloqueó — la vista sigue activa igual,
    // solo sin el modo pantalla completa nativo.
  });

  // Best-effort, mismo criterio que activarModoConjunto: refresca el
  // snapshot por si cambió desde el último sondeo de 5 min.
  refrescarSnapshotsAmigos()
    .then(() => {
      if (estado.horarioVistaIndividualAmigoFileId === fileId) renderizarHorarioInterno();
    })
    .catch(() => {});
}

/**
 * Grid semanal normal (mismo criterio visual que el grid propio de siempre:
 * columnas por día, header con fecha, línea de hora actual) pero READ-ONLY
 * y con el snapshot de UN SOLO amigo en vez de mis propias clases — las
 * columnas de persona se construyen con construirColumnaPersonaConjunto
 * (misma pieza que ya usa el Horario conjunto, sin click-to-editar, a
 * diferencia de construirColumnaDia que es para MI horario editable).
 *
 * Punto 3 del prompt aplicado acá también: los días mostrados son los que
 * TIENEN clase en el snapshot de este amigo puntual (obtenerCodigosDiaConClase),
 * nunca recortados por mi configuración personal de días visibles ni por la
 * que el amigo tenía guardada al compartir.
 *
 * `semestre`/`numeroSemana` son MI semestre/semana actual (el mismo contexto
 * que ya se está mirando en el resto de la app) — de ahí se saca la fecha
 * calendario real de cada día, y desde esa fecha se traduce a la semana
 * PROPIA del snapshot del amigo (calcularNumeroSemanaAmigo, vía
 * obtenerListaAmigosParaDiaConjunto) — mismo mecanismo que usa el Horario
 * conjunto para alinear dos semestres con fechas de inicio distintas.
 */
function renderizarVistaIndividualAmigoInterno(cont, semestre, numeroSemana) {
  const fileId = estado.horarioVistaIndividualAmigoFileId;
  const vinculados = estado.datos?.configuracion?.horario_amigos_vinculados || [];
  const amigo = vinculados.find((a) => a.file_id === fileId);
  if (!amigo) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">Este horario ya no está vinculado.</p>`;
    return;
  }

  // FIX (switch de ocultar amigo): en teoría no debería poder llegarse acá
  // con un amigo oculto (el botón ⛶ que dispara esta vista queda
  // deshabilitado para amigos ocultos, ver renderizarListaAmigosVinculados),
  // pero se puede quedar oculto un amigo cuya vista individual ya estaba
  // abierta — este chequeo cubre ese caso también.
  if (obtenerFileIdsOcultos().has(fileId)) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">${amigo.nombre} está oculto. Activá el switch en el panel de Amigos para volver a verlo.</p>`;
    return;
  }

  const entrada = obtenerSnapshotAmigoPorId(fileId);
  if (!entrada || !entrada.snapshot) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">${
      entrada?.caida ? "El enlace de este horario está caído." : `Cargando el horario de ${amigo.nombre}…`
    }</p>`;
    return;
  }
  const snapshot = entrada.snapshot;
  const codigosConClase = obtenerCodigosDiaConClase(snapshot.bloques);
  const dias = obtenerDiasOrdenados().filter((d) => codigosConClase.has(d.abrevDefault));

  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const pxPorMin = PX_POR_MIN_EXPANDIDO;
  const altoGrid = (minFinRango - minInicioRango) * pxPorMin;

  const columnaAncha = document.createElement("div");
  columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

  const encabezado = document.createElement("div");
  encabezado.style.cssText = "position:sticky; top:0; z-index:50; background:var(--bg-header-solido);";
  const tituloFila = document.createElement("div");
  tituloFila.style.cssText = "display:flex; align-items:center; justify-content:center; gap:8px; padding:6px 0; border-bottom:1px solid rgba(150,150,170,0.15);";
  tituloFila.innerHTML = `
    <span style="width:10px; height:10px; border-radius:50%; flex-shrink:0; background:${amigo.color};"></span>
    <span class="texto-encabezado-seccion">${amigo.nombre}</span>
  `;
  anclarBotonSalirFSEnFila(tituloFila);
  encabezado.appendChild(tituloFila);

  if (dias.length === 0) {
    columnaAncha.appendChild(encabezado);
    columnaAncha.appendChild(
      Object.assign(document.createElement("p"), {
        className: "muted",
        textContent: `${amigo.nombre} no tiene ninguna clase registrada.`,
        style: "padding:16px; text-align:center;",
      })
    );
    cont.appendChild(columnaAncha);
    return;
  }

  // Mismo ancho (130px, flex:1) en el header y en las columnas de abajo —
  // construirColumnaPersonaConjunto usa ese ancho, así que el header tiene
  // que matchear o los días quedan desalineados con sus propias columnas.
  const headerFila = document.createElement("div");
  headerFila.style.cssText = "display:flex; border-bottom:1px solid rgba(150,150,170,0.15);";
  const espaciador = document.createElement("div");
  espaciador.style.cssText = "width:28px; flex-shrink:0;";
  headerFila.appendChild(espaciador);

  let semanaIncluyeHoy = false;
  const bloquesPorDia = dias.map((dia) => {
    const fecha = semestre ? calcularFechaDelDia(semestre, numeroSemana, dia.abrevDefault) : null;
    if (fecha && esHoy(fecha)) semanaIncluyeHoy = true;
    const entradaDia = fecha ? obtenerListaAmigosParaDiaConjunto(fecha, dia.abrevDefault).find((e) => e.amigo.file_id === fileId) : null;

    const h = document.createElement("div");
    h.style.cssText = "flex:1; min-width:130px; text-align:center; padding:4px 0;";
    h.innerHTML = `
      <div class="${fecha && esHoy(fecha) ? "horario-dia-actual-glow" : ""}" style="font-size:0.72rem; font-weight:600;">${dia.etiquetaCorta}</div>
      <div class="muted" style="font-size:0.6rem;">${fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : ""}</div>
    `;
    headerFila.appendChild(h);

    return { bloques: entradaDia ? entradaDia.bloques : [], caida: entradaDia ? false : entrada.caida === true };
  });
  encabezado.appendChild(headerFila);

  const filaGrid = document.createElement("div");
  filaGrid.style.cssText = "display:flex; position:relative;";
  filaGrid.appendChild(construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango));
  bloquesPorDia.forEach(({ bloques, caida }) => {
    const mensaje = caida ? "Enlace caído" : bloques.length === 0 ? "Sin clases" : null;
    filaGrid.appendChild(construirColumnaPersonaConjunto(bloques, pxPorMin, altoGrid, minInicioRango, minFinRango, mensaje));
  });
  if (semanaIncluyeHoy) {
    const linea = construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango);
    if (linea) filaGrid.appendChild(linea);
  }

  columnaAncha.appendChild(encabezado);
  columnaAncha.appendChild(filaGrid);
  cont.appendChild(columnaAncha);

  // Auto-scroll a la clase más temprana entre todos los días mostrados de
  // este amigo — mismo criterio que el grid propio (centrarVistaInicial).
  const minutosClasesSemana = bloquesPorDia.flatMap(({ bloques }) => bloques.map((b) => b.inicioMin));
  const contenedorScroll = document.getElementById("horario-grid-contenedor");
  if (contenedorScroll) {
    requestAnimationFrame(() => centrarVistaInicial(contenedorScroll, minutosClasesSemana, pxPorMin, minInicioRango, minFinRango));
  }
}

function desactivarVistaIndividualAmigo() {
  if (!estado.horarioVistaIndividualAmigoFileId) return;
  estado.horarioVistaIndividualAmigoFileId = null;
  document.getElementById("btn-horario-agregar")?.classList.remove("oculto");
  const btnSalir = document.getElementById("btn-salir-modo-conjunto");
  if (btnSalir) {
    btnSalir.textContent = "← Salir del modo conjunto";
    btnSalir.classList.add("oculto");
  }
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  renderizarHorarioInterno();
}

// Cablea el botón "‹ Salir del modo conjunto" (ver index.html, junto a
// btn-horario-agregar) — hoy sirve como salida de DOS vistas especiales
// (modo conjunto Y, de respaldo si Fullscreen falla, la vista individual de
// un amigo), así que decide cuál desactivar según cuál esté activa. Se
// llama una sola vez desde inicializarHorario(); activarModoConjunto() y
// activarVistaIndividualAmigo() ya se disparan aparte, desde sus propios
// puntos de entrada (horario-amigos.js).
function inicializarHorarioConjunto() {
  const btnSalir = document.getElementById("btn-salir-modo-conjunto");
  if (btnSalir) {
    btnSalir.addEventListener("click", () => {
      if (estado.horarioVistaIndividualAmigoFileId) desactivarVistaIndividualAmigo();
      else desactivarModoConjunto();
    });
  }
}

function moverDiaConjunto(delta) {
  const dias = obtenerDiasModoConjunto();
  if (dias.length === 0) return;
  const actual = estado.horarioConjuntoDiaIdx ?? 0;
  estado.horarioConjuntoDiaIdx = (actual + delta + dias.length) % dias.length;
  renderizarHorarioInterno();
}

/** Una columna de persona: igual criterio visual que construirColumnaDia,
 *  pero sin franjas de amigos superpuestas (acá cada persona YA es su
 *  propia columna, no hace falta la franja lateral). */
function construirColumnaPersonaConjunto(bloques, pxPorMin, altoGrid, minInicioRango, minFinRango, mensajeVacio) {
  const col = document.createElement("div");
  col.style.cssText = `position:relative; flex:1; min-width:130px; height:${altoGrid}px; background:${construirLineasHorarias(pxPorMin, minInicioRango, minFinRango)}; border-left:1px solid rgba(150,150,170,0.15);`;

  if (mensajeVacio) {
    col.innerHTML = `<p class="muted" style="padding:8px 6px; font-size:0.72rem;">${mensajeVacio}</p>`;
    return col;
  }

  const conLanes = calcularLanesDia(bloques);
  conLanes.forEach((b) => {
    const inicioClamp = Math.max(b.inicioMin, minInicioRango);
    const finClamp = Math.min(b.finMin, minFinRango);
    if (finClamp <= inicioClamp) return;
    const top = Math.max(0, (inicioClamp - minInicioRango) * pxPorMin);
    const alto = Math.max(24, (finClamp - inicioClamp) * pxPorMin);
    const offsetPx = b.lane * 10;
    const tarjeta = document.createElement("div");
    const esSinClase = b.modalidad === "sin_clase";
    tarjeta.style.cssText = `position:absolute; top:${top}px; left:${offsetPx}px; right:0; height:${alto}px; z-index:${10 + b.lane};
      background:${b.color}; color:#fff; border-radius:8px; padding:3px 6px; overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.25);
      ${esSinClase ? "opacity:0.45;" : ""}`;
    const emojiModalidad = obtenerEmojiModalidad(b.modalidad);
    const lineasTexto = 1 + (b.profesorNombre ? 1 : 0) + (b.universidad ? 1 : 0) + (b.aula ? 1 : 0);
    const cabeExtra = alto >= lineasTexto * 15 + 6;
    tarjeta.innerHTML = `
      <div style="font-size:0.8rem; font-weight:600; line-height:1.15; overflow-wrap:break-word; word-break:break-word;">${b.nombreBloque}</div>
      ${cabeExtra && b.profesorNombre ? `<div style="font-size:0.68rem; opacity:0.9; overflow-wrap:break-word; word-break:break-word;">${b.profesorNombre}</div>` : ""}
      ${cabeExtra && b.universidad ? `<div style="font-size:0.68rem; opacity:0.9; overflow-wrap:break-word; word-break:break-word;">${b.universidad}</div>` : ""}
      ${cabeExtra && b.aula ? `<div style="font-size:0.68rem; opacity:0.85; overflow-wrap:break-word; word-break:break-word;">${b.aula}</div>` : ""}
      ${emojiModalidad ? `<span title="${b.modalidad}" style="position:absolute; right:4px; bottom:2px; font-size:1rem; line-height:1;">${emojiModalidad}</span>` : ""}
    `;
    col.appendChild(tarjeta);
  });

  return col;
}

/** Switch "Día / Semana" del Horario conjunto (punto 4 del prompt) — el
 *  mismo pill-group visual que ya usa el resto de la app (ver Agenda). */
function construirSwitchDiaSemanaConjunto() {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "justify-content:center; margin:0 auto;";
  [["dia", "Día"], ["semana", "Semana"]].forEach(([valor, etiqueta]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `pill-item${estado.horarioConjuntoVista === valor ? " active" : ""}`;
    btn.textContent = etiqueta;
    btn.addEventListener("click", () => {
      if (estado.horarioConjuntoVista === valor) return;
      estado.horarioConjuntoVista = valor;
      renderizarHorarioInterno();
    });
    grupo.appendChild(btn);
  });
  return grupo;
}

/**
 * Reemplaza TEMPORALMENTE el contenido de #horario-grid mientras
 * estado.horarioModoConjunto esté activo (ver renderizarHorarioInterno,
 * que decide cuál de las dos ramas renderizar) — no es una ventana/modal
 * aparte, es el mismo grid de siempre con otro contenido adentro. Dentro de
 * este modo hay a su vez dos vistas (switch Día/Semana, punto 4 del
 * prompt): modo Día (columnas por persona, un día a la vez, ya existía) y
 * modo Semana (todos los días navegables uno al lado del otro, punto 4
 * nuevo) — cada una en su propia función de render más abajo.
 */
function renderizarHorarioConjuntoInterno(cont, semestre, numeroSemana) {
  cont.innerHTML = "";
  if (!semestre) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">Creá un semestre en Semestres para ver el horario conjunto.</p>`;
    return;
  }

  // Punto 3 del prompt: días fusionados (mis días visibles + días donde
  // algún amigo tiene clase), no solo mi configuración personal — ver
  // obtenerDiasModoConjunto.
  const dias = obtenerDiasModoConjunto();
  if (dias.length === 0) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">No hay días para mostrar (ni tuyos ni de tus amigos vinculados).</p>`;
    return;
  }

  if (estado.horarioConjuntoVista === "semana") {
    renderizarConjuntoModoSemana(cont, semestre, numeroSemana, dias);
  } else {
    renderizarConjuntoModoDia(cont, semestre, numeroSemana, dias);
  }
}

/** Modo Día del Horario conjunto: un solo día a la vez ("‹ Lunes ›"),
 *  columnas por persona (Yo + cada amigo vinculado). Comportamiento igual
 *  al que ya existía, solo que ahora recibe `dias` ya fusionado (punto 3)
 *  y agrega el switch Día/Semana arriba de todo (punto 4). */
function renderizarConjuntoModoDia(cont, semestre, numeroSemana, dias) {
  const idx = Math.min(Math.max(estado.horarioConjuntoDiaIdx ?? 0, 0), dias.length - 1);
  estado.horarioConjuntoDiaIdx = idx;
  const diaSel = dias[idx];

  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const pxPorMin = PX_POR_MIN_EXPANDIDO;
  const altoGrid = (minFinRango - minInicioRango) * pxPorMin;

  const fechaDia = calcularFechaDelDia(semestre, numeroSemana, diaSel.abrevDefault);
  const clasesEfectivas = construirClasesEfectivasSemana(semestre, numeroSemana);
  const bloquesPropios = clasesEfectivas
    .filter((c) => c.dia === diaSel.abrevDefault)
    .map((c) => ({
      inicioMin: minutosDesdeHora(c.hora_inicio),
      finMin: minutosDesdeHora(c.hora_fin),
      color: obtenerColorBloque(c),
      nombreBloque: obtenerNombreBloque(c),
      profesorNombre: obtenerNombreProfesor(c.profesor_id),
      aula: c.aula,
      modalidad: c.modalidad,
    }));

  // fechaDia puede venir null (semestre sin fecha_inicio válida) — en ese
  // caso obtenerListaAmigosParaDiaConjunto ya sabe devolver todo vacío en
  // vez de reventar (ver el chequeo isNaN ahí mismo).
  // FIX (switch de ocultar amigo): obtenerListaAmigosParaDiaConjunto a
  // propósito devuelve TODOS los vinculados (la vista individual necesita
  // poder encontrar a cualquiera por fileId, oculto o no — ver
  // renderizarVistaIndividualAmigoInterno). Acá, en Horario conjunto, sí se
  // filtra por lo que diga el switch de cada amigo.
  const ocultosConjunto = obtenerFileIdsOcultos();
  const amigosDia = obtenerListaAmigosParaDiaConjunto(fechaDia, diaSel.abrevDefault).filter(
    ({ amigo }) => !ocultosConjunto.has(amigo.file_id)
  );

  const columnaAncha = document.createElement("div");
  columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

  // Encabezado sticky de TRES filas: switch Día/Semana, nav de día, nombres
  // de persona — un solo wrapper sticky (no cada fila por separado) para no
  // tener que adivinar el alto de las filas de arriba con un top:Npx fijo.
  const encabezado = document.createElement("div");
  encabezado.style.cssText = "position:sticky; top:0; z-index:50; background:var(--bg-header-solido);";
  encabezado.appendChild(construirSwitchDiaSemanaConjunto());

  const navFila = document.createElement("div");
  navFila.style.cssText = "display:flex; align-items:center; justify-content:center; gap:14px; padding:6px 0;";
  const btnAnt = document.createElement("button");
  btnAnt.type = "button";
  btnAnt.className = "btn-icono-fantasma";
  btnAnt.style.fontSize = "1.3rem";
  btnAnt.textContent = "‹";
  btnAnt.addEventListener("click", () => moverDiaConjunto(-1));
  const etiquetaDia = document.createElement("span");
  etiquetaDia.className = "texto-encabezado-seccion";
  etiquetaDia.textContent = diaSel.etiqueta || diaSel.etiquetaCorta;
  const btnSig = document.createElement("button");
  btnSig.type = "button";
  btnSig.className = "btn-icono-fantasma";
  btnSig.style.fontSize = "1.3rem";
  btnSig.textContent = "›";
  btnSig.addEventListener("click", () => moverDiaConjunto(1));
  navFila.appendChild(btnAnt);
  navFila.appendChild(etiquetaDia);
  navFila.appendChild(btnSig);
  anclarBotonSalirFSEnFila(navFila);

  const headerFila = document.createElement("div");
  headerFila.style.cssText = "display:flex; border-bottom:1px solid rgba(150,150,170,0.15);";
  const espaciador = document.createElement("div");
  // 28px: mismo ancho que .horario-col-horas (ver construirColumnaHoras).
  espaciador.style.cssText = "width:28px; flex-shrink:0;";
  headerFila.appendChild(espaciador);

  const headerYo = document.createElement("div");
  headerYo.style.cssText = "flex:1; min-width:130px; text-align:center; padding:4px 6px;";
  headerYo.innerHTML = `<span style="font-size:0.8rem; font-weight:700;">Yo</span>`;
  headerFila.appendChild(headerYo);

  amigosDia.forEach(({ amigo }) => {
    const h = document.createElement("div");
    h.style.cssText = "flex:1; min-width:130px; text-align:center; padding:4px 6px; display:flex; align-items:center; justify-content:center; gap:6px;";
    h.innerHTML = `
      <span style="width:10px; height:10px; border-radius:50%; flex-shrink:0; background:${amigo.color};"></span>
      <span style="font-size:0.8rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${amigo.nombre}</span>
    `;
    headerFila.appendChild(h);
  });

  encabezado.appendChild(navFila);
  encabezado.appendChild(headerFila);

  const filaGrid = document.createElement("div");
  // FIX (reporte: "en horario conjunto no se puede ver la línea roja de la
  // hora actual"): faltaba tanto agregar la línea (nunca se llamaba a
  // construirLineaHoraActualGrid en este modo) como el position:relative
  // que la línea necesita para posicionarse contra ESTE contenedor (mismo
  // requisito que ya tienen el grid propio y la vista individual de un
  // amigo, ver filaGrid en renderizarHorarioInterno/renderizarVistaIndividualAmigoInterno).
  filaGrid.style.cssText = "display:flex; position:relative;";
  filaGrid.appendChild(construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango));
  filaGrid.appendChild(
    construirColumnaPersonaConjunto(bloquesPropios, pxPorMin, altoGrid, minInicioRango, minFinRango, bloquesPropios.length === 0 ? "Sin clases" : null)
  );
  amigosDia.forEach(({ bloques, caida }) => {
    const mensaje = caida ? "Enlace caído" : bloques.length === 0 ? "Sin clases" : null;
    filaGrid.appendChild(construirColumnaPersonaConjunto(bloques, pxPorMin, altoGrid, minInicioRango, minFinRango, mensaje));
  });
  // Línea de hora actual: solo si el día seleccionado en el modo Día ES hoy
  // (mismo criterio que "semanaIncluyeHoy" en las demás vistas del grid).
  if (fechaDia && esHoy(fechaDia)) {
    const linea = construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango);
    if (linea) filaGrid.appendChild(linea);
  }

  columnaAncha.appendChild(encabezado);
  columnaAncha.appendChild(filaGrid);
  cont.appendChild(columnaAncha);

  // Auto-scroll a la clase más temprana del día ENTRE TODAS LAS COLUMNAS
  // (mía + cada amigo), no solo la mía — si yo no tengo clase a esa hora
  // pero un amigo sí, igual hay que arrancar ahí. Se recalcula en cada
  // render de este modo, así que al navegar de día con ‹ › (que vuelve a
  // llamar a esta función) se re-enfoca solo, sin acción extra del user.
  const minutosClasesDia = [
    ...bloquesPropios.map((b) => b.inicioMin),
    ...amigosDia.flatMap(({ bloques }) => bloques.map((b) => b.inicioMin)),
  ];
  const contenedorScroll = document.getElementById("horario-grid-contenedor");
  if (contenedorScroll) {
    requestAnimationFrame(() => centrarVistaInicial(contenedorScroll, minutosClasesDia, pxPorMin, minInicioRango, minFinRango));
  }
}

/**
 * Modo Semana del Horario conjunto (punto 4 del prompt, nuevo): en vez de
 * un solo día, muestra TODOS los días navegables (ver
 * obtenerDiasModoConjunto) uno al lado del otro, cada uno con sus propias
 * sub-columnas (Yo + cada amigo). Las columnas mantienen el mismo ancho
 * natural que tendrían en un horario normal (no se achican para que
 * quepan) — el contenido desborda horizontalmente y se recorre con el
 * MISMO estilo de scroll que ya usa el Mapa del Plan de Estudios: scroll
 * nativo libre en ambos ejes (reutiliza .mapa-scroll/.mapa-sizer/
 * .mapa-track de design-system.css, sin CSS nuevo) + pellizco táctil y
 * Ctrl+rueda para zoom, con su PROPIO nivel de zoom independiente
 * (estado.horarioConjuntoSemanaZoom) para no interferir con el zoom del
 * mapa — mismo mecanismo que aplicarZoomMapa/ajustarZoomMapa en
 * plan-mapa.js, adaptado acá con sus propias funciones.
 */
function renderizarConjuntoModoSemana(cont, semestre, numeroSemana, dias) {
  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const pxPorMin = PX_POR_MIN_EXPANDIDO;
  const altoGrid = (minFinRango - minInicioRango) * pxPorMin;
  const clasesEfectivas = construirClasesEfectivasSemana(semestre, numeroSemana);

  const encabezado = document.createElement("div");
  encabezado.style.cssText = "position:sticky; top:0; z-index:50; background:var(--bg-header-solido); padding-bottom:4px;";
  encabezado.appendChild(construirSwitchDiaSemanaConjunto());

  const controlesFila = document.createElement("div");
  controlesFila.style.cssText = "display:flex; align-items:center; justify-content:center; padding:4px 0 2px;";
  const zoomControles = document.createElement("div");
  zoomControles.className = "mapa-zoom-controles";
  const btnMenos = document.createElement("button");
  btnMenos.type = "button";
  btnMenos.className = "btn-icono-fantasma mapa-zoom-btn";
  btnMenos.textContent = "－";
  btnMenos.setAttribute("aria-label", "Alejar");
  const etiquetaZoom = document.createElement("span");
  etiquetaZoom.className = "muted mapa-zoom-etiqueta";
  etiquetaZoom.textContent = Math.round(estado.horarioConjuntoSemanaZoom * 100) + "%";
  const btnMas = document.createElement("button");
  btnMas.type = "button";
  btnMas.className = "btn-icono-fantasma mapa-zoom-btn";
  btnMas.textContent = "＋";
  btnMas.setAttribute("aria-label", "Acercar");
  btnMenos.addEventListener("click", () => ajustarZoomConjuntoSemana(-0.1, etiquetaZoom));
  btnMas.addEventListener("click", () => ajustarZoomConjuntoSemana(0.1, etiquetaZoom));
  zoomControles.appendChild(btnMenos);
  zoomControles.appendChild(etiquetaZoom);
  zoomControles.appendChild(btnMas);
  controlesFila.appendChild(zoomControles);
  anclarBotonSalirFSEnFila(controlesFila);
  encabezado.appendChild(controlesFila);
  cont.appendChild(encabezado);

  // Alto disponible: mismo criterio que el resto del grid (medir la
  // posición real del contenedor y usar lo que quede hasta el fondo de la
  // pantalla), restando el espacio que ya ocupa el encabezado sticky de
  // arriba (switch + zoom), que en este modo NO es parte del área que
  // scrollea internamente.
  const contenedorRef = document.getElementById("horario-grid-contenedor");
  const paddingInferior = window.innerWidth <= 768 ? 16 : 28;
  const alturaDisponible = contenedorRef
    ? Math.max(240, window.innerHeight - contenedorRef.getBoundingClientRect().top - paddingInferior - 76)
    : 420;

  const scrollDiv = document.createElement("div");
  scrollDiv.className = "mapa-scroll";
  scrollDiv.style.cssText = `height:${alturaDisponible}px; flex:none;`;

  const sizerDiv = document.createElement("div");
  sizerDiv.className = "mapa-sizer";
  const trackDiv = document.createElement("div");
  trackDiv.className = "mapa-track";
  trackDiv.style.cssText = "display:flex; align-items:flex-start; gap:18px; padding:4px 6px 10px;";

  // FIX (switch de ocultar amigo): mismo criterio que renderizarConjuntoModoDia
  // — obtenerListaAmigosParaDiaConjunto trae a todos los vinculados a
  // propósito, y acá se filtra según el switch de cada amigo.
  const ocultosConjunto = obtenerFileIdsOcultos();

  let idxHoy = -1;
  dias.forEach((dia, i) => {
    const fecha = calcularFechaDelDia(semestre, numeroSemana, dia.abrevDefault);
    const esHoyDia = esHoy(fecha);
    if (esHoyDia) idxHoy = i;

    const bloquesPropios = clasesEfectivas
      .filter((c) => c.dia === dia.abrevDefault)
      .map((c) => ({
        inicioMin: minutosDesdeHora(c.hora_inicio),
        finMin: minutosDesdeHora(c.hora_fin),
        color: obtenerColorBloque(c),
        nombreBloque: obtenerNombreBloque(c),
        profesorNombre: obtenerNombreProfesor(c.profesor_id),
        aula: c.aula,
        modalidad: c.modalidad,
      }));
    const amigosDia = fecha
      ? obtenerListaAmigosParaDiaConjunto(fecha, dia.abrevDefault).filter(({ amigo }) => !ocultosConjunto.has(amigo.file_id))
      : [];

    const bloqueDia = document.createElement("div");
    bloqueDia.style.cssText = "display:flex; flex-direction:column; flex-shrink:0;";

    const tituloDia = document.createElement("div");
    tituloDia.style.cssText = "text-align:center; padding:2px 0 4px;";
    tituloDia.innerHTML = `
      <div class="${esHoyDia ? "horario-dia-actual-glow" : ""}" style="font-size:0.78rem; font-weight:700;">${dia.etiqueta || dia.etiquetaCorta}</div>
      <div class="muted" style="font-size:0.6rem;">${fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : ""}</div>
    `;
    bloqueDia.appendChild(tituloDia);

    const nombresFila = document.createElement("div");
    nombresFila.style.cssText = "display:flex; border-bottom:1px solid rgba(150,150,170,0.15);";
    const headerYo = document.createElement("div");
    headerYo.style.cssText = "width:130px; flex-shrink:0; text-align:center; padding:2px 4px;";
    headerYo.innerHTML = `<span style="font-size:0.72rem; font-weight:700;">Yo</span>`;
    nombresFila.appendChild(headerYo);
    amigosDia.forEach(({ amigo }) => {
      const h = document.createElement("div");
      h.style.cssText = "width:130px; flex-shrink:0; text-align:center; padding:2px 4px; display:flex; align-items:center; justify-content:center; gap:4px;";
      h.innerHTML = `
        <span style="width:8px; height:8px; border-radius:50%; flex-shrink:0; background:${amigo.color};"></span>
        <span style="font-size:0.72rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${amigo.nombre}</span>
      `;
      nombresFila.appendChild(h);
    });
    bloqueDia.appendChild(nombresFila);

    const filaColumnas = document.createElement("div");
    // FIX (mismo reporte que en modo Día): position:relative para que la
    // línea de hora actual se pueda posicionar contra ESTE bloque de día
    // puntual (cada día tiene su propio filaColumnas acá, a diferencia del
    // modo Día que tiene uno solo).
    filaColumnas.style.cssText = "display:flex; position:relative;";
    filaColumnas.appendChild(construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango));
    filaColumnas.appendChild(
      construirColumnaPersonaConjunto(bloquesPropios, pxPorMin, altoGrid, minInicioRango, minFinRango, bloquesPropios.length === 0 ? "Sin clases" : null)
    );
    amigosDia.forEach(({ bloques, caida }) => {
      const mensaje = caida ? "Enlace caído" : bloques.length === 0 ? "Sin clases" : null;
      filaColumnas.appendChild(construirColumnaPersonaConjunto(bloques, pxPorMin, altoGrid, minInicioRango, minFinRango, mensaje));
    });
    // Línea de hora actual: solo en el bloque del día que ES hoy (de los N
    // días mostrados uno al lado del otro en este modo).
    if (esHoyDia) {
      const linea = construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango);
      if (linea) filaColumnas.appendChild(linea);
    }
    bloqueDia.appendChild(filaColumnas);

    trackDiv.appendChild(bloqueDia);
  });

  sizerDiv.appendChild(trackDiv);
  scrollDiv.appendChild(sizerDiv);
  cont.appendChild(scrollDiv);

  estado._refsConjuntoSemanaActual = { sizerDiv, trackDiv };
  requestAnimationFrame(() => {
    aplicarZoomConjuntoSemana();
    // Auto-scroll horizontal al bloque de hoy, si está entre los días
    // mostrados — igual espíritu que el auto-scroll del modo Día, pero acá
    // es horizontal (de qué bloque de día partir) en vez de vertical (a
    // qué hora partir); el vertical se deja arriba del todo, cada bloque es
    // angosto y ya se ve completo casi siempre sin desplazamiento extra.
    if (idxHoy > 0) {
      const bloqueHoyEl = trackDiv.children[idxHoy];
      if (bloqueHoyEl) scrollDiv.scrollLeft = Math.max(0, bloqueHoyEl.offsetLeft - 12);
    }
  });

  // Ctrl + rueda del mouse = zoom (sin Ctrl, la rueda hace scroll normal) —
  // mismo criterio que el Mapa.
  scrollDiv.addEventListener(
    "wheel",
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ajustarZoomConjuntoSemana(ev.deltaY < 0 ? 0.1 : -0.1, etiquetaZoom);
    },
    { passive: false }
  );

  // Pellizco táctil = zoom — mismo criterio que el Mapa.
  let distanciaInicialToque = null;
  let zoomInicialToque = 1;
  const distanciaEntreToques = (toques) => Math.hypot(toques[0].clientX - toques[1].clientX, toques[0].clientY - toques[1].clientY);
  scrollDiv.addEventListener(
    "touchstart",
    (ev) => {
      if (ev.touches.length === 2) {
        distanciaInicialToque = distanciaEntreToques(ev.touches);
        zoomInicialToque = estado.horarioConjuntoSemanaZoom;
      }
    },
    { passive: true }
  );
  scrollDiv.addEventListener(
    "touchmove",
    (ev) => {
      if (ev.touches.length === 2 && distanciaInicialToque) {
        ev.preventDefault();
        const factor = distanciaEntreToques(ev.touches) / distanciaInicialToque;
        estado.horarioConjuntoSemanaZoom = Math.min(2, Math.max(0.5, zoomInicialToque * factor));
        aplicarZoomConjuntoSemana();
        etiquetaZoom.textContent = Math.round(estado.horarioConjuntoSemanaZoom * 100) + "%";
      }
    },
    { passive: false }
  );
  scrollDiv.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) distanciaInicialToque = null; });
}

/** Recalcula el tamaño real del track del modo Semana y aplica el zoom
 *  actual (transform: scale) — mismo mecanismo que aplicarZoomMapa en
 *  plan-mapa.js, adaptado a estado._refsConjuntoSemanaActual. */
function aplicarZoomConjuntoSemana() {
  const refs = estado._refsConjuntoSemanaActual;
  if (!refs) return;
  const { sizerDiv, trackDiv } = refs;
  trackDiv.style.transform = "none";
  const anchoNatural = trackDiv.scrollWidth;
  const altoNatural = trackDiv.scrollHeight;
  trackDiv.style.width = anchoNatural + "px";
  trackDiv.style.height = altoNatural + "px";
  const zoom = estado.horarioConjuntoSemanaZoom || 1;
  trackDiv.style.transform = `scale(${zoom})`;
  sizerDiv.style.width = anchoNatural * zoom + "px";
  sizerDiv.style.height = altoNatural * zoom + "px";
}

/** Botones +/- de zoom del modo Semana (no re-renderiza nada, conserva
 *  scroll) — mismo mecanismo que ajustarZoomMapa en plan-mapa.js. */
function ajustarZoomConjuntoSemana(delta, etiquetaEl) {
  estado.horarioConjuntoSemanaZoom = Math.min(2, Math.max(0.5, Math.round((estado.horarioConjuntoSemanaZoom + delta) * 100) / 100));
  aplicarZoomConjuntoSemana();
  if (etiquetaEl) etiquetaEl.textContent = Math.round(estado.horarioConjuntoSemanaZoom * 100) + "%";
}

/* ===================== Descargar horario como imagen ===================== */

const FONT_CANVAS = "Inter, 'Segoe UI', system-ui, sans-serif";

/** Lee un color real de la paleta activa (CSS custom property) en vez de hardcodear colores — la imagen exportada respeta la paleta que el usuario tenga puesta (son 15+, ver ui/paleta-personalizada.js). */
function obtenerVarCSS(nombre, fallback) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return valor || fallback;
}

function truncarTextoCanvas(ctx, texto, maxAncho) {
  if (ctx.measureText(texto).width <= maxAncho) return texto;
  let recortado = texto;
  while (recortado.length > 1 && ctx.measureText(recortado + "…").width > maxAncho) {
    recortado = recortado.slice(0, -1);
  }
  return recortado + "…";
}

/**
 * Envuelve `texto` en hasta `maxLineas` líneas que quepan en `maxAncho`
 * (con el font YA seteado en `ctx` antes de llamar) — mismo espíritu que el
 * word-wrap de la tarjeta viva (overflow-wrap/word-break en CSS), que el
 * canvas no tiene gratis. Antes el nombre de la materia siempre se dibujaba
 * en una sola línea con truncarTextoCanvas, así que cualquier nombre que
 * necesitara 2 líneas se cortaba de una, aunque el bloque tuviera alto de
 * sobra para mostrarlo completo (bug real reportado).
 *
 * Una vez alcanzado el límite de líneas, TODAS las palabras que sobran se
 * amontonan en la última línea a la fuerza, y esa última línea se recorta
 * con "…" al final (vía truncarTextoCanvas) si sigue sin entrar — así el
 * único lugar donde de verdad se pierde texto es la última línea, nunca una
 * de las de arriba.
 */
function envolverTextoCanvas(ctx, texto, maxAncho, maxLineas) {
  const palabras = String(texto || "").trim().split(/\s+/).filter(Boolean);
  if (palabras.length === 0) return [];
  const lineas = [];
  let actual = "";
  let i = 0;
  while (i < palabras.length) {
    const estaEnUltimaLineaPermitida = lineas.length === maxLineas - 1;
    const prueba = actual ? `${actual} ${palabras[i]}` : palabras[i];
    if (estaEnUltimaLineaPermitida || !actual || ctx.measureText(prueba).width <= maxAncho) {
      actual = prueba;
      i++;
    } else {
      lineas.push(actual);
      actual = "";
    }
  }
  if (actual) lineas.push(actual);
  const idxUltima = lineas.length - 1;
  if (idxUltima >= 0 && ctx.measureText(lineas[idxUltima]).width > maxAncho) {
    lineas[idxUltima] = truncarTextoCanvas(ctx, lineas[idxUltima], maxAncho);
  }
  return lineas;
}

function dibujarRectRedondeado(ctx, x, y, w, h, r) {
  const radio = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + w, y, x + w, y + h, radio);
  ctx.arcTo(x + w, y + h, x, y + h, radio);
  ctx.arcTo(x, y + h, x, y, radio);
  ctx.arcTo(x, y, x + w, y, radio);
  ctx.closePath();
}

/**
 * Descargar horario — Núcleo: se genera dibujando a mano en un <canvas> en
 * vez de con html2canvas/similar — evita sumar una librería externa (pesada
 * y con sus propias rarezas capturando gradientes/box-shadow) solo para
 * esto, y da control total sobre el resultado: una imagen 16:9 fija, con
 * TODO el rango de horas visible (nunca un recorte forzado que corte una
 * clase a la mitad, que es justo lo que un scroll interno sí puede hacer
 * en pantalla). Reutiliza los mismos helpers de datos que ya arma el grid
 * en vivo (calcularLanesDia, obtenerColorBloque, obtenerNombreBloque, etc.)
 * para que la imagen exportada sea fiel a lo que el usuario ve en pantalla.
 */
function generarImagenHorario(semestre, numeroSemana, dias, clasesEfectivas) {
  const ANCHO = 1600;
  const ALTO = 900; // 16:9 por default — puede crecer, ver altoFinal más abajo

  const colorFondo = obtenerVarCSS("--bg-canvas", "#101114");
  const colorBorde = obtenerVarCSS("--border-glass", "rgba(255,255,255,0.10)");
  const colorTexto = obtenerVarCSS("--text-primary", "#F1F2F4");
  const colorTextoSec = obtenerVarCSS("--text-secondary", "#B7BAC1");

  const margenX = 24;
  const margenInferior = 22;
  const cursorY = 20 + 66; // título (20) + "Semana N" + separación fija, antes de los días

  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioConfig = horaInicio * 60;
  const minFinConfig = horaFin * 60;

  // Bug 3 (texto cortado en la imagen descargada) — causa real: la imagen
  // SIEMPRE usaba el rango de horas completo configurado en Ajustes →
  // Horario (ej. 6am-11pm) para repartir los 900px de alto entre TODAS esas
  // horas, aunque las clases reales de la semana ocuparan solo una franja
  // angosta (ej. 7am-3pm) — el resto quedaba vacío y las tarjetas con clase
  // recibían una fracción mínima del alto disponible, por lo que el texto
  // (título/profesor/aula) no entraba y se truncaba agresivamente. Acá se
  // recorta el rango vertical a lo que realmente usan las clases de esta
  // semana (con 30min de margen arriba/abajo, redondeado a la hora para que
  // las líneas horarias queden prolijas), clampeado para nunca salirse del
  // rango configurado por si alguna clase excede esos límites.
  const minutosConClase = clasesEfectivas.flatMap((c) => [minutosDesdeHora(c.hora_inicio), minutosDesdeHora(c.hora_fin)]);
  let minInicioRango = minInicioConfig;
  let minFinRango = minFinConfig;
  if (minutosConClase.length > 0) {
    const PADDING_MIN = 30;
    minInicioRango = Math.max(minInicioConfig, Math.min(...minutosConClase) - PADDING_MIN);
    minFinRango = Math.min(minFinConfig, Math.max(...minutosConClase) + PADDING_MIN);
    minInicioRango = Math.floor(minInicioRango / 60) * 60;
    minFinRango = Math.ceil(minFinRango / 60) * 60;
    if (minFinRango - minInicioRango < 60) minFinRango = minInicioRango + 60;
  }

  const anchoHoras = 56;
  const xGridInicio = margenX + anchoHoras;
  const anchoGridDisponible = ANCHO - margenX - xGridInicio;
  const anchoColumna = anchoGridDisponible / dias.length;

  const yGridInicio = cursorY + 42;
  // Además de recortar el rango (arriba), se garantiza una densidad mínima
  // de px/min igual a la que usa el grid en pantalla (PX_POR_MIN_EXPANDIDO
  // = 0.84) — sin esto, un rango recortado que todavía sea angosto en
  // minutos (agenda muy apretada, o rango configurado ya angosto de por sí)
  // podía seguir dejando tarjetas chicas. En el caso común, el alto fijo de
  // 900px (16:9) ya alcanza esa densidad sobre el rango recortado y el
  // resultado sigue siendo 16:9 exacto; solo en casos extremos la imagen
  // crece en alto para no seguir comprimiendo el texto.
  //
  // Este cálculo se hace ANTES de crear el <canvas> a propósito: cambiar
  // canvas.width/height DESPUÉS de haber dibujado algo borra todo lo ya
  // pintado (reinicia el bitmap), así que el alto final tiene que quedar
  // resuelto antes del primer fillRect/fillText.
  const PX_POR_MIN_MIN_EXPORT = PX_POR_MIN_EXPANDIDO;
  const rangoMin = minFinRango - minInicioRango;
  const altoGridReal = Math.max(ALTO - yGridInicio - margenInferior, rangoMin * PX_POR_MIN_MIN_EXPORT);
  const altoFinal = Math.round(yGridInicio + altoGridReal + margenInferior);
  const pxPorMinReal = altoGridReal / rangoMin;

  const canvas = document.createElement("canvas");
  canvas.width = ANCHO;
  canvas.height = altoFinal;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";

  ctx.fillStyle = colorFondo;
  ctx.fillRect(0, 0, ANCHO, canvas.height);

  ctx.fillStyle = colorTexto;
  ctx.font = "700 26px " + FONT_CANVAS;
  ctx.fillText(semestre.nombre || "Horario", margenX, 20);

  ctx.fillStyle = colorTextoSec;
  ctx.font = "400 15px " + FONT_CANVAS;
  ctx.fillText(`Semana ${numeroSemana}`, margenX, 20 + 32);

  // Encabezados de día
  ctx.textAlign = "center";
  dias.forEach((dia, i) => {
    const x = xGridInicio + i * anchoColumna + anchoColumna / 2;
    const fecha = calcularFechaDelDia(semestre, numeroSemana, dia.abrevDefault);
    ctx.fillStyle = colorTexto;
    ctx.font = "600 14px " + FONT_CANVAS;
    ctx.fillText(dia.etiquetaCorta, x, cursorY);
    ctx.fillStyle = colorTextoSec;
    ctx.font = "400 11px " + FONT_CANVAS;
    ctx.fillText(fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : "", x, cursorY + 18);
  });
  ctx.textAlign = "left";

  // Líneas horarias + etiquetas de hora (cada hora en punto, para no
  // amontonar texto — el grid en vivo sí marca cada 30min pero acá el
  // espacio es fijo y limitado)
  ctx.strokeStyle = colorBorde;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  for (let h = Math.ceil(minInicioRango / 60); h <= Math.floor(minFinRango / 60); h++) {
    const y = yGridInicio + (h * 60 - minInicioRango) * pxPorMinReal;
    ctx.beginPath();
    ctx.moveTo(xGridInicio, y);
    ctx.lineTo(ANCHO - margenX, y);
    ctx.stroke();
    const horaStr = h === 0 ? "12am" : h < 12 ? `${h}am` : h === 12 ? "12pm" : `${h - 12}pm`;
    ctx.fillStyle = colorTextoSec;
    ctx.font = "400 11px " + FONT_CANVAS;
    ctx.fillText(horaStr, xGridInicio - 8, y - 4);
  }
  ctx.textAlign = "left";

  // Separadores verticales entre columnas
  for (let i = 0; i <= dias.length; i++) {
    const x = xGridInicio + i * anchoColumna;
    ctx.beginPath();
    ctx.moveTo(x, yGridInicio);
    ctx.lineTo(x, yGridInicio + altoGridReal);
    ctx.stroke();
  }

  // Bloques de clase — mismo criterio de lanes/recorte que el grid en vivo
  // (calcularLanesDia + clamp al rango de horas configurado).
  dias.forEach((dia, i) => {
    const xCol = xGridInicio + i * anchoColumna;
    const bloquesDia = clasesEfectivas
      .filter((c) => c.dia === dia.abrevDefault)
      .map((c) => ({
        inicioMin: minutosDesdeHora(c.hora_inicio),
        finMin: minutosDesdeHora(c.hora_fin),
        color: obtenerColorBloque(c),
        nombreCorto: obtenerNombreBloque(c),
        profesorNombre: obtenerNombreProfesor(c.profesor_id),
        aula: c.aula,
        modalidad: c.modalidad,
        emoji: obtenerEmojiModalidad(c.modalidad),
      }));
    const conLanes = calcularLanesDia(bloquesDia);
    conLanes.forEach((b) => {
      const inicioClamp = Math.max(b.inicioMin, minInicioRango);
      const finClamp = Math.min(b.finMin, minFinRango);
      if (finClamp <= inicioClamp) return;
      const top = yGridInicio + (inicioClamp - minInicioRango) * pxPorMinReal;
      const alto = Math.max(16, (finClamp - inicioClamp) * pxPorMinReal);
      const offsetPx = b.lane * 10;
      const x = xCol + offsetPx + 2;
      const ancho = anchoColumna - offsetPx - 4;
      if (ancho <= 4) return;

      const esSinClase = b.modalidad === "sin_clase";
      ctx.globalAlpha = esSinClase ? 0.45 : 1;
      ctx.fillStyle = b.color;
      dibujarRectRedondeado(ctx, x, top, ancho, alto, 6);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.save();
      dibujarRectRedondeado(ctx, x, top, ancho, alto, 6);
      ctx.clip();
      ctx.fillStyle = "#ffffff";
      const maxAnchoTexto = ancho - 8;
      const lineHeightTitulo = 14;
      let ty = top + 5;
      ctx.font = "600 12px " + FONT_CANVAS;
      // Cuántas líneas puede ocupar el título antes de que no quede alto ni
      // para eso: bloques bajitos se quedan en 1 línea (mismo resultado que
      // antes), pero uno con alto de sobra ahora sí puede envolver a 2-3
      // líneas en vez de truncarse de una.
      const maxLineasTitulo = alto > 60 ? 3 : alto > 34 ? 2 : 1;
      envolverTextoCanvas(ctx, b.nombreCorto, maxAnchoTexto, maxLineasTitulo).forEach((linea) => {
        ctx.fillText(linea, x + 5, ty);
        ty += lineHeightTitulo;
      });

      // Espacio real que queda después del título (que ahora puede ocupar
      // 1, 2 o 3 líneas) — reemplaza los umbrales fijos `alto > 30`/`alto >
      // 44` de antes, que asumían el título siempre en una sola línea y por
      // eso ya no reflejaban el alto real disponible.
      if (b.profesorNombre && top + alto - ty >= 12) {
        ctx.font = "400 10px " + FONT_CANVAS;
        ctx.fillText(truncarTextoCanvas(ctx, b.profesorNombre, maxAnchoTexto), x + 5, ty);
        ty += 13;
      }
      if (b.aula && top + alto - ty >= 12) {
        ctx.font = "400 10px " + FONT_CANVAS;
        ctx.fillText(truncarTextoCanvas(ctx, b.aula, maxAnchoTexto), x + 5, ty);
      }
      ctx.restore();

      if (b.emoji) {
        // Dibujado FUERA del clip del rect redondeado (a diferencia de
        // antes) — pegado a la esquina inferior derecha, la curva del
        // borde (radius 6) le recortaba un pedazo al emoji. Con 8px de
        // margen (antes 5px) además queda lejos de la zona curva. Mismo
        // lugar relativo que ocupa en la tarjeta viva (esquina inferior
        // derecha), solo que ya no corre riesgo de que el clip lo tape.
        //
        // save()/restore() en vez de resetear los valores a mano: textAlign
        // se devolvía a "left" pero textBaseline se quedaba en "alphabetic"
        // para el resto del dibujo (bug real reportado — "primera línea
        // cortada" en casi todas las tarjetas menos la primera dibujada).
        // Todo el código de arriba asume textBaseline "top" (seteado una
        // sola vez al principio de la función) para calcular `ty`; con el
        // baseline roto a "alphabetic", esa misma coordenada pasa a ser la
        // línea de base en vez del tope del texto, así que el cuerpo de la
        // letra se dibuja hacia ARRIBA de `ty` y el clip del rect redondeado
        // le corta el pedazo que se sale del bloque — de ahí el corte "a la
        // mitad" en el nombre de la materia.
        ctx.save();
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.font = "13px " + FONT_CANVAS;
        ctx.fillText(b.emoji, x + ancho - 8, top + alto - 8);
        ctx.restore();
      }
    });
  });

  // Pedido explícito: la imagen descargada NO debe incluir la línea de hora
  // actual (a diferencia de antes, que sí la dibujaba si "hoy" caía en la
  // semana exportada). La línea sigue viva en el grid en pantalla; acá
  // simplemente ya no se dibuja nada para ese indicador.

  return canvas;
}

function descargarHorarioComoImagen() {
  const semestre = obtenerSemestreHorarioActual();
  if (!semestre) {
    mostrarToast("No hay horario para descargar");
    return;
  }
  const numeroSemana = obtenerNumeroSemanaMostrado(semestre);
  const dias = obtenerDiasVisiblesOrdenados();
  if (dias.length === 0) {
    mostrarToast("No hay días visibles configurados (Ajustes → Horario)");
    return;
  }
  const clasesEfectivas = construirClasesEfectivasSemana(semestre, numeroSemana);
  const canvas = generarImagenHorario(semestre, numeroSemana, dias, clasesEfectivas);
  // toDataURL es SÍNCRONO (a diferencia de toBlob). El click del link de
  // descarga tiene que dispararse todavía dentro de la ventana de "user
  // activation" que abrió el click original del botón — con toBlob, para
  // cuando el callback async resuelve, esa ventana ya cerró y navegadores
  // de escritorio (Firefox, Chrome en modo estricto) bloquean la descarga
  // programática silenciosamente. Mobile es más laxo con esto, por eso
  // funcionaba en el teléfono pero no en PC. No hace falta revokeObjectURL
  // acá: no es un object URL, es un data URL.
  const nombreArchivo = `horario_${(semestre.nombre || "semestre").toLowerCase().replace(/[^a-z0-9]+/g, "-")}_semana-${numeroSemana}.png`;
  const url = canvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = url;
  a.download = nombreArchivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

// Punto 1 del ajuste a Horario propio: se extrae la lógica de "cambiar de
// semana" a estas dos funciones top-level (antes vivía inline, solo dentro
// de los listeners de los botones ‹ › del header) para poder reusarla desde
// la barra de navegación que ahora también se dibuja DENTRO del modo
// pantalla completa (ver headerWrap en renderizarHorarioInterno) — antes,
// una vez en fullscreen, esos botones del header quedaban fuera del árbol
// de document.fullscreenElement y por lo tanto inaccesibles/invisibles, sin
// forma de cambiar de semana sin salir del modo pantalla completa primero.
function irASemanaAnterior() {
  estado.horarioNumeroSemana = Math.max(1, (estado.horarioNumeroSemana || 1) - 1);
  renderizarHorarioInterno();
}
function irASemanaSiguiente() {
  const semestre = obtenerSemestreHorarioActual();
  const total = semestre ? Number(semestre.duracion_semanas) || 16 : 16;
  estado.horarioNumeroSemana = Math.min((estado.horarioNumeroSemana || 1) + 1, total);
  renderizarHorarioInterno();
}

function inicializarHorario() {
  inicializarEstadoHorarioSiHaceFalta();
  const btnAnterior = document.getElementById("btn-horario-semestre-anterior");
  const btnSiguiente = document.getElementById("btn-horario-semestre-siguiente");
  const btnAgregar = document.getElementById("btn-horario-agregar");
  const btnAmigos = document.getElementById("btn-horario-amigos");
  const btnPantallaCompleta = document.getElementById("btn-horario-pantalla-completa");
  const btnDescargar = document.getElementById("btn-horario-descargar");
  const nombreSemestreEl = document.getElementById("horario-nombre-semestre");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", irASemanaAnterior);
  }
  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", irASemanaSiguiente);
  }
  if (nombreSemestreEl) {
    nombreSemestreEl.style.cursor = "pointer";
    nombreSemestreEl.addEventListener("click", abrirSelectorSemestre);
  }
  if (btnAgregar) {
    btnAgregar.addEventListener("click", () => {
      const semestre = obtenerSemestreHorarioActual();
      if (!semestre) {
        mostrarToast("Creá un semestre primero");
        return;
      }
      abrirModalBloqueHorario({ semestreId: semestre.id, bloqueId: null });
    });
  }
  if (btnAmigos) {
    btnAmigos.addEventListener("click", () => abrirPanelAmigos());
  }
  inicializarHorarioAmigos();
  inicializarHorarioConjunto();
  if (btnDescargar) {
    btnDescargar.addEventListener("click", descargarHorarioComoImagen);
  }
  if (btnPantallaCompleta) {
    const contenedor = document.getElementById("horario-grid-contenedor");
    btnPantallaCompleta.addEventListener("click", () => {
      if (!contenedor) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else contenedor.requestFullscreen?.();
    });

    // FIX (pedido explícito: "debe existir un botón de salir de pantalla
    // completa siempre visible en horario normal, horario compartido y
    // todo, que no tape, que sea discreto pero que siempre esté ahí a
    // mano"): btnPantallaCompleta (el ⛶ de arriba) vive en #horario-header,
    // que es HERMANO de `contenedor` — al entrar a fullscreen sobre
    // `contenedor`, #horario-header queda fuera del árbol de
    // document.fullscreenElement (mismo motivo que obliga a reubicar
    // IDS_MODALES_GLOBALES vía sincronizarModalesConPantallaCompleta) y se
    // vuelve invisible/inaccesible: sin este botón aparte no había forma de
    // salir salvo Esc o el gesto nativo del navegador. Se crea UNA sola vez
    // acá (no en cada renderizarHorarioInterno) y luego renderizarHorarioInterno
    // lo reancla, vía anclarBotonSalirFSEnFila, dentro de la fila de
    // título/navegación de la vista que corresponda en cada render (propio /
    // Horario conjunto / individual de un amigo) — nunca se recrea, así no
    // pierde su listener de click al moverse de una fila a otra.
    if (contenedor) {
      const btnSalirFS = document.createElement("button");
      btnSalirFS.type = "button";
      btnSalirFS.id = "btn-horario-salir-pantalla-completa";
      btnSalirFS.className = "btn-icono-fantasma oculto";
      btnSalirFS.title = "Salir de pantalla completa";
      btnSalirFS.setAttribute("aria-label", "Salir de pantalla completa");
      // Ícono "contraer pantalla" (fullscreen_exit — cuatro flechas en L
      // apuntando hacia adentro) en vez de la "✕" anterior: el usuario pidió
      // específicamente "el cuadradito de cerrar pantalla completa, no una
      // X", sin relación visual con el ⛶ (expandir) que ya existe.
      btnSalirFS.innerHTML =
        '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
        '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>' +
        "</svg>";
      // Discreto: translúcido hasta hacer hover/tap. Anclado con
      // position:absolute pero YA NO relativo a `contenedor` (todo el
      // grid) sino a la fila angosta de título/navegación que lo reciba en
      // cada vista vía anclarBotonSalirFSEnFila — ver ahí el porqué del fix.
      btnSalirFS.style.cssText =
        "position:absolute; right:6px; top:50%; transform:translateY(-50%); z-index:5; " +
        "padding:3px 5px; opacity:0.65; transition:opacity 0.15s;";
      btnSalirFS.addEventListener("mouseenter", () => { btnSalirFS.style.opacity = "1"; });
      btnSalirFS.addEventListener("mouseleave", () => { btnSalirFS.style.opacity = "0.65"; });
      btnSalirFS.addEventListener("click", () => {
        if (document.fullscreenElement) document.exitFullscreen();
      });
      // Fallback hasta el primer render de una vista (que lo reancla en su
      // fila correspondiente vía anclarBotonSalirFSEnFila) — oculto igual,
      // no se ve flotando suelto acá ni un instante.
      contenedor.appendChild(btnSalirFS);
    }

    document.addEventListener("fullscreenchange", () => {
      sincronizarModalesConPantallaCompleta();
      const btnSalirFS = document.getElementById("btn-horario-salir-pantalla-completa");
      if (btnSalirFS) btnSalirFS.classList.toggle("oculto", document.fullscreenElement !== contenedor);
      requestAnimationFrame(() => renderizarHorarioInterno());
    });
  }
  window.addEventListener("resize", () => {
    if (!document.getElementById("seccion-horario")?.classList.contains("oculto")) renderizarHorarioInterno();
  });

  // Línea de hora actual: se mueve sola cada minuto sin re-renderizar todo
  // el grid (ver actualizarPosicionLineaHoraActual). Solo cuando la sección
  // está realmente visible — sin costo mientras el usuario está en otra
  // pestaña de la app.
  setInterval(() => {
    if (!document.getElementById("seccion-horario")?.classList.contains("oculto")) {
      actualizarPosicionLineaHoraActual();
    }
  }, 60000);
}

// Se expone en window para que horario-modal.js pueda refrescar el grid tras
// guardar/borrar sin crear un import circular (horario.js ya importa DE
// horario-modal.js) — mismo patrón que mostrarSeccion en main.js.
window.renderizarHorario = renderizarHorario;

// Horario entre Amigos — Parte 1: se exportan estos 3 helpers (ya existían,
// uso interno nada más) para que horario-amigos.js arme el snapshot público
// con exactamente el mismo color/nombre resuelto y el mismo rango de horas
// que ya se ven en el grid propio — sin duplicar esta lógica en otro
// archivo, lo que tarde o temprano se hubiera desincronizado del original.
export {
  inicializarHorario,
  renderizarHorario,
  obtenerSemestreHorarioActual,
  obtenerColorBloque,
  obtenerNombreBloque,
  obtenerRangoHorasHorario,
  obtenerPlanPorId,
  // activarModoConjunto es el nombre real de la función (se llamaba
  // abrirHorarioConjunto cuando esto era un modal aparte; el nombre externo
  // se mantiene igual para no tocar el import de horario-amigos.js).
  activarModoConjunto as abrirHorarioConjunto,
  // Punto 2 del prompt: mismo criterio de alias que la línea de arriba — el
  // nombre externo que horario-amigos.js ya importa ("abrir...") describe
  // la ACCIÓN desde afuera, mientras que acá adentro el nombre real
  // ("activar...") describe el cambio de estado interno.
  activarVistaIndividualAmigo as abrirVistaIndividualAmigo,
  // Agenda — Núcleo: la tarjetita "Mostrar clases" (agenda-clases.js)
  // reutiliza el MISMO modal de info de materia que usa el grid de Horario
  // (pedido explícito del spec: "reutilizar el mismo componente/modal de
  // info que ya existe en horario.js"), en vez de crear uno paralelo. Estos
  // 4 helpers son los que agenda-clases.js necesita para armar el mismo
  // objeto "clase efectiva enriquecida" que arma construirColumnaDia acá
  // arriba antes de poder llamar a abrirTarjetaInfoBloque.
  abrirTarjetaInfoBloque,
  obtenerEmojiModalidad,
  obtenerEtiquetaModalidad,
  obtenerNombreProfesor,
  fechaLocalDesdeISO,
  // Agenda — Núcleo (2026-08-29): agenda-clases.js reusa esta para el
  // cálculo crudo (sin acotar) de su propia calcularNumeroSemanaParaFecha,
  // en vez de mantener una segunda fórmula de "días desde fecha_inicio /
  // 7" que ya venía sin el anclaje-a-lunes ni el parseo seguro de fecha
  // que esta versión sí tiene (ver comentario grande en horario-modal.js).
  calcularNumeroSemanaSinAcotarParaFecha,
};
