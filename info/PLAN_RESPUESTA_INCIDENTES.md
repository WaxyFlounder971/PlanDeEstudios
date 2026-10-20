# Plan inicial de respuesta a incidentes

1. **Contener:** revocar o rotar de inmediato la credencial afectada (Google OAuth, VAPID, Gemini u otra) y detener despliegues si se sospecha código alterado.
2. **Preservar evidencia:** anotar hora, sistemas afectados, cambios recientes y capturas/exportaciones de logs disponibles; no copiar tokens o datos personales a reportes públicos.
3. **Evaluar alcance:** revisar Cloudflare Worker/Pages, D1, Google Cloud y GitHub; identificar qué cuentas y datos pudieron quedar expuestos y durante qué periodo.
4. **Recuperar:** desplegar una versión conocida, restaurar D1 desde un respaldo verificado si hace falta y comprobar permisos/bindings antes de reabrir el servicio.
5. **Comunicar:** informar a las personas afectadas por un canal directo con los datos conocidos, acciones realizadas y pasos que deben tomar; evitar afirmar causas no verificadas.
6. **Revisar:** documentar causa raíz, corregir el control que falló y registrar responsables/fechas. Consultar asesoría legal y obligaciones de notificación aplicables.

Este documento es una guía operativa inicial, no reemplaza asesoría legal ni un análisis formal de impacto.
