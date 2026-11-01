/* =========================================================================
   FINANZAS 2.0 — Pestaña Movimientos (etapa 0B)
   Lee SIEMPRE de `estado.datos.movimientos` (el modelo único), con las
   mismas reglas de visibilidad que los totales (módulos apagados ocultan,
   semestre borrado no cuenta). Dos vistas: "Por tipo" y "Cronológico".
   Los movimientos sin fecha (datos migrados que nunca la tuvieron) van
   siempre al final, marcados "Sin fecha".
   Reemplaza a renderizarPestanaGastosU de finanzas-gastos.js.
   ========================================================================= */

import { hoyIso, montoEfectivoMovimiento } from "../core/finanzas/finanzas-modelo.js";
import { movimientoVisible, obtenerModulosFinanzas } from "../core/finanzas/finanzas-derivados.js";
import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, construirPillSwitchBinario, mostrarToast } from "../ui/componentes.js";
import { quitarMovimiento } from "../core/finanzas/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { sellarTimestamp } from "../core/schema.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { abrirModalMovimiento, nombreMostradoMovimiento } from "./finanzas-movimiento-modal.js";
import { formatearFrecuenciaRecurrente } from "./finanzas-recurrencia.js";
import { abrirRegistroRapido } from "./finanzas-registro-rapido.js";

const SECCIONES_POR_TIPO = [
  { tipo: "gasto", titulo: "Gastos", icono: "🧾", conSubtotal: true },
  { tipo: "ingreso", titulo: "Ingresos", icono: "💵", conSubtotal: true },
  { tipo: "ahorro", titulo: "Ahorros", icono: "🎯", conSubtotal: true },
  { tipo: "transferencia", titulo: "Transferencias", icono: "🔁", conSubtotal: false },
  { tipo: "ajuste", titulo: "Ajustes de saldo", icono: "⚖️", conSubtotal: false },
  { tipo: "prestamo", titulo: "Préstamos", icono: "🤝", conSubtotal: false },
  { tipo: "traspaso", titulo: "Traspasos entre cuentas", icono: "⇄", conSubtotal: false },
];

const AZUL_INGRESO = "background:rgba(59,130,246,0.16); border-color:rgba(59,130,246,0.45); color:#3b82f6;";

function inicializarVistaMovimientos() {
  if (typeof estado.finanzasVistaMovimientos === "undefined") estado.finanzasVistaMovimientos = "tipo";
}

/** Movimientos que la persona debe ver: módulo encendido y semestre vigente. */
function obtenerMovimientosVisibles() {
  const modulos = obtenerModulosFinanzas(estado.datos);
  const semestres = new Set((estado.datos.semestres || []).map((s) => s.id));
  return (estado.datos.movimientos || []).filter(
    (m) => movimientoVisible(m, modulos) && (!m.semestre_id || semestres.has(m.semestre_id))
  );
}

/** Más reciente primero; sin fecha al final. */
function ordenarPorFecha(lista) {
  return lista.slice().sort((a, b) => {
    const fa = a.fecha_registro || "";
    const fb = b.fecha_registro || "";
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return fb.localeCompare(fa);
  });
}

function obtenerMeta(id) {
  return (estado.datos.metas || []).find((m) => m.id === id) || null;
}

function nombreMeta(id) {
  const meta = obtenerMeta(id);
  return meta ? `${meta.emoji || "🎯"} ${meta.nombre}` : t("Meta eliminada");
}

