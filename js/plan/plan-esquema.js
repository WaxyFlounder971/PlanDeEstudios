/* =========================================================================
   PLAN DE ESTUDIOS — ESQUEMA
   Crear/gestionar la estructura de un Plan de Estudios (universidad,
   tipos_horas), añadir materias manualmente, y los getters básicos de
   acceso a los planes/materias visibles.
   ========================================================================= */

import { PARAMETROS_UNIVERSIDAD_DEFAULT, PRESETS_TIPOS_HORAS, crearMateria, crearPlanEstudio } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { parsearGrupoRequisitos, serializarGrupoRequisitos } from "../core/utils.js";
import { abrirModalGestionPlanes, renderizarModoHardcore, renderizarSelectorPlan } from "./plan-gestionar.js";
import { importarCSVEnPlan } from "./plan-importacion-csv.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

/** Placeholders variados de Carrera/Código según universidad (v5 1.3). */

const EJEMPLOS_PLACEHOLDER_PLAN = {
  TEC: [
    { carrera: "Administración de Tecnologías de Información", codigo: "2053" },
    { carrera: "Ingeniería en Computadores", codigo: "2103" },
  ],
  UCR: [
    { carrera: "Ingeniería Química", codigo: "420501, plan 01" },
    { carrera: "Física", codigo: "210201, plan 03" },
    { carrera: "Enfermería", codigo: "510109" },
    { carrera: "Educación Primaria", codigo: "320242, plan 02" },
  ],
};

function elegirPlaceholderPlan(universidad) {
  const lista = EJEMPLOS_PLACEHOLDER_PLAN[universidad] || EJEMPLOS_PLACEHOLDER_PLAN.TEC;
  return lista[Math.floor(Math.random() * lista.length)];
}

const LIMITE_PLANES_ESTUDIO = 3;
estado.materiaManualPlanId = null;         // a qué plan se le está añadiendo materia manual
estado.materiaManualEditando = null;       // punto 6 (v1.9.6): { planId, codigoOriginal } si el modal está editando una materia existente, null si es "+ Añadir materia"

/* ===================== Utilidades de acceso a los planes ===================== */

function obtenerPlanActivo() {
  const cfg = estado.datos.configuracion;
  return estado.datos.planes_estudio.find((p) => p.id === cfg.plan_activo_id) || null;
}

function obtenerPlanSecundario() {
  const cfg = estado.datos.configuracion;
  if (!cfg.modo_hardcore || !cfg.plan_activo_secundario_id) return null;
  return estado.datos.planes_estudio.find((p) => p.id === cfg.plan_activo_secundario_id) || null;
}

/** Todas las materias visibles ahora mismo, con una referencia a su plan de origen. */

function obtenerMateriasVisibles() {
  const principal = obtenerPlanActivo();
  const secundario = obtenerPlanSecundario();
  const filas = [];
  if (principal) principal.materias.forEach((m) => filas.push({ materia: m, plan: principal, origen: "principal" }));
  if (secundario) secundario.materias.forEach((m) => filas.push({ materia: m, plan: secundario, origen: "secundario" }));
  return filas;
}

/**
 * C.4 (v9): equivalente a obtenerMateriasVisibles() pero para las electivas
 * detectadas al importar que todavía NO se agregaron formalmente a la malla
 * (viven en plan.optativas_disponibles, nunca en plan.materias — así nunca
 * cuentan en ningún total mientras estén aquí). La consume el bloque
 * especial "Optativas" en plan-vista-lista-tarjetas.js.
 *
 * FIX (v1.9.6): esta función faltaba por completo — se importaba desde
 * plan-vista-lista-tarjetas.js pero nunca se definió ni exportó acá, lo cual
 * es un import roto en ES modules: al no poder resolverse, el navegador
 * rechaza cargar el módulo main.js completo, así que NINGÚN JavaScript de
 * la app llegaba a ejecutarse (ni siquiera el listener del botón de login)
 * — esta era la causa raíz de "toco el botón y no pasa nada".
 */

