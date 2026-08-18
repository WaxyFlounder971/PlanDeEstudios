/* =========================================================================
   AGENDA — Vista Materia (3er tab, junto a Lista/Calendario)
   Selector de una materia (entre las matriculadas de los semestres
   seleccionados en Agenda, mismo criterio que el resto de Agenda — ver
   obtenerMateriasVinculablesAgenda) + listado semana a semana (TODAS las
   semanas del semestre de esa materia, incluidas las vacías) de lo
   pendiente vinculado a ella, con el día de cada cosa. Pedido nuevo.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { fechaLocalDesdeISO } from "../horario/horario.js";
import { buscarSemestreVivoPorId } from "../semestres/semestres.js";
import { calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { construirItemEvento, limpiarIntervalosVenceHoy } from "./agenda.js";
import { obtenerMateriasVinculablesAgenda } from "./agenda-utils.js";

// Sesión, no persistido — mismo criterio que el resto de flags de Agenda
// (ver agenda.js/agenda-calendario.js): qué materia_matriculada_id está
// elegida ahora mismo en este tab. `null` = ninguna todavía.
estado.agendaMateriaSeleccionadaId =
  estado.agendaMateriaSeleccionadaId !== undefined ? estado.agendaMateriaSeleccionadaId : null;

/**
 * Dropdown de materia — MISMO patrón visual que el resto de la app
 * (.select-custom, ver design-system.css y el selector de materia del
 * formulario de alta/edición en index.html/agenda-modal.js), pero armado
 * 100% dinámico acá (no hay <select> nativo oculto de por medio: no hace
 * falta, esta elección no se envía en ningún formulario, solo decide qué
 * mostrarse en este mismo tab) — mismo criterio 100%-dinámico que ya usa
 * agenda-calendario.js para su propio subheader.
 */
function construirSelectorMateria(materias) {
  const cont = document.createElement("div");
  cont.className = "select-custom";
  cont.id = "agenda-materia-tab-selector";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-select select-custom-boton";
  boton.setAttribute("aria-haspopup", "listbox");
  boton.setAttribute("aria-expanded", "false");
  const activa = materias.find((m) => m.mmId === estado.agendaMateriaSeleccionadaId);
  boton.innerHTML = `<span>${activa ? activa.nombre : "Elegí una materia"}</span>`;

  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";
  lista.setAttribute("role", "listbox");

  materias.forEach((m) => {
    const li = document.createElement("li");
    const activaEsta = m.mmId === estado.agendaMateriaSeleccionadaId;
    li.className = "select-custom-opcion" + (activaEsta ? " activa" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(activaEsta));
    li.textContent = m.nombre;
    li.addEventListener("click", () => {
      estado.agendaMateriaSeleccionadaId = m.mmId;
      renderizarMateriaAgenda();
    });
    lista.appendChild(li);
  });

  boton.addEventListener("click", () => {
    const abierto = boton.getAttribute("aria-expanded") === "true";
    lista.classList.toggle("oculto", abierto);
    boton.setAttribute("aria-expanded", String(!abierto));
  });

  cont.appendChild(boton);
  cont.appendChild(lista);
  return cont;
}

/**
 * Sección de una semana puntual: encabezado "Semana N" + lo pendiente de
 * `mm` que cae ahí (mismo componente construirItemEvento que Lista/
 * Calendario, mismo criterio de colores/estados) o "Sin pendientes." si no
 * hay nada — pedido explícito: se listan TODAS las semanas del semestre,
 * no solo las que tienen algo, para que se vea de un vistazo el semestre
 * completo de esa materia.
 */
