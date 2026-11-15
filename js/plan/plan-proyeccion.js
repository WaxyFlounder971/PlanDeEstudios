/* =========================================================================
   PLAN DE ESTUDIOS — PROYECCIÓN (lógica pura, sin DOM)
   Todo lo que calcula el panel "Avance real" y "Proyección" de Estadísticas:
   estado de los bloques, ritmo, ruta más rápida, plan sugerido y meta.
   No lee `estado` ni toca el DOM: recibe materias y conjuntos de códigos y
   devuelve datos, así se prueba en Node (tests/plan-proyeccion-logica.mjs).

   Reglas de requisitos: se reutiliza evaluarNodoRequisito de core/schema.js
   (el mismo árbol Y/O que usa la luz de disponibilidad del plan), así la
   proyección y el candado del plan siempre coinciden. Una hoja cumple solo
   si esa materia está en el conjunto de aprobadas (igual que
   materiaDisponible en plan-vista-lista-tarjetas.js).
   ========================================================================= */

import { evaluarNodoRequisito, recorrerHojasArbol } from "../core/schema.js";

const MESES_ES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const MESES_EN = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Años hacia adelante que se proyectan antes de rendirse ("más de 14 años"). */
const ANIOS_HORIZONTE = 14;

/* ===================== Períodos del usuario ===================== */

/**
 * Valores de ejemplo que se muestran la primera vez. NO se usan para
 * calcular nada hasta que la persona los confirma (se guardan en
 * plan.parametros_universidad.proyeccion_periodos).
 * ini/fin = mes de inicio y fin (1-12; si fin < ini el período cruza de año).
 * amin/lim = rango absoluto (mínimo y máximo de matrícula permitidos).
 * min/max = rango deseado (lo que la persona prefiere llevar).
 */
function crearPeriodosPorDefecto() {
  return [
    { nombre: "I Semestre", ini: 2, fin: 6, on: true, amin: 0, lim: 18, min: 12, max: 16 },
    { nombre: "II Semestre", ini: 8, fin: 11, on: true, amin: 0, lim: 18, min: 12, max: 16 },
    { nombre: "Verano", ini: 12, fin: 1, on: false, amin: 0, lim: 8, min: 3, max: 6 },
  ];
}

function acotar(valor, minimo, maximo, porDefecto) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return porDefecto;
  return Math.min(maximo, Math.max(minimo, n));
}

/** Deja un período siempre coherente: amin ≤ min ≤ max ≤ lim. */
function normalizarPeriodo(p) {
  const origen = p || {};
  const lim = acotar(origen.lim, 1, 40, 18);
  const amin = acotar(origen.amin, 0, lim, 0);
  const max = acotar(origen.max, Math.max(amin, 1), lim, lim);
  const min = acotar(origen.min, Math.max(amin, 1), max, max);
  return {
    nombre: String(origen.nombre || "").trim() || "Período",
    ini: acotar(origen.ini, 1, 12, 1),
    fin: acotar(origen.fin, 1, 12, 1),
    on: origen.on !== false,
    amin,
    lim,
    min,
    max,
  };
}

function normalizarPeriodos(lista) {
  return (Array.isArray(lista) ? lista : []).map(normalizarPeriodo);
}

/** Duración en meses de un período (cuenta ambos extremos). */
function duracionMeses(p) {
  return ((p.fin - p.ini + 12) % 12) + 1;
}

/**
 * Períodos futuros a partir de `hoy`, ordenados por fecha. El período que ya
 * está en curso (su inicio ya pasó) no entra: lo que se cursa ahora se
 * trata aparte. `todos` incluye también los períodos apagados (para avisar
 * "sumando Verano terminarías antes").
 */