/** Etiqueta de tipo (texto, no solo color: accesible para daltonismo) + estilo del badge de monto. */
function describirTipo(m) {
  if (m.tipo === "gasto") {
    return m.origen === "matricula"
      ? { etiqueta: "Matrícula", signo: "−", clase: "badge-danger", estilo: "" }
      : { etiqueta: "Gasto", signo: "−", clase: "badge-danger", estilo: "" };
  }
  if (m.tipo === "ingreso") {
    return m.origen === "beca"
      ? { etiqueta: "Beca", signo: "+", clase: "badge-success", estilo: "" }
      : { etiqueta: "Ingreso", signo: "+", clase: "badge-neutral", estilo: AZUL_INGRESO };
  }
  if (m.tipo === "ahorro") return { etiqueta: "Ahorro", signo: "↗ ", clase: "badge-warning", estilo: "" };
  if (m.tipo === "traspaso") return { etiqueta: "Traspaso", signo: "⇄ ", clase: "badge-neutral", estilo: "" };
  if (m.tipo === "prestamo") return { etiqueta: m.sentido === "entra" ? "Préstamo: entra" : "Préstamo: sale", signo: m.sentido === "entra" ? "+" : "−", clase: "badge-neutral", estilo: "" };
  if (m.tipo === "ajuste") return { etiqueta: "Ajuste de saldo", signo: m.sentido === "resta" ? "−" : "+", clase: "badge-neutral", estilo: "" };
  return { etiqueta: "Transferencia", signo: m.sentido === "desde_meta" ? "← " : "→ ", clase: "badge-neutral", estilo: "" };
}

function nombreCuentaMov(id) {
  if (!id) return t("Sin asignar");
  const c = (estado.datos.cuentas || []).find((x) => x.id === id);
  return c ? c.nombre : t("cuenta eliminada");
}

function nombrePrestamo(id) {
  const p = (estado.datos.prestamos || []).find((x) => x.id === id);
  return p ? p.persona : t("persona eliminada");
}

function nombreSemestre(id) {
  const s = obtenerTodosLosSemestres().find((x) => x.id === id);
  return s ? t(s.nombre) : t("semestre eliminado");
}

function lineaDetalle(texto) {
  const p = document.createElement("p");
  p.className = "muted";
  p.style.cssText = "margin:2px 0 0; word-break:break-word;";
  p.textContent = texto;
  return p;
}

