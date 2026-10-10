import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp, PALETAS_DISPONIBLES } from "./schema.js";
import { aplicarPaleta, obtenerModoTemaLocal, guardarModoTemaLocal, obtenerModoDisenoLocal, guardarModoDisenoLocal, COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO } from "../ui/tema.js";
import { traducirTextoInterfaz } from "./i18n.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";
import { aplicarLogoApp, prepararImagenLogo } from "./marca.js";
import { MODO_DEMO, PREVIEW_DEMO } from "./demo-mode.js";

const SECCIONES_TUTORIAL = [
  { id:"resumen", nombre:"Resumen", puntos:["Clases, entregas y exámenes próximos.","Avance de estudio del día.","Accesos rápidos a lo que requiere atención."] },
  { id:"agenda", nombre:"Agenda", puntos:["Alterna entre lista, calendario y cronograma.","Organiza tareas, exámenes, proyectos y eventos.","Vincula cada actividad con su materia y semestre."] },
  { id:"horario", nombre:"Horario", puntos:["Guarda hora, aula, profesor y modalidad.","Abre una clase para ver todos sus detalles.","Compara horarios con tus amistades."] },
  { id:"tiempo-estudio", nombre:"Tiempo de estudio", puntos:["Abre una materia y toca Iniciar sesión.","Usa bloques personalizados aunque no tengas plan.","Consulta historial y estadísticas de todos tus semestres."] },
  { id:"semestres", nombre:"Semestres", puntos:["Matricula materias de tu plan.","Registra criterios, asignaciones y notas.","Revisa proyecciones y el Wrapped al finalizar."] },
  { id:"comunidad", nombre:"Comunidad", puntos:["Organiza compañeros y docentes relacionados con tus materias.","Consulta valoraciones y contactos que otras personas decidieron compartir.","Compara horarios compartidos para encontrar espacios en común."] },
  { id:"finanzas", nombre:"Finanzas", puntos:["Registra ingresos y gastos desde el inicio.","Clasifica movimientos por categoría.","Asociarlos a un semestre es opcional."] },
  { id:"plan-estudios", nombre:"Plan de estudios", puntos:["Añade una o varias carreras.","Pega o importa la malla completa.","El plan alimenta la matrícula de Semestres."] },
  { id:"asistente", nombre:"Wapper", puntos:["Convierte mensajes en tareas, exámenes o eventos de Agenda.","Consulta fechas y pendientes con lenguaje natural.","Actívalo con tu clave personal de Gemini desde Ajustes."] },
  { id:"configuracion", nombre:"Ajustes", puntos:["Cambia idioma, apariencia, paleta y tamaño de texto.","Ordena la navegación y tus preferencias.","Puedes volver a esta guía cuando quieras."] },
];

const TEXTO_FLUJO = "El orden recomendado es: 1) agrega uno o más planes; 2) crea un semestre y matricula materias del plan; 3) con esas materias arma Horario y vincula actividades en Agenda; 4) inicia sesiones desde materias para tener estadísticas ordenadas por periodo. Tiempo también admite bloques personalizados. Wapper necesita Agenda y una clave de Gemini para automatizar tareas. Comunidad y Finanzas funcionan por separado; en Finanzas, el semestre es una clasificación opcional.";
let cerrarGuiaPlanActiva = null;
// El selector de logo queda DESACTIVADO en el onboarding (se elige desde Ajustes > Personalizar).
// El código del selector se conserva: poner en true para volver a mostrarlo.
const PERMITIR_LOGO_ONBOARDING = false;

function guardar() {
  const cfg = estado.datos?.configuracion;
  if (cfg) sellarTimestamp(cfg);
  if (!MODO_DEMO) marcarCambioPendiente();
}

/* ── Fondo del onboarding sincronizado con el tema real de la app ──────────
   El panel cubre toda la pantalla, así que su fondo debe salir del mismo lugar
   que el de la app (body/html, o --bg-header-solido si ambos son transparentes).
   Se vuelve a leer cada vez que cambian data-mode / data-palette / estilos
   inline de <html>, por lo que cubre también la paleta personalizada. */
