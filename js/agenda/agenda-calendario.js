/* =========================================================================
   AGENDA — Vista Calendario (mensual/semanal)
   Grid de 7 columnas con un vistazo rápido de eventos/tareas/exámenes (y
   si hay clases) por día. Tocar un día salta a la vista Lista, ya parada
   en la semana correcta — reutiliza el render de Lista en vez de duplicar
   el detalle del día acá también.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { contarClasesDelDia } from "./agenda-clases.js";
import { renderizarAgenda } from "./agenda.js";
import {
  esHoyFecha,
  formatearFechaISO,
  obtenerCodigoDiaSemana,
  obtenerDiasSemanaAgenda,
  obtenerDiasSemanaOrdenAgenda,
  obtenerInicioSemanaQueContiene,
  obtenerOffsetSemanaParaFecha,
  obtenerSemestreActivoAgenda,
} from "./agenda-utils.js";

const BADGE_TIPO_DOT = { evento: "#60a5fa", tarea: "#f59e0b", examen: "#ef4444" };

// Transitorio (no persistido). "semanal" comparte estado.agendaOffsetSemana
// con la vista Lista a propósito: navegar la semana desde acá deja Lista ya
// parada en la misma semana si el usuario cambia de pestaña.
estado.agendaCalendarioModo = estado.agendaCalendarioModo || "mensual";
estado.agendaCalendarioOffsetMes = estado.agendaCalendarioOffsetMes || 0;

function obtenerFechaBaseMes(offsetMeses) {
  const hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth() + offsetMeses, 1);
}

function saltarADiaEnLista(fecha) {
  estado.agendaOffsetSemana = obtenerOffsetSemanaParaFecha(fecha);
  estado.agendaVistaActiva = "lista";
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vista === "lista");
  });
  renderizarAgenda();
  // El bloque del día tiene data-fecha="YYYY-MM-DD" (ver agenda.js) — se
  // espera un frame a que el DOM de Lista ya esté armado antes de buscarlo.
  requestAnimationFrame(() => desplazarYResaltarElemento(`[data-fecha="${formatearFechaISO(fecha)}"]`));
}

/** Resumen de una fecha: conteos por tipo + si hay clases ese día. */
function resumenDia(fecha, semestreActivo) {
  const fechaISO = formatearFechaISO(fecha);
  const eventos = (estado.datos.agenda || []).filter((ev) => ev.fecha === fechaISO);
  const conteoPorTipo = { evento: 0, tarea: 0, examen: 0 };
  eventos.forEach((ev) => {
    if (conteoPorTipo[ev.tipo] !== undefined) conteoPorTipo[ev.tipo] += 1;
  });
  const tieneClases = semestreActivo
    ? contarClasesDelDia(semestreActivo, fecha, obtenerCodigoDiaSemana(fecha)) > 0
    : false;
  return { conteoPorTipo, total: eventos.length, tieneClases };
}

function construirCabeceraDiasSemana() {
  const fila = document.createElement("div");
  fila.className = "agenda-cal-grid agenda-cal-fila-cabecera";
  obtenerDiasSemanaOrdenAgenda().forEach((dia) => {
    const celda = document.createElement("div");
    celda.className = "agenda-cal-cabecera-dia muted";
    celda.textContent = dia.etiquetaCorta;
    fila.appendChild(celda);
  });
  return fila;
}

