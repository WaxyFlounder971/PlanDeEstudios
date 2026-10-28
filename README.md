# App Académica

Aplicación web instalable (PWA) para organizar el Plan de Estudios, semestres, materias, notas, horario, agenda, notas rápidas y finanzas. Usa módulos ES nativos y guarda los datos de la cuenta como un documento sincronizado con Google Drive, con caché local para continuar sin conexión.

## Abrir el proyecto

La entrada es `index.html`, que carga `js/main.js` como módulo. Sirve la carpeta raíz desde un servidor web local y abre la URL en el navegador; no abras `index.html` con `file://`, porque los módulos ES, el Service Worker y varias funciones de la PWA requieren un origen web.

El proyecto no tiene paso de compilación: los módulos se cargan directamente desde `js/`.

## Secciones principales

- **Plan de Estudios:** planes, materias, requisitos, importación y mapa curricular.
- **Semestres:** matrícula, notas, ponderados y horario asociado.
- **Agenda y Notas rápidas:** tareas/eventos y notas locales sincronizadas con la cuenta.
- **Finanzas:** modelo unificado para movimientos, Disponible, Plan, metas, categorías, presupuesto, importación/exportación, préstamos y cuentas. Consulta el [mapa completo de Finanzas](MAPA/MAPA_FUNCIONES_finanzas.md) y el [mapa del modelo JSON](MAPA/MAPA_JSON.md).
- **Comunidad, Horario y Tiempo:** profesores/compañeros, horarios, seguimiento de tiempo y herramientas relacionadas.

## Estructura

- `js/core/`: esquema, almacenamiento, sincronización, autenticación y lógica compartida.
- `js/core/finanzas/`: reglas y cálculos del dominio financiero.
- `js/finanzas/`: shell y pantallas de Finanzas.
- `js/plan/`, `js/semestres/`, `js/agenda/`, `js/notas/`, `js/horario/`, `js/comunidad/`, `js/tiempo-estudio/`: secciones funcionales.
- `idiomas/`: catálogos de idioma e interfaz.
- `demo/`: datos ficticios para el modo de demostración.
- `tests/`: pruebas automatizadas del proyecto.
- `MAPA/`: documentación técnica y mapas de funciones/datos.

## Documentación técnica

- [Arquitectura y decisiones de módulos](ARQUITECTURA.md)
- [Mapa de funciones general](MAPA/MAPA_FUNCIONES.md)
- [Mapa completo de Finanzas](MAPA/MAPA_FUNCIONES_finanzas.md)
- [Esquema y colecciones de datos](MAPA/MAPA_JSON.md)
- [Service Worker y caché offline](MAPA/MAPA_SERVICE_WORKER.md)

La documentación es una guía del código vigente, no una instrucción para copiar encima archivos de versiones anteriores. Al añadir una colección sincronizada, actualiza el esquema, la migración, la fusión y estos mapas juntos.
