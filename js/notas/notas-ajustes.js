import { opcionesNotas, coloresPaletaNota, resolverColorNota, notasActuales } from "./notas-datos.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { inyectarEstilosNotas } from "./notas-estilos.js";

const tr = (x) => t(x);

function guardar() {
  sellarTimestamp(estado.datos.configuracion);
  marcarCambioPendiente();
}

function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

function segmentado(opciones, valor, alCambiar, etiquetaAria) {
  const grupo = el("div", "nt-seg");
  grupo.setAttribute("role", "radiogroup");
  grupo.setAttribute("aria-label", etiquetaAria);
  for (const [v, texto] of opciones) {
    const b = el("button", "nt-seg-op", texto);
    b.type = "button";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(v === valor));
    b.onclick = () => {
      grupo.querySelectorAll("[role=radio]").forEach((x) => x.setAttribute("aria-checked", String(x === b)));
      alCambiar(v);
    };
    grupo.append(b);
  }
  return grupo;
}

function interruptor(texto, activo, alCambiar) {
  const fila = el("label", "nt-fila");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.className = "nt-switch-input";
  input.checked = !!activo;
  input.setAttribute("role", "switch");
  input.onchange = () => alCambiar(input.checked);
  const pista = el("span", "nt-switch");
  pista.setAttribute("aria-hidden", "true");
  fila.append(el("span", "nt-fila-txt", texto), input, pista);
  return fila;
}

function seccion(etiqueta, contenido) {
  const bloque = el("div", "nt-seccion");
  bloque.append(el("span", "nt-etiqueta", etiqueta), contenido);
  return bloque;
}

function mostrarAjustesNotas(refrescar, abrirPapelera) {
  inyectarEstilosNotas();
  const cfg = opcionesNotas();
  const overlay = el("div", "modal-overlay notas-overlay");
  const panel = el("section", "glass-card stack notas-ajustes nt-panel");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", tr("Ajustes de Notas"));

  let cerrado = false;
  const teclas = (e) => { if (e.key === "Escape") cerrar(); };
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    document.removeEventListener("keydown", teclas);
    overlay.remove();
  };
  document.addEventListener("keydown", teclas);

  panel.append(el("h2", "nt-titulo", tr("Ajustes de Notas")));

  // Vista predeterminada
  panel.append(seccion(tr("Vista predeterminada"), segmentado(
    [["cuadricula", tr("Cuadrícula")], ["lista", tr("Lista")]],
    cfg.vista,
    (v) => { cfg.vista = v; guardar(); refrescar(); },
    tr("Vista predeterminada"),
  )));
  panel.append(interruptor(tr("Notas expandidas por defecto"), cfg.tarjetas_expandidas === true, (v) => { cfg.tarjetas_expandidas = v; guardar(); refrescar(); }));
  panel.append(interruptor(tr("Mostrar fecha de creación en el editor"), cfg.mostrar_creada !== false, (v) => { cfg.mostrar_creada = v; guardar(); }));
  panel.append(interruptor(tr("Mostrar fecha de modificación en el editor"), cfg.mostrar_modificada !== false, (v) => { cfg.mostrar_modificada = v; guardar(); }));

  // Vencimiento por defecto + plazo
  const plazo = seccion(tr("Vencimiento predeterminado"), segmentado(
    [["manana", tr("Mañana")], ["3_dias", tr("En 3 días")], ["una_semana", tr("En una semana")], ["proximo_mes", tr("El próximo mes")]],
    cfg.plazo_default,
    (v) => { cfg.plazo_default = v; guardar(); },
    tr("Vencimiento predeterminado"),
  ));
  plazo.classList.toggle("nt-oculto", !cfg.vencimiento_default);
  panel.append(interruptor(tr("Agregar vencimiento por defecto"), cfg.vencimiento_default, (v) => {
    cfg.vencimiento_default = v;
    plazo.classList.toggle("nt-oculto", !v);
    guardar();
  }));
  panel.append(plazo);

  panel.append(interruptor(tr("No compartir marca de agua en imágenes"), cfg.sin_marca_agua === true, (v) => { cfg.sin_marca_agua = v; guardar(); }));

  // Interruptores
  panel.append(interruptor(tr("Mover a Papelera después de enviar a Wapper"), cfg.papelera_despues_wapper, (v) => { cfg.papelera_despues_wapper = v; guardar(); }));
  panel.append(interruptor(tr("Enviar tareas completadas al final"), cfg.completadas_al_final, (v) => { cfg.completadas_al_final = v; guardar(); }));
  panel.append(interruptor(tr("Formato automático: [] casilla, **negrita**, __subrayado__ y > cita"), cfg.formato_auto !== false, (v) => { cfg.formato_auto = v; guardar(); }));

  // Color predeterminado (solo los colores base del modo actual)
  const paleta = el("div", "nt-colores notas-palette");
  const actual = resolverColorNota(cfg.color_default);
  for (const color of coloresPaletaNota()) {
    const b = el("button", "notas-color");
    b.type = "button";
    b.style.backgroundColor = color;
    b.title = color;
    b.setAttribute("aria-label", color);
    b.setAttribute("aria-pressed", String(actual === color));
    b.onclick = () => {
      cfg.color_default = color;
      paleta.querySelectorAll("[aria-pressed]").forEach((x) => x.setAttribute("aria-pressed", "false"));
      b.setAttribute("aria-pressed", "true");
      guardar();
    };
    paleta.append(b);
  }
  panel.append(seccion(tr("Color predeterminado"), paleta));

  // Papelera
  if (abrirPapelera) {
    const total = notasActuales().filter((n) => n.eliminada_en).length;
    const tb = el("button", "nt-btn");
    tb.type = "button";
    tb.append(document.createTextNode("🗑️ " + tr("Papelera")));
    if (total) tb.append(el("span", "nt-badge", String(total)));
    tb.onclick = () => { cerrar(); abrirPapelera(); };
    panel.append(tb);
  }

  const listo = el("button", "nt-listo", tr("Listo"));
  listo.type = "button";
  listo.onclick = cerrar;
  panel.append(listo);

  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  overlay.append(panel);
  document.body.append(overlay);
}

export { mostrarAjustesNotas };
