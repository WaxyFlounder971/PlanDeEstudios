/* =========================================================================
   FINANZAS 2.0 — UI de módulos y perfiles (etapa 0C)
   Un solo lugar para los 4 interruptores y el selector de perfil, usado por
   Ajustes y por el onboarding de Finanzas. Apagar un módulo solo oculta.
   ========================================================================= */

import { MODULOS_INFO, PERFILES_FINANZAS, aplicarModulosFinanzas, aplicarPerfilFinanzas, perfilDeModulos } from "../core/finanzas-perfiles.js";
import { obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";

/** Repinta Finanzas si ya está en pantalla. Import dinámico para no crear ciclos con finanzas.js. */
async function repintarFinanzasSiVisible() {
  const cont = document.getElementById("seccion-finanzas");
  if (!cont || !cont.childElementCount) return;
  const { renderizarFinanzas } = await import("./finanzas.js");
  renderizarFinanzas();
}

function construirFilaInterruptor(info, activo, onCambio) {
  const fila = document.createElement("div");
  fila.className = "row-between";
  fila.style.cssText = "align-items:center; gap:12px;";

  const bloque = document.createElement("div");
  bloque.style.cssText = "min-width:0;";
  const titulo = document.createElement("div");
  titulo.style.fontWeight = "600";
  titulo.textContent = t(info.etiqueta);
  const detalle = document.createElement("div");
  detalle.className = "muted";
  detalle.style.cssText = "font-size:0.8rem;";
  detalle.textContent = t(info.detalle);
  bloque.append(titulo, detalle);

  const label = document.createElement("label");
  label.className = "switch switch-tema";
  const chk = document.createElement("input");
  chk.type = "checkbox";
  chk.checked = activo;
  chk.setAttribute("aria-label", t(info.etiqueta));
  chk.addEventListener("change", () => onCambio(chk.checked));
  const track = document.createElement("span");
  track.className = "track";
  const thumb = document.createElement("span");
  thumb.className = "thumb";
  track.appendChild(thumb);
  label.append(chk, track);

  fila.append(bloque, label);
  return fila;
}

/** Tarjetas de perfil. `activoId` marca el perfil vigente (o ninguno si es "personalizado"). */
function construirSelectorPerfil(activoId, onElegir) {
  const grid = document.createElement("div");
  grid.className = "pill-grid-2";
  grid.setAttribute("role", "group");
  PERFILES_FINANZAS.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item finanzas-perfil-opcion" + (p.id === activoId ? " active" : "");
    btn.setAttribute("aria-pressed", p.id === activoId ? "true" : "false");
    const titulo = document.createElement("strong");
    titulo.textContent = `${p.emoji} ${t(p.etiqueta)}`;
    const detalle = document.createElement("span");
    detalle.className = "finanzas-perfil-detalle";
    detalle.textContent = t(p.detalle);
    btn.append(titulo, detalle);
    btn.addEventListener("click", () => onElegir(p.id));
    grid.appendChild(btn);
  });
  return grid;
}

/** Bloque de Ajustes: perfil + 4 interruptores. Se reconstruye solo al cambiar. */
function renderizarModulosFinanzasAjustes() {
  const cont = document.getElementById("ajustes-finanzas-modulos");
  if (!cont) return;
  cont.innerHTML = "";

  const modulos = obtenerModulosFinanzas(estado.datos);
  const perfil = perfilDeModulos(modulos);

  const nota = document.createElement("p");
  nota.className = "muted";
  nota.style.cssText = "margin:0; font-size:0.82rem;";
  nota.textContent = t("Elige qué partes de Finanzas quieres usar. Apagar una solo la oculta: no se borra nada y la puedes volver a encender.");
  cont.appendChild(nota);

  cont.appendChild(construirSelectorPerfil(perfil, (id) => {
    aplicarPerfilFinanzas(estado.datos, id);
    marcarCambioPendiente();
    renderizarModulosFinanzasAjustes();
    repintarFinanzasSiVisible();
  }));

  if (perfil === "personalizado") {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.style.cssText = "margin:0; font-size:0.8rem;";
    aviso.textContent = t("Combinación personalizada");
    cont.appendChild(aviso);
  }

  MODULOS_INFO.forEach((info) => {
    cont.appendChild(construirFilaInterruptor(info, !!modulos[info.id], (encendido) => {
      aplicarModulosFinanzas(estado.datos, { [info.id]: encendido });
      marcarCambioPendiente();
      renderizarModulosFinanzasAjustes();
      repintarFinanzasSiVisible();
    }));
  });
}

export { construirSelectorPerfil, renderizarModulosFinanzasAjustes };
