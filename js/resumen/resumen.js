/* =========================================================================
   RESUMEN
   Primera sección de la app — vista de SOLO LECTURA que agrega información
   que ya existe en Agenda/Horario/Semestres: semana actual del semestre,
   clases de hoy, tareas de hoy, próximas tareas, exámenes próximos y el
   próximo evento. No tiene modelo de datos propio, ni entidades nuevas, ni
   toca storage-sync — es puramente de presentación, reutilizando funciones
   ya existentes de esos 3 módulos:
     - obtenerSemestresSeleccionadosAgenda / obtenerSemestreActivoAgenda
       (agenda-utils.js) — mismo criterio de "semestre(s) actual(es)" que ya
       usa el header de Agenda, para que Resumen nunca muestre algo distinto
       de lo que la persona ya tiene seleccionado ahí.
     - calcularNumeroSemanaSemestre (core/schema.js) — mismo cálculo de
       número de semana que usan Horario y Agenda.
     - construirSeccionMateriasDia (agenda-clases.js) — el mismo bloque
       "Materias" que arma Agenda para un día puntual, reutilizado tal cual.
     - construirItemEvento (agenda.js) — el mismo item de lista de Agenda
       (con su checkbox de completar y su click-to-tarjeta-de-info ya
       cableados), reutilizado para tareas/exámenes/eventos.
   Tocar cualquier ítem abre la misma tarjeta de solo-info que ya existe en
   Agenda/Horario para ese tipo — no hay edición posible desde acá.

   Fechas (2026-09-21): TODO ítem con fecha en Resumen lleva, justo antes de
   su tarjeta, una fila con la fecha real anclada a la izquierda y, a la
   derecha bajo la etiqueta "Faltante", el texto relativo de
   formatearFechaRelativa (agenda-utils.js — única fuente de esa escala).
   Va POR ÍTEM: nunca como encabezado de grupo que reemplace la fecha real.
   ========================================================================= */

import { calcularNumeroSemanaSemestre, obtenerEstadoEfectivoSemestre } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { construirItemEvento } from "../agenda/agenda.js";
import { construirSeccionMateriasDia } from "../agenda/agenda-clases.js";
import {
  esTareaVencida,
  formatearFechaISO,
  formatearFechaRelativa,
  obtenerCodigoDiaSemana,
  obtenerSemestreActivoAgenda,
  obtenerSemestresSeleccionadosAgenda,
  tareaVenceHoy,
} from "../agenda/agenda-utils.js";
import { fechaLocalDesdeISO } from "../horario/horario.js";

// Ventanas de tiempo de cada sección (ver prompt de diseño): exámenes hasta
// 2 semanas adelante, próximo evento hasta 7 días adelante.
const DIAS_EXAMENES_PROXIMOS = 14;
const DIAS_EVENTO_PROXIMO = 7;
// Cantidad de tareas futuras a mostrar en "Próximas tareas".
const CANTIDAD_PROXIMAS_TAREAS = 3;

/** "YYYY-MM-DD" de `fecha` + `dias` días, usando el mismo formateo local
 *  que el resto de Agenda (formatearFechaISO) para no reintroducir el bug
 *  de desfase de timezone que ya se resolvió ahí con toISOString(). */
function fechaISOMasDias(fecha, dias) {
  const d = new Date(fecha);
  d.setDate(d.getDate() + dias);
  return formatearFechaISO(d);
}

/** Arma un bloque de sección con título + contenido, mismo patrón visual
 *  (glass-card + texto-encabezado-seccion) que el resto de la app. */
function construirBloqueSeccion(titulo, contenidoEl) {
  const seccion = document.createElement("section");
  seccion.className = "glass-card stack resumen-bloque";
  const encabezado = document.createElement("h2");
  encabezado.className = "texto-encabezado-seccion";
  encabezado.textContent = titulo;
  seccion.appendChild(encabezado);
  seccion.appendChild(contenidoEl);
  return seccion;
}

