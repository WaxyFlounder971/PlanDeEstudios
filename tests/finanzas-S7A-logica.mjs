// Pruebas de la sesión 7A (Node, sin DOM): Me deben y debo con schema.js, storage-merge.js y los derivados reales.
import assert from "node:assert/strict";
import * as schema from "../core/schema.js";
import { fusionarDatos } from "../core/storage-merge.js";
import { aplicarModulosFinanzas } from "../core/finanzas-perfiles.js";
import { calcularTotalesMovimientos, movimientosVigentes } from "../core/finanzas-derivados.js";
import { quitarMovimiento } from "../core/finanzas-registro.js";
import {
  activarDeudas, archivarPrestamo, calcularSaldoPrestamo, crearPrestamo, deshacerDivision, dividirGasto, editarPrestamo, eliminarPrestamo, listarPrestamos,
  movimientosDePrestamo, registrarAbono, registrarPrestamoAdicional, resumirDeudas,
} from "../core/finanzas-deudas.js";
import { exportarMovimientosCsv, exportarRespaldoJson } from "../core/finanzas-importar.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const nuevo = (conModulo = true) => {
  const d = schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));
  if (conModulo) activarDeudas(d, true);
  return d;
};
const T = (d) => calcularTotalesMovimientos(d, HOY);
const saldo = (d, p) => calcularSaldoPrestamo(p, d, HOY);

console.log("Prestar y recibir");
test("presté 5.000: Mi dinero baja, no es gasto y la persona me debe 5.000", () => {
  const d = nuevo(); const r = crearPrestamo(d, { persona: "Ana", direccion: "preste", monto: 5000, fecha: HOY });
  assert.equal(r.ok, true); assert.equal(r.movimiento.tipo, "prestamo"); assert.equal(r.movimiento.sentido, "sale");
  assert.equal(T(d).saldoLiquido, -5000); assert.equal(T(d).totalGastado, 0); assert.equal(T(d).totalIngresos, 0);
  assert.equal(saldo(d, r.prestamo).pendiente, 5000); assert.deepEqual(resumirDeudas(d, HOY), { meDeben: 5000, debo: 0, neto: 5000, personasMeDeben: 1, personasDebo: 0, saldados: 0 });
});
test("me prestaron 10.000: Mi dinero sube, no es ingreso y debo 10.000", () => {
  const d = nuevo(); const r = crearPrestamo(d, { persona: "Mamá", direccion: "me_prestaron", monto: 10000, fecha: HOY });
  assert.equal(T(d).saldoLiquido, 10000); assert.equal(T(d).totalIngresos, 0); assert.equal(saldo(d, r.prestamo).pendiente, 10000);
  assert.equal(resumirDeudas(d, HOY).debo, 10000); assert.equal(resumirDeudas(d, HOY).neto, -10000);
});
test("'ya estaba prestado antes' no mueve Mi dinero y sí cuenta como deuda", () => {
  const d = nuevo(); const r = crearPrestamo(d, { persona: "Luis", direccion: "preste", monto: 3000, modo: "previo", fecha: HOY });
  assert.equal(r.movimiento, null); assert.equal(T(d).saldoLiquido, 0); assert.equal(saldo(d, r.prestamo).pendiente, 3000);
});
test("abonos bajan lo pendiente, el último lo salda y no se puede devolver de más", () => {
  const d = nuevo(); const { prestamo } = crearPrestamo(d, { persona: "Ana", direccion: "preste", monto: 5000, fecha: HOY });
  assert.equal(registrarAbono(d, prestamo.id, { monto: 2000, fecha: HOY }).ok, true); assert.equal(saldo(d, prestamo).pendiente, 3000); assert.equal(T(d).saldoLiquido, -3000);
  const exceso = registrarAbono(d, prestamo.id, { monto: 3500, fecha: HOY }); assert.equal(exceso.ok, false); assert.equal(exceso.motivo, "excede"); assert.equal(exceso.pendiente, 3000);
  assert.equal(registrarAbono(d, prestamo.id, { monto: 3000, fecha: HOY }).ok, true);
  assert.equal(saldo(d, prestamo).saldado, true); assert.equal(T(d).saldoLiquido, 0); assert.equal(resumirDeudas(d, HOY).saldados, 1); assert.equal(resumirDeudas(d, HOY).meDeben, 0);
});
test("devolver lo que me prestaron baja mi deuda y Mi dinero; prestar más la sube", () => {
  const d = nuevo(); const { prestamo } = crearPrestamo(d, { persona: "Mamá", direccion: "me_prestaron", monto: 10000, fecha: HOY });
  registrarAbono(d, prestamo.id, { monto: 4000, fecha: HOY }); assert.equal(saldo(d, prestamo).pendiente, 6000); assert.equal(T(d).saldoLiquido, 6000);
  registrarPrestamoAdicional(d, prestamo.id, { monto: 1000, fecha: HOY }); assert.equal(saldo(d, prestamo).pendiente, 7000); assert.equal(T(d).saldoLiquido, 7000);
});
test("un préstamo nunca altera gastos ni ingresos: solo Mi dinero (invariante de las transferencias)", () => {
  const d = nuevo(); const antes = JSON.stringify({ g: T(d).totalGastado, i: T(d).totalIngresos, b: T(d).balanceNeto });
  const { prestamo } = crearPrestamo(d, { persona: "Ana", direccion: "preste", monto: 800, fecha: HOY }); registrarAbono(d, prestamo.id, { monto: 300, fecha: HOY });
  assert.equal(JSON.stringify({ g: T(d).totalGastado, i: T(d).totalIngresos, b: T(d).balanceNeto }), antes);
});
test("un movimiento con fecha futura todavía no cuenta ni en Mi dinero ni en lo que se debe", () => {
  const d = nuevo(); const { prestamo } = crearPrestamo(d, { persona: "Ana", direccion: "preste", monto: 900, fecha: "2026-12-01" });
  assert.equal(T(d).saldoLiquido, 0); assert.equal(saldo(d, prestamo).pendiente, 0);
});

