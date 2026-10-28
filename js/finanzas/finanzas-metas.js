/* =========================================================================
   FINANZAS 2.0 — Pestaña Metas con anillos (etapa 0C)
   Cada meta muestra un anillo de avance + el texto al lado (nunca solo
   color). El saldo SIEMPRE se deriva (calcularSaldoMeta); aquí no se guarda
   ningún número. Una meta con movimientos no se borra: se archiva.
   ========================================================================= */

import { crearMeta, hoyIso } from "../core/finanzas/finanzas-modelo.js";
import { FRECUENCIAS_APORTE, configurarPlanMeta, resumirMeta } from "../core/finanzas/finanzas-metas-plan.js";
import { MESES_SUGERIDOS, sugerirMetas } from "../core/finanzas/finanzas-metas-sugeridas.js";
import { ORIGENES_REPARTO, configurarReparto } from "../core/finanzas/finanzas-reparto.js";
import { calcularSaldoMeta, obtenerModulosFinanzas } from "../core/finanzas/finanzas-derivados.js";
import { construirFormularioMetaGasto, construirTarjetaMetaGasto } from "./finanzas-metas-gasto-ui.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Datos de presentación de una meta (puro: lo usan el anillo, el Resumen y los tests). */
function resumenMeta(meta, datos) {
  const saldo = calcularSaldoMeta(meta, datos);
  const objetivo = Number(meta.objetivo) || 0;
  const progreso = objetivo > 0 ? Math.max(0, Math.min(1, saldo / objetivo)) : 0;
  return {
    saldo,
    objetivo,
    progreso,
    porcentaje: Math.round(progreso * 100),
    faltante: objetivo > 0 ? Math.max(0, objetivo - saldo) : 0,
    cumplida: objetivo > 0 && saldo >= objetivo,
  };
}

/** Anillo SVG. `tam` en px; el % va dentro y el resto del texto lo pone quien lo usa. */
function construirAnilloMeta(meta, datos, tam = 88) {
  const r = resumenMeta(meta, datos);
  const RADIO = 38;
  const CIRC = 2 * Math.PI * RADIO;

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100");
  svg.setAttribute("width", String(tam));
  svg.setAttribute("height", String(tam));
  svg.setAttribute("class", "meta-anillo-svg");
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", r.objetivo > 0 ? `${meta.nombre}: ${r.porcentaje}%` : meta.nombre);

  const circulo = (clase, extra) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "50"); c.setAttribute("cy", "50"); c.setAttribute("r", String(RADIO));
    c.setAttribute("fill", "none"); c.setAttribute("class", clase);
    Object.entries(extra || {}).forEach(([k, v]) => c.setAttribute(k, v));
    return c;
  };
  svg.appendChild(circulo("meta-anillo-pista"));
  if (r.progreso > 0) {
    const largo = r.progreso * CIRC;
    svg.appendChild(circulo("meta-anillo-arco" + (r.cumplida ? " cumplida" : ""), {
      "stroke-dasharray": `${largo} ${CIRC - largo}`,
      transform: "rotate(-90 50 50)",
    }));
  }

  const caja = document.createElement("div");
  caja.className = "meta-anillo";
  caja.style.cssText = `width:${tam}px; height:${tam}px;`;
  const centro = document.createElement("span");
  centro.className = "meta-anillo-centro";
  centro.textContent = r.cumplida ? "✓" : r.objetivo > 0 ? `${r.porcentaje}%` : (meta.emoji || "🎯");
  caja.append(svg, centro);
  return caja;
}

