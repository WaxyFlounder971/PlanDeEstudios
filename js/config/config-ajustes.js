/* =========================================================================
   CONFIGURACIÓN — AJUSTES GENERALES
   Paletas, modo claro/oscuro, escala de notas, nota de aprobación por
   plan/universidad, formato de texto.
   ========================================================================= */

import { ESCALAS_DISPONIBLES, FRECUENCIAS_BACKUP_DRIVE, MONEDAS_DISPONIBLES, OFFSETS_RECORDATORIO_AGENDA, PALETAS_DISPONIBLES, calcularObjetivoPasarRaspando, crearBackupDriveDefault, migrarDatosAntiguos, obtenerEscalaPorId, migrarNotasAsignacionesEscalaPlan, sellarTimestamp } from "../core/schema.js";
import { actualizarIndicadorSync, forzarBackupManual, marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";
import { abrirConfirmacion, construirSelectorChipsMultiple, mostrarToast } from "../ui/componentes.js";
import { COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO, TEXTO_PREVIEW_PALETA, aplicarPaleta } from "../ui/tema.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";
import { obtenerSemestresOrdenCronologico } from "../semestres/semestres.js";
import {
  eliminarAdjuntosDeCronogramaDeSemestre,
  eliminarAdjuntosDeEventosSueltos,
  eliminarAdjuntosDeSemestre,
  eliminarAdjuntosDeTareasDeSemestre,
  hayAdjuntosGuardados,
} from "../core/storage-adjuntos.js";
// Sincronización con Google Calendar (Ajustes Avanzados), 2026-08-25 —
// reemplaza a Web Push (ver core/notificaciones-calendario.js, antes
// core/notificaciones-push.js). Este archivo solo dibuja el switch y
// delega toda la lógica de creación del calendario secundario/sync en
// lote a esas funciones.
import {
  activarSincronizacionCalendario,
  desactivarSincronizacionCalendario,
  sincronizacionCalendarActiva,
  sincronizarResumenDiario,
} from "../core/notificaciones-calendario.js";

/* ------------------------------ Ajustes ------------------------------ */

/**
 * Asistente IA (Gemini), revisado 2026-08-22: clave de API propia del
 * usuario (nunca compartida ni tocada por Wagner) guardada en
 * estado.datos.configuracion.gemini_api_key — mismo nivel de confianza y
 * mismo mecanismo de sync que cualquier otro campo de configuracion
 * (sellarTimestamp + marcarCambioPendiente). Al guardar/borrar, llama a
 * window.aplicarVisibilidadBotonAsistente() (expuesta por main.js, mismo
 * patrón sin-import-circular que aplicarVisibilidadNavegacion) para
 * recalcular el gate de existencia del botón "Asistente" del nav.
 *
 * Ese gate es solo de EXISTENCIA, no de preferencia: "asistente" es una
 * sección togglable/reordenable más (ver SECCIONES_TOGGLEABLES arriba), así
 * que el usuario puede ocultarla o moverla desde Ajustes > Navegación con
 * total libertad, igual que Agenda/Horario/etc. Sin clave guardada, esa
 * sección directamente no existe todavía (ni el botón del nav ni su fila en
 * Ajustes > Navegación aparecen), pero su preferencia guardada de
 * orden/visibilidad no se toca: en cuanto vuelva a haber clave, reaparece
 * tal como estaba.
 *
 * Se llama una sola vez desde renderizarAjustes() (idempotente: usa
 * .onclick, no addEventListener, así que puede re-llamarse en cada render
 * de Ajustes sin duplicar handlers) — mismo patrón que el switch de
 * notificaciones push más abajo.
 */
function inicializarAsistenteAjustes() {
  const inputKey = document.getElementById("input-gemini-key");
  const errorKey = document.getElementById("error-gemini-key");
  const bloqueVacio = document.getElementById("bloque-gemini-key-vacio");
  const bloqueGuardada = document.getElementById("bloque-gemini-key-guardada");
  const textoGuardada = document.getElementById("texto-gemini-key-guardada");
  if (!inputKey || !bloqueVacio || !bloqueGuardada) return;

  const claveActual = estado.datos.configuracion.gemini_api_key || "";

  if (claveActual) {
    bloqueVacio.classList.add("oculto");
    bloqueGuardada.classList.remove("oculto");
    // Máscara: solo se muestran los últimos 4 caracteres — suficiente para
    // que el usuario reconozca "sí, esta es la mía" sin exponer la clave
    // completa en pantalla (ej. alguien mirando de reojo/screenshare).
    const ultimos4 = claveActual.slice(-4);
    textoGuardada.textContent = "•".repeat(8) + ultimos4;
  } else {
    bloqueVacio.classList.remove("oculto");
    bloqueGuardada.classList.add("oculto");
    inputKey.value = "";
  }
  errorKey.classList.add("oculto");

  document.getElementById("btn-guardar-gemini-key").onclick = () => {
    const valor = inputKey.value.trim();
    if (!valor) {
      errorKey.textContent = "Pegá una clave antes de guardar.";
      errorKey.classList.remove("oculto");
      return;
    }
    estado.datos.configuracion.gemini_api_key = valor;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    window.aplicarVisibilidadBotonAsistente?.();
    mostrarToast("✓ Clave de Gemini guardada");
    renderizarAjustes();
  };

  document.getElementById("btn-reemplazar-gemini-key").onclick = () => {
    // No se prellena la clave vieja en el input: "Reemplazar" es un alta
    // nueva a propósito, exige pegar la clave completa de nuevo — evita
    // guardar sin querer una clave a medio editar si el usuario solo quería
    // ver qué había.
    bloqueGuardada.classList.add("oculto");
    bloqueVacio.classList.remove("oculto");
    inputKey.value = "";
    inputKey.focus();
  };

  document.getElementById("btn-borrar-gemini-key").onclick = () => {
    abrirConfirmacion({
      titulo: "¿Borrar la clave de Gemini?",
      mensaje: "El botón \"Asistente\" va a desaparecer del menú hasta que guardes una clave nueva.",
      textoConfirmar: "Borrar",
      claseConfirmar: "btn-danger",
      onConfirmar: () => {
        delete estado.datos.configuracion.gemini_api_key;
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
        window.aplicarVisibilidadBotonAsistente?.();
        mostrarToast("Clave de Gemini borrada");
        renderizarAjustes();
      },
    });
  };
}

/**
 * v1.14.1: aplica (o quita) el atributo data-rendimiento en <html>, mismo
 * patrón que data-palette/data-mode. Se exporta para poder llamarla también
 * al iniciar la app (antes de que el usuario entre a Ajustes), leyendo
 * estado.datos.configuracion.modo_rendimiento ya cargado.
 */
function aplicarModoRendimiento(activo) {
  document.documentElement.setAttribute("data-rendimiento", activo ? "reducido" : "normal");
}

/**
 * Punto 3 (ronda de ajustes visuales, 2026-08-23): filtro anti-spam para
 * "Modo fancy" y "Modo claro/oscuro" — los 2 switches que el reporte marca
 * como "presionarlos muchas veces seguidas no debe romper el estado
 * guardado ni la sincronización".
 *
 * Causa real del bug (confirmada en core/storage-sync.js):
 * marcarCambioPendiente() dispara intentarSincronizar() de inmediato, sin
 * esperar a que un intento anterior termine — no existe ningún mutex ni
 * debounce ahí. Tocar un switch varias veces seguidas dispara varias
 * rondas de GET+fusión+PUT contra Drive en paralelo, que pueden pisarse
 * entre sí o dejar guardado un estado intermedio en vez del final (esto
 * es lo que reportaron como "el modo claro no sincronizó al menos una
 * vez entre sesiones").
 *
 * El fix vive ACÁ, no dentro de marcarCambioPendiente(): esa función la
 * usa el resto de la app (decenas de campos de configuración, tareas,
 * eventos, etc.) y volverla debounced de forma global cambiaría el
 * comportamiento de guardado en todos lados, con mucho más riesgo. Estos
 * 2 switches son los únicos que el pedido señala como "muchas veces
 * seguidas" (se prenden/apagan a repetición con más facilidad que
 * escribir texto o tocar un botón normal).
 *
 * El toggle visual del checkbox y el efecto inmediato (aplicarModoRendimiento
 * / aplicarPaleta) NUNCA se debouncean — el usuario espera ver el cambio al
 * toque. Solo se retrasa la parte que dispara red (sellarTimestamp +
 * marcarCambioPendiente): varias pulsaciones seguidas colapsan en un solo
 * sello de tiempo + una sola sincronización, ya con el ÚLTIMO estado real
 * (que es siempre lo que interesa guardar, no los intermedios).
 *
 * Un solo temporizador compartido entre ambos switches alcanza: si se
 * tocan los 2 en sucesión rápida, también deben colapsar en una sola
 * sincronización final (sellarTimestamp() y marcarCambioPendiente() no
 * reciben ningún dato del switch puntual, siempre leen/marcan el estado
 * completo ya actualizado en memoria).
 */
const RETARDO_ANTIRREBOTE_SWITCH_MS = 400;
let temporizadorAntirreboteSwitch = null;
function dispararSyncConAntirrebote() {
  clearTimeout(temporizadorAntirreboteSwitch);
  temporizadorAntirreboteSwitch = setTimeout(() => {
    temporizadorAntirreboteSwitch = null;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }, RETARDO_ANTIRREBOTE_SWITCH_MS);
}

/**
 * Notificaciones — Recordatorios por tipo (2026-08-20): un grupo de chips
 * (ver construirSelectorChipsMultiple en ui/componentes.js) por cada tipo
 * de evento de Agenda (tarea/examen/evento/feriado), en ese orden fijo.
 * Cada grupo lee/escribe estado.datos.configuracion.notificaciones_recordatorios[tipo]
 * (arreglo de ids de OFFSETS_RECORDATORIO_AGENDA, ver core/schema.js).
 * Solo tiene sentido con el switch general de sincronización con Google
 * Calendar activo — si está apagado, el bloque completo queda atenuado y
 * sin interacción
 * (mismo criterio visual que el resto de bloques dependientes de un switch
 * en esta pantalla), pero los valores elegidos NO se pierden: siguen
 * guardados, listos para cuando el usuario vuelva a prender el switch
 * general.
 *
 * Reincorporada 2026-08-23 tras perderse (junto con
 * renderizarNotificacionesResumenDiario) al fusionar esta ronda de fixes
 * con la rama que traía el filtro anti-spam de arriba — ver
 * MAPA_FUNCIONES.md para el detalle de por qué se había perdido antes.
 */
const ETIQUETAS_TIPOS_RECORDATORIO_AGENDA = [
  { tipo: "tarea", etiqueta: "Tareas" },
  { tipo: "examen", etiqueta: "Exámenes" },
  { tipo: "evento", etiqueta: "Eventos" },
  { tipo: "feriado", etiqueta: "Feriados" },
];

function renderizarNotificacionesRecordatorios() {
  const contenedor = document.getElementById("seccion-notificaciones-recordatorios");
  if (!contenedor) return;

  const cfg = estado.datos.configuracion;
  if (!cfg.notificaciones_recordatorios || typeof cfg.notificaciones_recordatorios !== "object") {
    cfg.notificaciones_recordatorios = { tarea: ["1_dia"], examen: ["1_dia"], evento: ["1_dia"], feriado: ["1_dia"] };
  }

  const habilitado = sincronizacionCalendarActiva();
  contenedor.innerHTML = "";
  contenedor.style.opacity = habilitado ? "" : "0.5";
  contenedor.style.pointerEvents = habilitado ? "" : "none";

  ETIQUETAS_TIPOS_RECORDATORIO_AGENDA.forEach(({ tipo, etiqueta }) => {
    const fila = document.createElement("div");
    fila.className = "stack";
    fila.style.gap = "6px";

    const titulo = document.createElement("span");
    titulo.className = "form-label";
    titulo.textContent = etiqueta;
    fila.appendChild(titulo);

    const { elemento } = construirSelectorChipsMultiple(
      OFFSETS_RECORDATORIO_AGENDA,
      cfg.notificaciones_recordatorios[tipo],
      (valoresActuales) => {
        cfg.notificaciones_recordatorios[tipo] = valoresActuales;
        sellarTimestamp(cfg);
        marcarCambioPendiente();
      }
    );
    fila.appendChild(elemento);
    contenedor.appendChild(fila);
  });
}

/**
 * Notificaciones — Resumen diario (2026-08-20): switch + selector de hora
 * (mismo patrón visual que construirSelectCustomAjustes, ver Rango de
 * horas del Horario más arriba) para
 * estado.datos.configuracion.notificaciones_resumen_diario ({ activo,
 * hora }). Cada cambio (switch u hora) llama a sincronizarResumenDiario()
 * en core/notificaciones-calendario.js (2026-08-25: antes avisaba al
 * Worker, ahora crea/actualiza directo el evento recurrente único en
 * Google Calendar — Parte C.1 del spec) — acá solo se guarda localmente y
 * se dispara esa sincronización, siguiendo el mismo criterio best-effort
 * (si Calendar no responde, no se revierte nada en la UI).
 */
function renderizarNotificacionesResumenDiario() {
  const chkResumen = document.getElementById("switch-notificaciones-resumen-diario");
  const bloqueHora = document.getElementById("bloque-notificaciones-resumen-hora");
  const contHora = document.getElementById("select-notificaciones-resumen-hora");
  if (!chkResumen || !bloqueHora || !contHora) return;

  const cfg = estado.datos.configuracion;
  if (!cfg.notificaciones_resumen_diario || typeof cfg.notificaciones_resumen_diario !== "object") {
    cfg.notificaciones_resumen_diario = { activo: false, hora: "20:00" };
  }
  const cfgResumen = cfg.notificaciones_resumen_diario;

  const habilitado = sincronizacionCalendarActiva();
  chkResumen.disabled = !habilitado;
  chkResumen.checked = !!cfgResumen.activo;
  bloqueHora.classList.toggle("oculto", !cfgResumen.activo);
  bloqueHora.style.opacity = habilitado ? "" : "0.5";
  bloqueHora.style.pointerEvents = habilitado ? "" : "none";

  chkResumen.onchange = () => {
    cfgResumen.activo = chkResumen.checked;
    sellarTimestamp(cfg);
    marcarCambioPendiente();
    bloqueHora.classList.toggle("oculto", !cfgResumen.activo);
    sincronizarResumenDiario();
  };

  contHora.innerHTML = "";
  contHora.appendChild(construirSelectCustomAjustes({
    opciones: Array.from({ length: 24 }, (_, h) => ({
      valor: `${String(h).padStart(2, "0")}:00`,
      etiqueta: etiquetaHora12(h),
    })),
    valorInicial: cfgResumen.hora || "20:00",
    onCambiar: (valor) => {
      cfgResumen.hora = valor;
      sellarTimestamp(cfg);
      marcarCambioPendiente();
      sincronizarResumenDiario();
    },
  }));
}

/**
 * Ajustes — ocultar botones de navegación principal (2026-08-06): una fila
 * con switch por cada sección togglable. "configuracion" NUNCA aparece acá
 * (no se puede ocultar) — mismo filtro que ya aplica aplicarVisibilidadNavegacion
 * en main.js por las dudas, pero acá directamente no se le ofrece la opción.
 * Los switches son la única fuente de verdad de UI: leen y escriben
 * directo sobre estado.datos.configuracion.navegacion_oculta (arreglo de
 * ids), y en cada cambio llaman a window.aplicarVisibilidadNavegacion()
 * (expuesta por main.js) para que el nav se actualice al toque.
 */
/**
 * Ajustes — Horario: configuración de días (2026-08-12): día de inicio de
 * semana, días visibles en el grid, y nombres personalizados (hasta 3
 * caracteres). Defaults: lunes como inicio, los 7 días visibles, sin
 * nombres personalizados (se usan las abreviaturas por defecto).
 */
const DIAS_SEMANA_CONFIG = [
  { id: "lunes", etiqueta: "Lunes", abrevDefault: "L" },
  { id: "martes", etiqueta: "Martes", abrevDefault: "K" },
  { id: "miercoles", etiqueta: "Miércoles", abrevDefault: "M" },
  { id: "jueves", etiqueta: "Jueves", abrevDefault: "J" },
  { id: "viernes", etiqueta: "Viernes", abrevDefault: "V" },
  { id: "sabado", etiqueta: "Sábado", abrevDefault: "S" },
  { id: "domingo", etiqueta: "Domingo", abrevDefault: "D" },
];

function renderizarConfigDiasHorario() {
  const cfg = estado.datos.configuracion;
  cfg.dias_visibles = cfg.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id);
  cfg.nombres_dias_personalizados = cfg.nombres_dias_personalizados || {};
  cfg.dia_inicio_semana = cfg.dia_inicio_semana || "lunes";

  // Día de inicio de semana — solo Lunes/Domingo (pedido explícito): las
  // únicas dos convenciones reales de "primer día de la semana" que se
  // usan en la práctica. Los otros 5 días de DIAS_SEMANA_CONFIG siguen
  // existiendo para "Días visibles" y "Nombres personalizados" más abajo,
  // que sí necesitan los 7 — por eso el filtro va solo acá, no se toca la
  // constante compartida.
  const pillInicio = document.getElementById("pill-dia-inicio-semana");
  if (pillInicio) {
    pillInicio.innerHTML = "";
    DIAS_SEMANA_CONFIG.filter((dia) => dia.id === "lunes" || dia.id === "domingo").forEach((dia) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (cfg.dia_inicio_semana === dia.id ? " active" : "");
      btn.textContent = dia.etiqueta;
      btn.addEventListener("click", () => {
        cfg.dia_inicio_semana = dia.id;
        sellarTimestamp(cfg);
        marcarCambioPendiente();
        renderizarConfigDiasHorario();
      });
      pillInicio.appendChild(btn);
    });
  }

  // Días visibles (switch por día). Guardia: no se permite dejar 0 días
  // visibles, mismo criterio que "nunca quedarse sin nav visible" en main.js.
  const listaVisibles = document.getElementById("lista-dias-visibles");
  if (listaVisibles) {
    listaVisibles.innerHTML = "";
    DIAS_SEMANA_CONFIG.forEach((dia) => {
      const fila = document.createElement("div");
      fila.className = "row-between";
      const span = document.createElement("span");
      span.textContent = dia.etiqueta;
      const label = document.createElement("label");
      label.className = "switch switch-tema";
      const chk = document.createElement("input");
      chk.type = "checkbox";
      chk.checked = cfg.dias_visibles.includes(dia.id);
      chk.onchange = () => {
        const visibles = new Set(cfg.dias_visibles);
        if (chk.checked) visibles.add(dia.id);
        else visibles.delete(dia.id);
        if (visibles.size === 0) {
          chk.checked = true; // revierte: siempre debe quedar al menos 1 día
          return;
        }
        cfg.dias_visibles = DIAS_SEMANA_CONFIG.map((d) => d.id).filter((id) => visibles.has(id));
        sellarTimestamp(cfg);
        marcarCambioPendiente();
      };
      label.appendChild(chk);
      label.insertAdjacentHTML("beforeend", '<span class="track"><span class="thumb"></span></span>');
      fila.appendChild(span);
      fila.appendChild(label);
      listaVisibles.appendChild(fila);
    });
  }

  // Nombres personalizados (máx 3 caracteres, opcional por día)
  const listaNombres = document.getElementById("lista-nombres-dias");
  if (listaNombres) {
    listaNombres.innerHTML = "";
    DIAS_SEMANA_CONFIG.forEach((dia) => {
      const fila = document.createElement("div");
      fila.className = "row-between";
      const span = document.createElement("span");
      span.textContent = dia.etiqueta;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "form-input";
      input.style.maxWidth = "70px";
      input.maxLength = 3;
      input.placeholder = dia.abrevDefault;
      input.value = cfg.nombres_dias_personalizados[dia.id] || "";
      input.addEventListener("change", () => {
        const valor = input.value.trim().slice(0, 3);
        if (valor) cfg.nombres_dias_personalizados[dia.id] = valor;
        else delete cfg.nombres_dias_personalizados[dia.id];
        sellarTimestamp(cfg);
        marcarCambioPendiente();
      });
      fila.appendChild(span);
      fila.appendChild(input);
      listaNombres.appendChild(fila);
    });
  }
}

