/* =========================================================================
   FINANZAS 2.0 — Modelo único de movimientos y metas (etapa 0A)
   Va en core/, junto a schema.js. Sin UI. Todo saldo/total se DERIVA
   (ver finanzas-derivados.js); aquí solo hay fábricas y la migración.
   ========================================================================= */

import { sellarTimestamp, calcularPagosRecurrentesTranscurridos } from "../schema.js";

/**
 * gasto | ingreso | ahorro (aporte a una meta) | transferencia (entre Mi dinero y una meta)
 * | ajuste (corrige Mi dinero para que coincida con la realidad: saldo inicial o diferencia).
 * Un ajuste NUNCA es gasto ni ingreso: solo mueve Mi dinero y no entra en ningún total de gastos/ingresos.
 */
const TIPOS_MOVIMIENTO = ["gasto", "ingreso", "ahorro", "transferencia", "ajuste", "prestamo", "traspaso"];
/** Qué módulo gobierna la visibilidad del movimiento. */
const ORIGENES_MOVIMIENTO = ["manual", "matricula", "beca"];
const MODULOS_FINANZAS_DEFAULT = { matricula: true, beca: true, gastos: true, ahorros: true };
/** Módulos opcionales fuera de los 4 de siempre y de los perfiles: guardan su interruptor aparte y arrancan apagados. */
const MODULOS_OPCIONALES_DEFAULT = { deudas: false };

