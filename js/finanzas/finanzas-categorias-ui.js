/* =========================================================================
   FINANZAS 2.0 — Categorías: pantallas (sesión 5, F4)
   Gestor de categorías (crear, editar, archivar, eliminar), "Categorizar historial" en lote y el selector que usan
   el registro rápido y los sobres. Toda la lógica vive en core/finanzas-categorias.js; aquí solo hay pantalla.
   Sin innerHTML. Lo sin categoría nunca se esconde ni se castiga: es solo "sin clasificar".
   ========================================================================= */

import {
  agruparSinCategoriaPorNombre, archivarCategoriaFinanzas, categorizarEnLote, crearCategoriaFinanzas, editarCategoriaFinanzas,
  eliminarCategoriaFinanzas, listarCategorias, movimientosSinCategoria, sugerirCategoria,
} from "../core/finanzas-categorias.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { formatearMonto } from "./finanzas.js";

const ID_CAPA = "categorias-overlay";
const MOTIVOS = {
  nombre: "Escribe un nombre para la categoría.", largo: "El nombre es muy largo (máximo 30 letras).",
  repetida: "Ya tienes una categoría con ese nombre.", tipo: "Elige si es de gastos o de ingresos.",
  en_uso: "Esta categoría tiene movimientos o sobres. Puedes archivarla y conservarás todo el historial.",
};

/* ===================== Piezas pequeñas ===================== */

const boton = (texto, clase, onClick) => { const b = document.createElement("button"); b.type = "button"; b.className = clase; b.textContent = texto; b.addEventListener("click", onClick); return b; };
const campo = (etiqueta, control) => {
  const c = document.createElement("label"); c.className = "stack"; c.style.gap = "4px";
  const s = document.createElement("span"); s.className = "form-label"; s.textContent = t(etiqueta); c.append(s, control); return c;
};
const entrada = (valor = "", placeholder = "", max = 0) => {
  const i = document.createElement("input"); i.type = "text"; i.className = "form-input"; i.value = valor; if (placeholder) i.placeholder = placeholder; if (max) i.maxLength = max; i.autocomplete = "off"; return i;
};
const lineaError = () => {
  const p = document.createElement("p"); p.className = "muted oculto"; p.setAttribute("role", "alert");
  p.style.cssText = "margin:0; color:var(--danger, var(--color-danger, #ef4444));"; return p;
};
const mostrar = (linea, texto) => { linea.textContent = t(texto); linea.classList.remove("oculto"); };
const guardarCambios = (alCambiar) => { marcarCambioPendiente(); if (alCambiar) alCambiar(); };

/** Capa modal con Escape y clic fuera para cerrar. Una sola a la vez. */
function abrirCapa(titulo) {
  const previa = document.getElementById(ID_CAPA); if (previa) previa.remove();
  const overlay = document.createElement("div"); overlay.id = ID_CAPA; overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed; inset:0; z-index:310; display:flex; align-items:center; justify-content:center; padding:16px;";
  const caja = document.createElement("div"); caja.className = "glass-card stack"; caja.setAttribute("role", "dialog"); caja.setAttribute("aria-modal", "true");
  caja.style.cssText = "max-width:460px; width:100%; padding:18px; max-height:90vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());
  const h2 = document.createElement("h2"); h2.style.margin = "0"; h2.id = ID_CAPA + "-titulo"; h2.textContent = t(titulo); caja.setAttribute("aria-labelledby", h2.id); caja.appendChild(h2);
  const alTeclear = (e) => { if (e.key === "Escape") cerrar(); };
  const cerrar = () => { document.removeEventListener("keydown", alTeclear); overlay.remove(); };
  document.addEventListener("keydown", alTeclear); overlay.addEventListener("click", cerrar); overlay.appendChild(caja); document.body.appendChild(overlay);
  return { caja, cerrar };
}

/**
 * Selector de categoría para un tipo (gasto o ingreso). Siempre incluye "Sin categoría". Si el movimiento ya tiene una
 * categoría archivada, se conserva en la lista para no perderla al editar.
 */
