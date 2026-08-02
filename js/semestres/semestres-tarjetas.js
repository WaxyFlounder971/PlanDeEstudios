/* =========================================================================
   SEMESTRES — Tarjetas (Fase 1 de "Semestres y Notas")
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, estiloBadgeCategoria, obtenerIniciales } from "../core/utils.js";
import { agregarLongPress, mostrarToast } from "../ui/componentes.js";
import { obtenerEstadoEfectivoSemestre, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { ESTADOS_MATERIA, abrirMenuRapidoCategoria } from "../plan/plan-vista-lista-tarjetas.js";
import { abrirModalDesbloquea, abrirModalHistorial } from "../plan/plan-detalle.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";

estado.semestresExpandidos = estado.semestresExpandidos || new Map();

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

function manejarClickConflictoMatricula() {
  mostrarToast("Esta matrícula se registró en 2 dispositivos. Con los datos actuales no hay nada que elegir — se resuelve solo en el próximo sync.");
}

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
    item.className = "btn " + (materia.estado === opcion.valor ? "btn-primary" : "btn-secondary") + " btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = opcion.texto;
    item.addEventListener("click", (ev) => {
      ev.stopPropagation();
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
      semestre.estado_manual = opcion.valor;
      sellarTimestamp(semestre);
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
  badge.title = "Mantén presionado (o clic derecho) para elegir Automático/Actual/Pasado.";

  agregarLongPress(badge, () => abrirMenuRapidoEstadoSemestre(semestre, badge, onCambiar));

  return badge;
}

/**
 * v2.1.4: Categoría / Historial / Es requisito en una fila HORIZONTAL
 * (izquierda / centro / derecha) — ya no reutiliza construirColumnaAccionesTarjeta
 * (esa arma una columna VERTICAL pensada para ir al lado de una columna de
 * Requisitos, que acá no existe). Los botones son idénticos en clase
 * (btn btn-secondary) a los que arma esa función — mismo tamaño de siempre,
 * solo cambia el contenedor/orden.
 */
function construirFilaAccionesMatricula(materia, plan) {
  const fila = document.createElement("div");
  fila.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; margin-top:6px;";

  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  const badge = document.createElement("span");
  if (categoria) {
    badge.className = "badge";
    badge.style.cssText = estiloBadgeCategoria(categoria.color) + " cursor:pointer; justify-self:start;";
    badge.textContent = categoria.nombre;
  } else {
    badge.className = "badge badge-neutral";
    badge.style.cssText = "cursor:pointer; justify-self:start;";
    badge.textContent = "Sin categoría";
  }
  badge.title = "Mantén presionado (o clic derecho) para cambiar la categoría";
  agregarLongPress(badge, () => abrirMenuRapidoCategoria(materia, plan, badge));
  fila.appendChild(badge);

  const estiloBotonComoBadge =
    "font-size:0.78rem; font-weight:700; padding:4px 12px; border-radius:var(--radius-pill); line-height:normal;";

  const btnHistorial = document.createElement("button");
  btnHistorial.type = "button";
  btnHistorial.className = "btn btn-secondary";
  btnHistorial.style.cssText = estiloBotonComoBadge + " justify-self:center;";
  btnHistorial.textContent = "Historial";
  btnHistorial.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalHistorial(materia);
  });
  fila.appendChild(btnHistorial);

  const btnEsRequisito = document.createElement("button");
  btnEsRequisito.type = "button";
  btnEsRequisito.className = "btn btn-secondary";
  btnEsRequisito.style.cssText = estiloBotonComoBadge + " justify-self:end;";
  btnEsRequisito.textContent = "Es requisito";
  btnEsRequisito.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalDesbloquea(materia, plan);
  });
  fila.appendChild(btnEsRequisito);

  return fila;
}

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

  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.alignItems = "center";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  // v2.1.4: el monoespaciado del código queda ~4px más abajo que el nombre
  // por métrica de fuente — se sube para que ambos queden centrados entre sí.
  spanCodigo.style.cssText = "position:relative; top:-4px;";
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

  if (expandida) {
    card.appendChild(construirFilaAccionesMatricula(materia, plan));

    const placeholderNotas = document.createElement("div");
    placeholderNotas.className = "placeholder-notas-materia";
    placeholderNotas.textContent = "Notas y criterios — próximamente";
    card.appendChild(placeholderNotas);
  }

  return card;
}

function construirTarjetaSemestre(semestre, obtenerPlanPorId, onCambiar, onEditar, onBorrar) {
  const expandido = estado.semestresExpandidos.get(semestre.id) || false;

  const card = document.createElement("div");
  card.className = "glass-card stack";

  const encabezado = document.createElement("div");
  encabezado.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px; cursor:pointer;";
  encabezado.addEventListener("click", () => {
    estado.semestresExpandidos.set(semestre.id, !expandido);
    onCambiar();
  });

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

  const centro = document.createElement("div");
  centro.style.justifySelf = "center";
  centro.appendChild(construirBadgeEstadoSemestre(semestre, onCambiar));
  encabezado.appendChild(centro);

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
        card.appendChild(construirTarjetaMateriaMatriculada(mm, materia, plan, onCambiar));
      });
    }
  }

  return card;
}

export { construirTarjetaSemestre };