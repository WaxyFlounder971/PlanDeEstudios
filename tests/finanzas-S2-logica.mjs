// Pruebas de lógica de la sesión 2 (Node, sin DOM): compromisos, generador de cuotas, confirmar sin duplicar, migración sin tocar datos.
import assert from "node:assert/strict";
import { crearMeta, crearMovimiento, hoyIso } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { aplicarModulosFinanzas, pestanasVisiblesFinanzas } from "../core/finanzas-perfiles.js";
import { ajustarSaldo, quitarMovimiento } from "../core/finanzas-registro.js";
import { migrarDatosAntiguos } from "../core/schema.js";
import { construirRegistroDesdeMovimientos } from "../finanzas/finanzas-registro-semestre.js";
import {
  FLAG_MIGRACION_FINANZAS2, confirmarCompromiso, construirCuotas, crearCompromiso, deshacerConfirmacion, editarCompromiso,
  eliminarCompromiso, estadoVisibleCompromiso, fechasDePagos, generarCuotas, migrarFinanzas2V1, obtenerCompromisosVisibles,
  omitirCompromiso, ordenarCompromisos, reabrirCompromiso, reajustarSerie, repartirMonto, resumirCompromisos,
} from "../core/finanzas-compromisos.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const vacio = () => ({ configuracion: {}, semestres: [{ id: "sem1", nombre: "I Semestre" }, { id: "sem2", nombre: "II Semestre" }], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [], compromisos: [], _eliminados_movimientos: [], _eliminados_compromisos: [] });
const matricula = (d, extra = {}) => generarCuotas(d, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 100000, cantidad: 4, fechaPrimera: "2026-01-31", frecuencia: "mensual", ...extra });
const movs = (d) => d.movimientos.filter((m) => m.tipo !== "ajuste");

