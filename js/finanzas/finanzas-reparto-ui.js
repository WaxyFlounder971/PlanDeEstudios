/* =========================================================================
   FINANZAS 2.0: propuesta de reparto de un ingreso hacia tus metas (sesión 8).
   Aparece justo después de registrar un ingreso (o confirmar uno del Plan) si alguna meta pidió separar un
   porcentaje. Nada se mueve solo: la persona ve los montos, los cambia si quiere y confirma, o dice "Ahora no".
   ========================================================================= */

import { aplicarReparto, proponerReparto } from "../core/finanzas/finanzas-reparto.js";
import { parsearMontoTexto } from "../core/finanzas/finanzas-texto.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { abrirCapaNombrada, boton, campo, entrada, filaBotones, lineaError, mostrar, parrafo } from "./finanzas-ui-basico.js";
import { formatearMonto, renderizarFinanzas } from "./finanzas.js";

const ID_CAPA = "finanzas-reparto-overlay";
const TEXTO_ERROR = {
  excede: "Lo que separas no puede ser más de lo que recibiste.",
  monto: "Escribe un monto mayor a cero o déjalo vacío.",
  meta: "Una de las metas ya no está disponible.",
  movimiento: "Ese ingreso ya no existe.",
};

/**
 * Abre la propuesta para un ingreso. Devuelve true si abrió algo, false si no había nada que proponer
 * (así el llamador no hace nada más). `alTerminar()` se llama al cerrar, haya separado o no.
 */
function abrirPropuestaReparto(movimiento, { alTerminar } = {}) {
  const propuestas = proponerReparto(estado.datos, movimiento);
  if (!propuestas.length) return false;
  const { caja, cerrar } = abrirCapaNombrada(ID_CAPA, "Separar para tus metas");
  const terminar = () => { cerrar(); if (alTerminar) alTerminar(); };

  caja.appendChild(parrafo(t("Recibiste {monto}. Estas metas piden separar una parte. Puedes cambiar los montos o dejarlo para después.").replace("{monto}", formatearMonto(movimiento.monto))));
  const inputs = propuestas.map((p) => {
    const input = entrada(String(p.monto), "", 0, "number"); input.min = "0"; input.step = "any"; input.inputMode = "decimal";
    caja.appendChild(campo(`${p.emoji} ${p.nombre} (${p.porcentaje} %)`, input));
    return { p, input };
  });
  const error = lineaError(); caja.appendChild(error);
  caja.appendChild(parrafo(t("Es un registro: no mueve dinero en tu banco. Sale de Mi dinero y suma a la meta."), { tamano: "0.8rem" }));

  const separar = boton(t("Separar"), "btn btn-primary", () => {
    // Un campo vacío es "esta meta no"; un valor que no es un monto mayor a cero es un error.
    const llenos = inputs.filter(({ input }) => String(input.value).trim() !== "").map(({ p, input }) => ({ metaId: p.metaId, monto: parsearMontoTexto(input.value) }));
    if (llenos.some((i) => !(i.monto > 0))) { mostrar(error, TEXTO_ERROR.monto); return; }
    if (!llenos.length) { terminar(); return; }
    const r = aplicarReparto(estado.datos, movimiento.id, llenos);
    if (!r.ok) { mostrar(error, TEXTO_ERROR[r.motivo] || TEXTO_ERROR.monto); return; }
    marcarCambioPendiente();
    const total = r.creados.reduce((acc, m) => acc + m.monto, 0);
    if (r.creados.length) mostrarToast(t("Separado para tus metas: {monto}").replace("{monto}", formatearMonto(total)));
    terminar(); renderizarFinanzas();
  });
  caja.appendChild(filaBotones(boton(t("Ahora no"), "btn btn-secondary", terminar), separar));
  return true;
}

export { abrirPropuestaReparto };
