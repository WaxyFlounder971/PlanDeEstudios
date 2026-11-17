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
      tinta: Array.isArray(nota.tinta) ? nota.tinta.slice(0, 5000).map((t) => ({ c: /^#[\da-f]{6}$/i.test(t.c || "") ? t.c : "#172033", w: Math.max(.001, Math.min(.03, Number(t.w) || .0045)), f: t.f ? 1 : undefined, a: t.a ? 1 : undefined, tipo: t.tipo || undefined, p: Array.isArray(t.p) ? t.p.slice(0, 60000).map((p) => [Number(p[0]) || 0, Number(p[1]) || 0, Number.isFinite(p[2]) ? p[2] : undefined].filter((x) => x !== undefined)) : [] })) : [],
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
    tinta: Array.isArray(n.tinta) ? n.tinta.slice(0, 5000).filter((t) => t && Array.isArray(t.p)).map((t) => ({ c: /^#[\da-f]{6}$/i.test(t.c || "") ? t.c : "#172033", w: Math.max(.001, Math.min(.03, Number(t.w) || .0045)), f: t.f ? 1 : undefined, a: t.a ? 1 : undefined, tipo: ["circulo", "elipse", "cuadrado", "rectangulo", "triangulo", "estrella", "pentagrama", "corazon", "figura"].includes(t.tipo) ? t.tipo : undefined, p: t.p.slice(0, 60000).filter((p) => Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1])).map((p) => [Math.max(-2,Math.min(3,+p[0])),Math.max(-2,Math.min(8,+p[1])),Number.isFinite(+p[2])?Math.max(0,Math.min(1,+p[2])):undefined].filter((x)=>x!==undefined)) })) : [],
  };
}

async function crearImagenNota({ titulo = "", contenido = "", color = "#fff594", colorTexto = "#172033", trazos = [], marcaAgua = true }) {
  const w = 900, pad = 44, maxW = w - pad * 2, titleFont = '700 34px system-ui, sans-serif';
  const c = document.createElement("canvas"), ctx = c.getContext("2d");
  const raiz = document.createElement("div");
  raiz.innerHTML = sanearHTMLNota(contenido || "");
  const texto = [];
  const medir = (value, font) => { ctx.font = font; return ctx.measureText(value).width; };
  const lineasTexto = (value, font, max = maxW) => {
    const out = []; let actual = "";
    for (const palabra of String(value || "").split(/\s+/u).filter(Boolean)) {
      const siguiente = actual ? `${actual} ${palabra}` : palabra;
      if (actual && medir(siguiente, font) > max) { out.push(actual); actual = palabra; } else actual = siguiente;
    }
    if (actual) out.push(actual);
    return out;
  };
  function recorrer(nodo, nivelLista = 0, numero = 1) {
    if (nodo.nodeType === Node.TEXT_NODE) {
      const value = nodo.nodeValue.replace(/\s+/gu, " ");
      if (value.trim()) texto.push({ tipo: "texto", value });
      return;
    }
    if (nodo.nodeType !== Node.ELEMENT_NODE) return;
    const tag = nodo.tagName.toLowerCase();
    if (tag === "br") { texto.push({ tipo: "salto" }); return; }
    if (tag === "font") {
      const color = nodo.getAttribute("color");
      if (/^#[\da-f]{6}$/i.test(color || "")) texto.push({ tipo: "color", valor: color.toLowerCase() });
      [...nodo.childNodes].forEach((hijo) => recorrer(hijo, nivelLista));
      if (/^#[\da-f]{6}$/i.test(color || "")) texto.push({ tipo: "color", valor: null });
      return;
    }
    if (tag === "ul" || tag === "ol") {
      [...nodo.children].filter((x) => x.tagName === "LI").forEach((li, i) => {
        texto.push({ tipo: "item", lista: tag, numero: tag === "ol" ? Number(nodo.getAttribute("start") || 1) + i : 0, nivel: nivelLista, color: nodo.getAttribute("data-marc-color") });
        [...li.childNodes].forEach((hijo) => recorrer(hijo, nivelLista + 1));
        texto.push({ tipo: "fin-item" });
      });
      texto.push({ tipo: "salto", espacio: 5 }); return;
    }
    if (tag === "li") { [...nodo.childNodes].forEach((hijo) => recorrer(hijo, nivelLista)); return; }
    if (["p", "div", "blockquote", "h1", "h2", "h3"].includes(tag)) {
      if (texto.length && texto.at(-1).tipo !== "salto") texto.push({ tipo: "salto", espacio: 8 });
      if (tag === "blockquote") texto.push({ tipo: "cita-inicio" });
      [...nodo.childNodes].forEach((hijo) => recorrer(hijo, nivelLista));
      if (tag === "blockquote") texto.push({ tipo: "cita-fin" });
      texto.push({ tipo: "salto", espacio: tag.startsWith("h") ? 12 : 5 }); return;
    }
    if (tag === "input" && nodo.type === "checkbox") { texto.push({ tipo: "casilla", checked: nodo.checked || nodo.hasAttribute("checked") }); return; }
    if (tag === "img" && (nodo.hasAttribute("data-nota-sticker") || nodo.hasAttribute("data-nota-image"))) { texto.push({ tipo: "imagen", src: nodo.src, unico: nodo.hasAttribute("data-nota-image"), ancho: Number(nodo.getAttribute("width")) || 220, alto: Number(nodo.getAttribute("height")) || 160, rot: Number(nodo.dataset.rot) || 0, flipH: nodo.dataset.flipH === "1", flipV: nodo.dataset.flipV === "1", moveX: Number(nodo.dataset.moveX) || 0, moveY: Number(nodo.dataset.moveY) || 0, z: Number(nodo.dataset.z) || 0 }); return; }
    const estilo = { "strong": "bold", "b": "bold", "em": "italic", "i": "italic", "u": "underline" }[tag];
    if (estilo) texto.push({ tipo: "estilo", estilo, valor: true });
    [...nodo.childNodes].forEach((hijo) => recorrer(hijo, nivelLista));
    if (estilo) texto.push({ tipo: "estilo", estilo, valor: false });
  }
  [...raiz.childNodes].forEach((n) => recorrer(n));

  const tituloLineas = [];
  ctx.font = titleFont;
  for (const parrafo of String(titulo).split(/\r?\n/u)) tituloLineas.push(...lineasTexto(parrafo, titleFont));
  const tintaTexto = /^#[\da-f]{6}$/i.test(colorTexto) ? colorTexto : "#172033";
  const bloques = []; let y = pad + 26;
  for (const linea of tituloLineas) { bloques.push({ tipo: "titulo", value: linea, y }); y += 43; }
  y += 15;
  const inicioCuerpo = y;
  let bold = false, italic = false, underline = false, colorTextoActual = null, cita = 0, item = null, linea = "", x = pad, lineH = 30;
  const fontActual = () => `${italic ? "italic " : ""}${bold ? "700" : "400"} 23px system-ui, sans-serif`;
  const colorActual = () => /^#[\da-f]{6}$/i.test(colorTextoActual || "") ? colorTextoActual : tintaTexto;
  function iniciarLinea() {
    if (item && !linea && x === pad) {
      const sangria = pad + item.nivel * 24;
      const markerX = sangria + 3;
      bloques.push({ tipo: "marcador", lista: item.lista, numero: item.numero, color: item.color, x: markerX, y: y + 19 });
      x = sangria + 30;
    } else if (!item) x = pad + cita * 17;
  }
  function vaciar(continuar = false) {
    if (!linea) return;
    const font = fontActual(), value = linea;
    bloques.push({ tipo: "texto", value, x, y, font, underline, color: colorActual() });
    linea = "";
    if (continuar) x += medir(value, font);
    else y += lineH;
  }
  for (const token of texto) {
    if (token.tipo === "estilo") { vaciar(true); if (token.estilo === "bold") bold = token.valor; if (token.estilo === "italic") italic = token.valor; if (token.estilo === "underline") underline = token.valor; continue; }
    if (token.tipo === "color") { vaciar(true); colorTextoActual = token.valor; continue; }
    if (token.tipo === "cita-inicio") { bloques.push({ tipo: "cita-barra", x: pad + cita * 17, y0: y, y1: null }); cita++; continue; }
    if (token.tipo === "cita-fin") { cita = Math.max(0, cita - 1); const barra = [...bloques].reverse().find((b) => b.tipo === "cita-barra" && b.y1 == null); if (barra) barra.y1 = y; continue; }
    if (token.tipo === "item") { vaciar(); item = token; x = pad; iniciarLinea(); continue; }
    if (token.tipo === "fin-item") { vaciar(); item = null; x = pad; y += 3; continue; }
    if (token.tipo === "salto") { vaciar(); if (item && x > pad) x = pad + item.nivel * 24 + 30; else if (!item) x = pad + cita * 17; y += token.espacio || 0; continue; }
    if (token.tipo === "casilla") { iniciarLinea(); const size = 18; if (x + size > w - pad) { vaciar(); iniciarLinea(); } bloques.push({ tipo: "casilla", x, y: y + 3, checked: token.checked }); x += 25; continue; }
    if (token.tipo === "imagen") { vaciar(); const iw = Math.min(maxW, Math.max(24, token.ancho)); const ih = Math.max(24, iw * token.alto / Math.max(1, token.ancho)); bloques.push({ ...token, ancho: iw, alto: ih, x: pad, y }); y += ih + 8; x = pad; continue; }
    if (token.tipo === "marcador") continue;
    const font = fontActual();
    for (const palabra of token.value.split(/(\s+)/u).filter(Boolean)) {
      iniciarLinea();
      const siguiente = linea + palabra;
      if (linea && medir(siguiente, font) > w - pad - x) { vaciar(); iniciarLinea(); }
      else if (!linea && medir(palabra, font) > w - pad - x) { y += lineH; iniciarLinea(); }
      if (!linea && /^\s+$/u.test(palabra)) continue;
      linea += palabra;
    }
  }
  vaciar();
  const maxY = trazos.flatMap((t) => t.p || []).reduce((m, p) => Math.max(m, Number(p[1]) || 0), 0);
  const tintaY = inicioCuerpo, tintaBottom = trazos.length ? tintaY + maxY * maxW + 24 : 0;
  const imagenBottom = bloques.filter((b) => b.tipo === "imagen").reduce((m,b) => Math.max(m,b.y + b.moveY * maxW + b.alto + 16), 0);
  const h = Math.max(260, y + pad + (marcaAgua ? 26 : 0), tintaBottom + pad + (marcaAgua ? 26 : 0), imagenBottom + pad + (marcaAgua ? 26 : 0));
  c.width = w; c.height = h;
  ctx.fillStyle = /^#[\da-f]{6}$/i.test(color) ? color : "#fff594"; ctx.fillRect(0, 0, w, h);
  const imagenes = new Map(await Promise.all(bloques.filter((b) => b.tipo === "imagen").map(async (b) => {
    const imagen = new Image(); imagen.src = b.src;
    try { await imagen.decode(); } catch (_) {}
    return [b.src, imagen];
  })));
  for (const bloque of bloques) {
    if (bloque.tipo === "cita-barra") { ctx.strokeStyle = "rgba(23,32,51,.45)"; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(bloque.x, bloque.y0); ctx.lineTo(bloque.x, bloque.y1 ?? y); ctx.stroke(); continue; }
    if (bloque.tipo === "titulo") { ctx.fillStyle = tintaTexto; ctx.font = titleFont; ctx.fillText(bloque.value, pad, bloque.y, maxW); continue; }
    if (bloque.tipo === "texto") { ctx.fillStyle = bloque.color || tintaTexto; ctx.font = bloque.font; ctx.fillText(bloque.value, bloque.x, bloque.y, w - pad - bloque.x); if (bloque.underline) { const width = Math.min(ctx.measureText(bloque.value).width, w - pad - bloque.x); ctx.strokeStyle = bloque.color || tintaTexto; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(bloque.x, bloque.y + 3); ctx.lineTo(bloque.x + width, bloque.y + 3); ctx.stroke(); } continue; }
    if (bloque.tipo === "marcador") { ctx.fillStyle = /^#[\da-f]{6}$/i.test(bloque.color || "") ? bloque.color : tintaTexto; ctx.font = "23px system-ui, sans-serif"; ctx.fillText(bloque.lista === "ol" ? `${bloque.numero}.` : "•", bloque.x, bloque.y); continue; }
    if (bloque.tipo === "casilla") { ctx.strokeStyle = tintaTexto; ctx.lineWidth = 2; ctx.strokeRect(bloque.x, bloque.y, 17, 17); if (bloque.checked) { ctx.beginPath(); ctx.moveTo(bloque.x + 3, bloque.y + 9); ctx.lineTo(bloque.x + 7, bloque.y + 13); ctx.lineTo(bloque.x + 14, bloque.y + 4); ctx.stroke(); } continue; }
    if (bloque.tipo === "imagen") { const img = imagenes.get(bloque.src); if (img?.complete && img.naturalWidth) { ctx.save(); ctx.translate(bloque.x + bloque.moveX * maxW + bloque.ancho / 2, bloque.y + bloque.moveY * maxW + bloque.alto / 2); ctx.rotate((bloque.rot || 0) * Math.PI / 180); ctx.scale(bloque.flipH ? -1 : 1, bloque.flipV ? -1 : 1); ctx.drawImage(img, -bloque.ancho / 2, -bloque.alto / 2, bloque.ancho, bloque.alto); ctx.restore(); } continue; }
  }
  if (trazos.length) { ctx.save(); ctx.translate(pad, tintaY); dibujarTrazos(ctx, trazos, maxW, 0, 1); ctx.restore(); }
  if (marcaAgua) { ctx.globalAlpha = .09; ctx.fillStyle = "#172033"; ctx.font = "500 15px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText("Wapper", w - pad, h - 22); ctx.globalAlpha = 1; ctx.textAlign = "left"; }
  return c;
}
async function compartirImagenNota(datos) {
  const c = await crearImagenNota(datos);
  const blob = await new Promise((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No se pudo crear la imagen");
  const file = new File([blob], "nota-wapper.png", { type: "image/png" });
  if (navigator.canShare?.({ files: [file] }) && navigator.share) { try { await navigator.share({ files: [file], title: datos.titulo || "Nota" }); return "compartida"; } catch (e) { if (e?.name === "AbortError") throw e; /* sin permiso de compartir (p. ej. caducó el gesto del usuario): se descarga */ } }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href),1000); return "descargada";
}
export { descargarWapper, leerWapper, compartirImagenNota };
