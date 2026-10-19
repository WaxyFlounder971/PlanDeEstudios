import { crearNota, guardarNota, opcionesNotas } from "./notas-datos.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { estado } from "../core/storage.js";
const CLAVE_COMPARTIDOS="notas_share_pendientes_v1";
const tr=(x)=>t(x);
function leerPendientes(){try{return JSON.parse(localStorage.getItem(CLAVE_COMPARTIDOS)||"[]");}catch(_){return[];}}
function guardarPendientes(xs){try{localStorage.setItem(CLAVE_COMPARTIDOS,JSON.stringify(xs));}catch(_){}}
function capturarCompartido(){
  const url=new URL(location.href);const p=url.searchParams;if(!p.has("title")&&!p.has("text")&&!p.has("url"))return false;
  const payload={id:`share_${Date.now()}_${Math.random().toString(36).slice(2)}`,title:(p.get("title")||"").slice(0,180),text:[p.get("text"),p.get("url")].filter(Boolean).join("\n").slice(0,10000),creado:Date.now()};const queue=leerPendientes().slice(-19);queue.push(payload);guardarPendientes(queue);history.replaceState(history.state,"",url.pathname+url.hash);return true;
}
function procesarCompartidos(){
  if(!estado.datos?.notas)return;const cola=leerPendientes();if(!cola.length)return;
  const restantes=[];for(const x of cola){if(estado.datos.notas.some(n=>n.origen==="compartida"&&n.share_id===x.id))continue;const nota=crearNota({titulo:x.title,contenido:String(x.text||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\n/g,"<br>"),origen:"compartida"});nota.share_id=x.id;guardarNota(nota);if(opcionesNotas().compartir_accion==="editor")window.dispatchEvent(new CustomEvent("notas:abrir-compartida",{detail:nota.id}));else window.dispatchEvent(new CustomEvent("notas:compartido",{detail:nota.id}));}
  guardarPendientes(restantes);
}
async function compartirNotaFuera(texto,titulo){if(navigator.share){try{await navigator.share({title:titulo||tr("Nota rápida"),text:texto});return true;}catch(e){if(e.name==="AbortError")return false;}}try{await navigator.clipboard.writeText(texto);return true;}catch(_){return false;}}
capturarCompartido();
export { procesarCompartidos, compartirNotaFuera, capturarCompartido };
