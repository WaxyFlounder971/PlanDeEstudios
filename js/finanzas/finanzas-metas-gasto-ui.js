/* =========================================================================
   FINANZAS 2.0: Metas de gasto, pantalla (sesión 8). Tarjeta con anillo que se LLENA a medida que gastas
   (siempre con texto: cuánto queda, cuánto por día, nunca solo color) y formulario para crear o editar.
   Todo se deriva de core/finanzas-metas-gasto.js: aquí no se guarda ninguna cifra.
   ========================================================================= */

import { listarCategorias } from "../core/finanzas-categorias.js";
import { archivarMetaGasto, crearMetaGasto, editarMetaGasto, eliminarMetaGasto, resumirMetaGasto } from "../core/finanzas-metas-gasto.js";
import { hoyIso } from "../core/finanzas-modelo.js";
import { parsearMontoTexto } from "../core/finanzas-texto.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const TEXTO_MOTIVO = {
  nombre: "Escribe un nombre para la meta.",
  largo: "El nombre es muy largo (máximo 40 letras).",
  tope: "El tope tiene que ser mayor a cero.",
  inicio: "La fecha de inicio no es válida.",
  fin: "La fecha final tiene que ser válida y no anterior al inicio.",
  categoria: "Una de las categorías ya no está disponible.",
};

function anillo(r, nombre, tam = 88) {
  const RADIO = 38, CIRC = 2 * Math.PI * RADIO;
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 100 100"); svg.setAttribute("width", String(tam)); svg.setAttribute("height", String(tam));
  svg.setAttribute("class", "meta-anillo-svg"); svg.setAttribute("role", "img"); svg.setAttribute("aria-label", `${nombre}: ${r.porcentaje}%`);
  const circulo = (clase, extra) => {
    const c = document.createElementNS(SVG_NS, "circle");
    c.setAttribute("cx", "50"); c.setAttribute("cy", "50"); c.setAttribute("r", String(RADIO)); c.setAttribute("fill", "none"); c.setAttribute("class", clase);
    Object.entries(extra || {}).forEach(([k, v]) => c.setAttribute(k, v)); return c;
  };
  svg.appendChild(circulo("meta-anillo-pista"));
  if (r.proporcion > 0) { const largo = Math.min(1, r.proporcion) * CIRC; svg.appendChild(circulo("meta-anillo-arco", { "stroke-dasharray": `${largo} ${CIRC - largo}`, transform: "rotate(-90 50 50)" })); }
  const caja = document.createElement("div"); caja.className = "meta-anillo"; caja.style.cssText = `width:${tam}px; height:${tam}px;`;
  const centro = document.createElement("span"); centro.className = "meta-anillo-centro"; centro.textContent = `${r.porcentaje}%`;
  caja.append(svg, centro); return caja;
}

