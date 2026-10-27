// Pruebas de la sesión 8 (Node, sin DOM): Esencial o Flexible, micro-consejos, metas sugeridas, reparto de ingresos,
// recordatorio por meta y metas de gasto, con schema.js, storage-merge.js y los derivados reales.
import assert from "node:assert/strict";
import * as schema from "../core/schema.js";
import { fusionarDatos } from "../core/storage-merge.js";
import { aplicarModulosFinanzas } from "../core/finanzas-perfiles.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import { crearMeta, crearMovimiento } from "../core/finanzas-modelo.js";
import { calcularDisponible } from "../core/finanzas-disponible.js";
import { crearCategoriaFinanzas, editarCategoriaFinanzas, listarCategorias } from "../core/finanzas-categorias.js";
import { resumenMensual } from "../core/finanzas-sobres.js";
import { CONSEJOS, activarConsejos, consejoDe, consejosActivos } from "../core/finanzas-consejos.js";
import { fechaEnMeses, sugerirMetas } from "../core/finanzas-metas-sugeridas.js";
import { aplicarReparto, configurarReparto, proponerReparto } from "../core/finanzas-reparto.js";
import { posponerRecordatorio, recordatoriosDeMetas } from "../core/finanzas-recordatorios.js";
import { configurarPlanMeta } from "../core/finanzas-metas-plan.js";
import { archivarMetaGasto, crearMetaGasto, editarMetaGasto, eliminarMetaGasto, listarMetasGasto, resumirMetaGasto } from "../core/finanzas-metas-gasto.js";
import { registrarMovimientoRapido, tiposDisponiblesRegistroRapido } from "../core/finanzas-registro.js";
import { exportarRespaldoJson } from "../core/finanzas-importar.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const HOY = "2026-10-26"; // lunes
const nuevo = () => schema.migrarDatosAntiguos(JSON.parse(JSON.stringify(schema.crearDatosUsuarioNuevo())));
const gasto = (d, nombre, monto, fecha = HOY, catId = null) => { const m = crearMovimiento({ tipo: "gasto", nombre, monto, fechaRegistro: fecha, categoriaId: catId }); d.movimientos.push(m); return m; };
const ingreso = (d, nombre, monto, fecha = HOY, extra = {}) => { const m = crearMovimiento({ tipo: "ingreso", nombre, monto, fechaRegistro: fecha, ...extra }); d.movimientos.push(m); return m; };
const meta = (d, p) => { const m = crearMeta(p); d.metas.push(m); return m; };
const T = (d) => calcularTotalesMovimientos(d, HOY);
const copia = (x) => JSON.parse(JSON.stringify(x));

