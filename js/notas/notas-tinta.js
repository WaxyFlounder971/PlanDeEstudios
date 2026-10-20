// Tinta (lápiz y borrador) para notas.
// Los trazos se guardan normalizados: x e y están divididos por el ancho del cuerpo de la nota,
// así se ven igual sin importar el tamaño de pantalla.
// Trazo: { c: "#color", w: grosor relativo, p: [[x, y, presión?], ...], f?: 1 (figura: líneas rectas) }
import { reconocerForma } from "./notas-formas.js";

const GROSOR_BASE = 0.0045;
const PASO_MIN = 0.0008;      // distancia mínima entre puntos guardados
const RADIO_BORRADOR = 0.022; // radio del borrador (relativo al ancho)
const MAX_PUNTOS = 60000;
const ESPERA_FORMA = 550;     // ms quieto para convertir el trazo en figura limpia
const QUIETO = 0.007;         // movimiento (relativo) que reinicia la espera
const MAX_HISTORIAL = 100;

/** Suavizado por longitud de arco: cada punto se promedia con sus vecinos cercanos (peso triangular).
 *  Se aplica al DIBUJAR (no a lo guardado), así también suaviza las notas que ya tenías. Cacheado por trazo. */
const VENTANA_SUAVE = 0.007, PASADAS_SUAVE = 2;
const cacheSuave = new WeakMap();
function puntosSuaves(t) {
  const p = t.p;
  if (!p || p.length < 4) return p;
  const c = cacheSuave.get(p);
  if (c && c.n === p.length) return c.out;
  let a = p;
  for (let k = 0; k < PASADAS_SUAVE; k++) {
    const n = a.length, s = [0];
    for (let i = 1; i < n; i++) s.push(s[i - 1] + Math.hypot(a[i][0] - a[i - 1][0], a[i][1] - a[i - 1][1]));
    const tot = s[n - 1], b = new Array(n);
    for (let i = 0; i < n; i++) {
      const w = Math.min(VENTANA_SUAVE, s[i], tot - s[i]); // los extremos se quedan donde están
      if (w <= 0) { b[i] = a[i]; continue; }
      let sx = 0, sy = 0, sp = 0, sw = 0, spw = 0;
      for (let j = i; j >= 0 && s[i] - s[j] <= w; j--) { const k2 = 1 - (s[i] - s[j]) / w; sx += a[j][0] * k2; sy += a[j][1] * k2; sw += k2; if (a[j][2] != null) { sp += a[j][2] * k2; spw += k2; } }
      for (let j = i + 1; j < n && s[j] - s[i] <= w; j++) { const k2 = 1 - (s[j] - s[i]) / w; sx += a[j][0] * k2; sy += a[j][1] * k2; sw += k2; if (a[j][2] != null) { sp += a[j][2] * k2; spw += k2; } }
      const q = [sx / sw, sy / sw];
      if (spw) q.push(sp / spw);
      b[i] = q;
    }
    a = b;
  }
  cacheSuave.set(p, { n: p.length, out: a });
  return a;
}

