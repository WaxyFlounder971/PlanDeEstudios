/* =========================================================================
   ÍCONO DINÁMICO DE LA PWA
   El logo (imagenes/LogoApp.png) queda intacto — lo que se genera acá es
   un fondo glassmorphism con los colores REALES de la paleta activa
   (--accent-1/--accent-2 para el degradado, --bg-card/--border-glass para
   el panel de vidrio, los mismos rgba semitransparentes que ya usan las
   tarjetas del resto de la app) y se compone todo en un <canvas>.

   El resultado se aplica en 2 lugares porque Android/Chrome e iOS/Safari
   leen el ícono de instalación de sitios DISTINTOS:
    - manifest.json -> Android/Chrome. No se puede editar el manifest.json
      real desde JS, así que se reconstruye en memoria (mismo name/
      start_url/etc., solo se pisa `icons`) y se sirve como Blob URL.
    - <link rel="apple-touch-icon"> -> iOS/Safari, que IGNORA `icons` del
      manifest para el ícono de "Agregar a inicio".

   LIMITACIÓN ACEPTADA A PROPÓSITO (ver conversación con Wagner): el ícono
   queda "congelado" en el momento en que el navegador lo lee para instalar.
   Si el usuario cambia de paleta DESPUÉS de tener la app ya instalada en el
   teléfono, el ícono del home screen no se actualiza solo — hace falta
   reinstalar. Por eso regenerarIconoDinamico() también se llama de nuevo
   cada vez que se guarda una paleta (ver paleta-personalizada.js), para
   que quede listo por si el usuario reinstala más adelante.
   ========================================================================= */

const RUTA_LOGO = "imagenes/LogoApp.png";
const RUTA_MANIFEST_BASE = "manifest.json";

let logoPromise = null;
let manifestBaseCache = null;
let ultimaUrlBlob = null;

function leerVarCSS(nombre, fallback) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return valor || fallback;
}

function dibujarRectRedondeado(ctx, x, y, w, h, r) {
  const radio = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radio, y);
  ctx.arcTo(x + w, y, x + w, y + h, radio);
  ctx.arcTo(x + w, y + h, x, y + h, radio);
  ctx.arcTo(x, y + h, x, y, radio);
  ctx.arcTo(x, y, x + w, y, radio);
  ctx.closePath();
}

function cargarLogo() {
  if (!logoPromise) {
    logoPromise = new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = RUTA_LOGO;
    });
  }
  return logoPromise;
}

/**
 * Dibuja el ícono de tamaño `tam` (cuadrado):
 *  1) Fondo a pantalla completa con el degradado --accent-1 -> --accent-2
 *     (el mismo par de acentos que usa el resto de la app) — SIN redondear
 *     el borde exterior a propósito: el sistema operativo aplica su propia
 *     máscara (círculo, squircle, etc.) sobre el ícono, así que redondear
 *     acá encima generaría un doble borde raro en los launchers que ya
 *     recortan la forma final.
 *  2) Un brillo difuso arriba-izquierda simulando el glow que ya usan las
 *     paletas (--accent-glow-1/2), para que el degradado no se vea plano.
 *  3) Un panel de vidrio centrado con --bg-card + --border-glass (los
 *     mismos rgba semitransparentes de las tarjetas reales de la app) —
 *     esto es lo que de verdad lee como "glassmorphism siguiendo la
 *     paleta" en vez de un simple fondo de color.
 *  4) El logo PNG, intacto, centrado dentro del panel de vidrio.
 */
