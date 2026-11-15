// Pruebas de la lógica de proyección del plan (Node, sin DOM): requisitos Y/O, correquisitos, ruta rápida, plan sugerido, bloques, ritmo y meta.
import assert from "node:assert/strict";
import { calcularBloques, calcularMeta, calcularRitmo, crearContexto, crearPeriodosPorDefecto, generarPeriodos, materiasDisponibles, materiasImposibles, normalizarPeriodo, simularRuta } from "../js/plan/plan-proyeccion.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };
const c = (valor) => ({ tipo: "codigo", valor });
const Y = (...hijos) => ({ tipo: "Y", hijos });
const O = (...hijos) => ({ tipo: "O", hijos });
const mat = (codigo, bloque, creditos, requisitos = null, extra = {}) => ({ codigo, nombre: codigo, bloque, creditos, requisitos, correquisitos: null, ...extra });
const HOY = new Date(2026, 10, 14); // 14-nov-2026

const PLAN = [
  mat("A1", 1, 4), mat("A2", 1, 4), mat("B1", 2, 4, c("A1")), mat("B2", 2, 4, Y(c("A1"), c("A2"))),
  mat("C1", 3, 4, O(c("B1"), c("B2"))), mat("C2", 3, 4, Y(c("B1"), O(c("B2"), c("ZZ")))), mat("D1", 4, 6, Y(c("C1"), c("C2"))),
];
const ctx = crearContexto(PLAN);
const set = (...codigos) => new Set(codigos);
const periodos = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ nombre: `P${i + 1}`, start: new Date(2027, i, 1), end: new Date(2027, i, 28), amin: 0, lim: 18, min: 8, max: 8, ...extra }));

console.log("Requisitos (árbol Y/O)");
test("disponibles respetan Y y O", () => {
  assert.deepEqual(materiasDisponibles(ctx, set()).map((m) => m.codigo), ["A1", "A2"]);
  assert.deepEqual(materiasDisponibles(ctx, set("A1")).map((m) => m.codigo), ["A2", "B1"]);
  assert.deepEqual(materiasDisponibles(ctx, set("A1", "B1")).map((m) => m.codigo), ["A2", "C1"]);
});
test("código fuera del plan NO cumple (igual que la luz del plan)", () => {
  assert.deepEqual(materiasDisponibles(ctx, set("A1", "A2", "B1")).map((m) => m.codigo), ["B2", "C1"]);
  const rotas = crearContexto([mat("X", 1, 3), mat("Y1", 2, 3, c("FUERA"))]);
  assert.deepEqual(materiasImposibles(rotas, set()).map((m) => m.codigo), ["Y1"]);
  assert.deepEqual(materiasImposibles(ctx, set()), []);
});
test("dependientes cuentan requisitos y correquisitos", () => {
  assert.equal(ctx.dependientes.get("A1"), 2);
  assert.equal(ctx.dependientes.get("B1"), 2);
  const co = crearContexto([mat("L", 1, 3), mat("T", 1, 3, null, { correquisitos: c("L") })]);
  assert.equal(co.dependientes.get("L"), 1);
});

console.log("Ruta período por período");
test("lo que se desbloquea se lleva desde el período siguiente", () => {
  const r = simularRuta(ctx, set(), "todo", periodos(10));
  assert.equal(r.completo, true);
  assert.deepEqual(r.plan.map((p) => p.materias.map((m) => m.codigo)), [["A1", "A2"], ["B1", "B2"], ["C1", "C2"], ["D1"]]);
  assert.equal(r.fin.nombre, "P4");
});
test("respeta el tope de créditos y prioriza lo que desbloquea más", () => {
  const r = simularRuta(ctx, set(), "rango", periodos(10, { max: 4 }));
  assert.deepEqual(r.plan[0].materias.map((m) => m.codigo), ["A1"]); // A1 desbloquea 2, A2 desbloquea 1
  assert.ok(r.plan.every((p) => p.creditos <= 6));
});
test("modo todo usa el máximo absoluto y rango el deseado", () => {
  const per = periodos(10, { lim: 4, max: 4 }); per.forEach((p) => { p.lim = 8; });
  assert.equal(simularRuta(ctx, set(), "todo", per).plan[0].creditos, 8);
  assert.equal(simularRuta(ctx, set(), "rango", per).plan[0].creditos, 4);
});
test("si algo no se puede desbloquear, no se inventa una fecha", () => {
  const rotas = crearContexto([mat("X", 1, 3), mat("Y1", 2, 3, c("FUERA"))]);
  const r = simularRuta(rotas, set(), "todo", periodos(5));
  assert.equal(r.completo, false); assert.equal(r.fin, null);
});
test("materias de 0 créditos siempre entran", () => {
  const r = simularRuta(crearContexto([mat("Z", 1, 0), mat("W", 1, 4)]), set(), "rango", periodos(3, { max: 4 }));
  assert.deepEqual(r.plan[0].materias.map((m) => m.codigo), ["Z", "W"]);
});
test("correquisito: va en el mismo período o no va", () => {
  const co = crearContexto([mat("L", 1, 3), mat("T", 1, 3, null, { correquisitos: c("L") })]);
  const junto = simularRuta(co, set(), "todo", periodos(3));
  assert.deepEqual(junto.plan[0].materias.map((m) => m.codigo), ["L", "T"]);
  const estrecho = simularRuta(co, set(), "rango", periodos(3, { max: 3 })); // solo cabe una: T espera a que L esté aprobada
  assert.deepEqual(estrecho.plan.map((p) => p.materias.map((m) => m.codigo)), [["L"], ["T"]]);
});
test("orden de las materias de cada período = orden del plan", () => {
  const r = simularRuta(ctx, set(), "todo", periodos(5));
  r.plan.forEach((p) => { const idx = p.materias.map((m) => ctx.orden.get(m.codigo)); assert.deepEqual(idx, [...idx].sort((a, b) => a - b)); });
});