console.log("Esencial o Flexible");
test("marcar una categoría de gasto la deja Esencial o Flexible; sin marcar no tiene la clave y 'null' la quita", () => {
  const d = nuevo(); const cat = listarCategorias(d, { tipo: "gasto" })[0];
  assert.equal("prioridad" in cat, false);
  assert.equal(editarCategoriaFinanzas(d, cat.id, { prioridad: "esencial" }).ok, true); assert.equal(cat.prioridad, "esencial");
  editarCategoriaFinanzas(d, cat.id, { prioridad: "flexible" }); assert.equal(cat.prioridad, "flexible");
  editarCategoriaFinanzas(d, cat.id, { prioridad: null }); assert.equal("prioridad" in cat, false);
});
test("valores raros y categorías de ingreso se rechazan sin tocar nada", () => {
  const d = nuevo(); const cat = listarCategorias(d, { tipo: "gasto" })[0]; const ing = crearCategoriaFinanzas(d, { nombre: "Mesada", tipo: "ingreso" }).categoria;
  assert.equal(editarCategoriaFinanzas(d, cat.id, { prioridad: "urgente" }).motivo, "prioridad"); assert.equal("prioridad" in cat, false);
  assert.equal(editarCategoriaFinanzas(d, ing.id, { prioridad: "esencial" }).motivo, "prioridad"); assert.equal("prioridad" in ing, false);
});
test("el resumen del mes reparte lo gastado en Esencial, Flexible y Sin marcar, y la suma da el total", () => {
  const d = nuevo(); const [a, b, c] = listarCategorias(d, { tipo: "gasto" });
  editarCategoriaFinanzas(d, a.id, { prioridad: "esencial" }); editarCategoriaFinanzas(d, b.id, { prioridad: "flexible" });
  gasto(d, "Casa", 5000, "2026-10-05", a.id); gasto(d, "Cine", 2000, "2026-10-06", b.id); gasto(d, "Otro", 300, "2026-10-07", c.id); gasto(d, "Suelto", 700, "2026-10-08");
  const r = resumenMensual(d, { mes: "2026-10", hoy: HOY }).gastos;
  assert.deepEqual(r.prioridad, { esencial: 5000, flexible: 2000, sinMarcar: 1000 }); assert.equal(r.prioridad.esencial + r.prioridad.flexible + r.prioridad.sinMarcar, r.total);
});
test("sin ninguna marca todo queda en Sin marcar (la pantalla no muestra la línea) y archivar no pierde la marca", () => {
  const d = nuevo(); const [a] = listarCategorias(d, { tipo: "gasto" }); gasto(d, "Casa", 400, "2026-10-05", a.id);
  assert.deepEqual(resumenMensual(d, { mes: "2026-10", hoy: HOY }).gastos.prioridad, { esencial: 0, flexible: 0, sinMarcar: 400 });
  editarCategoriaFinanzas(d, a.id, { prioridad: "esencial" }); a.archivada = true;
  assert.equal(resumenMensual(d, { mes: "2026-10", hoy: HOY }).gastos.prioridad.esencial, 400);
});

console.log("Micro-consejos");
test("hay un consejo corto, sin guion largo, para cada módulo y los desconocidos no tienen", () => {
  const d = nuevo();
  ["gastos", "ahorros", "matricula", "beca", "deudas", "cuentas"].forEach((m) => { const c = consejoDe(d, m); assert.ok(c && c.length < 140, m); assert.equal(/[—–]/.test(c), false, m); });
  assert.equal(consejoDe(d, "inventado"), null); assert.equal(Object.keys(CONSEJOS).length, 6);
});
test("se apagan y se encienden desde la configuración, y la preferencia viaja con la fusión", () => {
  const d = nuevo(); assert.equal(consejosActivos(d), true); activarConsejos(d, false);
  assert.equal(consejosActivos(d), false); assert.equal(consejoDe(d, "gastos"), null);
  const otro = nuevo(); const f = fusionarDatos(otro, d); assert.equal(consejosActivos(f), false);
  activarConsejos(d, true); assert.equal(consejoDe(d, "ahorros") !== null, true);
});

console.log("Metas sugeridas de 3 meses");
test("fechaEnMeses suma 3 meses y ajusta el fin de mes (31 de enero + 1 mes = 28 de febrero)", () => {
  assert.equal(fechaEnMeses("2026-10-26", 3), "2027-01-26"); assert.equal(fechaEnMeses("2027-01-31", 1), "2027-02-28"); assert.equal(fechaEnMeses("2028-01-31", 1), "2028-02-29");
  assert.equal(fechaEnMeses("2026-11-30", 3), "2027-02-28"); assert.equal(fechaEnMeses("mala"), null);
});
test("las sugerencias traen fecha a 3 meses y se saltan las que ya tienes activas", () => {
  const d = nuevo(); const todas = sugerirMetas(d, HOY); assert.equal(todas.length, 4); assert.ok(todas.every((s) => s.fechaObjetivo === "2027-01-26"));
  meta(d, { nombre: "Fondo de emergencia", objetivo: 1000 }); assert.equal(sugerirMetas(d, HOY).some((s) => s.id === "emergencia"), false);
  d.metas[0].archivada = true; assert.equal(sugerirMetas(d, HOY).some((s) => s.id === "emergencia"), true);
});

