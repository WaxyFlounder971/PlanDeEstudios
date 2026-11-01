/* =========================================================================
   FINANZAS 2.0: Sobres por periodo y resumen mensual (sesión 5, F4), lógica pura sin DOM.
   Un sobre es un LÍMITE de gasto para una o varias categorías en un periodo (semana, mes, semestre o rango).
   Es un registro: no mueve dinero del banco ni bloquea nada.
   - El gastado se DERIVA de los movimientos (mismos filtros que Movimientos); nunca se guarda.
   - El sobrante que se arrastra también se deriva, periodo a periodo, desde la vigencia del sobre.
   - Avisos sin culpa: ámbar al 80 %, rojo al agotarse, siempre con texto que dice cuánto queda.
   Colección nueva: datos.sobres, con tombstones en datos._eliminados_sobres.
   Sobre = { id, nombre, categoria_ids, limite, periodo, arrastra_sobrante, desde,
             semestre_id?, fecha_inicio?, fecha_fin? (rango) }
   ========================================================================= */

import { hoyIso } from "./finanzas-modelo.js";
import { movimientosVigentes, movimientoVisible, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { ocurrenciasRecurrente } from "./finanzas-disponible.js";
import { buscarCategoria, normalizar } from "./finanzas-categorias.js";
import { sellarTimestamp } from "../schema.js";

const PERIODOS = ["semana", "mes", "semestre", "rango"];
const UMBRAL_AMBAR = 0.8;       // al 80 % gastado avisa en ámbar (md)
const MAX_PERIODOS_ARRASTRE = 24; // tope de seguridad al recorrer periodos hacia atrás

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esIso = (x) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(x || ""));
  if (!m) return false;
  const f = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return f.getUTCFullYear() === +m[1] && f.getUTCMonth() === +m[2] - 1 && f.getUTCDate() === +m[3];
};
const dias = (iso) => { const [a, m, d] = iso.split("-").map(Number); return Math.round(Date.UTC(a, m - 1, d) / 86400000); };
const deDias = (n) => new Date(n * 86400000).toISOString().slice(0, 10);
const sumarDias = (iso, n) => deDias(dias(iso) + n);
const nuevoId = () => "sob_" + crypto.randomUUID();

/* ===================== Periodos ===================== */

/** Lunes de la semana de `iso` (la semana va de lunes a domingo). */
function inicioSemana(iso) { const dow = (new Date(dias(iso) * 86400000).getUTCDay() + 6) % 7; return sumarDias(iso, -dow); }
function finDeMes(a, m) { return deDias(Math.round(Date.UTC(a, m, 0) / 86400000)); } // m es 1..12; día 0 del mes siguiente

/** Rango de un semestre del usuario. Acepta los nombres de campo más comunes; null si no se puede leer. */
function rangoDeSemestre(sem) {
  if (!sem) return null;
  const desde = sem.fecha_inicio || sem.inicio || sem.desde, hasta = sem.fecha_fin || sem.fin || sem.hasta;
  return esIso(desde) && esIso(hasta) && desde <= hasta ? { desde, hasta } : null;
}

/** Semestre que contiene `iso` (o el indicado por el sobre). */
function semestreDe(datos, sobre, iso) {
  const lista = (datos.semestres || []).filter((s) => !s._eliminado);
  if (sobre.semestre_id) return lista.find((s) => s.id === sobre.semestre_id) || null;
  return lista.find((s) => { const r = rangoDeSemestre(s); return r && iso >= r.desde && iso <= r.hasta; }) || null;
}

/**
 * Periodo del sobre que contiene `iso`: { desde, hasta, clave } o null si no hay (semestre sin fechas, rango fuera
 * de fecha). Para "rango" el periodo es siempre el rango entero y "semestre" el del semestre elegido o actual.
 */
