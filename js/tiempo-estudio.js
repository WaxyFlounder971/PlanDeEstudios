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
import { marcarCambioPendiente, registrarHookPostFusion } from "../core/storage-sync.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { COLOR_TIEMPO_ESTUDIO_DEFAULT, crearMateriaEstudioIndependiente, sellarTimestamp } from "../core/schema.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales } from "../semestres/semestres.js";
import { mostrarSeccion } from "../main.js";
import { abrirModalConfigTiempoEstudio, abrirModalPomodoroPredeterminado } from "./tiempo-estudio-config.js";
import { abrirModalRegistroManual, construirListaSesiones } from "./tiempo-estudio-registro.js";
import { construirVistaEstadisticas, construirEstadisticasMateria, calcularMetaDiariaMateria } from "./tiempo-estudio-estadisticas.js";
import { construirVistaCompetencias } from "./tiempo-estudio-competencias.js";
import { montarIndicadoresTimer } from "./tiempo-estudio-indicador.js";
import { construirChipRacha, inicializarRacha, alFusionarDatosRacha } from "./tiempo-estudio-racha-ui.js";
import { abrirBuscarMateriaEn } from "../ui/buscar-materia.js";
import {
  cambiarTimerEstudio,
  detenerTimerEstudio,
  formatearDuracion,
  hayTimerActivo,
  iniciarTimerEstudio,
  obtenerTimerActivo,
  pausarTimerEstudio,
  reanudarTimerEstudio,
  revisarSesionOlvidadaAlAbrir,
  saltarDescansoPomodoro,
  iniciarDescansoPomodoro,
  tiempoDeFase,
  suscribirseATimer,
} from "./tiempo-estudio-timer.js";

