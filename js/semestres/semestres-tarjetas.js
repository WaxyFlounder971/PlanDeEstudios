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
  calcularPuntosAsignacion,
  calcularNotaFinalMateria,
} from "../core/schema.js";
import { marcarCambioPendiente, actualizarIndicadorSync } from "../core/storage-sync.js";
import { ESTADOS_MATERIA, abrirMenuRapidoCategoria, abrirModalResolverConflicto, abrirModalResolverConflictoGenerico, agregarIndicadorConflicto } from "../plan/plan-vista-lista-tarjetas.js";
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
 * Ajuste (2026-08-02, pedido explícito): "nota" (la cruda, sin redondeo de
 * la universidad) siempre se muestra con 2 decimales fijos — a diferencia
 * de formatearNumero (máx. 1, sin ceros de más), que es el formato correcto
 * para "nota final" (la que ya pasó por aplicarRedondeoRaspando).
 */
function formatearNumeroFijo(n, decimales) {
  const num = Number(n) || 0;
  return num.toFixed(decimales);
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

/**
 * Calcula el valor vigente de nota_final SIN mutar mm — para mostrar en
 * pantalla en cada render. Si hay override manual activo, es simplemente
 * mm.nota_final tal cual (no se recalcula).
 */
function calcularNotaFinalVigente(mm, materia, plan) {
  if (mm.nota_final_manual) return mm.nota_final;
  const escala = obtenerEscalaNotasMateria(materia, plan, estado.datos.configuracion);
  return calcularNotaFinalMateria(mm, escala);
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
    valor: esEdicion ? criterioExistente.valor_total : "",
    decimal: true,
  });

  const disponibleEstimado = 100 - sumaValorTotalCriterios(mm, esEdicion ? criterioExistente.id : undefined);
  const ayuda = document.createElement("p");
  ayuda.className = "muted";
  ayuda.style.fontSize = "0.8rem";
  ayuda.style.margin = "0";
  ayuda.textContent = `Disponible en esta materia: ${formatearNumero(disponibleEstimado)}%`;
  card.appendChild(ayuda);

  const mmId = mm.id;
  const criterioId = esEdicion ? criterioExistente.id : null;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    const valorNum = analizarDecimal(inputValor.value);

    if (!nombre) {
      mostrarToast("Ponele un nombre al criterio");
      return;
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
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
    const disponibleReal = 100 - sumaValorTotalCriterios(mmViva, criterioId || undefined);
    if (valorNum > disponibleReal + 0.001) {
      mostrarToast(`Ese valor supera el ${formatearNumero(disponibleReal)}% disponible en la materia`);
      return;
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
      criterioVivo.valor_total = valorNum;
      sellarTimestamp(criterioVivo);
      // Si ya tenía asignaciones, el nuevo valor_total redistribuye el
      // reparto equitativo (misma regla confirmada que al añadir una nueva).
      if (criterioVivo.asignaciones.length > 0) repartirEquitativoCriterio(criterioVivo);
    } else {
      mmViva.criterios.push(crearCriterio({ nombre, valorTotal: valorNum }));
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
    etiqueta: "Puntos del criterio",
    valor: esEdicion && asignacionExistente.modo_valor === "personalizado" ? asignacionExistente.valor : "",
    decimal: true,
  });

  function actualizarCampoValor(modo) {
    if (modo === "automatico") {
      inputValor.value = formatearNumero(equitativoEstimado);
      inputValor.disabled = true;
    } else {
      inputValor.disabled = false;
      inputValor.value = esEdicion && asignacionExistente.modo_valor === "personalizado" ? asignacionExistente.valor : "";
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

  const inputCalif = agregarCampoModal(card, {
    etiqueta: "",
    valor: esEdicion && asignacionExistente.nota !== null && asignacionExistente.nota !== undefined ? asignacionExistente.nota : "",
    decimal: true,
  });
  const labelCalif = inputCalif.parentElement.querySelector("label");

  function valorVigenteParaTope() {
    return switchValor.obtenerValor() === "automatico" ? equitativoEstimado : analizarDecimal(inputValor.value) || 0;
  }

  function actualizarEtiquetaCalif(modo) {
    labelCalif.textContent =
      modo === "puntos"
        ? `¿Cuántos puntos te dieron? (0-${formatearNumero(valorVigenteParaTope())}, dejalo vacío si aún no la tenés)`
        : `¿Qué nota te sacaste? (escala 0-${escalaActiva}, dejalo vacío si aún no la tenés)`;
  }

  actualizarCampoValor(modoValorInicial);
  actualizarEtiquetaCalif(modoCalifInicial);

  const disponible = criterio.valor_total - sumaValorAsignaciones(criterio, esEdicion ? asignacionExistente.id : undefined);
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
    const valorNum = modoValor === "automatico" ? equitativoEstimado : analizarDecimal(inputValor.value);
    const califTexto = inputCalif.value.trim();
    const califNum = califTexto === "" ? null : analizarDecimal(califTexto);

    if (!nombre) {
      mostrarToast("Ponele un nombre a la asignación");
      return;
    }
    if (modoValor === "personalizado") {
      if (!Number.isFinite(valorNum) || valorNum <= 0) {
        mostrarToast("El valor debe ser un número mayor a 0");
        return;
      }
    }
    if (califNum !== null) {
      if (modoCalif === "puntos") {
        if (!Number.isFinite(califNum) || califNum < 0 || califNum > valorNum + 0.001) {
          mostrarToast(`Los puntos deben estar entre 0 y ${formatearNumero(valorNum)}`);
          return;
        }
      } else if (!Number.isFinite(califNum) || califNum < 0 || califNum > escalaActiva) {
        mostrarToast(`La nota debe estar entre 0 y ${escalaActiva}`);
        return;
      }
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
    const disponibleReal = criterioVivo.valor_total - sumaValorAsignaciones(criterioVivo, asignacionId || undefined);
    if (modoValor === "personalizado" && valorNum > disponibleReal + 0.001) {
      mostrarToast(`Ese valor supera los ${formatearNumero(disponibleReal)} puntos disponibles en el criterio`);
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
      asignacionViva.nota = califNum;
      if (modoValor === "personalizado") asignacionViva.valor = valorNum;
      sellarTimestamp(asignacionViva);
    } else {
      const nueva = crearAsignacion({ nombre, valor: valorNum });
      nueva.modo_valor = modoValor;
      nueva.modo_calificacion = modoCalif;
      nueva.nota = califNum;
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
  criterioVivo.asignaciones.push(crearAsignacion({ nombre: `Asignación ${numero}`, valor: 0 }));
  repartirEquitativoCriterio(criterioVivo);
  sellarTimestamp(criterioVivo);
  persistirCambioMateria(mmViva, materia, plan, onCambiar);
}

/* ===================== Modal: override manual de nota_final ===================== */

function abrirModalNotaManual({ mm, materia, plan, notaFinalVigente, onGuardado }) {
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
    valor: notaFinalVigente !== null && notaFinalVigente !== undefined ? notaFinalVigente : "",
    decimal: true,
  });

  const mmId = mm.id;

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary btn-block";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const valor = analizarDecimal(inputNota.value);
    if (!Number.isFinite(valor) || valor < 0 || valor > 100) {
      mostrarToast("La nota final debe estar entre 0 y 100");
      return;
    }
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

// Estilo compartido de las pills de valor — el ancho real (fijo, igualado
// entre todas las de la tarjeta) lo pone igualarAnchoBadges() después de
// que la tarjeta ya está en el documento (ver construirTarjetaCriterio).
const PILL_ESTILO = "display:inline-flex; align-items:center; justify-content:center; height:24px; text-align:center; white-space:nowrap; font-variant-numeric:tabular-nums;";

function construirFilaAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, onCambiar) {
  const fila = document.createElement("div");
  fila.className = "row fila-asignacion";
  fila.style.cssText =
    "justify-content:space-between; align-items:center; gap:8px; padding:6px 10px; border-radius:var(--radius-sm); background:rgba(255,255,255,0.03); cursor:pointer;";
  fila.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalAsignacion({ criterio, mm, materia, plan, escalaActiva, asignacionExistente: asignacion, onGuardado: onCambiar });
  });
  agregarLongPress(fila, () => abrirMenuRapidoAsignacion(asignacion, criterio, mm, materia, plan, escalaActiva, fila, onCambiar));

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

  const pillNota = document.createElement("span");
  pillNota.className = "pill-tamano-fijo";
  pillNota.style.cssText = PILL_ESTILO;
  if (asignacion.nota === null || asignacion.nota === undefined) {
    pillNota.classList.add("badge", "badge-neutral");
    pillNota.textContent = "Pendiente";
  } else if (asignacion.modo_calificacion === "puntos") {
    pillNota.classList.add("badge", "badge-success");
    pillNota.textContent = `${formatearNumero(asignacion.nota)}/${formatearNumero(asignacion.valor)}`;
  } else {
    pillNota.classList.add("badge", "badge-success");
    pillNota.textContent = `${formatearNumero(asignacion.nota)}/${escalaActiva}`;
  }
  contDer.appendChild(pillNota);

  const pillPuntos = document.createElement("span");
  pillPuntos.className = "pill-tamano-fijo badge badge-accent";
  pillPuntos.style.cssText = PILL_ESTILO;
  const puntosObtenidos = calcularPuntosAsignacion(asignacion, escalaActiva);
  const textoPuntos = asignacion.nota === null || asignacion.nota === undefined ? "—" : formatearNumero(puntosObtenidos);
  pillPuntos.textContent = `${textoPuntos}/${formatearNumero(asignacion.valor)} pts`;
  contDer.appendChild(pillPuntos);

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
  const cont = document.createElement("div");
  cont.className = "glass-panel stack";
  cont.style.cssText = "padding:10px 12px; gap:8px;";

  /* ---------- Encabezado: Criterio | Nota | Puntaje ---------- */
  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; cursor:pointer;";
  encabezado.title = "Mantén presionado (o clic derecho) para editar o eliminar este criterio";
  agregarLongPress(encabezado, () => abrirMenuRapidoCriterio(criterio, mm, materia, plan, encabezado, onCambiar));

  const tituloWrap = document.createElement("div");
  tituloWrap.className = "stack";
  tituloWrap.style.cssText = "gap:0;";
  const titulo = document.createElement("strong");
  titulo.style.fontSize = "0.92rem";
  titulo.textContent = criterio.nombre;
  tituloWrap.appendChild(titulo);
  // El peso del criterio dentro de la materia se muestra como subtítulo
  // discreto (ya no como badge en el encabezado — ese lugar ahora es para
  // las etiquetas de columna Nota/Puntaje, ver abajo).
  const subtitulo = document.createElement("span");
  subtitulo.className = "muted";
  subtitulo.style.fontSize = "0.72rem";
  subtitulo.textContent = `${formatearNumero(criterio.valor_total)}% de la materia`;
  tituloWrap.appendChild(subtitulo);
  encabezado.appendChild(tituloWrap);

  const etiquetasCol = document.createElement("div");
  etiquetasCol.className = "row";
  etiquetasCol.style.cssText = "gap:6px; flex-wrap:nowrap;";
  const etiquetaNota = document.createElement("span");
  etiquetaNota.className = "muted pill-tamano-fijo";
  etiquetaNota.style.cssText = PILL_ESTILO + "font-size:0.72rem; font-weight:700;";
  etiquetaNota.textContent = "Nota";
  etiquetasCol.appendChild(etiquetaNota);
  const etiquetaPuntaje = document.createElement("span");
  etiquetaPuntaje.className = "muted pill-tamano-fijo";
  etiquetaPuntaje.style.cssText = PILL_ESTILO + "font-size:0.72rem; font-weight:700;";
  etiquetaPuntaje.textContent = "Puntaje";
  etiquetasCol.appendChild(etiquetaPuntaje);
  encabezado.appendChild(etiquetasCol);

  if (criterio._conflicto) {
    agregarIndicadorConflicto(cont, () => abrirModalResolverConflictoCriterio(criterio, mm, materia, plan, onCambiar));
  }

  cont.appendChild(encabezado);

  (criterio.asignaciones || []).forEach((asig) => {
    cont.appendChild(construirFilaAsignacion(asig, criterio, mm, materia, plan, escalaActiva, onCambiar));
  });

  /* ---------- Pie: + Añadir asignación (izq) | calificación total (der) ---------- */
  const pie = document.createElement("div");
  pie.className = "row";
  pie.style.cssText = "justify-content:space-between; align-items:center; margin-top:2px;";

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-secondary";
  btnAgregar.style.cssText = "font-size:0.78rem; padding:5px 10px;";
  btnAgregar.textContent = "+ Añadir asignación";
  btnAgregar.addEventListener("click", (ev) => {
    ev.stopPropagation();
    agregarAsignacionRapida(criterio, mm, materia, plan, onCambiar);
  });
  pie.appendChild(btnAgregar);

  const puntosObtenidosCriterio = calcularPuntosCriterio(criterio, escalaActiva);
  const badgeTotal = document.createElement("span");
  badgeTotal.className = "badge badge-accent";
  badgeTotal.textContent = `${formatearNumero(puntosObtenidosCriterio)}/${formatearNumero(criterio.valor_total)} pts`;
  pie.appendChild(badgeTotal);

  cont.appendChild(pie);

  igualarAnchoBadges(cont);

  return cont;
}

