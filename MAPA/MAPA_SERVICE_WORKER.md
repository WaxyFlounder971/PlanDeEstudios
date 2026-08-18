# MAPA_SERVICE_WORKER.md — Índice de `service-worker.js`

> `service-worker.js` no se importa desde ningún otro módulo (los service workers se registran, no se importan — el registro vive en `main.js`), y no tiene `export`. Por eso este mapa documenta sus **listeners de eventos** y **constantes** en vez de funciones exportadas, que es lo que otro archivo necesita conocer para interactuar con él (ej. main.js enviándole un mensaje `SKIP_WAITING`).

---

## service-worker.js
Propósito: cascarón offline de la PWA. Cachea el HTML/CSS/JS/íconos propios del proyecto (cache-first con actualización de fondo) y deja pasar sin tocar todo lo que va a Google (Drive API + auth), para no interferir con el manejo de cola/reintento offline que ya hacen `storage-sync.js` y `storage-adjuntos.js`.
Depende de: ninguno de los módulos del proyecto (es un script standalone que corre en su propio contexto de Service Worker, sin `import`). Se comunica con `main.js` únicamente vía `postMessage` (mensaje `SKIP_WAITING`).

### Constantes (equivalente a "exportado" — es lo que hay que tocar al desplegar o entender desde afuera)
* `VERSION` — string tipo `"v3"`. **Hay que subirla a mano en cada despliegue** que cambie cualquier archivo del cascarón; es la única señal que tiene el service worker para detectar que hay una versión nueva.
* `CACHE_NAME` — `` `app-academica-${VERSION}` ``, nombre del caché activo (derivado de `VERSION`).
* `PREFIJO_CACHE` — `"app-academica-"`, usado en `activate` para identificar y borrar cachés de versiones anteriores.
* `CASCARON_MINIMO` — array de rutas precacheadas en `install` (`index.html`, `manifest.json`, `css/design-system.css`, `js/main.js`, íconos). A propósito NO lista cada módulo JS del proyecto — el resto se cachea solo la primera vez que el navegador lo pide (ver evento `fetch`).
* `DOMINIOS_GOOGLE_SIN_CACHE` — `Set` con `www.googleapis.com`, `oauth2.googleapis.com`, `accounts.google.com`. Cualquier request a estos hosts se deja pasar sin interceptar ni cachear.

### Listeners de eventos (el "comportamiento exportado" del archivo)
* `install` — abre `CACHE_NAME` y precachea `CASCARON_MINIMO`. **No llama `self.skipWaiting()`** a propósito: el SW nuevo no toma control hasta que el usuario confirme (ver `message` más abajo).
* `activate` — borra cualquier caché cuyo nombre empiece con `PREFIJO_CACHE` y no sea el `CACHE_NAME` actual (limpieza de versiones viejas), y llama `self.clients.claim()`.
* `message` — si `event.data.type === "SKIP_WAITING"`, llama `self.skipWaiting()`. Disparado desde `main.js` cuando el usuario hace click en "Recargar" del aviso de actualización.
* `fetch` — solo maneja `GET`. Si el host es uno de `DOMINIOS_GOOGLE_SIN_CACHE`, o si es cross-origin, deja pasar la request sin tocar (`return` temprano). Para el resto (mismo origen): responde cache-first (si hay algo en `CACHE_NAME`, lo devuelve de inmediato) y en paralelo actualiza el caché con la respuesta de red (stale-while-revalidate). Si no hay caché y falla la red en una navegación, devuelve `index.html` cacheado como último recurso; si tampoco hay eso, responde `503`.

## Patrones transversales (Service Worker)
- **Subir `VERSION` en cada despliegue** que toque cualquier archivo del cascarón (HTML/CSS/JS/íconos) — es la regla operativa más importante del archivo, sin esto los usuarios recurrentes pueden quedar atrapados en una versión vieja indefinidamente.
- Nunca cachear ni interceptar tráfico hacia `DOMINIOS_GOOGLE_SIN_CACHE` — el manejo de offline para Drive vive en `storage-sync.js`/`storage-adjuntos.js`, no acá.
- `CASCARON_MINIMO` es intencionalmente mínimo — no hace falta (ni conviene) agregar cada módulo `.js` nuevo a mano ahí; el propio `fetch` los va sumando al caché solos.
