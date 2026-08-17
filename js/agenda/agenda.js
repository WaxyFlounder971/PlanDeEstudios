/* =========================================================================
   AGENDA — Núcleo
   Header fijo (Semestre/semana/día actual + pills Lista/Calendario +
   Agregar/Ajustes) + despacho entre las dos vistas. Esta vista (Lista) es
   cronológica: los 7 días de la semana mostrada, cada uno con sus materias
   inline y sus eventos/tareas/exámenes agrupados por tipo, con los días ya
   pasados colapsados bajo una flecha. La vista Calendario vive en
   agenda-calendario.js.
   ========================================================================= */

import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { mostrarSeccion } from "../main.js";
import { renderizarCalendarioAgenda } from "./agenda-calendario.js";
import { construirSeccionMateriasDia, calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { abrirModalEventoAgenda, inicializarModalAgendaEvento } from "./agenda-modal.js";
import { fechaLocalDesdeISO } from "../horario/horario.js";
import {
  esHoyFecha,
  formatearFechaISO,
  formatearRangoSemanaAgenda,
  obtenerDiasSemanaAgenda,
  obtenerFechaInicioSemanaAgenda,
  obtenerSemestreActivoAgenda,
} from "./agenda-utils.js";

const ETIQUETA_TIPO = { evento: "Eventos", tarea: "Tareas", examen: "Exámenes" };
const ORDEN_TIPO = ["examen", "tarea", "evento"];

// Transitorio (no persistido). "lista" | "calendario" — cuál de las 2
// vistas está activa ahora mismo (ver pills #pills-agenda-vista).
estado.agendaVistaActiva = estado.agendaVistaActiva || "lista";
// Semanas de offset respecto a la semana de hoy que Lista (y el submodo
// "Semanal" del Calendario, que la comparte a propósito) está mostrando.
estado.agendaOffsetSemana = estado.agendaOffsetSemana || 0;

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

/**
 * Rediseño núcleo Agenda — punto 4: mapa único de "cómo se pinta cada
 * combinación tipo/estado", para que badge (clase) y borde (hex, mismo tono
 * que el `border-color` de esa clase en design-system.css) nunca queden
 * desincronizados entre sí. `es_feriado`/`completada` son las 2 únicas
 * bifurcaciones dentro de un mismo tipo (ver crearEventoAgenda en
 * schema.js) — evento normal vs. feriado, tarea pendiente vs. completada.
 */
function obtenerEstiloEvento(evento) {
  if (evento.tipo === "tarea" && evento.completada) {
    return { etiqueta: "Completada", claseBadge: "badge-info", colorBorde: "#3b82f6" };
  }
  if (evento.tipo === "tarea") {
    return { etiqueta: "Tarea", claseBadge: "badge-warning", colorBorde: "#f59e0b" };
  }
  if (evento.tipo === "examen") {
    return { etiqueta: "Examen", claseBadge: "badge-danger", colorBorde: "#ef4444" };
  }
  if (evento.tipo === "evento" && evento.es_feriado) {
    return { etiqueta: "Feriado", claseBadge: "badge-success", colorBorde: "#10b981" };
  }
  return { etiqueta: "Evento", claseBadge: "badge-purple", colorBorde: "#a855f7" };
}

/**
 * Punto 6: "vencida" es SIEMPRE derivado (no se guarda — ver comentario del
 * spec en schema.js), se recalcula acá cada render comparando contra la
 * fecha de HOY en formato ISO (comparación lexicográfica de "YYYY-MM-DD",
 * válida sin parsear ninguna de las 2 fechas).
 */
function esTareaVencida(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  return evento.fecha < formatearFechaISO(new Date());
}

function tareaVenceHoy(evento) {
  if (evento.tipo !== "tarea" || evento.completada) return false;
  return evento.fecha === formatearFechaISO(new Date());
}

/** "3h 42min restantes" / "42min restantes" hasta las 23:59:59 del día de `fechaISO`. */
function formatearTiempoRestanteHoy(fechaISO) {
  const finDelDia = fechaLocalDesdeISO(fechaISO);
  finDelDia.setHours(23, 59, 59, 999);
  const msRestantes = finDelDia.getTime() - Date.now();
  if (msRestantes <= 0) return "Vence en instantes";
  const minutosTotales = Math.floor(msRestantes / 60000);
  const horas = Math.floor(minutosTotales / 60);
  const minutos = minutosTotales % 60;
  return horas > 0 ? `⏳ ${horas}h ${minutos}min restantes` : `⏳ ${minutos}min restantes`;
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

function construirItemEvento(evento) {
  const estilo = obtenerEstiloEvento(evento);

  const item = document.createElement("button");
  item.type = "button";
  item.className = "agenda-item";
  item.style.borderLeft = `3px solid ${estilo.colorBorde}`;

  if (evento.tipo === "tarea") {
    const check = document.createElement("button");
    check.type = "button";
    check.className = "agenda-check-completada" + (evento.completada ? " marcada" : "");
    check.title = evento.completada ? "Marcar como pendiente" : "Marcar como completada";
    check.addEventListener("click", (ev) => {
      ev.stopPropagation();
      alternarCompletadaEvento(evento.id);
    });
    item.appendChild(check);
  }

  const cuerpo = document.createElement("span");
  cuerpo.style.cssText = "flex:1; text-align:left; overflow-wrap:break-word;";
  const vencida = esTareaVencida(evento);
  const venceHoy = tareaVenceHoy(evento);
  cuerpo.innerHTML = `
    <div class="row" style="gap:6px; align-items:center; flex-wrap:wrap;">
      <span class="badge ${estilo.claseBadge}">${estilo.etiqueta}</span>
      ${vencida ? `<span class="agenda-badge-vencida">⚠ Vencida</span>` : ""}
    </div>
    <div style="font-weight:600; ${evento.completada ? "text-decoration:line-through; opacity:0.7;" : ""}">${evento.nombre || "(sin nombre)"}</div>
    ${construirBadgeMateria(evento)}
  `;
  item.appendChild(cuerpo);

  const lado = document.createElement("span");
  lado.className = "muted";
  lado.style.cssText = "font-size:0.78rem; flex-shrink:0; text-align:right;";
  if (venceHoy) {
    lado.innerHTML = `<span class="agenda-timer-vence-hoy">${formatearTiempoRestanteHoy(evento.fecha)}</span>`;
    const idIntervalo = setInterval(() => {
      const span = lado.querySelector(".agenda-timer-vence-hoy");
      if (!span || !span.isConnected) {
        clearInterval(idIntervalo);
        return;
      }
      span.textContent = formatearTiempoRestanteHoy(evento.fecha);
    }, 60000);
    intervalosVenceHoy.push(idIntervalo);
  } else {
    lado.textContent = evento.hora || "Todo el día";
  }
  item.appendChild(lado);

  item.addEventListener("click", () => abrirModalEventoAgenda({ eventoId: evento.id }));
  return item;
}

function construirBloqueDia(diaInfo, semestreActivo, mostrarDiasVacios) {
  const fechaISO = formatearFechaISO(diaInfo.fecha);
  const eventosDelDia = (estado.datos.agenda || [])
    .filter((ev) => ev.fecha === fechaISO)
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
 * Subheader de navegación semanal de Lista — se arma en JS (no vive fijo en
 * el HTML) por el mismo motivo que el subheader del Calendario
 * (agenda-calendario.js): cada vista tiene su propio criterio de "qué
 * significa avanzar/retroceder" (semana acá, mes o semana allá), así que no
 * pueden compartir una sola barra de navegación estática.
 */
function construirSubheaderLista(dias) {
  const wrap = document.createElement("section");
  wrap.className = "glass-panel row-between";
  wrap.style.padding = "10px 14px";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "btn-icono-fantasma";
  btnAnterior.style.fontSize = "1.3rem";
  btnAnterior.textContent = "‹";
  btnAnterior.addEventListener("click", () => {
    estado.agendaOffsetSemana -= 1;
    renderizarAgenda();
  });

  const centro = document.createElement("div");
  centro.className = "stack";
  centro.style.cssText = "align-items:center; text-align:center; gap:2px; flex:1;";
  const rango = document.createElement("span");
  rango.className = "texto-encabezado-seccion";
  rango.textContent = formatearRangoSemanaAgenda(dias);
  const volverHoy = document.createElement("span");
  volverHoy.className = "muted";
  volverHoy.style.cssText = "font-size:0.72rem; text-decoration:underline; cursor:pointer;";
  volverHoy.textContent = "Volver a hoy";
  volverHoy.addEventListener("click", () => {
    estado.agendaOffsetSemana = 0;
    renderizarAgenda();
  });
  centro.appendChild(rango);
  centro.appendChild(volverHoy);

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "btn-icono-fantasma";
  btnSiguiente.style.fontSize = "1.3rem";
  btnSiguiente.textContent = "›";
  btnSiguiente.addEventListener("click", () => {
    estado.agendaOffsetSemana += 1;
    renderizarAgenda();
  });

  wrap.appendChild(btnAnterior);
  wrap.appendChild(centro);
  wrap.appendChild(btnSiguiente);
  return wrap;
}

/**
 * Punto 7: header fijo con Semestre / semana / día actual, mismo tamaño de
 * letra que renderizarHeaderHorario (horario.js) — se llama desde
 * renderizarAgenda() (no desde renderizarAgendaInterno) para que quede
 * correcto sea cual sea la vista activa (Lista o Calendario), sin que este
 * archivo necesite tocar agenda-calendario.js. La "semana" mostrada es la
 * del PRIMER día de la semana actualmente navegada (estado.agendaOffsetSemana,
 * compartido con el submodo "Semanal" del Calendario) — no la semana de
 * hoy — para que quede en sintonía con lo que la persona está viendo.
 */
function renderizarHeaderAgenda() {
  const semestre = obtenerSemestreActivoAgenda();
  const nombreEl = document.getElementById("agenda-nombre-semestre");
  const semanaEl = document.getElementById("agenda-semana-actual");
  const fechaEl = document.getElementById("agenda-fecha-hoy");

  if (!semestre) {
    if (nombreEl) nombreEl.textContent = "Sin semestres";
    if (semanaEl) semanaEl.textContent = "—";
  } else {
    if (nombreEl) nombreEl.textContent = semestre.nombre || "";
    const primerDiaSemana = obtenerFechaInicioSemanaAgenda(estado.agendaOffsetSemana);
    const numeroSemana = calcularNumeroSemanaParaFecha(semestre, primerDiaSemana);
    if (semanaEl) semanaEl.textContent = `Semana ${numeroSemana}`;
  }
  // Siempre la fecha REAL de hoy (no la navegada) — es lo que hace que
  // tocarla tenga sentido como atajo "llevame a hoy" (ver listener en
  // inicializarAgenda).
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString("es-CR", { day: "numeric", month: "short" });
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
  cuerpo.className = "stack oculto";
  cuerpo.style.gap = "14px";
  bloquesPasados.forEach((b) => cuerpo.appendChild(b));

  boton.addEventListener("click", () => {
    cuerpo.classList.toggle("oculto");
    boton.querySelector(".agenda-colapso-pasados-flecha").style.transform = cuerpo.classList.contains("oculto")
      ? "rotate(0deg)"
      : "rotate(180deg)";
  });

  cont.appendChild(boton);
  cont.appendChild(cuerpo);
  return cont;
}

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  if (!cont) return;
  limpiarIntervalosVenceHoy();
  cont.innerHTML = "";

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí

  const dias = obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);
  cont.appendChild(construirSubheaderLista(dias));

  const semestreActivo = obtenerSemestreActivoAgenda();

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
  renderizarHeaderAgenda();
  const esLista = estado.agendaVistaActiva === "lista";
  document.getElementById("agenda-lista-dias")?.classList.toggle("oculto", !esLista);
  document.getElementById("agenda-vista-calendario")?.classList.toggle("oculto", esLista);
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vista === estado.agendaVistaActiva);
  });
  if (esLista) renderizarAgendaInterno();
  else renderizarCalendarioAgenda();
}