/**
 * Ajustes — Horario: rango de horas visibles (2026-08-14). Antes el grid
 * siempre mostraba las 24h del día; ahora se puede acortar el rango (ej.
 * 6am–11pm) para no tener que scrollear horas que nunca se usan. Guardado
 * como enteros 0-24 en cfg.horario_hora_inicio / horario_hora_fin. Default:
 * ambos "12 am" → equivale al día completo (ver obtenerRangoHorasHorario en
 * horario.js, que además blinda fin<=inicio cayendo a día completo).
 */
function etiquetaHora12(h) {
  const horaMod = h % 24;
  const hora12 = horaMod % 12 === 0 ? 12 : horaMod % 12;
  const periodo = horaMod < 12 ? "am" : "pm";
  return `${hora12} ${periodo}`;
}

/**
 * Selector custom genérico (mismo patrón visual/comportamiento que Moneda y
 * Escala de notas más abajo): botón + lista propia reparentada a
 * document.body para posicionarse con position:fixed, así el fondo/letras
 * respetan el tema en vez del popup nativo del navegador. `opciones` es
 * [{ valor, etiqueta }]. Se usa acá para Rango de horas del horario — antes
 * ese campo escribía <option> directo dentro de un <div> (bug: <option>
 * fuera de un <select> no arma ningún control, el navegador solo pinta el
 * texto suelto de cada opción, una debajo de otra, que es justo el "ya solo
 * salen las horas y no el select" reportado).
 */
function construirSelectCustomAjustes({ opciones, valorInicial, onCambiar }) {
  const selectOculto = document.createElement("select");
  selectOculto.hidden = true;
  selectOculto.setAttribute("aria-hidden", "true");
  selectOculto.tabIndex = -1;
  opciones.forEach((op) => {
    const opt = document.createElement("option");
    opt.value = String(op.valor);
    opt.textContent = op.etiqueta;
    selectOculto.appendChild(opt);
  });
  selectOculto.value = String(valorInicial);

  const dropdown = document.createElement("div");
  dropdown.className = "select-custom";
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-input select-custom-boton";
  const inicial = opciones.find((op) => String(op.valor) === selectOculto.value);
  boton.textContent = inicial ? inicial.etiqueta : "Elegir";
  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";

  function posicionar() {
    const r = boton.getBoundingClientRect();
    lista.style.position = "fixed";
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
  }
  function cerrar() {
    lista.classList.add("oculto");
    boton.setAttribute("aria-expanded", "false");
    if (lista.parentElement === document.body) dropdown.appendChild(lista);
    window.removeEventListener("scroll", cerrarSiScrollExterno, true);
    window.removeEventListener("resize", cerrar);
  }
  function cerrarSiScrollExterno(e) {
    if (lista.contains(e.target)) return;
    cerrar();
  }
  function abrir() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== lista) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    lista._volverA = dropdown;
    document.body.appendChild(lista);
    posicionar();
    lista.classList.remove("oculto");
    boton.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", cerrarSiScrollExterno, true);
    window.addEventListener("resize", cerrar);
  }

  opciones.forEach((op) => {
    const item = document.createElement("li");
    item.className = "select-custom-opcion";
    item.textContent = op.etiqueta;
    if (String(op.valor) === selectOculto.value) item.classList.add("activa");
    item.addEventListener("click", () => {
      selectOculto.value = String(op.valor);
      boton.textContent = op.etiqueta;
      lista.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
      item.classList.add("activa");
      cerrar();
      onCambiar(op.valor);
    });
    lista.appendChild(item);
  });
  boton.setAttribute("aria-expanded", "false");
  boton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lista.classList.contains("oculto")) abrir();
    else cerrar();
  });
  document.addEventListener("click", (e) => {
    if (!dropdown.contains(e.target) && !lista.contains(e.target)) cerrar();
  });

  dropdown.appendChild(boton);
  dropdown.appendChild(lista);
  dropdown.appendChild(selectOculto);
  return dropdown;
}