console.log("Fechas y reparto");
test("mensual conserva el día ancla y respeta el fin de mes (31 ene, 28 feb, 31 mar, 30 abr)", () => {
  assert.deepEqual(fechasDePagos("2026-01-31", 4, "mensual"), ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"]);
  assert.deepEqual(fechasDePagos("2028-01-31", 2, "mensual"), ["2028-01-31", "2028-02-29"]);
});
test("quincenal, semanal, cruce de año y sin fecha", () => {
  assert.deepEqual(fechasDePagos("2026-12-20", 3, "quincenal"), ["2026-12-20", "2027-01-03", "2027-01-17"]);
  assert.deepEqual(fechasDePagos("2026-12-30", 2, "semanal"), ["2026-12-30", "2027-01-06"]);
  assert.deepEqual(fechasDePagos("2026-11-15", 3, "mensual"), ["2026-11-15", "2026-12-15", "2027-01-15"]);
  assert.deepEqual(fechasDePagos("", 2, "mensual"), [null, null]);
  assert.deepEqual(fechasDePagos("2026-02-30", 2, "mensual"), [null, null]); // fecha imposible = sin fecha
});
test("el reparto cuadra exacto: 100 en 3 = 33.33 + 33.33 + 33.34", () => {
  assert.deepEqual(repartirMonto(100, 3), [33.33, 33.33, 33.34]);
  assert.equal(repartirMonto(100000, 7).reduce((a, b) => a + b, 0).toFixed(2), "100000.00");
});

console.log("Generador de cuotas");
test("matrícula: total dividido en 4 cuotas con nombre, fechas y serie común; afecta_saldo apagado por defecto", () => {
  const d = vacio(); const r = matricula(d);
  assert.equal(r.ok, true);
  assert.equal(d.compromisos.length, 4);
  assert.deepEqual(d.compromisos.map((c) => c.nombre), ["Cuota 1 de 4", "Cuota 2 de 4", "Cuota 3 de 4", "Cuota 4 de 4"]);
  assert.equal(d.compromisos.reduce((a, c) => a + c.monto, 0), 100000);
  assert.equal(new Set(d.compromisos.map((c) => c.serie_id)).size, 1);
  assert.ok(d.compromisos[0].serie_id);
  assert.ok(d.compromisos.every((c) => c.afecta_saldo === false && c.estado === "pendiente" && c.movimiento_id === null));
});
test("el interruptor 'Afecta mi saldo' se respeta en matrícula y nunca se activa en un ingreso esperado", () => {
  const d = vacio(); matricula(d, { afectaSaldo: true });
  assert.ok(d.compromisos.every((c) => c.afecta_saldo === true));
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombreBase: "Beca", modo: "por_pago", monto: 50000, cantidad: 2, fechaPrimera: "2026-02-01", afectaSaldo: true });
  assert.ok(d.compromisos.filter((c) => c.tipo === "ingreso_esperado").every((c) => c.afecta_saldo === false));
});
test("'por pago': cada cuota vale el monto indicado; una sola cuota no lleva 'de N' ni serie", () => {
  const d = vacio();
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "ayuda_familiar", nombreBase: "Ayuda familiar", modo: "por_pago", monto: 80000, cantidad: 3, fechaPrimera: "2026-03-05" });
  assert.deepEqual(d.compromisos.map((c) => c.monto), [80000, 80000, 80000]);
  const e = vacio(); matricula(e, { cantidad: 1, nombreBase: "Matrícula" });
  assert.equal(e.compromisos[0].nombre, "Matrícula");
  assert.equal(e.compromisos[0].serie_id, null);
});
test("sin fecha inicial las cuotas quedan sin fecha prevista", () => {
  const d = vacio(); matricula(d, { fechaPrimera: "" });
  assert.ok(d.compromisos.every((c) => c.fecha_prevista === null));
});
test("rechaza lo inválido y no guarda nada", () => {
  const d = vacio();
  assert.equal(matricula(d, { monto: 0 }).motivo, "monto");
  assert.equal(matricula(d, { monto: "abc" }).motivo, "monto");
  assert.equal(matricula(d, { cantidad: 0 }).motivo, "cantidad");
  assert.equal(matricula(d, { cantidad: 61 }).motivo, "cantidad");
  assert.equal(matricula(d, { cantidad: 2.5 }).motivo, "cantidad");
  assert.equal(matricula(d, { semestreId: "" }).motivo, "semestre");
  assert.equal(matricula(d, { semestreId: "no-existe" }).motivo, "semestre");
  assert.equal(matricula(d, { fechaPrimera: "31/01/2026" }).motivo, "fecha");
  assert.equal(generarCuotas(d, { tipo: "gasto", monto: 5, cantidad: 1 }).motivo, "tipo");
  assert.equal(generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "beca", nombreBase: "Beca", monto: 5, cantidad: 1 }).motivo, "semestre");
  assert.equal(generarCuotas(d, { tipo: "matricula", semestreId: "sem1", modo: "total", monto: 0.01, cantidad: 3 }).motivo, "monto"); // alguna parte quedaría en 0
  assert.equal(d.compromisos.length, 0);
});
test("construirCuotas solo simula: no escribe en los datos", () => {
  const d = vacio();
  const r = construirCuotas(d, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 90, cantidad: 3, fechaPrimera: "2026-05-01" });
  assert.equal(r.compromisos.length, 3);
  assert.equal(d.compromisos.length, 0);
});

