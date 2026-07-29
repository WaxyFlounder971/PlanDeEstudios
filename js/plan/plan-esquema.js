/* =========================================================================
   PLAN DE ESTUDIOS — ESQUEMA
   Crear/gestionar la estructura de un Plan de Estudios (universidad,
   tipos_horas), añadir materias manualmente, y los getters básicos de
   acceso a los planes/materias visibles.
   ========================================================================= */

import { PARAMETROS_UNIVERSIDAD_DEFAULT, crearMateria, crearPlanEstudio } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirModalGestionPlanes, renderizarModoHardcore, renderizarSelectorPlan } from "./plan-gestionar.js";
import { derivarTiposHorasDeHorasColumnas, importarCSVEnPlan, materiaPareceOptativa, obtenerPalabraOptativa, parsearRequisitoArbol, serializarRequisitoArbol } from "./plan-importacion-csv.js";
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

/**
 * v1.12.15: equivalente a obtenerOptativasDisponibles() pero para el bloque
 * especial "Revisar" — materias que el import no pudo ubicar en un bloque
 * numérico claro y que tampoco parecen optativa/electiva (viven en
 * plan.materias_revisar, nunca en plan.materias, así nunca cuentan en
 * ningún total mientras estén aquí). La consume el bloque especial
 * "Revisar" en plan-vista-lista-tarjetas.js.
 */

