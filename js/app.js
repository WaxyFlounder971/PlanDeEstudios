/* =========================================================================
   APP.JS — Cimientos (Iteración 0)
   Encargado de: pantalla de login, cargar/guardar datos (offline-first +
   Google Drive), selector de plan activo, ajustes generales, cerrar sesión,
   layout responsivo (sidebar/drawer), perfil de Google y modal de enlaces.
   Las demás secciones del menú (Plan de Estudios, Semestres, etc.) quedan
   como "próximamente" — se construyen en las siguientes iteraciones.
   ========================================================================= */

const CLAVE_CACHE_LOCAL = "app_academica_cache";
const CLAVE_SIDEBAR_COLAPSADA = "sidebar_colapsada";

/** Colores reales de cada paleta (modo oscuro), tomados de design-system.css.
 *  Se usan para pintar cada cuadro del selector con SU propio color, sin
 *  importar cuál paleta esté activa en <html> (punto 3 del prompt). */
const COLORES_PREVIEW_PALETA = {
  blanco:    ["#94A3B8", "#F1F5F9"],
  gris:      ["#4B5563", "#9CA3AF"],
  azul:      ["#2563EB", "#38BDF8"],
  verde:     ["#15803D", "#4ADE80"],
  cyan:      ["#0E7490", "#22D3EE"],
  morado:    ["#6D28D9", "#C084FC"],
  rosado:    ["#BE185D", "#F472B6"],
  indigo:    ["#4338CA", "#818CF8"],
  amarillo:  ["#A16207", "#FDE047"],
  dorado:    ["#92400E", "#FBBF24"],
};

/** Color de texto legible sobre el degradado de cada paleta (mismo criterio
 *  que --on-accent en el CSS: "blanco" necesita texto oscuro). */
const TEXTO_PREVIEW_PALETA = {
  blanco: "#1E293B",
};

const estado = {
  token: null,
  fileId: null,
  datos: null,
  pendienteSync: false,
};

/* ---------------------------- Arranque ---------------------------- */

window.addEventListener("DOMContentLoaded", () => {
  aplicarTemaGuardadoLocalmente(); // para que no haya "flash" de color al cargar
  inicializarGoogleAuth({ alObtenerToken: onLoginExitoso });

  // Punto 8: el click debe llamar iniciarSesionConGoogle() de forma directa
  // e inmediata (sin async/await de por medio) para no romper el gesto de
  // usuario en navegadores móviles.
  const btnLogin = document.getElementById("btn-login-google");
  btnLogin.addEventListener("click", () => {
    ocultarAvisoLoginBloqueado();
    iniciarSesionConGoogle();
    programarAvisoLoginBloqueado();
  });

  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);
  document.getElementById("btn-logout-popover").addEventListener("click", cerrarSesion);

  window.addEventListener("online", intentarSincronizar);

  inicializarLayoutResponsivo();
  inicializarModalEnlace();

  const cache = leerCacheLocal();
  if (cache && cache.datos) {
    // Ya había una sesión local: mostramos la app de inmediato (offline-first)
    // y de fondo, si hay token, se podría refrescar. Para la Iteración 0
    // mantenemos esto simple: si no hay token en memoria, se pide login igual
    // para poder seguir sincronizando con Drive.
    estado.datos = cache.datos;
    estado.fileId = cache.fileId;
    mostrarApp();
  }
});

/* ------------------------------ Login ------------------------------ */

let temporizadorAvisoLogin = null;

function programarAvisoLoginBloqueado() {
  clearTimeout(temporizadorAvisoLogin);
  temporizadorAvisoLogin = setTimeout(() => {
    const aviso = document.getElementById("aviso-login-bloqueado");
    if (!aviso) return;
    aviso.textContent =
      "No se pudo abrir el inicio de sesión. Si usas VPN, un bloqueador de anuncios o una extensión de privacidad, desactívalo para este sitio e intenta de nuevo.";
    aviso.classList.remove("oculto");
  }, 6000);
}

function ocultarAvisoLoginBloqueado() {
  clearTimeout(temporizadorAvisoLogin);
  const aviso = document.getElementById("aviso-login-bloqueado");
  if (aviso) aviso.classList.add("oculto");
}