/** `detallada`: true en semanal (celdas grandes, muestran nombres); false en mensual (solo puntos). */
function construirCelda(fecha, { delMesActual, detallada, semestreActivo }) {
  const { conteoPorTipo, total, tieneClases } = resumenDia(fecha, semestreActivo);
  const hoy = esHoyFecha(fecha);

  const celda = document.createElement("button");
  celda.type = "button";
  celda.className =
    "agenda-cal-celda" + (hoy ? " agenda-cal-celda-hoy" : "") + (delMesActual === false ? " agenda-cal-celda-fuera-mes" : "");

  const puntos = Object.entries(conteoPorTipo)
    .filter(([, n]) => n > 0)
    .map(([tipo]) => `<span class="agenda-cal-punto" style="background:${BADGE_TIPO_DOT[tipo]};"></span>`)
    .join("");

  if (!detallada) {
    celda.innerHTML = `
      <span class="agenda-cal-numero">${fecha.getDate()}</span>
      <span class="agenda-cal-indicadores">
        ${puntos}
        ${tieneClases ? `<span class="agenda-cal-clases-dot" title="Hay clases">📚</span>` : ""}
      </span>
    `;
  } else {
    const eventosDelDia = (estado.datos.agenda || [])
      .filter((ev) => ev.fecha === formatearFechaISO(fecha))
      .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));
    const nombresVisibles = eventosDelDia.slice(0, 3);
    const restantes = eventosDelDia.length - nombresVisibles.length;
    celda.innerHTML = `
      <div class="row-between" style="width:100%;">
        <span class="agenda-cal-numero">${fecha.getDate()}</span>
        ${tieneClases ? `<span title="Hay clases">📚</span>` : ""}
      </div>
      <div class="stack" style="gap:2px; width:100%; margin-top:4px;">
        ${nombresVisibles
          .map(
            (ev) =>
              `<span class="agenda-cal-nombre-evento" style="border-left:3px solid ${BADGE_TIPO_DOT[ev.tipo] || "#94a3b8"};">${ev.nombre || "(sin nombre)"}</span>`
          )
          .join("")}
        ${restantes > 0 ? `<span class="muted" style="font-size:0.68rem;">+${restantes} más</span>` : ""}
      </div>
    `;
  }

  celda.title = total > 0 ? `${total} pendiente${total === 1 ? "" : "s"}` : "";
  celda.addEventListener("click", () => saltarADiaEnLista(fecha));
  return celda;
}

function construirGridMensual(semestreActivo) {
  const baseMes = obtenerFechaBaseMes(estado.agendaCalendarioOffsetMes);
  const primerDiaMes = new Date(baseMes.getFullYear(), baseMes.getMonth(), 1);
  const ultimoDiaMes = new Date(baseMes.getFullYear(), baseMes.getMonth() + 1, 0);
  const inicioGrid = obtenerInicioSemanaQueContiene(primerDiaMes);
  const finGrid = obtenerInicioSemanaQueContiene(ultimoDiaMes);
  finGrid.setDate(finGrid.getDate() + 6);

  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "4px";
  cont.appendChild(construirCabeceraDiasSemana());

  const grid = document.createElement("div");
  grid.className = "agenda-cal-grid";
  const cursor = new Date(inicioGrid);
  while (cursor <= finGrid) {
    grid.appendChild(
      construirCelda(new Date(cursor), {
        delMesActual: cursor.getMonth() === baseMes.getMonth(),
        detallada: false,
        semestreActivo,
      })
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  cont.appendChild(grid);
  return { cont, tituloRango: baseMes.toLocaleDateString("es-CR", { month: "long", year: "numeric" }) };
}

function construirGridSemanal(semestreActivo) {
  const dias = obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);

  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "4px";
  cont.appendChild(construirCabeceraDiasSemana());

  const grid = document.createElement("div");
  grid.className = "agenda-cal-grid agenda-cal-grid-semanal";
  dias.forEach((dia) => {
    grid.appendChild(construirCelda(dia.fecha, { detallada: true, semestreActivo }));
  });
  cont.appendChild(grid);

  const primero = dias[0].fecha;
  const ultimo = dias[dias.length - 1].fecha;
  const mismoMes = primero.getMonth() === ultimo.getMonth();
  const tituloRango = mismoMes
    ? `${primero.getDate()} - ${ultimo.getDate()} ${ultimo.toLocaleDateString("es-CR", { month: "short" })}`
    : `${primero.toLocaleDateString("es-CR", { day: "numeric", month: "short" })} - ${ultimo.toLocaleDateString("es-CR", { day: "numeric", month: "short" })}`;
  return { cont, tituloRango };
}

function construirSubheaderCalendario() {
  const wrap = document.createElement("div");
  wrap.className = "stack";

  const pillsModo = document.createElement("div");
  pillsModo.className = "pill-group";
  pillsModo.style.maxWidth = "220px";
  ["mensual", "semanal"].forEach((modo) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.agendaCalendarioModo === modo ? " active" : "");
    btn.textContent = modo === "mensual" ? "Mensual" : "Semanal";
    btn.addEventListener("click", () => {
      estado.agendaCalendarioModo = modo;
      renderizarCalendarioAgenda();
    });
    pillsModo.appendChild(btn);
  });

  const filaNav = document.createElement("div");
  filaNav.className = "row-between";
  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "btn-icono-fantasma";
  btnAnterior.style.fontSize = "1.3rem";
  btnAnterior.textContent = "‹";

  const centro = document.createElement("div");
  centro.className = "stack";
  centro.style.cssText = "align-items:center; text-align:center; gap:2px; flex:1;";
  const tituloRango = document.createElement("span");
  tituloRango.className = "texto-encabezado-seccion";
  tituloRango.id = "agenda-cal-titulo-rango";
  const volverHoy = document.createElement("span");
  volverHoy.className = "muted";
  volverHoy.style.cssText = "font-size:0.72rem; text-decoration:underline; cursor:pointer;";
  volverHoy.textContent = "Volver a hoy";
  centro.appendChild(tituloRango);
  centro.appendChild(volverHoy);

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "btn-icono-fantasma";
  btnSiguiente.style.fontSize = "1.3rem";
  btnSiguiente.textContent = "›";

  const avanzar = (direccion) => {
    if (estado.agendaCalendarioModo === "mensual") estado.agendaCalendarioOffsetMes += direccion;
    else estado.agendaOffsetSemana += direccion;
    renderizarCalendarioAgenda();
  };
  btnAnterior.addEventListener("click", () => avanzar(-1));
  btnSiguiente.addEventListener("click", () => avanzar(1));
  volverHoy.addEventListener("click", () => {
    estado.agendaCalendarioOffsetMes = 0;
    estado.agendaOffsetSemana = 0;
    renderizarCalendarioAgenda();
  });

  filaNav.appendChild(btnAnterior);
  filaNav.appendChild(centro);
  filaNav.appendChild(btnSiguiente);

  wrap.appendChild(pillsModo);
  wrap.appendChild(filaNav);
  return wrap;
}

function renderizarCalendarioAgenda() {
  const cont = document.getElementById("agenda-vista-calendario");
  if (!cont) return;
  cont.innerHTML = "";

  const semestreActivo = obtenerSemestreActivoAgenda();
  const subheader = construirSubheaderCalendario();
  cont.appendChild(subheader);

  const { cont: grid, tituloRango } =
    estado.agendaCalendarioModo === "mensual" ? construirGridMensual(semestreActivo) : construirGridSemanal(semestreActivo);
  subheader.querySelector("#agenda-cal-titulo-rango").textContent = tituloRango;
  cont.appendChild(grid);
}

export { renderizarCalendarioAgenda };
