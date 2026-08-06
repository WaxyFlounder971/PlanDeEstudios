/* =========================================================================
   SEMESTRES — Dashboard académico (pestaña contraíble)
   Vive al inicio de la sección Semestres, colapsada por default (no debe
   empujar el contenido normal hacia abajo al entrar a Semestres). Adentro,
   un selector tipo pestañas alterna entre 3 vistas:
     a/b) Promedio ponderado — por semestre+universidad, y por plan/carrera
     2)   % de cursos aprobados/reprobados (barra dividida)
     3)   Detalle por estado (Aprobada/Cursando/Reprobada/Pendiente)

   Nivel (c) del promedio ponderado (combinado de TODO junto, mezclando
   universidades/carreras) queda EXPLÍCITAMENTE fuera de esta entrega — ver
   el comentario dedicado en schema.js, justo donde iría esa función. (a) y
   (b) son la prioridad pedida y debían quedar sólidos primero.

   Mismo patrón que el resto de la app: Map en `estado` para expandido/
   colapsado + encabezado clickeable con ▲▼ (ver construirTarjetaSemestre
   en semestres-tarjetas.js), y pill-group para el selector de vista (ver
   construirPillsFiltroEstado en semestres.js) — nada de componentes nuevos
   inventados, mismo lenguaje visual de siempre.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import {
  calcularPromedioPorSemestreYUniversidad,
  calcularPromedioPorPlan,
  calcularEstadisticasAprobacion,
  calcularDetallePorEstado,
} from "../core/schema.js";

// Transitorio (no persistido, igual que estado.semestresExpandidos): si la
// pestaña del dashboard está expandida, y qué vista/plan tiene elegidos.
// Colapsada por default — pedido explícito, no debe empujar nada al entrar.
estado.dashboardAcademicoAbierto = estado.dashboardAcademicoAbierto || false;
estado.dashboardAcademicoVista = estado.dashboardAcademicoVista || "ponderado";
estado.dashboardAcademicoPlanFiltro = estado.dashboardAcademicoPlanFiltro || null; // null = todos los planes (global)

const VISTAS_DASHBOARD = [
  { valor: "ponderado", texto: "Promedio Ponderado" },
  { valor: "aprobacion", texto: "Aprobados / Reprobados" },
  { valor: "estados", texto: "Detalle por Estado" },
];

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

/* ===================== Encabezado (título + flecha ▲▼) ===================== */

function construirEncabezadoDashboard(onCambiar) {
  const encabezado = document.createElement("div");
  encabezado.style.cssText =
    "display:flex; align-items:center; justify-content:space-between; gap:8px; cursor:pointer; " +
    "user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;";
  encabezado.title = "Clic para ver tus promedios y estadísticas";
  encabezado.addEventListener("click", () => {
    estado.dashboardAcademicoAbierto = !estado.dashboardAcademicoAbierto;
    onCambiar();
  });

  const izquierda = document.createElement("div");
  izquierda.className = "row";
  izquierda.style.cssText = "gap:8px; align-items:center;";
  const titulo = document.createElement("h3");
  titulo.style.cssText = "margin:0; font-size:1.05rem; font-weight:800;";
  titulo.textContent = "📊 Dashboard académico";
  izquierda.appendChild(titulo);
  encabezado.appendChild(izquierda);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = estado.dashboardAcademicoAbierto ? "▲" : "▼";
  encabezado.appendChild(iconoExpandir);

  return encabezado;
}

/* ===================== Selector de vista (pills) ===================== */

function construirSelectorVista(onCambiar) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "display:flex; width:100%; gap:6px; margin-top:10px;";

  VISTAS_DASHBOARD.forEach(({ valor, texto }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.dashboardAcademicoVista === valor ? " active" : "");
    btn.textContent = texto;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (estado.dashboardAcademicoVista === valor) return;
      estado.dashboardAcademicoVista = valor;
      onCambiar();
    });
    grupo.appendChild(btn);
  });

  return grupo;
}

/**
 * Selector de plan opcional (usado por la vista de aprobación) — mismo
 * patrón de carrusel simple que ya usa la app para elegir entre pocas
 * opciones (pill-group scrolleable). "Todos" siempre es la primera opción.
 */
