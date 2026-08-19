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
import { marcarCambioPendiente } from "../core/storage-sync.js";
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
 * Rediseño (2026-08-19, pedido explícito — "quiero que la tarjeta sea el
 * selector, que no haya selector y tarjeta"): se elimina el dropdown
 * (.select-custom) que vivía SEPARADO arriba de la tarjeta-resumen. Ahora
 * solo hay dos estados posibles acá:
 *   1. Ninguna materia elegida todavía → construirTarjetaVacia(): una
 *      tarjeta (mismo lenguaje visual .glass-panel.materia-card que la
 *      tarjeta-resumen real) que en sí misma es el botón "elegir materia".
 *   2. Materia elegida → la tarjeta-resumen real de siempre
 *      (construirTarjetaResumenMateria) + una "pestañita" chica centrada
 *      pegada al borde inferior (construirPestanaCambiarMateria) que abre
 *      abrirSelectorMateriaAgenda() — ESA es ahora la única forma de
 *      cambiar de materia, no hay ningún selector visible aparte de la
 *      tarjeta.
 */
function construirTarjetaVacia(onTocar) {
  const tarjeta = document.createElement("button");
  tarjeta.type = "button";
  tarjeta.className = "glass-panel materia-card materia-card-vacia";
  tarjeta.addEventListener("click", onTocar);

  const texto = document.createElement("span");
  texto.className = "muted";
  texto.textContent = "Tocá para seleccionar materia";
  tarjeta.appendChild(texto);

  return tarjeta;
}

/**
 * La "pestañita para jalar" (pedido explícito): una franja angosta pegada
 * al borde inferior de la tarjeta-resumen, en flujo normal (ver
 * construirContenidoMateria — nada de position:absolute ni overlap: eso
 * se probó primero y se veía "sobrepuesta"/flotando, además de dejar
 * traslucir lo que quedara debajo por el blur de .glass-panel). Al ir
 * tocando el borde de la tarjeta, angosta y sin border-top, se lee como
 * una continuación de la tarjeta en vez de un elemento aparte. Es la
 * ÚNICA forma de abrir el selector de materia una vez que ya hay una
 * elegida.
 */
function construirPestanaCambiarMateria(onTocar) {
  const pestana = document.createElement("button");
  pestana.type = "button";
  pestana.className = "materia-pestana-cambiar";
  pestana.setAttribute("aria-label", "Cambiar de materia");
  pestana.title = "Cambiar de materia";
  pestana.textContent = "▾";
  pestana.addEventListener("click", onTocar);
  return pestana;
}

/**
 * Una "tarjeta de semestre" chica dentro del selector — mismo criterio que
 * el resto de la app (nombre + badge Actual/Pasado, ver
 * construirBadgeEstadoSemestre en semestres-tarjetas.js), pero simplificada
 * a propósito: acá no hace falta reutilizar la tarjeta REAL de Semestres
 * (construirTarjetaSemestre), que trae edición/drag/conflictos — este
 * selector solo necesita mostrar, por semestre, las materias que se pueden
 * elegir para este tab, cada una como una fila tocable.
 */
function construirTarjetaSemestreSelector(semestre, materiasDelSemestre, onSeleccionar) {
  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-panel stack";
  tarjeta.style.cssText = "padding:12px 14px; gap:8px;";

  const encabezado = document.createElement("div");
  encabezado.style.cssText = "display:flex; align-items:center; justify-content:space-between; gap:8px;";

  const titulo = document.createElement("strong");
  titulo.style.fontSize = "0.92rem";
  titulo.textContent = semestre.nombre;
  encabezado.appendChild(titulo);

  const efectivo = obtenerEstadoEfectivoSemestre(semestre);
  const badgeEstado = document.createElement("span");
  badgeEstado.className = "badge " + (efectivo === "actual" ? "badge-success" : "badge-neutral");
  badgeEstado.textContent = efectivo === "actual" ? "Actual" : "Pasado";
  encabezado.appendChild(badgeEstado);

  tarjeta.appendChild(encabezado);

  const listaMaterias = document.createElement("div");
  listaMaterias.className = "stack";
  listaMaterias.style.gap = "6px";

  materiasDelSemestre.forEach((m) => {
    const activa = m.mmId === estado.agendaMateriaSeleccionadaId;
    const btnMateria = document.createElement("button");
    btnMateria.type = "button";
    btnMateria.className = "btn btn-block " + (activa ? "btn-primary" : "btn-secondary");
    btnMateria.style.cssText = "text-align:left;";
    btnMateria.textContent = m.nombre;
    btnMateria.addEventListener("click", () => onSeleccionar(m.mmId));
    listaMaterias.appendChild(btnMateria);
  });

  tarjeta.appendChild(listaMaterias);
  return tarjeta;
}

/**
 * Ventana con TODAS las tarjetas de semestre activas en Agenda (pedido
 * explícito) — se arma agrupando `materias` (ya viene filtrada por
 * obtenerMateriasVinculablesAgenda, mismo criterio que el resto de Agenda)
 * por semestreId, preservando el orden en que aparecen ahí. Mismo patrón
 * de modal 100%-dinámico (.modal-overlay/.glass-card.modal-card) que ya
 * usa el resto de la app (ver crearModalDinamico en semestres-tarjetas.js
 * o el modal chico de ui/adjuntos-ui.js) — armado acá en vez de
 * importado porque ninguno de los dos está exportado en una forma
 * reutilizable para este caso puntual.
 */
function abrirSelectorMateriaAgenda(materias) {
  document.querySelectorAll(".overlay-selector-materia-agenda").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay overlay-selector-materia-agenda";

  const card = document.createElement("div");
  card.className = "glass-card modal-card modal-card-ancha stack";
  card.style.gap = "14px";

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.className = "modal-x-close";
  btnX.setAttribute("aria-label", "Cerrar");
  btnX.textContent = "✕";
  btnX.addEventListener("click", () => overlay.remove());
  card.appendChild(btnX);

  const h = document.createElement("h3");
  h.style.margin = "0";
  h.textContent = "Elegí una materia";
  card.appendChild(h);

  const semestreIdsEnOrden = [];
  const materiasPorSemestre = new Map();
  materias.forEach((m) => {
    if (!materiasPorSemestre.has(m.semestreId)) {
      materiasPorSemestre.set(m.semestreId, []);
      semestreIdsEnOrden.push(m.semestreId);
    }
    materiasPorSemestre.get(m.semestreId).push(m);
  });

  semestreIdsEnOrden.forEach((semestreId) => {
    const semestre = buscarSemestreVivoPorId(semestreId);
    if (!semestre) return; // mismo criterio defensivo que resolverMateriaCompleta
    card.appendChild(
      construirTarjetaSemestreSelector(semestre, materiasPorSemestre.get(semestreId), (mmId) => {
        estado.agendaMateriaSeleccionadaId = mmId;
        overlay.remove();
        renderizarMateriaAgenda();
      })
    );
  });

  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
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
 * entidadTipo "materia") + UNA pill más, discreta, del mismo tamaño y
 * estilo que las demás (.adjunto-pill) que abre el menú completo de
 * gestión (abrirMenuAdjuntos, ver adjuntos-ui.js) — ese menú ya trae su
 * propio "+ Agregar otro adjunto" adentro, así que no hace falta un botón
 * aparte para agregar y otro para gestionar.
 *
 * Fix reportado (2 rondas): 1) la pill punteada "+ Adjuntar"
 * (.adjunto-pill-agregar) se veía muy oscura/poco legible — se cambió por
 * `.btn.btn-secondary.btn-block`, pero eso la hizo demasiado GRANDE y con
 * el texto todavía oscuro. Se vuelve ahora a una pill (`.adjunto-pill`,
 * la MISMA clase ya usada y confirmada legible en las pills de cada
 * adjunto — ni una tercera clase distinta ni estilos inline de color a
 * mano) para que quede chica y discreta como el resto, en la misma fila.
 * 2) El emoji del botón "Adjuntar" en sí queda fijo ("📎") — YA NO es
 * editable con un `window.prompt()` (fix 2026-08-19, pedido explícito: "eso
 * NUNCA debe pasar, mata el diseño"). Lo que SÍ es editable ahora es el
 * emoji de CADA adjunto individual (ver crearCampoEmojiModal en
 * ui/adjuntos-ui.js), a través del mismo modal — sin diálogos nativos del
 * navegador en ningún punto de este flujo.
 */
function construirFilaAdjuntosMateria(mm, onCambiar) {
  const cont = document.createElement("div");
  cont.className = "adjuntos-pills-fila";

  const adjuntos = obtenerAdjuntosActivosDe("materia", mm.id);
  adjuntos.forEach((adjunto) => {
    const pill = document.createElement("button");
    pill.type = "button";
    pill.className = "adjunto-pill";
    pill.title = adjunto.nombre;
    // Emoji propio del adjunto si se le puso uno (editable en el modal de
    // "Editar adjunto", sin diálogo nativo) — si no, el ícono por defecto
    // según el tipo, igual que en el menú de gestión (adjuntos-ui.js).
    const iconoAdjunto = adjunto.emoji || (adjunto.tipo === "enlace" ? "🔗" : "📄");
    pill.innerHTML = `${iconoAdjunto} <span style="overflow:hidden; text-overflow:ellipsis;">${adjunto.nombre}</span>`;
    pill.addEventListener("click", () => abrirAdjunto(adjunto));
    cont.appendChild(pill);
  });

  const pillAdjuntar = document.createElement("button");
  pillAdjuntar.type = "button";
  pillAdjuntar.className = "adjunto-pill";
  pillAdjuntar.title = "Adjuntos de esta materia";

  const spanEmoji = document.createElement("span");
  spanEmoji.textContent = "📎";
  pillAdjuntar.appendChild(spanEmoji);

  const spanTexto = document.createElement("span");
  spanTexto.textContent = "Adjuntar";
  pillAdjuntar.appendChild(spanTexto);

  pillAdjuntar.addEventListener("click", () => {
    abrirMenuAdjuntos({
      entidadTipo: "materia",
      entidadId: mm.id,
      titulo: "Adjuntos de esta materia",
      onCambiar,
    });
  });
  cont.appendChild(pillAdjuntar);

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

function construirContenidoMateria(mmVinculable, materias, onCambiar) {
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

  // Wrapper simple (sin position:relative/absolute — ver comentario de
  // .materia-pestana-cambiar en design-system.css): la pestañita va en
  // flujo normal, tocando el borde de abajo de la tarjeta, así el
  // `.stack` de `cont` mide el gap hacia el siguiente elemento desde el
  // borde de la pestañita, no desde el de la tarjeta — mismo gap parejo
  // pedido (tarjeta+pestaña → adjuntos == adjuntos → Semana 1).
  const wrapTarjeta = document.createElement("div");
  wrapTarjeta.appendChild(construirTarjetaResumenMateria(mm, materia, plan, semestre, onCambiar));
  wrapTarjeta.appendChild(construirPestanaCambiarMateria(() => abrirSelectorMateriaAgenda(materias)));
  cont.appendChild(wrapTarjeta);

  // Pedido explícito: el gap tarjeta→adjuntos debe ser el MISMO que
  // adjuntos→"Semana 1" (ese segundo gap es el de referencia, el que ya
  // pone el `.stack` de `cont` de forma pareja entre todos sus hijos). La
  // clase `.adjuntos-pills-fila` trae un `margin-top` propio (pensado para
  // cuando esta fila va pegada debajo de OTRA cosa, ej. el viejo selector)
  // que acá rompía esa igualdad — se anula puntualmente para este uso.
  const filaAdjuntos = construirFilaAdjuntosMateria(mm, onCambiar);
  filaAdjuntos.style.marginTop = "0";
  cont.appendChild(filaAdjuntos);

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

  if (!estado.agendaMateriaSeleccionadaId) {
    cont.appendChild(construirTarjetaVacia(() => abrirSelectorMateriaAgenda(materias)));
    return;
  }

  const mmVinculable = materias.find((m) => m.mmId === estado.agendaMateriaSeleccionadaId);
  cont.appendChild(construirContenidoMateria(mmVinculable, materias, renderizarMateriaAgenda));
}

/**
 * Wiring de una sola vez (llamado desde inicializarAgenda). Rediseño
 * (2026-08-19): ya no hay ningún dropdown propio que cerrar al tocar
 * afuera — el modal del selector (abrirSelectorMateriaAgenda) es un
 * `.modal-overlay` que ya se cierra solo al tocar fuera de su tarjeta
 * (mismo patrón que el resto de modales dinámicos de la app), así que no
 * hace falta wiring extra acá. Se deja la función (exportada, llamada
 * desde inicializarAgenda) como no-op explícito por si a futuro este tab
 * vuelve a necesitar algún wiring de una sola vez.
 */
function inicializarMateriaAgenda() {}

export { inicializarMateriaAgenda, renderizarMateriaAgenda };
