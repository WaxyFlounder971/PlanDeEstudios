/* =========================================================================
   SEMESTRES — Tarjetas (Fase 1 de "Semestres y Notas" + Fase 6: motor de
   notas — criterios, asignaciones, cálculo en vivo — Entrega 2/6).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, estiloBadgeCategoria, obtenerIniciales } from "../core/utils.js";
import { agregarLongPress, mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import {
  obtenerEstadoEfectivoSemestre,
  sellarTimestamp,
  crearCriterio,
  crearAsignacion,
  repartirEquitativoCriterio,
  obtenerEscalaNotasMateria,
  calcularNotaFinalMateria,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { ESTADOS_MATERIA, abrirMenuRapidoCategoria, abrirModalResolverConflictoGenerico } from "../plan/plan-vista-lista-tarjetas.js";
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

/**
 * Entrega 3: reemplaza el toast genérico de antes ("no hay nada que
 * elegir — se resuelve solo") — ahora que materia-matriculada y criterio
 * pasan por marcarConflictoSiCorresponde (ver storage-merge.js), sí hay
 * datos reales que comparar. Reutiliza el mismo modal que ya usan las
 * materias del plan (ver abrirModalResolverConflictoGenerico).
 */
function abrirModalResolverConflictoMatricula(mm, materia, plan, onCambiar) {
  abrirModalResolverConflictoGenerico({
    entidad: mm,
    plan,
    titulo: "⚠️ Matrícula editada en dos dispositivos",
    explicacion:
      `"${aplicarFormatoTexto(materia.nombre)}" (${materia.codigo}) se editó de forma distinta en dos ` +
      "dispositivos antes de que sincronizaran entre sí — puede ser el estado de la nota, un criterio o una " +
      "asignación. Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
  });
}

function abrirModalResolverConflictoCriterio(criterio, mm, materia, plan, onCambiar) {
  abrirModalResolverConflictoGenerico({
    entidad: criterio,
    plan,
    titulo: "⚠️ Criterio editado en dos dispositivos",
    explicacion:
      `El criterio "${criterio.nombre}" de "${aplicarFormatoTexto(materia.nombre)}" se editó de forma ` +
      "distinta en dos dispositivos antes de que sincronizaran entre sí. Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
  });
}

function abrirModalResolverConflictoSemestre(semestre, onCambiar) {
  abrirModalResolverConflictoGenerico({
    entidad: semestre,
    titulo: "⚠️ Semestre editado en dos dispositivos",
    explicacion:
      `"${semestre.nombre}" se editó de forma distinta en dos dispositivos antes de que sincronizaran entre sí. ` +
      "Elegí cuál versión dejar — la otra se descarta.",
    onResuelto: onCambiar,
  });
}

/* =========================================================================
   Fase 6 — Motor de notas: helpers de datos (redondeo, tumbas, cálculo)
   ========================================================================= */

