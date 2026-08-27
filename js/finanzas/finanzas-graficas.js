/* =========================================================================
   FINANZAS — Gráficas del Resumen (2026-08-22, v2.9.1)
   2 visualizaciones para la pestaña Resumen, todas en SVG a mano — no hay
   ninguna librería de gráficos en el proyecto (se revisó todo antes de
   arrancar), y ya existe precedente de donuts hechos así mismo (ver
   .donut-bloque en design-system.css), así que se sigue ese mismo criterio
   en vez de traer una dependencia nueva.

   v2.9.1: se sacó la 3ra gráfica (Balance acumulado, no gustó) y el bloque
   de totales duplicado que vivía en finanzas.js (Total gastado / Balance
   neto) — ahora el donut ES el resumen: título "Resumen", nada dentro ni
   debajo del círculo, y a la derecha (o abajo si no cabe en horizontal)
   una leyenda en grid con porcentaje/etiqueta/monto bien alineados.
   La línea de "Por semestre" ahora es 100% ancho responsivo (viewBox +
   CSS width:100%, sin scroll horizontal) y con ejes X/Y dibujados, más un
   tooltip flotante al tocar cada punto (antes solo <title>, que no sirve
   en mobile).

   Cero lógica de negocio duplicada: beca/gastado totales siguen viniendo
   100% de calcularTotalesResumenFinanzas (finanzas.js) — este archivo solo
   agrega el cálculo NUEVO que hacía falta para la serie por semestre (ver
   calcularSerieFinancieraPorSemestre) y el dibujo.
   ========================================================================= */

import { calcularPagosRecurrentesTranscurridos } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { formatearMonto, obtenerSimboloMonedaActual } from "./finanzas.js";

const COLOR_GASTO = "#ef4444"; // mismo rojo que badge-danger / segReprobados en semestres-dashboard.js
const COLOR_INGRESO = "#10b981"; // mismo verde que badge-success / segAprobados — beca
const COLOR_INGRESO_PROPIO = "#3b82f6"; // azul (2026-08-26, pedido explícito de Krys): ingresos propios, para diferenciarlos visualmente de la beca

/* ===================== Datos: serie por semestre ===================== */

/**
 * Costo de un gasto_u individual "a la fecha" — mismo criterio que ya usa
 * calcularTotalesResumenFinanzas en finanzas.js: si es recurrente, lo ya
 * pagado hasta hoy (nunca lo que falte a futuro); si es simple, su costo fijo.
 */
function costoDeGastoUAlaFecha(gasto) {
  if (gasto.recurrente) return calcularPagosRecurrentesTranscurridos(gasto.recurrente).totalPagado;
  return Number(gasto.costo) || 0;
}

/**
 * Serie cronológica de beca / ingresos propios / gasto (matrícula +
 * gastos_u vinculados) por semestre, ordenada por fecha_inicio ascendente,
 * más un punto final "General" que agrupa los gastos_u SIN semestre_id
 * (carné, seguro, recurrentes generales) — decisión confirmada: no se
 * descartan, se agrupan aparte al final del eje X en vez de perderse.
 *
 * v2.9.2 (ingresos, pedido explícito de Krys): antes cada gasto_u
 * vinculado sumaba siempre a `gasto` sin distinción — ahora se separa por
 * `tipo`: los de tipo "ingreso" van a su propio campo `ingresoPropio` en
 * vez de mezclarse con los gastos (si no, un ingreso vinculado a un
 * semestre se hubiera contado por error como si fuera un gasto más).
 *
 * Solo entran semestres "con movimiento": con registro financiero propio
 * (finanzas_semestre) o con al menos un gasto_u vinculado a ese semestre_id.
 */
