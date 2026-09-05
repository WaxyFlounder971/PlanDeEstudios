/* =========================================================================
   TIEMPO DE ESTUDIO — Estadísticas (Parte 3, punto 2)
   2 visualizaciones, mismo lenguaje visual que finanzas/finanzas-graficas.js
   (SVG a mano, sin librería — se miró ese archivo como referencia antes de
   escribir esto, no se importa directo porque su lógica es 100% específica
   de Finanzas):
     1) Donut "Horas por proyecto" (= por materia) del corte elegido
        (Día/Semana/Semestre, con navegación </> en semana y semestre, o
        selector de fecha puntual en día) + lista debajo con una barra por
        materia normalizada contra la más grande.
     2) Gráfica de barras con su propio pill (Semana/Semestre, sin Día — no
        tiene sentido una tendencia de un solo día): en semana, eje X = los
        7 días de esa semana; en semestre, eje X = los meses de ese
        semestre (una barra por semana sería ilegible en un semestre
        entero). Valor = minutos totales estudiados ESE día/mes, sumando
        todas las materias — a diferencia del donut, acá no se separa por
        materia (el plan no lo pedía y una gráfica apilada de 6+ materias
        por 7 días deja de ser legible).

   A propósito NO restringido a obtenerSemestresActuales(): una sesión
   vieja de un semestre que ya no es "actual" tiene que poder seguir
   viéndose acá (mismo criterio que finanzas-graficas.js, que sí mira TODOS
   los semestres vía obtenerTodosLosSemestres) — por eso resolverInfoMateria
   y el navegador de semestre recorren estado.datos.semestres completo, no
   el resultado de obtenerSemestresActuales() que usa el resto del archivo
   hermano tiempo-estudio.js.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { COLOR_TIEMPO_ESTUDIO_DEFAULT } from "../core/schema.js";

const NS = "http://www.w3.org/2000/svg";
const COLOR_BARRA_TOTAL = COLOR_TIEMPO_ESTUDIO_DEFAULT;

/* ===================== Estado de la vista (pills + navegación) =====================
   Módulo-nivel, igual que materiaDetalleActivaId en tiempo-estudio.js — se
   mantiene mientras la app sigue abierta, no se persiste ni sincroniza
   (es solo "qué estás mirando ahora", no un dato real). */

let corteDonut = "semana"; // "dia" | "semana" | "semestre"
let offsetSemanaDonut = 0; // 0 = semana actual, -1 = anterior, +1 = siguiente
let fechaDiaDonut = null; // "YYYY-MM-DD", se inicializa a hoy la primera vez
let indiceSemestreDonut = null; // índice dentro de obtenerTodosLosSemestresOrdenados()

let corteBarras = "semana"; // "semana" | "semestre"
let offsetSemanaBarras = 0;
let indiceSemestreBarras = null;

/* ===================== Helpers de datos (duplicados a propósito) =====================
   buscarMateriaMatriculada/obtenerPlanPorId equivalentes ya existen en
   tiempo-estudio.js y tiempo-estudio-timer.js — se duplican acá (recorridos
   simples de 1-2 líneas) para no crear un import circular de 3 puntas
   entre este archivo, tiempo-estudio.js y tiempo-estudio-timer.js. */

function obtenerTodosLosSemestresOrdenados() {
  return (estado.datos.semestres || []).slice().sort((a, b) => (a.fecha_inicio || "").localeCompare(b.fecha_inicio || ""));
}

/** Índice del semestre "vigente" dentro de la lista ordenada: el último
 * cuyo fecha_inicio ya llegó — si ninguno arrancó todavía, el primero. */
function obtenerIndiceSemestreVigente(lista) {
  if (lista.length === 0) return -1;
  const hoyStr = new Date().toISOString().slice(0, 10);
  let idx = 0;
  lista.forEach((s, i) => {
    if ((s.fecha_inicio || "") <= hoyStr) idx = i;
  });
  return idx;
}

/** Busca la materia matriculada en TODOS los semestres (no solo actuales) y
 * resuelve nombre corto + color efectivo — mismo criterio de color que
 * obtenerColorMateria() en tiempo-estudio.js (propio > categoría > default).
 * Si la matrícula, el plan o la materia ya no existen (borrados), cae a un
 * fallback en vez de romper el render — las sesiones viejas no desaparecen
 * solo porque su materia ya no está. */
