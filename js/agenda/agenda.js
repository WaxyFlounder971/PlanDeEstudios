/* =========================================================================
   AGENDA — Núcleo
   Header fijo (Semestre/semana/día actual + pills Lista/Calendario +
   Agregar/Ajustes) + despacho entre las dos vistas. Esta vista (Lista) es
   cronológica: los 7 días de la semana mostrada, cada uno con sus materias
   inline y sus eventos/tareas/exámenes agrupados por tipo, con los días ya
   pasados colapsados bajo una flecha. La vista Calendario vive en
   agenda-calendario.js.
   ========================================================================= */

import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { desplazarYResaltarElemento } from "../ui/componentes.js";
import { renderizarCalendarioAgenda } from "./agenda-calendario.js";
import { construirSeccionMateriasDia, calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { abrirModalEventoAgenda, abrirTarjetaInfoEventoAgenda, inicializarModalAgendaEvento } from "./agenda-modal.js";
import {
  esHoyFecha,
  esTareaVencida,
  formatearFechaISO,
  formatearRangoSemanaAgenda,
  formatearTiempoRestanteHoy,
  obtenerDiasSemanaAgenda,
  obtenerEstiloEvento,
  obtenerFechaInicioSemanaAgenda,
  obtenerRangoDiasAgendaTodo,
  obtenerSemestreActivoAgenda,
  tareaVenceHoy,
} from "./agenda-utils.js";

const ETIQUETA_TIPO = { evento: "Eventos", tarea: "Tareas", examen: "Exámenes" };
const ORDEN_TIPO = ["examen", "tarea", "evento"];

// Transitorio (no persistido). "lista" | "calendario" — cuál de las 2
// vistas está activa ahora mismo (ver pills #pills-agenda-vista).
estado.agendaVistaActiva = estado.agendaVistaActiva || "lista";
// Semanas de offset respecto a la semana de hoy que Lista (y el submodo
// "Semanal" del Calendario, que la comparte a propósito) está mostrando.
estado.agendaOffsetSemana = estado.agendaOffsetSemana || 0;
// Rediseño núcleo Agenda — punto 10: filtro de SESIÓN (no persistido, se
// resetea en cada carga de la app) — "semanal" (comportamiento clásico,
// navegación semana a semana) | "todo" (desde hoy hasta fin de semestre +
// 2 semanas, scroll libre sin paginar — ver obtenerRangoDiasAgendaTodo).
estado.agendaFiltroModo = estado.agendaFiltroModo || "semanal";
// Ronda de ajustes visuales — punto 2 (fix bug): estado de sesión de
// expandido/colapsado del bloque "‹ N días anteriores" (punto 8). Antes
// vivía SOLO como clase CSS en el <div> del cuerpo colapsable, armado
// adentro de construirColapsoDiasPasados — cualquier re-render completo de
// renderizarAgendaInterno (ej. el que dispara alternarCompletadaEvento al
// tocar el check circular de una tarea) tira `cont.innerHTML = ""` y
// reconstruye ese <div> desde cero, que siempre arrancaba con la clase
// "oculto" puesta — perdiendo el expandido y colapsándose solo. Ahora el
// estado vive acá (sobrevive a que el DOM se destruya y reconstruya) y
// construirColapsoDiasPasados solo LEE/actualiza esta bandera.
estado.agendaDiasPasadosExpandido = estado.agendaDiasPasadosExpandido || false;
// Punto 4: días adicionales hacia atrás que el control "Ver días
// anteriores" del subheader de modo Todo va sumando al rango — 0 = rango
// original (arranca en hoy, sin días previos). Sesión, no persistido, mismo
// criterio que el resto de estos flags.
estado.agendaTodoDiasAtras = estado.agendaTodoDiasAtras || 0;
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
 * Punto 5: toggle del checkbox circular de "completada" — vive acá (no en
 * agenda-modal.js) porque no abre ningún modal, solo muta el campo y
 * refresca en el lugar; mismo patrón de "releer la entidad viva por id
 * antes de mutar" que usa agenda-modal.js (por si un sondeo remoto
 * reemplazó estado.datos mientras tanto).
 */
function alternarCompletadaEvento(eventoId) {
  const vivo = buscarEventoAgendaVivo(eventoId);
  if (!vivo) return;
  vivo.completada = !vivo.completada;
  sellarTimestamp(vivo);
  marcarCambioPendiente();
  renderizarAgendaInterno();
}