function calcularSerieFinancieraPorSemestre() {
  const semestres = obtenerTodosLosSemestres()
    .slice()
    .sort((a, b) => (a.fecha_inicio || "").localeCompare(b.fecha_inicio || ""));
  const registros = estado.datos.finanzas_semestre || [];
  const gastosU = estado.datos.gastos_u || [];

  const puntos = [];

  semestres.forEach((semestre) => {
    const registro = registros.find((r) => r.semestre_id === semestre.id) || null;
    const gastosVinculados = gastosU.filter((g) => g.semestre_id === semestre.id);
    const huboMovimiento = registro !== null || gastosVinculados.length > 0;
    if (!huboMovimiento) return;

    const beca = registro ? Number(registro.beca_monto) || 0 : 0;
    let gasto = registro ? Number(registro.costo_matricula) || 0 : 0;
    let ingresoPropio = 0;
    gastosVinculados.forEach((g) => {
      const monto = costoDeGastoUAlaFecha(g);
      if (g.tipo === "ingreso") ingresoPropio += monto;
      else gasto += monto;
    });

    puntos.push({ etiqueta: semestre.nombre, beca, ingresoPropio, gasto });
  });

  const gastosSinSemestre = gastosU.filter((g) => !g.semestre_id);
  if (gastosSinSemestre.length > 0) {
    let gastoGeneral = 0;
    let ingresoGeneral = 0;
    gastosSinSemestre.forEach((g) => {
      const monto = costoDeGastoUAlaFecha(g);
      if (g.tipo === "ingreso") ingresoGeneral += monto;
      else gastoGeneral += monto;
    });
    puntos.push({ etiqueta: "General", beca: 0, ingresoPropio: ingresoGeneral, gasto: gastoGeneral });
  }

  return puntos;
}

/* ===================== Donut: Resumen (gastado vs. disponible) ===================== */

/**
 * v2.9.2 (ingresos, pedido explícito de Krys): el donut de 2 segmentos
 * dejó de ser "Beca vs. gastado" — con ingresos propios en la mezcla,
 * sumar beca+ingresos+gastado en el mismo aro (3 segmentos) mezclaba
 * ENTRADAS de plata con SALIDAS de plata bajo una sola proporción sin
 * significado accionable (ver discusión previa a este cambio). En su
 * lugar, el donut ahora es "Gastado vs. Disponible", sobre el total de
 * entradas (beca + ingresos) — esto SÍ es una relación real de "partes de
 * un todo": gastado + disponible = 100% de lo que entró, y le dice a la
 * persona de un vistazo cuánto le queda. De dónde viene esa plata (beca
 * vs. ingresos propios) se muestra aparte, en construirComposicionIngresos
 * — no tiene sentido forzarlo dentro del mismo círculo.
 *
 * Cuando el gasto supera lo que entró (`disponible` negativo), el arco se
 * dibuja 100% rojo (todo "gastado") en vez de un arco que se saldría del
 * círculo — el monto negativo real se sigue mostrando tal cual en la
 * leyenda y en el balance total de abajo.
 */
