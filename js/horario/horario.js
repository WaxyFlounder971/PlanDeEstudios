/* =========================================================================
   HORARIO — Núcleo (grid semanal, navegación entre semestres, config de días)
   No incluye el modal completo de creación/edición (ver horario-modal.js) ni
   "Horario entre Amigos" (prompt aparte).
   ========================================================================= */

import { calcularNumeroSemanaSemestre, obtenerBloqueEfectivoSemana } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { obtenerSemestreAdyacente, obtenerSemestresOrdenCronologico, buscarSemestreVivoPorId } from "../semestres/semestres.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import { abrirModalBloqueHorario } from "./horario-modal.js";

const HORA_INICIO_GRID = 6; // 06:00
const HORA_FIN_GRID = 22; // 22:00
const PX_POR_MIN = 1.2;
const ALTO_GRID = (HORA_FIN_GRID - HORA_INICIO_GRID) * 60 * PX_POR_MIN;

// Transitorio (no persistido): semestre mostrado actualmente en Horario.
estado.horarioSemestreId = estado.horarioSemestreId || null;

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

/**
 * Resuelve el semestre a mostrar: el guardado en estado.horarioSemestreId si
 * sigue existiendo, si no el semestre "actual" más reciente, si no el
 * primero en orden cronológico, si no null (todavía no hay semestres).
 */
function obtenerSemestreHorarioActual() {
  if (estado.horarioSemestreId) {
    const vivo = buscarSemestreVivoPorId(estado.horarioSemestreId);
    if (vivo) return vivo;
  }
  const cronologico = obtenerSemestresOrdenCronologico();
  if (cronologico.length === 0) return null;
  const actuales = cronologico.filter((s) => s.estado_manual !== "pasado");
  const elegido = actuales[actuales.length - 1] || cronologico[cronologico.length - 1];
  estado.horarioSemestreId = elegido.id;
  return elegido;
}

function minutosDesdeHora(horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function obtenerColorBloque(bloqueEfectivo) {
  if (bloqueEfectivo.color) return bloqueEfectivo.color;
  if (!bloqueEfectivo.materia_id) return "#a78bfa";
  const plan = obtenerPlanPorId(bloqueEfectivo.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === bloqueEfectivo.materia_id);
  const categoria = plan && materia && plan.categorias.find((c) => c.id === materia.categoria_id);
  return (categoria && categoria.color) || "#a78bfa";
}

function obtenerNombreBloque(bloqueEfectivo) {
  if (bloqueEfectivo.apodo) return bloqueEfectivo.apodo;
  if (!bloqueEfectivo.materia_id) return bloqueEfectivo.nombre || "Personalizado";
  const plan = obtenerPlanPorId(bloqueEfectivo.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === bloqueEfectivo.materia_id);
  return (materia && materia.nombre) || "Materia";
}

function obtenerNombreProfesor(profesorId) {
  if (!profesorId) return "";
  const prof = (estado.datos.profesores || []).find((p) => p.id === profesorId);
  return prof ? prof.nombre : "";
}

/**
 * Devuelve DIAS_SEMANA_CONFIG filtrado a dias_visibles y rotado para que
 * empiece en dia_inicio_semana. abrevDefault ES el código de letra
 * ("L"|"K"|"M"|"J"|"V"|"S"|"D") que ya usa bloque.dias[].dia en schema.js —
 * único punto de verdad para esa conversión, no se inventa un mapeo aparte.
 */
function obtenerDiasVisiblesOrdenados() {
  const cfg = estado.datos.configuracion;
  const visiblesIds = new Set(cfg.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id));
  const nombres = cfg.nombres_dias_personalizados || {};
  const inicioId = cfg.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const rotado = [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
  return rotado
    .filter((d) => visiblesIds.has(d.id))
    .map((d) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault }));
}

/* ===================== Choques de horario (apilado tipo cartas) ===================== */

