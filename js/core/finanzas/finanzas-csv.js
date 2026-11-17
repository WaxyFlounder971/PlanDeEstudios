/* =========================================================================
   FINANZAS 2.0: lector y escritor de CSV (sesión 6, F6). Puro, sin DOM.
   - Lee comillas, comas dentro de comillas, saltos de línea dentro de comillas, BOM y CRLF.
   - Detecta el separador (coma, punto y coma o tabulador).
   - Al escribir, neutraliza celdas que una hoja de cálculo ejecutaría como fórmula
     (empiezan con = + - @) anteponiendo un apóstrofo; al leer, lo quita.
   ========================================================================= */

const MAX_FILAS = 5000;
const SEPARADORES = [",", ";", "\t"];

/** Elige el separador que más se repite en la primera línea con contenido (fuera de comillas). Empate o ninguno: coma. */
function detectarSeparador(texto) {
  const cuentas = { ",": 0, ";": 0, "\t": 0 };
  let enComillas = false, vistoContenido = false;
  for (const c of String(texto || "").replace(/^﻿/, "")) {
    if (c === '"') { enComillas = !enComillas; vistoContenido = true; continue; }
    if (!enComillas && (c === "\n" || c === "\r")) { if (vistoContenido) break; continue; }
    if (!/\s/.test(c) || c === "\t") vistoContenido = true;
    if (!enComillas && cuentas[c] !== undefined) cuentas[c]++;
  }
  const mejor = SEPARADORES.reduce((a, b) => (cuentas[b] > cuentas[a] ? b : a), ",");
  return cuentas[mejor] > 0 ? mejor : ",";
}

/**
 * Texto CSV → { separador, filas, truncado }. Las filas son arreglos de textos; las líneas vacías se omiten.
 * Pasa más de `maxFilas` (por defecto 5000) y corta, avisando con `truncado`.
 */
function leerCsv(texto, { separador, maxFilas = MAX_FILAS } = {}) {
  const t = String(texto || "").replace(/^﻿/, "");
  const sep = separador || detectarSeparador(t);
  const filas = [];
  let fila = [], celda = "", enComillas = false, truncado = false;
  const cerrarCelda = () => { fila.push(celda); celda = ""; };
  const cerrarFila = () => {
    cerrarCelda();
    if (fila.some((c) => c.trim() !== "")) filas.push(fila);
    fila = [];
  };
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (enComillas) {
      if (c === '"') { if (t[i + 1] === '"') { celda += '"'; i++; } else enComillas = false; }
      else celda += c;
    } else if (c === '"' && celda === "") enComillas = true;
    else if (c === sep) cerrarCelda();
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; cerrarFila(); if (filas.length > maxFilas) { truncado = true; break; } }
    else celda += c;
  }
  if (!truncado && (celda !== "" || fila.length)) cerrarFila();
  if (filas.length > maxFilas) { filas.length = maxFilas; truncado = true; }
  return { separador: sep, filas, truncado };
}

const EMPIEZA_COMO_FORMULA = /^[=+\-@\t\r]/;
/** Antepone un apóstrofo a lo que una hoja de cálculo ejecutaría como fórmula. */
const neutralizarFormula = (s) => { const t = String(s == null ? "" : s); return EMPIEZA_COMO_FORMULA.test(t) ? "'" + t : t; };
/** Quita el apóstrofo que puso `neutralizarFormula` (solo ese caso, para no tocar textos normales). */
const restaurarFormula = (s) => { const t = String(s == null ? "" : s); return /^'[=+\-@\t\r]/.test(t) ? t.slice(1) : t; };

function escaparCelda(valor, sep) {
  const s = String(valor == null ? "" : valor);
  return /["\r\n]/.test(s) || s.includes(sep) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Filas (arreglos de valores) → texto CSV con BOM (para que Excel lea las tildes) y saltos CRLF. */
function escribirCsv(filas, { separador = "," } = {}) {
  return "﻿" + filas.map((f) => f.map((v) => escaparCelda(v, separador)).join(separador)).join("\r\n") + "\r\n";
}

/**
 * Bytes de un archivo → texto. Prueba UTF-8 estricto y, si falla (archivos de bancos y de Excel viejo),
 * cae a Windows-1252 para no llenar los nombres de �.
 */
function decodificarBytes(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
  catch (e) { return new TextDecoder("windows-1252").decode(bytes); }
}

export { MAX_FILAS, SEPARADORES, decodificarBytes, detectarSeparador, escribirCsv, leerCsv, neutralizarFormula, restaurarFormula };
