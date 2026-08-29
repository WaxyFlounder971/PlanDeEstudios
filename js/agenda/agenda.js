/* =========================================================================
   AGENDA — Núcleo
   Pills Lista/Calendario arriba de todo, header fijo debajo (nombre del
   semestre mostrado — tocable, abre el selector — + Agregar/Ajustes
   compactos) con un bloque dinámico que cambia según modo/vista (semana
   navegable + rango + Hoy en Semanal; "Ver días anteriores" + Hoy en Todo;
   solo Hoy en Calendario) + despacho entre las dos vistas. Esta vista
   (Lista) es cronológica: los 7 días de la semana mostrada, cada uno con
   sus materias inline y sus eventos/tareas/exámenes agrupados por tipo, con
   los días ya pasados colapsados bajo una flecha. La vista Calendario vive
   en agenda-calendario.js.
   ========================================================================= */

import { obtenerEstadoEfectivoSemestre, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirConfirmacion, desplazarYResaltarElemento } from "../ui/componentes.js";
import { obtenerSemestresOrdenCronologico } from "../semestres/semestres.js";
import { renderizarCalendarioAgenda } from "./agenda-calendario.js";
import { inicializarMateriaAgenda, renderizarMateriaAgenda } from "./agenda-materia.js";
import { construirSeccionMateriasDia, calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { abrirModalEventoAgenda, abrirTarjetaInfoEventoAgenda, inicializarModalAgendaEvento } from "./agenda-modal.js";
// Sincronización con Google Calendar (2026-08-25, reemplaza Web Push): al
// completar/des-completar desde el checkbox de la lista hay que espejar la
// misma sincronización que ya maneja agenda-modal.js
// (sincronizarEventoCalendario elimina el espejo si queda completada, o lo
// recrea/actualiza si vuelve a quedar pendiente) — ver
// core/notificaciones-calendario.js.
import { eliminarEventoCalendarizado, sincronizarEventoCalendario } from "../core/notificaciones-calendario.js";
import {
  esHoyFecha,
  esTareaVencida,
  formatearFechaISO,
  formatearHoraAmPm,
  formatearRangoSemanaAgenda,
  formatearTiempoRestanteHoy,
  obtenerDiasSemanaAgenda,
  obtenerEstiloEvento,
  obtenerFechaInicioSemanaAgenda,
  agendaVenceHoyMuestraHora,
  agendaVenceHoyMuestraRestante,
  obtenerRangoDiasAgendaTodo,
  obtenerSemestreActivoAgenda,
  obtenerSemestresSeleccionadosAgenda,
  tareaVenceHoy,
} from "./agenda-utils.js";
import { eliminarAdjunto, obtenerAdjuntosActivosDe, obtenerAdjuntosDe } from "../core/storage-adjuntos.js";

const ETIQUETA_TIPO = { evento: "Eventos", tarea: "Tareas", examen: "Exámenes" };
const ORDEN_TIPO = ["examen", "tarea", "evento"];

/**
 * Feature "filtro por estado" — pedido nuevo: 6 badges debajo del
 * encabezado de semana (Semanal y Todo), en este orden exacto. "Clase" no
 * es un `tipo` real de EventoAgenda (ver TIPOS_EVENTO_AGENDA en schema.js)
 * — es la sección de materias inline (construirSeccionMateriasDia); se
 * incluye acá igual porque el pedido es "un vistazo de qué se lleva" y las
 * materias son parte de ese vistazo. Los 6 ids son arbitrarios (no vienen
 * del schema) — nacen y viven acá.
 */
const ESTADOS_FILTRO_AGENDA = [
  { id: "clase", etiqueta: "Clase" },
  { id: "completado", etiqueta: "Completado" },
  { id: "pendiente", etiqueta: "Pendiente" },
  { id: "examen", etiqueta: "Examen" },
  { id: "evento", etiqueta: "Evento" },
  { id: "feriado", etiqueta: "Feriado" },
];

/** Set de ids activos ahora mismo — los 6 si `agendaFiltroEstados` sigue en
 * `null` ("en reposo"), o exactamente el array explícito ya tocado. */
function obtenerEstadosFiltroActivos() {
  if (Array.isArray(estado.agendaFiltroEstados)) return new Set(estado.agendaFiltroEstados);
  return new Set(ESTADOS_FILTRO_AGENDA.map((e) => e.id));
}

/**
 * `evento.completada` solo existe en `tarea` (ver comentario del campo en
 * schema.js) — Examen/Evento/Feriado no tienen estado de completado, así
 * que Completado/Pendiente no les aplica: se filtran únicamente por su
 * propio badge (Examen/Evento/Feriado), sin importar esos otros 2.
 */
function eventoPasaFiltroEstados(evento, activos) {
  if (evento.tipo === "tarea") return activos.has(evento.completada ? "completado" : "pendiente");
  if (evento.tipo === "examen") return activos.has("examen");
  if (evento.tipo === "evento") return activos.has(evento.es_feriado ? "feriado" : "evento");
  return true;
}

/**
 * Primer toque mientras está "en reposo" (los 6 activos, nadie tocó nada
 * todavía) AÍSLA — deja solo ese badge activo. Cualquier toque posterior
 * (ya con un array explícito, así termine con los 6 marcados de nuevo a
 * mano) es un toggle independiente de siempre: no vuelve a aislar. Mismo
 * comportamiento pedido explícitamente para que "marcar todos y sacar uno"
 * no tire abajo al resto.
 */
function alternarFiltroEstadoAgenda(id) {
  if (!Array.isArray(estado.agendaFiltroEstados)) {
    estado.agendaFiltroEstados = [id];
  } else {
    const idx = estado.agendaFiltroEstados.indexOf(id);
    if (idx >= 0) estado.agendaFiltroEstados.splice(idx, 1);
    else estado.agendaFiltroEstados.push(id);
    // Pedido: "si desactivo todas, automáticamente se reinicia, se prenden
    // todas en estado inactivo [= reposo], apenas presione una solo va a
    // estar esa presionada". Sin esto, apagar el último badge activo dejaba
    // un array vacío (activos.has(...) siempre false) y ocultaba TODO en vez
    // de volver al estado de reposo.
    if (estado.agendaFiltroEstados.length === 0) estado.agendaFiltroEstados = null;
  }
  renderizarAgendaInterno();
}

/**
 * Los 6 badges, todos con el mismo ancho (el del más largo — "Completado"),
 * centrados. El ancho se ecualiza DESPUÉS de insertarse en el DOM (ver
 * llamador) porque necesita el ancho real ya renderizado de cada uno.
 * "Clase" lleva su propia clase (rosa, ver estilo inyectado en
 * inicializarAgenda) porque no comparte color con ningún tipo existente.
 */
function construirBarraFiltroEstadosAgenda() {
  const activos = obtenerEstadosFiltroActivos();
  const barra = document.createElement("div");
  barra.className = "agenda-filtro-estados";
  const botones = ESTADOS_FILTRO_AGENDA.map(({ id, etiqueta }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `agenda-filtro-estado-btn agenda-filtro-estado-${id}` + (activos.has(id) ? " active" : "");
    btn.textContent = etiqueta;
    btn.addEventListener("click", () => alternarFiltroEstadoAgenda(id));
    barra.appendChild(btn);
    return btn;
  });
  requestAnimationFrame(() => {
    if (!botones[0]?.isConnected) return; // re-renderizado antes del frame — no tocar nodos viejos
    const maxAncho = Math.max(...botones.map((b) => b.offsetWidth));
    botones.forEach((b) => (b.style.minWidth = `${maxAncho}px`));
  });
  return barra;
}

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * visto en el resto de la app — hermano del bug ya documentado arriba en
 * asegurarFiltroMostrarMateriasInicializado, pero ahí el problema era leer
 * `estado.datos` en null; acá es directamente `estado` en su zona muerta
 * temporal): estas 5 líneas estaban a nivel de módulo. Se mueven a una
 * función lazy más, con el mismo patrón — llamada desde renderizarAgenda.
 */
