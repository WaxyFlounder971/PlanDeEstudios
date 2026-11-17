// Pegado limpio para el editor de Notas (sin DOM del editor: se puede probar aparte).
// - Conserva viñetas, listas numeradas y casillas; los títulos pasan a una línea en negrita.
// - Quita los saltos "fantasma": líneas vacías de más y cortes dentro de un mismo párrafo.
// - Con el formato automático: "[]" / "[ ]" / "[x]" al inicio de línea -> casilla, **negrita**, __subrayado__ y "> cita".
// prepararPegado devuelve dos versiones: `literal` (los "[]" quedan como texto) y `convertido` (ya son casillas).
// El editor inserta primero la literal y luego la convertida: así Ctrl+Z solo deshace la conversión.
import { sanearHTMLNota } from "./notas-sanitizar.js";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const RE_CASILLA = /^(?:[-*•]\s*)?\[([ xX]?)\]\s?/;
const RE_SALTO_DURO = /[.:;!?)"»…]$/;
const BLOQUES = new Set(["P", "DIV", "SECTION", "ARTICLE", "HEADER", "FOOTER", "FIGURE", "TABLE", "TR", "TD", "TH", "LI", "DL", "DT", "DD", "MAIN", "ASIDE", "NAV"]);
const IGNORAR = new Set(["SCRIPT", "STYLE", "META", "HEAD", "TITLE", "LINK", "NOSCRIPT", "TEMPLATE"]);

function textoEnLinea(s, o) {
  let t = esc(s);
  if (o.whatsapp) t = t.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, "<b>$1</b>").replace(/__(?=\S)(.+?)(?<=\S)__/g, "<u>$1</u>");
  return t;
}