function inyectarEstilosOnboarding() {
  if (document.getElementById("onboarding-tema-css")) return;
  const estilo = document.createElement("style");
  estilo.id = "onboarding-tema-css";
  estilo.textContent = `
.onboarding-overlay .onboarding-top,.onboarding-overlay .onboarding-layout,.onboarding-overlay .onboarding-contenido{background:transparent}
.onboarding-nota-error{margin:.5rem 0 0;font-size:.9rem;color:var(--danger,#e5484d)}
.onboarding-nota-error[hidden]{display:none}
.guia-plan-flotante{z-index:2147483001}
.guia-resaltador{position:fixed;inset:0;z-index:2147483000;pointer-events:none}
.guia-resaltador-lado{position:fixed;background:rgba(0,0,0,.58);pointer-events:auto}
.guia-resaltador-anillo{position:fixed;border-radius:12px;pointer-events:none;box-shadow:0 0 0 3px var(--accent-1,#8b5cf6),0 0 0 8px color-mix(in srgb,var(--accent-1,#8b5cf6) 30%,transparent),0 0 26px color-mix(in srgb,var(--accent-1,#8b5cf6) 55%,transparent)}
@keyframes onb-pulso{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--accent-1,#8b5cf6) 60%,transparent)}100%{box-shadow:0 0 0 12px transparent}}
.onboarding-chat{margin-top:1rem;padding:.9rem;border-radius:16px;border:1px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 30%,transparent);background:color-mix(in srgb,var(--accent-1,#8b5cf6) 6%,transparent)}
.onboarding-chat-etiqueta{margin:0 0 .65rem;font-size:.78rem;opacity:.7;letter-spacing:.02em}
.onboarding-chat-hilo{display:flex;flex-direction:column;gap:.5rem}
.onboarding-chat-burbuja{max-width:90%;padding:.55rem .8rem;border-radius:14px;font-size:.92rem;line-height:1.38}
.onboarding-chat-burbuja.yo{align-self:flex-end;border-bottom-right-radius:4px;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 24%,transparent);border:1px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 45%,transparent)}
.onboarding-chat-burbuja.wapper{align-self:flex-start;border-bottom-left-radius:4px;background:color-mix(in srgb,currentColor 9%,transparent)}
.onboarding-chat-items{display:flex;flex-direction:column;gap:.35rem;margin-top:.5rem}
.onboarding-chat-item{display:flex;gap:.55rem;align-items:baseline;padding:.4rem .6rem;border-radius:10px;font-size:.86rem;background:color-mix(in srgb,currentColor 8%,transparent);border-left:3px solid var(--accent-1,#8b5cf6)}
.onboarding-chat-item b{font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;opacity:.75}
.onboarding-chat-escribiendo{align-self:flex-start;padding:.5rem .8rem;border-radius:14px;background:color-mix(in srgb,currentColor 9%,transparent)}
.onboarding-chat-escribiendo span{display:inline-block;width:6px;height:6px;margin:0 2px;border-radius:50%;background:currentColor;opacity:.3;animation:onb-punto 1s infinite}
.onboarding-chat-escribiendo span:nth-child(2){animation-delay:.15s}.onboarding-chat-escribiendo span:nth-child(3){animation-delay:.3s}
@keyframes onb-punto{0%,80%,100%{opacity:.25;transform:translateY(0)}40%{opacity:.9;transform:translateY(-3px)}}
@media (prefers-reduced-motion:reduce){.onboarding-chat-escribiendo span{animation:none}}

.onb-maqueta,.onb-esquema{position:absolute;inset:0;z-index:2;overflow:hidden;border-radius:inherit;color:var(--text-primary,inherit);background-color:var(--onb-fondo,transparent);background-image:var(--onb-fondo-img,none);background-size:cover}
.onb-maqueta[hidden],.onb-esquema[hidden],.onb-toca[hidden],.onb-vivo[hidden]{display:none}
.onb-esquema{transition:opacity .3s ease}.onb-esquema.saliendo{opacity:0;pointer-events:none}
.onb-marco{display:flex;flex-direction:column;gap:10px;height:100%;padding:14px;box-sizing:border-box}
.onb-es-top{display:flex;align-items:center;gap:8px;font-weight:700;font-size:.95rem}
.onb-es-top i{width:10px;height:10px;border-radius:50%;background:var(--accent-1,#8b5cf6)}
.onb-bloque{background:var(--onb-tarjeta,color-mix(in srgb,currentColor 8%,transparent));border:1px solid var(--onb-borde,color-mix(in srgb,currentColor 14%,transparent));border-radius:14px;padding:10px;box-sizing:border-box}
.onb-fila3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
.onb-fila{display:flex;align-items:center;gap:8px;padding:5px 0}
.onb-fila .onb-barra{flex:1}
.onb-barra{height:8px;border-radius:6px;background:color-mix(in srgb,currentColor 18%,transparent)}
.onb-barra.acento{background:var(--gradient-accent,var(--accent-1,#8b5cf6))}
.onb-punto{width:10px;height:10px;border-radius:50%;flex:none;background:var(--accent-1,#8b5cf6)}
.onb-circulo{width:26px;height:26px;border-radius:50%;flex:none;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 40%,transparent)}
.onb-chip{height:18px;width:46px;border-radius:9px;flex:none;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 30%,transparent)}
.onb-stat{display:flex;flex-direction:column;gap:8px}
.onb-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:5px}
.onb-dia{aspect-ratio:1;border-radius:7px;background:color-mix(in srgb,currentColor 9%,transparent)}
.onb-dia.marca{background:var(--accent-1,#8b5cf6)}
.onb-semana{display:grid;grid-template-columns:repeat(5,1fr);gap:6px;flex:1;min-height:0}
.onb-col{display:flex;flex-direction:column;gap:6px}
.onb-clase{border-radius:9px;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 38%,transparent);border-left:3px solid var(--accent-1,#8b5cf6)}
.onb-centro{display:flex;justify-content:center;padding:6px 0}
.onb-aro{width:104px;height:104px;border-radius:50%;background:conic-gradient(var(--accent-1,#8b5cf6) 0 62%,color-mix(in srgb,currentColor 16%,transparent) 62% 100%);-webkit-mask:radial-gradient(circle,transparent 54%,#000 55%);mask:radial-gradient(circle,transparent 54%,#000 55%)}
.onb-grafica{display:flex;align-items:flex-end;gap:7px;height:96px}
.onb-grafica i{flex:1;border-radius:6px 6px 2px 2px;background:var(--gradient-accent,var(--accent-1,#8b5cf6))}
.onb-burbuja{max-width:78%;height:34px;border-radius:14px;background:color-mix(in srgb,currentColor 12%,transparent)}
.onb-burbuja.yo{align-self:flex-end;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 34%,transparent)}
.onb-interruptor{width:30px;height:16px;border-radius:9px;flex:none;background:var(--accent-1,#8b5cf6);position:relative}
.onb-interruptor::after{content:"";position:absolute;right:2px;top:2px;width:12px;height:12px;border-radius:50%;background:#fff}
.onb-m-cuerpo{display:flex;height:100%}
.onb-m-lado{width:46px;flex:none;display:flex;flex-direction:column;align-items:center;gap:12px;padding:14px 0;background:var(--onb-tarjeta,color-mix(in srgb,currentColor 8%,transparent));border-right:1px solid var(--onb-borde,color-mix(in srgb,currentColor 14%,transparent))}
.onb-m-lado i{width:20px;height:20px;border-radius:7px;background:color-mix(in srgb,currentColor 20%,transparent)}
.onb-m-lado i:first-child{background:var(--gradient-accent,var(--accent-1,#8b5cf6))}
.onb-m-principal{flex:1;min-width:0;display:flex;flex-direction:column;gap:10px;padding:14px;box-sizing:border-box}
.onb-m-cabecera{display:flex;align-items:center;justify-content:space-between;gap:8px}
.onb-m-cabecera b{font-size:1rem}
.onb-m-cabecera .btn{pointer-events:none;padding:.3rem .8rem;min-height:0;font-size:.8rem}
.onb-m-rejilla{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.onb-m-nota{margin:0;font-size:.74rem;opacity:.65}
.onb-r{flex:1;min-height:0;display:flex;flex-direction:column;gap:8px;width:100%;max-width:640px;margin:0 auto;overflow:hidden;font-size:.8rem;line-height:1.25}
.onb-r b{font-weight:700}
.onb-r-m{opacity:.65;font-size:.72rem}
.onb-r-fila{display:flex;align-items:center;gap:8px}
.onb-r-sp{justify-content:space-between}
.onb-r-card{display:flex;flex-direction:column;gap:7px}
.onb-r-dia{margin-top:2px}
.onb-r-pills{display:flex;gap:4px;padding:3px;border-radius:12px;background:color-mix(in srgb,currentColor 8%,transparent)}
.onb-r-pills span{flex:1;text-align:center;padding:5px 6px;border-radius:9px;font-weight:600;font-size:.74rem}
.onb-r-pills .on{background:var(--accent-1,#8b5cf6);color:var(--on-accent,#fff)}
.onb-r-prog{height:6px;border-radius:4px;background:color-mix(in srgb,currentColor 16%,transparent);overflow:hidden}
.onb-r-prog i{display:block;height:100%;background:var(--accent-1,#8b5cf6)}
.onb-r-item{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent);border-left:3px solid var(--c,var(--accent-1,#8b5cf6))}
.onb-r-item>div{flex:1;min-width:0}
.onb-r-item b,.onb-r-item small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.onb-r-item small{opacity:.65;font-size:.7rem}
.onb-r-persona{border-left:0}
.onb-r-tag{flex:none;font-size:.66rem;font-weight:700;padding:1px 7px;border-radius:999px;border:1px solid var(--c,var(--accent-1,#8b5cf6));color:var(--c,var(--accent-1,#8b5cf6))}
.onb-r-btn{flex:none;padding:6px 14px;border-radius:999px;font-weight:700;font-size:.74rem;background:var(--accent-1,#8b5cf6);color:var(--on-accent,#fff)}
.onb-r-btn.s{background:color-mix(in srgb,currentColor 10%,transparent);color:inherit}
.onb-r-av{width:28px;height:28px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:.7rem;background:color-mix(in srgb,var(--c,var(--accent-1,#8b5cf6)) 35%,transparent)}
.onb-r-cab{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 12px}
.onb-r-centro{display:flex;flex-direction:column;align-items:center;text-align:center;gap:1px;flex:1;min-width:0}
.onb-r-mas{width:30px;height:30px;border-radius:50%;flex:none;display:grid;place-items:center;font-size:1.05rem;font-weight:700;background:var(--accent-1,#8b5cf6);color:var(--on-accent,#fff)}
.onb-r-eng{font-size:1.1rem;opacity:.75;flex:none;padding:0 4px}
.onb-r-stat{display:flex;flex-direction:column;align-items:center;gap:2px}
.onb-r-stat b{font-size:1.05rem}
.onb-r-estrellas{flex:none;color:var(--amber,#d99a00)}
.onb-r-mas-v{flex:none;color:#22a06b}.onb-r-menos{flex:none;color:#e5484d}
.onb-r-horario{padding:6px}
.onb-r-hor{display:grid;grid-template-columns:34px repeat(5,minmax(0,1fr));grid-template-rows:20px repeat(7,30px);font-size:.62rem;background:repeating-linear-gradient(to bottom,transparent 0 29px,color-mix(in srgb,currentColor 10%,transparent) 29px 30px) 0 20px/100% 30px no-repeat}
.onb-r-hd{text-align:center;font-weight:700;opacity:.8}
.onb-r-hh{opacity:.55;padding:2px 4px 0 0;text-align:right}
.onb-r-blq{margin:1px;padding:2px 4px;border-radius:6px;overflow:hidden;background:color-mix(in srgb,var(--c) 30%,transparent);border-left:3px solid var(--c)}
.onb-r-blq b,.onb-r-blq small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.onb-r-blq small{opacity:.7}
.onb-r-aro{position:relative;width:104px;height:104px}
.onb-r-aro .onb-aro{position:absolute;inset:0}
.onb-r-tiempo{position:absolute;inset:0;display:grid;place-items:center;font-size:1.25rem;font-weight:800}
.onb-r-paleta{display:flex;gap:10px}
.onb-r-paleta i{width:24px;height:24px;border-radius:50%}
.onb-r-hilo{display:flex;flex-direction:column;gap:7px}
.onb-r-msg{max-width:80%;padding:7px 11px;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;background:color-mix(in srgb,currentColor 10%,transparent)}
.onb-r-msg.yo{align-self:flex-end;border-radius:14px;border-bottom-right-radius:4px;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 30%,transparent)}
.onb-r-entrada{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 14px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent)}
/* Lado izquierdo del onboarding (progreso, texto y botones): fondo PLANO y fijo, igual que en Optimizado.
   Claro = #fbfbfe · Oscuro = #080808 · Color = el fondo liso de la paleta (--onb-izq, ver colorLadoIzquierdo). No cambia con Fancy. */
.onboarding-overlay .onboarding-copy,.onboarding-overlay .onboarding-top,.onboarding-overlay .onboarding-acciones{background:var(--onb-izq,#080808)!important;background-image:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
.onboarding-overlay .onboarding-copy,.onboarding-overlay .onboarding-copy *{text-shadow:none!important}
.onboarding-overlay .onboarding-copy h1{background:none!important;-webkit-text-fill-color:currentColor!important;filter:none!important}
.onb-toca{position:absolute;left:50%;bottom:14px;z-index:4;display:flex;align-items:center;gap:.55rem;padding:.6rem 1.05rem;border-radius:999px;font:inherit;font-size:.86rem;font-weight:700;cursor:pointer;color:var(--text-primary,inherit);background:color-mix(in srgb,var(--bg-panel,#222) 94%,transparent);border:1px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 60%,transparent);box-shadow:0 8px 24px rgba(0,0,0,.3);transform:translateX(-50%);-webkit-tap-highlight-color:transparent}
.onb-toca:disabled{cursor:progress;opacity:.9}
.onb-toca i{width:9px;height:9px;border-radius:50%;background:var(--accent-1,#8b5cf6);animation:onb-pulso 1.6s ease-out infinite}
.onb-toca.cargando i{animation:onb-giro .8s linear infinite;background:none;border:2px solid var(--accent-1,#8b5cf6);border-right-color:transparent}
@keyframes onb-giro{to{transform:rotate(360deg)}}
.onb-vivo{position:absolute;top:10px;right:10px;z-index:4;display:flex;align-items:center;gap:.4rem;padding:.25rem .65rem;border-radius:999px;font-size:.74rem;font-weight:700;pointer-events:none;color:var(--text-primary,inherit);background:color-mix(in srgb,var(--bg-panel,#222) 90%,transparent);border:1px solid color-mix(in srgb,#22c55e 55%,transparent)}
.onb-vivo i{width:8px;height:8px;border-radius:50%;background:#22c55e}
.onboarding-preview-wrap .onboarding-preview{position:relative;z-index:1}
.onboarding-pager{display:none;align-items:center;justify-content:center;gap:.35rem;padding:.2rem 0;font-size:.78rem;color:var(--text-primary,inherit)}
.onboarding-pager button{width:24px;height:24px;padding:7px;border:0;border-radius:12px;background:color-mix(in srgb,currentColor 28%,transparent);background-clip:content-box;-webkit-tap-highlight-color:transparent}
.onboarding-pager button[aria-selected="true"]{width:38px;background-color:var(--accent-1,#8b5cf6)}
.onboarding-pager-texto{margin-left:.4rem;opacity:.8;animation:onb-empuje 2.2s ease-in-out infinite}
.onboarding-pager-texto.atras{animation-name:onb-empuje-atras}
@keyframes onb-empuje{0%,100%{transform:translateX(0)}50%{transform:translateX(-5px)}}
@keyframes onb-empuje-atras{0%,100%{transform:translateX(0)}50%{transform:translateX(5px)}}
/* Solo teléfono: primero la información; la vista previa es la página siguiente (desliza ← o usa los puntos). */
@media (max-width:760px){
  .onboarding-overlay .onboarding-panel[data-vista] .onboarding-layout{display:flex;flex-direction:column;min-height:0}
  .onboarding-overlay .onboarding-panel[data-vista="info"] .onboarding-copy{flex:1 1 auto;min-height:0;overflow:auto}
  .onboarding-overlay .onboarding-panel[data-vista="info"] .onboarding-preview-wrap{display:none}
  .onboarding-overlay .onboarding-panel[data-vista="preview"] .onboarding-copy{display:none}
  .onboarding-overlay .onboarding-panel[data-vista="preview"] .onboarding-preview-wrap{display:block;position:relative;flex:1 1 auto;width:100%;min-height:340px}
  .onboarding-overlay .onboarding-panel[data-vista="preview"] .onboarding-preview{width:100%;height:100%;border:0}
  .onboarding-overlay .onboarding-panel[data-vista] .onboarding-pager{display:flex}
}
@media (prefers-reduced-motion:reduce){.onb-toca i,.onb-toca.cargando i,.onboarding-pager-texto{animation:none}.onb-esquema{transition:none}}
`;
  document.head.append(estilo);
}

/* ── Resaltador de guías ────────────────────────────────────────────────────
   Dibuja el anillo y el oscurecimiento en capas fijas sobre toda la app, así que
   nunca lo recorta el overflow del contenedor del botón. Los cuatro paneles que
   rodean al objetivo capturan los clics: solo el elemento resaltado queda activo. */
function crearResaltador() {
  const raiz = document.createElement("div");
  raiz.className = "guia-resaltador"; raiz.setAttribute("aria-hidden", "true"); raiz.style.display = "none";
  const lados = [0, 1, 2, 3].map(() => { const d = document.createElement("div"); d.className = "guia-resaltador-lado"; return d; });
  const anillo = document.createElement("div"); anillo.className = "guia-resaltador-anillo";
  raiz.append(...lados, anillo); document.body.append(raiz);
  let objetivo = null, raf = 0, ultimo = "", oculto = false;
  const margen = 6;
  const poner = (el, x, y, w, h) => { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = Math.max(0, w) + "px"; el.style.height = Math.max(0, h) + "px"; };
  const medir = () => {
    raf = requestAnimationFrame(medir);
    if (!objetivo || oculto || !objetivo.isConnected) { raiz.style.display = "none"; ultimo = ""; return; }
    const r = objetivo.getBoundingClientRect();
    if (!r.width && !r.height) { raiz.style.display = "none"; ultimo = ""; return; }
    const firma = `${r.left}|${r.top}|${r.width}|${r.height}|${innerWidth}|${innerHeight}`;
    if (firma === ultimo) return;
    ultimo = firma; raiz.style.display = "";
    const x = Math.max(0, r.left - margen), y = Math.max(0, r.top - margen);
    const w = Math.min(innerWidth - x, r.width + margen * 2), h = Math.min(innerHeight - y, r.height + margen * 2);
    poner(lados[0], 0, 0, innerWidth, y);
    poner(lados[1], 0, y + h, innerWidth, innerHeight - (y + h));
    poner(lados[2], 0, y, x, h);
    poner(lados[3], x + w, y, innerWidth - (x + w), h);
    poner(anillo, x, y, w, h);
  };
  const alClic = (ev) => {
    // Un botón puede abrir un diálogo propio: se libera el bloqueo para no taparlo.
    if (ev.target?.closest?.("button,a,[role='button']")) { oculto = true; }
  };
  return {
    apuntar(el) {
      objetivo?.removeEventListener("click", alClic, true);
      objetivo = el || null; oculto = false; ultimo = "";
      objetivo?.addEventListener("click", alClic, true);
      if (!raf) raf = requestAnimationFrame(medir);
    },
    ocultar() { oculto = true; },
    quitar() { objetivo?.removeEventListener("click", alClic, true); objetivo = null; cancelAnimationFrame(raf); raf = 0; raiz.remove(); },
  };
}

