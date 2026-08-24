/* =========================================================================
   SEMESTRES — Tarjetas (Fase 1 de "Semestres y Notas" + Fase 6: motor de
   notas — criterios, asignaciones, cálculo en vivo — Entrega 2/6).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, obtenerIniciales } from "../core/utils.js";
import { agregarLongPress, mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import {
  obtenerEstadoEfectivoSemestre,
  sellarTimestamp,
  crearCriterio,
  crearAsignacion,
  repartirEquitativoCriterio,
  obtenerEscalaNotasMateria,
  calcularPuntosAsignacion,
  recalcularNotaDesdePuntaje,
  calcularNotaFinalMateria,
  redondearNotaFinalAlCincoMasCercano,
  redondearDecimales,
  obtenerAsignacionesPendientes,
  calcularMaximoPosibleMateria,
  calcularNotaNecesariaUniforme,
  resolverObjetivoPasarRaspando,
  ESCALAS_DISPONIBLES,
  obtenerEscalaPorId,
  convertirA100,
  convertirDesde100,
  obtenerFraccionNota,
  notaMinimaParaFraccion,
  siguienteOrden,
  reordenarPorArrastre,
} from "../core/schema.js";
import { marcarCambioPendiente, actualizarIndicadorSync } from "../core/storage-sync.js";
import { ESTADOS_MATERIA, abrirModalResolverConflicto, abrirModalResolverConflictoGenerico, agregarIndicadorConflicto } from "../plan/plan-vista-lista-tarjetas.js";
import { abrirModalRequisito, abrirModalAsignarProfesorDesdeHistorial } from "../plan/plan-detalle.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";

/**
 * 2026-08-09 (pedido explícito): tocar la tarjetita de un profesor DENTRO
 * del popover de "Profesores vinculados a esta materia" (ver
 * abrirPopoverProfesoresMateria) debe abrir una tarjeta flotante con toda
 * su información + un botón "Ir" que navegue a Comunidad y lo resalte ahí.
 * Esa lógica (construir la tarjeta con estrellas/badges/historial, cambiar
 * de sección, expandir la tarjeta real y aplicar el destello) vive en
 * comunidad.js, que ya tiene todos esos helpers — importarla directo desde
 * acá crearía un ciclo (semestres.js -> semestres-tarjetas.js ->
 * comunidad.js -> semestres.js, ver import de obtenerSemestresActuales en
 * comunidad.js), así que se usa el mismo patrón de "registrar función" que
 * ya existe entre plan-detalle.js y comunidad.js
 * (registrarAbrirAltaProfesorPreseleccionado): comunidad.js llama a
 * registrarAbrirTarjetaProfesorFlotante una vez, al arrancar
 * (inicializarComunidad), y acá solo se dispara esa función ya inyectada.
 */
let _abrirTarjetaProfesorFlotante = null;
function registrarAbrirTarjetaProfesorFlotante(fn) {
  _abrirTarjetaProfesorFlotante = fn;
}

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * ya visto en todo plan/*.js): estas 2 líneas estaban a nivel de módulo —
 * y acá era aún más frágil que en los otros archivos, porque no solo
 * ESCRIBÍAN `estado.X`, sino que además LEÍAN `estado.X` en el mismo
 * statement (`estado.X = estado.X || new Map()`) — cualquiera de las dos
 * operaciones alcanza para disparar el ReferenceError si `estado` todavía
 * está en su TDZ (zona muerta temporal) en ese punto del grafo de imports.
 * Se mueven a una función lazy, llamada desde los 2 puntos de entrada
 * reales de este archivo (construirTarjetaSemestre y construirSeccionNotas
 * — esta última se reusa suelta desde agenda-materia.js, sin pasar por
 * construirTarjetaSemestre, así que necesita su propia guardia también).
 */
function inicializarEstadoTarjetasSemestresSiHaceFalta() {
  if (!estado.semestresExpandidos) estado.semestresExpandidos = new Map();
  if (!estado.criteriosExpandidos) estado.criteriosExpandidos = new Map();
  if (typeof estado.vistaNotaPuntajeAngosta === "undefined") estado.vistaNotaPuntajeAngosta = "nota";
}

/**
 * Fase 8 — Drag and drop (2026-08-04, spec completa): NO es un botón fijo
 * por materia — se activa "bajo demanda" desde la 3ra opción ("Reordenar")
 * del menú que ya se abre con long-press sobre un criterio o una
 * asignación (ver abrirMenuRapidoCriterio/abrirMenuRapidoAsignacion), y
 * afecta solo a ESA lista puntual (la de criterios de una materia, o la
 * de asignaciones de UN criterio) — nunca a toda la materia entera. Fuera
 * de estos sets no hay ningún ícono ni espacio reservado (cero impacto
 * visual/de espacio en el uso normal, pedido explícito). Es UI pura, no
 * se persiste ni se sincroniza — vive en memoria, nunca sobrevive un
 * recargue de página.
 */
const criteriosListaEnReordenar = new Set(); // ids de materia_matriculada
const asignacionesListaEnReordenar = new Set(); // ids de criterio

/**
 * Fase 8 — Drag and drop: motor genérico de arrastrar-y-soltar vía Pointer
 * Events (mouse Y touch con el mismo código — a diferencia de la API
 * nativa HTML5 Drag&Drop, que en navegadores de teléfono es poco confiable
 * dentro de contenedores con scroll). `itemEl` es la tarjeta/fila completa
 * que se mueve; `handleEl` es el ícono "⋮⋮" que dispara el arrastre — el
 * resto de la tarjeta (click para expandir, long-press para el menú) se
 * deja de escuchar por completo mientras esa lista puntual está en modo
 * reordenar (ver construirTarjetaCriterio/construirFilaAsignacion), así
 * que no hay forma de que el drag choque con esas otras acciones.
 *
 * `getContenedores()` se llama recién al iniciar cada arrastre (no una vez
 * al armar la tarjeta) para tener siempre la lista de contenedores vigente
 * — cada contenedor debe tener como hijos directos los items con
 * `dataset.id` puesto. Si el item se suelta sobre un contenedor DISTINTO
 * al de origen (y ese contenedor está en la lista), cuenta como "cruzar" —
 * quien llama decide qué hacer con eso en `onSoltar`.
 */
function iniciarArrastre(itemEl, handleEl, { getContenedores, onSoltar }) {
  handleEl.style.touchAction = "none";
  handleEl.addEventListener("pointerdown", (evDown) => {
    if (evDown.button !== undefined && evDown.button !== 0) return; // solo click izq / touch
    evDown.preventDefault();
    evDown.stopPropagation();

    const contenedorOrigen = itemEl.parentElement;
    const rectInicial = itemEl.getBoundingClientRect();
    const anchoItem = rectInicial.width;
    const alturaItem = rectInicial.height;

    const placeholder = document.createElement("div");
    placeholder.className = "arrastre-placeholder";
    placeholder.style.height = alturaItem + "px";
    contenedorOrigen.insertBefore(placeholder, itemEl);

    itemEl.classList.add("arrastrando");
    itemEl.style.position = "fixed";
    itemEl.style.zIndex = "99998";
    itemEl.style.width = anchoItem + "px";
    itemEl.style.pointerEvents = "none";
    itemEl.style.left = rectInicial.left + "px";
    itemEl.style.top = rectInicial.top + "px";
    document.body.appendChild(itemEl);

    try {
      itemEl.setPointerCapture(evDown.pointerId);
    } catch (e) {
      // Si el navegador no puede capturar (raro), el arrastre sigue
      // funcionando igual — solo se pierde la garantía de recibir el
      // pointerup aunque el dedo salga del elemento.
    }

    const contenedores = getContenedores();

    const mover = (x, y) => {
      itemEl.style.left = x - anchoItem / 2 + "px";
      itemEl.style.top = y - alturaItem / 2 + "px";

      itemEl.style.display = "none";
      const elDebajo = document.elementFromPoint(x, y);
      itemEl.style.display = "";
      if (!elDebajo) return;
      const contenedorDebajo = contenedores.find((c) => c && c.contains(elDebajo));
      if (!contenedorDebajo) return;

      const hijos = Array.from(contenedorDebajo.children).filter((h) => h !== placeholder);
      let referencia = null;
      for (const hijo of hijos) {
        const rect = hijo.getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          referencia = hijo;
          break;
        }
      }
      if (referencia) contenedorDebajo.insertBefore(placeholder, referencia);
      else contenedorDebajo.appendChild(placeholder);
    };

    const alMover = (evMove) => mover(evMove.clientX, evMove.clientY);

    const alSoltar = () => {
      itemEl.removeEventListener("pointermove", alMover);
      itemEl.removeEventListener("pointerup", alSoltar);
      itemEl.removeEventListener("pointercancel", alSoltar);
      try {
        itemEl.releasePointerCapture(evDown.pointerId);
      } catch (e) {
        // nada que limpiar si nunca se pudo capturar
      }

      const contenedorFinal = placeholder.parentElement;
      contenedorFinal.insertBefore(itemEl, placeholder);
      placeholder.remove();

      itemEl.classList.remove("arrastrando");
      itemEl.style.position = "";
      itemEl.style.zIndex = "";
      itemEl.style.width = "";
      itemEl.style.left = "";
      itemEl.style.top = "";
      itemEl.style.pointerEvents = "";
      itemEl.style.display = "";

      onSoltar(contenedorOrigen, contenedorFinal);
    };

    itemEl.addEventListener("pointermove", alMover);
    itemEl.addEventListener("pointerup", alSoltar);
    itemEl.addEventListener("pointercancel", alSoltar);
  });
}

/**
 * Fase 8 — Drag and drop: botón "✓ Listo" que saca `id` de `setListas` (uno
 * de criteriosListaEnReordenar / asignacionesListaEnReordenar) y sale del
 * modo reordenar para esa lista puntual — los handles "⋮⋮" desaparecen y
 * esa lista vuelve a su comportamiento normal (click/long-press) en el
 * próximo render. Es la única forma de salida implementada a propósito
 * (más simple y sin fugas de listeners que "tocar fuera de la lista");
 * `contenedorLista` no se usa acá pero se recibe por si a futuro hace
 * falta, ej. para un doble-check de que la lista sigue en el documento.
 */
function construirBotonListoReordenar(contenedorLista, id, setListas, onCambiar) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-secondary btn-block";
  btn.style.cssText = "font-size:0.8rem; padding:6px 10px; margin-top:2px;";
  btn.textContent = "✓ Listo";
  btn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    setListas.delete(id);
    onCambiar();
  });
  return btn;
}

/**
 * Fase 8 — Drag and drop: engancha el arrastre a cada criterio DENTRO de
 * `contCriterios` (hijos directos con `dataset.id`) — reordenarlos entre
 * sí es la única acción posible (los criterios no tienen un "padre" al
 * que cruzar). Al soltar, reasigna `orden` según la posición final en el
 * DOM y persiste.
 */
function wirearArrastreCriterios(contCriterios, mm, materia, plan, onCambiar) {
  Array.from(contCriterios.children).forEach((tarjetaCriterio) => {
    const handle = tarjetaCriterio.querySelector(".criterio-handle-mover");
    if (!handle) return;
    iniciarArrastre(tarjetaCriterio, handle, {
      getContenedores: () => [contCriterios],
      onSoltar: () => {
        const mmViva = buscarMmVivaPorId(mm.id);
        if (!mmViva) {
          mostrarToast("Esta materia se eliminó desde otro dispositivo");
          onCambiar();
          return;
        }
        const idsEnOrden = Array.from(contCriterios.children)
          .filter((el) => el.dataset && el.dataset.id)
          .map((el) => el.dataset.id);
        reordenarPorArrastre(mmViva.criterios, idsEnOrden);
        persistirCambioMateria(mmViva, materia, plan, onCambiar);
      },
    });
  });
}

/**
 * Fase 8 — Drag and drop: engancha el arrastre a cada asignación DENTRO de
 * `listaAsignaciones` (el criterio cuyo menú disparó "Reordenar"). A
 * diferencia de los criterios, acá SÍ puede "cruzar": `getContenedores`
 * busca, al vuelo y en todo el documento, cualquier
 * `.criterio-lista-asignaciones` de la MISMA materia (mismo `data-mm-id`)
 * que esté actualmente expandida — no hace falta que ese otro criterio
 * también esté en modo reordenar para poder soltar ahí (solo el item que
 * se arrastra necesita el handle).
 */
function wirearArrastreAsignaciones(listaAsignaciones, mm, materia, plan, onCambiar) {
  Array.from(listaAsignaciones.children).forEach((filaAsig) => {
    const handle = filaAsig.querySelector(".asignacion-handle-mover");
    if (!handle) return;
    iniciarArrastre(filaAsig, handle, {
      getContenedores: () => Array.from(document.querySelectorAll(`.criterio-lista-asignaciones[data-mm-id="${mm.id}"]`)),
      onSoltar: (contenedorOrigen, contenedorFinal) => {
        const mmViva = buscarMmVivaPorId(mm.id);
        if (!mmViva) {
          mostrarToast("Esta materia se eliminó desde otro dispositivo");
          onCambiar();
          return;
        }
        const criterioOrigenId = contenedorOrigen.dataset.criterioListaId;
        const criterioDestinoId = contenedorFinal.dataset.criterioListaId;
        const criterioOrigen = (mmViva.criterios || []).find((c) => c.id === criterioOrigenId);
        const criterioDestino = (mmViva.criterios || []).find((c) => c.id === criterioDestinoId);
        if (!criterioOrigen || !criterioDestino) {
          onCambiar();
          return;
        }

        const idsEnOrdenDestino = Array.from(contenedorFinal.children)
          .filter((el) => el.dataset && el.dataset.id)
          .map((el) => el.dataset.id);

        if (criterioOrigenId === criterioDestinoId) {
          reordenarPorArrastre(criterioOrigen.asignaciones, idsEnOrdenDestino);
          sellarTimestamp(criterioOrigen);
        } else {
          // Se soltó en un criterio DISTINTO al de origen: la asignación
          // que "cruzó" es la que aparece en el orden final pero todavía
          // no estaba en las asignaciones actuales del destino.
          const idsYaEnDestino = new Set((criterioDestino.asignaciones || []).map((a) => a.id));
          const idMovida = idsEnOrdenDestino.find((id) => !idsYaEnDestino.has(id));
          const asignacionMovida = idMovida && (criterioOrigen.asignaciones || []).find((a) => a.id === idMovida);
          if (asignacionMovida) {
            // Sale de origen CON tumba (no es un borrado real, pero sin la
            // tumba un sync desde otro dispositivo que no vio este cruce
            // podría "resucitarla" de vuelta en el criterio de origen —
            // ver comentario de _eliminados_asignaciones en schema.js).
            criterioOrigen.asignaciones = (criterioOrigen.asignaciones || []).filter((a) => a.id !== idMovida);
            criterioOrigen._eliminados_asignaciones = criterioOrigen._eliminados_asignaciones || [];
            criterioOrigen._eliminados_asignaciones.push(crearEntradaTumba(idMovida));
            repartirEquitativoCriterio(criterioOrigen);
            sellarTimestamp(criterioOrigen);

            criterioDestino.asignaciones = criterioDestino.asignaciones || [];
            criterioDestino.asignaciones.push(asignacionMovida);
            reordenarPorArrastre(criterioDestino.asignaciones, idsEnOrdenDestino);
            repartirEquitativoCriterio(criterioDestino);
            sellarTimestamp(criterioDestino);
            sellarTimestamp(asignacionMovida);
          }
        }

        persistirCambioMateria(mmViva, materia, plan, onCambiar);
      },
    });
  });
}
// Puntaje por fila (nunca los dos), con flechas para alternar — "nota" es
// el default pedido. Es un solo toggle global (no por criterio/materia) a
// propósito: si cada fila tuviera su propio estado, alternar una tarjeta no
// cambiaría las demás y la vista quedaría inconsistente entre materias.
// FIX (mismo bug de arranque): `estado.vistaNotaPuntajeAngosta = ...` también
// estaba a nivel de módulo — se agregó a inicializarEstadoTarjetasSemestresSiHaceFalta()
// más arriba, ver ese comentario.

// Mismo umbral en los 3 lugares de este archivo que necesitan detectar
// "pantalla angosta" (pills Nota/Puntaje, "Puntos totales:"→"Pts:", "X% de
// la materia"→"X%") — evaluado en cada render.
const ANCHO_PANTALLA_ANGOSTA = 480;

// FIX (reportado: "solo funciona en modo móvil, no en PC con ventana
// angosta"): la causa era justo lo que decía el comentario anterior — se
// evalúa `angosta` en cada render, pero nada disparaba un render cuando
// SOLO cambiaba el tamaño de la ventana. En un celular el ancho ya es
// angosto desde la primera carga (por eso "funcionaba" ahí, por
// casualidad), pero en PC, angostar la ventana a mano no dispara ningún
// otro evento de la app, así que el layout quedaba congelado con el
// `angosta` calculado en el último render real. Acá se guarda el último
// onCambiar recibido (se refresca en cada construirTarjetaSemestre) y se
// vuelve a llamar, con debounce, cuando el usuario termina de arrastrar el
// borde de la ventana.
let _ultimoOnCambiarParaResize = null;
let _resizeTimeoutId = null;
if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    clearTimeout(_resizeTimeoutId);
    _resizeTimeoutId = setTimeout(() => {
      if (_ultimoOnCambiarParaResize) _ultimoOnCambiarParaResize();
    }, 150);
  });
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function formatearFechaLarga(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).split("-").map(Number);
  if (!anio || !mes || !dia) return fechaISO;
  return `${dia} de ${MESES_LARGOS[mes - 1]} del ${anio}`;
}

function creditosTotalesSemestre(semestre, obtenerPlanPorId) {
  return (semestre.materias_matriculadas || []).reduce((total, mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return total + (materia ? Number(materia.creditos) || 0 : 0);
  }, 0);
}

function textoBadgeUniversidad(universidad) {
  if (!universidad) return "?";
  return universidad.length > 14 ? obtenerIniciales(universidad) : universidad;
}

/**
 * Entrega 3: reemplaza el toast genérico de antes ("no hay nada que
 * elegir — se resuelve solo") — ahora que materia-matriculada y criterio
 * pasan por marcarConflictoSiCorresponde (ver storage-merge.js), sí hay
 * datos reales que comparar. Reutiliza el mismo modal que ya usan las
 * materias del plan (ver abrirModalResolverConflictoGenerico).
 */
/**
 * Fix (2026-08-02, bug "a veces sí, a veces no"): estado.datos se reemplaza
 * por un objeto nuevo en cada sync (cada 9s) — si el modal de conflicto
 * queda abierto más de eso, la referencia capturada al abrirse queda
 * huérfana. abrirModalResolverConflictoGenerico ahora exige un getter que
 * vuelve a buscar la entidad viva justo antes de resolver; estos 3 helpers
 * arman ese getter navegando estado.datos por id en cada nivel.
 */
/** Busca una materia-matriculada viva por id en CUALQUIER semestre — mm.id
 *  es un uuid único en toda la app (ver crearMateriaMatriculada, schema.js),
 *  así que no hace falta saber de qué semestre viene para encontrarla de
 *  nuevo; evita tener que threadear semestre.id por las firmas de
 *  construirTarjetaCriterio/construirFilaAsignacion/etc, que hoy no lo
 *  reciben. */
function buscarMmVivaPorId(mmId) {
  for (const semestreVivo of estado.datos.semestres || []) {
    const mmVivo = (semestreVivo.materias_matriculadas || []).find((m) => m.id === mmId);
    if (mmVivo) return mmVivo;
  }
  return null;
}

/**
 * Fix (2026-08-02, causa raíz de "a veces creo una asignación y no se crea
 * pero la nota cambia igual"): el mismo problema de referencia obsoleta que
 * ya se arregló para el modal de conflictos (ver comentario arriba) también
 * afecta a CUALQUIER edición de criterios/asignaciones, no solo al modal de
 * conflicto — fusionarMateriaMatriculada/fusionarCriterio (storage-merge.js)
 * generan un objeto `mm`/`criterio` NUEVO en cada sync (cada ~9s), incluso
 * cuando no hay ningún conflicto real. Si el usuario tarda más de eso en
 * llenar el modal de "Nueva asignación" (algo normal escribiendo una nota),
 * el `criterio`/`mm` capturados al abrir el modal quedan huérfanos: el
 * push de la nueva asignación termina escribiendo en un array que ya no es
 * el que vive en estado.datos — la asignación "desaparece" en silencio, y
 * el recálculo de nota_final que sí corre (sobre el `mm` huérfano) no se ve
 * reflejado en la UI, dando la sensación de "la nota cambió mal". Por eso
 * cada función que MUTA un criterio o una asignación abajo vuelve a buscar
 * la mm/criterio VIVOS por id justo antes de escribir, en vez de confiar en
 * la referencia que llegó por parámetro (que solo sirve para leer/mostrar
 * al momento de abrir el modal).
 */