console.log("Validaciones");
test("monto, persona, dirección y fecha inválidos se rechazan sin crear nada", () => {
  const d = nuevo();
  [{ persona: "", monto: 5 }, { persona: "Ana", monto: 0 }, { persona: "Ana", monto: -5 }, { persona: "Ana", monto: 5, direccion: "x" }, { persona: "Ana", monto: 5, fecha: "ayer" }, { persona: "Ana", monto: 2e12 }]
    .forEach((x) => assert.equal(crearPrestamo(d, x).ok, false, JSON.stringify(x)));
  assert.equal(d.prestamos.length, 0); assert.equal(d.movimientos.length, 0);
});
test("la misma persona y dirección no se repite (sin tildes ni mayúsculas); en la otra dirección sí", () => {
  const d = nuevo(); assert.equal(crearPrestamo(d, { persona: "María", monto: 1 }).ok, true);
  assert.equal(crearPrestamo(d, { persona: " maria ", monto: 1 }).motivo, "repetida");
  assert.equal(crearPrestamo(d, { persona: "María", direccion: "me_prestaron", monto: 1 }).ok, true);
});
test("el módulo apagado no deja registrar nada y no devuelve saldos", () => {
  const d = nuevo(false); assert.equal(registrarAbono(d, "pre_x", { monto: 1 }).ok, false);
  assert.equal(dividirGasto(d, { nombre: "Cena", total: 100, partes: [{ persona: "A", monto: 50 }] }).motivo, "modulo_apagado");
  assert.deepEqual(resumirDeudas(d, HOY), { meDeben: 0, debo: 0, neto: 0, personasMeDeben: 0, personasDebo: 0, saldados: 0 });
});

