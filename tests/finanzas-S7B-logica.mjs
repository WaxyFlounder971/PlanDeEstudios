// Pruebas de la sesión 7B (Node, sin DOM): Cuentas con divisa propia, con schema.js, storage-merge.js y los derivados reales.
import assert from "node:assert/strict";
import * as schema from "../core/schema.js";
import { fusionarDatos } from "../core/storage-merge.js";
import { crearMovimiento } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos, movimientosVigentes } from "../core/finanzas-derivados.js";
import { quitarMovimiento, registrarMovimientoRapido, ajustarSaldo } from "../core/finanzas-registro.js";
import { calcularDisponible, calcularRitmoDiario } from "../core/finanzas-disponible.js";
import { activarDeudas, crearPrestamo, dividirGasto } from "../core/finanzas-deudas.js";
import { crearSobre, resumirSobre } from "../core/finanzas-sobres.js";
import {
  activarCuentas, archivarCuenta, crearCuenta, crearTraspaso, cuentaUsable, editarCuenta, eliminarCuenta, listarCuentas, movimientosDeCuenta,
  resumirCuentas, ultimaCuentaUsada,
} from "../core/finanzas-cuentas.js";
import { exportarMovimientosCsv, exportarRespaldoJson } from "../core/finanzas-importar.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24";
const nuevo = (conModulo = true) => {
  const d = schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));
  if (conModulo) activarCuentas(d, true);
  return d;
};
const T = (d) => calcularTotalesMovimientos(d, HOY);
const mov = (d, p) => { const m = crearMovimiento({ fechaRegistro: HOY, ...p }); d.movimientos.push(m); return m; };
const cuenta = (d, p) => { const r = crearCuenta(d, p); assert.equal(r.ok, true, JSON.stringify(r)); return r.cuenta; };
const saldoDe = (d, c) => T(d).porCuenta[c.id].saldo;

console.log("Crear y validar cuentas");
test("cuentas de distinto tipo y divisa: efectivo, débito, tarjeta propia, tarjeta de un familiar y una cuenta en dólares", () => {
  const d = nuevo(); cuenta(d, { nombre: "Efectivo", tipo: "efectivo" }); cuenta(d, { nombre: "Débito", tipo: "banco", saldoInicial: 50000 });
  cuenta(d, { nombre: "Visa propia", tipo: "credito", limite: 300000 }); cuenta(d, { nombre: "Visa de mamá", tipo: "credito", afectaSaldo: false });
  cuenta(d, { nombre: "Ahorro USD", tipo: "banco", moneda: "USD", saldoInicial: 100 });
  assert.equal(listarCuentas(d).length, 5); assert.equal(d.cuentas.find((c) => c.nombre === "Visa de mamá").afecta_saldo, false);
});
test("nombre vacío, tipo o divisa desconocida, nombre repetido (sin tildes ni mayúsculas) y demasiadas cuentas se rechazan", () => {
  const d = nuevo(); cuenta(d, { nombre: "Débito" });
  assert.equal(crearCuenta(d, { nombre: "  " }).motivo, "nombre"); assert.equal(crearCuenta(d, { nombre: "X", tipo: "zzz" }).motivo, "tipo");
  assert.equal(crearCuenta(d, { nombre: "X", moneda: "ZZZ" }).motivo, "moneda"); assert.equal(crearCuenta(d, { nombre: "debito" }).motivo, "repetida");
  assert.equal(crearCuenta(d, { nombre: "X", limite: -5, tipo: "credito" }).motivo, "limite");
  for (let i = 0; i < 39; i++) cuenta(d, { nombre: "C" + i }); assert.equal(crearCuenta(d, { nombre: "Una más" }).motivo, "muchas");
});
test("la divisa por defecto es la de la app, y una cuenta que no afecta mi saldo no guarda saldo inicial", () => {
  const d = nuevo(); d.configuracion.moneda_preferida = "USD"; const c = cuenta(d, { nombre: "A" }); assert.equal(c.moneda, "USD");
  assert.equal(cuenta(d, { nombre: "B", afectaSaldo: false, saldoInicial: 999 }).saldo_inicial, 0);
});
test("la divisa no se cambia si la cuenta ya tiene movimientos; el nombre, el tipo y el límite sí", () => {
  const d = nuevo(); const c = cuenta(d, { nombre: "Débito" }); assert.equal(editarCuenta(d, c.id, { moneda: "USD" }).ok, true); editarCuenta(d, c.id, { moneda: "CRC" });
  mov(d, { tipo: "gasto", monto: 100, cuentaId: c.id }); assert.equal(editarCuenta(d, c.id, { moneda: "USD" }).motivo, "moneda_bloqueada");
  assert.equal(editarCuenta(d, c.id, { nombre: "Banco", tipo: "credito", limite: 5000 }).ok, true); assert.equal(c.limite, 5000); assert.equal(editarCuenta(d, c.id, { tipo: "banco" }).cuenta.limite, null);
});
test("eliminar solo sin movimientos y sin saldo inicial; archivar oculta de la lista pero su dinero sigue contando", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A", saldoInicial: 500 }), b = cuenta(d, { nombre: "B" });
  assert.equal(eliminarCuenta(d, a.id).motivo, "tiene_saldo"); mov(d, { tipo: "gasto", monto: 1, cuentaId: b.id }); assert.equal(eliminarCuenta(d, b.id).motivo, "tiene_movimientos");
  const c = cuenta(d, { nombre: "C" }); assert.equal(eliminarCuenta(d, c.id).ok, true); assert.ok(d._eliminados_cuentas.some((t) => t.id === c.id));
  archivarCuenta(d, a.id); assert.equal(listarCuentas(d).length, 1); assert.equal(T(d).saldoLiquido, 500 - 1);
  assert.equal(cuentaUsable(d, a.id), false); assert.equal(archivarCuenta(d, a.id, false).ok, true); assert.equal(cuentaUsable(d, a.id), true);
});

