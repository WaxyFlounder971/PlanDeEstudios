/* =========================================================================
   TIEMPO DE ESTUDIO — Núcleo (Parte 1 + rediseño visual Parte A/B)
   Vista principal (tarjetas por materia matriculada, con barra de progreso
   semanal), pantalla de detalle con timer simple, e indicador persistente
   de sesión activa (visible en cualquier pantalla de la app).

   Rediseño visual (Parte A/B, iteración final): tarjetas delgadas estilo
   Semestres/Plan de Estudios (.materia-card + código/nombre en línea 1),
   franja de color SOLO a la izquierda (nunca todo el borde), color por
   defecto = el mismo que ya usa Horario para esa materia (color de
   categoría), editable por el usuario. Filtro Todo/Activos como pills
   (mismo componente que Lista/Calendario/Cronograma de Agenda). Encabezado
   de detalle con franja de color horizontal arriba, y timer → barra de
   progreso → texto simple, en ese orden. El componente "Buscar materia
   en..." (Parte C) y su conexión al nombre clickeable de detalle (D.1) y a
   la tarjeta vieja de Plan de Estudios (D.2) quedan para cuando estén
   disponibles agenda.js/plan-esquema.js.

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

/**
 * Color efectivo de una materia (rediseño): mismo criterio EXACTO que
 * obtenerColorBloque() en horario.js — 1) el color propio que el usuario
 * eligió en tiempo_estudio.color (override, opcional), 2) si no eligió
 * ninguno, el color de la CATEGORÍA de la materia en el plan (el mismo que
 * ya usan Horario y Agenda para esa materia, así no hay dos violetas
 * distintos por accidente), 3) el violeta por defecto si la materia no
 * tiene categoría con color.
 */
