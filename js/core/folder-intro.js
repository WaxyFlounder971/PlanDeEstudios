/*!
 * FolderIntro — animación de apertura del folder (libro 3D que se abre y revela la app).
 * VERSIÓN OPTIMIZADA.
 *
 *   FolderIntro.play()                      // revela la app que haya detrás (#app, #root o [data-app])
 *   FolderIntro.play({ app: '#mi-app' })    // o indica tú el elemento / selector de la app
 *   FolderIntro.play({ container: el })     // dentro de un contenedor en vez de toda la pantalla
 *   var l = FolderIntro.load({ colors: [6 hex], strips: 5 })  // folder cerrado con pestañas en bucle mientras la app carga
 *   l.open()   // app lista: abre el folder y revela la app (promesa)   |   l.abandon()  // retirarlo sin abrir
 *
 * Qué cambió respecto a la versión anterior (todo para que no se trabe):
 *  - El bucle de pestañas ya NO corre en JS con requestAnimationFrame: usa Web Animations
 *    (solo transform + opacity), que se ejecutan en el hilo del compositor. Así sigue fluido
 *    aunque la app esté ocupada cargando (que es justo cuando el folder está visible).
 *  - Ya no se anima clip-path por cuadro (obligaba a repintar en el hilo principal).
 *  - Menos capas 3D: 5-6 tiras por hoja en vez de 10 (la curvatura total se conserva).
 *  - Sin sombras por tira (eran ~140 capas extra con opacidad animada).
 *  - Mientras la app carga NO existe ninguna animación CSS de apertura (antes eran ~70 en pausa),
 *    y las caras traseras ni se renderizan hasta que la app está lista.
 *  - Las imágenes de página viven en una hoja de estilos (una vez), no en variables CSS
 *    heredadas por cada tira.
 *
 * Es solo una capa por encima: NO toca ni mueve tu app. Respeta prefers-reduced-motion.
 * Sin dependencias.
 */
