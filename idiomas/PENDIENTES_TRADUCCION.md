# Pendiente de traducción — importación guiada del plan

Idioma fuente: español (`es`). Las cadenas de la guía están registradas en `ingles.json`, `italiano.json` y `frances.json`.

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

La bienvenida se mantiene en el onboarding. La guía de importación comienza directamente con la elección del tipo de plan. El flujo integrado sustituyó los pasos antiguos de las listas anteriores; estas se conservan como referencia de textos y no como instrucciones exactas de la interfaz actual.

## Integración onboarding/importación aplicada

La bienvenida permanece dentro del onboarding y la guía del plan comienza directamente con la elección del tipo de plan. Al finalizar, el onboarding lleva a Plan de estudios. El asistente integrado cubre enlace, PDF e imágenes; prepara automáticamente PDF cuando se eligen más de cuatro capturas; guía a Claude en Picture-in-Picture cuando el navegador lo admite, y ofrece la misma secuencia dentro de la app como alternativa. En móvil, permite compartir los archivos y el prompt desde el menú del sistema. Al volver, usa el parser real, muestra un resumen y una muestra de materias antes de importar. Las cadenas visibles nuevas están traducidas a inglés, italiano y francés.

## Estado actual

- El prompt técnico largo se presenta en español, inglés, italiano y francés. Los nombres de metadatos, encabezados CSV y valores de control permanecen sin traducir porque el importador los requiere literalmente.
- Sigue pendiente una revisión visual manual en navegador/móvil; las comprobaciones automatizadas de esta edición confirmaron sintaxis JavaScript y catálogos JSON válidos.
- La continuidad «Empezar en blanco» → primera materia manual → Semestres está implementada; véase `MAPA/MAPA_FUNCIONES.md`.
