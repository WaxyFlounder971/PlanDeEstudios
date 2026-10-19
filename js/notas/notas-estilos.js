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
