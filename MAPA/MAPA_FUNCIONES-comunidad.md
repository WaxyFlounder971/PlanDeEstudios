## JS — Comunidad

### comunidad.js
Propósito: Sección Comunidad completa (`#seccion-comunidad`) — profesores (alta/edición, calificación general 1-10, "¿volverías a llevarlo?", vinculación a materias por semestre) y compañeros (alta/edición, materias compartidas, importar contacto vía Contacts Picker API).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, core/clipboard.js, semestres/semestres.js, plan/plan-detalle.js, semestres/semestres-tarjetas.js
Exporta:

* `inicializarComunidad()` — se llama una vez al arranque (antes de un posible `mostrarApp()` por caché); registra en plan-detalle.js y semestres-tarjetas.js los callbacks reales de "abrir alta de profesor" y "abrir tarjeta flotante de profesor" para evitar ciclos de import. No crea nodos nuevos (el contenedor ya viene en index.html).
* `renderizarComunidad()` — reconstruye `#seccion-comunidad` completo (pills Profesores/Compañeros + la lista correspondiente); requiere `estado.datos` ya cargado.
* `abrirModalAltaProfesor(profesorExistente?, preseleccionMmId?, onGuardado?)` — abre el modal de alta/edición de profesor. `preseleccionMmId` precarga una materia matriculada a vincular (usado desde el selector de Historial de Plan de Estudios); `onGuardado` se llama justo después de guardar con éxito, para que quien abrió el modal desde otra sección refresque su propia vista.

> ⚠️ Nota aparte del índice: comunidad.js tiene **3948 líneas** — muy por encima del límite de 800 líneas por archivo que ya rige el resto del proyecto. Si en algún momento se toca este archivo, puede valer la pena partirlo (ej. `comunidad-profesores.js` / `comunidad-companeros.js`) antes de seguir agregándole cosas.