function inicializarAgenda() {
  inicializarModalAgendaEvento();

  document.getElementById("btn-agenda-agregar")?.addEventListener("click", () => {
    abrirModalEventoAgenda({ fechaDefault: new Date().toISOString().slice(0, 10) });
  });
  document.getElementById("btn-agenda-ir-ajustes")?.addEventListener("click", () => {
    mostrarSeccion("configuracion");
    document.getElementById("ajuste-seccion-agenda")?.classList.remove("colapsada");
    desplazarYResaltarElemento("#ajuste-seccion-agenda");
  });
  document.getElementById("agenda-fecha-hoy")?.addEventListener("click", () => {
    // Punto 7: siempre lleva a HOY, sin importar en qué vista/semana esté
    // parada la persona — si hace falta, cambia a Lista y resetea el
    // offset de semana antes de buscar el bloque a resaltar (mismo motivo
    // por el que desplazarYResaltarElemento reintenta con
    // requestAnimationFrame: el bloque puede no existir todavía en el DOM
    // en el mismo tick que se dispara este click).
    let necesitaRerender = false;
    if (estado.agendaVistaActiva !== "lista") {
      estado.agendaVistaActiva = "lista";
      necesitaRerender = true;
    }
    if (estado.agendaOffsetSemana !== 0) {
      estado.agendaOffsetSemana = 0;
      necesitaRerender = true;
    }
    if (necesitaRerender) renderizarAgenda();
    desplazarYResaltarElemento(`#agenda-lista-dias [data-fecha="${formatearFechaISO(new Date())}"]`);
  });

  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaVistaActiva = btn.dataset.vista;
      renderizarAgenda();
    });
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