/**
 * Ronda de ajustes visuales — punto 1: layout de tarjeta reestructurado en
 * 2 columnas explícitas. Izquierda (nombre + materia, si tiene) anclada
 * arriba al nivel del nombre — por eso el item pasa a `align-items:
 * flex-start` en vez del `center` que trae `.agenda-item` por defecto (ver
 * design-system.css), así el nombre no queda centrado contra una columna
 * derecha más alta. Derecha apilada verticalmente: badge "Vencida" (si
 * aplica) → badge de tipo → hora — el badge de tipo usa el tamaño chico de
 * `.agenda-badge-vencida` (ver `.agenda-badge-tipo` en design-system.css)
 * para que ambos badges se lean como parte del mismo bloque, en vez del
 * badge grande genérico que traía antes.
 */
function construirItemEvento(evento) {
  const estilo = obtenerEstiloEvento(evento);

  const item = document.createElement("button");
  item.type = "button";
  item.className = "agenda-item";
  item.style.borderLeft = `3px solid ${estilo.colorBorde}`;
  item.style.alignItems = "flex-start";

  if (evento.tipo === "tarea") {
    const check = document.createElement("button");
    check.type = "button";
    check.className = "agenda-check-completada" + (evento.completada ? " marcada" : "");
    check.title = evento.completada ? "Marcar como pendiente" : "Marcar como completada";
    check.style.marginTop = "1px"; // óptico: centrado contra la línea del nombre, no del bloque entero
    check.addEventListener("click", (ev) => {
      ev.stopPropagation();
      alternarCompletadaEvento(evento.id);
    });
    item.appendChild(check);
  }

  // Columna izquierda: nombre + materia vinculada (si tiene).
  const izquierda = document.createElement("span");
  izquierda.style.cssText = "flex:1; min-width:0; text-align:left; overflow-wrap:break-word;";
  izquierda.innerHTML = `
    <div style="font-weight:600; ${evento.completada ? "text-decoration:line-through; opacity:0.7;" : ""}">${evento.nombre || "(sin nombre)"}</div>
    ${construirBadgeMateria(evento)}
  `;
  item.appendChild(izquierda);

  // Columna derecha: Vencida (opcional) -> badge de tipo -> hora, apilados.
  const vencida = esTareaVencida(evento);
  const venceHoy = tareaVenceHoy(evento);
  const derecha = document.createElement("span");
  derecha.className = "stack";
  derecha.style.cssText = "align-items:flex-end; gap:4px; flex-shrink:0; text-align:right;";
  derecha.innerHTML = `
    ${vencida ? `<span class="agenda-badge-vencida">⚠ Vencida</span>` : ""}
    <span class="badge agenda-badge-tipo ${estilo.claseBadge}">${estilo.etiqueta}</span>
  `;

  const hora = document.createElement("span");
  hora.className = "muted";
  hora.style.cssText = "font-size:0.78rem; white-space:nowrap;";
  if (venceHoy) {
    hora.innerHTML = `<span class="agenda-timer-vence-hoy">${formatearTiempoRestanteHoy(evento.fecha)}</span>`;
    const idIntervalo = setInterval(() => {
      const span = hora.querySelector(".agenda-timer-vence-hoy");
      if (!span || !span.isConnected) {
        clearInterval(idIntervalo);
        return;
      }
      span.textContent = formatearTiempoRestanteHoy(evento.fecha);
    }, 60000);
    intervalosVenceHoy.push(idIntervalo);
  } else {
    hora.textContent = evento.hora || "Todo el día";
  }
  derecha.appendChild(hora);
  item.appendChild(derecha);

  item.addEventListener("click", () => abrirTarjetaInfoEventoAgenda(evento.id));
  return item;
}

