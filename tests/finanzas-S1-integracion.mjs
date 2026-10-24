// Pruebas de integración de la sesión 1 con el motor real de fusión (core/storage-merge.js) y el adaptador
// de semestres (finanzas/finanzas-registro-semestre.js). Corren en Node dentro del proyecto, sin DOM.
import assert from "node:assert/strict";
import { fusionarDatos } from "../core/storage-merge.js";
import { ID_SALDO_INICIAL, ajustarSaldo, quitarMovimiento, registrarMovimientoRapido } from "../core/finanzas-registro.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { confirmarRegistroEnMovimientos, crearRegistroVacio } from "../finanzas/finanzas-registro-semestre.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const base = () => ({ configuracion: {}, perfil: {}, semestres: [], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [] });
const log = console.warn; console.warn = () => {}; // la fusión avisa por consola en cada conflicto resuelto

console.log("Saldo inicial entre dispositivos");
test("dos dispositivos que crean su saldo inicial sin conexión no lo duplican", () => {
  const a = base(), b = base();
  ajustarSaldo(a, { saldoReal: 50000, saldoInicial: true });
  ajustarSaldo(b, { saldoReal: 50000, saldoInicial: true });
  assert.equal(a.movimientos[0].id, ID_SALDO_INICIAL);
  const m = fusionarDatos(a, b);
  assert.equal(m.movimientos.length, 1);
  assert.equal(calcularTotalesMovimientos(m).saldoLiquido, 50000);
  assert.equal(fusionarDatos(b, a).movimientos.length, 1);
});
test("si el saldo inicial ya existe, otro 'saldo inicial' con otro monto es un ajuste normal con id propio", () => {
  const d = base();
  ajustarSaldo(d, { saldoReal: 5000, saldoInicial: true });
  const r = ajustarSaldo(d, { saldoReal: 8000, saldoInicial: true });
  assert.equal(r.movimiento.nombre, "Ajuste de saldo");
  assert.notEqual(r.movimiento.id, ID_SALDO_INICIAL);
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 8000);
});
test("si se quitó el saldo inicial, uno nuevo NO reutiliza el id (la tumba lo mataría en la fusión)", () => {
  const d = base();
  ajustarSaldo(d, { saldoReal: 5000, saldoInicial: true });
  quitarMovimiento(d, ID_SALDO_INICIAL);
  const r = ajustarSaldo(d, { saldoReal: 6000, saldoInicial: true });
  assert.notEqual(r.movimiento.id, ID_SALDO_INICIAL);
  const otro = base(); otro.movimientos = []; otro._eliminados_movimientos = [];
  const m = fusionarDatos(d, otro);
  assert.equal(calcularTotalesMovimientos(m).saldoLiquido, 6000);
});

console.log("Deshacer entre dispositivos");
test("un movimiento deshecho en un dispositivo no resucita al fusionar con otro que aún lo tenía", () => {
  const a = base();
  const r = registrarMovimientoRapido(a, { tipo: "gasto", monto: 1000, nombre: "pasaje", fecha: "2026-10-01" });
  const b = JSON.parse(JSON.stringify(a));
  quitarMovimiento(b, r.movimiento.id);
  assert.equal(fusionarDatos(a, b).movimientos.length, 0);
  assert.equal(fusionarDatos(b, a).movimientos.length, 0);
});
test("un ajuste deshecho tampoco resucita", () => {
  const a = base(); ajustarSaldo(a, { saldoReal: 3000 });
  const b = JSON.parse(JSON.stringify(a)); quitarMovimiento(b, b.movimientos[0].id);
  assert.equal(calcularTotalesMovimientos(fusionarDatos(a, b)).saldoLiquido, 0);
});

console.log("Adaptador de semestres");
test("guardar el detalle de un semestre no toca ajustes ni gastos manuales", () => {
  const d = base(); ajustarSaldo(d, { saldoReal: 7000 });
  registrarMovimientoRapido(d, { tipo: "gasto", monto: 500, nombre: "pasaje", fecha: "2026-10-01" });
  const antes = JSON.stringify(d.movimientos);
  assert.equal(confirmarRegistroEnMovimientos(d, crearRegistroVacio("sem1")), false);
  assert.equal(JSON.stringify(d.movimientos), antes);
});

console.warn = log;
console.log(`\n${ok} pruebas OK`);
