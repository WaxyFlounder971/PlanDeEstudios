# MAPA_FUNCIONES.md

Índice de referencia rápida de qué exporta cada archivo `.js` del proyecto y para qué sirve, para no tener que leer/grepear archivos completos en cada prompt. Solo se documentan **exports** (lo que otros archivos pueden usar) — funciones privadas internas no aparecen acá.

> Progreso: bloque **Core** completo (9/9). Pendientes: Plan, Semestres, Comunidad, Horario, Agenda, Config (resto), UI.

---

## JS — Core

### js/core/auth.js
**Propósito:** Toda la integración con Google (login/token) y con la API de Google Drive (crear, leer, escribir, copiar, mover, renombrar y borrar archivos/carpetas/permisos) — es la única capa que habla HTTP con Google.
**Depende de:** schema.js (`crearDatosUsuarioNuevo`)
**Exporta:**
* `NOMBRE_CARPETA_BACKUP` — constante `"AppAcademica"`, nombre de la carpeta de Drive donde vive el backup rotativo.
* `inicializarGoogleAuth({ alObtenerToken, alListo, alFallar, alRechazarPermiso })` — arranca el cliente de Google Identity al cargar la página; llama a los callbacks según el resultado.
* `iniciarSesionConGoogle()` — dispara la ventana de login/consentimiento de Google (debe llamarse directo desde un click, sin await antes).
* `obtenerPerfilGoogle(token)` — pide nombre y foto de perfil a Google. Devuelve `{ nombre, foto_url }` o `null` si falla.
* `cerrarSesionGoogle()` — revoca el token en memoria (no borra datos locales, eso lo hace storage.js/main.js).
* `buscarOCrearArchivoDatos(token)` — busca el JSON central de la app en Drive; si no existe lo crea con datos de fábrica. Devuelve `{ fileId, datos }`.
* `crearArchivoDatos(token, datos)` — (no exportada explícitamente, ver `crearArchivoJsonEnDrive` para la versión genérica reutilizable).
* `crearArchivoJsonEnDrive(token, nombreArchivo, datos)` — versión genérica de creación de archivo JSON en Drive con nombre/contenido arbitrarios (usada para horarios compartidos públicos).
* `crearPermisoPublicoLectura(token, fileId)` — aplica permiso público de solo lectura sobre un archivo. Devuelve `{ id }` (el `permissionId` a guardar para poder revocarlo).
* `eliminarPermisoDrive(token, fileId, permissionId)` — revoca un permiso público (botón "Revocar" de un enlace compartido); un 404 cuenta como éxito.
* `leerDatos(token, fileId)` — descarga y parsea el JSON completo de un archivo de Drive.
* `obtenerMetadatosArchivo(token, fileId)` — pide solo `modifiedTime` de un archivo (llamada barata para sondeo de cambios remotos).
* `guardarDatos(token, fileId, datos)` — sobrescribe el archivo de datos en Drive con el objeto completo; valida `respuesta.ok` y lanza si falla.
* `refrescarAccessTokenGoogle(correoConocido)` — pide un access_token nuevo de forma silenciosa (sin prompt), usado tras un 401. Devuelve una Promise.
* `subirArchivoBinarioADrive(token, archivo)` — sube un `File`/`Blob` arbitrario (adjuntos) como archivo nuevo e independiente en Drive.
* `descargarArchivoBinarioDeDrive(token, driveFileId)` — descarga el contenido real de un adjunto por demanda.
* `eliminarArchivoDeDriveConId(token, driveFileId)` — borra el archivo real de Drive de un adjunto eliminado; 404 cuenta como éxito.
* `buscarOCrearCarpetaEnDrive(token, nombreCarpeta)` — busca (o crea) una carpeta visible para la app (scope `drive.file`). Devuelve el `folderId`.
* `buscarArchivoEnCarpeta(token, folderId, nombreArchivo)` — busca un archivo por nombre dentro de una carpeta puntual. Devuelve su `fileId` o `null`.
* `renombrarArchivoDrive(token, fileId, nuevoNombre)` — renombra un archivo sin tocar su contenido (solo metadata).
* `copiarArchivoDrive(token, fileId, nombreCopia, folderId)` — copia un archivo existente del lado del servidor de Google (sin bajar/subir bytes).
* `moverArchivoAlaCarpeta(token, fileId, folderIdDestino)` — mueve un archivo existente a una carpeta, mismo `fileId`, sin tocar contenido.

