/* =========================================================================
   TIEMPO DE ESTUDIO — Núcleo (Parte 1 + rediseño visual Parte A/B)
   Vista principal (tarjetas por materia matriculada, con barra de progreso
   semanal), pantalla de detalle con timer simple, e indicador persistente
   de sesión activa (visible en cualquier pantalla de la app).

   Parte A/B (este ajuste): color por materia (borde de tarjeta + relleno
   de barra, un solo valor, mismo criterio que horario.js), tarjeta de
   tamaño fijo con nombre sin código + botones solo-ícono, orden
   configuradas-primero, encabezado con switch Todo/Activos, y encabezado
   de detalle en una sola tarjeta (flecha/nombre/engranaje). El componente
   "Buscar materia en..." (Parte C) y su conexión al nombre clickeable de
   detalle (D.1) y a la tarjeta vieja de Plan de Estudios (D.2) quedan para
   cuando estén disponibles plan-detalle.js/plan-esquema.js/comunidad.js.

   Materias disponibles: solo las de obtenerSemestresActuales() (mismo
   criterio que Agenda/Horario) — cada materia matriculada (mm) es una
   instancia independiente, con su propio tiempo_estudio y sus propias
   sesiones, aunque dos mm compartan el mismo materia_id (repetición).

   Nota (Parte 1, asumido a falta de horario.js/utils.js): "esta semana" se
   calcula como lunes 00:00 → domingo 23:59:59, fijo — no respeta todavía
   el ajuste configurable de "día de inicio de semana" que ya existe para
   Horario. Si hace falta que coincida, avisar para ajustarlo.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { COLOR_TIEMPO_ESTUDIO_DEFAULT } from "../core/schema.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales } from "../semestres/semestres.js";
import { mostrarSeccion } from "../main.js";
import { abrirModalConfigTiempoEstudio } from "./tiempo-estudio-config.js";
import {
  cambiarTimerEstudio,
  detenerTimerEstudio,
  formatearDuracion,
  hayTimerActivo,
  iniciarTimerEstudio,
  obtenerTimerActivo,
  segundosTranscurridos,
  suscribirseATimer,
} from "./tiempo-estudio-timer.js";

// mm.id de la materia en pantalla de detalle, o null = vista de tarjetas.
let materiaDetalleActivaId = null;
// Cleanup del suscribirseATimer de la pantalla de detalle actualmente
// montada (si hay una) — se limpia y re-crea en cada render para nunca
// dejar 2+ suscriptores duplicados de una visita anterior.
let desuscribirTimerDetalle = null;

/* ===================== Parte A/B: filtro Todo/Activos ===================== */

// Preferencia puramente de visualización de ESTE dispositivo (no afecta
// datos ni se sincroniza entre dispositivos) — vive en localStorage, no en
// estado.datos.configuracion, a propósito: es del mismo tipo que
// CLAVE_SECCION_ACTIVA en main.js (qué se ve, no qué se guarda), no algo
// que tenga sentido que viaje entre celular/notebook.
const CLAVE_FILTRO_VISTA_TE = "te_filtro_vista_v1";

function obtenerFiltroVista() {
  return localStorage.getItem(CLAVE_FILTRO_VISTA_TE) === "activos" ? "activos" : "todo";
}

function guardarFiltroVista(valor) {
  localStorage.setItem(CLAVE_FILTRO_VISTA_TE, valor === "activos" ? "activos" : "todo");
}

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

/**
 * Recorre las materias matriculadas de los semestres ACTUALES (nunca
 * pasados) y resuelve el nombre real de cada una contra su plan. Descarta
 * en silencio cualquier mm cuyo plan o materia ya no exista (plan
 * borrado), en vez de romper el render.
 *
 * Dos variantes de nombre (Parte B.2, ajuste 2026): `nombreMateria` (con
 * código, ej. "IC-1010 · Cálculo I") se sigue usando en toast/badge
 * persistente/título de detalle, donde ayuda a diferenciar dos matrículas
 * repetidas de la misma materia. `nombreMateriaCorto` (sin código) es SOLO
 * para la línea 1 de la tarjeta en la vista principal, que B.2 pide sin
 * código de materia.
 *
 * Orden: materias con meta configurada primero (en el orden en que ya
 * vienen), sin configurar al fondo — Array#sort es estable en todos los
 * motores modernos, así que alcanza con comparar "tiene meta" sin tocar el
 * orden relativo dentro de cada grupo.
 */