function obtenerOptativasDisponibles() {
  const principal = obtenerPlanActivo();
  const secundario = obtenerPlanSecundario();
  const filas = [];
  if (principal) (principal.optativas_disponibles || []).forEach((m) => filas.push({ materia: m, plan: principal, origen: "principal" }));
  if (secundario) (secundario.optativas_disponibles || []).forEach((m) => filas.push({ materia: m, plan: secundario, origen: "secundario" }));
  return filas;
}

function buscarMateriaPorCodigoEnPlanes(codigo) {
  const filas = obtenerMateriasVisibles();
  const encontrada = filas.find((f) => f.materia.codigo === codigo);
  return encontrada || null;
}

/** Aplica el buscador general y el filtro de categoría a las filas visibles. */

function filasFiltradas() {
  let filas = obtenerMateriasVisibles();
  if (estado.filtroCategoriaId) {
    filas = filas.filter((f) => f.materia.categoria_id === estado.filtroCategoriaId);
  }
  const q = (estado.busquedaPlanEstudios || "").trim().toLowerCase();
  if (q) {
    filas = filas.filter(
      (f) => f.materia.nombre.toLowerCase().includes(q) || f.materia.codigo.toLowerCase().includes(q)
    );
  }
  return filas;
}

/* ===================== Modal: crear Plan de Estudios ===================== */

/** v6 #2: aplica un ejemplo al azar (de EJEMPLOS_PLACEHOLDER_PLAN, ya
 *  definido más arriba) como placeholder de Carrera/Código — nunca como
 *  valor real precargado. Antes existía elegirPlaceholderPlan() pero nunca
 *  se llamaba desde ningún lado; esto es lo que faltaba conectar. */

function aplicarPlaceholdersAleatoriosPlan(universidad) {
  const ejemplo = elegirPlaceholderPlan(universidad);
  document.getElementById("input-plan-nombre-carrera").placeholder = `Ej. ${ejemplo.carrera}`;
  document.getElementById("input-plan-codigo").placeholder = `Ej. ${ejemplo.codigo}`;
}

/** Intenta mapear el texto libre de UNIVERSIDAD: (ej. "Tecnológico de Costa
 *  Rica", "TEC", "Universidad de Costa Rica") a uno de los pills conocidos.
 *  Si no reconoce nada, cae en "Otra" (nunca revienta, nunca inventa). */

function mapearUniversidadDetectada(texto) {
  const t = (texto || "").toUpperCase();
  if (t.includes("TEC") || t.includes("TECNOLÓGICO") || t.includes("TECNOLOGICO")) return "TEC";
  if (t.includes("UCR") || t.includes("COSTA RICA")) return "UCR";
  return "Otra";
}

