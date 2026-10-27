/* =========================================================================
   FINANZAS 2.0: pegar mensaje del banco (sesión 6, F6). Lógica pura, sin DOM.
   Una PWA no puede leer SMS, así que la persona copia el mensaje y lo pega. Dos formas de leerlo:
   1. Patrones de la persona (colección `patrones_mensajes`): una plantilla con huecos, por ejemplo
      "Compra por {monto} en {nombre}". Cada quien crea y edita los suyos; NINGÚN formato de banco, país
      ni sistema de pago vive en el código.
   2. Lectura general aproximada, para cuando ningún patrón coincide: busca un monto, una fecha, el tipo por palabras
      comunes y un posible nombre. Siempre se muestra para confirmar antes de guardar.
   El texto del mensaje no se guarda nunca (trae números de cuenta): solo el movimiento y, si hay, "Ref. …".
   Huecos de la plantilla: {monto} (obligatorio), {nombre}, {fecha}, {hora}, {ref}, {cualquiera}.
   ========================================================================= */

import { sugerirCategoria, buscarCategoria } from "./finanzas-categorias.js";
import { sellarTimestamp } from "./schema.js";
import {
  MONEDA_ANTES, MONEDA_DESPUES, NUMERO_MONTO, normalizarTexto, parsearFechaTexto, parsearMontoTexto, quitarAcentos,
} from "./finanzas-texto.js";

const TIPOS_PATRON = ["gasto", "ingreso"];
const HUECOS = ["monto", "nombre", "fecha", "hora", "ref", "cualquiera"];
const MAX_PATRONES = 50, MAX_PLANTILLA = 300, MAX_MENSAJE = 600, MAX_MENSAJES = 100;
const MIN_LITERALES = 4; // letras o números fijos: una plantilla con menos coincidiría con casi cualquier cosa

const FECHA_RE = "\\d{4}[-/.]\\d{1,2}[-/.]\\d{1,2}|\\d{1,2}[-/.]\\d{1,2}[-/.](?:\\d{4}|\\d{2})|\\d{1,2}\\s*(?:de\\s+)?[A-Za-zÁÉÍÓÚáéíóú]{3,10}\\.?(?:\\s*(?:de\\s+|,\\s*)?\\d{4})?|[A-Za-z]{3,10}\\.?\\s+\\d{1,2}(?:\\s*,?\\s*\\d{4})?";
const HORA_RE = "\\d{1,2}:\\d{2}(?::\\d{2})?(?:\\s?[AaPp]\\.?\\s?[Mm]\\.?)?";
const REF_RE = "[A-Za-z0-9][A-Za-z0-9\\-_.]{2,39}";
const MONTO_RE = `(?:(?<mpre>${MONEDA_ANTES})\\s?)?(?<monto>${NUMERO_MONTO})(?:\\s?(?<msuf>${MONEDA_DESPUES})(?![A-Za-z]))?`;

/** Migración idempotente: solo asegura las colecciones (no hay datos que sembrar). Devuelve 0. */
function migrarPatronesMensajesV1(datos) {
  if (!datos) return 0;
  if (!Array.isArray(datos.patrones_mensajes)) datos.patrones_mensajes = [];
  if (!Array.isArray(datos._eliminados_patrones_mensajes)) datos._eliminados_patrones_mensajes = [];
  return 0;
}

/* ===================== Plantilla → expresión regular ===================== */

const VARIANTES = { a: "aáàâäãå", e: "eéèêë", i: "iíìîï", o: "oóòôöõ", u: "uúùûü", n: "nñ", c: "cç" };
const escaparRegex = (c) => c.replace(/[\\^$.*+?()[\]{}|/-]/g, "\\$&");

/** Una letra de la plantilla coincide con ella en mayúscula, minúscula y con o sin tilde. El resto, tal cual. */
function claseLetra(ch) {
  const base = quitarAcentos(ch).toLowerCase();
  if (/^[a-z]$/.test(base)) { const v = VARIANTES[base] || base; return `[${v}${v.toUpperCase()}]`; }
  return escaparRegex(ch);
}
function literalARegex(texto) {
  return texto.split(/(\s+)/).map((tr) => (/^\s+$/.test(tr) ? "\\s+" : [...tr].map(claseLetra).join(""))).join("");
}