function generarPeriodos(periodos, hoy = new Date(), todos = false) {
  const salida = [];
  for (let y = hoy.getFullYear() - 1; y <= hoy.getFullYear() + ANIOS_HORIZONTE; y++) {
    periodos.forEach((p) => {
      if (!p.on && !todos) return;
      const start = new Date(y, p.ini - 1, 1);
      const cruza = p.fin < p.ini;
      const end = new Date(cruza ? y + 1 : y, p.fin, 0);
      if (start <= hoy) return;
      const sufijo = cruza ? `${y}/${String(y + 1).slice(2)}` : String(y);
      salida.push({ nombre: `${p.nombre} ${sufijo}`, start, end, amin: p.amin || 0, lim: p.lim, min: p.min, max: p.max });
    });
  }
  return salida.sort((a, b) => a.start - b.start);
}

/** Meses completos entre el fin de dos períodos (a posterior a b → positivo). */
function mesesEntre(fechaFinal, fechaInicial) {
  return (fechaFinal.getFullYear() - fechaInicial.getFullYear()) * 12 + fechaFinal.getMonth() - fechaInicial.getMonth();
}

/* ===================== Contexto del plan ===================== */

/**
 * Prepara las materias del plan para calcular. El orden del arreglo es el
 * orden de aparición en el plan de estudios. `dependientes` cuenta cuántas
 * materias tienen a cada código en su árbol de requisitos o correquisitos
 * (mismo criterio que obtenerMateriasQueDesbloquea).
 */
function crearContexto(materias) {
  const lista = (materias || []).filter((m) => m && m.codigo);
  const porCodigo = new Map(lista.map((m) => [m.codigo, m]));
  const orden = new Map(lista.map((m, i) => [m.codigo, i]));
  const dependientes = new Map();
  lista.forEach((m) => {
    [m.requisitos, m.correquisitos].forEach((nodo) =>
      recorrerHojasArbol(nodo, (hoja) => dependientes.set(hoja.valor, (dependientes.get(hoja.valor) || 0) + 1))
    );
  });
  const creditosTotales = lista.reduce((s, m) => s + (Number(m.creditos) || 0), 0);
  return { materias: lista, porCodigo, orden, dependientes, creditosTotales };
}

const creditosDe = (m) => Number(m.creditos) || 0;

function creditosDelConjunto(ctx, codigos) {
  return ctx.materias.filter((m) => codigos.has(m.codigo)).reduce((s, m) => s + creditosDe(m), 0);
}

function cumpleRequisitos(m, hecho) {
  return evaluarNodoRequisito(m.requisitos, (codigo) => hecho.has(codigo));
}

/**
 * Correquisito: se puede llevar en el MISMO período o haberse aprobado antes.
 * Un código que no existe en el plan no se puede exigir: se da por cumplido.
 */
function cumpleCorrequisitos(ctx, m, hecho, enEstePeriodo) {
  return evaluarNodoRequisito(m.correquisitos, (codigo) => !ctx.porCodigo.has(codigo) || hecho.has(codigo) || enEstePeriodo.has(codigo));
}

/** Materias que ya se podrían llevar hoy (sin aprobar y con requisitos cumplidos). */
function materiasDisponibles(ctx, aprobadas) {
  return ctx.materias.filter((m) => !aprobadas.has(m.codigo) && cumpleRequisitos(m, aprobadas));
}

/**
 * Materias que NUNCA se podrían desbloquear aunque se aprobara todo lo
 * disponible (por ejemplo, un requisito que apunta a una materia que no está
 * en el plan). Sirve para avisar en vez de mostrar una fecha falsa.
 */
function materiasImposibles(ctx, aprobadas) {
  const hecho = new Set(aprobadas);
  let cambio = true;
  while (cambio) {
    cambio = false;
    ctx.materias.forEach((m) => {
      if (!hecho.has(m.codigo) && cumpleRequisitos(m, hecho)) {
        hecho.add(m.codigo);
        cambio = true;
      }
    });
  }
  return ctx.materias.filter((m) => !hecho.has(m.codigo));
}

/* ===================== Motor: ruta período por período ===================== */

/**
 * modo "todo": llena hasta el máximo absoluto de cada período (lo más rápido).
 * modo "rango": llena hasta el máximo DESEADO de cada período (plan sugerido).
 * En cada período se llevan solo materias ya disponibles al empezarlo (lo
 * que se desbloquea en un período se puede llevar desde el siguiente) y se
 * priorizan las que desbloquean más materias. Se supone que se aprueba todo
 * lo que se lleva y no se considera la oferta real de cada semestre.
 */