function buscarCriterioVivoPorId(mmId, criterioId) {
  const mmVivo = buscarMmVivaPorId(mmId);
  if (!mmVivo) return null;
  return (mmVivo.criterios || []).find((c) => c.id === criterioId) || null;
}

function abrirModalResolverConflictoMatricula(mm, materia, plan, onCambiar) {
  const mmId = mm.id;
  abrirModalResolverConflictoGenerico({
    entidad: mm,
    plan,
    titulo: "⚠️ Matrícula editada en dos dispositivos",
    explicacion:
      `"${aplicarFormatoTexto(materia.nombre)}" (${materia.codigo}) se editó de forma distinta en dos ` +
      "dispositivos antes de que sincronizaran entre sí — puede ser el estado de la nota, un criterio o una " +
      "asignación. Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
    obtenerFresca: () => buscarMmVivaPorId(mmId),
  });
}

function abrirModalResolverConflictoCriterio(criterio, mm, materia, plan, onCambiar) {
  const mmId = mm.id;
  const criterioId = criterio.id;
  abrirModalResolverConflictoGenerico({
    entidad: criterio,
    plan,
    titulo: "⚠️ Criterio editado en dos dispositivos",
    explicacion:
      `El criterio "${criterio.nombre}" de "${aplicarFormatoTexto(materia.nombre)}" se editó de forma ` +
      "distinta en dos dispositivos antes de que sincronizaran entre sí. Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
    obtenerFresca: () => {
      const mmVivo = buscarMmVivaPorId(mmId);
      if (!mmVivo) return null;
      return (mmVivo.criterios || []).find((c) => c.id === criterioId) || null;
    },
  });
}

function abrirModalResolverConflictoSemestre(semestre, onCambiar) {
  const semestreId = semestre.id;
  abrirModalResolverConflictoGenerico({
    entidad: semestre,
    titulo: "⚠️ Semestre editado en dos dispositivos",
    explicacion:
      `"${semestre.nombre}" se editó de forma distinta en dos dispositivos antes de que sincronizaran entre sí. ` +
      "Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
    obtenerFresca: () => (estado.datos.semestres || []).find((s) => s.id === semestreId) || null,
  });
}

/**
 * Punto 4 (badge ⚠️ global + "ver todos los choques"): hasta acá, la única
 * forma de encontrar un conflicto era toparse con su ⚠️ chiquito navegando
 * tarjeta por tarjeta — nada avisaba "hay N choques en total" ni dejaba
 * verlos juntos. contarConflictosGlobales() (storage-sync.js) hace el
 * conteo para el badge; esta función arma la LISTA completa (con etiqueta
 * legible + un resolver ya enganchado) recorriendo estado.datos exactamente
 * igual: planes → materias, semestres → materias_matriculadas → criterios,
 * y los semestres mismos. Cada fila reutiliza el resolver específico que
 * ya existe para ese tipo de entidad (mismo modal de siempre) — este
 * listado no inventa una forma nueva de resolver, solo las junta.
 */
function listarTodosLosConflictos() {
  const items = [];

  (estado.datos.planes_estudio || []).forEach((plan) => {
    (plan.materias || []).forEach((materia) => {
      if (materia._conflicto) {
        items.push({
          etiqueta: `📚 ${aplicarFormatoTexto(materia.nombre)} (${materia.codigo})`,
          resolver: () => abrirModalResolverConflicto(materia, plan, alResolverUnConflictoGlobal),
        });
      }
    });
  });

  (estado.datos.semestres || []).forEach((semestre) => {
    if (semestre._conflicto) {
      items.push({
        etiqueta: `📅 Semestre "${semestre.nombre}"`,
        resolver: () =>
          abrirModalResolverConflictoSemestre(semestre, () => {
            renderizarSemestres();
            alResolverUnConflictoGlobal();
          }),
      });
    }

    (semestre.materias_matriculadas || []).forEach((mm) => {
      const plan = (estado.datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
      const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
      const nombreMateria = materia ? `${aplicarFormatoTexto(materia.nombre)} (${materia.codigo})` : "una materia matriculada";

      if (mm._conflicto) {
        items.push({
          etiqueta: `📝 Matrícula de ${nombreMateria}`,
          resolver: () =>
            abrirModalResolverConflictoMatricula(mm, materia || { nombre: "?", codigo: "?" }, plan, () => {
              renderizarSemestres();
              alResolverUnConflictoGlobal();
            }),
        });
      }

      (mm.criterios || []).forEach((criterio) => {
        if (criterio._conflicto) {
          items.push({
            etiqueta: `🎯 Criterio "${criterio.nombre}" de ${nombreMateria}`,
            resolver: () =>
              abrirModalResolverConflictoCriterio(criterio, mm, materia || { nombre: "?", codigo: "?" }, plan, () => {
                renderizarSemestres();
                alResolverUnConflictoGlobal();
              }),
          });
        }
      });
    });
  });

  return items;
}

/** Guarda la referencia al overlay abierto del modal global para poder
 *  reconstruirlo (con la lista ya achicada) justo después de resolver
 *  una fila, sin dejarlo huérfano ni cerrarlo de golpe. */
let overlayTodosLosConflictosActivo = null;

function alResolverUnConflictoGlobal() {
  // Refresca el badge (¿bajó el conteo? ¿llegó a 0?) apenas se resuelve
  // cualquier fila, no solo cuando corre el sondeo cada 9s.
  actualizarIndicadorSync();
  if (overlayTodosLosConflictosActivo && document.body.contains(overlayTodosLosConflictosActivo)) {
    abrirModalTodosLosConflictos();
  }
}

function abrirModalTodosLosConflictos() {
  document.querySelectorAll(".overlay-todos-conflictos").forEach((el) => el.remove());

  const items = listarTodosLosConflictos();

  const overlay = document.createElement("div");
  overlay.className = "overlay-todos-conflictos";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";
  overlayTodosLosConflictosActivo = overlay;

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:80vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  const tituloEl = document.createElement("h3");
  tituloEl.style.cssText = "margin:0 0 4px;";
  tituloEl.textContent = "⚠️ Cambios pendientes de resolver";
  caja.appendChild(tituloEl);

  const explicacionEl = document.createElement("p");
  explicacionEl.style.cssText = "font-size:0.85rem; opacity:0.85; margin:0 0 14px;";
  explicacionEl.textContent =
    items.length === 0
      ? "No hay ningún choque pendiente en este momento."
      : `Se editó lo mismo desde dos dispositivos distintos antes de que sincronizaran entre sí, en ${items.length} ${
          items.length === 1 ? "lugar" : "lugares"
        }. Elegí uno para resolverlo — esta lista se actualiza sola al terminar.`;
  caja.appendChild(explicacionEl);

  items.forEach((item) => {
    const fila = document.createElement("button");
    fila.type = "button";
    fila.className = "btn btn-secondary btn-block";
    fila.style.cssText = "text-align:left; margin-bottom:6px;";
    fila.textContent = item.etiqueta;
    fila.addEventListener("click", () => item.resolver());
    caja.appendChild(fila);
  });

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.className = "btn btn-secondary btn-block";
  btnCerrar.style.marginTop = items.length === 0 ? "0" : "10px";
  btnCerrar.textContent = "Cerrar";
  btnCerrar.addEventListener("click", () => overlay.remove());
  caja.appendChild(btnCerrar);

  overlay.appendChild(caja);
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

/* =========================================================================
   Fase 6 — Motor de notas: helpers de datos (redondeo, tumbas, cálculo)
   ========================================================================= */

/**
 * Fix (2026-08-02, "las calificaciones deben aceptar , y . por igual"):
 * <input type="number"> rechaza la coma decimal de plano en locale en-US —
 * el teclado numérico de muchos teléfonos en español la inserta por
 * defecto, y el campo quedaba con el valor vacío/inválido sin avisar nada
 * (el usuario escribía "8,5" y el input simplemente no lo aceptaba). Los
 * campos decimales de este archivo ahora son texto + teclado decimal (ver
 * agregarCampoModal) y se analizan acá en vez de con Number() directo.
 */
function analizarDecimal(texto) {
  if (texto === null || texto === undefined) return NaN;
  const limpio = String(texto).trim().replace(",", ".");
  if (limpio === "") return NaN;
  return Number(limpio);
}

/** Formato compacto para mostrar números en la UI (máx. 1 decimal, sin ceros de más). */
function formatearNumero(n) {
  const num = Number(n) || 0;
  const redondeado = Math.round(num * 10) / 10;
  return Number.isInteger(redondeado) ? String(redondeado) : redondeado.toFixed(1);
}

/**
 * Igual que formatearNumero, pero letras-safe: notaMinimaParaFraccion puede
 * devolver una letra ("A-", "B+", etc.) en vez de un número cuando la
 * escala activa es "letras" — en ese caso se muestra tal cual, sin pasar
 * por formatearNumero (que la convertiría a 0).
 */
function formatearNotaCruda(valor) {
  return typeof valor === "string" ? valor : formatearNumero(valor);
}

/**
 * Ajuste (2026-08-02, pedido explícito): "nota" (la cruda, sin redondeo de
 * la universidad) siempre se muestra con 2 decimales fijos — a diferencia
 * de formatearNumero (máx. 1, sin ceros de más), que es el formato correcto
 * para "nota final" (la que ya pasó por aplicarRedondeoRaspando).
 */
/**
 * Ajuste (2026-08-02, pedido explícito): "nota" (la cruda, sin redondeo de
 * la universidad) siempre se muestra con 2 decimales fijos — a diferencia
 * de formatearNumero (máx. 1, sin ceros de más), que es el formato correcto
 * para "nota final" (la que ya pasó por el redondeo al 5 más cercano).
 *
 * FIX 3 (pedido explícito: "la nota sí sale bien 67.597618 pero en Nota se
 * redondea a 67.60, esto no me sirve, necesito saber la nota EXACTA pero
 * que se corte a 2 decimales solamente"): esto nunca fue un bug de arrastre
 * de coma flotante — 67.597618 redondeado a 2 decimales SÍ da 67.60, eso es
 * matemáticamente correcto. Lo que se pedía en realidad es TRUNCAR (cortar
 * el número tal cual, sin subir el último dígito), no redondear. Se
 * mantiene la limpieza con toPrecision(12) por las dudas (evita que ruido
 * de cálculo tipo 67.589999999999996 se trunque mal a 67.58 en vez de
 * 67.59), pero el redondeo final pasa de Math.round a Math.trunc.
 */
function formatearNumeroFijo(n, decimales) {
  const num = Number(n) || 0;
  const limpio = Number(num.toPrecision(12));
  const factor = Math.pow(10, decimales);
  const truncado = Math.trunc(limpio * factor) / factor;
  return truncado.toFixed(decimales);
}

/**
 * Mismo patrón real confirmado en plan-gestionar.js (eliminarPlanEstudio):
 * la tumba usa Date.now() de pared, NO el reloj lógico de sellarTimestamp
 * — fusionarTumbas (storage-merge.js) solo necesita que "más reciente"
 * tenga sentido entre dos borrados del MISMO id, y ese desempate sí puede
 * vivir en tiempo de pared porque nunca compite contra una edición viva
 * (que sí usa el reloj lógico) dentro de la misma comparación.
 */
function crearEntradaTumba(id) {
  return { id, eliminadoEn: Date.now() };
}

// "✨ Extra" (es_extra:true) se excluye SIEMPRE de este total: son puntos
// que se suman aparte del 100% de la materia (ver crearCriterio en
// schema.js), así que no deben competir por el mismo presupuesto que los
// criterios normales — ni bloquear "+ Nuevo criterio"/"Proyectar" cuando
// los normales ya suman 100% pero todavía hay espacio para agregar extra.
function sumaValorTotalCriterios(mm, excluirId) {
  return (mm.criterios || []).reduce(
    (total, c) => total + (c.id === excluirId || c.es_extra ? 0 : Number(c.valor_total) || 0),
    0
  );
}

function sumaValorAsignaciones(criterio, excluirId) {
  return (criterio.asignaciones || []).reduce((total, a) => total + (a.id === excluirId ? 0 : Number(a.valor) || 0), 0);
}

/**
 * FIX (2026-08-06 — "el disponible marca 25 en vez de 15 con 30+30 de 75"):
 * a diferencia de sumaValorAsignaciones, esta NO cuenta las asignaciones en
 * modo "automatico" — su .valor es solo la última foto de un reparto
 * equitativo (ver repartirEquitativoCriterio en schema.js), no un espacio
 * reservado de verdad, porque se vuelven a repartir solas apenas algo
 * cambia. Para saber cuánto espacio le queda LIBRE a una "personalizado"
 * (nueva o existente), solo hay que restar lo que otras "personalizado"
 * ya se llevaron fijo — el resto sigue disponible para repartirse. Misma
 * regla que ya usaba calcularValorEquitativoEstimado más abajo.
 */
function sumaValorPersonalizadoAsignaciones(criterio, excluirId) {
  return (criterio.asignaciones || []).reduce(
    (total, a) => total + (a.id === excluirId || a.modo_valor !== "personalizado" ? 0 : Number(a.valor) || 0),
    0
  );
}

/**
 * Calcula el valor vigente de nota_final SIN mutar mm — para mostrar en
 * pantalla en cada render. Si hay override manual activo, es simplemente
 * mm.nota_final tal cual (no se recalcula).
 */
function calcularNotaFinalVigente(mm, materia, plan) {
  if (mm.nota_final_manual) return mm.nota_final;
  const escala = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  const base = calcularNotaFinalMateria(mm, escala);
  // "✨ Extra" como criterio real (reemplaza a la Fase 7 original — un bono
  // plano guardado en mm.puntos_extra): calcularNotaFinalMateria ya suma
  // los criterios con es_extra:true junto con los normales (no distingue),
  // así que acá no hace falta tratamiento especial para ellos. Lo de abajo
  // es SOLO compatibilidad hacia atrás con mm.puntos_extra de materias
  // matriculadas de antes de este cambio — la UI ya no lo escribe. Se
  // acota siempre al techo de la escala activa. Si la escala activa
  // devuelve una letra en vez de un número (ver notaMinimaParaFraccion /
  // escala "letras"), no hay nada numérico sobre lo cual sumar el bono, así
  // que se ignora sin explotar — typeof base === "number" cubre ese caso.
  const extraLegado = Number(mm.puntos_extra) || 0;
  if (extraLegado > 0 && typeof base === "number") {
    return Math.min(base + extraLegado, escala);
  }
  return base;
}

/**
 * Recalcula Y PERSISTE mm.nota_final — nunca pisa un override manual activo.
 * FIX sync (2026-08-02): antes esto se llamaba también directamente desde
 * el render de la tarjeta (fuera de un flujo de edición real), lo que
 * mutaba mm.nota_final en el objeto sincronizable SIN pasar por
 * sellarTimestamp() — quedaba contenido nuevo con un _version_base viejo.
 * Contra una copia remota que nunca había tocado ese campo (materias
 * creadas antes del motor de notas), eso se veía como un conflicto real
 * en cada sync. Ahora esta función SOLO se llama desde
 * persistirCambioMateria, que sella el timestamp en el mismo paso; el
 * render usa calcularNotaFinalVigente (arriba), que no muta nada.
 */
function recalcularNotaFinal(mm, materia, plan) {
  if (mm.nota_final_manual) return;
  mm.nota_final = calcularNotaFinalVigente(mm, materia, plan);
}

/** Punto único de persistencia tras cualquier cambio de criterios/asignaciones. */
function persistirCambioMateria(mm, materia, plan, onCambiar) {
  recalcularNotaFinal(mm, materia, plan);
  sellarTimestamp(mm);
  marcarCambioPendiente();
  onCambiar();
}

/* =========================================================================
   Fase 6 — Modales dinámicos (sin tocar index.html): reutilizan las clases
   .modal-overlay/.modal-card/.form-input/.form-label ya definidas en
   design-system.css, igual que los modales estáticos existentes, pero
   armados 100% en JS — mismo mecanismo que ya usan los popovers de
   long-press (abrirMenuRapidoEstadoMatricula, etc.), solo que a tamaño modal.
   ========================================================================= */

/**
 * Fase 6.2: tocar fuera del modal (overlay) o la X ya NO cierran a lo loco
 * si hay cambios sin guardar — "sucio" se prende solo con cualquier
 * input/change dentro de la tarjeta (delegado, no hay que acordarse de
 * marcarlo a mano en cada modal nuevo). Tocar fuera con cambios pendientes
 * no hace nada (se queda quieto, no pierde nada); la X sí permite salir,
 * pero primero confirma con el mismo componente de confirmación que ya se
 * usa para eliminar criterios/asignaciones — misma estética, nada nuevo.
 *
 * confirmarCierre=false (pedido explícito 2026-08-03): para modales que NO
 * persisten nada (ej. el simulador "Proyectar", que es puro cálculo en
 * memoria) el rastreo de "sucio" ni siquiera se activa — cerrar() siempre
 * hace overlay.remove() directo, tocar fuera y la X funcionan siempre.
 * Esto evita el aviso de "cerrar sin guardar" en modales donde no hay nada
 * que guardar; solo debe aparecer al crear/editar asignaciones o criterios
 * reales.
 */
function crearModalDinamico({ titulo, ancha, confirmarCierre = true }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "glass-card modal-card stack" + (ancha ? " modal-card-ancha" : "");
  card.style.gap = "14px";

  let sucio = false;
  const marcarSucio = () => { if (confirmarCierre) sucio = true; };
  card.addEventListener("input", marcarSucio);
  card.addEventListener("change", marcarSucio);
  card.addEventListener("click", (e) => {
    // Cubre botones tipo pill (ej. selector de letras) que sí burbujean —
    // los que no (switchDosOpciones) avisan aparte con su propio "change".
    if (e.target.closest("button") && !e.target.closest(".modal-x-close")) marcarSucio();
  });

  // Ajuste (2026-08-04, pedido explícito): Enter en una casilla de una sola
  // línea (<input>) activa el botón de Guardar — comportamiento centralizado
  // acá para que aplique igual en TODOS los modales que usan este helper,
  // sin tener que repetirlo en cada uno. Deliberadamente NO reacciona sobre
  // <textarea>: ahí Enter debe seguir siendo un salto de línea normal, sin
  // ningún atajo de teclado que dispare el guardado (el guardado en esas
  // casillas es solo por el botón). Shift+Enter tampoco dispara nada en
  // ningún caso — con inputs de una sola línea no hay salto de línea que
  // insertar, así que se ignora sin más.
  card.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    if (!e.target || e.target.tagName !== "INPUT") return;
    e.preventDefault();
    // El botón Guardar de cada modal usa siempre "btn-primary btn-block"
    // (ver el resto de este archivo) — a diferencia de los switches de dos
    // opciones (agregarSwitchDosOpciones), que también usan "btn-primary"
    // para marcar la opción activa pero SIN "btn-block", así que este
    // selector nunca los confunde entre sí.
    const btnGuardar = card.querySelector(".btn-primary.btn-block");
    if (btnGuardar && !btnGuardar.disabled) btnGuardar.click();
  });

  function cerrar() {
    if (!sucio) {
      overlay.remove();
      return;
    }
    abrirConfirmacion({
      titulo: "¿Cerrar sin guardar?",
      mensaje: "Vas a perder los cambios que hiciste acá.",
      textoConfirmar: "Cerrar sin guardar",
      onConfirmar: () => overlay.remove(),
    });
  }

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.className = "modal-x-close";
  btnX.setAttribute("aria-label", "Cerrar");
  btnX.textContent = "✕";
  btnX.addEventListener("click", cerrar);
  card.appendChild(btnX);

  if (titulo) {
    const h = document.createElement("h3");
    h.style.margin = "0";
    h.textContent = titulo;
    card.appendChild(h);
  }

  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    // Tocar fuera: solo cierra si NO hay nada sin guardar. Con "sucio" en
    // true, no pasa nada — ni cierra ni borra, se queda tal cual.
    if (e.target === overlay && !sucio) overlay.remove();
  });
  document.body.appendChild(overlay);
  return { overlay, card, marcarSucio };
}

