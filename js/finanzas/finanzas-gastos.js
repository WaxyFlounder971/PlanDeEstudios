/* =========================================================================
   FINANZAS — Pestañas Gastos generales U y Beneficios (2026-08-10,
   renombrada de "Gastos estudiantiles" a "Beneficios" + pagos recurrentes
   y vínculo opcional a semestre en v2.8.8)
   La primera es un CRUD de gastos sueltos no vinculados a un semestre —
   simples (monto único) o recurrentes (se repiten en el tiempo), con
   vínculo opcional a un semestre puntual. La segunda vive el generador
   del prompt de descuentos estudiantiles: arma el texto, lo copia al
   portapapeles (blindado) y abre claude.ai en pestaña nueva.
   ========================================================================= */

import { calcularPagosRecurrentesTranscurridos, crearGastoU, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { copiarPromptConAviso } from "../core/clipboard.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

const FRECUENCIAS_GASTO_RECURRENTE = [
  { id: "semanal", etiqueta: "Semanal" },
  { id: "quincenal", etiqueta: "Quincenal" },
  { id: "mensual", etiqueta: "Mensual" },
  { id: "anual", etiqueta: "Anual" },
  { id: "personalizado", etiqueta: "Personalizado" },
];

/** Etiquetas de los 7 días de la semana en formato corto, para mostrar el resumen de "días específicos". */
const DIAS_SEMANA_CORTA = { 0: "Dom", 1: "Lun", 2: "Mar", 3: "Mié", 4: "Jue", 5: "Vie", 6: "Sáb" };

/**
 * Texto legible de la frecuencia de un gasto recurrente para la lista —
 * cubre tanto las 4 frecuencias fijas como los 3 sub-modos de
 * "Personalizado" (diario / días específicos / cada N días).
 */
function formatearFrecuenciaRecurrente(recurrente) {
  if (recurrente.frecuencia !== "personalizado") {
    return FRECUENCIAS_GASTO_RECURRENTE.find((f) => f.id === recurrente.frecuencia)?.etiqueta || "Mensual";
  }
  const p = recurrente.personalizado;
  if (!p) return "Personalizado";
  if (p.modo === "diario") return "Diario";
  if (p.modo === "cada_n_dias") return `Cada ${p.cada_n_dias || 1} días`;
  if (p.modo === "dias_semana" && Array.isArray(p.dias_semana) && p.dias_semana.length > 0) {
    return p.dias_semana
      .slice()
      .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b)) // lunes primero, domingo al final
      .map((d) => DIAS_SEMANA_CORTA[d])
      .join(", ");
  }
  return "Personalizado";
}

/** Todos los semestres del historial (actuales + pasados), mismo orden que la pestaña Semestres. */
function obtenerTodosLosSemestres() {
  return [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];
}

function obtenerNombreSemestre(semestreId) {
  if (!semestreId) return null;
  const semestre = obtenerTodosLosSemestres().find((s) => s.id === semestreId);
  return semestre ? semestre.nombre : "semestre eliminado";
}

/* ===================== Gastos generales U ===================== */

