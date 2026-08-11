/* =========================================================================
   FINANZAS — Shell (2026-08-10)
   Nav principal → #seccion-finanzas. Contiene la vista de Resumen (default
   al entrar) + 3 pestañas internas (Semestres / Gastos generales U / Gastos
   estudiantiles), cada una delegada a su propio archivo por el límite de
   800 líneas. Este archivo solo arma el shell (pestañas + contenedor) y
   calcula los totales del Resumen — nada de CRUD acá.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { renderizarPestanaGastosEstudiantiles, renderizarPestanaGastosU } from "./finanzas-gastos.js";
import { renderizarPestanaSemestresFinanzas } from "./finanzas-semestres.js";

// Estado de UI puro (no viaja a Drive, no necesita sellarTimestamp) — cuál
// de las 4 vistas está activa ahora mismo. Se inicializa una sola vez, al
// cargar el módulo, igual que estado.categoriaEditandoId en plan-categorias.js.
if (estado.finanzasVistaActiva === undefined) estado.finanzasVistaActiva = "resumen";

const PESTANAS_FINANZAS = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "semestres", etiqueta: "Semestres" },
  { id: "gastos-u", etiqueta: "Gastos generales U" },
  { id: "gastos-estudiantiles", etiqueta: "Gastos estudiantiles" },
];

/**
 * Formato de colones consistente en toda la sección — sin decimales
 * sueltos raros, siempre 2 decimales, separador de miles local.
 */
function formatearMonto(numero) {
  const n = Number(numero) || 0;
  return "₡" + n.toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Único punto que calcula los totales del Resumen — reutilizable si algún
 * día otra pantalla necesita el mismo número (ej. un widget en Configuración).
 * Ver punto 7 del prompt: total gastado, total "ganado" (cuando el neto de
 * un semestre da negativo por una beca que supera el costo) y balance neto
 * general de toda la carrera. gastos_u se suma siempre como gasto (no se
 * espera que un gasto general dé negativo, a diferencia del registro de
 * semestre que sí puede por la beca).
 */
function calcularTotalesResumenFinanzas() {
  const registros = estado.datos.finanzas_semestre || [];
  const gastos = estado.datos.gastos_u || [];

  let totalGastado = 0;
  let totalGanado = 0;

  registros.forEach((r) => {
    const neto = Number(r.pago_confirmado) || 0;
    if (neto >= 0) totalGastado += neto;
    else totalGanado += Math.abs(neto);
  });

  gastos.forEach((g) => {
    totalGastado += Number(g.costo) || 0;
  });

  const balanceNeto = totalGastado - totalGanado;
  return { totalGastado, totalGanado, balanceNeto };
}

function construirTabsFinanzas() {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  PESTANAS_FINANZAS.forEach((pestana) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.finanzasVistaActiva === pestana.id ? " active" : "");
    btn.dataset.valor = pestana.id;
    btn.textContent = pestana.etiqueta;
    btn.addEventListener("click", () => {
      if (estado.finanzasVistaActiva === pestana.id) return;
      estado.finanzasVistaActiva = pestana.id;
      renderizarFinanzas();
    });
    grupo.appendChild(btn);
  });
  return grupo;
}

function construirResumenFinanzas() {
  const { totalGastado, totalGanado, balanceNeto } = calcularTotalesResumenFinanzas();
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const filaTotales = document.createElement("div");
  filaTotales.className = "stack";
  filaTotales.style.gap = "10px";

  const construirLinea = (etiqueta, valor, claseBadge) => {
    const fila = document.createElement("div");
    fila.className = "row-between";
    fila.innerHTML = `
      <span>${etiqueta}</span>
      <span class="badge ${claseBadge}">${formatearMonto(valor)}</span>
    `;
    return fila;
  };

  filaTotales.appendChild(construirLinea("Total gastado", totalGastado, "badge-danger"));
  if (totalGanado > 0) {
    filaTotales.appendChild(construirLinea("Total ganado (beca sobre costo)", totalGanado, "badge-success"));
  }
  filaTotales.appendChild(
    construirLinea("Balance neto de la carrera", balanceNeto, balanceNeto <= 0 ? "badge-success" : "badge-neutral")
  );

  sec.innerHTML = `<h2 style="margin:0;">💰 Resumen</h2>`;
  sec.appendChild(filaTotales);

  if (totalGanado === 0 && totalGastado === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent =
      "Todavía no hay ningún registro financiero. Entrá a la pestaña Semestres o Gastos generales U para empezar.";
    sec.appendChild(vacio);
  }

  return sec;
}

/** Repinta solo el contenido de la pestaña activa, sin reconstruir el tab bar. */
function renderizarContenidoFinanzasActivo() {
  const contenido = document.getElementById("finanzas-contenido");
  if (!contenido) return;
  contenido.innerHTML = "";

  if (estado.finanzasVistaActiva === "resumen") {
    contenido.appendChild(construirResumenFinanzas());
  } else if (estado.finanzasVistaActiva === "semestres") {
    renderizarPestanaSemestresFinanzas(contenido);
  } else if (estado.finanzasVistaActiva === "gastos-u") {
    renderizarPestanaGastosU(contenido);
  } else if (estado.finanzasVistaActiva === "gastos-estudiantiles") {
    renderizarPestanaGastosEstudiantiles(contenido);
  }
}

/**
 * Punto de entrada de la sección — se llama desde main.js (al cargar/tras
 * login) y desde storage-sync.js (cada sondeo remoto y pull-to-refresh),
 * mismo patrón que renderizarSemestres/renderizarPlanEstudios. Se protege
 * sola si #seccion-finanzas todavía no está en el DOM.
 */
function renderizarFinanzas() {
  const cont = document.getElementById("seccion-finanzas");
  if (!cont) return;
  cont.innerHTML = "";

  cont.appendChild(construirTabsFinanzas());

  const contenido = document.createElement("div");
  contenido.id = "finanzas-contenido";
  contenido.className = "stack";
  cont.appendChild(contenido);

  renderizarContenidoFinanzasActivo();
}

export { calcularTotalesResumenFinanzas, formatearMonto, renderizarContenidoFinanzasActivo, renderizarFinanzas };