function construirSelectorPlanFiltro(onCambiar) {
  const planes = estado.datos.planes_estudio || [];
  if (planes.length <= 1) return null; // con 0-1 plan no hay nada que filtrar

  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.style.cssText = "gap:4px; margin-top:10px;";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.style.fontSize = "0.78rem";
  etiqueta.textContent = "Filtrar por plan:";
  wrap.appendChild(etiqueta);

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "display:flex; gap:6px;";

  const opciones = [{ id: null, texto: "Todos" }, ...planes.map((p) => ({ id: p.id, texto: `${p.universidad} · ${aplicarFormatoTexto(p.nombre_carrera)}` }))];
  opciones.forEach(({ id, texto }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.dashboardAcademicoPlanFiltro === id ? " active" : "");
    btn.textContent = texto;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (estado.dashboardAcademicoPlanFiltro === id) return;
      estado.dashboardAcademicoPlanFiltro = id;
      onCambiar();
    });
    grupo.appendChild(btn);
  });
  wrap.appendChild(grupo);

  return wrap;
}

/* ===================== Vista (a)/(b): Promedio ponderado ===================== */

function formatearPromedio(valor) {
  if (valor === null || valor === undefined) return "—";
  return valor.toFixed(2);
}

function construirFilaPromedio({ etiquetaIzquierda, promedio, creditos, materias, etiquetaDerecha }) {
  const fila = document.createElement("div");
  fila.className = "glass-panel";
  fila.style.cssText = "padding:10px 12px; display:flex; align-items:center; justify-content:space-between; gap:10px;";

  const izq = document.createElement("div");
  izq.className = "stack";
  izq.style.cssText = "gap:1px; min-width:0;";
  const nombre = document.createElement("strong");
  nombre.style.cssText = "font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  nombre.textContent = etiquetaIzquierda;
  izq.appendChild(nombre);
  if (etiquetaDerecha) {
    const sub = document.createElement("span");
    sub.className = "muted";
    sub.style.fontSize = "0.75rem";
    sub.textContent = etiquetaDerecha;
    izq.appendChild(sub);
  }
  fila.appendChild(izq);

  const der = document.createElement("div");
  der.style.cssText = "text-align:right; flex-shrink:0;";
  const valorPromedio = document.createElement("div");
  valorPromedio.style.cssText = "font-size:1.1rem; font-weight:800;";
  valorPromedio.textContent = formatearPromedio(promedio);
  der.appendChild(valorPromedio);
  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.fontSize = "0.72rem";
  detalle.textContent = materias > 0 ? `${materias} ${materias === 1 ? "materia" : "materias"} · ${creditos} créd.` : "Sin notas todavía";
  der.appendChild(detalle);
  fila.appendChild(der);

  return fila;
}

