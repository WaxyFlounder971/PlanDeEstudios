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
import { aplicarFormatoTexto } from "../core/utils.js";
import {
  abrirTarjetaInfoBloque,
  obtenerColorBloque,
  obtenerEmojiModalidad,
  obtenerNombreBloque,
  obtenerNombreProfesor,
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
 */
function calcularNumeroSemanaParaFecha(semestre, fecha) {
  const inicio = new Date(semestre.fecha_inicio);
  const semanasTranscurridas = isNaN(inicio.getTime())
    ? 0
    : Math.floor((fecha.getTime() - inicio.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const total = Number(semestre.duracion_semanas) || 16;
  return Math.min(Math.max(semanasTranscurridas + 1, 1), total);
}

/**
 * Clases del semestre activo que caen en `diaCodigo` ("L"|"K"|...) de la
 * semana `numeroSemana`. `numeroSemana` se recalcula por fecha real (no se
 * asume "semana actual de Horario") para que las materias inline muestren
 * lo correcto también en días de semanas pasadas/futuras que el usuario
 * navegue dentro de Agenda.
 */
function obtenerClasesDelDia(semestre, numeroSemana, diaCodigo) {
  if (!semestre) return [];
  return (semestre.bloques_horario || [])
    .flatMap((bloque) => obtenerClasesEfectivasSemana(bloque, numeroSemana))
    .filter((clase) => clase.dia === diaCodigo)
    .sort((a, b) => String(a.hora_inicio).localeCompare(String(b.hora_inicio)));
}

/**
 * Conteo liviano (sin construir DOM) de cuántas clases caen en `fecha` —
 * lo usa el grid del Calendario (agenda-calendario.js) para pintar un
 * indicador chico por celda, sin pagar el costo de armar las filas
 * completas en las ~35-42 celdas de una vista mensual.
 */
function contarClasesDelDia(semestre, fecha, diaCodigo) {
  if (!semestre) return 0;
  return obtenerClasesDelDia(semestre, calcularNumeroSemanaParaFecha(semestre, fecha), diaCodigo).length;
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
    <span class="muted" style="font-size:0.72rem; flex-shrink:0; text-align:right;">${emoji ? `${emoji} ` : ""}${aplicarFormatoTexto(String(clase.modalidad || ""))}</span>
  `;
  fila.addEventListener("click", () => abrirTarjetaInfoBloque(semestre, numeroSemanaReal, enriquecida));
  return fila;
}

/**
 * Punto 9 + 10: sección "Materias" del día (subtítulo + filas), mismo
 * patrón que los grupos de Tareas/Exámenes/Eventos en agenda.js. Devuelve
 * `null` (nada que insertar) si no hay semestre activo, si el filtro
 * "Mostrar materias en la agenda" está apagado, o si no hay clases ese día
 * — mismo criterio de "no ocupar espacio de más" que ya usan esos otros
 * grupos.
 *
 * El filtro leído acá es el de SESIÓN (`estado.agendaFiltroMostrarMaterias`,
 * ver agenda.js) — el de la ventana de Filtros del punto 10, que arranca en
 * cada carga de la app tomando como valor inicial el ajuste PERSISTENTE de
 * Ajustes → Agenda (`agenda_mostrar_clases`, punto 12) pero se puede
 * togglear solo para la sesión actual sin tocar ese ajuste permanente.
 */
function construirSeccionMateriasDia(semestre, fecha, diaCodigo) {
  if (!semestre) return null;
  if (estado.agendaFiltroMostrarMaterias === false) return null;

  const numeroSemanaReal = calcularNumeroSemanaParaFecha(semestre, fecha);
  const clases = obtenerClasesDelDia(semestre, numeroSemanaReal, diaCodigo);
  if (clases.length === 0) return null;

  const grupo = document.createElement("div");
  grupo.className = "stack";
  grupo.style.gap = "6px";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.style.cssText = "font-size:0.7rem; text-transform:uppercase; letter-spacing:0.02em;";
  etiqueta.textContent = "Materias";
  grupo.appendChild(etiqueta);

  clases.forEach((clase) => grupo.appendChild(construirFilaMateriaInline(clase, semestre, numeroSemanaReal)));

  return grupo;
}

export { construirSeccionMateriasDia, contarClasesDelDia, calcularNumeroSemanaParaFecha };