function obtenerMateriasParaTiempoEstudio() {
  const items = [];
  obtenerSemestresActuales().forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      const plan = obtenerPlanPorId(mm.plan_estudio_id);
      const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
      if (!plan || !materia) return;
      const nombreCorto = aplicarFormatoTexto(materia.nombre);
      const nombreMateria = `${materia.codigo} · ${nombreCorto}`;
      items.push({ mm, materia, plan, nombreMateria, nombreMateriaCorto: nombreCorto });
    });
  });
  items.sort((a, b) => {
    const aConfigurada = a.mm.tiempo_estudio.meta_horas_semana !== null && a.mm.tiempo_estudio.meta_horas_semana !== undefined;
    const bConfigurada = b.mm.tiempo_estudio.meta_horas_semana !== null && b.mm.tiempo_estudio.meta_horas_semana !== undefined;
    if (aConfigurada === bConfigurada) return 0;
    return aConfigurada ? -1 : 1;
  });
  return items;
}

function obtenerNombreMateriaPorMmId(materiaMatriculadaId) {
  const item = obtenerMateriasParaTiempoEstudio().find((x) => x.mm.id === materiaMatriculadaId);
  return item ? item.nombreMateria : null;
}

/** Lunes 00:00:00 → domingo 24:00:00 (exclusivo) de la semana que contiene
 * "ahora", en hora local. Ver nota de cabecera sobre el día de inicio fijo. */
function obtenerRangoSemanaActual() {
  const ahora = new Date();
  const diasDesdeLunes = (ahora.getDay() + 6) % 7; // getDay(): 0=domingo..6=sábado
  const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes, 0, 0, 0, 0);
  const inicioSemanaSiguiente = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7, 0, 0, 0, 0);
  return { inicio: lunes.getTime(), fin: inicioSemanaSiguiente.getTime() };
}

function calcularMinutosEstudiadosEstaSemana(materiaMatriculadaId) {
  const { inicio, fin } = obtenerRangoSemanaActual();
  return (estado.datos.sesiones_estudio || [])
    .filter((s) => s.materia_matriculada_id === materiaMatriculadaId && s.inicio >= inicio && s.inicio < fin)
    .reduce((acc, s) => acc + (Number(s.duracion_minutos) || 0), 0);
}

/** Color elegido para la materia, o el violeta por defecto (mismo fallback
 * que horario.js) si todavía no eligió ninguno. */
function obtenerColorMateria(mm) {
  return mm.tiempo_estudio.color || COLOR_TIEMPO_ESTUDIO_DEFAULT;
}

