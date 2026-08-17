/* =========================================================================
   AGENDA — Modal de alta/edición
   Formulario para crear/editar un EventoAgenda (evento/tarea/examen).
   ========================================================================= */

import { TIPOS_EVENTO_AGENDA, crearEventoAgenda, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerMateriasVinculablesAgenda } from "./agenda-utils.js";

const PLACEHOLDER_NOMBRE = {
  evento: "Ej. Charla de RRHH",
  tarea: "Ej. Tarea 3",
  examen: "Ej. Primer parcial",
};

const ETIQUETA_TIPO = { evento: "Evento", tarea: "Tarea", examen: "Examen" };

// Callback expuesto por agenda.js para refrescar la lista tras guardar/
// borrar, sin crear un import circular (agenda.js importa DE este archivo
// para abrir el modal) — mismo patrón que window.renderizarHorario en
// horario.js/horario-modal.js.
function refrescarAgenda() {
  window.renderizarAgenda?.();
}

function buscarEventoVivoPorId(id) {
  return (estado.datos.agenda || []).find((ev) => ev.id === id) || null;
}

function poblarSelectorMateria(select, materiaSeleccionadaId) {
  select.innerHTML = "";
  const optSinVincular = document.createElement("option");
  optSinVincular.value = "";
  optSinVincular.textContent = "Sin vincular";
  select.appendChild(optSinVincular);

  obtenerMateriasVinculablesAgenda().forEach(({ mmId, nombre }) => {
    const opt = document.createElement("option");
    opt.value = mmId;
    opt.textContent = nombre;
    select.appendChild(opt);
  });
  select.value = materiaSeleccionadaId || "";
}

function actualizarPlaceholderNombre(tipo) {
  const input = document.getElementById("input-agenda-nombre");
  if (input) input.placeholder = PLACEHOLDER_NOMBRE[tipo] || "";
}

/**
 * Rediseño núcleo Agenda — punto 1: el toggle "Es feriado" solo aplica a
 * tipo "evento" (subtipo especial). Se oculta (no se deshabilita) para los
 * otros 2 tipos, y se destildesa al ocultarse para que cambiar de tipo y
 * volver a "evento" nunca arrastre un feriado marcado por error mientras
 * estaba invisible.
 */
function actualizarVisibilidadFeriado(tipo) {
  const fila = document.getElementById("fila-agenda-es-feriado");
  const chk = document.getElementById("chk-agenda-es-feriado");
  if (!fila || !chk) return;
  const esEvento = tipo === "evento";
  fila.classList.toggle("oculto", !esEvento);
  if (!esEvento) chk.checked = false;
}

function seleccionarPillTipo(tipo) {
  document.querySelectorAll("#pills-agenda-tipo .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.valor === tipo);
  });
  actualizarPlaceholderNombre(tipo);
  actualizarVisibilidadFeriado(tipo);
}

function obtenerTipoSeleccionado() {
  const activo = document.querySelector("#pills-agenda-tipo .pill-item.active");
  return activo ? activo.dataset.valor : "evento";
}

/**
 * `opciones.eventoId`: null = alta nueva. `opciones.fechaDefault`:
 * "YYYY-MM-DD" a precargar en alta nueva (ej. el día donde se tocó "+" —
 * hoy por defecto si no se pasa nada, ver agenda.js).
 */
function abrirModalEventoAgenda({ eventoId = null, fechaDefault = null } = {}) {
  const modal = document.getElementById("modal-agenda-evento");
  const eventoExistente = eventoId ? buscarEventoVivoPorId(eventoId) : null;

  document.getElementById("titulo-modal-agenda-evento").textContent = eventoExistente
    ? "Editar"
    : "Agregar a Agenda";

  // Orden/default del selector (rediseño núcleo Agenda, punto 1): alta
  // nueva siempre arranca en "tarea" — ya no en "evento".
  seleccionarPillTipo(eventoExistente ? eventoExistente.tipo : "tarea");
  document.getElementById("chk-agenda-es-feriado").checked = eventoExistente ? Boolean(eventoExistente.es_feriado) : false;
  document.getElementById("input-agenda-nombre").value = eventoExistente ? eventoExistente.nombre : "";
  document.getElementById("input-agenda-fecha").value = eventoExistente
    ? eventoExistente.fecha
    : fechaDefault || new Date().toISOString().slice(0, 10);

  const chkTodoElDia = document.getElementById("chk-agenda-todo-el-dia");
  const inputHora = document.getElementById("input-agenda-hora");
  const sinHora = eventoExistente ? !eventoExistente.hora : false;
  chkTodoElDia.checked = sinHora;
  inputHora.value = eventoExistente && eventoExistente.hora ? eventoExistente.hora : "";
  inputHora.disabled = sinHora;

  poblarSelectorMateria(
    document.getElementById("select-agenda-materia"),
    eventoExistente ? eventoExistente.materia_matriculada_id : null
  );
  document.getElementById("input-agenda-notas").value = eventoExistente ? eventoExistente.notas || "" : "";

  const btnBorrar = document.getElementById("btn-agenda-borrar");
  btnBorrar.classList.toggle("oculto", !eventoExistente);

  const btnGuardar = document.getElementById("btn-agenda-guardar");
  btnGuardar.onclick = () => guardarEventoAgenda(eventoExistente);
  btnBorrar.onclick = () => confirmarBorrarEventoAgenda(eventoExistente);

  modal.classList.remove("oculto");
}

