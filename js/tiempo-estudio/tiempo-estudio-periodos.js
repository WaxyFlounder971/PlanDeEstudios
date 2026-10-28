/** Reparto temporal común para estadísticas y rachas de estudio.
 * Las sesiones siguen siendo un único registro; esta utilidad solo calcula
 * cuánto de su intervalo cae dentro de cada rango local. */
export function obtenerFinEfectivoSesion(sesion) {
  const inicio = Number(sesion?.inicio);
  if (!Number.isFinite(inicio)) return NaN;
  const fin = Number(sesion?.fin);
  if (Number.isFinite(fin) && fin > inicio) return fin;
  const minutos = Number(sesion?.duracion_minutos);
  return Number.isFinite(minutos) && minutos > 0 ? inicio + minutos * 60000 : NaN;
}

export function minutosSesionEnRango(sesion, inicioRango, finRango) {
  const inicio = Number(sesion?.inicio);
  const fin = obtenerFinEfectivoSesion(sesion);
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return 0;
  return Math.max(0, Math.min(fin, finRango) - Math.max(inicio, inicioRango)) / 60000;
}

export function minutosSesionPorDiaLocal(sesion) {
  const inicio = Number(sesion?.inicio);
  const fin = obtenerFinEfectivoSesion(sesion);
  const resultado = [];
  if (!Number.isFinite(inicio) || !Number.isFinite(fin) || fin <= inicio) return resultado;
  let cursor = inicio;
  while (cursor < fin) {
    const fecha = new Date(cursor);
    const siguienteDia = new Date(fecha.getFullYear(), fecha.getMonth(), fecha.getDate() + 1).getTime();
    const corte = Math.min(fin, siguienteDia);
    resultado.push({ fecha, inicio: cursor, fin: corte, minutos: (corte - cursor) / 60000 });
    cursor = corte;
  }
  return resultado;
}
