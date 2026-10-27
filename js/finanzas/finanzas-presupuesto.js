/* =========================================================================
   FINANZAS 2.0 — Presupuesto: sobres y resumen mensual (sesión 5, F4)
   Pestaña "Presupuesto" (con Gastos e ingresos encendido) y el aviso "Sobres por agotarse" del Inicio.
   Un sobre es un REGISTRO de límite por periodo: no mueve dinero del banco. El gastado sale de los movimientos
   (core/finanzas-sobres.js) y nunca se guarda. El anillo se vacía a medida que gastas; el nivel siempre lleva
   glifo y texto (ámbar al 80 %, rojo al agotarse), y el rojo además lleva borde doble para distinguirse sin color.
   Sin innerHTML.
   ========================================================================= */

import { crearSobre, editarSobre, eliminarSobre, archivarSobre, llenarPlantilla, listarSobres, resumenMensual, sobresEnRiesgo, PERIODOS } from "../core/finanzas-sobres.js";
import { listarCategorias } from "../core/finanzas-categorias.js";
import { parsearMonto } from "../core/finanzas-registro.js";
import { hoyIso } from "../core/finanzas-modelo.js";
import { estado } from "../core/storage.js";
import { obtenerLocaleInterfaz, traducirTextoInterfaz as t } from "../core/i18n.js";
import { formatearFechaLarga, renderizarFinanzas } from "./finanzas.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { montoVisible } from "./finanzas-inicio.js";
import { abrirCategorizarHistorial, abrirGestorCategorias, ayudasUi, contarSinCategoria } from "./finanzas-categorias-ui.js";

const { abrirCapa, boton, campo, entrada, lineaError, mostrar, guardarCambios } = ayudasUi;
const SVG = "http://www.w3.org/2000/svg";
const NIVELES = {
  ok: { glifo: "✓", texto: "Vas bien", color: "var(--success, #22c55e)" },
  ambar: { glifo: "⚠", texto: "Por agotarse", color: "var(--warning, #f59e0b)" },
  rojo: { glifo: "■", texto: "Agotado", color: "var(--danger, var(--color-danger, #ef4444))" },
  sin_periodo: { glifo: "?", texto: "Sin periodo", color: "var(--text-muted, #8a8f98)" },
};
const ETIQUETA_PERIODO = { semana: "Semanal", mes: "Mensual", semestre: "Del semestre", rango: "Entre fechas" };
const MOTIVOS = {
  nombre: "Escribe un nombre para el sobre.", limite: "Escribe un límite mayor que cero.", categorias: "Elige al menos una categoría.",
  categoria_invalida: "Solo se pueden usar categorías de gastos.", periodo: "Elige el periodo.", rango: "Revisa las fechas: la de inicio no puede ir después de la de fin.",
  semestre: "Ese semestre ya no existe.", repetido: "Ya tienes un sobre con ese nombre.", desde: "La fecha de inicio no es válida.",
};
let mesElegido = null; // null = el mes actual

const fmt = (n) => montoVisible(n);
const hijo = (tag, clase, texto) => { const e = document.createElement(tag); if (clase) e.className = clase; if (texto !== undefined) e.textContent = texto; return e; };
const nombreMes = (mes) => { const [a, m] = mes.split("-").map(Number); return new Date(a, m - 1, 1).toLocaleDateString(obtenerLocaleInterfaz(), { month: "long", year: "numeric" }); };

/** ¿Se muestra la pestaña? Con Gastos e ingresos encendido (ahí se crea el primer sobre). */
const pestanaPresupuestoVisible = (modulos) => !!(modulos && modulos.gastos);

/* ===================== Anillo que se vacía ===================== */