console.log("Mi dinero, gastos y cuentas");
test("saldo inicial, gastos e ingresos por cuenta: cada cuenta lleva su saldo y Mi dinero es la suma", () => {
  const d = nuevo(); const ef = cuenta(d, { nombre: "Efectivo", saldoInicial: 20000 }), db = cuenta(d, { nombre: "Débito", saldoInicial: 50000 });
  mov(d, { tipo: "gasto", monto: 3000, cuentaId: ef.id }); mov(d, { tipo: "ingreso", monto: 10000, cuentaId: db.id });
  assert.equal(saldoDe(d, ef), 17000); assert.equal(saldoDe(d, db), 60000); assert.equal(T(d).saldoLiquido, 77000); assert.equal(T(d).totalGastado, 3000); assert.equal(T(d).totalIngresos, 10000);
});
test("movimientos sin cuenta siguen igual: quedan en 'Sin asignar' y nada de lo de antes cambia al encender el módulo", () => {
  const d = nuevo(false); mov(d, { tipo: "ingreso", monto: 40000 }); mov(d, { tipo: "gasto", monto: 5000 }); const antes = JSON.stringify(T(d));
  activarCuentas(d, true); const t = T(d); assert.equal(t.saldoLiquido, 35000); assert.equal(t.sinAsignar, 35000);
  assert.equal(JSON.stringify({ ...t, porMoneda: undefined, porCuenta: undefined, sinAsignar: undefined }), JSON.stringify({ ...JSON.parse(antes), porMoneda: undefined, porCuenta: undefined, sinAsignar: undefined }));
});
test("repartir lo que ya tienes: traspaso desde Sin asignar a una cuenta no cambia Mi dinero ni gastos ni ingresos", () => {
  const d = nuevo(); mov(d, { tipo: "ajuste", sentido: "suma", monto: 30000, nombre: "Saldo inicial" }); const ef = cuenta(d, { nombre: "Efectivo" });
  const antes = T(d); assert.equal(crearTraspaso(d, { origenId: null, destinoId: ef.id, monto: 8000, fecha: HOY }).ok, true); const t = T(d);
  assert.equal(t.saldoLiquido, antes.saldoLiquido); assert.equal(t.sinAsignar, 22000); assert.equal(saldoDe(d, ef), 8000);
  assert.equal(t.totalGastado, antes.totalGastado); assert.equal(t.totalIngresos, antes.totalIngresos); assert.equal(t.balanceNeto, antes.balanceNeto);
});
test("invariante: la suma de las cuentas más Sin asignar es siempre Mi dinero", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A", saldoInicial: 1000 }), b = cuenta(d, { nombre: "B", tipo: "credito" });
  mov(d, { tipo: "ingreso", monto: 700 }); mov(d, { tipo: "gasto", monto: 200, cuentaId: b.id }); crearTraspaso(d, { origenId: a.id, destinoId: null, monto: 300, fecha: HOY });
  const t = T(d); assert.equal(t.porCuenta[a.id].saldo + t.porCuenta[b.id].saldo + t.sinAsignar, t.saldoLiquido);
});

