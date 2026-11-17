/* Iconos SVG de las secciones de la app (los mismos del menú lateral).
   Usan el sprite #ni-* de index.html y los colores de design-system.css (.icono-seccion[data-seccion]),
   así que siguen el estilo elegido en Ajustes (multicolor / según logo / paleta) en cualquier pantalla. */
export const SIMBOLOS_SECCION = {
  resumen: "ni-resumen",
  asistente: "ni-asistente",
  agenda: "ni-agenda",
  horario: "ni-horario",
  "tiempo-estudio": "ni-tiempo",
  semestres: "ni-libro",
  comunidad: "ni-comunidad",
  finanzas: "ni-finanzas",
  "plan-estudios": "ni-birrete",
  notas: "ni-notas",
  configuracion: "ni-config",
};

const NS = "http://www.w3.org/2000/svg";

/** Devuelve un <svg> real (no un <span> con innerHTML: ahí el <use> no se interpreta como SVG). */
export function crearIconoSeccion(id, claseExtra) {
  const simbolo = SIMBOLOS_SECCION[id];
  if (!simbolo) return null;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "icono-seccion" + (claseExtra ? " " + claseExtra : ""));
  svg.setAttribute("data-seccion", id);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const uso = document.createElementNS(NS, "use");
  uso.setAttribute("href", "#" + simbolo);
  svg.appendChild(uso);
  return svg;
}
