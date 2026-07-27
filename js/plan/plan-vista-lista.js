/* =========================================================================
   PLAN DE ESTUDIOS — VISTA DE LISTA (orquestador)
   Render principal de la sección, encabezado con carrusel, barra de
   acciones (orden/buscador/exportar) y panel de estadísticas.
   ========================================================================= */

import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, serializarGrupoRequisitos } from "../core/utils.js";
import { construirPanelCategorias } from "./plan-categorias.js";
import { abrirModalMateriaManual, obtenerMateriasVisibles, obtenerPlanActivo } from "./plan-esquema.js";
import { abrirModalGestionPlanes, renderizarSelectorPlan } from "./plan-gestionar.js";
import { alternarModoEdicionPlan } from "./plan-modo-edicion.js";
import { construirMiniPanelImportacion } from "./plan-importacion-csv.js";
import { construirEncabezadoCSV, construirPanelImportacion } from "./plan-importacion.js";
import { construirContenidoBloques } from "./plan-vista-lista-tarjetas.js";

/* Estado propio de esta sección, colgado del `estado` global de app.js. */
estado.ordenPlanEstudios = "bloque";       // "bloque" | "categoria"
estado.filtroCategoriaId = null;           // categoría por la que se está filtrando la vista
estado.busquedaPlanEstudios = "";          // texto del buscador general
estado.materiasExpandidas = new Map();     // codigo -> bool (override manual del expand/collapse)
estado.bloquesColapsados = new Set();      // claves de bloque/categoría colapsadas
estado.estadisticasAbiertas = false;      // v5 #3: colapsada por defecto

/* ===================== Render principal de la sección ===================== */

function renderizarPlanEstudios() {
  const cont = document.getElementById("seccion-plan-estudios");
  if (!cont) return;

  const principal = obtenerPlanActivo();
  cont.innerHTML = "";

  try {
    if (!principal) {
      cont.appendChild(construirPanelImportacion());
      return;
    }

    cont.appendChild(construirEncabezadoPlan(principal));
    if (estado.panelImportacionAbierto) {
      cont.appendChild(construirMiniPanelImportacion(principal));
    }
    cont.appendChild(construirPanelEstadisticas(principal));
    cont.appendChild(construirBarraAcciones());
    cont.appendChild(construirPanelCategorias());
    cont.appendChild(construirContenidoBloques());
  } catch (e) {
    // Bug 1 (v6): antes, un error aquí dejaba la sección completamente vacía
    // y sin ningún indicio de qué pasó (el error solo se veía en la consola
    // del navegador). Ahora se le muestra al usuario un mensaje visible y se
    // reporta el detalle en consola para diagnóstico.
    console.error("Error al renderizar el Plan de Estudios:", e);
    cont.innerHTML = "";
    const aviso = document.createElement("section");
    aviso.className = "glass-card stack";
    const titulo = document.createElement("h2");
    titulo.style.margin = "0";
    titulo.style.color = "var(--color-danger)";
    titulo.textContent = "⚠️ No se pudo mostrar el Plan de Estudios";
    const detalle = document.createElement("p");
    detalle.className = "muted";
    detalle.textContent =
      "Ocurrió un error inesperado al dibujar esta sección. Tus datos siguen guardados; " +
      "intenta recargar la página. Si el problema persiste, revisa la consola del navegador (F12) para más detalle.";
    const tecnico = document.createElement("p");
    tecnico.className = "muted";
    tecnico.style.fontFamily = "monospace";
    tecnico.style.fontSize = "0.8rem";
    tecnico.textContent = e && e.message ? e.message : String(e);
    aviso.appendChild(titulo);
    aviso.appendChild(detalle);
    aviso.appendChild(tecnico);
    cont.appendChild(aviso);
  }
}

/* ===================== Encabezado del plan (carrusel + acciones) ===================== */