function abrirModalCrearPlan(paraSecundario, metadatosDetectados) {
  estado.planCrearParaSecundario = !!paraSecundario;
  const inputCarrera = document.getElementById("input-plan-nombre-carrera");
  const inputCodigo = document.getElementById("input-plan-codigo");
  inputCarrera.value = "";
  inputCodigo.value = "";
  document.getElementById("error-modal-crear-plan").classList.add("oculto");

  // v6 #3: si la IA logró identificar carrera/código/universidad, se
  // prellenan aquí como VALOR real (editable), no como placeholder.
  const metadatos = metadatosDetectados || {};
  if (metadatos.carrera) inputCarrera.value = metadatos.carrera;
  if (metadatos.codigo_plan) inputCodigo.value = metadatos.codigo_plan;

  // Se preselecciona con la universidad detectada por la IA si vino; si no,
  // con lo que el usuario ya haya elegido en el selector del panel de
  // importación (estado.universidadImportacion), así no se le vuelve a
  // preguntar dos veces lo mismo.
  const universidadInicial = metadatos.universidad
    ? mapearUniversidadDetectada(metadatos.universidad)
    : (estado.universidadImportacion || "TEC");
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  const btnInicial = pillUni.querySelector(`[data-valor="${universidadInicial}"]`) || pillUni.querySelector('[data-valor="TEC"]');
  btnInicial.classList.add("active");
  aplicarPlaceholdersAleatoriosPlan(btnInicial.dataset.valor);

  const inputPersonalizado = document.getElementById("input-tipos-horas-personalizados");
  const bloquePersonalizado = document.getElementById("bloque-tipos-horas-personalizados");
  const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
  const inputUniOtraNombre = document.getElementById("input-universidad-otra-nombre");
  const checkboxNoAplica = document.getElementById("checkbox-horas-no-aplica");
  // v7.1: continúa desde lo elegido en el panel de importación (universidad
  // libre y "No aplica"), en vez de reiniciar ambos campos siempre.
  checkboxNoAplica.checked = !!estado.horasNoAplicaImportacion;
  inputPersonalizado.disabled = checkboxNoAplica.checked;
  inputUniOtraNombre.value = estado.nombreUniversidadImportacion || "";
  if (btnInicial.dataset.valor === "Otra") {
    bloquePersonalizado.classList.remove("oculto");
    bloqueUniOtraNombre.classList.remove("oculto");
    inputPersonalizado.value = estado.tiposHorasPersonalizadoTexto || "";
    // v7.1: si vino detectada por la IA (metadatos.universidad) y no coincidió
    // con TEC/UCR, se precarga como valor real editable (nunca genérico).
    if (metadatos.universidad && !["TEC", "UCR"].includes(mapearUniversidadDetectada(metadatos.universidad))) {
      inputUniOtraNombre.value = metadatos.universidad;
    }
  } else {
    bloquePersonalizado.classList.add("oculto");
    bloqueUniOtraNombre.classList.add("oculto");
    aplicarDefaultsUniversidad(btnInicial.dataset.valor);
  }

  document.getElementById("modal-crear-plan").classList.remove("oculto");
}

function aplicarDefaultsUniversidad(universidad) {
  const defaults = PARAMETROS_UNIVERSIDAD_DEFAULT[universidad] || PARAMETROS_UNIVERSIDAD_DEFAULT.TEC;
  document.getElementById("input-plan-nombre-bloque").value = defaults.nombre_bloque;
  document.getElementById("input-plan-semanas").value = defaults.semanas_por_bloque;
  document.getElementById("input-plan-hora-inicio").value = defaults.horario_inicio_default;
  document.getElementById("input-plan-duracion").value = defaults.horario_duracion_bloque_min;
}

/** Lee la lista de tipos de horas seleccionada en el modal en este momento
 *  (según el pill de universidad activo), sin importar si es TEC/UCR/Personalizada.
 *  v7.1: el checkbox "No aplica" tiene prioridad sobre cualquier preset —
 *  el usuario puede marcar que este plan no maneja horas sin importar la
 *  universidad elegida. */

function leerTiposHorasDelModalCrearPlan() {
  if (document.getElementById("checkbox-horas-no-aplica").checked) return [];
  const universidad = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
  if (universidad === "Otra") {
    const texto = document.getElementById("input-tipos-horas-personalizados").value;
    const tipos = texto.split(",").map((t) => t.trim()).filter(Boolean);
    return tipos.length ? tipos : ["Horas"];
  }
  return (PRESETS_TIPOS_HORAS[universidad] || PRESETS_TIPOS_HORAS.TEC).slice();
}

