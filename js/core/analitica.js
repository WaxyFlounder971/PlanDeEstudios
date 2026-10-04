/*
 * Analítica agregada de uso. Solo envía nombres de sección y categorías de
 * acciones; nunca contenido, títulos de datos, notas, mensajes ni valores de
 * formularios. El Worker clasifica el correo en memoria y guarda únicamente
 * el contador de la columna que corresponde.
 */
const URL_WORKER_ANALITICA = "https://worker-notificaciones-agenda.appacademica.workers.dev/analitica/evento";

const SECCIONES_ANALITICA = new Set([
  "demo", "resumen", "agenda", "horario", "tiempo-estudio",
  "semestres", "comunidad", "finanzas", "plan-estudios", "asistente",
  "configuracion",
]);

const CATEGORIAS_ACCION = [
  ["Agregar", /\b(agregar|añadir|anadir|nuevo|nueva|crear|sumar|invitar|unir|participar)\b/i],
  ["Guardar", /\b(guardar|guardado|guardar cambios|aplicar)\b/i],
  ["Editar", /\b(editar|modificar|cambiar|renombrar|actualizar)\b/i],
  ["Eliminar", /\b(eliminar|borrar|quitar|remover|descartar)\b/i],
  ["Completar", /\b(completar|completado|marcar como hecho|finalizar)\b/i],
  ["Buscar", /\b(buscar|filtrar|filtro)\b/i],
  ["Importar", /\b(importar|cargar archivo|adjuntar|subir)\b/i],
  ["Exportar o descargar", /\b(exportar|descargar|respaldo|backup)\b/i],
  ["Compartir", /\b(compartir|copiar enlace|invitar)\b/i],
  ["Iniciar", /\b(iniciar|empezar|reanudar|reproducir|activar|encender)\b/i],
  ["Pausar o detener", /\b(pausar|detener|terminar|desactivar|apagar)\b/i],
  ["Abrir elemento", /\b(abrir|ver|detalles|detalle|cronograma|profesor|materia)\b/i],
  ["Cerrar o cancelar", /\b(cerrar|cancelar|volver|salir|omitir)\b/i],
  ["Proyectar", /\b(proyectar|proyección|proyeccion|simular|calcular)\b/i],
  ["Enviar", /\b(enviar|consultar|preguntar|mensaje)\b/i],
  ["Cambiar vista", /\b(vista|pestaña|pestana|semestre|semana|mes|día|dia|tab)\b/i],
];

let correoEnMemoria = "";
let listenersInstalados = false;

function configurarCorreoAnalitica(correo) {
  correoEnMemoria = typeof correo === "string" ? correo.trim().toLowerCase().slice(0, 254) : "";
}

function registrarAnaliticaUso(seccion, funcion) {
  const seccionSegura = SECCIONES_ANALITICA.has(seccion) ? seccion : "resumen";
  const funcionSegura = typeof funcion === "string" ? funcion.slice(0, 48) : "Otra interacción";
  const correo = seccionSegura === "demo" ? "" : correoEnMemoria;
  try {
    void fetch(URL_WORKER_ANALITICA, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seccion: seccionSegura, funcion: funcionSegura, correo }),
      keepalive: true,
    }).catch(() => {});
  } catch (_) {
    // La analítica es secundaria y nunca debe interrumpir una acción de la app.
  }
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

function clasificarAccion(texto, respaldo) {
  const textoSeguro = String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  for (const [categoria, patron] of CATEGORIAS_ACCION) {
    if (patron.test(textoSeguro)) return categoria;
  }
  return respaldo;
}

function obtenerNombreAccion(control, respaldo) {
  const nombreExplicito = control.dataset.analiticaFuncion || control.dataset.analyticsFunction;
  if (nombreExplicito) return clasificarAccion(nombreExplicito, respaldo);
  // Texto solo se usa localmente para clasificarlo en una categoría fija;
  // jamás se envía al Worker.
  return clasificarAccion(control.getAttribute("aria-label") || control.title || control.textContent, respaldo);
}

function inicializarAnaliticaUso() {
  if (listenersInstalados || !document.getElementById("app-shell")) return;
  listenersInstalados = true;
  const raiz = document;
  const appVisible = () => !document.getElementById("app-shell")?.classList.contains("oculto");

  raiz.addEventListener("click", (evento) => {
    if (!appVisible()) return;
    const control = evento.target?.closest?.("button, a, [role='button'], [role='tab'], [onclick]");
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
