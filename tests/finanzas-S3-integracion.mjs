// Integración de la sesión 3 con el proyecto real (corre DENTRO de tu proyecto, con el schema.js y storage-merge.js reales).
// La pieza crítica: los pagos recurrentes FUTUROS que cuenta Disponible deben seguir la misma regla que los pagos
// recurrentes PASADOS que ya cuenta Mi dinero (calcularPagosRecurrentesTranscurridos de schema.js).
import assert from "node:assert/strict";
import { calcularPagosRecurrentesTranscurridos } from "../js/core/schema.js";
import { fusionarDatos } from "../js/core/storage/storage-merge.js";
import { crearMovimiento, hoyIso } from "../js/core/finanzas/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { ajustarSaldo } from "../js/core/finanzas/finanzas-registro.js";
import { generarCuotas } from "../js/core/finanzas/finanzas-compromisos.js";
import { calcularDisponible, ocurrenciasRecurrente, sumarDias } from "../js/core/finanzas/finanzas-disponible.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = hoyIso();
const base = () => ({ configuracion: {}, perfil: {}, semestres: [{ id: "sem1", nombre: "I" }], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [], compromisos: [], _eliminados_movimientos: [], _eliminados_compromisos: [] });
const log = console.warn; console.warn = () => {};

const base1 = sumarDias(HOY, -100); // empezó hace 100 días
const casos = [
  { frecuencia: "semanal", fecha_inicio: base1 },
  { frecuencia: "quincenal", fecha_inicio: base1 },
  { frecuencia: "mensual", fecha_inicio: sumarDias(HOY, -75) },
  { frecuencia: "mensual", fecha_inicio: "2026-01-31" },
  { frecuencia: "anual", fecha_inicio: sumarDias(HOY, -400) },
  { frecuencia: "personalizado", fecha_inicio: base1, personalizado: { modo: "diario" } },
  { frecuencia: "personalizado", fecha_inicio: base1, personalizado: { modo: "dias_semana", dias_semana: [1, 3, 5] } },
  { frecuencia: "personalizado", fecha_inicio: base1, personalizado: { modo: "cada_n_dias", cada_n_dias: 4 } },
  { frecuencia: "semanal", fecha_inicio: base1, fecha_fin: sumarDias(HOY, -30) },
];

console.log("Paridad con calcularPagosRecurrentesTranscurridos (schema.js real)");
casos.forEach((c) => {
  test(`${c.frecuencia}${c.personalizado ? "/" + c.personalizado.modo : ""} desde ${c.fecha_inicio}${c.fecha_fin ? " hasta " + c.fecha_fin : ""}: mismos pagos hasta hoy`, () => {
    const rec = { monto_por_pago: 100, fecha_fin: null, personalizado: null, ...c };
    const real = calcularPagosRecurrentesTranscurridos(rec).cantidadPagos;
    const mio = ocurrenciasRecurrente(rec, sumarDias(c.fecha_inicio, -1), HOY).length;
    assert.equal(mio, real, `schema.js cuenta ${real} y finanzas-disponible.js cuenta ${mio}: hay que alinear esDiaDePago con schema.js`);
  });
});

console.log("Con los datos reales");
test("Disponible parte del mismo saldo que el Resumen y no modifica los datos", () => {
  const d = base(); ajustarSaldo(d, { saldoReal: 80000, saldoInicial: true, fecha: sumarDias(HOY, -30) });
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Internet", monto: 0, fechaRegistro: base1, recurrente: { frecuencia: "mensual", monto_por_pago: 5000, fecha_inicio: base1, fecha_fin: null, personalizado: null } }));
  generarCuotas(d, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 60000, cantidad: 3, fechaPrimera: sumarDias(HOY, 5), frecuencia: "mensual", afectaSaldo: true });
  const antes = JSON.stringify(d);
  const r = calcularDisponible(d);
  assert.equal(r.saldoLiquido, Math.round(calcularTotalesMovimientos(d).saldoLiquido * 100) / 100);
  assert.equal(r.terminos.reduce((t, x) => t + x.monto, 0), r.disponible);
  assert.equal(JSON.stringify(d), antes);
});
test("tras fusionar dos dispositivos, Disponible da lo mismo en ambos", () => {
  const a = base(); ajustarSaldo(a, { saldoReal: 50000, saldoInicial: true });
  generarCuotas(a, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 20000, cantidad: 2, fechaPrimera: sumarDias(HOY, 3), frecuencia: "quincenal", afectaSaldo: true });
  const b = JSON.parse(JSON.stringify(a));
  generarCuotas(b, { tipo: "ingreso_esperado", subtipo: "beca", semestreId: "sem1", nombreBase: "Desembolso", modo: "por_pago", monto: 8000, cantidad: 1, fechaPrimera: sumarDias(HOY, 9) });
  const ab = fusionarDatos(a, b), ba = fusionarDatos(b, a);
  assert.equal(calcularDisponible(ab).disponible, calcularDisponible(ba).disponible);
  assert.equal(calcularDisponible(ab).disponible, 50000 - 20000 + 8000 - 0); // las 2 cuotas de 10.000 caen dentro de 30 días (día 3 y 17)
});
console.warn = log;
console.log(`\n${ok} pruebas de integración OK`);
