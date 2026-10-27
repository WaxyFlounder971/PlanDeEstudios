/* =========================================================================
   FINANZAS 2.0: Metas con fecha (sesión 4, F5), lógica pura sin DOM.
   Una meta puede tener fecha objetivo y un aporte programado. Todo se DERIVA:
   el saldo sale de los movimientos y nada de lo de aquí se guarda como contador.
   - Aporte sugerido: lo que falta repartido entre las semanas o meses que quedan.
   - Fecha estimada: según el ritmo REAL de aportes (nunca avances inflados).
   - Aporte programado: un PLAN, no mueve dinero. Solo resta de Disponible
     (finanzas-disponible.js) y la persona registra el aporte cuando lo hace.
   Tono sin culpa: informa y propone; nunca regaña.
   ========================================================================= */

import { hoyIso } from "./finanzas-modelo.js";
import { calcularSaldoMeta, movimientosVigentes, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { sellarTimestamp } from "./schema.js";

const FRECUENCIAS_APORTE = ["semanal", "quincenal", "mensual"];
const VENTANA_RITMO_METAS = 90;
const MINIMO_HISTORIAL = 14;
const MINIMO_APORTES = 2;
const MAX_DIAS_ESTIMADO = 3650;
const DIAS_POR_MES = 30.4375;

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esIso = (x) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || ""));
  if (!m) return false;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return f.getUTCFullYear() === +m[1] && f.getUTCMonth() === +m[2] - 1 && f.getUTCDate() === +m[3]; // rechaza el 30 de febrero
};
const dias = (iso) => { const [a, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(a, m - 1, d) / 86400000); };
const sumarDias = (iso, n) => new Date((dias(iso) + n) * 86400000).toISOString().slice(0, 10);

/* ===================== Configurar el plan de una meta ===================== */

/**
 * Fija fecha objetivo y/o aporte programado. `undefined` deja el campo como está; `null` lo quita.
 * aporte = { monto, frecuencia, fechaInicio }. Devuelve { ok:true, meta } o { ok:false, motivo }
 * con motivo: "meta" | "fecha" | "monto" | "frecuencia" | "inicio". El llamador marca el cambio pendiente.
 */
function configurarPlanMeta(datos, metaId, { fechaObjetivo, aporte } = {}) {
  const meta = (datos.metas || []).find((m) => m.id === metaId);
  if (!meta) return { ok: false, motivo: "meta" };
  if (fechaObjetivo !== undefined && fechaObjetivo !== null && !esIso(fechaObjetivo)) return { ok: false, motivo: "fecha" };
  let nuevoAporte;
  if (aporte !== undefined && aporte !== null) {
    const monto = redondear(Number(aporte.monto));
    if (!(monto > 0)) return { ok: false, motivo: "monto" };
    if (!FRECUENCIAS_APORTE.includes(aporte.frecuencia)) return { ok: false, motivo: "frecuencia" };
    if (!esIso(aporte.fechaInicio)) return { ok: false, motivo: "inicio" };
    // `recordar` solo existe cuando está encendido (sesión 8): los aportes de siempre conservan su forma.
    nuevoAporte = { monto, frecuencia: aporte.frecuencia, fecha_inicio: aporte.fechaInicio, ...(aporte.recordar === true ? { recordar: true } : {}) };
  }
  if (fechaObjetivo !== undefined) meta.fecha_objetivo = fechaObjetivo;
  if (aporte !== undefined) meta.aporte_programado = aporte === null ? null : nuevoAporte;
  sellarTimestamp(meta);
  return { ok: true, meta };
}

/* ===================== Aportes programados (para Disponible) ===================== */

/** Metas con aporte programado que cuentan hoy: Ahorros encendido, meta activa y plan válido. */
function listarAportesProgramados(datos) {
  if (!obtenerModulosFinanzas(datos).ahorros) return [];
  return (datos.metas || [])
    .filter((m) => !m.archivada && m.aporte_programado && Number(m.aporte_programado.monto) > 0 &&
      FRECUENCIAS_APORTE.includes(m.aporte_programado.frecuencia) && esIso(m.aporte_programado.fecha_inicio))
    .map((m) => ({
      metaId: m.id, nombre: m.nombre || "", emoji: m.emoji || "🎯", monto: Number(m.aporte_programado.monto),
      rec: { frecuencia: m.aporte_programado.frecuencia, fecha_inicio: m.aporte_programado.fecha_inicio, fecha_fin: null, personalizado: null },
    }));
}

/** ¿Ya hay un aporte a esa meta fechado hoy? (para no restar dos veces el aporte de hoy). */
function huboAporteHoy(datos, metaId, hoy = hoyIso()) {
  return movimientosVigentes(datos, hoy).some((m) => m.meta_id === metaId && m.fecha_registro === hoy &&
    (m.tipo === "ahorro" || (m.tipo === "transferencia" && m.sentido !== "desde_meta")));
}

/* ===================== Ritmo real y fecha estimada ===================== */