function renderizarConfigRangoHorasHorario() {
  const cfg = estado.datos.configuracion;
  // Mismos defaults que el fallback de obtenerRangoHorasHorario en
  // horario.js (0 = 12am, 24 = 12am del día siguiente) para que lo que se
  // ve seleccionado acá coincida siempre con lo que realmente se dibuja.
  cfg.horario_hora_inicio = Number.isFinite(cfg.horario_hora_inicio) ? cfg.horario_hora_inicio : 0;
  cfg.horario_hora_fin = Number.isFinite(cfg.horario_hora_fin) ? cfg.horario_hora_fin : 24;

  const contInicio = document.getElementById("select-horario-hora-inicio");
  const contFin = document.getElementById("select-horario-hora-fin");
  if (!contInicio || !contFin) return;

  // Inicio: 12am (0) a 11pm (23). Fin: 1am (1) a 12am del día siguiente
  // (24, mostrado también como "12 am" vía etiquetaHora12(24) = 24%24=0).
  contInicio.innerHTML = "";
  contInicio.appendChild(construirSelectCustomAjustes({
    opciones: Array.from({ length: 24 }, (_, h) => ({ valor: h, etiqueta: etiquetaHora12(h) })),
    valorInicial: cfg.horario_hora_inicio,
    onCambiar: (valor) => {
      cfg.horario_hora_inicio = Number(valor);
      sellarTimestamp(cfg);
      marcarCambioPendiente();
      window.renderizarHorario?.();
    },
  }));

  contFin.innerHTML = "";
  contFin.appendChild(construirSelectCustomAjustes({
    opciones: Array.from({ length: 24 }, (_, h) => h + 1).map((h) => ({ valor: h, etiqueta: etiquetaHora12(h) })),
    valorInicial: cfg.horario_hora_fin,
    onCambiar: (valor) => {
      cfg.horario_hora_fin = Number(valor);
      sellarTimestamp(cfg);
      marcarCambioPendiente();
      window.renderizarHorario?.();
    },
  }));
}

const SECCIONES_TOGGLEABLES = [
  { id: "agenda", etiqueta: "Agenda", icono: "📖" },
  { id: "horario", etiqueta: "Horario", icono: "🗓️" },
  { id: "semestres", etiqueta: "Semestres", icono: "📅" },
  { id: "comunidad", etiqueta: "Comunidad", icono: "👥" },
  { id: "finanzas", etiqueta: "Finanzas", icono: "💰" },
  { id: "plan-estudios", etiqueta: "Plan de Estudios", icono: "📚" },
  { id: "asistente", etiqueta: "Asistente", icono: "✨" },
];

function renderizarNavegacionOculta() {
  const cont = document.getElementById("lista-nav-oculta");
  if (!cont) return;
  cont.innerHTML = "";

  const ocultas = new Set(estado.datos.configuracion.navegacion_oculta || []);
  // window.obtenerOrdenNavegacion la expone main.js (mismo motivo que
  // aplicarVisibilidadNavegacion: evitar import circular, ya que
  // config-ajustes.js es importado POR main.js). Si por lo que sea no
  // está disponible todavía, se cae al orden fijo de SECCIONES_TOGGLEABLES
  // para no romper el render.
  const orden = typeof window.obtenerOrdenNavegacion === "function"
    ? window.obtenerOrdenNavegacion()
    : SECCIONES_TOGGLEABLES.map((s) => s.id);

  const hayClaveGemini = Boolean(estado.datos.configuracion.gemini_api_key);

  orden.forEach((id) => {
    const seccion = SECCIONES_TOGGLEABLES.find((s) => s.id === id);
    if (!seccion) return; // id huérfano (ej. una sección que ya no existe) — se ignora

    // Asistente IA (Gemini): gate de EXISTENCIA, no de preferencia — sin
    // clave guardada la sección no existe todavía, así que no tiene
    // sentido ofrecer un switch para ocultar/mostrar algo que no está
    // disponible. Su preferencia guardada en navegacion_oculta/
    // navegacion_orden no se toca ni se pierde: en cuanto haya clave,
    // reaparece acá con el mismo estado de switch y posición que tenía.
    if (id === "asistente" && !hayClaveGemini) return;

    const fila = document.createElement("div");
    fila.className = "fila-nav-orden row-between";
    fila.dataset.id = id;

    const izquierda = document.createElement("div");
    izquierda.className = "row";
    izquierda.style.cssText = "align-items:center; gap:10px; min-width:0;";

    const handle = document.createElement("span");
    handle.className = "handle-mover";
    handle.textContent = "⋮⋮";
    handle.title = "Arrastrá para reordenar";
    izquierda.appendChild(handle);

    const icono = document.createElement("span");
    icono.textContent = seccion.icono;
    icono.style.cssText = "font-size:1.05rem; flex-shrink:0;";
    izquierda.appendChild(icono);

    const texto = document.createElement("span");
    texto.textContent = seccion.etiqueta;
    izquierda.appendChild(texto);

    fila.appendChild(izquierda);

    const label = document.createElement("label");
    label.className = "switch switch-tema";
    const chk = document.createElement("input");
    chk.type = "checkbox";
    // El switch representa "visible" (encendido = se muestra en el nav),
    // así que va invertido respecto a `ocultas` (que guarda lo OCULTO).
    chk.checked = !ocultas.has(id);
    chk.addEventListener("change", () => {
      const actuales = new Set(estado.datos.configuracion.navegacion_oculta || []);
      if (chk.checked) actuales.delete(id);
      else actuales.add(id);
      estado.datos.configuracion.navegacion_oculta = Array.from(actuales);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      if (typeof window.aplicarVisibilidadNavegacion === "function") {
        window.aplicarVisibilidadNavegacion();
      }
    });
    const track = document.createElement("span");
    track.className = "track";
    track.innerHTML = '<span class="thumb"></span>';
    label.appendChild(chk);
    label.appendChild(track);
    fila.appendChild(label);

    cont.appendChild(fila);
  });

  habilitarArrastreNavegacion(cont);
}
// Se expone en window (mismo motivo de siempre: config-ajustes.js ya es
// importado POR main.js) para que aplicarVisibilidadBotonAsistente() en
// main.js pueda refrescar esta lista en vivo cuando se guarda/borra la
// clave de Gemini estando parado en otra pantalla de Ajustes.
window.renderizarNavegacionOculta = renderizarNavegacionOculta;

/**
 * Bug — duplicado en drag-and-drop de navegación (2026-08-07): reordena
 * `navegacion_orden` moviendo `idArrastrado` a la posición inmediatamente
 * ANTES de `idReferencia` (o al final, si `idReferencia` es null).
 *
 * Estructuralmente imposible que duplique un id: SIEMPRE parte del orden
 * canónico ya deduplicado (window.obtenerOrdenNavegacion(), que además se
 * autolimpia en cada llamada — ver obtenerOrdenNavegacionEfectivo en
 * main.js), le quita `idArrastrado` una única vez (filter) y lo vuelve a
 * insertar una única vez (splice/push). Nunca se lee ni se reconstruye el
 * arreglo final a partir de lo que hay pintado en el DOM.
 */
function reordenarSeccionNav(idArrastrado, idReferencia) {
  const ordenBase = typeof window.obtenerOrdenNavegacion === "function"
    ? window.obtenerOrdenNavegacion()
    : SECCIONES_TOGGLEABLES.map((s) => s.id);

  const sinArrastrado = ordenBase.filter((id) => id !== idArrastrado);
  const indiceDestino = idReferencia ? sinArrastrado.indexOf(idReferencia) : -1;

  const nuevoOrden = [...sinArrastrado];
  if (indiceDestino === -1) nuevoOrden.push(idArrastrado);
  else nuevoOrden.splice(indiceDestino, 0, idArrastrado);

  estado.datos.configuracion.navegacion_orden = nuevoOrden;
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
  if (typeof window.aplicarVisibilidadNavegacion === "function") {
    window.aplicarVisibilidadNavegacion();
  }
  renderizarNavegacionOculta(); // reconstruye el DOM limpio desde el dato ya sano
}

/**
 * Ajustes — arrastrar para reordenar los switches de navegación
 * (2026-08-06): mismo motor por Pointer Events que la Fase 8 de
 * semestres-tarjetas.js (mouse y touch con el mismo código, más fiable en
 * teléfono que el HTML5 Drag&Drop nativo) — reusa a propósito las mismas
 * clases CSS (.handle-mover / .arrastrando / .arrastre-placeholder) para
 * que el gesto se sienta igual en toda la app. A diferencia de
 * criterios/asignaciones, acá el ícono de agarre queda SIEMPRE visible
 * (pedido explícito: lista corta y fija, sin el "modo bajo demanda").
 * Al soltar, delega en reordenarSeccionNav (ver arriba) — esa función es
 * la única que escribe estado.datos.configuracion.navegacion_orden.
 */
function habilitarArrastreNavegacion(contenedor) {
  contenedor.querySelectorAll(".fila-nav-orden").forEach((fila) => {
    const handle = fila.querySelector(".handle-mover");
    if (!handle) return;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", (evDown) => {
      if (evDown.button !== undefined && evDown.button !== 0) return; // solo click izq / touch
      evDown.preventDefault();
      evDown.stopPropagation();

      // Bug — duplicado en drag-and-drop de navegación (2026-08-07): se
      // captura el id ANTES de que `fila` se desprenda del DOM real. El
      // resultado final del drag nunca se arma leyendo `data-id` desde el
      // DOM (ver alSoltar/reordenarSeccionNav) — este id es el único dato
      // que el gesto necesita conservar del elemento arrastrado.
      const idArrastrado = fila.dataset.id;

      const rectInicial = fila.getBoundingClientRect();
      const anchoItem = rectInicial.width;
      const alturaItem = rectInicial.height;

      const placeholder = document.createElement("div");
      placeholder.className = "arrastre-placeholder";
      placeholder.style.height = alturaItem + "px";
      contenedor.insertBefore(placeholder, fila);

      fila.classList.add("arrastrando");
      fila.style.position = "fixed";
      fila.style.zIndex = "99998";
      fila.style.width = anchoItem + "px";
      fila.style.pointerEvents = "none";
      fila.style.left = rectInicial.left + "px";
      fila.style.top = rectInicial.top + "px";
      document.body.appendChild(fila);

      try {
        fila.setPointerCapture(evDown.pointerId);
      } catch (e) {
        // Si el navegador no puede capturar (raro), el arrastre sigue
        // funcionando igual — solo se pierde la garantía de recibir el
        // pointerup aunque el dedo salga del elemento.
      }

      const mover = (x, y) => {
        fila.style.left = x - anchoItem / 2 + "px";
        fila.style.top = y - alturaItem / 2 + "px";

        fila.style.display = "none";
        const elDebajo = document.elementFromPoint(x, y);
        fila.style.display = "";
        if (!elDebajo || !contenedor.contains(elDebajo)) return;

        const hijos = Array.from(contenedor.children).filter((h) => h !== placeholder && h !== fila);
        let referencia = null;
        for (const hijo of hijos) {
          const rect = hijo.getBoundingClientRect();
          if (y < rect.top + rect.height / 2) {
            referencia = hijo;
            break;
          }
        }
        if (referencia) contenedor.insertBefore(placeholder, referencia);
        else contenedor.appendChild(placeholder);
      };

      const alMover = (evMove) => mover(evMove.clientX, evMove.clientY);

      const alSoltar = () => {
        fila.removeEventListener("pointermove", alMover);
        fila.removeEventListener("pointerup", alSoltar);
        fila.removeEventListener("pointercancel", alSoltar);
        try {
          fila.releasePointerCapture(evDown.pointerId);
        } catch (e) {
          // nada que limpiar si nunca se pudo capturar
        }

        // Bug — duplicado en drag-and-drop de navegación (2026-08-07): única
        // lectura del DOM usada para decidir la posición final: qué fila
        // (por id) quedó inmediatamente DESPUÉS del placeholder, o null si
        // quedó al final. El arreglo persistido NUNCA se arma leyendo
        // querySelectorAll sobre el contenedor — eso era la causa raíz del
        // bug (nodo desprendido + re-render concurrente = doble data-id).
        const filaSiguiente = placeholder.nextElementSibling;
        const idReferencia =
          filaSiguiente && filaSiguiente.classList.contains("fila-nav-orden") ? filaSiguiente.dataset.id : null;

        // Se limpia el DOM temporal del drag ANTES de tocar los datos, así
        // `fila` nunca queda flotando fuera de #lista-nav-oculta mientras
        // se recalcula el orden. renderizarNavegacionOculta() (llamada
        // dentro de reordenarSeccionNav) reconstruye el DOM limpio desde
        // el dato ya sano.
        fila.remove();
        placeholder.remove();

        reordenarSeccionNav(idArrastrado, idReferencia);
      };

      fila.addEventListener("pointermove", alMover);
      fila.addEventListener("pointerup", alSoltar);
      fila.addEventListener("pointercancel", alSoltar);
    });
  });
}

