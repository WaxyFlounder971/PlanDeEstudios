/* =========================================================================
   ÍCONO DINÁMICO DE LA PWA (v2 — archivos pre-generados, no canvas/blob)

   v1 generaba el ícono con <canvas> en cada carga y lo servía como
   manifest Blob URL. NO FUNCIONA en Android real: cuando el sitio es
   instalable, Chrome/Samsung Internet le mandan la URL del manifest a un
   servicio (WebAPK) que la fetchea desde SU PROPIO servidor para armar el
   ícono — y una blob: URL solo existe en la memoria del navegador del
   usuario, ese servicio no tiene forma de verla. Confirmado a mano:
   reinstalando en Samsung Internet el ícono no cambiaba nunca.

   v2 en cambio apunta a archivos REALES pre-generados una sola vez con
   generar-iconos-pwa.html (ver ese archivo) y comiteados al repo:
     manifests/manifest-{paleta}-{modo}.json
     imagenes/pwa-iconos/icono-{paleta}-{modo}-192.png
     imagenes/pwa-iconos/icono-{paleta}-{modo}-512.png
   Como son archivos que de verdad existen en el server, el servicio de
   instalación de Android SÍ los puede fetchear.

   LÍMITE ACEPTADO A PROPÓSITO: esto solo cubre las 13 paletas FIJAS (un
   número finito, conocido de antemano). Para "personalizada" (colores
   arbitrarios que arma cada usuario a mano) no hay forma de pre-generar
   nada sin backend — se usa como fallback el ícono de la paleta fija con
   el --accent-1 más parecido (ver paletaFijaMasParecida). Si el usuario
   cambia de paleta DESPUÉS de tener la app instalada, el ícono del home
   screen tampoco se actualiza solo — hace falta reinstalar.
   ========================================================================= */

import { PALETAS_FIJAS_PWA, paletaFijaMasParecida } from "./paletas-fijas-pwa.js";

function leerVarCSS(nombre, fallback) {
  const valor = getComputedStyle(document.documentElement).getPropertyValue(nombre).trim();
  return valor || fallback;
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
 * Decide qué paleta fija le corresponde a la app en este momento:
 *  - si `data-palette` en <html> es una de las 13 fijas, esa misma.
 *  - si no (ej. "personalizada"), la fija con --accent-1 más parecido al
 *    --accent-1 real que está aplicado ahora mismo.
 */
function resolverParPaletaModo() {
  const html = document.documentElement;
  const modo = html.getAttribute("data-mode") === "light" ? "light" : "dark";
  const paletaAtributo = html.getAttribute("data-palette") || "";

  if (paletaAtributo in PALETAS_FIJAS_PWA) {
    return { paleta: paletaAtributo, modo };
  }

  // "personalizada" u otro valor no reconocido: fallback por color.
  const fallbackHex = PALETAS_FIJAS_PWA.azul[modo].accent1;
  const accentActual = leerVarCSS("--accent-1", fallbackHex);
  const paleta = paletaFijaMasParecida(accentActual, modo);
  return { paleta, modo };
}

/**
 * Aplica el manifest + apple-touch-icon + theme-color que correspondan a
 * la paleta activa (o su fallback más parecido). Se llama al arrancar la
 * app y de nuevo cada vez que se guarda una paleta (ver
 * paleta-personalizada.js) para que quede listo por si el usuario
 * reinstala más adelante.
 */
function regenerarIconoDinamico() {
  try {
    const { paleta, modo } = resolverParPaletaModo();
    const datos = PALETAS_FIJAS_PWA[paleta][modo];

    fijarLinkHead("manifest", `manifests/manifest-${paleta}-${modo}.json`);
    fijarLinkHead("apple-touch-icon", `imagenes/pwa-iconos/icono-${paleta}-${modo}-192.png`);

    const metaTheme = document.querySelector('meta[name="theme-color"]');
    if (metaTheme) metaTheme.setAttribute("content", datos.accent1);
  } catch (err) {
    // Best-effort: nunca debe romper el arranque de la app.
    console.warn("No se pudo aplicar el ícono dinámico de la PWA:", err);
  }
}

function inicializarIconoDinamico() {
  requestAnimationFrame(() => {
    regenerarIconoDinamico();
  });
}

export { inicializarIconoDinamico, regenerarIconoDinamico };
