/* =========================================================================
   INTRO DE APERTURA (folder que se abre y revela la app)
   -------------------------------------------------------------------------
   Pantalla de carga NO invasiva y puramente decorativa:

     1. Mientras la app carga, el folder cerrado saca sus pestañas una a una
        (1→6) y las vuelve a meter en orden inverso (6→1), en bucle.
     2. Cuando la app está lista, las pestañas terminan de salir y el folder
        se abre mostrando la app. No añade espera: si la app ya estaba lista,
        va directo a abrirse.

   Es solo una capa encima: nunca toca la app. Si se apaga en Ajustes (o no
   corresponde por rendimiento/accesibilidad) queda el cargador de siempre
   (#overlay-carga-sesion), sin cambios.

   Flujo desde main.js:
     iniciarIntroCarga()   al empezar a cargar (arranque con sesión, o login)
     abrirIntroCarga()     al terminar mostrarApp()
     cancelarIntroCarga()  si el cargador se oculta SIN app (login, error)

   Se reproduce como máximo UNA vez por sesión de pestaña/PWA (sessionStorage):
   nunca al volver de segundo plano ni en recargas.

   NO se activa (queda el cargador de siempre) en:
     demo/vista previa · "reducir movimiento" · modo Optimizado ·
     equipo modesto (<4 núcleos o <4 GB) · usuario nuevo (si ya se sabe) ·
     enlaces ?abrir= / ?comp= · pestaña oculta · apagada en Ajustes.

   Toques: durante la carga, un toque retira el folder y deja el cargador de
   siempre; durante la apertura, un toque (o Escape/Enter/Espacio) la salta.
   Si la carga pasa de ESPERA_MAXIMA_MS, el folder se retira solo para no
   tapar pantallas de recuperación de sesión.

   Preferencias (Ajustes → Personalizar → Animación de apertura):
     configuracion.animacion_apertura  true/undefined = activa, false = apagada
     configuracion.intro_colores       null = colores originales, o
                                       { modo: "paleta" | "personalizado", colores: [6 hex] }
   Ambas se reflejan en localStorage porque al arrancar todavía no hay datos
   de la cuenta: aquí se lee primero el espejo local.
   ========================================================================= */

import "./folder-intro.js"; // define window.FolderIntro (sin dependencias)

export const CLAVE_INTRO_APAGADA_LOCAL = "app_intro_apertura_apagada"; // "1" = apagada
export const CLAVE_INTRO_COLORES_LOCAL = "app_intro_colores";          // JSON { modo, colores }
const CLAVE_INTRO_SESION = "app_intro_apertura_vista";
const ESPERA_MAXIMA_MS = 20000;

/** Colores originales de las 6 pestañas (los del logo). */
export const COLORES_INTRO_ORIGINALES = ["#e8452a", "#f28a2b", "#e6c52c", "#2fa86b", "#3a7de2", "#8b4ae0"];

/* ------------------------------- Colores -------------------------------- */

const HEX6 = /^#[0-9a-f]{6}$/i;

function aHex(color) {
  const v = String(color || "").trim();
  if (HEX6.test(v)) return v.toLowerCase();
  const rgb = v.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!rgb) return null;
  return "#" + [rgb[1], rgb[2], rgb[3]].map((n) => Math.min(255, Number(n)).toString(16).padStart(2, "0")).join("");
}

/**
 * 6 colores sacados de la paleta activa: un degradado del acento 1 al acento 2
 * (las mismas variables CSS que usa toda la app, incluida la paleta personalizada).
 */
export function coloresDePaletaActual() {
  const css = getComputedStyle(document.documentElement);
  const a = aHex(css.getPropertyValue("--accent-1"));
  const b = aHex(css.getPropertyValue("--accent-2")) || a;
  if (!a) return COLORES_INTRO_ORIGINALES.slice();
  const ca = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const cb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return Array.from({ length: 6 }, (_, n) => {
    const t = n / 5;
    return "#" + ca.map((v, k) => Math.round(v + (cb[k] - v) * t).toString(16).padStart(2, "0")).join("");
  });
}