/** Líneas de texto de una meta (junto al anillo). */
function construirTextoMeta(meta, datos) {
  const r = resumenMeta(meta, datos);
  const bloque = document.createElement("div");
  bloque.className = "meta-texto";

  const nombre = document.createElement("div");
  nombre.className = "meta-nombre";
  nombre.textContent = `${meta.emoji || "🎯"} ${meta.nombre || t("Meta sin nombre")}`;

  const montos = document.createElement("div");
  montos.className = "meta-montos";
  montos.textContent = r.objetivo > 0
    ? t("{saldo} de {objetivo}").replace("{saldo}", formatearMonto(r.saldo)).replace("{objetivo}", formatearMonto(r.objetivo))
    : formatearMonto(r.saldo);

  const estadoEl = document.createElement("span");
  estadoEl.className = "badge " + (r.cumplida ? "badge-success" : "badge-info");
  estadoEl.textContent = r.objetivo <= 0
    ? t("Sin objetivo")
    : r.cumplida ? t("¡Meta cumplida!") : t("Faltan {monto}").replace("{monto}", formatearMonto(r.faltante));

  bloque.append(nombre, montos, estadoEl);
  return bloque;
}

const ETIQUETA_FRECUENCIA = { semanal: "Cada semana", quincenal: "Cada 2 semanas", mensual: "Cada mes" };
const ETIQUETA_ORIGEN_REPARTO = { todo: "Cualquier ingreso y la beca", ingreso: "Solo ingresos, sin la beca", beca: "Solo la beca" };
const TEXTO_MOTIVO = {
  porcentaje: "El porcentaje tiene que estar entre 1 y 100.",
  fecha: "Esa fecha no existe. Revisa el día y el mes.",
  monto: "El aporte tiene que ser mayor a cero.",
  frecuencia: "Elige cada cuánto aportas.",
  inicio: "La fecha de inicio del aporte no es válida.",
};

/**
 * Plan de la meta (sesión 4): fecha objetivo, aporte sugerido, fecha estimada y aporte programado.
 * Todo sale de resumirMeta (derivado, nada se guarda). Cada línea es texto; el color nunca es lo único.
 * Devuelve null si la meta no tiene nada que decir (sin objetivo, sin fecha y sin plan).
 */
function construirPlanMeta(meta, datos) {
  const r = resumirMeta(datos, meta, hoyIso());
  const lineas = [];
  if (r.objetivo > 0 && r.nivel !== "lograda") {
    if (r.fechaObjetivo) lineas.push(t("Para el {fecha}").replace("{fecha}", formatearFechaLarga(r.fechaObjetivo)));
    if (r.sugerido) {
      lineas.push(t("Para llegar: {semanal} por semana o {mensual} por mes")
        .replace("{semanal}", formatearMonto(r.sugerido.semanal)).replace("{mensual}", formatearMonto(r.sugerido.mensual)));
    }
    if (r.estimada) {
      lineas.push(r.estimada.masDeDiezAnios
        ? t("Al ritmo actual tardarías más de 10 años")
        : t(r.estimada.base === "real" ? "Fecha estimada: {fecha} (según tus aportes de los últimos 90 días)" : "Fecha estimada: {fecha} (según tu aporte programado)")
          .replace("{fecha}", formatearFechaLarga(r.estimada.fecha)));
    }
  }
  if (r.programado) {
    lineas.push(t("Aporte programado: {monto}, {frecuencia}. Es un plan: tú registras el aporte cuando lo haces.")
      .replace("{monto}", formatearMonto(r.programado.monto)).replace("{frecuencia}", t(ETIQUETA_FRECUENCIA[r.programado.frecuencia]).toLowerCase()));
  }
  const conEstado = r.objetivo > 0 && r.fechaObjetivo && r.nivel !== "lograda";
  if (!lineas.length && !conEstado) return null;
  const bloque = document.createElement("div");
  bloque.className = "stack meta-plan";
  bloque.style.gap = "4px";
  if (conEstado) {
    const nivel = document.createElement("div");
    nivel.className = "meta-plan-nivel";
    nivel.style.fontWeight = "600";
    nivel.textContent = t(r.texto);
    bloque.appendChild(nivel);
    if (r.ayuda) lineas.unshift(t(r.ayuda));
  }
  lineas.forEach((x) => { const p = document.createElement("p"); p.className = "muted"; p.style.cssText = "margin:0; font-size:0.85rem;"; p.textContent = x; bloque.appendChild(p); });
  return bloque;
}