function resolverInfoMateria(materiaMatriculadaId) {
  for (const semestre of estado.datos.semestres || []) {
    const mm = (semestre.materias_matriculadas || []).find((m) => m.id === materiaMatriculadaId);
    if (!mm) continue;
    const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    if (!plan || !materia) return { nombreCorto: "Materia eliminada", color: COLOR_TIEMPO_ESTUDIO_DEFAULT };
    const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
    const color = mm.tiempo_estudio.color || (categoria && categoria.color) || COLOR_TIEMPO_ESTUDIO_DEFAULT;
    return { nombreCorto: aplicarFormatoTexto(materia.nombre), color };
  }
  return { nombreCorto: "Materia eliminada", color: COLOR_TIEMPO_ESTUDIO_DEFAULT };
}

function formatearMinutos(minutosTotales) {
  const totales = Math.max(0, Math.round(minutosTotales));
  const h = Math.floor(totales / 60);
  const m = totales % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/* ===================== Rangos de fecha por corte ===================== */

function obtenerRangoDia(fechaStr) {
  const [y, mo, d] = fechaStr.split("-").map(Number);
  return { inicio: new Date(y, mo - 1, d, 0, 0, 0, 0).getTime(), fin: new Date(y, mo - 1, d + 1, 0, 0, 0, 0).getTime() };
}

function obtenerRangoSemana(offsetSemanas) {
  const ahora = new Date();
  const diasDesdeLunes = (ahora.getDay() + 6) % 7;
  const lunesActual = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes, 0, 0, 0, 0);
  const lunes = new Date(lunesActual.getFullYear(), lunesActual.getMonth(), lunesActual.getDate() + offsetSemanas * 7, 0, 0, 0, 0);
  const domingoSiguiente = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7, 0, 0, 0, 0);
  return { inicio: lunes.getTime(), fin: domingoSiguiente.getTime(), lunes };
}

function obtenerRangoSemestre(semestre) {
  const inicio = new Date(`${semestre.fecha_inicio}T00:00:00`).getTime();
  const fin = new Date(`${semestre.fecha_fin}T23:59:59`).getTime() + 1;
  return { inicio, fin };
}

/* ===================== Agregación: minutos por materia en un rango ===================== */

function calcularMinutosPorMateriaEnRango(inicio, fin) {
  const mapa = new Map();
  (estado.datos.sesiones_estudio || []).forEach((s) => {
    if (s.inicio < inicio || s.inicio >= fin) return;
    mapa.set(s.materia_matriculada_id, (mapa.get(s.materia_matriculada_id) || 0) + (Number(s.duracion_minutos) || 0));
  });
  return mapa;
}

function calcularMinutosTotalesEnRango(inicio, fin) {
  return (estado.datos.sesiones_estudio || []).reduce((acc, s) => (s.inicio >= inicio && s.inicio < fin ? acc + (Number(s.duracion_minutos) || 0) : acc), 0);
}

/* ===================== Donut multi-segmento (N materias) =====================
   finanzas-graficas.js solo dibuja 2 segmentos (gastado/disponible) — acá
   se generaliza el mismo truco de stroke-dasharray + stroke-dashoffset
   acumulado a cualquier cantidad de segmentos. */

function construirDonutHorasPorMateria(segmentos) {
  const total = segmentos.reduce((acc, s) => acc + s.minutos, 0);
  const RADIO = 54;
  const GROSOR = 16;
  const CIRC = 2 * Math.PI * RADIO;

  const bloque = document.createElement("div");
  bloque.className = "donut-bloque";
  bloque.style.flexShrink = "0";

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 140 140");
  svg.setAttribute("width", "140");
  svg.setAttribute("height", "140");

  const pista = document.createElementNS(NS, "circle");
  pista.setAttribute("cx", "70");
  pista.setAttribute("cy", "70");
  pista.setAttribute("r", String(RADIO));
  pista.setAttribute("fill", "none");
  pista.setAttribute("stroke", "var(--border-glass)");
  pista.setAttribute("stroke-width", String(GROSOR));
  svg.appendChild(pista);

  if (total > 0) {
    let acumulado = 0;
    segmentos.forEach((seg) => {
      if (seg.minutos <= 0) return;
      const largo = (seg.minutos / total) * CIRC;
      const arco = document.createElementNS(NS, "circle");
      arco.setAttribute("cx", "70");
      arco.setAttribute("cy", "70");
      arco.setAttribute("r", String(RADIO));
      arco.setAttribute("fill", "none");
      arco.setAttribute("stroke", seg.color);
      arco.setAttribute("stroke-width", String(GROSOR));
      arco.setAttribute("stroke-dasharray", `${largo} ${CIRC - largo}`);
      arco.setAttribute("stroke-dashoffset", String(-acumulado));
      arco.setAttribute("transform", "rotate(-90 70 70)");
      svg.appendChild(arco);
      acumulado += largo;
    });
  }

  bloque.appendChild(svg);
  return bloque;
}

