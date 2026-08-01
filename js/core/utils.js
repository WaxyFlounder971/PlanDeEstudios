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

/**
 * BUG FIX (reportado: "puse un rosita y no se ve absolutamente nada"):
 * estiloBadgeCategoria ponía `color: hex` — el texto del badge era
 * LITERALMENTE el mismo color que su fondo (el fondo solo está a 15% de
 * opacidad, ver hexARgba arriba). Con cualquier tono pastel/claro, texto y
 * fondo terminan siendo el mismo matiz — cero contraste, sin importar qué
 * tan claro u oscuro sea el color elegido. No era un caso límite: pasaba
 * con CUALQUIER color de categoría.
 *
 * luminanciaRelativa/contrasteWCAG calculan el contraste real (fórmula
 * WCAG) del color de fondo contra las 2 opciones de texto que YA usa el
 * resto de la app para texto-sobre-acento (#0F172A / #ffffff — ver
 * textoSobreAccent en ui/tema.js) y eligen la que más contraste da. Así el
 * texto SIEMPRE se lee, sin importar el color elegido — no es una mejora
 * cosmética, es la diferencia entre "se ve" y "no se ve absolutamente
 * nada".
 */
function luminanciaRelativa(hex) {
  const limpio = (hex || "#000000").replace("#", "");
  const completo = limpio.length === 3 ? limpio.split("").map((c) => c + c).join("") : limpio;
  const num = parseInt(completo, 16) || 0;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  const canal = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contrasteWCAG(l1, l2) {
  const claro = Math.max(l1, l2), oscuro = Math.min(l1, l2);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Entre el "negro" (#0F172A, no negro puro — mismo tono que usa el resto
 *  de la app) y blanco puro, devuelve el que se lea mejor sobre `hex`. */
function colorTextoLegible(hex) {
  const NEGRO_APP = "#0F172A";
  const BLANCO_APP = "#ffffff";
  const lFondo = luminanciaRelativa(hex);
  const contrasteNegro = contrasteWCAG(lFondo, luminanciaRelativa(NEGRO_APP));
  const contrasteBlanco = contrasteWCAG(lFondo, luminanciaRelativa(BLANCO_APP));
  return contrasteBlanco >= contrasteNegro ? BLANCO_APP : NEGRO_APP;
}

function estiloBadgeCategoria(hex) {
  return `background:${hexARgba(hex, 0.15)}; border-color:${hex}; color:${colorTextoLegible(hex)};`;
}

/* ===================== (v1.12) Parser de requisitos removido de aquí =====================
   parsearGrupoRequisitos/serializarGrupoRequisitos/normalizarSeparadoresRequisitos
   vivían acá — se reemplazaron por completo por el parser/serializador de
   árbol Y/O (parsearRequisitoArbol/serializarRequisitoArbol), que ahora
   viven en js/plan/plan-importacion-csv.js junto con el resto de la lógica
   de importación de la que forman parte (ver PARTE A/C/G del rediseño de
   requisitos). Ningún otro archivo del proyecto debería seguir importando
   los nombres viejos — si alguno lo hace, es una referencia rota pendiente
   de actualizar. */

export {
  aplicarFormatoTexto,
  convertirArchivoABase64,
  esTokenNumeroRomano,
  estiloBadgeCategoria,
  formatearHoras,
  formatearHorasCompactoIniciales,
  hexARgba,
  obtenerIniciales,
  transformarPalabraFormato,
};
