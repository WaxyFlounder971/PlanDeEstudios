/* =========================================================================
   COMPONENTES DE UI REUTILIZABLES
   Modales genéricos (confirmación, botón X), toasts, long-press,
   flechas de scroll horizontal, y el layout responsivo del sidebar/drawer.
   ========================================================================= */

import { mostrarSeccion, togglePerfilPopover } from "../main.js";

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
  let origenX = 0;
  let origenY = 0;
  // FIX (2026-08-06 — "el hold también dispara el click de golpe, se
  // buguea"): el navegador SIEMPRE manda un "click" normal justo después
  // del pointerup/touchend, sin importar que el timer del hold ya haya
  // disparado su propio callback antes — agregarLongPress nunca escuchaba
  // ni bloqueaba ese click, así que el listener de "click" que cada
  // elemento ya tenía por su cuenta (ej. expandir la tarjeta) se
  // ejecutaba igual, ENCIMA de lo que el hold acababa de abrir. Esta
  // bandera marca que el hold (o el clic derecho) ya resolvió el gesto,
  // para poder cancelar solo ESE click puntual más abajo.
  let disparadoPorHold = false;
  // Si el dedo se mueve más que esto antes de cumplirse el tiempo, es un
  // scroll o un intento de arrastre normal, no una intención de long-press
  // — se cancela para no disparar el menú por accidente en medio de un scroll.
  const UMBRAL_MOVIMIENTO_PX = 10;

  const cancelar = () => {
    clearTimeout(timer);
    timer = null;
  };

  el.addEventListener("pointerdown", (e) => {
    origenX = e.clientX;
    origenY = e.clientY;
    timer = setTimeout(() => {
      timer = null;
      disparadoPorHold = true;
      callback();
    }, duracionMs);
  });
  el.addEventListener("pointermove", (e) => {
    if (timer === null) return;
    if (Math.abs(e.clientX - origenX) > UMBRAL_MOVIMIENTO_PX || Math.abs(e.clientY - origenY) > UMBRAL_MOVIMIENTO_PX) {
      cancelar();
    }
  });
  el.addEventListener("pointerup", cancelar);
  el.addEventListener("pointerleave", cancelar);
  // FIX (2026-08-05): en touch, cuando el navegador decide que el gesto es
  // un scroll (no una presión quieta), dispara `pointercancel` en vez de
  // `pointerup`/`pointerleave` — sin escuchar esto, el timer seguía vivo y
  // el callback (menú rápido / "Reordenar") podía disparar solo, después,
  // aunque la persona ya se hubiera ido a hacer scroll a otro lado. Esto es
  // casi seguro la causa de que el long-press se sintiera poco confiable
  // en teléfono ("a veces no pasa nada, a veces pasa algo raro").
  el.addEventListener("pointercancel", cancelar);
  el.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    disparadoPorHold = true;
    callback();
  });

  // Se registra en fase de CAPTURA (3er argumento `true`) para llegar
  // antes que cualquier otro listener de "click" que ya exista sobre este
  // mismo elemento (ej. el que expande/colapsa la tarjeta) y poder
  // cancelarlo con stopPropagation antes de que corra. Solo actúa la
  // primera vez después de un hold — el resto de los clics normales
  // (sin hold de por medio) siguen funcionando exactamente igual que
  // siempre.
  el.addEventListener(
    "click",
    (e) => {
      if (!disparadoPorHold) return;
      disparadoPorHold = false;
      e.stopPropagation();
      e.preventDefault();
    },
    true
  );
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
  const modal = document.getElementById("modal-confirmacion");
  // Fix (2026-08-03): este modal vive fijo en el HTML, así que cuando se
  // abre un modal dinámico DESPUÉS (ej. cualquier crearModalDinamico, o el
  // overlay de alta de semestre), ese overlay queda más abajo en el DOM y,
  // con el mismo z-index de ".modal-overlay", gana el empate y tapa a este
  // — la confirmación quedaba atrapada detrás, sin poder tocarla, y la
  // única salida era recargar la página. Reinsertarlo al final de <body>
  // cada vez que se abre lo pone siempre último en el DOM (arriba de
  // cualquier overlay ya abierto) sin depender de tocar su CSS.
  document.body.appendChild(modal);
  modal.style.zIndex = "99999";
  modal.classList.remove("oculto");
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

  // Acceso directo a Enlaces rápidos en móvil (2026-08-07): antes la única
  // forma de llegar era entrando a Ajustes. Este botón vive en la barra
  // superior (no en el drawer), así que no depende de abrir/cerrar el
  // sidebar: cambia a la sección Configuración y hace scroll directo hasta
  // la tarjeta de Enlaces rápidos dentro de ella.
  const btnTopbarEnlaces = document.getElementById("btn-topbar-enlaces");
  if (btnTopbarEnlaces) {
    btnTopbarEnlaces.addEventListener("click", irAEnlacesRapidosMovil);
  }

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

/**
 * Acceso directo a Enlaces rápidos en móvil (2026-08-07): cambia a la
 * sección Configuración (donde vive la tarjeta real de Enlaces rápidos,
 * #seccion-enlaces-rapidos en index.html) y hace scroll suave hasta ella.
 * El requestAnimationFrame es necesario porque mostrarSeccion() recién
 * quita la clase "oculto" de #seccion-configuracion de forma síncrona —
 * sin esperar al siguiente frame, scrollIntoView podía correr sobre un
 * layout que el navegador todavía no terminó de recalcular tras el cambio
 * de display, y el scroll quedaba corto o directamente no hacía nada.
 */
function irAEnlacesRapidosMovil() {
  mostrarSeccion("configuracion");
  requestAnimationFrame(() => {
    const seccion = document.getElementById("seccion-enlaces-rapidos");
    if (seccion) seccion.scrollIntoView({ behavior: "smooth", block: "start" });
  });
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
  irAEnlacesRapidosMovil,
  mostrarToast,
  restaurarEstadoSidebar,
};
