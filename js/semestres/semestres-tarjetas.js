/* =========================================================================
   SEMESTRES — Tarjetas (Fase 1 de "Semestres y Notas")
   Tarjeta de semestre colapsada/expandida y, dentro de ella, la tarjeta de
   cada materia matriculada. Reutiliza el estilo y las piezas ya probadas de
   plan-vista-lista-tarjetas.js / plan-detalle.js en vez de reinventarlas.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, obtenerIniciales } from "../core/utils.js";
import { agregarLongPress, mostrarToast } from "../ui/componentes.js";
import { obtenerEstadoEfectivoSemestre, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { ESTADOS_MATERIA } from "../plan/plan-vista-lista-tarjetas.js";
import { construirColumnaAccionesTarjeta } from "../plan/plan-detalle.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";

// Transitorio (no persistido) — igual que estado.materiasExpandidas en
// plan-vista-lista-tarjetas.js: qué semestres están expandidos en esta sesión.
estado.semestresExpandidos = estado.semestresExpandidos || new Map();

function creditosTotalesSemestre(semestre, obtenerPlanPorId) {
  return (semestre.materias_matriculadas || []).reduce((total, mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return total + (materia ? Number(materia.creditos) || 0 : 0);
  }, 0);
}

/** Punto 4: nombre corto si entra, iniciales si no — mismo criterio que
 *  obtenerIniciales ya usa para nombres de personas, aplicado acá a la
 *  universidad para no romper el layout de la línea con nombres largos. */
function textoBadgeUniversidad(universidad) {
  if (!universidad) return "?";
  return universidad.length > 14 ? obtenerIniciales(universidad) : universidad;
}

const MESES_LARGOS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** v2.1.2: "3 de agosto del 2026" — parseo manual (no `new Date()`) para no
 *  arriesgarse a que el navegador interprete el ISO en UTC y corra el día. */
function formatearFechaLarga(fechaISO) {
  const [anio, mes, dia] = String(fechaISO).split("-").map(Number);
  if (!anio || !mes || !dia) return fechaISO;
  return `${dia} de ${MESES_LARGOS[mes - 1]} del ${anio}`;
}

/**
 * Semestres y Notas — Fase 1: la materia-matriculada en sí no guarda casi
 * nada mutable todavía (ver crearMateriaMatriculada, schema.js) — no tiene
 * campos propios que puedan divergir de forma interesante entre dos
 * dispositivos, así que un conflicto real acá es prácticamente imposible en
 * esta fase. Aun así se sella con _version_base como cualquier entidad (regla
 * obligatoria del prompt), así que el badge puede llegar a aparecer. En vez
 * de construir un resolver genérico completo para una entidad que hoy no
 * tiene nada elegible que comparar, se deja este aviso simple — el resolver
 * real (como abrirModalResolverConflicto para materias) tiene más sentido
 * una vez que la Fase 6 le agregue campos mutables (criterios, nota_final).
 */
function manejarClickConflictoMatricula() {
  mostrarToast("Esta matrícula se registró en 2 dispositivos. Con los datos actuales no hay nada que elegir — se resuelve solo en el próximo sync.");
}

/** v2.1.2: mismo patrón exacto que abrirMenuRapidoCategoria
 *  (plan-vista-lista-tarjetas.js) pero para elegir Estado — mantener
 *  presionado (o clic derecho) el badge de Estado abre este popover. */
function abrirMenuRapidoEstadoMatricula(materia, anclaEl, onCambiar) {
  document.querySelectorAll(".popover-estado-rapido").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-estado-rapido";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:160px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  ESTADOS_MATERIA.forEach((opcion) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn btn-secondary btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = opcion.texto;
    item.addEventListener("click", () => {
      materia.estado = opcion.valor;
      sellarTimestamp(materia);
      marcarCambioPendiente();
      pop.remove();
      onCambiar();
      if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
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
 * Punto 4/5: tarjeta de UNA materia matriculada dentro del semestre
 * expandido. Mismo estilo que construirTarjetaMateria (plan-vista-lista-
 * tarjetas.js) pero SIN el punto de luz de disponibilidad (no aplica acá —
 * ya está matriculada) y CON badge de universidad (relevante en Hardcore,
 * donde un semestre puede mezclar materias de varios planes).
 */
function construirTarjetaMateriaMatriculada(mm, materia, plan, onCambiar) {
  const expandida = estado.semestresExpandidos.get(mm.id) || false;
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];

  const card = document.createElement("div");
  card.className = "glass-panel materia-card";
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  if (categoria) card.style.borderLeft = `6px solid ${categoria.color}`;

  const filaPrincipal = document.createElement("div");
  filaPrincipal.className = "materia-fila-principal";
  filaPrincipal.addEventListener("click", () => {
    estado.semestresExpandidos.set(mm.id, !expandida);
    onCambiar();
  });

  // ---- Línea 1: código · nombre · flecha expandir (v2.1.2: sin badge de
  // universidad acá — quedaba duplicado con el de línea 2; ver ese). ----
  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.alignItems = "center"; // v2.1.2: código y nombre centrados en el mismo eje vertical

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  prefijo.appendChild(spanCodigo);
  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre " + (expandida ? "completa" : "truncada");
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  linea1.appendChild(spanNombre);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandida ? "▲" : "▼";
  linea1.appendChild(iconoExpandir);

  filaPrincipal.appendChild(linea1);

  // ---- Línea 2: badge Estado (clickeable) · badge universidad · badge créditos ----
  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";

  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  badgeEstado.style.cursor = "pointer";
  badgeEstado.title = "Mantén presionado (o clic derecho) para cambiar el estado";
  agregarLongPress(badgeEstado, () => abrirMenuRapidoEstadoMatricula(materia, badgeEstado, onCambiar));
  linea2.appendChild(badgeEstado);

  const badgeUniversidad = document.createElement("span");
  badgeUniversidad.className = "badge badge-neutral";
  badgeUniversidad.textContent = textoBadgeUniversidad(plan.universidad);
  badgeUniversidad.title = plan.universidad;
  linea2.appendChild(badgeUniversidad);

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
  linea2.appendChild(badgeCreditos);

  if (mm._conflicto) {
    const badgeConflicto = document.createElement("span");
    badgeConflicto.className = "badge badge-danger";
    badgeConflicto.style.fontSize = "0.68rem";
    badgeConflicto.textContent = "⚠️ Editado en 2 dispositivos";
    badgeConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      manejarClickConflictoMatricula();
    });
    linea2.appendChild(badgeConflicto);
  }

  filaPrincipal.appendChild(linea2);
  card.appendChild(filaPrincipal);

  // ---- Expandida: Categoría + "Es requisito"/"Historial" — v2.1.2: ahora
  // reutiliza construirColumnaAccionesTarjeta TAL CUAL la usa la tarjeta de
  // materia del Plan de Estudios (mismo .materia-acciones-botones,
  // btn-secondary) en vez de un armado propio — así los botones quedan
  // EXACTAMENTE del mismo tamaño que en la lista del Plan, no los grandes
  // btn-primary del modal. + placeholder vacío para notas (Fase 6). ----
  if (expandida) {
    card.appendChild(construirColumnaAccionesTarjeta(materia, plan));

    const placeholderNotas = document.createElement("div");
    placeholderNotas.className = "placeholder-notas-materia";
    placeholderNotas.textContent = "Notas y criterios — próximamente";
    card.appendChild(placeholderNotas);
  }

  return card;
}


