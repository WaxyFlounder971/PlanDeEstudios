/* =========================================================================
   FINANZAS 2.0: lectura de texto para importar y pegar mensajes (sesión 6, F6)
   Funciones puras, sin DOM y sin nada de ningún país, banco ni sistema de pago:
   montos con separadores de miles y decimales, fechas en varios formatos,
   huellas para detectar repetidos y el aviso de moneda distinta.
   ========================================================================= */

import { MONEDAS_DISPONIBLES } from "../schema.js";

const quitarAcentos = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Minúsculas, sin tildes y con espacios simples. Igual que `normalizar` de categorías (se repite para no crear una dependencia). */
const normalizarTexto = (s) => quitarAcentos(s).toLowerCase().trim().replace(/\s+/g, " ");

/** Hash de 53 bits (cyrb53), síncrono y sin dependencias: sirve para ids deterministas, no para seguridad. */
function hashTexto(texto, semilla = 0) {
  let h1 = 0xdeadbeef ^ semilla, h2 = 0x41c6ce57 ^ semilla;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/* ===================== Montos ===================== */

/**
 * Número dentro de un texto: "2.500", "2,500.75", "2.500,75", "2 500", "2500,5", "1500".
 * Regla: si hay dos tipos de separador, el último es el decimal. Si hay uno solo y se repite, es de miles.
 * Si hay uno solo una vez: con 1 o 2 dígitos detrás es decimal; con 3 dígitos es de miles (en dinero casi nadie usa 3 decimales).
 * Devuelve 0 si no se puede leer. Siempre positivo (el signo lo decide quien llama).
 */
function parsearMontoTexto(texto) {
  let s = String(texto == null ? "" : texto).replace(/[\s  ']/g, "");
  s = s.replace(/[^\d.,]/g, "");
  if (!/\d/.test(s)) return 0;
  const comas = (s.match(/,/g) || []).length, puntos = (s.match(/\./g) || []).length;
  let decimal = null; // el separador que hace de decimal, si hay
  if (comas && puntos) decimal = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
  else if (comas + puntos === 1) {
    const sep = comas ? "," : ".";
    const detras = s.length - s.indexOf(sep) - 1;
    if (detras >= 1 && detras <= 2) decimal = sep;
  }
  if (decimal) {
    const otro = decimal === "," ? /\./g : /,/g;
    s = s.replace(otro, "");
    s = s.replace(decimal, ".");
  } else s = s.replace(/[.,]/g, "");
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Piezas de expresión regular para un monto con moneda opcional antes o después. Se reutilizan en plantillas y en la lectura general. */
const SIMBOLOS_MONEDA = "$€£¥₡₹₩₽₺₴₦₫₪฿¢";
const NUMERO_MONTO = "\\d{1,3}(?:[.,\\u00a0\\u202f ]\\d{3})+(?![\\d])(?:[.,]\\d{1,2}(?!\\d))?|\\d+(?:[.,]\\d{1,2}(?!\\d))?";
const MONEDA_ANTES = `(?:[${SIMBOLOS_MONEDA}]|[A-Z]{3})`;
const MONEDA_DESPUES = `(?:[${SIMBOLOS_MONEDA}]|[A-Z]{3})`;

/** ¿El token de moneda del texto coincide con la moneda de la app? "igual" | "distinta" | "desconocida" (sin token). */
function compararMoneda(token, monedaId) {
  const t = String(token || "").trim();
  if (!t) return "desconocida";
  const actual = MONEDAS_DISPONIBLES.find((m) => m.id === monedaId);
  if (!actual) return "desconocida";
  if (t === actual.simbolo || t.toUpperCase() === actual.id) return "igual";
  if (t === "¢" && actual.id === "CRC") return "igual"; // el centavo se usa a veces como signo del colón
  return "distinta";
}

/* ===================== Fechas ===================== */

const MESES = {
  ene: 1, enero: 1, jan: 1, january: 1, feb: 2, febrero: 2, february: 2, mar: 3, marzo: 3, march: 3,
  abr: 4, abril: 4, apr: 4, april: 4, may: 5, mayo: 5, jun: 6, junio: 6, june: 6, jul: 7, julio: 7, july: 7,
  ago: 8, agosto: 8, aug: 8, august: 8, sep: 9, set: 9, sept: 9, septiembre: 9, setiembre: 9, september: 9,
  oct: 10, octubre: 10, october: 10, nov: 11, noviembre: 11, november: 11, dic: 12, diciembre: 12, dec: 12, december: 12,
};

const pad2 = (n) => String(n).padStart(2, "0");

/** Valida y devuelve "YYYY-MM-DD", o null si el día no existe (31 de febrero) o el año es absurdo. */
function armarFecha(anio, mes, dia) {
  const a = Number(anio), m = Number(mes), d = Number(dia);
  if (!(a >= 1990 && a <= 2100) || !(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null;
  const f = new Date(Date.UTC(a, m - 1, d));
  if (f.getUTCFullYear() !== a || f.getUTCMonth() !== m - 1 || f.getUTCDate() !== d) return null;
  return `${a}-${pad2(m)}-${pad2(d)}`;
}
const anioCompleto = (a) => (String(a).length <= 2 ? 2000 + Number(a) : Number(a));

/**
 * Fecha escrita de varias formas → "YYYY-MM-DD" o null. `orden` decide el caso ambiguo "03/04/2026":
 * "dmy" (día primero, por defecto) o "mdy". Entiende "2026-10-24", "24/10/2026", "24-10-26", "24 oct 2026",
 * "24 de octubre de 2026" y "Oct 24, 2026" (español e inglés). Sin año ("24 oct") usa `hoy` para completarlo.
 */
function parsearFechaTexto(texto, { orden = "dmy", hoy } = {}) {
  const s = normalizarTexto(texto).replace(/[t ]\d{1,2}:\d{2}.*$/, "").replace(/\.$/, "");
  if (!s) return null;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return armarFecha(m[1], m[2], m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (m) return orden === "mdy" ? armarFecha(anioCompleto(m[3]), m[1], m[2]) : armarFecha(anioCompleto(m[3]), m[2], m[1]);
  m = s.match(/^(\d{1,2})\s*(?:de\s+)?([a-z]{3,10})\.?(?:\s*(?:de\s+|,\s*)?(\d{2}|\d{4}))?$/);
  if (m && MESES[m[2]]) return completarAnio(m[1], MESES[m[2]], m[3], hoy);
  m = s.match(/^([a-z]{3,10})\.?\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?$/);
  if (m && MESES[m[1]]) return completarAnio(m[2], MESES[m[1]], m[3], hoy);
  return null;
}

/** Día y mes sin año: se usa el año de `hoy`; si así cae a más de un mes en el futuro, el año anterior. */
function completarAnio(dia, mes, anio, hoy) {
  if (anio) return armarFecha(anioCompleto(anio), mes, dia);
  const base = hoy || new Date().toISOString().slice(0, 10);
  const actual = Number(base.slice(0, 4));
  const f = armarFecha(actual, mes, dia);
  if (!f) return null;
  const limite = new Date(`${base}T00:00:00Z`); limite.setUTCDate(limite.getUTCDate() + 31);
  return f > limite.toISOString().slice(0, 10) ? armarFecha(actual - 1, mes, dia) : f;
}

/**
 * Orden de día y mes que usa un conjunto de fechas con barras. Si alguna tiene un primer número mayor que 12,
 * es día primero; si el segundo es mayor que 12, es mes primero; si no hay pista, día primero.
 */
function detectarOrdenFecha(valores) {
  let dmy = 0, mdy = 0;
  (valores || []).forEach((v) => {
    const m = String(v || "").trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})/);
    if (!m) return;
    if (Number(m[1]) > 12) dmy++;
    if (Number(m[2]) > 12) mdy++;
  });
  return mdy > dmy ? "mdy" : "dmy";
}

/* ===================== Huellas y tipos ===================== */

/** Clave de "es el mismo movimiento": tipo, fecha, monto en centavos y nombre sin tildes. Para metas, también la meta. */
function huellaMovimiento({ tipo, sentido, fecha, monto, nombre, metaId }) {
  const t = tipo === "ajuste" ? "ajuste" + (sentido === "resta" ? "-" : "+") : tipo;
  const meta = tipo === "ahorro" || tipo === "transferencia" ? metaId || "" : "";
  return `${t}|${fecha || ""}|${Math.round((Number(monto) || 0) * 100)}|${normalizarTexto(nombre)}|${meta}`;
}

const ALIAS_TIPO = {
  gasto: ["gasto", "gastos", "egreso", "egresos", "expense", "expenses", "debito", "debit", "cargo", "retiro", "pago", "compra", "salida"],
  ingreso: ["ingreso", "ingresos", "income", "credito", "credit", "abono", "deposito", "deposit", "entrada", "beca"],
  ahorro: ["ahorro", "ahorros", "saving", "savings"],
  transferencia: ["transferencia", "transfer"],
  ajuste: ["ajuste", "ajustes", "adjustment"],
};
/** Texto libre → "gasto" | "ingreso" | "ahorro" | "transferencia" | "ajuste" | null. */
function normalizarTipo(texto) {
  const t = normalizarTexto(texto);
  if (!t) return null;
  return Object.keys(ALIAS_TIPO).find((k) => ALIAS_TIPO[k].includes(t)) || null;
}

export {
  MESES, MONEDA_ANTES, MONEDA_DESPUES, NUMERO_MONTO, SIMBOLOS_MONEDA,
  armarFecha, compararMoneda, detectarOrdenFecha, hashTexto, huellaMovimiento, normalizarTexto, normalizarTipo,
  parsearFechaTexto, parsearMontoTexto, quitarAcentos,
};