function marcarMetaCambiada(meta) {
  sellarTimestamp(meta);
  marcarCambioPendiente();
}

function tieneMovimientos(meta) {
  return (estado.datos.movimientos || []).some((m) => m.meta_id === meta.id || m.pagado_con_meta_id === meta.id);
}

function crearCampo(etiqueta, input) {
  const caja = document.createElement("label");
  caja.className = "stack";
  caja.style.gap = "4px";
  const span = document.createElement("span");
  span.className = "form-label";
  span.textContent = t(etiqueta);
  caja.append(span, input);
  return caja;
}

function crearInput(tipo, valor, placeholder) {
  const input = document.createElement("input");
  input.type = tipo;
  input.className = "form-input";
  input.value = valor;
  if (placeholder) input.placeholder = placeholder;
  if (tipo === "number") { input.min = "0"; input.step = "any"; input.inputMode = "decimal"; }
  return input;
}

/** Formulario en línea para crear o editar. `meta` null = nueva. */
function construirFormularioMeta(meta, alTerminar) {
  const form = document.createElement("div");
  form.className = "glass-card stack";

  const nombre = crearInput("text", meta ? meta.nombre : "", t("Ej. Laptop, viaje, fondo de emergencia"));
  const emoji = crearInput("text", meta ? meta.emoji || "" : "🎯");
  emoji.maxLength = 4;
  const objetivo = crearInput("number", meta && meta.objetivo ? String(meta.objetivo) : "");
  const inicial = crearInput("number", meta && meta.saldo_inicial ? String(meta.saldo_inicial) : "");
  const fechaObjetivo = crearInput("date", meta && meta.fecha_objetivo ? meta.fecha_objetivo : "");
  const apPrevio = meta && meta.aporte_programado ? meta.aporte_programado : null;
  const apMonto = crearInput("number", apPrevio ? String(apPrevio.monto) : "");
  const apFrecuencia = document.createElement("select");
  apFrecuencia.className = "form-input";
  FRECUENCIAS_APORTE.forEach((f) => { const o = document.createElement("option"); o.value = f; o.textContent = t(ETIQUETA_FRECUENCIA[f]); apFrecuencia.appendChild(o); });
  apFrecuencia.value = apPrevio ? apPrevio.frecuencia : "mensual";
  const apInicio = crearInput("date", apPrevio ? apPrevio.fecha_inicio : hoyIso());
  const apRecordar = document.createElement("input");
  apRecordar.type = "checkbox"; apRecordar.checked = !!(apPrevio && apPrevio.recordar);
  const filaRecordar = document.createElement("label");
  filaRecordar.className = "row"; filaRecordar.style.cssText = "gap:8px; align-items:center;";
  const textoRecordar = document.createElement("span"); textoRecordar.textContent = t("Recordarme en la app cuando toque aportar");
  filaRecordar.append(apRecordar, textoRecordar);
  // Reparto de ingresos (sesión 8): un porcentaje de cada ingreso se propone para esta meta; tú confirmas.
  const reparto = meta && meta.reparto ? meta.reparto : null;
  const repPorcentaje = crearInput("number", reparto ? String(reparto.porcentaje) : "");
  repPorcentaje.max = "100";
  const repOrigen = document.createElement("select");
  repOrigen.className = "form-input";
  ORIGENES_REPARTO.forEach((o) => { const x = document.createElement("option"); x.value = o; x.textContent = t(ETIQUETA_ORIGEN_REPARTO[o]); repOrigen.appendChild(x); });
  repOrigen.value = reparto ? reparto.origen : "todo";
  const detallesPlan = document.createElement("details");
  detallesPlan.open = !!(meta && (meta.fecha_objetivo || apPrevio || meta.reparto));
  const resumenPlan = document.createElement("summary");
  resumenPlan.style.cssText = "cursor:pointer; padding:6px 0;";
  resumenPlan.textContent = t("Fecha y aporte programado (opcional)");
  const cuerpoPlan = document.createElement("div");
  cuerpoPlan.className = "stack";
  const ayudaPlan = document.createElement("p");
  ayudaPlan.className = "muted";
  ayudaPlan.style.cssText = "margin:0; font-size:0.82rem;";
  ayudaPlan.textContent = t("Con una fecha, te digo cuánto aportar. El aporte programado es un plan: no mueve dinero, solo se descuenta de Disponible.");
  cuerpoPlan.append(
    ayudaPlan,
    crearCampo("Fecha objetivo", fechaObjetivo),
    crearCampo("Aporte programado", apMonto),
    crearCampo("Cada cuánto aportas", apFrecuencia),
    crearCampo("Desde cuándo", apInicio),
    filaRecordar,
  );
  const ayudaReparto = document.createElement("p");
  ayudaReparto.className = "muted";
  ayudaReparto.style.cssText = "margin:0; font-size:0.82rem;";
  ayudaReparto.textContent = t("Cuando recibas un ingreso, te propongo separar este porcentaje para la meta. Tú confirmas y puedes cambiar el monto.");
  cuerpoPlan.append(ayudaReparto, crearCampo("Separar de mis ingresos (%)", repPorcentaje), crearCampo("Qué ingresos cuentan", repOrigen));
  detallesPlan.append(resumenPlan, cuerpoPlan);

  // Ideas de 3 meses (sesión 8): solo en una meta nueva. Rellenan nombre, ícono y fecha; la persona cambia lo que quiera.
  const sugeridas = meta ? [] : sugerirMetas(estado.datos, hoyIso());
  let bloqueIdeas = null;
  if (sugeridas.length) {
    bloqueIdeas = document.createElement("div");
    bloqueIdeas.className = "stack";
    bloqueIdeas.style.gap = "6px";
    const textoIdeas = document.createElement("p");
    textoIdeas.className = "muted";
    textoIdeas.style.cssText = "margin:0; font-size:0.82rem;";
    textoIdeas.textContent = t("Ideas para empezar: una meta pequeña a {n} meses suele ser más fácil de lograr.").replace("{n}", String(MESES_SUGERIDOS));
    const chips = document.createElement("div");
    chips.className = "row";
    chips.style.cssText = "flex-wrap:wrap; gap:6px;";
    sugeridas.forEach((sug) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "pill-item"; b.dataset.sugerida = sug.id;
      b.textContent = `${sug.emoji} ${t(sug.nombre)}`;
      b.addEventListener("click", () => {
        nombre.value = t(sug.nombre); emoji.value = sug.emoji; fechaObjetivo.value = sug.fechaObjetivo; detallesPlan.open = true; objetivo.focus();
      });
      chips.appendChild(b);
    });
    bloqueIdeas.append(textoIdeas, chips);
  }

  const fila = document.createElement("div");
  fila.style.cssText = "display:grid; grid-template-columns:72px 1fr; gap:8px;";
  fila.append(crearCampo("Ícono", emoji), crearCampo("Nombre de la meta", nombre));

  const error = document.createElement("p");
  error.className = "muted oculto";
  error.setAttribute("role", "alert");
  error.style.cssText = "margin:0; color:var(--color-danger, #ef4444);";

  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  const cancelar = document.createElement("button");
  cancelar.type = "button"; cancelar.className = "btn btn-secondary"; cancelar.textContent = t("Cancelar");
  cancelar.addEventListener("click", () => alTerminar(false));
  const guardar = document.createElement("button");
  guardar.type = "button"; guardar.className = "btn"; guardar.textContent = t("Guardar");
  guardar.addEventListener("click", () => {
    if (!nombre.value.trim()) {
      error.textContent = t("Escribe un nombre para la meta.");
      error.classList.remove("oculto");
      nombre.focus();
      return;
    }
    // Se valida el plan ANTES de tocar la meta (así un error no deja cambios a medias).
    const aporteNuevo = Number(apMonto.value) > 0 ? { monto: apMonto.value, frecuencia: apFrecuencia.value, fechaInicio: apInicio.value || hoyIso(), recordar: apRecordar.checked } : null;
    const plan = {
      fechaObjetivo: fechaObjetivo.value || (meta && meta.fecha_objetivo ? null : undefined),
      aporte: aporteNuevo || (apPrevio ? null : undefined),
    };
    const prueba = { metas: [{ id: "prueba" }] };
    const reglaNueva = Number(repPorcentaje.value) > 0 ? { porcentaje: repPorcentaje.value, origen: repOrigen.value } : null;
    const chequeoReparto = reglaNueva ? configurarReparto(prueba, "prueba", reglaNueva) : { ok: true };
    const chequeo = chequeoReparto.ok ? configurarPlanMeta(prueba, "prueba", plan) : chequeoReparto;
    if (!chequeo.ok) {
      error.textContent = t(TEXTO_MOTIVO[chequeo.motivo] || "Revisa los datos del plan.");
      error.classList.remove("oculto");
      return;
    }
    if (meta) {
      meta.nombre = nombre.value.trim();
      meta.emoji = emoji.value.trim() || "🎯";
      meta.objetivo = Math.max(0, Number(objetivo.value) || 0);
      meta.saldo_inicial = Number(inicial.value) || 0;
      configurarPlanMeta(estado.datos, meta.id, plan);
      if (reglaNueva || meta.reparto) configurarReparto(estado.datos, meta.id, reglaNueva);
      marcarMetaCambiada(meta);
    } else {
      const nueva = crearMeta({ nombre: nombre.value.trim(), emoji: emoji.value.trim(), objetivo: Math.max(0, Number(objetivo.value) || 0), saldoInicial: inicial.value });
      if (!Array.isArray(estado.datos.metas)) estado.datos.metas = [];
      estado.datos.metas.push(nueva);
      configurarPlanMeta(estado.datos, nueva.id, plan);
      if (reglaNueva) configurarReparto(estado.datos, nueva.id, reglaNueva);
      marcarCambioPendiente();
    }
    alTerminar(true);
  });
  botones.append(cancelar, guardar);

  form.append(
    ...(bloqueIdeas ? [bloqueIdeas] : []),
    fila,
    crearCampo("¿Cuánto quieres juntar? (opcional)", objetivo),
    crearCampo("¿Cuánto llevas ya?", inicial),
    detallesPlan,
    error,
    botones,
  );
  setTimeout(() => nombre.focus(), 0);
  return form;
}