function construirSelectorCategoria({ tipo = "gasto", valor = "" } = {}) {
  const sel = document.createElement("select"); sel.className = "form-input"; sel.setAttribute("aria-label", t("Categoría"));
  const vacia = document.createElement("option"); vacia.value = ""; vacia.textContent = t("Sin categoría"); sel.appendChild(vacia);
  const lista = listarCategorias(estado.datos, { tipo });
  const actual = valor && !lista.some((c) => c.id === valor) ? (estado.datos.categorias_finanzas || []).find((c) => c.id === valor) : null;
  (actual ? [...lista, actual] : lista).forEach((c) => { const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.emoji || "🏷️"} ${c.nombre}${c.archivada ? " (" + t("archivada") + ")" : ""}`; sel.appendChild(o); });
  sel.value = valor && [...sel.options].some((o) => o.value === valor) ? valor : "";
  return sel;
}

/* ===================== Gestor de categorías ===================== */

function abrirGestorCategorias({ alCambiar } = {}) {
  const { caja, cerrar } = abrirCapa("Categorías");
  const lista = document.createElement("div"); lista.className = "stack"; lista.style.gap = "8px";
  const error = lineaError();

  const formNueva = document.createElement("div"); formNueva.className = "stack";
  const nombre = entrada("", t("Ej. Salud, regalos"), 30); const emoji = entrada("🏷️", "", 4); emoji.style.maxWidth = "72px"; emoji.setAttribute("aria-label", t("Emoji"));
  const tipo = document.createElement("select"); tipo.className = "form-input";
  [["gasto", "Gasto"], ["ingreso", "Ingreso"]].forEach(([v, x]) => { const o = document.createElement("option"); o.value = v; o.textContent = t(x); tipo.appendChild(o); });
  const fila = document.createElement("div"); fila.className = "row"; fila.style.cssText = "display:grid; grid-template-columns:72px 1fr 110px; gap:8px; align-items:end;";
  fila.append(campo("Emoji", emoji), campo("Nombre", nombre), campo("Tipo", tipo));
  const agregar = boton(t("Añadir categoría"), "btn btn-primary", () => {
    const r = crearCategoriaFinanzas(estado.datos, { nombre: nombre.value, emoji: emoji.value.trim() || "🏷️", tipo: tipo.value });
    if (!r.ok) { mostrar(error, MOTIVOS[r.motivo] || MOTIVOS.nombre); nombre.focus(); return; }
    error.classList.add("oculto"); nombre.value = ""; guardarCambios(alCambiar); pintar();
  });
  nombre.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); agregar.click(); } });
  formNueva.append(fila, error, agregar);

  function filaCategoria(c) {
    const f = document.createElement("div"); f.className = "row-between"; f.style.cssText = "gap:8px; align-items:center;";
    const nom = document.createElement("span"); nom.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;";
    nom.textContent = `${c.emoji || "🏷️"} ${c.nombre}${c.archivada ? " · " + t("archivada") : ""}`;
    if (c.archivada) nom.classList.add("muted");
    const acciones = document.createElement("div"); acciones.className = "row"; acciones.style.gap = "6px";
    acciones.append(
      boton(t("Renombrar"), "btn btn-secondary", () => {
        const input = entrada(c.nombre, "", 30); input.setAttribute("aria-label", t("Nuevo nombre")); input.style.flex = "1";
        const guardarNombre = () => {
          const r = editarCategoriaFinanzas(estado.datos, c.id, { nombre: input.value }); if (!r.ok) { mostrar(error, MOTIVOS[r.motivo] || MOTIVOS.nombre); input.focus(); return; }
          error.classList.add("oculto"); guardarCambios(alCambiar); pintar();
        };
        input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardarNombre(); } if (e.key === "Escape") { e.stopPropagation(); pintar(); } });
        f.replaceChildren(input, boton(t("Guardar"), "btn btn-primary", guardarNombre), boton(t("Cancelar"), "btn btn-secondary", pintar)); input.focus();
      }),
      boton(t(c.archivada ? "Mostrar" : "Archivar"), "btn btn-secondary", () => {
        const r = archivarCategoriaFinanzas(estado.datos, c.id, !c.archivada); if (!r.ok) { mostrar(error, MOTIVOS[r.motivo] || MOTIVOS.repetida); return; }
        error.classList.add("oculto"); guardarCambios(alCambiar); pintar();
      }),
      boton(t("Eliminar"), "btn btn-secondary", () => {
        const r = eliminarCategoriaFinanzas(estado.datos, c.id); if (!r.ok) { mostrar(error, MOTIVOS[r.motivo] || MOTIVOS.en_uso); return; }
        error.classList.add("oculto"); guardarCambios(alCambiar); pintar();
      }),
    );
    f.append(nom, acciones); return f;
  }

  function pintar() {
    lista.replaceChildren();
    const todas = listarCategorias(estado.datos, { incluirArchivadas: true });
    [["gasto", "De gastos"], ["ingreso", "De ingresos"]].forEach(([tp, titulo]) => {
      const grupo = todas.filter((c) => c.tipo === tp); if (!grupo.length) return;
      const h = document.createElement("h3"); h.className = "muted"; h.style.cssText = "margin:6px 0 0; font-size:0.85rem;"; h.textContent = t(titulo); lista.appendChild(h);
      grupo.forEach((c) => lista.appendChild(filaCategoria(c)));
    });
    if (!todas.length) { const p = document.createElement("p"); p.className = "muted"; p.textContent = t("Aún no tienes categorías. Crea la primera abajo."); lista.appendChild(p); }
  }
  pintar();
  caja.append(lista, formNueva, boton(t("Cerrar"), "btn btn-secondary", cerrar));
}

/* ===================== Categorizar historial en lote ===================== */

/**
 * Lo sin categoría, agrupado por nombre: "Pasaje" ×14 se clasifica con un toque. Cada grupo trae ya elegida la
 * categoría que la persona usó antes con ese nombre (si hay una clara); se puede cambiar o dejar sin clasificar.
 * Solo se escribe la categoría: monto, fecha y tipo no se tocan, y lo que ya estaba clasificado no se pisa.
 */
function abrirCategorizarHistorial({ alCambiar } = {}) {
  const { caja, cerrar } = abrirCapa("Categorizar historial");
  const intro = document.createElement("p"); intro.className = "muted"; intro.style.margin = "0";
  intro.textContent = t("Elige una categoría para cada nombre y se aplica a todos los movimientos que lo comparten. No cambia montos ni fechas.");
  const lista = document.createElement("div"); lista.className = "stack"; lista.style.gap = "10px";

  function pintar() {
    lista.replaceChildren();
    const grupos = agruparSinCategoriaPorNombre(estado.datos);
    if (!grupos.length) { const p = document.createElement("p"); p.textContent = t("Todo está clasificado. No queda nada por categorizar."); lista.appendChild(p); return; }
    grupos.slice(0, 40).forEach((g) => {
      const tarjeta = document.createElement("div"); tarjeta.className = "stack"; tarjeta.style.cssText = "gap:6px; padding-bottom:8px; border-bottom:1px solid var(--border-glass);";
      const titulo = document.createElement("div"); titulo.className = "row-between";
      const nom = document.createElement("strong"); nom.textContent = g.nombre;
      const meta = document.createElement("span"); meta.className = "muted";
      meta.textContent = `${g.ids.length} ${t(g.ids.length === 1 ? "movimiento" : "movimientos")} · ${formatearMonto(g.total)}`;
      titulo.append(nom, meta);
      const sugerida = sugerirCategoria(estado.datos, g.nombre, g.tipo);
      const sel = construirSelectorCategoria({ tipo: g.tipo, valor: sugerida ? sugerida.categoriaId : "" });
      const aplicar = boton(t("Aplicar"), "btn btn-primary", () => {
        if (!sel.value) { mostrarToast(t("Elige una categoría primero.")); sel.focus(); return; }
        const r = categorizarEnLote(estado.datos, g.ids.map((id) => ({ movimientoId: id, categoriaId: sel.value })));
        if (r.aplicados) guardarCambios(alCambiar);
        mostrarToast(`${r.aplicados} ${t(r.aplicados === 1 ? "movimiento clasificado" : "movimientos clasificados")}`);
        pintar();
      });
      const fila = document.createElement("div"); fila.className = "row"; fila.style.cssText = "display:grid; grid-template-columns:1fr auto; gap:8px;"; fila.append(sel, aplicar);
      tarjeta.append(titulo, fila);
      if (sugerida) { const a = document.createElement("span"); a.className = "muted"; a.style.fontSize = "0.78rem"; a.textContent = t("Sugerida por cómo la clasificaste antes."); tarjeta.appendChild(a); }
      lista.appendChild(tarjeta);
    });
    if (grupos.length > 40) { const p = document.createElement("p"); p.className = "muted"; p.textContent = `${t("Hay más nombres. Clasifica estos y vuelve a abrir esta pantalla.")}`; lista.appendChild(p); }
  }
  pintar();
  caja.append(intro, lista, boton(t("Cerrar"), "btn btn-secondary", cerrar));
}

/** Cuántos movimientos siguen sin categoría (para el aviso del botón). */
const contarSinCategoria = () => movimientosSinCategoria(estado.datos).length;

/** Piezas compartidas con la pantalla de Presupuesto, para no repetirlas. */
const ayudasUi = { abrirCapa, boton, campo, entrada, lineaError, mostrar, guardarCambios };

export { abrirCategorizarHistorial, abrirGestorCategorias, ayudasUi, construirSelectorCategoria, contarSinCategoria };
