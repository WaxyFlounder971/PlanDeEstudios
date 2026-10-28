/* =========================================================================
   FINANZAS 2.0: Inicio (sesión 3, F2)
   Pantalla de la cifra Disponible, la lista Próximos, el desglose que se
   abre al tocar la cifra y el modo privacidad. Todo se DERIVA de
   core/finanzas/finanzas-disponible.js: aquí no se calcula ni se guarda ninguna
   cifra. El estado siempre lleva texto además del color. Sin innerHTML.
   ========================================================================= */

import { calcularDisponible, fijarHorizonteDias, OPCIONES_HORIZONTE } from "../core/finanzas/finanzas-disponible.js";
import { obtenerModulosFinanzas } from "../core/finanzas/finanzas-derivados.js";
import { pestanasVisiblesFinanzas } from "../core/finanzas/finanzas-perfiles.js";
import { posponerRecordatorio, recordatoriosDeMetas } from "../core/finanzas/finanzas-recordatorios.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { formatearFechaLarga, formatearMonto, renderizarFinanzas } from "./finanzas.js";
import { abrirCapa, crearBoton } from "./finanzas-registro-rapido.js";

const CLAVE_PRIVACIDAD = "finanzas_privacidad_v1";
const OCULTO = "••••";
const FILAS_INICIALES = 3;

/* ===================== Modo privacidad (por dispositivo, no se sincroniza) ===================== */

/** Lee la preferencia una sola vez por sesión. Si el almacenamiento falla, queda apagada. */
function privacidadActiva() {
  if (typeof estado.finanzasPrivacidad === "undefined") {
    let guardada = false;
    try { guardada = window.localStorage.getItem(CLAVE_PRIVACIDAD) === "1"; } catch (e) { guardada = false; }
    estado.finanzasPrivacidad = guardada;
  }
  return !!estado.finanzasPrivacidad;
}

function fijarPrivacidad(valor) {
  estado.finanzasPrivacidad = !!valor;
  try { window.localStorage.setItem(CLAVE_PRIVACIDAD, valor ? "1" : "0"); } catch (e) { /* sin almacenamiento: vale solo esta sesión */ }
}

/** Monto para pantalla: oculta con el modo privacidad. `conSigno` antepone + o − según el sentido. */
function montoVisible(n, conSigno = "") {
  if (privacidadActiva()) return OCULTO;
  // Sin signo explícito, formatearMonto pone el "-" de los negativos (igual que en el resto de Finanzas).
  return conSigno ? conSigno + formatearMonto(Math.abs(Number(n) || 0)) : formatearMonto(n);
}

function construirBarraPrivacidad() {
  const barra = document.createElement("div");
  barra.className = "row";
  barra.style.cssText = "justify-content:flex-end;";
  const activa = privacidadActiva();
  const boton = crearBoton(
    (activa ? "👁 " : "🙈 ") + t(activa ? "Mostrar importes" : "Ocultar importes"),
    "btn-discreto",
    () => { fijarPrivacidad(!privacidadActiva()); renderizarFinanzas(); },
  );
  boton.style.fontSize = "0.85rem";
  boton.setAttribute("aria-pressed", activa ? "true" : "false");
  barra.appendChild(boton);
  return barra;
}

/* ===================== Piezas pequeñas ===================== */

const GLIFO_NIVEL = { verde: "✓", ambar: "!", rojo: "▲" };

function crearChipSemaforo(semaforo) {
  const chip = document.createElement("span");
  chip.className = "disponible-chip";
  chip.dataset.nivel = semaforo.nivel;
  chip.textContent = `${GLIFO_NIVEL[semaforo.nivel]} ${t(semaforo.texto)}`;
  return chip;
}

function linea(texto, clase = "muted") {
  const p = document.createElement("p");
  p.className = clase;
  p.style.margin = "0";
  p.textContent = texto;
  return p;
}

/** Texto de "te alcanza hasta…" al ritmo actual; null si no hay base honesta. */
function textoAlcance(calculo) {
  if (!calculo.alcance) return null;
  if (calculo.alcance.masDeUnAnio) return t("Al ritmo de los últimos días, te alcanza por más de un año.");
  const { dias, hasta } = calculo.alcance;
  if (dias === 0) return t("Al ritmo de los últimos días, hoy es el día que más te queda.");
  return `${t("Al ritmo de los últimos días, te alcanza hasta el")} ${formatearFechaLarga(hasta)} (${dias} ${t(dias === 1 ? "día" : "días")}).`;
}