function obtenerMateriasRevisar() {
  const principal = obtenerPlanActivo();
  const secundario = obtenerPlanSecundario();
  const filas = [];
  if (principal) (principal.materias_revisar || []).forEach((m) => filas.push({ materia: m, plan: principal, origen: "principal" }));
  if (secundario) (secundario.materias_revisar || []).forEach((m) => filas.push({ materia: m, plan: secundario, origen: "secundario" }));
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

  // v1.12: se guarda el HORAS_COLUMNAS crudo detectado por la IA (si vino)
  // para que btn-confirmar-crear-plan lo use al armar tipos_horas — ya no
  // se le pregunta al usuario por adelantado (ver PARTE B/C).
  estado.horasColumnasDetectadasPlan = metadatos.horas_columnas || null;
  // v1.12.5: mismo patrón para TIPO_TITULO — se guarda tal cual lo detectó
  // la IA para que btn-confirmar-crear-plan lo persista en el plan (antes
  // se leía y se descartaba, sin quedar disponible para la exportación CSV).
  estado.tipoTituloDetectadoPlan = metadatos.tipo_titulo || null;

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

  // v1.12: el bloque "Tipos de horas personalizados"/"No aplica" del modal
  // ya no existe en index.html (se eliminó junto con este selector manual).

  const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
  const inputUniOtraNombre = document.getElementById("input-universidad-otra-nombre");
  inputUniOtraNombre.value = estado.nombreUniversidadImportacion || "";
  if (btnInicial.dataset.valor === "Otra") {
    bloqueUniOtraNombre.classList.remove("oculto");
    // v7.1: si vino detectada por la IA (metadatos.universidad) y no coincidió
    // con TEC/UCR, se precarga como valor real editable (nunca genérico).
    if (metadatos.universidad && !["TEC", "UCR"].includes(mapearUniversidadDetectada(metadatos.universidad))) {
      inputUniOtraNombre.value = metadatos.universidad;
    }
  } else {
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

/* v1.12: leerTiposHorasDelModalCrearPlan() fue eliminada — tipos_horas ya
 * no se lee de un selector manual (TEC/UCR/Otra + "No aplica"), se deriva de
 * estado.horasColumnasDetectadasPlan (ver abrirModalCrearPlan más arriba y
 * el handler de btn-confirmar-crear-plan más abajo). */

function inicializarModalCrearPlan() {
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      aplicarPlaceholdersAleatoriosPlan(btn.dataset.valor);
      const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
      if (btn.dataset.valor === "TEC" || btn.dataset.valor === "UCR") {
        bloqueUniOtraNombre.classList.add("oculto");
        aplicarDefaultsUniversidad(btn.dataset.valor);
      } else {
        bloqueUniOtraNombre.classList.remove("oculto");
      }
    });
  });

  document.getElementById("btn-cancelar-crear-plan").addEventListener("click", () => {
    estado.csvPendienteDeImportar = null;
    estado.horasColumnasDetectadasPlan = null;
    estado.tipoTituloDetectadoPlan = null;
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
    // v1.12: tipos_horas ya no se lee de un selector manual — se deriva de
    // lo que la IA haya detectado en HORAS_COLUMNAS (guardado en
    // abrirModalCrearPlan). Si no hay nada detectado (ej. "+ Nuevo Plan" sin
    // pasar por un import), se usa ["Horas"] como default genérico editable
    // más adelante, en vez de asumir "no aplica" sin que el usuario lo pidiera.
    const tiposHoras = estado.horasColumnasDetectadasPlan
      ? derivarTiposHorasDeHorasColumnas(estado.horasColumnasDetectadasPlan)
      : ["Horas"];
    const codigoPlan = document.getElementById("input-plan-codigo").value.trim();

    const nuevoPlan = crearPlanEstudio({
      nombre_carrera: nombreCarrera,
      universidad,
      codigo_plan: codigoPlan,
      tipo_titulo: estado.tipoTituloDetectadoPlan,
      parametros_universidad: {
        nombre_bloque: document.getElementById("input-plan-nombre-bloque").value.trim() || "Semestre",
        semanas_por_bloque: Number(document.getElementById("input-plan-semanas").value) || 16,
        horario_inicio_default: document.getElementById("input-plan-hora-inicio").value || "07:30",
        horario_duracion_bloque_min: Number(document.getElementById("input-plan-duracion").value) || 50,
        tipos_horas: tiposHoras,
      },
    });

    estado.horasColumnasDetectadasPlan = null;
    estado.tipoTituloDetectadoPlan = null;
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
      estado.horasColumnasDetectadasPlan = null;
      estado.tipoTituloDetectadoPlan = null;
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
    document.getElementById("input-materia-requisitos").value = serializarRequisitoArbol(materiaExistente.requisitos);
    document.getElementById("input-materia-correquisitos").value = serializarRequisitoArbol(materiaExistente.correquisitos);
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
    const requisitos = parsearRequisitoArbol(document.getElementById("input-materia-requisitos").value);
    const correquisitos = parsearRequisitoArbol(document.getElementById("input-materia-correquisitos").value);

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

/* ===================== v1.12.15 — Agregar al plan de estudios =====================
 * Antes (v1.12.5), presionar "Añadir al plan" sobre una materia de "Optativas"
 * abría un modal con 3 formas (reemplazar cupo / bloque aparte / bloque
 * específico). v1.12.15 lo simplifica a 2 opciones, siempre visibles a la vez
 * (sin selector de modo previo), y lo reutiliza tal cual desde los DOS
 * bloques especiales — "Optativas" y "Revisar" — con el mismo botón único
 * "Agregar al plan de estudios" (ver plan-vista-lista-tarjetas.js):
 *   1. "Agregar a bloque"            — el usuario elige a mano a cuál bloque
 *                                       numerado ya existente pertenece;
 *                                       queda pendiente, como cualquier otra
 *                                       materia formal de ese bloque.
 *   2. "Reemplazar por otra materia" — reemplaza un espacio de electiva/
 *                                       optativa que ya existe dentro de un
 *                                       bloque numerado del plan (ver
 *                                       obtenerCuposOptativaEnPlan /
 *                                       materiaPareceOptativa), con
 *                                       confirmación explícita.
 * En ambos casos, la materia sale de su arreglo especial de origen
 * (`optativas_disponibles` o `materias_revisar`, según `origen` — ver
 * abrirModalVincularOptativa) al vincularse, y ya no vuelve a él. */

estado.vincularOptativaContexto = null; // { materiaTemplate, plan, origen } mientras el modal está abierto — origen: "optativa" | "revisar"

/** Cupos = materias que YA están dentro de un bloque numerado del plan
 *  (nunca en optativas_disponibles) marcadas como sin_definir=true — un
 *  espacio reservado de electiva/optativa sin materia real elegida todavía
 *  (ver materiaPareceOptativa, reutilizado tal cual desde
 *  plan-importacion-csv.js — nunca se detecta adivinando por el código).
 *
 * v1.12.16 (fix bug crítico): devuelve `{ materia, indice }` — `indice` es
 * la posición real dentro de `plan.materias`, la única identidad que nunca
 * se puede repetir entre dos cupos distintos. Antes se pasaba solo el
 * objeto `materia`; en la práctica, varios cupos genéricos sin definir
 * comparten el mismo nombre (y a veces hasta el mismo código, ya que
 * "código real" para un espacio sin definir suele venir vacío o repetido
 * desde el documento fuente) — al identificarlos por esos campos en vez de
 * por su posición, "Reemplazar" terminaba operando sobre el cupo
 * equivocado, o afectando a varios cupos de distintos bloques a la vez. */
function obtenerCuposOptativaEnPlan(plan) {
  const cupos = [];
  (plan.materias || []).forEach((m, indice) => {
    if (!m.es_optativa && materiaPareceOptativa(m)) cupos.push({ materia: m, indice });
  });
  return cupos;
}

/** Bloques numéricos que ya existen en el plan (materias formales; nunca las
 *  optativas "aparte", que no tienen Bloque numérico), ordenados. */
function obtenerBloquesEnPlan(plan) {
  const claves = new Set();
  (plan.materias || []).forEach((m) => {
    if (!m.es_optativa && m.bloque !== null && m.bloque !== undefined && m.bloque !== "") claves.add(m.bloque);
  });
  return Array.from(claves).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(a).localeCompare(String(b));
  });
}

