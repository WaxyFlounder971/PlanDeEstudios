/* =========================================================================
   FINANZAS 2.0: pantallas de Cuentas (sesión 7B). Sin innerHTML.
   Pestaña "Cuentas" (un total por divisa, cada cuenta con su saldo, "Sin asignar"), cuenta nueva o editada, pasar dinero entre
   cuentas (incluye "Pagar tarjeta") y detalle de una cuenta. Toda la lógica vive en core/finanzas/finanzas-cuentas.js; aquí solo se pinta.
   Se carga solo con el módulo encendido (import dinámico desde finanzas.js).
   ========================================================================= */

import { estado } from "../core/storage/storage.js";
import { obtenerLocaleInterfaz, traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { hoyIso } from "../core/finanzas/finanzas-modelo.js";
import { MONEDAS_DISPONIBLES } from "../core/schema.js";
import { monedaPrincipal } from "../core/finanzas/finanzas-cuentas-base.js";
import { parsearMontoTexto as parsearMonto } from "../core/finanzas/finanzas-texto.js";
import { quitarMovimiento } from "../core/finanzas/finanzas-registro.js";
import {
  archivarCuenta, buscarCuenta, crearCuenta, crearTraspaso, editarCuenta, eliminarCuenta, listarCuentas, movimientosDeCuenta, resumirCuentas,
} from "../core/finanzas/finanzas-cuentas.js";
import { formatearFechaLarga, renderizarFinanzas } from "./finanzas.js";
import { abrirCapaNombrada, boton, campo, entrada, filaBotones, insignia, lineaError, mostrar, parrafo, selector } from "./finanzas-ui-basico.js";

const TIPOS = [["efectivo", "Efectivo"], ["banco", "Cuenta de banco o débito"], ["credito", "Tarjeta de crédito"], ["otra", "Otra"]];
const ICONO = { efectivo: "💵", banco: "🏦", credito: "💳", otra: "👛" };
const MOTIVOS = {
  nombre: "Escribe un nombre para la cuenta.", tipo: "Elige un tipo de cuenta.", moneda: "Elige una divisa.", monto_grande: "Ese monto es demasiado grande.",
  limite: "El límite debe ser un monto sin signo.", repetida: "Ya tienes una cuenta con ese nombre.", muchas: "Ya tienes muchas cuentas. Archiva o elimina alguna.",
  moneda_bloqueada: "La divisa no se puede cambiar si la cuenta ya tiene movimientos. Crea otra cuenta.", tiene_movimientos: "Tiene movimientos: archívala en lugar de eliminarla.",
  tiene_saldo: "Tiene un saldo inicial: ponlo en cero o archívala.", misma_cuenta: "Elige dos cuentas distintas.", monto: "Escribe un monto mayor que cero.",
  monto_destino: "Escribe cuánto llegó a la otra cuenta (la app no convierte).", fecha: "La fecha no es válida.", no_existe: "Esa cuenta ya no existe.", modulo_apagado: "Enciende Cuentas en Ajustes.",
};
const textoMotivo = (r) => t(MOTIVOS[r.motivo] || "No se pudo guardar.");
const refrescar = () => { renderizarFinanzas(); };
const guardado = () => { marcarCambioPendiente(); };

const monedaInfo = (id) => MONEDAS_DISPONIBLES.find((m) => m.id === id) || { id, simbolo: id, etiqueta: id };
/** Monto en la divisa de una cuenta (símbolo propio, mismo formato local). El "-" va antes del símbolo, como en el resto de Finanzas. */
function formatearEn(numero, monedaId) {
  const n = Number(numero) || 0;
  return (n < 0 ? "-" : "") + monedaInfo(monedaId).simbolo + Math.abs(n).toLocaleString(obtenerLocaleInterfaz(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const nombreCuenta = (c) => `${c.emoji || ICONO[c.tipo] || "👛"} ${c.nombre}`;

/* ===================== Pestaña ===================== */

function tarjetaCuenta(x, alCambiar) {
  const c = x.cuenta;
  const tarjeta = document.createElement("div"); tarjeta.className = "glass-card row-between"; tarjeta.style.cssText = "gap:10px; align-items:center; flex-wrap:nowrap;";
  const izq = document.createElement("div"); izq.style.minWidth = "0";
  const nombre = document.createElement("p"); nombre.style.cssText = "margin:0; font-weight:600; word-break:break-word;"; nombre.textContent = nombreCuenta(c); izq.appendChild(nombre);
  const detalle = [t(TIPOS.find(([v]) => v === c.tipo)[1]), c.moneda];
  if (c.afecta_saldo === false) detalle.push(t("No afecta mi saldo"));
  if (c.archivada) detalle.push(t("Archivada"));
  const d = document.createElement("p"); d.className = "muted"; d.style.cssText = "margin:2px 0 0; font-size:0.8rem;"; d.textContent = detalle.join(" · "); izq.appendChild(d);
  if (x.restante !== null) { const r = document.createElement("p"); r.className = "muted"; r.style.cssText = "margin:2px 0 0; font-size:0.8rem;"; r.textContent = `${t("Te quedan por usar")}: ${formatearEn(x.restante, c.moneda)}`; izq.appendChild(r); }
  const der = document.createElement("div"); der.className = "row"; der.style.cssText = "gap:8px; align-items:center; flex-shrink:0; flex-wrap:nowrap;";
  der.append(
    x.saldo === null ? insignia(`${t("Gastado")}: ${formatearEn(x.gastado, c.moneda)}`, "neutral") : insignia(formatearEn(x.saldo, c.moneda), x.saldo < 0 ? "warning" : "info"),
    boton(t("Abrir"), "btn btn-secondary", () => abrirDetalleCuenta(c.id, { alCambiar })),
  );
  tarjeta.append(izq, der);
  return tarjeta;
}

function renderizarPestanaCuentas(contenedor) {
  const alCambiar = () => { refrescar(); };
  const r = resumirCuentas(estado.datos); if (!r) return;
  const cab = document.createElement("div"); cab.className = "glass-card stack"; cab.style.gap = "6px";
  const h = document.createElement("strong"); h.textContent = t("Mi dinero por divisa"); cab.appendChild(h);
  const monedas = Object.keys(r.porMoneda).sort((a, b) => (a === r.principal ? -1 : b === r.principal ? 1 : a.localeCompare(b)));
  monedas.forEach((m) => {
    const f = document.createElement("div"); f.className = "row-between";
    const a = document.createElement("span"); a.textContent = `${monedaInfo(m).etiqueta ? t(monedaInfo(m).etiqueta) : m} (${m})`;
    const b = document.createElement("strong"); b.textContent = formatearEn(r.porMoneda[m].saldo, m); f.append(a, b); cab.appendChild(f);
  });
  cab.appendChild(parrafo("No se convierte entre divisas: cada una se suma sola. Los gastos, presupuestos y Disponible de la app son en tu divisa principal.", { tamano: "0.78rem" }));
  const hayTarjetaDeOtro = r.cuentas.some((x) => x.cuenta.afecta_saldo === false);
  if (hayTarjetaDeOtro) cab.appendChild(parrafo("Las cuentas que no afectan tu saldo cuentan en tus gastos, pero no restan de Mi dinero.", { tamano: "0.78rem" }));

  const acciones = filaBotones(
    boton("＋ " + t("Cuenta nueva"), "btn btn-primary", () => abrirCuentaNueva({ alGuardar: alCambiar })),
    boton(t("Pasar dinero"), "btn btn-secondary", () => abrirTraspaso({ alGuardar: alCambiar })),
  );
  contenedor.append(cab, acciones);

  const sin = document.createElement("div"); sin.className = "glass-card row-between"; sin.style.cssText = "gap:10px; align-items:center;";
  const txt = document.createElement("div"); txt.style.minWidth = "0";
  const sn = document.createElement("p"); sn.style.cssText = "margin:0; font-weight:600;"; sn.textContent = "📥 " + t("Sin asignar"); txt.appendChild(sn);
  txt.appendChild(parrafo("Lo que tenías y los movimientos sin cuenta. Reparte este dinero con Pasar dinero.", { tamano: "0.78rem" }));
  sin.append(txt, insignia(formatearEn(r.sinAsignar, r.principal), r.sinAsignar < 0 ? "warning" : "info"));
  contenedor.appendChild(sin);

  const activas = r.cuentas.filter((x) => !x.cuenta.archivada);
  if (!activas.length) contenedor.appendChild(parrafo("Aún no tienes cuentas. Crea una para separar dónde está tu dinero: efectivo, banco, una tarjeta…"));
  activas.forEach((x) => contenedor.appendChild(tarjetaCuenta(x, alCambiar)));
  const archivadas = r.cuentas.filter((x) => x.cuenta.archivada);
  if (archivadas.length) {
    const det = document.createElement("details"); det.className = "stack"; det.style.gap = "8px";
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = `${t("Archivadas")} (${archivadas.length})`; det.appendChild(sum);
    archivadas.forEach((x) => det.appendChild(tarjetaCuenta(x, alCambiar)));
    contenedor.appendChild(det);
  }
}

/* ===================== Cuenta nueva o editada ===================== */

function abrirCuentaNueva({ alGuardar, cuenta = null } = {}) {
  const editando = !!cuenta;
  const { caja, cerrar } = abrirCapaNombrada("finanzas-cuentas-editor-overlay", editando ? "Editar cuenta" : "Cuenta nueva", { ancho: 480, z: 320 });
  const nombre = entrada(editando ? cuenta.nombre : "", t("Ej. Efectivo, Visa, Banco"), 30);
  const tipo = selector(TIPOS, editando ? cuenta.tipo : "banco");
  const tieneMovs = editando && movimientosDeCuenta(estado.datos, cuenta.id).length > 0;
  const moneda = selector(MONEDAS_DISPONIBLES.map((m) => [m.id, `${m.simbolo} ${m.id} · ${m.etiqueta}`]), editando ? cuenta.moneda : monedaPrincipal(estado.datos));
  if (tieneMovs) moneda.disabled = true;
  const inicial = entrada(editando && cuenta.saldo_inicial ? String(cuenta.saldo_inicial) : "", "0", 0, "text"); inicial.inputMode = "decimal";
  const limite = entrada(editando && cuenta.limite != null ? String(cuenta.limite) : "", t("Opcional"), 0, "text"); limite.inputMode = "decimal";
  const emoji = entrada(editando ? cuenta.emoji || "" : "", "", 4);
  const afecta = document.createElement("input"); afecta.type = "checkbox"; afecta.checked = editando ? cuenta.afecta_saldo !== false : true;
  const filaAfecta = document.createElement("label"); filaAfecta.className = "row"; filaAfecta.style.cssText = "gap:8px; align-items:center;"; filaAfecta.append(afecta, document.createTextNode(t("Es mi dinero (afecta mi saldo)")));
  const ayudaAfecta = parrafo("Apágalo si la paga otra persona, por ejemplo la tarjeta de un familiar: sus gastos cuentan en tus gastos y categorías, pero no restan de Mi dinero.", { tamano: "0.78rem" });
  const campoInicial = campo("¿Cuánto hay ahora? (negativo si debes)", inicial, "Para repartir lo que ya tenías sin duplicarlo, déjalo en 0 y usa Pasar dinero desde Sin asignar.");
  const campoLimite = campo("Límite de la tarjeta", limite);
  const campoMoneda = campo("Divisa", moneda, tieneMovs ? "La divisa no se puede cambiar porque la cuenta ya tiene movimientos." : "");
  const error = lineaError();
  const pintar = () => {
    campoLimite.style.display = tipo.value === "credito" ? "" : "none";
    campoInicial.style.display = afecta.checked ? "" : "none";
  };
  tipo.addEventListener("change", pintar); afecta.addEventListener("change", pintar); pintar();
  const guardar = boton(t("Guardar"), "btn btn-primary", () => {
    const datosCuenta = { nombre: nombre.value, tipo: tipo.value, moneda: moneda.value, saldoInicial: parsearMonto(inicial.value) * (/^\s*[-−]/.test(inicial.value) ? -1 : 1), afectaSaldo: afecta.checked, limite: limite.value.trim() === "" ? null : parsearMonto(limite.value), emoji: emoji.value };
    const r = editando ? editarCuenta(estado.datos, cuenta.id, datosCuenta) : crearCuenta(estado.datos, datosCuenta);
    if (!r.ok) { mostrar(error, textoMotivo(r)); return; }
    guardado(); cerrar(); mostrarToast(t("Guardado")); (alGuardar || refrescar)();
  });
  caja.append(campo("Nombre", nombre), campo("Tipo", tipo), campoMoneda, campoInicial, campoLimite, campo("Emoji (opcional)", emoji), filaAfecta, ayudaAfecta, error, filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), guardar));
  nombre.focus();
}

/* ===================== Pasar dinero entre cuentas ===================== */

/** `origenId` / `destinoId` null = "Sin asignar". `monto` y `nombre` sirven para prellenar (por ejemplo, Pagar tarjeta). */
function abrirTraspaso({ alGuardar, origenId = null, destinoId = null, monto = "", nombre = "" } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-cuentas-traspaso-overlay", nombre ? "Pagar tarjeta" : "Pasar dinero", { ancho: 480, z: 320 });
  const cuentas = listarCuentas(estado.datos);
  const opciones = [["", `📥 ${t("Sin asignar")}`], ...cuentas.map((c) => [c.id, `${nombreCuenta(c)} (${c.moneda})`])];
  const de = selector(opciones, origenId || ""), a = selector(opciones, destinoId || "");
  const principal = monedaPrincipal(estado.datos);
  const monedaDe = (id) => { const c = id ? buscarCuenta(estado.datos, id) : null; return c ? c.moneda : principal; };
  const montoEl = entrada(monto ? String(monto) : "", "0", 0, "text"); montoEl.inputMode = "decimal";
  const llega = entrada("", "0", 0, "text"); llega.inputMode = "decimal";
  const campoLlega = campo("", llega);
  const etiquetaMonto = campo("Monto", montoEl);
  const fecha = entrada(hoyIso(), "", 0, "date"); const nota = entrada("", t("Opcional"), 120);
  const ayuda = parrafo("Pasar dinero entre tus cuentas no es un gasto ni un ingreso.", { tamano: "0.78rem" });
  const error = lineaError();
  const pintar = () => {
    const distinta = monedaDe(de.value) !== monedaDe(a.value);
    campoLlega.style.display = distinta ? "" : "none";
    campoLlega.querySelector(".form-label").textContent = `${t("Cuánto llegó")} (${monedaDe(a.value)})`;
    etiquetaMonto.querySelector(".form-label").textContent = `${t("Monto")} (${monedaDe(de.value)})`;
  };
  de.addEventListener("change", pintar); a.addEventListener("change", pintar); pintar();
  const guardar = boton(t("Guardar"), "btn btn-primary", () => {
    const r = crearTraspaso(estado.datos, { origenId: de.value || null, destinoId: a.value || null, monto: parsearMonto(montoEl.value), montoDestino: parsearMonto(llega.value), fecha: fecha.value, nota: nota.value, nombre });
    if (!r.ok) { mostrar(error, textoMotivo(r)); return; }
    guardado(); cerrar(); mostrarToast(t("Guardado")); (alGuardar || refrescar)();
  });
  caja.append(campo("De", de), campo("Para", a), etiquetaMonto, campoLlega, campo("Fecha", fecha), campo("Nota", nota), ayuda, error, filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), guardar));
  montoEl.focus();
}