// mm.id de la materia en pantalla de detalle, o null = vista de tarjetas.
let materiaDetalleActivaId = null;
// Parte 3: "materias" (lo que ya existía) | "estadisticas" (nuevo) — pill
// arriba del encabezado principal. Solo aplica al nivel superior, nunca
// dentro de la pantalla de detalle de una materia puntual (Estadísticas es
// un agregado de TODAS las materias, no tiene sentido adentro del detalle
// de una sola). Módulo-nivel, mismo criterio que materiaDetalleActivaId:
// no se persiste, se resetea solo si se recarga la página.
let vistaSeccionTE = "materias";
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
 * código, ej. "IC-1010 · Cálculo I") se sigue usando en toast/título de
 * detalle, donde ayuda a diferenciar dos matrículas repetidas de la misma
 * materia. `nombreMateriaCorto` (sin código) es para la línea 1 de la
 * tarjeta en la vista principal (B.2) y, desde 2026-09-19, para el
 * indicador de sesión activa (tiempo-estudio-indicador.js), que también se
 * pidió sin código.
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
      items.push({ mm, materia, plan, semestre, nombreMateria, nombreMateriaCorto: nombreCorto });
    });
  });
  (estado.datos.tiempo_estudio_materias || []).forEach((mm) => {
    if (mm.tipo !== "independiente") return;
    const nombre = aplicarFormatoTexto(mm.nombre || "Materia propia");
    items.push({
      mm,
      materia: { id: mm.id, codigo: "", nombre, categoria_id: null },
      plan: null,
      semestre: null,
      nombreMateria: nombre,
      nombreMateriaCorto: nombre,
      esIndependiente: true,
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
    .filter((s) => (s.materia_independiente_id || s.materia_matriculada_id) === materiaMatriculadaId && s.inicio >= inicio && s.inicio < fin)
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
  if (mm.tipo === "independiente" || !materia || !plan) return COLOR_TIEMPO_ESTUDIO_DEFAULT;
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
    // Parte 2: detenerTimerEstudio() ahora puede devolver null si lo que se
    // detuvo fue un descanso de Pomodoro (los descansos nunca generan
    // sesión) — el toast avisa eso en vez de decir "Sesión guardada" cuando
    // en realidad no se guardó nada.
    const sesion = detenerTimerEstudio();
    mostrarToast(sesion ? "Sesión guardada" : "Descanso descartado (no se guardó nada)");
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
  const { mm, materia, plan, semestre, nombreMateria, nombreMateriaCorto } = item;
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

  // FIX 2026-09-19 (Parte B): sin meta, la tarjeta decía SOLO "Sin meta
  // configurada" — registrar o cronometrar tiempo en una materia así no
  // dejaba ninguna señal visible en la vista principal, y era lo que
  // llevaba a pensar que "no se guardó". Ahora, si esta semana hay tiempo
  // estudiado, se muestra igual (solo se agrega el dato; sin barra, porque
  // no hay meta contra la cual proporcionarla).
  const minutosEstaSemana = calcularMinutosEstudiadosEstaSemana(mm.id);
  const textoTiempo = tieneMeta
    ? `${formatearHorasMin(minutosEstaSemana)} de ${meta} h`
    : minutosEstaSemana > 0
      ? `${formatearHorasMin(minutosEstaSemana)} esta semana · sin meta`
      : "Sin meta configurada";

  // Orden pedido: nombre → tiempo/botones → barra AL FINAL (antes iba en
  // el medio). Sin meta, no hay nada que proporcionar, no se dibuja barra.
  let barraHtml = "";
  if (tieneMeta) {
    const minutosEstudiados = calcularMinutosEstudiadosEstaSemana(mm.id);
    const metaMinutos = meta * 60;
    const completada = metaMinutos > 0 && minutosEstudiados >= metaMinutos;
    const porcentaje = metaMinutos > 0 ? Math.min(100, (minutosEstudiados / metaMinutos) * 100) : minutosEstudiados > 0 ? 100 : 0;
    barraHtml = `
      <div class="te-barra-progreso">
        <div class="te-barra-progreso-fill ${completada ? "te-completada" : ""}" style="width:${porcentaje}%; background:${color};"></div>
      </div>
    `;
  }

  tarjeta.innerHTML = `
    <div class="materia-linea1">
      <span class="materia-codigo${item.esIndependiente ? "" : " te-codigo-clickeable"}">${item.esIndependiente ? "Propia" : materia.codigo}</span>
      <span class="materia-nombre truncada">${nombreMateriaCorto}</span>
    </div>
    <div class="te-tarjeta-materia-linea2">
      <span class="te-tarjeta-materia-tiempo">${textoTiempo}</span>
    </div>
    ${barraHtml}
  `;

  // El código, como en Plan de Estudios, abre "Buscar materia en..." en vez
  // de mandar al detalle (que es lo que hace el resto de la tarjeta) — sin
  // esto, el click se colaba al listener de la tarjeta entera de arriba.
  if (!item.esIndependiente) tarjeta.querySelector(".te-codigo-clickeable").addEventListener("click", (e) => {
    e.stopPropagation();
    abrirBuscarMateriaEn({ mm, materia, plan, semestre, nombreMateria, origen: "tiempo-estudio" });
  });

  const filaBotones = document.createElement("div");
  filaBotones.className = "te-tarjeta-materia-botones";

  const btnConfig = document.createElement("button");
  btnConfig.type = "button";
  btnConfig.className = "te-btn-icono te-btn-icono-fantasma te-btn-icono-grande";
  btnConfig.title = "Configurar";
  btnConfig.setAttribute("aria-label", "Configurar");
  btnConfig.textContent = "⚙️";
  btnConfig.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalConfigTiempoEstudio(mm, nombreMateria, () => renderizarTiempoEstudio());
  });

  const activo = obtenerTimerActivo();
  const esEstaActiva = Boolean(activo && activo.materiaMatriculadaId === mm.id);

  filaBotones.appendChild(btnConfig);

  if (esEstaActiva) {
    // Activa: botón play/pause (pausa sin cerrar la sesión) + botón
    // aparte para detener (cierra y guarda). Pedido 2026-09-07 — antes
    // había un solo botón que hacía de las dos cosas a la vez.
    const pausado = Boolean(activo.pausado);
    const btnPausa = document.createElement("button");
    btnPausa.type = "button";
    btnPausa.className = "te-btn-icono te-btn-icono-iniciar";
    btnPausa.title = pausado ? "Reanudar" : "Pausar";
    btnPausa.setAttribute("aria-label", pausado ? "Reanudar" : "Pausar");
    btnPausa.textContent = pausado ? "▶" : "⏸";
    btnPausa.addEventListener("click", (e) => {
      e.stopPropagation();
      if (pausado) reanudarTimerEstudio();
      else pausarTimerEstudio();
      renderizarTiempoEstudio();
    });

    const btnDetener = document.createElement("button");
    btnDetener.type = "button";
    btnDetener.className = "te-btn-icono te-btn-icono-detener";
    btnDetener.title = "Detener";
    btnDetener.setAttribute("aria-label", "Detener");
    btnDetener.textContent = "⏹";
    btnDetener.addEventListener("click", (e) => {
      e.stopPropagation();
      manejarBotonIniciarDetener(mm.id, nombreMateria);
    });

    filaBotones.appendChild(btnPausa);
    filaBotones.appendChild(btnDetener);
  } else {
    const btnInicio = document.createElement("button");
    btnInicio.type = "button";
    btnInicio.className = "te-btn-icono te-btn-icono-iniciar";
    btnInicio.title = "Iniciar";
    btnInicio.setAttribute("aria-label", "Iniciar");
    btnInicio.textContent = "▶";
    btnInicio.addEventListener("click", (e) => {
      e.stopPropagation();
      manejarBotonIniciarDetener(mm.id, nombreMateria);
    });
    filaBotones.appendChild(btnInicio);
  }

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

  // Racha de estudio (2026-09-19): chip 🔥 + número pegado a la derecha del
  // título. Van en su propio grupo por la misma razón que los botones de la
  // derecha (row-between reparte el espacio entre TODOS sus hijos). A la
  // izquierda quedan los estados, a la derecha las acciones (＋ y ⚙️).
  const grupoTitulo = document.createElement("div");
  grupoTitulo.className = "te-encabezado-titulo-grupo";

  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.style.margin = "0";
  titulo.textContent = "Tiempo";
  grupoTitulo.appendChild(titulo);
  grupoTitulo.appendChild(construirChipRacha());
  encabezado.appendChild(grupoTitulo);

  // Grupo de botones a la derecha. Van en su propio contenedor (y no
  // sueltos como hijos directos del row-between) porque row-between reparte
  // el espacio entre TODOS sus hijos por igual — con 3 hijos sueltos (título,
  // ⚙️, +) el + quedaba flotando a mitad de camino en vez de pegado al
  // engranaje. Agrupándolos, row-between solo reparte título vs grupo.
  // align-items:center + align-self:center en cada botón (abajo) los
  // centra verticalmente respecto a la tarjeta del encabezado, sin importar
  // la altura real del título al lado.
  const grupoBotones = document.createElement("div");
  grupoBotones.style.cssText = "display:flex; align-items:center; gap:8px;";

  // El pill Todo/Activos se mudó adentro del modal de Ajustes (pedido) —
  // orden: engranaje primero, + después (pedido).
  const btnAjustes = document.createElement("button");
  btnAjustes.type = "button";
  btnAjustes.className = "te-btn-icono te-btn-icono-fantasma te-btn-icono-grande";
  btnAjustes.style.alignSelf = "center";
  btnAjustes.title = "Ajustes de Tiempo";
  btnAjustes.setAttribute("aria-label", "Ajustes de Tiempo");
  btnAjustes.textContent = "⚙️";
  btnAjustes.addEventListener("click", () => abrirModalAjustesTiempoEstudio());
  grupoBotones.appendChild(btnAjustes);

  // Parte 3: acceso al registro manual, ahora a la derecha del engranaje.
  // Vive acá (nivel superior) y no adentro de una materia puntual porque
  // el propio formulario ya elige la materia — un solo punto de entrada
  // sin importar en qué pill (Materias/Estadísticas) estés parado.
  // Mismo estilo relleno que el botón de play de las tarjetas
  // (te-btn-icono-iniciar) para que combinen, en vez del fantasma que usa
  // el engranaje — así no se pierde visualmente en el encabezado.
  const btnRegistroManual = document.createElement("button");
  btnRegistroManual.type = "button";
  btnRegistroManual.className = "te-btn-icono te-btn-icono-iniciar te-btn-icono-grande";
  btnRegistroManual.style.alignSelf = "center";
  btnRegistroManual.title = "Registrar sesión pasada";
  btnRegistroManual.setAttribute("aria-label", "Registrar sesión pasada");
  btnRegistroManual.textContent = "＋";
  btnRegistroManual.addEventListener("click", () => {
    abrirModalRegistroManual(obtenerMateriasParaTiempoEstudio(), () => renderizarTiempoEstudio());
  });
  grupoBotones.appendChild(btnRegistroManual);

  encabezado.appendChild(grupoBotones);
  cont.appendChild(encabezado);
}

function abrirModalNuevaMateriaIndependiente() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,.55); display:flex; align-items:center; justify-content:center; padding:16px;";
  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:420px; width:100%; gap:14px;";
  caja.innerHTML = `
    <h2 style="margin:0">Agregar materia propia</h2>
    <p class="muted" style="margin:0">Esta entrada existe solo en Tiempo y no se vincula a Plan de Estudios ni a Semestres.</p>
    <label class="stack" style="gap:6px"><span class="form-label">Nombre</span><input id="te-materia-propia-nombre" class="form-input" maxlength="80" placeholder="Ej. Tesis o Italiano"></label>
    <div class="row-between" style="gap:10px"><button type="button" class="btn btn-secondary" data-accion="cancelar" style="flex:1">Cancelar</button><button type="button" class="btn btn-primary" data-accion="crear" style="flex:1">Crear</button></div>`;
  caja.addEventListener("click", (evento) => evento.stopPropagation());
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
  const input = caja.querySelector("#te-materia-propia-nombre");
  const cerrar = () => overlay.remove();
  caja.querySelector('[data-accion="cancelar"]').addEventListener("click", cerrar);
  caja.querySelector('[data-accion="crear"]').addEventListener("click", () => {
    const nombre = input.value.trim();
    if (!nombre) {
      input.focus();
      mostrarToast("Escribí un nombre para la materia");
      return;
    }
    const materia = crearMateriaEstudioIndependiente(nombre);
    estado.datos.tiempo_estudio_materias.push(materia);
    sellarTimestamp(materia);
    marcarCambioPendiente();
    // La materia nueva empieza sin meta, por lo que no aparece en el filtro
    // "Activas". Pasar a "Todo" permite verla de inmediato para configurarla.
    if (obtenerFiltroVista() === "activos") guardarFiltroVista("todo");
    cerrar();
    mostrarToast("Materia propia agregada");
    renderizarTiempoEstudio();
  });
  input.focus();
}