function construirDonutGastadoVsDisponible(totalEntradas, totalGastado) {
  const base = Math.max(totalEntradas, totalGastado, 0);
  const bloque = document.createElement("div");
  bloque.className = "donut-bloque";
  bloque.style.flexShrink = "0";

  const RADIO = 54;
  const GROSOR = 16;
  const CIRC = 2 * Math.PI * RADIO;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 140 140");
  svg.setAttribute("width", "140");
  svg.setAttribute("height", "140");

  const pista = document.createElementNS(svg.namespaceURI, "circle");
  pista.setAttribute("cx", "70");
  pista.setAttribute("cy", "70");
  pista.setAttribute("r", String(RADIO));
  pista.setAttribute("fill", "none");
  pista.setAttribute("stroke", "var(--border-glass)");
  pista.setAttribute("stroke-width", String(GROSOR));
  svg.appendChild(pista);

  if (base > 0) {
    const gastadoParaArco = Math.min(totalGastado, base); // nunca > base, así el arco nunca "se pasa" del círculo
    const largoGastado = (gastadoParaArco / base) * CIRC;
    const largoDisponible = CIRC - largoGastado;

    const arcoGastado = document.createElementNS(svg.namespaceURI, "circle");
    arcoGastado.setAttribute("cx", "70");
    arcoGastado.setAttribute("cy", "70");
    arcoGastado.setAttribute("r", String(RADIO));
    arcoGastado.setAttribute("fill", "none");
    arcoGastado.setAttribute("stroke", COLOR_GASTO);
    arcoGastado.setAttribute("stroke-width", String(GROSOR));
    arcoGastado.setAttribute("stroke-dasharray", `${largoGastado} ${CIRC - largoGastado}`);
    arcoGastado.setAttribute("transform", "rotate(-90 70 70)");
    svg.appendChild(arcoGastado);

    const arcoDisponible = document.createElementNS(svg.namespaceURI, "circle");
    arcoDisponible.setAttribute("cx", "70");
    arcoDisponible.setAttribute("cy", "70");
    arcoDisponible.setAttribute("r", String(RADIO));
    arcoDisponible.setAttribute("fill", "none");
    arcoDisponible.setAttribute("stroke", COLOR_INGRESO);
    arcoDisponible.setAttribute("stroke-width", String(GROSOR));
    arcoDisponible.setAttribute("stroke-dasharray", `${largoDisponible} ${CIRC - largoDisponible}`);
    arcoDisponible.setAttribute("stroke-dashoffset", String(-largoGastado));
    arcoDisponible.setAttribute("transform", "rotate(-90 70 70)");
    svg.appendChild(arcoDisponible);
  }

  bloque.appendChild(svg);
  return bloque;
}

/**
 * Leyenda en grid de 3 columnas (porcentaje / etiqueta / monto) — mismo
 * patrón visual de siempre ("todo parejito"). Los porcentajes se calculan
 * sobre la misma base que el arco (para que coincidan visualmente); los
 * montos que se muestran son los REALES (sin recortar), así que si hay
 * sobregasto el monto de "Disponible" se ve negativo tal cual es.
 */
function construirLeyendaDonut(totalEntradas, totalGastado) {
  const base = Math.max(totalEntradas, totalGastado, 0);
  const disponible = totalEntradas - totalGastado;
  const gastadoParaArco = Math.min(totalGastado, base);
  const pctGasto = base > 0 ? Math.round((gastadoParaArco / base) * 100) : 0;
  const pctDisponible = base > 0 ? 100 - pctGasto : 0;

  const leyenda = document.createElement("div");
  leyenda.style.cssText =
    "display:grid; grid-template-columns:auto 1fr auto; column-gap:14px; row-gap:12px; align-items:center; min-width:220px;";

  const construirFila = (color, pct, texto, monto) => {
    const pctEl = document.createElement("span");
    pctEl.style.cssText = `font-weight:800; font-size:1.05rem; color:${color}; text-align:right; font-variant-numeric:tabular-nums;`;
    pctEl.textContent = `${pct}%`;

    const textoEl = document.createElement("span");
    textoEl.style.cssText = "font-size:0.85rem;";
    textoEl.textContent = texto;

    const montoEl = document.createElement("span");
    montoEl.style.cssText = "font-size:0.85rem; font-weight:700; text-align:right; font-variant-numeric:tabular-nums;";
    montoEl.textContent = formatearMonto(monto);

    leyenda.appendChild(pctEl);
    leyenda.appendChild(textoEl);
    leyenda.appendChild(montoEl);
  };

  construirFila(COLOR_GASTO, pctGasto, "Gastado", totalGastado);
  construirFila(disponible >= 0 ? COLOR_INGRESO : COLOR_GASTO, pctDisponible, "Disponible", disponible);

  return leyenda;
}