/** Dibuja un trazo: curvas suaves por puntos medios; con presión, grosor variable; figuras con líneas rectas. */
function dibujarTrazo(ctx, t, ancho, dy, gmin) {
  const p = t.f ? t.p : puntosSuaves(t);
  if (!p || !p.length) return;
  const base = Math.max(gmin, t.w * ancho);
  const X = (i) => p[i][0] * ancho, Y = (i) => p[i][1] * ancho - dy;
  ctx.strokeStyle = t.c; ctx.fillStyle = t.c; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const n = p.length;
  if (n === 1) { ctx.beginPath(); ctx.arc(X(0), Y(0), base / 2, 0, Math.PI * 2); ctx.fill(); return; }
  if (t.f) {
    ctx.lineWidth = base; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    for (let i = 1; i < n; i++) ctx.lineTo(X(i), Y(i));
    ctx.stroke();
    if (t.a && n > 1) {
      const x0 = X(n - 2), y0 = Y(n - 2), x1 = X(n - 1), y1 = Y(n - 1);
      const ang = Math.atan2(y1 - y0, x1 - x0), h = Math.max(9, base * 4.2);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * Math.cos(ang - Math.PI / 6), y1 - h * Math.sin(ang - Math.PI / 6));
      ctx.moveTo(x1, y1); ctx.lineTo(x1 - h * Math.cos(ang + Math.PI / 6), y1 - h * Math.sin(ang + Math.PI / 6)); ctx.stroke();
    }
    return;
  }
  const variable = n > 2 && p[0].length > 2;
  const mx = (i) => (X(i) + X(i + 1)) / 2, my = (i) => (Y(i) + Y(i + 1)) / 2;
  if (!variable) {
    ctx.lineWidth = base; ctx.beginPath(); ctx.moveTo(X(0), Y(0));
    if (n === 2) ctx.lineTo(X(1), Y(1));
    else {
      ctx.lineTo(mx(0), my(0));
      for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(X(i), Y(i), mx(i), my(i));
      ctx.lineTo(X(n - 1), Y(n - 1));
    }
    ctx.stroke(); return;
  }
  const lw = (i) => Math.max(gmin, t.w * ancho * (0.4 + 1.2 * (p[i][2] ?? 0.5)));
  let sx = X(0), sy = Y(0), ex = mx(0), ey = my(0);
  ctx.lineWidth = lw(0); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  sx = ex; sy = ey;
  for (let i = 1; i < n - 1; i++) {
    ex = mx(i); ey = my(i);
    ctx.lineWidth = lw(i); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(X(i), Y(i), ex, ey); ctx.stroke();
    sx = ex; sy = ey;
  }
  ctx.lineWidth = lw(n - 1); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(X(n - 1), Y(n - 1)); ctx.stroke();
}

function dibujarTrazos(ctx, trazos, ancho, desplazarY = 0, grosorMin = 1) {
  for (const t of trazos) dibujarTrazo(ctx, t, ancho, desplazarY, grosorMin);
}

function trazoTocado(t, x, y, radio) {
  const p = t.p;
  for (let i = 0; i < p.length; i++) {
    if (Math.hypot(p[i][0] - x, p[i][1] - y) <= radio) return true;
    if (i && Math.hypot((p[i][0] + p[i - 1][0]) / 2 - x, (p[i][1] + p[i - 1][1]) / 2 - y) <= radio) return true;
  }
  return false;
}

const contarPuntos = (trazos) => trazos.reduce((n, t) => n + t.p.length, 0);
const r4 = (v) => Math.round(v * 10000) / 10000;

/**
 * Capa de dibujo sobre el cuerpo del editor.
 * obtenerTrazos(): devuelve el arreglo de trazos (se modifica en el lugar).
 * alCambiar(): se llama al terminar un trazo, un borrado, o un deshacer/rehacer.
 */
