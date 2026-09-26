/* =========================================================================
   PLAN DE ESTUDIOS — MODO EDICIÓN (punto 6, v1.9.6)
   Botón "Editar plan" en el encabezado, badge fijo "Modo edición" en la
   esquina inferior derecha, y el ícono de lápiz ✏️ que aparece en cada
   tarjeta de materia mientras el modo está activo (ver
   plan-vista-lista-tarjetas.js). El modal de edición en sí reutiliza el
   modal de "+ Añadir materia" (ver abrirModalMateriaManual en
   plan-esquema.js), precargado.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

/**
 * FIX (mismo bug de arranque "Cannot access 'estado' before initialization"
 * que en plan-categorias.js): `estado.modoEdicionPlan = false;` estaba a
 * nivel de módulo, es decir, se ejecutaba apenas se cargaba este archivo —
 * con el ciclo de imports real (storage.js -> storage-sync.js -> ... ->
 * este archivo), eso podía correr a mitad de la evaluación de storage.js,
 * antes de que `const estado` terminara de inicializarse ahí. Se mueve
 * dentro de una función lazy, guardada con `typeof === "undefined"` —
 * `undefined` se comporta igual que `false` en los dos únicos lugares que
 * leen este campo (ambos como negación booleana), así que no cambia nada
 * el comportamiento, solo cuándo se asigna el valor inicial.
 */
function inicializarEstadoModoEdicionSiHaceFalta() {
  if (typeof estado.modoEdicionPlan === "undefined") estado.modoEdicionPlan = false;
}

/** Cambia el estado del Modo Edición y refresca badge + tarjetas. */

function alternarModoEdicionPlan() {
  inicializarEstadoModoEdicionSiHaceFalta();
  estado.modoEdicionPlan = !estado.modoEdicionPlan;
  renderizarBadgeModoEdicion();
  renderizarPlanEstudios();
}

/** Muestra/oculta el badge fijo de la esquina inferior derecha (markup
 *  estático en index.html, ver #badge-modo-edicion). */

function renderizarBadgeModoEdicion() {
  inicializarEstadoModoEdicionSiHaceFalta();
  const badge = document.getElementById("badge-modo-edicion");
  if (!badge) return;
  badge.classList.toggle("oculto", !estado.modoEdicionPlan);
  badge.setAttribute("aria-hidden", estado.modoEdicionPlan ? "false" : "true");
}

export { alternarModoEdicionPlan, renderizarBadgeModoEdicion };