console.log("Confirmar: exactamente un movimiento");
test("confirmar una cuota de matrícula crea un gasto de origen matrícula, con semestre, y baja Mi dinero", () => {
  const d = vacio(); ajustarSaldo(d, { saldoReal: 200000, saldoInicial: true }); matricula(d);
  const antes = calcularTotalesMovimientos(d);
  const r = confirmarCompromiso(d, d.compromisos[0].id, { fecha: "2026-01-31" });
  assert.equal(r.ok, true); assert.equal(r.creado, true);
  assert.equal(r.movimiento.id, "mov_" + d.compromisos[0].id);
  assert.equal(r.movimiento.tipo, "gasto"); assert.equal(r.movimiento.origen, "matricula");
  assert.equal(r.movimiento.semestre_id, "sem1"); assert.equal(r.movimiento.monto, 25000);
  assert.equal(r.movimiento.compromiso_id, d.compromisos[0].id);
  assert.equal(d.compromisos[0].estado, "cumplido"); assert.equal(d.compromisos[0].movimiento_id, r.movimiento.id);
  const t = calcularTotalesMovimientos(d);
  assert.equal(t.totalGastado, antes.totalGastado + 25000);
  assert.equal(t.saldoLiquido, antes.saldoLiquido - 25000);
  assert.equal(t.enMetas, antes.enMetas);
});
test("confirmar dos veces (doble toque) no duplica el movimiento ni los totales", () => {
  const d = vacio(); matricula(d);
  const id = d.compromisos[0].id;
  confirmarCompromiso(d, id, { fecha: "2026-01-31" });
  const r2 = confirmarCompromiso(d, id, { fecha: "2026-01-31" });
  const r3 = confirmarCompromiso(d, id, { monto: 99999 });
  assert.equal(r2.creado, false); assert.equal(r3.creado, false);
  assert.equal(movs(d).length, 1);
  assert.equal(calcularTotalesMovimientos(d).totalGastado, 25000);
});
test("monto y fecha editables al confirmar; el compromiso conserva su monto planeado", () => {
  const d = vacio(); matricula(d);
  const r = confirmarCompromiso(d, d.compromisos[1].id, { monto: "27.500,50", fecha: "2026-02-20" });
  assert.equal(r.movimiento.monto, 27500.5);
  assert.equal(r.movimiento.fecha_registro, "2026-02-20");
  assert.equal(d.compromisos[1].monto, 25000);
});
test("monto en cero o fecha inválida no confirman nada", () => {
  const d = vacio(); matricula(d);
  const id = d.compromisos[0].id;
  assert.equal(confirmarCompromiso(d, id, { monto: "0" }).motivo, "monto");
  assert.equal(confirmarCompromiso(d, id, { fecha: "ayer" }).motivo, "fecha");
  assert.equal(confirmarCompromiso(d, "cmp_x").motivo, "no_existe");
  assert.equal(d.movimientos.length, 0);
  assert.equal(d.compromisos[0].estado, "pendiente");
});
test("confirmar con fecha futura registra el movimiento pero aún no cuenta", () => {
  const d = vacio(); matricula(d);
  confirmarCompromiso(d, d.compromisos[0].id, { fecha: "2999-01-01" });
  assert.equal(movs(d).length, 1);
  assert.equal(calcularTotalesMovimientos(d).totalGastado, 0);
});
test("beca: ingreso de origen beca; ayuda familiar y trabajo: ingreso normal. Ninguno es gasto", () => {
  const d = vacio();
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombreBase: "Beca", modo: "por_pago", monto: 300000, cantidad: 1, fechaPrimera: "2026-02-01" });
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "ayuda_familiar", nombreBase: "Ayuda familiar", modo: "por_pago", monto: 50000, cantidad: 1, fechaPrimera: "2026-02-01" });
  d.compromisos.forEach((c) => confirmarCompromiso(d, c.id, { fecha: "2026-02-01" }));
  const t = calcularTotalesMovimientos(d);
  assert.equal(t.totalBecas, 300000); assert.equal(t.totalIngresos, 50000); assert.equal(t.totalGastado, 0);
  assert.equal(d.movimientos.find((m) => m.nombre === "Ayuda familiar").origen, "manual");
});
test("lo confirmado aparece también en la pestaña Semestres (mismo movimiento, dos vistas)", () => {
  const d = vacio(); matricula(d);
  confirmarCompromiso(d, d.compromisos[0].id, { fecha: "2026-01-31" });
  const registro = construirRegistroDesdeMovimientos(d, "sem1");
  assert.equal(registro.pagos_matricula.length, 1);
  assert.equal(registro.pagos_matricula[0].monto, 25000);
});

