/* =========================================================================
   SEMESTRES — Alta, edición y listado (Fase 1 de "Semestres y Notas")
   Responsable de: el formulario de alta/edición (nombre, fecha, duración,
   Modo Hardcore, buscador + filtro por estado, checklist de materias por
   bloque), la sincronía Matrícula → Plan, el modo edición (editar/borrar
   semestres), y el listado (actuales + pasados).

   Todavía NO incluye (a propósito, depende del motor de notas — Fase 6):
   - Horario, criterios/asignaciones, nota_final.
   - Botón "Terminar semestre" (mover a historial + revisión pasó/no-pasó
     por materia). Mientras no exista, un semestre solo pasa de "actual" a
     "pasado" automáticamente al llegar a LIMITE_SEMANAS_SEMESTRE, o si el
     usuario lo fuerza a mano (ver semestres-tarjetas.js).
   ========================================================================= */

import {
  LIMITE_SEMANAS_SEMESTRE,
  crearMateriaMatriculada,
  crearSemestre,
  obtenerEstadoEfectivoSemestre,
  obtenerPlanesActivos,
  sellarTimestamp,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { construirTarjetaSemestre } from "./semestres-tarjetas.js";

// Transitorio (no persistido): si el "modo edición" de Semestres está activo
// — mismo concepto que estado.modoEdicionPlan en el Plan de Estudios.
estado.modoEdicionSemestres = false;

/* ===================== Helpers de datos ===================== */

function obtenerSemestresActuales() {
  return (estado.datos.semestres || [])
    .filter((s) => obtenerEstadoEfectivoSemestre(s) === "actual")
    .sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)));
}

function obtenerSemestresPasados() {
  return (estado.datos.semestres || [])
    .filter((s) => obtenerEstadoEfectivoSemestre(s) === "pasado")
    .sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)));
}

function obtenerPlanPorId(planId) {
  return estado.datos.planes_estudio.find((p) => p.id === planId) || null;
}

function creditosTotalesSemestre(semestre) {
  return (semestre.materias_matriculadas || []).reduce((total, mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return total + (materia ? Number(materia.creditos) || 0 : 0);
  }, 0);
}

/* ===================== Sincronía Matrícula ↔ Plan de Estudios ===================== */

/**
 * v2.1.2 — prioriza lo que YA hay cargado en el Plan de Estudios (lo más
 * probable es que se registre ahí primero):
 * - "aprobado" -> se queda igual. Matricular NO la toca (no tiene sentido
 *   "repetir" algo aprobado solo por matricularlo).
 * - "reprobado" / "pendiente" -> pasa a "cursando".
 * - "cursando" -> no-op, ya está.
 */
function sincronizarEstadoAlMatricular(materia) {
  if (materia.estado === "aprobado" || materia.estado === "cursando") return;
  materia.estado = "cursando";
  sellarTimestamp(materia);
}

/* ===================== Alta / edición de semestre (modal 100% en JS) ===================== */

let seleccionPorPlan = new Map();
let planVisibleEnSelector = null;
let busquedaAltaSemestre = "";
let estadosOcultosAltaSemestre = new Set(); // "aprobado" | "reprobado" -> oculto del checklist

function planPorDefectoParaDuracion() {
  return obtenerPlanPorId(estado.datos.configuracion.plan_activo_id);
}

/** `semestreExistente` = null -> alta nueva. Si viene un semestre, precarga
 *  su matrícula actual en seleccionPorPlan (edición). */
function resetearFormularioAlta(semestreExistente) {
  seleccionPorPlan = new Map();
  busquedaAltaSemestre = "";
  estadosOcultosAltaSemestre = new Set();

  if (semestreExistente) {
    (semestreExistente.materias_matriculadas || []).forEach((mm) => {
      const plan = obtenerPlanPorId(mm.plan_estudio_id);
      const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
      if (!plan || !materia) return;
      if (!seleccionPorPlan.has(plan.id)) seleccionPorPlan.set(plan.id, new Set());
      seleccionPorPlan.get(plan.id).add(materia.codigo);
    });
    planVisibleEnSelector = (semestreExistente.plan_estudio_id && semestreExistente.plan_estudio_id[0]) || estado.datos.configuracion.plan_activo_id;
  } else {
    planVisibleEnSelector = estado.datos.configuracion.plan_activo_id;
  }
}