console.log("Reparto de ingresos hacia metas");
test("configurar la regla valida porcentaje y origen, y quitarla borra la clave", () => {
  const d = nuevo(); const m = meta(d, { nombre: "Laptop", objetivo: 1000 });
  assert.equal(configurarReparto(d, m.id, { porcentaje: 0 }).motivo, "porcentaje"); assert.equal(configurarReparto(d, m.id, { porcentaje: 101 }).motivo, "porcentaje");
  assert.equal(configurarReparto(d, m.id, { porcentaje: 10, origen: "x" }).motivo, "origen"); assert.equal("reparto" in m, false);
  assert.equal(configurarReparto(d, m.id, { porcentaje: 10 }).ok, true); assert.deepEqual(m.reparto, { porcentaje: 10, origen: "todo" });
  configurarReparto(d, m.id, null); assert.equal("reparto" in m, false); assert.equal(configurarReparto(d, "nada", { porcentaje: 5 }).motivo, "meta");
});
test("un ingreso de 10.000 con una regla del 10 % propone 1.000 y no mueve nada hasta confirmar", () => {
  const d = nuevo(); const m = meta(d, { nombre: "Laptop", objetivo: 50000 }); configurarReparto(d, m.id, { porcentaje: 10 });
  const ing = ingreso(d, "Mesada", 10000); const antes = T(d).saldoLiquido;
  const p = proponerReparto(d, ing); assert.equal(p.length, 1); assert.equal(p[0].monto, 1000); assert.equal(p[0].metaId, m.id); assert.equal(T(d).saldoLiquido, antes); assert.equal(d.movimientos.length, 1);
});
test("confirmar crea un aporte normal 'De mi dinero': Mi dinero baja, la meta sube y el ingreso sigue entero", () => {
  const d = nuevo(); const m = meta(d, { nombre: "Laptop", objetivo: 50000 }); configurarReparto(d, m.id, { porcentaje: 10 });
  const ing = ingreso(d, "Mesada", 10000); const r = aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 1000 }]);
  assert.equal(r.ok, true); assert.equal(r.creados.length, 1); const a = r.creados[0];
  assert.equal(a.tipo, "ahorro"); assert.equal(a.fuente, "liquido"); assert.equal(a.meta_id, m.id); assert.equal(a.reparto_de, ing.id); assert.equal(a.monto, 1000);
  const t = T(d); assert.equal(t.saldoLiquido, 9000); assert.equal(t.totalIngresos, 10000); assert.equal(t.totalGastado, 0); assert.equal(t.enMetas, 1000);
});
test("confirmar dos veces no duplica, y una vez repartido ya no se vuelve a proponer", () => {
  const d = nuevo(); const m = meta(d, { nombre: "L", objetivo: 5000 }); configurarReparto(d, m.id, { porcentaje: 20 });
  const ing = ingreso(d, "Mesada", 1000); aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 200 }]);
  const r2 = aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 200 }]); assert.equal(r2.creados.length, 0); assert.equal(r2.omitidos, 1);
  assert.equal(d.movimientos.filter((x) => x.tipo === "ahorro").length, 1); assert.equal(proponerReparto(d, ing).length, 0);
});
test("el monto se puede cambiar, pero no pasar del ingreso, ni ser cero, ni ir a una meta archivada o de gasto", () => {
  const d = nuevo(); const m = meta(d, { nombre: "L", objetivo: 5000 }); const ing = ingreso(d, "Mesada", 1000);
  assert.equal(aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 1500 }]).motivo, "excede"); assert.equal(aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 0 }]).motivo, "monto");
  const g = crearMetaGasto(d, { nombre: "Tope", tope: 100, fechaInicio: HOY }).meta; assert.equal(aplicarReparto(d, ing.id, [{ metaId: g.id, monto: 10 }]).motivo, "meta");
  m.archivada = true; assert.equal(aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 10 }]).motivo, "meta"); assert.equal(d.movimientos.filter((x) => x.tipo === "ahorro").length, 0);
  m.archivada = false; assert.equal(aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 300 }]).creados[0].monto, 300);
});
test("si el ingreso se deshizo antes de confirmar, no se crea nada", () => {
  const d = nuevo(); const m = meta(d, { nombre: "L", objetivo: 5000 }); const ing = ingreso(d, "Mesada", 1000); d.movimientos = [];
  assert.equal(aplicarReparto(d, ing.id, [{ metaId: m.id, monto: 100 }]).motivo, "movimiento");
});
test("el origen filtra: 'ingreso' ignora la beca, 'beca' solo la beca y 'todo' todo", () => {
  const d = nuevo(); const a = meta(d, { nombre: "A", objetivo: 1 }), b = meta(d, { nombre: "B", objetivo: 1 }), c = meta(d, { nombre: "C", objetivo: 1 });
  configurarReparto(d, a.id, { porcentaje: 10, origen: "ingreso" }); configurarReparto(d, b.id, { porcentaje: 10, origen: "beca" }); configurarReparto(d, c.id, { porcentaje: 10, origen: "todo" });
  const normal = ingreso(d, "Mesada", 1000), beca = ingreso(d, "Beca", 1000, HOY, { origen: "beca" });
  assert.deepEqual(proponerReparto(d, normal).map((x) => x.metaId), [a.id, c.id]); assert.deepEqual(proponerReparto(d, beca).map((x) => x.metaId), [b.id, c.id]);
});
test("varias reglas que suman más del 100 % nunca proponen más que el ingreso", () => {
  const d = nuevo(); const a = meta(d, { nombre: "A", objetivo: 1 }), b = meta(d, { nombre: "B", objetivo: 1 }); configurarReparto(d, a.id, { porcentaje: 70 }); configurarReparto(d, b.id, { porcentaje: 60 });
  const p = proponerReparto(d, ingreso(d, "X", 1000)); assert.equal(p.reduce((s, x) => s + x.monto, 0), 1000); assert.deepEqual(p.map((x) => x.monto), [700, 300]);
});
test("no propone para gastos, recurrentes, metas archivadas ni con Ahorros apagado", () => {
  const d = nuevo(); const m = meta(d, { nombre: "L", objetivo: 5000 }); configurarReparto(d, m.id, { porcentaje: 10 });
  assert.deepEqual(proponerReparto(d, gasto(d, "Pan", 100)), []);
  const rec = crearMovimiento({ tipo: "ingreso", nombre: "Mesada", monto: 0, fechaRegistro: HOY, recurrente: { frecuencia: "mensual", fecha_inicio: HOY, monto_por_pago: 1000 } }); assert.deepEqual(proponerReparto(d, rec), []);
  const ing = ingreso(d, "Mesada", 1000); assert.equal(proponerReparto(d, ing).length, 1);
  m.archivada = true; assert.equal(proponerReparto(d, ing).length, 0); m.archivada = false;
  aplicarModulosFinanzas(d, { ahorros: false }); assert.equal(proponerReparto(d, ing).length, 0);
});
test("la regla viaja con la meta en la fusión entre dispositivos y el aporte no se duplica", () => {
  const a = nuevo(); const m = meta(a, { nombre: "L", objetivo: 5000 }); configurarReparto(a, m.id, { porcentaje: 15, origen: "beca" });
  const b = copia(fusionarDatos(nuevo(), a)); const mb = b.metas.find((x) => x.id === m.id); assert.deepEqual(mb.reparto, { porcentaje: 15, origen: "beca" });
  const ing = ingreso(a, "Beca", 1000, HOY, { origen: "beca" }); aplicarReparto(a, ing.id, [{ metaId: m.id, monto: 150 }]);
  const f = fusionarDatos(fusionarDatos(b, a), a); assert.equal(f.movimientos.filter((x) => x.tipo === "ahorro").length, 1);
});

