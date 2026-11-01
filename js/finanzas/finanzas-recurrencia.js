/* =========================================================================
   FINANZAS 2.0 — Bloque "recurrente" del formulario (etapa 0B)
   Extraído tal cual del modal viejo de gastos (finanzas-gastos.js) para que
   el formulario nuevo no pase del límite de líneas. Misma lógica: frecuencia
   fija o "Personalizado" (diario / días específicos / cada N días).
   Devuelve exactamente la forma que guarda `movimiento.recurrente`
   (la misma de gastos_u: monto_por_pago, fecha_inicio, fecha_fin...).
   ========================================================================= */

import { calcularPagosRecurrentesTranscurridos } from "../core/schema.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { formatearMonto } from "./finanzas.js";

const FRECUENCIAS = [
  { id: "semanal", etiqueta: "Semanal" },
  { id: "quincenal", etiqueta: "Quincenal" },
  { id: "mensual", etiqueta: "Mensual" },
  { id: "anual", etiqueta: "Anual" },
  { id: "personalizado", etiqueta: "Personalizado" },
];

const SUBMODOS = [
  { id: "diario", etiqueta: "Diario" },
  { id: "dias_semana", etiqueta: "Días específicos" },
  { id: "cada_n_dias", etiqueta: "Cada N días" },
];

// 0 = domingo ... 6 = sábado (mismo criterio que Date.getDay()). Lunes primero en pantalla.
const DIAS_SEMANA = [
  { id: 1, etiqueta: "Lun" }, { id: 2, etiqueta: "Mar" }, { id: 3, etiqueta: "Mié" }, { id: 4, etiqueta: "Jue" },
  { id: 5, etiqueta: "Vie" }, { id: 6, etiqueta: "Sáb" }, { id: 0, etiqueta: "Dom" },
];

/** Texto legible de la frecuencia, para la lista de Movimientos. */
function formatearFrecuenciaRecurrente(recurrente) {
  if (recurrente.frecuencia !== "personalizado") {
    const f = FRECUENCIAS.find((x) => x.id === recurrente.frecuencia);
    return t(f ? f.etiqueta : "Mensual");
  }
  const p = recurrente.personalizado;
  if (!p) return t("Personalizado");
  if (p.modo === "diario") return t("Diario");
  if (p.modo === "cada_n_dias") return t(`Cada ${p.cada_n_dias || 1} días`);
  if (p.modo === "dias_semana" && Array.isArray(p.dias_semana) && p.dias_semana.length > 0) {
    return p.dias_semana
      .slice()
      .sort((a, b) => (a === 0 ? 7 : a) - (b === 0 ? 7 : b))
      .map((d) => t(DIAS_SEMANA.find((x) => x.id === d).etiqueta))
      .join(", ");
  }
  return t("Personalizado");
}

function crearCampo(etiqueta, control) {
  const bloque = document.createElement("div");
  const span = document.createElement("span");
  span.className = "form-label";
  span.textContent = t(etiqueta);
  bloque.append(span, control);
  return bloque;
}

function crearInput(tipo, valor = "") {
  const input = document.createElement("input");
  input.type = tipo;
  input.className = "form-input";
  input.value = valor;
  return input;
}

/**
 * @param {{recurrenteInicial?: object|null, esIngreso?: boolean, alCambiar?: (activo: boolean) => void}} cfg
 * @returns {{elemento: HTMLElement, estaActivo: () => boolean, obtenerValor: () => object|null, fijarEsIngreso: (b: boolean) => void}}
 */
