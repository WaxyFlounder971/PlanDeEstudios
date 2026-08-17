/* =========================================================================
   AGENDA — Núcleo
   Pills Lista/Calendario arriba de todo, header fijo debajo (nombre del
   semestre mostrado — tocable, abre el selector — + Agregar/Ajustes
   compactos) con un bloque dinámico que cambia según modo/vista (semana
   navegable + rango + Hoy en Semanal; "Ver días anteriores" + Hoy en Todo;
   solo Hoy en Calendario) + despacho entre las dos vistas. Esta vista
   (Lista) es cronológica: los 7 días de la semana mostrada, cada uno con
   sus materias inline y sus eventos/tareas/exámenes agrupados por tipo, con
   los días ya pasados colapsados bajo una flecha. La vista Calendario vive
   en agenda-calendario.js.
   ========================================================================= */

import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { obtenerSemestresOrdenCronologico } from "../semestres/semestres.js";
import { renderizarCalendarioAgenda } from "./agenda-calendario.js";
import { construirSeccionMateriasDia, calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { abrirModalEventoAgenda, abrirTarjetaInfoEventoAgenda, inicializarModalAgendaEvento } from "./agenda-modal.js";
import {
  esHoyFecha,
  esTareaVencida,
  formatearFechaISO,
  formatearRangoSemanaAgenda,
  formatearTiempoRestanteHoy,
  obtenerDiasSemanaAgenda,
  obtenerEstiloEvento,
  obtenerFechaInicioSemanaAgenda,
  obtenerRangoDiasAgendaTodo,
  obtenerSemestreActivoAgenda,
  tareaVenceHoy,
} from "./agenda-utils.js";

const ETIQUETA_TIPO = { evento: "Eventos", tarea: "Tareas", examen: "Exámenes" };
const ORDEN_TIPO = ["examen", "tarea", "evento"];

// Transitorio (no persistido). "lista" | "calendario" — cuál de las 2
// vistas está activa ahora mismo (ver pills #pills-agenda-vista).
estado.agendaVistaActiva = estado.agendaVistaActiva || "lista";
// Semanas de offset respecto a la semana de hoy que Lista (y el submodo
// "Semanal" del Calendario, que la comparte a propósito) está mostrando.
estado.agendaOffsetSemana = estado.agendaOffsetSemana || 0;
// Rediseño núcleo Agenda — punto 10: filtro de SESIÓN (no persistido, se
// resetea en cada carga de la app) — "semanal" (comportamiento clásico,
// navegación semana a semana) | "todo" (desde hoy hasta fin de semestre +
// 2 semanas, scroll libre sin paginar — ver obtenerRangoDiasAgendaTodo).
estado.agendaFiltroModo = estado.agendaFiltroModo || "semanal";
// Ronda de ajustes visuales — punto 2 (fix bug): estado de sesión de
// expandido/colapsado del bloque "‹ N días anteriores" (punto 8). Antes
// vivía SOLO como clase CSS en el <div> del cuerpo colapsable, armado
// adentro de construirColapsoDiasPasados — cualquier re-render completo de
// renderizarAgendaInterno (ej. el que dispara alternarCompletadaEvento al
// tocar el check circular de una tarea) tira `cont.innerHTML = ""` y
// reconstruye ese <div> desde cero, que siempre arrancaba con la clase
// "oculto" puesta — perdiendo el expandido y colapsándose solo. Ahora el
// estado vive acá (sobrevive a que el DOM se destruya y reconstruya) y
// construirColapsoDiasPasados solo LEE/actualiza esta bandera.
estado.agendaDiasPasadosExpandido = estado.agendaDiasPasadosExpandido || false;
// Punto 4: días adicionales hacia atrás que el control "Ver días
// anteriores" del subheader de modo Todo va sumando al rango — 0 = rango
// original (arranca en hoy, sin días previos). Sesión, no persistido, mismo
// criterio que el resto de estos flags.
estado.agendaTodoDiasAtras = estado.agendaTodoDiasAtras || 0;
// Ronda de ajustes visuales #2 — punto C: semestre que Agenda está
// mostrando, elegido a mano desde el popover del header (tocar el nombre
// del semestre, ver inicializarSelectorSemestreAgenda). `undefined` =
// "automático" (el criterio de siempre en obtenerSemestreActivoAgenda: el
// semestre "actual" más reciente). Sesión, no persistido — cada carga de
// la app vuelve a arrancar en automático. Cada semestre tiene su agenda
// separada: los eventos/tareas nuevos quedan etiquetados con el semestre
// que estaba activo al crearlos (ver guardarEventoAgenda en
// agenda-modal.js) y construirBloqueDia acá abajo solo muestra los que
// coinciden con el semestre mostrado (o que no tienen semestre asignado,
// por compatibilidad con datos de antes de este cambio).
estado.agendaSemestreSeleccionadoId = estado.agendaSemestreSeleccionadoId || null;
// Punto 10 + 12: arranca en el valor PERSISTENTE de Ajustes → Agenda
// (`agenda_mostrar_clases`, punto 12) pero solo para esta sesión: togglear
// acá (ventana de Filtros) nunca reescribe ese ajuste permanente.
//
// FIX URGENTE: esto vivía suelto en el top-level del módulo, corriendo
// contra estado.datos.configuracion sin ningún guard. Los imports de ES
// modules se evalúan de forma EAGER — en cuanto main.js hacía `import` de
// este archivo, esta línea corría YA, antes del login, con
// estado.datos === null todavía (recién se llena después de cargar la
// sesión). Eso tiraba un TypeError no capturado durante la evaluación del
// módulo, que cortaba en seco TODO lo que main.js hace después de sus
// imports — incluido el registro del Service Worker — dejando la app sin
// SW en NINGUNA carga y por lo tanto sin poder instalarse en Android
// (bug reportado). Ahora es una función lazy, llamada recién en el primer
// render real de Agenda (ver renderizarAgenda), momento en el que
// estado.datos ya está garantizado no-null.
function asegurarFiltroMostrarMateriasInicializado() {
  if (estado.agendaFiltroMostrarMaterias === undefined) {
    estado.agendaFiltroMostrarMaterias = estado.datos?.configuracion?.agenda_mostrar_clases !== false;
  }
}

/**
 * Rediseño núcleo Agenda — punto 6: intervalos vivos de los timers "vence
 * hoy" actualmente en pantalla. Se limpian al arrancar cada render de Lista
 * (ver renderizarAgendaInterno) para no acumular setInterval huérfanos
 * apuntando a nodos DOM ya descartados cada vez que se navega de semana o
 * se togglea el checkbox de completada.
 */
let intervalosVenceHoy = [];
function limpiarIntervalosVenceHoy() {
  intervalosVenceHoy.forEach((id) => clearInterval(id));
  intervalosVenceHoy = [];
}

function buscarEventoAgendaVivo(id) {
  return (estado.datos.agenda || []).find((ev) => ev.id === id) || null;
}

function construirBadgeMateria(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? `<span class="muted" style="font-size:0.72rem;">${aplicarFormatoTexto(materia.nombre)}</span>` : "";
}

/**
 * Punto 5: toggle del checkbox circular de "completada" — vive acá (no en
 * agenda-modal.js) porque no abre ningún modal, solo muta el campo y
 * refresca en el lugar; mismo patrón de "releer la entidad viva por id
 * antes de mutar" que usa agenda-modal.js (por si un sondeo remoto
 * reemplazó estado.datos mientras tanto).
 */
function alternarCompletadaEvento(eventoId) {
  const vivo = buscarEventoAgendaVivo(eventoId);
  if (!vivo) return;
  vivo.completada = !vivo.completada;
  sellarTimestamp(vivo);
  marcarCambioPendiente();
  renderizarAgendaInterno();
}

/**
 * Ronda de ajustes visuales — punto 1: layout de tarjeta reestructurado en
 * 2 columnas explícitas. Izquierda (nombre + materia, si tiene) anclada
 * arriba al nivel del nombre — por eso el item pasa a `align-items:
 * flex-start` en vez del `center` que trae `.agenda-item` por defecto (ver
 * design-system.css), así el nombre no queda centrado contra una columna
 * derecha más alta. Derecha apilada verticalmente: badge "Vencida" (si
 * aplica) → badge de tipo → hora — el badge de tipo usa el tamaño chico de
 * `.agenda-badge-vencida` (ver `.agenda-badge-tipo` en design-system.css)
 * para que ambos badges se lean como parte del mismo bloque, en vez del
 * badge grande genérico que traía antes.
 */
function construirItemEvento(evento) {
  const estilo = obtenerEstiloEvento(evento);

  const item = document.createElement("button");
  item.type = "button";
  item.className = "agenda-item";
  item.style.borderLeft = `3px solid ${estilo.colorBorde}`;
  item.style.alignItems = "flex-start";

  if (evento.tipo === "tarea") {
    const check = document.createElement("button");
    check.type = "button";
    check.className = "agenda-check-completada" + (evento.completada ? " marcada" : "");
    check.title = evento.completada ? "Marcar como pendiente" : "Marcar como completada";
    check.style.marginTop = "1px"; // óptico: centrado contra la línea del nombre, no del bloque entero
    check.addEventListener("click", (ev) => {
      ev.stopPropagation();
      alternarCompletadaEvento(evento.id);
    });
    item.appendChild(check);
  }

  // Columna izquierda: nombre + materia vinculada (si tiene).
  const izquierda = document.createElement("span");
  izquierda.style.cssText = "flex:1; min-width:0; text-align:left; overflow-wrap:break-word;";
  izquierda.innerHTML = `
    <div style="font-weight:600; ${evento.completada ? "text-decoration:line-through; opacity:0.7;" : ""}">${evento.nombre || "(sin nombre)"}</div>
    ${construirBadgeMateria(evento)}
  `;
  item.appendChild(izquierda);

  // Columna derecha: Vencida (opcional) -> badge de tipo -> hora, apilados.
  const vencida = esTareaVencida(evento);
  const venceHoy = tareaVenceHoy(evento);
  const derecha = document.createElement("span");
  derecha.className = "stack";
  derecha.style.cssText = "align-items:flex-end; gap:4px; flex-shrink:0; text-align:right;";
  derecha.innerHTML = `
    ${vencida ? `<span class="agenda-badge-vencida">⚠ Vencida</span>` : ""}
    <span class="badge agenda-badge-tipo ${estilo.claseBadge}">${estilo.etiqueta}</span>
  `;

  const hora = document.createElement("span");
  hora.className = "muted";
  hora.style.cssText = "font-size:0.78rem; white-space:nowrap;";
  if (venceHoy) {
    hora.innerHTML = `<span class="agenda-timer-vence-hoy">${formatearTiempoRestanteHoy(evento.fecha)}</span>`;
    const idIntervalo = setInterval(() => {
      const span = hora.querySelector(".agenda-timer-vence-hoy");
      if (!span || !span.isConnected) {
        clearInterval(idIntervalo);
        return;
      }
      span.textContent = formatearTiempoRestanteHoy(evento.fecha);
    }, 60000);
    intervalosVenceHoy.push(idIntervalo);
  } else {
    hora.textContent = evento.hora || "Todo el día";
  }
  derecha.appendChild(hora);
  item.appendChild(derecha);

  item.addEventListener("click", () => abrirTarjetaInfoEventoAgenda(evento.id));
  return item;
}

function construirBloqueDia(diaInfo, semestreActivo, mostrarDiasVacios) {
  const fechaISO = formatearFechaISO(diaInfo.fecha);
  const eventosDelDia = (estado.datos.agenda || [])
    .filter((ev) => ev.fecha === fechaISO)
    // Ronda de ajustes visuales #2 — punto C: cada semestre tiene su agenda
    // aparte — solo entran acá los eventos sin semestre asignado (datos de
    // antes de este cambio, o eventos creados sin semestre activo) o los
    // que coinciden con el semestre que se está mostrando ahora mismo.
    .filter((ev) => !ev.semestre_id || !semestreActivo || ev.semestre_id === semestreActivo.id)
    .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

  if (!mostrarDiasVacios && eventosDelDia.length === 0) return null;

  const bloque = document.createElement("section");
  bloque.className = "glass-panel stack";
  bloque.style.padding = "14px";
  // Ancla para el salto "Calendario -> Lista" (ver agenda-calendario.js,
  // saltarADiaEnLista) — así el clic en una celda del grid puede encontrar
  // y resaltar el bloque de ese día exacto con un simple selector.
  bloque.dataset.fecha = fechaISO;

  const hoy = esHoyFecha(diaInfo.fecha);
  const header = document.createElement("div");
  header.className = "row-between";
  header.innerHTML = `
    <div class="row" style="gap:8px;">
      <span style="font-weight:700;">${diaInfo.etiqueta}</span>
      <span class="muted" style="font-size:0.82rem;">${diaInfo.fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" })}</span>
    </div>
    ${hoy ? `<span class="badge badge-accent">Hoy</span>` : ""}
  `;
  bloque.appendChild(header);

  const seccionMaterias = construirSeccionMateriasDia(semestreActivo, diaInfo.fecha, diaInfo.abrevDefault);
  if (seccionMaterias) bloque.appendChild(seccionMaterias);

  if (eventosDelDia.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; margin:2px 0 0;";
    vacio.textContent = "Sin pendientes.";
    bloque.appendChild(vacio);
  } else {
    ORDEN_TIPO.forEach((tipo) => {
      const delTipo = eventosDelDia.filter((ev) => ev.tipo === tipo);
      if (delTipo.length === 0) return;
      const grupo = document.createElement("div");
      grupo.className = "stack";
      grupo.style.gap = "6px";
      const etiqueta = document.createElement("span");
      etiqueta.className = "muted";
      etiqueta.style.cssText = "font-size:0.7rem; text-transform:uppercase; letter-spacing:0.02em;";
      etiqueta.textContent = ETIQUETA_TIPO[tipo];
      grupo.appendChild(etiqueta);
      delTipo.forEach((ev) => grupo.appendChild(construirItemEvento(ev)));
      bloque.appendChild(grupo);
    });
  }

  return bloque;
}

/**
 * Ronda de ajustes visuales #2 — punto C: atajo "Hoy" compartido por los 3
 * modos (Semanal, Todo, Calendario) — antes vivía en un solo lugar fijo del
 * header (#agenda-fecha-hoy) que hacía de "llevame a hoy sea cual sea la
 * vista"; ahora se reconstruye cada vez que se arma #agenda-subheader-
 * dinamico, así que se centraliza acá el mismo comportamiento (incluido el
 * caso "estoy en Todo o en Calendario" → vuelve a Lista/Semanal, que es lo
 * que la persona espera al tocar "Hoy").
 */
function irAHoyAgenda() {
  let necesitaRerender = false;
  if (estado.agendaVistaActiva !== "lista") {
    estado.agendaVistaActiva = "lista";
    necesitaRerender = true;
  }
  if (estado.agendaFiltroModo !== "semanal") {
    estado.agendaFiltroModo = "semanal";
    estado.agendaTodoDiasAtras = 0;
    necesitaRerender = true;
  }
  if (estado.agendaOffsetSemana !== 0) {
    estado.agendaOffsetSemana = 0;
    necesitaRerender = true;
  }
  if (necesitaRerender) renderizarAgenda();
  desplazarYResaltarElemento(`#agenda-lista-dias [data-fecha="${formatearFechaISO(new Date())}"]`);
}

function construirEnlaceHoyAgenda() {
  const hoy = document.createElement("span");
  hoy.className = "muted";
  hoy.style.cssText = "font-size:0.74rem; text-decoration:underline; cursor:pointer;";
  hoy.textContent = "Hoy";
  hoy.addEventListener("click", irAHoyAgenda);
  return hoy;
}

/**
 * Ronda de ajustes visuales #2 — punto C: encabezado unificado del modo
 * Semanal — antes esto eran 2 paneles separados: uno fijo arriba (Semestre
 * / "Semana N" / fecha de hoy, armado por renderizarHeaderAgenda) y otro
 * aparte dentro de la lista con las flechas ‹ › alrededor del RANGO de
 * fechas (construirSubheaderLista). Ahora es un solo bloque, inyectado en
 * #agenda-subheader-dinamico (adentro de #agenda-header): las flechas pasan
 * a rodear "Semana N" (no el rango), el rango de fechas queda como texto
 * informativo debajo, y "Hoy" cierra el bloque — mismo layout que pidió el
 * spec.
 */
function construirSubheaderSemanal(dias, semestreActivo) {
  const frag = document.createDocumentFragment();

  const filaSemana = document.createElement("div");
  filaSemana.className = "row";
  filaSemana.style.cssText = "align-items:center; justify-content:center; gap:6px;";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "btn-icono-fantasma";
  btnAnterior.style.fontSize = "1.3rem";
  btnAnterior.textContent = "‹";
  btnAnterior.addEventListener("click", () => {
    estado.agendaOffsetSemana -= 1;
    renderizarAgenda();
  });

  const numeroSemana = semestreActivo
    ? calcularNumeroSemanaParaFecha(semestreActivo, obtenerFechaInicioSemanaAgenda(estado.agendaOffsetSemana))
    : null;
  const etiquetaSemana = document.createElement("span");
  etiquetaSemana.className = "texto-encabezado-seccion";
  etiquetaSemana.textContent = numeroSemana ? `Semana ${numeroSemana}` : "Semana";

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "btn-icono-fantasma";
  btnSiguiente.style.fontSize = "1.3rem";
  btnSiguiente.textContent = "›";
  btnSiguiente.addEventListener("click", () => {
    estado.agendaOffsetSemana += 1;
    renderizarAgenda();
  });

  filaSemana.appendChild(btnAnterior);
  filaSemana.appendChild(etiquetaSemana);
  filaSemana.appendChild(btnSiguiente);

  // Ronda de ajustes visuales #3: rango de fechas y "Hoy" ahora comparten
  // una sola línea (antes eran 2 líneas sueltas) para que el bloque
  // central completo (esta fila + filaSemana arriba) quepa en las 2 líneas
  // que le corresponden dentro del header de 3 líneas — ver #agenda-header
  // en index.html.
  const filaRango = document.createElement("div");
  filaRango.className = "row";
  filaRango.style.cssText = "align-items:baseline; justify-content:center; gap:8px;";

  const rango = document.createElement("span");
  rango.className = "muted";
  rango.style.fontSize = "0.78rem";
  rango.textContent = formatearRangoSemanaAgenda(dias);

  filaRango.appendChild(rango);
  filaRango.appendChild(construirEnlaceHoyAgenda());

  frag.appendChild(filaSemana);
  frag.appendChild(filaRango);
  return frag;
}

/**
 * Header fijo: solo el nombre del semestre mostrado, tocable (abre el
 * popover del selector — ver inicializarSelectorSemestreAgenda). El resto
 * de lo que antes vivía acá (Semana N, atajo a hoy) se movió al bloque
 * dinámico de abajo (construirSubheaderSemanal/construirEnlaceHoyAgenda),
 * que sí depende de qué modo/vista está activo.
 */
function renderizarHeaderAgenda() {
  const semestre = obtenerSemestreActivoAgenda();
  const nombreEl = document.getElementById("agenda-nombre-semestre");
  if (!nombreEl) return;
  nombreEl.textContent = semestre ? semestre.nombre || "Semestre" : "Sin semestres";
}

/**
 * Ronda de ajustes visuales #2 — punto C: popover del selector de semestre
 * — tocar el nombre del semestre en el header abre esta lista (mismo patrón
 * que #perfil-popover: absoluto, colgado del contenedor, se cierra tocando
 * afuera). Elegir uno lo fija como "semestre mostrado" de Agenda (sesión) —
 * ver estado.agendaSemestreSeleccionadoId y obtenerSemestreActivoAgenda en
 * agenda-utils.js.
 */
function poblarPopoverSemestreAgenda() {
  const pop = document.getElementById("agenda-semestre-popover");
  if (!pop) return;
  pop.innerHTML = "";

  const semestres = obtenerSemestresOrdenCronologico();
  if (semestres.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; padding:6px 8px; margin:0;";
    vacio.textContent = "No hay semestres creados todavía.";
    pop.appendChild(vacio);
    return;
  }

  const activo = obtenerSemestreActivoAgenda();
  semestres
    .slice()
    .reverse() // más reciente primero, mismo criterio que el resto de estos selectores
    .forEach((s) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agenda-semestre-popover-item" + (activo && activo.id === s.id ? " active" : "");
      btn.textContent = s.nombre || "Semestre";
      btn.addEventListener("click", () => {
        estado.agendaSemestreSeleccionadoId = s.id;
        estado.agendaOffsetSemana = 0;
        cerrarPopoverSemestreAgenda();
        renderizarAgenda();
      });
      pop.appendChild(btn);
    });
}

