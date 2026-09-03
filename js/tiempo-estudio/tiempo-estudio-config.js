/* =========================================================================
   TIEMPO DE ESTUDIO — Modal de configuración por materia (Parte 1)
   Meta de horas semanales + sección "Pomodoro" opcional. Modal 100%
   construido en JS (mismo patrón que el modal de alta/edición de semestre
   en semestres.js) en vez de markup fijo en index.html.
   ========================================================================= */

import { COLOR_TIEMPO_ESTUDIO_DEFAULT, crearConfigPomodoroDefault, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";

/**
 * Pomodoro "de fábrica" de la cuenta (Entrega 2): el que eligió el usuario
 * en Ajustes → Ajustar pomodoro predeterminado, o los valores fijos de
 * crearConfigPomodoroDefault() si todavía no lo tocó nunca. Se usa como
 * semilla la PRIMERA vez que una materia activa Pomodoro (ver
 * abrirModalConfigTiempoEstudio más abajo) — después de esa primera vez,
 * cada materia guarda su propia copia y ya no se toca sola aunque cambie
 * el default global.
 */
function obtenerPomodoroPredeterminado() {
  return estado.datos.configuracion.tiempo_estudio_pomodoro_default || crearConfigPomodoroDefault();
}

/** Los 4 campos de Pomodoro (duración/cantidad/descansos) — mismo markup
 * para el modal por materia y para el modal del default global, así no se
 * duplica ni se desincroniza. */
function construirCamposPomodoro(idPrefijo, base) {
  return `
    <div>
      <span class="form-label">Duración de bloque (min)</span>
      <input type="number" id="${idPrefijo}-bloque" class="form-input" min="1" value="${base.duracion_bloque_min}">
    </div>
    <div>
      <span class="form-label">Cantidad de bloques</span>
      <input type="number" id="${idPrefijo}-cantidad" class="form-input" min="1" value="${base.cantidad_bloques}">
    </div>
    <div>
      <span class="form-label">Descanso corto (min)</span>
      <input type="number" id="${idPrefijo}-descanso-corto" class="form-input" min="0" value="${base.descanso_corto_min}">
    </div>
    <div>
      <span class="form-label">Descanso largo (min)</span>
      <input type="number" id="${idPrefijo}-descanso-largo" class="form-input" min="0" value="${base.descanso_largo_min}">
    </div>
  `;
}

function leerCamposPomodoro(caja, idPrefijo) {
  return {
    duracion_bloque_min: Math.max(1, Number(caja.querySelector(`#${idPrefijo}-bloque`).value) || 25),
    cantidad_bloques: Math.max(1, Number(caja.querySelector(`#${idPrefijo}-cantidad`).value) || 4),
    descanso_corto_min: Math.max(0, Number(caja.querySelector(`#${idPrefijo}-descanso-corto`).value) || 0),
    descanso_largo_min: Math.max(0, Number(caja.querySelector(`#${idPrefijo}-descanso-largo`).value) || 0),
  };
}

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
  const pomodoroBase = mm.tiempo_estudio.pomodoro || obtenerPomodoroPredeterminado();

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
      <span class="form-label" style="margin:0;">Color de la materia</span>
      <input type="color" id="te-config-color" class="form-input"
        value="${mm.tiempo_estudio.color || COLOR_TIEMPO_ESTUDIO_DEFAULT}" style="height:40px; width:64px; padding:4px;">
    </div>

    <div class="row-between" style="align-items:center;">
      <span class="form-label" style="margin:0;">Usar Pomodoro para esta materia</span>
      <label class="switch switch-tema">
        <input type="checkbox" id="te-config-pomodoro-toggle" ${usaPomodoroInicial ? "checked" : ""}>
        <span class="track"><span class="thumb"></span></span>
      </label>
    </div>

    <div id="te-config-pomodoro-campos" class="stack ${usaPomodoroInicial ? "" : "oculto"}" style="gap:12px;">
      ${construirCamposPomodoro("te-config-pom", pomodoroBase)}
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
    mm.tiempo_estudio.color = caja.querySelector("#te-config-color").value || null;

    if (togglePomodoro.checked) {
      mm.tiempo_estudio.pomodoro = leerCamposPomodoro(caja, "te-config-pom");
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

/**
 * Modal para editar el Pomodoro predeterminado GLOBAL (Entrega 2) — vive
 * en la pantalla de Ajustes de Tiempo de Estudio (Entrega 4), botón
 * "Ajustar pomodoro predeterminado". A diferencia del modal por materia,
 * acá no hay meta/color/toggle: siempre está "activo" porque ES el default
 * que se usa cuando una materia prende Pomodoro por primera vez.
 */
function abrirModalPomodoroPredeterminado(onGuardar) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:440px; width:100%; max-height:85vh; overflow-y:auto; gap:16px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const base = obtenerPomodoroPredeterminado();

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Pomodoro predeterminado</h2>
      <p class="muted" style="margin:4px 0 0; font-size:0.85rem;">
        Se usa como punto de partida la primera vez que una materia activa
        Pomodoro. Cambiarlo acá no afecta a las materias que ya tienen su
        propia configuración guardada.
      </p>
    </div>
    <div class="stack" style="gap:12px;">
      ${construirCamposPomodoro("te-default-pom", base)}
    </div>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-default-pom-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-default-pom-guardar" style="flex:1;">Guardar</button>
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
  caja.querySelector("#te-default-pom-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-default-pom-guardar").addEventListener("click", () => {
    estado.datos.configuracion.tiempo_estudio_pomodoro_default = leerCamposPomodoro(caja, "te-default-pom");
    marcarCambioPendiente();
    mostrarToast("Pomodoro predeterminado guardado");
    cerrar();
    if (onGuardar) onGuardar();
  });
}

export { abrirModalConfigTiempoEstudio, abrirModalPomodoroPredeterminado };
