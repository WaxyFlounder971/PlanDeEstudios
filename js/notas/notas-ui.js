// Utilidades de interfaz compartidas por Notas: iconos SVG, contraste, checkboxes de las vistas previas.
import { guardarNota } from "./notas-datos.js";
import { conHistorial } from "./notas-historial.js";

const svg = (inner) => `<svg class="nt-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

const ICONOS = {
  anclar: svg('<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>'),
  flotar: svg('<path d="M15.5 3H5a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z"/><path d="M15 3v6h6"/>'),
  quitarFlotante: svg('<polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/><line x1="14" x2="21" y1="10" y2="3"/><line x1="3" x2="10" y1="21" y2="14"/>'),
  compartir: svg('<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" x2="15.42" y1="13.51" y2="17.49"/><line x1="15.41" x2="8.59" y1="6.51" y2="10.49"/>'),
  duplicar: svg('<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>'),
  editar: svg('<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/><path d="m15 5 4 4"/>'),
  cerrar: svg('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
  chevron: svg('<path d="m6 9 6 6 6-6"/>'),
  wapper: svg('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>'),
  papelera: svg('<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/>'),
  asa: '<svg class="nt-ico nt-ico-solido" viewBox="0 0 16 16" aria-hidden="true"><circle cx="5.5" cy="3.5" r="1.45"/><circle cx="10.5" cy="3.5" r="1.45"/><circle cx="5.5" cy="8" r="1.45"/><circle cx="10.5" cy="8" r="1.45"/><circle cx="5.5" cy="12.5" r="1.45"/><circle cx="10.5" cy="12.5" r="1.45"/></svg>',
};

function el(tag, clase, texto) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

/** Texto oscuro o blanco según la luminancia del fondo. */
function contraste(hex) {
  const m = /^#([\da-f]{6})$/i.exec(hex || "");
  if (!m) return "#172033";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.179 ? "#172033" : "#ffffff";
}

/** Color de letra de una nota: el que el usuario eligió (color_texto) o, si no, el de mayor contraste con el fondo. */
function colorTextoNota(nota, fondo) {
  const c = String(nota?.color_texto || "");
  return /^#[\da-f]{6}$/i.test(c) ? c : contraste(fondo);
}

/** Botón de icono (SVG o emoji) con título accesible. */
function botonIcono({ icono, titulo, clase = "", onclick, activo = false }) {
  const b = el("button", `nota-icon-action ${clase}`.trim());
  b.type = "button";
  if (String(icono).startsWith("<svg")) b.innerHTML = icono; else b.textContent = icono;
  b.title = titulo;
  b.setAttribute("aria-label", titulo);
  if (activo) { b.classList.add("activo"); b.setAttribute("aria-pressed", "true"); }
  b.onclick = onclick;
  return b;
}

/** Hace funcionales los checkboxes de una vista previa (tarjeta, sticky, flotante) y guarda con historial. */
function enlazarChecks(preview, nota, alCambiar) {
  preview.querySelectorAll("input[type=checkbox]").forEach((check, i) => {
    check.disabled = false;
    check.addEventListener("click", (e) => {
      e.stopPropagation();
      conHistorial("Marcar pendiente", [nota.id], () => {
        const parsed = new DOMParser().parseFromString(nota.contenido, "text/html");
        const todos = parsed.querySelectorAll("input[type=checkbox]");
        if (todos[i]) { todos[i].checked = check.checked; todos[i].toggleAttribute("checked", check.checked); }
        nota.contenido = parsed.body.innerHTML;
        guardarNota(nota);
      });
      alCambiar?.();
    });
  });
}

export { ICONOS, el, contraste, colorTextoNota, botonIcono, enlazarChecks };
