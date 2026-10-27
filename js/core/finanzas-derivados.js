/* =========================================================================
   FINANZAS 2.0 — Cálculos derivados (etapa 0A)
   Nada se guarda: todo sale de `movimientos` y `metas`. Un módulo apagado
   oculta sus movimientos y NO cuenta (apagar solo oculta, no borra).
   ========================================================================= */

import { hoyIso, montoEfectivoMovimiento, MODULOS_FINANZAS_DEFAULT } from "./finanzas-modelo.js";
import { contextoCuentas, movimientoEnMonedaPrincipal } from "./finanzas-cuentas-base.js";

function obtenerModulosFinanzas(datos) {
  const guardados = (datos.configuracion && datos.configuracion.finanzas_modulos) || {};
  // Módulo opcional "Me deben y debo" (sesión 7A): interruptor propio. Apagado, la clave ni aparece (las pruebas y
  // pantallas de siempre ven exactamente los 4 módulos de antes).
  const deudas = !!(datos.configuracion && datos.configuracion.finanzas_deudas);
  // Sesión 7B: módulo opcional Cuentas, mismo trato (la clave solo aparece encendida).
  const cuentas = !!(datos.configuracion && datos.configuracion.finanzas_cuentas);
  return { ...MODULOS_FINANZAS_DEFAULT, ...guardados, ...(deudas ? { deudas: true } : {}), ...(cuentas ? { cuentas: true } : {}) };
}

/** ¿Este movimiento cuenta/se ve con los módulos actuales? */
function movimientoVisible(mov, modulos) {
  if (mov.tipo === "ahorro" || mov.tipo === "transferencia") return !!modulos.ahorros;
  if (mov.tipo === "prestamo") return !!modulos.deudas;
  if (mov.tipo === "traspaso") return !!modulos.cuentas;
  // Un ajuste corrige Mi dinero: se ve si cualquier módulo de dinero diario/universidad está encendido.
  if (mov.tipo === "ajuste") return !!(modulos.gastos || modulos.matricula || modulos.beca);
  if (mov.origen === "matricula") return !!modulos.matricula;
  if (mov.origen === "beca") return !!modulos.beca;
  return !!modulos.gastos;
}

/**
 * Movimientos que cuentan hoy: visibles y no fechados en el futuro (sin fecha = cuenta). Un gasto o ingreso en una cuenta
 * de otra divisa queda fuera (los totales de siempre son en la moneda de la app); `todasMonedas` lo incluye (para Cuentas).
 */
function movimientosVigentes(datos, hasta = hoyIso(), { todasMonedas = false } = {}) {
  const modulos = obtenerModulosFinanzas(datos);
  const semestres = new Set((datos.semestres || []).map((s) => s.id));
  const ctx = contextoCuentas(datos);
  return (datos.movimientos || []).filter((m) => {
    if (!movimientoVisible(m, modulos)) return false;
    if (m.semestre_id && !semestres.has(m.semestre_id)) return false; // semestre borrado: no cuenta, como hoy
    if (!(todasMonedas && ctx.activo) && !movimientoEnMonedaPrincipal(datos, m, ctx)) return false;
    return !m.fecha_registro || m.fecha_registro <= hasta;
  });
}

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * Totales. Las transferencias, los aportes a metas, los préstamos y los traspasos entre cuentas NUNCA entran en
 * gastos ni ingresos. Un gasto pagado desde una meta SÍ es gasto.
 * Con Cuentas encendido, además de lo de siempre (todo en la moneda de la app) devuelve:
 *   porMoneda { CRC: { saldo, gastado, ingresado }, USD: … }  (un total por divisa, sin conversión),
 *   porCuenta { cuenta_id: { saldo, gastado, ingresado } },   sinAsignar (lo de Mi dinero que aún no está en ninguna cuenta).
 * Una cuenta marcada "no afecta mi saldo" cuenta sus gastos e ingresos pero no mueve Mi dinero.
 */