async function onLoginExitoso(token) {
  ocultarAvisoLoginBloqueado();
  estado.token = token;
  const { fileId, datos } = await buscarOCrearArchivoDatos(token);
  estado.fileId = fileId;
  estado.datos = datos;

  // Punto 6: nombre + foto de perfil de Google.
  const perfilGoogle = await obtenerPerfilGoogle(token);
  if (perfilGoogle) {
    estado.datos.perfil.nombre = perfilGoogle.nombre;
    estado.datos.perfil.foto_url = perfilGoogle.foto_url;
    estado.datos.perfil.correo = perfilGoogle.correo || estado.datos.perfil.correo;
  }

  guardarCacheLocal();
  mostrarApp();
}

function mostrarApp() {
  document.getElementById("pantalla-login").classList.add("oculto");
  document.getElementById("app-shell").classList.remove("oculto");
  aplicarPaleta(estado.datos.configuracion.paleta, estado.datos.configuracion.modo);
  renderizarSelectorPlan();
  renderizarAjustes();
  renderizarEnlacesRapidos();
  renderizarPerfil();
  restaurarEstadoSidebar();
}

/* --------------------------- Cerrar sesión --------------------------- */

function cerrarSesion() {
  cerrarSesionGoogle();
  localStorage.removeItem(CLAVE_CACHE_LOCAL);
  estado.token = null;
  estado.fileId = null;
  estado.datos = null;
  document.getElementById("app-shell").classList.add("oculto");
  document.getElementById("pantalla-login").classList.remove("oculto");
}

/* ------------------------- Cache local (offline) ------------------------- */

function guardarCacheLocal() {
  localStorage.setItem(
    CLAVE_CACHE_LOCAL,
    JSON.stringify({ fileId: estado.fileId, datos: estado.datos })
  );
}

function leerCacheLocal() {
  const crudo = localStorage.getItem(CLAVE_CACHE_LOCAL);
  return crudo ? JSON.parse(crudo) : null;
}

/** Se llama cada vez que se modifica algo en `estado.datos`. */
function marcarCambioPendiente() {
  guardarCacheLocal();
  estado.pendienteSync = true;
  actualizarIndicadorSync();
  if (navigator.onLine) intentarSincronizar();
}

async function intentarSincronizar() {
  if (!estado.pendienteSync || !estado.token || !estado.fileId) return;
  try {
    await guardarDatos(estado.token, estado.fileId, estado.datos);
    estado.pendienteSync = false;
    actualizarIndicadorSync();
  } catch (e) {
    console.warn("No se pudo sincronizar todavía, se reintentará más tarde.", e);
  }
}

function actualizarIndicadorSync() {
  const el = document.getElementById("indicador-sync");
  if (!el) return;
  el.textContent = estado.pendienteSync ? "Cambios sin sincronizar" : "Todo sincronizado";
  el.className = "badge " + (estado.pendienteSync ? "badge-warning" : "badge-success");
}

/* ------------------------------ Tema ------------------------------ */

function aplicarPaleta(paleta, modo) {
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
  localStorage.setItem("tema_paleta", paleta);
  localStorage.setItem("tema_modo", modo);
}

function aplicarTemaGuardadoLocalmente() {
  const paleta = localStorage.getItem("tema_paleta") || "azul";
  const modo = localStorage.getItem("tema_modo") || "dark";
  document.documentElement.setAttribute("data-palette", paleta);
  document.documentElement.setAttribute("data-mode", modo);
}

/* --------------------------- Selector de plan --------------------------- */

