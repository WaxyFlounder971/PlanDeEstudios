/* =========================================================================
   FINANZAS 2.0: Me deben y debo (sesión 7A, F7). Módulo opcional, lógica pura sin DOM.
   Un "préstamo" es solo la cuenta de una persona: quién es, si le prestaste o te prestaron, y cuánto había antes de
   usar la app (`saldo_inicial`). Lo que se debe HOY se deriva de los movimientos, nunca se guarda:
     - Le presté a alguien (direccion "preste"):  debe = saldo_inicial + lo que le presté - lo que me devolvió.
     - Me prestaron (direccion "me_prestaron"):   debo = saldo_inicial + lo que me prestaron + gastos que pagó por mí - lo que devolví.
   Prestar o devolver mueve Mi dinero (movimiento tipo "prestamo", sentido "sale" | "entra"), pero NUNCA es gasto ni ingreso.
   Dividir un gasto: solo TU parte cuenta como gasto; lo que adelantaste por los demás queda como "me deben".
   Si otra persona pagó, tu parte cuenta como gasto pero Mi dinero no baja, y le debes esa parte.
   Apagar el módulo solo oculta: sus movimientos dejan de verse y de contar (ver finanzas-derivados.js); nada se borra.
   Colección nueva: datos.prestamos, con tumbas en datos._eliminados_prestamos.
   ========================================================================= */

import { crearMovimiento, hoyIso } from "./finanzas-modelo.js";
import { movimientosVigentes, obtenerModulosFinanzas } from "./finanzas-derivados.js";
import { quitarMovimiento } from "./finanzas-registro.js";
import { sellarTimestamp } from "./schema.js";

const DIRECCIONES = ["preste", "me_prestaron"];
const MAX_PERSONA = 40;
const MAX_NOTA = 120;
const MAX_MONTO = 1_000_000_000_000;
const MAX_PARTES = 20;

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const limpiar = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || "")) && !Number.isNaN(new Date(f + "T00:00:00").getTime());

const deudasActivas = (datos) => !!obtenerModulosFinanzas(datos).deudas;

/** Enciende o apaga el módulo. Sella la configuración para que el cambio viaje al otro dispositivo. Apagar solo oculta. */
function activarDeudas(datos, encendido) {
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.finanzas_deudas = !!encendido;
  sellarTimestamp(datos.configuracion);
  return !!encendido;
}

/** Asegura las colecciones (la llama schema.js al normalizar). Idempotente; no toca nada existente. */
function migrarPrestamosV1(datos) {
  if (!datos) return 0;
  if (!Array.isArray(datos.prestamos)) datos.prestamos = [];
  if (!Array.isArray(datos._eliminados_prestamos)) datos._eliminados_prestamos = [];
  return 0;
}

/** Préstamos vigentes. Los archivados se muestran solo si se piden. */
function listarPrestamos(datos, { incluirArchivados = false, direccion } = {}) {
  return (datos.prestamos || []).filter((p) => (incluirArchivados || !p.archivado) && (!direccion || p.direccion === direccion));
}
const buscarPrestamo = (datos, id) => (datos.prestamos || []).find((p) => p.id === id) || null;

/** Movimientos (vigentes o no) que pertenecen a un préstamo, del más reciente al más viejo. */
function movimientosDePrestamo(datos, prestamoId) {
  return (datos.movimientos || [])
    .filter((m) => (m.tipo === "prestamo" && m.prestamo_id === prestamoId) || (m.tipo === "gasto" && m.pagado_por_prestamo_id === prestamoId))
    .sort((a, b) => String(b.fecha_registro || "").localeCompare(String(a.fecha_registro || "")));
}

/**
 * Cuánto se debe en este préstamo a la fecha `hasta`. Devuelve null con el módulo apagado.
 * { saldo (puede ser negativo si se devolvió de más), pendiente (saldo sin negativos), prestado, devuelto, pagadoPorMi, saldado }
 */
function calcularSaldoPrestamo(prestamo, datos, hasta = hoyIso()) {
  if (!prestamo || !deudasActivas(datos)) return null;
  const mia = (datos.prestamos || []).some((p) => p.id === prestamo.id);
  if (!mia) return null;
  let salen = 0, entran = 0, pagadoPorOtro = 0;
  movimientosVigentes(datos, hasta).forEach((m) => {
    if (m.tipo === "prestamo" && m.prestamo_id === prestamo.id) { if (m.sentido === "entra") entran += Number(m.monto) || 0; else salen += Number(m.monto) || 0; }
    else if (m.tipo === "gasto" && m.pagado_por_prestamo_id === prestamo.id) pagadoPorOtro += Number(m.monto) || 0;
  });
  const inicial = Number(prestamo.saldo_inicial) || 0;
  const meDeben = prestamo.direccion === "preste";
  const saldo = redondear(meDeben ? inicial + salen - entran : inicial + entran + pagadoPorOtro - salen);
  return {
    saldo, pendiente: Math.max(0, saldo), saldado: saldo <= 0,
    prestado: redondear(meDeben ? salen : entran), devuelto: redondear(meDeben ? entran : salen), pagadoPorMi: redondear(pagadoPorOtro),
  };
}

