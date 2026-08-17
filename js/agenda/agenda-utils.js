/* =========================================================================
   AGENDA — Utilidades (sin DOM)
   Helpers puros que comparten agenda.js, agenda-clases.js y agenda-modal.js:
   resolución del "semestre activo", materias vinculables de ese semestre, y
   cálculo de fechas de la semana mostrada. Separado en su propio archivo
   para que ningún par de los otros 3 necesite importarse entre sí.
   ========================================================================= */

import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { fechaLocalDesdeISO, obtenerPlanPorId } from "../horario/horario.js";
import { buscarSemestreVivoPorId, obtenerSemestresActuales, obtenerSemestresOrdenCronologico } from "../semestres/semestres.js";

/**
 * Agenda — Núcleo: "semestre activo" para Agenda es un concepto propio,
 * DISTINTO del semestre que Horario esté navegando en un momento dado
 * (estado.horarioSemestreId, que el usuario puede cambiar a mano con las
 * flechas ‹ › sin que eso implique nada sobre cuál es su semestre real
 * ahora mismo). Por default es el semestre "actual" más reciente (mismo
 * criterio de fecha que usa obtenerEstadoEfectivoSemestre en schema.js); si
 * no hay ninguno marcado como actual, cae al más reciente que exista en
 * general, para que el formulario de alta nunca se quede sin materias que
 * ofrecer si el usuario todavía no le puso fecha a nada.
 *
 * Ronda de ajustes visuales #2/#3 — fix: si la persona eligió a mano otro
 * semestre en el popover del header (estado.agendaSemestreSeleccionadoId,
 * ver alternarPopoverSemestreAgenda en agenda.js), ESE es el que manda acá
 * — antes esta función lo ignoraba por completo, así que el selector solo
 * cambiaba lo que se veía arriba en el nombre pero la lista de días, el
 * filtrado de eventos, las materias inline y el selector "vincular a
 * materia" del modal seguían mostrando el semestre real actual. Se valida
 * con buscarSemestreVivoPorId (no basta con el id solo) por si ese
 * semestre se borró mientras estaba seleccionado.
 */
function obtenerSemestreActivoAgenda() {
  if (estado.agendaSemestreSeleccionadoId) {
    const seleccionado = buscarSemestreVivoPorId(estado.agendaSemestreSeleccionadoId);
    if (seleccionado) return seleccionado;
  }
  const actuales = obtenerSemestresActuales();
  if (actuales.length > 0) return actuales[0];
  const cronologico = obtenerSemestresOrdenCronologico();
  return cronologico.length > 0 ? cronologico[cronologico.length - 1] : null;
}

/**
 * Materias matriculadas del semestre activo, ya resueltas con su nombre
 * legible — es la única fuente de materias que el selector de
 * materia_matriculada_id de agenda-modal.js debe ofrecer (decisión
 * confirmada: un evento solo se vincula a materias del semestre activo,
 * nunca de otro, para no tener que barrer todos los semestres del usuario).
 */
function obtenerMateriasVinculablesAgenda() {
  const semestre = obtenerSemestreActivoAgenda();
  if (!semestre) return [];
  return (semestre.materias_matriculadas || []).map((mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
    return {
      mmId: mm.id,
      semestreId: semestre.id,
      nombre: materia ? aplicarFormatoTexto(materia.nombre) : "Materia",
    };
  });
}

function formatearFechaISO(fecha) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, "0");
  const d = String(fecha.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function esHoyFecha(fecha) {
  const hoy = new Date();
  return (
    fecha.getDate() === hoy.getDate() &&
    fecha.getMonth() === hoy.getMonth() &&
    fecha.getFullYear() === hoy.getFullYear()
  );
}

/**
 * DIAS_SEMANA_CONFIG rotado para empezar en configuracion.dia_inicio_semana
 * — mismo criterio de rotación que obtenerDiasVisiblesOrdenados en
 * horario.js, pero SIN el filtro de "días visibles": Agenda siempre
 * muestra los 7 días, sin importar esa configuración (pedido explícito del
 * spec — Agenda es independiente de esa preferencia, que es solo para el
 * grid de Horario).
 */
function obtenerDiasSemanaOrdenAgenda() {
  const cfg = estado.datos.configuracion;
  const inicioId = cfg.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const nombres = cfg.nombres_dias_personalizados || {};
  return [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)].map((d) => ({
    ...d,
    // Mismo criterio que obtenerDiasVisiblesOrdenados en horario.js: nombre
    // personalizado si el usuario puso uno en Ajustes → Horario, si no la
    // abreviatura por defecto (L, K, M...) — se comparte la misma
    // configuración entre Horario y Agenda a propósito, es la MISMA idea de
    // "cómo le decís vos a este día", no algo que deba configurarse dos veces.
    etiquetaCorta: nombres[d.id] || d.abrevDefault,
  }));
}