console.log("Dividir gastos");
test("pagué la cena de 30.000 y la dividimos en 3: solo mis 10.000 son gasto, Mi dinero baja 30.000 y cada uno me debe 10.000", () => {
  const d = nuevo(); const r = dividirGasto(d, { nombre: "Cena", total: 30000, partes: [{ persona: "Ana", monto: 10000 }, { persona: "Luis", monto: 10000 }], fecha: HOY });
  assert.equal(r.ok, true); assert.equal(r.miParte, 10000);
  assert.equal(T(d).totalGastado, 10000); assert.equal(T(d).saldoLiquido, -30000); assert.equal(resumirDeudas(d, HOY).meDeben, 20000); assert.equal(resumirDeudas(d, HOY).personasMeDeben, 2);
});
test("dividir otra vez con la misma persona reusa su cuenta y suma", () => {
  const d = nuevo(); dividirGasto(d, { nombre: "Cena", total: 20000, partes: [{ persona: "Ana", monto: 10000 }], fecha: HOY });
  dividirGasto(d, { nombre: "Taxi", total: 6000, partes: [{ persona: "ana", monto: 3000 }], fecha: HOY });
  assert.equal(listarPrestamos(d).length, 1); assert.equal(saldo(d, d.prestamos[0]).pendiente, 13000);
});
test("la categoría del gasto dividido queda solo en mi parte", () => {
  const d = nuevo(); const r = dividirGasto(d, { nombre: "Cena", total: 20000, partes: [{ persona: "Ana", monto: 10000 }], fecha: HOY, categoriaId: "cat_comida" });
  const g = d.movimientos.filter((m) => m.tipo === "gasto"); assert.equal(g.length, 1); assert.equal(g[0].categoria_id, "cat_comida"); assert.equal(g[0].monto, 10000); assert.equal(r.movimientos.length, 2);
});
test("si todo el gasto es de los demás (mi parte 0) no se crea gasto mío", () => {
  const d = nuevo(); dividirGasto(d, { nombre: "Regalo", total: 9000, partes: [{ persona: "Ana", monto: 9000 }], fecha: HOY });
  assert.equal(d.movimientos.filter((m) => m.tipo === "gasto").length, 0); assert.equal(T(d).saldoLiquido, -9000);
});
test("partes que suman más que el total, personas repetidas o montos en cero se rechazan", () => {
  const d = nuevo(); const base = { nombre: "Cena", total: 1000, fecha: HOY };
  assert.equal(dividirGasto(d, { ...base, partes: [{ persona: "A", monto: 600 }, { persona: "B", monto: 600 }] }).motivo, "partes_exceden");
  assert.equal(dividirGasto(d, { ...base, partes: [{ persona: "A", monto: 100 }, { persona: "a", monto: 100 }] }).motivo, "persona_repetida");
  assert.equal(dividirGasto(d, { ...base, partes: [{ persona: "A", monto: 0 }] }).motivo, "monto_parte");
  assert.equal(dividirGasto(d, { ...base, partes: [] }).motivo, "sin_partes");
  assert.equal(d.movimientos.length, 0); assert.equal(d.prestamos.length, 0);
});
test("pagó otra persona: mi parte es gasto, Mi dinero no baja y le debo esa parte; al devolverle sí baja y no vuelve a ser gasto", () => {
  const d = nuevo(); const r = dividirGasto(d, { nombre: "Almuerzo", total: 4000, quienPago: "otra", pagador: "Papá", fecha: HOY });
  assert.equal(r.ok, true); assert.equal(T(d).totalGastado, 4000); assert.equal(T(d).saldoLiquido, 0);
  const p = d.prestamos[0]; assert.equal(p.direccion, "me_prestaron"); assert.equal(saldo(d, p).pendiente, 4000);
  registrarAbono(d, p.id, { monto: 4000, fecha: HOY }); assert.equal(T(d).saldoLiquido, -4000); assert.equal(T(d).totalGastado, 4000); assert.equal(saldo(d, p).saldado, true);
});
test("con el módulo apagado, un gasto pagado por otra persona se ve como gasto normal (nada oculto cambia lo demás)", () => {
  const d = nuevo(); dividirGasto(d, { nombre: "Almuerzo", total: 4000, quienPago: "otra", pagador: "Papá", fecha: HOY });
  activarDeudas(d, false); assert.equal(T(d).totalGastado, 4000); assert.equal(T(d).saldoLiquido, -4000);
});
test("deshacer una división quita sus movimientos y las personas creadas solo para ella, y no deja gasto ni deuda", () => {
  const d = nuevo(); const r = dividirGasto(d, { nombre: "Cena", total: 30000, partes: [{ persona: "Ana", monto: 10000 }, { persona: "Luis", monto: 10000 }], fecha: HOY });
  assert.equal(deshacerDivision(d, r), 3); assert.equal(d.movimientos.length, 0); assert.equal(d.prestamos.length, 0); assert.equal(T(d).saldoLiquido, 0);
  assert.ok(d._eliminados_movimientos.length === 3 && d._eliminados_prestamos.length === 2);
});
test("deshacer no borra a una persona que ya existía antes de la división", () => {
  const d = nuevo(); crearPrestamo(d, { persona: "Ana", monto: 500, fecha: HOY });
  const r = dividirGasto(d, { nombre: "Cena", total: 2000, partes: [{ persona: "Ana", monto: 1000 }], fecha: HOY }); deshacerDivision(d, r);
  assert.equal(d.prestamos.length, 1); assert.equal(saldo(d, d.prestamos[0]).pendiente, 500);
});