/**
 * Secciones de Ajustes contraídas por defecto (pedido explícito). Las
 * cabeceras (<button class="ajuste-seccion-cabecera">) ya están fijas en
 * index.html, no se regeneran en cada render de Ajustes — por eso se usa
 * delegación de eventos sobre el contenedor estable #seccion-configuracion
 * en vez de un addEventListener por botón, que se duplicaría cada vez que
 * renderizarAjustes() se vuelve a llamar (cada cambio de pill, tema, etc.).
 * El dataset.accordionInit evita enganchar el delegado más de una vez.
 */
function inicializarAccordionAjustes() {
  const contenedor = document.getElementById("seccion-configuracion");
  if (!contenedor || contenedor.dataset.accordionInit) return;
  contenedor.dataset.accordionInit = "1";
  contenedor.addEventListener("click", (ev) => {
    const cabecera = ev.target.closest(".ajuste-seccion-cabecera");
    if (!cabecera) return;
    cabecera.closest(".ajuste-seccion")?.classList.toggle("colapsada");
  });
}

function renderizarAjustes() {
  inicializarAccordionAjustes();
  inicializarAsistenteAjustes();

  // Paletas — cada cuadro muestra su propio color real (punto 3)
  const grid = document.getElementById("grid-paletas");
  grid.innerHTML = "";
  PALETAS_DISPONIBLES.forEach((paleta) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (paleta === estado.datos.configuracion.paleta ? " selected" : "");
    sw.style.background = paleta === "azucarado"
      ? FONDO_PREVIEW_AZUCARADO
      : `linear-gradient(135deg, ${COLORES_PREVIEW_PALETA[paleta].join(", ")})`;
    sw.style.color = TEXTO_PREVIEW_PALETA[paleta] || "#ffffff";
    sw.setAttribute("data-palette-preview", paleta);
    sw.textContent = paleta;
    sw.addEventListener("click", () => {
      estado.datos.configuracion.paleta = paleta;
      aplicarPaleta(paleta, estado.datos.configuracion.modo);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      renderizarAjustes();
    });
    grid.appendChild(sw);
  });

  // v1.13: 15ª opción — "+ Crear mi paleta". Si el usuario ya tiene una
  // guardada, el cuadro muestra su propio degradado (accent1 → accent2) y
  // queda marcado como seleccionado igual que cualquier otra paleta; si
  // todavía no existe, muestra un degradado arcoíris invitando a crearla.
  const personalizada = estado.datos.configuracion.paleta_personalizada;
  const swPersonalizada = document.createElement("div");
  swPersonalizada.className = "palette-swatch ppz-swatch-crear"
    + (estado.datos.configuracion.paleta === "personalizada" ? " selected" : "");
  swPersonalizada.style.background = personalizada
    ? `linear-gradient(135deg, ${personalizada.colores.accent1}, ${personalizada.colores.accent2})`
    : "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)";
  swPersonalizada.textContent = personalizada ? "personalizada" : "+ Crear mi paleta";
  swPersonalizada.addEventListener("click", () => {
    if (personalizada) {
      // Ya existe una guardada: un clic la activa directamente, igual que
      // cualquier otro cuadro del grid — para editarla de nuevo desde cero
      // se vuelve a entrar por el flujo completo con el botón de abajo.
      estado.datos.configuracion.paleta = "personalizada";
      aplicarPaleta("personalizada", estado.datos.configuracion.modo, personalizada.colores);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      renderizarAjustes();
    } else {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    }
  });
  grid.appendChild(swPersonalizada);

  // Botón aparte para volver a editar una paleta personalizada ya guardada
  // (evita perder los ajustes anteriores solo por querer retocar un color).
  if (personalizada) {
    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn-secondary ppz-btn-editar";
    btnEditar.textContent = "Editar mi paleta";
    btnEditar.addEventListener("click", () => {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    });
    grid.appendChild(btnEditar);
  }

  // v1.14.1: Modo fancy (id del elemento sigue siendo "switch-rendimiento"
  // por compatibilidad, pero el switch en pantalla se llama "Modo fancy" —
  // el dato de fondo (modo_rendimiento) representa lo CONTRARIO de lo que
  // dice la etiqueta: modo_rendimiento=true significa rendimiento activo,
  // o sea fancy APAGADO. Fix v1.16.1 (2026-08-23): antes el checkbox
  // reflejaba modo_rendimiento tal cual, así que el switch se veía
  // "encendido" (ON) cuando en realidad lo fancy estaba apagado — quedaba
  // invertido contra su propia etiqueta. Se invierte acá nomás (checked =
  // fancy activo = !modo_rendimiento) para no tocar el nombre del campo en
  // el modelo de datos ni la migración que ya corrió para las cuentas
  // existentes (ver rendimiento_default_v2_aplicado en core/schema.js).
  // Reaplicado 2026-08-23 sobre la rama del antirrebote — se había perdido
  // en esa rama porque partió de una copia anterior al fix v1.16.1.
  const chkRendimiento = document.getElementById("switch-rendimiento");
  if (chkRendimiento) {
    chkRendimiento.checked = !estado.datos.configuracion.modo_rendimiento;
    chkRendimiento.onchange = () => {
      // Estado en memoria + efecto visual: instantáneo, sin antirrebote (ver
      // dispararSyncConAntirrebote más arriba para el porqué).
      const fancyActivo = chkRendimiento.checked;
      estado.datos.configuracion.modo_rendimiento = !fancyActivo;
      aplicarModoRendimiento(!fancyActivo);
      dispararSyncConAntirrebote();
    };
  }

  // Sincronizar con Google Calendar — switch en Ajustes Avanzados,
  // 2026-08-25 (reemplaza al viejo "Activar notificaciones push"). Se
  // acepte o no en el onboarding (ver ofrecerActivarSincronizacionCalendario
  // en main.js), queda disponible acá para prender/apagar en cualquier
  // momento. Todo el trabajo real (crear el calendario secundario,
  // (des)sincronizar cada evento contra la API de Calendar) vive en
  // core/notificaciones-calendario.js; este switch solo dispara esas
  // funciones y refleja su resultado.
  //
  // *** index.html debe actualizarse a mano (no se subió en esta sesión):
  // el id del checkbox pasa de "switch-notificaciones-push" a
  // "switch-sync-calendario", y su label visible de "Activar notificaciones
  // push" a "Sincronizar recordatorios con Google Calendar" (texto exacto
  // sugerido en el spec, Parte D.2). El bloque #aviso-notificaciones-sin-
  // soporte ya NO aplica — a diferencia de Web Push, la sincronización con
  // Calendar no depende de que el navegador soporte notificaciones (ver
  // por qué se eliminó soportaNotificacionesPush() en
  // notificaciones-calendario.js) — puede quitarse del HTML. ***
  const chkSyncCalendario = document.getElementById("switch-sync-calendario");
  if (chkSyncCalendario) {
    chkSyncCalendario.checked = sincronizacionCalendarActiva();
    chkSyncCalendario.onchange = async () => {
      // Se deshabilita mientras se resuelve la creación del calendario
      // secundario/el sync en lote (puede tardar un instante y no tiene
      // sentido dejar el switch clickeable a mitad de camino) — vuelve a
      // habilitarse pase lo que pase.
      chkSyncCalendario.disabled = true;
      if (chkSyncCalendario.checked) {
        const activado = await activarSincronizacionCalendario();
        // Si no se pudo crear el calendario secundario (o falta el scope
        // de Calendar), activarSincronizacionCalendario ya avisó con un
        // toast — acá solo se destilda el switch para que la UI quede
        // consistente con lo que realmente pasó.
        if (!activado) chkSyncCalendario.checked = false;
      } else {
        await desactivarSincronizacionCalendario();
      }
      chkSyncCalendario.disabled = false;
      // El switch general habilita/deshabilita los bloques de abajo — se
      // vuelven a pintar acá para que reflejen el nuevo estado al toque,
      // sin esperar a que el usuario navegue fuera y vuelva a Ajustes.
      renderizarNotificacionesRecordatorios();
      renderizarNotificacionesResumenDiario();
    };
  }
  renderizarNotificacionesRecordatorios();
  renderizarNotificacionesResumenDiario();

  // Ronda de ajustes visuales — punto 3: los 2 switches de Agenda que iban
  // acá ("Mostrar días sin eventos ni tareas" y "Mostrar clases ese día en
  // Agenda", agenda_mostrar_dias_vacios/agenda_mostrar_clases) se movieron
  // al modal de Ajustes de Agenda (#modal-agenda-ajustes, ver
  // inicializarFiltrosAgenda en agenda.js) — dejan de existir en esta
  // sección global. Los campos de configuracion siguen siendo los mismos,
  // solo cambió DÓNDE se editan.

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    // Mismo criterio que switch-rendimiento: estado en memoria + repintado de
    // paleta instantáneos, solo el sello+sync va con antirrebote.
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(
      estado.datos.configuracion.paleta,
      nuevoModo,
      estado.datos.configuracion.paleta === "personalizada" ? personalizada.colores : undefined
    );
    dispararSyncConAntirrebote();
  };

  // Ajustes por Universidad (2026-08-08): el selector de escala global que
  // vivía acá (#pill-escala-notas, leyendo/escribiendo
  // configuracion.escala_notas_global) se elimina — ese campo ya no existe
  // en el schema (ver migrarDatosAntiguos). La escala ahora es 100% por
  // plan, y se edita dentro de cada tarjeta (ver renderizarNotasAprobacion
  // más abajo, junto a nota de aprobación y redondeo).
  //
  // NOTA para quien toque index.html: el contenedor viejo #pill-escala-notas
  // queda huérfano en el HTML — ya no se busca ni se usa desde acá, se
  // puede borrar del markup con seguridad.

  // Fase 6, punto 5: nota de aprobación por universidad/plan — va justo
  // después de la escala de notas (mismo grupo "académico" dentro del
  // flujo de Ajustes: apariencia arriba, académico en el medio, formato
  // de texto al final).
  renderizarNotasAprobacion();

  // Formato de texto de nombres de materias/carrera (v5 #9)
  const grupoFormato = document.getElementById("pill-formato-texto");
  if (grupoFormato) {
    grupoFormato.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === (estado.datos.configuracion.formato_texto_nombres || "titulo"));
      btn.onclick = () => {
        estado.datos.configuracion.formato_texto_nombres = btn.dataset.valor;
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
        renderizarAjustes();
        if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
      };
    });
  }

  // Moneda preferida (Ajustes generales, 2026-08-10): preferencia GLOBAL
  // del usuario (no por universidad/plan) que usa Finanzas para formatear
  // montos.
  //
  // v1.15.13 (2026-08-10, pedido explícito: "hazlo como un selector...
  // ASEGURATE que mantenga el diseño general de la app como la usan en
  // escala de notas"): con 37 monedas un pill-group de botones sueltos no
  // entra bien en pantalla de teléfono (se desborda / se apila feo). Se
  // reemplaza por el MISMO componente ".select-custom" que ya usa "Escala
  // de notas" más abajo (ver renderizarNotasAprobacion) — botón + lista
  // propia reparentada a document.body, mismo fondo/tipografía/color del
  // tema (viene 100% de design-system.css), sin depender del <select>
  // nativo del navegador. Se construye dinámicamente desde
  // MONEDAS_DISPONIBLES, así la lista puede crecer sin tocar el markup.
  renderizarSelectorMoneda();

  // Ajustes — Horario: configuración de días
  renderizarConfigDiasHorario();

  // Ajustes — Horario: rango de horas visibles en el grid
  renderizarConfigRangoHorasHorario();

  // Ajustes — ocultar botones de navegación principal
  renderizarNavegacionOculta();

  // Ajustes — backup de seguridad rotativo a Drive (frecuencia + estado)
  renderizarSeccionBackupDrive();

  // Ajustes — respaldo de datos (exportar/importar JSON completo)
  renderizarSeccionDatos();

  // Ajustes — liberar espacio (borrado en lote de adjuntos, solo si hay
  // alguno guardado — ver hayAdjuntosGuardados en core/storage-adjuntos.js)
  renderizarSeccionLiberarEspacio();

  actualizarIndicadorSync();
}

