/* =========================================================================
   RESUMEN
   Primera sección de la app — vista de SOLO LECTURA que agrega información
   que ya existe en Agenda/Horario/Semestres: semana actual del semestre,
   clases de hoy, tareas de hoy, próximas tareas, exámenes próximos y el
   próximo evento. No tiene modelo de datos propio, ni entidades nuevas, ni
   toca storage-sync — es puramente de presentación, reutilizando funciones
   ya existentes de esos 3 módulos:
     - obtenerSemestresSeleccionadosAgenda / obtenerSemestreActivoAgenda
       (agenda-utils.js) — mismo criterio de "semestre(s) actual(es)" que ya
       usa el header de Agenda, para que Resumen nunca muestre algo distinto
       de lo que la persona ya tiene seleccionado ahí.
     - calcularNumeroSemanaSemestre (core/schema.js) — mismo cálculo de
       número de semana que usan Horario y Agenda.
     - construirSeccionMateriasDia (agenda-clases.js) — el mismo bloque
       "Materias" que arma Agenda para un día puntual, reutilizado tal cual.
     - construirItemEvento (agenda.js) — el mismo item de lista de Agenda
       (con su checkbox de completar y su click-to-tarjeta-de-info ya
       cableados), reutilizado para tareas/exámenes/eventos.
   Tocar cualquier ítem abre la misma tarjeta de solo-info que ya existe en
   Agenda/Horario para ese tipo — no hay edición posible desde acá.
   ========================================================================= */

import { calcularNumeroSemanaSemestre, obtenerEstadoEfectivoSemestre } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { construirItemEvento } from "../agenda/agenda.js";
import { construirSeccionMateriasDia } from "../agenda/agenda-clases.js";
import {
  formatearFechaISO,
  obtenerCodigoDiaSemana,
  obtenerSemestreActivoAgenda,
  obtenerSemestresSeleccionadosAgenda,
} from "../agenda/agenda-utils.js";

// Ventanas de tiempo de cada sección (ver prompt de diseño): exámenes hasta
// 2 semanas adelante, próximo evento hasta 7 días adelante.
const DIAS_EXAMENES_PROXIMOS = 14;
const DIAS_EVENTO_PROXIMO = 7;
// Cantidad de tareas futuras a mostrar en "Próximas tareas".
const CANTIDAD_PROXIMAS_TAREAS = 3;

/** "YYYY-MM-DD" de `fecha` + `dias` días, usando el mismo formateo local
 *  que el resto de Agenda (formatearFechaISO) para no reintroducir el bug
 *  de desfase de timezone que ya se resolvió ahí con toISOString(). */
function fechaISOMasDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return formatearFechaISO(d);
}

/** Arma un bloque de sección con título + contenido, mismo patrón visual
 *  (glass-card + texto-encabezado-seccion) que el resto de la app. */
function construirBloqueSeccion(titulo, contenidoEl) {
  const seccion = document.createElement("section");
  seccion.className = "glass-card stack resumen-bloque";
  const encabezado = document.createElement("h2");
  encabezado.className = "texto-encabezado-seccion";
  encabezado.textContent = titulo;
  seccion.appendChild(encabezado);
  seccion.appendChild(contenidoEl);
  return seccion;
}

/** Lista vertical de eventos ya renderizados con construirItemEvento
 *  (agenda.js) — mismo look, mismo checkbox funcional, mismo click-to-info. */
function construirListaEventos(eventos) {
  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "8px";
  eventos.forEach((evento) => lista.appendChild(construirItemEvento(evento)));
  return lista;
}

/** Eventos de agenda que pertenecen a alguno de los semestres dados (o que
 *  no tienen semestre asignado, por compatibilidad con datos viejos) —
 *  mismo criterio de filtrado que ya usa construirBloqueDia en agenda.js. */
function obtenerEventosDeSemestres(semestres) {
  const ids = new Set(semestres.map((s) => s.id));
  return (estado.datos.agenda || []).filter((ev) => !ev.semestre_id || ids.has(ev.semestre_id));
}

function ordenarPorFechaYHora(a, b) {
  if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
  return String(a.hora || "99:99").localeCompare(String(b.hora || "99:99"));
}

function construirEstadoVacio() {
  const p = document.createElement("p");
  p.className = "muted resumen-vacio";
  p.textContent = "Todo tranquilo por hoy — no tenés nada pendiente en los próximos días. 🎉";
  return p;
}

