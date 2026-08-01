# Arquitectura de App Académica — mapa de módulos

Este documento es para que **cualquier IA (o Wagner) que entre a una sesión nueva**
entienda, sin tener que leer los 24 archivos completos, qué hace cada uno y a qué
archivo hay que ir para pedir un cambio. Todo el proyecto usa **módulos ES nativos**
(`import`/`export`, sin build step). El único `<script>` en `index.html` es:

```html
<script type="module" src="js/main.js"></script>
```

## Cómo leer este documento

Cada archivo tiene:
- **Qué hace** — resumen de 1-2 líneas.
- **Funciones/constantes exportadas** — lo que otros archivos pueden importar de aquí.
- **Depende de** — a qué archivos les hace `import`.
- **Lo usan** — qué archivos le hacen `import` a este.

Si vas a pedirle a una IA que trabaje en algo, decile primero **en qué archivo(s)** cree
que tiene que tocar, usando la tabla de la sección "¿Dónde va cada cosa?" al final. Eso
evita que la IA adivine mal o toque 5 archivos cuando solo necesitaba tocar 1.

---

## Capas del proyecto (de más base a más arriba)

```
js/core/ → datos, sesión, sincronización — no saben nada de la UI
js/ui/ → componentes de interfaz genéricos y reutilizables
js/config/ → secciones de Configuración (ajustes, enlaces, baneados)
js/plan/ → todo el Plan de Estudios (la sección más grande de la app)
js/semestres/ → Semestres y matrícula (Fase 1 de "Semestres y Notas")
js/main.js → arranque: login, navegación, conecta todo lo demás
```

`js/plan/*` sigue siendo, con diferencia, la carpeta más grande — es el módulo de
negocio principal de la app. `js/core/*` es la única capa que **no depende de nada
más** (salvo `storage.js` ↔ `storage-sync.js`, que se necesitan mutuamente a
propósito, ver más abajo). Todo lo demás depende, directa o indirectamente, de
`core/`. `js/semestres/` depende de `core/` y reutiliza piezas de `js/plan/`
(`plan-detalle.js`, `plan-vista-lista-tarjetas.js`) en vez de duplicarlas — ver esa
sección para el detalle exacto de qué toma prestado.

> **Nota sobre imports circulares:** vas a ver algunos módulos que se importan entre
> sí en ambas direcciones (ej. `storage.js` ↔ `storage-sync.js`, `plan-esquema.js` ↔
> `plan-gestionar.js`, `plan-detalle.js` ↔ `plan-vista-lista-tarjetas.js`). Esto es
> **intencional y seguro** en módulos ES mientras el nombre importado solo se use
> *dentro* de una función (nunca en el nivel superior del archivo, fuera de una
> función) — que es como está armado todo aquí. Si una IA nueva ve esto y quiere
> "arreglarlo" separando más archivos, no hace falta: ya funciona.

---

## `js/core/` — base de datos y sesión

### `core/schema.js`
**Qué hace:** el molde de datos completo del usuario — la única fuente de verdad de
qué forma tiene el JSON que se guarda en Google Drive. No renderiza nada, no toca el
DOM.
**Exporta:**
- `crearDatosUsuarioNuevo()` — objeto "de fábrica" para un usuario que recién entra.
- `crearPlanEstudio()`, `crearCategoria()`, `crearMateria()`, `crearEnlaceRapido()` — fábricas de cada entidad.
- `crearSemestre()`, `crearMateriaMatriculada()` — fábricas de Semestre y Materia-matriculada (Fase 1, ver `js/semestres/`).
- `sellarTimestamp()` — reloj lógico de Lamport (`_actualizadoEn` por dispositivo) + `_version_base`, punto único por el que debe pasar CUALQUIER entidad al crearse o editarse. No inventes un sellado propio en otro archivo — siempre este.
- `obtenerPlanesActivos(configuracion)` — ids de los planes "activos" ahora mismo según Modo Hardcore (hasta 3).
- `obtenerEstadoEfectivoSemestre(semestre)` — "actual"/"pasado" calculado por fecha + `LIMITE_SEMANAS_SEMESTRE`, respetando `estado_manual` si el usuario lo forzó.
- `migrarDatosAntiguos(datos)` — migración silenciosa de versiones viejas del esquema (rellena `optativas_disponibles`, normaliza `horas`, rellena `plan_activo_terciario_id`).
- `PALETAS_DISPONIBLES`, `PARAMETROS_UNIVERSIDAD_DEFAULT`, `PRESETS_TIPOS_HORAS`, `LIMITE_ENLACES_RAPIDOS`, `LIMITE_SEMANAS_SEMESTRE`, `MAPEO_HORAS_VIEJO_A_NUEVO` — constantes de referencia.
**Depende de:** nada.
**Lo usan:** casi todos los módulos de `config/`, `plan/` y `semestres/`, más `storage-sync.js`, `storage-merge.js` y `main.js`.
**Si vas a agregar una llave nueva al modelo de datos (JSON de Drive), es acá.**

