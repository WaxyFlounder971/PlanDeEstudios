/* =========================================================================
   ESTADO GLOBAL + CACHÉ LOCAL + TOKEN DE GOOGLE
   Objeto `estado` compartido por todo el resto de la app, además de la
   caché offline (localStorage) y el manejo del access_token de Google
   (guardar/leer/borrar en caché, con expiración).
   ========================================================================= */

import { ocultarAvisoReconexion, programarRefrescoProactivo } from "./storage-sync.js";

/* =========================================================================
   APP.JS — Cimientos (Iteración 0)
   Encargado de: pantalla de login, cargar/guardar datos (offline-first +
   Google Drive), selector de plan activo, ajustes generales, cerrar sesión,
   layout responsivo (sidebar/drawer), perfil de Google y modal de enlaces.
   Las demás secciones del menú (Plan de Estudios, Semestres, etc.) quedan
   como "próximamente" — se construyen en las siguientes iteraciones.
   ========================================================================= */

const CLAVE_CACHE_LOCAL = "app_academica_cache";

const CLAVE_TOKEN_CACHE = "google_token_cache";

/**
 * v9 (punto 2 — cachear el token con su expiración, no pedirlo de cero en
 * cada carga): guarda { token, expiraEn } en localStorage cada vez que se
 * obtiene un access_token nuevo (login, refresco silencioso, refresco
 * manual o refresco tras 401).
 */

function guardarTokenCache(token, expiresInSegundos) {
  const segundos = Number(expiresInSegundos) || 3600;
  const expiraEn = Date.now() + segundos * 1000;
  localStorage.setItem(CLAVE_TOKEN_CACHE, JSON.stringify({ token, expiraEn }));
}

/**
 * Devuelve { token, expiraEn } SOLO si hay un token cacheado y todavía le
 * quedan más de 5 minutos de vida (el mismo margen que usa el refresco
 * proactivo) — si le queda menos, se trata como inválido a propósito para
 * no arriesgarse a usarlo y toparse con un 401 a mitad de una operación.
 * Si no hay nada usable, devuelve null y quien llama debe recurrir al
 * refresco silencioso normal.
 */

function leerTokenCacheValido() {
  try {
    const crudo = localStorage.getItem(CLAVE_TOKEN_CACHE);
    if (!crudo) return null;
    const { token, expiraEn } = JSON.parse(crudo);
    if (!token || !expiraEn || Date.now() >= expiraEn - 5 * 60 * 1000) return null;
    return { token, expiraEn };
  } catch (e) {
    return null;
  }
}

function borrarTokenCache() {
  localStorage.removeItem(CLAVE_TOKEN_CACHE);
}

/**
 * Punto único por el que la app debe pasar cada vez que obtiene un token
 * válido (login, reconexión silenciosa, reconexión manual, refresco tras
 * 401): guarda el token en memoria, lo cachea con su expiración, programa
 * el siguiente refresco proactivo, y refleja "conexión OK" tanto en el
 * banner de reconexión como en el indicador de sincronización (punto 4).
 */

function establecerTokenActivo(token, expiresInSegundos) {
  estado.token = token;
  guardarTokenCache(token, expiresInSegundos);
  programarRefrescoProactivo(expiresInSegundos);
  estado.conexionDrive = "ok";
  ocultarAvisoReconexion();
}

const estado = {
  token: null,
  fileId: null,
  datos: null,
  pendienteSync: false,
  enlaceEditandoId: null,
  // "ok" | "desconectado" — refleja el 3er estado real del indicador de
  // sincronización (punto 4): no hay forma de renovar el token solo.
  conexionDrive: "ok",
  // Última modifiedTime de Drive que la app conoce (propia o ajena) — la usa
  // el sondeo periódico (punto 5) para detectar cambios hechos desde otro
  // dispositivo sin descargar el archivo completo en cada revisión.
  ultimoModifiedTimeConocido: null,
  // null (aún no comprobado) | "otorgado" | "denegado" | "desconocido" —
  // resultado de comprobarPermisoPortapapelesAlIniciar() (core/clipboard.js),
  // que se llama justo después de un login exitoso. Lo usa el flujo de
  // importación ("Enviar a Claude/ChatGPT") para saber de antemano si vale
  // la pena intentar la copia automática o mostrar directo el modal manual.
  permisoPortapapeles: null,
};