function cerrarPopoverSemestreAgenda() {
  document.getElementById("agenda-semestre-popover")?.classList.add("oculto");
}

function alternarPopoverSemestreAgenda(ev) {
  ev.stopPropagation();
  const pop = document.getElementById("agenda-semestre-popover");
  if (!pop) return;
  if (!pop.classList.contains("oculto")) {
    cerrarPopoverSemestreAgenda();
    return;
  }
  poblarPopoverSemestreAgenda();
  pop.classList.remove("oculto");
}

/**
 * Punto 8: los días de la semana visible anteriores a hoy se agrupan bajo
 * un único toggle "‹ N días anteriores" (colapsado por default) en vez de
 * mostrarse cada uno suelto — al presionarlo se expanden todos juntos.
 * Recibe los bloques YA construidos (no fechas) porque el llamador ya tuvo
 * que decidir cuáles cuentan como "pasados" para el resto del layout.
 */
function construirColapsoDiasPasados(bloquesPasados) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "10px";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "agenda-colapso-pasados";
  const plural = bloquesPasados.length === 1 ? "día anterior" : "días anteriores";
  boton.innerHTML = `
    <span class="agenda-colapso-pasados-flecha">‹</span>
    <span>${bloquesPasados.length} ${plural}</span>
  `;

  const cuerpo = document.createElement("div");
  cuerpo.className = "stack" + (estado.agendaDiasPasadosExpandido ? "" : " oculto");
  cuerpo.style.gap = "14px";
  bloquesPasados.forEach((b) => cuerpo.appendChild(b));

  const flecha = boton.querySelector(".agenda-colapso-pasados-flecha");
  flecha.style.transform = estado.agendaDiasPasadosExpandido ? "rotate(180deg)" : "rotate(0deg)";

  boton.addEventListener("click", () => {
    estado.agendaDiasPasadosExpandido = !estado.agendaDiasPasadosExpandido;
    cuerpo.classList.toggle("oculto", !estado.agendaDiasPasadosExpandido);
    flecha.style.transform = estado.agendaDiasPasadosExpandido ? "rotate(180deg)" : "rotate(0deg)";
  });

  cont.appendChild(boton);
  cont.appendChild(cuerpo);
  return cont;
}

