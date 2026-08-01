/* =========================================================================
   SEMESTRES — Alta de semestre y listado (Fase 1 de "Semestres y Notas")
   Responsable de: el formulario de alta (nombre, fecha, duración, Modo
   Hardcore, selector de materias por bloque), la sincronía Matrícula↔Plan
   al guardar, y el listado de semestres (tarjeta colapsada por ahora — la
   tarjeta expandida con materias/categoría/requisito/historial vive en
   semestres-tarjetas.js, próxima entrega).

   Todavía NO incluye (a propósito, depende del motor de notas — Fase 6):
   - Horario, criterios/asignaciones, nota_final.
   - Botón "Terminar semestre" (mover a historial + revisión pasó/no-pasó
     por materia, sugerida según la nota). Mientras no exista, un semestre
     solo pasa de "actual" a "pasado" automáticamente al llegar a
     LIMITE_SEMANAS_SEMESTRE (ver obtenerEstadoEfectivoSemestre, schema.js).
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
import { construirTarjetaSemestre } from "./semestres-tarjetas.js";

/* ===================== Helpers de datos ===================== */

/** Todos los semestres cuyo estado EFECTIVO (ver schema.js) es "actual",
 *  más recientes primero. Puede haber más de uno a la vez (ej. alguien que
 *  registra el semestre siguiente antes de que el actual se autocierre). */
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

/** Créditos totales de un semestre: suma los créditos de cada materia
 *  matriculada, buscando cada una en el plan del que dice venir
 *  (mm.plan_estudio_id) — así funciona igual con Hardcore activo. */
function creditosTotalesSemestre(semestre) {
  return (semestre.materias_matriculadas || []).reduce((total, mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return total + (materia ? Number(materia.creditos) || 0 : 0);
  }, 0);
}

/* ===================== Sincronía Matrícula ↔ Plan de Estudios ===================== */

/**
 * Punto 3 del prompt: al marcar una materia como matriculada, su estado en
 * el Plan de Estudios pasa a "cursando" — usando el MISMO mecanismo que
 * cualquier otro cambio de estado manual (sellarTimestamp + marcarCambioPendiente),
 * nunca un cambio "silencioso" sin sellar.
 *
 * Repetir una materia "Aprobada": está permitido a propósito, sin ninguna
 * validación que lo bloquee. Al matricularla, pasa a "cursando" igual que
 * cualquier otra — mientras se está repitiendo, deja de contar como
 * aprobada en cualquier total que lea materia.estado (créditos aprobados,
 * candado de disponibilidad, etc.), hasta que se vuelva a marcar Aprobada o
 * Reprobada manualmente desde su tarjeta en el Plan de Estudios. No se
 * guarda ningún historial de la aprobación anterior en esta fase — eso es
 * candidato natural para el "Historial" de la materia (ver
 * abrirModalHistorial en plan-detalle.js) una vez que exista el módulo de
 * Semestres completo con notas (Fase 6).
 */
function marcarMateriaCursando(materia) {
  if (materia.estado === "cursando") return; // ya está, no reselles sin necesidad
  materia.estado = "cursando";
  sellarTimestamp(materia);
}

/* ===================== Alta de semestre (modal 100% en JS) ===================== */

// planId -> Set de códigos de materia marcados, mientras el modal está
// abierto. Vive fuera de estado.datos a propósito: es estado de UI
// transitorio del formulario, no un dato persistido.
let seleccionPorPlan = new Map();
let planVisibleEnSelector = null;

function planPorDefectoParaDuracion() {
  return obtenerPlanPorId(estado.datos.configuracion.plan_activo_id);
}

function resetearFormularioAlta() {
  seleccionPorPlan = new Map();
  planVisibleEnSelector = estado.datos.configuracion.plan_activo_id;
}

/** Botones apilados (uno por plan activo, hasta 3 — ver obtenerPlanesActivos)
 *  para elegir qué plan se ve AHORA en el checklist de abajo. Cambiar de
 *  plan visible NO borra lo ya marcado en los otros — se puede matricular
 *  de más de un plan en el mismo semestre (relevante para Hardcore). */
function construirSelectorPlanesHardcore(contenedor, planesIds, onCambiarVisible) {
  contenedor.innerHTML = "";
  if (planesIds.length <= 1) return; // con 1 solo plan activo no hace falta elegir nada

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

/** Checkboxes agrupado por bloque — punto 2 del prompt. */
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

  const porBloque = new Map();
  plan.materias.forEach((m) => {
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
        const fila = document.createElement("label");
        fila.className = "row";
        fila.style.cssText = "gap:8px; align-items:center; cursor:pointer;";

        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = seleccion.has(materia.codigo);
        chk.addEventListener("change", () => {
          if (chk.checked) seleccion.add(materia.codigo);
          else seleccion.delete(materia.codigo);
        });
        fila.appendChild(chk);

        const texto = document.createElement("span");
        texto.textContent = `${materia.codigo} — ${aplicarFormatoTexto(materia.nombre)}`;
        fila.appendChild(texto);

        bloqueCard.appendChild(fila);
      });

      contenedor.appendChild(bloqueCard);
    });
}

