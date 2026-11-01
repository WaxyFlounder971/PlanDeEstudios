// Pruebas de lógica de la sesión 3 (Node, sin DOM): Disponible, Próximos, horizonte, semáforo y ritmo.
import assert from "node:assert/strict";
import { crearMovimiento } from "../js/core/finanzas/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { aplicarModulosFinanzas } from "../js/core/finanzas/finanzas-perfiles.js";
import { ajustarSaldo } from "../js/core/finanzas/finanzas-registro.js";
import { confirmarCompromiso, crearCompromiso, generarCuotas, omitirCompromiso } from "../js/core/finanzas/finanzas-compromisos.js";
import {
  calcularDisponible, calcularRitmoDiario, calcularSemaforo, esDiaDePago, fijarHorizonteDias, listarProximos,
  obtenerHorizonteDias, ocurrenciasRecurrente, sumarDias,
} from "../js/core/finanzas/finanzas-disponible.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const vacio = () => ({ configuracion: {}, semestres: [{ id: "sem1", nombre: "II Semestre" }], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [], compromisos: [], _eliminados_movimientos: [], _eliminados_compromisos: [] });
const conSaldo = (d, monto) => { ajustarSaldo(d, { saldoReal: monto, saldoInicial: true, fecha: "2026-10-01" }); return d; };
const cuota = (d, extra) => { const c = crearCompromiso({ tipo: "matricula", semestreId: "sem1", nombre: "Cuota", monto: 1000, fechaPrevista: "2026-11-01", ...extra }); d.compromisos.push(c); return c; };
const rec = (d, extra = {}, rexta = {}) => { const m = crearMovimiento({ tipo: "gasto", nombre: "Internet", monto: 0, fechaRegistro: "2026-01-05", recurrente: { frecuencia: "mensual", monto_por_pago: 300, fecha_inicio: "2026-01-05", fecha_fin: null, personalizado: null, ...rexta }, ...extra }); d.movimientos.push(m); return m; };

console.log("Fechas y recurrentes");
test("sumarDias cruza mes y año", () => {
  assert.equal(sumarDias("2026-12-30", 3), "2027-01-02");
  assert.equal(sumarDias("2026-03-01", -1), "2026-02-28");
});
test("mensual conserva el día ancla y usa el último día en meses cortos", () => {
  const r = { frecuencia: "mensual", fecha_inicio: "2026-01-31" };
  assert.deepEqual(ocurrenciasRecurrente(r, "2026-01-31", "2026-04-30"), ["2026-02-28", "2026-03-31", "2026-04-30"]);
});
test("semanal, quincenal y anual", () => {
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "semanal", fecha_inicio: "2026-10-01" }, HOY, "2026-11-10"), ["2026-10-29", "2026-11-05"]);
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "quincenal", fecha_inicio: "2026-10-01" }, HOY, "2026-11-30"), ["2026-10-29", "2026-11-12", "2026-11-26"]);
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "anual", fecha_inicio: "2025-12-15" }, HOY, "2027-01-01"), ["2026-12-15"]);
});
test("personalizado: diario, días específicos y cada N días", () => {
  assert.equal(ocurrenciasRecurrente({ frecuencia: "personalizado", fecha_inicio: "2026-10-01", personalizado: { modo: "diario" } }, HOY, "2026-10-27").length, 3);
  // 2026-10-26 es lunes (1); 10-28 miércoles (3)
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "personalizado", fecha_inicio: "2026-10-01", personalizado: { modo: "dias_semana", dias_semana: [1, 3] } }, HOY, "2026-10-31"), ["2026-10-26", "2026-10-28"]);
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "personalizado", fecha_inicio: "2026-10-20", personalizado: { modo: "cada_n_dias", cada_n_dias: 3 } }, HOY, "2026-11-02"), ["2026-10-26", "2026-10-29", "2026-11-01"]);
});
test("respeta fecha de inicio futura y fecha de fin; datos incompletos no rompen", () => {
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "mensual", fecha_inicio: "2026-11-10" }, HOY, "2026-12-31"), ["2026-11-10", "2026-12-10"]);
  assert.deepEqual(ocurrenciasRecurrente({ frecuencia: "mensual", fecha_inicio: "2026-01-05", fecha_fin: "2026-11-30" }, HOY, "2027-03-01"), ["2026-11-05"]);
  assert.equal(esDiaDePago({ frecuencia: "mensual", fecha_inicio: null }, HOY), false);
  assert.equal(esDiaDePago({ frecuencia: "rara", fecha_inicio: "2026-01-01" }, HOY), false);
  assert.equal(esDiaDePago({ frecuencia: "personalizado", fecha_inicio: "2026-01-01", personalizado: { modo: "cada_n_dias", cada_n_dias: 0 } }, HOY), false);
});