/* Aparición encadenada (1, luego 2, luego 3…) con Web Animations. Devuelve los ms totales. */
function revelarEnCadena(lista, { inicio = 260, paso = 420, duracion = 480 } = {}) {
  const items = [...lista.children];
  if (!items.length || globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches || typeof items[0].animate !== "function") return 0;
  items.forEach((el, i) => el.animate(
    [{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: duracion, delay: inicio + i * paso, easing: "cubic-bezier(.22,.8,.3,1)", fill: "both" }
  ));
  return inicio + (items.length - 1) * paso + duracion;
}

function esColorVisible(color) {
  if (!color || color === "transparent") return false;
  const m = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return true;
  const partes = m[1].split(/[,/\s]+/).filter(Boolean);
  return !(partes.length >= 4 && parseFloat(partes[3]) === 0);
}

function leerFondoDeLaApp() {
  const contenedores = [...document.querySelectorAll("#app, .app, .app-container, .app-shell, .main-content")].filter((el) => !el.closest(".onboarding-overlay"));
  const estilos = [document.body, document.documentElement, ...contenedores].map((el) => getComputedStyle(el));
  const fuente = estilos.find((e) => esColorVisible(e.backgroundColor) || e.backgroundImage !== "none") || estilos[0];
  const color = esColorVisible(fuente.backgroundColor)
    ? fuente.backgroundColor
    : (getComputedStyle(document.documentElement).getPropertyValue("--bg-header-solido").trim() || "Canvas");
  return { color, imagen: fuente.backgroundImage, tamano: fuente.backgroundSize, posicion: fuente.backgroundPosition, repetir: fuente.backgroundRepeat };
}

/* Color de las "tarjetas principales": se lee de una .glass-card real de la app
   (sonda oculta), así que la tarjeta del onboarding cambia con tema y paleta. */
function leerFondoTarjeta() {
  const sonda = document.createElement("div");
  sonda.className = "glass-card";
  sonda.style.cssText = "position:fixed;left:-9999px;top:0;width:8px;height:8px;pointer-events:none;visibility:hidden";
  document.body.append(sonda);
  const e = getComputedStyle(sonda);
  const salida = { color: e.backgroundColor, imagen: e.backgroundImage, borde: e.borderTopColor };
  sonda.remove();
  if (!esColorVisible(salida.color) && salida.imagen === "none") {
    salida.color = getComputedStyle(document.documentElement).getPropertyValue("--bg-panel").trim() || "";
  }
  return salida;
}

/* Fondo del lado izquierdo: fijo por modo (no depende de Fancy/Optimizado ni de la paleta, salvo en "Color",
   donde se usa el fondo liso de la paleta elegida: exactamente lo que se ve en Optimizado). */
function colorLadoIzquierdo() {
  const modo = document.documentElement.getAttribute("data-mode");
  if (modo === "light") return "#fbfbfe";
  if (modo === "true-dark") return "#080808";
  const raiz = getComputedStyle(document.documentElement);
  const opaco = (c) => { if (!c) return false; const m = c.match(/^rgba\(([^)]+)\)$/i); if (!m) return true; const p = m[1].split(/[,/\s]+/).filter(Boolean); return p.length < 4 || parseFloat(p[3]) >= 1; };
  const canvas = raiz.getPropertyValue("--bg-canvas").trim();
  if (opaco(canvas)) return canvas;
  return raiz.getPropertyValue("--bg-header-solido").trim() || "#10111a";
}

function crearSincronizadorFondo(overlay, panel, tarjeta) {
  let raf = 0, timer = 0;
  const aplicar = () => {
    const f = leerFondoDeLaApp();
    [overlay, panel].forEach((el) => {
      el.style.backgroundColor = f.color; el.style.backgroundImage = f.imagen;
      el.style.backgroundSize = f.tamano; el.style.backgroundPosition = f.posicion;
      el.style.backgroundRepeat = f.repetir; el.style.backgroundAttachment = "fixed";
    });
    overlay.style.setProperty("--onb-fondo", f.color); overlay.style.setProperty("--onb-fondo-img", f.imagen);
    const t = leerFondoTarjeta();
    overlay.style.setProperty("--onb-tarjeta", esColorVisible(t.color) ? t.color : "transparent");
    if (esColorVisible(t.borde)) overlay.style.setProperty("--onb-borde", t.borde);
    overlay.style.setProperty("--onb-izq", colorLadoIzquierdo()); // lado izquierdo plano (la tarjeta del texto ya no copia el vidrio de la app)
  };
  // Se relee en el siguiente frame y otra vez tras las transiciones CSS de color.
  const programar = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = requestAnimationFrame(aplicar); timer = setTimeout(aplicar, 450); };
  const observador = new MutationObserver(programar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-palette", "data-rendimiento", "style", "class"] });
  if (document.body) observador.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-mode"] });
  aplicar();
  return { programar, detener() { observador.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); } };
}

/* ── Vista previa sin cargar la app ────────────────────────────────────────
   Maqueta (Personalizar) y esquemas (cada «Conoce…»): puro DOM + CSS con las variables
   reales del tema, así cambian al instante con paleta y modo y casi no pesan. */
function elDiv(clase, ...hijos) { const d = document.createElement("div"); d.className = clase; hijos.forEach((h) => h && d.append(h)); return d; }
const barra = (ancho, extra = "") => { const b = elDiv(`onb-barra ${extra}`.trim()); b.style.width = `${ancho}%`; return b; };
const repetir = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const filaEsquema = (anchoBarra = 70, conChip = false) => elDiv("onb-fila", elDiv("onb-punto"), barra(anchoBarra), conChip ? elDiv("onb-chip") : null);
const columnaClases = (...alturas) => elDiv("onb-col", ...alturas.map((h) => { const c = elDiv("onb-clase"); c.style.height = `${h}px`; return c; }));
const graficaBarras = (alturas) => elDiv("onb-grafica", ...alturas.map((h) => { const i = document.createElement("i"); i.style.height = `${h}%`; return i; }));

function construirMaqueta() {
  const raiz = elDiv("onb-maqueta"); raiz.setAttribute("aria-hidden", "true"); raiz.hidden = true;
  const lado = elDiv("onb-m-lado", ...repetir(5, () => document.createElement("i")));
  const titulo = document.createElement("b"); titulo.textContent = traducirTextoInterfaz("Así se verá tu app");
  const boton = document.createElement("span"); boton.className = "btn btn-primary"; boton.textContent = traducirTextoInterfaz("Agregar");
  const nota = document.createElement("p"); nota.className = "onb-m-nota"; nota.textContent = traducirTextoInterfaz("Vista previa de tu tema y paleta");
  raiz.append(elDiv("onb-m-cuerpo", lado, elDiv("onb-m-principal",
    elDiv("onb-m-cabecera", titulo, boton),
    elDiv("onb-m-rejilla",
      elDiv("onb-bloque", graficaBarras([45, 70, 52, 88, 64, 78])),
      elDiv("onb-bloque", filaEsquema(80), filaEsquema(55), filaEsquema(68))),
    elDiv("onb-bloque", filaEsquema(85, true), filaEsquema(60, true)),
    nota)));
  return raiz;
}

/* ── Esquemas de «Conoce…» ─────────────────────────────────────────────────
   Cada sección se dibuja como se ve de verdad (mismos encabezados, pastillas, tarjetas y etiquetas),
   pero con datos de ejemplo y SOLO DOM + CSS estático: sin imágenes, sin animaciones y sin cargar la app.
   Los textos fijos pasan por traducirTextoInterfaz; los nombres de ejemplo (materias, personas) no se traducen. */
const ACENTO = "var(--accent-1,#8b5cf6)", ROJO = "#e5484d", AMBAR = "#d99a00", VERDE = "#22a06b", AZUL = "#3a7de2", MORADO = "#8b4ae0", NARANJA = "#f28a2b";
function nodo(tag, clase, texto, hijos) {
  const e = document.createElement(tag);
  if (clase) e.className = clase;
  if (texto != null) e.textContent = traducirTextoInterfaz(texto);
  (hijos || []).forEach((h) => h && e.append(h));
  return e;
}
const rFila = (clase, ...h) => nodo("div", `onb-r-fila ${clase || ""}`.trim(), null, h);
const rCard = (...h) => nodo("div", "onb-bloque onb-r-card", null, h);
const rNegrita = (t) => nodo("b", "", t);
const rSuave = (t) => nodo("span", "onb-r-m", t);
const rTag = (t, color) => { const e = nodo("span", "onb-r-tag", t); if (color) e.style.setProperty("--c", color); return e; };
const rBoton = (t, suave) => nodo("span", suave ? "onb-r-btn s" : "onb-r-btn", t);
function rProg(pct, color) { const p = nodo("div", "onb-r-prog", null, [document.createElement("i")]); p.firstChild.style.width = `${pct}%`; if (color) p.firstChild.style.background = color; return p; }
function rPills(opciones, activo) {
  return nodo("div", "onb-r-pills", null, opciones.map((t, i) => nodo("span", i === activo ? "on" : "", t)));
}
function rItem(titulo, sub, color, ...derecha) {
  const it = nodo("div", "onb-r-item", null, [nodo("div", "", null, [nodo("b", "", titulo), sub ? nodo("small", "", sub) : null]), ...derecha]);
  if (color) it.style.setProperty("--c", color);
  return it;
}
function rAvatar(iniciales, color) { const a = nodo("span", "onb-r-av", iniciales); a.style.setProperty("--c", color); return a; }
function rPersona(iniciales, nombre, sub, color, ...derecha) {
  return nodo("div", "onb-r-item onb-r-persona", null, [rAvatar(iniciales, color), nodo("div", "", null, [nodo("b", "", nombre), nodo("small", "", sub)]), ...derecha]);
}
function rStat(valor, etiqueta, color) { const s = nodo("div", "onb-r-stat", null, [nodo("b", "", valor), rSuave(etiqueta)]); if (color) s.firstChild.style.color = color; return s; }

function esquemaHorario() {
  const g = nodo("div", "onb-r-hor");
  ["", "Lun", "Mar", "Mié", "Jue", "Vie"].forEach((d, i) => { const c = nodo("span", "onb-r-hd", d); c.style.gridColumn = String(i + 1); c.style.gridRow = "1"; g.append(c); });
  ["7:00", "8:00", "9:00", "10:00", "11:00", "12:00", "1:00"].forEach((h, i) => { const c = nodo("span", "onb-r-hh", h); c.style.gridColumn = "1"; c.style.gridRow = String(i + 2); g.append(c); });
  // [columna, fila inicial, fila final, materia, aula, color]
  [[2, 2, 4, "Cálculo I", "B-201", AZUL], [2, 5, 7, "Programación", "Lab 3", VERDE], [3, 3, 5, "Física", "A-105", ROJO],
   [4, 2, 4, "Cálculo I", "B-201", AZUL], [4, 5, 7, "Programación", "Virtual", VERDE], [5, 3, 5, "Física", "A-105", ROJO],
   [5, 6, 8, "Inglés", "C-12", MORADO], [6, 4, 6, "Programación", "Lab 3", VERDE]].forEach(([col, a, b, nombre, aula, color]) => {
    const bl = nodo("div", "onb-r-blq", null, [nodo("b", "", nombre), nodo("small", "", aula)]);
    bl.style.gridColumn = String(col); bl.style.gridRow = `${a} / ${b}`; bl.style.setProperty("--c", color); g.append(bl);
  });
  return g;
}

