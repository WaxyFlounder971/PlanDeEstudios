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

estado.modoEdicionPlan = false;

/** Cambia el estado del Modo Edición y refresca badge + tarjetas. */

function alternarModoEdicionPlan() {
  estado.modoEdicionPlan = !estado.modoEdicionPlan;
  renderizarBadgeModoEdicion();
  renderizarPlanEstudios();
}

/** Muestra/oculta el badge fijo de la esquina inferior derecha (markup
 *  estático en index.html, ver #badge-modo-edicion). */

function renderizarBadgeModoEdicion() {
  const badge = document.getElementById("badge-modo-edicion");
  if (!badge) return;
  badge.classList.toggle("oculto", !estado.modoEdicionPlan);
  badge.setAttribute("aria-hidden", estado.modoEdicionPlan ? "false" : "true");
}

export { alternarModoEdicionPlan, renderizarBadgeModoEdicion };
