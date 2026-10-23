// Reconocimiento de figuras para la tinta: círculo, elipse, cuadrado, rectángulo, triángulo, estrella, pentagrama y corazón.
// Entrada: puntos [[x, y, ...], ...] normalizados. Salida: puntos de la figura limpia, o null si no parece ninguna.
const TIEMPO_MANTENER_FIGURA_MS = 600;
const TOLERANCIA_QUIETO_PX = 6;
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
  out.tipo = circulo ? "circulo" : "elipse";
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
  // Conserva la proporción dibujada: un rectángulo casi cuadrado no se fuerza a cuadrado.
  const c = Math.cos(th), s = Math.sin(th);
  const pt = (u, v) => [u * c - v * s, u * s + v * c];
  const e = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]].map(([a, b]) => pt(cu + (a * w) / 2, cv + (b * h) / 2));
  // Solo fuerza la proporción del redimensionado cuando el trazo fue realmente cuadrado.
  // Una diferencia visible, aunque sea pequeña, conserva el comportamiento de rectángulo.
  e.tipo = Math.min(w, h) / Math.max(w, h) > 0.998 ? "cuadrado" : "rectangulo";
  return e;
}

function candidatoTriangulo(pts, diag) {
  const v = esquinas(pts, 0.08 * diag);
  if (v.length !== 3) return null;
  for (let i = 0; i < 3; i++) if (giro(v[(i + 2) % 3], v[i], v[(i + 1) % 3]) < 35) return null;
  const out=[...v,v[0]];out.tipo="triangulo";return out;
}


function candidatoRombo(pts, diag) {
  const v=esquinas(pts,0.045*diag);if(v.length!==4)return null;
  const lados=v.map((q,i)=>dist(q,v[(i+1)%4])),max=Math.max(...lados),min=Math.min(...lados);if(!max||min/max<.78)return null;
  const angulos=v.map((q,i)=>giro(v[(i+3)%4],q,v[(i+1)%4]));if(angulos.some(a=>a<25||a>155))return null;
  const out=[...v,v[0].slice()];out.tipo="rombo";return out;
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

// Corazón: curva clásica normalizada a [0,1]x[0,1] (punta hacia abajo), que luego se estira al recuadro del trazo.
const PLANTILLA_CORAZON = (() => {
  const q = [];
  for (let k = 0; k <= 120; k++) {
    const t = (2 * Math.PI * k) / 120;
    q.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]); // y hacia abajo
  }
  const xs = q.map((v) => v[0]), ys = q.map((v) => v[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  return q.map((v) => [(v[0] - x0) / (x1 - x0), (v[1] - y0) / (y1 - y0)]);
})();

function candidatoCorazon(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const w = x1 - x0, h = y1 - y0;
  if (w <= 0 || h <= 0) return null;
  const asp = w / h;
  if (asp < 0.7 || asp > 1.5) return null;
  // Un corazón real tiene una muesca arriba al centro y termina en punta abajo.
  // Un cuadrado chueco no: su borde superior es continuo y su base es ancha.
  const cx = (x0 + x1) / 2;
  let arribaCentro = Infinity, bajoMin = Infinity, bajoMax = -Infinity;
  for (const q of pts) {
    if (Math.abs(q[0] - cx) < 0.07 * w && q[1] < arribaCentro) arribaCentro = q[1];
    if (q[1] > y0 + 0.85 * h) { if (q[0] < bajoMin) bajoMin = q[0]; if (q[0] > bajoMax) bajoMax = q[0]; }
  }
  if (arribaCentro - y0 < 0.06 * h) return null; // sin muesca arriba
  if (bajoMax - bajoMin > 0.5 * w) return null; // base ancha: no es punta
  const o = PLANTILLA_CORAZON.map(([u, v]) => [x0 + u * w, y0 + v * h]);
  o.tipo = "corazon";
  return o;
}

/** Reconoce un trazo abierto cuya punta se repasó al dibujar las dos alas. */
function reconocerFlecha(p) {
  if (!Array.isArray(p) || p.length < 12) return null;
  const L = longitud(p);
  if (L < 0.12) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of p) { x0 = Math.min(x0, q[0]); y0 = Math.min(y0, q[1]); x1 = Math.max(x1, q[0]); y1 = Math.max(y1, q[1]); }
  const diag = Math.hypot(x1 - x0, y1 - y0);
  if (diag < 0.05) return null;
  const tip = p.at(-1), tol = Math.max(0.012, diag * 0.055);
  const candidatos = [];
  const alaMasLejana = (grupo) => grupo.filter((q) => dist(q, tip) > 0.035 * diag && dist(q, tip) < 0.36 * diag).reduce((best, q) => !best || dist(q, tip) > dist(best, tip) ? q : best, null);
  // Patrón habitual: cola → punta → ala → punta → ala → punta.
  for (let i = Math.floor(p.length * 0.12); i < p.length - 5; i++) {
    if (dist(p[i], tip) > tol) continue;
    for (let j = i + 2; j < p.length - 2; j++) {
      if (dist(p[j], tip) > tol) continue;
      const ala1 = alaMasLejana(p.slice(i + 1, j));
      const ala2 = alaMasLejana(p.slice(j + 1, -1));
      if (!ala1 || !ala2) continue;
    const d1 = dist(ala1, tip), d2 = dist(ala2, tip);
    if (d1 < 0.035 * diag || d2 < 0.035 * diag || Math.max(d1, d2) > 0.36 * diag) continue;
    const sep = giro(ala1, tip, ala2);
    if (sep < 22 || sep > 150 || Math.min(d1, d2) / Math.max(d1, d2) < 0.35) continue;
    const tail = dist(p[0], tip);
    if (tail < 2.2 * Math.max(d1, d2)) continue;
      candidatos.push({ i, score: Math.abs(d1 - d2) / Math.max(d1, d2) + Math.abs(sep - 65) / 180 });
    }
  }
  if (!candidatos.length) return null;
  const { i } = candidatos.sort((a, b) => a.score - b.score)[0];
  const ruta = rdp(p.slice(0, i + 1), 0.004 * diag);
  if (ruta.length < 2) return null;
  // Permite una trayectoria curva, pero evita convertir garabatos con muchos
  // quiebres marcados en flechas. Los giros suaves de una curva no cuentan.
  const quiebres = ruta.slice(1, -1).filter((q, k) => giro(ruta[k], q, ruta[k + 2]) > 42).length;
  if (quiebres > 5) return null;
  ruta[ruta.length - 1] = [tip[0], tip[1]];
  return ruta.map((q) => [r4(q[0]), r4(q[1])]);
}

