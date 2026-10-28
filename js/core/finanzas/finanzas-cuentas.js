/* =========================================================================
   FINANZAS 2.0: Cuentas (sesión 7B, F7). Módulo opcional, lógica pura sin DOM.
   Una cuenta es DÓNDE está tu dinero: efectivo, una cuenta de banco, una tarjeta de crédito (tuya o pagada por un familiar)…
   Cada cuenta tiene su propia divisa. No hay conversión: Mi dinero muestra un total por divisa.
   - Los movimientos sin cuenta siguen como siempre ("Sin asignar", en la moneda de la app). Lo que ya tenías se reparte entre
     tus cuentas con un traspaso desde "Sin asignar", sin duplicar nada.
   - Gasto, ingreso y ajuste pueden decir en qué cuenta ocurrieron. Pasar dinero entre cuentas (traspaso, por ejemplo pagar la
     tarjeta) NUNCA es gasto ni ingreso.
   - Una tarjeta de crédito es una cuenta cuyo saldo queda negativo cuando compras (lo que debes). Pagarla es un traspaso.
   - "No afecta mi saldo" (una tarjeta que paga un familiar): sus gastos cuentan en tus gastos y categorías, pero Mi dinero no baja.
   - El saldo de cada cuenta se DERIVA (finanzas-derivados.js), nunca se guarda: solo `saldo_inicial`.
   Apagar el módulo solo oculta: las cuentas se ignoran y lo de otras divisas no se mezcla con lo de la moneda de la app.
   Colección nueva: datos.cuentas, con tumbas en datos._eliminados_cuentas. Interruptor: configuracion.finanzas_cuentas.
   ========================================================================= */

import { crearMovimiento, hoyIso } from "./finanzas-modelo.js";
import { calcularTotalesMovimientos } from "./finanzas-derivados.js";
import { cuentasActivas, monedaPrincipal } from "./finanzas-cuentas-base.js";
import { MONEDAS_DISPONIBLES, sellarTimestamp } from "../schema.js";

const TIPOS_CUENTA = ["efectivo", "banco", "credito", "otra"];
const MAX_NOMBRE = 30;
const MAX_MONTO = 1_000_000_000_000;
const MAX_CUENTAS = 40;

const redondear = (n) => Math.round((Number(n) || 0) * 100) / 100;
const normalizar = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim().replace(/\s+/g, " ");
const limpiar = (s, max) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);
const fechaValida = (f) => /^\d{4}-\d{2}-\d{2}$/.test(String(f || "")) && !Number.isNaN(new Date(f + "T00:00:00").getTime());
const monedaConocida = (id) => MONEDAS_DISPONIBLES.some((m) => m.id === id);

/** Enciende o apaga el módulo. Sella la configuración para que el cambio viaje al otro dispositivo. Apagar solo oculta. */
function activarCuentas(datos, encendido) {
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.finanzas_cuentas = !!encendido;
  sellarTimestamp(datos.configuracion);
  return !!encendido;
}

/** Asegura las colecciones (la llama schema.js al normalizar). Idempotente; no toca nada existente. */
function migrarCuentasV1(datos) {
  if (!datos) return 0;
  if (!Array.isArray(datos.cuentas)) datos.cuentas = [];
  if (!Array.isArray(datos._eliminados_cuentas)) datos._eliminados_cuentas = [];
  return 0;
}

function listarCuentas(datos, { incluirArchivadas = false } = {}) {
  return (datos.cuentas || []).filter((c) => incluirArchivadas || !c.archivada);
}
const buscarCuenta = (datos, id) => (datos.cuentas || []).find((c) => c.id === id) || null;

/** Movimientos que mencionan una cuenta (en que ocurrieron o como origen o destino de un traspaso). */
function movimientosDeCuenta(datos, id) {
  return (datos.movimientos || [])
    .filter((m) => m.cuenta_id === id || m.cuenta_destino_id === id)
    .sort((a, b) => String(b.fecha_registro || "").localeCompare(String(a.fecha_registro || "")));
}

function validarDatosCuenta(datos, { nombre, tipo, moneda, saldoInicial, limite }, idActual = null) {
  const n = limpiar(nombre, MAX_NOMBRE);
  if (!n) return { ok: false, motivo: "nombre" };
  if (!TIPOS_CUENTA.includes(tipo)) return { ok: false, motivo: "tipo" };
  if (!monedaConocida(moneda)) return { ok: false, motivo: "moneda" };
  const ini = Number(saldoInicial) || 0;
  if (Math.abs(ini) > MAX_MONTO) return { ok: false, motivo: "monto_grande" };
  if (limite !== undefined && limite !== null && limite !== "" && (!(Number(limite) >= 0) || Number(limite) > MAX_MONTO)) return { ok: false, motivo: "limite" };
  if ((datos.cuentas || []).some((c) => c.id !== idActual && !c.archivada && normalizar(c.nombre) === normalizar(n))) return { ok: false, motivo: "repetida" };
  return { ok: true, nombre: n, saldoInicial: redondear(ini) };
}