function inicializarModalCrearPlan() {
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      aplicarPlaceholdersAleatoriosPlan(btn.dataset.valor);
      const bloquePersonalizado = document.getElementById("bloque-tipos-horas-personalizados");
      const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
      if (btn.dataset.valor === "TEC" || btn.dataset.valor === "UCR") {
        bloquePersonalizado.classList.add("oculto");
        bloqueUniOtraNombre.classList.add("oculto");
        aplicarDefaultsUniversidad(btn.dataset.valor);
      } else {
        bloquePersonalizado.classList.remove("oculto");
        bloqueUniOtraNombre.classList.remove("oculto");
      }
    });
  });

  // v7.1: marcar/desmarcar "No aplica" solo deshabilita visualmente el campo
  // de tipos de horas personalizados (si está visible) para dejar claro que
  // no se va a usar, sin perder lo que el usuario ya había escrito ahí.
  document.getElementById("checkbox-horas-no-aplica").addEventListener("change", (e) => {
    document.getElementById("input-tipos-horas-personalizados").disabled = e.target.checked;
  });

  document.getElementById("btn-cancelar-crear-plan").addEventListener("click", () => {
    estado.csvPendienteDeImportar = null;
    document.getElementById("modal-crear-plan").classList.add("oculto");
    if (estado.reabrirGestionPlanesTrasCrear) {
      estado.reabrirGestionPlanesTrasCrear = false;
      abrirModalGestionPlanes();
    }
  });

  document.getElementById("btn-confirmar-crear-plan").addEventListener("click", () => {
    const nombreCarrera = document.getElementById("input-plan-nombre-carrera").value.trim();
    if (!nombreCarrera) {
      const err = document.getElementById("error-modal-crear-plan");
      err.textContent = "El nombre de la carrera es obligatorio.";
      err.classList.remove("oculto");
      return;
    }
    if (estado.datos.planes_estudio.length >= LIMITE_PLANES_ESTUDIO) {
      const err = document.getElementById("error-modal-crear-plan");
      err.textContent = `Ya tienes el máximo de ${LIMITE_PLANES_ESTUDIO} planes.`;
      err.classList.remove("oculto");
      return;
    }
    const universidadPill = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
    // v7.1: si el pill activo es "Otra", se guarda el nombre real que el
    // usuario escribió (nunca la palabra genérica "Otra"); si lo dejó
    // vacío, se cae de vuelta a "Otra" para no guardar un campo vacío.
    const universidad = universidadPill === "Otra"
      ? (document.getElementById("input-universidad-otra-nombre").value.trim() || "Otra")
      : universidadPill;
    const tiposHoras = leerTiposHorasDelModalCrearPlan();
    if (universidadPill === "Otra") {
      // Se recuerda el texto crudo para la próxima vez que abran este modal.
      estado.tiposHorasPersonalizadoTexto = document.getElementById("input-tipos-horas-personalizados").value;
    }
    const codigoPlan = document.getElementById("input-plan-codigo").value.trim();

    const nuevoPlan = crearPlanEstudio({
      nombre_carrera: nombreCarrera,
      universidad,
      codigo_plan: codigoPlan,
      parametros_universidad: {
        nombre_bloque: document.getElementById("input-plan-nombre-bloque").value.trim() || "Semestre",
        semanas_por_bloque: Number(document.getElementById("input-plan-semanas").value) || 16,
        horario_inicio_default: document.getElementById("input-plan-hora-inicio").value || "07:30",
        horario_duracion_bloque_min: Number(document.getElementById("input-plan-duracion").value) || 50,
        tipos_horas: tiposHoras,
      },
    });

    estado.datos.planes_estudio.push(nuevoPlan);
    if (estado.planCrearParaSecundario) {
      estado.datos.configuracion.plan_activo_secundario_id = nuevoPlan.id;
    } else if (!estado.datos.configuracion.plan_activo_id) {
      estado.datos.configuracion.plan_activo_id = nuevoPlan.id;
    }

    marcarCambioPendiente();
    document.getElementById("modal-crear-plan").classList.add("oculto");

    if (estado.csvPendienteDeImportar) {
      importarCSVEnPlan(estado.csvPendienteDeImportar, nuevoPlan);
      estado.csvPendienteDeImportar = null;
    } else {
      renderizarSelectorPlan();
      renderizarModoHardcore();
      renderizarPlanEstudios();
    }

    if (estado.reabrirGestionPlanesTrasCrear) {
      estado.reabrirGestionPlanesTrasCrear = false;
      abrirModalGestionPlanes();
    }
  });

  // v11 (migración a módulos): antes suelto en el DOMContentLoaded de plan.js.
  document.getElementById("modal-crear-plan").addEventListener("click", (e) => {
    if (e.target.id === "modal-crear-plan") {
      estado.csvPendienteDeImportar = null;
      e.target.classList.add("oculto");
      if (estado.reabrirGestionPlanesTrasCrear) {
        estado.reabrirGestionPlanesTrasCrear = false;
        abrirModalGestionPlanes();
      }
    }
  });
}

