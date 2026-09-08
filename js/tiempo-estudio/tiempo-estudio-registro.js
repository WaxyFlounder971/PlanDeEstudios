/* =========================================================================
   TIEMPO DE ESTUDIO — Registro manual de bloques pasados (Parte 3, punto 1)
   Modal para cargar a mano una sesión que ya pasó (no se hizo con el timer
   ni con Pomodoro). Cuenta EXACTAMENTE igual que una sesión en vivo para
   meta semanal y felicitación — mismo crearSesionEstudio, mismo origen que
   ya contemplaba el comentario de Parte 1 ("manual").

   Sin validación anti-trampa: se puede cargar cualquier fecha/hora, incluso
   futura o duplicada — pedido explícito de Wagner (uso entre amigos,
   confianza total). Lo único que se valida es que la duración sea > 0,
   para no crear sesiones de 0 minutos sin querer.
   ========================================================================= */

import { crearSesionEstudio, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { revisarFelicitacionMeta } from "./tiempo-estudio-timer.js";

/**
 * Abre el modal. `items` es el mismo arreglo que ya arma
 * obtenerMateriasParaTiempoEstudio() en tiempo-estudio.js (se recibe por
 * parámetro, no se recalcula acá, para no crear un import circular solo
 * por esto). `onGuardar` se llama sin argumentos después de guardar, para
 * que quien abrió el modal re-renderice.
 */
function abrirModalRegistroManual(items, onGuardar) {
  if (!items || items.length === 0) {
    mostrarToast("No tenés materias matriculadas en tus semestres actuales");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:420px; width:100%; max-height:85vh; overflow-y:auto; gap:14px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const opcionesMateria = items.map((item) => `<option value="${item.mm.id}">${item.nombreMateria}</option>`).join("");

  const ahora = new Date();
  const fechaHoyStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  const horaHoyStr = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;

  caja.innerHTML = `
    <h2 style="margin:0;">Registrar sesión pasada</h2>

    <div>
      <span class="form-label">Materia</span>
      <select id="te-manual-materia" class="form-input">${opcionesMateria}</select>
    </div>

    <div class="row-between" style="gap:10px;">
      <div style="flex:1;">
        <span class="form-label">Fecha</span>
        <input type="date" id="te-manual-fecha" class="form-input" value="${fechaHoyStr}">
      </div>
      <div style="flex:1;">
        <span class="form-label">Hora de inicio</span>
        <input type="time" id="te-manual-hora" class="form-input" value="${horaHoyStr}">
      </div>
    </div>

    <div class="row-between" style="gap:10px;">
      <div style="flex:1;">
        <span class="form-label">Horas</span>
        <input type="number" id="te-manual-horas" class="form-input" min="0" value="0">
      </div>
      <div style="flex:1;">
        <span class="form-label">Minutos</span>
        <input type="number" id="te-manual-minutos" class="form-input" min="0" max="59" value="30">
      </div>
    </div>

    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-manual-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-manual-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  caja.querySelector("#te-manual-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-manual-guardar").addEventListener("click", () => {
    const materiaMatriculadaId = caja.querySelector("#te-manual-materia").value;
    const fecha = caja.querySelector("#te-manual-fecha").value;
    const hora = caja.querySelector("#te-manual-hora").value;
    const h = Math.max(0, Number(caja.querySelector("#te-manual-horas").value) || 0);
    const m = Math.max(0, Number(caja.querySelector("#te-manual-minutos").value) || 0);
    const minutosTotales = h * 60 + m;

    if (!fecha || !hora) {
      mostrarToast("Completá la fecha y la hora de inicio");
      return;
    }
    if (minutosTotales <= 0) {
      mostrarToast("La duración tiene que ser mayor a 0");
      return;
    }

    const inicio = new Date(`${fecha}T${hora}:00`).getTime();
    const fin = inicio + minutosTotales * 60000;
    const sesion = crearSesionEstudio({ materiaMatriculadaId, inicio, fin, origen: "manual" });
    estado.datos.sesiones_estudio.push(sesion);
    marcarCambioPendiente();
    mostrarToast("Sesión registrada");
    revisarFelicitacionMeta(materiaMatriculadaId);

    cerrar();
    if (onGuardar) onGuardar();
  });
}

/* =========================================================================
   Historial editable de sesiones (pedido 2026-09-07): "todas las sesiones
   deben aparecer como un registro dentro de su propia materia, como
   tarjeta editable (cambiar horas y borrar), debe permitir varios días
   (ej. iniciaste 10pm terminaste 2am)".

   Vive en este archivo (y no en tiempo-estudio.js) porque es la misma
   familia de operación que el registro manual de arriba: las dos tocan
   sesiones de estudio "cerradas" a mano, con el mismo criterio de
   sin-validación-anti-trampa. Edición y borrado usan fecha+hora
   SEPARADAS para inicio y fin (en vez de fecha única + duración, como
   hace el registro manual) — es lo que permite que una sesión cruce
   medianoche sin ningún truco especial: `fin` simplemente cae en el día
   siguiente, la resta de timestamps para `duracion_minutos` no le importa.
   ========================================================================= */

const NOMBRES_DIA_CORTO_REG = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const NOMBRES_MES_CORTO_REG = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatearMinutosReg(minutosTotales) {
  const totales = Math.max(0, Math.round(minutosTotales));
  const h = Math.floor(totales / 60);
  const m = totales % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/** "lun 7 sep · 22:00" — usado para inicio y fin de la fila de una sesión. */
function formatearFechaHoraReg(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${NOMBRES_DIA_CORTO_REG[d.getDay()]} ${d.getDate()} ${NOMBRES_MES_CORTO_REG[d.getMonth()]} · ${hh}:${mm}`;
}

/** Valor para un <input type="date">, en hora local. */
function fechaInputReg(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Valor para un <input type="time">, en hora local. */
function horaInputReg(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Modal de edición — fecha+hora de inicio Y fecha+hora de fin por
 * separado (a diferencia del registro manual de arriba, que solo pide
 * una fecha + duración), justamente para poder mover una punta a otro
 * día sin perder precisión. Guarda in-place sobre el objeto `sesion` (ya
 * está en `estado.datos.sesiones_estudio`, no hace falta buscarlo de
 * nuevo) y re-sella su timestamp para que la sincronización sepa que
 * cambió.
 */
function abrirModalEditarSesion(sesion, refrescar) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:420px; width:100%; max-height:85vh; overflow-y:auto; gap:14px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  caja.innerHTML = `
    <h2 style="margin:0;">Editar sesión</h2>

    <div class="stack" style="gap:6px;">
      <span class="form-label" style="margin:0;">Inicio</span>
      <div class="row-between" style="gap:10px;">
        <input type="date" id="te-editar-fecha-inicio" class="form-input" style="flex:1;" value="${fechaInputReg(sesion.inicio)}">
        <input type="time" id="te-editar-hora-inicio" class="form-input" style="flex:1;" value="${horaInputReg(sesion.inicio)}">
      </div>
    </div>

    <div class="stack" style="gap:6px;">
      <span class="form-label" style="margin:0;">Fin</span>
      <div class="row-between" style="gap:10px;">
        <input type="date" id="te-editar-fecha-fin" class="form-input" style="flex:1;" value="${fechaInputReg(sesion.fin)}">
        <input type="time" id="te-editar-hora-fin" class="form-input" style="flex:1;" value="${horaInputReg(sesion.fin)}">
      </div>
    </div>
    <p class="muted" style="margin:0; font-size:0.78rem;">
      Si terminaste después de medianoche, poné la fecha de fin al día siguiente — se permite cruzar varios días.
    </p>

    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-editar-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-editar-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  caja.querySelector("#te-editar-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-editar-guardar").addEventListener("click", () => {
    const fechaInicio = caja.querySelector("#te-editar-fecha-inicio").value;
    const horaInicio = caja.querySelector("#te-editar-hora-inicio").value;
    const fechaFin = caja.querySelector("#te-editar-fecha-fin").value;
    const horaFin = caja.querySelector("#te-editar-hora-fin").value;

    if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) {
      mostrarToast("Completá las 4 fechas/horas");
      return;
    }

    const inicio = new Date(`${fechaInicio}T${horaInicio}:00`).getTime();
    const fin = new Date(`${fechaFin}T${horaFin}:00`).getTime();

    if (fin <= inicio) {
      mostrarToast("El fin tiene que ser después del inicio (¿te faltó mover la fecha de fin al día siguiente?)");
      return;
    }

    sesion.inicio = inicio;
    sesion.fin = fin;
    sesion.duracion_minutos = Math.max(0, Math.round((fin - inicio) / 60000));
    sellarTimestamp(sesion);
    marcarCambioPendiente();
    revisarFelicitacionMeta(sesion.materia_matriculada_id);
    mostrarToast("Sesión actualizada");

    cerrar();
    if (refrescar) refrescar();
  });
}

function eliminarSesion(sesion, refrescar) {
  abrirConfirmacion({
    titulo: "Borrar sesión",
    mensaje: `¿Borrar esta sesión de ${formatearMinutosReg(sesion.duracion_minutos)}? No se puede deshacer.`,
    textoConfirmar: "Borrar",
    claseConfirmar: "btn-danger",
    onConfirmar: () => {
      const idx = estado.datos.sesiones_estudio.findIndex((s) => s.id === sesion.id);
      if (idx !== -1) estado.datos.sesiones_estudio.splice(idx, 1);
      // Tumba (regla obligatoria de sync, ver MAPA_FUNCIONES.md "Borrado =
      // tumba"): se agrega el id acá y se filtra del arreglo vivo arriba,
      // para que la fusión sepa que el borrado fue intencional.
      estado.datos._eliminados_sesiones_estudio.push(sesion.id);
      marcarCambioPendiente();
      mostrarToast("Sesión borrada");
      if (refrescar) refrescar();
    },
  });
}

/**
 * Lista de sesiones de ESTA matrícula puntual (materiaMatriculadaId),
 * más reciente primero, como tarjetas editables/borrables. Se llama desde
 * la pantalla de detalle de tiempo-estudio.js, después del panel de
 * progreso — nunca en la vista de tarjetas ni en Estadísticas (que es un
 * agregado de todas las materias, no el historial de una sola).
 */
function construirListaSesiones(cont, materiaMatriculadaId, color, refrescar) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.style.gap = "12px";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Sesiones registradas</h3>`;

  const sesiones = (estado.datos.sesiones_estudio || [])
    .filter((s) => s.materia_matriculada_id === materiaMatriculadaId)
    .sort((a, b) => b.inicio - a.inicio);

  if (sesiones.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Todavía no hay sesiones registradas en esta materia.";
    sec.appendChild(vacio);
    cont.appendChild(sec);
    return;
  }

  const ORIGEN_ETIQUETA = { timer: "⏱ Timer", pomodoro: "🍅 Pomodoro", manual: "✍️ Manual" };

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "8px";

  sesiones.forEach((sesion) => {
    const fila = document.createElement("div");
    fila.className = "glass-panel";
    fila.style.cssText = `padding:10px 12px; display:flex; align-items:center; gap:10px; box-shadow: inset 3px 0 0 0 ${color};`;

    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";
    info.innerHTML = `
      <div style="font-size:0.85rem; font-weight:600;">${formatearFechaHoraReg(sesion.inicio)} → ${formatearFechaHoraReg(sesion.fin)}</div>
      <div class="muted" style="font-size:0.78rem;">${formatearMinutosReg(sesion.duracion_minutos)} · ${ORIGEN_ETIQUETA[sesion.origen] || sesion.origen}</div>
    `;

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "te-btn-icono te-btn-icono-fantasma";
    btnEditar.title = "Editar";
    btnEditar.setAttribute("aria-label", "Editar sesión");
    btnEditar.textContent = "✏️";
    btnEditar.addEventListener("click", () => abrirModalEditarSesion(sesion, refrescar));

    const btnBorrar = document.createElement("button");
    btnBorrar.type = "button";
    btnBorrar.className = "te-btn-icono te-btn-icono-fantasma";
    btnBorrar.title = "Borrar";
    btnBorrar.setAttribute("aria-label", "Borrar sesión");
    btnBorrar.textContent = "🗑️";
    btnBorrar.addEventListener("click", () => eliminarSesion(sesion, refrescar));

    fila.appendChild(info);
    fila.appendChild(btnEditar);
    fila.appendChild(btnBorrar);
    lista.appendChild(fila);
  });

  sec.appendChild(lista);
  cont.appendChild(sec);
}

export { abrirModalRegistroManual, construirListaSesiones };
