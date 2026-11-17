// v3.28.0 D1 (Node, sin DOM real): la capa de tinta pide un contexto 2D con alfa y SIN `desynchronized` por defecto,
// y oculta el lienzo mientras está vacío y sin herramienta activa (defensa contra el "rectángulo negro" de Notas en teléfono).
import assert from "node:assert/strict";
import { crearCapaTinta } from "../js/notas/notas-tinta.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };

function entorno({ desinc = false } = {}) {
  const llamadas = [], clases = new Set(), rafs = [];
  const ctx = new Proxy({}, { get: (_, k) => (k === "canvas" ? null : () => {}), set: () => true });
  const canvas = {
    className: "", style: {}, dataset: {}, width: 0, height: 0, clientHeight: 600,
    classList: { toggle: (c, v) => { if (v) clases.add(c); else clases.delete(c); }, add: (c) => clases.add(c), remove: (c) => clases.delete(c), contains: (c) => clases.has(c) },
    getContext: (tipo, opts) => { llamadas.push({ tipo, opts }); return ctx; },
    addEventListener() {}, remove() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 600 }),
  };
  const doc = { createElement: () => canvas };
  const win = {
    devicePixelRatio: 2, getComputedStyle: () => ({ position: "relative" }),
    requestAnimationFrame: (f) => { rafs.push(f); return rafs.length; }, cancelAnimationFrame() {},
    addEventListener() {}, removeEventListener() {},
    localStorage: { getItem: (k) => (desinc && k === "nt_tinta_desincronizada" ? "1" : null) },
  };
  doc.defaultView = win;
  const caja = { ownerDocument: doc, style: {}, scrollLeft: 0, scrollTop: 0, append() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 600 }) };
  const trazos = [];
  const capa = crearCapaTinta({ cuerpo: caja, viewport: caja, modal: caja, obtenerTrazos: () => trazos, alCambiar() {} });
  const vaciarRaf = () => { while (rafs.length) rafs.shift()(); };
  return { capa, llamadas, clases, trazos, vaciarRaf };
}

console.log("notas-tinta D1");

test("por defecto: contexto 2D con alpha:true y sin desynchronized", () => {
  const { llamadas } = entorno();
  assert.equal(llamadas[0].tipo, "2d");
  assert.equal(llamadas[0].opts.alpha, true);
  assert.notEqual(llamadas[0].opts.desynchronized, true); // con el código viejo era true
});

test("opt-in: localStorage nt_tinta_desincronizada=1 vuelve a activar desynchronized", () => {
  const { llamadas } = entorno({ desinc: true });
  assert.equal(llamadas[0].opts.desynchronized, true);
  assert.equal(llamadas[0].opts.alpha, true);
});

test("lienzo vacío y sin herramienta: oculto (clase nt-tinta-vacia) ya desde la creación", () => {
  const { clases } = entorno();
  assert.ok(clases.has("nt-tinta-vacia")); // con el código viejo nunca existía la clase
});

test("tras el layout (rAF) sigue oculto mientras está vacío", () => {
  const { clases, vaciarRaf } = entorno();
  vaciarRaf();
  assert.ok(clases.has("nt-tinta-vacia"));
});

test("al activar una herramienta se muestra y al salir vuelve a ocultarse", () => {
  const { capa, clases } = entorno();
  capa.establecerModo("lapiz");
  assert.ok(!clases.has("nt-tinta-vacia"));
  capa.establecerModo(null);
  assert.ok(clases.has("nt-tinta-vacia"));
});

test("con trazos guardados se muestra tras redibujar", () => {
  const { capa, clases, trazos } = entorno();
  trazos.push({ c: "#000000", w: 0.0045, p: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.25]] });
  capa.redibujar();
  assert.ok(!clases.has("nt-tinta-vacia"));
  trazos.length = 0;
  capa.redibujar();
  assert.ok(clases.has("nt-tinta-vacia"));
});

console.log(`\n${ok} pruebas OK`);