function construirFilaMovimiento(m, refrescar) {
  const info = describirTipo(m);
  const fila = document.createElement("div");
  fila.className = "glass-card row-between";
  fila.style.cssText = "flex-wrap:nowrap; gap:10px;";

  // ----- Izquierda: nombre + detalles (todo con textContent: nada de HTML de usuario) -----
  const izq = document.createElement("div");
  izq.style.cssText = "min-width:0;";
  const nombre = document.createElement("p");
  nombre.style.cssText = "margin:0; font-weight:600; word-break:break-word;";
  nombre.textContent = nombreMostradoMovimiento(m);
  izq.appendChild(nombre);

  const partes = [t(info.etiqueta)];
  if (m.recurrente) {
    partes.push(`🔁 ${formatearFrecuenciaRecurrente(m.recurrente)} · ${formatearMonto(m.recurrente.monto_por_pago)} ${t("c/u")}`);
    partes.push(`${t("desde")} ${formatearFechaLarga(m.recurrente.fecha_inicio)}${m.recurrente.fecha_fin ? ` ${t("hasta")} ${formatearFechaLarga(m.recurrente.fecha_fin)}` : ""}`);
  } else {
    partes.push(m.fecha_registro ? formatearFechaLarga(m.fecha_registro) : t("Sin fecha"));
  }
  izq.appendChild(lineaDetalle(partes.join(" · ")));

  const extras = [];
  if (m.tipo === "ahorro" || m.tipo === "transferencia") extras.push(nombreMeta(m.meta_id));
  if (m.tipo === "ahorro") extras.push(t(m.fuente === "nuevo" ? "Dinero nuevo" : "De mi dinero"));
  if (m.tipo === "gasto" && m.pagado_con_meta_id) extras.push(`${t("Pagado con")} ${nombreMeta(m.pagado_con_meta_id)}`);
  if (m.categoria_id && (m.tipo === "gasto" || m.tipo === "ingreso")) {
    const cat = (estado.datos.categorias_finanzas || []).find((c) => c.id === m.categoria_id);
    if (cat) extras.push(`${cat.emoji || "🏷️"} ${cat.nombre}`);
  }
  if (m.cuenta_id) extras.push(`🏦 ${nombreCuentaMov(m.cuenta_id)}${m.tipo === "traspaso" ? ` → ${nombreCuentaMov(m.cuenta_destino_id)}` : ""}`);
  else if (m.tipo === "traspaso") extras.push(`🏦 ${t("Sin asignar")} → ${nombreCuentaMov(m.cuenta_destino_id)}`);
  if (m.tipo === "gasto" && m.pagado_por_prestamo_id) extras.push(`${t("Lo pagó")} ${nombrePrestamo(m.pagado_por_prestamo_id)}`);
  if (m.semestre_id && m.origen === "manual") extras.push(`📚 ${nombreSemestre(m.semestre_id)}`);
  if (!m.recurrente && m.fecha_registro && m.fecha_registro > hoyIso()) extras.push(t("Aún no cuenta"));
  if (extras.length) izq.appendChild(lineaDetalle(extras.join(" · ")));
  if (m.nota) izq.appendChild(lineaDetalle(m.nota));
  fila.appendChild(izq);

  // ----- Derecha: monto + Editar -----
  const der = document.createElement("div");
  der.className = "row";
  der.style.cssText = "flex-wrap:nowrap; flex-shrink:0; gap:clamp(6px,2vw,10px); align-items:center;";
  const badge = document.createElement("span");
  badge.className = `badge ${info.clase} badge-monto-movimiento`;
  badge.style.cssText =
    "white-space:nowrap; text-align:center; font-size:clamp(0.72rem,2.6vw,0.85rem); padding:clamp(3px,1vw,6px) clamp(6px,2vw,10px);" + info.estilo;
  badge.textContent = info.signo + formatearMonto(montoEfectivoMovimiento(m)) + (m.recurrente ? ` ${t("a la fecha")}` : "");
  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn btn-secondary";
  btnEditar.style.cssText = "white-space:nowrap; flex-shrink:0; font-size:clamp(0.72rem,2.6vw,0.9rem); padding:clamp(4px,1.4vw,8px) clamp(8px,2.5vw,14px);";
  if (m.tipo === "prestamo" || m.tipo === "traspaso" || (m.tipo === "gasto" && m.pagado_por_prestamo_id)) {
    // Lo de Me deben y debo no se edita desde aquí (su saldo depende de él): se quita y se vuelve a registrar.
    btnEditar.textContent = t("Quitar");
    btnEditar.addEventListener("click", () => abrirConfirmacion({
      titulo: t("¿Quitar este movimiento?"),
      mensaje: t("Cambia saldos de cuentas, lo que te deben o debes y Mi dinero. Para corregirlo, quítalo y vuelve a registrarlo."),
      textoConfirmar: t("Quitar"),
      claseConfirmar: "btn-danger",
      onConfirmar: () => {
        if (quitarMovimiento(estado.datos, m.id)) marcarCambioPendiente();
        mostrarToast(t("Movimiento quitado"));
        refrescar();
      },
    }));
  } else if (m.tipo === "ajuste") {
    // Un ajuste no se edita (se corrige con otro "Ajustar saldo"); se puede quitar.
    btnEditar.textContent = t("Quitar");
    btnEditar.addEventListener("click", () => abrirConfirmacion({
      titulo: t("¿Quitar este ajuste?"),
      mensaje: t("Mi dinero vuelve a como estaba antes del ajuste. Esto no afecta tus gastos ni ingresos."),
      textoConfirmar: t("Quitar"),
      claseConfirmar: "btn-danger",
      onConfirmar: () => {
        if (quitarMovimiento(estado.datos, m.id)) marcarCambioPendiente();
        mostrarToast(t("Ajuste quitado"));
        refrescar();
      },
    }));
  } else {
    btnEditar.textContent = t("Editar");
    btnEditar.addEventListener("click", () => {
      // El formulario completo no conoce las cuentas (sesión 7B): si al guardar la cuenta se perdió, se devuelve.
      const cuentaPrevia = m.cuenta_id || null;
      abrirModalMovimiento({
        movimiento: m,
        alGuardar: () => {
          const actual = (estado.datos.movimientos || []).find((x) => x.id === m.id);
          if (cuentaPrevia && actual && !actual.cuenta_id) { actual.cuenta_id = cuentaPrevia; sellarTimestamp(actual); marcarCambioPendiente(); }
          refrescar();
        },
      });
    });
  }
  der.append(badge, btnEditar);
  fila.appendChild(der);
  return fila;
}

