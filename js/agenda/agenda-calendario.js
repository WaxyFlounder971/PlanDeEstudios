/* =========================================================================
   AGENDA — Vista Calendario (mensual/semanal)
   Grid de 7 columnas con puntitos de color (uno por tipo/estado de
   pendiente presente ese día, misma paleta que Lista) por celda. Tocar un
   día despliega/colapsa, debajo del grid, el detalle de ese día (Materias +
   Tareas + Exámenes + Eventos) sin salir de la vista Calendario — ver
   construirDetalleDia. El salto directo a Lista sigue existiendo, pero como
   acción explícita ("Ver en Lista") dentro de ese detalle ya desplegado.
   ========================================================================= */

import { fechaLocalDesdeISO } from "../horario/horario.js";
import { estado } from "../core/storage.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { calcularNumeroSemanaParaFecha, construirSeccionMateriasDia } from "./agenda-clases.js";
import { construirItemEvento, ETIQUETA_TIPO, limpiarIntervalosVenceHoy, renderizarAgenda } from "./agenda.js";
import {
  esHoyFecha,
  formatearFechaISO,
  obtenerCodigoDiaSemana,
  obtenerDiasSemanaAgenda,
  obtenerDiasSemanaOrdenAgenda,
  obtenerEstiloEvento,
  obtenerInicioSemanaQueContiene,
  obtenerNumeroDiaSemanaCanonico,
  obtenerOffsetSemanaParaFecha,
  obtenerSemestreActivoAgenda,
  obtenerSemestresSeleccionadosAgenda,
} from "./agenda-utils.js";

// Ajustes vista Calendario — punto 4: orden de secciones del detalle de día,
// distinto de ORDEN_TIPO en agenda.js (examen, tarea, evento) — acá el spec
// pide explícitamente Materias -> Tareas -> Exámenes -> Eventos.
const ORDEN_TIPO_DETALLE = ["tarea", "examen", "evento"];

// Transitorio (no persistido). "semanal" comparte estado.agendaOffsetSemana
// con la vista Lista a propósito: navegar la semana desde acá deja Lista ya
// parada en la misma semana si el usuario cambia de pestaña.
estado.agendaCalendarioModo = estado.agendaCalendarioModo || "mensual";
estado.agendaCalendarioOffsetMes = estado.agendaCalendarioOffsetMes || 0;
// Ajustes vista Calendario — punto 4: fecha (ISO) del día actualmente
// desplegado debajo del grid, o `null` si no hay ninguno abierto. Sesión, no
// persistido — mismo criterio que el resto de estos flags. Se resetea cada
// vez que se navega a otro mes/semana, se cambia de modo (mensual/semanal) o
// se vuelve a "Hoy" (ver construirSubheaderCalendario más abajo), porque un
// día abierto deja de tener sentido una vez que ya no está a la vista en el
// grid.
estado.agendaCalendarioFechaSeleccionada =
  estado.agendaCalendarioFechaSeleccionada !== undefined ? estado.agendaCalendarioFechaSeleccionada : null;

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

/**
 * Eventos (evento/tarea/examen) que caen en `fecha`, filtrados igual que en
 * la vista Lista (construirBloqueDia, agenda.js): sin semestre_id, o de
 * cualquiera de los `semestresSeleccionados`, ordenados por hora. Punto
 * compartido entre resumenDia (puntitos + celda detallada) y
 * construirDetalleDia (secciones del día abierto) — antes esta misma
 * lógica de filtro estaba duplicada entre resumenDia y construirCelda.
 */
function obtenerEventosDelDia(fecha, semestresSeleccionados) {
  const fechaISO = formatearFechaISO(fecha);
  return (estado.datos.agenda || [])
    .filter((ev) => ev.fecha === fechaISO)
    .filter((ev) => !ev.semestre_id || semestresSeleccionados.some((s) => s.id === ev.semestre_id))
    .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));
}

