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

// Google Tasks (2026-08-23), scope OPCIONAL e INCREMENTAL: la gran mayoría
// de usuarios nunca va a activar "Sincronizar con Google Tasks" (ver switch
// en Ajustes Avanzados), así que no tiene sentido pedirlo junto con
// DRIVE_SCOPE en el login normal — eso infla el pedido de permisos para
// TODOS los usuarios por una función que casi nadie usa. Se pide aparte,
// con su propio tokenClient, recién cuando el usuario prende ese switch
// (ver pedirAccessTokenGoogleTasks). Solo lectura: la app nunca necesita
// escribir ni completar tareas del lado de Google.
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks.readonly";

let tokenClient = null;
let accessToken = null;
let tasksTokenClient = null;
let accessTokenTasks = null;

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
 * Google Tasks (2026-08-23) — pide/renueva el access_token del scope
 * tasks.readonly, SEPARADO del token de Drive (`accessToken`/tokenClient de
 * arriba): son dos permisos distintos, otorgados en momentos distintos, así
 * que Google Identity Services los maneja con tokenClients propios cada
 * uno.
 *
 * `interactivo: true` fuerza la pantalla de consentimiento — se usa la
 * PRIMERA vez que el usuario prende el switch de Ajustes, para el permiso
 * nuevo. `interactivo: false` (default) pide un refresco silencioso
 * (`prompt: ""`), igual que refrescarAccessTokenGoogle — se usa en cada
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
  refrescarAccessTokenGoogle,
  subirArchivoBinarioADrive,
  // Google Tasks (2026-08-23):
  pedirAccessTokenGoogleTasks,
  haySesionGoogleTasksEnMemoria,
};