/** Una fila de Próximos o del desglose: fecha, nombre con etiqueta y monto con signo y palabra. */
function construirFilaProximo(p) {
  const fila = document.createElement("div");
  fila.className = "proximo-fila";

  const izquierda = document.createElement("div");
  izquierda.className = "proximo-info";
  const nombre = document.createElement("div");
  nombre.className = "proximo-nombre";
  nombre.textContent = p.nombre;
  const detalle = document.createElement("div");
  detalle.className = "muted proximo-detalle";
  detalle.textContent = `${formatearFechaLarga(p.fecha)} · ${t(p.etiqueta)}`;
  izquierda.append(nombre, detalle);

  if (p.vencido) {
    const badge = document.createElement("span");
    badge.className = "badge badge-warning";
    badge.textContent = t("Vencido");
    izquierda.appendChild(badge);
  }
  if (!p.cuenta && !p.vencido) {
    const nota = document.createElement("div");
    nota.className = "muted proximo-detalle";
    nota.textContent = t("No cuenta en Disponible");
    izquierda.appendChild(nota);
  }

  const derecha = document.createElement("div");
  derecha.className = "proximo-monto" + (p.sentido === "sale" ? " sale" : " entra");
  derecha.textContent = `${t(p.sentido === "sale" ? "Sale" : "Entra")} ${montoVisible(p.monto, p.sentido === "sale" ? "-" : "+")}`;

  fila.append(izquierda, derecha);
  return fila;
}

/* ===================== Desglose ===================== */

function abrirDesgloseDisponible(calculo) {
  const { caja, cerrar } = abrirCapa("Cómo se calcula Disponible");
  caja.appendChild(linea(`${t("Mi dinero, menos lo que ya viene, más lo que se espera recibir, hasta el")} ${formatearFechaLarga(calculo.hasta)}.`));

  const lista = document.createElement("div");
  lista.className = "stack";
  calculo.terminos
    .filter((x) => x.id === "saldo" || x.monto !== 0 || x.filas.length)
    .forEach((x) => {
      const signo = x.id === "saldo" ? "" : x.monto < 0 ? "-" : "+";
      const bloque = document.createElement(x.filas.length ? "details" : "div");
      bloque.className = "desglose-termino";
      const cabecera = document.createElement(x.filas.length ? "summary" : "div");
      cabecera.className = "row-between desglose-cabecera";
      const nombre = document.createElement("span");
      nombre.textContent = t(x.etiqueta);
      const valor = document.createElement("strong");
      valor.className = x.monto < 0 ? "negativo" : "";
      valor.textContent = montoVisible(x.monto, signo);
      cabecera.append(nombre, valor);
      bloque.appendChild(cabecera);
      x.filas.forEach((f) => bloque.appendChild(construirFilaProximo(f)));
      lista.appendChild(bloque);
    });
  if (calculo.terminos.length && !calculo.terminos.some((x) => x.id !== "saldo" && (x.monto !== 0 || x.filas.length))) {
    lista.appendChild(linea(t("No hay pagos ni ingresos planificados en este plazo.")));
  }
  caja.appendChild(lista);

  const total = document.createElement("div");
  total.className = "row-between desglose-total";
  const etiquetaTotal = document.createElement("span");
  etiquetaTotal.textContent = "= " + t("Disponible");
  const cifra = document.createElement("strong");
  cifra.className = calculo.disponible < 0 ? "negativo" : "";
  cifra.textContent = montoVisible(calculo.disponible);
  total.append(etiquetaTotal, cifra);
  caja.appendChild(total);

  if (calculo.informativos.length) {
    const aparte = document.createElement("details");
    const resumen = document.createElement("summary");
    resumen.className = "muted";
    resumen.textContent = `${t("Se muestran pero no cuentan")} (${calculo.informativos.length})`;
    aparte.appendChild(resumen);
    calculo.informativos.forEach((f) => aparte.appendChild(construirFilaProximo(f)));
    caja.appendChild(aparte);
  }
  if (calculo.sinFecha > 0) {
    caja.appendChild(linea(`${calculo.sinFecha} ${t(calculo.sinFecha === 1 ? "pago sin fecha no entra en el cálculo." : "pagos sin fecha no entran en el cálculo.")}`));
  }
  if (calculo.ritmo) {
    caja.appendChild(linea(`${t("Ritmo de gasto")}: ${montoVisible(calculo.ritmo.diario)} ${t("por día")}, ${t("según tus gastos anotados en los últimos")} ${calculo.ritmo.ventana} ${t("días (sin recurrentes ni matrícula).")}`));
  }

  // Horizonte: los plazos fijos de la lista; se guarda por cuenta.
  const campo = document.createElement("div");
  campo.className = "stack";
  campo.appendChild(linea(t("¿Hasta cuándo mirar adelante?")));
  const grupo = document.createElement("div");
  grupo.className = "row";
  grupo.style.cssText = "flex-wrap:wrap; gap:6px;";
  OPCIONES_HORIZONTE.forEach((n) => {
    const b = crearBoton(`${n} ${t("días")}`, "pill-item" + (n === calculo.horizonte ? " active" : ""), () => {
      if (fijarHorizonteDias(estado.datos, n)) { marcarCambioPendiente(); cerrar(); renderizarFinanzas(); }
    });
    b.style.cssText = "flex:0 0 auto; padding:8px 14px;";
    b.setAttribute("aria-pressed", n === calculo.horizonte ? "true" : "false");
    grupo.appendChild(b);
  });
  campo.appendChild(grupo);
  caja.appendChild(campo);

  caja.appendChild(crearBoton(t("Cerrar"), "btn btn-secondary", cerrar));
}

