// Pruebas de lógica de la sesión 4 (Node, sin DOM): metas con fecha, aporte sugerido, fecha estimada y aporte programado en Disponible.
import assert from "node:assert/strict";
import { crearMeta, crearMovimiento } from "../js/core/finanzas/finanzas-modelo.js";
import { aplicarModulosFinanzas } from "../js/core/finanzas/finanzas-perfiles.js";
import { ajustarSaldo } from "../js/core/finanzas/finanzas-registro.js";
import { calcularSaldoMeta, calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { calcularDisponible, listarProximos, sumarDias } from "../js/core/finanzas/finanzas-disponible.js";
import { calcularRitmoMeta, configurarPlanMeta, listarAportesProgramados, resumirMeta } from "../js/core/finanzas/finanzas-metas-plan.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const vacio = () => ({ configuracion: {}, semestres: [], movimientos: [], metas: [], compromisos: [], _eliminados_movimientos: [], _eliminados_compromisos: [] });
const conMeta = (extra = {}) => { const d = vacio(); ajustarSaldo(d, { saldoReal: 100000, saldoInicial: true, fecha: "2026-09-01" }); const m = crearMeta({ nombre: "Laptop", objetivo: 60000, ...extra }); d.metas.push(m); return { d, m }; };
const aporte = (d, m, fecha, monto, extra = {}) => d.movimientos.push(crearMovimiento({ tipo: "ahorro", nombre: "Aporte", monto, fechaRegistro: fecha, metaId: m.id, fuente: "liquido", ...extra }));

console.log("Configurar el plan");
test("fecha y aporte se guardan, se sellan y se pueden quitar", () => {
  const { d, m } = conMeta(); const antes = m._actualizadoEn;
  const r = configurarPlanMeta(d, m.id, { fechaObjetivo: "2027-03-01", aporte: { monto: 5000, frecuencia: "mensual", fechaInicio: "2026-11-01" } });
  assert.equal(r.ok, true); assert.equal(m.fecha_objetivo, "2027-03-01"); assert.deepEqual(m.aporte_programado, { monto: 5000, frecuencia: "mensual", fecha_inicio: "2026-11-01" });
  assert.ok(m._actualizadoEn > antes);
  configurarPlanMeta(d, m.id, { aporte: null }); assert.equal(m.aporte_programado, null); assert.equal(m.fecha_objetivo, "2027-03-01");
  configurarPlanMeta(d, m.id, { fechaObjetivo: null }); assert.equal(m.fecha_objetivo, null);
});
test("datos inválidos no cambian nada", () => {
  const { d, m } = conMeta(); const antes = JSON.stringify(m);
  assert.equal(configurarPlanMeta(d, "no", {}).motivo, "meta");
  assert.equal(configurarPlanMeta(d, m.id, { fechaObjetivo: "2027-02-30" }).motivo, "fecha");
  assert.equal(configurarPlanMeta(d, m.id, { aporte: { monto: 0, frecuencia: "mensual", fechaInicio: HOY } }).motivo, "monto");
  assert.equal(configurarPlanMeta(d, m.id, { aporte: { monto: 5, frecuencia: "diaria", fechaInicio: HOY } }).motivo, "frecuencia");
  assert.equal(configurarPlanMeta(d, m.id, { aporte: { monto: 5, frecuencia: "semanal", fechaInicio: "x" } }).motivo, "inicio");
  assert.equal(JSON.stringify(m), antes);
});

console.log("Resumen de la meta");
test("aporte sugerido: lo que falta entre las semanas o meses que quedan", () => {
  const { d, m } = conMeta({ fechaObjetivo: "2026-12-23" }); // 60 días
  const r = resumirMeta(d, m, HOY);
  assert.equal(r.falta, 60000); assert.equal(r.diasRestantes, 60);
  assert.equal(r.sugerido.semanal, 6666.67); // 60.000 / 9 semanas, a centavos
  assert.equal(r.sugerido.mensual, 30000);     // 2 meses
  assert.equal(r.nivel, "sin_ritmo");
});
test("el progreso refleja dinero real: un aporte baja lo que falta y el sugerido", () => {
  const { d, m } = conMeta({ fechaObjetivo: "2026-12-23" });
  const antes = resumirMeta(d, m, HOY).sugerido.mensual;
  aporte(d, m, "2026-10-20", 20000);
  const r = resumirMeta(d, m, HOY);
  assert.equal(r.saldo, 20000); assert.equal(r.falta, 40000); assert.equal(r.porcentaje, 33); assert.ok(r.sugerido.mensual < antes);
});
test("ritmo real: necesita 2 aportes y 14 días; el estimado cambia al aportar", () => {
  const { d, m } = conMeta();
  aporte(d, m, "2026-10-23", 5000); assert.equal(calcularRitmoMeta(d, m.id, HOY), null);
  aporte(d, m, "2026-10-24", 5000); assert.equal(calcularRitmoMeta(d, m.id, HOY), null); // solo 2 días de historia
  const { d: d2, m: m2 } = conMeta();
  aporte(d2, m2, "2026-09-24", 10000); aporte(d2, m2, "2026-10-14", 10000);
  const r1 = resumirMeta(d2, m2, HOY); // ventana 31 días, 20.000 → 645,16/día; faltan 40.000 → 63 días
  assert.equal(r1.ritmo.ventana, 31); assert.equal(r1.estimada.dias, Math.ceil(40000 / (20000 / 31))); assert.equal(r1.estimada.base, "real");
  aporte(d2, m2, "2026-10-24", 20000);
  assert.ok(resumirMeta(d2, m2, HOY).estimada.dias < r1.estimada.dias);
});
test("niveles con texto: al día, cerca, por detrás, pasada y lograda", () => {
  const base = () => { const x = conMeta({ fechaObjetivo: "2026-12-23" }); aporte(x.d, x.m, "2026-09-24", 10000); aporte(x.d, x.m, "2026-10-14", 10000); return x; };
  // saldo 20.000, ritmo 645,16/día, falta 40.000, quedan 60 días → necesario 666,67/día → 97 % → cerca
  let { d, m } = base(); assert.equal(resumirMeta(d, m, HOY).nivel, "cerca");
  m.objetivo = 50000; assert.equal(resumirMeta(d, m, HOY).nivel, "al_dia"); // necesario 500
  m.objetivo = 200000; assert.equal(resumirMeta(d, m, HOY).nivel, "por_detras");
  m.fecha_objetivo = "2026-10-01"; assert.equal(resumirMeta(d, m, HOY).nivel, "pasada");
  m.objetivo = 15000; assert.equal(resumirMeta(d, m, HOY).nivel, "lograda");
  ["cerca", "al_dia", "por_detras", "pasada", "lograda"].forEach(() => {});
  assert.ok(resumirMeta(d, m, HOY).texto.length > 5);
});
test("sin fecha objetivo: se puede estimar pero no hay aporte sugerido", () => {
  const { d, m } = conMeta(); aporte(d, m, "2026-09-24", 10000); aporte(d, m, "2026-10-14", 10000);
  const r = resumirMeta(d, m, HOY); assert.equal(r.nivel, "sin_fecha"); assert.equal(r.sugerido, null); assert.ok(r.estimada.fecha);
});
test("retiros de la meta restan del ritmo; ritmo neto no positivo da null", () => {
  const { d, m } = conMeta();
  aporte(d, m, "2026-09-24", 1000); aporte(d, m, "2026-10-10", 1000);
  d.movimientos.push(crearMovimiento({ tipo: "transferencia", nombre: "Retiro", monto: 5000, fechaRegistro: "2026-10-12", metaId: m.id, sentido: "desde_meta" }));
  assert.equal(calcularRitmoMeta(d, m.id, HOY), null);
});
test("el saldo de la meta no cambia por planificar: sigue saliendo solo de movimientos", () => {
  const { d, m } = conMeta({ fechaObjetivo: "2027-01-01" }); aporte(d, m, "2026-10-01", 7000);
  const antes = calcularSaldoMeta(m, d, HOY);
  configurarPlanMeta(d, m.id, { aporte: { monto: 999, frecuencia: "semanal", fechaInicio: HOY } });
  assert.equal(calcularSaldoMeta(m, d, HOY), antes);
});

console.log("Aporte programado en Disponible");
test("resta los aportes que caen en el horizonte y el desglose suma la cifra", () => {
  const { d, m } = conMeta(); configurarPlanMeta(d, m.id, { aporte: { monto: 2000, frecuencia: "semanal", fechaInicio: "2026-10-26" } });
  const r = calcularDisponible(d, { hoy: HOY }); // 26 oct, 2 nov, 9 nov, 16 nov, 23 nov = 5 aportes (el 23 nov es el día 30)
  assert.equal(r.terminos.find((x) => x.id === "metas").monto, -10000);
  assert.equal(r.disponible, 90000); assert.equal(r.terminos.reduce((t, x) => t + x.monto, 0), r.disponible);
  assert.equal(r.proximos.filter((p) => p.fuente === "meta").length, 5);
});
test("el aporte de hoy cuenta, salvo que ya hayas aportado hoy a esa meta", () => {
  const { d, m } = conMeta(); configurarPlanMeta(d, m.id, { aporte: { monto: 1000, frecuencia: "mensual", fechaInicio: HOY } });
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 99000);
  aporte(d, m, HOY, 1000); // el aporte real baja Mi dinero y el plan de hoy ya no se resta otra vez
  assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 99000);
});
test("no crea movimientos ni toca datos", () => {
  const { d, m } = conMeta(); configurarPlanMeta(d, m.id, { aporte: { monto: 1000, frecuencia: "quincenal", fechaInicio: HOY } });
  const antes = JSON.stringify(d); calcularDisponible(d, { hoy: HOY }); listarProximos(d, { hoy: HOY }); resumirMeta(d, m, HOY);
  assert.equal(JSON.stringify(d), antes);
});
test("Ahorros apagado, meta archivada o Solo ahorro: el aporte no entra", () => {
  const { d, m } = conMeta(); configurarPlanMeta(d, m.id, { aporte: { monto: 1000, frecuencia: "semanal", fechaInicio: HOY } });
  const con = calcularDisponible(d, { hoy: HOY }).disponible;
  m.archivada = true; assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 100000); m.archivada = false;
  aplicarModulosFinanzas(d, { ahorros: false }); assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 100000); assert.equal(listarAportesProgramados(d).length, 0);
  aplicarModulosFinanzas(d, { ahorros: true }); assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, con);
  aplicarModulosFinanzas(d, { matricula: false, beca: false, gastos: false, ahorros: true }); assert.equal(calcularDisponible(d, { hoy: HOY }).aplica, false);
});
test("un plan roto (sin monto o con frecuencia rara) se ignora sin romper", () => {
  const { d, m } = conMeta(); m.aporte_programado = { monto: 0, frecuencia: "semanal", fecha_inicio: HOY };
  assert.equal(listarAportesProgramados(d).length, 0);
  m.aporte_programado = { monto: 10, frecuencia: "diaria", fecha_inicio: HOY }; assert.equal(listarAportesProgramados(d).length, 0);
  m.aporte_programado = { monto: 10, frecuencia: "mensual", fecha_inicio: "mal" }; assert.equal(calcularDisponible(d, { hoy: HOY }).disponible, 100000);
});
test("el semáforo cuenta los aportes como comprometidos (ámbar cuando casi no queda margen)", () => {
  const { d, m } = conMeta(); configurarPlanMeta(d, m.id, { aporte: { monto: 20000, frecuencia: "semanal", fechaInicio: sumarDias(HOY, 1) } });
  const r = calcularDisponible(d, { hoy: HOY }); // 5 aportes de 20.000 = 100.000 → disponible 0
  assert.equal(r.disponible, 0); assert.equal(r.semaforo.nivel, "ambar");
});
test("el saldo del Resumen no cambia con el plan", () => {
  const { d, m } = conMeta(); const antes = calcularTotalesMovimientos(d, HOY).saldoLiquido;
  configurarPlanMeta(d, m.id, { aporte: { monto: 20000, frecuencia: "semanal", fechaInicio: HOY } });
  assert.equal(calcularTotalesMovimientos(d, HOY).saldoLiquido, antes);
});
console.log(`\n${ok} pruebas de lógica OK`);
