/* =========================================================================
   AUTENTICACIÓN + GOOGLE DRIVE
   -------------------------------------------------------------------------
   Cada usuario inicia sesión con SU cuenta de Google. La app pide permiso
   mínimo (scope "drive.file"): solo puede ver/editar los archivos que ELLA
   MISMA creó. Nunca ve el resto del Drive del usuario.

   *** IMPORTANTE — DEBES REEMPLAZAR ESTO ANTES DE USAR LA APP ***
   Reemplaza el valor de CLIENT_ID por el tuyo (instrucciones en el README,
   sección "Cómo crear tu Client ID de Google").
   ========================================================================= */

// FIX (bug urgente reportado: usuario nuevo se queda sin poder iniciar
// sesión nunca — consola mostraba "crearDatosUsuarioNuevo is not defined").
// Esta función SÍ existe y SÍ se exporta en schema.js, pero a este archivo
// le faltaba importarla. Como solo se usa la primera vez que una cuenta
// entra (cuando su Drive todavía no tiene el archivo de datos), el error
// pasó desapercibido en cualquier prueba hecha con una cuenta que ya tenía
// el archivo creado de antes — y explotaba siempre, sin excepción, para
// cualquier usuario genuinamente nuevo.
import { crearDatosUsuarioNuevo } from "./schema.js";

const CLIENT_ID = "906522073616-7ofa7i3emqocojhlkh9ot9i0itljmd50.apps.googleusercontent.com";
// El scope de Drive por sí solo NO alcanza para que /oauth2/v3/userinfo
// devuelva "name"/"picture": hace falta pedir también identidad básica
// (openid/email/profile) junto con el permiso mínimo de archivo de Drive.
const SCOPE_DRIVE = "https://www.googleapis.com/auth/drive.file";
// Calendario Secundario (2026-08-25, ver spec de migración de
// notificaciones): scope COMPLETO de Calendar, no "calendar.events" — hace
// falta calendars.insert (crear el calendario secundario en sí), que
// calendar.events no cubre. Confirmado en la consola real del proyecto
// como scope "Sensible" (no "Restringido"): la verificación de Google para
// habilitarlo en producción es gratuita e interna, no una auditoría paga.
const SCOPE_CALENDAR = "https://www.googleapis.com/auth/calendar";
const SCOPES = `openid email profile ${SCOPE_DRIVE} ${SCOPE_CALENDAR}`;
const NOMBRE_ARCHIVO_DATOS = "app_academica_datos.json";
const CLAVE_YA_AUTORIZADO = "google_ya_autorizado";
// OAuth con refresh_token (2026-08-25, Parte A del spec de migración):
// el refresh_token vive ÚNICAMENTE en este dispositivo (localStorage) —
// el Worker es un relevo sin memoria, nunca lo guarda (ver index.js del
// Worker, manejarOAuthExchange/manejarOAuthRefresh).
const CLAVE_REFRESH_TOKEN = "google_refresh_token";
// Mismo Worker que ya habla notificaciones-calendario.js (antes
// notificaciones-push.js) — se duplica el literal acá en vez de importarlo
// cruzado entre archivos, mismo criterio que CLIENT_ID_GOOGLE duplicado en
// el Worker (ver comentario ahí).
const URL_WORKER_OAUTH = "https://worker-notificaciones-agenda.appacademica.workers.dev";
// Valor fijo que exige Google Identity Services para el flujo de código en
// modo popup (ux_mode: "popup"): no hay una URL de redirect real, todo pasa
// por postMessage dentro del propio popup — por eso el mismo literal
// "postmessage" se manda también como redirect_uri al canjear el code
// contra /oauth/exchange (ver manejarOAuthExchange en el Worker).
const REDIRECT_URI_CODE_FLOW = "postmessage";

/**
 * 2026-08-25 — ALINEADO CON MAPA_FUNCIONES.md: al auditar el proyecto para
 * esta migración, MAPA_FUNCIONES.md YA documentaba `guardarRefreshTokenGoogle`/
 * `leerRefreshTokenGoogle`/`borrarRefreshTokenGoogle` y
 * `refrescarAccessTokenViaWorker` como exports de este archivo — pero el
 * auth.js real (el que se subió a esta sesión) todavía tenía la versión
 * vieja con `initTokenClient`/GIS silencioso y NADA de refresh_token. Es
 * decir: esta migración específica de OAuth ya se había DOCUMENTADO como
 * hecha en una sesión anterior, pero nunca se aplicó de verdad al código.
 * Se usan acá los mismos nombres que ya documentaba el MAPA (en vez de los
 * que se habían empezado a escribir en esta misma sesión, ver historial),
 * asumiendo que storage-sync.js (no incluido en esta sesión) YA está
 * escrito esperando exactamente estos 4 nombres — si storage-sync.js
 * resulta estar usando otros nombres distintos, avisar para ajustar.
 */