console.log("Editar, archivar, eliminar");
test("renombrar respeta la regla de nombre único; archivar oculta de la lista pero conserva todo", () => {
  const d = nuevo(); const a = crearPrestamo(d, { persona: "Ana", monto: 1, fecha: HOY }).prestamo; crearPrestamo(d, { persona: "Luis", monto: 1, fecha: HOY });
  assert.equal(editarPrestamo(d, a.id, { persona: "luis" }).motivo, "repetida"); assert.equal(editarPrestamo(d, a.id, { persona: "Ana María", nota: "  x  " }).ok, true); assert.equal(a.persona, "Ana María");
  archivarPrestamo(d, a.id); assert.equal(listarPrestamos(d).length, 1); assert.equal(listarPrestamos(d, { incluirArchivados: true }).length, 2); assert.equal(T(d).saldoLiquido, -2);
  assert.equal(archivarPrestamo(d, a.id, false).ok, true);
});
test("eliminar una persona solo se permite sin movimientos; con ellos hay que quitarlos primero", () => {
  const d = nuevo(); const { prestamo, movimiento } = crearPrestamo(d, { persona: "Ana", monto: 100, fecha: HOY });
  assert.equal(eliminarPrestamo(d, prestamo.id).motivo, "tiene_movimientos"); assert.equal(movimientosDePrestamo(d, prestamo.id).length, 1);
  assert.equal(quitarMovimiento(d, movimiento.id), true); assert.equal(eliminarPrestamo(d, prestamo.id).ok, true); assert.equal(d.prestamos.length, 0); assert.equal(T(d).saldoLiquido, 0);
});

console.log("Apagar solo oculta");
test("apagado: los movimientos de préstamo no se ven ni cuentan; al encender vuelve todo igual (nada se borró)", () => {
  const d = nuevo(); const { prestamo } = crearPrestamo(d, { persona: "Ana", monto: 5000, fecha: HOY });
  const encendido = JSON.stringify(T(d)); activarDeudas(d, false);
  assert.equal(T(d).saldoLiquido, 0); assert.equal(movimientosVigentes(d, HOY).some((m) => m.tipo === "prestamo"), false); assert.equal(calcularSaldoPrestamo(prestamo, d, HOY), null);
  assert.equal(d.movimientos.length, 1); activarDeudas(d, true); assert.equal(JSON.stringify(T(d)), encendido);
});
test("sin usar el módulo, los datos y los totales son idénticos a los de antes (sin claves nuevas en los movimientos)", () => {
  const d = nuevo(false); aplicarModulosFinanzas(d, { gastos: true });
  const mov = d.movimientos; assert.equal(mov.length, 0); assert.deepEqual(d.prestamos, []);
});