function construirEncabezadoPlan(planPrincipal) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const filaTitulo = document.createElement("div");
  filaTitulo.className = "row-between";
  filaTitulo.style.flexWrap = "wrap";
  filaTitulo.style.gap = "10px";

  // v5 1.1: título de 2 líneas, la 2da alineada bajo la 1ra letra de la 1ra.
  const tituloWrap = document.createElement("div");
  tituloWrap.className = "encabezado-plan-titulo";

  const hayCarrusel = estado.datos.planes_estudio.length > 1;
  const linea1 = document.createElement("div");
  linea1.className = "encabezado-plan-linea1";

  if (hayCarrusel) {
    const btnPrev = document.createElement("button");
    btnPrev.className = "flecha-plan";
    btnPrev.type = "button";
    btnPrev.textContent = "‹";
    btnPrev.title = "Plan anterior";
    btnPrev.addEventListener("click", () => navegarPlanCarrusel(-1));
    linea1.appendChild(btnPrev);
  }

  const h2 = document.createElement("h2");
  h2.style.margin = "0";
  h2.textContent = aplicarFormatoTexto(planPrincipal.nombre_carrera);
  linea1.appendChild(h2);

  if (hayCarrusel) {
    const btnNext = document.createElement("button");
    btnNext.className = "flecha-plan";
    btnNext.type = "button";
    btnNext.textContent = "›";
    btnNext.title = "Plan siguiente";
    btnNext.addEventListener("click", () => navegarPlanCarrusel(1));
    linea1.appendChild(btnNext);
  }
  tituloWrap.appendChild(linea1);

  const sub = document.createElement("p");
  sub.className = "muted encabezado-plan-linea2" + (hayCarrusel ? "" : " sin-flechas");
  sub.style.margin = "0";
  sub.textContent = `${planPrincipal.universidad}` + (planPrincipal.codigo_plan ? ` · ${planPrincipal.codigo_plan}` : "");
  tituloWrap.appendChild(sub);
  filaTitulo.appendChild(tituloWrap);
  sec.appendChild(filaTitulo);

  // v1.9.8: el encabezado principal ahora solo tiene 2 botones, en este
  // orden — "Gestionar plan" primero, "Actualizar malla" (o "Importar
  // malla"/"Cerrar importación" según el estado) segundo. "+ Añadir
  // materia" y "Editar Materias" se mudaron a la barra de acciones (ver
  // construirBarraAcciones) — Añadir materia ahora solo aparece ahí y solo
  // mientras el modo edición está activo.
  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.flexWrap = "wrap";

  const btnPlanes = document.createElement("button");
  btnPlanes.className = "btn btn-primary";
  btnPlanes.textContent = "Gestionar plan";
  btnPlanes.addEventListener("click", abrirModalGestionPlanes);
  botones.appendChild(btnPlanes);

  const btnImportar = document.createElement("button");
  btnImportar.className = "btn btn-secondary";
  btnImportar.textContent = estado.panelImportacionAbierto
    ? "Cerrar importación"
    : (planPrincipal.materias.length === 0 ? "Importar malla" : "Actualizar malla");
  btnImportar.addEventListener("click", () => {
    estado.panelImportacionAbierto = !estado.panelImportacionAbierto;
    renderizarPlanEstudios();
  });
  botones.appendChild(btnImportar);

  sec.appendChild(botones);
  return sec;
}

function navegarPlanCarrusel(delta) {
  const planes = estado.datos.planes_estudio;
  const idxActual = planes.findIndex((p) => p.id === estado.datos.configuracion.plan_activo_id);
  const nuevoIdx = (idxActual + delta + planes.length) % planes.length;
  estado.datos.configuracion.plan_activo_id = planes[nuevoIdx].id;
  marcarCambioPendiente();
  renderizarSelectorPlan();
  renderizarPlanEstudios();
}

/* ===================== Barra de acciones (orden, buscador, contraer/expandir, exportar) ===================== */

