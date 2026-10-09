import { crearDatosUsuarioNuevo, migrarDatosAntiguos, PALETAS_DISPONIBLES } from "./schema.js";
import { registrarAnaliticaUso } from "./analitica.js";
import { aplicarPaleta, guardarModoDisenoLocal } from "../ui/tema.js";

/**
 * Modo de demostración: el query param se resuelve antes del arranque para
 * que main.js pueda omitir login, lectura de caché, sincronización y APIs.
 */
const MODO_DEMO = new URLSearchParams(globalThis.location?.search || "").get("demo") === "1";
const PREVIEW_DEMO = new URLSearchParams(globalThis.location?.search || "").get("preview") === "1";
const URL_WORKER_ANALITICA = "https://worker-notificaciones-agenda.appacademica.workers.dev";
let fetchOriginal = null;
let aperturaDemoRegistrada = false;

// La demo nunca debe leer ni escribir las preferencias/cachés de la app real
// que ya existan en este navegador. Las preferencias de esta visita viven
// únicamente en memoria (así el tema elegido se conserva mientras dura la
// visita) y se restablecen al recargar.
if (MODO_DEMO && globalThis.Storage?.prototype) {
  const prototipoStorage = globalThis.Storage.prototype;
  const memoria = new WeakMap();
  const mapaDe = (almacen) => {
    let mapa = memoria.get(almacen);
    if (!mapa) { mapa = new Map(); memoria.set(almacen, mapa); }
    return mapa;
  };
  prototipoStorage.getItem = function (clave) { const m = mapaDe(this); const k = String(clave); return m.has(k) ? m.get(k) : null; };
  prototipoStorage.setItem = function (clave, valor) { mapaDe(this).set(String(clave), String(valor)); };
  prototipoStorage.removeItem = function (clave) { mapaDe(this).delete(String(clave)); };
  prototipoStorage.clear = function () { mapaDe(this).clear(); };
  prototipoStorage.key = function (indice) { return [...mapaDe(this).keys()][indice] ?? null; };
  try { Object.defineProperty(prototipoStorage, "length", { get() { return mapaDe(this).size; }, configurable: true }); } catch (_) {}
}

// En la vista previa del onboarding el tema se aplica en cuanto carga el módulo
// (antes del primer render), para que no se vea un destello con el tema por defecto.
if (MODO_DEMO && PREVIEW_DEMO) {
  try {
    const params = new URLSearchParams(globalThis.location.search);
    const paleta = params.get("previewPalette");
    const modo = params.get("previewMode");
    const calidad = params.get("previewQuality");
    if (["optimizado", "fancy"].includes(calidad)) {
      guardarModoDisenoLocal(calidad);
      document.documentElement.setAttribute("data-rendimiento", calidad === "optimizado" ? "reducido" : "normal");
    }
    if ((PALETAS_DISPONIBLES.includes(paleta) || paleta === "personalizada") && ["light", "dark", "true-dark"].includes(modo)) {
      let colores;
      if (paleta === "personalizada") { try { colores = JSON.parse(params.get("previewCustom") || "null")?.colores; } catch (_) {} }
      aplicarPaleta(paleta, modo, colores);
      document.documentElement.setAttribute("data-mode", modo);
    }
  } catch (error) { console.warn("Modo demo: no se pudo adelantar el tema de la vista previa.", error); }
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
    const solicitudAnaliticaAgregada = url.origin === URL_WORKER_ANALITICA
      && url.pathname === "/analitica/evento" && metodo === "POST";
    const solicitudConteoDemoLegacy = url.origin === URL_WORKER_ANALITICA
      && url.pathname === "/analitica/demo-apertura" && metodo === "POST" && !opciones?.body;
    if (solicitudAnaliticaAgregada || solicitudConteoDemoLegacy) return fetchOriginal(recurso, opciones);
    console.info("Modo demo: se omitió una solicitud a un servicio externo.", url.hostname);
    return new Response(JSON.stringify({ error: "simulado_en_demo" }), {
      status: 503, headers: { "Content-Type": "application/json" },
    });
  };
}

function registrarAperturaDemo() {
  if (!MODO_DEMO || PREVIEW_DEMO || aperturaDemoRegistrada) return false;
  aperturaDemoRegistrada = true;
  registrarAnaliticaUso("demo", "Apertura");
  return true;
}

function combinarSemilla(base, semilla) {
  if (Array.isArray(semilla)) {
    // El dataset es JSON: este respaldo permite abrir la demo en navegadores
    // móviles antiguos que todavía no implementan structuredClone.
    return typeof structuredClone === "function"
      ? structuredClone(semilla)
      : JSON.parse(JSON.stringify(semilla));
  }
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
  if (datos.configuracion) {
    datos.configuracion.gemini_api_key = null;
    // La vista previa embebida nunca debe abrir su propio onboarding.
    if (PREVIEW_DEMO) datos.configuracion.onboarding_v1_completado = true;
    if (!PREVIEW_DEMO) {
      datos.configuracion.onboarding_v1_completado = false;
      datos.configuracion.tutoriales_secciones_vistas = {};
    }
  }
  if (PREVIEW_DEMO && datos.configuracion) {
    const params = new URLSearchParams(globalThis.location.search);
    const paleta = params.get("previewPalette");
    const modo = params.get("previewMode");
    if (PALETAS_DISPONIBLES.includes(paleta) || paleta === "personalizada") datos.configuracion.paleta = paleta;
    if (["light", "dark", "true-dark"].includes(modo)) datos.configuracion.modo = modo;
    const calidad = params.get("previewQuality");
    if (["optimizado", "fancy"].includes(calidad)) guardarModoDisenoLocal(calidad);
    const logo = params.get("previewLogo");
    if (["folder", "birrete"].includes(logo)) datos.configuracion.logo_app = logo;
    const logoData = params.get("previewLogoData");
    if (logoData?.startsWith("data:image/webp;base64,") && logoData.length < 90000) {
      datos.configuracion.logo_app = "personalizado";
      datos.configuracion.logo_app_url = logoData;
    }
    try { if (paleta === "personalizada") datos.configuracion.paleta_personalizada = JSON.parse(params.get("previewCustom") || "null"); } catch (_) {}
  }
  // La demo usa los mismos defaults y migraciones que las cuentas reales:
  // el dataset puede conservar ejemplos legados, pero nunca debe bloquear
  // una sección por una forma antigua de los datos.
  return migrarDatosAntiguos(datos);
}

function activarEstadoDemo(datos) {
  if (!MODO_DEMO) return;
  globalThis.__appDemoDatos = datos;
  bloquearServiciosExternosEnDemo();
  // Con el almacenamiento aislado no hay tema "guardado": se aplica el del dataset
  // (o el que pida la vista previa) para que la demo nunca arranque sin paleta.
  const cfg = datos?.configuracion;
  if (cfg?.paleta && cfg?.modo) {
    try { aplicarPaleta(cfg.paleta, cfg.modo, cfg.paleta === "personalizada" ? cfg.paleta_personalizada?.colores : undefined); }
    catch (error) { console.warn("Modo demo: no se pudo aplicar el tema inicial.", error); }
  }
  document.documentElement.dataset.demo = "true";
  document.documentElement.dataset.demoPreview = String(PREVIEW_DEMO);
  document.body.dataset.demo = "true";
}

export { MODO_DEMO, PREVIEW_DEMO, activarEstadoDemo, bloquearServiciosExternosEnDemo, cargarDatosDemo, esModoDemo, registrarAperturaDemo };