function asegurarEstadoAgendaBaseInicializado() {
  // "lista" | "calendario" — cuál de las 2 vistas está activa ahora mismo
  // (ver pills #pills-agenda-vista).
  if (typeof estado.agendaVistaActiva === "undefined") estado.agendaVistaActiva = "lista";
  // Semanas de offset respecto a la semana de hoy que Lista (y el submodo
  // "Semanal" del Calendario, que la comparte a propósito) está mostrando.
  if (typeof estado.agendaOffsetSemana === "undefined") estado.agendaOffsetSemana = 0;
  // Ronda de ajustes visuales — punto 2: estado de sesión de
  // expandido/colapsado del bloque "‹ N días anteriores" (punto 8).
  if (typeof estado.agendaDiasPasadosExpandido === "undefined") estado.agendaDiasPasadosExpandido = false;
  // Punto 4: días adicionales hacia atrás que el control "Ver días
  // anteriores" del subheader de modo Todo va sumando al rango.
  if (typeof estado.agendaTodoDiasAtras === "undefined") estado.agendaTodoDiasAtras = 0;
  // Idea "varios semestres a la vez": qué semestres está mostrando Agenda.
  // `null`/`undefined` = "automático". Un array (incluso vacío) es una
  // selección EXPLÍCITA.
  if (typeof estado.agendaSemestresSeleccionados === "undefined") estado.agendaSemestresSeleccionados = null;
  // Feature "filtro por estado" (Clase/Completado/Pendiente/Examen/Evento/
  // Feriado, ver ESTADOS_FILTRO_AGENDA): `null` = "en reposo", los 6 están
  // activos y el PRÓXIMO toque sobre cualquier badge aísla ese uno solo
  // (ver alternarFiltroEstadoAgenda). Un array (incluso con los 6 ids
  // adentro) es una selección explícita — a partir de ahí cada toque es un
  // toggle normal, independiente del resto (pedido: "si pongo todos
  // marcados y quito uno no deben quitarse los demás"). Mismo patrón de
  // sesión (no persistente) que el resto de estado.agenda* de este bloque.
  if (typeof estado.agendaFiltroEstados === "undefined") estado.agendaFiltroEstados = null;
  // Feature "modo selección" (mantener presionado para borrar varias):
  // `agendaModoSeleccion` es el interruptor general, `agendaSeleccionIds`
  // los ids de EventoAgenda marcados mientras dura. Viven en `estado` (no
  // en una variable de módulo) por consistencia con el resto del archivo,
  // aunque en la práctica solo los toca agenda.js.
  if (typeof estado.agendaModoSeleccion === "undefined") estado.agendaModoSeleccion = false;
  if (typeof estado.agendaSeleccionIds === "undefined") estado.agendaSeleccionIds = [];
}
// Punto 10 + 12: arranca en el valor PERSISTENTE de Ajustes → Agenda
// (`agenda_mostrar_clases`, punto 12) pero solo para esta sesión: togglear
// acá (ventana de Filtros) nunca reescribe ese ajuste permanente.
//
// FIX URGENTE: esto vivía suelto en el top-level del módulo, corriendo
// contra estado.datos.configuracion sin ningún guard. Los imports de ES
// modules se evalúan de forma EAGER — en cuanto main.js hacía `import` de
// este archivo, esta línea corría YA, antes del login, con
// estado.datos === null todavía (recién se llena después de cargar la
// sesión). Eso tiraba un TypeError no capturado durante la evaluación del
// módulo, que cortaba en seco TODO lo que main.js hace después de sus
// imports — incluido el registro del Service Worker — dejando la app sin
// SW en NINGUNA carga y por lo tanto sin poder instalarse en Android
// (bug reportado). Ahora es una función lazy, llamada recién en el primer
// render real de Agenda (ver renderizarAgenda), momento en el que
// estado.datos ya está garantizado no-null.
function asegurarFiltroMostrarMateriasInicializado() {
  if (estado.agendaFiltroMostrarMaterias === undefined) {
    estado.agendaFiltroMostrarMaterias = estado.datos?.configuracion?.agenda_mostrar_clases !== false;
  }
}

// Mismo patrón/motivo que la función de arriba — perezosa a propósito,
// llamada recién en el primer render real (ver renderizarAgenda), nunca en
// el top-level del módulo. Ahora "Semanal"/"Todo" persiste entre cargas
// via `configuracion.agenda_filtro_modo` (ver el pill-group de arriba, que
// ya escribe ahí al tocarlo) — "semanal" si nunca se guardó nada todavía.
function asegurarFiltroModoAgendaInicializado() {
  if (estado.agendaFiltroModo === undefined) {
    estado.agendaFiltroModo = estado.datos?.configuracion?.agenda_filtro_modo || "semanal";
  }
}

/**
 * Rediseño núcleo Agenda — punto 6: intervalos vivos de los timers "vence
 * hoy" actualmente en pantalla. Se limpian al arrancar cada render de Lista
 * (ver renderizarAgendaInterno) para no acumular setInterval huérfanos
 * apuntando a nodos DOM ya descartados cada vez que se navega de semana o
 * se togglea el checkbox de completada.
 */
let intervalosVenceHoy = [];
function limpiarIntervalosVenceHoy() {
  intervalosVenceHoy.forEach((id) => clearInterval(id));
  intervalosVenceHoy = [];
}

function buscarEventoAgendaVivo(id) {
  return (estado.datos.agenda || []).find((ev) => ev.id === id) || null;
}

function construirBadgeMateria(evento) {
  const semestre = (estado.datos.semestres || []).find((s) => s.id === evento.semestre_id);
  const mm = semestre && (semestre.materias_matriculadas || []).find((m) => m.id === evento.materia_matriculada_id);
  if (!mm) return "";
  const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  return materia ? `<span class="muted" style="font-size:0.72rem;">${aplicarFormatoTexto(materia.nombre)}</span>` : "";
}

/**
 * Plan consolidado de Adjuntos — 📎 en la línea 2 de la tarjeta, junto al
 * badge de materia, visible sin tener que abrir el evento. Solo cuenta
 * ACTIVOS (obtenerAdjuntosActivosDe) — uno desactivado no debe generar
 * ruido acá, mismo criterio que ya usa la tarjeta de info del evento
 * (agenda-modal.js) para decidir qué pills mostrar.
 */
function construirBadgeAdjuntos(evento) {
  const cantidad = obtenerAdjuntosActivosDe("evento", evento.id).length;
  if (cantidad === 0) return "";
  return `<span class="muted" style="font-size:0.72rem;">📎 ${cantidad}</span>`;
}

/**
 * Punto 5: toggle del checkbox circular de "completada" — vive acá (no en
 * agenda-modal.js) porque no abre ningún modal, solo muta el campo y
 * refresca en el lugar; mismo patrón de "releer la entidad viva por id
 * antes de mutar" que usa agenda-modal.js (por si un sondeo remoto
 * reemplazó estado.datos mientras tanto).
 *
 * Ajustes vista Calendario — punto 4 (fix): antes llamaba directo a
 * renderizarAgendaInterno() (el render INTERNO de Lista nada más), a secas
 * porque hasta ahora el checkbox de "completada" solo vivía en items de
 * Lista. Ahora construirItemEvento (con este mismo checkbox) también se
 * reutiliza desde el detalle de día del Calendario (ver construirDetalleDia
 * en agenda-calendario.js) — tocar el check desde ahí con la llamada vieja
 * mutaba el dato pero refrescaba Lista (oculta) en vez del Calendario
 * (visible), dejando la UI desactualizada hasta el próximo render. Ahora usa
 * el despachador renderizarAgenda(), que ya sabe re-renderizar la vista que
 * esté activa en cada momento (mismo criterio que refrescarAgenda() en
 * agenda-modal.js tras guardar/borrar desde el modal).
 */
function alternarCompletadaEvento(eventoId) {
  const vivo = buscarEventoAgendaVivo(eventoId);
  if (!vivo) return;
  vivo.completada = !vivo.completada;
  sellarTimestamp(vivo);
  marcarCambioPendiente();
  renderizarAgenda();
  // FIX (bug reportado: "se muestran los elementos pero no sirve el check"
  // en Resumen): esto solo refrescaba Agenda. El dato SÍ se guardaba bien
  // (vivo.completada cambia acá arriba), pero cuando el checkbox tocado
  // vive dentro de una tarjeta de Resumen (construirItemEvento reutilizado
  // tal cual desde resumen.js), renderizarAgenda() no toca el DOM de
  // Resumen — así que ese checkbox concreto se quedaba visualmente igual
  // (sin la clase "marcada", sin el tachado) y parecía que el click no
  // hacía nada. Mismo patrón que refrescarAgenda() en agenda-modal.js
  // (llamado tras guardar/borrar desde el modal), que sí refresca los 2.
  window.renderizarResumen?.();
  sincronizarEventoCalendario(vivo);
}

/**
 * Ronda de ajustes visuales — punto 1: layout de tarjeta en 2 columnas
 * explícitas.
 *
 * Ronda de ajustes visuales #5: se saca el `align-items: flex-start` que
 * tenía este item — con la checkbox de "completada" ya centrada
 * verticalmente (align-self:center, ver .agenda-check-completada en
 * design-system.css), dejar el nombre anclado arriba contra una checkbox
 * centrada se notaba desalineado. Ahora usa el `align-items:center` por
 * defecto de `.agenda-item`, así checkbox, nombre y columna derecha quedan
 * todos centrados contra la misma línea media de la tarjeta.
 *
 * FIX bug reportado ("a veces no marca completada"): `item` (la tarjeta
 * entera) ERA un `<button>`, y el círculo de completada (otro `<button>`)
 * vivía anidado ADENTRO de ese botón. `<button>` dentro de `<button>` es
 * contenido inválido en HTML — acá no lo corregía el parser porque el árbol
 * se arma con createElement/appendChild, no parseando markup, así que
 * quedaba de verdad así en el DOM. Con 2 elementos interactivos superpuestos
 * el hit-testing táctil deja de ser confiable en todos los navegadores: en
 * la mayoría de los toques el dedo cae limpio sobre el círculo, pero un
 * toque cerca del borde (el círculo además es chico — de ahí el pedido de
 * agrandar el hitbox) a veces se resuelve contra el `<button>` ANCESTRO
 * (`item`) en vez del hijo (`check`). Ahí `check` nunca recibe el click,
 * nunca corre `alternarCompletadaEvento`, y en cambio se dispara el click de
 * `item`, que abre la tarjeta de info sin haber completado nada — de ahí que
 * la persona tuviera que entrar al detalle y completarla desde ahí (ese
 * checkbox sí es 100% confiable: es un único botón fijo del modal, no
 * anidado). Encaja con que no sea 100% reproducible (depende del punto
 * exacto del toque y de cómo cada navegador arbitra la superposición).
 * Fix: `item` deja de ser un `<button>` — pasa a un `<div role="button"
 * tabindex="0">` (con su propio keydown Enter/Espacio para no perder
 * accesibilidad de teclado). El círculo sigue siendo un `<button>` real,
 * pero ahora es hijo de un DIV, no de otro botón — deja de haber anidamiento
 * inválido y el navegador ya no tiene que arbitrar nada.
 *
 * Pedido "aumentar el hitbox de la bolita, que se vea igual": el círculo
 * visual no cambia (mismo `.agenda-check-completada` de siempre); el área
 * táctil se agranda con un `::before` invisible más grande que el botón
 * (ver el `<style>` inyectado en inicializarAgenda) — técnica estándar para
 * esto: el pseudo-elemento cuenta como parte del botón a efectos de click,
 * pero no pinta nada, así que visualmente no se nota.
 *
 * Modo selección (mantener presionado): mismo `item`, mismo `check`, ambos
 * revisan `estado.agendaModoSeleccion` al toque — ver
 * registrarPresionLargaSeleccion/alternarSeleccionAgenda más abajo.
 */