console.log("Deshacer, omitir, reabrir, eliminar");
test("deshacer revierte totales, deja tumba y el compromiso vuelve a pendiente", () => {
  const d = vacio(); matricula(d);
  const id = d.compromisos[0].id;
  confirmarCompromiso(d, id, { fecha: "2026-01-31" });
  assert.equal(deshacerConfirmacion(d, id), true);
  assert.equal(movs(d).length, 0);
  assert.equal(calcularTotalesMovimientos(d).totalGastado, 0);
  assert.ok(d._eliminados_movimientos.some((t) => t.id === "mov_" + id));
  assert.equal(d.compromisos[0].estado, "pendiente"); assert.equal(d.compromisos[0].movimiento_id, null);
  assert.equal(deshacerConfirmacion(d, id), false);
});
test("confirmar de nuevo tras deshacer usa un id nuevo (la tumba mataría al determinista) y sigue siendo uno solo", () => {
  const d = vacio(); matricula(d);
  const id = d.compromisos[0].id;
  confirmarCompromiso(d, id); deshacerConfirmacion(d, id);
  const r = confirmarCompromiso(d, id);
  assert.equal(r.movimiento.id, `mov_${id}_r1`);
  deshacerConfirmacion(d, id);
  assert.equal(confirmarCompromiso(d, id).movimiento.id, `mov_${id}_r2`);
  assert.equal(movs(d).length, 1);
  confirmarCompromiso(d, id);
  assert.equal(movs(d).length, 1);
});
test("si el movimiento se borra a mano, el compromiso lo dice y se puede reabrir; nunca queda un pago sin vínculo", () => {
  const d = vacio(); matricula(d);
  const c = d.compromisos[0];
  const r = confirmarCompromiso(d, c.id);
  assert.equal(reabrirCompromiso(d, c.id), false, "con el movimiento vivo no se reabre");
  quitarMovimiento(d, r.movimiento.id);
  assert.equal(estadoVisibleCompromiso(c, d), "sin_movimiento");
  assert.equal(confirmarCompromiso(d, c.id).motivo, "sin_movimiento");
  assert.equal(reabrirCompromiso(d, c.id), true);
  assert.equal(confirmarCompromiso(d, c.id).ok, true);
  assert.equal(movs(d).length, 1);
});
test("omitir solo aplica a pendientes, no crea movimiento, y se puede reabrir o confirmar después", () => {
  const d = vacio(); matricula(d);
  const [a, b] = d.compromisos;
  assert.equal(omitirCompromiso(d, a.id), true);
  assert.equal(omitirCompromiso(d, a.id), false);
  assert.equal(d.movimientos.length, 0);
  assert.equal(estadoVisibleCompromiso(a, d), "omitido");
  assert.equal(reabrirCompromiso(d, a.id), true);
  confirmarCompromiso(d, b.id);
  assert.equal(omitirCompromiso(d, b.id), false, "un cumplido no se omite");
  omitirCompromiso(d, a.id);
  assert.equal(confirmarCompromiso(d, a.id).ok, true, "un omitido se puede confirmar");
});
test("eliminar un compromiso confirmado deja el movimiento (es un pago real) y su tumba; doble eliminación no duplica", () => {
  const d = vacio(); matricula(d);
  const id = d.compromisos[0].id;
  confirmarCompromiso(d, id);
  assert.equal(eliminarCompromiso(d, id), true);
  assert.equal(eliminarCompromiso(d, id), false);
  assert.equal(movs(d).length, 1);
  assert.equal(d._eliminados_compromisos.filter((t) => t.id === id).length, 1);
  assert.equal(calcularTotalesMovimientos(d).totalGastado, 25000);
});
test("editar: solo pendientes u omitidos; valida monto y fecha; un cumplido se rechaza", () => {
  const d = vacio(); matricula(d);
  const [a, b] = d.compromisos;
  assert.equal(editarCompromiso(d, a.id, { monto: "30000", nombre: " Primera ", fechaPrevista: "2026-02-10", afectaSaldo: true }).ok, true);
  assert.equal(a.monto, 30000); assert.equal(a.nombre, "Primera"); assert.equal(a.fecha_prevista, "2026-02-10"); assert.equal(a.afecta_saldo, true);
  assert.equal(editarCompromiso(d, a.id, { monto: 0 }).motivo, "monto");
  assert.equal(editarCompromiso(d, a.id, { fechaPrevista: "xx" }).motivo, "fecha");
  assert.equal(editarCompromiso(d, a.id, { fechaPrevista: "" }).ok, true);
  assert.equal(a.fecha_prevista, null);
  confirmarCompromiso(d, b.id);
  assert.equal(editarCompromiso(d, b.id, { monto: 1 }).motivo, "cumplido");
});
test("reajustar una serie cambia solo los pendientes desde la fecha, nunca un cumplido ni un omitido", () => {
  const d = vacio();
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombreBase: "Beca", modo: "por_pago", monto: 300000, cantidad: 5, fechaPrimera: "2026-02-01" });
  const [c1, c2, c3, c4, c5] = d.compromisos;
  confirmarCompromiso(d, c1.id); omitirCompromiso(d, c2.id);
  const n = reajustarSerie(d, c1.serie_id, 320000, "2026-04-01");
  assert.equal(n, 3); // c3 (1 abr, la fecha límite cuenta), c4 y c5
  assert.deepEqual([c1.monto, c2.monto, c3.monto, c4.monto, c5.monto], [300000, 300000, 320000, 320000, 320000]);
});
test("reajustar sin fecha cambia todos los pendientes; un monto inválido no cambia nada", () => {
  const d = vacio(); matricula(d);
  assert.equal(reajustarSerie(d, d.compromisos[0].serie_id, 0), 0);
  assert.equal(reajustarSerie(d, d.compromisos[0].serie_id, 30000), 4);
  assert.equal(reajustarSerie(d, d.compromisos[0].serie_id, 30000), 0, "repetirlo no cambia nada");
});

