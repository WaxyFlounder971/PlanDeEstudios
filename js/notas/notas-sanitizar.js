const ETIQUETAS = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "DIV", "P", "INPUT", "IMG", "A", "BLOCKQUOTE"]);

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
      if (hijo.tagName === "IMG") {
        const src = hijo.getAttribute("src") || "";
        if (!/^data:image\/(?:png|webp);base64,[\da-z+/=]+$/i.test(src) || src.length > 2_000_000) { hijo.remove(); continue; }
        const imagen = doc.createElement("img");
        imagen.setAttribute("src", src);
        imagen.setAttribute("alt", String(hijo.getAttribute("alt") || "Sticker").slice(0, 100));
        const cssAncho = parseFloat(hijo.style.width), cssAlto = parseFloat(hijo.style.height);
        const ancho = Math.round(cssAncho || parseInt(hijo.getAttribute("width"), 10)), alto = Math.round(cssAlto || parseInt(hijo.getAttribute("height"), 10));
        if (Number.isFinite(ancho) && ancho > 0 && ancho <= 2048) imagen.setAttribute("width", String(ancho));
        if (Number.isFinite(alto) && alto > 0 && alto <= 2048) imagen.setAttribute("height", String(alto));
        imagen.setAttribute(hijo.hasAttribute("data-nota-image") ? "data-nota-image" : "data-nota-sticker", "1");
        for (const nombre of ["data-rot", "data-flip-h", "data-flip-v", "data-move-x", "data-move-y", "data-z"]) {
          const v = Number(hijo.getAttribute(nombre));
          if (Number.isFinite(v) && Math.abs(v) <= (nombre === "data-move-x" || nombre === "data-move-y" ? 3 : 2000)) imagen.setAttribute(nombre, String(nombre === "data-rot" ? ((v % 360) + 360) % 360 : v));
        }
        hijo.replaceWith(imagen);
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
  const esVistaPrevia = contenedor.classList.contains("nota-preview");
  const lienzo = esVistaPrevia ? (contenedor.ownerDocument || document).createElement("div") : null;
  if (lienzo) {
    lienzo.className = "nota-preview-lienzo";
    lienzo.innerHTML = sanearHTMLNota(html);
    contenedor.replaceChildren(lienzo);
    contenedor.classList.add("nt-preview-escalado");
  } else contenedor.innerHTML = sanearHTMLNota(html);
  contenedor.querySelectorAll("ul[data-marc-color],ol[data-marc-color]").forEach((l) => l.style.setProperty("--nt-marker-color", l.getAttribute("data-marc-color")));
  contenedor.querySelectorAll("input[type=checkbox]").forEach((check) => { check.disabled = true; });
  contenedor.querySelectorAll("img[data-nota-sticker],img[data-nota-image]").forEach((img) => {
    img.draggable = false;
    img.style.maxWidth = "none";
    img.style.maxHeight = "none";
    // Reproduce las coordenadas del editor en un lienzo fijo que luego se escala completo.
    img.style.boxSizing = "content-box";
    img.style.display = "block";
    img.style.resize = "none";
    img.style.overflow = "visible";
    img.style.objectFit = "contain";
    img.style.position = "relative";
    img.style.transformOrigin = "center center";
    img.style.zIndex = String(Number.isFinite(Number(img.dataset.z)) && img.dataset.z !== "" ? Number(img.dataset.z) : 10);
  });
  const stickers = [...contenedor.querySelectorAll("img[data-nota-sticker],img[data-nota-image]")];
  let ro = null;
  const actualizar = () => {
    if (!contenedor.isConnected) { ro?.disconnect(); return; }
    const baseLienzo = 700;
    stickers.forEach((img) => {
      const originalW = Math.max(1, Number(img.getAttribute("width")) || img.naturalWidth || 220);
      const originalH = Math.max(1, Number(img.getAttribute("height")) || img.naturalHeight || 160);
      const rot = Number(img.dataset.rot) || 0, rad = rot * Math.PI / 180;
      const escala = Math.min(1, baseLienzo / Math.max(1, originalW * Math.abs(Math.cos(rad)) + originalH * Math.abs(Math.sin(rad))));
      let ancho = originalW * escala, alto = originalH * escala;
      const anchoRotado = ancho * Math.abs(Math.cos(rad)) + alto * Math.abs(Math.sin(rad));
      const margenRotacion = Math.max(0, (anchoRotado - ancho) / 2);
      const desplazamiento = (Number(img.dataset.moveX) || 0) * baseLienzo;
      const x = Math.min(Math.max(desplazamiento, margenRotacion), Math.max(margenRotacion, baseLienzo - ancho - margenRotacion));
      const y = (Number(img.dataset.moveY) || 0) * baseLienzo;
      img.style.width = `${ancho}px`;
      img.style.height = `${alto}px`;
      img.style.transform = `translate(${x}px,${y}px) rotate(${rot}deg) scale(${img.dataset.flipH === "1" ? -1 : 1},${img.dataset.flipV === "1" ? -1 : 1})`;
    });
    if (lienzo) {
      const anchoVisible = Math.max(1, contenedor.clientWidth || 700);
      const escala = anchoVisible / baseLienzo;
      lienzo.style.transform = `scale(${escala})`;
      const caja = lienzo.getBoundingClientRect();
      let altoContenido = lienzo.scrollHeight;
      for (const img of stickers) {
        const r = img.getBoundingClientRect();
        altoContenido = Math.max(altoContenido, (r.bottom - caja.top) / escala);
      }
      const altoFinal = Math.max(1, Math.ceil(altoContenido * escala));
      if (Math.abs(contenedor.getBoundingClientRect().height - altoFinal) > 1) contenedor.style.setProperty("height", `${altoFinal}px`, "important");
    }
  };
  actualizar();
  if (typeof ResizeObserver === "function" && (stickers.length || lienzo)) { ro = new ResizeObserver(actualizar); ro.observe(contenedor); if (lienzo) ro.observe(lienzo); }
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
