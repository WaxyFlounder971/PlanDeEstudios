/* =========================================================================
   FINANZAS 2.0: Categorías (sesión 5, F4), lógica pura sin DOM.
   - Juego básico editable (comida, transporte, estudios, ocio): se crea una vez,
     la persona lo edita, oculta (archiva) o reemplaza.
   - Archivar conserva el historial: el movimiento sigue apuntando a la categoría.
   - Categorizar en lote: solo asigna `categoria_id`, nunca cambia monto, fecha ni tipo.
   - Sugerencia por nombre ya usado. Nada se guarda como contador.
   Colección nueva: datos.categorias_finanzas, con tombstones en datos._eliminados_categorias_finanzas.
   ========================================================================= */

import { movimientosVigentes } from "./finanzas-derivados.js";
import { sellarTimestamp } from "../schema.js";

const TIPOS_CATEGORIA = ["gasto", "ingreso"];
/** Marca opcional de una categoría de gasto. La clave solo existe cuando se elige: las categorías de siempre no cambian de forma. */
const PRIORIDADES_CATEGORIA = ["esencial", "flexible"];
const JUEGO_BASICO = [
  { id: "cat_comida", nombre: "Comida", emoji: "🍽️", color: "#e8a33d", tipo: "gasto" },
  { id: "cat_transporte", nombre: "Transporte", emoji: "🚌", color: "#4c8bf5", tipo: "gasto" },
  { id: "cat_estudios", nombre: "Estudios", emoji: "📚", color: "#8e6bd8", tipo: "gasto" },
  { id: "cat_ocio", nombre: "Ocio", emoji: "🎬", color: "#e2607a", tipo: "gasto" },
];

const normalizar = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const nuevoId = () => "cat_" + crypto.randomUUID(); // misma convención que mov_, meta_ y cmp_

/** Lista de categorías vigentes (no eliminadas). `incluirArchivadas` para la pantalla de edición. */
function listarCategorias(datos, { tipo, incluirArchivadas = false } = {}) {
  return (datos.categorias_finanzas || []).filter((c) => (incluirArchivadas || !c.archivada) && (!tipo || c.tipo === tipo));
}
const buscarCategoria = (datos, id) => (datos.categorias_finanzas || []).find((c) => c.id === id) || null;

const FLAG_MIGRACION_CATEGORIAS = "migracion_finanzas2_categorias_v1";

/**
 * Crea el juego básico UNA sola vez. Idempotente y no destructiva: correrlo dos veces no cambia nada, no vuelve a
 * crear una categoría que la persona borró (su tumba lo impide) y no toca ningún movimiento.
 * Las categorías del juego llevan ids fijos y sello neutro (0), igual que la migración de movimientos: dos
 * dispositivos que siembren por separado producen registros idénticos y la fusión no inventa conflictos.
 * Cualquier edición real posterior sella con un contador mayor y gana.
 */
function sembrarCategoriasBasicas(datos) {
  if (!Array.isArray(datos.categorias_finanzas)) datos.categorias_finanzas = [];
  if (!Array.isArray(datos._eliminados_categorias_finanzas)) datos._eliminados_categorias_finanzas = [];
  if (!datos.configuracion) datos.configuracion = {};
  if (datos.configuracion[FLAG_MIGRACION_CATEGORIAS] === true) return { creadas: 0 };
  const existentes = new Set(datos.categorias_finanzas.map((c) => c.id));
  datos._eliminados_categorias_finanzas.forEach((t) => existentes.add(t.id));
  let creadas = 0;
  JUEGO_BASICO.forEach((c) => {
    if (existentes.has(c.id)) return;
    datos.categorias_finanzas.push({ ...c, archivada: false, _actualizadoEn: 0 });
    creadas++;
  });
  datos.configuracion[FLAG_MIGRACION_CATEGORIAS] = true; // sin sellar a propósito: todos los dispositivos rellenan lo mismo
  return { creadas };
}

/** Punto de entrada de la migración (lo llama schema.js al normalizar los datos): colecciones nuevas + juego básico + flag. */
function migrarCategoriasV1(datos) {
  if (!datos) return 0;
  if (!Array.isArray(datos.sobres)) datos.sobres = [];
  if (!Array.isArray(datos._eliminados_sobres)) datos._eliminados_sobres = [];
  return sembrarCategoriasBasicas(datos).creadas;
}