console.log("Un recordatorio por meta");
const conAporte = (d, p = {}, aporte = {}) => { const m = meta(d, { nombre: "Laptop", objetivo: 50000, ...p }); configurarPlanMeta(d, m.id, { aporte: { monto: 5000, frecuencia: "semanal", fechaInicio: "2026-10-05", recordar: true, ...aporte } }); return m; };
test("el plan guarda 'recordar' solo cuando está encendido (los aportes de siempre no cambian de forma)", () => {
  const d = nuevo(); const m = conAporte(d); assert.equal(m.aporte_programado.recordar, true);
  const n = conAporte(d, { nombre: "Otra" }, { recordar: false }); assert.equal("recordar" in n.aporte_programado, false);
});
test("llegó el día de aportar y no aportaste: sale un recordatorio con el nombre y el aporte", () => {
  const d = nuevo(); const m = conAporte(d); // aporte semanal desde el lunes 5 de octubre: hoy lunes 26 toca
  const r = recordatoriosDeMetas(d, HOY); assert.equal(r.length, 1); assert.equal(r[0].metaId, m.id); assert.equal(r[0].fecha, "2026-10-26"); assert.equal(r[0].monto, 5000); assert.equal(r[0].nombre, "Laptop");
});
test("un día cualquiera de la semana cuenta el último día de aporte (jueves: el lunes pasado)", () => {
  const d = nuevo(); conAporte(d); assert.equal(recordatoriosDeMetas(d, "2026-10-29")[0].fecha, "2026-10-26");
});
test("aportar a la meta desde ese día quita el recordatorio; un aporte anterior no lo quita", () => {
  const d = nuevo(); const m = conAporte(d);
  d.movimientos.push(crearMovimiento({ tipo: "ahorro", nombre: "x", monto: 100, fechaRegistro: "2026-10-25", metaId: m.id, fuente: "liquido" })); assert.equal(recordatoriosDeMetas(d, HOY).length, 1);
  d.movimientos.push(crearMovimiento({ tipo: "ahorro", nombre: "x", monto: 100, fechaRegistro: "2026-10-27", metaId: m.id, fuente: "liquido" })); assert.equal(recordatoriosDeMetas(d, "2026-10-28").length, 0);
});
test("aportar justo el día que tocaba también quita el recordatorio", () => {
  const d = nuevo(); const m = conAporte(d); assert.equal(recordatoriosDeMetas(d, HOY).length, 1);
  d.movimientos.push(crearMovimiento({ tipo: "ahorro", nombre: "x", monto: 100, fechaRegistro: HOY, metaId: m.id, fuente: "liquido" })); assert.equal(recordatoriosDeMetas(d, HOY).length, 0);
});
test("la marca de reparto solo existe en aportes de ahorro", () => {
  assert.equal("reparto_de" in crearMovimiento({ tipo: "gasto", nombre: "x", monto: 1, repartoDe: "mov_1" }), false);
  assert.equal(crearMovimiento({ tipo: "ahorro", nombre: "x", monto: 1, metaId: "meta_1", repartoDe: "mov_1" }).reparto_de, "mov_1");
});
test("'Ahora no' lo quita para ese día y vuelve con el siguiente día de aporte; no insiste con varios periodos perdidos", () => {
  const d = nuevo(); const m = conAporte(d); const [r] = recordatoriosDeMetas(d, HOY);
  assert.equal(posponerRecordatorio(d, m.id, r.fecha), true); assert.equal(recordatoriosDeMetas(d, HOY).length, 0); assert.equal(recordatoriosDeMetas(d, "2026-10-29").length, 0);
  const sig = recordatoriosDeMetas(d, "2026-11-02"); assert.equal(sig.length, 1); assert.equal(sig[0].fecha, "2026-11-02");
  assert.equal(recordatoriosDeMetas(d, "2026-11-20").length, 1); assert.equal(recordatoriosDeMetas(d, "2026-11-20")[0].fecha, "2026-11-16");
});
test("no hay recordatorio si no lo pediste, si falta el aporte, si aún no empieza, o con la meta archivada o Ahorros apagado", () => {
  const d = nuevo(); const sin = conAporte(d, { nombre: "Sin" }, { recordar: false }); assert.equal(recordatoriosDeMetas(d, HOY).length, 0);
  const futura = conAporte(d, { nombre: "Futura" }, { fechaInicio: "2026-12-01" }); assert.equal(recordatoriosDeMetas(d, HOY).length, 0);
  futura.aporte_programado.fechaInicio = undefined; const ok1 = conAporte(d, { nombre: "Activa" }); assert.equal(recordatoriosDeMetas(d, HOY).length, 1);
  ok1.archivada = true; assert.equal(recordatoriosDeMetas(d, HOY).length, 0); ok1.archivada = false; aplicarModulosFinanzas(d, { ahorros: false }); assert.equal(recordatoriosDeMetas(d, HOY).length, 0);
  assert.equal(posponerRecordatorio(d, "nada", HOY), false); assert.equal(posponerRecordatorio(d, ok1.id, "mal"), false);
});
test("un recordatorio mensual mira hasta 45 días atrás", () => {
  const d = nuevo(); conAporte(d, {}, { frecuencia: "mensual", fechaInicio: "2026-09-15" }); const r = recordatoriosDeMetas(d, HOY); assert.equal(r.length, 1); assert.equal(r[0].fecha, "2026-10-15");
});