### js/core/clipboard.js
**Propósito:** Blindaje del flujo "copiar prompt al portapapeles" (usado en "Enviar a Claude/ChatGPT") — garantiza que el usuario siempre se entera si la copia falló y siempre tiene una forma manual de recuperarse.
**Depende de:** storage.js (`estado`), ui/componentes.js (`mostrarToast`)
**Exporta:**
* `comprobarPermisoPortapapelesAlIniciar()` — se llama una vez tras un login exitoso; guarda en `estado.permisoPortapapeles` el estado del permiso ("otorgado"/"denegado"/"desconocido").
* `copiarAlPortapapelesBlindado(texto)` — intenta copiar con `navigator.clipboard.writeText`, y si falla usa `execCommand("copy")` como respaldo. Devuelve `true`/`false` real (nunca falla en silencio).
* `copiarPromptConAviso(texto)` — punto único que debe usar el resto de la app para copiar el prompt de importación: muestra toast si funcionó, o abre el modal de copia manual si falló por completo.
* `abrirModalCopiaManualPortapapeles(texto)` — construye (si hace falta) y muestra un modal con un textarea de solo lectura ya seleccionado, como último recurso de copia manual.

### js/core/schema.js
**Propósito:** El mapa de referencia completo del modelo de datos de la app — factories (`crear*`) para cada entidad, migraciones de esquema, el reloj lógico (Lamport) para sincronización, y todo el motor de cálculo de notas/promedios/finanzas. Es el archivo más grande y más importado del proyecto.
**Depende de:** ninguno (archivo base, sin imports).
**Exporta:**

*Datos de usuario y migraciones:*
* `crearDatosUsuarioNuevo()` — objeto de datos "vacío" para un usuario que inicia sesión por primera vez (estructura completa de fábrica).
* `migrarDatosAntiguos(datos)` — corre todas las migraciones de esquema necesarias sobre datos ya existentes, de forma idempotente, antes de renderizar nada.
* `MAPEO_HORAS_VIEJO_A_NUEVO` — tabla de migración del modelo viejo de horas fijo al modelo dinámico de `tipos_horas`.

*Reloj lógico / sincronización (Lamport):*
* `obtenerDispositivoId()` — id único y estable de este navegador/dispositivo (persiste en localStorage), usado como desempate determinista.
* `observarRelojLogico(valorAjeno)` — adelanta el reloj lógico propio al ver un contador ajeno mayor (regla estándar de Lamport).
* `sellarTimestamp(entidad)` — sella una entidad con el contador lógico, el id de dispositivo y `_version_base` (el contador previo, para distinguir edición secuencial de conflicto real).

*Enlaces rápidos / adjuntos:*
* `crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor })` — estructura de un enlace rápido (máx. 20).
* `LIMITE_ENLACES_RAPIDOS` — tope de enlaces rápidos por usuario (20).
* `crearAdjunto({ nombre, mimeType, tamanoBytes, entidadTipo, entidadId })` — referencia liviana de un adjunto (el binario real vive aparte en Drive, ver storage-adjuntos.js).
* `LIMITE_MB_ADJUNTO` — tamaño máximo por adjunto en MB (25).