/**
 * `origen` indica de cuál arreglo especial viene la materia — "optativa"
 * (plan.optativas_disponibles, bloque "Optativas") o "revisar"
 * (plan.materias_revisar, bloque "Revisar") — así, al vincularla, se quita
 * del arreglo correcto (ver quitarDeOrigenEspecialOptativa más abajo).
 */
function abrirModalVincularOptativa(materiaTemplate, plan, origen = "optativa") {
  estado.vincularOptativaContexto = { materiaTemplate, plan, origen };

  document.getElementById("nombre-vincular-optativa").textContent = materiaTemplate.nombre;
  document.getElementById("error-vincular-optativa").classList.add("oculto");
  // v1.16 (fix bug de distinción Optativas/Revisar): el texto ya no es
  // idéntico para los dos orígenes — "optativa" deja claro que es una
  // elección voluntaria, "revisar" deja claro que la materia ya es parte
  // confirmada del plan y solo falta decidir su ubicación.
  document.getElementById("explicacion-vincular-optativa").textContent =
    origen === "revisar"
      ? "Esta materia ya es parte confirmada de tu plan — el import no pudo determinar en qué bloque va. Elige una de estas dos formas de ubicarla."
      : "Esta es una materia opcional. Si vas a cursarla, elige una de estas dos formas de sumarla a tu plan de estudios.";

  // v1.12.15: el selector de modo (3 pills) del diseño anterior ya no se usa
  // — las 2 opciones se muestran siempre juntas dentro del modal (ver
  // renderizarContenidoVincularOptativa). Se oculta por si el HTML todavía
  // lo trae, sin depender de tocar index.html para este cambio.
  const pillModo = document.getElementById("pill-vincular-optativa-modo");
  if (pillModo) pillModo.classList.add("oculto");

  renderizarContenidoVincularOptativa();
  document.getElementById("modal-vincular-optativa").classList.remove("oculto");
}

function cerrarModalVincularOptativa() {
  estado.vincularOptativaContexto = null;
  document.getElementById("modal-vincular-optativa").classList.add("oculto");
}

