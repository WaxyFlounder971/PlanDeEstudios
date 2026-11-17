# Seguridad: acciones que requieren acceso externo

Los cambios locales se aplicaron en el código y en la configuración del Worker. No se publicó el Worker ni se modificaron cuentas externas.

## Cloudflare

- Confirmar en el dashboard que la versión desplegada del Worker coincide con el código actual y que los bindings `COMPETENCIAS_RATE_LIMIT` y `ANALITICA_RATE_LIMIT` existen y están activos.
- Web Push ya no forma parte de los flujos activos del cliente ni del Worker local; sus módulos antiguos del cliente y servidor están archivados en `archivadas/codigo-deprecado/` y `worker - Uso para Chat/archivadas/codigo-deprecado/`, respectivamente. `wrangler.toml` ya no declara variables VAPID y el módulo anterior se conserva en `worker - Uso para Chat/archivadas/codigo-deprecado/`. La clave pública VAPID no es un secreto. Antes de eliminar el secreto privado VAPID que pudiera seguir configurado en Cloudflare, confirmar que ninguna versión activa o rollback lo necesita.
- Revisar `CLIENT_SECRET_GOOGLE` en Secrets. Si alguna vez se guardó en Git o en un archivo distribuido, rotarlo en Google Cloud y actualizar el secreto de Cloudflare.
- Configurar copias de seguridad/Time Travel de D1 y acordar retención antes de purgar competencias o tablas históricas.
- Mantener los secretos de soporte y analítica únicamente en el gestor de secretos; no copiarlos a archivos versionados.

## Google Cloud y publicación

- Restringir la clave de navegador a los dominios controlados y verificar el dominio y la política de privacidad publicados.
- Revisar permisos OAuth y requisitos de verificación al salir del modo de prueba.
- Activar MFA/passkeys y protección de rama en GitHub, Cloudflare y Google.
- Revisar la CSP en modo Report-Only en el dominio publicado y ajustar fuentes antes de pasarla a bloqueo.

## Producto y cumplimiento

- Consultar sobre Ley 8968, PRODHAB y términos antes de cobrar o ampliar el acceso.
- Decidir si la clave Gemini debe seguir sincronizándose por Drive; guardarla en un solo dispositivo cambia el comportamiento multidispositivo.
- Ajustar responsables, contactos y requisitos legales del procedimiento `PLAN_RESPUESTA_INCIDENTES.md`.

## Datos históricos

Las nuevas exportaciones y copias rotativas excluyen `gemini_api_key`. Las copias históricas de Drive pueden conservarla. La limpieza remota no se hizo porque podría eliminar respaldos valiosos; requiere identificar y revisar esas copias antes de decidir su retención o eliminación.

Los cambios permanecen locales hasta publicar deliberadamente. No ejecutes las migraciones históricas ni alteres tablas remotas sin revisar el plan, confirmar el entorno y contar con respaldo recuperable.