/* ===================== Detalle de una cuenta ===================== */

function abrirDetalleCuenta(id, { alCambiar } = {}) {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-cuentas-detalle-overlay", "Cuenta", { ancho: 520, z: 310 });
  const titulo = caja.querySelector("h2"); const cuerpo = document.createElement("div"); cuerpo.className = "stack"; cuerpo.style.gap = "10px"; caja.appendChild(cuerpo);
  let confirmando = null;
  const cambio = () => { guardado(); if (alCambiar) alCambiar(); pintar(); };
  const nombreDe = (cid) => { if (!cid) return t("Sin asignar"); const c = buscarCuenta(estado.datos, cid); return c ? c.nombre : t("cuenta eliminada"); };

  function pintar() {
    cuerpo.replaceChildren();
    const c = buscarCuenta(estado.datos, id); if (!c) { cerrar(); return; }
    const r = resumirCuentas(estado.datos); const x = r && r.cuentas.find((y) => y.cuenta.id === id); if (!x) { cerrar(); return; }
    titulo.textContent = nombreCuenta(c);
    const g = document.createElement("div"); g.className = "glass-card stack"; g.style.gap = "4px";
    const linea = (txt, val, fuerte) => { const f = document.createElement("div"); f.className = "row-between"; const a = document.createElement("span"); a.textContent = t(txt); const b = document.createElement(fuerte ? "strong" : "span"); b.textContent = formatearEn(val, c.moneda); f.append(a, b); return f; };
    if (x.saldo !== null) g.appendChild(linea(c.tipo === "credito" && x.saldo < 0 ? "Debes" : "Saldo", c.tipo === "credito" ? Math.abs(x.saldo) : x.saldo, true));
    else g.appendChild(parrafo("Esta cuenta no afecta tu saldo: sus gastos cuentan en tus gastos pero no restan de Mi dinero.", { tamano: "0.8rem" }));
    if (x.restante !== null) g.appendChild(linea("Te quedan por usar", x.restante));
    g.append(linea("Gastado aquí", x.gastado), linea("Ingresado aquí", x.ingresado));
    cuerpo.appendChild(g);

    const acciones = [];
    if (c.tipo === "credito" && x.saldo !== null && x.saldo < 0) {
      acciones.push(boton(t("Pagar tarjeta"), "btn btn-primary", () => abrirTraspaso({ destinoId: id, monto: Math.abs(x.saldo), nombre: t("Pago de tarjeta"), alGuardar: cambio })));
    }
    acciones.push(boton(t("Pasar dinero"), acciones.length ? "btn btn-secondary" : "btn btn-primary", () => abrirTraspaso({ origenId: id, alGuardar: cambio })));
    acciones.push(boton(t("Editar"), "btn btn-secondary", () => abrirCuentaNueva({ cuenta: c, alGuardar: cambio })));
    cuerpo.appendChild(filaBotones(...acciones.slice(0, 2)));
    if (acciones.length > 2) cuerpo.appendChild(filaBotones(acciones[2]));

    const h = document.createElement("h3"); h.style.cssText = "margin:4px 0 0; font-size:1rem;"; h.textContent = t("Movimientos"); cuerpo.appendChild(h);
    const movs = movimientosDeCuenta(estado.datos, id).slice(0, 40);
    if (!movs.length) cuerpo.appendChild(parrafo("Aún no hay movimientos en esta cuenta."));
    movs.forEach((m) => {
      const f = document.createElement("div"); f.className = "row-between"; f.style.cssText = "gap:8px; align-items:center;";
      const info = document.createElement("div"); info.style.minWidth = "0";
      const esTraspaso = m.tipo === "traspaso"; const sale = esTraspaso ? m.cuenta_id === id : m.tipo === "gasto" || (m.tipo === "ajuste" && m.sentido === "resta");
      const monto = esTraspaso && !sale && m.monto_destino ? m.monto_destino : m.monto;
      const a = document.createElement("div"); a.style.wordBreak = "break-word";
      a.textContent = `${sale ? "−" : "+"}${formatearEn(monto, c.moneda)} · ${m.nombre || t("Sin nombre")} · ${m.fecha_registro ? formatearFechaLarga(m.fecha_registro) : t("Sin fecha")}`;
      info.appendChild(a);
      if (esTraspaso) { const b = document.createElement("div"); b.className = "muted"; b.style.fontSize = "0.78rem"; b.textContent = `${nombreDe(m.cuenta_id)} → ${nombreDe(m.cuenta_destino_id)}`; info.appendChild(b); }
      const q = boton(confirmando === m.id ? t("Confirmar: quitar") : t("Quitar"), "btn btn-secondary", () => {
        if (confirmando !== m.id) { confirmando = m.id; pintar(); return; }
        confirmando = null; if (quitarMovimiento(estado.datos, m.id)) cambio(); else pintar();
      });
      f.append(info, q); cuerpo.appendChild(f);
    });

    const det = document.createElement("details"); det.className = "stack"; det.style.gap = "8px";
    const sum = document.createElement("summary"); sum.className = "muted"; sum.textContent = t("Más opciones"); det.appendChild(sum);
    const error = lineaError();
    const archivar = boton(t(c.archivada ? "Sacar de archivadas" : "Archivar"), "btn btn-secondary", () => { const rr = archivarCuenta(estado.datos, id, !c.archivada); if (!rr.ok) { mostrar(error, textoMotivo(rr)); return; } cambio(); });
    const eliminar = boton(confirmando === "eliminar" ? t("Confirmar: eliminar") : t("Eliminar"), "btn btn-secondary", () => {
      if (confirmando !== "eliminar") { confirmando = "eliminar"; pintar(); const d2 = cuerpo.querySelector("details"); if (d2) d2.open = true; return; }
      const rr = eliminarCuenta(estado.datos, id); confirmando = null;
      if (!rr.ok) { pintar(); const d2 = cuerpo.querySelector("details"); if (d2) { d2.open = true; mostrar(d2.querySelector("[role=alert]"), textoMotivo(rr)); } return; }
      guardado(); cerrar(); if (alCambiar) alCambiar();
    });
    det.append(filaBotones(archivar, eliminar), error, parrafo("Archivar la oculta de las listas, pero su dinero sigue contando. Eliminar solo se puede sin movimientos y sin saldo inicial.", { tamano: "0.78rem" }));
    cuerpo.append(det, filaBotones(boton(t("Cerrar"), "btn btn-secondary", cerrar)));
  }
  pintar();
}

export { abrirCuentaNueva, abrirDetalleCuenta, abrirTraspaso, formatearEn, renderizarPestanaCuentas };
