/* =========================================================================
   FINANZAS 2.0 — UI de módulos y perfiles (etapa 0C)
   Un solo lugar para los 4 interruptores y el selector de perfil, usado por
   Ajustes y por el onboarding de Finanzas. Apagar un módulo solo oculta.
   ========================================================================= */

import { MODULOS_INFO, PERFILES_FINANZAS, aplicarModulosFinanzas, aplicarPerfilFinanzas, perfilDeModulos } from "../core/finanzas-perfiles.js";
import { obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import { activarDeudas } from "../core/finanzas-deudas.js";
import { activarCuentas } from "../core/finanzas-cuentas.js";
import { activarConsejos, consejoDe, consejosActivos } from "../core/finanzas-consejos.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";

/** Al encender un módulo, un consejo de una línea (opcional: se apaga en Ajustes). */
function avisarConsejo(modulo, encendido) {
  if (!encendido) return;
  const c = consejoDe(estado.datos, modulo);
  if (c) mostrarToast(t(c));
}

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
      avisarConsejo(info.id, encendido);
      renderizarModulosFinanzasAjustes();
      repintarFinanzasSiVisible();
    }));
  });

  // Registro rápido (sesión 1): plantillas recientes como atajos. Preferencia por cuenta.
  const plantillas = { id: "plantillas_rapidas", etiqueta: "Plantillas rápidas", detalle: "Muestra tus movimientos recientes como atajos al registrar" };
  const activas = !estado.datos.configuracion || estado.datos.configuracion.plantillas_rapidas !== false;
  cont.appendChild(construirFilaInterruptor(plantillas, activas, (encendido) => {
    if (!estado.datos.configuracion) estado.datos.configuracion = {};
    estado.datos.configuracion.plantillas_rapidas = encendido;
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
  }));

  // Sesión 7A: módulo opcional Me deben y debo (apagado por defecto; no forma parte de los perfiles).
  const deudas = { id: "deudas", etiqueta: "Me deben y debo", detalle: "Dinero que prestas o te prestan, y gastos divididos. Opcional" };
  cont.appendChild(construirFilaInterruptor(deudas, !!modulos.deudas, (encendido) => {
    activarDeudas(estado.datos, encendido);
    marcarCambioPendiente();
    avisarConsejo("deudas", encendido);
    renderizarModulosFinanzasAjustes();
    repintarFinanzasSiVisible();
  }));

  // Sesión 7B: módulo opcional Cuentas (cada una con su divisa; apagado por defecto, fuera de los perfiles).
  const cuentasInfo = { id: "cuentas", etiqueta: "Cuentas", detalle: "Separa dónde está tu dinero (efectivo, banco, tarjetas), cada cuenta con su divisa. Opcional" };
  cont.appendChild(construirFilaInterruptor(cuentasInfo, !!modulos.cuentas, (encendido) => {
    activarCuentas(estado.datos, encendido);
    marcarCambioPendiente();
    avisarConsejo("cuentas", encendido);
    renderizarModulosFinanzasAjustes();
    repintarFinanzasSiVisible();
  }));

  // Sesión 8: consejos de una línea al encender un módulo (opcionales; preferencia por cuenta).
  const consejosInfo = { id: "consejos", etiqueta: "Consejos al activar módulos", detalle: "Una línea de ayuda al encender cada parte de Finanzas" };
  cont.appendChild(construirFilaInterruptor(consejosInfo, consejosActivos(estado.datos), (encendido) => {
    activarConsejos(estado.datos, encendido);
    marcarCambioPendiente();
  }));

  // Sesión 6: exportar, importar y mensajes del banco. Import dinámico: la pantalla de datos importa finanzas.js.
  const huecoDatos = document.createElement("div");
  cont.appendChild(huecoDatos);
  import("./finanzas-datos-ui.js").then((m) => huecoDatos.appendChild(m.construirBloqueDatosFinanzas())).catch(() => {});
}

export { construirSelectorPerfil, renderizarModulosFinanzasAjustes };