function guardarRefreshTokenGoogle(refreshToken) {
  localStorage.setItem(CLAVE_REFRESH_TOKEN, refreshToken);
}
function leerRefreshTokenGoogle() {
  return localStorage.getItem(CLAVE_REFRESH_TOKEN);
}
function borrarRefreshTokenGoogle() {
  localStorage.removeItem(CLAVE_REFRESH_TOKEN);
}

let codeClient = null;
let accessToken = null;
// Guarda los callbacks pasados a inicializarGoogleAuth() para que
// manejarRespuestaCode (fuera de esa función, así crearCodeClient puede
// reinstanciar el codeClient con un prompt distinto en cada login sin
// perder acceso a ellos) pueda invocarlos.
let callbacksAuth = null;
// Último conjunto de scopes realmente otorgados por Google en el login/
// canje más reciente — permite a otros módulos (ej. notificaciones-
// calendario.js, antes de intentar crear el calendario secundario)
// preguntar si el usuario efectivamente concedió Calendar sin tener que
// volver a inspeccionar tokens.
let ultimoScopeCalendarOtorgado = false;

/**
 * El <script> de Google se carga con async/defer, así que puede no estar
 * listo todavía cuando corre DOMContentLoaded (esto era la causa de que el
 * login fallara "al azar" y hubiera que recargar varias veces). Aquí
 * esperamos activamente (polling corto) a que exista window.google.accounts
 * antes de crear el tokenClient.
 */
function esperarGsiListo(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const inicio = Date.now();
    (function revisar() {
      if (window.google && google.accounts && google.accounts.oauth2) {
        resolve();
        return;
      }
      if (Date.now() - inicio > timeoutMs) {
        reject(new Error("Google Identity Services no cargó a tiempo"));
        return;
      }
      setTimeout(revisar, 100);
    })();
  });
}

/**
 * Canjea un `code` de un solo uso (recién salido del popup de Google) por
 * access_token + refresh_token, vía el Worker (POST /oauth/exchange) — el
 * client_secret nunca toca el navegador, solo vive en el Worker (env.
 * CLIENT_SECRET_GOOGLE). Devuelve la respuesta de Google tal cual llega
 * (access_token, refresh_token si Google lo emitió, expires_in, scope,
 * token_type). Google solo emite refresh_token de forma confiable en un
 * consentimiento nuevo (prompt "consent") o la primera vez que la cuenta
 * autoriza esta app — por eso el refresh_token guardado se PISA solo si
 * viene uno nuevo (ver callback de crearCodeClient), nunca se borra por su
 * ausencia en un canje puntual.
 */
