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

/* =========================================================================
   v1.13: UTILIDADES DE COLOR
   Funciones puras de conversión/mezcla, usadas para derivar automáticamente
   los colores de texto y las variantes de opacidad de la paleta personalizada
   (nunca se le pregunta esto al usuario — ver Prompt v1.13).
   ========================================================================= */

function hexARgb(hex) {
  let limpio = String(hex).trim().replace("#", "");
  if (limpio.length === 3) limpio = limpio.split("").map((c) => c + c).join("");
  const num = parseInt(limpio, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

/** Acepta tanto "#rrggbb" como "rgb(...)"/"rgba(...)" (formato que trae
 *  getComputedStyle para las variables de las 13 paletas fijas) y siempre
 *  devuelve {r,g,b} — el canal alfa se ignora a propósito: el resultado se
 *  usa solo como punto de partida sólido para los selectores de color. */
function colorARgb(color) {
  const texto = String(color).trim();
  if (texto.startsWith("#")) return hexARgb(texto);
  const match = texto.match(/rgba?\(([^)]+)\)/i);
  if (match) {
    const partes = match[1].split(",").map((n) => parseFloat(n.trim()));
    return { r: partes[0] || 0, g: partes[1] || 0, b: partes[2] || 0 };
  }
  return { r: 0, g: 0, b: 0 };
}

function rgbAHex(r, g, b) {
  const canal = (v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0");
  return `#${canal(r)}${canal(g)}${canal(b)}`;
}

/** Cualquier color (hex o rgba string) → hex sólido de 6 dígitos. */
function colorAHex(color) {
  const { r, g, b } = colorARgb(color);
  return rgbAHex(r, g, b);
}

function rgbAHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hexAHsl(hex) {
  const { r, g, b } = hexARgb(hex);
  return rgbAHsl(r, g, b);
}

function hslARgb(h, s, l) {
  h = ((h % 360) + 360) % 360;
  h /= 360; s /= 100; l /= 100;
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: r * 255, g: g * 255, b: b * 255 };
}

function hslAHex(h, s, l) {
  const { r, g, b } = hslARgb(h, s, l);
  return rgbAHex(r, g, b);
}

/** Mezcla lineal entre dos colores. factor=0 → colorA puro, factor=1 → colorB puro. */
function mezclarHex(colorA, colorB, factor) {
  const a = colorARgb(colorA);
  const b = colorARgb(colorB);
  const f = Math.max(0, Math.min(1, factor));
  return rgbAHex(
    a.r + (b.r - a.r) * f,
    a.g + (b.g - a.g) * f,
    a.b + (b.b - a.b) * f
  );
}

function hexARgba(color, alpha) {
  const { r, g, b } = colorARgb(color);
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;
}

/** Luminancia relativa (WCAG) — usada para decidir automáticamente si un
 *  color necesita texto claro u oscuro encima, sin preguntarle nada al
 *  usuario (ver sección "Contraste de texto" del Prompt v1.13). */
function luminanciaRelativa(color) {
  const { r, g, b } = colorARgb(color);
  const canal = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function esColorClaro(color) {
  return luminanciaRelativa(color) > 0.5;
}

/* =========================================================================
   v1.13: DERIVACIÓN AUTOMÁTICA DE LA PALETA PERSONALIZADA
   A partir de los 6 colores que el usuario sí elige (fondoCanvas, fondoCard,
   borde, accent1, accent2, luz), calcula TODO lo demás que las 13 paletas
   fijas también necesitan, siguiendo el mismo patrón de opacidades que ya
   usan esas 13 en design-system.css.
   ========================================================================= */

function calcularVariablesDerivadas(colores) {
  const { fondoCanvas, fondoCard, borde, accent1, accent2, luz } = colores;
  const canvasClaro = esColorClaro(fondoCanvas);
  const accent1Claro = esColorClaro(accent1);

  // Texto: mismo fondoCanvas, teñido hacia blanco (modo oscuro) o negro (modo
  // claro) en distintos porcentajes — así el texto sale sutilmente coloreado
  // por la paleta elegida, igual que en las 13 paletas fijas.
  const textoPrimario   = mezclarHex(fondoCanvas, canvasClaro ? "#000000" : "#ffffff", canvasClaro ? 0.85 : 0.90);
  const textoSecundario = mezclarHex(fondoCanvas, canvasClaro ? "#000000" : "#ffffff", canvasClaro ? 0.62 : 0.70);
  const textoMuted      = mezclarHex(fondoCanvas, canvasClaro ? "#000000" : "#ffffff", canvasClaro ? 0.45 : 0.52);

  // Panel: más sutil que la tarjeta (bg-card), recede más hacia el canvas.
  const fondoPanel = mezclarHex(fondoCard, fondoCanvas, 0.45);

  // Texto sobre el acento (botón primario, etc.) — automático según qué tan
  // clara sea la combinación, nunca preguntado al usuario.
  const textoSobreAccent = accent1Claro ? "#0F172A" : "#ffffff";

  return {
    "--bg-canvas": fondoCanvas,
    "--bg-card": fondoCard,
    "--bg-panel": fondoPanel,
    "--border-glass": borde,
    "--text-primary": textoPrimario,
    "--text-secondary": textoSecundario,
    "--text-muted": textoMuted,
    "--accent-1": accent1,
    "--accent-2": accent2,
    "--gradient-accent": `linear-gradient(90deg, ${accent1}, ${accent2})`,
    "--on-accent": textoSobreAccent,
    // El glow-1 sigue ligado al acento principal; el glow-2 (antes ligado a
    // accent-2) ahora sale de --color-luz, que es lo que el usuario mueve en
    // el 5º selector — así el slider de "luz" sí se nota en pantalla.
    "--accent-glow-1": hexARgba(accent1, canvasClaro ? 0.12 : 0.28),
    "--accent-glow-2": hexARgba(luz, canvasClaro ? 0.10 : 0.18),
    "--accent-1-10": hexARgba(accent1, canvasClaro ? 0.10 : 0.12),
    "--accent-1-20": hexARgba(accent1, canvasClaro ? 0.22 : 0.28),
    "--color-danger": canvasClaro ? "#dc2626" : "#f87171",
    "--color-luz": luz,
  };
}

/** Aplica los colores derivados como propiedades inline sobre :root — tiene
 *  más prioridad que las reglas [data-palette="..."] y no requiere generar
 *  CSS nuevo dinámicamente (ver "Implementación técnica" del prompt). */
function aplicarColoresPersonalizadosInline(colores) {
  const derivadas = calcularVariablesDerivadas(colores);
  Object.entries(derivadas).forEach(([variable, valor]) => {
    document.documentElement.style.setProperty(variable, valor);
  });
}

function limpiarColoresPersonalizadosInline() {
  const variables = [
    "--bg-canvas", "--bg-card", "--bg-panel", "--border-glass",
    "--text-primary", "--text-secondary", "--text-muted",
    "--accent-1", "--accent-2", "--gradient-accent", "--on-accent",
    "--accent-glow-1", "--accent-glow-2", "--accent-1-10", "--accent-1-20",
    "--color-danger", "--color-luz",
  ];
  variables.forEach((variable) => document.documentElement.style.removeProperty(variable));
}

/* ------------------------------ Tema ------------------------------ */

function aplicarPaleta(paleta, modo, coloresPersonalizados) {
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
  localStorage.setItem("tema_paleta", paleta);
  localStorage.setItem("tema_modo", modo);

  if (paleta === "personalizada" && coloresPersonalizados) {
    aplicarColoresPersonalizadosInline(coloresPersonalizados);
    localStorage.setItem("tema_paleta_personalizada_colores", JSON.stringify(coloresPersonalizados));
  } else {
    limpiarColoresPersonalizadosInline();
  }
}

function aplicarTemaGuardadoLocalmente() {
  const paleta = localStorage.getItem("tema_paleta") || "azul";
  const modo = localStorage.getItem("tema_modo") || "dark";
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);

  if (paleta === "personalizada") {
    try {
      const colores = JSON.parse(localStorage.getItem("tema_paleta_personalizada_colores") || "null");
      if (colores) aplicarColoresPersonalizadosInline(colores);
    } catch (_e) {
      // Si el JSON guardado localmente está corrupto, no rompemos el arranque:
      // simplemente se ve el fallback de [data-palette="personalizada"] (ninguno),
      // hasta que carguen los datos reales de Drive.
    }
  }
}

export {
  COLORES_PREVIEW_PALETA,
  FONDO_PREVIEW_AZUCARADO,
  TEXTO_PREVIEW_PALETA,
  aplicarPaleta,
  aplicarTemaGuardadoLocalmente,
  // v1.13 — utilidades de color y derivación (usadas por ui/paleta-personalizada.js)
  hexARgb,
  colorARgb,
  rgbAHex,
  colorAHex,
  rgbAHsl,
  hexAHsl,
  hslARgb,
  hslAHex,
  mezclarHex,
  hexARgba,
  luminanciaRelativa,
  esColorClaro,
  calcularVariablesDerivadas,
  aplicarColoresPersonalizadosInline,
  limpiarColoresPersonalizadosInline,
};