/** Suma de lo que ya cuenta hoy (misma regla que los totales: sin fecha cuenta, futuro no). */
function subtotalVigente(lista) {
  const hoy = hoyIso();
  return lista.reduce((acc, m) => (!m.fecha_registro || m.fecha_registro <= hoy ? acc + montoEfectivoMovimiento(m) : acc), 0);
}

function construirSeccionPorTipo(def, lista, refrescar) {
  const detalles = document.createElement("details");
  detalles.className = "glass-card";
  detalles.open = true;
  detalles.style.cssText = "padding:0; overflow:hidden;";

  const resumen = document.createElement("summary");
  resumen.style.cssText = "cursor:pointer; padding:12px 14px; display:flex; align-items:center; justify-content:space-between; gap:10px; list-style:none;";
  const titulo = document.createElement("span");
  titulo.style.fontWeight = "700";
  titulo.textContent = `${def.icono} ${t(def.titulo)}`;
  const cuenta = document.createElement("span");
  cuenta.className = "badge badge-neutral";
  cuenta.style.whiteSpace = "nowrap";
  cuenta.textContent = def.conSubtotal ? `${lista.length} · ${formatearMonto(subtotalVigente(lista))}` : String(lista.length);
  resumen.append(titulo, cuenta);
  detalles.appendChild(resumen);

  const cuerpo = document.createElement("div");
  cuerpo.className = "stack";
  cuerpo.style.cssText = "padding:0 14px 14px;";
  ordenarPorFecha(lista).forEach((m) => cuerpo.appendChild(construirFilaMovimiento(m, refrescar)));
  detalles.appendChild(cuerpo);
  return detalles;
}

/** Iguala el ancho de todos los badges de monto (pedido previo: que no bailen entre filas). */
function igualarAnchoBadgesMonto(contenedor) {
  const badges = contenedor.querySelectorAll(".badge-monto-movimiento");
  if (!badges.length) return;
  badges.forEach((b) => { b.style.minWidth = ""; });
  let max = 0;
  badges.forEach((b) => { max = Math.max(max, b.offsetWidth); });
  badges.forEach((b) => { b.style.minWidth = max + "px"; });
}

function renderizarPestanaMovimientos(contenedor) {
  inicializarVistaMovimientos();
  const refrescar = () => {
    contenedor.innerHTML = "";
    renderizarPestanaMovimientos(contenedor);
  };

  const cabecera = document.createElement("div");
  cabecera.className = "row-between";
  const h3 = document.createElement("h3");
  h3.className = "texto-encabezado-seccion";
  h3.style.margin = "0";
  h3.textContent = t("Movimientos");
  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary";
  btnAgregar.textContent = t("+ Añadir movimiento");
  // Registro rápido primero (monto y listo); el formulario completo queda en "Más opciones".
  btnAgregar.addEventListener("click", () => abrirRegistroRapido({
    alGuardar: refrescar,
    abrirFormularioCompleto: () => abrirModalMovimiento({ alGuardar: refrescar }),
  }));
  cabecera.append(h3, btnAgregar);
  contenedor.appendChild(cabecera);

  const visibles = obtenerMovimientosVisibles();
  if (!visibles.length) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = t("Aún no hay movimientos. Registra un gasto, un ingreso o un ahorro para empezar.");
    contenedor.appendChild(vacio);
    return;
  }

  contenedor.appendChild(
    construirPillSwitchBinario(
      [{ valor: "tipo", texto: t("Por tipo") }, { valor: "cronologico", texto: t("Cronológico") }],
      estado.finanzasVistaMovimientos,
      (valor) => {
        estado.finanzasVistaMovimientos = valor;
        refrescar();
      }
    )
  );

  if (estado.finanzasVistaMovimientos === "cronologico") {
    ordenarPorFecha(visibles).forEach((m) => contenedor.appendChild(construirFilaMovimiento(m, refrescar)));
  } else {
    SECCIONES_POR_TIPO.forEach((def) => {
      const lista = visibles.filter((m) => m.tipo === def.tipo);
      if (lista.length) contenedor.appendChild(construirSeccionPorTipo(def, lista, refrescar));
    });
  }
  igualarAnchoBadgesMonto(contenedor);
}

export { renderizarPestanaMovimientos };