function periodoDelSobre(datos, sobre, iso) {
  if (sobre.periodo === "semana") { const d = inicioSemana(iso); return { desde: d, hasta: sumarDias(d, 6), clave: `s:${d}` }; }
  if (sobre.periodo === "mes") {
    const [a, m] = iso.split("-").map(Number);
    const desde = `${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
    return { desde, hasta: finDeMes(a, m), clave: `m:${desde.slice(0, 7)}` };
  }
  if (sobre.periodo === "semestre") {
    const r = rangoDeSemestre(semestreDe(datos, sobre, iso));
    return r ? { ...r, clave: `x:${r.desde}` } : null;
  }
  if (sobre.periodo === "rango") {
    return esIso(sobre.fecha_inicio) && esIso(sobre.fecha_fin) && sobre.fecha_inicio <= sobre.fecha_fin
      ? { desde: sobre.fecha_inicio, hasta: sobre.fecha_fin, clave: `r:${sobre.fecha_inicio}` } : null;
  }
  return null;
}

/* ===================== Gastado (derivado de los movimientos) ===================== */

/**
 * Gastos que cuentan para un conjunto de categorías en [desde, hasta]. Misma fuente y mismos filtros que
 * Movimientos: vigentes, visibles según los módulos, tipo gasto y fecha ya ocurrida (<= hoy). Un gasto recurrente
 * aporta una vez por cada día de pago del periodo (mismo generador de fechas que Disponible).
 */
function gastosEnPeriodo(datos, categoriaIds, desde, hasta, hoy) {
  const ids = new Set(categoriaIds || []);
  const modulos = obtenerModulosFinanzas(datos);
  const tope = hasta < hoy ? hasta : hoy;
  const filas = [];
  movimientosVigentes(datos, hoy).forEach((m) => {
    if (m.tipo !== "gasto" || !ids.has(m.categoria_id) || !movimientoVisible(m, modulos)) return;
    if (m.recurrente) {
      const monto = Number(m.recurrente.monto_por_pago) || 0;
      ocurrenciasRecurrente(m.recurrente, sumarDias(desde, -1), tope).forEach((fecha) => filas.push({ id: m.id, fecha, monto, nombre: m.nombre, recurrente: true }));
    } else if (m.fecha_registro && m.fecha_registro >= desde && m.fecha_registro <= tope) {
      filas.push({ id: m.id, fecha: m.fecha_registro, monto: Number(m.monto) || 0, nombre: m.nombre, recurrente: false });
    }
  });
  return filas;
}
const sumaFilas = (filas) => redondear(filas.reduce((t, f) => t + f.monto, 0));

/* ===================== Sobrante que se arrastra (derivado) ===================== */

/** Periodo inmediatamente anterior (solo semana y mes; semestre y rango no arrastran). */
function periodoAnterior(datos, sobre, periodo) { return periodoDelSobre(datos, { ...sobre, semestre_id: null }, sumarDias(periodo.desde, -1)); }

/**
 * Sobrante acumulado que llega al periodo `periodo`: recorre los periodos desde el de vigencia del sobre (`desde`)
 * hasta el anterior. En cada uno, sobrante = max(0, limite + sobrante previo − gastado). Un exceso NO se arrastra
 * como deuda: cada periodo vuelve a empezar sin culpa.
 */
function calcularArrastre(datos, sobre, periodo, hoy) {
  if (!sobre.arrastra_sobrante || (sobre.periodo !== "semana" && sobre.periodo !== "mes")) return 0;
  const lista = [];
  let p = periodoAnterior(datos, sobre, periodo);
  while (p && esIso(sobre.desde) && p.hasta >= sobre.desde && lista.length < MAX_PERIODOS_ARRASTRE) { lista.unshift(p); p = periodoAnterior(datos, sobre, p); }
  let sobrante = 0;
  lista.forEach((per) => {
    const gastado = sumaFilas(gastosEnPeriodo(datos, sobre.categoria_ids, per.desde, per.hasta, hoy));
    sobrante = redondear(Math.max(0, sobre.limite + sobrante - gastado));
  });
  return sobrante;
}

/* ===================== Resumen de un sobre ===================== */

/**
 * Rellena una plantilla con {claves}. La pantalla traduce la plantilla (texto fijo) y luego pasa por aquí con su propio
 * `formato`, así el importe sigue el formato de la app y el modo privacidad, y las frases se traducen enteras.
 */
function llenarPlantilla(plantilla, valores = {}, formato = (n) => String(n)) {
  return String(plantilla).replace(/\{(\w+)\}/g, (_, k) => (k === "monto" ? formato(valores[k]) : String(valores[k] ?? "")));
}


/**
 * Todo lo que la pantalla necesita de un sobre en el periodo de `hoy`.
 * nivel: "ok" | "ambar" (gastado >= 80 %) | "rojo" (agotado) | "sin_periodo".
 * `fraccionRestante` (0..1) alimenta el anillo que se vacía. `texto` siempre dice cuánto queda o cuánto se superó.
 * `formato(n)` da el importe con el formato de la app (y •••• en modo privacidad); por defecto, el número plano.
 */
function resumirSobre(datos, sobre, hoy = hoyIso(), { formato = (n) => String(n) } = {}) {
  const periodo = periodoDelSobre(datos, sobre, hoy);
  const base = { id: sobre.id, nombre: sobre.nombre, limite: Number(sobre.limite) || 0, periodo, gastado: 0, arrastre: 0, disponibleTotal: 0, restante: 0,
    fraccionRestante: 0, porcentajeGastado: 0, nivel: "sin_periodo", texto: "", filas: [], diasRestantes: null };
  if (!periodo) return { ...base, plantilla: "Este sobre no tiene un periodo con fechas", valores: {}, texto: "Este sobre no tiene un periodo con fechas", ayuda: "Elige las fechas o el semestre para ver el avance." };

  const filas = gastosEnPeriodo(datos, sobre.categoria_ids, periodo.desde, periodo.hasta, hoy);
  const gastado = sumaFilas(filas);
  const arrastre = calcularArrastre(datos, sobre, periodo, hoy);
  const disponibleTotal = redondear(base.limite + arrastre);
  const restante = redondear(disponibleTotal - gastado);
  const porcentajeGastado = disponibleTotal > 0 ? Math.round((gastado / disponibleTotal) * 100) : 100;
  const diasRestantes = Math.max(0, dias(periodo.hasta) - dias(hoy));
  let nivel = "ok", plantilla = "Te quedan {monto}", valores = { monto: restante };
  if (restante <= 0) { nivel = "rojo"; if (restante === 0) { plantilla = "Sobre agotado: no queda nada"; valores = {}; } else { plantilla = "Superaste el sobre por {monto}"; valores = { monto: redondear(-restante) }; } }
  else if (gastado >= disponibleTotal * UMBRAL_AMBAR) { nivel = "ambar"; plantilla = "Llevas el {porcentaje} % y te quedan {monto}"; valores = { porcentaje: porcentajeGastado, monto: restante }; }
  const texto = llenarPlantilla(plantilla, valores, formato);
  return { ...base, periodo, gastado, arrastre, disponibleTotal, restante, filas, diasRestantes, nivel, texto, plantilla, valores,
    fraccionRestante: disponibleTotal > 0 ? Math.max(0, Math.min(1, restante / disponibleTotal)) : 0, porcentajeGastado };
}

/** Los sobres de la persona con su resumen. Con el módulo Gastos apagado no hay sobres (se omiten sin error). */
function listarSobres(datos, hoy = hoyIso(), { incluirArchivados = false, formato } = {}) {
  if (!obtenerModulosFinanzas(datos).gastos) return [];
  return (datos.sobres || []).filter((s) => incluirArchivados || !s.archivado).map((s) => resumirSobre(datos, s, hoy, { formato }));
}

/** Para el Inicio: solo los que están por agotarse o agotados, los más apretados primero. */
function sobresEnRiesgo(datos, hoy = hoyIso(), opciones = {}) {
  const rank = { rojo: 0, ambar: 1 };
  return listarSobres(datos, hoy, opciones).filter((r) => r.nivel === "rojo" || r.nivel === "ambar")
    .sort((a, b) => rank[a.nivel] - rank[b.nivel] || a.fraccionRestante - b.fraccionRestante);
}

/** Sobres activos que cubren una categoría (para avisar al registrar un gasto: "este gasto cae en el sobre X"). */
function sobresDeCategoria(datos, categoriaId) {
  return (datos.sobres || []).filter((s) => !s.archivado && (s.categoria_ids || []).includes(categoriaId));
}

/* ===================== Crear, editar y quitar sobres ===================== */

function validarSobre(datos, d, idActual = null) {
  if (!normalizar(d.nombre)) return { ok: false, motivo: "nombre" };
  const limite = redondear(Number(d.limite));
  if (!(limite > 0)) return { ok: false, motivo: "limite" };
  if (!Array.isArray(d.categoria_ids) || !d.categoria_ids.length) return { ok: false, motivo: "categorias" };
  if (d.categoria_ids.some((id) => { const c = buscarCategoria(datos, id); return !c || c.tipo !== "gasto"; })) return { ok: false, motivo: "categoria_invalida" };
  if (!PERIODOS.includes(d.periodo)) return { ok: false, motivo: "periodo" };
  if (d.periodo === "rango" && !(esIso(d.fecha_inicio) && esIso(d.fecha_fin) && d.fecha_inicio <= d.fecha_fin)) return { ok: false, motivo: "rango" };
  if (d.periodo === "semestre" && d.semestre_id && !(datos.semestres || []).some((s) => s.id === d.semestre_id)) return { ok: false, motivo: "semestre" };
  const repetido = (datos.sobres || []).some((s) => s.id !== idActual && !s.archivado && normalizar(s.nombre) === normalizar(d.nombre));
  return repetido ? { ok: false, motivo: "repetido" } : { ok: true, limite };
}

/** `desde` = día en que empieza a valer el sobre; el arrastre nunca mira antes (no inventa historial). */
function crearSobre(datos, { nombre, categoriaIds, limite, periodo, arrastraSobrante = false, desde = hoyIso(), semestreId = null, fechaInicio = null, fechaFin = null } = {}) {
  const d = { nombre, limite, categoria_ids: [...new Set(categoriaIds || [])], periodo, semestre_id: semestreId, fecha_inicio: fechaInicio, fecha_fin: fechaFin };
  const v = validarSobre(datos, d);
  if (!v.ok) return v;
  if (!esIso(desde)) return { ok: false, motivo: "desde" };
  const sobre = { id: nuevoId(), nombre: String(nombre).trim(), categoria_ids: d.categoria_ids, limite: v.limite, periodo, arrastra_sobrante: !!arrastraSobrante && (periodo === "semana" || periodo === "mes"),
    desde, ...(periodo === "semestre" && semestreId ? { semestre_id: semestreId } : {}), ...(periodo === "rango" ? { fecha_inicio: fechaInicio, fecha_fin: fechaFin } : {}), archivado: false };
  sellarTimestamp(sobre);
  (datos.sobres = datos.sobres || []).push(sobre);
  return { ok: true, sobre };
}

function editarSobre(datos, id, cambios = {}) {
  const sobre = (datos.sobres || []).find((s) => s.id === id);
  if (!sobre) return { ok: false, motivo: "sobre" };
  const m = { nombre: cambios.nombre ?? sobre.nombre, limite: cambios.limite ?? sobre.limite, categoria_ids: cambios.categoriaIds ?? sobre.categoria_ids,
    periodo: cambios.periodo ?? sobre.periodo, semestre_id: cambios.semestreId !== undefined ? cambios.semestreId : sobre.semestre_id,
    fecha_inicio: cambios.fechaInicio ?? sobre.fecha_inicio, fecha_fin: cambios.fechaFin ?? sobre.fecha_fin };
  const v = validarSobre(datos, m, id);
  if (!v.ok) return v;
  Object.assign(sobre, { nombre: String(m.nombre).trim(), limite: v.limite, categoria_ids: [...new Set(m.categoria_ids)], periodo: m.periodo });
  sobre.semestre_id = m.periodo === "semestre" ? m.semestre_id || null : undefined; sobre.fecha_inicio = m.periodo === "rango" ? m.fecha_inicio : undefined; sobre.fecha_fin = m.periodo === "rango" ? m.fecha_fin : undefined;
  if (cambios.arrastraSobrante !== undefined) sobre.arrastra_sobrante = !!cambios.arrastraSobrante && (m.periodo === "semana" || m.periodo === "mes");
  if (m.periodo !== "semana" && m.periodo !== "mes") sobre.arrastra_sobrante = false;
  ["semestre_id", "fecha_inicio", "fecha_fin"].forEach((k) => { if (sobre[k] === undefined) delete sobre[k]; });
  sellarTimestamp(sobre);
  return { ok: true, sobre };
}

/** Archivar oculta el sobre sin perder nada. Eliminar lo borra con tombstone; los movimientos no se tocan nunca. */
function archivarSobre(datos, id, archivar = true) {
  const s = (datos.sobres || []).find((x) => x.id === id);
  if (!s) return { ok: false, motivo: "sobre" };
  s.archivado = !!archivar; sellarTimestamp(s);
  return { ok: true, sobre: s };
}
function eliminarSobre(datos, id) {
  if (!(datos.sobres || []).some((s) => s.id === id)) return { ok: false, motivo: "sobre" };
  datos.sobres = datos.sobres.filter((s) => s.id !== id);
  if (!Array.isArray(datos._eliminados_sobres)) datos._eliminados_sobres = [];
  if (!datos._eliminados_sobres.some((t) => t.id === id)) datos._eliminados_sobres.push({ id, eliminadoEn: Date.now() });
  return { ok: true };
}

/* ===================== Resumen mensual por categoría ===================== */

const mesDe = (iso) => iso.slice(0, 7);
function mesAnterior(mes) { const [a, m] = mes.split("-").map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`; }

/** Totales por categoría de un mes. Lo sin categoría va aparte, así nada se pierde ni se esconde. */
function totalesDelMes(datos, tipo, mes, hoy) {
  const [a, m] = mes.split("-").map(Number);
  const desde = `${mes}-01`, hasta = finDeMes(a, m);
  const modulos = obtenerModulosFinanzas(datos);
  const tope = hasta < hoy ? hasta : hoy;
  const porCat = new Map(); let total = 0, sin = 0;
  const prio = { esencial: 0, flexible: 0, sinMarcar: 0 }; // Esencial o Flexible según la marca de la categoría; lo demás, sin marcar
  const sumar = (catId, monto) => {
    total += monto;
    const cat = catId ? buscarCategoria(datos, catId) : null;
    prio[cat && (cat.prioridad === "esencial" || cat.prioridad === "flexible") ? cat.prioridad : "sinMarcar"] += monto;
    if (!cat) sin += monto; else porCat.set(catId, (porCat.get(catId) || 0) + monto);
  };
  movimientosVigentes(datos, hoy).forEach((mov) => {
    if (mov.tipo !== tipo || !movimientoVisible(mov, modulos)) return;
    if (mov.recurrente) ocurrenciasRecurrente(mov.recurrente, sumarDias(desde, -1), tope).forEach(() => sumar(mov.categoria_id, Number(mov.recurrente.monto_por_pago) || 0));
    else if (mov.fecha_registro >= desde && mov.fecha_registro <= tope) sumar(mov.categoria_id, Number(mov.monto) || 0);
  });
  total = redondear(total); sin = redondear(sin);
  const categorias = [...porCat.entries()].map(([id, monto]) => { const c = buscarCategoria(datos, id); return { id, nombre: c.nombre, emoji: c.emoji, color: c.color, archivada: !!c.archivada, monto: redondear(monto), porcentaje: total > 0 ? Math.round((monto / total) * 100) : 0 }; })
    .sort((x, y) => y.monto - x.monto);
  return { total, categorias, sinCategoria: { monto: sin, porcentaje: total > 0 ? Math.round((sin / total) * 100) : 0 },
    prioridad: { esencial: redondear(prio.esencial), flexible: redondear(prio.flexible), sinMarcar: redondear(prio.sinMarcar) } };
}

/**
 * Resumen mensual: gastos e ingresos por categoría y comparación con el mes anterior, sin juicios.
 * La comparación es informativa ("Gastaste 12 % menos que en septiembre"): texto neutro, sin culpa.
 * Si el mes anterior no tiene gastos, no hay comparación (no divide entre cero ni inventa).
 */
function resumenMensual(datos, { mes, hoy = hoyIso() } = {}) {
  mes = mes || mesDe(hoy);
  const gastos = totalesDelMes(datos, "gasto", mes, hoy), ingresos = totalesDelMes(datos, "ingreso", mes, hoy);
  const previo = totalesDelMes(datos, "gasto", mesAnterior(mes), hoy);
  const comparacion = previo.total > 0 ? { mesAnterior: mesAnterior(mes), totalAnterior: previo.total, diferencia: redondear(gastos.total - previo.total), porcentaje: Math.round(((gastos.total - previo.total) / previo.total) * 100) } : null;
  return { mes, gastos, ingresos, comparacion, balance: redondear(ingresos.total - gastos.total) };
}

export {
  PERIODOS, UMBRAL_AMBAR, llenarPlantilla,
  archivarSobre, calcularArrastre, crearSobre, editarSobre, eliminarSobre, gastosEnPeriodo, inicioSemana, listarSobres,
  periodoDelSobre, rangoDeSemestre, resumenMensual, resumirSobre, sobresDeCategoria, sobresEnRiesgo, validarSobre,
};
