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
  COLOR_PERDIDA_RAYA,
  esTareaVencida,
  formatearHoraAmPm,
  formatearTiempoRestanteHoy,
  obtenerEstiloEvento,
  obtenerMateriasVinculablesAgenda,
  tareaVenceHoy,
} from "./agenda-utils.js";
import { eliminarAdjunto, obtenerAdjuntosActivosDe, obtenerAdjuntosDe } from "../core/storage-adjuntos.js";
import { abrirAdjunto, abrirMenuAdjuntos, abrirModalAdjuntar } from "../ui/adjuntos-ui.js";
// Sincronización con Google Calendar (2026-08-25, reemplaza Web Push) —
// ver core/notificaciones-calendario.js. Ambas llamadas son "best-effort":
// si Calendar no responde, no bloquean ni revierten el guardado/borrado
// del evento (ver comentario al inicio de ese archivo).
import { eliminarEventoCalendarizado, sincronizarEventoCalendario, sincronizarResumenParaFechaEvento } from "../core/notificaciones-calendario.js";

const PLACEHOLDER_NOMBRE = {
  evento: "Ej. Charla de RRHH",
  tarea: "Ej. Tarea 3",
  examen: "Ej. Primer parcial",
};

const ETIQUETA_TIPO = { evento: "Evento", tarea: "Tarea", examen: "Examen" };

// Adjuntos (archivos/imágenes/enlaces) — pedido nuevo: pensado sobre todo
// para adjuntar el cronograma del semestre u otros documentos importantes a
// un evento/tarea/examen puntual. Ampliado 2026-08-19: ya NO se guardan
// como base64 dentro del propio evento — se migró al sistema unificado de
// adjuntos (core/storage-adjuntos.js + ui/adjuntos-ui.js), el mismo que usa
// Cronograma para materia. Cada adjunto sube a la carpeta dedicada del
// Drive del usuario y solo queda una referencia liviana con
// entidadTipo:"evento" + entidadId — nada de binarios sueltos dentro del
// JSON que se sincroniza, y "Liberar espacio" en Ajustes ya sabe limpiarlos
// en lote (ver eliminarAdjuntosDeTareasDeSemestre en storage-adjuntos.js).
//
// `idEventoActivoAdjuntos`: entidadId contra el que se adjunta MIENTRAS el
// modal está abierto. En edición es el id real del evento. En alta nueva
// (todavía sin id — crearEventoAgenda recién lo genera al Guardar) se
// genera acá mismo un id "pendiente" con el MISMO prefijo/formato que usa
// crearEventoAgenda ("ag_" + uuid), así se puede adjuntar desde el primer
// momento; guardarEventoAgenda fuerza ese mismo id en el evento nuevo para
// que los adjuntos ya subidos queden bien vinculados.
//
// `esAltaNuevaConAdjuntosPendientes`: si el usuario CANCELA una alta nueva
// después de haber adjuntado algo, esos adjuntos quedarían huérfanos (con
// un entidadId que nunca llega a existir como evento real) — se limpian
// en cancelarModalEventoAgenda().
let idEventoActivoAdjuntos = null;
let esAltaNuevaConAdjuntosPendientes = false;

function renderizarListaAdjuntosFormulario() {
  const cont = document.getElementById("lista-agenda-adjuntos");
  const contGestionar = document.getElementById("fila-agenda-gestionar-adjuntos");
  if (!cont || !idEventoActivoAdjuntos) return;
  cont.innerHTML = "";
  const adjuntos = obtenerAdjuntosActivosDe("evento", idEventoActivoAdjuntos);
  cont.classList.toggle("oculto", adjuntos.length === 0);
  adjuntos.forEach((adjunto) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "adjunto-pill";
    pill.title = adjunto.nombre;
    pill.innerHTML = `${adjunto.tipo === "enlace" ? "🔗" : "📄"} <span style="overflow:hidden; text-overflow:ellipsis;">${adjunto.nombre}</span>`;
    pill.addEventListener("click", () => abrirAdjunto(adjunto));
    cont.appendChild(pill);
  });
  // "Gestionar" (reordenar/desactivar/borrar) solo tiene sentido si ya hay
  // al menos un adjunto — mismo patrón que la fila de pills de materia en
  // agenda-materia.js.
  if (contGestionar) contGestionar.classList.toggle("oculto", adjuntos.length === 0);
}

