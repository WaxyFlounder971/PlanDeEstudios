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
  calcularNotaFinalMateria,
  crearMateriaMatriculada,
  crearSemestre,
  obtenerEscalaNotasMateria,
  obtenerEstadoEfectivoSemestre,
  obtenerPlanesActivos,
  redondearNotaFinalAlCincoMasCercano,
  sellarTimestamp,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { recalcularPlanesHardcore } from "../plan/plan-gestionar.js";
import { construirTarjetaSemestre } from "./semestres-tarjetas.js";

const MESES_SELECT = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

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

/**
 * BUG FIX (ronda actual — closure viejo, mismo patrón ya resuelto para mm en
 * semestres-tarjetas.js con buscarMmVivaPorId/buscarCriterioVivoPorId): el
 * modal de alta/edición de semestre (abrirModalAltaSemestre) captura
 * `semestreExistente` una sola vez al abrirse. Si el usuario tarda en llenar
 * el formulario (o en confirmar "Terminar semestre") y de por medio pasa un
 * sondeo remoto (~9s) que reemplaza estado.datos entero, esa referencia queda
 * huérfana y la edición se pierde en silencio. Se relee la entidad viva por
 * id justo antes de mutar — mismo patrón que ya usa
 * abrirModalResolverConflictoSemestre.
 */
function buscarSemestreVivoPorId(semestreId) {
  return (estado.datos.semestres || []).find((s) => s.id === semestreId) || null;
}

function creditosTotalesSemestre(semestre) {
  return (semestre.materias_matriculadas || []).reduce((total, mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return total + (materia ? Number(materia.creditos) || 0 : 0);
  }, 0);
}

/**
 * Botón "Terminar semestre" (decisión confirmada 2026-08-02): una materia
 * matriculada tiene notas "completas" cuando la suma de valor_total de sus
 * criterios llega a 100 Y todas sus asignaciones tienen nota cargada, O
 * cuando tiene nota_final_manual activo (el override manual ya es, por
 * definición, la nota que la persona quiere usar). Cualquier otro caso NO
 * es completo — resultado queda en null, mismo criterio ya confirmado en
 * Prompt B (nunca se adivina pasó/no-pasó con notas a medias).
 */
function notasCompletas(mm) {
  if (mm.nota_final_manual) return true;
  const criterios = mm.criterios || [];
  const sumaValorTotal = criterios.reduce((total, c) => total + (Number(c.valor_total) || 0), 0);
  if (Math.abs(sumaValorTotal - 100) > 0.001) return false;
  return criterios.every(
    (c) =>
      (c.asignaciones || []).length > 0 &&
      (c.asignaciones || []).every((a) => a.nota !== null && a.nota !== undefined)
  );
}

/**
 * D/E/F: calcula y persiste `resultado` en cada materia matriculada del
 * semestre (comparando la nota_final vigente contra nota_aprobacion del
 * plan de CADA materia, porque en Modo Hardcore dos materias del mismo
 * semestre pueden venir de planes/universidades distintas con notas de
 * aprobación distintas) y pasa el semestre a "pasado". El redondeo al 5
 * más cercano ANTES de comparar es opcional por plan (`redondeo_activo`,
 * Fase 6.2) — no toda universidad trabaja así; con el switch apagado se
 * compara la nota cruda, sin margen. Nunca toca materia.estado — eso
 * sigue siendo 100% manual/sticky desde el Plan (ver
 * ESTADOS_MATERIA_MANUALES en plan-vista-lista-tarjetas.js). Solo resella
 * la mm si el resultado realmente cambió, para no generar sincronía/
 * conflictos de la nada en materias que no se tocan en este cierre.
 */
