/* =========================================================================
   PLAN DE ESTUDIOS — PROYECCIÓN (vista)
   Lo que se agrega debajo de los anillos de Estadísticas:
     · botones "Avance real" y "Proyección" (cada uno abre su propio panel)
     · Avance real: la barra de bloques del plan (verde/amarillo/rojo/azul)
     · Proyección: Ritmo, Rápido, Meta y Plan, más "Mis períodos"
   La lógica de cálculo vive en plan-proyeccion.js (pura, con pruebas).
   Los períodos de la persona se guardan por plan en
   plan.parametros_universidad.proyeccion_periodos (sin ese campo = primera
   vez: se pide confirmarlos antes de proyectar nada).
   Todo el DOM se arma con createElement/textContent, y los textos pasan por
   traducirTextoInterfaz (español/inglés).
   ========================================================================= */

import { obtenerEstadoEfectivoMateria, obtenerEstadoEfectivoSemestre, sellarTimestamp } from "../core/schema.js";
import { obtenerIdiomaActual, traducirTextoInterfaz } from "../core/i18n.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { construirSelectorFinanzas } from "../finanzas/finanzas-selector.js";
import {
  ANIOS_HORIZONTE,
  MESES_EN,
  MESES_ES,
  calcularBloques,
  calcularMeta,
  calcularRitmo,
  crearContexto,
  crearPeriodosPorDefecto,
  creditosDelConjunto,
  duracionMeses,
  generarPeriodos,
  materiasImposibles,
  mejoraConPeriodosApagados,
  normalizarPeriodo,
  normalizarPeriodos,
  simularRuta,
} from "./plan-proyeccion.js";

/* ===================== Utilidades de texto y DOM ===================== */

const t = (es, en) => traducirTextoInterfaz(es, en);
const esIngles = () => obtenerIdiomaActual() === "en";
const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n, es1, esN, en1, enN) => (n === 1 ? t(es1, en1) : t(esN, enN));

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

/** Mes escrito: "marzo" en español (minúscula, va dentro de frases) o "March". */
const mesTexto = (indice) => (esIngles() ? MESES_EN[indice] : MESES_ES[indice]);
const mesTitulo = (indice) => (esIngles() ? MESES_EN[indice] : cap1(MESES_ES[indice]));
const fmtFin = (periodo) => (periodo ? `${mesTexto(periodo.end.getMonth())} ${periodo.end.getFullYear()}` : "—");

function textoDesdeHoy(periodo) {
  if (!periodo) return "";
  const hoy = new Date();
  const meses = (periodo.end.getFullYear() - hoy.getFullYear()) * 12 + periodo.end.getMonth() - hoy.getMonth();
  const a = Math.floor(meses / 12);
  const r = meses % 12;
  const pa = a ? `${a} ${plural(a, "año", "años", "year", "years")}` : "";
  const pr = r ? `${r} ${plural(r, "mes", "meses", "month", "months")}` : "";
  return `≈ ${[pa, pr].filter(Boolean).join(t(" y ", " and "))} ${t("desde hoy", "from today")}`;
}

/* ===================== Estado de esta vista ===================== */

/** Colgado del `estado` global, igual que estadisticasAbiertas. */
function estadoProyeccion() {
  if (!estado.proyeccionPlan) {
    estado.proyeccionPlan = {
      avanceAbierto: false,
      proyAbierta: false,
      modo: "ritmo", // "ritmo" | "minimo" | "meta" | "plan"
      metaMes: 6,
      metaAnio: null,
      editando: false,
      borrador: null, // copia de trabajo de los períodos mientras se editan
      borradorPlanId: null,
      fx: new Set(), // paneles recién abiertos (solo ellos animan su entrada)
    };
  }
  const st = estado.proyeccionPlan;
  if (!st.metaAnio) st.metaAnio = new Date().getFullYear() + 3;
  return st;
}

/* ===================== Datos reales del plan ===================== */

