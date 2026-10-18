# Pendiente de traducción — importación guiada del plan

Idioma fuente: español (`es`). Las cadenas de esta guía ya están registradas en `ingles.json`, `italiano.json` y `frances.json`.

## Texto nuevo (traducido a inglés, italiano y francés)

- `Importar mi plan`
- `Importar tu plan`
- `Progreso de importación`
- `Elige cómo tienes tu plan: puedes usar un enlace público, un PDF o fotos. Si todavía no tienes el documento, también puedes empezar en blanco. Te acompaño en cada paso.`
- `Para una página pública, elige «Pegar link». Si tienes un archivo, elige «Adjuntar PDF/Imagen». Si tienes fotos o capturas, usa «Tomar capturas»: Wapper las reúne en un PDF para que Claude pueda leerlas.`
- `Ahora prepararás el plan con Claude. Copia la instrucción, abre Claude y adjunta el PDF o envíale el enlace. Sigue los pasos con calma; al terminar, vuelve aquí con la respuesta.`
- `Primero convierte tus fotos a PDF. Toca «Convertir imágenes a PDF», elige las capturas y confirma. Al volver aquí, continúa para preparar el archivo con Claude.`
- `Copia la respuesta completa de Claude y pégala aquí. Incluye las líneas de carrera, el encabezado CSV y todas las materias para que no falte información.`
- `Toca «Importar» para guardar el plan y revisar las materias. Después te guiaré a Semestres para que matricules lo que cursas ahora.`

La bienvenida se mantiene en el onboarding. La guía de importación comienza directamente con la elección del tipo de plan.

## Integración onboarding/importación aplicada

La bienvenida permanece dentro del onboarding y la guía del plan comienza directamente con la elección del tipo de plan. Al finalizar, el onboarding lleva a Plan de estudios. Los textos nuevos de la guía ya están traducidos a inglés, italiano y francés y se conservan arriba como referencia.

## Estado actual

- El prompt técnico largo se presenta en español, inglés, italiano y francés. Los nombres de metadatos, encabezados CSV y valores de control permanecen sin traducir porque el importador los requiere literalmente.
- Sigue pendiente la revisión visual en navegador/móvil de la guía, el flujo manual hasta Semestres y la selección múltiple.
- La continuidad «Empezar en blanco» → primera materia manual → Semestres está implementada; véase `MAPA/MAPA_FUNCIONES.md`.