function simularRuta(ctx, aprobadasIniciales, modo, periodos) {
  const hecho = new Set(aprobadasIniciales);
  const pendientes = new Set(ctx.materias.filter((m) => !hecho.has(m.codigo)).map((m) => m.codigo));
  const plan = [];

  for (const periodo of periodos) {
    if (!pendientes.size) break;
    const disponibles = ctx.materias.filter((m) => pendientes.has(m.codigo) && cumpleRequisitos(m, hecho));
    if (!disponibles.length) break; // nada nuevo se puede llevar: no cambia con más períodos
    const tope = modo === "todo" ? periodo.lim : periodo.max;
    disponibles.sort(
      (a, b) =>
        (ctx.dependientes.get(b.codigo) || 0) - (ctx.dependientes.get(a.codigo) || 0) ||
        ctx.orden.get(a.codigo) - ctx.orden.get(b.codigo)
    );

    let total = 0;
    let tomar = [];
    for (const m of disponibles) {
      const cr = creditosDe(m);
      if (cr === 0 || total + cr <= tope) {
        tomar.push(m);
        total += cr;
      }
    }

    // Correquisitos: una materia solo se lleva si su correquisito ya está
    // aprobado o entra en este mismo período. Se repite hasta que quede estable.
    let cambio = true;
    while (cambio) {
      cambio = false;
      const codigos = new Set(tomar.map((m) => m.codigo));
      const filtradas = tomar.filter((m) => cumpleCorrequisitos(ctx, m, hecho, codigos));
      if (filtradas.length !== tomar.length) {
        tomar = filtradas;
        cambio = true;
      }
    }
    if (!tomar.length) continue;

    total = tomar.reduce((s, m) => s + creditosDe(m), 0);
    tomar.sort((a, b) => ctx.orden.get(a.codigo) - ctx.orden.get(b.codigo));
    plan.push({ periodo, materias: tomar, creditos: total });
    tomar.forEach((m) => {
      hecho.add(m.codigo);
      pendientes.delete(m.codigo);
    });
  }

  const completo = pendientes.size === 0;
  return { plan, completo, fin: completo && plan.length ? plan[plan.length - 1].periodo : null };
}

/* ===================== Avance real: estado de los bloques ===================== */

/**
 * Un bloque por número de bloque (≥ 1) con cuántas de sus materias están
 * aprobadas. `semestresCompletos` es la cantidad de semestres ya cursados;
 * el bloque donde "deberías ir" es el siguiente (completos + 1).
 * Clase de cada bloque:
 *   done  = todas aprobadas · ahead = completo antes de tiempo
 *   part  = va atrasado pero tiene al menos una aprobada
 *   none  = va atrasado y no tiene ni una aprobada
 *   cur   = el bloque donde deberías ir (si no está completo)
 *   ""    = todavía no te toca
 */
function calcularBloques(ctx, aprobadas, semestresCompletos) {
  const numeros = [...new Set(ctx.materias.map((m) => Number(m.bloque)).filter((b) => Number.isInteger(b) && b >= 1))].sort((a, b) => a - b);
  const maximo = numeros.length ? numeros[numeros.length - 1] : 0;
  const meta = semestresCompletos > 0 && maximo ? Math.min(semestresCompletos + 1, maximo) : 0;
  const bloques = numeros.map((b) => {
    const ms = ctx.materias.filter((m) => Number(m.bloque) === b);
    const ap = ms.filter((m) => aprobadas.has(m.codigo)).length;
    let clase = "";
    if (ap === ms.length) clase = semestresCompletos && b > meta ? "ahead" : "done";
    else if (b === meta) clase = "cur";
    else if (b < meta) clase = ap > 0 ? "part" : "none";
    return { bloque: b, total: ms.length, aprobadas: ap, clase, esMeta: b === meta };
  });
  return { bloques, meta };
}

/* ===================== Modos de proyección ===================== */

