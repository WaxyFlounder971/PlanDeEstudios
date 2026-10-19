import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { sellarTimestamp } from "../core/schema.js";
import { sanearHTMLNota, textoPlanoNota } from "./notas-sanitizar.js";
import { registrarAnaliticaUso } from "../core/analitica.js";

const MAX_CARACTERES_NOTA = 10000;
const COLORES_NOTA = ["#fff2b3", "#ffd9d9", "#d9f2e6", "#dce8ff", "#f1dcff", "#ffe2c2", "#d9f3f5", "#f3e8d1"];
let timerVaciarPapelera = null;

function notasActuales() { if (!estado.datos) return []; return estado.datos.notas || (estado.datos.notas = []); }
function opcionesNotas() {
  const cfg = estado.datos.configuracion;
  cfg.notas_ajustes ||= { vencimiento_default: false, plazo_default: "3_dias", color_default: COLORES_NOTA[0], vista: "cuadricula", papelera_despues_wapper: false, compartir_accion: "guardar", completadas_al_final: true, colores_recientes: [] };
  return cfg.notas_ajustes;
}
function guardarCambio() {
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
}
function crearNota(datos = {}) {
  const marca = Date.now();
  return sellarTimestamp({
    id: datos.id || `nota_${crypto.randomUUID?.() || marca + "_" + Math.random().toString(36).slice(2)}`,
    titulo: String(datos.titulo || "").slice(0, 180), contenido: sanearHTMLNota(datos.contenido || ""),
    color: datos.color || opcionesNotas().color_default || COLORES_NOTA[0], fijada: Boolean(datos.fijada), orden_fijada: datos.orden_fijada ?? null,
    vence_en: datos.vence_en || null, eliminada_en: null, motivo_eliminacion: null, enviada_a_wapper_en: datos.enviada_a_wapper_en || null,
    origen: datos.origen === "compartida" ? "compartida" : "manual", creada_en: datos.creada_en || marca, modificada_en: marca, _pendienteSync: true,
  });
}
function obtenerNota(id) { return notasActuales().find((n) => n.id === id) || null; }
function guardarNota(nota) {
  const contenido = sanearHTMLNota(nota.contenido || "");
  nota.titulo = String(nota.titulo || "");
  if ((nota.titulo.length + textoPlanoNota(contenido).length) > MAX_CARACTERES_NOTA) throw new Error("La nota supera el límite de 10 000 caracteres.");
  const ahora = Date.now();
  let eraNueva = !nota.id || !obtenerNota(nota.id);
  if (!nota.id) nota = crearNota(nota);
  else {
    const actual = obtenerNota(nota.id);
    if (actual) Object.assign(actual, nota, { contenido, modificada_en: ahora, _pendienteSync: true });
    else nota = crearNota({ ...nota, contenido });
    nota = obtenerNota(nota.id) || nota;
    sellarTimestamp(nota);
  }
  if (!notasActuales().some((n) => n.id === nota.id)) notasActuales().push(nota);
  guardarCambio();
  if (eraNueva) registrarAnaliticaUso("notas", nota.origen === "compartida" ? "Recibir compartido" : "Crear nota");
  return nota;
}
function marcarEliminada(nota, motivo = "manual") {
  const ahora = Date.now();
  Object.assign(nota, { eliminada_en: ahora, motivo_eliminacion: motivo, vence_en: motivo === "vencida" ? nota.vence_en : null, modificada_en: ahora, _pendienteSync: true });
  sellarTimestamp(nota); guardarCambio();
}
function fechaLocalISO(fecha = new Date()) { const y=fecha.getFullYear(),m=String(fecha.getMonth()+1).padStart(2,"0"),d=String(fecha.getDate()).padStart(2,"0");return `${y}-${m}-${d}`; }
function restaurarNota(nota) {
  nota.eliminada_en = null; nota.motivo_eliminacion = null;
  if (nota.vence_en && nota.vence_en <= fechaLocalISO()) nota.vence_en = null;
  nota.modificada_en = Date.now(); nota._pendienteSync = true; sellarTimestamp(nota); guardarCambio();
  registrarAnaliticaUso("notas", "Restaurar nota");
}
function eliminarDefinitiva(nota) {
  estado.datos.notas = notasActuales().filter((n) => n.id !== nota.id);
  estado.datos._eliminados_notas ||= [];
  estado.datos._eliminados_notas.push(sellarTimestamp({ id: nota.id, eliminadoEn: Date.now() }));
  guardarCambio();
}
function procesarCicloVidaNotas(ahora = new Date()) {
  const hoy = fechaLocalISO(ahora);
  let cambio = false;
  for (const nota of notasActuales()) {
    if (!nota.eliminada_en && nota.vence_en && nota.vence_en <= hoy) { marcarEliminada(nota, "vencida"); cambio = true; }
  }
  const umbral = ahora.getTime() - 30 * 86400000;
  const viejas = notasActuales().filter((n) => n.eliminada_en && n.eliminada_en <= umbral);
  viejas.forEach(eliminarDefinitiva);
  if (cambio) window.dispatchEvent(new CustomEvent("notas:actualizadas"));
}
function agendaNotas() {
  clearTimeout(timerVaciarPapelera);
  const siguiente = new Date(); siguiente.setHours(24, 0, 1, 0);
  timerVaciarPapelera = setTimeout(() => { procesarCicloVidaNotas(); agendaNotas(); }, Math.max(1000, siguiente.getTime() - Date.now()));
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) { procesarCicloVidaNotas(); agendaNotas(); } });
window.addEventListener("notas:actualizadas", () => {});

export { MAX_CARACTERES_NOTA, COLORES_NOTA, notasActuales, opcionesNotas, crearNota, obtenerNota, guardarNota, marcarEliminada, restaurarNota, eliminarDefinitiva, procesarCicloVidaNotas, agendaNotas };