async function dibujarIcono(tam) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = tam;
  const ctx = canvas.getContext("2d");

  const accent1 = leerVarCSS("--accent-1", "#2563EB");
  const accent2 = leerVarCSS("--accent-2", "#7c5cff");
  const bgCard = leerVarCSS("--bg-card", "rgba(255,255,255,0.08)");
  const bordeGlass = leerVarCSS("--border-glass", "rgba(255,255,255,0.16)");

  const grad = ctx.createLinearGradient(0, 0, tam, tam);
  grad.addColorStop(0, accent1);
  grad.addColorStop(1, accent2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, tam, tam);

  ctx.save();
  const brillo = ctx.createRadialGradient(tam * 0.28, tam * 0.24, 0, tam * 0.28, tam * 0.24, tam * 0.65);
  brillo.addColorStop(0, "rgba(255,255,255,0.35)");
  brillo.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = brillo;
  ctx.fillRect(0, 0, tam, tam);
  ctx.restore();

  const panelMargen = tam * 0.1;
  const panelTam = tam - panelMargen * 2;
  const panelRadio = panelTam * 0.28;
  ctx.save();
  dibujarRectRedondeado(ctx, panelMargen, panelMargen, panelTam, panelTam, panelRadio);
  ctx.fillStyle = bgCard;
  ctx.fill();
  ctx.lineWidth = Math.max(1, tam * 0.006);
  ctx.strokeStyle = bordeGlass;
  ctx.stroke();
  ctx.restore();

  const logo = await cargarLogo();
  const escala = 0.66;
  const lw = panelTam * escala;
  const lh = lw * (logo.height / logo.width);
  ctx.drawImage(logo, (tam - lw) / 2, (tam - lh) / 2, lw, lh);

  return canvas.toDataURL("image/png");
}

async function obtenerManifestBase() {
  if (!manifestBaseCache) {
    const resp = await fetch(RUTA_MANIFEST_BASE);
    manifestBaseCache = await resp.json();
  }
  return manifestBaseCache;
}

function fijarLinkHead(rel, href) {
  let link = document.head.querySelector(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement("link");
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

/**
 * Regenera el ícono con los colores ACTUALES de la paleta activa y lo
 * aplica al manifest (Android/Chrome, vía Blob URL) y al apple-touch-icon
 * (iOS/Safari). Ver comentario de cabecera para la limitación conocida de
 * cuándo el ícono realmente termina en el home screen.
 */
async function regenerarIconoDinamico() {
  try {
    const [icono192, icono512] = await Promise.all([dibujarIcono(192), dibujarIcono(512)]);
    const manifestBase = await obtenerManifestBase();
    const themeColor = leerVarCSS("--accent-1", manifestBase.theme_color);
    const bgColor = leerVarCSS("--bg-canvas", manifestBase.background_color);

    const manifestDinamico = {
      ...manifestBase,
      icons: [
        { src: icono192, sizes: "192x192", type: "image/png", purpose: "any" },
        { src: icono512, sizes: "512x512", type: "image/png", purpose: "any" },
      ],
      theme_color: themeColor,
      background_color: bgColor,
    };

    if (ultimaUrlBlob) URL.revokeObjectURL(ultimaUrlBlob);
    const blob = new Blob([JSON.stringify(manifestDinamico)], { type: "application/manifest+json" });
    ultimaUrlBlob = URL.createObjectURL(blob);
    fijarLinkHead("manifest", ultimaUrlBlob);
    fijarLinkHead("apple-touch-icon", icono192);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", themeColor);
  } catch (err) {
    // Best-effort: si algo falla acá (ej. el logo no cargó a tiempo), la
    // app sigue con el manifest/ícono estático de siempre — esto nunca
    // debe romper el arranque de la app.
    console.warn("No se pudo generar el ícono dinámico de la PWA:", err);
  }
}

/**
 * Se llama UNA vez al arrancar la app. Se espera un frame antes de leer
 * los CSS vars, por si la paleta guardada se termina de aplicar en el
 * mismo ciclo de carga (ver aplicarPaleta en ui/tema.js).
 */
function inicializarIconoDinamico() {
  requestAnimationFrame(() => {
    regenerarIconoDinamico();
  });
}

export { inicializarIconoDinamico, regenerarIconoDinamico };