function contenidoEsquema(id) {
  const c = [];
  switch (id) {
    case "resumen":
      c.push(rCard(rFila("onb-r-sp", rNegrita("Semana 9 de 18"), rSuave("Faltan 65 días")), rProg(50)),
        rCard(rFila("onb-r-sp", rNegrita("Estudio de hoy"), rSuave("45 min de 3 h")), rProg(25),
          rFila("onb-r-sp", nodo("span", "", "Cálculo I"), rSuave("0 / 1 h")), rFila("onb-r-sp", nodo("span", "", "Programación"), rSuave("0 / 1 h")), rFila("onb-r-sp", nodo("span", "", "Física"), rSuave("0 / 1 h"))),
        rCard(rNegrita("Clases de hoy"), rItem("9:30 a. m.", "Programación", AZUL, rTag("Virtual", AZUL))),
        rCard(rNegrita("Próximos exámenes"), rItem("I Parcial", "Cálculo I", ROJO, rSuave("3:00 p. m."), rTag("Examen", ROJO)), rItem("Quiz", "Física", AMBAR, rSuave("9:30 a. m."), rTag("Examen", AMBAR))));
      break;
    case "agenda":
      c.push(rPills(["Lista", "Calendario", "Cronograma"], 0),
        nodo("div", "onb-bloque onb-r-cab", null, [nodo("span", "onb-r-mas", "+"), nodo("div", "onb-r-centro", null, [rSuave("Semestre 2026-2"), rNegrita("Semana 9"), rSuave("Hoy")]), nodo("span", "onb-r-eng", "⚙️")]),
        rFila("onb-r-sp onb-r-dia", rNegrita("Hoy"), rSuave("2 pendientes")),
        rItem("Taller de integrales", "Cálculo I", ACENTO, rSuave("11:59 p. m."), rTag("Tarea")),
        rItem("I Parcial", "Programación", ROJO, rSuave("3:00 p. m."), rTag("Examen", ROJO)),
        rFila("onb-r-sp onb-r-dia", rNegrita("Mañana"), rSuave("2 pendientes")),
        rItem("Entrega del proyecto final", "Base de datos", AMBAR, rSuave("8:00 a. m."), rTag("Proyecto", AMBAR)),
        rItem("Charla de empleabilidad", "Universidad", VERDE, rSuave("4:00 p. m."), rTag("Evento", VERDE)));
      break;
    case "horario":
      c.push(nodo("div", "onb-bloque onb-r-cab", null, [nodo("span", "onb-r-eng", "‹"), nodo("div", "onb-r-centro", null, [rSuave("Semestre 2026-2"), rNegrita("Semana 9")]), nodo("span", "onb-r-eng", "›")]),
        rFila("onb-r-sp", rBoton("+ Agregar"), rSuave("⬇  ⛶"), rBoton("Amigos", true)),
        nodo("div", "onb-bloque onb-r-horario", null, [esquemaHorario()]));
      break;
    case "tiempo-estudio": {
      const aro = nodo("div", "onb-r-aro", null, [nodo("div", "onb-aro"), nodo("span", "onb-r-tiempo", "25:00")]);
      c.push(rCard(rFila("onb-r-sp", rNegrita("Cálculo I"), rSuave("Sesión de estudio")), nodo("div", "onb-centro", null, [aro]), nodo("div", "onb-r-centro", null, [rBoton("Iniciar sesión")])),
        rCard(rNegrita("Materias"),
          rFila("onb-r-sp", nodo("span", "", "Cálculo I"), rSuave("1 h 20 min")), rProg(70, AZUL),
          rFila("onb-r-sp", nodo("span", "", "Programación"), rSuave("45 min")), rProg(40, VERDE),
          rFila("onb-r-sp", nodo("span", "", "Física"), rSuave("20 min")), rProg(18, ROJO)));
      break;
    }
    case "semestres":
      c.push(rCard(rFila("onb-r-sp", rNegrita("Semestre 2026-2"), rTag("En curso", VERDE)),
          nodo("div", "onb-fila3", null, [rStat("5", "Materias"), rStat("16", "Créditos"), rStat("8.7", "Promedio", VERDE)])),
        rItem("Cálculo I", "4 créditos", AZUL, nodo("b", "", "8.5")), rItem("Programación", "4 créditos", VERDE, nodo("b", "", "9.1")),
        rItem("Física", "3 créditos", ROJO, nodo("b", "", "7.8")), rItem("Inglés", "2 créditos", MORADO, nodo("b", "", "9.5")));
      break;
    case "comunidad":
      c.push(rPills(["Compañeros", "Docentes", "Horarios"], 0),
        rPersona("AT", "Ana Torres", "Cálculo I · Programación", AZUL, rTag("2 materias")),
        rPersona("LM", "Luis Mora", "Física", ROJO, rTag("1 materia")),
        rFila("onb-r-sp onb-r-dia", rNegrita("Docentes"), rSuave("Valoraciones")),
        rPersona("PR", "Prof. Rivas", "Cálculo I", VERDE, nodo("b", "onb-r-estrellas", "★ 4.6")),
        rPersona("PS", "Prof. Salas", "Programación", MORADO, nodo("b", "onb-r-estrellas", "★ 4.2")));
      break;
    case "finanzas":
      c.push(nodo("div", "onb-fila3", null, [rStat("+$450", "Ingresos", VERDE), rStat("−$320", "Gastos", ROJO), rStat("$130", "Balance")].map((s) => rCard(s))),
        rCard(rNegrita("Movimientos del mes"), graficaBarras([40, 62, 48, 80, 55, 70])),
        rItem("Beca", "Ingreso", VERDE, nodo("b", "onb-r-mas-v", "+$200")), rItem("Libros", "Educación", ROJO, nodo("b", "onb-r-menos", "−$35")), rItem("Almuerzo", "Comida", ROJO, nodo("b", "onb-r-menos", "−$12")));
      break;
    case "plan-estudios":
      c.push(rCard(rFila("onb-r-sp", rNegrita("Ingeniería de Sistemas"), rSuave("18 de 45 aprobadas")), rProg(40)),
        rFila("onb-r-sp onb-r-dia", rNegrita("Nivel 1"), rSuave("Aprobadas")),
        rItem("Cálculo I", "4 créditos", VERDE, rTag("Aprobada", VERDE)), rItem("Programación I", "4 créditos", VERDE, rTag("Aprobada", VERDE)),
        rFila("onb-r-sp onb-r-dia", rNegrita("Nivel 2"), rSuave("En curso")),
        rItem("Cálculo II", "4 créditos", AZUL, rTag("En curso", AZUL)), rItem("Física", "3 créditos", AMBAR, rTag("Pendiente", AMBAR)));
      break;
    case "asistente":
      c.push(nodo("div", "onb-r-hilo", null, [
        nodo("div", "onb-r-msg yo", "Examen de Cálculo el viernes a las 3 pm"),
        nodo("div", "onb-r-msg", "Listo, lo agregué a tu Agenda."),
        rItem("Examen de Cálculo", "Cálculo I · viernes 3:00 p. m.", ROJO, rTag("Examen", ROJO)),
        nodo("div", "onb-r-msg yo", "¿Qué tengo pendiente esta semana?"),
        nodo("div", "onb-r-msg", "Tienes 2 tareas y 1 examen.")]),
        nodo("div", "onb-r-entrada", null, [nodo("span", "onb-r-m", "Escribe un mensaje…"), nodo("span", "onb-r-mas", "➤")]));
      break;
    case "configuracion":
      c.push(rCard(rNegrita("Apariencia"), rPills(["Claro", "Color", "Oscuro"], 1)),
        rCard(rNegrita("Paleta"), nodo("div", "onb-r-paleta", null, ["azul", "indigo", "morado", "rosado", "rojo", "verde"].map((p) => { const d = document.createElement("i"); d.style.background = (COLORES_PREVIEW_PALETA[p] || ["#8b5cf6"])[0]; return d; }))),
        rCard(rNegrita("Tamaño del texto"), rPills(["Pequeño", "Mediano", "Grande"], 1)),
        rCard(rFila("onb-r-sp", nodo("span", "", "Idioma"), rSuave("Español")), rFila("onb-r-sp", nodo("span", "", "Notificaciones"), nodo("span", "onb-interruptor")), rFila("onb-r-sp", nodo("span", "", "Animación de apertura"), nodo("span", "onb-interruptor"))));
      break;
    default:
      c.push(rCard(rProg(70), rProg(50)));
  }
  return c;
}

function construirEsquema(id, nombre) {
  const titulo = document.createElement("span"); titulo.textContent = traducirTextoInterfaz(nombre);
  const cuerpo = nodo("div", "onb-r", null, contenidoEsquema(id));
  return elDiv("onb-marco", elDiv("onb-es-top", document.createElement("i"), titulo), cuerpo);
}