/* ===================== Tarjetas ===================== */

function construirTarjetaDisponible(calculo) {
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card stack disponible-hero";
  tarjeta.dataset.nivel = calculo.semaforo.nivel;

  const etiqueta = document.createElement("div");
  etiqueta.className = "resumen-hero-etiqueta";
  etiqueta.textContent = `${t("Disponible")} · ${t("próximos")} ${calculo.horizonte} ${t("días")}`;

  const cifra = document.createElement("button");
  cifra.type = "button";
  cifra.className = "disponible-cifra resumen-hero-cifra" + (calculo.disponible < 0 ? " negativo" : "");
  cifra.style.cssText = "background:none; border:0; color:inherit; cursor:pointer; font:inherit; padding:0;";
  cifra.textContent = montoVisible(calculo.disponible);
  cifra.setAttribute("aria-label", `${t("Disponible")}: ${montoVisible(calculo.disponible)}. ${t("Ver cómo se calcula")}`);
  cifra.addEventListener("click", () => abrirDesgloseDisponible(calculo));

  tarjeta.append(etiqueta, cifra, crearChipSemaforo(calculo.semaforo), linea(t(calculo.semaforo.ayuda)));

  const alcance = textoAlcance(calculo);
  if (alcance) tarjeta.appendChild(linea(alcance));
  if (!calculo.proximos.length) tarjeta.appendChild(linea(`${t("No hay pagos ni ingresos planificados en los próximos")} ${calculo.horizonte} ${t("días.")}`));

  const ver = crearBoton(t("Ver cómo se calcula"), "btn-discreto", () => abrirDesgloseDisponible(calculo));
  ver.style.cssText = "align-self:center; font-size:0.85rem;";
  tarjeta.appendChild(ver);
  return tarjeta;
}

