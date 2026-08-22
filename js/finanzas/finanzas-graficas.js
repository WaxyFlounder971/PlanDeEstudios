/* =========================================================================
   FINANZAS — Gráficas del Resumen (2026-08-22)
   3 visualizaciones para la pestaña Resumen, todas en SVG a mano — no hay
   ninguna librería de gráficos en el proyecto (se revisó todo antes de
   arrancar), y ya existe precedente de donuts hechos así mismo (ver
   .donut-bloque en design-system.css), así que se sigue ese mismo criterio
   en vez de traer una dependencia nueva.

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
const COLOR_BALANCE = "#818cf8"; // acento neutro — el balance acumulado no es ni gasto ni ingreso puro

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

/** Balance acumulado (ingreso − gasto corriendo) sobre la misma serie de arriba. */
function calcularSerieBalanceAcumulado(puntos) {
  let acumulado = 0;
  return puntos.map((p) => {
    acumulado += p.ingreso - p.gasto;
    return { etiqueta: p.etiqueta, balance: acumulado };
  });
}

/* ===================== Donut: beca vs. gastado ===================== */

/**
 * Donut de 2 segmentos con stroke-dasharray sobre un círculo — reutiliza
 * .donut-bloque/.donut-etiqueta de design-system.css (ya definidas para
 * esto, aunque hoy no las use ningún otro archivo).
 */
function construirDonutBecaVsGastado(totalBecas, totalGastado) {
  const total = totalBecas + totalGastado;
  const bloque = document.createElement("div");
  bloque.className = "donut-bloque";

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

  const textoCentro = document.createElementNS(svg.namespaceURI, "text");
  textoCentro.setAttribute("x", "70");
  textoCentro.setAttribute("y", "76");
  textoCentro.setAttribute("text-anchor", "middle");
  textoCentro.setAttribute("font-size", "22");
  textoCentro.setAttribute("font-weight", "800");
  textoCentro.setAttribute("fill", "var(--text-primary)");
  textoCentro.textContent = total > 0 ? `${Math.round((totalBecas / total) * 100)}%` : "—";
  svg.appendChild(textoCentro);

  const subTextoCentro = document.createElementNS(svg.namespaceURI, "text");
  subTextoCentro.setAttribute("x", "70");
  subTextoCentro.setAttribute("y", "92");
  subTextoCentro.setAttribute("text-anchor", "middle");
  subTextoCentro.setAttribute("font-size", "9");
  subTextoCentro.setAttribute("fill", "var(--text-muted)");
  subTextoCentro.textContent = "cubierto con beca";
  svg.appendChild(subTextoCentro);

  bloque.appendChild(svg);

  const etiqueta = document.createElement("div");
  etiqueta.className = "donut-etiqueta";
  etiqueta.textContent = "Beca vs. gastado";
  bloque.appendChild(etiqueta);

  return bloque;
}

function construirLeyendaDonut(totalBecas, totalGastado) {
  const leyenda = document.createElement("div");
  leyenda.className = "stack";
  leyenda.style.cssText = "gap:8px; justify-content:center;";

  const construirItem = (color, texto, monto) => {
    const fila = document.createElement("div");
    fila.className = "row";
    fila.style.cssText = "gap:8px; align-items:center;";
    fila.innerHTML = `
      <span style="width:10px; height:10px; border-radius:50%; background:${color}; flex-shrink:0;"></span>
      <span style="font-size:0.82rem;">${texto}</span>
      <span style="font-size:0.82rem; font-weight:700; margin-left:auto;">${formatearMonto(monto)}</span>
    `;
    return fila;
  };

  leyenda.appendChild(construirItem(COLOR_INGRESO, "Becas recibidas", totalBecas));
  leyenda.appendChild(construirItem(COLOR_GASTO, "Total gastado", totalGastado));
  return leyenda;
}

function construirSeccionDonut(totalBecas, totalGastado) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">🍩 Beca vs. gastado</h3>`;

  const fila = document.createElement("div");
  fila.style.cssText = "display:flex; align-items:center; justify-content:center; gap:24px; flex-wrap:wrap;";
  fila.appendChild(construirDonutBecaVsGastado(totalBecas, totalGastado));
  fila.appendChild(construirLeyendaDonut(totalBecas, totalGastado));
  sec.appendChild(fila);

  return sec;
}

/* ===================== Línea genérica (reutilizada por las 2 de abajo) ===================== */

const ALTO_GRAFICA = 160;
const ANCHO_POR_PUNTO = 76; // separación mínima entre puntos — si no caben, scroll horizontal
const PADDING_SUP = 16;
const PADDING_INF = 40; // espacio para las etiquetas del eje X, rotadas -35°

/**
 * Gráfica de línea genérica: recibe `puntos` (cada uno con `etiqueta` + un
 * valor por serie) y `series` (qué campo/color/nombre dibujar). La usan
 * tanto "Ingresos vs. gastos" (2 series) como "Balance acumulado" (1 serie).
 */