/**
 * Crea una cuenta. `saldoInicial` puede ser negativo (una tarjeta con deuda). `afectaSaldo` falso = no es tu dinero (la paga otra persona).
 * `limite` (solo tarjeta de crédito) es informativo: sirve para mostrar cuánto te queda por usar.
 */
function crearCuenta(datos, { nombre, tipo = "banco", moneda, saldoInicial = 0, afectaSaldo = true, limite = null, emoji = "" } = {}) {
  migrarCuentasV1(datos);
  const m = moneda || monedaPrincipal(datos);
  const v = validarDatosCuenta(datos, { nombre, tipo, moneda: m, saldoInicial, limite }); if (!v.ok) return v;
  if (listarCuentas(datos, { incluirArchivadas: true }).length >= MAX_CUENTAS) return { ok: false, motivo: "muchas" };
  const cuenta = sellarTimestamp({
    id: "cue_" + crypto.randomUUID(), nombre: v.nombre, tipo, moneda: m, saldo_inicial: afectaSaldo === false ? 0 : v.saldoInicial,
    afecta_saldo: afectaSaldo !== false, limite: tipo === "credito" && limite !== null && limite !== "" ? redondear(limite) : null,
    emoji: limpiar(emoji, 4) || null, archivada: false,
  });
  datos.cuentas.push(cuenta);
  return { ok: true, cuenta };
}

/**
 * Edita nombre, tipo, emoji, límite y si afecta mi saldo. La divisa no cambia si la cuenta ya tiene movimientos
 * (los montos dejarían de significar lo mismo); para eso se crea otra cuenta.
 */
function editarCuenta(datos, id, cambios = {}) {
  const c = buscarCuenta(datos, id); if (!c) return { ok: false, motivo: "no_existe" };
  const nuevo = {
    nombre: cambios.nombre !== undefined ? cambios.nombre : c.nombre, tipo: cambios.tipo !== undefined ? cambios.tipo : c.tipo,
    moneda: cambios.moneda !== undefined ? cambios.moneda : c.moneda, saldoInicial: cambios.saldoInicial !== undefined ? cambios.saldoInicial : c.saldo_inicial,
    limite: cambios.limite !== undefined ? cambios.limite : c.limite,
  };
  const v = validarDatosCuenta(datos, nuevo, id); if (!v.ok) return v;
  if (nuevo.moneda !== c.moneda && movimientosDeCuenta(datos, id).length) return { ok: false, motivo: "moneda_bloqueada" };
  const afecta = cambios.afectaSaldo !== undefined ? cambios.afectaSaldo !== false : c.afecta_saldo !== false;
  c.nombre = v.nombre; c.tipo = nuevo.tipo; c.moneda = nuevo.moneda; c.afecta_saldo = afecta;
  c.saldo_inicial = afecta ? v.saldoInicial : 0;
  c.limite = nuevo.tipo === "credito" && nuevo.limite !== null && nuevo.limite !== "" ? redondear(nuevo.limite) : null;
  if (cambios.emoji !== undefined) c.emoji = limpiar(cambios.emoji, 4) || null;
  sellarTimestamp(c);
  return { ok: true, cuenta: c };
}

/** Archivar oculta la cuenta de las listas y selectores; su saldo y sus movimientos siguen contando. */
function archivarCuenta(datos, id, archivar = true) {
  const c = buscarCuenta(datos, id); if (!c) return { ok: false, motivo: "no_existe" };
  if (archivar === false && (datos.cuentas || []).some((x) => x.id !== id && !x.archivada && normalizar(x.nombre) === normalizar(c.nombre))) return { ok: false, motivo: "repetida" };
  c.archivada = !!archivar; sellarTimestamp(c);
  return { ok: true, cuenta: c };
}

/** Eliminar solo sin movimientos y sin saldo inicial: así Mi dinero nunca cambia por borrar una cuenta (para eso, archivar). */
function eliminarCuenta(datos, id) {
  const i = (datos.cuentas || []).findIndex((c) => c.id === id);
  if (i < 0) return { ok: false, motivo: "no_existe" };
  if (movimientosDeCuenta(datos, id).length) return { ok: false, motivo: "tiene_movimientos" };
  if (Number(datos.cuentas[i].saldo_inicial)) return { ok: false, motivo: "tiene_saldo" };
  datos.cuentas.splice(i, 1);
  if (!Array.isArray(datos._eliminados_cuentas)) datos._eliminados_cuentas = [];
  if (!datos._eliminados_cuentas.some((t) => t.id === id)) datos._eliminados_cuentas.push({ id, eliminadoEn: Date.now() });
  return { ok: true };
}

