# Arquitectura de App Académica — mapa de módulos

Este documento es para que **cualquier IA (o Wagner) que entre a una sesión nueva**
entienda, sin tener que leer los 22 archivos completos, qué hace cada uno y a qué
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
js/core/        →  datos, sesión, sincronización — no saben nada de la UI
js/ui/          →  componentes de interfaz genéricos y reutilizables
js/config/      →  secciones de Configuración (ajustes, enlaces, baneados)
js/plan/        →  todo el Plan de Estudios (la sección más grande de la app)
js/main.js      →  arranque: login, navegación, conecta todo lo demás
```

`js/plan/*` es, con diferencia, la carpeta más grande — es el módulo de negocio
principal de la app hoy. `js/core/*` es la única capa que **no depende de nada más**
(salvo `storage.js` ↔ `storage-sync.js`, que se necesitan mutuamente a propósito, ver
más abajo). Todo lo demás depende, directa o indirectamente, de `core/`.

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
- `migrarDatosAntiguos(datos)` — migración silenciosa de versiones viejas del esquema (hoy: rellena `optativas_disponibles`, normaliza `horas`).
- `PALETAS_DISPONIBLES`, `PARAMETROS_UNIVERSIDAD_DEFAULT`, `PRESETS_TIPOS_HORAS`, `LIMITE_ENLACES_RAPIDOS`, `MAPEO_HORAS_VIEJO_A_NUEVO` — constantes de referencia.
**Depende de:** nada.
**Lo usan:** casi todos los módulos de `config/` y `plan/`, más `storage-sync.js` y `main.js`.
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
navegador — token, datos del usuario, filtros activos, etc.) + caché offline en
`localStorage` + guardar/leer/borrar el token de Google en caché.
**Exporta:** `estado`, `authListo`/`resolverAuthListo` (promesa que resuelve cuando ya
se sabe si hay sesión), `guardarCacheLocal()`, `leerCacheLocal()`, `correoConocido()`, `establecerTokenActivo()`, `guardarTokenCache()`, `leerTokenCacheValido()`, `borrarTokenCache()`.
**Depende de:** `storage-sync.js` (solo para el refresco proactivo de token dentro de `establecerTokenActivo`).
**Lo usan:** literalmente casi todos los módulos de `plan/` y `config/`, porque casi
todo lee o escribe `estado`.
**Si necesitás una llave nueva de `estado` (memoria de sesión, NO el JSON de Drive), es acá.**

### `core/storage-sync.js`
**Qué hace:** el motor de sincronización con Drive — reconexión silenciosa, refresco
proactivo del token antes de que expire, reintento automático tras un 401, sondeo
periódico multi-dispositivo, pull-to-refresh, y aplicar datos remotos frescos sobre la
UI.
**Exporta:** `intentarSincronizar()`, `sincronizarAhora()`, `forzarSincronizacion()`, `conReintentoSi401()`, `sondearCambiosRemotos()`, `aplicarDatosRemotosFrescos()`, `marcarCambioPendiente()`, `marcarUltimaSincronizacionConfirmada()`, `actualizarIndicadorSync()`, `mostrarCargando()/ocultarCargando()`, `inicializarPullToRefresh()`, `intentarReconexionSilenciosa()`, `programarRefrescoProactivo()`, `mostrarAvisoReconexion()/ocultarAvisoReconexion()`.
**Depende de:** `auth.js`, `schema.js`, `storage.js`, y (para refrescar la UI tras
sincronizar) `config-ajustes.js`, `config-enlaces.js`, `plan-gestionar.js`,
`plan-vista-lista.js`, `ui/tema.js`, `ui/componentes.js`, `main.js`.
**Si el bug es "no sincroniza", "se pierden cambios", o "el spinner de carga no
aparece/no desaparece", es acá.**

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
**Lo usan:** casi todos los módulos de `plan/` y `config/`.
**Si vas a registrar `compararNombresMateria()` (pendiente, C.1 del prompt v9) o cualquier otro helper reutilizable nuevo, es acá.**

---

## `js/ui/` — componentes de interfaz genéricos

### `ui/componentes.js`
**Qué hace:** piezas de UI reutilizables que no son específicas del Plan de Estudios
ni de Configuración: modal de confirmación genérico, toasts, long-press, flechas de
scroll horizontal (`‹ ›`), y el layout responsivo del sidebar/drawer móvil.
**Exporta:** `abrirConfirmacion()`, `cerrarConfirmacion()`, `inicializarModalConfirmacion()`, `mostrarToast()`, `agregarLongPress()`, `envolverConFlechasScroll()`, `inicializarLayoutResponsivo()`, `cerrarSidebarMovil()`, `restaurarEstadoSidebar()`, `inicializarBotonesCerrarModal()`.
**Depende de:** `main.js` (solo `renderizarPerfil`, para reaccionar a cambios de layout).
**Lo usan:** casi todos los módulos de `plan/`, más `storage-sync.js` y `main.js`.
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
**Si el pedido es sobre el diseño de la tarjeta (colapsada o expandida) o sobre el
bloque de Optativas, es acá.**

### `plan/plan-detalle.js`
**Qué hace:** el **"detalle unificado" de una materia** — el mismo diseño se usa
tanto dentro de la tarjeta expandida como en el modal de requisito. Es el módulo con
más peso visual del rediseño de v8/v9.
**Exporta:**
- Piezas compartidas por tarjeta y modal: `construirLinea2Materia()` (Estado·Horas·Créditos), `construirMetaLineaMateria()` (Bloque·Código), `construirLineaCategoriaMateria()`, `construirBotonesFinalesDetalle()` ("Es requisito"/"Historial"/"Cerrar" agrupados), `construirFilaRequisito()`, `construirBloqueRequisitos()`, `construirBloqueCompletoRequisitos()`, `construirCuerpoDetalleMateria()` (junta todo lo anterior).
- Modales: `abrirModalRequisito()`, `abrirModalDesbloquea()`, `abrirModalHistorial()`, `inicializarModalDesbloquea()/inicializarModalRequisito()/inicializarModalHistorial()`.
**Depende de:** `storage.js`, `utils.js`, `componentes.js`, `plan-esquema.js`, `plan-vista-lista-tarjetas.js` (para el candado/getters de materia).
**Si el pedido es sobre el diseño del encabezado de 2 líneas, la ventana de detalle,
"Es requisito"/Historial, o el orden de los botones finales, es acá — y como la
tarjeta y el modal comparten estas funciones, un cambio acá se ve en los dos lugares
a la vez.**

### `plan/plan-categorias.js`
**Qué hace:** CRUD de categorías + el modal de asignación masiva de materias a una
categoría.
**Exporta:** `construirPanelCategorias()`, `abrirModalCategoria()`, `inicializarModalCategoria()`, `abrirModalCategoriaMaterias()`, `renderizarControlesCategoriaMaterias()`, `renderizarListaMateriasCheckbox()`, `inicializarModalCategoriaMaterias()`.
**Depende de:** `schema.js`, `storage.js`, `storage-sync.js`, `utils.js`, `componentes.js`, `plan-esquema.js`, `plan-vista-lista.js`.

### `plan/plan-gestionar.js`
**Qué hace:** selector de plan activo (arriba de todo), Modo Hardcore (doble
carrera), y el modal "Gestionar Planes" (reordenar, eliminar, favorito).
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
solo el plan **principal** (no combina Modo Hardcore), y la Simbología usa 4 estados
reales (no existe un 5º estado "Retirada" en `ESTADOS_MATERIA`).

---

## `js/main.js` — arranque

**Qué hace:** todo lo que pasa una sola vez al cargar la página — decide si hay
sesión guardada o hay que mostrar el botón de login, pinta el perfil de Google,
maneja la navegación entre secciones del sidebar, y llama a **todas** las funciones
`inicializarX()` de los demás módulos (son las que enganchan los listeners de cada
modal la primera vez).
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
| Selector de plan, Modo Hardcore, Gestionar Planes | `plan/plan-gestionar.js` |
| Vista de Mapa interactivo | `plan/plan-mapa.js` |
| Navegación del sidebar, qué sección se muestra al entrar | `main.js` |

**Regla general para una IA nueva:** antes de tocar código, hacé `grep` del nombre de
la función que creés que hay que cambiar sobre toda la carpeta `js/` — el nombre de
archivo real siempre está en el `export {}` al final de cada archivo, así que un
`grep -rn "nombreDeLaFuncion" js/` te confirma en 1 paso si la sospecha de esta tabla
es correcta antes de editar.
