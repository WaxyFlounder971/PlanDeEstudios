// Estilos propios de Notas (selector de vista, ajustes, barra de búsqueda).
// Se inyectan una sola vez; usan variables del tema con valores de respaldo.
const ID = "notas-estilos-extra";

const CSS = `
.notas-seccion{--nt-grad:var(--gradient-primary,var(--accent-gradient,linear-gradient(135deg,#f5a9d3,#b7a5f4)));--nt-borde:var(--border,rgba(255,255,255,.1));--nt-fondo:var(--surface-2,rgba(255,255,255,.05));--nt-muted:var(--text-muted,rgba(255,255,255,.62))}
.nt-panel,.nt-panel *{box-sizing:border-box}
.nt-panel{--nt-grad:var(--gradient-primary,var(--accent-gradient,linear-gradient(135deg,#f5a9d3,#b7a5f4)));--nt-borde:var(--border,rgba(255,255,255,.1));--nt-fondo:var(--surface-2,rgba(255,255,255,.06));--nt-muted:var(--text-muted,rgba(255,255,255,.62));width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 48px);overflow:auto;gap:14px}
.nt-titulo{margin:0 0 2px;font-size:1.5rem}
.nt-etiqueta{display:block;margin:0 0 6px;font-size:.78rem;font-weight:600;color:var(--nt-muted)}
.nt-seg{display:flex;flex-wrap:wrap;gap:4px;padding:4px;border-radius:16px;background:rgba(0,0,0,.28);border:1px solid var(--nt-borde)}
.nt-seg-op{flex:1 1 auto;min-height:38px;padding:8px 12px;border:0;border-radius:12px;background:transparent;color:inherit;font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;transition:background .2s,color .2s,box-shadow .2s}
.nt-seg-op:hover{background:rgba(255,255,255,.07)}
.nt-seg-op[aria-checked="true"]{background:var(--nt-grad);color:#1b1530;box-shadow:0 4px 14px rgba(0,0,0,.28)}
.nt-fila{position:relative;display:flex;align-items:center;justify-content:space-between;gap:16px;padding:4px 2px;cursor:pointer}
.nt-fila-txt{font-size:.92rem;font-weight:500}
.nt-switch-input{position:absolute;opacity:0;width:1px;height:1px}
.nt-switch{position:relative;flex:none;width:48px;height:28px;border-radius:999px;background:rgba(255,255,255,.14);transition:background .2s}
.nt-switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:50%;background:#fff;box-shadow:0 2px 6px rgba(0,0,0,.35);transition:transform .2s}
.nt-switch-input:checked+.nt-switch{background:var(--nt-grad)}
.nt-switch-input:checked+.nt-switch::after{transform:translateX(20px)}
.nt-switch-input:focus-visible+.nt-switch{outline:2px solid #fff;outline-offset:2px}
.nt-btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;min-height:46px;padding:10px 16px;border:1px solid var(--nt-borde);border-radius:16px;background:var(--nt-fondo);color:inherit;font:inherit;font-weight:700;cursor:pointer}
.nt-btn:hover{background:rgba(255,255,255,.1)}
.nt-badge{min-width:22px;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,.14);font-size:.78rem}
.nt-listo{width:100%;min-height:48px;border:0;border-radius:999px;background:var(--nt-grad);color:#1b1530;font:inherit;font-weight:800;cursor:pointer;box-shadow:0 8px 22px rgba(0,0,0,.3)}
.nt-oculto{display:none!important}
.nt-colores{display:flex;flex-wrap:wrap;gap:10px}
.notas-toolbar-vista{display:flex;align-items:center;gap:10px}
.notas-toolbar-vista .notas-busqueda{flex:1 1 auto;min-width:0;display:block!important;opacity:1!important;visibility:visible!important;height:auto!important;margin:0}
.nt-vista{flex:none;display:inline-flex;gap:2px;padding:4px;border-radius:14px;background:rgba(0,0,0,.28);border:1px solid var(--nt-borde,rgba(255,255,255,.1))}
.nt-vista-op{display:grid;place-items:center;width:40px;height:36px;padding:0;border:0;border-radius:10px;background:transparent;color:inherit;opacity:.75;cursor:pointer;transition:background .2s,opacity .2s}
.nt-vista-op:hover{opacity:1}
.nt-vista-op[aria-checked="true"]{opacity:1;background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530;box-shadow:0 3px 10px rgba(0,0,0,.3)}
.nt-vista-op svg{width:18px;height:18px;fill:currentColor}
.notas-grid.notas-lista{grid-template-columns:1fr!important}
.notas-filtro-colores{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

/* --- Editor: barra de herramientas centrada y agrupada --- */
.notas-editor .notas-toolbar{display:flex!important;flex-wrap:wrap;justify-content:center!important;align-items:center;gap:8px!important}
.notas-editor .notas-sep{flex:none;width:1px;align-self:stretch;min-height:26px;margin:0 10px;background:currentColor;opacity:.25}
.notas-editor .notas-toolbar button{display:inline-grid;place-items:center}
.nt-ico{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nt-ico-solido{fill:currentColor;stroke:none}
.nt-punto{display:block;width:9px;height:9px;border-radius:50%;background:currentColor}
.notas-toolbar [data-tool][aria-pressed="true"]{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530}
.nt-tinta-color{width:30px;height:30px;padding:0;border:2px solid rgba(255,255,255,.35);border-radius:50%;overflow:hidden;cursor:pointer;background:none;appearance:none;-webkit-appearance:none}
.nt-tinta-color::-webkit-color-swatch-wrapper{padding:0}
.nt-tinta-color::-webkit-color-swatch{border:0;border-radius:50%}
.nt-tinta-color::-moz-color-swatch{border:0;border-radius:50%}
.nt-tinta-color.nt-oculto{display:none!important}
.nt-tinta-canvas{position:absolute;z-index:5;pointer-events:none;touch-action:none;border-radius:12px}
.nt-tinta-canvas.activo{pointer-events:auto;cursor:crosshair}
.nt-tinta-canvas[data-modo="borrador"]{cursor:cell}
.nota-tinta-mini{display:block;width:100%;height:auto;margin-top:8px;pointer-events:none}
/* --- Paleta del editor: separar predefinidos y personalizados --- */
.notas-editor .notas-palette{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.notas-editor .notas-sep-color{height:24px;min-height:0;margin:0 6px;align-self:center}
/* --- Fechas bajo el título --- */
.nt-tiempos{display:flex;flex-wrap:wrap;align-items:center;gap:6px 16px;margin:-2px 2px 0;font-size:.8rem;color:var(--text-muted,rgba(255,255,255,.62))}
.nt-tiempos label{display:inline-flex;align-items:center;gap:6px}
.nt-tiempos input[type="datetime-local"]{padding:3px 8px;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:10px;background:rgba(0,0,0,.2);color:inherit;font:inherit;color-scheme:dark light}
/* --- Checkbox redondo con el estilo de la app --- */
.notas-cuerpo input[type="checkbox"],.nota-preview input[type="checkbox"]{appearance:none;-webkit-appearance:none;display:inline-grid;place-content:center;flex:none;width:20px;height:20px;margin:0 8px 0 0;border:2px solid currentColor;border-radius:50%;background:transparent;vertical-align:-4px;cursor:pointer;opacity:.85;transition:background .15s,border-color .15s}
.notas-cuerpo input[type="checkbox"]:checked,.nota-preview input[type="checkbox"]:checked{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));border-color:transparent;opacity:1}
.notas-cuerpo input[type="checkbox"]:checked::after,.nota-preview input[type="checkbox"]:checked::after{content:"";width:5px;height:10px;margin-top:-2px;border:solid #1b1530;border-width:0 2px 2px 0;transform:rotate(45deg)}
.notas-cuerpo li:has(>input[data-nota-check]),.nota-preview li:has(>input[data-nota-check]){list-style:none;margin-left:-1.3em}
/* --- Arrastrar notas fijadas --- */
.nota-drag-handle{touch-action:none;cursor:grab}
.nota-drag-handle svg{display:block;width:16px;height:16px;fill:currentColor}
.nota-arrastrando{position:relative;z-index:60;box-shadow:0 20px 44px rgba(0,0,0,.5)!important;opacity:.97;transition:none!important;cursor:grabbing}
body.nota-arrastrando-body{user-select:none;-webkit-user-select:none;cursor:grabbing}

/* ===== Editor: color de texto (izq.) y de tinta (der.) siempre visibles, barra centrada ===== */
.notas-editor .nt-barra-fila{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:8px}
.nt-swatch{position:relative;display:inline-grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;background:var(--sw,#172033);border:2px solid rgba(255,255,255,.4);box-shadow:0 2px 8px rgba(0,0,0,.3);overflow:hidden;cursor:pointer;transition:transform .15s}
.nt-swatch:hover{transform:scale(1.07)}
.nt-swatch:focus-within{outline:2px solid #fff;outline-offset:2px}
.nt-swatch-texto{justify-self:start}
.nt-swatch-tinta{justify-self:end}
.nt-swatch-ico{display:grid;place-items:center;pointer-events:none;color:var(--sw-fg,#fff);font-size:.95rem;line-height:1}
.nt-swatch-ico .nt-ico{width:15px;height:15px}
.nt-input-color{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}
@media(max-width:560px){.notas-editor .nt-barra-fila{grid-template-columns:auto 1fr auto}.notas-editor .nt-barra-fila .notas-toolbar{grid-column:1/-1;grid-row:2}}
.nt-pin.activo .nt-ico{fill:currentColor}

/* ===== Fechas con el estilo de la app ===== */
.nt-tiempos{justify-content:center}
.nt-fecha{position:relative;display:inline-flex}
.nt-fecha-btn{display:inline-flex;align-items:center;gap:8px;padding:5px 12px;border:1px solid var(--border,rgba(255,255,255,.14));border-radius:999px;background:rgba(0,0,0,.2);color:inherit;font:inherit;font-size:.8rem;cursor:pointer;transition:background .15s}
.nt-fecha-btn:hover{background:rgba(255,255,255,.09)}
.nt-fecha-etq{color:var(--text-muted,rgba(255,255,255,.62));font-weight:600}
.nt-fecha-val{font-weight:600;white-space:nowrap}
.nt-fecha-input{position:absolute;left:0;top:0;width:100%;height:100%;padding:0;border:0;opacity:0;pointer-events:none}
.notas-editor .nt-fecha-venc .nt-fecha-btn{min-height:36px;padding:6px 14px;font-size:.9rem}

/* ===== Vencimiento: menú propio ===== */
.nt-plazo{position:relative;display:inline-flex}
.nt-chip{display:inline-flex;align-items:center;gap:8px;min-height:36px;padding:6px 12px 6px 14px;border:1px solid var(--nt-borde,rgba(255,255,255,.14));border-radius:999px;background:var(--nt-fondo,rgba(255,255,255,.06));color:inherit;font:inherit;font-size:.9rem;font-weight:600;cursor:pointer}
.nt-chip:hover{background:rgba(255,255,255,.1)}
.nt-chip .nt-ico{width:14px;height:14px;transition:transform .15s}
.nt-chip[aria-expanded="true"] .nt-ico{transform:rotate(180deg)}
.nt-menu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:30;display:flex;flex-direction:column;gap:2px;min-width:200px;padding:6px;border-radius:16px;background:rgba(22,20,34,.98);border:1px solid rgba(255,255,255,.14);box-shadow:0 18px 40px rgba(0,0,0,.55)}
.nt-menu button{padding:9px 12px;border:0;border-radius:11px;background:transparent;color:#fff;font:inherit;font-size:.9rem;font-weight:600;text-align:left;cursor:pointer}
.nt-menu button:hover{background:rgba(255,255,255,.1)}
.nt-menu button[aria-selected="true"]{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530}

/* ===== Pie del editor: izquierda (Wapper, Compartir) y derecha (Duplicar, Eliminar) ===== */
.notas-editor .notas-editor-foot{display:flex;flex-direction:column;gap:12px}
.notas-editor .notas-editor-tools{display:flex;flex-wrap:wrap;align-items:center;gap:10px}
.notas-editor .notas-editor-actions{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;width:100%}
.notas-editor .notas-editor-share,.notas-editor .nt-acc-der{display:flex;flex-wrap:wrap;gap:8px}
.notas-editor .nt-acc-der{margin-left:auto}
.notas-editor .notas-editor-actions .btn{display:inline-flex;align-items:center;gap:8px}
.notas-editor .notas-editor-actions .nt-ico{width:17px;height:17px}

/* ===== Tarjetas: 6 botones en una fila ===== */
.nota-card .nota-card-top-solo{justify-content:flex-end}
.nota-card .nota-card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.nota-card .nota-card-actions{display:flex;flex:1 1 100%;align-items:center;justify-content:space-between;gap:2px;width:100%;margin:0}
.nota-card .nota-icon-action{display:inline-grid;place-items:center;min-width:32px;height:32px;padding:0}
.nota-card .nota-icon-action .nt-ico{width:17px;height:17px}
.nota-card .nota-icon-action.activo .nt-ico{fill:currentColor}
.nt-vsep{flex:none;width:1px;height:18px;background:currentColor;opacity:.25;margin:0 2px}
.nota-card.nota-flotando{opacity:.62}
.nota-card.nota-flotando .nota-card-foot .nt-chip-flot{display:inline-flex}
.nt-chip-flot{display:none;align-items:center;gap:5px;padding:2px 9px;border-radius:999px;font-size:.74rem;font-weight:700;background:rgba(0,0,0,.14)}
.nt-chip-flot .nt-ico{width:12px;height:12px}

/* ===== Menú contextual con iconos ===== */
.notas-menu-contextual .notas-menu-item{display:flex;align-items:center;gap:10px;width:100%}
.notas-menu-contextual .nt-mi-ico{display:inline-grid;place-items:center;flex:none;width:20px}
.notas-menu-contextual .nt-mi-ico .nt-ico{width:17px;height:17px}

/* ===== Sticky: la nota se levanta al tocarla ===== */
.nt-sticky-overlay{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;padding:20px;background:rgba(5,4,12,.5);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)}
.nt-sticky{position:relative;display:flex;flex-direction:column;gap:10px;width:min(420px,100%);max-height:min(80vh,680px);padding:14px 20px 20px;border-radius:10px;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(0,0,0,.05)),var(--nt-nota,#fff594);box-shadow:0 30px 64px rgba(0,0,0,.55),0 4px 12px rgba(0,0,0,.3);transform:rotate(-1.2deg)}
.nt-sticky-barra{display:flex;align-items:center;justify-content:flex-end;gap:6px}
.nt-sticky-btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;min-height:34px;padding:0 12px;border:0;border-radius:999px;background:rgba(0,0,0,.13);color:inherit;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer;transition:background .15s}
.nt-sticky-btn:hover{background:rgba(0,0,0,.24)}
.nt-sticky-btn .nt-ico{width:16px;height:16px}
.nt-sticky-icono{width:34px;padding:0}
.nt-sticky-cuerpo{display:flex;flex-direction:column;gap:8px;min-height:0;overflow:auto;overflow-wrap:anywhere}
.nt-sticky-titulo{font-size:1.18rem;line-height:1.25}
.nt-sticky .nota-preview,.nt-flotante .nota-preview{display:block;max-height:none;overflow:visible;-webkit-line-clamp:unset;line-clamp:unset}
.nt-sticky-vence{align-self:flex-start;padding:2px 10px;border-radius:999px;font-size:.78rem;font-weight:700;background:rgba(0,0,0,.14)}
.nt-sticky .nota-tinta-mini,.nt-flotante .nota-tinta-mini{margin-top:4px}

/* ===== Notas flotantes ===== */
.nt-flotante{position:fixed;left:0;top:0;z-index:700;display:flex;flex-direction:column;gap:6px;width:236px;max-height:min(55vh,420px);padding:6px 12px 12px;border-radius:8px;background:linear-gradient(180deg,rgba(255,255,255,.16),rgba(0,0,0,.05)),var(--nt-nota,#fff594);box-shadow:0 14px 30px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3);transform-origin:50% 0;will-change:transform;touch-action:none;user-select:none;-webkit-user-select:none;cursor:grab;overflow:hidden}
.nt-flotante.arrastrando{cursor:grabbing;box-shadow:0 28px 54px rgba(0,0,0,.55),0 4px 10px rgba(0,0,0,.3)}
.nt-flot-barra{display:flex;align-items:center;gap:2px}
.nt-flot-asa{display:grid;margin-right:auto;opacity:.4}
.nt-flot-asa .nt-ico{width:14px;height:14px}
.nt-flotante .nt-flot-btn{display:inline-grid;place-items:center;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:transparent;color:inherit;opacity:.7;cursor:pointer}
.nt-flotante .nt-flot-btn:hover{opacity:1;background:rgba(0,0,0,.14)}
.nt-flotante .nt-flot-btn .nt-ico{width:16px;height:16px}
.nt-flot-titulo{font-size:1rem;line-height:1.25;overflow-wrap:anywhere}
.nt-flot-cuerpo{min-height:0;overflow:auto;scrollbar-width:none;font-size:.92rem;overflow-wrap:anywhere}
.nt-flot-cuerpo::-webkit-scrollbar{display:none}
@media(prefers-reduced-motion:reduce){.nt-sticky,.nt-flotante{transition:none!important}}
`;

function inyectarEstilosNotas() {
  if (document.getElementById(ID)) return;
  const st = document.createElement("style");
  st.id = ID;
  st.textContent = CSS;
  document.head.append(st);
}

inyectarEstilosNotas();
export { inyectarEstilosNotas };