const DIAS_SEMANA_CORTOS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

/** "Lun 15 sep" — fecha real de un ítem, con el año solo si NO es el actual
 *  ("Lun 15 sep 2027"). Armada a mano (no con Intl) para que el formato sea
 *  idéntico en cualquier navegador/idioma. Usa fechaLocalDesdeISO
 *  (horario.js), mismo criterio que el resto de la app, sin desfase de
 *  timezone. */
function formatearFechaRealItem(fechaISO) {
  const f = fechaLocalDesdeISO(fechaISO);
  if (Number.isNaN(f.getTime())) return String(fechaISO || "");
  const base = `${DIAS_SEMANA_CORTOS[f.getDay()]} ${f.getDate()} ${MESES_CORTOS[f.getMonth()]}`;
  return f.getFullYear() === new Date().getFullYear() ? base : `${base} ${f.getFullYear()}`;
}

/** Fila que va ANTES de la tarjeta de cada ítem: fecha real a la izquierda
 *  (siempre visible, sin importar qué tan relativa sea) y a la derecha, bajo
 *  la etiqueta "Faltante", el texto relativo ("Hoy", "Mañana", "En 5 días",
 *  "Ayer", "Hace 3 días"…). En ítems del pasado (Tareas vencidas) se lee
 *  "Faltante: Hace N días", literal a la escala pedida. */
function construirFilaFechaItem(fechaISO) {
  const fila = document.createElement("div");
  fila.className = "resumen-fecha-item";
  fila.style.cssText = "display:flex; justify-content:space-between; align-items:flex-end; gap:12px; padding:0 4px;";

  const real = document.createElement("span");
  real.className = "resumen-fecha-real";
  real.style.cssText = "font-size:0.85rem; font-weight:600;";
  real.textContent = formatearFechaRealItem(fechaISO);

  const faltante = document.createElement("span");
  faltante.className = "resumen-fecha-faltante";
  faltante.style.cssText = "display:flex; flex-direction:column; align-items:flex-end; line-height:1.15; text-align:right;";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.style.cssText = "font-size:0.66rem; text-transform:uppercase; letter-spacing:0.05em;";
  etiqueta.textContent = "Faltante";

  const relativo = document.createElement("span");
  relativo.className = "muted";
  relativo.style.cssText = "font-size:0.82rem; white-space:nowrap;";
  relativo.textContent = formatearFechaRelativa(fechaISO);

  faltante.appendChild(etiqueta);
  faltante.appendChild(relativo);
  fila.appendChild(real);
  fila.appendChild(faltante);
  return fila;
}

/** Lista vertical de eventos ya renderizados con construirItemEvento
 *  (agenda.js) — mismo look, mismo checkbox funcional, mismo click-to-info —
 *  cada uno precedido de su propia fila de fecha (construirFilaFechaItem).
 *  Es la ÚNICA lista de ítems de Resumen: Exámenes próximos, Tareas de hoy,
 *  Tareas vencidas, Próximas tareas y Próximo evento pasan todas por acá,
 *  así ningún bloque puede quedar sin fecha relativa. */
function construirListaEventos(eventos) {
  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "14px";
  eventos.forEach((evento) => {
    const par = document.createElement("div");
    par.className = "stack resumen-item-con-fecha";
    par.style.gap = "4px";
    par.appendChild(construirFilaFechaItem(evento.fecha));
    par.appendChild(construirItemEvento(evento));
    lista.appendChild(par);
  });
  return lista;
}

/** Eventos de agenda que pertenecen a alguno de los semestres dados (o que
 *  no tienen semestre asignado, por compatibilidad con datos viejos) —
 *  mismo criterio de filtrado que ya usa construirBloqueDia en agenda.js. */
function obtenerEventosDeSemestres(semestres) {
  const ids = new Set(semestres.map((s) => s.id));
  return (estado.datos.agenda || []).filter((ev) => !ev.semestre_id || ids.has(ev.semestre_id));
}

