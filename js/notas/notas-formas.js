// Reconocimiento de figuras para la tinta: círculo, elipse, cuadrado, rectángulo, triángulo, estrella y pentagrama.
// Entrada: puntos [[x, y, ...], ...] normalizados. Salida: puntos de la figura limpia, o null si no parece ninguna.
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const longitud = (p) => { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; };
const r4 = (v) => Math.round(v * 10000) / 10000;

function resamplear(p, n) {
  const paso = longitud(p) / (n - 1);
  const out = [[p[0][0], p[0][1]]];
  let a = [p[0][0], p[0][1]], falta = paso;
  for (let i = 1; i < p.length; i++) {
    const b = p[i];
    let d = dist(a, b);
    while (d >= falta && d > 0) {
      const t = falta / d;
      a = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      out.push(a);
      d = dist(a, b);
      falta = paso;
    }
    falta -= d;
    a = [b[0], b[1]];
  }
  const u = p[p.length - 1];
  while (out.length < n) out.push([u[0], u[1]]);
  return out.slice(0, n);
}

function distSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function errorHacia(pts, poli) {
  let s = 0;
  for (const q of pts) {
    let m = Infinity;
    for (let i = 1; i < poli.length; i++) { const d = distSeg(q, poli[i - 1], poli[i]); if (d < m) m = d; }
    s += m;
  }
  return s / pts.length;
}

function rdp(p, eps) {
  if (p.length < 3) return p.slice();
  let mx = 0, idx = 0;
  const a = p[0], b = p[p.length - 1];
  for (let i = 1; i < p.length - 1; i++) { const d = distSeg(p[i], a, b); if (d > mx) { mx = d; idx = i; } }
  if (mx > eps) return rdp(p.slice(0, idx + 1), eps).slice(0, -1).concat(rdp(p.slice(idx), eps));
  return [a, b];
}

function giro(a, b, c) {
  let d = Math.abs(Math.atan2(c[1] - b[1], c[0] - b[0]) - Math.atan2(b[1] - a[1], b[0] - a[0])) * 180 / Math.PI;
  if (d > 180) d = 360 - d;
  return d;
}

/** Vértices de una trayectoria cerrada (sin repetir el primero). */
function esquinas(p, eps) {
  let k = 0, m = 0;
  for (let i = 0; i < p.length; i++) { const d = dist(p[0], p[i]); if (d > m) { m = d; k = i; } }
  const A = rdp(p.slice(0, k + 1), eps), B = rdp(p.slice(k).concat([p[0]]), eps);
  const v = A.slice(0, -1).concat(B.slice(0, -1));
  let cambio = true;
  while (cambio && v.length > 3) {
    cambio = false;
    for (let i = 0; i < v.length; i++) {
      if (giro(v[(i + v.length - 1) % v.length], v[i], v[(i + 1) % v.length]) < 20) { v.splice(i, 1); cambio = true; break; }
    }
  }
  return v;
}

const media = (v) => v.reduce((s, x) => s + x, 0) / v.length;
const centroide = (v) => [media(v.map((q) => q[0])), media(v.map((q) => q[1]))];
const angDe = (c, q) => Math.atan2(q[1] - c[1], q[0] - c[0]);
const dif = (a, b) => { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
const mediaCirc = (angs) => Math.atan2(media(angs.map(Math.sin)), media(angs.map(Math.cos)));

function candidatoElipse(pts) {
  const [cx, cy] = centroide(pts);
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of pts) { const x = q[0] - cx, y = q[1] - cy; sxx += x * x; syy += y * y; sxy += x * y; }
  let th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  if (Math.abs(th) < 0.1) th = 0; else if (Math.abs(Math.abs(th) - Math.PI / 2) < 0.1) th = Math.PI / 2;
  const c = Math.cos(th), s = Math.sin(th);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const q of pts) {
    const x = q[0] - cx, y = q[1] - cy, u = x * c + y * s, v = -x * s + y * c;
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v;
  }
  const a = (u1 - u0) / 2, b = (v1 - v0) / 2, cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  if (a <= 0 || b <= 0) return null;
  const wx = cx + cu * c - cv * s, wy = cy + cu * s + cv * c;
  const circulo = Math.min(a, b) / Math.max(a, b) > 0.86;
  const out = [];
  for (let k = 0; k <= 72; k++) {
    const t = (2 * Math.PI * k) / 72;
    if (circulo) { const r = (a + b) / 2; out.push([wx + r * Math.cos(t), wy + r * Math.sin(t)]); }
    else { const x = a * Math.cos(t), y = b * Math.sin(t); out.push([wx + x * c - y * s, wy + x * s + y * c]); }
  }
  return out;
}

