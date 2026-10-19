import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { sellarTimestamp } from "../core/schema.js";
import { sanearHTMLNota, textoPlanoNota } from "./notas-sanitizar.js";
import { registrarAnaliticaUso } from "../core/analitica.js";

const MAX_CARACTERES_NOTA = 10000;
// Paleta base (modo claro): tonos de notas adhesivas.
const COLORES_NOTA = ["#fd97a5", "#ffbd9d", "#fff594", "#c6d4a1", "#bcdad0", "#a8dcda"];
const COLOR_DEFECTO = "#fff594";
// Misma tonalidad y saturación, solo más oscuro (no gris ni apagado).
function luminanciaHex(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function hslAHex(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [R, G, B] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return "#" + [R, G, B].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, "0")).join("");
}
function aOscuroSuave(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  const l0 = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  // Se oscurece, pero sin bajar de una luminancia que permita texto oscuro legible (igual que los colores claros).
  let f = 0.58, salida = hslAHex(h, s * 0.8, l0 * f);
  while (luminanciaHex(salida) < 0.27 && f < 1) { f += 0.02; salida = hslAHex(h, s * 0.8, l0 * f); }
  return salida;
}
// Variantes oscuras de versiones anteriores: las notas ya guardadas con ellas siguen mapeándose a su predefinido.
const OSCUROS_ANTERIORES = [
  ["#cf1b34", "#d75618", "#d2c117", "#7b8c4c", "#5b917f", "#4a9794"],
  ["#e63d54", "#d75618", "#d2c117", "#7b8c4c", "#5b917f", "#4a9794"],
];
// Modo oscuro: una versión MÁS FUERTE de cada color de la paleta (mismo tono), pensada para letra y tinta claras
// (contraste con blanco ≥ 4.9). Es el opuesto de los tonos suaves del modo claro, que llevan letra oscura.
const COLORES_NOTA_OSCURO = ["#cd1932", "#b04816", "#826f00", "#5a7020", "#22765a", "#1a7471"];
function modoOscuro() { const modo = document.documentElement.getAttribute("data-mode"); return modo === "dark" || modo === "true-dark"; }
function coloresPaletaNota() { return modoOscuro() ? COLORES_NOTA_OSCURO : COLORES_NOTA; }
// Si el color guardado es uno de los predefinidos (claro u oscuro), lo muestra en la versión del modo actual.
function resolverColorNota(hex) {
  const claros = COLORES_NOTA, oscuros = COLORES_NOTA_OSCURO, suaves = COLORES_NOTA.map(aOscuroSuave); // "suaves": oscuros de la versión anterior
  hex = String(hex || "").toLowerCase();
  let i = claros.indexOf(hex);
  if (i < 0) i = oscuros.indexOf(hex);
  if (i < 0) i = suaves.indexOf(hex);
  if (i < 0) for (const lista of OSCUROS_ANTERIORES) { const k = lista.indexOf(hex); if (k >= 0) { i = k; break; } }
  return i >= 0 ? coloresPaletaNota()[i] : hex;
}
let timerVaciarPapelera = null;

function notasActuales() { if (!estado.datos) return []; return estado.datos.notas || (estado.datos.notas = []); }
function opcionesNotas() {
  const cfg = estado.datos.configuracion;
  cfg.notas_ajustes ||= { vencimiento_default: false, plazo_default: "3_dias", color_default: COLOR_DEFECTO, vista: "cuadricula", papelera_despues_wapper: false, compartir_accion: "guardar", completadas_al_final: true, colores_recientes: [] };
  if (cfg.notas_ajustes.color_default === "#fff2b3") cfg.notas_ajustes.color_default = COLOR_DEFECTO;
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
    color: datos.color || resolverColorNota(opcionesNotas().color_default) || COLOR_DEFECTO, fijada: Boolean(datos.fijada), orden_fijada: datos.orden_fijada ?? null,
    vence_en: datos.vence_en || null, eliminada_en: null, motivo_eliminacion: null, enviada_a_wapper_en: datos.enviada_a_wapper_en || null,
    tinta: Array.isArray(datos.tinta) ? JSON.parse(JSON.stringify(datos.tinta)) : [], origen: datos.origen === "compartida" ? "compartida" : "manual", creada_en: datos.creada_en || marca, modificada_en: marca, _pendienteSync: true,
  });
}
function obtenerNota(id) { return notasActuales().find((n) => n.id === id) || null; }
function guardarNota(nota) {
  const contenido = sanearHTMLNota(nota.contenido || "");
  nota.titulo = String(nota.titulo || "");
  if ((nota.titulo.length + textoPlanoNota(contenido).length) > MAX_CARACTERES_NOTA) throw new Error("La nota supera el límite de 10 000 caracteres.");
  const ahora = Date.now();
  const modManual = nota._mod_manual === true && Number.isFinite(nota.modificada_en), modValor = nota.modificada_en;
  delete nota._mod_manual;
  let eraNueva = !nota.id || !obtenerNota(nota.id);
  if (!nota.id) nota = crearNota(nota);
  else {
    const actual = obtenerNota(nota.id);
    if (actual) Object.assign(actual, nota, { contenido, modificada_en: modManual ? modValor : ahora, _pendienteSync: true });
    else { nota = crearNota({ ...nota, contenido }); if (modManual) nota.modificada_en = modValor; }
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

export { MAX_CARACTERES_NOTA, COLORES_NOTA, COLORES_NOTA_OSCURO, COLOR_DEFECTO, resolverColorNota, coloresPaletaNota, notasActuales, opcionesNotas, crearNota, obtenerNota, guardarNota, marcarEliminada, restaurarNota, eliminarDefinitiva, procesarCicloVidaNotas, agendaNotas };