/* ===================== B.5 — Añadir materia manualmente ===================== */

/**
 * Punto 6 (v1.9.6) — Modo Edición: si se pasan `materiaExistente` y
 * `planDeLaMateria`, el modal se abre en modo edición — precargado con los
 * datos de esa materia y, al guardar, actualiza la materia en vez de crear
 * una nueva (ver inicializarModalMateriaManual). Sin argumentos, funciona
 * exactamente igual que antes ("+ Añadir materia").
 */

function abrirModalMateriaManual(materiaExistente = null, planDeLaMateria = null) {
  const editando = !!(materiaExistente && planDeLaMateria);
  const principal = obtenerPlanActivo();
  if (!editando && !principal) return;

  const secundario = obtenerPlanSecundario();
  const planesDisponibles = [principal, secundario].filter(Boolean);

  estado.materiaManualEditando = editando
    ? { planId: planDeLaMateria.id, codigoOriginal: materiaExistente.codigo }
    : null;
  estado.materiaManualPlanId = editando ? planDeLaMateria.id : principal.id;

  document.getElementById("titulo-modal-materia-manual").textContent = editando ? "✏️ Editar materia" : "+ Añadir materia";
  document.getElementById("btn-guardar-materia-manual").textContent = editando ? "Guardar cambios" : "Guardar";
  // v1.12: "Borrar materia" solo tiene sentido si ya existe una materia que borrar.
  document.getElementById("btn-borrar-materia-manual").classList.toggle("oculto", !editando);

  const bloquePlan = document.getElementById("bloque-materia-manual-plan");
  const pillPlan = document.getElementById("pill-materia-manual-plan");
  pillPlan.innerHTML = "";

  // Editando: la materia ya pertenece a un plan fijo, no tiene sentido
  // ofrecer el selector de "¿a cuál plan pertenece?".
  if (!editando && planesDisponibles.length > 1) {
    bloquePlan.classList.remove("oculto");
    planesDisponibles.forEach((plan) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (plan.id === estado.materiaManualPlanId ? " active" : "");
      btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
      btn.addEventListener("click", () => {
        estado.materiaManualPlanId = plan.id;
        pillPlan.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        actualizarFormatoHorasMateriaManual();
      });
      pillPlan.appendChild(btn);
    });
  } else {
    bloquePlan.classList.add("oculto");
  }

  if (editando) {
    document.getElementById("input-materia-codigo").value = materiaExistente.codigo;
    document.getElementById("input-materia-nombre").value = materiaExistente.nombre;
    document.getElementById("input-materia-creditos").value = materiaExistente.creditos;
    document.getElementById("input-materia-bloque").value = materiaExistente.bloque;
    document.getElementById("input-materia-requisitos").value = serializarGrupoRequisitos(materiaExistente.requisitos);
    document.getElementById("input-materia-correquisitos").value = serializarGrupoRequisitos(materiaExistente.correquisitos);
  } else {
    ["input-materia-codigo", "input-materia-nombre", "input-materia-creditos", "input-materia-bloque",
     "input-materia-requisitos", "input-materia-correquisitos"
    ].forEach((id) => { document.getElementById(id).value = ""; });
  }
  document.getElementById("error-modal-materia-manual").classList.add("oculto");

  // Genera los inputs de horas según el plan correspondiente y, si se está
  // editando, los precarga con los valores ya guardados en la materia.
  actualizarFormatoHorasMateriaManual();
  if (editando) {
    const tipos = Array.isArray(planDeLaMateria.parametros_universidad.tipos_horas)
      ? planDeLaMateria.parametros_universidad.tipos_horas
      : ["Horas"];
    tipos.forEach((tipo, i) => {
      const input = document.getElementById(`input-materia-horas-${i}`);
      if (input) input.value = (materiaExistente.horas || {})[tipo] ?? "";
    });
  }

  document.getElementById("modal-materia-manual").classList.remove("oculto");
}

