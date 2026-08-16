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
import { abrirModalBloqueHorario, construirZonaCronograma } from "./horario-modal.js";
import { abrirPanelAmigos, inicializarHorarioAmigos, obtenerListaAmigosParaDiaConjunto, refrescarSnapshotsAmigos } from "./horario-amigos.js";

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

// Transitorio (no persistido): qué se está mostrando ahora mismo en Horario.
estado.horarioSemestreId = estado.horarioSemestreId || null;
estado.horarioNumeroSemana = estado.horarioNumeroSemana || null;
estado.horarioExpandido = estado.horarioExpandido || false;
// Horario conjunto: NO es un modal — reemplaza temporalmente el contenido
// de #horario-grid (ver renderizarHorarioInterno). horarioModoConjunto
// indica si está activo ahora mismo; horarioConjuntoDiaIdx es el índice
// (dentro de obtenerDiasVisiblesOrdenados) del día que se está mostrando
// ahí. null = todavía no se activó esta sesión, se inicializa la primera
// vez en activarModoConjunto() al día real de hoy.
estado.horarioModoConjunto = estado.horarioModoConjunto || false;
estado.horarioConjuntoDiaIdx = estado.horarioConjuntoDiaIdx ?? null;

// Cache del último semestre/semana renderizados, para que centrarVistaInicial
// no tenga que recalcular nada por su cuenta.
let cacheSemestre = null;
let cacheNumeroSemana = null;

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

