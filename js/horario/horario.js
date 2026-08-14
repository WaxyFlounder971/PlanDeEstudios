/* =========================================================================
   HORARIO — Núcleo (grid semanal, navegación entre semanas, config de días)
   No incluye "Horario entre Amigos" (prompt aparte).
   ========================================================================= */

import { calcularNumeroSemanaSemestre, obtenerBloqueEfectivoSemana } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { obtenerSemestresOrdenCronologico, buscarSemestreVivoPorId } from "../semestres/semestres.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import { abrirModalBloqueHorario } from "./horario-modal.js";

const PX_POR_MIN_EXPANDIDO = 0.84; // 30% menos que antes (1.2), pedido explícito
const ALTO_RESERVADO_CHROME = 230; // header de horario + nav inferior, aproximado

// Transitorio (no persistido): qué se está mostrando ahora mismo en Horario.
estado.horarioSemestreId = estado.horarioSemestreId || null;
estado.horarioNumeroSemana = estado.horarioNumeroSemana || null;
estado.horarioExpandido = estado.horarioExpandido || false;

// Cache del último semestre/semana renderizados, para que centrarVistaInicial
// no tenga que recalcular nada por su cuenta.
let cacheSemestre = null;
let cacheNumeroSemana = null;

/* ===================== Helpers de datos ===================== */

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

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

function obtenerNumeroSemanaMostrado(semestre) {
  if (estado.horarioNumeroSemana == null) {
    estado.horarioNumeroSemana = calcularNumeroSemanaSemestre(semestre);
  }
  const total = Number(semestre.duracion_semanas) || 16;
  estado.horarioNumeroSemana = Math.min(Math.max(estado.horarioNumeroSemana, 1), total);
  return estado.horarioNumeroSemana;
}

function minutosDesdeHora(horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Parsea "YYYY-MM-DD" como fecha LOCAL (medianoche en el huso horario del
 * usuario), no UTC. `new Date("YYYY-MM-DD")` interpreta el string como UTC
 * medianoche — en cualquier huso horario negativo (ej. Costa Rica, UTC-6)
 * eso cae en el día anterior a las 6pm local, y de ahí en adelante toda
 * cuenta basada en .getDate()/.setDate() queda corrida un día. Este era el
 * bug de "hoy es jueves y aparece marcado/mostrado como viernes".
 */
function fechaLocalDesdeISO(str) {
  const soloFecha = String(str || "").slice(0, 10);
  const [y, m, d] = soloFecha.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
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

/**
 * "Para no gastar espacio": primer nombre + primer apellido completos,
 * cualquier palabra extra (segundo nombre, segundo apellido) se reduce a
 * su inicial. Ej. "Wagner Andrés Obando Salas" -> "Wagner Obando A. S."
 */
function abreviarNombreProfesor(nombreCompleto) {
  const partes = String(nombreCompleto || "").trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 2) return partes.join(" ");
  const base = partes.slice(0, 2).join(" ");
  const iniciales = partes.slice(2).map((p) => p[0].toUpperCase() + ".").join(" ");
  return `${base} ${iniciales}`;
}

function obtenerNombreProfesor(profesorId) {
  if (!profesorId) return "";
  const prof = (estado.datos.profesores || []).find((p) => p.id === profesorId);
  return prof ? abreviarNombreProfesor(prof.nombre) : "";
}

function obtenerDiasVisiblesOrdenados() {
  const cfg = estado.datos.configuracion;
  const visiblesIds = new Set(cfg.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id));
  const nombres = cfg.nombres_dias_personalizados || {};
  const inicioId = cfg.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const rotado = [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
  return rotado
    .filter((d) => visiblesIds.has(d.id))
    .map((d, idx) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault, offsetDesdeInicio: idx }));
}

/**
 * Fecha calendario real de un día dentro de la semana mostrada, asumiendo
 * que fecha_inicio del semestre es el día 1 de la semana 1 (mismo criterio
 * simple que ya usa calcularNumeroSemanaSemestre para no inventar otro).
 */
function calcularFechaDelDia(semestre, numeroSemana, offsetDesdeInicio) {
  const inicio = fechaLocalDesdeISO(semestre.fecha_inicio);
  if (isNaN(inicio.getTime())) return null;
  const fecha = new Date(inicio);
  fecha.setDate(inicio.getDate() + (numeroSemana - 1) * 7 + offsetDesdeInicio);
  return fecha;
}

