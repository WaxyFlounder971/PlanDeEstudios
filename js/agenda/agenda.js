/* =========================================================================
   AGENDA — Núcleo
   Header fijo (pills Lista/Calendario + Agregar/Ajustes) + despacho entre
   las dos vistas. Esta vista (Lista) es cronológica: los 7 días de la
   semana mostrada, cada uno con su tarjetita "Mostrar clases" y sus
   eventos/tareas/exámenes agrupados por tipo. La vista Calendario vive en
   agenda-calendario.js.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { mostrarSeccion } from "../main.js";
import { renderizarCalendarioAgenda } from "./agenda-calendario.js";
import { construirTarjetaClasesDia } from "./agenda-clases.js";
import { abrirModalEventoAgenda, inicializarModalAgendaEvento } from "./agenda-modal.js";
import {
  esHoyFecha,
  formatearFechaISO,
  formatearRangoSemanaAgenda,
  obtenerDiasSemanaAgenda,
  obtenerSemestreActivoAgenda,
} from "./agenda-utils.js";

const ETIQUETA_TIPO = { evento: "Eventos", tarea: "Tareas", examen: "Exámenes" };
const BADGE_TIPO = { evento: "badge-accent", tarea: "badge-warning", examen: "badge-danger" };
const ORDEN_TIPO = ["examen", "tarea", "evento"];

// Transitorio (no persistido). "lista" | "calendario" — cuál de las 2
// vistas está activa ahora mismo (ver pills #pills-agenda-vista).
estado.agendaVistaActiva = estado.agendaVistaActiva || "lista";
// Semanas de offset respecto a la semana de hoy que Lista (y el submodo
// "Semanal" del Calendario, que la comparte a propósito) está mostrando.
estado.agendaOffsetSemana = estado.agendaOffsetSemana || 0;

function construirBadgeMateria(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? `<span class="muted" style="font-size:0.72rem;">${aplicarFormatoTexto(materia.nombre)}</span>` : "";
}

function construirItemEvento(evento) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "agenda-item";
  item.innerHTML = `
    <span class="badge ${BADGE_TIPO[evento.tipo] || "badge-neutral"}">${ETIQUETA_TIPO[evento.tipo]?.slice(0, -1) || evento.tipo}</span>
    <span style="flex:1; text-align:left; overflow-wrap:break-word;">
      <div style="font-weight:600;">${evento.nombre || "(sin nombre)"}</div>
      ${construirBadgeMateria(evento)}
    </span>
    <span class="muted" style="font-size:0.78rem; flex-shrink:0;">${evento.hora || "Todo el día"}</span>
  `;
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

  if (semestreActivo) {
    bloque.appendChild(construirTarjetaClasesDia(semestreActivo, diaInfo.fecha, diaInfo.abrevDefault));
  }

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
    renderizarAgendaInterno();
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
    renderizarAgendaInterno();
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
    renderizarAgendaInterno();
  });

  wrap.appendChild(btnAnterior);
  wrap.appendChild(centro);
  wrap.appendChild(btnSiguiente);
  return wrap;
}

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  if (!cont) return;
  cont.innerHTML = "";

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí

  const dias = obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);
  cont.appendChild(construirSubheaderLista(dias));

  const semestreActivo = obtenerSemestreActivoAgenda();

  const bloques = dias.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);

  if (bloques.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.textAlign = "center";
    vacio.textContent = "Nada pendiente esta semana.";
    cont.appendChild(vacio);
  } else {
    bloques.forEach((b) => cont.appendChild(b));
  }
}

function renderizarAgenda() {
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