/** Fila por materia debajo del donut: barra a ancho completo normalizada
 * contra la materia con más minutos de este corte (esa llega al 100%), con
 * las horas ancladas a la derecha al mismo nivel — pedido explícito: "no
 * tanto de tanto, si no solo tanto" (sin meta de por medio, a diferencia de
 * la barra de la tarjeta principal). */
function construirListaHorasPorMateria(segmentos) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "10px";

  if (segmentos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Sin sesiones de estudio en este período.";
    cont.appendChild(vacio);
    return cont;
  }

  const maxMinutos = Math.max(0, ...segmentos.map((s) => s.minutos));
  segmentos.forEach((seg) => {
    const porcentaje = maxMinutos > 0 ? (seg.minutos / maxMinutos) * 100 : 0;
    const fila = document.createElement("div");
    fila.className = "stack";
    fila.style.gap = "4px";
    fila.innerHTML = `
      <div class="row-between" style="align-items:center; gap:8px;">
        <span style="font-size:0.85rem;">${seg.nombreCorto}</span>
        <span style="font-size:0.85rem; font-weight:700; font-variant-numeric:tabular-nums; white-space:nowrap;">${formatearMinutos(seg.minutos)}</span>
      </div>
      <div class="te-barra-progreso">
        <div class="te-barra-progreso-fill" style="width:${porcentaje}%; background:${seg.color};"></div>
      </div>
    `;
    cont.appendChild(fila);
  });
  return cont;
}

/* ===================== Gráfica de barras (trend agregado) ===================== */

const VB_ANCHO = 640;
const VB_ALTO = 220;
const MARGEN_IZQ = 46;
const MARGEN_DER = 14;
const MARGEN_SUP = 16;
const MARGEN_INF = 34;

/** Mismo algoritmo de "nice numbers" que finanzas-graficas.js
 * (calcularEscalaAgradable) — redondea el paso del eje Y al 1/2/5×10^n más
 * cercano en vez de cortes feos. Acá trabaja sobre minutos en vez de
 * montos. */