console.log("Disponible");
test("sin Mi dinero (solo Ahorros) no aplica", () => {
  const d = vacio(); aplicarModulosFinanzas(d, { matricula: false, beca: false, gastos: false, ahorros: true });
  assert.equal(calcularDisponible(d, { hoy: HOY }).aplica, false);
});
test("sin compromisos, Disponible es Mi dinero y el semáforo es verde", () => {
  const d = conSaldo(vacio(), 50000);
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 50000); assert.equal(r.semaforo.nivel, "verde"); assert.equal(r.horizonte, 30);
});
test("cálculo a mano: saldo 100.000 − cuota que afecta (30.000) − recurrente x1 (300) + beca esperada (20.000) = 89.700", () => {
  const d = conSaldo(vacio(), 100000);
  cuota(d, { monto: 30000, afectaSaldo: true, fechaPrevista: "2026-11-01" });
  rec(d, {}, { fecha_inicio: "2026-11-05" }); // primer pago el 5 de nov (sin pagos anteriores ya descontados de Mi dinero)
  d.compromisos.push(crearCompromiso({ tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombre: "Desembolso", monto: 20000, fechaPrevista: "2026-11-10" }));
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 89700);
  assert.equal(r.terminos.reduce((t, x) => t + x.monto, 0), r.disponible); // el desglose suma la cifra
});
test("la matrícula sin 'Afecta mi saldo' se muestra pero no resta", () => {
  const d = conSaldo(vacio(), 100000); cuota(d, { monto: 30000, afectaSaldo: false });
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 100000); assert.equal(r.informativos.length, 1); assert.equal(listarProximos(d, { hoy: HOY }).length, 1);
});
test("horizonte: lo que cae después del límite no entra; 7 días vs 30 vs 90", () => {
  const d = conSaldo(vacio(), 100000); cuota(d, { monto: 10000, afectaSaldo: true, fechaPrevista: "2026-12-10" }); // +47 días
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 100000);
  assert.equal(calcularDisponible(d, { hoy: HOY, horizonteDias: 60 }).disponible, 90000);
  assert.equal(calcularDisponible(d, { hoy: HOY, horizonteDias: 7 }).disponible, 100000);
  const r = calcularDisponible(d, { hoy: HOY, horizonteDias: 60 }); assert.equal(r.hasta, "2026-12-23");
});
test("el límite es inclusivo: justo en el último día cuenta", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 100, afectaSaldo: true, fechaPrevista: "2026-11-23" });
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 900);
});
test("vencidos siguen restando; un desembolso vencido no suma", () => {
  const d = conSaldo(vacio(), 100000);
  cuota(d, { monto: 5000, afectaSaldo: true, fechaPrevista: "2026-10-01" });
  d.compromisos.push(crearCompromiso({ tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombre: "Atrasado", monto: 9000, fechaPrevista: "2026-10-01" }));
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 95000);
  assert.equal(r.proximos.filter((p) => p.vencido).length, 2);
});
test("hoy cuenta como pendiente (no vencido) y entra en el horizonte", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 100, afectaSaldo: true, fechaPrevista: HOY });
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 900); assert.equal(r.proximos[0].vencido, false);
});
test("confirmar u omitir un compromiso lo saca de Disponible (sin doble descuento)", () => {
  const d = conSaldo(vacio(), 100000); const c = cuota(d, { monto: 30000, afectaSaldo: true, fechaPrevista: HOY });
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 70000);
  confirmarCompromiso(d, c.id, { fecha: HOY });
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 70000); // ahora el dinero salió de Mi dinero: mismo resultado, sin restar dos veces
  const e = cuota(d, { monto: 5000, afectaSaldo: true });
  omitirCompromiso(d, e.id);
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 70000);
});
test("compromisos sin fecha no entran y se avisan", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 100, afectaSaldo: true, fechaPrevista: null });
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 1000); assert.equal(r.sinFecha, 1);
});
test("recurrentes: un ingreso recurrente se muestra pero no suma; un gasto pagado con una meta no resta", () => {
  const d = conSaldo(vacio(), 10000);
  rec(d, { tipo: "ingreso", nombre: "Trabajo" }, { frecuencia: "semanal", monto_por_pago: 500, fecha_inicio: "2026-10-25" });
  rec(d, { pagadoConMetaId: "meta_x", nombre: "Suscripción" });
  const r = calcularDisponible(d, { hoy: HOY });
  assert.equal(r.disponible, 10000); assert.ok(r.proximos.length >= 5); assert.ok(r.proximos.every((p) => !p.cuenta));
});
test("recurrente con inicio futuro cuenta; con fecha de fin pasada no", () => {
  const d = conSaldo(vacio(), 10000);
  rec(d, { nombre: "Nuevo" }, { fecha_inicio: "2026-11-02", monto_por_pago: 400 });
  rec(d, { nombre: "Viejo" }, { fecha_inicio: "2026-01-05", fecha_fin: "2026-09-30", monto_por_pago: 999 });
  // Lo que "Viejo" ya cobró antes de su fecha de fin ya está fuera de Mi dinero (lo cuenta schema.js); hacia adelante no resta nada.
  const r = calcularDisponible(d, { hoy: HOY });
  const saldo = r.terminos.find((t) => t.id === "saldo").monto;
  assert.equal(r.disponible, saldo - 400);
  assert.ok(!r.proximos.some((p) => p.nombre === "Viejo"));
});
test("módulos apagados: Gastos apagado oculta los recurrentes; Matrícula apagada oculta sus cuotas; Beca apagada oculta la beca esperada", () => {
  const d = conSaldo(vacio(), 100000);
  cuota(d, { monto: 30000, afectaSaldo: true }); rec(d);
  d.compromisos.push(crearCompromiso({ tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombre: "B", monto: 20000, fechaPrevista: "2026-11-10" }));
  const todo = calcularDisponible(d, { hoy: HOY }).disponible;
  aplicarModulosFinanzas(d, { matricula: false });
  const sinMatricula = calcularDisponible(d, { hoy: HOY }).disponible;
  assert.equal(sinMatricula - todo, 30000);
  aplicarModulosFinanzas(d, { beca: false, gastos: false });
  assert.equal(calcularDisponible(d, { hoy: HOY }).aplica, false); // sin Mi dinero
  aplicarModulosFinanzas(d, { matricula: true, beca: false, gastos: false, ahorros: false });
  const r = calcularDisponible(d, { hoy: HOY });
  assert.ok(r.proximos.every((p) => p.fuente === "compromiso" && p.sentido === "sale"));
});
test("semestre eliminado: sus cuotas no cuentan", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 500, afectaSaldo: true }); d.semestres = [];
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 1000);
});
test("el ajuste de saldo y los datos viejos no cambian: Disponible no escribe nada", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 100, afectaSaldo: true });
  const antes = JSON.stringify(d); calcularDisponible(d, { hoy: HOY }); listarProximos(d, { hoy: HOY });
  assert.equal(JSON.stringify(d), antes);
});
test("Disponible usa el mismo saldo que el Resumen (calcularTotalesMovimientos)", () => {
  const d = conSaldo(vacio(), 12345);
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "x", monto: 345, fechaRegistro: "2026-10-10" }));
  assert.equal(calcularDisponible(d, { hoy: HOY }).saldoLiquido, calcularTotalesMovimientos(d, HOY).saldoLiquido);
});

