import { estado } from "./storage/storage.js";
import { marcarCambioPendiente } from "./storage/storage-sync.js";
import { sellarTimestamp } from "./schema.js";
import { mostrarToast } from "../ui/componentes.js";
import { espejarColoresIntroLocal } from "./intro-apertura.js";

// Un solo logo (la carpeta). El birrete y el logo subido desde archivo ya no existen: una cuenta que los tenga guardados
// (logo_app = "birrete" / "personalizado", logo_app_url) vuelve a la carpeta, que es lo que se pinta aquí.
const LOGO_BASE = "imagenes/LogoAppFolder-512.png";

// Colores de las seis pestañas del logo original (de arriba abajo). Sirven de referencia para repintar cada pestaña por
// separado en "Colores personalizados" y de valor inicial de las bolitas de Ajustes.
const COLORES_LOGO_ORIGINALES = ["#ce1d19", "#de502b", "#dcb72d", "#2c9b73", "#277ecc", "#7c39d3"];
const ESTILOS_LOGO = ["original", "paleta", "personalizado"];
const esHex = (v) => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
const hexARgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };

function estiloLogo(cfg) {
  return ESTILOS_LOGO.includes(cfg?.estilo_logo) ? cfg.estilo_logo : "paleta";
}
function coloresLogoPersonalizados(cfg) {
  const guardados = cfg?.logo_colores_personalizados;
  return COLORES_LOGO_ORIGINALES.map((base, i) => (Array.isArray(guardados) && esHex(guardados[i]) ? guardados[i].toLowerCase() : base));
}

function colorTema() {
  const valor = getComputedStyle(document.documentElement).getPropertyValue("--accent-1").trim();
  const m = valor.match(/^#([0-9a-f]{6})$/i);
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hsl(r,g,b) {
  r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;let h=0,s=0,l=(max+min)/2;
  if(d){s=d/(1-Math.abs(2*l-1));switch(max){case r:h=((g-b)/d)%6;break;case g:h=(b-r)/d+2;break;default:h=(r-g)/d+4;}h/=6;if(h<0)h+=1;}
  return [h,s,l];
}
function rgbFromHsl(h,s,l) {
  const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h*6)%2-1)),m=l-c/2;let a,b,d;
  if(h<1/6){a=c;b=x;d=0;}else if(h<2/6){a=x;b=c;d=0;}else if(h<3/6){a=0;b=c;d=x;}else if(h<4/6){a=0;b=x;d=c;}else if(h<5/6){a=x;b=0;d=c;}else{a=c;b=0;d=x;}
  return [(a+m)*255,(b+m)*255,(d+m)*255];
}
// Lee el logo (512 px), deja que `transformar` repinte los píxeles y devuelve el logo y una versión chica (64 px) para el favicon.
async function generarLogo(src, transformar) {
  try {
    const res = await fetch(src); const blob = await res.blob();
    const bmp = typeof createImageBitmap === "function" ? await createImageBitmap(blob) : await new Promise((resolve, reject) => { const img = new Image(); const temp = URL.createObjectURL(blob); img.onload = () => { URL.revokeObjectURL(temp); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(temp); reject(new Error("No se pudo leer el logo")); }; img.src = temp; });
    const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height)); const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(bmp.width * scale)); canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height); bmp.close?.();
    const pix = ctx.getImageData(0, 0, canvas.width, canvas.height);
    transformar(pix.data);
    ctx.putImageData(pix, 0, 0);
    const logo = canvas.toDataURL("image/png");
    // Favicon: un data URL de 512 px es enorme y algunos navegadores lo ignoran; 64 px pesa muy poco.
    const k = 64 / Math.max(canvas.width, canvas.height); const chico = document.createElement("canvas"); chico.width = Math.max(1, Math.round(canvas.width * k)); chico.height = Math.max(1, Math.round(canvas.height * k));
    chico.getContext("2d").drawImage(canvas, 0, 0, chico.width, chico.height);
    return { logo, icono: chico.toDataURL("image/png") };
  } catch (_) { return null; /* Conserva el logo original si el navegador no permite procesarlo. */ }
}

// "Según la paleta": todo lo coloreado del logo toma el tono del acento.
function generarLogoColoreado(src, acento) {
  const [ah, as, al] = hsl(...acento);
  return generarLogo(src, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] / 255 < .15) continue;
      const [, ss, sl] = hsl(d[i], d[i + 1], d[i + 2]);
      if (ss > .24 && sl > .2 && sl < .88) {
        const tone = Math.max(.22, Math.min(.78, al + (sl - .5) * .52));
        const [r, g, b] = rgbFromHsl(ah, Math.min(.9, Math.max(.55, as)), tone);
        d[i] = r; d[i + 1] = g; d[i + 2] = b;
      }
    }
  });
}

