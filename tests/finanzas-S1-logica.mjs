// Pruebas de lógica de la sesión 1 (Node, sin DOM): ajuste de saldo, registro rápido, plantillas, deshacer.
import assert from "node:assert/strict";
import { crearMeta, crearMovimiento, migrarFinanzasAMovimientos, hoyIso } from "../js/core/finanzas/finanzas-modelo.js";
import { calcularSaldoMeta, calcularTotalesMovimientos, movimientosVigentes } from "../js/core/finanzas/finanzas-derivados.js";
import { aplicarModulosFinanzas } from "../js/core/finanzas/finanzas-perfiles.js";
import { migrarDatosAntiguos } from "../js/core/schema.js";
import {
  ajustarSaldo, calcularDiferenciaSaldo, crearGuardReentrada, parsearMonto, plantillasRecientes,
  puedeAjustarSaldo, quitarMovimiento, registrarMovimientoRapido, tiposDisponiblesRegistroRapido, ultimoTipoUsado,
} from "../js/core/finanzas/finanzas-registro.js";

let ok = 0;
const test = async (n, f) => { await f(); ok++; console.log("  ✓", n); };
const vacio = () => ({ configuracion: {}, semestres: [], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [] });
const gasto = (d, monto, extra = {}) => registrarMovimientoRapido(d, { tipo: "gasto", monto, fecha: "2026-10-01", ...extra });
const ingreso = (d, monto, extra = {}) => registrarMovimientoRapido(d, { tipo: "ingreso", monto, fecha: "2026-10-01", ...extra });

console.log("Ajustar saldo");
await test("un ajuste mueve Mi dinero pero NO gastos, ingresos ni balance", () => {
  const d = vacio(); gasto(d, 3000); ingreso(d, 5000);
  const antes = calcularTotalesMovimientos(d);
  ajustarSaldo(d, { saldoReal: 20000 });
  const t = calcularTotalesMovimientos(d);
  assert.equal(t.saldoLiquido, 20000);
  assert.equal(t.totalGastado, antes.totalGastado);
  assert.equal(t.totalIngresos, antes.totalIngresos);
  assert.equal(t.totalBecas, antes.totalBecas);
  assert.equal(t.balanceNeto, antes.balanceNeto);
});
await test("ajuste hacia abajo (sobraba): resta y deja Mi dinero igual al saldo real", () => {
  const d = vacio(); ingreso(d, 10000);
  const r = ajustarSaldo(d, { saldoReal: 7500 });
  assert.equal(r.diferencia, -2500);
  assert.equal(r.movimiento.sentido, "resta");
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 7500);
});
await test("sin diferencia no crea nada; pedirlo dos veces no duplica", () => {
  const d = vacio();
  const a = ajustarSaldo(d, { saldoReal: 5000, saldoInicial: true });
  const b = ajustarSaldo(d, { saldoReal: 5000, saldoInicial: true });
  assert.equal(a.movimiento.nombre, "Saldo inicial");
  assert.equal(b.movimiento, null);
  assert.equal(d.movimientos.length, 1);
});
await test("saldo inicial cero no crea movimiento", () => {
  const d = vacio(); assert.equal(ajustarSaldo(d, { saldoReal: "0", saldoInicial: true }).movimiento, null);
  assert.equal(d.movimientos.length, 0);
});
await test("diferencia con centavos se redondea a 2 decimales", () => {
  const d = vacio(); ingreso(d, 100.1);
  assert.equal(calcularDiferenciaSaldo(d, 100.35), 0.25);
});
await test("el ajuste no cuenta como ingreso en la serie de gastos/ingresos (solo gasto/ingreso entran)", () => {
  const d = vacio(); ajustarSaldo(d, { saldoReal: 9000 });
  assert.equal(movimientosVigentes(d).filter((m) => m.tipo === "gasto" || m.tipo === "ingreso").length, 0);
});
await test("módulos: sin Gastos/Matrícula/Beca el ajuste se oculta y no cuenta; al volver a encender reaparece", () => {
  const d = vacio(); ajustarSaldo(d, { saldoReal: 4000 });
  aplicarModulosFinanzas(d, { gastos: false, matricula: false, beca: false, ahorros: true });
  assert.equal(puedeAjustarSaldo(d), false);
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 0);
  assert.equal(d.movimientos.length, 1);
  aplicarModulosFinanzas(d, { gastos: true });
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 4000);
});
await test("ajuste con fecha futura no cuenta todavía", () => {
  const d = vacio();
  d.movimientos.push(crearMovimiento({ tipo: "ajuste", monto: 500, sentido: "suma", fechaRegistro: "2999-01-01" }));
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 0);
});

