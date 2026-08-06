/* =========================================================================
   COMUNIDAD — STUB TEMPORAL DE EMERGENCIA
   main.js (import estático) espera un módulo real acá con Profesores y
   Compañeros — ese módulo se empezó en otro chat pero nunca se llegó a
   entregar el archivo. Un import estático roto (404) tumba la carga de
   TODO main.js, no solo esta sección — por eso la app entera dejaba de
   funcionar. Este stub solo restaura el arranque normal (Plan de Estudios,
   Semestres, Configuración) mientras se retoma la función real.
   Reemplazá este archivo por el comunidad.js real en cuanto lo tengas —
   nada de lo de acá persiste datos ni rompe el modelo futuro.
   ========================================================================= */

function inicializarComunidad() {
  // Inyecta el contenedor por si "comunidad" quedó guardada como última
  // sección activa en localStorage de alguna sesión previa — sin esto,
  // mostrarSeccion("comunidad") en main.js no encontraría el elemento.
  if (document.getElementById("seccion-comunidad")) return;
  const cont = document.getElementById("app-shell") || document.body;
  const seccion = document.createElement("div");
  seccion.id = "seccion-comunidad";
  seccion.className = "oculto";
  seccion.innerHTML =
    '<div class="glass-panel" style="padding:24px; text-align:center;">' +
    '<p class="muted" style="margin:0;">🚧 Comunidad está en construcción — volvé pronto.</p>' +
    "</div>";
  cont.appendChild(seccion);
}

function renderizarComunidad() {
  // Sin datos que pintar todavía — no-op a propósito.
}

export { inicializarComunidad, renderizarComunidad };
