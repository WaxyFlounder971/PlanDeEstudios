/* =========================================================================
   FINANZAS 2.0: Disponible y Próximos (sesión 3, F2)
   Lógica pura, sin DOM. Responde: "¿cuánto puedo gastar sin tocar lo que
   ya viene?". Nada se guarda: todo se DERIVA de movimientos, compromisos y
   configuración.

   Disponible = Mi dinero
              − compromisos de gasto que restan (matrícula con "Afecta mi saldo") dentro del horizonte
              − recurrentes de gasto que caen dentro del horizonte
              − aportes programados a metas dentro del horizonte
              + desembolsos esperados (beca, ayuda, trabajo) con fecha dentro del horizonte.
   - aportes programados a metas (sesión 4): el plan de cada meta activa, con Ahorros encendido. Cuenta desde hoy
     (nada crea un movimiento solo), salvo que ya hayas aportado hoy a esa meta.

   Reglas:
   - Un módulo apagado no entra (mismas reglas de visibilidad que el resto de Finanzas).
   - Los vencidos (pendientes con fecha pasada) siguen restando: se deben todavía. Un desembolso
     vencido NO suma: no es seguro que llegue.
   - Compromisos sin fecha no caben en un horizonte y no entran; el desglose los avisa.
   - Un recurrente cuenta desde mañana: lo de hoy y lo anterior ya está en Mi dinero.
   - Un ingreso recurrente se muestra en Próximos pero no suma (conservador).
   ========================================================================= */

import { hoyIso } from "./finanzas-modelo.js";
import { calcularTotalesMovimientos, movimientoVisible, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { estadoVisibleCompromiso, obtenerCompromisosVisibles, describirMovimientoDe } from "./finanzas-compromisos.js";
import { puedeAjustarSaldo } from "./finanzas-registro.js";
import { huboAporteHoy, listarAportesProgramados } from "./finanzas-metas-plan.js";
import { sellarTimestamp } from "./schema.js";

const HORIZONTE_DEFECTO = 30;
const OPCIONES_HORIZONTE = [7, 15, 30, 60, 90];
const VENTANA_RITMO_DIAS = 30;
const MINIMO_HISTORIAL_RITMO = 7;
const MAX_DIAS_RITMO = 365;

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ===================== Fechas "YYYY-MM-DD" (UTC, sin zonas horarias) ===================== */

const partes = (iso) => iso.split("-").map(Number);
const dias = (iso) => { const [a, m, d] = partes(iso); return Math.round(Date.UTC(a, m - 1, d) / 86400000); };
const deDias = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const sumarDias = (iso, n) => deDias(dias(iso) + n);
const ultimoDiaMes = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate(); // m = 1..12
const diaSemana = (iso) => new Date(dias(iso) * 86400000).getUTCDay();
const esIso = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ""));

/* ===================== Horizonte ===================== */

/** Días del horizonte: configuración válida o 30. */
function obtenerHorizonteDias(datos) {
  const v = Number(datos && datos.configuracion && datos.configuracion.horizonte_disponible_dias);
  return OPCIONES_HORIZONTE.includes(v) ? v : HORIZONTE_DEFECTO;
}

/** Guarda el horizonte (solo valores de la lista) y sella la configuración. El llamador marca el cambio pendiente. */
function fijarHorizonteDias(datos, valor) {
  const v = Number(valor);
  if (!OPCIONES_HORIZONTE.includes(v)) return false;
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.horizonte_disponible_dias = v;
  sellarTimestamp(datos.configuracion);
  return true;
}

/* ===================== Recurrentes: qué días caen pagos ===================== */

