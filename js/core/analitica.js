/*
 * Analítica agregada de uso. Solo envía nombres de sección y categorías de
 * acciones; nunca contenido, títulos de datos, notas, mensajes ni valores de
 * formularios. El Worker clasifica el correo en memoria y guarda únicamente
 * el contador de la columna que corresponde.
 *
 * 2026-10-14 — Menos "Otra interacción":
 *  - La clasificación ya no depende solo del texto del botón. Mira primero
 *    señales de estructura (aria-expanded, pills, opciones de listas,
 *    encabezados colapsables), luego palabras del nombre accesible, luego
 *    símbolos de los botones de ícono (＋ ✕ ✎ 🗑 ⚙️ ‹ › ▾) y las clases propias
 *    de la app.
 *  - Solo se lee el texto PROPIO y corto del control (aria-label, title o los
 *    primeros 40 caracteres), no todo el contenido de una tarjeta grande: antes
 *    una tarjeta que contenía "nuevo" en cualquier parte contaba como "Agregar".
 *  - 4 categorías nuevas: "Expandir o contraer", "Abrir ajustes", "Navegar" y
 *    "Seleccionar opción". DEBEN existir también en FUNCIONES_ANALITICA del
 *    Worker (worker-notificaciones-agenda/src/index.js) o ese evento se rechaza.
 *  - Los eventos que ocurren antes de conocer el correo se retienen hasta 8 s
 *    y se envían con el correo apenas llega, para no contarse como "General".
 *  - Depuración: en la consola, localStorage.analitica_debug = "1" y recargar;
 *    cada clic que caiga en "Otra interacción" se imprime con su descripción
 *    para poder darle nombre propio con data-analitica-funcion.
 */
import { traducirTextoInterfaz } from "./i18n.js";

const URL_WORKER_ANALITICA = "https://worker-notificaciones-agenda.appacademica.workers.dev/analitica/evento";
const URL_WORKER_APP = "https://worker-notificaciones-agenda.appacademica.workers.dev";

const SECCIONES_ANALITICA = new Set([
  "demo", "resumen", "agenda", "horario", "tiempo-estudio",
  "semestres", "comunidad", "finanzas", "plan-estudios", "asistente", "notas",
  "configuracion",
]);

// Palabras del nombre accesible → categoría. Se prueban EN ORDEN sobre texto
// corto y sin acentos. Lo más específico va primero.
const CATEGORIAS_ACCION = [
  ["Eliminar", /\b(eliminar|borrar|quitar|remover|descartar|basurero)\b/i],
  ["Completar", /\b(completar|completad[oa]|marcar como|finalizar|hecho)\b/i],
  ["Pausar o detener", /\b(pausar|pausa|detener|terminar|desactivar|apagar)\b/i],
  ["Iniciar", /\b(iniciar|empezar|reanudar|reproducir|activar|encender|comenzar)\b/i],
  ["Importar", /\b(importar|cargar archivo|adjuntar|subir)\b/i],
  ["Exportar o descargar", /\b(exportar|descargar|respaldo|backup)\b/i],
  ["Compartir", /\b(compartir|copiar enlace|invitar|copiar)\b/i],
  ["Proyectar", /\b(proyectar|proyeccion|simular|calcular)\b/i],
  ["Enviar", /\b(enviar|consultar|preguntar|mensaje)\b/i],
  ["Buscar", /\b(buscar|filtrar|filtro)\b/i],
  ["Guardar", /\b(guardar|guardado|aplicar|aceptar|confirmar|continuar)\b/i],
  ["Editar", /\b(editar|modificar|cambiar|renombrar|actualizar|lapiz)\b/i],
  ["Agregar", /\b(agregar|anadir|nuevo|nueva|crear|sumar|unir|participar)\b/i],
  ["Abrir ajustes", /\b(ajustes|configurar|configuracion|engranaje)\b/i],
  ["Cerrar o cancelar", /\b(cerrar|cancelar|volver|salir|omitir|entendido|listo|ahora no)\b/i],
  ["Navegar", /\b(anterior|siguiente|atras|adelante|hoy|inicio)\b/i],
  ["Cambiar vista", /\b(vista|pestana|semestre|semana|mes|dia|tab|lista|calendario|cronograma|estadisticas)\b/i],
  ["Abrir elemento", /\b(abrir|ver|detalles|detalle|profesor|materia|racha|enlace)\b/i],
];