/**
 * Pill Materias/Estadísticas (Parte 3) — vive SIEMPRE arriba del contenido
 * de nivel superior (nunca dentro del detalle de una materia puntual, ver
 * renderizarTiempoEstudio). "Materias" es la vista de tarjetas que ya
 * existía; "Estadísticas" es la vista nueva de tiempo-estudio-estadisticas.js.
 */
function construirPillVistaSeccion(cont) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "width:100%;";
  grupo.innerHTML = `
    <button type="button" class="pill-item ${vistaSeccionTE === "materias" ? "active" : ""}" data-vista="materias">Materias</button>
    <button type="button" class="pill-item ${vistaSeccionTE === "estadisticas" ? "active" : ""}" data-vista="estadisticas">Estadísticas</button>
    <button type="button" class="pill-item ${vistaSeccionTE === "competencias" ? "active" : ""}" data-vista="competencias">Competencias</button>
  `;
  grupo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (vistaSeccionTE === btn.dataset.vista) return;
      vistaSeccionTE = btn.dataset.vista;
      renderizarTiempoEstudio();
    });
  });
  cont.appendChild(grupo);
}

/**
 * Pantalla de Ajustes de Tiempo de Estudio (Entrega 4) — modal, mismo
 * patrón que el resto de modales de la app. Tiene 3 cosas:
 * 1) Filtro Todo/Activos (se mudó acá adentro desde el encabezado).
 * 2) Editar el Pomodoro predeterminado global (Entrega 2).
 * 3) Switch "Mostrar tiempos de estudio en Agenda" (Entrega 5).
 */
