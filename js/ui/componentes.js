/* =========================================================================
   COMPONENTES DE UI REUTILIZABLES
   Modales genéricos (confirmación, botón X), toasts, long-press,
   flechas de scroll horizontal, y el layout responsivo del sidebar/drawer.
   ========================================================================= */

import { togglePerfilPopover } from "../main.js";
import { MODALIDADES_HORARIO, crearModalidadHorario } from "../core/schema.js";

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

  // Acceso directo a Enlaces rápidos en móvil (2026-08-07): drawer propio,
  // independiente del sidebar principal, que se desliza desde la derecha.
  // A propósito NO navega a la sección Configuración — así el usuario no
  // pierde la pantalla en la que estaba (ej. a mitad de una tarjeta de
  // Semestres) solo por querer abrir un enlace.
  const btnTopbarEnlaces = document.getElementById("btn-topbar-enlaces");
  const drawerEnlaces = document.getElementById("drawer-enlaces-movil");
  const overlayEnlaces = document.getElementById("enlaces-movil-overlay");
  const btnCerrarDrawerEnlaces = document.getElementById("btn-cerrar-drawer-enlaces");
  if (btnTopbarEnlaces) {
    btnTopbarEnlaces.addEventListener("click", abrirDrawerEnlacesMovil);
  }
  if (overlayEnlaces) {
    overlayEnlaces.addEventListener("click", cerrarDrawerEnlacesMovil);
  }
  if (btnCerrarDrawerEnlaces) {
    btnCerrarDrawerEnlaces.addEventListener("click", cerrarDrawerEnlacesMovil);
  }
  // Cerrar el drawer de Enlaces al tocar cualquier enlace de la lista
  // (mismo criterio que el sidebar principal: navegar cierra el panel).
  if (drawerEnlaces) {
    drawerEnlaces.addEventListener("click", (e) => {
      if (e.target.closest("a")) cerrarDrawerEnlacesMovil();
    });
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
    if (window.innerWidth >= 900) {
      cerrarSidebarMovil();
      cerrarDrawerEnlacesMovil();
    }
  });
}

function cerrarSidebarMovil() {
  document.getElementById("app-sidebar").classList.remove("abierta");
  document.getElementById("sidebar-overlay").classList.remove("abierta");
  document.body.classList.remove("scroll-bloqueado");
}

/**
 * Drawer de Enlaces rápidos en móvil (2026-08-07): mismo mecanismo que el
 * sidebar principal (clase "abierta" + overlay propio + scroll bloqueado
 * de fondo), pero con su propio overlay (#enlaces-movil-overlay) para que
 * abrir uno nunca interfiera con el estado del otro.
 */
function abrirDrawerEnlacesMovil() {
  document.getElementById("drawer-enlaces-movil").classList.add("abierta");
  document.getElementById("enlaces-movil-overlay").classList.add("abierta");
  document.body.classList.add("scroll-bloqueado");
}

function cerrarDrawerEnlacesMovil() {
  document.getElementById("drawer-enlaces-movil").classList.remove("abierta");
  document.getElementById("enlaces-movil-overlay").classList.remove("abierta");
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

/**
 * v2.8.9: segundo parámetro opcional de duración — el toast por defecto
 * (2400ms) es corto a propósito para avisos rápidos, pero el flujo de
 * "copiar prompt de Beneficios y enviar a Claude" (ver finanzas-gastos.js)
 * necesita que el mensaje quede visible los 3 segundos completos antes de
 * redirigir, así que ese caso pasa su propia duración. Nadie más pasa el
 * segundo argumento, así que ningún toast existente cambia de comportamiento.
 */
function mostrarToast(mensaje, duracionMs = 2400) {
  document.querySelectorAll(".toast-app").forEach((el) => el.remove());
  const toast = document.createElement("div");
  toast.className = "toast-app";
  toast.textContent = mensaje;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), duracionMs);
}