/** Formato compacto para mostrar números en la UI (máx. 1 decimal, sin ceros de más). */
function formatearNumero(n) {
  const num = Number(n) || 0;
  const redondeado = Math.round(num * 10) / 10;
  return Number.isInteger(redondeado) ? String(redondeado) : redondeado.toFixed(1);
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

function sumaValorTotalCriterios(mm, excluirId) {
  return (mm.criterios || []).reduce((total, c) => total + (c.id === excluirId ? 0 : Number(c.valor_total) || 0), 0);
}

function sumaValorAsignaciones(criterio, excluirId) {
  return (criterio.asignaciones || []).reduce((total, a) => total + (a.id === excluirId ? 0 : Number(a.valor) || 0), 0);
}

/** Recalcula mm.nota_final en vivo — nunca pisa un override manual activo. */
function recalcularNotaFinal(mm, materia, plan) {
  if (mm.nota_final_manual) return;
  const escala = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  mm.nota_final = calcularNotaFinalMateria(mm, escala);
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

function crearModalDinamico({ titulo, ancha }) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const card = document.createElement("div");
  card.className = "glass-card modal-card stack" + (ancha ? " modal-card-ancha" : "");
  card.style.gap = "14px";

  const btnX = document.createElement("button");
  btnX.type = "button";
  btnX.className = "modal-x-close";
  btnX.setAttribute("aria-label", "Cerrar");
  btnX.textContent = "✕";
  btnX.addEventListener("click", () => overlay.remove());
  card.appendChild(btnX);

  if (titulo) {
    const h = document.createElement("h3");
    h.style.margin = "0";
    h.textContent = titulo;
    card.appendChild(h);
  }

  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
  return { overlay, card };
}

function agregarCampoModal(card, { etiqueta, tipo, valor, paso }) {
  const wrap = document.createElement("div");
  const label = document.createElement("label");
  label.className = "form-label";
  label.textContent = etiqueta;
  wrap.appendChild(label);

  const input = document.createElement("input");
  input.type = tipo || "text";
  input.className = "form-input";
  if (valor !== undefined && valor !== null) input.value = valor;
  if (paso) input.step = paso;
  wrap.appendChild(input);

  card.appendChild(wrap);
  return input;
}

/* ===================== Modal: crear/editar criterio ===================== */

function abrirModalCriterio({ mm, materia, plan, criterioExistente, onGuardado }) {
  const esEdicion = !!criterioExistente;
  const { overlay, card } = crearModalDinamico({ titulo: esEdicion ? "Editar criterio" : "Nuevo criterio" });

  const inputNombre = agregarCampoModal(card, {
    etiqueta: "Nombre (ej. Exámenes)",
    tipo: "text",
    valor: esEdicion ? criterioExistente.nombre : "",
  });
  const inputValor = agregarCampoModal(card, {
    etiqueta: "Valor dentro de la materia (%)",
    tipo: "number",
    valor: esEdicion ? criterioExistente.valor_total : "",
    paso: "0.1",
  });

  const disponible = 100 - sumaValorTotalCriterios(mm, esEdicion ? criterioExistente.id : undefined);
  const ayuda = document.createElement("p");
  ayuda.className = "muted";
  ayuda.style.fontSize = "0.8rem";
  ayuda.style.margin = "0";
  ayuda.textContent = `Disponible en esta materia: ${formatearNumero(disponible)}%`;
  card.appendChild(ayuda);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const valorNum = Number(inputValor.value);

    if (!nombre) {
      mostrarToast("Ponele un nombre al criterio");
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      mostrarToast("El valor debe ser un número mayor a 0");
      return;
    }
    if (valorNum > disponible + 0.001) {
      mostrarToast(`Ese valor supera el ${formatearNumero(disponible)}% disponible en la materia`);
      return;
    }

    if (esEdicion) {
      criterioExistente.nombre = nombre;
      criterioExistente.valor_total = valorNum;
      sellarTimestamp(criterioExistente);
      // Si ya tenía asignaciones, el nuevo valor_total redistribuye el
      // reparto equitativo (misma regla confirmada que al añadir una nueva).
      if (criterioExistente.asignaciones.length > 0) repartirEquitativoCriterio(criterioExistente);
    } else {
      mm.criterios.push(crearCriterio({ nombre, valorTotal: valorNum }));
    }

    persistirCambioMateria(mm, materia, plan, onGuardado);
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

function eliminarCriterio(mm, materia, plan, criterio, onCambiar) {
  abrirConfirmacion({
    titulo: "Eliminar criterio",
    mensaje: `¿Eliminar "${criterio.nombre}" y todas sus asignaciones? Esta acción no se puede deshacer.`,
    textoConfirmar: "Eliminar",
    onConfirmar: () => {
      mm.criterios = (mm.criterios || []).filter((c) => c.id !== criterio.id);
      mm._eliminados_criterios = mm._eliminados_criterios || [];
      mm._eliminados_criterios.push(crearEntradaTumba(criterio.id));
      persistirCambioMateria(mm, materia, plan, onCambiar);
    },
  });
}

/* ===================== Modal: registrar/editar asignación ===================== */

function abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente, onGuardado }) {
  const esEdicion = !!asignacionExistente;
  const { overlay, card } = crearModalDinamico({ titulo: esEdicion ? "Editar asignación" : "Nueva asignación" });

  const inputNombre = agregarCampoModal(card, {
    etiqueta: "Nombre (ej. Examen I)",
    tipo: "text",
    valor: esEdicion ? asignacionExistente.nombre : "",
  });
  const inputNota = agregarCampoModal(card, {
    etiqueta: `¿Qué nota te sacaste? (escala 0-${escalaActiva}, dejalo vacío si aún no la tenés)`,
    tipo: "number",
    valor: esEdicion && asignacionExistente.nota !== null && asignacionExistente.nota !== undefined ? asignacionExistente.nota : "",
    paso: "0.1",
  });
  const inputValor = agregarCampoModal(card, {
    etiqueta: "¿Cuánto valía? (puntos de la materia)",
    tipo: "number",
    valor: esEdicion ? asignacionExistente.valor : "",
    paso: "0.1",
  });

  const disponible = criterio.valor_total - sumaValorAsignaciones(criterio, esEdicion ? asignacionExistente.id : undefined);
  const ayuda = document.createElement("p");
  ayuda.className = "muted";
  ayuda.style.fontSize = "0.8rem";
  ayuda.style.margin = "0";
  ayuda.textContent = `Disponible en este criterio: ${formatearNumero(disponible)} puntos`;
  card.appendChild(ayuda);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const valorNum = Number(inputValor.value);
    const notaTexto = inputNota.value;
    const notaNum = notaTexto === "" ? null : Number(notaTexto);

    if (!nombre) {
      mostrarToast("Ponele un nombre a la asignación");
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      mostrarToast("El valor debe ser un número mayor a 0");
      return;
    }
    if (valorNum > disponible + 0.001) {
      mostrarToast(`Ese valor supera los ${formatearNumero(disponible)} puntos disponibles en el criterio`);
      return;
    }
    if (notaNum !== null && (!Number.isFinite(notaNum) || notaNum < 0 || notaNum > escalaActiva)) {
      mostrarToast(`La nota debe estar entre 0 y ${escalaActiva}`);
      return;
    }

    if (esEdicion) {
      asignacionExistente.nombre = nombre;
      asignacionExistente.valor = valorNum;
      asignacionExistente.nota = notaNum;
      sellarTimestamp(asignacionExistente);
    } else {
      const nueva = crearAsignacion({ nombre, valor: valorNum });
      nueva.nota = notaNum;
      criterio.asignaciones.push(nueva);
      sellarTimestamp(criterio);
    }

    persistirCambioMateria(mm, materia, plan, onGuardado);
    overlay.remove();
  });
  card.appendChild(btnGuardar);
}

