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
 * Idea "varios semestres a la vez" — Núcleo: qué semestres está mostrando
 * Agenda AHORA MISMO es un conjunto (no un único semestre), DISTINTO del
 * semestre que Horario esté navegando en un momento dado
 * (estado.horarioSemestreId, que el usuario puede cambiar a mano con las
 * flechas ‹ › sin que eso implique nada sobre qué semestres son "los
 * reales" ahora). Se elige desde el modal de tarjetas del header (ver
 * poblarModalSemestresAgenda/alternarSeleccionSemestreAgenda en agenda.js),
 * que arma sus tarjetas con TODOS los semestres (obtenerSemestresOrdenCronologico) y
 * marca como seleccionadas las de este conjunto.
 *
 * `estado.agendaSemestresSeleccionados`: `null`/`undefined` = "automático"
 * (nunca se tocó el modal esta sesión) — se resuelve acá abajo al conjunto
 * de semestres "actuales" (mismo criterio de fecha que
 * obtenerEstadoEfectivoSemestre en schema.js), o si no hay ninguno marcado
 * como actual, al más reciente que exista en general (mismo fallback de
 * siempre, para que el formulario de alta nunca se quede sin materias que
 * ofrecer si el usuario todavía no le puso fecha a nada). Un array
 * (posiblemente vacío) es una selección EXPLÍCITA: la persona ya tocó al
 * menos una tarjeta esta sesión, así que manda tal cual — incluido el caso
 * "array vacío" (decisión confirmada: ningún semestre marcado = Agenda
 * vacía con mensaje "Selecciona al menos un semestre", no un fallback
 * silencioso a otra cosa).
 *
 * Se valida cada id con buscarSemestreVivoPorId (no basta con el id solo)
 * por si alguno se borró mientras estaba seleccionado, y el resultado
 * siempre vuelve ordenado cronológico ASC (más antiguo primero) — mismo
 * orden que se usa para armar "Semestre X · Semestre Y" en el header.
 */
function obtenerSemestresSeleccionadosAgenda() {
  let ids;
  if (Array.isArray(estado.agendaSemestresSeleccionados)) {
    ids = estado.agendaSemestresSeleccionados;
  } else {
    const actuales = obtenerSemestresActuales();
    if (actuales.length > 0) {
      ids = actuales.map((s) => s.id);
    } else {
      const cronologico = obtenerSemestresOrdenCronologico();
      ids = cronologico.length > 0 ? [cronologico[cronologico.length - 1].id] : [];
    }
  }
  return ids
    .map((id) => buscarSemestreVivoPorId(id))
    .filter(Boolean)
    .sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)));
}

/**
 * Semestre de REFERENCIA entre los seleccionados — el más reciente
 * cronológicamente. Se mantiene este nombre (antes devolvía el ÚNICO
 * semestre activo de Agenda) porque algunos cálculos son inherentemente de
 * UN solo semestre a la vez y no tiene sentido partirlos por conjunto: el
 * número de "Semana N" del header y el fin de rango del modo "Todo"
 * (calcularNumeroSemanaParaFecha / obtenerRangoDiasAgendaTodo). El más
 * reciente de los seleccionados es el criterio más útil ahí (la semana en
 * curso importa más que la de un semestre viejo que se dejó marcado nada
 * más para ver sus materias pasadas).
 */
function obtenerSemestreActivoAgenda() {
  const seleccionados = obtenerSemestresSeleccionadosAgenda();
  return seleccionados.length > 0 ? seleccionados[seleccionados.length - 1] : null;
}

/**
 * Materias matriculadas de TODOS los semestres seleccionados, ya resueltas
 * con su nombre legible — es la única fuente de materias que el selector de
 * materia_matriculada_id de agenda-modal.js debe ofrecer (decisión
 * confirmada: un evento solo se vincula a materias de los semestres
 * seleccionados, nunca de otro, para no tener que barrer todos los
 * semestres del usuario).
 *
 * Caso límite confirmado: si dos semestres seleccionados tienen una materia
 * con el MISMO nombre, ambas entradas se desambiguan agregando el nombre de
 * su semestre ("Cálculo I - Semestre 2025-B") — si el nombre es único entre
 * los semestres seleccionados, se deja tal cual (sin sufijo), igual que
 * antes.
 *
 * `mmId` (materia_matriculada.id) se asume único globalmente entre TODOS
 * los semestres del usuario (mismo criterio que ya usa el resto del
 * proyecto para ids, ej. evento.id) — es lo que permite usarlo tal cual
 * como valor del <select> nativo en agenda-modal.js sin tener que
 * componerlo con el semestreId.
 */