function calcularEscalaAgradable(valorMax) {
  if (valorMax <= 0) return { max: 60, paso: 15 };
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

/** `puntos`: [{ etiqueta, minutos }]. Barras de un solo color (violeta,
 * agregado de todas las materias) — a diferencia del donut, esta gráfica
 * no separa por materia (ver nota de cabecera). */
function construirGraficaBarras(puntos) {
  const n = puntos.length;
  const anchoUtil = VB_ANCHO - MARGEN_IZQ - MARGEN_DER;
  const altoUtil = VB_ALTO - MARGEN_SUP - MARGEN_INF;

  const valorMaxCrudo = Math.max(0, ...puntos.map((p) => p.minutos));
  const { max: valorMax, paso } = calcularEscalaAgradable(valorMaxCrudo);

  const x = (i) => MARGEN_IZQ + (anchoUtil / n) * (i + 0.5);
  const y = (valor) => MARGEN_SUP + altoUtil - (valor / valorMax) * altoUtil;
  const anchoBarra = Math.min(38, (anchoUtil / n) * 0.55);

  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${VB_ANCHO} ${VB_ALTO}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
  svg.style.cssText = "display:block; width:100%; height:auto;";

  // ----- Eje Y: líneas guía + etiquetas en pasos redondos -----
  const cantidadPasos = Math.round(valorMax / paso) || 1;
  for (let paso_i = 0; paso_i <= cantidadPasos; paso_i++) {
    const valor = paso_i * paso;
    const yPos = y(valor);

    const grid = document.createElementNS(NS, "line");
    grid.setAttribute("x1", String(MARGEN_IZQ));
    grid.setAttribute("x2", String(VB_ANCHO - MARGEN_DER));
    grid.setAttribute("y1", String(yPos));
    grid.setAttribute("y2", String(yPos));
    grid.setAttribute("stroke", "var(--border-glass)");
    grid.setAttribute("stroke-width", "1");
    if (paso_i !== 0) grid.setAttribute("stroke-dasharray", "3 3");
    svg.appendChild(grid);

    const etiquetaY = document.createElementNS(NS, "text");
    etiquetaY.setAttribute("x", String(MARGEN_IZQ - 8));
    etiquetaY.setAttribute("y", String(yPos + 3));
    etiquetaY.setAttribute("text-anchor", "end");
    etiquetaY.setAttribute("font-size", "9.5");
    etiquetaY.setAttribute("fill", "var(--text-muted)");
    etiquetaY.textContent = formatearMinutos(valor);
    svg.appendChild(etiquetaY);
  }

  // ----- Barras + etiqueta del eje X (sin rotar: "Lun"/"Ene" son cortas) -----
  puntos.forEach((p, i) => {
    const alturaBarra = (p.minutos / valorMax) * altoUtil;
    const barra = document.createElementNS(NS, "rect");
    barra.setAttribute("x", String(x(i) - anchoBarra / 2));
    barra.setAttribute("y", String(y(p.minutos)));
    barra.setAttribute("width", String(anchoBarra));
    barra.setAttribute("height", String(Math.max(0, alturaBarra)));
    barra.setAttribute("rx", "3");
    barra.setAttribute("fill", COLOR_BARRA_TOTAL);
    svg.appendChild(barra);

    const etiquetaX = document.createElementNS(NS, "text");
    etiquetaX.setAttribute("x", String(x(i)));
    etiquetaX.setAttribute("y", String(VB_ALTO - MARGEN_INF + 16));
    etiquetaX.setAttribute("text-anchor", "middle");
    etiquetaX.setAttribute("font-size", "10");
    etiquetaX.setAttribute("fill", "var(--text-muted)");
    etiquetaX.textContent = p.etiqueta;
    svg.appendChild(etiquetaX);
  });

  // ----- Eje X: línea base -----
  const ejeX = document.createElementNS(NS, "line");
  ejeX.setAttribute("x1", String(MARGEN_IZQ));
  ejeX.setAttribute("x2", String(VB_ANCHO - MARGEN_DER));
  ejeX.setAttribute("y1", String(y(0)));
  ejeX.setAttribute("y2", String(y(0)));
  ejeX.setAttribute("stroke", "var(--text-muted)");
  ejeX.setAttribute("stroke-width", "1.2");
  svg.appendChild(ejeX);

  return svg;
}

/* ===================== Controles: pills + navegador </> ===================== */

function construirPillGroup(opciones, valorActual, onCambiar) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.width = "100%";
  opciones.forEach(({ valor, etiqueta }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valorActual === valor ? " active" : "");
    btn.textContent = etiqueta;
    btn.addEventListener("click", () => onCambiar(valor));
    grupo.appendChild(btn);
  });
  return grupo;
}

/** Fila "< etiqueta >" reusada por semana y semestre, tanto en el donut
 * como en la gráfica de barras. */
function construirNavegadorPeriodo(etiqueta, onAnterior, onSiguiente, deshabilitarSiguiente) {
  const fila = document.createElement("div");
  fila.className = "row-between";
  fila.style.cssText = "align-items:center; gap:10px;";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "te-btn-icono te-btn-icono-fantasma";
  btnAnterior.textContent = "‹";
  btnAnterior.setAttribute("aria-label", "Período anterior");
  btnAnterior.addEventListener("click", onAnterior);

  const texto = document.createElement("span");
  texto.style.cssText = "font-weight:700; font-size:0.9rem; text-align:center; flex:1;";
  texto.textContent = etiqueta;

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "te-btn-icono te-btn-icono-fantasma";
  btnSiguiente.textContent = "›";
  btnSiguiente.setAttribute("aria-label", "Período siguiente");
  btnSiguiente.disabled = Boolean(deshabilitarSiguiente);
  btnSiguiente.style.opacity = deshabilitarSiguiente ? "0.4" : "1";
  btnSiguiente.addEventListener("click", onSiguiente);

  fila.appendChild(btnAnterior);
  fila.appendChild(texto);
  fila.appendChild(btnSiguiente);
  return fila;
}

