// info/maquetas.js: esquemas de pantalla extraídos de js/core/onboarding.js.
// Sin dependencias del resto de la app. Para traducir, llama usarTraductor(traducirTextoInterfaz).
let T = (s) => s;
export function usarTraductor(fn) { if (typeof fn === "function") T = fn; }

function elDiv(clase, ...hijos) { const d = document.createElement("div"); d.className = clase; hijos.forEach((h) => h && d.append(h)); return d; }
const barra = (ancho, extra = "") => { const b = elDiv(`onb-barra ${extra}`.trim()); b.style.width = `${ancho}%`; return b; };
const repetir = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const filaEsquema = (anchoBarra = 70, conChip = false) => elDiv("onb-fila", elDiv("onb-punto"), barra(anchoBarra), conChip ? elDiv("onb-chip") : null);
const columnaClases = (...alturas) => elDiv("onb-col", ...alturas.map((h) => { const c = elDiv("onb-clase"); c.style.height = `${h}px`; return c; }));
const graficaBarras = (alturas) => elDiv("onb-grafica", ...alturas.map((h) => { const i = document.createElement("i"); i.style.height = `${h}%`; return i; }));

function construirMaqueta() {
  const raiz = elDiv("onb-maqueta"); raiz.setAttribute("aria-hidden", "true"); raiz.hidden = true;
  const lado = elDiv("onb-m-lado", ...repetir(5, () => document.createElement("i")));
  const titulo = document.createElement("b"); titulo.textContent = T("Así se verá tu app");
  const boton = document.createElement("span"); boton.className = "btn btn-primary"; boton.textContent = T("Agregar");
  const nota = document.createElement("p"); nota.className = "onb-m-nota"; nota.textContent = T("Vista previa de tu tema y paleta");
  raiz.append(elDiv("onb-m-cuerpo", lado, elDiv("onb-m-principal",
    elDiv("onb-m-cabecera", titulo, boton),
    elDiv("onb-m-rejilla",
      elDiv("onb-bloque", graficaBarras([45, 70, 52, 88, 64, 78])),
      elDiv("onb-bloque", filaEsquema(80), filaEsquema(55), filaEsquema(68))),
    elDiv("onb-bloque", filaEsquema(85, true), filaEsquema(60, true)),
    nota)));
  return raiz;
}

/* ── Esquemas de «Conoce…» ─────────────────────────────────────────────────
   Cada sección imita la pantalla real (mismos bloques, orden y textos, estado inicial real) con datos de la cuenta demo.
   SOLO DOM + CSS estático. Cada una devuelve { base, extras }: la base siempre se muestra y los extras se agregan,
   de arriba hacia abajo, mientras quepan en el alto disponible (ver llenarExtras). Un extra puede ser [padre, nodo]
   para insertarse dentro de una tarjeta. Los textos fijos pasan por traducirTextoInterfaz; las fechas/horas/montos salen de Intl. */
const ACENTO = "var(--accent-1,#8b5cf6)", ROJO = "#e5484d", AMBAR = "#d99a00", VERDE = "#22a06b", AZUL = "#3a7de2", MORADO = "#8b4ae0", NARANJA = "#f28a2b";
function nodo(tag, clase, texto, hijos) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = T(texto);
  (hijos || []).forEach((h) => h && e.append(h));
  return e;
}
const rFila = (clase, ...h) => nodo("div", `onb-r-fila ${clase || ""}`.trim(), null, h);
const rCard = (...h) => nodo("div", "onb-bloque onb-r-card", null, h);
const rNegrita = (t) => nodo("b", "", t);
const rSuave = (t) => nodo("span", "onb-r-m", t);
const rTag = (t, color) => { const e = nodo("span", "onb-r-tag", t); if (color) e.style.setProperty("--c", color); return e; };
const rBoton = (t, suave) => nodo("span", suave ? "onb-r-btn s" : "onb-r-btn", t);
function rProg(pct, color) { const p = nodo("div", "onb-r-prog", null, [document.createElement("i")]); p.firstChild.style.width = `${pct}%`; if (color) p.firstChild.style.background = color; return p; }
function rPills(opciones, activo) {
  return nodo("div", "onb-r-pills", null, opciones.map((t, i) => nodo("span", i === activo ? "on" : "", t)));
}
function rItem(titulo, sub, color, ...derecha) {
  const it = nodo("div", "onb-r-item", null, [nodo("div", "", null, [nodo("b", "", titulo), sub ? nodo("small", "", sub) : null]), ...derecha]);
  if (color) it.style.setProperty("--c", color);
  return it;
}
function rAvatar(iniciales, color) { const a = nodo("span", "onb-r-av", iniciales); a.style.setProperty("--c", color); return a; }