/**
 * Valida una plantilla y la compila. { ok:true, regex } o { ok:false, motivo, detalle }.
 * Motivos: "vacia" | "larga" | "llaves" (hueco que no existe o llave suelta) | "repetido" (monto, nombre, fecha o ref dos veces)
 * | "sin_monto" | "muy_general" (casi no tiene texto fijo) | "muchos" (más de 3 huecos flexibles).
 */
function compilarPlantilla(plantilla) {
  const t = String(plantilla == null ? "" : plantilla).trim();
  if (!t) return { ok: false, motivo: "vacia" };
  if (t.length > MAX_PLANTILLA) return { ok: false, motivo: "larga" };
  const trozos = [], visto = new Set();
  let flexibles = 0, literales = 0;
  const partes = t.split(/(\{[^{}]*\})/);
  for (const parte of partes) {
    const m = parte.match(/^\{([^{}]*)\}$/);
    if (!m) {
      if (/[{}]/.test(parte)) return { ok: false, motivo: "llaves", detalle: parte };
      literales += (parte.match(/[\p{L}\p{N}]/gu) || []).length;
      trozos.push({ literal: parte });
      continue;
    }
    const hueco = m[1].trim().toLowerCase();
    if (!HUECOS.includes(hueco)) return { ok: false, motivo: "llaves", detalle: m[1] };
    if (hueco !== "cualquiera" && hueco !== "hora" && visto.has(hueco)) return { ok: false, motivo: "repetido", detalle: hueco };
    visto.add(hueco);
    if (hueco === "nombre" || hueco === "cualquiera") flexibles++;
    trozos.push({ hueco });
  }
  if (!visto.has("monto")) return { ok: false, motivo: "sin_monto" };
  if (flexibles > 3) return { ok: false, motivo: "muchos" };
  if (literales < MIN_LITERALES) return { ok: false, motivo: "muy_general" };
  // ¿Cada hueco flexible va seguido de más texto? Si es el último, toma hasta el final de la línea.
  const esUltimo = (i) => trozos.slice(i + 1).every((x) => x.literal !== undefined && !/[\p{L}\p{N}]/u.test(x.literal));
  const fuente = trozos.map((x, i) => {
    if (x.literal !== undefined) return literalARegex(x.literal);
    switch (x.hueco) {
      case "monto": return MONTO_RE;
      case "fecha": return `(?<fecha>${FECHA_RE})`;
      case "hora": return `(?:${HORA_RE})`;
      case "ref": return `(?<ref>${REF_RE})`;
      case "nombre": return esUltimo(i) ? "(?<nombre>[^\\n\\r]{1,80})" : "(?<nombre>[^\\n\\r]{1,80}?)";
      default: return esUltimo(i) ? "[\\s\\S]{0,120}" : "[\\s\\S]{0,120}?";
    }
  }).join("");
  try { return { ok: true, regex: new RegExp(fuente) }; } catch (e) { return { ok: false, motivo: "llaves", detalle: String(e.message) }; }
}

/* ===================== Patrones de la persona ===================== */

const limpio = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const listarPatrones = (datos, { incluirInactivos = true } = {}) => (datos.patrones_mensajes || []).filter((p) => incluirInactivos || p.activo !== false);

function validarPatron(datos, { nombre, plantilla, tipo, categoriaId }, idActual = null) {
  if (!limpio(nombre, 40)) return { ok: false, motivo: "nombre" };
  if (!TIPOS_PATRON.includes(tipo)) return { ok: false, motivo: "tipo" };
  const c = compilarPlantilla(plantilla);
  if (!c.ok) return { ok: false, motivo: "plantilla", detalle: c.motivo, huecoDetalle: c.detalle };
  const repetida = (datos.patrones_mensajes || []).some((p) => p.id !== idActual && normalizarTexto(p.plantilla) === normalizarTexto(plantilla));
  if (repetida) return { ok: false, motivo: "repetida" };
  if (categoriaId) { const cat = buscarCategoria(datos, categoriaId); if (!cat || cat.tipo !== tipo) return { ok: false, motivo: "categoria" }; }
  return { ok: true };
}