console.log("Sincronización entre dispositivos");
test("un préstamo y su abono creados en un dispositivo llegan al otro y dan el mismo saldo", () => {
  const a = nuevo(), b = nuevo(); const { prestamo } = crearPrestamo(a, { persona: "Ana", monto: 5000, fecha: HOY }); registrarAbono(a, prestamo.id, { monto: 1500, fecha: HOY });
  const f = fusionarDatos(b, a); assert.equal(f.prestamos.length, 1); assert.equal(f.movimientos.length, 2); assert.equal(calcularSaldoPrestamo(f.prestamos[0], f, HOY).pendiente, 3500);
  assert.equal(T(f).saldoLiquido, -3500);
});
test("abonos hechos a la vez en dos dispositivos se suman sin duplicar ni marcar conflicto", () => {
  const a = nuevo(); const { prestamo } = crearPrestamo(a, { persona: "Ana", monto: 5000, fecha: HOY }); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  registrarAbono(a, prestamo.id, { monto: 1000, fecha: HOY }); registrarAbono(b, prestamo.id, { monto: 500, fecha: HOY });
  const f = fusionarDatos(a, b); assert.equal(calcularSaldoPrestamo(f.prestamos[0], f, HOY).pendiente, 3500); assert.equal(f.movimientos.some((m) => m._conflicto), false);
  assert.equal(JSON.stringify(calcularSaldoPrestamo(fusionarDatos(b, a).prestamos[0], fusionarDatos(b, a), HOY)), JSON.stringify(calcularSaldoPrestamo(f.prestamos[0], f, HOY)));
});
test("renombrar en un dispositivo gana sobre la versión vieja del otro; eliminar no resucita", () => {
  const a = nuevo(); const { prestamo } = crearPrestamo(a, { persona: "Ana", modo: "sin_monto" }); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  editarPrestamo(a, prestamo.id, { persona: "Anita" }); assert.equal(fusionarDatos(b, a).prestamos[0].persona, "Anita");
  eliminarPrestamo(a, prestamo.id); let f = fusionarDatos(b, a); assert.equal(f.prestamos.length, 0); assert.ok(f._eliminados_prestamos.some((t) => t.id === prestamo.id)); f = fusionarDatos(f, b); assert.equal(f.prestamos.length, 0);
});
test("el interruptor del módulo se sincroniza con la configuración", () => {
  const a = nuevo(), b = nuevo(false); const f = fusionarDatos(b, a); assert.equal(!!f.configuracion.finanzas_deudas, true);
});

console.log("Exportar");
test("el CSV deja fuera los préstamos y el respaldo JSON los incluye con sus personas", () => {
  const d = nuevo(); crearPrestamo(d, { persona: "Ana", monto: 5000, fecha: HOY }); dividirGasto(d, { nombre: "Cena", total: 2000, partes: [{ persona: "Luis", monto: 1000 }], fecha: HOY });
  const csv = exportarMovimientosCsv(d, { hoy: HOY }); assert.equal(csv.total, 1); assert.ok(!csv.texto.includes("prestamo"));
  const j = JSON.parse(exportarRespaldoJson(d, { hoy: HOY }).texto); assert.equal(j.prestamos.length, 2); assert.equal(j.movimientos.filter((m) => m.tipo === "prestamo").length, 2);
  assert.ok(j.prestamos.every((p) => !Object.keys(p).some((k) => k.startsWith("_"))));
});

console.log(`\n${ok} pruebas de lógica OK`);