### `core/auth.js`
**Qué hace:** login con Google (OAuth vía Google Identity Services) + todas las
llamadas crudas a la API de Google Drive (leer/crear/guardar el archivo único de
datos, refrescar el token).
**Exporta:** `inicializarGoogleAuth()`, `iniciarSesionConGoogle()`, `cerrarSesionGoogle()`, `obtenerPerfilGoogle()`, `refrescarAccessTokenGoogle()`, `buscarOCrearArchivoDatos()`, `leerDatos()`, `guardarDatos()`, `obtenerMetadatosArchivo()`.
**Depende de:** nada (solo `window.google` y `fetch`).
**Lo usan:** `main.js` (login) y `storage-sync.js` (leer/guardar/refrescar durante la sincronización).
**Si el problema es "no inicia sesión" o "Drive da 401/403", es acá o en `storage-sync.js`.**

### `core/storage.js`
**Qué hace:** el objeto `estado` (todo el estado en memoria de la sesión del
navegador — token, datos del usuario, filtros activos, qué materias/semestres están
expandidos, etc.) + caché offline en `localStorage` + guardar/leer/borrar el token de
Google en caché.
**Exporta:** `estado`, `authListo`/`resolverAuthListo` (promesa que resuelve cuando ya
se sabe si hay sesión), `guardarCacheLocal()`, `leerCacheLocal()`, `correoConocido()`, `establecerTokenActivo()`, `guardarTokenCache()`, `leerTokenCacheValido()`, `borrarTokenCache()`.
**Depende de:** `storage-sync.js` (solo para el refresco proactivo de token dentro de `establecerTokenActivo`).
**Lo usan:** literalmente casi todos los módulos de `plan/`, `config/` y `semestres/`, porque casi todo lee o escribe `estado`.
**Si necesitás una llave nueva de `estado` (memoria de sesión, NO el JSON de Drive), es acá.**

### `core/storage-sync.js`
**Qué hace:** el motor de sincronización con Drive — reconexión silenciosa, refresco
proactivo del token antes de que expire, reintento automático tras un 401, sondeo
periódico multi-dispositivo, pull-to-refresh, y aplicar datos remotos frescos sobre la
UI.
**Exporta:** `intentarSincronizar()`, `sincronizarAhora()`, `forzarSincronizacion()`, `conReintentoSi401()`, `sondearCambiosRemotos()`, `aplicarDatosRemotosFrescos()`, `marcarCambioPendiente()`, `marcarUltimaSincronizacionConfirmada()`, `actualizarIndicadorSync()`, `mostrarCargando()/ocultarCargando()`, `inicializarPullToRefresh()`, `intentarReconexionSilenciosa()`, `programarRefrescoProactivo()`, `mostrarAvisoReconexion()/ocultarAvisoReconexion()`.
**Depende de:** `auth.js`, `schema.js`, `storage.js`, `storage-merge.js` (para fundir datos remotos con locales), y (para refrescar la UI tras sincronizar) `config-ajustes.js`, `config-enlaces.js`, `plan-gestionar.js`, `plan-vista-lista.js`, `semestres.js`, `ui/tema.js`, `ui/componentes.js`, `main.js`.
**Si el bug es "no sincroniza", "se pierden cambios", o "el spinner de carga no
aparece/no desaparece", es acá.**