function construirBarraAcciones() {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const grupoOrden = document.createElement("div");
  grupoOrden.className = "pill-group";
  [
    { valor: "bloque", texto: "Ordenar por bloque" },
    { valor: "categoria", texto: "Ordenar por categoría" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.ordenPlanEstudios === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.ordenPlanEstudios = op.valor;
      renderizarPlanEstudios();
    });
    grupoOrden.appendChild(btn);
  });
  sec.appendChild(grupoOrden);

  const buscador = document.createElement("input");
  buscador.type = "text";
  buscador.id = "input-busqueda-plan";
  buscador.className = "form-input";
  buscador.placeholder = "🔎 Buscar materia por nombre o código…";
  buscador.value = estado.busquedaPlanEstudios;
  buscador.addEventListener("input", () => {
    estado.busquedaPlanEstudios = buscador.value;
    const posicionCursor = buscador.selectionStart;
    renderizarPlanEstudios();
    const nuevo = document.getElementById("input-busqueda-plan");
    if (nuevo) {
      nuevo.focus();
      nuevo.setSelectionRange(posicionCursor, posicionCursor);
    }
  });
  sec.appendChild(buscador);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.flexWrap = "wrap";

  // v1.9.8: Bloques y Materias van en 2 pills SEPARADAS (antes vivían juntas
  // en una sola pill con "·" de separador — eso era lo que se rompía en PC).
  const grupoBloques = document.createElement("div");
  grupoBloques.className = "pill-group";
  grupoBloques.title = "Bloques";

  const btnBloquesContraer = document.createElement("button");
  btnBloquesContraer.type = "button";
  btnBloquesContraer.className = "pill-item";
  btnBloquesContraer.textContent = "Bloques ▲";
  btnBloquesContraer.addEventListener("click", contraerTodosLosBloques);
  grupoBloques.appendChild(btnBloquesContraer);

  const btnBloquesExpandir = document.createElement("button");
  btnBloquesExpandir.type = "button";
  btnBloquesExpandir.className = "pill-item";
  btnBloquesExpandir.textContent = "Bloques ▼";
  btnBloquesExpandir.addEventListener("click", expandirTodosLosBloques);
  grupoBloques.appendChild(btnBloquesExpandir);

  filaBotones.appendChild(grupoBloques);

  const grupoMaterias = document.createElement("div");
  grupoMaterias.className = "pill-group";
  grupoMaterias.title = "Materias";

  const btnMateriasContraer = document.createElement("button");
  btnMateriasContraer.type = "button";
  btnMateriasContraer.className = "pill-item";
  btnMateriasContraer.textContent = "Materias ▲";
  btnMateriasContraer.addEventListener("click", contraerTodasLasMaterias);
  grupoMaterias.appendChild(btnMateriasContraer);

  const btnMateriasExpandir = document.createElement("button");
  btnMateriasExpandir.type = "button";
  btnMateriasExpandir.className = "pill-item";
  btnMateriasExpandir.textContent = "Materias ▼";
  btnMateriasExpandir.addEventListener("click", expandirTodasLasMaterias);
  grupoMaterias.appendChild(btnMateriasExpandir);

  filaBotones.appendChild(grupoMaterias);

  // v1.9.8: "Exportar CSV" se mudó adentro del modal "Gestionar plan" (justo
  // después del botón de eliminar de cada plan — ver plan-gestionar.js).
  // Aquí, donde antes vivía ese botón, ahora va "Editar Materias" (antes
  // vivía en el encabezado como "Editar plan") y, SOLO mientras el modo
  // edición está activo, "+ Añadir materia" aparece justo al lado — con el
  // mismo color (btn-secondary los dos) y exactamente el mismo ancho
  // (igualarAnchoBotones mide el más ancho de los dos tras el layout real y
  // fuerza ese mismo ancho en ambos; ver más abajo).
  const grupoEdicion = document.createElement("div");
  grupoEdicion.className = "botones-editar-grupo";

  const btnModoEdicion = document.createElement("button");
  btnModoEdicion.className = "btn btn-secondary";
  btnModoEdicion.textContent = estado.modoEdicionPlan ? "✓ Salir de edición" : "✏️ Editar Materias";
  btnModoEdicion.addEventListener("click", alternarModoEdicionPlan);
  grupoEdicion.appendChild(btnModoEdicion);

  if (estado.modoEdicionPlan) {
    const btnMateria = document.createElement("button");
    btnMateria.className = "btn btn-secondary";
    btnMateria.textContent = "+ Añadir materia";
    btnMateria.addEventListener("click", abrirModalMateriaManual);
    grupoEdicion.appendChild(btnMateria);
    igualarAnchoBotones(btnModoEdicion, btnMateria);
  }

  filaBotones.appendChild(grupoEdicion);

  sec.appendChild(filaBotones);
  return sec;
}

/**
 * v1.9.8: fuerza que 2+ botones midan EXACTAMENTE el mismo ancho — el del
 * más ancho de todos, medido ya con layout real (getBoundingClientRect
 * tras requestAnimationFrame). Se usa para "Editar Materias" + "Añadir materia"
 * en la barra de acciones, que tienen textos de largo distinto.
 */

function igualarAnchoBotones(...botones) {
  requestAnimationFrame(() => {
    const anchoMax = Math.max(...botones.map((b) => b.getBoundingClientRect().width));
    botones.forEach((b) => { b.style.width = `${Math.ceil(anchoMax)}px`; });
  });
}

function obtenerClavesAgrupacionActuales() {
  const claves = new Set();
  obtenerMateriasVisibles().forEach((f) => {
    claves.add(estado.ordenPlanEstudios === "categoria" ? f.materia.categoria_id || "sin_categoria" : String(f.materia.bloque));
  });
  return claves;
}