function cerrarModalEventoAgenda() {
  document.getElementById("modal-agenda-evento").classList.add("oculto");
}

function guardarEventoAgenda(eventoExistente) {
  const nombre = document.getElementById("input-agenda-nombre").value.trim();
  const fecha = document.getElementById("input-agenda-fecha").value;
  if (!fecha) {
    mostrarToast("Elegí una fecha");
    return;
  }
  const tipo = obtenerTipoSeleccionado();
  const todoElDia = document.getElementById("chk-agenda-todo-el-dia").checked;
  const hora = todoElDia ? null : document.getElementById("input-agenda-hora").value || null;
  const materiaSelect = document.getElementById("select-agenda-materia");
  const mmId = materiaSelect.value || null;
  const materiaVinculada = mmId
    ? obtenerMateriasVinculablesAgenda().find((m) => m.mmId === mmId)
    : null;
  const notas = document.getElementById("input-agenda-notas").value.trim();
  // Solo tiene sentido si tipo === "evento" (el checkbox está oculto para
  // los otros 2 tipos y se destildesa solo al ocultarse — ver
  // actualizarVisibilidadFeriado) — se fuerza igual acá por las dudas.
  const esFeriado = tipo === "evento" && document.getElementById("chk-agenda-es-feriado").checked;

  estado.datos.agenda = estado.datos.agenda || [];

  if (eventoExistente) {
    // Se relee la entidad viva por id antes de mutar (mismo patrón que el
    // resto del proyecto — ver buscarSemestreVivoPorId en semestres.js) por
    // si un sondeo remoto reemplazó estado.datos entero mientras el modal
    // estaba abierto.
    const viva = buscarEventoVivoPorId(eventoExistente.id);
    if (!viva) {
      mostrarToast("Este evento ya no existe");
      cerrarModalEventoAgenda();
      refrescarAgenda();
      return;
    }
    viva.tipo = TIPOS_EVENTO_AGENDA.includes(tipo) ? tipo : "evento";
    viva.nombre = nombre;
    viva.fecha = fecha;
    viva.hora = hora;
    viva.materia_matriculada_id = materiaVinculada ? materiaVinculada.mmId : null;
    viva.semestre_id = materiaVinculada ? materiaVinculada.semestreId : null;
    viva.notas = notas;
    viva.es_feriado = esFeriado;
    // `completada` NO se toca acá: este formulario no tiene UI para ella
    // (vive en el checkbox circular de la lista/tarjeta de info — punto 5
    // del rediseño), así que una edición del resto de los campos nunca debe
    // pisarla con un valor por defecto.
    sellarTimestamp(viva);
  } else {
    const nuevo = crearEventoAgenda({
      tipo,
      nombre,
      fecha,
      hora,
      materiaMatriculadaId: materiaVinculada ? materiaVinculada.mmId : null,
      semestreId: materiaVinculada ? materiaVinculada.semestreId : null,
      notas,
      esFeriado,
    });
    estado.datos.agenda.push(nuevo);
  }

  marcarCambioPendiente();
  cerrarModalEventoAgenda();
  refrescarAgenda();
}

function confirmarBorrarEventoAgenda(eventoExistente) {
  if (!eventoExistente) return;
  abrirConfirmacion({
    titulo: `¿Borrar "${eventoExistente.nombre || ETIQUETA_TIPO[eventoExistente.tipo]}"?`,
    mensaje: "Esta acción no se puede deshacer.",
    textoConfirmar: "Borrar",
    onConfirmar: () => {
      const viva = buscarEventoVivoPorId(eventoExistente.id);
      if (viva) {
        estado.datos._eliminados_agenda = estado.datos._eliminados_agenda || [];
        estado.datos._eliminados_agenda.push({ id: viva.id, eliminadoEn: Date.now() });
        estado.datos.agenda = estado.datos.agenda.filter((ev) => ev.id !== viva.id);
        marcarCambioPendiente();
      }
      cerrarModalEventoAgenda();
      refrescarAgenda();
    },
  });
}

function inicializarModalAgendaEvento() {
  document.querySelectorAll("#pills-agenda-tipo .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => seleccionarPillTipo(btn.dataset.valor));
  });
  document.getElementById("chk-agenda-todo-el-dia").addEventListener("change", (ev) => {
    document.getElementById("input-agenda-hora").disabled = ev.target.checked;
  });
  document.getElementById("btn-agenda-cancelar").addEventListener("click", cerrarModalEventoAgenda);
  document.getElementById("modal-agenda-evento").addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-evento") cerrarModalEventoAgenda();
  });
}

export { abrirModalEventoAgenda, inicializarModalAgendaEvento };