### `core/storage-merge.js`
**Qué hace:** el motor de **fusión** (merge) entre los datos locales y los que llegan
de Drive — decide, entidad por entidad, cuál versión gana usando el reloj lógico de
Lamport + `_version_base` (ver `sellarTimestamp`, `schema.js`), y detecta **conflicto
real** (`hayConflictoReal`) cuando dos dispositivos editaron la misma entidad de
formas distintas a partir de la misma base, marcándola con `_conflicto: true` en vez
de perder silenciosamente una de las dos ediciones.
**Exporta:** `fusionarDatos()` (punto de entrada, arma el objeto completo fusionado), `fusionarColeccion()` (colecciones planas: agenda, profesores, enlaces, categorías/materias dentro de un plan), `fusionarPlanesEstudio()`/`fusionarPlan()` (fusión anidada de un Plan: materias + categorías, cada una con su propia tumba), `fusionarSemestres()`/`fusionarSemestre()` (fusión anidada de un Semestre: `materias_matriculadas` con su propia tumba `_eliminados_materias_matriculadas` — mismo patrón que `fusionarPlan`), `fusionarTumbas()`, `hayConflictoReal()`, `marcarConflictoSiCorresponde()`, `esMasReciente()`.
**Depende de:** `schema.js` (`sellarTimestamp` y las constantes de reloj lógico).
**Lo usan:** `storage-sync.js` (único punto que llama a `fusionarDatos()`, al aplicar
datos remotos).
**Si el bug es "se resucitó algo que borré", "perdí una edición al sincronizar desde
otro dispositivo", o "el badge de conflicto no aparece/no se resuelve", es acá. Si
agregás una entidad nueva con su propia colección anidada borrable, tiene que pasar
por este mismo patrón (tumba propia + fusión anidada) — no inventes uno aparte.**

### `core/utils.js`
**Qué hace:** helpers genéricos sin estado propio — no dependen de `estado`, no tocan
el DOM (salvo `convertirArchivoABase64`).
**Exporta:**
- `aplicarFormatoTexto()`, `esTokenNumeroRomano()`, `transformarPalabraFormato()` — formato Título/MAYÚSCULAS/oración, respetando números romanos.
- `formatearHoras()`, `formatearHorasCompactoIniciales()` — texto de horas de una materia.
- `hexARgba()`, `estiloBadgeCategoria()` — color de categorías.
- `normalizarSeparadoresRequisitos()`, `parsearGrupoRequisitos()`, `serializarGrupoRequisitos()` — texto ↔ arreglo de grupos de requisitos (`;` = Y, `/` = O).
- `obtenerIniciales()`, `convertirArchivoABase64()`.
**Depende de:** `storage.js` (algunas funciones leen `estado.datos.configuracion` para saber el formato activo).
**Lo usan:** casi todos los módulos de `plan/`, `config/` y `semestres/`.
**Si vas a registrar `compararNombresMateria()` (pendiente, C.1 del prompt v9) o cualquier otro helper reutilizable nuevo, es acá.**

---

## `js/ui/` — componentes de interfaz genéricos

### `ui/componentes.js`
**Qué hace:** piezas de UI reutilizables que no son específicas del Plan de Estudios
ni de Configuración: modal de confirmación genérico, toasts, long-press, flechas de
scroll horizontal (`‹ ›`), y el layout responsivo del sidebar/drawer móvil.
**Exporta:** `abrirConfirmacion()`, `cerrarConfirmacion()`, `inicializarModalConfirmacion()`, `mostrarToast()`, `agregarLongPress()`, `envolverConFlechasScroll()`, `inicializarLayoutResponsivo()`, `cerrarSidebarMovil()`, `restaurarEstadoSidebar()`, `inicializarBotonesCerrarModal()`.
**Depende de:** `main.js` (solo `renderizarPerfil`, para reaccionar a cambios de layout).
**Lo usan:** casi todos los módulos de `plan/` y `semestres/`, más `storage-sync.js` y `main.js`.
**Si el bug es "el drawer no ancla en móvil", "las flechas ‹ › no llegan al final", o
"el modal de confirmación se ve raro", es acá.**

