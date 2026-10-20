const NOMBRE_DB = "app-academica-wapper-cola";
const VERSION_DB = 1;
const MAX_ITEMS = 20;
const MAX_BYTES = 15 * 1024 * 1024;

function abrirDB() {
  return new Promise((resolve, reject) => {
    const solicitud = indexedDB.open(NOMBRE_DB, VERSION_DB);
    solicitud.onupgradeneeded = () => {
      const db = solicitud.result;
      if (!db.objectStoreNames.contains("mensajes")) {
        const store = db.createObjectStore("mensajes", { keyPath: "id" });
        store.createIndex("cuenta", "cuenta", { unique: false });
        store.createIndex("creado", "creado", { unique: false });
      }
    };
    solicitud.onsuccess = () => resolve(solicitud.result);
    solicitud.onerror = () => reject(solicitud.error);
  });
}

function operarDB(modo, accion) {
  return abrirDB().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction("mensajes", modo);
    const store = tx.objectStore("mensajes");
    let resultado;
    try { resultado = accion(store); } catch (error) { db.close(); reject(error); return; }
    tx.oncomplete = () => { db.close(); resolve(resultado?.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(tx.error); };
  }));
}

async function listarTodo() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("mensajes", "readonly");
    const solicitud = tx.objectStore("mensajes").getAll();
    solicitud.onsuccess = () => { db.close(); resolve(solicitud.result || []); };
    solicitud.onerror = () => { db.close(); reject(solicitud.error); };
  });
}

async function guardarMensajeWapper(datos) {
  const todos = await listarTodo();
  const propios = todos.filter((item) => item.cuenta === datos.cuenta && !["guardado", "descartado"].includes(item.estado));
  const bytes = propios.reduce((total, item) => total + (item.contenido?.size || new Blob([item.contenido || ""]).size), 0);
  const nuevosBytes = datos.contenido?.size || new Blob([datos.contenido || ""]).size;
  if (propios.length >= MAX_ITEMS || bytes + nuevosBytes > MAX_BYTES) {
    const error = new Error("La cola de Wapper está llena.");
    error.codigo = "cola_llena";
    throw error;
  }
  const item = {
    id: crypto.randomUUID ? crypto.randomUUID() : "wap_" + Date.now() + "_" + Math.random().toString(36).slice(2), cuenta: datos.cuenta, tipo: datos.tipo,
    contenido: datos.contenido, mimeType: datos.mimeType || null,
    creado: Date.now(), actualizado: Date.now(), fechaReferencia: datos.fechaReferencia,
    zonaHoraria: datos.zonaHoraria || Intl.DateTimeFormat().resolvedOptions().timeZone,
    estado: datos.estado || "pendiente", intentos: 0, resultados: [], visto: false,
  };
  await operarDB("readwrite", (store) => store.add(item));
  return item;
}

async function listarMensajesWapper(cuenta) {
  return (await listarTodo()).filter((item) => item.cuenta === cuenta && item.estado !== "descartado").sort((a, b) => a.creado - b.creado);
}

async function actualizarMensajeWapper(id, cambios) {
  const todos = await listarTodo();
  const item = todos.find((actual) => actual.id === id);
  if (!item) return null;
  if (Object.prototype.hasOwnProperty.call(cambios, "contenido")) {
    const contenidoNuevo = cambios.contenido;
    const bytesOtros = todos
      .filter((actual) => actual.cuenta === item.cuenta && actual.id !== id && !["guardado", "descartado"].includes(actual.estado))
      .reduce((total, actual) => total + (actual.contenido?.size || new Blob([actual.contenido || ""]).size), 0);
    const bytesNuevo = contenidoNuevo?.size || new Blob([contenidoNuevo || ""]).size;
    if (!(["guardado", "descartado"].includes(cambios.estado || item.estado)) && bytesOtros + bytesNuevo > MAX_BYTES) {
      const error = new Error("La cola de Wapper está llena.");
      error.codigo = "cola_llena";
      throw error;
    }
  }
  Object.assign(item, cambios);
  item.actualizado = Date.now();
  await operarDB("readwrite", (store) => store.put(item));
  return item;
}

async function descartarMensajeWapper(id) {
  return operarDB("readwrite", (store) => store.delete(id));
}

async function procesarColaWapper(cuenta, procesar) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const todos = await listarMensajesWapper(cuenta);
  const vencidos = todos.filter((item) => item.estado === "procesando" && Date.now() - (item.inicioProceso || 0) > 5 * 60 * 1000);
  for (const item of vencidos) await actualizarMensajeWapper(item.id, { estado: "pendiente" });
  const pendientes = todos.filter((item) => item.estado === "pendiente" || vencidos.some((vencido) => vencido.id === item.id));
  for (const item of pendientes) {
    let intentos = item.intentos || 0;
    while (intentos < 3) {
      intentos++;
      await actualizarMensajeWapper(item.id, { estado: "procesando", inicioProceso: Date.now(), intentos });
      try {
        const resultado = await procesar(item);
        await actualizarMensajeWapper(item.id, {
          estado: resultado.estado || "guardado",
          resultados: resultado.resultados || [],
          motivo: resultado.motivo || null,
          textoOriginal: resultado.textoOriginal || item.textoOriginal || null,
          contenido: resultado.estado === "guardado" || resultado.textoOriginal ? null : item.contenido,
          visto: false,
          procesado: Date.now(), inicioProceso: null,
        });
        break;
      } catch (error) {
        const agotado = intentos >= 3;
        await actualizarMensajeWapper(item.id, {
          estado: agotado ? "error" : "pendiente",
          motivo: error?.message || "No se pudo procesar el mensaje.", inicioProceso: null,
        });
        if (agotado || navigator.onLine === false) break;
        await new Promise((resolve) => setTimeout(resolve, 1000 * (2 ** (intentos - 1))));
      }
    }
    if (navigator.onLine === false) break;
  }
}

export {
  guardarMensajeWapper, listarMensajesWapper, actualizarMensajeWapper,
  descartarMensajeWapper, procesarColaWapper,
};
