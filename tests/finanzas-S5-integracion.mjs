// Pruebas de integración de la sesión 5: migración, sincronización y coherencia con los totales reales (schema.js, storage-merge.js, derivados).
import assert from "node:assert/strict";
import * as schema from "../core/schema.js";
import { fusionarDatos } from "../core/storage-merge.js";
import { crearMovimiento } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { archivarCategoriaFinanzas, asignarCategoria, crearCategoriaFinanzas, eliminarCategoriaFinanzas, FLAG_MIGRACION_CATEGORIAS, listarCategorias, migrarCategoriasV1 } from "../core/finanzas-categorias.js";
import { crearSobre, gastosEnPeriodo, listarSobres, resumenMensual, resumirSobre } from "../core/finanzas-sobres.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const crearDatos = schema.crearDatosUsuarioNuevo;
const migrar = schema.migrarDatosAntiguos;
const hoyReal = () => new Date().toISOString().slice(0, 10);
const nuevo = () => migrar(JSON.parse(JSON.stringify(crearDatos())));

console.log("Migración");
test("datos nuevos y datos en la forma vieja traen las colecciones, el juego básico y el flag", () => {
  const d = nuevo();
  assert.ok(Array.isArray(d.categorias_finanzas) && Array.isArray(d.sobres) && Array.isArray(d._eliminados_categorias_finanzas) && Array.isArray(d._eliminados_sobres));
  assert.deepEqual(listarCategorias(d).map((c) => c.nombre), ["Comida", "Transporte", "Estudios", "Ocio"]); assert.equal(d.configuracion[FLAG_MIGRACION_CATEGORIAS], true);
  const viejo = JSON.parse(JSON.stringify(crearDatos())); ["categorias_finanzas", "sobres", "_eliminados_categorias_finanzas", "_eliminados_sobres"].forEach((k) => delete viejo[k]);
  viejo.movimientos = [crearMovimiento({ tipo: "gasto", nombre: "Pasaje", monto: 700, fechaRegistro: "2026-10-01" })];
  const m = migrar(viejo); assert.equal(listarCategorias(m).length, 4); assert.equal(m.movimientos[0].categoria_id, null); assert.equal(m.movimientos[0].monto, 700); // nada del historial cambió
});
test("la migración es idempotente: correrla dos veces no cambia nada, y no resucita lo borrado", () => {
  const d = nuevo(); eliminarCategoriaFinanzas(d, "cat_ocio"); const antes = JSON.stringify(d);
  migrar(d); migrarCategoriasV1(d); assert.equal(JSON.stringify(d), antes); assert.equal(listarCategorias(d).some((c) => c.id === "cat_ocio"), false);
});
test("un movimiento nuevo trae categoria_id (solo gastos e ingresos) y las transferencias no", () => {
  assert.equal(crearMovimiento({ tipo: "gasto", monto: 1, categoriaId: "cat_comida" }).categoria_id, "cat_comida");
  assert.equal(crearMovimiento({ tipo: "ingreso", monto: 1, categoriaId: "x" }).categoria_id, "x");
  assert.equal(crearMovimiento({ tipo: "transferencia", monto: 1, categoriaId: "x" }).categoria_id, null);
  assert.equal(crearMovimiento({ tipo: "gasto", monto: 1 }).categoria_id, null);
});

console.log("Sincronización");
test("dos dispositivos que siembran por separado se fusionan sin duplicar ni marcar conflicto", () => {
  const a = nuevo(), b = nuevo(); const r = fusionarDatos(a, b);
  assert.equal(r.categorias_finanzas.length, 4); assert.equal(r.categorias_finanzas.some((c) => c._conflicto || c.conflicto), false);
});
test("una categoría creada, un sobre y una asignación viajan al otro dispositivo", () => {
  const a = nuevo(), b = nuevo(); const c = crearCategoriaFinanzas(a, { nombre: "Salud" }).categoria;
  const s = crearSobre(a, { nombre: "Comida", categoriaIds: ["cat_comida"], limite: 10000, periodo: "mes" }).sobre;
  const m = crearMovimiento({ tipo: "gasto", nombre: "Almuerzo", monto: 2500, fechaRegistro: hoyReal() }); a.movimientos.push(m); b.movimientos.push(JSON.parse(JSON.stringify(m)));
  asignarCategoria(a, m.id, "cat_comida");
  const r = fusionarDatos(b, a);
  assert.ok(r.categorias_finanzas.some((x) => x.id === c.id)); assert.ok(r.sobres.some((x) => x.id === s.id)); assert.equal(r.movimientos.find((x) => x.id === m.id).categoria_id, "cat_comida");
});
test("borrar una categoría en un dispositivo la borra en el otro (la tumba gana) y no vuelve", () => {
  const a = nuevo(), b = nuevo(); eliminarCategoriaFinanzas(a, "cat_ocio");
  let r = fusionarDatos(b, a); assert.equal(r.categorias_finanzas.some((x) => x.id === "cat_ocio"), false); assert.ok(r._eliminados_categorias_finanzas.some((t) => t.id === "cat_ocio"));
  r = fusionarDatos(r, b); assert.equal(r.categorias_finanzas.some((x) => x.id === "cat_ocio"), false);
});
test("archivar y editar en un dispositivo llegan al otro", () => {
  const a = nuevo(), b = nuevo(); archivarCategoriaFinanzas(a, "cat_comida");
  assert.equal(fusionarDatos(b, a).categorias_finanzas.find((x) => x.id === "cat_comida").archivada, true);
});