console.log("Tarjeta de crédito");
test("comprar con la tarjeta: es gasto al momento, la tarjeta queda en negativo y Mi dinero baja", () => {
  const d = nuevo(); const tj = cuenta(d, { nombre: "Visa", tipo: "credito", limite: 300000 }); mov(d, { tipo: "gasto", monto: 12000, cuentaId: tj.id });
  assert.equal(saldoDe(d, tj), -12000); assert.equal(T(d).totalGastado, 12000); assert.equal(T(d).saldoLiquido, -12000);
  assert.equal(resumirCuentas(d, HOY).cuentas[0].restante, 288000);
});
test("pagar la tarjeta es un traspaso: Mi dinero y los gastos no cambian, el banco baja y la tarjeta sube", () => {
  const d = nuevo(); const db = cuenta(d, { nombre: "Débito", saldoInicial: 100000 }), tj = cuenta(d, { nombre: "Visa", tipo: "credito" });
  mov(d, { tipo: "gasto", monto: 12000, cuentaId: tj.id }); const antes = T(d);
  assert.equal(crearTraspaso(d, { origenId: db.id, destinoId: tj.id, monto: 12000, fecha: HOY, nombre: "Pago de tarjeta" }).ok, true);
  const t = T(d); assert.equal(t.saldoLiquido, antes.saldoLiquido); assert.equal(t.totalGastado, 12000); assert.equal(saldoDe(d, db), 88000); assert.equal(saldoDe(d, tj), 0);
});
test("tarjeta pagada por un familiar (no afecta mi saldo): sus gastos cuentan y las categorías los ven, pero Mi dinero no baja y no tiene saldo", () => {
  const d = nuevo(); mov(d, { tipo: "ajuste", sentido: "suma", monto: 10000 }); const fam = cuenta(d, { nombre: "Visa de mamá", tipo: "credito", afectaSaldo: false });
  mov(d, { tipo: "gasto", monto: 4000, cuentaId: fam.id, categoriaId: "cat_comida" });
  assert.equal(T(d).totalGastado, 4000); assert.equal(T(d).saldoLiquido, 10000); assert.equal(T(d).porCuenta[fam.id].gastado, 4000); assert.equal(resumirCuentas(d, HOY).cuentas[0].saldo, null);
  assert.equal(movimientosVigentes(d, HOY).filter((m) => m.categoria_id === "cat_comida").length, 1);
});
test("el ritmo diario de gasto no cuenta lo que no sale de mi bolsillo (tarjeta de un familiar)", () => {
  const d = nuevo(); const fam = cuenta(d, { nombre: "Visa de mamá", afectaSaldo: false });
  for (let i = 0; i < 12; i++) { const f = `2026-10-${String(12 + i).padStart(2, "0")}`; mov(d, { tipo: "gasto", monto: 1000, fechaRegistro: f, nombre: "A" }); mov(d, { tipo: "gasto", monto: 9000, fechaRegistro: f, cuentaId: fam.id, nombre: "B" }); }
  const r = calcularRitmoDiario(d, HOY); assert.ok(r); assert.ok(Math.abs(r.diario * r.ventana - 12000) < 1, String(r.diario * r.ventana));
});

