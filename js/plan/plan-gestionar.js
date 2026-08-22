/* =========================================================================
   PLAN DE ESTUDIOS — GESTIONAR PLANES
   Selector de plan activo, Modo Hardcore, y el modal de gestión
   (reordenar, eliminar, favorito).
   ========================================================================= */

import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { LIMITE_PLANES_ESTUDIO } from "./plan-esquema.js";
import { exportarPlanACSV, renderizarPlanEstudios } from "./plan-vista-lista.js";

/* --------------------------- Modo Hardcore: acompañantes automáticos --------------------------- */

/** REDISEÑO (reporte de usuario): con Modo Hardcore encendido, el usuario
 *  NO elige a mano cuál es el plan secundario/terciario. Se asume que
 *  TODOS los planes que no son el principal (★, plan_activo_id) participan
 *  automáticamente — en el orden en que aparecen en Gestionar Planes.
 *
 *  Esto reemplaza la selección manual por pill que existía antes, la cual
 *  tenía dos bugs reales:
 *  1) Una vez presionada una pill de plan secundario, no había forma de
 *     "despresionarla" (no existía handler para desmarcar).
 *  2) Reordenar los planes (drag-and-drop) no actualizaba quién era el
 *     secundario — quedaba pegado al que se había presionado a mano,
 *     aunque ya no tuviera sentido con el nuevo orden.
 *
 *  recalcularPlanesHardcore() es ahora el ÚNICO lugar que escribe
 *  plan_activo_secundario_id / plan_activo_terciario_id. Se llama cada vez
 *  que algo pudo cambiar quiénes son "los demás planes": prender/apagar
 *  Hardcore, cambiar el plan principal, reordenar, o borrar un plan — y
 *  también, de forma defensiva, al abrir el modal de Gestionar Planes, para
 *  auto-corregir datos viejos (ej. un plan_activo_secundario_id en null de
 *  antes de este cambio, o traído así por una fusión de sync vieja).
 */