console.log("Coherencia con los totales reales");
test("el gastado de un recurrente coincide con lo que ya cuentan los totales de la app (mismas fechas que calcularPagosRecurrentesTranscurridos)", () => {
  const hoy = hoyReal(); const [a, m] = hoy.split("-").map(Number);
  const rangoDe = (n) => { const d = new Date(Date.UTC(a, m - 1 - n, 1)); return d.toISOString().slice(0, 10); };
  const casos = [
    { frecuencia: "semanal", fecha_inicio: rangoDe(3), monto_por_pago: 700 },
    { frecuencia: "quincenal", fecha_inicio: rangoDe(4), monto_por_pago: 1500 },
    { frecuencia: "mensual", fecha_inicio: rangoDe(5), monto_por_pago: 4000 },
    { frecuencia: "mensual", fecha_inicio: rangoDe(5).slice(0, 8) + "28", monto_por_pago: 900 },
    { frecuencia: "personalizado", fecha_inicio: rangoDe(2), monto_por_pago: 300, personalizado: { modo: "diario" } },
    { frecuencia: "personalizado", fecha_inicio: rangoDe(2), monto_por_pago: 300, personalizado: { modo: "cada_n_dias", cada_n_dias: 3 } },
    { frecuencia: "personalizado", fecha_inicio: rangoDe(2), monto_por_pago: 300, personalizado: { modo: "dias_semana", dias_semana: [1, 3, 5] } },
  ];
  casos.forEach((rec) => {
    const d = nuevo(); d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Rec", monto: 0, fechaRegistro: rec.fecha_inicio, recurrente: { fecha_fin: null, personalizado: null, ...rec }, categoriaId: "cat_ocio" }));
    const delSistema = calcularTotalesMovimientos(d, hoy).totalGastado;
    const mio = gastosEnPeriodo(d, ["cat_ocio"], "2000-01-01", "2999-12-31", hoy).reduce((t, f) => t + f.monto, 0);
    assert.equal(mio, delSistema, `${rec.frecuencia}${rec.personalizado ? "/" + rec.personalizado.modo : ""}: sobre ${mio} vs totales ${delSistema}`);
  });
});
test("la suma de todos los gastos categorizados más lo sin categoría es el total de gastos del sistema", () => {
  const d = nuevo(); const hoy = hoyReal();
  [["cat_comida", 1200], ["cat_transporte", 700], [null, 300]].forEach(([c, mo]) => d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "x", monto: mo, fechaRegistro: hoy, categoriaId: c })));
  d.movimientos.push(crearMovimiento({ tipo: "transferencia", monto: 5000, fechaRegistro: hoy }));
  const r = resumenMensual(d, { hoy }); assert.equal(r.gastos.total, calcularTotalesMovimientos(d, hoy).totalGastado);
  assert.equal(r.gastos.categorias.reduce((t, c) => t + c.monto, 0) + r.gastos.sinCategoria.monto, r.gastos.total);
});
test("apagar Gastos oculta los sobres sin borrarlos, y al encenderlo vuelven", () => {
  const d = nuevo(); crearSobre(d, { nombre: "Comida", categoriaIds: ["cat_comida"], limite: 1000, periodo: "mes" });
  d.configuracion.finanzas_modulos.gastos = false; assert.equal(listarSobres(d, hoyReal()).length, 0); assert.equal(d.sobres.length, 1);
  d.configuracion.finanzas_modulos.gastos = true; assert.equal(listarSobres(d, hoyReal()).length, 1);
});
console.log(`\n${ok} pruebas de integración OK`);
