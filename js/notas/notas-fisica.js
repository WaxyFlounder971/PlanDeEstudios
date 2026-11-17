// Física de la nota flotante (sin DOM, para poder probarla).
// Velocidades en px/ms. Lanzar "muy rápido" = pasar del umbral; por debajo, la nota solo se queda donde la sueltas.
const UMBRAL_LANZAMIENTO = 1.5;
const VEL_MAX = 6;
const FRICCION = 0.9985; // factor por ms: a 2 px/ms recorre ~1300 px antes de frenar sola
const VEL_MIN = 0.04;

/** Velocidad a partir de las últimas muestras {t,x,y} (ventana en ms). Si el puntero lleva quieto, es 0. */
function velocidad(muestras, ahora, ventana = 100) {
  const rec = muestras.filter((s) => ahora - s.t <= ventana);
  if (rec.length < 2) return { x: 0, y: 0 };
  const a = rec[0], b = rec[rec.length - 1], dt = b.t - a.t;
  if (dt < 8) return { x: 0, y: 0 };
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

function limitarVel(v) {
  const s = Math.hypot(v.x, v.y);
  if (s <= VEL_MAX) return v;
  const k = VEL_MAX / s;
  return { x: v.x * k, y: v.y * k };
}

const esLanzamiento = (v) => Math.hypot(v.x, v.y) >= UMBRAL_LANZAMIENTO;

function limites(anchoPantalla, altoPantalla, w, h, margen = 6) {
  return { minX: margen, minY: margen, maxX: Math.max(margen, anchoPantalla - w - margen), maxY: Math.max(margen, altoPantalla - h - margen) };
}

const acotar = (v, a, b) => Math.max(a, Math.min(b, v));

/** Avanza dt ms. Muta f {x,y,vx,vy}. Devuelve "sigue" | "pared" (se queda pegada) | "fin" (frenó sola). */
function pasoInercia(f, dt, lim) {
  f.x += f.vx * dt;
  f.y += f.vy * dt;
  let golpe = false;
  if (f.x <= lim.minX) { f.x = lim.minX; golpe = true; } else if (f.x >= lim.maxX) { f.x = lim.maxX; golpe = true; }
  if (f.y <= lim.minY) { f.y = lim.minY; golpe = true; } else if (f.y >= lim.maxY) { f.y = lim.maxY; golpe = true; }
  if (golpe) { f.vx = 0; f.vy = 0; return "pared"; }
  const k = Math.pow(FRICCION, dt);
  f.vx *= k; f.vy *= k;
  return Math.hypot(f.vx, f.vy) < VEL_MIN ? "fin" : "sigue";
}

export { UMBRAL_LANZAMIENTO, velocidad, limitarVel, esLanzamiento, limites, acotar, pasoInercia };