function eliminarAsignacion(criterio, mm, materia, plan, asignacion, onCambiar) {
  abrirConfirmacion({
    titulo: "Eliminar asignación",
    mensaje: `¿Eliminar "${asignacion.nombre}"?`,
    textoConfirmar: "Eliminar",
    onConfirmar: () => {
      criterio.asignaciones = (criterio.asignaciones || []).filter((a) => a.id !== asignacion.id);
      criterio._eliminados_asignaciones = criterio._eliminados_asignaciones || [];
      criterio._eliminados_asignaciones.push(crearEntradaTumba(asignacion.id));
      sellarTimestamp(criterio);
      persistirCambioMateria(mm, materia, plan, onCambiar);
    },
  });
}

/** Añade una asignación instantánea (sin modal) con reparto equitativo — decisión confirmada. */
function agregarAsignacionRapida(criterio, mm, materia, plan, onCambiar) {
  const numero = (criterio.asignaciones || []).length + 1;
  criterio.asignaciones.push(crearAsignacion({ nombre: `Asignación ${numero}`, valor: 0 }));
  repartirEquitativoCriterio(criterio); // resetea TODAS a partes iguales, aunque alguna tuviera peso editado a mano
  sellarTimestamp(criterio);
  persistirCambioMateria(mm, materia, plan, onCambiar);
}

/* ===================== Modal: override manual de nota_final ===================== */

function abrirModalNotaManual({ mm, materia, plan, onGuardado }) {
  const { overlay, card } = crearModalDinamico({ titulo: "Editar nota final a mano" });

  const aviso = document.createElement("p");
  aviso.className = "muted";
  aviso.style.fontSize = "0.8rem";
  aviso.style.margin = "0";
  aviso.textContent =
    "Uso excepcional: mientras esté activo, el cálculo automático por criterios queda en pausa, y se muestra con un badge de \"editado a mano\" hasta que lo desactives.";
  card.appendChild(aviso);

  const inputNota = agregarCampoModal(card, {
    etiqueta: "Nota final (0-100)",
    tipo: "number",
    valor: mm.nota_final !== null && mm.nota_final !== undefined ? mm.nota_final : "",
    paso: "0.1",
  });

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const valor = Number(inputNota.value);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      mostrarToast("La nota final debe estar entre 0 y 100");
      return;
    }
    // No pasa por persistirCambioMateria/recalcularNotaFinal a propósito:
    // el override manual es justamente lo que NO debe recalcularse.
    mm.nota_final = valor;
    mm.nota_final_manual = true;
    sellarTimestamp(mm);
    marcarCambioPendiente();
    onGuardado();
    overlay.remove();
  });
  card.appendChild(btnGuardar);
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

