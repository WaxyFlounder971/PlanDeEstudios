/* =========================================================================
   FINANZAS 2.0: Reglas de reparto de ingresos hacia metas (sesión 8). Lógica pura sin DOM.
   Una meta de ahorro puede pedir que un porcentaje de cada ingreso (o de cada desembolso de beca)
   se PROPONGA para ella. Es solo una propuesta: nada se mueve hasta que la persona confirma, y puede
   cambiar el monto o decir "ahora no". Al confirmar se crean movimientos de ahorro normales ("De mi dinero")
   que se ven y se quitan como cualquier otro. Confirmar dos veces no duplica: cada aporte lleva `reparto_de`.
   La regla vive dentro de la meta (`meta.reparto`), así viaja con ella en la sincronización.
   ========================================================================= */

import { crearMovimiento } from "./finanzas-modelo.js";
import { obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { sellarTimestamp } from "../schema.js";

/** Qué ingresos activan la regla: "todo" (cualquier ingreso y la beca), "ingreso" (sin la beca) o "beca" (solo desembolsos de beca). */
const ORIGENES_REPARTO = ["todo", "ingreso", "beca"];

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const esMetaAhorro = (m) => m && m.tipo !== "gasto";

/**
 * Fija o quita la regla de una meta. `regla = { porcentaje, origen }` o `null` para quitarla.
 * Devuelve { ok:true, meta } o { ok:false, motivo } con motivo: "meta" | "porcentaje" | "origen" | "tipo".
 * El llamador marca el cambio pendiente.
 */
function configurarReparto(datos, metaId, regla) {
  const meta = (datos.metas || []).find((m) => m.id === metaId);
  if (!meta) return { ok: false, motivo: "meta" };
  if (!esMetaAhorro(meta)) return { ok: false, motivo: "tipo" };
  if (regla === null) {
    if (meta.reparto) { delete meta.reparto; sellarTimestamp(meta); }
    return { ok: true, meta };
  }
  const porcentaje = redondear(Number(regla && regla.porcentaje));
  if (!(porcentaje > 0 && porcentaje <= 100)) return { ok: false, motivo: "porcentaje" };
  const origen = regla.origen === undefined ? "todo" : regla.origen;
  if (!ORIGENES_REPARTO.includes(origen)) return { ok: false, motivo: "origen" };
  meta.reparto = { porcentaje, origen };
  sellarTimestamp(meta);
  return { ok: true, meta };
}

const esBeca = (mov) => mov.origen === "beca";
const aplicaOrigen = (origen, mov) => origen === "todo" || (origen === "beca" ? esBeca(mov) : !esBeca(mov));

/** ¿Ya se repartió este movimiento (total o parcialmente) hacia esa meta? */
const yaRepartido = (datos, movId, metaId) =>
  (datos.movimientos || []).some((x) => x.reparto_de === movId && x.meta_id === metaId);

/**
 * Propuestas para un ingreso recién registrado: una por meta activa con regla que aplique.
 * Cada una trae { metaId, nombre, emoji, porcentaje, monto }. El total nunca pasa del ingreso.
 * Vacío si: el movimiento no es un ingreso, es recurrente, Ahorros está apagado o ya se repartió hacia esa meta.
 */
function proponerReparto(datos, movimiento) {
  if (!movimiento || movimiento.tipo !== "ingreso" || movimiento.recurrente) return [];
  if (!obtenerModulosFinanzas(datos).ahorros) return [];
  const total = redondear(movimiento.monto);
  if (!(total > 0)) return [];
  let restante = total;
  const propuestas = [];
  (datos.metas || []).forEach((m) => {
    if (m.archivada || !esMetaAhorro(m) || !m.reparto || !aplicaOrigen(m.reparto.origen, movimiento)) return;
    if (yaRepartido(datos, movimiento.id, m.id)) return;
    const monto = Math.min(redondear((total * Number(m.reparto.porcentaje)) / 100), redondear(restante));
    if (!(monto > 0)) return;
    restante = redondear(restante - monto);
    propuestas.push({ metaId: m.id, nombre: m.nombre || "", emoji: m.emoji || "🎯", porcentaje: Number(m.reparto.porcentaje), monto });
  });
  return propuestas;
}

/**
 * Aplica lo que la persona confirmó. `items = [{ metaId, monto }]` (el monto puede ser distinto al propuesto).
 * Atómico: si algo es inválido no se crea nada. Un aporte ya hecho para esa meta se salta (no duplica).
 * Devuelve { ok:true, creados:[movimientos], omitidos:n } o { ok:false, motivo } con motivo:
 * "movimiento" | "monto" | "meta" | "excede".
 */
function aplicarReparto(datos, movimientoId, items) {
  const mov = (datos.movimientos || []).find((x) => x.id === movimientoId);
  if (!mov || mov.tipo !== "ingreso") return { ok: false, motivo: "movimiento" };
  const lista = (items || []).map((i) => ({ metaId: i.metaId, monto: redondear(Number(i.monto)) }));
  let suma = 0;
  for (const i of lista) {
    if (!(i.monto > 0)) return { ok: false, motivo: "monto" };
    const meta = (datos.metas || []).find((m) => m.id === i.metaId && !m.archivada && esMetaAhorro(m));
    if (!meta) return { ok: false, motivo: "meta" };
    suma = redondear(suma + i.monto);
  }
  if (suma > redondear(mov.monto)) return { ok: false, motivo: "excede" };
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  const creados = []; let omitidos = 0;
  lista.forEach((i) => {
    if (yaRepartido(datos, mov.id, i.metaId)) { omitidos++; return; }
    const meta = datos.metas.find((m) => m.id === i.metaId);
    const nuevo = crearMovimiento({
      tipo: "ahorro", nombre: mov.nombre || "", monto: i.monto, fechaRegistro: mov.fecha_registro,
      metaId: meta.id, fuente: "liquido", repartoDe: mov.id,
    });
    datos.movimientos.push(nuevo);
    creados.push(nuevo);
  });
  return { ok: true, creados, omitidos };
}

export { ORIGENES_REPARTO, aplicarReparto, configurarReparto, proponerReparto };
