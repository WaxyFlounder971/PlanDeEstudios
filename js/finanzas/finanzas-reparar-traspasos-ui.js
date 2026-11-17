/* =========================================================================
   FINANZAS 2.0: pantalla "Revisar traspasos dañados" (v3.28.0, A2, tarea F1). Sin innerHTML.
   Nunca corre sola: primero muestra la simulación (qué se quitaría y cómo quedarían Sin asignar y Mi dinero), exige descargar el
   respaldo y marcar la confirmación. La lógica vive en core/finanzas/finanzas-reparar-traspasos.js.
   ========================================================================= */

import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { monedaPrincipal } from "../core/finanzas/finanzas-cuentas-base.js";
import { buscarCuenta } from "../core/finanzas/finanzas-cuentas.js";
import { exportarRespaldoJson } from "../core/finanzas/finanzas-importar.js";
import { aplicarReparacionTraspasos, simularReparacionTraspasos } from "../core/finanzas/finanzas-reparar-traspasos.js";
import { renderizarFinanzas } from "./finanzas.js";
import { formatearEn } from "./finanzas-cuentas-ui.js";
import { entregarArchivo } from "./finanzas-datos-ui.js";
import { abrirCapaNombrada, boton, filaBotones, parrafo } from "./finanzas-ui-basico.js";

/** Aviso en la pestaña Cuentas, solo si la simulación encuentra algo. null si no hay nada que revisar. */
function crearAvisoRepararTraspasos() {
  const sim = simularReparacionTraspasos(estado.datos);
  if (!sim.activo || !sim.candidatos.length) return null;
  const caja = document.createElement("div"); caja.className = "glass-card row-between"; caja.style.cssText = "gap:10px; align-items:center;";
  const txt = document.createElement("div"); txt.style.minWidth = "0";
  const titulo = document.createElement("p"); titulo.style.cssText = "margin:0; font-weight:600;"; titulo.textContent = t("Traspasos por revisar"); txt.appendChild(titulo);
  txt.appendChild(parrafo("Hay traspasos desde Sin asignar que pasaron más dinero del que había. Puedes ver qué cambiaría antes de tocar nada.", { tamano: "0.78rem" }));
  caja.append(txt, boton(t("Revisar"), "btn btn-secondary", () => abrirRevisionTraspasos()));
  return caja;
}

function abrirRevisionTraspasos() {
  const { caja, cerrar } = abrirCapaNombrada("finanzas-reparar-traspasos-overlay", "Traspasos por revisar", { ancho: 520, z: 330 });
  const principal = monedaPrincipal(estado.datos);
  const sim = simularReparacionTraspasos(estado.datos);
  const lin = (texto, valor) => { const f = document.createElement("div"); f.className = "row-between"; const a = document.createElement("span"); a.textContent = t(texto); const b = document.createElement("strong"); b.textContent = valor; f.append(a, b); return f; };
  if (!sim.candidatos.length) { caja.append(parrafo("No hay traspasos por revisar."), filaBotones(boton(t("Cerrar"), "btn btn-secondary", cerrar))); return; }

  caja.appendChild(parrafo("Estos traspasos salieron de Sin asignar y pedían más dinero del que había. Al quitarlos, el dinero deja de contarse dos veces. No se cambia ningún gasto ni ingreso."));
  sim.candidatos.forEach((c) => {
    const d = c.destinoId ? buscarCuenta(estado.datos, c.destinoId) : null;
    const f = document.createElement("div"); f.className = "glass-card stack"; f.style.gap = "2px";
    f.append(lin("Monto", formatearEn(c.monto, principal)), lin("Había en Sin asignar", formatearEn(c.disponible, principal)));
    const info = document.createElement("div"); info.className = "muted"; info.style.fontSize = "0.78rem"; info.textContent = `${c.fecha || t("Sin fecha")} → ${d ? d.nombre : t("cuenta eliminada")}`; f.appendChild(info);
    caja.appendChild(f);
  });
  const res = document.createElement("div"); res.className = "glass-card stack"; res.style.gap = "4px";
  res.append(
    lin("Sin asignar hoy", formatearEn(sim.antes.sinAsignar, principal)), lin("Sin asignar después", formatearEn(sim.despues.sinAsignar, principal)),
    lin("Mi dinero hoy", formatearEn(sim.antes.saldoLiquido, principal)), lin("Mi dinero después", formatearEn(sim.despues.saldoLiquido, principal)),
  );
  caja.appendChild(res);
  if (sim.despues.sinAsignar < 0) caja.appendChild(parrafo("Si Sin asignar sigue en negativo, son gastos sin cuenta: para dejarlo en 0, edita esos movimientos y asígnalos a su cuenta.", { tamano: "0.78rem" }));

  const paso1 = document.createElement("div"); paso1.className = "stack"; paso1.style.gap = "6px";
  paso1.appendChild(parrafo("Paso 1: descarga un respaldo, por si quieres volver atrás.", { tamano: "0.8rem" }));
  const confirmar = document.createElement("input"); confirmar.type = "checkbox"; confirmar.disabled = true;
  const etiqueta = document.createElement("label"); etiqueta.className = "row"; etiqueta.style.cssText = "gap:8px; align-items:center;";
  const textoConfirmar = document.createElement("span"); textoConfirmar.textContent = t("Entiendo que se quitarán estos traspasos."); etiqueta.append(confirmar, textoConfirmar);
  const aplicar = boton(t("Quitar traspasos"), "btn btn-primary", () => {
    const r = aplicarReparacionTraspasos(estado.datos, sim.candidatos.map((c) => c.id));
    if (!r.ok) { aplicar.disabled = true; return; }
    marcarCambioPendiente(); cerrar(); mostrarToast(t("Guardado")); renderizarFinanzas();
  });
  aplicar.disabled = true;
  const respaldo = boton(t("Descargar respaldo"), "btn btn-secondary", async () => {
    const g = exportarRespaldoJson(estado.datos);
    const r = await entregarArchivo(g.nombreArchivo, g.texto, "application/json");
    if (r === "cancelado") return;
    confirmar.disabled = false; respaldo.textContent = t("Respaldo descargado");
  });
  confirmar.addEventListener("change", () => { aplicar.disabled = !confirmar.checked; });
  paso1.append(respaldo, etiqueta);
  caja.append(paso1, filaBotones(boton(t("Cancelar"), "btn btn-secondary", cerrar), aplicar));
}

export { abrirRevisionTraspasos, crearAvisoRepararTraspasos };
