/* =========================================================================
   PORTAPAPELES — blindaje del flujo "Enviar a Claude/ChatGPT"
   -------------------------------------------------------------------------
   Motivo (bug urgente reportado): navigator.clipboard.writeText() puede
   fallar sin que el usuario se entere — el flujo anterior solo dejaba un
   console.warn si fallaba, y como acto seguido se abre una pestaña nueva
   (que roba el foco), la persona nunca ve ningún aviso. Pega en la IA, no
   hay nada, y no tiene ninguna pista de qué pasó ni cómo recuperarse.

   Este archivo concentra las DOS capas de blindaje pedidas:
   1) comprobarPermisoPortapapelesAlIniciar(): se llama UNA vez, justo
      después de un login exitoso (ver main.js), y deja el resultado
      guardado en estado.permisoPortapapeles para poder avisar temprano.
   2) copiarAlPortapapelesBlindado(): reemplaza a la función vieja
      (copiarPromptImportacion en plan-importacion.js) — verifica que la
      copia SÍ ocurrió (no solo que no lanzó excepción) y, si falla o no se
      puede confirmar, muestra el prompt en un modal para copiarlo a mano,
      en vez de dejar al usuario sin ninguna salida.
   ========================================================================= */

import { estado } from "./storage.js";
import { mostrarToast } from "../ui/componentes.js";

/* ===================== Modal de copia manual (autocontenido) =====================
 * A propósito NO depende de ningún elemento nuevo en index.html: se crea e
 * inserta en el DOM la primera vez que hace falta (mismo patrón que ya usan
 * otros overlays dinámicos del proyecto, ej. mostrarToast). Así el blindaje
 * queda 100% contenido en este archivo — nada que agregar a mano en el HTML,
 * nada que se pueda desincronizar entre este módulo y el marcado real.
 */

let modalCopiaManualEl = null;

