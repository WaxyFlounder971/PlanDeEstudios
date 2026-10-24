/* =========================================================================
   FINANZAS 2.0: Compromisos y Plan del semestre (sesión 2, F1)
   Lógica pura, sin DOM. Un compromiso es algo PLANEADO: una cuota de
   matrícula o un desembolso esperado (beca, ayuda familiar, trabajo). Al
   confirmarlo crea EXACTAMENTE un movimiento real, con id determinista
   ("mov_" + id del compromiso): confirmar dos veces, o desde dos
   dispositivos, no duplica. Nada se guarda como contador: lo planificado,
   lo confirmado y lo vencido se DERIVAN.
   Reglas:
   - Un compromiso omitido o eliminado NO borra el movimiento que ya creó.
   - Un compromiso solo vuelve a pendiente si su movimiento ya no existe
     (así nunca queda un pago real sin vínculo que se pueda confirmar otra vez).
   - La migración no toca movimientos ni metas: solo asegura las colecciones
     nuevas y deja un flag. Lo ya registrado queda como "hecho sin compromiso".
   ========================================================================= */

import { sellarTimestamp } from "./schema.js";
import { crearMovimiento, hoyIso } from "./finanzas-modelo.js";
import { movimientoVisible, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { parsearMonto, quitarMovimiento } from "./finanzas-registro.js";

/** `recurrente` queda previsto para la sesión 3 (Disponible); la pantalla de esta sesión no lo ofrece. */
const TIPOS_COMPROMISO = ["matricula", "ingreso_esperado", "recurrente"];
const SUBTIPOS_INGRESO = ["beca", "ayuda_familiar", "trabajo"];
const ESTADOS_COMPROMISO = ["pendiente", "cumplido", "omitido"];
const FRECUENCIAS_GENERADOR = ["mensual", "quincenal", "semanal"];
const MAX_CUOTAS = 60;
const FLAG_MIGRACION_FINANZAS2 = "migracion_finanzas2_v1";

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/* ===================== Fechas (siempre texto "YYYY-MM-DD", sin zonas horarias) ===================== */

function esFechaIso(texto) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(texto || ""));
  if (!m) return false;
  const [a, me, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const f = new Date(Date.UTC(a, me - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === me - 1 && f.getUTCDate() === d;
}

const aIso = (f) => f.toISOString().slice(0, 10);

function sumarDias(iso, n) {
  const [a, m, d] = iso.split("-").map(Number);
  return aIso(new Date(Date.UTC(a, m - 1, d + n)));
}

/** Suma `n` meses conservando el día de `diaAncla` (si el mes es más corto, usa su último día). */
function sumarMeses(iso, n, diaAncla) {
  const [a, m] = iso.split("-").map(Number);
  const total = m - 1 + n;
  const anio = a + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12;
  const diasMes = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return aIso(new Date(Date.UTC(anio, mes, Math.min(diaAncla, diasMes))));
}

/** Fechas de `cantidad` pagos desde `primera`. Sin fecha inicial devuelve fechas nulas. */
function fechasDePagos(primera, cantidad, frecuencia) {
  if (!esFechaIso(primera)) return Array.from({ length: cantidad }, () => null);
  const ancla = Number(primera.slice(8, 10));
  return Array.from({ length: cantidad }, (_, i) => {
    if (frecuencia === "semanal") return sumarDias(primera, 7 * i);
    if (frecuencia === "quincenal") return sumarDias(primera, 14 * i);
    return sumarMeses(primera, i, ancla);
  });
}

/* ===================== Fábrica ===================== */

/**
 * Compromiso. `monto` siempre positivo. `afecta_saldo` solo tiene sentido en matrícula
 * (apagado por defecto: a muchas personas se la paga su familia) y en recurrentes (encendido);
 * en un ingreso esperado siempre es false. `serie_id` agrupa las cuotas generadas juntas.
 */
function crearCompromiso({ id, tipo, subtipo, nombre, monto, fechaPrevista, semestreId, afectaSaldo, serieId }) {
  const tipoValido = TIPOS_COMPROMISO.includes(tipo) ? tipo : "matricula";
  const esIngreso = tipoValido === "ingreso_esperado";
  return sellarTimestamp({
    id: id || "cmp_" + crypto.randomUUID(),
    tipo: tipoValido,
    subtipo: esIngreso ? (SUBTIPOS_INGRESO.includes(subtipo) ? subtipo : "beca") : null,
    nombre: String(nombre || "").trim(),
    monto: Math.abs(redondear(parsearMonto(monto))),
    fecha_prevista: esFechaIso(fechaPrevista) ? fechaPrevista : null,
    semestre_id: semestreId || null,
    estado: "pendiente",
    afecta_saldo: esIngreso ? false : afectaSaldo === undefined ? tipoValido === "recurrente" : !!afectaSaldo,
    movimiento_id: null,
    serie_id: serieId || null,
  });
}

/** Qué movimiento crea un compromiso al confirmarse. */
function describirMovimientoDe(c) {
  if (c.tipo === "matricula") return { tipo: "gasto", origen: "matricula" };
  if (c.tipo === "ingreso_esperado") return { tipo: "ingreso", origen: c.subtipo === "beca" ? "beca" : "manual" };
  return { tipo: "gasto", origen: "manual" };
}

const idMovimientoBase = (compromisoId) => "mov_" + compromisoId;

/* ===================== Generador de cuotas ===================== */

/** Reparte `total` en `n` partes trabajando en centavos: la suma cuadra exacto, el residuo va en la última. */
function repartirMonto(total, n) {
  const partes = Math.max(1, Math.floor(Number(n)) || 1);
  const centavos = Math.round((Number(total) || 0) * 100);
  const base = Math.floor(centavos / partes);
  const resto = centavos - base * partes;
  return Array.from({ length: partes }, (_, i) => (base + (i === partes - 1 ? resto : 0)) / 100);
}

/**
 * Arma (sin guardar) las cuotas de un plan. Devuelve { ok:true, compromisos } o { ok:false, motivo }
 * con motivo: "tipo" | "monto" | "cantidad" | "semestre" | "fecha".
 * `modo`: "total" (se divide entre `cantidad`) o "por_pago" (cada pago vale `monto`).
 * Matrícula y beca exigen un semestre vigente; ayuda familiar y trabajo pueden ir sin semestre.
 */
function construirCuotas(datos, { tipo, subtipo, semestreId, nombreBase, modo, monto, cantidad, fechaPrimera, frecuencia, afectaSaldo }) {
  const esMatricula = tipo === "matricula";
  const esIngreso = tipo === "ingreso_esperado";
  if (!esMatricula && !esIngreso) return { ok: false, motivo: "tipo" };
  const valor = redondear(Math.abs(parsearMonto(monto)));
  if (!(valor > 0)) return { ok: false, motivo: "monto" };
  const n = Number(cantidad);
  if (!(Number.isInteger(n) && n >= 1 && n <= MAX_CUOTAS)) return { ok: false, motivo: "cantidad" };
  const requiereSemestre = esMatricula || subtipo === "beca" || !SUBTIPOS_INGRESO.includes(subtipo);
  if (requiereSemestre && !semestreId) return { ok: false, motivo: "semestre" };
  if (semestreId && !(datos.semestres || []).some((s) => s.id === semestreId)) return { ok: false, motivo: "semestre" };
  if (fechaPrimera && !esFechaIso(fechaPrimera)) return { ok: false, motivo: "fecha" };

  const montos = modo === "por_pago" ? Array.from({ length: n }, () => valor) : repartirMonto(valor, n);
  if (montos.some((m) => !(m > 0))) return { ok: false, motivo: "monto" };
  const fechas = fechasDePagos(fechaPrimera, n, FRECUENCIAS_GENERADOR.includes(frecuencia) ? frecuencia : "mensual");
  const serieId = n > 1 ? "ser_" + crypto.randomUUID() : null;
  const base = String(nombreBase || "").trim();
  const compromisos = montos.map((m, i) => crearCompromiso({
    tipo, subtipo, semestreId, serieId, afectaSaldo,
    nombre: n > 1 ? `${base || "Pago"} ${i + 1} de ${n}` : base || "Pago",
    monto: m, fechaPrevista: fechas[i],
  }));
  return { ok: true, compromisos };
}

/** Igual que construirCuotas, pero las guarda en `datos.compromisos`. El llamador marca el cambio pendiente. */
function generarCuotas(datos, parametros) {
  const r = construirCuotas(datos, parametros);
  if (!r.ok) return r;
  if (!Array.isArray(datos.compromisos)) datos.compromisos = [];
  r.compromisos.forEach((c) => datos.compromisos.push(c));
  return r;
}

/* ===================== Acciones sobre un compromiso ===================== */

const buscar = (datos, id) => (datos.compromisos || []).find((c) => c.id === id) || null;
const buscarMovimiento = (datos, id) => (id ? (datos.movimientos || []).find((m) => m.id === id) || null : null);

/** Id libre para el movimiento: el determinista; si ya se usó y se quitó (tumba), uno con sufijo. */
function elegirIdMovimiento(datos, compromisoId) {
  const base = idMovimientoBase(compromisoId);
  const tumbas = new Set((datos._eliminados_movimientos || []).map((t) => t.id));
  if (!tumbas.has(base)) return base;
  let k = 1;
  while (tumbas.has(`${base}_r${k}`) || buscarMovimiento(datos, `${base}_r${k}`)) k++;
  return `${base}_r${k}`;
}

/**
 * Confirma un compromiso: crea su movimiento (una sola vez) y lo marca cumplido.
 * `monto` y `fecha` son opcionales (por defecto el monto planeado y hoy).
 * Devuelve { ok:true, compromiso, movimiento, creado } o { ok:false, motivo }
 * con motivo: "no_existe" | "monto" | "fecha" | "sin_movimiento".
 * `creado:false` = ya estaba confirmado (o el movimiento ya llegó de otro dispositivo): no se duplica.
 */
function confirmarCompromiso(datos, id, { monto, fecha } = {}) {
  const c = buscar(datos, id);
  if (!c) return { ok: false, motivo: "no_existe" };
  if (c.estado === "cumplido") {
    const existente = buscarMovimiento(datos, c.movimiento_id);
    return existente ? { ok: true, compromiso: c, movimiento: existente, creado: false } : { ok: false, motivo: "sin_movimiento" };
  }
  const valor = monto === undefined || monto === "" ? c.monto : redondear(Math.abs(parsearMonto(monto)));
  if (!(valor > 0)) return { ok: false, motivo: "monto" };
  if (fecha && !esFechaIso(fecha)) return { ok: false, motivo: "fecha" };

  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  // Otro dispositivo ya pudo confirmarlo: si el movimiento determinista existe, solo se vincula.
  const yaCreado = buscarMovimiento(datos, idMovimientoBase(c.id));
  let movimiento = yaCreado;
  if (!movimiento) {
    const { tipo, origen } = describirMovimientoDe(c);
    movimiento = crearMovimiento({
      id: elegirIdMovimiento(datos, c.id), tipo, origen, nombre: c.nombre, monto: valor,
      fechaRegistro: fecha || hoyIso(), semestreId: c.semestre_id, compromisoId: c.id,
    });
    datos.movimientos.push(movimiento);
  }
  c.estado = "cumplido";
  c.movimiento_id = movimiento.id;
  sellarTimestamp(c);
  return { ok: true, compromiso: c, movimiento, creado: !yaCreado };
}

/** Deshace una confirmación recién hecha: quita su movimiento (con tumba) y vuelve a pendiente. */
function deshacerConfirmacion(datos, id) {
  const c = buscar(datos, id);
  if (!c || c.estado !== "cumplido") return false;
  if (c.movimiento_id) quitarMovimiento(datos, c.movimiento_id);
  c.estado = "pendiente";
  c.movimiento_id = null;
  sellarTimestamp(c);
  return true;
}

/** Omitir solo aplica a un pendiente. */
function omitirCompromiso(datos, id) {
  const c = buscar(datos, id);
  if (!c || c.estado !== "pendiente") return false;
  c.estado = "omitido";
  sellarTimestamp(c);
  return true;
}

/**
 * Reabre un omitido, o un cumplido cuyo movimiento ya no existe. Un cumplido con su movimiento vivo
 * NO se reabre (habría dos pagos para un mismo compromiso): primero se quita el movimiento o se usa Deshacer.
 * Devuelve true si cambió algo.
 */
function reabrirCompromiso(datos, id) {
  const c = buscar(datos, id);
  if (!c || c.estado === "pendiente") return false;
  if (c.estado === "cumplido" && buscarMovimiento(datos, c.movimiento_id)) return false;
  c.estado = "pendiente";
  c.movimiento_id = null;
  sellarTimestamp(c);
  return true;
}

/** Edita un compromiso que aún no se confirmó. Solo cambia lo que llega. Devuelve { ok } o { ok:false, motivo }. */
function editarCompromiso(datos, id, { nombre, monto, fechaPrevista, afectaSaldo, semestreId }) {
  const c = buscar(datos, id);
  if (!c) return { ok: false, motivo: "no_existe" };
  if (c.estado === "cumplido") return { ok: false, motivo: "cumplido" };
  if (monto !== undefined) {
    const v = redondear(Math.abs(parsearMonto(monto)));
    if (!(v > 0)) return { ok: false, motivo: "monto" };
    c.monto = v;
  }
  if (nombre !== undefined) c.nombre = String(nombre).trim();
  if (fechaPrevista !== undefined) {
    if (fechaPrevista && !esFechaIso(fechaPrevista)) return { ok: false, motivo: "fecha" };
    c.fecha_prevista = fechaPrevista || null;
  }
  if (afectaSaldo !== undefined && c.tipo !== "ingreso_esperado") c.afecta_saldo = !!afectaSaldo;
  if (semestreId !== undefined) c.semestre_id = semestreId || null;
  sellarTimestamp(c);
  return { ok: true, compromiso: c };
}

/**
 * Elimina un compromiso (con tumba). El movimiento que ya hubiera creado se queda: es un pago real.
 * Devuelve true si existía.
 */
function eliminarCompromiso(datos, id) {
  const lista = datos.compromisos || [];
  const i = lista.findIndex((c) => c.id === id);
  if (i < 0) return false;
  lista.splice(i, 1);
  if (!Array.isArray(datos._eliminados_compromisos)) datos._eliminados_compromisos = [];
  if (!datos._eliminados_compromisos.some((t) => t.id === id)) datos._eliminados_compromisos.push({ id, eliminadoEn: Date.now() });
  return true;
}

/**
 * Reajusta el monto de los pendientes de una serie (por ejemplo, cuando la beca sube).
 * Con `desdeFecha` solo los de esa fecha en adelante (los que no tienen fecha también entran).
 * Nunca toca un cumplido ni un omitido. Devuelve cuántos cambió.
 */
function reajustarSerie(datos, serieId, nuevoMonto, desdeFecha = null) {
  const valor = redondear(Math.abs(parsearMonto(nuevoMonto)));
  if (!serieId || !(valor > 0)) return 0;
  let cambiados = 0;
  (datos.compromisos || []).forEach((c) => {
    if (c.serie_id !== serieId || c.estado !== "pendiente" || c.monto === valor) return;
    if (desdeFecha && c.fecha_prevista && c.fecha_prevista < desdeFecha) return;
    c.monto = valor;
    sellarTimestamp(c);
    cambiados++;
  });
  return cambiados;
}

/* ===================== Derivados (nada se guarda) ===================== */

/** ¿Se ve con los módulos actuales? Mismas reglas que el movimiento que crearía. */
function compromisoVisible(c, modulos) {
  return movimientoVisible(describirMovimientoDe(c), modulos);
}

/** Compromisos que la persona debe ver: módulo encendido y semestre vigente. */
function obtenerCompromisosVisibles(datos) {
  const modulos = obtenerModulosFinanzas(datos);
  const semestres = new Set((datos.semestres || []).map((s) => s.id));
  return (datos.compromisos || []).filter((c) => compromisoVisible(c, modulos) && (!c.semestre_id || semestres.has(c.semestre_id)));
}

/** "pendiente" | "vencido" | "cumplido" | "omitido" | "sin_movimiento" (cumplido, pero su movimiento se eliminó). */
function estadoVisibleCompromiso(c, datos, hoy = hoyIso()) {
  if (c.estado === "omitido") return "omitido";
  if (c.estado === "cumplido") return buscarMovimiento(datos, c.movimiento_id) ? "cumplido" : "sin_movimiento";
  return c.fecha_prevista && c.fecha_prevista < hoy ? "vencido" : "pendiente";
}

/** Por fecha prevista (sin fecha al final); a igual fecha, por nombre con números naturales ("Cuota 2" antes de "Cuota 10"). */
function ordenarCompromisos(lista) {
  return lista.slice().sort((a, b) => {
    const fa = a.fecha_prevista || "", fb = b.fecha_prevista || "";
    if (fa !== fb) return !fa ? 1 : !fb ? -1 : fa.localeCompare(fb);
    return String(a.nombre).localeCompare(String(b.nombre), "es", { numeric: true });
  });
}

/** Totales de una lista: confirmado (lo que de verdad se pagó o recibió), pendiente (lo que falta) y vencidos. */
function resumirCompromisos(lista, datos, hoy = hoyIso()) {
  const r = { confirmado: 0, pendiente: 0, vencidos: 0 };
  lista.forEach((c) => {
    const estado = estadoVisibleCompromiso(c, datos, hoy);
    if (estado === "cumplido") r.confirmado += Number(buscarMovimiento(datos, c.movimiento_id).monto) || 0;
    else if (estado === "pendiente" || estado === "vencido") {
      r.pendiente += c.monto;
      if (estado === "vencido") r.vencidos++;
    }
  });
  r.confirmado = redondear(r.confirmado);
  r.pendiente = redondear(r.pendiente);
  return r;
}

/* ===================== Migración ===================== */

/**
 * Idempotente y NO destructiva. Solo asegura las colecciones nuevas y deja el flag; no lee ni
 * reescribe `movimientos` ni `metas`: lo ya registrado queda como "hecho sin compromiso".
 * Sin sellarTimestamp a propósito: todos los dispositivos rellenan lo mismo (no hay conflicto que fusionar).
 * Devuelve true solo la primera vez (cuando puso el flag).
 */
function migrarFinanzas2V1(datos) {
  if (!datos) return false;
  if (!Array.isArray(datos.compromisos)) datos.compromisos = [];
  if (!Array.isArray(datos._eliminados_compromisos)) datos._eliminados_compromisos = [];
  if (!datos.configuracion) datos.configuracion = {};
  if (datos.configuracion[FLAG_MIGRACION_FINANZAS2] === true) return false;
  datos.configuracion[FLAG_MIGRACION_FINANZAS2] = true;
  return true;
}

export {
  ESTADOS_COMPROMISO,
  FLAG_MIGRACION_FINANZAS2,
  FRECUENCIAS_GENERADOR,
  MAX_CUOTAS,
  SUBTIPOS_INGRESO,
  TIPOS_COMPROMISO,
  compromisoVisible,
  confirmarCompromiso,
  construirCuotas,
  crearCompromiso,
  deshacerConfirmacion,
  describirMovimientoDe,
  editarCompromiso,
  eliminarCompromiso,
  esFechaIso,
  estadoVisibleCompromiso,
  fechasDePagos,
  generarCuotas,
  migrarFinanzas2V1,
  obtenerCompromisosVisibles,
  omitirCompromiso,
  ordenarCompromisos,
  reabrirCompromiso,
  reajustarSerie,
  repartirMonto,
  resumirCompromisos,
};