function abrirGestionAdjuntosEvento() {
  if (!idEventoActivoAdjuntos) return;
  abrirMenuAdjuntos({
    entidadTipo: "evento",
    entidadId: idEventoActivoAdjuntos,
    titulo: "Adjuntos de este evento",
    onCambiar: renderizarListaAdjuntosFormulario,
  });
}

// Callback expuesto por agenda.js para refrescar la lista tras guardar/
// borrar, sin crear un import circular (agenda.js importa DE este archivo
// para abrir el modal) — mismo patrón que window.renderizarHorario en
// horario.js/horario-modal.js.
function refrescarAgenda() {
  window.renderizarAgenda?.();
  // Resumen agrega tareas/exámenes/eventos de Agenda — mismo motivo que
  // renderizarAgenda de arriba, mismo patrón de exposición en window.
  window.renderizarResumen?.();
}

function buscarEventoVivoPorId(id) {
  return (estado.datos.agenda || []).find((ev) => ev.id === id) || null;
}

/**
 * Ronda de ajustes visuales #4: el <select> nativo (#select-agenda-materia)
 * sigue siendo la fuente real del valor — se puebla igual que antes — pero
 * ya no es la parte visible del formulario (ver comentario en index.html).
 * Acá además arma/sincroniza el botón+lista de .select-custom a partir de
 * las mismas opciones.
 */
function poblarSelectorMateria(select, materiaSeleccionadaId) {
  select.innerHTML = "";
  const opciones = [{ mmId: "", nombre: "Sin vincular" }, ...obtenerMateriasVinculablesAgenda()];

  opciones.forEach(({ mmId, nombre }) => {
    const opt = document.createElement("option");
    opt.value = mmId;
    opt.textContent = nombre;
    select.appendChild(opt);
  });
  select.value = materiaSeleccionadaId || "";

  sincronizarDropdownMateria(opciones, select.value);
}

/**
 * Arma la lista visible de .select-custom y el texto del botón a partir de
 * `opciones` (mismo arreglo que ya se usó para poblar el <select> oculto) y
 * marca cuál está activa. Al elegir una opción, escribe directo en
 * #select-agenda-materia (la fuente real) y se vuelve a llamar a sí misma
 * para refrescar el check "✓" — no hace falta releer el DOM del <select>
 * porque `opciones` ya tiene todo lo necesario en el closure del click.
 */
function sincronizarDropdownMateria(opciones, valorActual) {
  const boton = document.getElementById("btn-agenda-materia-boton");
  const textoBoton = document.getElementById("texto-agenda-materia-boton");
  const lista = document.getElementById("lista-agenda-materia");
  const selectReal = document.getElementById("select-agenda-materia");
  if (!boton || !textoBoton || !lista || !selectReal) return;

  const activa = opciones.find((o) => o.mmId === valorActual) || opciones[0];
  textoBoton.textContent = activa ? activa.nombre : "Sin vincular";

  lista.innerHTML = "";
  opciones.forEach(({ mmId, nombre }) => {
    const li = document.createElement("li");
    li.className = "select-custom-opcion" + (mmId === valorActual ? " activa" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(mmId === valorActual));
    li.textContent = nombre;
    li.addEventListener("click", () => {
      selectReal.value = mmId;
      cerrarDropdownMateria();
      sincronizarDropdownMateria(opciones, mmId);
    });
    lista.appendChild(li);
  });
}

function cerrarDropdownMateria() {
  document.getElementById("lista-agenda-materia")?.classList.add("oculto");
  document.getElementById("btn-agenda-materia-boton")?.setAttribute("aria-expanded", "false");
}

