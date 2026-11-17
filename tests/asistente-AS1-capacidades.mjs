// Pruebas AS1 (v3.28.0): el botón «¿Qué puedes hacer?» del Asistente añade el turno al hilo existente, sin cerrar ni reiniciar la conversación.
// Necesita jsdom (no es dependencia del proyecto): npm i --no-save jsdom. Sin jsdom el test avisa y sale sin fallar. Solo usa respuestas locales
// (saludo y capacidades): nunca llama a Gemini ni a la red, y no toca datos reales.
import assert from "node:assert/strict";

let JSDOM;
try { ({ JSDOM } = await import("jsdom")); } catch (e) { console.log("SKIP: falta jsdom (npm i --no-save jsdom); AS1 no se ejecutó"); process.exit(0); }

const dom = new JSDOM('<!doctype html><html lang="es"><body><div id="seccion-asistente"></div></body></html>', { url: "http://localhost/", pretendToBeVisual: true });
const w = dom.window;
// main.js arranca toda la app en DOMContentLoaded (login, sincronización…): aquí no debe correr.
for (const objetivo of [w, w.document]) { const original = objetivo.addEventListener.bind(objetivo); objetivo.addEventListener = (tipo, ...resto) => (tipo === "DOMContentLoaded" ? undefined : original(tipo, ...resto)); }
for (const k of ["window", "document", "localStorage", "sessionStorage", "location", "history", "HTMLElement", "Node", "Event", "KeyboardEvent", "CustomEvent", "MutationObserver", "getComputedStyle", "requestAnimationFrame", "cancelAnimationFrame"]) {
  Object.defineProperty(globalThis, k, { value: k === "window" ? w : (typeof w[k] === "function" && !/^[A-Z]/.test(k) ? w[k].bind(w) : w[k]), configurable: true, writable: true });
}
Object.defineProperty(globalThis, "navigator", { value: w.navigator, configurable: true });
class Observador { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
for (const k of ["IntersectionObserver", "ResizeObserver"]) { globalThis[k] = Observador; w[k] = Observador; }
w.matchMedia = w.matchMedia || (() => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
globalThis.matchMedia = w.matchMedia; globalThis.fetch = async () => { throw new Error("sin red en el test"); }; // nunca sale a internet
// Mismo orden de carga que main.js (si no, un ciclo de imports del proyecto falla al cargar).
await import("../js/config/config-ajustes.js");
const { estado } = await import("../js/core/storage/storage.js");
await import("../js/asistente/asistente.js");

let ok = 0, secciones = 0;
const test = async (n, f) => { await f(); ok++; console.log("  ✓", n); };
const esperar = async (cond, ms = 3000) => { const t0 = Date.now(); while (!cond()) { if (Date.now() - t0 > ms) throw new Error("tiempo agotado esperando la respuesta local"); await new Promise((r) => setTimeout(r, 10)); } };
estado.datos = { configuracion: { gemini_api_key: "clave-de-prueba" }, materias: [], eventos_agenda: [], semestres: [], horario: [] };
w.mostrarSeccion = (nombre) => { secciones++; w.__appSeccionActiva = nombre; if (nombre === "asistente") w.renderizarAsistente(); };
const CLAVE = "asistente_historial_dispositivo";
const historial = () => JSON.parse(w.localStorage.getItem(CLAVE) || "null");
const scroll = () => w.document.getElementById("asistente-chat-scroll");
const burbujas = () => scroll().children.length;
const aviso = () => [...scroll().querySelectorAll("button")].filter((b) => b.textContent === "Continuar" || b.textContent === "Nueva conversación");
const btnInfo = () => w.document.querySelector('button[aria-label="¿Qué puedes hacer?"]');
const btnEnviar = () => w.document.getElementById("btn-asistente-enviar");
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));
const terminarEnvio = async () => { await pausa(30); await esperar(() => !btnEnviar().disabled); await pausa(30); }; // el envío local termina cuando el botón vuelve a habilitarse
const escribirYEnviar = async (texto) => { w.document.getElementById("input-asistente-mensaje").value = texto; btnEnviar().click(); await terminarEnvio(); };
const pulsarInfo = async () => { btnInfo().click(); await terminarEnvio(); };

