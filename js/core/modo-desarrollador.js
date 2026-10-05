/**
 * Modo desarrollador (2026-10-05). Se activa/desactiva manteniendo presionado
 * ~10 s el número de versión (#pie-version, al final de Ajustes/menú). Con el
 * modo activo, tocar la versión abre un panel con botones de prueba.
 *
 * Otros módulos pueden sumar sus propios botones sin editar este archivo:
 *   registrarBotonDesarrollador({ id, grupo, etiqueta, accion })
 * `accion` puede ser async; si lanza, se muestra el error en un aviso.
 *
 * La preferencia vive en localStorage (por dispositivo, no se sincroniza). En
 * demo el almacenamiento está neutralizado: se mantiene solo en memoria.
 */
import { mostrarToast } from "../ui/componentes.js";
import { estado } from "./storage.js";

const CLAVE = "modo_desarrollador_v1";
const MS_PRESION = 10000;
const botones = [];
const generadores = []; // funciones que devuelven botones según el estado actual
let activoEnMemoria = false;

function leerActivo() {
  try { return localStorage.getItem(CLAVE) === "1" || activoEnMemoria; } catch (_) { return activoEnMemoria; }
}
function guardarActivo(valor) {
  activoEnMemoria = valor;
  try { valor ? localStorage.setItem(CLAVE, "1") : localStorage.removeItem(CLAVE); } catch (_) { /* demo o sin espacio */ }
}

function registrarBotonDesarrollador(boton) {
  if (!boton?.id || botones.some((b) => b.id === boton.id)) return;
  botones.push(boton);
}

/** Para botones que dependen de los datos (ej. uno por semestre): `fn()` se
 *  evalúa cada vez que se abre el panel y devuelve [{id,grupo,etiqueta,accion}]. */
function registrarGeneradorBotonesDesarrollador(fn) { generadores.push(fn); }

function modoDesarrolladorActivo() { return leerActivo(); }

/* ---------- Botones incluidos ---------- */
function registrarBotonesBase() {
  const resultado = (tipo) => ({
    tipo, nombreCompetencia: "Competencia de prueba", apodoGanador: "Tú", horas: 12.5, esPrueba: true,
  });
  registrarBotonDesarrollador({ id: "comp-victoria", grupo: "Competencias", etiqueta: "🏆 Simular victoria", accion: async () => {
    const { mostrarCelebracionResultado } = await import("../tiempo-estudio/tiempo-estudio-celebracion.js");
    mostrarCelebracionResultado(resultado("victoria"), () => {});
  } });
  registrarBotonDesarrollador({ id: "comp-derrota", grupo: "Competencias", etiqueta: "😔 Simular derrota", accion: async () => {
    const { mostrarCelebracionResultado } = await import("../tiempo-estudio/tiempo-estudio-celebracion.js");
    mostrarCelebracionResultado(resultado("derrota"), () => {});
  } });
  registrarBotonDesarrollador({ id: "sync-forzar", grupo: "Conexión y sincronización", etiqueta: "🔄 Forzar sincronización", accion: async () => {
    const { forzarSincronizacion } = await import("./storage-sync.js");
    await forzarSincronizacion();
  } });
  registrarBotonDesarrollador({ id: "sync-reconexion", grupo: "Conexión y sincronización", etiqueta: "📡 Probar reconexión escalonada", accion: async () => {
    const { recuperarConexionEscalonada } = await import("./storage-sync.js");
    const ok = await recuperarConexionEscalonada();
    mostrarToast(ok ? "Reconexión lograda." : "No se logró reconectar (revisa el indicador).");
  } });
  registrarGeneradorBotonesDesarrollador(() => (estado.datos?.semestres || []).map((s) => ({
    id: `wrapped-${s.id}`, grupo: "Wrapped por semestre", etiqueta: `🎁 Wrapped · ${s.nombre || "Semestre"}`,
    accion: async () => {
      const { mostrarWrappedSemestre } = await import("../semestres/semestres-wrapped.js");
      document.getElementById("panel-desarrollador")?.remove();
      mostrarWrappedSemestre(s.id, { automatico: false });
    },
  })));
  const racha = (tipo) => async () => {
    const { abrirOverlayRacha, obtenerEstadoRacha } = await import("../tiempo-estudio/tiempo-estudio-racha-ui.js");
    const est = obtenerEstadoRacha();
    document.getElementById("panel-desarrollador")?.remove();
    if (tipo === "inicio") abrirOverlayRacha({ tipo, est: { ...est, racha: 1, inicioISO: null }, desde: 0, hasta: 1 });
    else abrirOverlayRacha({ tipo, est: { ...est, rachaPerdida: null } });
  };
  registrarBotonDesarrollador({ id: "racha-inicio", grupo: "Racha de estudio", etiqueta: "🔥 Ver aviso: racha iniciada", accion: racha("inicio") });
  registrarBotonDesarrollador({ id: "racha-perdida", grupo: "Racha de estudio", etiqueta: "💔 Ver aviso: racha perdida", accion: racha("perdida") });
  registrarBotonDesarrollador({ id: "racha-detalle", grupo: "Racha de estudio", etiqueta: "📅 Abrir detalle de racha", accion: async () => {
    const { abrirDetalleRacha } = await import("../tiempo-estudio/tiempo-estudio-racha-ui.js");
    document.getElementById("panel-desarrollador")?.remove();
    abrirDetalleRacha();
  } });
  registrarBotonDesarrollador({ id: "app-info", grupo: "App", etiqueta: "📋 Copiar info de depuración", accion: async () => {
    const info = [
      `Versión: ${document.getElementById("pie-version")?.textContent || "?"}`,
      `En línea: ${navigator.onLine}`,
      `Sesión guardada: ${(() => { try { return !!localStorage.getItem("google_refresh_token"); } catch (_) { return "?"; } })()}`,
      `Navegador: ${navigator.userAgent}`,
    ].join("\n");
    await navigator.clipboard?.writeText(info);
    mostrarToast("Info copiada.");
  } });
  registrarBotonDesarrollador({ id: "app-recargar", grupo: "App", etiqueta: "♻️ Recargar sin caché", accion: async () => {
    const regs = await navigator.serviceWorker?.getRegistrations?.() || [];
    await Promise.all(regs.map((r) => r.unregister()));
    if (window.caches) await Promise.all((await caches.keys()).map((k) => caches.delete(k)));
    location.reload();
  } });
}