function mostrarOnboardingNuevoUsuario({ navegar, toast } = {}) {
  // Nunca dentro del iframe de vista previa (evita onboarding anidado) ni duplicado.
  if (PREVIEW_DEMO || document.querySelector(".onboarding-overlay") || !estado.datos?.configuracion || (estado.datos.configuracion.onboarding_v1_completado !== false && !(MODO_DEMO && !PREVIEW_DEMO))) return false;
  const cfg = estado.datos.configuracion;
  const secciones = SECCIONES_TUTORIAL.filter(({id}) => document.getElementById(`seccion-${id}`));
  const cuentaConDatos = !MODO_DEMO && Object.entries(estado.datos).some(([clave, valor]) =>
    Array.isArray(valor) && valor.length > 0 && clave !== "planes_estudio_demo"
  );
  const tienePlanArmado = Boolean(estado.datos.planes_estudio?.some((plan) => plan.materias?.length || plan.optativas_disponibles?.length));
  const faltaNombre = !(estado.datos.perfil?.nombre_preferido || estado.datos.perfil?.nombre || "").trim();
  let etapa = MODO_DEMO ? "nombre" : cuentaConDatos ? (faltaNombre ? "nombre" : (!cfg.paleta || !cfg.modo ? "personalizar" : "tour")) : "nombre", indice = 0;
  let modoPersonalizacion = MODO_DEMO ? (cfg.modo || "dark") : obtenerModoTemaLocal();
  let calidadPersonalizacion = obtenerModoDisenoLocal();
  // Fuente única de la paleta: la elegida o, si no hay, la que la app tiene aplicada.
  const paletaActual=()=>cfg.paleta||document.documentElement.dataset.palette||"azul";
  const coloresActuales=()=>paletaActual()==="personalizada"?cfg.paleta_personalizada?.colores:undefined;
  if(MODO_DEMO)aplicarPaleta(paletaActual(),modoPersonalizacion,coloresActuales());
  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  overlay.setAttribute("role","dialog"); overlay.setAttribute("aria-modal","true"); overlay.setAttribute("aria-labelledby","onboarding-titulo");
  const panel = document.createElement("section"); panel.className = "onboarding-panel";
  panel.innerHTML = '<header class="onboarding-top"><span class="onboarding-progreso"></span><button class="onboarding-cerrar" type="button" aria-label="Cerrar">×</button></header><div class="onboarding-layout"><div class="onboarding-copy"><h1 id="onboarding-titulo"></h1><div class="onboarding-contenido"></div></div><div class="onboarding-preview-wrap"><iframe class="onboarding-preview" title="Vista previa real de App Académica" data-analitica-ignorar></iframe></div></div><footer class="onboarding-acciones"></footer>';
  overlay.append(panel); document.body.append(overlay);
  inyectarEstilosOnboarding();
  const fondo=crearSincronizadorFondo(overlay,panel,panel.querySelector(".onboarding-copy"));
  const aplicarTemaAhora=()=>{aplicarPaleta(paletaActual(),modoPersonalizacion,coloresActuales());document.documentElement.setAttribute("data-mode",modoPersonalizacion);aplicarLogoApp();fondo.programar();};
  const progreso=panel.querySelector(".onboarding-progreso"), titulo=panel.querySelector("h1"), contenido=panel.querySelector(".onboarding-contenido"), acciones=panel.querySelector(".onboarding-acciones"), preview=panel.querySelector("iframe");
  let timersPreview=[], timersChat=[], cerrarListaTour=null, temporizadorTour=null, ctrlTour=null;
  // ── Vista previa en 3 modos ──────────────────────────────────────────────
  //  maqueta: miniatura CSS (Personalizar). No carga la app.
  //  esquema: dibujo ligero de la sección + «Toca para interactuar» (recorrido).
  //  vivo:    la app real en el iframe, solo si la persona lo pide (o se precargó en un equipo capaz).
  const wrapPreview=preview.closest(".onboarding-preview-wrap");
  if(getComputedStyle(wrapPreview).position==="static")wrapPreview.style.position="relative";
  preview.style.pointerEvents="none";preview.style.opacity="0"; // sin captura de scroll hasta que sea interactivo
  const maqueta=construirMaqueta();
  const esquema=document.createElement("div");esquema.className="onb-esquema";esquema.setAttribute("aria-hidden","true");esquema.hidden=true;
  const tocar=document.createElement("button");tocar.type="button";tocar.className="onb-toca";
  const textoToca=document.createElement("span");tocar.append(document.createElement("i"),textoToca);
  const insigniaVivo=document.createElement("div");insigniaVivo.className="onb-vivo";insigniaVivo.hidden=true;insigniaVivo.setAttribute("role","status");
  insigniaVivo.append(document.createElement("i"),document.createTextNode(traducirTextoInterfaz("Interactivo")));
  wrapPreview.append(maqueta,esquema,tocar,insigniaVivo);
  let modoVista="esquema",seccionVista=null,vivoPedido=false,iframeListo=false,temporizadorReveal=0,vigilanteReveal=0,idPrecarga=0,precargaConIdle=false;
  const secVista=()=>etapa==="wapper-config"?"asistente":(secciones[indice]?.id||"resumen");
  const pintarBotonToca=()=>{textoToca.textContent=traducirTextoInterfaz(vivoPedido?"Cargando demo…":"Toca para interactuar");tocar.disabled=vivoPedido;tocar.classList.toggle("cargando",vivoPedido);};
  const aplicarModoVista=(m)=>{
    modoVista=m;wrapPreview.dataset.modo=m;
    maqueta.hidden=m!=="maqueta";
    esquema.hidden=m!=="esquema";esquema.classList.remove("saliendo");
    tocar.hidden=m!=="esquema";insigniaVivo.hidden=m!=="vivo";
    preview.style.pointerEvents=m==="vivo"?"auto":"none";
    if(m!=="vivo"){preview.style.transition="none";preview.style.opacity="0";}
    pintarBotonToca();
  };
  // Aparece la demo real con un fundido mientras el esquema se desvanece.
  const revelarPreview=()=>{
    clearTimeout(vigilanteReveal);
    if(!vivoPedido&&modoVista!=="vivo")return; // precargada: sigue oculta hasta que la pidan
    vivoPedido=false;modoVista="vivo";wrapPreview.dataset.modo="vivo";
    esquema.classList.add("saliendo");tocar.hidden=true;insigniaVivo.hidden=false;
    preview.style.transition="opacity .32s ease";preview.style.opacity="1";preview.style.pointerEvents="auto";
    setTimeout(()=>{if(modoVista==="vivo")esquema.hidden=true;},340);
  };
  const activarVivo=()=>{
    if(modoVista!=="esquema"||vivoPedido)return;
    vivoPedido=true;pintarBotonToca();
    const sec=secVista();
    if(preview.dataset.seccion===sec&&iframeListo){actualizarPreview();setTimeout(revelarPreview,60);return;}
    cargarPreview(sec);
    // Si por red lenta no carga, se vuelve a ofrecer el toque en vez de quedarse cargando.
    clearTimeout(vigilanteReveal);vigilanteReveal=setTimeout(()=>{if(vivoPedido&&modoVista==="esquema"){vivoPedido=false;pintarBotonToca();}},15000);
  };
  tocar.addEventListener("click",activarVivo);
  // Precarga en segundo plano SOLO si el equipo y la red lo permiten (nunca en Optimizado, ahorro de datos, 2G/3G o poca RAM/CPU).
  const puedePrecargar=()=>{
    const c=navigator.connection;
    if(c?.saveData||["slow-2g","2g","3g"].includes(c?.effectiveType))return false;
    if((navigator.deviceMemory||4)<4||(navigator.hardwareConcurrency||4)<4)return false;
    return calidadPersonalizacion!=="optimizado";
  };
  const cancelarPrecarga=()=>{if(!idPrecarga)return;if(precargaConIdle&&"cancelIdleCallback" in window)cancelIdleCallback(idPrecarga);else clearTimeout(idPrecarga);idPrecarga=0;};
  const programarPrecarga=(sec)=>{
    cancelarPrecarga();
    if(!puedePrecargar()||preview.dataset.seccion===sec)return;
    const cargar=()=>{idPrecarga=0;if(overlay.isConnected&&modoVista==="esquema"&&secVista()===sec&&!vivoPedido&&preview.dataset.seccion!==sec)cargarPreview(sec);};
    precargaConIdle="requestIdleCallback" in window;
    idPrecarga=precargaConIdle?requestIdleCallback(cargar,{timeout:3500}):setTimeout(cargar,1800);
  };
  const prepararMaqueta=()=>{cancelarPrecarga();seccionVista="__maqueta";vivoPedido=false;aplicarModoVista("maqueta");};
  const prepararEsquema=(sec)=>{
    if(seccionVista!==sec){ // sección nueva: vuelve al dibujo (la demo anterior queda oculta)
      seccionVista=sec;vivoPedido=false;clearTimeout(vigilanteReveal);clearTimeout(temporizadorReveal);
      esquema.replaceChildren(construirEsquema(sec,secciones.find(x=>x.id===sec)?.nombre||"App Académica"));
      aplicarModoVista("esquema");
    }
    if(modoVista==="esquema")programarPrecarga(sec);
  };
  // ── Navegación bloqueada dentro de la demo mientras dura la guía (todas las secciones) ──
  const guiaBloqueaNavegacion=()=>etapa==="tour"||etapa==="personalizar"||etapa==="wapper-config";
  const bloquearNavegacionPreview=()=>{
    let doc,win;try{doc=preview.contentDocument;win=preview.contentWindow;}catch(_){return;}
    if(!doc?.head)return;
    const sec=preview.dataset.seccion||"resumen";
    let estilo=doc.getElementById("onboarding-bloqueo-nav");
    if(!estilo){estilo=doc.createElement("style");estilo.id="onboarding-bloqueo-nav";doc.head.append(estilo);}
    estilo.textContent=guiaBloqueaNavegacion()?`.btn-nav[data-seccion]:not([data-seccion="${sec}"]){pointer-events:none!important;opacity:.42}`:"";
    if(!doc.__onbNavGuard){
      doc.__onbNavGuard=true;
      // Captura: frena cualquier botón de navegación (teclado incluido) antes de que actúe.
      doc.addEventListener("click",(ev)=>{const nav=ev.target?.closest?.(".btn-nav[data-seccion]");if(nav&&guiaBloqueaNavegacion()&&nav.dataset.seccion!==preview.dataset.seccion){ev.preventDefault();ev.stopImmediatePropagation();}},true);
      // Los accesos rápidos del Resumen también navegan: se protege la función global si existe.
      try{const orig=win.mostrarSeccion;if(typeof orig==="function"&&!orig.__onbEnvuelta){const guardada=function(id,...resto){if(guiaBloqueaNavegacion()&&id!==preview.dataset.seccion)return;return orig.call(this,id,...resto);};guardada.__onbEnvuelta=true;win.mostrarSeccion=guardada;}}catch(_){}
    }
  };
  const actualizarPreview=()=>{
    bloquearNavegacionPreview();
    preview.contentWindow?.postMessage({
    type:"APP_PREVIEW_UPDATE", paleta:paletaActual(), modo:modoPersonalizacion,
    calidad:calidadPersonalizacion,
    colores:paletaActual()==="personalizada"?cfg.paleta_personalizada?.colores:null,
    logo:cfg.logo_app||"folder", logoData:cfg.logo_app_url||null,
    geminiKey:etapa==="wapper-config"?(cfg.gemini_api_key||null):null
    },location.origin);
  };
  // ── Teléfono (≤760px): primero la información; la vista previa es la página siguiente ──
  const consultaMovil=matchMedia("(max-width:760px)");
  const esMovil=()=>consultaMovil.matches;
  const hayVista=()=>etapa==="personalizar"||etapa==="tour"||etapa==="wapper-config";
  let vistaMovil="info",claveVistaMovil="";
  const pager=document.createElement("div");pager.className="onboarding-pager";
  const puntosPager=["info","preview"].map((v)=>{const b=document.createElement("button");b.type="button";b.setAttribute("role","tab");b.setAttribute("aria-label",traducirTextoInterfaz(v==="info"?"Información":"Vista previa"));b.addEventListener("click",()=>cambiarVista(v));return b;});
  const textoPager=document.createElement("span");textoPager.className="onboarding-pager-texto";
  pager.append(...puntosPager,textoPager);panel.querySelector(".onboarding-acciones").before(pager);
  const aplicarVistaMovil=()=>{
    if(!hayVista()){delete panel.dataset.vista;panel.classList.remove("onboarding-mostrar-preview");return;}
    panel.dataset.vista=vistaMovil;
    panel.classList.toggle("onboarding-mostrar-preview",esMovil()&&vistaMovil==="preview");
    puntosPager.forEach((b,i)=>b.setAttribute("aria-selected",String((i===0)===(vistaMovil==="info"))));
    textoPager.classList.toggle("atras",vistaMovil==="preview");
    textoPager.textContent=traducirTextoInterfaz(vistaMovil==="info"?"Desliza para previsualizar ›":"‹ Desliza para volver");
  };
  const cambiarVista=(v)=>{if(vistaMovil===v)return;vistaMovil=v;aplicarVistaMovil();};
  consultaMovil.addEventListener?.("change",aplicarVistaMovil);
  let toque=null,toqueBorde=null;
  const comenzarDeslizamiento=(ev)=>{toque=ev.touches.length===1?{x:ev.touches[0].clientX,y:ev.touches[0].clientY}:null;};
  const terminarDeslizamiento=(ev)=>{
    if(!toque)return;const t=ev.changedTouches[0];const dx=t.clientX-toque.x,dy=t.clientY-toque.y;toque=null;
    if(!esMovil()||!hayVista()||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.6)return;
    cambiarVista(dx<0?"preview":"info"); // derecha → izquierda abre la vista previa
  };
  // Dentro de la demo interactiva solo se vuelve con un deslizamiento desde el borde izquierdo (no se roba el scroll de la demo).
  const comenzarBorde=(ev)=>{const t=ev.touches[0];toqueBorde=ev.touches.length===1&&t.clientX<28?{x:t.clientX,y:t.clientY}:null;};
  const terminarBorde=(ev)=>{
    if(!toqueBorde)return;const t=ev.changedTouches[0];const dx=t.clientX-toqueBorde.x,dy=t.clientY-toqueBorde.y;toqueBorde=null;
    if(esMovil()&&vistaMovil==="preview"&&dx>70&&dx>Math.abs(dy)*1.6)cambiarVista("info");
  };
  panel.addEventListener("touchstart",comenzarDeslizamiento,{passive:true});
  panel.addEventListener("touchend",terminarDeslizamiento,{passive:true});
  preview.addEventListener("load",()=>{
    if(!preview.dataset.seccion)return; // el iframe vacío inicial no cuenta
    iframeListo=true;actualizarPreview();
    // Si la pidieron, se muestra tras un margen para que la demo aplique su tema final (sin destello).
    if(vivoPedido||modoVista==="vivo"){clearTimeout(temporizadorReveal);temporizadorReveal=setTimeout(revelarPreview,320);}
    let docTour;try{docTour=preview.contentDocument;}catch(_){}
    if(!docTour)return;
    docTour.addEventListener("touchstart",comenzarBorde,{passive:true});
    docTour.addEventListener("touchend",terminarBorde,{passive:true});
    const iniciarExploracao=()=>{if(etapa==="tour"&&matchMedia("(orientation:portrait)").matches)cerrarListaTour?.();};
    ["pointerdown","keydown","touchstart","wheel"].forEach(tipo=>docTour.addEventListener(tipo,iniciarExploracao,{once:true,capture:true}));
  });
  const boton=(texto,clase,fn)=>{const b=document.createElement("button");b.type="button";b.className=`btn ${clase}`;b.textContent=traducirTextoInterfaz(texto);b.addEventListener("click",fn);return b;};
  const texto=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=traducirTextoInterfaz(value);return e;};
  const construirChatEjemplo=(retraso=0)=>{
    const chat=document.createElement("section");chat.className="onboarding-chat";chat.setAttribute("aria-label",traducirTextoInterfaz("Ejemplo de conversación con Wapper"));
    chat.append(texto("p","onboarding-chat-etiqueta","Ejemplo de cómo conversa Wapper"));
    const hilo=document.createElement("div");hilo.className="onboarding-chat-hilo";hilo.setAttribute("aria-live","polite");chat.append(hilo);
    const guion=[
      {de:"yo",texto:"Tengo parcial de Estadística el viernes a las 8 a. m. y entrego el informe de Redes el lunes."},
      {de:"wapper",texto:"¡Listo! Ya los agregué a tu Agenda:",items:[["Examen","Estadística · viernes, 8:00 a. m."],["Entrega","Informe de Redes · lunes"]]},
      {de:"wapper",texto:"¿Quieres que te recuerde el parcial dos días antes?"},
      {de:"yo",texto:"Sí, por favor."},
      {de:"wapper",texto:"Hecho. Te avisaré el miércoles a las 8:00 a. m."},
    ];
    const reducir=matchMedia("(prefers-reduced-motion: reduce)").matches;
    const esperar=(ms)=>new Promise((ok)=>{if(reducir||!ms)return ok();timersChat.push(setTimeout(ok,ms));});
    const aparecer=(el)=>{if(!reducir&&typeof el.animate==="function")el.animate([{opacity:0,transform:"translateY(8px)"},{opacity:1,transform:"translateY(0)"}],{duration:320,easing:"ease-out"});};
    const pintarBurbuja=(m)=>{
      const b=document.createElement("div");b.className=`onboarding-chat-burbuja ${m.de}`;b.textContent=traducirTextoInterfaz(m.texto);
      if(m.items){const lista=document.createElement("div");lista.className="onboarding-chat-items";m.items.forEach(([tipo,detalle])=>{const fila=document.createElement("div");fila.className="onboarding-chat-item";const t=document.createElement("b");t.textContent=traducirTextoInterfaz(tipo);const d=document.createElement("span");d.textContent=traducirTextoInterfaz(detalle);fila.append(t,d);lista.append(fila);});b.append(lista);}
      hilo.append(b);aparecer(b);chat.scrollIntoView?.({block:"nearest",behavior:reducir?"auto":"smooth"});
    };
    (async()=>{
      await esperar(retraso);
      for(const m of guion){
        if(!chat.isConnected)return;
        if(m.de==="wapper"){
          const escribiendo=document.createElement("div");escribiendo.className="onboarding-chat-escribiendo";escribiendo.setAttribute("aria-hidden","true");escribiendo.append(document.createElement("span"),document.createElement("span"),document.createElement("span"));
          hilo.append(escribiendo);aparecer(escribiendo);await esperar(1000);escribiendo.remove();
        }else await esperar(350);
        if(!chat.isConnected)return;
        pintarBurbuja(m);await esperar(m.de==="yo"?700:900);
      }
    })();
    return chat;
  };
  const fin=(irAlPlan=false,irASemestres=false)=>{ctrlTour?.abort();fondo.detener();timersChat.forEach(clearTimeout);timersChat=[];cancelarPrecarga();consultaMovil.removeEventListener?.("change",aplicarVistaMovil);clearTimeout(temporizadorReveal);clearTimeout(vigilanteReveal);timersPreview.forEach(clearTimeout);timersPreview=[];clearTimeout(temporizadorTour);cfg.onboarding_v1_completado=true;cfg.tutoriales_secciones_vistas=cfg.tutoriales_secciones_vistas||{};if(irAlPlan)cfg.tutoriales_secciones_vistas["plan-estudios"]=true;if(irASemestres)cfg.tutoriales_secciones_vistas.semestres=true;guardar();overlay.remove();if(irAlPlan||irASemestres){const destino=irASemestres?"semestres":"plan-estudios";navegar?.(destino);setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:irASemestres,yaEnSemestres:irASemestres}),450);}else toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes generales."));};
  if (MODO_DEMO && !PREVIEW_DEMO) {
    const saltar=boton("Saltar inicio","btn-secondary",()=>{cfg.tutoriales_secciones_vistas=Object.fromEntries(SECCIONES_TUTORIAL.map(s=>[s.id,true]));fin(false);});
    saltar.className += " onboarding-saltar-demo";
    panel.querySelector(".onboarding-top")?.append(saltar);
  }
  const preguntarPorOtroPlan=()=>{
    const pregunta=document.createElement("div");pregunta.className="onboarding-pregunta-plan";
    const tarjeta=document.createElement("section");tarjeta.setAttribute("role","dialog");tarjeta.setAttribute("aria-modal","true");
    tarjeta.append(texto("h2","","Ya tienes un plan guardado"),texto("p","","¿Quieres guardar otro plan de estudios o continuar con el que ya tienes?"));
    const botones=document.createElement("div");botones.className="onboarding-acciones";
    botones.append(boton("Guardar otro plan","btn-secondary",()=>fin(true)),boton("Continuar con este plan","btn-primary",()=>fin(false,true)));
    tarjeta.append(botones);pregunta.append(tarjeta);overlay.append(pregunta);
  };
  const instalarYa=()=>Boolean(navigator.standalone)||matchMedia("(display-mode: standalone)").matches;
  // En la demo no se ofrece instalar (el botón está oculto allí).
  const etapaTrasPersonalizar=()=>(MODO_DEMO||instalarYa())?"tour":"instalar";
  const cargarPreview=(seccion="resumen")=>{
    if(preview.dataset.seccion===seccion){actualizarPreview();return;}
    const u=new URL(location.href);u.search="";
    u.searchParams.set("demo","1");u.searchParams.set("preview","1");u.searchParams.set("previewSection",seccion);
    u.searchParams.set("previewPalette",paletaActual());u.searchParams.set("previewMode",modoPersonalizacion);u.searchParams.set("previewQuality",calidadPersonalizacion);
    u.searchParams.set("previewLogo",cfg.logo_app||"folder");
    if(paletaActual()==="personalizada"&&cfg.paleta_personalizada)u.searchParams.set("previewCustom",JSON.stringify(cfg.paleta_personalizada));
    // Los logos grandes viajan por postMessage (actualizarPreview); en la URL solo si caben.
    if(cfg.logo_app_url&&cfg.logo_app_url.length<90000)u.searchParams.set("previewLogoData",cfg.logo_app_url);
    iframeListo=false;preview.style.transition="none";preview.style.opacity="0";preview.dataset.seccion=seccion;preview.src=u.href;
  };
  const pintar=()=>{
    ctrlTour?.abort();ctrlTour=null;timersChat.forEach(clearTimeout);timersChat=[];
    contenido.replaceChildren();acciones.replaceChildren();
    const esTour=etapa==="tour";panel.classList.toggle("onboarding-con-tour",esTour||etapa==="personalizar"||etapa==="wapper-config");
    // En teléfono, cada pantalla nueva arranca en «información»; la vista previa se desliza.
    const claveVista=`${etapa}:${etapa==="tour"?indice:""}`;if(claveVista!==claveVistaMovil){claveVistaMovil=claveVista;vistaMovil="info";}
    panel.querySelector(".onboarding-cerrar").classList.toggle("oculto",!cuentaConDatos&&(etapa==="nombre"||etapa==="personalizar"));
    const nombres={nombre:"Tu cuenta, a tu manera",personalizar:"Personaliza tu app",instalar:"Llévala contigo",tour:`Conoce ${secciones[indice]?.nombre||"App Académica"}`,"wapper-config":"Activa Wapper",flujo:"Todo conectado, paso a paso"};
    titulo.textContent=etapa==="tour"?`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(secciones[indice]?.nombre||"App Académica")}`:traducirTextoInterfaz(nombres[etapa]||"App Académica");
    progreso.textContent=etapa==="tour"?`${indice+1} de ${secciones.length} secciones`:({nombre:"Bienvenida",personalizar:"Personalización",instalar:"Instalación",flujo:"Cómo empezar"}[etapa]||"");
    preview.closest(".onboarding-preview-wrap").classList.toggle("oculto",!esTour&&etapa!=="personalizar"&&etapa!=="wapper-config");
    aplicarVistaMovil();
    if(etapa==="nombre"){
      contenido.append(texto("p","onboarding-lead","Hola, ¿cómo te llamas? Puedes cambiarlo después en Ajustes."));
      const input=document.createElement("input");input.className="form-input";input.maxLength=60;input.autocomplete="given-name";input.value=MODO_DEMO?"":estado.datos.perfil?.nombre_preferido||estado.datos.perfil?.nombre||"";input.setAttribute("aria-label",titulo.textContent);
      const aviso=texto("p","onboarding-nota-error","Escribe cómo quieres que te llamemos para continuar.");aviso.hidden=true;aviso.setAttribute("role","alert");
      contenido.append(input,aviso);
      const continuar=()=>{
        const v=input.value.trim();
        // En la demo el nombre es opcional; en una cuenta real se pide con un aviso visible.
        if(!v&&!MODO_DEMO){aviso.hidden=false;input.setAttribute("aria-invalid","true");input.focus();return;}
        if(v){estado.datos.perfil=estado.datos.perfil||{};estado.datos.perfil.nombre_preferido=v;guardar();window.renderizarPerfil?.();}
        etapa=cuentaConDatos&&cfg.paleta&&cfg.modo?"tour":"personalizar";pintar();
      };
      input.addEventListener("input",()=>{aviso.hidden=true;input.removeAttribute("aria-invalid");});
      input.addEventListener("keydown",(ev)=>{if(ev.key==="Enter"){ev.preventDefault();continuar();}});
      acciones.append(boton("Continuar","btn-primary",continuar));
      requestAnimationFrame(()=>input.focus({preventScroll:true}));return;
    }
    if(etapa==="personalizar"){
      contenido.append(texto("p","onboarding-lead",(PERMITIR_LOGO_ONBOARDING?"Elige tema, paleta y logo. Puedes cambiarlos luego en Personalizar.":"Elige tema y paleta. Puedes cambiarlos luego en Personalizar.")));
      const modos=document.createElement("div");modos.className="onboarding-modos";
      const actualizarSeleccion=(grupo,selector,valor)=>grupo.querySelectorAll(selector).forEach(b=>{const activo=b.dataset.onboardingValor===valor;b.classList.toggle("btn-primary",activo);b.classList.toggle("btn-secondary",!activo);b.setAttribute("aria-pressed",String(activo));});
      [["light","Claro"],["dark","Color"],["true-dark","Oscuro"]].forEach(([v,l])=>{const b=boton(l,modoPersonalizacion===v?"btn-primary":"btn-secondary",()=>{modoPersonalizacion=v;cfg.modo=v;guardarModoTemaLocal(v);aplicarTemaAhora();guardar();actualizarPreview();actualizarSeleccion(modos,"button",v);});b.dataset.onboardingValor=v;b.setAttribute("aria-pressed",String(modoPersonalizacion===v));modos.append(b);});
      const calidades=document.createElement("div");calidades.className="onboarding-calidades";
      [["optimizado","Optimizado"],["fancy","Fancy"]].forEach(([v,l])=>{const b=boton(v==="fancy"?"Fancy":l,calidadPersonalizacion===v?"btn-primary":"btn-secondary",()=>{calidadPersonalizacion=guardarModoDisenoLocal(v)||v;document.documentElement.setAttribute("data-rendimiento",v==="optimizado"?"reducido":"normal");guardar();actualizarPreview();actualizarSeleccion(calidades,"button",v);notaFancy.hidden=v!=="fancy";fondo.programar();});b.dataset.onboardingValor=v;b.setAttribute("aria-pressed",String(calidadPersonalizacion===v));calidades.append(b);});
      const notaFancy=texto("p","onboarding-calidad-nota","El modo Fancy puede ser más lento según tu dispositivo.");notaFancy.hidden=calidadPersonalizacion!=="fancy";
      const colores=document.createElement("div");colores.className="onboarding-paletas";
      const marcarPaletas=()=>colores.querySelectorAll(".onboarding-color").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.paleta===paletaActual())));
      PALETAS_DISPONIBLES.forEach((p)=>{const b=document.createElement("button");b.type="button";b.className="onboarding-color";b.title=traducirTextoInterfaz(p);b.setAttribute("aria-label",traducirTextoInterfaz(p));b.dataset.paleta=p;b.setAttribute("aria-pressed",String(paletaActual()===p));const colors=COLORES_PREVIEW_PALETA[p]||[];b.style.background=p==="azucarado"?FONDO_PREVIEW_AZUCARADO:`linear-gradient(135deg,${colors.join(",")})`;b.addEventListener("click",()=>{cfg.paleta=p;aplicarTemaAhora();guardar();actualizarPreview();marcarPaletas();});colores.append(b);});
      const paletaPersonal=document.createElement("button");paletaPersonal.type="button";paletaPersonal.dataset.paleta="personalizada";paletaPersonal.setAttribute("aria-pressed",String(paletaActual()==="personalizada"));paletaPersonal.className="onboarding-color onboarding-paleta-nueva";paletaPersonal.setAttribute("aria-label",traducirTextoInterfaz("Crear mi paleta"));paletaPersonal.title=traducirTextoInterfaz("Crear mi paleta");paletaPersonal.textContent="+";paletaPersonal.onclick=()=>iniciarFlujoPaletaPersonalizada({alGuardar:()=>{cfg.paleta="personalizada";cfg.paleta_personalizada=estado.datos.configuracion.paleta_personalizada;guardar();aplicarTemaAhora();actualizarPreview();marcarPaletas();}});
      colores.append(paletaPersonal);
      const logos=document.createElement("div");logos.className="onboarding-logos";const marcarLogos=()=>logos.querySelectorAll(".onboarding-logo").forEach(x=>x.setAttribute("aria-pressed",String(cfg.logo_app===x.dataset.logo&&!cfg.logo_app_url)));[["folder","imagenes/LogoAppFolder.png","Carpeta"],["birrete","imagenes/LogoAppBirrete.png","Birrete"]].forEach(([v,src,alt])=>{const b=document.createElement("button");b.type="button";b.className="onboarding-logo";b.dataset.logo=v;b.setAttribute("aria-pressed",String(cfg.logo_app===v&&!cfg.logo_app_url));const img=document.createElement("img");img.src=src;img.alt=alt;b.append(img);b.onclick=()=>{cfg.logo_app=v;cfg.logo_app_url=null;guardar();aplicarLogoApp();actualizarPreview();marcarLogos();};logos.append(b);});
      const etiquetaArchivo=document.createElement("label");etiquetaArchivo.className="btn btn-secondary onboarding-file-picker";etiquetaArchivo.append(texto("span","","Personalizado"));
      const archivo=document.createElement("input");archivo.type="file";archivo.accept="image/png,image/jpeg,image/webp";archivo.className="onboarding-file-input";archivo.setAttribute("aria-label","Elegir logo desde archivos");archivo.onchange=async()=>{let url=null;try{url=await prepararImagenLogo(archivo.files?.[0]);}catch(_){}if(url){cfg.logo_app="personalizado";cfg.logo_app_url=url;guardar();aplicarLogoApp();actualizarPreview();marcarLogos();}else if(archivo.files?.length)toast?.(traducirTextoInterfaz("No se pudo usar esa imagen. Prueba con PNG, JPG o WebP."));archivo.value="";};etiquetaArchivo.append(archivo);
      const toggleLogos=boton("Logos de la app  ⌄","btn-secondary",()=>{const abierto=toggleLogos.getAttribute("aria-expanded")==="true";toggleLogos.setAttribute("aria-expanded",String(!abierto));toggleLogos.textContent=`Logos de la app  ${abierto?"⌄":"⌃"}`;logos.hidden=abierto;});toggleLogos.setAttribute("aria-expanded","false");logos.hidden=true;
      const filaLogo=document.createElement("div");filaLogo.className="onboarding-logo-heading";filaLogo.append(toggleLogos,etiquetaArchivo);
      contenido.append(modos,calidades,notaFancy,colores);if(PERMITIR_LOGO_ONBOARDING)contenido.append(filaLogo,logos);prepararMaqueta();
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="nombre";pintar();}),boton("Continuar","btn-primary",()=>{cfg.personalizacion_inicial_completada=true;guardar();etapa=etapaTrasPersonalizar();indice=0;pintar();}));return;
    }
    if(etapa==="instalar"){
      contenido.append(texto("p","onboarding-lead","Instala App Académica para abrirla como una app en tu teléfono o computadora."));
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="personalizar";pintar();}),boton("Ahora no","btn-secondary",()=>{etapa="tour";indice=0;pintar();}),boton("Instalar app","btn-primary",()=>{window.instalarAppAcademica?.();etapa="tour";indice=0;pintar();}));return;
    }
    if(etapa==="tour"){
      const sec=secciones[indice];if(!sec){etapa="flujo";pintar();return;}
      const bloqueConoce=document.createElement("section");bloqueConoce.className="onboarding-conoce";
      const botonConoce=boton("Conoce "+sec.nombre+" ⌄","btn-secondary",()=>{bloqueConoce.classList.toggle("plegado");botonConoce.textContent="Conoce "+sec.nombre+" "+(bloqueConoce.classList.contains("plegado")?"⌄":"⌃");});
      const lista=document.createElement("ul");lista.className="onboarding-lista";sec.puntos.forEach((p)=>lista.append(texto("li","",p)));bloqueConoce.append(botonConoce,lista);contenido.append(bloqueConoce);const duracionCadena=revelarEnCadena(lista);
      cerrarListaTour=()=>{clearTimeout(temporizadorTour);bloqueConoce.classList.add("plegado");botonConoce.textContent="Conoce "+sec.nombre+" ⌄";};
      clearTimeout(temporizadorTour);if(matchMedia("(max-width:760px) and (orientation: portrait)").matches)temporizadorTour=setTimeout(()=>{if(etapa==="tour"&&bloqueConoce.isConnected)cerrarListaTour?.();},5000+duracionCadena);
      const detectarInteraccion=(ev)=>{if(etapa==="tour"&&matchMedia("(orientation: portrait)").matches&&!ev.target.closest(".onboarding-conoce"))cerrarListaTour?.();};
      ctrlTour=new AbortController();["pointerdown","keydown","touchstart","wheel"].forEach(tipo=>overlay.addEventListener(tipo,detectarInteraccion,{once:true,capture:true,signal:ctrlTour.signal}));
      prepararEsquema(sec.id);
      if(indice>0)acciones.append(boton("Atrás","btn-secondary",()=>{indice--;pintar();}));
      const usarSeccion=()=>{cfg.navegacion_oculta=(cfg.navegacion_oculta||[]).filter(id=>id!==sec.id);guardar();window.aplicarVisibilidadNavegacion?.();siguiente();};
      if(sec.id==="asistente"){
        // En la demo no tiene sentido pedir la clave de Gemini: se muestra una conversación de ejemplo.
        if(MODO_DEMO)contenido.append(construirChatEjemplo(duracionCadena+300));
        else{const accionesWapper=document.createElement("div");accionesWapper.className="onboarding-wapper-cta-wrap";accionesWapper.append(boton("Configurar Wapper","btn-primary onboarding-wapper-cta",()=>{etapa="wapper-config";pintar();}));contenido.append(accionesWapper);}
      }
      if(indice===0)acciones.append(boton("Atrás","btn-secondary",()=>{etapa="personalizar";pintar();}));
      acciones.append(boton("No me interesa","btn-secondary",()=>{cfg.navegacion_oculta=[...new Set([...(cfg.navegacion_oculta||[]),sec.id])];guardar();window.aplicarVisibilidadNavegacion?.();siguiente();}),boton(indice===secciones.length-1?"Seguir":"Siguiente", "btn-primary",usarSeccion));return;
    }
    if(etapa==="wapper-config"){
      const pasosWapper=document.createElement("ol");pasosWapper.className="onboarding-dependencias";["Wapper usa tu Agenda para crear y consultar pendientes.","Guarda aquí tu clave personal de Gemini para activarlo.","Después podrás dictar tareas, exámenes y eventos desde Asistente."].forEach(t=>pasosWapper.append(texto("li","",t)));contenido.append(pasosWapper);
      contenido.append(texto("p","onboarding-wapper-estado",cfg.gemini_api_key?"Wapper está activo: ya hay una clave de Gemini guardada.":"Wapper necesita una clave personal de Gemini para funcionar."));
      if(!cfg.gemini_api_key){const label=texto("label","onboarding-wapper-etiqueta","Clave de Gemini");const input=document.createElement("input");input.type="password";input.className="form-input";input.autocomplete="new-password";input.placeholder="Pega tu clave personal";input.setAttribute("aria-label","Clave de Gemini");label.append(input);contenido.append(label);contenido.append(boton("Guardar y activar Wapper","btn-primary onboarding-wapper-cta",()=>{const clave=input.value.trim();if(!clave){input.focus();return;}cfg.gemini_api_key=clave;guardar();window.aplicarVisibilidadBotonAsistente?.();actualizarPreview();pintar();}));}
      prepararEsquema("asistente");
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="tour";pintar();}),boton("Continuar con la guía","btn-primary",()=>{etapa="tour";siguiente();}));return;
    }
    const pasos=document.createElement("ol");pasos.className="onboarding-dependencias";["Agrega tu plan de estudios.","Crea un semestre y matricula tus materias.","Usa esas materias en Horario, Agenda y Tiempo.","Wapper trabaja con tu Agenda; Comunidad y Finanzas funcionan por separado."].forEach(t=>pasos.append(texto("li","",t)));contenido.append(pasos);
    acciones.append(boton("Atrás","btn-secondary",()=>{indice=secciones.length-1;etapa="tour";pintar();}),boton("Lo haré después","btn-secondary",()=>fin(false)),boton(tienePlanArmado?"Continuar":"Agregar plan y ver la guía","btn-primary",()=>tienePlanArmado?preguntarPorOtroPlan():fin(true)));
  };
  const siguiente=()=>{indice++;if(indice>=secciones.length)etapa="flujo";pintar();};
  panel.querySelector(".onboarding-cerrar").addEventListener("click",()=>fin(false));
  pintar();return true;
}

