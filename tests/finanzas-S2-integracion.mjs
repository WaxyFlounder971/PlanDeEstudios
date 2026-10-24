// Integración de la sesión 2 con el motor real de fusión (core/storage-merge.js): dos dispositivos, sin DOM.
import assert from "node:assert/strict";
import { fusionarDatos } from "../core/storage-merge.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { confirmarCompromiso, deshacerConfirmacion, eliminarCompromiso, generarCuotas, omitirCompromiso, reabrirCompromiso } from "../core/finanzas-compromisos.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const base = () => ({ configuracion: {}, perfil: {}, semestres: [{ id: "sem1", nombre: "I" }], movimientos: [], metas: [], gastos_u: [], finanzas_semestre: [], compromisos: [], _eliminados_movimientos: [], _eliminados_compromisos: [] });
const clon = (d) => JSON.parse(JSON.stringify(d));
const log = console.warn; console.warn = () => {};
const plan = () => { const d = base(); generarCuotas(d, { tipo: "matricula", semestreId: "sem1", nombreBase: "Cuota", modo: "total", monto: 100000, cantidad: 4, fechaPrimera: "2026-01-31" }); return d; };
const gastado = (d) => calcularTotalesMovimientos(d).totalGastado;

console.log("Plan entre dispositivos");
test("el plan creado en un dispositivo llega completo al otro, en cualquier orden de fusión", () => {
  const a = plan(), b = base();
  assert.equal(fusionarDatos(b, a).compromisos.length, 4);
  assert.equal(fusionarDatos(a, b).compromisos.length, 4);
});
test("una cuota nueva en cada dispositivo: las dos sobreviven", () => {
  const a = plan(), b = clon(a);
  generarCuotas(a, { tipo: "ingreso_esperado", subtipo: "trabajo", nombreBase: "Trabajo", modo: "por_pago", monto: 1000, cantidad: 1 });
  generarCuotas(b, { tipo: "ingreso_esperado", subtipo: "ayuda_familiar", nombreBase: "Ayuda", modo: "por_pago", monto: 2000, cantidad: 1 });
  assert.equal(fusionarDatos(a, b).compromisos.length, 6);
});
test("migrar un dispositivo viejo (sin compromisos) con uno nuevo no falla ni pierde nada", () => {
  const nuevo = plan(), viejo = base(); delete viejo.compromisos; delete viejo._eliminados_compromisos;
  const m = fusionarDatos(viejo, nuevo);
  assert.equal(m.compromisos.length, 4);
  assert.ok(Array.isArray(fusionarDatos(viejo, clon(viejo)).compromisos));
});

console.log("Confirmar desde dos dispositivos");
test("el mismo compromiso confirmado en los dos dispositivos sin conexión crea UN movimiento y se cuenta una vez", () => {
  const a = plan(), b = clon(a);
  const id = a.compromisos[0].id;
  confirmarCompromiso(a, id, { fecha: "2026-01-31" });
  confirmarCompromiso(b, id, { fecha: "2026-01-31" });
  const m = fusionarDatos(a, b);
  assert.equal(m.movimientos.length, 1);
  assert.equal(gastado(m), 25000);
  assert.equal(m.compromisos.find((c) => c.id === id).estado, "cumplido");
  assert.equal(fusionarDatos(b, a).movimientos.length, 1);
});
test("confirmado con montos distintos en cada dispositivo: queda uno solo (gana el más reciente), nunca los dos", () => {
  const a = plan(), b = clon(a);
  const id = a.compromisos[0].id;
  confirmarCompromiso(a, id, { monto: 25000, fecha: "2026-01-31" });
  confirmarCompromiso(b, id, { monto: 26000, fecha: "2026-01-31" });
  const m = fusionarDatos(a, b);
  assert.equal(m.movimientos.length, 1);
  assert.ok([25000, 26000].includes(gastado(m)));
});
test("un dispositivo confirma y el otro, que aún no lo sabía, también lo confirma tras sincronizar: no se duplica", () => {
  const a = plan(); const id = a.compromisos[0].id;
  const b = clon(a);
  confirmarCompromiso(a, id, { fecha: "2026-01-31" });
  const sincB = fusionarDatos(b, a);              // b recibe lo de a
  const r = confirmarCompromiso(sincB, id);        // la persona toca "Confirmar" de nuevo en b
  assert.equal(r.creado, false);
  assert.equal(sincB.movimientos.length, 1);
});

console.log("Deshacer, omitir y eliminar entre dispositivos");
test("confirmar y deshacer en un dispositivo no resucita el movimiento al fusionar con otro que lo tenía", () => {
  const a = plan(); const id = a.compromisos[0].id;
  confirmarCompromiso(a, id, { fecha: "2026-01-31" });
  const b = clon(a);
  deshacerConfirmacion(a, id);
  const m = fusionarDatos(a, b);
  assert.equal(m.movimientos.length, 0);
  assert.equal(gastado(m), 0);
  assert.equal(fusionarDatos(b, a).movimientos.length, 0);
});
test("el compromiso eliminado en un dispositivo desaparece del otro, pero el pago ya hecho se queda", () => {
  const a = plan(); const [c1, c2] = a.compromisos;
  confirmarCompromiso(a, c1.id, { fecha: "2026-01-31" });
  const b = clon(a);
  eliminarCompromiso(a, c1.id); eliminarCompromiso(a, c2.id);
  const m = fusionarDatos(b, a);
  assert.equal(m.compromisos.length, 2);
  assert.equal(m.movimientos.length, 1);
  assert.equal(gastado(m), 25000);
});
test("omitir en un dispositivo y confirmar en otro: la fusión deja un compromiso coherente (si quedó cumplido, tiene su movimiento)", () => {
  const a = plan(), b = clon(a); const id = a.compromisos[0].id;
  omitirCompromiso(a, id);
  confirmarCompromiso(b, id, { fecha: "2026-01-31" });
  const m = fusionarDatos(a, b);
  const c = m.compromisos.find((x) => x.id === id);
  if (c.estado === "cumplido") assert.ok(m.movimientos.some((x) => x.id === c.movimiento_id));
  assert.ok(["omitido", "cumplido"].includes(c.estado));
  // Sea cual sea el resultado, tocar Reabrir/Confirmar después nunca crea un segundo pago.
  reabrirCompromiso(m, id); confirmarCompromiso(m, id); confirmarCompromiso(m, id);
  assert.equal(m.movimientos.filter((x) => x.compromiso_id === id).length, 1);
  assert.equal(gastado(m), 25000);
});

console.warn = log;
console.log(`\n${ok} pruebas OK`);