console.log("Períodos");
test("el período en curso no cuenta y los apagados se omiten", () => {
  const per = generarPeriodos(crearPeriodosPorDefecto(), HOY);
  assert.ok(per.every((p) => p.start > HOY));
  assert.ok(!per.some((p) => p.nombre.startsWith("Verano")));
  assert.equal(per[0].nombre, "I Semestre 2027");
  assert.ok(generarPeriodos(crearPeriodosPorDefecto(), HOY, true).some((p) => p.nombre === "Verano 2026/27"));
});
test("normalizar mantiene amin ≤ min ≤ max ≤ lim", () => {
  const p = normalizarPeriodo({ nombre: "  ", ini: 20, fin: 0, lim: 10, amin: 30, min: 99, max: 1 });
  assert.equal(p.nombre, "Período"); assert.equal(p.ini, 12); assert.equal(p.fin, 1);
  assert.ok(p.amin <= p.min && p.min <= p.max && p.max <= p.lim);
});

console.log("Avance real (bloques)");
test("colores por bloque según lo que realmente está aprobado", () => {
  const r = calcularBloques(ctx, set("A1", "A2", "B1"), 3); // 3 semestres → deberías ir en el 4
  assert.deepEqual(r.bloques.map((b) => b.clase), ["done", "part", "none", "cur"]);
  assert.equal(r.meta, 4);
});
test("adelantado, al día y sin semestres", () => {
  assert.equal(calcularBloques(ctx, set("A1", "A2", "B1", "B2", "C1", "C2"), 1).bloques[2].clase, "ahead");
  assert.equal(calcularBloques(ctx, set(), 0).meta, 0);
  assert.ok(calcularBloques(ctx, set(), 0).bloques.every((b) => b.clase === ""));
  assert.equal(calcularBloques(ctx, set("A1", "A2"), 1).bloques[1].clase, "cur");
});
test("el bloque 0 y las optativas sin bloque no entran en la barra", () => {
  const r = calcularBloques(crearContexto([mat("N", 0, 2), mat("O1", null, 3), mat("A", 1, 3)]), set(), 0);
  assert.deepEqual(r.bloques.map((b) => b.bloque), [1]);
});

console.log("Ritmo y meta");
test("ritmo: créditos por período y períodos por delante", () => {
  const r = calcularRitmo({ creditosAprobados: 24, creditosTotales: 50, periodosCursados: 3 }, periodos(10));
  assert.equal(r.ritmo, 8); assert.equal(r.n, 4); assert.equal(r.fin.nombre, "P4");
  assert.equal(calcularRitmo({ creditosAprobados: 0, creditosTotales: 50, periodosCursados: 0 }, []).sinDatos, true);
  assert.equal(calcularRitmo({ creditosAprobados: 50, creditosTotales: 50, periodosCursados: 5 }, []).completo, true);
});
test("meta: dentro, sobre el rango, sobre el límite y prerrequisitos", () => {
  const cfg = [{ nombre: "S", ini: 1, fin: 6, on: true, amin: 0, lim: 12, min: 6, max: 9 }];
  const gran = crearContexto(["A", "B", "C", "D", "E"].map((k) => mat(k, 1, 6)));
  const limite = new Date(2028, 5, 30); // 2 períodos (2027 y 2028)
  assert.equal(calcularMeta(gran, set(), cfg, limite, HOY).n, 2);
  assert.equal(calcularMeta(gran, set(), cfg, limite, HOY).clave, "limite"); // 30 > 24
  const medio = crearContexto(["A", "B", "C", "D", "E", "F"].map((k) => mat(k, 1, 4)));
  assert.equal(calcularMeta(medio, set(), cfg, limite, HOY).clave, "sobre");   // 24 > 18 pero ≤ 24
  const poco = crearContexto([mat("A", 1, 6), mat("B", 1, 6)]);
  assert.equal(calcularMeta(poco, set(), cfg, limite, HOY).clave, "dentro");   // 12 entre 12 y 18
  const cadena = crearContexto([mat("A", 1, 3), mat("B", 2, 3, c("A")), mat("C", 3, 3, c("B"))]);
  assert.equal(calcularMeta(cadena, set(), cfg, limite, HOY).clave, "prerrequisitos");
  assert.equal(calcularMeta(cadena, set(), cfg, new Date(2026, 11, 31), HOY).sinPeriodos, true);
  const rota = crearContexto([mat("A", 1, 3), mat("B", 2, 3, c("FUERA"))]);
  assert.equal(calcularMeta(rota, set(), cfg, limite, HOY).clave, "imposible");
});

console.log(`\n${ok} pruebas OK`);