function obtenerColorMateria(mm, materia, plan) {
  if (mm.tiempo_estudio.color) return mm.tiempo_estudio.color;
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  return (categoria && categoria.color) || COLOR_TIEMPO_ESTUDIO_DEFAULT;
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
 * Tarjeta de materia (rediseño: copia el lenguaje visual de las tarjetas de
 * Semestres/Plan de Estudios). Delgada (.materia-card), línea 1 con
 * código+nombre (mismas clases .materia-linea1/.materia-codigo/
 * .materia-nombre que ya usa el resto de la app — el nombre resalta, el
 * código queda chico pero visible, sirve para diferenciar repeticiones),
 * línea 2 con el tiempo anclado a la izquierda y engranaje+play/pausa
 * agrupados y anclados a la derecha, del mismo tamaño exacto (36×36, ver
 * .te-btn-icono). Sin barra de progreso acá — esa vive en el detalle. La
 * franja de color va SOLO a la izquierda (box-shadow inset), nunca
 * alrededor de toda la tarjeta.
 */
function construirTarjetaMateria(item) {
  const { mm, materia, plan, nombreMateria, nombreMateriaCorto } = item;
  const meta = mm.tiempo_estudio.meta_horas_semana;
  const tieneMeta = meta !== null && meta !== undefined;
  const color = obtenerColorMateria(mm, materia, plan);

  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card materia-card te-tarjeta-materia";
  tarjeta.style.boxShadow = `var(--shadow-glass), inset 4px 0 0 0 ${color}`;
  tarjeta.addEventListener("click", () => {
    materiaDetalleActivaId = mm.id;
    renderizarTiempoEstudio();
  });

  const textoTiempo = tieneMeta
    ? `${formatearHorasMin(calcularMinutosEstudiadosEstaSemana(mm.id))} de ${meta} h`
    : "Sin meta configurada";

  tarjeta.innerHTML = `
    <div class="materia-linea1">
      <span class="materia-codigo">${materia.codigo}</span>
      <span class="materia-nombre truncada">${nombreMateriaCorto}</span>
    </div>
    <div class="te-tarjeta-materia-linea2">
      <span class="te-tarjeta-materia-tiempo">${textoTiempo}</span>
    </div>
  `;

  const filaBotones = document.createElement("div");
  filaBotones.className = "te-tarjeta-materia-botones";

  const btnConfig = document.createElement("button");
  btnConfig.type = "button";
  btnConfig.className = "te-btn-icono te-btn-icono-fantasma";
  btnConfig.title = "Configurar";
  btnConfig.setAttribute("aria-label", "Configurar");
  btnConfig.textContent = "⚙️";
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
  tarjeta.querySelector(".te-tarjeta-materia-linea2").appendChild(filaBotones);

  return tarjeta;
}

/**
 * Encabezado (B.1): tarjetita con el título y el filtro "Todo"/"Activos"
 * como pills (mismo componente .pill-group/.pill-item que ya usa Agenda
 * para Lista/Calendario/Cronograma), no un switch on/off. "Activos" filtra
 * las mm sin tiempo_estudio.meta_horas_semana configurado.
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

  const filtroActual = obtenerFiltroVista();
  const pills = document.createElement("div");
  pills.className = "pill-group te-filtro-pills";
  pills.innerHTML = `
    <button type="button" class="pill-item ${filtroActual === "todo" ? "active" : ""}" data-filtro="todo">Todo</button>
    <button type="button" class="pill-item ${filtroActual === "activos" ? "active" : ""}" data-filtro="activos">Activos</button>
  `;
  encabezado.appendChild(pills);
  cont.appendChild(encabezado);

  pills.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      guardarFiltroVista(btn.dataset.filtro);
      renderizarTiempoEstudio();
    });
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
function construirEncabezadoDetalle(cont, mm, materia, plan, nombreMateria) {
  const color = obtenerColorMateria(mm, materia, plan);

  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card te-encabezado-detalle";
  tarjeta.style.cssText = `display:flex; align-items:center; gap:10px; --te-color-materia:${color};`;

  const btnVolver = document.createElement("button");
  btnVolver.type = "button";
  btnVolver.className = "te-btn-icono te-btn-icono-fantasma";
  btnVolver.title = "Volver";
  btnVolver.setAttribute("aria-label", "Volver");
  btnVolver.textContent = "◀";
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
  btnConfig.className = "te-btn-icono te-btn-icono-fantasma";
  btnConfig.title = "Configurar";
  btnConfig.setAttribute("aria-label", "Configurar");
  btnConfig.textContent = "⚙️";
  btnConfig.addEventListener("click", () => {
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });

  tarjeta.appendChild(btnVolver);
  tarjeta.appendChild(titulo);
  tarjeta.appendChild(btnConfig);
  cont.appendChild(tarjeta);
}

function construirPantallaDetalle(cont, item) {
  const { mm, materia, plan, nombreMateria } = item;

  construirEncabezadoDetalle(cont, mm, materia, plan, nombreMateria);

  const meta = mm.tiempo_estudio.meta_horas_semana;
  const minutosEstudiados = calcularMinutosEstudiadosEstaSemana(mm.id);

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

  // Barra de progreso (rediseño): ahora va DEBAJO del timer, alargada, con
  // un solo renglón de texto centrado debajo — reemplaza al panel de texto
  // largo ("Te faltan X h para tu meta de Y h esta semana") que antes iba
  // arriba del timer.
  if (meta !== null && meta !== undefined) {
    const metaMinutos = meta * 60;
    const completada = metaMinutos > 0 && minutosEstudiados >= metaMinutos;
    const porcentaje = metaMinutos > 0 ? Math.min(100, (minutosEstudiados / metaMinutos) * 100) : minutosEstudiados > 0 ? 100 : 0;
    const restanteMin = Math.max(0, metaMinutos - minutosEstudiados);

    const panelProgreso = document.createElement("div");
    panelProgreso.className = "te-detalle-progreso";
    panelProgreso.innerHTML = `
      <div class="te-barra-progreso">
        <div class="te-barra-progreso-fill ${completada ? "te-completada" : ""}" style="width:${porcentaje}%; background:${obtenerColorMateria(mm, materia, plan)};"></div>
      </div>
      <span class="te-detalle-meta">${completada ? `🎉 Meta cumplida (${formatearHorasMin(minutosEstudiados)})` : `Faltan ${formatearHorasMin(restanteMin)}`}</span>
    `;
    cont.appendChild(panelProgreso);
  } else {
    const sinMeta = document.createElement("p");
    sinMeta.className = "te-detalle-meta";
    sinMeta.textContent = "Sin meta configurada esta semana.";
    cont.appendChild(sinMeta);
  }

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