/** Crea un patrón. Devuelve { ok, patron } o { ok:false, motivo }. El llamador marca el cambio pendiente. */
function crearPatron(datos, { nombre, plantilla, tipo = "gasto", nombreFijo = "", categoriaId = null, ordenFecha = "dmy" } = {}) {
  migrarPatronesMensajesV1(datos);
  if (datos.patrones_mensajes.length >= MAX_PATRONES) return { ok: false, motivo: "limite" };
  const v = validarPatron(datos, { nombre, plantilla, tipo, categoriaId });
  if (!v.ok) return v;
  const patron = sellarTimestamp({
    id: "pat_" + crypto.randomUUID(), nombre: limpio(nombre, 40), plantilla: String(plantilla).trim(), tipo,
    nombre_fijo: limpio(nombreFijo, 60), categoria_id: categoriaId || null, orden_fecha: ordenFecha === "mdy" ? "mdy" : "dmy", activo: true,
  });
  datos.patrones_mensajes.push(patron);
  return { ok: true, patron };
}

/** Edita un patrón (nombre, plantilla, tipo, nombreFijo, categoriaId, ordenFecha, activo). */
function editarPatron(datos, id, cambios = {}) {
  const p = (datos.patrones_mensajes || []).find((x) => x.id === id);
  if (!p) return { ok: false, motivo: "patron" };
  const nuevo = {
    nombre: cambios.nombre !== undefined ? cambios.nombre : p.nombre, plantilla: cambios.plantilla !== undefined ? cambios.plantilla : p.plantilla,
    tipo: cambios.tipo !== undefined ? cambios.tipo : p.tipo, categoriaId: cambios.categoriaId !== undefined ? cambios.categoriaId : p.categoria_id,
  };
  const v = validarPatron(datos, nuevo, id);
  if (!v.ok) return v;
  Object.assign(p, {
    nombre: limpio(nuevo.nombre, 40), plantilla: String(nuevo.plantilla).trim(), tipo: nuevo.tipo, categoria_id: nuevo.categoriaId || null,
    nombre_fijo: cambios.nombreFijo !== undefined ? limpio(cambios.nombreFijo, 60) : p.nombre_fijo,
    orden_fecha: cambios.ordenFecha !== undefined ? (cambios.ordenFecha === "mdy" ? "mdy" : "dmy") : p.orden_fecha,
    activo: cambios.activo !== undefined ? !!cambios.activo : p.activo,
  });
  sellarTimestamp(p);
  return { ok: true, patron: p };
}

/** Elimina un patrón y deja tumba para que la sincronización lo propague. */
function eliminarPatron(datos, id) {
  if (!(datos.patrones_mensajes || []).some((p) => p.id === id)) return { ok: false, motivo: "patron" };
  datos.patrones_mensajes = datos.patrones_mensajes.filter((p) => p.id !== id);
  if (!Array.isArray(datos._eliminados_patrones_mensajes)) datos._eliminados_patrones_mensajes = [];
  if (!datos._eliminados_patrones_mensajes.some((t) => t.id === id)) datos._eliminados_patrones_mensajes.push({ id, eliminadoEn: Date.now() });
  return { ok: true };
}

/* ===================== Leer con un patrón ===================== */

const hoyLocal = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const quitarPuntuacionFinal = (s) => String(s || "").replace(/\s+/g, " ").trim().replace(/[\s.,;:]+$/, "").trim();

/**
 * Aplica una plantilla a un mensaje. null si no coincide o no hay un monto mayor que cero. Si la plantilla no trae {fecha}
 * (o no se entiende), la fecha es la de hoy y se marca `fechaInferida`.
 */
function leerConPlantilla(plantilla, texto, { hoy = hoyLocal(), ordenFecha = "dmy", nombreFijo = "" } = {}) {
  const c = compilarPlantilla(plantilla);
  if (!c.ok) return null;
  const m = c.regex.exec(String(texto || "").slice(0, MAX_MENSAJE));
  if (!m) return null;
  const g = m.groups || {};
  const monto = parsearMontoTexto(g.monto);
  if (!(monto > 0)) return null;
  const fecha = g.fecha ? parsearFechaTexto(g.fecha, { orden: ordenFecha, hoy }) : null;
  return {
    monto, monedaToken: g.mpre || g.msuf || "", nombre: quitarPuntuacionFinal(g.nombre) || limpio(nombreFijo, 60),
    fecha: fecha || hoy, fechaInferida: !fecha, referencia: g.ref ? limpio(g.ref, 40) : "",
  };
}