function ordenarPorFechaYHora(a, b) {
  if (a.fecha !== b.fecha) return a.fecha.localeCompare(b.fecha);
  return String(a.hora || "99:99").localeCompare(String(b.hora || "99:99"));
}

function construirEstadoVacio() {
  const p = document.createElement("p");
  p.className = "muted resumen-vacio";
  p.textContent = "Todo tranquilo por hoy — no tenés nada pendiente en los próximos días. 🎉";
  return p;
}

/** Tarjeta "Semana X de Y" — mismo tamaño de título que usan "Clases de
 *  hoy" y "Próximas tareas" (texto-encabezado-seccion), pero acá centrado
 *  en una tarjeta propia con: barra de progreso del semestre a la
 *  izquierda (días transcurridos / días totales, en %) y "Faltan X días"
 *  anclado a la derecha (días hasta que termina el semestre, calculados
 *  desde fecha_inicio + duracion_semanas). Usa fechaLocalDesdeISO
 *  (horario.js) para leer fecha_inicio igual que el resto de la app, sin
 *  reintroducir el desfase de timezone que ya se resolvió en Agenda.
 *  El ancho final de la barra y el eventual acortado del texto central se
 *  resuelven en ajustarTarjetaSemana(), una vez que el elemento ya está
 *  en el DOM y se puede medir el ancho real de "Faltan X días". */
function construirTarjetaSemana(semestreActivo, numeroSemana, hoy) {
  const fechaInicio = fechaLocalDesdeISO(semestreActivo.fecha_inicio);
  const totalDias = semestreActivo.duracion_semanas * 7;
  const diasTranscurridos = Math.floor((hoy - fechaInicio) / 86400000);
  const porcentaje = Math.min(100, Math.max(0, Math.round((diasTranscurridos / totalDias) * 100)));

  const fechaFin = new Date(fechaInicio);
  fechaFin.setDate(fechaFin.getDate() + totalDias);
  const diasRestantes = Math.max(0, Math.ceil((fechaFin - hoy) / 86400000));

  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card resumen-semana-tarjeta";
  tarjeta.style.cssText = "display:flex; align-items:center; gap:16px; padding:14px 18px;";

  // Izquierda: barra de progreso del semestre. El ancho de partida (99px)
  // es solo un placeholder hasta que ajustarTarjetaSemana() la iguale al
  // ancho real de "Faltan X días".
  const barraCont = document.createElement("div");
  barraCont.className = "resumen-semana-barra";
  barraCont.title = `${porcentaje}% del semestre transcurrido`;
  barraCont.style.cssText =
    "flex:0 0 99px; height:8px; border-radius:999px; background:rgba(255,255,255,0.14); overflow:hidden;";
  const barraFill = document.createElement("div");
  barraFill.className = "resumen-semana-barra-fill";
  barraFill.style.cssText =
    "height:100%; width:" + porcentaje + "%; border-radius:999px; background:var(--color-primario, #7c9eff);";
  barraCont.appendChild(barraFill);

  // Centro: número de semana, mismo tamaño que los otros encabezados de
  // sección. Siempre en una sola línea (nowrap, sin "…") — si no entra,
  // ajustarTarjetaSemana() cambia a la versión corta guardada en dataset.
  const centro = document.createElement("h2");
  centro.className = "texto-encabezado-seccion resumen-semana-numero";
  centro.style.cssText =
    "flex:1; min-width:0; margin:0; text-align:center; white-space:nowrap; overflow:hidden; text-overflow:clip;";
  centro.dataset.textoCompleto = `Semana ${numeroSemana} de ${semestreActivo.duracion_semanas}`;
  centro.dataset.textoCorto = `Semana ${numeroSemana}`;
  centro.textContent = centro.dataset.textoCompleto;

  // Derecha: días restantes, anclado.
  const faltan = document.createElement("span");
  faltan.className = "muted resumen-semana-faltan";
  faltan.style.cssText = "flex:0 0 auto; white-space:nowrap;";
  faltan.textContent = diasRestantes === 0 ? "Último día" : `Faltan ${diasRestantes} días`;

  tarjeta.appendChild(barraCont);
  tarjeta.appendChild(centro);
  tarjeta.appendChild(faltan);
  return tarjeta;
}