function iniciarGuiaPlan({ navegar, posteriorImportacion = false, yaEnSemestres = false } = {}){
  const yaTienePlan = Boolean(estado.datos?.planes_estudio?.some((plan) => plan.materias?.length || plan.optativas_disponibles?.length));
  const semestresIniciales = new Set((estado.datos?.semestres || []).map((s) => s.id));
  let semestreCreadoEnGuia = false, esperandoAlta = false, pasoAlta = -1;
  const marcarSemestresVisto = () => {
    estado.datos.configuracion.tutoriales_secciones_vistas = estado.datos.configuracion.tutoriales_secciones_vistas || {};
    estado.datos.configuracion.tutoriales_secciones_vistas.semestres = true; guardar();
  };
  const botonRegistrarSemestre = () => [...document.querySelectorAll("#seccion-semestres button")].find((b) => /registrar semestre|crear semestre|agregar semestre/i.test(b.textContent));
  const pasos = [
    ...(posteriorImportacion ? [
      // 1) Solo si aún no estamos en Semestres.
      ...(yaEnSemestres ? [] : [{ accion: "navegar", selector: () => document.getElementById("nav-semestres"),
        texto: "Tu plan ya quedó guardado ✓. Ahora falta decirle a la app qué estás cursando este semestre. Toca Semestres para continuar." }]),
      // 2) El porqué (sin resaltar nada: es una explicación).
      { selector: () => null,
        texto: "¿Por qué un semestre? Tu plan es la lista completa de materias de la carrera; el semestre es lo que cursas ahora. Al matricular materias aquí, Horario, Agenda y Tiempo de estudio ya pueden usarlas, y aquí llevarás tus notas y tu promedio." },
      // 3) El qué hacer, con el botón resaltado.
      { accion: "abrirAlta", selector: botonRegistrarSemestre,
        texto: "Toca «Registrar semestre» (el botón resaltado). Se abre un formulario: 1) escribe el período, por ejemplo 2026-II; 2) marca las materias que cursas ahora; 3) guarda. Cuando termines, te sigo guiando." },
    ] : yaTienePlan ? [
      { selector: () => document.getElementById("btn-gestion-planes") || document.getElementById("btn-gestionar-planes") || document.querySelector("#seccion-plan-estudios button"), texto: "Ya tienes un plan. Puedes revisar sus materias o abrir Gestionar plan para añadir otra carrera." },
      { selector: () => document.getElementById("nav-semestres"), texto: "El siguiente paso es crear un semestre y matricular materias de ese plan." },
    ] : [
      { selector: () => [...document.querySelectorAll("#seccion-plan-estudios .pill-group button")].find((b) => /Pegar link|Adjuntar PDF/i.test(b.textContent)), texto: "Primero elige Pegar link o Adjuntar PDF/Imagen. Luego envía tu plan a Claude para que lo convierta al formato CSV." },
      { selector: () => document.getElementById("btn-enviar-import-claude"), texto: "Pulsa Enviar a Claude y sigue la guía para adjuntar tu plan. Cuando Claude devuelva el CSV, vuelve a esta app." },
      { selector: () => document.getElementById("textarea-csv-importar"), texto: "Copia el bloque CSV completo, desde CARRERA hasta la última materia, y pégalo aquí. Luego toca Importar." },
      { selector: () => [...document.querySelectorAll("#seccion-plan-estudios button")].find((b) => /^importar$/i.test(b.textContent.trim())), texto: "Pulsa Importar para guardar y revisar las materias. Cuando termine, la guía te llevará a Semestres para continuar." },
    ]),
  ];
  let i = 0;
  const pop = document.createElement("aside"); pop.className = "guia-plan-flotante"; pop.setAttribute("role", "dialog"); document.body.append(pop);
  const resaltador = crearResaltador();
  let resaltado = null;
  const cerrar = ({ continuarSemestres = false } = {}) => {
    resaltador.quitar(); pop.remove();
    if (cerrarGuiaPlanActiva === cerrar) cerrarGuiaPlanActiva = null;
    if (continuarSemestres && semestreCreadoEnGuia) { const info = SECCIONES_TUTORIAL.find((x) => x.id === "semestres"); setTimeout(() => iniciarGuiaSeccion(info), 180); }
  };
  cerrarGuiaPlanActiva = cerrar;
  const revisarAlta = () => {
    if (!esperandoAlta || !pop.isConnected) return;
    const nuevos = (estado.datos?.semestres || []).filter((x) => !semestresIniciales.has(x.id));
    if (nuevos.length) {
      esperandoAlta = false; semestreCreadoEnGuia = true; marcarSemestresVisto();
      const semestre = nuevos.sort((a, b) => (b._actualizadoEn || 0) - (a._actualizadoEn || 0))[0];
      pasos.splice(pasoAlta + 1, 0, {
        selector: () => document.querySelector(`[data-semestre-id="${semestre.id}"]`) || null,
        texto: "Listo ✓ Tu semestre ya está registrado con sus materias. Toca su tarjeta para abrirla: ahí agregas criterios de evaluación, asignaciones y notas. Y como ya hay materias matriculadas, Horario, Agenda y Tiempo de estudio ya las reconocen.",
      });
      i = pasoAlta + 1; pintar(); return;
    }
    if (!document.querySelector(".overlay-alta-semestre")) { esperandoAlta = false; setTimeout(pintar, 150); return; }
    setTimeout(revisarAlta, 500);
  };
  const pintar = () => {
    if (i >= pasos.length) { cerrar({ continuarSemestres: posteriorImportacion }); return; }
    if (!posteriorImportacion && !yaTienePlan && i >= 1 && !document.getElementById("textarea-csv-importar")) {
      const link = [...document.querySelectorAll("#seccion-plan-estudios .pill-group button")].find((b) => /Pegar link/i.test(b.textContent));
      if (link) link.click(); setTimeout(pintar, 80); return;
    }
    const paso = pasos[i];
    resaltado = paso.selector();
    resaltado?.scrollIntoView({ behavior: "smooth", block: "center" });
    resaltador.apuntar(resaltado); // anillo + bloqueo de todo lo demás (solo si hay objetivo)
    pop.replaceChildren();
    const titulo = document.createElement("strong"); titulo.textContent = `${i + 1} / ${pasos.length}`;
    const p = document.createElement("p"); p.textContent = traducirTextoInterfaz(paso.texto);
    pop.append(titulo, p);
    const acciones = document.createElement("div"); acciones.className = "row";
    const seguir = document.createElement("button"); seguir.className = "btn btn-primary";
    seguir.textContent = traducirTextoInterfaz(paso.accion === "abrirAlta" ? "Abrir formulario" : i === pasos.length - 1 ? "Entendido" : "Siguiente");
    seguir.onclick = () => {
      if (paso.accion === "navegar") { marcarSemestresVisto(); navegar?.("semestres"); }
      if (paso.accion === "abrirAlta") {
        marcarSemestresVisto(); pasoAlta = i; resaltador.ocultar();
        (resaltado || botonRegistrarSemestre())?.click(); pop.classList.add("oculto"); esperandoAlta = true;
        setTimeout(revisarAlta, 700); return;
      }
      i++; pintar();
    };
    const saltar = document.createElement("button"); saltar.className = "btn btn-secondary"; saltar.textContent = traducirTextoInterfaz("Saltar guía"); saltar.onclick = () => cerrar();
    acciones.append(seguir, saltar); pop.append(acciones); pop.classList.remove("oculto");
  };
  pintar();
  window.continuarTutorialDespuesDeImportarPlan = () => { if (!cerrarGuiaPlanActiva) return; marcarSemestresVisto(); cerrar(); navegar?.("semestres"); setTimeout(() => iniciarGuiaPlan({ navegar, posteriorImportacion: true, yaEnSemestres: true }), 350); };
}