### `ui/tema.js`
**Qué hace:** aplicar paleta + modo claro/oscuro, y los datos de preview de cada
paleta (usados en el selector de Ajustes).
**Exporta:** `aplicarPaleta()`, `aplicarTemaGuardadoLocalmente()`, `COLORES_PREVIEW_PALETA`, `FONDO_PREVIEW_AZUCARADO`, `TEXTO_PREVIEW_PALETA`.
**Depende de:** nada.
**Lo usan:** `config-ajustes.js`, `storage-sync.js`, `main.js`.

---

## `js/config/` — sección Configuración

### `config/config-ajustes.js`
**Qué hace:** el panel de Ajustes generales — paleta, modo, escala de notas, formato
de texto.
**Exporta:** `renderizarAjustes()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `tema.js`, `plan-vista-lista.js` (para re-renderizar el plan si cambia el formato de texto/escala).

### `config/config-enlaces.js`
**Qué hace:** Enlaces Rápidos — CRUD completo (crear, editar, borrar, subir icono).
**Exporta:** `renderizarEnlacesRapidos()`, `renderizarListaEnlacesEn()`, `abrirModalEnlace()`, `cerrarModalEnlace()`, `eliminarEnlaceDesdeModal()`, `guardarEnlaceDesdeModal()`, `mostrarErrorModalEnlace()`, `inicializarModalEnlace()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `utils.js`.

### `config/config-baneados.js`
**Qué hace:** nada todavía — **reservado a propósito**, vacío, para cuando se
construya esa sección. No lo llenes de código de otra cosa por error.

---

## `js/plan/` — Plan de Estudios (la sección más grande)

### `plan/plan-esquema.js`
**Qué hace:** crear/gestionar la *estructura* de un Plan de Estudios (universidad,
`tipos_horas`), añadir materias manualmente, y los **getters básicos** de acceso a
planes/materias que casi todo el resto de `plan/` usa.
**Exporta:**
- `abrirModalCrearPlan()`, `aplicarDefaultsUniversidad()`, `leerTiposHorasDelModalCrearPlan()`, `inicializarModalCrearPlan()`, `aplicarPlaceholdersAleatoriosPlan()`, `mapearUniversidadDetectada()`, `elegirPlaceholderPlan()`, `EJEMPLOS_PLACEHOLDER_PLAN`, `LIMITE_PLANES_ESTUDIO`.
- `abrirModalMateriaManual()`, `actualizarFormatoHorasMateriaManual()`, `inicializarModalMateriaManual()`.
- **Getters usados por todo `plan/`:** `obtenerPlanActivo()`, `obtenerPlanSecundario()`, `obtenerMateriasVisibles()`, `obtenerOptativasDisponibles()`, `buscarMateriaPorCodigoEnPlanes()`, `filasFiltradas()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `utils.js`, `plan-gestionar.js`, `plan-importacion-csv.js`, `plan-vista-lista.js`.
**Si necesitás leer "cuál es el plan activo" o "qué materias están visibles ahora
mismo" desde un archivo nuevo, importalo de acá.**
**Deuda conocida:** con Modo Hardcore ahora a 3 planes (ver `plan-gestionar.js`),
falta un `obtenerPlanTerciario()` equivalente a `obtenerPlanSecundario()` si algún
módulo llega a necesitarlo suelto — hoy `js/semestres/` no lo necesita porque usa
`obtenerPlanesActivos()` de `schema.js` directamente.

### `plan/plan-importacion.js`
**Qué hace:** construir el **prompt oficial** que se copia a la IA, y el panel de
importación (elegir Universidad, modo Link/PDF/Capturas, el textarea de CSV).
**Exporta:** `construirPromptImportacion()`, `construirPanelImportacion()`, `construirTextoInstruccionesImportacion()`, `construirInputArchivoCSV()`, `construirColumnasHoras()`, `construirEncabezadoCSV()`, `extraerMetadatosImportacion()`, `copiarPromptImportacion()`, `abrirVentanaNueva()`, `enviarPromptAClaude()/enviarPromptAChatGPT()`, `abrirModalInstruccionesImportacion()/cerrarModalInstruccionesImportacion()/inicializarModalInstruccionesImportacion()`, `NOMBRE_IA`, `instruccionesImportacionPendiente`.
**Depende de:** `schema.js`, `storage.js`, `componentes.js`, `plan-importacion-csv.js`, `plan-vista-lista.js`.
**Si el texto del prompt que se copia a la IA está desactualizado respecto a alguna
regla nueva (CSV, comillas, columnas), es acá — `construirPromptImportacion()`.**

### `plan/plan-importacion-csv.js`
**Qué hace:** el parser de CSV en sí (tolerante a comillas y comas en cualquier
columna) + aplicar el resultado sobre un plan (crear nuevo, o Agregar/Reemplazar
sobre uno existente) + el mini-panel de reimportación desde Gestionar Planes.
**Exporta:** `parsearLineaCSV()`, `parsearCSVPlanEstudios()`, `manejarClickImportar()`, `importarCSVEnPlan()`, `mostrarErroresImportacion()`, `construirMiniPanelImportacion()`, `actualizarEstadoBotonesEnvioImportacion()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `componentes.js`, `utils.js`, `plan-esquema.js`, `plan-importacion.js`, `plan-vista-lista.js`.
**Si el bug es "no detecta bien los requisitos múltiples" o "una coma en el nombre de
la materia rompe el CSV", es acá.**