/**
 * v9 (punto 5 — condición de carrera en el arranque): promesa que se
 * resuelve una sola vez, cuando ya se supo si hay o no un token de Drive
 * utilizable (venga de caché válida o de un intento de reconexión que haya
 * terminado, con éxito o sin él). intentarSincronizar() y el sondeo
 * multi-dispositivo esperan esta promesa antes de tocar estado.token, para
 * que ningún intento se dispare a mitad de la inicialización de auth.
 */

let resolverAuthListo;

const authListo = new Promise((resolve) => {
  resolverAuthListo = resolve;
});

/* ------------------------- Cache local (offline) ------------------------- */

/**
 * BUG FIX (encontrado en esta ronda — "guardo la paleta y en algún momento
 * ya no está"): esta función guardaba `{ fileId, datos }` pero NUNCA
 * `estado.pendienteSync`. Si el usuario recarga la página (o la cierra)
 * ANTES de que la subida en segundo plano a Drive termine — algo muy fácil
 * de hacer sin querer, ej. probando "¿de verdad quedó guardado?" con un
 * F5 casi inmediato — la próxima carga arranca con `pendienteSync: false`
 * (el valor inicial de `estado`, ver más abajo) aunque ese cambio JAMÁS
 * llegó a subirse a Drive. Nada vuelve a intentar esa subida hasta que el
 * usuario edite otra cosa sin relación (lo cual sí dispara un
 * marcarCambioPendiente() nuevo que arrastra el cambio viejo de paso) — en
 * la práctica, el cambio puede quedar viviendo SOLO en este dispositivo
 * indefinidamente, sin que el indicador de sync avise nada raro (porque
 * ese indicador también lee de `estado.pendienteSync`, que ya está en
 * `false`). Ahora se guarda y se restaura también ese flag.
 */
function guardarCacheLocal() {
  localStorage.setItem(
    CLAVE_CACHE_LOCAL,
    JSON.stringify({ fileId: estado.fileId, datos: estado.datos, pendienteSync: estado.pendienteSync })
  );
}

function leerCacheLocal() {
  try {
    const crudo = localStorage.getItem(CLAVE_CACHE_LOCAL);
    if (!crudo) return null;
    const cache = JSON.parse(crudo);
    // Quien llama (main.js) es responsable de aplicar cache.pendienteSync a
    // estado.pendienteSync después de esto — se devuelve tal cual, sin
    // tocar estado acá, para no romper el resto del flujo de carga que ya
    // asigna estado.fileId/estado.datos por su cuenta desde el resultado.
    return cache;
  } catch (e) {
    // Caché corrupta (JSON a medio escribir, típico si el navegador cerró la
    // app o se quedó sin espacio a mitad de guardarCacheLocal()). Sin este
    // try/catch, esta excepción revienta el arranque completo de la app en
    // ese dispositivo — es el bug que dejaba a Wagner sin poder entrar en el
    // teléfono mientras en PC todo seguía normal (cada dispositivo tiene su
    // propio localStorage). Se descarta la caché rota para no quedar
    // atascado intentando leer lo mismo roto en cada carga.
    console.warn("Caché local corrupta, se descarta:", e);
    localStorage.removeItem(CLAVE_CACHE_LOCAL);
    return null;
  }
}

export {
  CLAVE_CACHE_LOCAL,
  CLAVE_TOKEN_CACHE,
  authListo,
  borrarTokenCache,
  establecerTokenActivo,
  estado,
  guardarCacheLocal,
  guardarTokenCache,
  leerCacheLocal,
  leerTokenCacheValido,
  resolverAuthListo,
};