/**
 * Genera un <input type="number"> por cada tipo de hora definido en el plan
 * elegido (1 si es TEC, 4 si es UCR, o los que tenga una universidad
 * personalizada) — nunca asume nombres de campos fijos. Cada input queda
 * con id `input-materia-horas-<índice>` y su tipo guardado en un data-attr
 * para poder leerlo de vuelta al guardar.
 */

function actualizarFormatoHorasMateriaManual() {
  const plan = estado.datos.planes_estudio.find((p) => p.id === estado.materiaManualPlanId);
  const tipos = plan && Array.isArray(plan.parametros_universidad.tipos_horas)
    ? plan.parametros_universidad.tipos_horas
    : ["Horas"];

  const cont = document.getElementById("bloque-horas-dinamico");
  cont.innerHTML = "";
  tipos.forEach((tipo, i) => {
    const wrap = document.createElement("div");
    wrap.style.flex = "1";
    wrap.innerHTML = `<span class="form-label">${tipo}</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-input";
    input.id = `input-materia-horas-${i}`;
    input.dataset.tipoHora = tipo;
    wrap.appendChild(input);
    cont.appendChild(wrap);
  });

  document.getElementById("label-materia-bloque").textContent = plan ? plan.parametros_universidad.nombre_bloque : "Bloque";
}

function inicializarModalMateriaManual() {
  document.getElementById("btn-cancelar-materia-manual").addEventListener("click", () => {
    document.getElementById("modal-materia-manual").classList.add("oculto");
    estado.materiaManualEditando = null;
  });
  document.getElementById("modal-materia-manual").addEventListener("click", (e) => {
    if (e.target.id === "modal-materia-manual") {
      e.target.classList.add("oculto");
      estado.materiaManualEditando = null;
    }
  });

  /**
   * v1.12: "Borrar materia" — solo existe estando en modo edición
   * (estado.materiaManualEditando ya trae planId + codigoOriginal, ver
   * abrirModalMateriaManual). Pide confirmación con el `confirm()` nativo
   * del navegador antes de borrar — no usa el modal de confirmación propio
   * del sistema de diseño (`abrirConfirmacion()` de ui/componentes.js)
   * porque ese archivo no está disponible en esta sesión; si lo compartís
   * se puede cambiar por ese, para que se vea igual al resto de la app.
   * No hace falta limpiar referencias sueltas en Requisitos/Correquisitos
   * de otras materias: plan-detalle.js ya maneja con gracia un código que
   * no se encuentra ("no encontrada en ningún plan visible").
   */
  document.getElementById("btn-borrar-materia-manual").addEventListener("click", () => {
    const editando = estado.materiaManualEditando;
    if (!editando) return;
    const plan = estado.datos.planes_estudio.find((p) => p.id === editando.planId);
    const materia = plan && plan.materias.find((m) => m.codigo === editando.codigoOriginal);
    if (!plan || !materia) return;

    const confirmado = window.confirm(`¿Borrar la materia "${materia.codigo} - ${materia.nombre}"? Esta acción no se puede deshacer.`);
    if (!confirmado) return;

    plan.materias = plan.materias.filter((m) => m !== materia);
    estado.materiasExpandidas.delete(materia.codigo);
    estado.materiaManualEditando = null;
    marcarCambioPendiente();
    document.getElementById("modal-materia-manual").classList.add("oculto");
    renderizarPlanEstudios();
  });

  document.getElementById("btn-guardar-materia-manual").addEventListener("click", () => {
    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.materiaManualPlanId);
    const err = document.getElementById("error-modal-materia-manual");
    const codigo = document.getElementById("input-materia-codigo").value.trim();
    const nombre = document.getElementById("input-materia-nombre").value.trim();
    const creditos = Number(document.getElementById("input-materia-creditos").value) || 0;
    const bloque = Number(document.getElementById("input-materia-bloque").value) || 0;

    if (!plan || !codigo || !nombre) {
      err.textContent = "Código y nombre son obligatorios.";
      err.classList.remove("oculto");
      return;
    }

    const editando = estado.materiaManualEditando;
    const materiaExistente = editando ? plan.materias.find((m) => m.codigo === editando.codigoOriginal) : null;

    // Se permite guardar con el mismo código que ya tenía (editando), pero
    // no reusar el código de OTRA materia del mismo plan.
    const choqueDeCodigo = plan.materias.some((m) => m.codigo === codigo && m !== materiaExistente);
    if (choqueDeCodigo) {
      err.textContent = "Ya existe una materia con ese código en este plan.";
      err.classList.remove("oculto");
      return;
    }

    const tiposHoras = Array.isArray(plan.parametros_universidad.tipos_horas)
      ? plan.parametros_universidad.tipos_horas
      : ["Horas"];
    const horas = {};
    document.querySelectorAll("#bloque-horas-dinamico [data-tipo-hora]").forEach((input) => {
      horas[input.dataset.tipoHora] = Number(input.value) || 0;
    });
    const requisitos = parsearGrupoRequisitos(document.getElementById("input-materia-requisitos").value);
    const correquisitos = parsearGrupoRequisitos(document.getElementById("input-materia-correquisitos").value);

    if (materiaExistente) {
      // Modo edición: se actualizan los campos in-place para no perder la
      // identidad del objeto (estado, categoria_id, etc. se conservan tal cual).
      materiaExistente.codigo = codigo;
      materiaExistente.nombre = nombre;
      materiaExistente.creditos = creditos;
      materiaExistente.bloque = bloque;
      materiaExistente.horas = horas;
      materiaExistente.requisitos = requisitos;
      materiaExistente.correquisitos = correquisitos;
    } else {
      const nuevaMateria = crearMateria({
        codigo, nombre, creditos, bloque, horas, tiposHoras, requisitos, correquisitos,
      });
      plan.materias.push(nuevaMateria);
    }

    estado.materiaManualEditando = null;
    marcarCambioPendiente();
    document.getElementById("modal-materia-manual").classList.add("oculto");
    renderizarPlanEstudios();
  });
}

export {
  EJEMPLOS_PLACEHOLDER_PLAN,
  LIMITE_PLANES_ESTUDIO,
  abrirModalCrearPlan,
  abrirModalMateriaManual,
  actualizarFormatoHorasMateriaManual,
  aplicarDefaultsUniversidad,
  aplicarPlaceholdersAleatoriosPlan,
  buscarMateriaPorCodigoEnPlanes,
  elegirPlaceholderPlan,
  filasFiltradas,
  inicializarModalCrearPlan,
  inicializarModalMateriaManual,
  leerTiposHorasDelModalCrearPlan,
  mapearUniversidadDetectada,
  obtenerMateriasVisibles,
  obtenerOptativasDisponibles,
  obtenerPlanActivo,
  obtenerPlanSecundario,
};