function hoyIso() {
  const d = new Date();
  const mes = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/**
 * Movimiento. `monto` siempre positivo; el tipo define el signo.
 * - gasto: `pagado_con_meta_id` (opcional) = sale de esa meta, no de Mi dinero.
 * - ahorro: `meta_id` obligatorio; `fuente` "liquido" (resta de Mi dinero) o
 *   "nuevo" (dinero nuevo directo a la meta, no toca Mi dinero).
 * - transferencia: `meta_id` + `sentido` "a_meta" | "desde_meta". Nunca cuenta
 *   como gasto ni ingreso.
 * - ajuste: `sentido` "suma" | "resta" sobre Mi dinero. Nunca cuenta como gasto ni ingreso.
 * - prestamo (módulo Me deben y debo): `prestamo_id` + `sentido` "sale" | "entra" sobre Mi dinero. Nunca es gasto ni ingreso.
 * - traspaso (módulo Cuentas): dinero entre dos cuentas tuyas. `cuenta_id` = de dónde sale (null = "Sin asignar"), `cuenta_destino_id` = adónde
 *   llega (null = "Sin asignar"). Con divisas distintas, `monto_destino` es lo que llegó (lo escribe la persona; no hay conversión).
 *   Nunca es gasto ni ingreso. Gasto, ingreso y ajuste también pueden llevar `cuenta_id` (en qué cuenta ocurrieron).
 * - gasto con `pagado_por_prestamo_id`: lo pagó otra persona; cuenta como gasto pero no baja Mi dinero, y aumenta lo que le debes.
 * - `recurrente` conserva la forma de gastos_u (monto_por_pago, fecha_inicio...).
 * - `fecha_registro` null = sin fecha (datos migrados que nunca la tuvieron).
 * `id` explícito solo lo usa la migración (ids deterministas).
 */
function crearMovimiento({
  id, tipo, nombre, monto, fechaRegistro, nota, semestreId, origen,
  metaId, fuente, sentido, pagadoConMetaId, recurrente, compromisoId, categoriaId, prestamoId, pagadoPorPrestamoId, cuentaId, cuentaDestinoId, montoDestino, repartoDe,
}) {
  const tipoValido = TIPOS_MOVIMIENTO.includes(tipo) ? tipo : "gasto";
  const esMeta = tipoValido === "ahorro" || tipoValido === "transferencia";
  return sellarTimestamp({
    id: id || "mov_" + crypto.randomUUID(),
    tipo: tipoValido,
    nombre: nombre || "",
    monto: Math.abs(Number(monto) || 0),
    fecha_registro: fechaRegistro === undefined ? hoyIso() : fechaRegistro,
    nota: nota || null,
    semestre_id: semestreId || null,
    origen: ORIGENES_MOVIMIENTO.includes(origen) && (tipoValido === "gasto" || tipoValido === "ingreso") ? origen : "manual",
    meta_id: esMeta ? metaId || null : null,
    fuente: tipoValido === "ahorro" ? (fuente === "nuevo" ? "nuevo" : "liquido") : null,
    // transferencia: "a_meta" | "desde_meta". ajuste: "suma" | "resta" (sobre Mi dinero).
    sentido: tipoValido === "transferencia"
      ? (sentido === "desde_meta" ? "desde_meta" : "a_meta")
      : tipoValido === "ajuste" ? (sentido === "resta" ? "resta" : "suma")
      : tipoValido === "prestamo" ? (sentido === "entra" ? "entra" : "sale") : null,
    pagado_con_meta_id: tipoValido === "gasto" ? pagadoConMetaId || null : null,
    recurrente: recurrente || null,
    // Si nació de confirmar un compromiso del Plan (referencia de vuelta; el vínculo principal vive en el compromiso).
    compromiso_id: compromisoId || null,
    // Finanzas 2.0 (sesión 5): categoría opcional. Solo gastos e ingresos se categorizan; el movimiento viejo queda sin categoría.
    categoria_id: tipoValido === "gasto" || tipoValido === "ingreso" ? categoriaId || null : null,
    // Sesión 7A: préstamo al que pertenece el movimiento, o préstamo de quien pagó este gasto por mí. Las claves solo
    // existen cuando se usan: los movimientos de siempre conservan exactamente su forma (la fusión no ve diferencias falsas).
    ...(tipoValido === "prestamo" ? { prestamo_id: prestamoId || null } : {}),
    ...(tipoValido === "gasto" && !pagadoConMetaId && pagadoPorPrestamoId ? { pagado_por_prestamo_id: pagadoPorPrestamoId } : {}),
    // Sesión 7B: cuenta donde ocurrió (gasto, ingreso, ajuste) o traspaso entre cuentas. Solo existen cuando se usan.
    ...((tipoValido === "gasto" || tipoValido === "ingreso" || tipoValido === "ajuste") && cuentaId ? { cuenta_id: cuentaId } : {}),
    // Sesión 8: ingreso del que nació este aporte por una regla de reparto. Solo existe cuando se usa.
    ...(tipoValido === "ahorro" && repartoDe ? { reparto_de: repartoDe } : {}),
    ...(tipoValido === "traspaso" ? { cuenta_id: cuentaId || null, cuenta_destino_id: cuentaDestinoId || null, ...(Number(montoDestino) > 0 ? { monto_destino: Math.round(Number(montoDestino) * 100) / 100 } : {}) } : {}),
  });
}

/** Meta de ahorro (la de gasto llega en una etapa posterior; `tipo` ya queda previsto). */
function crearMeta({ id, nombre, objetivo, saldoInicial, emoji, color, fechaObjetivo, tipo, fechaInicio, categoriaIds }) {
  const esGasto = tipo === "gasto"; // meta de gasto (sesión 8): un tope de gasto en un periodo, medido sobre los gastos reales
  return sellarTimestamp({
    id: id || "meta_" + crypto.randomUUID(),
    tipo: esGasto ? "gasto" : "ahorro",
    nombre: nombre || "",
    objetivo: Number(objetivo) || 0,
    saldo_inicial: Number(saldoInicial) || 0, // "¿cuánto llevas ya?"
    emoji: emoji || "🎯",
    color: color || null,
    fecha_objetivo: fechaObjetivo || null,
    archivada: false,
    // Solo las metas de gasto llevan estas claves: las de ahorro conservan exactamente su forma.
    ...(esGasto ? { fecha_inicio: fechaInicio || null, categoria_ids: Array.isArray(categoriaIds) ? categoriaIds : [] } : {}),
  });
}

/** Monto efectivo de un movimiento: los recurrentes cuentan solo lo ya pagado a hoy. */
function montoEfectivoMovimiento(mov) {
  if (mov.recurrente) return calcularPagosRecurrentesTranscurridos(mov.recurrente).totalPagado;
  return Number(mov.monto) || 0;
}

/**
 * Migración idempotente y NO destructiva: gastos_u, pagos_matricula e
 * ingresos_beca se copian a `movimientos`; los arreglos viejos quedan intactos
 * como respaldo. Ids deterministas ("mov_" + id viejo): dos dispositivos que
 * migren por separado producen el mismo id y la fusión no duplica. Una tumba
 * en _eliminados_movimientos impide resucitar un movimiento borrado.
 * Devuelve cuántos movimientos creó (0 en corridas repetidas).
 */
function migrarFinanzasAMovimientos(datos) {
  if (!datos) return 0;
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  if (!Array.isArray(datos.metas)) datos.metas = [];
  if (!Array.isArray(datos._eliminados_movimientos)) datos._eliminados_movimientos = [];
  if (!Array.isArray(datos._eliminados_metas)) datos._eliminados_metas = [];

  const existentes = new Set(datos.movimientos.map((m) => m.id));
  datos._eliminados_movimientos.forEach((t) => existentes.add(t.id));
  const semestresVigentes = new Set((datos.semestres || []).map((s) => s.id));
  let creados = 0;

  const agregar = (params) => {
    if (existentes.has(params.id)) return;
    const mov = crearMovimiento(params);
    // Sello neutro (0): dos dispositivos que migran por separado producen
    // registros idénticos y la fusión no ve un conflicto falso; cualquier
    // edición real posterior sella con un contador mayor y gana.
    mov._actualizadoEn = 0;
    datos.movimientos.push(mov);
    existentes.add(params.id);
    creados++;
  };

  (datos.gastos_u || []).forEach((g) => {
    agregar({
      id: "mov_" + g.id,
      tipo: g.tipo === "ingreso" ? "ingreso" : "gasto",
      nombre: g.nombre,
      monto: g.recurrente ? 0 : g.costo,
      fechaRegistro: g.recurrente ? g.recurrente.fecha_inicio || null : null,
      nota: g.nota,
      semestreId: g.semestre_id && semestresVigentes.has(g.semestre_id) ? g.semestre_id : null,
      recurrente: g.recurrente ? { ...g.recurrente } : null,
    });
  });

  // Registros de semestres borrados no se migran (igual que hoy: no cuentan en el Resumen).
  (datos.finanzas_semestre || []).filter((r) => semestresVigentes.has(r.semestre_id)).forEach((r) => {
    (r.pagos_matricula || []).forEach((p) => {
      agregar({ id: "mov_" + p.id, tipo: "gasto", origen: "matricula", nombre: p.descripcion || "Matrícula", monto: p.monto, fechaRegistro: p.fecha || null, semestreId: r.semestre_id });
    });
    (r.ingresos_beca || []).forEach((i) => {
      agregar({ id: "mov_" + i.id, tipo: "ingreso", origen: "beca", nombre: i.descripcion || "Beca", monto: i.monto, fechaRegistro: i.fecha || null, semestreId: r.semestre_id });
    });
  });

  return creados;
}

export {
  MODULOS_FINANZAS_DEFAULT,
  MODULOS_OPCIONALES_DEFAULT,
  ORIGENES_MOVIMIENTO,
  TIPOS_MOVIMIENTO,
  crearMeta,
  crearMovimiento,
  hoyIso,
  migrarFinanzasAMovimientos,
  montoEfectivoMovimiento,
};
