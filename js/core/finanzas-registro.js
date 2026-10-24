/* =========================================================================
   FINANZAS 2.0 — Registro rápido y saldo (sesión 1, F3)
   Lógica pura, sin DOM. Aquí viven: plantillas recientes, último tipo usado,
   alta de movimientos desde el registro rápido, "Ajustar saldo" (ajuste
   aparte, nunca gasto ni ingreso) y quitar un movimiento (Deshacer) dejando
   tumba para que la sincronización no lo resucite.
   Nada se guarda como contador: las plantillas se DERIVAN de los movimientos.
   ========================================================================= */

import { crearMovimiento, hoyIso } from "./finanzas-modelo.js";
import { calcularTotalesMovimientos, movimientoVisible, obtenerModulosFinanzas } from "./finanzas-derivados.js";

/** Los 3 tipos que ofrece el registro rápido. */
const TIPOS_REGISTRO_RAPIDO = ["gasto", "ingreso", "ahorro"];

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** "5.000,50" / "5000.5" / "5 000" → número. Vacío o inválido → 0. */
function parsearMonto(texto) {
  if (typeof texto === "number") return Number.isFinite(texto) ? texto : 0;
  let s = String(texto || "").trim().replace(/\s/g, "");
  if (!s) return 0;
  const ultimaComa = s.lastIndexOf(","), ultimoPunto = s.lastIndexOf(".");
  if (ultimaComa >= 0 && ultimoPunto >= 0) {
    // El separador que aparece último es el decimal; el otro es de miles.
    s = ultimaComa > ultimoPunto ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (ultimaComa >= 0) {
    // Solo comas: una sola con 1-2 dígitos detrás es decimal; si no, son de miles.
    const partes = s.split(",");
    s = partes.length === 2 && partes[1].length <= 2 ? s.replace(",", ".") : s.replace(/,/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** Movimientos de una persona que sirven de plantilla: manuales, no recurrentes, con nombre. */
function candidatosPlantilla(datos) {
  const modulos = obtenerModulosFinanzas(datos);
  return (datos.movimientos || [])
    .map((m, indice) => ({ m, indice }))
    .filter(({ m }) =>
      TIPOS_REGISTRO_RAPIDO.includes(m.tipo) && m.origen === "manual" && !m.recurrente &&
      String(m.nombre || "").trim() && movimientoVisible(m, modulos));
}

/**
 * Plantillas recientes derivadas del historial: una por (tipo, nombre), la más
 * reciente primero (por fecha y, a igual fecha, por orden de alta). Cada una
 * trae el último monto usado para ese nombre. `max` por defecto 6.
 */
function plantillasRecientes(datos, max = 6) {
  const vistas = new Map();
  candidatosPlantilla(datos)
    .sort((a, b) => {
      const fa = a.m.fecha_registro || "", fb = b.m.fecha_registro || "";
      return fa === fb ? b.indice - a.indice : fb.localeCompare(fa);
    })
    .forEach(({ m }) => {
      const nombre = String(m.nombre).trim();
      const clave = `${m.tipo}|${nombre.toLowerCase()}`;
      if (!vistas.has(clave)) {
        vistas.set(clave, { tipo: m.tipo, nombre, monto: Number(m.monto) || 0, metaId: m.tipo === "ahorro" ? m.meta_id || null : null, fuente: m.tipo === "ahorro" ? m.fuente || "liquido" : null });
      }
    });
  return [...vistas.values()].slice(0, Math.max(0, max));
}

/** Tipo del último movimiento manual registrado (o "gasto" si no hay ninguno). */
function ultimoTipoUsado(datos) {
  const lista = (datos.movimientos || []).filter((m) => TIPOS_REGISTRO_RAPIDO.includes(m.tipo) && m.origen === "manual" && !m.recurrente);
  if (!lista.length) return "gasto";
  const ultimo = lista.reduce((a, b, i) => {
    const fa = a.m.fecha_registro || "", fb = b.fecha_registro || "";
    return fb > fa || (fb === fa && i > a.i) ? { m: b, i } : a;
  }, { m: lista[0], i: 0 });
  return ultimo.m.tipo;
}

/** Quién puede usar cada tipo con los módulos actuales (ahorro necesita Ahorros + al menos una meta activa). */
function tiposDisponiblesRegistroRapido(datos) {
  const modulos = obtenerModulosFinanzas(datos);
  const hayMetaActiva = (datos.metas || []).some((x) => !x.archivada);
  const tipos = [];
  if (modulos.gastos) tipos.push("gasto", "ingreso");
  if (modulos.ahorros && hayMetaActiva) tipos.push("ahorro");
  return tipos;
}

/**
 * Alta desde el registro rápido. No guarda nada si falta lo mínimo.
 * Devuelve { ok:true, movimiento } o { ok:false, motivo } (motivo: "monto" | "meta" | "tipo").
 * El llamador marca el cambio pendiente.
 */
function registrarMovimientoRapido(datos, { tipo, monto, nombre, fecha, nota, metaId, fuente, semestreId }) {
  if (!TIPOS_REGISTRO_RAPIDO.includes(tipo)) return { ok: false, motivo: "tipo" };
  const valor = redondear(Math.abs(parsearMonto(monto)));
  if (!(valor > 0)) return { ok: false, motivo: "monto" };
  if (tipo === "ahorro" && !(datos.metas || []).some((x) => x.id === metaId && !x.archivada)) return { ok: false, motivo: "meta" };
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  const movimiento = crearMovimiento({
    tipo, monto: valor, nombre: String(nombre || "").trim(),
    fechaRegistro: fecha || hoyIso(), nota: String(nota || "").trim() || null,
    semestreId: semestreId || null, metaId: tipo === "ahorro" ? metaId : null, fuente: tipo === "ahorro" ? fuente : null,
  });
  datos.movimientos.push(movimiento);
  return { ok: true, movimiento };
}

/** ¿Tiene sentido ofrecer "Ajustar saldo"? Mi dinero solo existe si hay gastos, matrícula o beca encendidos. */
function puedeAjustarSaldo(datos) {
  return movimientoVisible({ tipo: "ajuste" }, obtenerModulosFinanzas(datos));
}

/** Diferencia entre lo que la persona dice tener y lo que la app calcula en Mi dinero (+ = falta, − = sobra). */
function calcularDiferenciaSaldo(datos, saldoReal) {
  return redondear(parsearMonto(saldoReal) - calcularTotalesMovimientos(datos).saldoLiquido);
}

/** Id fijo del saldo inicial: dos dispositivos que lo creen sin conexión producen el mismo id y la fusión no lo duplica. */
const ID_SALDO_INICIAL = "mov_saldo_inicial";

/** El id fijo solo sirve si nunca se usó ni se quitó (una tumba lo mataría para siempre en la fusión). */
function idSaldoInicialDisponible(datos) {
  return !(datos.movimientos || []).some((m) => m.id === ID_SALDO_INICIAL) &&
    !(datos._eliminados_movimientos || []).some((t) => t.id === ID_SALDO_INICIAL);
}

/**
 * Crea el ajuste que deja Mi dinero igual a `saldoReal`. Un ajuste NO es gasto ni ingreso:
 * no cambia totalGastado, totalIngresos, totalBecas ni balanceNeto.
 * Si no hay diferencia no crea nada. `saldoInicial: true` lo llama "Saldo inicial" y le da un id fijo
 * (solo la primera vez; si ya existió o se quitó, queda como un ajuste normal).
 */
function ajustarSaldo(datos, { saldoReal, saldoInicial = false, fecha, nota }) {
  const diferencia = calcularDiferenciaSaldo(datos, saldoReal);
  if (diferencia === 0) return { ok: true, movimiento: null, diferencia: 0 };
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  const esInicial = saldoInicial && idSaldoInicialDisponible(datos);
  const movimiento = crearMovimiento({
    id: esInicial ? ID_SALDO_INICIAL : undefined,
    tipo: "ajuste", sentido: diferencia > 0 ? "suma" : "resta", monto: Math.abs(diferencia),
    nombre: esInicial ? "Saldo inicial" : "Ajuste de saldo",
    fechaRegistro: fecha || hoyIso(), nota: String(nota || "").trim() || null,
  });
  datos.movimientos.push(movimiento);
  return { ok: true, movimiento, diferencia };
}

/**
 * Quita un movimiento y deja tumba en _eliminados_movimientos (mismo formato que metas:
 * { id, eliminadoEn }), para que la fusión entre dispositivos no lo resucite.
 * Devuelve true si existía. El llamador marca el cambio pendiente.
 */
function quitarMovimiento(datos, id) {
  const lista = datos.movimientos || [];
  const indice = lista.findIndex((m) => m.id === id);
  if (indice < 0) return false;
  lista.splice(indice, 1);
  if (!Array.isArray(datos._eliminados_movimientos)) datos._eliminados_movimientos = [];
  if (!datos._eliminados_movimientos.some((t) => t.id === id)) datos._eliminados_movimientos.push({ id, eliminadoEn: Date.now() });
  return true;
}

/**
 * Guard de reentrada: ejecuta `accion` una sola vez mientras la anterior no termine
 * (y durante `espera` ms después, para absorber el doble toque). Devuelve el resultado
 * de la primera llamada o undefined si se ignoró.
 */
function crearGuardReentrada(espera = 600) {
  let ocupado = false;
  return (accion) => {
    if (ocupado) return undefined;
    ocupado = true;
    try { return accion(); } finally { setTimeout(() => { ocupado = false; }, espera); }
  };
}

export {
  ID_SALDO_INICIAL,
  TIPOS_REGISTRO_RAPIDO,
  ajustarSaldo,
  calcularDiferenciaSaldo,
  crearGuardReentrada,
  parsearMonto,
  plantillasRecientes,
  puedeAjustarSaldo,
  quitarMovimiento,
  registrarMovimientoRapido,
  tiposDisponiblesRegistroRapido,
  ultimoTipoUsado,
};