/** Totales para el encabezado: cuánto te deben, cuánto debes y el neto. Solo lo vigente y no archivado. */
function resumirDeudas(datos, hasta = hoyIso()) {
  const r = { meDeben: 0, debo: 0, neto: 0, personasMeDeben: 0, personasDebo: 0, saldados: 0 };
  if (!deudasActivas(datos)) return r;
  listarPrestamos(datos).forEach((p) => {
    const s = calcularSaldoPrestamo(p, datos, hasta);
    if (!s) return;
    if (s.saldado) { r.saldados++; return; }
    if (p.direccion === "preste") { r.meDeben += s.pendiente; r.personasMeDeben++; } else { r.debo += s.pendiente; r.personasDebo++; }
  });
  r.meDeben = redondear(r.meDeben); r.debo = redondear(r.debo); r.neto = redondear(r.meDeben - r.debo);
  return r;
}

function validarMonto(monto) {
  const v = redondear(monto);
  if (!(v > 0)) return { ok: false, motivo: "monto" };
  if (v > MAX_MONTO) return { ok: false, motivo: "monto_grande" };
  return { ok: true, valor: v };
}

function validarPersona(datos, persona, direccion, idActual = null) {
  const nombre = limpiar(persona, MAX_PERSONA);
  if (!nombre) return { ok: false, motivo: "persona" };
  if (!DIRECCIONES.includes(direccion)) return { ok: false, motivo: "direccion" };
  const repetida = (datos.prestamos || []).some((p) => p.id !== idActual && !p.archivado && p.direccion === direccion && normalizar(p.persona) === normalizar(nombre));
  return repetida ? { ok: false, motivo: "repetida" } : { ok: true, nombre };
}

function nuevoMovimientoPrestamo(datos, prestamo, sentido, monto, fecha, nota) {
  const mov = crearMovimiento({ tipo: "prestamo", nombre: prestamo.persona, monto, fechaRegistro: fecha, nota: limpiar(nota, MAX_NOTA) || null, sentido, prestamoId: prestamo.id });
  (datos.movimientos = datos.movimientos || []).push(mov);
  return mov;
}

/**
 * Crea la cuenta de una persona. `modo`:
 *   "ahora"  = el dinero se mueve hoy (o en `fecha`): se registra el movimiento y Mi dinero cambia.
 *   "previo" = ya estaba prestado antes de usar la app: queda como saldo inicial y Mi dinero no cambia.
 *   "sin_monto" = solo crear la persona (monto 0), por ejemplo para ir sumando gastos divididos.
 */
function crearPrestamo(datos, { persona, direccion = "preste", monto = 0, modo = "ahora", fecha, nota = "" } = {}) {
  migrarPrestamosV1(datos);
  const vp = validarPersona(datos, persona, direccion); if (!vp.ok) return vp;
  const f = fecha === undefined ? hoyIso() : fecha;
  if (!fechaValida(f)) return { ok: false, motivo: "fecha" };
  let valor = 0;
  if (modo !== "sin_monto") { const vm = validarMonto(monto); if (!vm.ok) return vm; valor = vm.valor; }
  const prestamo = sellarTimestamp({
    id: "pre_" + crypto.randomUUID(), persona: vp.nombre, direccion, saldo_inicial: modo === "previo" ? valor : 0,
    fecha: f, nota: limpiar(nota, MAX_NOTA) || null, archivado: false,
  });
  datos.prestamos.push(prestamo);
  const movimiento = modo === "ahora" ? nuevoMovimientoPrestamo(datos, prestamo, direccion === "preste" ? "sale" : "entra", valor, f, nota) : null;
  return { ok: true, prestamo, movimiento };
}

/** El mismo préstamo abierto de esa persona y dirección, o uno nuevo sin monto. Sirve para dividir gastos. */
function buscarOCrearPrestamoDePersona(datos, persona, direccion) {
  migrarPrestamosV1(datos);
  const n = normalizar(limpiar(persona, MAX_PERSONA));
  const existente = (datos.prestamos || []).find((p) => !p.archivado && p.direccion === direccion && normalizar(p.persona) === n);
  if (existente) return { ok: true, prestamo: existente, creado: false };
  const r = crearPrestamo(datos, { persona, direccion, modo: "sin_monto" });
  return r.ok ? { ok: true, prestamo: r.prestamo, creado: true } : r;
}

