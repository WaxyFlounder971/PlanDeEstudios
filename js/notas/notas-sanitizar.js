const ETIQUETAS = new Set(["B", "STRONG", "I", "EM", "U", "UL", "OL", "LI", "BR", "DIV", "P", "INPUT", "A"]);

function sanearHTMLNota(html = "") {
  const doc = new DOMParser().parseFromString(String(html), "text/html");
  const limpiar = (nodo) => {
    for (const hijo of [...nodo.childNodes]) {
      if (hijo.nodeType === Node.COMMENT_NODE) { hijo.remove(); continue; }
      if (hijo.nodeType !== Node.ELEMENT_NODE) continue;
      if (!ETIQUETAS.has(hijo.tagName)) {
        limpiar(hijo);
        hijo.replaceWith(...hijo.childNodes);
        continue;
      }
      const marcado = hijo.tagName === "INPUT" && (hijo.checked || hijo.hasAttribute("checked"));
      for (const atributo of [...hijo.attributes]) hijo.removeAttribute(atributo.name);
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
