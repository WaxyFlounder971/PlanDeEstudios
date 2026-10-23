/* =========================================================================
   FINANZAS 2.0 — Pestaña Metas con anillos (etapa 0C)
   Cada meta muestra un anillo de avance + el texto al lado (nunca solo
   color). El saldo SIEMPRE se deriva (calcularSaldoMeta); aquí no se guarda
   ningún número. Una meta con movimientos no se borra: se archiva.
   ========================================================================= */

import { crearMeta } from "../core/finanzas-modelo.js";
import { calcularSaldoMeta } from "../core/finanzas-derivados.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { formatearMonto } from "./finanzas.js";

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
    if (meta) {
      meta.nombre = nombre.value.trim();
      meta.emoji = emoji.value.trim() || "🎯";
      meta.objetivo = Math.max(0, Number(objetivo.value) || 0);
      meta.saldo_inicial = Number(inicial.value) || 0;
      marcarMetaCambiada(meta);
    } else {
      const nueva = crearMeta({ nombre: nombre.value.trim(), emoji: emoji.value.trim(), objetivo: Math.max(0, Number(objetivo.value) || 0), saldoInicial: inicial.value });
      if (!Array.isArray(estado.datos.metas)) estado.datos.metas = [];
      estado.datos.metas.push(nueva);
      marcarCambioPendiente();
    }
    alTerminar(true);
  });
  botones.append(cancelar, guardar);

  form.append(
    fila,
    crearCampo("¿Cuánto quieres juntar? (opcional)", objetivo),
    crearCampo("¿Cuánto llevas ya?", inicial),
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

  const alTerminar = (guardo) => { if (guardo) mostrarToast(t("Meta guardada")); repintar(); };
  const alEditar = (meta) => {
    contenedor.innerHTML = "";
    contenedor.appendChild(construirFormularioMeta(meta, alTerminar));
  };

  const nueva = document.createElement("button");
  nueva.type = "button"; nueva.className = "btn btn-block"; nueva.textContent = "＋ " + t("Nueva meta");
  nueva.addEventListener("click", () => alEditar(null));
  contenedor.appendChild(nueva);

  if (!activas.length) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = t("Aún no tienes metas. Crea una para ver tu avance en un anillo.");
    contenedor.appendChild(vacio);
  }
  activas.forEach((m) => contenedor.appendChild(construirTarjetaMeta(m, repintar, alEditar)));

  if (archivadas.length) {
    const det = document.createElement("details");
    det.className = "stack";
    const sum = document.createElement("summary");
    sum.className = "muted";
    sum.textContent = t("Archivadas ({n})").replace("{n}", String(archivadas.length));
    det.appendChild(sum);
    archivadas.forEach((m) => det.appendChild(construirTarjetaMeta(m, repintar, alEditar)));
    contenedor.appendChild(det);
  }
}

export { construirAnilloMeta, construirTextoMeta, renderizarPestanaMetas, resumenMeta };