/**
 * Aplica el redondeo real de "pasar raspando" (parametros_universidad del
 * plan de la materia): si la nota cruda cae por debajo de nota_aprobacion
 * pero llega al umbral_pasar_raspando, se redondea hacia arriba hasta
 * nota_aprobacion. Fuera de ese rango angosto, la nota queda tal cual. Si
 * el plan no tiene ambos valores definidos, no hay redondeo que aplicar.
 */
function aplicarRedondeoRaspando(nota, plan) {
  if (nota === null || nota === undefined) return nota;
  const params = plan.parametros_universidad || {};
  const aprobacion = Number(params.nota_aprobacion);
  const umbral = Number(params.umbral_pasar_raspando);
  if (!Number.isFinite(aprobacion) || !Number.isFinite(umbral)) return nota;
  if (nota >= umbral && nota < aprobacion) return aprobacion;
  return nota;
}

function construirEncabezadoNotaFinal(mm, materia, plan, notaFinalVigente, onCambiar) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.cssText = "gap:6px;";

  const notaRedondeada = aplicarRedondeoRaspando(notaFinalVigente, plan);
  // "Nota" = valor absoluto, siempre 2 decimales (pedido explícito). "Nota
  // final" = la misma nota ya pasada por el redondeo de la universidad
  // (aplicarRedondeoRaspando) — se mantiene con el formato compacto de
  // siempre, porque es la que importa para decidir si aprobó o no, no un
  // valor "de precisión" que alguien vaya a auditar decimal a decimal.
  const textoNota = notaFinalVigente === null || notaFinalVigente === undefined ? "—" : formatearNumeroFijo(notaFinalVigente, 2);
  const textoNotaFinal = notaRedondeada === null || notaRedondeada === undefined ? "—" : formatearNumero(notaRedondeada);

  const lineaNota = document.createElement("span");
  lineaNota.textContent = `Nota: ${textoNota}`;
  cont.appendChild(lineaNota);

  const filaNotaFinal = document.createElement("div");
  filaNotaFinal.className = "row";
  filaNotaFinal.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";

  const izq = document.createElement("span");
  izq.style.fontWeight = "700";
  izq.textContent = `Nota final: ${textoNotaFinal}`;
  filaNotaFinal.appendChild(izq);

  if (mm.nota_final_manual) {
    const badge = document.createElement("span");
    badge.className = "badge badge-warning";
    badge.style.cursor = "pointer";
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
    filaNotaFinal.appendChild(badge);
  } else {
    const btnManual = document.createElement("button");
    btnManual.type = "button";
    btnManual.className = "btn btn-secondary";
    btnManual.style.cssText = "font-size:0.75rem; padding:4px 10px;";
    btnManual.textContent = "Editar a mano";
    btnManual.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalNotaManual({ mm, materia, plan, notaFinalVigente, onGuardado: onCambiar });
    });
    filaNotaFinal.appendChild(btnManual);
  }

  cont.appendChild(filaNotaFinal);
  return cont;
}

function construirSeccionNotas(mm, materia, plan, onCambiar) {
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

  // Ajuste (2026-08-02): la nota final y "Editar a mano" ahora van AL FINAL
  // de los criterios (antes iban primero) — para que el flujo de lectura
  // sea "acá están los criterios, y este es el resultado", no al revés.
  cont.appendChild(construirEncabezadoNotaFinal(mm, materia, plan, notaFinalVigente, onCambiar));

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
    : { texto: "Sin resultado", badge: "badge-neutral" };

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
  badgeEstado.title = semestreActual
    ? "Mantén presionado (o clic derecho) para cambiar el estado de la materia en el Plan"
    : "Esto es el resultado de este intento. Mantén presionado para cambiar el estado de la materia en el Plan";
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
    agregarIndicadorConflicto(card, () => abrirModalResolverConflictoMatricula(mm, materia, plan, onCambiar));
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

export { construirTarjetaSemestre, abrirModalTodosLosConflictos };