console.log("Visibilidad y derivados");
test("apagar un módulo oculta sus compromisos sin borrarlos; encenderlo los devuelve", () => {
  const d = vacio(); matricula(d);
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombreBase: "Beca", modo: "por_pago", monto: 1000, cantidad: 1 });
  generarCuotas(d, { tipo: "ingreso_esperado", subtipo: "trabajo", nombreBase: "Trabajo", modo: "por_pago", monto: 1000, cantidad: 1 });
  assert.equal(obtenerCompromisosVisibles(d).length, 6);
  aplicarModulosFinanzas(d, { matricula: false });
  assert.equal(obtenerCompromisosVisibles(d).length, 2);
  aplicarModulosFinanzas(d, { beca: false, gastos: false });
  assert.equal(obtenerCompromisosVisibles(d).length, 0);
  assert.equal(d.compromisos.length, 6);
  aplicarModulosFinanzas(d, { matricula: true, beca: true, gastos: true });
  assert.equal(obtenerCompromisosVisibles(d).length, 6);
});
test("un compromiso de un semestre borrado no se ve (como los movimientos), pero sigue en los datos", () => {
  const d = vacio(); matricula(d);
  d.semestres = d.semestres.filter((s) => s.id !== "sem1");
  assert.equal(obtenerCompromisosVisibles(d).length, 0);
  assert.equal(d.compromisos.length, 4);
});
test("estado visible: pendiente, vencido (con fecha pasada), cumplido, omitido", () => {
  const d = vacio();
  const pasado = crearCompromiso({ tipo: "matricula", nombre: "a", monto: 10, fechaPrevista: "2020-01-01", semestreId: "sem1" });
  const futuro = crearCompromiso({ tipo: "matricula", nombre: "b", monto: 10, fechaPrevista: "2999-01-01", semestreId: "sem1" });
  const sinFecha = crearCompromiso({ tipo: "matricula", nombre: "c", monto: 10, semestreId: "sem1" });
  d.compromisos.push(pasado, futuro, sinFecha);
  assert.equal(estadoVisibleCompromiso(pasado, d), "vencido");
  assert.equal(estadoVisibleCompromiso(futuro, d), "pendiente");
  assert.equal(estadoVisibleCompromiso(sinFecha, d), "pendiente");
  confirmarCompromiso(d, pasado.id); assert.equal(estadoVisibleCompromiso(pasado, d), "cumplido");
});
test("resumen: confirmado usa lo realmente pagado, pendiente lo que falta, vencidos se cuentan; omitidos no suman", () => {
  const d = vacio();
  const a = crearCompromiso({ tipo: "matricula", nombre: "a", monto: 100, fechaPrevista: "2020-01-01", semestreId: "sem1" });
  const b = crearCompromiso({ tipo: "matricula", nombre: "b", monto: 200, fechaPrevista: "2999-01-01", semestreId: "sem1" });
  const c = crearCompromiso({ tipo: "matricula", nombre: "c", monto: 400, semestreId: "sem1" });
  const e = crearCompromiso({ tipo: "matricula", nombre: "e", monto: 800, semestreId: "sem1" });
  d.compromisos.push(a, b, c, e);
  confirmarCompromiso(d, a.id, { monto: 90 }); omitirCompromiso(d, e.id);
  assert.deepEqual(resumirCompromisos(d.compromisos, d), { confirmado: 90, pendiente: 600, vencidos: 0 });
  const f = crearCompromiso({ tipo: "matricula", nombre: "f", monto: 50, fechaPrevista: "2020-02-01", semestreId: "sem1" });
  d.compromisos.push(f);
  assert.deepEqual(resumirCompromisos(d.compromisos, d), { confirmado: 90, pendiente: 650, vencidos: 1 });
});
test("orden: por fecha, sin fecha al final, y 'Cuota 2' antes de 'Cuota 10'", () => {
  const mk = (nombre, f) => crearCompromiso({ tipo: "matricula", nombre, monto: 1, fechaPrevista: f, semestreId: "sem1" });
  const orden = ordenarCompromisos([mk("Cuota 10", "2026-05-01"), mk("sin", null), mk("Cuota 2", "2026-05-01"), mk("antes", "2026-01-01")]);
  assert.deepEqual(orden.map((c) => c.nombre), ["antes", "Cuota 2", "Cuota 10", "sin"]);
});
test("pestaña Plan solo con Matrícula o Beca", () => {
  assert.ok(pestanasVisiblesFinanzas({ beca: true }).includes("plan"));
  assert.ok(!pestanasVisiblesFinanzas({ gastos: true, ahorros: true }).includes("plan"));
});

