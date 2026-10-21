// Tinta (lápiz y borrador) para notas.
// Los trazos se guardan normalizados: x e y están divididos por el ancho del cuerpo de la nota,
// así se ven igual sin importar el tamaño de pantalla.
// Trazo: { c: "#color", w: grosor relativo, p: [[x, y, presión?], ...], f?: 1 (figura: líneas rectas) }
import { reconocerForma, reconocerFlecha, TIEMPO_MANTENER_FIGURA_MS, TOLERANCIA_QUIETO_PX } from "./notas-formas.js";

const GROSOR_BASE = 0.0045;
const PASO_MIN = 0.0008;      // distancia mínima entre puntos guardados
const RADIO_BORRADOR = 0.022; // radio del borrador (relativo al ancho)
const MAX_PUNTOS = 60000;
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
      const ang = Math.atan2(y1 - y0, x1 - x0), h = Math.max(9 * gmin, base * 4.2); // el mínimo va en la misma unidad que el grosor mínimo (px en el editor, unidades 0-1 en la miniatura)
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
  if (!p?.length) return false;
  const alcance = radio + Math.max(0, Number(t.w) || 0) / 2;
  const cerca = (ax, ay, bx, by) => {
    const dx = bx - ax, dy = by - ay, largo2 = dx * dx + dy * dy;
    const u = largo2 ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / largo2)) : 0;
    return Math.hypot(x - (ax + u * dx), y - (ay + u * dy)) <= alcance;
  };
  if (p.length === 1) return cerca(p[0][0], p[0][1], p[0][0], p[0][1]);
  for (let i = 1; i < p.length; i++) if (cerca(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1])) return true;
  return false;
}

// Simplifica las muestras vectoriales con Douglas–Peucker después de dibujar.
// La curva visible en tiempo real usa todos los eventos; el almacenamiento conserva presión y extremos.
function simplificarPuntos(p, eps = 0.00055) {
  if (!p || p.length < 3) return p;
  const keep = new Uint8Array(p.length); keep[0]=1; keep[p.length-1]=1;
  const stack=[[0,p.length-1]];
  while(stack.length){ const [a,b]=stack.pop(); let max=eps, idx=-1; const A=p[a],B=p[b],dx=B[0]-A[0],dy=B[1]-A[1],l2=dx*dx+dy*dy;
    for(let i=a+1;i<b;i++){const q=p[i];let t=l2?((q[0]-A[0])*dx+(q[1]-A[1])*dy)/l2:0;t=Math.max(0,Math.min(1,t));const d=Math.hypot(q[0]-(A[0]+t*dx),q[1]-(A[1]+t*dy));if(d>max){max=d;idx=i;}}
    if(idx>=0){keep[idx]=1;stack.push([a,idx],[idx,b]);}
  }
  const out=[];for(let i=0;i<p.length;i++)if(keep[i])out.push(p[i]);return out;
}
const contarPuntos = (trazos) => trazos.reduce((n, t) => n + t.p.length, 0);
const r4 = (v) => Math.round(v * 10000) / 10000;