/** Cuatro esquinas claras y convexas, probando varias tolerancias (un cuadrado chueco no siempre da 4 con una sola). */
function cuadrilateroClaro(pts, diag) {
  for (const f of [0.018, 0.03, 0.045, 0.06]) {
    const v = esquinas(pts, f * diag);
    if (v.length !== 4) continue;
    let signo = 0, ok = true;
    for (let i = 0; i < 4 && ok; i++) {
      const a = v[i], b = v[(i + 1) % 4], c = v[(i + 2) % 4];
      const cr = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
      if (!signo) signo = Math.sign(cr); else if (Math.sign(cr) !== signo) ok = false;
      const ang = giro(a, b, c);
      if (ang < 45 || ang > 135) ok = false;
    }
    // Lados comparables: un triángulo con una punta partida en dos no es un cuadrilátero.
    const lados = v.map((q, i) => dist(q, v[(i + 1) % 4])), per = lados.reduce((a, b) => a + b, 0);
    if (ok && Math.min(...lados) >= 0.14 * per) return v;
  }
  return null;
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
  // Si la trayectoria conserva cuatro esquinas claras, es rectángulo aunque sea casi cuadrado.
  const verticesRect = esquinas(pts, 0.018 * diag);
  if (verticesRect.length === 4 && verticesRect.every((q,i) => { const ang=giro(verticesRect[(i+3)%4],q,verticesRect[(i+1)%4]); return ang>=55 && ang<=125; })) {
    const rombo=candidatoRombo(pts,diag),errRombo=rombo?errorHacia(pts,rombo):Infinity;
    if(rombo&&errRombo<=0.045*diag){const lados=verticesRect.map((q,i)=>dist(q,verticesRect[(i+1)%4])),rel=Math.min(...lados)/Math.max(...lados),diagonalizada=verticesRect.every((q,i)=>{const b=verticesRect[(i+1)%4],a=Math.atan2(b[1]-q[1],b[0]-q[0]);return Math.abs(Math.sin(2*a))>.32;});if(rel>.78&&diagonalizada){const salida=rombo.map(q=>[r4(q[0]),r4(q[1])]);salida.tipo="rombo";return salida;}}
    const poli=candidatoRect(pts), err=poli ? errorHacia(pts,poli) : Infinity;
    if (poli && err <= 0.045 * diag) { const salida=poli.map(q=>[r4(q[0]),r4(q[1])]); salida.tipo=poli.tipo||"rectangulo"; return salida; }
  }
  const qv = cuadrilateroClaro(pts, diag);
  if (qv) {
    const quad = [...qv, qv[0]], errQ = errorHacia(pts, quad);
    const el = candidatoElipse(pts), errE = el ? errorHacia(pts, el) : Infinity;
    if (errQ <= 0.05 * diag && errQ < errE * 0.8) {
      const rc = candidatoRect(pts);
      const poli = rc && errorHacia(pts, rc) <= 0.09 * diag ? rc : null;
      const sal = (poli || quad).map((q) => [r4(q[0]), r4(q[1])]);
      sal.tipo = poli ? poli.tipo : "figura";
      return sal;
    }
  }
  const probar = (poli, simetrico = false) => {
    if (!poli) return;
    const r = L / longitud(poli);
    if (r < 0.7 || r > 1.45) return; // evita espirales y trazos dobles
    // El corazón se mide en ambos sentidos (trazo→figura y figura→trazo) para que un círculo no se confunda con él.
    const err = simetrico ? ((errorHacia(pts, poli) + errorHacia(poli, pts)) / 2) * 0.8 : errorHacia(pts, poli);
    cands.push({ poli, err, tipo: poli.tipo || "figura" });
  };
  probar(candidatoElipse(pts));
  probar(candidatoRombo(pts,diag));
  probar(candidatoRect(pts));
  probar(candidatoTriangulo(pts, diag));
  probar(candidatoPentagrama(pts, diag));
  probar(candidatoEstrella(pts, diag));
  probar(candidatoCorazon(pts), true);
  if (!cands.length) return null;
  const mejor = cands.reduce((a, b) => (b.err < a.err ? b : a));
  if (mejor.err > 0.055 * diag) return null;
  const salida = mejor.poli.map((q) => [r4(q[0]), r4(q[1])]);
  salida.tipo = mejor.tipo;
  return salida;
}

export { reconocerForma, reconocerFlecha, TIEMPO_MANTENER_FIGURA_MS, TOLERANCIA_QUIETO_PX };