function agregarCampoModal(card, { etiqueta, tipo, valor, paso, decimal }) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = etiqueta;
  wrap.appendChild(label);

  const input = document.createElement("input");
  if (decimal) {
    // Fix (2026-08-02): texto + teclado numérico decimal en vez de
    // type="number", para poder aceptar coma y punto por igual — ver
    // analizarDecimal(), que es quien debe leer el valor de este input,
    // nunca Number(input.value) directo.
    input.type = "text";
    input.inputMode = "decimal";
  } else {
    input.type = tipo || "text";
    if (paso) input.step = paso;
  }
  input.className = "form-input";
  if (valor !== undefined && valor !== null) input.value = valor;
  wrap.appendChild(input);

  card.appendChild(wrap);
  return input;
}

/**
 * Switch de dos opciones (ej. Automático/Personalizado, Nota/Puntos) — dos
 * botones exclusivos, mismo patrón visual btn-primary/btn-secondary que ya
 * se usa en el resto del proyecto. Devuelve { obtenerValor } para leer la
 * opción activa al momento de guardar.
 */
function agregarSwitchDosOpciones(card, { etiqueta, opciones, valorInicial, onCambiar }) {
  const wrap = document.createElement("div");
  if (etiqueta) {
    const label = document.createElement("label");
    label.className = "form-label";
    label.textContent = etiqueta;
    wrap.appendChild(label);
  }

  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.cssText = "gap:8px;";

  let valorActual = valorInicial;
  const botones = {};

  opciones.forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn " + (op.valor === valorActual ? "btn-primary" : "btn-secondary");
    btn.style.flex = "1";
    btn.textContent = op.texto;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (valorActual === op.valor) return;
      valorActual = op.valor;
      Object.keys(botones).forEach((v) => {
        botones[v].className = "btn " + (v === valorActual ? "btn-primary" : "btn-secondary");
      });
      // Fase 6.2: este click no burbujea (stopPropagation arriba), así que
      // el dirty-tracking del modal (crearModalDinamico, delegado en
      // input/change) no se entera solo — se avisa a mano con un evento
      // fresco que sí burbujea.
      wrap.dispatchEvent(new Event("change", { bubbles: true }));
      if (onCambiar) onCambiar(valorActual);
    });
    botones[op.valor] = btn;
    fila.appendChild(btn);
  });

  wrap.appendChild(fila);
  card.appendChild(wrap);
  return { obtenerValor: () => valorActual };
}

/* ===================== Modal: crear/editar criterio ===================== */

/**
 * Crear/editar un criterio NORMAL (compite por el 100% de la materia).
 *
 * Corrección de diseño (2026-08-07 v2): el criterio "✨ Extra" ya NO se crea
 * acá — se crea directo, sin modal (ver crearCriterioExtraDirecto), porque
 * no tiene un tope fijo que preguntar. Este modal solo lo sigue tocando
 * para EDITAR un "✨ Extra" ya existente (rama `esEdicionExtra` abajo), y
 * ahí solo deja renombrarlo — el campo de valor no aplica (sus puntos salen
 * de sumar las asignaciones de adentro, ver calcularPuntosCriterio).
 */