const NOMBRES_MES_CORTO = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
const NOMBRES_DIA_CORTO = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function etiquetaRangoSemana(lunes) {
  const domingo = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 6);
  const fmt = (d) => `${d.getDate()} ${NOMBRES_MES_CORTO[d.getMonth()]}`;
  return `${fmt(lunes)} – ${fmt(domingo)}`;
}

/* ===================== Sección 1: donut "Horas por proyecto" ===================== */

function construirSeccionDonut(cont, refrescar) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.style.gap = "14px";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Horas por proyecto</h3>`;

  sec.appendChild(
    construirPillGroup(
      [
        { valor: "dia", etiqueta: "Día" },
        { valor: "semana", etiqueta: "Semana" },
        { valor: "semestre", etiqueta: "Semestre" },
      ],
      corteDonut,
      (valor) => {
        corteDonut = valor;
        refrescar();
      }
    )
  );

  const semestres = obtenerTodosLosSemestresOrdenados();
  if (indiceSemestreDonut === null) indiceSemestreDonut = obtenerIndiceSemestreVigente(semestres);
  if (!fechaDiaDonut) fechaDiaDonut = new Date().toISOString().slice(0, 10);

  let inicio, fin;

  if (corteDonut === "dia") {
    const inputFecha = document.createElement("input");
    inputFecha.type = "date";
    inputFecha.className = "form-input";
    inputFecha.value = fechaDiaDonut;
    inputFecha.addEventListener("change", () => {
      fechaDiaDonut = inputFecha.value || fechaDiaDonut;
      refrescar();
    });
    sec.appendChild(inputFecha);
    ({ inicio, fin } = obtenerRangoDia(fechaDiaDonut));
  } else if (corteDonut === "semana") {
    const { inicio: i, fin: f, lunes } = obtenerRangoSemana(offsetSemanaDonut);
    inicio = i;
    fin = f;
    sec.appendChild(
      construirNavegadorPeriodo(
        etiquetaRangoSemana(lunes),
        () => {
          offsetSemanaDonut -= 1;
          refrescar();
        },
        () => {
          offsetSemanaDonut += 1;
          refrescar();
        },
        offsetSemanaDonut >= 0 // no tiene sentido navegar semanas futuras más allá de la actual
      )
    );
  } else {
    if (semestres.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.margin = "0";
      vacio.textContent = "Todavía no hay semestres cargados.";
      sec.appendChild(vacio);
      cont.appendChild(sec);
      return;
    }
    indiceSemestreDonut = Math.max(0, Math.min(semestres.length - 1, indiceSemestreDonut));
    const semestre = semestres[indiceSemestreDonut];
    ({ inicio, fin } = obtenerRangoSemestre(semestre));
    sec.appendChild(
      construirNavegadorPeriodo(
        semestre.nombre,
        () => {
          indiceSemestreDonut = Math.max(0, indiceSemestreDonut - 1);
          refrescar();
        },
        () => {
          indiceSemestreDonut = Math.min(semestres.length - 1, indiceSemestreDonut + 1);
          refrescar();
        },
        indiceSemestreDonut >= semestres.length - 1
      )
    );
  }

  const minutosPorMateria = calcularMinutosPorMateriaEnRango(inicio, fin);
  const segmentos = Array.from(minutosPorMateria.entries())
    .map(([materiaMatriculadaId, minutos]) => ({ ...resolverInfoMateria(materiaMatriculadaId), minutos }))
    .filter((seg) => seg.minutos > 0)
    .sort((a, b) => b.minutos - a.minutos);

  if (segmentos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Sin sesiones de estudio en este período.";
    sec.appendChild(vacio);
  } else {
    const filaDonut = document.createElement("div");
    filaDonut.style.cssText = "display:flex; align-items:center; justify-content:center;";
    filaDonut.appendChild(construirDonutHorasPorMateria(segmentos));
    sec.appendChild(filaDonut);
    sec.appendChild(construirListaHorasPorMateria(segmentos));
  }

  cont.appendChild(sec);
}

/* ===================== Sección 2: gráfica de barras (tendencia) ===================== */

function construirSeccionBarras(cont, refrescar) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.style.gap = "14px";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Tendencia</h3>`;

  sec.appendChild(
    construirPillGroup(
      [
        { valor: "semana", etiqueta: "Semana" },
        { valor: "semestre", etiqueta: "Semestre" },
      ],
      corteBarras,
      (valor) => {
        corteBarras = valor;
        refrescar();
      }
    )
  );

  const semestres = obtenerTodosLosSemestresOrdenados();
  if (indiceSemestreBarras === null) indiceSemestreBarras = obtenerIndiceSemestreVigente(semestres);

  let puntos = [];

  if (corteBarras === "semana") {
    const { lunes } = obtenerRangoSemana(offsetSemanaBarras);
    sec.appendChild(
      construirNavegadorPeriodo(
        etiquetaRangoSemana(lunes),
        () => {
          offsetSemanaBarras -= 1;
          refrescar();
        },
        () => {
          offsetSemanaBarras += 1;
          refrescar();
        },
        offsetSemanaBarras >= 0
      )
    );
    puntos = NOMBRES_DIA_CORTO.map((etiqueta, i) => {
      const dia = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i, 0, 0, 0, 0);
      const diaSiguiente = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + i + 1, 0, 0, 0, 0);
      return { etiqueta, minutos: calcularMinutosTotalesEnRango(dia.getTime(), diaSiguiente.getTime()) };
    });
  } else {
    if (semestres.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.margin = "0";
      vacio.textContent = "Todavía no hay semestres cargados.";
      sec.appendChild(vacio);
      cont.appendChild(sec);
      return;
    }
    indiceSemestreBarras = Math.max(0, Math.min(semestres.length - 1, indiceSemestreBarras));
    const semestre = semestres[indiceSemestreBarras];
    sec.appendChild(
      construirNavegadorPeriodo(
        semestre.nombre,
        () => {
          indiceSemestreBarras = Math.max(0, indiceSemestreBarras - 1);
          refrescar();
        },
        () => {
          indiceSemestreBarras = Math.min(semestres.length - 1, indiceSemestreBarras + 1);
          refrescar();
        },
        indiceSemestreBarras >= semestres.length - 1
      )
    );

    const inicioSemestre = new Date(`${semestre.fecha_inicio}T00:00:00`);
    const finSemestre = new Date(`${semestre.fecha_fin}T23:59:59`);
    const cursor = new Date(inicioSemestre.getFullYear(), inicioSemestre.getMonth(), 1);
    while (cursor <= finSemestre) {
      const inicioMes = new Date(Math.max(cursor.getTime(), inicioSemestre.getTime()));
      const finMesCalendario = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
      const finMes = new Date(Math.min(finMesCalendario.getTime(), finSemestre.getTime() + 1));
      puntos.push({
        etiqueta: NOMBRES_MES_CORTO[cursor.getMonth()],
        minutos: calcularMinutosTotalesEnRango(inicioMes.getTime(), finMes.getTime()),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  sec.appendChild(construirGraficaBarras(puntos));
  cont.appendChild(sec);
}

/* ===================== Ensamblado ===================== */

/**
 * Punto de entrada — llamado desde tiempo-estudio.js cuando el pill
 * superior "Materias/Estadísticas" está en "Estadísticas". `refrescar` es
 * un callback sin argumentos (normalmente `renderizarTiempoEstudio` del
 * archivo que llama) que se dispara ante cualquier cambio de pill/navegador
 * — este archivo no re-renderiza su propio contenido en aislado, deja que
 * el padre reconstruya toda la sección (mismo patrón que ya usa el filtro
 * Todo/Activos en tiempo-estudio.js).
 */
function construirVistaEstadisticas(cont, refrescar) {
  construirSeccionDonut(cont, refrescar);
  construirSeccionBarras(cont, refrescar);
}

export { construirVistaEstadisticas };
