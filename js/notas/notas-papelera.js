import { notasActuales, restaurarNota, eliminarDefinitiva, procesarCicloVidaNotas, resolverColorNota, COLOR_DEFECTO } from "./notas-datos.js";
import { renderizarHTMLNota } from "./notas-sanitizar.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { conHistorial } from "./notas-historial.js";
const tr=(x)=>t(x);
function contraste(hex){const m=/^#([\da-f]{6})$/i.exec(hex||"");if(!m)return "#172033";const [r,g,b]=[0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return(.2126*r+.7152*g+.0722*b)>.179?"#172033":"#ffffff";}

function mostrarPapelera(contenedor, refrescar) {
  procesarCicloVidaNotas();
  const seleccion=new Set();
  const overlay=document.createElement("div");overlay.className="modal-overlay notas-overlay";
  const caja=document.createElement("section");caja.className="glass-card stack notas-papelera";
  const cab=document.createElement("header");cab.className="notas-editor-cab";
  const titulo=document.createElement("h2");titulo.textContent=tr("Papelera");
  const vaciar=document.createElement("button");vaciar.className="btn btn-danger";vaciar.textContent=tr("Vaciar papelera");
  const cerrar=document.createElement("button");cerrar.className="btn btn-secondary";cerrar.textContent=tr("Cerrar");const alActualizar=()=>refrescarLista();window.addEventListener("notas:actualizadas",alActualizar);cerrar.onclick=()=>{window.removeEventListener("notas:actualizadas",alActualizar);overlay.remove();};cab.append(titulo,vaciar,cerrar);caja.append(cab);
  const acciones=document.createElement("div");acciones.className="row notas-seleccion-bar";
  const contador=document.createElement("span");const seleccionar=document.createElement("button");seleccionar.className="btn btn-secondary";seleccionar.textContent=tr("Seleccionar todo");
  const restaurarSeleccion=document.createElement("button");restaurarSeleccion.className="btn btn-secondary";restaurarSeleccion.textContent="♻️ "+tr("Restaurar");
  const eliminarSeleccion=document.createElement("button");eliminarSeleccion.className="btn btn-danger";eliminarSeleccion.textContent=tr("Eliminar definitivamente");
  acciones.append(contador,seleccionar,restaurarSeleccion,eliminarSeleccion);caja.append(acciones);
  const lista=document.createElement("div");lista.className="notas-grid";caja.append(lista);
  const items=()=>notasActuales().filter(n=>n.eliminada_en).sort((a,b)=>b.eliminada_en-a.eliminada_en);
  function actualizarSeleccion(){const actuales=items();contador.textContent=tr("{n} seleccionadas").replace("{n}",String(seleccion.size));restaurarSeleccion.style.display=eliminarSeleccion.style.display=seleccion.size?"":"none";contador.style.display=seleccion.size?"":"none";seleccionar.style.display=actuales.length?"":"none";vaciar.style.display=actuales.length?"":"none";const todas=actuales.length>0&&actuales.every(n=>seleccion.has(n.id));seleccionar.textContent=tr(todas?"Quitar selección":"Seleccionar todo");}
  function alternarSeleccion(nota,card){if(seleccion.has(nota.id))seleccion.delete(nota.id);else seleccion.add(nota.id);card.classList.toggle("seleccionada",seleccion.has(nota.id));card.setAttribute("aria-pressed",String(seleccion.has(nota.id)));actualizarSeleccion();}
  function refrescarLista(){lista.replaceChildren();const actuales=items();for(const nota of actuales){const card=document.createElement("article");card.className="glass-card nota-card";const colorTarjeta=resolverColorNota(nota.color||COLOR_DEFECTO);card.style.setProperty("--nota-color",colorTarjeta);card.style.setProperty("color",/^#[\da-f]{6}$/i.test(nota.color_texto||"")?nota.color_texto:contraste(colorTarjeta),"important");card.classList.toggle("seleccionada",seleccion.has(nota.id));card.setAttribute("role","button");card.setAttribute("tabindex","0");card.setAttribute("aria-pressed",String(seleccion.has(nota.id)));card.setAttribute("aria-label",nota.titulo||tr("Seleccionar"));const top=document.createElement("div");top.className="row";const h=document.createElement("strong");h.textContent=nota.titulo||"";h.hidden=!nota.titulo;top.append(h);const cuerpo=document.createElement("div");cuerpo.className="nota-preview";renderizarHTMLNota(cuerpo,nota.contenido);const meta=document.createElement("small");const dias=Math.max(0,30-Math.floor((Date.now()-nota.eliminada_en)/86400000));meta.textContent=`${tr(nota.motivo_eliminacion==="vencida"?"Vencida":"Eliminada")} · ${tr("Quedan {dias} días").replace("{dias}",String(dias))}`;card.append(top,cuerpo,meta);card.onclick=()=>alternarSeleccion(nota,card);card.onkeydown=e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();alternarSeleccion(nota,card);}};lista.append(card);}if(!actuales.length){const p=document.createElement("p");p.className="muted";p.textContent=tr("La papelera está vacía.");lista.append(p);seleccion.clear();}actualizarSeleccion();}
  const confirmarBorrado=(mensaje)=>new Promise(resolve=>abrirConfirmacion({titulo:tr("Eliminar definitivamente"),mensaje,textoConfirmar:tr("Eliminar"),claseConfirmar:"btn-danger",onConfirmar:()=>resolve(true),onCancelar:()=>resolve(false)}));
  vaciar.onclick=async()=>{const xs=items();if(!xs.length||!await confirmarBorrado(tr("¿Eliminar definitivamente todas las notas de la papelera?")))return;conHistorial("Eliminar definitivamente",xs.map(n=>n.id),()=>xs.forEach(eliminarDefinitiva));seleccion.clear();refrescar();refrescarLista();};
  seleccionar.onclick=()=>{const xs=items();if(xs.length&&xs.every(n=>seleccion.has(n.id)))seleccion.clear();else xs.forEach(n=>seleccion.add(n.id));refrescarLista();};
  restaurarSeleccion.onclick=()=>{const xs=items().filter(n=>seleccion.has(n.id));conHistorial("Restaurar notas",xs.map(n=>n.id),()=>xs.forEach(restaurarNota));seleccion.clear();refrescar();refrescarLista();};
  eliminarSeleccion.onclick=async()=>{const xs=items().filter(n=>seleccion.has(n.id));if(!xs.length||!await confirmarBorrado(xs.length===items().length?tr("¿Eliminar definitivamente todas las notas de la papelera?"):tr("¿Eliminar definitivamente las notas seleccionadas?")))return;conHistorial("Eliminar definitivamente",xs.map(n=>n.id),()=>xs.forEach(eliminarDefinitiva));seleccion.clear();refrescar();refrescarLista();};
  refrescarLista();overlay.append(caja);document.body.append(overlay);
}
export { mostrarPapelera };