function construirModalCopiaManualSiHaceFalta() {
  if (modalCopiaManualEl) return modalCopiaManualEl;

  const overlay = document.createElement("div");
  overlay.id = "modal-copia-manual-portapapeles";
  overlay.className = "modal-overlay oculto";
  overlay.style.position = "fixed";
  overlay.style.inset = "0";
  overlay.style.zIndex = "9999";
  overlay.style.display = "flex";
  overlay.style.alignItems = "center";
  overlay.style.justifyContent = "center";
  overlay.style.background = "rgba(0,0,0,0.55)";
  overlay.style.backdropFilter = "blur(4px)";

  overlay.innerHTML = `
    <div class="glass-card stack" style="max-width:560px;width:92%;max-height:80vh;overflow:auto;">
      <h2 style="margin:0;">⚠️ No se pudo copiar el prompt automáticamente</h2>
      <p class="muted">
        Tu navegador bloqueó la copia automática al portapapeles. Selecciona
        todo el texto de abajo y cópialo a mano (Ctrl+C / Cmd+C) antes de
        continuar a la IA.
      </p>
      <textarea id="textarea-copia-manual-portapapeles" class="form-textarea" rows="10" readonly
        style="width:100%;font-family:monospace;font-size:12px;"></textarea>
      <div class="row">
        <button type="button" id="btn-seleccionar-todo-copia-manual" class="btn btn-secondary" style="flex:1;">
          Seleccionar todo
        </button>
        <button type="button" id="btn-cerrar-copia-manual" class="btn btn-primary" style="flex:1;">
          Ya lo copié, cerrar
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  const cerrar = () => overlay.classList.add("oculto");
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  overlay.querySelector("#btn-cerrar-copia-manual").addEventListener("click", cerrar);
  overlay.querySelector("#btn-seleccionar-todo-copia-manual").addEventListener("click", () => {
    const ta = overlay.querySelector("#textarea-copia-manual-portapapeles");
    ta.focus();
    ta.select();
  });

  modalCopiaManualEl = overlay;
  return overlay;
}

/**
 * Muestra el prompt completo en un textarea de solo lectura, ya seleccionado,
 * para que como último recurso el usuario lo copie a mano con su propio
 * atajo de teclado — nunca lo deja sin ninguna salida cuando ambos métodos
 * automáticos (API moderna + execCommand de respaldo) fallan.
 */
function abrirModalCopiaManualPortapapeles(texto) {
  const overlay = construirModalCopiaManualSiHaceFalta();
  const ta = overlay.querySelector("#textarea-copia-manual-portapapeles");
  ta.value = texto;
  overlay.classList.remove("oculto");
  setTimeout(() => {
    ta.focus();
    ta.select();
  }, 50);
}

/**
 * Se llama una vez, justo después de onLoginExitoso (ver main.js). No
 * bloquea nada del login ni de mostrarApp() — es enteramente informativo,
 * para que el aviso llegue lo antes posible en vez de recién al momento de
 * enviar un prompt a la IA (que puede ser mucho después, o nunca, si el
 * usuario no importa ningún plan).
 *
 * La Permissions API de "clipboard-write" no está soportada en todos los
 * navegadores (Safari y Firefox, notablemente, no la exponen) — en ese caso
 * no hay forma de saber el estado de antemano sin intentar copiar algo de
 * verdad, así que se guarda "desconocido" y el blindaje real recae por
 * completo en copiarAlPortapapelesBlindado() al momento de usarlo.
 */
async function comprobarPermisoPortapapelesAlIniciar() {
  try {
    if (!navigator.permissions || !navigator.permissions.query) {
      estado.permisoPortapapeles = "desconocido";
      return;
    }
    const resultado = await navigator.permissions.query({ name: "clipboard-write" });
    estado.permisoPortapapeles = resultado.state === "granted" ? "otorgado"
      : resultado.state === "denied" ? "denegado"
      : "desconocido"; // "prompt": se decide en el momento real de copiar
    // Si el usuario cambia el permiso desde la configuración del navegador
    // mientras la pestaña sigue abierta, se refleja sin tener que recargar.
    resultado.onchange = () => {
      estado.permisoPortapapeles = resultado.state === "granted" ? "otorgado"
        : resultado.state === "denied" ? "denegado"
        : "desconocido";
    };
  } catch (e) {
    // Navegador que no reconoce "clipboard-write" como nombre de permiso
    // (ej. Firefox lanza TypeError en vez de devolver "prompt") — no es un
    // error real de la app, solo falta de soporte de esa API puntual.
    estado.permisoPortapapeles = "desconocido";
  }
}

/**
 * Copia blindada: a diferencia de la función vieja, SIEMPRE resuelve con
 * un booleano real (nunca deja la falla en silencio dentro de un catch que
 * solo loguea). Estrategia en 2 pasos:
 *   1) Intenta navigator.clipboard.writeText() (API moderna, la que ya
 *      existía). Si tira excepción, se considera fallo.
 *   2) Si falló, intenta el método viejo de respaldo (execCommand("copy")
 *      sobre un <textarea> temporal) — sigue funcionando en más casos que
 *      la API moderna, especialmente cuando el permiso fue denegado
 *      explícitamente para la API nueva pero el gesto de usuario todavía
 *      es válido para el comando viejo.
 * Ninguno de los dos pasos garantiza éxito al 100% (algunos navegadores
 * bloquean ambos) — por eso quien llama a esta función SIEMPRE debe ofrecer
 * también la copia manual como último recurso (ver abrirModalCopiaManual).
 */
async function copiarAlPortapapelesBlindado(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch (e) {
    console.warn("[portapapeles] Falló navigator.clipboard.writeText, probando respaldo:", e);
  }

  try {
    const textareaTemp = document.createElement("textarea");
    textareaTemp.value = texto;
    // Fuera de la vista pero seleccionable — hace falta que esté en el DOM
    // real para que execCommand("copy") funcione.
    textareaTemp.style.position = "fixed";
    textareaTemp.style.top = "-9999px";
    textareaTemp.style.left = "-9999px";
    document.body.appendChild(textareaTemp);
    textareaTemp.focus();
    textareaTemp.select();
    const exito = document.execCommand("copy");
    document.body.removeChild(textareaTemp);
    if (exito) return true;
  } catch (e) {
    console.warn("[portapapeles] Falló también el respaldo execCommand('copy'):", e);
  }

  return false;
}

/**
 * Punto único que debe usar el resto de la app para copiar el prompt de
 * importación (reemplaza a copiarPromptImportacion). Muestra un toast de
 * éxito si la copia se confirmó; si falló por completo (ni la API moderna
 * ni el respaldo execCommand funcionaron), abre el modal de copia manual
 * autocontenido de este mismo archivo — el usuario SIEMPRE tiene una forma
 * de llevarse el prompt, sin depender de que el portapapeles automático
 * haya funcionado, y sin que nada quede en un console.warn silencioso.
 */
async function copiarPromptConAviso(texto) {
  const exito = await copiarAlPortapapelesBlindado(texto);
  if (exito) {
    mostrarToast("✓ Prompt copiado en el portapapeles");
    return true;
  }
  console.warn("[portapapeles] No se pudo copiar automáticamente por ningún método — se muestra el modal de copia manual.");
  abrirModalCopiaManualPortapapeles(texto);
  return false;
}

export {
  abrirModalCopiaManualPortapapeles,
  comprobarPermisoPortapapelesAlIniciar,
  copiarAlPortapapelesBlindado,
  copiarPromptConAviso,
};