function calcularLanesDia(bloquesDia) {
  const ordenados = [...bloquesDia].sort((a, b) => a.inicioMin - b.inicioMin);
  const finesLane = [];
  ordenados.forEach((b) => {
    let lane = finesLane.findIndex((fin) => fin <= b.inicioMin);
    if (lane === -1) {
      lane = finesLane.length;
      finesLane.push(b.finMin);
    } else {
      finesLane[lane] = b.finMin;
    }
    b.lane = lane;
  });
  const totalLanes = finesLane.length || 1;
  ordenados.forEach((b) => (b.totalLanes = totalLanes));
  return ordenados;
}

/* ===================== Construcción del grid ===================== */

function construirBloquesEfectivosSemana(semestre, numeroSemana) {
  return (semestre.bloques_horario || [])
    .map((b) => obtenerBloqueEfectivoSemana(b, numeroSemana))
    .filter(Boolean);
}

function construirColumnaHoras() {
  const col = document.createElement("div");
  col.className = "horario-col-horas";
  col.style.cssText = `position:relative; width:44px; flex-shrink:0; height:${ALTO_GRID}px;`;
  for (let h = HORA_INICIO_GRID; h <= HORA_FIN_GRID; h++) {
    const top = (h - HORA_INICIO_GRID) * 60 * PX_POR_MIN;
    const etiqueta = document.createElement("span");
    etiqueta.className = "muted";
    etiqueta.style.cssText = `position:absolute; top:${top - 7}px; right:6px; font-size:0.68rem;`;
    etiqueta.textContent = String(h).padStart(2, "0") + ":00";
    col.appendChild(etiqueta);
  }
  return col;
}

function construirLineasHorarias() {
  // Línea marcada en cada hora en punto, línea tenue en cada media hora.
  const stops = [];
  for (let min = 0; min <= (HORA_FIN_GRID - HORA_INICIO_GRID) * 60; min += 30) {
    const y = min * PX_POR_MIN;
    const grosor = min % 60 === 0 ? 1 : 1;
    const opacidad = min % 60 === 0 ? 0.28 : 0.1;
    stops.push(`linear-gradient(rgba(150,150,170,${opacidad}), rgba(150,150,170,${opacidad})) 0 ${y}px / 100% ${grosor}px no-repeat`);
  }
  return stops.join(",\n");
}

function construirColumnaDia(dia, bloquesDia, semestre) {
  const col = document.createElement("div");
  col.className = "horario-col-dia";
  col.dataset.diaCodigo = dia.abrevDefault;
  col.style.cssText = `position:relative; flex:1; min-width:64px; height:${ALTO_GRID}px; background:${construirLineasHorarias()}; cursor:pointer; border-left:1px solid rgba(150,150,170,0.15);`;

  const conLanes = calcularLanesDia(bloquesDia);
  conLanes.forEach((b) => {
    const top = Math.max(0, (b.inicioMin - HORA_INICIO_GRID * 60) * PX_POR_MIN);
    const alto = Math.max(20, (b.finMin - b.inicioMin) * PX_POR_MIN);
    const offsetPx = b.lane * 12;
    const tarjeta = document.createElement("div");
    tarjeta.className = "horario-bloque-tarjeta";
    tarjeta.style.cssText = `position:absolute; top:${top}px; left:${offsetPx}px; right:0; height:${alto}px; z-index:${10 + b.lane};
      background:${b.color}; color:#fff; border-radius:8px; padding:3px 6px; overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.25);`;
    tarjeta.innerHTML = `
      <div style="font-size:11px; font-weight:600; line-height:1.15;">${b.nombreCorto}</div>
      ${b.profesorNombre ? `<div style="font-size:9px; opacity:0.9;">${b.profesorNombre}</div>` : ""}
      ${b.aula ? `<div style="font-size:9px; opacity:0.85;">${b.aula}</div>` : ""}
    `;
    tarjeta.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalBloqueHorario({ semestreId: semestre.id, bloqueId: b.bloqueOriginalId });
    });
    col.appendChild(tarjeta);
  });

  col.addEventListener("click", (ev) => {
    if (ev.target !== col) return; // solo celda vacía, no sobre una tarjeta
    const rect = col.getBoundingClientRect();
    const offsetY = ev.clientY - rect.top;
    const minutos = HORA_INICIO_GRID * 60 + Math.round(offsetY / PX_POR_MIN / 15) * 15;
    mostrarBloqueFlotante(semestre, dia, minutos);
  });

  return col;
}