/**
 * Punto 10 (modo "Todo"): acá no hay "semana navegada" que retroceder/
 * avanzar, es un scroll libre continuo desde hoy.
 *
 * Ronda de ajustes visuales — punto 4: en vez de informar el rango con
 * texto fijo ("Desde hoy hasta el..."), hay un control "Ver días
 * anteriores" que suma semanas hacia atrás (estado.agendaTodoDiasAtras,
 * consumido por obtenerRangoDiasAgendaTodo — ver agenda-utils.js) cada vez
 * que se toca.
 *
 * Ronda de ajustes visuales #2 — punto E (fix): antes solo se podía
 * expandir, sin forma de volver atrás — agrega un segundo botón "Ocultar
 * días anteriores" (solo visible una vez que ya se expandió algo) que
 * colapsa de nuevo a 0. Ambos botones comparten ajustarDiasAtrasTodo(), que
 * hace el mismo ajuste de scroll en los 2 sentidos (agrandar arriba corre
 * todo hacia abajo, achicar arriba lo corre hacia arriba — misma resta,
 * signo distinto).
 */
function ajustarDiasAtrasTodo(nuevoValor) {
  const cont = document.getElementById("agenda-lista-dias");
  const scrollEl = document.scrollingElement || document.documentElement;
  const scrollAntes = scrollEl.scrollTop;
  const altoAntes = cont?.scrollHeight || 0;

  estado.agendaTodoDiasAtras = Math.max(0, nuevoValor);
  renderizarAgendaInterno();

  // El contenido nuevo/quitado se agrega o saca por ARRIBA de lo que ya
  // estaba, así que sin esto el navegador mantiene el mismo scrollTop en
  // píxeles y todo lo que la persona tenía a la vista se corre — se
  // compensa sumando exactamente lo que cambió el contenedor por encima
  // (positivo al expandir, negativo al colapsar).
  requestAnimationFrame(() => {
    const altoDespues = cont?.scrollHeight || 0;
    scrollEl.scrollTop = scrollAntes + (altoDespues - altoAntes);
  });
}