function construirItemEvento(evento) {
  const estilo = obtenerEstiloEvento(evento);

  const item = document.createElement("div");
  item.className = "agenda-item";
  item.setAttribute("role", "button");
  item.tabIndex = 0;
  item.style.borderLeft = `3px solid ${estilo.colorBorde}`;
  item.dataset.eventoId = evento.id;
  if (estado.agendaSeleccionIds.includes(evento.id)) item.classList.add("agenda-item-seleccionado");

  if (evento.tipo === "tarea") {
    const check = document.createElement("button");
    check.type = "button";
    check.className = "agenda-check-completada" + (evento.completada ? " marcada" : "");
    check.title = evento.completada ? "Marcar como pendiente" : "Marcar como completada";
    check.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (estado.agendaModoSeleccion) {
        alternarSeleccionAgenda(evento.id);
        return;
      }
      alternarCompletadaEvento(evento.id);
    });
    item.appendChild(check);
  }

  // Columna izquierda: nombre + materia vinculada (si tiene).
  const izquierda = document.createElement("span");
  izquierda.style.cssText = "flex:1; min-width:0; text-align:left; overflow-wrap:break-word;";
  izquierda.innerHTML = `
    <div style="font-weight:600; ${evento.completada ? "text-decoration:line-through; opacity:0.7;" : ""}">${evento.nombre || "(sin nombre)"}</div>
    <div style="display:flex; align-items:center; gap:6px;">${construirBadgeMateria(evento)}${construirBadgeAdjuntos(evento)}</div>
  `;
  item.appendChild(izquierda);

  item.appendChild(construirColumnaDerechaEvento(evento, estilo));

  item.addEventListener("click", () => {
    if (estado.agendaModoSeleccion) {
      alternarSeleccionAgenda(evento.id);
      return;
    }
    abrirTarjetaInfoEventoAgenda(evento.id);
  });
  item.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      item.click();
    }
  });

  registrarPresionLargaSeleccion(item, evento.id);

  return item;
}

/**
 * Feature "modo selección": mantener presionado ~500ms sobre una tarjeta
 * (cualquier tipo — tarea/examen/evento/feriado) activa el modo y la marca
 * seleccionada; a partir de ahí CUALQUIER toque corto sobre cualquier
 * tarjeta (acá o en el checkbox) suma/saca esa tarjeta de la selección en
 * vez de abrir el detalle o togglear completada (ver los 2 click handlers
 * de construirItemEvento). `pointerdown/up/leave/cancel` en vez de
 * touchstart/mousedown para cubrir mouse y touch con el mismo código.
 *
 * El listener de `click` en fase de CAPTURA (`{capture:true}`) es lo que
 * evita que, justo al activarse la presión larga, el click sintético que el
 * navegador dispara al soltar el dedo termine además abriendo el detalle o
 * alternando la selección una segunda vez — captura siempre corre antes que
 * los listeners en fase de burbuja del mismo elemento (los de arriba en
 * construirItemEvento), así que puede frenarlo con stopImmediatePropagation
 * antes de que lleguen a ejecutarse.
 */
const DURACION_PRESION_LARGA_MS = 500;
function registrarPresionLargaSeleccion(item, eventoId) {
  let temporizador = null;
  let activadaPorEsteToque = false;

  const cancelarTemporizador = () => {
    if (temporizador) clearTimeout(temporizador);
    temporizador = null;
  };

  item.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType === "mouse" && ev.button !== 0) return;
    activadaPorEsteToque = false;
    cancelarTemporizador();
    temporizador = setTimeout(() => {
      activadaPorEsteToque = true;
      estado.agendaModoSeleccion = true;
      if (!estado.agendaSeleccionIds.includes(eventoId)) estado.agendaSeleccionIds.push(eventoId);
      if (navigator.vibrate) navigator.vibrate(15);
      renderizarAgenda();
    }, DURACION_PRESION_LARGA_MS);
  });
  item.addEventListener("pointerup", cancelarTemporizador);
  item.addEventListener("pointerleave", cancelarTemporizador);
  item.addEventListener("pointercancel", cancelarTemporizador);
  item.addEventListener(
    "click",
    (ev) => {
      if (activadaPorEsteToque) {
        ev.stopImmediatePropagation();
        activadaPorEsteToque = false;
      }
    },
    { capture: true }
  );
}

/** Suma/saca `eventoId` de la selección actual; si queda vacía, sale sola
 * del modo selección (mismo criterio que "Cancelar" en la barra flotante). */
function alternarSeleccionAgenda(eventoId) {
  const idx = estado.agendaSeleccionIds.indexOf(eventoId);
  if (idx >= 0) estado.agendaSeleccionIds.splice(idx, 1);
  else estado.agendaSeleccionIds.push(eventoId);
  if (estado.agendaSeleccionIds.length === 0) estado.agendaModoSeleccion = false;
  renderizarAgenda();
}

function cancelarSeleccionAgenda() {
  estado.agendaModoSeleccion = false;
  estado.agendaSeleccionIds = [];
  renderizarAgenda();
}

/**
 * Borra TODOS los eventos seleccionados — mismo patrón que
 * confirmarBorrarEventoAgenda (agenda-modal.js) para un solo evento: pide
 * confirmación, limpia sus adjuntos, deja el tombstone en
 * `_eliminados_agenda` (lo necesita el sondeo remoto para no revivir el
 * evento si el otro dispositivo todavía no bajó este borrado), saca el
 * espejo de Google Calendar si tenía, y recién ahí lo saca de
 * estado.datos.agenda. Se re-lee cada evento por id vivo antes de tocarlo
 * (mismo criterio de "por si un sondeo remoto reemplazó estado.datos
 * mientras tanto" que usa el resto del proyecto).
 */
function confirmarEliminarSeleccionAgenda() {
  const ids = [...estado.agendaSeleccionIds];
  if (ids.length === 0) return;
  abrirConfirmacion({
    titulo: `¿Borrar ${ids.length} ${ids.length === 1 ? "elemento" : "elementos"}?`,
    mensaje: "Esta acción no se puede deshacer.",
    textoConfirmar: "Borrar",
    onConfirmar: () => {
      ids.forEach((id) => {
        const viva = buscarEventoAgendaVivo(id);
        if (!viva) return;
        obtenerAdjuntosDe("evento", viva.id).forEach((a) => eliminarAdjunto(a.id));
        estado.datos._eliminados_agenda = estado.datos._eliminados_agenda || [];
        estado.datos._eliminados_agenda.push({ id: viva.id, eliminadoEn: Date.now() });
        eliminarEventoCalendarizado(viva);
      });
      estado.datos.agenda = (estado.datos.agenda || []).filter((ev) => !ids.includes(ev.id));
      marcarCambioPendiente();
      estado.agendaModoSeleccion = false;
      estado.agendaSeleccionIds = [];
      renderizarAgenda();
    },
  });
}

/**
 * Barra flotante inferior (contador + Cancelar + Eliminar) — un solo nodo
 * fijo creado una vez (ver inicializarAgenda), no algo que cada render de
 * Lista/Calendario/Materia tenga que reconstruir; renderizarAgenda() la
 * sincroniza al final de CADA render, sea cual sea la vista activa, para
 * que sobreviva a cambiar de vista mientras hay una selección en curso.
 */
function inicializarBarraSeleccionAgenda() {
  if (document.getElementById("agenda-barra-seleccion")) return;
  const barra = document.createElement("div");
  barra.id = "agenda-barra-seleccion";
  barra.className = "agenda-barra-seleccion oculto";
  barra.innerHTML = `
    <span id="agenda-seleccion-contador" class="agenda-seleccion-contador"></span>
    <span style="flex:1;"></span>
    <button type="button" id="agenda-seleccion-cancelar" class="btn-discreto">Cancelar</button>
    <button type="button" id="agenda-seleccion-eliminar" class="agenda-btn-eliminar-seleccion">🗑 Eliminar</button>
  `;
  document.body.appendChild(barra);
  document.getElementById("agenda-seleccion-cancelar").addEventListener("click", cancelarSeleccionAgenda);
  document.getElementById("agenda-seleccion-eliminar").addEventListener("click", confirmarEliminarSeleccionAgenda);
}

