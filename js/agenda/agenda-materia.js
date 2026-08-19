/* =========================================================================
   AGENDA — Tab "Cronograma" (materia), 3er tab junto a Lista/Calendario
   Selector de una materia (entre las matriculadas de los semestres
   seleccionados en Agenda, mismo criterio que el resto de Agenda — ver
   obtenerMateriasVinculablesAgenda) +:
     1. Adjuntos de la materia (cronograma, reglas, libros — entidadTipo
        "materia", entidadId = materia_matriculada_id): botón "+ Adjuntar"
        y pills, mismo sistema unificado que ya usa Agenda para eventos
        (ver core/storage-adjuntos.js + ui/adjuntos-ui.js).
     2. Tarjeta-resumen: nombre, ícono 👤 de profesores, "Nota: X" y una
        flecha ➤ que salta a la tarjeta real en Semestres — clona el
        mismo cálculo/formato que usa esa tarjeta (calcularNotaFinalVigente
        + formatearNumero, redondeo al 5 más cercano) para que el número
        mostrado acá sea IDÉNTICO al de Semestres, nunca una segunda
        fuente de verdad.
     3. Encabezado completo (código, nombre, nota final, 👤, estado,
        universidad, créditos, ➤). El motor de criterios/asignaciones
        (construirSeccionNotas) NO se muestra acá — vive solo en Semestres;
        acá solo se ve el número final de la nota, ya calculado.
     4. Listado semana a semana (TODAS las semanas del semestre de esa
        materia, incluidas las vacías) con las clases de esa materia
        (siempre con su modalidad, aunque sea presencial) Y lo pendiente
        vinculado a ella, con el día de cada cosa.
   ========================================================================= */

import {
  obtenerEscalaNotasMateria,
  obtenerEscalaPorId,
  convertirDesde100,
  redondearNotaFinalAlCincoMasCercano,
  obtenerClasesEfectivasSemana,
  obtenerEstadoEfectivoSemestre,
} from "../core/schema.js";
import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import {
  fechaLocalDesdeISO,
  obtenerPlanPorId,
  obtenerColorBloque,
  obtenerNombreBloque,
  obtenerEmojiModalidad,
  obtenerEtiquetaModalidad,
  obtenerNombreProfesor,
  abrirTarjetaInfoBloque,
} from "../horario/horario.js";
import { buscarSemestreVivoPorId, navegarAMateriaMatriculada } from "../semestres/semestres.js";
import {
  abrirPopoverProfesoresMateria,
  calcularNotaFinalVigente,
  formatearNumero,
  textoBadgeUniversidad,
  abrirMenuRapidoResultadoMatricula,
} from "../semestres/semestres-tarjetas.js";
import { ESTADOS_MATERIA } from "../plan/plan-vista-lista-tarjetas.js";
import { abrirModalRequisito } from "../plan/plan-detalle.js";
import { calcularNumeroSemanaParaFecha } from "./agenda-clases.js";
import { construirItemEvento, limpiarIntervalosVenceHoy } from "./agenda.js";
import { formatearHoraAmPm, obtenerMateriasVinculablesAgenda } from "./agenda-utils.js";
import { obtenerAdjuntosActivosDe } from "../core/storage-adjuntos.js";
import { abrirAdjunto, abrirMenuAdjuntos } from "../ui/adjuntos-ui.js";

// Sesión, no persistido — mismo criterio que el resto de flags de Agenda
// (ver agenda.js/agenda-calendario.js): qué materia_matriculada_id está
// elegida ahora mismo en este tab. `null` = ninguna todavía.
estado.agendaMateriaSeleccionadaId =
  estado.agendaMateriaSeleccionadaId !== undefined ? estado.agendaMateriaSeleccionadaId : null;

// Mismo mapeo de código de día ("L"|"K"|"M"|"J"|"V"|"S"|"D") a etiqueta
// legible que ya usa el resto de la app (ver DIAS_SEMANA_CONFIG en
// ui/config-ajustes.js) — se repite acá en vez de importarlo porque ese
// archivo lo define local (no exportado) y es solo un diccionario chico de
// texto, no lógica que valga la pena desenredar de ahí para esto.
const ETIQUETA_DIA_CODIGO = {
  L: "Lunes",
  K: "Martes",
  M: "Miércoles",
  J: "Jueves",
  V: "Viernes",
  S: "Sábado",
  D: "Domingo",
};

