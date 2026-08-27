/* =========================================================================
   FINANZAS — Shell (2026-08-10)
   Nav principal → #seccion-finanzas. Contiene la vista de Resumen (default
   al entrar) + 3 pestañas internas (Semestres / Gastos / Beneficios),
   cada una delegada a su propio archivo por el límite de
   800 líneas. Este archivo solo arma el shell (pestañas + contenedor) y
   calcula los totales del Resumen — nada de CRUD acá.
   ========================================================================= */

import { MONEDAS_DISPONIBLES, calcularPagosRecurrentesTranscurridos } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { construirGraficasResumenFinanzas } from "./finanzas-graficas.js";
import { renderizarPestanaBeneficios, renderizarPestanaGastosU } from "./finanzas-gastos.js";
import { renderizarPestanaSemestresFinanzas } from "./finanzas-semestres.js";

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * visto en el resto de la app): este archivo YA tenía un guard
 * (`if (estado.finanzasVistaActiva === undefined) ...`) para no pisar el
 * valor en cada carga del módulo — pero ese guard seguía viviendo a nivel
 * de módulo, así que la LECTURA de `estado.finanzasVistaActiva` (la
 * condición del if) igual se ejecutaba apenas se cargaba el archivo. Evitar
 * la reasignación no evita el problema real: cualquier acceso a `estado.X`
 * — sea lectura o escritura — alcanza para el ReferenceError si `estado`
 * sigue en su zona muerta temporal en ese punto del grafo de imports. Se
 * mueve a una función lazy de verdad, llamada desde los 2 puntos de
 * entrada exportados que la usan.
 */
function inicializarEstadoFinanzasSiHaceFalta() {
  if (typeof estado.finanzasVistaActiva === "undefined") estado.finanzasVistaActiva = "resumen";
}

