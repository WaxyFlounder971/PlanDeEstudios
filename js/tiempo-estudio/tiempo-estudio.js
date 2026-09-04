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
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { COLOR_TIEMPO_ESTUDIO_DEFAULT } from "../core/schema.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales } from "../semestres/semestres.js";
import { mostrarSeccion } from "../main.js";
import { abrirModalConfigTiempoEstudio, abrirModalPomodoroPredeterminado } from "./tiempo-estudio-config.js";
import { abrirBuscarMateriaEn } from "../ui/buscar-materia.js";
import {
  cambiarTimerEstudio,
  detenerTimerEstudio,
  formatearDuracion,
  hayTimerActivo,
  iniciarTimerEstudio,
  obtenerTimerActivo,
  revisarSesionOlvidadaAlAbrir,
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
      items.push({ mm, materia, plan, semestre, nombreMateria, nombreMateriaCorto: nombreCorto });
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

  const textoTiempo = tieneMeta
    ? `${formatearHorasMin(calcularMinutosEstudiadosEstaSemana(mm.id))} de ${meta} h`
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
      <span class="materia-codigo te-codigo-clickeable">${materia.codigo}</span>
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
  tarjeta.querySelector(".te-codigo-clickeable").addEventListener("click", (e) => {
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

  // El pill Todo/Activos se mudó adentro del modal de Ajustes (pedido) —
  // acá solo queda el engranaje, mismo tamaño exacto que el de las
  // tarjetas (te-btn-icono-grande, ver design-system.css).
  const btnAjustes = document.createElement("button");
  btnAjustes.type = "button";
  btnAjustes.className = "te-btn-icono te-btn-icono-fantasma te-btn-icono-grande";
  btnAjustes.title = "Ajustes de Tiempo de Estudio";
  btnAjustes.setAttribute("aria-label", "Ajustes de Tiempo de Estudio");
  btnAjustes.textContent = "⚙️";
  btnAjustes.addEventListener("click", () => abrirModalAjustesTiempoEstudio());
  encabezado.appendChild(btnAjustes);

  cont.appendChild(encabezado);
}

/**
 * Pantalla de Ajustes de Tiempo de Estudio (Entrega 4) — modal, mismo
 * patrón que el resto de modales de la app. Tiene 4 cosas:
 * 1) Filtro Todo/Activos (se mudó acá adentro desde el encabezado).
 * 2) Editar el Pomodoro predeterminado global (Entrega 2).
 * 3) Torneos/Competencias — placeholder, la lógica real es un prompt
 *    aparte (Parte 4 del plan original).
 * 4) Switch "Mostrar tiempos de estudio en Agenda" (Entrega 5).
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
    <h2 style="margin:0;">Ajustes de Tiempo de Estudio</h2>

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

    <div class="glass-panel stack" style="padding:12px; gap:4px;">
      <span class="form-label" style="margin:0;">Torneos / Competencias</span>
      <span class="muted" style="font-size:0.82rem;">Próximamente.</span>
    </div>

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

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
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
  const titulo = document.createElement("button");
  titulo.type = "button";
  titulo.className = "te-encabezado-detalle-nombre";
  titulo.style.cssText =
    "margin:0; flex:1; text-align:center; background:none; border:none; cursor:pointer; " +
    "color:var(--text-primary); font-weight:700; font-size:1.05rem; padding:6px;";
  titulo.textContent = nombreMateria;
  titulo.addEventListener("click", () => {
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

function construirPantallaDetalle(cont, item) {
  const { mm, materia, plan, nombreMateria } = item;

  construirEncabezadoDetalle(cont, item);

  const meta = mm.tiempo_estudio.meta_horas_semana;

  const panelTimer = document.createElement("div");
  panelTimer.className = "glass-card stack";
  panelTimer.style.cssText = "align-items:center; gap:16px; text-align:center;";

  // Parte 2: etiqueta de fase de Pomodoro ("Bloque 2 de 4 · Descanso
  // corto") — vacía/invisible salvo que el timer activo de ESTA materia
  // sea de origen "pomodoro". No es un elemento nuevo de diseño, solo un
  // renglón de texto chico (misma clase .muted que ya se usa en el resto
  // del panel) para poder ver en qué fase está sin depender solo de las
  // alertas sonoras/visuales del punto 2.
  const faseLabel = document.createElement("p");
  faseLabel.className = "muted";
  faseLabel.style.cssText = "margin:0; font-size:0.85rem;";
  panelTimer.appendChild(faseLabel);

  const display = document.createElement("div");
  display.className = "te-timer-display";
  panelTimer.appendChild(display);

  const btnAccion = document.createElement("button");
  btnAccion.type = "button";
  btnAccion.style.minWidth = "160px";
  panelTimer.appendChild(btnAccion);

  cont.appendChild(panelTimer);

  // Barra de progreso (rediseño, sin cambios de estructura/clases): se crea
  // una sola vez acá y de ahí en más se repinta su contenido en cada tick
  // vía pintarProgreso() — necesario para el punto 3 (excedente en vivo
  // mientras el timer sigue corriendo, no solo al detenerlo).
  const panelProgreso = document.createElement("div");
  cont.appendChild(panelProgreso);

  function pintarProgreso(activo) {
    if (meta === null || meta === undefined) {
      panelProgreso.className = "";
      panelProgreso.innerHTML = `<p class="te-detalle-meta">Sin meta configurada esta semana.</p>`;
      return;
    }

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

    const texto = !completada
      ? `Faltan ${formatearHorasMin(restanteMin)}`
      : excedenteMin > 0
      ? `🎉 Meta cumplida · excedente +${formatearHorasMin(excedenteMin)}`
      : `🎉 Meta cumplida (${formatearHorasMin(minutosEstudiados)})`;

    panelProgreso.className = "te-detalle-progreso";
    panelProgreso.innerHTML = `
      <div class="te-barra-progreso">
        <div class="te-barra-progreso-fill ${completada ? "te-completada" : ""}" style="width:${porcentaje}%; background:${obtenerColorMateria(mm, materia, plan)};"></div>
      </div>
      <span class="te-detalle-meta">${texto}</span>
    `;
  }
  pintarProgreso(obtenerTimerActivo());

  function pintar(activo) {
    const esEstaMateria = Boolean(activo && activo.materiaMatriculadaId === mm.id);
    display.textContent = esEstaMateria ? formatearDuracion(segundosTranscurridos()) : "00:00";
    btnAccion.textContent = esEstaMateria ? "Detener" : "Iniciar";
    btnAccion.className = "btn " + (esEstaMateria ? "btn-danger" : "btn-primary");

    if (esEstaMateria && activo.pomodoro) {
      const nombreFaseLegible =
        activo.pomodoro.fase === "trabajo" ? "Bloque de trabajo" : activo.pomodoro.fase === "descanso_corto" ? "Descanso corto" : "Descanso largo";
      faseLabel.textContent = `Bloque ${activo.pomodoro.bloqueActual} de ${activo.pomodoro.config.cantidad_bloques} · ${nombreFaseLegible}`;
    } else {
      faseLabel.textContent = "";
    }

    pintarProgreso(activo);
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
  // Parte 2 (punto 4, salvavidas): se revisa una sola vez al arrancar, no
  // en cuanto se cumplen las 3 horas — si quedó una sesión sin detener por
  // más de SALVAVIDAS_HORAS_LIMITE, abre el modal para corregir la
  // duración real antes de guardarla. Va ANTES del `if (!badge) return`
  // de abajo porque no depende del badge para nada.
  revisarSesionOlvidadaAlAbrir();

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

/**
 * Estudio para hoy (Entrega 5, PROVISIONAL): reparte la meta semanal
 * parejo entre los 7 días — un cálculo de paso, hasta que la Entrega 3
 * (elegir qué días se estudia cada materia, como ya hace Horario) permita
 * un reparto real solo entre los días elegidos. Cuando esa entrega esté
 * lista, esta función se actualiza para usarla y Agenda no necesita
 * cambiar nada de su lado (sigue leyendo materiaMatriculadaId/
 * nombreMateriaCorto/minutosHoy igual). Solo entran acá materias CON meta
 * configurada — las demás no tienen nada que repartir.
 */
function obtenerEstudioParaHoy() {
  return obtenerMateriasParaTiempoEstudio()
    .filter((item) => item.mm.tiempo_estudio.meta_horas_semana !== null && item.mm.tiempo_estudio.meta_horas_semana !== undefined)
    .map((item) => ({
      materiaMatriculadaId: item.mm.id,
      nombreMateriaCorto: item.nombreMateriaCorto,
      minutosHoy: Math.round((item.mm.tiempo_estudio.meta_horas_semana * 60) / 7),
    }));
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

export { inicializarTiempoEstudio, renderizarTiempoEstudio, obtenerEstudioParaHoy, irADetalleMateriaTiempoEstudio, formatearHorasMin };
