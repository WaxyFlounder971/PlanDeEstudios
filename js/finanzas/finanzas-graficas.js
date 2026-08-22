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
import { formatearMonto } from "./finanzas.js";

const COLOR_GASTO = "#ef4444"; // mismo rojo que badge-danger / segReprobados en semestres-dashboard.js
const COLOR_INGRESO = "#10b981"; // mismo verde que badge-success / segAprobados

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
 * Serie cronológica de ingreso (beca) / gasto (matrícula + gastos_u
 * vinculados) por semestre, ordenada por fecha_inicio ascendente, más un
 * punto final "General" que agrupa los gastos_u SIN semestre_id (carné,
 * seguro, recurrentes generales) — decisión confirmada: no se descartan,
 * se agrupan aparte al final del eje X en vez de perderse.
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

    const ingreso = registro ? Number(registro.beca_monto) || 0 : 0;
    let gasto = registro ? Number(registro.costo_matricula) || 0 : 0;
    gastosVinculados.forEach((g) => (gasto += costoDeGastoUAlaFecha(g)));

    puntos.push({ etiqueta: semestre.nombre, ingreso, gasto });
  });

  const gastosSinSemestre = gastosU.filter((g) => !g.semestre_id);
  if (gastosSinSemestre.length > 0) {
    const gastoGeneral = gastosSinSemestre.reduce((acc, g) => acc + costoDeGastoUAlaFecha(g), 0);
    puntos.push({ etiqueta: "General", ingreso: 0, gasto: gastoGeneral });
  }

  return puntos;
}

/* ===================== Donut: Resumen (beca vs. gastado) ===================== */

/**
 * Donut de 2 segmentos con stroke-dasharray sobre un círculo — reutiliza
 * .donut-bloque de design-system.css para el contenedor. v2.9.1: sin texto
 * adentro (ni %, ni "cubierto con beca") y sin etiqueta debajo — el círculo
 * queda solo, el detalle (porcentaje/monto) vive en la leyenda de al lado.
 */
function construirDonutBecaVsGastado(totalBecas, totalGastado) {
  const total = totalBecas + totalGastado;
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

  if (total > 0) {
    const largoBeca = (totalBecas / total) * CIRC;
    const largoGastado = (totalGastado / total) * CIRC;

    const arcoBeca = document.createElementNS(svg.namespaceURI, "circle");
    arcoBeca.setAttribute("cx", "70");
    arcoBeca.setAttribute("cy", "70");
    arcoBeca.setAttribute("r", String(RADIO));
    arcoBeca.setAttribute("fill", "none");
    arcoBeca.setAttribute("stroke", COLOR_INGRESO);
    arcoBeca.setAttribute("stroke-width", String(GROSOR));
    arcoBeca.setAttribute("stroke-dasharray", `${largoBeca} ${CIRC - largoBeca}`);
    arcoBeca.setAttribute("transform", "rotate(-90 70 70)");
    svg.appendChild(arcoBeca);

    const arcoGastado = document.createElementNS(svg.namespaceURI, "circle");
    arcoGastado.setAttribute("cx", "70");
    arcoGastado.setAttribute("cy", "70");
    arcoGastado.setAttribute("r", String(RADIO));
    arcoGastado.setAttribute("fill", "none");
    arcoGastado.setAttribute("stroke", COLOR_GASTO);
    arcoGastado.setAttribute("stroke-width", String(GROSOR));
    arcoGastado.setAttribute("stroke-dasharray", `${largoGastado} ${CIRC - largoGastado}`);
    arcoGastado.setAttribute("stroke-dashoffset", String(-largoBeca));
    arcoGastado.setAttribute("transform", "rotate(-90 70 70)");
    svg.appendChild(arcoGastado);
  }

  bloque.appendChild(svg);
  return bloque;
}

/**
 * Leyenda en grid de 3 columnas (porcentaje / etiqueta / monto) para que
 * las 2 filas queden perfectamente alineadas dato-con-dato en vertical —
 * pedido explícito ("todo parejito"). Porcentaje coloreado según la serie
 * (verde beca, rojo gasto).
 */
function construirLeyendaDonut(totalBecas, totalGastado) {
  const total = totalBecas + totalGastado;
  const pctBeca = total > 0 ? Math.round((totalBecas / total) * 100) : 0;
  const pctGasto = total > 0 ? Math.round((totalGastado / total) * 100) : 0;

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

  construirFila(COLOR_INGRESO, pctBeca, "Beca recibida", totalBecas);
  construirFila(COLOR_GASTO, pctGasto, "Dinero invertido", totalGastado);

  return leyenda;
}

/** Balance total (beca − gastado), centrado debajo de la gráfica: verde si es >= 0, rojo si es negativo. */
function construirBalanceTotal(balanceNeto) {
  const el = document.createElement("div");
  el.style.cssText = "text-align:center;";
  const color = balanceNeto >= 0 ? COLOR_INGRESO : COLOR_GASTO;
  el.innerHTML = `<span class="muted" style="font-size:0.85rem;">Balance total: </span><span style="font-weight:800; font-size:1rem; color:${color};">${formatearMonto(balanceNeto)}</span>`;
  return el;
}

/**
 * v2.9.1: título cambiado de "Beca vs. gastado" a "Resumen" (pedido
 * explícito) — este bloque reemplaza al viejo resumen de texto plano
 * (Total gastado / Balance neto) que vivía en finanzas.js. Gráfica a la
 * izquierda, texto a la derecha si hay espacio horizontal; si no, se
 * apilan (flex-wrap). El balance total va centrado debajo de todo.
 */
function construirSeccionDonut(totalBecas, totalGastado) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Resumen</h3>`;

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex; align-items:center; justify-content:center; gap:28px; flex-wrap:wrap;";
  fila.appendChild(construirDonutBecaVsGastado(totalBecas, totalGastado));
  fila.appendChild(construirLeyendaDonut(totalBecas, totalGastado));
  sec.appendChild(fila);

  sec.appendChild(construirBalanceTotal(totalBecas - totalGastado));

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

/** "₡" + número abreviado (k/M) para que las etiquetas del eje Y no se amontonen. */
function formatearMontoCompacto(numero) {
  const n = Number(numero) || 0;
  const signo = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  if (abs >= 1000000) return `${signo}₡${(abs / 1000000).toFixed(abs % 1000000 === 0 ? 0 : 1)}M`;
  if (abs >= 1000) return `${signo}₡${(abs / 1000).toFixed(abs % 1000 === 0 ? 0 : 1)}k`;
  return `${signo}₡${abs.toFixed(0)}`;
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

  const series = [
    { clave: "gasto", color: COLOR_GASTO, etiqueta: "Gastos" },
    { clave: "ingreso", color: COLOR_INGRESO, etiqueta: "Ingresos" },
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
 */
function construirGraficasResumenFinanzas(totalBecas, totalGastado) {
  const cont = document.createElement("div");
  cont.className = "stack";

  cont.appendChild(construirSeccionDonut(totalBecas, totalGastado));

  const puntosSerie = calcularSerieFinancieraPorSemestre();
  cont.appendChild(construirSeccionLineaIngresosGastos(puntosSerie));

  return cont;
}

export { construirGraficasResumenFinanzas };