function construirBloqueDia(diaInfo, semestreActivo, mostrarDiasVacios) {
  const fechaISO = formatearFechaISO(diaInfo.fecha);
  const eventosDelDia = (estado.datos.agenda || [])
    .filter((ev) => ev.fecha === fechaISO)
    .sort((a, b) => String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

  if (!mostrarDiasVacios && eventosDelDia.length === 0) return null;

  const bloque = document.createElement("section");
  bloque.className = "glass-panel stack";
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

  const seccionMaterias = construirSeccionMateriasDia(semestreActivo, diaInfo.fecha, diaInfo.abrevDefault);
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
 * Subheader de navegación semanal de Lista — se arma en JS (no vive fijo en
 * el HTML) por el mismo motivo que el subheader del Calendario
 * (agenda-calendario.js): cada vista tiene su propio criterio de "qué
 * significa avanzar/retroceder" (semana acá, mes o semana allá), así que no
 * pueden compartir una sola barra de navegación estática.
 */
function construirSubheaderLista(dias) {
  const wrap = document.createElement("section");
  wrap.className = "glass-panel row-between";
  wrap.style.padding = "10px 14px";

  const btnAnterior = document.createElement("button");
  btnAnterior.type = "button";
  btnAnterior.className = "btn-icono-fantasma";
  btnAnterior.style.fontSize = "1.3rem";
  btnAnterior.textContent = "‹";
  btnAnterior.addEventListener("click", () => {
    estado.agendaOffsetSemana -= 1;
    renderizarAgenda();
  });

  const centro = document.createElement("div");
  centro.className = "stack";
  centro.style.cssText = "align-items:center; text-align:center; gap:2px; flex:1;";
  const rango = document.createElement("span");
  rango.className = "texto-encabezado-seccion";
  rango.textContent = formatearRangoSemanaAgenda(dias);
  const volverHoy = document.createElement("span");
  volverHoy.className = "muted";
  volverHoy.style.cssText = "font-size:0.72rem; text-decoration:underline; cursor:pointer;";
  volverHoy.textContent = "Volver a hoy";
  volverHoy.addEventListener("click", () => {
    estado.agendaOffsetSemana = 0;
    renderizarAgenda();
  });
  centro.appendChild(rango);
  centro.appendChild(volverHoy);

  const btnSiguiente = document.createElement("button");
  btnSiguiente.type = "button";
  btnSiguiente.className = "btn-icono-fantasma";
  btnSiguiente.style.fontSize = "1.3rem";
  btnSiguiente.textContent = "›";
  btnSiguiente.addEventListener("click", () => {
    estado.agendaOffsetSemana += 1;
    renderizarAgenda();
  });

  wrap.appendChild(btnAnterior);
  wrap.appendChild(centro);
  wrap.appendChild(btnSiguiente);
  return wrap;
}

/**
 * Punto 7: header fijo con Semestre / semana / día actual, mismo tamaño de
 * letra que renderizarHeaderHorario (horario.js) — se llama desde
 * renderizarAgenda() (no desde renderizarAgendaInterno) para que quede
 * correcto sea cual sea la vista activa (Lista o Calendario), sin que este
 * archivo necesite tocar agenda-calendario.js. La "semana" mostrada es la
 * del PRIMER día de la semana actualmente navegada (estado.agendaOffsetSemana,
 * compartido con el submodo "Semanal" del Calendario) — no la semana de
 * hoy — para que quede en sintonía con lo que la persona está viendo.
 */
function renderizarHeaderAgenda() {
  const semestre = obtenerSemestreActivoAgenda();
  const nombreEl = document.getElementById("agenda-nombre-semestre");
  const semanaEl = document.getElementById("agenda-semana-actual");
  const fechaEl = document.getElementById("agenda-fecha-hoy");

  if (!semestre) {
    if (nombreEl) nombreEl.textContent = "Sin semestres";
    if (semanaEl) semanaEl.textContent = "—";
  } else {
    if (nombreEl) nombreEl.textContent = semestre.nombre || "";
    // Modo "Todo" (punto 10): no hay semana "navegada" (es scroll libre
    // desde hoy), así que acá siempre es la semana de HOY.
    const primerDiaSemana =
      estado.agendaFiltroModo === "todo" ? new Date() : obtenerFechaInicioSemanaAgenda(estado.agendaOffsetSemana);
    const numeroSemana = calcularNumeroSemanaParaFecha(semestre, primerDiaSemana);
    if (semanaEl) semanaEl.textContent = `Semana ${numeroSemana}`;
  }
  // Siempre la fecha REAL de hoy (no la navegada) — es lo que hace que
  // tocarla tenga sentido como atajo "llevame a hoy" (ver listener en
  // inicializarAgenda).
  if (fechaEl) fechaEl.textContent = new Date().toLocaleDateString("es-CR", { day: "numeric", month: "short" });
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
 * Punto 10 (modo "Todo"): subheader liviano, sin flechas ‹ › — acá no hay
 * "semana navegada" que retroceder/avanzar, es un scroll libre continuo
 * desde hoy.
 *
 * Ronda de ajustes visuales — punto 4: ya no informa el rango con texto
 * fijo ("Desde hoy hasta el..."); en su lugar hay un control "Ver días
 * anteriores" que sigue sumando semanas hacia atrás (estado.agendaTodoDiasAtras,
 * consumido por obtenerRangoDiasAgendaTodo — ver agenda-utils.js) cada vez
 * que se toca. Solo re-renderiza el contenido interno (renderizarAgendaInterno,
 * no renderizarAgenda completo) y compensa el scroll del documento por la
 * altura que agregan los bloques nuevos ANTES de la posición actual, para
 * que la vista no salte ni se resetee al principio de la lista — lo que la
 * persona tenía a la vista se queda exactamente donde estaba.
 */
function construirSubheaderTodo(dias) {
  const wrap = document.createElement("section");
  wrap.className = "glass-panel";
  wrap.style.cssText = "padding:10px 14px; text-align:center;";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn-discreto";
  boton.style.fontSize = "0.8rem";
  boton.textContent = "‹ Ver días anteriores";
  boton.addEventListener("click", () => {
    const cont = document.getElementById("agenda-lista-dias");
    const scrollEl = document.scrollingElement || document.documentElement;
    const scrollAntes = scrollEl.scrollTop;
    const altoAntes = cont?.scrollHeight || 0;

    estado.agendaTodoDiasAtras += 7;
    renderizarAgendaInterno();

    // El nuevo contenido se agrega ARRIBA de lo que ya estaba, así que sin
    // esto el navegador mantiene el mismo scrollTop en píxeles y todo lo
    // que la persona tenía a la vista se corre hacia abajo — se compensa
    // sumando exactamente lo que creció el contenedor por encima.
    requestAnimationFrame(() => {
      const altoDespues = cont?.scrollHeight || 0;
      scrollEl.scrollTop = scrollAntes + (altoDespues - altoAntes);
    });
  });

  wrap.appendChild(boton);
  return wrap;
}

function renderizarAgendaInterno() {
  const cont = document.getElementById("agenda-lista-dias");
  if (!cont) return;
  limpiarIntervalosVenceHoy();
  cont.innerHTML = "";

  const cfg = estado.datos.configuracion;
  const mostrarDiasVacios = cfg.agenda_mostrar_dias_vacios !== false; // default: sí
  const semestreActivo = obtenerSemestreActivoAgenda();
  const modoTodo = estado.agendaFiltroModo === "todo";

  // Punto 10: en modo "Todo" el rango arranca siempre en HOY (nunca hay
  // días previos a colapsar — ver obtenerRangoDiasAgendaTodo), así que el
  // colapso de días pasados del punto 8 es exclusivo del modo "Semanal".
  const dias = modoTodo
    ? obtenerRangoDiasAgendaTodo(semestreActivo, estado.agendaTodoDiasAtras)
    : obtenerDiasSemanaAgenda(estado.agendaOffsetSemana);
  cont.appendChild(modoTodo ? construirSubheaderTodo(dias) : construirSubheaderLista(dias));

  if (modoTodo) {
    const bloques = dias.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);
    if (bloques.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.style.textAlign = "center";
      vacio.textContent = "Nada pendiente en este rango.";
      cont.appendChild(vacio);
    } else {
      bloques.forEach((b) => cont.appendChild(b));
    }
    return;
  }

  // Punto 8: se separan los días ya pasados (fecha < hoy) del resto ANTES
  // de construir los bloques, para poder envolver solo los pasados en el
  // colapso — hoy y los días futuros siguen sueltos, como siempre.
  const hoyISO = formatearFechaISO(new Date());
  const diasPasados = dias.filter((d) => formatearFechaISO(d.fecha) < hoyISO);
  const diasDesdeHoy = dias.filter((d) => formatearFechaISO(d.fecha) >= hoyISO);

  const bloquesPasados = diasPasados.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);
  const bloquesDesdeHoy = diasDesdeHoy.map((dia) => construirBloqueDia(dia, semestreActivo, mostrarDiasVacios)).filter(Boolean);

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

function renderizarAgenda() {
  asegurarFiltroMostrarMateriasInicializado();
  renderizarHeaderAgenda();
  const esLista = estado.agendaVistaActiva === "lista";
  document.getElementById("agenda-lista-dias")?.classList.toggle("oculto", !esLista);
  document.getElementById("agenda-vista-calendario")?.classList.toggle("oculto", esLista);
  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vista === estado.agendaVistaActiva);
  });
  if (esLista) renderizarAgendaInterno();
  else renderizarCalendarioAgenda();
}

