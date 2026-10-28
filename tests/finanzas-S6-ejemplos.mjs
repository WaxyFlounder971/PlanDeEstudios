// Cada formato de ejemplo debe leer su propio mensaje neutro y poder adoptarse como patrón normal.
import assert from "node:assert/strict";
import * as schema from "../js/core/schema.js";
import { leerMensajes, listarPatrones } from "../js/core/finanzas/finanzas-mensajes.js";
import { adoptarFormatoEjemplo, listarFormatosEjemplo } from "../js/core/finanzas/finanzas-formatos-ejemplo.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-25";
const nuevo = () => schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));

for (const f of listarFormatosEjemplo()) {
  test(`${f.clave}: se adopta y lee su mensaje de ejemplo`, () => {
    const d = nuevo(); assert.equal(adoptarFormatoEjemplo(d, f.clave).ok, true);
    const r = leerMensajes(d, f.ejemplo, { hoy: HOY })[0];
    assert.equal(r.patronNombre, f.nombre);
    for (const k of Object.keys(f.esperado)) assert.equal(r[k], f.esperado[k], k);
    assert.equal(r.tipo, f.tipo);
  });
}
test("adoptar todos los ejemplos a la vez cabe y cada mensaje elige su formato", () => {
  const d = nuevo(); listarFormatosEjemplo().forEach((f) => adoptarFormatoEjemplo(d, f.clave));
  assert.equal(listarPatrones(d).length, 3);
  for (const f of listarFormatosEjemplo()) assert.equal(leerMensajes(d, f.ejemplo, { hoy: HOY })[0].patronNombre, f.nombre);
});
test("clave inexistente no crea nada", () => { const d = nuevo(); assert.equal(adoptarFormatoEjemplo(d, "x").ok, false); assert.equal(listarPatrones(d).length, 0); });
test("un correo con líneas en blanco es un solo mensaje; dos SMS con monto siguen siendo dos", () => {
  const d = nuevo(); const correo = listarFormatosEjemplo()[0].ejemplo;
  assert.equal(leerMensajes(d, correo, { hoy: HOY }).length, 1);
  assert.equal(leerMensajes(d, "Compra por ₡900 en Bus\n\nCompra por ₡1.500 en Cafe", { hoy: HOY }).length, 2);
});
console.log(`\n${ok} pruebas OK`);
