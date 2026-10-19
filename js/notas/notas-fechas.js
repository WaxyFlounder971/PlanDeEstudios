// Fechas de Notas: formato legible ("Lun 19, oct 2026, 12:54 pm") y campo propio que abre el selector nativo.
const dos = (n) => String(n).padStart(2, "0");
const idioma = () => document.documentElement.lang || "es";

/** ms -> "YYYY-MM-DD" (hora local). */
function aValorFecha(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
/** "YYYY-MM-DD" -> ms (mediodía local, para no cruzar de día por zona horaria). */
function deValorFecha(iso) {
  const t = new Date(`${String(iso).slice(0, 10)}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : Date.now();
}
function aValorLocal(ms) {
  const d = new Date(ms);
  return `${aValorFecha(ms)}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

function formatear(ms, conHora) {
  const d = new Date(ms), l = idioma();
  const partes = new Intl.DateTimeFormat(l, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
  const g = (t) => partes.find((x) => x.type === t)?.value || "";
  const sem = g("weekday").replace(".", "").replace(/^./, (c) => c.toUpperCase());
  let s = `${sem} ${g("day")}, ${g("month").replace(".", "")} ${g("year")}`;
  if (conHora) {
    const h = new Intl.DateTimeFormat(l, { hour: "numeric", minute: "2-digit", hour12: true }).format(d)
      .replace(/[\u202f\u00a0]/g, " ")
      .replace(/\s*([ap])\.?\s*m\.?/i, (_, x) => ` ${x.toLowerCase()}m`);
    s += `, ${h}`;
  }
  return s;
}

/** Campo de fecha con botón en forma de píldora. tipo: "date" | "datetime-local". Devuelve { el, establecer(ms), abrir() }. */
function crearCampoFecha({ etiqueta = "", tipo = "date", ms, alCambiar, clase = "" }) {
  const conHora = tipo === "datetime-local";
  const wrap = document.createElement("span");
  wrap.className = `nt-fecha ${clase}`.trim();
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "nt-fecha-btn";
  if (etiqueta) { const e = document.createElement("span"); e.className = "nt-fecha-etq"; e.textContent = etiqueta; btn.append(e); }
  const val = document.createElement("span");
  val.className = "nt-fecha-val";
  btn.append(val);
  const input = document.createElement("input");
  input.type = tipo;
  input.className = "nt-fecha-input";
  input.tabIndex = -1;
  input.setAttribute("aria-hidden", "true");
  wrap.append(btn, input);

  const pintar = (v) => {
    if (!Number.isFinite(v)) return;
    ms = v;
    val.textContent = formatear(v, conHora);
    input.value = conHora ? aValorLocal(v) : aValorFecha(v);
    btn.setAttribute("aria-label", `${etiqueta ? etiqueta + ": " : ""}${val.textContent}`);
  };
  const abrir = () => { try { input.showPicker(); } catch (_) { input.focus(); input.click(); } };
  btn.onclick = abrir;
  input.onchange = () => {
    if (!input.value) return;
    const v = conHora ? new Date(input.value).getTime() : deValorFecha(input.value);
    if (!Number.isFinite(v)) return;
    pintar(v);
    alCambiar?.(v);
  };
  pintar(ms ?? Date.now());
  return { el: wrap, establecer: pintar, abrir };
}

export { crearCampoFecha, aValorFecha, deValorFecha, formatear };
