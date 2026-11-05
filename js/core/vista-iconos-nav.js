/* =========================================================================
   Ajustes > Personalizar iconos: vista previa de los iconos del menú, y logo siempre al día.

   1) Vista previa (#pm-iconos-vista): copia los iconos de las secciones visibles del menú lateral (mismo orden).
      Los iconos se pintan con reglas CSS que cuelgan de "#app-sidebar .btn-nav" (variables --ni-*, clases ni-s1/ni-d1…);
      fuera del menú no se aplican y salían como sombras negras. Aquí se copian esas mismas reglas cambiando
      "#app-sidebar .btn-nav" por ".pm-icono" y "#app-sidebar" por ".pm-iconos", así la vista previa sigue sola
      cualquier cambio futuro del estilo del menú (Multicolor / según logo / según paleta, claro / oscuro).

   2) Logo: marca.js pinta todos los <img data-app-logo> al aplicar el logo. Aquí se vigila que los que aparecen
      después (onboarding, menú, pantallas que se montan tarde) tengan el mismo logo que ya se ve en Ajustes.
   ========================================================================= */

// Copiar las variables ya calculadas del botón real hace que la muestra coincida con el menú
// incluso cuando cambian la paleta, el modo claro/oscuro o el estilo de color de los iconos.
const PROPIEDADES_COLOR_ICONO = ["--ni-a", "--ni-b", "--ni-k", "--ni-logo", "--nav-c1", "--nav-c2", "--nav-wall", "--nav-wallst", "--nav-base", "--nav-door"];

function copiarColoresCalculados(origen, destino) {
  const estilos = getComputedStyle(origen);
  destino.style.color = estilos.color;
  PROPIEDADES_COLOR_ICONO.forEach((propiedad) => {
    const valor = estilos.getPropertyValue(propiedad).trim();
    if (valor) destino.style.setProperty(propiedad, valor);
  });
}

function pintarVistaIconos() {
  const cont = document.getElementById("pm-iconos-vista");
  if (!cont) return;
  const nuevos = [];
  document.querySelectorAll("#app-sidebar .btn-nav:not(.oculto)").forEach((btn) => {
    const svg = btn.querySelector("svg");
    if (!svg || !btn.dataset.seccion) return;
    const caja = document.createElement("span");
    caja.className = "pm-icono";
    caja.dataset.seccion = btn.dataset.seccion;
    copiarColoresCalculados(btn, caja);
    caja.appendChild(svg.cloneNode(true));
    nuevos.push(caja);
  });
  cont.replaceChildren(...nuevos);
}

function sincronizarLogos() {
  const ref = document.querySelector("img.ajuste-logo-vista[data-app-logo]");
  const src = ref && ref.getAttribute("src");
  if (!src) return;
  document.querySelectorAll("img[data-app-logo]").forEach((img) => {
    if (img.getAttribute("src") !== src) img.setAttribute("src", src);
  });
}

function arrancar() {
  pintarVistaIconos();
  sincronizarLogos();
  let pendiente = false;
  const reprogramar = () => {
    if (pendiente) return;
    pendiente = true;
    requestAnimationFrame(() => { pendiente = false; pintarVistaIconos(); sincronizarLogos(); });
  };
  const barra = document.getElementById("app-sidebar");
  if (barra) new MutationObserver(reprogramar).observe(barra, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
  new MutationObserver(reprogramar).observe(document.documentElement, { attributes: true, attributeFilter: ["data-iconos-nav", "data-mode", "style"] });
  // Logos que se montan después (onboarding, etc.) o cuyo src cambia.
  new MutationObserver(reprogramar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
else arrancar();