async function intercambiarCodePorTokens(code) {
  const respuesta = await fetch(`${URL_WORKER_OAUTH}/oauth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, redirect_uri: REDIRECT_URI_CODE_FLOW }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.error || `El Worker respondió ${respuesta.status} al canjear el code.`);
    error.status = respuesta.status;
    throw error;
  }
  return datos;
}

/**
 * Callback único del CodeClient (module-level, no inline) — así
 * crearCodeClient() puede reinstanciar el cliente con un `prompt` distinto
 * en cada login (ver iniciarSesionConGoogle) sin duplicar esta lógica ni
 * perder los callbacks originales (guardados en callbacksAuth por
 * inicializarGoogleAuth).
 */
async function manejarRespuestaCode(respuesta) {
  if (!callbacksAuth) return;
  const { alObtenerToken, alRechazarPermiso } = callbacksAuth;

  if (respuesta.error) {
    console.error("Error de autenticación:", respuesta);
    // El caso más común: el usuario cerró la ventana de consentimiento o
    // rechazó el permiso de Drive. Sin ese permiso la app no puede
    // guardar nada, así que se lo hacemos explícito en vez de dejarla en
    // un estado ambiguo (botón que "no hizo nada").
    if (alRechazarPermiso) alRechazarPermiso(respuesta.error);
    return;
  }

  // Ajuste (v8, sigue aplicando con el flujo de código): Google NO reporta
  // respuesta.error cuando el usuario destilda específicamente la casilla
  // de Drive en la pantalla de consentimiento pero acepta el resto — llega
  // un code "válido" que simplemente no sirve para guardar nada en Drive.
  // Se verifica explícitamente que el scope de Drive esté dentro de lo
  // realmente otorgado (respuesta.scope) antes de canjear el code siquiera.
  const scopesOtorgados = (respuesta.scope || "").split(" ");
  if (!scopesOtorgados.includes(SCOPE_DRIVE)) {
    console.warn("Login sin permiso de Drive (scopes otorgados):", respuesta.scope);
    // No se guarda CLAVE_YA_AUTORIZADO: así el próximo intento vuelve a
    // forzar la pantalla completa de consentimiento (prompt "consent"),
    // en vez de un prompt liviano que podría repetir el mismo problema.
    if (alRechazarPermiso) alRechazarPermiso("permiso_drive_no_otorgado");
    return;
  }

  // Calendar es scope nuevo (Parte A.1): a diferencia de Drive, NO bloquea
  // el login si el usuario lo destildó — Drive es el mínimo indispensable
  // para que la app funcione en absoluto, Calendar solo habilita la
  // sincronización de recordatorios. Si falta, la app entra igual y
  // notificaciones-calendario.js simplemente no podrá sincronizar hasta
  // que el usuario vuelva a autorizar con Calendar incluido.
  ultimoScopeCalendarOtorgado = scopesOtorgados.includes(SCOPE_CALENDAR);
  if (!ultimoScopeCalendarOtorgado) {
    console.warn("Login sin permiso de Calendar — la sincronización con Google Calendar queda desactivada.");
  }

  let datosTokens;
  try {
    datosTokens = await intercambiarCodePorTokens(respuesta.code);
  } catch (e) {
    console.error("No se pudo canjear el code por tokens:", e);
    if (alRechazarPermiso) alRechazarPermiso("fallo_canje_code");
    return;
  }

  accessToken = datosTokens.access_token;
  if (datosTokens.refresh_token) {
    guardarRefreshTokenGoogle(datosTokens.refresh_token);
  }
  localStorage.setItem(CLAVE_YA_AUTORIZADO, "1");
  // v8.3 (Bug 3, sigue aplicando): se pasa también expires_in (segundos que
  // Google dice que dura el token, normalmente 3600) para que app.js pueda
  // programar un refresco proactivo ANTES de que expire.
  alObtenerToken(accessToken, datosTokens.expires_in);
}

/** Fábrica del CodeClient de GIS — separada de inicializarGoogleAuth porque
 *  a diferencia del viejo tokenClient (que aceptaba `prompt` como argumento
 *  de requestAccessToken en cada llamada), el CodeClient solo lo admite
 *  como parte de su configuración inicial. Recrearlo es instantáneo (no
 *  hace red), así que reinstanciar justo antes de pedir el code (ver
 *  iniciarSesionConGoogle) no rompe el gesto de click del usuario. */
function crearCodeClient(prompt) {
  return google.accounts.oauth2.initCodeClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    ux_mode: "popup",
    redirect_uri: REDIRECT_URI_CODE_FLOW,
    prompt,
    callback: manejarRespuestaCode,
  });
}

/**
 * Se llama una vez cuando la página carga (ver app.js).
 * Ahora es async: primero espera a que el script de Google esté listo, y
 * solo entonces crea el codeClient inicial. Llama a `alListo()` cuando el
 * botón de login ya puede usarse, o a `alFallar()` si el script nunca
 * cargó.
 */
async function inicializarGoogleAuth({ alObtenerToken, alListo, alFallar, alRechazarPermiso }) {
  try {
    await esperarGsiListo();
  } catch (e) {
    console.error(e);
    if (alFallar) alFallar();
    return;
  }

  callbacksAuth = { alObtenerToken, alRechazarPermiso };
  codeClient = crearCodeClient("");

  if (alListo) alListo();
}

/**
 * Dispara la ventana de login/consentimiento de Google.
 * Se llama de forma DIRECTA desde el click (sin async antes) para no
 * romper el gesto de usuario en navegadores móviles.
 * Punto 3 del reporte (sigue aplicando con el flujo de código): solo se
 * fuerza la pantalla completa de "consent" la PRIMERA vez; en logins
 * siguientes se usa un prompt más liviano. Con refresh_token esto importa
 * menos que antes (ya no hace falta repetir el login para refrescar la
 * sesión — ver refrescarAccessTokenViaWorker), pero se mantiene el mismo
 * criterio para el botón de login en sí.
 */
function iniciarSesionConGoogle() {
  const yaAutorizado = localStorage.getItem(CLAVE_YA_AUTORIZADO) === "1";
  codeClient = crearCodeClient(yaAutorizado ? "" : "consent");
  codeClient.requestCode();
}

/** Devuelve si el login/canje más reciente incluyó el scope de Calendar —
 *  la usa notificaciones-calendario.js antes de intentar crear el
 *  calendario secundario o sincronizar un evento, para no gastar una
 *  llamada a la API que Google va a rechazar de entrada. */
function tieneScopeCalendarOtorgado() {
  return ultimoScopeCalendarOtorgado;
}

/**
 * Pide nombre y foto de perfil a Google (endpoint userinfo), usando el
 * access_token ya obtenido. Se llama justo después del login exitoso.
 * Devuelve { nombre, foto_url } o null si algo falla (no es crítico).
 */
async function obtenerPerfilGoogle(token) {
  try {
    const respuesta = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!respuesta.ok) return null;
    const datos = await respuesta.json();
    return { nombre: datos.name || null, foto_url: datos.picture || null, correo: datos.email || null };
  } catch (e) {
    console.warn("No se pudo obtener el perfil de Google:", e);
    return null;
  }
}

/** Revoca el token en memoria (el borrado de datos locales lo hace app.js).
 *  2026-08-25: además limpia el refresh_token guardado — con el flujo de
 *  código, cerrar sesión sin borrarlo dejaría el dispositivo con un
 *  refresh_token todavía válido que refrescarAccessTokenViaWorker podría
 *  volver a usar sin que el usuario haya vuelto a loguearse. */
function cerrarSesionGoogle() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  borrarRefreshTokenGoogle();
}

/**
 * Busca el archivo de datos de esta app en el Drive del usuario.
 * Si no existe, lo crea con los datos "de fábrica" (crearDatosUsuarioNuevo()).
 * Devuelve { fileId, datos }.
 */
async function buscarOCrearArchivoDatos(token) {
  const busqueda = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${NOMBRE_ARCHIVO_DATOS}' and trashed=false&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());

  if (busqueda.files && busqueda.files.length > 0) {
    const fileId = busqueda.files[0].id;
    const datos = await leerDatos(token, fileId);
    return { fileId, datos };
  }

  // No existe: se crea con los datos por defecto.
  const datosIniciales = crearDatosUsuarioNuevo();
  const fileId = await crearArchivoDatos(token, datosIniciales);
  return { fileId, datos: datosIniciales };
}

async function crearArchivoDatos(token, datos) {
  const metadata = { name: NOMBRE_ARCHIVO_DATOS, mimeType: "application/json" };
  const boundary = "-------academicapp";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(datos)}\r\n` +
    `--${boundary}--`;

  const respuesta = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  ).then((r) => r.json());

  return respuesta.id;
}

