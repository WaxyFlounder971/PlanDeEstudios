/* =========================================================================
   PLAN DE ESTUDIOS — GESTIONAR PLANES
   Selector de plan activo, Modo Hardcore, y el modal de gestión
   (reordenar, eliminar, favorito).
   ========================================================================= */

import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { LIMITE_PLANES_ESTUDIO } from "./plan-esquema.js";
import { exportarPlanACSV, renderizarPlanEstudios } from "./plan-vista-lista.js";

/* --------------------------- Selector de plan --------------------------- */

function renderizarSelectorPlan() {
  const cont = document.getElementById("selector-plan");
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún Plan de Estudios. Eso se agrega en la Iteración 1 (importar tu malla curricular).</p>`;
    return;
  }

  cont.innerHTML = "";
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  planes.forEach((plan) => {
    const btn = document.createElement("button");
    btn.className = "pill-item" + (plan.id === estado.datos.configuracion.plan_activo_id ? " active" : "");
    btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      estado.datos.configuracion.plan_activo_id = plan.id;
      marcarCambioPendiente();
      renderizarSelectorPlan();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}

/* --------------------------- Modo Hardcore 💀 --------------------------- */

function renderizarModoHardcore() {
  const cfg = estado.datos.configuracion;
  const chk = document.getElementById("switch-modo-hardcore");
  const bloque = document.getElementById("bloque-plan-secundario");

  chk.checked = !!cfg.modo_hardcore;
  bloque.classList.toggle("oculto", !cfg.modo_hardcore);

  chk.onchange = () => {
    cfg.modo_hardcore = chk.checked;
    if (!cfg.modo_hardcore) {
      // No se borran datos, solo se deja de combinar/mostrar el segundo plan.
      bloque.classList.add("oculto");
    } else {
      bloque.classList.remove("oculto");
    }
    marcarCambioPendiente();
    if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  };

  const cont = document.getElementById("selector-plan-secundario");
  const planes = estado.datos.planes_estudio.filter((p) => p.id !== cfg.plan_activo_id);
  cont.innerHTML = "";

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Necesitas al menos un segundo Plan de Estudios importado para usar el Modo Hardcore.</p>`;
    return;
  }

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  planes.forEach((plan) => {
    const btn = document.createElement("button");
    btn.className = "pill-item" + (plan.id === cfg.plan_activo_secundario_id ? " active" : "");
    btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      cfg.plan_activo_secundario_id = plan.id;
      marcarCambioPendiente();
      renderizarModoHardcore();
      if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}
estado.planGestionImportandoId = null;     // qué fila del panel de gestión tiene el mini-import abierto
estado.reabrirGestionPlanesTrasCrear = false;
estado.arrastrandoPlanId = null;          // v5 1.4: drag-and-drop en Gestionar plan

/* ===================== B.4 — Gestión de Planes de Estudio (máximo 3) ===================== */

function abrirModalGestionPlanes() {
  renderizarListaGestionPlanes();
  renderizarModoHardcore();
  document.getElementById("modal-gestion-planes").classList.remove("oculto");
}

/** v5 1.4: tarjetas arrastrables para reordenar los planes — la primera del
 *  orden es automáticamente la favorita/principal (estrella a la derecha,
 *  sin botón de estrella aparte). Reordenar NO cambia cuál es plan_activo_id
 *  (eso lo sigue controlando el carrusel del encabezado); solo cambia el
 *  orden de la lista y por lo tanto cuál queda marcada como favorita. */

function renderizarListaGestionPlanes() {
  const cont = document.getElementById("lista-gestion-planes");
  cont.innerHTML = "";
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún plan.</p>`;
  }

  planes.forEach((plan, indice) => {
    const fila = document.createElement("div");
    fila.className = "glass-panel row-between plan-gestion-fila";
    fila.style.padding = "10px 14px";
    fila.style.flexWrap = "wrap";
    fila.style.gap = "8px";
    fila.draggable = true;
    fila.dataset.planId = plan.id;

    const info = document.createElement("span");
    info.textContent =
      `${plan.universidad} · ${aplicarFormatoTexto(plan.nombre_carrera)}` +
      (plan.codigo_plan ? ` (${plan.codigo_plan})` : "") +
      (plan.materias.length === 0 ? " — sin materias" : ` — ${plan.materias.length} materias`);
    fila.appendChild(info);

    const derecha = document.createElement("div");
    derecha.className = "row";

    // v1.14.1: editar nombre de carrera/universidad/código/tipo de título de
    // este plan puntual — no cambia su estructura académica (bloques, tipos
    // de horas), solo los datos de cabecera. Ver abrirModalEditarPlanInfo.
    const btnEditarInfo = document.createElement("button");
    btnEditarInfo.className = "btn btn-secondary";
    btnEditarInfo.title = "Editar nombre de la carrera, universidad, etc.";
    btnEditarInfo.textContent = "✏️";
    btnEditarInfo.addEventListener("click", () => abrirModalEditarPlanInfo(plan));
    derecha.appendChild(btnEditarInfo);

    const btnEliminar = document.createElement("button");
    btnEliminar.className = "btn btn-danger";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar Plan de Estudios",
        mensaje: `¿Seguro que quieres eliminar "${plan.nombre_carrera}"? Se perderán todas sus materias y categorías.`,
        textoConfirmar: "Eliminar definitivamente",
        onConfirmar: () => eliminarPlanEstudio(plan.id),
      });
    });
    derecha.appendChild(btnEliminar);

    // v1.9.8: exporta este plan puntual (no necesariamente el activo) —
    // exportarPlanACSV ya soporta recibir un plan explícito para este caso.
    const btnExportar = document.createElement("button");
    btnExportar.className = "btn btn-secondary";
    btnExportar.textContent = "Exportar CSV";
    btnExportar.title = `Exportar "${plan.nombre_carrera}" a CSV`;
    btnExportar.addEventListener("click", () => exportarPlanACSV(plan));
    derecha.appendChild(btnExportar);

    if (indice === 0) {
      const estrella = document.createElement("span");
      estrella.className = "plan-gestion-estrella";
      estrella.title = "Plan favorito/principal";
      estrella.textContent = "★";
      derecha.appendChild(estrella);
    }

    fila.appendChild(derecha);

    // ---- Drag and drop para reordenar ----
    fila.addEventListener("dragstart", () => {
      estado.arrastrandoPlanId = plan.id;
      fila.classList.add("arrastrando");
    });
    fila.addEventListener("dragend", () => {
      fila.classList.remove("arrastrando");
      estado.arrastrandoPlanId = null;
      document.querySelectorAll(".plan-gestion-fila.sobre-drop").forEach((el) => el.classList.remove("sobre-drop"));
    });
    fila.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (estado.arrastrandoPlanId && estado.arrastrandoPlanId !== plan.id) fila.classList.add("sobre-drop");
    });
    fila.addEventListener("dragleave", () => fila.classList.remove("sobre-drop"));
    fila.addEventListener("drop", (e) => {
      e.preventDefault();
      fila.classList.remove("sobre-drop");
      const origenId = estado.arrastrandoPlanId;
      if (!origenId || origenId === plan.id) return;
      const idxOrigen = estado.datos.planes_estudio.findIndex((p) => p.id === origenId);
      const idxDestino = estado.datos.planes_estudio.findIndex((p) => p.id === plan.id);
      if (idxOrigen === -1 || idxDestino === -1) return;
      const [movido] = estado.datos.planes_estudio.splice(idxOrigen, 1);
      estado.datos.planes_estudio.splice(idxDestino, 0, movido);
      marcarCambioPendiente();
      renderizarListaGestionPlanes();
    });

    cont.appendChild(fila);
  });

  const btnAgregar = document.getElementById("btn-agregar-plan-gestion");
  const aviso = document.getElementById("aviso-limite-planes");
  const alcanzoLimite = planes.length >= LIMITE_PLANES_ESTUDIO;
  btnAgregar.disabled = alcanzoLimite;
  aviso.classList.toggle("oculto", !alcanzoLimite);
}

function eliminarPlanEstudio(planId) {
  const cfg = estado.datos.configuracion;
  estado.datos.planes_estudio = estado.datos.planes_estudio.filter((p) => p.id !== planId);
  if (cfg.plan_activo_id === planId) {
    cfg.plan_activo_id = estado.datos.planes_estudio[0] ? estado.datos.planes_estudio[0].id : null;
  }
  if (cfg.plan_activo_secundario_id === planId) {
    cfg.plan_activo_secundario_id = null;
  }
  marcarCambioPendiente();
  renderizarListaGestionPlanes();
  renderizarSelectorPlan();
  renderizarModoHardcore();
  renderizarPlanEstudios();
}

function inicializarModalGestionPlanes() {
  const cerrarModalGestionPlanes = () => {
    document.getElementById("modal-gestion-planes").classList.add("oculto");
    // El cierre nunca debe depender de si una importación terminó bien o mal;
    // además se resetea el mini-panel abierto para que la próxima vez que se
    // abra la gestión de planes no aparezca "atascada" en modo importación.
    estado.planGestionImportandoId = null;
  };

  document.getElementById("btn-cerrar-gestion-planes").addEventListener("click", cerrarModalGestionPlanes);
  document.getElementById("modal-gestion-planes").addEventListener("click", (e) => {
    if (e.target.id === "modal-gestion-planes") cerrarModalGestionPlanes();
  });
  document.getElementById("btn-agregar-plan-gestion").addEventListener("click", () => {
    document.getElementById("modal-gestion-planes").classList.add("oculto");
    estado.csvPendienteDeImportar = null;
    estado.reabrirGestionPlanesTrasCrear = true;
    // v1.10.1 (punto 1): ya no se abre abrirModalCrearPlan() directo — primero
    // se fuerza el panel de importación (construirPanelImportacion, el mismo
    // que ve un usuario nuevo). El modal de carrera/universidad/código recién
    // se abre después, dentro de manejarClickImportar, una vez que ya se
    // pegó/subió el CSV — igual que en el flujo del primer plan.
    estado.mostrarPanelImportacionNuevoPlan = true;
    renderizarPlanEstudios();
  });
}

/* ===================== v1.14.1 — Editar info de la carrera ===================== *
 * Lapicito por fila en Gestionar Planes: edita SOLO los datos de cabecera
 * (nombre_carrera, universidad, codigo_plan, tipo_titulo) de un plan que ya
 * existe — nunca su estructura académica (bloques, tipos de horas, etc.),
 * eso sigue viviendo en Crear Plan / la importación. */

estado.editarPlanInfoId = null; // qué plan.id está abierto en este modal

function abrirModalEditarPlanInfo(plan) {
  estado.editarPlanInfoId = plan.id;
  document.getElementById("input-editar-plan-nombre-carrera").value = plan.nombre_carrera || "";
  document.getElementById("input-editar-plan-universidad").value = plan.universidad || "";
  document.getElementById("input-editar-plan-codigo").value = plan.codigo_plan || "";
  document.getElementById("input-editar-plan-tipo-titulo").value = plan.tipo_titulo || "";
  const params = plan.parametros_universidad || {};
  document.getElementById("input-editar-plan-nombre-bloque").value = params.nombre_bloque || "";
  document.getElementById("input-editar-plan-semanas").value = params.semanas_por_bloque || "";
  document.getElementById("input-editar-plan-hora-inicio").value = params.horario_inicio_default || "";
  document.getElementById("input-editar-plan-duracion").value = params.horario_duracion_bloque_min || "";
  document.getElementById("error-editar-plan-info").classList.add("oculto");
  document.getElementById("modal-editar-plan-info").classList.remove("oculto");
}

function cerrarModalEditarPlanInfo() {
  estado.editarPlanInfoId = null;
  document.getElementById("modal-editar-plan-info").classList.add("oculto");
}

function inicializarModalEditarPlanInfo() {
  document.getElementById("btn-cancelar-editar-plan-info").addEventListener("click", cerrarModalEditarPlanInfo);
  document.getElementById("modal-editar-plan-info").addEventListener("click", (e) => {
    if (e.target.id === "modal-editar-plan-info") cerrarModalEditarPlanInfo();
  });

  document.getElementById("btn-guardar-editar-plan-info").addEventListener("click", () => {
    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.editarPlanInfoId);
    const error = document.getElementById("error-editar-plan-info");
    if (!plan) {
      cerrarModalEditarPlanInfo();
      return;
    }

    const nombreCarrera = document.getElementById("input-editar-plan-nombre-carrera").value.trim();
    const universidad = document.getElementById("input-editar-plan-universidad").value.trim();
    const codigoPlan = document.getElementById("input-editar-plan-codigo").value.trim();
    const tipoTitulo = document.getElementById("input-editar-plan-tipo-titulo").value.trim();
    const nombreBloque = document.getElementById("input-editar-plan-nombre-bloque").value.trim();
    const semanas = Number(document.getElementById("input-editar-plan-semanas").value);
    const horaInicio = document.getElementById("input-editar-plan-hora-inicio").value;
    const duracion = Number(document.getElementById("input-editar-plan-duracion").value);

    if (!nombreCarrera || !universidad) {
      error.textContent = "El nombre de la carrera y la universidad son obligatorios.";
      error.classList.remove("oculto");
      return;
    }
    if (!nombreBloque || !semanas || !horaInicio || !duracion) {
      error.textContent = "Nombre de bloque, semanas, hora de inicio y duración son obligatorios.";
      error.classList.remove("oculto");
      return;
    }

    plan.nombre_carrera = nombreCarrera;
    plan.universidad = universidad;
    plan.codigo_plan = codigoPlan || null;
    plan.tipo_titulo = tipoTitulo || null;
    plan.parametros_universidad.nombre_bloque = nombreBloque;
    plan.parametros_universidad.semanas_por_bloque = semanas;
    plan.parametros_universidad.horario_inicio_default = horaInicio;
    plan.parametros_universidad.horario_duracion_bloque_min = duracion;

    marcarCambioPendiente();
    cerrarModalEditarPlanInfo();
    renderizarListaGestionPlanes();
    renderizarSelectorPlan();
    renderizarModoHardcore();
    renderizarPlanEstudios();
  });
}

export {
  abrirModalEditarPlanInfo,
  abrirModalGestionPlanes,
  eliminarPlanEstudio,
  inicializarModalEditarPlanInfo,
  inicializarModalGestionPlanes,
  renderizarListaGestionPlanes,
  renderizarModoHardcore,
  renderizarSelectorPlan,
};
