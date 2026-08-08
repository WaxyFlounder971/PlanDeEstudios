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
 * v7 (Bug 2): pide un access_token nuevo de forma silenciosa (prompt vacío),
 * usado para refrescar automáticamente la sesión cuando una llamada a Drive
 * devuelve 401 — los tokens de Google duran ~1 hora y no se refrescan solos.
 * Devuelve una Promise que resuelve con el nuevo token, o rechaza si el
 * refresco también falla (ej. el usuario revocó el acceso desde su cuenta).
 * No pisa el callback normal de login: lo restaura apenas responde.
 *
 * v9.2 (ajuste v1.8.7 — picker de cuenta apareciendo dentro de la app):
 * acepta un `correoConocido` opcional. Sin login_hint, un `prompt: ""`
 * "silencioso" en Google Identity Services NO garantiza que nunca aparezca
 * UI: si Google no puede resolver con certeza absoluta a qué cuenta/sesión
 * te refieres (común en Chrome/Safari de teléfono con protecciones de
 * cookies de terceros activas, o con más de una cuenta de Google en el
 * navegador), en vez de fallar en silencio muestra un selector liviano.
 * Eso es una decisión del lado de Google, no algo que este código dispare
 * a propósito — pero pasarle el correo ya conocido (login_hint) le quita a
 * Google la ambigüedad que lo lleva a mostrar ese selector, así que reduce
 * mucho la frecuencia real, aunque no la elimina al 100%: sigue siendo un
 * límite de la plataforma, no algo que se pueda forzar a funcionar siempre.
 */
function refrescarAccessTokenGoogle(correoConocido) {
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
    const opciones = { prompt: "" };
    if (correoConocido) opciones.hint = correoConocido;
    tokenClient.requestAccessToken(opciones);
  });
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
async function subirArchivoBinarioADrive(token, archivo) {
  const metadata = { name: archivo.name || "adjunto", mimeType: archivo.type || "application/octet-stream" };
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

export {
  buscarOCrearArchivoDatos,
  cerrarSesionGoogle,
  descargarArchivoBinarioDeDrive,
  eliminarArchivoDeDriveConId,
  guardarDatos,
  inicializarGoogleAuth,
  iniciarSesionConGoogle,
  leerDatos,
  obtenerMetadatosArchivo,
  obtenerPerfilGoogle,
  refrescarAccessTokenGoogle,
  subirArchivoBinarioADrive,
};