function construirVistaPromedioPonderado() {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:16px; margin-top:14px;";

  /* ---------- Nivel (b): por plan/carrera — primero, es el resumen general ---------- */
  const seccionB = document.createElement("div");
  seccionB.className = "stack";
  seccionB.style.gap = "8px";
  const tituloB = document.createElement("p");
  tituloB.style.cssText = "font-weight:700; margin:0; font-size:0.88rem;";
  tituloB.textContent = "Promedio general por carrera";
  seccionB.appendChild(tituloB);

  const porPlan = calcularPromedioPorPlan(estado.datos);
  if (porPlan.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no hay materias matriculadas con nota para calcular un promedio.";
    seccionB.appendChild(vacio);
  } else {
    porPlan.forEach(({ plan, promedio, creditos, materias }) => {
      seccionB.appendChild(
        construirFilaPromedio({
          etiquetaIzquierda: aplicarFormatoTexto(plan.nombre_carrera),
          etiquetaDerecha: plan.universidad,
          promedio,
          creditos,
          materias,
        })
      );
    });
  }
  cont.appendChild(seccionB);

  /* ---------- Nivel (a): por semestre, separado por universidad ---------- */
  const seccionA = document.createElement("div");
  seccionA.className = "stack";
  seccionA.style.gap = "8px";
  const tituloA = document.createElement("p");
  tituloA.style.cssText = "font-weight:700; margin:0; font-size:0.88rem;";
  tituloA.textContent = "Promedio por semestre";
  seccionA.appendChild(tituloA);

  const porSemestre = calcularPromedioPorSemestreYUniversidad(estado.datos);
  if (porSemestre.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no hay semestres con materias matriculadas.";
    seccionA.appendChild(vacio);
  } else {
    porSemestre.forEach(({ semestre, universidades }) => {
      const bloqueSemestre = document.createElement("div");
      bloqueSemestre.className = "stack";
      bloqueSemestre.style.gap = "6px";

      const nombreSemestre = document.createElement("p");
      nombreSemestre.className = "muted";
      nombreSemestre.style.cssText = "font-size:0.78rem; font-weight:700; margin:0;";
      nombreSemestre.textContent = semestre.nombre;
      bloqueSemestre.appendChild(nombreSemestre);

      // Modo Hardcore: si el semestre tiene más de una universidad, cada
      // una queda como su propia fila independiente — nunca se mezclan.
      universidades.forEach(({ universidad, promedio, creditos, materias }) => {
        bloqueSemestre.appendChild(
          construirFilaPromedio({
            etiquetaIzquierda: universidad,
            promedio,
            creditos,
            materias,
          })
        );
      });

      seccionA.appendChild(bloqueSemestre);
    });
  }
  cont.appendChild(seccionA);

  /* ---------- Nivel (c): documentado como pendiente, nunca improvisado ---------- */
  const notaPendienteC = document.createElement("p");
  notaPendienteC.className = "muted";
  notaPendienteC.style.cssText = "font-size:0.72rem; margin:0; text-align:center; opacity:0.7;";
  notaPendienteC.textContent = "El promedio combinado de todas las carreras juntas todavía no está disponible — pendiente de una próxima entrega.";
  cont.appendChild(notaPendienteC);

  return cont;
}

/* ===================== Vista 2: % Aprobados / Reprobados ===================== */

function construirVistaAprobacion(onCambiar) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:12px; margin-top:14px;";

  const selectorPlan = construirSelectorPlanFiltro(onCambiar);
  if (selectorPlan) cont.appendChild(selectorPlan);

  const stats = calcularEstadisticasAprobacion(estado.datos, estado.dashboardAcademicoPlanFiltro);

  if (stats.totalCursos === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:8px 0 0;";
    vacio.textContent = "Todavía no hay semestres terminados con resultado (Aprobada/Reprobada) para calcular esto.";
    cont.appendChild(vacio);
    return cont;
  }

  /* ---------- Barra dividida ---------- */
  const barra = document.createElement("div");
  barra.style.cssText =
    "display:flex; width:100%; height:22px; border-radius:var(--radius-pill); overflow:hidden; " +
    "border:1px solid var(--border-glass);";

  const segAprobados = document.createElement("div");
  segAprobados.style.cssText = `width:${stats.aprobadas.porcentaje}%; background:#10b981;`;
  segAprobados.title = `${stats.aprobadas.porcentaje}% aprobados`;
  barra.appendChild(segAprobados);

  const segReprobados = document.createElement("div");
  segReprobados.style.cssText = `width:${stats.reprobadas.porcentaje}%; background:#ef4444;`;
  segReprobados.title = `${stats.reprobadas.porcentaje}% reprobados`;
  barra.appendChild(segReprobados);

  cont.appendChild(barra);

  /* ---------- Detalle a cada lado ---------- */
  const filaDetalle = document.createElement("div");
  filaDetalle.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:10px;";

  const construirLadoDetalle = (titulo, datosLado, colorHex) => {
    const panel = document.createElement("div");
    panel.className = "glass-panel";
    panel.style.cssText = `padding:10px 12px; border-left:4px solid ${colorHex};`;

    const pct = document.createElement("div");
    pct.style.cssText = `font-size:1.3rem; font-weight:800; color:${colorHex};`;
    pct.textContent = `${datosLado.porcentaje}%`;
    panel.appendChild(pct);

    const label = document.createElement("div");
    label.style.cssText = "font-size:0.8rem; font-weight:600; margin-top:2px;";
    label.textContent = titulo;
    panel.appendChild(label);

    const cantidad = document.createElement("div");
    cantidad.className = "muted";
    cantidad.style.fontSize = "0.75rem";
    cantidad.textContent = `${datosLado.cantidad} ${datosLado.cantidad === 1 ? "curso" : "cursos"} · ${datosLado.creditos} créd.`;
    panel.appendChild(cantidad);

    if (datosLado.promedio !== null) {
      const promedio = document.createElement("div");
      promedio.className = "muted";
      promedio.style.fontSize = "0.75rem";
      promedio.textContent = `${formatearPromedio(datosLado.promedio)} promedio de cursos ${titulo.toLowerCase()}`;
      panel.appendChild(promedio);
    }

    return panel;
  };

  filaDetalle.appendChild(construirLadoDetalle("Aprobados", stats.aprobadas, "#10b981"));
  filaDetalle.appendChild(construirLadoDetalle("Reprobados", stats.reprobadas, "#ef4444"));
  cont.appendChild(filaDetalle);

  return cont;
}