*Plan de Estudios:*
* `crearPlanEstudio({ nombre_carrera, universidad, codigo_plan, tipo_titulo, parametros_universidad })` — crea un Plan de Estudios nuevo.
* `crearMateria({ codigo, nombre, creditos, horas, tiposHoras, bloque, requisitos, correquisitos, esOptativa, sinDefinir })` — crea una materia a partir de una fila de CSV o del formulario manual.
* `crearCategoria({ nombre, color })` — crea una categoría de materias (con timestamp sellado).
* `PARAMETROS_UNIVERSIDAD_DEFAULT` — valores sugeridos por universidad (tipos de horas, etc.).
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
* `obtenerPlanesActivos(configuracion)` — ids de los planes activos ahora mismo, según Modo Hardcore.
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
* `obtenerFraccionNota(nota, escalaId)` / `notaMinimaParaFraccion(fraccion, escalaId)` — conversión nota↔fracción (0-1) para poder comparar/simular entre escalas distintas.
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
* `calcularPromedioPorSemestreYUniversidad(datos)` / `calcularPromedioPorPlan(datos)` / `calcularPromedioTotalCombinado(datos)` — los 3 niveles de promedio del dashboard (por semestre+universidad, por plan/carrera, combinado total).
* `calcularEstadisticasAprobacion(datos, planId)` — % de cursos aprobados/reprobados (solo materias cerradas).
* `calcularDetallePorEstado(datos, planId)` — conteo por los 4 estados manuales del Plan (Aprobada/Cursando/Reprobada/Pendiente).

*Finanzas:*
* `crearRegistroFinancieroSemestre({ semestreId, costoMatricula, becaMonto })` — registro financiero de un semestre.
* `crearGastoU({ nombre, costo, nota, semestreId, recurrente })` — gasto general de universidad, con soporte para gastos recurrentes.
* `calcularPagosRecurrentesTranscurridos(recurrente)` — cuenta cuántos pagos de un gasto recurrente ya cayeron hasta hoy (nunca futuros).
* `crearBackupDriveDefault()` — objeto default de `configuracion.backup_drive`.
* `FRECUENCIAS_BACKUP_DRIVE` — opciones de frecuencia de backup rotativo (diaria..mensual, con sus días de intervalo).
* `MONEDAS_DISPONIBLES` — catálogo de monedas con símbolo, para el selector global de moneda.
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
* `crearEventoAgenda({ tipo, nombre, fecha, hora, materiaMatriculadaId, semestreId, notas, esFeriado })` — crea un evento/tarea/examen de agenda, ya sellado.

*Comunidad:*
* `crearProfesor({ nombre, materias, correo, telefono })` / `crearCompanero({ nombre_completo, carnet, lista, materias_compartidas, nota, telefono })` — crean profesor/compañero.
* `obtenerHistorialProfesor(profesorId, datos)` — todas las materias matriculadas ligadas a un profesor, en todos los semestres.
* `obtenerUniversidadesDeProfesor(profesorId, datos)` — universidades donde dio clases un profesor.
* `obtenerMateriasCompartidasValidas(companero, datos)` — filtra las materias compartidas de un compañero a solo las que siguen apuntando a una matrícula real.
* `obtenerIntentosMateria(materiaId, planEstudioId, datos)` — todos los intentos reales de cursar una materia, cruzando todos los semestres.

*Utilitarios generales de colección:*
* `siguienteOrden(coleccion)` — próximo valor de `orden` para agregar algo al final (drag and drop).
* `reordenarPorArrastre(coleccion, idsEnNuevoOrden)` — reasigna `orden` secuencial tras un drag, sellando timestamp solo en los ítems que cambiaron.

### js/core/storage-adjuntos.js
**Propósito:** Orquesta el ciclo de vida completo de un adjunto: referencia liviana en el JSON (vía schema.js) + subida/descarga/borrado del binario real en Drive (vía auth.js), con cola de subida en memoria y limpieza de archivos huérfanos.
**Depende de:** schema.js, auth.js, storage-sync.js, storage.js
**Exporta:**
* `adjuntarArchivo(archivo, entidadTipo, entidadId)` — crea la referencia local al instante (con `subidaPendiente:true`) y encola el binario para subir en segundo plano. Devuelve la referencia creada.
* `procesarColaSubidas()` — procesa la cola de subidas pendientes en memoria; se reintenta sola tras adjuntar y al recuperar conexión.
* `descargarAdjunto(adjunto)` — descarga bajo demanda el binario y devuelve un Blob URL (quien llama debe revocarlo).
* `eliminarAdjunto(adjuntoId)` — tumba la referencia en el JSON + intenta borrar el binario real de Drive (best-effort, no crítico si falla).
* `procesarTumbasDriveHuerfanas()` — recorre tumbas de adjuntos buscando archivos de Drive que quedaron huérfanos (borrado registrado pero binario no borrado) y los limpia. Se engancha como hook post-fusión.
* `obtenerAdjuntosDe(entidadTipo, entidadId)` — helper de renderizado: adjuntos vigentes de una entidad puntual.

