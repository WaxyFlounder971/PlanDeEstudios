/* =========================================================================
   AUTENTICACIÓN + GOOGLE DRIVE
   -------------------------------------------------------------------------
   Cada usuario inicia sesión con SU cuenta de Google. La app pide permiso
   mínimo (scope "drive.file"): solo puede ver/editar los archivos que ELLA
   MISMA creó. Nunca ve el resto del Drive del usuario.

   MIGRACIÓN 2026-08-25 — flujo de código + refresh_token: hasta ahora esto
   usaba google.accounts.oauth2.initTokenClient (flujo implícito), que NO
   entrega refresh_token — cualquier refresco (silencioso o no) tenía que
   volver a pedirle un token a Google mismo, y ese método es, según la
   propia documentación de Google, un "OAuth 2.0 Token UX flow" que espera
   gesto del usuario. En navegadores que bloquean cookies de terceros hacia
   accounts.google.com (Tracking Prevention y similares), eso terminaba
   mostrando la ventana de Google una y otra vez sin que nadie la pidiera.

   Ahora se usa google.accounts.oauth2.initCodeClient (flujo de código):
   el popup de Google sigue apareciendo, pero SOLO la primera vez (o cuando
   el refresh_token se vence/revoca del todo). El `code` que devuelve se
   canjea contra worker-notificaciones-agenda (POST /oauth/exchange), que
   usa el client_secret (nunca expuesto acá) para conseguir un
   access_token + un refresh_token de verdad. Ese refresh_token se guarda
   en localStorage (CLAVE_REFRESH_TOKEN, ver más abajo) y es lo que permite
   pedir access_tokens nuevos con POST /oauth/refresh — una llamada REST
   pura, servidor a servidor, que NUNCA puede mostrar una ventana. Ver
   asegurarTokenValido() en storage-sync.js, el único punto que llama a
   ese refresco de acá en adelante.

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
const DRIVE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const NOMBRE_ARCHIVO_DATOS = "app_academica_datos.json";

// Mismo Worker que ya usan agenda-google-tasks.js/asistente-bandeja.js —
// mismo criterio de "duplicar la constante es más simple que forzar un
// export cruzado solo para esto" ya documentado en esos archivos.
const URL_WORKER_NOTIFICACIONES = "https://worker-notificaciones-agenda.appacademica.workers.dev";

// 2026-08-25: dónde vive el refresh_token de Drive. Es una CREDENCIAL, no
// un dato de la app — vive únicamente en este dispositivo (localStorage,
// nunca en estado.datos, que es lo único que sincroniza a Drive) y nunca
// se manda a ningún lado salvo al propio Worker, en cada POST /oauth/refresh.
const CLAVE_REFRESH_TOKEN = "google_refresh_token";

// Google Tasks (2026-08-23), scope OPCIONAL e INCREMENTAL: la gran mayoría
// de usuarios nunca va a activar "Sincronizar con Google Tasks" (ver switch
// en Ajustes Avanzados), así que no tiene sentido pedirlo junto con
// DRIVE_SCOPE en el login normal — eso infla el pedido de permisos para
// TODOS los usuarios por una función que casi nadie usa. Se pide aparte,
// con su propio tokenClient, recién cuando el usuario prende ese switch
// (ver pedirAccessTokenGoogleTasks). Solo lectura: la app nunca necesita
// escribir ni completar tareas del lado de Google. NOTA: Google Tasks
// sigue en flujo implícito (initTokenClient) a propósito — es opcional,
// de solo lectura, y de bajísimo uso; no vale la pena la complejidad de
// código+refresh_token para esto todavía. Si en algún momento se reporta
// el mismo problema de ventanas repetidas acá, se migra igual.
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly";

let codeClient = null;
let accessToken = null;
let tasksTokenClient = null;
let accessTokenTasks = null;

/**
 * El <script> de Google se carga con async/defer, así que puede no estar
 * listo todavía cuando corre DOMContentLoaded (esto era la causa de que el
 * login fallara "al azar" y hubiera que recargar varias veces). Aquí
 * esperamos activamente (polling corto) a que exista window.google.accounts
 * antes de crear el codeClient.
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
 * Se llama una vez cuando la página carga (ver main.js).
 * Ahora es async: primero espera a que el script de Google esté listo, y
 * solo entonces crea el codeClient. Llama a `alListo()` cuando el botón de
 * login ya puede usarse, o a `alFallar()` si el script nunca cargó.
 */