(function (global) {
  'use strict';

  // ---------- parámetros de la animación ----------
  var COLORS = ['#e8452a', '#f28a2b', '#e6c52c', '#2fa86b', '#3a7de2', '#8b4ae0'];
  var COVER_C = '#26272b', CHEV_C = '#202124', BACK_C = '#1a1b1d';
  var W = 1200, SPLIT = 800, SLOPE = .88, BAND = 345, RC = 64, LF = 110;
  var BASE_N = 10;               // tiras "de referencia": la curvatura se escala respecto a este valor
  var T0 = 1.0, ST = .09, DUR = .55;
  var WIDE = .85;                // ancho/alto a partir del cual se usa la versión horizontal
  var EASE = 'cubic-bezier(.42,0,.58,1)';

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

  // ---------- imágenes de página (una por cara; se declaran UNA vez en una hoja de estilos) ----------
  function uri(inner, g) {
    return "url('data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + g.H + '" preserveAspectRatio="none">' + inner + '</svg>').replace(/'/g, '%27') + "')";
  }
  function dark(c) { var n = parseInt(c.slice(1), 16); return 'rgb(' + Math.round((n >> 16) * .8) + ',' + Math.round((n >> 8 & 255) * .8) + ',' + Math.round((n & 255) * .8) + ')'; }
  function pageCss(g, i, pal) {
    var d = i == 0 ? coverPath(g) : tabPath(g, i), mir = '<g transform="translate(' + W + ' 0) scale(-1 1)">';
    var art = i == 0 ? '<defs><clipPath id="cv"><path d="' + d + '"/></clipPath></defs><path fill="' + COVER_C + '" d="' + d + '"/><path fill="' + CHEV_C + '" d="' + chevron(g) + '" clip-path="url(#cv)"/>'
                     : '<path fill="' + pal[i - 1] + '" d="' + d + '"/>';
    var bc = i == 0 ? '#1c1d20' : dark(pal[i - 1]);
    return '.fi-root .fi-g' + i + ' .fi-front{background-image:' + uri(art, g) + '}' +
           '.fi-root .fi-g' + i + ' .fi-back{background-image:' + uri(mir + '<path fill="' + bc + '" d="' + d + '"/></g>', g) + '}';
  }
  function strips(k, sw, bw, n) {
    return '<div class="fi-st" style="--fi-of:' + (-k * sw) + 'px;--fi-ob:' + (k * sw + sw + 2 - bw) + 'px">' +
      '<div class="fi-fc fi-front"></div><div class="fi-fc fi-back"></div>' + (k < n - 1 ? strips(k + 1, sw, bw, n) : '') + '</div>';
  }

  // ---------- CSS estático (prefijo fi- para no chocar con la app) ----------
  var CSS = [
    '.fi-root{position:fixed;inset:0;z-index:2147483000;overflow:hidden;contain:layout paint style;-webkit-tap-highlight-color:transparent}',
    '.fi-root.fi-in{position:absolute;z-index:1000}',
    '.fi-root,.fi-root *{box-sizing:border-box}',
    '.fi-slot{position:absolute;inset:0;z-index:5}',
    /* horizontal: el libro se abre en el centro, SOBRE la app */
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
    '@keyframes fi-zflip{0%,49.9%{z-index:calc(20 - var(--fi-i))}50%,100%{z-index:var(--fi-i)}}',
    '@keyframes fi-rise{from{opacity:0;transform:translateX(-40px)}}',
    '.fi-pg{position:absolute;inset:0;transform-origin:left center;transform-style:preserve-3d;will-change:transform;animation:fi-turn var(--fi-dur) cubic-bezier(.4,0,.25,1) var(--fi-d) forwards,fi-tilt var(--fi-dur) ease-in-out var(--fi-d) forwards}',
    '@keyframes fi-turn{to{rotate:0 1 0 -180deg}}',
    '@keyframes fi-tilt{50%{transform:rotateX(2deg)}}',
    /* --fi-bk = BASE_N / n: con menos tiras cada una dobla más, así la curvatura total se mantiene */
    '@keyframes fi-bend{0%{transform:rotateY(0deg)}35%{transform:rotateY(calc(5deg*var(--fi-bk,1)))}75%{transform:rotateY(calc(-1.2deg*var(--fi-bk,1)))}100%{transform:rotateY(0deg)}}',
    '.fi-st{position:absolute;top:0;left:0;width:calc(var(--fi-sw) + 2px);height:100%;transform-style:preserve-3d;transform-origin:left center}',
    '.fi-st .fi-st{left:var(--fi-sw);animation:fi-bend var(--fi-dur) ease-in-out var(--fi-d) forwards}',
    '.fi-fc{position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;overflow:hidden;background-repeat:no-repeat;background-size:var(--fi-bw) 100%}',
    '.fi-front{background-position:var(--fi-of) 0}',
    '.fi-back{transform:rotateY(180deg);visibility:hidden;animation:fi-bshow .001s linear var(--fi-d) forwards;background-position:var(--fi-ob) 0}',
    '@keyframes fi-bshow{to{visibility:visible}}',
    /* MIENTRAS LA APP CARGA: ninguna animación de apertura existe (ni siquiera en pausa).
       Al quitar fi-hold arrancan todas desde cero, con sus retardos. La portada (fi-p0) conserva
       su animación de entrada (fi-rise) y solo pausa la de giro. */
    '.fi-hold *:not(.fi-p0){animation:none!important}',
    '.fi-hold .fi-sl.fi-p0{animation-play-state:running,paused!important}',
    /* las caras traseras no se dibujan hasta que la app está lista (fi-warm se pone al llamar open()) */
    '.fi-hold:not(.fi-warm) .fi-back{display:none}'
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
  function appBg(el) {
    for (var e = el; e && e.nodeType === 1; e = e.parentElement) {
      var c = getComputedStyle(e).backgroundColor;
      if (c && c !== 'transparent' && !/rgba\(\s*\d+,\s*\d+,\s*\d+,\s*0\s*\)/.test(c)) return c;
    }
    return global.matchMedia && global.matchMedia('(prefers-color-scheme:dark)').matches ? '#000' : '#fff';
  }
  function hasApp(el) { return !!el && (el.childElementCount > 0 || (el.textContent || '').trim() !== ''); }

  // ---------- reproducción ----------
  // load()  -> folder cerrado, pestañas en bucle (salen 1..6, entran 6..1) mientras la app carga.
  // open()  -> la app está lista: las pestañas terminan de salir y el folder se abre.
  var cur = null;
  function stopAnims(c) {
    if (!c.anims) return;
    c.anims.forEach(function (a) { try { a.cancel(); } catch (e) {} });
    c.anims = [];
  }
  function cleanup(c) {
    c.alive = false; clearTimeout(c.timer); clearTimeout(c.fadeT);
    stopAnims(c);
    if (c.root.parentNode) c.root.parentNode.removeChild(c.root);
    if (c.styleEl && c.styleEl.parentNode) c.styleEl.parentNode.removeChild(c.styleEl);
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
  // x (0 = escondida detrás de la portada, 1 = afuera) -> estilo. Solo opacity + transform (compositor).
  function xStyle(x) { return { opacity: Math.min(1, x * 3), transform: x >= 1 ? 'translateX(0px)' : 'translateX(' + (-120 * (1 - x)) + 'px)' }; }
  function kf(x, offset) { var o = xStyle(x); o.easing = EASE; if (offset != null) o.offset = offset; return o; }
  function loopFrames(i) {
    var a = i * STG, b = IN_START + (5 - i) * STG;
    return [kf(0, 0), kf(0, a / P), kf(1, (a + M) / P), kf(1, b / P), kf(0, (b + M) / P), kf(0, 1)];
  }
  function setX(el, x) {
    var o = xStyle(x);
    el.style.opacity = String(o.opacity);
    el.style.transform = x >= 1 ? 'none' : o.transform;
  }
  function hex(c, i) { return /^#[0-9a-f]{6}$/i.test(c || '') ? c.toLowerCase() : COLORS[i]; }

  function load(opts) {
    opts = opts || {};
    cancel(); inject();
    var none = { state: 'none', open: function () { return Promise.resolve(false); }, abandon: function () {}, cancel: function () {} };
    if (global.matchMedia && global.matchMedia('(prefers-reduced-motion:reduce)').matches) return none;
    if (!(document.documentElement && document.documentElement.animate)) return none;   // sin Web Animations: queda el cargador de siempre
    var appEl = pick(opts.app);
    if (!hasApp(appEl)) return none;

    var pal = []; for (var q = 0; q < 6; q++) pal.push(hex(opts.colors && opts.colors[q], q));
    var t0 = .05, settle = typeof opts.settle === 'number' ? opts.settle : .12;
    var host = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    var root = document.createElement('div');
    root.className = 'fi-root fi-hold' + (host ? ' fi-in' : '');
    (host || document.body).appendChild(root);

    var pw = root.clientWidth, ph = root.clientHeight;
    var n = Math.max(3, Math.min(BASE_N, opts.strips || (Math.min(pw, ph) < 600 ? 5 : 6)));
    root.style.setProperty('--fi-bk', String(BASE_N / n));
    var wide = pw / ph > WIDE, g, sw, bw, open = '', close = '', end, bgDiv = '';
    if (wide) {
      sw = Math.round(ph * .8 * W / 1632 / n); bw = sw * n;
      var bh = Math.round(bw * 1632 / W), bl = Math.round((pw - bw) / 2), bt = Math.round((ph - bh) / 2), ot = t0 + 6 * ST + DUR * .5;
      g = geo(1632);
      open = '<div class="fi-bk" style="left:' + bl + 'px;top:' + bt + 'px;width:' + bw + 'px;height:' + bh + 'px;--fi-pp:' + Math.max(1500, bw * 3.75) + 'px;--fi-t0:' + t0 + 's">'; close = '</div>';
      root.style.setProperty('--fi-ot', ot + 's');
      root.style.setProperty('--fi-bg', appBg(appEl));
      root.classList.add('fi-wide'); bgDiv = '<div class="fi-bg"></div>';
      end = ot + .45;
    } else {
      g = geo(W * ph / pw); sw = Math.ceil(pw / n); bw = pw; end = t0 + 6 * ST + DUR + .2;
      root.style.setProperty('--fi-bg', appBg(appEl)); root.style.setProperty('--fi-ot', t0 + 's'); bgDiv = '<div class="fi-bg fi-bgn"></div>';
    }

    // imágenes de página: una hoja de estilos con 14 reglas, compartida por todas las tiras
    var css = '';
    for (var p = 0; p < 7; p++) css += pageCss(g, p, pal);
    var styleEl = document.createElement('style'); styleEl.textContent = css;
    (document.head || document.documentElement).appendChild(styleEl);

    var h = open + '<div class="fi-bd" style="--fi-bdt:' + (t0 + 5 * ST + .15) + 's;border-radius:' + (RC / W * bw) + 'px"></div>';
    for (var i = 0; i < 7; i++) {
      h += '<div class="fi-sl fi-g' + i + ' ' + (i ? 'fi-pn' : 'fi-p0') + '" style="--fi-i:' + i + ';--fi-d:' + (t0 + i * ST) + 's;--fi-sw:' + sw + 'px;--fi-dur:' + DUR + 's;--fi-bw:' + bw + 'px' + (i ? ';opacity:0;transform:translateX(-120px)' : '') + '">' +
           '<div class="fi-pg">' + strips(0, sw, bw, n) + '</div></div>';
    }
    root.innerHTML = bgDiv + '<div class="fi-slot"' + (wide ? '' : ' style="--fi-pp:' + Math.max(1500, pw * 3.75) + 'px"') + '>' + h + close + '</div>';

    var tabs = [].slice.call(root.querySelectorAll('.fi-sl.fi-pn'));
    var c = { root: root, styleEl: styleEl, state: 'loading', alive: true, resolve: null, timer: 0, fadeT: 0, anims: [], released: false };
    cur = c;
    var opened = null;

    // bucle de pestañas en el compositor (transform + opacity): no depende del hilo principal
    c.anims = tabs.map(function (el, i) {
      return el.animate(loopFrames(i), { duration: P * 1000, iterations: Infinity, delay: LEAD * 1000, fill: 'backwards' });
    });

    function release() {   // pestañas ya afuera: suelta las animaciones de apertura (giro de hojas)
      if (c.released || !c.alive) return;
      c.released = true;
      tabs.forEach(function (el) { setX(el, 1); });
      stopAnims(c);
      c.timer = setTimeout(function () {
        root.classList.remove('fi-hold');
        c.timer = setTimeout(function () {
          if (cur === c) cur = null; cleanup(c); c.state = 'done';
          if (opts.onEnd) opts.onEnd(); if (opened) opened(true);
        }, end * 1000);
      }, settle * 1000);
    }

    if (opts.maxWait) c.fadeT = setTimeout(function () { ctl.abandon(); }, opts.maxWait);
    if (opts.onStart) opts.onStart();

    var ctl = {
      get state() { return c.state; },
      // La app ya está lista: termina de sacar las pestañas y abre. true = terminó completa, false = se saltó/canceló.
      open: function () {
        if (c.state !== 'loading') return Promise.resolve(false);
        c.state = 'opening'; clearTimeout(c.fadeT);
        root.classList.add('fi-warm');   // empieza a preparar las caras traseras mientras las pestañas salen
        return new Promise(function (resolve) {
          opened = resolve; c.resolve = resolve;
          var ct = c.anims[0] && c.anims[0].currentTime;
          var t = (typeof ct === 'number' ? ct / 1000 : 0) - LEAD;
          var cc = t < 0 ? 0 : t - Math.floor(t / P) * P;
          var old = c.anims, run = [], i, a, e, D, fr, an;
          c.anims = [];
          function go(el, frames, ms) {
            an = el.animate(frames, { duration: ms, fill: 'both' });
            c.anims.push(an); run.push(an.finished);
          }
          if (cc >= OUT_END && cc < IN_START) {
            // ya están todas afuera: abre ya
          } else if (cc >= IN_START) {
            // estaban entrando: vuelven a salir desde donde van
            for (i = 0; i < 6; i++) go(tabs[i], [kf(xLoop(i, cc), 0), kf(1, 1)], 240);
          } else {
            // aún saliendo: cada pestaña termina de salir con el mismo ritmo escalonado
            for (i = 0; i < 6; i++) {
              a = i * STG; e = a + M;
              if (cc >= e) continue;
              D = (e - cc) * 1000;
              fr = [kf(xLoop(i, cc), 0)];
              if (cc < a) fr.push(kf(0, (a - cc) * 1000 / D));
              fr.push(kf(1, 1));
              go(tabs[i], fr, D);
            }
          }
          old.forEach(function (x) { try { x.cancel(); } catch (err) {} });   // las nuevas ya tapan el estado de las viejas
          if (!run.length) release();
          else Promise.all(run).then(release, function () {});
        });
      },
      // Se retira con un fundido corto SIN abrir: queda lo que haya debajo.
      abandon: function () {
        if (c.state === 'done' || c.state === 'cancelled' || c.state === 'abandoned') return;
        c.state = 'abandoned'; clearTimeout(c.fadeT); clearTimeout(c.timer); stopAnims(c);
        if (opts.onAbandon) { try { opts.onAbandon(); } catch (e) {} }
        root.style.pointerEvents = 'none'; root.style.transition = 'opacity .3s ease'; root.style.opacity = '0';
        if (cur === c) cur = null;
        var res = c.resolve; c.timer = setTimeout(function () { cleanup(c); if (res) res(false); }, 340);
      },
      cancel: function () { if (cur === c) cancel(); }
    };
    return ctl;
  }

  function play(opts) { var l = load(opts); return l.open(); }

  function clearFallback() {}   // compatibilidad

  global.FolderIntro = { load: load, play: play, cancel: cancel, clearFallback: clearFallback };
})(typeof window !== 'undefined' ? window : this);