function formatearHorasMin(minutosTotales) {
  const totales = Math.max(0, Math.round(minutosTotales));
  const h = Math.floor(totales / 60);
  const m = totales % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/* ===================== Regla de una sola sesión activa ===================== */

/**
 * Único punto de entrada de la UI para el botón Iniciar/Detener, tanto
 * desde la tarjeta (inicio rápido) como desde el detalle — así la regla
 * "una sola sesión activa" y el diálogo de "ofrecer cambiar" (punto 6 del
 * plan) se comportan igual sin importar desde dónde se dispare.
 */
function manejarBotonIniciarDetener(materiaMatriculadaId, nombreMateria) {
  const activo = obtenerTimerActivo();

  if (activo && activo.materiaMatriculadaId === materiaMatriculadaId) {
    detenerTimerEstudio();
    mostrarToast("Sesión guardada");
    renderizarTiempoEstudio();
    return;
  }

  if (activo) {
    const nombreActiva = obtenerNombreMateriaPorMmId(activo.materiaMatriculadaId) || "otra materia";
    abrirConfirmacion({
      titulo: "Ya hay un timer corriendo",
      mensaje: `Tenés una sesión activa en ${nombreActiva}. ¿Querés guardarla y empezar en ${nombreMateria}?`,
      textoConfirmar: "Cambiar",
      claseConfirmar: "btn-primary",
      onConfirmar: () => {
        cambiarTimerEstudio(materiaMatriculadaId);
        mostrarToast(`Timer iniciado en ${nombreMateria}`);
        renderizarTiempoEstudio();
      },
    });
    return;
  }

  iniciarTimerEstudio(materiaMatriculadaId);
  mostrarToast(`Timer iniciado en ${nombreMateria}`);
  renderizarTiempoEstudio();
}

/* ===================== Vista principal (tarjetas) ===================== */

/**
 * Tarjeta de materia (Parte B, rediseño): estructura ÚNICA sin importar si
 * la materia tiene meta configurada o no — solo cambia el contenido de la
 * línea 2 (barra+tiempo vs. placeholder "Sin meta configurada"), nunca el
 * alto de la tarjeta ni qué botones aparecen. El color elegido para la
 * materia (o el default violeta si no eligió ninguno, ver
 * obtenerColorMateria) se usa a la vez para el borde de la tarjeta y para
 * el relleno de la barra — mismo criterio de "un solo color" que
 * horario.js.
 */
function construirTarjetaMateria(item) {
  const { mm, nombreMateria, nombreMateriaCorto } = item;
  const meta = mm.tiempo_estudio.meta_horas_semana;
  const tieneMeta = meta !== null && meta !== undefined;
  const color = obtenerColorMateria(mm);

  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card te-tarjeta-materia";
  tarjeta.style.borderColor = color;
  tarjeta.addEventListener("click", () => {
    materiaDetalleActivaId = mm.id;
    renderizarTiempoEstudio();
  });

  // Línea 1: nombre sin código (B.2). Línea 2: barra centrada + tiempo
  // anclado a la derecha si hay meta, o el mismo alto en placeholder si no.
  let lineaDos;
  if (tieneMeta) {
    const minutosEstudiados = calcularMinutosEstudiadosEstaSemana(mm.id);
    const metaMinutos = meta * 60;
    const completada = metaMinutos > 0 && minutosEstudiados >= metaMinutos;
    const porcentaje = metaMinutos > 0 ? Math.min(100, (minutosEstudiados / metaMinutos) * 100) : minutosEstudiados > 0 ? 100 : 0;
    lineaDos = `
      <div class="te-barra-progreso">
        <div class="te-barra-progreso-fill ${completada ? "te-completada" : ""}" style="width:${porcentaje}%; background:${color};"></div>
      </div>
      <span class="muted te-tarjeta-materia-tiempo">${formatearHorasMin(minutosEstudiados)} de ${meta} h</span>
    `;
  } else {
    lineaDos = `<span class="muted te-tarjeta-materia-tiempo">Sin meta configurada</span>`;
  }

  tarjeta.innerHTML = `
    <div class="te-tarjeta-materia-nombre">${nombreMateriaCorto}</div>
    <div class="te-tarjeta-materia-linea2">${lineaDos}</div>
  `;

  const filaBotones = document.createElement("div");
  filaBotones.className = "row-between";
  filaBotones.style.cssText = "gap:8px; align-items:center;";

  const btnConfig = document.createElement("button");
  btnConfig.type = "button";
  btnConfig.className = "btn-icono-fantasma te-btn-icono";
  btnConfig.title = "Configurar";
  btnConfig.setAttribute("aria-label", "Configurar");
  btnConfig.textContent = "⚙";
  btnConfig.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });

  const activo = obtenerTimerActivo();
  const esEstaActiva = Boolean(activo && activo.materiaMatriculadaId === mm.id);
  const btnInicio = document.createElement("button");
  btnInicio.type = "button";
  btnInicio.className = "te-btn-icono " + (esEstaActiva ? "te-btn-icono-detener" : "te-btn-icono-iniciar");
  btnInicio.title = esEstaActiva ? "Detener" : "Iniciar";
  btnInicio.setAttribute("aria-label", esEstaActiva ? "Detener" : "Iniciar");
  btnInicio.textContent = esEstaActiva ? "⏸" : "▶";
  btnInicio.addEventListener("click", (e) => {
    e.stopPropagation();
    manejarBotonIniciarDetener(mm.id, nombreMateria);
  });

  filaBotones.appendChild(btnConfig);
  filaBotones.appendChild(btnInicio);
  tarjeta.appendChild(filaBotones);

  return tarjeta;
}

/**
 * Encabezado (B.1): tarjetita con el título y el switch "Todo"/"Activos".
 * "Activos" filtra las mm sin tiempo_estudio.meta_horas_semana configurado
 * (las que el usuario no marcó como que necesitan estudio). El switch
 * re-renderiza toda la vista principal al cambiar, para que el filtro se
 * aplique de una — ver obtenerFiltroVista/guardarFiltroVista arriba.
 */