function esHoy(fecha) {
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() && fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
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
  return ordenados;
}

/* ===================== Construcción del grid ===================== */

function construirBloquesEfectivosSemana(semestre, numeroSemana) {
  return (semestre.bloques_horario || []).map((b) => obtenerBloqueEfectivoSemana(b, numeroSemana)).filter(Boolean);
}

function construirColumnaHoras(pxPorMin, altoGrid) {
  const col = document.createElement("div");
  col.className = "horario-col-horas";
  col.style.cssText = `position:relative; width:38px; flex-shrink:0; height:${altoGrid}px;`;
  for (let h = 0; h <= 24; h++) {
    const top = h * 60 * pxPorMin;
    const etiqueta = document.createElement("span");
    etiqueta.className = "muted";
    etiqueta.style.cssText = `position:absolute; top:${top - 7}px; right:6px; font-size:0.62rem;`;
    etiqueta.textContent = String(h).padStart(2, "0") + ":00";
    col.appendChild(etiqueta);
  }
  return col;
}

function construirLineasHorarias(pxPorMin) {
  const stops = [];
  for (let min = 0; min <= 24 * 60; min += 30) {
    const y = min * pxPorMin;
    const opacidad = min % 60 === 0 ? 0.28 : 0.1;
    stops.push(`linear-gradient(rgba(150,150,170,${opacidad}), rgba(150,150,170,${opacidad})) 0 ${y}px / 100% 1px no-repeat`);
  }
  return stops.join(",\n");
}

function construirColumnaDia(dia, bloquesDia, semestre, pxPorMin, altoGrid) {
  const col = document.createElement("div");
  col.className = "horario-col-dia";
  col.dataset.diaCodigo = dia.abrevDefault;
  col.style.cssText = `position:relative; flex:1; min-width:56px; height:${altoGrid}px; background:${construirLineasHorarias(pxPorMin)}; cursor:pointer; border-left:1px solid rgba(150,150,170,0.15);`;

  const conLanes = calcularLanesDia(bloquesDia);
  conLanes.forEach((b) => {
    const top = Math.max(0, b.inicioMin * pxPorMin);
    const alto = Math.max(24, (b.finMin - b.inicioMin) * pxPorMin);
    const offsetPx = b.lane * 12;
    const tarjeta = document.createElement("div");
    tarjeta.className = "horario-bloque-tarjeta";
    tarjeta.style.cssText = `position:absolute; top:${top}px; left:${offsetPx}px; right:0; height:${alto}px; z-index:${10 + b.lane};
      background:${b.color}; color:#fff; border-radius:8px; padding:3px 6px; overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.25);`;
    tarjeta.innerHTML = `
      <div style="font-size:16.5px; font-weight:600; line-height:1.15; display:flex; align-items:center; gap:4px;">
        ${b.tieneExcepcionEstaSemana ? `<span title="Esta semana tiene un ajuste puntual" style="font-size:12px; opacity:0.9;">✎</span>` : ""}
        <span>${b.nombreCorto}</span>
      </div>
      ${b.profesorNombre ? `<div style="font-size:13.5px; opacity:0.9;">${b.profesorNombre}</div>` : ""}
      ${b.aula ? `<div style="font-size:13.5px; opacity:0.85;">${b.aula}</div>` : ""}
      ${b.enlace ? `<a href="${b.enlace}" target="_blank" rel="noopener" class="horario-btn-entrar-clase" onclick="event.stopPropagation()">Entrar a clase</a>` : ""}
    `;
    tarjeta.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalBloqueHorario({ semestreId: semestre.id, bloqueId: b.bloqueOriginalId });
    });
    col.appendChild(tarjeta);
  });

  col.addEventListener("click", (ev) => {
    if (ev.target !== col) return;
    const rect = col.getBoundingClientRect();
    const offsetY = ev.clientY - rect.top;
    const minutos = Math.round(offsetY / pxPorMin / 15) * 15;
    mostrarBloqueFlotante(semestre, dia, minutos, ev.clientX, ev.clientY);
  });

  return col;
}