function inicializarAgenda() {
  inicializarModalAgendaEvento();

  document.getElementById("btn-agenda-agregar")?.addEventListener("click", () => {
    abrirModalEventoAgenda({ fechaDefault: new Date().toISOString().slice(0, 10) });
  });
  document.getElementById("agenda-fecha-hoy")?.addEventListener("click", () => {
    // Punto 7: siempre lleva a HOY, sin importar en qué vista/semana esté
    // parada la persona — si hace falta, cambia a Lista y resetea el
    // offset de semana antes de buscar el bloque a resaltar (mismo motivo
    // por el que desplazarYResaltarElemento reintenta con
    // requestAnimationFrame: el bloque puede no existir todavía en el DOM
    // en el mismo tick que se dispara este click).
    let necesitaRerender = false;
    if (estado.agendaVistaActiva !== "lista") {
      estado.agendaVistaActiva = "lista";
      necesitaRerender = true;
    }
    if (estado.agendaOffsetSemana !== 0) {
      estado.agendaOffsetSemana = 0;
      necesitaRerender = true;
    }
    if (necesitaRerender) renderizarAgenda();
    desplazarYResaltarElemento(`#agenda-lista-dias [data-fecha="${formatearFechaISO(new Date())}"]`);
  });

  document.querySelectorAll("#pills-agenda-vista .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaVistaActiva = btn.dataset.vista;
      renderizarAgenda();
    });
  });

  inicializarFiltrosAgenda();
}