function construirSelectorPlanesHardcore(contenedor, planesIds, onCambiarVisible) {
  contenedor.innerHTML = "";
  if (planesIds.length <= 1) return;

  const grupo = document.createElement("div");
  grupo.className = "stack";
  grupo.style.gap = "6px";
  planesIds.forEach((planId) => {
    const plan = obtenerPlanPorId(planId);
    if (!plan) return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-block " + (planId === planVisibleEnSelector ? "btn-primary" : "btn-secondary");
    const marcadas = (seleccionPorPlan.get(planId) || new Set()).size;
    btn.textContent = `${plan.universidad} · ${aplicarFormatoTexto(plan.nombre_carrera)}` + (marcadas > 0 ? ` (${marcadas})` : "");
    btn.addEventListener("click", () => onCambiarVisible(planId));
    grupo.appendChild(btn);
  });
  contenedor.appendChild(grupo);
}

function construirBuscadorAltaSemestre(contenedor, onCambiar) {
  contenedor.innerHTML = "";
  const input = document.createElement("input");
  input.type = "text";
  input.className = "form-input";
  input.placeholder = "Buscar por nombre o código…";
  input.value = busquedaAltaSemestre;
  input.addEventListener("input", () => {
    busquedaAltaSemestre = input.value;
    onCambiar();
  });
  contenedor.appendChild(input);
}

function construirPillsFiltroEstado(contenedor, onCambiar) {
  contenedor.innerHTML = "";
  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.alignItems = "center";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.textContent = "Mostrar:";
  fila.appendChild(etiqueta);

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  [
    { valor: "aprobado", texto: "Aprobados" },
    { valor: "reprobado", texto: "Reprobados" },
  ].forEach(({ valor, texto }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estadosOcultosAltaSemestre.has(valor) ? "" : " active");
    btn.textContent = texto;
    btn.addEventListener("click", () => {
      if (estadosOcultosAltaSemestre.has(valor)) estadosOcultosAltaSemestre.delete(valor);
      else estadosOcultosAltaSemestre.add(valor);
      onCambiar();
    });
    grupo.appendChild(btn);
  });
  fila.appendChild(grupo);
  contenedor.appendChild(fila);
}

/** Checkboxes agrupado por bloque, con buscador + filtro por estado.
 *  Checkbox custom (.checkbox/.box de design-system.css — mismo markup que
 *  renderizarListaMateriasCheckbox en plan-categorias.js). Código en columna
 *  de ancho fijo para que el nombre siempre arranque en la misma posición. */
function construirChecklistMaterias(contenedor, plan) {
  contenedor.innerHTML = "";
  if (!plan) {
    contenedor.innerHTML = `<p class="muted">Elegí un plan arriba para ver sus materias.</p>`;
    return;
  }
  if (plan.materias.length === 0) {
    contenedor.innerHTML = `<p class="muted">Este plan todavía no tiene materias.</p>`;
    return;
  }

  const seleccion = seleccionPorPlan.get(plan.id) || new Set();
  seleccionPorPlan.set(plan.id, seleccion);

  let materias = plan.materias.filter((m) => !estadosOcultosAltaSemestre.has(m.estado) || seleccion.has(m.codigo));
  const q = busquedaAltaSemestre.trim().toLowerCase();
  if (q) materias = materias.filter((m) => m.nombre.toLowerCase().includes(q) || m.codigo.toLowerCase().includes(q));

  if (materias.length === 0) {
    contenedor.innerHTML = `<p class="muted">No hay materias que coincidan con el filtro.</p>`;
    return;
  }

  const porBloque = new Map();
  materias.forEach((m) => {
    if (!porBloque.has(m.bloque)) porBloque.set(m.bloque, []);
    porBloque.get(m.bloque).push(m);
  });

  Array.from(porBloque.keys())
    .sort((a, b) => Number(a) - Number(b))
    .forEach((bloque) => {
      const bloqueCard = document.createElement("div");
      bloqueCard.className = "glass-panel stack";
      bloqueCard.style.padding = "10px 12px";

      const titulo = document.createElement("p");
      titulo.style.cssText = "font-weight:700; margin:0 0 4px;";
      titulo.textContent = `${plan.parametros_universidad.nombre_bloque} ${bloque}`;
      bloqueCard.appendChild(titulo);

      porBloque.get(bloque).forEach((materia) => {
        const label = document.createElement("label");
        label.className = "checkbox";
        label.innerHTML = `
          <input type="checkbox" ${seleccion.has(materia.codigo) ? "checked" : ""}>
          <span class="box"></span>
          <span style="display:flex; align-items:center; gap:8px; flex:1; min-width:0;">
            <span style="min-width:64px; flex-shrink:0; font-family:monospace; font-size:0.85rem;">${materia.codigo}</span>
            <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${aplicarFormatoTexto(materia.nombre)}</span>
          </span>
        `;
        label.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
          if (e.target.checked) seleccion.add(materia.codigo);
          else seleccion.delete(materia.codigo);
        });
        bloqueCard.appendChild(label);
      });

      contenedor.appendChild(bloqueCard);
    });
}