function construirEncabezado(cont) {
  const encabezado = document.createElement("div");
  encabezado.className = "glass-card row-between te-encabezado";
  encabezado.style.cssText = "align-items:center; gap:10px;";

  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.style.margin = "0";
  titulo.textContent = "Tiempo de Estudio";
  encabezado.appendChild(titulo);

  const filtroActivo = obtenerFiltroVista() === "activos";
  const filaSwitch = document.createElement("div");
  filaSwitch.style.cssText = "display:flex; align-items:center; gap:8px;";
  filaSwitch.innerHTML = `
    <span class="muted" style="font-size:0.82rem;">${filtroActivo ? "Activos" : "Todo"}</span>
    <label class="switch switch-tema">
      <input type="checkbox" id="te-switch-filtro" ${filtroActivo ? "checked" : ""}>
      <span class="track"><span class="thumb"></span></span>
    </label>
  `;
  encabezado.appendChild(filaSwitch);
  cont.appendChild(encabezado);

  filaSwitch.querySelector("#te-switch-filtro").addEventListener("change", (e) => {
    guardarFiltroVista(e.target.checked ? "activos" : "todo");
    renderizarTiempoEstudio();
  });
}

function construirVistaPrincipal(cont) {
  construirEncabezado(cont);

  let items = obtenerMateriasParaTiempoEstudio();
  if (items.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "No tenés materias matriculadas en tus semestres actuales.";
    cont.appendChild(vacio);
    return;
  }

  if (obtenerFiltroVista() === "activos") {
    items = items.filter((item) => item.mm.tiempo_estudio.meta_horas_semana !== null && item.mm.tiempo_estudio.meta_horas_semana !== undefined);
  }

  if (items.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Ninguna materia tiene tiempo de estudio configurado todavía.";
    cont.appendChild(vacio);
    return;
  }

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "12px";
  items.forEach((item) => lista.appendChild(construirTarjetaMateria(item)));
  cont.appendChild(lista);
}

/* ===================== Pantalla de detalle ===================== */

/**
 * Encabezado de detalle (D.1): una sola tarjeta — flecha sola (sin texto)
 * anclada a la izquierda, engranaje anclado a la derecha (reemplaza al
 * botón "Configurar meta y Pomodoro" que antes vivía suelto más abajo),
 * nombre centrado en el medio.
 *
 * El nombre todavía NO es clickeable: D.1 pide que abra el componente
 * "Buscar materia en..." (Parte C), que todavía no existe — se conecta acá
 * mismo en cuanto esa parte esté lista, sin tener que tocar el resto de
 * este encabezado.
 */
function construirEncabezadoDetalle(cont, mm, nombreMateria) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card te-encabezado-detalle";
  tarjeta.style.cssText = "display:flex; align-items:center; gap:10px;";

  const btnVolver = document.createElement("button");
  btnVolver.type = "button";
  btnVolver.className = "btn-icono-fantasma te-btn-icono";
  btnVolver.title = "Volver";
  btnVolver.setAttribute("aria-label", "Volver");
  btnVolver.textContent = "←";
  btnVolver.addEventListener("click", () => {
    materiaDetalleActivaId = null;
    renderizarTiempoEstudio();
  });

  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion te-encabezado-detalle-nombre";
  titulo.style.cssText = "margin:0; text-align:center; flex:1;";
  titulo.textContent = nombreMateria;

  const btnConfig = document.createElement("button");
  btnConfig.type = "button";
  btnConfig.className = "btn-icono-fantasma te-btn-icono";
  btnConfig.title = "Configurar";
  btnConfig.setAttribute("aria-label", "Configurar");
  btnConfig.textContent = "⚙";
  btnConfig.addEventListener("click", () => {
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });

  tarjeta.appendChild(btnVolver);
  tarjeta.appendChild(titulo);
  tarjeta.appendChild(btnConfig);
  cont.appendChild(tarjeta);
}