// Orden real de la semana (Lunes primero) para ordenar clases por día —
// NUNCA alfabético: los códigos de una letra (L,K,M,J,V,S,D) ordenados con
// localeCompare dan J,K,L,M,S,V,D (alfabético), no la semana real. Este
// array fija el índice correcto para .sort() por posición.
const ORDEN_DIAS_SEMANA = ["L", "K", "M", "J", "V", "S", "D"];

/**
 * Dropdown de materia — MISMO patrón visual que el resto de la app
 * (.select-custom, ver design-system.css y el selector de materia del
 * formulario de alta/edición en index.html/agenda-modal.js), pero armado
 * 100% dinámico acá (no hay <select> nativo oculto de por medio: no hace
 * falta, esta elección no se envía en ningún formulario, solo decide qué
 * mostrarse en este mismo tab) — mismo criterio 100%-dinámico que ya usa
 * agenda-calendario.js para su propio subheader.
 */
function construirSelectorMateria(materias) {
  const cont = document.createElement("div");
  cont.className = "select-custom";
  cont.id = "agenda-materia-tab-selector";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-select select-custom-boton";
  boton.setAttribute("aria-haspopup", "listbox");
  boton.setAttribute("aria-expanded", "false");
  const activa = materias.find((m) => m.mmId === estado.agendaMateriaSeleccionadaId);
  boton.innerHTML = `<span>${activa ? activa.nombre : "Elegí una materia"}</span>`;

  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";
  lista.setAttribute("role", "listbox");

  materias.forEach((m) => {
    const li = document.createElement("li");
    const activaEsta = m.mmId === estado.agendaMateriaSeleccionadaId;
    li.className = "select-custom-opcion" + (activaEsta ? " activa" : "");
    li.setAttribute("role", "option");
    li.setAttribute("aria-selected", String(activaEsta));
    li.textContent = m.nombre;
    li.addEventListener("click", () => {
      estado.agendaMateriaSeleccionadaId = m.mmId;
      renderizarMateriaAgenda();
    });
    lista.appendChild(li);
  });

  boton.addEventListener("click", () => {
    const abierto = boton.getAttribute("aria-expanded") === "true";
    lista.classList.toggle("oculto", abierto);
    boton.setAttribute("aria-expanded", String(!abierto));
  });

  cont.appendChild(boton);
  cont.appendChild(lista);
  return cont;
}

/**
 * Resuelve la terna completa (materia matriculada real, materia del plan,
 * plan) a partir del mmId elegido en el selector — obtenerMateriasVinculablesAgenda
 * solo trae {mmId, nombre, semestreId} (lo mínimo para el dropdown), así
 * que para todo lo demás (adjuntos, nota, profesores, criterios) hace
 * falta ir a buscar el objeto real, mismo camino que ya usa
 * obtenerNombreMateriaEvento en agenda-modal.js.
 */
function resolverMateriaCompleta(mmId, semestreId) {
  const semestre = buscarSemestreVivoPorId(semestreId);
  if (!semestre) return null;
  const mm = (semestre.materias_matriculadas || []).find((m) => m.id === mmId);
  if (!mm) return null;
  const plan = obtenerPlanPorId(mm.plan_estudio_id);
  const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
  if (!materia) return null;
  return { semestre, mm, plan, materia };
}

/* ------------------------------ Adjuntos ------------------------------ */

/**
 * Fila de pills de adjuntos de la materia (cronograma, reglas, libros —
 * entidadTipo "materia") + UN solo botón "Adjuntar" que abre el menú
 * completo de gestión (abrirMenuAdjuntos, ver adjuntos-ui.js) — ese menú
 * ya trae su propio "+ Agregar otro adjunto" adentro, así que no hace
 * falta un botón aparte para agregar y otro para gestionar.
 *
 * Fix reportado: la pill punteada "+ Adjuntar" (.adjunto-pill-agregar) se
 * veía muy oscura / poco legible. Se reemplaza por un botón `.btn
 * .btn-secondary` — el mismo estilo que ya usan "📄 Subir archivo" /
 * "🔗 Agregar enlace" dentro del propio modal, que sí se ve bien y se
 * adapta solo a modo claro/oscuro (no depende de la clase de pill que
 * estaba rota).
 */
