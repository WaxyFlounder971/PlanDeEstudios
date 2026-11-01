# MAPA_SERVICE_WORKER.md — Índice de `service-worker.js`

El Service Worker es un script independiente registrado por el arranque de la app. No importa módulos ES. Su número visible y nombre de caché derivan de `VERSION`; versión actual del código: `v3.26.7`.

## Constantes

- `VERSION`: etiqueta de versión. Incrementarla cuando una entrega deba instalar un caché nuevo; la app consulta el valor con `GET_VERSION`.
- `CACHE_NAME`: `app-academica-${VERSION}`.
- `PREFIJO_CACHE`: prefijo para identificar los cachés antiguos que se limpian al activar.
- `CASCARON_MINIMO`: HTML de entrada, manifest, idiomas esenciales, CSS, módulo de arranque, demo e iconos que se precargan al instalar.
- `DOMINIOS_GOOGLE_SIN_CACHE`: Drive y autenticación de Google; el SW los deja pasar sin intercepción ni caché.

Los módulos JS y recursos propios que no están en el cascarón se incorporan a CacheStorage al pedirse por primera vez. No hay una lista manual de todos los módulos de cada sección.

## Eventos

- `install`: precarga `CASCARON_MINIMO`; no fuerza `skipWaiting`, para que la persona elija cuándo actualizar.
- `activate`: borra cachés anteriores con el prefijo de la app y reclama las ventanas abiertas.
- `message`: `SKIP_WAITING` activa la versión en espera cuando se confirma el aviso; `GET_VERSION` responde a la pestaña que lo pidió con `{ type: "VERSION", version }`.
- `push`: muestra un recordatorio de Agenda recibido desde el servicio Push. Si el JSON no se puede leer, muestra una notificación genérica.
- `notificationclick`: enfoca una ventana existente y le envía `abrir-agenda`; si no hay ventana, abre `?abrir=agenda`.
- `fetch`: solo GET del mismo origen. Los hosts Google, recursos de terceros, solicitudes de escritura y el parámetro `ping` pasan directo. Navegaciones compartidas `title/text/url` usan una clave de caché sin query para no persistir contenido privado.

## Estrategia offline y privacidad

Para recursos propios, busca en caché primero y actualiza desde red en segundo plano. Si no existe la copia local, espera la red; si falla durante una navegación, intenta `index.html`; en otros casos devuelve 503. Las queries de contenido compartido no se guardan. El Service Worker no participa en la lógica de sincronización con Drive ni convierte las notificaciones de metas: esas decisiones viven en sus respectivos módulos.

## Operación de actualización

Al preparar una publicación, revisa `VERSION` en `service-worker.js`. Si se cambia, actualiza esta línea y el mapa técnico de la versión en la misma entrega. No añadas a mano los archivos JS de Finanzas u otras secciones a `CASCARON_MINIMO`; la estrategia de petición los agrega automáticamente.