function construirAnilloSobre(r, tam = 56) {
  const radio = 22, circ = 2 * Math.PI * radio, nivel = NIVELES[r.nivel] || NIVELES.ok;
  const svg = document.createElementNS(SVG, "svg"); svg.setAttribute("viewBox", "0 0 56 56"); svg.setAttribute("width", String(tam)); svg.setAttribute("height", String(tam)); svg.setAttribute("aria-hidden", "true");
  const pista = document.createElementNS(SVG, "circle"); [["cx", 28], ["cy", 28], ["r", radio], ["fill", "none"], ["stroke-width", 6]].forEach(([k, v]) => pista.setAttribute(k, v)); pista.setAttribute("stroke", "var(--border-glass, rgba(128,128,128,.3))");
  const arco = document.createElementNS(SVG, "circle"); [["cx", 28], ["cy", 28], ["r", radio], ["fill", "none"], ["stroke-width", 6], ["stroke-linecap", "round"], ["transform", "rotate(-90 28 28)"]].forEach(([k, v]) => arco.setAttribute(k, v));
  arco.setAttribute("stroke", nivel.color); arco.setAttribute("stroke-dasharray", `${(circ * r.fraccionRestante).toFixed(2)} ${circ.toFixed(2)}`);
  const txt = document.createElementNS(SVG, "text"); [["x", 28], ["y", 32], ["text-anchor", "middle"], ["font-size", 12], ["fill", "currentColor"]].forEach(([k, v]) => txt.setAttribute(k, v));
  txt.textContent = r.nivel === "sin_periodo" ? "–" : `${Math.round(r.fraccionRestante * 100)}%`;
  svg.append(pista, arco, txt); return svg;
}

/** Glifo + texto del nivel: nunca solo color. */
function insigniaNivel(r) {
  const n = NIVELES[r.nivel] || NIVELES.ok; const sup = r.nivel === "rojo" && r.restante < 0;
  const b = hijo("span", "badge", `${n.glifo} ${t(sup ? "Superado" : n.texto)}`); b.style.cssText = `color:${n.color}; font-weight:600;`; return b;
}

const textoDelSobre = (r) => llenarPlantilla(t(r.plantilla), r.valores, fmt);

function etiquetaPeriodo(s, r) {
  if (!r.periodo) return t(ETIQUETA_PERIODO[s.periodo] || "");
  if (s.periodo === "rango") return `${formatearFechaLarga(r.periodo.desde)} – ${formatearFechaLarga(r.periodo.hasta)}`;
  const n = r.diasRestantes; return `${t(ETIQUETA_PERIODO[s.periodo])} · ${n} ${t(n === 1 ? "día restante" : "días restantes")}`;
}

/* ===================== Tarjeta de un sobre ===================== */

function construirTarjetaSobre(r, { alEditar } = {}) {
  const sobre = (estado.datos.sobres || []).find((x) => x.id === r.id) || {};
  const tarjeta = hijo("section", "glass-card"); tarjeta.style.cssText = "display:grid; grid-template-columns:56px 1fr auto; gap:12px; align-items:center; padding:12px;" + (r.nivel === "rojo" ? " border:3px double var(--danger, #ef4444);" : "");
  const centro = hijo("div", "stack"); centro.style.gap = "2px";
  const nom = hijo("strong", "", r.nombre); const sub = hijo("span", "muted", etiquetaPeriodo(sobre, r)); sub.style.fontSize = "0.8rem";
  const linea = hijo("span", "", textoDelSobre(r));
  const detalle = hijo("span", "muted", r.nivel === "sin_periodo" ? t("Elige las fechas o el semestre para ver el avance.") : `${t("Gastado")} ${fmt(r.gastado)} / ${fmt(r.disponibleTotal)}${r.arrastre > 0 ? " · " + t("incluye") + " " + fmt(r.arrastre) + " " + t("del periodo anterior") : ""}`); detalle.style.fontSize = "0.8rem";
  centro.append(nom, sub, linea, detalle, insigniaNivel(r));
  const editar = boton(t("Editar"), "btn btn-secondary", () => alEditar && alEditar(sobre)); editar.setAttribute("aria-label", `${t("Editar")} ${r.nombre}`);
  tarjeta.append(construirAnilloSobre(r), centro, editar); return tarjeta;
}

/* ===================== Formulario de sobre ===================== */