/* ===================== Bloque flotante (1er tap → borrador; 2do tap → modal) ===================== */

function mostrarBloqueFlotante(semestre, dia, minutosInicio) {
  const cont = document.getElementById("modal-bloque-flotante");
  if (!cont) return;
  const plan = obtenerPlanActivo();
  const duracion = (plan && plan.parametros_universidad && plan.parametros_universidad.horario_duracion_bloque_min) || 50;
  const horaInicio = `${String(Math.floor(minutosInicio / 60)).padStart(2, "0")}:${String(minutosInicio % 60).padStart(2, "0")}`;
  const finMin = minutosInicio + duracion;
  const horaFin = `${String(Math.floor(finMin / 60)).padStart(2, "0")}:${String(finMin % 60).padStart(2, "0")}`;

  cont.classList.remove("oculto");
  cont.innerHTML = `
    <div id="horario-flotante-tarjeta" class="glass-panel" style="position:fixed; z-index:200; padding:8px 12px; border-radius:10px;
      backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.3); cursor:pointer; box-shadow:0 6px 20px rgba(0,0,0,0.35);
      top:50%; left:50%; transform:translate(-50%,-50%);">
      <div style="font-weight:600; font-size:0.85rem;">Nuevo bloque — ${dia.etiqueta}</div>
      <div class="muted" style="font-size:0.75rem;">${horaInicio} – ${horaFin} · tocá para completar</div>
    </div>
    <div id="horario-flotante-fondo" style="position:fixed; inset:0; z-index:199;"></div>
  `;

  const cerrar = () => {
    cont.classList.add("oculto");
    cont.innerHTML = "";
  };
  document.getElementById("horario-flotante-fondo").addEventListener("click", cerrar);
  document.getElementById("horario-flotante-tarjeta").addEventListener("click", () => {
    cerrar();
    abrirModalBloqueHorario({
      semestreId: semestre.id,
      bloqueId: null,
      diaPreseleccionado: dia.abrevDefault,
      horaInicioPreseleccionada: horaInicio,
      horaFinPreseleccionada: horaFin,
    });
  });
}

/* ===================== Header: navegación + semana actual ===================== */

function renderizarHeaderHorario(semestre) {
  const nombreEl = document.getElementById("horario-nombre-semestre");
  const semanaEl = document.getElementById("horario-semana-actual");
  const fechaEl = document.getElementById("horario-fecha-actual");
  if (!semestre) {
    if (nombreEl) nombreEl.textContent = "Sin semestres";
    if (semanaEl) semanaEl.textContent = "—";
    if (fechaEl) fechaEl.textContent = "";
    return;
  }
  if (nombreEl) nombreEl.textContent = semestre.nombre || "";
  const numeroSemana = calcularNumeroSemanaSemestre(semestre);
  if (semanaEl) semanaEl.textContent = numeroSemana ? `Semana ${numeroSemana}` : "Fuera de rango";
  if (fechaEl) {
    fechaEl.textContent = new Date().toLocaleDateString("es-CR", { day: "numeric", month: "short" });
  }
  return numeroSemana;
}

/* ===================== Render principal ===================== */