/**
 * PWA (2026-08-15): variante de mostrarToast() que NO se autodestruye —
 * queda fija en pantalla hasta que el usuario decide algo, con un botón de
 * acción y un cierre discreto (✕) para descartarla sin actuar. Mismo
 * lenguaje visual que .toast-app (misma esquina, mismo estilo de "pill"),
 * pero con su propia clase (.toast-app-accion) porque .toast-app trae una
 * animación CSS que la desvanece sola a los 2.4s pase lo que pase —
 * incompatible con algo que necesita quedarse hasta que el usuario le dé
 * al botón. Pensado hoy para el aviso de "hay una actualización
 * disponible" (ver main.js), pero queda genérico por si algún otro flujo
 * futuro necesita el mismo patrón de "aviso persistente + una acción".
 */
function mostrarToastAccion(mensaje, textoBoton, alConfirmar) {
  document.querySelectorAll(".toast-app-accion").forEach((el) => el.remove());

  const toast = document.createElement("div");
  toast.className = "toast-app-accion";

  const texto = document.createElement("span");
  texto.textContent = mensaje;

  const btnAccion = document.createElement("button");
  btnAccion.type = "button";
  btnAccion.className = "btn btn-primary";
  btnAccion.textContent = textoBoton;
  btnAccion.addEventListener("click", () => {
    toast.remove();
    alConfirmar();
  });

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.className = "toast-app-accion-cerrar";
  btnCerrar.setAttribute("aria-label", "Cerrar aviso");
  btnCerrar.textContent = "✕";
  btnCerrar.addEventListener("click", () => toast.remove());

  toast.append(texto, btnAccion, btnCerrar);
  document.body.appendChild(toast);
  return toast;
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

/* ===================== Navegación cruzada: scroll + destello ===================== */

/**
 * Helper reutilizable para "ir a X desde otra sección" (ej. Comunidad →
 * tarjeta de un semestre en Semestres): hace scroll suave hasta el
 * elemento que matchea `selector` y le agrega un destello breve de color
 * de acento para que sea fácil de ubicar en pantalla, sin depender de qué
 * tipo de entidad sea ni de dónde se dispare la navegación.
 *
 * Como el destino típicamente recién se pintó (mostrarSeccion + un
 * render de golpe antes de llamar a esto), el elemento puede no existir
 * todavía en el primer frame — reintenta unos cuantos frames antes de
 * rendirse en silencio (nunca revienta si el elemento nunca aparece, ej.
 * un id que ya no existe).
 */
function desplazarYResaltarElemento(selector, intentosRestantes = 15) {
  const el = document.querySelector(selector);
  if (!el) {
    if (intentosRestantes > 0) {
      requestAnimationFrame(() => desplazarYResaltarElemento(selector, intentosRestantes - 1));
    }
    return;
  }
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  // Se remueve la clase antes de re-agregarla, por si el usuario navega
  // dos veces seguidas al mismo elemento: sin este reset la animación no
  // se reinicia (CSS ignora agregar una clase que ya está puesta).
  el.classList.remove("destello-resaltado");
  // Fuerza un reflow entre quitar y volver a poner la clase — mismo truco
  // que se necesita en cualquier re-disparo de animación CSS por clase.
  void el.offsetWidth;
  el.classList.add("destello-resaltado");
  setTimeout(() => el.classList.remove("destello-resaltado"), 1600);
}

/* ===================== Botones "atrás"/"adelante" del mouse (4 y 5) ===================== */

// Misma clave de localStorage que CLAVE_SECCION_ACTIVA en main.js. No se
// importa directo de ahí (evitaría un import circular real: main.js ya
// importa este archivo) — es solo el nombre de la llave, no lógica, así
// que duplicar el string puntual es más seguro que forzar una dependencia
// nueva solo para esto.
const CLAVE_SECCION_ACTIVA_MOUSE = "seccion_activa_v1";

/**
 * v2.8.9 (pedido explícito): los botones "atrás"/"adelante" de un mouse de
 * 5 botones (MouseEvent.button 3 y 4) navegan entre las secciones del nav
 * principal, en vez de disparar el historial NATIVO del navegador — que
 * sin este listener cierra la pestaña (si no hay historial previo) o deja
 * la app en un estado roto/mostrando HTML crudo (si sí lo hay, ej.
 * volviendo a un estado servido desde bfcache). Se engancha sobre
 * "mouseup" (no "click": los botones 4/5 no disparan evento click en
 * todos los navegadores) y llama a preventDefault() en cuanto detecta
 * botón 3 o 4, haya o no una sección a la que efectivamente navegar — así
 * el navegador nunca llega a intentar su propia navegación de historial
 * para esos botones, sin importar el resultado de acá adentro.
 *
 * Reutiliza el MISMO mecanismo de navegación que ya existe
 * (window.mostrarSeccion, ver main.js) en vez de inventar un historial
 * paralelo — se expone en window por el mismo motivo que
 * aplicarVisibilidadNavegacion/obtenerOrdenNavegacion ya se exponen así
 * (main.js importa este archivo, así que este archivo no puede importar
 * de vuelta a main.js para esto sin crear un ciclo).
 *
 * El orden a recorrer es el de las secciones REALMENTE visibles en el nav
 * en este momento — se lee directo del DOM (.btn-nav[data-seccion] ya
 * filtrados/ordenados por aplicarVisibilidadNavegacion, que corre en cada
 * mostrarApp() y en cada cambio de Ajustes) en vez de recalcular acá la
 * lista lógica de nuevo — así nunca se desincroniza de lo que la persona
 * ve realmente en el sidebar, sea cual sea su configuración de
 * orden/ocultas.
 */
function inicializarNavegacionBotonesMouse() {
  document.addEventListener("mouseup", (e) => {
    if (e.button !== 3 && e.button !== 4) return;
    e.preventDefault();

    if (typeof window.mostrarSeccion !== "function") return;

    const botones = Array.from(document.querySelectorAll(".btn-nav[data-seccion]:not(.oculto)"));
    if (botones.length === 0) return;

    const actual = localStorage.getItem(CLAVE_SECCION_ACTIVA_MOUSE);
    let indiceActual = botones.findIndex((btn) => btn.dataset.seccion === actual);
    if (indiceActual === -1) indiceActual = 0;

    // Botón 3 = "atrás" (sección anterior en la lista); botón 4 =
    // "adelante" (siguiente) — mismo sentido que el historial de un
    // navegador normal. No da la vuelta circular (se queda quieto en la
    // punta): ir "más atrás" que la primera sección o "más adelante" que
    // la última no tiene a dónde navegar, en vez de saltar sorpresivamente
    // al otro extremo de la lista.
    const direccion = e.button === 3 ? -1 : 1;
    const indiceNuevo = indiceActual + direccion;
    if (indiceNuevo < 0 || indiceNuevo >= botones.length) return;

    window.mostrarSeccion(botones[indiceNuevo].dataset.seccion);
  });

  // Algunos navegadores (Chrome en Windows, sobre todo) además disparan su
  // propia navegación de historial sobre "auxclick" para estos mismos
  // botones — se bloquea también acá por las dudas, para cubrir el caso de
  // que el navegador actúe sobre auxclick en vez de (o además de) mouseup.
  document.addEventListener("auxclick", (e) => {
    if (e.button === 3 || e.button === 4) e.preventDefault();
  });
}

/* ===================== Horario — Selector de modalidad ===================== */

const ETIQUETAS_MODALIDAD_HORARIO = {
  presencial: "Presencial",
  semipresencial: "Semipresencial",
  virtual: "Virtual",
  personalizado: "Personalizado",
};

/**
 * Horario — Núcleo: selector de modalidad (Presencial/Semipresencial/
 * Virtual/Personalizado), reutilizable en el modal de creación/edición de
 * bloque Y en el editor de excepción por semana (mismo campo en los dos
 * lugares). No existía un componente de "pill-group con opción que revela
 * un input de texto libre" en el proyecto (comunidad.js tiene
 * construirGrupoPills, pero es puramente visual: no maneja estado propio ni
 * reacciona a la opción elegida) — este sí lleva su propio estado interno,
 * por eso vive acá en vez de ser una llamada más a ese helper.
 *
 * `valorInicial` es un objeto modalidad completo (ver crearModalidadHorario
 * en schema.js), no un string suelto. Si viene vacío/inválido arranca en
 * "presencial". El input de texto libre queda oculto (clase .oculto, mismo
 * mecanismo que el resto de la app) salvo que la opción activa sea
 * "personalizado".
 *
 * Devuelve { elemento, obtenerValor() } — mismo contrato que
 * construirSelectorCustom en comunidad.js, así el caller no necesita leer
 * el DOM a mano para saber el valor final al guardar el modal.
 */
function construirSelectorModalidad(valorInicial, onCambiar) {
  const wrap = document.createElement("div");
  wrap.className = "selector-modalidad-horario";

  let valorActual =
    valorInicial && MODALIDADES_HORARIO.includes(valorInicial.tipo)
      ? { tipo: valorInicial.tipo, texto_personalizado: valorInicial.texto_personalizado || "" }
      : crearModalidadHorario("presencial");

  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "display:flex; width:100%; gap:8px;";

  const inputPersonalizado = document.createElement("input");
  inputPersonalizado.type = "text";
  inputPersonalizado.className = "form-input";
  inputPersonalizado.style.marginTop = "8px";
  inputPersonalizado.placeholder = "Ej: Virtual asincrónica, laboratorio remoto...";
  inputPersonalizado.maxLength = 60;
  inputPersonalizado.value = valorActual.texto_personalizado || "";

  function actualizarVisibilidadInput() {
    inputPersonalizado.classList.toggle("oculto", valorActual.tipo !== "personalizado");
  }

  function repintarPills() {
    grupo.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tipo === valorActual.tipo);
    });
  }

  MODALIDADES_HORARIO.forEach((tipo) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valorActual.tipo === tipo ? " active" : "");
    btn.style.flex = "1";
    btn.dataset.tipo = tipo;
    btn.textContent = ETIQUETAS_MODALIDAD_HORARIO[tipo];
    btn.addEventListener("click", () => {
      if (valorActual.tipo === tipo) return;
      valorActual = crearModalidadHorario(tipo, tipo === "personalizado" ? inputPersonalizado.value : null);
      repintarPills();
      actualizarVisibilidadInput();
      if (tipo === "personalizado") inputPersonalizado.focus();
      onCambiar(valorActual);
    });
    grupo.appendChild(btn);
  });

  // FIX previsible ("el texto personalizado se borra al tocar otro campo"):
  // el input actualiza valorActual en cada tecleo, no solo al cerrar el
  // modal — así el objeto que devuelve obtenerValor() siempre está al día,
  // sin depender de un evento "blur" que el usuario podría no disparar
  // antes de guardar.
  inputPersonalizado.addEventListener("input", () => {
    valorActual = crearModalidadHorario("personalizado", inputPersonalizado.value);
    onCambiar(valorActual);
  });

  actualizarVisibilidadInput();

  wrap.appendChild(grupo);
  wrap.appendChild(inputPersonalizado);

  return {
    elemento: wrap,
    obtenerValor: () => valorActual,
  };
}

