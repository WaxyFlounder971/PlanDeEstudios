// Pruebas de integración de la sesión 6: schema.js y storage-merge.js reales (migración y sincronización entre dispositivos).
import assert from "node:assert/strict";
import * as schema from "../js/core/schema.js";
import { fusionarDatos } from "../js/core/storage/storage-merge.js";
import { calcularTotalesMovimientos } from "../js/core/finanzas/finanzas-derivados.js";
import { quitarMovimiento } from "../js/core/finanzas/finanzas-registro.js";
import { aplicarImportacion, candidatosDeCsv, clasificarCandidatos, exportarMovimientosCsv, prepararImportacion } from "../js/core/finanzas/finanzas-importar.js";
import { crearPatron, editarPatron, eliminarPatron, leerMensajes, migrarPatronesMensajesV1 } from "../js/core/finanzas/finanzas-mensajes.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const nuevo = () => schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));
const importar = (d, texto) => aplicarImportacion(d, clasificarCandidatos(d, candidatosDeCsv(prepararImportacion(texto, { hoy: HOY }), { hoy: HOY })));
const CSV = "Fecha,Descripción,Monto\n2026-10-01,Almuerzo,-2500\n2026-10-01,Almuerzo,-2500\n2026-10-02,Pasaje,-700\n2026-10-03,Mesada,50000";

console.log("Migración");
test("cuentas nuevas y en la forma vieja traen la colección de patrones; migrar dos veces no cambia nada", () => {
  const d = nuevo(); assert.ok(Array.isArray(d.patrones_mensajes) && Array.isArray(d._eliminados_patrones_mensajes));
  const viejo = JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())); delete viejo.patrones_mensajes; delete viejo._eliminados_patrones_mensajes;
  const m = schema.migrarDatosAntiguos(viejo); assert.deepEqual(m.patrones_mensajes, []); const antes = JSON.stringify(m);
  schema.migrarDatosAntiguos(m); migrarPatronesMensajesV1(m); assert.equal(JSON.stringify(m), antes);
});
test("la migración no toca movimientos, categorías ni lo que ya tenías", () => {
  const d = nuevo(); importar(d, CSV); const antes = JSON.stringify({ m: d.movimientos, c: d.categorias_finanzas, s: d.sobres });
  schema.migrarDatosAntiguos(d); assert.equal(JSON.stringify({ m: d.movimientos, c: d.categorias_finanzas, s: d.sobres }), antes);
});

console.log("Sincronización de lo importado");
test("dos dispositivos que importan el mismo archivo por separado se fusionan sin duplicar ni marcar conflicto", () => {
  const a = nuevo(), b = nuevo(); importar(a, CSV); importar(b, CSV);
  assert.equal(a.movimientos.length, 4); assert.deepEqual(a.movimientos.map((m) => m.id).sort(), b.movimientos.map((m) => m.id).sort());
  const r = fusionarDatos(a, b); assert.equal(r.movimientos.length, 4); assert.equal(r.movimientos.some((m) => m._conflicto), false);
  assert.deepEqual(calcularTotalesMovimientos(r, HOY), calcularTotalesMovimientos(a, HOY));
});
test("importar en un dispositivo ya sincronizado con el otro no duplica al fusionar", () => {
  const a = nuevo(); importar(a, CSV); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  assert.equal(importar(b, CSV).creados.length, 0); assert.equal(fusionarDatos(a, b).movimientos.length, 4);
});
test("deshacer una importación en un dispositivo la quita también en el otro (la tumba gana)", () => {
  const a = nuevo(); const r = importar(a, CSV); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  r.creados.slice(0, 2).forEach((id) => quitarMovimiento(a, id));
  const f = fusionarDatos(b, a); assert.equal(f.movimientos.length, 2); assert.equal(fusionarDatos(f, b).movimientos.length, 2);
});
test("las categorías creadas al importar viajan al otro dispositivo", () => {
  const a = nuevo(); importar(a, "Fecha,Descripción,Monto,Categoría\n2026-10-01,Doctor,-9000,Salud");
  const f = fusionarDatos(nuevo(), a); assert.ok(f.categorias_finanzas.some((c) => c.nombre === "Salud")); assert.equal(f.movimientos[0].categoria_id, f.categorias_finanzas.find((c) => c.nombre === "Salud").id);
});
test("si dos dispositivos importan el mismo archivo con una categoría nueva, al fusionar queda una sola", () => {
  const csv = "Fecha,Descripción,Monto,Categoría\n2026-10-01,Doctor,-9000,Salud";
  const a = nuevo(), b = nuevo(); importar(a, csv); importar(b, csv);
  const f = fusionarDatos(a, b); assert.equal(f.categorias_finanzas.filter((c) => c.nombre === "Salud").length, 1); assert.equal(f.movimientos.length, 1);
  assert.equal(f.categorias_finanzas.some((c) => c._conflicto), false);
});
test("el CSV exportado por un dispositivo, importado en el otro ya fusionado, no hace nada", () => {
  const a = nuevo(); importar(a, CSV); const b = fusionarDatos(nuevo(), a);
  assert.equal(importar(b, exportarMovimientosCsv(a, { hoy: HOY }).texto).creados.length, 0);
});

console.log("Sincronización de patrones");
test("un patrón creado en un dispositivo llega al otro y lee mensajes allí", () => {
  const a = nuevo(), b = nuevo(); const p = crearPatron(a, { nombre: "Compra", plantilla: "Compra por {monto} en {nombre}", tipo: "gasto" }).patron;
  const f = fusionarDatos(b, a); assert.ok(f.patrones_mensajes.some((x) => x.id === p.id));
  assert.equal(leerMensajes(f, "Compra por ₡900 en Bus", { hoy: HOY })[0].patronNombre, "Compra");
});
test("editar un patrón en un dispositivo gana sobre la versión vieja del otro; apagarlo también se sincroniza", () => {
  const a = nuevo(); const p = crearPatron(a, { nombre: "Compra", plantilla: "Compra por {monto} en {nombre}", tipo: "gasto" }).patron;
  const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a))); editarPatron(a, p.id, { nombre: "Compras", activo: false });
  const f = fusionarDatos(b, a); const x = f.patrones_mensajes.find((q) => q.id === p.id); assert.equal(x.nombre, "Compras"); assert.equal(x.activo, false);
});
test("borrar un patrón en un dispositivo lo borra en el otro y no resucita", () => {
  const a = nuevo(); const p = crearPatron(a, { nombre: "Compra", plantilla: "Compra por {monto} en {nombre}", tipo: "gasto" }).patron;
  const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a))); eliminarPatron(a, p.id);
  let f = fusionarDatos(b, a); assert.equal(f.patrones_mensajes.length, 0); assert.ok(f._eliminados_patrones_mensajes.some((t) => t.id === p.id));
  f = fusionarDatos(f, b); assert.equal(f.patrones_mensajes.length, 0);
});
test("los patrones y los movimientos importados no alteran los totales de gastos, ingresos ni Mi dinero de otros datos", () => {
  const d = nuevo(); crearPatron(d, { nombre: "C", plantilla: "Compra por {monto} en {nombre}", tipo: "gasto" });
  assert.deepEqual(calcularTotalesMovimientos(d, HOY), calcularTotalesMovimientos(nuevo(), HOY));
  importar(d, CSV); const t = calcularTotalesMovimientos(d, HOY); assert.equal(t.totalGastado, 5700); assert.equal(t.totalIngresos, 50000); assert.equal(t.saldoLiquido, 50000 - 5700);
});

console.log(`\n${ok} pruebas de integración OK`);