/** Tarjeta de una meta de gasto: anillo, montos, estado con texto y, si hay fecha final, cuánto puedes gastar por día. */
function construirTarjetaMetaGasto(meta, repintar, alEditar) {
  const r = resumirMetaGasto(estado.datos, meta, hoyIso());
  const tarjeta = document.createElement("article");
  tarjeta.className = "glass-card stack meta-tarjeta" + (meta.archivada ? " meta-archivada" : "");
  tarjeta.setAttribute("data-meta-gasto", meta.id);

  const fila = document.createElement("div"); fila.className = "meta-fila";
  const texto = document.createElement("div"); texto.className = "meta-texto";
  const nombre = document.createElement("div"); nombre.className = "meta-nombre"; nombre.textContent = `${meta.emoji || "🧾"} ${meta.nombre || t("Meta sin nombre")}`;
  const montos = document.createElement("div"); montos.className = "meta-montos";
  montos.textContent = t("{gastado} de {tope}").replace("{gastado}", formatearMonto(r.gastado)).replace("{tope}", formatearMonto(r.tope));
  const estadoEl = document.createElement("span");
  estadoEl.className = "badge " + (r.nivel === "pasado" ? "badge-warning" : r.nivel === "bien" ? "badge-success" : "badge-info");
  estadoEl.textContent = t(r.texto);
  texto.append(nombre, montos, estadoEl);
  fila.append(anillo(r, meta.nombre || ""), texto);
  tarjeta.appendChild(fila);

  const lineas = [];
  if (r.nivel === "pasado") lineas.push(t("Pasaste el tope por {monto}.").replace("{monto}", formatearMonto(r.excedido)));
  else if (r.nivel !== "futura") lineas.push(t("Te quedan {monto}.").replace("{monto}", formatearMonto(r.restante)));
  if (r.ayuda) lineas.push(t(r.ayuda));
  if (r.nivel === "futura") lineas.push(t("Empieza el {fecha}.").replace("{fecha}", formatearFechaLarga(r.inicio)));
  else if (r.fin) lineas.push(r.terminada ? t("Terminó el {fecha}.").replace("{fecha}", formatearFechaLarga(r.fin)) : t("Hasta el {fecha}.").replace("{fecha}", formatearFechaLarga(r.fin)));
  if (r.porDia) lineas.push(t("Puedes gastar unos {monto} por día.").replace("{monto}", formatearMonto(r.porDia)));
  const cats = (meta.categoria_ids || []).map((id) => (estado.datos.categorias_finanzas || []).find((c) => c.id === id)).filter(Boolean);
  lineas.push(cats.length ? `${t("Cuenta")}: ${cats.map((c) => `${c.emoji || "🏷️"} ${c.nombre}`).join(", ")}` : t("Cuenta todos tus gastos."));
  const bloque = document.createElement("div"); bloque.className = "stack meta-plan"; bloque.style.gap = "4px";
  lineas.forEach((x) => { const p = document.createElement("p"); p.className = "muted"; p.style.cssText = "margin:0; font-size:0.85rem;"; p.textContent = x; bloque.appendChild(p); });
  tarjeta.appendChild(bloque);

  const acciones = document.createElement("div"); acciones.className = "row meta-acciones";
  const boton = (txt, onClick, clase = "btn btn-secondary") => { const b = document.createElement("button"); b.type = "button"; b.className = clase; b.textContent = txt; b.addEventListener("click", onClick); acciones.appendChild(b); };
  boton(t("Editar"), () => alEditar(meta));
  boton(meta.archivada ? t("Restaurar") : t("Archivar"), () => { archivarMetaGasto(estado.datos, meta.id, !meta.archivada); marcarCambioPendiente(); repintar(); });
  boton(t("Eliminar"), () => abrirConfirmacion({
    titulo: t("¿Eliminar esta meta?"), mensaje: t("Tus gastos no se tocan: solo se quita la meta."), textoConfirmar: t("Eliminar"), claseConfirmar: "btn-danger",
    onConfirmar: () => { eliminarMetaGasto(estado.datos, meta.id); marcarCambioPendiente(); mostrarToast(t("Meta eliminada")); repintar(); },
  }), "btn btn-danger");
  tarjeta.appendChild(acciones);
  return tarjeta;
}

const campoEtiquetado = (etiqueta, control) => {
  const c = document.createElement("label"); c.className = "stack"; c.style.gap = "4px";
  const s = document.createElement("span"); s.className = "form-label"; s.textContent = t(etiqueta); c.append(s, control); return c;
};
const entrada = (tipo, valor = "", placeholder = "") => {
  const i = document.createElement("input"); i.type = tipo; i.className = "form-input"; i.value = valor; if (placeholder) i.placeholder = placeholder;
  if (tipo === "number") { i.min = "0"; i.step = "any"; i.inputMode = "decimal"; } return i;
};

