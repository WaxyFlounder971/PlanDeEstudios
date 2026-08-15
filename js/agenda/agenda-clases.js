/* =========================================================================
   AGENDA — Tarjetita "Mostrar clases"
   Por cada día de la vista de Agenda: qué materias tiene el usuario ese día
   según Horario (colapsada por default). Al expandir, tocar una materia
   abre el MISMO modal de info que usa el grid de Horario (horario.js), sin
   salir de Agenda — pedido explícito del spec.
   ========================================================================= */

import { obtenerClasesEfectivasSemana } from "../core/schema.js";
import {
  abrirTarjetaInfoBloque,
  obtenerColorBloque,
  obtenerEmojiModalidad,
  obtenerNombreBloque,
  obtenerNombreProfesor,
} from "../horario/horario.js";

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
 * la tarjetita y el conteo liviano para el Calendario (agenda-calendario.js)
 * para no repetir la fórmula una tercera vez.
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
 * asume "semana actual de Horario") para que la tarjetita muestre lo
 * correcto también en días de semanas pasadas/futuras que el usuario
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
 * indicador chico por celda, sin pagar el costo de armar la tarjetita
 * completa en las ~35-42 celdas de una vista mensual.
 */
function contarClasesDelDia(semestre, fecha, diaCodigo) {
  if (!semestre) return 0;
  return obtenerClasesDelDia(semestre, calcularNumeroSemanaParaFecha(semestre, fecha), diaCodigo).length;
}

/**
 * Construye la tarjetita completa (colapsada por default). `semestre` puede
 * ser null (usuario sin semestre activo) — en ese caso no se muestra nada
 * (ver agenda.js, que ya evita llamar a esto sin semestre).
 */
function construirTarjetaClasesDia(semestre, fecha, diaCodigo) {
  const numeroSemanaReal = calcularNumeroSemanaParaFecha(semestre, fecha);

  const clases = obtenerClasesDelDia(semestre, numeroSemanaReal, diaCodigo);

  const cont = document.createElement("div");
  cont.className = "agenda-tarjeta-clases";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "agenda-tarjeta-clases-cabecera";
  boton.innerHTML = `
    <span>📚 Mostrar clases${clases.length ? ` <span class="muted">(${clases.length})</span>` : ""}</span>
    <span class="ajuste-seccion-chevron">▾</span>
  `;

  const cuerpo = document.createElement("div");
  cuerpo.className = "agenda-tarjeta-clases-cuerpo oculto";

  if (clases.length === 0) {
    cuerpo.innerHTML = `<p class="muted" style="font-size:0.8rem; margin:6px 0 0;">Sin clases este día.</p>`;
  } else {
    clases.forEach((clase) => {
      const enriquecida = enriquecerClaseParaTarjetaInfo(clase);
      const emoji = obtenerEmojiModalidad(clase.modalidad);
      const fila = document.createElement("button");
      fila.type = "button";
      fila.className = "agenda-fila-clase";
      fila.style.cssText = `border-left:3px solid ${enriquecida.color};`;
      fila.innerHTML = `
        <span style="font-weight:600;">${clase.hora_inicio || ""}</span>
        <span style="flex:1; text-align:left; overflow-wrap:break-word;">${enriquecida.nombreCorto}</span>
        ${emoji ? `<span>${emoji}</span>` : ""}
      `;
      fila.addEventListener("click", () => abrirTarjetaInfoBloque(semestre, numeroSemanaReal, enriquecida));
      cuerpo.appendChild(fila);
    });
  }

  boton.addEventListener("click", () => {
    cuerpo.classList.toggle("oculto");
    boton.querySelector(".ajuste-seccion-chevron").style.transform = cuerpo.classList.contains("oculto")
      ? "rotate(0deg)"
      : "rotate(180deg)";
  });

  cont.appendChild(boton);
  cont.appendChild(cuerpo);
  return cont;
}

export { construirTarjetaClasesDia, contarClasesDelDia };