function renderizarHorario() {
  const cont = document.getElementById("horario-grid");
  if (!cont) return;
  const semestre = obtenerSemestreHorarioActual();
  const numeroSemana = renderizarHeaderHorario(semestre);
  cont.innerHTML = "";

  if (!semestre) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">Creá un semestre en la sección Semestres para empezar a armar tu horario.</p>`;
    return;
  }

  const dias = obtenerDiasVisiblesOrdenados();
  const bloquesEfectivos = construirBloquesEfectivosSemana(semestre, numeroSemana || 1);

  // Encabezado de días
  const headerFila = document.createElement("div");
  headerFila.style.cssText = "display:flex; position:sticky; top:0; z-index:5; background:inherit;";
  const espaciador = document.createElement("div");
  espaciador.style.cssText = "width:44px; flex-shrink:0;";
  headerFila.appendChild(espaciador);
  dias.forEach((dia) => {
    const h = document.createElement("div");
    h.style.cssText = "flex:1; min-width:64px; text-align:center; font-size:0.72rem; font-weight:600; padding:4px 0;";
    h.textContent = dia.etiquetaCorta;
    headerFila.appendChild(h);
  });

  const filaGrid = document.createElement("div");
  filaGrid.style.cssText = "display:flex; overflow-x:auto;";
  filaGrid.appendChild(construirColumnaHoras());
  dias.forEach((dia) => {
    const bloquesDia = bloquesEfectivos
      .filter((b) => (b.dias || []).some((d) => d.dia === dia.abrevDefault))
      .flatMap((b) =>
        (b.dias || [])
          .filter((d) => d.dia === dia.abrevDefault)
          .map((d) => ({
            bloqueOriginalId: b.id,
            inicioMin: minutosDesdeHora(d.hora_inicio),
            finMin: minutosDesdeHora(d.hora_fin),
            color: obtenerColorBloque(b),
            nombreCorto: obtenerNombreBloque(b),
            profesorNombre: obtenerNombreProfesor(b.profesor_id),
            aula: b.aula,
          }))
      );
    filaGrid.appendChild(construirColumnaDia(dia, bloquesDia, semestre));
  });

  cont.appendChild(headerFila);
  cont.appendChild(filaGrid);
}

/* ===================== Inicialización (listeners, una sola vez) ===================== */

function inicializarHorario() {
  const btnAnterior = document.getElementById("btn-horario-semestre-anterior");
  const btnSiguiente = document.getElementById("btn-horario-semestre-siguiente");
  const btnAgregar = document.getElementById("btn-horario-agregar");
  const btnAmigos = document.getElementById("btn-horario-amigos");
  const btnPantallaCompleta = document.getElementById("btn-horario-pantalla-completa");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      const actual = obtenerSemestreHorarioActual();
      if (!actual) return;
      const adyacente = obtenerSemestreAdyacente(actual.id, -1);
      if (adyacente) {
        estado.horarioSemestreId = adyacente.id;
        renderizarHorario();
      }
    });
  }
  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const actual = obtenerSemestreHorarioActual();
      if (!actual) return;
      const adyacente = obtenerSemestreAdyacente(actual.id, 1);
      if (adyacente) {
        estado.horarioSemestreId = adyacente.id;
        renderizarHorario();
      }
    });
  }
  if (btnAgregar) {
    btnAgregar.addEventListener("click", () => {
      const semestre = obtenerSemestreHorarioActual();
      if (!semestre) {
        mostrarToast("Creá un semestre primero");
        return;
      }
      abrirModalBloqueHorario({ semestreId: semestre.id, bloqueId: null });
    });
  }
  if (btnAmigos) {
    btnAmigos.addEventListener("click", () => mostrarToast("Horario entre Amigos: próximamente"));
  }
  if (btnPantallaCompleta) {
    const contenedor = document.getElementById("horario-grid-contenedor");
    btnPantallaCompleta.addEventListener("click", () => {
      if (!contenedor) return;
      if (document.fullscreenElement) document.exitFullscreen();
      else contenedor.requestFullscreen?.();
    });
  }
}

// Se expone en window para que horario-modal.js pueda refrescar el grid tras
// guardar/borrar sin crear un import circular (horario.js ya importa DE
// horario-modal.js) — mismo patrón que mostrarSeccion en main.js.
window.renderizarHorario = renderizarHorario;

export { inicializarHorario, renderizarHorario, obtenerSemestreHorarioActual };