function abrirMenuRapidoCriterio(criterio, mm, materia, plan, anclaEl, onCambiar) {
  abrirPopoverAcciones(anclaEl, [
    {
      texto: "Editar criterio",
      onClick: () => abrirModalCriterio({ mm, materia, plan, criterioExistente: criterio, onGuardado: onCambiar }),
    },
    {
      texto: "Eliminar criterio",
      clase: "btn-danger",
      onClick: () => eliminarCriterio(mm, materia, plan, criterio, onCambiar),
    },
  ]);
}

function abrirMenuRapidoAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, anclaEl, onCambiar) {
  abrirPopoverAcciones(anclaEl, [
    {
      texto: "Editar",
      onClick: () =>
        abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar }),
    },
    {
      texto: "Eliminar",
      clase: "btn-danger",
      onClick: () => eliminarAsignacion(criterio, mm, materia, plan, asignacion, onCambiar),
    },
  ]);
}

/* =========================================================================
   Fase 6 — Construcción de la sección de notas (reemplaza placeholderNotas)
   ========================================================================= */

function construirFilaAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, onCambiar) {
  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.cssText =
    "justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--radius-sm); background:rgba(255,255,255,0.03); cursor:pointer;";
  fila.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar });
  });
  agregarLongPress(fila, () => abrirMenuRapidoAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, fila, onCambiar));

  const izq = document.createElement("span");
  izq.style.fontSize = "0.85rem";
  izq.textContent = `${asignacion.nombre} · ${formatearNumero(asignacion.valor)} pts`;
  fila.appendChild(izq);

  const der = document.createElement("span");
  if (asignacion.nota === null || asignacion.nota === undefined) {
    der.className = "badge badge-neutral";
    der.textContent = "Pendiente";
  } else {
    der.className = "badge badge-success";
    der.textContent = `${formatearNumero(asignacion.nota)}/${escalaActiva}`;
  }
  fila.appendChild(der);

  return fila;
}

function construirTarjetaCriterio(criterio, mm, materia, plan, escalaActiva, onCambiar) {
  const cont = document.createElement("div");
  cont.className = "glass-panel stack";
  cont.style.cssText = "padding:10px 12px; gap:8px;";

  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; cursor:pointer;";
  encabezado.title = "Mantén presionado (o clic derecho) para editar o eliminar este criterio";
  agregarLongPress(encabezado, () => abrirMenuRapidoCriterio(criterio, mm, materia, plan, encabezado, onCambiar));

  const titulo = document.createElement("strong");
  titulo.style.fontSize = "0.92rem";
  titulo.textContent = criterio.nombre;
  encabezado.appendChild(titulo);

  const usado = sumaValorAsignaciones(criterio);
  const badgeValor = document.createElement("span");
  badgeValor.className = "badge badge-accent";
  badgeValor.textContent = `${formatearNumero(usado)}/${formatearNumero(criterio.valor_total)} %`;
  encabezado.appendChild(badgeValor);

  if (criterio._conflicto) {
    const badgeConflicto = document.createElement("span");
    badgeConflicto.className = "badge badge-danger";
    badgeConflicto.style.fontSize = "0.68rem";
    badgeConflicto.textContent = "⚠️ 2 dispositivos";
    badgeConflicto.title = "Este criterio se cambió de forma distinta en dos dispositivos. Toca para elegir cuál dejar.";
    badgeConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalResolverConflictoCriterio(criterio, mm, materia, plan, onCambiar);
    });
    encabezado.appendChild(badgeConflicto);
  }

  cont.appendChild(encabezado);

  (criterio.asignaciones || []).forEach((asig) => {
    cont.appendChild(construirFilaAsignacion(asig, criterio, mm, materia, plan, escalaActiva, onCambiar));
  });

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-secondary";
  btnAgregar.style.cssText = "font-size:0.78rem; padding:5px 10px; align-self:flex-start;";
  btnAgregar.textContent = "+ Añadir asignación";
  btnAgregar.addEventListener("click", (ev) => {
    ev.stopPropagation();
    agregarAsignacionRapida(criterio, mm, materia, plan, onCambiar);
  });
  cont.appendChild(btnAgregar);

  return cont;
}