/**
 * Ajustes — Selector de moneda preferida (2026-08-10): mismo patrón visual
 * y de comportamiento que el dropdown de "Escala de notas" (ver más abajo,
 * dentro de renderizarNotasAprobacion) — se duplica la lógica en vez de
 * generalizarla a un helper porque los dos vivían en momentos distintos
 * del archivo con datos de origen distintos (uno por plan, este es
 * global); un helper compartido hoy exigiría un refactor más grande que
 * el pedido puntual de "que se vea igual". Si en el futuro aparece un
 * tercer selector custom, ahí sí vale la pena extraer el patrón.
 */
function renderizarSelectorMoneda() {
  const contenedor = document.getElementById("pill-moneda");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  const monedaActualId = estado.datos.configuracion.moneda_preferida || "CRC";
  const selectMoneda = document.createElement("select");
  selectMoneda.hidden = true;
  selectMoneda.setAttribute("aria-hidden", "true");
  selectMoneda.tabIndex = -1;
  MONEDAS_DISPONIBLES.forEach((moneda) => {
    const opt = document.createElement("option");
    opt.value = moneda.id;
    opt.textContent = `${moneda.simbolo} ${moneda.etiqueta}`;
    selectMoneda.appendChild(opt);
  });
  selectMoneda.value = monedaActualId;

  const dropdownMoneda = document.createElement("div");
  dropdownMoneda.className = "select-custom";
  const botonMoneda = document.createElement("button");
  botonMoneda.type = "button";
  botonMoneda.className = "form-input select-custom-boton";
  const monedaInicial = MONEDAS_DISPONIBLES.find((m) => m.id === selectMoneda.value);
  botonMoneda.textContent = monedaInicial ? `${monedaInicial.simbolo} ${monedaInicial.etiqueta}` : "Elegir moneda";

  // v2.9.2 (2026-08-26, pedido explícito): con 50 monedas en la lista
  // (37 de antes + las 14 LatAm/Senegal agregadas en este mismo cambio,
  // ver MONEDAS_DISPONIBLES en schema.js) desplazarse a mano hasta la
  // deseada es lento — se agrega un buscador de texto arriba de la lista.
  // Reparenta a document.body el WRAPPER completo (buscador + <ul>) en vez
  // de solo el <ul> como antes, para que el input viaje pegado a la lista
  // cuando se abre; la clase ".select-custom-lista" (fondo/borde/sombra/
  // scroll) se mueve del <ul> a este wrapper, y el <ul> queda como lista
  // interna simple sin esa clase.
  const wrapperListaMoneda = document.createElement("div");
  wrapperListaMoneda.className = "select-custom-lista oculto";

  const inputBuscarMoneda = document.createElement("input");
  inputBuscarMoneda.type = "text";
  inputBuscarMoneda.className = "form-input";
  inputBuscarMoneda.placeholder = "Buscar moneda...";
  inputBuscarMoneda.autocomplete = "off";
  inputBuscarMoneda.style.cssText = "position:sticky; top:0; margin-bottom:6px;";
  wrapperListaMoneda.appendChild(inputBuscarMoneda);

  const listaMoneda = document.createElement("ul");
  listaMoneda.style.cssText = "list-style:none; margin:0; padding:0;";
  wrapperListaMoneda.appendChild(listaMoneda);

  function posicionarListaMoneda() {
    const r = botonMoneda.getBoundingClientRect();
    wrapperListaMoneda.style.position = "fixed";
    wrapperListaMoneda.style.top = `${r.bottom + 6}px`;
    wrapperListaMoneda.style.left = `${r.left}px`;
    wrapperListaMoneda.style.width = `${r.width}px`;
  }
  function cerrarListaMoneda() {
    wrapperListaMoneda.classList.add("oculto");
    botonMoneda.setAttribute("aria-expanded", "false");
    if (wrapperListaMoneda.parentElement === document.body) dropdownMoneda.appendChild(wrapperListaMoneda);
    window.removeEventListener("scroll", cerrarSiScrollExternoMoneda, true);
    window.removeEventListener("resize", cerrarListaMoneda);
  }
  function cerrarSiScrollExternoMoneda(e) {
    if (wrapperListaMoneda.contains(e.target)) return;
    cerrarListaMoneda();
  }
  function abrirListaMoneda() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== wrapperListaMoneda) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    wrapperListaMoneda._volverA = dropdownMoneda;
    document.body.appendChild(wrapperListaMoneda);
    posicionarListaMoneda();
    wrapperListaMoneda.classList.remove("oculto");
    botonMoneda.setAttribute("aria-expanded", "true");
    // Buscador siempre arranca limpio y con todas las opciones visibles
    // cada vez que se abre — evita el caso confuso de "abrí, ya había un
    // filtro puesto de la vez pasada, no veo la moneda que busco".
    inputBuscarMoneda.value = "";
    filtrarListaMoneda();
    inputBuscarMoneda.focus();
    window.addEventListener("scroll", cerrarSiScrollExternoMoneda, true);
    window.addEventListener("resize", cerrarListaMoneda);
  }

  /** Filtra las opciones visibles por coincidencia de texto (símbolo, nombre o código ISO), sin distinguir mayúsculas/acentos. */
  function normalizarTextoBusqueda(texto) {
    return texto
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
  }
  function filtrarListaMoneda() {
    const consulta = normalizarTextoBusqueda(inputBuscarMoneda.value.trim());
    listaMoneda.querySelectorAll(".select-custom-opcion").forEach((item) => {
      const coincide = consulta === "" || normalizarTextoBusqueda(item.dataset.busqueda).includes(consulta);
      item.style.display = coincide ? "" : "none";
    });
  }
  inputBuscarMoneda.addEventListener("input", filtrarListaMoneda);
  // No cerrar el dropdown al hacer click/teclear dentro del buscador.
  inputBuscarMoneda.addEventListener("click", (e) => e.stopPropagation());

  MONEDAS_DISPONIBLES.forEach((moneda) => {
    const item = document.createElement("li");
    item.className = "select-custom-opcion";
    item.textContent = `${moneda.simbolo} ${moneda.etiqueta}`;
    item.dataset.busqueda = `${moneda.simbolo} ${moneda.etiqueta} ${moneda.id}`;
    if (moneda.id === selectMoneda.value) item.classList.add("activa");
    item.addEventListener("click", () => {
      selectMoneda.value = moneda.id;
      botonMoneda.textContent = `${moneda.simbolo} ${moneda.etiqueta}`;
      listaMoneda.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
      item.classList.add("activa");
      cerrarListaMoneda();
      selectMoneda.dispatchEvent(new Event("change"));
    });
    listaMoneda.appendChild(item);
  });
  botonMoneda.setAttribute("aria-expanded", "false");
  botonMoneda.addEventListener("click", (e) => {
    e.stopPropagation();
    if (wrapperListaMoneda.classList.contains("oculto")) abrirListaMoneda();
    else cerrarListaMoneda();
  });
  document.addEventListener("click", (e) => {
    if (!dropdownMoneda.contains(e.target) && !wrapperListaMoneda.contains(e.target)) {
      cerrarListaMoneda();
    }
  });
  selectMoneda.addEventListener("change", () => {
    estado.datos.configuracion.moneda_preferida = selectMoneda.value;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  });

  dropdownMoneda.appendChild(botonMoneda);
  dropdownMoneda.appendChild(wrapperListaMoneda);
  dropdownMoneda.appendChild(selectMoneda);
  contenedor.appendChild(dropdownMoneda);
}

/**
 * Ajustes — Backup de seguridad rotativo a Drive (2026-08-10): elegir la
 * frecuencia e informar cuándo fue el último backup exitoso. El ciclo en
 * sí (crear/rotar backup_reciente.json / backup_anterior.json dentro de
 * AppAcademica/) corre SOLO, enganchado al ciclo normal de sync — ver
 * ejecutarBackupSiToca en core/storage-sync.js. Esta función nunca dispara
 * un backup a mano, solo lee/escribe la preferencia y muestra el estado.
 */
function renderizarSeccionBackupDrive() {
  const grupoFrecuencia = document.getElementById("pill-frecuencia-backup");
  if (grupoFrecuencia) {
    grupoFrecuencia.innerHTML = "";
    const cfgBackup = estado.datos.configuracion.backup_drive || crearBackupDriveDefault();
    FRECUENCIAS_BACKUP_DRIVE.forEach((frecuencia) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (frecuencia.id === (cfgBackup.frecuencia || "semanal") ? " active" : "");
      btn.textContent = frecuencia.etiqueta;
      btn.addEventListener("click", () => {
        estado.datos.configuracion.backup_drive =
          estado.datos.configuracion.backup_drive || crearBackupDriveDefault();
        estado.datos.configuracion.backup_drive.frecuencia = frecuencia.id;
        sellarTimestamp(estado.datos.configuracion);
        marcarCambioPendiente();
        renderizarSeccionBackupDrive();
      });
      grupoFrecuencia.appendChild(btn);
    });
  }

  const elEstado = document.getElementById("texto-ultimo-backup");
  if (elEstado) {
    const cfgBackup = estado.datos.configuracion.backup_drive;
    elEstado.textContent =
      cfgBackup && cfgBackup.ultimo_backup_iso
        ? `Último backup: ${new Date(cfgBackup.ultimo_backup_iso).toLocaleString()}`
        : "Todavía no se hizo ningún backup automático — se hará en la próxima sincronización.";
  }

  // Botón "Hacer backup ahora" (2026-08-10, pedido explícito): fuerza el
  // mismo ciclo real de rotación (ver forzarBackupManual en
  // core/storage-sync.js), ignorando el intervalo de la frecuencia
  // elegida. A diferencia del backup automático, acá SÍ se avisa el
  // resultado (éxito o error) porque es una acción que la persona pidió a
  // mano y espera confirmación.
  const btnManual = document.getElementById("btn-backup-manual");
  if (btnManual && !btnManual.dataset.enganchado) {
    btnManual.dataset.enganchado = "1";
    btnManual.addEventListener("click", async () => {
      btnManual.disabled = true;
      const textoOriginal = btnManual.textContent;
      btnManual.textContent = "Haciendo backup…";
      try {
        await forzarBackupManual();
        mostrarToast("✓ Backup completado");
        renderizarSeccionBackupDrive();
      } catch (e) {
        console.warn("No se pudo completar el backup manual:", e);
        mostrarToast("No se pudo hacer el backup. Intenta de nuevo.");
      } finally {
        btnManual.disabled = false;
        btnManual.textContent = textoOriginal;
      }
    });
  }
}

/**
 * Ajustes — Respaldo de datos (exportar / importar JSON completo): permite
 * bajar un archivo .json con TODO lo que vive en estado.datos (perfil,
 * configuración, planes, semestres, notas, agenda, profesores, compañeros,
 * adjuntos) y restaurarlo más adelante — mismo archivo que ya usás para
 * respaldos manuales.
 *
 * EXPORTAR es de solo lectura: no muta nada, no pide confirmación.
 *
 * IMPORTAR es DESTRUCTIVO — reemplaza el 100% de estado.datos actual — por
 * eso sigue 4 pasos, en orden, y aborta sin tocar nada si cualquiera falla:
 *   1. Valida que el archivo sea JSON y tenga la forma mínima esperada
 *      (objeto con version_esquema + las colecciones principales) — un
 *      archivo random no debe poder dejar la app en un estado roto a medias.
 *   2. Pide confirmación explícita con window.confirm, dejando clarísimo que
 *      es irreversible y sugiriendo exportar antes por las dudas.
 *   3. Corre migrarDatosAntiguos() sobre el JSON importado ANTES de
 *      aplicarlo — el mismo paso que corre cualquier dato que entra a la
 *      app (cache local o Drive), así un backup viejo (de una versión
 *      anterior del schema) se pone al día solo en vez de faltarle campos
 *      nuevos (ver schema.js).
 *   4. Muta estado.datos EN EL MISMO OBJETO (vacía sus llaves y copia las
 *      nuevas con Object.assign) en vez de reasignar estado.datos =
 *      nuevoObjeto — igual que el resto de la app, que nunca reasigna
 *      estado.datos en ningún lado, solo muta sus propiedades.
 *
 * Después de aplicar, llama a marcarCambioPendiente() (mismo mecanismo que
 * cualquier otro cambio) y recarga la página: reemplazar TODO el estado de
 * punta a punta (agenda, finanzas, horario, comunidad — secciones que este
 * archivo ni siquiera importa) sin recargar implicaría reconstruir a mano
 * el render de cada sección desde acá; recargar es la única forma de
 * garantizar que TODA la UI, no solo Ajustes, quede consistente con los
 * datos nuevos.
 */
