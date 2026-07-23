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
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const NOMBRE_ARCHIVO_DATOS = "app_academica_datos.json";

let tokenClient = null;
let accessToken = null;

/** Se llama una vez cuando la página carga (ver app.js). */
function inicializarGoogleAuth({ alObtenerToken }) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: (respuesta) => {
      if (respuesta.error) {
        console.error("Error de autenticación:", respuesta);
        return;
      }
      accessToken = respuesta.access_token;
      alObtenerToken(accessToken);
    },
  });
}

/** Dispara la ventana de login/consentimiento de Google. */
function iniciarSesionConGoogle() {
  tokenClient.requestAccessToken({ prompt: "consent" });
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