async function inicializarGoogleAuth({ alObtenerToken, alListo, alFallar, alRechazarPermiso }) {
  try {
    await esperarGsiListo();
  } catch (e) {
    console.error(e);
    if (alFallar) alFallar();
    return;
  }

  codeClient = google.accounts.oauth2.initCodeClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    ux_mode: "popup",
    // access_type: "offline" es lo que le pide a Google que incluya un
    // refresh_token en la respuesta del canje — sin esto, initCodeClient
    // se comporta como el flujo implícito viejo en la práctica: el
    // access_token vence a la hora y no hay nada con qué renovarlo en
    // silencio, así que vuelve a aparecer el selector de cuenta en cada
    // sesión larga (el bug que este archivo entero existe para resolver).
    // prompt: "consent" fuerza que Google reemita el refresh_token incluso
    // si esta cuenta ya había autorizado la app antes (ej. bajo el flujo
    // implícito viejo) — sin esto, cuentas ya autorizadas simplemente no
    // reciben refresh_token nunca, por diseño de OAuth2 (ver el comentario
    // más abajo, en el callback, sobre el caso "Google no devolvió un
    // refresh_token").
    access_type: "offline",
    prompt: "consent",
    callback: async (respuesta) => {
      if (respuesta.error) {
        console.error("Error de autenticación:", respuesta);
        // El caso más común: el usuario cerró la ventana de consentimiento o
        // rechazó el permiso de Drive. Sin ese permiso la app no puede
        // guardar nada, así que se lo hacemos explícito en vez de dejarla en
        // un estado ambiguo (botón que "no hizo nada").
        if (alRechazarPermiso) alRechazarPermiso(respuesta.error);
        return;
      }

      // Ajuste (v8, sigue vigente con el flujo de código): Google reporta
      // en `scope` (CodeResponse) los permisos que el usuario realmente
      // aceptó — puede haber destildado justo el de Drive y aceptado el
      // resto (perfil/email). Se revisa ANTES de canjear el code (no tiene
      // sentido gastar el canje con el Worker si ya sabemos que no sirve).
      const scopesOtorgados = (respuesta.scope || "").split(" ");
      if (!scopesOtorgados.includes("https://www.googleapis.com/auth/drive.file")) {
        console.warn("Login sin permiso de Drive (scopes otorgados):", respuesta.scope);
        if (alRechazarPermiso) alRechazarPermiso("permiso_drive_no_otorgado");
        return;
      }

      let datos;
      try {
        datos = await intercambiarCodigoPorTokens(respuesta.code);
      } catch (e) {
        console.error("No se pudo canjear el código de Google con el Worker:", e);
        if (alRechazarPermiso) alRechazarPermiso("canje_fallido");
        return;
      }

      accessToken = datos.access_token;

      if (datos.refresh_token) {
        guardarRefreshTokenGoogle(datos.refresh_token);
      } else {
        // Pasa cuando Google considera que esta cuenta YA había autorizado
        // esta app antes (ej. quedó un permiso viejo del flujo implícito) —
        // en ese caso, por diseño de OAuth2, Google NO reemite un
        // refresh_token nuevo en cada consentimiento. La app sigue
        // funcionando esta sesión con el access_token que sí llegó, pero
        // sin refresh_token no hay forma de renovarlo sin volver a mostrar
        // el popup — hace falta que el usuario revoque el acceso viejo una
        // vez (https://myaccount.google.com/permissions, "App Académica")
        // para que la PRÓXIMA vez Google sí mande uno nuevo.
        console.warn(
          "Google no devolvió un refresh_token — probablemente esta cuenta ya había autorizado la app antes. " +
            "Para dejar de ver el popup hace falta revocar el acceso desde https://myaccount.google.com/permissions y volver a conectar."
        );
      }

      // v8.3 (Bug 3): se pasa también expires_in para que main.js pueda
      // programar el próximo refresco proactivo.
      alObtenerToken(accessToken, datos.expires_in);
    },
  });

  if (alListo) alListo();
}

