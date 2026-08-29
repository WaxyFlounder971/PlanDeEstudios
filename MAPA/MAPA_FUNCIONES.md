# MAPA_FUNCIONES.md

Índice de referencia rápida de qué exporta cada archivo `.js` del proyecto y para
qué sirve, para no tener que leer/grepear archivos completos en cada prompt. Solo se
documentan **exports** (lo que otros archivos pueden importar de acá) — funciones
privadas internas no aparecen.

Para la vista de alto nivel (capas, por qué existen los imports circulares, y "en
qué archivo empiezo si me piden X") ver `ARQUITECTURA.md`. Este documento es el
detalle función-por-función; `ARQUITECTURA.md` es el mapa de decisión.

> **Estado:** 43/44+ archivos `.js` del proyecto documentados (se sumó `asistente/asistente.js`, 2026-08-29). **1 pendiente detectado en esta ronda:** `asistente/asistente-bandeja.js` — existe (lo referencian los comentarios de exports de `asistente.js`, ronda "Bandeja pendiente / Captura por voz") pero nunca se subió/documentó acá; no se documenta en esta ronda por no tener el archivo a la vista, para no inventar su lista de exports.

---

## Índice de carpetas

- [`js/core/`](#js--core) — datos, sesión, sincronización (9 archivos)
- [`js/ui/`](#js--ui) — componentes de interfaz genéricos (3 archivos)
- [`js/config/`](#js--config) — sección Configuración (3 archivos)
- [`js/plan/`](#js--plan) — Plan de Estudios (10 archivos)
- [`js/semestres/`](#js--semestres) — Semestres y matrícula (3 archivos)
- [`js/finanzas/`](#js--finanzas) — Finanzas (3 archivos)
- [`js/comunidad/`](#js--comunidad) — Profesores y compañeros (1 archivo)
- [`js/horario/`](#js--horario) — Horario y horario entre amigos (4 archivos)
- [`js/agenda/`](#js--agenda) — Agenda (5 archivos)
- [`js/asistente/`](#js--asistente) — Asistente IA (1 archivo documentado; ver nota sobre `asistente-bandeja.js` pendiente)
- [`js/resumen/`](#js--resumen) — Resumen (1 archivo)
- [`js/main.js`](#jsmainjs) — arranque (1 archivo)

---

## JS — core

### core/auth.js
Propósito: toda la integración con Google (login/token) y con las API de Google Drive y Google Calendar — es la única capa que habla HTTP con Google.
Depende de: schema.js (`crearDatosUsuarioNuevo`)
Exporta:
* `NOMBRE_CARPETA_BACKUP` — constante `"AppAcademica"`, nombre de la carpeta de Drive donde vive el backup rotativo.
* `inicializarGoogleAuth({ alObtenerToken, alListo, alFallar, alRechazarPermiso })` — arranca el CodeClient de Google Identity al cargar la página; llama a los callbacks según el resultado.
* `iniciarSesionConGoogle()` — dispara la ventana de login/consentimiento de Google (debe llamarse directo desde un click, sin await antes). 2026-08-25: migrado de `initTokenClient` a `initCodeClient` (flujo de código) — ver `tieneScopeCalendarOtorgado` más abajo.
* `obtenerPerfilGoogle(token)` — pide nombre y foto de perfil a Google. Devuelve `{ nombre, foto_url }` o `null` si falla.
* `cerrarSesionGoogle()` — revoca el token en memoria y borra el refresh_token guardado (`borrarRefreshTokenGoogle()`) — no borra datos locales, eso lo hace storage.js/main.js.
* `buscarOCrearArchivoDatos(token)` — busca el JSON central de la app en Drive; si no existe lo crea con datos de fábrica. Devuelve `{ fileId, datos }`.
* `crearArchivoJsonEnDrive(token, nombreArchivo, datos)` — versión genérica de creación de archivo JSON en Drive con nombre/contenido arbitrarios (usada para horarios compartidos públicos).
* `crearPermisoPublicoLectura(token, fileId)` — aplica permiso público de solo lectura sobre un archivo. Devuelve `{ id }` (el `permissionId` a guardar para poder revocarlo).
* `eliminarPermisoDrive(token, fileId, permissionId)` — revoca un permiso público (botón "Revocar" de un enlace compartido); un 404 cuenta como éxito.
* `leerDatos(token, fileId)` — descarga y parsea el JSON completo de un archivo de Drive.
* `obtenerMetadatosArchivo(token, fileId)` — pide solo `modifiedTime` de un archivo (llamada barata para sondeo de cambios remotos).
* `guardarDatos(token, fileId, datos)` — sobrescribe el archivo de datos en Drive con el objeto completo; valida `respuesta.ok` y lanza si falla.
* `refrescarAccessTokenViaWorker(refreshToken)` — pide un access_token nuevo vía `POST /oauth/refresh` del Worker — llamada REST servidor-a-servidor pura, nunca puede mostrar una ventana de Google. Devuelve `{ token, expiresIn, refreshTokenNuevo }` (`refreshTokenNuevo` solo si Google rotó el refresh_token). Rechaza con `error.invalidGrant = true` si el refresh_token venció/fue revocado.
* `guardarRefreshTokenGoogle(refreshToken)` / `leerRefreshTokenGoogle()` / `borrarRefreshTokenGoogle()` — guardan/leen/borran el refresh_token en `localStorage`, local a este dispositivo (nunca sincroniza a Drive, es una credencial no un dato de la app).
* `tieneScopeCalendarOtorgado()` — (2026-08-25, Calendario Secundario) si el login/canje más reciente incluyó el scope `.../auth/calendar` — Drive es obligatorio desde siempre, Calendar es scope nuevo y opcional en el sentido de que su ausencia no bloquea el login.
* `crearCalendarioSecundario(token, nombreCalendario)` — `calendars.insert`, crea el calendario secundario (una sola vez por usuario, ver `asegurarCalendarioSecundario` en notificaciones-calendario.js). Devuelve el objeto de Google (`.id` es lo que hay que persistir).
* `fijarColorCalendario(token, calendarId, colorId)` — `calendarList.patch`, fija el color de fondo del calendario secundario en sí (no de eventos individuales).
* `insertarEventoCalendar(token, calendarId, evento)` / `actualizarEventoCalendar(token, calendarId, eventId, evento)` / `eliminarEventoCalendar(token, calendarId, eventId)` — `events.insert`/`events.update` (PUT completo)/`events.delete` crudos contra Google Calendar; la orquestación (mapear un EventoAgenda, colorId, reminders, best-effort) vive en notificaciones-calendario.js.
* `subirArchivoBinarioADrive(token, archivo)` — sube un `File`/`Blob` arbitrario (adjuntos) como archivo nuevo e independiente en Drive.
* `descargarArchivoBinarioDeDrive(token, driveFileId)` — descarga el contenido real de un adjunto por demanda.
* `eliminarArchivoDeDriveConId(token, driveFileId)` — borra el archivo real de Drive de un adjunto eliminado; 404 cuenta como éxito.
* `buscarOCrearCarpetaEnDrive(token, nombreCarpeta)` — busca (o crea) una carpeta visible para la app (scope `drive.file`). Devuelve el `folderId`.
* `buscarArchivoEnCarpeta(token, folderId, nombreArchivo)` — busca un archivo por nombre dentro de una carpeta puntual. Devuelve su `fileId` o `null`.
* `renombrarArchivoDrive(token, fileId, nuevoNombre)` — renombra un archivo sin tocar su contenido (solo metadata).
* `copiarArchivoDrive(token, fileId, nombreCopia, folderId)` — copia un archivo existente del lado del servidor de Google (sin bajar/subir bytes).
* `moverArchivoAlaCarpeta(token, fileId, folderIdDestino)` — mueve un archivo existente a una carpeta, mismo `fileId`, sin tocar contenido.

> **Nota 2026-08-25:** este archivo YA estaba documentado acá con `refrescarAccessTokenViaWorker`/`guardarRefreshTokenGoogle`/`leerRefreshTokenGoogle`/`borrarRefreshTokenGoogle` desde una sesión anterior — pero el auth.js real que se auditó al empezar esta migración todavía tenía la versión vieja (`initTokenClient`, sin refresh_token, sin ninguna de esas 4 funciones). Es decir, esta parte de OAuth ya se había dado por hecha en la documentación sin haberse aplicado nunca al código real. Se implementó ahora con los nombres que ya documentaba este archivo (no con nombres nuevos), asumiendo que storage-sync.js ya los llama así — si storage-sync.js resulta usar otros nombres, hay que ajustar auth.js, no este documento.

### core/clipboard.js
Propósito: blindaje del flujo "copiar prompt al portapapeles" (usado en "Enviar a Claude/ChatGPT") — garantiza que el usuario siempre se entera si la copia falló y siempre tiene una forma manual de recuperarse.
Depende de: storage.js (`estado`), ui/componentes.js (`mostrarToast`)
Exporta:
* `comprobarPermisoPortapapelesAlIniciar()` — se llama una vez tras un login exitoso; guarda en `estado.permisoPortapapeles` el estado del permiso ("otorgado"/"denegado"/"desconocido").
* `copiarAlPortapapelesBlindado(texto)` — intenta copiar con `navigator.clipboard.writeText`, y si falla usa `execCommand("copy")` como respaldo. Devuelve `true`/`false` real (nunca falla en silencio).
* `copiarPromptConAviso(texto)` — punto único que debe usar el resto de la app para copiar el prompt de importación: muestra toast si funcionó, o abre el modal de copia manual si falló por completo.
* `abrirModalCopiaManualPortapapeles(texto)` — construye (si hace falta) y muestra un modal con un textarea de solo lectura ya seleccionado, como último recurso de copia manual.

### core/schema.js
Propósito: el molde de datos completo del usuario — factories (`crear*`) de cada entidad, migraciones de esquema, el reloj lógico (Lamport) para sincronización, y todo el motor de cálculo de notas/promedios/finanzas. Es el archivo más grande y más importado del proyecto; no renderiza nada, no toca el DOM.
Depende de: ninguno (archivo base, sin imports).
Exporta:

*Datos de usuario y migraciones:*
* `crearDatosUsuarioNuevo()` — objeto de datos "vacío" para un usuario que inicia sesión por primera vez (estructura completa de fábrica).
* `migrarDatosAntiguos(datos)` — corre todas las migraciones de esquema necesarias sobre datos ya existentes, de forma idempotente, antes de renderizar nada. Incluye (2026-08-22) la migración de `plan.universidad` de string plano a `{ nombre_completo, siglas }`: string viejo → `{ nombre_completo: <string>, siglas: "" }`; ausente/corrupto → ambos campos vacíos. `siglas: ""` es la señal que usa `revisarUniversidadesIncompletas()` (main.js) para detectar planes incompletos y bloquear con `#modal-completar-universidades`.
* `MAPEO_HORAS_VIEJO_A_NUEVO` — tabla de migración del modelo viejo de horas fijo al modelo dinámico de `tipos_horas`.

*Reloj lógico / sincronización (Lamport):*
* `obtenerDispositivoId()` — id único y estable de este navegador/dispositivo (persiste en localStorage), usado como desempate determinista.
* `observarRelojLogico(valorAjeno)` — adelanta el reloj lógico propio al ver un contador ajeno mayor (regla estándar de Lamport).
* `sellarTimestamp(entidad)` — sella una entidad con el contador lógico, el id de dispositivo y `_version_base` (el contador previo, para distinguir edición secuencial de conflicto real). Punto único por el que debe pasar cualquier entidad al crearse o editarse — no inventar un sellado propio en otro archivo.

*Enlaces rápidos / adjuntos:*
* `crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor })` — estructura de un enlace rápido (máx. 20).
* `LIMITE_ENLACES_RAPIDOS` — tope de enlaces rápidos por usuario (20).
* `crearAdjunto({ nombre, mimeType, tamanoBytes, entidadTipo, entidadId })` — referencia liviana de un adjunto (el binario real vive aparte en Drive, ver storage-adjuntos.js).
* `LIMITE_MB_ADJUNTO` — tamaño máximo por adjunto en MB (25).

*Plan de Estudios:*
* `crearPlanEstudio({ nombre_carrera, universidad, codigo_plan, tipo_titulo, parametros_universidad })` — crea un Plan de Estudios nuevo. `universidad` (2026-08-22, separación nombre_completo/siglas) ya no es un string plano — es `{ nombre_completo, siglas }`; `siglas` es lo que se usa en todos los badges cortos de la app, `nombre_completo` queda para contexto donde hace falta el nombre real. Quien llama es responsable de armar el objeto completo (ver `abrirModalCrearPlan`/`btn-confirmar-crear-plan` en plan-esquema.js).
* `crearMateria({ codigo, nombre, creditos, horas, tiposHoras, bloque, requisitos, correquisitos, esOptativa, sinDefinir })` — crea una materia a partir de una fila de CSV o del formulario manual.
* `crearCategoria({ nombre, color })` — crea una categoría de materias (con timestamp sellado).
* `PARAMETROS_UNIVERSIDAD_DEFAULT` — valores sugeridos por universidad (tipos de horas, etc.).
* `NOMBRES_UNIVERSIDAD_PRESET` (2026-08-22) — nombres completos de los 2 presets rápidos TEC/UCR (`{ TEC: "Instituto Tecnológico de Costa Rica", UCR: "Universidad de Costa Rica" }`), usados para armar `universidad.nombre_completo` sin que el usuario lo tipee en esos 2 casos.
* `PRESETS_TIPOS_HORAS` — presets rápidos de `tipos_horas` para el modal "Nuevo Plan".

*Árbol de requisitos Y/O:*
* `crearNodoCodigo(valor)` — crea un nodo hoja `{ tipo: "codigo", valor }`.
* `crearNodoY(hijos)` / `crearNodoO(hijos)` — crean nodos operadores Y/O (colapsan a hoja simple si solo hay 1 hijo).
* `evaluarNodoRequisito(nodo, estaAprobada)` — evalúa recursivamente si un árbol de requisitos está cumplido, dado un callback de aprobación por código.
* `recorrerHojasArbol(nodo, callback)` — recorre todas las hojas del árbol sin importar la profundidad.
* `arbolContieneCodigo(nodo, codigo)` — true/false: ¿existe una hoja con este código en algún nivel?
* `migrarRequisitoAArbol(valorViejo)` — migra el formato viejo de requisitos (string/array plano) al árbol Y/O nuevo.

*Semestres:*
* `crearSemestre({ nombre, fecha_inicio, duracion_semanas, planesEstudioIds })` — crea un Semestre nuevo.
* `LIMITE_SEMANAS_SEMESTRE` — tope de semanas por semestre (25).
* `obtenerEstadoEfectivoSemestre(semestre)` — calcula en vivo si un semestre es "futuro"/"actual"/"pasado" (nunca se guarda el estado).
* `obtenerPlanesActivos(configuracion)` — ids de los planes activos ahora mismo, según Modo Hardcore (hasta 3).
* `obtenerEstadoEfectivoMateria(materia, planEstudioId, datos)` — estado efectivo de una materia del plan ("Cursando" se calcula en vivo, nunca se guarda).

*Notas y calificaciones:*
* `crearCriterio({ nombre, valorTotal, orden, esExtra })` / `crearAsignacion({ nombre, valor, orden, modoCalificacion })` — crean criterio/asignación de evaluación dentro de una materia matriculada.
* `crearMateriaMatriculada({ materiaId, planEstudioId })` — matricula una materia real dentro de un semestre.
* `repartirEquitativoCriterio(criterio)` — reparte equitativamente el peso sobrante entre asignaciones en modo "automático".
* `obtenerEscalaNotasMateria(materia, plan, configuracion)` — resuelve la escala de notas activa (override > plan > default 100).
* `ESCALAS_DISPONIBLES` — lista de escalas de calificación disponibles (10, 100, letras, gpa4, etc.).
* `obtenerEscalaPorId(escalaId)` — descriptor completo de una escala a partir de su id crudo.
* `convertirA100(valorEnEscala, escala)` / `convertirDesde100(valorEn100, escala)` — conversión entre una escala puntual y 0-100 interno.
* `migrarNotasAsignacionesEscalaPlan(datos, planId, escalaIdVieja, escalaIdNueva)` — re-escala todas las notas ya cargadas de un plan al cambiar su escala de notas.
* `obtenerFraccionNota(nota, escalaId)` / `notaMinimaParaFraccion(fraccion, escalaId)` — conversión nota↔fracción (0-1) para comparar/simular entre escalas distintas.
* `calcularPuntosAsignacion(asignacion, escalaActiva)` — puntos ponderados reales que aporta una asignación calificada, normalizados a 0-100.
* `recalcularNotaDesdePuntaje(asignacion, escalaActiva)` — dado un puntaje crudo, calcula la nota equivalente en la escala activa.
* `calcularNotaFinalMateria(materiaMatriculada, escalaActiva)` — nota final (0-100) sumando los puntos de todas las asignaciones calificadas.
* `redondearDecimales(num, decimales)` — redondeo "decimal-safe" que limpia ruido binario de coma flotante.
* `redondearNotaFinalAlCincoMasCercano(nota)` — redondea la nota final al múltiplo de 5 más cercano antes de decidir aprobado/reprobado.
* `obtenerAsignacionesPendientes(materiaMatriculada)` — lista de asignaciones sin nota todavía (para el simulador "Proyectar").
* `calcularMaximoPosibleMateria(materiaMatriculada, escalaActiva)` — nota final si se saca el máximo en todo lo pendiente.
* `calcularNotaNecesariaUniforme(materiaMatriculada, escalaActiva, objetivo)` — fracción uniforme necesaria en cada pendiente para llegar a un objetivo.
* `calcularObjetivoPasarRaspando(notaAprobacion)` — objetivo real de "pasar raspando" dado el redondeo al 5.
* `resolverObjetivoPasarRaspando(params)` — igual que arriba pero respetando un override manual por plan.
* `calcularNotaFinalVigenteMateria(mm, materia, plan, configuracion)` / `calcularNotaParaPromedio(mm, materia, plan, configuracion)` — nota final vigente de una matrícula, con y sin redondeo al 5, para dashboards.
* `listarMatriculasResolubles(datos, incluirActuales = true)` — lista base de matrículas con nota resoluble, para alimentar los cálculos de promedio.
* `calcularPromedioPonderado(entradas)` — Σ(nota×créditos)/Σcréditos sobre una lista ya filtrada.
* `calcularPromedioPorSemestreYUniversidad(datos)` / `calcularPromedioPorPlan(datos)` / `calcularPromedioTotalCombinado(datos)` — los 3 niveles de promedio del dashboard (por semestre+universidad, por plan/carrera, combinado total). Agrupa por `plan.universidad.siglas` (con fallback a `nombre_completo` y luego "Sin universidad") desde la separación nombre_completo/siglas (2026-08-22).
* `calcularEstadisticasAprobacion(datos, planId)` — % de cursos aprobados/reprobados (solo materias cerradas).
* `calcularDetallePorEstado(datos, planId)` — conteo por los 4 estados manuales del Plan (Aprobada/Cursando/Reprobada/Pendiente).

*Finanzas:*
* `crearRegistroFinancieroSemestre({ semestreId, costoMatricula, becaMonto })` — registro financiero de un semestre.
* `crearGastoU({ nombre, tipo, costo, nota, semestreId, recurrente })` — gasto (o **ingreso**, ver `tipo`) general de universidad, con soporte para recurrentes. **v2.9.2 (2026-08-26):** se agrega `tipo` (`"gasto"` | `"ingreso"`, default `"gasto"` — cualquier valor que no sea exactamente `"ingreso"` cae a `"gasto"`, así los `gastos_u` guardados antes de este cambio, sin el campo, se siguen tratando igual sin migración). Reutiliza el mismo objeto/CRUD/recurrencia para ambos tipos — la diferencia es puramente de clasificación para los totales (`calcularTotalesResumenFinanzas`, finanzas.js) y de color en la UI (finanzas-gastos.js), no de estructura.
* `calcularPagosRecurrentesTranscurridos(recurrente)` — cuenta cuántos pagos de un gasto recurrente ya cayeron hasta hoy (nunca futuros).
* `crearBackupDriveDefault()` — objeto default de `configuracion.backup_drive`.
* `FRECUENCIAS_BACKUP_DRIVE` — opciones de frecuencia de backup rotativo (diaria..mensual, con sus días de intervalo).
* `MONEDAS_DISPONIBLES` — catálogo de monedas con símbolo, para el selector global de moneda. **v2.9.2 (2026-08-26):** se agregan ~14 monedas propias de países latinoamericanos (MXN, ARS, COP, CLP, UYU, CUP, BOB, VES, DOP, HNL, NIO, PAB, HTG) más la de Senegal (XOF) — a propósito SIN aplicar acá el criterio de "un representante por símbolo" que se usó para el resto del catálogo (pedido explícito: aunque el símbolo se repita entre varias, cada país listado tiene su propia entrada).
* `PALETAS_DISPONIBLES` — lista de las 13 paletas de color disponibles.

*Horario:*
* `MODALIDADES_HORARIO` — valores fijos de modalidad de clase (presencial/semipresencial/virtual/personalizado/sin_clase).
* `crearModalidadHorario(tipo, textoPersonalizado)` — constructor del valor de modalidad (objeto, no string plano).
* `crearBloqueHorario({ materiaId, planEstudioId, nombre, apodo, grupo, dias, modalidad, aula, profesorId, enlace, notas, color })` — plantilla base de un bloque de horario para todo el semestre.
* `crearDiaCronograma({ numeroSemana, dia, modalidad })` — override de modalidad de un día puntual de una semana puntual.
* `obtenerClasesEfectivasSemana(bloque, numeroSemana)` — lista de clases efectivas de un bloque para una semana concreta, resolviendo overrides del cronograma.
* `calcularNumeroSemanaSemestre(semestre)` — número de semana 1-based dentro de un semestre, según `fecha_inicio`.
* `crearEnlaceHorarioCompartido({ fileId, permissionId, semestreId, apodoPropietario })` — registro de un enlace de horario compartido generado por el usuario.
* `crearAmigoVinculado({ fileId, nombre, color })` — registro de un horario de amigo vinculado al propio.

*Agenda:*
* `TIPOS_EVENTO_AGENDA` — `["evento", "tarea", "examen"]`.
* `crearEventoAgenda({ tipo, nombre, fecha, hora, materiaMatriculadaId, semestreId, notas, esFeriado })` — crea un evento/tarea/examen de agenda, ya sellado. Incluye `google_calendar_event_id: null` (2026-08-25, ver Calendario Secundario más abajo).
* `OFFSETS_RECORDATORIO_AGENDA` — offsets disponibles para un recordatorio (id/etiqueta/minutosAntes).
* `NOMBRE_CALENDARIO_SECUNDARIO` — (2026-08-25) `"AppAcademica"`, nombre exacto del calendario secundario de Google creado vía `calendars.insert` (ver `crearCalendarioSecundario` en auth.js).
* `COLOR_ID_GOOGLE_CALENDAR_POR_TIPO` — (2026-08-25) mapa tipo→colorId de evento de Google Calendar (tarea/examen/evento/feriado), usado por `core/notificaciones-calendario.js` al armar cada evento espejo.

*Comunidad:*
* `crearProfesor({ nombre, materias, correo, telefono })` / `crearCompanero({ nombre_completo, carnet, lista, materias_compartidas, nota, telefono })` — crean profesor/compañero.
* `obtenerHistorialProfesor(profesorId, datos)` — todas las materias matriculadas ligadas a un profesor, en todos los semestres.
* `obtenerUniversidadesDeProfesor(profesorId, datos)` — universidades donde dio clases un profesor. Devuelve strings vía `plan.universidad.siglas` (fallback a `nombre_completo`), mismo criterio que `calcularPromedioPorSemestreYUniversidad`.
* `obtenerMateriasCompartidasValidas(companero, datos)` — filtra las materias compartidas de un compañero a solo las que siguen apuntando a una matrícula real.
* `obtenerIntentosMateria(materiaId, planEstudioId, datos)` — todos los intentos reales de cursar una materia, cruzando todos los semestres.

*Utilitarios generales de colección:*
* `siguienteOrden(coleccion)` — próximo valor de `orden` para agregar algo al final (drag and drop).
* `reordenarPorArrastre(coleccion, idsEnNuevoOrden)` — reasigna `orden` secuencial tras un drag, sellando timestamp solo en los ítems que cambiaron.

**Si vas a agregar una llave nueva al modelo de datos (JSON de Drive), es acá.**

### core/storage-adjuntos.js
Propósito: orquesta el ciclo de vida completo de un adjunto: referencia liviana en el JSON (vía schema.js) + subida/descarga/borrado del binario real en Drive (vía auth.js), con cola de subida en memoria y limpieza de archivos huérfanos.
Depende de: schema.js, auth.js, storage-sync.js, storage.js
Exporta:
* `adjuntarArchivo(archivo, entidadTipo, entidadId)` — crea la referencia local al instante (con `subidaPendiente:true`) y encola el binario para subir en segundo plano. Devuelve la referencia creada.
* `procesarColaSubidas()` — procesa la cola de subidas pendientes en memoria; se reintenta sola tras adjuntar y al recuperar conexión.
* `descargarAdjunto(adjunto)` — descarga bajo demanda el binario y devuelve un Blob URL (quien llama debe revocarlo).
* `eliminarAdjunto(adjuntoId)` — tumba la referencia en el JSON + intenta borrar el binario real de Drive (best-effort, no crítico si falla).
* `procesarTumbasDriveHuerfanas()` — recorre tumbas de adjuntos buscando archivos de Drive que quedaron huérfanos (borrado registrado pero binario no borrado) y los limpia. Se engancha como hook post-fusión.
* `obtenerAdjuntosDe(entidadTipo, entidadId)` — helper de renderizado: adjuntos vigentes de una entidad puntual.

### core/storage.js
Propósito: estado global compartido (`estado`) por toda la app, caché offline en localStorage, y manejo del access_token de Google (guardar/leer/borrar con expiración).
Depende de: storage-sync.js (`ocultarAvisoReconexion`, `programarRefrescoProactivo` — import circular intencional, ver ARQUITECTURA.md).
Exporta:
* `estado` — objeto mutable compartido globalmente: `token`, `fileId`, `datos`, `pendienteSync`, `conexionDrive`, `ultimoModifiedTimeConocido`, `permisoPortapapeles`, etc.
* `CLAVE_CACHE_LOCAL` / `CLAVE_TOKEN_CACHE` — nombres de llave de localStorage para la caché de datos y de token respectivamente.
* `guardarTokenCache(token, expiresInSegundos)` — cachea `{ token, expiraEn }` en localStorage.
* `leerTokenCacheValido()` — devuelve `{ token, expiraEn }` solo si queda más de 5 min de vida; si no, `null`.
* `borrarTokenCache()` — limpia el token cacheado de localStorage.
* `establecerTokenActivo(token, expiresInSegundos)` — punto único para fijar un token válido: lo guarda en memoria y caché, programa el refresco proactivo, y marca "conexión OK".
* `authListo` — Promise que resuelve una sola vez cuando ya se supo si hay token utilizable (evita condiciones de carrera al iniciar).
* `resolverAuthListo` — función que resuelve la promesa `authListo`.
* `guardarCacheLocal()` — persiste `{ fileId, datos, pendienteSync }` en localStorage.
* `leerCacheLocal()` — lee la caché local; devuelve `null` y la descarta si está corrupta (JSON inválido).

### core/storage-merge.js
Propósito: toda la lógica de fusión (merge) de datos entre dispositivos al sincronizar — resuelve conflictos usando el reloj lógico de Lamport y respeta tumbas de borrado en cada colección anidada del modelo.
Depende de: schema.js (`observarRelojLogico`, `migrarDatosAntiguos`)
Exporta:
* `fusionarDatos(datosLocal, datosRemoto)` — punto de entrada principal; toda lectura de datos externos (Drive o caché) debe pasar por acá antes de aplicarse.
* `esMasReciente(a, b)` — compara dos entidades por su contador lógico `_actualizadoEn` (con desempate por `_dispositivoId`).
* `sonValoresEquivalentes(a, b)` — comparación profunda insensible al orden de llaves (evita falsos conflictos).
* `hayConflictoReal(local, remoto)` — determina si dos versiones de una entidad son un conflicto genuino o solo una edición secuencial.
* `fusionarColeccion(coleccionLocal, coleccionRemota, tumbas, etiqueta)` — fusiona dos arreglos de entidades con `id` propio, respetando tumbas de ambos lados.
* `fusionarTumbas(tumbasLocal, tumbasRemota)` — unión simple de tumbas (un borrado nunca se pierde).
* `resolverConflicto(entidadConConflicto, cual, sellarTimestampFn)` — aplica la versión elegida por el usuario (local o alterna) y la re-sella limpia.
* `fusionarPlan(planLocal, planRemoto)` — funde un plan de estudios y sus colecciones internas (materias, categorías, etc.).
* `fusionarSemestre(semestreLocal, semestreRemoto)` / `fusionarSemestres(local, remoto, tumbas)` — funden un semestre individual y la colección completa de semestres.
* `fusionarMateriaMatriculada(mmLocal, mmRemoto)` / `fusionarMateriasMatriculadas(local, remoto, tumbas)` — funden una matrícula individual (con sus criterios) y la colección completa.
* `fusionarCriterio(criterioLocal, criterioRemoto)` / `fusionarCriterios(local, remoto, tumbas)` — funden un criterio individual (con sus asignaciones) y la colección completa.
* `fusionarBloqueHorario(bloqueLocal, bloqueRemoto)` / `fusionarBloquesHorario(local, remoto, tumbas)` — funden un bloque de horario individual (con sus excepciones de semana) y la colección completa.
* **Regla para entidades nuevas:** cualquier colección nueva con `id` propio se funde con `fusionarColeccion()` genérica — no escribir lógica de fusión nueva por tipo salvo que tenga sub-colecciones anidadas propias (patrón `fusionarPlan`/`fusionarSemestre`/`fusionarCriterio`).

### core/storage-sync.js
Propósito: orquestación completa de sincronización con Drive: refresco de token vía el Worker (`asegurarTokenValido`, sin popups — ver core/auth.js), subida/bajada de cambios, sondeo multi-dispositivo, pull-to-refresh, backup rotativo, indicador visual de estado y conteo de conflictos.
Depende de: config-ajustes.js, config-enlaces.js, main.js, plan-gestionar.js, plan-vista-lista.js, semestres.js, semestres-tarjetas.js, finanzas.js, ui/componentes.js, ui/tema.js, auth.js, schema.js, storage-merge.js, storage.js
> **Nota:** aunque `storage-sync.js` vive en `core/`, importa varios módulos de capas superiores (Plan, Semestres, Finanzas, Config, UI, `main.js`). Es **intencional**, no una violación de capas: son los módulos que hay que re-renderizar después de aplicar datos remotos frescos (`aplicarDatosRemotosFrescos`) o tras un login. Mismo patrón de import circular que `storage.js`↔`storage-sync.js` — ver ARQUITECTURA.md.
Exporta:
* `registrarHookPostFusion(fn)` / `registrarHookPostGuardado(fn)` — permiten a otros módulos (ej. storage-adjuntos.js) engancharse a eventos del ciclo de sync sin acoplar este archivo a ellos.
* `asegurarTokenValido()` — (2026-08-25, reemplaza a `intentarReconexionSilenciosa`/`reconexionEnCurso`) punto único de "conseguir un access_token que sirva" para toda la app: revisa la caché válida, y si no hay, pide uno nuevo vía `refrescarAccessTokenViaWorker` (REST puro contra el Worker, nunca muestra ventana). Si no hay `refresh_token` guardado, o el refresco falla de verdad (revocado/vencido), muestra el aviso de reconexión y devuelve `false`. Deduplica refrescos en paralelo internamente.
* `programarRefrescoProactivo(expiresInSegundos)` — programa el refresco del token antes de que expire.
* `temporizadorRefrescoProactivo` — handle del timer de refresco proactivo.
* `mostrarAvisoReconexion()` / `ocultarAvisoReconexion()` — muestran/ocultan el banner de "reconectando" en la UI.
* `mostrarCargando()` / `ocultarCargando()` — controlan el overlay de carga (con contador anidado).
* `contadorCargando` — contador de llamados anidados a mostrarCargando/ocultarCargando.
* `inicializarPullToRefresh()` — gesto de "deslizar para refrescar" (Pointer Events, funciona en móvil y desktop).
* `conReintentoSi401(operacion)` — envuelve una operación de Drive; si falla con 401, llama a `asegurarTokenValido()` y reintenta una vez.
* `sincronizarAhora()` — sincronización completa "en el sitio": sube pendientes, baja lo último de Drive, repinta la UI sin recargar.
* `aplicarDatosRemotosFrescos(datosFrescos)` — bloque compartido que aplica datos ya descargados y repinta toda la UI.
* `marcarUltimaSincronizacionConfirmada()` — marca en la UI que la última sincronización se confirmó con éxito.
* `sondearCambiosRemotos()` — revisa cada pocos segundos si el archivo cambió en Drive desde otro dispositivo (solo `modifiedTime`, llamada barata).
* `sincronizarAlIniciar()` — sincronización especial al arrancar la app (sube Y baja).
* `inicializarSondeoAlVolver()` — reactiva el sondeo cuando la pestaña vuelve a estar visible/en foco.
* `ejecutarBackupSiToca()` — corre el ciclo de backup rotativo solo si ya toca según la frecuencia elegida; silencioso ante errores.
* `forzarBackupManual()` — corre el backup ignorando el intervalo, para el botón manual; sí propaga errores a la UI.
* `marcarCambioPendiente()` — se llama cada vez que se modifica algo en `estado.datos`; dispara intento de sync.
* `intentarSincronizar()` — sube los cambios pendientes a Drive.
* `forzarSincronizacion()` — fuerza el intento de sync ya, sin esperar el evento `online`.
* `contarConflictosGlobales()` — cuenta todos los conflictos de sync pendientes en cualquier parte de los datos (para el badge ⚠️).
* `actualizarBadgeConflictosGlobales()` — repinta el badge de conflictos con el número actual.
* `actualizarIndicadorSync()` — repinta el indicador visual de estado de sincronización.

### core/utils.js
Propósito: helpers genéricos sin estado propio — conversión de archivos a base64, formato de texto según preferencia del usuario, colores de badges, formato compacto de horas.
Depende de: storage.js (`estado`)
Exporta:
* `convertirArchivoABase64(archivo)` — lee un archivo tal cual (sin comprimir) y lo convierte a base64 (Promise).
* `convertirImagenABase64Comprimida(archivo, maxDimensionPx = 96, calidad = 0.8)` — redimensiona y recomprime una imagen antes de convertir a base64; conserva PNG si el formato tiene transparencia real, si no usa JPEG.
* `obtenerIniciales(texto)` — iniciales (hasta 2 letras) de un texto, en mayúsculas.
* `formatearHoras(materia)` — línea compacta de horas de una materia, iterando las llaves reales de `materia.horas`.
* `formatearHorasCompactoIniciales(materia)` — versión aún más compacta (solo iniciales) para la tarjeta colapsada.
* `aplicarFormatoTexto(texto)` — aplica el formato de nombres elegido en Configuración ("titulo"/"mayusculas"/"oracion"), respetando números romanos siempre en mayúsculas.
* `esTokenNumeroRomano(token)` — valida si una palabra es un número romano válido.
* `transformarPalabraFormato(palabra, formato, esPrimeraPalabra)` — aplica la transformación de una sola palabra según el formato elegido.
* `hexARgba(hex, alpha)` — convierte un color hex a `rgba(...)` con la opacidad indicada.
* `estiloBadgeCategoria(hex)` — string de estilo CSS inline para un badge de categoría (fondo translúcido + borde + texto del color).

### core/notificaciones-calendario.js
Propósito: sincronización de recordatorios de Agenda (tareas, exámenes, eventos) con un Calendario Secundario de Google ("AppAcademica") por usuario — reemplaza por completo a `core/notificaciones-push.js` (Web Push + VAPID + Cron en el Worker, dado de baja el 2026-08-25 por no llegar de forma confiable en Doze Mode/Safari). Habla DIRECTO contra la API de Google Calendar (helpers crudos en auth.js) usando el access_token de la sesión — ya NO usa el Worker de Cloudflare para nada de esto (el Worker solo sigue vivo para `/oauth/exchange`/`/oauth/refresh`). Toda llamada de red es "best-effort": si Calendar no responde, nunca bloquea ni revierte la acción real del usuario en Agenda.
Depende de: schema.js, storage-sync.js, storage.js, utils.js, auth.js, ui/componentes.js
Exporta:
* `sincronizacionCalendarActiva()` — lee el switch de Ajustes (`estado.datos.configuracion.sincronizar_calendario_google`).
* `activarSincronizacionCalendario()` — crea el calendario secundario si hace falta (`asegurarCalendarioSecundario`, interna), prende el switch, y sincroniza en lote todo lo pendiente + el Resumen Diario. Devuelve `true`/`false` según haya quedado activo (falla si no se otorgó el scope de Calendar, o si no se pudo crear el calendario).
* `desactivarSincronizacionCalendario()` — apaga el switch y borra de Calendar todos los eventos espejados + el evento recurrente del Resumen Diario (el calendario secundario en sí NO se borra).
* `sincronizarEventoCalendario(evento)` — (re)crea/actualiza el espejo de un `EventoAgenda` en Calendar vía `events.insert`/`events.update`; si `evento.completada` es `true`, lo elimina en vez de sincronizarlo. No hace nada si el switch está apagado o falta el scope de Calendar.
* `eliminarEventoCalendarizado(evento)` — elimina el espejo de un evento en Calendar. A diferencia del viejo `cancelarRecordatorioPush(eventoId)`, necesita el objeto `evento` COMPLETO (con `google_calendar_event_id`), no solo el id.
* `sincronizarResumenDiario()` — crea/actualiza/borra el ÚNICO evento recurrente (`RRULE:FREQ=DAILY`) del Resumen Diario según `configuracion.notificaciones_resumen_diario`; si cambia la hora, actualiza ese mismo evento (nunca crea uno nuevo).
* `ofrecerActivarSincronizacionCalendario()` — diálogo de onboarding (se llama una única vez desde `main.js`, tras el primer login de una cuenta nueva).

> **Integración pendiente de confirmar (2026-08-25):** `agenda.js`/`agenda-modal.js` deben actualizarse para llamar a `sincronizarEventoCalendario`/`eliminarEventoCalendarizado` en vez de las funciones viejas de `notificaciones-push.js` (ver nota de cabecera del archivo); `main.js` debe cambiar su import e invocación de `ofrecerActivarNotificacionesPush` a `ofrecerActivarSincronizacionCalendario`, y su listener de `serviceWorker.addEventListener("message", ...)` (salto a Agenda al tocar una notificación push) ya no aplica — el deep link del Resumen Diario ahora es una URL normal (`?abrir=resumen`) que abre el navegador directo, sin pasar por un Service Worker. Ninguno de los 3 archivos se tocó en esta sesión (no se subieron).

---

## JS — ui

### ui/componentes.js
Propósito: componentes de UI reutilizables en toda la app — modal de confirmación genérico, toasts, long-press, flechas de scroll horizontal, layout responsivo del sidebar/drawer, selector de modalidad de horario.
Depende de: main.js (import circular intencional — ver ARQUITECTURA.md), core/schema.js
Exporta:
* `CLAVE_SIDEBAR_COLAPSADA` — clave de localStorage donde se guarda si el sidebar está colapsado.
* `abrirConfirmacion({titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar})` — abre el modal de confirmación reutilizable.
* `abrirDrawerEnlacesMovil()` — abre el drawer móvil de Enlaces rápidos con su propio overlay y bloquea el scroll de fondo.
* `agregarLongPress(el, callback, duracionMs=500)` — ejecuta `callback` al mantener presionado (~500ms) o hacer clic derecho sobre un elemento.
* `callbackConfirmacionActual` — referencia al callback pendiente del modal de confirmación actualmente abierto.
* `cerrarConfirmacion()` — cierra el modal de confirmación y limpia el callback pendiente.
* `cerrarDrawerEnlacesMovil()` — cierra el drawer móvil de Enlaces rápidos.
* `cerrarSidebarMovil()` — cierra el sidebar principal en vista móvil.
* `construirSelectorModalidad(valorInicial, onCambiar)` — arma el selector de modalidad de horario; devuelve `{ elemento, obtenerValor() }`.
* `desplazarYResaltarElemento(selector, intentosRestantes=15)` — hace scroll hasta un elemento y lo resalta, reintentando varios frames si aún no existe en el DOM.
* `envolverConFlechasScroll(elementoScroll)` — agrega flechas de scroll horizontal que solo aparecen cuando el contenido desborda el ancho disponible.
* `inicializarAutoScrollSelectoresEnModales()` — activa el auto-scroll hacia el ítem activo dentro de selectores ubicados en modales.
* `inicializarBotonesCerrarModal()` — engancha los botones "X" de cierre de modales, reutilizando los listeners de "clic afuera cierra" ya existentes.
* `inicializarLayoutResponsivo()` — configura el comportamiento responsivo del sidebar/drawer según el tamaño de pantalla.
* `inicializarModalConfirmacion()` — engancha los listeners del modal de confirmación (botón, clic afuera).
* `inicializarNavegacionBotonesMouse()` — habilita la navegación con los botones de mouse (adelante/atrás) respetando el orden/visibilidad configurados en Ajustes.
* `mostrarPantallaCargaSesion()` / `ocultarPantallaCargaSesion()` — overlay de marca propia (`#overlay-carga-sesion`, ver index.html/design-system.css) que reemplaza a `#pantalla-login` mientras la app decide si puede restaurar la sesión sola, y también mientras `onLoginExitoso` (main.js) trae el archivo de datos de Drive tras un login real. Separado a propósito de `mostrarCargando()`/`ocultarCargando()` (storage-sync.js, los "3 puntitos" genéricos).
* `mostrarToast(mensaje, duracionMs=2400)` — muestra un toast temporal.
* `mostrarToastAccion(mensaje, textoBoton, alConfirmar)` — muestra un toast persistente con un botón de acción, para avisos que requieren confirmación del usuario en vez de desvanecerse solos.
* `restaurarEstadoSidebar()` — restaura el estado colapsado/expandido del sidebar guardado en localStorage.

### ui/paleta-personalizada.js
Propósito: flujo para crear una paleta de colores personalizada ("Crear mi paleta", 15ª opción del selector de paletas), generado 100% por JS (overlay + modal).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, ui/tema.js
Exporta:
* `iniciarFlujoPaletaPersonalizada({alGuardar}?)` — punto de entrada llamado desde config-ajustes.js; abre el overlay del flujo de creación de paleta. `alGuardar` es un callback (típicamente `renderizarAjustes`) para refrescar el grid de paletas al terminar.

### ui/tema.js
Propósito: aplicación de paletas y modo claro/oscuro sobre `<html>`, más utilidades puras de color (conversión, mezcla, derivación de variables CSS) usadas tanto por el tema fijo como por la paleta personalizada.
Depende de: ninguno (funciones puras + DOM/localStorage)
Exporta:
* `COLORES_PREVIEW_PALETA` — mapa paleta → colores reales, para pintar cada cuadro del selector con su propio color sin depender de la paleta activa.
* `FONDO_PREVIEW_AZUCARADO` — degradado CSS de manchas de color usado como preview de la paleta "azucarado".
* `TEXTO_PREVIEW_PALETA` — mapa paleta → color de texto legible sobre su degradado (ej. "blanco" necesita texto oscuro).
* `aplicarPaleta(paleta, modo, coloresPersonalizados?)` — setea `data-palette`/`data-mode` en `<html>`, persiste en localStorage y aplica o limpia los colores personalizados inline.
* `aplicarTemaGuardadoLocalmente()` — aplica al arranque la paleta/modo guardados en localStorage (incluye colores personalizados si corresponde).
* `actualizarThemeColorMeta()` — sincroniza `<meta name="theme-color">` con `--bg-header-solido` de la paleta activa, para que la barra del sistema combine en PWA.
* `hexARgb(hex)` — convierte un color hex a `{r,g,b}`.
* `colorARgb(color)` — convierte hex o `rgb()`/`rgba()` a `{r,g,b}`, ignorando el canal alfa.
* `colorARgba(color)` — igual que `colorARgb` pero conservando el canal alfa real (`{r,g,b,a}`).
* `compositarSobreFondo(colorConAlpha, colorFondoHex)` — compone un color translúcido sobre un fondo dado y devuelve el hex sólido visualmente equivalente.
* `rgbAHex(r, g, b)` — convierte `{r,g,b}` a hex de 6 dígitos.
* `colorAHex(color)` — convierte cualquier color (hex o rgba string) a hex sólido de 6 dígitos.
* `rgbAHsl(r, g, b)` — convierte `{r,g,b}` a `{h,s,l}`.
* `hexAHsl(hex)` — convierte hex a `{h,s,l}`.
* `hslARgb(h, s, l)` — convierte `{h,s,l}` a `{r,g,b}`.
* `hslAHex(h, s, l)` — convierte `{h,s,l}` a hex.
* `mezclarHex(colorA, colorB, factor)` — mezcla lineal entre dos colores hex (factor 0 = colorA puro, 1 = colorB puro).
* `hexARgba(color, alpha)` — convierte un color a string `rgba(...)` con la opacidad indicada.
* `luminanciaRelativa(color)` — calcula la luminancia relativa (WCAG) de un color.
* `esColorClaro(color)` — indica si un color es "claro" según su luminancia relativa (>0.5).
* `calcularGradientesAcento({accent1, accent2, degradado})` — genera las 3 variantes de gradiente de acento (`--gradient-accent`/`-alt`/`-alt2`) según los colores base y el degradado configurado.
* `calcularVariablesDerivadas(colores)` — a partir de los 6 colores elegidos por el usuario, calcula todas las variables CSS derivadas que necesita una paleta (texto, paneles, glows, badges, etc.).
* `aplicarColoresPersonalizadosInline(colores)` — aplica las variables derivadas como estilos inline sobre `:root` (mayor prioridad que las reglas `[data-palette]`).
* `limpiarColoresPersonalizadosInline()` — remueve todas las variables CSS inline de la paleta personalizada, para volver limpio a una paleta fija.

---

## JS — config

### config/config-ajustes.js
Propósito: renderiza la sección de Ajustes (paletas, modo claro/oscuro, escala de notas, nota de aprobación por plan/universidad, formato de texto, backup rotativo a Drive, modo rendimiento, sincronización de recordatorios con Google Calendar, config de días de Horario, clave de API de Gemini para Asistente IA).
Depende de: core/notificaciones-calendario.js, core/schema.js, core/storage-adjuntos.js, core/storage-sync.js, core/storage.js, core/utils.js, plan/plan-vista-lista.js, semestres/semestres.js, ui/componentes.js, ui/tema.js, ui/paleta-personalizada.js
Exporta:
* `renderizarAjustes()` — reconstruye toda la sección de Ajustes (paletas, escalas, moneda, backup, sincronización con Google Calendar, etc.) e inicializa el accordion. Desde 2026-08-22 también llama a `inicializarAsistenteAjustes()` (interna, no exportada) — guarda/reemplaza/borra `configuracion.gemini_api_key`, muestra la clave enmascarada (últimos 4 caracteres) si ya hay una guardada, y llama a `window.aplicarVisibilidadBotonAsistente()` (main.js) al guardar o borrar. También llama a `renderizarNotificacionesRecordatorios()` y `renderizarNotificacionesResumenDiario()` (internas, no exportadas — reconstruidas 2026-08-23 tras perderse en un merge, ver más abajo).
* `renderizarSeccionBackupDrive()` — pinta el bloque de frecuencia/estado del backup rotativo a Drive; solo lee/escribe la preferencia, nunca dispara un backup a mano.
* `renderizarSeccionLiberarEspacio()` — (no documentada hasta ahora) pinta el bloque de Ajustes "Liberar espacio" (borrado en lote de adjuntos) dentro de `#seccion-liberar-espacio`; si `hayAdjuntosGuardados()` (core/storage-adjuntos.js) devuelve `false`, oculta el contenedor entero y no dibuja nada. Dos modos: por semestre (selector, con botones separados para adjuntos de Cronograma vs. de Tareas, más "Borrar todo este semestre") y global para eventos sueltos sin semestre. Cada botón pide confirmación (`abrirConfirmacion`, ui/componentes.js) antes de borrar — es destructivo e irreversible, borra también el archivo real en Drive vía `eliminarAdjuntosDe*` (core/storage-adjuntos.js), no solo la referencia local. Se re-llama a sí misma al terminar un borrado exitoso para refrescar el estado (ej. ocultarse si ya no queda nada). Llamada desde `renderizarAjustes()`.
* `aplicarModoRendimiento(activo)` — aplica/quita el atributo `data-rendimiento` en `<html>`. Fix 2026-08-23: antes solo se llamaba desde el `onchange` del switch de Ajustes (causaba el bug de "hace falta tocar el switch dos veces" — el atributo nunca se inicializaba al cargar la app); ahora `main.js` también la llama en `mostrarApp()`, con el valor guardado, apenas se conocen los datos reales del usuario.
* `DIAS_SEMANA_CONFIG` — arreglo con id/etiqueta/abreviatura por defecto de cada día de la semana, usado en la config de días de Horario.

Funciones internas (no exportadas) relevantes:
* `renderizarNotificacionesRecordatorios()` — pinta un grupo de chips de selección múltiple (`construirSelectorChipsMultiple`, ui/componentes.js) por cada tipo de evento de Agenda (tarea/examen/evento/feriado, ver `ETIQUETAS_TIPOS_RECORDATORIO_AGENDA`) dentro de `#seccion-notificaciones-recordatorios`. Lee/escribe `configuracion.notificaciones_recordatorios[tipo]` contra `OFFSETS_RECORDATORIO_AGENDA` (core/schema.js). Atenúa y bloquea el bloque completo si el switch general de sincronización con Google Calendar está apagado, sin perder los valores guardados.
* `renderizarNotificacionesResumenDiario()` — switch + selector de hora (mismo patrón visual que `construirSelectCustomAjustes`) para `configuracion.notificaciones_resumen_diario` (`{ activo, hora }`). Cada cambio llama a `sincronizarResumenDiario()` (core/notificaciones-calendario.js, 2026-08-25: antes creaba un evento por día contra el Worker, ahora es un único evento recurrente en Google Calendar). Reconstruida 2026-08-23: se había perdido por completo (junto con `renderizarNotificacionesRecordatorios`) en el merge que integró el Asistente IA a este mismo archivo — la sección "Notificaciones" de Ajustes quedó con el switch general funcionando pero sin recordatorios por tipo ni resumen diario.
* `renderizarSelectorMoneda()` — pinta el selector custom de `configuracion.moneda_preferida` (mismo patrón `.select-custom` que "Escala de notas") a partir de `MONEDAS_DISPONIBLES` (core/schema.js). **v2.9.2 (2026-08-26, pedido explícito):** se agrega un `<input>` de búsqueda por texto (símbolo, nombre o código ISO, sin distinguir mayúsculas/acentos) pegado arriba de la lista desplegable — con ~50 monedas ya no era práctico desplazarse a mano. El buscador se reparenta a `document.body` junto con la lista (antes solo se reparentaba el `<ul>`) para que viajen juntos al abrir/cerrar, y se limpia solo cada vez que el dropdown se abre.

### config/config-baneados.js
Propósito: placeholder vacío reservado para cuando se construya la sección de Baneados. No llenar de código de otra cosa por error.
Depende de: (ninguno)
Exporta: (nada — solo `export {}`)

### config/config-enlaces.js
Propósito: gestiona los Enlaces rápidos de Configuración — listar, agregar, editar, eliminar y renderizarlos en los distintos contenedores donde aparecen (Configuración, panel lateral, drawer móvil).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js
Exporta:
* `renderizarEnlacesRapidos()` — repinta las 3 listas de enlaces rápidos (Configuración, panel lateral, drawer móvil) y habilita/deshabilita el botón "Agregar" según el límite.
* `renderizarListaEnlacesEn(contenedorId, enlaces, conEditar)` — dibuja una lista de enlaces dentro de un contenedor dado; `conEditar` controla si aparece el lápiz de edición.
* `inicializarModalEnlace()` — engancha los listeners del modal de alta/edición de enlace (pills de tipo de ícono, guardar, cancelar, eliminar).
* `abrirModalEnlace(enlaceId?)` — abre el modal en modo alta o edición (si se pasa un id) y precarga sus datos.
* `cerrarModalEnlace()` — cierra el modal y limpia el id en edición.
* `eliminarEnlaceDesdeModal()` — borra el enlace en edición dejando una tumba en `_eliminados_enlaces` (evita que resucite al sincronizar).
* `guardarEnlaceDesdeModal()` — valida y persiste el enlace (nuevo o editado), sellando timestamp antes de marcar el cambio pendiente.
* `mostrarErrorModalEnlace(mensaje)` — muestra un mensaje de error dentro del modal de enlace.

---

## JS — plan

### plan/plan-categorias.js
Propósito: gestión de categorías personalizadas de materias (crear/editar categorías y asignar/quitar materias de cada una).
Depende de: schema.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista.js
Exporta:
* `abrirModalCategoria(categoria, plan)` — abre el modal de crear/editar categoría; precarga nombre y color si `categoria` viene de editar, o lo deja vacío si es nueva.
* `abrirModalCategoriaMaterias(plan, categoria)` — abre el modal de asignación de materias a una categoría, precargando como seleccionadas las que ya pertenecen a ella.
* `construirPanelCategorias()` — construye la sección del panel de categorías del plan activo.
* `inicializarModalCategoria()` — registra los listeners del modal crear/editar categoría (cancelar, eliminar, guardar).
* `inicializarModalCategoriaMaterias()` — registra los listeners del modal de asignación de materias a categoría.
* `renderizarControlesCategoriaMaterias(plan, categoria)` — renderiza el buscador y los controles de orden dentro del modal de materias por categoría.
* `renderizarListaMateriasCheckbox(plan, categoria)` — renderiza la lista de checkboxes de materias disponibles para asignar/desasignar de la categoría.

### plan/plan-detalle.js
Propósito: construye el contenido de detalle de una materia (tarjeta expandida en la lista y modal flotante) — requisitos, correquisitos, historial de intentos y búsqueda inversa ("Desbloquea"). Reutilizado por `semestres/semestres-tarjetas.js` para la tarjeta de materia matriculada.
Depende de: schema.js, storage.js, storage-sync.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista-tarjetas.js, semestres.js
Exporta:
* `abrirModalDesbloquea(materia, plan)` — abre el modal "Es requisito para:" listando las materias que `materia` desbloquea.
* `abrirModalHistorial(materia, plan)` — abre el modal de historial de intentos de la materia: cruza `materia.id`+`plan.id` contra todos los semestres y muestra cada intento con su estado efectivo.
* `abrirModalRequisito(codigo)` — abre el modal navegable de detalle de una materia a partir de su código.
* `construirBloqueCompletoRequisitos(materia, plan)` — arma el bloque combinado de Requisitos + Correquisitos + etiqueta de cupo original.
* `construirBloqueRequisitos(etiqueta, nodoRaiz, modo)` — construye un bloque individual (Requisitos o Correquisitos) a partir del árbol Y/O; omite el bloque completo si está vacío salvo para "Requisitos".
* `construirBotonesFinalesDetalle(materia, plan, opciones)` — construye la fila de botones finales del detalle (Desbloquea, Historial, etc.), variando según si es modal o tarjeta. Fix 2026-08-21 (bug Mochi): si `opciones.esModal` es true, los botones "Es requisito"/"Historial" cierran `#modal-requisito` antes de abrir Desbloquea/Historial respectivamente (para no dejar dos overlays de modal apilados a la vez) y marcan el flag `volverAModalRequisitoAlCerrar` para que, si Desbloquea/Historial se cierran sin elegir nada, se vuelva a mostrar la tarjeta de origen en vez de quedar sin ningún modal abierto.
* `construirColumnaAccionesTarjeta(materia, plan)` — construye la columna de acciones (badge de categoría y botones) de la tarjeta expandida.
* `construirCuerpoDetalleMateria(materia, plan, opciones)` — punto de entrada que decide si arma el cuerpo en modo "tarjeta" (grid 2 columnas) o "modal" (1 columna).
* `construirCuerpoDetalleModal(materia, plan)` — arma el cuerpo de detalle en el layout de 1 columna usado por el modal flotante.
* `construirCuerpoDetalleTarjeta(materia, plan)` — arma el cuerpo de detalle en el grid de 2 columnas usado por la tarjeta expandida en la lista.
* `construirFilaRequisito(codigo, opciones)` — construye la fila visual de un requisito individual (código de materia + su estado).
* `construirLinea1Materia(materia, plan)` — construye la línea 1 del detalle (Bloque·Código + Categoría).
* `construirLinea2Materia(materia, compacto, plan)` — construye la línea 2 (badge de Estado efectivo + Horas/Créditos), en versión compacta o completa.
* `construirLineaCategoriaMateria(materia, plan)` — construye la línea de badge de categoría de la materia, o `null` si no tiene categoría. Reutilizado por `semestres-tarjetas.js`.
* `construirMetaLineaMateria(materia, plan)` — construye la línea de metadatos "Bloque N · Código" (o "Optativa · Código").
* `construirNodoRequisito(nodo, modo, profundidad)` — renderiza recursivamente un nodo del árbol de requisitos (hoja código, o grupo Y/O).
* `inicializarModalDesbloquea()` — registra los listeners de cierre del modal "Desbloquea".
* `inicializarModalHistorial()` — registra los listeners de cierre del modal de historial.
* `inicializarModalRequisito()` — registra los listeners de "Es requisito", "Historial" y "Cerrar" del modal de requisito.
* `abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, onVinculado)` — abre un overlay para asignar/vincular un profesor a un intento del historial de la materia.
* `registrarAbrirAltaProfesorPreseleccionado(fn)` — registra el callback (definido en comunidad.js) que abre el alta de profesor con datos preseleccionados; evita import circular con comunidad.js.

### plan/plan-esquema.js
Propósito: núcleo de acceso a los planes de estudio (plan activo/secundario, materias visibles/optativas/a revisar) y modales para crear plan / añadir materia manual / vincular optativa. Los getters de este archivo son la base que usa casi todo `plan/`.
Depende de: schema.js, storage-sync.js, storage.js, plan-gestionar.js, plan-importacion-csv.js, plan-vista-lista.js
Exporta:
* `EJEMPLOS_PLACEHOLDER_PLAN` — placeholders de ejemplo de Carrera/Código según universidad (TEC, UCR, etc.) para los inputs del modal de crear plan.
* `LIMITE_PLANES_ESTUDIO` — número máximo de planes de estudio que el usuario puede tener (3).
* `abrirModalCrearPlan(paraSecundario, metadatosDetectados)` — abre el modal de crear plan nuevo, marcando si es el plan secundario y precargando metadatos si vienen de una importación. Si `metadatosDetectados.universidad` no mapea a TEC/UCR, precarga el bloque "Otra" con nombre completo + siglas detectadas (`siglas_universidad`, línea `SIGLAS_UNIVERSIDAD:` del CSV — ver `extraerMetadatosImportacion` en plan-importacion.js); el campo "Otra" arranca vacío si no hay nada detectado (2026-08-22: se eliminó la precarga muerta desde `estado.nombreUniversidadImportacion`/`siglasUniversidadImportacion`, que nunca se asignaban).
* `abrirModalMateriaManual(materiaExistente, planDeLaMateria)` — abre el modal "+ Añadir materia" en modo alta o edición, según si se pasa una materia existente.
* `abrirModalVincularOptativa(materiaTemplate, plan, origen)` — abre el modal para vincular una optativa disponible o una materia a revisar; `origen` indica de cuál arreglo especial viene.
* `actualizarFormatoHorasMateriaManual()` — actualiza los campos de horas del modal de materia manual según los `tipos_horas` del plan activo.
* `aplicarDefaultsUniversidad(universidad)` — aplica los valores por defecto (nombre de bloque, semanas, hora de inicio, etc.) de la universidad elegida a los inputs del modal de crear plan.
* `aplicarPlaceholdersAleatoriosPlan(universidad)` — aplica placeholders aleatorios de ejemplo (Carrera/Código) a los inputs del modal según la universidad.
* `buscarMateriaPorCodigoEnPlanes(codigo)` — busca una materia por código entre todas las materias visibles (plan principal + secundario). Devuelve la fila `{materia, plan, origen}` o `null`.
* `elegirPlaceholderPlan(universidad)` — elige al azar un ejemplo de placeholder de `EJEMPLOS_PLACEHOLDER_PLAN` para la universidad dada.
* `filasFiltradas()` — devuelve las materias visibles filtradas por categoría activa y texto de búsqueda actuales.
* `inicializarModalCrearPlan()` — registra los listeners del modal de crear plan (selector de universidad, guardar, cancelar). El handler de guardar arma `universidad` como `{ nombre_completo, siglas }`: TEC/UCR lo arman solos vía `NOMBRES_UNIVERSIDAD_PRESET`; "Otra" exige ambos campos completos (bloquea con error si falta alguno) — 2026-08-22.
* `inicializarModalMateriaManual()` — registra los listeners del modal de añadir/editar materia manual.
* `inicializarModalVincularOptativa()` — registra los listeners del modal de vincular optativa.
* `mapearUniversidadDetectada(texto)` — infiere el código de universidad (TEC/UCR/Otra) a partir de un texto libre detectado en una importación.
* `obtenerMateriasRevisar()` — devuelve todas las filas `{materia, plan, origen}` de `materias_revisar` del plan principal y secundario.
* `obtenerMateriasVisibles()` — devuelve todas las filas `{materia, plan, origen}` de materias regulares del plan principal y secundario.
* `obtenerOptativasDisponibles()` — devuelve todas las filas `{materia, plan, origen}` de `optativas_disponibles` del plan principal y secundario.
* `obtenerPlanActivo()` — devuelve el plan de estudio marcado como activo (`configuracion.plan_activo_id`), o `null`.
* `obtenerPlanSecundario()` — devuelve el plan secundario de Modo Hardcore.
* **Deuda conocida:** con Modo Hardcore a 3 planes, falta un `obtenerPlanTerciario()` equivalente a `obtenerPlanSecundario()` — hoy nada lo necesita porque `js/semestres/` usa `obtenerPlanesActivos()` de `schema.js` directamente, pero si otro módulo llega a necesitar el plan terciario suelto, falta ese getter acá.

### plan/plan-gestionar.js
Propósito: modal de gestión de planes de estudio (listar, editar info, eliminar, elegir plan secundario/terciario en Modo Hardcore).
Depende de: schema.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-esquema.js, plan-vista-lista.js
Exporta:
* `abrirModalEditarPlanInfo(plan)` — abre el modal de editar info del plan (carrera, universidad, código), precargando los valores actuales.
* `abrirModalGestionPlanes()` — abre el modal de gestión de planes; de paso auto-corrige `plan_activo_secundario_id` si quedó en `null` por datos viejos.
* `eliminarPlanEstudio(planId)` — elimina un plan de estudio del arreglo local y marca la tumba correspondiente para que el borrado se propague por sync.
* `inicializarModalEditarPlanInfo()` — registra los listeners del modal de editar info del plan.
* `inicializarModalGestionPlanes()` — registra los listeners del modal de gestión de planes, incluido el cierre que resetea el mini-panel de importación.
* `recalcularPlanesHardcore(cfg)` — recalcula automáticamente cuáles planes participan como secundario/terciario en Modo Hardcore (todos los que no son el principal, en orden de aparición).
* `renderizarListaGestionPlanes()` — renderiza la lista de planes dentro del modal de gestión.
* `renderizarModoHardcore()` — renderiza los controles de Modo Hardcore; siempre relee `estado.datos.configuracion` fresco en cada handler.
* `renderizarSelectorPlan()` — renderiza el selector de plan activo (o el mensaje de "no tienes ningún plan" si la lista está vacía).

### plan/plan-importacion-csv.js
Propósito: parseo del CSV pegado/generado por IA hacia el modelo de plan de estudios, y su contraparte de serialización (árbol de requisitos, tipos de horas).
Depende de: schema.js, storage-sync.js, storage.js, componentes.js, plan-esquema.js, plan-importacion.js, plan-vista-lista.js
Exporta:
* `actualizarEstadoBotonesEnvioImportacion()` — habilita/deshabilita el botón "Enviar a Claude" según si el modo es "link" y el link está vacío.
* `construirMiniPanelImportacion(plan)` — construye el mini-panel de importación de CSV embebido en el modal de gestión de planes.
* `derivarTiposHorasDeHorasColumnas(horasColumnasCrudo)` — convierte el texto crudo de columnas de horas (ej. "Teoría,Práctica") en un arreglo de tipos de horas.
* `importarCSVEnPlan(textoCSV, planDestino)` — parsea un CSV crudo (extrayendo y descartando sus líneas de metadatos) y vuelca su contenido en `planDestino`.
* `manejarClickImportar(textoCSV)` — handler del botón de importar: valida que haya CSV pegado y dispara el flujo de importación, mostrando errores si falla.
* `materiaPareceOptativa(materia)` — determina si una materia es un cupo de electiva/optativa sin llenar, basado únicamente en `materia.sin_definir`.
* `mostrarErroresImportacion(lista)` — muestra u oculta el bloque de errores de importación de CSV con la lista de mensajes dada.
* `obtenerPalabraOptativa(materia)` — devuelve "electiva" u "optativa" según lo que sugiera el nombre de la materia (puramente cosmético, nunca afecta datos).
* `parsearCSVPlanEstudios(textoCrudo, tiposHoras)` — parsea el CSV completo de un plan según sus `tiposHoras`; devuelve `{materias, electivas, paraRevisar, errores}`.
* `parsearLineaCSV(linea)` — parser de una línea CSV que respeta comillas dobles (para nombres con comas).
* `parsearRequisitoArbol(celdaCruda)` — convierte el texto de una celda de Requisitos/Correquisitos en un árbol Y/O de nodos.
* `serializarRequisitoArbol(nodo)` — convierte un árbol Y/O de requisitos de vuelta a su representación de texto (";" para Y, "/" para O).

### plan/plan-importacion.js
Propósito: flujo de importación asistida por IA (capturas → PDF, prompt de importación, instrucciones, extracción de metadatos) y su panel en el modal de gestión de planes.
Depende de: clipboard.js, schema.js, storage-sync.js, storage.js, componentes.js, plan-esquema.js, plan-gestionar.js, plan-importacion-csv.js, plan-vista-lista.js
Exporta:
* `abrirModalCapturasPDF()` — abre el modal de capturas de pantalla → PDF, limpiando la selección de archivos anterior.
* `abrirModalInstruccionesImportacion(modo, textoPrompt)` — abre el modal de instrucciones previas a ir a Claude, guardando el prompt pendiente.
* `abrirVentanaNueva(url)` — abre una URL en una pestaña nueva simulando un click en un `<a target="_blank">`.
* `cerrarModalCapturasPDF()` — cierra el modal de capturas de pantalla → PDF.
* `cerrarModalInstruccionesImportacion()` — cierra el modal de instrucciones y limpia el prompt pendiente.
* `construirColumnasHoras(tiposHoras)` — arma la lista de columnas de horas para el encabezado del CSV.
* `construirEncabezadoCSV(tiposHoras)` — arma la línea completa de encabezado del CSV (Bloque, Código, Nombre, Créditos, columnas de horas, Requisitos, Correquisitos, SinDefinir).
* `construirInputArchivoCSV(textareaDestino)` — construye el input de archivo para cargar un CSV directamente hacia un textarea destino.
* `construirPanelImportacion()` — construye el panel principal de importación (elegir modo, generar prompt, pegar CSV).
* `construirPromptImportacion(modo, link)` — arma el texto del prompt de importación universal a pegarle a la IA, según el modo (link o capturas).
* `construirTextoInstruccionesImportacion()` — arma el texto paso a paso mostrado en el modal de instrucciones antes de ir a Claude.
* `convertirCapturasAPDF(archivos)` — convierte una lista de imágenes capturadas en un único PDF usando jsPDF.
* `enviarPromptAClaude(texto)` — abre claude.ai/new en pestaña nueva y copia el prompt al portapapeles.
* `extraerMetadatosImportacion(textoCrudo)` — extrae los metadatos (carrera, universidad, código, etc.) de las líneas iniciales de un CSV crudo.
* `inicializarModalCapturasPDF()` — registra los listeners del modal de capturas de pantalla → PDF.
* `inicializarModalInstruccionesImportacion()` — registra los listeners del modal de instrucciones previas a la importación.
* `instruccionesImportacionPendiente` (variable exportada, no constante) — guarda el `{textoPrompt}` pendiente mientras el modal de instrucciones está abierto; se limpia al cerrarlo.

### plan/plan-mapa.js
Propósito: la Vista de Mapa interactivo completa — nodos por materia, colores por estado/categoría, zoom (pellizco / `Ctrl`+rueda / botones), camino de desbloqueo con efecto neón, y exportar el mapa como PNG vía `html2canvas`.
Depende de: storage.js, utils.js, plan-detalle.js, plan-vista-lista-tarjetas.js, plan-vista-lista.js
Exporta:
* `COLOR_ESTADO_MAPA` — mapa de color hexadecimal por estado de materia (pendiente/cursando/aprobado/reprobado/retirado) usado en la Vista de Mapa.
* `abrirSelectorDescargaMapa()` — abre el selector de descarga del mapa como imagen (switches de modo claro/oscuro, tema, con/sin fondo).
* `ajustarZoomMapa(delta, etiquetaEl)` — ajusta el nivel de zoom del mapa (clamp 0.5–2), actualiza el porcentaje mostrado en `etiquetaEl`.
* `aplicarZoomMapa()` — aplica el `estado.zoomMapa` actual como transform sobre el track del mapa.
* `colorNodoMapa(materia, plan)` — devuelve el color de un nodo del mapa, según se coloree por categoría o por estado (`COLOR_ESTADO_MAPA`).
* `construirMapaInteractivo(plan)` — construye el SVG del mapa interactivo con únicamente los bloques numerados reales del plan (excluye Optativas y Revisar).
* `construirNodoMapa(materia, plan)` — construye el nodo visual individual de una materia dentro del mapa.
* `construirTarjetaVista(plan)` — construye la tarjeta contenedora de la Vista de Mapa (controles + SVG), guardando referencias vivas del bloque de controles.
* `dibujarCaminoDesbloqueo(plan)` — dibuja/resalta en el SVG el camino de materias que desbloquea la materia seleccionada.
* `exportarMapaComoPNG(opciones)` — exporta el mapa visible como imagen PNG; `opciones` controla modo claro/oscuro, tema y fondo solo durante la captura.
* `recolorearNodosMapa(plan)` — recorre los nodos ya dibujados y actualiza su color según el estado/categoría actual de cada materia, sin re-renderizar todo.
* **Deuda conocida:** hoy el mapa muestra solo el plan **principal** (no combina Modo Hardcore, que soporta hasta 3 planes); y la Simbología usa 4 estados reales (no existe un 5º estado "Retirada" en `ESTADOS_MATERIA`).

### plan/plan-vista-lista-tarjetas.js
Propósito: construcción de las tarjetas de materia dentro de la lista (bloques numerados y optativas), su disponibilidad según requisitos, y resolución de conflictos de sincronización a nivel de materia/entidad.
Depende de: schema.js, storage-merge.js, storage-sync.js, storage.js, utils.js, componentes.js, plan-detalle.js, plan-esquema.js, plan-vista-lista.js
Exporta:
* `ESTADOS_MATERIA` — lista de los 4 estados posibles de una materia (pendiente/cursando/aprobado/reprobado) con su texto y clase de badge. Reutilizado por `semestres/semestres-tarjetas.js` como misma fuente de verdad.
* `abrirMenuRapidoCategoria(materia, plan, anclaEl)` — abre un popover flotante anclado a `anclaEl` para asignar rápido una categoría a la materia.
* `abrirModalResolverConflicto(materia, plan, onResueltoExtra)` — caso particular de `abrirModalResolverConflictoGenerico` para una materia del plan.
* `abrirModalResolverConflictoGenerico({ entidad, plan, titulo, explicacion, onResuelto, obtenerFresca })` — abre el overlay genérico de resolución de conflicto de sync, mostrando los campos en choque entre la versión local y `_version_alterna`.
* `resolverConflictoDirecto({ obtenerFresca, cual })` — aplica directamente la resolución ("local" o "alterna") de un conflicto sobre la entidad viva, sin pasar por el modal; usado por "resolver todos a la vez".
* `agregarIndicadorConflicto(cardEl, onResolver)` — agrega el indicador visual compacto de "choque de versiones" a una tarjeta.
* `construirBloqueOptativas(filasAgregadas, filasDisponibles, esEscritorio, mostrarOrigen)` — construye el bloque especial de Optativas (agregadas + disponibles para vincular).
* `construirContenidoBloques()` — construye el contenido completo de bloques numerados + optativas + revisar de la lista de materias.
* `construirTarjetaMateria(fila, esEscritorio, mostrarOrigen)` — construye la tarjeta de una materia individual, resolviendo disponibilidad y estado de expansión.
* `construirTarjetaOptativaDisponible(materiaTemplate, plan)` — construye la tarjeta de una optativa disponible para vincular (aún no agregada al plan).
* `estaExpandida(codigo, esEscritorio)` — devuelve si una tarjeta está expandida; si no hay estado guardado, usa `esEscritorio` como default.
* `materiaDisponible(materia, materiasDelPlan)` — evalúa si una materia está disponible (sus requisitos se cumplen) contra el árbol Y/O y el estado "aprobado" de las materias del plan.
* `obtenerMateriasQueDesbloquea(materia, plan)` — devuelve las materias del plan cuyo árbol de requisitos o correquisitos contiene el código de `materia`.

### plan/plan-vista-lista.js
Propósito: orquestador de la Vista de Lista del plan de estudios — encabezado, panel de estadísticas, barra de acciones, expandir/contraer, carrusel entre planes, y el render principal `renderizarPlanEstudios`.
Depende de: schema.js, storage-sync.js, storage.js, utils.js, plan-categorias.js, plan-esquema.js, plan-gestionar.js, plan-modo-edicion.js, plan-importacion-csv.js, plan-importacion.js, plan-mapa.js, plan-vista-lista-tarjetas.js
Exporta:
* `construirAnilloDonut(porcentaje, colorProgreso)` — construye el SVG del anillo tipo donut de progreso (créditos aprobados) del panel de estadísticas.
* `construirBarraAcciones()` — construye la barra de acciones (orden, editar materias, añadir materia, etc.) sobre la lista de materias.
* `construirEncabezadoPlan(planPrincipal)` — construye el encabezado del plan (título, carrera, botones de editar/gestionar).
* `construirPanelEstadisticas(plan)` — construye el panel de estadísticas (materias y créditos totales/aprobados) del plan.
* `contraerTodasLasMaterias()` — marca todas las materias visibles como contraídas y re-renderiza.
* `contraerTodosLosBloques()` — colapsa todos los bloques/grupos actuales y re-renderiza.
* `expandirTodasLasMaterias()` — marca todas las materias visibles como expandidas y re-renderiza.
* `expandirTodosLosBloques()` — vacía el set de bloques colapsados (expande todos) y re-renderiza.
* `exportarPlanACSV(planParam)` — exporta el plan completo a CSV (metadatos + todas las materias, incluidos cupos de electiva sin llenar), en el mismo formato que espera el importador.
* `inicializarResponsivoListaPlan()` — registra el listener de resize que detecta el cruce del breakpoint móvil/escritorio (900px) para re-renderizar la lista cuando cambia.
* `navegarPlanCarrusel(delta)` — cambia el plan activo al siguiente/anterior (`delta` ±1) dentro del carrusel de planes.
* `obtenerClavesAgrupacionActuales()` — devuelve el set de claves de agrupación actuales (por categoría o por bloque, según el orden activo) de las materias visibles.
* `renderizarPlanEstudios()` — punto de entrada principal: vacía y reconstruye `#seccion-plan-estudios` completo (encabezado, estadísticas, barra de acciones, contenido de bloques).

### plan/plan-modo-edicion.js
Propósito: botón "Editar plan", badge fijo "Modo edición" y el ícono de lápiz que aparece en cada tarjeta de materia mientras el modo está activo.
Depende de: storage.js, plan-vista-lista.js
Exporta:
* `alternarModoEdicionPlan()` — invierte `estado.modoEdicionPlan` y refresca el badge y las tarjetas del plan.
* `renderizarBadgeModoEdicion()` — muestra u oculta el badge fijo de la esquina inferior derecha según `estado.modoEdicionPlan`.

---

## JS — semestres

### semestres/semestres.js
Propósito: alta/edición/listado de semestres — formulario completo (nombre, fecha, duración, Modo Hardcore, buscador + filtro por estado, checklist de materias), sincronía Matrícula↔Plan, modo edición (editar/borrar semestres), y el render del listado (dashboard + actuales + pasados) con mecanismo anti-scroll-fantasma.
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, plan/plan-gestionar.js, semestres/semestres-tarjetas.js, semestres/semestres-dashboard.js, main.js (import circular intencional, mismo patrón que ui/componentes.js).
Exporta:
* `abrirModalAltaSemestre(semestreExistente = null)` — abre el modal de alta (o edición, si se pasa un semestre) de un semestre.
* `buscarSemestreVivoPorId(semestreId)` — relee el semestre vigente desde `estado.datos` por id, para evitar referencias huérfanas si un sondeo remoto reemplazó el estado mientras el modal estaba abierto.
* `navegarASemestre(semestreId)` — cambia a la sección Semestres, expande la tarjeta de ese semestre, re-renderiza y hace scroll suave + destello hasta ella.
* `obtenerSemestreAdyacente(semestreId, direccion)` — devuelve el semestre siguiente (`direccion=1`) o anterior (`direccion=-1`) en orden cronológico; envuelve en los extremos. Usado por la navegación con flechas de Horario.
* `obtenerSemestresActuales()` — semestres con estado efectivo `"actual"`, ordenados desc por fecha_inicio.
* `obtenerSemestresOrdenCronologico()` — todos los semestres ordenados asc por fecha_inicio (orden real, sin separar actuales/pasados).
* `obtenerSemestresPasados()` — semestres con estado efectivo `"pasado"`, ordenados desc por fecha_inicio.
* `renderizarSemestres(omitirRestauracionScroll = false)` — punto de entrada de la sección; repinta dashboard académico + listado completo dentro de `#seccion-semestres`.
* `vincularProfesorAMateriaMatriculada(semestreId, mmId, profesorId)` — agrega un profesor a `mm.profesor_ids` de una materia matriculada (usado desde el modal de bloque de Horario).

### semestres/semestres-dashboard.js
Propósito: pestaña contraíble "Historial académico" al inicio de la sección Semestres — estadísticas de aprobación (barra dividida + detalle por estado) y promedio ponderado (por semestre+universidad y por plan/carrera); colapsada por default para no empujar el resto del contenido.
Depende de: core/storage.js, core/utils.js, core/schema.js
Exporta:
* `construirDashboardAcademico(onCambiar)` — arma la tarjeta completa del dashboard (encabezado + selector de vista + vista activa); si está colapsado devuelve solo el encabezado.

### semestres/semestres-tarjetas.js
Propósito: tarjetas de semestre y de materia matriculada — motor de notas completo (criterios, asignaciones, cálculo de nota final en vivo, proyecciones/objetivos, resolución de conflictos de sync) y drag-and-drop de reordenamiento. Es el archivo más grande del proyecto (~3540 líneas); casi todo su contenido son funciones privadas del modal de notas, solo 3 quedan expuestas afuera.
Depende de: core/storage.js, core/utils.js, ui/componentes.js, core/schema.js, core/storage-sync.js, plan/plan-vista-lista-tarjetas.js, plan/plan-detalle.js, plan/plan-vista-lista.js
Exporta:
* `construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar, onEditar, onBorrar, anidada = false)` — construye la tarjeta completa de un semestre (encabezado + sus materias matriculadas), expandible/colapsable.
* `abrirModalTodosLosConflictos()` — abre el modal que lista todos los conflictos de sync pendientes de resolver en Semestres (matrícula, criterio, semestre), con botón para resolver cada uno.
* `registrarAbrirTarjetaProfesorFlotante(fn)` — inyecta (desde `comunidad.js`, al inicializar) la función que abre la tarjeta flotante de un profesor con botón "Ir a Comunidad"; evita un ciclo de imports semestres-tarjetas.js↔comunidad.js.
* **Candidato a dividir:** casi 4.5× el límite de 800 líneas del proyecto — considerar partirlo (ej. un archivo aparte para el motor de notas) antes de seguir agregándole funciones.

---

## JS — finanzas

### finanzas/finanzas.js
Propósito: shell de la sección Finanzas — arma las 4 pestañas (Resumen / Semestres / Gastos generales U / Beneficios) y calcula los totales del Resumen; el CRUD de cada pestaña vive en los otros archivos.
Depende de: core/schema.js, core/storage.js, finanzas-graficas.js, finanzas-gastos.js, finanzas-semestres.js
Exporta:
* `calcularTotalesResumenFinanzas()` — suma costo_matricula (todos los semestres) + costo de cada gasto_u de tipo `"gasto"` (recurrentes: solo lo ya pagado a la fecha) vs. beca_monto + gasto_u de tipo `"ingreso"` (mismo criterio "a la fecha"). **v2.9.2 (2026-08-26):** devuelve `{ totalGastado, totalBecas, totalIngresos, balanceNeto }` (se agrega `totalIngresos`; `balanceNeto = totalBecas + totalIngresos − totalGastado`).
* `formatearFechaLarga(fechaIso)` — convierte `"YYYY-MM-DD"` a `"11 de agosto de 2026"`; vacío/null da `""`.
* `formatearMonto(numero)` — formatea el monto con 2 decimales; para negativos antepone un `"-"` explícito antes del símbolo. **FIX 2026-08-26 (bug reportado por Krys):** el símbolo estaba hardcodeado a `"₡"` y nunca leía la moneda elegida en Ajustes — ahora sale de `obtenerSimboloMonedaActual()`.
* `obtenerSimboloMonedaActual()` — **nuevo (2026-08-26)**, no exportaba antes: resuelve el símbolo de `configuracion.moneda_preferida` contra `MONEDAS_DISPONIBLES` (core/schema.js), con `"₡"` como fallback defensivo. Único punto de verdad del símbolo actual — lo usa también `formatearMontoCompacto` en finanzas-graficas.js.
* `renderizarContenidoFinanzasActivo()` — repinta solo el contenido de la pestaña activa dentro de `#finanzas-contenido`, sin reconstruir el tab bar.
* `renderizarFinanzas()` — punto de entrada de la sección; reconstruye tabs + contenido dentro de `#seccion-finanzas`.

### finanzas/finanzas-graficas.js
Propósito: las 2 gráficas SVG (a mano, sin librería) de la pestaña Resumen — donut "Gastado vs. Disponible" + composición de ingresos (beca vs. ingresos propios) y línea "Por semestre" (Gastos/Beca/Ingresos). **No estaba documentado en una versión anterior de este mapa** pese a existir como archivo propio — se agrega ahora junto con el cambio de ingresos.
Depende de: core/schema.js, core/storage.js, finanzas/finanzas-gastos.js, finanzas/finanzas.js
Exporta:
* `construirGraficasResumenFinanzas(totalBecas, totalIngresos, totalGastado)` — punto de entrada, llamado desde `construirResumenFinanzas` (finanzas.js). **v2.9.2 (2026-08-26):** firma cambia de `(totalBecas, totalGastado)` a `(totalBecas, totalIngresos, totalGastado)` — el donut de 2 segmentos dejó de ser "Beca vs. gastado" para pasar a ser **"Gastado vs. Disponible"** sobre el total de entradas (beca+ingresos) — mezclar entradas y salidas de plata en un solo donut de 3 segmentos no daba una proporción con sentido accionable (decisión tomada junto con el usuario antes de implementar). La composición de esas entradas (cuánto es beca vs. cuánto es ingreso propio) se muestra aparte, como chips de texto, no como otro donut. La línea "Por semestre" gana una 3ra serie ("Ingresos", azul) además de "Gastos" (rojo) y "Beca" (verde, antes llamada "Ingresos" a secas).

### finanzas/finanzas-gastos.js
Propósito: CRUD de gastos y, desde v2.9.2, **ingresos** sueltos no vinculados a un semestre (pestaña "Gastos", simples o recurrentes, con vínculo opcional a semestre) + generador de prompt de descuentos estudiantiles (pestaña "Beneficios").
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/clipboard.js, ui/componentes.js, plan/plan-esquema.js, semestres/semestres.js, finanzas/finanzas.js
Exporta:
* `renderizarPestanaBeneficios(contenedor)` — pinta la pestaña Beneficios: botón(es) para copiar el prompt de descuentos estudiantiles según la(s) universidad(es) del/los plan(es) activo(s), y abrir claude.ai.
* `renderizarPestanaGastosU(contenedor)` — pinta la lista de gastos/ingresos generales U (simples/recurrentes, con badge de monto o de total pagado a la fecha) + botón para abrir el modal de alta/edición. **v2.9.2:** el modal ahora incluye un selector de Tipo (Gasto/Ingreso, pill-group, default "Gasto"); el badge de un registro `tipo:"ingreso"` se pinta de azul (`#3b82f6`, inline — no existe una clase `.badge-*` azul en el proyecto) con un `"+"` adelante, en vez del gris neutro de un gasto normal, para diferenciarlos a simple vista (pedido explícito de Krys).

### finanzas/finanzas-semestres.js
Propósito: pestaña "Semestres" de Finanzas — lista todos los semestres del historial (actuales + pasados) y permite crear/editar su registro financiero (costo de matrícula, monto de beca y desglose mensual del pago, manual o automático). Sin cambios en esta ronda — el campo `tipo` de ingresos vive en `gastos_u`, no en `finanzas_semestre`.
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, ui/componentes.js, semestres/semestres.js, finanzas/finanzas.js
Exporta:
* `renderizarPestanaSemestresFinanzas(contenedor)` — pinta la lista de semestres con su registro financiero (badges de matrícula/beca, o botón "Crear registro" si aún no tiene) y abre el modal de alta/edición al interactuar.

---

## JS — comunidad

### comunidad/comunidad.js
Propósito: sección Comunidad completa (`#seccion-comunidad`) — profesores (alta/edición, calificación general 1-10, "¿volverías a llevarlo?", vinculación a materias por semestre) y compañeros (alta/edición, materias compartidas, importar contacto vía Contacts Picker API).
Depende de: core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, core/clipboard.js, semestres/semestres.js, plan/plan-detalle.js, semestres/semestres-tarjetas.js
Exporta:
* `inicializarComunidad()` — se llama una vez al arranque (antes de un posible `mostrarApp()` por caché); registra en plan-detalle.js y semestres-tarjetas.js los callbacks reales de "abrir alta de profesor" y "abrir tarjeta flotante de profesor" para evitar ciclos de import. No crea nodos nuevos (el contenedor ya viene en index.html).
* `renderizarComunidad()` — reconstruye `#seccion-comunidad` completo (pills Profesores/Compañeros + la lista correspondiente); requiere `estado.datos` ya cargado.
* `abrirModalAltaProfesor(profesorExistente?, preseleccionMmId?, onGuardado?)` — abre el modal de alta/edición de profesor. `preseleccionMmId` precarga una materia matriculada a vincular; `onGuardado` se llama justo después de guardar con éxito.
* **Candidato a dividir:** 3948 líneas, muy por encima del límite de 800 líneas por archivo. Considerar partirlo en `comunidad-profesores.js` / `comunidad-companeros.js` antes de seguir agregándole cosas.

---

## JS — horario

### horario/horario.js
Propósito: renderiza el grid semanal de Horario (vista propia, modo conjunto con amigos y vista individual de un amigo), y expone helpers de formato (color/nombre de bloque, modalidad, profesor) reutilizados por Agenda.
Depende de: schema.js, storage.js, storage-sync.js, componentes.js, config-ajustes.js, semestres.js, plan-esquema.js, horario-modal.js, horario-amigos.js
Exporta:
* `inicializarHorario()` — conecta los botones de la sección Horario (semestre anterior/siguiente, agregar bloque, panel de amigos, pantalla completa, descargar imagen).
* `renderizarHorario()` — repinta el grid completo de Horario (delega en el render interno).
* `obtenerSemestreHorarioActual()` — devuelve el semestre que se está mostrando ahora mismo en Horario (usa `estado.horarioSemestreId` o cae al más reciente no pasado).
* `obtenerColorBloque(bloqueEfectivo)` — color a mostrar para un bloque: color propio del bloque, o si no tiene, el de la categoría de la materia asociada, o violeta por default.
* `obtenerNombreBloque(bloqueEfectivo)` — nombre a mostrar: apodo del bloque, o nombre de la materia vinculada, o `"Personalizado"`/`"Materia"` de fallback.
* `obtenerRangoHorasHorario()` — devuelve `{ horaInicio, horaFin }` (0-24) del rango visible del grid según Ajustes → Horario, con validación de rango inválido.
* `obtenerPlanPorId(planId)` — busca un plan de estudios por id en `estado.datos.planes_estudio`.
* `abrirHorarioConjunto()` *(alias de `activarModoConjunto`)* — activa el modo "Horario conjunto" (superpone los horarios de amigos vinculados) dentro del mismo `#horario-grid`.
* `abrirVistaIndividualAmigo(fileId)` *(alias de `activarVistaIndividualAmigo`)* — reemplaza el grid propio por la vista de solo lectura del horario de un amigo vinculado puntual.
* `abrirTarjetaInfoBloque(semestre, numeroSemana, b)` — abre el overlay con el detalle de una clase efectiva (nombre, semana, modalidad, aula, profesor). Reutilizado por `agenda/agenda-clases.js` para su tarjeta "Mostrar clases".
* `obtenerEmojiModalidad(modalidad)` — emoji para una modalidad (`💻` virtual, `📖` asincrónica, `✖️` sin clase, vacío si presencial).
* `obtenerEtiquetaModalidad(modalidad)` — etiqueta humana para una modalidad, con fallback genérico si el valor no está mapeado.
* `obtenerNombreProfesor(profesorId)` — nombre abreviado del profesor (primer nombre + primer apellido completos, resto a iniciales).
* `fechaLocalDesdeISO(str)` — parsea una fecha `YYYY-MM-DD` a `Date` local (sin desfase de timezone).
* `calcularNumeroSemanaSinAcotarParaFecha(semestre, fecha)` *(re-exportada de `horario-modal.js`, 2026-08-29)* — número de semana del semestre para una fecha puntual, SIN acotar (puede dar <1 o mayor que `duracion_semanas`, a propósito). Reutilizada por `agenda/agenda-clases.js` para su propia `calcularNumeroSemanaParaFecha` (esa sí acotada) y por `asistente/asistente.js` para validar cambios de modalidad por voz/texto. Distinta a propósito de `core/schema.js#calcularNumeroSemanaSemestre` (esa resuelve la semana de HOY únicamente).
* **Candidato a dividir:** 2064 líneas, por encima del límite de 800.

### horario/horario-modal.js
Propósito: modal de alta/edición de un bloque de horario (materia, días/horas, modalidad, color, profesor, notas) y su sub-sección de Cronograma (excepciones puntuales por semana/día).
Depende de: schema.js, storage-sync.js, storage.js, componentes.js, config-ajustes.js, semestres.js, comunidad.js
Exporta:
* `abrirModalBloqueHorario({ semestreId, bloqueId, diaPreseleccionado, horaInicioPreseleccionada, horaFinPreseleccionada, numeroSemanaVista })` — abre el modal para crear un bloque nuevo (con día/hora preseleccionados, ej. desde un click-drag en el grid) o editar uno existente por `bloqueId`.
* `cerrarModalBloqueHorario()` — oculta el modal y limpia el contexto de edición en curso.
* `construirZonaCronograma(semestre, bloque, { semanaInicial })` — arma el bloque colapsable "📅 Cronograma de clases" dentro del formulario, para editar la modalidad de un día puntual de una semana específica sin afectar la plantilla base del bloque.
* `aplicarModalidadDia(bloqueId, semestreId, numeroSemana, diaCodigo, nuevaModalidad)` *(exportada 2026-08-29, antes solo interna)* — aplica o revierte el ajuste puntual de modalidad de un día/semana concreto de un bloque (con tumba real si vuelve a coincidir con la plantilla). La sigue usando `construirZonaCronograma` internamente; ahora también la reutiliza `asistente/asistente.js` para aplicar cambios de modalidad pedidos por voz/texto — mismo camino real, sin lógica duplicada.
* `calcularNumeroSemanaSinAcotarParaFecha(semestre, fechaObjetivo)` *(nueva, 2026-08-29)* — inverso de la fecha-por-semana interna del archivo: dada una fecha real, devuelve su número de semana del semestre, anclado al día real de `fecha_inicio` (no asume que caiga lunes) y SIN acotar entre 1 y `duracion_semanas` a propósito, para poder distinguir "cae fuera del semestre" de "cae en la semana 1/última". Re-exportada vía `horario.js` para `agenda/agenda-clases.js` (que sí necesita la versión acotada, y ahora delega el cálculo crudo acá) y usada directo por `asistente/asistente.js` para resolver cambios de modalidad. **No confundir con `agenda/agenda-clases.js#calcularNumeroSemanaParaFecha`** — incluso siendo casi el mismo nombre, esa acota el resultado y esta no; nunca son intercambiables.
* **Candidato a dividir:** 1038 líneas, por encima del límite de 800.

### horario/horario-amigos.js
Propósito: "Horario entre amigos" del lado de la app con sesión — generar/revocar enlaces compartidos del propio horario, vincular horarios de amigos vía enlace público, y mantener en caché sus snapshots para el modo conjunto y la vista individual.
Depende de: storage.js, storage-sync.js, schema.js, auth.js, componentes.js, clipboard.js, horario.js (helpers de formato/color y las funciones de modo conjunto/vista individual)
Exporta:
* `inicializarHorarioAmigos()` — inicializa el panel de Amigos y pinta la lista de enlaces compartidos propios (corre en el primer `DOMContentLoaded`, antes de tener `estado.token`).
* `abrirPanelAmigos()` — muestra el modal del panel de Amigos y repinta la lista de vinculados.
* `renderizarListaEnlacesCompartidos()` — pinta la lista de enlaces que el usuario generó de su propio horario, ordenados por fecha de creación descendente.
* `procesarAsociacionPendienteDeAmigo()` — lee el pendiente dejado en `localStorage` por horario-amigos-publico.js, lo descarta si expiró o ya estaba vinculado, y si no, dispara la confirmación de vínculo.
* `asignarColorAmigo(semilla)` — color determinístico (hash de la semilla, ej. el file_id) tomado de una paleta fija, para pintar de forma estable el horario de cada amigo.
* `iniciarRefrescoPeriodicoAmigos()` — refresca los snapshots de amigos al llamar y arma un intervalo de 5 min mientras la pestaña siga abierta.
* `obtenerBloquesAmigosPorDia(fecha, diaCodigo)` — bloques de todos los amigos visibles (no ocultos) que caen en un día/fecha real, resolviendo excepciones de cronograma de esa semana.
* `renderizarListaAmigosVinculados()` — pinta la lista de amigos vinculados en el panel; muestra/oculta el botón "Horario conjunto" según si hay al menos uno.
* `obtenerListaAmigosParaDiaConjunto(fecha, diaCodigo)` — para cada amigo vinculado, sus bloques de ese día/fecha ya resueltos (o marca "caída" si su enlace fue revocado). Usado por el modo conjunto en horario.js.
* `refrescarSnapshotsAmigos()` — vuelve a descargar el snapshot público de cada amigo vinculado, actualiza el caché y repinta Horario y la lista de amigos.
* `obtenerSnapshotAmigoPorId(fileId)` — snapshot crudo (+ estado "caída") de un amigo puntual, tal cual está en caché ahora. Usado por la vista individual en horario.js.
* `obtenerDiasConClaseAmigosVinculados()` — unión de todos los códigos de día en los que cualquier amigo vinculado tiene al menos un bloque, sin filtrar por visibilidad. Usado para armar los días navegables del Horario conjunto.
* `calcularNumeroSemanaAmigo(snapshot, fecha)` — número de semana del semestre del amigo para una fecha real dada (`null` si cae fuera de su rango de semestre).

### horario/horario-amigos-publico.js
Propósito: script standalone de `amigos.html` (vista pública del horario compartido, sin sesión). A propósito NO importa nada de `js/core` ni de `js/horario` — porta en modo solo-lectura su propia copia de la matemática del grid (horas, días, clases efectivas por semana) para no cargar el stack de auth/sync/schema. No es un módulo ES: se auto-ejecuta llamando a `iniciar()` al final del archivo.
Depende de: nada del resto de la app (fetch directo a Drive API vía `API_KEY` pública restringida por dominio).
Nota: no exporta nada — todo el archivo es el punto de entrada de la página. Funciones internas relevantes (no exportadas): `iniciar()`, `obtenerFileIdDesdeHash()`, `obtenerSnapshotPublico(fileId)`, `renderizarGridPublico(snapshot)`, `inicializarFlujoAsociar(fileId, snapshot)`, `inicializarPantallaCompletaPublico()`.

---

## JS — agenda

### agenda/agenda.js
Propósito: núcleo de la Agenda — vista Lista (cronológica, agrupada por día), header, filtros (Semanal/Todo, mostrar materias, mostrar días vacíos), selector de semestres, y el despacho entre Lista y Calendario.
Depende de: core/notificaciones-push.js **(2026-08-25: pendiente de cambiar a core/notificaciones-calendario.js — no actualizado en esta sesión, archivo no subido)**, core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, semestres/semestres.js, agenda/agenda-calendario.js, agenda/agenda-clases.js, agenda/agenda-modal.js, agenda/agenda-utils.js
Exporta:
* `inicializarAgenda()` — wiring inicial: modal de evento, botón "+", pills de vista, selector de semestres, filtros.
* `renderizarAgenda()` — entrypoint de render: decide Lista vs Calendario y dispara el render correspondiente. También expuesta como `window.renderizarAgenda` (evita import circular con `agenda-modal.js` y `agenda-calendario.js`).

### agenda/agenda-utils.js
Propósito: helpers puros sin DOM, compartidos entre `agenda.js`, `agenda-clases.js` y `agenda-modal.js` — resolución de semestres seleccionados, cálculo de fechas de semana, formateo y estilos de eventos.
Depende de: config/config-ajustes.js, core/storage.js, core/utils.js, horario/horario.js, semestres/semestres.js
Exporta:
* `esHoyFecha(fecha)` — true si `fecha` es hoy (año/mes/día locales).
* `esTareaVencida(evento)` — true si es tarea sin completar con fecha pasada.
* `formatearFechaISO(fecha)` — Date → "YYYY-MM-DD".
* `formatearHoraAmPm(horaStr)` — "HH:MM" (24h) → "h:mm a.m./p.m.".
* `formatearRangoSemanaAgenda(dias)` — texto compacto del rango de una semana, ej. "12 - 18 ago.".
* `formatearTiempoRestanteHoy(fechaISO)` — texto "Xh Ymin restantes" hasta las 23:59:59 de esa fecha.
* `obtenerCodigoDiaSemana(fecha)` — código canónico de día ("L".."D") de una fecha cualquiera.
* `obtenerDiasSemanaAgenda(offsetSemanas)` — los 7 días de la semana (offset respecto a hoy) con su fecha real resuelta.
* `obtenerDiasSemanaOrdenAgenda()` — `DIAS_SEMANA_CONFIG` rotado según `dia_inicio_semana`, sin filtrar por "días visibles" (Agenda siempre muestra los 7).
* `obtenerEstiloEvento(evento)` — `{etiqueta, claseBadge, colorBorde}` según tipo/estado del evento.
* `obtenerFechaInicioSemanaAgenda(offsetSemanas)` — fecha del primer día de la semana mostrada, anclada a hoy.
* `obtenerInicioSemanaQueContiene(fecha)` — primer día de la semana que contiene una fecha arbitraria (usado por Calendario).
* `obtenerMateriasVinculablesAgenda()` — materias matriculadas de los semestres seleccionados, con nombre desambiguado si hay duplicados.
* `obtenerOffsetSemanaParaFecha(fecha)` — cuántas semanas de offset hay que aplicar a Lista para mostrar la semana de `fecha`.
* `obtenerRangoDiasAgendaTodo(semestre, diasAtras)` — array de días desde hoy (menos `diasAtras`) hasta fin de semestre +2 semanas (u 8 semanas fijas si no hay semestre).
* `obtenerSemestreActivoAgenda()` — el más reciente de los semestres seleccionados (para "Semana N" y fin de rango de "Todo").
* `obtenerSemestresSeleccionadosAgenda()` — resuelve el conjunto de semestres que Agenda muestra (automático o selección explícita), ordenado cronológico ASC.
* `tareaVenceHoy(evento)` — true si es tarea sin completar que vence hoy.

### agenda/agenda-clases.js
Propósito: sección "Materias" inline por día — qué clases del Horario caen ese día, mostradas junto a eventos/tareas/exámenes.
Depende de: core/schema.js, core/storage.js, horario/horario.js, agenda/agenda-utils.js
Exporta:
* `calcularNumeroSemanaParaFecha(semestre, fecha)` — número de semana del semestre para una fecha puntual (no depende de "hoy"), ACOTADA entre 1 y `duracion_semanas` a propósito (el header/detalle de Agenda-Calendario siempre necesita un número válido que mostrar). Revisada 2026-08-29: antes tenía su propia fórmula de "días desde `fecha_inicio` / 7" con `new Date(string)` directo (mismo tipo de bug de zona horaria ya resuelto en `horario.js`, sin el anclaje-a-lunes que ese cálculo sí usa) — ahora delega el cálculo crudo en `horario/horario.js#calcularNumeroSemanaSinAcotarParaFecha` y solo agrega el acotado. **No es la misma función** que esa (ver nota cruzada en `horario-modal.js`): mismo nombre corto por casualidad de historia, comportamiento distinto a propósito.
* `construirSeccionMateriasDia(semestres, fecha, diaCodigo)` — arma el bloque DOM "Materias" del día para varios semestres a la vez; devuelve `null` si no hay nada que mostrar.
* `contarClasesDelDia(semestres, fecha, diaCodigo)` — conteo liviano (sin DOM) de clases ese día, sumado entre todos los semestres — lo usa el Calendario para el indicador 📚.

### agenda/agenda-modal.js
Propósito: modal de alta/edición de EventoAgenda (evento/tarea/examen) y tarjeta de info al tocar un ítem de la lista. Al guardar/borrar/completar, sincroniza el espejo del evento en Google Calendar (ver core/notificaciones-calendario.js).
Depende de: core/notificaciones-push.js **(2026-08-25: pendiente de cambiar a core/notificaciones-calendario.js — llamar a sincronizarEventoCalendario/eliminarEventoCalendarizado en vez de las funciones viejas; no actualizado en esta sesión, archivo no subido)**, core/schema.js, core/storage-sync.js, core/storage.js, core/utils.js, ui/componentes.js, horario/horario.js, agenda/agenda-utils.js
Exporta:
* `abrirModalEventoAgenda({eventoId, fechaDefault, datosIniciales})` — abre el formulario para crear (si `eventoId` es null) o editar un evento. `datosIniciales` (2026-08-22, Asistente IA) precarga un borrador `{tipo, nombre, fecha, hora, notas}` que todavía NO es un evento real (no vive en `estado.datos.agenda`, sin id) — usado por asistente/asistente.js para mostrar lo que Gemini extrajo, editable, antes de confirmar. Nunca coexiste con `eventoId` (una edición real siempre gana); al guardar se crea un evento nuevo normal, el borrador nunca se persiste como tal.
* `abrirTarjetaInfoEventoAgenda(eventoId)` — abre la tarjeta de solo-info de un evento (paso previo al editor).
* `inicializarModalAgendaEvento()` — wiring de ambos modales (pills de tipo, checkbox "todo el día", dropdown de materia, botones guardar/borrar/cerrar).

### agenda/agenda-calendario.js
Propósito: vista Calendario (mensual/semanal) — grid de 7 columnas con vistazo rápido de eventos por día; tocar un día salta a la vista Lista.
Depende de: core/storage.js, ui/componentes.js, agenda/agenda-clases.js, agenda/agenda.js, agenda/agenda-utils.js
Exporta:
* `renderizarCalendarioAgenda()` — entrypoint de render de la vista Calendario (subheader + grid mensual o semanal).

---

## JS — asistente

### asistente/asistente.js
Propósito: chat del Asistente IA (Gemini, clave propia por usuario), con personalidad ("Wapper", 2026-08-29) — convierte lenguaje natural en tareas/exámenes/eventos de Agenda, y desde 2026-08-29 también puede editar la modalidad de una clase puntual en Horario ("cambia mi clase de anatomía del jueves a virtual"), siempre con tarjeta de confirmación explícita antes de aplicar. Incluye dictado por voz (Web Speech API nativa, con fallback a transcripción por Gemini vía MediaRecorder en navegadores sin backend de voz confiable) e historial de conversación en `localStorage` del dispositivo, vigente 1 hora. Todo el texto de interfaz usa tú (nunca vos/usted).
Depende de: core/storage.js, core/schema.js, core/storage-sync.js, core/notificaciones-push.js, ui/componentes.js, agenda/agenda-modal.js, agenda/agenda-utils.js, horario/horario.js, horario/horario-modal.js, config/config-ajustes.js
Exporta:
* `renderizarAsistente()` — entrypoint de render (llamado por `mostrarSeccion("asistente")`, main.js); si no hay clave de Gemini guardada, muestra aviso con acceso directo a Ajustes en vez del chat. Si hay una conversación reciente (<1h) guardada en este dispositivo, ofrece continuarla o arrancar una nueva.
* `transcribirBase64ConGemini(base64, mimeType)` — transcribe audio ya en base64 a texto plano vía Gemini (mismo modelo/clave que la extracción). Reutilizada por `asistente-bandeja.js` (audio recibido directo del Worker, sin Blob real del que partir).
* `extraerEventosDeTexto(texto)` — variante STATELESS de la extracción (sin leer/tocar el historial visible del chat en pantalla): un solo turno aislado, para procesar ítems de la Bandeja pendiente sin mezclarlos con una conversación en vivo.
* `guardarItemExtraidoComoEvento(item)` — crea el `EventoAgenda` real (`core/schema.js#crearEventoAgenda`) a partir de un ítem ya extraído por Gemini, con recordatorio push si aplica.
* `mensajeParaError(e)` — texto de error listo para UI según `e.tipoError` ("clave" | "limite" | "red" | desconocido).

**Editar modalidad por voz/texto (2026-08-29, no exportado — funciones internas):**
* El prompt de extracción (`construirSystemInstruction`) ahora pide a Gemini un campo discriminador `accion: "crear_eventos" | "editar_modalidad" | "consultar"`, con `cambioModalidad {materia, dia, modalidadNueva}` o `consulta {tipo, semana, materia, dia}` según corresponda. Gemini nunca decide materia/día por sí solo si hay ambigüedad — devuelve `aclaracion` en vez de adivinar (mismo principio anti-alucinación que ya usaba la extracción de eventos).
* `resolverCambioModalidad(cambioModalidad)` — revalida lo que devolvió Gemini contra datos reales de Horario (materia vinculada, día con clase real, modalidad válida) y calcula la próxima fecha/semana real del cambio vía `horario/horario-modal.js#calcularNumeroSemanaSinAcotarParaFecha`.
* `crearTarjetaConfirmacionModalidad(resuelto, estadoInicial, onDecision)` — tarjeta "Aplicar cambio"/"Cancelar"; el cambio real (`horario/horario-modal.js#aplicarModalidadDia`) solo se dispara al tocar "Aplicar cambio", nunca antes.
* El estado de esa decisión (`pendiente`/`aplicado`/`cancelado`) y la resolución ya congelada (`cambioModalidadResuelto`, serializada sin objetos `Date`) se guardan en el turno del historial local, para que reabrir el chat dentro de la 1h de vigencia muestre la tarjeta en su estado real sin poder re-aplicarla.

**Consultar (2026-08-29, no exportado — corrige bug real: preguntas de solo lectura, ej. "qué tareas tengo esta semana"/"qué modalidad es mi próxima clase de bd"/"cuándo es el tercer parcial de cálculo"/"cuántos días faltan para el 3 parcial de cálculo", caían al fallback conversacional de Wapper sin acceso real a los datos):**
* `resolverRangoConsulta(numeroSemana)` — rango de fechas (inicio/fin, ambos inclusive) para una consulta de tareas/eventos GENERAL (tipo `tareas_eventos`): si `numeroSemana` viene explícito, calcula sobre el semestre activo (`obtenerSemestreActivoAgenda`, agenda-utils.js) con la misma fórmula que usa la tabla de semanas del prompt; si no, usa `obtenerFechaInicioSemanaAgenda(0)` (agenda-utils.js) — la MISMA noción de "esta semana" que ya usa la vista Lista de Agenda.
* `resolverConsultaTareasEventos(consulta)` — filtra `estado.datos.agenda` por el rango de `resolverRangoConsulta` y, opcionalmente, por materia (`resolverMateriaVinculada`).
* `resolverBusquedaEvento(consulta)` — tipo `buscar_evento`: busca UN ítem puntual por nombre (ej. "el tercer parcial de cálculo", "el laboratorio 4 de bd") en TODO `estado.datos.agenda`, sin límite de fecha — filtra por materia/tipo de ítem/palabras clave del título, y usa `numeroOrdinal` (convertido de dígito, palabra ordinal o número romano — "Parcial I" = "primer parcial" = "Parcial 1", ver `nombreEventoMencionaNumero`/`PALABRAS_ORDINALES_A_NUMERO`/`NUMEROS_A_ROMANO`) SOLO para desempatar si hay más de un candidato, nunca para descartar el único resultado que ya matcheó por texto.
* `resolverConsultaModalidad(materiaNombre, diaNombreOpcional)` — SOLO LECTURA: busca la próxima clase real de esa materia y su modalidad EFECTIVA de esa semana puntual (`obtenerClasesEfectivasSemana`, `core/schema.js` — fusiona la plantilla con la excepción de Cronograma, importada directo en `asistente.js` igual que ya hace `horario.js`; `numeroSemana` calculado con la misma `calcularNumeroSemanaSinAcotarParaFecha` que ya usa `resolverCambioModalidad`). Resuelto 2026-08-29: ya no lee solo la modalidad de plantilla — si esa semana tiene una excepción aplicada (por ejemplo vía `editar_modalidad`), la consulta refleja el cambio real.
* `formatearDiasFaltantes(fechaEventoIso)` — "faltan N días" / "es hoy" / "fue hace N días", recalculado en vivo (nunca congelado) contra la fecha real de hoy. Se agrega SIEMPRE que `buscar_evento` devuelve un único resultado (decisión de diseño: no se agregó un campo nuevo al esquema de Gemini para distinguir "cuándo es" de "cuántos días faltan", ambas frases resuelven al mismo `buscar_evento` y la cuenta de días no molesta aunque no se haya pedido explícitamente).
* `mostrarResultadoConsultaEnChat(resultado, turno)` — para `tareas_eventos`/`buscar_evento`, pinta los eventos encontrados con `crearTarjetaEventoGuardado` (la MISMA tarjeta editable/borrable que usa la creación); para `modalidad_clase`, un texto corto de solo lectura. Los ids/resolución quedan congelados en `turno.consultaEventoIds` / `turno.consultaEsBusqueda` / `turno.consultaRangoTexto` / `turno.consultaModalidadResuelto` (mismo patrón que `eventosGuardados`/`cambioModalidadResuelto`) para que reabrir el chat no vuelva a llamar a Gemini — excepto `formatearDiasFaltantes`, que se recalcula cada vez que se pinta.


**Personalidad "Wapper" (2026-08-29, no exportado — funciones/constantes internas):** ajuste de tono, separado A PROPÓSITO del prompt de extracción (`construirSystemInstruction`/`ESQUEMA_RESPUESTA_GEMINI`, que sigue frío y preciso, sin tocar).
* `MENSAJE_BIENVENIDA_WAPPER` + `mostrarSaludoInicial()` — texto fijo de bienvenida ("Soy Wapper…") más UNA sola línea "Ejemplo: …" en texto plano (sin botón), elegida al azar por `elegirEjemploBienvenidaAlAzar()` entre las 12 plantillas de `PLANTILLAS_EJEMPLOS_BIENVENIDA_WAPPER` ya resueltas por `construirEjemplosBienvenida()`. Corrección 2026-08-29: reemplaza la fila de chips clicables (`crearChipEjemplo`, eliminada) — nunca se muestran las 12 a la vez ni son seleccionables. El placeholder del input (`construirEsqueletoAsistente`) usa la misma función para su propio random independiente, reemplazando el placeholder fijo anterior.
* `obtenerNombresMateriasParaEjemplosBienvenida()` — reutiliza `obtenerMateriasVinculablesAgenda()` (agenda/agenda-utils.js, la misma fuente que ya usa `construirSystemInstruction` para saber qué materias existen) para las materias reales matriculadas; si no hay ninguna, cae a `MATERIAS_GENERICAS_RESPALDO` (anatomía/historia/química/cálculo/estadística/física). Nunca mezcla ambas listas a medias — si hay menos materias reales que huecos, se repiten rotando.
* `esSaludoSimple(texto)` — detecta un saludo SIN contenido adicional (regex sobre texto normalizado); si matchea, `manejarEnvioMensaje` responde con `MENSAJE_SALUDO_WAPPER` sin llamar a Gemini en absoluto (punto 4 del brief: "sin intentar extraer nada").
* `PROMPT_PERSONALIDAD_WAPPER` + `generarRespuestaConversacionalWapper(textoUsuario)` — llamada APARTE a Gemini (mismo modelo/clave, sin `responseSchema`, texto libre) usada SOLO cuando la extracción normal devuelve `items: []` sin `aclaracion` (charla suelta sin tarea/examen/evento reconocible). El resultado se congela en `turno.respuestaConversacional` (mismo patrón que `eventosGuardados`/`cambioModalidadResuelto`) para que reconstruir el historial no vuelva a llamar a Gemini; si la llamada falla o no hay `textoUsuario` (reconstrucción), cae a `MENSAJE_FALLBACK_WAPPER` estático.
* `mostrarResultadoEnChat`/`mostrarResultadoEventosEnChat` — ahora `async`, con una rama nueva `accion === "saludo"` (marcador puramente local, nunca lo devuelve Gemini — el schema solo admite `crear_eventos`/`editar_modalidad`) y la rama de fallback reescrita para usar `generarRespuestaConversacionalWapper` en vez de un mensaje estático fijo.

**Archivo relacionado no documentado en esta ronda:** `asistente/asistente-bandeja.js` (Bandeja pendiente / Captura por voz, 2026-08-23) — consume `transcribirBase64ConGemini`, `extraerEventosDeTexto` y `guardarItemExtraidoComoEvento` de este archivo. No subido en esta sesión; pendiente de documentar cuando se revise. Nota: no se sabe si ya usa alguna respuesta de Wapper para su propio flujo — al revisarlo, confirmar si conviene que la Bandeja también hable en su voz o si debe seguir siendo puramente silenciosa (sin turno de chat visible).

---

## JS — resumen

### resumen/resumen.js
Propósito: primera sección de la app — vista de solo lectura que agrega Semana actual, Clases de hoy, Tareas de hoy, Próximas tareas, Exámenes próximos y Próximo evento, leyendo directo de `estado.datos.agenda` y reutilizando funciones ya existentes de `agenda/agenda-utils.js`, `agenda/agenda-clases.js`, `agenda/agenda.js` (`construirItemEvento`) y `core/schema.js`. Sin modelo de datos propio, sin modales, sin edición — tocar un ítem abre la tarjeta de info que ya existe en Agenda (`abrirTarjetaInfoEventoAgenda`, llamada indirectamente vía `construirItemEvento`).
Depende de: core/schema.js, core/storage.js, agenda/agenda.js, agenda/agenda-clases.js, agenda/agenda-utils.js
Exporta:
* `inicializarResumen()` — no-op por ahora (Resumen no tiene controles propios que cablear); se mantiene por consistencia con el patrón `inicializarX()`/`renderizarX()` que `main.js` espera de cada sección.
* `renderizarResumen()` — entrypoint de render: reconstruye las 6 secciones de golpe, ocultando cada una si no tiene contenido, y mostrando un mensaje de "día tranquilo" si ninguna tiene nada. También expuesta como `window.renderizarResumen` (mismo patrón que `window.renderizarAgenda`/`window.renderizarHorario`) para que otros módulos puedan refrescar Resumen tras guardar datos, sin import circular.

---

## js/main.js

Propósito: orquestador raíz de la app — arranque, login/logout, navegación entre secciones y renderizado del perfil de usuario. Importa e inicializa el resto de módulos.
Depende de: config-ajustes.js, config-enlaces.js, auth.js, notificaciones-push.js **(2026-08-25: pendiente de cambiar a notificaciones-calendario.js — no actualizado en esta sesión, archivo no subido)**, schema.js, storage-merge.js, storage-sync.js, storage.js, utils.js, comunidad.js, finanzas.js, plan-categorias.js, plan-detalle.js, plan-esquema.js, plan-gestionar.js, plan-importacion.js, plan-vista-lista.js, semestres.js, agenda.js, horario.js, horario-amigos.js, componentes.js, tema.js
Exporta:
* `programarAvisoLoginBloqueado()` — arma un timeout de 6s que muestra el aviso "no se pudo abrir el login" (VPN/bloqueador de anuncios/extensión de privacidad).
* `ocultarAvisoLoginBloqueado()` — cancela ese timeout y oculta tanto el aviso de login bloqueado como el de permiso rechazado.
* `onLoginExitoso(token, expiresIn)` — flujo posterior a un login exitoso de Google: guarda el token activo, resuelve `authListo`, pide almacenamiento persistente al navegador, continúa la carga de datos y, si la cuenta es nueva (`esArchivoNuevo`), ofrece activar la sincronización con Google Calendar (`ofrecerActivarSincronizacionCalendario`, core/notificaciones-calendario.js — 2026-08-25, reemplaza a `ofrecerActivarNotificacionesPush`; este archivo no se tocó en la sesión de la migración, actualizar el import).
* `mostrarApp()` — oculta la pantalla de login y muestra el shell de la app; aplica la paleta/tema guardado, renderiza el selector de plan y, si la URL trae `?abrir=agenda` (llegó de tocar una notificación push), salta directo a la sección Agenda. Al final llama a `revisarUniversidadesIncompletas()`.
* `inicializarModalCompletarUniversidades()` (2026-08-22) — registra el listener del botón "Guardar" de `#modal-completar-universidades`; guarda nombre_completo+siglas de cada plan incompleto y solo se habilita cuando todas las filas tienen ambos campos llenos.
* `revisarUniversidadesIncompletas()` (2026-08-22) — recorre `estado.datos.planes_estudio` buscando planes con `universidad.siglas === ""` (dejados así por `migrarDatosAntiguos` al migrar un `universidad` string viejo); si encuentra alguno, arma las filas dinámicas en `#lista-completar-universidades` y abre el modal bloqueante `#modal-completar-universidades` (excluido del cierre automático por "X"/click-afuera en componentes.js — no se puede posponer). Se llama al final de `mostrarApp()`.
* `pedirConfirmacionCerrarSesion()` — cierra el popover de perfil; si hay cambios sin sincronizar pide confirmación antes de cerrar sesión, si no cierra directo.
* `cerrarSesion()` — limpia token, caché local y estado en memoria; vuelve a mostrar la pantalla de login.
* `CLAVE_SECCION_ACTIVA` — clave de `localStorage` (`"seccion_activa_v1"`) donde se persiste qué sección de navegación quedó activa.
* `inicializarNavegacionSecciones()` — conecta los botones `.btn-nav[data-seccion]` para que llamen a `mostrarSeccion`.
* `mostrarSeccion(nombre)` — cambia la sección visible del app-shell (configuración, plan-estudios, semestres, comunidad, etc.) y persiste la elección. Incluye `"asistente"` (2026-08-22) — al entrar llama a `window.renderizarAsistente?.()` (asistente/asistente.js) para reconstruir la conversación en blanco cada vez (no se persiste historial).
* `aplicarVisibilidadBotonAsistente()` (revisado 2026-08-22) — disparador delgado: llama a `aplicarVisibilidadNavegacion()` (recalcula mostrar/ocultar/orden de TODO el nav, incluyendo el gate de existencia de "asistente") y a `window.renderizarNavegacionOculta?.()` (config-ajustes.js, refresca en vivo la lista de switches de Ajustes > Navegación si está montada). Se llama desde `mostrarApp()` y desde `inicializarAsistenteAjustes()` (config-ajustes.js) cada vez que se guarda/borra la clave.
* `aplicarVisibilidadNavegacion()` (main.js, revisado 2026-08-22) — muestra/oculta/reordena todos los `.btn-nav[data-seccion]` según `configuracion.navegacion_oculta`/`navegacion_orden`. "asistente" participa de este mismo sistema como cualquier otra sección (está en `DEFAULT_ORDEN_NAV` y en `SECCIONES_TOGGLEABLES`), con un gate de EXISTENCIA adicional por encima: se oculta sin importar `navegacion_oculta` si no hay `configuracion.gemini_api_key` guardada. La preferencia de orden/visibilidad del usuario para "asistente" nunca se pierde, solo se re-aplica en cuanto vuelve a haber clave.
* `renderizarNavegacionOculta()` (config-ajustes.js, revisado 2026-08-22) — dibuja la lista de switches arrastrables de Ajustes > Navegación a partir de `SECCIONES_TOGGLEABLES` y `window.obtenerOrdenNavegacion()`. Omite la fila de "asistente" si no hay `configuracion.gemini_api_key` (mismo gate de existencia que el nav real), sin tocar su preferencia guardada. Expuesta en `window` para que `aplicarVisibilidadBotonAsistente()` (main.js) la refresque sin import circular.
* `temporizadorAvisoLogin` — id del `setTimeout` de `programarAvisoLoginBloqueado`, expuesto para que otros módulos puedan limpiarlo (ej. al cerrar sesión).
* `renderizarPerfil()` — pinta nombre, correo, foto/iniciales del perfil en el header y en el popover; maneja el fallback si la foto no carga.
* `togglePerfilPopover(forzarCerrado)` — abre/cierra el popover de perfil (o lo fuerza a cerrado si se pasa `true`).
* Listener de `serviceWorker.addEventListener("message", ...)` — si el service worker avisa que se tocó una notificación push con la app ya abierta en una pestaña, salta a la sección Agenda sin recargar.

---

## Patrones transversales (todo el proyecto)

- **Sincronización:** todo objeto persistido usa reloj de Lamport (`sellarTimestamp`/`observarRelojLogico` en `core/schema.js`) — nunca `Date.now()` directo. `_version_base` guarda el contador previo para que `storage-merge.js` distinga edición secuencial de conflicto real.
- **Borrado = tumba:** nunca se hace `delete` directo — cada colección plana o anidada que se puede borrar tiene su propio arreglo `_eliminados_<coleccion>`, inicializado explícito desde `crearDatosUsuarioNuevo()`. Un borrado se agrega ahí y se filtra del arreglo vivo, para que el merge de sync sepa que fue intencional y no lo "resucite" desde un dispositivo desactualizado.
- **Fusión de colecciones:** cualquier colección nueva con `id` propio se funde con `fusionarColeccion()` genérica (`storage-merge.js`) — no escribir lógica de fusión nueva por tipo de entidad salvo que tenga sub-colecciones anidadas propias (ver `fusionarPlan`/`fusionarSemestre`/`fusionarCriterio`/`fusionarBloqueHorario` como patrón a replicar).
- **Relectura de entidad viva:** antes de mutar algo que vino de un closure (ej. abierto en un modal), se vuelve a buscar por id en `estado.datos` — un sondeo remoto puede haber reemplazado el objeto mientras tanto.
- **Límite de 800 líneas por archivo:** si un archivo se acerca al límite, se separa por responsabilidad (ver cómo se partió Agenda en núcleo/utils/clases/modal/calendario, y Storage en storage/storage-sync/storage-merge/storage-adjuntos). Archivos que ya superan el límite y son candidatos a dividirse en un próximo prompt: `comunidad/comunidad.js` (3948), `semestres/semestres-tarjetas.js` (~3540), `horario/horario.js` (2064), `horario/horario-modal.js` (1038).
- **Imports circulares intencionales:** varios módulos se importan entre sí en ambas direcciones a propósito (ver lista completa y la razón de cada uno en `ARQUITECTURA.md`, sección "Imports circulares"). Es seguro en módulos ES mientras el nombre importado solo se use *dentro* de una función, nunca en el nivel superior del archivo. Si una IA nueva ve esto y quiere "arreglarlo" separando más archivos, no hace falta — ya funciona así a propósito.
- **Worker de Cloudflare (proyecto separado, `worker-notificaciones-agenda`):** 2026-08-25 — se le quitó TODO lo de Web Push/recordatorios/resumen diario/D1/Cron; solo le queda el relevo de OAuth (`/oauth/exchange`, `/oauth/refresh`). La sincronización de Agenda con Google Calendar ya no pasa por él — el cliente habla directo con la API de Calendar (ver `core/notificaciones-calendario.js`, `core/auth.js`).
- **Índice vivo:** cualquier prompt que cree un archivo nuevo o agregue/quite funciones exportadas a uno existente debe actualizar también su entrada correspondiente acá, en `MAPA_FUNCIONES.md` (y en `ARQUITECTURA.md` si cambia una capa o el cheat-sheet de "¿dónde va cada cosa?").