function abrirModalAjustesTiempoEstudio() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:440px; width:100%; max-height:85vh; overflow-y:auto; gap:16px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const mostrarEnAgenda = estado.datos.configuracion.mostrar_tiempo_estudio_en_agenda === true;
  const filtroActual = obtenerFiltroVista();

  caja.innerHTML = `
    <h2 style="margin:0;">Ajustes de Tiempo</h2>

    <div class="stack" style="gap:6px;">
      <span class="form-label" style="margin:0;">Mostrar</span>
      <div class="pill-group" id="te-ajustes-filtro-pills" style="width:100%;">
        <button type="button" class="pill-item ${filtroActual === "todo" ? "active" : ""}" data-filtro="todo">Todo</button>
        <button type="button" class="pill-item ${filtroActual === "activos" ? "active" : ""}" data-filtro="activos">Activos</button>
      </div>
    </div>

    <button type="button" class="btn btn-secondary" id="te-ajustes-pomodoro" style="width:100%;">
      Ajustar pomodoro predeterminado
    </button>

    <div class="row-between" style="align-items:center;">
      <span class="form-label" style="margin:0;">¿Mostrar tiempos de estudio en Agenda?</span>
      <label class="switch switch-tema">
        <input type="checkbox" id="te-ajustes-mostrar-agenda" ${mostrarEnAgenda ? "checked" : ""}>
        <span class="track"><span class="thumb"></span></span>
      </label>
    </div>

    <button type="button" class="btn btn-primary" id="te-ajustes-cerrar" style="width:100%;">Listo</button>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  // Pedido 2.2 (2026-09-17): en la sección Tiempo, tocar el fondo NO
  // cierra ningún modal — solo el botón explícito ("Listo" acá).
  function cerrar() {
    overlay.remove();
  }
  caja.querySelector("#te-ajustes-cerrar").addEventListener("click", cerrar);

  // El cambio de filtro re-renderiza la lista de atrás (el modal es un
  // overlay aparte en <body>, no vive dentro de #seccion-tiempo-estudio,
  // así que re-renderizarla no lo toca ni lo cierra).
  caja.querySelectorAll("#te-ajustes-filtro-pills .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      guardarFiltroVista(btn.dataset.filtro);
      caja.querySelectorAll("#te-ajustes-filtro-pills .pill-item").forEach((b) => b.classList.toggle("active", b === btn));
      renderizarTiempoEstudio();
    });
  });

  caja.querySelector("#te-ajustes-pomodoro").addEventListener("click", () => {
    abrirModalPomodoroPredeterminado();
  });

  caja.querySelector("#te-ajustes-mostrar-agenda").addEventListener("change", (e) => {
    estado.datos.configuracion.mostrar_tiempo_estudio_en_agenda = e.target.checked;
    marcarCambioPendiente();
  });
}

function construirVistaPrincipal(cont) {
  let items = obtenerMateriasParaTiempoEstudio();
  const hayMaterias = items.length > 0;
  if (obtenerFiltroVista() === "activos") {
    items = items.filter((item) => item.mm.tiempo_estudio.meta_horas_semana !== null && item.mm.tiempo_estudio.meta_horas_semana !== undefined);
  }

  if (items.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = hayMaterias
      ? "Ninguna materia tiene una meta configurada todavía."
      : "No hay materias matriculadas en semestres actuales. Puedes crear una materia propia abajo.";
    cont.appendChild(vacio);
  } else {
    const lista = document.createElement("div");
    lista.className = "stack";
    lista.style.gap = "12px";
    items.forEach((item) => lista.appendChild(construirTarjetaMateria(item)));
    cont.appendChild(lista);
  }

  const acciones = document.createElement("div");
  acciones.className = "te-pestanas-finales-materias";

  const filtroActual = obtenerFiltroVista();
  const btnFiltro = document.createElement("button");
  btnFiltro.type = "button";
  btnFiltro.className = "te-pestana-final-materias";
  btnFiltro.textContent = filtroActual === "activos" ? "Mostrar más materias" : "Mostrar solo activas";
  btnFiltro.setAttribute("aria-label", btnFiltro.textContent);
  btnFiltro.addEventListener("click", () => {
    guardarFiltroVista(filtroActual === "activos" ? "todo" : "activos");
    renderizarTiempoEstudio();
  });

  const btnNueva = document.createElement("button");
  btnNueva.type = "button";
  btnNueva.className = "te-pestana-final-materias";
  btnNueva.textContent = "Nueva Materia";
  btnNueva.addEventListener("click", abrirModalNuevaMateriaIndependiente);

  acciones.append(btnFiltro, btnNueva);
  cont.appendChild(acciones);
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
function construirEncabezadoDetalle(cont, item) {
  const { mm, materia, plan, semestre, nombreMateria } = item;
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

  // D.1 (Parte C ya conectada): tocar el nombre abre "Buscar materia en...".
  const titulo = document.createElement(item.esIndependiente ? "span" : "button");
  titulo.type = "button";
  titulo.className = "te-encabezado-detalle-nombre";
  titulo.style.cssText =
    "margin:0; flex:1; text-align:center; background:none; border:none; cursor:pointer; " +
    "color:var(--text-primary); font-weight:700; font-size:1.05rem; padding:6px;";
  titulo.textContent = nombreMateria;
  if (!item.esIndependiente) titulo.addEventListener("click", () => {
    abrirBuscarMateriaEn({ mm, materia, plan, semestre, nombreMateria, origen: "tiempo-estudio" });
  });

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

/**
 * Timer circular (rediseño, SOLO en esta pantalla de detalle — la lista de
 * materias en construirTarjetaMateria sigue con su barra lineal chica, no
 * cambia). Reemplaza el cronómetro-en-texto-plano + la barra lineal de meta
 * semanal que vivían acá como dos piezas sueltas: ahora es un solo anillo
 * SVG dentro de la misma tarjeta (`.glass-card`, mismo lenguaje visual de
 * siempre) — el arco de color es cuánto de la meta semanal ya está
 * estudiado, y el centro del anillo sigue mostrando el cronómetro de la
 * fase en vivo, igual que antes. CSS inyectado una sola vez (guard por id),
 * mismo criterio que ya usa el proyecto para piezas autosuficientes (ver
 * asegurarEstilosEstudioHoyAgenda en agenda.js) — usa color-mix() contra
 * `--bg-panel` con el color de la materia (misma técnica, variables reales
 * del proyecto: --text-primary, --text-muted, --bg-panel, --font-display).
 */
function asegurarEstilosTimerCircularDetalle() {
  if (document.getElementById("estilos-te-timer-circular")) return;
  const style = document.createElement("style");
  style.id = "estilos-te-timer-circular";
  style.textContent = `
    .te-panel-timer-circular { padding: 20px 16px; container-type: inline-size; container-name: te-timer15; }
    /* Fila principal: stats | anillo | botones. Ancho ancho = las 3 columnas
       una al lado de otra; container-query decide cuándo ya no entran (ver
       abajo), NO el ancho de pantalla, para que se comporte igual sin
       importar dónde viva esta tarjeta dentro del layout general. Todo
       centrado con justify-content: center (nunca space-between, que
       empuja anillo/botones a los extremos cuando quedan solo esos dos). */
    .te-timer-layout {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: center;
      gap: 20px;
      width: 100%;
    }
    .te-timer-col-stats {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 140px;
      flex-shrink: 0;
      order: 1;
    }
    .te-timer-stat {
      background: color-mix(in srgb, var(--bg-panel) 92%, var(--text-primary));
      border: 1px solid color-mix(in srgb, var(--text-primary) 8%, transparent);
      border-radius: 12px;
      padding: 8px 12px;
      text-align: center;
    }
    .te-timer-stat .te-timer-stat-n {
      display: block;
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 0.92rem;
      color: var(--text-primary);
    }
    .te-timer-stat.te-completada .te-timer-stat-n {
      color: color-mix(in srgb, var(--te-color-materia, var(--text-primary)) 65%, #22c55e 35%);
    }
    .te-timer-stat .te-timer-stat-l {
      display: block;
      font-size: 0.66rem;
      color: var(--text-muted);
      margin-top: 2px;
    }
    .te-timer-sin-meta { margin: 0; font-size: 0.85rem; color: var(--text-muted); text-align: center; }
    .te-timer-col-botones {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      width: 150px;
      flex-shrink: 0;
      order: 3;
      justify-content: center;
    }
    .te-timer-col-botones .btn { min-width: 0; width: 100%; }
    .te-timer-col-reloj {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 312px;
      max-width: 100%;
      flex: 0 1 312px;
      order: 2;
    }
    .te-bloques-progreso {
      display: flex;
      justify-content: center;
      gap: 7px;
      width: min(100%, 360px);
      min-height: 8px;
      margin: 0 auto;
    }
    .te-bloques-progreso[hidden] { display: none; }
    .te-bloque-indicador {
      flex: 1 1 0;
      max-width: 110px;
      height: 7px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--text-primary) 7%, transparent);
      transition: background 0.25s ease, opacity 0.25s ease;
    }
    .te-bloque-indicador::after {
      content: "";
      display: block;
      width: var(--te-bloque-avance, 0%);
      height: 100%;
      border-radius: inherit;
      background: var(--te-color-materia, var(--accent-1));
      transition: width 0.35s ease;
    }
    .te-bloque-indicador--actual {
      background: color-mix(in srgb, var(--te-color-materia, var(--text-primary)) 30%, var(--bg-panel));
    }
    .te-bloque-indicador--completado {
      background: var(--te-color-materia, var(--accent-1));
    }
    /* Ancho medio ("tablet"): anillo + botones se quedan arriba uno al lado
       del otro (más chicos), y las 3 tarjetas de stats bajan como una fila
       completa debajo — siguen en horizontal mientras el número y la
       etiqueta de cada una entren en un solo renglón. */
    @container te-timer15 (max-width: 640px) {
      .te-timer-col-reloj { order: 1; }
      .te-timer-col-botones { order: 2; flex-direction: row; flex-wrap: wrap; width: auto; justify-content: center; }
      .te-timer-col-botones .btn { width: auto; min-width: 120px; }
      .te-timer-col-stats { order: 3; flex-basis: 100%; width: 100%; flex-direction: row; justify-content: center; }
      .te-timer-col-stats .te-timer-stat { white-space: nowrap; }
    }
    /* Angosto ("celular"): a esta altura una fila de 3 tarjetas ya cortaría
       el texto en 2 renglones — en vez de eso se apilan completas, una
       debajo de otra, ancho completo. */
    @container te-timer15 (max-width: 420px) {
      .te-timer-col-stats { flex-direction: column; }
      .te-timer-col-stats .te-timer-stat { white-space: normal; }
      .te-timer-col-botones { flex-direction: column; width: min(100%, 250px); }
      .te-timer-col-botones .btn { width: 100%; min-width: 0; min-height: 44px; }
    }
    .te-timer-circular-wrap {
      position: relative;
      width: 100%;
      aspect-ratio: 1;
      margin: 0;
    }
    .te-timer-circular-svg {
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
      display: block;
    }
    .te-timer-circular-track {
      fill: none;
      stroke: color-mix(in srgb, var(--te-color-materia, var(--text-muted)) 16%, var(--bg-panel));
      stroke-width: 14;
    }
    .te-timer-circular-progress {
      fill: none;
      stroke: var(--te-color-materia, var(--text-primary));
      stroke-width: 14;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.6s ease, stroke 0.3s ease;
    }
    .te-timer-circular-progress--completa {
      stroke: color-mix(in srgb, var(--te-color-materia, var(--text-primary)) 65%, #22c55e 35%);
    }
    /* Vuelta extra: una vez la meta semanal está cumplida, el anillo base
       queda lleno (arriba) y esta segunda vuelta, más fina y en un color
       distinto (ámbar), se dibuja encima arrancando del mismo punto de las
       12 — su longitud es el excedente (módulo de la meta, para que si se
       excede varias veces la meta vuelva a dar la vuelta en vez de crecer
       sin límite) y la punta redondeada es justo lo que se nota distinto. */
    .te-timer-circular-progress-extra {
      fill: none;
      stroke: color-mix(in srgb, var(--te-color-materia, var(--text-primary)) 30%, #f59e0b 70%);
      stroke-width: 7;
      stroke-linecap: round;
      opacity: 0;
      transition: stroke-dashoffset 0.6s ease, opacity 0.3s ease;
    }
    .te-timer-circular-progress-extra--visible {
      opacity: 1;
    }
    .te-timer-circular-centro {
      position: absolute;
      inset: 0;
      pointer-events: none;
    }
    .te-timer-circular-centro .te-timer-display {
      position: absolute;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      font-family: var(--font-display);
      font-weight: 700;
      font-size: 2.1rem;
      line-height: 1.15;
      color: var(--text-primary);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .te-timer-extra {
      display: block;
      min-height: 1.5rem;
      margin-top: 5px;
      padding: 0;
      border: 0;
      border-radius: 0;
      background: none;
      text-align: center;
      font-variant-numeric: tabular-nums;
      opacity: 1;
      transform: none;
      transition: none;
    }
    .te-timer-extra[hidden] { display: none; }
    .te-timer-circular-centro .te-timer-extra-valor {
      font-weight: 700;
      font-family: var(--font-display);
      color: var(--te-color-materia, var(--text-primary));
    }
  `;
  document.head.appendChild(style);
}

function construirPantallaDetalle(cont, item) {
  const { mm, materia, plan, nombreMateria } = item;
  const color = obtenerColorMateria(mm, materia, plan);

  construirEncabezadoDetalle(cont, item);
  asegurarEstilosTimerCircularDetalle();

  const meta = mm.tiempo_estudio.meta_horas_semana;

  const panelTimer = document.createElement("div");
  panelTimer.className = "glass-card stack te-panel-timer-circular";
  panelTimer.style.cssText = `align-items:center; gap:14px; text-align:center; --te-color-materia:${color};`;

  // Avance por bloque: indicadores discretos que sustituyen el renglón
  // textual de fase. Cada marca se completa al terminar el bloque.
  const bloquesProgreso = document.createElement("div");
  bloquesProgreso.className = "te-bloques-progreso";
  bloquesProgreso.hidden = true;
  bloquesProgreso.setAttribute("role", "img");
  panelTimer.appendChild(bloquesProgreso);
  let cantidadIndicadores = 0;
  function pintarBloques(activo, tf) {
    const esPomodoro = Boolean(activo && activo.materiaMatriculadaId === mm.id && activo.pomodoro);
    bloquesProgreso.hidden = !esPomodoro;
    if (!esPomodoro) return;
    const pomodoro = activo.pomodoro;
    const cantidad = Math.max(1, Number(pomodoro.config.cantidad_bloques) || 1);
    if (cantidadIndicadores !== cantidad) {
      bloquesProgreso.replaceChildren();
      for (let i = 0; i < cantidad; i += 1) {
        const marca = document.createElement("span");
        marca.className = "te-bloque-indicador";
        marca.setAttribute("aria-hidden", "true");
        bloquesProgreso.appendChild(marca);
      }
      cantidadIndicadores = cantidad;
    }
    const trabajoCumplido = pomodoro.fase === "trabajo" && tf && tf.completa;
    const cantidadCompletada = pomodoro.fase === "trabajo" && !trabajoCumplido ? pomodoro.bloqueActual - 1 : pomodoro.bloqueActual;
    [...bloquesProgreso.children].forEach((marca, i) => {
      marca.classList.toggle("te-bloque-indicador--completado", i < cantidadCompletada);
      marca.classList.toggle("te-bloque-indicador--actual", i === pomodoro.bloqueActual - 1 && pomodoro.fase === "trabajo");
      const porcentajeActual = i === pomodoro.bloqueActual - 1 && pomodoro.fase === "trabajo" && tf && tf.duracion > 0
        ? Math.min(100, (tf.transcurridos / tf.duracion) * 100)
        : i < cantidadCompletada ? 100 : 0;
      marca.style.setProperty("--te-bloque-avance", `${porcentajeActual}%`);
    });
    bloquesProgreso.setAttribute("aria-label", `Pomodoro: ${cantidadCompletada}/${cantidad}; ${pomodoro.bloqueActual}/${cantidad}`);
  }

  // Anillo (radio/circunferencia fijos, calza con el viewBox 0 0 200 200
  // de abajo) — un solo elemento visual hace las dos cosas que antes eran
  // dos piezas sueltas: el arco de color es la meta semanal (cuánto se ha
  // estudiado / cuánto falta, ver pintarProgreso), el centro es el
  // cronómetro de la fase en vivo (ver pintar).
  const RADIO_ANILLO = 80;
  const CIRCUNFERENCIA_ANILLO = 2 * Math.PI * RADIO_ANILLO;

  // Layout: columna de stats | anillo | columna de botones — los 3 al
  // mismo nivel, centrados como una sola fila (ver container queries de
  // asegurarEstilosTimerCircularDetalle para cómo se reacomodan cuando no
  // entran los 3 de corrido).
  const layout = document.createElement("div");
  layout.className = "te-timer-layout";
  panelTimer.appendChild(layout);

  // Columna de stats (reemplaza el chip único de antes) — 3 tarjetas
  // chicas, siempre en el mismo orden: Estudiado, Faltan, Meta.
  const colStats = document.createElement("div");
  colStats.className = "te-timer-col-stats";
  function crearStat(etiqueta) {
    const stat = document.createElement("div");
    stat.className = "te-timer-stat";
    const n = document.createElement("span");
    n.className = "te-timer-stat-n";
    const l = document.createElement("span");
    l.className = "te-timer-stat-l";
    l.textContent = etiqueta;
    stat.append(n, l);
    colStats.appendChild(stat);
    return { stat, n };
  }
  const statEstudiado = crearStat("Estudiado");
  const statFaltan = crearStat("Faltan");
  const statMeta = crearStat("Meta");
  layout.appendChild(colStats);

  // Mensaje cuando no hay meta configurada — ocupa el lugar de colStats
  // (mismo order:1, mismo flex-basis en las 2 container queries de abajo)
  // en vez de dejar 3 tarjetas vacías sin sentido.
  const sinMetaMsg = document.createElement("p");
  sinMetaMsg.className = "te-timer-sin-meta";
  sinMetaMsg.style.order = "1";
  sinMetaMsg.style.flexBasis = "100%";
  sinMetaMsg.textContent = "Sin meta configurada esta semana.";
  layout.appendChild(sinMetaMsg);

  const anilloWrap = document.createElement("div");
  anilloWrap.className = "te-timer-circular-wrap";
  anilloWrap.innerHTML = `
    <svg class="te-timer-circular-svg" viewBox="0 0 200 200" aria-hidden="true">
      <circle class="te-timer-circular-track" cx="100" cy="100" r="${RADIO_ANILLO}"></circle>
      <circle class="te-timer-circular-progress" cx="100" cy="100" r="${RADIO_ANILLO}"
        stroke-dasharray="${CIRCUNFERENCIA_ANILLO}" stroke-dashoffset="${CIRCUNFERENCIA_ANILLO}"></circle>
      <circle class="te-timer-circular-progress-extra" cx="100" cy="100" r="${RADIO_ANILLO}"
        stroke-dasharray="${CIRCUNFERENCIA_ANILLO}" stroke-dashoffset="${CIRCUNFERENCIA_ANILLO}"></circle>
    </svg>
  `;
  const circuloProgreso = anilloWrap.querySelector(".te-timer-circular-progress");
  const circuloExtra = anilloWrap.querySelector(".te-timer-circular-progress-extra");

  const centro = document.createElement("div");
  centro.className = "te-timer-circular-centro";
  anilloWrap.appendChild(centro);

  const display = document.createElement("span");
  display.className = "te-timer-display";
  centro.appendChild(display);

  // El tiempo extra se presenta como un valor breve debajo de la rueda,
  // sin añadir otro anillo ni superponer información al cronómetro.
  const extra = document.createElement("div");
  extra.className = "te-timer-extra";
  extra.hidden = true;
  const extraValor = document.createElement("span");
  extraValor.className = "te-timer-extra-valor";
  extra.appendChild(extraValor);
  const colReloj = document.createElement("div");
  colReloj.className = "te-timer-col-reloj";
  colReloj.append(anilloWrap, extra);
  layout.appendChild(colReloj);

  // Columna de botones — mismos 5 botones de siempre, ahora en su propia
  // columna (se acomoda sola en fila cuando el layout pasa a modo tablet,
  // ver container query).
  const colBtns = document.createElement("div");
  colBtns.className = "te-timer-col-botones";
  layout.appendChild(colBtns);

  const btnIniciar = document.createElement("button");
  btnIniciar.type = "button";
  btnIniciar.className = "btn btn-primary";
  btnIniciar.textContent = "Iniciar";
  btnIniciar.addEventListener("click", () => manejarBotonIniciarDetener(mm.id, nombreMateria));

  const btnPausa = document.createElement("button");
  btnPausa.type = "button";
  btnPausa.className = "btn btn-secondary";
  btnPausa.addEventListener("click", () => {
    const activo = obtenerTimerActivo();
    if (!activo || activo.materiaMatriculadaId !== mm.id) return;
    if (activo.pausado) reanudarTimerEstudio();
    else pausarTimerEstudio();
  });

  // Pedido 2026-09-19: el bloque de trabajo ya NO pasa solo a descanso.
  // Cuando cumple su tiempo sigue corriendo como tiempo extra y este botón
  // (solo visible entonces, ver pintar() más abajo) es lo único que
  // guarda la sesión completa y arranca el descanso.
  const btnDescanso = document.createElement("button");
  btnDescanso.type = "button";
  btnDescanso.className = "btn btn-primary";
  btnDescanso.addEventListener("click", () => {
    const activo = obtenerTimerActivo();
    if (!activo || activo.materiaMatriculadaId !== mm.id) return;
    iniciarDescansoPomodoro();
    renderizarTiempoEstudio();
  });

  // Punto 1.4 (2026-09-17): "Saltar descanso" — solo visible mientras el
  // timer de ESTA materia está en una fase de descanso de Pomodoro (ver
  // pintar() más abajo). Vuelve de inmediato al bloque de trabajo sin
  // esperar a que se cumpla el tiempo configurado de descanso.
  // 2026-09-19: cuando el descanso ya cumplió su tiempo (y sigue corriendo
  // como extra) el mismo botón pasa a decir "Terminar descanso": es la
  // única forma de salir de él, el descanso no termina solo.
  const btnSaltarDescanso = document.createElement("button");
  btnSaltarDescanso.type = "button";
  btnSaltarDescanso.className = "btn btn-secondary";
  btnSaltarDescanso.textContent = "⏭ Saltar descanso";
  btnSaltarDescanso.addEventListener("click", () => {
    const activo = obtenerTimerActivo();
    if (!activo || activo.materiaMatriculadaId !== mm.id) return;
    saltarDescansoPomodoro();
    renderizarTiempoEstudio();
  });

  const btnDetener = document.createElement("button");
  btnDetener.type = "button";
  btnDetener.className = "btn btn-danger";
  btnDetener.textContent = "Detener";
  btnDetener.addEventListener("click", () => manejarBotonIniciarDetener(mm.id, nombreMateria));

  colBtns.appendChild(btnIniciar);
  colBtns.appendChild(btnPausa);
  colBtns.appendChild(btnDescanso);
  colBtns.appendChild(btnSaltarDescanso);
  colBtns.appendChild(btnDetener);

  cont.appendChild(panelTimer);

  // Pinta el anillo + el chip de meta semanal — se repinta en cada tick vía
  // pintarProgreso() (mismo motivo de siempre: punto 3, excedente en vivo
  // mientras el timer sigue corriendo, no solo al detenerlo). Sin meta
  // configurada, el anillo se queda en su pista vacía (0%, sin arco de
  // color) y el chip lo dice en texto — no hay nada que "llenar" todavía.
  function pintarProgreso(activo) {
    if (meta === null || meta === undefined) {
      circuloProgreso.style.strokeDashoffset = String(CIRCUNFERENCIA_ANILLO);
      circuloProgreso.classList.remove("te-timer-circular-progress--completa");
      circuloExtra.classList.remove("te-timer-circular-progress-extra--visible");
      colStats.style.display = "none";
      sinMetaMsg.style.display = "";
      return;
    }
    colStats.style.display = "";
    sinMetaMsg.style.display = "none";

    const esEstaMateria = Boolean(activo && activo.materiaMatriculadaId === mm.id);
    const minutosGuardados = calcularMinutosEstudiadosEstaSemana(mm.id);
    // Mientras el timer de ESTA materia está corriendo, se suma el tramo en
    // vivo (todavía no guardado como sesión) — timer simple: toda la
    // sesión; Pomodoro: solo si está en fase de trabajo (los descansos no
    // suman, punto 1). Sin esto el excedente en vivo del punto 3 no se
    // vería hasta detener el timer y volver a entrar al detalle.
    let minutosEnVivo = 0;
    if (esEstaMateria) {
      if (activo.origen === "timer") {
        minutosEnVivo = (Date.now() - activo.sesionInicio) / 60000;
      } else if (activo.pomodoro && activo.pomodoro.fase === "trabajo") {
        minutosEnVivo = (Date.now() - activo.inicioFase) / 60000;
      }
    }
    const minutosEstudiados = minutosGuardados + minutosEnVivo;

    const metaMinutos = meta * 60;
    const completada = metaMinutos > 0 && minutosEstudiados >= metaMinutos;
    const porcentaje = metaMinutos > 0 ? Math.min(100, (minutosEstudiados / metaMinutos) * 100) : minutosEstudiados > 0 ? 100 : 0;
    const restanteMin = Math.max(0, metaMinutos - minutosEstudiados);
    const excedenteMin = Math.max(0, minutosEstudiados - metaMinutos);

    circuloProgreso.style.strokeDashoffset = String(CIRCUNFERENCIA_ANILLO - (porcentaje / 100) * CIRCUNFERENCIA_ANILLO);
    circuloProgreso.classList.toggle("te-timer-circular-progress--completa", completada);

    // Vuelta extra: el anillo base ya está lleno (arriba); esta segunda
    // vuelta, más fina y en ámbar, arranca del mismo punto (las 12) y
    // avanza según el excedente — con módulo de la meta, así que si se
    // duplica o triplica la meta la vuelta se reinicia en vez de intentar
    // dibujar más de una circunferencia de largo.
    if (excedenteMin > 0 && metaMinutos > 0) {
      const fraccionExtra = (excedenteMin % metaMinutos) / metaMinutos || 1;
      circuloExtra.style.strokeDashoffset = String(CIRCUNFERENCIA_ANILLO - fraccionExtra * CIRCUNFERENCIA_ANILLO);
      circuloExtra.classList.add("te-timer-circular-progress-extra--visible");
    } else {
      circuloExtra.classList.remove("te-timer-circular-progress-extra--visible");
    }

    // Estudiado y Meta son siempre esos 2 datos; la tercera tarjeta
    // (Faltan) pasa a mostrar el excedente y ponerse en verde apenas se
    // cumple la meta — mismo criterio de color que ya tenía el anillo
    // (--te-color-materia mezclado con verde), ver
    // .te-timer-stat.te-completada en asegurarEstilosTimerCircularDetalle.
    statEstudiado.n.textContent = formatearHorasMin(minutosEstudiados);
    statMeta.n.textContent = formatearHorasMin(metaMinutos);
    statEstudiado.stat.classList.toggle("te-completada", completada);
    if (!completada) {
      statFaltan.stat.classList.remove("te-completada");
      statFaltan.stat.querySelector(".te-timer-stat-l").textContent = "Faltan";
      statFaltan.n.textContent = formatearHorasMin(restanteMin);
    } else {
      statFaltan.stat.classList.add("te-completada");
      statFaltan.stat.querySelector(".te-timer-stat-l").textContent = excedenteMin > 0 ? "🎉 Extra" : "🎉 Meta";
      statFaltan.n.textContent = excedenteMin > 0 ? `+${formatearHorasMin(excedenteMin)}` : "Cumplida";
    }
  }
  pintarProgreso(obtenerTimerActivo());

  function pintar(activo) {
    const esEstaMateria = Boolean(activo && activo.materiaMatriculadaId === mm.id);
    const tf = esEstaMateria ? tiempoDeFase() : null;
    // El principal llega a la duración configurada y se queda ahí; lo que
    // pase de eso va en `extra` (ver tiempoDeFase en el motor).
    display.textContent = esEstaMateria ? formatearDuracion(tf.transcurridos) : "00:00";

    const esPomodoro = Boolean(esEstaMateria && activo.pomodoro);
    const hayExtra = Boolean(esPomodoro && tf.extra > 0);
    extra.hidden = !hayExtra;
    if (hayExtra) extraValor.textContent = `+${formatearDuracion(tf.extra)}`;

    // Iniciar solo se ve si NADIE está corriendo en esta materia;
    // pausa/detener solo se ven si ESTA materia es la que está corriendo.
    btnIniciar.style.display = esEstaMateria ? "none" : "";
    btnPausa.style.display = esEstaMateria ? "" : "none";
    btnDetener.style.display = esEstaMateria ? "" : "none";
    if (esEstaMateria) {
      const pausado = Boolean(activo.pausado);
      btnPausa.textContent = pausado ? "▶ Reanudar" : "⏸ Pausar";
    }
    // "Saltar descanso" solo tiene sentido en una fase de descanso de
    // Pomodoro de esta misma materia — en cualquier otro caso se esconde.
    const enDescanso = Boolean(esEstaMateria && activo.pomodoro && activo.pomodoro.fase !== "trabajo");
    btnSaltarDescanso.style.display = enDescanso ? "" : "none";
    if (enDescanso) {
      btnSaltarDescanso.textContent = tf.completa ? "✔ Terminar descanso" : "⏭ Saltar descanso";
      btnSaltarDescanso.className = tf.completa ? "btn btn-primary" : "btn btn-secondary";
    }

    // "Descanso" solo aparece cuando el bloque de trabajo ya cumplió su
    // tiempo (mientras tanto sigue sumando extra).
    const bloqueCumplido = Boolean(esPomodoro && activo.pomodoro.fase === "trabajo" && tf.completa);
    btnDescanso.style.display = bloqueCumplido ? "" : "none";
    if (bloqueCumplido) {
      btnDescanso.textContent = "☕ Descanso";
    }

    pintarBloques(activo, tf);
    pintarProgreso(activo);
  }
  desuscribirTimerDetalle = suscribirseATimer(pintar);
  // El botón "Configurar meta y Pomodoro" que vivía acá se movió al
  // engranaje del encabezado (D.1) — mismo modal, un solo punto de entrada.

  // Pedido 2026-09-07: gráficas + resumen individual de la materia
  // (resumen de meta como líneas, horas trabajadas como barras del color
  // propio de la materia, y el bloque final de totales/día más
  // productivo/sesiones/promedio), seguido de la lista editable de
  // sesiones de ESTA matrícula puntual (nunca las de otra repetición de
  // la misma materia).
  construirEstadisticasMateria(cont, mm, color, () => renderizarTiempoEstudio());
  construirListaSesiones(cont, mm.id, color, () => renderizarTiempoEstudio());
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

  // Parte 3: encabezado + pill Materias/Estadísticas son comunes a las 2
  // vistas de nivel superior — se arman acá UNA sola vez, y de ahí en más
  // cada vista solo dibuja su contenido propio (ver nota en
  // construirVistaPrincipal/construirVistaEstadisticas).
  construirEncabezado(cont);
  construirPillVistaSeccion(cont);

  if (vistaSeccionTE === "estadisticas") {
    construirVistaEstadisticas(cont, renderizarTiempoEstudio);
  } else if (vistaSeccionTE === "competencias") {
    construirVistaCompetencias(cont, renderizarTiempoEstudio);
  } else {
    construirVistaPrincipal(cont);
  }
}

/**
 * Se llama una sola vez al arrancar la app (mismo criterio que
 * inicializarHorario/inicializarAgenda) — deja el indicador persistente
 * suscrito al motor del timer desde el arranque, para que pueda aparecer
 * en CUALQUIER sección, no solo al entrar a Tiempo de Estudio.
 */
let _hookRepintadoTiempoRegistrado = false;

function inicializarTiempoEstudio() {
  // FIX 2026-09-19 (Parte B, "sesión desaparecida"): `aplicarDatosRemotosFrescos`
  // (storage-sync.js) repinta Semestres, Finanzas, Plan de Estudios, etc.
  // tras CADA fusión remota (sondeo de ~9 s, pull-to-refresh, otra pestaña
  // vía BroadcastChannel, login) — pero nunca repintaba Tiempo. Una sesión
  // guardada en otro dispositivo o pestaña llegaba bien a `estado.datos`
  // (por eso un F5 la mostraba) y el DOM de esta sección se quedaba
  // congelado con los datos viejos: la persona veía "no se guardó", la
  // volvía a cargar a mano y terminaba con dos. Mismo bug ya corregido para
  // Semestres y Finanzas; acá se resuelve por el mecanismo genérico de
  // hooks post-fusión (no hace falta que storage-sync.js importe este
  // archivo). El scroll lo protege el propio lote de aplicarDatosRemotosFrescos.
  if (!_hookRepintadoTiempoRegistrado) {
    _hookRepintadoTiempoRegistrado = true;
    registrarHookPostFusion(() => renderizarTiempoEstudio());
    // Racha: tras cada fusión refresca en silencio su referencia (lo que llega
    // de otro dispositivo nunca celebra) y hace la revisión única "al abrir"
    // del día. Va DESPUÉS del repintado para que el chip ya tenga datos nuevos.
    registrarHookPostFusion(() => alFusionarDatosRacha());
  }

  // Racha de estudio: escucha `te:sesiones-actualizadas` (celebra solo lo
  // escrito en ESTE dispositivo). El respaldo de abajo cubre a quien abre la
  // app sin conexión (sin fusión no hay hook): se espera unos segundos para
  // no revisar con datos viejos antes de que llegue la primera sincronización
  // y es idempotente — si el hook ya hizo la revisión de hoy, no repite nada.
  inicializarRacha();
  setTimeout(() => alFusionarDatosRacha(), 12000);

  // Parte 2 (punto 4, salvavidas): se revisa una sola vez al arrancar, no
  // en cuanto se cumplen las 3 horas — si quedó una sesión sin detener por
  // más de SALVAVIDAS_HORAS_LIMITE, abre el modal para corregir la
  // duración real antes de guardarla. Va ANTES del `if (!badge) return`
  // de abajo porque no depende del badge para nada.
  revisarSesionOlvidadaAlAbrir();

  // Rediseño 2026-09-19: el badge fijo de abajo-izquierda pasó a ser un
  // indicador con 3 presentaciones (columna derecha / flotante / barra
  // superior) — ver tiempo-estudio-indicador.js. Los 3 contenedores están en
  // index.html y el CSS decide cuál se ve según el ancho de pantalla; acá
  // se alimentan los 3 a la vez con el mismo dato.
  const pintarIndicadores = montarIndicadoresTimer({
    elementos: [
      document.getElementById("timer-tarjeta-lateral"),
      document.getElementById("badge-tiempo-estudio"),
      document.getElementById("timer-linea-topbar"),
    ],
    resolverInfo: resolverInfoIndicadorTimer,
    alTocar: irAMateriaDelTimerActivo,
  });
  if (!pintarIndicadores) return;

  suscribirseATimer(pintarIndicadores);
}

/**
 * Lo que muestra el indicador de sesión activa: nombre de la materia SIN
 * código, su color (mismo criterio que Horario/Agenda, ver
 * obtenerColorMateria), el tiempo de la fase en curso (lo mismo que ve la
 * pantalla de detalle) y un estado corto. Si la materia del timer ya no
 * está entre las de los semestres actuales (ej. se cambió el semestre con
 * el timer corriendo) se cae a un texto y color genéricos en vez de romper.
 */
function resolverInfoIndicadorTimer(activo) {
  const item = obtenerMateriasParaTiempoEstudio().find((x) => x.mm.id === activo.materiaMatriculadaId);
  const enDescanso = Boolean(activo.pomodoro && activo.pomodoro.fase !== "trabajo");
  // Pasada la duración configurada el tiempo principal queda clavado (ej.
  // 40:00) y el extra se agrega al lado ("40:00 +05:12"). El `estado` nunca
  // depende de los segundos (la etiqueta accesible del indicador cambia con
  // él), solo del tipo de fase.
  const tf = tiempoDeFase();
  const enExtra = tf.extra > 0;
  return {
    nombre: item ? item.nombreMateriaCorto : "Materia",
    color: item ? obtenerColorMateria(item.mm, item.materia, item.plan) : COLOR_TIEMPO_ESTUDIO_DEFAULT,
    tiempo: formatearDuracion(tf.transcurridos) + (enExtra ? ` +${formatearDuracion(tf.extra)}` : ""),
    pausado: Boolean(activo.pausado),
    estado: activo.pausado ? "En pausa" : enDescanso ? "Descanso" : enExtra ? "Extra" : "",
  };
}

/** Click en cualquiera de las 3 presentaciones: abre el detalle de la materia
 * que se está estudiando (ahí están pausar/reanudar/detener). Si ya se está
 * viendo ese detalle no se repinta, para no perder lo que la persona esté
 * haciendo en esa pantalla. */
function irAMateriaDelTimerActivo() {
  const activo = obtenerTimerActivo();
  if (!activo) return;
  const yaEnEseDetalle = materiaDetalleActivaId === activo.materiaMatriculadaId;
  materiaDetalleActivaId = activo.materiaMatriculadaId;
  mostrarSeccion("tiempo-estudio");
  // Si ya se estaba dentro de Tiempo de Estudio (en otra vista), no hay
  // garantía de que mostrarSeccion repinte: se fuerza acá.
  if (!yaEnEseDetalle) renderizarTiempoEstudio();
}

/**
 * Estudio para hoy — Entrega 3 (2026-09-09): ya NO reparte la meta
 * semanal parejo entre los 7 días. Usa `calcularMetaDiariaMateria()` de
 * tiempo-estudio-estadisticas.js — la MISMA cuenta que ve el usuario en
 * "Resumen de metas" — para que Agenda y Tiempo de Estudio nunca muestren
 * dos números distintos para "cuánto toca hoy" de una misma materia.
 *
 * Además, las materias con `dias_estudio` configurado que NO incluye el
 * día de hoy quedan afuera del todo (antes entraban todas las que tenían
 * meta, sin importar qué día era) — así Agenda, que solo lee esta lista,
 * automáticamente termina mostrando nada más que las materias que
 * corresponde estudiar hoy, sin que agenda.js necesite saber nada de
 * `dias_estudio`.
 *
 * 2026-09-22 (tarjeta con barra de progreso en Agenda): cada item ahora
 * trae `metaMinutosHoy` (antes `minutosHoy`, renombrado para no
 * confundirlo con lo ya hecho), `hechoMinutosHoy` (lo YA estudiado hoy de
 * esa materia) y `color` (mismo criterio que Horario/el indicador de
 * timer) — así Agenda puede armar una barra real de progreso sin volver
 * a calcular nada por su cuenta ni importar `calcularMetaDiariaMateria`
 * directamente.
 */
function obtenerEstudioParaHoy() {
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);

  return obtenerMateriasParaTiempoEstudio()
    .map((item) => {
      const calculo = calcularMetaDiariaMateria(item.mm, 0);
      if (!calculo) return null; // sin meta configurada, nada que repartir
      const msPorDia = 24 * 60 * 60 * 1000;
      const idxHoy = Math.round((hoy.getTime() - calculo.lunes.getTime()) / msPorDia);
      const infoHoy = calculo.infoDias[idxHoy];
      if (!infoHoy || !infoHoy.esDiaEstudio) return null; // hoy no es día de estudio para esta materia
      return {
        materiaMatriculadaId: item.mm.id,
        nombreMateriaCorto: item.nombreMateriaCorto,
        // Meta de reparto real de hoy (como antes, solo que renombrada para
        // no confundirla con lo ya hecho) + lo YA estudiado hoy de esta
        // materia (mismo `calculo`, mismo índice — `trabajadoPorDia` ya
        // contaba TODAS las sesiones del día, incluida la que el timer
        // tenga en curso ahora mismo) + el color efectivo de la materia
        // (mismo criterio que Horario/el indicador: propio > categoría >
        // default). 2026-09-22: antes solo se devolvía la meta pelada —
        // sin lo ya hecho, Agenda no tenía con qué armar una barra de
        // progreso real, solo mostrar el número de meta.
        metaMinutosHoy: Math.round(calculo.metaDiariaPorDia[idxHoy]),
        hechoMinutosHoy: Math.round(calculo.trabajadoPorDia[idxHoy]),
        color: obtenerColorMateria(item.mm, item.materia, item.plan),
      };
    })
    .filter((x) => x !== null);
}

/** Punto de entrada para que OTRAS secciones (Agenda, Entrega 5) puedan
 * llevar directo al detalle de una materia en Tiempo de Estudio, sin
 * conocer nada de materiaDetalleActivaId (variable privada de este
 * archivo) — mismo criterio que el resto de navegación entre secciones. */
function irADetalleMateriaTiempoEstudio(materiaMatriculadaId) {
  materiaDetalleActivaId = materiaMatriculadaId;
  mostrarSeccion("tiempo-estudio");
}

// Ver mostrarSeccion() en main.js: llama a window.renderizarX?.() para
// varias secciones (agenda/horario/resumen/asistente) en vez del import
// directo — se expone igual acá por consistencia con ese patrón ya
// establecido.
window.renderizarTiempoEstudio = renderizarTiempoEstudio;

export { inicializarTiempoEstudio, renderizarTiempoEstudio, obtenerEstudioParaHoy, irADetalleMateriaTiempoEstudio, formatearHorasMin, obtenerMateriasParaTiempoEstudio };