/** Formulario de una meta de gasto. `meta` null = nueva. Sin categorías elegidas cuenta todos los gastos. */
function construirFormularioMetaGasto(meta, alTerminar) {
  const form = document.createElement("div"); form.className = "glass-card stack";
  const titulo = document.createElement("h3"); titulo.className = "texto-encabezado-seccion"; titulo.style.margin = "0";
  titulo.textContent = t(meta ? "Editar meta de gasto" : "Nueva meta de gasto"); form.appendChild(titulo);
  const ayuda = document.createElement("p"); ayuda.className = "muted"; ayuda.style.cssText = "margin:0; font-size:0.82rem;";
  ayuda.textContent = t("Fija un tope para un periodo y mira cuánto llevas. Es un registro propio: no bloquea ningún gasto."); form.appendChild(ayuda);

  const nombre = entrada("text", meta ? meta.nombre : "", t("Ej. Comida del mes"));
  const emoji = entrada("text", meta ? meta.emoji || "🧾" : "🧾"); emoji.maxLength = 4;
  const tope = entrada("number", meta && meta.objetivo ? String(meta.objetivo) : "");
  const desde = entrada("date", meta && meta.fecha_inicio ? meta.fecha_inicio : hoyIso());
  const hasta = entrada("date", meta && meta.fecha_objetivo ? meta.fecha_objetivo : "");
  const fila = document.createElement("div"); fila.style.cssText = "display:grid; grid-template-columns:72px 1fr; gap:8px;";
  fila.append(campoEtiquetado("Ícono", emoji), campoEtiquetado("Nombre de la meta", nombre));

  // Categorías: casillas. Una categoría archivada que la meta ya usa se conserva para no perderla al editar.
  const elegidas = new Set(meta ? meta.categoria_ids || [] : []);
  const disponibles = listarCategorias(estado.datos, { tipo: "gasto" });
  const archivadasUsadas = (estado.datos.categorias_finanzas || []).filter((c) => c.tipo === "gasto" && c.archivada && elegidas.has(c.id));
  const grupo = document.createElement("div"); grupo.className = "stack"; grupo.style.gap = "6px";
  const cajas = [...disponibles, ...archivadasUsadas].map((c) => {
    const l = document.createElement("label"); l.className = "row"; l.style.cssText = "gap:8px; align-items:center;";
    const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = elegidas.has(c.id); chk.value = c.id;
    const sp = document.createElement("span"); sp.textContent = `${c.emoji || "🏷️"} ${c.nombre}${c.archivada ? " · " + t("archivada") : ""}`;
    l.append(chk, sp); grupo.appendChild(l); return chk;
  });
  const bloqueCats = document.createElement("div"); bloqueCats.className = "stack"; bloqueCats.style.gap = "4px";
  const etCats = document.createElement("span"); etCats.className = "form-label"; etCats.textContent = t("Qué gastos cuentan");
  const notaCats = document.createElement("span"); notaCats.className = "muted"; notaCats.style.fontSize = "0.78rem";
  notaCats.textContent = t(cajas.length ? "Si no marcas ninguna, cuentan todos tus gastos." : "Aún no tienes categorías de gasto: la meta contará todos tus gastos.");
  bloqueCats.append(etCats, notaCats, grupo);

  const error = document.createElement("p"); error.className = "muted oculto"; error.setAttribute("role", "alert");
  error.style.cssText = "margin:0; color:var(--color-danger, #ef4444);";
  const botones = document.createElement("div"); botones.className = "row"; botones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  const cancelar = document.createElement("button"); cancelar.type = "button"; cancelar.className = "btn btn-secondary"; cancelar.textContent = t("Cancelar");
  cancelar.addEventListener("click", () => alTerminar(false));
  const guardar = document.createElement("button"); guardar.type = "button"; guardar.className = "btn"; guardar.textContent = t("Guardar");
  guardar.addEventListener("click", () => {
    const datos = { nombre: nombre.value, emoji: emoji.value.trim(), tope: parsearMontoTexto(tope.value), categoriaIds: cajas.filter((c) => c.checked).map((c) => c.value), fechaInicio: desde.value || hoyIso(), fechaFin: hasta.value || null };
    const r = meta ? editarMetaGasto(estado.datos, meta.id, datos) : crearMetaGasto(estado.datos, datos);
    if (!r.ok) { error.textContent = t(TEXTO_MOTIVO[r.motivo] || "Revisa los datos de la meta."); error.classList.remove("oculto"); return; }
    marcarCambioPendiente(); alTerminar(true);
  });
  botones.append(cancelar, guardar);
  form.append(fila, campoEtiquetado("Tope de gasto", tope), bloqueCats, campoEtiquetado("Desde", desde), campoEtiquetado("Hasta (opcional)", hasta), error, botones);
  setTimeout(() => nombre.focus(), 0);
  return form;
}

export { construirFormularioMetaGasto, construirTarjetaMetaGasto };
