/* =========================================================================
   COMPONENTES DE UI REUTILIZABLES
   Modales genéricos (confirmación, botón X), toasts, long-press,
   flechas de scroll horizontal, y el layout responsivo del sidebar/drawer.
   ========================================================================= */

import { togglePerfilPopover } from "../main.js";

const CLAVE_SIDEBAR_COLAPSADA = "sidebar_colapsada";

/**
 * Helper reutilizable: ejecuta `callback` cuando el elemento se mantiene
 * presionado (~500ms) o se hace clic derecho sobre él. Usado por el
 * indicador de sync (Ajuste 1) y por el badge de categoría de una materia
 * individual (Ajuste 7).
 */

function agregarLongPress(el, callback, duracionMs = 500) {
  if (!el) return;
  let timer = null;
  el.addEventListener("pointerdown", () => {
    timer = setTimeout(callback, duracionMs);
  });
  el.addEventListener("pointerup", () => clearTimeout(timer));
  el.addEventListener("pointerleave", () => clearTimeout(timer));
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    callback();
  });
}

/* ===================== Confirmación genérica (reemplaza confirm() nativo) ===================== */

let callbackConfirmacionActual = null;

/**
 * Abre el modal de confirmación reutilizable. Uso:
 *   abrirConfirmacion({ titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar })
 * `claseConfirmar` es opcional (por defecto "btn-danger"; usa "btn-primary"
 * para acciones no destructivas).
 */

function abrirConfirmacion({ titulo, mensaje, textoConfirmar, claseConfirmar, onConfirmar }) {
  document.getElementById("titulo-modal-confirmacion").textContent = titulo || "¿Estás seguro?";
  document.getElementById("mensaje-modal-confirmacion").textContent = mensaje || "";
  const btn = document.getElementById("btn-aceptar-confirmacion");
  btn.textContent = textoConfirmar || "Confirmar";
  btn.className = "btn " + (claseConfirmar || "btn-danger");
  callbackConfirmacionActual = onConfirmar || null;
  document.getElementById("modal-confirmacion").classList.remove("oculto");
}

function cerrarConfirmacion() {
  document.getElementById("modal-confirmacion").classList.add("oculto");
  callbackConfirmacionActual = null;
}

function inicializarModalConfirmacion() {
  const modal = document.getElementById("modal-confirmacion");
  document.getElementById("btn-cancelar-confirmacion").addEventListener("click", cerrarConfirmacion);
  document.getElementById("btn-aceptar-confirmacion").addEventListener("click", () => {
    const cb = callbackConfirmacionActual;
    cerrarConfirmacion();
    if (cb) cb();
  });
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarConfirmacion();
  });
}

/* ===================== Layout responsivo (puntos 1 y 5) ===================== */

