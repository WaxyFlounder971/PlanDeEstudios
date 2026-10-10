/*!
 * FolderIntro — animación de apertura del folder (libro 3D que se abre y revela la app).
 *
 *   FolderIntro.play()                      // revela la app que haya detrás (#app, #root o [data-app])
 *   FolderIntro.play({ app: '#mi-app' })    // o indica tú el elemento / selector de la app
 *   FolderIntro.play({ container: el })     // dentro de un contenedor (position: relative/absolute) en vez de toda la pantalla
 *   FolderIntro.play().then(() => ...)      // promesa: se resuelve cuando termina
 *
 * La animación es solo una capa por encima: NO toca ni mueve tu app. Cuando la capa se va,
 * lo que queda es tu app real. Si no hay app lista (no existe o está vacía) no se anima y
 * la promesa se resuelve en false (versión de la app: sin pantalla de respaldo).
 *   var l = FolderIntro.load({ colors: [6 hex] })  // folder cerrado con pestañas en bucle mientras la app carga
 *   l.open()   // app lista: abre el folder y revela la app (promesa)   |   l.abandon()  // retirarlo sin abrir
 *
 * Sin dependencias. Respeta prefers-reduced-motion (no anima, resuelve de inmediato).
 */
(function (global) {
  'use strict';

  // ---------- parámetros de la animación ----------
  var COLORS = ['#e8452a', '#f28a2b', '#e6c52c', '#2fa86b', '#3a7de2', '#8b4ae0'];
  var COVER_C = '#26272b', CHEV_C = '#202124', BACK_C = '#1a1b1d';
  var W = 1200, SPLIT = 800, SLOPE = .88, BAND = 345, RC = 64, LF = 110;
  var N = 10;                    // tiras por hoja (curvatura suave)
  var T0 = 1.0, ST = .09, DUR = .55;   // inicio del giro, desfase entre hojas, duración de cada giro
  var WIDE = .85;                // ancho/alto a partir del cual se usa la versión horizontal

  // ---------- geometría ----------
  function f(n) { return Math.round(n * 10) / 10; }
  function unit(a, b) { var x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y); return [x / l, y / l]; }
  function corner(a, p, b, d) {
    var u = unit(p, a), v = unit(p, b);
    return 'L' + f(p[0] + u[0] * d) + ' ' + f(p[1] + u[1] * d) + 'Q' + f(p[0]) + ' ' + f(p[1]) + ' ' + f(p[0] + v[0] * d) + ' ' + f(p[1] + v[1] * d);
  }
  function geo(H) { var TOP = Math.round(.118 * H); return { H: H, TOP: TOP, TH: (H - TOP) / 6, cy: H / 2 }; }
  function tabPath(g, i, L) {
    if (L == null) L = LF;
    var y = g.TOP + (i - 1) * g.TH + 2, H = g.H, R = Math.min(56, (g.TH - 2) / 2), T = 8, B = H - 8, r = RC + 40;
    return 'M' + (L + r) + ' ' + T + 'H' + SPLIT + 'V' + f(y) + 'H' + (W - R) + 'a' + R + ' ' + R + ' 0 0 1 ' + R + ' ' + R +
      'V' + f(y + g.TH - 2 - R) + 'a' + R + ' ' + R + ' 0 0 1-' + R + ' ' + R + 'H' + SPLIT + 'V' + B + 'H' + (L + r) +
      'Q' + L + ' ' + B + ' ' + L + ' ' + (B - r) + 'V' + (T + r) + 'Q' + L + ' ' + T + ' ' + (L + r) + ' ' + T + 'Z';
  }
  function coverPath(g) {
    var H = g.H;
    return 'M0 ' + RC + 'Q0 0 ' + RC + ' 0H' + (W - RC) + 'Q' + W + ' 0 ' + W + ' ' + RC + 'V' + f(g.TOP - RC) + 'Q' + W + ' ' + g.TOP + ' ' + f(W - RC) + ' ' + g.TOP +
      'H' + f(SPLIT + RC) + 'Q' + SPLIT + ' ' + g.TOP + ' ' + SPLIT + ' ' + f(g.TOP + RC) + 'V' + H + 'H' + RC + 'Q0 ' + H + ' 0 ' + (H - RC) + 'Z';
  }
  function chevron(g) {
    var ax = SPLIT + 14, cy = g.cy, t0 = cy - SLOPE * ax, b0 = cy + SLOPE * ax, xi = ax - BAND / SLOPE;
    var P0 = [0, t0], A = [ax, cy], P2 = [0, b0], P3 = [0, b0 - BAND], B = [xi, cy], P5 = [0, t0 + BAND];
    return 'M0 ' + f(t0) + corner(P0, A, P2, 34) + 'L0 ' + f(b0) + 'L0 ' + f(b0 - BAND) + corner(P3, B, P5, 58) + 'L0 ' + f(t0 + BAND) + 'Z';
  }

  // ---------- imágenes de página (una por cara, compartidas por las 10 tiras) ----------
  function uri(inner, g) {
    return "url('data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + g.H + '" preserveAspectRatio="none">' + inner + '</svg>').replace(/'/g, '%27') + "')";
  }
  function dark(c) { var n = parseInt(c.slice(1), 16); return 'rgb(' + Math.round((n >> 16) * .8) + ',' + Math.round((n >> 8 & 255) * .8) + ',' + Math.round((n & 255) * .8) + ')'; }
  // frente (arte), frente (silueta negra para sombra), reverso (espejado, color), reverso (silueta negra)
  function pageImgs(g, i, pal) {
    var d = i == 0 ? coverPath(g) : tabPath(g, i), mir = '<g transform="translate(' + W + ' 0) scale(-1 1)">';
    var art = i == 0 ? '<defs><clipPath id="cv"><path d="' + d + '"/></clipPath></defs><path fill="' + COVER_C + '" d="' + d + '"/><path fill="' + CHEV_C + '" d="' + chevron(g) + '" clip-path="url(#cv)"/>'
                     : '<path fill="' + pal[i - 1] + '" d="' + d + '"/>';
    var bc = i == 0 ? '#1c1d20' : dark(pal[i - 1]);
    return '--fi-af:' + uri(art, g) + ';--fi-sf:' + uri('<path d="' + d + '"/>', g) + ';--fi-ab:' + uri(mir + '<path fill="' + bc + '" d="' + d + '"/></g>', g) + ';--fi-sb:' + uri(mir + '<path d="' + d + '"/></g>', g);
  }
  function strips(k, sw, bw) {
    return '<div class="fi-st" style="--fi-of:' + (-k * sw) + 'px;--fi-ob:' + (k * sw + sw + 2 - bw) + 'px">' +
      '<div class="fi-fc fi-front"></div><div class="fi-fc fi-back"></div>' + (k < N - 1 ? strips(k + 1, sw, bw) : '') + '</div>';
  }

  // ---------- CSS (con prefijo fi- para no chocar con la app) ----------
  function shadowKeyframes() {
    // sombra del frente = sombra proyectada por la hoja anterior + sombra propia, en UNA sola animación
    var T = DUR + ST, pts = { 0: 1, 1: 1 }, k;
    [ST, DUR / 2, ST + DUR / 2, DUR, T].forEach(function (t) { pts[t / T] = 1; });
    for (k = 0; k <= 32; k++) pts[k / 32] = 1;
    function sh(t) { var x = (t - ST) / DUR; return x <= 0 ? 0 : x < .5 ? .55 * x / .5 : .55; }
    function ca(t) { var x = t / DUR; return x <= 0 || x >= 1 ? 0 : x < .5 ? .4 * x / .5 : .4 * (1 - (x - .5) / .5); }
    var css = '@keyframes fi-shC{';
    Object.keys(pts).map(Number).sort(function (a, b) { return a - b; }).forEach(function (p) {
      var t = p * T, a = 1 - (1 - sh(t)) * (1 - ca(t)); css += (p * 100).toFixed(3) + '%{opacity:' + a.toFixed(4) + '}';
    });
    return css + '}';
  }

  var CSS = [
    '.fi-root{position:fixed;inset:0;z-index:2147483000;overflow:hidden;-webkit-tap-highlight-color:transparent}',
    '.fi-root.fi-in{position:absolute;z-index:1000}',
    '.fi-root,.fi-root *{box-sizing:border-box}',
    '.fi-slot{position:absolute;inset:0;z-index:5}',
    /* horizontal: el libro se abre en el centro, SOBRE la app (que se ve completa desde el primer cuadro) */
    '.fi-bg{position:absolute;inset:0;background:var(--fi-bg,#000)}',
    '.fi-wide .fi-slot,.fi-wide .fi-bg{animation:fi-slotOut .4s linear var(--fi-ot) both}',
    '.fi-bg.fi-bgn{animation:fi-slotOut .3s linear var(--fi-ot) both}',
    '@keyframes fi-slotOut{to{opacity:0}}',
    '.fi-bk{position:absolute;clip-path:inset(-10% -300% -10% 0);animation:fi-bkOpen .001s linear var(--fi-t0) forwards}',
    '@keyframes fi-bkOpen{to{clip-path:inset(-10% -300% -10% -300%)}}',
    /* libro 3D */
    '.fi-bd{position:absolute;inset:0;background:' + BACK_C + ';z-index:1;animation:fi-bdOut .25s linear var(--fi-bdt) forwards}',
    '@keyframes fi-bdOut{to{opacity:0;visibility:hidden}}',
    '.fi-sl{position:absolute;inset:0;perspective:var(--fi-pp,1500px);perspective-origin:30% 45%;z-index:calc(20 - var(--fi-i))}',
    '.fi-sl.fi-p0{animation:fi-rise .3s cubic-bezier(.2,.8,.2,1) both,fi-zflip var(--fi-dur) linear var(--fi-d) forwards}',
    '.fi-sl.fi-pn{animation:fi-zflip var(--fi-dur) linear var(--fi-d) forwards}',
    /* al pasar de 90° se invierte el orden de capas: la hoja que cae queda encima de las anteriores */
    '@keyframes fi-zflip{0%,49.9%{z-index:calc(20 - var(--fi-i))}50%,100%{z-index:var(--fi-i)}}',
    '@keyframes fi-rise{from{opacity:0;transform:translateX(-40px)}}',
    '@keyframes fi-slide{0%{opacity:0;transform:translateX(-120px);clip-path:inset(-10% -300% -10% calc(58% + 120px))}99.9%{clip-path:inset(-10% -300% -10% 58%)}100%{opacity:1;transform:none;clip-path:inset(-10% -300% -10% -300%)}}',
    '.fi-pg{position:absolute;inset:0;transform-origin:left center;transform-style:preserve-3d;will-change:transform;animation:fi-turn var(--fi-dur) cubic-bezier(.4,0,.25,1) var(--fi-d) forwards,fi-tilt var(--fi-dur) ease-in-out var(--fi-d) forwards}',
    '@keyframes fi-turn{to{rotate:0 1 0 -180deg}}',
    '@keyframes fi-tilt{50%{transform:rotateX(2deg)}}',
    '@keyframes fi-bend{0%{transform:rotateY(0deg)}35%{transform:rotateY(5deg)}75%{transform:rotateY(-1.2deg)}100%{transform:rotateY(0deg)}}',
    '.fi-st{position:absolute;top:0;left:0;width:calc(var(--fi-sw) + 2px);height:100%;transform-style:preserve-3d;transform-origin:left center}',
    '.fi-st .fi-st{left:var(--fi-sw);animation:fi-bend var(--fi-dur) ease-in-out var(--fi-d) forwards}',
    '.fi-fc{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden}',
    '.fi-front{background:var(--fi-af) var(--fi-of) 0/var(--fi-bw) 100% no-repeat}',
    '.fi-back{transform:rotateY(180deg);visibility:hidden;animation:fi-bshow .001s linear var(--fi-d) forwards;background:var(--fi-ab) var(--fi-ob) 0/var(--fi-bw) 100% no-repeat}',
    '@keyframes fi-bshow{to{visibility:visible}}',
    '.fi-front::after,.fi-back::after{content:"";position:absolute;inset:0;opacity:0;pointer-events:none}',
    '.fi-front::after{background:var(--fi-sf) var(--fi-of) 0/var(--fi-bw) 100% no-repeat}',
    '.fi-back::after{background:var(--fi-sb) var(--fi-ob) 0/var(--fi-bw) 100% no-repeat;animation:fi-shB var(--fi-dur) linear var(--fi-d) forwards}',
    '.fi-p0 .fi-front::after{animation:fi-shF var(--fi-dur) linear var(--fi-d) forwards}',
    '.fi-pn .fi-front::after{animation:fi-shC var(--fi-tot) linear var(--fi-cd) forwards}',
    '@keyframes fi-shF{0%{opacity:0}50%,100%{opacity:.55}}',
    '@keyframes fi-shB{0%,50%{opacity:.55}100%{opacity:0}}',
    /* mientras la app carga (bucle de pestañas) todo lo de la apertura queda en pausa; al soltar, sus retardos empiezan a contar */
    /* !important: los selectores de cada animación (p. ej. .fi-p0 .fi-front::after) tienen más especificidad y su shorthand `animation` volvía a poner "running" */
    '.fi-hold *,.fi-hold *::before,.fi-hold *::after{animation-play-state:paused!important}',
    '.fi-hold .fi-sl.fi-p0{animation-play-state:running,paused!important}',
    shadowKeyframes()
  ].join('\n');

  // ---------- utilidades ----------
  function inject() {
    if (document.getElementById('fi-style')) return;
    var st = document.createElement('style'); st.id = 'fi-style'; st.textContent = CSS;
    (document.head || document.documentElement).appendChild(st);
  }
  function pick(app) {
    if (typeof app === 'string') return document.querySelector(app);
    if (app && app.nodeType === 1) return app;
    return document.querySelector('#app,#root,[data-app]');
  }
  // color de fondo real de la app (primer ancestro con fondo sólido)
  function appBg(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) return c;
    }
    return global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)').matches ? '#000' : '#fff';
  }
    function hasApp(el) { return !!el && (el.childElementCount > 0 || (el.textContent || '').trim() !== ''); }

  // ---------- reproducción ----------
  // Dos fases:
  //   load()  -> monta el folder cerrado y deja las pestañas en bucle (salen 1..6, entran 6..1, y otra vez)
  //              mientras la app todavía carga.
  //   open()  -> la app ya está lista: las pestañas terminan de salir y el folder se abre mostrando la app.
  // play() = load() + open() seguidos (reproducción normal, sin espera).
  var cur = null;
  function cleanup(c) {
    c.alive = false; cancelAnimationFrame(c.raf); clearTimeout(c.timer); clearTimeout(c.fadeT);
    if (c.root.parentNode) c.root.parentNode.removeChild(c.root);
  }
  function cancel() {
    if (!cur) return;
    var c = cur; cur = null; cleanup(c); c.state = 'cancelled';
    if (c.resolve) c.resolve(false);
  }

  // bucle de pestañas: sale 1,2,3… (desfase STG), pausa, entra …3,2,1, pausa corta y repite
  var M = .28, STG = .08, HOLD_T = .35, PAUSE_T = .25, LEAD = .25;
  var OUT_END = 5 * STG + M, IN_START = OUT_END + HOLD_T, P = IN_START + 5 * STG + M + PAUSE_T;
  function sm(u) { return u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u); }
  function xLoop(i, c) {
    var a = i * STG, b = IN_START + (5 - i) * STG;
    if (c < a) return 0;
    if (c < a + M) return sm((c - a) / M);
    if (c < b) return 1;
    if (c < b + M) return 1 - sm((c - b) / M);
    return 0;
  }
  function setX(el, x) {
    if (x <= 0) { el.style.opacity = '0'; el.style.transform = 'translateX(-120px)'; return; }
    if (x >= 1) { el.style.opacity = '1'; el.style.transform = 'none'; el.style.clipPath = 'inset(-10% -300% -10% -300%)'; return; }
    var off = 120 * (1 - x);
    el.style.opacity = String(Math.min(1, x * 3));
    el.style.transform = 'translateX(' + (-off) + 'px)';
    el.style.clipPath = 'inset(-10% -300% -10% calc(58% + ' + off + 'px))';   // el hueco visible queda fijo en pantalla: la pestaña "sale" de detrás de la portada
  }
  function hex(c, i) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : COLORS[i]; }

  function load(opts) {
    opts = opts || {};
    cancel(); inject();
    var none = { state: 'none', open: function () { return Promise.resolve(false); }, abandon: function () {}, cancel: function () {} };
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion:reduce)').matches) return none;
    var appEl = pick(opts.app);
    if (!hasApp(appEl)) return none;   // sin app no hay nada que revelar: no se anima

    var pal = []; for (var q = 0; q < 6; q++) pal.push(hex(opts.colors && opts.colors[q], q));
    var t0 = .05, settle = typeof opts.settle === 'number' ? opts.settle : .12;
    var host = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    var root = document.createElement('div');
    root.className = 'fi-root fi-hold' + (host ? ' fi-in' : '');
    (host || document.body).appendChild(root);

    var pw = root.clientWidth, ph = root.clientHeight, wide = pw / ph > WIDE, g, sw, bw, open = '', close = '', end, bgDiv = '';
    if (wide) {
      // libro en proporción nativa, centrado, 80% del alto
      sw = Math.round(ph * .8 * W / 1632 / N); bw = sw * N;
      var bh = Math.round(bw * 1632 / W), bl = Math.round((pw - bw) / 2), bt = Math.round((ph - bh) / 2), ot = t0 + 6 * ST + DUR * .5;
      g = geo(1632);
      open = '<div class="fi-bk" style="left:' + bl + 'px;top:' + bt + 'px;width:' + bw + 'px;height:' + bh + 'px;--fi-pp:' + Math.max(1500, bw * 3.75) + 'px;--fi-t0:' + t0 + 's">'; close = '</div>';
      root.style.setProperty('--fi-ot', ot + 's');
      root.style.setProperty('--fi-bg', appBg(appEl));   // el fondo se tapa con el color de fondo de la app mientras corre la animación
      root.classList.add('fi-wide'); bgDiv = '<div class="fi-bg"></div>';
      end = ot + .45;   // al terminar de girar, lo que queda del libro se desvanece y queda solo la app
    } else {
      g = geo(W * ph / pw); sw = Math.ceil(pw / N); bw = pw; end = t0 + 6 * ST + DUR + .2;
      root.style.setProperty('--fi-bg', appBg(appEl)); root.style.setProperty('--fi-ot', t0 + 's'); bgDiv = '<div class="fi-bg fi-bgn"></div>';   // telón del color de la app: evita ver la app un instante antes de que suba la portada
    }
    var h = open + '<div class="fi-bd" style="--fi-bdt:' + (t0 + 5 * ST + .15) + 's;border-radius:' + (RC / W * bw) + 'px"></div>';
    for (var i = 0; i < 7; i++) {
      h += '<div class="fi-sl ' + (i ? 'fi-pn' : 'fi-p0') + '" style="--fi-i:' + i + ';--fi-d:' + (t0 + i * ST) + 's;--fi-cd:' + (t0 + (i - 1) * ST) + 's;--fi-sw:' + sw + 'px;--fi-dur:' + DUR + 's;--fi-tot:' + (DUR + ST) + 's;--fi-bw:' + bw + 'px;' + pageImgs(g, i, pal) + (i ? ';opacity:0;transform:translateX(-120px)' : '') + '">' +
           '<div class="fi-pg">' + strips(0, sw, bw) + '</div></div>';
    }
    root.innerHTML = bgDiv + '<div class="fi-slot"' + (wide ? '' : ' style="--fi-pp:' + Math.max(1500, pw * 3.75) + 'px"') + '>' + h + close + '</div>';

    var tabs = [].slice.call(root.querySelectorAll('.fi-sl.fi-pn'));
    var c = { root: root, state: 'loading', alive: true, resolve: null, raf: 0, timer: 0, fadeT: 0 };
    cur = c;
    var t00 = performance.now(), mode = 'loop', stopAt = 0, tr = 0, x0 = [], xs = [0, 0, 0, 0, 0, 0], opened = null;

    function release() {   // suelta las animaciones de apertura (giro de hojas) con las pestañas ya afuera
      mode = 'done'; tabs.forEach(function (el) { setX(el, 1); });
      c.timer = setTimeout(function () {
        root.classList.remove('fi-hold');
        c.timer = setTimeout(function () {
          if (cur === c) cur = null; cleanup(c); c.state = 'done';
          if (opts.onEnd) opts.onEnd(); if (opened) opened(true);
        }, end * 1000);
      }, settle * 1000);
    }
    function frame(now) {
      if (!c.alive) return;
      var t = (now - t00) / 1000 - LEAD, k = t < 0 ? 0 : Math.floor(t / P), cc = t < 0 ? -1 : t - k * P, i;
      if (mode === 'loop' || mode === 'out') {
        if (mode === 'out' && t >= stopAt) { release(); return; }
        for (i = 0; i < 6; i++) { xs[i] = cc < 0 ? 0 : xLoop(i, cc); setX(tabs[i], xs[i]); }
      } else if (mode === 'tween') {
        var u = sm((now - tr) / 240);
        for (i = 0; i < 6; i++) setX(tabs[i], x0[i] + (1 - x0[i]) * u);
        if (u >= 1) { release(); return; }
      }
      c.raf = requestAnimationFrame(frame);
    }
    c.raf = requestAnimationFrame(frame);
    if (opts.maxWait) c.fadeT = setTimeout(function () { ctl.abandon(); }, opts.maxWait);
    if (opts.onStart) opts.onStart();

    var ctl = {
      get state() { return c.state; },
      // La app ya está lista: termina de sacar las pestañas y abre. Promesa: true = terminó completa, false = se saltó/canceló.
      open: function () {
        if (c.state !== 'loading') return Promise.resolve(false);
        c.state = 'opening'; clearTimeout(c.fadeT);
        return new Promise(function (resolve) {
          opened = resolve; c.resolve = resolve;
          var t = (performance.now() - t00) / 1000 - LEAD, k = t < 0 ? 0 : Math.floor(t / P), cc = t < 0 ? -1 : t - k * P;
          if (cc < OUT_END) { mode = 'out'; stopAt = k * P + OUT_END; }                          // aún saliendo: sigue el mismo ritmo hasta que salgan todas
          else if (cc < IN_START) { mode = 'out'; stopAt = t; }                                  // ya están todas afuera: abre ya
          else { mode = 'tween'; tr = performance.now(); x0 = xs.slice(); }                      // estaban entrando: vuelven a salir desde donde van
        });
      },
      // Se retira con un fundido corto SIN abrir (p. ej. toque durante la carga, o la carga falló): queda lo que haya debajo.
      abandon: function () {
        if (c.state === 'done' || c.state === 'cancelled' || c.state === 'abandoned') return;
        c.state = 'abandoned'; clearTimeout(c.fadeT); clearTimeout(c.timer); cancelAnimationFrame(c.raf);
        if (opts.onAbandon) { try { opts.onAbandon(); } catch (e) {} }   // p. ej. devolver el cargador de siempre
        root.style.pointerEvents = 'none'; root.style.transition = 'opacity .3s ease'; root.style.opacity = '0';
        if (cur === c) cur = null;
        var res = c.resolve; c.timer = setTimeout(function () { cleanup(c); if (res) res(false); }, 340);
      },
      cancel: function () { if (cur === c) cancel(); }
    };
    return ctl;
  }

  function play(opts) { var l = load(opts); return l.open(); }

  function clearFallback() {}   // compatibilidad: ya no hay respaldo que quitar

  global.FolderIntro = { load: load, play: play, cancel: cancel, clearFallback: clearFallback };
})(typeof window !== 'undefined' ? window : this);