/**
 * Horario entre Amigos — Parte 1: versión genérica de crearArchivoDatos
 * (que siempre usa NOMBRE_ARCHIVO_DATOS fijo) — acá el nombre y el
 * contenido los decide quien llama. Se usa para crear el archivo público
 * h_<uuid>.json de un horario compartido, con nombre no descriptivo a
 * propósito (ver horario-amigos.js) — nunca el nombre del usuario ni nada
 * identificable, para que el archivo en sí no revele de quién es.
 */
async function crearArchivoJsonEnDrive(token, nombreArchivo, datos) {
  const metadata = { name: nombreArchivo, mimeType: "application/json" };
  const boundary = "-------academicapp";
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json\r\n\r\n${JSON.stringify(datos)}\r\n` +
    `--${boundary}--`;

  const respuesta = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al crear el archivo compartido: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  const json = await respuesta.json();
  return json.id;
}

/**
 * Horario entre Amigos — Parte 1: aplica permiso público de solo lectura
 * (role: reader, type: anyone) sobre un archivo — es lo que hace que
 * cualquiera con el link pueda leerlo sin iniciar sesión. Devuelve
 * { id } — ese `id` es el permissionId que hay que guardar (ver
 * crearEnlaceHorarioCompartido en schema.js) para poder revocarlo después
 * con una sola llamada, sin tener que listar los permisos del archivo.
 */
async function crearPermisoPublicoLectura(token, fileId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?fields=id`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ role: "reader", type: "anyone" }),
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al dar permiso público: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json(); // { id: permissionId }
}

/**
 * Horario entre Amigos — Parte 1: revoca el acceso público de un enlace
 * (botón "Revocar" en la lista de enlaces generados). Un 404 (el permiso o
 * el archivo ya no existen — ej. el usuario lo borró a mano desde Drive)
 * se trata como ÉXITO, no como error: el resultado que se quería ("que ese
 * link ya no funcione") ya está cumplido, mismo criterio que
 * eliminarArchivoDeDriveConId más abajo.
 */
async function eliminarPermisoDrive(token, fileId, permissionId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}/permissions/${permissionId}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
  );
  if (!respuesta.ok && respuesta.status !== 404) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al revocar el permiso: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
}