function inicializarLayoutResponsivo() {
  const sidebar = document.getElementById("app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btnHamburguesa = document.getElementById("btn-hamburguesa");
  const btnColapsar = document.getElementById("btn-colapsar-sidebar");

  btnHamburguesa.addEventListener("click", () => {
    sidebar.classList.add("abierta");
    overlay.classList.add("abierta");
    // C.6 (v9): con el drawer abierto en móvil, se bloquea el scroll de la
    // página de fondo — sin esto, aunque el drawer en sí queda con
    // `position: fixed` (anclado a la pantalla), la página detrás se sigue
    // pudiendo desplazar con el dedo, lo cual en la práctica se siente como
    // que "todo se mueve" y rompe la sensación de panel anclado, igual que
    // pasa con el panel de Enlaces Rápidos.
    document.body.classList.add("scroll-bloqueado");
  });

  overlay.addEventListener("click", cerrarSidebarMovil);

  // Cerrar el drawer móvil al usar cualquier botón de navegación/config.
  sidebar.addEventListener("click", (e) => {
    if (window.innerWidth < 900 && e.target.closest(".btn-nav")) {
      cerrarSidebarMovil();
    }
  });

  btnColapsar.addEventListener("click", () => {
    const colapsada = sidebar.classList.toggle("colapsada");
    localStorage.setItem(CLAVE_SIDEBAR_COLAPSADA, colapsada ? "1" : "0");
    togglePerfilPopover(true);
  });

  window.addEventListener("resize", () => {
    if (window.innerWidth >= 900) cerrarSidebarMovil();
  });
}

function cerrarSidebarMovil() {
  document.getElementById("app-sidebar").classList.remove("abierta");
  document.getElementById("sidebar-overlay").classList.remove("abierta");
  document.body.classList.remove("scroll-bloqueado");
}

function restaurarEstadoSidebar() {
  const colapsada = localStorage.getItem(CLAVE_SIDEBAR_COLAPSADA) === "1";
  document.getElementById("app-sidebar").classList.toggle("colapsada", colapsada);
}

/* ===================== Botón "X" propio en todos los modales (v5 #2) ===================== */

/**
 * Algunos modales tienen lógica extra al cerrarse (ej. limpiar un CSV en
 * espera). Para no duplicar esa lógica, el botón X simplemente dispara un
 * click sintético sobre el propio overlay del modal — reutilizando los
 * listeners de "clic afuera cierra" que cada modal ya tiene registrados
 * (todos comparan `e.target === modal`/`e.target.id === "..."`).
 */

function inicializarBotonesCerrarModal() {
  document.querySelectorAll(".modal-overlay").forEach((overlay) => {
    // v8 punto 2 / B (v9): #modal-requisito ya trae su propio botón "Cerrar"
    // agrupado al final del bloque de detalle — el "X" de la esquina se
    // elimina ahí para no duplicar la acción.
    if (overlay.id === "modal-requisito") return;
    const card = overlay.querySelector(".modal-card");
    if (!card || card.querySelector(".modal-x-close")) return;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "modal-x-close";
    btn.setAttribute("aria-label", "Cerrar");
    btn.textContent = "✕";
    btn.addEventListener("click", () => {
      overlay.classList.add("oculto");
      overlay.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    card.prepend(btn);
  });
}

/** Toast breve reutilizable (ej. "✓ Prompt copiado en el portapapeles", v5 #1.3). */

function mostrarToast(mensaje) {
  document.querySelectorAll(".toast-app").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.className = "toast-app";
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2400);
}

/* ===================== Flechas de scroll horizontal reutilizables ===================== */

/**
 * Bug 3 (v8): envuelve `elementoScroll` (cualquier contenedor con
 * `overflow-x` scrolleable, ej. un .pill-group) con flechitas "‹ ›" de solo
 * símbolo (mismo estilo que la navegación entre Planes de Estudio), que
 * solo se muestran cuando el contenido realmente desborda el ancho
 * disponible, y se ocultan solas al llegar a cada extremo. Se reutiliza
 * también en Ajuste 3 (scroll horizontal del mapa curricular).
 */

function envolverConFlechasScroll(elementoScroll) {
  const wrapper = document.createElement("div");
  wrapper.className = "scroll-con-flechas";
  elementoScroll.parentNode.insertBefore(wrapper, elementoScroll);

  // B.2 (v9): en vez de un scrollBy() de distancia fija (que dejaba el
  // siguiente elemento a medio mostrar), se calcula cuál es el próximo
  // elemento realmente oculto en esa dirección y se desliza hasta que
  // quede completamente visible (scrollIntoView), nunca a medias.
  const crearFlecha = (simbolo, direccion, etiqueta) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flecha-plan flecha-scroll";
    btn.textContent = simbolo;
    btn.setAttribute("aria-label", etiqueta);
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const hijos = Array.from(elementoScroll.children);
      if (hijos.length === 0) return;
      const scrollActual = elementoScroll.scrollLeft;
      const anchoVisible = elementoScroll.clientWidth;
      if (direccion > 0) {
        const objetivo = hijos.find((h) => h.offsetLeft + h.offsetWidth > scrollActual + anchoVisible + 1);
        if (objetivo) objetivo.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
      } else {
        const objetivo = hijos.slice().reverse().find((h) => h.offsetLeft < scrollActual - 1);
        if (objetivo) objetivo.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }
    });
    return btn;
  };
  const btnPrev = crearFlecha("‹", -1, "Desplazar hacia la izquierda");
  const btnNext = crearFlecha("›", 1, "Desplazar hacia la derecha");

  wrapper.appendChild(btnPrev);
  wrapper.appendChild(elementoScroll);
  wrapper.appendChild(btnNext);

  const actualizarFlechas = () => {
    const desborda = elementoScroll.scrollWidth > elementoScroll.clientWidth + 1;
    btnPrev.classList.toggle("oculto", !desborda || elementoScroll.scrollLeft <= 1);
    btnNext.classList.toggle(
      "oculto",
      !desborda || elementoScroll.scrollLeft + elementoScroll.clientWidth >= elementoScroll.scrollWidth - 1
    );
  };
  elementoScroll.addEventListener("scroll", actualizarFlechas);
  // ResizeObserver (no un listener en window) para que, si esta tarjeta se
  // vuelve a renderizar y se descarta, el observer no siga acumulándose
  // indefinidamente: al perder toda referencia al nodo desconectado, tanto
  // el observer como su callback quedan libres para recolectarse.
  if (window.ResizeObserver) {
    new ResizeObserver(actualizarFlechas).observe(elementoScroll);
  }
  requestAnimationFrame(actualizarFlechas);

  return wrapper;
}

export {
  CLAVE_SIDEBAR_COLAPSADA,
  abrirConfirmacion,
  agregarLongPress,
  callbackConfirmacionActual,
  cerrarConfirmacion,
  cerrarSidebarMovil,
  envolverConFlechasScroll,
  inicializarBotonesCerrarModal,
  inicializarLayoutResponsivo,
  inicializarModalConfirmacion,
  mostrarToast,
  restaurarEstadoSidebar,
};
