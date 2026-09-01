/* =========================================================================
   TIEMPO DE ESTUDIO — Modal de configuración por materia (Parte 1)
   Meta de horas semanales + sección "Pomodoro" opcional. Modal 100%
   construido en JS (mismo patrón que el modal de alta/edición de semestre
   en semestres.js) en vez de markup fijo en index.html.
   ========================================================================= */

import { crearConfigPomodoroDefault, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { mostrarToast } from "../ui/componentes.js";

/**
 * Abre el modal de configuración para la materia matriculada `mm`.
 * `onGuardar` se llama después de guardar (sin argumentos) para que quien
 * abrió el modal (tiempo-estudio.js) pueda re-renderizar la tarjeta/detalle
 * correspondiente, sin que este archivo necesite saber nada de tarjetas.
 */
function abrirModalConfigTiempoEstudio(mm, nombreMateria, onGuardar) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:440px; width:100%; max-height:85vh; overflow-y:auto; gap:16px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const usaPomodoroInicial = mm.tiempo_estudio.pomodoro !== null;
  const pomodoroBase = mm.tiempo_estudio.pomodoro || crearConfigPomodoroDefault();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Configurar tiempo de estudio</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">${nombreMateria}</p>
    </div>

    <div>
      <span class="form-label">Meta de horas semanales</span>
      <input type="number" id="te-config-meta" class="form-input" min="0" step="0.5"
        value="${mm.tiempo_estudio.meta_horas_semana ?? ""}" placeholder="Ej. 4">
    </div>

    <div class="row-between" style="align-items:center;">
      <span class="form-label" style="margin:0;">Usar Pomodoro para esta materia</span>
      <label class="switch switch-tema">
        <input type="checkbox" id="te-config-pomodoro-toggle" ${usaPomodoroInicial ? "checked" : ""}>
        <span class="track"><span class="thumb"></span></span>
      </label>
    </div>

    <div id="te-config-pomodoro-campos" class="stack ${usaPomodoroInicial ? "" : "oculto"}" style="gap:12px;">
      <div>
        <span class="form-label">Duración de bloque (min)</span>
        <input type="number" id="te-config-pom-bloque" class="form-input" min="1" value="${pomodoroBase.duracion_bloque_min}">
      </div>
      <div>
        <span class="form-label">Cantidad de bloques</span>
        <input type="number" id="te-config-pom-cantidad" class="form-input" min="1" value="${pomodoroBase.cantidad_bloques}">
      </div>
      <div>
        <span class="form-label">Descanso corto (min)</span>
        <input type="number" id="te-config-pom-descanso-corto" class="form-input" min="0" value="${pomodoroBase.descanso_corto_min}">
      </div>
      <div>
        <span class="form-label">Descanso largo (min)</span>
        <input type="number" id="te-config-pom-descanso-largo" class="form-input" min="0" value="${pomodoroBase.descanso_largo_min}">
      </div>
      <p class="muted" style="font-size:0.78rem; margin:0;">Estos ciclos todavía no se usan en el timer de esta parte (llega en la próxima) — quedan guardados desde ya.</p>
    </div>

    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-config-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-config-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  const togglePomodoro = caja.querySelector("#te-config-pomodoro-toggle");
  const camposPomodoro = caja.querySelector("#te-config-pomodoro-campos");
  togglePomodoro.addEventListener("change", () => {
    camposPomodoro.classList.toggle("oculto", !togglePomodoro.checked);
  });

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  caja.querySelector("#te-config-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-config-guardar").addEventListener("click", () => {
    const metaCruda = caja.querySelector("#te-config-meta").value;
    const meta = metaCruda === "" ? null : Math.max(0, Number(metaCruda));
    mm.tiempo_estudio.meta_horas_semana = Number.isFinite(meta) ? meta : null;

    if (togglePomodoro.checked) {
      mm.tiempo_estudio.pomodoro = {
        duracion_bloque_min: Math.max(1, Number(caja.querySelector("#te-config-pom-bloque").value) || 25),
        cantidad_bloques: Math.max(1, Number(caja.querySelector("#te-config-pom-cantidad").value) || 4),
        descanso_corto_min: Math.max(0, Number(caja.querySelector("#te-config-pom-descanso-corto").value) || 0),
        descanso_largo_min: Math.max(0, Number(caja.querySelector("#te-config-pom-descanso-largo").value) || 0),
      };
    } else {
      mm.tiempo_estudio.pomodoro = null;
    }

    sellarTimestamp(mm);
    marcarCambioPendiente();
    mostrarToast("Configuración guardada");
    cerrar();
    if (onGuardar) onGuardar();
  });
}

export { abrirModalConfigTiempoEstudio };