function construirEncabezadoNotaFinal(mm, materia, plan, onCambiar) {
  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";

  const izq = document.createElement("span");
  izq.style.fontWeight = "700";
  const valor = mm.nota_final === null || mm.nota_final === undefined ? "—" : formatearNumero(mm.nota_final);
  izq.textContent = `Nota final: ${valor}`;
  fila.appendChild(izq);

  if (mm.nota_final_manual) {
    const badge = document.createElement("span");
    badge.className = "badge badge-warning";
    badge.style.cursor = "pointer";
    badge.textContent = "✏️ Editado a mano";
    badge.title = "Clic para volver a cálculo automático por criterios";
    badge.addEventListener("click", (ev) => {
      ev.stopPropagation();
      mm.nota_final_manual = false;
      persistirCambioMateria(mm, materia, plan, onCambiar);
      mostrarToast("La nota final vuelve a calcularse automáticamente");
    });
    fila.appendChild(badge);
  } else {
    const btnManual = document.createElement("button");
    btnManual.type = "button";
    btnManual.className = "btn btn-secondary";
    btnManual.style.cssText = "font-size:0.75rem; padding:4px 10px;";
    btnManual.textContent = "Editar a mano";
    btnManual.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalNotaManual({ mm, materia, plan, onGuardado: onCambiar });
    });
    fila.appendChild(btnManual);
  }

  return fila;
}

function construirSeccionNotas(mm, materia, plan, onCambiar) {
  const escalaActiva = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  // Refresca el valor mostrado en cada render (ej. tras un merge de sync);
  // no marca cambio pendiente por sí solo, solo lee/recalcula en memoria.
  recalcularNotaFinal(mm, materia, plan);

  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:10px; margin-top:6px;";

  cont.appendChild(construirEncabezadoNotaFinal(mm, materia, plan, onCambiar));

  const criterios = mm.criterios || [];
  if (criterios.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "font-size:0.85rem; margin:0;";
    vacio.textContent = "Todavía no hay criterios de evaluación para esta materia.";
    cont.appendChild(vacio);
  } else {
    criterios.forEach((criterio) => {
      cont.appendChild(construirTarjetaCriterio(criterio, mm, materia, plan, escalaActiva, onCambiar));
    });
  }

  const btnNuevoCriterio = document.createElement("button");
  btnNuevoCriterio.type = "button";
  btnNuevoCriterio.className = "btn btn-secondary btn-block";
  btnNuevoCriterio.textContent = "+ Nuevo criterio";
  btnNuevoCriterio.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalCriterio({ mm, materia, plan, onGuardado: onCambiar });
  });
  cont.appendChild(btnNuevoCriterio);

  return cont;
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
    badge.style.cssText += " min-width:0;";
    badge.textContent = categoria.nombre;
  } else {
    badge.className = "badge badge-neutral";
    badge.style.cssText = "cursor:pointer; justify-self:start;";
    badge.style.cssText += " min-width:0;";
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
  btnEsRequisito.style.cssText += " min-width:0;";
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
  if (categoria) card.style.boxShadow = `inset 6px 0 0 0 ${categoria.color}`;

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
  spanCodigo.style.cssText = "position:relative; top:-3px;";
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
  linea2.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:8px;";

  const colEstado = document.createElement("div");
  colEstado.style.cssText = "justify-self:start; min-width:0;";
  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  badgeEstado.style.cursor = "pointer";
  badgeEstado.title = "Mantén presionado (o clic derecho) para cambiar el estado";
  agregarLongPress(badgeEstado, () => abrirMenuRapidoEstadoMatricula(materia, badgeEstado, onCambiar));
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

  if (mm._conflicto) {
    const badgeConflicto = document.createElement("span");
    badgeConflicto.className = "badge badge-danger";
    badgeConflicto.style.fontSize = "0.68rem";
    badgeConflicto.textContent = "⚠️ Editado en 2 dispositivos";
    badgeConflicto.title = "Se cambió de forma distinta en dos dispositivos. Toca para elegir cuál dejar.";
    badgeConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalResolverConflictoMatricula(mm, materia, plan, onCambiar);
    });
    colDerecha.appendChild(badgeConflicto);
  }
  linea2.appendChild(colDerecha);

  filaPrincipal.appendChild(linea2);
  
  card.appendChild(filaPrincipal);

  if (expandida) {
    card.appendChild(construirFilaAccionesMatricula(materia, plan));
    card.appendChild(construirSeccionNotas(mm, materia, plan, onCambiar));
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
    const badgeConflicto = document.createElement("span");
    badgeConflicto.className = "badge badge-danger";
    badgeConflicto.textContent = "⚠️ Editado en 2 dispositivos";
    badgeConflicto.title = "Se cambió de forma distinta en dos dispositivos. Toca para elegir cuál dejar.";
    badgeConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalResolverConflictoSemestre(semestre, onCambiar);
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
