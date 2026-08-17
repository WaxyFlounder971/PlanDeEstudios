/* =========================================================================
   AGENDA — Modal de alta/edición
   Formulario para crear/editar un EventoAgenda (evento/tarea/examen).
   ========================================================================= */

import { TIPOS_EVENTO_AGENDA, crearEventoAgenda, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { fechaLocalDesdeISO } from "../horario/horario.js";
import {
  esTareaVencida,
  formatearTiempoRestanteHoy,
  obtenerEstiloEvento,
  obtenerMateriasVinculablesAgenda,
  tareaVenceHoy,
} from "./agenda-utils.js";

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

/**
 * Punto 11: nombre legible de la materia vinculada a `evento` (o "" si no
 * tiene). Se busca directo en `estado.datos.semestres` por semestre_id/
 * materia_matriculada_id (en vez de reusar obtenerMateriasVinculablesAgenda,
 * que solo lista las del semestre ACTIVO de Agenda) porque un evento viejo
 * puede seguir vinculado a una materia de un semestre que ya no es el
 * activo — mismo criterio que construirBadgeMateria en agenda.js.
 */
function obtenerNombreMateriaEvento(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? aplicarFormatoTexto(materia.nombre) : "";
}

/**
 * Punto 5 + 11: mismo toggle de completada que el checkbox de la lista
 * (agenda.js), pero disparado desde la tarjeta de info — se relee la
 * entidad viva por id antes de mutar (mismo patrón que el resto del
 * archivo). Refresca la lista de atrás vía window.renderizarAgenda (mismo
 * mecanismo que refrescarAgenda) y vuelve a pintar la tarjeta de info en el
 * lugar, sin cerrarla, para que el checkbox y el nombre tachado respondan
 * al toque sin que la persona pierda el contexto que estaba mirando.
 */
function alternarCompletadaDesdeInfo(evento) {
  const viva = buscarEventoVivoPorId(evento.id);
  if (!viva) return;
  viva.completada = !viva.completada;
  sellarTimestamp(viva);
  marcarCambioPendiente();
  refrescarAgenda();
  renderizarTarjetaInfoEventoAgenda(viva);
}

function renderizarTarjetaInfoEventoAgenda(evento) {
  const estilo = obtenerEstiloEvento(evento);
  const badgeTipo = document.getElementById("info-agenda-badge-tipo");
  badgeTipo.className = `badge ${estilo.claseBadge}`;
  badgeTipo.textContent = estilo.etiqueta;

  document.getElementById("info-agenda-badge-vencida").classList.toggle("oculto", !esTareaVencida(evento));

  const nombreEl = document.getElementById("info-agenda-nombre");
  nombreEl.textContent = evento.nombre || "(sin nombre)";
  nombreEl.style.textDecoration = evento.completada ? "line-through" : "none";
  nombreEl.style.opacity = evento.completada ? "0.7" : "1";

  document.getElementById("info-agenda-fecha").textContent = fechaLocalDesdeISO(evento.fecha).toLocaleDateString("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.getElementById("info-agenda-hora").textContent = evento.hora || "Todo el día";

  const timerEl = document.getElementById("info-agenda-timer");
  const venceHoy = tareaVenceHoy(evento);
  timerEl.classList.toggle("oculto", !venceHoy);
  if (venceHoy) timerEl.textContent = formatearTiempoRestanteHoy(evento.fecha);

  const nombreMateria = obtenerNombreMateriaEvento(evento);
  document.getElementById("info-agenda-fila-materia").classList.toggle("oculto", !nombreMateria);
  document.getElementById("info-agenda-materia").textContent = nombreMateria;

  document.getElementById("info-agenda-fila-notas").classList.toggle("oculto", !evento.notas);
  document.getElementById("info-agenda-notas-texto").textContent = evento.notas || "";

  // Punto 5: el mismo checkbox circular de la lista, disponible también
  // acá — solo aplica a tareas.
  const filaCompletada = document.getElementById("info-agenda-fila-completada");
  filaCompletada.classList.toggle("oculto", evento.tipo !== "tarea");
  const check = document.getElementById("info-agenda-check-completada");
  check.classList.toggle("marcada", Boolean(evento.completada));
  check.onclick = () => alternarCompletadaDesdeInfo(evento);
  document.getElementById("info-agenda-completada-texto").textContent = evento.completada
    ? "Completada"
    : "Marcar como completada";

  document.getElementById("btn-agenda-info-editar").onclick = () => {
    cerrarTarjetaInfoEventoAgenda();
    abrirModalEventoAgenda({ eventoId: evento.id });
  };
}

/**
 * Punto 11: tocar una tarea/examen/evento en la lista abre ESTA tarjeta de
 * info primero (no el editor directo) — el botón "Editar" de acá adentro
 * es el único camino hacia abrirModalEventoAgenda para un evento existente.
 */
function abrirTarjetaInfoEventoAgenda(eventoId) {
  const evento = buscarEventoVivoPorId(eventoId);
  if (!evento) return;
  renderizarTarjetaInfoEventoAgenda(evento);
  document.getElementById("modal-agenda-info").classList.remove("oculto");
}

function cerrarTarjetaInfoEventoAgenda() {
  document.getElementById("modal-agenda-info")?.classList.add("oculto");
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

  document.getElementById("btn-agenda-info-cerrar")?.addEventListener("click", cerrarTarjetaInfoEventoAgenda);
  document.getElementById("modal-agenda-info")?.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-info") cerrarTarjetaInfoEventoAgenda();
  });
}

export { abrirModalEventoAgenda, abrirTarjetaInfoEventoAgenda, inicializarModalAgendaEvento };