function normalizarConfigColores(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const colores = Array.isArray(cfg.colores) ? cfg.colores.map(aHex) : [];
  const completos = colores.length === 6 && colores.every(Boolean);
  if (cfg.modo === "paleta") return { modo: "paleta", colores: completos ? colores : coloresDePaletaActual() };
  if (cfg.modo === "personalizado" && completos) return { modo: "personalizado", colores };
  return null;
}

/** Lee la elección: primero la cuenta (si ya hay datos), luego el espejo local. */
function leerConfigColores(configuracion) {
  const deCuenta = normalizarConfigColores(configuracion && configuracion.intro_colores);
  if (deCuenta) return deCuenta;
  if (configuracion && configuracion.intro_colores === null) return null; // la cuenta dice "originales"
  try {
    return normalizarConfigColores(JSON.parse(localStorage.getItem(CLAVE_INTRO_COLORES_LOCAL) || "null"));
  } catch (e) {
    return null;
  }
}

/** Los 6 colores que se ven ahora mismo (para los círculos de Ajustes y para la animación). */
export function coloresIntroEfectivos(configuracion) {
  const cfg = leerConfigColores(configuracion);
  if (!cfg) return COLORES_INTRO_ORIGINALES.slice();
  return cfg.modo === "paleta" ? coloresDePaletaActual() : cfg.colores.slice();
}

/** Modo actual para marcar la UI: "original" | "paleta" | "personalizado". */
export function modoColoresIntro(configuracion) {
  const cfg = leerConfigColores(configuracion);
  return cfg ? cfg.modo : "original";
}

/** Guarda la elección de colores en el espejo local (la cuenta la guarda config-ajustes.js). */
export function espejarColoresIntroLocal(valor) {
  try {
    if (valor) localStorage.setItem(CLAVE_INTRO_COLORES_LOCAL, JSON.stringify(valor));
    else localStorage.removeItem(CLAVE_INTRO_COLORES_LOCAL);
  } catch (e) {
    // Sin storage no hay espejo; no es crítico.
  }
}

/* ----------------------------- Preferencia ----------------------------- */

/** true si no se apagó (ni en la cuenta ni en este equipo). */
export function introAperturaActivada(configuracion) {
  if (configuracion && configuracion.animacion_apertura === false) return false;
  try {
    if (localStorage.getItem(CLAVE_INTRO_APAGADA_LOCAL) === "1") return false;
  } catch (e) {
    // localStorage bloqueado: se asume activa.
  }
  return true;
}

export function espejarIntroAperturaLocal(activada) {
  try {
    if (activada) localStorage.removeItem(CLAVE_INTRO_APAGADA_LOCAL);
    else localStorage.setItem(CLAVE_INTRO_APAGADA_LOCAL, "1");
  } catch (e) {
    // No crítico.
  }
}

/* ------------------------------ Condiciones ----------------------------- */

function prefiereMenosMovimiento() {
  return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
}

function equipoModesto() {
  const nucleos = navigator.hardwareConcurrency;
  const memoriaGB = navigator.deviceMemory; // no existe en Safari/Firefox: ahí no se descarta
  return Boolean((nucleos && nucleos < 4) || (memoriaGB && memoriaGB < 4));
}

function entradaPorEnlaceProfundo() {
  const q = new URLSearchParams(window.location.search);
  return q.has("abrir") || q.has("comp");
}

function yaSeVioEnEstaSesion() {
  try {
    return sessionStorage.getItem(CLAVE_INTRO_SESION) === "1";
  } catch (e) {
    return false;
  }
}

function marcarVistaEnEstaSesion() {
  try {
    sessionStorage.setItem(CLAVE_INTRO_SESION, "1");
  } catch (e) {
    // Sin sessionStorage el flag de módulo (vistaEnEsteDocumento) evita repetirla.
  }
}

let vistaEnEsteDocumento = false;
let carga = null; // controlador activo de FolderIntro.load()