/* ===================== Vista 3: Detalle por estado ===================== */

const ESTADOS_DETALLE_CONFIG = [
  { clave: "aprobado", texto: "Aprobada", color: "#10b981" },
  { clave: "cursando", texto: "Cursando", color: "#38bdf8" },
  { clave: "reprobado", texto: "Reprobada", color: "#ef4444" },
  { clave: "pendiente", texto: "Pendiente", color: "#94a3b8" },
];

function construirVistaDetalleEstados(onCambiar) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:12px; margin-top:14px;";

  const selectorPlan = construirSelectorPlanFiltro(onCambiar);
  if (selectorPlan) cont.appendChild(selectorPlan);

  const conteo = calcularDetallePorEstado(estado.datos, estado.dashboardAcademicoPlanFiltro);
  const total = conteo.aprobado + conteo.cursando + conteo.reprobado + conteo.pendiente;

  if (total === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:8px 0 0;";
    vacio.textContent = "Este plan todavía no tiene materias.";
    cont.appendChild(vacio);
    return cont;
  }

  const grid = document.createElement("div");
  grid.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:10px;";

  ESTADOS_DETALLE_CONFIG.forEach(({ clave, texto, color }) => {
    const cantidad = conteo[clave];
    const panel = document.createElement("div");
    panel.className = "glass-panel";
    panel.style.cssText = `padding:10px 12px; border-left:4px solid ${color};`;

    const numero = document.createElement("div");
    numero.style.cssText = `font-size:1.3rem; font-weight:800; color:${color};`;
    numero.textContent = String(cantidad);
    panel.appendChild(numero);

    const label = document.createElement("div");
    label.style.cssText = "font-size:0.8rem; font-weight:600;";
    label.textContent = texto;
    panel.appendChild(label);

    grid.appendChild(panel);
  });

  cont.appendChild(grid);
  return cont;
}

/* ===================== Ensamblado principal ===================== */

/**
 * Construye la pestaña completa del dashboard. `onCambiar` es el mismo
 * renderizarSemestres de siempre — cualquier interacción interna
 * (expandir/colapsar, cambiar de vista, cambiar filtro de plan) vuelve a
 * llamar a la reconstrucción completa de #seccion-semestres, igual patrón
 * que el resto del archivo semestres.js.
 */
function construirDashboardAcademico(onCambiar) {
  const card = document.createElement("section");
  card.className = "glass-card stack";
  card.style.cssText = "gap:0;";

  card.appendChild(construirEncabezadoDashboard(onCambiar));

  if (!estado.dashboardAcademicoAbierto) {
    return card; // colapsada: solo el encabezado, no empuja nada hacia abajo
  }

  card.appendChild(construirSelectorVista(onCambiar));

  let vistaContenido;
  if (estado.dashboardAcademicoVista === "aprobacion") {
    vistaContenido = construirVistaAprobacion(onCambiar);
  } else if (estado.dashboardAcademicoVista === "estados") {
    vistaContenido = construirVistaDetalleEstados(onCambiar);
  } else {
    vistaContenido = construirVistaPromedioPonderado();
  }
  card.appendChild(vistaContenido);

  return card;
}

export { construirDashboardAcademico };