// Botones de ícono: no tienen texto útil, así que se reconocen por su símbolo.
const SIMBOLOS_ACCION = [
  ["Agregar", /^[＋+]/],
  ["Cerrar o cancelar", /^[✕✖×✗]/],
  ["Editar", /[✎✏]/],
  ["Eliminar", /🗑/],
  ["Abrir ajustes", /⚙/],
  ["Iniciar", /[▶⏵]/],
  ["Pausar o detener", /[⏸⏹■]/],
  ["Compartir", /[🔗📋]/u],
  ["Exportar o descargar", /[⬇⇩]/],
  ["Expandir o contraer", /^[▾▴⌄⌃⟨⟩]|⟨⟨|⟩⟩/],
  ["Navegar", /^[‹›←→«»↓↑]/],
];

// Clases propias de la app (design-system.css / módulos).
const CLASES_ACCION = [
  ["Expandir o contraer", ".ajuste-seccion-cabecera, summary, [aria-expanded]"],
  ["Cambiar vista", ".pill-item"],
  ["Seleccionar opción", ".select-custom-lista li, [role='option'], .agenda-semestre-tarjeta, .palette-item, [data-logo-app]"],
  ["Completar", ".agenda-check-completada"],
  ["Abrir ajustes", ".agenda-btn-ajustes"],
  ["Cerrar o cancelar", ".modal-x-close, .btn-cerrar-modal"],
];

let correoEnMemoria = "";
let tokenEnMemoria = "";
let consentimientoFlujos = false;
let promesaConsentimientoRemoto = Promise.resolve();
const CLAVE_EVENTOS_FLUJO = "analitica_flujos_pendientes_v1";
const CLAVE_SESION_FLUJO = "analitica_sesion_v1";
let listenersInstalados = false;
const pendientesSinCorreo = [];
let temporizadorPendientes = null;
let cargandoAvisos = false;
let ultimaConsultaAvisos = 0;
const ES_DEMO = (() => {
  try { return new URLSearchParams(location.search).get("demo") === "1"; } catch (_) { return false; }
})();
// Los ambientes de desarrollo y localhost nunca escriben en la analítica
// productiva ni modifican el estado de avisos de las cuentas reales.
const ES_DESARROLLO = (() => {
  try {
    const host = location.hostname.toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "dev.wapper.pages.dev" || host.startsWith("dev.");
  } catch (_) { return false; }
})();

function configurarCorreoAnalitica(correo, token = "", consentimiento = false) {
  const anterior = correoEnMemoria;
  correoEnMemoria = typeof correo === "string" ? correo.trim().toLowerCase().slice(0, 254) : "";
  tokenEnMemoria = typeof token === "string" ? token : "";
  consentimientoFlujos = Boolean(consentimiento && correoEnMemoria && tokenEnMemoria && !ES_DEMO && !ES_DESARROLLO);
  if (consentimientoFlujos) configurarConsentimientoAnalitica(true, true);
  if (anterior !== correoEnMemoria) {
    try { sessionStorage.removeItem(CLAVE_EVENTOS_FLUJO); } catch (_) {}
    ultimaConsultaAvisos = 0;
    try { sessionStorage.removeItem("avisos_globales_mostrados_v1"); } catch (_) {}
  }
  if (correoEnMemoria) vaciarPendientes();
  void enviarFlujosPendientes();
  if (correoEnMemoria && tokenEnMemoria) void cargarAvisosGlobales();
}

