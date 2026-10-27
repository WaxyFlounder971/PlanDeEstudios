/* =========================================================================
   FINANZAS 2.0: Un recordatorio por meta (sesión 8). Lógica pura sin DOM.
   Solo dentro de la app, sin depender de notificaciones (en iPhone no siempre existen). Una meta con aporte
   programado y "Recordarme" encendido muestra UN aviso cuando llega el día de su aporte y todavía no aportaste.
   Se queda hasta que aportes o digas "Ahora no", y no vuelve a salir por ese mismo día. No insiste: si dejas
   pasar varios periodos, solo cuenta el último. Nada mueve dinero y nada se guarda como contador.
   ========================================================================= */

import { hoyIso } from "./finanzas-modelo.js";
import { movimientosVigentes, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { ocurrenciasRecurrente, sumarDias } from "./finanzas-disponible.js";
import { sellarTimestamp } from "./schema.js";

/** Cuántos días hacia atrás se busca el último día de aporte (cubre aportes mensuales). */
const VENTANA_DIAS = 45;

/**
 * Recordatorios pendientes hoy: [{ metaId, nombre, emoji, fecha, monto, frecuencia }].
 * Una meta entra si tiene Recordarme encendido, un día de aporte ya llegado, ningún aporte desde ese día
 * y no se pospuso ese mismo día. Con Ahorros apagado, o meta archivada o de gasto, no entra.
 */
function recordatoriosDeMetas(datos, hoy = hoyIso()) {
  if (!obtenerModulosFinanzas(datos).ahorros) return [];
  const vigentes = movimientosVigentes(datos, hoy);
  const salida = [];
  (datos.metas || []).forEach((m) => {
    const ap = m.aporte_programado;
    if (m.archivada || m.tipo === "gasto" || !ap || ap.recordar !== true || !(Number(ap.monto) > 0)) return;
    const rec = { frecuencia: ap.frecuencia, fecha_inicio: ap.fecha_inicio, fecha_fin: null, personalizado: null };
    const dias = ocurrenciasRecurrente(rec, sumarDias(hoy, -VENTANA_DIAS), hoy);
    if (!dias.length) return;
    const fecha = dias[dias.length - 1];
    if (m.recordatorio_visto === fecha) return;
    const aporto = vigentes.some((x) => x.meta_id === m.id && x.fecha_registro && x.fecha_registro >= fecha &&
      (x.tipo === "ahorro" || (x.tipo === "transferencia" && x.sentido !== "desde_meta")));
    if (aporto) return;
    salida.push({ metaId: m.id, nombre: m.nombre || "", emoji: m.emoji || "🎯", fecha, monto: Number(ap.monto), frecuencia: ap.frecuencia });
  });
  return salida;
}

/** "Ahora no": no vuelve a avisar por ese día de aporte. Devuelve false si la meta no existe. El llamador marca el cambio pendiente. */
function posponerRecordatorio(datos, metaId, fecha) {
  const meta = (datos.metas || []).find((m) => m.id === metaId);
  if (!meta || !/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ""))) return false;
  meta.recordatorio_visto = fecha;
  sellarTimestamp(meta);
  return true;
}

export { posponerRecordatorio, recordatoriosDeMetas };