function abrirModalCriterio({ mm, materia, plan, escalaActiva, criterioExistente, onGuardado }) {
  const esEdicion = !!criterioExistente;
  const esEdicionExtra = esEdicion && !!criterioExistente.es_extra;
  const { overlay, card } = crearModalDinamico({
    titulo: esEdicionExtra ? "Editar ✨ Extra" : esEdicion ? "Editar criterio" : "Nuevo criterio",
  });

  const inputNombre = agregarCampoModal(card, {
    etiqueta: "Nombre (ej. Exámenes)",
    tipo: "text",
    valor: esEdicion ? criterioExistente.nombre : "",
  });

  // FIX (2026-08-08 — "no tiene sentido que la nota final sea un 10 si los
  // puntos repartidos son de 100"): criterio.valor_total sigue
  // GUARDÁNDOSE en 0-100 internamente (es el peso del criterio dentro de
  // la materia, no depende de la escala) — pero ahora se MUESTRA y se
  // EDITA en la escala activa del plan, igual que ya se hizo con
  // nota_aprobacion y nota_final. Así todos los números que ve el usuario
  // hablan el mismo idioma: si la escala es 0-10, "vale 3 de 10" en vez
  // de "vale 30%".
  const descriptorEscalaCriterio = obtenerEscalaPorId(escalaActiva);
  const esLetrasCriterio = descriptorEscalaCriterio.tipo === "letras";
  const unidadCriterio = esLetrasCriterio ? "%" : formatearNumero(descriptorEscalaCriterio.max);

  // "✨ Extra" no tiene un valor_total fijo que editar (ver comentario de
  // arriba) — el modal, en ese caso, es solo el campo de nombre.
  let inputValor = null;
  if (!esEdicionExtra) {
    inputValor = agregarCampoModal(card, {
      etiqueta: esLetrasCriterio ? "Valor dentro de la materia (%)" : `Valor dentro de la materia (sobre ${unidadCriterio})`,
      valor: esEdicion ? formatearNumero(convertirDesde100(criterioExistente.valor_total, descriptorEscalaCriterio)) : "",
      decimal: true,
    });
    const disponibleEstimado100 = 100 - sumaValorTotalCriterios(mm, esEdicion ? criterioExistente.id : undefined);
    const disponibleEstimado = convertirDesde100(disponibleEstimado100, descriptorEscalaCriterio);
    const ayuda = document.createElement("p");
    ayuda.className = "muted";
    ayuda.style.fontSize = "0.8rem";
    ayuda.style.margin = "0";
    ayuda.textContent = esLetrasCriterio
      ? `Disponible en esta materia: ${formatearNumero(disponibleEstimado)}%`
      : `Disponible en esta materia: ${formatearNumero(disponibleEstimado)} de ${unidadCriterio}`;
    card.appendChild(ayuda);
  }

  const mmId = mm.id;
  const criterioId = esEdicion ? criterioExistente.id : null;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    // valorEnEscala = lo que el usuario tipeó/ve (unidad de la escala);
    // valorNum = lo mismo convertido a 0-100 para guardar — todo el resto
    // del método (sumaValorTotalCriterios, validaciones contra otros
    // criterios) sigue trabajando en 0-100 sin tocarse, solo cambia qué
    // unidad ve y tipea la persona.
    const valorEnEscala = esEdicionExtra ? null : analizarDecimal(inputValor.value);
    const valorNum = esEdicionExtra ? null : convertirA100(valorEnEscala, descriptorEscalaCriterio);

    if (!nombre) {
      mostrarToast("Ponele un nombre al criterio");
      return;
    }
    if (!esEdicionExtra && (!Number.isFinite(valorEnEscala) || valorEnEscala <= 0)) {
      mostrarToast("El valor debe ser un número mayor a 0");
      return;
    }

    // Fix (2026-08-02): se vuelve a buscar la mm viva justo antes de
    // escribir — ver buscarCriterioVivoPorId más arriba. `mm`/`criterioExistente`
    // capturados al abrir el modal solo se usan para leer/mostrar.
    const mmViva = buscarMmVivaPorId(mmId);
    if (!mmViva) {
      mostrarToast("Esta materia se eliminó desde otro dispositivo — no se pudo guardar");
      overlay.remove();
      onGuardado();
      return;
    }
    if (!esEdicionExtra) {
      const disponibleReal = 100 - sumaValorTotalCriterios(mmViva, criterioId || undefined);
      if (valorNum > disponibleReal + 0.001) {
        const disponibleRealMostrado = convertirDesde100(disponibleReal, descriptorEscalaCriterio);
        mostrarToast(
          esLetrasCriterio
            ? `Ese valor supera el ${formatearNumero(disponibleRealMostrado)}% disponible en la materia`
            : `Ese valor supera el ${formatearNumero(disponibleRealMostrado)} disponible en la materia`
        );
        return;
      }
    }

    if (esEdicion) {
      const criterioVivo = (mmViva.criterios || []).find((c) => c.id === criterioId);
      if (!criterioVivo) {
        mostrarToast("Este criterio se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        onGuardado();
        return;
      }
      criterioVivo.nombre = nombre;
      if (!esEdicionExtra) {
        criterioVivo.valor_total = valorNum;
        sellarTimestamp(criterioVivo);
        // Si ya tenía asignaciones, el nuevo valor_total redistribuye el
        // reparto equitativo (misma regla confirmada que al añadir una nueva).
        if (criterioVivo.asignaciones.length > 0) repartirEquitativoCriterio(criterioVivo);
      } else {
        sellarTimestamp(criterioVivo);
      }
    } else {
      mmViva.criterios.push(
        crearCriterio({ nombre, valorTotal: valorNum, orden: siguienteOrden(mmViva.criterios) })
      );
    }

    persistirCambioMateria(mmViva, materia, plan, onGuardado);
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

function eliminarCriterio(mm, materia, plan, criterio, onCambiar) {
  const mmId = mm.id;
  const criterioId = criterio.id;
  abrirConfirmacion({
    titulo: "Eliminar criterio",
    mensaje: `¿Eliminar "${criterio.nombre}" y todas sus asignaciones? Esta acción no se puede deshacer.`,
    textoConfirmar: "Eliminar",
    onConfirmar: () => {
      const mmViva = buscarMmVivaPorId(mmId);
      if (!mmViva) {
        mostrarToast("Esto ya no existe — puede que se haya eliminado desde otro dispositivo");
        onCambiar();
        return;
      }
      mmViva.criterios = (mmViva.criterios || []).filter((c) => c.id !== criterioId);
      mmViva._eliminados_criterios = mmViva._eliminados_criterios || [];
      mmViva._eliminados_criterios.push(crearEntradaTumba(criterioId));
      persistirCambioMateria(mmViva, materia, plan, onCambiar);
    },
  });
}

/**
 * Corrección de diseño (2026-08-07 v2, pedido explícito — "no quiero que
 * pida cuántos puntos totales se les va a poner, solamente quiero que
 * exista como criterio libre"): el botón "✨ Extra" YA NO abre ningún modal
 * al crear — el criterio "✨ Extra" no tiene un tope fijo (valor_total),
 * porque cada asignación adentro declara sus propios puntos directamente
 * (ver abrirModalAsignacionExtra). Se crea de una, en silencio, y queda
 * listo para agregarle asignaciones con "+ Añadir asignación".
 */
function crearCriterioExtraDirecto(mm, materia, plan, onCambiar) {
  const mmViva = buscarMmVivaPorId(mm.id);
  if (!mmViva) {
    mostrarToast("Esta materia se eliminó desde otro dispositivo — no se pudo crear");
    onCambiar();
    return;
  }
  mmViva.criterios.push(
    crearCriterio({ nombre: "✨ Extra", valorTotal: 0, orden: siguienteOrden(mmViva.criterios), esExtra: true })
  );
  persistirCambioMateria(mmViva, materia, plan, onCambiar);
}

/**
 * Corrección de diseño (2026-08-07, pedido explícito — "Extra debe crear un
 * criterio nuevo, no una asignación suelta"): el botón "✨ Extra" solo debe
 * poder tener UN criterio por materia matriculada (a diferencia de antes,
 * que dejaba crear varios "✨ Extra" sueltos con cada clic). Si ese criterio
 * ya existe, un nuevo clic en el botón NO abre "Nuevo criterio" de nuevo —
 * en cambio, ofrece vaciar sus asignaciones (el criterio en sí permanece, y
 * sigue pudiendo tener varias asignaciones adentro vía su propio "+
 * asignación", igual que cualquier otro criterio).
 */
function vaciarAsignacionesExtra(mm, materia, plan, criterioExtra, onCambiar) {
  const mmId = mm.id;
  const criterioId = criterioExtra.id;
  abrirConfirmacion({
    titulo: "Vaciar Extra",
    mensaje: "¿Deseas eliminar todas las asignaciones de Extra?",
    textoConfirmar: "Eliminar",
    onConfirmar: () => {
      const mmViva = buscarMmVivaPorId(mmId);
      const criterioVivo = mmViva && (mmViva.criterios || []).find((c) => c.id === criterioId);
      if (!mmViva || !criterioVivo) {
        mostrarToast("Esto ya no existe — puede que se haya eliminado desde otro dispositivo");
        onCambiar();
        return;
      }
      const idsAsignaciones = (criterioVivo.asignaciones || []).map((a) => a.id);
      criterioVivo.asignaciones = [];
      criterioVivo._eliminados_asignaciones = criterioVivo._eliminados_asignaciones || [];
      idsAsignaciones.forEach((id) => criterioVivo._eliminados_asignaciones.push(crearEntradaTumba(id)));
      sellarTimestamp(criterioVivo);
      persistirCambioMateria(mmViva, materia, plan, onCambiar);
    },
  });
}

/* ===================== Modal: registrar/editar asignación ===================== */

/** Estima cuánto le tocaría a esta asignación si quedara en modo "automático", sin mutar nada — solo para mostrar en el modal antes de guardar. Sigue la misma regla que repartirEquitativoCriterio (schema.js): reparte lo que sobra tras restar las "personalizado". */
function calcularValorEquitativoEstimado(criterio, excluirId) {
  const sumaPersonalizadas = (criterio.asignaciones || [])
    .filter((a) => a.modo_valor === "personalizado" && a.id !== excluirId)
    .reduce((total, a) => total + (Number(a.valor) || 0), 0);
  const automaticasExistentes = (criterio.asignaciones || []).filter(
    (a) => a.modo_valor !== "personalizado" && a.id !== excluirId
  ).length;
  const restante = Math.max(criterio.valor_total - sumaPersonalizadas, 0);
  return restante / (automaticasExistentes + 1); // +1: esta misma asignación, nueva o recién pasada a automático
}

function abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente, onGuardado }) {
  const esEdicion = !!asignacionExistente;
  const { overlay, card } = crearModalDinamico({ titulo: esEdicion ? "Editar asignación" : "Nueva asignación" });
  // Declarado temprano (antes se declaraba más abajo, cerca del selector de
  // letras) porque ahora también lo necesita el campo "Puntos del
  // criterio" para mostrarlo en la escala activa en vez de 0-100 crudo.
  const descriptorEscala = obtenerEscalaPorId(escalaActiva);

  const inputNombre = agregarCampoModal(card, {
    etiqueta: "Nombre (ej. Examen I)",
    tipo: "text",
    valor: esEdicion ? asignacionExistente.nombre : "",
  });

  /* ---------- Valor de la asignación ---------- */
  const tituloValor = document.createElement("p");
  tituloValor.style.cssText = "font-weight:700; margin:8px 0 0; font-size:0.9rem;";
  tituloValor.textContent = "Valor de la asignación";
  card.appendChild(tituloValor);

  const modoValorInicial = esEdicion && asignacionExistente.modo_valor === "personalizado" ? "personalizado" : "automatico";
  const equitativoEstimado = calcularValorEquitativoEstimado(criterio, esEdicion ? asignacionExistente.id : undefined);

  const switchValor = agregarSwitchDosOpciones(card, {
    opciones: [
      { valor: "automatico", texto: "Automático" },
      { valor: "personalizado", texto: "Personalizado" },
    ],
    valorInicial: modoValorInicial,
    onCambiar: (modo) => {
      actualizarCampoValor(modo);
      actualizarEtiquetaCalif(switchCalif.obtenerValor());
    },
  });

  const inputValor = agregarCampoModal(card, {
    etiqueta: descriptorEscala.tipo === "letras" ? "Puntos del criterio (%)" : `Puntos del criterio (sobre ${formatearNumero(descriptorEscala.max)})`,
    valor:
      esEdicion && asignacionExistente.modo_valor === "personalizado"
        ? formatearNumero(convertirDesde100(asignacionExistente.valor, descriptorEscala))
        : "",
    decimal: true,
  });

  function actualizarCampoValor(modo) {
    if (modo === "automatico") {
      inputValor.value = formatearNumero(convertirDesde100(equitativoEstimado, descriptorEscala));
      inputValor.disabled = true;
    } else {
      inputValor.disabled = false;
      inputValor.value =
        esEdicion && asignacionExistente.modo_valor === "personalizado"
          ? formatearNumero(convertirDesde100(asignacionExistente.valor, descriptorEscala))
          : "";
    }
  }

  /* ---------- Calificación ---------- */
  const tituloCalif = document.createElement("p");
  tituloCalif.style.cssText = "font-weight:700; margin:10px 0 0; font-size:0.9rem;";
  tituloCalif.textContent = "Calificación";
  card.appendChild(tituloCalif);

  const modoCalifInicial = esEdicion && asignacionExistente.modo_calificacion === "puntos" ? "puntos" : "nota";
  const switchCalif = agregarSwitchDosOpciones(card, {
    opciones: [
      { valor: "nota", texto: "Nota" },
      { valor: "puntos", texto: "Puntos" },
    ],
    valorInicial: modoCalifInicial,
    onCambiar: (modo) => actualizarEtiquetaCalif(modo),
  });

  // FIX (2026-08-06): el input muestra el campo crudo correspondiente al
  // modo actual — `puntaje_obtenido` en modo "puntos" (nota ya no guarda
  // el crudo, guarda la nota convertida), `nota` en modo "nota". Sin esto,
  // al editar una asignación en modo "puntos" se mostraría la nota
  // convertida en vez del puntaje que el usuario realmente tipeó.
  const inputCalif = agregarCampoModal(card, {
    etiqueta: "",
    valor:
      esEdicion && modoCalifInicial === "puntos" && typeof asignacionExistente.puntaje_obtenido === "number"
        ? asignacionExistente.puntaje_obtenido
        : esEdicion && modoCalifInicial === "nota" && typeof asignacionExistente.nota === "number"
        ? asignacionExistente.nota
        : "",
    decimal: true,
  });
  const labelCalif = inputCalif.parentElement.querySelector("label");

  /* ---------- Fase 6.2: selector de letras ----------
     Si la escala activa es "letras" y el modo es "Nota" (en "Puntos"
     siempre es numérico, sin importar la escala), se oculta inputCalif y
     se muestra este selector en su lugar. Un click sobre la letra ya
     activa la deselecciona (vuelve a quedar pendiente/sin calificar). */
  let letraSeleccionada =
    esEdicion && asignacionExistente.modo_calificacion === "nota" && typeof asignacionExistente.nota === "string"
      ? asignacionExistente.nota
      : null;

  const contenedorLetras = document.createElement("div");
  contenedorLetras.className = "oculto";
  contenedorLetras.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; margin-top:4px;";
  if (descriptorEscala.tipo === "letras") {
    descriptorEscala.valores.forEach(({ letra }) => {
      const btnLetra = document.createElement("button");
      btnLetra.type = "button";
      btnLetra.className = "pill-item" + (letraSeleccionada === letra ? " active" : "");
      btnLetra.textContent = letra;
      btnLetra.addEventListener("click", () => {
        letraSeleccionada = letraSeleccionada === letra ? null : letra;
        contenedorLetras.querySelectorAll(".pill-item").forEach((b) => {
          b.classList.toggle("active", b.textContent === letraSeleccionada);
        });
      });
      contenedorLetras.appendChild(btnLetra);
    });
  }
  inputCalif.parentElement.insertAdjacentElement("afterend", contenedorLetras);

  function actualizarVisibilidadCalif(modo) {
    const usaLetras = descriptorEscala.tipo === "letras" && modo === "nota";
    inputCalif.parentElement.classList.toggle("oculto", usaLetras);
    contenedorLetras.classList.toggle("oculto", !usaLetras);
  }

  function valorVigenteParaTope() {
    return switchValor.obtenerValor() === "automatico"
      ? convertirDesde100(equitativoEstimado, descriptorEscala)
      : analizarDecimal(inputValor.value) || 0;
  }

  function actualizarEtiquetaCalif(modo) {
    actualizarVisibilidadCalif(modo);
    if (descriptorEscala.tipo === "letras" && modo === "nota") {
      labelCalif.textContent = "¿Qué nota te sacaste? (tocá una letra, o ninguna si aún no la tenés)";
      return;
    }
    labelCalif.textContent =
      modo === "puntos"
        ? `¿Cuántos puntos te dieron? (0-${formatearNumero(valorVigenteParaTope())}, dejalo vacío si aún no la tenés)`
        : `¿Qué nota te sacaste? (escala 0-${formatearNumero(descriptorEscala.max)}, dejalo vacío si aún no la tenés)`;
  }

  actualizarCampoValor(modoValorInicial);
  actualizarEtiquetaCalif(modoCalifInicial);

  // Pedido explícito: al EDITAR una asignación existente, el cuadro de nota
  // (inputCalif) debe estar enfocado por default, listo para escribir sin
  // tener que tocarlo primero — no aplica al crear una asignación nueva
  // (ahí tiene más sentido arrancar en el nombre, que es lo primero que
  // falta). Si la escala activa es de letras y el modo inicial es "Nota",
  // inputCalif está oculto (se usa el selector de letras en su lugar, ver
  // contenedorLetras) — no hay "cuadro" que enfocar en ese caso, se omite.
  if (esEdicion && !(descriptorEscala.tipo === "letras" && modoCalifInicial === "nota")) {
    requestAnimationFrame(() => inputCalif.focus());
  }

  // FIX (2026-08-08): 'disponible' vive en 0-100 internamente (mismo
  // criterio.valor_total de siempre) — se convierte a la escala solo para
  // mostrar, igual que el resto de este modal.
  const disponible100 = criterio.valor_total - sumaValorPersonalizadoAsignaciones(criterio, esEdicion ? asignacionExistente.id : undefined);
  const disponible = convertirDesde100(disponible100, descriptorEscala);
  const ayuda = document.createElement("p");
  ayuda.className = "muted";
  ayuda.style.fontSize = "0.8rem";
  ayuda.style.margin = "0";
  ayuda.textContent = `Disponible en este criterio: ${formatearNumero(disponible)} puntos`;
  card.appendChild(ayuda);

  const mmId = mm.id;
  const criterioId = criterio.id;
  const asignacionId = esEdicion ? asignacionExistente.id : null;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const modoValor = switchValor.obtenerValor();
    const modoCalif = switchCalif.obtenerValor();
    // valorNumEscala: unidad que la persona ve y tipea (escala activa).
    // valorNum100: la misma cantidad convertida a 0-100 para guardar —
    // mismo patrón que criterio.valor_total. equitativoEstimado YA está en
    // 0-100 (repartirEquitativoCriterio en schema.js trabaja en esa
    // unidad), por eso ahí no hace falta convertir para guardar, solo para
    // mostrar (ver valorVigenteParaTope).
    const valorNumEscala = modoValor === "automatico" ? convertirDesde100(equitativoEstimado, descriptorEscala) : analizarDecimal(inputValor.value);
    const valorNum100 = modoValor === "automatico" ? equitativoEstimado : convertirA100(valorNumEscala, descriptorEscala);
    const usaLetras = descriptorEscala.tipo === "letras" && modoCalif === "nota";
    const califTexto = inputCalif.value.trim();
    const califNumerico = califTexto === "" ? null : analizarDecimal(califTexto);
    const califFinal = usaLetras ? letraSeleccionada : califNumerico;

    if (!nombre) {
      mostrarToast("Ponele un nombre a la asignación");
      return;
    }
    if (modoValor === "personalizado") {
      if (!Number.isFinite(valorNumEscala) || valorNumEscala <= 0) {
        mostrarToast("El valor debe ser un número mayor a 0");
        return;
      }
    }
    if (califFinal !== null) {
      if (modoCalif === "puntos") {
        // FIX (2026-08-08): valorVigenteParaTope() ya devuelve el tope en
        // unidades de escala — antes se comparaba contra 'valorNum', que en
        // modo automático seguía siendo 0-100 (equitativoEstimado sin
        // convertir), permitiendo puntajes hasta 10x más altos de lo que
        // debía en escalas chicas.
        const topeEscala = valorVigenteParaTope();
        if (!Number.isFinite(califFinal) || califFinal < 0 || califFinal > topeEscala + 0.001) {
          mostrarToast(`Los puntos deben estar entre 0 y ${formatearNumero(topeEscala)}`);
          return;
        }
      } else if (!usaLetras && (!Number.isFinite(califFinal) || califFinal < 0 || califFinal > descriptorEscala.max)) {
        mostrarToast(`La nota debe estar entre 0 y ${formatearNumero(descriptorEscala.max)}`);
        return;
      }
      // usaLetras: califFinal ya salió del picker (solo letras reales),
      // no hace falta validar nada más acá.
    }

    // FIX DE RAÍZ (2026-08-02 — "a veces creo nuevas asignaciones y NO se
    // crean pero aun así la nota cambia igual"): `criterio`/`mm` llegaron
    // por parámetro capturados en el momento de ABRIR el modal. Si pasó un
    // sync (cada ~9s) mientras el usuario llenaba el formulario —muy común
    // escribiendo una nota con calma—, esos objetos quedaron huérfanos (ver
    // buscarCriterioVivoPorId más arriba): escribir en ellos no toca nada
    // de lo que en verdad vive en estado.datos. Antes esto pasaba en
    // silencio: el push de la nueva asignación se perdía (por eso "no se
    // crea"), pero el recálculo de nota_final SÍ corría sobre el `mm`
    // huérfano y quedaba mal (por eso "la nota cambia igual", sin ninguna
    // asignación nueva de verdad detrás). Ahora se vuelve a buscar todo
    // fresco, justo antes de escribir.
    const mmViva = buscarMmVivaPorId(mmId);
    const criterioVivo = mmViva && (mmViva.criterios || []).find((c) => c.id === criterioId);
    if (!mmViva || !criterioVivo) {
      mostrarToast("Este criterio se eliminó desde otro dispositivo — no se pudo guardar");
      overlay.remove();
      onGuardado();
      return;
    }
    const disponibleReal100 = criterioVivo.valor_total - sumaValorPersonalizadoAsignaciones(criterioVivo, asignacionId || undefined);
    if (modoValor === "personalizado" && valorNum100 > disponibleReal100 + 0.001) {
      mostrarToast(`Ese valor supera los ${formatearNumero(convertirDesde100(disponibleReal100, descriptorEscala))} puntos disponibles en el criterio`);
      return;
    }

    if (esEdicion) {
      const asignacionViva = (criterioVivo.asignaciones || []).find((a) => a.id === asignacionId);
      if (!asignacionViva) {
        mostrarToast("Esta asignación se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        onGuardado();
        return;
      }
      asignacionViva.nombre = nombre;
      asignacionViva.modo_valor = modoValor;
      asignacionViva.modo_calificacion = modoCalif;
      if (modoValor === "personalizado") asignacionViva.valor = valorNum100;
      // FIX (2026-08-06, actualizado 2026-08-08): en modo "puntos",
      // califFinal es el puntaje que el usuario tipeó EN UNIDADES DE
      // ESCALA (0 a valorVigenteParaTope()) — se convierte a 0-100 antes de
      // guardarlo en puntaje_obtenido, para que quede en la MISMA unidad
      // que `valor` (asignacionViva.valor, guardado arriba en 0-100) —
      // recalcularNotaDesdePuntaje calcula puntaje/valor directo, sin
      // convertir nada por su cuenta, así que ambos deben coincidir en
      // unidad para que esa razón siga siendo correcta. `nota` se recalcula
      // como la nota REAL equivalente en la escala activa (por eso corre
      // después de tocar asignacionViva.valor arriba). En modo "nota",
      // califFinal ES la nota tal cual, ya en su propia escala — no pasa
      // por esta conversión — puntaje_obtenido no aplica y se limpia para
      // no dejar un valor viejo colgado de un cambio de modo anterior.
      if (modoCalif === "puntos") {
        asignacionViva.puntaje_obtenido = convertirA100(califFinal, descriptorEscala);
        recalcularNotaDesdePuntaje(asignacionViva, escalaActiva);
      } else {
        asignacionViva.puntaje_obtenido = null;
        asignacionViva.nota = califFinal;
      }
      sellarTimestamp(asignacionViva);
    } else {
      const nueva = crearAsignacion({ nombre, valor: valorNum100, orden: siguienteOrden(criterioVivo.asignaciones) });
      nueva.modo_valor = modoValor;
      nueva.modo_calificacion = modoCalif;
      if (modoCalif === "puntos") {
        nueva.puntaje_obtenido = convertirA100(califFinal, descriptorEscala);
        recalcularNotaDesdePuntaje(nueva, escalaActiva);
      } else {
        nueva.nota = califFinal;
      }
      criterioVivo.asignaciones.push(nueva);
    }
    // Reparte lo que sobra entre las "automatico" con el total ya
    // actualizado (nueva asignación agregada, o esta pasó a
    // automático/personalizado, o cambió su valor fijo) — decisión
    // confirmada 2026-08-02.
    repartirEquitativoCriterio(criterioVivo);
    sellarTimestamp(criterioVivo);

    persistirCambioMateria(mmViva, materia, plan, onGuardado);
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

/**
 * Modal simplificado (2026-08-07, pedido explícito — "ahí solamente se
 * ponen nombre de asignación, puntos extra dados y ya, lo demás no
 * aplica"): a diferencia de abrirModalAsignacion (Automático/Personalizado,
 * Nota/Puntos, letras...), acá solo hay 2 campos. Los puntos ingresados se
 * suman DIRECTO a la nota final (modo_calificacion:"extra" — ver
 * calcularPuntosAsignacion en schema.js), sin concepto de "pendiente".
 */
function abrirModalAsignacionExtra({ criterio, mm, materia, plan, escalaActiva, asignacionExistente, onGuardado }) {
  const esEdicion = !!asignacionExistente;
  const { overlay, card } = crearModalDinamico({ titulo: esEdicion ? "Editar ✨ Extra" : "Nueva asignación ✨ Extra" });
  // FIX (2026-08-08): asignacion.valor en modo "extra" se suma DIRECTO a
  // nota_final (0-100 interno) — se muestra/edita en la escala activa,
  // igual que el resto de los números de nota, convirtiendo a 0-100 recién
  // al guardar.
  const descriptorEscalaExtra = obtenerEscalaPorId(escalaActiva);

  const inputNombre = agregarCampoModal(card, {
    etiqueta: "Nombre (ej. Examen de reposición)",
    tipo: "text",
    valor: esEdicion ? asignacionExistente.nombre : "",
  });
  const inputPuntos = agregarCampoModal(card, {
    etiqueta: "Puntos extra dados",
    valor: esEdicion ? formatearNumero(convertirDesde100(asignacionExistente.valor, descriptorEscalaExtra)) : "",
    decimal: true,
  });

  // Mismo criterio que abrirModalAsignacion: al editar, arranca enfocado en
  // el campo que hace falta llenar/corregir (acá, los puntos — el nombre ya
  // suele estar bien si se está editando).
  if (esEdicion) {
    requestAnimationFrame(() => inputPuntos.focus());
  }

  const ayuda = document.createElement("p");
  ayuda.className = "muted";
  ayuda.style.fontSize = "0.8rem";
  ayuda.style.margin = "0";
  ayuda.textContent = "Se suma directo a la nota final, aparte del 100% de la materia.";
  card.appendChild(ayuda);

  const mmId = mm.id;
  const criterioId = criterio.id;
  const asignacionId = esEdicion ? asignacionExistente.id : null;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const puntosEscala = analizarDecimal(inputPuntos.value);
    const puntos = convertirA100(puntosEscala, descriptorEscalaExtra);

    if (!nombre) {
      mostrarToast("Ponele un nombre a la asignación");
      return;
    }
    if (!Number.isFinite(puntosEscala) || puntosEscala <= 0) {
      mostrarToast("Los puntos deben ser un número mayor a 0");
      return;
    }

    const mmViva = buscarMmVivaPorId(mmId);
    const criterioVivo = mmViva && (mmViva.criterios || []).find((c) => c.id === criterioId);
    if (!mmViva || !criterioVivo) {
      mostrarToast("Este criterio se eliminó desde otro dispositivo — no se pudo guardar");
      overlay.remove();
      onGuardado();
      return;
    }

    if (esEdicion) {
      const asignacionViva = (criterioVivo.asignaciones || []).find((a) => a.id === asignacionId);
      if (!asignacionViva) {
        mostrarToast("Esta asignación se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        onGuardado();
        return;
      }
      asignacionViva.nombre = nombre;
      asignacionViva.valor = puntos;
      // "personalizado" siempre (nunca "automatico"): si quedara en
      // "automatico", repartirEquitativoCriterio (que SÍ puede correr por
      // otros caminos, ej. al agregar/borrar otra asignación del mismo
      // criterio) la repartiría sobre un valor_total de 0 y borraría estos
      // puntos sin querer — ver comentario en crearCriterioExtraDirecto.
      asignacionViva.modo_valor = "personalizado";
      sellarTimestamp(asignacionViva);
    } else {
      const nueva = crearAsignacion({
        nombre,
        valor: puntos,
        orden: siguienteOrden(criterioVivo.asignaciones),
        modoCalificacion: "extra",
      });
      nueva.modo_valor = "personalizado";
      criterioVivo.asignaciones.push(nueva);
      sellarTimestamp(criterioVivo);
    }

    persistirCambioMateria(mmViva, materia, plan, onGuardado);
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

function eliminarAsignacion(criterio, mm, materia, plan, asignacion, onCambiar) {
  const mmId = mm.id;
  const criterioId = criterio.id;
  const asignacionId = asignacion.id;
  abrirConfirmacion({
    titulo: "Eliminar asignación",
    mensaje: `¿Eliminar "${asignacion.nombre}"?`,
    textoConfirmar: "Eliminar",
    onConfirmar: () => {
      const mmViva = buscarMmVivaPorId(mmId);
      const criterioVivo = mmViva && (mmViva.criterios || []).find((c) => c.id === criterioId);
      if (!mmViva || !criterioVivo) {
        mostrarToast("Esto ya no existe — puede que se haya eliminado desde otro dispositivo");
        onCambiar();
        return;
      }
      criterioVivo.asignaciones = (criterioVivo.asignaciones || []).filter((a) => a.id !== asignacionId);
      criterioVivo._eliminados_asignaciones = criterioVivo._eliminados_asignaciones || [];
      criterioVivo._eliminados_asignaciones.push(crearEntradaTumba(asignacionId));
      // FIX (2026-08-04): faltaba este llamado. Sin él, al borrar una
      // asignación las "automatico" que quedan se congelan con el valor
      // viejo (repartido entre N) en vez de recalcularse entre N-1 — los
      // puntos de la eliminada quedaban flotando sin volver al criterio
      // (ej. 3 automáticas de 13.3 cada una, se borra una, deberían quedar
      // 2 en 20 c/u, pero se quedaban en 13.3 y 13.3). Misma regla que ya
      // se aplica al agregar (agregarAsignacionRapida) o editar una
      // asignación — ver repartirEquitativoCriterio en schema.js.
      repartirEquitativoCriterio(criterioVivo);
      sellarTimestamp(criterioVivo);
      persistirCambioMateria(mmViva, materia, plan, onCambiar);
    },
  });
}

/** Añade una asignación instantánea (sin modal), en modo "automático" — reparte lo que sobra entre las automáticas (ver repartirEquitativoCriterio). */
function agregarAsignacionRapida(criterio, mm, materia, plan, onCambiar) {
  // Fix (2026-08-02): este botón vive en una tarjeta que pudo renderizarse
  // hace rato — si pasó un sync (cada 9s) desde entonces, `criterio`/`mm`
  // son referencias huérfanas (ver comentario en buscarCriterioVivoPorId).
  const mmViva = buscarMmVivaPorId(mm.id);
  const criterioVivo = mmViva && (mmViva.criterios || []).find((c) => c.id === criterio.id);
  if (!mmViva || !criterioVivo) {
    mostrarToast("Esto cambió en otro dispositivo — se actualiza la pantalla");
    onCambiar();
    return;
  }
  const numero = (criterioVivo.asignaciones || []).length + 1;
  criterioVivo.asignaciones.push(crearAsignacion({ nombre: `Asignación ${numero}`, valor: 0, orden: siguienteOrden(criterioVivo.asignaciones) }));
  repartirEquitativoCriterio(criterioVivo);
  sellarTimestamp(criterioVivo);
  persistirCambioMateria(mmViva, materia, plan, onCambiar);
}

/* ===================== Modal: override manual de nota_final ===================== */

function abrirModalNotaManual({ mm, materia, plan, notaFinalVigente, escalaActiva, onGuardado }) {
  const { overlay, card } = crearModalDinamico({ titulo: "Editar nota final a mano" });

  const aviso = document.createElement("p");
  aviso.className = "muted";
  aviso.style.fontSize = "0.8rem";
  aviso.style.margin = "0";
  aviso.textContent =
    "Uso excepcional: mientras esté activo, el cálculo automático por criterios queda en pausa, y se muestra con un badge de \"editado a mano\" hasta que lo desactives.";
  card.appendChild(aviso);

  // FIX (2026-08-08 — mismo bug que nota_aprobacion en Ajustes): el
  // override manual se guarda internamente en 0-100 SIEMPRE (así lo espera
  // el resto del motor — es la misma unidad que nota_final calculado), pero
  // se muestra y se edita en la escala activa del plan, no en el crudo
  // 0-100. Para "letras" no hay conversión numérica razonable (ver
  // convertirA100/convertirDesde100 en schema.js) — ahí se mantiene 0-100
  // directo, mismo comportamiento que tenía antes.
  const descriptorEscala = obtenerEscalaPorId(escalaActiva);
  const esLetras = descriptorEscala.tipo === "letras";
  const etiquetaEscala = esLetras ? "0-100" : `0-${formatearNumero(descriptorEscala.max)}`;
  const valorMostrado =
    notaFinalVigente !== null && notaFinalVigente !== undefined
      ? formatearNumero(convertirDesde100(notaFinalVigente, descriptorEscala))
      : "";

  const inputNota = agregarCampoModal(card, {
    etiqueta: `Nota final (${etiquetaEscala})`,
    valor: valorMostrado,
    decimal: true,
  });

  const mmId = mm.id;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const valorEnEscala = analizarDecimal(inputNota.value);
    const tope = esLetras ? 100 : descriptorEscala.max;
    if (!Number.isFinite(valorEnEscala) || valorEnEscala < 0 || valorEnEscala > tope) {
      mostrarToast(`La nota final debe estar entre 0 y ${formatearNumero(tope)}`);
      return;
    }
    const valor = convertirA100(valorEnEscala, descriptorEscala);
    // Fix (2026-08-02): misma clase de bug de referencia obsoleta — se
    // busca la mm viva antes de escribir (ver buscarCriterioVivoPorId).
    const mmViva = buscarMmVivaPorId(mmId);
    if (!mmViva) {
      mostrarToast("Esta materia se eliminó desde otro dispositivo — no se pudo guardar");
      overlay.remove();
      onGuardado();
      return;
    }
    // No pasa por persistirCambioMateria/recalcularNotaFinal a propósito:
    // el override manual es justamente lo que NO debe recalcularse.
    mmViva.nota_final = valor;
    mmViva.nota_final_manual = true;
    sellarTimestamp(mmViva);
    marcarCambioPendiente();
    onGuardado();
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

/* ===================== Modal: Simulador "Proyectar" (What If) ===================== */

/**
 * Pinta el resultado de un modo "objetivo fijo" (Máximo posible ya no pasa
 * por acá — se pinta aparte porque no tiene estado de "imposible"/"ya
 * alcanzado", siempre hay un número). Textos cortos a propósito: nadie
 * debería tener que adivinar qué significa cada caso.
 */
function pintarResultadoObjetivo(contenedor, resultado, escalaActiva, objetivo) {
  contenedor.innerHTML = "";
  const p = document.createElement("p");
  p.style.cssText = "margin:0; font-weight:600; text-align:center;";

  if (resultado.estado === "ya_alcanzado") {
    p.textContent = "✅ Ya alcanzás esto con lo que tenés — necesitás 0 en lo que falta.";
  } else if (resultado.estado === "imposible") {
    const notaHipotetica = notaMinimaParaFraccion(resultado.fraccionNecesaria, escalaActiva);
    const notaImposible = notaHipotetica !== null ? formatearNotaCruda(notaHipotetica) : "—";
    p.innerHTML =
      `Necesitarías un <strong>${notaImposible}</strong> (sobre ${escalaActiva}) en cada pendiente — ` +
      `lo cual ya ni existe. <br><span style="font-weight:400;">No pos ya valió, no hay por dónde.</span>`;
  } else {
    const notaNecesaria = notaMinimaParaFraccion(resultado.fraccionNecesaria, escalaActiva);
    // FIX (2026-08-08 — mismo bug de "37 en vez de 3.7"): objetivo llega en
    // 0-100 (misma unidad que nota_aprobacion/raspando — ver
    // abrirModalProyectar), pero acá se muestra junto a "necesitás sacarte
    // X (sobre escalaActiva)" — hay que convertirlo a la escala activa para
    // que ambos números del mismo párrafo hablen el mismo idioma.
    const objetivoMostrado = convertirDesde100(objetivo, obtenerEscalaPorId(escalaActiva));
    p.innerHTML =
      `Necesitás sacarte un <strong>${formatearNotaCruda(notaNecesaria)}</strong> (sobre ${escalaActiva}) en cada pendiente.` +
      `<br>Tu nota final sería: <strong>${formatearNumero(objetivoMostrado)}</strong>`;
  }
  contenedor.appendChild(p);
}

/**
 * Modo "Manejo libre": inputs editables por cada asignación pendiente,
 * respetando modo_calificacion (nota vs. puntos) igual que el modal real
 * de asignación — pero nada de esto toca `mm` ni se persiste. El total se
 * recalcula en vivo con los mismos criterios que calcularPuntosAsignacion.
 */
function construirModoManejoLibre(contenedor, mm, materia, plan, escalaActiva) {
  contenedor.innerHTML = "";
  const pendientes = obtenerAsignacionesPendientes(mm);
  const puntosBase = calcularNotaFinalMateria(mm, escalaActiva);
  const notasHipoteticas = new Map();

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "6px";

  const resultadoTexto = document.createElement("p");
  resultadoTexto.style.cssText = "margin:8px 0 0; font-weight:700; text-align:center;";

  function recalcular() {
    let total = puntosBase;
    pendientes.forEach(({ asignacion }) => {
      const valorCrudo = notasHipoteticas.get(asignacion.id);
      if (valorCrudo === undefined || valorCrudo === "") return;
      const valorNum = analizarDecimal(valorCrudo);
      if (!Number.isFinite(valorNum)) return;
      if (asignacion.modo_calificacion === "puntos") {
        total += Math.min(Math.max(valorNum, 0), Number(asignacion.valor) || 0);
      } else {
        const notaAcotada = Math.min(Math.max(valorNum, 0), escalaActiva);
        total += redondearDecimales((notaAcotada / escalaActiva) * asignacion.valor, 6);
      }
    });
    resultadoTexto.textContent = `Nota final hipotética: ${formatearNumero(redondearDecimales(total, 2))}`;
  }

  pendientes.forEach(({ criterio, asignacion }) => {
    const fila = document.createElement("div");
    fila.className = "row";
    fila.style.cssText = "align-items:center; gap:8px;";

    const label = document.createElement("span");
    label.style.cssText = "flex:1; font-size:0.85rem; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
    label.textContent = `${criterio.nombre} · ${asignacion.nombre}`;
    fila.appendChild(label);

    const input = document.createElement("input");
    input.type = "text";
    input.inputMode = "decimal";
    input.className = "form-input";
    input.style.cssText = "width:70px; flex-shrink:0;";
    input.placeholder = asignacion.modo_calificacion === "puntos" ? `0-${formatearNumero(asignacion.valor)}` : `0-${escalaActiva}`;
    input.addEventListener("input", () => {
      notasHipoteticas.set(asignacion.id, input.value);
      recalcular();
    });
    fila.appendChild(input);

    lista.appendChild(fila);
  });

  contenedor.appendChild(lista);
  contenedor.appendChild(resultadoTexto);
  recalcular();
}

const MODOS_PROYECCION = [
  { valor: "maximo", texto: "Máximo posible", desc: "Si sacás la nota máxima en todo lo que falta." },
  { valor: "minimo", texto: "Mínimo pasable", desc: "Lo que necesitás para pasar con la nota de aprobación cerrada." },
  { valor: "raspando", texto: "Pasar raspando", desc: "El mínimo real usando el margen de redondeo — para cuando ya no da para más." },
  { valor: "deseada", texto: "Nota deseada", desc: "Elegí a qué nota querés llegar." },
  { valor: "libre", texto: "Manejo libre", desc: "Poné notas hipotéticas y mirá el resultado en vivo." },
];

/**
 * Simulador "Proyectar" (Fase 6, punto 4). Bloqueado si los criterios de la
 * materia no suman 100% todavía (decisión confirmada 2026-08-03): con
 * criterios a medias el "máximo posible" y el "mínimo pasable" mienten,
 * mejor que no se pueda abrir a que alguien piense que la página falla.
 * No persiste NADA — es una copia de trabajo puramente en memoria.
 */
function abrirModalProyectar({ mm, materia, plan, escalaActiva }) {
  if (100 - sumaValorTotalCriterios(mm) > 0.001) {
    mostrarToast("Completá el 100% de los criterios de la materia antes de proyectar");
    return;
  }
  const pendientes = obtenerAsignacionesPendientes(mm);
  if (pendientes.length === 0) {
    mostrarToast("Ya tenés todas las notas cargadas — no hay nada que proyectar");
    return;
  }

  const { card } = crearModalDinamico({ titulo: "Proyectar", confirmarCierre: false });
  const notaAprobacion = Number((plan.parametros_universidad || {}).nota_aprobacion) || 70;

  const descripcion = document.createElement("p");
  descripcion.className = "muted";
  descripcion.style.cssText = "font-size:0.8rem; margin:0;";
  card.appendChild(descripcion);

  // Pedido explícito (2026-08-03): un pill-group horizontal de 5 opciones
  // siempre se corta / no se alcanza a leer. En vez de eso, cada opción
  // ocupa su propia fila completa, siempre en el mismo orden vertical —
  // nunca vuelve a horizontal aunque haya espacio de sobra.
  const grupoModos = document.createElement("div");
  grupoModos.style.cssText = "display:flex; flex-direction:column; gap:6px; width:100%;";
  card.appendChild(grupoModos);

  const inputDeseada = document.createElement("input");
  inputDeseada.type = "text";
  inputDeseada.inputMode = "decimal";
  inputDeseada.className = "form-input oculto";
  const descriptorEscalaProyectar = obtenerEscalaPorId(escalaActiva);
  inputDeseada.placeholder = descriptorEscalaProyectar.tipo === "letras"
    ? "Nota a la que querés llegar (0-100)"
    : `Nota a la que querés llegar (0-${formatearNumero(descriptorEscalaProyectar.max)})`;
  // Pedido explícito: el input de la última opción hipotética ("Nota
  // deseada") se ve un 10% más ancho que el resto del modal — se centra
  // con márgenes negativos para que no se salga del glass-card.
  inputDeseada.style.cssText = "width:110%; margin-left:-5%; margin-right:-5%; box-sizing:border-box;";
  card.appendChild(inputDeseada);

  const contenedorResultado = document.createElement("div");
  contenedorResultado.className = "glass-panel";
  contenedorResultado.style.cssText = "padding:12px; margin-top:2px;";
  card.appendChild(contenedorResultado);

  let modoActivo = "maximo";

  function pintar() {
    grupoModos.innerHTML = "";
    MODOS_PROYECCION.forEach(({ valor, texto }) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-block " + (modoActivo === valor ? "btn-primary" : "btn-secondary");
      btn.style.cssText = "text-align:center; white-space:normal; font-size:0.85rem;";
      btn.textContent = texto;
      btn.addEventListener("click", () => {
        modoActivo = valor;
        pintar();
      });
      grupoModos.appendChild(btn);
    });

    descripcion.textContent = MODOS_PROYECCION.find((m) => m.valor === modoActivo).desc;
    inputDeseada.classList.toggle("oculto", modoActivo !== "deseada");
    contenedorResultado.innerHTML = "";

    if (modoActivo === "libre") {
      construirModoManejoLibre(contenedorResultado, mm, materia, plan, escalaActiva);
      return;
    }

    if (modoActivo === "maximo") {
      const max = calcularMaximoPosibleMateria(mm, escalaActiva);
      const maxMostrado = convertirDesde100(max, obtenerEscalaPorId(escalaActiva));
      const p = document.createElement("p");
      p.style.cssText = "margin:0; font-weight:700; text-align:center;";
      p.textContent = `Tu nota final sería: ${formatearNumero(maxMostrado)}`;
      contenedorResultado.appendChild(p);
      return;
    }

    if (modoActivo === "deseada" && !inputDeseada.value.trim()) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.cssText = "margin:0; text-align:center;";
      p.textContent = "Escribí arriba la nota a la que querés llegar.";
      contenedorResultado.appendChild(p);
      return;
    }

    let objetivo;
    if (modoActivo === "minimo") objetivo = notaAprobacion;
    else if (modoActivo === "raspando") objetivo = resolverObjetivoPasarRaspando(plan.parametros_universidad);
    else objetivo = convertirA100(analizarDecimal(inputDeseada.value), descriptorEscalaProyectar);

    if (!Number.isFinite(objetivo)) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.cssText = "margin:0; text-align:center;";
      p.textContent = "Escribí una nota válida arriba.";
      contenedorResultado.appendChild(p);
      return;
    }

    const resultado = calcularNotaNecesariaUniforme(mm, escalaActiva, objetivo);
    pintarResultadoObjetivo(contenedorResultado, resultado, escalaActiva, objetivo);
  }

  inputDeseada.addEventListener("input", pintar);
  pintar();
}

/* =========================================================================
   Fase 6 — Popovers de long-press (mismo patrón que abrirMenuRapidoEstadoMatricula)
   ========================================================================= */

function abrirPopoverAcciones(anclaEl, acciones) {
  document.querySelectorAll(".popover-estado-rapido").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-estado-rapido";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:160px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  acciones.forEach(({ texto, clase, onClick }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn " + (clase || "btn-secondary") + " btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = texto;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      pop.remove();
      onClick();
    });
    pop.appendChild(item);
  });

  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", function cerrar(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", cerrar);
      }
    });
  }, 300);
}