// v2.8.8: "Gastos estudiantiles" -> "Beneficios" (pedido explícito). El id
// interno ("gastos-estudiantiles") se deja igual a propósito — cambiarlo
// significaría migrar estado.finanzasVistaActiva para cuentas que hayan
// quedado con ese valor guardado en memoria/sesión, sin ninguna ganancia
// real ya que el id nunca se muestra, solo la etiqueta.
const PESTANAS_FINANZAS = [
  { id: "resumen", etiqueta: "Resumen" },
  { id: "semestres", etiqueta: "Semestres" },
  { id: "gastos-u", etiqueta: "Movimientos" },
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
 * BUG (2026-08-26, reportado por Krys): "cambio de divisa en Ajustes no se
 * refleja en Finanzas, sigue mostrando colones". Causa confirmada: esta
 * función (y su equivalente compacta en finanzas-graficas.js) tenían el
 * símbolo "₡" hardcodeado y NUNCA leían configuracion.moneda_preferida ni
 * MONEDAS_DISPONIBLES (schema.js) — el selector de Ajustes (config-
 * ajustes.js/renderizarSelectorMoneda) sí guardaba bien el valor elegido,
 * el problema era 100% del lado de lectura acá. Se centraliza la
 * resolución del símbolo en esta única función para que formatearMonto y
 * formatearMontoCompacto (finanzas-graficas.js) queden sincronizados con
 * lo que sea que el usuario haya elegido.
 */
function obtenerSimboloMonedaActual() {
  const monedaId = (estado.datos.configuracion && estado.datos.configuracion.moneda_preferida) || "CRC";
  const moneda = MONEDAS_DISPONIBLES.find((m) => m.id === monedaId);
  return moneda ? moneda.simbolo : "₡"; // fallback defensivo si algún día se borra una moneda del catálogo
}

/**
 * Formato de monto consistente en toda la sección — sin decimales
 * sueltos raros, siempre 2 decimales, separador de miles local. El
 * símbolo ahora sale de obtenerSimboloMonedaActual() (ver fix del bug de
 * arriba) en vez de "₡" fijo.
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
  return signo + obtenerSimboloMonedaActual() + Math.abs(n).toLocaleString("es-CR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Único punto que calcula los totales del Resumen — reutilizable si algún
 * día otra pantalla necesita el mismo número (ej. un widget en Configuración).
 *
 * v2.8.8: ya no existe un "neto por semestre" auto-calculado — costo_matricula
 * y beca_monto son dos montos directos e independientes por registro:
 *   - totalGastado = suma de costo_matricula (todos los semestres) + costo
 *     de cada gasto_u de tipo "gasto" (los simples: `costo`; los
 *     recurrentes: lo ya pagado hasta hoy vía
 *     calcularPagosRecurrentesTranscurridos, nunca lo que falte pagar a
 *     futuro).
 *   - totalBecas = suma de beca_monto — funciona como INGRESO/ahorro, no
 *     como un gasto más.
 *
 * v2.9.2 (ingresos, pedido explícito de Krys): se agrega totalIngresos,
 * el mismo cálculo "a la fecha" que ya usaba totalGastado pero para los
 * gastos_u con tipo:"ingreso" (en vez de sumarse a totalGastado, se restan
 * — es plata que entró, no que salió). Los gastos_u sin `tipo` (datos
 * creados antes de este cambio) se tratan como "gasto", igual que ya
 * decide crearGastoU/schema.js — ningún dato viejo cambia de categoría
 * por default.
 *   - balanceNeto = totalBecas + totalIngresos − totalGastado. Positivo
 *     (>=0) = más entradas (beca+ingresos) que gastos; negativo = más
 *     gastos que entradas (ver color en construirResumenFinanzas /
 *     finanzas-graficas.js).
 */
function calcularTotalesResumenFinanzas() {
  // FIX (2026-08-27): antes se sumaban TODOS los registros de
  // finanzas_semestre sin chequear si el semestre al que apuntan sigue
  // existiendo — un registro huérfano (semestre borrado antes de que
  // existiera el cascade delete, ver abrirConfirmacionBorrarSemestre en
  // semestres.js) inflaba el total (ej. el donut mostraba "Beca:
  // ₡1.000.000" de un semestre que ya no está) sin que ese dinero pudiera
  // aparecer nunca en el gráfico Por semestre (finanzas-graficas.js), que
  // sí filtra por semestres vigentes — los dos números quedaban
  // inconsistentes entre sí. Se filtra acá también para que el total
  // muestre exactamente lo que hay detrás: si un semestre se borró,
  // su beca/matrícula deja de contar (el usuario tiene que volver a
  // cargarla contra el semestre real si todavía aplica).
  const idsSemestresVigentes = new Set((estado.datos.semestres || []).map((s) => s.id));
  const registros = (estado.datos.finanzas_semestre || []).filter((r) => idsSemestresVigentes.has(r.semestre_id));
  const gastos = estado.datos.gastos_u || [];

  let totalGastado = 0;
  let totalBecas = 0;
  let totalIngresos = 0;

  registros.forEach((r) => {
    totalGastado += Number(r.costo_matricula) || 0;
    totalBecas += Number(r.beca_monto) || 0;
  });

  gastos.forEach((g) => {
    const monto = g.recurrente ? calcularPagosRecurrentesTranscurridos(g.recurrente).totalPagado : Number(g.costo) || 0;
    if (g.tipo === "ingreso") {
      totalIngresos += monto;
    } else {
      totalGastado += monto;
    }
  });

  const balanceNeto = totalBecas + totalIngresos - totalGastado;
  return { totalGastado, totalBecas, totalIngresos, balanceNeto };
}

function construirTabsFinanzas() {
  // v2.9.1: antes esto dependía de .finanzas-tabs-contenedor (container-type:
  // inline-size) + .pill-group-finanzas apilándose en columna cuando no
  // entraban las 4 en una fila — pedido explícito de sacar ese apilado: las
  // 4 pestañas se quedan SIEMPRE en una sola línea horizontal, y si el
  // ancho aprieta se encoge la letra/padding en vez de bajar de línea.
  const envoltorio = document.createElement("div");
  envoltorio.className = "finanzas-tabs-contenedor";

  const grupo = document.createElement("div");
  grupo.className = "pill-group-finanzas";
  grupo.style.cssText = "display:flex; flex-direction:row; flex-wrap:nowrap; gap:clamp(4px,1.5vw,8px); width:100%;";
  PESTANAS_FINANZAS.forEach((pestana) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.finanzasVistaActiva === pestana.id ? " active" : "");
    btn.dataset.valor = pestana.id;
    btn.textContent = pestana.etiqueta;
    btn.style.cssText =
      "flex:1 1 0; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; " +
      "text-align:center; font-size:clamp(0.65rem,2.6vw,0.92rem); padding:clamp(6px,2vw,10px) clamp(4px,1.2vw,10px);";
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

/**
 * v2.9.1: se sacó el resumen de texto plano (Total gastado / Total becas /
 * Balance neto) — pedido explícito. El donut de finanzas-graficas.js (título
 * "Resumen") ahora cumple ese rol con porcentaje + monto de cada lado, así
 * que esta función solo arma el contenedor de la sección y decide entre el
 * estado vacío y las gráficas.
 */
function construirResumenFinanzas() {
  const { totalGastado, totalBecas, totalIngresos } = calcularTotalesResumenFinanzas();
  const sec = document.createElement("section");
  sec.className = "stack";

  if (totalBecas === 0 && totalGastado === 0 && totalIngresos === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent =
      "Todavía no hay ningún registro financiero. Entrá a la pestaña Semestres o Gastos para empezar.";
    sec.appendChild(vacio);
  } else {
    // Gráficas del Resumen — donut (con leyenda) y línea de ingresos/gastos
    // por semestre. Toda la lógica y el dibujo viven en finanzas-graficas.js,
    // este archivo solo les pasa los 3 totales que ya calculaba (v2.9.2:
    // se agrega totalIngresos junto a los 2 de siempre).
    sec.appendChild(construirGraficasResumenFinanzas(totalBecas, totalIngresos, totalGastado));
  }

  return sec;
}

/** Repinta solo el contenido de la pestaña activa, sin reconstruir el tab bar. */
function renderizarContenidoFinanzasActivo() {
  inicializarEstadoFinanzasSiHaceFalta();
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
  inicializarEstadoFinanzasSiHaceFalta();
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

export { calcularTotalesResumenFinanzas, formatearFechaLarga, formatearMonto, obtenerSimboloMonedaActual, renderizarContenidoFinanzasActivo, renderizarFinanzas };
