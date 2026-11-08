// Pruebas F1 (v3.28.0, Parche A1): pasar dinero desde «Sin asignar» no puede duplicar ni crear dinero. Node, sin DOM, solo fixtures.
import assert from "node:assert/strict";
import * as schema from "../js/core/schema.js";
import { fusionarDatos } from "../js/core/storage/storage-merge.js";
import { crearMovimiento } from "../js/core/finanzas/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { crearGuardReentrada, quitarMovimiento } from "../js/core/finanzas/finanzas-registro.js";
import { parsearMontoTexto } from "../js/core/finanzas/finanzas-texto.js";
import { activarCuentas, crearCuenta, crearTraspaso, resumirCuentas } from "../js/core/finanzas/finanzas-cuentas.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-11-07", MONTO = 1649945;
const nuevo = () => { const d = schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo()))); activarCuentas(d, true); return d; };
const T = (d) => calcularTotalesMovimientos(d, HOY);
const mov = (d, p) => { const m = crearMovimiento({ fechaRegistro: HOY, ...p }); d.movimientos.push(m); return m; };
const cuenta = (d, p) => { const r = crearCuenta(d, p); assert.equal(r.ok, true, JSON.stringify(r)); return r.cuenta; };
const traspasos = (d) => d.movimientos.filter((m) => m.tipo === "traspaso");
/** Escenario del usuario: dos cuentas reales (64,19 y 70,99), una tarjeta que paga otra persona y ₡1 649 945 en Sin asignar con el signo pedido. */
function escenario(signo) {
  const d = nuevo();
  const bac = cuenta(d, { nombre: "BAC", saldoInicial: 64.19 }), bn = cuenta(d, { nombre: "Banco Nacional", saldoInicial: 70.99 });
  const tarjeta = cuenta(d, { nombre: "Tarjeta de otra persona", tipo: "credito", afectaSaldo: false });
  mov(d, signo > 0 ? { tipo: "ingreso", monto: MONTO, nombre: "Lo que tenía" } : { tipo: "gasto", monto: MONTO, nombre: "Gasto sin cuenta" });
  return { d, bac, bn, tarjeta };
}

console.log("Sin asignar en positivo (hay dinero que repartir)");
test("pasar todo a una cuenta de banco: Sin asignar queda en 0, el destino lo recibe una sola vez y Mi dinero no cambia", () => {
  const { d, bac } = escenario(1); const antes = T(d); assert.equal(antes.sinAsignar, MONTO);
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: bac.id, monto: MONTO, fecha: HOY }).ok, true);
  const t = T(d); assert.equal(t.sinAsignar, 0); assert.equal(t.porCuenta[bac.id].saldo, 64.19 + MONTO); assert.equal(t.saldoLiquido, antes.saldoLiquido);
});
test("pasar todo a una tarjeta que no afecta mi saldo: Sin asignar queda en 0 y Mi dinero queda en la suma de las cuentas reales (135,18)", () => {
  const { d, tarjeta } = escenario(1); assert.equal(crearTraspaso(d, { origenId: null, destinoId: tarjeta.id, monto: MONTO, fecha: HOY }).ok, true);
  const t = T(d); assert.equal(t.sinAsignar, 0); assert.equal(Math.round(t.saldoLiquido * 100), 13518);
  assert.equal(resumirCuentas(d, HOY).cuentas.find((x) => x.cuenta.id === tarjeta.id).saldo, null);
});
test("invariante: cuentas que afectan mi saldo + Sin asignar = Mi dinero, antes y después de repartir", () => {
  const { d, bac, bn } = escenario(1); const suma = (t) => t.porCuenta[bac.id].saldo + t.porCuenta[bn.id].saldo + t.sinAsignar;
  assert.equal(Math.round(suma(T(d)) * 100), Math.round(T(d).saldoLiquido * 100));
  crearTraspaso(d, { origenId: null, destinoId: bn.id, monto: 1000, fecha: HOY }); assert.equal(Math.round(suma(T(d)) * 100), Math.round(T(d).saldoLiquido * 100));
});