### js/core/storage.js
**Propósito:** Estado global compartido (`estado`) por toda la app, caché offline en localStorage, y manejo del access_token de Google (guardar/leer/borrar con expiración).
**Depende de:** storage-sync.js (`ocultarAvisoReconexion`, `programarRefrescoProactivo`)
**Exporta:**
* `estado` — objeto mutable compartido globalmente: `token`, `fileId`, `datos`, `pendienteSync`, `conexionDrive`, `ultimoModifiedTimeConocido`, `permisoPortapapeles`, etc.
* `CLAVE_CACHE_LOCAL` / `CLAVE_TOKEN_CACHE` — nombres de llave de localStorage para la caché de datos y de token respectivamente.
* `guardarTokenCache(token, expiresInSegundos)` — cachea `{ token, expiraEn }` en localStorage.
* `leerTokenCacheValido()` — devuelve `{ token, expiraEn }` solo si queda más de 5 min de vida; si no, `null`.
* `borrarTokenCache()` — limpia el token cacheado de localStorage.
* `establecerTokenActivo(token, expiresInSegundos)` — punto único para fijar un token válido: lo guarda en memoria y caché, programa el refresco proactivo, y marca "conexión OK".
* `correoConocido()` — correo del perfil ya cargado (si existe), para usar como `login_hint` en refrescos silenciosos.
* `authListo` — Promise que resuelve una sola vez cuando ya se supo si hay token utilizable (evita condiciones de carrera al iniciar).
* `resolverAuthListo` — función que resuelve la promesa `authListo`.
* `guardarCacheLocal()` — persiste `{ fileId, datos, pendienteSync }` en localStorage.
* `leerCacheLocal()` — lee la caché local; devuelve `null` y la descarta si está corrupta (JSON inválido).

### js/core/storage-merge.js
**Propósito:** Toda la lógica de fusión (merge) de datos entre dispositivos al sincronizar — resuelve conflictos usando el reloj lógico de Lamport y respeta tumbas de borrado en cada colección anidada del modelo.
**Depende de:** schema.js (`observarRelojLogico`, `migrarDatosAntiguos`)
**Exporta:**
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