/**
 * Fecha calendario (medianoche local) del primer día de la semana mostrada,
 * `offsetSemanas` semanas antes/después de la semana de hoy. Mismo mapeo
 * L-D -> Date.getDay() que usa calcularFechaDelDia en horario.js.
 */
function obtenerFechaInicioSemanaAgenda(offsetSemanas) {
  const pesoInicio = obtenerPesoDiaInicioAgenda();
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diff = (hoy.getDay() - pesoInicio + 7) % 7;
  const inicio = new Date(hoy);
  inicio.setDate(hoy.getDate() - diff + offsetSemanas * 7);
  return inicio;
}

/**
 * getDay() (0=domingo..6=sábado) del día configurado como inicio de semana
 * — pieza compartida entre obtenerFechaInicioSemanaAgenda() (ancla en HOY)
 * y obtenerInicioSemanaQueContiene() (ancla en una fecha arbitraria, la que
 * necesita el Calendario para saber en qué semana de Lista cae un día
 * cualquiera del grid mensual).
 */
function obtenerPesoDiaInicioAgenda() {
  const diasOrdenados = obtenerDiasSemanaOrdenAgenda();
  const idxInicioCanonico = DIAS_SEMANA_CONFIG.findIndex((d) => d.id === diasOrdenados[0].id);
  return (idxInicioCanonico + 1) % 7;
}

/**
 * Calendario — Núcleo: primer día de la semana (según dia_inicio_semana)
 * que contiene `fecha` — a diferencia de obtenerFechaInicioSemanaAgenda,
 * que siempre ancla en HOY, esta ancla en cualquier fecha arbitraria. La
 * usa el grid mensual para agrupar sus celdas en filas de semana completa
 * (incluyendo los días del mes anterior/siguiente que rellenan la primera y
 * última fila), y el salto "Calendario -> Lista" para saber a qué semana
 * moverse.
 */
function obtenerInicioSemanaQueContiene(fecha) {
  const pesoInicio = obtenerPesoDiaInicioAgenda();
  const base = new Date(fecha);
  base.setHours(0, 0, 0, 0);
  const diff = (base.getDay() - pesoInicio + 7) % 7;
  const inicio = new Date(base);
  inicio.setDate(base.getDate() - diff);
  return inicio;
}

/**
 * Calendario — Núcleo: cuántas semanas hay que sumarle al offset de HOY
 * (estado.agendaOffsetSemana, el mismo que usa la vista Lista) para que
 * Lista muestre la semana que contiene `fecha` — es lo que permite que
 * tocar un día en el grid mensual/semanal del Calendario salte a Lista ya
 * parado en la semana correcta.
 */
function obtenerOffsetSemanaParaFecha(fecha) {
  const inicioHoy = obtenerFechaInicioSemanaAgenda(0);
  const inicioObjetivo = obtenerInicioSemanaQueContiene(fecha);
  const diffMs = inicioObjetivo.getTime() - inicioHoy.getTime();
  return Math.round(diffMs / (7 * 24 * 60 * 60 * 1000));
}

/**
 * Código de día ("L".."D") de una fecha CUALQUIERA, directo por
 * Date.getDay() — a diferencia de obtenerDiasSemanaAgenda/
 * obtenerDiasSemanaOrdenAgenda (que dan los días YA rotados según
 * dia_inicio_semana para armar una semana completa), esto es para el caso
 * inverso: ya se tiene una fecha puntual (una celda del grid mensual) y
 * hace falta saber su código de día para consultar bloques_horario/
 * obtenerClasesEfectivasSemana, que siempre usan el código CANÓNICO
 * (L=lunes..D=domingo), sin importar cuál sea el inicio de semana
 * configurado.
 */
