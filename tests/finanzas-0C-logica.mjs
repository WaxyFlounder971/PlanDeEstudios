// Pruebas de lógica 0C (Node, sin DOM): perfiles, pestañas, onboarding y resumen de metas.
import assert from "node:assert/strict";
import { migrarFinanzasAMovimientos, crearMeta, crearMovimiento } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos, calcularSaldoMeta, obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import { PERFILES_FINANZAS, aplicarModulosFinanzas, aplicarPerfilFinanzas, debeMostrarOnboardingFinanzas, omitirOnboardingFinanzas, perfilDeModulos, pestanasVisiblesFinanzas } from "../core/finanzas-perfiles.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const vacio = () => ({ configuracion: {}, semestres: [], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [] });

console.log("Perfiles y módulos");
test("cada perfil se reconoce a sí mismo", () => {
  PERFILES_FINANZAS.forEach((p) => assert.equal(perfilDeModulos(p.modulos), p.id));
});
test("combinación rara = personalizado", () => {
  assert.equal(perfilDeModulos({ matricula: true, beca: false, gastos: false, ahorros: true }), "personalizado");
});
test("aplicar perfil enciende solo sus módulos y marca el onboarding visto", () => {
  const d = vacio(); aplicarPerfilFinanzas(d, "ahorro");
  assert.deepEqual(obtenerModulosFinanzas(d), { matricula: false, beca: false, gastos: false, ahorros: true });
  assert.equal(d.configuracion.finanzas_onboarding_visto, true);
});
test("perfil inexistente no cambia nada", () => {
  const d = vacio(); assert.equal(aplicarPerfilFinanzas(d, "xx"), null);
  assert.equal(d.configuracion.finanzas_modulos, undefined);
});
test("un interruptor cambia solo su módulo", () => {
  const d = vacio(); aplicarModulosFinanzas(d, { ahorros: false });
  assert.deepEqual(obtenerModulosFinanzas(d), { matricula: true, beca: true, gastos: true, ahorros: false });
});

console.log("Pestañas por módulo");
test("todo encendido: Resumen, Semestres, Plan, Movimientos, Metas y Beneficios", () => {
  assert.deepEqual(pestanasVisiblesFinanzas({ matricula: true, beca: true, gastos: true, ahorros: true }), ["resumen", "semestres", "plan", "gastos-u", "metas", "gastos-estudiantiles"]);
});
test("solo ahorro: Resumen, Movimientos y Metas", () => {
  assert.deepEqual(pestanasVisiblesFinanzas({ ahorros: true }), ["resumen", "gastos-u", "metas"]);
});
test("solo gastos: sin Metas ni Semestres", () => {
  assert.deepEqual(pestanasVisiblesFinanzas({ gastos: true }), ["resumen", "gastos-u"]);
});
test("solo universidad: Semestres, Plan, Movimientos y Beneficios", () => {
  assert.deepEqual(pestanasVisiblesFinanzas({ matricula: true, beca: true }), ["resumen", "semestres", "plan", "gastos-u", "gastos-estudiantiles"]);
});
test("todo apagado: solo Resumen", () => {
  assert.deepEqual(pestanasVisiblesFinanzas({}), ["resumen"]);
});

console.log("Onboarding");
test("cuenta nueva sin datos: se ofrece", () => assert.equal(debeMostrarOnboardingFinanzas(vacio()), true));
test("con gastos viejos o movimientos: no se ofrece", () => {
  const a = vacio(); a.gastos_u.push({ id: "g1" });
  const b = vacio(); b.movimientos.push({ id: "m1" });
  assert.equal(debeMostrarOnboardingFinanzas(a), false);
  assert.equal(debeMostrarOnboardingFinanzas(b), false);
});
test("omitir lo resuelve sin tocar módulos", () => {
  const d = vacio(); omitirOnboardingFinanzas(d);
  assert.equal(debeMostrarOnboardingFinanzas(d), false);
  assert.equal(d.configuracion.finanzas_modulos, undefined);
});

console.log("Apagar un módulo solo oculta");
test("apagar Ahorros: metas no cuentan; encender: vuelven con sus datos", () => {
  const d = vacio(); migrarFinanzasAMovimientos(d);
  const meta = crearMeta({ nombre: "Laptop", objetivo: 1000, saldoInicial: 100 }); d.metas.push(meta);
  d.movimientos.push(crearMovimiento({ tipo: "ahorro", monto: 400, metaId: meta.id, fuente: "nuevo", fechaRegistro: "2026-01-01" }));
  assert.equal(calcularSaldoMeta(meta, d), 500);
  aplicarModulosFinanzas(d, { ahorros: false });
  assert.equal(calcularTotalesMovimientos(d).enMetas, 0);
  assert.equal(d.movimientos.length, 1);
  aplicarModulosFinanzas(d, { ahorros: true });
  assert.equal(calcularTotalesMovimientos(d).enMetas, 500);
});

console.log(`\n${ok} pruebas OK`);