function abrirFormularioSobre({ sobre = null, alGuardar } = {}) {
  const datos = estado.datos; const { caja, cerrar } = abrirCapa(sobre ? "Editar sobre" : "Nuevo sobre"); const error = lineaError();
  const nombre = entrada(sobre ? sobre.nombre : "", t("Ej. Comida del mes"), 40);
  const limite = entrada(sobre ? String(sobre.limite) : "", "0"); limite.type = "number"; limite.min = "0"; limite.step = "any"; limite.inputMode = "decimal";
  // categorías de gasto (las archivadas solo si ya están en el sobre)
  const marcadas = new Set(sobre ? sobre.categoria_ids : []);
  const cats = listarCategorias(datos, { tipo: "gasto", incluirArchivadas: true }).filter((c) => !c.archivada || marcadas.has(c.id));
  const listaCats = hijo("div", "stack"); listaCats.style.gap = "6px"; listaCats.setAttribute("role", "group"); listaCats.setAttribute("aria-label", t("Categorías del sobre"));
  const checks = new Map();
  cats.forEach((c) => {
    const et = hijo("label", "row"); et.style.cssText = "gap:8px; align-items:center;"; const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = marcadas.has(c.id); checks.set(c.id, cb);
    et.append(cb, hijo("span", "", `${c.emoji || "🏷️"} ${c.nombre}${c.archivada ? " (" + t("archivada") + ")" : ""}`)); listaCats.appendChild(et);
  });
  if (!cats.length) listaCats.appendChild(hijo("p", "muted", t("Primero crea una categoría de gastos (botón Categorías).")));
  const periodo = document.createElement("select"); periodo.className = "form-input";
  PERIODOS.forEach((p) => { const o = document.createElement("option"); o.value = p; o.textContent = t(ETIQUETA_PERIODO[p]); periodo.appendChild(o); }); periodo.value = sobre ? sobre.periodo : "mes";
  const semestre = document.createElement("select"); semestre.className = "form-input";
  const actual = document.createElement("option"); actual.value = ""; actual.textContent = t("El semestre en curso"); semestre.appendChild(actual);
  obtenerTodosLosSemestres().forEach((s) => { const o = document.createElement("option"); o.value = s.id; o.textContent = t(s.nombre); semestre.appendChild(o); }); semestre.value = sobre && sobre.semestre_id ? sobre.semestre_id : "";
  const desde = entrada(sobre && sobre.fecha_inicio ? sobre.fecha_inicio : hoyIso()); desde.type = "date"; const hasta = entrada(sobre && sobre.fecha_fin ? sobre.fecha_fin : ""); hasta.type = "date";
  const filaFechas = hijo("div", "row"); filaFechas.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;"; filaFechas.append(campo("Desde", desde), campo("Hasta", hasta));
  const arrastra = document.createElement("input"); arrastra.type = "checkbox"; arrastra.checked = !!(sobre && sobre.arrastra_sobrante);
  const etArrastra = hijo("label", "row"); etArrastra.style.cssText = "gap:8px; align-items:flex-start;";
  const txtArr = hijo("span", "", t("Si me sobra, pasa al siguiente periodo")); const ayudaArr = hijo("span", "muted", t("Si te pasas, el siguiente periodo empieza de cero.")); ayudaArr.style.cssText = "display:block; font-size:0.78rem;"; txtArr.appendChild(ayudaArr); etArrastra.append(arrastra, txtArr);
  const nota = hijo("p", "muted", t("Un sobre es un registro: no mueve ni bloquea dinero del banco.")); nota.style.cssText = "margin:0; font-size:0.8rem;";

  function ajustar() { semestre.parentElement.classList.toggle("oculto", periodo.value !== "semestre"); filaFechas.classList.toggle("oculto", periodo.value !== "rango"); etArrastra.classList.toggle("oculto", periodo.value !== "semana" && periodo.value !== "mes"); }
  periodo.addEventListener("change", ajustar);
  const campoSem = campo("Semestre", semestre);

  const guardar = () => {
    const base = { nombre: nombre.value, limite: parsearMonto(limite.value), categoriaIds: [...checks].filter(([, cb]) => cb.checked).map(([id]) => id), periodo: periodo.value,
      semestreId: semestre.value || null, fechaInicio: desde.value || null, fechaFin: hasta.value || null, arrastraSobrante: arrastra.checked };
    const r = sobre ? editarSobre(datos, sobre.id, base) : crearSobre(datos, base);
    if (!r.ok) { mostrar(error, MOTIVOS[r.motivo] || MOTIVOS.nombre); return; }
    guardarCambios(alGuardar); cerrar();
  };
  const acciones = hijo("div", "row"); acciones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;"; acciones.append(boton(t("Cancelar"), "btn btn-secondary", cerrar), boton(t("Guardar"), "btn btn-primary", guardar));
  caja.append(campo("Nombre", nombre), campo("Límite", limite), campo("Categorías", listaCats), campo("Periodo", periodo), campoSem, filaFechas, etArrastra, nota, error, acciones);
  if (sobre) {
    const extra = hijo("div", "row"); extra.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
    const quitar = boton(t("Eliminar sobre"), "btn btn-secondary", () => {
      if (quitar.dataset.confirmar !== "1") { quitar.dataset.confirmar = "1"; quitar.textContent = t("Confirmar: eliminar"); mostrar(error, "Eliminar el sobre no borra ningún movimiento ni categoría."); return; }
      eliminarSobre(datos, sobre.id); guardarCambios(alGuardar); cerrar();
    });
    extra.append(boton(t(sobre.archivado ? "Mostrar sobre" : "Archivar sobre"), "btn btn-secondary", () => { archivarSobre(datos, sobre.id, !sobre.archivado); guardarCambios(alGuardar); cerrar(); }), quitar);
    caja.appendChild(extra);
  }
  ajustar(); setTimeout(() => nombre.focus(), 0);
}

