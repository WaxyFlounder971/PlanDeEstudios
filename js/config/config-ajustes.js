/* =========================================================================
   CONFIGURACIÓN — AJUSTES GENERALES
   Paletas, modo claro/oscuro, escala de notas, formato de texto.
   ========================================================================= */

import { PALETAS_DISPONIBLES } from "../core/schema.js";
import { actualizarIndicadorSync, marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";
import { COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO, TEXTO_PREVIEW_PALETA, aplicarPaleta } from "../ui/tema.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";

/* ------------------------------ Ajustes ------------------------------ */

/**
 * v1.14.1: aplica (o quita) el atributo data-rendimiento en <html>, mismo
 * patrón que data-palette/data-mode. Se exporta para poder llamarla también
 * al iniciar la app (antes de que el usuario entre a Ajustes), leyendo
 * estado.datos.configuracion.modo_rendimiento ya cargado.
 */
function aplicarModoRendimiento(activo) {
  document.documentElement.setAttribute("data-rendimiento", activo ? "reducido" : "normal");
}

function renderizarAjustes() {
  // Paletas — cada cuadro muestra su propio color real (punto 3)
  const grid = document.getElementById("grid-paletas");
  grid.innerHTML = "";
  PALETAS_DISPONIBLES.forEach((paleta) => {
    const sw = document.createElement("div");
    sw.className = "palette-swatch" + (paleta === estado.datos.configuracion.paleta ? " selected" : "");
    sw.style.background = paleta === "azucarado"
      ? FONDO_PREVIEW_AZUCARADO
      : `linear-gradient(135deg, ${COLORES_PREVIEW_PALETA[paleta].join(", ")})`;
    sw.style.color = TEXTO_PREVIEW_PALETA[paleta] || "#ffffff";
    sw.setAttribute("data-palette-preview", paleta);
    sw.textContent = paleta;
    sw.addEventListener("click", () => {
      estado.datos.configuracion.paleta = paleta;
      aplicarPaleta(paleta, estado.datos.configuracion.modo);
      marcarCambioPendiente();
      renderizarAjustes();
    });
    grid.appendChild(sw);
  });

  // v1.13: 15ª opción — "+ Crear mi paleta". Si el usuario ya tiene una
  // guardada, el cuadro muestra su propio degradado (accent1 → accent2) y
  // queda marcado como seleccionado igual que cualquier otra paleta; si
  // todavía no existe, muestra un degradado arcoíris invitando a crearla.
  const personalizada = estado.datos.configuracion.paleta_personalizada;
  const swPersonalizada = document.createElement("div");
  swPersonalizada.className = "palette-swatch ppz-swatch-crear"
    + (estado.datos.configuracion.paleta === "personalizada" ? " selected" : "");
  swPersonalizada.style.background = personalizada
    ? `linear-gradient(135deg, ${personalizada.colores.accent1}, ${personalizada.colores.accent2})`
    : "linear-gradient(135deg, #ef4444, #f59e0b, #22c55e, #06b6d4, #6366f1, #d946ef)";
  swPersonalizada.textContent = personalizada ? "personalizada" : "+ Crear mi paleta";
  swPersonalizada.addEventListener("click", () => {
    if (personalizada) {
      // Ya existe una guardada: un clic la activa directamente, igual que
      // cualquier otro cuadro del grid — para editarla de nuevo desde cero
      // se vuelve a entrar por el flujo completo con el botón de abajo.
      estado.datos.configuracion.paleta = "personalizada";
      aplicarPaleta("personalizada", estado.datos.configuracion.modo, personalizada.colores);
      marcarCambioPendiente();
      renderizarAjustes();
    } else {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    }
  });
  grid.appendChild(swPersonalizada);

  // Botón aparte para volver a editar una paleta personalizada ya guardada
  // (evita perder los ajustes anteriores solo por querer retocar un color).
  if (personalizada) {
    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn-secondary ppz-btn-editar";
    btnEditar.textContent = "Editar mi paleta";
    btnEditar.addEventListener("click", () => {
      iniciarFlujoPaletaPersonalizada({ alGuardar: renderizarAjustes });
    });
    grid.appendChild(btnEditar);
  }

  // v1.14.1: Modo de rendimiento (reduce blur/sombras/animaciones)
  const chkRendimiento = document.getElementById("switch-rendimiento");
  if (chkRendimiento) {
    chkRendimiento.checked = !!estado.datos.configuracion.modo_rendimiento;
    chkRendimiento.onchange = () => {
      estado.datos.configuracion.modo_rendimiento = chkRendimiento.checked;
      aplicarModoRendimiento(chkRendimiento.checked);
      marcarCambioPendiente();
    };
  }

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(
      estado.datos.configuracion.paleta,
      nuevoModo,
      estado.datos.configuracion.paleta === "personalizada" ? personalizada.colores : undefined
    );
    marcarCambioPendiente();
  };

  // Escala de notas global
  const grupoEscala = document.getElementById("pill-escala-notas");
  grupoEscala.querySelectorAll(".pill-item").forEach((btn) => {
    btn.classList.toggle("active", Number(btn.dataset.valor) === estado.datos.configuracion.escala_notas_global);
    btn.onclick = () => {
      estado.datos.configuracion.escala_notas_global = Number(btn.dataset.valor);
      marcarCambioPendiente();
      renderizarAjustes();
    };
  });

  // Formato de texto de nombres de materias/carrera (v5 #9)
  const grupoFormato = document.getElementById("pill-formato-texto");
  if (grupoFormato) {
    grupoFormato.querySelectorAll(".pill-item").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.valor === (estado.datos.configuracion.formato_texto_nombres || "titulo"));
      btn.onclick = () => {
        estado.datos.configuracion.formato_texto_nombres = btn.dataset.valor;
        marcarCambioPendiente();
        renderizarAjustes();
        if (typeof renderizarPlanEstudios === "function") renderizarPlanEstudios();
      };
    });
  }

  actualizarIndicadorSync();
}

export {
  renderizarAjustes,
  aplicarModoRendimiento,
};