function construirPantallaDetalle(cont, item) {
  const { mm, nombreMateria } = item;

  construirEncabezadoDetalle(cont, mm, nombreMateria);

  const meta = mm.tiempo_estudio.meta_horas_semana;
  const minutosEstudiados = calcularMinutosEstudiadosEstaSemana(mm.id);

  const panelMeta = document.createElement("div");
  panelMeta.className = "glass-panel te-detalle-meta";
  panelMeta.style.padding = "12px";
  if (meta === null || meta === undefined) {
    panelMeta.innerHTML = `<span class="muted">Sin meta configurada esta semana.</span>`;
  } else {
    const restanteMin = Math.max(0, meta * 60 - minutosEstudiados);
    panelMeta.innerHTML =
      restanteMin > 0
        ? `<span>Te faltan <strong>${formatearHorasMin(restanteMin)}</strong> para tu meta de ${meta} h esta semana.</span>`
        : `<span>🎉 Ya llegaste a tu meta de ${meta} h esta semana (${formatearHorasMin(minutosEstudiados)}).</span>`;
  }
  cont.appendChild(panelMeta);

  const panelTimer = document.createElement("div");
  panelTimer.className = "glass-card stack";
  panelTimer.style.cssText = "align-items:center; gap:16px; text-align:center;";

  const display = document.createElement("div");
  display.className = "te-timer-display";
  panelTimer.appendChild(display);

  const btnAccion = document.createElement("button");
  btnAccion.type = "button";
  btnAccion.style.minWidth = "160px";
  panelTimer.appendChild(btnAccion);

  cont.appendChild(panelTimer);

  function pintar(activo) {
    const esEstaMateria = Boolean(activo && activo.materiaMatriculadaId === mm.id);
    display.textContent = esEstaMateria ? formatearDuracion(segundosTranscurridos()) : "00:00";
    btnAccion.textContent = esEstaMateria ? "Detener" : "Iniciar";
    btnAccion.className = "btn " + (esEstaMateria ? "btn-danger" : "btn-primary");
  }
  desuscribirTimerDetalle = suscribirseATimer(pintar);

  btnAccion.addEventListener("click", () => manejarBotonIniciarDetener(mm.id, nombreMateria));
  // El botón "Configurar meta y Pomodoro" que vivía acá se movió al
  // engranaje del encabezado (D.1) — mismo modal, un solo punto de entrada.
}

/* ===================== Entrypoints ===================== */

function renderizarTiempoEstudio() {
  const cont = document.getElementById("seccion-tiempo-estudio");
  if (!cont) return;
  cont.innerHTML = "";

  if (desuscribirTimerDetalle) {
    desuscribirTimerDetalle();
    desuscribirTimerDetalle = null;
  }

  if (materiaDetalleActivaId) {
    const item = obtenerMateriasParaTiempoEstudio().find((x) => x.mm.id === materiaDetalleActivaId);
    if (item) {
      construirPantallaDetalle(cont, item);
      return;
    }
    // La materia del detalle ya no existe (plan borrado, etc.) — se cae a
    // la vista de tarjetas en vez de dejar la pantalla rota.
    materiaDetalleActivaId = null;
  }

  construirVistaPrincipal(cont);
}

/**
 * Se llama una sola vez al arrancar la app (mismo criterio que
 * inicializarHorario/inicializarAgenda) — deja el indicador persistente
 * suscrito al motor del timer desde el arranque, para que pueda aparecer
 * en CUALQUIER sección, no solo al entrar a Tiempo de Estudio.
 */
function inicializarTiempoEstudio() {
  const badge = document.getElementById("badge-tiempo-estudio");
  if (!badge) return;

  badge.addEventListener("click", () => {
    const activo = obtenerTimerActivo();
    if (!activo) return;
    materiaDetalleActivaId = activo.materiaMatriculadaId;
    mostrarSeccion("tiempo-estudio");
  });

  suscribirseATimer((activo) => {
    if (!activo) {
      badge.classList.add("oculto");
      badge.textContent = "";
      return;
    }
    const nombre = obtenerNombreMateriaPorMmId(activo.materiaMatriculadaId) || "Materia";
    badge.textContent = `⏱ ${nombre} · ${formatearDuracion(segundosTranscurridos())}`;
    badge.classList.remove("oculto");
  });
}

// Ver mostrarSeccion() en main.js: llama a window.renderizarX?.() para
// varias secciones (agenda/horario/resumen/asistente) en vez del import
// directo — se expone igual acá por consistencia con ese patrón ya
// establecido.
window.renderizarTiempoEstudio = renderizarTiempoEstudio;

export { inicializarTiempoEstudio, renderizarTiempoEstudio };