/** Quita `materiaTemplate` del arreglo especial del que vino (según
 *  ctx.origen), para que deje de aparecer ahí una vez vinculada.
 *
 * v1.16 (fix bug crítico): antes filtraba por `m.codigo !== materiaTemplate.codigo`
 * — como ahora el import SÍ deja convivir varias optativas/revisar con el
 * mismo código (ver fix de importarCSVEnPlan en plan-importacion-csv.js, que
 * ya no las fusiona), filtrar por código borraba TODAS las que compartieran
 * ese código de un solo golpe al vincular solo una. `materiaTemplate` es
 * siempre el objeto real dentro del arreglo (viene de
 * obtenerOptativasDisponibles/obtenerMateriasRevisar), así que comparar por
 * referencia identifica exactamente esa fila y ninguna otra. */
function quitarDeOrigenEspecialOptativa(plan, materiaTemplate, origen) {
  if (origen === "revisar") {
    plan.materias_revisar = (plan.materias_revisar || []).filter((m) => m !== materiaTemplate);
  } else {
    plan.optativas_disponibles = (plan.optativas_disponibles || []).filter((m) => m !== materiaTemplate);
  }
}

function renderizarContenidoVincularOptativa() {
  const ctx = estado.vincularOptativaContexto;
  if (!ctx) return;
  const { materiaTemplate, plan } = ctx;

  const cont = document.getElementById("contenido-vincular-optativa");
  cont.innerHTML = "";

  // ---- Opción 1: Agregar a bloque ----
  const seccionBloque = document.createElement("div");
  seccionBloque.className = "stack";
  seccionBloque.innerHTML = `<p style="margin:0;"><strong>1. Agregar a bloque</strong></p><p class="muted" style="margin-top:2px;">Elige a cuál ${plan.parametros_universidad.nombre_bloque.toLowerCase()} numerado pertenece — quedará como una materia pendiente más de ese bloque.</p>`;

  const bloques = obtenerBloquesEnPlan(plan);
  if (bloques.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Este plan todavía no tiene bloques numerados con materias.";
    seccionBloque.appendChild(p);
  } else {
    // v1.12.16 (Ajuste 1): antes era un pill-group horizontal que truncaba
    // cada opción a "C." y no dejaba distinguir un bloque de otro — se
    // reemplaza por un <select> normal, que siempre muestra el nombre
    // completo de cada bloque y escala bien aunque haya muchos.
    const selectBloque = document.createElement("select");
    selectBloque.className = "form-select";
    // v1.16.1 (fix bug crítico de contraste, sigue): `color-scheme` por sí
    // solo no bastó — varios navegadores solo respetan esa propiedad para
    // dibujar el popup nativo en oscuro si además el <select>/<option> no
    // tiene ya un fondo/texto propio "claro" heredado del CSS de la app
    // (`.form-select` probablemente define background/color pensados para el
    // combo CERRADO, y ese mismo estilo se filtra al popup, pisando lo que
    // `color-scheme` intentaba corregir). Se fuerzan colores explícitos e
    // inline (máxima prioridad, sin depender de variables CSS que no tengo a
    // la vista) tanto en el <select> como en CADA <option> — el navegador
    // solo respeta el fondo/texto de un <option> si viene puesto en el
    // propio <option>, no alcanza con ponerlo únicamente en el <select>.
    const esModoClaro = estado.datos.configuracion.modo === "light";
    const colorSchemeActual = esModoClaro ? "light" : "dark";
    const fondoSelect = esModoClaro ? "#ffffff" : "#1e1e2a";
    const textoSelect = esModoClaro ? "#1a1a1a" : "#f2f2f5";
    selectBloque.style.colorScheme = colorSchemeActual;
    selectBloque.style.backgroundColor = fondoSelect;
    selectBloque.style.color = textoSelect;

    const aplicarColoresOption = (opt) => {
      opt.style.backgroundColor = fondoSelect;
      opt.style.color = textoSelect;
    };

    const optPlaceholder = document.createElement("option");
    optPlaceholder.value = "";
    optPlaceholder.textContent = "Selecciona un bloque…";
    optPlaceholder.disabled = true;
    optPlaceholder.selected = true;
    aplicarColoresOption(optPlaceholder);
    selectBloque.appendChild(optPlaceholder);

    bloques.forEach((bloque) => {
      const opt = document.createElement("option");
      opt.value = String(bloque);
      opt.textContent = `${plan.parametros_universidad.nombre_bloque} ${bloque}`;
      aplicarColoresOption(opt);
      selectBloque.appendChild(opt);
    });

    selectBloque.addEventListener("change", () => {
      if (!selectBloque.value) return;
      // los bloques pueden ser numéricos o texto — se recupera el valor
      // original (no el string del <option>) para no perder su tipo.
      const bloqueElegido = bloques.find((b) => String(b) === selectBloque.value);
      asignarOptativaABloqueEspecifico(materiaTemplate, plan, bloqueElegido);
    });

    seccionBloque.appendChild(selectBloque);
  }
  cont.appendChild(seccionBloque);

  const separador = document.createElement("hr");
  separador.style.cssText = "opacity:0.15; margin:16px 0; border:none; border-top:1px solid currentColor;";
  cont.appendChild(separador);

  // ---- Opción 2: Reemplazar por otra materia ----
  const seccionCupo = document.createElement("div");
  seccionCupo.className = "stack";
  seccionCupo.innerHTML = `<p style="margin:0;"><strong>2. Reemplazar por otra materia</strong></p><p class="muted" style="margin-top:2px;">Ocupa el lugar de un espacio de electiva/optativa genérico que ya existe dentro de un bloque del plan.</p>`;

  const cupos = obtenerCuposOptativaEnPlan(plan);
  if (cupos.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Este plan no tiene espacios de electiva/optativa pendientes dentro de sus bloques.";
    seccionCupo.appendChild(p);
  } else {
    cupos.forEach((cupoRef) => {
      const { materia: cupoMateria, indice } = cupoRef;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary btn-block";
      btn.style.textAlign = "left";
      btn.textContent = `${plan.parametros_universidad.nombre_bloque} ${cupoMateria.bloque} — reemplazar ${obtenerPalabraOptativa(cupoMateria)}: "${cupoMateria.nombre}"`;
      btn.addEventListener("click", () => {
        const confirmado = window.confirm(
          `¿Quieres poner "${materiaTemplate.nombre}" dentro del plan, reemplazando a "${cupoMateria.nombre}" del ${plan.parametros_universidad.nombre_bloque.toLowerCase()} ${cupoMateria.bloque}?`
        );
        // v1.12.16: se identifica al cupo por su índice real dentro de
        // plan.materias (indice), nunca por nombre/código — así, si hay
        // varios cupos con el mismo nombre genérico en distintos bloques
        // (ej. "Repertorio" en el Bloque 8, 9 y 10), reemplazar uno nunca
        // toca a los otros.
        if (confirmado) reemplazarCupoOptativa(materiaTemplate, plan, indice);
      });
      seccionCupo.appendChild(btn);
    });
  }
  cont.appendChild(seccionCupo);
}