/** Quien te debe te devuelve (o tú devuelves): baja lo pendiente. No permite devolver más de lo que queda. */
function registrarAbono(datos, prestamoId, { monto, fecha, nota = "" } = {}) {
  const prestamo = buscarPrestamo(datos, prestamoId); if (!prestamo) return { ok: false, motivo: "no_existe" };
  if (!deudasActivas(datos)) return { ok: false, motivo: "modulo_apagado" };
  const vm = validarMonto(monto); if (!vm.ok) return vm;
  const f = fecha === undefined ? hoyIso() : fecha; if (!fechaValida(f)) return { ok: false, motivo: "fecha" };
  const s = calcularSaldoPrestamo(prestamo, datos, "9999-12-31");
  if (vm.valor > s.pendiente + 0.001) return { ok: false, motivo: "excede", pendiente: s.pendiente };
  const movimiento = nuevoMovimientoPrestamo(datos, prestamo, prestamo.direccion === "preste" ? "entra" : "sale", vm.valor, f, nota);
  return { ok: true, movimiento };
}

/** Prestar más a la misma persona (o que te presten más): sube lo pendiente. */
function registrarPrestamoAdicional(datos, prestamoId, { monto, fecha, nota = "" } = {}) {
  const prestamo = buscarPrestamo(datos, prestamoId); if (!prestamo) return { ok: false, motivo: "no_existe" };
  if (!deudasActivas(datos)) return { ok: false, motivo: "modulo_apagado" };
  const vm = validarMonto(monto); if (!vm.ok) return vm;
  const f = fecha === undefined ? hoyIso() : fecha; if (!fechaValida(f)) return { ok: false, motivo: "fecha" };
  const movimiento = nuevoMovimientoPrestamo(datos, prestamo, prestamo.direccion === "preste" ? "sale" : "entra", vm.valor, f, nota);
  return { ok: true, movimiento };
}

/**
 * Divide un gasto entre varias personas.
 *   quienPago "yo": pagaste todo. Se registra TU parte como gasto y lo adelantado por cada persona como "me deben".
 *   quienPago "otra": pagó otra persona (`pagador`). TU parte es gasto, Mi dinero no baja y le debes esa parte.
 * `total` es lo que costó todo. `partes` = [{ persona, monto }] lo que le toca a cada uno de los demás. Tu parte = total - suma de partes.
 * Devuelve los ids de todo lo creado para poder deshacer con `deshacerDivision`.
 */
function dividirGasto(datos, { nombre, total, partes = [], quienPago = "yo", pagador = "", fecha, categoriaId = null, nota = "" } = {}) {
  migrarPrestamosV1(datos);
  if (!deudasActivas(datos)) return { ok: false, motivo: "modulo_apagado" };
  const titulo = limpiar(nombre, 60); if (!titulo) return { ok: false, motivo: "nombre" };
  const vt = validarMonto(total); if (!vt.ok) return vt;
  const f = fecha === undefined ? hoyIso() : fecha; if (!fechaValida(f)) return { ok: false, motivo: "fecha" };
  const lista = (partes || []).map((p) => ({ persona: limpiar(p.persona, MAX_PERSONA), monto: redondear(p.monto) })).filter((p) => p.persona || p.monto);
  if (quienPago === "yo" && !lista.length) return { ok: false, motivo: "sin_partes" };
  if (lista.length > MAX_PARTES) return { ok: false, motivo: "muchas_partes" };
  if (lista.some((p) => !p.persona)) return { ok: false, motivo: "persona" };
  if (lista.some((p) => !(p.monto > 0))) return { ok: false, motivo: "monto_parte" };
  const claves = lista.map((p) => normalizar(p.persona));
  if (new Set(claves).size !== claves.length) return { ok: false, motivo: "persona_repetida" };
  const suma = redondear(lista.reduce((t, p) => t + p.monto, 0));
  const mia = redondear(vt.valor - suma);
  if (mia < -0.001) return { ok: false, motivo: "partes_exceden" };
  const creadosMov = [], creadosPre = [];
  const notaFinal = limpiar(nota, MAX_NOTA) || null;

  if (quienPago === "otra") {
    const quien = limpiar(pagador, MAX_PERSONA); if (!quien) return { ok: false, motivo: "pagador" };
    // Tu parte es lo que queda del total tras las partes de los demás; si no hay otras partes, es todo.
    const bp = buscarOCrearPrestamoDePersona(datos, quien, "me_prestaron"); if (!bp.ok) return bp;
    if (bp.creado) creadosPre.push(bp.prestamo.id);
    if (mia > 0) {
      const g = crearMovimiento({ tipo: "gasto", nombre: titulo, monto: mia, fechaRegistro: f, nota: notaFinal, categoriaId, pagadoPorPrestamoId: bp.prestamo.id });
      datos.movimientos.push(g); creadosMov.push(g.id);
    }
    return { ok: true, movimientos: creadosMov, prestamosNuevos: creadosPre, miParte: mia };
  }

  if (mia > 0) {
    const g = crearMovimiento({ tipo: "gasto", nombre: titulo, monto: mia, fechaRegistro: f, nota: notaFinal, categoriaId });
    datos.movimientos.push(g); creadosMov.push(g.id);
  }
  for (const p of lista) {
    const b = buscarOCrearPrestamoDePersona(datos, p.persona, "preste"); if (!b.ok) return b;
    if (b.creado) creadosPre.push(b.prestamo.id);
    const m = crearMovimiento({ tipo: "prestamo", nombre: b.prestamo.persona, monto: p.monto, fechaRegistro: f, nota: limpiar(`${titulo}${notaFinal ? ": " + notaFinal : ""}`, MAX_NOTA), sentido: "sale", prestamoId: b.prestamo.id });
    datos.movimientos.push(m); creadosMov.push(m.id);
  }
  return { ok: true, movimientos: creadosMov, prestamosNuevos: creadosPre, miParte: mia };
}

