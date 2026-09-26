## JS — Plan

### plan-categorias.js
Propósito: gestión de categorías personalizadas de materias (crear/editar categorías y asignar/quitar materias de cada una).
Depende de: schema.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista.js
Exporta:

* `abrirModalCategoria(categoria, plan)` — Abre el modal de crear/editar categoría; precarga nombre y color si `categoria` viene de editar, o lo deja vacío si es nueva.
* `abrirModalCategoriaMaterias(plan, categoria)` — Abre el modal de asignación de materias a una categoría, precargando como seleccionadas las que ya pertenecen a ella.
* `construirPanelCategorias()` — Construye la sección del panel de categorías del plan activo.
* `inicializarModalCategoria()` — Registra los listeners del modal crear/editar categoría (cancelar, eliminar, guardar).
* `inicializarModalCategoriaMaterias()` — Registra los listeners del modal de asignación de materias a categoría.
* `renderizarControlesCategoriaMaterias(plan, categoria)` — Renderiza el buscador y los controles de orden dentro del modal de materias por categoría.
* `renderizarListaMateriasCheckbox(plan, categoria)` — Renderiza la lista de checkboxes de materias disponibles para asignar/desasignar de la categoría.

### plan-detalle.js
Propósito: construye el contenido de detalle de una materia (tarjeta expandida en la lista y modal flotante) — requisitos, correquisitos, historial de intentos y búsqueda inversa ("Desbloquea").
Depende de: schema.js, storage.js, storage-sync.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista-tarjetas.js, semestres.js
Exporta:

* `abrirModalDesbloquea(materia, plan)` — Abre el modal "Es requisito para:" listando las materias que `materia` desbloquea.
* `abrirModalHistorial(materia, plan)` — Abre el modal de historial de intentos de la materia: cruza `materia.id`+`plan.id` contra todos los semestres y muestra cada intento con su estado efectivo.
* `abrirModalRequisito(codigo)` — Abre el modal navegable de detalle de una materia a partir de su código.
* `construirBloqueCompletoRequisitos(materia, plan)` — Arma el bloque combinado de Requisitos + Correquisitos + etiqueta de cupo original.
* `construirBloqueRequisitos(etiqueta, nodoRaiz, modo)` — Construye un bloque individual (Requisitos o Correquisitos) a partir del árbol Y/O; omite el bloque completo si está vacío salvo para "Requisitos".
* `construirBotonesFinalesDetalle(materia, plan, opciones)` — Construye la fila de botones finales del detalle (Desbloquea, Historial, etc.), variando según si es modal o tarjeta.
* `construirColumnaAccionesTarjeta(materia, plan)` — Construye la columna de acciones (badge de categoría y botones) de la tarjeta expandida.
* `construirCuerpoDetalleMateria(materia, plan, opciones)` — Punto de entrada que decide si arma el cuerpo en modo "tarjeta" (grid 2 columnas) o "modal" (1 columna).
* `construirCuerpoDetalleModal(materia, plan)` — Arma el cuerpo de detalle en el layout de 1 columna usado por el modal flotante.
* `construirCuerpoDetalleTarjeta(materia, plan)` — Arma el cuerpo de detalle en el grid de 2 columnas usado por la tarjeta expandida en la lista.
* `construirFilaRequisito(codigo, opciones)` — Construye la fila visual de un requisito individual (código de materia + su estado).
* `construirLinea1Materia(materia, plan)` — Construye la línea 1 del detalle (Bloque·Código + Categoría).
* `construirLinea2Materia(materia, compacto, plan)` — Construye la línea 2 (badge de Estado efectivo + Horas/Créditos), en versión compacta o completa.
* `construirLineaCategoriaMateria(materia, plan)` — Construye la línea de badge de categoría de la materia, o `null` si no tiene categoría.
* `construirMetaLineaMateria(materia, plan)` — Construye la línea de metadatos "Bloque N · Código" (o "Optativa · Código").
* `construirNodoRequisito(nodo, modo, profundidad)` — Renderiza recursivamente un nodo del árbol de requisitos (hoja código, o grupo Y/O).
* `inicializarModalDesbloquea()` — Registra los listeners de cierre del modal "Desbloquea".
* `inicializarModalHistorial()` — Registra los listeners de cierre del modal de historial.
* `inicializarModalRequisito()` — Registra los listeners de "Es requisito", "Historial" y "Cerrar" del modal de requisito, armados dinámicamente desde v8/v9.
* `abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, onVinculado)` — Abre un overlay para asignar/vincular un profesor a un intento del historial de la materia.
* `registrarAbrirAltaProfesorPreseleccionado(fn)` — Registra el callback (definido en comunidad.js) que abre el alta de profesor con datos preseleccionados; evita import circular.