/** ¿La fecha `iso` es un día de pago de este recurrente? (respeta inicio y fin). */
function esDiaDePago(rec, iso) {
  if (!rec || !esIso(rec.fecha_inicio) || iso < rec.fecha_inicio) return false;
  if (esIso(rec.fecha_fin) && iso > rec.fecha_fin) return false;
  const diff = dias(iso) - dias(rec.fecha_inicio);
  const [a, m, d] = partes(iso);
  const [, mi, di] = partes(rec.fecha_inicio);
  const ancla = (diaAncla) => d === Math.min(diaAncla, ultimoDiaMes(a, m));
  switch (rec.frecuencia) {
    case "semanal": return diff % 7 === 0;
    case "quincenal": return diff % 14 === 0;
    case "mensual": return ancla(di);
    case "anual": return m === mi && ancla(di);
    case "personalizado": {
      const p = rec.personalizado || {};
      if (p.modo === "diario") return true;
      if (p.modo === "dias_semana") return Array.isArray(p.dias_semana) && p.dias_semana.includes(diaSemana(iso));
      if (p.modo === "cada_n_dias") { const n = Math.floor(Number(p.cada_n_dias)); return n >= 1 && diff % n === 0; }
      return false;
    }
    default: return false;
  }
}

/** Fechas de pago de un recurrente en (desdeExcl, hastaIncl]. */
function ocurrenciasRecurrente(rec, desdeExcl, hastaIncl) {
  const salida = [];
  if (!esIso(desdeExcl) || !esIso(hastaIncl)) return salida;
  for (let d = dias(desdeExcl) + 1; d <= dias(hastaIncl); d++) {
    const iso = deDias(d);
    if (esDiaDePago(rec, iso)) salida.push(iso);
  }
  return salida;
}

/* ===================== Próximos ===================== */

const etiquetaCompromiso = (c) =>
  c.tipo === "matricula" ? "Matrícula" : c.tipo === "recurrente" ? "Pago recurrente"
    : c.subtipo === "ayuda_familiar" ? "Ayuda familiar" : c.subtipo === "trabajo" ? "Trabajo" : "Beca";

/**
 * Todo lo que viene dentro del horizonte, ordenado por fecha. Cada fila:
 * { clave, fecha, nombre, monto, sentido: "sale"|"entra", fuente: "compromiso"|"recurrente", etiqueta,
 *   vencido, cuenta (¿entra en la cifra Disponible?), compromisoId? }
 * Los vencidos van primero (fecha pasada). Sin módulos encendidos no hay filas.
 */
function listarProximos(datos, { hoy = hoyIso(), horizonteDias } = {}) {
  const horizonte = horizonteDias || obtenerHorizonteDias(datos);
  const limite = sumarDias(hoy, horizonte);
  const modulos = obtenerModulosFinanzas(datos);
  const filas = [];

  // 1) Compromisos pendientes o vencidos con fecha dentro del horizonte.
  obtenerCompromisosVisibles(datos).forEach((c) => {
    const est = estadoVisibleCompromiso(c, datos, hoy);
    if (est !== "pendiente" && est !== "vencido") return;
    if (!c.fecha_prevista || c.fecha_prevista > limite) return;
    const entra = describirMovimientoDe(c).tipo === "ingreso";
    const vencido = est === "vencido";
    filas.push({
      clave: "c:" + c.id, fecha: c.fecha_prevista, nombre: c.nombre || etiquetaCompromiso(c), monto: Number(c.monto) || 0,
      sentido: entra ? "entra" : "sale", fuente: "compromiso", etiqueta: etiquetaCompromiso(c), vencido,
      cuenta: entra ? !vencido : !!c.afecta_saldo, compromisoId: c.id,
    });
  });

  // 2) Recurrentes (de gasto o ingreso) que caen mañana o después, hasta el límite.
  const semestres = new Set((datos.semestres || []).map((s) => s.id));
  (datos.movimientos || []).forEach((m) => {
    if (!m.recurrente || (m.tipo !== "gasto" && m.tipo !== "ingreso")) return;
    if (!movimientoVisible(m, modulos)) return;
    if (m.semestre_id && !semestres.has(m.semestre_id)) return;
    const monto = Number(m.recurrente.monto_por_pago) || 0;
    if (!(monto > 0)) return;
    const entra = m.tipo === "ingreso";
    ocurrenciasRecurrente(m.recurrente, hoy, limite).forEach((fecha) => {
      filas.push({
        clave: `r:${m.id}@${fecha}`, fecha, nombre: m.nombre || (entra ? "Ingreso recurrente" : "Pago recurrente"), monto,
        sentido: entra ? "entra" : "sale", fuente: "recurrente", etiqueta: entra ? "Ingreso recurrente" : "Pago recurrente",
        vencido: false, cuenta: !entra && !m.pagado_con_meta_id,
      });
    });
  });

  // 3) Aportes programados a metas: desde hoy (inclusive) hasta el límite. El de hoy no cuenta si ya aportaste hoy.
  listarAportesProgramados(datos).forEach((a) => {
    ocurrenciasRecurrente(a.rec, sumarDias(hoy, -1), limite).forEach((fecha) => {
      if (fecha === hoy && huboAporteHoy(datos, a.metaId, hoy)) return;
      filas.push({
        clave: `a:${a.metaId}@${fecha}`, fecha, nombre: `${a.emoji} ${a.nombre}`.trim(), monto: a.monto, sentido: "sale",
        fuente: "meta", etiqueta: "Aporte a meta", vencido: false, cuenta: true,
      });
    });
  });

  return filas.sort((a, b) => (a.fecha === b.fecha ? String(a.nombre).localeCompare(String(b.nombre), "es", { numeric: true }) : a.fecha.localeCompare(b.fecha)));
}

