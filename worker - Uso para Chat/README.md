# Worker de App Académica

Worker de Cloudflare que concentra actualmente el intercambio OAuth, las competencias compartidas, la analítica agregada y el soporte del sitio público. La agenda usa Google Calendar directamente y ya no envía notificaciones push desde este Worker.

## Estado activo

- **Código de entrada:** `src/index.js`; el soporte está en `src/soporte.js`.
- **D1:** binding `DB_NOTIFICACIONES`, base `db-notificaciones-agenda`. El esquema de referencia está en `schema.sql`; contiene tablas heredadas además de las tablas vigentes. No borres tablas heredadas sin confirmar primero su uso y contar con respaldo.
- **Cron:** `0 * * * *`, cierre horario de semanas de competencias. No es el cron antiguo de recordatorios.
- **Límites:** `COMPETENCIAS_RATE_LIMIT` y `ANALITICA_RATE_LIMIT`, configurados en `wrangler.toml`.
- **Código retirado:** el módulo antiguo de Web Push se conserva en `archivadas/codigo-deprecado/web-push.js`.
- **Migraciones:** `archivadas/migraciones/` es histórico; no ejecutes esos SQL otra vez contra producción sin un plan explícito.

## Rutas principales

- OAuth: `POST /oauth/exchange`, `POST /oauth/refresh`.
- Competencias: rutas bajo `/competencias` e identificadores bajo `/identificadores/:correo`.
- Analítica: `POST /analitica/demo-apertura`, `GET /analitica/panel`, `POST /analitica/evento`; recorridos y consentimiento en `/analitica/flujo`, `/analitica/flujos`, `/analitica/consentimiento` y `/analitica/ia`.
- Avisos generales: `/avisos/admin`, `/avisos/activos` y `/avisos/estado`.
- Soporte: `POST /soporte/chat`, `POST /soporte/ticket`.

## Configuración

Instala dependencias en esta carpeta con `npm install`. Para desarrollo local usa `npm run dev`; Wrangler requiere una sesión autenticada de Cloudflare.

La configuración declara la base D1 existente y sus límites en `wrangler.toml`. No crees otra base con `wrangler d1 create`: confirma primero el recurso existente en Cloudflare. Los secretos se configuran desde un entorno autenticado con Wrangler y nunca se guardan en archivos del proyecto:

- `CLIENT_SECRET_GOOGLE`
- `GEMINI_SOPORTE_KEY`
- `RESEND_API_KEY`
- `ANALITICA_ADMIN_CORREOS` (si se usa el panel administrativo)
- `ANALITICA_HASH_SECRET` (secreto aleatorio de al menos 32 caracteres; seudonimiza identificadores de analítica y avisos)
- `ANTHROPIC_API_KEY` (preferido, análisis de Claude; opcional hasta habilitar análisis con IA)
- `OPENAI_API_KEY` (respaldo opcional si Claude no está configurado)
- `ANTHROPIC_MODEL` y `OPENAI_MODEL` son variables opcionales para elegir modelos; los valores por defecto viven en `src/index.js`.
- `ANALITICA_CORREOS_STAKEHOLDERS` y `ANALITICA_NOMBRES_STAKEHOLDERS` (si se habilita la clasificación de stakeholders)

Las variables no secretas de soporte (`SOPORTE_ORIGEN`, `SOPORTE_EMAIL`, `SOPORTE_FROM`) están en `wrangler.toml`. Verifica que el remitente esté habilitado en Resend antes de usar el envío de tickets.

## Publicación y cambios de base

`migracion_20261018_analitica_flujos_avisos.sql` es una migración activa, separada del historial en `archivadas/migraciones/`. Debe aplicarse una sola vez a `DB_NOTIFICACIONES` antes de desplegar el código que usa esas tablas. Primero revisa el SQL, confirma la base y prepara un respaldo recuperable. `npm run deploy` publica el Worker y solo debe ejecutarse como parte de una publicación aprobada, después de revisar los cambios y bindings. Las migraciones dentro de `archivadas/migraciones/` no son pasos de despliegue.

## Retiro de Web Push

La aplicación migró los avisos de Agenda a Google Calendar. Este Worker no usa VAPID. La configuración local ya no declara sus variables VAPID; si aún existen secretos VAPID en Cloudflare, verifica qué versión está desplegada y que ningún Worker los consuma antes de eliminarlos desde el panel.