/**
 * Junta lo que hace falta del plan y de los semestres reales.
 * · aprobadas: estado efectivo "aprobado" (una repetición en curso no cuenta).
 * · base de la proyección: aprobadas + lo que se cursa ahora (se supone que se
 *   aprueba al cerrar el semestre actual; el período en curso no se vuelve a
 *   programar).
 * · semestresCompletos: semestres pasados de duración normal (un verano corto
 *   no hace avanzar un bloque). Mide el atraso del Avance real.
 * · periodosCursados: todos los semestres pasados y el actual con materias de
 *   este plan, para el ritmo en créditos por período.
 */
function datosDelPlan(plan) {
  const ctx = crearContexto(plan.materias || []);
  const aprobadas = new Set();
  const cursando = new Set();
  ctx.materias.forEach((m) => {
    const efectivo = obtenerEstadoEfectivoMateria(m, plan.id, estado.datos);
    if (efectivo === "aprobado") aprobadas.add(m.codigo);
    else if (efectivo === "cursando") cursando.add(m.codigo);
  });
  const base = new Set([...aprobadas, ...cursando]);

  const delPlan = (estado.datos.semestres || []).filter((s) => {
    const ids = Array.isArray(s.plan_estudio_id) ? s.plan_estudio_id : [s.plan_estudio_id];
    return ids.includes(plan.id) && (s.materias_matriculadas || []).some((mm) => mm.plan_estudio_id === plan.id);
  });
  const pasados = delPlan.filter((s) => obtenerEstadoEfectivoSemestre(s) === "pasado");
  const actuales = delPlan.filter((s) => obtenerEstadoEfectivoSemestre(s) === "actual");
  const semanasBloque = Number((plan.parametros_universidad || {}).semanas_por_bloque) || 16;
  const semestresCompletos = pasados.filter((s) => (Number(s.duracion_semanas) || semanasBloque) >= semanasBloque * 0.75).length;

  const todas = ctx.materias.length;
  return {
    ctx,
    aprobadas,
    base,
    semestresCompletos,
    periodosCursados: pasados.length + actuales.length,
    completaYa: todas > 0 && aprobadas.size === todas,
    completaAlCerrar: todas > 0 && aprobadas.size !== todas && base.size === todas,
  };
}

/* ===================== Períodos del usuario (guardado por plan) ===================== */

function leerPeriodos(plan) {
  const guardado = (plan.parametros_universidad || {}).proyeccion_periodos;
  if (Array.isArray(guardado)) return { confirmado: true, periodos: normalizarPeriodos(guardado) };
  return { confirmado: false, periodos: crearPeriodosPorDefecto() };
}

function guardarPeriodos(plan, periodos) {
  plan.parametros_universidad = plan.parametros_universidad || {};
  plan.parametros_universidad.proyeccion_periodos = normalizarPeriodos(periodos);
  sellarTimestamp(plan);
  marcarCambioPendiente();
}

const clonar = (periodos) => periodos.map((p) => ({ ...p }));

/** Mantiene la regla amin ≤ min ≤ max ≤ lim al cambiar un valor. */
function aplicarCambioPeriodo(p, clave, valor) {
  p[clave] = valor;
  if (clave === "lim") {
    p.amin = Math.min(p.amin, valor);
    p.max = Math.min(p.max, valor);
    p.min = Math.min(p.min, p.max);
  }
  if (clave === "amin") {
    if (p.min < Math.max(valor, 1)) p.min = Math.max(valor, 1);
    if (p.max < p.min) p.max = p.min;
  }
  if (clave === "min" && p.max < valor) p.max = valor;
  if (clave === "max" && p.min > valor) p.min = valor;
  Object.assign(p, normalizarPeriodo(p));
}

/* ===================== Selector (reutiliza el del repo) ===================== */

const numeros = (a, b) => {
  const salida = [];
  for (let i = a; i <= b; i++) salida.push({ valor: String(i), texto: String(i) });
  return salida;
};

function selector(opciones, actual, alCambiar) {
  const { elemento } = construirSelectorFinanzas({
    opciones,
    valorInicial: String(actual),
    onCambiar: (valor) => alCambiar(Number(valor)),
  });
  const boton = elemento.querySelector(".select-custom-boton");
  if (boton) boton.classList.add("pe-compacto");
  return elemento;
}

