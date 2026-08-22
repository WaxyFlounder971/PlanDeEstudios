/* =========================================================================
   FINANZAS — Shell (2026-08-10)
   Nav principal → #seccion-finanzas. Contiene la vista de Resumen (default
   al entrar) + 3 pestañas internas (Semestres / Gastos generales U / Gastos
   estudiantiles), cada una delegada a su propio archivo por el límite de
   800 líneas. Este archivo solo arma el shell (pestañas + contenedor) y
   calcula los totales del Resumen — nada de CRUD acá.
   ========================================================================= */

import { calcularPagosRecurrentesTranscurridos } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { construirGraficasResumenFinanzas } from "./finanzas-graficas.js";
import { renderizarPestanaBeneficios, renderizarPestanaGastosU } from "./finanzas-gastos.js";
import { renderizarPestanaSemestresFinanzas } from "./finanzas-semestres.js";

// Estado de UI puro (no viaja a Drive, no necesita sellarTimestamp) — cuál
// de las 4 vistas está activa ahora mismo. Se inicializa una sola vez, al
// cargar el módulo, igual que estado.categoriaEditandoId en plan-categorias.js.
if (estado.finanzasVistaActiva === undefined) estado.finanzasVistaActiva = "resumen";

// v2.8.8: "Gastos estudiantiles" -> "Beneficios" (pedido explícito). El id
// interno ("gastos-estudiantiles") se deja igual a propósito — cambiarlo
// significaría migrar estado.finanzasVistaActiva para cuentas que hayan
// quedado con ese valor guardado en memoria/sesión, sin ninguna ganancia
// real ya que el id nunca se muestra, solo la etiqueta.
const PESTANAS_FINANZAS = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "semestres", etiqueta: "Semestres" },
  { id: "gastos-u", etiqueta: "Gastos generales U" },
  { id: "gastos-estudiantiles", etiqueta: "Beneficios" },
];

// v2.8.9: fechas NUNCA en bruto (nada de "2026-08-11" pelado) — en toda
// Finanzas se muestran como "11 de agosto de 2026". Vive acá porque
// finanzas-semestres.js y finanzas-gastos.js ya importan formatearMonto de
// este mismo archivo — mismo lugar central para formato de datos de la
// sección completa.
const MESES_LARGOS = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

/** "YYYY-MM-DD" -> "11 de agosto de 2026". Vacío/null -> "". */
function formatearFechaLarga(fechaIso) {
  if (!fechaIso) return "";
  const [anio, mes, dia] = fechaIso.split("-");
  const nombreMes = MESES_LARGOS[Number(mes) - 1];
  if (!nombreMes) return fechaIso; // formato inesperado — mejor mostrar algo que nada
  return `${Number(dia)} de ${nombreMes} de ${anio}`;
}

/**
 * Formato de colones consistente en toda la sección — sin decimales
 * sueltos raros, siempre 2 decimales, separador de miles local.
 *
 * v2.8.8: para negativos (ej. el Balance del Resumen cuando hay más gasto
 * que ingreso) el signo "-" se pone A MANO, antes del símbolo de moneda
 * ("-₡100.00"), en vez de dejar que toLocaleString lo intercale donde el
 * locale decida ("₡-100.00" se leía raro/ambiguo) — pedido explícito de
 * que el signo quede explícito y claro antes del monto.
 */