### plan-esquema.js
Propósito: núcleo de acceso a los planes de estudio (plan activo/secundario, materias visibles/optativas/a revisar) y modales para crear plan / añadir materia manual / vincular optativa.
Depende de: schema.js, storage-sync.js, storage.js, plan-gestionar.js, plan-importacion-csv.js, plan-vista-lista.js
Exporta:

* `EJEMPLOS_PLACEHOLDER_PLAN` (const) — Placeholders de ejemplo de Carrera/Código según universidad (TEC, UCR, etc.) para los inputs del modal de crear plan.
* `LIMITE_PLANES_ESTUDIO` (const) — Número máximo de planes de estudio que el usuario puede tener (3).
* `abrirModalCrearPlan(paraSecundario, metadatosDetectados)` — Abre el modal de crear plan nuevo, marcando si es el plan secundario y precargando metadatos si vienen de una importación.
* `abrirModalMateriaManual(materiaExistente, planDeLaMateria)` — Abre el modal "+ Añadir materia" en modo alta o edición, según si se pasa una materia existente.
* `abrirModalVincularOptativa(materiaTemplate, plan, origen)` — Abre el modal para vincular una optativa disponible o una materia a revisar; `origen` indica de cuál arreglo especial viene, para quitarla del correcto al vincular.
* `actualizarFormatoHorasMateriaManual()` — Actualiza los campos de horas del modal de materia manual según los `tipos_horas` del plan activo.
* `aplicarDefaultsUniversidad(universidad)` — Aplica los valores por defecto (nombre de bloque, semanas, hora de inicio, etc.) de la universidad elegida a los inputs del modal de crear plan.
* `aplicarPlaceholdersAleatoriosPlan(universidad)` — Aplica placeholders aleatorios de ejemplo (Carrera/Código) a los inputs del modal según la universidad.
* `buscarMateriaPorCodigoEnPlanes(codigo)` — Busca una materia por código entre todas las materias visibles (plan principal + secundario). Devuelve la fila `{materia, plan, origen}` o `null`.
* `elegirPlaceholderPlan(universidad)` — Elige al azar un ejemplo de placeholder de `EJEMPLOS_PLACEHOLDER_PLAN` para la universidad dada.
* `filasFiltradas()` — Devuelve las materias visibles filtradas por categoría activa y texto de búsqueda actuales.
* `inicializarModalCrearPlan()` — Registra los listeners del modal de crear plan (selector de universidad, guardar, cancelar).
* `inicializarModalMateriaManual()` — Registra los listeners del modal de añadir/editar materia manual.
* `inicializarModalVincularOptativa()` — Registra los listeners del modal de vincular optativa.
* `mapearUniversidadDetectada(texto)` — Infiere el código de universidad (TEC/UCR/Otra) a partir de un texto libre detectado en una importación.
* `obtenerMateriasRevisar()` — Devuelve todas las filas `{materia, plan, origen}` de `materias_revisar` del plan principal y secundario.
* `obtenerMateriasVisibles()` — Devuelve todas las filas `{materia, plan, origen}` de materias regulares del plan principal y secundario.
* `obtenerOptativasDisponibles()` — Devuelve todas las filas `{materia, plan, origen}` de `optativas_disponibles` del plan principal y secundario.
* `obtenerPlanActivo()` — Devuelve el plan de estudio marcado como activo (`configuracion.plan_activo_id`), o `null`.
* `obtenerPlanSecundario()` — Devuelve el plan secundario de Modo Hardcore (ya no fusiona sus materias en las funciones de "visibles"; solo se usa para mostrarlo aparte).

### plan-gestionar.js
Propósito: modal de gestión de planes de estudio (listar, editar info, eliminar, elegir plan secundario/terciario en Modo Hardcore).
Depende de: schema.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista.js
Exporta:

* `abrirModalEditarPlanInfo(plan)` — Abre el modal de editar info del plan (carrera, universidad, código), precargando los valores actuales.
* `abrirModalGestionPlanes()` — Abre el modal de gestión de planes; de paso auto-corrige `plan_activo_secundario_id` si quedó en `null` por datos viejos.
* `eliminarPlanEstudio(planId)` — Elimina un plan de estudio del arreglo local y marca la tumba correspondiente para que el borrado se propague por sync (evita que "resuciten" al fusionar con otro dispositivo).
* `inicializarModalEditarPlanInfo()` — Registra los listeners del modal de editar info del plan.
* `inicializarModalGestionPlanes()` — Registra los listeners del modal de gestión de planes, incluido el cierre que resetea el mini-panel de importación.
* `recalcularPlanesHardcore(cfg)` — Recalcula automáticamente cuáles planes participan como secundario/terciario en Modo Hardcore (todos los que no son el principal, en orden de aparición).
* `renderizarListaGestionPlanes()` — Renderiza la lista de planes dentro del modal de gestión.
* `renderizarModoHardcore()` — Renderiza los controles de Modo Hardcore; siempre relee `estado.datos.configuracion` fresco en cada handler para evitar quedar con una referencia obsoleta tras un sondeo de sync.
* `renderizarSelectorPlan()` — Renderiza el selector de plan activo (o el mensaje de "no tienes ningún plan" si la lista está vacía).

### plan-importacion-csv.js
Propósito: parseo del CSV pegado/generado por IA hacia el modelo de plan de estudios, y su contraparte de serialización (árbol de requisitos, tipos de horas).
Depende de: schema.js, storage-sync.js, storage.js, componentes.js, plan-esquema.js, plan-importacion.js, plan-vista-lista.js
Exporta:

* `actualizarEstadoBotonesEnvioImportacion()` — Habilita/deshabilita el botón "Enviar a Claude" según si el modo es "link" y el link está vacío.
* `construirMiniPanelImportacion(plan)` — Construye el mini-panel de importación de CSV embebido en el modal de gestión de planes.
* `derivarTiposHorasDeHorasColumnas(horasColumnasCrudo)` — Convierte el texto crudo de columnas de horas (ej. "Teoría,Práctica") en un arreglo de tipos de horas.
* `importarCSVEnPlan(textoCSV, planDestino)` — Parsea un CSV crudo (extrayendo y descartando sus líneas de metadatos) y vuelca su contenido en `planDestino`.
* `manejarClickImportar(textoCSV)` — Handler del botón de importar: valida que haya CSV pegado y dispara el flujo de importación, mostrando errores si falla.
* `materiaPareceOptativa(materia)` — Determina si una materia es un cupo de electiva/optativa sin llenar, basado únicamente en `materia.sin_definir` (v1.14.1, ya no adivina por el código).
* `mostrarErroresImportacion(lista)` — Muestra u oculta el bloque de errores de importación de CSV con la lista de mensajes dada.
* `obtenerPalabraOptativa(materia)` — Devuelve "electiva" u "optativa" según lo que sugiera el nombre de la materia (puramente cosmético, nunca afecta datos).
* `parsearCSVPlanEstudios(textoCrudo, tiposHoras)` — Parsea el CSV completo de un plan según sus `tiposHoras`; devuelve `{materias, electivas, paraRevisar, errores}`.
* `parsearLineaCSV(linea)` — Parser de una línea CSV que respeta comillas dobles (para nombres con comas).
* `parsearRequisitoArbol(celdaCruda)` — Convierte el texto de una celda de Requisitos/Correquisitos en un árbol Y/O de nodos.
* `serializarRequisitoArbol(nodo)` — Convierte un árbol Y/O de requisitos de vuelta a su representación de texto (";" para Y, "/" para O).

### plan-importacion.js
Propósito: flujo de importación asistida por IA (capturas → PDF, prompt de importación, instrucciones, extracción de metadatos) y su panel en el modal de gestión de planes.
Depende de: clipboard.js, schema.js, storage-sync.js, storage.js, componentes.js, plan-esquema.js, plan-gestionar.js, plan-importacion-csv.js, plan-vista-lista.js
Exporta:

* `abrirModalCapturasPDF()` — Abre el modal de capturas de pantalla → PDF, limpiando la selección de archivos anterior.
* `abrirModalInstruccionesImportacion(modo, textoPrompt)` — Abre el modal de instrucciones previas a ir a Claude, guardando el prompt pendiente.
* `abrirVentanaNueva(url)` — Abre una URL en una pestaña nueva simulando un click en un `<a target="_blank">`.
* `cerrarModalCapturasPDF()` — Cierra el modal de capturas de pantalla → PDF.
* `cerrarModalInstruccionesImportacion()` — Cierra el modal de instrucciones y limpia el prompt pendiente.
* `construirColumnasHoras(tiposHoras)` — Arma la lista de columnas de horas para el encabezado del CSV (v1.12: usa el código de `HORAS_COLUMNAS` tal cual, sin anteponer "Horas_").
* `construirEncabezadoCSV(tiposHoras)` — Arma la línea completa de encabezado del CSV (Bloque, Código, Nombre, Créditos, columnas de horas, Requisitos, Correquisitos, SinDefinir).
* `construirInputArchivoCSV(textareaDestino)` — Construye el input de archivo para cargar un CSV directamente hacia un textarea destino.
* `construirPanelImportacion()` — Construye el panel principal de importación (elegir modo, generar prompt, pegar CSV).
* `construirPromptImportacion(modo, link)` — Arma el texto del prompt de importación universal a pegarle a la IA, según el modo (link o capturas).
* `construirTextoInstruccionesImportacion()` — Arma el texto paso a paso mostrado en el modal de instrucciones antes de ir a Claude.
* `convertirCapturasAPDF(archivos)` — Convierte una lista de imágenes capturadas en un único PDF usando jsPDF.
* `enviarPromptAClaude(texto)` — Abre claude.ai/new en pestaña nueva y copia el prompt al portapapeles.
* `extraerMetadatosImportacion(textoCrudo)` — Extrae los metadatos (carrera, universidad, código, etc.) de las líneas iniciales de un CSV crudo.
* `inicializarModalCapturasPDF()` — Registra los listeners del modal de capturas de pantalla → PDF.
* `inicializarModalInstruccionesImportacion()` — Registra los listeners del modal de instrucciones previas a la importación.
* `instruccionesImportacionPendiente` (variable exportada, no constante) — Guarda el `{textoPrompt}` pendiente mientras el modal de instrucciones está abierto; se limpia al cerrarlo.

### plan-mapa.js
Propósito: Vista de Mapa interactivo del plan (nodos por materia, colores por estado/categoría, zoom, camino de desbloqueo, exportar como imagen).
Depende de: storage.js, utils.js, plan-detalle.js, plan-vista-lista-tarjetas.js, plan-vista-lista.js
Exporta:

* `COLOR_ESTADO_MAPA` (const) — Mapa de color hexadecimal por estado de materia (pendiente/cursando/aprobado/reprobado/retirado) usado en la Vista de Mapa.
* `abrirSelectorDescargaMapa()` — Abre el selector de descarga del mapa como imagen (switches de modo claro/oscuro, tema, con/sin fondo).
* `ajustarZoomMapa(delta, etiquetaEl)` — Ajusta el nivel de zoom del mapa (clamp 0.5–2), actualiza el porcentaje mostrado en `etiquetaEl`.
* `aplicarZoomMapa()` — Aplica el `estado.zoomMapa` actual como transform sobre el track del mapa.
* `colorNodoMapa(materia, plan)` — Devuelve el color de un nodo del mapa, según se coloree por categoría o por estado (`COLOR_ESTADO_MAPA`).
* `construirMapaInteractivo(plan)` — Construye el SVG del mapa interactivo con únicamente los bloques numerados reales del plan (excluye Optativas y Revisar).
* `construirNodoMapa(materia, plan)` — Construye el nodo visual individual de una materia dentro del mapa.
* `construirTarjetaVista(plan)` — Construye la tarjeta contenedora de la Vista de Mapa (controles + SVG), guardando referencias vivas del bloque de controles.
* `dibujarCaminoDesbloqueo(plan)` — Dibuja/resalta en el SVG el camino de materias que desbloquea la materia seleccionada.
* `exportarMapaComoPNG(opciones)` — Exporta el mapa visible como imagen PNG; `opciones` controla modo claro/oscuro, tema y fondo solo durante la captura.
* `recolorearNodosMapa(plan)` — Recorre los nodos ya dibujados y actualiza su color según el estado/categoría actual de cada materia, sin re-renderizar todo.

### plan-vista-lista-tarjetas.js
Propósito: construcción de las tarjetas de materia dentro de la lista (bloques numerados y optativas), su disponibilidad según requisitos, y resolución de conflictos de sincronización a nivel de materia/entidad.
Depende de: schema.js, storage-merge.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-detalle.js, plan-esquema.js, plan-vista-lista.js
Exporta:

* `ESTADOS_MATERIA` (const) — Lista de los 4 estados posibles de una materia (pendiente/cursando/aprobado/reprobado) con su texto y clase de badge.
* `abrirMenuRapidoCategoria(materia, plan, anclaEl)` — Abre un popover flotante anclado a `anclaEl` para asignar rápido una categoría a la materia.
* `abrirModalResolverConflicto(materia, plan, onResueltoExtra)` — Caso particular de `abrirModalResolverConflictoGenerico` para una materia del plan; `onResueltoExtra` permite enganchar un refresco adicional (usado por el modal global "ver todos los choques").
* `abrirModalResolverConflictoGenerico({ entidad, plan, titulo, explicacion, onResuelto, obtenerFresca })` — Abre el overlay genérico de resolución de conflicto de sync, mostrando los campos en choque entre la versión local y `_version_alterna`.
* `resolverConflictoDirecto({ obtenerFresca, cual })` — Aplica directamente la resolución ("local" o "alterna") de un conflicto sobre la entidad viva, sin pasar por el modal; usado por "resolver todos a la vez".
* `agregarIndicadorConflicto(cardEl, onResolver)` — Agrega el indicador visual compacto de "choque de versiones" a una tarjeta (reemplaza el badge de texto anterior para no competir por espacio ni romperse en móvil).
* `construirBloqueOptativas(filasAgregadas, filasDisponibles, esEscritorio, mostrarOrigen)` — Construye el bloque especial de Optativas (agregadas + disponibles para vincular).
* `construirContenidoBloques()` — Construye el contenido completo de bloques numerados + optativas + revisar de la lista de materias.
* `construirTarjetaMateria(fila, esEscritorio, mostrarOrigen)` — Construye la tarjeta de una materia individual, resolviendo disponibilidad y estado de expansión.
* `construirTarjetaOptativaDisponible(materiaTemplate, plan)` — Construye la tarjeta de una optativa disponible para vincular (aún no agregada al plan).
* `estaExpandida(codigo, esEscritorio)` — Devuelve si una tarjeta está expandida; si no hay estado guardado, usa `esEscritorio` como default.
* `materiaDisponible(materia, materiasDelPlan)` — Evalúa si una materia está disponible (sus requisitos se cumplen) contra el árbol Y/O y el estado "aprobado" de las materias del plan.
* `obtenerMateriasQueDesbloquea(materia, plan)` — Devuelve las materias del plan cuyo árbol de requisitos o correquisitos contiene el código de `materia`.

### plan-vista-lista.js
Propósito: orquestador de la Vista de Lista del plan de estudios — encabezado, panel de estadísticas, barra de acciones, expandir/contraer, carrusel entre planes, y el render principal `renderizarPlanEstudios`.
Depende de: schema.js, storage-sync.js, storage.js, utils.js, plan-categorias.js, plan-esquema.js, plan-gestionar.js, plan-modo-edicion.js, plan-importacion-csv.js, plan-importacion.js, plan-mapa.js, plan-vista-lista-tarjetas.js
Exporta:

* `construirAnilloDonut(porcentaje, colorProgreso)` — Construye el SVG del anillo tipo donut de progreso (créditos aprobados) del panel de estadísticas.
* `construirBarraAcciones()` — Construye la barra de acciones (orden, editar materias, añadir materia, etc.) sobre la lista de materias.
* `construirEncabezadoPlan(planPrincipal)` — Construye el encabezado del plan (título, carrera, botones de editar/gestionar).
* `construirPanelEstadisticas(plan)` — Construye el panel de estadísticas (materias y créditos totales/aprobados) del plan.
* `contraerTodasLasMaterias()` — Marca todas las materias visibles como contraídas y re-renderiza.
* `contraerTodosLosBloques()` — Colapsa todos los bloques/grupos actuales y re-renderiza.
* `expandirTodasLasMaterias()` — Marca todas las materias visibles como expandidas y re-renderiza.
* `expandirTodosLosBloques()` — Vacía el set de bloques colapsados (expande todos) y re-renderiza.
* `exportarPlanACSV(planParam)` — Exporta el plan completo a CSV (metadatos + todas las materias, incluidos cupos de electiva sin llenar), en el mismo formato que espera el importador.
* `inicializarResponsivoListaPlan()` — Registra el listener de resize que detecta el cruce del breakpoint móvil/escritorio (900px) para re-renderizar la lista cuando cambia.
* `navegarPlanCarrusel(delta)` — Cambia el plan activo al siguiente/anterior (`delta` ±1) dentro del carrusel de planes.
* `obtenerClavesAgrupacionActuales()` — Devuelve el set de claves de agrupación actuales (por categoría o por bloque, según el orden activo) de las materias visibles.
* `renderizarPlanEstudios()` — Punto de entrada principal: vacía y reconstruye `#seccion-plan-estudios` completo (encabezado, estadísticas, barra de acciones, contenido de bloques).

### plan-modo-edicion.js
Propósito: botón "Editar plan", badge fijo "Modo edición" y el ícono de lápiz que aparece en cada tarjeta de materia mientras el modo está activo.
Depende de: storage.js, plan-vista-lista.js
Exporta:

* `alternarModoEdicionPlan()` — Invierte `estado.modoEdicionPlan` y refresca el badge y las tarjetas del plan.
* `renderizarBadgeModoEdicion()` — Muestra u oculta el badge fijo de la esquina inferior derecha según `estado.modoEdicionPlan`.