function inicializarTutorialDesdeAjustes({ navegar, toast } = {}) {
  const btn=document.getElementById("btn-repetir-tutorial");if(!btn||btn.dataset.inicializado)return;btn.dataset.inicializado="1";btn.addEventListener("click",()=>{if(!estado.datos?.configuracion)return;estado.datos.configuracion.onboarding_v1_completado=false;mostrarOnboardingNuevoUsuario({navegar,toast});});
}

const SELECTORES_GUIA_SECCION = {
  resumen: [
    () => document.querySelector("#seccion-resumen .resumen-semana-tarjeta") || document.querySelector("#seccion-resumen .resumen-bloque"),
    () => document.querySelector("#seccion-resumen .resumen-estudio-hoy-tarjeta") || document.querySelector("#seccion-resumen .resumen-bloque"),
    () => document.querySelector("#seccion-resumen .resumen-bloque:last-child") || document.getElementById("seccion-resumen"),
  ],
  agenda: [
    () => document.getElementById("pills-agenda-vista"),
    () => document.getElementById("btn-agenda-agregar"),
    () => document.getElementById("agenda-lista-dias") || document.getElementById("agenda-vista-calendario"),
  ],
  horario: [
    () => document.getElementById("horario-header"),
    () => document.getElementById("btn-horario-agregar"),
    () => document.getElementById("btn-horario-amigos"),
  ],
  "tiempo-estudio": [
    () => document.querySelector("#seccion-tiempo-estudio .te-selector-semestre-tiempo"),
    () => document.querySelector("#seccion-tiempo-estudio [data-vista='materias']")?.parentElement,
    () => [...document.querySelectorAll("#seccion-tiempo-estudio button")].find(b => /iniciar/i.test(b.textContent)) || document.getElementById("seccion-tiempo-estudio"),
  ],
  semestres: [
    () => [...document.querySelectorAll("#seccion-semestres button")].find(b => /registrar semestre|crear semestre|agregar semestre/i.test(b.textContent)) || document.getElementById("seccion-semestres"),
    () => document.querySelector("#seccion-semestres [data-semestre-id]") || document.getElementById("seccion-semestres"),
    () => [...document.querySelectorAll("#seccion-semestres button")].find(b => /nota|historial|editar/i.test(b.textContent)) || document.querySelector("#seccion-semestres [data-semestre-id]") || document.getElementById("seccion-semestres"),
  ],
  comunidad: [
    () => [...document.querySelectorAll("#seccion-comunidad button")].find(b => /agregar|nuevo|compañero|profesor/i.test(b.textContent)) || document.getElementById("seccion-comunidad"),
    () => document.querySelector("#seccion-comunidad .glass-card") || document.getElementById("seccion-comunidad"),
    () => [...document.querySelectorAll("#seccion-comunidad button")].find(b => /horario|contacto|valoraci/i.test(b.textContent)) || document.getElementById("seccion-comunidad"),
  ],
  finanzas: [
    () => document.querySelector("#seccion-finanzas .finanzas-tabs-contenedor") || document.getElementById("seccion-finanzas"),
    () => [...document.querySelectorAll("#seccion-finanzas button")].find(b => /agregar|nuevo|gasto|ingreso/i.test(b.textContent)) || document.getElementById("seccion-finanzas"),
    () => document.getElementById("finanzas-contenido") || document.getElementById("seccion-finanzas"),
  ],
  asistente: [
    () => document.querySelector("#seccion-asistente .glass-card") || document.getElementById("seccion-asistente"),
    () => document.querySelector("#seccion-asistente textarea, #seccion-asistente input:not([type='hidden'])") || document.getElementById("seccion-asistente"),
    () => document.getElementById("nav-configuracion"),
  ],
  configuracion: [
    () => document.getElementById("ajuste-tamano-texto"),
    () => document.getElementById("selector-modos-apariencia"),
    () => document.getElementById("grid-paletas") || document.getElementById("selector-logo-app"),
  ],
};

