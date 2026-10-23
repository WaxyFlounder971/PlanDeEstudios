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

import { movimientosVigentes } from "../core/finanzas-derivados.js";
import { montoEfectivoMovimiento } from "../core/finanzas-modelo.js";
import { estado } from "../core/storage.js";
import { obtenerLocaleInterfaz, traducirTextoInterfaz } from "../core/i18n.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { formatearMonto, obtenerSimboloMonedaActual } from "./finanzas.js";

const COLOR_GASTO = "#ef4444"; // mismo rojo que badge-danger / segReprobados en semestres-dashboard.js
const COLOR_INGRESO = "#10b981"; // mismo verde que badge-success / segAprobados — beca
const COLOR_INGRESO_PROPIO = "#3b82f6"; // azul (2026-08-26, pedido explícito de Krys): ingresos propios, para diferenciarlos visualmente de la beca

/* ===================== Datos: serie por semestre ===================== */

/**
 * Serie cronológica de beca / ingresos propios / gasto por semestre, ordenada
 * por fecha_inicio ascendente, más un punto final "General" con los
 * movimientos SIN semestre.
 *
 * Finanzas 2.0 (0B): sale de `movimientos` (movimientosVigentes), no de
 * gastos_u/finanzas_semestre. Solo cuentan gastos e ingresos; ahorros y
 * transferencias no son ni lo uno ni lo otro. Un movimiento de un semestre
 * borrado no entra (igual que en los totales del Resumen). Solo aparecen
 * semestres con al menos un gasto o ingreso que ya cuente a hoy.
 */
function calcularSerieFinancieraPorSemestre() {
  const semestres = obtenerTodosLosSemestres()
    .slice()
    .sort((a, b) => (a.fecha_inicio || "").localeCompare(b.fecha_inicio || ""));
  const movs = movimientosVigentes(estado.datos).filter((m) => m.tipo === "gasto" || m.tipo === "ingreso");

  const sumar = (lista) => {
    let beca = 0, ingresoPropio = 0, gasto = 0;
    lista.forEach((m) => {
      const v = montoEfectivoMovimiento(m);
      if (m.tipo === "gasto") gasto += v;
      else if (m.origen === "beca") beca += v;
      else ingresoPropio += v;
    });
    return { beca, ingresoPropio, gasto };
  };

  const puntos = [];
  semestres.forEach((semestre) => {
    const delSemestre = movs.filter((m) => m.semestre_id === semestre.id);
    if (delSemestre.length) puntos.push({ etiqueta: semestre.nombre, ...sumar(delSemestre) });
  });
  const generales = movs.filter((m) => !m.semestre_id);
  if (generales.length) puntos.push({ etiqueta: "General", ...sumar(generales) });
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
 * Leyenda del donut (0C): marca + texto + monto real con signo. Los
 * porcentajes salen de la misma base que el arco; el monto de "Disponible"
 * se muestra negativo tal cual si hubo sobregasto. Nunca solo color: cada
 * fila lleva etiqueta y cifra.
 */
function construirLeyendaDonut(totalEntradas, totalGastado) {
  const base = Math.max(totalEntradas, totalGastado, 0);
  const disponible = totalEntradas - totalGastado;
  const pctGasto = base > 0 ? Math.round((Math.min(totalGastado, base) / base) * 100) : 0;

  const leyenda = document.createElement("div");
  leyenda.className = "stack";
  leyenda.style.cssText = "gap:10px; min-width:200px;";

  const fila = (clase, texto, pct, monto) => {
    const f = document.createElement("div");
    f.className = "resumen-leyenda-fila";
    const marca = document.createElement("span");
    marca.className = "resumen-leyenda-marca " + clase;
    const txt = document.createElement("span");
    txt.textContent = `${texto} · ${pct}%`;
    const m = document.createElement("strong");
    m.style.fontVariantNumeric = "tabular-nums";
    m.textContent = formatearMonto(monto);
    f.append(marca, txt, m);
    leyenda.appendChild(f);
  };
  fila("gasto", traducirTextoInterfaz("Gastado"), pctGasto, totalGastado);
  fila("disponible", traducirTextoInterfaz("Disponible"), base > 0 ? 100 - pctGasto : 0, disponible);
  return leyenda;
}

/** Beca vs. ingresos propios: dos cifras con etiqueta, en chips (sin innerHTML). */
function construirComposicionIngresos(totalBecas, totalIngresos) {
  const fila = document.createElement("div");
  fila.className = "resumen-hero-desglose";
  const chip = (clase, etiqueta, monto) => {
    const c = document.createElement("span");
    c.className = "badge " + clase;
    c.textContent = `${etiqueta}: ${formatearMonto(monto)}`;
    return c;
  };
  fila.appendChild(chip("badge-success", traducirTextoInterfaz("Beca"), totalBecas));
  fila.appendChild(chip("badge-info", traducirTextoInterfaz("Ingresos"), totalIngresos));
  return fila;
}

/**
 * Donut del Resumen (0C): el disponible va dentro del anillo, la leyenda al
 * lado, y la composición de entradas debajo. El balance total ahora vive en
 * la tarjeta principal del Resumen (finanzas.js), no se repite acá.
 */
function construirSeccionDonut(totalBecas, totalIngresos, totalGastado) {
  const totalEntradas = totalBecas + totalIngresos;
  const disponible = totalEntradas - totalGastado;

  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  const h = document.createElement("h3");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = traducirTextoInterfaz("Gastado vs. disponible");
  sec.appendChild(h);

  const fila = document.createElement("div");
  fila.className = "resumen-donut-fila";

  const caja = document.createElement("div");
  caja.className = "resumen-donut";
  const donut = construirDonutGastadoVsDisponible(totalEntradas, totalGastado);
  const svg = donut.querySelector("svg");
  svg.setAttribute("width", "156");
  svg.setAttribute("height", "156");
  svg.style.cssText = "width:156px; height:156px;";
  const centro = document.createElement("div");
  centro.className = "resumen-donut-centro";
  const cifra = document.createElement("strong");
  cifra.textContent = formatearMonto(disponible);
  const rotulo = document.createElement("span");
  rotulo.textContent = disponible >= 0 ? traducirTextoInterfaz("Disponible") : traducirTextoInterfaz("Sobregasto");
  centro.append(cifra, rotulo);
  caja.append(svg, centro);

  fila.append(caja, construirLeyendaDonut(totalEntradas, totalGastado));
  sec.appendChild(fila);
  sec.appendChild(construirComposicionIngresos(totalBecas, totalIngresos));
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
    { clave: "gasto", color: COLOR_GASTO, etiqueta: traducirTextoInterfaz("Gastos") },
    { clave: "beca", color: COLOR_INGRESO, etiqueta: traducirTextoInterfaz("Beca") },
    { clave: "ingresoPropio", color: COLOR_INGRESO_PROPIO, etiqueta: traducirTextoInterfaz("Ingresos") },
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