const opcionesMeses = () => Array.from({ length: 12 }, (_, i) => ({ valor: String(i + 1), texto: mesTitulo(i) }));

function campo(rotulo, control) {
  const caja = el("div");
  caja.append(el("label", "form-label", rotulo), control);
  return caja;
}

/* ===================== Piezas pequeñas ===================== */

function resultado(rotulo, fecha, desde, mediano = false) {
  const caja = el("div", "pe-resultado");
  caja.appendChild(el("span", "pe-res-cap", rotulo));
  caja.appendChild(el("span", "pe-res-fecha" + (mediano ? " med" : ""), fecha));
  if (desde) caja.appendChild(el("span", "pe-res-desde", desde));
  return caja;
}

const resultadoCompleta = () => resultado(t("Estado", "Status"), t("¡Carrera completa!", "Degree complete!"), "");
const resultadoAlCerrar = () =>
  resultado(t("Estado", "Status"), t("Terminas al cerrar tu semestre actual", "You finish when your current semester ends"), "", true);

/** Aviso con puntito de color. `partes`: textos sueltos y {b: "texto en negrita"}. */
function aviso(clase, partes) {
  const caja = el("div", "pe-aviso" + (clase ? ` ${clase}` : ""));
  (Array.isArray(partes) ? partes : [partes]).forEach((p) => {
    if (typeof p === "string") caja.appendChild(document.createTextNode(p));
    else caja.appendChild(el("b", "", p.b));
  });
  return caja;
}

function cifras(items) {
  const caja = el("div", "pe-cifras");
  items.forEach(([valor, rotulo]) => {
    const c = el("div");
    c.append(el("b", "", String(valor)), el("span", "", rotulo));
    caja.appendChild(c);
  });
  return caja;
}

const nota = (texto) => el("p", "pe-nota", texto);

/** Color de la franja de cada materia: el de su categoría, como en las tarjetas del plan. */
function colorMateria(plan, materia) {
  const categoria = (plan.categorias || []).find((c) => c.id === materia.categoria_id);
  return categoria && categoria.color ? categoria.color : "var(--text-muted)";
}

function listaPeriodos(plan, ruta) {
  const caja = el("div", "pe-filas");
  ruta.forEach((x) => {
    const p = x.periodo;
    const dentro = x.creditos >= p.min && x.creditos <= p.max;
    const bajoMinimo = x.creditos < p.amin;
    const fila = el("div", "pe-fila-per");
    const cab = el("div");
    cab.appendChild(el("b", "", p.nombre));
    cab.appendChild(el("small", "", `${mesTitulo(p.start.getMonth())} ${t("a", "to")} ${mesTexto(p.end.getMonth())}`));
    const clase = bajoMinimo ? "badge-danger" : dentro ? "badge-success" : "badge-warning";
    fila.append(cab, el("span", `badge ${clase}`, `${x.creditos} ${t("cr", "cr")}`));

    const materias = el("div", "pe-chips");
    x.materias.forEach((m) => {
      const chip = el("span", "pe-chip-mat");
      chip.style.setProperty("--c", colorMateria(plan, m));
      chip.title = m.codigo;
      chip.appendChild(document.createTextNode(m.nombre));
      chip.appendChild(el("small", "", `${Number(m.creditos) || 0} ${t("cr", "cr")}`));
      materias.appendChild(chip);
    });
    fila.appendChild(materias);
    caja.appendChild(fila);
  });
  return caja;
}

/* ===================== Avance real: barra de bloques ===================== */

