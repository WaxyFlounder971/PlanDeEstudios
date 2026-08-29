/* =========================================================================
   AGENDA — Materias inline
   Por cada día de la vista de Agenda: qué materias tiene el usuario ese día
   según Horario, mostradas directo (sin tarjeta contenedora) bajo un
   subtítulo "Materias" — reemplaza la tarjetita colapsable "Mostrar clases"
   del diseño anterior (rediseño núcleo Agenda, punto 9). Tocar una materia
   sigue abriendo el MISMO modal de info que usa el grid de Horario
   (horario.js), sin salir de Agenda — pedido explícito del spec.
   ========================================================================= */

import { obtenerClasesEfectivasSemana } from "../core/schema.js";
import { estado } from "../core/storage.js";
import {
  abrirTarjetaInfoBloque,
  obtenerColorBloque,
  obtenerEmojiModalidad,
  obtenerEtiquetaModalidad,
  obtenerNombreBloque,
  obtenerNombreProfesor,
  calcularNumeroSemanaSinAcotarParaFecha,
} from "../horario/horario.js";
import { formatearHoraAmPm } from "./agenda-utils.js";

/**
 * Misma transformación que hace construirColumnaDia en horario.js antes de
 * poder llamar a abrirTarjetaInfoBloque — se duplica acá (en vez de
 * exportar la función interna de horario.js) porque horario.js la arma
 * inline como parte de construir el grid completo, mezclada con lanes/
 * posicionamiento en píxeles que acá no aplican para nada.
 */
function enriquecerClaseParaTarjetaInfo(claseEfectiva) {
  return {
    bloqueOriginalId: claseEfectiva.id,
    color: obtenerColorBloque(claseEfectiva),
    nombreCorto: obtenerNombreBloque(claseEfectiva),
    profesorNombre: obtenerNombreProfesor(claseEfectiva.profesor_id),
    aula: claseEfectiva.aula,
    enlace: claseEfectiva.enlace,
    modalidad: claseEfectiva.modalidad,
    notas: claseEfectiva.notas,
  };
}

/**
 * Mismo cálculo que hace calcularNumeroSemanaSemestre (schema.js), pero
 * evaluado contra una fecha puntual en vez de Date.now() — hace falta la
 * semana del DÍA que se está pintando (que en Agenda casi nunca es hoy: se
 * navega semanas/meses enteros), no la de "ahora mismo". Compartida entre
 * las materias inline y el conteo liviano para el Calendario
 * (agenda-calendario.js) para no repetir la fórmula una tercera vez.
 *
 * ACOTADA entre 1 y duracion_semanas A PROPÓSITO ("Semana N" del header/
 * detalle debe seguir mostrando la última semana real incluso para fechas
 * ya pasado el fin del semestre, nunca un número fuera de rango).
 *
 * Revisada 2026-08-29: antes esta función tenía su propia fórmula de
 * "días desde fecha_inicio / 7" con `new Date(string)` directo — el mismo
 * tipo de bug de zona horaria que ya se había resuelto en horario.js (ver
 * comentario de calcularFechaDelDia ahí) y sin el anclaje-a-lunes que ese
 * otro cálculo sí usa, así que para un fecha_inicio que no cae lunes podía
 * dar una semana distinta a la que calcula Horario para la misma fecha.
 * Ahora delega el cálculo crudo (sin acotar) en
 * calcularNumeroSemanaSinAcotarParaFecha (horario/horario-modal.js, vía
 * horario.js) y solo agrega el acotado que esta función sí necesita para
 * mostrar en pantalla — una sola fórmula real en el proyecto, no dos.
 */
function calcularNumeroSemanaParaFecha(semestre, fecha) {
  const total = Number(semestre.duracion_semanas) || 16;
  const numeroSemanaReal = calcularNumeroSemanaSinAcotarParaFecha(semestre, fecha);
  if (numeroSemanaReal == null) return 1;
  return Math.min(Math.max(numeroSemanaReal, 1), total);
}

/**
 * Ajustes vista Calendario — punto 1: `calcularNumeroSemanaParaFecha` (de
 * arriba) acota el número de semana entre 1 y `duracion_semanas` A
 * PROPÓSITO, así que no sirve para detectar "esta fecha ya pasó el fin del
 * semestre" (una fecha bien pasado el final se ve igual que la última
 * semana real). Por eso acá se usa la versión SIN acotar directamente —
 * pedido puntual del spec ("no mostrar clases en fechas posteriores al fin
 * del semestre"), no dice nada de fechas antes del inicio, así que esas se
 * dejan con el comportamiento de siempre (clampeadas a semana 1 más
 * arriba).
 */
function fechaSuperaFinSemestre(semestre, fecha) {
  const total = Number(semestre.duracion_semanas) || 16;
  const numeroSemanaReal = calcularNumeroSemanaSinAcotarParaFecha(semestre, fecha);
  return numeroSemanaReal != null && numeroSemanaReal > total;
}

/**
 * Clases del semestre activo que caen en `diaCodigo` ("L"|"K"|...) de la
 * semana `numeroSemana`. `numeroSemana` se recalcula por fecha real (no se
 * asume "semana actual de Horario") para que las materias inline muestren
 * lo correcto también en días de semanas pasadas/futuras que el usuario
 * navegue dentro de Agenda.
 *
 * `fecha` (opcional): fecha calendario real del día que se está resolviendo
 * — si se pasa y cae después del fin del semestre (ver
 * fechaSuperaFinSemestre), no devuelve clases aunque `numeroSemana` venga
 * clampeado a la última semana real. Opcional (no obligatorio) por si algún
 * llamador futuro solo necesita el corte por semana, sin el de fecha.
 */