function construirFilaAdjuntosMateria(mm, onCambiar) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.gap = "6px";

  const adjuntos = obtenerAdjuntosActivosDe("materia", mm.id);

  if (adjuntos.length > 0) {
    const filaPills = document.createElement("div");
    filaPills.className = "adjuntos-pills-fila";
    adjuntos.forEach((adjunto) => {
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "adjunto-pill";
      pill.title = adjunto.nombre;
      pill.innerHTML = `${adjunto.tipo === "enlace" ? "🔗" : "📄"} <span style="overflow:hidden; text-overflow:ellipsis;">${adjunto.nombre}</span>`;
      pill.addEventListener("click", () => abrirAdjunto(adjunto));
      filaPills.appendChild(pill);
    });
    cont.appendChild(filaPills);
  }

  const btnAdjuntar = document.createElement("button");
  btnAdjuntar.type = "button";
  btnAdjuntar.className = "btn btn-secondary btn-block";
  btnAdjuntar.textContent = adjuntos.length > 0 ? "📎 Adjuntos" : "📎 Adjuntar";
  btnAdjuntar.addEventListener("click", () => {
    abrirMenuAdjuntos({
      entidadTipo: "materia",
      entidadId: mm.id,
      titulo: "Adjuntos de esta materia",
      onCambiar,
    });
  });
  cont.appendChild(btnAdjuntar);

  return cont;
}

/* --------------------------- Tarjeta-resumen --------------------------- */

/**
 * Encabezado COMPLETO — mismos campos que la línea1+línea2 de la tarjeta
 * real de materia en Semestres (ver construirTarjetaMateria en
 * semestres-tarjetas.js), clonados 1:1 para que esta tarjeta-resumen sea el
 * mismo encabezado, no una versión recortada:
 *   Código · Nombre · Nota · 👤 (profesores)
 *   Estado · Universidad · Créditos · ➤ Ir a Semestres
 *
 * A propósito NO se trae nada más de esa tarjeta real — el cuerpo
 * expandible de notas/criterios (construirSeccionNotas) NO se muestra en
 * este tab, esa vive únicamente en Semestres. Es el encabezado solo,
 * envuelto en su propia tarjeta (`.glass-panel.materia-card`, mismo
 * lenguaje visual que el resto de tarjetas de Agenda/Semestres) para que se
 * vea como una tarjeta real y autocontenida en vez de elementos sueltos.
 */