function crearCapaTinta({ cuerpo, modal, obtenerTrazos, alCambiar }) {
  const canvas = document.createElement("canvas");
  canvas.className = "nt-tinta-canvas";
  if (getComputedStyle(modal).position === "static") modal.style.position = "relative";
  modal.append(canvas);
  const ctx = canvas.getContext("2d", { desynchronized: true }) || canvas.getContext("2d");

  let modo = null; // lápiz, borrador, línea, flecha o rectángulo
  let color = "#172033";
  let grosor = GROSOR_BASE;
  let activo = false, actual = null, modoActivo = null, vistoLapiz = false;
  let ancho = 1, rect = null, suave = null, ancla = null, timerForma = 0, congelado = false;
  let huboBorrado = false, rafRedibujo = 0;

  // Historial propio de la tinta (instantáneas de referencias; los trazos terminados no se modifican).
  const hist = [obtenerTrazos().slice()];
  let hi = 0;
  const empujar = () => {
    hist.length = hi + 1;
    hist.push(obtenerTrazos().slice());
    if (hist.length > MAX_HISTORIAL) hist.shift();
    hi = hist.length - 1;
  };
  const restaurar = (i) => {
    hi = i;
    const a = obtenerTrazos();
    a.splice(0, a.length, ...hist[i]);
    redibujar();
    alCambiar();
  };

  function ubicar() {
    const mr = modal.getBoundingClientRect();
    const r = cuerpo.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.style.left = `${r.left - mr.left}px`;
    canvas.style.top = `${r.top - mr.top}px`;
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    ancho = r.width || 1;
    rect = canvas.getBoundingClientRect();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redibujar();
  }

  function redibujar() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    dibujarTrazos(ctx, obtenerTrazos(), ancho, cuerpo.scrollTop);
  }
  const redibujarPronto = () => { if (!rafRedibujo) rafRedibujo = requestAnimationFrame(() => { rafRedibujo = 0; redibujar(); }); };

  function punto(e) {
    const r = rect || canvas.getBoundingClientRect();
    const w = r.width || 1;
    return [(e.clientX - r.left) / w, (e.clientY - r.top + cuerpo.scrollTop) / w];
  }

  function borrar(pt) {
    const trazos = obtenerTrazos();
    let cambio = false;
    for (let i = trazos.length - 1; i >= 0; i--) {
      if (trazoTocado(trazos[i], pt[0], pt[1], RADIO_BORRADOR)) { trazos.splice(i, 1); cambio = true; }
    }
    return cambio;
  }

  /** Dibuja solo lo nuevo del trazo en curso (sin redibujar todo): es lo que quita el retraso. */
  function trazarVivo(t, k) {
    const p = t.p, dy = cuerpo.scrollTop;
    const X = (i) => p[i][0] * ancho, Y = (i) => p[i][1] * ancho - dy;
    const lw = (i) => Math.max(1, t.w * ancho * (0.4 + 1.2 * (p[i][2] ?? 0.5)));
    ctx.strokeStyle = t.c; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const linea = (x0, y0, x1, y1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    if (k === 1) { linea(X(0), Y(0), X(1), Y(1), lw(1)); return; }
    const sx = (X(k - 2) + X(k - 1)) / 2, sy = (Y(k - 2) + Y(k - 1)) / 2;
    const ex = (X(k - 1) + X(k)) / 2, ey = (Y(k - 1) + Y(k)) / 2;
    ctx.lineWidth = lw(k - 1); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(X(k - 1), Y(k - 1), ex, ey); ctx.stroke();
    linea(ex, ey, X(k), Y(k), lw(k));
  }

  function agregarPunto(t, raw, e) {
    // Suavizado adaptativo: lento = más filtro (quita temblor), rápido = casi sin retraso.
    const d = Math.hypot(raw[0] - suave[0], raw[1] - suave[1]);
    const a = Math.min(0.95, Math.max(0.3, d / (d + 0.002)));
    suave = [suave[0] + (raw[0] - suave[0]) * a, suave[1] + (raw[1] - suave[1]) * a];
    const u = t.p[t.p.length - 1];
    if (Math.hypot(suave[0] - u[0], suave[1] - u[1]) < PASO_MIN || contarPuntos(obtenerTrazos()) >= MAX_PUNTOS) return;
    const pt = [r4(suave[0]), r4(suave[1])];
    if (e.pointerType === "pen" && e.pressure > 0) pt.push(Math.round(e.pressure * 100) / 100);
    t.p.push(pt);
    trazarVivo(t, t.p.length - 1);
  }

  function reiniciarEspera() {
    clearTimeout(timerForma);
    if (modoActivo !== "lapiz" || congelado || actual?.forma) return;
    timerForma = setTimeout(() => {
      if (!activo || !actual || congelado) return;
      const f = reconocerForma(actual.p);
      if (!f) return;
      actual.p = f; actual.f = 1; congelado = true;
      redibujar();
      try { navigator.vibrate?.(12); } catch (_) {}
    }, ESPERA_FORMA);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!modo || activo) return;
    if (e.pointerType === "pen") vistoLapiz = true;
    // Con lápiz detectado, el dedo/palma no dibuja.
    if (e.pointerType === "touch" && vistoLapiz) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    rect = canvas.getBoundingClientRect();
    activo = true; congelado = false; huboBorrado = false;
    // El extremo borrador del lápiz óptico borra aunque esté el modo lápiz.
    // Lápiz óptico: el extremo borrador siempre borra; el botón lateral invierte la herramienta mientras lo mantienes (lápiz <-> borrador).
    const puntaBorrador = e.pointerType === "pen" && !!((e.buttons & 32) || e.button === 5);
    const botonLateral = e.pointerType === "pen" && !puntaBorrador && !!((e.buttons & 2) || e.button === 2);
    modoActivo = puntaBorrador ? "borrador" : botonLateral ? (modo === "lapiz" ? "borrador" : "lapiz") : modo;
    const pt = punto(e);
    if (["lapiz", "linea", "flecha", "rectangulo"].includes(modoActivo)) {
      if (contarPuntos(obtenerTrazos()) >= MAX_PUNTOS) { activo = false; return; }
      suave = pt.slice(); ancla = pt;
      const p0 = [r4(pt[0]), r4(pt[1])];
      if (e.pointerType === "pen" && e.pressure > 0) p0.push(Math.round(e.pressure * 100) / 100);
      actual = { c: color, w: grosor, p: [p0] };
      if (modoActivo === "linea" || modoActivo === "flecha") actual.forma = modoActivo;
      if (modoActivo === "flecha") actual.a = 1;
      if (modoActivo === "rectangulo") { actual.forma = modoActivo; actual.f = 1; actual.p.push(p0.slice()); }
      obtenerTrazos().push(actual);
      ctx.fillStyle = color; ctx.beginPath();
      ctx.arc(pt[0] * ancho, pt[1] * ancho - cuerpo.scrollTop, Math.max(1, grosor * ancho) / 2, 0, Math.PI * 2); ctx.fill();
      if (modoActivo === "lapiz") reiniciarEspera();
    } else {
      if (borrar(pt)) { huboBorrado = true; redibujarPronto(); }
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!activo) return;
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    let movio = false;
    for (const ev of eventos.length ? eventos : [e]) {
      const pt = punto(ev);
      if ((modoActivo === "linea" || modoActivo === "flecha") && actual) {
        actual.p = [actual.p[0], [r4(pt[0]), r4(pt[1])]]; redibujarPronto(); continue;
      }
      if (modoActivo === "rectangulo" && actual) {
        const a = actual.p[0], x0 = a[0], y0 = a[1], x1 = r4(pt[0]), y1 = r4(pt[1]);
        actual.p = [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]]; redibujarPronto(); continue;
      }
      if (modoActivo === "lapiz" && actual) {
        if (congelado) continue;
        agregarPunto(actual, pt, ev);
        if (Math.hypot(pt[0] - ancla[0], pt[1] - ancla[1]) > QUIETO) { ancla = pt; movio = true; }
      } else if (modoActivo === "borrador") {
        if (borrar(pt)) huboBorrado = true;
      }
    }
    if (movio) reiniciarEspera();
    if (modoActivo === "borrador" && huboBorrado) redibujarPronto();
  });

  const terminar = (e) => {
    clearTimeout(timerForma);
    if (!activo) return;
    activo = false;
    if ((modoActivo === "linea" || modoActivo === "flecha") && actual) {
      const pt = e?.type === "pointerup" ? punto(e) : actual.p.at(-1);
      actual.p = [actual.p[0], [r4(pt[0]), r4(pt[1])]];
      delete actual.forma; actual.f = 1;
      actual = null; redibujar(); empujar(); alCambiar();
    } else if (modoActivo === "rectangulo" && actual) {
      delete actual.forma; actual = null; redibujar(); empujar(); alCambiar();
    } else if (modoActivo === "lapiz" && actual) {
      if (!congelado && e?.type === "pointerup") {
        const u = actual.p[actual.p.length - 1], pt = punto(e);
        if (Math.hypot(pt[0] - u[0], pt[1] - u[1]) > PASO_MIN / 2) actual.p.push([r4(pt[0]), r4(pt[1])]);
      }
      actual = null;
      redibujar();
      empujar();
      alCambiar();
    } else if (modoActivo === "borrador" && huboBorrado) {
      redibujar();
      empujar();
      alCambiar();
    }
    actual = null;
  };
  canvas.addEventListener("contextmenu", (e) => { if (modo) e.preventDefault(); }); // el botón del lápiz no abre el menú del navegador
  canvas.addEventListener("pointerup", terminar);
  canvas.addEventListener("pointercancel", terminar);
  // El canvas tapa el cuerpo: reenvía la rueda para poder hacer scroll.
  canvas.addEventListener("wheel", (e) => { cuerpo.scrollTop += e.deltaY; redibujar(); }, { passive: true });
  cuerpo.addEventListener("scroll", redibujar);

  const observador = typeof ResizeObserver === "function" ? new ResizeObserver(ubicar) : null;
  observador?.observe(cuerpo);
  observador?.observe(modal);
  window.addEventListener("resize", ubicar);
  requestAnimationFrame(ubicar);

  return {
    establecerModo(m) {
      modo = m;
      canvas.classList.toggle("activo", !!m);
      canvas.dataset.modo = m || "";
      if (!m) { clearTimeout(timerForma); activo = false; actual = null; }
    },
    obtenerModo: () => modo,
    establecerColor(c) { color = c; },
    establecerGrosor(v) { grosor = Math.max(0.0015, Math.min(0.02, Number(v) || GROSOR_BASE)); },
    puedeDeshacer: () => hi > 0,
    puedeRehacer: () => hi < hist.length - 1,
    deshacer() { if (hi > 0) restaurar(hi - 1); },
    rehacer() { if (hi < hist.length - 1) restaurar(hi + 1); },
    redibujar,
    ubicar,
    destruir() {
      clearTimeout(timerForma);
      cancelAnimationFrame(rafRedibujo);
      observador?.disconnect();
      window.removeEventListener("resize", ubicar);
      cuerpo.removeEventListener("scroll", redibujar);
      canvas.remove();
    },
  };
}