### `plan/plan-vista-lista.js`
**Qué hace:** el **orquestador** de la vista de lista del Plan de Estudios —
`renderizarPlanEstudios()` es la función que arma toda la sección de punta a punta
(encabezado, estadísticas, barra de acciones, bloques). También el carrusel
Principal/Secundario (Modo Hardcore) y la exportación a CSV.
**Exporta:** `renderizarPlanEstudios()`, `construirEncabezadoPlan()`, `navegarPlanCarrusel()`, `construirBarraAcciones()`, `obtenerClavesAgrupacionActuales()`, `contraerTodosLosBloques()/expandirTodosLosBloques()`, `contraerTodasLasMaterias()/expandirTodasLasMaterias()`, `exportarPlanACSV()`, `construirAnilloDonut()`, `construirPanelEstadisticas()`, `inicializarResponsivoListaPlan()`.
**Depende de:** prácticamente todos los demás módulos de `plan/` (es el que los
conecta a todos para armar la sección completa), más `storage.js`, `storage-sync.js`, `utils.js`.
**Si el pedido es "la sección del Plan de Estudios no renderiza algo" o "el orden de
las tarjetas de arriba está mal", empezá por acá.**

### `plan/plan-vista-lista-tarjetas.js`
**Qué hace:** el candado de disponibilidad (qué materia está bloqueada por
requisitos), los bloques colapsables, el bloque especial "Optativas", y la tarjeta de
materia en sí (colapsada/expandida).
**Exporta:** `materiaDisponible()`, `obtenerMateriasQueDesbloquea()`, `construirContenidoBloques()`, `construirBloqueOptativas()`, `construirTarjetaOptativaDisponible()`, `agregarOptativaAlPlan()`, `construirTarjetaMateria()`, `abrirMenuRapidoCategoria()`, `estaExpandida()`, `ESTADOS_MATERIA`.
**Depende de:** `storage.js`, `storage-sync.js`, `utils.js`, `componentes.js`,
`plan-esquema.js`, `plan-vista-lista.js`, y **`plan-detalle.js`** (para el encabezado
de 2 líneas y el cuerpo de detalle, que la tarjeta reutiliza tal cual del modal).
**Lo usan** además `plan-detalle.js` (importa `ESTADOS_MATERIA`, `materiaDisponible`, etc.) y **`js/semestres/semestres-tarjetas.js`** (importa `ESTADOS_MATERIA` para el badge de Estado de cada materia matriculada — misma fuente de verdad, no una copia).
**Si el pedido es sobre el diseño de la tarjeta (colapsada o expandida) o sobre el
bloque de Optativas, es acá.**

