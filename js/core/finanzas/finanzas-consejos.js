/* =========================================================================
   FINANZAS 2.0: Micro-consejos de una línea (sesión 8). Lógica pura sin DOM.
   Al encender un módulo se puede mostrar UN consejo corto. Son opcionales:
   se apagan con `configuracion.finanzas_consejos = false`. Nunca regañan y
   no dependen de ningún país, banco ni moneda. Nada se cuenta ni se guarda salvo esa preferencia.
   ========================================================================= */

import { sellarTimestamp } from "../schema.js";

const CONSEJOS = {
  gastos: "Anota el gasto en el momento: con el monto y el nombre basta, lo demás lo completas después.",
  ahorros: "Los aportes pequeños y frecuentes suelen funcionar mejor que uno grande de vez en cuando.",
  matricula: "Planifica cada cuota con su fecha y confírmala cuando la pagues.",
  beca: "Anota cuándo esperas cada desembolso: así Disponible sabe qué viene.",
  deudas: "Cuando divides un gasto, solo tu parte cuenta como gasto.",
  cuentas: "Para empezar, crea tus cuentas y reparte lo que ya tenías con un traspaso desde Sin asignar.",
};

/** ¿Están los consejos encendidos? Por defecto sí. */
const consejosActivos = (datos) => !datos || !datos.configuracion || datos.configuracion.finanzas_consejos !== false;

/** Consejo para un módulo, o null si ese módulo no tiene o los consejos están apagados. */
function consejoDe(datos, modulo) {
  return consejosActivos(datos) && Object.prototype.hasOwnProperty.call(CONSEJOS, modulo) ? CONSEJOS[modulo] : null;
}

/** Enciende o apaga los consejos. Sella la configuración para que viaje en la sincronización. */
function activarConsejos(datos, encendido) {
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.finanzas_consejos = !!encendido;
  sellarTimestamp(datos.configuracion);
  return datos.configuracion.finanzas_consejos;
}

export { CONSEJOS, activarConsejos, consejoDe, consejosActivos };