/* ===================== Notificaciones — Selector de chips múltiple ===================== */

/**
 * Notificaciones — Recordatorios configurables (2026-08-20): grupo de
 * chips de selección MÚLTIPLE (a diferencia de un pill-group normal, que
 * es de selección única) — usado para elegir qué offsets ("15 min antes",
 * "1 día antes", etc.) están activos para un tipo de evento dado. Mismo
 * contrato { elemento, obtenerValor() } que construirSelectorModalidad,
 * así el caller (config-ajustes.js) no necesita leer el DOM a mano.
 *
 * `opciones`: arreglo de { id, etiqueta } (ver OFFSETS_RECORDATORIO_AGENDA
 * en core/schema.js). `valoresIniciales`: arreglo de ids ya activos.
 * `onCambiar(valoresActuales)`: se llama en cada toggle con el arreglo
 * actualizado completo (mismo patrón notificar-en-cada-cambio que
 * construirSelectorModalidad), para que quien llama pueda guardar en el
 * momento sin depender de un botón "Guardar" aparte — consistente con el
 * resto de Ajustes, que aplica todo al toque.
 *
 * No permite dejar el grupo completamente vacío: si el usuario destilda el
 * último chip activo, ese último click se ignora (el chip vuelve a quedar
 * marcado) — un tipo de evento sin ningún offset activo equivale a "nunca
 * avisar nada de este tipo", que si se quiere de verdad ya existe como
 * comportamiento normal con el switch general de Ajustes apagado; dentro
 * de este selector puntual, vacío se lee más como un estado accidental
 * (usuario destildando todo sin querer) que como una elección real.
 */
