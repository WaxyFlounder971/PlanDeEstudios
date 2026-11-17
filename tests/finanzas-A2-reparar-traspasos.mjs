// Pruebas A2 (v3.28.0): reparación opt-in de traspasos dañados desde «Sin asignar». Node, sin DOM, solo fixtures (nunca datos reales).
import assert from "node:assert/strict";
import * as schema from "../js/core/schema.js";
import { fusionarDatos } from "../js/core/storage/storage-merge.js";
import { crearMovimiento } from "../js/core/finanzas/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { exportarRespaldoJson } from "../js/core/finanzas/finanzas-importar.js";
import { activarCuentas, crearCuenta, crearTraspaso } from "../js/core/finanzas/finanzas-cuentas.js";
import { aplicarReparacionTraspasos, simularReparacionTraspasos } from "../js/core/finanzas/finanzas-reparar-traspasos.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-11-07", MONTO = 1649945;
const nuevo = () => { const d = schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo()))); activarCuentas(d, true); return d; };
const T = (d) => calcularTotalesMovimientos(d, HOY);
const mov = (d, p) => { const m = crearMovimiento({ fechaRegistro: HOY, ...p }); d.movimientos.push(m); return m; };
const cuenta = (d, p) => { const r = crearCuenta(d, p); assert.equal(r.ok, true, JSON.stringify(r)); return r.cuenta; };
const traspasos = (d) => d.movimientos.filter((m) => m.tipo === "traspaso");
/** Datos dañados como los del usuario: Sin asignar en −1 649 945 y un traspaso por 1 649 945 a una tarjeta que no afecta mi saldo (creado sin el control nuevo). */
function danado() {
  const d = nuevo(); const bac = cuenta(d, { nombre: "BAC", saldoInicial: 64.19 }), bn = cuenta(d, { nombre: "BN", saldoInicial: 70.99 });
  const tarjeta = cuenta(d, { nombre: "Tarjeta de otra persona", tipo: "credito", afectaSaldo: false });
  mov(d, { tipo: "gasto", monto: MONTO, nombre: "Gasto sin cuenta" });
  const malo = mov(d, { tipo: "traspaso", monto: MONTO, nombre: "Traspaso", cuentaId: null, cuentaDestinoId: tarjeta.id });
  return { d, bac, bn, tarjeta, malo };
}

test("la simulación encuentra el traspaso dañado y muestra Sin asignar −3 299 890 → −1 649 945, sin cambiar nada", () => {
  const { d, malo } = danado(); const foto = JSON.stringify(d); assert.equal(T(d).sinAsignar, -2 * MONTO);
  const s = simularReparacionTraspasos(d, HOY);
  assert.equal(s.candidatos.length, 1); assert.equal(s.candidatos[0].id, malo.id); assert.equal(s.candidatos[0].monto, MONTO); assert.equal(s.candidatos[0].disponible, 0);
  assert.equal(s.antes.sinAsignar, -2 * MONTO); assert.equal(s.despues.sinAsignar, -MONTO); assert.equal(JSON.stringify(d), foto);
});
test("aplicar quita solo ese traspaso, deja su tumba y no toca gastos ni cuentas", () => {
  const { d, malo } = danado(); const gastos = d.movimientos.filter((m) => m.tipo === "gasto").length, cuentas = JSON.stringify(d.cuentas);
  assert.deepEqual(aplicarReparacionTraspasos(d, [malo.id]), { ok: true, quitados: 1 });
  assert.equal(traspasos(d).length, 0); assert.ok(d._eliminados_movimientos.some((t) => t.id === malo.id));
  assert.equal(d.movimientos.filter((m) => m.tipo === "gasto").length, gastos); assert.equal(JSON.stringify(d.cuentas), cuentas); assert.equal(T(d).sinAsignar, -MONTO);
});
test("es idempotente: repetir no quita nada más y no marca nada", () => {
  const { d, malo } = danado(); aplicarReparacionTraspasos(d, [malo.id]);
  assert.equal(simularReparacionTraspasos(d, HOY).candidatos.length, 0); assert.deepEqual(aplicarReparacionTraspasos(d, [malo.id]), { ok: true, quitados: 0 });
});
test("de dos traspasos, solo se marca el que pedía más de lo que había; el otro no se quita aunque se pida su id", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "A" }); mov(d, { tipo: "ingreso", monto: 1000, fechaRegistro: "2026-10-01" });
  const bueno = crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 600, fecha: "2026-10-02" }).movimiento;
  const malo = mov(d, { tipo: "traspaso", monto: 600, nombre: "Traspaso", fechaRegistro: "2026-10-03", cuentaId: null, cuentaDestinoId: c.id });
  const s = simularReparacionTraspasos(d, HOY); assert.deepEqual(s.candidatos.map((x) => x.id), [malo.id]); assert.equal(s.candidatos[0].disponible, 400);
  assert.equal(aplicarReparacionTraspasos(d, [bueno.id]).quitados, 0); assert.equal(aplicarReparacionTraspasos(d, [bueno.id, malo.id]).quitados, 1);
  assert.deepEqual(traspasos(d).map((m) => m.id), [bueno.id]); assert.equal(T(d).sinAsignar, 400);
});
test("un traspaso legítimo (había dinero en su fecha) no se marca aunque después Sin asignar quede en negativo", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "A" }); mov(d, { tipo: "ingreso", monto: 1000, fechaRegistro: "2026-10-01" });
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 1000, fecha: "2026-10-02" }).ok, true);
  mov(d, { tipo: "gasto", monto: 5000, fechaRegistro: "2026-11-01" }); assert.equal(T(d).sinAsignar, -5000);
  assert.equal(simularReparacionTraspasos(d, HOY).candidatos.length, 0);
});
test("el respaldo JSON previo conserva el traspaso dañado (sirve para volver atrás)", () => {
  const { d, malo } = danado(); const r = JSON.parse(exportarRespaldoJson(d, { hoy: HOY }).texto); assert.ok(r.movimientos.some((m) => m.id === malo.id));
});
test("la tumba evita la resurrección al fusionar con un dispositivo que aún tiene el traspaso", () => {
  const { d: a, malo } = danado(); const b = JSON.parse(JSON.stringify(a)); aplicarReparacionTraspasos(a, [malo.id]);
  for (const x of [fusionarDatos(a, b), fusionarDatos(b, a)]) { assert.equal(traspasos(x).length, 0); assert.equal(calcularTotalesMovimientos(x, HOY).sinAsignar, -MONTO); }
});
test("con el módulo Cuentas apagado no hace nada", () => {
  const { d, malo } = danado(); activarCuentas(d, false);
  assert.equal(simularReparacionTraspasos(d, HOY).activo, false); assert.equal(aplicarReparacionTraspasos(d, [malo.id]).ok, false); assert.equal(traspasos(d).length, 1);
});
console.log(`\n${ok} pruebas A2 OK`);
