/* =========================================================================
   TIEMPO DE ESTUDIO — Competencias · estilos del rediseño (2026-09-21)
   -------------------------------------------------------------------------
   Solo CSS, en un string. Se separó de tiempo-estudio-competencias-visual.js
   para respetar el límite de 800 líneas por archivo del proyecto. Lo
   inyecta asegurarEstilosCompetenciasVisual() (un único <style> con guard
   por id). Todo va prefijado (.cp-, --cp-, @keyframes cp-) y las variables
   viven en .cp-scope / .cp-overlay, nunca en :root.
   Generado a partir de prototipo-competencias-v2.html.

   2026-09-22 — FIX pedido por el dueño del proyecto: la rayita superior del
   pedestal (inset box-shadow) quedaba SIEMPRE oro/plata/bronce fijo aunque
   el pedestal ya estuviera teñido con el color propio de la persona
   (.cp-tinted) — se veía como una franja pegada que no combinaba con el
   color de cada uno. Ahora esa línea usa `--cp-uc-d` (el tono oscuro ya
   calculado por `tonosDeColor()` en el JS, el mismo que pinta la base del
   degradé del pedestal), así queda un poco más oscura que el cuerpo del
   pedestal — le da el "borde con textura" en vez de una franja de otro
   color pegada arriba. Sin color propio (.cp-tinted ausente) no cambia
   nada: se sigue usando oro/plata/bronce de siempre.
   ========================================================================= */