/**
 * Punto 1 del prompt: "posibilidad de marcarlo manual si la detección
 * automática por fecha falla". En vez de un modal aparte para 2 opciones,
 * un mantener-presionado (mismo gesto que ya usa el badge de Categoría,
 * ver agregarLongPress) cicla automático → forzar "Actual" → forzar
 * "Pasado" → automático. Sella y marca cambio pendiente como cualquier
 * otra edición manual — nunca "silencioso".
 */
function construirBadgeEstadoSemestre(semestre, onCambiar) {
  const efectivo = obtenerEstadoEfectivoSemestre(semestre);
  const esManual = semestre.estado_manual === "actual" || semestre.estado_manual === "pasado";

  const badge = document.createElement("span");
  badge.className = "badge " + (efectivo === "actual" ? "badge-success" : "badge-neutral");
  badge.textContent = (efectivo === "actual" ? "Actual" : "Pasado") + (esManual ? " (manual)" : "");
  badge.title = "Mantén presionado (o clic derecho) si la detección automática por fecha se equivocó, para forzarlo a mano.";

  agregarLongPress(badge, (ev) => {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    if (semestre.estado_manual === null) semestre.estado_manual = "actual";
    else if (semestre.estado_manual === "actual") semestre.estado_manual = "pasado";
    else semestre.estado_manual = null;
    sellarTimestamp(semestre);
    marcarCambioPendiente();
    onCambiar();
  });

  return badge;
}



/**
 * Tarjeta de semestre — colapsada (punto 4): nombre — fecha — créditos.
 * Al hacer clic, expande y muestra sus materias matriculadas en el mismo
 * orden en que aparecen en el Plan de Estudios de origen de cada una.
 * `obtenerPlanPorId` y `onCambiar` los pasa semestres.js (quien tiene el
 * acceso directo a estado.datos.planes_estudio y sabe cómo re-renderizar).
 */
function construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar) {
  const expandido = estado.semestresExpandidos.get(semestre.id) || false;

  const card = document.createElement("div");
  card.className = "glass-card stack";

  const encabezado = document.createElement("div");
  encabezado.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; cursor:pointer;";
  encabezado.addEventListener("click", () => {
    estado.semestresExpandidos.set(semestre.id, !expandido);
    onCambiar();
  });

  // ---- Izquierda: título + fecha (solo si está expandido) ----
  const izquierda = document.createElement("div");
  izquierda.className = "stack";
  izquierda.style.gap = "2px";

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

  // ---- Centro: badge Actual/Pasado (con override manual) ----
  const centro = document.createElement("div");
  centro.style.justifySelf = "center";
  centro.appendChild(construirBadgeEstadoSemestre(semestre, onCambiar));
  encabezado.appendChild(centro);

  // ---- Derecha: badge de créditos (+ conflicto si hay) + flecha ----
  const derecha = document.createElement("div");
  derecha.className = "row";
  derecha.style.cssText = "justify-self:end; align-items:center; gap:8px;";

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${creditosTotalesSemestre(semestre, obtenerPlanPorId)}`;
  derecha.appendChild(badgeCreditos);

  if (semestre._conflicto) {
    const badgeConflicto = document.createElement("span");
    badgeConflicto.className = "badge badge-danger";
    badgeConflicto.textContent = "⚠️ Editado en 2 dispositivos";
    badgeConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      manejarClickConflictoMatricula();
    });
    derecha.appendChild(badgeConflicto);
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
        card.appendChild(construirTarjetaMateriaMatriculada(mm, materia, plan, onCambiar));
      });
    }
  }

  return card;
}

export { construirTarjetaSemestre };