function abrirMenuRapidoCriterio(criterio, mm, materia, plan, escalaActiva, anclaEl, onCambiar) {
  abrirPopoverAcciones(anclaEl, [
    {
      texto: "Editar criterio",
      onClick: () => abrirModalCriterio({ mm, materia, plan, escalaActiva, criterioExistente: criterio, onGuardado: onCambiar }),
    },
    {
      texto: "Eliminar criterio",
      clase: "btn-danger",
      onClick: () => eliminarCriterio(mm, materia, plan, criterio, onCambiar),
    },
    {
      // Fase 8 — Drag and drop (spec completa): activa el modo reordenar
      // para TODA la lista de criterios de esta materia (no solo este
      // criterio) — es el orden entre ellos lo que se puede reordenar.
      texto: "🔀 Reordenar",
      onClick: () => {
        criteriosListaEnReordenar.add(mm.id);
        onCambiar();
      },
    },
  ]);
}

function abrirMenuRapidoAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, anclaEl, onCambiar) {
  abrirPopoverAcciones(anclaEl, [
    {
      texto: "Editar",
      onClick: () =>
        criterio.es_extra
          ? abrirModalAsignacionExtra({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar })
          : abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar }),
    },
    {
      texto: "Eliminar",
      clase: "btn-danger",
      onClick: () => eliminarAsignacion(criterio, mm, materia, plan, asignacion, onCambiar),
    },
    {
      // Fase 8 — Drag and drop (spec completa): activa el modo reordenar
      // para la lista de asignaciones DE ESTE criterio puntual (no toca
      // los demás criterios de la materia) — igual se puede arrastrar
      // hacia otro criterio hermano si ese también está expandido.
      texto: "🔀 Reordenar",
      onClick: () => {
        asignacionesListaEnReordenar.add(criterio.id);
        onCambiar();
      },
    },
  ]);
}

/* =========================================================================
   Fase 6 — Construcción de la sección de notas (reemplaza placeholderNotas)
   ========================================================================= */

// Estilo compartido de las pills de valor — el ancho real (fijo, igualado
// entre todas las de la tarjeta) lo pone igualarAnchoBadges() después de
// que la tarjeta ya está en el documento (ver construirTarjetaCriterio).
const PILL_ESTILO = "display:inline-flex; align-items:center; justify-content:center; height:24px; text-align:center; white-space:nowrap; font-variant-numeric:tabular-nums;";

function construirFilaAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, onCambiar) {
  const enReorden = asignacionesListaEnReordenar.has(criterio.id);

  const fila = document.createElement("div");
  fila.className = "row fila-asignacion";
  fila.style.cssText =
    "justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--radius-sm); background:rgba(255,255,255,0.03); cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;";
  fila.dataset.id = asignacion.id;

  // Fase 8 — Drag and drop: mismo criterio que en construirTarjetaCriterio
  // — en modo reordenar no hay click ni long-press, solo el handle "⋮⋮".
  if (enReorden) {
    const handle = document.createElement("span");
    handle.className = "asignacion-handle-mover handle-mover";
    handle.textContent = "⋮⋮";
    handle.setAttribute("aria-label", "Mantené presionado y arrastrá para reordenar o mover esta asignación");
    fila.appendChild(handle);
    fila.style.cursor = "default";
  } else {
    fila.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (criterio.es_extra) {
        abrirModalAsignacionExtra({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar });
      } else {
        abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar });
      }
    });
    agregarLongPress(fila, () => abrirMenuRapidoAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, fila, onCambiar));
  }

  // Rediseño (2026-08-02): antes acá también iban "· X pts" y "· auto" —
  // esa información ya vive en la pill de puntaje de al lado (X/Y pts) y
  // en el modal de edición; repetirla acá solo ensuciaba la fila. Ahora
  // solo el nombre, para que la fila quede limpia: Criterio | Nota | Puntaje.
  const izq = document.createElement("span");
  izq.style.cssText = "font-size:0.85rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  izq.textContent = asignacion.nombre;
  fila.appendChild(izq);

  const contDer = document.createElement("div");
  contDer.className = "row";
  contDer.style.cssText = "gap:6px; flex-wrap:nowrap; flex-shrink:0;";

  // "✨ Extra" (2026-08-07): no hay nota ni estado "pendiente" — una sola
  // pill con los puntos que suma directo (ver modo_calificacion:"extra" en
  // calcularPuntosAsignacion, schema.js).
  if (criterio.es_extra) {
    const pillExtra = document.createElement("span");
    pillExtra.className = "pill-tamano-fijo badge badge-accent";
    pillExtra.style.cssText = PILL_ESTILO;
    // FIX (2026-08-08): asignacion.valor acá ES la calificación directa
    // (no un peso 0-100 como en criterios normales — ver comentario de
    // modoCalificacion "extra" en schema.js), pero de todas formas suma
    // directo a nota_final, que ya se muestra en la escala del plan — así
    // que también se convierte, para no mezclar unidades en la misma
    // tarjeta.
    pillExtra.textContent = `+${formatearNumero(convertirDesde100(asignacion.valor, obtenerEscalaPorId(escalaActiva)))} pts`;
    contDer.appendChild(pillExtra);
    fila.appendChild(contDer);
    return fila;
  }

  const pillNota = document.createElement("span");
  pillNota.className = "pill-tamano-fijo badge";
  pillNota.style.cssText = PILL_ESTILO;
  if (asignacion.nota === null || asignacion.nota === undefined) {
    pillNota.classList.add("badge-neutral");
    pillNota.textContent = "Pendiente";
  } else {
    // FIX (2026-08-06 — "la pill de Nota muestra el puntaje crudo, no la
    // nota equivalente"): antes, en modo "puntos", acá se mostraba
    // nota/valor (el puntaje crudo disfrazado de nota, ej. "8/10" cuando
    // la nota real en escala 100 era 80). `nota` ahora SIEMPRE guarda la
    // nota ya convertida a la escala activa (ver recalcularNotaDesdePuntaje
    // en schema.js) sin importar el modo, así que ambos modos muestran
    // exactamente lo mismo acá — una única rama, sin distinguir modo.
    const fraccion = obtenerFraccionNota(asignacion.nota, escalaActiva);
    const descriptorEscalaLocal = obtenerEscalaPorId(escalaActiva);
    pillNota.textContent =
      descriptorEscalaLocal.tipo === "letras" ? formatearNotaCruda(asignacion.nota) : `${formatearNumero(asignacion.nota)}/${escalaActiva}`;
    const pct = (fraccion || 0) * 100;
    const colorPersonalizado = colorParaPorcentaje(pct);
    if (colorPersonalizado) {
      aplicarColorBadgePersonalizado(pillNota, colorPersonalizado);
    } else {
      pillNota.classList.add("badge-success");
    }
  }

  const pillPuntos = document.createElement("span");
  pillPuntos.className = "pill-tamano-fijo badge badge-accent";
  pillPuntos.style.cssText = PILL_ESTILO;
  const descriptorEscalaPuntos = obtenerEscalaPorId(escalaActiva);
  const puntosObtenidos = calcularPuntosAsignacion(asignacion, escalaActiva);
  // FIX (2026-08-08 — "no tiene sentido que la nota final sea un 10 si los
  // puntos repartidos son de 100"): puntosObtenidos y asignacion.valor
  // siguen viviendo en 0-100 internamente (mismo peso de siempre), se
  // convierten acá solo para mostrar, igual que la nota final de arriba.
  const textoPuntos =
    asignacion.nota === null || asignacion.nota === undefined
      ? "—"
      : formatearNumero(convertirDesde100(puntosObtenidos, descriptorEscalaPuntos));
  pillPuntos.textContent = `${textoPuntos}/${formatearNumero(convertirDesde100(asignacion.valor, descriptorEscalaPuntos))} pts`;

  // Pendiente #7 (2026-08-03): en pantalla angosta se muestra UNA sola pill
  // por fila, la que diga estado.vistaNotaPuntajeAngosta (mismo toggle que
  // filaEtiquetas en construirTarjetaCriterio, así todas las filas de la
  // tarjeta cambian juntas y quedan alineadas con su encabezado).
  const angosta = window.innerWidth < ANCHO_PANTALLA_ANGOSTA;
  if (angosta) {
    contDer.appendChild(estado.vistaNotaPuntajeAngosta === "puntaje" ? pillPuntos : pillNota);
  } else {
    contDer.appendChild(pillNota);
    contDer.appendChild(pillPuntos);
  }

  fila.appendChild(contDer);

  return fila;
}

/**
 * Después de que la tarjeta ya está en el documento (por eso el
 * requestAnimationFrame — offsetWidth solo es confiable con layout real
 * hecho), mide el ancho natural de cada pill (.pill-tamano-fijo) DENTRO de
 * esta tarjeta y le fija a TODAS el ancho de la más ancha — el pedido
 * explícito de "los badges sean tamaño fijo todos, el más grande decide el
 * tamaño de los demás", para que Nota y Puntaje queden alineados en
 * columna en vez de saltar de ancho entre filas.
 */
function igualarAnchoBadges(cont) {
  requestAnimationFrame(() => {
    const pills = cont.querySelectorAll(".pill-tamano-fijo");
    if (!pills.length) return;
    let maxAncho = 0;
    pills.forEach((p) => {
      p.style.width = "";
      maxAncho = Math.max(maxAncho, p.offsetWidth);
    });
    pills.forEach((p) => {
      p.style.width = maxAncho + "px";
    });
  });
}

/** Puntos realmente obtenidos hasta ahora en este criterio (mismas unidades
 *  que criterio.valor_total) — la calificación total que va en el pie de la
 *  tarjeta. Usa el mismo motor de cálculo que la nota final de la materia
 *  (calcularPuntosAsignacion, schema.js), así nunca puede desalinearse de
 *  ella. */
function calcularPuntosCriterio(criterio, escalaActiva) {
  return (criterio.asignaciones || []).reduce((total, asig) => total + calcularPuntosAsignacion(asig, escalaActiva), 0);
}