function puntosFiguraArrastrada(modo, a, b) {
  let x0=a[0],y0=a[1],x1=b[0],y1=b[1];
  if (["cuadrado","circulo"].includes(modo)) { const lado=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));x1=x0+Math.sign(x1-x0||1)*lado;y1=y0+Math.sign(y1-y0||1)*lado; }
  if (modo === "linea" || modo === "flecha") return [[x0,y0],[x1,y1]];
  if (modo === "rectangulo" || modo === "cuadrado") return [[x0,y0],[x1,y0],[x1,y1],[x0,y1],[x0,y0]];
  if (modo === "triangulo") return [[(x0+x1)/2,y0],[x1,y1],[x0,y1],[(x0+x1)/2,y0]];
  if (modo === "rombo") return [[(x0+x1)/2,y0],[x1,(y0+y1)/2],[(x0+x1)/2,y1],[x0,(y0+y1)/2],[(x0+x1)/2,y0]];
  if (["circulo","elipse"].includes(modo)) {const rx=Math.abs(x1-x0)/2,ry=Math.abs(y1-y0)/2,cx=(x0+x1)/2,cy=(y0+y1)/2,out=[];for(let i=0;i<=48;i++){const t=2*Math.PI*i/48;out.push([cx+rx*Math.cos(t),cy+ry*Math.sin(t)]);}return out;}
  if (modo === "estrella") {const cx=(x0+x1)/2,cy=(y0+y1)/2,rx=Math.abs(x1-x0)/2,ry=Math.abs(y1-y0)/2,out=[];for(let i=0;i<=10;i++){const r=i%2?0.42:1,t=-Math.PI/2+i*Math.PI/5;out.push([cx+rx*r*Math.cos(t),cy+ry*r*Math.sin(t)]);}return out;}
  if (modo === "corazon") {const w=x1-x0,h=y1-y0,out=[];for(let i=0;i<=64;i++){const t=2*Math.PI*i/64,X=16*Math.sin(t)**3,Y=13*Math.cos(t)-5*Math.cos(2*t)-2*Math.cos(3*t)-Math.cos(4*t);out.push([x0+w*(X+16)/32,y0+h*(1-(Y+17)/30)]);}return out;}
  return [[x0,y0],[x1,y1]];
}

/**
 * Capa de dibujo sobre el cuerpo del editor.
 * obtenerTrazos(): devuelve el arreglo de trazos (se modifica en el lugar).
 * alCambiar(): se llama al terminar un trazo, un borrado, o un deshacer/rehacer.
 */
