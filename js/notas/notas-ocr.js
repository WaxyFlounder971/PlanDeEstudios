import { estado } from "../core/storage/storage.js";
import { traducirTextoInterfaz as tr } from "../core/i18n.js";

const MODELO="gemini-3.1-flash-lite";
async function transcribirTintaNativa(trazos,signal){
  if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");
  const nav=globalThis.navigator;if(globalThis.isSecureContext===false)throw new Error("El reconocimiento manuscrito local necesita una página segura (HTTPS o localhost).");const consultar=nav?.queryHandwritingRecognizerSupport||nav?.queryHandwritingRecognizer;if(typeof nav?.createHandwritingRecognizer!=="function"||typeof consultar!=="function"||typeof globalThis.HandwritingStroke!=="function")throw new Error("El reconocimiento manuscrito sin conexión no está disponible en este navegador. Sin Gemini ni un modelo local, no hay motor de conversión.");
  const idioma=(document.documentElement.lang||"es").toLowerCase().slice(0,2),preferidos=[idioma,"es","en","fr","it"].filter((x,i,a)=>["es","en","fr","it"].includes(x)&&a.indexOf(x)===i);let lengua=null;
  for(const candidate of preferidos){if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");try{if(await consultar.call(nav,{languages:[candidate]})){lengua=candidate;break;}}catch(_){}}
  if(!lengua)throw new Error("El modo sin conexión de este navegador no admite español, inglés, francés ni italiano. Activa Gemini en Ajustes para convertir esta nota.");
  const recognizer=await nav.createHandwritingRecognizer({languages:[lengua]});let drawing;
  try{if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");drawing=recognizer.startDrawing({recognitionType:"text",inputType:"stylus"});for(const t of trazos.filter(x=>!x.tipo&&x.p?.length)){const stroke=new HandwritingStroke();let time=0,prev=null;for(const q of t.p){if(prev)time+=Math.max(1,Math.round(Math.hypot(q[0]-prev[0],q[1]-prev[1])*10000));stroke.addPoint({x:q[0]*1200,y:q[1]*1200,t:time});prev=q;}drawing.addStroke(stroke);}const p=(await drawing.getPrediction())?.[0]?.text?.trim();if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");if(!p)throw new Error("El reconocimiento sin conexión no encontró texto.");return p;}finally{drawing?.clear?.();recognizer.finish?.();}
}
const tintaIntacta=()=>tr("La tinta se conservó sin cambios.");
async function transcribirTintaGemini(dataUrl,trazos=[],{timeoutMs=12000,signal}={}){
  if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");
  const clave=estado.datos?.configuracion?.gemini_api_key;
  if(!clave){try{return await transcribirTintaNativa(trazos,signal);}catch(e){if(e.name==="AbortError")throw e;throw new Error(`${tr(e.message)} ${tintaIntacta()}`);}}
  if(navigator.onLine===false){try{return await transcribirTintaNativa(trazos,signal);}catch(e){if(e.name==="AbortError")throw e;throw new Error(`${tr("Sin conexión")} — ${tr(e.message)} ${tintaIntacta()}`);}}
  const m=/^data:image\/png;base64,([\s\S]+)$/.exec(dataUrl||"");if(!m)throw new Error("No se pudo preparar la imagen de la tinta.");
  const controller=new AbortController();let timedOut=false;const cancelar=()=>controller.abort();signal?.addEventListener("abort",cancelar,{once:true});const timer=setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
  try{const r=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent?key=${encodeURIComponent(clave)}`,{method:"POST",headers:{"Content-Type":"application/json"},signal:controller.signal,body:JSON.stringify({contents:[{role:"user",parts:[{inline_data:{mime_type:"image/png",data:m[1]}},{text:"Transcribe exactamente toda la escritura manuscrita visible. Puede estar en español, inglés, francés o italiano; detecta el idioma y conserva el idioma original, tildes, acentos, ñ, apóstrofos, puntuación, mayúsculas y saltos de línea. No traduzcas ni corrijas. Omite dibujos sin texto; para fragmentos realmente ilegibles usa [ilegible]. Devuelve solo la transcripción, sin introducción ni formato Markdown."}]}],generationConfig:{temperature:0.1,maxOutputTokens:2048}})});
    const d=await r.json().catch(()=>({}));if(!r.ok){const error=new Error(d.error?.message||"");error.status=r.status;throw error;}const texto=d.candidates?.[0]?.content?.parts?.map(p=>p.text||"").join("").trim();if(!texto)throw new Error("Gemini no encontró texto manuscrito. La tinta se conservó sin cambios.");return texto;
  }catch(e){if(signal?.aborted)throw new DOMException("La conversión fue cancelada.","AbortError");try{return await transcribirTintaNativa(trazos,signal);}catch(fallback){if(fallback.name==="AbortError")throw fallback;const causa=timedOut?tr("Gemini tardó más de 12 segundos."):e instanceof TypeError?tr("No se pudo conectar con Gemini."):e.status?`${tr("Gemini devolvió un error")} (${e.status})${e.message?`: ${e.message}`:""}`:tr("Gemini no pudo convertir la tinta.");throw new Error(`${causa} ${tr(fallback.message)} ${tintaIntacta()}`);}}finally{clearTimeout(timer);signal?.removeEventListener("abort",cancelar);}
}
export { transcribirTintaGemini };