console.log("Migración: no toca lo que ya existe");
test("deja movimientos y metas exactamente iguales, crea las colecciones nuevas y el flag; correrla dos veces no cambia nada", () => {
  const d = { configuracion: {}, movimientos: [crearMovimiento({ tipo: "gasto", nombre: "pasaje", monto: 500, fechaRegistro: "2026-01-02" })], metas: [crearMeta({ nombre: "Laptop", objetivo: 1000, saldoInicial: 50 })] };
  const antes = JSON.stringify({ m: d.movimientos, t: d.metas });
  assert.equal(migrarFinanzas2V1(d), true);
  assert.equal(JSON.stringify({ m: d.movimientos, t: d.metas }), antes);
  assert.deepEqual(d.compromisos, []); assert.deepEqual(d._eliminados_compromisos, []);
  assert.equal(d.configuracion[FLAG_MIGRACION_FINANZAS2], true);
  const foto = JSON.stringify(d);
  assert.equal(migrarFinanzas2V1(d), false);
  assert.equal(JSON.stringify(d), foto);
});
test("no pisa compromisos que ya existen", () => {
  const d = vacio(); matricula(d);
  const foto = JSON.stringify(d.compromisos);
  migrarFinanzas2V1(d);
  assert.equal(JSON.stringify(d.compromisos), foto);
});
test("datos en la forma vieja (gastos_u y finanzas_semestre): la migración completa deja los mismos movimientos de siempre y solo suma lo nuevo", () => {
  const viejo = () => ({
    configuracion: {}, perfil: {}, planes_estudio: [], profesores: [], companeros: [], agenda: [],
    semestres: [{ id: "s1", plan_estudio_id: null, nombre: "I", fecha_inicio: "2026-01-12" }],
    gastos_u: [{ id: "g1", nombre: "Carné", tipo: "gasto", costo: 3000, semestre_id: "s1" }],
    finanzas_semestre: [{ id: "f1", semestre_id: "s1", pagos_matricula: [{ id: "p1", descripcion: "Pago", monto: 7000, fecha: "2026-01-20" }], ingresos_beca: [{ id: "b1", descripcion: "Beca", monto: 9000, fecha: "2026-02-01" }] }],
  });
  const a = migrarDatosAntiguos(viejo());
  const idsAntes = a.movimientos.map((m) => m.id).sort();
  assert.deepEqual(idsAntes, ["mov_b1", "mov_g1", "mov_p1"]);
  assert.deepEqual(a.compromisos, []);
  assert.equal(a.configuracion[FLAG_MIGRACION_FINANZAS2], true);
  const foto = JSON.stringify(a);
  migrarDatosAntiguos(a);
  assert.equal(JSON.stringify(a), foto, "segunda corrida sin cambios");
  assert.equal(a.gastos_u.length, 1); assert.equal(a.finanzas_semestre.length, 1); // los arreglos viejos siguen intactos
});

console.log(`\n${ok} pruebas OK`);