function sincronizarBarraSeleccionAgenda() {
  const barra = document.getElementById("agenda-barra-seleccion");
  if (!barra) return;
  const activa = estado.agendaModoSeleccion && estado.agendaSeleccionIds.length > 0;
  barra.classList.toggle("oculto", !activa);
  if (activa) {
    const n = estado.agendaSeleccionIds.length;
    document.getElementById("agenda-seleccion-contador").textContent = `${n} ${n === 1 ? "seleccionada" : "seleccionadas"}`;
  }
}

/**
 * Columna derecha de un item (Vencida opcional -> badge de tipo -> hora/
 * tiempo restante). Se saca a su propia función porque el layout ahora
 * tiene 2 formas distintas según si hora Y tiempo restante coexisten (ver
 * más abajo) — separarla de construirItemEvento evita un solo bloque
 * gigante con ifs anidados.
 *
 * Fix del timer: antes formatearTiempoRestanteHoy siempre contaba contra
 * las 23:59:59, ahora se le pasa `evento.hora` para que apunte a la hora
 * puntual del evento cuando tiene una (ver agenda-utils.js).
 *
 * Pedido nuevo: cuando los 2 switches de "vence hoy" (hora + restante,
 * agendaVenceHoyMuestraHora/Restante) están ACTIVOS a la vez, se muestran
 * los DOS — en ese caso puntual el layout cambia a "cuadradito": línea 1 =
 * hora + badge de tipo lado a lado, línea 2 = tiempo restante debajo. En
 * cualquier otro caso (solo hora, solo restante, los 2 apagados, o no vence
 * hoy) se mantiene el layout de siempre: badge de tipo en su propia línea
 * arriba, hora/restante debajo (con los 2 apagados cae al mismo fallback de
 * mostrar la hora que ya se usaba para los días que no vencen hoy).
 */
function construirColumnaDerechaEvento(evento, estilo) {
  const vencida = esTareaVencida(evento);
  const venceHoy = tareaVenceHoy(evento);
  const mostrarHoraCfg = agendaVenceHoyMuestraHora();
  const mostrarRestanteCfg = agendaVenceHoyMuestraRestante();
  const mostrarRestante = venceHoy && mostrarRestanteCfg;
  const mostrarHoraJuntoABadge = venceHoy && mostrarHoraCfg && mostrarRestanteCfg;

  const derecha = document.createElement("span");
  derecha.className = "stack";
  derecha.style.cssText = "align-items:flex-end; gap:4px; flex-shrink:0; text-align:right;";

  if (vencida) {
    const badgeVencida = document.createElement("span");
    badgeVencida.className = "agenda-badge-vencida";
    badgeVencida.textContent = "⚠ Vencida";
    derecha.appendChild(badgeVencida);
  }

  const textoHora = evento.hora ? formatearHoraAmPm(evento.hora) : "Todo el día";

  if (mostrarHoraJuntoABadge) {
    // "Cuadradito": línea 1 hora+badge lado a lado, línea 2 tiempo restante.
    const filaHoraBadge = document.createElement("div");
    filaHoraBadge.className = "row";
    filaHoraBadge.style.cssText = "gap:6px; align-items:center; justify-content:flex-end;";
    filaHoraBadge.innerHTML = `
      <span class="muted" style="font-size:0.78rem; white-space:nowrap;">${textoHora}</span>
      <span class="badge agenda-badge-tipo ${estilo.claseBadge}">${estilo.etiqueta}</span>
    `;
    derecha.appendChild(filaHoraBadge);

    const restante = document.createElement("span");
    restante.className = "agenda-timer-vence-hoy";
    restante.style.cssText = "font-size:0.78rem; white-space:nowrap;";
    restante.textContent = formatearTiempoRestanteHoy(evento.fecha, evento.hora);
    derecha.appendChild(restante);
    registrarTimerVenceHoy(restante, evento);
  } else {
    // Layout de siempre: badge de tipo arriba, hora O restante debajo.
    const badgeTipo = document.createElement("span");
    badgeTipo.className = `badge agenda-badge-tipo ${estilo.claseBadge}`;
    badgeTipo.textContent = estilo.etiqueta;
    derecha.appendChild(badgeTipo);

    const linea = document.createElement("span");
    linea.className = "muted";
    linea.style.cssText = "font-size:0.78rem; white-space:nowrap;";
    if (mostrarRestante) {
      const restante = document.createElement("span");
      restante.className = "agenda-timer-vence-hoy";
      restante.textContent = formatearTiempoRestanteHoy(evento.fecha, evento.hora);
      linea.appendChild(restante);
      registrarTimerVenceHoy(restante, evento);
    } else {
      linea.textContent = textoHora;
    }
    derecha.appendChild(linea);
  }

  return derecha;
}

/**
 * Arranca el intervalo que refresca un span de "tiempo restante" cada
 * minuto, y lo registra en intervalosVenceHoy para que limpiarIntervalosVenceHoy
 * lo pueda apagar en el próximo render completo (mismo mecanismo de
 * siempre, ahora compartido entre las 2 formas de layout de arriba).
 */
function registrarTimerVenceHoy(span, evento) {
  const idIntervalo = setInterval(() => {
    if (!span.isConnected) {
      clearInterval(idIntervalo);
      return;
    }
    span.textContent = formatearTiempoRestanteHoy(evento.fecha, evento.hora);
  }, 60000);
  intervalosVenceHoy.push(idIntervalo);
}

function construirBloqueDia(diaInfo, semestresSeleccionados, mostrarDiasVacios, activosFiltro) {
  const fechaISO = formatearFechaISO(diaInfo.fecha);
  const eventosDelDia = (estado.datos.agenda || [])
    .filter((ev) => ev.fecha === fechaISO)
    // Varios semestres a la vez: cada semestre tiene su agenda aparte —
    // solo entran acá los eventos sin semestre asignado (datos de antes de
    // este cambio, o eventos creados sin semestre activo) o los que
    // coinciden con ALGUNO de los semestres que se están mostrando ahora
    // mismo (llega acá solo cuando hay al menos 1 seleccionado — ver el
    // guard de "Selecciona al menos un semestre" en renderizarAgendaInterno).
    .filter((ev) => !ev.semestre_id || semestresSeleccionados.some((s) => s.id === ev.semestre_id))
    // Feature "filtro por estado": ver eventoPasaFiltroEstados.
    .filter((ev) => eventoPasaFiltroEstados(ev, activosFiltro))
    .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

  if (!mostrarDiasVacios && eventosDelDia.length === 0) return null;

  const bloque = document.createElement("section");
  // Punto 5 (2026-08-23): antes usaba "glass-panel" (mismo tono reservado
  // para paneles secundarios/anidados, más tenue que una tarjeta normal —
  // ver --bg-panel en tema.js, siempre recede más hacia --bg-canvas que
  // --bg-card). Acá el bloque de cada día es el contenido PRINCIPAL de la
  // vista Lista (mismo rol que una celda de Calendario o una tarjeta de
  // Cronograma, ambas con "glass-card"), no un panel secundario — por eso
  // se veía visiblemente más lavado que el resto de la app. "glass-card"
  // iguala el tono al de las otras 2 vistas de Agenda.
  bloque.className = "glass-card stack";
  bloque.style.padding = "14px";
  // Ancla para el salto "Calendario -> Lista" (ver agenda-calendario.js,
  // saltarADiaEnLista) — así el clic en una celda del grid puede encontrar
  // y resaltar el bloque de ese día exacto con un simple selector.
  bloque.dataset.fecha = fechaISO;

  const hoy = esHoyFecha(diaInfo.fecha);
  const header = document.createElement("div");
  header.className = "row-between";
  header.innerHTML = `
    <div class="row" style="gap:8px;">
      <span style="font-weight:700;">${diaInfo.etiqueta}</span>
      <span class="muted" style="font-size:0.82rem;">${diaInfo.fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" })}</span>
    </div>
    ${hoy ? `<span class="badge badge-accent">Hoy</span>` : ""}
  `;
  bloque.appendChild(header);

  // FIX: el badge "Clase" del filtro (activosFiltro.has("clase")) no hacía
  // nada — eventoPasaFiltroEstados solo filtra estado.datos.agenda (tarea/
  // examen/evento/feriado); las materias vienen de un camino de render
  // aparte (construirSeccionMateriasDia) que antes se llamaba sin condición
  // ninguna. Ahora respeta AMBOS: el ajuste persistente de Ajustes →
  // Agenda (agendaFiltroMostrarMaterias, "siempre que Clase se muestre en
  // Agenda según ajustes") Y el badge de esta sesión.
  const seccionMaterias = estado.agendaFiltroMostrarMaterias && activosFiltro.has("clase")
    ? construirSeccionMateriasDia(semestresSeleccionados, diaInfo.fecha, diaInfo.abrevDefault)
    : null;
  if (seccionMaterias) bloque.appendChild(seccionMaterias);

  if (eventosDelDia.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; margin:2px 0 0;";
    vacio.textContent = "Sin pendientes.";
    bloque.appendChild(vacio);
  } else {
    ORDEN_TIPO.forEach((tipo) => {
      const delTipo = eventosDelDia.filter((ev) => ev.tipo === tipo);
      if (delTipo.length === 0) return;
      const grupo = document.createElement("div");
      grupo.className = "stack";
      grupo.style.gap = "6px";
      const etiqueta = document.createElement("span");
      etiqueta.className = "muted";
      etiqueta.style.cssText = "font-size:0.7rem; text-transform:uppercase; letter-spacing:0.02em;";
      etiqueta.textContent = ETIQUETA_TIPO[tipo];
      grupo.appendChild(etiqueta);
      delTipo.forEach((ev) => grupo.appendChild(construirItemEvento(ev)));
      bloque.appendChild(grupo);
    });
  }

  return bloque;
}