const LLAVES_MINIMAS_DATOS_VALIDOS = ["version_esquema", "configuracion", "semestres", "planes_estudio"];

function formatearFechaArchivo(fecha) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${pad(fecha.getMonth() + 1)}-${pad(fecha.getDate())}`;
}

function exportarDatos() {
  const json = JSON.stringify(estado.datos);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `academica-backup-${formatearFechaArchivo(new Date())}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Delay antes de revocar el object URL: algunos navegadores (Safari en
  // particular) cancelan la descarga si se revoca demasiado rápido.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function datosParecenValidos(datos) {
  if (!datos || typeof datos !== "object" || Array.isArray(datos)) return false;
  return LLAVES_MINIMAS_DATOS_VALIDOS.every((llave) => llave in datos);
}

function importarDatosDesdeArchivo(archivo, elEstado) {
  const lector = new FileReader();
  lector.onload = () => {
    let datosImportados;
    try {
      datosImportados = JSON.parse(lector.result);
    } catch (err) {
      elEstado.textContent = "❌ Ese archivo no es un JSON válido. No se tocó nada.";
      return;
    }

    if (!datosParecenValidos(datosImportados)) {
      elEstado.textContent = "❌ Ese archivo no tiene la forma de un respaldo de esta app (le faltan campos básicos). No se tocó nada.";
      return;
    }

    const confirmado = window.confirm(
      "Esto va a REEMPLAZAR TODOS tus datos actuales (planes, semestres, notas, agenda, profesores, todo) por lo que hay en este archivo.\n\n" +
      "Esta acción no se puede deshacer desde la app. Si no exportaste un respaldo de lo que tenés ahora mismo, cancelá y hacelo primero.\n\n" +
      "¿Confirmás que querés continuar?"
    );
    if (!confirmado) {
      elEstado.textContent = "Importación cancelada — no se tocó nada.";
      return;
    }

    try {
      migrarDatosAntiguos(datosImportados);

      Object.keys(estado.datos).forEach((llave) => delete estado.datos[llave]);
      Object.assign(estado.datos, datosImportados);

      marcarCambioPendiente();

      elEstado.textContent = "✅ Datos importados. Recargando...";
      setTimeout(() => window.location.reload(), 700);
    } catch (err) {
      console.error("Error importando datos:", err);
      elEstado.textContent = "❌ Ocurrió un error aplicando el archivo. Por las dudas, recargá la página antes de seguir usando la app.";
    }
  };
  lector.onerror = () => {
    elEstado.textContent = "❌ No se pudo leer el archivo.";
  };
  lector.readAsText(archivo);
}

function renderizarSeccionDatos() {
  const contenedor = document.getElementById("seccion-datos-respaldo");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  const panel = document.createElement("div");
  panel.className = "glass-panel";
  panel.style.cssText = "padding:12px; display:flex; flex-direction:column; gap:10px;";

  const explicacion = document.createElement("p");
  explicacion.className = "muted";
  explicacion.style.cssText = "font-size:0.8rem; margin:0;";
  explicacion.textContent = "Exportá un archivo .json con absolutamente todos tus datos (planes, semestres, notas, agenda, profesores, compañeros) para guardarlo como respaldo, o importá uno para restaurarlo.";
  panel.appendChild(explicacion);

  const filaBotones = document.createElement("div");
  filaBotones.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";

  const btnExportar = document.createElement("button");
  btnExportar.type = "button";
  btnExportar.className = "btn btn-secondary";
  btnExportar.style.cssText = "flex:1 1 160px;";
  btnExportar.textContent = "⬇️ Exportar datos (JSON)";
  filaBotones.appendChild(btnExportar);

  const btnImportar = document.createElement("button");
  btnImportar.type = "button";
  btnImportar.className = "btn btn-danger";
  btnImportar.style.cssText = "flex:1 1 160px;";
  btnImportar.textContent = "⬆️ Importar datos (JSON)";
  filaBotones.appendChild(btnImportar);

  panel.appendChild(filaBotones);

  const inputArchivo = document.createElement("input");
  inputArchivo.type = "file";
  inputArchivo.accept = "application/json,.json";
  inputArchivo.hidden = true;
  panel.appendChild(inputArchivo);

  const estadoTexto = document.createElement("p");
  estadoTexto.className = "muted";
  estadoTexto.style.cssText = "font-size:0.78rem; margin:0; min-height:1em;";
  panel.appendChild(estadoTexto);

  btnExportar.addEventListener("click", () => {
    exportarDatos();
    estadoTexto.textContent = "✅ Descarga iniciada.";
  });

  btnImportar.addEventListener("click", () => {
    estadoTexto.textContent = "";
    inputArchivo.value = "";
    inputArchivo.click();
  });

  inputArchivo.addEventListener("change", () => {
    const archivo = inputArchivo.files && inputArchivo.files[0];
    if (!archivo) return;
    estadoTexto.textContent = "Leyendo archivo...";
    importarDatosDesdeArchivo(archivo, estadoTexto);
  });

  contenedor.appendChild(panel);
}

/**
 * Ajustes — Liberar espacio (borrado en lote de adjuntos): solo se muestra
 * si hayAdjuntosGuardados() dice que hay algo para borrar — si no, el
 * contenedor #seccion-liberar-espacio queda vacío y oculto (ver el "oculto"
 * ya presente en el markup de index.html).
 *
 * Dos modos:
 *   - Por semestre (selector): "Cronograma" (adjuntos de materia —
 *     cronograma, reglas, libros) y "Tareas" (adjuntos de EventoAgenda de
 *     ese semestre) por separado, más un botón "Borrar todo este semestre"
 *     que hace ambos de una.
 *   - Global, sin selector: eventos sueltos (no asociados a ningún
 *     semestre).
 *
 * Cada botón pide confirmación (mismo patrón que el resto de la app,
 * abrirConfirmacion) antes de borrar — es destructivo e irreversible (borra
 * también el archivo real en Drive, no solo la referencia local).
 */
function renderizarSeccionLiberarEspacio() {
  const contenedor = document.getElementById("seccion-liberar-espacio");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  if (!hayAdjuntosGuardados()) {
    contenedor.classList.add("oculto");
    return;
  }
  contenedor.classList.remove("oculto");

  const panel = document.createElement("div");
  panel.className = "glass-panel";
  panel.style.cssText = "padding:12px; display:flex; flex-direction:column; gap:10px;";

  const titulo = document.createElement("span");
  titulo.className = "form-label";
  titulo.textContent = "Liberar espacio";
  panel.appendChild(titulo);

  const explicacion = document.createElement("p");
  explicacion.className = "muted";
  explicacion.style.cssText = "font-size:0.8rem; margin:0;";
  explicacion.textContent =
    "Borra en lote los archivos y enlaces adjuntos que ya no necesitás. Esto borra también el archivo real en tu Drive — no se puede deshacer.";
  panel.appendChild(explicacion);

  const estadoTexto = document.createElement("p");
  estadoTexto.className = "muted";
  estadoTexto.style.cssText = "font-size:0.78rem; margin:0; min-height:1em;";

  function confirmarYBorrar({ titulo, mensaje, accion }) {
    abrirConfirmacion({
      titulo,
      mensaje,
      textoConfirmar: "Borrar",
      onConfirmar: async () => {
        estadoTexto.textContent = "Borrando…";
        try {
          await accion();
          estadoTexto.textContent = "✅ Listo.";
          renderizarSeccionLiberarEspacio();
        } catch (err) {
          console.error("Error liberando espacio:", err);
          estadoTexto.textContent = "❌ No se pudo completar el borrado. Intenta de nuevo.";
        }
      },
    });
  }

  // --- Por semestre ---
  const semestres = obtenerSemestresOrdenCronologico();
  if (semestres.length > 0) {
    const filaSelector = document.createElement("div");
    filaSelector.style.cssText = "display:flex; flex-direction:column; gap:6px;";

    const etiquetaSelector = document.createElement("span");
    etiquetaSelector.className = "muted";
    etiquetaSelector.style.fontSize = "0.78rem";
    etiquetaSelector.textContent = "Por semestre:";
    filaSelector.appendChild(etiquetaSelector);

    const selectSemestre = document.createElement("select");
    selectSemestre.className = "input";
    semestres.forEach((semestre) => {
      const opt = document.createElement("option");
      opt.value = semestre.id;
      opt.textContent = semestre.nombre;
      selectSemestre.appendChild(opt);
    });
    filaSelector.appendChild(selectSemestre);

    const filaBotonesSemestre = document.createElement("div");
    filaBotonesSemestre.style.cssText = "display:flex; gap:8px; flex-wrap:wrap;";

    const btnCronograma = document.createElement("button");
    btnCronograma.type = "button";
    btnCronograma.className = "btn btn-secondary";
    btnCronograma.style.cssText = "flex:1 1 140px;";
    btnCronograma.textContent = "Cronograma";
    btnCronograma.addEventListener("click", () => {
      const semestre = semestres.find((s) => s.id === selectSemestre.value);
      if (!semestre) return;
      confirmarYBorrar({
        titulo: "Borrar adjuntos de Cronograma",
        mensaje: `¿Borrar todos los archivos y enlaces adjuntos del Cronograma (materia) de "${semestre.nombre}"? Esta acción no se puede deshacer.`,
        accion: () => eliminarAdjuntosDeCronogramaDeSemestre(semestre.id),
      });
    });
    filaBotonesSemestre.appendChild(btnCronograma);

    const btnTareas = document.createElement("button");
    btnTareas.type = "button";
    btnTareas.className = "btn btn-secondary";
    btnTareas.style.cssText = "flex:1 1 140px;";
    btnTareas.textContent = "Tareas";
    btnTareas.addEventListener("click", () => {
      const semestre = semestres.find((s) => s.id === selectSemestre.value);
      if (!semestre) return;
      confirmarYBorrar({
        titulo: "Borrar adjuntos de Tareas",
        mensaje: `¿Borrar todos los archivos y enlaces adjuntos de las tareas de "${semestre.nombre}"? Esta acción no se puede deshacer.`,
        accion: () => eliminarAdjuntosDeTareasDeSemestre(semestre.id),
      });
    });
    filaBotonesSemestre.appendChild(btnTareas);

    const btnTodoSemestre = document.createElement("button");
    btnTodoSemestre.type = "button";
    btnTodoSemestre.className = "btn btn-danger";
    btnTodoSemestre.style.cssText = "flex:1 1 140px;";
    btnTodoSemestre.textContent = "Todo el semestre";
    btnTodoSemestre.addEventListener("click", () => {
      const semestre = semestres.find((s) => s.id === selectSemestre.value);
      if (!semestre) return;
      confirmarYBorrar({
        titulo: "Borrar todos los adjuntos del semestre",
        mensaje: `¿Borrar TODOS los archivos y enlaces adjuntos (Cronograma y Tareas) de "${semestre.nombre}"? Esta acción no se puede deshacer.`,
        accion: () => eliminarAdjuntosDeSemestre(semestre.id),
      });
    });
    filaBotonesSemestre.appendChild(btnTodoSemestre);

    filaSelector.appendChild(filaBotonesSemestre);
    panel.appendChild(filaSelector);
  }

  // --- Global, sin selector ---
  const filaGlobal = document.createElement("div");
  filaGlobal.style.cssText = "display:flex; flex-direction:column; gap:6px;";

  const etiquetaGlobal = document.createElement("span");
  etiquetaGlobal.className = "muted";
  etiquetaGlobal.style.fontSize = "0.78rem";
  etiquetaGlobal.textContent = "Eventos sueltos (no asociados a un semestre):";
  filaGlobal.appendChild(etiquetaGlobal);

  const btnEventosSueltos = document.createElement("button");
  btnEventosSueltos.type = "button";
  btnEventosSueltos.className = "btn btn-danger btn-block";
  btnEventosSueltos.textContent = "Borrar adjuntos de eventos sueltos";
  btnEventosSueltos.addEventListener("click", () => {
    confirmarYBorrar({
      titulo: "Borrar adjuntos de eventos sueltos",
      mensaje: "¿Borrar todos los archivos y enlaces adjuntos de eventos que no pertenecen a ningún semestre? Esta acción no se puede deshacer.",
      accion: () => eliminarAdjuntosDeEventosSueltos(),
    });
  });
  filaGlobal.appendChild(btnEventosSueltos);

  panel.appendChild(filaGlobal);
  panel.appendChild(estadoTexto);

  contenedor.appendChild(panel);
}

