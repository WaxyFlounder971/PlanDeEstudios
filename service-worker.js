/* =========================================================================
   SERVICE WORKER — App Académica (PWA)
   -------------------------------------------------------------------------
   Dos comportamientos de caché bien separados:
     1. Cascarón de la app (HTML/CSS/JS/íconos propios del proyecto):
        cache-first con actualización de fondo (stale-while-revalidate).
     2. Llamadas a Google (Drive API + auth): NUNCA se cachean ni se
        interceptan — pasan directo a la red. Si fallan por estar offline,
        el manejo de cola/reintento ya existente en storage-sync.js y
        storage-adjuntos.js se encarga; este archivo no debe interferir
        con eso de ninguna forma.

   ⚠️ VERSIONADO — LEER ANTES DE DESPLEGAR:
   Subí el número de VERSION en CADA despliegue que cambie cualquier
   archivo del cascarón (HTML/CSS/JS/íconos). Es la única señal que tiene
   este archivo para darse cuenta de que hay una versión nueva: si no lo
   subís, el navegador puede seguir sirviendo indefinidamente los archivos
   viejos cacheados a usuarios recurrentes, aunque el servidor ya tenga
   otros. Al subirlo, automáticamente:
     - Se crea un caché nuevo con nombre distinto (no se mezcla con el
       viejo — cero riesgo de quedar con una mezcla de archivos de dos
       versiones distintas al mismo tiempo).
     - En el próximo `activate`, se borra cualquier caché de una versión
       anterior de esta misma app.
     - Los usuarios que tengan la pestaña abierta ven el aviso de
       "Hay una actualización disponible" (ver main.js) la próxima vez que
       el navegador revise este archivo (recarga, o el chequeo periódico
       que main.js dispara cada una hora / al volver a primer plano).
   ========================================================================= */

// ⚠️ EL NÚMERO QUE EDITÁS A MANO EN CADA DESPLIEGUE VIVE ACÁ, Y SOLO ACÁ.
// Cumple DOS roles al mismo tiempo:
//   1. Sufijo del nombre de caché (ver CACHE_NAME abajo) — el navegador
//      compara el CONTENIDO DE ESTE ARCHIVO byte a byte contra lo que ya
//      tiene instalado; cambiar este string es lo único que le avisa que
//      hay una versión nueva (ver el bloque de arriba, "VERSIONADO").
//   2. Número que se muestra en Configuración → pie de página (ver
//      responderVersionAlMensaje() más abajo + main.js, que se lo pide a
//      este Service Worker por mensaje apenas arranca la app). index.html
//      y main.js NUNCA hardcodean el número — siempre lo leen de acá, así
//      que actualizar la versión en toda la app es cambiar ESTA línea y
//      nada más.
const VERSION = "v3.14.7"; // <-- subir en cada despliegue
const CACHE_NAME = `app-academica-${VERSION}`;
const PREFIJO_CACHE = "app-academica-";

// Cascarón mínimo garantizado desde la instalación: alcanza para que la
// app pueda ABRIR offline después de la primera visita, aunque el usuario
// todavía no haya navegado a ninguna sección. El resto de los módulos JS
// (plan/, semestres/, horario/, comunidad/, finanzas/, config/, ui/, etc.)
// se van sumando solos al caché a medida que el navegador los pide por
// primera vez — ver la estrategia en el evento 'fetch' más abajo. A
// propósito NO se mantiene acá una lista manual de cada archivo JS del
// proyecto: esa lista se desactualiza sola cada vez que se agrega o
// renombra un módulo y nadie se acuerda de tocar este archivo, dejando
// silenciosamente sin cachear justo lo nuevo.
const CASCARON_MINIMO = [
  "./",
  "index.html",
  "manifest.json",
  "css/design-system.css",
  "js/main.js",
  "imagenes/LogoApp.png",
  "imagenes/LogoApp-192.png",
  "imagenes/LogoApp-512.png",
];

// Cualquier petición a estos hosts se deja pasar SIN TOCAR: ni se cachea,
// ni se intercepta su respuesta, ni se le da una respuesta de caché si
// falla por estar offline. Cubre tanto la API de Drive (datos y binarios
// de adjuntos) como el flujo de autenticación de Google.
const DOMINIOS_GOOGLE_SIN_CACHE = new Set([
  "www.googleapis.com",
  "oauth2.googleapis.com",
  "accounts.google.com",
]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CASCARON_MINIMO))
  );
  // A propósito NO se llama self.skipWaiting() acá: si se llamara, el SW
  // nuevo tomaría control apenas termina de instalar, sin avisarle a nadie
  // ni darle chance al usuario de terminar lo que esté haciendo — es
  // exactamente lo que se pidió evitar. skipWaiting() solo se dispara más
  // abajo (evento 'message'), en respuesta directa al click del usuario en
  // el botón "Recargar" del aviso de actualización (ver main.js).
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((nombres) =>
        Promise.all(
          nombres
            .filter((nombre) => nombre.startsWith(PREFIJO_CACHE) && nombre !== CACHE_NAME)
            .map((nombre) => caches.delete(nombre))
        )
      )
      .then(() => self.clients.claim())
  );
});

