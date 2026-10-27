/* =========================================================================
   FINANZAS 2.0: exportar e importar movimientos (sesión 6, F6). Lógica pura, sin DOM.
   Exportar: CSV (para hojas de cálculo) y respaldo JSON (todo lo de Finanzas, para guardar).
   Importar: CSV o JSON → candidatos → vista previa → aplicar. Tres defensas contra duplicar:
     1. id: lo que ya existe, o ya se borró (tumba), no vuelve. Los ids de lo importado son deterministas
        (salen del contenido), así que dos dispositivos que importan el mismo archivo no duplican al sincronizar.
     2. huella: un movimiento parecido que ya registraste a mano (mismo tipo, fecha, monto y nombre) se marca "parecido".
        Se cuenta por cantidad: dos cafés iguales el mismo día en el archivo y uno ya registrado importa solo uno.
     3. aplicar es idempotente: aplicar dos veces la misma selección no crea nada la segunda vez.
   Un candidato es { fila, tipo, monto, fecha, nombre, nota, ..., estado, motivo, incluir, id, huella }.
   Estados: "nuevo" | "parecido" | "repetido" | "eliminado" (lo borraste antes; solo vuelve si lo eliges) | "invalido".
   ========================================================================= */

import { crearMovimiento } from "./finanzas-modelo.js";
import { movimientoVisible, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { validarCategoria } from "./finanzas-categorias.js";
import { sellarTimestamp } from "./schema.js";
import { leerCsv, escribirCsv, neutralizarFormula, restaurarFormula } from "./finanzas-csv.js";
import {
  MONEDA_ANTES, MONEDA_DESPUES, compararMoneda, detectarOrdenFecha, hashTexto, huellaMovimiento, normalizarTexto, normalizarTipo,
  parsearFechaTexto, parsearMontoTexto,
} from "./finanzas-texto.js";

const MAX_TEXTO = 2_000_000;
const TIPOS = ["gasto", "ingreso", "ahorro", "transferencia", "ajuste"];
const COLUMNAS_EXPORTACION = ["id", "fecha", "tipo", "nombre", "monto", "categoria", "nota", "semestre", "meta", "fuente", "sentido", "origen", "pagado_con_meta"];
const FORMATO_RESPALDO = "finanzas-respaldo";

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const nombrePorId = (lista, id) => ((lista || []).find((x) => x.id === id) || {}).nombre || "";
const sinMarcas = (o) => Object.fromEntries(Object.entries(o || {}).filter(([k]) => !k.startsWith("_")));

/* ===================== Exportar ===================== */

/**
 * CSV de los movimientos. Los recurrentes no caben en una fila (su monto sale de la frecuencia), así que quedan fuera
 * del CSV y se cuentan en `recurrentesOmitidos`; el respaldo JSON sí los incluye. Con `;` los montos llevan coma decimal.
 */
function exportarMovimientosCsv(datos, { separador = ",", hoy = hoyLocal() } = {}) {
  const todos = (datos.movimientos || []).filter((m) => m.tipo !== "prestamo" && m.tipo !== "traspaso"); // préstamos y traspasos viajan en el respaldo JSON, no en el CSV
  const lista = todos.filter((m) => !m.recurrente).sort((a, b) => String(a.fecha_registro || "9999").localeCompare(String(b.fecha_registro || "9999")));
  const monto = (n) => { const s = String(redondear(n)); return separador === ";" ? s.replace(".", ",") : s; };
  const filas = [COLUMNAS_EXPORTACION, ...lista.map((m) => [
    m.id, m.fecha_registro || "", m.tipo, neutralizarFormula(m.nombre), monto(m.monto),
    neutralizarFormula(nombrePorId(datos.categorias_finanzas, m.categoria_id)), neutralizarFormula(m.nota),
    neutralizarFormula(nombrePorId(datos.semestres, m.semestre_id)), neutralizarFormula(nombrePorId(datos.metas, m.meta_id)),
    m.fuente || "", m.sentido || "", m.origen && m.origen !== "manual" ? m.origen : "", neutralizarFormula(nombrePorId(datos.metas, m.pagado_con_meta_id)),
  ])];
  return { texto: escribirCsv(filas, { separador }), nombreArchivo: `finanzas-movimientos-${hoy}.csv`, total: lista.length, recurrentesOmitidos: todos.length - lista.length };
}

/** Respaldo JSON con todo lo de Finanzas (sin las marcas internas de sincronización). */
function exportarRespaldoJson(datos, { hoy = hoyLocal() } = {}) {
  const objeto = {
    formato: FORMATO_RESPALDO, version: 1, exportado: hoy,
    moneda: (datos.configuracion && datos.configuracion.moneda_preferida) || null,
    movimientos: (datos.movimientos || []).map(sinMarcas),
    metas: (datos.metas || []).map(sinMarcas),
    categorias_finanzas: (datos.categorias_finanzas || []).map(sinMarcas),
    sobres: (datos.sobres || []).map(sinMarcas),
    compromisos: (datos.compromisos || []).map(sinMarcas),
    prestamos: (datos.prestamos || []).map(sinMarcas),
    cuentas: (datos.cuentas || []).map(sinMarcas),
    semestres: (datos.semestres || []).map((s) => ({ id: s.id, nombre: s.nombre })),
  };
  return { texto: JSON.stringify(objeto, null, 2), nombreArchivo: `finanzas-respaldo-${hoy}.json`, total: objeto.movimientos.length };
}

/* ===================== Leer un archivo ===================== */

const ALIAS_COLUMNAS = {
  id: ["id"],
  fecha: ["fecha", "date", "fecha registro", "fecha movimiento", "fecha de movimiento", "fecha operacion", "fecha de la operacion", "fecha contable", "dia"],
  tipo: ["tipo", "type", "tipo de movimiento", "tipo movimiento"],
  debito: ["debito", "debitos", "debit", "cargo", "cargos", "retiro", "retiros", "egreso", "egresos", "gasto", "gastos", "salida", "salidas"],
  credito: ["credito", "creditos", "credit", "abono", "abonos", "deposito", "depositos", "ingreso", "ingresos", "entrada", "entradas"],
  monto: ["monto", "importe", "amount", "valor", "total", "cantidad", "monto total"],
  nombre: ["nombre", "payment", "descripcion", "concepto", "detalle", "comercio", "name", "description", "merchant", "memo", "payee", "beneficiario"],
  categoria: ["categoria", "category", "rubro"],
  nota: ["nota", "notas", "note", "notes", "comentario", "comentarios", "observacion", "observaciones"],
  referencia: ["referencia", "ref", "reference", "numero de referencia", "numero de operacion", "no referencia", "comprobante", "numero de comprobante"],
  semestre: ["semestre", "periodo", "semester"],
  meta: ["meta", "goal"],
  fuente: ["fuente", "source"],
  sentido: ["sentido", "direction"],
  origen: ["origen", "origin"],
  pagado_con_meta: ["pagado con meta", "pagado con"],
  moneda: ["moneda", "currency", "divisa"],
  pagado: ["is paid", "pagado", "pagada", "paid"],
};
const CAMPOS_ORDEN = Object.keys(ALIAS_COLUMNAS);
const normalizarEncabezado = (h) => normalizarTexto(h).replace(/[_\-.]+/g, " ").trim();

/** Encabezados → { campo: índice de columna } (solo los campos que encuentra). Prefiere el nombre exacto; luego una palabra suelta. */
function detectarMapeo(encabezados) {
  const norm = (encabezados || []).map(normalizarEncabezado);
  const usados = new Set(), mapeo = {};
  [(h, a) => h === a, (h, a) => !a.includes(" ") && h.split(" ").includes(a)].forEach((coincide) => {
    CAMPOS_ORDEN.forEach((campo) => {
      if (mapeo[campo] !== undefined) return;
      const i = norm.findIndex((h, k) => !usados.has(k) && ALIAS_COLUMNAS[campo].some((a) => coincide(h, a)));
      if (i >= 0) { mapeo[campo] = i; usados.add(i); }
    });
  });
  return mapeo;
}

/**
 * Un archivo puede traer varias tablas separadas por una línea "###" (cada una con su encabezado). Se usa la que mejor
 * se parece a movimientos (fecha y monto reconocidos; si empatan, la de más filas). Las demás se ignoran.
 */
function leerSecciones(texto) {
  const partes = texto.split(/^\s*#{3,}\s*$/m).filter((x) => x.trim());
  if (partes.length < 2) return { ...leerCsv(texto), secciones: 1 };
  let mejor = null;
  partes.forEach((parte) => {
    const r = leerCsv(parte); if (r.filas.length < 2) return;
    const m = detectarMapeo(r.filas[0]);
    const puntos = (mapeoSuficiente(m) ? 1000 : 0) + Object.keys(m).length * 10 + Math.min(r.filas.length, 9);
    if (!mejor || puntos > mejor.puntos) mejor = { ...r, puntos };
  });
  return mejor ? { ...mejor, secciones: partes.length } : { ...leerCsv(texto), secciones: 1 };
}

/**
 * Texto de un archivo → { ok:true, formato:"csv", encabezados, filas, mapeo, orden, separador, truncado }
 * o { ok:true, formato:"json", candidatos } o { ok:false, motivo: "vacio" | "muy_grande" | "json" | "sin_filas" | "formato" }.
 */
function prepararImportacion(texto, { hoy = hoyLocal() } = {}) {
  const t = String(texto || "");
  if (!t.trim()) return { ok: false, motivo: "vacio" };
  if (t.length > MAX_TEXTO) return { ok: false, motivo: "muy_grande" };
  if (/^\s*[{[]/.test(t)) {
    let objeto;
    try { objeto = JSON.parse(t); } catch (e) { return { ok: false, motivo: "json" }; }
    const candidatos = candidatosDeJson(objeto);
    return candidatos ? { ok: true, formato: "json", candidatos } : { ok: false, motivo: "formato" };
  }
  const { filas, separador, truncado, secciones } = leerSecciones(t);
  if (filas.length < 2) return { ok: false, motivo: "sin_filas" };
  const [encabezados, ...todas] = filas;
  const mapeo = detectarMapeo(encabezados);
  // Columna "pagado": lo que aún no está pagado no es un movimiento ocurrido, se deja fuera y se cuenta.
  const noPagado = (f) => mapeo.pagado !== undefined && /^(false|no|falso|0|n)$/i.test(String(f[mapeo.pagado] || "").trim());
  const datosFilas = todas.filter((f) => !noPagado(f)); const omitidas = todas.length - datosFilas.length;
  const orden = detectarOrdenFecha(mapeo.fecha === undefined ? [] : datosFilas.map((f) => f[mapeo.fecha]));
  return { ok: true, formato: "csv", encabezados, filas: datosFilas, mapeo, orden, separador, truncado, hoy, omitidas, secciones };
}

/** ¿Con este mapeo se puede importar? Hace falta fecha y (monto o débito/crédito). */
const mapeoSuficiente = (m) => m.fecha !== undefined && (m.monto !== undefined || m.debito !== undefined || m.credito !== undefined);

const limpiarTexto = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

/** Token de moneda que acompaña a un monto escrito ("₡5.000", "USD 20"), o "". */
function tokenMoneda(texto) {
  const m = String(texto || "").match(new RegExp(`(${MONEDA_ANTES})\\s?[-−(]?\\s?\\d|\\d\\s?(${MONEDA_DESPUES})(?![A-Za-z])`));
  return m ? m[1] || m[2] || "" : "";
}

/**
 * Filas del CSV → candidatos sin clasificar. `signoPositivo` ("ingreso" por defecto) dice qué son los montos positivos
 * cuando el archivo no trae columna de tipo ni débito/crédito. Un negativo siempre es gasto.
 */
function candidatosDeCsv(prep, { mapeo = prep.mapeo, orden = prep.orden, signoPositivo = "ingreso", hoy = prep.hoy } = {}) {
  const celda = (f, campo) => (mapeo[campo] === undefined ? "" : restaurarFormula(String(f[mapeo[campo]] == null ? "" : f[mapeo[campo]]).trim()));
  return prep.filas.map((f, i) => {
    const c = { fila: i + 2, advertencias: [], idOriginal: celda(f, "id"), referencia: limpiarTexto(celda(f, "referencia"), 40) };
    const crudoMonto = celda(f, "monto");
    c.monedaToken = tokenMoneda(crudoMonto) || limpiarTexto(celda(f, "moneda"), 6).toUpperCase();
    let tipo = normalizarTipo(celda(f, "tipo"));
    let monto = 0, negativo = false;
    if (mapeo.monto !== undefined && crudoMonto !== "") {
      monto = parsearMontoTexto(crudoMonto);
      negativo = /^[^\d]*[-−–(]/.test(crudoMonto) || /-\s*$/.test(crudoMonto);
    } else if (mapeo.debito !== undefined || mapeo.credito !== undefined) {
      const d = parsearMontoTexto(celda(f, "debito")), cr = parsearMontoTexto(celda(f, "credito"));
      monto = Math.abs(cr - d); negativo = d > cr;
      if (!tipo && monto > 0) tipo = negativo ? "gasto" : "ingreso";
    }
    if (!tipo) tipo = negativo ? "gasto" : signoPositivo === "gasto" ? "gasto" : "ingreso";
    const sentidoTexto = normalizarTexto(celda(f, "sentido"));
    Object.assign(c, {
      tipo, monto: redondear(monto), nombre: limpiarTexto(celda(f, "nombre"), 80), nota: limpiarTexto(celda(f, "nota"), 200),
      categoriaNombre: limpiarTexto(celda(f, "categoria"), 30), semestreNombre: celda(f, "semestre"), metaNombre: celda(f, "meta"),
      pagadoConMetaNombre: celda(f, "pagado_con_meta"), fuente: normalizarTexto(celda(f, "fuente")) === "nuevo" ? "nuevo" : "liquido",
      sentido: sentidoTexto === "resta" || (tipo === "ajuste" && !sentidoTexto && negativo) ? "resta" : "suma",
      origen: ["matricula", "beca"].includes(normalizarTexto(celda(f, "origen"))) ? normalizarTexto(celda(f, "origen")) : "manual",
    });
    c.fecha = parsearFechaTexto(celda(f, "fecha"), { orden, hoy });
    if (c.referencia && !c.nota) c.nota = `Ref. ${c.referencia}`;
    return c;
  });
}

/** Respaldo JSON (o un arreglo de movimientos) → candidatos, o null si no se reconoce. Conserva ids, recurrentes y filas sin fecha. */
function candidatosDeJson(objeto) {
  const lista = Array.isArray(objeto) ? objeto : objeto && objeto.formato === FORMATO_RESPALDO && Array.isArray(objeto.movimientos) ? objeto.movimientos : null;
  if (!lista) return null;
  const ref = Array.isArray(objeto) ? {} : objeto;
  return lista.slice(0, 20000).filter((m) => m && typeof m === "object").map((m, i) => {
    const recurrente = m.recurrente && typeof m.recurrente === "object" && typeof m.recurrente.frecuencia === "string" && JSON.stringify(m.recurrente).length < 2000 ? JSON.parse(JSON.stringify(m.recurrente)) : null;
    return {
      fila: i + 1, advertencias: [], desdeJson: true, idOriginal: typeof m.id === "string" ? m.id : "", tipo: TIPOS.includes(m.tipo) ? m.tipo : null,
      monto: redondear(Math.abs(Number(m.monto) || 0)), fecha: typeof m.fecha_registro === "string" ? parsearFechaTexto(m.fecha_registro) : null,
      nombre: limpiarTexto(m.nombre, 80), nota: limpiarTexto(m.nota, 200), recurrente,
      categoriaId: m.categoria_id || null, categoriaNombre: nombrePorId(ref.categorias_finanzas, m.categoria_id),
      semestreId: m.semestre_id || null, semestreNombre: nombrePorId(ref.semestres, m.semestre_id),
      metaId: m.meta_id || null, metaNombre: nombrePorId(ref.metas, m.meta_id),
      pagadoConMetaId: m.pagado_con_meta_id || null, pagadoConMetaNombre: nombrePorId(ref.metas, m.pagado_con_meta_id),
      fuente: m.fuente === "nuevo" ? "nuevo" : "liquido", sentido: m.sentido === "resta" ? "resta" : "suma",
      origen: ["matricula", "beca"].includes(m.origen) ? m.origen : "manual",
    };
  });
}

/* ===================== Clasificar (resolver y detectar repetidos) ===================== */

/**
 * Un movimiento que la persona borró deja tumba y no vuelve solo. Si lo vuelve a importar a propósito, entra con el id
 * de siempre más "_r1", "_r2"… `presente` dice si la última variante ya está registrada (importar de nuevo no la duplica).
 */
function variantePosterior(id, existentes, tumbas) {
  let k = 1;
  while (existentes.has(`${id}_r${k}`) || tumbas.has(`${id}_r${k}`)) k++;
  return { id: `${id}_r${k}`, presente: k > 1 && existentes.has(`${id}_r${k - 1}`) };
}

const buscarNombre = (lista, nombre, extra) => {
  const n = normalizarTexto(nombre);
  return n ? (lista || []).find((x) => normalizarTexto(x.nombre) === n && (!extra || extra(x))) || null : null;
};

/** Categoría de destino: el id si existe y es del tipo; si no, por nombre (vigentes antes que archivadas). */
function resolverCategoria(datos, c) {
  if (c.tipo !== "gasto" && c.tipo !== "ingreso") return { id: null, nueva: null };
  const cats = datos.categorias_finanzas || [];
  const porId = c.categoriaId ? cats.find((x) => x.id === c.categoriaId && x.tipo === c.tipo) : null;
  if (porId) return { id: porId.id, nueva: null };
  const porNombre = buscarNombre(cats, c.categoriaNombre, (x) => x.tipo === c.tipo && !x.archivada) || buscarNombre(cats, c.categoriaNombre, (x) => x.tipo === c.tipo);
  if (porNombre) return { id: porNombre.id, nueva: null };
  return { id: null, nueva: normalizarTexto(c.categoriaNombre) ? { nombre: limpiarTexto(c.categoriaNombre, 30), tipo: c.tipo } : null };
}

/**
 * Resuelve categorías, metas y semestres de cada candidato, valida y marca repetidos. Devuelve candidatos nuevos (no muta
 * los recibidos). `incluir` queda en true solo para los "nuevo"; la persona puede encender un "parecido" a mano.
 */
function clasificarCandidatos(datos, candidatos, { crearCategorias = true } = {}) {
  const movimientos = datos.movimientos || [];
  const idsExistentes = new Set(movimientos.map((m) => m.id));
  const tumbas = new Set((datos._eliminados_movimientos || []).map((t) => t.id));
  const restantes = new Map(); // huella → cuántos movimientos ya registrados la tienen sin "gastar" todavía
  movimientos.filter((m) => !m.recurrente).forEach((m) => {
    const h = huellaMovimiento({ tipo: m.tipo, sentido: m.sentido, fecha: m.fecha_registro, monto: m.monto, nombre: m.nombre, metaId: m.meta_id });
    restantes.set(h, (restantes.get(h) || 0) + 1);
  });
  const consumir = (h) => { const n = restantes.get(h) || 0; if (n > 0) { restantes.set(h, n - 1); return true; } return false; };
  const monedaApp = (datos.configuracion && datos.configuracion.moneda_preferida) || "CRC";
  const ocurrencias = new Map(), idsVistos = new Set();

  return candidatos.map((origen) => {
    const c = { ...origen, advertencias: [...(origen.advertencias || [])] };
    const invalido = (motivo) => Object.assign(c, { estado: "invalido", motivo, incluir: false });
    if (!TIPOS.includes(c.tipo)) return invalido("tipo");
    if (!(c.monto > 0) && !c.recurrente) return invalido("monto");
    if (!c.fecha && !(c.desdeJson && c.fecha === null)) return invalido("fecha");

    const cat = resolverCategoria(datos, c);
    c.categoriaId = cat.id; c.categoriaNueva = crearCategorias ? cat.nueva : null;
    if (c.monedaToken && compararMoneda(c.monedaToken, monedaApp) === "distinta" && !c.advertencias.includes("moneda")) c.advertencias.push("moneda");
    const sem = (datos.semestres || []).find((s) => s.id === c.semestreId) || buscarNombre(datos.semestres, c.semestreNombre);
    c.semestreId = c.tipo === "gasto" || c.tipo === "ingreso" ? (sem && sem.id) || null : null;
    const metas = datos.metas || [];
    if (c.tipo === "ahorro" || c.tipo === "transferencia") {
      const meta = metas.find((x) => x.id === c.metaId && !x.archivada) || buscarNombre(metas, c.metaNombre, (x) => !x.archivada);
      if (!meta) return invalido("meta");
      c.metaId = meta.id;
    } else c.metaId = null;
    if (c.tipo === "gasto" && (c.pagadoConMetaId || c.pagadoConMetaNombre)) {
      const m = metas.find((x) => x.id === c.pagadoConMetaId) || buscarNombre(metas, c.pagadoConMetaNombre);
      c.pagadoConMetaId = m ? m.id : null;
      if (!m) c.advertencias.push("meta_no_encontrada");
    } else c.pagadoConMetaId = null;

    c.huella = c.recurrente ? null : huellaMovimiento({ tipo: c.tipo, sentido: c.sentido, fecha: c.fecha, monto: c.monto, nombre: c.nombre, metaId: c.metaId });
    const valido = /^mov_[A-Za-z0-9_.-]{3,80}$/.test(c.idOriginal || "");
    if (!valido && !c.huella) return invalido("id"); // un recurrente sin id no se puede reconocer después
    if (valido) c.id = c.idOriginal;
    else if (c.referencia) c.id = "mov_ref_" + hashTexto(`${c.referencia}|${Math.round(c.monto * 100)}`);
    else {
      const k = (ocurrencias.get(c.huella) || 0) + 1; ocurrencias.set(c.huella, k);
      c.id = "mov_imp_" + hashTexto(`${c.huella}#${k}`);
    }
    if (idsVistos.has(c.id)) return Object.assign(c, { estado: "repetido", motivo: "archivo", incluir: false });
    idsVistos.add(c.id);
    if (tumbas.has(c.id)) {
      if (variantePosterior(c.id, idsExistentes, tumbas).presente) return Object.assign(c, { estado: "repetido", motivo: "id", incluir: false });
      return Object.assign(c, { estado: "eliminado", incluir: false });
    }
    if (idsExistentes.has(c.id)) { if (c.huella) consumir(c.huella); return Object.assign(c, { estado: "repetido", motivo: "id", incluir: false }); }
    if (c.huella && consumir(c.huella)) return Object.assign(c, { estado: "parecido", incluir: false });
    return Object.assign(c, { estado: "nuevo", incluir: true });
  });
}

/** Conteo por estado + cuántos están marcados para importar. */
function resumirCandidatos(candidatos) {
  const r = { total: candidatos.length, nuevo: 0, parecido: 0, repetido: 0, eliminado: 0, invalido: 0, aImportar: 0 };
  candidatos.forEach((c) => { r[c.estado] = (r[c.estado] || 0) + 1; if (c.incluir && ["nuevo", "parecido", "eliminado"].includes(c.estado)) r.aImportar++; });
  return r;
}

/** Avisos que conviene mostrar antes de aplicar: módulos apagados (se importa pero no se ve) y moneda distinta. */
function advertenciasImportacion(datos, candidatos) {
  const modulos = obtenerModulosFinanzas(datos), avisos = new Set();
  candidatos.filter((c) => c.incluir && ["nuevo", "parecido", "eliminado"].includes(c.estado)).forEach((c) => {
    if (!movimientoVisible({ tipo: c.tipo, origen: c.origen }, modulos)) {
      avisos.add(c.tipo === "ahorro" || c.tipo === "transferencia" ? "modulo_ahorros" : c.origen === "matricula" ? "modulo_matricula" : c.origen === "beca" ? "modulo_beca" : c.tipo === "ajuste" ? "modulo_ajuste" : "modulo_gastos");
    }
    if (c.advertencias.includes("moneda")) avisos.add("moneda");
  });
  return [...avisos];
}

/* ===================== Aplicar y deshacer ===================== */

/**
 * Crea los movimientos de los candidatos marcados (`incluir`) que sean "nuevo", "parecido" o "eliminado". Idempotente: lo que ya
 * existe (o tiene tumba) se salta. Crea las categorías nuevas una sola vez por nombre. El llamador marca el cambio pendiente.
 * Devuelve { creados: [ids], categoriasCreadas, saltados }.
 */
function aplicarImportacion(datos, candidatos) {
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  const idsExistentes = new Set(datos.movimientos.map((m) => m.id));
  const tumbas = new Set((datos._eliminados_movimientos || []).map((t) => t.id));
  const nuevasCategorias = new Map(); // "tipo|nombre normalizado" → id
  const r = { creados: [], categoriasCreadas: 0, saltados: 0 };
  candidatos.forEach((c) => {
    if (!c.incluir || !["nuevo", "parecido", "eliminado"].includes(c.estado)) return;
    let id = c.id;
    if (c.estado === "eliminado") {
      const v = variantePosterior(c.id, idsExistentes, tumbas);
      if (v.presente) { r.saltados++; return; }
      id = v.id;
    } else if (idsExistentes.has(id) || tumbas.has(id)) { r.saltados++; return; }
    let categoriaId = c.categoriaId || null;
    if (!categoriaId && c.categoriaNueva) {
      const clave = `${c.categoriaNueva.tipo}|${normalizarTexto(c.categoriaNueva.nombre)}`;
      if (!nuevasCategorias.has(clave)) {
        // Id determinista (sale del tipo y el nombre): dos dispositivos que importan el mismo archivo crean la misma categoría
        // y la fusión no deja dos "Salud".
        const v = validarCategoria(datos, c.categoriaNueva);
        const idCat = "cat_imp_" + hashTexto(clave);
        let existente = (datos.categorias_finanzas || []).find((x) => x.id === idCat) || buscarNombre(datos.categorias_finanzas, c.categoriaNueva.nombre, (x) => x.tipo === c.categoriaNueva.tipo);
        const tumbaCat = (datos._eliminados_categorias_finanzas || []).some((t) => t.id === idCat);
        if (!existente && v.ok && !tumbaCat) {
          existente = sellarTimestamp({ id: idCat, nombre: c.categoriaNueva.nombre, emoji: "🏷️", color: "#8a8f98", tipo: c.categoriaNueva.tipo, archivada: false });
          (datos.categorias_finanzas = datos.categorias_finanzas || []).push(existente);
          r.categoriasCreadas++;
        }
        nuevasCategorias.set(clave, existente ? existente.id : null);
      }
      categoriaId = nuevasCategorias.get(clave);
    }
    datos.movimientos.push(crearMovimiento({
      id, tipo: c.tipo, nombre: c.nombre, monto: c.recurrente ? 0 : c.monto, fechaRegistro: c.fecha === undefined ? null : c.fecha, nota: c.nota,
      semestreId: c.semestreId, origen: c.origen, metaId: c.metaId, fuente: c.fuente, sentido: c.sentido, pagadoConMetaId: c.pagadoConMetaId,
      recurrente: c.recurrente || null, categoriaId,
    }));
    idsExistentes.add(id);
    r.creados.push(id);
  });
  return r;
}

/** Quita lo que creó una importación (con tumba, para que la sincronización no lo resucite). Las categorías creadas se conservan. */
function deshacerImportacion(datos, ids) {
  const quitar = new Set(ids || []);
  const antes = (datos.movimientos || []).length;
  datos.movimientos = (datos.movimientos || []).filter((m) => !quitar.has(m.id));
  if (!Array.isArray(datos._eliminados_movimientos)) datos._eliminados_movimientos = [];
  quitar.forEach((id) => { if (!datos._eliminados_movimientos.some((t) => t.id === id)) datos._eliminados_movimientos.push({ id, eliminadoEn: Date.now() }); });
  return antes - datos.movimientos.length;
}

export {
  COLUMNAS_EXPORTACION, FORMATO_RESPALDO, MAX_TEXTO,
  advertenciasImportacion, aplicarImportacion, candidatosDeCsv, candidatosDeJson, clasificarCandidatos, deshacerImportacion, detectarMapeo,
  exportarMovimientosCsv, exportarRespaldoJson, mapeoSuficiente, prepararImportacion, resumirCandidatos, tokenMoneda,
};