function construirTarjetaResumenMateria(mm, materia, plan, semestre, onCambiar) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-panel materia-card stack";
  tarjeta.style.padding = "12px 14px";
  tarjeta.style.gap = "8px";
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  if (categoria) tarjeta.style.boxShadow = `inset 6px 0 0 0 ${categoria.color}`;

  /* ---- Línea 1: Código · Nombre · Nota · 👤 ---- */
  const linea1 = document.createElement("div");
  linea1.style.cssText = "display:flex; align-items:center; gap:8px; flex-wrap:wrap;";

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  spanCodigo.style.cssText = "cursor:pointer; flex-shrink:0;";
  spanCodigo.title = "Ver la tarjeta de esta materia";
  spanCodigo.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalRequisito(materia.codigo);
  });
  linea1.appendChild(spanCodigo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre completa";
  spanNombre.style.flex = "1";
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  linea1.appendChild(spanNombre);

  const notaFinalVigente = calcularNotaFinalVigente(mm, materia, plan);
  const notaRedondeada = redondearNotaFinalAlCincoMasCercano(notaFinalVigente);
  const escalaActiva = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  const notaRedondeadaMostrada = convertirDesde100(notaRedondeada, obtenerEscalaPorId(escalaActiva));
  const spanNota = document.createElement("span");
  spanNota.className = "materia-nota";
  spanNota.style.cssText = "flex-shrink:0; font-family:var(--font-display); font-weight:700; white-space:nowrap;";
  spanNota.textContent = `Nota: ${
    notaRedondeada === null || notaRedondeada === undefined ? "—" : formatearNumero(notaRedondeadaMostrada)
  }`;
  linea1.appendChild(spanNota);

  const iconoProfesor = document.createElement("span");
  iconoProfesor.className = "materia-icono-profesor";
  iconoProfesor.style.cssText = "flex-shrink:0; cursor:pointer; font-size:0.85rem; line-height:1;";
  iconoProfesor.textContent = "👤";
  iconoProfesor.title = "Profesores vinculados a esta materia";
  iconoProfesor.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirPopoverProfesoresMateria(mm, materia, plan, semestre, onCambiar);
  });
  linea1.appendChild(iconoProfesor);

  tarjeta.appendChild(linea1);

  /* ---- Línea 2: Estado · Universidad · Créditos · ➤ Ir a Semestres ---- */
  const linea2 = document.createElement("div");
  linea2.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;";

  const semestreActual = obtenerEstadoEfectivoSemestre(semestre) === "actual";
  const infoEstado = semestreActual
    ? ESTADOS_MATERIA.find((e) => e.valor === "cursando")
    : mm.resultado === "aprobada"
    ? { texto: "Aprobada", badge: "badge-success" }
    : mm.resultado === "reprobada"
    ? { texto: "Reprobada", badge: "badge-danger" }
    : { texto: "Estado", badge: "badge-neutral" };

  const colEstado = document.createElement("div");
  colEstado.style.cssText = "justify-self:start; min-width:0;";
  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  if (semestreActual) {
    badgeEstado.style.cursor = "default";
    badgeEstado.title = "Se calcula automáticamente mientras el semestre esté en curso";
  } else {
    badgeEstado.style.cursor = "pointer";
    badgeEstado.title = "Clic para corregir el resultado de este intento — solo afecta este semestre";
    badgeEstado.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirMenuRapidoResultadoMatricula(mm, badgeEstado, onCambiar);
    });
  }
  colEstado.appendChild(badgeEstado);
  linea2.appendChild(colEstado);

  const badgeUniversidad = document.createElement("span");
  badgeUniversidad.className = "badge badge-neutral";
  badgeUniversidad.style.justifySelf = "center";
  badgeUniversidad.textContent = textoBadgeUniversidad(plan.universidad);
  badgeUniversidad.title = plan.universidad;
  linea2.appendChild(badgeUniversidad);

  const colDerecha = document.createElement("div");
  colDerecha.className = "row";
  colDerecha.style.cssText = "justify-self:end; min-width:0; align-items:center; gap:8px;";

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
  colDerecha.appendChild(badgeCreditos);

  const btnIrA = document.createElement("button");
  btnIrA.type = "button";
  btnIrA.className = "materia-expandir";
  btnIrA.style.cssText = "background:none; border:none; cursor:pointer; padding:2px;";
  btnIrA.setAttribute("aria-label", "Ver esta materia en Semestres");
  btnIrA.title = "Ver esta materia en Semestres";
  btnIrA.textContent = "➤";
  btnIrA.addEventListener("click", () => navegarAMateriaMatriculada(semestre.id, mm.id));
  colDerecha.appendChild(btnIrA);

  linea2.appendChild(colDerecha);
  tarjeta.appendChild(linea2);

  return tarjeta;
}

/* ------------------------------ Semanas ------------------------------ */

/**
 * Mismo enriquecido que hace construirColumnaDia en horario.js (y que
 * duplica agenda-clases.js para su propia fila "Materias" del día) antes
 * de poder llamar a abrirTarjetaInfoBloque — se repite acá por el mismo
 * motivo: no está exportado de ninguno de los dos archivos.
 */
function enriquecerClaseParaTarjetaInfo(claseEfectiva) {
  return {
    bloqueOriginalId: claseEfectiva.id,
    color: obtenerColorBloque(claseEfectiva),
    nombreCorto: obtenerNombreBloque(claseEfectiva),
    profesorNombre: obtenerNombreProfesor(claseEfectiva.profesor_id),
    aula: claseEfectiva.aula,
    enlace: claseEfectiva.enlace,
    modalidad: claseEfectiva.modalidad,
    notas: claseEfectiva.notas,
  };
}

