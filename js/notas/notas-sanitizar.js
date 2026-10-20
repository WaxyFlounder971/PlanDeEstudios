const ETIQUETAS = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "DIV", "P", "INPUT", "A", "BLOCKQUOTE"]);

// Color de texto permitido: solo hex (#rgb / #rrggbb) o rgb(); se normaliza a #rrggbb. Cualquier otro valor se descarta.
const hex2 = (n) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
function colorValido(v) {
  const s = String(v || "").trim().toLowerCase();
  let m = /^#([\da-f]{3})$/.exec(s);
  if (m) return "#" + [...m[1]].map((c) => c + c).join("");
  m = /^#([\da-f]{6})$/.exec(s);
  if (m) return "#" + m[1];
  m = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*[\d.]+\s*)?\)$/.exec(s);
  if (m) return "#" + [m[1], m[2], m[3]].map((x) => hex2(parseInt(x, 10))).join("");
  return null;
}

function sanearHTMLNota(html = "") {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const limpiar = (nodo) => {
    for (const hijo of [...nodo.childNodes]) {
      if (hijo.nodeType === Node.COMMENT_NODE) { hijo.remove(); continue; }
      if (hijo.nodeType !== Node.ELEMENT_NODE) continue;
      // Color de texto: solo <font color="..."> (lo que genera el editor). Los <span style> que el navegador agrega al unir líneas se descartan.
      if (hijo.tagName === "FONT") {
        const color = colorValido(hijo.getAttribute("color"));
        limpiar(hijo);
        if (!color) { hijo.replaceWith(...hijo.childNodes); continue; }
        const f = doc.createElement("font");
        f.setAttribute("color", color);
        f.append(...hijo.childNodes);
        hijo.replaceWith(f);
        continue;
      }
      if (!ETIQUETAS.has(hijo.tagName)) {
        limpiar(hijo);
        hijo.replaceWith(...hijo.childNodes);
        continue;
      }
      const marcado = hijo.tagName === "INPUT" && (hijo.checked || hijo.hasAttribute("checked"));
      const inicio = hijo.tagName === "OL" ? parseInt(hijo.getAttribute("start"), 10) : NaN; // lista numerada que empieza en otro número
      const colorMarcador = (hijo.tagName === "UL" || hijo.tagName === "OL") && /^#[\da-f]{6}$/i.test(hijo.getAttribute("data-marc-color") || "") ? hijo.getAttribute("data-marc-color").toLowerCase() : null;
      for (const atributo of [...hijo.attributes]) hijo.removeAttribute(atributo.name);
      if (Number.isInteger(inicio) && inicio > 1 && inicio < 10000) hijo.setAttribute("start", String(inicio));
      if (colorMarcador) hijo.setAttribute("data-marc-color", colorMarcador);
      if (hijo.tagName === "INPUT") {
        hijo.type = "checkbox";
        hijo.disabled = false;
        hijo.checked = marcado;
        if (marcado) hijo.setAttribute("checked", "");
        hijo.setAttribute("data-nota-check", "1");
      }
      if (hijo.tagName === "A") hijo.remove();
      else limpiar(hijo);
    }
  };
  limpiar(doc.body);
  return doc.body.innerHTML;
}

function textoPlanoNota(html = "") {
  const doc = new DOMParser().parseFromString(sanearHTMLNota(html), "text/html");
  doc.querySelectorAll("input[type=checkbox]").forEach((c) => c.replaceWith(document.createTextNode(c.checked ? "☑ " : "☐ ")));
  return (doc.body.innerText || doc.body.textContent || "").replace(/\u00a0/g, " ").trim();
}

function escaparHTMLNota(texto = "") {
  return String(texto).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function renderizarHTMLNota(contenedor, html) {
  contenedor.innerHTML = sanearHTMLNota(html);
  contenedor.querySelectorAll("ul[data-marc-color],ol[data-marc-color]").forEach((l) => l.style.setProperty("--nt-marker-color", l.getAttribute("data-marc-color")));
  contenedor.querySelectorAll("input[type=checkbox]").forEach((check) => { check.disabled = true; });
  contenedor.querySelectorAll("a").forEach((a) => {
    const url = a.getAttribute("href") || "";
    if (/^https?:\/\//i.test(url)) { a.rel = "noopener noreferrer"; a.target = "_blank"; }
    else a.replaceWith(document.createTextNode(a.textContent || ""));
  });
  const regex = /https?:\/\/[^\s<]+/g;
  const walker = document.createTreeWalker(contenedor, NodeFilter.SHOW_TEXT);
  const nodos = [];
  while (walker.nextNode()) if (walker.currentNode.nodeValue.match(regex)) nodos.push(walker.currentNode);
  nodos.forEach((nodo) => {
    const fragmento = document.createDocumentFragment(); let inicio = 0;
    nodo.nodeValue.replace(regex, (url, indice) => {
      fragmento.append(document.createTextNode(nodo.nodeValue.slice(inicio, indice)));
      const a = document.createElement("a"); a.href = url; a.textContent = url; a.target = "_blank"; a.rel = "noopener noreferrer"; a.addEventListener("click", (e) => e.stopPropagation()); fragmento.append(a); inicio = indice + url.length;
    });
    fragmento.append(document.createTextNode(nodo.nodeValue.slice(inicio))); nodo.replaceWith(fragmento);
  });
}

export { sanearHTMLNota, textoPlanoNota, escaparHTMLNota, renderizarHTMLNota };
