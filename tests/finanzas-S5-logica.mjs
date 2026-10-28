// Pruebas de lógica de la sesión 5 (Node, sin DOM): categorías, categorizar en lote, sobres y resumen mensual.
import assert from "node:assert/strict";
import { crearMovimiento } from "../js/core/finanzas/finanzas-modelo.js";
import { fusionarDatos } from "../js/core/storage/storage-merge.js";
import {
  agruparSinCategoriaPorNombre, archivarCategoriaFinanzas, asignarCategoria, categorizarEnLote, crearCategoriaFinanzas, editarCategoriaFinanzas, eliminarCategoriaFinanzas,
  listarCategorias, movimientosSinCategoria, sembrarCategoriasBasicas, sugerirCategoria,
} from "../js/core/finanzas/finanzas-categorias.js";
import {
  archivarSobre, calcularArrastre, crearSobre, editarSobre, eliminarSobre, gastosEnPeriodo, listarSobres, periodoDelSobre, resumenMensual, resumirSobre, sobresEnRiesgo,
} from "../js/core/finanzas/finanzas-sobres.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-24"; // sábado
const vacio = () => ({ configuracion: {}, semestres: [], movimientos: [], metas: [], compromisos: [], categorias_finanzas: [], sobres: [], _eliminados_categorias_finanzas: [], _eliminados_sobres: [] });
const gasto = (d, fecha, monto, extra = {}) => { const m = crearMovimiento({ tipo: "gasto", nombre: "Gasto", monto, fechaRegistro: fecha, ...extra }); d.movimientos.push(m); return m; };
const conBasicas = () => { const d = vacio(); sembrarCategoriasBasicas(d); return d; };

console.log("Categorías");
test("el juego básico se crea una vez; correrlo otra vez, o tras borrar una, no cambia nada", () => {
  const d = vacio();
  assert.equal(sembrarCategoriasBasicas(d).creadas, 4); assert.deepEqual(listarCategorias(d).map((c) => c.nombre), ["Comida", "Transporte", "Estudios", "Ocio"]);
  const antes = JSON.stringify(d); assert.equal(sembrarCategoriasBasicas(d).creadas, 0); assert.equal(JSON.stringify(d), antes);
  eliminarCategoriaFinanzas(d, "cat_ocio"); assert.equal(sembrarCategoriasBasicas(d).creadas, 0); assert.equal(listarCategorias(d).length, 3); // respeta la decisión de la persona
});
test("crear valida nombre, tipo y repetidos (sin distinguir mayúsculas ni tildes)", () => {
  const d = conBasicas();
  assert.equal(crearCategoriaFinanzas(d, { nombre: "  " }).motivo, "nombre");
  assert.equal(crearCategoriaFinanzas(d, { nombre: "COMIDA" }).motivo, "repetida");
  assert.equal(crearCategoriaFinanzas(d, { nombre: "Camión", tipo: "otro" }).motivo, "tipo");
  assert.equal(crearCategoriaFinanzas(d, { nombre: "x".repeat(31) }).motivo, "largo");
  assert.equal(crearCategoriaFinanzas(d, { nombre: "Comida", tipo: "ingreso" }).ok, true); // mismo nombre en otro tipo sí vale
  const r = crearCategoriaFinanzas(d, { nombre: "Salud", emoji: "💊" }); assert.equal(r.ok, true); assert.ok(r.categoria._actualizadoEn);
});
test("editar cambia nombre, emoji y color, pero nunca el tipo", () => {
  const d = conBasicas();
  assert.equal(editarCategoriaFinanzas(d, "cat_comida", { nombre: "Almuerzos", emoji: "🥪", tipo: "ingreso" }).ok, true);
  const c = listarCategorias(d).find((x) => x.id === "cat_comida"); assert.equal(c.nombre, "Almuerzos"); assert.equal(c.tipo, "gasto");
  assert.equal(editarCategoriaFinanzas(d, "cat_comida", { nombre: "transporte" }).motivo, "repetida"); assert.equal(editarCategoriaFinanzas(d, "no", {}).motivo, "categoria");
});
test("archivar oculta la categoría pero el historial la conserva; eliminar en uso se rechaza", () => {
  const d = conBasicas(); const m = gasto(d, "2026-10-10", 500, { categoriaId: "cat_ocio" });
  assert.equal(archivarCategoriaFinanzas(d, "cat_ocio").ok, true); assert.equal(listarCategorias(d).some((c) => c.id === "cat_ocio"), false); assert.equal(listarCategorias(d, { incluirArchivadas: true }).length, 4);
  assert.equal(m.categoria_id, "cat_ocio");
  assert.equal(eliminarCategoriaFinanzas(d, "cat_ocio").motivo, "en_uso");
  assert.equal(eliminarCategoriaFinanzas(d, "cat_estudios").ok, true); assert.equal(d._eliminados_categorias_finanzas.at(-1).id, "cat_estudios"); assert.ok(d._eliminados_categorias_finanzas.at(-1).eliminadoEn > 0);
  assert.equal(archivarCategoriaFinanzas(d, "cat_ocio", false).ok, true);
});
test("asignar respeta el tipo y no categoriza transferencias ni ajustes; sin cambio no resella", () => {
  const d = conBasicas(); const g = gasto(d, "2026-10-10", 100);
  const t = crearMovimiento({ tipo: "transferencia", monto: 5, fechaRegistro: "2026-10-10" }); const aj = crearMovimiento({ tipo: "ajuste", monto: 5, fechaRegistro: "2026-10-10" }); d.movimientos.push(t, aj);
  assert.equal(asignarCategoria(d, t.id, "cat_comida").motivo, "no_categorizable"); assert.equal(asignarCategoria(d, aj.id, "cat_comida").motivo, "no_categorizable");
  d.categorias_finanzas.push({ id: "cat_sueldo", nombre: "Sueldo", tipo: "ingreso", archivada: false });
  assert.equal(asignarCategoria(d, g.id, "cat_sueldo").motivo, "tipo"); assert.equal(asignarCategoria(d, g.id, "nada").motivo, "categoria");
  assert.equal(asignarCategoria(d, g.id, "cat_comida").cambio, true); const sello = g._actualizadoEn;
  assert.equal(asignarCategoria(d, g.id, "cat_comida").cambio, false); assert.equal(g._actualizadoEn, sello);
  assert.equal(asignarCategoria(d, g.id, null).cambio, true); assert.equal(g.categoria_id, null);
});