const CSS_COMPETENCIAS_VISUAL = `
  /* Paleta propia (oscura, como el prototipo). Vive en .cp-scope/.cp-overlay,
     nunca en :root: no pisa ningún token de la app. */
  .cp-scope, .cp-overlay {
    color-scheme: dark;
    --cp-bg:#0a0920; --cp-card:#1a1846; --cp-line:rgba(255,255,255,.09);
    --cp-text:#f3f2ff; --cp-muted:#9b98c8; --cp-accent:#6c5cf0; --cp-accent2:#a99cff;
    --cp-gold:#f5b942; --cp-silver:#c9cde6; --cp-bronze:#d18a58;
    color: var(--cp-text);
  }
  .cp-scope *, .cp-overlay * { box-sizing: border-box; }
  .cp-scope p, .cp-scope h2, .cp-overlay p, .cp-overlay h2 { margin: 0; }
  .cp-scope button, .cp-overlay button { font: inherit; color: inherit; cursor: pointer; }
  .cp-scope button:focus-visible, .cp-overlay button:focus-visible { outline: 2px solid var(--cp-accent2); outline-offset: 2px; }
  .cp-av img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .cp-msg { font-size: 13px; color: var(--cp-muted); text-align: center; padding: 14px 6px; }
  .cp-nota { font-size: 11.5px; color: var(--cp-muted); text-align: center; padding-top: 10px; }
  .cp-opt { display:flex; align-items:center; gap:12px; width:100%; text-align:left; padding:12px 14px; border-radius:16px;
    border:1px solid var(--cp-line); background:rgba(255,255,255,.045); font-size:14px; font-weight:700; transition:background .2s, transform .1s; }
  .cp-opt:hover { background: rgba(255,255,255,.09); }
  .cp-opt:active { transform: scale(.985); }
  .cp-opt.cp-peligro:hover { background: rgba(239,68,68,.18); border-color: rgba(239,68,68,.5); }
  .cp-opt-emoji { font-size: 17px; line-height: 1; flex: none; }
  .cp-lk-fin { font-size: 12.5px; color: var(--cp-muted); }
/* ---------- tarjeta de competencia ---------- */
  .cp-comp{--cp-u:1.08;--cp-bgring:#221f5c;padding:16px 16px 18px;border-radius:22px;border:1px solid var(--cp-line);
    background:linear-gradient(180deg,rgba(40,37,104,.7),rgba(24,22,66,.85))}
  .cp-c-head{position:relative;display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding-bottom:18px;border-bottom:1px solid var(--cp-line);margin-bottom:18px}
  .cp-comp[data-layout="filas"] .cp-c-head{margin-bottom:28px}
  .cp-c-title{font-weight:800;font-size:15px;line-height:1.3;padding-top:2px}
  .cp-c-title svg{display:inline-block;width:16px;height:16px;vertical-align:-2px;margin-left:5px}
  .cp-c-sub{font-size:12px;color:var(--cp-muted);margin-top:3px}
  .cp-c-icons{display:flex;flex:none;margin:-6px -8px 0 0}
  .cp-ico{width:40px;height:40px;border:0;background:none;color:var(--cp-muted);display:grid;place-items:center;border-radius:12px;transition:color .2s,transform .15s}
  .cp-ico:hover{color:var(--cp-text)}
  .cp-ico:active{transform:scale(.9)}
  .cp-ico.cp-gold{color:var(--cp-gold)}
  .cp-ico svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}

  /* selector de vista, montado sobre la línea divisoria */
  .cp-vt{position:absolute;right:0;bottom:-15px;display:flex;gap:2px;padding:3px;border-radius:99px;background:#1f1c52;border:1px solid var(--cp-line)}
  .cp-vt button{width:30px;height:22px;border-radius:99px;border:0;background:none;color:var(--cp-muted);display:grid;place-items:center;transition:background .2s,color .2s}
  .cp-vt button[aria-pressed="true"]{background:var(--cp-accent);color:#fff}
  .cp-vt svg{width:13px;height:13px;stroke:currentColor;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}

  .cp-list{display:grid;gap:8px}
  .cp-comp .cp-list{margin-top:12px}
  .cp-comp[data-layout="filas"] .cp-list{margin-top:0}

  /* insignia de puesto: misma caja para todos, así todo alinea */
  .cp-rk{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;flex:none;
    font-size:12px;font-weight:800;font-variant-numeric:tabular-nums;line-height:1;
    color:var(--cp-muted);background:rgba(255,255,255,.07)}
  .cp-rk.cp-r1{background:linear-gradient(145deg,#ffe28f,#e8a524);color:#5a3a00;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3),0 4px 10px -3px rgba(245,185,66,.65)}
  .cp-rk.cp-r2{background:linear-gradient(145deg,#f4f5ff,#a7acd0);color:#2b2e50;box-shadow:inset 0 0 0 1px rgba(255,255,255,.35)}
  .cp-rk.cp-r3{background:linear-gradient(145deg,#f6c39a,#bb7340);color:#4a2400;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25)}

  /* avatares */
  .cp-avw{position:relative;flex:none}
  .cp-av{display:block;width:var(--cp-s,40px);height:var(--cp-s,40px);border-radius:50%;overflow:hidden;position:relative;background:#2a2765}
  .cp-av svg,.cp-av .cp-ini{width:100%;height:100%;display:grid;place-items:center}
  .cp-av .cp-ini{font-weight:800;font-size:calc(var(--cp-s,40px)*.42);color:#fff}
  .cp-crown{position:absolute;left:50%;top:-13px;width:24px;transform:translateX(-50%) rotate(-9deg);filter:drop-shadow(0 2px 4px rgba(245,185,66,.55));z-index:2}
  .cp-lead .cp-av{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 4px var(--cp-gold)}
  .cp-comp .cp-crown{animation:cp-bob 3s ease-in-out infinite}
  .cp-dot{position:absolute;right:-2px;bottom:-2px;width:14px;height:14px;border-radius:50%;background:linear-gradient(135deg,#a99cff,#6c5cf0);border:2.5px solid var(--cp-bgring);z-index:2}
  .cp-dot::after{content:"";position:absolute;inset:-5px;border-radius:50%;border:2px solid rgba(169,156,255,.7);animation:cp-ping 2s ease-out infinite}

  /* fila */
  .cp-row{display:grid;grid-template-columns:26px auto minmax(0,1fr) auto;align-items:center;gap:12px;
    padding:10px 12px;border-radius:16px;background:rgba(255,255,255,.04);position:relative}
  .cp-row.cp-lead{padding:16px 14px 14px;border:1px solid rgba(245,185,66,.28);
    background:linear-gradient(100deg,rgba(245,185,66,.17),rgba(245,185,66,.03) 65%)}
  .cp-who{min-width:0}
  .cp-name{font-weight:700;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cp-lead .cp-name{font-size:16px;font-weight:800}
  .cp-sub{height:16px;display:flex;align-items:center}
  .cp-bar{width:100%;height:4px;border-radius:99px;background:rgba(255,255,255,.08);overflow:hidden}
  .cp-bar i{display:block;height:100%;width:var(--cp-w);border-radius:inherit;background:linear-gradient(90deg,#5b4de0,#a99cff);transform-origin:left}
  .cp-lead .cp-bar i{background:linear-gradient(90deg,#e8a524,#ffe28f)}
  .cp-time{font-weight:800;font-size:14px;font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
  .cp-lead .cp-time{color:var(--cp-gold);font-size:15px}
  .cp-zero .cp-time{color:var(--cp-muted);font-weight:700}

  /* Tu posición · Halo (por defecto) */
  .cp-me-halo.cp-row{background:linear-gradient(100deg,rgba(108,92,240,.32),rgba(108,92,240,.08));
    box-shadow:inset 0 0 0 1px rgba(169,156,255,.55),0 10px 26px -12px rgba(108,92,240,.9)}
  .cp-me-halo .cp-av{animation:cp-halo 2.6s ease-in-out infinite}
  /* Tu posición · Punto */
  .cp-me-punto.cp-row{background:linear-gradient(100deg,rgba(108,92,240,.2),rgba(255,255,255,.04) 70%)}
  .cp-me-punto.cp-row::before{content:"";position:absolute;left:0;top:14px;bottom:14px;width:3px;border-radius:0 3px 3px 0;background:linear-gradient(180deg,#a99cff,#6c5cf0)}

  /* ---------- podio (tarjeta y modal comparten diseño) ---------- */
  .cp-wk{--cp-u:1;--cp-bgring:#171540}
  .cp-wk.cp-hero{--cp-u:1.14}
  .cp-podium{position:relative;display:grid;grid-template-columns:1fr 1.2fr 1fr;align-items:end;gap:6px;padding:26px 4px 0}
  .cp-comp .cp-podium{padding-top:32px}
  .cp-pc{position:relative;display:flex;flex-direction:column;align-items:center;min-width:0;text-align:center}
  .cp-pc.cp-p1 .cp-glow{position:absolute;left:50%;bottom:0;width:130%;height:80%;transform:translateX(-50%);
    background:radial-gradient(closest-side,var(--cp-uc,var(--cp-gold)),transparent 72%);opacity:0;pointer-events:none;filter:blur(1px);z-index:0}
  .cp-pc.cp-p1 > *:not(.cp-glow){position:relative;z-index:1}
  .cp-pc .cp-pn{font-weight:800;font-size:13.5px;max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:9px}
  .cp-pc.cp-p1 .cp-pn{font-size:15px}
  .cp-pc .cp-pt{font-size:12px;font-weight:700;color:var(--cp-muted);font-variant-numeric:tabular-nums;margin:1px 0 9px;white-space:nowrap}
  .cp-pc.cp-p1 .cp-pt{color:var(--cp-gold);font-size:13px}
  .cp-pc .cp-av{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 4px var(--cp-ring)}
  .cp-p1{--cp-ring:var(--cp-gold)} .cp-p2{--cp-ring:var(--cp-silver)} .cp-p3{--cp-ring:var(--cp-bronze)}
  .cp-p1 .cp-av{--cp-s:calc(70px*var(--cp-u))} .cp-p2 .cp-av{--cp-s:calc(54px*var(--cp-u))} .cp-p3 .cp-av{--cp-s:calc(48px*var(--cp-u))}
  .cp-p1 .cp-crown{width:calc(28px*var(--cp-u));top:calc(-19px*var(--cp-u))}
  .cp-pc.cp-me-halo .cp-av{animation:cp-halo 2.6s ease-in-out infinite}
  .cp-ped{width:100%;display:grid;place-items:center;border-radius:14px 14px 0 0;position:relative;overflow:hidden;transform-origin:bottom}
  .cp-ped b{font-size:calc(28px*var(--cp-u));font-weight:800;line-height:1;font-variant-numeric:tabular-nums;color:rgba(50,30,0,.5);text-shadow:0 1px 0 rgba(255,255,255,.4)}
  .cp-ped::after{content:"";position:absolute;inset:0;background:linear-gradient(105deg,rgba(255,255,255,0) 30%,rgba(255,255,255,.28) 48%,rgba(255,255,255,0) 66%);transform:translateX(-120%)}
  .cp-p1 .cp-ped{height:calc(96px*var(--cp-u));background:linear-gradient(180deg,#ffe28f,#eaaa2a 55%,#b9781a);box-shadow:inset 0 2px 0 rgba(255,255,255,.55)}
  .cp-p2 .cp-ped{height:calc(68px*var(--cp-u));background:linear-gradient(180deg,#f6f7ff,#b6bbdc 60%,#868bb0);box-shadow:inset 0 2px 0 rgba(255,255,255,.6)}
  .cp-p2 .cp-ped b{color:rgba(30,32,64,.45)}
  .cp-p3 .cp-ped{height:calc(48px*var(--cp-u));background:linear-gradient(180deg,#f7c9a2,#c8804a 60%,#93572c);box-shadow:inset 0 2px 0 rgba(255,255,255,.45)}
  .cp-p3 .cp-ped b{color:rgba(60,25,0,.5);font-size:calc(24px*var(--cp-u))}
  .cp-pc.cp-empty{visibility:hidden}

  /* chispas */
  .cp-sp{position:absolute;width:9px;height:9px;background:#ffe28f;clip-path:polygon(50% 0,62% 38%,100% 50%,62% 62%,50% 100%,38% 62%,0 50%,38% 38%);opacity:0}
  .cp-comp .cp-sp{animation:cp-twinkle 2.8s ease-in-out infinite;animation-delay:calc(var(--cp-d,0s) + var(--cp-ds,0s))}
  .cp-wk.cp-hero.cp-open .cp-sp{animation:cp-twinkle 2.8s ease-in-out infinite;animation-delay:calc(var(--cp-d,0s) + var(--cp-ds,0s))}
  .cp-wk:not(.cp-hero) .cp-sp{display:none}

  /* ---------- ANIMACIÓN DE ENTRADA DE LA TARJETA ---------- */
  .cp-comp.cp-anim .cp-c-head{animation:cp-fadeUp .5s ease both}
  .cp-comp.cp-anim .cp-row{animation:cp-rowIn .55s cubic-bezier(.2,.9,.3,1.1) var(--cp-d,0s) both}
  .cp-comp.cp-anim .cp-bar i{animation:cp-grow .9s cubic-bezier(.2,.8,.2,1) var(--cp-bd,0s) both}
  .cp-comp.cp-anim .cp-row.cp-lead .cp-avw{animation:cp-hop .9s cubic-bezier(.3,.7,.4,1) calc(var(--cp-d,0s) + .4s) both}
  .cp-comp.cp-anim .cp-row.cp-lead .cp-crown,.cp-comp.cp-anim .cp-p1 .cp-crown{animation:cp-crownDrop .6s cubic-bezier(.3,1.4,.5,1) var(--cp-dc,0s) both,cp-bob 3s ease-in-out calc(var(--cp-dc,0s) + .8s) infinite}
  .cp-comp.cp-anim .cp-ped{animation:cp-rise .6s cubic-bezier(.2,.9,.25,1.08) var(--cp-dp,0s) both}
  .cp-comp.cp-anim .cp-p1 .cp-ped{animation-duration:.75s}
  .cp-comp.cp-anim .cp-ped::after{animation:none}
  .cp-comp.cp-anim .cp-p1 .cp-ped::after{animation:cp-sheen 1.3s ease-out calc(var(--cp-dp,0s) + .8s) both}
  .cp-comp.cp-anim .cp-p2 .cp-avw,.cp-comp.cp-anim .cp-p3 .cp-avw{animation:cp-jump .85s cubic-bezier(.3,.7,.4,1) var(--cp-dj,0s) both}
  .cp-comp.cp-anim .cp-p1 .cp-avw{animation:cp-jumpKing 1.25s cubic-bezier(.3,.6,.4,1) var(--cp-dj,0s) both}
  .cp-comp.cp-anim .cp-pc .cp-pn,.cp-comp.cp-anim .cp-pc .cp-pt{animation:cp-fadeUp .4s ease var(--cp-dn,0s) both}
  .cp-comp.cp-anim .cp-pc.cp-p1 .cp-glow{animation:cp-glowIn 1s ease var(--cp-dg,0s) both}
  .cp-comp.cp-anim .cp-podium.cp-card{animation:cp-thud .35s ease var(--cp-k1,0s),cp-thud .4s ease var(--cp-k2,0s)}

  /* ---------- aviso de resultado ---------- */
  .cp-res-wrap{display:grid;grid-template-rows:1fr;margin-bottom:14px;transition:grid-template-rows .45s cubic-bezier(.3,.8,.2,1),margin .45s,opacity .3s}
  .cp-res-wrap.cp-gone{grid-template-rows:0fr;margin-bottom:0;opacity:0}
  .cp-res-clip{min-height:0;overflow:hidden}
  .cp-res{--cp-t:169,156,255;--cp-tx:#cfcdf0;position:relative;border-radius:22px;overflow:hidden;
    border:1px solid rgba(var(--cp-t),.4);
    background:radial-gradient(120% 170% at 0% 0%,rgba(var(--cp-t),.3),rgba(var(--cp-t),.05) 58%),linear-gradient(180deg,#201d54,#171542);
    box-shadow:inset 0 1px 0 rgba(255,255,255,.08);
    animation:cp-resIn .8s cubic-bezier(.2,.9,.3,1.1) both}
  .cp-res-1{--cp-t:245,185,66} .cp-res-2{--cp-t:201,205,230} .cp-res-3{--cp-t:209,138,88} .cp-res-4{--cp-t:169,156,255}
  .cp-res::after{content:"";position:absolute;inset:0;pointer-events:none;
    background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.17) 50%,transparent 65%);
    transform:translateX(-120%);animation:cp-sheen 1.3s ease-out .7s both}
  .cp-res-main{appearance:none;border:0;background:none;text-align:left;width:100%;display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:16px;
    padding:16px 16px 16px 16px;position:relative;z-index:1}
  .cp-res-av{position:relative;flex:none}
  .cp-res-av .cp-av{box-shadow:0 0 0 2px #1a1848,0 0 0 4px rgb(var(--cp-t))}
  .cp-res-av .cp-rk{position:absolute;right:-9px;bottom:-7px;box-shadow:0 0 0 3px #1a1848;animation:cp-pop .55s cubic-bezier(.3,1.7,.5,1) .55s both}
  .cp-res-av .cp-crown{top:-15px;width:26px}
  .cp-res-week{font-size:11.5px;font-weight:600;color:var(--cp-muted)}
  .cp-res-title{font-size:17px;font-weight:800;letter-spacing:-.01em;margin-top:1px;line-height:1.2}
  .cp-res-1 .cp-res-title{background:linear-gradient(90deg,#fff1bd,#f5b942);-webkit-background-clip:text;background-clip:text;color:transparent}
  .cp-res-sub{font-size:12.5px;color:var(--cp-tx);margin-top:3px;line-height:1.35}
  .cp-res-end{display:grid;justify-items:end;gap:3px;margin-top:14px}
  .cp-res-time{font-weight:800;font-size:15px;color:rgb(var(--cp-t));font-variant-numeric:tabular-nums;white-space:nowrap}
  .cp-res-cta{display:flex;align-items:center;font-size:12px;font-weight:700;color:var(--cp-muted);white-space:nowrap}
  .cp-res-cta svg{width:14px;height:14px;stroke:currentColor;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
  .cp-res-x{position:absolute;top:7px;right:7px;width:24px;height:24px;border-radius:50%;border:0;background:rgba(255,255,255,.08);color:var(--cp-muted);display:grid;place-items:center;z-index:2}
  .cp-res-x svg{width:11px;height:11px;stroke:currentColor;fill:none;stroke-width:2.6;stroke-linecap:round}
  .cp-res .cp-sp{background:rgb(var(--cp-t));animation:cp-twinkle 2.6s ease-in-out infinite;animation-delay:var(--cp-d)}
  .cp-cf{position:absolute;left:44px;top:46px;width:7px;height:11px;border-radius:2px;background:var(--cp-c);opacity:0;z-index:0;
    animation:cp-confetti 1.5s cubic-bezier(.15,.7,.3,1) var(--cp-dl) both}

  /* ---------- modal ---------- */
  .cp-overlay{position:fixed;inset:0;z-index:290;display:grid;place-items:center;
    padding:calc(16px + env(safe-area-inset-top,0px)) 14px calc(16px + env(safe-area-inset-bottom,0px));
    background:rgba(4,3,16,.7);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);
    opacity:0;transition:opacity .25s}
  .cp-overlay[hidden]{display:none}
  .cp-overlay.cp-show{opacity:1}
  .cp-sheet{width:min(100%,440px);max-height:min(88vh,760px);display:flex;flex-direction:column;border-radius:26px;overflow:hidden;
    border:1px solid var(--cp-line);background:linear-gradient(180deg,#1d1b4e,#100e2e);
    box-shadow:0 30px 80px -20px rgba(0,0,0,.8);transform:translateY(14px) scale(.98);transition:transform .35s cubic-bezier(.2,.9,.3,1)}
  .cp-overlay.cp-show .cp-sheet{transform:none}
  .cp-sh-head{display:flex;align-items:center;gap:12px;padding:18px 18px 12px}
  .cp-tchip{width:40px;height:40px;border-radius:13px;display:grid;place-items:center;flex:none;
    background:linear-gradient(145deg,rgba(245,185,66,.3),rgba(245,185,66,.08));box-shadow:inset 0 0 0 1px rgba(245,185,66,.35)}
  .cp-tchip svg{width:20px;height:20px;fill:none;stroke:var(--cp-gold);stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .cp-tchip.cp-acc{background:linear-gradient(145deg,rgba(108,92,240,.4),rgba(108,92,240,.1));box-shadow:inset 0 0 0 1px rgba(169,156,255,.4)}
  .cp-tchip.cp-acc svg{stroke:var(--cp-accent2)}
  .cp-sh-head h2{font-size:19px;font-weight:800;letter-spacing:-.01em}
  .cp-sh-head p{font-size:12.5px;color:var(--cp-muted);margin-top:2px}
  .cp-sh-head > div:nth-child(2){flex:1;min-width:0}
  .cp-x{width:34px;height:34px;border-radius:50%;border:1px solid var(--cp-line);background:rgba(255,255,255,.06);display:grid;place-items:center;flex:none}
  .cp-x svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.4;stroke-linecap:round;fill:none}
  .cp-sh-body{overflow-y:auto;overflow-x:hidden;padding:4px 14px 18px;display:grid;grid-template-columns:minmax(0,1fr);gap:8px;align-content:start;overscroll-behavior:contain}
  .cp-grp{font-size:12px;font-weight:700;color:var(--cp-muted);padding:10px 6px 2px}
  .cp-grp:first-child{padding-top:2px}

  /* tarjetita de semana */
  .cp-wk{border-radius:18px;background:rgba(255,255,255,.045);border:1px solid var(--cp-line);overflow:hidden;transition:background .25s,border-color .25s}
  .cp-wk.cp-open{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.14)}
  .cp-wk-head{width:100%;border:0;background:none;text-align:left;padding:12px 14px;
    display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px}
  .cp-w-who{display:flex;align-items:center;gap:9px;min-width:0}
  .cp-w-who .cp-name{font-size:14px}
  .cp-w-time{font-weight:800;font-size:14px;color:var(--cp-gold);font-variant-numeric:tabular-nums;text-align:center;white-space:nowrap}
  .cp-w-date{justify-self:end;display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:600;color:var(--cp-muted);white-space:nowrap}
  .cp-w-date svg{width:14px;height:14px;stroke:currentColor;stroke-width:2.4;fill:none;stroke-linecap:round;stroke-linejoin:round;transition:transform .3s}
  .cp-wk.cp-open .cp-w-date svg{transform:rotate(180deg)}
  .cp-wk-body{display:grid;grid-template-rows:0fr;transition:grid-template-rows .45s cubic-bezier(.3,.8,.2,1)}
  .cp-wk.cp-open .cp-wk-body{grid-template-rows:1fr}
  .cp-wk-inner{overflow:hidden;min-height:0}
  .cp-wk-pad{padding:2px 12px 14px}

  /* entrada del podio del historial: se repite cada vez que se abre */
  .cp-wk.cp-open .cp-ped{animation:cp-rise .7s cubic-bezier(.2,.9,.25,1.08) var(--cp-dp,0s) both}
  .cp-wk.cp-open .cp-p1 .cp-ped{animation-duration:.8s}
  .cp-wk.cp-open .cp-p1 .cp-ped::after{animation:cp-sheen 1.4s ease-out 1s both}
  .cp-wk.cp-open .cp-pc .cp-avw,.cp-wk.cp-open .cp-pc .cp-pn,.cp-wk.cp-open .cp-pc .cp-pt{animation:cp-drop .55s cubic-bezier(.2,.9,.3,1.2) var(--cp-dj,0s) both}
  .cp-wk.cp-open .cp-p1 .cp-crown{animation:cp-bob 3s ease-in-out 1.4s infinite}
  .cp-wk.cp-hero.cp-open .cp-pc.cp-p1 .cp-glow{animation:cp-glowIn 1s ease var(--cp-dg,0s) both}
  .cp-wk:not(.cp-hero) .cp-glow{display:none}

  .cp-rest{display:grid;gap:6px;margin-top:12px;padding-top:12px;border-top:1px solid var(--cp-line)}
  .cp-rrow{display:grid;grid-template-columns:26px auto minmax(0,1fr) auto;align-items:center;gap:11px;padding:2px 4px}
  .cp-rrow .cp-name{font-size:13.5px}
  .cp-rrow .cp-time{font-size:13px;color:var(--cp-muted)}

  /* Gestionar */
  .cp-lk{min-width:0;border-radius:18px;padding:14px;border:1px solid rgba(169,156,255,.35);background:linear-gradient(135deg,rgba(108,92,240,.25),rgba(108,92,240,.06))}
  .cp-lk-top{display:flex;gap:12px;align-items:center;min-width:0}
  .cp-lk-ic{width:38px;height:38px;border-radius:12px;background:rgba(169,156,255,.18);display:grid;place-items:center;flex:none}
  .cp-lk-ic svg{width:18px;height:18px;stroke:var(--cp-accent2);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
  .cp-lk-t{font-weight:800;font-size:14.5px}
  .cp-lk-s{font-size:12px;color:var(--cp-muted);margin-top:1px}
  .cp-lk-row{display:flex;align-items:center;gap:8px;margin-top:12px;padding:6px 6px 6px 12px;border-radius:12px;background:rgba(0,0,0,.28);min-width:0}
  .cp-lk-row code{flex:1;min-width:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:#dcd8ff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cp-lk-copy{border:0;height:32px;padding:0 14px;border-radius:9px;font-weight:800;font-size:12.5px;background:linear-gradient(135deg,#5b4de0,#8f83ff);color:#fff;min-width:84px;flex:none}
  .cp-ghost-box{margin-top:6px;padding:16px;border-radius:16px;border:1px dashed rgba(255,255,255,.16);font-size:12.5px;color:var(--cp-muted);text-align:center;line-height:1.5}

  /* ---------- keyframes ---------- */
  @keyframes cp-halo{0%,100%{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 4px var(--cp-accent2),0 0 8px rgba(169,156,255,.35)}50%{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 4px var(--cp-accent2),0 0 22px rgba(169,156,255,.85)}}
  @keyframes cp-ping{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}
  @keyframes cp-grow{from{transform:scaleX(0)}to{transform:scaleX(1)}}
  @keyframes cp-fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
  @keyframes cp-rowIn{from{opacity:0;transform:translateY(26px) scale(.97)}to{opacity:1;transform:none}}
  @keyframes cp-rise{from{transform:scaleY(0);opacity:.3}to{transform:scaleY(1);opacity:1}}
  @keyframes cp-drop{from{opacity:0;transform:translateY(-16px) scale(.9)}to{opacity:1;transform:none}}
  @keyframes cp-sheen{from{transform:translateX(-120%)}to{transform:translateX(120%)}}
  @keyframes cp-twinkle{0%,100%{opacity:0;transform:scale(.4) rotate(0)}45%{opacity:1;transform:scale(1) rotate(45deg)}70%{opacity:0;transform:scale(.5) rotate(90deg)}}
  @keyframes cp-bob{0%,100%{transform:translateX(-50%) rotate(-9deg)}50%{transform:translateX(-50%) translateY(-3px) rotate(-5deg)}}
  @keyframes cp-jump{
    0%{opacity:0;transform:translateY(64px) scale(.55)}
    8%{opacity:1}
    38%{opacity:1;transform:translateY(-30px) scale(1.06)}
    58%{transform:translateY(0) scale(1.07,.9)}
    74%{transform:translateY(-7px) scale(1)}
    88%{transform:translateY(0) scale(1.02,.98)}
    100%{opacity:1;transform:none}
  }
  @keyframes cp-jumpKing{
    0%{opacity:0;transform:translateY(96px) scale(.5)}
    7%{opacity:1}
    30%{transform:translateY(-74px) scale(1.14) rotate(-5deg)}
    46%{transform:translateY(0) scale(1.12,.86)}
    60%{transform:translateY(-28px) scale(1.05) rotate(4deg)}
    74%{transform:translateY(0) scale(1.08,.92)}
    86%{transform:translateY(-6px) scale(1)}
    100%{opacity:1;transform:none}
  }
  @keyframes cp-hop{0%{transform:none}30%{transform:translateY(-16px) scale(1.07)}55%{transform:translateY(0) scale(1.06,.92)}75%{transform:translateY(-5px)}100%{transform:none}}
  @keyframes cp-crownDrop{
    0%{opacity:0;transform:translateX(-50%) translateY(-38px) rotate(-40deg) scale(.7)}
    60%{opacity:1;transform:translateX(-50%) translateY(3px) rotate(-6deg) scale(1.12)}
    100%{opacity:1;transform:translateX(-50%) rotate(-9deg)}
  }
  @keyframes cp-glowIn{from{opacity:0}to{opacity:.4}}
  @keyframes cp-thud{0%,100%{transform:none}25%{transform:translateY(3px)}55%{transform:translateY(-1px)}}
  @keyframes cp-resIn{from{opacity:0;transform:translateY(-16px) scale(.95)}to{opacity:1;transform:none}}
  @keyframes cp-pop{from{opacity:0;transform:scale(0) rotate(-40deg)}to{opacity:1;transform:none}}
  @keyframes cp-confetti{
    0%{opacity:0;transform:translate(0,0) rotate(0) scale(.5)}
    12%{opacity:1}
    70%{opacity:1}
    100%{opacity:0;transform:translate(var(--cp-x),var(--cp-y)) rotate(var(--cp-r)) scale(1)}
  }

  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation:none !important;transition:none !important}
    .cp-sp,.cp-cf,.cp-glow{display:none}
  }


  /* ---- Color propio de cada persona (2.ª ronda, 2026-09-21) ----
     Las variables --cp-uc* las pone el JS inline (ver varsDeColor). Sin
     color (dispositivo viejo) no hay clase .cp-tinted y todo se ve como
     antes: dorado/plata/bronce. En el podio el PEDESTAL toma el color de la
     persona; el borde superior (2026-09-22: antes fijo oro/plata/bronce,
     ver nota de cabecera) usa el tono OSCURO de esa misma persona
     (--cp-uc-d), un poco más oscuro que el cuerpo del pedestal, para dar
     textura sin meter un color ajeno. */
  .cp-pc.cp-tinted .cp-ped{background:linear-gradient(180deg,var(--cp-uc-l),var(--cp-uc) 55%,var(--cp-uc-d))}
  .cp-pc.cp-tinted .cp-ped{box-shadow:inset 0 3px 0 var(--cp-uc-d)}
  .cp-pc.cp-tinted .cp-ped b{color:var(--cp-uc-num);text-shadow:none}
  .cp-pc.cp-tinted .cp-av{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 4px var(--cp-uc)}
  .cp-row.cp-tinted .cp-av{box-shadow:0 0 0 2px var(--cp-bgring),0 0 0 3px var(--cp-uc)}
  .cp-row.cp-tinted .cp-bar i{background:linear-gradient(90deg,var(--cp-uc-d),var(--cp-uc-l))}

`;

export { CSS_COMPETENCIAS_VISUAL };