function configurarConsentimientoAnalitica(aceptado, sincronizar = true) {
  consentimientoFlujos = Boolean(aceptado && correoEnMemoria && tokenEnMemoria && !ES_DEMO && !ES_DESARROLLO);
  if (!consentimientoFlujos) { try { sessionStorage.removeItem(CLAVE_EVENTOS_FLUJO); } catch (_) {} }
  if (!sincronizar || !correoEnMemoria || !tokenEnMemoria || ES_DEMO || ES_DESARROLLO) return Promise.resolve();
  promesaConsentimientoRemoto = fetch(`${URL_WORKER_APP}/analitica/consentimiento`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEnMemoria}` },
    body: JSON.stringify({ aceptado: consentimientoFlujos }), keepalive: true,
  }).catch(() => null);
  return promesaConsentimientoRemoto;
}

async function cargarAvisosGlobales() {
  if (ES_DESARROLLO || cargandoAvisos || !tokenEnMemoria || !navigator.onLine || Date.now() - ultimaConsultaAvisos < 5 * 60 * 1000) return;
  ultimaConsultaAvisos = Date.now();
  cargandoAvisos = true;
  try {
    const r = await fetch(`${URL_WORKER_APP}/avisos/activos`, { headers: { Authorization: `Bearer ${tokenEnMemoria}` }, cache: "no-store" });
    if (!r.ok) return;
    const { avisos = [] } = await r.json();
    let vistos = [];
    try { vistos = JSON.parse(sessionStorage.getItem("avisos_globales_mostrados_v1") || "[]"); } catch (_) {}
    const nuevos = avisos.filter((a) => !vistos.includes(a.id));
    if (nuevos.length) mostrarAvisoGlobal(nuevos, 0);
  } catch (_) { ultimaConsultaAvisos = 0; /* los avisos nunca bloquean el uso normal ni el modo offline */ }
  finally { cargandoAvisos = false; }
}

function mostrarAvisoGlobal(avisos, indice) {
  const aviso = avisos[indice];
  if (!aviso) return;
  try {
    const vistos = JSON.parse(sessionStorage.getItem("avisos_globales_mostrados_v1") || "[]");
    if (!vistos.includes(aviso.id)) sessionStorage.setItem("avisos_globales_mostrados_v1", JSON.stringify([...vistos, aviso.id].slice(-100)));
  } catch (_) {}
  let overlay = document.getElementById("modal-aviso-global-app");
  if (!overlay) {
    if (!document.getElementById("estilos-aviso-global-app")) {
      const estilos = document.createElement("style");
      estilos.id = "estilos-aviso-global-app";
      estilos.textContent = `
        #modal-aviso-global-app .aviso-global-card{position:relative;overflow:hidden;width:min(520px,calc(100vw - 32px));padding:28px;border:1px solid color-mix(in srgb,var(--accent-1,#7c3aed) 22%,transparent);box-shadow:0 28px 90px #10182855;background:var(--glass-bg,rgba(255,255,255,.96));backdrop-filter:blur(18px)}
        #modal-aviso-global-app .aviso-global-card:before{content:"";position:absolute;inset:0 0 auto;height:5px;background:linear-gradient(90deg,var(--accent-1,#7c3aed),var(--accent-2,#2563eb))}
        #modal-aviso-global-app .aviso-global-icono{width:46px;height:46px;display:grid;place-items:center;border-radius:15px;color:var(--accent-1,#7c3aed);background:color-mix(in srgb,var(--accent-1,#7c3aed) 12%,transparent);font-size:1.35rem}
        #modal-aviso-global-app .aviso-global-eyebrow{margin:0;color:var(--text-muted,#788097);font-size:.72rem;font-weight:750;letter-spacing:.12em;text-transform:uppercase}
        #modal-aviso-global-app .aviso-global-mensaje{line-height:1.65;overflow-wrap:anywhere}
        #modal-aviso-global-app .aviso-global-acciones{display:flex;justify-content:flex-end;gap:10px;flex-wrap:wrap;margin-top:8px}
        #modal-aviso-global-app .aviso-global-acciones button{min-height:42px;padding:9px 18px;border-radius:12px;font-weight:650}
        @media(max-width:520px){#modal-aviso-global-app .aviso-global-card{padding:24px 20px}}
      `;
      document.head.appendChild(estilos);
    }
    overlay = document.createElement("div"); overlay.id = "modal-aviso-global-app"; overlay.className = "modal-overlay";
    overlay.style.zIndex = "100000";
    overlay.innerHTML = '<section class="glass-card modal-card stack aviso-global-card" role="dialog" aria-modal="true" aria-labelledby="aviso-global-titulo"><div class="aviso-global-icono" aria-hidden="true">✦</div><p class="aviso-global-eyebrow">App Académica · Aviso</p><h2 id="aviso-global-titulo" style="margin:0"></h2><div id="aviso-global-cuerpo" class="aviso-global-mensaje" style="white-space:pre-wrap"></div><div id="aviso-global-acciones" class="aviso-global-acciones"></div></section>';
    document.body.appendChild(overlay);
  }
  overlay.querySelector("#aviso-global-titulo").textContent = aviso.titulo || "";
  overlay.querySelector("#aviso-global-cuerpo").textContent = aviso.cuerpo || "";
  const acciones = overlay.querySelector("#aviso-global-acciones"); acciones.replaceChildren();
  const etiqueta = aviso.etiqueta_accion || (aviso.accion === "continuar" ? "Continuar" : aviso.accion === "aceptar" ? "Aceptar" : aviso.accion === "cerrar" ? "Cerrar" : "Entendido");
  const boton = document.createElement("button"); boton.type = "button"; boton.className = "btn btn-primary"; boton.textContent = traducirTextoInterfaz(etiqueta);
  const registroVista = fetch(`${URL_WORKER_APP}/avisos/estado`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEnMemoria}` }, body: JSON.stringify({ aviso_id: aviso.id, accion: "vista" }), keepalive: true }).catch(() => null);
  const cerrar = async (confirmar) => {
    await registroVista;
    try { await fetch(`${URL_WORKER_APP}/avisos/estado`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEnMemoria}` }, body: JSON.stringify({ aviso_id: aviso.id, accion: confirmar ? aviso.accion : "cerrar" }), keepalive: true }); } catch (_) {}
    overlay.remove();
    if (confirmar && aviso.accion === "continuar" && typeof window.mostrarSeccion === "function") window.mostrarSeccion(aviso.destino);
    mostrarAvisoGlobal(avisos, indice + 1);
  };
  boton.onclick = () => { void cerrar(aviso.accion !== "cerrar"); };
  if (aviso.accion !== "cerrar") {
    const despues = document.createElement("button"); despues.type = "button"; despues.className = "btn"; despues.textContent = traducirTextoInterfaz("Ahora no");
    despues.onclick = () => { void cerrar(false); };
    acciones.append(despues);
  }
  acciones.append(boton);
  overlay.classList.remove("oculto");
}

function idFlujoNuevo() {
  try { return crypto.randomUUID(); } catch (_) { return `flow_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
}
function sesionFlujo() {
  try {
    let id = sessionStorage.getItem(CLAVE_SESION_FLUJO);
    if (!id) { id = idFlujoNuevo(); sessionStorage.setItem(CLAVE_SESION_FLUJO, id); }
    return id;
  } catch (_) { return idFlujoNuevo(); }
}
function leerColaFlujos() { try { return JSON.parse(sessionStorage.getItem(CLAVE_EVENTOS_FLUJO) || "[]"); } catch (_) { return []; } }
function guardarColaFlujos(xs) { try { sessionStorage.setItem(CLAVE_EVENTOS_FLUJO, JSON.stringify(xs.slice(-200))); } catch (_) {} }
function registrarEventoFlujo(evento) {
  if (!consentimientoFlujos) return;
  const cola = leerColaFlujos();
  cola.push(evento); guardarColaFlujos(cola);
  void enviarFlujosPendientes();
}
async function enviarFlujosPendientes() {
  if (ES_DESARROLLO || !tokenEnMemoria || !navigator.onLine || !consentimientoFlujos) return;
  const resultadoConsentimiento = await promesaConsentimientoRemoto;
  if (resultadoConsentimiento && !resultadoConsentimiento.ok) {
    consentimientoFlujos = false;
    try { sessionStorage.removeItem(CLAVE_EVENTOS_FLUJO); } catch (_) {}
    return;
  }
  if (!resultadoConsentimiento) return;
  if (!consentimientoFlujos) return;
  const cola = leerColaFlujos();
  while (cola.length) {
    try {
      const respuesta = await fetch("https://worker-notificaciones-agenda.appacademica.workers.dev/analitica/flujo", {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenEnMemoria}` },
        body: JSON.stringify(cola[0]), keepalive: true,
      });
      if (!respuesta.ok) break;
      cola.shift(); guardarColaFlujos(cola);
    } catch (_) { break; }
  }
}
function iniciarProcesoAnalitico(proceso) {
  const id = idFlujoNuevo();
  const secciones = { "agenda.tarea": "agenda", "plan.importacion": "plan-estudios", "wapper.mensaje": "asistente", "notas.editor": "notas" };
  if (!secciones[proceso] || !correoEnMemoria || !tokenEnMemoria || !consentimientoFlujos || ES_DEMO || ES_DESARROLLO) return { paso() {}, completar() {}, cancelar() {}, error() {} };
  const base = { flujo_id: id, sesion_id: sesionFlujo(), proceso, version: document.documentElement.dataset.appVersion || "3.24.4" };
  const enviar = (tipo, paso) => registrarEventoFlujo({ ...base, evento_id: idFlujoNuevo(), tipo, paso });
  const inicio = Date.now();
  enviar("iniciado", proceso === "agenda.tarea" ? "formulario_abierto" : proceso === "plan.importacion" ? "flujo_abierto" : proceso === "wapper.mensaje" ? "compositor_abierto" : "editor_abierto");
  let cerrado = false;
  return {
    id,
    paso(nombre) { if (!cerrado) enviar("paso", nombre); },
    completar(nombre) { if (cerrado) return; cerrado = true; enviar("completado", nombre || (proceso === "agenda.tarea" ? "guardado" : proceso === "plan.importacion" ? "guardado" : proceso === "wapper.mensaje" ? "respuesta_recibida" : "guardado")); },
    cancelar(nombre) { if (cerrado) return; cerrado = true; enviar("cancelado", nombre || "cancelado"); },
    error(nombre) { if (cerrado) return; cerrado = true; enviar("error", nombre || (proceso === "agenda.tarea" ? "validacion_fallida" : "validacion_fallida")); },
    duracionDesdeInicio: () => Date.now() - inicio,
  };
}
window.addEventListener("online", () => { void enviarFlujosPendientes(); void cargarAvisosGlobales(); });
document.addEventListener("visibilitychange", () => { if (!document.hidden) { void enviarFlujosPendientes(); void cargarAvisosGlobales(); } });
setInterval(() => { if (!document.hidden) void cargarAvisosGlobales(); }, 5 * 60 * 1000);
window.iniciarProcesoAnalitico = iniciarProcesoAnalitico;
window.configurarConsentimientoAnalitica = configurarConsentimientoAnalitica;

function enviarEvento(seccion, funcion) {
  if (ES_DESARROLLO) return;
  const eventoDemo = seccion === "demo";
  if (!eventoDemo && !tokenEnMemoria) return;
  try {
    void fetch(URL_WORKER_ANALITICA, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(!eventoDemo ? { Authorization: `Bearer ${tokenEnMemoria}` } : {}) },
      body: JSON.stringify({ seccion, funcion }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    // La analítica es secundaria y nunca debe interrumpir una acción de la app.
  }
}

// Envía lo retenido cuando ya hay sesión; la identidad la verifica el Worker.
function vaciarPendientes() {
  clearTimeout(temporizadorPendientes);
  temporizadorPendientes = null;
  while (pendientesSinCorreo.length) {
    const [seccion, funcion] = pendientesSinCorreo.shift();
    enviarEvento(seccion, funcion);
  }
}

function registrarAnaliticaUso(seccion, funcion) {
  if (ES_DESARROLLO) return;
  const seccionSegura = SECCIONES_ANALITICA.has(seccion) ? seccion : "resumen";
  const funcionSegura = typeof funcion === "string" ? funcion.slice(0, 48) : "Otra interacción";

  // La demo pública solo registra su apertura; no registra clics anónimos.
  if (seccionSegura === "demo") {
    enviarEvento(seccionSegura, funcionSegura);
    return;
  }
  if (ES_DEMO) return;
  if (!correoEnMemoria || !tokenEnMemoria) {
    pendientesSinCorreo.push([seccionSegura, funcionSegura]);
    if (pendientesSinCorreo.length > 40) pendientesSinCorreo.shift();
    if (!temporizadorPendientes) temporizadorPendientes = setTimeout(vaciarPendientes, 8000);
    return;
  }
  enviarEvento(seccionSegura, funcionSegura);
}

function obtenerSeccionDeElemento(elemento) {
  let panel = elemento?.closest?.('[id^="seccion-"]');
  while (panel) {
    const seccion = panel.id.slice("seccion-".length);
    if (SECCIONES_ANALITICA.has(seccion)) return seccion;
    panel = panel.parentElement?.closest?.('[id^="seccion-"]') || null;
  }
  const activa = globalThis.__appSeccionActiva;
  return SECCIONES_ANALITICA.has(activa) ? activa : "resumen";
}

function sinAcentos(texto) {
  return String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function clasificarTexto(texto) {
  const limpio = sinAcentos(texto);
  for (const [categoria, patron] of CATEGORIAS_ACCION) {
    if (patron.test(limpio)) return categoria;
  }
  return null;
}

// Texto propio y corto del control: nunca el contenido completo de una tarjeta.
function textoPropio(control) {
  const etiqueta = control.getAttribute("aria-label") || control.title || "";
  if (etiqueta) return etiqueta.slice(0, 60);
  return (control.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
}

function obtenerNombreAccion(control, respaldo) {
  const explicito = control.dataset.analiticaFuncion || control.dataset.analyticsFunction;
  if (explicito) return clasificarTexto(explicito) || respaldo;

  const texto = textoPropio(control);
  const porTexto = clasificarTexto(texto);
  if (porTexto) return porTexto;

  for (const [categoria, patron] of SIMBOLOS_ACCION) {
    if (patron.test(texto.trim())) return categoria;
  }
  for (const [categoria, selector] of CLASES_ACCION) {
    if (control.matches(selector) || control.closest(selector)) return categoria;
  }

  if (globalThis.localStorage?.getItem("analitica_debug") === "1") {
    console.info("[analítica] sin clasificar:", {
      texto, clases: control.className, id: control.id, etiqueta: control.outerHTML.slice(0, 140),
    });
  }
  return respaldo;
}

function inicializarAnaliticaUso() {
  if (listenersInstalados || !document.getElementById("app-shell")) return;
  listenersInstalados = true;
  const raiz = document;
  const appVisible = () => !document.getElementById("app-shell")?.classList.contains("oculto");

  raiz.addEventListener("click", (evento) => {
    if (!appVisible()) return;
    const selector = "button, a, [role='button'], [role='tab'], [role='option'], [onclick], summary, .select-custom-lista li, .agenda-semestre-tarjeta, .palette-item";
    const control = evento.target?.closest?.(selector);
    if (!control || !raiz.contains(control) || control.matches(".btn-nav[data-seccion]")) return;
    if (control.closest("[data-analitica-ignorar], [data-analytics-ignore]")) return;
    // El envío de un formulario se registra una sola vez en el evento submit.
    if (control.matches("button[type='submit'], input[type='submit']") || (control.tagName === "BUTTON" && control.type === "submit")) return;
    registrarAnaliticaUso(obtenerSeccionDeElemento(control), obtenerNombreAccion(control, "Otra interacción"));
  }, true);

  raiz.addEventListener("submit", (evento) => {
    if (!appVisible()) return;
    const formulario = evento.target;
    if (formulario?.closest?.("[data-analitica-ignorar], [data-analytics-ignore]")) return;
    registrarAnaliticaUso(obtenerSeccionDeElemento(formulario), "Enviar formulario");
  }, true);

  raiz.addEventListener("change", (evento) => {
    if (!appVisible()) return;
    const control = evento.target;
    if (!(control instanceof Element) || !control.matches("select, input[type='checkbox'], input[type='radio']")) return;
    if (control.closest("[data-analitica-ignorar], [data-analytics-ignore]")) return;
    registrarAnaliticaUso(obtenerSeccionDeElemento(control), control.tagName === "SELECT" ? "Cambiar vista" : "Cambiar ajuste");
  }, true);
}

export { configurarCorreoAnalitica, configurarConsentimientoAnalitica, inicializarAnaliticaUso, registrarAnaliticaUso, iniciarProcesoAnalitico };