function crearCapaTinta({ cuerpo, viewport = cuerpo, modal, obtenerTrazos, alCambiar }) {
  const doc = modal.ownerDocument || document, win = doc.defaultView || window;
  const canvas = doc.createElement("canvas");
  canvas.className = "nt-tinta-canvas";
  if (win.getComputedStyle(modal).position === "static") modal.style.position = "relative";
  modal.append(canvas);
  const ctx = canvas.getContext("2d", { desynchronized: true }) || canvas.getContext("2d");

  let modo = null; // lápiz, borrador, línea, flecha o rectángulo
  let edicionFiguras = false, figuraSeleccionada = null, movimientoFigura = null;
  let color = "#172033";
  let grosor = GROSOR_BASE;
  let activo = false, actual = null, modoActivo = null, vistoLapiz = false;
  let ancho = 1, rect = null, suave = null, ancla = null, timerForma = 0, congelado = false, cambioFigura = null, zoomLienzo = 1, centroZoomLienzo = null;
  let huboBorrado = false, rafRedibujo = 0, rafTrazos = 0, colaTrazos = [], zoomDosDedos = false, punteroActivo = null;

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
    const r = viewport.getBoundingClientRect();
    const dpr = win.devicePixelRatio || 1;
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
    if (rafTrazos) win.cancelAnimationFrame(rafTrazos);
    rafTrazos = 0; colaTrazos.length = 0;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    ctx.save();const alto=canvas.clientHeight||canvas.height/(win.devicePixelRatio||1),cx=centroZoomLienzo?.x??ancho/2,cy=centroZoomLienzo?.y??alto/2;ctx.translate(cx*(1-zoomLienzo),cy*(1-zoomLienzo));ctx.scale(zoomLienzo,zoomLienzo);
    dibujarTrazos(ctx, obtenerTrazos(), ancho, viewport.scrollTop / zoomLienzo);
    if (edicionFiguras && figuraSeleccionada) { const p=figuraSeleccionada.p||[], esLinea=["linea","flecha"].includes(figuraSeleccionada.tipo), pts=esLinea?[p[0],p.at(-1)]:p, xs=pts.map(q=>q[0]*ancho), ys=pts.map(q=>q[1]*ancho-viewport.scrollTop/zoomLienzo); if(xs.length){ const pad=5,x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad,x1=Math.max(...xs)+pad,y1=Math.max(...ys)+pad; ctx.strokeStyle="#b7a5f4";ctx.lineWidth=1.5;ctx.setLineDash([5,4]);ctx.strokeRect(x0,y0,x1-x0,y1-y0);ctx.setLineDash([]);const hs=esLinea?pts:[[x0,y0],[(x0+x1)/2,y0],[x1,y0],[x1,(y0+y1)/2],[x1,y1],[(x0+x1)/2,y1],[x0,y1],[x0,(y0+y1)/2]];for(const h of hs){const hx=esLinea?h[0]*ancho:h[0],hy=esLinea?h[1]*ancho-viewport.scrollTop/zoomLienzo:h[1];ctx.beginPath();ctx.arc(hx,hy,5,0,Math.PI*2);ctx.fillStyle="#9b82e8";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=1.5;ctx.stroke();}}}
    ctx.restore();
  }
  const redibujarPronto = () => { if (!rafRedibujo) rafRedibujo = win.requestAnimationFrame(() => { rafRedibujo = 0; redibujar(); }); };

  function punto(e) {
    const r = rect || canvas.getBoundingClientRect();
    const w = r.width || 1, h = canvas.clientHeight || r.height || 1, z=zoomLienzo,cx=centroZoomLienzo?.x??w/2,cy=centroZoomLienzo?.y??h/2;
    const sx=((e.clientX-r.left)-cx*(1-z))/z, sy=((e.clientY-r.top)-cy*(1-z))/z;
    return [sx/w, (sy+viewport.scrollTop/zoomLienzo)/w];
  }

  function borrar(pt) {
    const trazos = obtenerTrazos();
    let cambio = false;
    for (let i = trazos.length - 1; i >= 0; i--) {
      if (trazoTocado(trazos[i], pt[0], pt[1], RADIO_BORRADOR)) { trazos.splice(i, 1); cambio = true; }
    }
    return cambio;
  }

  function iniciarRedimension(pt) {
    const t = figuraSeleccionada;
    if (!edicionFiguras || !t || !t.p?.length) return false;
    const xs = t.p.map((q) => q[0]), ys = t.p.map((q) => q[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const dentro = pt[0] >= x0 - 0.012 && pt[0] <= x1 + 0.012 && pt[1] >= y0 - 0.012 && pt[1] <= y1 + 0.012;
    if (!dentro && !trazoTocado(t, pt[0], pt[1], 0.02/zoomLienzo)) return false;
    const esLinea=["linea","flecha"].includes(t.tipo), puntosAsa=esLinea?[[t.p[0][0],t.p[0][1],"inicio"],[t.p.at(-1)[0],t.p.at(-1)[1],"fin"]]:[[x0,y0,"nw"],[(x0+x1)/2,y0,"n"],[x1,y0,"ne"],[x1,(y0+y1)/2,"e"],[x1,y1,"se"],[(x0+x1)/2,y1,"s"],[x0,y1,"sw"],[x0,(y0+y1)/2,"w"]];
    const asaCerca=puntosAsa.find(([x,y])=>Math.hypot((pt[0]-x)*ancho*zoomLienzo,(pt[1]-y)*ancho*zoomLienzo)<=12);
    if(asaCerca&&(esLinea||(x1-x0>=.015&&y1-y0>=.015))){
      if(esLinea)cambioFigura={t,original:t.p.map(q=>q.slice()),endpoint:asaCerca[2]==="inicio"?0:t.p.length-1,desde:pt};
      else{const [, ,handle]=asaCerca,ax=handle.includes("w")?x1:handle.includes("e")?x0:(x0+x1)/2,ay=handle.includes("n")?y1:handle.includes("s")?y0:(y0+y1)/2;cambioFigura={t,original:t.p.map(q=>q.slice()),ax,ay,w:x1-x0,h:y1-y0,soloX:["e","w"].includes(handle),soloY:["n","s"].includes(handle)};}
      canvas.dataset.redimensionando = "true";
    } else movimientoFigura = { t, original: t.p.map((q) => q.slice()), desde: pt };
    return true;
  }

  function actualizarRedimension(pt) {
    if (!cambioFigura) return;
    const d = cambioFigura;
    if(Number.isInteger(d.endpoint)){const orig=d.original[d.endpoint],dx=pt[0]-d.desde[0],dy=pt[1]-d.desde[1];d.t.p=d.original.map(q=>q.slice());d.t.p[d.endpoint]=[r4(orig[0]+dx),r4(orig[1]+dy),...orig.slice(2)];redibujarPronto();return;}
    let sx = d.soloY?1:Math.max(0.08, Math.abs(pt[0] - d.ax) / d.w), sy = d.soloX?1:Math.max(0.08, Math.abs(pt[1] - d.ay) / d.h);
    if (["circulo","cuadrado","estrella","corazon"].includes(d.t.tipo)) sx = sy = Math.max(sx, sy);
    d.t.p = d.original.map((q) => [r4(d.ax + (q[0] - d.ax) * sx), r4(d.ay + (q[1] - d.ay) * sy), ...q.slice(2)]);
    redibujarPronto();
  }

  /** Dibuja los segmentos nuevos en un solo fotograma, sin repintar la tinta anterior. */
  function dibujarSegmentoVivo(t, k) {
    const p = t.p, dy = viewport.scrollTop/zoomLienzo, alto=canvas.clientHeight||canvas.height/(win.devicePixelRatio||1),cx=centroZoomLienzo?.x??ancho/2,cy=centroZoomLienzo?.y??alto/2,proyectar=(x,y)=>[cx+(x-cx)*zoomLienzo,cy+(y-cy)*zoomLienzo];
    const X = (i) => proyectar(p[i][0]*ancho,p[i][1]*ancho-dy)[0], Y = (i) => proyectar(p[i][0]*ancho,p[i][1]*ancho-dy)[1];
    const lw = (i) => Math.max(1, t.w * ancho * (0.4 + 1.2 * (p[i][2] ?? 0.5))*zoomLienzo);
    ctx.strokeStyle = t.c; ctx.lineCap = "round"; ctx.lineJoin = "round";
    const linea = (x0, y0, x1, y1, w) => { ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
    if (k === 1) { linea(X(0), Y(0), X(1), Y(1), lw(1)); return; }
    const sx = (X(k - 2) + X(k - 1)) / 2, sy = (Y(k - 2) + Y(k - 1)) / 2;
    const ex = (X(k - 1) + X(k)) / 2, ey = (Y(k - 1) + Y(k)) / 2;
    ctx.lineWidth = lw(k - 1); ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(X(k - 1), Y(k - 1), ex, ey); ctx.stroke();
    linea(ex, ey, X(k), Y(k), lw(k));
  }

  function trazarVivo(t, k) {
    colaTrazos.push([t, k]);
    if (rafTrazos) return;
      rafTrazos = win.requestAnimationFrame(() => {
      rafTrazos = 0;
      const pendientes = colaTrazos; colaTrazos = [];
      for (const [trazo, indice] of pendientes) dibujarSegmentoVivo(trazo, indice);
    });
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
      const flecha = reconocerFlecha(actual.p);
      const f = flecha || reconocerForma(actual.p);
      if (!f) return;
      actual.p = f; actual.tipo = flecha ? "flecha" : f.tipo || "figura"; actual.f = 1; if (flecha) actual.a = 1; congelado = true;
      redibujar();
      try { win.navigator.vibrate?.(12); } catch (_) {}
    }, TIEMPO_MANTENER_FIGURA_MS);
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (zoomDosDedos || (!modo && !edicionFiguras) || activo) return;
    if (e.pointerType === "pen") vistoLapiz = true;
    // Con lápiz detectado, el dedo/palma no dibuja.
    if (e.pointerType === "touch" && vistoLapiz) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    rect = canvas.getBoundingClientRect();
    activo = true; punteroActivo=e.pointerId; congelado = false; huboBorrado = false;
    // El extremo borrador del lápiz óptico borra aunque esté el modo lápiz.
    // Lápiz óptico: el extremo borrador siempre borra; el botón lateral invierte la herramienta mientras lo mantienes (lápiz <-> borrador).
    const puntaBorrador = e.pointerType === "pen" && !!((e.buttons & 32) || e.button === 5);
    const botonLateral = e.pointerType === "pen" && !puntaBorrador && !!((e.buttons & 2) || e.button === 2);
    modoActivo = puntaBorrador ? "borrador" : botonLateral ? (modo === "lapiz" ? "borrador" : "lapiz") : modo;
    const pt = punto(e);
    if (edicionFiguras) {
      const hit = [...obtenerTrazos()].reverse().find((t) => t.tipo && t.f && trazoTocado(t, pt[0], pt[1], 0.018/zoomLienzo));
      if (hit) {
        figuraSeleccionada = hit; redibujar();
        if (iniciarRedimension(pt)) { actual = null; canvas.setPointerCapture(e.pointerId); return; }
      } else { figuraSeleccionada = null; redibujar(); if (!modo) { activo = false; return; } }
    }
    if (["lapiz", "linea", "flecha", "rectangulo", "cuadrado", "circulo", "elipse", "triangulo", "rombo", "estrella", "corazon"].includes(modoActivo)) {
      if (contarPuntos(obtenerTrazos()) >= MAX_PUNTOS) { activo = false; return; }
      suave = pt.slice(); ancla = pt;
      const p0 = [r4(pt[0]), r4(pt[1])];
      if (e.pointerType === "pen" && e.pressure > 0) p0.push(Math.round(e.pressure * 100) / 100);
      actual = { c: color, w: grosor, p: [p0] };
      if (modoActivo !== "lapiz") { actual.forma = modoActivo; actual.tipo = modoActivo; actual.f = 1; if(modoActivo === "flecha") actual.a=1; if(modoActivo !== "linea" && modoActivo !== "flecha") actual.p.push(p0.slice()); }
      obtenerTrazos().push(actual);
      ctx.fillStyle = color; ctx.beginPath();
      const h=canvas.clientHeight||canvas.height/(win.devicePixelRatio||1),cx=centroZoomLienzo?.x??ancho/2,cy=centroZoomLienzo?.y??h/2,px=cx+(pt[0]*ancho-cx)*zoomLienzo,py=cy+(pt[1]*ancho-viewport.scrollTop/zoomLienzo-cy)*zoomLienzo;ctx.arc(px,py,Math.max(1,grosor*ancho*zoomLienzo)/2,0,Math.PI*2);ctx.fill();
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
      if (movimientoFigura) { const d=movimientoFigura, dx=pt[0]-d.desde[0],dy=pt[1]-d.desde[1]; d.t.p=d.original.map(q=>[r4(q[0]+dx),r4(q[1]+dy),...q.slice(2)]); redibujarPronto(); continue; }
      if (cambioFigura) { actualizarRedimension(pt); continue; }
      if (actual?.forma && modoActivo !== "lapiz") { const p=puntosFiguraArrastrada(modoActivo,actual.p[0],pt);actual.p=p.map(q=>[r4(q[0]),r4(q[1])]);redibujarPronto();continue; }
      if (modoActivo === "lapiz" && actual) {
        if (congelado) continue;
        agregarPunto(actual, pt, ev);
        if (Math.hypot(pt[0] - ancla[0], pt[1] - ancla[1]) > TOLERANCIA_QUIETO_PX / Math.max(1, ancho)) { ancla = pt; movio = true; }
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
    activo = false;punteroActivo=null;
    if (movimientoFigura) { const movio=Math.hypot(...[punto(e)[0]-movimientoFigura.desde[0],punto(e)[1]-movimientoFigura.desde[1]])>0.002; movimientoFigura=null; redibujar(); if(movio){empujar();alCambiar();} return; }
    if (cambioFigura) { cambioFigura = null; delete canvas.dataset.redimensionando; redibujar(); empujar(); alCambiar(); return; }
    if (actual?.forma && modoActivo !== "lapiz") {
      const pt=e?.type==="pointerup"?punto(e):actual.p.at(-1);actual.p=puntosFiguraArrastrada(modoActivo,actual.p[0],pt).map(q=>[r4(q[0]),r4(q[1])]);delete actual.forma;actual.f=1;actual.tipo=modoActivo;actual=null;redibujar();empujar();alCambiar();
    } else if (modoActivo === "lapiz" && actual) {
      if (!congelado && e?.type === "pointerup") {
        const u = actual.p[actual.p.length - 1], pt = punto(e);
        if (Math.hypot(pt[0] - u[0], pt[1] - u[1]) > PASO_MIN / 2) actual.p.push([r4(pt[0]), r4(pt[1])]);
        // El trazo libre solo se reconoce como figura si se mantuvo quieto durante 600 ms.
        // Al soltar antes de ese tiempo, se conserva como tinta libre.
        if (!congelado) actual.p = simplificarPuntos(actual.p);
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
  canvas.addEventListener("contextmenu", (e) => { if (edicionFiguras) { e.preventDefault(); const pt=punto(e),hit=[...obtenerTrazos()].reverse().find(t=>t.tipo&&t.f&&trazoTocado(t,pt[0],pt[1],.018/zoomLienzo));if(hit){figuraSeleccionada=hit;redibujar();modal.dispatchEvent(new win.CustomEvent("nt:figura-contexto",{detail:{figura:hit,x:e.clientX,y:e.clientY}}));} }else if (modo) e.preventDefault(); });
  canvas.addEventListener("pointerup", terminar);
  canvas.addEventListener("pointercancel", terminar);
  // El canvas tapa el cuerpo: reenvía la rueda para poder hacer scroll.
  canvas.addEventListener("wheel", (e) => { viewport.scrollTop += e.deltaY; }, { passive: true });
  viewport.addEventListener("scroll", redibujarPronto, { passive: true });

  const observador = typeof win.ResizeObserver === "function" ? new win.ResizeObserver(ubicar) : null;
  observador?.observe(cuerpo);
  observador?.observe(modal);
  win.addEventListener("resize", ubicar);
  win.requestAnimationFrame(ubicar);

  return {
    establecerNivel(nivel) { canvas.style.zIndex = String(Math.max(-2000, Math.min(2000, Number(nivel) || 0))); },
    establecerModo(m) {
      modo = m;
      canvas.classList.toggle("activo", !!m);
      canvas.dataset.modo = m || "";
      if (!m) { clearTimeout(timerForma); activo = false; actual = null; }
    },
    obtenerModo: () => modo,
    obtenerZoomLienzo:()=>zoomLienzo,
    establecerZoomLienzo(v,x=null,y=null){zoomLienzo=Math.max(.05,Math.min(4,Number(v)||1));centroZoomLienzo=x==null||y==null?null:{x:x-(rect?.left||0),y:y-(rect?.top||0)};redibujar();return zoomLienzo;},
    establecerEdicionFiguras(v) { edicionFiguras=!!v; if(!edicionFiguras) figuraSeleccionada=null; canvas.classList.toggle("nt-edicion-figuras",edicionFiguras); redibujar(); },
    eliminarFiguraSeleccionada() { if(!figuraSeleccionada) return false; const i=obtenerTrazos().indexOf(figuraSeleccionada); if(i<0) return false; obtenerTrazos().splice(i,1); figuraSeleccionada=null; redibujar(); empujar(); alCambiar(); return true; },
    cambiarColorFiguraSeleccionada(c){if(!figuraSeleccionada||!/^#[\da-f]{6}$/i.test(c||""))return false;figuraSeleccionada.c=c;redibujar();empujar();alCambiar();return true;},
    establecerColor(c) { color = c; },
    establecerGrosor(v) { grosor = Math.max(0.0015, Math.min(0.02, Number(v) || GROSOR_BASE)); },
    puedeDeshacer: () => hi > 0,
    puedeRehacer: () => hi < hist.length - 1,
    deshacer() { if (hi > 0) restaurar(hi - 1); },
    rehacer() { if (hi < hist.length - 1) restaurar(hi + 1); },
    redibujar,
    dibujarMiniMapa(ctxMini, anchoMini){dibujarTrazos(ctxMini,obtenerTrazos(),anchoMini,0,.5);},
    ubicar,
    iniciarZoomDosDedos(){zoomDosDedos=true;clearTimeout(timerForma);if(actual){const i=obtenerTrazos().indexOf(actual);if(i>=0)obtenerTrazos().splice(i,1);}actual=null;activo=false;modoActivo=null;movimientoFigura=null;cambioFigura=null;punteroActivo=null;redibujar();},
    terminarZoomDosDedos(){zoomDosDedos=false;},
    exportarImagenOCR() {
      const trazos=obtenerTrazos();if(!trazos.length)return null;
      const puntos=trazos.flatMap(t=>t.p||[]);if(!puntos.length)return null;
      const xs=puntos.map(p=>p[0]),ys=puntos.map(p=>p[1]),pad=.025,x0=Math.min(...xs)-pad,y0=Math.min(...ys)-pad,x1=Math.max(...xs)+pad,y1=Math.max(...ys)+pad;
      const w=Math.max(.04,x1-x0),h=Math.max(.04,y1-y0),lado=1400,scale=Math.min(lado/Math.max(w,h),lado),cw=Math.max(96,Math.round(w*scale)),ch=Math.max(96,Math.round(h*scale));
      const out=doc.createElement("canvas");out.width=cw;out.height=ch;const c=out.getContext("2d");c.fillStyle="#fff";c.fillRect(0,0,cw,ch);c.save();c.translate(-x0*scale,-y0*scale);c.scale(scale,scale);
      const normalizados=trazos.map(t=>({...t,c:"#111",w:Math.max(.004,Number(t.w)||GROSOR_BASE),p:(t.p||[]).map(q=>[q[0],q[1],...(q.length>2?[q[2]]:[])])}));dibujarTrazos(c,normalizados,1,0,2);c.restore();return out.toDataURL("image/png");
    },
    destruir() {
      clearTimeout(timerForma);
      win.cancelAnimationFrame(rafRedibujo);
      win.cancelAnimationFrame(rafTrazos); colaTrazos.length = 0;
      observador?.disconnect();
      win.removeEventListener("resize", ubicar);
      viewport.removeEventListener("scroll", redibujarPronto);
      canvas.remove();
    },
  };
}

/** Miniatura de la tinta para la tarjeta. Se redibuja con la resolución real con que se muestra (tamaño x densidad de pantalla),
 *  así no se ve pixelada aunque la tarjeta sea ancha. Devuelve null si no hay trazos. */
function crearMiniTinta(trazos, { alinear = false, nivel = 5 } = {}) {
  if (!Array.isArray(trazos) || !trazos.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const t of trazos) for (const [x, y] of t.p) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  if (!Number.isFinite(x0)) return null;
  const pad = alinear ? 0 : 0.015;
  const w = alinear ? 1 : Math.max(0.05, x1 - x0 + pad * 2), h = alinear ? Math.max(0.05, y1 + pad) : Math.max(0.05, y1 - y0 + pad * 2);
  if (alinear) { x0 = 0; y0 = 0; }
  const c = document.createElement("canvas");
  c.className = `nota-tinta-mini${alinear ? " nota-tinta-alineada" : ""}`;
  c.style.zIndex = String(Math.max(-2000, Math.min(2000, Number(nivel) || 0)));
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