function construirSelectorChipsMultiple(opciones, valoresIniciales, onCambiar) {
  const wrap = document.createElement("div");
  wrap.className = "pill-group selector-chips-multiple";
  wrap.style.cssText = "display:flex; flex-wrap:wrap; gap:8px;";

  let valoresActuales = Array.isArray(valoresIniciales) && valoresIniciales.length > 0
    ? [...valoresIniciales]
    : [opciones[0]?.id].filter(Boolean);

  function repintar() {
    wrap.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", valoresActuales.includes(btn.dataset.id));
    });
  }

  opciones.forEach(({ id, etiqueta }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valoresActuales.includes(id) ? " active" : "");
    btn.dataset.id = id;
    btn.textContent = etiqueta;
    btn.addEventListener("click", () => {
      const yaActivo = valoresActuales.includes(id);
      if (yaActivo && valoresActuales.length === 1) return; // no permite vaciar del todo, ver comentario arriba
      valoresActuales = yaActivo
        ? valoresActuales.filter((v) => v !== id)
        : [...valoresActuales, id];
      repintar();
      onCambiar([...valoresActuales]);
    });
    wrap.appendChild(btn);
  });

  return {
    elemento: wrap,
    obtenerValor: () => [...valoresActuales],
  };
}

/* ===================== Auto-scroll de selectores activos al abrir un modal ===================== */

