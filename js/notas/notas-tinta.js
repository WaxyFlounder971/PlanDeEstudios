// Tinta (lápiz y borrador) para notas.
// Los trazos se guardan normalizados: x e y están divididos por el ancho del cuerpo de la nota,
// así se ven igual sin importar el tamaño de pantalla.
// Trazo: { c: "#color", w: grosor relativo, p: [[x, y], ...] }

const GROSOR_BASE = 0.0045;
const PASO_MIN = 0.0015;      // distancia mínima entre puntos guardados
const RADIO_BORRADOR = 0.022; // radio del borrador (relativo al ancho)
const MAX_PUNTOS = 60000;

function dibujarTrazos(ctx, trazos, ancho, desplazarY = 0, grosorMin = 1) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const t of trazos) {
    const p = t.p;
    if (!p || !p.length) continue;
    ctx.strokeStyle = t.c;
    ctx.fillStyle = t.c;
    ctx.lineWidth = Math.max(grosorMin, t.w * ancho);
    if (p.length === 1) {
      ctx.beginPath();
      ctx.arc(p[0][0] * ancho, p[0][1] * ancho - desplazarY, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    ctx.beginPath();
    ctx.moveTo(p[0][0] * ancho, p[0][1] * ancho - desplazarY);
    for (let i = 1; i < p.length - 1; i++) {
      const mx = ((p[i][0] + p[i + 1][0]) / 2) * ancho;
      const my = ((p[i][1] + p[i + 1][1]) / 2) * ancho - desplazarY;
      ctx.quadraticCurveTo(p[i][0] * ancho, p[i][1] * ancho - desplazarY, mx, my);
    }
    const u = p[p.length - 1];
    ctx.lineTo(u[0] * ancho, u[1] * ancho - desplazarY);
    ctx.stroke();
  }
}

function trazoTocado(t, x, y, radio) {
  for (const [px, py] of t.p) if (Math.hypot(px - x, py - y) <= radio) return true;
  return false;
}

function contarPuntos(trazos) {
  return trazos.reduce((n, t) => n + t.p.length, 0);
}

/**
 * Capa de dibujo sobre el cuerpo del editor.
 * cuerpo: elemento editable; modal: contenedor donde se coloca el canvas.
 * obtenerTrazos(): devuelve el arreglo de trazos (se modifica en el lugar).
 * alCambiar(): se llama al terminar un trazo o un borrado.
 */
function crearCapaTinta({ cuerpo, modal, obtenerTrazos, alCambiar }) {
  const canvas = document.createElement("canvas");
  canvas.className = "nt-tinta-canvas";
  if (getComputedStyle(modal).position === "static") modal.style.position = "relative";
  modal.append(canvas);
  const ctx = canvas.getContext("2d");

  let modo = null; // "lapiz" | "borrador" | null
  let color = "#172033";
  let activo = false;
  let actual = null;
  let modoActivo = null;
  let vistoLapiz = false;
  let ancho = 1;

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

  function punto(e) {
    const r = canvas.getBoundingClientRect();
    const w = r.width || 1;
    return [
      Math.round(((e.clientX - r.left) / w) * 10000) / 10000,
      Math.round(((e.clientY - r.top + cuerpo.scrollTop) / w) * 10000) / 10000,
    ];
  }

  function borrar(pt) {
    const trazos = obtenerTrazos();
    let cambio = false;
    for (let i = trazos.length - 1; i >= 0; i--) {
      if (trazoTocado(trazos[i], pt[0], pt[1], RADIO_BORRADOR)) { trazos.splice(i, 1); cambio = true; }
    }
    return cambio;
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!modo) return;
    if (e.pointerType === "pen") vistoLapiz = true;
    // Con lápiz detectado, el dedo/palma no dibuja.
    if (e.pointerType === "touch" && vistoLapiz) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    activo = true;
    // El extremo borrador del lápiz óptico borra aunque esté el modo lápiz.
    modoActivo = e.pointerType === "pen" && (e.buttons & 32 || e.button === 5) ? "borrador" : modo;
    const pt = punto(e);
    if (modoActivo === "lapiz") {
      if (contarPuntos(obtenerTrazos()) >= MAX_PUNTOS) { activo = false; return; }
      actual = { c: color, w: GROSOR_BASE, p: [pt] };
      obtenerTrazos().push(actual);
    } else {
      borrar(pt);
    }
    redibujar();
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!activo) return;
    const eventos = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of eventos.length ? eventos : [e]) {
      const pt = punto(ev);
      if (modoActivo === "lapiz" && actual) {
        const u = actual.p[actual.p.length - 1];
        if (Math.hypot(pt[0] - u[0], pt[1] - u[1]) >= PASO_MIN && contarPuntos(obtenerTrazos()) < MAX_PUNTOS) actual.p.push(pt);
      } else if (modoActivo === "borrador") {
        borrar(pt);
      }
    }
    redibujar();
  });

  const terminar = () => {
    if (!activo) return;
    activo = false;
    actual = null;
    alCambiar();
  };
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
      if (!m) { activo = false; actual = null; }
    },
    obtenerModo: () => modo,
    establecerColor(c) { color = c; },
    redibujar,
    ubicar,
    destruir() {
      observador?.disconnect();
      window.removeEventListener("resize", ubicar);
      cuerpo.removeEventListener("scroll", redibujar);
      canvas.remove();
    },
  };
}

/** Miniatura de la tinta para la tarjeta (ajusta el dibujo a su caja). Devuelve null si no hay trazos. */
function crearMiniTinta(trazos) {
  if (!Array.isArray(trazos) || !trazos.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of trazos) for (const [x, y] of t.p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(x0)) return null;
  const pad = 0.015;
  const w = Math.max(0.05, x1 - x0 + pad * 2), h = Math.max(0.05, y1 - y0 + pad * 2);
  const W = 360, Hmax = 200;
  let escala = W / w;
  let H = h * escala;
  if (H > Hmax) { escala = Hmax / h; H = Hmax; }
  const cw = Math.round(Math.min(W, w * escala)), ch = Math.round(H);
  const c = document.createElement("canvas");
  c.className = "nota-tinta-mini";
  c.width = Math.max(1, cw);
  c.height = Math.max(1, ch);
  c.style.aspectRatio = `${c.width} / ${c.height}`;
  const ctx = c.getContext("2d");
  ctx.save();
  ctx.scale(escala, escala);
  ctx.translate(-x0 + pad, -y0 + pad);
  dibujarTrazos(ctx, trazos, 1, 0, 0.004);
  ctx.restore();
  return c;
}

export { crearCapaTinta, crearMiniTinta, dibujarTrazos, GROSOR_BASE };