function eliminarMeta(meta) {
  estado.datos.metas = (estado.datos.metas || []).filter((m) => m.id !== meta.id);
  if (!Array.isArray(estado.datos._eliminados_metas)) estado.datos._eliminados_metas = [];
  estado.datos._eliminados_metas.push({ id: meta.id, eliminadoEn: Date.now() });
  marcarCambioPendiente();
}

function construirTarjetaMeta(meta, repintar, alEditar) {
  const tarjeta = document.createElement("article");
  tarjeta.className = "glass-card stack meta-tarjeta" + (meta.archivada ? " meta-archivada" : "");

  const fila = document.createElement("div");
  fila.className = "meta-fila";
  fila.append(construirAnilloMeta(meta, estado.datos), construirTextoMeta(meta, estado.datos));
  tarjeta.appendChild(fila);
  const plan = construirPlanMeta(meta, estado.datos);
  if (plan) tarjeta.appendChild(plan);

  const acciones = document.createElement("div");
  acciones.className = "row meta-acciones";
  const boton = (texto, onClick, clase = "btn btn-secondary") => {
    const b = document.createElement("button");
    b.type = "button"; b.className = clase; b.textContent = texto;
    b.addEventListener("click", onClick);
    acciones.appendChild(b);
  };

  boton(t("Editar"), () => alEditar(meta));
  boton(meta.archivada ? t("Restaurar") : t("Archivar"), () => {
    meta.archivada = !meta.archivada;
    marcarMetaCambiada(meta);
    repintar();
  });
  if (!tieneMovimientos(meta)) {
    boton(t("Eliminar"), () => abrirConfirmacion({
      titulo: t("¿Eliminar esta meta?"),
      mensaje: t("Todavía no tiene movimientos. Se elimina por completo."),
      textoConfirmar: t("Eliminar"),
      claseConfirmar: "btn-danger",
      onConfirmar: () => { eliminarMeta(meta); mostrarToast(t("Meta eliminada")); repintar(); },
    }), "btn btn-danger");
  }
  tarjeta.appendChild(acciones);
  return tarjeta;
}