console.log("Cada cuenta con su divisa");
test("una cuenta en dólares tiene su total aparte: no se suma a Mi dinero ni a los gastos de la app", () => {
  const d = nuevo(); const usd = cuenta(d, { nombre: "Ahorro USD", moneda: "USD", saldoInicial: 100 }); mov(d, { tipo: "ingreso", monto: 50000 }); mov(d, { tipo: "gasto", monto: 30, cuentaId: usd.id });
  const t = T(d); assert.equal(t.saldoLiquido, 50000); assert.equal(t.totalGastado, 0); assert.equal(t.porMoneda.USD.saldo, 70); assert.equal(t.porMoneda.USD.gastado, 30); assert.equal(t.porMoneda.CRC.saldo, 50000);
  assert.equal(saldoDe(d, usd), 70);
});
test("lo de otra divisa no entra en presupuestos, disponible ni en la lista de movimientos de la app", () => {
  const d = nuevo(); const usd = cuenta(d, { nombre: "USD", moneda: "USD" }); mov(d, { tipo: "ingreso", monto: 100000 });
  const s = crearSobre(d, { nombre: "Comida", categoriaIds: ["cat_comida"], limite: 50000, periodo: "mes" }); assert.equal(s.ok, true);
  mov(d, { tipo: "gasto", monto: 20, cuentaId: usd.id, categoriaId: "cat_comida" }); mov(d, { tipo: "gasto", monto: 1000, categoriaId: "cat_comida" });
  assert.equal(resumirSobre(d, s.sobre, HOY).gastado, 1000); assert.equal(calcularDisponible(d, { hoy: HOY }).saldoLiquido, 99000);
  assert.equal(movimientosVigentes(d, HOY).some((m) => m.cuenta_id === usd.id), false); assert.equal(movimientosVigentes(d, HOY, { todasMonedas: true }).some((m) => m.cuenta_id === usd.id), true);
});
test("si cambias la moneda de la app, las cuentas se reclasifican solas (la cuenta en esa divisa pasa a ser 'de la app')", () => {
  const d = nuevo(); const usd = cuenta(d, { nombre: "USD", moneda: "USD", saldoInicial: 100 }); assert.equal(T(d).saldoLiquido, 0);
  d.configuracion.moneda_preferida = "USD"; assert.equal(T(d).saldoLiquido, 100); assert.equal(saldoDe(d, usd), 100);
});
test("traspaso entre divisas: hay que decir cuánto llegó; sale de una, entra en la otra, y Mi dinero solo baja por lo de la moneda de la app", () => {
  const d = nuevo(); const db = cuenta(d, { nombre: "Débito", saldoInicial: 100000 }), usd = cuenta(d, { nombre: "USD", moneda: "USD" });
  assert.equal(crearTraspaso(d, { origenId: db.id, destinoId: usd.id, monto: 52000 }).motivo, "monto_destino");
  assert.equal(crearTraspaso(d, { origenId: db.id, destinoId: usd.id, monto: 52000, montoDestino: 100, fecha: HOY }).ok, true);
  const t = T(d); assert.equal(saldoDe(d, db), 48000); assert.equal(saldoDe(d, usd), 100); assert.equal(t.saldoLiquido, 48000); assert.equal(t.porMoneda.USD.saldo, 100); assert.equal(t.totalGastado, 0);
});
test("traspaso entre cuentas de la misma divisa ignora monto_destino", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A", saldoInicial: 100 }), b = cuenta(d, { nombre: "B" });
  const r = crearTraspaso(d, { origenId: a.id, destinoId: b.id, monto: 40, montoDestino: 999, fecha: HOY }); assert.equal(r.movimiento.monto_destino, undefined); assert.equal(saldoDe(d, b), 40);
});
test("traspaso inválido: misma cuenta, monto cero, cuenta inexistente, fecha mala o módulo apagado", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A" }), b = cuenta(d, { nombre: "B" });
  assert.equal(crearTraspaso(d, { origenId: a.id, destinoId: a.id, monto: 1 }).motivo, "misma_cuenta"); assert.equal(crearTraspaso(d, { origenId: null, destinoId: null, monto: 1 }).motivo, "misma_cuenta");
  assert.equal(crearTraspaso(d, { origenId: a.id, destinoId: b.id, monto: 0 }).motivo, "monto"); assert.equal(crearTraspaso(d, { origenId: a.id, destinoId: "cue_x", monto: 1 }).motivo, "no_existe");
  assert.equal(crearTraspaso(d, { origenId: a.id, destinoId: b.id, monto: 1, fecha: "ayer" }).motivo, "fecha"); assert.equal(d.movimientos.length, 0);
  activarCuentas(d, false); assert.equal(crearTraspaso(d, { origenId: a.id, destinoId: b.id, monto: 1 }).motivo, "modulo_apagado");
});
test("un traspaso nunca altera gastos, ingresos, becas ni balance neto, en ninguna combinación", () => {
  const d = nuevo(); mov(d, { tipo: "ingreso", monto: 9000 }); mov(d, { tipo: "gasto", monto: 1000 }); const a = cuenta(d, { nombre: "A", saldoInicial: 500 }), u = cuenta(d, { nombre: "U", moneda: "USD" }), f = cuenta(d, { nombre: "F", afectaSaldo: false });
  const antes = T(d); [[a, u, 100, 1], [null, a, 50], [a, null, 10], [u, a, 1, 500], [a, f, 5], [f, a, 7]].forEach(([o, de, m, md]) => crearTraspaso(d, { origenId: o && o.id, destinoId: de && de.id, monto: m, montoDestino: md, fecha: HOY }));
  const t = T(d); ["totalGastado", "totalIngresos", "totalBecas", "balanceNeto"].forEach((k) => assert.equal(t[k], antes[k], k));
});

