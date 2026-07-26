/* =========================================================================
   UTILIDADES GENÉRICAS
   Helpers reutilizables sin estado propio: formato de texto, colores,
   parseo de grupos de requisitos, conversión de archivos, etc.
   ========================================================================= */

import { estado } from "./storage.js";

function convertirArchivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(archivo);
  });
}

function obtenerIniciales(texto) {
  const partes = texto.trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  const primera = partes[0][0] || "";
  const segunda = partes.length > 1 ? partes[1][0] || "" : "";
  return (primera + segunda).toUpperCase();
}

/**
 * Línea compacta de horas para mostrar en tarjeta/modal, iterando las
 * llaves REALES de materia.horas (nunca nombres fijos como teoria/practica).
 * Una sola llave -> "Horas: N". Varias llaves -> "Tipo1 N · Tipo2 N · …".
 * v7 #1: si el plan es "No aplica" para horas, materia.horas queda vacío y
 * no hay nada que mostrar — se devuelve "" para que el llamador simplemente
 * no pinte esa línea.
 */

function formatearHoras(materia) {
  const entradas = Object.entries(materia.horas || {});
  if (entradas.length === 0) return "";
  if (entradas.length === 1) return `Horas: ${entradas[0][1]}`;
  return entradas.map(([tipo, valor]) => `${tipo} ${valor}`).join(" · ");
}

/**
 * B (v9)/v8 punto 2: versión compacta de formatearHoras para la tarjeta
 * COLAPSADA — con más de un tipo de horas, muestra solo la inicial de cada
 * uno (ej. "T4 P0 L0 TP0" para Teoría/Práctica/Laboratorio/Teoría-Práctica).
 * Con un solo tipo (ej. TEC: "Horas"), mantiene la etiqueta completa porque
 * ahí no hay ambigüedad que evitar ni espacio que ahorrar.
 */

function formatearHorasCompactoIniciales(materia) {
  const entradas = Object.entries(materia.horas || {});
  if (entradas.length === 0) return "";
  if (entradas.length === 1) return `${entradas[0][0]}: ${entradas[0][1]}`;
  return entradas
    .map(([tipo, valor]) => {
      const inicial = tipo.split(/[\s-]+/).map((palabra) => palabra.charAt(0) || "").join("").toUpperCase();
      return `${inicial}${valor}`;
    })
    .join(" ");
}

/**
 * v5 #9: aplica el formato de nombres elegido en Configuración
 * (`configuracion.formato_texto_nombres`: "titulo" | "mayusculas" | "oracion")
 * a un texto de materia/carrera. Esta función faltaba por completo — se
 * llamaba desde 6 lugares distintos de este archivo pero nunca se definió,
 * lo cual provocaba un ReferenceError en cuanto se intentaba pintar el
 * encabezado del plan (construirEncabezadoPlan). Como ese error ocurre
 * DESPUÉS de que renderizarPlanEstudios() ya había limpiado el contenedor
 * (cont.innerHTML = ""), el resultado era una sección de Plan de Estudios
 * completamente vacía, sin ningún mensaje de error visible — esta era la
 * causa raíz del Bug 1 (crítico).
 *
 * Nunca revienta: si `texto` es null/undefined, devuelve "" en vez de tirar.
 */

/**
 * B.2 (v9)/Bug 9 (v8): valida si un token es un número romano válido
 * (I, II, III, IV, ..., XII, etc.), sin importar mayúsculas/minúsculas de
 * origen. Se usa para que "Inglés II" nunca se convierta en "Inglés Ii" al
 * aplicar el formato de nombres — el token romano se deja siempre en
 * mayúsculas completas, sin importar cuál de las 3 opciones esté activa.
 */

function esTokenNumeroRomano(token) {
  if (!token) return false;
  if (!/^[IVXLCDM]+$/i.test(token)) return false;
  return /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(token);
}

/**
 * Aplica la transformación de UNA palabra según el formato elegido, dejando
 * los números romanos siempre en mayúsculas completas sin importar el
 * formato ni su posición en la frase.
 */

