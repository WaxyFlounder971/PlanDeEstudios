/* =========================================================================
   TEMA — PALETAS Y MODO CLARO/OSCURO
   ========================================================================= */

/** Colores reales de cada paleta (modo oscuro), tomados de design-system.css.
 *  Se usan para pintar cada cuadro del selector con SU propio color, sin
 *  importar cuál paleta esté activa en <html> (punto 3 del prompt). */

const COLORES_PREVIEW_PALETA = {
  blanco:    ["#94A3B8", "#F1F5F9"],
  gris:      ["#4B5563", "#9CA3AF"],
  negro:     ["#18181B", "#000000"],
  rojo:      ["#B91C1C", "#F87171"],
  dorado:    ["#92400E", "#FBBF24"],
  amarillo:  ["#A16207", "#FDE047"],
  verde:     ["#15803D", "#4ADE80"],
  cyan:      ["#0E7490", "#22D3EE"],
  azul:      ["#2563EB", "#38BDF8"],
  indigo:    ["#4338CA", "#818CF8"],
  morado:    ["#6D28D9", "#C084FC"],
  rosado:    ["#BE185D", "#F472B6"],
  // "azucarado" no usa este formato [c1, c2]: tiene su propio fondo disperso
  // (ver FONDO_PREVIEW_AZUCARADO), igual que --gradient-accent en el CSS.
};

/** Fondo tipo "mancha de color" disperso para el swatch de azucarado (mismas
 *  manchas radiales que --gradient-accent de [data-palette="azucarado"] en
 *  design-system.css): pastel frío de rosa a cyan, sin verde ni amarillo. */

const FONDO_PREVIEW_AZUCARADO =
  "radial-gradient(120% 120% at 12% 20%, #F5A9D0 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 88% 10%, #C599E8 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 18% 90%, #9DC0F5 0%, transparent 42%)," +
  "radial-gradient(120% 120% at 85% 85%, #8FE3EA 0%, transparent 42%)," +
  "linear-gradient(135deg, #E0A0E8, #9DC0F5)";

/** Color de texto legible sobre el degradado de cada paleta (mismo criterio
 *  que --on-accent en el CSS: "blanco" necesita texto oscuro). */

const TEXTO_PREVIEW_PALETA = {
  blanco: "#1E293B",
};

/* ------------------------------ Tema ------------------------------ */

function aplicarPaleta(paleta, modo) {
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
  localStorage.setItem("tema_paleta", paleta);
  localStorage.setItem("tema_modo", modo);
}

function aplicarTemaGuardadoLocalmente() {
  const paleta = localStorage.getItem("tema_paleta") || "azul";
  const modo = localStorage.getItem("tema_modo") || "dark";
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
}

export {
  COLORES_PREVIEW_PALETA,
  FONDO_PREVIEW_AZUCARADO,
  TEXTO_PREVIEW_PALETA,
  aplicarPaleta,
  aplicarTemaGuardadoLocalmente,
};