console.log("Metas de gasto");
test("una meta de gasto lleva tipo, tope, inicio y categorías; las de ahorro no ganan esas claves", () => {
  const d = nuevo(); const cat = listarCategorias(d, { tipo: "gasto" })[0];
  const r = crearMetaGasto(d, { nombre: "Comida del mes", tope: 50000, categoriaIds: [cat.id], fechaInicio: "2026-10-01", fechaFin: "2026-10-31" });
  assert.equal(r.ok, true); const m = r.meta; assert.equal(m.tipo, "gasto"); assert.equal(m.objetivo, 50000); assert.equal(m.fecha_inicio, "2026-10-01"); assert.equal(m.fecha_objetivo, "2026-10-31"); assert.deepEqual(m.categoria_ids, [cat.id]);
  const a = meta(d, { nombre: "Ahorro", objetivo: 1 }); assert.equal(a.tipo, "ahorro"); assert.equal("categoria_ids" in a, false); assert.equal("fecha_inicio" in a, false);
});
test("valida nombre, tope, fechas y categorías sin crear nada", () => {
  const d = nuevo(); const ing = crearCategoriaFinanzas(d, { nombre: "Mesada", tipo: "ingreso" }).categoria; const base = { nombre: "X", tope: 100, fechaInicio: "2026-10-01" };
  const mot = (p) => crearMetaGasto(d, { ...base, ...p }).motivo;
  assert.equal(mot({ nombre: " " }), "nombre"); assert.equal(mot({ nombre: "a".repeat(41) }), "largo"); assert.equal(mot({ tope: 0 }), "tope"); assert.equal(mot({ tope: -5 }), "tope");
  assert.equal(mot({ fechaInicio: "2026-02-30" }), "inicio"); assert.equal(mot({ fechaFin: "2026-09-01" }), "fin"); assert.equal(mot({ fechaFin: "mal" }), "fin");
  assert.equal(mot({ categoriaIds: ["nada"] }), "categoria"); assert.equal(mot({ categoriaIds: [ing.id] }), "categoria"); assert.equal(d.metas.length, 0);
});
test("lo gastado sale de los gastos reales dentro del periodo y de las categorías elegidas", () => {
  const d = nuevo(); const [com, tra] = listarCategorias(d, { tipo: "gasto" });
  const m = crearMetaGasto(d, { nombre: "Comida", tope: 10000, categoriaIds: [com.id], fechaInicio: "2026-10-01", fechaFin: "2026-10-31" }).meta;
  gasto(d, "A", 3000, "2026-10-10", com.id); gasto(d, "B", 2000, "2026-10-20", com.id); gasto(d, "Bus", 9999, "2026-10-12", tra.id); gasto(d, "Viejo", 8000, "2026-09-30", com.id); gasto(d, "Futuro", 700, "2026-10-30", com.id);
  ingreso(d, "Mesada", 5000, "2026-10-11");
  const r = resumirMetaGasto(d, m, HOY); assert.equal(r.gastado, 5000); assert.equal(r.restante, 5000); assert.equal(r.porcentaje, 50); assert.equal(r.nivel, "bien"); assert.equal(r.texto, "Vas bien");
});
test("sin categorías elegidas cuentan todos los gastos (y la meta no suma nada al ahorro ni a Mi dinero)", () => {
  const d = nuevo(); const antes = copia(T(d)); const m = crearMetaGasto(d, { nombre: "Todo", tope: 1000, fechaInicio: "2026-10-01" }).meta;
  gasto(d, "A", 300, "2026-10-05"); gasto(d, "B", 200, "2026-10-06", listarCategorias(d, { tipo: "gasto" })[1].id);
  assert.equal(resumirMetaGasto(d, m, HOY).gastado, 500); const t = T(d); assert.equal(t.enMetas, antes.enMetas); assert.equal(t.saldoLiquido, -500);
});
test("niveles con texto: cerca desde el 80 %, llegaste al tope, pasaste el tope con cuánto excede", () => {
  const d = nuevo(); const m = crearMetaGasto(d, { nombre: "T", tope: 1000, fechaInicio: "2026-10-01" }).meta;
  assert.equal(resumirMetaGasto(d, m, HOY).nivel, "bien"); gasto(d, "a", 800, "2026-10-02"); assert.equal(resumirMetaGasto(d, m, HOY).nivel, "cerca");
  gasto(d, "b", 200, "2026-10-03"); const r = resumirMetaGasto(d, m, HOY); assert.equal(r.nivel, "tope"); assert.equal(r.restante, 0);
  gasto(d, "c", 150, "2026-10-04"); const p = resumirMetaGasto(d, m, HOY); assert.equal(p.nivel, "pasado"); assert.equal(p.excedido, 150); assert.equal(p.porcentaje, 100); assert.equal(p.texto, "Pasaste el tope");
});
test("con fecha final dice cuánto puedes gastar por día; sin ella no inventa nada", () => {
  const d = nuevo(); const m = crearMetaGasto(d, { nombre: "T", tope: 10000, fechaInicio: "2026-10-01", fechaFin: "2026-10-31" }).meta; gasto(d, "a", 3000, "2026-10-10");
  const r = resumirMetaGasto(d, m, HOY); assert.equal(r.diasRestantes, 6); assert.equal(r.porDia, 1166.67); // 7000 entre los 6 días que quedan, hoy incluido
  const s = crearMetaGasto(d, { nombre: "S", tope: 10000, fechaInicio: "2026-10-01" }).meta; assert.equal(resumirMetaGasto(d, s, HOY).porDia, null); assert.equal(resumirMetaGasto(d, s, HOY).diasRestantes, null);
});
test("una meta que aún no empieza no cuenta gastos; una terminada no cuenta lo posterior", () => {
  const d = nuevo(); const futura = crearMetaGasto(d, { nombre: "F", tope: 100, fechaInicio: "2026-11-01" }).meta; gasto(d, "a", 50, HOY);
  const f = resumirMetaGasto(d, futura, HOY); assert.equal(f.nivel, "futura"); assert.equal(f.gastado, 0);
  const vieja = crearMetaGasto(d, { nombre: "V", tope: 100, fechaInicio: "2026-09-01", fechaFin: "2026-09-30" }).meta; gasto(d, "b", 40, "2026-09-15");
  const v = resumirMetaGasto(d, vieja, HOY); assert.equal(v.terminada, true); assert.equal(v.gastado, 40); assert.equal(v.texto, "Te quedaste dentro del tope"); assert.equal(v.porDia, null);
});
test("un gasto recurrente cuenta una vez por cada día de pago dentro del periodo", () => {
  const d = nuevo(); const m = crearMetaGasto(d, { nombre: "R", tope: 10000, fechaInicio: "2026-10-01" }).meta;
  d.movimientos.push(crearMovimiento({ tipo: "gasto", nombre: "Gym", monto: 0, fechaRegistro: "2026-10-05", recurrente: { frecuencia: "semanal", fecha_inicio: "2026-10-05", monto_por_pago: 1000 } }));
  assert.equal(resumirMetaGasto(d, m, HOY).gastado, 4000); // 5, 12, 19 y 26 de octubre
});
test("editar valida el resultado completo; archivar y eliminar dejan tumba y no tocan los gastos", () => {
  const d = nuevo(); const m = crearMetaGasto(d, { nombre: "T", tope: 1000, fechaInicio: "2026-10-01" }).meta; gasto(d, "a", 100, "2026-10-02");
  assert.equal(editarMetaGasto(d, m.id, { tope: 0 }).motivo, "tope"); assert.equal(m.objetivo, 1000); assert.equal(editarMetaGasto(d, m.id, { fechaFin: "2026-09-01" }).motivo, "fin");
  assert.equal(editarMetaGasto(d, m.id, { nombre: "Nuevo", tope: 2000, emoji: "🍽️" }).ok, true); assert.equal(m.nombre, "Nuevo"); assert.equal(m.objetivo, 2000); assert.equal(m.emoji, "🍽️");
  assert.equal(listarMetasGasto(d).length, 1); archivarMetaGasto(d, m.id, true); assert.equal(listarMetasGasto(d).length, 0); assert.equal(listarMetasGasto(d, { incluirArchivadas: true }).length, 1);
  assert.equal(eliminarMetaGasto(d, m.id).ok, true); assert.equal(d.metas.length, 0); assert.equal(d._eliminados_metas.some((x) => x.id === m.id), true); assert.equal(d.movimientos.length, 1);
  assert.equal(editarMetaGasto(d, meta(d, { nombre: "Ahorro", objetivo: 1 }).id, { tope: 5 }).motivo, "tipo");
});
test("una meta de gasto no aparece como meta de ahorro: ni en el registro rápido, ni en Mi dinero, ni en Disponible", () => {
  const d = nuevo(); crearMetaGasto(d, { nombre: "Tope", tope: 1000, fechaInicio: "2026-10-01" });
  assert.equal(tiposDisponiblesRegistroRapido(d).includes("ahorro"), false);
  const g = d.metas[0]; assert.equal(registrarMovimientoRapido(d, { tipo: "ahorro", monto: 100, nombre: "x", fecha: HOY, metaId: g.id, fuente: "liquido" }).motivo, "meta");
  const a = meta(d, { nombre: "Ahorro", objetivo: 5000, saldoInicial: 300 }); assert.equal(tiposDisponiblesRegistroRapido(d).includes("ahorro"), true); assert.equal(T(d).enMetas, 300);
  const base = calcularDisponible(nuevo(), HOY); const conMeta = nuevo(); crearMetaGasto(conMeta, { nombre: "Tope", tope: 1000, fechaInicio: "2026-10-01" }); assert.equal(calcularDisponible(conMeta, HOY).disponible, base.disponible);
});
test("sincroniza con las metas y el respaldo JSON la incluye; la fusión conserva tope y categorías", () => {
  const a = nuevo(); const cat = listarCategorias(a, { tipo: "gasto" })[0]; const m = crearMetaGasto(a, { nombre: "Comida", tope: 7000, categoriaIds: [cat.id], fechaInicio: "2026-10-01", fechaFin: "2026-10-31" }).meta;
  const f = fusionarDatos(nuevo(), a); const mf = f.metas.find((x) => x.id === m.id); assert.equal(mf.tipo, "gasto"); assert.equal(mf.objetivo, 7000); assert.deepEqual(mf.categoria_ids, [cat.id]);
  const json = JSON.stringify(exportarRespaldoJson(a)); assert.ok(json.includes("categoria_ids") && json.includes("Comida"));
  eliminarMetaGasto(f, m.id); const g = fusionarDatos(a, f); assert.equal(g.metas.some((x) => x.id === m.id), false);
});

console.log(`\n${ok} pruebas de lógica de la sesión 8 OK`);