/**
 * Desglose de "de dónde viene la plata" (beca vs. ingresos propios) —
 * v2.9.2, pedido explícito de Krys. A propósito NO es otro donut: son dos
 * cifras que se leen mejor como texto/badge que como otra proporción
 * circular (ver discusión antes de este cambio) — un renglón con 2 chips
 * de color alcanza y queda más legible.
 */
function construirComposicionIngresos(totalBecas, totalIngresos) {
  const fila = document.createElement("div");
  fila.style.cssText = "display:flex; gap:18px; flex-wrap:wrap; justify-content:center;";

  const construirChip = (color, etiqueta, monto) => {
    const chip = document.createElement("span");
    chip.style.cssText = "display:inline-flex; align-items:center; gap:6px; font-size:0.82rem;";
    chip.innerHTML =
      `<span style="width:9px; height:9px; border-radius:50%; background:${color}; display:inline-block; flex-shrink:0;"></span>` +
      `<span class="muted">${etiqueta}:</span> <strong style="font-variant-numeric:tabular-nums;">${formatearMonto(monto)}</strong>`;
    return chip;
  };

  fila.appendChild(construirChip(COLOR_INGRESO, "Beca", totalBecas));
  fila.appendChild(construirChip(COLOR_INGRESO_PROPIO, "Ingresos", totalIngresos));

  return fila;
}

/** Balance total (beca + ingresos − gastado), centrado debajo de la gráfica: verde si es >= 0, rojo si es negativo. */
function construirBalanceTotal(balanceNeto) {
  const el = document.createElement("div");
  el.style.cssText = "text-align:center;";
  const color = balanceNeto >= 0 ? COLOR_INGRESO : COLOR_GASTO;
  el.innerHTML = `<span class="muted" style="font-size:0.85rem;">Balance total: </span><span style="font-weight:800; font-size:1rem; color:${color};">${formatearMonto(balanceNeto)}</span>`;
  return el;
}

/**
 * v2.9.2: donut reenfocado a "Gastado vs. Disponible" (ver
 * construirDonutGastadoVsDisponible) + fila nueva de composición de
 * ingresos (beca vs. ingresos propios) debajo de la leyenda. v2.9.1: título
 * "Resumen" (antes "Beca vs. gastado"). El balance total sigue centrado
 * debajo de todo.
 */