/** Compromisos pendientes sin fecha: no caben en un horizonte, así que se avisan aparte. */
function contarCompromisosSinFecha(datos, hoy = hoyIso()) {
  return obtenerCompromisosVisibles(datos).filter((c) => {
    const est = estadoVisibleCompromiso(c, datos, hoy);
    return (est === "pendiente" || est === "vencido") && !c.fecha_prevista;
  }).length;
}

/* ===================== Ritmo de gasto ===================== */

/**
 * Gasto diario típico de los últimos 30 días: solo gastos manuales, no recurrentes y que salieron de Mi dinero
 * (los recurrentes y la matrícula ya se descuentan aparte; así no se cuenta dos veces). Con menos de 7 días de
 * historia no hay base honesta y devuelve null.
 */
function calcularRitmoDiario(datos, hoy = hoyIso()) {
  const modulos = obtenerModulosFinanzas(datos);
  const desde = sumarDias(hoy, -(VENTANA_RITMO_DIAS - 1));
  // Inicio del historial = primer gasto o ingreso manual (un saldo inicial o un ajuste no es uso de la app).
  const todos = (datos.movimientos || []).filter((m) => (m.tipo === "gasto" || m.tipo === "ingreso") && m.origen === "manual" && !m.recurrente && m.fecha_registro && m.fecha_registro <= hoy && movimientoVisible(m, modulos));
  const propios = todos.filter((m) => m.tipo === "gasto" && !m.recurrente && !m.pagado_con_meta_id && m.fecha_registro >= desde);
  if (!propios.length) return null;
  const primero = todos.reduce((min, m) => (m.fecha_registro < min ? m.fecha_registro : min), hoy);
  const ventana = Math.min(VENTANA_RITMO_DIAS, dias(hoy) - dias(primero) + 1);
  if (ventana < MINIMO_HISTORIAL_RITMO) return null;
  const total = propios.reduce((t, m) => t + (Number(m.monto) || 0), 0);
  return { diario: redondear(total / ventana), ventana };
}

/* ===================== Semáforo ===================== */

/**
 * Nivel con texto (nunca solo color). Tono sin culpa: informa y propone.
 * rojo: lo que viene supera lo que tienes. ámbar: queda poco margen (≤ 25 % de Mi dinero) o justo en cero.
 */
function calcularSemaforo({ disponible, saldoLiquido, comprometido }) {
  if (disponible < 0) return { nivel: "rojo", texto: "Lo que viene supera lo que tienes", ayuda: "Conviene revisar los pagos de abajo." };
  const justo = disponible === 0 || (comprometido > 0 && saldoLiquido > 0 && disponible <= saldoLiquido * 0.25);
  if (justo) return { nivel: "ambar", texto: "Queda poco margen", ayuda: "Alcanza, pero con poco espacio." };
  return { nivel: "verde", texto: "Tienes margen", ayuda: "Lo que viene está cubierto." };
}

