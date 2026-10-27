/* =========================================================================
   FINANZAS 2.0: Metas de gasto (sesión 8). Lógica pura sin DOM.
   Una meta de gasto es un TOPE para un periodo, por ejemplo "no pasar de 50.000 en comida hasta fin de mes".
   Vive en la colección de metas con `tipo: "gasto"`, así sincroniza igual. No guarda ninguna cifra: lo gastado
   se DERIVA de los gastos reales (mismas reglas y mismos filtros que Movimientos y los sobres). Un movimiento
   de gasto cuenta si su categoría está entre las elegidas (o todos los gastos si no se eligió ninguna) y su
   fecha cae dentro del periodo. Tono sin culpa: informa lo que queda y nunca regaña.
   ========================================================================= */

import { crearMeta, hoyIso } from "./finanzas-modelo.js";
import { movimientoVisible, movimientosVigentes, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { ocurrenciasRecurrente, sumarDias } from "./finanzas-disponible.js";
import { buscarCategoria } from "./finanzas-categorias.js";
import { sellarTimestamp } from "./schema.js";

const UMBRAL_CERCA = 0.8;
const MAX_NOMBRE = 40;

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esIso = (x) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || ""));
  if (!m) return false;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return f.getUTCFullYear() === +m[1] && f.getUTCMonth() === +m[2] - 1 && f.getUTCDate() === +m[3];
};
const dias = (iso) => { const [a, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(a, m - 1, d) / 86400000); };

const esMetaGasto = (m) => !!m && m.tipo === "gasto";
const esMetaAhorro = (m) => !!m && m.tipo !== "gasto";

/** Lista de metas de gasto (activas por defecto). */
function listarMetasGasto(datos, { incluirArchivadas = false } = {}) {
  return (datos.metas || []).filter((m) => esMetaGasto(m) && (incluirArchivadas || !m.archivada));
}

/** Valida los datos de una meta de gasto. Motivos: "nombre" | "largo" | "tope" | "inicio" | "fin" | "categoria". */
function validar(datos, { nombre, tope, fechaInicio, fechaFin, categoriaIds }) {
  const n = String(nombre || "").trim();
  if (!n) return { ok: false, motivo: "nombre" };
  if (n.length > MAX_NOMBRE) return { ok: false, motivo: "largo" };
  const valor = redondear(Number(tope));
  if (!(valor > 0)) return { ok: false, motivo: "tope" };
  if (!esIso(fechaInicio)) return { ok: false, motivo: "inicio" };
  if (fechaFin !== null && fechaFin !== undefined && fechaFin !== "" && (!esIso(fechaFin) || fechaFin < fechaInicio)) return { ok: false, motivo: "fin" };
  const ids = Array.isArray(categoriaIds) ? categoriaIds : [];
  for (const id of ids) { const c = buscarCategoria(datos, id); if (!c || c.tipo !== "gasto") return { ok: false, motivo: "categoria" }; }
  return { ok: true, nombre: n, tope: valor, ids: [...new Set(ids)] };
}

/**
 * Crea una meta de gasto. `fechaFin` vacío = sin fecha de término (cuenta desde el inicio hasta hoy).
 * Devuelve { ok:true, meta } o { ok:false, motivo }. El llamador marca el cambio pendiente.
 */
function crearMetaGasto(datos, { nombre, emoji, tope, categoriaIds = [], fechaInicio = hoyIso(), fechaFin = null } = {}) {
  const v = validar(datos, { nombre, tope, fechaInicio, fechaFin, categoriaIds });
  if (!v.ok) return v;
  const meta = crearMeta({ tipo: "gasto", nombre: v.nombre, emoji: emoji || "🧾", objetivo: v.tope, fechaObjetivo: fechaFin || null, fechaInicio, categoriaIds: v.ids });
  if (!Array.isArray(datos.metas)) datos.metas = [];
  datos.metas.push(meta);
  return { ok: true, meta };
}

/** Edita nombre, ícono, tope, categorías y fechas. Valida el resultado completo antes de tocar nada. */
function editarMetaGasto(datos, id, cambios = {}) {
  const meta = (datos.metas || []).find((m) => m.id === id);
  if (!meta) return { ok: false, motivo: "meta" };
  if (!esMetaGasto(meta)) return { ok: false, motivo: "tipo" };
  const siguiente = {
    nombre: cambios.nombre !== undefined ? cambios.nombre : meta.nombre,
    tope: cambios.tope !== undefined ? cambios.tope : meta.objetivo,
    fechaInicio: cambios.fechaInicio !== undefined ? cambios.fechaInicio : meta.fecha_inicio,
    fechaFin: cambios.fechaFin !== undefined ? cambios.fechaFin : meta.fecha_objetivo,
    categoriaIds: cambios.categoriaIds !== undefined ? cambios.categoriaIds : meta.categoria_ids,
  };
  const v = validar(datos, siguiente);
  if (!v.ok) return v;
  meta.nombre = v.nombre; meta.objetivo = v.tope; meta.fecha_inicio = siguiente.fechaInicio;
  meta.fecha_objetivo = siguiente.fechaFin || null; meta.categoria_ids = v.ids;
  if (cambios.emoji !== undefined) meta.emoji = cambios.emoji || "🧾";
  sellarTimestamp(meta);
  return { ok: true, meta };
}