async function leerDatos(token, fileId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al leer el archivo de datos: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * v8.3 (sincronización multi-dispositivo casi en tiempo real): pide
 * ÚNICAMENTE el campo modifiedTime del archivo — una llamada barata que NO
 * descarga el archivo completo. Se usa para sondear cada pocos segundos si
 * otro dispositivo/sesión guardó algo nuevo, sin gastar cuota de la API
 * innecesariamente en archivos que pueden pesar bastante con el tiempo.
 */
async function obtenerMetadatosArchivo(token, fileId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=modifiedTime`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al leer metadatos: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json(); // { modifiedTime: "..." }
}

/**
 * Sobrescribe el archivo de datos en Drive con el objeto completo.
 * v7 (Bug 2): antes esta función no revisaba `respuesta.ok`, así que un
 * error real de la API (token expirado, fileId inválido, cuerpo mal
 * formado, etc.) quedaba en completo silencio — ni se reportaba en consola
 * ni se reintentaba correctamente, porque intentarSincronizar() creía que
 * todo había salido bien. Ahora se revisa el status y, si falla, se lanza
 * un error con el código HTTP y el cuerpo de la respuesta de Drive para
 * poder diagnosticarlo de verdad.
 */
async function guardarDatos(token, fileId, datos) {
  const respuesta = await fetch(
    // v9 (sondeo multi-dispositivo): se pide `fields=modifiedTime` en la
    // respuesta del PATCH para que quien llama pueda anotar de inmediato
    // "esta es la última versión que YO subí" — así el sondeo periódico no
    // confunde el propio guardado con un cambio hecho desde otro dispositivo
    // y no dispara una recarga innecesaria de lo que la app acaba de enviar.
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media&fields=modifiedTime`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(datos),
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al guardar: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json(); // { modifiedTime: "..." }
}

/**
 * refrescarAccessTokenViaWorker(refreshToken) — 2026-08-25, nombre y firma
 * tomados de MAPA_FUNCIONES.md (ver nota junto a guardarRefreshTokenGoogle
 * más arriba: ya documentado ahí, nunca implementado hasta ahora). A
 * diferencia de la vieja `refrescarAccessTokenGoogle` (GIS "silencioso",
 * con el riesgo de que Google igual mostrara un selector de cuenta), esto
 * es una llamada servidor-a-servidor pura contra el Worker (POST
 * /oauth/refresh): NUNCA involucra un popup ni puede mostrar UI de Google.
 *
 * Recibe el refresh_token como parámetro (no lo lee de localStorage
 * internamente — eso es responsabilidad de quien llama, vía
 * leerRefreshTokenGoogle(), típicamente storage-sync.js en
 * asegurarTokenValido()). Devuelve `{ token, expiresIn, refreshTokenNuevo }`
 * — `refreshTokenNuevo` viene poblado solo si Google rotó el refresh_token
 * en esta renovación (no es lo común, pero puede pasar); quien llama
 * decide si lo persiste con guardarRefreshTokenGoogle().
 *
 * Rechaza si el refresh_token no existe, venció, o fue revocado (ej.
 * límite de 7 días en modo Prueba de la consola de Google, o el usuario
 * revocó el acceso desde su cuenta) — con `error.invalidGrant = true`
 * cuando específicamente Google respondió "invalid_grant", para que quien
 * llama sepa que hace falta un login completo (no vale la pena reintentar)
 * y pueda limpiar el refresh_token guardado con borrarRefreshTokenGoogle().
 */
async function refrescarAccessTokenViaWorker(refreshToken) {
  if (!refreshToken) {
    throw new Error("No hay refresh_token: hace falta volver a iniciar sesión.");
  }

  const respuesta = await fetch(`${URL_WORKER_OAUTH}/oauth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const datos = await respuesta.json().catch(() => ({}));

  if (!respuesta.ok) {
    const error = new Error(datos.error || `El Worker respondió ${respuesta.status} al refrescar.`);
    error.status = respuesta.status;
    error.invalidGrant = Boolean(datos.error && /invalid_grant/i.test(String(datos.error)));
    throw error;
  }

  accessToken = datos.access_token;
  return {
    token: accessToken,
    expiresIn: datos.expires_in,
    // Google rota el refresh_token con poca frecuencia, pero puede pasar.
    refreshTokenNuevo: datos.refresh_token || null,
  };
}

/**
 * v9.4 (2026-08-08 — arquitectura de adjuntos): a diferencia de
 * guardarDatos/leerDatos (que siempre operan sobre EL MISMO archivo,
 * `estado.fileId`, el JSON central de la app), estas 3 funciones crean/leen/
 * borran archivos SUELTOS en Drive — uno por adjunto. Nunca se llaman desde
 * intentarSincronizar() ni desde ningún ciclo de sync del JSON: las
 * orquesta core/storage-adjuntos.js, en su propio flujo (subida lazy al
 * elegir el archivo, descarga lazy al pedirla, borrado en cola). Comparten
 * el mismo token de acceso porque el scope de Drive ("drive.file") ya
 * cubre cualquier archivo que la app cree, no solo el JSON central.
 */

/**
 * Sube un archivo binario cualquiera (File/Blob del input de adjuntos) como
 * un archivo NUEVO e independiente en Drive. A diferencia de
 * crearArchivoDatos (que arma el body entero como un string, porque ahí
 * adentro solo va JSON de texto), acá el contenido puede ser binario
 * arbitrario — convertir esos bytes a string rompería cualquier byte que
 * no sea texto válido. Se arma el body multipart como un Blob real,
 * combinando las partes de texto (metadata) con los bytes crudos del
 * archivo en el medio, en vez de concatenar todo como string.
 */
/**
 * `folderId` (2026-08-19, opcional — quien no lo pase mantiene el
 * comportamiento de siempre: el archivo cae en la raíz visible de la app,
 * scope drive.file): destino dentro de una carpeta puntual, mismo `parents`
 * que ya usa copiarArchivoDrive más abajo para los backups. Se usa para
 * subir los adjuntos siempre dentro de "ArchivosAdjuntos" (ver
 * buscarOCrearCarpetaEnDrive + core/storage-adjuntos.js) en vez de sueltos
 * en la raíz junto al archivo de datos y la carpeta de backups.
 */
async function subirArchivoBinarioADrive(token, archivo, folderId) {
  const metadata = {
    name: archivo.name || "adjunto",
    mimeType: archivo.type || "application/octet-stream",
    ...(folderId ? { parents: [folderId] } : {}),
  };
  const boundary = "-------academicapp-adjunto";
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  const body = new Blob([
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
    `--${boundary}\r\nContent-Type: ${metadata.mimeType}\r\n\r\n`,
    bytes,
    `\r\n--${boundary}--`,
  ]);

  const respuesta = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": `multipart/related; boundary=${boundary}`,
      },
      body,
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al subir el adjunto: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  const json = await respuesta.json();
  return json.id; // este id es el driveFileId que se guarda en la referencia (schema.js/crearAdjunto)
}

/** Descarga el contenido real de un adjunto por su driveFileId. Se llama
 *  bajo demanda (el usuario toca "ver"/"descargar"), nunca de antemano. */
async function descargarArchivoBinarioDeDrive(token, driveFileId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/drive/v3/files/${driveFileId}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al descargar el adjunto: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.blob();
}

/**
 * Borra el archivo real de Drive de un adjunto eliminado. Un 404 (el
 * archivo ya no existe) se trata como ÉXITO, no como error — puede pasar
 * si otro dispositivo ya lo borró antes, o si nunca llegó a terminar de
 * subirse; en ambos casos el resultado que se quería ("que ese archivo no
 * exista en Drive") ya está cumplido, así que no tiene sentido reintentar.
 */
async function eliminarArchivoDeDriveConId(token, driveFileId) {
  const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files/${driveFileId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!respuesta.ok && respuesta.status !== 404) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al borrar el adjunto: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
}

/**
 * Backup rotativo a Drive (Ajustes — 2026-08-10): primitivas sueltas sobre
 * la carpeta "AppAcademica" y sus 2 archivos de respaldo. La ORQUESTACIÓN
 * del ciclo completo (¿ya toca según la frecuencia elegida?, rotar
 * reciente→anterior, crear el nuevo reciente) vive en storage-sync.js
 * (ejecutarBackupSiToca), enganchada al mismo ciclo de sync normal — este
 * archivo solo expone las operaciones de Drive en sí, mismo espíritu que
 * subirArchivoBinarioADrive/descargarArchivoBinarioDeDrive de arriba
 * (adjuntos), que tampoco conocen NADA del ciclo que las llama.
 */
const NOMBRE_CARPETA_BACKUP = "AppAcademica";

/**
 * Busca una carpeta por nombre visible para esta app (scope drive.file:
 * solo ve archivos/carpetas que ELLA MISMA creó, nunca el resto del Drive
 * del usuario). La crea si todavía no existe. Devuelve el folderId.
 */
async function buscarOCrearCarpetaEnDrive(token, nombreCarpeta) {
  const busqueda = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${nombreCarpeta}' and mimeType='application/vnd.google-apps.folder' and trashed=false&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());

  if (busqueda.files && busqueda.files.length > 0) return busqueda.files[0].id;

  const respuesta = await fetch("https://www.googleapis.com/drive/v3/files?fields=id", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: nombreCarpeta, mimeType: "application/vnd.google-apps.folder" }),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al crear la carpeta de backup: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  const json = await respuesta.json();
  return json.id;
}

/**
 * Busca un archivo por nombre DENTRO de una carpeta puntual. Devuelve su
 * fileId, o null si todavía no existe (ej. el primer backup de la cuenta,
 * donde "AppAcademica" recién se creó y está vacía).
 */
async function buscarArchivoEnCarpeta(token, folderId, nombreArchivo) {
  const busqueda = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=name='${nombreArchivo}' and '${folderId}' in parents and trashed=false&spaces=drive&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then((r) => r.json());
  return (busqueda.files && busqueda.files[0] && busqueda.files[0].id) || null;
}

/**
 * Renombra un archivo existente SIN tocar su contenido (PATCH de solo
 * metadata, no re-sube nada) — se usa para "rotar" backup_reciente.json a
 * backup_anterior.json de forma barata, sin descargar ni volver a subir el
 * JSON completo por el cliente.
 */
async function renombrarArchivoDrive(token, fileId, nuevoNombre) {
  const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: nuevoNombre }),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al renombrar el archivo de backup: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * Copia un archivo YA EXISTENTE en Drive (endpoint files.copy — la copia
 * ocurre del lado del servidor de Google, el cliente nunca baja ni vuelve
 * a subir los bytes) dentro de una carpeta puntual, con un nombre nuevo.
 * Se usa para generar backup_reciente.json como copia EXACTA del archivo
 * de datos vigente (mismo JSON, solo cambia el nombre — pedido explícito),
 * sin el costo de leerDatos+guardarDatos.
 */
async function copiarArchivoDrive(token, fileId, nombreCopia, folderId) {
  const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/copy?fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: nombreCopia, parents: [folderId] }),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al copiar el archivo de backup: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * Mueve un archivo YA EXISTENTE hacia adentro de una carpeta, SIN tocar su
 * contenido ni su fileId — a diferencia de copiarArchivoDrive (que crea un
 * archivo nuevo e independiente), esto es el mismo archivo de siempre,
 * solo que cambia de ubicación. Drive v3 no tiene un endpoint "mover"
 * directo: se hace agregando el parent nuevo (addParents) y quitando
 * explícitamente los parents viejos (removeParents) en la misma llamada
 * — sin el removeParents, el archivo quedaría visible en las DOS
 * ubicaciones a la vez en vez de mudarse de verdad.
 *
 * Se usa una única vez por cuenta (2026-08-10) para migrar el archivo de
 * datos vigente —creado originalmente en la raíz del Drive, antes de que
 * existiera "AppAcademica"— hacia adentro de esa carpeta. Como el fileId
 * no cambia, guardarDatos/leerDatos/obtenerMetadatosArchivo (que solo
 * conocen el fileId, nunca la ubicación) siguen funcionando exactamente
 * igual después de la mudanza, sin ningún otro cambio en el resto del
 * código — ver migrarArchivoVigenteSiHaceFalta en storage-sync.js.
 */
async function moverArchivoAlaCarpeta(token, fileId, folderIdDestino) {
  const metaActual = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents`, {
    headers: { Authorization: `Bearer ${token}` },
  }).then((r) => r.json());
  const parentsActuales = metaActual.parents || [];

  // Ya está adentro de la carpeta (ej. si esto se reintentó después de un
  // fallo a mitad de camino, o si en algún dispositivo la bandera todavía
  // no llegó a sincronizarse) — nada que mover, evita una llamada inútil
  // y un posible error de Drive por pedir quitar un parent que ya no está.
  if (parentsActuales.includes(folderIdDestino)) return { id: fileId, parents: parentsActuales };

  const params = new URLSearchParams({ addParents: folderIdDestino, fields: "id,parents" });
  if (parentsActuales.length > 0) params.set("removeParents", parentsActuales.join(","));

  const respuesta = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?${params.toString()}`, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Drive respondió ${respuesta.status} al mover el archivo vigente a la carpeta de backup: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * Calendario Secundario (2026-08-25, Parte A.2 del spec de migración de
 * notificaciones): helpers crudos contra la API de Google Calendar, mismo
 * patrón que los helpers de Drive de arriba (una función = una llamada,
 * sin orquestación). La orquestación real (crear el calendario una sola
 * vez por usuario, mapear un EventoAgenda a un evento de Calendar, el
 * best-effort de no bloquear el guardado local si esto falla) vive en
 * notificaciones-calendario.js — este archivo solo sabe hablar con Google,
 * igual que ya hacía con Drive.
 */

/**
 * calendars.insert — crea el calendario secundario "AppAcademica" en la
 * cuenta del usuario. Se llama UNA sola vez por usuario (quien llama debe
 * revisar antes si estado.datos.configuracion ya tiene guardado un ID de
 * calendario, para no crear uno duplicado en cada sesión). Devuelve el
 * objeto completo que manda Google; a quien llama le interesa sobre todo
 * `.id`, que es lo que hay que persistir.
 */
async function crearCalendarioSecundario(token, nombreCalendario) {
  const respuesta = await fetch("https://www.googleapis.com/calendar/v3/calendars", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ summary: nombreCalendario }),
  });
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Calendar respondió ${respuesta.status} al crear el calendario secundario: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json(); // { id, summary, ... }
}

/**
 * calendarList.patch — fija el color del calendario secundario en sí (no
 * de los eventos individuales, ver colorId por evento en insertarEventoCalendar)
 * usando uno de los colorId de fondo válidos para calendarios completos.
 * Llamada opcional, separada de crearCalendarioSecundario porque el color
 * de calendario y el color de evento usan paletas distintas en la API de
 * Google (colorId de calendarList vs colorId de events).
 */
async function fijarColorCalendario(token, calendarId, colorId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/calendar/v3/users/me/calendarList/${encodeURIComponent(calendarId)}?fields=id`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ colorId }),
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Calendar respondió ${respuesta.status} al fijar el color del calendario: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * events.insert — crea un evento nuevo dentro del calendario secundario.
 * `evento` ya viene armado (fecha/hora, reminders.overrides, colorId,
 * recurrence si aplica, source.url para el deep link del Resumen Diario)
 * desde notificaciones-calendario.js — este helper no interpreta nada,
 * solo hace el POST. Devuelve el evento creado por Google; a quien llama
 * le interesa sobre todo `.id`, para guardarlo como
 * google_calendar_event_id (o como el id del evento recurrente único del
 * Resumen Diario).
 */
