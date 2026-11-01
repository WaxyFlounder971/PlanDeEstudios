/* =========================================================================
   FINANZAS 2.0 — Selector desplegable propio (etapa 0B)
   Mismo patrón visual que Ajustes y Profesores (.select-custom): botón +
   lista reparentada a <body> para que ningún modal la recorte. Antes este
   bloque (~100 líneas) estaba copiado dentro del formulario de gastos; ahora
   se reutiliza para Semestre, Meta y "Pagar con".
   Recibe los textos YA traducidos: los nombres de semestres y metas son
   datos de la persona, no claves de idioma.
   ========================================================================= */

/**
 * @param {{opciones: {valor: string, texto: string}[], valorInicial?: string, onCambiar?: (valor: string) => void}} cfg
 * @returns {{elemento: HTMLElement, obtenerValor: () => string}}
 */
function construirSelectorFinanzas({ opciones, valorInicial = "", onCambiar = () => {} }) {
  let valor = opciones.some((o) => o.valor === valorInicial) ? valorInicial : opciones.length ? opciones[0].valor : "";
  const textoDe = (v) => (opciones.find((o) => o.valor === v) || { texto: "" }).texto;

  const elemento = document.createElement("div");
  elemento.className = "select-custom";

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-input select-custom-boton";
  boton.setAttribute("aria-expanded", "false");
  boton.textContent = textoDe(valor);

  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";

  function posicionar() {
    const r = boton.getBoundingClientRect();
    lista.style.position = "fixed";
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
  }

  function cerrar() {
    lista.classList.add("oculto");
    boton.setAttribute("aria-expanded", "false");
    if (lista.parentElement === document.body) {
      if (elemento.isConnected) elemento.appendChild(lista);
      else lista.remove(); // el modal ya se cerró: no dejar la lista huérfana en <body>
    }
    window.removeEventListener("scroll", alScrollExterno, true);
    window.removeEventListener("resize", cerrar);
  }

  function alScrollExterno(e) {
    if (lista.contains(e.target)) return;
    cerrar();
  }

  function abrir() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== lista) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    lista._volverA = elemento;
    document.body.appendChild(lista);
    posicionar();
    lista.classList.remove("oculto");
    boton.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", alScrollExterno, true);
    window.addEventListener("resize", cerrar);
  }

  opciones.forEach((opcion) => {
    const item = document.createElement("li");
    item.className = "select-custom-opcion" + (opcion.valor === valor ? " activa" : "");
    item.textContent = opcion.texto;
    item.addEventListener("click", () => {
      const cambio = opcion.valor !== valor;
      valor = opcion.valor;
      boton.textContent = opcion.texto;
      lista.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
      item.classList.add("activa");
      cerrar();
      if (cambio) onCambiar(valor);
    });
    lista.appendChild(item);
  });

  boton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lista.classList.contains("oculto")) abrir();
    else cerrar();
  });

  // Fase de captura: los modales hacen stopPropagation en su caja, y sin esto
  // un toque dentro del modal (fuera del selector) nunca cerraría la lista.
  const alClicFuera = (e) => {
    if (!elemento.isConnected) {
      document.removeEventListener("click", alClicFuera, true);
      lista.remove();
      return;
    }
    if (!elemento.contains(e.target) && !lista.contains(e.target)) cerrar();
  };
  document.addEventListener("click", alClicFuera, true);

  elemento.append(boton, lista);
  return { elemento, obtenerValor: () => valor };
}

export { construirSelectorFinanzas };