function construirAvanceReal(datos, animar) {
  const { bloques, meta } = calcularBloques(datos.ctx, datos.aprobadas, datos.semestresCompletos);
  const raiz = el("div", "pe-bloques" + (animar ? " pe-fade" : ""));

  const balanceBloques = el("div", "pe-balance");
  const filaBloques = el("div", "pe-fila");
  bloques.forEach((b) => {
    const col = el("div", "pe-seg-col");
    const seg = el("div", `pe-seg ${b.clase}`.trim(), String(b.bloque));
    seg.title =
      `${t("Bloque", "Block")} ${b.bloque} · ${b.aprobadas} ${t("de", "of")} ${b.total} ${t("aprobadas", "passed")}` +
      (b.esMeta ? ` · ${t("aquí deberías ir", "you should be here")}` : "");
    col.append(seg, el("i", "pe-marca" + (b.esMeta ? " on" : "")));
    filaBloques.appendChild(col);
  });
  balanceBloques.appendChild(filaBloques);
  raiz.appendChild(balanceBloques);

  const titulo = el("div", "donut-bloque");
  titulo.appendChild(el("span", "donut-etiqueta", t("Bloques del plan", "Plan blocks")));
  raiz.appendChild(titulo);

  const presentes = new Set(bloques.map((b) => b.clase));
  const leyenda = el("div", "pe-leyenda pe-balance");
  const filaLeyenda = el("div", "pe-fila");
  [
    ["done", t("Completo", "Complete")],
    ["part", t("A medias", "Partial")],
    ["none", t("Sin avance", "No progress")],
    ["ahead", t("Adelantado", "Ahead")],
    ["", t("Por cursar", "Upcoming")],
  ]
    .filter(([clave]) => presentes.has(clave))
    .forEach(([clave, texto]) => {
      const item = el("span");
      item.append(el("i", clave), document.createTextNode(texto));
      filaLeyenda.appendChild(item);
    });
  if (meta) {
    const item = el("span");
    item.append(el("i", "mk"), document.createTextNode(t("Deberías ir aquí", "You should be here")));
    filaLeyenda.appendChild(item);
  }
  leyenda.appendChild(filaLeyenda);
  raiz.appendChild(leyenda);
  return raiz;
}

/* ===================== Mis períodos (editor) ===================== */

function construirEditorPeriodos(borrador, rerender) {
  const frag = document.createDocumentFragment();

  borrador.forEach((p, i) => {
    const tarjeta = el("div", "pe-per" + (p.on ? " on" : ""));

    const cab = el("div", "pe-per-cab");
    cab.setAttribute("role", "checkbox");
    cab.setAttribute("aria-checked", String(p.on));
    cab.setAttribute("aria-label", `${t("Llevaría", "I would take")} ${p.nombre}`);
    cab.tabIndex = 0;
    const alternar = () => {
      p.on = !p.on;
      rerender();
    };
    cab.addEventListener("click", (e) => {
      if (e.target.closest("input") || e.target.closest(".pe-x")) return;
      alternar();
    });
    cab.addEventListener("keydown", (e) => {
      if (e.target !== cab) return;
      if (e.key === " " || e.key === "Enter") {
        e.preventDefault();
        alternar();
      }
    });
    const luz = el("i", "pe-luz" + (p.on ? " on" : ""));
    const nombre = el("input", "form-input pe-compacto");
    nombre.value = p.nombre;
    nombre.setAttribute("aria-label", t("Nombre del período", "Period name"));
    nombre.addEventListener("input", () => {
      p.nombre = nombre.value;
    });
    nombre.addEventListener("change", () => {
      p.nombre = nombre.value.trim() || t("Período", "Period");
      nombre.value = p.nombre;
    });
    const quitar = el("button", "pe-x", "✕");
    quitar.type = "button";
    quitar.setAttribute("aria-label", t("Quitar período", "Remove period"));
    quitar.addEventListener("click", () => {
      borrador.splice(i, 1);
      rerender();
    });
    cab.append(luz, nombre, quitar);
    tarjeta.appendChild(cab);

    const grupos = el("div", "pe-per-grupos" + (p.on ? "" : " apagado"));
    const cambiar = (clave) => (valor) => {
      aplicarCambioPeriodo(p, clave, valor);
      rerender();
    };
    const grupo = (titulo, lateral, controles, notaTexto) => {
      const g = el("div", "pe-grupo");
      const gt = el("div", "pe-grupo-t");
      gt.append(el("b", "", titulo), el("span", "", lateral));
      const par = el("div", "pe-par");
      controles.forEach(([rotulo, ctrl]) => par.appendChild(campo(rotulo, ctrl)));
      g.append(gt, par);
      if (notaTexto) g.appendChild(el("p", "pe-nota-g", notaTexto));
      return g;
    };

    const dur = duracionMeses(p);
    grupos.appendChild(
      grupo(
        t("Período lectivo", "School period"),
        `${dur} ${plural(dur, "mes", "meses", "month", "months")}`,
        [
          [t("Empieza", "Starts"), selector(opcionesMeses(), p.ini, cambiar("ini"))],
          [t("Termina", "Ends"), selector(opcionesMeses(), p.fin, cambiar("fin"))],
        ]
      )
    );
    const opcionesAmin = [{ valor: "0", texto: t("Sin mínimo", "No minimum") }, ...numeros(1, p.lim)];
    grupos.appendChild(
      grupo(
        t("Rango absoluto", "Absolute range"),
        t("créditos", "credits"),
        [
          [t("Mínimo de matrícula", "Minimum enrollment"), selector(opcionesAmin, p.amin, cambiar("amin"))],
          [t("Máximo de matrícula", "Maximum enrollment"), selector(numeros(1, 30), p.lim, cambiar("lim"))],
        ],
        t("Lo que permite la universidad. Más allá de esto no se puede.", "What the university allows. Nothing beyond this is possible.")
      )
    );
    grupos.appendChild(
      grupo(
        t("Rango deseado", "Preferred range"),
        t("créditos", "credits"),
        [
          [t("Mínimo que prefiero", "Minimum I prefer"), selector(numeros(Math.max(p.amin, 1), p.max), p.min, cambiar("min"))],
          [t("Máximo que prefiero", "Maximum I prefer"), selector(numeros(p.min, p.lim), p.max, cambiar("max"))],
        ],
        t("Lo que te gustaría llevar. Puede ser menos que el máximo permitido.", "What you would like to take. It can be less than the allowed maximum.")
      )
    );
    tarjeta.appendChild(grupos);
    frag.appendChild(tarjeta);
  });

  const agregar = el("div", "pe-proy-add");
  const botonAgregar = el("button", "pe-btn-mini", t("+ Agregar período", "+ Add period"));
  botonAgregar.type = "button";
  botonAgregar.addEventListener("click", () => {
    borrador.push({
      nombre: `${t("Período", "Period")} ${borrador.length + 1}`,
      ini: 1,
      fin: 2,
      on: true,
      amin: 0,
      lim: 12,
      min: 6,
      max: 10,
    });
    rerender();
  });
  agregar.appendChild(botonAgregar);
  frag.appendChild(agregar);
  return frag;
}