function construirSeccionRecurrencia({ recurrenteInicial = null, esIngreso = false, alCambiar = () => {} } = {}) {
  const ini = recurrenteInicial || {};
  const iniPers = ini.personalizado || {};
  let esIngresoActual = esIngreso;
  let frecuencia = ini.frecuencia || "mensual";
  let submodo = iniPers.modo || "diario";
  const diasElegidos = new Set(iniPers.dias_semana || []);

  const elemento = document.createElement("div");
  elemento.className = "stack";

  // ----- Interruptor -----
  const filaSwitch = document.createElement("div");
  filaSwitch.className = "row-between";
  const etiquetaSwitch = document.createElement("span");
  const label = document.createElement("label");
  label.className = "switch switch-tema";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = !!recurrenteInicial;
  const pista = document.createElement("span");
  pista.className = "track";
  pista.innerHTML = '<span class="thumb"></span>';
  label.append(check, pista);
  filaSwitch.append(etiquetaSwitch, label);
  elemento.appendChild(filaSwitch);

  // ----- Cuerpo (solo visible con el interruptor encendido) -----
  const cuerpo = document.createElement("div");
  cuerpo.className = "stack";
  elemento.appendChild(cuerpo);

  const grupoFrecuencia = document.createElement("div");
  grupoFrecuencia.className = "pill-grid-2";
  FRECUENCIAS.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item";
    btn.dataset.valor = f.id;
    btn.textContent = t(f.etiqueta);
    btn.addEventListener("click", () => {
      frecuencia = f.id;
      marcar();
      refrescar();
    });
    grupoFrecuencia.appendChild(btn);
  });
  cuerpo.appendChild(crearCampo("Frecuencia", grupoFrecuencia));

  // Personalizado
  const bloquePers = document.createElement("div");
  bloquePers.className = "stack oculto";
  bloquePers.style.cssText = "padding:10px; border:1px solid var(--border-glass); border-radius:var(--radius-md);";

  const grupoSubmodo = document.createElement("div");
  grupoSubmodo.className = "pill-grid-2";
  SUBMODOS.forEach((sm) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item";
    btn.dataset.valor = sm.id;
    btn.textContent = t(sm.etiqueta);
    btn.addEventListener("click", () => {
      submodo = sm.id;
      marcar();
      refrescar();
    });
    grupoSubmodo.appendChild(btn);
  });
  bloquePers.appendChild(crearCampo("¿Cómo se repite?", grupoSubmodo));

  const grupoDias = document.createElement("div");
  grupoDias.className = "row";
  grupoDias.style.cssText = "flex-wrap:wrap; gap:6px;";
  DIAS_SEMANA.forEach((d) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (diasElegidos.has(d.id) ? " active" : "");
    btn.style.cssText = "flex:0 0 auto; padding:8px 14px;";
    btn.textContent = t(d.etiqueta);
    btn.addEventListener("click", () => {
      if (diasElegidos.has(d.id)) diasElegidos.delete(d.id);
      else diasElegidos.add(d.id);
      btn.classList.toggle("active", diasElegidos.has(d.id));
      refrescar();
    });
    grupoDias.appendChild(btn);
  });
  const bloqueDias = crearCampo("¿Qué días?", grupoDias);
  bloquePers.appendChild(bloqueDias);

  const inputCadaN = crearInput("number", iniPers.cada_n_dias || "");
  inputCadaN.min = "1";
  inputCadaN.placeholder = t("Ej. 3");
  inputCadaN.addEventListener("input", refrescar);
  const bloqueCadaN = crearCampo("Cada cuántos días", inputCadaN);
  bloquePers.appendChild(bloqueCadaN);
  cuerpo.appendChild(bloquePers);

  // Monto por pago + fechas
  const inputMontoPago = crearInput("number", ini.monto_por_pago || "");
  inputMontoPago.step = "0.01";
  inputMontoPago.setAttribute("inputmode", "decimal");
  inputMontoPago.addEventListener("input", refrescar);
  cuerpo.appendChild(crearCampo("Monto por pago", inputMontoPago));

  const filaFechas = document.createElement("div");
  filaFechas.className = "row";
  const inputInicio = crearInput("date", ini.fecha_inicio || "");
  inputInicio.addEventListener("input", refrescar);
  const inputFin = crearInput("date", ini.fecha_fin || "");
  inputFin.addEventListener("input", refrescar);
  const colInicio = crearCampo("Fecha de inicio", inputInicio);
  const colFin = crearCampo("Fecha de fin (opcional)", inputFin);
  colInicio.style.flex = "1";
  colFin.style.flex = "1";
  filaFechas.append(colInicio, colFin);
  cuerpo.appendChild(filaFechas);

  const vistaPrevia = document.createElement("p");
  vistaPrevia.className = "muted";
  vistaPrevia.style.margin = "0";
  cuerpo.appendChild(vistaPrevia);

  function marcar() {
    grupoFrecuencia.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === frecuencia));
    grupoSubmodo.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === submodo));
  }

  function leerValor() {
    return {
      frecuencia,
      monto_por_pago: Number(inputMontoPago.value) || 0,
      fecha_inicio: inputInicio.value || null,
      fecha_fin: inputFin.value || null,
      personalizado:
        frecuencia === "personalizado"
          ? { modo: submodo, dias_semana: [...diasElegidos], cada_n_dias: Number(inputCadaN.value) || null }
          : null,
    };
  }

  function refrescar() {
    bloquePers.classList.toggle("oculto", frecuencia !== "personalizado");
    bloqueDias.classList.toggle("oculto", submodo !== "dias_semana");
    bloqueCadaN.classList.toggle("oculto", submodo !== "cada_n_dias");
    if (!inputInicio.value) {
      vistaPrevia.textContent = t("Indica la fecha de inicio para ver cuánto llevas hasta hoy.");
      return;
    }
    const { cantidadPagos, totalPagado } = calcularPagosRecurrentesTranscurridos(leerValor());
    vistaPrevia.textContent = t(esIngresoActual ? "Ingresos hasta hoy:" : "Pagos hasta hoy:") + ` ${cantidadPagos} · ${formatearMonto(totalPagado)}`;
  }

  function actualizarEtiqueta() {
    etiquetaSwitch.textContent = t(esIngresoActual ? "¿Es un ingreso recurrente?" : "¿Es un pago recurrente?");
  }

  check.addEventListener("change", () => {
    cuerpo.classList.toggle("oculto", !check.checked);
    if (check.checked) refrescar();
    alCambiar(check.checked);
  });

  marcar();
  actualizarEtiqueta();
  cuerpo.classList.toggle("oculto", !check.checked);
  refrescar();

  return {
    elemento,
    estaActivo: () => check.checked,
    obtenerValor: () => (check.checked ? leerValor() : null),
    fijarEsIngreso(b) {
      esIngresoActual = !!b;
      actualizarEtiqueta();
      refrescar();
    },
  };
}

export { construirSeccionRecurrencia, formatearFrecuenciaRecurrente };