/** Miniatura de la tinta para la tarjeta. Se redibuja con la resolución real con que se muestra (tamaño x densidad de pantalla),
 *  así no se ve pixelada aunque la tarjeta sea ancha. Devuelve null si no hay trazos. */
function crearMiniTinta(trazos) {
  if (!Array.isArray(trazos) || !trazos.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of trazos) for (const [x, y] of t.p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(x0)) return null;
  const pad = 0.015;
  const w = Math.max(0.05, x1 - x0 + pad * 2), h = Math.max(0.05, y1 - y0 + pad * 2);
  const c = document.createElement("canvas");
  c.className = "nota-tinta-mini";
  c.style.aspectRatio = `${Math.round(w * 1000)} / ${Math.round(h * 1000)}`;
  const MAX_PX = 2400;
  let pxActual = 0;
  const pintar = (px) => {
    const cw = Math.max(1, Math.min(MAX_PX, Math.round(px))), ch = Math.max(1, Math.round((cw * h) / w));
    pxActual = cw;
    c.width = cw; c.height = ch; // al cambiar el tamaño el canvas se limpia solo
    const ctx = c.getContext("2d");
    const escala = cw / w;
    ctx.scale(escala, escala);
    ctx.translate(-x0 + pad, -y0 + pad);
    dibujarTrazos(ctx, trazos, 1, 0, 1.5 / escala);
  };
  pintar(360 * (window.devicePixelRatio || 1));
  if (typeof ResizeObserver === "function") {
    new ResizeObserver((entradas) => {
      const ancho = entradas[0]?.contentRect?.width || 0;
      if (!ancho) return;
      const px = Math.min(MAX_PX, Math.round(ancho * (window.devicePixelRatio || 1)));
      if (Math.abs(px - pxActual) > 8) pintar(px);
    }).observe(c);
  }
  return c;
}

export { crearCapaTinta, crearMiniTinta, dibujarTrazos, GROSOR_BASE };