console.log("Semáforo, ritmo y horizonte");
test("semáforo: verde, ámbar (≤25 % o justo en cero) y rojo, siempre con texto", () => {
  assert.equal(calcularSemaforo({ disponible: 800, saldoLiquido: 1000, comprometido: 100 }).nivel, "verde");
  assert.equal(calcularSemaforo({ disponible: 200, saldoLiquido: 1000, comprometido: 800 }).nivel, "ambar");
  assert.equal(calcularSemaforo({ disponible: 0, saldoLiquido: 1000, comprometido: 1000 }).nivel, "ambar");
  assert.equal(calcularSemaforo({ disponible: -1, saldoLiquido: 1000, comprometido: 1001 }).nivel, "rojo");
  assert.ok(["verde", "ambar", "rojo"].every((n, i) => calcularSemaforo({ disponible: [800, 0, -5][i], saldoLiquido: 1000, comprometido: 100 }).texto.length > 5));
});
test("ritmo: promedio de gastos manuales de la ventana; sin 7 días de historia no hay cifra", () => {
  const d = conSaldo(vacio(), 100000);
  assert.equal(calcularRitmoDiario(d, HOY), null);
  [["2026-10-05", 1000], ["2026-10-15", 2000], ["2026-10-20", 3000]].forEach(([f, m]) => d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "g", monto: m, fechaRegistro: f })));
  const r = calcularRitmoDiario(d, HOY);
  assert.equal(r.ventana, 20); assert.equal(r.diario, 300); // 6000 / 20 días (desde el 5 de oct)
});
test("ritmo: ignora recurrentes, matrícula y gastos pagados con meta", () => {
  const d = vacio();
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "a", monto: 100, fechaRegistro: "2026-10-01" }));
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "b", monto: 9999, fechaRegistro: "2026-10-02", origen: "matricula", semestreId: "sem1" }));
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "c", monto: 9999, fechaRegistro: "2026-10-03", pagadoConMetaId: "m" }));
  rec(d);
  assert.equal(calcularRitmoDiario(d, HOY).diario, Math.round(100 / 24 * 100) / 100);
});
test("alcance: 'te alcanza N días'; sin ritmo o sin saldo positivo no hay línea", () => {
  const d = conSaldo(vacio(), 3000);
  ["2026-10-01", "2026-10-10"].forEach((f) => d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "g", monto: 240, fechaRegistro: f })));
  const r = calcularDisponible(d, { hoy: HOY }); // ritmo = 480/24 = 20 → disponible 2520 / 20 = 126
  assert.equal(r.ritmo.diario, 20); assert.equal(r.alcance.dias, 126); assert.equal(r.alcance.hasta, sumarDias(HOY, 126));
  assert.equal(calcularDisponible(vacio(), { hoy: HOY }).aplica, true);
  assert.equal(calcularDisponible(conSaldo(vacio(), 100), { hoy: HOY }).alcance, null);
});
test("horizonte: 30 por defecto, valores válidos se guardan y los raros se ignoran", () => {
  const d = vacio();
  assert.equal(obtenerHorizonteDias(d), 30);
  assert.equal(fijarHorizonteDias(d, 60), true); assert.equal(obtenerHorizonteDias(d), 60);
  assert.equal(fijarHorizonteDias(d, 45), false); assert.equal(fijarHorizonteDias(d, "abc"), false); assert.equal(obtenerHorizonteDias(d), 60);
  d.configuracion.horizonte_disponible_dias = 999; assert.equal(obtenerHorizonteDias(d), 30);
});
test("Próximos ordena por fecha y mezcla cuotas y recurrentes", () => {
  const d = conSaldo(vacio(), 1000); cuota(d, { monto: 10, afectaSaldo: true, fechaPrevista: "2026-11-20" }); rec(d);
  const f = listarProximos(d, { hoy: HOY }).map((p) => p.fecha);
  assert.deepEqual(f, [...f].sort());
  assert.equal(listarProximos(d, { hoy: HOY, horizonteDias: 7 }).length, 0);
});
test("generador de cuotas del Plan alimenta Disponible", () => {
  const d = conSaldo(vacio(), 400000);
  generarCuotas(d, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 300000, cantidad: 3, fechaPrimera: "2026-10-30", frecuencia: "mensual", afectaSaldo: true });
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 300000); // 400.000 − 100.000 (30 oct) ; la del 30 nov queda fuera de 30 días
});

console.log(`\n${ok} pruebas de lógica OK`);
