/* =========================================================================
   FINANZAS 2.0 — Cálculos derivados (etapa 0A)
   Nada se guarda: todo sale de `movimientos` y `metas`. Un módulo apagado
   oculta sus movimientos y NO cuenta (apagar solo oculta, no borra).
   ========================================================================= */

import { hoyIso, montoEfectivoMovimiento, MODULOS_FINANZAS_DEFAULT } from "./finanzas-modelo.js";

function obtenerModulosFinanzas(datos) {
  const guardados = (datos.configuracion && datos.configuracion.finanzas_modulos) || {};
  return { ...MODULOS_FINANZAS_DEFAULT, ...guardados };
}

/** ¿Este movimiento cuenta/se ve con los módulos actuales? */
function movimientoVisible(mov, modulos) {
  if (mov.tipo === "ahorro" || mov.tipo === "transferencia") return !!modulos.ahorros;
  if (mov.origen === "matricula") return !!modulos.matricula;
  if (mov.origen === "beca") return !!modulos.beca;
  return !!modulos.gastos;
}

/** Movimientos que cuentan hoy: visibles y no fechados en el futuro (sin fecha = cuenta). */
function movimientosVigentes(datos, hasta = hoyIso()) {
  const modulos = obtenerModulosFinanzas(datos);
  const semestres = new Set((datos.semestres || []).map((s) => s.id));
  return (datos.movimientos || []).filter((m) => {
    if (!movimientoVisible(m, modulos)) return false;
    if (m.semestre_id && !semestres.has(m.semestre_id)) return false; // semestre borrado: no cuenta, como hoy
    return !m.fecha_registro || m.fecha_registro <= hasta;
  });
}

/**
 * Totales. Las transferencias y los aportes a metas NUNCA entran en
 * gastos ni ingresos. Un gasto pagado desde una meta SÍ es gasto.
 */
function calcularTotalesMovimientos(datos, hasta) {
  const lista = movimientosVigentes(datos, hasta);
  let gastos = 0, ingresos = 0, becas = 0;
  let liquido = 0;     // Mi dinero
  let enMetas = 0;     // suma de saldos de metas

  lista.forEach((m) => {
    const v = montoEfectivoMovimiento(m);
    if (m.tipo === "gasto") {
      gastos += v;
      if (m.pagado_con_meta_id) enMetas -= v; else liquido -= v;
    } else if (m.tipo === "ingreso") {
      ingresos += v;
      if (m.origen === "beca") becas += v;
      liquido += v;
    } else if (m.tipo === "ahorro") {
      enMetas += v;
      if (m.fuente !== "nuevo") liquido -= v;
    } else if (m.tipo === "transferencia") {
      if (m.sentido === "desde_meta") { liquido += v; enMetas -= v; }
      else { liquido -= v; enMetas += v; }
    }
  });

  // Ahorros apagado: las metas se ocultan y no cuentan (un gasto pagado con una meta sigue siendo gasto).
  if (obtenerModulosFinanzas(datos).ahorros) {
    enMetas += (datos.metas || []).filter((x) => !x.archivada).reduce((t, x) => t + (Number(x.saldo_inicial) || 0), 0);
  } else {
    enMetas = 0;
  }

  return {
    totalGastado: gastos,
    totalIngresos: ingresos - becas,
    totalBecas: becas,
    balanceNeto: ingresos - gastos,   // misma definición que el Resumen actual
    saldoLiquido: liquido,
    enMetas,
    patrimonio: liquido + enMetas,
  };
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
