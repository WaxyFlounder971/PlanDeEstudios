/* =========================================================================
   GOOGLE TASKS — UI de confirmación (checkboxes)
   -------------------------------------------------------------------------
   Botón "Buscar tareas nuevas" en Ajustes > Google Tasks. Llama a
   obtenerPropuestasGoogleTasks() (agenda-google-tasks.js), muestra una
   lista simple con checkboxes (todos marcados por defecto) y, al confirmar,
   llama a confirmarTareasGoogleImportadas() con lo que quedó tildado.

   Construido con document.createElement puro (mismo patrón que el resto de
   config-ajustes.js) — no depende de ningún componente de modal genérico
   nuevo, para poder probarse ya mismo sin tocar más archivos.
   ========================================================================= */

import { obtenerPropuestasGoogleTasks, confirmarTareasGoogleImportadas } from "./agenda-google-tasks.js";
import { mostrarToast } from "../ui/componentes.js";

function crearOverlay() {
  const overlay = document.createElement("div");
  overlay.id = "overlay-google-tasks-confirmar";
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(0,0,0,0.55); z-index:99999; display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:420px; width:100%; max-height:80vh; overflow-y:auto; padding:16px; gap:12px;";
  overlay.appendChild(caja);

  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });

  return { overlay, caja };
}

async function abrirConfirmacionGoogleTasks() {
  const btn = document.getElementById("btn-google-tasks-buscar");
  const textoOriginal = btn ? btn.textContent : null;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Buscando…";
  }

  let propuestas;
  try {
    propuestas = await obtenerPropuestasGoogleTasks();
  } catch (e) {
    console.warn("No se pudieron traer las tareas de Google Tasks:", e);
    mostrarToast("No se pudo conectar con Google Tasks. Intentá de nuevo.");
    if (btn) {
      btn.disabled = false;
      btn.textContent = textoOriginal;
    }
    return;
  }

  if (btn) {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }

  if (propuestas.length === 0) {
    mostrarToast("No hay tareas nuevas en Google Tasks.");
    return;
  }

  const { overlay, caja } = crearOverlay();

  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = `Se encontraron ${propuestas.length} tarea${propuestas.length === 1 ? "" : "s"} nueva${propuestas.length === 1 ? "" : "s"}`;
  caja.appendChild(titulo);

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "8px";

  propuestas.forEach((p) => {
    const fila = document.createElement("label");
    fila.style.cssText = "display:flex; align-items:center; gap:10px; padding:8px; border:1px solid var(--color-borde); border-radius:8px; cursor:pointer;";

    const chk = document.createElement("input");
    chk.type = "checkbox";
    chk.checked = true;
    chk.dataset.googleTaskId = p.googleTaskId;

    const texto = document.createElement("span");
    texto.style.flex = "1";
    texto.textContent = p.fecha ? `${p.nombre} — ${p.fecha}` : p.nombre;

    fila.appendChild(chk);
    fila.appendChild(texto);
    lista.appendChild(fila);
  });
  caja.appendChild(lista);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.cssText = "gap:8px; justify-content:flex-end; margin-top:4px;";

  const btnCancelar = document.createElement("button");
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.onclick = () => overlay.remove();

  const btnImportar = document.createElement("button");
  btnImportar.className = "btn btn-primary";
  btnImportar.textContent = "Importar seleccionadas";
  btnImportar.onclick = () => {
    const idsConfirmados = Array.from(lista.querySelectorAll("input[type=checkbox]:checked")).map(
      (chk) => chk.dataset.googleTaskId
    );
    confirmarTareasGoogleImportadas(propuestas, idsConfirmados);
    overlay.remove();
    mostrarToast(
      idsConfirmados.length > 0
        ? `Se importaron ${idsConfirmados.length} tarea${idsConfirmados.length === 1 ? "" : "s"}.`
        : "No se importó ninguna tarea."
    );
  };

  filaBotones.appendChild(btnCancelar);
  filaBotones.appendChild(btnImportar);
  caja.appendChild(filaBotones);

  document.body.appendChild(overlay);
}

/**
 * Engancha el botón "Buscar tareas nuevas" dentro del bloque de Google
 * Tasks en Ajustes (ver #bloque-google-tasks-lista en index.html — el
 * botón debe crearse ahí, con id="btn-google-tasks-buscar"). Idempotente
 * (usa .onclick, no addEventListener) — se puede llamar en cada
 * renderizarAjustes() sin duplicar el listener.
 */
function inicializarBotonGoogleTasksBuscar() {
  const btn = document.getElementById("btn-google-tasks-buscar");
  if (!btn) return;
  btn.onclick = abrirConfirmacionGoogleTasks;
}

export { inicializarBotonGoogleTasksBuscar };