function obtenerCodigoDiaSemana(fecha) {
  const peso = fecha.getDay(); // 0=domingo..6=sábado
  const idxCanonico = (peso + 6) % 7; // 0=lunes..6=domingo
  return DIAS_SEMANA_CONFIG[idxCanonico].abrevDefault;
}

/**
 * Los 7 días de la semana mostrada, cada uno con su fecha calendario real
 * ya resuelta. `offsetSemanas`: 0 = semana de hoy, 1 = próxima, -1 =
 * anterior, etc.
 */
function obtenerDiasSemanaAgenda(offsetSemanas) {
  const inicioSemana = obtenerFechaInicioSemanaAgenda(offsetSemanas);
  return obtenerDiasSemanaOrdenAgenda().map((dia, i) => {
    const fecha = new Date(inicioSemana);
    fecha.setDate(inicioSemana.getDate() + i);
    return { ...dia, fecha };
  });
}

/** Texto compacto del rango de la semana mostrada, ej. "12 - 18 ago." */
function formatearRangoSemanaAgenda(dias) {
  if (dias.length === 0) return "";
  const primero = dias[0].fecha;
  const ultimo = dias[dias.length - 1].fecha;
  const mismoMes = primero.getMonth() === ultimo.getMonth();
  const opcionesCorto = { day: "numeric", month: "short" };
  if (mismoMes) {
    const mes = ultimo.toLocaleDateString("es-CR", { month: "short" });
    return `${primero.getDate()} - ${ultimo.getDate()} ${mes}`;
  }
  return `${primero.toLocaleDateString("es-CR", opcionesCorto)} - ${ultimo.toLocaleDateString("es-CR", opcionesCorto)}`;
}

/**
 * "7:30 a.m." / "1:05 p.m." a partir de "HH:MM" (24h). Rediseño núcleo
 * Agenda — punto 9: las materias inline muestran su hora en este formato en
 * vez del "HH:MM" crudo que usa el grid de Horario, a pedido del spec.
 */