/* ===================== Modos de proyección ===================== */

function avisoSinRuta(datos, ruta) {
  if (ruta.completo) return null;
  const imposibles = materiasImposibles(datos.ctx, datos.base);
  if (imposibles.length) {
    return aviso("bad", [
      `${imposibles.length} ${plural(imposibles.length, "materia no se puede desbloquear", "materias no se pueden desbloquear", "course cannot be unlocked", "courses cannot be unlocked")} ${t("con los requisitos del plan", "with the plan's requirements")} (${imposibles[0].codigo}${imposibles.length > 1 ? ", …" : ""}).`,
    ]);
  }
  return aviso("warn", t(`Con estos períodos no se alcanza a terminar en ${ANIOS_HORIZONTE} años.`, `With these periods you would not finish within ${ANIOS_HORIZONTE} years.`));
}

function modoRitmo(datos, periodos) {
  const futuros = generarPeriodos(periodos);
  const r = calcularRitmo(
    { creditosAprobados: creditosDelConjunto(datos.ctx, datos.base), creditosTotales: datos.ctx.creditosTotales, periodosCursados: datos.periodosCursados },
    futuros
  );
  const frag = document.createDocumentFragment();
  if (r.sinDatos) {
    frag.appendChild(resultado(t("Con tu ritmo actual", "At your current pace"), t("Sin datos todavía", "No data yet"), t("Necesitamos al menos un semestre cursado.", "We need at least one semester completed."), true));
    return frag;
  }
  frag.appendChild(
    resultado(
      t("A este ritmo terminarías en", "At this pace you would finish in"),
      r.fin ? cap1(fmtFin(r.fin)) : t(`más de ${ANIOS_HORIZONTE} años`, `more than ${ANIOS_HORIZONTE} years`),
      r.fin ? textoDesdeHoy(r.fin) : ""
    )
  );
  frag.appendChild(
    cifras([
      [`${r.ritmo.toFixed(1)} ${t("cr", "cr")}`, t("por período", "per period")],
      [r.n, t("períodos por delante", "periods ahead")],
      [`${r.falta} ${t("cr", "cr")}`, t("por aprobar", "left to pass")],
    ])
  );
  return frag;
}

