/* =========================================================================
   FINANZAS 2.0: Pestaña Plan (sesión 2, F1)
   Cuotas de matrícula y desembolsos esperados (beca, ayuda familiar,
   trabajo), agrupados por semestre. "Confirmar" crea el movimiento real en
   un toque y deja un aviso Deshacer. Los vencidos se marcan con texto y un
   tono ámbar, sin reproche. Todo se DERIVA (finanzas-compromisos.js): aquí
   no se guarda ningún número. Sin innerHTML.
   ========================================================================= */

import {
  estadoVisibleCompromiso, obtenerCompromisosVisibles, ordenarCompromisos, reabrirCompromiso, resumirCompromisos,
} from "../core/finanzas-compromisos.js";
import { crearGuardReentrada } from "../core/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { abrirEditorCompromiso, abrirGeneradorCuotas, confirmarYAvisar, pedirEliminarCompromiso } from "./finanzas-plan-formularios.js";

/** Etiqueta del tipo de pago (texto, nunca solo color). */
function etiquetaTipoCompromiso(c) {
  if (c.tipo === "matricula") return "Matrícula";
  if (c.subtipo === "ayuda_familiar") return "Ayuda familiar";
  if (c.subtipo === "trabajo") return "Trabajo";
  return "Beca";
}

/** Texto, clase de badge y signo según el estado visible. El estado siempre lleva palabra. */
const ESTADOS_PANTALLA = {
  pendiente: { texto: "Pendiente", clase: "badge-info" },
  vencido: { texto: "Vencido", clase: "badge-warning" },
  cumplido: { texto: "✓ Confirmado", clase: "badge-success" },
  omitido: { texto: "Omitido", clase: "badge-neutral" },
  sin_movimiento: { texto: "Confirmado · movimiento eliminado", clase: "badge-neutral" },
};

function linea(texto) {
  const p = document.createElement("p");
  p.className = "muted";
  p.style.cssText = "margin:2px 0 0; word-break:break-word; font-size:0.82rem;";
  p.textContent = texto;
  return p;
}

function boton(texto, clase, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.style.cssText = "white-space:nowrap; flex-shrink:0; font-size:clamp(0.72rem,2.6vw,0.9rem); padding:clamp(4px,1.4vw,8px) clamp(8px,2.5vw,14px);";
  b.textContent = texto;
  b.addEventListener("click", onClick);
  return b;
}

function construirFilaCompromiso(c, refrescar) {
  const datos = estado.datos;
  const visible = estadoVisibleCompromiso(c, datos);
  const info = ESTADOS_PANTALLA[visible];
  const movimiento = visible === "cumplido" ? (datos.movimientos || []).find((m) => m.id === c.movimiento_id) : null;
  const montoMostrado = movimiento ? movimiento.monto : c.monto;
  const signo = c.tipo === "matricula" ? "−" : "+";

  const fila = document.createElement("div");
  fila.className = "glass-card stack plan-fila";
  fila.style.cssText = "padding:10px 12px; gap:8px;";

  const cabecera = document.createElement("div");
  cabecera.className = "row-between";
  cabecera.style.cssText = "flex-wrap:nowrap; gap:10px; align-items:flex-start;";
  const izq = document.createElement("div");
  izq.style.cssText = "min-width:0;";
  const nombre = document.createElement("p");
  nombre.style.cssText = "margin:0; font-weight:600; word-break:break-word;";
  nombre.textContent = c.nombre || t("Pago sin nombre");
  const partes = [t(etiquetaTipoCompromiso(c)), c.fecha_prevista ? formatearFechaLarga(c.fecha_prevista) : t("Sin fecha")];
  if (c.tipo === "matricula" && c.afecta_saldo) partes.push(t("Afecta mi saldo"));
  izq.append(nombre, linea(partes.join(" · ")));

  const monto = document.createElement("span");
  monto.className = "badge badge-neutral";
  monto.style.cssText = "white-space:nowrap; font-variant-numeric:tabular-nums;";
  monto.textContent = `${signo}${formatearMonto(montoMostrado)}`;
  cabecera.append(izq, monto);
  fila.appendChild(cabecera);

  const pie = document.createElement("div");
  pie.className = "row";
  pie.style.cssText = "flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between;";
  const badge = document.createElement("span");
  badge.className = `badge ${info.clase}`;
  badge.textContent = t(info.texto);
  pie.appendChild(badge);

  const acciones = document.createElement("div");
  acciones.className = "row";
  acciones.style.cssText = "gap:8px; flex-wrap:nowrap;";
  const guard = crearGuardReentrada(700);
  if (visible === "pendiente" || visible === "vencido") {
    acciones.append(
      boton(t("Editar"), "btn btn-secondary", () => abrirEditorCompromiso(c, { alGuardar: refrescar })),
      boton(t("Confirmar"), "btn btn-primary", () => guard(() => { confirmarYAvisar(c, {}, refrescar); })),
    );
  } else if (visible === "omitido") {
    acciones.append(
      boton(t("Editar"), "btn btn-secondary", () => abrirEditorCompromiso(c, { alGuardar: refrescar })),
      boton(t("Reabrir"), "btn btn-secondary", () => guard(() => { if (reabrirCompromiso(datos, c.id)) { marcarCambioPendiente(); refrescar(); } })),
    );
  } else if (visible === "sin_movimiento") {
    acciones.appendChild(boton(t("Volver a pendiente"), "btn btn-secondary", () => guard(() => {
      if (reabrirCompromiso(datos, c.id)) { marcarCambioPendiente(); refrescar(); mostrarToast(t("Vuelve a estar pendiente")); }
    })));
  } else {
    acciones.appendChild(boton(t("Quitar del plan"), "btn-discreto", () => pedirEliminarCompromiso(c, refrescar)));
  }
  pie.appendChild(acciones);
  fila.appendChild(pie);
  return fila;
}