/**
 * Ronda de ajustes visuales #4 — fix: antes se agregaba "Ver días
 * anteriores" SIEMPRE y "Ocultar días anteriores" se sumaba aparte cuando
 * ya había algo expandido, así que una vez expandido quedaban los DOS
 * botones a la vez. Ahora es un solo botón que cambia de texto/acción
 * según el estado — mismo patrón if/else que el resto del proyecto usa
 * para alternar entre 2 acciones mutuamente excluyentes.
 */
function construirSubheaderTodo() {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.style.cssText = "justify-content:center; flex-wrap:wrap; gap:6px 16px;";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn-discreto";
  boton.style.fontSize = "0.8rem";

  if (estado.agendaTodoDiasAtras > 0) {
    boton.textContent = "› Ocultar días anteriores";
    boton.addEventListener("click", () => ajustarDiasAtrasTodo(0));
  } else {
    boton.textContent = "‹ Ver días anteriores";
    boton.addEventListener("click", () => ajustarDiasAtrasTodo(estado.agendaTodoDiasAtras + 7));
  }
  wrap.appendChild(boton);

  return wrap;
}

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  const subCont = document.getElementById("agenda-subheader-dinamico");
  if (!cont) return;
  limpiarIntervalosVenceHoy();
  cont.innerHTML = "";
  if (subCont) subCont.innerHTML = "";

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí
  const semestreActivo = obtenerSemestreActivoAgenda();
  const modoTodo = estado.agendaFiltroModo === "todo";

  // Punto 10: en modo "Todo" el rango arranca siempre en HOY (nunca hay
  // días previos a colapsar — ver obtenerRangoDiasAgendaTodo), así que el
  // colapso de días pasados del punto 8 es exclusivo del modo "Semanal".
  const dias = modoTodo
    ? obtenerRangoDiasAgendaTodo(semestreActivo, estado.agendaTodoDiasAtras)
    : obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);

  if (subCont) {
    if (modoTodo) {
      subCont.appendChild(construirSubheaderTodo());
      subCont.appendChild(construirEnlaceHoyAgenda());
    } else {
      subCont.appendChild(construirSubheaderSemanal(dias, semestreActivo));
    }
  }

  if (modoTodo) {
    const bloques = dias.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);
    if (bloques.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.textAlign = "center";
      vacio.textContent = "Nada pendiente en este rango.";
      cont.appendChild(vacio);
    } else {
      bloques.forEach((b) => cont.appendChild(b));
    }
    return;
  }

  // Punto 8: se separan los días ya pasados (fecha < hoy) del resto ANTES
  // de construir los bloques, para poder envolver solo los pasados en el
  // colapso — hoy y los días futuros siguen sueltos, como siempre.
  const hoyISO = formatearFechaISO(new Date());
  const diasPasados = dias.filter((d) => formatearFechaISO(d.fecha) < hoyISO);
  const diasDesdeHoy = dias.filter((d) => formatearFechaISO(d.fecha) >= hoyISO);

  const bloquesPasados = diasPasados.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);
  const bloquesDesdeHoy = diasDesdeHoy.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);

  if (bloquesPasados.length === 0 && bloquesDesdeHoy.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.textAlign = "center";
    vacio.textContent = "Nada pendiente esta semana.";
    cont.appendChild(vacio);
    return;
  }

  if (bloquesPasados.length > 0) {
    cont.appendChild(construirColapsoDiasPasados(bloquesPasados));
  }
  bloquesDesdeHoy.forEach((b) => cont.appendChild(b));
}

