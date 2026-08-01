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
import { construirBotonesFinalesDetalle, construirLineaCategoriaMateria } from "../plan/plan-detalle.js";

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

  // ---- Línea 1: badge universidad · código · nombre · flecha expandir ----
  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";

  const badgeUniLinea1 = document.createElement("span");
  badgeUniLinea1.className = "badge badge-neutral";
  badgeUniLinea1.style.fontSize = "0.68rem";
  badgeUniLinea1.textContent = textoBadgeUniversidad(plan.universidad);
  badgeUniLinea1.title = plan.universidad;
  prefijo.appendChild(badgeUniLinea1);

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

  // ---- Línea 2: badge Estado · badge universidad · badge créditos ----
  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";

  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  linea2.appendChild(badgeEstado);

  const badgeUniLinea2 = document.createElement("span");
  badgeUniLinea2.className = "badge badge-neutral";
  badgeUniLinea2.textContent = textoBadgeUniversidad(plan.universidad);
  badgeUniLinea2.title = plan.universidad;
  linea2.appendChild(badgeUniLinea2);

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
  linea2.appendChild(badgeCreditos);

  // Punto 4 del prompt: badge de conflicto de la MATRÍCULA (mm._conflicto),
  // no de la materia — es el mismo patrón visual que ya existe en
  // plan-vista-lista-tarjetas.js/plan-mapa.js, no un aviso nuevo aparte.
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

  // ---- Expandida: Categoría / Es requisito de... / Historial, repartidos
  // en todo el ancho — mismas piezas que ya usa la tarjeta del Plan, sin
  // reinventar el layout (punto 5). + placeholder vacío para notas (Fase 6). ----
  if (expandida) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "row-between";
    cuerpo.style.flexWrap = "wrap";

    const lineaCategoria = construirLineaCategoriaMateria(materia, plan);
    cuerpo.appendChild(lineaCategoria || document.createElement("span")); // spacer si no tiene categoría
    cuerpo.appendChild(construirBotonesFinalesDetalle(materia, plan, { esModal: false }));
    card.appendChild(cuerpo);

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
  encabezado.className = "row-between";
  encabezado.style.cursor = "pointer";
  encabezado.addEventListener("click", () => {
    estado.semestresExpandidos.set(semestre.id, !expandido);
    onCambiar();
  });

  const info = document.createElement("span");
  info.style.fontWeight = "700";
  info.textContent = `${semestre.nombre} — ${semestre.fecha_inicio} — ${creditosTotalesSemestre(semestre, obtenerPlanPorId)} créditos`;
  encabezado.appendChild(info);

  const derecha = document.createElement("div");
  derecha.appendChild(construirBadgeEstadoSemestre(semestre, onCambiar));

  // Semestre en sí también pasa por sellarTimestamp (regla obligatoria) —
  derecha.className = "row";
  derecha.style.alignItems = "center";
  derecha.style.gap = "8px";

  // Semestre en sí también pasa por sellarTimestamp (regla obligatoria) —
  // mismo badge de conflicto que las materias, no uno nuevo.
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
    // Orden del Plan de Estudios de origen — cada materia matriculada busca
    // su propia posición en el plan del que dice venir (mm.plan_estudio_id),
    // así que funciona igual con materias mezcladas de varios planes (Hardcore).
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