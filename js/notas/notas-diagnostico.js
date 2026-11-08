// v3.28.0 D2: diagnóstico OPT-IN de "notas negras" (teléfono). NO hace nada si no se activa.
// Activar:  abrir la app con  ?diag=notas  (lee también el lienzo con getImageData)
//           o con  ?diag=notas-sinsonda  (igual, pero SIN leer píxeles: la lectura puede cambiar cómo Chrome pinta el canvas)
// Desactivar: abrir con  ?diag=off , o en la consola  window.__ntDiag.quitar() , o borrar este archivo y su import en notas-editor.js.
// Muestra, arriba a la derecha, los estilos computados del editor, del cuerpo y del lienzo de tinta. Tocar el panel alterna resumen/completo.
// Herramienta temporal para captura de pantalla: sin i18n a propósito, no persiste nada salvo una marca en sessionStorage.

const CLAVE = "nt_diag";
const VER = "v3.28.0";
const ID_PANEL = "nt-diag-panel";

function modoDiag() {
  let q = null;
  try { q = new URLSearchParams(location.search).get("diag"); } catch { /* sin location */ }
  const valida = q === "notas" || q === "notas-sinsonda";
  try {
    if (valida) sessionStorage.setItem(CLAVE, q === "notas" ? "1" : "2");
    else if (q === "off") sessionStorage.removeItem(CLAVE);
    const g = sessionStorage.getItem(CLAVE);
    return g === "1" ? "sonda" : g === "2" ? "sinsonda" : null;
  } catch {
    return valida ? (q === "notas" ? "sonda" : "sinsonda") : null;
  }
}

const cs = (el, p) => { try { return getComputedStyle(el).getPropertyValue(p) || "-"; } catch { return "?"; } };
const caja = (el) => { const r = el.getBoundingClientRect(); return `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.left)},${Math.round(r.top)}`; };
const etiqueta = (el) => `${el.tagName.toLowerCase()}${typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""}`;
const mq = (q) => { try { return matchMedia(q).matches ? "sí" : "no"; } catch { return "?"; } };

/** Lee 5 píxeles del lienzo (r,g,b,a). Alfa 0 = transparente; alfa 255 con r,g,b = 0 = NEGRO opaco. */
function muestrasAlfa(c) {
  try {
    const ctx = c.getContext("2d"); // devuelve el contexto ya creado; no cambia sus atributos
    if (!ctx || !c.width || !c.height) return "sin contexto o sin tamaño";
    return [[.5, .5], [.1, .1], [.9, .1], [.1, .9], [.9, .9]].map(([fx, fy]) => {
      const d = ctx.getImageData(Math.min(c.width - 1, Math.floor(c.width * fx)), Math.min(c.height - 1, Math.floor(c.height * fy)), 1, 1).data;
      return `${d[0]},${d[1]},${d[2]},${d[3]}`;
    }).join(" | ");
  } catch (e) { return `error ${(e && e.name) || e}`; }
}