// "Colores personalizados": cada pestaña se reconoce por su tono original (rojo, naranja, amarillo, verde, azul, morado)
// y se repinta con el color que eligió la persona, conservando el sombreado de los bordes.
const REFERENCIAS_PESTANAS = COLORES_LOGO_ORIGINALES.map((hex) => hsl(...hexARgb(hex)));
function generarLogoPersonalizado(src, colores) {
  const destinos = colores.map((hex) => hsl(...hexARgb(hex)));
  return generarLogo(src, (d) => {
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] / 255 < .15) continue;
      const [sh, ss, sl] = hsl(d[i], d[i + 1], d[i + 2]);
      if (!(ss > .24 && sl > .2 && sl < .88)) continue;
      let mejor = 0, distMin = 9;
      REFERENCIAS_PESTANAS.forEach(([rh], k) => { const dist = Math.min(Math.abs(sh - rh), 1 - Math.abs(sh - rh)); if (dist < distMin) { distMin = dist; mejor = k; } });
      const [th, ts, tl] = destinos[mejor];
      const tone = Math.max(.04, Math.min(.96, tl + (sl - REFERENCIAS_PESTANAS[mejor][2])));
      const [r, g, b] = rgbFromHsl(th, ts, tone);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  });
}

// Sin parpadeo: cada combinación (estilo + colores) se procesa UNA sola vez y se guarda; si ya está lista se aplica al instante,
// y mientras se procesa una nueva no se vuelve al logo original (se deja el que ya se ve y se cambia cuando está listo).
const cacheLogoColor = new Map();   // clave -> { logo, icono }
const logoEnProceso = new Map();    // clave -> Promise
let cicloColorLogo = 0, estiloAplicado = null;

function pintarLogo(logoSrc, iconoSrc) {
  document.querySelectorAll("img[data-app-logo]").forEach((img) => { if (img.getAttribute("src") !== logoSrc) img.src = logoSrc; });
  const fav = document.querySelector("link[data-app-favicon]");
  if (fav && fav.getAttribute("href") !== iconoSrc) fav.setAttribute("href", iconoSrc);
}

// Los iconos del menú en "Color según logo" leen --logo-1…--logo-6 (ver "Parche 10" en design-system.css). Solo con
// "Colores personalizados" se escriben aquí; en cualquier otro caso se quitan y valen los colores del logo original
// (también con "Según la paleta": ese logo ya sigue a la paleta, así que los iconos usan los originales).
function aplicarColoresLogoAIconos(colores) {
  const raiz = document.documentElement.style;
  COLORES_LOGO_ORIGINALES.forEach((_, i) => {
    if (colores) raiz.setProperty(`--logo-${i + 1}`, colores[i]);
    else raiz.removeProperty(`--logo-${i + 1}`);
  });
}

function aplicarLogoApp() {
  const cfg = estado.datos?.configuracion;
  if (!cfg) return;
  const src = LOGO_BASE;
  const estilo = estiloLogo(cfg);
  const colores = estilo === "personalizado" ? coloresLogoPersonalizados(cfg) : null;
  aplicarColoresLogoAIconos(colores);
  // La animación de apertura usa los colores del logo; se espejan en local porque al arrancar aún no hay datos de la cuenta.
  espejarColoresIntroLocal(estilo === "original" ? null : { modo: estilo, colores: colores || undefined });
  const ciclo = ++cicloColorLogo;
  // Colores originales (o paleta sin color hexadecimal simple, p. ej. degradados): logo tal cual.
  const acento = estilo === "paleta" ? colorTema() : null;
  if (estilo === "original" || (estilo === "paleta" && !acento)) { pintarLogo(src, src); estiloAplicado = estilo; return; }
  const clave = estilo === "personalizado" ? `${src}|p|${colores.join(",")}` : `${src}|t|${acento.join(",")}`;
  const listo = cacheLogoColor.get(clave);
  if (listo) { pintarLogo(listo.logo, listo.icono); estiloAplicado = estilo; return; }
  // Cambio de estilo: se muestra el original mientras se colorea. Mismo estilo, otro color: se deja el actual hasta tener el nuevo.
  if (estiloAplicado !== estilo) { pintarLogo(src, src); estiloAplicado = estilo; }
  let proceso = logoEnProceso.get(clave);
  if (!proceso) {
    proceso = (estilo === "personalizado" ? generarLogoPersonalizado(src, colores) : generarLogoColoreado(src, acento)).then((r) => {
      logoEnProceso.delete(clave);
      if (r) { cacheLogoColor.set(clave, r); if (cacheLogoColor.size > 8) cacheLogoColor.delete(cacheLogoColor.keys().next().value); }
      return r;
    });
    logoEnProceso.set(clave, proceso);
  }
  proceso.then((r) => { if (r && ciclo === cicloColorLogo) pintarLogo(r.logo, r.icono); });
}