function modoRapido(plan, datos, periodos) {
  const ruta = simularRuta(datos.ctx, datos.base, "todo", generarPeriodos(periodos));
  const frag = document.createDocumentFragment();
  frag.appendChild(
    resultado(t("Lo más pronto posible", "As soon as possible"), ruta.completo ? cap1(fmtFin(ruta.fin)) : "—", ruta.fin ? textoDesdeHoy(ruta.fin) : "")
  );
  const problema = avisoSinRuta(datos, ruta);
  if (problema) frag.appendChild(problema);
  if (ruta.plan.length) frag.appendChild(listaPeriodos(plan, ruta.plan));
  frag.appendChild(nota(t("Mínimo teórico: aprobando todo y sin considerar la oferta real de cada semestre.", "Theoretical minimum: passing everything and ignoring each semester's real course offering.")));
  return frag;
}

function modoPlan(plan, datos, periodos) {
  const ruta = simularRuta(datos.ctx, datos.base, "rango", generarPeriodos(periodos));
  const frag = document.createDocumentFragment();
  frag.appendChild(
    resultado(t("Plan sugerido, terminarías en", "Suggested plan, you would finish in"), ruta.completo ? cap1(fmtFin(ruta.fin)) : "—", ruta.fin ? textoDesdeHoy(ruta.fin) : "")
  );
  const mejora = mejoraConPeriodosApagados(datos.ctx, datos.base, periodos, ruta);
  if (mejora) {
    frag.appendChild(
      aviso("", [
        `${t("Sumando", "Adding")} ${mejora.nombres.join(t(" y ", " and "))} ${t("terminarías en", "you would finish in")} `,
        { b: fmtFin(mejora.fin) },
        `, ${mejora.meses} ${plural(mejora.meses, "mes", "meses", "month", "months")} ${t("antes.", "earlier.")}`,
      ])
    );
  }
  const problema = avisoSinRuta(datos, ruta);
  if (problema) frag.appendChild(problema);
  if (ruta.plan.length) frag.appendChild(listaPeriodos(plan, ruta.plan));
  frag.appendChild(nota(t("Ruta lógica, no exacta: la oferta real por semestre puede variar.", "Logical route, not exact: the real course offering per semester may vary.")));
  return frag;
}