/** Valida nombre (único por tipo, sin distinguir mayúsculas ni tildes) y tipo. */
function validarCategoria(datos, { nombre, tipo }, idActual = null) {
  const n = normalizar(nombre);
  if (!n) return { ok: false, motivo: "nombre" };
  if (n.length > 30) return { ok: false, motivo: "largo" };
  if (!TIPOS_CATEGORIA.includes(tipo)) return { ok: false, motivo: "tipo" };
  const repetida = (datos.categorias_finanzas || []).some((c) => c.id !== idActual && c.tipo === tipo && !c.archivada && normalizar(c.nombre) === n);
  return repetida ? { ok: false, motivo: "repetida" } : { ok: true };
}

function crearCategoriaFinanzas(datos, { nombre, emoji = "🏷️", color = "#8a8f98", tipo = "gasto" } = {}) {
  const v = validarCategoria(datos, { nombre, tipo });
  if (!v.ok) return v;
  const cat = { id: nuevoId(), nombre: String(nombre).trim(), emoji, color, tipo, archivada: false };
  sellarTimestamp(cat);
  (datos.categorias_finanzas = datos.categorias_finanzas || []).push(cat);
  return { ok: true, categoria: cat };
}

/** Edita nombre, emoji o color. El tipo no cambia (movería el historial de gastos a ingresos). */
function editarCategoriaFinanzas(datos, id, cambios = {}) {
  const cat = buscarCategoria(datos, id);
  if (!cat) return { ok: false, motivo: "categoria" };
  if (cambios.nombre !== undefined) {
    const v = validarCategoria(datos, { nombre: cambios.nombre, tipo: cat.tipo }, id);
    if (!v.ok) return v;
    cat.nombre = String(cambios.nombre).trim();
  }
  if (cambios.emoji !== undefined) cat.emoji = cambios.emoji;
  if (cambios.color !== undefined) cat.color = cambios.color;
  if (cambios.prioridad !== undefined) {
    if (cambios.prioridad === null) delete cat.prioridad;
    else if (cat.tipo === "gasto" && PRIORIDADES_CATEGORIA.includes(cambios.prioridad)) cat.prioridad = cambios.prioridad;
    else return { ok: false, motivo: "prioridad" };
  }
  sellarTimestamp(cat);
  return { ok: true, categoria: cat };
}

/** Archivar oculta la categoría de los selectores, pero los movimientos conservan su `categoria_id`. */
function archivarCategoriaFinanzas(datos, id, archivar = true) {
  const cat = buscarCategoria(datos, id);
  if (!cat) return { ok: false, motivo: "categoria" };
  if (!archivar) { const v = validarCategoria(datos, cat, id); if (!v.ok) return v; }
  cat.archivada = !!archivar; sellarTimestamp(cat);
  return { ok: true, categoria: cat };
}

/**
 * Elimina de verdad solo si NINGÚN movimiento ni sobre la usa; si no, el motivo es "en_uso" y se ofrece archivar.
 * Deja tombstone para que la sincronización propague el borrado.
 */
function eliminarCategoriaFinanzas(datos, id) {
  const cat = buscarCategoria(datos, id);
  if (!cat) return { ok: false, motivo: "categoria" };
  const enMov = (datos.movimientos || []).some((m) => m.categoria_id === id);
  const enSobre = (datos.sobres || []).some((s) => (s.categoria_ids || []).includes(id));
  if (enMov || enSobre) return { ok: false, motivo: "en_uso" };
  datos.categorias_finanzas = datos.categorias_finanzas.filter((c) => c.id !== id);
  if (!Array.isArray(datos._eliminados_categorias_finanzas)) datos._eliminados_categorias_finanzas = [];
  if (!datos._eliminados_categorias_finanzas.some((t) => t.id === id)) datos._eliminados_categorias_finanzas.push({ id, eliminadoEn: Date.now() }); // forma de tumba que lee fusionarTumbas
  return { ok: true };
}

/** Un movimiento solo admite categorías de su mismo tipo (gasto o ingreso). Transferencias y ajustes no se categorizan. */
const categorizable = (m) => m && (m.tipo === "gasto" || m.tipo === "ingreso");

/** Asigna o quita la categoría de UN movimiento. `categoriaId = null` quita. No toca nada más. */
function asignarCategoria(datos, movimientoId, categoriaId) {
  const m = (datos.movimientos || []).find((x) => x.id === movimientoId);
  if (!m) return { ok: false, motivo: "movimiento" };
  if (!categorizable(m)) return { ok: false, motivo: "no_categorizable" };
  if (categoriaId !== null) {
    const cat = buscarCategoria(datos, categoriaId);
    if (!cat) return { ok: false, motivo: "categoria" };
    if (cat.tipo !== m.tipo) return { ok: false, motivo: "tipo" };
  }
  if ((m.categoria_id || null) === categoriaId) return { ok: true, cambio: false };
  m.categoria_id = categoriaId; sellarTimestamp(m);
  return { ok: true, cambio: true, movimiento: m };
}