function calcularTotalesMovimientos(datos, hasta) {
  const lista = movimientosVigentes(datos, hasta, { todasMonedas: true });
  const ctx = contextoCuentas(datos);
  const principal = ctx.principal;
  let gastos = 0, ingresos = 0, becas = 0;
  let liquido = 0;     // Mi dinero (en la moneda de la app)
  let enMetas = 0;     // suma de saldos de metas
  const porMoneda = {}, porCuenta = {};
  const mon = (c) => (porMoneda[c] = porMoneda[c] || { saldo: 0, gastado: 0, ingresado: 0 });
  const cta = (id) => (porCuenta[id] = porCuenta[id] || { saldo: 0, gastado: 0, ingresado: 0 });

  // Una meta archivada no cuenta en "En metas" (ni su saldo inicial ni sus aportes):
  // el dinero que sacaste de Mi dinero para ella sí queda fuera de Mi dinero, pero ya no se suma al patrimonio visible.
  const archivadas = new Set((datos.metas || []).filter((x) => x.archivada).map((x) => x.id));
  const sumaMeta = (metaId, delta) => { if (!archivadas.has(metaId)) enMetas += delta; };
  const modulosActuales = obtenerModulosFinanzas(datos);

  /** Mueve `delta` en la cuenta `c` (null = Sin asignar, en la moneda de la app). Una cuenta que no afecta mi saldo no cuenta como mi dinero. */
  const mover = (c, delta) => {
    if (c && !c.afecta) return;
    const moneda = c ? c.moneda : principal;
    mon(moneda).saldo += delta;
    if (c) cta(c.id).saldo += delta;
    if (moneda === principal) liquido += delta;
  };

  lista.forEach((m) => {
    const v = montoEfectivoMovimiento(m);
    const c = m.tipo === "traspaso" ? null : ctx.de(m.cuenta_id);
    const moneda = c ? c.moneda : principal;
    const esPrincipal = moneda === principal;
    if (m.tipo === "gasto") {
      mon(moneda).gastado += v; if (c) cta(c.id).gastado += v;
      if (esPrincipal) gastos += v;
      // Pagado por otra persona (Me deben y debo encendido): es gasto tuyo, pero el dinero no salió de Mi dinero.
      if (m.pagado_con_meta_id) { if (esPrincipal) sumaMeta(m.pagado_con_meta_id, -v); }
      else if (!(m.pagado_por_prestamo_id && modulosActuales.deudas)) mover(c, -v);
    } else if (m.tipo === "ingreso") {
      mon(moneda).ingresado += v; if (c) cta(c.id).ingresado += v;
      if (esPrincipal) { ingresos += v; if (m.origen === "beca") becas += v; }
      mover(c, v);
    } else if (m.tipo === "ahorro") {
      sumaMeta(m.meta_id, v);
      if (m.fuente !== "nuevo") mover(null, -v);
    } else if (m.tipo === "transferencia") {
      if (m.sentido === "desde_meta") { mover(null, v); sumaMeta(m.meta_id, -v); }
      else { mover(null, -v); sumaMeta(m.meta_id, v); }
    } else if (m.tipo === "ajuste") {
      mover(c, m.sentido === "resta" ? -v : v);
    } else if (m.tipo === "prestamo") {
      mover(null, m.sentido === "entra" ? v : -v); // prestar o devolver mueve Mi dinero, nunca gastos ni ingresos
    } else if (m.tipo === "traspaso") {
      const o = ctx.de(m.cuenta_id), d = ctx.de(m.cuenta_destino_id);
      const monedaO = o ? o.moneda : principal, monedaD = d ? d.moneda : principal;
      const llega = monedaO !== monedaD && Number(m.monto_destino) > 0 ? Number(m.monto_destino) : v;
      mover(o, -v); mover(d, llega);
    }
  });

  // Saldos iniciales de las cuentas (solo con el módulo encendido; una cuenta que no afecta mi saldo no tiene saldo propio).
  ctx.cuentas.forEach((c) => { if (c.saldoInicial) mover(c, c.saldoInicial); });

  // Ahorros apagado: las metas se ocultan y no cuentan (un gasto pagado con una meta sigue siendo gasto).
  if (obtenerModulosFinanzas(datos).ahorros) {
    enMetas += (datos.metas || []).filter((x) => !x.archivada && x.tipo !== "gasto").reduce((t, x) => t + (Number(x.saldo_inicial) || 0), 0);
  } else {
    enMetas = 0;
  }

  const resultado = {
    totalGastado: gastos,
    totalIngresos: ingresos - becas,
    totalBecas: becas,
    balanceNeto: ingresos - gastos,   // misma definición que el Resumen actual
    saldoLiquido: liquido,
    enMetas,
    patrimonio: liquido + enMetas,
  };
  if (ctx.activo) {
    let enCuentas = 0;
    ctx.cuentas.forEach((c) => { if (c.afecta && c.moneda === principal && porCuenta[c.id]) enCuentas += porCuenta[c.id].saldo; });
    const redondeado = (o) => Object.fromEntries(Object.entries(o).map(([k, x]) => [k, { saldo: centavos(x.saldo), gastado: centavos(x.gastado), ingresado: centavos(x.ingresado) }]));
    resultado.porMoneda = redondeado(porMoneda); resultado.porCuenta = redondeado(porCuenta); resultado.sinAsignar = centavos(liquido - enCuentas);
    if (!resultado.porMoneda[principal]) resultado.porMoneda[principal] = { saldo: 0, gastado: 0, ingresado: 0 };
  }
  return resultado;
}

/** Saldo de una meta = saldo inicial + aportes + transferencias a la meta − retiros − gastos pagados con ella. */
function calcularSaldoMeta(meta, datos, hasta) {
  let saldo = Number(meta.saldo_inicial) || 0;
  movimientosVigentes(datos, hasta).forEach((m) => {
    const v = montoEfectivoMovimiento(m);
    if (m.tipo === "ahorro" && m.meta_id === meta.id) saldo += v;
    else if (m.tipo === "transferencia" && m.meta_id === meta.id) saldo += m.sentido === "desde_meta" ? -v : v;
    else if (m.tipo === "gasto" && m.pagado_con_meta_id === meta.id) saldo -= v;
  });
  return saldo;
}

export { calcularSaldoMeta, calcularTotalesMovimientos, movimientoVisible, movimientosVigentes, obtenerModulosFinanzas };