async function insertarEventoCalendar(token, calendarId, evento) {
  const respuesta = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(evento),
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Calendar respondió ${respuesta.status} al crear el evento: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * events.update — sobrescribe un evento existente (PUT, reemplazo
 * completo, no PATCH parcial: notificaciones-calendario.js siempre manda
 * el objeto entero para no arrastrar campos viejos de una edición previa,
 * ej. un reminder que ya no aplica si el usuario bajó el offset).
 */
async function actualizarEventoCalendar(token, calendarId, eventId, evento) {
  const respuesta = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(evento),
    }
  );
  if (!respuesta.ok) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Calendar respondió ${respuesta.status} al actualizar el evento: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
  return respuesta.json();
}

/**
 * events.delete — borra un evento del calendario secundario. Un 404/410
 * (el evento ya no existe del lado de Google, ej. lo borró el usuario a
 * mano desde Google Calendar) se trata como éxito silencioso: el objetivo
 * ("que ese evento no exista más en Calendar") ya está cumplido, no hay
 * nada que reintentar ni ningún error real que reportar.
 */
async function eliminarEventoCalendar(token, calendarId, eventId) {
  const respuesta = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    }
  );
  if (!respuesta.ok && respuesta.status !== 404 && respuesta.status !== 410) {
    const cuerpo = await respuesta.text().catch(() => "");
    const error = new Error(`Calendar respondió ${respuesta.status} al borrar el evento: ${cuerpo}`);
    error.status = respuesta.status;
    error.body = cuerpo;
    throw error;
  }
}

export {
  NOMBRE_CARPETA_BACKUP,
  crearArchivoJsonEnDrive,
  crearPermisoPublicoLectura,
  eliminarPermisoDrive,
  buscarOCrearArchivoDatos,
  buscarOCrearCarpetaEnDrive,
  buscarArchivoEnCarpeta,
  renombrarArchivoDrive,
  copiarArchivoDrive,
  moverArchivoAlaCarpeta,
  cerrarSesionGoogle,
  descargarArchivoBinarioDeDrive,
  eliminarArchivoDeDriveConId,
  guardarDatos,
  inicializarGoogleAuth,
  iniciarSesionConGoogle,
  leerDatos,
  obtenerMetadatosArchivo,
  obtenerPerfilGoogle,
  refrescarAccessTokenViaWorker,
  guardarRefreshTokenGoogle,
  leerRefreshTokenGoogle,
  borrarRefreshTokenGoogle,
  subirArchivoBinarioADrive,
  tieneScopeCalendarOtorgado,
  crearCalendarioSecundario,
  fijarColorCalendario,
  insertarEventoCalendar,
  actualizarEventoCalendar,
  eliminarEventoCalendar,
};