function abrirModalAltaSemestre() {
  resetearFormularioAlta();
  document.querySelectorAll(".overlay-alta-semestre").forEach((el) => el.remove());

  const cfg = estado.datos.configuracion;
  const planDefault = planPorDefectoParaDuracion();

  // Mismo patrón que abrirModalResolverConflicto (plan-vista-lista-tarjetas.js):
  // overlay 100% en JS, sin depender de markup estático en index.html.
  const overlay = document.createElement("div");
  overlay.className = "overlay-alta-semestre";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  caja.innerHTML = `<h2 style="margin:0;">Registrar semestre</h2>`;

  // ---- Nombre ----
  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Ej. Semestre 1, Verano 2026...";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  // ---- Fecha de inicio + duración (autocompletada desde el plan activo,
  // editable hasta LIMITE_SEMANAS_SEMESTRE) ----
  const filaFechas = document.createElement("div");
  filaFechas.className = "row";
  const bloqueFecha = document.createElement("div");
  bloqueFecha.style.flex = "1";
  bloqueFecha.innerHTML = `<span class="form-label">Fecha de inicio</span>`;
  const inputFecha = document.createElement("input");
  inputFecha.type = "date";
  inputFecha.className = "form-input";
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
  inputDuracion.value = String((planDefault && planDefault.parametros_universidad.semanas_por_bloque) || 16);
  bloqueDuracion.appendChild(inputDuracion);
  filaFechas.appendChild(bloqueDuracion);
  caja.appendChild(filaFechas);

  // ---- Modo Hardcore: solo tiene sentido mostrar el selector si hay más
  // de un plan activo ahora mismo (ver obtenerPlanesActivos, schema.js) ----
  const planesActivos = obtenerPlanesActivos(cfg);
  const contenedorSelectorPlanes = document.createElement("div");
  const contenedorChecklist = document.createElement("div");
  contenedorChecklist.className = "stack";

  if (planesActivos.length > 1) {
    const avisoHardcore = document.createElement("p");
    avisoHardcore.className = "muted";
    avisoHardcore.textContent = "Modo Hardcore activo: elegí de cuál plan sacar materias (podés marcar de más de uno).";
    caja.appendChild(avisoHardcore);
  }
  caja.appendChild(contenedorSelectorPlanes);
  caja.appendChild(contenedorChecklist);

  const refrescarSelectorYChecklist = () => {
    construirSelectorPlanesHardcore(contenedorSelectorPlanes, planesActivos, (planId) => {
      planVisibleEnSelector = planId;
      refrescarSelectorYChecklist();
    });
    construirChecklistMaterias(contenedorChecklist, obtenerPlanPorId(planVisibleEnSelector));
  };
  refrescarSelectorYChecklist();

  // ---- Error + botones ----
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
  btnGuardar.textContent = "Guardar";
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
        marcarMateriaCursando(materia);
      });
    });

    estado.datos.semestres = estado.datos.semestres || [];
    estado.datos.semestres.push(semestre);
    marcarCambioPendiente();
    overlay.remove();
    renderizarSemestres();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}





function renderizarSemestres() {
  const cont = document.getElementById("seccion-semestres");
  if (!cont) return;
  cont.innerHTML = "";

  const actuales = obtenerSemestresActuales();
  const pasados = obtenerSemestresPasados();

  if (actuales.length === 0) {
    const cardVacio = document.createElement("section");
    cardVacio.className = "glass-card stack";
    cardVacio.innerHTML = `<p class="muted">Todavía no tenés un semestre registrado.</p>`;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";
    btn.textContent = "Registrar semestre";
    btn.addEventListener("click", abrirModalAltaSemestre);
    cardVacio.appendChild(btn);
    cont.appendChild(cardVacio);
  } else {
    actuales.forEach((s) => cont.appendChild(construirTarjetaSemestre(s, obtenerPlanPorId, renderizarSemestres)));
    const btnOtro = document.createElement("button");
    btnOtro.type = "button";
    btnOtro.className = "btn btn-secondary btn-block";
    btnOtro.textContent = "+ Agregar otro semestre";
    btnOtro.addEventListener("click", abrirModalAltaSemestre);
    cont.appendChild(btnOtro);
  }

  if (pasados.length > 0) {
    const seccionPasados = document.createElement("section");
    seccionPasados.className = "glass-card stack";
    seccionPasados.innerHTML = `<h3 style="margin:0;">Semestres pasados</h3>`;
    pasados.forEach((s) => seccionPasados.appendChild(construirTarjetaSemestre(s, obtenerPlanPorId, renderizarSemestres)));
    cont.appendChild(seccionPasados);
  }
}

export { abrirModalAltaSemestre, obtenerSemestresActuales, obtenerSemestresPasados, renderizarSemestres }; 