function construirGraficaLinea(puntos, series) {
  const n = puntos.length;
  const ancho = Math.max(260, n * ANCHO_POR_PUNTO);
  const altoUtil = ALTO_GRAFICA - PADDING_SUP - PADDING_INF;

  const todosLosValores = puntos.flatMap((p) => series.map((s) => p[s.clave]));
  const valorMax = Math.max(0, ...todosLosValores);
  const valorMin = Math.min(0, ...todosLosValores);
  const rango = valorMax - valorMin || 1;

  const x = (i) => (n === 1 ? ancho / 2 : (i / (n - 1)) * (ancho - 40) + 20);
  const y = (valor) => PADDING_SUP + altoUtil - ((valor - valorMin) / rango) * altoUtil;

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${ancho} ${ALTO_GRAFICA}`);
  svg.setAttribute("width", String(ancho));
  svg.setAttribute("height", String(ALTO_GRAFICA));
  svg.style.display = "block";

  // Línea base en y=0 — sobre todo útil en Balance acumulado, que puede ir negativo.
  if (valorMin < 0 && valorMax > 0) {
    const linea0 = document.createElementNS(svg.namespaceURI, "line");
    linea0.setAttribute("x1", "0");
    linea0.setAttribute("x2", String(ancho));
    linea0.setAttribute("y1", String(y(0)));
    linea0.setAttribute("y2", String(y(0)));
    linea0.setAttribute("stroke", "var(--border-glass)");
    linea0.setAttribute("stroke-width", "1");
    linea0.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(linea0);
  }

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
      const circulo = document.createElementNS(svg.namespaceURI, "circle");
      circulo.setAttribute("cx", String(x(i)));
      circulo.setAttribute("cy", String(y(p[serie.clave])));
      circulo.setAttribute("r", "3.5");
      circulo.setAttribute("fill", serie.color);
      const titulo = document.createElementNS(svg.namespaceURI, "title");
      titulo.textContent = `${p.etiqueta} · ${serie.etiqueta}: ${formatearMonto(p[serie.clave])}`;
      circulo.appendChild(titulo);
      svg.appendChild(circulo);
    });
  });

  puntos.forEach((p, i) => {
    const texto = document.createElementNS(svg.namespaceURI, "text");
    texto.setAttribute("x", String(x(i)));
    texto.setAttribute("y", String(ALTO_GRAFICA - PADDING_INF + 14));
    texto.setAttribute("text-anchor", "end");
    texto.setAttribute("font-size", "10");
    texto.setAttribute("fill", "var(--text-muted)");
    texto.setAttribute("transform", `rotate(-35 ${x(i)} ${ALTO_GRAFICA - PADDING_INF + 14})`);
    texto.textContent = p.etiqueta;
    svg.appendChild(texto);
  });

  const envoltorioScroll = document.createElement("div");
  envoltorioScroll.style.cssText = "overflow-x:auto; overflow-y:hidden;";
  envoltorioScroll.appendChild(svg);
  return envoltorioScroll;
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

/* ===================== Línea: ingresos vs. gastos por semestre ===================== */

function construirSeccionLineaIngresosGastos(puntos) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">📈 Ingresos vs. gastos por semestre</h3>`;

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

/* ===================== Línea: balance acumulado (propuesta, 3ra gráfica) ===================== */

/**
 * Cómo se va acumulando el balance (beca − gasto) semestre a semestre, en
 * vez del balance total único que ya se ve arriba en el Resumen — misma
 * serie de datos que la gráfica anterior, sin ningún campo nuevo en el
 * modelo de datos.
 */
function construirSeccionBalanceAcumulado(puntos) {
  const serieBalance = calcularSerieBalanceAcumulado(puntos);
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">📉 Balance acumulado</h3>`;

  if (serieBalance.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Todavía no hay semestres con movimiento financiero para graficar esto.";
    sec.appendChild(vacio);
    return sec;
  }

  const ultimo = serieBalance[serieBalance.length - 1];
  const nota = document.createElement("p");
  nota.className = "muted";
  nota.style.margin = "0";
  nota.textContent = `Cómo se fue acumulando el balance (beca − gasto) semestre a semestre. Hoy: ${formatearMonto(ultimo.balance)}.`;
  sec.appendChild(nota);

  sec.appendChild(construirGraficaLinea(serieBalance, [{ clave: "balance", color: COLOR_BALANCE, etiqueta: "Balance acumulado" }]));
  return sec;
}

/* ===================== Ensamblado ===================== */

/**
 * Punto de entrada — llamado desde construirResumenFinanzas en finanzas.js,
 * debajo de los totales. Arma las 3 gráficas del Resumen.
 */
function construirGraficasResumenFinanzas(totalBecas, totalGastado) {
  const cont = document.createElement("div");
  cont.className = "stack";

  cont.appendChild(construirSeccionDonut(totalBecas, totalGastado));

  const puntosSerie = calcularSerieFinancieraPorSemestre();
  cont.appendChild(construirSeccionLineaIngresosGastos(puntosSerie));
  cont.appendChild(construirSeccionBalanceAcumulado(puntosSerie));

  return cont;
}

export { construirGraficasResumenFinanzas };
