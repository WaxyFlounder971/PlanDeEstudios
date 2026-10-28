/* =========================================================================
   FINANZAS 2.0: piezas de pantalla compartidas por Datos (importar y exportar) y Mensajes del banco (sesión 6).
   Sin innerHTML. Cada capa tiene su propio id para poder abrir una encima de otra (por ejemplo el editor de patrones
   sobre "Pegar mensaje") sin perder lo que hay debajo.
   ========================================================================= */

import { traducirTextoInterfaz as t } from "../core/i18n.js";

const boton = (texto, clase, onClick) => { const b = document.createElement("button"); b.type = "button"; b.className = clase; b.textContent = texto; b.addEventListener("click", onClick); return b; };

const campo = (etiqueta, control, ayuda) => {
  const c = document.createElement("label"); c.className = "stack"; c.style.gap = "4px";
  const s = document.createElement("span"); s.className = "form-label"; s.textContent = t(etiqueta); c.append(s, control);
  if (ayuda) { const p = document.createElement("span"); p.className = "muted"; p.style.fontSize = "0.78rem"; p.textContent = t(ayuda); c.appendChild(p); }
  return c;
};

const entrada = (valor = "", placeholder = "", max = 0, tipo = "text") => {
  const i = document.createElement("input"); i.type = tipo; i.className = "form-input"; i.value = valor; if (placeholder) i.placeholder = placeholder; if (max) i.maxLength = max; i.autocomplete = "off"; return i;
};

const areaTexto = (valor = "", placeholder = "", filas = 5, max = 0) => {
  const a = document.createElement("textarea"); a.className = "form-input"; a.rows = filas; a.value = valor; if (placeholder) a.placeholder = placeholder; if (max) a.maxLength = max; a.style.resize = "vertical"; return a;
};

/** <select> con pares [valor, texto]. */
const selector = (opciones, valor) => {
  const s = document.createElement("select"); s.className = "form-input";
  opciones.forEach(([v, x]) => { const o = document.createElement("option"); o.value = v; o.textContent = t(x); s.appendChild(o); });
  if (valor !== undefined) s.value = valor;
  return s;
};

const parrafo = (texto, { claseExtra = "muted", tamano = "0.85rem" } = {}) => {
  const p = document.createElement("p"); p.className = claseExtra; p.style.cssText = `margin:0; font-size:${tamano};`; p.textContent = t(texto); return p;
};

const lineaError = () => {
  const p = document.createElement("p"); p.className = "muted oculto"; p.setAttribute("role", "alert");
  p.style.cssText = "margin:0; color:var(--danger, var(--color-danger, #ef4444));"; return p;
};
const mostrar = (linea, texto) => { linea.textContent = t(texto); linea.classList.remove("oculto"); };

/** Insignia con glifo y texto (nunca solo color). `tipo`: success | warning | danger | info. */
function insignia(texto, tipo = "info") {
  const s = document.createElement("span"); s.className = "badge badge-" + tipo; s.textContent = texto; return s;
}

/**
 * Capa modal con Escape y clic fuera. `id` distinto por capa; Escape solo cierra la de más arriba.
 * Devuelve { caja, cerrar }.
 */
function abrirCapaNombrada(id, titulo, { ancho = 480, z = 310 } = {}) {
  const previa = document.getElementById(id); if (previa) previa.remove();
  const overlay = document.createElement("div"); overlay.id = id; overlay.className = "modal-overlay";
  overlay.style.cssText = `position:fixed; inset:0; z-index:${z}; display:flex; align-items:center; justify-content:center; padding:16px;`;
  const caja = document.createElement("div"); caja.className = "glass-card stack"; caja.setAttribute("role", "dialog"); caja.setAttribute("aria-modal", "true");
  caja.style.cssText = `max-width:${ancho}px; width:100%; padding:18px; max-height:90vh; overflow-y:auto;`;
  caja.addEventListener("click", (e) => e.stopPropagation());
  const h2 = document.createElement("h2"); h2.style.margin = "0"; h2.id = id + "-titulo"; h2.textContent = t(titulo);
  caja.setAttribute("aria-labelledby", h2.id); caja.appendChild(h2);
  const alTeclear = (e) => {
    if (e.key !== "Escape") return;
    const capas = document.querySelectorAll(".modal-overlay");
    if (capas[capas.length - 1] === overlay) cerrar();
  };
  const cerrar = () => { document.removeEventListener("keydown", alTeclear); overlay.remove(); };
  document.addEventListener("keydown", alTeclear); overlay.addEventListener("click", cerrar);
  overlay.appendChild(caja); document.body.appendChild(overlay);
  return { caja, cerrar };
}

/** Fila de dos botones iguales (Cancelar y la acción). */
function filaBotones(...botones) {
  const f = document.createElement("div"); f.className = "row";
  f.style.cssText = `display:grid; grid-template-columns:repeat(${botones.length}, 1fr); gap:8px;`;
  f.append(...botones); return f;
}

export { abrirCapaNombrada, areaTexto, boton, campo, entrada, filaBotones, insignia, lineaError, mostrar, parrafo, selector };
