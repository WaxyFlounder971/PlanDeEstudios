// Regresión A3: las tarjetas de Finanzas son tocables, accesibles por teclado y conservan el aviso negativo.
import assert from "node:assert/strict";
import fs from "node:fs";
const leer=(p)=>fs.readFileSync(new URL(p,import.meta.url),"utf8");
const ui=leer("../js/finanzas/finanzas-ui-basico.js"), cuentas=leer("../js/finanzas/finanzas-cuentas-ui.js"), deudas=leer("../js/finanzas/finanzas-deudas-ui.js"), css=leer("../css/design-system.css"), es=leer("../idiomas/espanol.json");
assert.match(ui,/function hacerTarjetaTocable/); assert.match(ui,/evento.key !== "Enter" && evento.key !== " "/); assert.match(ui,/evento.target.closest/);
assert.match(cuentas,/hacerTarjetaTocable\(tarjeta, \(\) => abrirDetalleCuenta/); assert.doesNotMatch(cuentas,/boton\(t\("Abrir"\), "btn btn-secondary", \(\) => abrirDetalleCuenta/);
assert.match(deudas,/hacerTarjetaTocable\(tarjeta, \(\) => abrirDetallePrestamo/); assert.doesNotMatch(deudas,/boton\(t\("Abrir"\), "btn btn-secondary", \(\) => abrirDetallePrestamo/);
assert.match(cuentas,/fin-sin-asignar/); assert.match(cuentas,/r\.sinAsignar < 0/); assert.match(css,/\.fin-tarjeta-tocable/); assert.match(css,/\.fin-chevron/);
assert.ok(JSON.parse(es).traducciones["Gastos sin cuenta que superan lo que tenías. Edita esos movimientos y asígnalos a su cuenta para dejarlo en 0."]);
console.log("  ✓ A3: tarjetas de cuentas y préstamos tocables, accesibles y con aviso negativo");
