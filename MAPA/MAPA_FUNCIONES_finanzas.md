# Finanzas — mapa completo de módulos, datos y sincronización

Este documento describe el código que existe en esta versión. Finanzas combina las pantallas heredadas de matrícula/beneficios con el modelo Finanzas 2.0 de movimientos, metas, presupuesto y módulos opcionales. La lógica de dominio vive en `js/core/finanzas/`; la interfaz vive en `js/finanzas/`.

## Recorrido de una operación

1. `js/finanzas/` recoge y valida la interacción de la persona.
2. Las funciones de dominio de `js/core/finanzas/` actualizan `estado.datos` y sellan entidades persistidas con el reloj lógico de `js/core/schema.js`.
3. La interfaz llama a `marcarCambioPendiente()` de `js/core/storage/storage-sync.js` para guardar localmente y programar sincronización con Drive.
4. `js/core/storage/storage-merge.js` fusiona colecciones por id y respeta sus listas `_eliminados_*` (tumbas), evitando que un borrado reaparezca en otro dispositivo.

Los cálculos se derivan del modelo unificado; las pantallas no deben sumar por su cuenta colecciones antiguas y nuevas.

## Áreas funcionales

| Área | Responsabilidad | Módulos principales |
|---|---|---|
| Inicio y Disponible | Resumen, saldo líquido, ritmo, semáforo, próximos y privacidad | `finanzas-disponible.js`, `finanzas-derivados.js`, `finanzas-inicio.js` |
| Movimientos | Registro rápido/completo, edición, historial, ajustes y deshacer | `finanzas-registro.js`, `finanzas-registro-rapido.js`, `finanzas-movimiento-modal.js`, `finanzas-movimientos.js` |
| Plan | Compromisos, cuotas, confirmar, omitir, reabrir y reajustar | `finanzas-compromisos.js`, `finanzas-plan.js`, `finanzas-plan-formularios.js` |
| Metas | Ahorro, aportes programados, reparto sugerido, recordatorio y metas de gasto | `finanzas-metas-plan.js`, `finanzas-metas-sugeridas.js`, `finanzas-reparto.js`, `finanzas-recordatorios.js`, `finanzas-metas-gasto.js`, vistas de metas |
| Presupuesto | Categorías, sugerencias, prioridad Esencial/Flexible, sobres y resumen mensual | `finanzas-categorias.js`, `finanzas-sobres.js`, `finanzas-presupuesto.js` |
| Importar/exportar | CSV, respaldo JSON, vista previa, deshacer y mensajes bancarios | `finanzas-csv.js`, `finanzas-importar.js`, `finanzas-texto.js`, `finanzas-mensajes.js`, `finanzas-formatos-ejemplo.js` |
| Deudas | Préstamos, abonos, gastos divididos y saldo por persona | `finanzas-deudas.js`, `finanzas-deudas-ui.js` |
| Cuentas | Cuentas por divisa, saldos y traspasos entre cuentas | `finanzas-cuentas-base.js`, `finanzas-cuentas.js`, `finanzas-cuentas-ui.js` |
| Finanzas universitaria heredada | Pagos/becas por semestre, gastos universitarios y Beneficios | `finanzas-semestres.js`, `finanzas-gastos.js`, `finanzas-registro-semestre.js` |

## Pestañas y módulos

El shell está en `js/finanzas/finanzas.js`. Las pestañas base incluyen Inicio, Semestres, Plan, Movimientos, Metas, Presupuesto y Beneficios. Cuentas y Deudas se agregan cuando sus módulos están activos. La lista visible también depende de la selección de módulos de Finanzas.

### Incorporación y guía de Finanzas

El primer uso presenta una descripción de las funciones antes de elegir un perfil. Después solicita el saldo inicial cuando el perfil lo requiere y abre un recorrido contextual por las pestañas que estén activas. La guía cubre Inicio/Disponible, Semestres, Plan, Movimientos, Metas, Presupuesto, Beneficios, Cuentas y Deudas; omite las pestañas opcionales apagadas y termina en Ajustes para explicar módulos, importación, exportación y formatos de mensajes bancarios. Se puede volver a abrir desde la guía de la sección Finanzas. Las descripciones están en español; las traducciones se mantienen fuera de este cambio.