/* ===================== Lectura general aproximada ===================== */

const PALABRAS_GASTO = ["compra", "compraste", "pago", "pagaste", "retiro", "retiraste", "cargo", "cobro", "enviaste", "envio", "transferiste", "debitaron", "purchase", "payment", "paid", "withdrawal", "withdrew", "sent", "charged", "spent"];
const PALABRAS_INGRESO = ["recibiste", "recibio", "recibido", "recibida", "recibidos", "recibidas", "deposito", "depositaron", "acreditado", "acreditaron", "abono", "abonaron", "ingreso", "reembolso", "devolucion", "received", "deposit", "deposited", "credited", "refund", "salario", "salary", "payroll"];
const PALABRAS_SALDO = /(saldo|balance|disponible|available|limite|limit)\W{0,12}$/;

/** "gasto" | "ingreso" | null (si hay empate o ninguna palabra). Quita "tarjeta de crédito/débito" antes: esas frases salen en compras. */
function adivinarTipo(texto) {
  const t = normalizarTexto(texto).replace(/tarjeta (?:de )?(?:credito|debito)|(?:credit|debit) card/g, " ");
  const cuenta = (lista) => lista.filter((p) => new RegExp(`\\b${p}`).test(t)).length;
  const g = cuenta(PALABRAS_GASTO), i = cuenta(PALABRAS_INGRESO);
  return g > i ? "gasto" : i > g ? "ingreso" : null;
}

/** Posiciones de fechas y horas en el texto (para no confundirlas con montos). */
function spansFechaHora(texto) {
  const spans = [];
  for (const [re, esFecha] of [[new RegExp(FECHA_RE, "g"), true], [new RegExp(HORA_RE, "g"), false]]) {
    let m;
    while ((m = re.exec(texto))) {
      if (!esFecha || parsearFechaTexto(m[0], { hoy: "2026-01-01" })) spans.push({ ini: m.index, fin: m.index + m[0].length, texto: m[0], tipo: esFecha ? "fecha" : "hora" });
      if (m[0] === "") re.lastIndex++;
    }
  }
  return spans;
}
const solapa = (a, b) => a.ini < b.fin && b.ini < a.fin;