function renderizarAgenda() {
  asegurarFiltroMostrarMateriasInicializado();
  renderizarHeaderAgenda();
  const esLista = estado.agendaVistaActiva === "lista";
  document.getElementById("agenda-lista-dias")?.classList.toggle("oculto", !esLista);
  document.getElementById("agenda-vista-calendario")?.classList.toggle("oculto", esLista);
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vista === estado.agendaVistaActiva);
  });
  if (esLista) {
    renderizarAgendaInterno();
  } else {
    // Vista Calendario: arma su propia navegación de mes/semana adentro de
    // #agenda-vista-calendario (agenda-calendario.js) — acá el bloque
    // dinámico del header solo necesita el atajo "Hoy", compartido entre
    // los 3 modos (ver irAHoyAgenda).
    const subCont = document.getElementById("agenda-subheader-dinamico");
    if (subCont) {
      subCont.innerHTML = "";
      subCont.appendChild(construirEnlaceHoyAgenda());
    }
    renderizarCalendarioAgenda();
  }
}

/**
 * Ronda de ajustes visuales #2 — punto C: wiring del selector de semestre
 * — tocar el nombre abre/cierra el popover (alternarPopoverSemestreAgenda),
 * y un click en cualquier otro lado del documento lo cierra (mismo patrón
 * que el resto de popovers del proyecto, ej. #perfil-popover).
 */