/**
 * Pasa dinero de una cuenta a otra. `origenId` / `destinoId` null = "Sin asignar" (lo de Mi dinero que no está en ninguna cuenta).
 * Con divisas distintas hay que decir cuánto llegó (`montoDestino`): la app no convierte.
 * Nunca es gasto ni ingreso. Por ejemplo, pagar la tarjeta es un traspaso desde tu cuenta de banco a la tarjeta.
 */
function crearTraspaso(datos, { origenId = null, destinoId = null, monto, montoDestino, fecha, nota = "", nombre = "" } = {}) {
  migrarCuentasV1(datos);
  if (!cuentasActivas(datos)) return { ok: false, motivo: "modulo_apagado" };
  if ((origenId || null) === (destinoId || null)) return { ok: false, motivo: "misma_cuenta" };
  const o = origenId ? buscarCuenta(datos, origenId) : null, d = destinoId ? buscarCuenta(datos, destinoId) : null;
  if ((origenId && !o) || (destinoId && !d)) return { ok: false, motivo: "no_existe" };
  const valor = redondear(monto); if (!(valor > 0)) return { ok: false, motivo: "monto" }; if (valor > MAX_MONTO) return { ok: false, motivo: "monto_grande" };
  const f = fecha === undefined ? hoyIso() : fecha; if (!fechaValida(f)) return { ok: false, motivo: "fecha" };
  const monedaO = o ? o.moneda : monedaPrincipal(datos), monedaD = d ? d.moneda : monedaPrincipal(datos);
  let destinoMonto = null;
  if (monedaO !== monedaD) {
    destinoMonto = redondear(montoDestino);
    if (!(destinoMonto > 0)) return { ok: false, motivo: "monto_destino" };
    if (destinoMonto > MAX_MONTO) return { ok: false, motivo: "monto_grande" };
  }
  const movimiento = crearMovimiento({
    tipo: "traspaso", nombre: limpiar(nombre, 60) || "Traspaso", monto: valor, fechaRegistro: f, nota: limpiar(nota, 120) || null,
    cuentaId: origenId || null, cuentaDestinoId: destinoId || null, montoDestino: destinoMonto,
  });
  (datos.movimientos = datos.movimientos || []).push(movimiento);
  return { ok: true, movimiento };
}

/**
 * Resumen para la pantalla: por cada cuenta su saldo, lo gastado e ingresado en ella y, en las tarjetas con límite, cuánto queda por usar.
 * Más "Sin asignar" y un total por divisa. Con el módulo apagado devuelve null.
 */
function resumirCuentas(datos, hasta) {
  if (!cuentasActivas(datos)) return null;
  const t = calcularTotalesMovimientos(datos, hasta);
  const cuentas = listarCuentas(datos, { incluirArchivadas: true }).map((c) => {
    const x = (t.porCuenta && t.porCuenta[c.id]) || { saldo: 0, gastado: 0, ingresado: 0 };
    const saldo = c.afecta_saldo === false ? null : x.saldo;
    return {
      cuenta: c, saldo, gastado: x.gastado, ingresado: x.ingresado,
      restante: c.tipo === "credito" && c.limite != null && saldo !== null ? redondear(c.limite + saldo) : null,
    };
  });
  return { principal: monedaPrincipal(datos), cuentas, sinAsignar: t.sinAsignar, porMoneda: t.porMoneda, saldoLiquido: t.saldoLiquido };
}

/** Cuenta usada en el último gasto o ingreso que siga existiendo y no esté archivada (para proponerla por defecto al registrar). null si no hay. */
function ultimaCuentaUsada(datos) {
  if (!cuentasActivas(datos)) return null;
  const lista = (datos.movimientos || []).map((m, i) => ({ m, i })).filter(({ m }) => m.cuenta_id && (m.tipo === "gasto" || m.tipo === "ingreso"));
  if (!lista.length) return null;
  lista.sort((a, b) => String(a.m.fecha_registro || "").localeCompare(String(b.m.fecha_registro || "")) || a.i - b.i);
  for (let i = lista.length - 1; i >= 0; i--) { const c = buscarCuenta(datos, lista[i].m.cuenta_id); if (c && !c.archivada) return c.id; }
  return null;
}

/** ¿Se puede asignar esta cuenta a un movimiento nuevo? (existe, no está archivada y el módulo está encendido). */
const cuentaUsable = (datos, id) => !id || (cuentasActivas(datos) && !!buscarCuenta(datos, id) && !buscarCuenta(datos, id).archivada);

export {
  MAX_NOMBRE, TIPOS_CUENTA,
  activarCuentas, archivarCuenta, buscarCuenta, crearCuenta, crearTraspaso, cuentaUsable, editarCuenta, eliminarCuenta, listarCuentas,
  migrarCuentasV1, movimientosDeCuenta, resumirCuentas, ultimaCuentaUsada,
};