### js/core/storage-sync.js
**Propósito:** Orquestación completa de sincronización con Drive: login silencioso, refresco de token, subida/bajada de cambios, sondeo multi-dispositivo, pull-to-refresh, backup rotativo, indicador visual de estado y conteo de conflictos.
**Depende de:** config-ajustes.js, config-enlaces.js, main.js, plan-gestionar.js, plan-vista-lista.js, semestres.js, semestres-tarjetas.js, finanzas.js, ui/componentes.js, ui/tema.js, auth.js, schema.js, storage-merge.js, storage.js
**Exporta:**
* `registrarHookPostFusion(fn)` / `registrarHookPostGuardado(fn)` — permiten a otros módulos (ej. storage-adjuntos.js) engancharse a eventos del ciclo de sync sin acoplar este archivo a ellos.
* `intentarReconexionSilenciosa()` — intenta obtener un token nuevo sin mostrar prompt al usuario.
* `reconexionEnCurso` — variable de estado: si hay una reconexión en curso ahora mismo.
* `programarRefrescoProactivo(expiresInSegundos)` — programa el refresco del token antes de que expire.
* `temporizadorRefrescoProactivo` — handle del timer de refresco proactivo.
* `mostrarAvisoReconexion()` / `ocultarAvisoReconexion()` — muestran/ocultan el banner de "reconectando" en la UI.
* `mostrarCargando()` / `ocultarCargando()` — controlan el overlay de carga (con contador anidado).
* `contadorCargando` — contador de llamados anidados a mostrarCargando/ocultarCargando.
* `inicializarPullToRefresh()` — gesto de "deslizar para refrescar" (Pointer Events, funciona en móvil y desktop).
* `conReintentoSi401(operacion)` — envuelve una operación de Drive; si falla con 401, refresca el token y reintenta una vez.
* `sincronizarAhora()` — sincronización completa "en el sitio": sube pendientes, baja lo último de Drive, repinta la UI sin recargar.
* `aplicarDatosRemotosFrescos(datosFrescos)` — bloque compartido que aplica datos ya descargados y repinta toda la UI.
* `marcarUltimaSincronizacionConfirmada()` — marca en la UI que la última sincronización se confirmó con éxito.
* `sondearCambiosRemotos()` — revisa cada pocos segundos si el archivo cambió en Drive desde otro dispositivo (solo `modifiedTime`, llamada barata).
* `sincronizarAlIniciar()` — sincronización especial al arrancar la app (sube Y baja, a diferencia del viejo comportamiento que solo subía).
* `inicializarSondeoAlVolver()` — reactiva el sondeo cuando la pestaña vuelve a estar visible/en foco.
* `asegurarTokenFrescoAlVolver()` — (interna en el listado de líneas pero no exportada — ver notas) refresca el token proactivamente al volver a la pestaña.
* `ejecutarBackupSiToca()` — corre el ciclo de backup rotativo solo si ya toca según la frecuencia elegida; silencioso ante errores.
* `forzarBackupManual()` — corre el backup ignorando el intervalo, para el botón manual; sí propaga errores a la UI.
* `marcarCambioPendiente()` — se llama cada vez que se modifica algo en `estado.datos`; dispara intento de sync.
* `intentarSincronizar()` — sube los cambios pendientes a Drive.
* `forzarSincronizacion()` — fuerza el intento de sync ya, sin esperar el evento `online`.
* `contarConflictosGlobales()` — cuenta todos los conflictos de sync pendientes en cualquier parte de los datos (para el badge ⚠️).
* `actualizarBadgeConflictosGlobales()` — repinta el badge de conflictos con el número actual.
* `actualizarIndicadorSync()` — repinta el indicador visual de estado de sincronización.

### js/core/utils.js
**Propósito:** Helpers genéricos sin estado propio: conversión de archivos a base64, formato de texto según preferencia del usuario, colores de badges, formato compacto de horas.
**Depende de:** storage.js (`estado`)
**Exporta:**
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

---

## Patrones transversales

- **Sincronización:** todo objeto persistido usa reloj de Lamport (`sellarTimestamp`/`observarRelojLogico` en schema.js) — nunca `Date.now()` directo. `_version_base` guarda el contador previo para que storage-merge.js distinga edición secuencial de conflicto real.
- **Borrado = tumba:** cada colección plana o anidada que se puede borrar necesita su propia `_eliminados_<coleccion>` inicializada explícita desde `crearDatosUsuarioNuevo()` (nunca dejar que `fusionarTumbas` tolere `undefined` como aceptable) — si no, el elemento borrado puede "resucitar" al fusionar con un dispositivo desactualizado.
- **Fusión de colecciones:** cualquier colección nueva con `id` propio se funde con `fusionarColeccion()` genérica (storage-merge.js) — no escribir lógica de fusión nueva por tipo de entidad salvo que tenga sub-colecciones anidadas propias (ver fusionarPlan/fusionarSemestre/fusionarCriterio como patrón a replicar).
- **Límite de 800 líneas por archivo** — si un archivo se acerca al límite, dividir por responsabilidad (ver ya hecho: storage.js/storage-sync.js/storage-merge.js/storage-adjuntos.js todos separados de un storage.js original).