function renderizarPestanaGastosU(contenedor) {
  const cabecera = document.createElement("div");
  cabecera.className = "row-between";
  cabecera.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Gastos generales U</h3>`;
  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary";
  btnAgregar.textContent = "+ Añadir gasto";
  btnAgregar.addEventListener("click", () => abrirModalGastoU(null, contenedor));
  cabecera.appendChild(btnAgregar);
  contenedor.appendChild(cabecera);

  const gastos = estado.datos.gastos_u || [];
  if (gastos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Carné, seguro estudiantil, materiales, pagos recurrentes... cualquier gasto que no pertenezca a un semestre puntual.";
    contenedor.appendChild(vacio);
    return;
  }

  gastos.forEach((gasto) => {
    const fila = document.createElement("div");
    fila.className = "glass-card row-between";

    const nombreSemestre = obtenerNombreSemestre(gasto.semestre_id);
    let subtextos = "";
    if (gasto.nota) subtextos += `<p class="muted" style="margin:2px 0 0;">${gasto.nota}</p>`;
    if (gasto.recurrente) {
      subtextos += `<p class="muted" style="margin:2px 0 0;">🔁 ${formatearFrecuenciaRecurrente(gasto.recurrente)} · ${formatearMonto(gasto.recurrente.monto_por_pago)} c/u · desde ${formatearFechaLarga(gasto.recurrente.fecha_inicio)}${gasto.recurrente.fecha_fin ? ` hasta ${formatearFechaLarga(gasto.recurrente.fecha_fin)}` : ""}</p>`;
    }
    if (nombreSemestre) subtextos += `<p class="muted" style="margin:2px 0 0;">📎 Vinculado a ${nombreSemestre}</p>`;

    fila.innerHTML = `
      <div>
        <p style="margin:0; font-weight:600;">${gasto.nombre}</p>
        ${subtextos}
      </div>
    `;
    const derecha = document.createElement("div");
    derecha.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge badge-neutral";
    if (gasto.recurrente) {
      const { totalPagado } = calcularPagosRecurrentesTranscurridos(gasto.recurrente);
      badge.textContent = formatearMonto(totalPagado) + " a la fecha";
    } else {
      badge.textContent = formatearMonto(gasto.costo);
    }
    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn-secondary";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => abrirModalGastoU(gasto, contenedor));
    derecha.appendChild(badge);
    derecha.appendChild(btnEditar);
    fila.appendChild(derecha);
    contenedor.appendChild(fila);
  });
}

function abrirModalGastoU(gastoExistente, contenedorLista) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";
  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:460px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());
  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", cerrar);

  caja.innerHTML = `<h2 style="margin:0;">${gastoExistente ? "Editar" : "Nuevo"} gasto</h2>`;

  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Ej. Carné, seguro estudiantil, pase de transporte...";
  inputNombre.value = gastoExistente ? gastoExistente.nombre : "";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  // ----- ¿Es un pago recurrente? (2026-08-11, v2.8.8) -----
  const filaRecurrente = document.createElement("div");
  filaRecurrente.className = "row-between";
  filaRecurrente.innerHTML = `
    <span>¿Es un pago recurrente?</span>
    <label class="switch switch-tema">
      <input type="checkbox" id="switch-gasto-recurrente">
      <span class="track"><span class="thumb"></span></span>
    </label>
  `;
  caja.appendChild(filaRecurrente);
  const switchRecurrente = filaRecurrente.querySelector("#switch-gasto-recurrente");
  switchRecurrente.checked = !!(gastoExistente && gastoExistente.recurrente);

  // ----- Costo simple (monto único, gasto NO recurrente) -----
  const bloqueCosto = document.createElement("div");
  bloqueCosto.innerHTML = `<span class="form-label">Costo</span>`;
  const inputCosto = document.createElement("input");
  inputCosto.type = "number";
  inputCosto.step = "0.01";
  inputCosto.className = "form-input";
  inputCosto.value = gastoExistente && !gastoExistente.recurrente ? gastoExistente.costo : "";
  bloqueCosto.appendChild(inputCosto);
  caja.appendChild(bloqueCosto);

  // ----- Bloque de recurrencia (frecuencia + monto por pago + fechas) -----
  const bloqueRecurrente = document.createElement("div");
  bloqueRecurrente.className = "stack";

  // v2.8.9: "la frecuencia se corta" -> grid de 2 columnas (.pill-grid-2,
  // ver design-system.css) en vez de una fila horizontal — sigue siendo un
  // switch de selección única, solo cambia el layout, nunca trunca texto.
  // Se agrega "Personalizado" como 5ta opción (2 arriba/2 abajo/1 sola).
  const pillFrecuencia = document.createElement("div");
  pillFrecuencia.innerHTML = `<span class="form-label">Frecuencia</span>`;
  const grupoFrecuencia = document.createElement("div");
  grupoFrecuencia.className = "pill-grid-2";
  FRECUENCIAS_GASTO_RECURRENTE.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item";
    btn.dataset.valor = f.id;
    btn.textContent = f.etiqueta;
    grupoFrecuencia.appendChild(btn);
  });
  pillFrecuencia.appendChild(grupoFrecuencia);
  bloqueRecurrente.appendChild(pillFrecuencia);

  let frecuenciaElegida = (gastoExistente && gastoExistente.recurrente && gastoExistente.recurrente.frecuencia) || "mensual";
  function marcarFrecuenciaActiva() {
    grupoFrecuencia.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === frecuenciaElegida));
  }
  marcarFrecuenciaActiva();
  grupoFrecuencia.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      frecuenciaElegida = btn.dataset.valor;
      marcarFrecuenciaActiva();
      actualizarVisibilidadPersonalizado();
      actualizarVistaPreviaRecurrente();
    });
  });

  // ----- "Personalizado" (v2.8.9, pedido explícito): días específicos de
  // la semana, diario, o cada N días — N 100% libre, sin límite fijo. -----
  const bloquePersonalizado = document.createElement("div");
  bloquePersonalizado.className = "stack oculto";
  bloquePersonalizado.style.cssText = "padding:10px; border:1px solid var(--border-glass); border-radius:var(--radius-md);";

  const pillSubmodo = document.createElement("div");
  pillSubmodo.innerHTML = `<span class="form-label">¿Cómo se repite?</span>`;
  const grupoSubmodo = document.createElement("div");
  grupoSubmodo.className = "pill-grid-2";
  const SUBMODOS_PERSONALIZADO = [
    { id: "diario", etiqueta: "Diario" },
    { id: "dias_semana", etiqueta: "Días específicos" },
    { id: "cada_n_dias", etiqueta: "Cada N días" },
  ];
  SUBMODOS_PERSONALIZADO.forEach((sm) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item";
    btn.dataset.valor = sm.id;
    btn.textContent = sm.etiqueta;
    grupoSubmodo.appendChild(btn);
  });
  pillSubmodo.appendChild(grupoSubmodo);
  bloquePersonalizado.appendChild(pillSubmodo);

  let submodoElegido =
    (gastoExistente && gastoExistente.recurrente && gastoExistente.recurrente.personalizado && gastoExistente.recurrente.personalizado.modo) ||
    "diario";
  function marcarSubmodoActivo() {
    grupoSubmodo.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === submodoElegido));
  }

  // Días específicos de la semana: multi-selección (no es un switch de una
  // sola opción como el resto de los pill-group/pill-grid de este modal).
  const DIAS_SEMANA = [
    { id: 1, corta: "Lun" }, { id: 2, corta: "Mar" }, { id: 3, corta: "Mié" }, { id: 4, corta: "Jue" },
    { id: 5, corta: "Vie" }, { id: 6, corta: "Sáb" }, { id: 0, corta: "Dom" },
  ];
  const bloqueDiasSemana = document.createElement("div");
  bloqueDiasSemana.className = "stack oculto";
  bloqueDiasSemana.innerHTML = `<span class="form-label">¿Qué días?</span>`;
  const grupoDiasSemana = document.createElement("div");
  grupoDiasSemana.className = "row";
  grupoDiasSemana.style.cssText = "flex-wrap:wrap; gap:6px;";
  let diasSemanaElegidos = new Set(
    (gastoExistente && gastoExistente.recurrente && gastoExistente.recurrente.personalizado && gastoExistente.recurrente.personalizado.dias_semana) || []
  );
  DIAS_SEMANA.forEach((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (diasSemanaElegidos.has(d.id) ? " active" : "");
    btn.style.cssText = "flex:0 0 auto; padding:8px 14px;";
    btn.textContent = d.corta;
    btn.addEventListener("click", () => {
      if (diasSemanaElegidos.has(d.id)) diasSemanaElegidos.delete(d.id);
      else diasSemanaElegidos.add(d.id);
      btn.classList.toggle("active", diasSemanaElegidos.has(d.id));
      actualizarVistaPreviaRecurrente();
    });
    grupoDiasSemana.appendChild(btn);
  });
  bloqueDiasSemana.appendChild(grupoDiasSemana);
  bloquePersonalizado.appendChild(bloqueDiasSemana);

  const bloqueCadaNDias = document.createElement("div");
  bloqueCadaNDias.className = "oculto";
  bloqueCadaNDias.innerHTML = `<span class="form-label">Cada cuántos días</span>`;
  const inputCadaNDias = document.createElement("input");
  inputCadaNDias.type = "number";
  inputCadaNDias.min = "1";
  inputCadaNDias.className = "form-input";
  inputCadaNDias.placeholder = "Ej. 3";
  inputCadaNDias.value =
    (gastoExistente && gastoExistente.recurrente && gastoExistente.recurrente.personalizado && gastoExistente.recurrente.personalizado.cada_n_dias) || "";
  inputCadaNDias.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueCadaNDias.appendChild(inputCadaNDias);
  bloquePersonalizado.appendChild(bloqueCadaNDias);

  function actualizarVisibilidadSubmodo() {
    bloqueDiasSemana.classList.toggle("oculto", submodoElegido !== "dias_semana");
    bloqueCadaNDias.classList.toggle("oculto", submodoElegido !== "cada_n_dias");
  }
  marcarSubmodoActivo();
  actualizarVisibilidadSubmodo();
  grupoSubmodo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      submodoElegido = btn.dataset.valor;
      marcarSubmodoActivo();
      actualizarVisibilidadSubmodo();
      actualizarVistaPreviaRecurrente();
    });
  });

  function actualizarVisibilidadPersonalizado() {
    bloquePersonalizado.classList.toggle("oculto", frecuenciaElegida !== "personalizado");
  }
  actualizarVisibilidadPersonalizado();
  bloqueRecurrente.appendChild(bloquePersonalizado);

  const bloqueMontoPago = document.createElement("div");
  bloqueMontoPago.innerHTML = `<span class="form-label">Monto por pago</span>`;
  const inputMontoPago = document.createElement("input");
  inputMontoPago.type = "number";
  inputMontoPago.step = "0.01";
  inputMontoPago.className = "form-input";
  inputMontoPago.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.monto_por_pago : "";
  inputMontoPago.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueMontoPago.appendChild(inputMontoPago);
  bloqueRecurrente.appendChild(bloqueMontoPago);

  const filaFechas = document.createElement("div");
  filaFechas.className = "row";

  const bloqueFechaInicio = document.createElement("div");
  bloqueFechaInicio.style.flex = "1";
  bloqueFechaInicio.innerHTML = `<span class="form-label">Fecha de inicio</span>`;
  const inputFechaInicio = document.createElement("input");
  inputFechaInicio.type = "date";
  inputFechaInicio.className = "form-input";
  inputFechaInicio.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.fecha_inicio || "" : "";
  inputFechaInicio.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueFechaInicio.appendChild(inputFechaInicio);
  filaFechas.appendChild(bloqueFechaInicio);

  const bloqueFechaFin = document.createElement("div");
  bloqueFechaFin.style.flex = "1";
  bloqueFechaFin.innerHTML = `<span class="form-label">Fecha de fin (opcional)</span>`;
  const inputFechaFin = document.createElement("input");
  inputFechaFin.type = "date";
  inputFechaFin.className = "form-input";
  inputFechaFin.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.fecha_fin || "" : "";
  inputFechaFin.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueFechaFin.appendChild(inputFechaFin);
  filaFechas.appendChild(bloqueFechaFin);

  bloqueRecurrente.appendChild(filaFechas);

  const vistaPrevia = document.createElement("p");
  vistaPrevia.className = "muted";
  vistaPrevia.style.margin = "0";
  bloqueRecurrente.appendChild(vistaPrevia);

  function actualizarVistaPreviaRecurrente() {
    if (!inputFechaInicio.value) {
      vistaPrevia.textContent = "Indicá la fecha de inicio para ver cuánto llevás pagado hasta hoy.";
      return;
    }
    const { cantidadPagos, totalPagado } = calcularPagosRecurrentesTranscurridos({
      frecuencia: frecuenciaElegida,
      monto_por_pago: Number(inputMontoPago.value) || 0,
      fecha_inicio: inputFechaInicio.value,
      fecha_fin: inputFechaFin.value || null,
      personalizado:
        frecuenciaElegida === "personalizado"
          ? { modo: submodoElegido, dias_semana: [...diasSemanaElegidos], cada_n_dias: Number(inputCadaNDias.value) || null }
          : null,
    });
    vistaPrevia.textContent = `Llevás ${cantidadPagos} pago${cantidadPagos === 1 ? "" : "s"} = ${formatearMonto(totalPagado)} hasta hoy.`;
  }

  caja.appendChild(bloqueRecurrente);

  function actualizarVisibilidadRecurrente() {
    bloqueCosto.classList.toggle("oculto", switchRecurrente.checked);
    bloqueRecurrente.classList.toggle("oculto", !switchRecurrente.checked);
    if (switchRecurrente.checked) actualizarVistaPreviaRecurrente();
  }
  actualizarVisibilidadRecurrente();
  switchRecurrente.addEventListener("change", actualizarVisibilidadRecurrente);

  // ----- Vincular a un semestre (opcional, 2026-08-11, v2.8.8) -----
  // v2.8.9: "el selector está muy culero" -> mismo patrón custom que ya
  // usa Ajustes (Escala de notas) y Profesores — botón + lista propia
  // reparentada a document.body, mismo look que el resto del tema, en vez
  // del <select> nativo (que cada navegador pinta con su propio criterio,
  // sin match real con el resto de la UI). El <select> oculto sigue siendo
  // la fuente de verdad real (mantiene .value, dispara 'change'), así el
  // resto del archivo (selectSemestre.value en el guardado) no cambia.
  const bloqueSemestre = document.createElement("div");
  bloqueSemestre.innerHTML = `<span class="form-label">Vincular a un semestre (opcional)</span>`;
  const selectSemestre = document.createElement("select");
  selectSemestre.hidden = true;
  selectSemestre.setAttribute("aria-hidden", "true");
  selectSemestre.tabIndex = -1;
  const opcionSinVincular = document.createElement("option");
  opcionSinVincular.value = "";
  opcionSinVincular.textContent = "Sin vincular";
  selectSemestre.appendChild(opcionSinVincular);
  obtenerTodosLosSemestres().forEach((semestre) => {
    const opt = document.createElement("option");
    opt.value = semestre.id;
    opt.textContent = semestre.nombre;
    selectSemestre.appendChild(opt);
  });
  selectSemestre.value = (gastoExistente && gastoExistente.semestre_id) || "";

  const dropdownSemestre = document.createElement("div");
  dropdownSemestre.className = "select-custom";
  const botonSemestre = document.createElement("button");
  botonSemestre.type = "button";
  botonSemestre.className = "form-input select-custom-boton";
  const opcionInicial = Array.from(selectSemestre.options).find((o) => o.value === selectSemestre.value);
  botonSemestre.textContent = opcionInicial ? opcionInicial.textContent : "Sin vincular";
  const listaSemestre = document.createElement("ul");
  listaSemestre.className = "select-custom-lista oculto";

  function posicionarListaSemestre() {
    const r = botonSemestre.getBoundingClientRect();
    listaSemestre.style.position = "fixed";
    listaSemestre.style.top = `${r.bottom + 6}px`;
    listaSemestre.style.left = `${r.left}px`;
    listaSemestre.style.width = `${r.width}px`;
  }
  function cerrarListaSemestre() {
    listaSemestre.classList.add("oculto");
    botonSemestre.setAttribute("aria-expanded", "false");
    if (listaSemestre.parentElement === document.body) dropdownSemestre.appendChild(listaSemestre);
    window.removeEventListener("scroll", cerrarSiScrollExternoSemestre, true);
    window.removeEventListener("resize", cerrarListaSemestre);
  }
  function cerrarSiScrollExternoSemestre(e) {
    if (listaSemestre.contains(e.target)) return;
    cerrarListaSemestre();
  }
  function abrirListaSemestre() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== listaSemestre) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    listaSemestre._volverA = dropdownSemestre;
    document.body.appendChild(listaSemestre);
    posicionarListaSemestre();
    listaSemestre.classList.remove("oculto");
    botonSemestre.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", cerrarSiScrollExternoSemestre, true);
    window.addEventListener("resize", cerrarListaSemestre);
  }

  Array.from(selectSemestre.options).forEach((opt) => {
    const item = document.createElement("li");
    item.className = "select-custom-opcion";
    item.textContent = opt.textContent;
    if (opt.value === selectSemestre.value) item.classList.add("activa");
    item.addEventListener("click", () => {
      selectSemestre.value = opt.value;
      botonSemestre.textContent = opt.textContent;
      listaSemestre.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
      item.classList.add("activa");
      cerrarListaSemestre();
      selectSemestre.dispatchEvent(new Event("change"));
    });
    listaSemestre.appendChild(item);
  });
  botonSemestre.setAttribute("aria-expanded", "false");
  botonSemestre.addEventListener("click", (e) => {
    e.stopPropagation();
    if (listaSemestre.classList.contains("oculto")) abrirListaSemestre();
    else cerrarListaSemestre();
  });
  document.addEventListener("click", (e) => {
    if (!dropdownSemestre.contains(e.target) && !listaSemestre.contains(e.target)) {
      cerrarListaSemestre();
    }
  });

  dropdownSemestre.appendChild(botonSemestre);
  dropdownSemestre.appendChild(listaSemestre);
  dropdownSemestre.appendChild(selectSemestre);
  bloqueSemestre.appendChild(dropdownSemestre);
  caja.appendChild(bloqueSemestre);


  const bloqueNota = document.createElement("div");
  bloqueNota.innerHTML = `<span class="form-label">Nota (opcional)</span>`;
  const inputNota = document.createElement("textarea");
  inputNota.className = "form-textarea";
  inputNota.rows = 3;
  inputNota.value = gastoExistente ? gastoExistente.nota || "" : "";
  bloqueNota.appendChild(inputNota);
  caja.appendChild(bloqueNota);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.marginTop = "8px";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.style.flex = "1";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  if (gastoExistente) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger";
    btnEliminar.style.flex = "1";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar gasto",
        mensaje: `Se va a borrar "${gastoExistente.nombre}". Esta acción no se puede deshacer.`,
        textoConfirmar: "Eliminar gasto",
        onConfirmar: () => {
          estado.datos.gastos_u = (estado.datos.gastos_u || []).filter((g) => g.id !== gastoExistente.id);
          if (!Array.isArray(estado.datos._eliminados_gastos_u)) estado.datos._eliminados_gastos_u = [];
          estado.datos._eliminados_gastos_u.push({ id: gastoExistente.id, eliminadoEn: Date.now() });
          marcarCambioPendiente();
          cerrar();
          contenedorLista.innerHTML = "";
          renderizarPestanaGastosU(contenedorLista);
        },
      });
    });
    filaBotones.appendChild(btnEliminar);
  }

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.style.flex = "1";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    if (!nombre) return;
    const nota = inputNota.value.trim();
    const semestreId = selectSemestre.value || null;

    const recurrente = switchRecurrente.checked
      ? {
          frecuencia: frecuenciaElegida,
          montoPorPago: Number(inputMontoPago.value) || 0,
          fechaInicio: inputFechaInicio.value || null,
          fechaFin: inputFechaFin.value || null,
          personalizado:
            frecuenciaElegida === "personalizado"
              ? { modo: submodoElegido, diasSemana: [...diasSemanaElegidos], cadaNDias: Number(inputCadaNDias.value) || null }
              : null,
        }
      : null;
    const costo = switchRecurrente.checked ? 0 : Number(inputCosto.value) || 0;

    if (gastoExistente) {
      gastoExistente.nombre = nombre;
      gastoExistente.costo = costo;
      gastoExistente.nota = nota || null;
      gastoExistente.semestre_id = semestreId;
      gastoExistente.recurrente = recurrente
        ? {
            frecuencia: recurrente.frecuencia,
            monto_por_pago: recurrente.montoPorPago,
            fecha_inicio: recurrente.fechaInicio,
            fecha_fin: recurrente.fechaFin,
            personalizado: recurrente.personalizado
              ? {
                  modo: recurrente.personalizado.modo,
                  dias_semana: recurrente.personalizado.diasSemana,
                  cada_n_dias: recurrente.personalizado.cadaNDias,
                }
              : null,
          }
        : null;
      sellarTimestamp(gastoExistente);
    } else {
      const nuevo = crearGastoU({ nombre, costo, nota: nota || null, semestreId, recurrente });
      if (!Array.isArray(estado.datos.gastos_u)) estado.datos.gastos_u = [];
      estado.datos.gastos_u.push(nuevo);
    }
    marcarCambioPendiente();
    cerrar();
    contenedorLista.innerHTML = "";
    renderizarPestanaGastosU(contenedorLista);
  });
  filaBotones.appendChild(btnGuardar);

  caja.appendChild(filaBotones);
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

/* ===================== Beneficios: generador de prompt de descuentos ===================== */

// Plantilla completa del prompt de descuentos — {UNIVERSIDAD} se interpola
// con el nombre real de la universidad del plan elegido antes de copiar.
const PLANTILLA_PROMPT_DESCUENTOS = `Necesito que uses tu herramienta de búsqueda web de forma activa para responder esto con información real y actual, no desde tu conocimiento general ni asumiendo que no podés buscar en internet, sí podés y necesito que lo hagas. No me respondas con advertencias tipo "no puedo verificar esto en tiempo real" ni te limites por precaución, buscá de verdad, confirmá lo que encuentres, y si algo no lo podés confirmar decímelo directamente sin rodeos ni disculpas innecesarias.

Tomate todo el tiempo y todas las búsquedas que necesites para hacer esto bien, no te apures ni te conformes con la primera página que encuentres. Al mismo tiempo, sé eficiente: no repitas la misma búsqueda con palabras casi idénticas, y no gastes búsquedas en cosas que ya confirmaste. Para cada categoría, buscá primero si existe una fuente oficial directa (por ejemplo, para IA: "GitHub Student Pack beneficios", luego "Claude descuento estudiantes", así uno por uno en vez de una búsqueda genérica que junte todo). Si una fuente oficial menciona un requisito (ej. correo institucional, carné vigente, verificación con SheerID u otro servicio), anotalo textualmente en tu respuesta, no lo resumas de forma vaga. Si encontrás una página de convenios o beneficios estudiantiles de {UNIVERSIDAD} en su sitio oficial, revisala completa, no te quedes solo con el resultado de búsqueda, entrá a la página real. Para cadenas o empresas costarricenses, verificá primero si tienen una página o publicación específica de "descuento estudiante" antes de asumir que no existe.

Necesito que investigues qué descuentos, beneficios o tarifas especiales existen actualmente para estudiantes activos de {UNIVERSIDAD}, en Costa Rica. Soy estudiante matriculado y busco esta información para aprovecharla activamente, no es una consulta teórica. Quiero una lista exhaustiva, no te dejes ninguna categoría a medias ni asumas que algo "no aplica" sin buscarlo primero.

Buscá información actual (no asumas que datos viejos siguen vigentes, verificá que sigan activos) organizada en las siguientes categorías. En cada categoría, los ejemplos que doy son solo punto de partida, buscá TODAS las opciones que encuentres, no te limites a los nombres que menciono.

INTELIGENCIA ARTIFICIAL (IMPORTANTE, no te saltes nada acá): planes pagos de IA con descuento o gratis para estudiantes (Claude, ChatGPT Plus, Gemini Advanced, Perplexity Pro, Copilot Pro, GitHub Copilot, Cursor, y cualquier otra), créditos gratuitos de API para estudiantes, convenios que {UNIVERSIDAD} tenga con empresas de IA, herramientas de IA para escritura/imágenes/transcripción/programación con tarifa estudiantil.
TECNOLOGÍA, SOFTWARE Y HERRAMIENTAS PROFESIONALES: licencias estudiantiles (Microsoft 365, Adobe, JetBrains, GitHub Student Pack, Autodesk, Figma, Notion, Canva), créditos de nube (AWS Educate, Google Cloud for Students, Azure for Students), software por carrera (CAD, MATLAB, SolidWorks), descuentos reales en compra de laptops y hardware (Apple, Lenovo, Dell, HP, ASUS, tiendas costarricenses), planes de datos/internet con tarifa estudiantil, seguro o reparación de celular.
TRANSPORTE (dentro de Costa Rica): buses, tren (INCOFER), apps de transporte, estacionamientos cerca de las sedes de {UNIVERSIDAD}, alquiler de vehículos y seguro vehicular con tarifa estudiantil.
ALIMENTACIÓN (a nivel nacional, no solo cerca de las sedes): sodas, restaurantes, cadenas de comida rápida, cafeterías o cualquier negocio de alimentación en Costa Rica con descuento por carné estudiantil, sin importar la provincia, esto debe cubrir todo el país. Cadenas con presencia nacional que tengan convenio recurrente. Delivery de comida con descuento estudiantil. Si encontrás algo específico de una zona, indicalo pero aclará que es local.
ENTRETENIMIENTO, CULTURA Y STREAMING: cines, TODOS los servicios de streaming de música/video/lectura/gaming con plan estudiantil en Costa Rica (no te limites a nombres específicos), museos, teatros, conciertos, festivales, eventos deportivos, boliche/arcades/escape rooms con tarifa estudiantil.
SALUD Y BIENESTAR: gimnasios, seguros médicos/dentales, farmacias, servicios de salud mental/psicología, ópticas, con descuento estudiantil.
BANCA Y FINANZAS: cuentas sin costo de mantenimiento, tarjetas estudiantiles, préstamos con tasa preferencial (BAC, BCR, BN, Scotiabank, Popular).
LIBRERÍAS, FOTOCOPIADO E IMPRESIÓN: librerías, fotocopiado, impresión 3D con tarifa estudiantil.
CERTIFICACIONES Y EXÁMENES PROFESIONALES: TOEFL, IELTS, certificaciones de AWS/Microsoft/Google, certificaciones contables/gestión de proyectos, cursos de idiomas con tarifa estudiantil.
VIAJES, TURISMO Y BENEFICIOS INTERNACIONALES (menor prioridad, pero igual buscala): carné internacional (ISIC), tarifas aéreas estudiantiles, hostales/alojamiento/seguros de viaje en el extranjero, programas de intercambio o convenios internacionales de {UNIVERSIDAD}, turismo de aventura y parques nacionales (SINAC), parques temáticos/acuáticos/zoológicos.
OTROS Y BENEFICIOS POCO OBVIOS (no dejes ninguno fuera): convenios institucionales de {UNIVERSIDAD} con comercios, tiendas de ropa/electrónica/peluquerías con carné universitario, cualquier otro beneficio que encuentres aunque sea pequeño o raro.

FORMATO DE RESPUESTA QUE NECESITO (esto es muy importante, seguilo al pie de la letra):

Mostrame SOLO los beneficios que SÍ encontraste y confirmaste. No escribas ninguna línea de "esto no existe" intercalada entre los resultados positivos. Organizá lo positivo por categoría, con títulos bien marcados. Para cada beneficio: qué es, qué descuento exacto da, qué se necesita para acceder (usualmente el carné vigente), y si es nacional, limitado a alguna sede, o internacional. Usá viñetas cortas, no párrafos densos. No omitas ningún beneficio real por considerarlo poco importante. Al final de TODO, un solo resumen corto (unas pocas líneas) de qué categorías no dieron resultado confiable y cuáles beneficios convendría confirmar directamente. Priorizá fuentes oficiales sobre foros.`;

function armarPromptDescuentos(universidad) {
  return PLANTILLA_PROMPT_DESCUENTOS.split("{UNIVERSIDAD}").join(universidad);
}

/** Universidades distintas entre los planes activos (Hardcore) o solo la del plan activo. */
function obtenerUniversidadesElegibles() {
  const cfg = estado.datos.configuracion;
  if (!cfg.modo_hardcore) {
    const activo = obtenerPlanActivo();
    return activo ? [activo.universidad] : [];
  }
  const idsActivos = [cfg.plan_activo_id, cfg.plan_activo_secundario_id, cfg.plan_activo_terciario_id].filter(Boolean);
  const universidades = (estado.datos.planes_estudio || [])
    .filter((p) => idsActivos.includes(p.id))
    .map((p) => p.universidad);
  return [...new Set(universidades)];
}

/**
 * v2.8.9: en vez de copiar y abrir claude.ai al toque (sensación de "no sé
 * si pasó algo"), se muestra un aviso explícito de que el prompt ya está
 * copiado y de que se va a abrir Claude, y recién 3 segundos después —
 * tiempo de sobra para leer el aviso — se abre la pestaña nueva. mostrarToast
 * ya limpia cualquier toast anterior (incluido el que pueda mostrar
 * copiarPromptConAviso al copiar), así que no queda ningún mensaje viejo
 * pisado con este.
 */
async function generarYCopiarPromptDescuentos(universidad) {
  const prompt = armarPromptDescuentos(universidad);
  await copiarPromptConAviso(prompt);
  mostrarToast("✓ Se copió el prompt. Pegalo en el chat — enviando a Claude en 3 segundos…", 3000);
  setTimeout(() => window.open("https://claude.ai", "_blank"), 3000);
}

function renderizarPestanaBeneficios(contenedor) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `
    <h3 class="texto-encabezado-seccion" style="margin:0;">Buscar descuentos para estudiantes</h3>
    <p class="muted" style="margin:0;">
      Copia un prompt listo para pegar en una sesión nueva de Claude, que investiga
      descuentos, beneficios y tarifas estudiantiles reales para tu universidad.
    </p>
  `;

  const universidades = obtenerUniversidadesElegibles();

  if (universidades.length === 0) {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.textContent = "Necesitás tener un Plan de Estudios activo con universidad definida.";
    sec.appendChild(aviso);
  } else if (universidades.length === 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";
    btn.textContent = `Buscar descuentos para estudiantes de ${universidades[0]}`;
    btn.addEventListener("click", () => generarYCopiarPromptDescuentos(universidades[0]));
    sec.appendChild(btn);
  } else {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.style.margin = "0";
    aviso.textContent = "Modo Hardcore activo con más de una universidad — elegí de cuál generar el prompt:";
    sec.appendChild(aviso);
    universidades.forEach((uni) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary btn-block";
      btn.textContent = `Buscar descuentos para estudiantes de ${uni}`;
      btn.addEventListener("click", () => generarYCopiarPromptDescuentos(uni));
      sec.appendChild(btn);
    });
  }

  contenedor.appendChild(sec);
}

export { obtenerTodosLosSemestres, renderizarPestanaBeneficios, renderizarPestanaGastosU };