w.__appSeccionActiva = "asistente"; w.renderizarAsistente();

await test("hay un botón «¿Qué puedes hacer?» en el encabezado y el chat arranca con el saludo", () => {
  assert.ok(btnInfo()); assert.ok(burbujas() >= 1); assert.equal(historial(), null);
});
await test("con una conversación en curso, el botón añade pregunta y respuesta al mismo hilo (no lo reinicia ni pinta «continuar/nueva»)", async () => {
  await escribirYEnviar("hola"); const antes = burbujas(), turnosAntes = historial().turnos.length, entradas = secciones;
  await pulsarInfo();
  assert.equal(secciones, entradas, "no debe volver a entrar a la sección");
  assert.equal(aviso().length, 0); assert.equal(burbujas(), antes + 2); assert.equal(historial().turnos.length, turnosAntes + 2);
  assert.equal(historial().turnos[0].texto, "hola");
});
await test("pulsarlo otra vez sigue sumando al mismo hilo: el historial conserva todos los turnos", async () => {
  const turnos = historial().turnos.length; await pulsarInfo(); assert.equal(historial().turnos.length, turnos + 2); assert.equal(historial().turnos[0].texto, "hola"); assert.equal(aviso().length, 0);
});
await test("el borrador que el usuario estaba escribiendo no se pierde ni se envía", async () => {
  w.document.getElementById("input-asistente-mensaje").value = "borrador a medias"; await pulsarInfo();
  const input = w.document.getElementById("input-asistente-mensaje"); assert.equal(input.value, "borrador a medias"); assert.equal(historial().turnos.some((t) => t.texto === "borrador a medias"), false); input.value = "";
});
await test("la pregunta escrita a mano sigue la misma ruta y suma al hilo", async () => {
  const antes = burbujas(), turnos = historial().turnos.length; await escribirYEnviar("¿Qué puedes hacer?");
  assert.equal(burbujas(), antes + 2); assert.equal(historial().turnos.length, turnos + 2); assert.equal(aviso().length, 0);
});
await test("al recargar dentro de la hora, el historial completo se ofrece y «Continuar» lo restaura entero", async () => {
  const turnos = historial().turnos.length; w.renderizarAsistente();
  assert.equal(aviso().length, 2); aviso().find((b) => b.textContent === "Continuar").click();
  assert.equal(historial().turnos.length, turnos); assert.ok(burbujas() >= turnos);
});
await test("desde otra sección (p. ej. Notas) se navega al Asistente y se retoma la conversación reciente en vez de pisarla", async () => {
  const turnos = historial().turnos.length; w.__appSeccionActiva = "notas"; w.document.getElementById("seccion-asistente").innerHTML = ""; const entradas = secciones;
  assert.equal(w.enviarTextoAWapper("¿Qué puedes hacer?"), true);
  await esperar(() => (historial()?.turnos || []).length === turnos + 2);
  assert.equal(secciones, entradas + 1); assert.equal(historial().turnos[0].texto, "hola"); assert.equal(aviso().length, 0);
});
await test("sin clave de Gemini el envío se rechaza sin tocar nada", () => {
  const clave = estado.datos.configuracion.gemini_api_key; estado.datos.configuracion.gemini_api_key = ""; const turnos = historial().turnos.length;
  assert.equal(w.enviarTextoAWapper("¿Qué puedes hacer?"), false); assert.equal(historial().turnos.length, turnos); estado.datos.configuracion.gemini_api_key = clave;
});

console.log(`\n${ok} pruebas AS1 OK`);
process.exit(0);