function inicializarSelectorSemestreAgenda() {
  document.getElementById("agenda-nombre-semestre")?.addEventListener("click", alternarPopoverSemestreAgenda);
  document.addEventListener("click", (ev) => {
    const pop = document.getElementById("agenda-semestre-popover");
    if (!pop || pop.classList.contains("oculto")) return;
    const btn = document.getElementById("agenda-nombre-semestre");
    if (pop.contains(ev.target) || btn?.contains(ev.target)) return;
    cerrarPopoverSemestreAgenda();
  });
}

function inicializarAgenda() {
  inicializarModalAgendaEvento();

  document.getElementById("btn-agenda-agregar")?.addEventListener("click", () => {
    abrirModalEventoAgenda({ fechaDefault: new Date().toISOString().slice(0, 10) });
  });

  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaVistaActiva = btn.dataset.vista;
      renderizarAgenda();
    });
  });

  inicializarSelectorSemestreAgenda();
  inicializarFiltrosAgenda();
}

/**
 * Ronda de ajustes visuales — punto 3: los 3 botones de antes (Agregar /
 * engranaje-a-Ajustes-global / Filtros) quedan en 2 — Agregar y un único
 * engranaje (#btn-agenda-ajustes) que abre ESTA ventana combinada. Junta
 * los 2 controles de SESIÓN que ya vivían en el viejo modal de Filtros
 * ("Mostrar: Semanal/Todo" y "Mostrar materias en la agenda") con el
 * control PERSISTENTE que antes vivía suelto en Ajustes → Agenda
 * ("Mostrar días sin eventos ni tareas",
 * `configuracion.agenda_mostrar_dias_vacios` — ver renderizarAgendaInterno
 * más arriba). Esa sección de Ajustes global ya NO existe — este modal,
 * accesible solo desde acá, es el único lugar donde se toca.
 *
 * Ronda de ajustes visuales #2 — punto D: el otro control persistente que
 * vivía acá ("Mostrar clases ese día", `agenda_mostrar_clases`) se quitó
 * por completo — pedido explícito, no tenía un propósito claro para la
 * persona usuaria (en la práctica duplicaba lo que ya hace "Mostrar
 * materias en la agenda"). El campo sigue en el schema por compatibilidad
 * con datos viejos, pero ya no hay forma de tocarlo desde la UI.
 *
 * Los 3 controles aplican al toque (sin botón "Aplicar" separado) y
 * re-renderizan Agenda en el momento — el modal en sí se cierra con el
 * botón "✕" (auto-inyectado, ver inicializarBotonesCerrarModal en
 * componentes.js) o tocando el fondo.
 */