/**
 * Ajustes por Universidad (2026-08-08) — una tarjeta por CADA plan que el
 * usuario tenga creado (no solo los activos de Modo Hardcore: si mañana
 * reactiva uno, ya tiene todo configurado). Cada tarjeta edita 3 cosas del
 * plan, las 3 con efecto inmediato (sellarTimestamp + marcarCambioPendiente
 * al toque, mismo patrón que el resto de Ajustes):
 *
 *  - Escala de notas (`parametros_universidad.escala_notas`): selector
 *    desplegable con TODAS las opciones de ESCALAS_DISPONIBLES (schema.js).
 *    Reemplaza al viejo pill de escala GLOBAL — ver nota en renderizarAjustes.
 *    Cambiar de escala acá NUNCA reescribe notas ya cargadas: las
 *    asignaciones siguen guardando su nota cruda tal cual se tipeó, y el
 *    motor de cálculo simplemente la reinterpreta contra la escala vigente
 *    en el momento de calcular (ver obtenerEscalaNotasMateria) — por eso el
 *    cambio de escala es reversible infinitas veces sin perder ni corromper
 *    ningún dato ya registrado.
 *
 *  - Nota de aprobación (`parametros_universidad.nota_aprobacion`): el
 *    ALMACENAMIENTO sigue siendo 0-100 SIEMPRE (nota_final de una materia
 *    ya es internamente 0-100 pase lo que pase por la escala de captura —
 *    ver calcularPuntosAsignacion en schema.js), pero la UI ahora la
 *    MUESTRA y la EDITA en la escala elegida en la misma tarjeta.
 *
 *    FIX (reporte "puse escala 0-10 y de 36 pasó a 360"): antes este campo
 *    mostraba/aceptaba SIEMPRE el número crudo en 0-100, sin importar la
 *    escala del select de al lado — así que escribir "7" pensando en una
 *    escala 0-10 en realidad guardaba 7/100 (un 7% de aprobación), y
 *    cualquier lectura posterior contra esa escala multiplicaba en vez de
 *    dividir el número mostrado (36 → 360 es exactamente ×10, el factor
 *    entre 0-100 y 0-10). Ahora `convertirA100`/`convertirDesde100` son el
 *    único punto de conversión entre "lo que se ve" (en la escala activa)
 *    y "lo que se guarda" (siempre 0-100) — ver más abajo.
 *
 *  - Redondeo al 5 más cercano (`parametros_universidad.redondeo_activo`):
 *    switch — existía en el schema desde Fase 6.2 pero nunca tuvo control
 *    en la UI a pesar del comentario "editable en Ajustes".
 *
 *  - "Pasás raspando con": AHORA EDITABLE a mano (antes era de solo
 *    lectura, calculado siempre desde nota_aprobacion). Al escribir un
 *    valor a mano se guarda como override explícito
 *    (`parametros_universidad.raspando_override`, en la MISMA escala que
 *    nota_aprobacion — 0-100 interno, mostrado en la escala activa); al
 *    vaciar el campo, vuelve a calcularse solo desde nota_aprobacion (ver
 *    calcularObjetivoPasarRaspando en schema.js). Esto reabre, a pedido
 *    explícito, la decisión de 2026-08-03 de no tener un número aparte —
 *    ver el comentario en schema.js junto a calcularObjetivoPasarRaspando
 *    para el razonamiento original, que ya no aplica tal cual.
 *
 * LAYOUT (pedido explícito): el switch de redondeo queda SIEMPRE en la
 * misma posición vertical, tanto apagado como encendido — antes vivía
 * junto al texto "Redondear al 5 más cercano" en una fila que solo
 * aparecía cuando había espacio, y el bloque de "Pasás raspando con"
 * empujaba todo hacia abajo al aparecer. Ahora la estructura es fija:
 *   1. Fila superior: "Redondear" + el switch, siempre en el mismo lugar.
 *   2. Fila inferior: "Pasás raspando con" — se muestra/oculta con
 *      classList.toggle("oculto", ...) en vez de sacarla del DOM, así el
 *      switch de arriba nunca se reacomoda cuando esta fila aparece o
 *      desaparece.
 */
function formatearNumeroCorto(numero) {
  const n = Number(numero);
  if (!Number.isFinite(n)) return "—";
  // Fase 6.2: algunas escalas (gpa4) usan 1 decimal con sentido real —
  // toFixed(2) fijo aplastaba esa precisión visualmente sin necesidad
  // (ej. "3.7" se mostraba "3.70", no es un error pero no hace falta).
  // Se conserva el toFixed(2)+Number() de siempre para no romper el
  // formato ya usado en el resto de la tarjeta; solo se le quitan ceros
  // de más al final, igual que antes.
  return Number(n.toFixed(2)).toString();
}

/**
 * FIX (reporte "puse escala 0-10 y de 36 pasó a 360"): `nota_aprobacion`
 * (y ahora `raspando_override`) siempre se GUARDAN en 0-100 — es la unidad
 * interna estable de todo el motor de notas (ver docblock de arriba). Pero
 * mostrarle a la persona ese número crudo sin convertirlo a la escala que
 * ELLA eligió en el selector de al lado no tiene sentido: en una escala
 * 0-10, "nota de aprobación 70" (70/100) debe leerse y escribirse como
 * "7" (7/10), no como "70". Estas dos funciones son el ÚNICO punto de
 * conversión entre "lo que se ve en el input" (en la escala activa) y "lo
 * que se guarda" (siempre 0-100) — todo el resto de la tarjeta pasa por
 * acá, nunca lee/escribe el crudo directo salvo estas dos.
 *
 * "letras" no tiene una conversión numérica razonable (A+/A/A-/... no son
 * un rango 0-N) — para esa escala el campo sigue mostrando/guardando
 * directo en 0-100, sin convertir (mismo comportamiento que ya existía
 * antes de este fix).
 */
function convertirA100(valorEnEscala, escala) {
  const n = Number(valorEnEscala);
  if (!Number.isFinite(n)) return NaN;
  if (!escala || escala.tipo === "letras" || !escala.max) return n;
  return (n / escala.max) * 100;
}
function convertirDesde100(valorEn100, escala) {
  const n = Number(valorEn100);
  if (!Number.isFinite(n)) return NaN;
  if (!escala || escala.tipo === "letras" || !escala.max) return n;
  return (n / 100) * escala.max;
}