/** Reconoce viñeta, número, título (#) o cita (>) al inicio de una línea de texto. */
function clasificar(txt, o) {
  let m;
  if ((m = /^#{1,6}\s+(.+)$/.exec(txt))) return { k: "titulo", html: textoEnLinea(m[1], o) };
  if (o.whatsapp && (m = /^>\s?(.*)$/.exec(txt))) return { k: "cita", html: textoEnLinea(m[1], o) };
  if ((m = /^[-*•–]\s+(.+)$/.exec(txt))) return { k: "li", tipo: "ul", html: textoEnLinea(m[1], o) };
  if ((m = /^(\d{1,3})[.)]\s+(.+)$/.exec(txt))) return { k: "li", tipo: "ol", n: parseInt(m[1], 10), html: textoEnLinea(m[2], o) };
  return { k: "linea", html: textoEnLinea(txt, o) };
}

function itemsDeTexto(texto, o) {
  const items = [];
  let separado = true; // hubo una línea vacía antes (o es el inicio)
  for (const cruda of String(texto).replace(/\r\n?/g, "\n").split("\n")) {
    const lin = cruda.replace(/[\u00a0\t]/g, " ").replace(/\s+$/, "").replace(/^\s+/, "");
    if (!lin) { separado = true; continue; }
    const it = clasificar(lin, o);
    const prev = items[items.length - 1];
    // Párrafo cortado a la fuerza (copiado de un PDF): línea larga sin punto final + continuación en minúscula.
    if (it.k === "linea" && prev && prev.k === "linea" && !separado && prev.largo >= 60 && !RE_SALTO_DURO.test(prev.fin) && /^[a-záéíóúñü]/.test(lin)) {
      prev.html += " " + it.html; prev.largo += lin.length + 1; prev.fin = lin;
    } else {
      if (it.k === "linea") { it.largo = lin.length; it.fin = lin; }
      items.push(it);
    }
    separado = false;
  }
  return items;
}

function itemsDeHTML(html, o) {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const items = [];
  let buf = "", marca = null, li = null, titulo = false, cita = 0;
  const vacio = (h) => !h.replace(/<[^>]*>/g, "").replace(/&nbsp;|\s/g, "");
  const flush = () => {
    const h = buf.replace(/\s+/g, " ").trim();
    if (vacio(h) && marca === null) { buf = ""; return; }
    const ck = marca; buf = ""; marca = null;
    if (li) { items.push({ k: "li", tipo: li.tipo, n: li.n, check: ck, html: h }); li = null; return; }
    if (titulo) { items.push({ k: "titulo", html: h }); return; }
    if (cita) { items.push({ k: "cita", html: h }); return; }
    items.push({ k: "linea", html: h, check: ck });
  };
  const walk = (nodo) => {
    for (const c of nodo.childNodes) {
      if (c.nodeType === 3) { buf += textoEnLinea(c.data.replace(/[\s\u00a0]+/g, " "), o); continue; }
      if (c.nodeType !== 1) continue;
      const t = c.tagName;
      if (IGNORAR.has(t)) continue;
      if (t === "BR") { flush(); continue; }
      if (t === "INPUT") { if ((c.getAttribute("type") || "").toLowerCase() === "checkbox") marca = c.checked || c.hasAttribute("checked") ? "x" : " "; continue; }
      if (t === "UL" || t === "OL") {
        flush();
        let n = parseInt(c.getAttribute("start"), 10) || 1;
        for (const x of c.children) {
          if (x.tagName !== "LI") continue;
          flush(); li = { tipo: t.toLowerCase(), n: n++ }; walk(x); flush(); li = null;
        }
        continue;
      }
      if (/^H[1-6]$/.test(t)) { flush(); titulo = true; walk(c); flush(); titulo = false; continue; }
      if (t === "BLOCKQUOTE") { flush(); cita++; walk(c); flush(); cita--; continue; }
      if (t === "PRE") { flush(); for (const l of c.textContent.split("\n")) { buf += textoEnLinea(l, o); flush(); } continue; }
      const st = (c.getAttribute("style") || "").toLowerCase();
      const normal = /font-weight:\s*(normal|[1-4]00)/.test(st);
      let a = "", z = "";
      if ((t === "B" || t === "STRONG") && !normal) { a += "<b>"; z = "</b>" + z; }
      else if (/font-weight:\s*(bold|[6-9]00)/.test(st)) { a += "<b>"; z = "</b>" + z; }
      if (t === "I" || t === "EM" || /font-style:\s*italic/.test(st)) { a += "<i>"; z = "</i>" + z; }
      if (t === "U" || /text-decoration[^;]*underline/.test(st)) { a += "<u>"; z = "</u>" + z; }
      if (BLOQUES.has(t)) { flush(); buf += a; walk(c); buf += z; flush(); continue; }
      buf += a; walk(c); buf += z;
    }
  };
  walk(doc.body);
  flush();
  // Líneas sueltas que en realidad son viñetas, números o "#"/">" escritos a mano.
  return items.flatMap((it) => {
    if (it.k !== "linea" || it.check != null) return [it];
    let m;
    if ((m = /^[-*•–]\s+/.exec(it.html))) return [{ k: "li", tipo: "ul", html: it.html.slice(m[0].length) }];
    if ((m = /^(\d{1,3})[.)]\s+/.exec(it.html))) return [{ k: "li", tipo: "ol", n: parseInt(m[1], 10), html: it.html.slice(m[0].length) }];
    if ((m = /^#{1,6}\s+/.exec(it.html))) return [{ k: "titulo", html: it.html.slice(m[0].length) }];
    if (o.whatsapp && (m = /^&gt;\s?/.exec(it.html))) return [{ k: "cita", html: it.html.slice(m[0].length) }];
    return [it];
  });
}

function construir(items, o) {
  if (o.corchetes) {
    for (const it of items) {
      if (it.k === "titulo" || it.k === "cita" || it.check != null) continue;
      const m = RE_CASILLA.exec(it.html);
      if (!m) continue;
      it.html = it.html.slice(m[0].length);
      it.check = m[1].toLowerCase() === "x" ? "x" : " ";
      if (it.k === "linea") { it.k = "li"; it.tipo = "ul"; }
    }
  }
  const piezas = [];
  for (let i = 0; i < items.length;) {
    const it = items[i];
    if (it.k === "li") {
      const grupo = [];
      while (i < items.length && items[i].k === "li" && items[i].tipo === it.tipo) grupo.push(items[i++]);
      const lis = grupo.map((g) => `<li>${g.check != null ? `<input type="checkbox" data-nota-check="1"${g.check === "x" ? " checked" : ""}>&nbsp;` : ""}${g.html}</li>`).join("");
      piezas.push({ bloque: true, html: it.tipo === "ol" ? `<ol${grupo[0].n > 1 ? ` start="${grupo[0].n}"` : ""}>${lis}</ol>` : `<ul>${lis}</ul>` });
    } else if (it.k === "cita") {
      const grupo = [];
      while (i < items.length && items[i].k === "cita") grupo.push(items[i++].html);
      piezas.push({ bloque: true, html: `<blockquote>${grupo.join("<br>")}</blockquote>` });
    } else {
      piezas.push({ bloque: false, html: it.k === "titulo" ? `<b>${it.html}</b>` : it.html });
      i++;
    }
  }
  return piezas.map((p, j) => (j && !p.bloque && !piezas[j - 1].bloque ? "<br>" : "") + p.html).join("");
}

/** { html, texto } del portapapeles -> { literal, convertido, hayConversion } (HTML ya saneado). */
function prepararPegado({ html = "", texto = "" } = {}, { corchetes = true, whatsapp = true } = {}) {
  const generar = (conCasillas) => {
    const o = { corchetes: conCasillas, whatsapp };
    let items = String(html).trim() ? itemsDeHTML(html, o) : [];
    if (!items.length) items = itemsDeTexto(texto, o);
    return sanearHTMLNota(construir(items, o));
  };
  const literal = generar(false);
  const convertido = corchetes ? generar(true) : literal;
  return { literal, convertido, hayConversion: literal !== convertido };
}

export { prepararPegado };