/* Textos con fecha/hora/monto: salen con Intl en el idioma de la interfaz, así no necesitan catálogo. */
const idiomaUI = () => (document.documentElement.lang || "es").toLowerCase();
function fechaUI(y, m, d, opciones) { try { return new Intl.DateTimeFormat(idiomaUI(), opciones).format(new Date(y, m, d)); } catch (e) { return ""; } }
function svgEl(tag, attrs, texto) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
  if (texto != null) e.textContent = texto;
  return e;
}
const PINK = "#ec4899", CIAN = "#06b6d4", NARANJA2 = "#f97316", INDIGO = "#6366f1", TEAL = "#14b8a6", PURPURA = "#a855f7", GRIS = "#6b7280", CELESTE = "#38bdf8";
const plano = (tag, clase, s) => { const e = document.createElement(tag); if (clase) e.className = clase; e.textContent = s; return e; };
function horaUI(h, m) { try { return new Intl.DateTimeFormat(idiomaUI(), { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 9, 9, h, m || 0)); } catch (e) { return `${h}:${String(m || 0).padStart(2, "0")}`; } }
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rEtiqueta = (t) => nodo("small", "onb-r-etq up", t);
const rTit = (t) => nodo("b", "onb-r-tit", t);
function rPildora(t, color) { const e = nodo("span", "onb-r-chip", t); e.style.setProperty("--c", color); return e; }
function rEstrellas(pct) { const s = nodo("span", "onb-r-est"); const b = nodo("b", "", null); b.textContent = "★★★★★"; b.style.setProperty("--p", `${pct}%`); s.append(b); return s; }
function rBarraFina(pct, color) { const p = rProg(pct, color); p.classList.add("fina"); return p; }
function fmtMonto(n) { try { const i = idiomaUI(); return "₡" + new Intl.NumberFormat(i.startsWith("es") ? "es-CR" : i, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); } catch (e) { return "₡" + n; } }
const LETRAS_DIAS_ES = ["L", "K", "M", "J", "V", "S", "D"];
const letraDia = (i) => idiomaUI().startsWith("es") ? LETRAS_DIAS_ES[i] : fechaUI(2026, 9, 5 + i, { weekday: "narrow" }).toUpperCase();

/* Datos de ejemplo de la cuenta demo (nombres, colores y metas), en un solo lugar. */
const DEMO = {
  estado: ["Estado Y Gestión Pública", INDIGO],
  derecho: ["Aspectos Políticos Del Derecho Constitucional", AMBAR],
  prog: ["Introducción A La Programación", CELESTE],
  macro: ["Aspectos Políticos De La Macroeconomía", TEAL],
  ideas: ["Ideas Políticas Y Sus Alcances I", PINK],
  analisis: ["Análisis Político Cuantitativo I", PURPURA],
  sistemas: ["Sistemas De Información", "#0e7490"],
  materia: ["Materia", CIAN],
};

