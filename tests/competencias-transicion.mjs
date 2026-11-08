// COMP1 (v3.28.0 C): la tarjeta de competencias no corta su entrada animada y no se redibuja de golpe.
import assert from "node:assert/strict";
import { crearPintorTarjeta } from "../js/tiempo-estudio/tiempo-estudio-competencias-transicion.js";

let ok = 0;
const test = (n, f) => { f(); ok++; console.log("  ✓", n); };

// Reloj y temporizadores falsos: nada espera de verdad.
function entorno() {
  let t = 0, id = 0;
  const cola = [];
  const llamadas = [];
  const deps = {
    ahora: () => t,
    programar: (fn, ms) => { cola.push({ id: ++id, en: t + ms, fn }); return id; },
    cancelar: (i) => { const k = cola.findIndex((c) => c.id === i); if (k >= 0) cola.splice(k, 1); },
    sinMovimiento: () => true, // aquí solo se prueba la espera; la disolvencia necesita un navegador
  };
  const avanzar = (ms) => {
    t += ms;
    for (;;) {
      const k = cola.findIndex((c) => c.en <= t);
      if (k < 0) break;
      cola.splice(k, 1)[0].fn();
    }
  };
  const pintar = crearPintorTarjeta((tarjeta, o) => llamadas.push(o.etiqueta), deps);
  return { pintar, llamadas, avanzar, tarjeta: () => ({ isConnected: true, firstElementChild: null, getClientRects: () => [] }) };
}
const datos = (etiqueta, extra = {}) => ({ etiqueta, estadoCuerpo: "ok", vista: "podio", mensajes: true, tieneMensaje: false, participantes: [{}, {}, {}], animar: false, ...extra });

console.log("Entrada animada");
test("llegan datos mientras corre la entrada: no se redibuja hasta que termina, y entonces se dibuja una sola vez con lo más reciente", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("entrada", { animar: true }), {});
  e.avanzar(500); e.pintar(tj, datos("red-1"), {});
  e.avanzar(500); e.pintar(tj, datos("red-2"), {});
  assert.deepEqual(e.llamadas, ["entrada"]);
  e.avanzar(5000);
  assert.deepEqual(e.llamadas, ["entrada", "red-2"]);
});
test("la espera dura lo que la entrada: 3600 ms más 150 ms por persona", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("entrada", { animar: true }), {});
  e.avanzar(100); e.pintar(tj, datos("red"), {});
  e.avanzar(3600 + 450 - 100 - 1); assert.deepEqual(e.llamadas, ["entrada"]);
  e.avanzar(40); assert.deepEqual(e.llamadas, ["entrada", "red"]);
});
test("sin entrada en curso, un dato nuevo se dibuja al instante", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("primero"), {}); e.pintar(tj, datos("segundo"), {});
  assert.deepEqual(e.llamadas, ["primero", "segundo"]);
});

console.log("Acciones de la persona");
for (const [nombre, cambio] of [["cambiar de vista", { vista: "filas" }], ["mostrar u ocultar mensajes", { mensajes: false }], ["escribir su mensaje", { tieneMensaje: true }]]) {
  test(`${nombre} dentro de la entrada se dibuja al instante y descarta lo pendiente`, () => {
    const e = entorno(); const tj = e.tarjeta();
    e.pintar(tj, datos("entrada", { animar: true }), {});
    e.avanzar(300); e.pintar(tj, datos("red"), {});
    e.avanzar(300); e.pintar(tj, datos("accion", cambio), {});
    assert.deepEqual(e.llamadas, ["entrada", "accion"]);
    e.avanzar(6000);
    assert.deepEqual(e.llamadas, ["entrada", "accion"]);
  });
}

console.log("Casos límite");
test("si la tarjeta ya no está en pantalla cuando vence la espera, no se dibuja", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("entrada", { animar: true }), {});
  e.avanzar(200); e.pintar(tj, datos("red"), {});
  tj.isConnected = false; e.avanzar(6000);
  assert.deepEqual(e.llamadas, ["entrada"]);
});
test("una nueva entrada animada dentro de la ventana se dibuja de inmediato", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("entrada-1", { animar: true }), {});
  e.avanzar(200); e.pintar(tj, datos("entrada-2", { animar: true }), {});
  assert.deepEqual(e.llamadas, ["entrada-1", "entrada-2"]);
});
test("de 'cargando' a marcador no se retrasa aunque haya entrada marcada", () => {
  const e = entorno(); const tj = e.tarjeta();
  e.pintar(tj, datos("cargando", { estadoCuerpo: "cargando", participantes: null }), {});
  e.pintar(tj, datos("ok"), {});
  assert.deepEqual(e.llamadas, ["cargando", "ok"]);
});

console.log(`\n${ok} pruebas correctas`);