/* ===================== Resumen mensual ===================== */

function construirResumenMensual() {
  const hoy = hoyIso(); const actual = hoy.slice(0, 7); const mes = mesElegido || actual; const r = resumenMensual(estado.datos, { mes, hoy });
  const sec = hijo("section", "glass-card stack");
  const cab = hijo("div", "row-between");
  const titulo = hijo("h2", "texto-encabezado-seccion", `${t("Gastos de")} ${nombreMes(mes)}`); titulo.style.margin = "0";
  const nav = hijo("div", "row"); nav.style.gap = "6px";
  const [a, m] = mes.split("-").map(Number); const mover = (n) => { const d = new Date(a, m - 1 + n, 1); mesElegido = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; if (mesElegido === actual) mesElegido = null; renderizarFinanzas(); };
  const ant = boton("‹", "btn btn-secondary", () => mover(-1)); ant.setAttribute("aria-label", t("Mes anterior"));
  const sig = boton("›", "btn btn-secondary", () => mover(1)); sig.setAttribute("aria-label", t("Mes siguiente")); sig.disabled = mes >= actual;
  nav.append(ant, sig); cab.append(titulo, nav); sec.appendChild(cab);

  if (r.gastos.total === 0) { sec.appendChild(hijo("p", "muted", t("Aún no hay gastos en este mes."))); return sec; }
  sec.appendChild(hijo("div", "resumen-hero-cifra", fmt(r.gastos.total)));
  const filas = [...r.gastos.categorias.map((c) => ({ ...c, etiqueta: `${c.emoji || "🏷️"} ${c.nombre}`, color: c.color })), ...(r.gastos.sinCategoria.monto > 0 ? [{ etiqueta: t("Sin categoría"), monto: r.gastos.sinCategoria.monto, porcentaje: r.gastos.sinCategoria.porcentaje, color: "var(--text-muted, #8a8f98)" }] : [])];
  filas.forEach((f) => {
    const fila = hijo("div", "stack"); fila.style.gap = "3px";
    const txt = hijo("div", "row-between"); txt.append(hijo("span", "", f.etiqueta), hijo("span", "", `${fmt(f.monto)} · ${f.porcentaje} %`));
    const barra = hijo("div", ""); barra.style.cssText = "height:6px; border-radius:3px; background:var(--border-glass, rgba(128,128,128,.25)); overflow:hidden;";
    const relleno = hijo("div", ""); relleno.style.cssText = `height:100%; width:${Math.max(2, f.porcentaje)}%; background:${f.color || "var(--accent, #4c8bf5)"};`; barra.appendChild(relleno); fila.append(txt, barra); sec.appendChild(fila);
  });
  // Esencial y Flexible: solo si la persona marcó al menos una categoría. Informativo, sin juicio.
  if (r.gastos.prioridad.esencial > 0 || r.gastos.prioridad.flexible > 0) {
    const p = r.gastos.prioridad;
    const partes = [`${t("Esencial")}: ${fmt(p.esencial)}`, `${t("Flexible")}: ${fmt(p.flexible)}`];
    if (p.sinMarcar > 0) partes.push(`${t("Sin marcar")}: ${fmt(p.sinMarcar)}`);
    const l = hijo("p", "muted", partes.join(" · ")); l.style.margin = "0"; l.setAttribute("data-prioridad", "1"); sec.appendChild(l);
  }
  if (r.comparacion) {
    const d = r.comparacion.diferencia; const plant = d === 0 ? "Gastaste lo mismo que en {mes}" : d < 0 ? "Gastaste {monto} menos que en {mes}" : "Gastaste {monto} más que en {mes}";
    const p = hijo("p", "muted", llenarPlantilla(t(plant), { monto: Math.abs(d) }, fmt).replace("{mes}", nombreMes(r.comparacion.mesAnterior))); p.style.margin = "0"; sec.appendChild(p);
  }
  if (r.ingresos.total > 0) { const p = hijo("p", "muted", `${t("Ingresos del mes")}: ${fmt(r.ingresos.total)}`); p.style.margin = "0"; sec.appendChild(p); }
  return sec;
}