function construirTarjetaCriterio(criterio, mm, materia, plan, escalaActiva, onCambiar) {
  // Fase 8 — Drag and drop: esta lista puntual (los criterios DE ESTA
  // materia) entra en modo reordenar cuando el usuario elige "Reordenar"
  // en el menú rápido de CUALQUIERA de sus criterios — afecta a todos los
  // criterios de la materia por igual (ver abrirMenuRapidoCriterio).
  const enReordenCriterios = criteriosListaEnReordenar.has(mm.id);

  // Pedido explícito: "quiero que cada criterio esté contraido, cerrado, y
  // tenga la flecha ▲▼ tal como en todo el resto de tarjetas" — mismo
  // patrón que ya usan materias y semestres (estado.semestresExpandidos),
  // pero en su propio Map (los ids de criterio no comparten espacio con
  // los de mm/semestre). Sin entrada todavía = contraído por defecto.
  // Fase 8 — Drag and drop: si esta lista de criterios está en modo
  // reordenar, se fuerza expandido=true (sin tocar el Map, así que al
  // salir del modo vuelve a su estado de antes) para reconocer mejor cuál
  // es cuál al arrastrar. Si en cambio es la lista de ASIGNACIONES de este
  // criterio puntual la que está en modo reordenar, igual se fuerza
  // expandido (esa lista tiene que estar visible para poder arrastrarla).
  const enReordenAsignaciones = asignacionesListaEnReordenar.has(criterio.id);
  const expandido = enReordenCriterios || enReordenAsignaciones ? true : estado.criteriosExpandidos.get(criterio.id) || false;

  const cont = document.createElement("div");
  cont.className = "glass-panel stack";
  cont.style.cssText = "padding:10px 12px; gap:8px;";
  cont.dataset.id = criterio.id;

  /* ---------- Encabezado: nombre + % de la materia | flecha ---------- */
  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText =
    "justify-content:space-between; align-items:center; cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;";

  // Fase 8 — Drag and drop: mientras la lista de CRITERIOS está en modo
  // reordenar, el encabezado deja de reaccionar a click (expandir) y
  // long-press (menú rápido) — la ÚNICA acción posible es arrastrar desde
  // el handle "⋮⋮", para que no choque con esas otras dos funciones
  // (pedido explícito). Si es la lista de ASIGNACIONES la que está en modo
  // reordenar (no esta), el encabezado del criterio se comporta normal.
  if (enReordenCriterios) {
    const handle = document.createElement("span");
    handle.className = "criterio-handle-mover handle-mover";
    handle.textContent = "⋮⋮";
    handle.setAttribute("aria-label", "Mantené presionado y arrastrá para reordenar este criterio");
    encabezado.appendChild(handle);
    encabezado.style.cursor = "default";
  } else {
    encabezado.title = "Clic para expandir o contraer. Mantén presionado (o clic derecho) para editar o eliminar este criterio";
    encabezado.addEventListener("click", () => {
      estado.criteriosExpandidos.set(criterio.id, !expandido);
      onCambiar();
    });
    agregarLongPress(encabezado, () => abrirMenuRapidoCriterio(criterio, mm, materia, plan, escalaActiva, encabezado, onCambiar));
  }

  const tituloWrap = document.createElement("div");
  tituloWrap.className = "stack";
  tituloWrap.style.cssText = "gap:0;";
  const titulo = document.createElement("strong");
  titulo.style.fontSize = "0.92rem";
  titulo.textContent = criterio.nombre;
  tituloWrap.appendChild(titulo);
  const angosta = window.innerWidth < ANCHO_PANTALLA_ANGOSTA;

  const subtitulo = document.createElement("span");
  subtitulo.className = "muted";
  subtitulo.style.fontSize = "0.72rem";
  const puntosObtenidosCriterio = calcularPuntosCriterio(criterio, escalaActiva);

  const descriptorEscalaCriterioCard = obtenerEscalaPorId(escalaActiva);
  const esLetrasCriterioCard = descriptorEscalaCriterioCard.tipo === "letras";
  const valorTotalMostrado = convertirDesde100(criterio.valor_total, descriptorEscalaCriterioCard);

  // "✨ Extra" no es un % de la materia (se suma aparte del 100%, ver
  // sumaValorTotalCriterios) y, desde el rediseño sin tope fijo (2026-08-07
  // v2), tampoco tiene un valor_total real que mostrar — lo que se ve es la
  // suma viva de sus asignaciones (puntosObtenidosCriterio), que para Extra
  // siempre coincide con lo "obtenido" (no hay estado pendiente).
  subtitulo.textContent = criterio.es_extra
    ? "criterio libre — se suma aparte"
    : esLetrasCriterioCard
    ? angosta
      ? `${formatearNumero(valorTotalMostrado)}%`
      : `${formatearNumero(valorTotalMostrado)}% de la materia`
    : angosta
    ? `${formatearNumero(valorTotalMostrado)}/${formatearNumero(descriptorEscalaCriterioCard.max)}`
    : `${formatearNumero(valorTotalMostrado)} de ${formatearNumero(descriptorEscalaCriterioCard.max)} de la materia`;
  tituloWrap.appendChild(subtitulo);
  encabezado.appendChild(tituloWrap);

  // Pedido explícito: "puntos totales necesito que se muestren arriba, en
  // el encabezado [...] Criterio (izquierda), puntos totales (derecha),
  // botón de flecha [...] para que se muestre siempre esté cerrado o no".
  // Antes vivía en el pie, dentro del bloque `if (expandido)` — por eso
  // solo se veía con la tarjeta abierta. Ahora se calcula siempre (no
  // depende de `expandido`) y va en un grupo a la derecha del encabezado,
  // junto con la flecha — SOLO para el criterio, la materia no cambia.
  const derechaWrap = document.createElement("div");
  derechaWrap.className = "row";
  derechaWrap.style.cssText = "align-items:center; gap:10px; flex-wrap:nowrap;";

  const textoTotal = document.createElement("span");
  textoTotal.style.cssText = "font-size:0.82rem; white-space:nowrap;";
  if (criterio.es_extra) {
    textoTotal.innerHTML = `<strong>+${formatearNumero(convertirDesde100(puntosObtenidosCriterio, descriptorEscalaCriterioCard))} pts extra</strong>`;
  } else {
    const etiquetaPuntosTotales = angosta ? "Pts:" : "Puntos totales:";
    const puntosObtenidosMostrados = convertirDesde100(puntosObtenidosCriterio, descriptorEscalaCriterioCard);
    textoTotal.innerHTML = `<span class="muted">${etiquetaPuntosTotales}</span> <strong>${formatearNumero(puntosObtenidosMostrados)}/${formatearNumero(valorTotalMostrado)} pts</strong>`;
  }
  derechaWrap.appendChild(textoTotal);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandido ? "▲" : "▼";
  derechaWrap.appendChild(iconoExpandir);

  encabezado.appendChild(derechaWrap);

  if (criterio._conflicto) {
    agregarIndicadorConflicto(cont, () => abrirModalResolverConflictoCriterio(criterio, mm, materia, plan, onCambiar));
  }

  cont.appendChild(encabezado);

  if (expandido) {
    // "✨ Extra" (2026-08-07): sus filas no tienen columnas Nota/Puntaje
    // (ver construirFilaAsignacion — una sola pill "+X pts"), así que este
    // encabezado de columnas no aplica y se omite entero.
    if (!criterio.es_extra) {
    // FIX (pedido explícito: "Nota y Puntaje NO está centrado a su pill,
    // como 20px corridos a la derecha"): fila-asignacion (construirFilaAsignacion)
    // tiene padding:6px 10px propio, así que sus pills quedan 10px adentro
    // del borde derecho de la tarjeta. Esta fila de etiquetas no tenía ese
    // mismo padding — sus hijos, con justify-content:flex-end, quedaban
    // pegados al borde (0px de inset) en vez de a los mismos 10px, por eso
    // se veían corridas hacia la derecha respecto a las pills de abajo.
    const filaEtiquetas = document.createElement("div");
    filaEtiquetas.className = "row";
    filaEtiquetas.style.cssText = "justify-content:flex-end; align-items:center; gap:6px; flex-wrap:nowrap; padding:0 10px;";

    if (angosta) {
      // Pendiente #7 (2026-08-03): en pantalla angosta solo cabe Nota O
      // Puntaje por fila — se muestra uno solo (estado.vistaNotaPuntajeAngosta,
      // "nota" por defecto) con flechas ‹ › para alternar entre las dos.
      const estiloFlecha =
        "background:none; border:none; cursor:pointer; font-size:1rem; line-height:1; padding:2px 4px; color:inherit;";

      const btnAnterior = document.createElement("button");
      btnAnterior.type = "button";
      btnAnterior.style.cssText = estiloFlecha;
      btnAnterior.textContent = "‹";
      btnAnterior.title = "Ver Nota/Puntaje";
      btnAnterior.addEventListener("click", (ev) => {
        ev.stopPropagation();
        estado.vistaNotaPuntajeAngosta = estado.vistaNotaPuntajeAngosta === "nota" ? "puntaje" : "nota";
        onCambiar();
      });
      filaEtiquetas.appendChild(btnAnterior);

      const etiquetaActiva = document.createElement("span");
      etiquetaActiva.className = "muted pill-tamano-fijo";
      etiquetaActiva.style.cssText = PILL_ESTILO + "font-size:0.72rem; font-weight:700;";
      etiquetaActiva.textContent = estado.vistaNotaPuntajeAngosta === "nota" ? "Nota" : "Puntaje";
      filaEtiquetas.appendChild(etiquetaActiva);

      const btnSiguiente = document.createElement("button");
      btnSiguiente.type = "button";
      btnSiguiente.style.cssText = estiloFlecha;
      btnSiguiente.textContent = "›";
      btnSiguiente.title = "Ver Nota/Puntaje";
      btnSiguiente.addEventListener("click", (ev) => {
        ev.stopPropagation();
        estado.vistaNotaPuntajeAngosta = estado.vistaNotaPuntajeAngosta === "nota" ? "puntaje" : "nota";
        onCambiar();
      });
      filaEtiquetas.appendChild(btnSiguiente);
    } else {
      const etiquetaNota = document.createElement("span");
      etiquetaNota.className = "muted pill-tamano-fijo";
      etiquetaNota.style.cssText = PILL_ESTILO + "font-size:0.72rem; font-weight:700;";
      etiquetaNota.textContent = "Nota";
      filaEtiquetas.appendChild(etiquetaNota);
      const etiquetaPuntaje = document.createElement("span");
      etiquetaPuntaje.className = "muted pill-tamano-fijo";
      etiquetaPuntaje.style.cssText = PILL_ESTILO + "font-size:0.72rem; font-weight:700;";
      etiquetaPuntaje.textContent = "Puntaje";
      filaEtiquetas.appendChild(etiquetaPuntaje);
    }
    cont.appendChild(filaEtiquetas);
    }

    // Fase 8 — Drag and drop: contenedor propio para las filas de
    // asignación (antes iban sueltas directo en `cont`, mezcladas con
    // filaEtiquetas/pie) — necesario para que el motor de arrastre tenga
    // un contenedor bien delimitado como destino al soltar, tanto para
    // reordenar dentro del mismo criterio como para "cruzar" desde otro.
    // Se ordenan por `orden` (no por posición en el array — ver comentario
    // de ese campo en schema.js) antes de pintarlas.
    const listaAsignaciones = document.createElement("div");
    listaAsignaciones.className = "stack criterio-lista-asignaciones";
    listaAsignaciones.style.cssText = "gap:6px;";
    listaAsignaciones.dataset.criterioListaId = criterio.id;
    // Fase 8 — Drag and drop: para permitir "cruzar" una asignación a OTRO
    // criterio de la misma materia (pedido explícito), el motor de
    // arrastre busca todas las listas con este mismo mm-id al vuelo (ver
    // wirearArrastreAsignaciones) — así puede soltarse en cualquier
    // criterio hermano que también esté expandido en ese momento.
    listaAsignaciones.dataset.mmId = mm.id;
    const asignacionesOrdenadas = [...(criterio.asignaciones || [])].sort(
      (a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0)
    );
    asignacionesOrdenadas.forEach((asig) => {
      listaAsignaciones.appendChild(
        construirFilaAsignacion(asig, criterio, mm, materia, plan, escalaActiva, onCambiar)
      );
    });
    cont.appendChild(listaAsignaciones);

    if (enReordenAsignaciones) {
      wirearArrastreAsignaciones(listaAsignaciones, mm, materia, plan, onCambiar);
      cont.appendChild(
        construirBotonListoReordenar(listaAsignaciones, criterio.id, asignacionesListaEnReordenar, onCambiar)
      );
    }

    /* ---------- Pie: + Añadir asignación ---------- */
    // "Puntos totales" ya no vive acá (ver derechaWrap en el encabezado,
    // arriba) — el pie ahora es solo el botón de agregar. En modo
    // reordenar se oculta (no tiene sentido agregar mientras se está
    // reordenando, y evita otro botón compitiendo con el drag).
    if (!enReordenCriterios && !enReordenAsignaciones) {
      const pie = document.createElement("div");
      pie.className = "row";
      pie.style.cssText = "justify-content:flex-start; align-items:center; margin-top:2px;";

      const btnAgregar = document.createElement("button");
      btnAgregar.type = "button";
      btnAgregar.className = "btn btn-secondary";
      btnAgregar.style.cssText = "font-size:0.78rem; padding:5px 10px;";
      btnAgregar.textContent = "+ Añadir asignación";
      btnAgregar.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // "✨ Extra" (2026-08-07): a diferencia de un criterio normal (que
        // agrega un placeholder vacío para completar tocándolo después),
        // acá el modal simplificado se abre directo — nombre y puntos son
        // los únicos 2 campos, no tiene sentido el paso intermedio.
        if (criterio.es_extra) {
          abrirModalAsignacionExtra({ criterio, mm, materia, plan, escalaActiva, onGuardado: onCambiar });
        } else {
          agregarAsignacionRapida(criterio, mm, materia, plan, onCambiar);
        }
      });
      pie.appendChild(btnAgregar);

      cont.appendChild(pie);
    }
  }

  return cont;
}

/**
 * Escala de color por desempeño (pedido explícito): verde puro en 90-100,
 * cada vez más amarillento entre 70 y 90, amarillo en 50-70, naranja en
 * 30-50, rojo debajo de 30. Recibe un porcentaje 0-100 — quien llama ya
 * debe normalizar a esa escala (una nota sobre 20 hay que convertirla
 * antes). Devuelve `null` para el tramo 90-100 a propósito: ese caso sigue
 * usando la clase badge-success de siempre ("verde como está ahorita"),
 * sin inventar un hex que podría no calzar exacto con la paleta real.
 */
function colorParaPorcentaje(pct) {
  if (pct >= 90) return null;
  if (pct >= 80) return "#7cb342"; // verde un poquitititito más amarillento
  if (pct >= 70) return "#9e9d24"; // verde un poco más amarillento
  if (pct >= 50) return "#eab308"; // amarillo
  if (pct >= 30) return "#f97316"; // naranja
  return "#ef4444"; // rojo
}

/**
 * Pinta una pill con el mismo lenguaje visual que los badges existentes
 * (fondo translúcido + borde + texto del color, ver badge-success/-danger/
 * -warning en design-system.css) en vez de relleno sólido + texto blanco.
 * Pedido explícito: "los colores están bien pero la forma de pintarlos
 * nada que ver [...] quiero que todos se parezcan a como se ve de 90 a
 * 100". Sin acceso a design-system.css en esta sesión, el efecto se arma a
 * mano con el mismo hex de colorParaPorcentaje — si el tono translúcido no
 * calza exacto con el resto de badges, pasame los valores reales de
 * --color-success/etc. y se ajusta fino a eso en vez de a ojo.
 */
function aplicarColorBadgePersonalizado(el, hex) {
  el.style.background = hex + "26"; // ~15% opacidad
  el.style.border = "1px solid " + hex + "80"; // ~50% opacidad
  el.style.color = hex;
}

function construirEncabezadoNotaFinal(mm, materia, plan, notaFinalVigente, escalaActiva, onCambiar) {
  // Rediseño (2026-08-04, spec completa): "Extra" va en la línea de Nota,
  // "Proyectar" en la línea de Nota final (junto con "Editar a mano") —
  // eso mientras hay espacio horizontal normal. Solo cuando la pantalla es
  // angosta (mismo umbral ANCHO_PANTALLA_ANGOSTA que el resto del archivo)
  // los 3 se agrupan en una columna vertical a la derecha, en un grid de 2
  // columnas independientes (texto | botones) para que, aunque esa columna
  // de 3 botones sea más alta que el texto, el texto NUNCA se mueva ni se
  // corte (pedido explícito: "los botones son independientes al texto").
  const angosta = window.innerWidth < ANCHO_PANTALLA_ANGOSTA;

  const notaRedondeada = redondearNotaFinalAlCincoMasCercano(notaFinalVigente);
  // FIX (2026-08-08 — "un 37 se sigue marcando como 370 en lugar de 3.7"):
  // notaFinalVigente/notaRedondeada son SIEMPRE 0-100 internamente (suma
  // ponderada de pesos de criterio, que son porcentajes — ver
  // calcularNotaFinalMateria en schema.js), sin importar la escala de
  // notas del plan. Antes se mostraban tal cual, crudas en 0-100; ahora se
  // convierten a la escala activa para mostrar, igual que ya se hace con
  // nota_aprobacion en Ajustes — el redondeo al 5 más cercano sigue
  // calculándose ANTES de convertir (sobre el 0-100 real), porque esa es
  // la unidad en la que vive nota_aprobacion y en la que tiene sentido
  // "el múltiplo de 5 más cercano".
  const descriptorEscalaActiva = obtenerEscalaPorId(escalaActiva);
  const notaFinalMostrada = convertirDesde100(notaFinalVigente, descriptorEscalaActiva);
  const notaRedondeadaMostrada = convertirDesde100(notaRedondeada, descriptorEscalaActiva);
  // "Nota" = valor absoluto, siempre 2 decimales (pedido explícito). "Nota
  // final" = la misma nota ya redondeada al 5 más cercano — se mantiene con
  // el formato compacto de siempre, porque es la que importa para decidir
  // si aprobó o no, no un valor "de precisión" que alguien vaya a auditar
  // decimal a decimal.
  const textoNota = notaFinalVigente === null || notaFinalVigente === undefined ? "—" : formatearNumeroFijo(notaFinalMostrada, 2);
  const textoNotaFinal = notaRedondeada === null || notaRedondeada === undefined ? "—" : formatearNumero(notaRedondeadaMostrada);

  const estiloBotonNota = "font-size:0.75rem; padding:4px 10px; white-space:nowrap;";
  const hayCriterios = (mm.criterios || []).length > 0;

  // Simulador "Proyectar" y "Extra" solo tienen sentido si hay al menos un
  // criterio creado (si no, no hay nada sobre qué calcular) — se arman acá,
  // sueltos, y se ubican más abajo según el ancho de pantalla.
  const crearBtnExtra = () => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.style.cssText = estiloBotonNota;
    btn.textContent = "✨ Extra";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // Corrección de diseño (2026-08-07): a diferencia de antes (que
      // abría "Nuevo criterio" en modo ✨ Extra en CADA clic, permitiendo
      // varios criterios "✨ Extra" sueltos), ahora solo existe UN criterio
      // "✨ Extra" por materia matriculada. Se busca fresco (mismo motivo
      // que buscarCriterioVivoPorId: `mm` capturada acá puede ser huérfana
      // tras un sync) — si ya existe, el clic ofrece vaciar sus
      // asignaciones en vez de crear otro; si no existe todavía, se crea
      // directo, sin modal (ver crearCriterioExtraDirecto).
      const mmViva = buscarMmVivaPorId(mm.id);
      const criterioExtra = mmViva && (mmViva.criterios || []).find((c) => c.es_extra);
      if (criterioExtra) {
        vaciarAsignacionesExtra(mm, materia, plan, criterioExtra, onCambiar);
      } else {
        crearCriterioExtraDirecto(mm, materia, plan, onCambiar);
      }
    });
    return btn;
  };
  const crearBtnProyectar = () => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.style.cssText = estiloBotonNota;
    btn.textContent = "🔮 Proyectar";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalProyectar({ mm, materia, plan, escalaActiva });
    });
    return btn;
  };
  const crearBtnEditarManual = () => {
    if (mm.nota_final_manual) {
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "badge badge-warning";
      badge.style.cssText = estiloBotonNota + " cursor:pointer; border-radius:var(--radius-pill); text-align:center;";
      badge.textContent = "✏️ Editado a mano";
      badge.title = "Clic para volver a cálculo automático por criterios";
      badge.addEventListener("click", (ev) => {
        ev.stopPropagation();
        // Fix (2026-08-02): mismo patrón — la tarjeta pudo renderizarse hace
        // más de un ciclo de sync, así que `mm` capturada acá puede ser
        // huérfana (ver buscarCriterioVivoPorId).
        const mmViva = buscarMmVivaPorId(mm.id);
        if (!mmViva) {
          mostrarToast("Esta materia se eliminó desde otro dispositivo");
          onCambiar();
          return;
        }
        mmViva.nota_final_manual = false;
        persistirCambioMateria(mmViva, materia, plan, onCambiar);
        mostrarToast("La nota final vuelve a calcularse automáticamente");
      });
      return badge;
    }
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.style.cssText = estiloBotonNota;
    btn.textContent = "Editar a mano";
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalNotaManual({ mm, materia, plan, notaFinalVigente, escalaActiva, onGuardado: onCambiar });
    });
    return btn;
  };

  if (angosta) {
    // ---------- Pantalla angosta: grid de 2 columnas independientes ----------
    const cont = document.createElement("div");
    cont.style.cssText = "display:grid; grid-template-columns:1fr auto; align-items:center; gap:10px;";

    const colTexto = document.createElement("div");
    colTexto.className = "stack";
    colTexto.style.cssText = "gap:6px; min-width:0;";
    const lineaNota = document.createElement("span");
    lineaNota.textContent = `Nota: ${textoNota}`;
    colTexto.appendChild(lineaNota);
    const lineaNotaFinal = document.createElement("span");
    lineaNotaFinal.style.fontWeight = "700";
    lineaNotaFinal.textContent = `Nota final: ${textoNotaFinal}`;
    colTexto.appendChild(lineaNotaFinal);
    cont.appendChild(colTexto);

    // Los 3 con el mismo tamaño (el del más largo, "Editar a mano") gracias
    // a flex-column + align-items:stretch (default) — ver comentario abajo.
    const colBotones = document.createElement("div");
    colBotones.style.cssText = "display:flex; flex-direction:column; gap:4px; flex-shrink:0;";
    if (hayCriterios) {
      colBotones.appendChild(crearBtnExtra());
      colBotones.appendChild(crearBtnProyectar());
    }
    colBotones.appendChild(crearBtnEditarManual());
    cont.appendChild(colBotones);

    return cont;
  }

  // ---------- Pantalla normal: Extra centrado en la línea de Nota,
  // Proyectar centrado en la línea de Nota final (Editar a mano queda a
  // la derecha) ----------
  // FIX (2026-08-06 — "en compu Extra y Proyectar se van al final, a la
  // derecha — deben ir centrados a la tarjeta"): antes cada fila era un
  // flex simple con justify-content:space-between (texto a la izquierda,
  // botón pegado contra el borde derecho de la tarjeta — el "centrado" que
  // daba space-between con solo 2 elementos en realidad es eso: uno a cada
  // punta). Ahora cada fila es un grid de 3 columnas (texto | botón | col
  // derecha) — la columna del medio queda SIEMPRE centrada respecto al
  // ANCHO TOTAL de la tarjeta, porque las columnas 1 y 3 se reparten el
  // mismo ancho (1fr cada una) sin importar cuánto texto tenga cada una.
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:4px;";

  const filaNota = document.createElement("div");
  const lineaNota = document.createElement("span");
  lineaNota.textContent = `Nota: ${textoNota}`;
  if (hayCriterios) {
    filaNota.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;";
    filaNota.appendChild(lineaNota);
    const celdaExtra = document.createElement("div");
    celdaExtra.style.justifySelf = "center";
    celdaExtra.appendChild(crearBtnExtra());
    filaNota.appendChild(celdaExtra);
    filaNota.appendChild(document.createElement("div")); // columna derecha vacía — balancea el centrado de celdaExtra
  } else {
    filaNota.appendChild(lineaNota);
  }
  cont.appendChild(filaNota);

  const filaNotaFinal = document.createElement("div");
  filaNotaFinal.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;";
  const lineaNotaFinal = document.createElement("span");
  lineaNotaFinal.style.fontWeight = "700";
  lineaNotaFinal.textContent = `Nota final: ${textoNotaFinal}`;
  // Pedido explícito: "en nota final NO debe cambiar de color" — la escala
  // de color queda solo en la pill de cada asignación (construirFilaAsignacion).
  filaNotaFinal.appendChild(lineaNotaFinal);

  const celdaProyectar = document.createElement("div");
  celdaProyectar.style.justifySelf = "center";
  if (hayCriterios) celdaProyectar.appendChild(crearBtnProyectar());
  filaNotaFinal.appendChild(celdaProyectar);

  const celdaEditar = document.createElement("div");
  celdaEditar.style.justifySelf = "end";
  celdaEditar.appendChild(crearBtnEditarManual());
  filaNotaFinal.appendChild(celdaEditar);

  cont.appendChild(filaNotaFinal);

  return cont;
}