/**
 * Categorizar en lote: recibe pares { movimientoId, categoriaId }. Atómico en lo que importa: los inválidos se
 * saltan y se informan, los válidos se aplican; nunca cambia monto, fecha ni tipo. `soloSinCategoria` evita pisar
 * lo que la persona ya clasificó a mano.
 */
function categorizarEnLote(datos, asignaciones, { soloSinCategoria = true } = {}) {
  const r = { aplicados: 0, sinCambio: 0, saltados: [] };
  (asignaciones || []).forEach((a) => {
    const m = (datos.movimientos || []).find((x) => x.id === a.movimientoId);
    if (m && soloSinCategoria && m.categoria_id && m.categoria_id !== a.categoriaId) { r.saltados.push({ ...a, motivo: "ya_tiene" }); return; }
    const res = asignarCategoria(datos, a.movimientoId, a.categoriaId);
    if (!res.ok) r.saltados.push({ ...a, motivo: res.motivo });
    else if (res.cambio) r.aplicados++; else r.sinCambio++;
  });
  return r;
}

/** Movimientos vigentes sin categoría (los que el lote debe ofrecer), del tipo pedido, recientes primero. */
function movimientosSinCategoria(datos, { tipo, hoy } = {}) {
  return movimientosVigentes(datos, hoy)
    .filter((m) => categorizable(m) && !m.categoria_id && (!tipo || m.tipo === tipo))
    .sort((a, b) => String(b.fecha_registro).localeCompare(String(a.fecha_registro)));
}

/**
 * Grupos para categorizar de una vez: movimientos sin categoría que comparten nombre (sin distinguir mayúsculas
 * ni tildes). "Pasaje" 14 veces se clasifica con un solo toque. Más repetidos primero.
 */
function agruparSinCategoriaPorNombre(datos, { tipo, hoy } = {}) {
  const mapa = new Map();
  movimientosSinCategoria(datos, { tipo, hoy }).forEach((m) => {
    const clave = normalizar(m.nombre); if (!clave) return;
    const g = mapa.get(clave) || { clave, nombre: m.nombre, tipo: m.tipo, ids: [], total: 0 };
    g.ids.push(m.id); g.total += Number(m.monto) || 0; mapa.set(clave, g);
  });
  return [...mapa.values()].sort((a, b) => b.ids.length - a.ids.length || a.nombre.localeCompare(b.nombre));
}

/**
 * Sugerencia de categoría para un nombre: la categoría que MÁS veces se usó con ese nombre (mismo tipo, categoría
 * vigente). Necesita al menos 2 usos y que gane con claridad; si no, no sugiere (mejor nada que algo equivocado).
 */
function sugerirCategoria(datos, nombre, tipo = "gasto") {
  const clave = normalizar(nombre); if (!clave) return null;
  const cuentas = new Map();
  (datos.movimientos || []).forEach((m) => {
    if (m.tipo !== tipo || !m.categoria_id || normalizar(m.nombre) !== clave) return;
    cuentas.set(m.categoria_id, (cuentas.get(m.categoria_id) || 0) + 1);
  });
  const orden = [...cuentas.entries()].filter(([id]) => { const c = buscarCategoria(datos, id); return c && !c.archivada; }).sort((a, b) => b[1] - a[1]);
  if (!orden.length || orden[0][1] < 2) return null;
  if (orden[1] && orden[1][1] === orden[0][1]) return null; // empate: no adivina
  return { categoriaId: orden[0][0], usos: orden[0][1] };
}

export {
  FLAG_MIGRACION_CATEGORIAS, JUEGO_BASICO, PRIORIDADES_CATEGORIA, TIPOS_CATEGORIA, normalizar,
  agruparSinCategoriaPorNombre, archivarCategoriaFinanzas, asignarCategoria, buscarCategoria, categorizable, categorizarEnLote,
  crearCategoriaFinanzas, editarCategoriaFinanzas, eliminarCategoriaFinanzas, listarCategorias, movimientosSinCategoria, migrarCategoriasV1, sembrarCategoriasBasicas,
  sugerirCategoria, validarCategoria,
};
