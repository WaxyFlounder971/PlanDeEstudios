import { opcionesNotas, COLORES_NOTA, coloresPaletaNota } from "./notas-datos.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
const tr=(x)=>t(x);
function mostrarAjustesNotas(refrescar,abrirPapelera){
  const cfg=opcionesNotas();const overlay=document.createElement("div");overlay.className="modal-overlay notas-overlay";const panel=document.createElement("section");panel.className="glass-card stack notas-ajustes";panel.innerHTML=`<header class="notas-editor-cab"><h2>${tr("Ajustes de Notas")}</h2><button class="btn btn-secondary" data-close>${tr("Cerrar")}</button></header>`;
  const opciones=[
    ["vencimiento_default",tr("Agregar vencimiento por defecto"),"check"],
    ["papelera_despues_wapper",tr("Mover a Papelera después de enviar a Wapper"),"check"],
    ["completadas_al_final",tr("Mover completadas al final"),"check"],
    ["vista",tr("Vista predeterminada"),"select",[["cuadricula",tr("Cuadrícula")],["lista",tr("Lista")]]],
    ["plazo_default",tr("Vencimiento predeterminado"),"select",[["manana",tr("Mañana")],["3_dias",tr("En 3 días")],["una_semana",tr("En una semana")],["proximo_mes",tr("El próximo mes")]]],
    ["compartir_accion",tr("Al compartir contenido"),"select",[["guardar",tr("Guardar directamente")],["editor",tr("Abrir el editor")]]],
  ];
  for(const [key,label,tipo,choices] of opciones){if(key==="plazo_default"&&!cfg.vencimiento_default)continue;const row=document.createElement("label");row.className="notas-ajuste-row";row.append(document.createTextNode(label));let input;if(tipo==="check"){input=document.createElement("input");input.type="checkbox";input.checked=!!cfg[key];}else{input=document.createElement("select");input.className="form-input";choices.forEach(([v,l])=>{const o=document.createElement("option");o.value=v;o.textContent=l;input.append(o);});input.value=cfg[key];}input.onchange=()=>{cfg[key]=tipo==="check"?input.checked:input.value;sellarTimestamp(estado.datos.configuracion);marcarCambioPendiente();if(key==="vista")refrescar();};row.append(input);panel.append(row);}
  const label=document.createElement("span");label.className="form-label";label.textContent=tr("Color predeterminado");panel.append(label);const pal=document.createElement("div");pal.className="notas-palette";[...new Set([...(cfg.colores_recientes||[]),...coloresPaletaNota()])].slice(0,12).forEach(color=>{const b=document.createElement("button");b.className="notas-color";b.style.backgroundColor=color;b.setAttribute("aria-label",color);b.setAttribute("aria-pressed",String(cfg.color_default===color));b.onclick=()=>{cfg.color_default=color;cfg.colores_recientes=[color,...(cfg.colores_recientes||[]).filter(c=>c!==color)].slice(0,8);pal.querySelectorAll("[aria-pressed]").forEach(x=>x.setAttribute("aria-pressed","false"));b.setAttribute("aria-pressed","true");sellarTimestamp(estado.datos.configuracion);marcarCambioPendiente();};pal.append(b);});panel.append(pal);if(abrirPapelera){const tb=document.createElement("button");tb.type="button";tb.className="btn btn-secondary";tb.textContent="🗑️ "+tr("Papelera");tb.onclick=()=>{overlay.remove();abrirPapelera();};panel.append(tb);}panel.querySelector("[data-close]").onclick=()=>overlay.remove();overlay.append(panel);document.body.append(overlay);
}
export { mostrarAjustesNotas };