/**
 * Fila de una clase dentro de la semana — mismo lenguaje visual
 * (.agenda-item, borde de color) que una fila de pendiente, para que las
 * clases se vean "al mismo nivel" que las tareas/exámenes de esa semana.
 * Muestra SIEMPRE la modalidad (aunque sea presencial) — mismo criterio
 * que ya usa la fila "Materias" del día en agenda-clases.js.
 */
function construirFilaClaseMateria(claseEfectiva, semestre, numeroSemana) {
  const enriquecida = enriquecerClaseParaTarjetaInfo(claseEfectiva);
  const emoji = obtenerEmojiModalidad(claseEfectiva.modalidad);
  const etiquetaDia = ETIQUETA_DIA_CODIGO[claseEfectiva.dia] || claseEfectiva.dia;

  const fila = document.createElement("button");
  fila.type = "button";
  fila.className = "agenda-item";
  fila.style.borderLeft = `3px solid ${enriquecida.color}`;
  fila.innerHTML = `
    <span style="font-weight:600; flex-shrink:0;">${etiquetaDia} ${formatearHoraAmPm(claseEfectiva.hora_inicio)}</span>
    <span style="flex:1; text-align:left; overflow-wrap:break-word;">${enriquecida.nombreCorto}</span>
    <span class="muted" style="font-size:0.72rem; flex-shrink:0; text-align:right;">${emoji ? `${emoji} ` : ""}${obtenerEtiquetaModalidad(claseEfectiva.modalidad)}</span>
  `;
  fila.addEventListener("click", () => abrirTarjetaInfoBloque(semestre, numeroSemana, enriquecida));
  return fila;
}

/**
 * Sección de una semana puntual: encabezado "Semana N" + las clases de esa
 * materia esa semana (siempre, con modalidad) + lo pendiente de `mm` que
 * cae ahí (mismo componente construirItemEvento que Lista/Calendario) o
 * "Sin nada esta semana." si ninguno de los dos grupos tiene contenido —
 * pedido explícito: se listan TODAS las semanas del semestre, no solo las
 * que tienen algo, para que se vea de un vistazo el semestre completo de
 * esa materia.
 */
function construirSeccionSemanaMateria(semestre, materiaId, numeroSemana, eventosMateria) {
  const bloque = document.createElement("section");
  bloque.className = "glass-panel stack";
  bloque.style.padding = "14px";

  const titulo = document.createElement("span");
  titulo.style.fontWeight = "700";
  titulo.textContent = `Semana ${numeroSemana}`;
  bloque.appendChild(titulo);

  const clasesDeEstaSemana = (semestre.bloques_horario || [])
    .filter((b) => b.materia_id === materiaId)
    .flatMap((b) => obtenerClasesEfectivasSemana(b, numeroSemana))
    .sort(
      (a, b) =>
        ORDEN_DIAS_SEMANA.indexOf(a.dia) - ORDEN_DIAS_SEMANA.indexOf(b.dia) ||
        String(a.hora_inicio).localeCompare(String(b.hora_inicio))
    );

  const deEstaSemana = eventosMateria
    .filter((ev) => calcularNumeroSemanaParaFecha(semestre, fechaLocalDesdeISO(ev.fecha)) === numeroSemana)
    .sort((a, b) => a.fecha.localeCompare(b.fecha) || String(a.hora || "99:99").localeCompare(String(b.hora || "99:99")));

  if (clasesDeEstaSemana.length === 0 && deEstaSemana.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.8rem; margin:2px 0 0;";
    vacio.textContent = "Sin nada esta semana.";
    bloque.appendChild(vacio);
    return bloque;
  }

  clasesDeEstaSemana.forEach((clase) => {
    bloque.appendChild(construirFilaClaseMateria(clase, semestre, numeroSemana));
  });

  deEstaSemana.forEach((ev) => {
    const fila = document.createElement("div");
    fila.className = "stack";
    fila.style.gap = "3px";
    const etiquetaDia = document.createElement("span");
    etiquetaDia.className = "muted";
    etiquetaDia.style.cssText = "font-size:0.72rem; text-transform:capitalize;";
    etiquetaDia.textContent = fechaLocalDesdeISO(ev.fecha).toLocaleDateString("es-CR", {
      weekday: "long",
      day: "numeric",
      month: "short",
    });
    fila.appendChild(etiquetaDia);
    fila.appendChild(construirItemEvento(ev));
    bloque.appendChild(fila);
  });

  return bloque;
}

