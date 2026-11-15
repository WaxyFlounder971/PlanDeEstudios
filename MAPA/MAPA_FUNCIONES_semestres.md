## JS — Semestres

### semestres.js
Propósito: Alta/edición/listado de semestres — formulario completo (nombre, fecha, duración, Modo Hardcore, buscador + filtro por estado, checklist de materias), sincronía Matrícula↔Plan, modo edición (editar/borrar semestres), y el render del listado (dashboard + actual + futuros + pasados, y al fondo Agregar / Editar semestres fuera de las tarjetas) con mecanismo anti-scroll-fantasma.
Depende de: core/schema.js, core/storage/storage-sync.js, core/storage/storage.js, core/utils.js, ui/componentes.js, plan/plan-gestionar.js, semestres/semestres-tarjetas.js, semestres/semestres-dashboard.js, semestres/semestres-proyectar.js, main.js (import circular intencional, mismo patrón que ui/componentes.js)
Exporta:

* `abrirModalAltaSemestre(semestreExistente = null)` — abre el modal de alta (o edición, si se pasa un semestre) de un semestre.
* `buscarSemestreVivoPorId(semestreId)` — relee el semestre vigente desde `estado.datos` por id, para evitar referencias huérfanas si un sondeo remoto reemplazó el estado mientras el modal estaba abierto.
* `navegarASemestre(semestreId)` — cambia a la sección Semestres, expande la tarjeta de ese semestre, re-renderiza y hace scroll suave + destello hasta ella.
* `obtenerSemestreAdyacente(semestreId, direccion)` — devuelve el semestre siguiente (`direccion=1`) o anterior (`direccion=-1`) en orden cronológico; envuelve en los extremos. Usado por la navegación con flechas de Horario.
* `obtenerSemestresActuales()` — semestres con estado efectivo `"actual"`, ordenados desc por fecha_inicio.
* `obtenerSemestresFuturos()` — semestres planeados que aún no empiezan (estado efectivo `"futuro"`), del más cercano al más lejano.
* `obtenerSemestresOrdenCronologico()` — todos los semestres reales ordenados asc por fecha_inicio (orden real, sin separar actuales/pasados; excluye los planeados que aún no empiezan para que Horario, Agenda y Ajustes no los traten como en curso).
* `obtenerSemestresPasados()` — semestres con estado efectivo `"pasado"`, ordenados desc por fecha_inicio.
* `renderizarSemestres(omitirRestauracionScroll = false)` — punto de entrada de la sección; repinta dashboard académico + listado completo dentro de `#seccion-semestres`. `omitirRestauracionScroll=true` cuando el caller (ej. `aplicarDatosRemotosFrescos`) ya se encarga de restaurar el scroll por su cuenta.
* `vincularProfesorAMateriaMatriculada(semestreId, mmId, profesorId)` — agrega un profesor a `mm.profesor_ids` de una materia matriculada (usado desde el modal de bloque de Horario).

### semestres-dashboard.js
Propósito: Pestaña contraíble "Historial académico" al inicio de la sección Semestres — estadísticas de aprobación (barra dividida + detalle por estado) y promedio ponderado (por semestre+universidad y por plan/carrera); colapsada por default para no empujar el resto del contenido.
Depende de: core/storage/storage.js, core/utils.js, core/schema.js
Exporta:

* `construirDashboardAcademico(onCambiar)` — arma la tarjeta completa del dashboard (encabezado + selector de vista + vista activa); si está colapsado devuelve solo el encabezado, sin empujar nada hacia abajo.

### semestres-tarjetas.js
Propósito: Tarjetas de semestre y de materia matriculada — motor de notas completo (criterios, asignaciones, cálculo de nota final en vivo, proyecciones/objetivos, resolución de conflictos de sync) y drag-and-drop de reordenamiento. Es el archivo más grande del proyecto (~3540 líneas); casi todo su contenido son funciones privadas del modal de notas, solo 3 quedan expuestas afuera.
Depende de: core/storage/storage.js, core/utils.js, ui/componentes.js, core/schema.js, core/storage/storage-sync.js, plan/plan-vista-lista-tarjetas.js, plan/plan-detalle.js, plan/plan-vista-lista.js, semestres/semestres-proyectar.js
Exporta:

* `construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar, onEditar, onBorrar, anidada = false)` — construye la tarjeta completa de un semestre (encabezado + sus materias matriculadas), expandible/colapsable.
* `abrirModalTodosLosConflictos()` — abre el modal que lista todos los conflictos de sync pendientes de resolver en Semestres (matrícula, criterio, semestre), con botón para resolver cada uno.
* `registrarAbrirTarjetaProfesorFlotante(fn)` — inyecta (desde `comunidad.js`, al inicializar) la función que abre la tarjeta flotante de un profesor con botón "Ir a Comunidad"; evita un ciclo de imports semestres-tarjetas.js↔comunidad.js.

### semestres-proyectar.js
Propósito: botón **Proyectar**, vista Proyectar, «Materias desbloqueadas», «Armar semestre futuro» y cuerpo de los semestres planeados (badge «Planeado», Editar / Eliminar). Proyectar aparece centrado al final de las materias del semestre actual (solo si tiene materias); al tocarlo la misma tarjeta cambia de vista: cada materia muestra solo línea de color, código y nombre más los botones Aprobada / Reprobada (tocar el activo lo desmarca; las materias con `mm.resultado` real salen premarcadas). Las marcas son una simulación: **nunca se guardan** ni tocan `materia.estado` ni `mm.resultado`, y no hay notas en ningún lado. Con todas las materias marcadas aparece «Materias desbloqueadas:» (solo las nuevas, en orden del plan) y «Armar semestre futuro»: tarjetas de TODAS las disponibles (nuevas + ya disponibles + reprobadas con etiqueta «Repetir»; no se ofrecen las ya planeadas en otro semestre futuro), se eligen tocándolas (borde/fondo azul + luz verde), contador de créditos verde/ámbar/rojo según el período, nombre editable y «Guardar semestre planeado». El período sale del siguiente período libre configurado en Estadísticas → Proyección (si nunca los definió usa los de ejemplo). Se guarda un semestre más en `semestres[]` con `planeado: true`, `fecha_inicio` = inicio del período y `duracion_semanas` calculadas; editar reconcilia la matrícula (tumbas incluidas). Estado de UI en `estado.proyectarSemestre` (no se guarda). CSS con prefijo `.sp-` al final de design-system.css.
Depende de: core/schema.js, core/i18n.js, core/storage/storage-sync.js, core/storage/storage.js, core/utils.js, ui/componentes.js, plan/plan-proyeccion.js
Exporta:

* `construirBotonProyectar(semestre, obtenerPlanPorId, onCambiar)` — botón Proyectar del semestre actual (o `null` si no aplica).
* `construirVistaProyectar(semestre, obtenerPlanPorId, onCambiar)` — vista Proyectar completa (marcas, resultado, armar y Volver).
* `construirCuerpoPlaneado(semestre, obtenerPlanPorId, onCambiar, onBorrar)` — cuerpo expandido de un semestre planeado (materias + Editar / Eliminar, o la selección si se está editando).
* `construirBadgePlaneado()` — badge «Planeado» de la tarjeta.
* `estaProyectando(semestreId)` — si ese semestre está en la vista Proyectar (o en edición de planeado).
* `iniciarEdicionPlaneado(semestre, onCambiar)` — reabre la selección de un semestre planeado con lo guardado.