/** Montos candidatos en orden de aparición: primero los que traen moneda, luego los que parecen dinero, luego enteros sueltos. */
function encontrarMontos(texto, evitar = []) {
  const re = new RegExp(`(?:(${MONEDA_ANTES})\\s?)?(${NUMERO_MONTO})(?:\\s?(${MONEDA_DESPUES})(?![A-Za-z]))?`, "g");
  const todos = [];
  let m;
  while ((m = re.exec(texto))) {
    const span = { ini: m.index, fin: m.index + m[0].length };
    if (m[0] === "") { re.lastIndex++; continue; }
    const antes = texto.slice(Math.max(0, m.index - 14), m.index).toLowerCase();
    const prev = texto[m.index - 1] || "", next = texto[span.fin] || "";
    const monto = parsearMontoTexto(m[2]);
    if (!(monto > 0) || evitar.some((e) => solapa(e, span)) || PALABRAS_SALDO.test(normalizarTexto(antes))) continue;
    const moneda = m[1] || m[3] || "";
    const pareceDinero = /[.,]\d{1,2}$/.test(m[2]) || /\d[.,\u00a0\u202f ]\d{3}/.test(m[2]);
    const sueltoSeguro = !/[\d/:*#-]/.test(prev) && !/[\d/:*]/.test(next) && m[2].length <= 9 && !/^[*#]/.test(antes.slice(-1));
    const nivel = moneda ? 0 : pareceDinero ? 1 : sueltoSeguro ? 2 : 9;
    if (nivel < 9) todos.push({ ...span, monto, moneda, nivel, texto: m[0] });
  }
  const mejor = Math.min(...todos.map((x) => x.nivel), 9);
  return todos.filter((x) => x.nivel === mejor);
}

function adivinarNombre(texto, desde, evitar = []) {
  // Fechas y horas se tapan con espacios (misma longitud) para que "el 3 de oct" no se lea como un nombre.
  const limpioTexto = evitar.reduce((t, e) => t.slice(0, e.ini) + " ".repeat(e.fin - e.ini) + t.slice(e.fin), texto);
  const despues = limpioTexto.slice(desde);
  const m = despues.match(/(?:^|\s)(?:en|at|a|to|de|from|para|comercio)\s+((?!(?:la|el|su|tu|the|your)\s)[^\n\r.;,]{2,40}?)(?=\s+(?:con|with|el|on|using|ref|desde|del|tarjeta|card|las)\b|[.;,\n\r]|\s*$|\s+\d{1,2}[/-])/i);
  return m ? quitarPuntuacionFinal(m[1]) : "";
}

/**
 * Lectura sin patrón. null si no hay ningún monto. Devuelve lo que encontró y `advertencias`:
 * "tipo_incierto", "varios_montos", "fecha_inferida". Es aproximada: la persona confirma antes de guardar.
 */
function leerMensajeGenerico(texto, { hoy = hoyLocal() } = {}) {
  const t = String(texto || "").slice(0, MAX_MENSAJE);
  const fh = spansFechaHora(t);
  const montos = encontrarMontos(t, fh);
  if (!montos.length) return null;
  const elegido = montos[0];
  const advertencias = [];
  const tipo = adivinarTipo(t);
  if (!tipo) advertencias.push("tipo_incierto");
  if (new Set(montos.map((x) => x.monto)).size > 1) advertencias.push("varios_montos");
  const f = fh.filter((x) => x.tipo === "fecha").map((x) => parsearFechaTexto(x.texto, { hoy })).find(Boolean) || null;
  if (!f) advertencias.push("fecha_inferida");
  const ref = (t.match(/(?:ref(?:erencia)?|comprobante|operaci[oó]n|transacci[oó]n|transaction)\.?\s*[:#]?\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]{3,29})/i) || [])[1] || "";
  return {
    monto: elegido.monto, monedaToken: elegido.moneda, tipo, nombre: adivinarNombre(t, elegido.fin, fh), fecha: f || hoy,
    fechaInferida: !f, referencia: ref, advertencias, montosEncontrados: montos.map((x) => x.monto),
  };
}

/* ===================== Un mensaje o varios → candidatos ===================== */

/** Separa mensajes pegados juntos: una línea en blanco entre uno y otro. Ignora vacíos y limita la cantidad. */
function separarMensajes(texto) {
  const trozos = String(texto || "").split(/\r?\n\s*\r?\n/).map((s) => s.trim()).filter(Boolean);
  // Un correo del banco trae líneas en blanco: si solo UN trozo tiene monto, todo el texto es un solo mensaje.
  const conMonto = trozos.filter((z) => (leerMensajeGenerico(z)?.monto || 0) > 0).length;
  if (conMonto === 1 && trozos.length > 1) return [trozos.join("\n\n")];
  return trozos.slice(0, MAX_MENSAJES);
}

/** Patrones activos, los de más texto fijo primero (los más específicos ganan sobre los generales). */
function patronesOrdenados(datos) {
  return listarPatrones(datos, { incluirInactivos: false }).filter((p) => compilarPlantilla(p.plantilla).ok)
    .map((p, i) => ({ p, i, largo: p.plantilla.replace(/\{[^}]*\}/g, "").length }))
    .sort((a, b) => b.largo - a.largo || a.i - b.i).map((x) => x.p);
}

/**
 * Pega uno o varios mensajes → candidatos para `clasificarCandidatos` (finanzas-importar.js), en el mismo orden.
 * Cada candidato trae `lectura`: "patron" (con `patronNombre`), "general" o "ninguna" (no se vio ningún monto).
 * Sin tipo seguro, `tipo` queda null: la persona lo elige antes de guardar.
 */
function leerMensajes(datos, texto, { hoy = hoyLocal() } = {}) {
  const patrones = patronesOrdenados(datos);
  return separarMensajes(texto).map((mensaje, i) => {
    const c = { fila: i + 1, advertencias: [], origen: "manual", fuente: "liquido", sentido: "suma", textoOriginal: mensaje, categoriaId: null };
    let lectura = null;
    for (const p of patrones) {
      const r = leerConPlantilla(p.plantilla, mensaje, { hoy, ordenFecha: p.orden_fecha, nombreFijo: p.nombre_fijo });
      if (r) { lectura = { ...r, tipo: p.tipo, categoriaId: p.categoria_id, patron: p }; break; }
    }
    if (lectura) {
      c.lectura = "patron"; c.patronId = lectura.patron.id; c.patronNombre = lectura.patron.nombre; c.categoriaId = lectura.categoriaId || null;
      if (lectura.fechaInferida) c.advertencias.push("fecha_inferida");
    } else {
      lectura = leerMensajeGenerico(mensaje, { hoy });
      if (lectura) { c.lectura = "general"; c.advertencias.push(...lectura.advertencias); c.montosEncontrados = lectura.montosEncontrados; }
      else { c.lectura = "ninguna"; Object.assign(c, { tipo: null, monto: 0, fecha: hoy, nombre: "", nota: "", referencia: "" }); return c; }
    }
    Object.assign(c, {
      tipo: lectura.tipo, monto: lectura.monto, fecha: lectura.fecha, nombre: limpio(lectura.nombre, 80), referencia: lectura.referencia,
      nota: lectura.referencia ? `Ref. ${lectura.referencia}` : "", monedaToken: lectura.monedaToken,
    });
    if (!c.categoriaId && c.nombre && (c.tipo === "gasto" || c.tipo === "ingreso")) {
      const s = sugerirCategoria(datos, c.nombre, c.tipo);
      if (s) c.categoriaId = s.categoriaId;
    }
    return c;
  });
}

/* ===================== Crear un patrón desde un mensaje de ejemplo ===================== */

/**
 * Propone una plantilla a partir de un mensaje: el monto, la fecha, la hora y la referencia pasan a huecos; los números
 * largos que quedan (últimos dígitos de una tarjeta, por ejemplo) pasan a {cualquiera}; y si se indica `textoNombre`
 * (la parte que es el comercio o la persona), pasa a {nombre}. La persona la revisa y la ajusta.
 * Devuelve { plantilla, ok } donde `ok` dice si ya se puede guardar tal cual.
 */
function sugerirPlantilla(mensaje, { textoNombre = "" } = {}) {
  const t = String(mensaje || "").trim().slice(0, MAX_MENSAJE);
  if (!t) return { plantilla: "", ok: false };
  const fh = spansFechaHora(t);
  const spans = [];
  const meter = (s, hueco) => { if (s && !spans.some((x) => solapa(x, s))) spans.push({ ini: s.ini, fin: s.fin, hueco }); };
  const monto = encontrarMontos(t, fh)[0];
  if (monto) meter(monto, "{monto}");
  const fecha = fh.find((x) => x.tipo === "fecha"); if (fecha) meter(fecha, "{fecha}");
  const hora = fh.find((x) => x.tipo === "hora"); if (hora) meter(hora, "{hora}");
  const nombre = String(textoNombre || "").trim();
  if (nombre.length >= 2) { const i = t.indexOf(nombre); if (i >= 0) meter({ ini: i, fin: i + nombre.length }, "{nombre}"); }
  const ref = t.match(/(?:ref(?:erencia)?|comprobante|operaci[oó]n|transacci[oó]n|transaction)\.?\s*[:#]?\s*([A-Za-z0-9-]*\d[A-Za-z0-9-]{3,29})/i);
  if (ref) { const i = t.indexOf(ref[1], ref.index); meter({ ini: i, fin: i + ref[1].length }, "{ref}"); }
  const re = /\d{3,}/g; let m;
  while ((m = re.exec(t))) meter({ ini: m.index, fin: m.index + m[0].length }, "{cualquiera}");
  spans.sort((a, b) => a.ini - b.ini);
  let plantilla = "", pos = 0;
  spans.forEach((s) => { plantilla += t.slice(pos, s.ini) + s.hueco; pos = s.fin; });
  plantilla += t.slice(pos);
  plantilla = plantilla.replace(/\s*[\r\n]+\s*/g, " ");
  return { plantilla, ok: compilarPlantilla(plantilla).ok };
}

export {
  HUECOS, MAX_MENSAJE, MAX_MENSAJES, MAX_PATRONES, MAX_PLANTILLA, TIPOS_PATRON,
  adivinarTipo, compilarPlantilla, crearPatron, editarPatron, eliminarPatron, leerConPlantilla, leerMensajeGenerico, leerMensajes,
  listarPatrones, migrarPatronesMensajesV1, separarMensajes, sugerirPlantilla, validarPatron,
};
