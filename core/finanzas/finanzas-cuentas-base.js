/* =========================================================================
   FINANZAS 2.0: piezas mínimas de Cuentas (sesión 7B) que necesitan los derivados. Sin imports de Finanzas:
   así finanzas-derivados.js puede usarlas sin crear un ciclo con finanzas-cuentas.js.
   Una cuenta es DÓNDE está el dinero (efectivo, banco, tarjeta…), con su propia divisa. Un movimiento sin `cuenta_id`
   cuenta como siempre, en la moneda de la app ("Sin asignar"). Con el módulo apagado, las cuentas se ignoran.
   ========================================================================= */

const MONEDA_POR_DEFECTO = "CRC";

/** Moneda de la app (la de Ajustes). Los totales de siempre (Disponible, presupuestos, Resumen) son en esta moneda. */
const monedaPrincipal = (datos) => (datos && datos.configuracion && datos.configuracion.moneda_preferida) || MONEDA_POR_DEFECTO;

const cuentasActivas = (datos) => !!(datos && datos.configuracion && datos.configuracion.finanzas_cuentas);

/**
 * Contexto para resolver cuentas rápido. `de(id)` devuelve { id, moneda, afecta } o null (sin cuenta, o cuenta que ya no existe).
 * Con el módulo apagado todas las cuentas devuelven null: se comportan como "sin cuenta".
 */
function contextoCuentas(datos) {
  const activo = cuentasActivas(datos);
  const mapa = new Map();
  if (activo) (datos.cuentas || []).forEach((c) => mapa.set(c.id, { id: c.id, moneda: c.moneda || monedaPrincipal(datos), afecta: c.afecta_saldo !== false, tipo: c.tipo, saldoInicial: Number(c.saldo_inicial) || 0 }));
  return { activo, principal: monedaPrincipal(datos), cuentas: mapa, de: (id) => (id && mapa.get(id)) || null };
}

/**
 * ¿El movimiento es de la moneda de la app? Un gasto o ingreso en una cuenta de otra divisa no entra en los totales
 * de siempre (se ve en Cuentas, por divisa). Con el módulo apagado, lo de otras divisas se oculta: no se mezcla.
 * Los traspasos no se filtran aquí: cada lado se resuelve en su cuenta.
 */
function movimientoEnMonedaPrincipal(datos, mov, ctx = contextoCuentas(datos)) {
  if (!mov || !mov.cuenta_id || mov.tipo === "traspaso") return true;
  if (ctx.activo) { const c = ctx.de(mov.cuenta_id); return !c || c.moneda === ctx.principal; }
  const c = (datos.cuentas || []).find((x) => x.id === mov.cuenta_id);
  return !c || (c.moneda || ctx.principal) === ctx.principal;
}

/** ¿Este gasto o ingreso mueve Mi dinero? No, si ocurrió en una cuenta marcada "no afecta mi saldo" (la paga otra persona). */
function movimientoAfectaMiDinero(datos, mov, ctx = contextoCuentas(datos)) {
  const c = mov && mov.cuenta_id ? ctx.de(mov.cuenta_id) : null;
  return !c || c.afecta;
}

export { MONEDA_POR_DEFECTO, movimientoAfectaMiDinero, contextoCuentas, cuentasActivas, monedaPrincipal, movimientoEnMonedaPrincipal };