function modoMeta(datos, periodos, st, rerender) {
  const frag = document.createDocumentFragment();
  const anioActual = new Date().getFullYear();

  const ctrl = el("div", "pe-ctrl");
  ctrl.appendChild(el("label", "form-label", t("Terminar a más tardar en", "Finish no later than")));
  const fila = el("div", "pe-meta-sel");
  fila.appendChild(
    selector(opcionesMeses(), st.metaMes, (valor) => {
      st.metaMes = valor;
      rerender();
    })
  );
  fila.appendChild(
    selector(numeros(anioActual, anioActual + 10), st.metaAnio, (valor) => {
      st.metaAnio = valor;
      rerender();
    })
  );
  ctrl.appendChild(fila);
  frag.appendChild(ctrl);

  const limite = new Date(st.metaAnio, st.metaMes, 0);
  const m = calcularMeta(datos.ctx, datos.base, periodos, limite);
  if (m.sinPeriodos) {
    frag.appendChild(aviso("bad", t("Antes de esa fecha no hay períodos. Elige una fecha más adelante o activa más períodos.", "There are no periods before that date. Pick a later date or turn on more periods.")));
    return frag;
  }

  frag.appendChild(
    resultado(
      t("Necesitas llevar en promedio", "You need to take on average"),
      `${m.porPeriodo} ${t("créditos por período", "credits per period")}`,
      `${m.falta} ${t("créditos en", "credits in")} ${m.n} ${plural(m.n, "período", "períodos", "period", "periods")}`,
      true
    )
  );

  const textos = {
    imposible: ["bad", [t("Con los requisitos del plan no se puede terminar para esa fecha.", "With the plan's requirements you cannot finish by that date.")]],
    prerrequisitos: [
      "bad",
      [t("Aun llevando todo lo disponible, lo más pronto sería ", "Even taking everything available, the earliest would be "), { b: fmtFin(m.minimoFin) }, t(": los prerrequisitos no dejan llegar antes.", ": the prerequisites don't let you get there sooner.")],
    ],
    limite: ["bad", [t(`No alcanza ni cargando al límite de cada período (máximo ${m.capLim} créditos en este tiempo).`, `Not even loading each period to its limit is enough (maximum ${m.capLim} credits in this time).`)]],
    sobre: ["warn", [t(`Queda por encima de tu rango (${m.capMax} créditos), pero cabe dentro de los límites de cada período.`, `It is above your preferred range (${m.capMax} credits), but fits within each period's limits.`)]],
    dentro: ["ok", [t(`Cabe dentro de tu rango (entre ${m.capMin} y ${m.capMax} créditos en este tiempo).`, `It fits your preferred range (between ${m.capMin} and ${m.capMax} credits in this time).`)]],
    margen: ["ok", [t(`Te sobra margen: con el mínimo de tu rango (${m.capMin} créditos) ya llegas.`, `You have room to spare: the minimum of your range (${m.capMin} credits) is enough.`)]],
  };
  const [clase, partes] = textos[m.clave];
  frag.appendChild(aviso(clase, partes));

  if (m.conApagados) {
    frag.appendChild(
      aviso("", [
        `${t("Sumando", "Adding")} ${m.conApagados.nombres.join(t(" y ", " and "))} ${t("bajarías a unos ", "you would drop to about ")}`,
        { b: `${m.conApagados.porPeriodo} ${t("créditos", "credits")}` },
        ` ${t("por período.", "per period.")}`,
      ])
    );
  }
  return frag;
}

/* ===================== Panel de Proyección ===================== */

function construirProyeccion(plan, datos, st, rerender, animar) {
  const { confirmado, periodos: guardados } = leerPeriodos(plan);
  const raiz = el("div", "pe-proy" + (animar ? " pe-fade" : ""));
  const cabecera = (titulo, textoBoton, acento, alTocar) => {
    const cab = el("div", "pe-proy-cab");
    const boton = el("button", "pe-btn-mini" + (acento ? " acento" : ""), textoBoton);
    boton.type = "button";
    boton.addEventListener("click", alTocar);
    cab.append(el("b", "", titulo), boton);
    return cab;
  };

  // Primera vez (sin períodos confirmados) o editando: editor sobre la copia de trabajo.
  if (!confirmado || st.editando) {
    if (!st.borrador || st.borradorPlanId !== plan.id) {
      st.borrador = clonar(guardados);
      st.borradorPlanId = plan.id;
    }
    const terminar = () => {
      guardarPeriodos(plan, st.borrador);
      st.borrador = null;
      st.editando = false;
      st.fx.add("proy");
      rerender();
    };
    raiz.appendChild(
      confirmado
        ? cabecera(t("Mis períodos", "My periods"), t("Listo", "Done"), true, terminar)
        : cabecera(t("Define tus períodos", "Set your periods"), t("Continuar", "Continue"), true, terminar)
    );
    raiz.appendChild(construirEditorPeriodos(st.borrador, rerender));
    return raiz;
  }

  raiz.appendChild(
    cabecera(t("Proyección", "Projection"), t("Editar períodos", "Edit periods"), false, () => {
      st.editando = true;
      st.borrador = clonar(guardados);
      st.borradorPlanId = plan.id;
      st.fx.add("proy");
      rerender();
    })
  );

  const pills = el("div", "pill-group pe-pills-full");
  pills.setAttribute("role", "tablist");
  [
    ["ritmo", t("Ritmo", "Pace")],
    ["minimo", t("Rápido", "Fast")],
    ["meta", t("Meta", "Goal")],
    ["plan", t("Plan", "Plan")],
  ].forEach(([clave, texto]) => {
    const pill = el("button", "pill-item" + (st.modo === clave ? " active" : ""), texto);
    pill.type = "button";
    pill.addEventListener("click", () => {
      st.modo = clave;
      rerender();
    });
    pills.appendChild(pill);
  });
  raiz.appendChild(pills);

  if (datos.completaYa) raiz.appendChild(resultadoCompleta());
  else if (datos.completaAlCerrar) raiz.appendChild(resultadoAlCerrar());
  else if (!guardados.some((p) => p.on)) {
    raiz.appendChild(aviso("bad", t("No hay períodos activos. Toca “Editar períodos” y enciende al menos uno.", "There are no active periods. Tap “Edit periods” and turn on at least one.")));
  } else if (st.modo === "ritmo") raiz.appendChild(modoRitmo(datos, guardados));
  else if (st.modo === "minimo") raiz.appendChild(modoRapido(plan, datos, guardados));
  else if (st.modo === "meta") raiz.appendChild(modoMeta(datos, guardados, st, rerender));
  else raiz.appendChild(modoPlan(plan, datos, guardados));
  return raiz;
}