/**
 * Opción 2 ("Reemplazar por otra materia"): la entrada genérica del cupo (ej. OPT-B7/ELEC-B9) se
 * sustituye por los datos reales de la materia elegida (código, nombre,
 * créditos, horas, requisitos, correquisitos), pero conserva el `bloque` del
 * cupo que reemplazó, además de su `categoria_id` y `estado` ya asignados —
 * nunca se pierde su posición. El objeto `cupo` se muta in-place: nunca se
 * agrega una fila nueva a plan.materias para esto (y la fila vieja no queda
 * duplicada).
 *
 * v1.12.16: `indiceCupo` es la posición del cupo dentro de `plan.materias`
 * (ver obtenerCuposOptativaEnPlan) — se resuelve el objeto real en ese
 * índice al momento del clic, nunca por nombre/código, así reemplazar un
 * cupo nunca afecta a otro cupo con el mismo nombre genérico en otro bloque.
 */
function reemplazarCupoOptativa(materiaTemplate, plan, indiceCupo) {
  const ctx = estado.vincularOptativaContexto;
  const cupo = (plan.materias || [])[indiceCupo];
  if (!cupo) return; // seguridad: el índice ya no corresponde a nada (no debería pasar)
  const codigoAnterior = cupo.codigo;
  quitarDeOrigenEspecialOptativa(plan, materiaTemplate, ctx ? ctx.origen : "optativa");

  // Ajuste 2 (v1.12.16): antes de perder el nombre genérico del cupo, se
  // guarda — se muestra luego en la tarjeta de la materia real, debajo de
  // Requisitos (ver construirBloqueCompletoRequisitos en plan-detalle.js).
  cupo.cupo_generico_original = cupo.nombre;

  cupo.codigo = materiaTemplate.codigo;
  cupo.id = materiaTemplate.codigo;
  cupo.nombre = materiaTemplate.nombre;
  cupo.creditos = materiaTemplate.creditos;
  cupo.horas = { ...(materiaTemplate.horas || {}) };
  cupo.requisitos = materiaTemplate.requisitos || null;
  cupo.correquisitos = materiaTemplate.correquisitos || null;
  cupo.sin_definir = false; // v1.14.1: ya se llenó con una materia real, deja de ser un espacio reservado.
  // cupo.bloque, cupo.categoria_id y cupo.estado se conservan sin tocar a propósito.

  if (codigoAnterior !== cupo.codigo) estado.materiasExpandidas.delete(codigoAnterior);

  marcarCambioPendiente();
  cerrarModalVincularOptativa();
  renderizarPlanEstudios();
}