console.log("Categorizar en lote");
test("el lote asigna sin tocar monto, fecha ni tipo, y repetirlo no cambia nada", () => {
  const d = conBasicas(); const a = gasto(d, "2026-09-01", 700, { nombre: "Pasaje" }), b = gasto(d, "2026-09-02", 700, { nombre: "pasaje" }), c = gasto(d, "2026-09-03", 2500, { nombre: "Almuerzo" });
  const antes = JSON.stringify(d.movimientos.map(({ monto, fecha_registro, tipo, nombre }) => ({ monto, fecha_registro, tipo, nombre })));
  const r = categorizarEnLote(d, [a, b].map((m) => ({ movimientoId: m.id, categoriaId: "cat_transporte" })).concat({ movimientoId: c.id, categoriaId: "cat_comida" }));
  assert.deepEqual([r.aplicados, r.sinCambio, r.saltados.length], [3, 0, 0]);
  assert.equal(JSON.stringify(d.movimientos.map(({ monto, fecha_registro, tipo, nombre }) => ({ monto, fecha_registro, tipo, nombre }))), antes);
  const r2 = categorizarEnLote(d, [{ movimientoId: a.id, categoriaId: "cat_transporte" }]); assert.deepEqual([r2.aplicados, r2.sinCambio], [0, 1]);
});
test("no pisa lo clasificado a mano, y los inválidos se saltan e informan sin frenar al resto", () => {
  const d = conBasicas(); const a = gasto(d, "2026-09-01", 1, { categoriaId: "cat_ocio" }), b = gasto(d, "2026-09-02", 1);
  const r = categorizarEnLote(d, [{ movimientoId: a.id, categoriaId: "cat_comida" }, { movimientoId: "no", categoriaId: "cat_comida" }, { movimientoId: b.id, categoriaId: "cat_comida" }]);
  assert.equal(r.aplicados, 1); assert.deepEqual(r.saltados.map((s) => s.motivo), ["ya_tiene", "movimiento"]); assert.equal(a.categoria_id, "cat_ocio");
  assert.equal(categorizarEnLote(d, [{ movimientoId: a.id, categoriaId: "cat_comida" }], { soloSinCategoria: false }).aplicados, 1);
});
test("agrupa lo sin categoría por nombre (sin tildes ni mayúsculas) y ordena por repetidos", () => {
  const d = conBasicas(); gasto(d, "2026-10-01", 700, { nombre: "Pasaje" }); gasto(d, "2026-10-02", 700, { nombre: "PASAJE" }); gasto(d, "2026-10-03", 700, { nombre: "pasaje " });
  gasto(d, "2026-10-03", 2500, { nombre: "Almuerzo" }); gasto(d, "2026-10-04", 9, { nombre: "Café", categoriaId: "cat_comida" });
  const g = agruparSinCategoriaPorNombre(d, { tipo: "gasto", hoy: HOY });
  assert.deepEqual(g.map((x) => [x.ids.length, x.total]), [[3, 2100], [1, 2500]]); assert.equal(movimientosSinCategoria(d, { hoy: HOY }).length, 4);
});
test("sugiere por el nombre ya usado: pide 2 usos, no adivina en empate y no sugiere archivadas", () => {
  const d = conBasicas();
  gasto(d, "2026-10-01", 1, { nombre: "Pasaje", categoriaId: "cat_transporte" }); assert.equal(sugerirCategoria(d, "Pasaje"), null); // un solo uso
  gasto(d, "2026-10-02", 1, { nombre: "pasaje", categoriaId: "cat_transporte" }); assert.deepEqual(sugerirCategoria(d, "PASAJE"), { categoriaId: "cat_transporte", usos: 2 });
  gasto(d, "2026-10-03", 1, { nombre: "Pasaje", categoriaId: "cat_ocio" }); gasto(d, "2026-10-04", 1, { nombre: "Pasaje", categoriaId: "cat_ocio" }); assert.equal(sugerirCategoria(d, "Pasaje"), null); // empate 2-2
  archivarCategoriaFinanzas(d, "cat_ocio"); assert.equal(sugerirCategoria(d, "Pasaje").categoriaId, "cat_transporte");
  assert.equal(sugerirCategoria(d, ""), null);
});