/**
 * Ronda de ajustes visuales — punto 3: los 3 botones de antes (Agregar /
 * engranaje-a-Ajustes-global / Filtros) quedan en 2 — Agregar y un único
 * engranaje (#btn-agenda-ajustes) que abre ESTA ventana combinada. Junta
 * los 2 controles de SESIÓN que ya vivían en el viejo modal de Filtros
 * ("Mostrar: Semanal/Todo" y "Mostrar materias en la agenda") con los 2
 * controles PERSISTENTES que antes vivían sueltos en Ajustes → Agenda
 * ("Mostrar clases ese día" y "Mostrar días sin eventos ni tareas",
 * `configuracion.agenda_mostrar_clases`/`agenda_mostrar_dias_vacios` — ver
 * también agenda-clases.js y renderizarAgendaInterno más arriba). Esa
 * sección de Ajustes global ya NO existe — este modal, accesible solo
 * desde acá, es el único lugar donde se tocan estos 4 ajustes.
 *
 * Los 4 controles aplican al toque (sin botón "Aplicar" separado) y
 * re-renderizan Agenda en el momento — el modal en sí se cierra con el
 * botón "✕" (auto-inyectado, ver inicializarBotonesCerrarModal en
 * componentes.js) o tocando el fondo.
 */
function inicializarFiltrosAgenda() {
  const modal = document.getElementById("modal-agenda-ajustes");
  if (!modal) return;

  document.getElementById("btn-agenda-ajustes")?.addEventListener("click", () => {
    asegurarFiltroMostrarMateriasInicializado();
    document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === estado.agendaFiltroModo);
    });
    document.getElementById("chk-agenda-filtro-materias").checked = estado.agendaFiltroMostrarMaterias;
    // Los 2 persistentes se leen directo de configuracion cada vez que se
    // abre (no de un estado de sesión propio) — son el mismo dato que
    // antes vivía en Ajustes global, solo que ahora se edita desde acá.
    const cfg = estado.datos.configuracion;
    document.getElementById("chk-agenda-mostrar-clases").checked = cfg.agenda_mostrar_clases !== false;
    document.getElementById("chk-agenda-mostrar-dias-vacios").checked = cfg.agenda_mostrar_dias_vacios !== false;
    modal.classList.remove("oculto");
  });

  document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      estado.agendaFiltroModo = btn.dataset.valor;
      document.querySelectorAll("#pills-agenda-filtro-modo .pill-item").forEach((b) => {
        b.classList.toggle("active", b === btn);
      });
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
    renderizarAgenda();
  });

  // Los 2 controles persistentes (antes en Ajustes → Agenda, ver
  // config-ajustes.js): mismo criterio de "undefined = default sí" que
  // tenían allá, mismo sellarTimestamp + marcarCambioPendiente que cualquier
  // otro cambio de configuracion.
  document.getElementById("chk-agenda-mostrar-clases")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_mostrar_clases = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  document.getElementById("chk-agenda-mostrar-dias-vacios")?.addEventListener("change", (ev) => {
    estado.datos.configuracion.agenda_mostrar_dias_vacios = ev.target.checked;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    renderizarAgenda();
  });

  modal.addEventListener("click", (ev) => {
    if (ev.target.id === "modal-agenda-ajustes") modal.classList.add("oculto");
  });
}

// Expuesta en window: agenda-modal.js (guardar/borrar) necesita poder
// refrescar sin crear un import circular de vuelta hacia este archivo —
// mismo patrón que window.renderizarHorario en horario.js. agenda-
// calendario.js, en cambio, SÍ importa renderizarAgenda directo (ciclo
// intencional, igual que main.js <-> semestres.js): lo necesita en el mismo
// tick del click del usuario sobre una celda del grid.
window.renderizarAgenda = renderizarAgenda;

export { inicializarAgenda, renderizarAgenda };