function archivarMetaGasto(datos, id, archivar = true) {
  const meta = (datos.metas || []).find((m) => m.id === id);
  if (!meta || !esMetaGasto(meta)) return { ok: false, motivo: "meta" };
  meta.archivada = !!archivar; sellarTimestamp(meta);
  return { ok: true, meta };
}

/** Una meta de gasto no tiene movimientos propios, así que se puede eliminar de verdad (con tumba para la sincronización). */
function eliminarMetaGasto(datos, id) {
  const meta = (datos.metas || []).find((m) => m.id === id);
  if (!meta || !esMetaGasto(meta)) return { ok: false, motivo: "meta" };
  datos.metas = datos.metas.filter((m) => m.id !== id);
  if (!Array.isArray(datos._eliminados_metas)) datos._eliminados_metas = [];
  if (!datos._eliminados_metas.some((t) => t.id === id)) datos._eliminados_metas.push({ id, eliminadoEn: Date.now() });
  return { ok: true };
}

/** Gastos de la meta en [desde, hasta]: vigentes y visibles, misma regla que los sobres. Recurrentes: una vez por cada día de pago. */
function gastosDeMeta(datos, meta, desde, hasta, hoy) {
  const ids = new Set(meta.categoria_ids || []);
  const todas = ids.size === 0;
  const modulos = obtenerModulosFinanzas(datos);
  const tope = hasta < hoy ? hasta : hoy;
  let suma = 0;
  movimientosVigentes(datos, hoy).forEach((m) => {
    if (m.tipo !== "gasto" || !movimientoVisible(m, modulos)) return;
    if (!todas && !ids.has(m.categoria_id)) return;
    if (m.recurrente) {
      const monto = Number(m.recurrente.monto_por_pago) || 0;
      suma += monto * ocurrenciasRecurrente(m.recurrente, sumarDias(desde, -1), tope).length;
    } else if (m.fecha_registro && m.fecha_registro >= desde && m.fecha_registro <= tope) {
      suma += Number(m.monto) || 0;
    }
  });
  return redondear(suma);
}

/**
 * Todo lo que la pantalla necesita. `nivel` siempre trae texto:
 * futura | bien | cerca | tope | pasado. `terminada` = la fecha final ya pasó.
 */
function resumirMetaGasto(datos, meta, hoy = hoyIso()) {
  const tope = Number(meta.objetivo) || 0;
  const inicio = esIso(meta.fecha_inicio) ? meta.fecha_inicio : hoy;
  const fin = esIso(meta.fecha_objetivo) ? meta.fecha_objetivo : null;
  const empezo = hoy >= inicio;
  const gastado = empezo ? gastosDeMeta(datos, meta, inicio, fin || hoy, hoy) : 0;
  const restante = redondear(Math.max(0, tope - gastado));
  const excedido = redondear(Math.max(0, gastado - tope));
  const proporcion = tope > 0 ? gastado / tope : 0;
  const porcentaje = Math.min(100, Math.round(proporcion * 100));
  const terminada = !!fin && hoy > fin;
  const diasRestantes = fin && !terminada ? Math.max(1, dias(fin) - dias(hoy) + 1) : null;
  const porDia = diasRestantes && restante > 0 && empezo ? redondear(restante / diasRestantes) : null;
  let nivel, texto, ayuda = "";
  if (!empezo) { nivel = "futura"; texto = "Aún no empieza"; }
  else if (gastado > tope) { nivel = "pasado"; texto = "Pasaste el tope"; ayuda = terminada ? "Para la próxima, puedes subir el tope o elegir menos categorías." : "Puedes subir el tope o seguir con calma: tú decides."; }
  else if (gastado === tope && tope > 0) { nivel = "tope"; texto = "Llegaste al tope"; }
  else if (proporcion >= UMBRAL_CERCA) { nivel = "cerca"; texto = "Cerca del tope"; ayuda = "Te queda poco de lo que fijaste."; }
  else { nivel = "bien"; texto = terminada ? "Te quedaste dentro del tope" : "Vas bien"; }
  return { tope, gastado, restante, excedido, porcentaje, proporcion, inicio, fin, terminada, diasRestantes, porDia, nivel, texto, ayuda };
}

export { MAX_NOMBRE, UMBRAL_CERCA, archivarMetaGasto, crearMetaGasto, editarMetaGasto, eliminarMetaGasto, esMetaAhorro, esMetaGasto, gastosDeMeta, listarMetasGasto, resumirMetaGasto };