/**
 * Ronda de ajustes visuales #2 — punto C: atajo "Hoy" compartido por los 3
 * modos (Semanal, Todo, Calendario) — antes vivía en un solo lugar fijo del
 * header (#agenda-fecha-hoy) que hacía de "llevame a hoy sea cual sea la
 * vista"; ahora se reconstruye cada vez que se arma #agenda-subheader-
 * dinamico, así que se centraliza acá el mismo comportamiento (incluido el
 * caso "estoy en Todo o en Calendario" → vuelve a Lista/Semanal, que es lo
 * que la persona espera al tocar "Hoy").
 */
function irAHoyAgenda() {
  let necesitaRerender = false;
  if (estado.agendaVistaActiva !== "lista") {
    estado.agendaVistaActiva = "lista";
    necesitaRerender = true;
  }
  if (estado.agendaFiltroModo !== "semanal") {
    estado.agendaFiltroModo = "semanal";
    estado.agendaTodoDiasAtras = 0;
    necesitaRerender = true;
  }
  if (estado.agendaOffsetSemana !== 0) {
    estado.agendaOffsetSemana = 0;
    necesitaRerender = true;
  }
  if (necesitaRerender) renderizarAgenda();
  desplazarYResaltarElemento(`#agenda-lista-dias [data-fecha="${formatearFechaISO(new Date())}"]`);
}

function construirEnlaceHoyAgenda() {
  const hoy = document.createElement("span");
  hoy.className = "muted";
  hoy.style.cssText = "font-size:0.74rem; text-decoration:underline; cursor:pointer;";
  hoy.textContent = "Hoy";
  hoy.addEventListener("click", irAHoyAgenda);
  return hoy;
}

/**
 * Ronda de ajustes visuales #2 — punto C: encabezado unificado del modo
 * Semanal — antes esto eran 2 paneles separados: uno fijo arriba (Semestre
 * / "Semana N" / fecha de hoy, armado por renderizarHeaderAgenda) y otro
 * aparte dentro de la lista con las flechas ‹ › alrededor del RANGO de
 * fechas (construirSubheaderLista). Ahora es un solo bloque, inyectado en
 * #agenda-subheader-dinamico (adentro de #agenda-header): las flechas pasan
 * a rodear "Semana N" (no el rango), el rango de fechas queda como texto
 * informativo debajo, y "Hoy" cierra el bloque — mismo layout que pidió el
 * spec.
 */
function construirSubheaderSemanal(dias, semestreActivo) {
  const frag = document.createDocumentFragment();

  const filaSemana = document.createElement("div");
  filaSemana.className = "row";
  filaSemana.style.cssText = "align-items:center; justify-content:center; gap:6px;";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "btn-icono-fantasma";
  btnAnterior.style.fontSize = "1.3rem";
  btnAnterior.textContent = "‹";
  btnAnterior.addEventListener("click", () => {
    estado.agendaOffsetSemana -= 1;
    renderizarAgenda();
  });

  const numeroSemana = semestreActivo
    ? calcularNumeroSemanaParaFecha(semestreActivo, obtenerFechaInicioSemanaAgenda(estado.agendaOffsetSemana))
    : null;
  const etiquetaSemana = document.createElement("span");
  etiquetaSemana.className = "texto-encabezado-seccion";
  etiquetaSemana.textContent = numeroSemana ? `Semana ${numeroSemana}` : "Semana";

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "btn-icono-fantasma";
  btnSiguiente.style.fontSize = "1.3rem";
  btnSiguiente.textContent = "›";
  btnSiguiente.addEventListener("click", () => {
    estado.agendaOffsetSemana += 1;
    renderizarAgenda();
  });

  filaSemana.appendChild(btnAnterior);
  filaSemana.appendChild(etiquetaSemana);
  filaSemana.appendChild(btnSiguiente);

  // Ronda de ajustes visuales #3: rango de fechas y "Hoy" ahora comparten
  // una sola línea (antes eran 2 líneas sueltas) para que el bloque
  // central completo (esta fila + filaSemana arriba) quepa en las 2 líneas
  // que le corresponden dentro del header de 3 líneas — ver #agenda-header
  // en index.html.
  const filaRango = document.createElement("div");
  filaRango.className = "row";
  filaRango.style.cssText = "align-items:baseline; justify-content:center; gap:8px;";

  const rango = document.createElement("span");
  rango.className = "muted";
  rango.style.fontSize = "0.78rem";
  rango.textContent = formatearRangoSemanaAgenda(dias);

  filaRango.appendChild(rango);
  filaRango.appendChild(construirEnlaceHoyAgenda());

  frag.appendChild(filaSemana);
  frag.appendChild(filaRango);
  return frag;
}

/**
 * Header fijo: los nombres de los semestres mostrados, tocable (abre el
 * modal del selector — ver inicializarSelectorSemestreAgenda). El resto de
 * lo que antes vivía acá (Semana N, atajo a hoy) se movió al bloque
 * dinámico de abajo (construirSubheaderSemanal/construirEnlaceHoyAgenda),
 * que sí depende de qué modo/vista está activo.
 *
 * Varios semestres a la vez: con más de uno seleccionado se muestran todos
 * unidos con " · " (orden cronológico ascendente — el más antiguo primero,
 * mismo orden que devuelve obtenerSemestresSeleccionadosAgenda), ej.
 * "Semestre 2025-A · Semestre 2025-B". Si hay semestres creados pero
 * ninguno seleccionado (caso límite del array explícito vacío), el botón
 * lo deja claro en vez de mostrar un nombre viejo.
 */
function renderizarHeaderAgenda() {
  const seleccionados = obtenerSemestresSeleccionadosAgenda();
  const nombreEl = document.getElementById("agenda-nombre-semestre");
  if (!nombreEl) return;
  const hayAlgunSemestre = (estado.datos.semestres || []).length > 0;
  if (!hayAlgunSemestre) {
    nombreEl.textContent = "Sin semestres";
  } else if (seleccionados.length === 0) {
    nombreEl.textContent = "Elegir semestre";
  } else {
    nombreEl.textContent = seleccionados.map((s) => s.nombre || "Semestre").join(" · ");
  }
}

/**
 * Idea "varios semestres a la vez": tarjeta seleccionable de un semestre
 * dentro de #modal-agenda-semestres — actúa como botón toggle (no como link
 * de navegación, como era el popover viejo): tocarla suma/quita ese
 * semestre del conjunto que Agenda está mostrando, sin cerrar el modal, así
 * se pueden marcar varias de un tirón. El estado "seleccionada" se resalta
 * visualmente (ver .agenda-semestre-tarjeta.active en design-system.css).
 */
function construirTarjetaSemestreAgenda(semestre, seleccionado) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "agenda-semestre-tarjeta" + (seleccionado ? " active" : "");
  btn.setAttribute("aria-pressed", String(seleccionado));

  const esActual = obtenerEstadoEfectivoSemestre(semestre) === "actual";
  const inicio = new Date(semestre.fecha_inicio);
  const fechaTexto = isNaN(inicio.getTime()) ? "" : inicio.toLocaleDateString("es-CR", { month: "short", year: "numeric" });
  const subtitulo = [fechaTexto, esActual ? "Actual" : ""].filter(Boolean).join(" · ");

  btn.innerHTML = `
    <span class="agenda-semestre-tarjeta-check">✓</span>
    <span class="stack" style="gap:2px; text-align:left; min-width:0;">
      <span style="font-weight:700; overflow-wrap:break-word;">${semestre.nombre || "Semestre"}</span>
      ${subtitulo ? `<span class="muted" style="font-size:0.72rem;">${subtitulo}</span>` : ""}
    </span>
  `;
  btn.addEventListener("click", () => alternarSeleccionSemestreAgenda(semestre.id));
  return btn;
}

/**
 * Toggle de una tarjeta: resuelve la selección ACTUAL (automática si nunca
 * se tocó, o la explícita ya guardada) para partir de ahí, suma/quita el id
 * tocado, y la deja guardada como array explícito — a partir de acá,
 * aunque quede vacío, ya no vuelve a caer en el default automático esta
 * sesión (decisión confirmada: array vacío = Agenda vacía con mensaje, no
 * un fallback silencioso).
 */
function alternarSeleccionSemestreAgenda(semestreId) {
  const idsActuales = obtenerSemestresSeleccionadosAgenda().map((s) => s.id);
  const idx = idsActuales.indexOf(semestreId);
  if (idx >= 0) idsActuales.splice(idx, 1);
  else idsActuales.push(semestreId);
  estado.agendaSemestresSeleccionados = idsActuales;
  estado.agendaOffsetSemana = 0;
  poblarModalSemestresAgenda();
  renderizarAgenda();
}

