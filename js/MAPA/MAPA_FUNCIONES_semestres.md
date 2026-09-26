## JS — Semestres

### semestres.js
Propósito: Alta/edición/listado de semestres — formulario completo (nombre, fecha, duración, Modo Hardcore, buscador + filtro por estado, checklist de materias), sincronía Matrícula↔Plan, modo edición (editar/borrar semestres), y el render del listado (dashboard + actuales + pasados) con mecanismo anti-scroll-fantasma.
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, plan/plan-gestionar.js, semestres/semestres-tarjetas.js, semestres/semestres-dashboard.js, main.js (import circular intencional, mismo patrón que ui/componentes.js)
Exporta:

* `abrirModalAltaSemestre(semestreExistente = null)` — abre el modal de alta (o edición, si se pasa un semestre) de un semestre.
* `buscarSemestreVivoPorId(semestreId)` — relee el semestre vigente desde `estado.datos` por id, para evitar referencias huérfanas si un sondeo remoto reemplazó el estado mientras el modal estaba abierto.
* `navegarASemestre(semestreId)` — cambia a la sección Semestres, expande la tarjeta de ese semestre, re-renderiza y hace scroll suave + destello hasta ella.
* `obtenerSemestreAdyacente(semestreId, direccion)` — devuelve el semestre siguiente (`direccion=1`) o anterior (`direccion=-1`) en orden cronológico; envuelve en los extremos. Usado por la navegación con flechas de Horario.
* `obtenerSemestresActuales()` — semestres con estado efectivo `"actual"`, ordenados desc por fecha_inicio.
* `obtenerSemestresOrdenCronologico()` — todos los semestres ordenados asc por fecha_inicio (orden real, sin separar actuales/pasados).
* `obtenerSemestresPasados()` — semestres con estado efectivo `"pasado"`, ordenados desc por fecha_inicio.
* `renderizarSemestres(omitirRestauracionScroll = false)` — punto de entrada de la sección; repinta dashboard académico + listado completo dentro de `#seccion-semestres`. `omitirRestauracionScroll=true` cuando el caller (ej. `aplicarDatosRemotosFrescos`) ya se encarga de restaurar el scroll por su cuenta.
* `vincularProfesorAMateriaMatriculada(semestreId, mmId, profesorId)` — agrega un profesor a `mm.profesor_ids` de una materia matriculada (usado desde el modal de bloque de Horario).

### semestres-dashboard.js
Propósito: Pestaña contraíble "Historial académico" al inicio de la sección Semestres — estadísticas de aprobación (barra dividida + detalle por estado) y promedio ponderado (por semestre+universidad y por plan/carrera); colapsada por default para no empujar el resto del contenido.
Depende de: core/storage.js, core/utils.js, core/schema.js
Exporta:

* `construirDashboardAcademico(onCambiar)` — arma la tarjeta completa del dashboard (encabezado + selector de vista + vista activa); si está colapsado devuelve solo el encabezado, sin empujar nada hacia abajo.

### semestres-tarjetas.js
Propósito: Tarjetas de semestre y de materia matriculada — motor de notas completo (criterios, asignaciones, cálculo de nota final en vivo, proyecciones/objetivos, resolución de conflictos de sync) y drag-and-drop de reordenamiento. Es el archivo más grande del proyecto (~3540 líneas); casi todo su contenido son funciones privadas del modal de notas, solo 3 quedan expuestas afuera.
Depende de: core/storage.js, core/utils.js, ui/componentes.js, core/schema.js, core/storage-sync.js, plan/plan-vista-lista-tarjetas.js, plan/plan-detalle.js, plan/plan-vista-lista.js
Exporta:

* `construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar, onEditar, onBorrar, anidada = false)` — construye la tarjeta completa de un semestre (encabezado + sus materias matriculadas), expandible/colapsable.
* `abrirModalTodosLosConflictos()` — abre el modal que lista todos los conflictos de sync pendientes de resolver en Semestres (matrícula, criterio, semestre), con botón para resolver cada uno.
* `registrarAbrirTarjetaProfesorFlotante(fn)` — inyecta (desde `comunidad.js`, al inicializar) la función que abre la tarjeta flotante de un profesor con botón "Ir a Comunidad"; evita un ciclo de imports semestres-tarjetas.js↔comunidad.js.