/* ===================== Bloque flotante (1er tap → borrador; 2do tap → modal) ===================== */

function mostrarBloqueFlotante(semestre, dia, minutosInicio, clientX, clientY) {
  const cont = document.getElementById("modal-bloque-flotante");
  if (!cont) return;
  const plan = obtenerPlanActivo();
  const duracion = (plan && plan.parametros_universidad && plan.parametros_universidad.horario_duracion_bloque_min) || 50;
  const horaInicio = `${String(Math.floor(minutosInicio / 60)).padStart(2, "0")}:${String(minutosInicio % 60).padStart(2, "0")}`;
  const finMin = minutosInicio + duracion;
  const horaFin = `${String(Math.floor(finMin / 60)).padStart(2, "0")}:${String(finMin % 60).padStart(2, "0")}`;

  const ANCHO_TARJETA = 200;
  const ALTO_TARJETA_APROX = 60;
  const left = Math.min(Math.max(8, clientX - ANCHO_TARJETA / 2), window.innerWidth - ANCHO_TARJETA - 8);
  const top = Math.min(Math.max(8, clientY - ALTO_TARJETA_APROX - 12), window.innerHeight - ALTO_TARJETA_APROX - 8);

  cont.classList.remove("oculto");
  cont.innerHTML = `
    <div id="horario-flotante-tarjeta" class="glass-panel" style="position:fixed; z-index:200; padding:8px 12px; border-radius:10px;
      width:${ANCHO_TARJETA}px; backdrop-filter:blur(14px); border:1px solid rgba(255,255,255,0.3); cursor:pointer;
      box-shadow:0 6px 20px rgba(0,0,0,0.35); top:${top}px; left:${left}px;">
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

/* ===================== Selector de semestre (tap en el nombre) ===================== */

function abrirSelectorSemestre() {
  const modal = document.getElementById("modal-selector-semestre");
  const cont = document.getElementById("selector-semestre-contenido");
  if (!modal || !cont) return;
  const semestres = obtenerSemestresOrdenCronologico();

  cont.innerHTML = `
    <h3>Elegir semestre</h3>
    <div class="stack" id="selector-semestre-lista" style="gap:8px; max-height:60vh; overflow-y:auto;"></div>
  `;
  const lista = document.getElementById("selector-semestre-lista");
  if (semestres.length === 0) {
    lista.innerHTML = `<p class="muted">No hay semestres todavía.</p>`;
  }
  semestres.forEach((s) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "glass-panel";
    item.style.cssText = "text-align:left; padding:10px 14px; cursor:pointer; border:none; width:100%;";
    const inicio = fechaLocalDesdeISO(s.fecha_inicio);
    const finEstimado = new Date(inicio);
    finEstimado.setDate(inicio.getDate() + (Number(s.duracion_semanas) || 16) * 7);
    const fmt = (d) => (isNaN(d.getTime()) ? "" : d.toLocaleDateString("es-CR", { day: "numeric", month: "short", year: "numeric" }));
    item.innerHTML = `<div style="font-weight:600;">${s.nombre}</div><div class="muted" style="font-size:0.78rem;">${fmt(inicio)} – ${fmt(finEstimado)}</div>`;
    item.addEventListener("click", () => {
      estado.horarioSemestreId = s.id;
      estado.horarioNumeroSemana = null; // recalcula al entrar a ese semestre
      modal.classList.add("oculto");
      renderizarHorario();
    });
    lista.appendChild(item);
  });

  modal.classList.remove("oculto");
}

/* ===================== Header ===================== */

function renderizarHeaderHorario(semestre, numeroSemana) {
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
  if (semanaEl) semanaEl.textContent = `Semana ${numeroSemana}`;
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString("es-CR", { day: "numeric", month: "short" });
}

/* ===================== Vista inicial (centra en la clase más temprana / hora actual) ===================== */

function centrarVistaInicial(contenedor, dias, bloquesEfectivos, pxPorMin) {
  const hoy = new Date();
  const diaHoy = dias.find((d) => esHoy(calcularFechaDelDia(cacheSemestre, cacheNumeroSemana, d.offsetDesdeInicio)));
  let minutoReferencia = hoy.getHours() * 60 + hoy.getMinutes();
  if (diaHoy) {
    const minutosClasesHoy = bloquesEfectivos
      .filter((b) => (b.dias || []).some((d) => d.dia === diaHoy.abrevDefault))
      .flatMap((b) => (b.dias || []).filter((d) => d.dia === diaHoy.abrevDefault).map((d) => minutosDesdeHora(d.hora_inicio)));
    if (minutosClasesHoy.length > 0) minutoReferencia = Math.min(...minutosClasesHoy);
  }
  const destino = Math.max(0, minutoReferencia * pxPorMin - 80);
  if (document.fullscreenElement) {
    document.fullscreenElement.scrollTop = destino;
  } else if (estado.horarioExpandido) {
    window.scrollTo({ top: window.scrollY + destino - window.innerHeight / 3 });
  } else {
    // Modo cerrado por defecto: ya no comprime todo el día para que quepa,
    // corta a la altura disponible y usa su propio scroll vertical interno,
    // arrancando en la hora más temprana que haya en materias registradas
    // (o la hora actual si hoy no hay clases).
    contenedor.scrollTop = destino;
  }
}

/* ===================== Render principal ===================== */

function renderizarHorarioInterno() {
  const cont = document.getElementById("horario-grid");
  const contenedor = document.getElementById("horario-grid-contenedor");
  if (!cont || !contenedor) return;
  const semestre = obtenerSemestreHorarioActual();
  const numeroSemana = semestre ? obtenerNumeroSemanaMostrado(semestre) : null;
  cacheSemestre = semestre;
  cacheNumeroSemana = numeroSemana;
  renderizarHeaderHorario(semestre, numeroSemana);
  cont.innerHTML = "";

  if (!semestre) {
    cont.innerHTML = `<p class="muted" style="padding:16px;">Creá un semestre en la sección Semestres para empezar a armar tu horario.</p>`;
    return;
  }

  const dias = obtenerDiasVisiblesOrdenados();
  const bloquesEfectivos = construirBloquesEfectivosSemana(semestre, numeroSemana);

  // Ya no se comprime el día completo para que "quepa" (se veía feo y
  // amontonado) — siempre se usa el tamaño legible normal. Lo que cambia
  // según el modo es cuánto se ve sin scroll:
  //  - Fullscreen: recorta a 100vh, scroll vertical propio.
  //  - Expandido (barra abierta): sin recorte, scrollea la página entera.
  //  - Cerrado (default): recorta a altoDisponible y scrollea internamente,
  //    arrancando en la clase más temprana del día (ver centrarVistaInicial).
  const pxPorMin = PX_POR_MIN_EXPANDIDO;
  const altoGrid = 24 * 60 * pxPorMin;
  const altoDisponible = Math.max(280, window.innerHeight - ALTO_RESERVADO_CHROME);

  if (document.fullscreenElement) {
    contenedor.style.maxHeight = "100vh";
    contenedor.style.overflowY = "auto";
  } else if (estado.horarioExpandido) {
    contenedor.style.maxHeight = "";
    contenedor.style.overflowY = "visible";
  } else {
    contenedor.style.maxHeight = `${altoDisponible}px`;
    contenedor.style.overflowY = "auto";
  }
  // El propio contenedor maneja AMBOS ejes de scroll (antes el scroll
  // horizontal vivía en un div anidado aparte, lo que hacía que el header
  // sticky "top:0" quedara pegado a ESE div en vez del contenedor real que
  // scrollea verticalmente — se despegaba de la pantalla al hacer scroll).
  // Con un solo contenedor para los dos ejes, el header queda siempre
  // visible arriba Y perfectamente sincronizado con las columnas al
  // scrollear de lado.
  contenedor.style.overflowX = "auto";

  const columnaAncha = document.createElement("div");
  columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

  const headerFila = document.createElement("div");
  // Fondo SÓLIDO (no --bg-panel, que es semitransparente en todas las
  // paletas — ver mismo patrón en .mapa-nodo dentro de design-system.css)
  // para que las tarjetas de materia no se transparenten al pasar detrás.
  // z-index por encima del rango de las tarjetas (10 + lane) para que el
  // header quede siempre POR ENCIMA, nunca tapado por una tarjeta.
  headerFila.style.cssText = "display:flex; position:sticky; top:0; z-index:50; background:var(--bg-canvas); border-bottom:1px solid rgba(150,150,170,0.15);";
  const espaciador = document.createElement("div");
  espaciador.style.cssText = "width:38px; flex-shrink:0;";
  headerFila.appendChild(espaciador);
  dias.forEach((dia) => {
    const fecha = calcularFechaDelDia(semestre, numeroSemana, dia.offsetDesdeInicio);
    const h = document.createElement("div");
    h.style.cssText = "flex:1; min-width:56px; text-align:center; padding:4px 0;";
    h.innerHTML = `
      <div class="${esHoy(fecha) ? "horario-dia-actual-glow" : ""}" style="font-size:0.72rem; font-weight:600;">${dia.etiquetaCorta}</div>
      <div class="muted" style="font-size:0.6rem;">${fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : ""}</div>
    `;
    headerFila.appendChild(h);
  });

  const filaGrid = document.createElement("div");
  filaGrid.style.cssText = "display:flex;";
  filaGrid.appendChild(construirColumnaHoras(pxPorMin, altoGrid));
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
            enlace: b.enlace,
            tieneExcepcionEstaSemana: !!b.tiene_excepcion_esta_semana,
          }))
      );
    filaGrid.appendChild(construirColumnaDia(dia, bloquesDia, semestre, pxPorMin, altoGrid));
  });

  columnaAncha.appendChild(headerFila);
  columnaAncha.appendChild(filaGrid);
  cont.appendChild(columnaAncha);

  // Barra delgada inferior para expandir/contraer a las 24h reales.
  const barra = document.createElement("div");
  barra.className = "horario-barra-expandir";
  barra.innerHTML = `<span class="horario-barra-expandir-icono" style="display:inline-block; transform:rotate(${estado.horarioExpandido ? "90deg" : "-90deg"});">‹</span>`;
  barra.addEventListener("click", () => {
    estado.horarioExpandido = !estado.horarioExpandido;
    renderizarHorarioInterno();
  });
  if (!document.fullscreenElement) cont.appendChild(barra);

  requestAnimationFrame(() => centrarVistaInicial(contenedor, dias, bloquesEfectivos, pxPorMin));
}

function renderizarHorario() {
  renderizarHorarioInterno();
}

/* ===================== Inicialización (listeners, una sola vez) ===================== */

function inicializarHorario() {
  const btnAnterior = document.getElementById("btn-horario-semestre-anterior");
  const btnSiguiente = document.getElementById("btn-horario-semestre-siguiente");
  const btnAgregar = document.getElementById("btn-horario-agregar");
  const btnAmigos = document.getElementById("btn-horario-amigos");
  const btnPantallaCompleta = document.getElementById("btn-horario-pantalla-completa");
  const nombreSemestreEl = document.getElementById("horario-nombre-semestre");

  if (btnAnterior) {
    btnAnterior.addEventListener("click", () => {
      estado.horarioNumeroSemana = Math.max(1, (estado.horarioNumeroSemana || 1) - 1);
      renderizarHorarioInterno();
    });
  }
  if (btnSiguiente) {
    btnSiguiente.addEventListener("click", () => {
      const semestre = obtenerSemestreHorarioActual();
      const total = semestre ? Number(semestre.duracion_semanas) || 16 : 16;
      estado.horarioNumeroSemana = Math.min((estado.horarioNumeroSemana || 1) + 1, total);
      renderizarHorarioInterno();
    });
  }
  if (nombreSemestreEl) {
    nombreSemestreEl.style.cursor = "pointer";
    nombreSemestreEl.addEventListener("click", abrirSelectorSemestre);
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
    document.addEventListener("fullscreenchange", () => requestAnimationFrame(() => renderizarHorarioInterno()));
  }
  window.addEventListener("resize", () => {
    if (!document.getElementById("seccion-horario")?.classList.contains("oculto")) renderizarHorarioInterno();
  });
}

// Se expone en window para que horario-modal.js pueda refrescar el grid tras
// guardar/borrar sin crear un import circular (horario.js ya importa DE
// horario-modal.js) — mismo patrón que mostrarSeccion en main.js.
window.renderizarHorario = renderizarHorario;

export { inicializarHorario, renderizarHorario, obtenerSemestreHorarioActual };