El contenido visual del primer uso se construye en `js/finanzas/finanzas.js`. La guía contextual y el recorrido entre pestañas viven en `js/core/onboarding.js`. La selección de perfiles y módulos sigue en `js/finanzas/finanzas-modulos-ui.js` y `js/core/finanzas/finanzas-perfiles.js`; el recorrido solo explica y navega, no cambia los datos ni activa módulos por cuenta propia.

Matrícula, beca, gastos e ingresos, y ahorros se controlan con `configuracion.finanzas_modulos`. Deudas usa el interruptor independiente `configuracion.finanzas_deudas`, apagado por defecto. Cuentas usa `configuracion.finanzas_cuentas`, también apagado por defecto. Los consejos se controlan con `configuracion.finanzas_consejos`.

## Datos y compatibilidad

| Colección | Contenido | Tombstone |
|---|---|---|
| `movimientos` | Gastos, ingresos, ahorro, transferencias, ajustes, préstamos y traspasos | `_eliminados_movimientos` |
| `metas` | Metas de ahorro y metas de gasto (estas últimas llevan `tipo: "gasto"`) | `_eliminados_metas` |
| `compromisos` | Pagos esperados y compromisos del Plan | `_eliminados_compromisos` |
| `categorias_finanzas` | Categorías de gasto e ingreso y prioridad | `_eliminados_categorias_finanzas` |
| `sobres` | Presupuestos por periodo y categoría(s) | `_eliminados_sobres` |
| `patrones_mensajes` | Plantillas personales para leer mensajes bancarios | `_eliminados_patrones_mensajes` |
| `prestamos` | Saldos por persona del módulo Deudas | `_eliminados_prestamos` |
| `cuentas` | Cuentas de la persona, tipo, divisa y saldo inicial | `_eliminados_cuentas` |

Las colecciones históricas `finanzas_semestre` y `gastos_u` conservan la información anterior y se migran al modelo de movimientos sin duplicarla. El detalle de llaves y campos está en `MAPA_JSON.md`.

### Reglas de producto vigentes

- No hay conversión automática entre divisas. Cada cuenta conserva su moneda; los totales por divisa se muestran separados.
- Gastos, presupuesto y Disponible se calculan en la moneda principal. Una cuenta que no afecta Mi dinero puede seguir contando en gastos/categorías.
- Préstamos, ajustes, ahorro y traspasos no se contabilizan como gasto/ingreso común, salvo el gasto dividido que corresponda a la parte de la persona.
- Importar siempre presenta vista previa antes de aplicar. El texto del mensaje bancario se procesa en el dispositivo y no se persiste; solo se guardan los formatos creados por la persona.
- Las propuestas de reparto a metas requieren confirmación; no mueven dinero automáticamente. El recordatorio de metas es interno a la app.
- Los consejos, préstamos y cuentas son opcionales; archivar oculta registros sin borrarlos. Los borrados definitivos sincronizan tombstones.

## Módulos y exports públicos

Cada fila se genera a partir de los bloques `export { ... }` del código fuente de esta versión. Si se modifica una exportación, actualizar esta lista en la misma entrega.

### Dominio: `js/core/finanzas/`

