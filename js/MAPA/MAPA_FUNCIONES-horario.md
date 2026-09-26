## js/horario/horario.js

**Propósito:** Renderiza el grid semanal de Horario (vista propia, modo conjunto con amigos y vista individual de un amigo), y expone helpers de formato (color/nombre de bloque, modalidad, profesor) reutilizados por Agenda.

**Depende de:** schema.js, storage.js, storage-sync.js, componentes.js, config-ajustes.js, semestres.js, plan-esquema.js, horario-modal.js, horario-amigos.js.

**Exporta:**

* `inicializarHorario()` — conecta los botones de la sección Horario (semestre anterior/siguiente, agregar bloque, panel de amigos, pantalla completa, descargar imagen).
* `renderizarHorario()` — repinta el grid completo de Horario (delega en el render interno).
* `obtenerSemestreHorarioActual()` — devuelve el semestre que se está mostrando ahora mismo en Horario (usa `estado.horarioSemestreId` o cae al más reciente no pasado).
* `obtenerColorBloque(bloqueEfectivo)` — color a mostrar para un bloque: color propio del bloque, o si no tiene, el de la categoría de la materia asociada, o violeta por default.
* `obtenerNombreBloque(bloqueEfectivo)` — nombre a mostrar: apodo del bloque, o nombre de la materia vinculada, o `"Personalizado"`/`"Materia"` de fallback.
* `obtenerRangoHorasHorario()` — devuelve `{ horaInicio, horaFin }` (0-24) del rango visible del grid según Ajustes → Horario, con validación de rango inválido.
* `obtenerPlanPorId(planId)` — busca un plan de estudios por id en `estado.datos.planes_estudio`.
* `abrirHorarioConjunto()` *(alias de `activarModoConjunto`)* — activa el modo "Horario conjunto" (superpone los horarios de amigos vinculados) dentro del mismo `#horario-grid`.
* `abrirVistaIndividualAmigo(fileId)` *(alias de `activarVistaIndividualAmigo`)* — reemplaza el grid propio por la vista de solo lectura del horario de un amigo vinculado puntual.
* `abrirTarjetaInfoBloque(semestre, numeroSemana, b)` — abre el overlay con el detalle de una clase efectiva (nombre, semana, modalidad, aula, profesor). Reutilizado por Agenda (agenda-clases.js) para su tarjeta "Mostrar clases".
* `obtenerEmojiModalidad(modalidad)` — emoji para una modalidad (`💻` virtual, `📖` asincrónica, `✖️` sin clase, vacío si presencial).
* `obtenerEtiquetaModalidad(modalidad)` — etiqueta humana para una modalidad, con fallback genérico si el valor no está mapeado.
* `obtenerNombreProfesor(profesorId)` — nombre abreviado del profesor (primer nombre + primer apellido completos, resto a iniciales).
* `fechaLocalDesdeISO(str)` — parsea una fecha `YYYY-MM-DD` a `Date` local (sin desfase de timezone).

## js/horario/horario-modal.js

**Propósito:** Modal de alta/edición de un bloque de horario (materia, días/horas, modalidad, color, profesor, notas) y su sub-sección de Cronograma (excepciones puntuales por semana/día).

**Depende de:** schema.js, storage-sync.js, storage.js, componentes.js, config-ajustes.js, semestres.js, comunidad.js.

**Exporta:**

* `abrirModalBloqueHorario({ semestreId, bloqueId, diaPreseleccionado, horaInicioPreseleccionada, horaFinPreseleccionada, numeroSemanaVista })` — abre el modal para crear un bloque nuevo (con día/hora preseleccionados, ej. desde un click-drag en el grid) o editar uno existente por `bloqueId`.
* `cerrarModalBloqueHorario()` — oculta el modal y limpia el contexto de edición en curso.
* `construirZonaCronograma(semestre, bloque, { semanaInicial })` — arma el bloque colapsable "📅 Cronograma de clases" dentro del formulario, para editar la modalidad de un día puntual de una semana específica sin afectar la plantilla base del bloque.

## js/horario/horario-amigos.js

**Propósito:** "Horario entre amigos" del lado de la app con sesión — generar/revocar enlaces compartidos del propio horario, vincular horarios de amigos vía enlace público, y mantener en caché sus snapshots para el modo conjunto y la vista individual.

**Depende de:** storage.js, storage-sync.js, schema.js, auth.js, componentes.js, clipboard.js, horario.js (helpers de formato/color y las funciones de modo conjunto/vista individual).

**Exporta:**