/** Aportes netos a una meta con su fecha: ahorro y transferencias a la meta suman; retiros restan. */
function aportesDeMeta(datos, metaId, hoy) {
  return movimientosVigentes(datos, hoy)
    .filter((m) => m.meta_id === metaId && m.fecha_registro && (m.tipo === "ahorro" || m.tipo === "transferencia"))
    .map((m) => ({ fecha: m.fecha_registro, valor: (m.tipo === "transferencia" && m.sentido === "desde_meta" ? -1 : 1) * (Number(m.monto) || 0) }));
}

/**
 * Ritmo diario real de aportes de los últimos 90 días. Necesita al menos 2 aportes y 14 días de historia:
 * con menos no hay base honesta y devuelve null.
 */
function calcularRitmoMeta(datos, metaId, hoy = hoyIso()) {
  const desde = sumarDias(hoy, -(VENTANA_RITMO_METAS - 1));
  const lista = aportesDeMeta(datos, metaId, hoy).filter((a) => a.fecha >= desde);
  if (lista.filter((a) => a.valor > 0).length < MINIMO_APORTES) return null;
  const primero = lista.reduce((min, a) => (a.fecha < min ? a.fecha : min), hoy);
  const ventana = Math.min(VENTANA_RITMO_METAS, dias(hoy) - dias(primero) + 1);
  if (ventana < MINIMO_HISTORIAL) return null;
  const neto = lista.reduce((t, a) => t + a.valor, 0);
  return neto > 0 ? { diario: neto / ventana, ventana, aportes: lista.filter((a) => a.valor > 0).length } : null;
}

const diarioDelProgramado = (ap) =>
  ap.frecuencia === "semanal" ? ap.monto / 7 : ap.frecuencia === "quincenal" ? ap.monto / 14 : ap.monto / DIAS_POR_MES;

/* ===================== Resumen de una meta ===================== */

/**
 * Todo lo que la pantalla necesita de una meta. `nivel` siempre trae texto:
 * lograda | pasada | al_dia | cerca | por_detras | sin_ritmo | sin_fecha.
 */
function resumirMeta(datos, meta, hoy = hoyIso()) {
  const saldo = redondear(calcularSaldoMeta(meta, datos, hoy));
  const objetivo = Number(meta.objetivo) || 0;
  const falta = redondear(Math.max(0, objetivo - saldo));
  const porcentaje = objetivo > 0 ? Math.min(100, Math.round((saldo / objetivo) * 100)) : 0;
  const fechaObjetivo = esIso(meta.fecha_objetivo) ? meta.fecha_objetivo : null;
  const diasRestantes = fechaObjetivo ? dias(fechaObjetivo) - dias(hoy) : null;
  const ritmo = calcularRitmoMeta(datos, meta.id, hoy);
  const programado = listarAportesProgramados(datos).find((a) => a.metaId === meta.id);
  const diarioProgramado = programado ? diarioDelProgramado({ monto: programado.monto, frecuencia: programado.rec.frecuencia }) : null;

  const r = { saldo, objetivo, falta, porcentaje, fechaObjetivo, diasRestantes, ritmo, programado: programado ? { monto: programado.monto, frecuencia: programado.rec.frecuencia } : null,
    sugerido: null, estimada: null, nivel: "sin_fecha", texto: "", ayuda: "" };

  if (objetivo > 0 && falta === 0) return { ...r, nivel: "lograda", texto: "Meta lograda", ayuda: "Ya llegaste al objetivo." };

  const efectivo = ritmo ? ritmo.diario : diarioProgramado;
  if (efectivo && efectivo > 0) {
    const d = Math.ceil(falta / efectivo);
    r.estimada = d > MAX_DIAS_ESTIMADO ? { masDeDiezAnios: true } : { fecha: sumarDias(hoy, d), dias: d, base: ritmo ? "real" : "programado" };
  }
  if (!fechaObjetivo) return { ...r, nivel: "sin_fecha", texto: "Sin fecha objetivo", ayuda: "Si eliges una fecha, te digo cuánto aportar." };

  if (diasRestantes <= 0) {
    return { ...r, nivel: "pasada", texto: "La fecha objetivo ya pasó", ayuda: "Puedes elegir otra fecha cuando quieras." };
  }
  r.sugerido = { semanal: redondear(falta / Math.ceil(diasRestantes / 7)), mensual: redondear(falta / Math.max(1, Math.ceil(diasRestantes / DIAS_POR_MES))) };
  if (!(efectivo > 0)) return { ...r, nivel: "sin_ritmo", texto: "Aún no hay ritmo para estimar", ayuda: "Tu primer aporte permite calcular la fecha estimada." };
  const necesario = falta / diasRestantes;
  if (efectivo >= necesario) return { ...r, nivel: "al_dia", texto: "Vas al ritmo", ayuda: "Con tu ritmo llegas a la fecha." };
  if (efectivo >= necesario * 0.7) return { ...r, nivel: "cerca", texto: "Vas cerca del ritmo", ayuda: "Un aporte un poco mayor te lleva a la fecha." };
  return { ...r, nivel: "por_detras", texto: "Con este ritmo llegarías después", ayuda: "Puedes subir el aporte o mover la fecha." };
}

export {
  FRECUENCIAS_APORTE,
  calcularRitmoMeta, configurarPlanMeta, huboAporteHoy, listarAportesProgramados, resumirMeta,
};