/**
 * Puebla #modal-agenda-semestres con una tarjeta por semestre existente
 * (todos, no solo los actuales — el caso de uso explícito es poder marcar
 * un semestre pasado junto con el actual), más reciente primero. Se llama
 * de nuevo tras cada toggle (ver alternarSeleccionSemestreAgenda) para que
 * el resaltado ✓ de las tarjetas quede sincronizado sin tener que cerrar y
 * reabrir el modal.
 */
function poblarModalSemestresAgenda() {
  const cont = document.getElementById("agenda-semestres-tarjetas");
  if (!cont) return;
  cont.innerHTML = "";

  const semestres = obtenerSemestresOrdenCronologico().slice().reverse();
  if (semestres.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:6px 0;";
    vacio.textContent = "No hay semestres creados todavía.";
    cont.appendChild(vacio);
    return;
  }

  const seleccionadosIds = new Set(obtenerSemestresSeleccionadosAgenda().map((s) => s.id));
  semestres.forEach((s) => cont.appendChild(construirTarjetaSemestreAgenda(s, seleccionadosIds.has(s.id))));
}

function abrirModalSemestresAgenda() {
  poblarModalSemestresAgenda();
  document.getElementById("modal-agenda-semestres")?.classList.remove("oculto");
}

function cerrarModalSemestresAgenda() {
  document.getElementById("modal-agenda-semestres")?.classList.add("oculto");
}

/**
 * Punto 8: los días de la semana visible anteriores a hoy se agrupan bajo
 * un único toggle "‹ N días anteriores" (colapsado por default) en vez de
 * mostrarse cada uno suelto — al presionarlo se expanden todos juntos.
 * Recibe los bloques YA construidos (no fechas) porque el llamador ya tuvo
 * que decidir cuáles cuentan como "pasados" para el resto del layout.
 */
function construirColapsoDiasPasados(bloquesPasados) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "10px";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "agenda-colapso-pasados";
  const plural = bloquesPasados.length === 1 ? "día anterior" : "días anteriores";
  boton.innerHTML = `
    <span class="agenda-colapso-pasados-flecha">‹</span>
    <span>${bloquesPasados.length} ${plural}</span>
  `;

  const cuerpo = document.createElement("div");
  cuerpo.className = "stack" + (estado.agendaDiasPasadosExpandido ? "" : " oculto");
  cuerpo.style.gap = "14px";
  bloquesPasados.forEach((b) => cuerpo.appendChild(b));

  const flecha = boton.querySelector(".agenda-colapso-pasados-flecha");
  flecha.style.transform = estado.agendaDiasPasadosExpandido ? "rotate(180deg)" : "rotate(0deg)";

  boton.addEventListener("click", () => {
    estado.agendaDiasPasadosExpandido = !estado.agendaDiasPasadosExpandido;
    cuerpo.classList.toggle("oculto", !estado.agendaDiasPasadosExpandido);
    flecha.style.transform = estado.agendaDiasPasadosExpandido ? "rotate(180deg)" : "rotate(0deg)";
  });

  cont.appendChild(boton);
  cont.appendChild(cuerpo);
  return cont;
}

/**
 * Punto 10 (modo "Todo"): acá no hay "semana navegada" que retroceder/
 * avanzar, es un scroll libre continuo desde hoy.
 *
 * Ronda de ajustes visuales — punto 4: en vez de informar el rango con
 * texto fijo ("Desde hoy hasta el..."), hay un control "Ver días
 * anteriores" que suma semanas hacia atrás (estado.agendaTodoDiasAtras,
 * consumido por obtenerRangoDiasAgendaTodo — ver agenda-utils.js) cada vez
 * que se toca.
 *
 * Ronda de ajustes visuales #2 — punto E (fix): antes solo se podía
 * expandir, sin forma de volver atrás — agrega un segundo botón "Ocultar
 * días anteriores" (solo visible una vez que ya se expandió algo) que
 * colapsa de nuevo a 0. Ambos botones comparten ajustarDiasAtrasTodo(), que
 * hace el mismo ajuste de scroll en los 2 sentidos (agrandar arriba corre
 * todo hacia abajo, achicar arriba lo corre hacia arriba — misma resta,
 * signo distinto).
 */
function ajustarDiasAtrasTodo(nuevoValor) {
  const cont = document.getElementById("agenda-lista-dias");
  const scrollEl = document.scrollingElement || document.documentElement;
  const scrollAntes = scrollEl.scrollTop;
  const altoAntes = cont?.scrollHeight || 0;

  estado.agendaTodoDiasAtras = Math.max(0, nuevoValor);
  renderizarAgendaInterno();

  // El contenido nuevo/quitado se agrega o saca por ARRIBA de lo que ya
  // estaba, así que sin esto el navegador mantiene el mismo scrollTop en
  // píxeles y todo lo que la persona tenía a la vista se corre — se
  // compensa sumando exactamente lo que cambió el contenedor por encima
  // (positivo al expandir, negativo al colapsar).
  requestAnimationFrame(() => {
    const altoDespues = cont?.scrollHeight || 0;
    scrollEl.scrollTop = scrollAntes + (altoDespues - altoAntes);
  });
}

/**
 * Ronda de ajustes visuales #4 — fix: antes se agregaba "Ver días
 * anteriores" SIEMPRE y "Ocultar días anteriores" se sumaba aparte cuando
 * ya había algo expandido, así que una vez expandido quedaban los DOS
 * botones a la vez. Ahora es un solo botón que cambia de texto/acción
 * según el estado — mismo patrón if/else que el resto del proyecto usa
 * para alternar entre 2 acciones mutuamente excluyentes.
 */
/**
 * Ronda de ajustes visuales #5 — punto D: mismo cálculo de "milisegundos a
 * días" que usa el resto del proyecto para diffs de fecha, pero
 * normalizando a medianoche local primero — `dia.fecha` e
 * `inicioSemanaHoy` deberían venir ya normalizados, pero un diff en crudo
 * es frágil ante cualquier resto de hora/DST, y esto es barato de
 * garantizar acá.
 */
function calcularOffsetSemana(fecha, inicioSemanaHoy) {
  const medianocheLocal = (f) => new Date(f.getFullYear(), f.getMonth(), f.getDate());
  const diffDias = Math.round((medianocheLocal(fecha) - medianocheLocal(inicioSemanaHoy)) / 86400000);
  return Math.floor(diffDias / 7);
}

/**
 * Ronda de ajustes visuales #5 — punto D: encabezado separador entre
 * semanas dentro del modo "Todo" (lista continua). Reusa
 * obtenerFechaInicioSemanaAgenda + calcularNumeroSemanaParaFecha — el
 * mismo par que arma "Semana N" en construirSubheaderSemanal — así el
 * número de semana coincide sea cual sea el modo desde el que se lo mire.
 */
function construirEncabezadoSemanaTodo(semestreActivo, offsetSemana) {
  const inicioSemana = obtenerFechaInicioSemanaAgenda(offsetSemana);
  const numeroSemana = semestreActivo ? calcularNumeroSemanaParaFecha(semestreActivo, inicioSemana) : null;
  const encabezado = document.createElement("div");
  encabezado.className = "agenda-todo-encabezado-semana";
  encabezado.textContent = numeroSemana ? `Semana ${numeroSemana}` : "Semana";
  return encabezado;
}

