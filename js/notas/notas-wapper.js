import { sanearHTMLNota, textoPlanoNota } from "./notas-sanitizar.js";
import { dibujarTrazos } from "./notas-tinta.js";

const TIPO = "application/vnd.wapper+json";
function datosWapper(nota) {
  return {
    formato: "wapper",
    version: 1,
    exportada_en: new Date().toISOString(),
    nota: {
      titulo: String(nota.titulo || "").slice(0, 180),
      contenido: sanearHTMLNota(nota.contenido || ""),
      color: /^#[\da-f]{6}$/i.test(nota.color || "") ? nota.color : "#fff594",
      color_texto: /^#[\da-f]{6}$/i.test(nota.color_texto || "") ? nota.color_texto : null,
      vence_en: nota.vence_en || null,
      tinta: Array.isArray(nota.tinta) ? nota.tinta.slice(0, 5000).map((t) => ({ c: /^#[\da-f]{6}$/i.test(t.c || "") ? t.c : "#172033", w: Math.max(.001, Math.min(.03, Number(t.w) || .0045)), f: t.f ? 1 : undefined, a: t.a ? 1 : undefined, p: Array.isArray(t.p) ? t.p.slice(0, 60000).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number.isFinite(p[2]) ? p[2] : undefined].filter((x) => x !== undefined)) : [] })) : [],
    },
  };
}
function descargarWapper(nota) {
  const blob = new Blob([JSON.stringify(datosWapper(nota), null, 2)], { type: TIPO });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `${(nota.titulo || "nota").normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "nota"}.wapper`;
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function leerWapper(file) {
  if (!file || file.size > 5_000_000 || !/\.wapper$/i.test(file.name)) throw new Error("Archivo .wapper inválido o demasiado grande");
  const data = JSON.parse(await file.text());
  if (data.formato !== "wapper" || data.version !== 1 || !data.nota || typeof data.nota !== "object") throw new Error("Versión o formato .wapper no compatible");
  const n = data.nota;
  return {
    titulo: String(n.titulo || "").slice(0, 180), contenido: sanearHTMLNota(String(n.contenido || "")),
    texto: textoPlanoNota(n.contenido || ""), color: /^#[\da-f]{6}$/i.test(n.color || "") ? n.color : "#fff594",
    color_texto: /^#[\da-f]{6}$/i.test(n.color_texto || "") ? n.color_texto : null,
    vence_en: typeof n.vence_en === "string" ? n.vence_en : null,
    tinta: Array.isArray(n.tinta) ? n.tinta.slice(0, 5000).filter((t) => t && Array.isArray(t.p)).map((t) => ({ c: /^#[\da-f]{6}$/i.test(t.c || "") ? t.c : "#172033", w: Math.max(.001, Math.min(.03, Number(t.w) || .0045)), f: t.f ? 1 : undefined, a: t.a ? 1 : undefined, p: t.p.slice(0, 60000).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [Math.max(-2,Math.min(3,+p[0])),Math.max(-2,Math.min(8,+p[1])),Number.isFinite(+p[2])?Math.max(0,Math.min(1,+p[2])):undefined].filter((x)=>x!==undefined)) })) : [],
  };
}

function crearImagenNota({ titulo = "", contenido = "", color = "#fff594", trazos = [] }) {
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const w = 900, pad = 44, maxW = w - pad * 2, size = 32, lineH = 44;
  ctx.font = `${size}px system-ui, sans-serif`;
  const palabras = textoPlanoNota(contenido).split(/\s+/).filter(Boolean), lineas = [];
  let actual = "";
  for (const pal of palabras) { const nueva = actual ? `${actual} ${pal}` : pal; if (actual && ctx.measureText(nueva).width > maxW) { lineas.push(actual); actual = pal; } else actual = nueva; }
  if (actual) lineas.push(actual);
  const tituloLineas = String(titulo).split(/\r?\n/);
  const textoH = Math.max(1,lineas.length) * lineH, baseTinta = pad + 70 + tituloLineas.length * 42 + textoH + 24;
  const maxY = trazos.flatMap((t) => t.p || []).reduce((m,p) => Math.max(m,Number(p[1]) || 0),0);
  const tintaH = trazos.length ? Math.max(220,Math.min(1400,maxY * maxW + 40)) : 0;
  const h = Math.max(440, baseTinta + tintaH + pad + 64);
  c.width = w; c.height = h;
  ctx.fillStyle = color; ctx.fillRect(0,0,w,h);
  ctx.fillStyle = "rgba(0,0,0,.84)"; ctx.font = "700 34px system-ui, sans-serif";
  let y = pad + 34; tituloLineas.forEach((l) => { ctx.fillText(l.slice(0,100),pad,y,maxW); y += 44; });
  y += 14; ctx.font = `${size}px system-ui, sans-serif`;
  for (const l of lineas) { if (y > h - pad - 50) break; ctx.fillText(l,pad,y,maxW); y += lineH; }
  if (trazos.length) { ctx.save(); ctx.translate(pad,baseTinta); dibujarTrazos(ctx,trazos,maxW,0,1); ctx.restore(); }
  // Marca casi imperceptible: identifica el origen sin competir con el contenido.
  ctx.globalAlpha = .09; ctx.fillStyle = "#172033"; ctx.font = "500 16px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText("Wapper",w-pad,h-pad/2); ctx.globalAlpha = 1; ctx.textAlign = "left";
  return c;
}
async function compartirImagenNota(datos) {
  const c = crearImagenNota(datos);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo crear la imagen");
  const file = new File([blob], "nota-wapper.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) { await navigator.share({ files: [file], title: datos.titulo || "Nota" }); return "compartida"; }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000); return "descargada";
}
export { descargarWapper, leerWapper, compartirImagenNota };