/* Ajuste 2: Bloques y Materias se contraen/expanden de forma INDEPENDIENTE
 * (antes era un solo par "Contraer todo"/"Expandir todo" que movía ambos
 * niveles a la vez). */

function contraerTodosLosBloques() {
  estado.bloquesColapsados = obtenerClavesAgrupacionActuales();
  renderizarPlanEstudios();
}

function expandirTodosLosBloques() {
  estado.bloquesColapsados = new Set();
  renderizarPlanEstudios();
}

function contraerTodasLasMaterias() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, false));
  renderizarPlanEstudios();
}

function expandirTodasLasMaterias() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, true));
  renderizarPlanEstudios();
}

/**
 * v1.9.8: ahora acepta un plan específico como parámetro — lo necesita el
 * botón "Exportar" que va dentro del modal "Gestionar plan" (justo después
 * de "Eliminar" en cada fila de plan, ver plan-gestionar.js), que exporta
 * ESE plan puntual y no necesariamente el activo. Sin argumento, sigue
 * exportando el plan activo (compatibilidad con el llamado de siempre).
 */

function exportarPlanACSV(planParam) {
  const principal = planParam || obtenerPlanActivo();
  if (!principal) return;

  const tipos = Array.isArray(principal.parametros_universidad.tipos_horas)
    ? principal.parametros_universidad.tipos_horas
    : ["Horas"];

  const encabezado = `${construirEncabezadoCSV(tipos)},Estado,CategoriaId`;
  const filas = principal.materias.map((m) => {
    const columnasHoras = tipos.map((tipo) => (m.horas || {})[tipo] || 0);
    const campos = [
      m.bloque,
      m.codigo,
      `"${(m.nombre || "").replace(/"/g, '""')}"`,
      m.creditos,
      ...columnasHoras,
      serializarGrupoRequisitos(m.requisitos),
      serializarGrupoRequisitos(m.correquisitos),
      m.estado,
      m.categoria_id || "",
    ];
    return campos.join(",");
  });

  const csv = [encabezado, ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plan_estudios_${(principal.nombre_carrera || "malla").replace(/\s+/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== Estadísticas colapsables (donuts) — v5 #3 ===================== */

/**
 * Construye un anillo tipo "Instagram story ring" (donut sin centro) usando
 * dos <circle> superpuestos con stroke-dasharray: uno de fondo (track) y
 * uno de progreso. `porcentaje` va de 0 a 100.
 */

function construirAnilloDonut(porcentaje, colorProgreso) {
  const radio = 46;
  const circunferencia = 2 * Math.PI * radio;
  const pct = Math.max(0, Math.min(100, porcentaje));
  const offset = circunferencia * (1 - pct / 100);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "120");

  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("cx", "60");
  track.setAttribute("cy", "60");
  track.setAttribute("r", String(radio));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "var(--accent-1-10)");
  track.setAttribute("stroke-width", "12");

  const progreso = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  progreso.setAttribute("cx", "60");
  progreso.setAttribute("cy", "60");
  progreso.setAttribute("r", String(radio));
  progreso.setAttribute("fill", "none");
  progreso.setAttribute("stroke", colorProgreso);
  progreso.setAttribute("stroke-width", "12");
  progreso.setAttribute("stroke-linecap", "round");
  progreso.setAttribute("stroke-dasharray", `${circunferencia}`);
  progreso.setAttribute("stroke-dashoffset", `${offset}`);
  progreso.setAttribute("transform", "rotate(-90 60 60)");

  const texto = document.createElementNS("http://www.w3.org/2000/svg", "text");
  texto.setAttribute("x", "60");
  texto.setAttribute("y", "60");
  texto.setAttribute("text-anchor", "middle");
  texto.setAttribute("dominant-baseline", "central");
  texto.setAttribute("fill", "var(--text-primary)");
  texto.setAttribute("font-size", "22");
  texto.setAttribute("font-weight", "700");
  texto.textContent = `${Math.round(pct)}%`;

  svg.appendChild(track);
  svg.appendChild(progreso);
  svg.appendChild(texto);
  return svg;
}

/**
 * Sección colapsable "Estadísticas" (v5 #3): colapsada por defecto. Muestra
 * dos donuts — avance de Materias y avance de Créditos — comparando
 * aprobado vs. pendiente. Se coloca entre el encabezado del plan y el
 * buscador/categorías (ver orden en renderizarPlanEstudios).
 */

function construirPanelEstadisticas(plan) {
  const materias = plan.materias || [];
  const totalMaterias = materias.length;
  const materiasAprobadas = materias.filter((m) => m.estado === "aprobado").length;
  const totalCreditos = materias.reduce((sum, m) => sum + (Number(m.creditos) || 0), 0);
  const creditosAprobados = materias
    .filter((m) => m.estado === "aprobado")
    .reduce((sum, m) => sum + (Number(m.creditos) || 0), 0);

  const pctMaterias = totalMaterias ? (materiasAprobadas / totalMaterias) * 100 : 0;
  const pctCreditos = totalCreditos ? (creditosAprobados / totalCreditos) * 100 : 0;

  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const encabezado = document.createElement("div");
  encabezado.className = "estadisticas-encabezado";
  encabezado.addEventListener("click", () => {
    estado.estadisticasAbiertas = !estado.estadisticasAbiertas;
    renderizarPlanEstudios();
  });

  const h3 = document.createElement("h2");
  h3.style.margin = "0";
  h3.textContent = "Estadísticas";
  encabezado.appendChild(h3);

  const icono = document.createElement("span");
  icono.className = "materia-expandir";
  icono.textContent = estado.estadisticasAbiertas ? "▲" : "▼";
  encabezado.appendChild(icono);

  sec.appendChild(encabezado);

  if (estado.estadisticasAbiertas) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "estadisticas-cuerpo";

    if (totalMaterias === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Todavía no hay materias importadas para calcular el avance.";
      cuerpo.appendChild(p);
    } else {
      const bloqueMaterias = document.createElement("div");
      bloqueMaterias.className = "donut-bloque";
      bloqueMaterias.appendChild(construirAnilloDonut(pctMaterias, "#10b981"));
      const etiquetaM = document.createElement("span");
      etiquetaM.className = "donut-etiqueta";
      etiquetaM.textContent = "Materias";
      const subEtiquetaM = document.createElement("span");
      subEtiquetaM.className = "donut-subetiqueta";
      subEtiquetaM.textContent = `${materiasAprobadas} de ${totalMaterias} aprobadas`;
      bloqueMaterias.appendChild(etiquetaM);
      bloqueMaterias.appendChild(subEtiquetaM);

      const bloqueCreditos = document.createElement("div");
      bloqueCreditos.className = "donut-bloque";
      bloqueCreditos.appendChild(construirAnilloDonut(pctCreditos, "#10b981"));
      const etiquetaC = document.createElement("span");
      etiquetaC.className = "donut-etiqueta";
      etiquetaC.textContent = "Créditos";
      const subEtiquetaC = document.createElement("span");
      subEtiquetaC.className = "donut-subetiqueta";
      subEtiquetaC.textContent = `${creditosAprobados} de ${totalCreditos} aprobados`;
      bloqueCreditos.appendChild(etiquetaC);
      bloqueCreditos.appendChild(subEtiquetaC);

      cuerpo.appendChild(bloqueMaterias);
      cuerpo.appendChild(bloqueCreditos);
    }

    sec.appendChild(cuerpo);
  }

  return sec;
}

/**
 * v11 (migración a módulos): antes suelto al final del DOMContentLoaded de
 * plan.js. Al cruzar el punto de quiebre de 900px, se re-renderiza la lista
 * para que cada materia pase de colapsada (móvil) a siempre expandida
 * (escritorio) o viceversa, salvo que el usuario ya la haya alternado a mano
 * (estado.materiasExpandidas).
 */

function inicializarResponsivoListaPlan() {
  let anchoEraEscritorio = window.innerWidth >= 900;
  window.addEventListener("resize", () => {
    const esEscritorioAhora = window.innerWidth >= 900;
    if (esEscritorioAhora !== anchoEraEscritorio) {
      anchoEraEscritorio = esEscritorioAhora;
      const seccion = document.getElementById("seccion-plan-estudios");
      if (seccion && !seccion.classList.contains("oculto")) {
        renderizarPlanEstudios();
      }
    }
  });
}

export {
  construirAnilloDonut,
  construirBarraAcciones,
  construirEncabezadoPlan,
  construirPanelEstadisticas,
  contraerTodasLasMaterias,
  contraerTodosLosBloques,
  expandirTodasLasMaterias,
  expandirTodosLosBloques,
  exportarPlanACSV,
  inicializarResponsivoListaPlan,
  navegarPlanCarrusel,
  obtenerClavesAgrupacionActuales,
  renderizarPlanEstudios,
};