function renderizarResumen() {
  const cont = document.getElementById("seccion-resumen");
  if (!cont || !estado.datos) return;
  cont.innerHTML = "";

  const semestresSeleccionados = obtenerSemestresSeleccionadosAgenda();
  const semestreActivo = obtenerSemestreActivoAgenda();

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyISO = formatearFechaISO(hoy);
  const diaCodigoHoy = obtenerCodigoDiaSemana(hoy);
  const limiteExamenesISO = fechaISOMasDias(hoy, DIAS_EXAMENES_PROXIMOS);
  const limiteEventoISO = fechaISOMasDias(hoy, DIAS_EVENTO_PROXIMO);

  let huboContenido = false;

  // 1. Semana actual del semestre — dato chico arriba de todo. Solo se
  // muestra si el semestre de referencia está realmente "actual" HOY (evita
  // un "Semana -2 de 16" o "Semana 40 de 16" si lo que está seleccionado en
  // Agenda es un semestre pasado o futuro).
  if (semestreActivo && obtenerEstadoEfectivoSemestre(semestreActivo) === "actual") {
    const numeroSemana = calcularNumeroSemanaSemestre(semestreActivo);
    if (numeroSemana >= 1 && numeroSemana <= semestreActivo.duracion_semanas) {
      const chip = document.createElement("p");
      chip.className = "muted resumen-semana-chip";
      chip.textContent = `Semana ${numeroSemana} de ${semestreActivo.duracion_semanas}`;
      cont.appendChild(chip);
    }
  }

  // 2. Clases de hoy — el mismo bloque "Materias" que arma Agenda para un
  // día puntual (agenda-clases.js ya devuelve null si no hay nada, así que
  // la sección se auto-oculta sin lógica extra acá).
  const seccionMaterias = construirSeccionMateriasDia(semestresSeleccionados, hoy, diaCodigoHoy);
  if (seccionMaterias) {
    cont.appendChild(construirBloqueSeccion("Clases de hoy", seccionMaterias));
    huboContenido = true;
  }

  const eventos = obtenerEventosDeSemestres(semestresSeleccionados);

  // 3. Tareas de hoy — sin completar, fecha === hoy.
  const tareasHoy = eventos
    .filter((ev) => ev.tipo === "tarea" && !ev.completada && ev.fecha === hoyISO)
    .sort(ordenarPorFechaYHora);
  if (tareasHoy.length > 0) {
    cont.appendChild(construirBloqueSeccion("Tareas de hoy", construirListaEventos(tareasHoy)));
    huboContenido = true;
  }

  // 4. Próximas tareas — las 3 pendientes más próximas cronológicamente,
  // sin importar si vencen pronto o no. Decisión de diseño: se toman solo
  // las estrictamente FUTURAS (fecha > hoy) para no repetir acá los mismos
  // ítems que ya se muestran en "Tareas de hoy" arriba — si preferís que
  // cuenten como una sola bolsa de 3 (pudiendo repetir tareas de hoy acá
  // también), es una condición para sacar.
  const proximasTareas = eventos
    .filter((ev) => ev.tipo === "tarea" && !ev.completada && ev.fecha > hoyISO)
    .sort(ordenarPorFechaYHora)
    .slice(0, CANTIDAD_PROXIMAS_TAREAS);
  if (proximasTareas.length > 0) {
    cont.appendChild(construirBloqueSeccion("Próximas tareas", construirListaEventos(proximasTareas)));
    huboContenido = true;
  }

  // 5. Exámenes próximos — dentro de las próximas 2 semanas desde hoy
  // (incluyendo hoy mismo).
  const examenesProximos = eventos
    .filter((ev) => ev.tipo === "examen" && ev.fecha >= hoyISO && ev.fecha <= limiteExamenesISO)
    .sort(ordenarPorFechaYHora);
  if (examenesProximos.length > 0) {
    cont.appendChild(construirBloqueSeccion("Exámenes próximos", construirListaEventos(examenesProximos)));
    huboContenido = true;
  }

  // 6. Próximo evento (incluye feriados, que son tipo "evento" con
  // esFeriado:true) — el más próximo dentro de los próximos 7 días.
  const proximoEvento = eventos
    .filter((ev) => ev.tipo === "evento" && ev.fecha >= hoyISO && ev.fecha <= limiteEventoISO)
    .sort(ordenarPorFechaYHora)[0];
  if (proximoEvento) {
    cont.appendChild(construirBloqueSeccion("Próximo evento", construirListaEventos([proximoEvento])));
    huboContenido = true;
  }

  // Si NINGUNA sección de agenda tuvo contenido (más allá del chip de
  // semana, que no cuenta como "pendiente"), mensaje positivo en vez de
  // dejar la vista en blanco.
  if (!huboContenido) {
    cont.appendChild(construirEstadoVacio());
  }
}

/** Sin wiring propio — Resumen no tiene controles ni modales, solo se
 *  repinta al entrar a la sección (ver mostrarSeccion en main.js) y cuando
 *  otros módulos llaman a window.renderizarResumen tras guardar algo (ver
 *  window.renderizarResumen más abajo). Se deja la función igual por
 *  consistencia con el patrón inicializarX()/renderizarX() que main.js ya
 *  espera de cada módulo de sección. */
function inicializarResumen() {}

// Mismo patrón que window.renderizarAgenda (agenda.js) y
// window.renderizarHorario (horario.js): se expone en window para que
// agenda-modal.js, horario-modal.js y storage-sync.js (aplicarDatosRemotosFrescos)
// puedan refrescar Resumen tras guardar/recibir datos frescos, sin crear un
// import circular nuevo.
window.renderizarResumen = renderizarResumen;

export { inicializarResumen, renderizarResumen };