/**
 * Ajustes vista Calendario — punto 3: en vez de un conteo por `tipo` crudo
 * (evento/tarea/examen), acá se resuelve el color de CADA evento vía
 * obtenerEstiloEvento (agenda-utils.js) — la misma paleta de 5 colores que
 * ya usa la vista Lista (amarillo=tarea pendiente, azul=tarea completada,
 * rojo=examen, morado=evento, verde=feriado) — y se junta el set de colores
 * DISTINTOS presentes ese día, uno por tipo/estado que tenga algo. Punto 2:
 * ya no calcula "hay clases" (el indicador de libro se quitó del todo).
 */
function resumenDia(fecha, semestresSeleccionados) {
  const eventos = obtenerEventosDelDia(fecha, semestresSeleccionados);
  const coloresPresentes = [];
  const vistos = new Set();
  eventos.forEach((ev) => {
    const color = obtenerEstiloEvento(ev).colorBorde;
    if (!vistos.has(color)) {
      vistos.add(color);
      coloresPresentes.push(color);
    }
  });
  return { eventos, colores: coloresPresentes, total: eventos.length };
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
function construirCelda(fecha, { delMesActual, detallada, semestresSeleccionados }) {
  const { eventos, colores, total } = resumenDia(fecha, semestresSeleccionados);
  const hoy = esHoyFecha(fecha);
  const fechaISO = formatearFechaISO(fecha);
  const seleccionada = estado.agendaCalendarioFechaSeleccionada === fechaISO;

  const celda = document.createElement("button");
  celda.type = "button";
  celda.className =
    "agenda-cal-celda" +
    (hoy ? " agenda-cal-celda-hoy" : "") +
    (delMesActual === false ? " agenda-cal-celda-fuera-mes" : "") +
    (seleccionada ? " agenda-cal-celda-seleccionada" : "");

  // Ajustes vista Calendario — punto 3: un puntito por cada color/estado
  // distinto presente ese día (paleta de obtenerEstiloEvento, ver
  // resumenDia más arriba) — ya no navega a ningún lado por sí solo, es
  // puramente informativo (el toque que navega/despliega es en toda la
  // celda, ver el listener más abajo).
  const puntos = colores.map((color) => `<span class="agenda-cal-punto" style="background:${color};"></span>`).join("");

  if (!detallada) {
    celda.innerHTML = `
      <span class="agenda-cal-numero">${fecha.getDate()}</span>
      <span class="agenda-cal-indicadores">${puntos}</span>
    `;
  } else {
    const nombresVisibles = eventos.slice(0, 3);
    const restantes = eventos.length - nombresVisibles.length;
    celda.innerHTML = `
      <div class="row-between" style="width:100%;">
        <span class="agenda-cal-numero">${fecha.getDate()}</span>
      </div>
      <div class="stack" style="gap:2px; width:100%; margin-top:4px;">
        ${nombresVisibles
          .map(
            (ev) =>
              `<span class="agenda-cal-nombre-evento" style="border-left:3px solid ${obtenerEstiloEvento(ev).colorBorde};">${ev.nombre || "(sin nombre)"}</span>`
          )
          .join("")}
        ${restantes > 0 ? `<span class="muted" style="font-size:0.68rem;">+${restantes} más</span>` : ""}
      </div>
    `;
  }

  celda.title = total > 0 ? `${total} pendiente${total === 1 ? "" : "s"}` : "";
  // Ajustes vista Calendario — punto 4: ya no salta a Lista al tocar una
  // fecha — despliega/colapsa el detalle de ESE día debajo del grid, sin
  // salir de la vista Calendario (ver alternarDetalleDia). El salto a Lista
  // sigue existiendo, pero como acción explícita ("Ver en Lista") dentro del
  // detalle ya desplegado — ver construirDetalleDia.
  celda.addEventListener("click", () => alternarDetalleDia(fecha));
  return celda;
}

/**
 * Ajustes vista Calendario — punto 4: toggle del día abierto — tocar la
 * misma celda ya seleccionada lo cierra (vuelve a `null`); tocar otra celda
 * cambia el detalle abierto a esa fecha nueva. Un solo día abierto a la vez.
 */
function alternarDetalleDia(fecha) {
  const fechaISO = formatearFechaISO(fecha);
  estado.agendaCalendarioFechaSeleccionada = estado.agendaCalendarioFechaSeleccionada === fechaISO ? null : fechaISO;
  renderizarCalendarioAgenda();
}

/**
 * Ajustes vista Calendario — punto 4: panel de detalle del día seleccionado,
 * insertado debajo del grid (mensual o semanal, el que esté activo). Reusa
 * construirSeccionMateriasDia (agenda-clases.js, misma sección "Materias"
 * que la vista Lista, con el mismo filtro de "Mostrar materias en la
 * agenda") y construirItemEvento (agenda.js, mismo componente/colores/
 * estados — completada, vencida, vence-hoy con timer — que usa Lista), para
 * no duplicar esa lógica ni arriesgar que quede desincronizada.
 *
 * Orden pedido por el spec: Materias -> Tareas -> Exámenes -> Eventos.
 * "Semana X / Día X": X de semana viene del semestre de referencia
 * (calcularNumeroSemanaParaFecha, mismo criterio que el header de Lista);
 * "Día X" es el número de día CANÓNICO 1=lunes..7=domingo
 * (obtenerNumeroDiaSemanaCanonico, agenda-utils.js), estable sin importar
 * `dia_inicio_semana`.
 */
function construirDetalleDia(fecha, semestresSeleccionados, semestreReferencia) {
  const panel = document.createElement("section");
  panel.className = "glass-panel stack";
  panel.style.padding = "14px";

  const numeroSemana = semestreReferencia ? calcularNumeroSemanaParaFecha(semestreReferencia, fecha) : null;
  const numeroDia = obtenerNumeroDiaSemanaCanonico(fecha);
  const tituloSemanaDia = [numeroSemana ? `Semana ${numeroSemana}` : null, `Día ${numeroDia}`].filter(Boolean).join(" / ");
  const fechaTexto = fecha.toLocaleDateString("es-CR", { weekday: "long", day: "numeric", month: "short" });

  const header = document.createElement("div");
  header.className = "row-between";
  header.innerHTML = `
    <div class="stack" style="gap:2px;">
      <span style="font-weight:700;">${tituloSemanaDia}</span>
      <span class="muted" style="font-size:0.8rem; text-transform:capitalize;">${fechaTexto}</span>
    </div>
  `;
  const verEnLista = document.createElement("span");
  verEnLista.className = "muted";
  verEnLista.style.cssText = "font-size:0.74rem; text-decoration:underline; cursor:pointer; white-space:nowrap;";
  verEnLista.textContent = "Ver en Lista";
  verEnLista.addEventListener("click", () => saltarADiaEnLista(fecha));
  header.appendChild(verEnLista);
  panel.appendChild(header);

  const diaCodigo = obtenerCodigoDiaSemana(fecha);
  const seccionMaterias = construirSeccionMateriasDia(semestresSeleccionados, fecha, diaCodigo);
  if (seccionMaterias) panel.appendChild(seccionMaterias);

  const eventosDelDia = obtenerEventosDelDia(fecha, semestresSeleccionados);
  let huboSeccionPendientes = false;
  ORDEN_TIPO_DETALLE.forEach((tipo) => {
    const delTipo = eventosDelDia.filter((ev) => ev.tipo === tipo);
    if (delTipo.length === 0) return;
    huboSeccionPendientes = true;
    const grupo = document.createElement("div");
    grupo.className = "stack";
    grupo.style.gap = "6px";
    const etiqueta = document.createElement("span");
    etiqueta.className = "muted";
    etiqueta.style.cssText = "font-size:0.7rem; text-transform:uppercase; letter-spacing:0.02em;";
    etiqueta.textContent = ETIQUETA_TIPO[tipo];
    grupo.appendChild(etiqueta);
    delTipo.forEach((ev) => grupo.appendChild(construirItemEvento(ev)));
    panel.appendChild(grupo);
  });

  if (!seccionMaterias && !huboSeccionPendientes) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; margin:2px 0 0;";
    vacio.textContent = "Sin pendientes.";
    panel.appendChild(vacio);
  }

  return panel;
}