function guardarNuevoSemestre({ nombre, fecha, duracion, planesConSeleccion }) {
  const semestre = crearSemestre({
    nombre,
    fecha_inicio: fecha,
    duracion_semanas: duracion,
    planesEstudioIds: planesConSeleccion,
  });

  seleccionPorPlan.forEach((codigos, planId) => {
    const plan = obtenerPlanPorId(planId);
    if (!plan) return;
    codigos.forEach((codigo) => {
      const materia = plan.materias.find((m) => m.codigo === codigo);
      if (!materia) return;
      semestre.materias_matriculadas.push(crearMateriaMatriculada({ materiaId: materia.id, planEstudioId: planId }));
      sincronizarEstadoAlMatricular(materia);
    });
  });

  estado.datos.semestres = estado.datos.semestres || [];
  estado.datos.semestres.push(semestre);
  marcarCambioPendiente();
}

/**
 * Edición completa: reescribe nombre/fecha/duración/planes como si se
 * creara de nuevo, pero SIN perder lo que ya había — la matrícula existente
 * se reconcilia contra la selección nueva del checklist en vez de borrarse
 * y recrearse entera, así lo que no cambió conserva su `id`/sello propio, y
 * solo lo que de verdad cambió genera alta o tumba nueva.
 */
function guardarEdicionSemestre(semestre, { nombre, fecha, duracion, planesConSeleccion }) {
  semestre.nombre = nombre;
  semestre.fecha_inicio = fecha;
  semestre.duracion_semanas = duracion;
  semestre.plan_estudio_id = planesConSeleccion;

  const seleccionNueva = new Set();
  seleccionPorPlan.forEach((codigos, planId) => {
    const plan = obtenerPlanPorId(planId);
    if (!plan) return;
    codigos.forEach((codigo) => {
      const materia = plan.materias.find((m) => m.codigo === codigo);
      if (materia) seleccionNueva.add(`${planId}::${materia.id}`);
    });
  });

  // Lo que ya no está marcado se borra CON tumba (regla obligatoria) — no se
  // toca el estado de esa materia en el Plan al desmatricularla.
  const clavesExistentes = new Set();
  semestre.materias_matriculadas = (semestre.materias_matriculadas || []).filter((mm) => {
    const clave = `${mm.plan_estudio_id}::${mm.materia_id}`;
    clavesExistentes.add(clave);
    const sigueMarcada = seleccionNueva.has(clave);
    if (!sigueMarcada) {
      semestre._eliminados_materias_matriculadas = semestre._eliminados_materias_matriculadas || [];
      semestre._eliminados_materias_matriculadas.push({ id: mm.id, eliminadoEn: Date.now() });
    }
    return sigueMarcada;
  });

  // Lo que está marcado y no existía todavía -> matrícula nueva.
  seleccionPorPlan.forEach((codigos, planId) => {
    const plan = obtenerPlanPorId(planId);
    if (!plan) return;
    codigos.forEach((codigo) => {
      const materia = plan.materias.find((m) => m.codigo === codigo);
      if (!materia) return;
      const clave = `${planId}::${materia.id}`;
      if (clavesExistentes.has(clave)) return;
      semestre.materias_matriculadas.push(crearMateriaMatriculada({ materiaId: materia.id, planEstudioId: planId }));
      sincronizarEstadoAlMatricular(materia);
    });
  });

  sellarTimestamp(semestre);
  marcarCambioPendiente();
}