function obtenerClasesDelDia(semestre, numeroSemana, diaCodigo, fecha) {
  if (!semestre) return [];
  if (fecha && fechaSuperaFinSemestre(semestre, fecha)) return [];
  return (semestre.bloques_horario || [])
    .flatMap((bloque) => obtenerClasesEfectivasSemana(bloque, numeroSemana))
    .filter((clase) => clase.dia === diaCodigo)
    .sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
}

/**
 * Conteo liviano (sin construir DOM) de cuántas clases caen en `fecha`,
 * sumadas entre TODOS los semestres del array `semestres`. Cada semestre
 * puede tener un número de semana distinto para la misma `fecha`
 * (fecha_inicio propia), por eso se recalcula por separado dentro del
 * reduce en vez de compartir un solo numeroSemana entre todos.
 *
 * Ajustes vista Calendario — punto 2: ya no la consume el grid del
 * Calendario (el indicador "hay clases" que la usaba se quitó del todo) —
 * queda acá exportada, sin uso interno del proyecto por ahora, por si algún
 * llamador futuro necesita este mismo conteo liviano sin duplicar la
 * fórmula.
 */
function contarClasesDelDia(semestres, fecha, diaCodigo) {
  if (!semestres || semestres.length === 0) return 0;
  return semestres.reduce(
    (total, semestre) =>
      total + obtenerClasesDelDia(semestre, calcularNumeroSemanaParaFecha(semestre, fecha), diaCodigo, fecha).length,
    0
  );
}

/**
 * Punto 9: fila de una materia, mismo lenguaje visual que un ítem de
 * Tarea/Examen/Evento (clase "agenda-item", borde izquierdo de color) para
 * que quede "al mismo nivel visual" que el resto — ya no hay tarjeta
 * contenedora que la distinga. Muestra SIEMPRE la modalidad de ese día
 * puntual (aunque sea presencial — pedido explícito del spec), en formato
 * de hora AM/PM.
 */
function construirFilaMateriaInline(clase, semestre, numeroSemanaReal) {
  const enriquecida = enriquecerClaseParaTarjetaInfo(clase);
  const emoji = obtenerEmojiModalidad(clase.modalidad);

  const fila = document.createElement("button");
  fila.type = "button";
  fila.className = "agenda-item";
  fila.style.borderLeft = `3px solid ${enriquecida.color}`;
  fila.innerHTML = `
    <span style="font-weight:600; flex-shrink:0;">${formatearHoraAmPm(clase.hora_inicio)}</span>
    <span style="flex:1; text-align:left; overflow-wrap:break-word;">${enriquecida.nombreCorto}</span>
    <span class="muted" style="font-size:0.72rem; flex-shrink:0; text-align:right;">${emoji ? `${emoji} ` : ""}${obtenerEtiquetaModalidad(clase.modalidad)}</span>
  `;
  fila.addEventListener("click", () => abrirTarjetaInfoBloque(semestre, numeroSemanaReal, enriquecida));
  return fila;
}

/**
 * Punto 9 + 10: sección "Materias" del día (subtítulo + filas), mismo
 * patrón que los grupos de Tareas/Exámenes/Eventos en agenda.js. Devuelve
 * `null` (nada que insertar) si no hay ningún semestre seleccionado, si el
 * filtro "Mostrar materias en la agenda" está apagado, o si ninguno de los
 * semestres seleccionados tiene clases ese día — mismo criterio de "no
 * ocupar espacio de más" que ya usan esos otros grupos.
 *
 * Varios semestres a la vez: recibe `semestres` (array, ver
 * obtenerSemestresSeleccionadosAgenda en agenda-utils.js) en vez de un
 * único semestre — junta las clases de TODOS los seleccionados que caigan
 * ese día y las ordena juntas por hora, como si fuera una sola agenda. Cada
 * clase se resuelve con el numeroSemana de SU PROPIO semestre (fechas de
 * inicio distintas dan números de semana distintos para la misma fecha
 * calendario), así que ese cálculo se hace por semestre antes de mezclar.
 *
 * El filtro leído acá es el de SESIÓN (`estado.agendaFiltroMostrarMaterias`,
 * ver agenda.js) — el de la ventana de Filtros del punto 10, que arranca en
 * cada carga de la app tomando como valor inicial el ajuste PERSISTENTE de
 * Ajustes → Agenda (`agenda_mostrar_clases`, punto 12) pero se puede
 * togglear solo para la sesión actual sin tocar ese ajuste permanente.
 */
function construirSeccionMateriasDia(semestres, fecha, diaCodigo) {
  if (!semestres || semestres.length === 0) return null;
  if (estado.agendaFiltroMostrarMaterias === false) return null;

  const filas = [];
  semestres.forEach((semestre) => {
    const numeroSemanaReal = calcularNumeroSemanaParaFecha(semestre, fecha);
    obtenerClasesDelDia(semestre, numeroSemanaReal, diaCodigo, fecha).forEach((clase) => {
      filas.push({ clase, semestre, numeroSemanaReal });
    });
  });
  if (filas.length === 0) return null;
  filas.sort((a, b) => String(a.clase.hora_inicio).localeCompare(String(b.clase.hora_inicio)));

  const grupo = document.createElement("div");
  grupo.className = "stack";
  grupo.style.gap = "6px";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.style.cssText = "font-size:0.7rem; text-transform:uppercase; letter-spacing:0.02em;";
  etiqueta.textContent = "Materias";
  grupo.appendChild(etiqueta);

  filas.forEach(({ clase, semestre, numeroSemanaReal }) =>
    grupo.appendChild(construirFilaMateriaInline(clase, semestre, numeroSemanaReal))
  );

  return grupo;
}

export { construirSeccionMateriasDia, contarClasesDelDia, calcularNumeroSemanaParaFecha };