/** Quita todo lo que creó `dividirGasto` (movimientos con tumba y las personas que se crearon solo para eso). */
function deshacerDivision(datos, resultado) {
  if (!resultado || !resultado.ok) return 0;
  let n = 0;
  (resultado.movimientos || []).forEach((id) => { if (quitarMovimiento(datos, id)) n++; });
  (resultado.prestamosNuevos || []).forEach((id) => { if (!movimientosDePrestamo(datos, id).length) eliminarPrestamo(datos, id); });
  return n;
}

/** Cambia el nombre o la nota. El nombre sigue siendo único por dirección. */
function editarPrestamo(datos, id, { persona, nota } = {}) {
  const p = buscarPrestamo(datos, id); if (!p) return { ok: false, motivo: "no_existe" };
  if (persona !== undefined) {
    const v = validarPersona(datos, persona, p.direccion, id); if (!v.ok) return v;
    p.persona = v.nombre;
  }
  if (nota !== undefined) p.nota = limpiar(nota, MAX_NOTA) || null;
  sellarTimestamp(p);
  return { ok: true, prestamo: p };
}

/** Archivar oculta la cuenta de la lista sin tocar nada de lo registrado. */
function archivarPrestamo(datos, id, archivar = true) {
  const p = buscarPrestamo(datos, id); if (!p) return { ok: false, motivo: "no_existe" };
  if (archivar === false) {
    const v = validarPersona(datos, p.persona, p.direccion, id); if (!v.ok) return v;
  }
  p.archivado = !!archivar; sellarTimestamp(p);
  return { ok: true, prestamo: p };
}

/** Eliminar solo si no tiene movimientos: así nunca queda dinero movido sin su cuenta (para eso, archivar). */
function eliminarPrestamo(datos, id) {
  const indice = (datos.prestamos || []).findIndex((p) => p.id === id);
  if (indice < 0) return { ok: false, motivo: "no_existe" };
  if (movimientosDePrestamo(datos, id).length) return { ok: false, motivo: "tiene_movimientos" };
  datos.prestamos.splice(indice, 1);
  if (!Array.isArray(datos._eliminados_prestamos)) datos._eliminados_prestamos = [];
  if (!datos._eliminados_prestamos.some((t) => t.id === id)) datos._eliminados_prestamos.push({ id, eliminadoEn: Date.now() });
  return { ok: true };
}

/** Personas ya usadas, para sugerir al dividir (sin repetir, más recientes primero). */
function personasConocidas(datos) {
  const vistos = new Set(), salida = [];
  [...(datos.prestamos || [])].reverse().forEach((p) => { const k = normalizar(p.persona); if (!vistos.has(k)) { vistos.add(k); salida.push(p.persona); } });
  return salida;
}

export {
  DIRECCIONES, MAX_PARTES, MAX_PERSONA,
  activarDeudas, archivarPrestamo, buscarOCrearPrestamoDePersona, buscarPrestamo, calcularSaldoPrestamo, crearPrestamo, deshacerDivision, deudasActivas,
  dividirGasto, editarPrestamo, eliminarPrestamo, listarPrestamos, migrarPrestamosV1, movimientosDePrestamo, personasConocidas,
  registrarAbono, registrarPrestamoAdicional, resumirDeudas,
};