function construirSubheaderTodo() {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.style.cssText = "justify-content:center; flex-wrap:wrap; gap:6px 16px;";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn-discreto";
  boton.style.fontSize = "0.8rem";

  if (estado.agendaTodoDiasAtras > 0) {
    boton.textContent = "› Ocultar días anteriores";
    boton.addEventListener("click", () => ajustarDiasAtrasTodo(0));
  } else {
    boton.textContent = "‹ Ver días anteriores";
    boton.addEventListener("click", () => ajustarDiasAtrasTodo(estado.agendaTodoDiasAtras + 7));
  }
  wrap.appendChild(boton);

  return wrap;
}

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  const subCont = document.getElementById("agenda-subheader-dinamico");
  if (!cont) return;
  limpiarIntervalosVenceHoy();
  cont.innerHTML = "";
  if (subCont) subCont.innerHTML = "";

  // Decisión confirmada (selector de semestres por tarjetas): si HAY
  // semestres creados pero la persona los deseleccionó todos, la Agenda
  // queda vacía con este mensaje — no cae en silencio a "mostrar todo" ni a
  // otro semestre no elegido. Si directamente no hay NINGÚN semestre creado
  // todavía, se preserva el comportamiento de siempre (días sueltos, sin
  // materias inline, eventos sin semestre_id igual visibles).
  const hayAlgunSemestre = (estado.datos.semestres || []).length > 0;
  const semestresSeleccionados = obtenerSemestresSeleccionadosAgenda();
  if (hayAlgunSemestre && semestresSeleccionados.length === 0) {
    if (subCont) subCont.appendChild(construirEnlaceHoyAgenda());
    document.getElementById("agenda-filtro-estados-cont")?.replaceChildren();
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.textAlign = "center";
    vacio.textContent = "Selecciona al menos un semestre para ver tu Agenda.";
    cont.appendChild(vacio);
    return;
  }

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí
  const semestreReferencia = obtenerSemestreActivoAgenda(); // más reciente del conjunto, para "Semana N"
  const modoTodo = estado.agendaFiltroModo === "todo";
  // FIX: esto no se calculaba en ningún lado — construirBloqueDia recibía
  // `activosFiltro` como `undefined` en los 3 call-sites de más abajo, y
  // eventoPasaFiltroEstados hacía `activos.has(...)` sobre `undefined`,
  // tirando un TypeError apenas el día tenía una tarea/examen/evento (o sea,
  // en la práctica siempre) — rompía el render completo de Lista.
  const activosFiltro = obtenerEstadosFiltroActivos();

  // Punto 10: en modo "Todo" el rango arranca siempre en HOY (nunca hay
  // días previos a colapsar — ver obtenerRangoDiasAgendaTodo), así que el
  // colapso de días pasados del punto 8 es exclusivo del modo "Semanal".
  const dias = modoTodo
    ? obtenerRangoDiasAgendaTodo(semestreReferencia, estado.agendaTodoDiasAtras)
    : obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);

  if (subCont) {
    if (modoTodo) {
      subCont.appendChild(construirSubheaderTodo());
      subCont.appendChild(construirEnlaceHoyAgenda());
    } else {
      subCont.appendChild(construirSubheaderSemanal(dias, semestreReferencia));
    }
  }
  // Corrección: "los botones deben ir AFUERA de la tarjeta de arriba, justo
  // debajo de esta" — subCont vive ADENTRO de #agenda-header (la tarjeta con
  // Semana N / fecha / Hoy), así que ya no se cuelga ahí. Se arma su propio
  // contenedor, creado una sola vez e insertado como HERMANO de
  // #agenda-header (afterend) — fuera de la tarjeta, pegado justo debajo.
  let filtroCont = document.getElementById("agenda-filtro-estados-cont");
  if (!filtroCont) {
    filtroCont = document.createElement("div");
    filtroCont.id = "agenda-filtro-estados-cont";
    document.getElementById("agenda-header")?.insertAdjacentElement("afterend", filtroCont);
  }
  filtroCont.innerHTML = "";
  filtroCont.appendChild(construirBarraFiltroEstadosAgenda());

  if (modoTodo) {
    // Ronda de ajustes visuales #5 — punto D: el modo "Todo" es una lista
    // continua (no paginada semana a semana como el modo Semanal), pero
    // seguía sin ningún corte visual entre semanas, lo que hacía difícil
    // ubicarse en un rango largo. Se inserta un encabezado "Semana N" cada
    // vez que el offset de semana (contra HOY, mismo criterio que usa el
    // modo Semanal vía obtenerFechaInicioSemanaAgenda) cambia respecto al
    // día anterior — como `dias` ya viene ordenado cronológicamente, esto
    // agrupa automáticamente sin tener que re-calcular nada por bloques.
    const frag = document.createDocumentFragment();
    const inicioSemanaHoy = obtenerFechaInicioSemanaAgenda(0);
    let offsetSemanaAnterior = null;
    let huboContenido = false;

    dias.forEach((dia) => {
      const bloque = construirBloqueDia(dia, semestresSeleccionados, mostrarDiasVacios, activosFiltro);
      if (!bloque) return;
      huboContenido = true;

      const offsetSemana = calcularOffsetSemana(dia.fecha, inicioSemanaHoy);
      if (offsetSemana !== offsetSemanaAnterior) {
        frag.appendChild(construirEncabezadoSemanaTodo(semestreReferencia, offsetSemana));
        offsetSemanaAnterior = offsetSemana;
      }
      frag.appendChild(bloque);
    });

    if (!huboContenido) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.textAlign = "center";
      vacio.textContent = "Nada pendiente en este rango.";
      cont.appendChild(vacio);
    } else {
      cont.appendChild(frag);
    }
    return;
  }

  // Punto 8: se separan los días ya pasados (fecha < hoy) del resto ANTES
  // de construir los bloques, para poder envolver solo los pasados en el
  // colapso — hoy y los días futuros siguen sueltos, como siempre.
  const hoyISO = formatearFechaISO(new Date());
  const diasPasados = dias.filter((d) => formatearFechaISO(d.fecha) < hoyISO);
  const diasDesdeHoy = dias.filter((d) => formatearFechaISO(d.fecha) >= hoyISO);

  const bloquesPasados = diasPasados.map((dia) => construirBloqueDia(dia, semestresSeleccionados, mostrarDiasVacios, activosFiltro)).filter(Boolean);
  const bloquesDesdeHoy = diasDesdeHoy.map((dia) => construirBloqueDia(dia, semestresSeleccionados, mostrarDiasVacios, activosFiltro)).filter(Boolean);

  if (bloquesPasados.length === 0 && bloquesDesdeHoy.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.textAlign = "center";
    vacio.textContent = "Nada pendiente esta semana.";
    cont.appendChild(vacio);
    return;
  }

  if (bloquesPasados.length > 0) {
    cont.appendChild(construirColapsoDiasPasados(bloquesPasados));
  }
  bloquesDesdeHoy.forEach((b) => cont.appendChild(b));
}

/**
 * Punto "Materia" (3er tab): despacho entre las 3 vistas — "lista" |
 * "calendario" | "materia" (ver #pills-agenda-vista en index.html). Antes
 * era un simple if/else de 2 ramas (esLista); ahora que hay 3 posibles
 * vistas activas se resuelve el contenedor visible con un switch explícito
 * en vez de encadenar más booleanos.
 */
function renderizarAgenda() {
  asegurarEstadoAgendaBaseInicializado();
  asegurarFiltroMostrarMateriasInicializado();
  asegurarFiltroModoAgendaInicializado();
  renderizarHeaderAgenda();
  const vista = estado.agendaVistaActiva;
  document.getElementById("agenda-lista-dias")?.classList.toggle("oculto", vista !== "lista");
  document.getElementById("agenda-filtro-estados-cont")?.classList.toggle("oculto", vista !== "lista");
  document.getElementById("agenda-vista-calendario")?.classList.toggle("oculto", vista !== "calendario");
  document.getElementById("agenda-vista-materia")?.classList.toggle("oculto", vista !== "materia");
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vista === vista);
  });
  if (vista === "lista") {
    renderizarAgendaInterno();
  } else {
    // Calendario y Materia arman su propia navegación adentro de su propio
    // contenedor (agenda-calendario.js / agenda-materia.js) — acá el bloque
    // dinámico del header solo necesita el atajo "Hoy", compartido entre los
    // 3 modos (ver irAHoyAgenda).
    const subCont = document.getElementById("agenda-subheader-dinamico");
    if (subCont) {
      subCont.innerHTML = "";
      subCont.appendChild(construirEnlaceHoyAgenda());
    }
    if (vista === "calendario") renderizarCalendarioAgenda();
    else renderizarMateriaAgenda();
  }
  // FIX: la barra flotante de selección múltiple (contador + Cancelar +
  // Eliminar) estaba definida (sincronizarBarraSeleccionAgenda) pero nunca
  // se llamaba desde acá — el modo selección guardaba estado y resaltaba
  // tarjetas, pero no había forma de disparar el borrado desde la UI. Se
  // sincroniza al final de CADA render (cualquier vista) para que sobreviva
  // a cambiar de vista mientras hay una selección en curso.
  sincronizarBarraSeleccionAgenda();
}

/**
 * Idea "varios semestres a la vez": wiring del selector de semestres —
 * tocar el nombre en el header abre el modal de tarjetas
 * (#modal-agenda-semestres), y tocar el fondo oscuro lo cierra (mismo
 * patrón que el resto de modales del proyecto, ej. #modal-agenda-ajustes:
 * click en el propio overlay, no en la tarjeta de adentro). El botón "✕" lo
 * agrega el inyector global de modales (inicializarBotonesCerrarModal en
 * componentes.js), como en cualquier otro .modal-overlay — no hace falta
 * wiring propio para eso acá.
 */
function inicializarSelectorSemestreAgenda() {
  document.getElementById("agenda-nombre-semestre")?.addEventListener("click", abrirModalSemestresAgenda);
  document.getElementById("modal-agenda-semestres")?.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-semestres") cerrarModalSemestresAgenda();
  });
}

function inicializarAgenda() {
  inicializarModalAgendaEvento();

  document.getElementById("btn-agenda-agregar")?.addEventListener("click", () => {
    abrirModalEventoAgenda({ fechaDefault: new Date().toISOString().slice(0, 10) });
  });

  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaVistaActiva = btn.dataset.vista;
      renderizarAgenda();
    });
  });

  inicializarSelectorSemestreAgenda();
  inicializarFiltrosAgenda();
  inicializarMateriaAgenda();
  // FIX: sin esta llamada el nodo #agenda-barra-seleccion nunca se creaba —
  // sincronizarBarraSeleccionAgenda() (llamada desde renderizarAgenda) no
  // tenía nada que mostrar/ocultar.
  inicializarBarraSeleccionAgenda();
}