* `inicializarHorarioAmigos()` — inicializa el panel de Amigos y pinta la lista de enlaces compartidos propios (corre en el primer `DOMContentLoaded`, antes de tener `estado.token`).
* `abrirPanelAmigos()` — muestra el modal del panel de Amigos y repinta la lista de vinculados (por si cambió algo desde otro dispositivo).
* `renderizarListaEnlacesCompartidos()` — pinta la lista de enlaces que el usuario generó de su propio horario, ordenados por fecha de creación descendente.
* `procesarAsociacionPendienteDeAmigo()` — lee el pendiente dejado en `localStorage` por horario-amigos-publico.js (flujo "Asociar a mi cuenta"), lo descarta si expiró o ya estaba vinculado, y si no, dispara la confirmación de vínculo.
* `asignarColorAmigo(semilla)` — color determinístico (hash de la semilla, ej. el file_id) tomado de una paleta fija, para pintar de forma estable el horario de cada amigo.
* `iniciarRefrescoPeriodicoAmigos()` — refresca los snapshots de amigos al llamar y arma un intervalo de 5 min mientras la pestaña siga abierta.
* `obtenerBloquesAmigosPorDia(fecha, diaCodigo)` — bloques de todos los amigos visibles (no ocultos) que caen en un día/fecha real, resolviendo excepciones de cronograma de esa semana.
* `renderizarListaAmigosVinculados()` — pinta la lista de amigos vinculados en el panel; muestra/oculta el botón "Horario conjunto" según si hay al menos uno.
* `obtenerListaAmigosParaDiaConjunto(fecha, diaCodigo)` — para cada amigo vinculado, sus bloques de ese día/fecha ya resueltos (o marca "caída" si su enlace fue revocado). Usado por el modo conjunto en horario.js.
* `refrescarSnapshotsAmigos()` — vuelve a descargar el snapshot público de cada amigo vinculado, actualiza el caché y repinta Horario y la lista de amigos.
* `obtenerSnapshotAmigoPorId(fileId)` — snapshot crudo (+ estado "caída") de un amigo puntual, tal cual está en caché ahora. Usado por la vista individual en horario.js.
* `obtenerDiasConClaseAmigosVinculados()` — unión de todos los códigos de día en los que cualquier amigo vinculado tiene al menos un bloque, sin filtrar por visibilidad. Usado para armar los días navegables del Horario conjunto.
* `calcularNumeroSemanaAmigo(snapshot, fecha)` — número de semana del semestre del amigo para una fecha real dada (`null` si cae fuera de su rango de semestre).

## js/horario/horario-amigos-publico.js

**Propósito:** Script standalone de `amigos.html` (vista pública del horario compartido, sin sesión). A propósito NO importa nada de `js/core` ni de `js/horario` — porta en modo solo-lectura su propia copia de la matemática del grid (horas, días, clases efectivas por semana) para no cargar el stack de auth/sync/schema. No es un módulo ES: se auto-ejecuta llamando a `iniciar()` al final del archivo.

**Depende de:** nada del resto de la app (fetch directo a Drive API vía `API_KEY` pública restringida por dominio).

**Funciones internas relevantes (no exportadas — todo el archivo es el punto de entrada de la página):**

* `iniciar()` — punto de arranque: lee el `fileId` del hash de la URL, descarga el snapshot público, renderiza el grid, arranca el reloj de la línea de "hora actual" y el flujo de asociar a cuenta.
* `obtenerFileIdDesdeHash()` — extrae `fileId` de `#fileId=...` en la URL (nunca de un query param, por privacidad/indexabilidad).
* `obtenerSnapshotPublico(fileId)` — descarga el JSON del snapshot compartido desde Drive (`alt=media`) usando la API key pública.
* `renderizarGridPublico(snapshot)` — arma el grid semanal completo (header de días, columna de horas, tarjetas de clase) a partir del snapshot; devuelve el rango de horas usado.
* `inicializarFlujoAsociar(fileId, snapshot)` — maneja el modal "+ Asociar a mi cuenta": al confirmar, guarda `{ fileId, apodo, guardado_en }` en `localStorage` (clave `horario_amigo_pendiente`) y redirige a `index.html`, donde `horario-amigos.js` (`procesarAsociacionPendienteDeAmigo`) lo recoge.
* `inicializarPantallaCompletaPublico()` — toggle de pantalla completa sobre el contenedor del grid.

## Patrones transversales

* **Sync:** todo cambio a `estado.datos` se marca con `sellarTimestamp()` (Lamport) y `marcarCambioPendiente()`; el merge entre dispositivos usa `_version_base` para resolver conflictos campo a campo.
* **Borrado:** los elementos eliminados no se sacan del array — se marcan como tumba (soft-delete) para que el merge no los resucite desde otro dispositivo desactualizado.
* **Tamaño de archivo:** límite de 800 líneas por archivo; `horario.js` (2064 líneas) y `horario-modal.js` (1038) ya superan ese límite y son candidatos a dividirse en un próximo prompt.
* **Índice vivo:** cualquier prompt que cree un archivo o agregue/quite funciones exportadas debe actualizar la entrada correspondiente acá mismo, en `MAPA_FUNCIONES.md`.