function candidatoRect(pts) {
  let mejor = null;
  for (let g = 0; g < 90; g += 5) {
    const th = (g * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const q of pts) { const u = q[0] * c + q[1] * s, v = -q[0] * s + q[1] * c; if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; }
    const area = (u1 - u0) * (v1 - v0);
    if (!mejor || area < mejor.area) mejor = { area, th, u0, u1, v0, v1 };
  }
  let { th, u0, u1, v0, v1 } = mejor;
  if (th < 0.12 || th > Math.PI / 2 - 0.12) {
    // casi alineado con los ejes: se endereza
    th = 0; u0 = Infinity; u1 = -Infinity; v0 = Infinity; v1 = -Infinity;
    for (const q of pts) { if (q[0] < u0) u0 = q[0]; if (q[0] > u1) u1 = q[0]; if (q[1] < v0) v0 = q[1]; if (q[1] > v1) v1 = q[1]; }
  }
  let w = u1 - u0, h = v1 - v0;
  if (w <= 0 || h <= 0) return null;
  const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
  if (Math.abs(w - h) / Math.max(w, h) < 0.18) w = h = (w + h) / 2; // cuadrado
  const c = Math.cos(th), s = Math.sin(th);
  const pt = (u, v) => [u * c - v * s, u * s + v * c];
  const e = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => pt(cu + (a * w) / 2, cv + (b * h) / 2));
  return e;
}

function candidatoTriangulo(pts, diag) {
  const v = esquinas(pts, 0.08 * diag);
  if (v.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (giro(v[(i + 2) % 3], v[i], v[(i + 1) % 3]) < 35) return null;
  return [...v, v[0]];
}

function candidatoPentagrama(pts, diag) {
  const v = esquinas(pts, 0.06 * diag);
  if (v.length !== 5) return null;
  for (let i = 0; i < 5; i++) if (giro(v[(i + 4) % 5], v[i], v[(i + 1) % 5]) < 100) return null;
  const c = centroide(v), R = media(v.map((q) => dist(c, q)));
  const angs = v.map((q) => angDe(c, q));
  const dir = dif(angs[1], angs[0]) > 0 ? 1 : -1;
  const paso = (4 * Math.PI) / 5;
  const a0 = mediaCirc(angs.map((a, k) => a - dir * k * paso));
  const out = [];
  for (let k = 0; k <= 5; k++) out.push([c[0] + R * Math.cos(a0 + dir * k * paso), c[1] + R * Math.sin(a0 + dir * k * paso)]);
  return out;
}

function candidatoEstrella(pts, diag) {
  const v = esquinas(pts, 0.035 * diag);
  if (v.length !== 10) return null;
  const c = centroide(v), rad = v.map((q) => dist(c, q));
  const par = media(rad.filter((_, i) => i % 2 === 0)), impar = media(rad.filter((_, i) => i % 2 === 1));
  if (Math.min(par, impar) / Math.max(par, impar) > 0.75) return null;
  const ini = par > impar ? 0 : 1;
  const R = Math.max(par, impar);
  const r = Math.min(Math.max(Math.min(par, impar), 0.35 * R), 0.6 * R);
  const angs = [0, 1, 2, 3, 4].map((m) => angDe(c, v[(ini + 2 * m) % 10]));
  const dir = dif(angs[1], angs[0]) > 0 ? 1 : -1;
  const a0 = mediaCirc(angs.map((a, m) => a - dir * m * ((2 * Math.PI) / 5)));
  const out = [];
  for (let j = 0; j <= 10; j++) {
    const rr = j % 2 === 0 ? R : r, a = a0 + (dir * (j % 10) * Math.PI) / 5;
    out.push([c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]);
  }
  return out;
}

function reconocerForma(p) {
  if (!Array.isArray(p) || p.length < 12) return null;
  const L = longitud(p);
  if (L < 0.1 || dist(p[0], p[p.length - 1]) > 0.22 * L) return null; // debe ser un trazo cerrado
  const pts = resamplear(p, 72);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 0.05) return null;
  const cands = [];
  const probar = (poli) => {
    if (!poli) return;
    const r = L / longitud(poli);
    if (r < 0.7 || r > 1.45) return; // evita espirales y trazos dobles
    cands.push({ poli, err: errorHacia(pts, poli) });
  };
  probar(candidatoElipse(pts));
  probar(candidatoRect(pts));
  probar(candidatoTriangulo(pts, diag));
  probar(candidatoPentagrama(pts, diag));
  probar(candidatoEstrella(pts, diag));
  if (!cands.length) return null;
  const mejor = cands.reduce((a, b) => (b.err < a.err ? b : a));
  if (mejor.err > 0.055 * diag) return null;
  return mejor.poli.map((q) => [r4(q[0]), r4(q[1])]);
}

export { reconocerForma };
