/* =========================================================================
   Tabla de las 13 paletas FIJAS (blanco, negro, rojo, gris, azul, verde,
   cyan, morado, rosado, indigo, amarillo, dorado, azucarado) x modo
   claro/oscuro, con los mismos valores que design-system.css.

   Esto es la fuente de verdad tanto para el generador offline de íconos
   (generar-iconos-pwa.html, que corre UNA VEZ a mano y produce los PNG +
   manifest.json reales que se commitean al repo) como para
   icono-dinamico.js en runtime (que solo necesita decidir A CUÁL de esos
   archivos ya generados apuntar, y calcular el fallback de "personalizada").

   Si se agrega o cambia una paleta en design-system.css, hay que
   actualizar esta tabla Y volver a correr el generador.
   ========================================================================= */

export const PALETAS_FIJAS_PWA = {
  blanco: {
    dark: { accent1: "#CBD5E1", accent2: "#F8FAFC", bgCanvas: "#101114", bgCard: "rgba(255,255,255,0.05)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#64748B", accent2: "#334155", bgCanvas: "#F7F8FA", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(15,23,42,0.08)" },
  },
  negro: {
    dark: { accent1: "#3F3F46", accent2: "#71717A", bgCanvas: "#000000", bgCard: "rgba(255,255,255,0.04)", borderGlass: "rgba(255,255,255,0.08)" },
    light: { accent1: "#18181B", accent2: "#000000", bgCanvas: "#FAFAFA", bgCard: "rgba(255,255,255,0.8)", borderGlass: "rgba(0,0,0,0.08)" },
  },
  rojo: {
    dark: { accent1: "#DC2626", accent2: "#F87171", bgCanvas: "#170808", bgCard: "rgba(220,38,38,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#B91C1C", accent2: "#991B1B", bgCanvas: "#FEF2F2", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(185,28,28,0.10)" },
  },
  gris: {
    dark: { accent1: "#6B7280", accent2: "#9CA3AF", bgCanvas: "#121316", bgCard: "rgba(255,255,255,0.05)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#52525B", accent2: "#27272A", bgCanvas: "#F4F4F5", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(15,23,42,0.08)" },
  },
  azul: {
    dark: { accent1: "#2563EB", accent2: "#38BDF8", bgCanvas: "#0A0E17", bgCard: "rgba(37,99,235,0.07)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#2563EB", accent2: "#0369A1", bgCanvas: "#F2F6FE", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(37,99,235,0.10)" },
  },
  verde: {
    dark: { accent1: "#16A34A", accent2: "#4ADE80", bgCanvas: "#08120D", bgCard: "rgba(22,163,74,0.07)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#15803D", accent2: "#047857", bgCanvas: "#F1FAF3", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(21,128,61,0.10)" },
  },
  cyan: {
    dark: { accent1: "#0891B2", accent2: "#22D3EE", bgCanvas: "#06141A", bgCard: "rgba(8,145,178,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#0E7490", accent2: "#155E75", bgCanvas: "#EEFBFD", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(14,116,144,0.10)" },
  },
  morado: {
    dark: { accent1: "#7C3AED", accent2: "#C084FC", bgCanvas: "#100B1A", bgCard: "rgba(124,58,237,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#6D28D9", accent2: "#9333EA", bgCanvas: "#F7F2FE", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(109,40,217,0.10)" },
  },
  rosado: {
    dark: { accent1: "#DB2777", accent2: "#F472B6", bgCanvas: "#170B12", bgCard: "rgba(219,39,119,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#BE185D", accent2: "#9D174D", bgCanvas: "#FDF1F7", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(190,24,93,0.10)" },
  },
  indigo: {
    dark: { accent1: "#4F46E5", accent2: "#818CF8", bgCanvas: "#0B0C1E", bgCard: "rgba(79,70,229,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#4338CA", accent2: "#4F46E5", bgCanvas: "#F1F1FD", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(67,56,202,0.10)" },
  },
  amarillo: {
    dark: { accent1: "#CA8A04", accent2: "#FDE047", bgCanvas: "#16130A", bgCard: "rgba(202,138,4,0.08)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#A16207", accent2: "#854D0E", bgCanvas: "#FEFBEB", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(161,98,7,0.10)" },
  },
  dorado: {
    dark: { accent1: "#B45309", accent2: "#FBBF24", bgCanvas: "#170F08", bgCard: "rgba(180,83,9,0.09)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#92400E", accent2: "#B45309", bgCanvas: "#FDF6EB", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(146,64,14,0.10)" },
  },
  azucarado: {
    dark: { accent1: "#C599E8", accent2: "#7DD3DB", bgCanvas: "#100E1C", bgCard: "rgba(255,255,255,0.05)", borderGlass: "rgba(255,255,255,0.10)" },
    light: { accent1: "#A876D9", accent2: "#1E7A85", bgCanvas: "#FBF7FD", bgCard: "rgba(255,255,255,0.75)", borderGlass: "rgba(184,166,240,0.12)" },
  },
};

function hexARgb(hex) {
  const limpio = hex.replace("#", "");
  const n = limpio.length === 3
    ? limpio.split("").map((c) => c + c).join("")
    : limpio;
  const num = parseInt(n, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function distanciaColor(hexA, hexB) {
  const a = hexARgb(hexA);
  const b = hexARgb(hexB);
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Para "personalizada" (colores arbitrarios armados a mano, imposibles de
 * pre-generar): busca cuál de las 13 paletas fijas tiene el --accent-1 más
 * parecido (distancia euclidiana simple en RGB) y devuelve su nombre, para
 * usar el ícono/manifest de ESA paleta como fallback razonable.
 */
export function paletaFijaMasParecida(accent1Hex, modo) {
  let mejorNombre = "azul";
  let mejorDistancia = Infinity;
  for (const [nombre, datos] of Object.entries(PALETAS_FIJAS_PWA)) {
    const ref = datos[modo]?.accent1 || datos.dark.accent1;
    const d = distanciaColor(accent1Hex, ref);
    if (d < mejorDistancia) {
      mejorDistancia = d;
      mejorNombre = nombre;
    }
  }
  return mejorNombre;
}
