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
async function inicializarGoogleAuth({ alObtenerToken, alListo, alFallar }) {
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
        return;
      }
      accessToken = respuesta.access_token;
      localStorage.setItem(CLAVE_YA_AUTORIZADO, "1");
      alObtenerToken(accessToken);
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
  return respuesta.json();
}

/** Sobrescribe el archivo de datos en Drive con el objeto completo. */
async function guardarDatos(token, fileId, datos) {
  await fetch(
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
}