console.log("Invariante: transferencias, ahorros y ajustes nunca son gasto ni ingreso");
await test("mezcla de ahorro, transferencia y ajuste deja gastos e ingresos intactos", () => {
  const d = vacio(); const meta = crearMeta({ nombre: "Laptop", objetivo: 1000 }); d.metas.push(meta);
  ingreso(d, 10000); gasto(d, 2000);
  const base = calcularTotalesMovimientos(d);
  registrarMovimientoRapido(d, { tipo: "ahorro", monto: 1500, metaId: meta.id, fecha: "2026-10-02" });
  d.movimientos.push(crearMovimiento({ tipo: "transferencia", monto: 300, metaId: meta.id, sentido: "desde_meta", fechaRegistro: "2026-10-03" }));
  ajustarSaldo(d, { saldoReal: 50 });
  const t = calcularTotalesMovimientos(d);
  assert.equal(t.totalGastado, base.totalGastado);
  assert.equal(t.totalIngresos, base.totalIngresos);
  assert.equal(t.balanceNeto, base.balanceNeto);
  assert.equal(t.saldoLiquido, 50);
  assert.equal(t.enMetas, 1200);
});

console.log("Metas archivadas (decisión: no cuentan en \"En metas\")");
await test("archivar una meta saca saldo inicial Y aportes de En metas; su saldo real sigue visible", () => {
  const d = vacio(); const meta = crearMeta({ nombre: "Viaje", objetivo: 900, saldoInicial: 100 }); d.metas.push(meta);
  registrarMovimientoRapido(d, { tipo: "ahorro", monto: 400, metaId: meta.id, fuente: "nuevo", fecha: "2026-10-01" });
  assert.equal(calcularTotalesMovimientos(d).enMetas, 500);
  meta.archivada = true;
  assert.equal(calcularTotalesMovimientos(d).enMetas, 0);
  assert.equal(calcularSaldoMeta(meta, d), 500);
  meta.archivada = false;
  assert.equal(calcularTotalesMovimientos(d).enMetas, 500);
});
await test("un gasto pagado con una meta archivada sigue siendo gasto y no baja Mi dinero", () => {
  const d = vacio(); const meta = crearMeta({ nombre: "Fondo", saldoInicial: 1000 }); d.metas.push(meta);
  d.movimientos.push(crearMovimiento({ tipo: "gasto", monto: 200, pagadoConMetaId: meta.id, fechaRegistro: "2026-10-01" }));
  meta.archivada = true;
  const t = calcularTotalesMovimientos(d);
  assert.equal(t.totalGastado, 200);
  assert.equal(t.saldoLiquido, 0);
});