function construirSeccionNotas(mm, materia, plan, onCambiar) {
  inicializarEstadoTarjetasSemestresSiHaceFalta();
  const escalaActiva = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  // FIX sync (2026-08-02): antes esto llamaba a recalcularNotaFinal(), que
  // MUTABA mm.nota_final en cada render sin sellar timestamp — eso es lo
  // que disparaba conflictos falsos entre dispositivos (ver comentario en
  // recalcularNotaFinal). Ahora solo se calcula el valor a mostrar, sin
  // tocar mm; la persistencia real solo ocurre dentro de un flujo de
  // edición (persistirCambioMateria / abrirModalNotaManual).
  const notaFinalVigente = calcularNotaFinalVigente(mm, materia, plan);

  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:10px; margin-top:6px;";

  const criterios = [...(mm.criterios || [])].sort((a, b) => (Number(a.orden) || 0) - (Number(b.orden) || 0));
  if (criterios.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no hay criterios de evaluación para esta materia.";
    cont.appendChild(vacio);
  } else {
    // Fase 8 — Drag and drop (2026-08-04, spec completa): contenedor propio
    // para la lista de criterios de ESTA materia — es el contenedor que
    // recibe el drop al reordenar criterios (ver "Reordenar" en el menú
    // rápido de un criterio, abrirMenuRapidoCriterio).
    const contCriterios = document.createElement("div");
    contCriterios.className = "stack criterios-lista-reordenable";
    contCriterios.style.cssText = "gap:8px;";
    contCriterios.dataset.mmIdCriterios = mm.id;
    criterios.forEach((criterio) => {
      contCriterios.appendChild(construirTarjetaCriterio(criterio, mm, materia, plan, escalaActiva, onCambiar));
    });
    cont.appendChild(contCriterios);

    if (criteriosListaEnReordenar.has(mm.id)) {
      wirearArrastreCriterios(contCriterios, mm, materia, plan, onCambiar);
      cont.appendChild(construirBotonListoReordenar(contCriterios, mm.id, criteriosListaEnReordenar, onCambiar));
    }

    // Pedido explícito ("que se vea todo parejito"): antes cada tarjeta de
    // criterio igualaba el ancho de sus propias pills por separado, así que
    // dos criterios distintos en la misma materia podían tener columnas de
    // ancho distinto entre sí. Ahora se igualan TODAS las pills de Nota y
    // Puntaje de la materia entera (los criterios ya están en `cont`) de
    // una sola pasada, para que la columna quede alineada de punta a punta.
    igualarAnchoBadges(cont);
  }

  // Ajuste (2026-08-02): la nota final y "Editar a mano" ahora van AL FINAL
  // de los criterios (antes iban primero) — para que el flujo de lectura
  // sea "acá están los criterios, y este es el resultado", no al revés.
  cont.appendChild(construirEncabezadoNotaFinal(mm, materia, plan, notaFinalVigente, escalaActiva, onCambiar));

  const btnNuevoCriterio = document.createElement("button");
  btnNuevoCriterio.type = "button";
  btnNuevoCriterio.className = "btn btn-secondary btn-block";
  btnNuevoCriterio.textContent = "+ Nuevo criterio";
  btnNuevoCriterio.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalCriterio({ mm, materia, plan, escalaActiva, onGuardado: onCambiar });
  });
  // Pedido explícito: si el 100% ya está repartido entre los criterios
  // existentes, no tiene sentido ofrecer crear uno más (no habría margen
  // que asignarle). Mismo margen de tolerancia de coma flotante que ya usa
  // notasCompletas() en semestres.js.
  if (100 - sumaValorTotalCriterios(mm) > 0.001) {
    cont.appendChild(btnNuevoCriterio);
  }

  return cont;
}

// Pendiente #3 (2026-08-03) — "Separar el estado de cada semestre del
// estado del Plan de estudios": esta función ANTES se llamaba
// abrirMenuRapidoEstadoMatricula(materia, ...) y escribía directo sobre
// materia.estado — el campo sticky del Plan de estudios (ver ESTADOS_MATERIA
// en plan-vista-lista-tarjetas.js). Eso significaba que corregir a mano el
// resultado de UN intento puntual desde Semestres terminaba pisando el
// estado global de la materia en el Plan, afectando también cualquier otro
// semestre donde esa materia se haya matriculado.
//
// Ahora esta acción escribe sobre `mm.resultado` — el campo que ya existía
// en el schema (ver crearMateriaMatriculada) específicamente para el
// resultado real de ESTE intento, independiente de materia.estado — y por
// eso NUNCA llama a renderizarPlanEstudios(): editar esto no debe afectar
// la vista de Plan de estudios ni viceversa. Solo tiene sentido en un
// semestre ya "pasado": mientras el semestre está en curso, el badge
// siempre muestra "Cursando" derivado en vivo (ver
// construirTarjetaMateriaMatriculada) y no hay nada que fijar a mano
// todavía — por eso el popover solo se abre para semestres pasados (ver el
// long-press condicionado más abajo).
//
// BUG FIX (reportado: "no me deja marcar reprobada, solo aprobada o sin
// resultado"): la causa real es la misma que ya documenta buscarMmVivaPorId
// más arriba en este archivo — estado.datos se reemplaza por un objeto
// NUEVO en cada sync (~9s). El popover queda abierto capturando la `mm` de
// ese momento; si pasa un ciclo de sync antes de tocar una opción, esa `mm`
// queda huérfana y escribirle .resultado no tiene ningún efecto real (muta
// un objeto que ya nadie referencia). Por eso "a veces sí, a veces no":
// dependía de qué tan rápido se hiciera clic después de abrir el popover.
// Ahora se vuelve a buscar la mm VIVA por id justo antes de escribir, igual
// que hace el resto del archivo (ver persistirCambioMateria, etc.).
const OPCIONES_RESULTADO_MATRICULA = [
  { valor: "aprobada", texto: "Aprobada" },
  { valor: "reprobada", texto: "Reprobada" },
  // Pedido explícito: no tiene sentido que un botón de "estado" diga
  // "Sin resultado" — es la opción neutra/por defecto, se llama "Estado".
  { valor: null, texto: "Estado" },
];

function abrirMenuRapidoResultadoMatricula(mm, anclaEl, onCambiar) {
  document.querySelectorAll(".popover-estado-rapido").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-estado-rapido";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:160px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  OPCIONES_RESULTADO_MATRICULA.forEach((opcion) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn " + (mm.resultado === opcion.valor ? "btn-primary" : "btn-secondary") + " btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = opcion.texto;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const mmViva = buscarMmVivaPorId(mm.id);
      if (!mmViva) {
        mostrarToast("Esta materia se eliminó desde otro dispositivo");
        pop.remove();
        onCambiar();
        return;
      }
      mmViva.resultado = opcion.valor;
      sellarTimestamp(mmViva);
      marcarCambioPendiente();
      pop.remove();
      onCambiar();
      // A propósito: NO se llama renderizarPlanEstudios() — este cambio es
      // exclusivo de este semestre/intento, no debe tocar el Plan de estudios.
    });
    pop.appendChild(item);
  });

  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", function cerrar(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", cerrar);
      }
    });
  }, 300);
}

/**
 * v2.1.4: se reemplaza el ciclo automático→actual→pasado→automático (el
 * bug reportado — "activé actual manual pero no me deja desactivarlo" — era
 * justamente que hacía falta un TERCER long-press para volver a
 * automático, lo cual se sentía como que estaba trabado) por un popover
 * explícito con las 3 opciones, mismo patrón que abrirMenuRapidoEstadoMatricula.
 * Ahora "apagar el manual" es 1 solo click en "Automático", sin adivinar
 * cuántas veces hay que presionar.
 */
function abrirMenuRapidoEstadoSemestre(semestre, anclaEl, onCambiar) {
  document.querySelectorAll(".popover-estado-rapido").forEach((el) => el.remove());

  const opciones = [
    { valor: null, texto: "Automático (detectar por fecha)" },
    { valor: "actual", texto: "Forzar: Actual" },
    { valor: "pasado", texto: "Forzar: Pasado" },
  ];

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-estado-rapido";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:210px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  opciones.forEach((opcion) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn " + (semestre.estado_manual === opcion.valor ? "btn-primary" : "btn-secondary") + " btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = opcion.texto;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
      // BUG FIX (ronda actual — closure viejo, "a veces sí, a veces no"):
      // este era el único popover de "editar algo" en el archivo que
      // mutaba directo el `semestre` capturado al abrirse, en vez de
      // releerlo vivo por id como ya hacen mm/criterio/asignación. Si un
      // sondeo (~9s) reemplazaba estado.datos mientras el popover seguía
      // abierto, forzar "Actual"/"Pasado"/"Automático" no hacía nada.
      const semestreVivo = (estado.datos.semestres || []).find((s) => s.id === semestre.id) || null;
      if (!semestreVivo) {
        mostrarToast("Este semestre se eliminó desde otro dispositivo");
        pop.remove();
        onCambiar();
        return;
      }
      semestreVivo.estado_manual = opcion.valor;
      sellarTimestamp(semestreVivo);
      marcarCambioPendiente();
      pop.remove();
      onCambiar();
    });
    pop.appendChild(item);
  });

  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", function cerrar(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", cerrar);
      }
    });
  }, 300);
}

function construirBadgeEstadoSemestre(semestre, onCambiar) {
  const efectivo = obtenerEstadoEfectivoSemestre(semestre);
  const esManual = semestre.estado_manual === "actual" || semestre.estado_manual === "pasado";

  const badge = document.createElement("span");
  badge.className = "badge " + (efectivo === "actual" ? "badge-success" : "badge-neutral");
  badge.textContent = (efectivo === "actual" ? "Actual" : "Pasado") + (esManual ? " (manual)" : "");
  badge.style.cursor = "pointer";
  badge.title = "Clic para elegir Automático/Actual/Pasado.";

  // Pendiente #4 (2026-08-03): antes requería mantener presionado (o clic
  // derecho) — ahora un solo clic abre el menú, igual que el resto de
  // acciones rápidas de un solo toque en la app.
  badge.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirMenuRapidoEstadoSemestre(semestre, badge, onCambiar);
  });

  return badge;
}

/**
 * Tarjeta flotante de profesores vinculados a UNA materia matriculada
 * puntual (mm.profesor_ids) — abierta desde el ícono 👤 en la tarjeta de
 * materia. 2026-08-09 (pedido explícito, 3 respuestas de comportamiento
 * confirmadas):
 *  1) Sin profesor vinculado: dice "Ningún profe vinculado" + botón de
 *     vincular (existente o nuevo profesor).
 *  2) Con profesor(es): lista de solo lectura + botón "Editar" que recién
 *     ahí habilita un botón de "Quitar" por profesor + la opción de
 *     vincular otro más.
 *  3) (ACTUALIZADO, mismo día): tocar la tarjetita de un profesor ya SÍ
 *     puede llevar a Comunidad — abre una tarjeta flotante con toda su
 *     info + botón "Ir" (ver _abrirTarjetaProfesorFlotante arriba), que
 *     recién ahí hace la navegación real. Este popover en sí sigue sin
 *     navegar solo — la decisión de ir a Comunidad queda del lado del
 *     usuario, un toque más allá.
 * Reutiliza abrirModalAsignarProfesorDesdeHistorial (plan-detalle.js) para
 * el paso de "elegir/crear profesor" — mismo flujo que ya usa el Historial
 * de Plan de Estudios, solo con otro punto de entrada.
 */
