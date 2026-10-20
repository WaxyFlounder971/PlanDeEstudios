// Operaciones puras sobre el contenido de una nota. Mantiene intactos los formatos y marcadores.
import { sanearHTMLNota } from "./notas-sanitizar.js";

const textoDeNota = (html) => { const d = document.createElement("div"); d.innerHTML = sanearHTMLNota(html); return d.innerText || d.textContent || ""; };
function lineasDeNota(html, { marcadores = true } = {}) {
  const d = document.createElement("div"); d.innerHTML = sanearHTMLNota(html);
  const blocks = [...d.querySelectorAll("li,p,div,blockquote,h1,h2,h3")].filter((e) => !e.querySelector("li,p,div,blockquote,h1,h2,h3"));
  let lines = blocks.length ? blocks.map((e) => e.innerText || e.textContent || "") : (d.innerText || d.textContent || "").split(/\r?\n/);
  if (marcadores) lines = lines.map((x) => x.trim());
  return lines;
}
function estadisticas(lineas) {
  const s = lineas.join("\n"), palabras = (s.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu) || []).length;
  const caracteres = [...s].length;
  return { palabras, caracteres, sinEspacios: [...s.replace(/\s/gu, "")].length, lineas: lineas.length, segundos: palabras / 200 * 60 };
}
function formatoLectura(seg) { if (seg < 60) return "< 1 min"; const m = Math.ceil(seg / 60); return `${m} min`; }
const normalize = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
function transformarHTML(accion, html, opts = {}) {
  const d = document.createElement("div"); d.innerHTML = sanearHTMLNota(html);
  const r = document.createRange();
  // Las transformaciones de líneas operan sobre bloques completos y conservan markup y checks.
  const lis = [...d.querySelectorAll("li")];
  const blocks = lis.length ? lis : [...d.children];
  let cambios = 0;
  const text = (e) => (e.innerText || e.textContent || "").trim();
  const seleccion = Number.isFinite(opts.desde) && Number.isFinite(opts.hasta) && opts.hasta > opts.desde;
  let cursor = 0;
  const objetivo = blocks.filter((e) => { const start = cursor, end = start + (e.innerText || e.textContent || "").length; cursor = end + 1; return !seleccion || (end > opts.desde && start < opts.hasta); });
  if (["ordenar-az", "ordenar-za"].includes(accion)) {
    const parent = objetivo[0]?.parentElement;
    if (!seleccion && parent && blocks.every((e) => e.parentElement === parent)) {
      const sorted = objetivo.slice().sort((a,b) => normalize(text(a)).localeCompare(normalize(text(b)), undefined, {numeric:true}));
      if (accion === "ordenar-za") sorted.reverse();
      sorted.forEach((e,i) => { if (e !== blocks[i]) cambios++; parent.append(e); });
      if (opts.completadasAlFinal && lis.length) { const done=lis.filter(x=>x.querySelector('input[data-nota-check]:checked')); done.forEach(x=>parent.append(x)); }
    }
  } else if (["mayus","minus","titulo"].includes(accion)) {
    const target = objetivo.length ? objetivo : [d];
    target.forEach((e) => { const w=document.createTreeWalker(e,NodeFilter.SHOW_TEXT); let n; while(n=w.nextNode()){ if(n.parentElement?.closest("input,code,pre")) continue; const old=n.data; const next=accion==="mayus"?old.toLocaleUpperCase():accion==="minus"?old.toLocaleLowerCase():old.toLocaleLowerCase().replace(/(^|[\s([{])([\p{L}])/gu,(_,a,b)=>a+b.toLocaleUpperCase()); if(old!==next){n.data=next;cambios++;} } });
  } else if (["dup","vacias"].includes(accion)) {
    const seen=new Set(); for(const e of objetivo){const s=text(e); if(accion==="vacias"&&!s || accion==="dup"&&seen.has(normalize(s))){e.remove();cambios++;} else seen.add(normalize(s));}
  } else if (accion === "marcar") {
    const cbs=[...d.querySelectorAll('input[data-nota-check]')], all=cbs.length>0&&cbs.every(x=>x.checked), next=!all;
    cbs.forEach(x=>{if(x.checked!==next){x.checked=next;x.toggleAttribute("checked",next);cambios++;}});
    return {html:d.innerHTML,cambios,marcado:next};
  } else if (accion === "borrar-completados") {
    for(const cb of [...d.querySelectorAll('input[data-nota-check]:checked')]) {const li=cb.closest("li"); if(li){li.remove();cambios++;}}
    d.querySelectorAll("ul,ol").forEach(x=>{if(!x.children.length)x.remove();});
  }
  return { html: sanearHTMLNota(d.innerHTML), cambios };
}
export { transformarHTML, lineasDeNota, textoDeNota, estadisticas, formatoLectura };