/** Ajustes que requieren el elemento ya insertado en el DOM (para medir
 *  anchos reales):
 *  1. La barra de progreso se iguala al ancho de "Faltan X días", como se
 *     pidió — ambos elementos miden lo mismo.
 *  2. Si con ese ancho de barra el texto central completo ("Semana X de
 *     Y") no entra en el espacio disponible, se reemplaza ENTERO por
 *     "Semana X" (sin " de Y") — nunca queda cortado a la mitad. Para
 *     evitar el recorte visual que daba overflow:hidden + scrollWidth
 *     (que a veces mostraba "Semana 5 de 1…" en vez de saltar limpio),
 *     acá se mide el ancho real del texto con un canvas usando la
 *     tipografía real del elemento, y se decide ANTES de pintar el texto
 *     final — así el usuario nunca ve una versión a medio cortar. */
function ajustarTarjetaSemana(tarjeta) {
  const barraCont = tarjeta.querySelector(".resumen-semana-barra");
  const centro = tarjeta.querySelector(".resumen-semana-numero");
  const faltan = tarjeta.querySelector(".resumen-semana-faltan");
  if (!barraCont || !centro || !faltan) return;

  const anchoFaltan = faltan.getBoundingClientRect().width;
  if (anchoFaltan > 0) {
    barraCont.style.flex = `0 0 ${anchoFaltan}px`;
  }

  // Con la barra ya en su ancho final, medimos cuánto espacio le queda
  // realmente al centro y comparamos contra el ancho que ocuparía el
  // texto completo (medido con canvas, no con layout/clip).
  const disponible = centro.getBoundingClientRect().width;
  const anchoCompleto = medirAnchoTexto(centro.dataset.textoCompleto, centro);
  centro.textContent =
    anchoCompleto > disponible ? centro.dataset.textoCorto : centro.dataset.textoCompleto;
}

/** Ancho en píxeles que ocuparía `texto` si se pintara con la misma
 *  tipografía computada de `elementoReferencia` (font-weight/size/family).
 *  Usa un <canvas> descartable en vez de insertar/medir un nodo real, así
 *  no genera reflow extra ni parpadeo. */