function iniciarGuiaSeccion(info) {
  const objetivos=SELECTORES_GUIA_SECCION[info.id]||[];
  let indice=0,resaltado=null;const resaltador=crearResaltador();
  const pop=document.createElement("aside");pop.className="guia-plan-flotante guia-seccion-flotante";pop.setAttribute("role","dialog");pop.setAttribute("aria-live","polite");pop.setAttribute("aria-label",`${traducirTextoInterfaz("Tutorial")}: ${traducirTextoInterfaz(info.nombre)}`);document.body.append(pop);
  const cerrar=()=>{resaltador.quitar();pop.remove();};
  const pintar=()=>{
    if(indice>=info.puntos.length){cerrar();return;}
    const buscar=objetivos[indice];resaltado=buscar?.()||document.getElementById(`seccion-${info.id}`);
    resaltado?.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});resaltador.apuntar(resaltado);
    pop.replaceChildren();
    const titulo=document.createElement("strong");titulo.textContent=`${traducirTextoInterfaz(info.nombre)} · ${indice+1}/${info.puntos.length}`;
    const texto=document.createElement("p");texto.textContent=traducirTextoInterfaz(info.puntos[indice]);
    const acciones=document.createElement("div");acciones.className="guia-seccion-acciones";
    if(indice>0){const anterior=document.createElement("button");anterior.type="button";anterior.className="btn btn-secondary";anterior.textContent=traducirTextoInterfaz("Anterior");anterior.onclick=()=>{indice--;pintar();};acciones.append(anterior);}
    const siguiente=document.createElement("button");siguiente.type="button";siguiente.className="btn btn-primary";siguiente.textContent=traducirTextoInterfaz(indice===info.puntos.length-1?"Entendido":"Siguiente");siguiente.onclick=()=>{indice++;pintar();};
    const saltar=document.createElement("button");saltar.type="button";saltar.className="btn btn-secondary";saltar.textContent=traducirTextoInterfaz("Saltar guía");saltar.onclick=cerrar;
    acciones.append(siguiente,saltar);pop.append(titulo,texto,acciones);
  };
  pintar();
}

function mostrarTutorialPrimeraVez(seccion) {
  const cfg=estado.datos?.configuracion;
  const info=SECCIONES_TUTORIAL.find(s=>s.id===seccion);
  if(PREVIEW_DEMO||!cfg||cfg.onboarding_v1_completado===false||!info||cfg.tutoriales_secciones_vistas?.[seccion]||document.querySelector(".onboarding-overlay,.tutorial-seccion-overlay,.guia-seccion-flotante,.guia-plan-flotante"))return false;
  cfg.tutoriales_secciones_vistas=cfg.tutoriales_secciones_vistas||{};cfg.tutoriales_secciones_vistas[seccion]=true;guardar();
  const overlay=document.createElement("div");overlay.className="modal-overlay tutorial-seccion-overlay";overlay.setAttribute("role","dialog");overlay.setAttribute("aria-modal","true");
  const card=document.createElement("section");card.className="glass-card modal-card stack tutorial-seccion-card";const h=document.createElement("h2");h.textContent=`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(info.nombre)}`;card.append(h);
  const lista=document.createElement("ul");lista.className="onboarding-lista";info.puntos.forEach(p=>lista.append(textoTutorial("li",p)));card.append(lista);
  const acciones=document.createElement("div");acciones.className="tutorial-seccion-acciones";
  const tutorial=document.createElement("button");tutorial.type="button";tutorial.className="btn btn-secondary";tutorial.textContent=traducirTextoInterfaz("Guía");tutorial.title=traducirTextoInterfaz("Guía paso a paso para conocer esta sección");tutorial.onclick=()=>{overlay.remove();if(info.id==="plan-estudios")iniciarGuiaPlan({navegar:window.mostrarSeccion});else iniciarGuiaSeccion(info);};
  const cerrar=document.createElement("button");cerrar.type="button";cerrar.className="btn btn-primary";cerrar.textContent=traducirTextoInterfaz("Entendido");cerrar.onclick=()=>overlay.remove();
  acciones.append(tutorial,cerrar);card.append(acciones);overlay.append(card);document.body.append(overlay);tutorial.focus();return true;
}function textoTutorial(tag,value){const e=document.createElement(tag);e.textContent=traducirTextoInterfaz(value);return e;}
export { mostrarOnboardingNuevoUsuario, inicializarTutorialDesdeAjustes, mostrarTutorialPrimeraVez };