// Disparado desde main.js cuando el usuario confirma la actualización
// (click en "Recargar" del aviso) — recién ahí el SW en espera pasa a
// activarse. Ver flujo completo en el registro de main.js.
//
// GET_VERSION (2026-08-23): agregado para que el número que se ve en
// Configuración → pie de página nunca se tenga que escribir a mano en
// index.html — main.js le pregunta a ESTE Service Worker (al que sea que
// esté controlando la pestaña en ese momento) qué VERSION tiene cargada, y
// pinta eso tal cual. Responde por event.source (la pestaña que preguntó),
// no por broadcast, así que no hace falta filtrar destinatarios.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
  if (event.data && event.data.type === "GET_VERSION") {
    event.source?.postMessage({ type: "VERSION", version: VERSION });
  }
});

/* =========================================================================
   NOTIFICACIONES PUSH REALES (recordatorios de Agenda)
   -------------------------------------------------------------------------
   El Worker de Cloudflare (proyecto separado, ver worker-notificaciones/)
   manda el push ya cifrado según el estándar Web Push — acá solo hace
   falta leer el JSON que trae adentro y mostrar la notificación del
   sistema operativo. Este service worker nunca decide CUÁNDO ni QUÉ
   mandar, solo la muestra cuando llega.
   ========================================================================= */

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch (e) {
    // Si por lo que sea el payload no es JSON válido, se muestra igual
    // una notificación genérica en vez de fallar en silencio — mejor un
    // aviso poco específico que ningún aviso.
    datos = {};
  }

  const titulo = datos.titulo || "Recordatorio de Agenda";
  const opciones = {
    body: datos.cuerpo || "",
    icon: "imagenes/LogoApp-192.png",
    badge: "imagenes/LogoApp-192.png",
    // Mismo tag para todos los recordatorios: si llegan 2 pushes casi
    // juntos y el usuario todavía no vio el primero, el sistema operativo
    // los apila/reemplaza en vez de llenar la bandeja de notificaciones
    // sueltas de la misma app.
    tag: "agenda-recordatorio",
    data: { url: "./?abrir=agenda" },
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

/**
 * Al tocar la notificación: si ya hay una pestaña de la app abierta, la
 * enfoca y le manda un mensaje para que salte a Agenda sin recargar (ver
 * el listener de 'message' en main.js). Si no hay ninguna abierta, abre
 * una pestaña nueva con "?abrir=agenda" (ver mostrarApp() en main.js, que
 * lee ese query param al terminar de cargar).
 */
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const listaClientes = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const clienteExistente = listaClientes.find((c) => "focus" in c);
      if (clienteExistente) {
        clienteExistente.postMessage({ tipo: "abrir-agenda" });
        return clienteExistente.focus();
      }
      return self.clients.openWindow("./?abrir=agenda");
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Solo se maneja GET. Todo lo demás (POST/PATCH/PUT/DELETE — que es
  // literalmente todo lo que escribe en Drive) se deja pasar intacto: la
  // Cache API tampoco tiene nada útil que hacer con eso.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Google (Drive API + auth): bypass total, siempre red.
  if (DOMINIOS_GOOGLE_SIN_CACHE.has(url.hostname)) return;

  // Solo se cachea lo que es del propio proyecto (mismo origen). Recursos
  // de terceros (Google Fonts, cdnjs, el script de Google Identity
  // Services) se dejan pasar sin interceptar: no hacen falta para que el
  // cascarón propio de la app cargue offline, y cachear respuestas
  // cross-origin (opacas, sin control real de expiración) agrega
  // complejidad que este cambio no pidió resolver.
  if (url.origin !== self.location.origin) return;

  // Cache-first con actualización de fondo (stale-while-revalidate): si
  // hay algo en caché se responde con eso al instante, y en paralelo se
  // pide la versión de red para dejar el caché al día de cara a la
  // PRÓXIMA carga (nunca se le hace esperar la red al usuario si ya había
  // algo servible). Esto cubre automáticamente cualquier archivo del
  // proyecto haya estado o no en CASCARON_MINIMO: el primer fetch de cada
  // módulo nuevo lo va sumando solo.
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const enCache = await cache.match(request);

      const alRed = fetch(request)
        .then((respuesta) => {
          if (respuesta && respuesta.ok) cache.put(request, respuesta.clone());
          return respuesta;
        })
        .catch(() => null);

      if (enCache) {
        // No se espera "alRed" — se actualiza el caché de fondo sin
        // demorar la respuesta que ya se le puede dar al usuario ya mismo.
        return enCache;
      }

      const respuestaRed = await alRed;
      if (respuestaRed) return respuestaRed;

      // Sin caché y sin red. Si era una navegación (ej. el usuario recarga
      // la app entera estando offline, en un dispositivo donde nunca se
      // llegó a visitar esta ruta puntual), se devuelve el index cacheado
      // como último recurso para no dejar el error genérico del navegador.
      if (request.mode === "navigate") {
        const indexCacheado = await cache.match("index.html");
        if (indexCacheado) return indexCacheado;
      }

      return new Response("Sin conexión y sin versión en caché todavía.", {
        status: 503,
        statusText: "Offline",
      });
    })
  );
});