console.log("Sobres: periodos");
test("semana de lunes a domingo, mes con año bisiesto, rango y semestre", () => {
  const d = vacio(); d.semestres.push({ id: "s1", fecha_inicio: "2026-08-03", fecha_fin: "2026-12-12" });
  assert.deepEqual(periodoDelSobre(d, { periodo: "semana" }, HOY), { desde: "2026-10-19", hasta: "2026-10-25", clave: "s:2026-10-19" });
  assert.equal(periodoDelSobre(d, { periodo: "semana" }, "2026-10-25").desde, "2026-10-19"); // el domingo sigue en su semana
  assert.equal(periodoDelSobre(d, { periodo: "mes" }, "2028-02-10").hasta, "2028-02-29"); assert.equal(periodoDelSobre(d, { periodo: "mes" }, "2026-02-10").hasta, "2026-02-28");
  assert.equal(periodoDelSobre(d, { periodo: "mes" }, "2026-12-31").hasta, "2026-12-31");
  assert.deepEqual(periodoDelSobre(d, { periodo: "semestre" }, HOY), { desde: "2026-08-03", hasta: "2026-12-12", clave: "x:2026-08-03" });
  assert.equal(periodoDelSobre(d, { periodo: "semestre" }, "2027-02-01"), null); // fuera de todo semestre
  assert.equal(periodoDelSobre(d, { periodo: "rango", fecha_inicio: "2026-10-01", fecha_fin: "2026-10-15" }, HOY).hasta, "2026-10-15");
  assert.equal(periodoDelSobre(d, { periodo: "rango", fecha_inicio: "2026-10-20", fecha_fin: "2026-10-01" }, HOY), null);
});
test("validar sobres: límite, categorías (solo de gasto), periodo, rango y nombre repetido", () => {
  const d = conBasicas(); d.categorias_finanzas.push({ id: "cat_sueldo", nombre: "Sueldo", tipo: "ingreso", archivada: false });
  const base = { nombre: "Comida del mes", categoriaIds: ["cat_comida"], limite: 100000, periodo: "mes" };
  assert.equal(crearSobre(d, { ...base, nombre: " " }).motivo, "nombre"); assert.equal(crearSobre(d, { ...base, limite: 0 }).motivo, "limite");
  assert.equal(crearSobre(d, { ...base, categoriaIds: [] }).motivo, "categorias"); assert.equal(crearSobre(d, { ...base, categoriaIds: ["cat_sueldo"] }).motivo, "categoria_invalida");
  assert.equal(crearSobre(d, { ...base, categoriaIds: ["nada"] }).motivo, "categoria_invalida"); assert.equal(crearSobre(d, { ...base, periodo: "año" }).motivo, "periodo");
  assert.equal(crearSobre(d, { ...base, periodo: "rango" }).motivo, "rango"); assert.equal(crearSobre(d, { ...base, periodo: "semestre", semestreId: "no" }).motivo, "semestre");
  assert.equal(crearSobre(d, base).ok, true); assert.equal(crearSobre(d, { ...base, nombre: "comida DEL mes" }).motivo, "repetido");
  assert.equal(d.sobres.length, 1);
});