function renderizarPestanaMetas(contenedor) {
  const repintar = () => { contenedor.innerHTML = ""; renderizarPestanaMetas(contenedor); };
  const metas = (estado.datos.metas || []);
  const activas = metas.filter((m) => !m.archivada);
  const archivadas = metas.filter((m) => m.archivada);
  const deAhorro = (m) => m.tipo !== "gasto";
  const puedeMetaGasto = obtenerModulosFinanzas(estado.datos).gastos;

  const alTerminar = (guardo) => { if (guardo) mostrarToast(t("Meta guardada")); repintar(); };
  // Cada meta se edita con el formulario de su tipo (ahorro o gasto).
  const alEditar = (meta) => {
    contenedor.innerHTML = "";
    contenedor.appendChild(meta && meta.tipo === "gasto" ? construirFormularioMetaGasto(meta, alTerminar) : construirFormularioMeta(meta, alTerminar));
  };
  const tarjeta = (m) => (m.tipo === "gasto" ? construirTarjetaMetaGasto(m, repintar, alEditar) : construirTarjetaMeta(m, repintar, alEditar));

  const nueva = document.createElement("button");
  nueva.type = "button"; nueva.className = "btn btn-block"; nueva.textContent = "＋ " + t("Nueva meta");
  nueva.addEventListener("click", () => alEditar(null));
  contenedor.appendChild(nueva);
  if (puedeMetaGasto) {
    const nuevaGasto = document.createElement("button");
    nuevaGasto.type = "button"; nuevaGasto.className = "btn btn-secondary btn-block"; nuevaGasto.textContent = "＋ " + t("Nueva meta de gasto");
    nuevaGasto.addEventListener("click", () => { contenedor.innerHTML = ""; contenedor.appendChild(construirFormularioMetaGasto(null, alTerminar)); });
    contenedor.appendChild(nuevaGasto);
  }

  if (!activas.length) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = t("Aún no tienes metas. Crea una para ver tu avance en un anillo.");
    contenedor.appendChild(vacio);
  }
  activas.filter(deAhorro).forEach((m) => contenedor.appendChild(tarjeta(m)));

  const gastoActivas = activas.filter((m) => !deAhorro(m));
  if (gastoActivas.length) {
    const h = document.createElement("h3");
    h.className = "texto-encabezado-seccion"; h.style.margin = "8px 0 0";
    h.textContent = t("Metas de gasto");
    contenedor.appendChild(h);
    gastoActivas.forEach((m) => contenedor.appendChild(tarjeta(m)));
  }

  if (archivadas.length) {
    const det = document.createElement("details");
    det.className = "stack";
    const sum = document.createElement("summary");
    sum.className = "muted";
    sum.textContent = t("Archivadas ({n})").replace("{n}", String(archivadas.length));
    det.appendChild(sum);
    archivadas.forEach((m) => det.appendChild(tarjeta(m)));
    contenedor.appendChild(det);
  }
}

export { construirAnilloMeta, construirPlanMeta, construirTextoMeta, renderizarPestanaMetas, resumenMeta };
