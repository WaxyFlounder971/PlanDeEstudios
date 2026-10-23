/* =========================================================================
   FINANZAS 2.0 — Adaptador del detalle por semestre (etapa 0B)
   La pestaña Semestres sigue mostrando "Pagos de matrícula" e "Ingresos de
   beca" por semestre, con su borrador (Guardar / Descartar). Para no
   reescribir esa pantalla, trabaja sobre un REGISTRO DE VISTA con la forma
   de siempre ({pagos_matricula, ingresos_beca, _eliminados_*}), que se arma
   a partir de `movimientos` y se vuelca de vuelta al confirmar.
   Sin DOM: se prueba en Node.
   - Matrícula = movimiento tipo "gasto" con origen "matricula".
   - Beca      = movimiento tipo "ingreso" con origen "beca".
   - Los ids de los ítems SON los ids de los movimientos ("mov_" + id viejo
     para los migrados), así editar o borrar siempre apunta al mismo registro.
   ========================================================================= */

import { crearMovimiento } from "../core/finanzas-modelo.js";
import { sellarTimestamp } from "../core/schema.js";

function itemDesdeMovimiento(m) {
  return { id: m.id, descripcion: m.nombre || null, monto: Number(m.monto) || 0, fecha: m.fecha_registro || null };
}

function crearRegistroVacio(semestreId) {
  return {
    semestre_id: semestreId,
    pagos_matricula: [],
    ingresos_beca: [],
    _eliminados_pagos_matricula: [],
    _eliminados_ingresos_beca: [],
  };
}

/** Registro de vista del semestre, o null si no tiene ningún pago/beca. */
function construirRegistroDesdeMovimientos(datos, semestreId) {
  const delSemestre = (datos.movimientos || []).filter((m) => m.semestre_id === semestreId);
  const pagos = delSemestre.filter((m) => m.tipo === "gasto" && m.origen === "matricula").map(itemDesdeMovimiento);
  const becas = delSemestre.filter((m) => m.tipo === "ingreso" && m.origen === "beca").map(itemDesdeMovimiento);
  if (!pagos.length && !becas.length) return null;
  return { ...crearRegistroVacio(semestreId), pagos_matricula: pagos, ingresos_beca: becas };
}

/** Ítem nuevo del registro de vista; ya trae el id definitivo del movimiento. */
function crearItemRegistro({ descripcion, monto, fecha }) {
  return {
    id: "mov_" + crypto.randomUUID(),
    descripcion: descripcion || null,
    monto: Number(monto) || 0,
    fecha: fecha || null,
  };
}

/**
 * Vuelca el borrador a `movimientos`: crea los ítems nuevos, actualiza los
 * que cambiaron, y borra (con tumba) solo los que la persona eliminó. Lo que
 * otro dispositivo haya agregado mientras tanto NO se toca.
 * Solo sella (`_actualizadoEn`) lo que de verdad cambió, para no generar
 * conflictos falsos en la fusión. Devuelve true si cambió algo.
 */
function confirmarRegistroEnMovimientos(datos, borrador) {
  if (!Array.isArray(datos.movimientos)) datos.movimientos = [];
  if (!Array.isArray(datos._eliminados_movimientos)) datos._eliminados_movimientos = [];
  const semestreId = borrador.semestre_id;
  const porId = new Map(datos.movimientos.map((m) => [m.id, m]));
  let hayCambios = false;

  const aplicar = (items, origen) => {
    (items || []).forEach((item) => {
      const nombre = item.descripcion || "";
      const fecha = item.fecha || null;
      const monto = Number(item.monto) || 0;
      const actual = porId.get(item.id);
      if (actual) {
        if (actual.nombre !== nombre || actual.monto !== monto || (actual.fecha_registro || null) !== fecha) {
          actual.nombre = nombre;
          actual.monto = monto;
          actual.fecha_registro = fecha;
          sellarTimestamp(actual);
          hayCambios = true;
        }
      } else {
        const mov = crearMovimiento({
          id: item.id,
          tipo: origen === "beca" ? "ingreso" : "gasto",
          origen,
          nombre,
          monto,
          fechaRegistro: fecha,
          semestreId,
        });
        datos.movimientos.push(mov);
        porId.set(mov.id, mov);
        hayCambios = true;
      }
    });
  };
  aplicar(borrador.pagos_matricula, "matricula");
  aplicar(borrador.ingresos_beca, "beca");

  const tumbasExistentes = new Set(datos._eliminados_movimientos.map((x) => x.id));
  [...(borrador._eliminados_pagos_matricula || []), ...(borrador._eliminados_ingresos_beca || [])].forEach((tumba) => {
    // Un ítem creado y borrado dentro del mismo borrador nunca existió en
    // `movimientos`: no necesita tumba.
    if (!porId.has(tumba.id)) return;
    datos.movimientos = datos.movimientos.filter((m) => m.id !== tumba.id);
    porId.delete(tumba.id);
    hayCambios = true;
    if (!tumbasExistentes.has(tumba.id)) {
      datos._eliminados_movimientos.push({ id: tumba.id, eliminadoEn: tumba.eliminadoEn || Date.now() });
      tumbasExistentes.add(tumba.id);
    }
  });

  return hayCambios;
}

export { confirmarRegistroEnMovimientos, construirRegistroDesdeMovimientos, crearItemRegistro, crearRegistroVacio };