function formatearHoraAmPm(horaStr) {
  if (!horaStr) return "";
  const [h, m] = String(horaStr).split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return horaStr;
  const periodo = h < 12 ? "a.m." : "p.m.";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${periodo}`;
}

/**
 * Rediseño núcleo Agenda — punto 4: mapa único de "cómo se pinta cada
 * combinación tipo/estado", para que badge (clase) y borde (hex, mismo tono
 * que el `border-color` de esa clase en design-system.css) nunca queden
 * desincronizados entre sí. `es_feriado`/`completada` son las 2 únicas
 * bifurcaciones dentro de un mismo tipo (ver crearEventoAgenda en
 * schema.js) — evento normal vs. feriado, tarea pendiente vs. completada.
 * Vive acá (no en agenda.js) porque agenda-modal.js también la necesita
 * para pintar la tarjeta de info del punto 11, y agenda-modal.js no puede
 * importar de vuelta a agenda.js sin crear un ciclo (agenda.js ya importa
 * DE agenda-modal.js para abrir sus modales).
 */
function obtenerEstiloEvento(evento) {
  if (evento.tipo === "tarea" && evento.completada) {
    return { etiqueta: "Completada", claseBadge: "badge-info", colorBorde: "#3b82f6" };
  }
  if (evento.tipo === "tarea") {
    return { etiqueta: "Tarea", claseBadge: "badge-warning", colorBorde: "#f59e0b" };
  }
  if (evento.tipo === "examen") {
    return { etiqueta: "Examen", claseBadge: "badge-danger", colorBorde: "#ef4444" };
  }
  if (evento.tipo === "evento" && evento.es_feriado) {
    return { etiqueta: "Feriado", claseBadge: "badge-success", colorBorde: "#10b981" };
  }
  return { etiqueta: "Evento", claseBadge: "badge-purple", colorBorde: "#a855f7" };
}

/**
 * Punto 6: "vencida" es SIEMPRE derivado (no se guarda — ver comentario del
 * spec en schema.js), se recalcula cada vez comparando contra la fecha de
 * HOY en formato ISO (comparación lexicográfica de "YYYY-MM-DD", válida sin
 * parsear ninguna de las 2 fechas).
 */
function esTareaVencida(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  return evento.fecha < formatearFechaISO(new Date());
}

function tareaVenceHoy(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  return evento.fecha === formatearFechaISO(new Date());
}

/** "3h 42min restantes" / "42min restantes" hasta las 23:59:59 del día de `fechaISO`. */
function formatearTiempoRestanteHoy(fechaISO) {
  const finDelDia = fechaLocalDesdeISO(fechaISO);
  finDelDia.setHours(23, 59, 59, 999);
  const msRestantes = finDelDia.getTime() - Date.now();
  if (msRestantes <= 0) return "Vence en instantes";
  const minutosTotales = Math.floor(msRestantes / 60000);
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  return horas > 0 ? `⏳ ${horas}h ${minutos}min restantes` : `⏳ ${minutos}min restantes`;
}

/**
 * Rediseño núcleo Agenda — punto 10 (modo "Todo" del filtro "Mostrar"):
 * TODOS los días desde HOY hasta el fin del semestre activo, +2 semanas de
 * margen (pedido explícito del punto 12, "por si se alarga"). Sin
 * `semestre` (o con `fecha_inicio` inválida), cae a un rango fijo de ~8
 * semanas desde hoy — no hay forma de saber "fin de semestre" sin uno, pero
 * tampoco tiene sentido dejar el modo "Todo" sin ningún rango.
 *
 * `diasAtras` (ajuste visual, punto 4): cantidad de días ANTERIORES a hoy a
 * incluir también al principio del rango — 0 (default) es el comportamiento
 * original, sin días previos. Lo usa el control "Ver días anteriores" del
 * subheader de modo Todo (ver construirSubheaderTodo en agenda.js) para ir
 * extendiendo el rango hacia atrás sin tocar el final calculado.
 */
function obtenerRangoDiasAgendaTodo(semestre, diasAtras = 0) {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  const MS_SEMANA = 7 * 24 * 60 * 60 * 1000;
  let fin = new Date(hoy.getTime() + 8 * MS_SEMANA);
  if (semestre) {
    const inicio = new Date(semestre.fecha_inicio);
    if (!isNaN(inicio.getTime())) {
      const totalSemanas = (Number(semestre.duracion_semanas) || 16) + 2;
      fin = new Date(inicio.getTime() + totalSemanas * MS_SEMANA);
    }
  }
  // Semestre ya terminado (incluido el margen): igual se muestra al menos
  // 1 semana desde hoy, para que el modo "Todo" nunca quede vacío.
  if (fin.getTime() < hoy.getTime()) fin = new Date(hoy.getTime() + MS_SEMANA);

  const etiquetaPorCodigo = {};
  obtenerDiasSemanaOrdenAgenda().forEach((d) => {
    // `etiqueta` (nombre completo, ej. "Lunes") — mismo campo que usa
    // construirBloqueDia en agenda.js para el encabezado de cada día en
    // modo Semanal; NO `etiquetaCorta` (esa es para las abreviaturas del
    // grid de Horario, un contexto distinto).
    etiquetaPorCodigo[d.abrevDefault] = d.etiqueta;
  });

  const dias = [];
  const cursor = new Date(hoy);
  if (diasAtras > 0) cursor.setDate(cursor.getDate() - diasAtras);
  while (cursor.getTime() <= fin.getTime()) {
    const codigo = obtenerCodigoDiaSemana(cursor);
    dias.push({ abrevDefault: codigo, etiqueta: etiquetaPorCodigo[codigo] || codigo, fecha: new Date(cursor) });
    cursor.setDate(cursor.getDate() + 1);
  }
  return dias;
}

export {
  esHoyFecha,
  esTareaVencida,
  formatearFechaISO,
  formatearHoraAmPm,
  formatearRangoSemanaAgenda,
  formatearTiempoRestanteHoy,
  obtenerCodigoDiaSemana,
  obtenerDiasSemanaAgenda,
  obtenerDiasSemanaOrdenAgenda,
  obtenerEstiloEvento,
  obtenerFechaInicioSemanaAgenda,
  obtenerInicioSemanaQueContiene,
  obtenerMateriasVinculablesAgenda,
  obtenerOffsetSemanaParaFecha,
  obtenerRangoDiasAgendaTodo,
  obtenerSemestreActivoAgenda,
  tareaVenceHoy,
};