console.log("Registro rápido");
await test("gasto común: monto + guardar crea 1 movimiento con la fecha de hoy", () => {
  const d = vacio();
  const r = registrarMovimientoRapido(d, { tipo: "gasto", monto: "2500", nombre: " Almuerzo " });
  assert.equal(r.ok, true);
  assert.equal(d.movimientos.length, 1);
  assert.equal(d.movimientos[0].nombre, "Almuerzo");
  assert.equal(d.movimientos[0].fecha_registro, hoyIso());
  assert.equal(d.movimientos[0].origen, "manual");
});
await test("monto vacío, cero o negativo-cero no guarda", () => {
  const d = vacio();
  ["", "0", "abc", null].forEach((m) => assert.deepEqual(registrarMovimientoRapido(d, { tipo: "gasto", monto: m }), { ok: false, motivo: "monto" }));
  assert.equal(d.movimientos.length, 0);
});
await test("monto con coma decimal o separador de miles se entiende", () => {
  assert.equal(parsearMonto("1.234,50"), 1234.5);
  assert.equal(parsearMonto("1,234.50"), 1234.5);
  assert.equal(parsearMonto("2500"), 2500);
  assert.equal(parsearMonto("2,5"), 2.5);
  assert.equal(parsearMonto("5 000"), 5000);
  assert.equal(parsearMonto("1,234"), 1234);
});
await test("ahorro exige una meta activa; con meta archivada o inexistente no guarda", () => {
  const d = vacio(); const meta = crearMeta({ nombre: "A" }); d.metas.push(meta);
  assert.equal(registrarMovimientoRapido(d, { tipo: "ahorro", monto: 100 }).motivo, "meta");
  assert.equal(registrarMovimientoRapido(d, { tipo: "ahorro", monto: 100, metaId: "meta_x" }).motivo, "meta");
  meta.archivada = true;
  assert.equal(registrarMovimientoRapido(d, { tipo: "ahorro", monto: 100, metaId: meta.id }).motivo, "meta");
  meta.archivada = false;
  assert.equal(registrarMovimientoRapido(d, { tipo: "ahorro", monto: 100, metaId: meta.id }).ok, true);
});
await test("fecha editable: una fecha pasada se respeta; una futura queda registrada pero aún no cuenta", () => {
  const d = vacio();
  registrarMovimientoRapido(d, { tipo: "gasto", monto: 100, fecha: "2026-01-05" });
  registrarMovimientoRapido(d, { tipo: "gasto", monto: 900, fecha: "2999-01-01" });
  assert.equal(d.movimientos[0].fecha_registro, "2026-01-05");
  assert.equal(calcularTotalesMovimientos(d).totalGastado, 100);
});
await test("tipos no permitidos (ajuste, transferencia) no entran por el registro rápido", () => {
  const d = vacio();
  assert.equal(registrarMovimientoRapido(d, { tipo: "ajuste", monto: 5 }).motivo, "tipo");
  assert.equal(registrarMovimientoRapido(d, { tipo: "transferencia", monto: 5 }).motivo, "tipo");
});
await test("tipos disponibles según módulos y metas", () => {
  const d = vacio();
  assert.deepEqual(tiposDisponiblesRegistroRapido(d), ["gasto", "ingreso"]);
  d.metas.push(crearMeta({ nombre: "A" }));
  assert.deepEqual(tiposDisponiblesRegistroRapido(d), ["gasto", "ingreso", "ahorro"]);
  aplicarModulosFinanzas(d, { gastos: false });
  assert.deepEqual(tiposDisponiblesRegistroRapido(d), ["ahorro"]);
});

console.log("Plantillas y último tipo");
await test("una plantilla por (tipo, nombre), la más reciente primero, con el último monto", () => {
  const d = vacio();
  gasto(d, 2000, { nombre: "Almuerzo", fecha: "2026-10-01" });
  gasto(d, 800, { nombre: "Pasaje", fecha: "2026-10-02" });
  gasto(d, 2300, { nombre: "almuerzo", fecha: "2026-10-03" });
  const p = plantillasRecientes(d);
  assert.deepEqual(p.map((x) => x.nombre), ["almuerzo", "Pasaje"]);
  assert.equal(p[0].monto, 2300);
});
await test("excluye matrícula, beca, recurrentes, ajustes, sin nombre y módulos apagados", () => {
  const d = vacio();
  d.movimientos.push(crearMovimiento({ tipo: "gasto", origen: "matricula", nombre: "Matrícula", monto: 1 }));
  d.movimientos.push(crearMovimiento({ tipo: "ingreso", origen: "beca", nombre: "Beca", monto: 1 }));
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Netflix", monto: 5, recurrente: { monto_por_pago: 5, fecha_inicio: "2026-01-01" } }));
  ajustarSaldo(d, { saldoReal: 10 });
  gasto(d, 100);
  assert.equal(plantillasRecientes(d).length, 0);
  gasto(d, 100, { nombre: "Café" });
  assert.equal(plantillasRecientes(d).length, 1);
  aplicarModulosFinanzas(d, { gastos: false });
  assert.equal(plantillasRecientes(d).length, 0);
});
await test("respeta el máximo", () => {
  const d = vacio();
  for (let i = 0; i < 10; i++) gasto(d, 10 + i, { nombre: "Cosa " + i, fecha: "2026-10-0" + (i % 9 + 1) });
  assert.equal(plantillasRecientes(d, 4).length, 4);
});
await test("último tipo usado: default gasto; luego el del último movimiento manual", () => {
  const d = vacio();
  assert.equal(ultimoTipoUsado(d), "gasto");
  gasto(d, 10, { fecha: "2026-10-01" });
  ingreso(d, 10, { fecha: "2026-10-05" });
  assert.equal(ultimoTipoUsado(d), "ingreso");
});