/**
 * Pedido de Wagner (17/08): en selectores largos dentro de ventanas
 * emergentes — el pill-group de modalidad cuando "Personalizado" queda al
 * final, la lista de semestres, cualquier selector con scroll propio — el
 * ítem ya elegido podía quedar fuera de la vista inicial, obligando a
 * scrollear a ciegas solo para confirmar qué estaba seleccionado. Pedido
 * explícito: que sea parejo "en todos los semestres" (o sea, en toda la
 * app, no pantalla por pantalla).
 *
 * En vez de ir modal por modal agregando esto a mano (docenas de puntos
 * distintos, ver abrirSelectorSemestre acá mismo o abrirModalEventoAgenda
 * en agenda-modal.js), se detecta genéricamente CUALQUIER apertura de
 * `.modal-overlay` con un único observer acá, y se hace scroll instantáneo
 * (sin animación — tiene que verse así desde el primer frame, no
 * "deslizarse" después de que la persona ya lo vio vacío) hasta el ítem
 * `.active`/`.selected` de cualquier selector adentro. Cubre los 2 patrones
 * que ya existen en el código:
 *   1. Modales fijos en el HTML que solo alternan la clase "oculto" (la
 *      inmensa mayoría — ver inicializarBotonesCerrarModal más arriba,
 *      mismo criterio de selector `.modal-overlay`).
 *   2. Modales armados al vuelo con document.createElement + appendChild
 *      (ej. abrirTarjetaInfoBloque en horario.js), que nacen visibles de
 *      una y nunca pasan por un cambio de clase que el observer pueda
 *      detectar por sí solo — por eso también se observa childList.
 */
function enfocarSelectoresActivosDeModal(overlay) {
  if (!overlay || !overlay.classList || overlay.classList.contains("oculto")) return;
  overlay.querySelectorAll(".pill-group, .selector-modalidad-horario, [data-scroll-selector]").forEach((cont) => {
    const activo = cont.querySelector(".active, .selected, [aria-selected='true']");
    // block/inline "nearest": solo mueve el scroll del contenedor propio
    // del selector (ej. el pill-group con overflow-x:auto) lo mínimo
    // necesario para que el ítem quede visible — nunca desplaza además la
    // página entera o el modal completo de arrastre.
    if (activo) activo.scrollIntoView({ block: "nearest", inline: "nearest" });
  });
}