### `plan/plan-detalle.js`
**Qué hace:** el **"detalle unificado" de una materia** — el mismo diseño se usa
tanto dentro de la tarjeta expandida del Plan como en el modal de requisito, **y
ahora también dentro de la tarjeta de materia matriculada de un semestre** (ver
`js/semestres/semestres-tarjetas.js`).
**Exporta:**
- Piezas compartidas: `construirLinea2Materia()` (Estado·Horas·Créditos), `construirMetaLineaMateria()` (Bloque·Código), `construirLineaCategoriaMateria()`, `construirBotonesFinalesDetalle()` ("Es requisito"/"Historial"/"Cerrar" agrupados), `construirFilaRequisito()`, `construirBloqueRequisitos()`, `construirBloqueCompletoRequisitos()`, `construirCuerpoDetalleMateria()` (junta todo lo anterior).
- Modales: `abrirModalRequisito()`, `abrirModalDesbloquea()`, `abrirModalHistorial()`, `inicializarModalDesbloquea()/inicializarModalRequisito()/inicializarModalHistorial()`.
**Depende de:** `storage.js`, `utils.js`, `componentes.js`, `plan-esquema.js`, `plan-vista-lista-tarjetas.js` (para el candado/getters de materia).
**Lo usan** además de la tarjeta/modal del Plan: **`js/semestres/semestres-tarjetas.js`** (importa `construirLineaCategoriaMateria()` y `construirBotonesFinalesDetalle()` para la fila "Categoría / Es requisito de… / Historial" dentro de un semestre expandido).
**Si el pedido es sobre el diseño del encabezado de 2 líneas, la ventana de detalle,
"Es requisito"/Historial, o el orden de los botones finales, es acá — y como se
comparte en 3 lugares (tarjeta del Plan, modal, tarjeta de matrícula), un cambio acá
se ve en los tres a la vez.**
**Pendiente (Fase 6):** `abrirModalHistorial()` hoy avisa que el módulo de Semestres
"todavía no existe" — ya existe (`js/semestres/`), pero mostrar ahí el historial real
de en qué semestres se cursó una materia sigue pendiente porque tiene más sentido una
vez que haya notas que mostrar junto a cada intento. Ver el prompt de Fase 6.