function construirTarjetaGrupo(titulo, lista, refrescar) {
  const datos = estado.datos;
  const r = resumirCompromisos(lista, datos);
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card stack";

  const cab = document.createElement("div");
  cab.className = "row-between";
  cab.style.cssText = "flex-wrap:wrap; gap:6px; align-items:center;";
  const h = document.createElement("h3");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = titulo;
  cab.appendChild(h);
  if (r.vencidos) {
    const v = document.createElement("span");
    v.className = "badge badge-warning";
    v.textContent = r.vencidos === 1 ? t("1 vencido") : t("{n} vencidos").replace("{n}", String(r.vencidos));
    cab.appendChild(v);
  }
  tarjeta.appendChild(cab);
  tarjeta.appendChild(linea(`${t("Confirmado")}: ${formatearMonto(r.confirmado)} · ${t("Pendiente")}: ${formatearMonto(r.pendiente)}`));
  ordenarCompromisos(lista).forEach((c) => tarjeta.appendChild(construirFilaCompromiso(c, refrescar)));
  return tarjeta;
}

function renderizarPestanaPlan(contenedor) {
  const refrescar = () => { contenedor.innerHTML = ""; renderizarPestanaPlan(contenedor); };

  const nuevo = document.createElement("button");
  nuevo.type = "button";
  nuevo.className = "btn btn-primary btn-block";
  nuevo.textContent = "＋ " + t("Planificar pagos");
  nuevo.addEventListener("click", () => abrirGeneradorCuotas({ alGuardar: refrescar }));
  contenedor.appendChild(nuevo);

  const visibles = obtenerCompromisosVisibles(estado.datos);
  if (!visibles.length) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = t("Planifica tu primera cuota. Por ejemplo, la matrícula de este semestre en 4 pagos: la app los reparte y te muestra cuáles están pendientes.");
    contenedor.appendChild(vacio);
    return;
  }

  // Un grupo por semestre (en el orden de la pestaña Semestres) y al final los que no tienen semestre.
  const mostrados = new Set();
  obtenerTodosLosSemestres().forEach((s) => {
    const lista = visibles.filter((c) => c.semestre_id === s.id);
    lista.forEach((c) => mostrados.add(c.id));
    if (lista.length) contenedor.appendChild(construirTarjetaGrupo(t(s.nombre), lista, refrescar));
  });
  // Nada queda invisible: lo que no tiene semestre (o cuyo semestre no está en la lista) va al final.
  const sueltos = visibles.filter((c) => !mostrados.has(c.id));
  if (sueltos.length) contenedor.appendChild(construirTarjetaGrupo(t(sueltos.every((c) => !c.semestre_id) ? "Sin semestre" : "Otros pagos"), sueltos, refrescar));
}

export { etiquetaTipoCompromiso, renderizarPestanaPlan };