/* ===================== Balanceo de filas (bloques y leyenda) ===================== */

/**
 * Si una fila no cabe, se parte en dos filas parejas y centradas (la de
 * arriba lleva la mitad o una más). Se recalcula al cambiar el ancho.
 */
function balancear() {
  document.querySelectorAll(".pe-balance").forEach((contenedor) => {
    const filas = [...contenedor.children];
    const primera = filas[0];
    if (!primera) return;
    filas.slice(1).forEach((fila) => {
      [...fila.children].forEach((item) => primera.appendChild(item));
      fila.remove();
    });
    if (primera.offsetWidth <= contenedor.clientWidth) return;
    const items = [...primera.children];
    const segunda = el("div", primera.className);
    items.slice(Math.ceil(items.length / 2)).forEach((item) => segunda.appendChild(item));
    contenedor.appendChild(segunda);
  });
}

let balanceoRegistrado = false;
function programarBalanceo() {
  if (!balanceoRegistrado) {
    balanceoRegistrado = true;
    window.addEventListener("resize", balancear);
  }
  requestAnimationFrame(balancear);
}

/* ===================== Punto de entrada ===================== */

/**
 * Nodos que se agregan en Estadísticas debajo de los anillos, en orden:
 * [panel de Avance real, si está abierto] · [botones] · [panel de Proyección, si está abierto].
 * `rerender` vuelve a pintar toda la sección (renderizarPlanEstudios).
 */
function construirExtrasEstadisticas(plan, rerender) {
  const st = estadoProyeccion();
  const datos = datosDelPlan(plan);
  const nodos = [];

  if (st.avanceAbierto) nodos.push(construirAvanceReal(datos, st.fx.has("av")));

  const acciones = el("div", "pe-acciones");
  const boton = (texto, activo, alTocar) => {
    const b = el("button", "pe-btn-pill" + (activo ? " active" : ""), texto);
    b.type = "button";
    b.setAttribute("aria-pressed", String(activo));
    b.addEventListener("click", alTocar);
    return b;
  };
  acciones.append(
    boton(t("Avance real", "Actual progress"), st.avanceAbierto, () => {
      st.avanceAbierto = !st.avanceAbierto;
      if (st.avanceAbierto) st.fx.add("av");
      rerender();
    }),
    boton(t("Proyección", "Projection"), st.proyAbierta, () => {
      st.proyAbierta = !st.proyAbierta;
      st.editando = false;
      if (leerPeriodos(plan).confirmado) st.borrador = null;
      if (st.proyAbierta) st.fx.add("proy");
      rerender();
    })
  );
  nodos.push(acciones);

  if (st.proyAbierta) nodos.push(construirProyeccion(plan, datos, st, rerender, st.fx.has("proy")));

  st.fx.clear();
  programarBalanceo();
  return nodos;
}

export { construirExtrasEstadisticas };