function motivoParaOmitir({ demo, modoOptimizado, configuracion }) {
  if (!window.FolderIntro) return "sin-libreria";
  if (demo) return "demo";
  if (prefiereMenosMovimiento()) return "reducir-movimiento";
  if (document.visibilityState !== "visible") return "pestana-oculta";
  if (!introAperturaActivada(configuracion)) return "apagada";
  if (modoOptimizado) return "modo-optimizado";
  if (equipoModesto()) return "equipo-modesto";
  if (configuracion && configuracion.onboarding_v1_completado === false) return "usuario-nuevo";
  if (entradaPorEnlaceProfundo()) return "enlace-profundo";
  if (vistaEnEsteDocumento || yaSeVioEnEstaSesion()) return "ya-vista";
  return "";
}

/* --------------------------- Montaje y toques --------------------------- */

function montar(configuracion) {
  const l = window.FolderIntro.load({
    app: "#app-shell",
    colors: coloresIntroEfectivos(configuracion),
    maxWait: ESPERA_MAXIMA_MS,
  });
  const raiz = document.querySelector(".fi-root");
  if (!raiz || l.state === "none") return null;

  raiz.setAttribute("aria-hidden", "true"); // decorativa: los lectores de pantalla la ignoran

  // Durante la carga un toque la retira (queda el cargador de siempre);
  // durante la apertura la salta.
  raiz.addEventListener("pointerdown", () => {
    if (l.state === "loading") l.abandon();
    else if (l.state === "opening") l.cancel();
  });
  const alTeclear = (e) => {
    if (l.state === "opening" && (e.key === "Escape" || e.key === "Enter" || e.key === " ")) l.cancel();
  };
  document.addEventListener("keydown", alTeclear);
  l.__quitarTeclas = () => document.removeEventListener("keydown", alTeclear);
  return l;
}

/* ------------------------------- API pública ---------------------------- */

/**
 * Empezar a cargar: monta el folder con las pestañas en bucle. Idempotente.
 * @param {object}  [o]
 * @param {boolean} [o.demo]
 * @param {boolean} [o.modoOptimizado]
 * @param {object}  [o.configuracion] estado.datos.configuracion si ya se conoce (puede faltar)
 * @returns {boolean} true si quedó activa
 */
export function iniciarIntroCarga(o = {}) {
  try {
    if (carga && (carga.state === "loading" || carga.state === "opening")) return true;
    if (motivoParaOmitir(o)) return false;
    carga = montar(o.configuracion);
    return Boolean(carga);
  } catch (error) {
    console.warn("Intro de apertura omitida por un error:", error);
    carga = null;
    return false;
  }
}

/** La app ya está lista (final de mostrarApp): abre el folder. No hace nada si no hay folder activo. */
export function abrirIntroCarga() {
  try {
    const l = carga;
    if (!l || l.state !== "loading") return Promise.resolve(false);
    vistaEnEsteDocumento = true;
    marcarVistaEnEstaSesion();
    return l.open().catch(() => false).finally(() => {
      if (l.__quitarTeclas) l.__quitarTeclas();
      if (carga === l) carga = null;
    });
  } catch (error) {
    console.warn("Intro de apertura: no se pudo abrir:", error);
    return Promise.resolve(false);
  }
}

/** El cargador se ocultó SIN app (pantalla de login, error): se retira con un fundido corto. */
export function cancelarIntroCarga() {
  try {
    const l = carga;
    if (!l || l.state !== "loading") return;
    l.abandon();
    if (l.__quitarTeclas) l.__quitarTeclas();
    carga = null;
  } catch (e) {
    // Nada que hacer.
  }
}

/**
 * Botón "Ver animación" de Ajustes: la reproduce de punta a punta ahora mismo,
 * con los colores indicados (o los guardados). Respeta "reducir movimiento".
 */
export function verAnimacionIntro(configuracion, colores) {
  try {
    if (!window.FolderIntro || prefiereMenosMovimiento()) return Promise.resolve(false);
    if (carga && carga.state === "loading") return Promise.resolve(false); // la real está en curso
    const l = window.FolderIntro.load({ app: "#app-shell", colors: colores || coloresIntroEfectivos(configuracion) });
    const raiz = document.querySelector(".fi-root");
    if (!raiz || l.state === "none") return Promise.resolve(false);
    raiz.setAttribute("aria-hidden", "true");
    raiz.addEventListener("pointerdown", () => l.cancel());
    return l.open().catch(() => false);
  } catch (error) {
    return Promise.resolve(false);
  }
}