/** Ritmo: créditos por período cursado, dividido entre lo que falta. */
function calcularRitmo({ creditosAprobados, creditosTotales, periodosCursados }, periodosFuturos) {
  const falta = creditosTotales - creditosAprobados;
  if (falta <= 0) return { completo: true, falta: 0 };
  if (!periodosCursados || !creditosAprobados) return { sinDatos: true, falta };
  const ritmo = creditosAprobados / periodosCursados;
  const n = Math.ceil(falta / ritmo);
  return { falta, ritmo, n, fin: periodosFuturos[n - 1] || null };
}

/**
 * Meta: ¿se llega a terminar a más tardar en `fechaLimite`?
 * clave: "imposible" | "prerrequisitos" | "limite" | "sobre" | "dentro" | "margen".
 */
function calcularMeta(ctx, aprobadas, periodosConfig, fechaLimite, hoy = new Date()) {
  const falta = ctx.creditosTotales - creditosDelConjunto(ctx, aprobadas);
  if (falta <= 0) return { completo: true };
  const futuros = generarPeriodos(periodosConfig, hoy);
  const enTiempo = futuros.filter((p) => p.end <= fechaLimite);
  const n = enTiempo.length;
  if (!n) return { falta, sinPeriodos: true };

  const capMin = enTiempo.reduce((s, p) => s + p.min, 0);
  const capMax = enTiempo.reduce((s, p) => s + p.max, 0);
  const capLim = enTiempo.reduce((s, p) => s + p.lim, 0);
  const rapido = simularRuta(ctx, aprobadas, "todo", futuros);
  const porPeriodo = Math.ceil(falta / n);

  let clave;
  if (!rapido.completo) clave = "imposible"; // ni llevando todo lo disponible se termina (requisitos que no se pueden cumplir)
  else if (falta > capLim) clave = "limite"; // los créditos no alcanzan ni cargando al máximo: no es culpa de los prerrequisitos
  else if (rapido.fin && rapido.fin.end > fechaLimite) clave = "prerrequisitos";
  else if (falta > capMax) clave = "sobre";
  else if (falta >= capMin) clave = "dentro";
  else clave = "margen";

  const apagados = periodosConfig.filter((p) => !p.on);
  let conApagados = null;
  if (apagados.length) {
    const nTodos = generarPeriodos(periodosConfig, hoy, true).filter((p) => p.end <= fechaLimite).length;
    if (nTodos > n) conApagados = { nombres: apagados.map((p) => p.nombre), porPeriodo: Math.ceil(falta / nTodos) };
  }
  return { falta, n, porPeriodo, clave, capMin, capMax, capLim, minimoFin: rapido.fin, conApagados };
}

/** ¿Terminaría antes sumando los períodos apagados? (para el aviso del plan sugerido). */
function mejoraConPeriodosApagados(ctx, aprobadas, periodosConfig, rutaActual, hoy = new Date()) {
  const apagados = periodosConfig.filter((p) => !p.on);
  if (!apagados.length || !rutaActual.completo || !rutaActual.fin) return null;
  const conTodos = simularRuta(ctx, aprobadas, "rango", generarPeriodos(periodosConfig, hoy, true));
  if (!conTodos.completo || !conTodos.fin || conTodos.fin.end >= rutaActual.fin.end) return null;
  return { nombres: apagados.map((p) => p.nombre), fin: conTodos.fin, meses: mesesEntre(rutaActual.fin.end, conTodos.fin.end) };
}

export {
  ANIOS_HORIZONTE,
  MESES_EN,
  MESES_ES,
  calcularBloques,
  calcularMeta,
  calcularRitmo,
  crearContexto,
  crearPeriodosPorDefecto,
  creditosDelConjunto,
  cumpleCorrequisitos,
  cumpleRequisitos,
  duracionMeses,
  generarPeriodos,
  materiasDisponibles,
  materiasImposibles,
  mejoraConPeriodosApagados,
  mesesEntre,
  normalizarPeriodo,
  normalizarPeriodos,
  simularRuta,
};