/* ---------- Panel ---------- */
function abrirPanelDesarrollador() {
  document.getElementById("panel-desarrollador")?.remove();
  const overlay = document.createElement("div");
  overlay.id = "panel-desarrollador";
  overlay.className = "modal-overlay";
  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card modal-card stack";
  tarjeta.style.position = "relative";
  const cerrar = document.createElement("button");
  cerrar.type = "button"; cerrar.className = "modal-x-close"; cerrar.textContent = "✕"; cerrar.setAttribute("aria-label", "Cerrar");
  cerrar.addEventListener("click", () => overlay.remove());
  const titulo = document.createElement("h2");
  titulo.style.margin = "0"; titulo.textContent = "🛠️ Modo desarrollador";
  tarjeta.append(cerrar, titulo);

  const grupos = new Map();
  [...botones, ...generadores.flatMap((g) => { try { return g() || []; } catch (_) { return []; } })].forEach((b) => { const g = b.grupo || "Otros"; if (!grupos.has(g)) grupos.set(g, []); grupos.get(g).push(b); });
  grupos.forEach((lista, nombre) => {
    const bloque = document.createElement("div");
    bloque.className = "stack"; bloque.style.gap = "6px";
    const h = document.createElement("span");
    h.className = "form-label"; h.textContent = nombre;
    bloque.append(h);
    lista.forEach((b) => {
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn btn-secondary"; btn.textContent = b.etiqueta;
      btn.addEventListener("click", async () => {
        try { await b.accion(); } catch (e) { console.error(e); mostrarToast(`Error: ${e?.message || e}`); }
      });
      bloque.append(btn);
    });
    tarjeta.append(bloque);
  });

  const salir = document.createElement("button");
  salir.type = "button"; salir.className = "btn btn-secondary"; salir.textContent = "Desactivar modo desarrollador";
  salir.addEventListener("click", () => { guardarActivo(false); overlay.remove(); mostrarToast("Modo desarrollador desactivado."); });
  tarjeta.append(salir);

  overlay.append(tarjeta);
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) overlay.remove(); });
  document.body.append(overlay);
}

/* ---------- Activación por presión larga ---------- */
function inicializarModoDesarrollador() {
  const pie = document.getElementById("pie-version");
  if (!pie || pie.dataset.devListo === "1") return;
  pie.dataset.devListo = "1";
  registrarBotonesBase();
  pie.style.userSelect = "none";
  pie.style.webkitUserSelect = "none";
  pie.style.touchAction = "manipulation";

  let temporizador = null, disparo = false;
  const cancelar = () => { clearTimeout(temporizador); temporizador = null; };
  pie.addEventListener("pointerdown", () => {
    disparo = false;
    cancelar();
    temporizador = setTimeout(() => {
      disparo = true;
      if (leerActivo()) { guardarActivo(false); mostrarToast("Modo desarrollador desactivado."); return; }
      guardarActivo(true);
      mostrarToast("🛠️ Modo desarrollador activado. Toca la versión para abrir el panel.");
      abrirPanelDesarrollador();
    }, MS_PRESION);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((n) => pie.addEventListener(n, cancelar));
  pie.addEventListener("contextmenu", (ev) => ev.preventDefault());
  pie.addEventListener("click", () => {
    if (disparo) { disparo = false; return; }
    if (leerActivo()) abrirPanelDesarrollador();
  });
}

export { abrirPanelDesarrollador, inicializarModoDesarrollador, modoDesarrolladorActivo, registrarBotonDesarrollador, registrarGeneradorBotonesDesarrollador };