| Archivo | Responsabilidad | Exports |
|---|---|---|
| `js/core/finanzas/finanzas-categorias.js` | Categorías de gasto, reglas de sugerencia, prioridades Esencial/Flexible y clasificación por lote. | `FLAG_MIGRACION_CATEGORIAS`, `JUEGO_BASICO`, `PRIORIDADES_CATEGORIA`, `TIPOS_CATEGORIA`, `normalizar`, `agruparSinCategoriaPorNombre`, `archivarCategoriaFinanzas`, `asignarCategoria`, `buscarCategoria`, `categorizable`, `categorizarEnLote`, `crearCategoriaFinanzas`, `editarCategoriaFinanzas`, `eliminarCategoriaFinanzas`, `listarCategorias`, `movimientosSinCategoria`, `migrarCategoriasV1`, `sembrarCategoriasBasicas`, `sugerirCategoria`, `validarCategoria` |
| `js/core/finanzas/finanzas-compromisos.js` | Compromisos del Plan, cuotas, confirmación, omisión, edición y migración del modelo anterior. | `ESTADOS_COMPROMISO`, `FLAG_MIGRACION_FINANZAS2`, `FRECUENCIAS_GENERADOR`, `MAX_CUOTAS`, `SUBTIPOS_INGRESO`, `TIPOS_COMPROMISO`, `compromisoVisible`, `confirmarCompromiso`, `construirCuotas`, `crearCompromiso`, `deshacerConfirmacion`, `describirMovimientoDe`, `editarCompromiso`, `eliminarCompromiso`, `esFechaIso`, `estadoVisibleCompromiso`, `fechasDePagos`, `generarCuotas`, `migrarFinanzas2V1`, `obtenerCompromisosVisibles`, `omitirCompromiso`, `ordenarCompromisos`, `reabrirCompromiso`, `reajustarSerie`, `repartirMonto`, `resumirCompromisos` |
| `js/core/finanzas/finanzas-consejos.js` | Consejos breves al activar módulos y preferencia para mostrarlos. | `CONSEJOS`, `activarConsejos`, `consejoDe`, `consejosActivos` |
| `js/core/finanzas/finanzas-csv.js` | Lectura y escritura CSV, detección de separador, decodificación y defensa contra fórmulas. | `MAX_FILAS`, `SEPARADORES`, `decodificarBytes`, `detectarSeparador`, `escribirCsv`, `leerCsv`, `neutralizarFormula`, `restaurarFormula` |
| `js/core/finanzas/finanzas-cuentas-base.js` | Reglas comunes de cuentas, divisa principal y efecto de movimientos sobre Mi dinero. | `MONEDA_POR_DEFECTO`, `movimientoAfectaMiDinero`, `contextoCuentas`, `cuentasActivas`, `monedaPrincipal`, `movimientoEnMonedaPrincipal` |
| `js/core/finanzas/finanzas-cuentas.js` | CRUD de cuentas, traspasos, archivado, saldos, divisas y módulo Cuentas. | `MAX_NOMBRE`, `TIPOS_CUENTA`, `activarCuentas`, `archivarCuenta`, `buscarCuenta`, `crearCuenta`, `crearTraspaso`, `cuentaUsable`, `editarCuenta`, `eliminarCuenta`, `listarCuentas`, `migrarCuentasV1`, `movimientosDeCuenta`, `resumirCuentas`, `ultimaCuentaUsada` |
| `js/core/finanzas/finanzas-derivados.js` | Visibilidad de movimientos, totales, saldo de metas y módulos activos. | `calcularSaldoMeta`, `calcularTotalesMovimientos`, `movimientoVisible`, `movimientosVigentes`, `obtenerModulosFinanzas` |
| `js/core/finanzas/finanzas-deudas.js` | Préstamos entre personas, abonos, gastos divididos, saldos y módulo Me deben y debo. | `DIRECCIONES`, `MAX_PARTES`, `MAX_PERSONA`, `activarDeudas`, `archivarPrestamo`, `buscarOCrearPrestamoDePersona`, `buscarPrestamo`, `calcularSaldoPrestamo`, `crearPrestamo`, `deshacerDivision`, `deudasActivas`, `dividirGasto`, `editarPrestamo`, `eliminarPrestamo`, `listarPrestamos`, `migrarPrestamosV1`, `movimientosDePrestamo`, `personasConocidas`, `registrarAbono`, `registrarPrestamoAdicional`, `resumirDeudas` |
| `js/core/finanzas/finanzas-disponible.js` | Disponible, ritmo diario, semáforo, compromisos y próximos movimientos. | `HORIZONTE_DEFECTO`, `OPCIONES_HORIZONTE`, `calcularDisponible`, `calcularRitmoDiario`, `calcularSemaforo`, `contarCompromisosSinFecha`, `disponibleAplica`, `esDiaDePago`, `fijarHorizonteDias`, `listarProximos`, `obtenerHorizonteDias`, `ocurrenciasRecurrente`, `sumarDias` |
| `js/core/finanzas/finanzas-formatos-ejemplo.js` | Formatos de ejemplo para iniciar la lectura de mensajes bancarios. | `adoptarFormatoEjemplo`, `listarFormatosEjemplo` |
| `js/core/finanzas/finanzas-importar.js` | Exportación CSV/respaldo JSON, vista previa, clasificación, aplicación y deshacer importaciones. | `COLUMNAS_EXPORTACION`, `FORMATO_RESPALDO`, `MAX_TEXTO`, `advertenciasImportacion`, `aplicarImportacion`, `candidatosDeCsv`, `candidatosDeJson`, `clasificarCandidatos`, `deshacerImportacion`, `detectarMapeo`, `exportarMovimientosCsv`, `exportarRespaldoJson`, `mapeoSuficiente`, `prepararImportacion`, `resumirCandidatos`, `tokenMoneda` |
| `js/core/finanzas/finanzas-mensajes.js` | Plantillas personales para leer mensajes, extracción aproximada y migración de formatos. | `HUECOS`, `MAX_MENSAJE`, `MAX_MENSAJES`, `MAX_PATRONES`, `MAX_PLANTILLA`, `TIPOS_PATRON`, `adivinarTipo`, `compilarPlantilla`, `crearPatron`, `editarPatron`, `eliminarPatron`, `leerConPlantilla`, `leerMensajeGenerico`, `leerMensajes`, `listarPatrones`, `migrarPatronesMensajesV1`, `separarMensajes`, `sugerirPlantilla`, `validarPatron` |
| `js/core/finanzas/finanzas-metas-gasto.js` | Metas de gasto, categorías asociadas, periodos, archivo y resumen de consumo. | `MAX_NOMBRE`, `UMBRAL_CERCA`, `archivarMetaGasto`, `crearMetaGasto`, `editarMetaGasto`, `eliminarMetaGasto`, `esMetaAhorro`, `esMetaGasto`, `gastosDeMeta`, `listarMetasGasto`, `resumirMetaGasto` |
| `js/core/finanzas/finanzas-metas-plan.js` | Fecha objetivo, ritmo, aportes programados y resumen de metas de ahorro. | `FRECUENCIAS_APORTE`, `calcularRitmoMeta`, `configurarPlanMeta`, `huboAporteHoy`, `listarAportesProgramados`, `resumirMeta` |
| `js/core/finanzas/finanzas-metas-sugeridas.js` | Sugerencias iniciales de metas y cálculo de fechas sugeridas. | `MESES_SUGERIDOS`, `SUGERENCIAS_META`, `fechaEnMeses`, `sugerirMetas` |
| `js/core/finanzas/finanzas-modelo.js` | Tipos, constructores y migración al modelo unificado de movimientos y metas. | `MODULOS_FINANZAS_DEFAULT`, `MODULOS_OPCIONALES_DEFAULT`, `ORIGENES_MOVIMIENTO`, `TIPOS_MOVIMIENTO`, `crearMeta`, `crearMovimiento`, `hoyIso`, `migrarFinanzasAMovimientos`, `montoEfectivoMovimiento` |
| `js/core/finanzas/finanzas-perfiles.js` | Perfiles, módulos activos, pestañas visibles y onboarding inicial de Finanzas. | `MODULOS_INFO`, `PERFILES_FINANZAS`, `aplicarModulosFinanzas`, `aplicarPerfilFinanzas`, `debeMostrarOnboardingFinanzas`, `omitirOnboardingFinanzas`, `perfilDeModulos`, `pestanasVisiblesFinanzas` |
| `js/core/finanzas/finanzas-recordatorios.js` | Recordatorio dentro de la app para aportes programados de metas. | `posponerRecordatorio`, `recordatoriosDeMetas` |
| `js/core/finanzas/finanzas-registro.js` | Registro rápido, ajustes de saldo, parseo de monto, protección contra doble guardado y deshacer. | `ID_SALDO_INICIAL`, `TIPOS_REGISTRO_RAPIDO`, `ajustarSaldo`, `calcularDiferenciaSaldo`, `crearGuardReentrada`, `parsearMonto`, `plantillasRecientes`, `puedeAjustarSaldo`, `quitarMovimiento`, `registrarMovimientoRapido`, `tiposDisponiblesRegistroRapido`, `ultimoTipoUsado` |
| `js/core/finanzas/finanzas-reparto.js` | Reglas para proponer y aplicar aportes de ingresos a metas. | `ORIGENES_REPARTO`, `aplicarReparto`, `configurarReparto`, `proponerReparto` |
| `js/core/finanzas/finanzas-sobres.js` | Sobres/presupuestos por periodo, arrastre, gasto por categoría y alertas. | `PERIODOS`, `UMBRAL_AMBAR`, `llenarPlantilla`, `archivarSobre`, `calcularArrastre`, `crearSobre`, `editarSobre`, `eliminarSobre`, `gastosEnPeriodo`, `inicioSemana`, `listarSobres`, `periodoDelSobre`, `rangoDeSemestre`, `resumenMensual`, `resumirSobre`, `sobresDeCategoria`, `sobresEnRiesgo`, `validarSobre` |
| `js/core/finanzas/finanzas-texto.js` | Normalización y lectura de importes, fechas, monedas y huellas de movimientos. | `MESES`, `MONEDA_ANTES`, `MONEDA_DESPUES`, `NUMERO_MONTO`, `SIMBOLOS_MONEDA`, `armarFecha`, `compararMoneda`, `detectarOrdenFecha`, `hashTexto`, `huellaMovimiento`, `normalizarTexto`, `normalizarTipo`, `parsearFechaTexto`, `parsearMontoTexto`, `quitarAcentos` |