function terminarSemestre(semestre) {
  (semestre.materias_matriculadas || []).forEach((mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);

    let nuevoResultado = null;
    if (plan && materia && notasCompletas(mm)) {
      const escala = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
      const notaFinal = mm.nota_final_manual ? mm.nota_final : calcularNotaFinalMateria(mm, escala);
      const params = plan.parametros_universidad || {};
      const notaAprobacion = Number(params.nota_aprobacion) || 70;
      const notaComparada = params.redondeo_activo === false ? notaFinal : redondearNotaFinalAlCincoMasCercano(notaFinal);
      nuevoResultado = notaComparada >= notaAprobacion ? "aprobada" : "reprobada";
    }

    if (mm.resultado !== nuevoResultado) {
      mm.resultado = nuevoResultado;
      sellarTimestamp(mm);
    }
  });

  semestre.estado_manual = "pasado";
  sellarTimestamp(semestre);
  marcarCambioPendiente();
}

/* ===================== Sincronía Matrícula ↔ Plan de Estudios ===================== */

/**
 * D/E/F (2026-08-02): esta función escribía materia.estado = "cursando" al
 * matricular — pero de paso reveló una inconsistencia real: el código de
 * acá SÍ blindaba "aprobado" (lo dejaba intacto), mientras el comentario
 * original en crearMateriaMatriculada (schema.js) describía lo contrario
 * ("repetir una Aprobada la vuelve a poner en cursando, deja de contar como
 * aprobada en los totales") — nunca pasaba en la práctica. Con
 * obtenerEstadoEfectivoMateria (schema.js) esto ya no hace falta: "cursando"
 * se deriva SIEMPRE que haya una mm real en un semestre actual, sin importar
 * qué diga materia.estado debajo — y ahora sí, de verdad, una "Aprobada" que
 * se repite se ve y se comporta como "Cursando" mientras dura, exactamente
 * como decía el comentario viejo. materia.estado queda intacto siempre
 * (sticky, 100% manual) — no hace falta ningún efecto secundario al
 * matricular ni al desmatricular.
 */

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

/**
 * REDISEÑO (reporte de usuario): combinar materias de todos los planes
 * activos — carrusel "‹ Plan de Estudios ›" en vez de una lista de pills
 * apiladas. Con Modo Hardcore encendido siempre entran TODOS los planes
 * que no son el principal (automático, ver recalcularPlanesHardcore en
 * plan-gestionar.js) — acá solo se pagina entre ellos, sean 2 o 3. Cambiar
 * de plan visible con las flechas NO borra lo ya marcado en los otros:
 * seleccionPorPlan guarda la selección de cada plan por separado, así que
 * se puede marcar materias de varios planes sin cerrar la ventana.
 */