function construirSeccionDonut(totalBecas, totalIngresos, totalGastado) {
  const totalEntradas = totalBecas + totalIngresos;

  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Resumen</h3>`;

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex; align-items:center; justify-content:center; gap:28px; flex-wrap:wrap;";
  fila.appendChild(construirDonutGastadoVsDisponible(totalEntradas, totalGastado));
  fila.appendChild(construirLeyendaDonut(totalEntradas, totalGastado));
  sec.appendChild(fila);

  sec.appendChild(construirComposicionIngresos(totalBecas, totalIngresos));
  sec.appendChild(construirBalanceTotal(totalEntradas - totalGastado));

  return sec;
}

/* ===================== Línea: Por semestre (ingresos vs. gastos) ===================== */

// viewBox lógico — el SVG se dibuja en este sistema de coordenadas fijo y
// después se escala al 100% del ancho real vía CSS (width:100%; height:auto),
// así siempre usa todo el espacio horizontal disponible en vez de quedarse
// corto o necesitar scroll.
const VB_ANCHO = 640;
const VB_ALTO = 240;
const MARGEN_IZQ = 46; // espacio para las etiquetas del eje Y
const MARGEN_DER = 14;
const MARGEN_SUP = 16;
const MARGEN_INF = 58; // espacio para las etiquetas del eje X, rotadas -35°

/**
 * Símbolo de la moneda elegida (fix del mismo bug de finanzas.js/
 * formatearMonto: acá también estaba "₡" hardcodeado, así que las
 * etiquetas del eje Y nunca reflejaban el cambio de divisa) + número
 * abreviado (k/M) para que no se amontonen.
 */
function formatearMontoCompacto(numero) {
  const n = Number(numero) || 0;
  const signo = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  const simbolo = obtenerSimboloMonedaActual();
  if (abs >= 1000000) return `${signo}${simbolo}${(abs / 1000000).toFixed(abs % 1000000 === 0 ? 0 : 1)}M`;
  if (abs >= 1000) return `${signo}${simbolo}${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${signo}${simbolo}${abs.toFixed(0)}`;
}

/**
 * "Nice numbers" para el eje Y: en vez de dividir valorMax en 4 partes
 * iguales (da cortes feos tipo ₡37,412), redondea el paso al 1/2/5×10^n
 * más cercano — funciona para cualquier magnitud (cientos, miles,
 * millones) sin necesitar saber qué moneda usa el usuario.
 */
function calcularEscalaAgradable(valorMax) {
  if (valorMax <= 0) return { max: 4, paso: 1 };
  const objetivoPasos = 4;
  const bruto = valorMax / objetivoPasos;
  const magnitud = Math.pow(10, Math.floor(Math.log10(bruto)));
  const normalizado = bruto / magnitud;
  let pasoNormalizado;
  if (normalizado <= 1) pasoNormalizado = 1;
  else if (normalizado <= 2) pasoNormalizado = 2;
  else if (normalizado <= 5) pasoNormalizado = 5;
  else pasoNormalizado = 10;
  const paso = pasoNormalizado * magnitud;
  const max = Math.ceil(valorMax / paso) * paso;
  return { max, paso };
}

/**
 * Gráfica de línea genérica con ejes X/Y dibujados y tooltip táctil por
 * punto. Recibe `puntos` (cada uno con `etiqueta` + un valor por serie) y
 * `series` (qué campo/color/nombre dibujar).
 */
function construirGraficaLinea(puntos, series) {
  const n = puntos.length;
  const anchoUtil = VB_ANCHO - MARGEN_IZQ - MARGEN_DER;
  const altoUtil = VB_ALTO - MARGEN_SUP - MARGEN_INF;

  const todosLosValores = puntos.flatMap((p) => series.map((s) => p[s.clave]));
  const valorMaxCrudo = Math.max(0, ...todosLosValores);
  const { max: valorMax, paso: pasoY } = calcularEscalaAgradable(valorMaxCrudo);
  const valorMin = 0; // ingresos/gastos nunca son negativos en este modelo

  const x = (i) => (n === 1 ? MARGEN_IZQ + anchoUtil / 2 : MARGEN_IZQ + (i / (n - 1)) * anchoUtil);
  const y = (valor) => MARGEN_SUP + altoUtil - ((valor - valorMin) / (valorMax - valorMin)) * altoUtil;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${VB_ANCHO} ${VB_ALTO}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.cssText = "display:block; width:100%; height:auto;";

  // ----- Eje Y: líneas guía en pasos redondos (₡50k, ₡100k...) + etiquetas -----
  const cantidadPasos = Math.round(valorMax / pasoY) || 1;
  for (let paso = 0; paso <= cantidadPasos; paso++) {
    const valor = paso * pasoY;
    const yPos = y(valor);

    const grid = document.createElementNS(svg.namespaceURI, "line");
    grid.setAttribute("x1", String(MARGEN_IZQ));
    grid.setAttribute("x2", String(VB_ANCHO - MARGEN_DER));
    grid.setAttribute("y1", String(yPos));
    grid.setAttribute("y2", String(yPos));
    grid.setAttribute("stroke", "var(--border-glass)");
    grid.setAttribute("stroke-width", "1");
    if (paso !== 0) grid.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(grid);

    const etiquetaY = document.createElementNS(svg.namespaceURI, "text");
    etiquetaY.setAttribute("x", String(MARGEN_IZQ - 8));
    etiquetaY.setAttribute("y", String(yPos + 3));
    etiquetaY.setAttribute("text-anchor", "end");
    etiquetaY.setAttribute("font-size", "9.5");
    etiquetaY.setAttribute("fill", "var(--text-muted)");
    etiquetaY.textContent = formatearMontoCompacto(valor);
    svg.appendChild(etiquetaY);
  }

  // ----- Eje X: línea base + una etiqueta rotada por semestre -----
  const ejeX = document.createElementNS(svg.namespaceURI, "line");
  ejeX.setAttribute("x1", String(MARGEN_IZQ));
  ejeX.setAttribute("x2", String(VB_ANCHO - MARGEN_DER));
  ejeX.setAttribute("y1", String(y(valorMin)));
  ejeX.setAttribute("y2", String(y(valorMin)));
  ejeX.setAttribute("stroke", "var(--text-muted)");
  ejeX.setAttribute("stroke-width", "1.2");
  svg.appendChild(ejeX);

  puntos.forEach((p, i) => {
    const yEtiqueta = VB_ALTO - MARGEN_INF + 14;
    const texto = document.createElementNS(svg.namespaceURI, "text");
    texto.setAttribute("x", String(x(i)));
    texto.setAttribute("y", String(yEtiqueta));
    texto.setAttribute("text-anchor", "end");
    texto.setAttribute("font-size", "10");
    texto.setAttribute("fill", "var(--text-muted)");
    texto.setAttribute("transform", `rotate(-35 ${x(i)} ${yEtiqueta})`);
    texto.textContent = p.etiqueta;
    svg.appendChild(texto);

    // Marca vertical corta bajo cada punto del eje X, para que quede claro
    // a qué semestre corresponde cada posición.
    const marca = document.createElementNS(svg.namespaceURI, "line");
    marca.setAttribute("x1", String(x(i)));
    marca.setAttribute("x2", String(x(i)));
    marca.setAttribute("y1", String(y(valorMin)));
    marca.setAttribute("y2", String(y(valorMin) + 4));
    marca.setAttribute("stroke", "var(--text-muted)");
    marca.setAttribute("stroke-width", "1.2");
    svg.appendChild(marca);
  });

  // ----- Envoltorio + tooltip flotante (posicionado en % del wrapper,
  // así no depende de medir el SVG renderizado: como el SVG escala 100%
  // manteniendo el mismo viewBox, x/VB_ANCHO y y/VB_ALTO ya son el % correcto). -----
  const wrapper = document.createElement("div");
  wrapper.style.cssText = "position:relative; width:100%;";

  const tooltip = document.createElement("div");
  tooltip.style.cssText =
    "position:absolute; display:none; pointer-events:none; z-index:5; padding:5px 10px; " +
    "font-size:0.75rem; font-weight:600; white-space:nowrap; transform:translate(-50%,-125%); " +
    "background:var(--bg-glass, rgba(20,20,28,0.95)); border:1px solid var(--border-glass); " +
    "border-radius:8px; box-shadow:0 4px 14px rgba(0,0,0,0.35); color:var(--text-primary);";
  wrapper.appendChild(tooltip);

  function mostrarTooltip(px, py, texto) {
    tooltip.textContent = texto;
    tooltip.style.left = `${(px / VB_ANCHO) * 100}%`;
    tooltip.style.top = `${(py / VB_ALTO) * 100}%`;
    tooltip.style.display = "block";
  }
  function ocultarTooltip() {
    tooltip.style.display = "none";
  }
  // Cerrar el tooltip al tocar/clickear afuera.
  document.addEventListener("click", ocultarTooltip);

  // ----- Series: línea + puntos (con área táctil más grande que el punto
  // visible, para que sea fácil de tocar en mobile) -----
  series.forEach((serie) => {
    const puntosLinea = puntos.map((p, i) => `${x(i)},${y(p[serie.clave])}`).join(" ");
    const polilinea = document.createElementNS(svg.namespaceURI, "polyline");
    polilinea.setAttribute("points", puntosLinea);
    polilinea.setAttribute("fill", "none");
    polilinea.setAttribute("stroke", serie.color);
    polilinea.setAttribute("stroke-width", "2.5");
    polilinea.setAttribute("stroke-linecap", "round");
    polilinea.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polilinea);

    puntos.forEach((p, i) => {
      const cx = x(i);
      const cy = y(p[serie.clave]);

      const areaToque = document.createElementNS(svg.namespaceURI, "circle");
      areaToque.setAttribute("cx", String(cx));
      areaToque.setAttribute("cy", String(cy));
      areaToque.setAttribute("r", "11");
      areaToque.setAttribute("fill", "transparent");
      areaToque.style.cursor = "pointer";
      areaToque.addEventListener("click", (e) => {
        e.stopPropagation();
        mostrarTooltip(cx, cy, `${p.etiqueta} · ${serie.etiqueta}: ${formatearMonto(p[serie.clave])}`);
      });
      svg.appendChild(areaToque);

      const circulo = document.createElementNS(svg.namespaceURI, "circle");
      circulo.setAttribute("cx", String(cx));
      circulo.setAttribute("cy", String(cy));
      circulo.setAttribute("r", "3.5");
      circulo.setAttribute("fill", serie.color);
      circulo.style.pointerEvents = "none";
      svg.appendChild(circulo);
    });
  });

  wrapper.appendChild(svg);
  return wrapper;
}

function construirLeyendaSeries(series) {
  const fila = document.createElement("div");
  fila.style.cssText = "display:flex; gap:16px; flex-wrap:wrap; justify-content:center;";
  series.forEach((s) => {
    const item = document.createElement("div");
    item.style.cssText = "display:flex; align-items:center; gap:6px;";
    item.innerHTML = `
      <span style="width:10px; height:2.5px; border-radius:2px; background:${s.color};"></span>
      <span class="muted" style="font-size:0.78rem;">${s.etiqueta}</span>
    `;
    fila.appendChild(item);
  });
  return fila;
}

function construirSeccionLineaIngresosGastos(puntos) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Por semestre</h3>`;

  if (puntos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Todavía no hay semestres con movimiento financiero para graficar esto.";
    sec.appendChild(vacio);
    return sec;
  }

  // v2.9.2: se agrega la 3ra serie "Ingresos" (azul, ingresos propios) —
  // "ingreso" (verde) pasa a llamarse "Beca" para que quede claro que es
  // específicamente la beca y no se confunda con la serie nueva.
  const series = [
    { clave: "gasto", color: COLOR_GASTO, etiqueta: "Gastos" },
    { clave: "beca", color: COLOR_INGRESO, etiqueta: "Beca" },
    { clave: "ingresoPropio", color: COLOR_INGRESO_PROPIO, etiqueta: "Ingresos" },
  ];
  sec.appendChild(construirGraficaLinea(puntos, series));
  sec.appendChild(construirLeyendaSeries(series));
  return sec;
}

/* ===================== Ensamblado ===================== */

/**
 * Punto de entrada — llamado desde construirResumenFinanzas en finanzas.js,
 * debajo de los totales. Arma las 2 gráficas del Resumen (donut + línea
 * por semestre; el balance acumulado se sacó en v2.9.1).
 *
 * v2.9.2: se agrega el parámetro totalIngresos (entre totalBecas y
 * totalGastado) — ver calcularTotalesResumenFinanzas en finanzas.js.
 */
function construirGraficasResumenFinanzas(totalBecas, totalIngresos, totalGastado) {
  const cont = document.createElement("div");
  cont.className = "stack";

  cont.appendChild(construirSeccionDonut(totalBecas, totalIngresos, totalGastado));

  const puntosSerie = calcularSerieFinancieraPorSemestre();
  cont.appendChild(construirSeccionLineaIngresosGastos(puntosSerie));

  return cont;
}

export { construirGraficasResumenFinanzas };