/**
 * Dispara la ventana de login/consentimiento de Google. SIEMPRE muestra el
 * popup real de Google (no hay distinción "silenciosa" acá — esa parte
 * ahora la cubre asegurarTokenValido() en storage-sync.js, que ni siquiera
 * pasa por este archivo). Se llama de forma DIRECTA desde el click (sin
 * async antes) para no romper el gesto de usuario en navegadores móviles.
 */
function iniciarSesionConGoogle() {
  codeClient.requestCode();
}

/**
 * Canjea el `code` de Google (recién salido del popup) por access_token +
 * refresh_token, vía POST /oauth/exchange del Worker — el Worker es el
 * único lugar que conoce el client_secret, nunca este archivo. No guarda
 * nada del lado del Worker (ver worker-notificaciones-agenda/src/index.js,
 * manejarOAuthExchange): la respuesta de Google vuelve tal cual.
 */
async function intercambiarCodigoPorTokens(code) {
  const respuesta = await fetch(`${URL_WORKER_NOTIFICACIONES}/oauth/exchange`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // En modo popup, initCodeClient usa el ORIGEN de la página como
    // redirect_uri de forma implícita (Google lo documenta así) — hay que
    // mandar exactamente ese mismo valor acá para que el canje matchee.
    body: JSON.stringify({ code, redirect_uri: window.location.origin }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const error = new Error(datos.error || `El Worker respondió ${respuesta.status} al canjear el código.`);
    error.status = respuesta.status;
    throw error;
  }
  return datos; // { access_token, refresh_token?, expires_in, scope, token_type }
}

/**
 * Pide un access_token nuevo usando el refresh_token guardado, vía POST
 * /oauth/refresh del Worker — llamada REST servidor-a-servidor pura, NUNCA
 * puede mostrar una ventana de Google (a diferencia del refresco
 * silencioso viejo del flujo implícito). Es lo único que llama
 * asegurarTokenValido() en storage-sync.js para renovar la sesión.
 */
async function refrescarAccessTokenViaWorker(refreshToken) {
  const respuesta = await fetch(`${URL_WORKER_NOTIFICACIONES}/oauth/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    // "invalid_grant" es el caso esperado de refresh_token vencido/
    // revocado (ej. límite de 7 días en modo Prueba de Google Cloud) — se
    // propaga tal cual para que asegurarTokenValido() lo borre y pida
    // reconectar, en vez de reintentar contra algo que ya no sirve.
    const error = new Error(datos.error || `El Worker respondió ${respuesta.status} al refrescar el token.`);
    error.status = respuesta.status;
    throw error;
  }
  // Google normalmente NO manda refresh_token de vuelta en un refresco
  // (solo lo rota en casos puntuales) — si lo manda, se reenvía para que
  // quien llama actualice el guardado; si no, `refreshTokenNuevo` es null.
  return { token: datos.access_token, expiresIn: datos.expires_in, refreshTokenNuevo: datos.refresh_token || null };
}

/** Guarda/lee/borra el refresh_token de Drive — SOLO en este dispositivo (nunca sincroniza a Drive, es una credencial, no un dato de la app). */
function guardarRefreshTokenGoogle(refreshToken) {
  if (refreshToken) localStorage.setItem(CLAVE_REFRESH_TOKEN, refreshToken);
}
function leerRefreshTokenGoogle() {
  return localStorage.getItem(CLAVE_REFRESH_TOKEN);
}
function borrarRefreshTokenGoogle() {
  localStorage.removeItem(CLAVE_REFRESH_TOKEN);
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

/**
 * Revoca el token en memoria (el borrado de datos locales lo hace main.js).
 * 2026-08-25: también borra el refresh_token guardado — es la credencial
 * que le permite a este dispositivo volver a entrar sin popup, así que
 * cerrar sesión de verdad tiene que eliminarla (si no, "cerrar sesión y
 * entrar con otra cuenta" seguiría reusando el refresh_token de la cuenta
 * vieja). google.accounts.oauth2.revoke revoca TODOS los tokens que Google
 * emitió para este client_id+usuario (access y refresh por igual), así que
 * ni siquiera hace falta un revoke aparte para el refresh_token.
 */
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
 * REEMPLAZADA 2026-08-25 por refrescarAccessTokenViaWorker() (arriba, junto
 * al resto de las funciones de OAuth) — este refresco usaba el mismo
 * tokenClient implícito que ya no existe (ver initCodeClient más arriba).
 * Se deja este comentario como referencia histórica de POR QUÉ existía
 * (mismo motivo, distinta implementación): renovar la sesión sin volver a
 * mostrarle una ventana al usuario cada vez que un token de 1h vence.
 */

/**
 * Google Tasks (2026-08-23) — pide/renueva el access_token del scope
 * tasks.readonly, SEPARADO del token de Drive (`accessToken`/tokenClient de
 * arriba): son dos permisos distintos, otorgados en momentos distintos, así
 * que Google Identity Services los maneja con tokenClients propios cada
 * uno.
 *
 * `interactivo: true` fuerza la pantalla de consentimiento — se usa la
 * PRIMERA vez que el usuario prende el switch de Ajustes, para el permiso
 * nuevo. `interactivo: false` (default) pide un refresco silencioso
 * (`prompt: ""`, el mismo flujo implícito de siempre) — se usa en cada
 * sincronización posterior, para no interrumpir con un popup cada vez que
 * el token de 1 hora vence.
 *
 * SUPUESTO A VALIDAR EN PRUEBA REAL: como el usuario ya le dio a esta app
 * el permiso de Drive antes, la expectativa con Google Identity Services es
 * que un tokenClient nuevo pidiendo SOLO tasks.readonly muestre consentimiento
 * únicamente para ese permiso nuevo (no repite el de Drive) — pero esto no
 * se pudo probar contra la pantalla real de Google todavía. Si en la
 * práctica Google pide reconfirmar Drive también, no es un bug de este
 * código, es como responde la plataforma; en ese caso avisá para ajustar el
 * flujo (ej. mensaje explicativo antes de mostrar el popup).
 *
 * Devuelve el access_token (string) en éxito, o `null` si el usuario
 * rechazó el permiso, cerró la ventana, o el refresco silencioso no pudo
 * resolverse sin interacción — NUNCA tira, quien llama decide qué hacer
 * (ver agenda-google-tasks.js: sin token simplemente no sincroniza esta
 * vez, no es un error fatal).
 */
function pedirAccessTokenGoogleTasks({ interactivo = false } = {}) {
  return new Promise((resolve) => {
    if (!(window.google && google.accounts && google.accounts.oauth2)) {
      resolve(null);
      return;
    }
    if (!tasksTokenClient) {
      tasksTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: TASKS_SCOPE,
        callback: () => {}, // se sobreescribe en cada pedido, ver abajo
      });
    }
    tasksTokenClient.callback = (respuesta) => {
      if (respuesta.error) {
        console.warn("No se pudo obtener/renovar el permiso de Google Tasks:", respuesta.error);
        resolve(null);
        return;
      }
      accessTokenTasks = respuesta.access_token;
      resolve(accessTokenTasks);
    };
    tasksTokenClient.requestAccessToken({ prompt: interactivo ? "consent" : "" });
  });
}

/** true si este dispositivo ya tiene un access_token de Tasks en memoria
 * (no garantiza que siga vigente — igual que accessToken de Drive, se
 * valida de verdad recién al usarlo; ver pedirAccessTokenGoogleTasks para
 * renovarlo). Sirve para que agenda-google-tasks.js sepa si debe pedir uno
 * nuevo antes de llamar a la API. */
function haySesionGoogleTasksEnMemoria() {
  return Boolean(accessTokenTasks);
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
  subirArchivoBinarioADrive,
  // OAuth con refresh_token vía Worker (2026-08-25):
  borrarRefreshTokenGoogle,
  guardarRefreshTokenGoogle,
  leerRefreshTokenGoogle,
  refrescarAccessTokenViaWorker,
  // Google Tasks (2026-08-23):
  pedirAccessTokenGoogleTasks,
  haySesionGoogleTasksEnMemoria,
};
