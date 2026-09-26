## JS — Agenda

### `agenda/agenda.js`
**Propósito:** Núcleo de la Agenda — vista Lista (cronológica, agrupada por día), header, filtros (Semanal/Todo, mostrar materias, mostrar días vacíos), selector de semestres, y el despacho entre Lista y Calendario.
**Depende de:** `core/schema.js`, `core/storage-sync.js`, `core/storage.js`, `core/utils.js`, `ui/componentes.js`, `semestres/semestres.js`, `agenda/agenda-calendario.js`, `agenda/agenda-clases.js`, `agenda/agenda-modal.js`, `agenda/agenda-utils.js`
**Exporta:**
* `inicializarAgenda()` — wiring inicial: modal de evento, botón "+", pills de vista, selector de semestres, filtros.
* `renderizarAgenda()` — entrypoint de render: decide Lista vs Calendario y dispara el render correspondiente. También expuesta como `window.renderizarAgenda` (evita import circular con `agenda-modal.js` y `agenda-calendario.js`).

### `agenda/agenda-utils.js`
**Propósito:** Helpers puros sin DOM, compartidos entre `agenda.js`, `agenda-clases.js` y `agenda-modal.js` — resolución de semestres seleccionados, cálculo de fechas de semana, formateo y estilos de eventos.
**Depende de:** `config/config-ajustes.js`, `core/storage.js`, `core/utils.js`, `horario/horario.js`, `semestres/semestres.js`
**Exporta:**
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

### `agenda/agenda-clases.js`
**Propósito:** Sección "Materias" inline por día — qué clases del Horario caen ese día, mostradas junto a eventos/tareas/exámenes.
**Depende de:** `core/schema.js`, `core/storage.js`, `horario/horario.js`, `agenda/agenda-utils.js`
**Exporta:**
* `calcularNumeroSemanaParaFecha(semestre, fecha)` — número de semana del semestre para una fecha puntual (no depende de "hoy").
* `construirSeccionMateriasDia(semestres, fecha, diaCodigo)` — arma el bloque DOM "Materias" del día para varios semestres a la vez; devuelve `null` si no hay nada que mostrar.
* `contarClasesDelDia(semestres, fecha, diaCodigo)` — conteo liviano (sin DOM) de clases ese día, sumado entre todos los semestres — lo usa el Calendario para el indicador 📚.

### `agenda/agenda-modal.js`
**Propósito:** Modal de alta/edición de EventoAgenda (evento/tarea/examen) y tarjeta de info al tocar un ítem de la lista.
**Depende de:** `core/schema.js`, `core/storage-sync.js`, `core/storage.js`, `core/utils.js`, `ui/componentes.js`, `horario/horario.js`, `agenda/agenda-utils.js`
**Exporta:**
* `abrirModalEventoAgenda({eventoId, fechaDefault})` — abre el formulario para crear (si `eventoId` es null) o editar un evento.
* `abrirTarjetaInfoEventoAgenda(eventoId)` — abre la tarjeta de solo-info de un evento (paso previo al editor).
* `inicializarModalAgendaEvento()` — wiring de ambos modales (pills de tipo, checkbox "todo el día", dropdown de materia, botones guardar/borrar/cerrar).

### `agenda/agenda-calendario.js`
**Propósito:** Vista Calendario (mensual/semanal) — grid de 7 columnas con vistazo rápido de eventos por día; tocar un día salta a la vista Lista.
**Depende de:** `core/storage.js`, `ui/componentes.js`, `agenda/agenda-clases.js`, `agenda/agenda.js`, `agenda/agenda-utils.js`
**Exporta:**
* `renderizarCalendarioAgenda()` — entrypoint de render de la vista Calendario (subheader + grid mensual o semanal).

---

## Patrones transversales
- **Sync:** cada mutación de una entidad sella timestamp con `sellarTimestamp()` (Lamport + `_version_base`) y llama `marcarCambioPendiente()` antes de refrescar la UI.
- **Borrado:** nunca se hace `delete` directo — se agrega una tumba al array `_eliminados_<entidad>` y se filtra el array vivo, para que el merge de sync sepa que fue borrado intencionalmente.
- **Límite de 800 líneas por archivo** — si un archivo se acerca al límite, se separa por responsabilidad (ver cómo Agenda se partió en núcleo/utils/clases/modal/calendario).
- **Relectura de entidad viva:** antes de mutar algo que vino de un closure (ej. abierto en un modal), se vuelve a buscar por id en `estado.datos` — un sondeo remoto puede haber reemplazado el objeto mientras tanto.

**Archivos documentados en este bloque: 5/5** (agenda.js, agenda-utils.js, agenda-clases.js, agenda-modal.js, agenda-calendario.js) — ninguno quedó afuera.
