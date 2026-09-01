/* =========================================================================
   TIEMPO DE ESTUDIO — Núcleo (Parte 1)
   Vista principal (tarjetas por materia matriculada, con barra de progreso
   semanal), pantalla de detalle con timer simple, e indicador persistente
   de sesión activa (visible en cualquier pantalla de la app).

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

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

/**
 * Recorre las materias matriculadas de los semestres ACTUALES (nunca
 * pasados) y resuelve el nombre real de cada una contra su plan. Descarta
 * en silencio cualquier mm cuyo plan o materia ya no exista (plan
 * borrado), en vez de romper el render.
 */
function obtenerMateriasParaTiempoEstudio() {
  const items = [];
  obtenerSemestresActuales().forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      const plan = obtenerPlanPorId(mm.plan_estudio_id);
      const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
      if (!plan || !materia) return;
      const nombreMateria = `${materia.codigo} · ${aplicarFormatoTexto(materia.nombre)}`;
      items.push({ mm, materia, plan, nombreMateria });
    });
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

function construirTarjetaMateria(item) {
  const { mm, nombreMateria } = item;
  const meta = mm.tiempo_estudio.meta_horas_semana;

  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card te-tarjeta-materia";
  tarjeta.addEventListener("click", () => {
    materiaDetalleActivaId = mm.id;
    renderizarTiempoEstudio();
  });

  // Estado "sin meta configurada" — mismo tamaño de tarjeta, sin barra de
  // progreso vacía (punto 2 del plan).
  if (meta === null || meta === undefined) {
    const fila = document.createElement("div");
    fila.className = "te-tarjeta-sin-meta";
    fila.innerHTML = `
      <div>
        <div class="te-tarjeta-materia-nombre">${nombreMateria}</div>
        <span class="muted" style="font-size:0.82rem;">Sin meta configurada</span>
      </div>
    `;
    const btnConfigurar = document.createElement("button");
    btnConfigurar.type = "button";
    btnConfigurar.className = "btn btn-secondary te-btn-inicio-rapido";
    btnConfigurar.textContent = "Configurar";
    btnConfigurar.addEventListener("click", (e) => {
      e.stopPropagation();
      abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
    });
    fila.appendChild(btnConfigurar);
    tarjeta.appendChild(fila);
    return tarjeta;
  }

  const minutosEstudiados = calcularMinutosEstudiadosEstaSemana(mm.id);
  const metaMinutos = meta * 60;
  const completada = metaMinutos > 0 && minutosEstudiados >= metaMinutos;
  const porcentaje = metaMinutos > 0 ? Math.min(100, (minutosEstudiados / metaMinutos) * 100) : minutosEstudiados > 0 ? 100 : 0;

  tarjeta.innerHTML = `
    <div class="te-tarjeta-materia-header">
      <span class="te-tarjeta-materia-nombre">${nombreMateria}</span>
    </div>
    <div class="te-barra-progreso">
      <div class="te-barra-progreso-fill ${completada ? "te-completada" : ""}" style="width:${porcentaje}%;"></div>
    </div>
    <span class="muted" style="font-size:0.82rem;">${formatearHorasMin(minutosEstudiados)} de ${meta} h</span>
  `;

  const filaBotones = document.createElement("div");
  filaBotones.className = "row-between";
  filaBotones.style.cssText = "gap:8px; align-items:center;";

  const btnConfig = document.createElement("button");
  btnConfig.type = "button";
  btnConfig.className = "btn-icono-fantasma";
  btnConfig.title = "Configurar";
  btnConfig.textContent = "⚙️";
  btnConfig.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });

  const activo = obtenerTimerActivo();
  const esEstaActiva = Boolean(activo && activo.materiaMatriculadaId === mm.id);
  const btnInicio = document.createElement("button");
  btnInicio.type = "button";
  btnInicio.className = "btn " + (esEstaActiva ? "btn-danger" : "btn-primary") + " te-btn-inicio-rapido";
  btnInicio.textContent = esEstaActiva ? "Detener" : "Iniciar";
  btnInicio.addEventListener("click", (e) => {
    e.stopPropagation();
    manejarBotonIniciarDetener(mm.id, nombreMateria);
  });

  filaBotones.appendChild(btnConfig);
  filaBotones.appendChild(btnInicio);
  tarjeta.appendChild(filaBotones);

  return tarjeta;
}

function construirVistaPrincipal(cont) {
  const encabezado = document.createElement("h2");
  encabezado.className = "texto-encabezado-seccion";
  encabezado.textContent = "Tiempo de Estudio";
  cont.appendChild(encabezado);

  const items = obtenerMateriasParaTiempoEstudio();
  if (items.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "No tenés materias matriculadas en tus semestres actuales.";
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

function construirPantallaDetalle(cont, item) {
  const { mm, nombreMateria } = item;

  const btnVolver = document.createElement("button");
  btnVolver.type = "button";
  btnVolver.className = "btn-discreto";
  btnVolver.textContent = "← Volver";
  btnVolver.addEventListener("click", () => {
    materiaDetalleActivaId = null;
    renderizarTiempoEstudio();
  });
  cont.appendChild(btnVolver);

  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.style.textAlign = "center";
  titulo.textContent = nombreMateria;
  cont.appendChild(titulo);

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

  const btnConfigurar = document.createElement("button");
  btnConfigurar.type = "button";
  btnConfigurar.className = "btn btn-secondary";
  btnConfigurar.textContent = "Configurar meta y Pomodoro";
  btnConfigurar.addEventListener("click", () => {
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });
  cont.appendChild(btnConfigurar);
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