function rClase(hora, mat) {
  const it = nodo("div", "onb-r-item onb-r-clase", null, [plano("b", "", hora), nodo("div", "", null, [nodo("b", "", mat[0])]), rSuave("Presencial")]);
  it.style.setProperty("--c", mat[1]); return it;
}
function rNavSemana(texto) { return nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", texto), nodo("span", "onb-r-eng", "›")]); }
function rEstudioMateria(mat, meta) {
  const it = rItem(mat[0], null, mat[1], rSuave(meta));
  return nodo("div", "onb-r-estmat", null, [it, rBarraFina(0, mat[1])]);
}

function esquemaHorario() {
  const g = nodo("div", "onb-r-hor2");
  for (let h = 8; h <= 17; h++) {
    const ln = nodo("span", "onb-r-ln"); ln.style.gridRow = String(h - 6); g.append(ln);
    const lab = nodo("span", "onb-r-hh2"); lab.style.gridColumn = "1"; lab.style.gridRow = String(h - 6);
    let periodo = "";
    try { periodo = new Intl.DateTimeFormat(idiomaUI(), { hour: "numeric", hour12: true }).formatToParts(new Date(2026, 9, 5, h)).find((p) => p.type === "dayPeriod")?.value || ""; } catch (e) {}
    lab.append(plano("b", "", String(periodo ? ((h + 11) % 12) + 1 : h)));
    if (periodo) lab.append(plano("small", "", periodo));
    g.append(lab);
  }
  [5, 6, 7, 8, 9].forEach((d, i) => {
    const c = nodo("span", "onb-r-hd");
    c.append(plano("b", "", letraDia(i)), plano("small", "", fechaUI(2026, 9, d, { day: "numeric", month: "short" })));
    c.style.gridColumn = String(i + 2); c.style.gridRow = "1"; g.append(c);
  });
  const M = DEMO;
  // [columna 1-5, hora inicio, hora fin, materia, ícono]
  [[1, 8, 10, M.estado], [1, 17, 18, M.sistemas], [2, 10, 12, M.derecho, "💻"], [2, 14, 16, M.materia, "💻"], [3, 13, 15, M.derecho],
   [3, 16, 18, M.prog], [4, 8, 10, M.estado], [4, 15, 17, M.analisis, "📖"], [5, 9, 11, M.ideas]].forEach(([col, a, b, mat, icono]) => {
    const bl = nodo("div", "onb-r-blq2", null, [nodo("b", "", mat[0])]);
    if (icono) bl.append(plano("span", "", icono));
    bl.style.gridColumn = String(col + 1); bl.style.gridRow = `${a - 6} / ${b - 6}`; bl.style.background = mat[1]; g.append(bl);
  });
  const ahora = nodo("span", "onb-r-ahora"); ahora.style.gridRow = "9"; g.append(ahora);
  return g;
}

function esquemaSerieFinanzas() {
  const w = 300, h = 140, xs = [40, 88, 136, 184, 232, 280], base = 112;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "onb-r-svg", "aria-hidden": "true" });
  [["600k", 18], ["400k", 46], ["200k", 79], ["0", base]].forEach(([t, y]) => {
    svg.append(svgEl("text", { x: 2, y: y + 3, "font-size": 8, fill: "currentColor", opacity: ".55" }, t));
    if (t !== "0") svg.append(svgEl("line", { x1: 28, x2: 292, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".15", "stroke-dasharray": "3 3" }));
  });
  [["#ef4444", [60, 62, 84, 50, 98, 36]], ["#10b981", [base, base, base, 108, base, 104]], ["#3b82f6", [base, 100, base, 94, 106, base]]].forEach(([color, ys]) => {
    svg.append(svgEl("polyline", { points: xs.map((x, i) => `${x},${ys[i]}`).join(" "), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
    xs.forEach((x, i) => svg.append(svgEl("circle", { cx: x, cy: ys[i], r: 2.6, fill: color })));
  });
  ["2023-1", "2023-2", "2024-1", "2024-2", "2025-1", "2025-2"].forEach((t, i) => svg.append(svgEl("text", { x: xs[i], y: 130, "font-size": 7, fill: "currentColor", opacity: ".6", "text-anchor": "middle" }, t)));
  return svg;
}
function esquemaGraficoMetas() {
  const svg = svgEl("svg", { viewBox: "0 0 300 84", class: "onb-r-svg", "aria-hidden": "true" });
  [10, 34, 58].forEach((y) => svg.append(svgEl("line", { x1: 20, x2: 292, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".15" })));
  svg.append(svgEl("polyline", { points: "24,70 64,70 104,70 144,70 184,70 224,12 284,12", fill: "none", stroke: "currentColor", "stroke-opacity": ".55", "stroke-width": 1.4, "stroke-dasharray": "4 3" }));
  svg.append(svgEl("polyline", { points: "24,70 284,70", fill: "none", stroke: "#ef4444", "stroke-width": 1.6 }));
  return svg;
}
function rMiniCalendario() {
  const card = rCard(nodo("div", "onb-r-centro", null, [plano("b", "onb-r-tit", mayus(fechaUI(2026, 9, 1, { month: "long", year: "numeric" }))), nodo("small", "onb-r-etq", "Volver a hoy")]));
  const g = nodo("div", "onb-r-cal");
  LETRAS_DIAS_ES.forEach((_, i) => g.append(plano("span", "onb-r-cal-h", letraDia(i))));
  const puntos = { 3: [AZUL, VERDE, NARANJA], 5: [ROJO, AZUL, VERDE], 7: [AZUL], 8: [AZUL, VERDE], 9: [ROJO, NARANJA], 10: [CIAN], 12: [AZUL, VERDE, PURPURA], 16: [ROJO, NARANJA], 19: [GRIS, VERDE, CIAN] };
  [28, 29, 30, ...Array.from({ length: 31 }, (_, i) => i + 1), 1].forEach((n, i) => {
    const fuera = i < 3 || i === 34;
    const c = nodo("span", `onb-r-cal-d${fuera ? " fuera" : ""}${n === 10 && !fuera ? " hoy" : ""}`);
    c.append(plano("b", "", String(n)));
    if (!fuera && puntos[n]) { const p = nodo("i", "onb-r-cal-p"); puntos[n].forEach((col) => { const d = document.createElement("em"); d.style.background = col; p.append(d); }); c.append(p); }
    g.append(c);
  });
  card.append(g); return card;
}
function rMateriaPlan(cod, nombre, color) {
  const m = nodo("div", "onb-r-mat", null, [
    rFila("", nodo("span", "onb-punto"), plano("small", "onb-r-cod", cod), nodo("b", "onb-r-mat-n", nombre), nodo("span", "onb-r-m", "▼")),
    rFila("onb-r-sp", rPildora("Aprobada", "#10b981"), nodo("span", "onb-r-m", "Horas: 6"), rPildora("Créditos: 3", "#6366f1"))]);
  m.style.setProperty("--c", color); return m;
}
function rMapaPlan() {
  const cur = (cod, nombre, estado) => nodo("div", `onb-r-curso ${estado}`, null, [nodo("small", "onb-r-cod", cod), nodo("b", "", nombre)]);
  const col = (t, ...cs) => nodo("div", "onb-r-ciclo-col", null, [nodo("b", "onb-r-ciclo-t", t), ...cs]);
  const cols = nodo("div", "onb-r-ciclos tres", null, [
    col("Ciclo 1", cur("EG-I", "Humanidades I", "ok"), cur("CP-1504", "El poder desde la ciencia política", "ok"), cur("CP-1501", "Epistemología y lógica", "ok")),
    col("Ciclo 2", cur("EG-II", "Humanidades II", "ok"), cur("CP-1502", "Instituciones públicas", "ok"), cur("CP-1503", "Diseño de investigación", "ok")),
    col("Ciclo 3", cur("SR-I", "Realidad nacional I", "pen"), cur("CP-2004", "Análisis cuantitativo I", "cur"), cur("CP-2005", "Ideas políticas I", "cur"))]);
  return nodo("div", "onb-r-mapa", null, [cols]);
}
function rFilaAjuste(t) { return nodo("div", "onb-bloque onb-r-fila onb-r-sp onb-r-ajuste", null, [nodo("b", "", t), nodo("span", "onb-r-m", "▾")]); }
function rFilaNav(t) { return nodo("div", "onb-r-fila onb-r-sp onb-r-navfila", null, [rFila("", nodo("span", "onb-r-m", "⋮⋮"), nodo("span", "", t)), nodo("span", "onb-interruptor")]); }

const fd = (d, o) => fechaUI(2026, 9, d, o);
const diaLargo = (d) => mayus(fd(d, { weekday: "long" }));
const diaCorto = (d) => fd(d, { day: "numeric", month: "short" });
function rDiaCard(d, hoy, ...h) {
  return rCard(rFila("onb-r-sp", nodo("span", "", null, [plano("b", "onb-r-tit", diaLargo(d)), plano("span", "onb-r-m", `  ${diaCorto(d)}`)]), hoy ? nodo("span", "onb-r-hoy", "Hoy") : null), ...h);
}
const rTarea = (t, mat, tipo, color, hora) => rItem(t, mat, color, rTag(tipo, color), hora ? rSuave(hora) : null);
function rLista(titulo, ...items) { return rCard(rTit(titulo), ...items); }

function contenidoEsquema(id) {
  const base = [], extras = [];
  const M = DEMO;
  switch (id) {
    case "resumen": {
      const semana = nodo("div", "onb-bloque onb-r-cab", null, [rProg(55), nodo("b", "onb-r-tit", "Semana 9"), rSuave("Faltan 51 días")]);
      semana.firstChild.style.width = "56px";
      const estudio = rCard(rFila("onb-r-sp", rTit("Estudio de hoy"), nodo("b", "onb-r-m", "0 min de 11 h")), rProg(0),
        rEstudioMateria(M.derecho, "0 min estudiados · meta 6 h"), rEstudioMateria(M.prog, "0 min estudiados · meta 5 h"));
      estudio.classList.add("acento");
      base.push(semana, estudio, rCard(rTit("Clases de hoy"), rEtiqueta("Clases"), rClase(horaUI(8), M.estado), rClase(horaUI(10), M.macro), rClase(horaUI(12), M.derecho)));
      const fechaEx = mayus(fd(16, { weekday: "short", day: "numeric", month: "short" }));
      extras.push(
        rLista("Exámenes próximos", rFila("onb-r-sp", plano("b", "", fechaEx), rSuave("En 6 días")),
          rTarea("Examen: entrega final", M.derecho[0], "Examen", ROJO, horaUI(23, 59)), rTarea("Quiz: entrega final", M.prog[0], "Quiz", NARANJA2, horaUI(23, 59))),
        rLista("Tareas de hoy", rTarea("Lectura capítulo 4", M.ideas[0], "Tarea", AZUL, horaUI(18)), rTarea("Informe de laboratorio", M.analisis[0], "Proyecto", PURPURA, horaUI(23, 59))),
        rLista("Próximas tareas", rTarea("Ensayo corto", M.estado[0], "Tarea", AZUL), rTarea("Taller en grupo", M.macro[0], "Evento", CIAN), rTarea("Cuestionario 3", M.prog[0], "Quiz", NARANJA2)),
        rLista("Próximo evento", rTarea("Charla de orientación", null, "Evento", CIAN, horaUI(14))),
        rLista("Atrasadas", rTarea("Lectura atrasada", M.ideas[0], "Tarea", ROJO)),
        rLista("Requiere atención", rItem("2 tareas pendientes", null, NARANJA, rSuave("›")), rItem("1 examen esta semana", null, ROJO, rSuave("›"))));
      break;
    }
    case "agenda": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cab3", null, [nodo("div", "onb-r-centro", null, [nodo("b", "onb-r-ciclo", "II Ciclo 2026"),
        rFila("onb-r-sp", nodo("span", "onb-r-mas", "+"),
          nodo("div", "onb-r-centro", null, [nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", "Semana 9"), nodo("span", "onb-r-eng", "›")]),
            nodo("span", "onb-r-m", null, [plano("span", "", `5 - 11 ${fd(11, { month: "short" })} · `), nodo("u", "", "Hoy")])]),
          nodo("span", "onb-r-eng", "⚙️"))])]);
      base.push(rPills(["Lista", "Calendario", "Cronograma"], 0), cab, nodo("div", "onb-r-buscar", "Buscar en toda la Agenda..."));
      const tinte = (m, meta) => { const e = rItem(m[0], null, m[1], rSuave(meta)); e.classList.add("tinte"); return e; };
      extras.push(
        nodo("div", "onb-r-chips centro", null, [["Clase", PINK], ["Completado", "#3b82f6"], ["Perdida", GRIS], ["Pendiente", "#f59e0b"], ["Tarea", "#3b82f6"], ["Examen", ROJO], ["Evento", CIAN], ["Feriado", "#10b981"], ["Proyecto", PURPURA], ["Quiz", NARANJA2]].map(([t, col]) => rPildora(t, col))),
        nodo("div", "onb-bloque onb-r-fila", null, [rSuave("‹  5 días anteriores")]),
        rDiaCard(10, true, rEtiqueta("Estudio para hoy"), tinte(M.derecho, "0 min de 6 h"), tinte(M.prog, "0 min de 5 h"),
          rEtiqueta("Clases"), rClase(horaUI(8), M.estado), rClase(horaUI(10), M.macro), rEtiqueta("Examen"), rTarea("Examen: avance grupal", M.derecho[0], "Examen", ROJO, horaUI(12))),
        rDiaCard(11, false, rEtiqueta("Tarea"), rTarea("Lectura capítulo 4", M.ideas[0], "Tarea", AZUL, horaUI(18)), rEtiqueta("Proyecto"), rTarea("Informe de laboratorio", M.analisis[0], "Proyecto", PURPURA)),
        rDiaCard(12, false, rEtiqueta("Evento"), rTarea("Charla de orientación", null, "Evento", CIAN, horaUI(14)), rEtiqueta("Quiz"), rTarea("Quiz: capítulos 1 a 3", M.prog[0], "Quiz", NARANJA2, horaUI(9))),
        rDiaCard(13, false, rEtiqueta("Feriado"), rTarea("Día festivo", null, "Feriado", "#10b981")),
        rMiniCalendario());
      break;
    }
    case "horario": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cab3", null, [nodo("div", "onb-r-centro", null, [nodo("span", "onb-r-m", "II Ciclo 2026"),
        nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", "Semana 9"), nodo("span", "onb-r-eng", "›")]),
        plano("span", "onb-r-m", diaCorto(10))])]);
      const botones = rFila("onb-r-sp onb-r-botonesh", rBoton("+ Agregar"), nodo("span", "onb-r-eng", "⬇"), nodo("span", "onb-r-eng", "⛶"), rBoton("Amigos", true));
      base.push(cab, botones, nodo("div", "onb-bloque onb-r-horario est", null, [esquemaHorario()]));
      break;
    }
    case "tiempo-estudio": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cabte", null, [nodo("span", "onb-r-eng", "⏮"), nodo("b", "onb-r-tit onb-r-nomte", "CP-2004 · Análisis cuantitativo I"), nodo("span", "onb-r-eng", "⚙️")]);
      const aro = nodo("div", "onb-aro"); aro.style.background = "color-mix(in srgb,var(--accent-1,#8b5cf6) 22%,transparent)";
      const anillo = nodo("div", "onb-r-aro g", null, [aro, nodo("b", "onb-r-tiempo", null)]); anillo.lastChild.textContent = "00:00";
      const caja = (v, t) => nodo("div", "onb-r-caja ancha", null, [nodo("b", "", v), nodo("small", "", t)]);
      base.push(cab, nodo("div", "onb-bloque onb-r-card onb-r-principalte", null, [nodo("div", "onb-r-centro", null, [anillo]), nodo("span", "onb-r-btn grande", "▷ Iniciar"), caja("0 min", "Estudiado"), caja("5 h", "Faltan"), caja("5 h", "Meta")]));
      const ses = (d, dur, m) => rItem(d, m[0], m[1], rSuave(dur));
      const mat = (m, meta) => rItem(m[0], meta, m[1], nodo("span", "onb-r-mas", "▶"));
      const stat = (v, t) => nodo("div", "onb-r-caja ancha", null, [plano("b", "", v), nodo("small", "", t)]);
      const comp = (t, pc, c) => nodo("div", "onb-r-estmat", null, [rFila("onb-r-sp", nodo("span", "", t), plano("span", "onb-r-m", `${pc}%`)), rBarraFina(pc, c)]);
      extras.push(
        rCard(rTit("Resumen de metas"), rNavSemana("Semana 9"), esquemaGraficoMetas(),
          nodo("div", "onb-r-leyenda", null, [["Estudiado: 0 min", "#ef4444"], ["Meta semana: 5 h", GRIS]].map(([t, col]) => { const e = nodo("span", "", t); e.style.setProperty("--c", col); return e; }))),
        rCard(rTit("Horas estudiadas"), rPills(["Semana", "Semestre"], 0), rNavSemana("Semana 9"),
          nodo("div", "onb-r-vacio", "Sin sesiones registradas en este período: prueba con el navegador de arriba.")),
        rCard(rTit("Estadísticas"), nodo("div", "onb-fila3", null, [stat("🔥 0", "Racha"), stat("0 h", "Total"), stat("0", "Sesiones")])),
        rLista("Competencias", comp("Constancia", 20, TEAL), comp("Enfoque", 35, AZUL), comp("Cumplimiento de metas", 10, AMBAR)),
        rLista("Sesiones recientes", ses(diaCorto(9), "45 min", M.estado), ses(diaCorto(8), "1 h 20 min", M.prog), ses(diaCorto(7), "30 min", M.derecho)),
        rLista("Materias", mat(M.estado, "0 min de 4 h"), mat(M.macro, "0 min de 5 h"), mat(M.derecho, "0 min de 6 h")));
      break;
    }
    case "semestres": {
      const fila = (n, cred) => nodo("div", "onb-r-fila onb-r-semfila", null, [nodo("b", "onb-r-semn", n), nodo("span", "onb-r-m", "···"), rPildora(cred, INDIGO), nodo("span", "onb-r-m", "▼")]);
      const caja = (n, cred) => nodo("div", "onb-bloque onb-r-semwrap", null, [fila(n, cred)]);
      const semActual = caja("II Ciclo 2026", "Créditos: 21");
      const actual = rCard(rTit("Semestre actual"), semActual, rFila("onb-r-sp onb-r-botonesh dos", rBoton("+ Agregar", true), rBoton("Editar semestres", true)));
      const p1 = caja("I Ciclo 2026", "Créditos: 18"), p2 = caja("Verano 2025", "Créditos: 6"), p3 = caja("II Ciclo 2025", "Créditos: 20");
      const pasados = rCard(rTit("Semestres pasados"), p1, p2, p3);
      base.push(nodo("div", "onb-bloque onb-r-fila onb-r-sp", null, [rTit("Historial académico"), nodo("span", "onb-r-m", "▼")]), actual, pasados);
      const mat = (cod, nombre, nota, color, est) => {
        const m = nodo("div", "onb-r-curso2", null, [
          rFila("onb-r-sp", nodo("span", "", null, [nodo("small", "onb-r-cod", cod), nodo("b", "", `  ${nombre}`)]), nodo("b", "", `Nota: ${nota}`)),
          rFila("onb-r-sp", rPildora(est || "Cursando", est ? "#10b981" : "#f59e0b"), rPildora("Créditos: 3", "#3b82f6"))]);
        m.style.setProperty("--c", color); return m;
      };
      extras.push([semActual, mat("CP-2001", M.estado[0], 85, INDIGO)], [semActual, mat("CP-2002", M.macro[0], 70, TEAL)], [semActual, mat("CP-2003", M.derecho[0], 78, AMBAR)],
        [p1, mat("EG-I", "Humanidades I", 90, PINK, "Aprobada")], [pasados, caja("I Ciclo 2025", "Créditos: 17")], [pasados, caja("II Ciclo 2024", "Créditos: 19")]);
      break;
    }
    case "finanzas": {
      const aro = nodo("div", "onb-aro"); aro.style.background = "conic-gradient(#ef4444 0 82%,color-mix(in srgb,currentColor 16%,transparent) 82% 100%)";
      const anillo = nodo("div", "onb-r-aro g", null, [aro]);
      const lin = (pct, t, monto, color) => { const f = nodo("div", "onb-r-fin", null, [plano("b", "", pct), nodo("span", "", t), plano("b", "", monto)]); f.firstChild.style.color = color; return f; };
      const par = (t, monto, color) => { const d = nodo("i", "onb-r-pt"); d.style.background = color; return nodo("span", "onb-r-fila", null, [d, nodo("span", "", t), plano("b", "", monto)]); };
      const bal = nodo("div", "onb-r-fila onb-r-balfila", null, [nodo("span", "onb-r-m", "Balance total:"), plano("b", "onb-r-bal", fmtMonto(180700))]);
      base.push(rCard(rTit("Resumen"), nodo("div", "onb-r-centro", null, [anillo]), lin("82%", "Gastado", fmtMonto(842300), "#ef4444"), lin("18%", "Disponible", fmtMonto(180700), "#10b981"),
          rFila("onb-r-sp", par("Beca:", fmtMonto(400000), "#10b981"), par("Ingresos:", fmtMonto(623000), "#3b82f6")), bal),
        rCard(rTit("Por semestre"), esquemaSerieFinanzas(),
          nodo("div", "onb-r-leyenda", null, [["Gastos", "#ef4444"], ["Beca", "#10b981"], ["Ingresos", "#3b82f6"]].map(([t, col]) => { const e = nodo("span", "", t); e.style.setProperty("--c", col); return e; }))));
      const mov = (n, d, monto, col) => rItem(n, diaCorto(d), col, plano("b", "", monto));
      const cat = (n, pct, monto, col) => nodo("div", "onb-r-estmat", null, [rFila("onb-r-sp", nodo("span", "", n), plano("b", "", monto)), rBarraFina(pct, col)]);
      extras.push(
        rLista("Por categoría", cat("Matrícula", 70, fmtMonto(310000), "#ef4444"), cat("Alimentación", 40, fmtMonto(168000), "#f59e0b"), cat("Transporte", 22, fmtMonto(94500), "#3b82f6"), cat("Materiales", 12, fmtMonto(52000), "#a855f7")),
        rLista("Movimientos recientes", mov("Matrícula", 2, `-${fmtMonto(310000)}`, "#ef4444"), mov("Beca", 1, `+${fmtMonto(400000)}`, "#10b981"), mov("Almuerzo", 8, `-${fmtMonto(4200)}`, "#ef4444"), mov("Transporte", 7, `-${fmtMonto(24500)}`, "#ef4444"), mov("Trabajo freelance", 5, `+${fmtMonto(85000)}`, "#10b981")));
      break;
    }
    case "plan-estudios": {
      const lista = nodo("div", "onb-bloque onb-r-card", null, [rFila("onb-r-sp", rTit("Bloque 1"), nodo("span", "onb-r-m", "▲"))]);
      base.push(nodo("div", "onb-bloque onb-r-card", null, [rMapaPlan()]), lista);
      [["EG-I", "Humanidades I", "#f59e0b"], ["EG-II", "Humanidades II", "#dc2626"], ["CP-1501", "Epistemología y lógica", "#d946ef"], ["CP-1502", "Instituciones públicas", "#34d399"], ["CP-1503", "Diseño de investigación", "#a855f7"], ["CP-1504", "El poder desde la ciencia política", "#3b82f6"], ["SE-1100", "Actividad cultural I", "#ec4899"]]
        .forEach(([cod, n, col], i) => { const m = rMateriaPlan(cod, n, col); if (i < 2) lista.append(m); else extras.push([lista, m]); });
      const blq = (n) => nodo("div", "onb-bloque onb-r-fila onb-r-sp", null, [rTit(n), nodo("span", "onb-r-m", "▼")]);
      extras.push(blq("Bloque 2"), blq("Bloque 3"), blq("Optativas"));
      break;
    }
    case "comunidad": {
      const doc = (n, pct, ok) => nodo("div", "onb-bloque onb-r-doc", null, [nodo("b", "", n), rEstrellas(pct), rPildora(ok ? "✓ Recomendado" : "✕ No recomendado", ok ? "#10b981" : ROJO), nodo("span", "onb-r-m", "▼")]);
      const docAbierto = nodo("div", "onb-bloque onb-r-card", null, [
        rFila("onb-r-sp", nodo("b", "", "Prof. Sofía Chacón"), rEstrellas(70), rPildora("✓ Recomendado", "#10b981"), nodo("span", "onb-r-m", "▲")),
        rFila("onb-r-sp", rSuave("Tu valoración"), rEstrellas(70)), rFila("onb-r-sp", rSuave("Materia"), nodo("span", "", M.estado[0])),
        nodo("small", "onb-r-etq", "Comentario: explica con claridad y deja ejemplos de repaso.")]);
      base.push(rCard(rTit("Comunidad"), nodo("small", "onb-r-etq", "Profesores y compañeros con los que compartiste clase."), rPills(["Profesores", "Compañeros"], 0)),
        nodo("div", "onb-bloque onb-r-card", null, [nodo("div", "onb-r-buscar", "Buscar profesor por nombre..."), rPills(["Todos", "Fue profe", "No fue profe"], 0), rPills(["Todos", "Recomendado", "No recomendado"], 0), rPills(["Alfabético", "Por bloque"], 0)]));
      extras.push(doc("Prof. Natalia Vega", 92, true), docAbierto, doc("Prof. Esteban Rojas", 60, false), doc("Prof. Laura Jiménez", 84, true), doc("Prof. Pablo Araya", 80, true),
        doc("Prof. Marcos Alvarado", 0, true), doc("Prof. Elena Mora", 76, true), doc("Prof. Diego Salas", 48, false));
      break;
    }
    case "asistente": {
      const burb = (clase, t) => nodo("div", `onb-r-msg ${clase}`.trim(), t);
      const tarjeta = (emoji, t, sub) => nodo("div", "onb-bloque onb-r-nota", null, [nodo("b", "", `${emoji} ${T(t)}`), nodo("small", "onb-r-etq", sub),
        nodo("small", "onb-r-etq", "Agregado por asistente"), nodo("span", "onb-r-acc", null, [nodo("span", "e", "Editar"), nodo("span", "x", "Eliminar")])]);
      const largo = (d) => `${fd(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${T("Todo el día")}`;
      const hilo = nodo("div", "onb-r-hilo", null, [
        burb("", "¡Hola! Soy Wapper 👋, tu asistente académico. ¿Tienes alguna tarea, examen o evento que quieras agregar?"),
        burb("yo", "Tengo laboratorio la próxima semana y acuérdame del quiz del viernes"),
        burb("", "Guardé 2 cosas en tu Agenda:"), tarjeta("✅", "Laboratorio", largo(12)), tarjeta("📝", "Quiz", largo(16))]);
      base.push(hilo, nodo("div", "onb-r-entrada", null, [nodo("span", "onb-r-m", "Ejemplo: Reunión de grupo el sábado a las 10am"), nodo("span", "onb-r-mas", "➤")]));
      extras.push([hilo, burb("yo", "¿Qué tengo pendiente esta semana?")], [hilo, burb("", "Esta semana tienes 3 pendientes:")], [hilo, tarjeta("📌", "Informe de lectura", largo(13))],
        [hilo, burb("yo", "Mueve el quiz para el lunes")], [hilo, burb("", "Listo, moví el quiz al lunes.")]);
      break;
    }
    case "configuracion": {
      base.push(rFilaAjuste("Ajustes generales"), rFilaAjuste("Asistente IA (Gemini)"), rFilaAjuste("Notificaciones"), rFilaAjuste("Personalizar"),
        rFilaAjuste("Horario"), rFilaAjuste("Plan de Estudios activo"), rFilaAjuste("Enlaces rápidos"), rFilaAjuste("Datos"));
      extras.push(rFilaAjuste("Créditos"));
      break;
    }
    default:
      base.push(rCard(rProg(70), rProg(50)));
  }
  return { base, extras };
}

function construirEsquema(id, nombre, conEncabezado) {
  const { base, extras } = contenidoEsquema(id);
  const cuerpo = nodo("div", "onb-r", null, base);
  const marco = elDiv("onb-marco");
  // En teléfono no hay encabezado (era espacio muerto); en pantallas grandes se conserva.
  if (conEncabezado) { const titulo = document.createElement("span"); titulo.textContent = T(nombre); marco.append(elDiv("onb-es-top", document.createElement("i"), titulo)); }
  marco.append(cuerpo);
  marco._extras = extras;
  return marco;
}
/* Relleno progresivo: agrega extras de arriba hacia abajo mientras quepan en el alto disponible. */
function llenarExtras(marco) {
  const cuerpo = marco.querySelector(".onb-r"); if (!cuerpo) return;
  const lista = marco._extras || [];
  lista.forEach((e) => (Array.isArray(e) ? e[1] : e).remove());
  for (const e of lista) {
    const [padre, n] = Array.isArray(e) ? e : [cuerpo, e];
    padre.append(n);
    if (cuerpo.scrollHeight > cuerpo.clientHeight + 1) { n.remove(); continue; }
  }
}
export { construirEsquema, llenarExtras, construirMaqueta };