function abrirPopoverProfesoresMateria(mm, materia, plan, semestre, onCambiar) {
  document.querySelectorAll(".overlay-profesores-materia").forEach((el) => el.remove());
  if (!Array.isArray(mm.profesor_ids)) mm.profesor_ids = [];

  const overlay = document.createElement("div");
  overlay.className = "overlay-profesores-materia";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:315; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:380px; width:100%; padding:18px; max-height:75vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  let editando = false;

  function refrescarVinculacion() {
    // Al vincular/desvincular desde acá, la tarjeta de materia de fondo
    // (Nota:/estado/etc.) no depende de esto, pero onCambiar() re-renderiza
    // el semestre completo para que el resto de la UI quede consistente.
    onCambiar();
  }

  function renderContenido() {
    caja.innerHTML = "";

    const encabezado = document.createElement("div");
    const ids = Array.isArray(mm.profesor_ids) ? mm.profesor_ids : [];
    const profesores = ids.map((id) => (estado.datos.profesores || []).find((p) => p.id === id)).filter(Boolean);
    encabezado.innerHTML = `<h2 style="margin:0;">${profesores.length > 1 ? "Profesores" : "Profesor"}</h2><p class="muted" style="margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${aplicarFormatoTexto(
      materia.nombre
    )}</p>`;
    caja.appendChild(encabezado);

    const lista = document.createElement("div");
    lista.className = "stack";
    lista.style.cssText = "gap:6px; margin-top:10px;";

    if (profesores.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent = "Ningún profe vinculado.";
      lista.appendChild(p);
    } else {
      profesores.forEach((profesor) => {
        const fila = document.createElement("div");
        fila.className = "glass-panel row";
        fila.style.cssText = "padding:8px 12px; align-items:center; gap:8px; cursor:pointer;";
        fila.title = "Ver información de este profesor";
        // Tocar la fila (fuera del botón Quitar) abre la tarjeta flotante
        // con toda la info del profesor + botón "Ir" a Comunidad — ver
        // _abrirTarjetaProfesorFlotante, inyectada desde comunidad.js.
        fila.addEventListener("click", () => {
          if (_abrirTarjetaProfesorFlotante) _abrirTarjetaProfesorFlotante(profesor);
        });

        const nombre = document.createElement("span");
        nombre.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
        nombre.textContent = `👤 ${profesor.nombre}`;
        fila.appendChild(nombre);

        // El botón de Quitar solo aparece en modo Editar (pedido
        // explícito: "un boton que diga editar y aho ya habilite botones
        // de quitar") — la vista inicial es de solo lectura.
        if (editando) {
          const btnQuitar = document.createElement("button");
          btnQuitar.type = "button";
          btnQuitar.className = "btn-icono-quitar";
          btnQuitar.title = "Desvincular a este profesor";
          btnQuitar.setAttribute("aria-label", "Desvincular a este profesor");
          btnQuitar.textContent = "🗑";
          btnQuitar.addEventListener("click", (ev) => {
            // Sin esto, el click también dispara el listener de la fila
            // (abrir la tarjeta flotante) justo cuando lo que se quiere es
            // desvincular — se corta la propagación acá.
            ev.stopPropagation();
            mm.profesor_ids = mm.profesor_ids.filter((id) => id !== profesor.id);
            sellarTimestamp(mm);
            marcarCambioPendiente();
            renderContenido();
            refrescarVinculacion();
          });
          fila.appendChild(btnQuitar);
        }
        lista.appendChild(fila);
      });
    }
    caja.appendChild(lista);

    const filaBotones = document.createElement("div");
    filaBotones.className = "row";
    filaBotones.style.cssText = "gap:8px; flex-wrap:nowrap; margin-top:12px;";

    if (profesores.length === 0) {
      // Caso 1: sin nada vinculado — un solo botón de vincular.
      const btnVincular = document.createElement("button");
      btnVincular.type = "button";
      btnVincular.className = "btn btn-primary";
      btnVincular.style.flex = "1";
      btnVincular.textContent = "Vincular profesor";
      btnVincular.addEventListener("click", () => {
        abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, () => {
          renderContenido();
          refrescarVinculacion();
        });
      });
      filaBotones.appendChild(btnVincular);
    } else if (!editando) {
      // Caso 2 (vista inicial, solo lectura): botón "Editar".
      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.className = "btn btn-secondary";
      btnEditar.style.flex = "1";
      btnEditar.textContent = "Editar";
      btnEditar.addEventListener("click", () => {
        editando = true;
        renderContenido();
      });
      filaBotones.appendChild(btnEditar);
    } else {
      // Caso 2 (modo edición): además de los "Quitar" por fila, se puede
      // vincular otro profesor más.
      const btnAgregar = document.createElement("button");
      btnAgregar.type = "button";
      btnAgregar.className = "btn btn-secondary";
      btnAgregar.style.flex = "1";
      btnAgregar.textContent = "+ Agregar profesor";
      btnAgregar.addEventListener("click", () => {
        abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, () => {
          renderContenido();
          refrescarVinculacion();
        });
      });
      filaBotones.appendChild(btnAgregar);
    }

    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.className = "btn btn-secondary";
    btnCerrar.style.flex = "1";
    btnCerrar.textContent = "Cerrar";
    btnCerrar.addEventListener("click", () => overlay.remove());
    filaBotones.appendChild(btnCerrar);

    caja.appendChild(filaBotones);
  }

  renderContenido();
  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function construirTarjetaMateriaMatriculada(mm, materia, plan, semestre, onCambiar) {
  const expandida = estado.semestresExpandidos.get(mm.id) || false;

  // D/E/F: acá adentro (la tarjeta de UN semestre concreto) el badge no
  // muestra materia.estado del Plan — muestra lo que corresponde a ESTE
  // intento puntual. Si el semestre sigue actual, siempre es "Cursando"
  // (esta mm es justo la razón por la que se deriva así — ver
  // obtenerEstadoEfectivoMateria en schema.js). Si el semestre ya terminó,
  // se muestra mm.resultado — el resultado real de ESE intento, que puede
  // no coincidir con el materia.estado actual del Plan si se repitió
  // después (por diseño: repetir no reescribe el historial de intentos
  // anteriores).
  const semestreActual = obtenerEstadoEfectivoSemestre(semestre) === "actual";
  const infoEstado = semestreActual
    ? ESTADOS_MATERIA.find((e) => e.valor === "cursando")
    : mm.resultado === "aprobada"
    ? { texto: "Aprobada", badge: "badge-success" }
    : mm.resultado === "reprobada"
    ? { texto: "Reprobada", badge: "badge-danger" }
    : { texto: "Estado", badge: "badge-neutral" };

  const card = document.createElement("div");
  card.className = "glass-panel materia-card";
  // 2026-08-19: identificador en el DOM para ubicar esta tarjeta puntual
  // desde otro módulo — mismo criterio que card.dataset.semestreId en
  // construirTarjetaSemestre más abajo. Lo usa navegarAMateriaMatriculada
  // (semestres.js), llamada desde la ➤ de la tarjeta-resumen del tab
  // Cronograma en Agenda (agenda-materia.js).
  card.dataset.mmId = mm.id;
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  if (categoria) card.style.boxShadow = `inset 6px 0 0 0 ${categoria.color}`;

  const filaPrincipal = document.createElement("div");
  filaPrincipal.className = "materia-fila-principal";
  filaPrincipal.addEventListener("click", () => {
    estado.semestresExpandidos.set(mm.id, !expandida);
    onCambiar();
  });

  // ===== Fábricas reutilizables (2026-08-09, pedido explícito: "SOLAMENTE
  // en pantallas estrechas" la tarjeta pasa a 3 líneas) =====
  // Para no arriesgar el layout de escritorio (que debe quedar
  // BYTE-A-BYTE igual a como estaba), se arma el layout ancho de siempre
  // (linea1/linea2, sin tocar nada) Y, en paralelo, un segundo juego de
  // filas — angosto, 3 líneas — con nodos propios (nunca se reutiliza el
  // mismo nodo en dos contenedores). CSS decide cuál juego se ve según el
  // ancho (ver .materia-linea1/.materia-linea2 vs
  // .materia-linea*-angosta en design-system.css): por defecto el angosto
  // vive con display:none, así que si por lo que sea el CSS no cargara,
  // el resultado sigue siendo el layout de escritorio de toda la vida, no
  // uno roto o duplicado a la vista.
  function crearPrefijoCodigo() {
    const prefijo = document.createElement("span");
    prefijo.className = "materia-prefijo";
    const spanCodigo = document.createElement("span");
    spanCodigo.className = "materia-codigo";
    spanCodigo.textContent = materia.codigo;
    spanCodigo.style.cssText = "position:relative; top:-3px; cursor:pointer;";
    spanCodigo.title = "Ver la tarjeta de esta materia";
    spanCodigo.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalRequisito(materia.codigo);
    });
    prefijo.appendChild(spanCodigo);
    return prefijo;
  }

  function crearSpanNombre() {
    const spanNombre = document.createElement("span");
    spanNombre.className = "materia-nombre " + (expandida ? "completa" : "truncada");
    spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
    return spanNombre;
  }

  // Ajuste (2026-08-07, pedido explícito — 2do ajuste, reemplaza el
  // anterior): "Nota: X" debe verse EXACTAMENTE igual que el nombre de la
  // materia — mismo tamaño, misma tipografía, mismo peso. Se logra
  // reutilizando los mismos valores que .materia-nombre en design-system.css
  // (font-family:var(--font-display), font-weight:700) y SIN fijar
  // font-size ni color acá: al no forzar ninguno de los dos, ambos spans
  // heredan el mismo tamaño/color base que ya usa .materia-nombre (que
  // tampoco los fija explícito) — así quedan visualmente idénticos.
  const notaFinalVigenteLinea1 = calcularNotaFinalVigente(mm, materia, plan);
  const notaRedondeadaLinea1 = redondearNotaFinalAlCincoMasCercano(notaFinalVigenteLinea1);
  // FIX (2026-08-08 — "un 37 se sigue marcando como 370 en lugar de 3.7"):
  // mismo bug que en construirEncabezadoNotaFinal — notaRedondeadaLinea1 es
  // 0-100 interno, hay que convertirlo a la escala del plan para mostrar.
  const escalaActivaLinea1 = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  const notaRedondeadaLinea1Mostrada = convertirDesde100(notaRedondeadaLinea1, obtenerEscalaPorId(escalaActivaLinea1));
  const textoNota = `Nota: ${
    notaRedondeadaLinea1 === null || notaRedondeadaLinea1 === undefined ? "—" : formatearNumero(notaRedondeadaLinea1Mostrada)
  }`;
  function crearSpanNota() {
    const spanNota = document.createElement("span");
    spanNota.className = "materia-nota";
    spanNota.style.cssText = "flex-shrink:0; font-family:var(--font-display); font-weight:700; white-space:nowrap;";
    spanNota.textContent = textoNota;
    return spanNota;
  }

  // Punto pendiente (2026-08-09, confirmado): ícono 👤 clickeable. Abre una
  // tarjeta flotante de solo consulta con los profesores vinculados a ESTA
  // materia matriculada puntual — nunca navega a Comunidad, todo se
  // resuelve ahí mismo.
  function crearIconoProfesor() {
    const iconoProfesor = document.createElement("span");
    iconoProfesor.className = "materia-icono-profesor";
    iconoProfesor.style.cssText = "flex-shrink:0; cursor:pointer; font-size:0.85rem; line-height:1;";
    iconoProfesor.textContent = "👤";
    iconoProfesor.title = "Profesores vinculados a esta materia";
    iconoProfesor.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirPopoverProfesoresMateria(mm, materia, plan, semestre, onCambiar);
    });
    return iconoProfesor;
  }

  function crearBadgeEstado() {
    const badgeEstado = document.createElement("span");
    badgeEstado.className = `badge ${infoEstado.badge}`;
    badgeEstado.textContent = infoEstado.texto;
    if (semestreActual) {
      // Mientras el semestre está en curso, "Cursando" se deriva en vivo
      // (ver obtenerEstadoEfectivoMateria en schema.js) — no hay nada que
      // fijar a mano todavía, así que el badge queda de solo lectura.
      badgeEstado.style.cursor = "default";
      badgeEstado.title = "Se calcula automáticamente mientras el semestre esté en curso";
    } else {
      badgeEstado.style.cursor = "pointer";
      badgeEstado.title =
        "Clic para corregir el resultado de este intento — solo afecta este semestre, no el Plan de estudios";
      badgeEstado.addEventListener("click", (ev) => {
        ev.stopPropagation();
        abrirMenuRapidoResultadoMatricula(mm, badgeEstado, onCambiar);
      });
    }
    return badgeEstado;
  }

  function crearBadgeUniversidad() {
    const badgeUniversidad = document.createElement("span");
    badgeUniversidad.className = "badge badge-neutral";
    badgeUniversidad.textContent = textoBadgeUniversidad(plan.universidad);
    badgeUniversidad.title = plan.universidad;
    return badgeUniversidad;
  }

  function crearBadgeCreditos() {
    const badgeCreditos = document.createElement("span");
    badgeCreditos.className = "badge badge-accent";
    badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
    return badgeCreditos;
  }

  function crearIconoExpandir() {
    const iconoExpandir = document.createElement("span");
    iconoExpandir.className = "materia-expandir";
    iconoExpandir.textContent = expandida ? "▲" : "▼";
    return iconoExpandir;
  }

  // ===== Vista ANCHA (escritorio/tablet — sin cambios) =====
  // Línea 1: Código, Materia, Nota, 👤
  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.alignItems = "center";
  linea1.appendChild(crearPrefijoCodigo());
  linea1.appendChild(crearSpanNombre());
  linea1.appendChild(crearSpanNota());
  linea1.appendChild(crearIconoProfesor());
  filaPrincipal.appendChild(linea1);

  // Línea 2: Estado (izquierda), Universidad (centro), Créditos + flecha (derecha)
  const linea2 = document.createElement("div");
  // FIX (2026-08-09 — "se duplicó estado/universidad/creditos/flecha en
  // primera línea"): antes el grid 1fr/auto/1fr se fijaba con
  // linea2.style.cssText (estilo INLINE), que le gana a CUALQUIER regla de
  // hoja de estilos externa — incluida el display:none del @media que
  // apaga esta fila en pantallas angostas (ver .materia-linea2-angosta
  // abajo). Resultado: en teléfono esta fila NUNCA se ocultaba y quedaba
  // flotando (visualmente como si fuera la "primera línea" real, porque
  // linea1 sí se ocultaba bien — ese inline solo tocaba align-items, no
  // display). Se reemplaza por una clase (.materia-linea2-semestre-grid,
  // ver design-system.css) para que el @media pueda apagarla sin pelear
  // contra un inline.
  linea2.className = "materia-linea2 materia-linea2-semestre-grid";
  linea2.style.alignItems = "center";
  linea2.style.gap = "8px";
  linea2.style.gridTemplateColumns = "1fr auto 1fr";

  const colEstado = document.createElement("div");
  colEstado.style.cssText = "justify-self:start; min-width:0;";
  colEstado.appendChild(crearBadgeEstado());
  linea2.appendChild(colEstado);

  const badgeUniversidadAncha = crearBadgeUniversidad();
  badgeUniversidadAncha.style.justifySelf = "center";
  linea2.appendChild(badgeUniversidadAncha);

  // Punto 3 (2026-08-07): columna derecha de línea 2 con Créditos + flecha
  // ▲▼ juntos.
  const colDerecha = document.createElement("div");
  colDerecha.className = "row";
  colDerecha.style.cssText = "justify-self:end; min-width:0; align-items:center; gap:8px;";
  colDerecha.appendChild(crearBadgeCreditos());
  colDerecha.appendChild(crearIconoExpandir());
  linea2.appendChild(colDerecha);

  filaPrincipal.appendChild(linea2);

  // ===== Vista ANGOSTA (pedido explícito 2026-08-09, SOLO teléfono —
  // ver @media(max-width:480px) .materia-linea*-angosta en
  // design-system.css, oculta por defecto con display:none) =====
  // Línea 1: Código, Materia (sin Nota ni 👤)
  const linea1Angosta = document.createElement("div");
  linea1Angosta.className = "materia-linea1 materia-linea1-angosta";
  linea1Angosta.style.alignItems = "center";
  linea1Angosta.appendChild(crearPrefijoCodigo());
  linea1Angosta.appendChild(crearSpanNombre());
  filaPrincipal.appendChild(linea1Angosta);

  // Línea 2: Estado (izquierda) · Universidad (centro) · Créditos (derecha)
  const linea2Angosta = document.createElement("div");
  linea2Angosta.className = "materia-linea2-angosta";

  const colEstadoAngosta = document.createElement("div");
  colEstadoAngosta.style.cssText = "justify-self:start; min-width:0;";
  colEstadoAngosta.appendChild(crearBadgeEstado());
  linea2Angosta.appendChild(colEstadoAngosta);

  const badgeUniversidadAngosta = crearBadgeUniversidad();
  badgeUniversidadAngosta.style.justifySelf = "center";
  linea2Angosta.appendChild(badgeUniversidadAngosta);

  const colCreditosAngosta = document.createElement("div");
  colCreditosAngosta.style.cssText = "justify-self:end; min-width:0;";
  colCreditosAngosta.appendChild(crearBadgeCreditos());
  linea2Angosta.appendChild(colCreditosAngosta);

  filaPrincipal.appendChild(linea2Angosta);

  // Línea 3: 👤 (izquierda) · Nota: x (centro) · flecha ▲▼ (derecha)
  const linea3Angosta = document.createElement("div");
  linea3Angosta.className = "materia-linea3-angosta";

  const colProfesorAngosta = document.createElement("div");
  colProfesorAngosta.style.cssText = "justify-self:start; min-width:0;";
  colProfesorAngosta.appendChild(crearIconoProfesor());
  linea3Angosta.appendChild(colProfesorAngosta);

  const colNotaAngosta = document.createElement("div");
  colNotaAngosta.style.cssText = "justify-self:center; min-width:0;";
  colNotaAngosta.appendChild(crearSpanNota());
  linea3Angosta.appendChild(colNotaAngosta);

  const colFlechaAngosta = document.createElement("div");
  colFlechaAngosta.style.cssText = "justify-self:end; min-width:0;";
  colFlechaAngosta.appendChild(crearIconoExpandir());
  linea3Angosta.appendChild(colFlechaAngosta);

  filaPrincipal.appendChild(linea3Angosta);

  if (mm._conflicto) {
    agregarIndicadorConflicto(card, () => abrirModalResolverConflictoMatricula(mm, materia, plan, onCambiar));
  }

  card.appendChild(filaPrincipal);

  if (expandida) {
    card.appendChild(construirSeccionNotas(mm, materia, plan, onCambiar));
  }

  return card;
}

function construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar, onEditar, onBorrar, anidada = false) {
  inicializarEstadoTarjetasSemestresSiHaceFalta();
  _ultimoOnCambiarParaResize = onCambiar;
  const expandido = estado.semestresExpandidos.get(semestre.id) || false;

  const card = document.createElement("div");
  card.className = "glass-card stack";
  // Identificador en el DOM para poder ubicar esta tarjeta puntual desde
  // otro módulo (ej. navegarASemestre en semestres.js, usado por Comunidad
  // y por el Historial de una materia en Plan de Estudios) sin depender de
  // su posición ni de recorrer manualmente el árbol.
  card.dataset.semestreId = semestre.id;
  // Pendiente #1 (2026-08-03): dentro de "Semestres pasados" esta tarjeta
  // queda anidada dentro de OTRO .glass-card (la sección "Semestres
  // pasados" en sí) — se fuerza el 100% + box-sizing acá para que no quede
  // más angosta que la sección que la contiene, sea cual sea la regla CSS
  // de anidamiento que le esté restando ancho.
  card.style.width = "100%";
  card.style.boxSizing = "border-box";
  // FIX (reportado: "no parece haber servido"): width:100% por sí solo no
  // alcanza si el contenedor padre (.stack, dentro de "Semestres pasados")
  // es un flex con align-items que NO sea stretch (ej. center/flex-start) —
  // en ese caso el hijo se encoge a su contenido sin importar qué width
  // tenga declarado. align-self:stretch fuerza a ESTA tarjeta puntual a
  // ocupar el ancho completo del contenedor sin depender de esa regla del
  // padre, que no puedo ver desde acá (vive en design-system.css).
  card.style.alignSelf = "stretch";
  card.style.margin = "0";

  // FIX real del espacio lateral perdido (reportado: "en celular tantos
  // items anidados joden la visión"): width:100% solo llena el CONTENT-BOX
  // del padre — no elimina el padding lateral propio de esta tarjeta
  // (.glass-card trae 18px, mismo valor usado en toda la app — ver
  // filaBotones en semestres.js). Dentro de "Semestres pasados" eso se
  // suma al padding del contenedor padre: 18px (padre) + 18px (esta
  // tarjeta) = 36px de espacio muerto en cada lado, mientras que el título
  // "Semestres pasados" al lado solo tiene 18px de inset. Un margen lateral
  // negativo del mismo tamaño que el padding del padre hace que esta
  // tarjeta "sangre" hasta el borde real del contenedor — su propio
  // padding pasa a ser el ÚNICO inset visible, alineado con el resto del
  // contenido de esa sección, sin desperdiciar ancho.
  if (anidada) {
    card.style.margin = "0 -18px";
    card.style.width = "calc(100% + 36px)";
  }

  const encabezado = document.createElement("div");
  encabezado.style.cssText =
    "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; cursor:pointer; user-select:none; -webkit-user-select:none; -webkit-touch-callout:none;";
  encabezado.addEventListener("click", () => {
    estado.semestresExpandidos.set(semestre.id, !expandido);
    onCambiar();
  });

  const izquierda = document.createElement("div");
  izquierda.className = "stack";
  izquierda.style.gap = "2px";
  izquierda.style.cssText = "gap:2px; min-width:0;";

  const titulo = document.createElement("h3");
  titulo.style.cssText = "margin:0; font-size:1.05rem; font-weight:800;";
  titulo.textContent = semestre.nombre;
  izquierda.appendChild(titulo);

  if (expandido) {
    const fecha = document.createElement("span");
    fecha.className = "muted";
    fecha.style.fontSize = "0.85rem";
    fecha.textContent = formatearFechaLarga(semestre.fecha_inicio);
    izquierda.appendChild(fecha);
  }
  encabezado.appendChild(izquierda);

  const centro = document.createElement("div");
  centro.style.justifySelf = "center";
  centro.appendChild(construirBadgeEstadoSemestre(semestre, onCambiar));
  encabezado.appendChild(centro);

  const derecha = document.createElement("div");
  derecha.className = "row";
  derecha.style.cssText = "justify-self:end; align-items:center; gap:8px;";
  derecha.style.cssText = "justify-self:end; align-items:center; gap:8px; min-width:0;";

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${creditosTotalesSemestre(semestre, obtenerPlanPorId)}`;
  derecha.appendChild(badgeCreditos);

  if (semestre._conflicto) {
    agregarIndicadorConflicto(card, () => abrirModalResolverConflictoSemestre(semestre, onCambiar));
  }

  if (estado.modoEdicionSemestres) {
    const lapiz = document.createElement("span");
    lapiz.textContent = "✏️";
    lapiz.title = "Editar este semestre";
    lapiz.style.cursor = "pointer";
    lapiz.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onEditar(semestre);
    });
    derecha.appendChild(lapiz);

    const papelera = document.createElement("span");
    papelera.textContent = "🗑️";
    papelera.title = "Eliminar este semestre";
    papelera.style.cursor = "pointer";
    papelera.addEventListener("click", (ev) => {
      ev.stopPropagation();
      onBorrar(semestre);
    });
    derecha.appendChild(papelera);
  }

  const iconoExpandir = document.createElement("span");
  iconoExpandir.textContent = expandido ? "▲" : "▼";
  derecha.appendChild(iconoExpandir);
  encabezado.appendChild(derecha);

  card.appendChild(encabezado);

  if (expandido) {
    const filas = (semestre.materias_matriculadas || [])
      .map((mm) => {
        const plan = obtenerPlanPorId(mm.plan_estudio_id);
        const indiceEnPlan = plan ? plan.materias.findIndex((m) => m.id === mm.materia_id) : -1;
        return { mm, plan, indiceEnPlan };
      })
      .filter((f) => f.plan && f.indiceEnPlan !== -1)
      .sort((a, b) => a.indiceEnPlan - b.indiceEnPlan);

    if (filas.length === 0) {
      const vacio = document.createElement("p");
      vacio.className = "muted";
      vacio.textContent = "Este semestre todavía no tiene materias matriculadas.";
      card.appendChild(vacio);
    } else {
      filas.forEach(({ mm, plan }) => {
        const materia = plan.materias.find((m) => m.id === mm.materia_id);
        card.appendChild(construirTarjetaMateriaMatriculada(mm, materia, plan, semestre, onCambiar));
      });
    }
  }

  return card;
}

export {
  construirTarjetaSemestre,
  abrirModalTodosLosConflictos,
  registrarAbrirTarjetaProfesorFlotante,
  // Cronograma por materia (agenda-materia.js) reusa esto tal cual para no
  // duplicar el motor de cálculo/render de criterios y asignaciones — ver
  // comentario de construirSeccionNotas más arriba.
  construirSeccionNotas,
  // Mismo motivo: la tarjeta-resumen del Cronograma clona el ícono 👤 de
  // esta misma tarjeta — reusa el popover real en vez de uno aparte.
  abrirPopoverProfesoresMateria,
  // Mismo motivo otra vez: "Nota: X" en la tarjeta-resumen usa el MISMO
  // cálculo (redondeo al 5 más cercano + conversión a la escala del plan)
  // y el MISMO formato de número que ya usa esta tarjeta — cero lógica de
  // notas duplicada en agenda-materia.js.
  calcularNotaFinalVigente,
  formatearNumero,
  // Mismo motivo otra vez: el encabezado completo de la tarjeta-resumen del
  // Cronograma (código/nombre/nota/profesor/estado/universidad/créditos)
  // reusa estos 2 helpers tal cual, para que el badge de universidad y el
  // menú rápido de resultado se vean y se comporten IDÉNTICO a la tarjeta
  // real de Semestres — cero lógica duplicada.
  textoBadgeUniversidad,
  abrirMenuRapidoResultadoMatricula,
  // Horario entre Amigos — edición de nombre/color de un amigo vinculado
  // (horario-amigos.js): reusa el mismo helper de modal dinámico JS puro
  // (overlay + .glass-card.modal-card) que ya usan todos los modales de
  // este archivo, en vez de armar uno nuevo desde cero.
  crearModalDinamico,
  agregarCampoModal,
};