console.log("Deshacer");
await test("quitar el movimiento revierte los totales y deja tumba", () => {
  const d = vacio(); ingreso(d, 1000);
  const g = gasto(d, 400).movimiento;
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 600);
  assert.equal(quitarMovimiento(d, g.id), true);
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 1000);
  assert.equal(d._eliminados_movimientos.length, 1);
  assert.equal(d._eliminados_movimientos[0].id, g.id);
});
await test("deshacer dos veces no falla ni duplica la tumba", () => {
  const d = vacio(); const g = gasto(d, 400).movimiento;
  assert.equal(quitarMovimiento(d, g.id), true);
  assert.equal(quitarMovimiento(d, g.id), false);
  assert.equal(d._eliminados_movimientos.length, 1);
});
await test("un movimiento deshecho no resucita con la migración", () => {
  const d = vacio(); d.gastos_u.push({ id: "g1", nombre: "Viejo", costo: 50 });
  migrarFinanzasAMovimientos(d);
  assert.equal(d.movimientos.length, 1);
  quitarMovimiento(d, "mov_g1");
  migrarFinanzasAMovimientos(d);
  assert.equal(d.movimientos.length, 0);
});
await test("deshacer un ajuste de saldo restaura Mi dinero", () => {
  const d = vacio(); ingreso(d, 100);
  const a = ajustarSaldo(d, { saldoReal: 900 }).movimiento;
  quitarMovimiento(d, a.id);
  assert.equal(calcularTotalesMovimientos(d).saldoLiquido, 100);
});

console.log("Guard de reentrada");
await test("doble toque seguido ejecuta una sola vez; pasado el plazo vuelve a permitir", async () => {
  const guard = crearGuardReentrada(20);
  let n = 0;
  guard(() => n++); guard(() => n++); guard(() => n++);
  assert.equal(n, 1);
  await new Promise((r) => setTimeout(r, 40));
  guard(() => n++);
  assert.equal(n, 2);
});
await test("si la acción lanza error el guard igual se libera", async () => {
  const guard = crearGuardReentrada(10);
  assert.throws(() => guard(() => { throw new Error("x"); }));
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(guard(() => 7), 7);
});

console.log("Configuración nueva (migración idempotente)");
await test("cuentas viejas reciben los campos nuevos; correr dos veces no cambia nada ni pisa lo elegido", () => {
  const d = { configuracion: { plantillas_rapidas: false }, semestres: [], planes_estudio: [], gastos_u: [], finanzas_semestre: [] };
  migrarDatosAntiguos(d);
  assert.equal(d.configuracion.plantillas_rapidas, false);
  assert.equal(d.configuracion.horizonte_disponible_dias, 30);
  assert.equal(d.configuracion.bloqueo_finanzas, null);
  const foto = JSON.stringify(d.configuracion);
  migrarDatosAntiguos(d);
  assert.equal(JSON.stringify(d.configuracion), foto);
});

await new Promise((r) => setTimeout(r, 100));
console.log(`\n${ok} pruebas OK`);
