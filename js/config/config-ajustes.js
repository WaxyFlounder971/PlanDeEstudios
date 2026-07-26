/* =========================================================================
   CONFIGURACIÓN — AJUSTES GENERALES
   Paletas, modo claro/oscuro, escala de notas, formato de texto.
   ========================================================================= */

import { PALETAS_DISPONIBLES } from "../core/schema.js";
import { actualizarIndicadorSync, marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { renderizarPlanEstudios } from "../plan/plan-vista-lista.js";
import { COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO, TEXTO_PREVIEW_PALETA, aplicarPaleta } from "../ui/tema.js";

/* ------------------------------ Ajustes ------------------------------ */

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

  // Modo claro/oscuro
  const chkModo = document.getElementById("switch-modo");
  chkModo.checked = estado.datos.configuracion.modo === "light";
  chkModo.onchange = () => {
    const nuevoModo = chkModo.checked ? "light" : "dark";
    estado.datos.configuracion.modo = nuevoModo;
    aplicarPaleta(estado.datos.configuracion.paleta, nuevoModo);
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
};