function renderizarNotasAprobacion() {
  const contenedor = document.getElementById("seccion-notas-aprobacion");
  if (!contenedor) return;
  contenedor.innerHTML = "";

  const planes = estado.datos.planes_estudio || [];
  if (planes.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no tenés ningún plan de estudios creado.";
    contenedor.appendChild(vacio);
    return;
  }

  planes.forEach((plan) => {
    plan.parametros_universidad = plan.parametros_universidad || {};

    const tarjeta = document.createElement("div");
    tarjeta.className = "glass-panel";
    tarjeta.style.cssText = "padding:12px; margin-bottom:10px;";

    const titulo = document.createElement("p");
    titulo.style.cssText = "margin:0 0 8px; font-weight:700; font-size:0.9rem;";
    titulo.textContent = `${plan.universidad.siglas} · ${aplicarFormatoTexto(plan.nombre_carrera)}`;
    tarjeta.appendChild(titulo);

    // Escala activa de ESTE plan — se resuelve una sola vez acá arriba
    // porque tanto el input de aprobación como el de raspando dependen de
    // ella para convertir a/desde 0-100 (ver convertirA100/convertirDesde100).
    let escalaActiva = obtenerEscalaPorId(plan.parametros_universidad.escala_notas ?? 100);

    const fila = document.createElement("div");
    fila.style.cssText = "display:flex; flex-wrap:wrap; gap:10px;";

    // Bloque 1: escala de notas (selector desplegable — NO switch de 2
    // opciones, tiene que caber cualquier cantidad de escalas)
    const bloqueEscala = document.createElement("div");
    bloqueEscala.style.cssText = "flex:1 1 140px;";
    const labelEscala = document.createElement("label");
    labelEscala.className = "muted";
    labelEscala.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    labelEscala.textContent = "Escala de notas";
    const selectEscala = document.createElement("select");
    selectEscala.hidden = true;
    selectEscala.setAttribute("aria-hidden", "true");
    selectEscala.tabIndex = -1;
    ESCALAS_DISPONIBLES.forEach((escala) => {
      const opt = document.createElement("option");
      opt.value = String(escala.id);
      opt.textContent = escala.etiqueta;
      selectEscala.appendChild(opt);
    });
    selectEscala.value = String(plan.parametros_universidad.escala_notas ?? 100);

    // v1.15.11 (2026-08-08 — el <select> nativo seguía viéndose feo pese al
    // CSS anterior: el popup de <option> lo pinta cada navegador con SU
    // propio criterio — color-scheme/background-color en <option> es, en la
    // práctica, territorio no confiable entre Chrome/Firefox/Safari. En vez
    // de seguir peleando con eso, el <select> de arriba queda oculto como
    // única fuente de verdad (mantiene .value y dispara 'change' normal,
    // así el resto del archivo no cambia un carácter), y la parte VISIBLE
    // es este botón + lista propios, 100% CSS nuestro — mismo look que
    // cualquier otro elemento del tema, sin sorpresas de navegador.
    const dropdownEscala = document.createElement("div");
    dropdownEscala.className = "select-custom";
    const botonEscala = document.createElement("button");
    botonEscala.type = "button";
    botonEscala.className = "form-input select-custom-boton";
    const escalaInicial = ESCALAS_DISPONIBLES.find((e) => String(e.id) === selectEscala.value);
    botonEscala.textContent = escalaInicial ? escalaInicial.etiqueta : "Elegir escala";
    const listaEscala = document.createElement("ul");
    listaEscala.className = "select-custom-lista oculto";

    // v1.15.12 (2026-08-08 — "la lista no tiene fondo / se mete detrás de
    // la tarjeta siguiente"): las tarjetas usan glass-panel (backdrop-filter),
    // y eso crea un contexto de apilamiento PROPIO por tarjeta — ningún
    // z-index adentro de esta tarjeta puede ganarle a la tarjeta de al
    // lado, sin importar qué tan alto sea (limitación real de CSS, no
    // cuestión de subir el número). La solución es sacar la lista de la
    // tarjeta por completo mientras está abierta: se reparenta a
    // document.body (con posición calculada acá, en JS, según dónde esté
    // el botón en pantalla) y vuelve a su lugar original al cerrarse — así
    // nunca queda flotando huérfana si la sección de Ajustes se
    // re-renderiza mientras está cerrada.
    function posicionarListaEscala() {
      const r = botonEscala.getBoundingClientRect();
      listaEscala.style.position = "fixed";
      listaEscala.style.top = `${r.bottom + 6}px`;
      listaEscala.style.left = `${r.left}px`;
      listaEscala.style.width = `${r.width}px`;
    }
    function cerrarListaEscala() {
      listaEscala.classList.add("oculto");
      botonEscala.setAttribute("aria-expanded", "false");
      if (listaEscala.parentElement === document.body) dropdownEscala.appendChild(listaEscala);
      window.removeEventListener("scroll", cerrarSiScrollExterno, true);
      window.removeEventListener("resize", cerrarListaEscala);
    }
    // FIX (2026-08-08 — "el scroll no funciona, se sale del selector"): el
    // listener de scroll usa capture:true a propósito (scroll no burbujea,
    // así que es la única forma de enterarse de un scroll en CUALQUIER
    // contenedor de la página) — pero eso también lo hace disparar con el
    // scroll INTERNO de la propia lista (su overflow-y:auto), cerrándola
    // apenas la persona intentaba usar la rueda o arrastrar la scrollbar.
    // Este wrapper ignora los eventos que se originan adentro de la lista.
    function cerrarSiScrollExterno(e) {
      if (listaEscala.contains(e.target)) return;
      cerrarListaEscala();
    }
    function abrirListaEscala() {
      // Solo puede haber un dropdown propio abierto a la vez en toda la
      // pantalla — cierra cualquier otro antes de abrir este (incluye
      // repatriar cualquier lista de OTRA tarjeta que haya quedado en body).
      document.querySelectorAll(".select-custom-lista").forEach((l) => {
        if (l !== listaEscala) {
          l.classList.add("oculto");
          if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
        }
      });
      listaEscala._volverA = dropdownEscala;
      document.body.appendChild(listaEscala);
      posicionarListaEscala();
      listaEscala.classList.remove("oculto");
      botonEscala.setAttribute("aria-expanded", "true");
      // Cerrar al hacer scroll de la PÁGINA (adentro o afuera de la
      // tarjeta) o al cambiar el tamaño de ventana — reposicionar en vivo
      // agregaría complejidad para un dropdown que en general se usa y se
      // suelta rápido; cerrar es más predecible que dejarlo desalineado.
      // El scroll DENTRO de la lista (para ver más opciones) queda afuera
      // de esto — ver cerrarSiScrollExterno.
      window.addEventListener("scroll", cerrarSiScrollExterno, true);
      window.addEventListener("resize", cerrarListaEscala);
    }

    ESCALAS_DISPONIBLES.forEach((escala) => {
      const item = document.createElement("li");
      item.className = "select-custom-opcion";
      item.textContent = escala.etiqueta;
      if (String(escala.id) === selectEscala.value) item.classList.add("activa");
      item.addEventListener("click", () => {
        selectEscala.value = String(escala.id);
        botonEscala.textContent = escala.etiqueta;
        listaEscala.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
        item.classList.add("activa");
        cerrarListaEscala();
        // El <select> oculto sigue siendo el dueño real del valor — acá
        // solo se dispara el evento que ya escucha el resto del código,
        // como si el cambio hubiera venido de un <select> normal.
        selectEscala.dispatchEvent(new Event("change"));
      });
      listaEscala.appendChild(item);
    });
    botonEscala.setAttribute("aria-expanded", "false");
    botonEscala.addEventListener("click", (e) => {
      e.stopPropagation();
      if (listaEscala.classList.contains("oculto")) abrirListaEscala();
      else cerrarListaEscala();
    });
    document.addEventListener("click", (e) => {
      if (!dropdownEscala.contains(e.target) && !listaEscala.contains(e.target)) {
        cerrarListaEscala();
      }
    });
    dropdownEscala.appendChild(botonEscala);
    dropdownEscala.appendChild(listaEscala);
    dropdownEscala.appendChild(selectEscala);

    bloqueEscala.appendChild(labelEscala);
    bloqueEscala.appendChild(dropdownEscala);
    fila.appendChild(bloqueEscala);

    // Bloque 2: nota de aprobación — mostrada y editada en la escala
    // activa (ver FIX arriba), guardada siempre en 0-100.
    const bloqueAprobacion = document.createElement("div");
    bloqueAprobacion.style.cssText = "flex:1 1 140px;";
    const labelAprobacion = document.createElement("label");
    labelAprobacion.className = "muted";
    labelAprobacion.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    const inputAprobacion = document.createElement("input");
    inputAprobacion.type = "number";
    inputAprobacion.className = "form-input";
    inputAprobacion.style.width = "100%";

    function actualizarLimitesAprobacion() {
      const esLetras = escalaActiva.tipo === "letras";
      labelAprobacion.textContent = esLetras ? "Nota de aprobación (0–100)" : `Nota de aprobación (0–${formatearNumeroCorto(escalaActiva.max)})`;
      inputAprobacion.min = "0";
      inputAprobacion.max = esLetras ? "100" : String(escalaActiva.max);
      inputAprobacion.step = escalaActiva.paso ? String(escalaActiva.paso) : "0.1";
    }
    actualizarLimitesAprobacion();
    inputAprobacion.value = formatearNumeroCorto(convertirDesde100(plan.parametros_universidad.nota_aprobacion ?? 70, escalaActiva));

    bloqueAprobacion.appendChild(labelAprobacion);
    bloqueAprobacion.appendChild(inputAprobacion);
    fila.appendChild(bloqueAprobacion);

    tarjeta.appendChild(fila);

    // ---------- Fila fija: "Redondear" + switch, SIEMPRE en la misma
    // posición vertical (pedido explícito) — nunca se mueve al aparecer o
    // desaparecer "Pasás raspando con", que ahora vive en su PROPIA fila,
    // debajo, oculta/mostrada con classList.toggle en vez de agregarse o
    // quitarse del DOM. ----------
    const filaRedondeo = document.createElement("div");
    filaRedondeo.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:10px;";

    const labelSwitch = document.createElement("span");
    labelSwitch.style.cssText = "font-size:0.8rem;";
    // Pedido explícito: "Redondear al 5 más cercano" → "Redondear" (el
    // switch, justo al lado, ya deja claro qué se está prendiendo/apagando).
    labelSwitch.textContent = "Redondear";
    const labelToggle = document.createElement("label");
    labelToggle.className = "switch switch-tema";
    const chkRedondeo = document.createElement("input");
    chkRedondeo.type = "checkbox";
    chkRedondeo.checked = plan.parametros_universidad.redondeo_activo !== false;
    const trackRedondeo = document.createElement("span");
    trackRedondeo.className = "track";
    trackRedondeo.innerHTML = '<span class="thumb"></span>';
    labelToggle.appendChild(chkRedondeo);
    labelToggle.appendChild(trackRedondeo);
    filaRedondeo.appendChild(labelSwitch);
    filaRedondeo.appendChild(labelToggle);
    tarjeta.appendChild(filaRedondeo);

    // ---------- Fila propia para "Pasás raspando con" — debajo de la fila
    // fija de arriba, nunca la desplaza. Ahora EDITABLE (pedido explícito):
    // un valor escrito a mano queda como override explícito
    // (raspando_override, en la misma escala 0-100 interna que
    // nota_aprobacion); vaciar el campo vuelve al cálculo automático. ----------
    const bloqueRaspando = document.createElement("div");
    bloqueRaspando.style.cssText = "margin-top:10px;";
    const labelRaspando = document.createElement("label");
    labelRaspando.className = "muted";
    labelRaspando.style.cssText = "display:block; font-size:0.75rem; margin-bottom:4px;";
    labelRaspando.textContent = "Pasás raspando con";
    const inputRaspando = document.createElement("input");
    inputRaspando.type = "number";
    inputRaspando.className = "form-input";
    inputRaspando.style.width = "100%";
    bloqueRaspando.appendChild(labelRaspando);
    bloqueRaspando.appendChild(inputRaspando);
    tarjeta.appendChild(bloqueRaspando);

    function actualizarRaspando() {
      const activo = plan.parametros_universidad.redondeo_activo !== false;
      // classList.toggle("oculto", ...) en vez de sacar el elemento del
      // DOM (antes era display:none inline en un bloque que además vivía
      // en la MISMA fila que el switch, empujándolo hacia abajo al
      // aparecer) — así el layout de arriba (switch de Redondear) nunca
      // se reacomoda, sea cual sea el estado de esta fila.
      bloqueRaspando.classList.toggle("oculto", !activo);
      if (!activo) return;

      const esLetras = escalaActiva.tipo === "letras";
      inputRaspando.min = "0";
      inputRaspando.max = esLetras ? "100" : String(escalaActiva.max);
      inputRaspando.step = escalaActiva.paso ? String(escalaActiva.paso) : "0.1";

      const notaActual = Number(plan.parametros_universidad.nota_aprobacion) || 70;
      const tieneOverride = plan.parametros_universidad.raspando_override !== null
        && plan.parametros_universidad.raspando_override !== undefined;
      const valorEn100 = tieneOverride
        ? plan.parametros_universidad.raspando_override
        : calcularObjetivoPasarRaspando(notaActual);
      // No pisar lo que la persona está escribiendo AHORA MISMO — solo se
      // resincroniza el valor mostrado cuando el campo no tiene foco (ej.
      // al cambiar de escala, o al editar la nota de aprobación desde el
      // otro input).
      if (document.activeElement !== inputRaspando) {
        inputRaspando.value = formatearNumeroCorto(convertirDesde100(valorEn100, escalaActiva));
      }
    }
    actualizarRaspando();

    // ---------- Eventos ----------

    selectEscala.addEventListener("change", () => {
      // Los ids numéricos (7,10,12,...,100) viajan como string en
      // selectEscala.value — hay que volver a Number salvo para "letras"
      // y las escalas gpa*, que son ids de texto. Number("letras") da NaN,
      // así que el chequeo isNaN decide cuál de las dos ramas corresponde.
      const crudo = selectEscala.value;
      const comoNumero = Number(crudo);
      const escalaIdNueva = Number.isNaN(comoNumero) ? crudo : comoNumero;
      const escalaIdVieja = plan.parametros_universidad.escala_notas ?? 100;
      if (escalaIdNueva === escalaIdVieja) return;

      // FIX (2026-08-08 — ronda 4, bug real reportado: "nota en escala 10
      // sigue mostrando 37, no se convirtió" / "puntaje x10"): la versión
      // anterior de este handler NUNCA tocaba las notas ya cargadas —
      // decisión de diseño explícita que en la práctica dejaba las notas
      // viejas sin sentido apenas cambiabas de escala (ver el comentario
      // que reemplaza este). Ahora sí se migran de verdad, ANTES de pisar
      // el id guardado (se necesita la escala VIEJA para saber desde dónde
      // convertir) — ver migrarNotasAsignacionesEscalaPlan en schema.js.
      migrarNotasAsignacionesEscalaPlan(estado.datos, plan.id, escalaIdVieja, escalaIdNueva);

      plan.parametros_universidad.escala_notas = escalaIdNueva;
      escalaActiva = obtenerEscalaPorId(escalaIdNueva);
      sellarTimestamp(plan);
      marcarCambioPendiente();
      // Los DOS campos numéricos de esta tarjeta (aprobación y raspando) se
      // repintan igual que antes — su valor GUARDADO (0-100) no cambió,
      // solo su valor MOSTRADO depende de la escala recién elegida. Las
      // notas de las asignaciones, en cambio, SÍ se migraron arriba porque
      // están guardadas directo en unidades de escala, no en 0-100.
      actualizarLimitesAprobacion();
      inputAprobacion.value = formatearNumeroCorto(convertirDesde100(plan.parametros_universidad.nota_aprobacion ?? 70, escalaActiva));
      actualizarRaspando();
    });

    chkRedondeo.addEventListener("change", () => {
      plan.parametros_universidad.redondeo_activo = chkRedondeo.checked;
      sellarTimestamp(plan);
      marcarCambioPendiente();
      actualizarRaspando();
    });

    inputAprobacion.addEventListener("change", () => {
      let valorEnEscala = Number(inputAprobacion.value);
      const tope = escalaActiva.tipo === "letras" ? 100 : escalaActiva.max;
      if (!Number.isFinite(valorEnEscala)) valorEnEscala = convertirDesde100(70, escalaActiva);
      valorEnEscala = Math.min(Math.max(valorEnEscala, 0), tope);
      inputAprobacion.value = formatearNumeroCorto(valorEnEscala);
      // Conversión a la unidad de guardado (0-100) — ver FIX arriba. Este
      // es el punto exacto donde antes faltaba la conversión y el número
      // se guardaba crudo en la escala equivocada.
      plan.parametros_universidad.nota_aprobacion = convertirA100(valorEnEscala, escalaActiva);
      sellarTimestamp(plan);
      marcarCambioPendiente();
      actualizarRaspando();
    });

    inputRaspando.addEventListener("change", () => {
      const texto = inputRaspando.value.trim();
      if (texto === "") {
        // Campo vaciado a propósito: se vuelve al cálculo automático desde
        // nota_aprobacion — se borra el override en vez de guardar null,
        // así una fusión de sync entre dispositivos ve un campo que
        // realmente dejó de existir, no un null "editado a la nada".
        delete plan.parametros_universidad.raspando_override;
        sellarTimestamp(plan);
        marcarCambioPendiente();
        actualizarRaspando();
        return;
      }
      let valorEnEscala = Number(texto);
      const tope = escalaActiva.tipo === "letras" ? 100 : escalaActiva.max;
      if (!Number.isFinite(valorEnEscala)) {
        actualizarRaspando(); // input inválido: se descarta, se repinta el valor real
        return;
      }
      valorEnEscala = Math.min(Math.max(valorEnEscala, 0), tope);
      inputRaspando.value = formatearNumeroCorto(valorEnEscala);
      plan.parametros_universidad.raspando_override = convertirA100(valorEnEscala, escalaActiva);
      sellarTimestamp(plan);
      marcarCambioPendiente();
    });

    contenedor.appendChild(tarjeta);
  });
}

export {
  renderizarAjustes,
  renderizarSeccionBackupDrive,
  renderizarSeccionLiberarEspacio,
  aplicarModoRendimiento,
  DIAS_SEMANA_CONFIG,
};