/* ===================== Pestaña ===================== */

function renderizarPestanaPresupuesto(contenedor) {
  const alCambiar = () => renderizarFinanzas();
  const barra = hijo("div", "row"); barra.style.cssText = "display:grid; grid-template-columns:repeat(auto-fit, minmax(0, 1fr)); gap:8px;";
  barra.append(boton("＋ " + t("Nuevo sobre"), "btn btn-primary", () => abrirFormularioSobre({ alGuardar: alCambiar })), boton(t("Categorías"), "btn btn-secondary", () => abrirGestorCategorias({ alCambiar })));
  const sinCat = contarSinCategoria();
  if (sinCat > 0) barra.appendChild(boton(`${t("Categorizar historial")} (${sinCat})`, "btn btn-secondary", () => abrirCategorizarHistorial({ alCambiar })));
  contenedor.appendChild(barra);
  contenedor.appendChild(construirResumenMensual());

  const sobres = listarSobres(estado.datos, hoyIso(), { formato: fmt });
  const sec = hijo("section", "stack"); const h = hijo("h2", "texto-encabezado-seccion", t("Sobres")); h.style.margin = "0"; sec.appendChild(h);
  if (!sobres.length) {
    const vacio = hijo("div", "glass-card stack"); vacio.append(hijo("p", "", t("Crea tu primer sobre: un límite de gasto para una o más categorías.")), boton(t("Crear sobre"), "btn btn-primary", () => abrirFormularioSobre({ alGuardar: alCambiar }))); sec.appendChild(vacio);
  } else sobres.forEach((r) => sec.appendChild(construirTarjetaSobre(r, { alEditar: (s) => abrirFormularioSobre({ sobre: s, alGuardar: alCambiar }) })));
  const archivados = (estado.datos.sobres || []).filter((s) => s.archivado);
  if (archivados.length) {
    const det = hijo("details", ""); det.appendChild(hijo("summary", "muted", `${t("Sobres archivados")} (${archivados.length})`));
    archivados.forEach((s) => { const f = hijo("div", "row-between"); f.style.padding = "6px 0"; f.append(hijo("span", "", s.nombre), boton(t("Editar"), "btn btn-secondary", () => abrirFormularioSobre({ sobre: s, alGuardar: alCambiar }))); det.appendChild(f); });
    sec.appendChild(det);
  }
  contenedor.appendChild(sec);
}

/* ===================== Aviso en el Inicio ===================== */

/** Bloque "Sobres por agotarse" para el Inicio: solo ámbar y rojos. null si no hay ninguno (no ocupa lugar). */
function construirBloqueSobresEnRiesgo() {
  const riesgo = sobresEnRiesgo(estado.datos, hoyIso(), { formato: fmt }); if (!riesgo.length) return null;
  const sec = hijo("section", "glass-card stack"); const h = hijo("h2", "texto-encabezado-seccion", t("Sobres por agotarse")); h.style.margin = "0"; sec.appendChild(h);
  riesgo.slice(0, 3).forEach((r) => {
    const f = hijo("div", ""); f.style.cssText = "display:grid; grid-template-columns:40px 1fr; gap:10px; align-items:center;";
    const c = hijo("div", "stack"); c.style.gap = "1px"; c.append(hijo("strong", "", r.nombre), hijo("span", "", textoDelSobre(r)), insigniaNivel(r));
    f.append(construirAnilloSobre(r, 40), c); sec.appendChild(f);
  });
  sec.appendChild(boton(t("Ver presupuesto"), "btn btn-secondary", () => { estado.finanzasVistaActiva = "presupuesto"; renderizarFinanzas(); }));
  return sec;
}

export { abrirFormularioSobre, construirBloqueSobresEnRiesgo, construirResumenMensual, pestanaPresupuestoVisible, renderizarPestanaPresupuesto };