/**
 * Ronda de ajustes visuales — punto 3: los 3 botones de antes (Agregar /
 * engranaje-a-Ajustes-global / Filtros) quedan en 2 — Agregar y un único
 * engranaje (#btn-agenda-ajustes) que abre ESTA ventana combinada. Junta
 * "Mostrar: Semanal/Todo" y "Mostrar materias en la agenda" (antes vivían
 * en el viejo modal de Filtros) con el control que antes vivía suelto en
 * Ajustes → Agenda ("Mostrar días sin eventos ni tareas",
 * `configuracion.agenda_mostrar_dias_vacios` — ver renderizarAgendaInterno
 * más arriba). Esa sección de Ajustes global ya NO existe — este modal,
 * accesible solo desde acá, es el único lugar donde se toca.
 *
 * Pedido nuevo: los 3 controles son PERSISTENTES — sobreviven a recargar
 * la app (antes "Semanal/Todo" y "Mostrar materias" eran de sesión pura,
 * se reseteaban en cada carga). "Mostrar materias" reutiliza para esto el
 * campo `agenda_mostrar_clases` (ver nota de la Ronda #2 — punto D más
 * abajo, sobre por qué ese campo ya estaba en el schema).
 *
 * Los 3 controles aplican al toque (sin botón "Aplicar" separado) y
 * re-renderizan Agenda en el momento — el modal en sí se cierra con el
 * botón "✕" (auto-inyectado, ver inicializarBotonesCerrarModal en
 * componentes.js) o tocando el fondo.
 */
function inicializarFiltrosAgenda() {
  const modal = document.getElementById("modal-agenda-ajustes");
  if (!modal) return;

  // Ronda de ajustes visuales #2 — punto D: el control persistente que
  // vivía acá con nombre propio ("Mostrar clases ese día",
  // `agenda_mostrar_clases`) se había quitado de la UI por completo — no
  // tenía un propósito claro para la persona usuaria, en la práctica
  // duplicaba lo que ya hace "Mostrar materias en la agenda". El campo
  // quedó en el schema por compatibilidad con datos viejos, de solo
  // lectura. Ahora (pedido nuevo: persistencia) se retoma ESE mismo campo
  // como el respaldo persistente de "Mostrar materias en la agenda" — son
  // el mismo concepto, así que no hace falta sumar uno nuevo al schema.

  document.getElementById("btn-agenda-ajustes")?.addEventListener("click", () => {
    asegurarFiltroMostrarMateriasInicializado();
    document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === estado.agendaFiltroModo);
    });
    document.getElementById("chk-agenda-filtro-materias").checked = estado.agendaFiltroMostrarMaterias;
    // El persistente se lee directo de configuracion cada vez que se abre
    // (no de un estado de sesión propio) — mismo dato que antes vivía en
    // Ajustes global, solo que ahora se edita desde acá.
    const cfg = estado.datos.configuracion;
    document.getElementById("chk-agenda-mostrar-dias-vacios").checked = cfg.agenda_mostrar_dias_vacios !== false;
    // Ajustes vista Calendario — punto 3 (rediseño): "Repetir puntito por
    // cada pendiente" — default true (undefined = repite), igual criterio
    // que el resto de persistentes de este modal.
    const chkRepetirPuntos = document.getElementById("chk-agenda-calendario-repetir-puntos");
    if (chkRepetirPuntos) chkRepetirPuntos.checked = cfg.agenda_calendario_repetir_puntos !== false;
    sincronizarSwitchesVenceHoy();
    modal.classList.remove("oculto");
  });

  document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaFiltroModo = btn.dataset.valor;
      document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
      // Pedido nuevo: "Semanal"/"Todo" debe sobrevivir a recargar la app —
      // mismo patrón que "Mostrar días sin eventos ni tareas" más abajo
      // (persistente en configuracion, se sincroniza a Drive/caché local
      // igual que cualquier otro dato).
      estado.datos.configuracion.agenda_filtro_modo = btn.dataset.valor;
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      // Punto 10: cambiar de modo mientras se está a mitad de semana no
      // tiene un offset equivalente en "Todo" (que siempre arranca en HOY)
      // — se resetea el offset acá para que volver a "Semanal" más tarde
      // no deje a la persona parada en una semana que ya no recuerda por
      // qué eligió.
      estado.agendaOffsetSemana = 0;
      // Punto 4: los días extra que "Ver días anteriores" fue sumando son
      // propios de esta entrada al modo Todo — si se sale y se vuelve a
      // entrar más tarde, arranca de nuevo en el rango original.
      estado.agendaTodoDiasAtras = 0;
      renderizarAgenda();
    });
  });

  document.getElementById("chk-agenda-filtro-materias")?.addEventListener("change", (ev) => {
    estado.agendaFiltroMostrarMaterias = ev.target.checked;
    // Pedido nuevo: debe sobrevivir a recargar la app. Se reutiliza
    // `agenda_mostrar_clases` — el mismo campo que ya se leía como default
    // acá arriba (asegurarFiltroMostrarMateriasInicializado) pero que desde
    // la Ronda #2 (punto D) había quedado de solo lectura, sin forma de
    // escribirlo desde la UI tras quitarse su propio control ("Mostrar
    // clases ese día", que duplicaba esto). Es el mismo concepto, así que
    // en vez de sumar un campo nuevo al schema se vuelve a conectar la
    // escritura acá.
    estado.datos.configuracion.agenda_mostrar_clases = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  // Control persistente (antes en Ajustes → Agenda, ver config-ajustes.js):
  // mismo criterio de "undefined = default sí" que tenía allá, mismo
  // sellarTimestamp + marcarCambioPendiente que cualquier otro cambio de
  // configuracion. Ronda de ajustes visuales #2 — punto D: el otro control
  // persistente que vivía acá ("Mostrar clases ese día",
  // agenda_mostrar_clases) se quitó — no tenía un propósito claro para la
  // persona usuaria (duplicaba, en la práctica, lo que ya hace "Mostrar
  // materias en la agenda" arriba).
  document.getElementById("chk-agenda-mostrar-dias-vacios")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_mostrar_dias_vacios = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  // Ajustes vista Calendario — punto 3 (rediseño): "Repetir puntito por
  // cada pendiente" — ON (default): un puntito por cada tarea/examen
  // pendiente ese día, con un "+N" si son muchos. OFF: un solo puntito por
  // tipo/color, sin repetir, aunque haya varios pendientes iguales (el
  // comportamiento de antes). Persistente, mismo patrón que el resto de
  // este modal.
  document.getElementById("chk-agenda-calendario-repetir-puntos")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_calendario_repetir_puntos = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  modal.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-ajustes") modal.classList.add("oculto");
  });

  inicializarSwitchesVenceHoyAgenda();
}

/**
 * Pedido nuevo: "cuando algo vence hoy, ¿qué mostrar?" — 3 switches
 * (Solo hora / Solo tiempo restante / Ambos) que se comportan como un
 * grupo de radio (uno prendido a la vez, siempre hay exactamente uno
 * activo) implementados con el componente .switch de siempre a pedido
 * explícito, en vez del pill-group que usa el resto de Agenda para
 * elecciones de "una entre varias" — acá se pidió puntualmente así.
 * Pedido nuevo: los 2 switches de "vence hoy" (hora / restante) son
 * independientes entre sí — cualquier combinación es válida, incluidos los
 * 2 apagados a la vez (antes eran 3 checkboxes en modo radio exclusivo,
 * con un tercero "Ambos"; ver construirColumnaDerechaEvento más arriba
 * para cómo se combinan al mostrarse).
 */
function sincronizarSwitchesVenceHoy() {
  const cfg = estado.datos.configuracion;
  const chkHora = document.getElementById("chk-agenda-vencehoy-hora");
  const chkRestante = document.getElementById("chk-agenda-vencehoy-restante");
  if (chkHora) chkHora.checked = cfg.agenda_venceHoy_mostrar_hora !== false;
  if (chkRestante) chkRestante.checked = cfg.agenda_venceHoy_mostrar_restante !== false;
}

function inicializarSwitchesVenceHoyAgenda() {
  document.getElementById("chk-agenda-vencehoy-hora")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_venceHoy_mostrar_hora = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });
  document.getElementById("chk-agenda-vencehoy-restante")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_venceHoy_mostrar_restante = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });
}

// Expuesta en window: agenda-modal.js (guardar/borrar) necesita poder
// refrescar sin crear un import circular de vuelta hacia este archivo —
// mismo patrón que window.renderizarHorario en horario.js. agenda-
// calendario.js, en cambio, SÍ importa renderizarAgenda directo (ciclo
// intencional, igual que main.js <-> semestres.js): lo necesita en el mismo
// tick del click del usuario sobre una celda del grid.
window.renderizarAgenda = renderizarAgenda;

// Ajustes vista Calendario — punto 4: construirItemEvento, ETIQUETA_TIPO y
// limpiarIntervalosVenceHoy se exportan para que el detalle de día del
// Calendario (construirDetalleDia en agenda-calendario.js) pinte sus
// secciones de Tareas/Exámenes/Eventos con el MISMO componente e íconos que
// la vista Lista (mismo criterio de colores/estados pedido en el spec), en
// vez de duplicar esa lógica. Mismo ciclo de imports ya tolerado entre estos
// 2 archivos (agenda.js -> agenda-calendario.js vía renderizarCalendarioAgenda,
// ver comentario más arriba) — agenda-calendario.js pasa a importar también
// DE acá.
export { inicializarAgenda, renderizarAgenda, construirItemEvento, ETIQUETA_TIPO, limpiarIntervalosVenceHoy };