function construirSelectorPlanesHardcore(contenedor, planesIds, onCambiarVisible) {
  contenedor.innerHTML = "";
  if (planesIds.length <= 1) return;

  let indice = planesIds.indexOf(planVisibleEnSelector);
  if (indice === -1) indice = 0;

  const fila = document.createElement("div");
  fila.className = "row-between";
  fila.style.cssText = "display:flex; align-items:center; gap:10px; width:100%;";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "carrusel-flecha";
  btnAnterior.style.cssText =
    "background:none; border:none; padding:4px 8px; font-size:1.4rem; line-height:1; cursor:pointer; color:inherit;";
  btnAnterior.textContent = "‹";
  btnAnterior.setAttribute("aria-label", "Plan de estudios anterior");

  const etiqueta = document.createElement("span");
  etiqueta.style.cssText = "flex:1; text-align:center; font-weight:600; line-height:1.3;";

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "carrusel-flecha";
  btnSiguiente.style.cssText =
    "background:none; border:none; padding:4px 8px; font-size:1.4rem; line-height:1; cursor:pointer; color:inherit;";
  btnSiguiente.textContent = "›";
  btnSiguiente.setAttribute("aria-label", "Plan de estudios siguiente");

  function pintarEtiqueta() {
    const plan = obtenerPlanPorId(planesIds[indice]);
    if (!plan) return;
    const marcadas = (seleccionPorPlan.get(planesIds[indice]) || new Set()).size;
    etiqueta.textContent =
      `${plan.universidad} · ${aplicarFormatoTexto(plan.nombre_carrera)}` + (marcadas > 0 ? ` (${marcadas})` : "");
  }

  btnAnterior.addEventListener("click", () => {
    indice = (indice - 1 + planesIds.length) % planesIds.length;
    pintarEtiqueta();
    onCambiarVisible(planesIds[indice]);
  });
  btnSiguiente.addEventListener("click", () => {
    indice = (indice + 1) % planesIds.length;
    pintarEtiqueta();
    onCambiarVisible(planesIds[indice]);
  });

  pintarEtiqueta();
  fila.appendChild(btnAnterior);
  fila.appendChild(etiqueta);
  fila.appendChild(btnSiguiente);
  contenedor.appendChild(fila);
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

/** v2.1.4: se rehace desde cero por 2 problemas visuales:
 *  (a) el pill-group no ocupaba todo el ancho -> ahora flex + cada botón
 *      con flex:1 se reparten el 100% del espacio disponible.
 *  (b) al apagar un filtro, la clase SÍ cambiaba pero nunca se volvía a
 *      pintar el botón (onCambiar solo refrescaba el checklist) -> ahora
 *      esta misma función se reinvoca sobre sí misma tras cada click, así
 *      el opacity/tachado quedan visibles de inmediato. */
function construirPillsFiltroEstado(contenedor, onCambiar) {
  contenedor.innerHTML = "";
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "6px";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.textContent = "Mostrar:";
  cont.appendChild(etiqueta);

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "display:flex; width:100%; gap:8px;";

  [
    { valor: "aprobado", texto: "Aprobados" },
    { valor: "reprobado", texto: "Reprobados" },
  ].forEach(({ valor, texto }) => {
    const oculto = estadosOcultosAltaSemestre.has(valor);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (oculto ? "" : " active");
    btn.style.cssText =
      "flex:1; white-space:nowrap; text-align:center;" +
      (oculto ? " opacity:0.45; text-decoration:line-through;" : "");
    btn.textContent = texto;
    btn.addEventListener("click", () => {
      if (estadosOcultosAltaSemestre.has(valor)) estadosOcultosAltaSemestre.delete(valor);
      else estadosOcultosAltaSemestre.add(valor);
      construirPillsFiltroEstado(contenedor, onCambiar); // repinta ESTE grupo con el nuevo estado apagado/encendido
      onCambiar(); // y refresca el checklist filtrado
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
  contenedor.appendChild(cont);
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

  // v2.1.4: buscador insensible a tildes — normaliza quitando diacríticos
  // (NFD + strip de marcas de combinación) tanto en lo que se escribe como
  // en nombre/código, así "codigo" encuentra "Código" y viceversa.
  const normalizar = (t) => (t || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

  let materias = plan.materias.filter((m) => !estadosOcultosAltaSemestre.has(m.estado) || seleccion.has(m.codigo));
  const q = normalizar(busquedaAltaSemestre.trim());
  if (q) materias = materias.filter((m) => normalizar(m.nombre).includes(q) || normalizar(m.codigo).includes(q));

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
        label.style.borderLeft = "0";
        label.innerHTML = `
          <input type="checkbox" ${seleccion.has(materia.codigo) ? "checked" : ""}>
          <span class="box" style="border-left:0;"></span>
          <span style="display:flex; align-items:center; gap:8px; flex:1; min-width:0; border-left:0;">
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
  // FIX (semanas máximas): el tope real no es el límite plano
  // LIMITE_SEMANAS_SEMESTRE (ese sigue existiendo solo para la transición
  // automática a "pasado"), sino las semanas disponibles del plan activo
  // más un margen de 2 semanas de colchón (evaluaciones tardías, prórrogas,
  // etc.). Si no hay plan (o no trae el parámetro), se cae al valor por
  // defecto de 16 + 2.
  const semanasBaseDuracion =
    (planDefault && planDefault.parametros_universidad && planDefault.parametros_universidad.semanas_por_bloque) || 16;
  const topeSemanasDuracion = semanasBaseDuracion + 2;

  const overlay = document.createElement("div");
  overlay.className = "overlay-alta-semestre";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  // Pedido explícito (2026-08-03): si no hay datos ingresados, cerrar (tocar
  // fuera o "Cancelar") debe funcionar directo, como siempre. Pero si ya se
  // escribió algo (nombre, fecha, duración, o se marcó alguna materia), hay
  // que avisar antes de perderlo — mismo patrón que crearModalDinamico:
  // tocar fuera con datos sin guardar no hace nada (se queda quieto),
  // "Cancelar" sí confirma antes de cerrar. El buscador de materias queda
  // afuera del rastreo: es un filtro de vista, no un dato que se guarde.
  let sucio = false;
  const marcarSucio = () => { sucio = true; };
  caja.addEventListener("input", (e) => {
    if (contenedorBuscador.contains(e.target)) return;
    marcarSucio();
  });
  caja.addEventListener("change", (e) => {
    if (contenedorBuscador.contains(e.target)) return;
    marcarSucio();
  });

  function cerrar() {
    if (!sucio) {
      overlay.remove();
      return;
    }
    abrirConfirmacion({
      titulo: "¿Cerrar sin guardar?",
      mensaje: `Vas a perder los datos que ingresaste para ${esEdicion ? "este semestre" : "el nuevo semestre"}.`,
      textoConfirmar: "Cerrar sin guardar",
      onConfirmar: () => overlay.remove(),
    });
  }

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
  filaFechas.style.alignItems = "flex-start";

  const bloqueFecha = document.createElement("div");
  bloqueFecha.style.flex = "1";
  bloqueFecha.innerHTML = `<span class="form-label" style="white-space:nowrap;">Fecha de inicio</span>`;

  const inputFecha = document.createElement("input");
  inputFecha.type = "date";
  inputFecha.className = "form-input";
  // FIX (bug C — "fecha vacía al editar semestre"): a diferencia de
  // inputNombre e inputDuracion (arriba), este input nunca recibía su valor
  // en modo edición, así que el modal de "Editar semestre" siempre arrancaba
  // con la fecha en blanco aunque el semestre sí la tuviera guardada.
  // fecha_inicio siempre se guarda como "YYYY-MM-DD" (venga del selector
  // normal o del modo aproximado "mes/año", que la arma como "AAAA-MM-01"
  // — ver btnGuardar más abajo), formato que <input type="date"> acepta tal
  // cual. No hay dato guardado de si el semestre se cargó en su momento con
  // el checkbox "No sé el día exacto" activo, así que al editar siempre se
  // muestra en modo fecha completa (nunca se pierde la fecha real por eso:
  // el día que se guardó, sea exacto o el "01" del modo aproximado, es el
  // que se ve y el que se vuelve a guardar si no se toca).
  inputFecha.value = esEdicion ? semestreExistente.fecha_inicio : "";

  const filaMesAnio = document.createElement("div");
  filaMesAnio.className = "row oculto";
  filaMesAnio.style.gap = "6px";

  const selectMes = document.createElement("select");
  selectMes.className = "form-input";
  MESES_SELECT.forEach((nombreMes, i) => {
    const opt = document.createElement("option");
    opt.value = String(i + 1);
    opt.textContent = nombreMes;
    selectMes.appendChild(opt);
  });

  const inputAnio = document.createElement("input");
  inputAnio.type = "number";
  inputAnio.className = "form-input";
  inputAnio.placeholder = "Año";
  inputAnio.min = "2000";
  inputAnio.max = "2100";
  inputAnio.value = String(new Date().getFullYear());

  filaMesAnio.appendChild(selectMes);
  filaMesAnio.appendChild(inputAnio);

  bloqueFecha.appendChild(inputFecha);
  bloqueFecha.appendChild(filaMesAnio);
  filaFechas.appendChild(bloqueFecha);

  const bloqueDuracion = document.createElement("div");
  bloqueDuracion.style.flex = "1";
  bloqueDuracion.innerHTML = `<span class="form-label" style="white-space:nowrap;">Duración (semanas)</span>`;
  const inputDuracion = document.createElement("input");
  inputDuracion.type = "number";
  inputDuracion.className = "form-input";
  inputDuracion.min = "1";
  inputDuracion.max = String(topeSemanasDuracion);
  inputDuracion.value = String(esEdicion ? semestreExistente.duracion_semanas : semanasBaseDuracion);
  bloqueDuracion.appendChild(inputDuracion);
  filaFechas.appendChild(bloqueDuracion);
  caja.appendChild(filaFechas);

  caja.appendChild(filaFechas);

  const chkFechaAproximada = document.createElement("label");
  chkFechaAproximada.className = "checkbox";
  chkFechaAproximada.style.cssText = "margin-top:6px; font-size:0.85rem; width:100%;";
  chkFechaAproximada.innerHTML = `
    <input type="checkbox">
    <span class="box"></span>
    <span>No sé el día exacto (solo mes y año)</span>
  `;
  chkFechaAproximada.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
    inputFecha.classList.toggle("oculto", e.target.checked);
    filaMesAnio.classList.toggle("oculto", !e.target.checked);
  });
  caja.appendChild(chkFechaAproximada);

  // Auto-corrección defensiva: si plan_activo_secundario_id/terciario_id
  // quedaron desincronizados (datos de antes del rediseño, o traídos por
  // una fusión de sync vieja), se recalculan acá también — así este modal
  // SIEMPRE toma todos los planes activos (sean 2 o 3), sin depender de
  // que el usuario haya abierto antes "Gestionar Planes".
  const cfgAntes = `${cfg.plan_activo_secundario_id}|${cfg.plan_activo_terciario_id}`;
  recalcularPlanesHardcore(cfg);
  if (`${cfg.plan_activo_secundario_id}|${cfg.plan_activo_terciario_id}` !== cfgAntes) {
    sellarTimestamp(cfg);
    marcarCambioPendiente();
  }

  const planesIds = Array.from(
    new Set([...obtenerPlanesActivos(cfg), ...(esEdicion ? semestreExistente.plan_estudio_id : [])])
  ).filter((id) => obtenerPlanPorId(id));

  const contenedorBuscador = document.createElement("div");
  const contenedorFiltroEstado = document.createElement("div");
  const contenedorSelectorPlanes = document.createElement("div");
  const contenedorChecklist = document.createElement("div");
  contenedorChecklist.className = "stack";
  caja.appendChild(contenedorBuscador);
  caja.appendChild(contenedorFiltroEstado);

  // REORDEN (pedido explícito): "Mostrar: Aprobados/Reprobados" va antes
  // del bloque de Modo Hardcore, no después.
  if (planesIds.length > 1) {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.textContent = "Modo Hardcore: puedes elegir materias de todos tus planes activos.";
    caja.appendChild(aviso);
  }
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

  // Botón "Terminar semestre" (D/E/F): solo tiene sentido en edición y
  // mientras el semestre siga "actual" — uno ya "pasado" (por fecha o a
  // mano) no necesita este botón.
  if (esEdicion && obtenerEstadoEfectivoSemestre(semestreExistente) === "actual") {
    const filaTerminar = document.createElement("div");
    filaTerminar.className = "row";
    filaTerminar.style.justifyContent = "flex-start";

    const btnTerminar = document.createElement("button");
    btnTerminar.type = "button";
    btnTerminar.className = "btn btn-secondary";
    btnTerminar.textContent = "Terminar semestre";
    btnTerminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Terminar semestre",
        mensaje:
          `Calcula Aprobada/Reprobada en cada materia con notas completas y pasa "${semestreExistente.nombre}" ` +
          "a Historial. Las materias con notas incompletas quedan sin resultado (se pueden completar y volver a " +
          "matricular más adelante). Esta acción no se puede deshacer.",
        textoConfirmar: "Terminar semestre",
        onConfirmar: () => {
          const semestreVivo = buscarSemestreVivoPorId(semestreExistente.id);
          if (!semestreVivo) {
            mostrarToast("Este semestre se eliminó desde otro dispositivo — no se pudo terminar");
            overlay.remove();
            renderizarSemestres();
            return;
          }
          terminarSemestre(semestreVivo);
          overlay.remove();
          renderizarSemestres();
        },
      });
    });
    filaTerminar.appendChild(btnTerminar);
    caja.appendChild(filaTerminar);
  }

  const filaBotones = document.createElement("div");
  filaBotones.className = "row glass-card";
  // Pedido: "Guardar" siempre visible, anclado al final de la ventana. `caja`
  // ya es el contenedor con scroll propio (max-height:85vh; overflow-y:auto,
  // ver arriba), así que position:sticky respecto a ESA caja es lo que
  // ancla esta fila al fondo mientras el resto (checklist largo de materias)
  // se desplaza por encima. bottom:-18px + márgenes horizontales negativos
  // compensan el padding:18px de la caja para que la barra llegue borde a
  // borde y quede pegada al fondo real del modal, en vez de flotar 18px por
  // encima de él con un hueco visible debajo.
  filaBotones.style.cssText =
    "justify-content:flex-end; position:sticky; bottom:-18px; margin:10px -18px -18px; " +
    "padding:12px 18px; z-index:5; border-radius:0 0 var(--radius-card, 14px) var(--radius-card, 14px);";
  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = esEdicion ? "Guardar cambios" : "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const usaFechaAproximada = !inputFecha.classList.contains("oculto") === false; // checkbox activo = fecha oculta
    const fecha = usaFechaAproximada
      ? `${inputAnio.value}-${String(selectMes.value).padStart(2, "0")}-01`
      : inputFecha.value;
    const duracion = Math.min(Number(inputDuracion.value) || 0, topeSemanasDuracion);
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

    if (esEdicion) {
      const semestreVivo = buscarSemestreVivoPorId(semestreExistente.id);
      if (!semestreVivo) {
        mostrarToast("Este semestre se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        renderizarSemestres();
        return;
      }
      guardarEdicionSemestre(semestreVivo, { nombre, fecha, duracion, planesConSeleccion });
    } else {
      guardarNuevoSemestre({ nombre, fecha, duracion, planesConSeleccion });
    }

    overlay.remove();
    renderizarSemestres();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !sucio) overlay.remove();
  });
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
  // FIX (2026-08-06 — "cada rato hace un scroll fantasma de la nada"):
  // esta función vacía y reconstruye #seccion-semestres COMPLETO en cada
  // render — y por acá pasa CUALQUIER cambio, porque es el onCambiar que
  // usan tanto el sync automático (cada sondeo ~9s que trae algo nuevo)
  // como cada expandir/colapsar tarjeta, editar nota, etc. (ver
  // construirTarjetaSemestre más abajo). El contenedor no tiene su propio
  // scroll (ver .app-contenido en design-system.css) — quien scrollea de
  // verdad es la página entera (window). Al vaciar innerHTML, la altura
  // total de la página cae a ~0 por una fracción de segundo; si el
  // usuario estaba más abajo de esa nueva altura reducida, el navegador
  // recorta scrollY al máximo posible EN ESE INSTANTE, y cuando el
  // contenido vuelve a crecer no lo restaura solo — eso es el salto.
  // Guardar y devolver scrollY a mano, ya en el próximo frame (con el
  // layout real recalculado), evita el salto sin afectar el caso legítimo
  // de que el contenido haya quedado más corto de verdad (scrollTo igual
  // lo recorta bien ahí).
  const scrollPrevio = window.scrollY;
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
    pasados.forEach((s) => seccionPasados.appendChild(construirTarjetaSemestre(s, obtenerPlanPorId, renderizarSemestres, onEditar, onBorrar, true)));
    cont.appendChild(seccionPasados);
  }

  requestAnimationFrame(() => {
    window.scrollTo(0, scrollPrevio);
  });
}

export { abrirModalAltaSemestre, obtenerSemestresActuales, obtenerSemestresPasados, renderizarSemestres };