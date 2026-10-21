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
.notas-editor .notas-toolbar{display:flex!important;flex-wrap:nowrap;justify-content:flex-start!important;align-items:center;gap:8px!important;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;-ms-overflow-style:none;overscroll-behavior-inline:contain;white-space:nowrap;min-width:0}
.notas-editor .notas-toolbar::-webkit-scrollbar{display:none}
.notas-editor .notas-toolbar>*{flex:0 0 auto}
.notas-editor .notas-sep{flex:none;width:1px;align-self:stretch;min-height:26px;margin:0 10px;background:currentColor;opacity:.25}
.notas-editor .notas-toolbar button{display:inline-grid;place-items:center}
.nt-ico{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nt-ico-solido{fill:currentColor;stroke:none}
.nt-punto{display:block;width:9px;height:9px;border-radius:50%;background:currentColor}
.notas-toolbar [data-tool][aria-pressed="true"]{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530}
.notas-toolbar [data-forma][aria-pressed="true"]{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530}
.nt-tinta-tamanos{display:flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto}
.nt-tinta-tamanos input[type="range"]{width:112px;accent-color:#b7a5f4;cursor:pointer}
.nt-tinta-valor{min-width:34px;color:inherit;font-size:.72rem;text-align:right}
.nt-venc-row{display:flex;justify-content:flex-end;align-items:center;gap:8px;margin-top:-8px;font-size:.8rem;color:var(--text-muted,rgba(255,255,255,.62))}
.nt-venc-row .notas-vencimiento{min-height:28px;padding:2px 8px;border:0;background:transparent;font:inherit;color:inherit}
.nt-venc-row .nt-ico{width:14px;height:14px;vertical-align:middle}
.nt-tinta-color{width:30px;height:30px;padding:0;border:2px solid rgba(255,255,255,.35);border-radius:50%;overflow:hidden;cursor:pointer;background:none;appearance:none;-webkit-appearance:none}
.nt-tinta-color::-webkit-color-swatch-wrapper{padding:0}
.nt-tinta-color::-webkit-color-swatch{border:0;border-radius:50%}
.nt-tinta-color::-moz-color-swatch{border:0;border-radius:50%}
.nt-tinta-color.nt-oculto{display:none!important}
.nt-tinta-canvas{position:absolute;z-index:5;pointer-events:none;touch-action:none;border-radius:12px}
.nt-tinta-canvas.activo{pointer-events:auto;cursor:crosshair}
.nt-tinta-canvas[data-modo="borrador"]{cursor:cell}
.nt-tinta-canvas[data-modo="lapiz"]{cursor:crosshair}
.nt-tinta-canvas.nt-edicion-figuras{pointer-events:auto!important;cursor:move}
.nt-tinta-canvas[data-redimensionando="true"]{cursor:nwse-resize}
.nota-composicion{position:relative;min-width:0;max-height:220px;overflow:hidden}.nota-composicion>.nota-preview{position:relative;max-height:none!important;overflow:visible!important;-webkit-line-clamp:unset!important;line-clamp:unset!important}.nota-tinta-mini{display:block;width:100%;height:auto;margin-top:8px;pointer-events:none}.nota-tinta-mini.nota-tinta-alineada{position:absolute;z-index:2;left:0;top:0;width:100%;height:auto;margin:0;pointer-events:none}
.nota-expand{display:grid;place-items:center;align-self:center;width:30px;height:24px;padding:0;border:0;border-radius:8px;background:transparent;color:inherit;opacity:.72;cursor:pointer}
.nota-expand:hover{opacity:1;background:rgba(255,255,255,.12)}
.nota-expand svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round}
.nota-card .nota-composicion{box-sizing:content-box;padding-bottom:8px}.nota-card.expandida .nota-composicion{max-height:none!important;overflow:visible!important}.nota-card.expandida .nota-preview{max-height:none!important;overflow:visible!important;-webkit-line-clamp:unset!important;line-clamp:unset!important}
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
.notas-cuerpo li:has(input[data-nota-check]),.nota-preview li:has(input[data-nota-check]){list-style:none;margin-left:-1.3em}
.notas-cuerpo ul[data-marc-color]>li::marker,.notas-cuerpo ol[data-marc-color]>li::marker,.nota-preview ul[data-marc-color]>li::marker,.nota-preview ol[data-marc-color]>li::marker{color:var(--nt-marker-color,currentColor)}
.notas-cuerpo ul[data-marc-color] input[data-nota-check],.notas-cuerpo ol[data-marc-color] input[data-nota-check],.nota-preview ul[data-marc-color] input[data-nota-check],.nota-preview ol[data-marc-color] input[data-nota-check]{border-color:var(--nt-marker-color,currentColor)}
.notas-cuerpo ul[data-marc-color] input[data-nota-check]:checked,.notas-cuerpo ol[data-marc-color] input[data-nota-check]:checked,.nota-preview ul[data-marc-color] input[data-nota-check]:checked,.nota-preview ol[data-marc-color] input[data-nota-check]:checked{background:var(--nt-marker-color,currentColor)}
/* --- Arrastrar notas fijadas --- */
.nota-drag-handle{touch-action:none;cursor:grab}
.nota-drag-handle svg{display:block;width:16px;height:16px;fill:currentColor}
.nota-arrastrando{position:relative;z-index:60;box-shadow:0 20px 44px rgba(0,0,0,.5)!important;opacity:.97;transition:none!important;cursor:grabbing}
body.nota-arrastrando-body{user-select:none;-webkit-user-select:none;cursor:grabbing}

/* ===== Editor: color de texto (izq.) y de tinta (der.) siempre visibles, barra centrada ===== */
.notas-editor .nt-meta-row{display:grid;grid-template-columns:42px minmax(0,1fr) 42px;align-items:center;gap:10px;min-width:0}
.notas-editor .nt-tiempos{display:flex;align-items:center;justify-content:center;gap:10px;min-width:0}
.notas-editor .nt-barra-fila{display:block;min-width:0;overflow:hidden}
.nt-swatch{position:relative;display:inline-grid;place-items:center;flex:none;width:32px;height:32px;border-radius:50%;background:var(--sw,#172033);border:2px solid rgba(255,255,255,.4);box-shadow:0 2px 8px rgba(0,0,0,.3);overflow:hidden;cursor:pointer;transition:transform .15s}
.nt-swatch:hover{transform:scale(1.07)}
.nt-swatch:focus-within{outline:2px solid #fff;outline-offset:2px}
.nt-swatch-texto{justify-self:start}
.nt-swatch-tinta{justify-self:end}
.nt-swatch-ico{display:grid;place-items:center;pointer-events:none;color:var(--sw-fg,#fff);font-size:.95rem;line-height:1}
.nt-swatch-ico .nt-ico{width:15px;height:15px}
.nt-input-color{position:absolute;inset:0;width:100%;height:100%;padding:0;border:0;opacity:0;cursor:pointer}
@media(max-width:560px){.notas-editor .nt-meta-row{grid-template-columns:36px minmax(0,1fr) 36px;gap:5px}.notas-editor .nt-tiempos{gap:4px}.notas-editor .nt-tiempos .nt-fecha-btn{padding:4px 5px;font-size:.69rem}}
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
.notas-editor .nt-acciones-extra{display:flex;flex-wrap:wrap;gap:8px;width:100%}
.notas-editor .nt-acciones-extra .btn{flex:1 1 150px;min-height:40px}
.notas-editor .nt-acciones-extra input[hidden]{display:none!important}

/* ===== Tarjetas: 6 botones en una fila ===== */
.nota-card .nota-card-top{display:flex;align-items:center;justify-content:space-between;gap:6px;min-height:28px}
.nota-card .nota-card-badges{display:flex;flex-wrap:wrap;align-items:center;gap:6px;min-width:0}
.nota-card .nota-card-top .nota-drag-handle{flex:none;margin-left:auto}
.nota-card .nota-card-top .nota-pin-top{display:grid;place-items:center;flex:none;width:28px;height:28px;min-width:28px;min-height:28px;padding:0;border-radius:50%}
.nota-card .nota-card-foot{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.nota-card .nota-card-actions{display:flex;flex:1 1 100%;align-items:center;justify-content:space-between;gap:2px;width:100%;margin:0}
.nota-card .nota-icon-action{display:inline-grid;place-items:center;min-width:32px;height:32px;padding:0}
.nota-card .nota-icon-action .nt-ico{width:17px;height:17px}
.nota-card .nota-icon-action.activo .nt-ico{fill:currentColor}
.nt-vsep{flex:none;width:1px;height:18px;background:currentColor;opacity:.35;margin:0 2px}
.nota-card.nota-flotando{opacity:.62}
.nota-card.nota-flotando .nt-chip-flot{display:inline-flex}
/* Borrar: el icono se ve igual que los demás (color del texto de la nota, sin atenuar); solo al pasar el cursor, enfocar o presionar se pone rojo fuerte con sombra */
.nota-card .nota-icon-action.nota-eliminar-action{transition:background .12s,color .12s,box-shadow .12s}
.nota-card .nota-icon-action.nota-eliminar-action:not(:hover):not(:focus-visible):not(:active){color:inherit!important;opacity:1!important;background:transparent!important;filter:none!important}
.nota-card .nota-icon-action.nota-eliminar-action:hover,.nota-card .nota-icon-action.nota-eliminar-action:focus-visible{background:#dc2626!important;color:#fff!important;opacity:1!important;box-shadow:0 0 0 2px rgba(220,38,38,.35),0 4px 14px rgba(220,38,38,.75)}
.nota-card .nota-icon-action.nota-eliminar-action:active{background:#b91c1c!important;color:#fff!important;opacity:1!important;box-shadow:0 0 0 3px rgba(185,28,28,.45),0 2px 8px rgba(185,28,28,.8)}
/* Filtros: "Con vencimiento" como botón del estilo de las bolitas */
.notas-filtros .nt-vsep{height:22px;margin:0 4px}
.notas-filtros .nt-filtro-vence{display:inline-flex;align-items:center;gap:6px;width:auto;padding:0 12px;border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:.82rem;font-weight:600;white-space:nowrap;transition:background .15s}
.notas-filtros .nt-filtro-vence:hover{background:color-mix(in srgb,currentColor,transparent 90%)}
.notas-filtros .nt-filtro-vence[aria-pressed="true"]{background:color-mix(in srgb,var(--accent-2,#b7a5f4),transparent 78%)}
.nt-filtro-vence .nt-ico,.nota-vence-badge .nt-ico,.nt-sticky-vence .nt-ico{width:14px;height:14px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8}
.nota-vence-badge{display:inline-flex;align-items:center;gap:4px;font-size:.76rem}
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
.nt-sticky .nota-composicion,.nt-flotante .nota-composicion{position:relative;min-height:40px}.nt-sticky .nota-tinta-mini.nota-tinta-alineada,.nt-flotante .nota-tinta-mini.nota-tinta-alineada{position:absolute;left:0;top:0;width:100%;margin:0}.nt-sticker-seleccionado{outline:2px dashed #b7a5f4!important;outline-offset:3px;cursor:move!important}

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

/* ===== Cabecera: botones circulares perfectos ===== */
.notas-cab-acciones .nt-btn-circulo{display:inline-grid;place-items:center;flex:none;width:46px;height:46px;min-width:46px;min-height:46px;padding:0;border-radius:50%;line-height:1}
.nt-btn-circulo .nt-ico{width:20px;height:20px}

/* ===== Orden y grupos: fijadas · línea · demás ===== */
.notas-orden{display:flex;flex-wrap:wrap;align-items:center;gap:8px 10px}
.nt-orden-etq{font-size:.8rem;font-weight:700;color:var(--nt-muted,rgba(255,255,255,.62))}
.nt-seg-compacto{flex-wrap:nowrap;padding:3px;border-radius:14px;width:auto}
.nt-seg-compacto .nt-seg-op{flex:0 0 auto;min-height:32px;padding:5px 12px;border-radius:999px;font-size:.82rem;white-space:nowrap}
.notas-orden .nt-vsep{height:22px;margin:0 2px}
.notas-grupos{display:flex;flex-direction:column;gap:16px}
.nt-divisor{width:100%;height:0;margin:14px 0;border:0;border-top:2px solid color-mix(in srgb,currentColor,transparent 72%);border-radius:2px}

/* ===== Modo optimizado (data-rendimiento="reducido"): design-system.css pinta .glass-card con un fondo sólido oscuro
   que le ganaba a --nota-color; la tarjeta perdía su color pero la letra seguía calculada para ese color. Se devuelve el color de la nota. ===== */
html[data-rendimiento="reducido"] .glass-card.nota-card{background-color:var(--nota-color,#fff594);background-image:none;border-color:color-mix(in srgb,var(--nota-color,#fff594),#111 18%);box-shadow:0 2px 6px rgba(0,0,0,.28)}
html[data-rendimiento="reducido"] .nt-sticky,html[data-rendimiento="reducido"] .nt-flotante{backdrop-filter:none;-webkit-backdrop-filter:none}
html[data-rendimiento="reducido"] .nt-sticky-overlay{background:rgba(0,0,0,.85);backdrop-filter:none;-webkit-backdrop-filter:none}

/* ===== Ancho de nota (arrastrar el borde derecho) ===== */
.nota-card{position:relative}
.notas-grid-otras:not(.notas-lista){grid-auto-flow:row dense}
.nota-resize{position:absolute;top:18%;bottom:18%;width:16px;display:none;place-items:center;cursor:ew-resize;touch-action:none;opacity:0;transition:opacity .15s;z-index:2}
.nota-resize-der{right:0}.nota-resize-izq{left:0}
.nota-card[data-lados="der"] .nota-resize-der,.nota-card[data-lados="izq"] .nota-resize-izq,.nota-card[data-lados="ambos"] .nota-resize{display:grid}
.nota-resize::after{content:"";width:4px;height:36px;max-height:100%;border-radius:4px;background:currentColor;opacity:.4}
.nota-card:hover .nota-resize,.nota-card.nota-estirando .nota-resize,.nota-card.nota-ancha .nota-resize{opacity:1}
@media(hover:none){.nota-resize{opacity:1;width:28px}}
.notas-lista .nota-resize,body.notas-seleccionando .nota-resize{display:none!important}
.nota-card.nota-estirando{transition:none!important;outline:2px dashed color-mix(in srgb,currentColor,transparent 55%);outline-offset:-3px}
body:has(.nota-estirando){user-select:none;-webkit-user-select:none;cursor:ew-resize}

/* ===== Línea de filtros: ↓ ↑ y cuadrícula/lista anclados a la derecha ===== */
.notas-filtros{display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.nt-filtros-der{display:flex;align-items:center;gap:8px;margin-left:auto}
.nt-filtros-der .nt-seg-compacto{padding:4px;border-radius:14px}
.nt-filtros-der .nt-seg-compacto .nt-seg-op{width:40px;min-height:36px;padding:0;border-radius:999px;font-size:1.05rem;line-height:1}

/* ===== Selección por arrastre con mouse ===== */
.nt-marquesina{position:fixed;z-index:900;pointer-events:none;border:1.5px solid var(--accent-2,#b7a5f4);background:color-mix(in srgb,var(--accent-2,#b7a5f4),transparent 80%);border-radius:6px}
body.nota-marquesina-body{user-select:none;-webkit-user-select:none}
.notas-editor .nt-acc-der .btn .nt-ico,.notas-editor .notas-editor-share .btn .nt-ico{flex:none}

/* ===== Tamaño de las notas: una nota mide 1 columna, aunque sea la única (nunca se estira sola a todo el ancho) =====
   auto-fill conserva las columnas vacías; auto-fit las colapsaba y la nota ocupaba toda la fila.
   Para cambiar el tamaño de una nota: --nt-nota-min (ancho mínimo de columna). */
.notas-grid:not(.notas-lista){grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--nt-nota-min,250px)),1fr))!important}
@media(max-width:640px){.notas-grid:not(.notas-lista){--nt-nota-min:150px}}
.notas-grid:not(.notas-lista) .nota-card{aspect-ratio:1/1;min-height:0;height:auto;box-sizing:border-box;isolation:isolate}
.notas-grid:not(.notas-lista) .nota-card .nota-card-top,.notas-grid:not(.notas-lista) .nota-card .nota-titulo-card,.notas-grid:not(.notas-lista) .nota-card .nota-expand,.notas-grid:not(.notas-lista) .nota-card .nota-card-foot{flex:none}
.notas-grid:not(.notas-lista) .nota-card .nota-composicion{box-sizing:border-box;flex:1 1 auto;min-height:0;max-height:none!important;height:auto!important;width:100%;padding:0 0 10px;overflow:hidden}
.notas-grid:not(.notas-lista) .nota-card .nota-preview{box-sizing:border-box;height:100%;min-height:0;padding-bottom:10px;overflow:hidden!important;scrollbar-gutter:stable;overscroll-behavior:contain}
.notas-grid:not(.notas-lista) .nota-card.expandida .nota-composicion{overflow:auto!important}
.notas-grid:not(.notas-lista) .nota-card.expandida .nota-preview{overflow:auto!important}
.notas-grid:not(.notas-lista) .nota-card .nota-card-foot{margin-top:auto;padding-top:10px}
.notas-editor{isolation:isolate}
.notas-grid>.notas-vacio{grid-column:1/-1}

/* ===== Cita (línea que empieza con ">") ===== */
.notas-cuerpo blockquote,.nota-preview blockquote{margin:4px 0;padding:2px 0 2px 10px;border-left:3px solid color-mix(in srgb,currentColor,transparent 55%)}

/* ===== Formato activo (negrita / cursiva / subrayado) ===== */
.notas-toolbar [data-cmd][aria-pressed="true"]{background:var(--nt-grad,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530}

/* ===== Modo claro: sin "cajas" de fondo detrás de los grupos de elementos ===== */
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-editor-cab,
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-toolbar,
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .nt-barra-fila,
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-editor-tools,
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-editor-actions{background:transparent!important;box-shadow:none!important;-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-editor-cab,
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-editor .notas-toolbar{border-color:transparent!important}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-fecha-btn{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.14)}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-fecha-btn:hover{background:rgba(0,0,0,.08)}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-seg,html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-vista{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.12)}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-seg-op:hover{background:rgba(0,0,0,.07)}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-chip{background:rgba(0,0,0,.04);border-color:rgba(0,0,0,.14)}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .nt-chip:hover{background:rgba(0,0,0,.08)}

/* ===== Editor: la letra (y "Escribe aquí…", cursor y checkboxes) usan el color del selector de texto ===== */
.notas-editor .notas-cuerpo{caret-color:currentColor}
.notas-editor .notas-cuerpo:empty::before{color:currentColor!important;opacity:.6}

/* ===== Pie del editor: 4 botones del mismo ancho, sin separador ===== */
.notas-editor .notas-editor-actions{display:grid!important;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;width:100%}
.notas-editor .notas-editor-actions::before,.notas-editor .notas-editor-actions::after{display:none!important}
.notas-editor .notas-editor-actions .btn{display:inline-flex!important;align-items:center;justify-content:center;gap:8px;width:100%;min-width:0;min-height:46px;margin:0;padding:10px 8px;white-space:nowrap}
.notas-editor .notas-editor-actions .btn span{min-width:0;overflow:hidden;text-overflow:ellipsis}
@media(max-width:560px){.notas-editor .notas-editor-actions .btn{flex-direction:column;gap:4px;min-height:56px;padding:8px 2px;font-size:.78rem}}

/* Barra de edición: una sola línea, con desplazamiento horizontal discreto. */
.notas-editor .notas-toolbar{flex-wrap:nowrap!important;justify-content:flex-start!important}
.notas-editor .notas-toolbar button{width:38px;height:38px;min-width:38px;padding:0}
.notas-editor .nt-barra-fila{min-width:0}
.notas-editor .nt-pin{align-self:start;justify-self:start;width:42px;height:42px;min-width:42px;border-radius:50%;padding:0}
.notas-editor .notas-editor-foot-row{display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0}
.notas-editor .notas-editor-actions{display:flex!important;flex:0 0 auto;justify-content:flex-end!important;gap:6px;width:auto!important;padding:0!important;border:0!important}
.notas-editor .notas-editor-actions .btn{display:grid!important;place-items:center;width:34px!important;min-width:34px!important;height:34px;min-height:34px!important;padding:0!important;border-radius:50%;flex:none}
.notas-editor .notas-editor-actions .btn .nt-ico{width:16px;height:16px}
.notas-editor .nt-vencimiento-area{position:relative;display:flex;align-items:center;gap:7px;min-width:0;color:var(--text-muted,rgba(255,255,255,.58));font-size:.76rem}
.notas-editor .nt-vencimiento-btn,.notas-editor .nt-elegir-fecha,.notas-editor .nt-vencimiento-fecha,.notas-editor .nt-eliminar-vencimiento{display:inline-flex;align-items:center;gap:6px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;padding:5px 7px;cursor:pointer}
.notas-editor .nt-vencimiento-btn:hover,.notas-editor .nt-elegir-fecha:hover,.notas-editor .nt-vencimiento-fecha:hover,.notas-editor .nt-eliminar-vencimiento:hover{background:rgba(255,255,255,.08);color:inherit}
.notas-editor .nt-vencimiento-btn .nt-ico{width:14px;height:14px}
.notas-editor .nt-vencimiento-fecha{color:inherit;text-align:left}
.notas-editor .nt-vencimiento-editar{display:flex;align-items:center;gap:6px;position:absolute;left:0;bottom:calc(100% + 6px);z-index:10;padding:5px 7px;border:1px solid var(--nt-borde,rgba(255,255,255,.14));border-radius:11px;background:var(--bg-card,#211e2d);box-shadow:0 8px 24px rgba(0,0,0,.3);white-space:nowrap}
.notas-editor .nt-vencimiento-editar .nt-fecha-btn{min-height:28px;padding:3px 7px;font-size:.76rem}
.notas-editor .nt-eliminar-vencimiento{color:#f87171}
.nt-figuras-menu{position:fixed;z-index:100001;display:flex;flex-direction:column;gap:5px;width:min(280px,calc(100vw - 16px));max-height:min(52vh,360px);overflow:auto;padding:8px;border:1px solid rgba(255,255,255,.15);border-radius:14px;background:rgba(22,20,34,.98);color:#fff;box-shadow:0 18px 40px rgba(0,0,0,.5)}
.nt-figuras-menu button{display:flex;align-items:center;gap:9px;min-height:38px;padding:7px 10px;border:0;border-radius:9px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.nt-figuras-menu button:hover,.nt-figuras-menu button[aria-pressed="true"]{background:rgba(255,255,255,.12)}
.nt-figuras-menu .nt-stickers-lista{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:3px}
.nt-figuras-menu .nt-sticker-item{min-width:0;font-size:.78rem}
.nt-figuras-menu .nt-sticker-tile{position:relative;display:flex;align-items:center;min-width:0}
.nt-figuras-menu .nt-sticker-tile .nt-sticker-item{flex:1;min-width:0;padding-right:28px}
.nt-figuras-menu .nt-sticker-quitar{position:absolute;right:2px;top:3px;min-height:24px!important;width:24px;height:24px;padding:0!important;justify-content:center;border-radius:50%!important;background:rgba(0,0,0,.25)!important}
.nt-figuras-menu .nt-sticker-item img{width:34px;height:34px;object-fit:contain;border-radius:5px;background:rgba(255,255,255,.08);flex:none}
.nt-figuras-menu .nt-sticker-item span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.notas-editor .notas-cuerpo img[data-nota-sticker]{display:block;max-width:100%;height:auto;resize:both;overflow:auto;object-fit:contain;margin:5px 0}
body:has(.notas-overlay) .toast-app,body:has(.notas-overlay) .toast-app-accion{z-index:100120!important}
@media(max-width:560px){.notas-editor .notas-editor-foot-row{gap:5px}.notas-editor .notas-editor-actions{gap:3px}.notas-editor .notas-editor-actions .btn{width:31px!important;min-width:31px!important;height:31px;min-height:31px!important}}


/* Cierre del editor y controles redondos */
.notas-editor .nt-pin,.notas-editor .nt-close-round{display:grid;place-items:center;width:40px;height:40px;min-width:40px;min-height:40px;padding:0;border-radius:50%;aspect-ratio:1;flex:none}
.notas-editor .nt-close-round{font-size:1.5rem;line-height:1}
.nt-confirmar-cierre{position:absolute;inset:0;z-index:100010;display:grid;place-items:center;padding:16px;border-radius:inherit;background:rgba(7,6,12,.48);backdrop-filter:blur(3px)}
.nt-confirmar-cierre.nt-oculto{display:none}
.nt-confirmar-cierre section{display:grid;gap:16px;width:min(360px,100%);padding:20px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:18px;background:var(--bg-card,#211e2d);box-shadow:0 14px 40px #0008}
.nt-confirmar-cierre section>div{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px}
.nt-confirmar-cierre button{min-height:38px;padding:7px 13px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:999px;background:transparent;color:inherit;font:inherit;cursor:pointer}
.nt-confirmar-cierre [data-close="save"]{border:0;background:var(--gradient-primary,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530;font-weight:700}
.notas-editor .notas-editor-tools{flex-wrap:nowrap;min-width:0;overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none}
.notas-editor .notas-editor-tools::-webkit-scrollbar{display:none}
.notas-editor .nt-meta-row{grid-template-columns:42px minmax(0,1fr) 42px}
.notas-editor .nt-tiempos{white-space:nowrap;overflow-x:auto;scrollbar-width:none}
.notas-editor .nt-tiempos::-webkit-scrollbar{display:none}
.notas-filtros .nt-seg-compacto{border-radius:999px}
.notas-filtros .nt-seg-compacto .nt-seg-op{width:36px;height:36px;min-width:36px;min-height:36px;padding:0;border-radius:50%;display:grid;place-items:center}
.notas-filtros .nt-vista{border-radius:999px}
.notas-filtros .nt-vista-op{width:36px;height:36px;border-radius:50%;flex:none}
.nt-filtros-der{display:flex;align-items:center;gap:8px}
.nt-orden-personalizado{width:36px;height:36px;display:grid;place-items:center;border:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer}
.nt-orden-personalizado[aria-pressed="true"]{background:var(--nt-grad);color:#1b1530}
.notas-editor .nt-tinta-tamanos input[type="range"]{min-width:72px;max-width:140px}
.nt-sticker-contexto .nt-rotacion-control{display:grid;gap:7px;padding:7px 8px;font-size:.82rem}.nt-sticker-contexto .nt-rotacion-grados{display:inline-flex;align-items:center;justify-content:center;gap:5px;width:max-content;padding:3px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:999px;background:rgba(255,255,255,.06)}.nt-sticker-contexto .nt-rotacion-grados button{display:grid;place-items:center;width:26px;height:26px;min-height:26px;padding:0;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}.nt-sticker-contexto .nt-rotacion-grados input[type=number]{box-sizing:border-box;width:42px;padding:4px 2px;border:0;border-radius:999px;outline:0;background:transparent;color:inherit;text-align:center;font:inherit;appearance:textfield;-moz-appearance:textfield}.nt-sticker-contexto .nt-rotacion-grados input::-webkit-inner-spin-button,.nt-sticker-contexto .nt-rotacion-grados input::-webkit-outer-spin-button{display:none;-webkit-appearance:none;margin:0}.nt-sticker-contexto .nt-rotacion-grados input:focus{box-shadow:0 0 0 2px #b7a5f4}.nt-sticker-contexto input[type=range]{width:100%;height:4px;border-radius:999px;background:rgba(255,255,255,.22);accent-color:#b7a5f4;appearance:none;cursor:pointer}.nt-sticker-contexto input[type=range]::-webkit-slider-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#b7a5f4;appearance:none}.nt-sticker-contexto input[type=range]::-moz-range-thumb{width:14px;height:14px;border:0;border-radius:50%;background:#b7a5f4}.nt-sticker-contexto .nt-rotacion-grados input:focus-visible{outline:2px solid #b7a5f4;outline-offset:2px}
.nt-pip-nota .nota-composicion{position:relative;min-width:0;min-height:40px;flex:none}.nt-pip-nota .nota-tinta-mini.nota-tinta-alineada{position:absolute;left:0;top:0;width:100%;height:auto;margin:0}.nt-editar-figuras-toggle{display:flex;align-items:center;gap:9px;padding:8px 10px;font-weight:650}.nt-editar-figuras-toggle input{accent-color:#b7a5f4;width:17px;height:17px}.nt-eliminar-figura{color:#f87171!important}.nt-orden-personalizado{font-size:.78rem;opacity:.72;white-space:nowrap}
.nt-fecha{position:relative}.nt-calendario{position:fixed;left:0;top:0;z-index:100020;width:260px;padding:12px;border:1px solid var(--border-glass,rgba(255,255,255,.14));border-radius:16px;background:var(--bg-card,#211e2d);box-shadow:0 14px 34px #0008;color:inherit}.nt-calendario.nt-oculto{display:none}.nt-cal-cab{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px}.nt-cal-cab button{width:32px;height:32px;border:0;border-radius:50%;background:rgba(255,255,255,.08);color:inherit;font-size:1.3rem;cursor:pointer}.nt-cal-dias,.nt-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;text-align:center}.nt-cal-dias{margin-bottom:4px;opacity:.6;font-size:.75rem}.nt-cal-dia{aspect-ratio:1;border:0;border-radius:50%;background:transparent;color:inherit;font:inherit;cursor:pointer}.nt-cal-dia:hover{background:rgba(255,255,255,.12)}.nt-cal-dia.seleccionado{background:var(--gradient-primary,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530;font-weight:800}.nt-cal-dia.hoy:not(.seleccionado){outline:1px solid currentColor}.nt-cal-hora{display:flex;justify-content:space-between;align-items:center;margin-top:10px;font-size:.82rem}.nt-reloj-selectores{display:flex;align-items:center;gap:4px}.nt-reloj-selectores select{min-width:48px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:9px;background:var(--bg-card,#211e2d);color:inherit;padding:5px}.nt-cal-aplicar{width:100%;margin-top:8px;min-height:34px;border:0;border-radius:999px;background:var(--gradient-primary,linear-gradient(135deg,#f5a9d3,#b7a5f4));color:#1b1530;font-weight:700;cursor:pointer}.nt-share-menu-card{display:grid;gap:5px;min-width:250px;padding:10px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:16px;background:var(--bg-card,#211e2d);box-shadow:0 14px 36px #0009;color:inherit}.nt-share-menu-card strong{padding:5px 8px;font-size:.85rem}.nt-share-menu-card button{min-height:38px;padding:8px 10px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}.nt-share-menu-card button:hover{background:rgba(255,255,255,.1)}.nt-paleta-editable{flex-wrap:nowrap!important;overflow-x:auto;scrollbar-width:none;gap:7px}.nt-paleta-editable::-webkit-scrollbar{display:none}.nt-color-edit-item{position:relative;display:inline-flex;flex:none}.nt-color-edit-picker{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none}.nt-paleta-editable.editando .nt-color-edit-picker{pointer-events:auto}.nt-paleta-editable>button{flex:none;min-height:30px;padding:4px 9px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:999px;background:transparent;color:inherit;font:inherit;font-size:.75rem;cursor:pointer}`;

const CSS_RONDA_DOS = `
.nt-flotante .nt-flot-btn.activo{background:#8b72e8;color:#fff;opacity:1}.nt-flotante .nt-flot-cuerpo{position:relative;flex:1 1 auto;min-height:56px;touch-action:pan-y}.nt-flotante .nt-flot-herramientas{position:relative;z-index:12;flex:none;align-self:center;display:flex;align-items:center;justify-content:center;gap:7px;margin-top:auto;padding:4px 9px;border:1px solid #ffffff35;border-radius:999px;background:color-mix(in srgb,var(--nt-nota,#fff594) 86%,#111);box-shadow:0 3px 10px #0003;touch-action:manipulation;cursor:default}.nt-flot-herr-btn{display:grid;place-items:center;flex:none;width:30px;height:30px;padding:0;border:0;border-radius:50%;background:#0002;color:inherit;cursor:pointer}.nt-flot-herr-btn .nt-ico{width:17px;height:17px}.nt-flot-herr-btn.activo{background:#8b72e8;color:#fff;box-shadow:0 0 0 2px #ffffff70}.nt-flot-grosor{display:flex;align-items:center;gap:5px;min-width:100px;font-size:.68rem;cursor:default}.nt-flot-grosor input{width:75px;min-width:55px;accent-color:#8b72e8}.nt-flot-grosor output{min-width:22px;text-align:right}.nt-flot-figuras-menu{position:absolute;bottom:calc(100% + 7px);left:50%;z-index:30;display:grid;grid-template-columns:repeat(2,minmax(105px,1fr));gap:3px;width:min(250px,calc(100vw - 28px));max-height:min(42vh,260px);overflow:auto;padding:7px;border:1px solid #ffffff35;border-radius:12px;background:#171923;color:#fff;box-shadow:0 8px 25px #0008;transform:translateX(-50%);cursor:default}.nt-flot-figuras-menu.nt-oculto{display:none}.nt-flot-figuras-menu button{min-height:32px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left;cursor:pointer}.nt-flot-figuras-menu button:hover,.nt-flot-figuras-menu button[aria-checked="true"]{background:#ffffff20}
@media(max-width:600px){.notas-grid:not(.notas-lista){--nt-nota-min:0px;grid-template-columns:repeat(2,minmax(0,1fr))!important;gap:8px!important}.notas-grid:not(.notas-lista)>.nota-card{grid-column:span 1!important}.notas-grid:not(.notas-lista) .nota-card{padding:8px!important;font-size:.72rem}.notas-grid:not(.notas-lista) .nota-card .nota-titulo-card{font-size:.78rem;line-height:1.15}.notas-grid:not(.notas-lista) .nota-card .nota-card-top,.notas-grid:not(.notas-lista) .nota-card .nota-card-foot{gap:3px}.notas-grid:not(.notas-lista) .nota-card .nota-icon-action{min-width:26px;height:26px}.notas-editor .notas-editor-foot-row.nt-pie-dos-filas{flex-wrap:wrap;row-gap:4px}.notas-editor .nt-pie-dos-filas .nt-vencimiento-area{flex:1 1 100%;min-width:0}.notas-editor .nt-pie-dos-filas .notas-editor-actions{margin-left:auto}.notas-editor .nt-fechas-panel{margin-bottom:env(safe-area-inset-bottom)}}
@media(max-width:560px){.notas-overlay{align-items:stretch!important;padding:0!important}.notas-editor{width:100vw!important;max-width:100vw!important;height:100dvh!important;max-height:100dvh!important;margin:0!important;padding:calc(10px + env(safe-area-inset-top)) 10px calc(10px + env(safe-area-inset-bottom))!important;border-radius:0!important;overflow:auto!important}.notas-editor-cab{top:calc(-10px - env(safe-area-inset-top))!important}.notas-editor .nt-barra-fila{overflow:visible!important}.notas-editor .notas-toolbar.nt-toolbar-dos-filas{row-gap:4px}.notas-editor .nt-toolbar-fila{max-width:100%;gap:0}.notas-editor .notas-sep{margin-inline:3px}.notas-editor .nt-zoom-grupo{gap:3px}.notas-editor .nt-zoom-btn{width:28px;height:28px;min-width:28px;min-height:28px}.notas-editor .nt-tinta-tamanos{gap:4px!important}.notas-editor .nt-tinta-tamanos input[type=range]{width:74px;min-width:60px;max-width:74px}}
.nt-fechas-overlay{position:fixed;inset:0;z-index:100180;display:grid;place-items:center;padding:16px;background:#080811;backdrop-filter:none;-webkit-backdrop-filter:none}.nt-fechas-overlay.nt-oculto{display:none}.nt-fechas-panel{width:min(440px,100%);max-height:min(80dvh,680px);overflow:auto;padding:16px;border:1px solid var(--border-glass,rgba(255,255,255,.18));border-radius:22px;background:var(--bg-card,#211e2d);color:inherit;box-shadow:0 18px 48px #000b}.nt-fechas-panel>header{display:flex;align-items:center;gap:10px;margin-bottom:12px}.nt-fechas-panel>header strong{flex:1}.nt-fechas-cerrar{width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.1);color:inherit;font-size:1.4rem}.nt-fechas-contenido{display:grid;gap:12px}.nt-fechas-contenido>.nt-fecha{width:100%}.nt-fechas-contenido .nt-fecha-btn{width:100%;justify-content:space-between;min-height:42px}.nt-fecha-compacta{display:none!important}.nt-fecha-compacta.nt-fecha-visible{display:inline-flex!important}.nt-calendario{z-index:100260!important}
.nt-aviso-superior{position:fixed;z-index:100300;left:50%;top:max(12px,env(safe-area-inset-top));transform:translateX(-50%);width:min(620px,calc(100vw - 24px));max-height:35dvh;overflow:auto;padding:12px 16px;border:1px solid rgba(255,255,255,.2);border-radius:16px;background:#242032;color:#fff;box-shadow:0 12px 36px #000b;text-align:center;font-weight:650;white-space:pre-wrap}.nt-aviso-superior.nt-aviso-error{background:#4b2029}.nt-aviso-superior.nt-aviso-resultado{background:#24372d}.nt-aviso-procesando{display:flex;align-items:center;justify-content:center;gap:10px;min-height:48px}.nt-aviso-procesando::before{content:"";flex:none;width:18px;height:18px;border:3px solid #ffffff55;border-top-color:#fff;border-radius:50%;animation:nt-ocr-giro .75s linear infinite}@keyframes nt-ocr-giro{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.nt-aviso-procesando::before{animation:none;border-color:#fff;border-right-color:#ffffff55}}.nt-herr-otros{display:flex!important;align-items:center;justify-content:center;gap:12px!important;color:inherit!important}.nt-herr-otros::before,.nt-herr-otros::after{content:"";height:1px;flex:1;background:currentColor;opacity:.3}.nt-herr-no-disponible{opacity:.58!important}.nt-herr-otros-lista{display:grid;gap:2px}.nt-herr-menu{max-height:min(70dvh,calc(100dvh - 16px))!important}.nt-figuras-grupo-titulo{padding:7px 10px 0;font-size:.72rem;opacity:.65}.nt-figuras-menu button .nt-figura-icono{display:grid;place-items:center;flex:none;width:24px;height:24px;font-size:22px;line-height:1}.notas-editor .nt-zoom-btn:disabled{opacity:.38;cursor:not-allowed}
.notas-editor .nt-zoom-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.nt-sticker-marco{border-style:dashed!important}
.notas-editor .notas-color[aria-pressed="true"]{outline:2px solid var(--accent-2,#b7a5f4)!important;outline-offset:2px;box-shadow:none!important}
.notas-editor .notas-editor-tools{padding-block:5px;margin-block:-5px}
.notas-editor .nt-colores-grupo{padding:5px;margin:-5px 0 -5px -5px}
.notas-editor .nt-zoom-grupo{gap:8px!important}
.notas-editor .nt-tinta-tamanos{gap:8px!important}
.nt-sticker-contexto{z-index:100220!important}
.notas-editor .notas-cuerpo>:not(img):not(:has(img)),.nota-preview>:not(img):not(:has(img)){position:relative;z-index:1}
.nt-toolbar-fila{display:contents}
.notas-editor .nt-toolbar-grupo{display:flex;align-items:center;gap:4px}
.notas-editor .nt-toolbar-fila{display:flex;align-items:center;justify-content:center;gap:0;min-width:0}
.notas-editor .notas-toolbar.nt-toolbar-dos-filas{width:100%;display:grid!important;grid-template-columns:1fr;justify-items:center;overflow:visible!important;white-space:normal}
.notas-editor .notas-toolbar.nt-toolbar-dos-filas .nt-toolbar-fila{display:flex;justify-content:center;width:100%}.notas-editor .notas-toolbar.nt-toolbar-dos-filas .nt-sep-desktop{display:none!important}
.notas-editor .notas-toolbar:not(.nt-toolbar-dos-filas) .nt-toolbar-fila{display:contents}
.notas-editor .notas-toolbar .nt-toolbar-grupo button{width:clamp(32px,9.5vw,40px);height:clamp(32px,9.5vw,40px);min-width:clamp(32px,9.5vw,40px);padding:0}
.notas-editor .nt-colores-grupo{display:flex;align-items:center;gap:6px;flex:0 0 auto;min-width:0}
.notas-editor .nt-zoom-grupo{display:flex;align-items:center;gap:8px;margin-left:auto;flex:0 0 auto;min-width:max-content}
.notas-editor .nt-zoom-btn{display:grid;place-items:center;flex:none;width:32px;height:32px;min-width:32px;min-height:32px;padding:0;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:50%;background:transparent;color:inherit;cursor:pointer}
.notas-editor .nt-nota-zoom span{display:grid;place-items:center;width:100%;height:100%;font-size:23px;line-height:1;font-weight:650;transform:translateY(-1px)}
.notas-editor .nt-lienzo-zoom svg{display:block;width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.notas-editor .nt-figura-activa{display:grid;place-items:center;font-size:23px;line-height:1;font-weight:600}
.nt-figura-contexto{position:fixed;z-index:100240;display:grid;gap:4px;min-width:172px;padding:6px;border:1px solid rgba(255,255,255,.16);border-radius:12px;background:#171522;color:#fff;box-shadow:0 12px 36px #000b}
.nt-figura-contexto.nt-oculto{display:none}
.nt-figura-contexto>button,.nt-figura-color-opcion{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:38px;padding:6px 9px;border:0;border-radius:8px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer}
.nt-figura-contexto>button:hover,.nt-figura-color-opcion:hover{background:rgba(255,255,255,.1)}
.nt-figura-contexto>button{color:#ffb4b4}
.nt-figura-color-opcion input{width:30px;height:28px;padding:0;border:1px solid #ffffff66;border-radius:7px;background:none;cursor:pointer}
.notas-editor .nt-tools-dos-filas{display:grid!important;grid-template-columns:minmax(0,1fr);gap:8px!important;align-items:center}
.notas-editor .nt-tools-dos-filas .nt-zoom-grupo{grid-row:1;justify-self:center;width:max-content;max-width:100%;margin:0;overflow-x:auto;scrollbar-width:none}
.notas-editor .nt-tools-dos-filas .nt-colores-grupo{grid-row:2;justify-self:center;justify-content:flex-start;flex-wrap:nowrap;width:max-content;max-width:100%;min-width:0;overflow-x:auto;scrollbar-width:none}
.notas-editor .nt-tools-dos-filas .nt-colores-grupo::-webkit-scrollbar{display:none}
.notas-editor .nt-tools-dos-filas .nt-zoom-grupo::-webkit-scrollbar{display:none}
.notas-editor .nt-tools-dos-filas .nt-tinta-tamanos{flex:0 1 auto;min-width:72px;margin-left:0!important;gap:8px}
.notas-editor .nt-tools-dos-filas .nt-tinta-tamanos input[type=range]{width:112px;min-width:72px;max-width:112px}
.notas-editor .nt-tools-dos-filas .nt-colores-grupo .notas-color{position:relative;width:clamp(20px,6vw,28px);height:clamp(20px,6vw,28px);flex:none}.notas-editor .nt-tools-dos-filas .nt-colores-grupo .notas-color::before{content:"";position:absolute;inset:-4px}.notas-editor .nt-tools-dos-filas .nt-colores-grupo{gap:4px}.notas-editor .nt-tools-dos-filas .nt-colores-grupo .notas-sep{margin-inline:2px}
.notas-seccion .nt-btn-circulo{color:#fff!important}.notas-seccion .nt-add-icon{width:22px;height:22px;stroke:currentColor;stroke-width:2.6;stroke-linecap:round}
html:not([data-mode="dark"]):not([data-mode="true-dark"]) .notas-seccion .nt-btn-circulo{color:#211b31!important}
.notas-editor .notas-cuerpo img[data-nota-sticker],.notas-editor .notas-cuerpo img[data-nota-image]{resize:none!important;max-width:none!important;overflow:visible!important;touch-action:none;user-select:none;-webkit-user-drag:none}
.nt-sticker-marco{position:fixed;z-index:100110;box-sizing:border-box;border:1px dashed rgba(183,165,244,.98);pointer-events:none;transform-origin:center center}
.nt-sticker-marco[hidden]{display:none!important}
.nt-sticker-asa{position:absolute;box-sizing:border-box;width:28px;height:28px;padding:0;border:0;border-radius:50%;background:transparent;pointer-events:auto;touch-action:none}.nt-sticker-asa::before{content:"";position:absolute;left:50%;top:50%;width:10px;height:10px;box-sizing:border-box;transform:translate(-50%,-50%);border:2px solid #fff;border-radius:3px;background:#9b82e8;box-shadow:0 1px 5px #0009}
.nt-sticker-asa-nw{left:0;top:0;transform:translate(-50%,-50%)}.nt-sticker-asa-n{left:50%;top:0;transform:translate(-50%,-50%)}.nt-sticker-asa-ne{right:0;top:0;transform:translate(50%,-50%)}.nt-sticker-asa-e{right:0;top:50%;transform:translate(50%,-50%)}.nt-sticker-asa-se{right:0;bottom:0;transform:translate(50%,50%)}.nt-sticker-asa-s{left:50%;bottom:0;transform:translate(-50%,50%)}.nt-sticker-asa-sw{left:0;bottom:0;transform:translate(-50%,50%)}.nt-sticker-asa-w{left:0;top:50%;transform:translate(-50%,-50%)}
.notas-editor .notas-cuerpo img[data-nota-sticker],.notas-editor .notas-cuerpo img[data-nota-image]{display:block;max-width:100%;height:auto;resize:both;overflow:auto;object-fit:contain;margin:5px 0}
.notas-editor{--boton-esquina:36px;scrollbar-width:none;-ms-overflow-style:none}
.notas-editor::-webkit-scrollbar{display:none}
.notas-overlay{scrollbar-width:none;-ms-overflow-style:none}
.notas-overlay::-webkit-scrollbar{display:none}
.notas-editor .notas-editor-cab{display:grid!important;grid-template-columns:var(--boton-esquina) minmax(0,1fr) var(--boton-esquina)!important;align-items:center!important;column-gap:12px!important}
.notas-editor .nt-pin,.notas-editor .nt-close-round{width:var(--boton-esquina)!important;height:var(--boton-esquina)!important;min-width:var(--boton-esquina)!important;min-height:var(--boton-esquina)!important;border-radius:50%!important;justify-self:center!important;align-self:center!important}
.notas-editor .nt-meta-row{grid-template-columns:var(--boton-esquina) minmax(0,1fr) var(--boton-esquina)!important;column-gap:12px!important}
.notas-editor .nt-swatch{width:var(--boton-esquina)!important;height:var(--boton-esquina)!important}
.notas-editor .nt-barra-fila{position:sticky;top:0;z-index:100;display:flex!important;justify-content:safe center!important;overflow:visible!important;background:var(--bg-card,#211e2d)}
.notas-editor .notas-editor-foot{position:sticky;bottom:0;z-index:100;padding-block:6px;background:var(--bg-card,#211e2d)}
.notas-editor .notas-cuerpo{min-width:0;max-width:100%;box-sizing:border-box;overflow-wrap:anywhere;word-break:normal}
.notas-editor .notas-cuerpo img[data-nota-sticker],.notas-editor .notas-cuerpo img[data-nota-image]{max-width:min(100%,calc(100vw - 40px))!important}
.notas-editor .notas-toolbar{width:max-content;max-width:100%;margin-inline:auto;justify-content:flex-start!important}
.notas-editor .notas-editor-tools{display:flex!important;flex-wrap:nowrap!important;justify-content:space-between!important;align-items:center!important;column-gap:12px!important}
.notas-editor .nt-colores-grupo{order:0;margin-right:auto;max-width:calc(100% - 1px);overflow-x:auto;scrollbar-width:none}
.notas-editor .nt-colores-grupo::-webkit-scrollbar{display:none}
.notas-editor .nt-zoom-grupo{order:1;margin-left:auto!important}
.notas-editor .nt-tinta-tamanos{display:flex;align-items:center;gap:6px;margin-left:0!important;flex:0 0 auto}
.notas-editor .nt-tinta-tamanos input[type=range]{accent-color:#b7a5f4!important}
.notas-editor .nt-vencimiento-area,.notas-editor .nt-vencimiento-btn,.notas-editor .nt-elegir-fecha,.notas-editor .nt-vencimiento-fecha,.notas-editor .nt-eliminar-vencimiento{white-space:nowrap!important;flex:0 0 auto}
.notas-editor .notas-editor-actions .btn{flex:0 0 var(--boton-esquina)!important;width:var(--boton-esquina)!important;height:var(--boton-esquina)!important;min-width:var(--boton-esquina)!important;min-height:var(--boton-esquina)!important}
.nt-calendario{z-index:100200!important;box-sizing:border-box;width:min(280px,calc(100vw - 16px));max-height:calc(100vh - 16px);overflow-y:auto;background:rgb(25 26 34)!important;color:#f7f7f7}
.nt-cal-dias,.nt-cal-grid{grid-template-columns:repeat(7,minmax(0,1fr));width:100%;box-sizing:border-box}
.nt-cal-grid{grid-auto-rows:32px}
.nt-cal-dia,.nt-cal-grid>span{width:100%;height:32px;box-sizing:border-box}
.nt-reloj-selectores select{background:rgb(25 26 34)!important}
.nt-share-overlay{position:fixed;inset:0;z-index:100130;display:grid;place-items:center;padding:16px;background:rgba(6,7,14,.62);backdrop-filter:blur(4px)}
.nt-share-overlay.nt-oculto{display:none}
.nt-share-menu-card{display:grid;gap:9px;width:min(420px,100%);box-sizing:border-box;padding:16px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:20px;background:rgb(25 26 34);box-shadow:0 14px 36px #0009;color:#f7f7f7}
.nt-share-menu-card header{display:flex;align-items:center;justify-content:space-between;margin-bottom:4px}
.nt-share-menu-card strong{padding:5px 8px;font-size:1rem}
.nt-share-menu-card .nt-share-close{width:36px;height:36px;min-height:36px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;background:rgba(255,255,255,.1);font-size:1.4rem}
.nt-share-menu-card button:not(.nt-share-close){min-height:44px;padding:10px 14px;border:0;border-radius:999px;background:rgba(255,255,255,.07);color:inherit;font:inherit;text-align:center;cursor:pointer}
.nt-share-menu-card button:hover{background:rgba(255,255,255,.14)}
.nt-stickers-overlay{position:fixed;inset:0;z-index:100140;display:grid;place-items:center;padding:16px;background:rgba(6,7,14,.68);backdrop-filter:blur(4px)}
.nt-stickers-overlay.nt-oculto{display:none}.nt-stickers-panel{position:relative}.nt-sticker-confirmar{position:absolute;inset:0;z-index:2;display:grid;place-items:center;padding:16px;border-radius:inherit;background:rgba(6,7,14,.62);backdrop-filter:blur(3px)}.nt-sticker-confirmar section{display:grid;gap:12px;width:min(340px,100%);padding:16px;border:1px solid rgba(255,255,255,.15);border-radius:18px;background:rgb(25 26 34);box-shadow:0 14px 36px #0009}.nt-sticker-confirmar p{margin:0;line-height:1.45}.nt-sticker-confirmar section>div{display:flex;justify-content:flex-end;gap:8px}.nt-sticker-confirmar button{min-height:36px;padding:7px 13px;border:0;border-radius:999px;background:rgba(255,255,255,.1);color:inherit;font:inherit;cursor:pointer}.nt-sticker-confirmar .nt-sticker-confirmar-quitar{background:#a42c3a;color:#fff}.nt-sticker-celda.sobre-destino{outline:2px dashed #b7a5f4;outline-offset:-4px}
.nt-stickers-panel{width:min(720px,calc(100vw - 32px));max-height:min(78vh,760px);overflow:auto;box-sizing:border-box;padding:18px;border:1px solid var(--border-glass,rgba(255,255,255,.16));border-radius:22px;background:rgb(25 26 34);color:#f7f7f7;box-shadow:0 18px 54px #000b}
.nt-stickers-panel>header{display:flex;align-items:center;gap:10px;margin-bottom:16px}
.nt-stickers-panel>header strong{font-size:1.1rem;margin-right:auto}
.nt-stickers-panel>header button{border:0;border-radius:999px;padding:8px 14px;background:rgba(255,255,255,.09);color:inherit;font:inherit;cursor:pointer}
.nt-stickers-panel>header .nt-stickers-cerrar{width:36px;height:36px;padding:0;border-radius:50%;font-size:1.4rem}
.nt-stickers-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:12px}
.nt-sticker-agregar,.nt-sticker-celda{position:relative;aspect-ratio:1;min-width:0;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.045);overflow:hidden}
.nt-sticker-agregar{display:grid;place-content:center;white-space:pre-line;text-align:center;gap:8px;color:inherit;font:inherit;font-weight:650;cursor:pointer}
.nt-sticker-agregar:first-line{font-size:2rem}
.nt-sticker-item{width:100%;height:100%;display:grid;place-items:center;border:0;background:transparent;padding:10px;cursor:pointer}
.nt-sticker-item img{width:100%;height:100%;object-fit:contain}
.nt-sticker-quitar{position:absolute;top:5px;right:5px;width:28px;height:28px;border:0;border-radius:50%;background:#a42c3a;color:white;font-size:1.2rem;cursor:pointer}
.nt-sticker-celda.arrastrando{opacity:.45}.nt-sticker-celda[draggable="true"]{cursor:grab}
`;

function inyectarEstilosNotas() {
  if (document.getElementById(ID)) return;
  const st = document.createElement("style");
  st.id = ID;
  st.textContent = CSS + CSS_RONDA_DOS;
  document.head.append(st);
}

inyectarEstilosNotas();
export { inyectarEstilosNotas };