function transformarPalabraFormato(palabra, formato, esPrimeraPalabra) {
  if (!palabra) return palabra;
  if (esTokenNumeroRomano(palabra)) return palabra.toUpperCase();

  if (formato === "mayusculas") return palabra.toUpperCase();

  if (formato === "oracion") {
    const p = palabra.toLowerCase();
    return esPrimeraPalabra ? p.charAt(0).toUpperCase() + p.slice(1) : p;
  }

  // "titulo" (default): Cada Palabra Capitalizada.
  const p = palabra.toLowerCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function aplicarFormatoTexto(texto) {
  const original = texto || "";
  if (!original) return "";
  const formato = (estado.datos && estado.datos.configuracion && estado.datos.configuracion.formato_texto_nombres) || "titulo";

  return original
    .split(" ")
    .map((palabra, i) => transformarPalabraFormato(palabra, formato, i === 0))
    .join(" ");
}

/* ===================== Utilidades de color (badges de categoría) ===================== */

function hexARgba(hex, alpha) {
  const limpio = (hex || "#94a3b8").replace("#", "");
  const completo = limpio.length === 3 ? limpio.split("").map((c) => c + c).join("") : limpio;
  const num = parseInt(completo, 16) || 0x94a3b8;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Mismo patrón visual que los badges semánticos: fondo en baja opacidad + borde + texto del color. */

function estiloBadgeCategoria(hex) {
  return `background:${hexARgba(hex, 0.15)}; border-color:${hex}; color:${hex};`;
}

/* ===================== Parser de grupos de requisitos (";" = Y, "/" = O) ===================== */

/**
 * Normaliza separadores "sueltos" que a veces llegan en la celda en vez del
 * punto y coma/diagonal oficial: " - " o " y " (con espacios) como separador
 * de GRUPOS distintos (equivalente a ";"), y " o " como separador de
 * ALTERNATIVAS dentro de un grupo (equivalente a "/"). Solo se normaliza
 * cuando el separador está rodeado de espacios — así un código como
 * "MA-1001" (guion pegado, sin espacios) nunca se parte por error.
 *
 * v7: el separador de "Y" se cambió de coma "," a punto y coma ";" porque la
 * coma choca con el separador de columnas del propio CSV — si una materia
 * tenía más de un requisito (ej. "MA0101,MA1403"), esa celda no quedaba
 * envuelta en comillas por la IA externa y la fila terminaba con más
 * columnas de las esperadas, causando que el parser la descartara. Esta era
 * la causa raíz de que se perdieran materias al importar.
 */

function normalizarSeparadoresRequisitos(texto) {
  return texto
    .replace(/\s+-\s+/g, ";")
    .replace(/\s+y\s+/gi, ";")
    .replace(/\s+o\s+/gi, "/")
    // Compatibilidad con datos/plantillas viejas que aún usan coma como "Y":
    // si después de todo lo anterior sigue habiendo una coma dentro de la
    // celda (que ya no debería tener columnas mezcladas, porque esto se usa
    // fila por fila sobre una celda ya aislada), se trata como "Y" también.
    .replace(/\s*,\s*/g, ";");
}

function parsearGrupoRequisitos(texto) {
  const limpio = normalizarSeparadoresRequisitos((texto || "").trim());
  if (!limpio || limpio.toLowerCase() === "ninguno") return [];
  return limpio
    .split(";")
    .map((grupo) => grupo.split("/").map((c) => c.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

function serializarGrupoRequisitos(grupos) {
  if (!grupos || grupos.length === 0) return "Ninguno";
  return grupos.map((g) => g.join("/")).join(";");
}

export {
  aplicarFormatoTexto,
  convertirArchivoABase64,
  esTokenNumeroRomano,
  estiloBadgeCategoria,
  formatearHoras,
  formatearHorasCompactoIniciales,
  hexARgba,
  normalizarSeparadoresRequisitos,
  obtenerIniciales,
  parsearGrupoRequisitos,
  serializarGrupoRequisitos,
  transformarPalabraFormato,
};