// Se queda para el onboarding (hoy apagado con PERMITIR_LOGO_ONBOARDING): leer una imagen elegida y reducirla a 512 px.
async function prepararImagenLogo(archivo) {
  if (!archivo || !/^LogoApp/i.test(archivo.name) || !/^image\/(png|jpeg|webp)$/.test(archivo.type) || archivo.size > 8 * 1024 * 1024) {
    mostrarToast("Elige desde Descargas un archivo llamado LogoApp… en PNG, JPG o WebP (máximo 8 MB).");
    return null;
  }
  const url = URL.createObjectURL(archivo);
  try {
    const imagen = typeof createImageBitmap === "function"
      ? await createImageBitmap(archivo)
      : await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = reject; img.src = url; });
    const escala = Math.min(1, 512 / Math.max(imagen.width, imagen.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(imagen.width * escala));
    canvas.height = Math.max(1, Math.round(imagen.height * escala));
    canvas.getContext("2d").drawImage(imagen, 0, 0, canvas.width, canvas.height);
    imagen.close?.();
    return canvas.toDataURL("image/webp", 0.86);
  } catch (_) {
    mostrarToast("No pude leer ese logo. Prueba con otro PNG, JPG o WebP.");
    return null;
  } finally { URL.revokeObjectURL(url); }
}

// Ajustes > Personalizar > "Personalizar logo": Colores originales / Colores de la paleta / Colores personalizados (6 bolitas).
// Se llama en cada renderizarAjustes(): repinta el estado y registra los eventos una sola vez.
function inicializarSelectorLogo() {
  const cont = document.getElementById("ajuste-logo-app");
  if (!cont || !estado.datos?.configuracion) return;
  const botones = Array.from(cont.querySelectorAll("[data-estilo-logo]"));
  const bloque = document.getElementById("logo-colores-bloque");
  const bolitas = Array.from(cont.querySelectorAll("input[data-logo-color]"));
  const btnRestablecer = document.getElementById("btn-logo-colores-original");
  if (!bloque || bolitas.length !== 6) return;

  const configuracionActual = () => estado.datos?.configuracion;
  const guardarEnCuenta = () => {
    const cfg = configuracionActual();
    if (!cfg) return;
    sellarTimestamp(cfg);
    marcarCambioPendiente();
  };
  const pintar = () => {
    const cfg = configuracionActual();
    if (!cfg) return;
    const estilo = estiloLogo(cfg);
    botones.forEach((b) => b.classList.toggle("active", b.dataset.estiloLogo === estilo));
    bloque.classList.toggle("oculto", estilo !== "personalizado");
    const colores = coloresLogoPersonalizados(cfg);
    bolitas.forEach((el, i) => {
      if (document.activeElement !== el) el.value = colores[i];
      el.parentElement.style.background = colores[i];
    });
  };
  pintar();
  if (cont.dataset.inicializado) return;
  cont.dataset.inicializado = "1";

  botones.forEach((btn) => btn.addEventListener("click", () => {
    if (!ESTILOS_LOGO.includes(btn.dataset.estiloLogo)) return;
    const cfg = configuracionActual();
    if (!cfg) return;
    cfg.estilo_logo = btn.dataset.estiloLogo;
    guardarEnCuenta(); pintar(); aplicarLogoApp();
  }));
  bolitas.forEach((el) => {
    // Mientras se arrastra el selector solo se repinta en pantalla; a la cuenta se sube al soltar.
    el.addEventListener("input", () => {
      const cfg = configuracionActual();
      if (!cfg) return;
      cfg.logo_colores_personalizados = bolitas.map((b) => b.value);
      cfg.estilo_logo = "personalizado";
      el.parentElement.style.background = el.value;
      aplicarLogoApp();
    });
    el.addEventListener("change", () => { guardarEnCuenta(); pintar(); });
  });
  btnRestablecer?.addEventListener("click", () => {
    const cfg = configuracionActual();
    if (!cfg) return;
    cfg.logo_colores_personalizados = COLORES_LOGO_ORIGINALES.slice();
    // Volver al archivo original exacto, no a una versión recoloreada aproximada.
    cfg.estilo_logo = "original";
    guardarEnCuenta(); pintar(); aplicarLogoApp();
  });
}

window.aplicarLogoApp = aplicarLogoApp;
export { aplicarLogoApp, inicializarSelectorLogo, prepararImagenLogo, COLORES_LOGO_ORIGINALES };

// Ajustes > Personalizar iconos: vista previa. Copia los iconos de las secciones visibles del menú (mismo orden) y el
// CSS los pinta según el estilo elegido (html[data-iconos-nav]), así que cambia al instante al tocar una opción.
function pintarVistaIconosNav() {
  const cont = document.getElementById("iconos-nav-vista");
  if (!cont) return;
  cont.replaceChildren();
  document.querySelectorAll("#app-sidebar .btn-nav:not(.oculto)").forEach((btn) => {
    const svg = btn.querySelector("svg");
    if (!svg || !btn.dataset.seccion) return;
    const caja = document.createElement("span");
    caja.className = "ajuste-icono-vista";
    caja.dataset.seccion = btn.dataset.seccion;
    caja.appendChild(svg.cloneNode(true));
    cont.appendChild(caja);
  });
}
(function iniciarVistaIconosNav() {
  const arrancar = () => {
    pintarVistaIconosNav();
    const barra = document.getElementById("app-sidebar");
    if (!barra) return;
    let pendiente = false;
    new MutationObserver(() => {
      if (pendiente) return;
      pendiente = true;
      requestAnimationFrame(() => { pendiente = false; pintarVistaIconosNav(); });
    }).observe(barra, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar); else arrancar();
})();