/** Opción 1 ("Agregar a bloque"): se asigna manualmente a un bloque numérico
 *  ya existente del plan — se agrega como una materia formal más de ese
 *  bloque (no queda marcada es_optativa, igual que si reemplazara un cupo;
 *  estado inicial "pendiente", ya el default de crearMateria). */
function asignarOptativaABloqueEspecifico(materiaTemplate, plan, bloque) {
  const ctx = estado.vincularOptativaContexto;
  quitarDeOrigenEspecialOptativa(plan, materiaTemplate, ctx ? ctx.origen : "optativa");
  materiaTemplate.es_optativa = false;
  materiaTemplate.bloque = bloque;
  plan.materias.push(materiaTemplate);
  marcarCambioPendiente();
  cerrarModalVincularOptativa();
  renderizarPlanEstudios();
}

function inicializarModalVincularOptativa() {
  // v1.12.15: ya no hay pills de modo que inicializar — el modal siempre
  // muestra las 2 opciones juntas (ver renderizarContenidoVincularOptativa).
  document.getElementById("btn-cancelar-vincular-optativa").addEventListener("click", cerrarModalVincularOptativa);
  document.getElementById("modal-vincular-optativa").addEventListener("click", (e) => {
    if (e.target.id === "modal-vincular-optativa") cerrarModalVincularOptativa();
  });
}

export {
  EJEMPLOS_PLACEHOLDER_PLAN,
  LIMITE_PLANES_ESTUDIO,
  abrirModalCrearPlan,
  abrirModalMateriaManual,
  abrirModalVincularOptativa,
  actualizarFormatoHorasMateriaManual,
  aplicarDefaultsUniversidad,
  aplicarPlaceholdersAleatoriosPlan,
  buscarMateriaPorCodigoEnPlanes,
  elegirPlaceholderPlan,
  filasFiltradas,
  inicializarModalCrearPlan,
  inicializarModalMateriaManual,
  inicializarModalVincularOptativa,
  mapearUniversidadDetectada,
  obtenerMateriasRevisar,
  obtenerMateriasVisibles,
  obtenerOptativasDisponibles,
  obtenerPlanActivo,
  obtenerPlanSecundario,
};