function construirContenidoMateria(mmVinculable, onCambiar) {
  const resuelto = resolverMateriaCompleta(mmVinculable.mmId, mmVinculable.semestreId);
  const cont = document.createElement("div");
  cont.className = "stack";

  if (!resuelto) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "No se encontró esta materia — puede que haya cambiado desde otro dispositivo.";
    cont.appendChild(vacio);
    return cont;
  }

  const { semestre, mm, plan, materia } = resuelto;

  cont.appendChild(construirTarjetaResumenMateria(mm, materia, plan, semestre, onCambiar));
  cont.appendChild(construirFilaAdjuntosMateria(mm, onCambiar));

  const eventosMateria = (estado.datos.agenda || []).filter((ev) => ev.materia_matriculada_id === mm.id);
  const totalSemanas = Number(semestre.duracion_semanas) || 16;

  for (let semana = 1; semana <= totalSemanas; semana++) {
    cont.appendChild(construirSeccionSemanaMateria(semestre, mm.materia_id, semana, eventosMateria));
  }

  return cont;
}

function renderizarMateriaAgenda() {
  const cont = document.getElementById("agenda-vista-materia");
  if (!cont) return;
  cont.innerHTML = "";
  // Mismo motivo que en agenda-calendario.js: construirItemEvento arma sus
  // propios timers "vence hoy" en el array compartido de agenda.js — se
  // limpia acá al arrancar cada render completo de este tab para no dejar
  // setInterval huérfanos al cambiar de materia o de semestres seleccionados.
  limpiarIntervalosVenceHoy();

  const materias = obtenerMateriasVinculablesAgenda();

  // Si la materia guardada en sesión ya no está entre las disponibles
  // (cambiaron los semestres seleccionados en Agenda, por ejemplo), se
  // resetea a "ninguna" en vez de quedar apuntando a algo que ya no existe.
  if (estado.agendaMateriaSeleccionadaId && !materias.some((m) => m.mmId === estado.agendaMateriaSeleccionadaId)) {
    estado.agendaMateriaSeleccionadaId = null;
  }

  if (materias.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "No hay materias matriculadas en los semestres seleccionados.";
    cont.appendChild(vacio);
    return;
  }

  cont.appendChild(construirSelectorMateria(materias));

  if (!estado.agendaMateriaSeleccionadaId) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "text-align:center; padding:16px 0;";
    vacio.textContent = "Elegí una materia para ver sus semanas.";
    cont.appendChild(vacio);
    return;
  }

  const mmVinculable = materias.find((m) => m.mmId === estado.agendaMateriaSeleccionadaId);
  cont.appendChild(construirContenidoMateria(mmVinculable, renderizarMateriaAgenda));
}

/**
 * Wiring de una sola vez (llamado desde inicializarAgenda): cerrar el
 * dropdown al tocar afuera — mismo patrón que el selector de materia del
 * formulario (cerrarDropdownMateria en agenda-modal.js), pero delegado acá
 * porque el contenedor se reconstruye en cada render (no es un nodo fijo
 * del HTML estático).
 */
function inicializarMateriaAgenda() {
  document.addEventListener("click", (ev) => {
    const cont = document.getElementById("agenda-materia-tab-selector");
    if (!cont || cont.contains(ev.target)) return;
    cont.querySelector(".select-custom-lista")?.classList.add("oculto");
    cont.querySelector(".select-custom-boton")?.setAttribute("aria-expanded", "false");
  });
}

export { inicializarMateriaAgenda, renderizarMateriaAgenda };
