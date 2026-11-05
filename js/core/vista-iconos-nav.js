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

const RE_REGLA_ICONO = /--ni-|nav-ico|\.ni-/;

function adaptar(texto) {
  return texto.replace(/#app-sidebar\s+\.btn-nav/g, ".pm-icono").replace(/#app-sidebar/g, ".pm-iconos");
}

function copiarReglas(reglas, envolver, salida) {
  for (const r of reglas) {
    if (r.cssRules && (r.media || r.conditionText !== undefined) && !r.selectorText) {
      const cond = r.media ? `@media ${r.media.mediaText}` : `@supports ${r.conditionText}`;
      copiarReglas(r.cssRules, (t) => envolver(`${cond} { ${t} }`), salida);
      continue;
    }
    if (!r.selectorText || !r.selectorText.includes("#app-sidebar") || !RE_REGLA_ICONO.test(r.cssText)) continue;
    salida.push(envolver(adaptar(r.cssText)));
  }
}

function inyectarReglasVista() {
  if (document.getElementById("estilo-pm-iconos")) return;
  const salida = [];
  for (const hoja of Array.from(document.styleSheets)) {
    try { copiarReglas(hoja.cssRules, (t) => t, salida); } catch (e) { /* hoja de otro origen: no se puede leer */ }
  }
  const estilo = document.createElement("style");
  estilo.id = "estilo-pm-iconos";
  estilo.textContent = salida.join("\n");
  document.head.appendChild(estilo);
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
  inyectarReglasVista();
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
  // Logos que se montan después (onboarding, etc.) o cuyo src cambia.
  new MutationObserver(reprogramar).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", arrancar);
else arrancar();