function recalcularPlanesHardcore(cfg) {
  if (!cfg.modo_hardcore) {
    cfg.plan_activo_secundario_id = null;
    cfg.plan_activo_terciario_id = null;
    return;
  }
  const acompanantes = estado.datos.planes_estudio
    .filter((p) => p.id !== cfg.plan_activo_id)
    .map((p) => p.id);
  cfg.plan_activo_secundario_id = acompanantes[0] || null;
  cfg.plan_activo_terciario_id = acompanantes[1] || null;
}

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
    btn.textContent = `${plan.universidad.siglas} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      const cfg = estado.datos.configuracion;
      cfg.plan_activo_id = plan.id;
      // Cambiar el principal también recalcula automáticamente los
      // acompañantes (ver recalcularPlanesHardcore arriba).
      recalcularPlanesHardcore(cfg);
      // FIX sync: configuracion se funde entera por _actualizadoEn
      // (fusionarBloqueUnico) — sin sellar, el campo se quedaba en 0 y
      // cada sondeo de ~9s decidía el ganador por _dispositivoId, no por
      // quién editó de verdad más reciente. Ver storage-merge.js.
      sellarTimestamp(cfg);
      marcarCambioPendiente();
      renderizarSelectorPlan();
      // Si el modal de Gestionar Planes está abierto, su info de Modo
      // Hardcore también debe reflejar el acompañante recién recalculado.
      if (typeof renderizarModoHardcore === "function") renderizarModoHardcore();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}

/* --------------------------- Modo Hardcore 💀 --------------------------- */

function renderizarModoHardcore() {
  // FIX sync (bug real de raíz — reporte de usuario "elegí el plan
  // secundario y quedó en null"): esta función NUNCA cachea `cfg` en una
  // variable de módulo — cada handler lee estado.datos.configuracion
  // FRESCO en el momento del evento, porque storage-sync.js puede
  // reemplazar estado.datos entero en cualquier sondeo (~9s) y una
  // referencia vieja capturada de antemano queda desconectada en silencio.
  const cfg = estado.datos.configuracion;
  const chk = document.getElementById("switch-modo-hardcore");
  const bloque = document.getElementById("bloque-plan-secundario");

  chk.checked = !!cfg.modo_hardcore;
  bloque.classList.toggle("oculto", !cfg.modo_hardcore);

  chk.onchange = () => {
    const cfgActual = estado.datos.configuracion;
    cfgActual.modo_hardcore = chk.checked;
    // REDISEÑO: ya no hay nada que elegir a mano — prender/apagar Hardcore
    // recalcula solo quiénes son los acompañantes (ver
    // recalcularPlanesHardcore arriba).
    recalcularPlanesHardcore(cfgActual);
    bloque.classList.toggle("oculto", !cfgActual.modo_hardcore);
    sellarTimestamp(cfgActual);
    marcarCambioPendiente();
    renderizarModoHardcore(); // repinta el texto informativo de acompañantes
    if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
  };

  // REDISEÑO: ya no es un selector interactivo — es un texto informativo.
  // Con Hardcore encendido, TODOS los planes que no son el ★ principal
  // participan automáticamente (recalcularPlanesHardcore ya los asignó).
  const cont = document.getElementById("selector-plan-secundario");
  cont.innerHTML = "";
  if (!cfg.modo_hardcore) return;

  const acompanantes = estado.datos.planes_estudio.filter((p) => p.id !== cfg.plan_activo_id);

  if (acompanantes.length === 0) {
    cont.innerHTML = `<p class="muted">Necesitas al menos un segundo Plan de Estudios importado para usar el Modo Hardcore.</p>`;
    return;
  }

  const info = document.createElement("p");
  info.className = "muted";
  info.textContent =
    "También se combinan: " +
    acompanantes.map((p) => `${p.universidad.siglas} · ${p.nombre_carrera}`).join(", ");
  cont.appendChild(info);
}
estado.planGestionImportandoId = null;     // qué fila del panel de gestión tiene el mini-import abierto
estado.reabrirGestionPlanesTrasCrear = false;
estado.arrastrandoPlanId = null;          // v5 1.4: drag-and-drop en Gestionar plan

/* ===================== B.4 — Gestión de Planes de Estudio (máximo 3) ===================== */

function abrirModalGestionPlanes() {
  // Auto-corrección de datos viejos: si quedó un plan_activo_secundario_id
  // en null (de antes de este rediseño, o por una fusión de sync vieja),
  // se recalcula automáticamente cada vez que se abre este modal, sin que
  // el usuario tenga que hacer nada.
  const cfg = estado.datos.configuracion;
  const antes = `${cfg.plan_activo_secundario_id}|${cfg.plan_activo_terciario_id}`;
  recalcularPlanesHardcore(cfg);
  if (`${cfg.plan_activo_secundario_id}|${cfg.plan_activo_terciario_id}` !== antes) {
    sellarTimestamp(cfg);
    marcarCambioPendiente();
  }
  renderizarListaGestionPlanes();
  renderizarModoHardcore();
  document.getElementById("modal-gestion-planes").classList.remove("oculto");
}

/** v5 1.4: tarjetas arrastrables para reordenar los planes — la primera del
 *  orden es automáticamente la favorita/principal (estrella a la derecha,
 *  sin botón de estrella aparte).
 *
 *  FIX (reporte de usuario — "arrastro para poner un plan como principal y
 *  solo cambia visualmente, abajo sigue el secundario de antes"): antes
 *  reordenar la lista NUNCA tocaba `plan_activo_id` — la estrella se movía
 *  pero el carrusel del encabezado / Modo Hardcore seguían leyendo el
 *  `plan_activo_id` viejo, así que en la práctica "hacerlo principal"
 *  arrastrando no hacía nada funcional, solo visual. Ahora la posición 0
 *  y `plan_activo_id` son la misma fuente de verdad: al soltar, si el plan
 *  que queda primero no es ya el activo, se actualiza `plan_activo_id` y se
 *  sella `configuracion` (mismo patrón que el resto de este archivo). */

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
      `${plan.universidad.siglas} · ${aplicarFormatoTexto(plan.nombre_carrera)}` +
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

      // La posición 0 manda sobre plan_activo_id (el ★). Y con Modo
      // Hardcore encendido, el resto del orden manda sobre quién es
      // secundario/terciario — SIEMPRE se recalcula en cada reorden, no
      // solo cuando cambia el principal. Este era justo el bug reportado:
      // "por más que cambiaba el orden de los planes, el que había
      // presionado se quedaba como secundario" — porque antes la elección
      // era manual y el reorden no la tocaba. Ahora no hay elección manual;
      // el orden ES la fuente de verdad.
      const cfg = estado.datos.configuracion;
      const nuevoPrincipal = estado.datos.planes_estudio[0];
      if (nuevoPrincipal) cfg.plan_activo_id = nuevoPrincipal.id;
      recalcularPlanesHardcore(cfg);
      sellarTimestamp(cfg);

      marcarCambioPendiente();
      renderizarListaGestionPlanes();
      renderizarSelectorPlan();
      renderizarModoHardcore();
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
  // FIX crítico (v1.17 — borrados que "resucitaban" al fundir con otro
  // dispositivo, en bucle infinito): antes esta función solo quitaba el
  // plan del arreglo local. fusionarDatos() (storage-merge.js) NUNCA se
  // enteraba de que hubo un borrado — para la fusión, un plan que "ya no
  // está" es indistinguible de uno que nunca cambió, así que la regla "lo
  // que existe en un lado se conserva" lo traía de vuelta desde Drive (o
  // desde el otro dispositivo) en cuanto llegaba su copia vieja. Ahora se
  // registra la tumba ANTES de marcar el cambio pendiente, igual que ya
  // hacen semestres/profesores/agenda/enlaces.
  estado.datos._eliminados_planes = estado.datos._eliminados_planes || [];
  estado.datos._eliminados_planes.push({ id: planId, eliminadoEn: Date.now() });
  if (cfg.plan_activo_id === planId) {
    cfg.plan_activo_id = estado.datos.planes_estudio[0] ? estado.datos.planes_estudio[0].id : null;
  }
  // Borrar un plan también puede cambiar automáticamente quién es el
  // secundario/terciario (ver recalcularPlanesHardcore arriba).
  recalcularPlanesHardcore(cfg);
  sellarTimestamp(cfg);
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
  // Universidad — separación nombre_completo/siglas (2026-08-22): 2 campos
  // independientes en vez del input único de antes.
  document.getElementById("input-editar-plan-universidad-nombre").value = plan.universidad.nombre_completo || "";
  document.getElementById("input-editar-plan-universidad-siglas").value = plan.universidad.siglas || "";
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
    // Universidad — separación nombre_completo/siglas (2026-08-22): 2
    // campos independientes, ambos obligatorios (mismo criterio que el
    // modal bloqueante de completar universidades y que "Nuevo Plan").
    const universidadNombre = document.getElementById("input-editar-plan-universidad-nombre").value.trim();
    const universidadSiglas = document.getElementById("input-editar-plan-universidad-siglas").value.trim();
    const codigoPlan = document.getElementById("input-editar-plan-codigo").value.trim();
    const tipoTitulo = document.getElementById("input-editar-plan-tipo-titulo").value.trim();
    const nombreBloque = document.getElementById("input-editar-plan-nombre-bloque").value.trim();
    const semanas = Number(document.getElementById("input-editar-plan-semanas").value);
    const horaInicio = document.getElementById("input-editar-plan-hora-inicio").value;
    const duracion = Number(document.getElementById("input-editar-plan-duracion").value);

    if (!nombreCarrera || !universidadNombre || !universidadSiglas) {
      error.textContent = "El nombre de la carrera, el nombre de la universidad y sus siglas son obligatorios.";
      error.classList.remove("oculto");
      return;
    }
    if (!nombreBloque || !semanas || !horaInicio || !duracion) {
      error.textContent = "Nombre de bloque, semanas, hora de inicio y duración son obligatorios.";
      error.classList.remove("oculto");
      return;
    }

    plan.nombre_carrera = nombreCarrera;
    plan.universidad = { nombre_completo: universidadNombre, siglas: universidadSiglas };
    plan.codigo_plan = codigoPlan || null;
    plan.tipo_titulo = tipoTitulo || null;
    plan.parametros_universidad.nombre_bloque = nombreBloque;
    plan.parametros_universidad.semanas_por_bloque = semanas;
    plan.parametros_universidad.horario_inicio_default = horaInicio;
    plan.parametros_universidad.horario_duracion_bloque_min = duracion;

    // FIX sync (hallazgo aparte, misma clase de bug): esta edición toca
    // el objeto `plan`, no `configuracion` — fusionarPlan también decide
    // por _actualizadoEn (storage-merge.js), así que necesita su propio
    // sello, igual que ya se hace para materias/semestres/criterios.
    sellarTimestamp(plan);
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
  recalcularPlanesHardcore,
  renderizarListaGestionPlanes,
  renderizarModoHardcore,
  renderizarSelectorPlan,
};
