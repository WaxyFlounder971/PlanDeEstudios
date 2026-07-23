/* =========================================================================
   APP.JS — Cimientos (Iteración 0)
   Encargado de: pantalla de login, cargar/guardar datos (offline-first +
   Google Drive), selector de plan activo, ajustes generales, cerrar sesión.
   Las demás secciones del menú (Plan de Estudios, Semestres, etc.) quedan
   como "próximamente" — se construyen en las siguientes iteraciones.
   ========================================================================= */

const CLAVE_CACHE_LOCAL = "app_academica_cache";

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

  document.getElementById("btn-login-google").addEventListener("click", iniciarSesionConGoogle);
  document.getElementById("btn-logout").addEventListener("click", cerrarSesion);

  window.addEventListener("online", intentarSincronizar);

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

async function onLoginExitoso(token) {
  estado.token = token;
  const { fileId, datos } = await buscarOCrearArchivoDatos(token);
  estado.fileId = fileId;
  estado.datos = datos;
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
  // Paletas
  const grid = document.getElementById("grid-paletas");
  grid.innerHTML = "";
  PALETAS_DISPONIBLES.forEach((paleta) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (paleta === estado.datos.configuracion.paleta ? " selected" : "");
    sw.style.background = `linear-gradient(135deg, var(--accent-1), var(--accent-2))`;
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
  btnAgregar.onclick = () => {
    const nombre = prompt("Nombre del enlace (ej. Sistema de Matrícula):");
    if (!nombre) return;
    const url = prompt("URL completa (https://...):");
    if (!url) return;
    const icono = prompt("Pon un emoji para el icono (ej. 🎓):", "🔗");
    estado.datos.configuracion.enlaces_rapidos.push(
      crearEnlaceRapido({ nombre, url, icono_tipo: "emoji", icono_valor: icono || "🔗" })
    );
    marcarCambioPendiente();
    renderizarEnlacesRapidos();
  };
}