console.log("Sin asignar en negativo (no hay dinero que repartir): el bug de F1");
test("con Sin asignar en −₡1 649 945, pasar ₡1 649 945 a una tarjeta que no afecta mi saldo se rechaza (antes dejaba −₡3 299 890)", () => {
  const { d, tarjeta } = escenario(-1); assert.equal(T(d).sinAsignar, -MONTO);
  const r = crearTraspaso(d, { origenId: null, destinoId: tarjeta.id, monto: MONTO, fecha: HOY });
  assert.equal(r.ok, false); assert.equal(r.motivo, "sin_asignar_insuficiente"); assert.equal(traspasos(d).length, 0);
  assert.equal(T(d).sinAsignar, -MONTO); assert.notEqual(T(d).sinAsignar, -2 * MONTO);
});
test("con Sin asignar en negativo, pasar a una cuenta de banco también se rechaza y no se crea dinero en el destino", () => {
  const { d, bac } = escenario(-1); const antes = T(d);
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: bac.id, monto: MONTO, fecha: HOY }).motivo, "sin_asignar_insuficiente");
  const t = T(d); assert.equal(t.porCuenta[bac.id].saldo, 64.19); assert.equal(t.saldoLiquido, antes.saldoLiquido); assert.equal(t.sinAsignar, antes.sinAsignar);
});
test("con Sin asignar en 0 no se puede repartir nada", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "A" });
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 1, fecha: HOY }).motivo, "sin_asignar_insuficiente");
});
test("el límite es exacto al centavo: lo disponible pasa, un centavo más no", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "A" }); mov(d, { tipo: "ingreso", monto: 10000.5 });
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 10000.51, fecha: HOY }).motivo, "sin_asignar_insuficiente");
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 10000.5, fecha: HOY }).ok, true); assert.equal(T(d).sinAsignar, 0);
});

console.log("No regresiones: desde una cuenta sí se puede quedar en negativo");
test("pagar con una tarjeta de crédito propia o sacar de una cuenta sigue permitido aunque quede en negativo", () => {
  const d = nuevo(); const banco = cuenta(d, { nombre: "Banco" }), tj = cuenta(d, { nombre: "Visa", tipo: "credito" });
  assert.equal(crearTraspaso(d, { origenId: tj.id, destinoId: banco.id, monto: 500, fecha: HOY }).ok, true); assert.equal(T(d).porCuenta[tj.id].saldo, -500);
  assert.equal(crearTraspaso(d, { origenId: banco.id, destinoId: null, monto: 200, fecha: HOY }).ok, true);
});

console.log("Doble ejecución e idempotencia");
test("repetir el mismo traspaso desde Sin asignar: el segundo se rechaza y nada se duplica", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "A" }); mov(d, { tipo: "ingreso", monto: 1000 });
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 1000, fecha: HOY }).ok, true);
  assert.equal(crearTraspaso(d, { origenId: null, destinoId: c.id, monto: 1000, fecha: HOY }).ok, false);
  assert.equal(traspasos(d).length, 1); assert.equal(T(d).sinAsignar, 0); assert.equal(T(d).porCuenta[c.id].saldo, 1000);
});
test("el guard de reentrada ejecuta el guardado una sola vez ante un doble toque", () => {
  const guard = crearGuardReentrada(10); let n = 0; guard(() => { n++; }); guard(() => { n++; }); assert.equal(n, 1);
});
test("el monto «1 649 945» (espacio de miles) se lee como 1649945", () => {
  assert.equal(parsearMontoTexto("1 649 945"), MONTO); assert.equal(parsearMontoTexto("1 649 945,50"), 1649945.5); assert.equal(parsearMontoTexto("₡1 649 945"), MONTO);
});

console.log("Fusión entre dispositivos (sync) sin resurrección ni duplicado");
test("fusionar dos veces o en cualquier orden no duplica el traspaso", () => {
  const { d: a, bac } = escenario(1); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  crearTraspaso(a, { origenId: null, destinoId: bac.id, monto: 1000, fecha: HOY });
  const f = fusionarDatos(a, b), g = fusionarDatos(b, a), h = fusionarDatos(f, a);
  for (const x of [f, g, h]) { assert.equal(traspasos(x).length, 1); assert.equal(calcularTotalesMovimientos(x, HOY).sinAsignar, MONTO - 1000); }
});
test("un traspaso quitado en un dispositivo no resucita al fusionar con otro que aún lo tiene", () => {
  const { d: a, tarjeta } = escenario(1); const t = crearTraspaso(a, { origenId: null, destinoId: tarjeta.id, monto: 1000, fecha: HOY }).movimiento;
  const b = JSON.parse(JSON.stringify(a)); quitarMovimiento(a, t.id);
  for (const x of [fusionarDatos(a, b), fusionarDatos(b, a)]) { assert.equal(traspasos(x).length, 0); assert.equal(calcularTotalesMovimientos(x, HOY).sinAsignar, MONTO); }
});
test("dos traspasos hechos a la vez en dos dispositivos que juntos superan lo disponible: cada uno es válido solo y la suma se ve en Sin asignar", () => {
  const { d: a, bac } = escenario(1); const b = JSON.parse(JSON.stringify(a));
  crearTraspaso(a, { origenId: null, destinoId: bac.id, monto: MONTO, fecha: HOY }); crearTraspaso(b, { origenId: null, destinoId: bac.id, monto: MONTO, fecha: HOY });
  const f = fusionarDatos(a, b); assert.equal(traspasos(f).length, 2); assert.equal(calcularTotalesMovimientos(f, HOY).sinAsignar, -MONTO);
  assert.equal(resumirCuentas(f, HOY).sinAsignar, -MONTO); // caso límite conocido: el guard es local; se ve en negativo y se corrige quitando uno
});

console.log(`\n${ok} pruebas F1 OK`);
