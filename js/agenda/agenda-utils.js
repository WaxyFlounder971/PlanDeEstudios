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
import { obtenerPlanPorId } from "../horario/horario.js";
import { obtenerSemestresActuales, obtenerSemestresOrdenCronologico } from "../semestres/semestres.js";

/**
 * Agenda — Núcleo: "semestre activo" para Agenda es un concepto propio,
 * DISTINTO del semestre que Horario esté navegando en un momento dado
 * (estado.horarioSemestreId, que el usuario puede cambiar a mano con las
 * flechas ‹ › sin que eso implique nada sobre cuál es su semestre real
 * ahora mismo). Acá siempre es el semestre "actual" más reciente (mismo
 * criterio de fecha que usa obtenerEstadoEfectivoSemestre en schema.js); si
 * no hay ninguno marcado como actual, cae al más reciente que exista en
 * general, para que el formulario de alta nunca se quede sin materias que
 * ofrecer si el usuario todavía no le puso fecha a nada.
 */
function obtenerSemestreActivoAgenda() {
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
  return [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
}

/**
 * Fecha calendario (medianoche local) del primer día de la semana mostrada,
 * `offsetSemanas` semanas antes/después de la semana de hoy. Mismo mapeo
 * L-D -> Date.getDay() que usa calcularFechaDelDia en horario.js.
 */
function obtenerFechaInicioSemanaAgenda(offsetSemanas) {
  const diasOrdenados = obtenerDiasSemanaOrdenAgenda();
  const idxInicioCanonico = DIAS_SEMANA_CONFIG.findIndex((d) => d.id === diasOrdenados[0].id);
  const pesoInicio = (idxInicioCanonico + 1) % 7;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const diff = (hoy.getDay() - pesoInicio + 7) % 7;
  const inicio = new Date(hoy);
  inicio.setDate(hoy.getDate() - diff + offsetSemanas * 7);
  return inicio;
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

export {
  esHoyFecha,
  formatearFechaISO,
  formatearRangoSemanaAgenda,
  obtenerDiasSemanaAgenda,
  obtenerDiasSemanaOrdenAgenda,
  obtenerFechaInicioSemanaAgenda,
  obtenerMateriasVinculablesAgenda,
  obtenerSemestreActivoAgenda,
};