function obtenerMateriasVinculablesAgenda() {
  const semestres = obtenerSemestresSeleccionadosAgenda();
  const materias = [];
  semestres.forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      const plan = obtenerPlanPorId(mm.plan_estudio_id);
      const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
      materias.push({
        mmId: mm.id,
        semestreId: semestre.id,
        semestreNombre: semestre.nombre || "Semestre",
        nombreBase: materia ? aplicarFormatoTexto(materia.nombre) : "Materia",
      });
    });
  });

  const conteoPorNombre = new Map();
  materias.forEach((m) => conteoPorNombre.set(m.nombreBase, (conteoPorNombre.get(m.nombreBase) || 0) + 1));

  return materias.map((m) => ({
    mmId: m.mmId,
    semestreId: m.semestreId,
    nombre: conteoPorNombre.get(m.nombreBase) > 1 ? `${m.nombreBase} - ${m.semestreNombre}` : m.nombreBase,
  }));
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
 *
 * Fix reportado: una tarea que vence HOY con hora puntual (`evento.hora`) ya
 * pasada seguía contando como "vence hoy" (mostrando "Vence en instantes"
 * indefinidamente) hasta medianoche, en vez de pasar a vencida apenas cruza
 * su hora límite. Ahora, si `fecha` es hoy y hay `hora` asignada, también se
 * compara esa hora puntual contra el momento actual — sin hora asignada
 * ("todo el día") el comportamiento sigue siendo el de siempre (solo vence
 * al cambiar el día).
 */
function esTareaVencida(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  const hoyISO = formatearFechaISO(new Date());
  if (evento.fecha < hoyISO) return true;
  if (evento.fecha === hoyISO && evento.hora) {
    const [h, m] = String(evento.hora).split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) {
      const limite = new Date();
      limite.setHours(h, m, 0, 0);
      return Date.now() > limite.getTime();
    }
  }
  return false;
}

function tareaVenceHoy(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  if (evento.fecha !== formatearFechaISO(new Date())) return false;
  return !esTareaVencida(evento);
}

/**
 * "3h 42min restantes" / "42min restantes" hasta la hora puntual del
 * evento (`horaStr`, "HH:MM") si tiene una asignada, o hasta las 23:59:59
 * del día de `fechaISO` si es "todo el día" (`horaStr` vacío/null).
 *
 * Fix reportado: antes SIEMPRE apuntaba a las 23:59:59 sin importar la hora
 * real del evento — bien para "todo el día", pero una vez que el usuario le
 * ponía una hora puntual (ej. 17:00) el timer seguía contando contra
 * medianoche, mostrando horas de más ("faltan 22h" en vez de las ~15h
 * reales hasta las 17:00). Ahora, si `horaStr` viene con valor, el
 * objetivo del conteo es ESA hora puntual, no el fin del día.
 */
function formatearTiempoRestanteHoy(fechaISO, horaStr) {
  const fin = fechaLocalDesdeISO(fechaISO);
  if (horaStr) {
    const [h, m] = String(horaStr).split(":").map(Number);
    if (!Number.isNaN(h) && !Number.isNaN(m)) fin.setHours(h, m, 0, 0);
    else fin.setHours(23, 59, 59, 999);
  } else {
    fin.setHours(23, 59, 59, 999);
  }
  const msRestantes = fin.getTime() - Date.now();
  if (msRestantes <= 0) return "Vence en instantes";
  const minutosTotales = Math.floor(msRestantes / 60000);
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  return horas > 0 ? `⏳ ${horas}h ${minutos}min restantes` : `⏳ ${minutos}min restantes`;
}

/**
 * Pedido nuevo (Ajustes de Agenda): qué mostrar en la columna derecha de un
 * item cuando "vence hoy" — "hora" (solo hora de entrega), "restante" (solo
 * tiempo restante, comportamiento de siempre / default) o "ambos". Persiste
 * en `configuracion.agenda_venceHoy_modo` — mismo patrón que el resto de
 * ajustes de Agenda (ver inicializarFiltrosAgenda en agenda.js, que además
 * escribe acá). Vive en este archivo (no en agenda.js) porque
 * construirItemEvento (agenda.js) Y la tarjeta de info (agenda-modal.js)
 * necesitan leerlo por igual, y agenda-modal.js no puede importar de vuelta
 * a agenda.js sin crear un ciclo — mismo motivo que obtenerEstiloEvento acá
 * arriba.
 */
function obtenerModoVenceHoyAgenda() {
  const modo = estado.datos?.configuracion?.agenda_venceHoy_modo;
  return modo === "hora" || modo === "ambos" ? modo : "restante";
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
  obtenerModoVenceHoyAgenda,
  obtenerOffsetSemanaParaFecha,
  obtenerRangoDiasAgendaTodo,
  obtenerSemestreActivoAgenda,
  obtenerSemestresSeleccionadosAgenda,
  tareaVenceHoy,
};