function construirGridMensual(semestresSeleccionados) {
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
        semestresSeleccionados,
      })
    );
    cursor.setDate(cursor.getDate() + 1);
  }
  cont.appendChild(grid);
  return { cont, tituloRango: baseMes.toLocaleDateString("es-CR", { month: "long", year: "numeric" }) };
}

function construirGridSemanal(semestresSeleccionados) {
  const dias = obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);

  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "4px";
  cont.appendChild(construirCabeceraDiasSemana());

  const grid = document.createElement("div");
  grid.className = "agenda-cal-grid agenda-cal-grid-semanal";
  dias.forEach((dia) => {
    grid.appendChild(construirCelda(dia.fecha, { detallada: true, semestresSeleccionados }));
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
      // Ajustes vista Calendario — punto 4: cambiar de mensual a semanal (o
      // viceversa) puede sacar de pantalla el día que estaba abierto (otra
      // grilla, otro recorte de fechas) — se cierra el detalle para no
      // dejarlo "colgado" mostrando un día que ya no se ve resaltado en el
      // grid nuevo.
      estado.agendaCalendarioFechaSeleccionada = null;
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
    // Punto 4: mismo motivo que el switch de modo — al cambiar de mes/semana
    // el día abierto deja de estar en el grid mostrado.
    estado.agendaCalendarioFechaSeleccionada = null;
    renderizarCalendarioAgenda();
  };
  btnAnterior.addEventListener("click", () => avanzar(-1));
  btnSiguiente.addEventListener("click", () => avanzar(1));
  volverHoy.addEventListener("click", () => {
    estado.agendaCalendarioOffsetMes = 0;
    estado.agendaOffsetSemana = 0;
    estado.agendaCalendarioFechaSeleccionada = null;
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
  // Punto 4 (fix): el detalle de día reutiliza construirItemEvento, que
  // arma sus propios timers "vence hoy" en el array compartido de agenda.js
  // (ver limpiarIntervalosVenceHoy) — se limpia acá al arrancar CADA render
  // completo del Calendario (haya o no un día abierto ahora mismo), mismo
  // criterio que renderizarAgendaInterno hace para Lista, para no dejar
  // setInterval huérfanos apuntando a nodos ya descartados cada vez que se
  // cierra/cambia el día abierto o se navega de mes/semana.
  limpiarIntervalosVenceHoy();

  const subheader = construirSubheaderCalendario();
  cont.appendChild(subheader);

  // Decisión confirmada (selector de semestres por tarjetas, ver agenda.js):
  // si HAY semestres creados pero la persona los deseleccionó todos, la
  // Agenda (Lista Y Calendario) queda vacía con este mensaje — no cae en
  // silencio a "mostrar todo" ni a otro semestre no elegido.
  const hayAlgunSemestre = (estado.datos.semestres || []).length > 0;
  const semestresSeleccionados = obtenerSemestresSeleccionadosAgenda();
  if (hayAlgunSemestre && semestresSeleccionados.length === 0) {
    estado.agendaCalendarioFechaSeleccionada = null;
    subheader.querySelector("#agenda-cal-titulo-rango").textContent = "";
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "Selecciona al menos un semestre para ver tu Agenda.";
    cont.appendChild(vacio);
    return;
  }

  const { cont: grid, tituloRango } =
    estado.agendaCalendarioModo === "mensual"
      ? construirGridMensual(semestresSeleccionados)
      : construirGridSemanal(semestresSeleccionados);
  subheader.querySelector("#agenda-cal-titulo-rango").textContent = tituloRango;
  cont.appendChild(grid);

  // Punto 4: el detalle va DEBAJO del grid, como tercer hijo directo de
  // #agenda-vista-calendario (que ya es .stack — gap automático de 14px sin
  // CSS nuevo). Se reconstruye desde `estado.datos.agenda` fresco en cada
  // render, así que toggles de "completada" o guardar/borrar desde el modal
  // (que ya refrescan vía renderizarAgenda(), ver fix en agenda.js) lo dejan
  // al día sin lógica aparte.
  if (estado.agendaCalendarioFechaSeleccionada) {
    const fechaSeleccionada = fechaLocalDesdeISO(estado.agendaCalendarioFechaSeleccionada);
    const semestreReferencia = obtenerSemestreActivoAgenda();
    cont.appendChild(construirDetalleDia(fechaSeleccionada, semestresSeleccionados, semestreReferencia));
  }
}

export { renderizarCalendarioAgenda };
