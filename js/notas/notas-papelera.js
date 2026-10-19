import { notasActuales, restaurarNota, eliminarDefinitiva, procesarCicloVidaNotas } from "./notas-datos.js";
import { renderizarHTMLNota } from "./notas-sanitizar.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
const tr=(x)=>t(x);

function mostrarPapelera(contenedor, refrescar) {
  procesarCicloVidaNotas();
  const seleccion=new Set();
  const overlay=document.createElement("div");overlay.className="modal-overlay notas-overlay";
  const caja=document.createElement("section");caja.className="glass-card stack notas-papelera";
  const cab=document.createElement("header");cab.className="notas-editor-cab";
  const titulo=document.createElement("h2");titulo.textContent=tr("Papelera");
  const vaciar=document.createElement("button");vaciar.className="btn btn-danger";vaciar.textContent=tr("Vaciar papelera");
  const cerrar=document.createElement("button");cerrar.className="btn btn-secondary";cerrar.textContent=tr("Cerrar");cerrar.onclick=()=>overlay.remove();cab.append(titulo,vaciar,cerrar);caja.append(cab);
  const acciones=document.createElement("div");acciones.className="row notas-seleccion-bar";
  const contador=document.createElement("span");const seleccionar=document.createElement("button");seleccionar.className="btn btn-secondary";seleccionar.textContent=tr("Seleccionar todo");
  const restaurarSeleccion=document.createElement("button");restaurarSeleccion.className="btn btn-secondary";restaurarSeleccion.textContent=tr("Restaurar");
  const eliminarSeleccion=document.createElement("button");eliminarSeleccion.className="btn btn-danger";eliminarSeleccion.textContent=tr("Eliminar definitivamente");
  acciones.append(contador,seleccionar,restaurarSeleccion,eliminarSeleccion);caja.append(acciones);
  const lista=document.createElement("div");lista.className="notas-grid";caja.append(lista);
  const items=()=>notasActuales().filter(n=>n.eliminada_en).sort((a,b)=>b.eliminada_en-a.eliminada_en);
  function actualizarSeleccion(){contador.textContent=tr("{n} seleccionadas").replace("{n}",String(seleccion.size));restaurarSeleccion.disabled=eliminarSeleccion.disabled=!seleccion.size;}
  function refrescarLista(){lista.replaceChildren();const actuales=items();for(const nota of actuales){const card=document.createElement("article");card.className="glass-card nota-card";card.style.setProperty("--nota-color",nota.color||"#fff2b3");const top=document.createElement("div");top.className="row";const elegir=document.createElement("input");elegir.type="checkbox";elegir.checked=seleccion.has(nota.id);elegir.setAttribute("aria-label",tr("Seleccionar"));elegir.onchange=()=>{elegir.checked?seleccion.add(nota.id):seleccion.delete(nota.id);actualizarSeleccion();};const h=document.createElement("strong");h.textContent=nota.titulo||tr("Sin título");top.append(elegir,h);const cuerpo=document.createElement("div");cuerpo.className="nota-preview";renderizarHTMLNota(cuerpo,nota.contenido);const meta=document.createElement("small");const dias=Math.max(0,30-Math.floor((Date.now()-nota.eliminada_en)/86400000));meta.textContent=`${tr(nota.motivo_eliminacion==="vencida"?"Vencida":"Eliminada")} · ${tr("Quedan {dias} días").replace("{dias}",String(dias))}`;card.append(top,cuerpo,meta);lista.append(card);}if(!actuales.length){const p=document.createElement("p");p.className="muted";p.textContent=tr("La papelera está vacía.");lista.append(p);seleccion.clear();}actualizarSeleccion();}
  const confirmarBorrado=(xs)=>confirm(xs.length===items().length?tr("¿Eliminar definitivamente todas las notas de la papelera?"):tr("¿Eliminar definitivamente las notas seleccionadas?"));
  vaciar.onclick=()=>{const xs=items();if(!xs.length||!confirm(tr("¿Eliminar definitivamente todas las notas de la papelera?")))return;xs.forEach(eliminarDefinitiva);seleccion.clear();refrescar();refrescarLista();};
  seleccionar.onclick=()=>{const xs=items();if(xs.length&&seleccion.size===xs.length)seleccion.clear();else xs.forEach(n=>seleccion.add(n.id));refrescarLista();};
  restaurarSeleccion.onclick=()=>{items().filter(n=>seleccion.has(n.id)).forEach(restaurarNota);seleccion.clear();refrescar();refrescarLista();};
  eliminarSeleccion.onclick=()=>{const xs=items().filter(n=>seleccion.has(n.id));if(!xs.length||!confirmarBorrado(xs))return;xs.forEach(eliminarDefinitiva);seleccion.clear();refrescar();refrescarLista();};
  refrescarLista();overlay.append(caja);document.body.append(overlay);
}
export { mostrarPapelera };