function obtenerSemestreHorarioActual() {
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

function obtenerDiasVisiblesOrdenados() {
  const cfg = estado.datos.configuracion;
  const visiblesIds = new Set(cfg.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id));
  const nombres = cfg.nombres_dias_personalizados || {};
  const inicioId = cfg.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const rotado = [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
  return rotado
    .filter((d) => visiblesIds.has(d.id))
    .map((d) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault }));
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
    tarjeta.innerHTML = `
      <div style="font-size:0.85rem; font-weight:600; line-height:1.15; display:flex; align-items:center; gap:4px; margin-bottom:2px; overflow-wrap:break-word; word-break:break-word;">
        ${b.tieneExcepcionEstaSemana ? `<span title="Esta semana tiene un ajuste puntual" style="font-size:1.05rem; opacity:0.9; flex-shrink:0;">✎</span>` : ""}
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
      <button type="button" class="modal-x-close" id="horario-info-cerrar">✕</button>
      <div style="padding:20px;">
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
  } else {
    const columnaAncha = document.createElement("div");
    columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

    const headerFila = document.createElement("div");
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
    headerFila.style.cssText = "display:flex; position:sticky; top:0; z-index:50; background:var(--bg-header-solido); border-bottom:1px solid rgba(150,150,170,0.15);";
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
          tieneExcepcionEstaSemana: !!c.tiene_ajuste_cronograma,
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

    columnaAncha.appendChild(headerFila);
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
  // entre TODOS los días visibles de la semana. El modo conjunto tiene su
  // propio auto-scroll (por día, mío + de amigos) disparado desde adentro
  // de renderizarHorarioConjuntoInterno — no aplica acá.
  if (!estado.horarioModoConjunto) {
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

function activarModoConjunto() {
  if (estado.horarioModoConjunto) return;
  estado.horarioModoConjunto = true;

  if (estado.horarioConjuntoDiaIdx == null) {
    // Primera vez en esta sesión: arranca en el día real de hoy si está
    // entre los días visibles configurados; si no (ej. domingo oculto),
    // cae al primero de la lista en vez de romper.
    const dias = obtenerDiasVisiblesOrdenados();
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

// Cablea el botón "‹ Salir del modo conjunto" (ver index.html, junto a
// btn-horario-agregar). Se llama una sola vez desde inicializarHorario();
// activarModoConjunto() ya se dispara aparte, desde el click de
// btn-horario-conjunto en horario-amigos.js.
function inicializarHorarioConjunto() {
  const btnSalir = document.getElementById("btn-salir-modo-conjunto");
  if (btnSalir) {
    btnSalir.addEventListener("click", () => desactivarModoConjunto());
  }
}

function moverDiaConjunto(delta) {
  const dias = obtenerDiasVisiblesOrdenados();
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

/**
 * Reemplaza TEMPORALMENTE el contenido de #horario-grid mientras
 * estado.horarioModoConjunto esté activo (ver renderizarHorarioInterno,
 * que decide cuál de las dos ramas renderizar) — no es una ventana/modal
 * aparte, es el mismo grid de siempre con otro contenido adentro. En vez
 * de la fila de encabezados Lun..Dom del grid semanal, acá va una fila de
 * navegación "‹ Lunes ›" (un solo día a la vez) seguida de una fila con
 * una columna por persona (Yo + cada amigo vinculado).
 */
function renderizarHorarioConjuntoInterno(cont, semestre, numeroSemana) {
  cont.innerHTML = "";
  if (!semestre) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">Creá un semestre en Semestres para ver el horario conjunto.</p>`;
    return;
  }

  const dias = obtenerDiasVisiblesOrdenados();
  if (dias.length === 0) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">No hay días visibles configurados (Ajustes → Horario).</p>`;
    return;
  }
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
  const amigosDia = obtenerListaAmigosParaDiaConjunto(fechaDia, diaSel.abrevDefault);

  const columnaAncha = document.createElement("div");
  columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

  // Encabezado sticky de dos filas: nav de día arriba, nombres de persona
  // debajo — un solo wrapper sticky (no cada fila por separado) para no
  // tener que adivinar el alto de la fila de arriba con un top:Npx fijo.
  const encabezado = document.createElement("div");
  encabezado.style.cssText = "position:sticky; top:0; z-index:50; background:var(--bg-header-solido);";

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
  filaGrid.style.cssText = "display:flex;";
  filaGrid.appendChild(construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango));
  filaGrid.appendChild(
    construirColumnaPersonaConjunto(bloquesPropios, pxPorMin, altoGrid, minInicioRango, minFinRango, bloquesPropios.length === 0 ? "Sin clases" : null)
  );
  amigosDia.forEach(({ bloques, caida }) => {
    const mensaje = caida ? "Enlace caído" : bloques.length === 0 ? "Sin clases" : null;
    filaGrid.appendChild(construirColumnaPersonaConjunto(bloques, pxPorMin, altoGrid, minInicioRango, minFinRango, mensaje));
  });

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
  const ALTO = 900; // 16:9

  const colorFondo = obtenerVarCSS("--bg-canvas", "#101114");
  const colorBorde = obtenerVarCSS("--border-glass", "rgba(255,255,255,0.10)");
  const colorTexto = obtenerVarCSS("--text-primary", "#F1F2F4");
  const colorTextoSec = obtenerVarCSS("--text-secondary", "#B7BAC1");

  const canvas = document.createElement("canvas");
  canvas.width = ANCHO;
  canvas.height = ALTO;
  const ctx = canvas.getContext("2d");
  ctx.textBaseline = "top";

  ctx.fillStyle = colorFondo;
  ctx.fillRect(0, 0, ANCHO, ALTO);

  const margenX = 24;
  const margenInferior = 22;
  let cursorY = 20;

  ctx.fillStyle = colorTexto;
  ctx.font = "700 26px " + FONT_CANVAS;
  ctx.fillText(semestre.nombre || "Horario", margenX, cursorY);

  ctx.fillStyle = colorTextoSec;
  ctx.font = "400 15px " + FONT_CANVAS;
  ctx.fillText(`Semana ${numeroSemana}`, margenX, cursorY + 32);

  cursorY += 66;

  const { horaInicio, horaFin } = obtenerRangoHorasHorario();
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const anchoHoras = 56;
  const xGridInicio = margenX + anchoHoras;
  const anchoGridDisponible = ANCHO - margenX - xGridInicio;
  const anchoColumna = anchoGridDisponible / dias.length;

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

  const yGridInicio = cursorY + 42;
  const altoGridReal = ALTO - yGridInicio - margenInferior;
  const pxPorMinReal = altoGridReal / (minFinRango - minInicioRango);

  // Líneas horarias + etiquetas de hora (cada hora en punto, para no
  // amontonar texto — el grid en vivo sí marca cada 30min pero acá el
  // espacio es fijo y limitado)
  ctx.strokeStyle = colorBorde;
  ctx.lineWidth = 1;
  ctx.textAlign = "right";
  for (let h = Math.ceil(horaInicio); h <= Math.floor(horaFin); h++) {
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
      let ty = top + 5;
      ctx.font = "600 12px " + FONT_CANVAS;
      ctx.fillText(truncarTextoCanvas(ctx, b.nombreCorto, ancho - 8), x + 5, ty);
      ty += 15;
      if (b.profesorNombre && alto > 30) {
        ctx.font = "400 10px " + FONT_CANVAS;
        ctx.fillText(truncarTextoCanvas(ctx, b.profesorNombre, ancho - 8), x + 5, ty);
        ty += 13;
      }
      if (b.aula && alto > 44) {
        ctx.font = "400 10px " + FONT_CANVAS;
        ctx.fillText(truncarTextoCanvas(ctx, b.aula, ancho - 8), x + 5, ty);
      }
      ctx.restore();

      if (b.emoji) {
        // Dibujado FUERA del clip del rect redondeado (a diferencia de
        // antes) — pegado a la esquina inferior derecha, la curva del
        // borde (radius 6) le recortaba un pedazo al emoji. Con 8px de
        // margen (antes 5px) además queda lejos de la zona curva. Mismo
        // lugar relativo que ocupa en la tarjeta viva (esquina inferior
        // derecha), solo que ya no corre riesgo de que el clip lo tape.
        ctx.textAlign = "right";
        ctx.textBaseline = "alphabetic";
        ctx.font = "13px " + FONT_CANVAS;
        ctx.fillText(b.emoji, x + ancho - 8, top + alto - 8);
        ctx.textAlign = "left";
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

function inicializarHorario() {
  const btnAnterior = document.getElementById("btn-horario-semestre-anterior");
  const btnSiguiente = document.getElementById("btn-horario-semestre-siguiente");
  const btnAgregar = document.getElementById("btn-horario-agregar");
  const btnAmigos = document.getElementById("btn-horario-amigos");
  const btnPantallaCompleta = document.getElementById("btn-horario-pantalla-completa");
  const btnDescargar = document.getElementById("btn-horario-descargar");
  const nombreSemestreEl = document.getElementById("horario-nombre-semestre");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      estado.horarioNumeroSemana = Math.max(1, (estado.horarioNumeroSemana || 1) - 1);
      renderizarHorarioInterno();
    });
  }
  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const semestre = obtenerSemestreHorarioActual();
      const total = semestre ? Number(semestre.duracion_semanas) || 16 : 16;
      estado.horarioNumeroSemana = Math.min((estado.horarioNumeroSemana || 1) + 1, total);
      renderizarHorarioInterno();
    });
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
    document.addEventListener("fullscreenchange", () => {
      sincronizarModalesConPantallaCompleta();
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
  // Agenda — Núcleo: la tarjetita "Mostrar clases" (agenda-clases.js)
  // reutiliza el MISMO modal de info de materia que usa el grid de Horario
  // (pedido explícito del spec: "reutilizar el mismo componente/modal de
  // info que ya existe en horario.js"), en vez de crear uno paralelo. Estos
  // 4 helpers son los que agenda-clases.js necesita para armar el mismo
  // objeto "clase efectiva enriquecida" que arma construirColumnaDia acá
  // arriba antes de poder llamar a abrirTarjetaInfoBloque.
  abrirTarjetaInfoBloque,
  obtenerEmojiModalidad,
  obtenerNombreProfesor,
  fechaLocalDesdeISO,
};
