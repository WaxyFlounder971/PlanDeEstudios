/* =========================================================================
   BUSCAR MATERIA EN... (Parte C) — componente modular reusable
   Menú/ventanita que, dado una materia matriculada (con su materia/plan/
   semestre ya resueltos por quien invoca — no vuelve a buscarlos), ofrece
   navegar a verla en otro lugar de la app: Cronograma (Agenda), Horario,
   Plan de Estudios o Semestres (historial). La opción del lugar desde
   donde se invocó nunca aparece (parámetro `origen`).

   Vive en ui/ (no en componentes.js) porque no es un helper chico de UI
   sino una pieza con lógica propia de navegación entre 4 secciones
   distintas — separarlo evita que componentes.js termine importando medio
   módulo de cada sección (agenda/horario/plan/semestres) solo por esto.

   Estado de las 4 opciones (revisar antes de repartir a producción):
   - Cronograma: completa. Usa el mismo mecanismo que ya usa Agenda
     internamente (estado.agendaVistaActiva + estado.agendaMateriaSeleccionadaId,
     ver agenda-materia.js) — no hace scroll+resaltado porque la vista
     Cronograma YA muestra solo esa materia, no hace falta remarcar nada.
   - Horario: completa. Se agregó data-materia-id a cada bloque (ver
     horario.js) para poder ubicarlo con desplazarYResaltarElemento — el
     resaltado solo encuentra el bloque si Horario está mostrando la semana
     en la que esa materia tiene clase (normalmente la semana actual, que es
     la que carga por defecto).
   - Plan de Estudios: completa. Se agregó data-materia-id a cada tarjeta
     (ver plan-vista-lista-tarjetas.js) para ubicarla con
     desplazarYResaltarElemento — se expanden todos los bloques antes de
     buscar, para no fallar si la categoría de esa materia estaba colapsada.
   - Semestres: completa. Reusa abrirModalHistorial (plan-detalle.js) tal
     cual, sin reconstruir nada.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { mostrarSeccion } from "../main.js";
import { desplazarYResaltarElemento } from "./componentes.js";
import { abrirModalHistorial } from "../plan/plan-detalle.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";

/** ¿Esta materia tiene al menos un bloque en Horario, en el semestre
 * dado? Mismo criterio de datos que usa horario.js (semestre.bloques_horario,
 * filtrado por materia_id) — no se reconstruye nada, solo se lee. */
function existeEnHorario(semestre, materiaId) {
  return (semestre.bloques_horario || []).some((b) => b.materia_id === materiaId);
}

/**
 * Abre el menú. `contexto`:
 *   - mm, materia, plan, semestre: los objetos ya resueltos (mismo shape
 *     que ya arma tiempo-estudio.js en obtenerMateriasParaTiempoEstudio,
 *     por ejemplo) — este componente NO vuelve a buscarlos.
 *   - nombreMateria: string a mostrar en el título del menú.
 *   - origen: "tiempo-estudio" | "horario" | "plan-estudios" | "semestres"
 *     | "agenda-cronograma" — la opción que coincide con esto se oculta.
 */
function abrirBuscarMateriaEn({ mm, materia, plan, semestre, nombreMateria, origen }) {
  const opciones = [];

  // Cronograma y Horario necesitan una instancia matriculada real (mm +
  // semestre) — si quien invoca no la tiene a mano (ej. D.2, donde la
  // materia puede no estar matriculada en un semestre actual), esas 2
  // opciones simplemente no aparecen en vez de romper el menú.
  if (mm && semestre && origen !== "agenda-cronograma") {
    opciones.push({
      etiqueta: "Cronograma",
      accion: () => {
        estado.agendaVistaActiva = "materia";
        estado.agendaMateriaSeleccionadaId = mm.id;
        mostrarSeccion("agenda");
      },
    });
  }

  if (mm && semestre && origen !== "horario" && existeEnHorario(semestre, materia.id)) {
    opciones.push({
      etiqueta: "Horario",
      accion: () => {
        mostrarSeccion("horario");
        setTimeout(() => desplazarYResaltarElemento(`[data-materia-id="${materia.id}"]`), 60);
      },
    });
  }

  if (origen !== "plan-estudios") {
    opciones.push({
      etiqueta: "Plan de Estudios",
      accion: () => {
        // Si el bloque (categoría) de esta materia está colapsado, la fila
        // ni siquiera está en el DOM — se expanden todos antes de buscarla
        // (mismo criterio que el botón "Expandir todos" ya existente).
        estado.bloquesColapsados = new Set();
        mostrarSeccion("plan-estudios");
        renderizarPlanEstudios();
        setTimeout(() => desplazarYResaltarElemento(`[data-materia-id="${materia.id}"]`), 60);
      },
    });
  }

  if (origen !== "semestres") {
    opciones.push({
      etiqueta: "Semestres",
      accion: () => abrirModalHistorial(materia, plan),
    });
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:360px; width:100%; gap:10px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const titulo = document.createElement("div");
  titulo.innerHTML = `
    <h2 style="margin:0; font-size:1.05rem;">Buscar materia en...</h2>
    <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">${nombreMateria}</p>
  `;
  caja.appendChild(titulo);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });

  opciones.forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.style.width = "100%";
    btn.textContent = op.etiqueta;
    btn.addEventListener("click", () => {
      cerrar();
      op.accion();
    });
    caja.appendChild(btn);
  });

  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

export { abrirBuscarMateriaEn };
