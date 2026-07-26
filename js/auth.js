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

const CLIENT_ID = "906522073616-7ofa7i3emqocojhlkh9ot9i0itljmd50.apps.googleusercontent.com";
// El scope de Drive por sí solo NO alcanza para que /oauth2/v3/userinfo
// devuelva "name"/"picture": hace falta pedir también identidad básica
// (openid/email/profile) junto con el permiso mínimo de archivo de Drive.
const DRIVE_SCOPE = "openid email profile https://www.googleapis.com/auth/drive.file";
const NOMBRE_ARCHIVO_DATOS = "app_academica_datos.json";
const CLAVE_YA_AUTORIZADO = "google_ya_autorizado";

let tokenClient = null;
let accessToken = null;

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
 * Se llama una vez cuando la página carga (ver app.js).
 * Ahora es async: primero espera a que el script de Google esté listo, y
 * solo entonces crea el tokenClient. Llama a `alListo()` cuando el botón de
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

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (respuesta) => {
      if (respuesta.error) {
        console.error("Error de autenticación:", respuesta);
        // El caso más común: el usuario cerró la ventana de consentimiento o
        // rechazó el permiso de Drive. Sin ese permiso la app no puede
        // guardar nada, así que se lo hacemos explícito en vez de dejarla en
        // un estado ambiguo (botón que "no hizo nada").
        if (alRechazarPermiso) alRechazarPermiso(respuesta.error);
        return;
      }

      // Ajuste (v8): Google NO reporta respuesta.error cuando el usuario
      // destilda específicamente la casilla de Drive en la pantalla de
      // consentimiento pero acepta el resto (perfil/email) — llega un token
      // "válido" que simplemente no sirve para guardar nada en Drive. Sin
      // esta revisión, un usuario distraído podía entrar, llenar toda su
      // información, y enterarse recién al final de que nunca se pudo
      // guardar. Se verifica explícitamente que el scope de Drive esté
      // dentro de lo realmente otorgado (respuesta.scope) antes de dejarlo
      // entrar a la app.
      const scopesOtorgados = (respuesta.scope || "").split(" ");
      if (!scopesOtorgados.includes("https://www.googleapis.com/auth/drive.file")) {
        console.warn("Login sin permiso de Drive (scopes otorgados):", respuesta.scope);
        // No se guarda CLAVE_YA_AUTORIZADO: así el próximo intento vuelve a
        // forzar la pantalla completa de consentimiento (prompt "consent"),
        // en vez de un prompt liviano que podría repetir el mismo problema.
        if (alRechazarPermiso) alRechazarPermiso("permiso_drive_no_otorgado");
        return;
      }

      accessToken = respuesta.access_token;
      localStorage.setItem(CLAVE_YA_AUTORIZADO, "1");
      // v8.3 (Bug 3): se pasa también expires_in (segundos que Google dice
      // que dura el token, normalmente 3600) para que app.js pueda programar
      // un refresco silencioso proactivo ANTES de que expire, en vez de
      // enterarse recién cuando un guardado falla con 401.
      alObtenerToken(accessToken, respuesta.expires_in);
    },
  });

  if (alListo) alListo();
}

/**
 * Dispara la ventana de login/consentimiento de Google.
 * Se llama de forma DIRECTA desde el click (sin async antes) para no
 * romper el gesto de usuario en navegadores móviles.
 * Punto 3 del reporte: solo se fuerza la pantalla completa de "consent" la
 * PRIMERA vez; en logins siguientes se usa un prompt más liviano para que
 * cerrar sesión y volver a entrar sea rápido.
 */
function iniciarSesionConGoogle() {
  const yaAutorizado = localStorage.getItem(CLAVE_YA_AUTORIZADO) === "1";
  tokenClient.requestAccessToken({ prompt: yaAutorizado ? "" : "consent" });
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

/** Revoca el token en memoria (el borrado de datos locales lo hace app.js). */
function cerrarSesionGoogle() {
  if (accessToken) {
    google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
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
    `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=media`,
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
}

/**
 * v7 (Bug 2): pide un access_token nuevo de forma silenciosa (prompt vacío),
 * usado para refrescar automáticamente la sesión cuando una llamada a Drive
 * devuelve 401 — los tokens de Google duran ~1 hora y no se refrescan solos.
 * Devuelve una Promise que resuelve con el nuevo token, o rechaza si el
 * refresco también falla (ej. el usuario revocó el acceso desde su cuenta).
 * No pisa el callback normal de login: lo restaura apenas responde.
 */
function refrescarAccessTokenGoogle() {
  return new Promise((resolve, reject) => {
    if (!tokenClient) {
      reject(new Error("No se puede refrescar: tokenClient no está inicializado."));
      return;
    }
    const callbackOriginal = tokenClient.callback;
    tokenClient.callback = (respuesta) => {
      tokenClient.callback = callbackOriginal;
      if (respuesta.error) {
        reject(new Error("No se pudo refrescar el token de Google: " + respuesta.error));
        return;
      }
      accessToken = respuesta.access_token;
      // v8.3 (Bug 3): se resuelve con un objeto (no solo el string del token)
      // para que quien llama pueda reprogramar el próximo refresco proactivo
      // con el expires_in real de ESTA renovación.
      resolve({ token: accessToken, expiresIn: respuesta.expires_in });
    };
    tokenClient.requestAccessToken({ prompt: "" });
  });
}