### `plan/plan-categorias.js`
**Qué hace:** CRUD de categorías + el modal de asignación masiva de materias a una
categoría.
**Exporta:** `construirPanelCategorias()`, `abrirModalCategoria()`, `inicializarModalCategoria()`, `abrirModalCategoriaMaterias()`, `renderizarControlesCategoriaMaterias()`, `renderizarListaMateriasCheckbox()`, `inicializarModalCategoriaMaterias()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `utils.js`, `componentes.js`, `plan-esquema.js`, `plan-vista-lista.js`.

### `plan/plan-gestionar.js`
**Qué hace:** selector de plan activo (arriba de todo), Modo Hardcore (**hasta 3
carreras simultáneas** — principal + secundaria + terciaria, ver `obtenerPlanesActivos`
en `schema.js`), y el modal "Gestionar Planes" (reordenar, eliminar, favorito).
**Exporta:** `renderizarSelectorPlan()`, `renderizarModoHardcore()`, `abrirModalGestionPlanes()`, `renderizarListaGestionPlanes()`, `eliminarPlanEstudio()`, `inicializarModalGestionPlanes()`.
**Depende de:** `storage.js`, `storage-sync.js`, `utils.js`, `componentes.js`, `plan-esquema.js`, `plan-vista-lista.js`.

### `plan/plan-mapa.js`
**Qué hace:** la Vista de Mapa interactivo completa — tarjeta "Vista" (switch
Lista/Mapa), columnas por bloque + columna de Optativas, coloreo por
Simbología/Categoría, zoom (pellizco / `Ctrl`+rueda / botones), el camino de
desbloqueo con efecto neón, y exportar el mapa como PNG (2 opciones: tema actual /
claro transparente, vía `html2canvas`).
**Exporta:** `construirTarjetaVista()`, `construirMapaInteractivo()`, `construirNodoMapa()`, `colorNodoMapa()`, `recolorearNodosMapa()`, `dibujarCaminoDesbloqueo()`, `aplicarZoomMapa()`, `ajustarZoomMapa()`, `abrirSelectorDescargaMapa()`, `exportarMapaComoPNG()`, `COLOR_ESTADO_MAPA`.
**Depende de:** `storage.js`, `utils.js`, `plan-detalle.js` (para abrir el detalle al
mantener presionada una materia), `plan-vista-lista-tarjetas.js` (candado/getters), `plan-vista-lista.js`.
**Simplificación conocida y pendiente de confirmar con Wagner:** hoy el mapa muestra
solo el plan **principal** (no combina Modo Hardcore, que ahora además soporta hasta
3 planes — la brecha creció, no se achicó), y la Simbología usa 4 estados reales (no
existe un 5º estado "Retirada" en `ESTADOS_MATERIA`).

---

## `js/semestres/` — Semestres y matrícula (Fase 1 de "Semestres y Notas")

### `semestres/semestres.js`
**Qué hace:** el formulario de alta de semestre (nombre, fecha, duración, selector de
plan(es) si Hardcore está activo, checklist de materias por bloque), la **sincronía
Matrícula → Plan** (matricular pasa la materia real a "Cursando"), y el listado de
semestres (actuales + pasados).
**Exporta:** `abrirModalAltaSemestre()`, `obtenerSemestresActuales()`, `obtenerSemestresPasados()`, `renderizarSemestres()`.
**Depende de:** `schema.js` (`crearSemestre`, `crearMateriaMatriculada`, `obtenerPlanesActivos`, `obtenerEstadoEfectivoSemestre`, `LIMITE_SEMANAS_SEMESTRE`, `sellarTimestamp`), `storage.js`, `storage-sync.js`, `utils.js`, `semestres-tarjetas.js` (`construirTarjetaSemestre`).
**Si el pedido es sobre el formulario de alta, "puedo matricular de más de un plan a
la vez", o "matricular no pasó la materia a Cursando en el Plan", es acá.**
**Pendiente (Fase 6):** el botón "Terminar semestre" (mover a historial + revisión
pasó/no-pasó por materia, sugerida según nota) no existe todavía — hoy un semestre
solo pasa a "pasado" automáticamente al llegar a `LIMITE_SEMANAS_SEMESTRE` desde su
`fecha_inicio`, o si el usuario lo fuerza a mano (ver `semestres-tarjetas.js`). Ver el
prompt de Fase 6.

### `semestres/semestres-tarjetas.js`
**Qué hace:** la tarjeta de semestre (colapsada: nombre—fecha—créditos; expandida:
sus materias matriculadas en el orden del Plan de origen de cada una), el badge de
estado actual/pasado con override manual (mantener presionado), y la tarjeta de cada
materia matriculada (badge de universidad + código + nombre, badge Estado + badge
universidad + badge créditos, Categoría/Es requisito de/Historial reutilizados de
`plan-detalle.js`, y el placeholder vacío para el cuadro de notas de la Fase 6).
**Exporta:** `construirTarjetaSemestre()`.
**Depende de:** `schema.js` (`obtenerEstadoEfectivoSemestre`, `sellarTimestamp`), `storage.js`, `storage-sync.js`, `utils.js`, `componentes.js` (`agregarLongPress`, `mostrarToast`), `plan-vista-lista-tarjetas.js` (`ESTADOS_MATERIA`), `plan-detalle.js` (`construirLineaCategoriaMateria`, `construirBotonesFinalesDetalle`).
**Si el pedido es sobre el diseño de la tarjeta de semestre o de materia matriculada,
o sobre "el estado actual/pasado se detectó mal y necesito forzarlo a mano", es acá.**
**Pendiente (Fase 6):** el badge de conflicto de una materia matriculada hoy solo
muestra un aviso genérico (`mostrarToast`) en vez de un resolver real, porque la
entidad todavía no tiene campos mutables interesantes que comparar (ver
`crearMateriaMatriculada`, `schema.js`). Una vez que tenga `criterios`/`nota_final`,
esto necesita su propio modal, con el mismo patrón que `abrirModalResolverConflicto`
en `plan-vista-lista-tarjetas.js`. Ver el prompt de Fase 6.

---

## `js/main.js` — arranque

**Qué hace:** todo lo que pasa una sola vez al cargar la página — decide si hay
sesión guardada o hay que mostrar el botón de login, pinta el perfil de Google,
maneja la navegación entre secciones del sidebar (ahora incluye "semestres"), y llama
a **todas** las funciones `inicializarX()` de los demás módulos (son las que enganchan
los listeners de cada modal la primera vez).
**Exporta:** `onLoginExitoso()`, `mostrarApp()`, `cerrarSesion()`, `pedirConfirmacionCerrarSesion()`, `mostrarSeccion()`, `inicializarNavegacionSecciones()`, `renderizarPerfil()`, `togglePerfilPopover()`, `CLAVE_SECCION_ACTIVA`.
**Depende de:** de casi todo — es el único archivo que puede darse ese lujo, porque
nada más depende de él salvo `storage-sync.js` (necesita `renderizarPerfil` tras
sincronizar) y `componentes.js` (necesita saber si el layout cambió).
**Tiene 2 `window.addEventListener("DOMContentLoaded", …)` separados** (no fusionados
a propósito, para no arriesgar el orden del login durante la migración): el primero
es login/sync/tema/perfil; el segundo llama a los `inicializarX()` del Plan de
Estudios.

---

## ¿Dónde va cada cosa? (cheat-sheet para pedidos futuros)

| Si te piden... | Empezá por... |
|---|---|
| Cambiar una llave del JSON que se guarda en Drive | `core/schema.js` |
| Un bug de login / sesión que no inicia | `core/auth.js`, `main.js` |
| "No sincroniza" / "se pierden cambios" / spinner de carga | `core/storage-sync.js` |
| "Se resucitó algo que borré" / conflicto entre 2 dispositivos | `core/storage-merge.js` |
| Agregar una llave nueva a `estado` (memoria de sesión) | `core/storage.js` |
| Un helper genérico de texto/color/fecha reutilizable | `core/utils.js` |
| Modal de confirmación, toast, drawer móvil, flechas `‹ ›` | `ui/componentes.js` |
| Paletas / modo claro-oscuro | `ui/tema.js` |
| Panel de Ajustes generales | `config/config-ajustes.js` |
| Enlaces Rápidos | `config/config-enlaces.js` |
| El prompt que se copia a la IA para importar | `plan/plan-importacion.js` |
| El parser de CSV / bugs de importación | `plan/plan-importacion-csv.js` |
| Crear plan, universidad "Otra", añadir materia manual | `plan/plan-esquema.js` |
| Orden de las tarjetas de arriba, estadísticas, barra de acciones | `plan/plan-vista-lista.js` |
| Diseño de la tarjeta de materia, bloque de Optativas | `plan/plan-vista-lista-tarjetas.js` |
| Encabezado de 2 líneas, modal de detalle, "Es requisito"/Historial | `plan/plan-detalle.js` |
| Categorías (CRUD) | `plan/plan-categorias.js` |
| Selector de plan, Modo Hardcore (3 planes), Gestionar Planes | `plan/plan-gestionar.js` |
| Vista de Mapa interactivo | `plan/plan-mapa.js` |
| Alta de semestre, matricular materias, sincronía con el Plan | `semestres/semestres.js` |
| Tarjeta de semestre/materia matriculada, estado actual/pasado manual | `semestres/semestres-tarjetas.js` |
| Navegación del sidebar, qué sección se muestra al entrar | `main.js` |

**Regla general para una IA nueva:** antes de tocar código, hacé `grep` del nombre de
la función que creés que hay que cambiar sobre toda la carpeta `js/` — el nombre de
archivo real siempre está en el `export {}` al final de cada archivo, así que un
`grep -rn "nombreDeLaFuncion" js/` te confirma en 1 paso si la sospecha de esta tabla
es correcta antes de editar.

---

## Deuda pendiente conocida (para no perderla de vista)

- **Fase 6 — motor de notas:** ver `PROMPT-FASE-6-NOTAS.md`. Cubre `criterios`/`nota_final` en Materia-matriculada, el botón "Terminar semestre", el resolver de conflicto real de matrícula, y el historial real por materia.
- **`plan-mapa.js` no combina Modo Hardcore** (solo muestra el plan principal) — ya existía antes de esta fase, y con Hardcore ahora a 3 planes la brecha es más notoria. No bloqueante, pendiente de confirmar prioridad con Wagner.
- **`plan/plan-esquema.js` no tiene `obtenerPlanTerciario()`** — no hizo falta para Semestres (usa `obtenerPlanesActivos()` de `schema.js`), pero si otro módulo necesita el plan terciario suelto, falta ese getter.