function construir(modo, bateria) {
  const todo = [], resumen = [];
  const add = (t, res = false) => { todo.push(t); if (res) resumen.push(t); };
  const html = document.documentElement, vv = window.visualViewport;
  add(`DIAG notas ${VER} · ${modo} · ${new Date().toLocaleTimeString("es-CR")}`, true);
  add(`UA …${navigator.userAgent.slice(-80)}`);
  add(`inner ${innerWidth}x${innerHeight} · visual ${vv ? `${Math.round(vv.width)}x${Math.round(vv.height)} top${Math.round(vv.offsetTop)}` : "n/d"} · dpr ${devicePixelRatio}`);
  add(`sistema-oscuro:${mq("(prefers-color-scheme: dark)")} · mov-reducido:${mq("(prefers-reduced-motion: reduce)")} · colores-forzados:${mq("(forced-colors: active)")} · ahorro-datos:${navigator.connection?.saveData ? "sí" : "no"}`);
  add(`html mode=${html.dataset.mode || "-"} paleta=${html.dataset.palette || "-"} rend=${html.dataset.rendimiento || "-"} esquema=${cs(html, "color-scheme")} body-bg=${cs(document.body, "background-color")}`);
  add(`batería: ${bateria} (el modo ahorro no se puede leer desde la web: anótalo tú)`);
  const modal = document.querySelector(".notas-editor");
  if (!modal) { add("editor: NO abierto", true); return { todo, resumen }; }
  const cuerpo = modal.querySelector(".notas-cuerpo"), vp = modal.querySelector(".nt-lienzo-viewport");
  add(`editor ${caja(modal)} bg=${cs(modal, "background-color")} blur=${cs(modal, "backdrop-filter")} esquema=${cs(modal, "color-scheme")} --nota-color=${modal.style.getPropertyValue("--nota-color") || "-"}`);
  if (vp) add(`viewport ${caja(vp)} overflow=${cs(vp, "overflow")}`);
  if (cuerpo) add(`cuerpo ${caja(cuerpo)} bg=${cs(cuerpo, "background-color")} color=${cs(cuerpo, "color")} texto=${(cuerpo.textContent || "").length}c`, true);
  const lienzos = [...modal.querySelectorAll(".nt-tinta-canvas")];
  add(`lienzos de tinta: ${lienzos.length}`, true);
  lienzos.forEach((c, i) => {
    add(`#${i} cls=${c.className} attr=${c.width}x${c.height} css=${caja(c)} z=${cs(c, "z-index")} vis=${cs(c, "visibility")} op=${cs(c, "opacity")} bg=${cs(c, "background-color")} blend=${cs(c, "mix-blend-mode")} filtro=${cs(c, "filter")}`, true);
    add(`#${i} rgba ${modo === "sonda" ? muestrasAlfa(c) : "(sonda desactivada)"}`, true);
  });
  const ref = lienzos[0] || vp || modal, r = ref.getBoundingClientRect();
  const pila = document.elementsFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2))
    .filter((e) => e.id !== ID_PANEL).slice(0, 5).map((e) => `${etiqueta(e)}(z${cs(e, "z-index")})`).join(" > ");
  add(`en el centro del lienzo: ${pila}`);
  return { todo, resumen };
}

function iniciar(modo) {
  if (document.getElementById(ID_PANEL)) return;
  const panel = document.createElement("div");
  panel.id = ID_PANEL;
  panel.setAttribute("aria-hidden", "true");
  panel.style.cssText = "position:fixed;top:calc(env(safe-area-inset-top,0px) + 4px);right:4px;z-index:2147483647;max-width:min(94vw,440px);max-height:46vh;overflow:hidden;padding:6px 8px;border-radius:8px;font:10px/1.25 ui-monospace,Menlo,monospace;background:rgba(0,0,0,.88);color:white;white-space:pre-wrap;overflow-wrap:anywhere;";
  let compacto = false, bateria = "n/d";
  try {
    navigator.getBattery?.().then((b) => {
      const f = () => { bateria = `${Math.round(b.level * 100)}% ${b.charging ? "cargando" : "sin cargar"}`; };
      f(); b.addEventListener("levelchange", f); b.addEventListener("chargingchange", f);
    }).catch(() => {});
  } catch { /* sin API de batería */ }
  const pintar = () => { try { const { todo, resumen } = construir(modo, bateria); panel.textContent = (compacto ? resumen : todo).join("\n"); } catch (e) { panel.textContent = `DIAG error: ${e && e.message}`; } };
  panel.addEventListener("click", () => { compacto = !compacto; pintar(); });
  document.body.append(panel);
  const id = setInterval(pintar, 1000);
  window.visualViewport?.addEventListener("resize", pintar);
  pintar();
  window.__ntDiag = {
    quitar() {
      clearInterval(id);
      window.visualViewport?.removeEventListener("resize", pintar);
      panel.remove();
      try { sessionStorage.removeItem(CLAVE); } catch { /* sin sessionStorage */ }
      delete window.__ntDiag;
    },
  };
}

const modoActivo = typeof document !== "undefined" ? modoDiag() : null;
if (modoActivo) {
  if (document.body) iniciar(modoActivo);
  else document.addEventListener("DOMContentLoaded", () => iniciar(modoActivo), { once: true });
}