function renderizarSelectorPlan() {
  const cont = document.getElementById("selector-plan");
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún Plan de Estudios. Eso se agrega en la Iteración 1 (importar tu malla curricular).</p>`;
    return;
  }

  cont.innerHTML = "";
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  planes.forEach((plan) => {
    const btn = document.createElement("button");
    btn.className = "pill-item" + (plan.id === estado.datos.configuracion.plan_activo_id ? " active" : "");
    btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
    btn.addEventListener("click", () => {
      estado.datos.configuracion.plan_activo_id = plan.id;
      marcarCambioPendiente();
      renderizarSelectorPlan();
    });
    grupo.appendChild(btn);
  });
  cont.appendChild(grupo);
}

/* ------------------------------ Ajustes ------------------------------ */

function renderizarAjustes() {
  // Paletas — cada cuadro muestra su propio color real (punto 3)
  const grid = document.getElementById("grid-paletas");
  grid.innerHTML = "";
  PALETAS_DISPONIBLES.forEach((paleta) => {
    const [c1, c2] = COLORES_PREVIEW_PALETA[paleta];
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (paleta === estado.datos.configuracion.paleta ? " selected" : "");
    sw.style.background = `linear-gradient(135deg, ${c1}, ${c2})`;
    sw.style.color = TEXTO_PREVIEW_PALETA[paleta] || "#ffffff";
    sw.setAttribute("data-palette-preview", paleta);
    sw.textContent = paleta;
    sw.addEventListener("click", () => {
      estado.datos.configuracion.paleta = paleta;
      aplicarPaleta(paleta, estado.datos.configuracion.modo);
      marcarCambioPendiente();
      renderizarAjustes();
    });
    grid.appendChild(sw);
  });

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(estado.datos.configuracion.paleta, nuevoModo);
    marcarCambioPendiente();
  };

  // Escala de notas global
  const grupoEscala = document.getElementById("pill-escala-notas");
  grupoEscala.querySelectorAll(".pill-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.valor) === estado.datos.configuracion.escala_notas_global);
    btn.onclick = () => {
      estado.datos.configuracion.escala_notas_global = Number(btn.dataset.valor);
      marcarCambioPendiente();
      renderizarAjustes();
    };
  });

  actualizarIndicadorSync();
}

/* --------------------------- Enlaces rápidos --------------------------- */

function renderizarEnlacesRapidos() {
  const cont = document.getElementById("lista-enlaces");
  const enlaces = estado.datos.configuracion.enlaces_rapidos;
  cont.innerHTML = "";

  enlaces.forEach((enlace) => {
    const item = document.createElement("a");
    item.href = enlace.url;
    item.target = "_blank";
    item.rel = "noopener";
    item.className = "glass-panel row";
    item.style.padding = "10px 14px";
    item.style.textDecoration = "none";
    item.innerHTML = `<span style="font-size:1.3rem">${
      enlace.icono_tipo === "emoji" ? enlace.icono_valor : `<img src="${enlace.icono_valor}" style="width:24px;height:24px;border-radius:6px">`
    }</span><span>${enlace.nombre}</span>`;
    cont.appendChild(item);
  });

  const btnAgregar = document.getElementById("btn-agregar-enlace");
  btnAgregar.disabled = enlaces.length >= LIMITE_ENLACES_RAPIDOS;
  btnAgregar.onclick = () => abrirModalEnlace();
}

/* ===================== Modal "Añadir enlace" (punto 7) ===================== */

function inicializarModalEnlace() {
  const modal = document.getElementById("modal-enlace");
  const pillTipo = document.getElementById("pill-tipo-icono");
  const bloqueEmoji = document.getElementById("bloque-icono-emoji");
  const bloqueImagen = document.getElementById("bloque-icono-imagen");

  pillTipo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const esEmoji = btn.dataset.tipo === "emoji";
      bloqueEmoji.classList.toggle("oculto", !esEmoji);
      bloqueImagen.classList.toggle("oculto", esEmoji);
    });
  });

  document.getElementById("btn-cancelar-enlace").addEventListener("click", cerrarModalEnlace);
  document.getElementById("btn-guardar-enlace").addEventListener("click", guardarEnlaceDesdeModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarModalEnlace();
  });
}

function abrirModalEnlace() {
  document.getElementById("input-enlace-nombre").value = "";
  document.getElementById("input-enlace-url").value = "";
  document.getElementById("input-enlace-emoji").value = "🔗";
  document.getElementById("input-enlace-imagen").value = "";
  document.getElementById("error-modal-enlace").classList.add("oculto");

  const pillTipo = document.getElementById("pill-tipo-icono");
  pillTipo.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  pillTipo.querySelector('[data-tipo="emoji"]').classList.add("active");
  document.getElementById("bloque-icono-emoji").classList.remove("oculto");
  document.getElementById("bloque-icono-imagen").classList.add("oculto");

  document.getElementById("modal-enlace").classList.remove("oculto");
}

function cerrarModalEnlace() {
  document.getElementById("modal-enlace").classList.add("oculto");
}

function mostrarErrorModalEnlace(mensaje) {
  const el = document.getElementById("error-modal-enlace");
  el.textContent = mensaje;
  el.classList.remove("oculto");
}

async function guardarEnlaceDesdeModal() {
  const nombre = document.getElementById("input-enlace-nombre").value.trim();
  const url = document.getElementById("input-enlace-url").value.trim();
  const tipoActivo = document.getElementById("pill-tipo-icono").querySelector(".pill-item.active").dataset.tipo;

  if (!nombre || !url) {
    mostrarErrorModalEnlace("El nombre y la URL son obligatorios.");
    return;
  }

  if (estado.datos.configuracion.enlaces_rapidos.length >= LIMITE_ENLACES_RAPIDOS) {
    mostrarErrorModalEnlace(`Ya tienes el máximo de ${LIMITE_ENLACES_RAPIDOS} enlaces.`);
    return;
  }

  let icono_tipo = "emoji";
  let icono_valor = "🔗";

  if (tipoActivo === "emoji") {
    icono_tipo = "emoji";
    icono_valor = document.getElementById("input-enlace-emoji").value.trim() || "🔗";
  } else {
    const archivo = document.getElementById("input-enlace-imagen").files[0];
    if (!archivo) {
      mostrarErrorModalEnlace("Selecciona una imagen.");
      return;
    }
    try {
      icono_valor = await convertirArchivoABase64(archivo);
      icono_tipo = "imagen";
    } catch (e) {
      mostrarErrorModalEnlace("No se pudo leer la imagen, intenta con otra.");
      return;
    }
  }

  estado.datos.configuracion.enlaces_rapidos.push(
    crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor })
  );
  marcarCambioPendiente();
  renderizarEnlacesRapidos();
  cerrarModalEnlace();
}

function convertirArchivoABase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(lector.result);
    lector.onerror = () => reject(new Error("No se pudo leer el archivo"));
    lector.readAsDataURL(archivo);
  });
}

/* ===================== Perfil de Google (punto 6) ===================== */

function renderizarPerfil() {
  const perfil = estado.datos.perfil;
  const foto = document.getElementById("perfil-foto");
  const nombre = document.getElementById("perfil-nombre");
  const popoverNombre = document.getElementById("perfil-popover-nombre");
  const popoverCorreo = document.getElementById("perfil-popover-correo");

  foto.src = perfil.foto_url || "";
  foto.alt = perfil.nombre || "Foto de perfil";
  nombre.textContent = perfil.nombre || "";
  popoverNombre.textContent = perfil.nombre || "";
  popoverCorreo.textContent = perfil.correo || "";

  foto.onclick = () => {
    // El popover con confirmación solo tiene sentido cuando el sidebar está
    // colapsado (en expandido ya se ve el botón "Salir" directo).
    if (document.getElementById("app-sidebar").classList.contains("colapsada")) {
      togglePerfilPopover();
    }
  };
}

function togglePerfilPopover(forzarCerrado) {
  const popover = document.getElementById("perfil-popover");
  if (forzarCerrado) {
    popover.classList.add("oculto");
    return;
  }
  popover.classList.toggle("oculto");
}

document.addEventListener("click", (e) => {
  const popover = document.getElementById("perfil-popover");
  const foto = document.getElementById("perfil-foto");
  if (!popover || popover.classList.contains("oculto")) return;
  if (e.target === foto || popover.contains(e.target)) return;
  popover.classList.add("oculto");
});

/* ===================== Layout responsivo (puntos 1 y 5) ===================== */

function inicializarLayoutResponsivo() {
  const sidebar = document.getElementById("app-sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const btnHamburguesa = document.getElementById("btn-hamburguesa");
  const btnColapsar = document.getElementById("btn-colapsar-sidebar");

  btnHamburguesa.addEventListener("click", () => {
    sidebar.classList.add("abierta");
    overlay.classList.add("abierta");
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
}

function restaurarEstadoSidebar() {
  const colapsada = localStorage.getItem(CLAVE_SIDEBAR_COLAPSADA) === "1";
  document.getElementById("app-sidebar").classList.toggle("colapsada", colapsada);
}