test("un pago recurrente en otra divisa no aparece en Próximos ni resta del Disponible", () => {
  const d = nuevo(); const usd = cuenta(d, { nombre: "USD", moneda: "USD" }); mov(d, { tipo: "ingreso", monto: 100000 });
  const rec = { frecuencia: "semanal", monto_por_pago: 5000, fecha_inicio: "2026-10-25" };
  mov(d, { tipo: "gasto", nombre: "Suscripción USD", monto: 0, recurrente: rec, cuentaId: usd.id, fechaRegistro: "2026-10-25" });
  const sin = calcularDisponible(d, { hoy: HOY }); assert.equal(sin.proximos.length, 0); assert.equal(sin.disponible, 100000);
  mov(d, { tipo: "gasto", nombre: "Suscripción CRC", monto: 0, recurrente: rec, fechaRegistro: "2026-10-25" });
  assert.ok(calcularDisponible(d, { hoy: HOY }).proximos.length > 0);
});

console.log("Apagar solo oculta");
test("apagado: se ignoran cuentas, traspasos y saldos iniciales, y lo de otras divisas no se mezcla; al encender vuelve todo igual", () => {
  const d = nuevo(); const db = cuenta(d, { nombre: "Débito", saldoInicial: 5000 }), usd = cuenta(d, { nombre: "USD", moneda: "USD", saldoInicial: 100 }), fam = cuenta(d, { nombre: "Fam", afectaSaldo: false });
  mov(d, { tipo: "ingreso", monto: 20000, cuentaId: db.id }); mov(d, { tipo: "gasto", monto: 50, cuentaId: usd.id }); mov(d, { tipo: "gasto", monto: 700, cuentaId: fam.id }); crearTraspaso(d, { origenId: db.id, destinoId: null, monto: 3000, fecha: HOY });
  const enc = JSON.stringify(T(d)); activarCuentas(d, false); const t = T(d);
  assert.equal(t.saldoLiquido, 20000 - 700); assert.equal(t.totalGastado, 700); assert.equal(t.porMoneda, undefined); assert.equal(resumirCuentas(d, HOY), null);
  assert.equal(movimientosVigentes(d, HOY).some((m) => m.tipo === "traspaso" || m.cuenta_id === usd.id), false); assert.equal(d.movimientos.length, 4); assert.equal(d.cuentas.length, 3);
  activarCuentas(d, true); assert.equal(JSON.stringify(T(d)), enc);
});
test("sin usar el módulo, los movimientos nuevos no llevan claves de cuenta (la forma de siempre)", () => {
  const d = nuevo(false); const r = registrarMovimientoRapido(d, { tipo: "gasto", monto: 100, nombre: "Pan", cuentaId: "cue_x" });
  assert.equal(r.ok, false); assert.equal(r.motivo, "cuenta"); const ok2 = registrarMovimientoRapido(d, { tipo: "gasto", monto: 100, nombre: "Pan" }); assert.equal("cuenta_id" in ok2.movimiento, false);
});

console.log("Registro rápido");
test("el registro rápido guarda la cuenta (solo gasto e ingreso), rechaza cuentas archivadas o inexistentes y propone la última usada", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A" }), b = cuenta(d, { nombre: "B" });
  assert.equal(ultimaCuentaUsada(d), null); assert.equal(registrarMovimientoRapido(d, { tipo: "gasto", monto: 100, nombre: "Pan", cuentaId: a.id, fecha: "2026-10-01" }).movimiento.cuenta_id, a.id);
  registrarMovimientoRapido(d, { tipo: "ingreso", monto: 100, nombre: "Mesada", cuentaId: b.id, fecha: "2026-10-02" }); assert.equal(ultimaCuentaUsada(d), b.id);
  archivarCuenta(d, b.id); assert.equal(ultimaCuentaUsada(d), a.id); assert.equal(registrarMovimientoRapido(d, { tipo: "gasto", monto: 1, nombre: "x", cuentaId: b.id }).motivo, "cuenta");
  assert.equal(registrarMovimientoRapido(d, { tipo: "gasto", monto: 1, nombre: "x", cuentaId: "cue_no" }).motivo, "cuenta");
});

