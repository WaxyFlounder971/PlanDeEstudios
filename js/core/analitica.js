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
const URL_WORKER_ANALITICA = "https://worker-notificaciones-agenda.appacademica.workers.dev/analitica/evento";

const SECCIONES_ANALITICA = new Set([
  "demo", "resumen", "agenda", "horario", "tiempo-estudio",
  "semestres", "comunidad", "finanzas", "plan-estudios", "asistente",
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
let listenersInstalados = false;
const pendientesSinCorreo = [];
let temporizadorPendientes = null;
const ES_DEMO = (() => {
  try { return new URLSearchParams(location.search).get("demo") === "1"; } catch (_) { return false; }
})();

function configurarCorreoAnalitica(correo) {
  correoEnMemoria = typeof correo === "string" ? correo.trim().toLowerCase().slice(0, 254) : "";
  if (correoEnMemoria) vaciarPendientes();
}

function enviarEvento(seccion, funcion, correo) {
  try {
    void fetch(URL_WORKER_ANALITICA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seccion, funcion, correo }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    // La analítica es secundaria y nunca debe interrumpir una acción de la app.
  }
}

// Envía lo retenido con el correo que haya en ese momento (vacío = "General").
function vaciarPendientes() {
  clearTimeout(temporizadorPendientes);
  temporizadorPendientes = null;
  while (pendientesSinCorreo.length) {
    const [seccion, funcion] = pendientesSinCorreo.shift();
    enviarEvento(seccion, funcion, correoEnMemoria);
  }
}

function registrarAnaliticaUso(seccion, funcion) {
  const seccionSegura = SECCIONES_ANALITICA.has(seccion) ? seccion : "resumen";
  const funcionSegura = typeof funcion === "string" ? funcion.slice(0, 48) : "Otra interacción";

  // La demo nunca lleva correo; el resto espera hasta 8 s a conocerlo para no
  // contarse como "General" por haber ocurrido antes de cargar el perfil.
  if (seccionSegura === "demo" || ES_DEMO) {
    enviarEvento(seccionSegura, funcionSegura, "");
    return;
  }
  if (!correoEnMemoria) {
    pendientesSinCorreo.push([seccionSegura, funcionSegura]);
    if (pendientesSinCorreo.length > 40) pendientesSinCorreo.shift();
    if (!temporizadorPendientes) temporizadorPendientes = setTimeout(vaciarPendientes, 8000);
    return;
  }
  enviarEvento(seccionSegura, funcionSegura, correoEnMemoria);
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

export { configurarCorreoAnalitica, inicializarAnaliticaUso, registrarAnaliticaUso };