function medirAnchoTexto(texto, elementoReferencia) {
  const canvas = medirAnchoTexto._canvas || (medirAnchoTexto._canvas = document.createElement("canvas"));
  const ctx = canvas.getContext("2d");
  const estilo = getComputedStyle(elementoReferencia);
  ctx.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`;
  return ctx.measureText(texto).width;
}

/** Tarjeta compacta "Tareas perdidas  N" — mismo rojo muy oscuro del badge
 *  "Perdida" de Agenda (badge-perdida, ver design-system.css). */
function construirTarjetaPerdidas(cantidad) {
  const tarjeta = document.createElement("section");
  tarjeta.className = "glass-card resumen-perdidas-tarjeta";
  tarjeta.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:12px; padding:12px 18px;";

  const texto = document.createElement("span");
  texto.className = "muted";
  texto.textContent = cantidad === 1 ? "Tarea perdida" : "Tareas perdidas";

  const badge = document.createElement("span");
  badge.className = "badge badge-perdida";
  badge.textContent = String(cantidad);

  tarjeta.appendChild(texto);
  tarjeta.appendChild(badge);
  return tarjeta;
}

function renderizarResumen() {
  const cont = document.getElementById("seccion-resumen");
  if (!cont || !estado.datos) return;
  cont.innerHTML = "";

  const semestresSeleccionados = obtenerSemestresSeleccionadosAgenda();
  const semestreActivo = obtenerSemestreActivoAgenda();

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const hoyISO = formatearFechaISO(hoy);
  const diaCodigoHoy = obtenerCodigoDiaSemana(hoy);
  const limiteExamenesISO = fechaISOMasDias(hoy, DIAS_EXAMENES_PROXIMOS);
  const limiteEventoISO = fechaISOMasDias(hoy, DIAS_EVENTO_PROXIMO);

  let huboContenido = false;

  // 1. Semana actual del semestre — tarjeta arriba de todo, con barra de
  // progreso del semestre y días restantes. Solo se muestra si el semestre
  // de referencia está realmente "actual" HOY (evita un "Semana -2 de 16"
  // o "Semana 40 de 16" si lo que está seleccionado en Agenda es un
  // semestre pasado o futuro).
  if (semestreActivo && obtenerEstadoEfectivoSemestre(semestreActivo) === "actual") {
    const numeroSemana = calcularNumeroSemanaSemestre(semestreActivo);
    if (numeroSemana >= 1 && numeroSemana <= semestreActivo.duracion_semanas) {
      const tarjetaSemana = construirTarjetaSemana(semestreActivo, numeroSemana, hoy);
      cont.appendChild(tarjetaSemana);
      // Recién acá el elemento tiene layout real y se puede medir "Faltan
      // X días" para igualar el ancho de la barra y decidir si el texto
      // central entra completo o hay que acortarlo.
      ajustarTarjetaSemana(tarjetaSemana);
    }
  }

  // 2. Clases de hoy — el mismo bloque "Materias" que arma Agenda para un
  // día puntual (agenda-clases.js ya devuelve null si no hay nada, así que
  // la sección se auto-oculta sin lógica extra acá).
  const seccionMaterias = construirSeccionMateriasDia(semestresSeleccionados, hoy, diaCodigoHoy);
  if (seccionMaterias) {
    cont.appendChild(construirBloqueSeccion("Clases de hoy", seccionMaterias));
    huboContenido = true;
  }

  const eventos = obtenerEventosDeSemestres(semestresSeleccionados);

  // 3. Exámenes próximos — dentro de las próximas 2 semanas desde hoy
  // (incluyendo hoy mismo).
  const examenesProximos = eventos
    .filter((ev) => ev.tipo === "examen" && ev.fecha >= hoyISO && ev.fecha <= limiteExamenesISO)
    .sort(ordenarPorFechaYHora);
  if (examenesProximos.length > 0) {
    cont.appendChild(construirBloqueSeccion("Exámenes próximos", construirListaEventos(examenesProximos)));
    huboContenido = true;
  }

  // 4. Tareas de hoy — sin completar, fecha === hoy Y todavía no vencida
  // (tareaVenceHoy de agenda-utils.js ya excluye las que vencen hoy con
  // hora puntual ya pasada — esas las cubre "Tareas vencidas" más abajo,
  // así no aparecen duplicadas en ambas secciones).
  const tareasHoy = eventos.filter((ev) => tareaVenceHoy(ev)).sort(ordenarPorFechaYHora);
  if (tareasHoy.length > 0) {
    cont.appendChild(construirBloqueSeccion("Tareas de hoy", construirListaEventos(tareasHoy)));
    huboContenido = true;
  }

  // 4.5. Tareas vencidas — reusa esTareaVencida (agenda-utils.js), la
  // misma fuente/lógica que ya usa el modelo de Agenda: fecha < hoy, O
  // fecha === hoy con hora puntual ya pasada. Sin tope de cantidad (a
  // diferencia de "Próximas tareas") porque ocultar vencidas por un límite
  // arbitrario sería contraproducente para el propósito de la sección.
  // Cada ítem lleva su propia fecha real + "Faltante" (ya no hay encabezado
  // de grupo por día, que ocultaba la fecha real). Las tareas PERDIDAS no
  // llegan acá: esTareaVencida ya devuelve false para ellas.
  const tareasVencidas = eventos.filter((ev) => esTareaVencida(ev)).sort(ordenarPorFechaYHora);
  if (tareasVencidas.length > 0) {
    cont.appendChild(construirBloqueSeccion("Tareas vencidas", construirListaEventos(tareasVencidas)));
    huboContenido = true;
  }

  // 5. Próximas tareas — las 3 pendientes más próximas cronológicamente,
  // sin importar si vencen pronto o no. Decisión de diseño: se toman solo
  // las estrictamente FUTURAS (fecha > hoy) para no repetir acá los mismos
  // ítems que ya se muestran en "Tareas de hoy" arriba — si preferís que
  // cuenten como una sola bolsa de 3 (pudiendo repetir tareas de hoy acá
  // también), es una condición para sacar.
  const proximasTareas = eventos
    .filter((ev) => ev.tipo === "tarea" && !ev.completada && !ev.perdida && ev.fecha > hoyISO)
    .sort(ordenarPorFechaYHora)
    .slice(0, CANTIDAD_PROXIMAS_TAREAS);
  if (proximasTareas.length > 0) {
    cont.appendChild(construirBloqueSeccion("Próximas tareas", construirListaEventos(proximasTareas)));
    huboContenido = true;
  }

  // 6. Próximo evento (incluye feriados, que son tipo "evento" con
  // esFeriado:true) — el más próximo dentro de los próximos 7 días.
  const proximoEvento = eventos
    .filter((ev) => ev.tipo === "evento" && ev.fecha >= hoyISO && ev.fecha <= limiteEventoISO)
    .sort(ordenarPorFechaYHora)[0];
  if (proximoEvento) {
    cont.appendChild(construirBloqueSeccion("Próximo evento", construirListaEventos([proximoEvento])));
    huboContenido = true;
  }

  // Si NINGUNA sección de agenda tuvo contenido (más allá del chip de
  // semana, que no cuenta como "pendiente"), mensaje positivo en vez de
  // dejar la vista en blanco.
  if (!huboContenido) {
    cont.appendChild(construirEstadoVacio());
  }

  // 7. Tareas perdidas (2026-09-21) — cómo se "reflejan" en Resumen: la app
  // no tiene ningún porcentaje de cumplimiento, así que solo se muestra el
  // total de tareas que la persona dio por perdidas en los semestres
  // seleccionados. Va DESPUÉS del mensaje de "todo tranquilo" y no cuenta
  // como contenido pendiente (una perdida ya no es una obligación abierta).
  // Solo aparece si hay al menos una.
  const cantidadPerdidas = eventos.filter((ev) => ev.tipo === "tarea" && ev.perdida).length;
  if (cantidadPerdidas > 0) {
    cont.appendChild(construirTarjetaPerdidas(cantidadPerdidas));
  }
}

/** Sin wiring propio — Resumen no tiene controles ni modales, solo se
 *  repinta al entrar a la sección (ver mostrarSeccion en main.js) y cuando
 *  otros módulos llaman a window.renderizarResumen tras guardar algo (ver
 *  window.renderizarResumen más abajo). Se deja la función igual por
 *  consistencia con el patrón inicializarX()/renderizarX() que main.js ya
 *  espera de cada módulo de sección. */
function inicializarResumen() {}

// Mismo patrón que window.renderizarAgenda (agenda.js) y
// window.renderizarHorario (horario.js): se expone en window para que
// agenda-modal.js, horario-modal.js y storage-sync.js (aplicarDatosRemotosFrescos)
// puedan refrescar Resumen tras guardar/recibir datos frescos, sin crear un
// import circular nuevo.
window.renderizarResumen = renderizarResumen;

export { inicializarResumen, renderizarResumen };
