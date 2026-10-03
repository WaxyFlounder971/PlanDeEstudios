import { crearDatosUsuarioNuevo } from "./schema.js";

/**
 * Modo de demostración: el query param se resuelve antes del arranque para
 * que main.js pueda omitir login, lectura de caché, sincronización y APIs.
 */
const MODO_DEMO = new URLSearchParams(globalThis.location?.search || "").get("demo") === "1";
const URL_WORKER_ANALITICA_DEMO = "https://worker-notificaciones-agenda.appacademica.workers.dev/analitica/demo-apertura";
let fetchOriginal = null;
let aperturaDemoRegistrada = false;

// La demo nunca debe leer ni escribir las preferencias/cachés de la app real
// que ya existan en este navegador. Las preferencias de esta visita viven
// únicamente en memoria y se restablecen al recargar.
if (MODO_DEMO && globalThis.Storage?.prototype) {
  const prototipoStorage = globalThis.Storage.prototype;
  prototipoStorage.getItem = () => null;
  prototipoStorage.setItem = () => {};
  prototipoStorage.removeItem = () => {};
  prototipoStorage.clear = () => {};
  prototipoStorage.key = () => null;
}

function esModoDemo() {
  return MODO_DEMO;
}

function bloquearServiciosExternosEnDemo() {
  if (!MODO_DEMO || !globalThis.fetch || fetchOriginal) return;
  fetchOriginal = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (recurso, opciones) => {
    const href = typeof recurso === "string" || recurso instanceof URL ? String(recurso) : recurso?.url;
    let url;
    try { url = new URL(href, globalThis.location.href); } catch (_) { return fetchOriginal(recurso, opciones); }
    if (url.origin === globalThis.location.origin) return fetchOriginal(recurso, opciones);
    const clave = globalThis.__appDemoDatos?.configuracion?.gemini_api_key;
    const solicitudGemini = /(^|\.)generativelanguage\.googleapis\.com$/i.test(url.hostname)
      && Boolean(clave) && url.searchParams.get("key") === clave;
    if (solicitudGemini) return fetchOriginal(recurso, opciones);
    const metodo = String(opciones?.method || recurso?.method || "GET").toUpperCase();
    const solicitudConteoDemo = url.href === URL_WORKER_ANALITICA_DEMO && metodo === "POST" && !opciones?.body;
    if (solicitudConteoDemo) return fetchOriginal(recurso, opciones);
    console.info("Modo demo: se omitió una solicitud a un servicio externo.", url.hostname);
    return new Response(JSON.stringify({ error: "simulado_en_demo" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  };
}

function registrarAperturaDemo() {
  if (!MODO_DEMO || aperturaDemoRegistrada || !fetchOriginal) return Promise.resolve(false);
  aperturaDemoRegistrada = true;
  return globalThis.fetch(URL_WORKER_ANALITICA_DEMO, { method: "POST", keepalive: true })
    .then((respuesta) => respuesta.ok)
    .catch(() => false);
}

function combinarSemilla(base, semilla) {
  if (Array.isArray(semilla)) return structuredClone(semilla);
  if (!semilla || typeof semilla !== "object") return semilla;
  const salida = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  for (const [clave, valor] of Object.entries(semilla)) salida[clave] = combinarSemilla(salida[clave], valor);
  return salida;
}

async function cargarDatosDemo() {
  const respuesta = await fetch(new URL("../../demo/datos-demo.json", import.meta.url), { cache: "no-store" });
  if (!respuesta.ok) throw new Error(`No se pudo leer el dataset de demo (${respuesta.status}).`);
  const semilla = await respuesta.json();
  const datos = combinarSemilla(crearDatosUsuarioNuevo(), semilla);
  if (datos.configuracion) datos.configuracion.gemini_api_key = null;
  return datos;
}

function activarEstadoDemo(datos) {
  if (!MODO_DEMO) return;
  globalThis.__appDemoDatos = datos;
  bloquearServiciosExternosEnDemo();
  document.documentElement.dataset.demo = "true";
  document.body.dataset.demo = "true";
}

export { MODO_DEMO, activarEstadoDemo, bloquearServiciosExternosEnDemo, cargarDatosDemo, esModoDemo, registrarAperturaDemo };
