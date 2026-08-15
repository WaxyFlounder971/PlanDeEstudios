/* =========================================================================
   AGENDA — Núcleo (vista Lista)
   Header con navegación semanal + botón agregar, y la lista cronológica de
   los 7 días de la semana mostrada, cada uno con su tarjetita "Mostrar
   clases" y sus eventos/tareas/exámenes agrupados por tipo.
   No incluye todavía la vista Calendario (prompt/entrega aparte).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { desplazarYResaltarElemento, mostrarToast } from "../ui/componentes.js";
import { mostrarSeccion } from "../main.js";
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

// Transitorio (no persistido): semanas de offset respecto a la semana de
// hoy que Agenda está mostrando ahora mismo. Mismo criterio que
// estado.horarioNumeroSemana en horario.js.
estado.agendaOffsetSemana = estado.agendaOffsetSemana || 0;

function nombreMateriaVinculada(evento) {
  if (!evento.materia_matriculada_id || !evento.semestre_id) return null;
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return null;
  // Import perezoso evitado a propósito: reconstruir el nombre exacto acá
  // requeriría obtenerPlanPorId + aplicarFormatoTexto, ya centralizados en
  // obtenerMateriasVinculablesAgenda (agenda-utils.js) — pero esa lista solo
  // trae materias del semestre ACTIVO, y un evento viejo puede apuntar a un
  // semestre que ya dejó de ser el activo. Se resuelve directo acá con la
  // misma lógica para cualquier semestre, no solo el activo.
  return mm.materia_id || null;
}

function construirBadgeMateria(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? `<span class="muted" style="font-size:0.72rem;">${materia.nombre}</span>` : "";
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

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  if (!cont) return;
  cont.innerHTML = "";

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí

  const dias = obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);
  document.getElementById("agenda-rango-semana").textContent = formatearRangoSemanaAgenda(dias);

  const semestreActivo = obtenerSemestreActivoAgenda();

  const bloques = dias
    .map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios))
    .filter(Boolean);

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
  renderizarAgendaInterno();
}

function inicializarAgenda() {
  inicializarModalAgendaEvento();

  document.getElementById("btn-agenda-semana-anterior")?.addEventListener("click", () => {
    estado.agendaOffsetSemana -= 1;
    renderizarAgendaInterno();
  });
  document.getElementById("btn-agenda-semana-siguiente")?.addEventListener("click", () => {
    estado.agendaOffsetSemana += 1;
    renderizarAgendaInterno();
  });
  document.getElementById("agenda-volver-hoy")?.addEventListener("click", () => {
    estado.agendaOffsetSemana = 0;
    renderizarAgendaInterno();
  });
  document.getElementById("btn-agenda-agregar")?.addEventListener("click", () => {
    abrirModalEventoAgenda({ fechaDefault: new Date().toISOString().slice(0, 10) });
  });
  document.getElementById("btn-agenda-ir-ajustes")?.addEventListener("click", () => {
    mostrarSeccion("configuracion");
    document.getElementById("ajuste-seccion-agenda")?.classList.remove("colapsada");
    desplazarYResaltarElemento("#ajuste-seccion-agenda");
  });

  // Vista Calendario todavía no existe (entrega aparte) — el tab queda
  // presente porque el spec lo pide como parte del selector, pero por ahora
  // solo avisa que está en construcción en vez de fallar en silencio.
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((b) => b.classList.toggle("active", b === btn));
      const esCalendario = btn.dataset.vista === "calendario";
      document.getElementById("agenda-lista-dias").classList.toggle("oculto", esCalendario);
      document.getElementById("agenda-vista-calendario").classList.toggle("oculto", !esCalendario);
      if (esCalendario) mostrarToast("Vista Calendario — próximamente");
    });
  });
}

window.renderizarAgenda = renderizarAgenda;

export { inicializarAgenda, renderizarAgenda };