function abrirModalAltaSemestre(semestreExistente = null) {
  resetearFormularioAlta(semestreExistente);
  document.querySelectorAll(".overlay-alta-semestre").forEach((el) => el.remove());

  const cfg = estado.datos.configuracion;
  const esEdicion = !!semestreExistente;
  const planDefault = planPorDefectoParaDuracion();

  const overlay = document.createElement("div");
  overlay.className = "overlay-alta-semestre";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  caja.innerHTML = `<h2 style="margin:0;">${esEdicion ? "Editar semestre" : "Registrar semestre"}</h2>`;

  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Ej. Semestre 1, Verano 2026...";
  inputNombre.value = esEdicion ? semestreExistente.nombre : "";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  const filaFechas = document.createElement("div");
  filaFechas.className = "row";
  const bloqueFecha = document.createElement("div");
  bloqueFecha.style.flex = "1";
  bloqueFecha.innerHTML = `<span class="form-label">Fecha de inicio</span>`;
  const inputFecha = document.createElement("input");
  inputFecha.type = "date";
  inputFecha.className = "form-input";
  inputFecha.value = esEdicion ? semestreExistente.fecha_inicio : "";
  bloqueFecha.appendChild(inputFecha);
  filaFechas.appendChild(bloqueFecha);

  const bloqueDuracion = document.createElement("div");
  bloqueDuracion.style.flex = "1";
  bloqueDuracion.innerHTML = `<span class="form-label">Duración (semanas)</span>`;
  const inputDuracion = document.createElement("input");
  inputDuracion.type = "number";
  inputDuracion.className = "form-input";
  inputDuracion.min = "1";
  inputDuracion.max = String(LIMITE_SEMANAS_SEMESTRE);
  inputDuracion.value = String(
    esEdicion ? semestreExistente.duracion_semanas : (planDefault && planDefault.parametros_universidad.semanas_por_bloque) || 16
  );
  bloqueDuracion.appendChild(inputDuracion);
  filaFechas.appendChild(bloqueDuracion);
  caja.appendChild(filaFechas);

  const planesIds = Array.from(new Set([...obtenerPlanesActivos(cfg), ...(esEdicion ? semestreExistente.plan_estudio_id : [])]));

  if (planesIds.length > 1) {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.textContent = "Modo Hardcore: elegí de cuál plan sacar materias (podés marcar de más de uno).";
    caja.appendChild(aviso);
  }

  const contenedorBuscador = document.createElement("div");
  const contenedorFiltroEstado = document.createElement("div");
  const contenedorSelectorPlanes = document.createElement("div");
  const contenedorChecklist = document.createElement("div");
  contenedorChecklist.className = "stack";
  caja.appendChild(contenedorBuscador);
  caja.appendChild(contenedorFiltroEstado);
  caja.appendChild(contenedorSelectorPlanes);
  caja.appendChild(contenedorChecklist);

  const refrescarChecklist = () => construirChecklistMaterias(contenedorChecklist, obtenerPlanPorId(planVisibleEnSelector));
  const refrescarSelectorYChecklist = () => {
    construirSelectorPlanesHardcore(contenedorSelectorPlanes, planesIds, (planId) => {
      planVisibleEnSelector = planId;
      refrescarSelectorYChecklist();
    });
    refrescarChecklist();
  };
  construirBuscadorAltaSemestre(contenedorBuscador, refrescarChecklist);
  construirPillsFiltroEstado(contenedorFiltroEstado, refrescarChecklist);
  refrescarSelectorYChecklist();

  const error = document.createElement("p");
  error.className = "muted oculto";
  error.style.color = "var(--color-danger)";
  caja.appendChild(error);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.justifyContent = "flex-end";
  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", () => overlay.remove());
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = esEdicion ? "Guardar cambios" : "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const fecha = inputFecha.value;
    const duracion = Math.min(Number(inputDuracion.value) || 0, LIMITE_SEMANAS_SEMESTRE);
    const totalMarcadas = Array.from(seleccionPorPlan.values()).reduce((n, set) => n + set.size, 0);

    if (!nombre || !fecha || !duracion) {
      error.textContent = "Nombre, fecha de inicio y duración son obligatorios.";
      error.classList.remove("oculto");
      return;
    }
    if (totalMarcadas === 0) {
      error.textContent = "Marcá al menos una materia para matricular.";
      error.classList.remove("oculto");
      return;
    }

    const planesConSeleccion = Array.from(seleccionPorPlan.keys()).filter(
      (id) => (seleccionPorPlan.get(id) || new Set()).size > 0
    );

    if (esEdicion) guardarEdicionSemestre(semestreExistente, { nombre, fecha, duracion, planesConSeleccion });
    else guardarNuevoSemestre({ nombre, fecha, duracion, planesConSeleccion });

    overlay.remove();
    renderizarSemestres();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

/* ===================== Modo edición / borrar ===================== */

function alternarModoEdicionSemestres() {
  estado.modoEdicionSemestres = !estado.modoEdicionSemestres;
  renderizarSemestres();
}

function abrirConfirmacionBorrarSemestre(semestre) {
  abrirConfirmacion({
    titulo: "Eliminar semestre",
    mensaje: `¿Seguro que querés eliminar "${semestre.nombre}"? Se pierde el registro de qué materias matriculaste ahí.`,
    textoConfirmar: "Eliminar definitivamente",
    onConfirmar: () => {
      estado.datos.semestres = (estado.datos.semestres || []).filter((s) => s.id !== semestre.id);
      estado.datos._eliminados_semestres = estado.datos._eliminados_semestres || [];
      estado.datos._eliminados_semestres.push({ id: semestre.id, eliminadoEn: Date.now() });
      marcarCambioPendiente();
      renderizarSemestres();
    },
  });
}

/* ===================== Listado ===================== */

function renderizarSemestres() {
  const cont = document.getElementById("seccion-semestres");
  if (!cont) return;
  cont.innerHTML = "";

  const actuales = obtenerSemestresActuales();
  const pasados = obtenerSemestresPasados();
  const onEditar = (semestre) => abrirModalAltaSemestre(semestre);
  const onBorrar = (semestre) => abrirConfirmacionBorrarSemestre(semestre);

  if (actuales.length === 0) {
    const cardVacio = document.createElement("section");
    cardVacio.className = "glass-card stack";
    cardVacio.innerHTML = `<p class="muted">Todavía no tenés un semestre registrado.</p>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";
    btn.textContent = "Registrar semestre";
    btn.addEventListener("click", () => abrirModalAltaSemestre());
    cardVacio.appendChild(btn);
    cont.appendChild(cardVacio);
  } else {
    actuales.forEach((s) => cont.appendChild(construirTarjetaSemestre(s, obtenerPlanPorId, renderizarSemestres, onEditar, onBorrar)));

    const filaBotones = document.createElement("div");
    filaBotones.className = "row";

    const btnOtro = document.createElement("button");
    btnOtro.type = "button";
    btnOtro.className = "btn btn-secondary";
    btnOtro.style.flex = "1";
    btnOtro.textContent = "+ Agregar otro semestre";
    btnOtro.addEventListener("click", () => abrirModalAltaSemestre());
    filaBotones.appendChild(btnOtro);

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn " + (estado.modoEdicionSemestres ? "btn-primary" : "btn-secondary");
    btnEditar.style.flex = "1";
    btnEditar.textContent = estado.modoEdicionSemestres ? "Listo" : "Editar semestres";
    btnEditar.addEventListener("click", alternarModoEdicionSemestres);
    filaBotones.appendChild(btnEditar);

    cont.appendChild(filaBotones);
  }

  if (pasados.length > 0) {
    const seccionPasados = document.createElement("section");
    seccionPasados.className = "glass-card stack";
    seccionPasados.innerHTML = `<h3 style="margin:0;">Semestres pasados</h3>`;
    pasados.forEach((s) => seccionPasados.appendChild(construirTarjetaSemestre(s, obtenerPlanPorId, renderizarSemestres, onEditar, onBorrar)));
    cont.appendChild(seccionPasados);
  }
}

export { abrirModalAltaSemestre, obtenerSemestresActuales, obtenerSemestresPasados, renderizarSemestres };