// C6 (v3.28.0 C): píldora de descanso — cuenta atrás, cierre y suscripciones sin fugas (DOM mínimo simulado).
import assert from "node:assert/strict";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };

// DOM mínimo: solo lo que usa el módulo.
const nodo = (etiqueta) => {
  const n = {
    etiqueta, hijos: [], attrs: {}, style: {}, className: "", textContent: "", removido: false, escuchas: {},
    append(...xs) { for (const x of xs) n.hijos.push(x); },
    setAttribute(k, v) { n.attrs[k] = v; if (k === "class") n.className = v; },
    addEventListener(t, f) { n.escuchas[t] = f; },
    remove() { n.removido = true; },
    querySelectorAll() { return []; },
    classList: { add() {}, remove() {} },
  };
  return n;
};
const cuerpo = nodo("body");
globalThis.document = {
  body: cuerpo,
  createElement: nodo,
  createElementNS: (_, t) => nodo(t),
  querySelectorAll: (sel) => (sel === ".te-aviso-descanso" ? cuerpo.hijos.filter((h) => h.className === "te-aviso-descanso" && !h.removido) : []),
  getElementById: () => null,
};
globalThis.requestAnimationFrame = (f) => f();
const temporizadores = [];
globalThis.setTimeout = (fn, ms) => { temporizadores.push({ fn, ms, activo: true }); return temporizadores.length; };
globalThis.clearTimeout = (id) => { if (temporizadores[id - 1]) temporizadores[id - 1].activo = false; };

const { mostrarAvisoDescanso } = await import("../js/tiempo-estudio/tiempo-estudio-avisos.js");

// Timer falso con suscripción.
function timerFalso(fase = { duracion: 300, transcurridos: 0 }) {
  const subs = new Set();
  const t = { activo: { pomodoro: { fase: "descanso_corto" } }, fase };
  t.suscribir = (cb) => { subs.add(cb); cb(t.activo); return () => subs.delete(cb); };
  t.leerFase = () => t.fase;
  t.tick = () => subs.forEach((cb) => cb(t.activo));
  t.cuantas = () => subs.size;
  return t;
}
const buscar = (n, clase) => { if (n.className === clase) return n; for (const h of n.hijos || []) { const r = typeof h === "object" ? buscar(h, clase) : null; if (r) return r; } return null; };

console.log("Píldora de descanso");
test("muestra «MM:SS» restante y el arco se vacía con el tiempo", () => {
  const t = timerFalso({ duracion: 300, transcurridos: 28 });
  const aviso = mostrarAvisoDescanso({ nombre: "Cálculo", suscribir: t.suscribir, leerFase: t.leerFase });
  assert.equal(buscar(aviso, "te-aviso-tiempo").textContent, "04:32");
  assert.equal(buscar(aviso, "te-aviso-arco").style.strokeDashoffset, "9");
  t.fase = { duracion: 300, transcurridos: 150 }; t.tick();
  assert.equal(buscar(aviso, "te-aviso-tiempo").textContent, "02:30");
  assert.equal(buscar(aviso, "te-aviso-arco").style.strokeDashoffset, "50");
  assert.equal(buscar(aviso, "te-aviso-nombre").textContent, "Cálculo");
});
test("tocarla la cierra y no deja la suscripción colgada", () => {
  const t = timerFalso();
  const aviso = mostrarAvisoDescanso({ nombre: "X", suscribir: t.suscribir, leerFase: t.leerFase });
  assert.equal(t.cuantas(), 1);
  aviso.escuchas.click();
  assert.equal(aviso.removido, true); assert.equal(t.cuantas(), 0);
});
test("se cierra sola a los 6 s", () => {
  const t = timerFalso();
  const antes = temporizadores.length;
  const aviso = mostrarAvisoDescanso({ nombre: "X", suscribir: t.suscribir, leerFase: t.leerFase });
  const mio = temporizadores.slice(antes).find((x) => x.ms === 6000);
  assert.ok(mio); mio.fn();
  assert.equal(aviso.removido, true); assert.equal(t.cuantas(), 0);
});
test("si el descanso termina (vuelve el bloque de trabajo) o se detiene el timer, se cierra", () => {
  for (const nuevo of [{ pomodoro: { fase: "trabajo" } }, null]) {
    const t = timerFalso();
    const aviso = mostrarAvisoDescanso({ nombre: "X", suscribir: t.suscribir, leerFase: t.leerFase });
    t.activo = nuevo; t.tick();
    assert.equal(aviso.removido, true); assert.equal(t.cuantas(), 0);
  }
});
test("si el timer ya no está en descanso al abrirla, no queda suscrita", () => {
  const t = timerFalso(); t.activo = null;
  const aviso = mostrarAvisoDescanso({ nombre: "X", suscribir: t.suscribir, leerFase: t.leerFase });
  assert.equal(aviso.removido, true); assert.equal(t.cuantas(), 0);
});
test("abrir otra cierra la anterior (no se apilan)", () => {
  const t = timerFalso();
  const a = mostrarAvisoDescanso({ nombre: "A", suscribir: t.suscribir, leerFase: t.leerFase });
  const b = mostrarAvisoDescanso({ nombre: "B", suscribir: t.suscribir, leerFase: t.leerFase });
  assert.equal(a.removido, true); assert.equal(b.removido, false); assert.equal(t.cuantas(), 1);
});
console.log(`\n${ok} pruebas correctas`);