function formatearMonto(numero) {
  const n = Number(numero) || 0;
  const signo = n < 0 ? "-" : "";
  return signo + "₡" + Math.abs(n).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Único punto que calcula los totales del Resumen — reutilizable si algún
 * día otra pantalla necesita el mismo número (ej. un widget en Configuración).
 *
 * v2.8.8: ya no existe un "neto por semestre" auto-calculado — costo_matricula
 * y beca_monto son dos montos directos e independientes por registro:
 *   - totalGastado = suma de costo_matricula (todos los semestres) + costo
 *     de cada gasto_u (los simples: `costo`; los recurrentes: lo ya pagado
 *     hasta hoy vía calcularPagosRecurrentesTranscurridos, nunca lo que
 *     falte pagar a futuro).
 *   - totalBecas = suma de beca_monto — funciona como INGRESO/ahorro, no
 *     como un gasto más.
 *   - balanceNeto = totalBecas − totalGastado. Positivo (>=0) = más
 *     ingresos/beca que gastos; negativo = más gastos que ingresos (ver
 *     color en construirResumenFinanzas).
 */
function calcularTotalesResumenFinanzas() {
  const registros = estado.datos.finanzas_semestre || [];
  const gastos = estado.datos.gastos_u || [];

  let totalGastado = 0;
  let totalBecas = 0;

  registros.forEach((r) => {
    totalGastado += Number(r.costo_matricula) || 0;
    totalBecas += Number(r.beca_monto) || 0;
  });

  gastos.forEach((g) => {
    if (g.recurrente) {
      totalGastado += calcularPagosRecurrentesTranscurridos(g.recurrente).totalPagado;
    } else {
      totalGastado += Number(g.costo) || 0;
    }
  });

  const balanceNeto = totalBecas - totalGastado;
  return { totalGastado, totalBecas, balanceNeto };
}

function construirTabsFinanzas() {
  // v2.8.8: contenedor con container-type: inline-size (ver
  // .finanzas-tabs-contenedor en design-system.css) — permite que las 4
  // pestañas se apilen en columna cuando el ancho REAL disponible no
  // alcanza para mostrarlas en una fila sin apretarse, sin depender de un
  // @media de viewport que no sabe si el sidebar está colapsado o no.
  const envoltorio = document.createElement("div");
  envoltorio.className = "finanzas-tabs-contenedor";

  const grupo = document.createElement("div");
  grupo.className = "pill-group-finanzas";
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
  envoltorio.appendChild(grupo);
  return envoltorio;
}

function construirResumenFinanzas() {
  const { totalGastado, totalBecas, balanceNeto } = calcularTotalesResumenFinanzas();
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

  // "Total gastado" sin cambios de comportamiento (pedido explícito: sigue
  // siempre en rojo, sin condicionar el color a su signo).
  filaTotales.appendChild(construirLinea("Total gastado", totalGastado, "badge-danger"));
  if (totalBecas > 0) {
    filaTotales.appendChild(construirLinea("Total recibido en becas", totalBecas, "badge-success"));
  }
  // Balance: verde si es positivo (más ingresos/beca que gastos), rojo si
  // es negativo (más gastos que ingresos) — el signo "-" explícito ya lo
  // pone formatearMonto arriba cuando balanceNeto < 0.
  filaTotales.appendChild(
    construirLinea("Balance neto de la carrera", balanceNeto, balanceNeto >= 0 ? "badge-success" : "badge-danger")
  );

  sec.innerHTML = `<h2 class="texto-encabezado-seccion" style="margin:0;">💰 Resumen</h2>`;
  sec.appendChild(filaTotales);

  if (totalBecas === 0 && totalGastado === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent =
      "Todavía no hay ningún registro financiero. Entrá a la pestaña Semestres o Gastos generales U para empezar.";
    sec.appendChild(vacio);
  } else {
    // v2.9.0: 3 gráficas debajo de los totales — donut beca vs. gastado,
    // línea de ingresos/gastos por semestre y línea de balance acumulado.
    // Toda la lógica y el dibujo viven en finanzas-graficas.js (archivo
    // nuevo), este archivo solo les pasa los 2 totales que ya calculaba.
    sec.appendChild(construirGraficasResumenFinanzas(totalBecas, totalGastado));
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
    renderizarPestanaBeneficios(contenido);
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

export { calcularTotalesResumenFinanzas, formatearFechaLarga, formatearMonto, renderizarContenidoFinanzasActivo, renderizarFinanzas };