function construirSeccionSemanaMateria(semestre, numeroSemana, eventosMateria) {
  const bloque = document.createElement("section");
  bloque.className = "glass-panel stack";
  bloque.style.padding = "14px";

  const titulo = document.createElement("span");
  titulo.style.fontWeight = "700";
  titulo.textContent = `Semana ${numeroSemana}`;
  bloque.appendChild(titulo);

  const deEstaSemana = eventosMateria
    .filter((ev) => calcularNumeroSemanaParaFecha(semestre, fechaLocalDesdeISO(ev.fecha)) === numeroSemana)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

  if (deEstaSemana.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; margin:2px 0 0;";
    vacio.textContent = "Sin pendientes.";
    bloque.appendChild(vacio);
    return bloque;
  }

  deEstaSemana.forEach((ev) => {
    const fila = document.createElement("div");
    fila.className = "stack";
    fila.style.gap = "3px";
    const etiquetaDia = document.createElement("span");
    etiquetaDia.className = "muted";
    etiquetaDia.style.cssText = "font-size:0.72rem; text-transform:capitalize;";
    etiquetaDia.textContent = fechaLocalDesdeISO(ev.fecha).toLocaleDateString("es-CR", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    fila.appendChild(etiquetaDia);
    fila.appendChild(construirItemEvento(ev));
    bloque.appendChild(fila);
  });

  return bloque;
}

function construirContenidoMateria(mm) {
  const semestre = buscarSemestreVivoPorId(mm.semestreId);
  const cont = document.createElement("div");
  cont.className = "stack";

  if (!semestre) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "No se encontró el semestre de esta materia.";
    cont.appendChild(vacio);
    return cont;
  }

  const eventosMateria = (estado.datos.agenda || []).filter((ev) => ev.materia_matriculada_id === mm.mmId);
  const totalSemanas = Number(semestre.duracion_semanas) || 16;

  for (let semana = 1; semana <= totalSemanas; semana++) {
    cont.appendChild(construirSeccionSemanaMateria(semestre, semana, eventosMateria));
  }

  return cont;
}

function renderizarMateriaAgenda() {
  const cont = document.getElementById("agenda-vista-materia");
  if (!cont) return;
  cont.innerHTML = "";
  // Mismo motivo que en agenda-calendario.js: construirItemEvento arma sus
  // propios timers "vence hoy" en el array compartido de agenda.js — se
  // limpia acá al arrancar cada render completo de este tab para no dejar
  // setInterval huérfanos al cambiar de materia o de semestres seleccionados.
  limpiarIntervalosVenceHoy();

  const materias = obtenerMateriasVinculablesAgenda();

  // Si la materia guardada en sesión ya no está entre las disponibles
  // (cambiaron los semestres seleccionados en Agenda, por ejemplo), se
  // resetea a "ninguna" en vez de quedar apuntando a algo que ya no existe.
  if (estado.agendaMateriaSeleccionadaId && !materias.some((m) => m.mmId === estado.agendaMateriaSeleccionadaId)) {
    estado.agendaMateriaSeleccionadaId = null;
  }

  if (materias.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "No hay materias matriculadas en los semestres seleccionados.";
    cont.appendChild(vacio);
    return;
  }

  cont.appendChild(construirSelectorMateria(materias));

  if (!estado.agendaMateriaSeleccionadaId) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "Elegí una materia para ver sus semanas.";
    cont.appendChild(vacio);
    return;
  }

  const mm = materias.find((m) => m.mmId === estado.agendaMateriaSeleccionadaId);
  cont.appendChild(construirContenidoMateria(mm));
}

/**
 * Wiring de una sola vez (llamado desde inicializarAgenda): cerrar el
 * dropdown al tocar afuera — mismo patrón que el selector de materia del
 * formulario (cerrarDropdownMateria en agenda-modal.js), pero delegado acá
 * porque el contenedor se reconstruye en cada render (no es un nodo fijo
 * del HTML estático).
 */
function inicializarMateriaAgenda() {
  document.addEventListener("click", (ev) => {
    const cont = document.getElementById("agenda-materia-tab-selector");
    if (!cont || cont.contains(ev.target)) return;
    cont.querySelector(".select-custom-lista")?.classList.add("oculto");
    cont.querySelector(".select-custom-boton")?.setAttribute("aria-expanded", "false");
  });
}

export { inicializarMateriaAgenda, renderizarMateriaAgenda };
