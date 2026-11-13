/* =========================================================================
   FINANZAS 2.0: reparación opt-in de traspasos dañados (v3.28.0, A2, tarea F1). Lógica pura sin DOM.
   Antes del arreglo de F1, "Pasar dinero" desde "Sin asignar" no comprobaba que hubiera ese dinero: con Sin asignar en negativo el
   traspaso lo hundía más (−₡1 649 945 → −₡3 299 890) y el destino "recibía" dinero que no existía.
   Un traspaso dañado es uno que sale de "Sin asignar" y que, en su propia fecha, pedía más de lo que había (nunca menos de 0).
   - simularReparacionTraspasos NO cambia nada: solo cuenta qué pasaría (dry-run).
   - aplicarReparacionTraspasos quita esos traspasos (con tumba, para que la sincronización no los resucite). Solo quita los que una
     simulación nueva vuelve a marcar, así que repetirla es inofensiva. No toca gastos, ingresos, ajustes ni cuentas.
   Nunca se ejecuta sola: la pantalla exige respaldo descargado y confirmación.
   ========================================================================= */

import { cuentasActivas } from "./finanzas-cuentas-base.js";
import { calcularTotalesMovimientos } from "./finanzas-derivados.js";
import { hoyIso } from "./finanzas-modelo.js";
import { quitarMovimiento } from "./finanzas-registro.js";

const centavos = (n) => Math.round((Number(n) || 0) * 100) / 100;
const resumen = (datos, hasta) => { const t = calcularTotalesMovimientos(datos, hasta); return { sinAsignar: centavos(t.sinAsignar), saldoLiquido: centavos(t.saldoLiquido) }; };

/**
 * Devuelve { activo, candidatos: [{ id, nombre, fecha, monto, destinoId, disponible }], antes, despues } sin modificar `datos`.
 * `disponible` es lo que había en Sin asignar en la fecha del traspaso (sin contar este traspaso ni los ya marcados).
 * `antes` y `despues` son Sin asignar y Mi dinero hoy, con y sin los traspasos marcados.
 */
function simularReparacionTraspasos(datos, hoy = hoyIso()) {
  if (!datos || !cuentasActivas(datos)) return { activo: false, candidatos: [], antes: null, despues: null };
  const copia = { ...datos, movimientos: (datos.movimientos || []).slice() };
  const orden = copia.movimientos.map((m, i) => ({ m, i })).filter(({ m }) => m.tipo === "traspaso" && !m.cuenta_id)
    .sort((a, b) => String(a.m.fecha_registro || "").localeCompare(String(b.m.fecha_registro || "")) || a.i - b.i);
  const candidatos = [];
  orden.forEach(({ m }) => {
    const sin = { ...copia, movimientos: copia.movimientos.filter((x) => x.id !== m.id) };
    const disponible = Math.max(resumen(sin, m.fecha_registro || hoy).sinAsignar, 0);
    if (centavos(m.monto) > disponible) {
      candidatos.push({ id: m.id, nombre: m.nombre || "", fecha: m.fecha_registro || null, monto: centavos(m.monto), destinoId: m.cuenta_destino_id || null, disponible });
      copia.movimientos = sin.movimientos;
    }
  });
  return { activo: true, candidatos, antes: resumen(datos, hoy), despues: resumen(copia, hoy) };
}

/** Quita los traspasos dañados indicados en `ids` (solo los que la simulación marca hoy). Devuelve { ok, quitados }. */
function aplicarReparacionTraspasos(datos, ids) {
  const permitidos = new Set((ids || []).map(String));
  const sim = simularReparacionTraspasos(datos);
  if (!sim.activo) return { ok: false, quitados: 0, motivo: "modulo_apagado" };
  let quitados = 0;
  sim.candidatos.forEach((c) => { if (permitidos.has(c.id) && quitarMovimiento(datos, c.id)) quitados++; });
  return { ok: true, quitados };
}

export { aplicarReparacionTraspasos, simularReparacionTraspasos };