console.log("Con Me deben y debo");
test("un gasto pagado por otra persona en una cuenta que sí afecta no baja Mi dinero (no se descuenta dos veces); dividir en una cuenta de dólares no mezcla", () => {
  const d = nuevo(); activarDeudas(d, true); const db = cuenta(d, { nombre: "Débito", saldoInicial: 10000 });
  dividirGasto(d, { nombre: "Almuerzo", total: 4000, quienPago: "otra", pagador: "Papá", fecha: HOY }); assert.equal(T(d).saldoLiquido, 10000); assert.equal(T(d).totalGastado, 4000);
  crearPrestamo(d, { persona: "Ana", monto: 1000, fecha: HOY }); assert.equal(T(d).saldoLiquido, 9000); assert.equal(T(d).sinAsignar, -1000); assert.equal(saldoDe(d, db), 10000);
});

console.log("Sincronización entre dispositivos");
test("cuentas y movimientos con cuenta viajan al otro dispositivo y dan el mismo saldo; renombrar gana sobre la versión vieja", () => {
  const a = nuevo(), b = nuevo(); const c = cuenta(a, { nombre: "Débito", saldoInicial: 5000 }); mov(a, { tipo: "gasto", monto: 1200, cuentaId: c.id });
  const f = fusionarDatos(b, a); assert.equal(f.cuentas.length, 1); assert.equal(calcularTotalesMovimientos(f, HOY).porCuenta[c.id].saldo, 3800);
  const b2 = JSON.parse(JSON.stringify(f)); editarCuenta(a, c.id, { nombre: "Banco" }); assert.equal(fusionarDatos(b2, a).cuentas[0].nombre, "Banco");
});
test("eliminar una cuenta no la resucita al fusionar", () => {
  const a = nuevo(); const c = cuenta(a, { nombre: "Temporal" }); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  eliminarCuenta(a, c.id); let f = fusionarDatos(b, a); assert.equal(f.cuentas.length, 0); assert.ok(f._eliminados_cuentas.some((t) => t.id === c.id)); f = fusionarDatos(f, b); assert.equal(f.cuentas.length, 0);
});
test("traspasos hechos en dos dispositivos a la vez se suman sin duplicar ni marcar conflicto", () => {
  const a = nuevo(); const x = cuenta(a, { nombre: "X", saldoInicial: 1000 }), y = cuenta(a, { nombre: "Y" }); const b = JSON.parse(JSON.stringify(fusionarDatos(nuevo(), a)));
  crearTraspaso(a, { origenId: x.id, destinoId: y.id, monto: 100, fecha: HOY }); crearTraspaso(b, { origenId: x.id, destinoId: y.id, monto: 200, fecha: HOY });
  const f = fusionarDatos(a, b), g = fusionarDatos(b, a); assert.equal(calcularTotalesMovimientos(f, HOY).porCuenta[y.id].saldo, 300); assert.equal(f.movimientos.some((m) => m._conflicto), false);
  assert.equal(JSON.stringify(calcularTotalesMovimientos(g, HOY).porCuenta), JSON.stringify(calcularTotalesMovimientos(f, HOY).porCuenta));
});
test("el interruptor del módulo se sincroniza con la configuración", () => {
  const a = nuevo(), b = nuevo(false); assert.equal(!!fusionarDatos(b, a).configuracion.finanzas_cuentas, true);
});

console.log("Exportar");
test("el CSV deja fuera los traspasos y el respaldo JSON incluye las cuentas", () => {
  const d = nuevo(); const a = cuenta(d, { nombre: "A", saldoInicial: 100 }), b = cuenta(d, { nombre: "B" }); crearTraspaso(d, { origenId: a.id, destinoId: b.id, monto: 10, fecha: HOY }); mov(d, { tipo: "gasto", monto: 5, cuentaId: a.id, nombre: "Pan" });
  const csv = exportarMovimientosCsv(d, { hoy: HOY }); assert.equal(csv.total, 1); assert.ok(!csv.texto.includes("traspaso"));
  const j = JSON.parse(exportarRespaldoJson(d, { hoy: HOY }).texto); assert.equal(j.cuentas.length, 2); assert.equal(j.movimientos.filter((m) => m.tipo === "traspaso").length, 1); assert.ok(j.cuentas.every((c) => !Object.keys(c).some((k) => k.startsWith("_"))));
});

console.log(`\n${ok} pruebas de lógica OK`);
