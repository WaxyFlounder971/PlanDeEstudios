// Historial global de Notas (Ctrl+Z / Ctrl+Y sobre la lista): eliminar, editar, fijar, duplicar, reordenar, restaurar…
// Una entrada guarda cómo estaban las notas afectadas antes y después. Formato de instantánea: [{ id, nota | null }].
import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { sellarTimestamp } from "../core/schema.js";
import { notasActuales } from "./notas-datos.js";

const MAX = 100;
const pasados = [];
const futuros = [];

const clonar = (n) => (n ? JSON.parse(JSON.stringify(n)) : null);
const sinSync = (n) => { if (!n) return null; const { _pendienteSync, ...resto } = n; return resto; };
const firma = (inst) => JSON.stringify(inst.map((x) => ({ id: x.id, nota: sinSync(x.nota) })));

/** Foto de las notas con esos ids (nota: null si no existen). */
function instantanea(ids) {
  const lista = notasActuales();
  return [...new Set(ids)].map((id) => ({ id, nota: clonar(lista.find((n) => n.id === id)) }));
}

/** Registra un cambio ya hecho: `antes` es la instantánea tomada antes; el "después" se toma ahora. */
function registrarCambio(etiqueta, antes) {
  if (!Array.isArray(antes) || !antes.length) return;
  const despues = instantanea(antes.map((a) => a.id));
  if (firma(antes) === firma(despues)) return;
  pasados.push({ etiqueta, antes, despues });
  if (pasados.length > MAX) pasados.shift();
  futuros.length = 0;
}

/** Ejecuta fn y lo registra en el historial. Acepta funciones async. */
function conHistorial(etiqueta, ids, fn) {
  const antes = instantanea(ids);
  const fin = (r) => { registrarCambio(etiqueta, antes); return r; };
  const r = fn();
  return r && typeof r.then === "function" ? r.then(fin) : fin(r);
}

function aplicar(inst) {
  const datos = estado.datos;
  if (!datos) return;
  for (const { id, nota } of inst) {
    const lista = notasActuales();
    const i = lista.findIndex((n) => n.id === id);
    if (nota) {
      datos._eliminados_notas = (datos._eliminados_notas || []).filter((x) => x.id !== id);
      const copia = clonar(nota);
      copia._pendienteSync = true;
      if (i >= 0) {
        const actual = lista[i];
        Object.keys(actual).forEach((k) => delete actual[k]);
        Object.assign(actual, copia);
        sellarTimestamp(actual);
      } else lista.push(sellarTimestamp(copia));
    } else if (i >= 0) {
      datos.notas = lista.filter((n) => n.id !== id);
      datos._eliminados_notas ||= [];
      if (!datos._eliminados_notas.some((x) => x.id === id)) datos._eliminados_notas.push(sellarTimestamp({ id, eliminadoEn: Date.now() }));
    }
  }
  sellarTimestamp(datos.configuracion);
  marcarCambioPendiente();
  window.dispatchEvent(new CustomEvent("notas:actualizadas"));
}

/** Devuelve la etiqueta de lo deshecho, o null si no había nada. */
function deshacer() {
  const e = pasados.pop();
  if (!e) return null;
  aplicar(e.antes);
  futuros.push(e);
  return e.etiqueta;
}

function rehacer() {
  const e = futuros.pop();
  if (!e) return null;
  aplicar(e.despues);
  pasados.push(e);
  return e.etiqueta;
}

export { instantanea, registrarCambio, conHistorial, deshacer, rehacer };