function inicializarFiltrosAgenda() {
  const modal = document.getElementById("modal-agenda-ajustes");
  if (!modal) return;

  document.getElementById("btn-agenda-ajustes")?.addEventListener("click", () => {
    asegurarFiltroMostrarMateriasInicializado();
    document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === estado.agendaFiltroModo);
    });
    document.getElementById("chk-agenda-filtro-materias").checked = estado.agendaFiltroMostrarMaterias;
    // El persistente se lee directo de configuracion cada vez que se abre
    // (no de un estado de sesión propio) — mismo dato que antes vivía en
    // Ajustes global, solo que ahora se edita desde acá.
    const cfg = estado.datos.configuracion;
    document.getElementById("chk-agenda-mostrar-dias-vacios").checked = cfg.agenda_mostrar_dias_vacios !== false;
    modal.classList.remove("oculto");
  });

  document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaFiltroModo = btn.dataset.valor;
      document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      // Punto 10: cambiar de modo mientras se está a mitad de semana no
      // tiene un offset equivalente en "Todo" (que siempre arranca en HOY)
      // — se resetea el offset acá para que volver a "Semanal" más tarde
      // no deje a la persona parada en una semana que ya no recuerda por
      // qué eligió.
      estado.agendaOffsetSemana = 0;
      // Punto 4: los días extra que "Ver días anteriores" fue sumando son
      // propios de esta entrada al modo Todo — si se sale y se vuelve a
      // entrar más tarde, arranca de nuevo en el rango original.
      estado.agendaTodoDiasAtras = 0;
      renderizarAgenda();
    });
  });

  document.getElementById("chk-agenda-filtro-materias")?.addEventListener("change", (ev) => {
    estado.agendaFiltroMostrarMaterias = ev.target.checked;
    renderizarAgenda();
  });

  // Control persistente (antes en Ajustes → Agenda, ver config-ajustes.js):
  // mismo criterio de "undefined = default sí" que tenía allá, mismo
  // sellarTimestamp + marcarCambioPendiente que cualquier otro cambio de
  // configuracion. Ronda de ajustes visuales #2 — punto D: el otro control
  // persistente que vivía acá ("Mostrar clases ese día",
  // agenda_mostrar_clases) se quitó — no tenía un propósito claro para la
  // persona usuaria (duplicaba, en la práctica, lo que ya hace "Mostrar
  // materias en la agenda" arriba).
  document.getElementById("chk-agenda-mostrar-dias-vacios")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_mostrar_dias_vacios = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  modal.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-ajustes") modal.classList.add("oculto");
  });
}

// Expuesta en window: agenda-modal.js (guardar/borrar) necesita poder
// refrescar sin crear un import circular de vuelta hacia este archivo —
// mismo patrón que window.renderizarHorario en horario.js. agenda-
// calendario.js, en cambio, SÍ importa renderizarAgenda directo (ciclo
// intencional, igual que main.js <-> semestres.js): lo necesita en el mismo
// tick del click del usuario sobre una celda del grid.
window.renderizarAgenda = renderizarAgenda;

export { inicializarAgenda, renderizarAgenda };