function construirTarjetaProximos(calculo) {
  if (!calculo.proximos.length) return null;
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card stack";
  const h = document.createElement("h3");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = t("Próximos");
  const lista = document.createElement("div");
  lista.className = "stack";
  const pintar = (todos) => {
    lista.replaceChildren(...(todos ? calculo.proximos : calculo.proximos.slice(0, FILAS_INICIALES)).map(construirFilaProximo));
  };
  pintar(false);
  tarjeta.append(h, lista);

  if (calculo.proximos.length > FILAS_INICIALES) {
    let abierto = false;
    const alternar = crearBoton("", "btn-discreto", () => {
      abierto = !abierto; pintar(abierto);
      alternar.textContent = abierto ? t("Ver menos") : `${t("Ver todos")} (${calculo.proximos.length})`;
      alternar.setAttribute("aria-expanded", abierto ? "true" : "false");
    });
    alternar.textContent = `${t("Ver todos")} (${calculo.proximos.length})`;
    alternar.setAttribute("aria-expanded", "false");
    alternar.style.cssText = "align-self:center; font-size:0.85rem;";
    tarjeta.appendChild(alternar);
  }

  const hayPlan = calculo.proximos.some((p) => p.fuente === "compromiso") && pestanasVisiblesFinanzas(obtenerModulosFinanzas(estado.datos)).includes("plan");
  if (hayPlan) {
    const irPlan = crearBoton(t("Ir al Plan"), "btn-discreto", () => { estado.finanzasVistaActiva = "plan"; renderizarFinanzas(); });
    irPlan.style.cssText = "align-self:center; font-size:0.85rem;";
    tarjeta.appendChild(irPlan);
  }
  return tarjeta;
}

/**
 * Recordatorios de aporte a metas (sesión 8): uno por meta, solo dentro de la app. Se quedan hasta que aportes
 * o digas "Ahora no". Tono sin culpa: avisan y proponen. Nada mueve dinero: "Aportar" abre el formulario ya lleno.
 */
function construirTarjetaRecordatorios() {
  const lista = recordatoriosDeMetas(estado.datos);
  if (!lista.length) return null;
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card stack";
  tarjeta.setAttribute("data-recordatorios", "1");
  const h = document.createElement("h3");
  h.className = "texto-encabezado-seccion"; h.style.margin = "0";
  h.textContent = t("Te toca aportar");
  tarjeta.appendChild(h);
  lista.forEach((r) => {
    const fila = document.createElement("div");
    fila.className = "stack"; fila.style.gap = "6px";
    const texto = document.createElement("p");
    texto.style.margin = "0";
    texto.textContent = t("{meta}: aporte sugerido de {monto} (te tocaba el {fecha})")
      .replace("{meta}", `${r.emoji} ${r.nombre}`).replace("{monto}", montoVisible(r.monto)).replace("{fecha}", formatearFechaLarga(r.fecha));
    const botones = document.createElement("div");
    botones.className = "row"; botones.style.cssText = "gap:8px; flex-wrap:wrap;";
    botones.append(
      crearBoton(t("Aportar"), "btn btn-primary", () => {
        import("./finanzas-movimiento-modal.js").then((m) => m.abrirModalMovimiento({ tipoInicial: "ahorro", prefill: { monto: r.monto, metaId: r.metaId }, alGuardar: renderizarFinanzas })).catch(() => {});
      }),
      crearBoton(t("Ahora no"), "btn btn-secondary", () => {
        if (posponerRecordatorio(estado.datos, r.metaId, r.fecha)) { marcarCambioPendiente(); renderizarFinanzas(); }
      }),
    );
    fila.append(texto, botones);
    tarjeta.appendChild(fila);
  });
  return tarjeta;
}

/**
 * Bloques que abren el Inicio: [barra de privacidad, Disponible, Próximos]. Disponible solo existe con
 * "Mi dinero" (Gastos, Matrícula o Beca encendidos); sin él, solo queda la barra de privacidad.
 */
function construirBloquesInicio() {
  const bloques = [construirBarraPrivacidad()];
  const calculo = calcularDisponible(estado.datos);
  const recordatorios = construirTarjetaRecordatorios();
  if (!calculo.aplica) { if (recordatorios) bloques.push(recordatorios); return bloques; }
  bloques.push(construirTarjetaDisponible(calculo));
  const proximos = construirTarjetaProximos(calculo);
  if (proximos) bloques.push(proximos);
  if (recordatorios) bloques.push(recordatorios);
  return bloques;
}

/** ¿Hay algo planificado dentro del horizonte? (el Inicio no se muestra vacío si lo hay). */
function hayProximos() {
  const calculo = calcularDisponible(estado.datos);
  return calculo.aplica && calculo.proximos.length > 0;
}

export { abrirDesgloseDisponible, construirBloquesInicio, hayProximos, construirFilaProximo, fijarPrivacidad, montoVisible, privacidadActiva };