console.log("Sobres: gastado derivado");
const sobreMes = (d, extra = {}) => crearSobre(d, { nombre: "Comida", categoriaIds: ["cat_comida"], limite: 10000, periodo: "mes", desde: "2026-10-01", ...extra }).sobre;
test("el gastado coincide con la suma de los movimientos de la categoría en el periodo", () => {
  const d = conBasicas(); const s = sobreMes(d);
  gasto(d, "2026-10-02", 1500, { categoriaId: "cat_comida" }); gasto(d, "2026-10-20", 2500, { categoriaId: "cat_comida" });
  gasto(d, "2026-09-30", 999, { categoriaId: "cat_comida" });   // mes anterior: no cuenta
  gasto(d, "2026-10-05", 800, { categoriaId: "cat_transporte" }); // otra categoría: no cuenta
  gasto(d, "2026-10-28", 700, { categoriaId: "cat_comida" });   // futuro: no cuenta todavía
  const r = resumirSobre(d, s, HOY);
  const aMano = d.movimientos.filter((m) => m.categoria_id === "cat_comida" && m.fecha_registro >= "2026-10-01" && m.fecha_registro <= HOY).reduce((t, m) => t + m.monto, 0);
  assert.equal(r.gastado, 4000); assert.equal(r.gastado, aMano); assert.equal(r.restante, 6000); assert.equal(r.filas.length, 2);
});
test("cambiar la categoría de un movimiento actualiza el sobre al instante, sin contador guardado", () => {
  const d = conBasicas(); const s = sobreMes(d); const m = gasto(d, "2026-10-10", 3000, { categoriaId: "cat_transporte" });
  assert.equal(resumirSobre(d, s, HOY).gastado, 0);
  asignarCategoria(d, m.id, "cat_comida"); assert.equal(resumirSobre(d, s, HOY).gastado, 3000);
  asignarCategoria(d, m.id, null); assert.equal(resumirSobre(d, s, HOY).gastado, 0);
  assert.equal(JSON.stringify(s).includes("gastado"), false); // nada de gastado dentro del sobre
});
test("un sobre con varias categorías suma todas; una categoría archivada sigue contando su historial", () => {
  const d = conBasicas(); const s = sobreMes(d, { categoriaIds: ["cat_comida", "cat_ocio"] });
  gasto(d, "2026-10-03", 100, { categoriaId: "cat_comida" }); gasto(d, "2026-10-04", 200, { categoriaId: "cat_ocio" });
  archivarCategoriaFinanzas(d, "cat_ocio"); assert.equal(resumirSobre(d, s, HOY).gastado, 300);
});
test("un gasto recurrente cuenta una vez por cada día de pago del periodo", () => {
  const d = conBasicas(); const s = sobreMes(d, { categoriaIds: ["cat_ocio"], limite: 20000 });
  gasto(d, "2026-08-05", 0, { categoriaId: "cat_ocio", nombre: "Streaming", recurrente: { frecuencia: "mensual", fecha_inicio: "2026-08-05", fecha_fin: null, monto_por_pago: 4000 } });
  assert.equal(resumirSobre(d, s, HOY).gastado, 4000); // solo el 5 de octubre, no agosto ni septiembre
  assert.equal(gastosEnPeriodo(d, ["cat_ocio"], "2026-08-01", "2026-10-31", HOY).length, 3);
  const sem = crearSobre(d, { nombre: "Ocio semanal", categoriaIds: ["cat_ocio"], limite: 5000, periodo: "semana" }).sobre; assert.equal(resumirSobre(d, sem, HOY).gastado, 0); // ningún pago esa semana
});
test("los ingresos y transferencias no cuentan como gastado, y con Gastos apagado no hay sobres", () => {
  const d = conBasicas(); const s = sobreMes(d);
  d.movimientos.push(crearMovimiento({ tipo: "ingreso", monto: 9999, fechaRegistro: "2026-10-02", categoriaId: "cat_comida" }));
  d.movimientos.push(crearMovimiento({ tipo: "transferencia", monto: 9999, fechaRegistro: "2026-10-02", categoriaId: "cat_comida" }));
  assert.equal(resumirSobre(d, s, HOY).gastado, 0);
  gasto(d, "2026-10-02", 500, { categoriaId: "cat_comida" }); assert.equal(listarSobres(d, HOY).length, 1);
  d.configuracion.finanzas_modulos = { gastos: false }; assert.deepEqual(listarSobres(d, HOY), []); assert.deepEqual(sobresEnRiesgo(d, HOY), []);
});

