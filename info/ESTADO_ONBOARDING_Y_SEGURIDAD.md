# Estado de onboarding e importación y seguridad

## Aplicado en archivos

- El cierre del onboarding continúa al plan de estudios sin una segunda bienvenida; la guía de importación y sus traducciones quedan conectadas después del onboarding.
- Los recordatorios de tareas, exámenes y eventos se eligen por separado con selección múltiple, igual que en Ajustes. Los enlaces importantes actualizan la lista con la ruta correcta.
- La guía reconoce «en blanco» en francés. El popover calcula espacio arriba/abajo y se desplaza cuando no cabe completo.
- En el recorrido inicial, «Empezar en blanco» ahora continúa a Semestres y abre su guía tras guardar la primera materia; no afecta las guías abiertas desde Ajustes.
- Ajustes incluye acceso a Términos y privacidad, con documentos por idioma y visor de Markdown seguro.
- La pantalla de acceso ofrece abrir Chrome/Safari al detectar navegadores integrados; el aviso está localizado.
- El prompt técnico largo de importación ya se genera en ES/EN/IT/FR y mantiene intactos los tokens del parser.
- La vista previa de Wapper recibe solo si Gemini está configurado, nunca la clave.
- Las nuevas exportaciones y copias rotativas excluyen `gemini_api_key`. Los respaldos que ya existen en Drive pueden conservarla; su limpieza requiere autorización específica porque eliminaría copias históricas.
- Worker: autenticación Google en rutas privadas de competencias, límites para apodo/nombre/horas/zona horaria, anonimización al eliminar cuenta, búsqueda de participaciones remotas para borrado completo y logs sin cuerpos OAuth.
- Worker: límites de tráfico configurados; las cabeceras del sitio incluyen protecciones comunes y CSP en modo Report-Only. jsPDF/html2canvas tienen SRI.
- Migraciones y build previo se conservan en `worker - Uso para Chat/archivadas/`; el módulo Web Push obsoleto está en `archivadas/codigo-deprecado/`. Se actualizó el README y se quitaron variables VAPID sin uso de `wrangler.toml`.
- Existe `info/PLAN_RESPUESTA_INCIDENTES.md`.

## Pendiente antes de publicar

- Desplegar y comprobar Worker y binding de rate limit en Cloudflare; no se desplegó desde esta sesión.
- Confirmar en Cloudflare que ninguna versión activa o rollback usa el secreto privado VAPID antes de eliminarlo; la clave pública no es un secreto. Revisar/rotar `CLIENT_SECRET_GOOGLE` si estuvo expuesto fuera de Secrets.
- Revisar la CSP en Report-Only en el dominio publicado antes de pasarla a bloqueo.
- Configurar 2FA/passkeys y protección de `main` en GitHub, Cloudflare y Google; restringir la clave de navegador de Google y publicar/verificar política de privacidad.
- Configurar copias D1 y decidir retención, ubicación de Gemini entre dispositivos y consulta legal.
- Aprobar la limpieza de respaldos históricos de Drive que podrían contener la clave; el auto-revisor bloqueó su eliminación remota por posible pérdida de copias valiosas.
- Verificar visualmente en teléfono/PC la guía y el onboarding. No se ejecutaron pruebas de navegador ni de integración; este control queda pendiente.

