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

import { crearSesionEstudio } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
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

export { abrirModalRegistroManual };