/* ===================== Disponible ===================== */

/** ¿Tiene sentido mostrar Disponible? Solo si existe Mi dinero (Gastos, Matrícula o Beca encendidos). */
const disponibleAplica = (datos) => puedeAjustarSaldo(datos);

/**
 * Calcula todo de una vez. `terminos` suma exactamente `disponible` (cada uno con su signo), para que el
 * desglose coincida con la cifra. Devuelve { aplica:false } si no hay Mi dinero.
 */
function calcularDisponible(datos, { hoy = hoyIso(), horizonteDias } = {}) {
  if (!disponibleAplica(datos)) return { aplica: false };
  const horizonte = horizonteDias || obtenerHorizonteDias(datos);
  const saldoLiquido = redondear(calcularTotalesMovimientos(datos, hoy).saldoLiquido);
  const proximos = listarProximos(datos, { hoy, horizonteDias: horizonte });
  const suma = (f) => redondear(proximos.filter(f).reduce((t, p) => t + p.monto, 0));
  const compromisos = suma((p) => p.cuenta && p.sentido === "sale" && p.fuente === "compromiso");
  const recurrentes = suma((p) => p.cuenta && p.sentido === "sale" && p.fuente === "recurrente");
  const aportes = suma((p) => p.cuenta && p.sentido === "sale" && p.fuente === "meta");
  const desembolsos = suma((p) => p.cuenta && p.sentido === "entra");

  const terminos = [
    { id: "saldo", etiqueta: "Mi dinero", monto: saldoLiquido, filas: [] },
    { id: "compromisos", etiqueta: "Pagos planificados", monto: -compromisos, filas: proximos.filter((p) => p.cuenta && p.sentido === "sale" && p.fuente === "compromiso") },
    { id: "recurrentes", etiqueta: "Pagos recurrentes", monto: -recurrentes, filas: proximos.filter((p) => p.cuenta && p.sentido === "sale" && p.fuente === "recurrente") },
    { id: "metas", etiqueta: "Aportes a metas", monto: -aportes, filas: proximos.filter((p) => p.cuenta && p.fuente === "meta") },
    { id: "desembolsos", etiqueta: "Ingresos esperados", monto: desembolsos, filas: proximos.filter((p) => p.cuenta && p.sentido === "entra") },
  ];
  const disponible = redondear(terminos.reduce((t, x) => t + x.monto, 0));
  const comprometido = redondear(compromisos + recurrentes + aportes);
  const ritmo = calcularRitmoDiario(datos, hoy);

  let alcance = null; // "te alcanza hasta…" al ritmo actual
  if (ritmo && ritmo.diario > 0 && disponible > 0) {
    const n = Math.floor(disponible / ritmo.diario);
    alcance = n > MAX_DIAS_RITMO ? { masDeUnAnio: true } : { dias: n, hasta: sumarDias(hoy, n) };
  }

  return {
    aplica: true, hoy, horizonte, hasta: sumarDias(hoy, horizonte), saldoLiquido, terminos, disponible, comprometido,
    semaforo: calcularSemaforo({ disponible, saldoLiquido, comprometido }),
    ritmo, alcance, proximos,
    // Lo que se muestra pero no resta (matrícula sin "Afecta mi saldo", ingresos recurrentes, vencidos de ingreso).
    informativos: proximos.filter((p) => !p.cuenta),
    sinFecha: contarCompromisosSinFecha(datos, hoy),
  };
}

export {
  HORIZONTE_DEFECTO, OPCIONES_HORIZONTE,
  calcularDisponible, calcularRitmoDiario, calcularSemaforo, contarCompromisosSinFecha, disponibleAplica,
  esDiaDePago, fijarHorizonteDias, listarProximos, obtenerHorizonteDias, ocurrenciasRecurrente, sumarDias,
};