console.log("Sobres: avisos con texto");
test("ok por debajo del 80 %, ámbar al 80 %, rojo al agotarse y al superar el límite; siempre con texto", () => {
  const d = conBasicas(); const s = sobreMes(d); const m = gasto(d, "2026-10-02", 7900, { categoriaId: "cat_comida" });
  let r = resumirSobre(d, s, HOY); assert.equal(r.nivel, "ok"); assert.equal(r.fraccionRestante, 0.21); assert.match(r.texto, /Te quedan 2100/);
  m.monto = 8000; r = resumirSobre(d, s, HOY); assert.equal(r.nivel, "ambar"); assert.match(r.texto, /80 %.*2000/);
  m.monto = 10000; r = resumirSobre(d, s, HOY); assert.equal(r.nivel, "rojo"); assert.equal(r.restante, 0); assert.equal(r.fraccionRestante, 0); assert.match(r.texto, /agotado/i);
  m.monto = 12500; r = resumirSobre(d, s, HOY); assert.equal(r.nivel, "rojo"); assert.equal(r.restante, -2500); assert.equal(r.fraccionRestante, 0); assert.match(r.texto, /Superaste el sobre por 2500/);
  assert.ok(!/culpa|mal|error/i.test(r.texto));
});
test("el texto usa el formato de la app (y puede ocultar importes en modo privacidad)", () => {
  const d = conBasicas(); const s = sobreMes(d); gasto(d, "2026-10-02", 2500, { categoriaId: "cat_comida" });
  assert.match(resumirSobre(d, s, HOY, { formato: (n) => "₡" + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ") }).texto, /₡7 500/);
  assert.match(resumirSobre(d, s, HOY, { formato: () => "••••" }).texto, /••••/);
});
test("Inicio: solo los sobres en riesgo, el agotado antes que el ámbar", () => {
  const d = conBasicas(); const a = sobreMes(d, { nombre: "Comida" }); const b = sobreMes(d, { nombre: "Ocio", categoriaIds: ["cat_ocio"] }); sobreMes(d, { nombre: "Transporte", categoriaIds: ["cat_transporte"] });
  gasto(d, "2026-10-02", 8500, { categoriaId: "cat_comida" }); gasto(d, "2026-10-02", 10000, { categoriaId: "cat_ocio" });
  assert.deepEqual(sobresEnRiesgo(d, HOY).map((r) => [r.nombre, r.nivel]), [["Ocio", "rojo"], ["Comida", "ambar"]]); assert.equal(listarSobres(d, HOY).length, 3);
  archivarSobre(d, b.id); assert.equal(sobresEnRiesgo(d, HOY).length, 1);
});
test("un sobre sin periodo válido avisa con texto en vez de romper", () => {
  const d = conBasicas(); const s = crearSobre(d, { nombre: "Semestre", categoriaIds: ["cat_comida"], limite: 100, periodo: "semestre" }).sobre;
  const r = resumirSobre(d, s, HOY); assert.equal(r.nivel, "sin_periodo"); assert.ok(r.texto.length > 5);
});

console.log("Sobres: sobrante que se arrastra");
test("arrastra el sobrante del mes anterior; un exceso no se arrastra como deuda", () => {
  const d = conBasicas(); const s = sobreMes(d, { arrastraSobrante: true, desde: "2026-08-15" });
  gasto(d, "2026-08-20", 4000, { categoriaId: "cat_comida" });  // agosto: sobran 6.000
  gasto(d, "2026-09-10", 12000, { categoriaId: "cat_comida" }); // septiembre: 10.000 + 6.000 − 12.000 = 4.000
  gasto(d, "2026-10-05", 3000, { categoriaId: "cat_comida" });
  const r = resumirSobre(d, s, HOY); assert.equal(r.arrastre, 4000); assert.equal(r.disponibleTotal, 14000); assert.equal(r.restante, 11000);
  gasto(d, "2026-09-12", 9000, { categoriaId: "cat_comida" }); // septiembre se pasa: 10.000 + 6.000 − 21.000 < 0 → arrastra 0, no deuda
  assert.equal(resumirSobre(d, s, HOY).arrastre, 0); assert.equal(resumirSobre(d, s, HOY).restante, 7000);
});
test("el arrastre no mira antes de la vigencia del sobre y semestre o rango no arrastran", () => {
  const d = conBasicas(); const s = sobreMes(d, { arrastraSobrante: true, desde: "2026-10-01" }); gasto(d, "2026-09-10", 1, { categoriaId: "cat_comida" });
  assert.equal(resumirSobre(d, s, HOY).arrastre, 0);
  const r = crearSobre(d, { nombre: "Rango", categoriaIds: ["cat_comida"], limite: 100, periodo: "rango", fechaInicio: "2026-10-01", fechaFin: "2026-10-31", arrastraSobrante: true }).sobre;
  assert.equal(r.arrastra_sobrante, false); assert.equal(calcularArrastre(d, r, periodoDelSobre(d, r, HOY), HOY), 0);
});

console.log("Sobres: editar y quitar");
test("editar valida igual que crear, cambia el periodo y limpia los campos que ya no aplican", () => {
  const d = conBasicas(); const s = sobreMes(d, { arrastraSobrante: true });
  assert.equal(editarSobre(d, s.id, { limite: -5 }).motivo, "limite"); assert.equal(editarSobre(d, "no", {}).motivo, "sobre");
  assert.equal(editarSobre(d, s.id, { periodo: "rango", fechaInicio: "2026-10-01", fechaFin: "2026-10-10", limite: 5000 }).ok, true);
  assert.equal(s.limite, 5000); assert.equal(s.arrastra_sobrante, false); assert.equal(s.fecha_fin, "2026-10-10");
  assert.equal(editarSobre(d, s.id, { periodo: "semana" }).ok, true); assert.equal("fecha_fin" in s, false);
});
test("eliminar un sobre deja tombstone y no toca ningún movimiento ni categoría", () => {
  const d = conBasicas(); const s = sobreMes(d); gasto(d, "2026-10-02", 100, { categoriaId: "cat_comida" });
  const movs = JSON.stringify(d.movimientos), cats = JSON.stringify(d.categorias_finanzas);
  assert.equal(eliminarSobre(d, s.id).ok, true); assert.equal(d.sobres.length, 0); assert.equal(d._eliminados_sobres.at(-1).id, s.id); assert.ok(d._eliminados_sobres.at(-1).eliminadoEn > 0);
  assert.equal(JSON.stringify(d.movimientos), movs); assert.equal(JSON.stringify(d.categorias_finanzas), cats); assert.equal(eliminarSobre(d, s.id).motivo, "sobre");
  const s2 = sobreMes(d); assert.equal(eliminarCategoriaFinanzas(d, "cat_comida").motivo, "en_uso"); assert.ok(s2);
});
test("calcular sobres no modifica los datos", () => {
  const d = conBasicas(); sobreMes(d, { arrastraSobrante: true }); gasto(d, "2026-10-02", 100, { categoriaId: "cat_comida" });
  const antes = JSON.stringify(d); listarSobres(d, HOY); sobresEnRiesgo(d, HOY); resumenMensual(d, { hoy: HOY }); agruparSinCategoriaPorNombre(d, { hoy: HOY });
  assert.equal(JSON.stringify(d), antes);
});

console.log("Resumen mensual");
test("totales por categoría, lo sin categoría aparte, y todo suma el total", () => {
  const d = conBasicas();
  gasto(d, "2026-10-02", 6000, { categoriaId: "cat_comida" }); gasto(d, "2026-10-09", 2000, { categoriaId: "cat_transporte" }); gasto(d, "2026-10-12", 2000);
  gasto(d, "2026-10-30", 5000, { categoriaId: "cat_comida" }); // aún no ocurrió
  d.movimientos.push(crearMovimiento({ tipo: "ingreso", nombre: "Beca", monto: 50000, fechaRegistro: "2026-10-01" }));
  const r = resumenMensual(d, { hoy: HOY });
  assert.equal(r.mes, "2026-10"); assert.equal(r.gastos.total, 10000); assert.deepEqual(r.gastos.categorias.map((c) => [c.nombre, c.monto, c.porcentaje]), [["Comida", 6000, 60], ["Transporte", 2000, 20]]);
  assert.deepEqual(r.gastos.sinCategoria, { monto: 2000, porcentaje: 20 });
  assert.equal(r.gastos.categorias.reduce((t, c) => t + c.monto, 0) + r.gastos.sinCategoria.monto, r.gastos.total);
  assert.equal(r.ingresos.total, 50000); assert.equal(r.balance, 40000);
});
test("compara con el mes anterior sin juicios; si el anterior no tiene gastos, no hay comparación", () => {
  const d = conBasicas(); gasto(d, "2026-09-10", 10000, { categoriaId: "cat_comida" }); gasto(d, "2026-10-10", 8800, { categoriaId: "cat_comida" });
  const r = resumenMensual(d, { hoy: HOY }); assert.deepEqual(r.comparacion, { mesAnterior: "2026-09", totalAnterior: 10000, diferencia: -1200, porcentaje: -12 });
  assert.equal(resumenMensual(d, { mes: "2026-09", hoy: HOY }).comparacion, null);
  assert.equal(resumenMensual(d, { mes: "2027-01", hoy: HOY }).gastos.total, 0);
  const enero = conBasicas(); gasto(enero, "2026-12-20", 100, { categoriaId: "cat_comida" }); assert.equal(resumenMensual(enero, { mes: "2027-01", hoy: "2027-01-15" }).comparacion.mesAnterior, "2026-12");
});
test("el resumen mensual y el sobre del mes coinciden sobre la misma categoría", () => {
  const d = conBasicas(); const s = sobreMes(d, { limite: 50000 });
  [["2026-10-01", 1200], ["2026-10-07", 3400], ["2026-10-19", 560]].forEach(([f, m]) => gasto(d, f, m, { categoriaId: "cat_comida" }));
  assert.equal(resumirSobre(d, s, HOY).gastado, resumenMensual(d, { hoy: HOY }).gastos.categorias.find((c) => c.id === "cat_comida").monto);
});

console.log(`\n${ok} pruebas de lógica OK`);