/**
 * Pantalla de carga de sesión (2026-08-19 — reporte "se abre y cierra sola
 * una ventana de Google" + pedido explícito "no quiero ver el login de
 * una, quiero una pantalla de carga bonita"): overlay de marca propia,
 * separado a propósito del overlay-cargando genérico (los "3 puntitos",
 * pensado para esperas cortas dentro de la app ya abierta) porque este
 * cubre dos momentos puntuales del arranque/login:
 *   1. Mientras la app todavía no sabe si puede restaurar la sesión sola
 *      (leyendo caché/token, esperando a que cargue el script de Google) —
 *      antes esto mostraba de entrada la tarjeta de "Iniciar sesión con
 *      Google" (con el botón ya visible) aunque en la enorme mayoría de las
 *      cargas ese botón nunca hacía falta tocarlo.
 *   2. Justo después de un login real exitoso, mientras se trae el archivo
 *      de datos de Drive (antes usaba mostrarCargando(), el mismo overlay
 *      genérico de 3 puntitos que se usa para cualquier espera corta).
 * `#pantalla-login` (el botón real) solo se revela cuando de verdad hace
 * falta una acción del usuario: no hay sesión en caché, o el intento de
 * reconexión/carga falló. Nunca se muestran los dos overlays a la vez.
 */

function mostrarPantallaCargaSesion() {
  const overlay = document.getElementById("overlay-carga-sesion");
  if (overlay) overlay.classList.remove("oculto");
}

function ocultarPantallaCargaSesion() {
  const overlay = document.getElementById("overlay-carga-sesion");
  if (overlay) overlay.classList.add("oculto");
}

function inicializarAutoScrollSelectoresEnModales() {
  const observer = new MutationObserver((mutaciones) => {
    mutaciones.forEach((mut) => {
      if (mut.type === "attributes" && mut.attributeName === "class") {
        const el = mut.target;
        if (el.classList && el.classList.contains("modal-overlay")) {
          // requestAnimationFrame: se espera al próximo frame para que el
          // contenido dinámico que cada modal arma recién al abrirse
          // (innerHTML, pills con .active, etc.) ya esté pintado en el DOM
          // — mismo motivo que ya usa desplazarYResaltarElemento más
          // arriba para reintentar hasta que el destino exista.
          requestAnimationFrame(() => enfocarSelectoresActivosDeModal(el));
        }
        return;
      }
      if (mut.type === "childList") {
        mut.addedNodes.forEach((nodo) => {
          if (nodo.nodeType !== 1) return;
          if (nodo.classList && nodo.classList.contains("modal-overlay")) {
            requestAnimationFrame(() => enfocarSelectoresActivosDeModal(nodo));
          }
          nodo.querySelectorAll?.(".modal-overlay").forEach((sub) => {
            requestAnimationFrame(() => enfocarSelectoresActivosDeModal(sub));
          });
        });
      }
    });
  });
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ["class"],
    childList: true,
    subtree: true,
  });
}

export {
  CLAVE_SIDEBAR_COLAPSADA,
  abrirConfirmacion,
  abrirDrawerEnlacesMovil,
  agregarLongPress,
  callbackConfirmacionActual,
  cerrarConfirmacion,
  cerrarDrawerEnlacesMovil,
  cerrarSidebarMovil,
  construirSelectorChipsMultiple,
  construirSelectorModalidad,
  desplazarYResaltarElemento,
  envolverConFlechasScroll,
  inicializarAutoScrollSelectoresEnModales,
  inicializarBotonesCerrarModal,
  inicializarLayoutResponsivo,
  inicializarModalConfirmacion,
  inicializarNavegacionBotonesMouse,
  mostrarPantallaCargaSesion,
  mostrarToast,
  mostrarToastAccion,
  ocultarPantallaCargaSesion,
  restaurarEstadoSidebar,
};