function alternarDropdownMateria() {
  const boton = document.getElementById("btn-agenda-materia-boton");
  const lista = document.getElementById("lista-agenda-materia");
  if (!boton || !lista) return;
  const abierto = boton.getAttribute("aria-expanded") === "true";
  if (abierto) {
    cerrarDropdownMateria();
  } else {
    lista.classList.remove("oculto");
    boton.setAttribute("aria-expanded", "true");
  }
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
 *
 * Ronda de ajustes visuales #6 — foco 100% en que esto no se corte NUNCA:
 * se probaron 3 técnicas de animación de tamaño (display:none instantáneo,
 * max-height fijo, CSS Grid 0fr/1fr) y las 3 terminaron cortando el switch
 * — la de Grid incluso lo cortaba a media animación. Se elimina toda
 * animación: esto es un toggle plano de "oculto" (display:none <-> flex).
 * Sin transición de tamaño no hay forma de "cortar a medio camino" porque
 * no hay medio camino. Como blindaje extra contra el bug documentado de
 * iOS Safari (overflow-y:auto de .modal-card sin repintar un hijo que pasa
 * de display:none a visible en el mismo tick que otro cambio), se lee
 * offsetHeight justo después del toggle para forzar un reflow síncrono.
 */
function actualizarVisibilidadFeriado(tipo) {
  const fila = document.getElementById("fila-agenda-es-feriado");
  const chk = document.getElementById("chk-agenda-es-feriado");
  if (!fila || !chk) return;
  const esEvento = tipo === "evento";
  fila.classList.toggle("oculto", !esEvento);
  if (!esEvento) chk.checked = false;
  // Fuerza el reflow: leer una propiedad de layout obliga al navegador a
  // recalcular antes de seguir, en vez de arrastrar el estado viejo.
  void fila.offsetHeight;
  const modalCard = fila.closest(".modal-card");
  if (modalCard) void modalCard.offsetHeight;
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
/**
 * `datosIniciales` (Asistente IA, 2026-08-22): precarga de un BORRADOR que
 * todavía no es un evento real — no vive en estado.datos.agenda, no tiene
 * id, no se puede editar/borrar. Mismo shape parcial de un EventoAgenda
 * (tipo/nombre/fecha/hora/notas — lo que Gemini puede extraer con
 * confianza; `materia_matriculada_id` queda fuera a propósito, el usuario
 * la vincula a mano acá mismo si quiere) — ver construirPromptExtraccion en
 * asistente/asistente.js. Nunca coexiste con `eventoId`: si algún día se
 * pasan ambos, `eventoExistente` gana siempre (es una edición real).
 *
 * A propósito NO se agrega ninguna rama nueva en guardarEventoAgenda/
 * adjuntos/borrado más abajo — `datosIniciales` solo alimenta estos campos
 * de precarga. Para el resto de la función (guardar, adjuntos, botón
 * borrar) un borrador es indistinguible de un alta nueva en blanco: al
 * tocar "Guardar" se crea un evento normal con crearEventoAgenda a partir
 * de lo que haya en el formulario en ese momento (editado o no por el
 * usuario) — el borrador nunca se persiste como tal.
 */
function abrirModalEventoAgenda({ eventoId = null, fechaDefault = null, datosIniciales = null } = {}) {
  const modal = document.getElementById("modal-agenda-evento");
  const eventoExistente = eventoId ? buscarEventoVivoPorId(eventoId) : null;
  const datosPrecarga = eventoExistente || datosIniciales;

  document.getElementById("titulo-modal-agenda-evento").textContent = eventoExistente
    ? "Editar"
    : "Agregar a Agenda";

  // Orden/default del selector (rediseño núcleo Agenda, punto 1): alta
  // nueva siempre arranca en "tarea" — ya no en "evento".
  seleccionarPillTipo(datosPrecarga ? datosPrecarga.tipo : "tarea");
  document.getElementById("chk-agenda-es-feriado").checked = datosPrecarga ? Boolean(datosPrecarga.es_feriado) : false;
  document.getElementById("input-agenda-nombre").value = datosPrecarga ? datosPrecarga.nombre : "";
  document.getElementById("input-agenda-fecha").value = datosPrecarga
    ? datosPrecarga.fecha
    : fechaDefault || new Date().toISOString().slice(0, 10);

  const chkTodoElDia = document.getElementById("chk-agenda-todo-el-dia");
  const inputHora = document.getElementById("input-agenda-hora");
  const sinHora = datosPrecarga ? !datosPrecarga.hora : false;
  chkTodoElDia.checked = sinHora;
  inputHora.value = datosPrecarga && datosPrecarga.hora ? datosPrecarga.hora : "";
  inputHora.disabled = sinHora;

  // materia_matriculada_id: SOLO viene de un evento real (eventoExistente),
  // nunca de datosIniciales — ver comentario de la función. Un borrador
  // siempre arranca sin materia vinculada.
  poblarSelectorMateria(
    document.getElementById("select-agenda-materia"),
    eventoExistente ? eventoExistente.materia_matriculada_id : null
  );
  document.getElementById("input-agenda-notas").value = datosPrecarga ? datosPrecarga.notas || "" : "";

  // Adjuntos: en edición se usa el id real del evento; en alta nueva se
  // genera un id pendiente (ver comentario arriba de idEventoActivoAdjuntos)
  // para poder adjuntar desde ya, antes de tocar "Guardar".
  esAltaNuevaConAdjuntosPendientes = !eventoExistente;
  idEventoActivoAdjuntos = eventoExistente ? eventoExistente.id : "ag_" + crypto.randomUUID();
  renderizarListaAdjuntosFormulario();

  const btnBorrar = document.getElementById("btn-agenda-borrar");
  btnBorrar.classList.toggle("oculto", !eventoExistente);

  const btnGuardar = document.getElementById("btn-agenda-guardar");
  btnGuardar.onclick = () => guardarEventoAgenda(eventoExistente);
  btnBorrar.onclick = () => confirmarBorrarEventoAgenda(eventoExistente);

  modal.classList.remove("oculto");
}

function cerrarModalEventoAgenda() {
  document.getElementById("modal-agenda-evento").classList.add("oculto");
  cerrarDropdownMateria();
}

/**
 * Cancelar (botón "Cancelar", tocar afuera del modal): a diferencia de
 * cerrarModalEventoAgenda (que también se llama tras un Guardar exitoso),
 * esto SÍ debe limpiar los adjuntos que se hayan subido durante una alta
 * nueva que el usuario decidió no guardar — si no, quedarían huérfanos en
 * Drive, vinculados a un entidadId que ningún evento real va a tener nunca
 * (ver comentario de idEventoActivoAdjuntos más arriba).
 */
function cancelarModalEventoAgenda() {
  if (esAltaNuevaConAdjuntosPendientes && idEventoActivoAdjuntos) {
    obtenerAdjuntosDe("evento", idEventoActivoAdjuntos).forEach((a) => eliminarAdjunto(a.id));
  }
  cerrarModalEventoAgenda();
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

  // Se guarda una referencia al evento realmente persistido (el existente
  // ya mutado, o el nuevo recién creado) para poder programar su
  // recordatorio push DESPUÉS de que quede guardado — ver el bloque justo
  // antes de cerrarModalEventoAgenda() más abajo.
  let eventoGuardado;
  // FIX 2026-09-26 (Resumen Diario reactivo): fecha del evento ANTES de
  // esta edición, si había una — solo se llena en la rama de edición, justo
  // antes de pisarla (ver más abajo). Se usa después de guardar para
  // recalcular aparte el Resumen Diario del día anterior a la fecha VIEJA,
  // si la edición movió el evento a otra fecha (ver
  // sincronizarResumenParaFechaEvento en core/notificaciones-calendario.js).
  let fechaAnteriorEvento = null;

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
    // Se guarda ANTES de pisarla (línea de abajo, `viva.fecha = fecha`).
    fechaAnteriorEvento = viva.fecha;
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
    //
    // `perdida` (2026-09-21) tampoco se edita acá, pero SÍ se revalida: solo
    // existe mientras la tarea siga vencida. Si se cambió el tipo a algo que
    // no es tarea, o se movió la fecha/hora al futuro, "Perdida" ya no tiene
    // sentido y la tarea vuelve a pendiente (con aviso, para que no parezca
    // que el cambio de fecha borró el estado en silencio). Mover la fecha a
    // otra fecha igualmente pasada la deja perdida.
    let volvioAPendiente = false;
    if (viva.perdida) {
      const sigueVencida = viva.tipo === "tarea" && esTareaVencida({ ...viva, perdida: false });
      if (!sigueVencida) {
        viva.perdida = false;
        volvioAPendiente = viva.tipo === "tarea";
      }
    }
    sellarTimestamp(viva);
    eventoGuardado = viva;
    if (volvioAPendiente) mostrarToast("La tarea volvió a pendiente: su fecha ya no está vencida");
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
    // Fuerza el id a que coincida con el "pendiente" usado mientras el
    // modal estuvo abierto (ver idEventoActivoAdjuntos) — así cualquier
    // adjunto ya subido durante esta alta queda vinculado al evento real
    // sin tener que reescribir sus referencias.
    if (idEventoActivoAdjuntos) nuevo.id = idEventoActivoAdjuntos;
    estado.datos.agenda.push(nuevo);
    eventoGuardado = nuevo;
  }

  // Ya se guardó de verdad — de acá en adelante los adjuntos de este id ya
  // NO son "pendientes de una alta descartada" (evita que un cierre
  // posterior del modal, por lo que sea, los borre por error).
  esAltaNuevaConAdjuntosPendientes = false;

  // Sincronización con Google Calendar (2026-08-25, reemplaza Web Push):
  // (re)crea/actualiza el espejo de este evento en el calendario secundario
  // con la fecha/hora recién guardada — cubre tanto altas nuevas como
  // ediciones de fecha/hora/nombre de un evento existente (upsert por
  // google_calendar_event_id, ver core/notificaciones-calendario.js). No
  // hace nada si el switch de Ajustes está desactivado, y nunca bloquea el
  // guardado si falla.
  sincronizarEventoCalendario(eventoGuardado);

  // FIX 2026-09-26 (Resumen Diario reactivo): si esta edición movió el
  // evento a otra fecha, sincronizarEventoCalendario ya recalculó el
  // Resumen Diario de la fecha NUEVA (ve `eventoGuardado.fecha`, que ya
  // está actualizada) — pero la fecha VIEJA no tiene forma de enterarse
  // desde adentro de ese archivo (el objeto le llega ya mutado). Acá sí se
  // conocen las dos, así que se dispara aparte para la vieja: si a esa
  // fecha ya no le queda ningún evento pendiente, su instancia se cancela
  // en vez de quedar con un listado desactualizado hasta que le tocara el
  // turno solo.
  if (fechaAnteriorEvento && fechaAnteriorEvento !== eventoGuardado.fecha) {
    sincronizarResumenParaFechaEvento(fechaAnteriorEvento);
  }

  marcarCambioPendiente();
  cerrarModalEventoAgenda();
  refrescarAgenda();
}

/**
 * `onBorradoConfirmado` es opcional (nadie lo usaba antes de esto) — lo
 * dispara SOLO dentro de onConfirmar, después de que el evento ya se borró
 * de verdad de estado.datos.agenda, nunca antes. Lo usa asistente.js para
 * marcar su propia tarjeta del chat como "Eliminado" al toque, en vez de
 * que quede desactualizada hasta la próxima vez que se reconstruya el chat.
 */
function confirmarBorrarEventoAgenda(eventoExistente, onBorradoConfirmado) {
  if (!eventoExistente) return;
  abrirConfirmacion({
    titulo: `¿Borrar "${eventoExistente.nombre || ETIQUETA_TIPO[eventoExistente.tipo]}"?`,
    mensaje: "Esta acción no se puede deshacer.",
    textoConfirmar: "Borrar",
    onConfirmar: () => {
      const viva = buscarEventoVivoPorId(eventoExistente.id);
      if (viva) {
        obtenerAdjuntosDe("evento", viva.id).forEach((a) => eliminarAdjunto(a.id));
        estado.datos._eliminados_agenda = estado.datos._eliminados_agenda || [];
        estado.datos._eliminados_agenda.push({ id: viva.id, eliminadoEn: Date.now() });
        estado.datos.agenda = estado.datos.agenda.filter((ev) => ev.id !== viva.id);
        marcarCambioPendiente();
        // Elimina el espejo en Google Calendar, si había uno sincronizado.
        // Necesita el objeto `viva` COMPLETO (con google_calendar_event_id)
        // — a diferencia del viejo cancelarRecordatorioPush(id), que solo
        // necesitaba el id porque el Worker indexaba por id compuesto
        // propio; acá hace falta el id real que asignó Google (ver
        // core/notificaciones-calendario.js). La referencia `viva` sigue
        // siendo válida aunque ya se haya sacado del arreglo justo arriba
        // (filter no muta el objeto en sí, solo la lista).
        eliminarEventoCalendarizado(viva);
      }
      cerrarModalEventoAgenda();
      refrescarAgenda();
      if (typeof onBorradoConfirmado === "function") onBorradoConfirmado();
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
 * Único punto que cambia el estado de una tarea entre "pendiente" |
 * "completada" | "perdida" (2026-09-21). Los 2 booleanos son mutuamente
 * excluyentes: se escriben siempre juntos acá para que nunca queden ambos
 * en true. Relee la entidad viva por id antes de mutar (mismo patrón de
 * siempre, por si un sondeo remoto reemplazó estado.datos mientras tanto).
 */
function aplicarEstadoTarea(eventoId, nuevoEstado, alTerminar) {
  const viva = buscarEventoVivoPorId(eventoId);
  if (!viva || viva.tipo !== "tarea") return;
  viva.completada = nuevoEstado === "completada";
  viva.perdida = nuevoEstado === "perdida";
  sellarTimestamp(viva);
  marcarCambioPendiente();
  refrescarAgenda();
  sincronizarEventoCalendario(viva);
  if (typeof alTerminar === "function") alTerminar(viva);
}

/**
 * Ventanita "Completado / Perdido" — solo aparece al tocar el círculo de una
 * tarea VENCIDA y aún pendiente. Se arma dinámicamente (sin depender de
 * index.html) y se descarta al cerrarla. Tocar afuera, "Cancelar" o Escape
 * no cambian nada.
 */
function abrirSelectorEstadoTareaVencida(evento, alElegir) {
  document.getElementById("agenda-selector-estado")?.remove();

  const overlay = document.createElement("div");
  overlay.id = "agenda-selector-estado";
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "glass-card modal-card stack agenda-selector-estado-card";
  card.style.gap = "10px";

  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Esta tarea ya venció";

  const nombre = document.createElement("p");
  nombre.className = "muted";
  nombre.style.cssText = "margin:0; overflow-wrap:break-word;";
  nombre.textContent = evento.nombre || "(sin nombre)";

  const pregunta = document.createElement("p");
  pregunta.style.margin = "0";
  pregunta.textContent = "¿La completaste o ya no la vas a hacer?";

  const acciones = document.createElement("div");
  acciones.className = "agenda-selector-estado-acciones";

  const cerrar = () => {
    document.removeEventListener("keydown", alTeclear);
    overlay.remove();
  };
  const alTeclear = (ev) => {
    if (ev.key === "Escape") cerrar();
  };
  const elegir = (valor) => {
    cerrar();
    alElegir(valor);
  };

  const btnCompletado = document.createElement("button");
  btnCompletado.type = "button";
  btnCompletado.className = "agenda-selector-estado-btn completado";
  btnCompletado.textContent = "Completado";
  btnCompletado.addEventListener("click", () => elegir("completada"));

  const btnPerdido = document.createElement("button");
  btnPerdido.type = "button";
  btnPerdido.className = "agenda-selector-estado-btn perdido";
  btnPerdido.textContent = "Perdido";
  btnPerdido.addEventListener("click", () => elegir("perdida"));

  acciones.appendChild(btnCompletado);
  acciones.appendChild(btnPerdido);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn-discreto";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);

  card.append(titulo, nombre, pregunta, acciones, btnCancelar);
  overlay.appendChild(card);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) cerrar();
  });
  document.addEventListener("keydown", alTeclear);
  document.body.appendChild(overlay);
}

/**
 * Toque sobre el círculo de una tarea — lo comparten la lista/Resumen
 * (agenda.js) y la tarjeta de info (acá abajo), para que los 3 lugares se
 * comporten IGUAL (2026-09-21, reemplaza al viejo toggle de solo completada):
 *   - ya completada o perdida  -> vuelve a pendiente (reversible);
 *   - pendiente y VENCIDA       -> ventanita "Completado / Perdido";
 *   - pendiente y no vencida    -> completada directo, como siempre.
 * `alTerminar(viva)` es opcional (la tarjeta de info lo usa para repintarse).
 */
function manejarToqueCheckTarea(eventoId, alTerminar) {
  const viva = buscarEventoVivoPorId(eventoId);
  if (!viva || viva.tipo !== "tarea") return;
  if (viva.completada || viva.perdida) {
    aplicarEstadoTarea(eventoId, "pendiente", alTerminar);
    return;
  }
  if (esTareaVencida(viva)) {
    abrirSelectorEstadoTareaVencida(viva, (elegido) => aplicarEstadoTarea(eventoId, elegido, alTerminar));
    return;
  }
  aplicarEstadoTarea(eventoId, "completada", alTerminar);
}

function renderizarTarjetaInfoEventoAgenda(evento) {
  const estilo = obtenerEstiloEvento(evento);
  const badgeTipo = document.getElementById("info-agenda-badge-tipo");
  badgeTipo.className = `badge ${estilo.claseBadge}`;
  badgeTipo.textContent = estilo.etiqueta;

  document.getElementById("info-agenda-badge-vencida").classList.toggle("oculto", !esTareaVencida(evento));

  const nombreEl = document.getElementById("info-agenda-nombre");
  nombreEl.textContent = evento.nombre || "(sin nombre)";
  // "Perdida": tachado con raya roja y texto SIN atenuar (a diferencia de
  // "Completada", que va tachado normal y a 0.7 de opacidad).
  const esPerdida = evento.tipo === "tarea" && Boolean(evento.perdida);
  nombreEl.style.textDecoration = esPerdida || evento.completada ? "line-through" : "none";
  nombreEl.style.textDecorationColor = esPerdida ? COLOR_PERDIDA_RAYA : "";
  nombreEl.style.textDecorationThickness = esPerdida ? "2px" : "";
  nombreEl.style.opacity = evento.completada ? "0.7" : "1";

  document.getElementById("info-agenda-fecha").textContent = fechaLocalDesdeISO(evento.fecha).toLocaleDateString("es-CR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  document.getElementById("info-agenda-hora").textContent = evento.hora ? formatearHoraAmPm(evento.hora) : "Todo el día";

  const timerEl = document.getElementById("info-agenda-timer");
  const venceHoy = tareaVenceHoy(evento);
  timerEl.classList.toggle("oculto", !venceHoy);
  if (venceHoy) timerEl.textContent = formatearTiempoRestanteHoy(evento.fecha, evento.hora);

  const nombreMateria = obtenerNombreMateriaEvento(evento);
  document.getElementById("info-agenda-fila-materia").classList.toggle("oculto", !nombreMateria);
  document.getElementById("info-agenda-materia").textContent = nombreMateria;

  document.getElementById("info-agenda-fila-notas").classList.toggle("oculto", !evento.notas);
  document.getElementById("info-agenda-notas-texto").textContent = evento.notas || "";

  // Adjuntos: pills del sistema unificado (core/storage-adjuntos.js) —
  // tocar una la abre directo (archivo se descarga bajo demanda desde
  // Drive, enlace abre directo); "Gestionar" reordena/desactiva/borra.
  const adjuntos = obtenerAdjuntosActivosDe("evento", evento.id);
  const filaAdjuntos = document.getElementById("info-agenda-fila-adjuntos");
  const listaAdjuntos = document.getElementById("info-agenda-lista-adjuntos");
  const btnGestionarAdjuntos = document.getElementById("info-agenda-btn-gestionar-adjuntos");
  if (filaAdjuntos && listaAdjuntos) {
    filaAdjuntos.classList.toggle("oculto", adjuntos.length === 0);
    listaAdjuntos.innerHTML = "";
    adjuntos.forEach((adjunto) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "adjunto-pill";
      pill.title = adjunto.nombre;
      pill.innerHTML = `${adjunto.tipo === "enlace" ? "🔗" : "📄"} <span style="overflow:hidden; text-overflow:ellipsis;">${adjunto.nombre}</span>`;
      pill.addEventListener("click", () => abrirAdjunto(adjunto));
      listaAdjuntos.appendChild(pill);
    });
    if (btnGestionarAdjuntos) {
      btnGestionarAdjuntos.onclick = () => {
        abrirMenuAdjuntos({
          entidadTipo: "evento",
          entidadId: evento.id,
          titulo: "Adjuntos de este evento",
          onCambiar: () => renderizarTarjetaInfoEventoAgenda(buscarEventoVivoPorId(evento.id) || evento),
        });
      };
    }
  }

  // Punto 5: el mismo checkbox circular de la lista, disponible también
  // acá — solo aplica a tareas.
  const filaCompletada = document.getElementById("info-agenda-fila-completada");
  filaCompletada.classList.toggle("oculto", evento.tipo !== "tarea");
  const check = document.getElementById("info-agenda-check-completada");
  check.classList.toggle("marcada", Boolean(evento.completada));
  check.classList.toggle("perdida", esPerdida);
  check.onclick = () => manejarToqueCheckTarea(evento.id, (viva) => renderizarTarjetaInfoEventoAgenda(viva));
  document.getElementById("info-agenda-completada-texto").textContent = esPerdida
    ? "Perdida — toca para restaurar"
    : evento.completada
      ? "Completada"
      : esTareaVencida(evento)
        ? "Marcar como completada o perdida"
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
  document.getElementById("btn-agenda-adjuntar")?.addEventListener("click", () => {
    if (!idEventoActivoAdjuntos) return;
    abrirModalAdjuntar({
      entidadTipo: "evento",
      entidadId: idEventoActivoAdjuntos,
      onListo: renderizarListaAdjuntosFormulario,
    });
  });
  document.getElementById("btn-agenda-gestionar-adjuntos")?.addEventListener("click", abrirGestionAdjuntosEvento);
  document.getElementById("btn-agenda-cancelar").addEventListener("click", cancelarModalEventoAgenda);
  document.getElementById("modal-agenda-evento").addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-evento") cancelarModalEventoAgenda();
  });

  // Ronda de ajustes visuales #4: dropdown propio de "vincular a materia"
  // — tocar el botón abre/cierra la lista, un click afuera del contenedor
  // la cierra (mismo patrón que el resto de popovers del proyecto, ej.
  // #perfil-popover / lista de días pasados).
  document.getElementById("btn-agenda-materia-boton")?.addEventListener("click", alternarDropdownMateria);
  document.addEventListener("click", (ev) => {
    const cont = document.getElementById("contenedor-agenda-materia");
    if (!cont || cont.contains(ev.target)) return;
    cerrarDropdownMateria();
  });

  document.getElementById("btn-agenda-info-cerrar")?.addEventListener("click", cerrarTarjetaInfoEventoAgenda);
  document.getElementById("modal-agenda-info")?.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-info") cerrarTarjetaInfoEventoAgenda();
  });
}

export {
  abrirModalEventoAgenda,
  abrirTarjetaInfoEventoAgenda,
  confirmarBorrarEventoAgenda,
  inicializarModalAgendaEvento,
  manejarToqueCheckTarea,
  obtenerNombreMateriaEvento,
};
