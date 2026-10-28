/* =========================================================================
   FINANZAS 2.0: formatos de ejemplo (sesión 6). Solo DATOS: ningún banco vive en el motor.
   La persona los añade a "Mis formatos" si le sirven; desde ahí se editan, apagan y borran como cualquier otro.
   Cada ejemplo trae un mensaje neutro (sin datos personales) que sirve para probarlo y para las pruebas automáticas.
   ========================================================================= */

import { crearPatron } from "./finanzas-mensajes.js";

const FORMATOS_EJEMPLO = [
  {
    clave: "compra-correo-total",
    nombre: "Compra por correo (con TOTAL)",
    tipo: "gasto",
    plantilla: "compra realizada en {nombre} el {fecha} a las {hora} {cualquiera} REF: {ref} TOTAL: {monto}",
    ejemplo: "Estimado cliente: le hacemos llegar el comprobante de COMPRA realizada en TIENDA EJEMPLO CARTAGO CRI el 24 de Octubre de 2026 a las 01:08\n\nTIENDA EJEMPLO CARTAGO CRI\n\nOct 24, 2026 - 01:08\nMASTERCARD\t************0000\nNRO. AUT:\t111111\nREF:\t222222222222\nTOTAL:\tCRC 3,100.00",
    esperado: { monto: 3100, nombre: "TIENDA EJEMPLO CARTAGO CRI", fecha: "2026-10-24", referencia: "222222222222" },
  },
  {
    clave: "compra-correo-comercio",
    nombre: "Compra por correo (con Monto)",
    tipo: "gasto",
    plantilla: "Comercio: {nombre} Ciudad y país: {cualquiera} Fecha: {fecha}, {hora} {cualquiera} Referencia: {ref} Tipo de Transacción: COMPRA Monto: {monto}",
    ejemplo: "Hola cliente\nA continuación le detallamos la transacción realizada:\nComercio:\tSUPER EJEMPLO\nCiudad y país:\tCARTAGO, Costa Rica\nFecha:\tOct 21, 2026, 14:26\nVISA:\t************0000\nAutorización:\t333333\nReferencia:\t444444444444\nTipo de Transacción:\tCOMPRA\nMonto:\tCRC 3,975.00",
    esperado: { monto: 3975, nombre: "SUPER EJEMPLO", fecha: "2026-10-21", referencia: "444444444444" },
  },
  {
    clave: "transferencia-enviada",
    nombre: "Transferencia enviada (Ha pasado)",
    tipo: "gasto",
    plantilla: "Ha pasado {monto} Colones al {cualquiera} de {nombre}, comprobante {ref}",
    ejemplo: "Su entidad le informa. Ha pasado 105000 Colones al 7120000 de maria perez, comprobante 202601010000000000000",
    esperado: { monto: 105000, nombre: "maria perez", referencia: "202601010000000000000" },
  },
];

/** Copia del catálogo para mostrar (sin exponer el arreglo interno). */
const listarFormatosEjemplo = () => FORMATOS_EJEMPLO.map((f) => ({ ...f }));

/** Añade un ejemplo a los formatos de la persona. Devuelve el resultado de crearPatron. */
function adoptarFormatoEjemplo(datos, clave) {
  const f = FORMATOS_EJEMPLO.find((x) => x.clave === clave);
  if (!f) return { ok: false, motivo: "no_existe" };
  return crearPatron(datos, { nombre: f.nombre, plantilla: f.plantilla, tipo: f.tipo });
}

export { adoptarFormatoEjemplo, listarFormatosEjemplo };