### Interfaz: `js/finanzas/`

| Archivo | Responsabilidad | Exports |
|---|---|---|
| `js/finanzas/finanzas-categorias-ui.js` | Gestor y selector de categorías, clasificación del historial y contadores. | `abrirCategorizarHistorial`, `abrirGestorCategorias`, `ayudasUi`, `construirSelectorCategoria`, `contarSinCategoria` |
| `js/finanzas/finanzas-cuentas-ui.js` | Pantalla de cuentas, detalle, saldos y traspasos. | `abrirCuentaNueva`, `abrirDetalleCuenta`, `abrirTraspaso`, `formatearEn`, `renderizarPestanaCuentas` |
| `js/finanzas/finanzas-datos-ui.js` | Flujos de exportación, importación y entrega de archivos. | `abrirExportar`, `abrirImportar`, `construirBloqueDatosFinanzas`, `entregarArchivo`, `puedeCompartirArchivos` |
| `js/finanzas/finanzas-deudas-ui.js` | Pantallas de préstamos, detalle por persona y división de gastos. | `abrirDetallePrestamo`, `abrirDividirGasto`, `abrirNuevoPrestamo`, `renderizarPestanaDeudas` |
| `js/finanzas/finanzas-gastos.js` | Vistas heredadas de gastos universitarios/beneficios y consulta de semestres. | `obtenerTodosLosSemestres`, `renderizarPestanaBeneficios` |
| `js/finanzas/finanzas-graficas.js` | Gráficas SVG del resumen de Finanzas. | `construirGraficasResumenFinanzas` |
| `js/finanzas/finanzas-inicio.js` | Inicio de Finanzas, Disponible, próximos, privacidad y recordatorios visibles. | `abrirDesgloseDisponible`, `construirBloquesInicio`, `hayProximos`, `construirFilaProximo`, `fijarPrivacidad`, `montoVisible`, `privacidadActiva` |
| `js/finanzas/finanzas-mensajes-ui.js` | Pegar mensajes, gestionar formatos y editar plantillas personales. | `abrirEditorPatron`, `abrirGestorPatrones`, `abrirPegarMensaje` |
| `js/finanzas/finanzas-metas-gasto-ui.js` | Tarjetas y formulario de metas de gasto. | `construirFormularioMetaGasto`, `construirTarjetaMetaGasto` |
| `js/finanzas/finanzas-metas.js` | Pantalla de metas de ahorro, plan, progreso, sugerencias y resumen. | `construirAnilloMeta`, `construirPlanMeta`, `construirTextoMeta`, `renderizarPestanaMetas`, `resumenMeta` |
| `js/finanzas/finanzas-modulos-ui.js` | Selector de perfil y controles de módulos/consejos en Ajustes. | `construirSelectorPerfil`, `renderizarModulosFinanzasAjustes` |
| `js/finanzas/finanzas-movimiento-modal.js` | Formulario completo para crear y editar movimientos. | `abrirModalMovimiento`, `nombreMostradoMovimiento`, `obtenerMetasActivas` |
| `js/finanzas/finanzas-movimientos.js` | Historial de movimientos, filtros, categorías y acciones por fila. | `renderizarPestanaMovimientos` |
| `js/finanzas/finanzas-plan-formularios.js` | Formularios para crear/editar compromisos y confirmar cuotas. | `TIPOS_PLAN`, `abrirConfirmarConDatos`, `abrirEditorCompromiso`, `abrirGeneradorCuotas`, `abrirReajuste`, `confirmarYAvisar`, `pedirEliminarCompromiso` |
| `js/finanzas/finanzas-plan.js` | Pestaña Plan y listado de compromisos financieros. | `etiquetaTipoCompromiso`, `renderizarPestanaPlan` |
| `js/finanzas/finanzas-presupuesto.js` | Presupuesto mensual, sobres, prioridades y gestión de categorías. | `abrirFormularioSobre`, `construirBloqueSobresEnRiesgo`, `construirResumenMensual`, `pestanaPresupuestoVisible`, `renderizarPestanaPresupuesto` |
| `js/finanzas/finanzas-recurrencia.js` | Controles de recurrencia del formulario y formato de frecuencia. | `construirSeccionRecurrencia`, `formatearFrecuenciaRecurrente` |
| `js/finanzas/finanzas-registro-rapido.js` | Registro rápido, ajuste de saldo y barra para deshacer. | `abrirAjustarSaldo`, `abrirCapa`, `abrirRegistroRapido`, `construirPasoSaldoInicial`, `crearBoton`, `crearCampo`, `crearEntrada`, `crearLineaError`, `mostrarBarraDeshacer`, `mostrarError` |
| `js/finanzas/finanzas-registro-semestre.js` | Adaptación entre registros históricos por semestre y movimientos. | `confirmarRegistroEnMovimientos`, `construirRegistroDesdeMovimientos`, `crearItemRegistro`, `crearRegistroVacio` |
| `js/finanzas/finanzas-reparto-ui.js` | Confirmación visual de propuestas de reparto hacia metas. | `abrirPropuestaReparto` |
| `js/finanzas/finanzas-selector.js` | Selectores comunes de semestre/categoría para formularios. | `construirSelectorFinanzas` |
| `js/finanzas/finanzas-semestres.js` | Pestaña Semestres y flujos de edición de pagos y becas. | `renderizarPestanaSemestresFinanzas`, `hayBorradorFinanzasPendiente`, `abrirSelectorSemestreParaFinanzas`, `iniciarEdicionMovimientoFinanzas` |
| `js/finanzas/finanzas-ui-basico.js` | Primitivas visuales compartidas por los modales de Finanzas. | `abrirCapaNombrada`, `areaTexto`, `boton`, `campo`, `entrada`, `filaBotones`, `insignia`, `lineaError`, `mostrar`, `parrafo`, `selector` |
| `js/finanzas/finanzas.js` | Shell de Finanzas, navegación de pestañas, resumen y formateo compartido. | `calcularTotalesResumenFinanzas`, `formatearFechaLarga`, `formatearMonto`, `obtenerSimboloMonedaActual`, `renderizarContenidoFinanzasActivo`, `renderizarFinanzas` |

## Archivos relacionados fuera de las dos carpetas

- `js/core/schema.js`: datos iniciales y migraciones; importa las migraciones de formatos bancarios, préstamos y cuentas.
- `js/core/storage/storage-merge.js`: fusión entre dispositivos de las colecciones y sus tombstones.
- `js/core/storage/storage-sync.js`: persistencia local, Drive y programación del envío/recepción.
- `js/core/i18n.js` y `idiomas/*.json`: traducción de interfaz. Las claves pendientes de Finanzas se documentan aparte; esta actualización no cambia traducciones.
- `service-worker.js`: versión de caché y shell offline. Los módulos se agregan al caché cuando se solicitan; no se mantiene una lista manual de cada JS.
- `tests/finanzas-*.mjs`: pruebas de lógica/integración presentes en el proyecto. No se deben reemplazar con copias del paquete de actualización anterior.

## Criterio para cambios futuros

Agregar colecciones nuevas en `crearDatosUsuarioNuevo()`, normalizarlas en `migrarDatosAntiguos()` y añadirlas explícitamente a `fusionarDatos()` con su tombstone. Si se omite cualquiera de esos puntos, una cuenta nueva puede carecer de la colección o la sincronización puede reemplazarla completa con el arreglo de otro dispositivo.
