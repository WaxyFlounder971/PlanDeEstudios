import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp, PALETAS_DISPONIBLES, MONEDAS_DISPONIBLES, OFFSETS_RECORDATORIO_AGENDA, LIMITE_ENLACES_RAPIDOS, crearEnlaceRapido } from "./schema.js";
import { convertirImagenABase64Comprimida } from "./utils.js";
import { activarSincronizacionCalendario, desactivarSincronizacionCalendario, sincronizacionCalendarActiva, sincronizarResumenDiario } from "./notificaciones-calendario.js";
import { aplicarPaleta, obtenerModoTemaLocal, guardarModoTemaLocal, obtenerModoDisenoLocal, guardarModoDisenoLocal, COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO } from "../ui/tema.js";
import { traducirTextoInterfaz } from "./i18n.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";
import { aplicarLogoApp, prepararImagenLogo } from "./marca.js";
import { MODO_DEMO, PREVIEW_DEMO } from "./demo-mode.js";

const SECCIONES_TUTORIAL = [
  { id:"resumen", nombre:"Resumen", puntos:["Semana actual del semestre y días que faltan.","Avance de estudio del día.","Clases, entregas y exámenes próximos."] },
  { id:"agenda", nombre:"Agenda", puntos:["Alterna entre lista, calendario y cronograma.","Toca «+» para crear tareas, exámenes, proyectos o eventos y vincularlos a una materia.","Toca el nombre del semestre para ver uno o varios semestres a la vez."] },
  { id:"horario", nombre:"Horario", puntos:["Guarda hora, aula, profesor y modalidad.","Abre una clase para ver todos sus detalles.","Compara horarios con tus amistades."] },
  { id:"tiempo-estudio", nombre:"Tiempo de estudio", puntos:["Abre una materia y empieza una sesión de estudio.","Usa materias aunque no estén en tu plan: toca «Nueva Materia» al final de la lista.","Consulta historial, estadísticas y competencias de todos tus semestres."] },
  { id:"semestres", nombre:"Semestres", puntos:["Matricula materias de tu plan.","Registra criterios, asignaciones y notas."] },
  { id:"comunidad", nombre:"Comunidad", puntos:["Organiza compañeros y docentes relacionados con tus materias.","Cada docente lleva tu propia valoración, según tu experiencia."] },
  { id:"finanzas", nombre:"Finanzas", puntos:["Registra ingresos y gastos desde el inicio.","Clasifica movimientos por categoría.","Asociarlos a un semestre es opcional."] },
  { id:"plan-estudios", nombre:"Plan de estudios", puntos:["Añade una o varias carreras.","Pega o importa la malla completa.","El plan alimenta la matrícula de Semestres."] },
  { id:"asistente", nombre:"Wapper", puntos:["Convierte mensajes en tareas, exámenes o eventos de Agenda.","Consulta fechas y pendientes con lenguaje natural.","Actívalo con tu clave personal de Gemini desde Ajustes."] },
  { id:"configuracion", nombre:"Ajustes", puntos:["Cambia idioma, apariencia, paleta y tamaño de texto.","Aquí ordenas y ocultas las secciones de la navegación.","Con este botón vuelves a ver la bienvenida y el mini tutorial cuando quieras."] },
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
.onb-r-hor{display:grid;grid-template-columns:30px repeat(7,minmax(0,1fr));grid-template-rows:34px repeat(8,26px);font-size:.62rem;background:repeating-linear-gradient(to bottom,transparent 0 25px,color-mix(in srgb,currentColor 9%,transparent) 25px 26px) 0 34px/100% 26px no-repeat}
.onb-r-hd{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.1}
.onb-r-hd small{opacity:.55;font-size:.56rem}
.onb-r-hd.hoy b{color:#3b82f6}
.onb-r-hh{opacity:.5;padding:1px 3px 0 0;text-align:right;font-size:.56rem;line-height:1}
.onb-r-blq{margin:1px;padding:3px 5px;border-radius:7px;overflow:hidden;color:#fff;font-weight:700;font-size:.58rem;line-height:1.12}
.onb-r-tit{font-size:1rem;font-weight:700}
.onb-r-etq{display:block;opacity:.6;font-size:.7rem}
.onb-r-etq.up{text-transform:uppercase;letter-spacing:.05em;font-size:.6rem;margin-top:2px}
.onb-r-chip{display:inline-block;flex:none;font-size:.62rem;font-weight:700;padding:2px 9px;border-radius:999px;border:1px solid var(--c);color:var(--c);background:color-mix(in srgb,var(--c) 10%,transparent)}
.onb-r-chips{display:flex;flex-wrap:wrap;gap:5px}
.onb-r-buscar{padding:9px 12px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);opacity:.7}
.onb-r-ciclo{color:var(--accent-2,var(--accent-1,#8b5cf6));font-size:.78rem}
.onb-r-cab3{display:block;padding:8px 12px}
.onb-r-cab3 .onb-r-fila{width:100%}
.onb-r-hoy{padding:2px 12px;border:1px solid #3b82f6;color:#3b82f6;border-radius:999px;font-weight:700;font-size:.7rem}
.onb-r-item.tinte{background:color-mix(in srgb,var(--c) 14%,transparent);border:1px solid color-mix(in srgb,var(--c) 40%,transparent);border-left:3px solid var(--c)}
.onb-r-prog.fina{height:4px}
.onb-r-est{flex:1;display:block}
.onb-r-est b{font-size:.95rem;letter-spacing:1px;background:linear-gradient(90deg,#fbbf24 var(--p),color-mix(in srgb,currentColor 22%,transparent) var(--p));-webkit-background-clip:text;background-clip:text;color:transparent}
.onb-r-doc{display:flex;align-items:center;gap:10px;padding:10px 12px}
.onb-r-doc>b{flex:1.3;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.onb-r-svg{width:100%;max-width:440px;max-height:230px;height:auto;display:block;margin:0 auto}
.onb-r-leyenda{display:flex;justify-content:center;gap:14px;font-size:.66rem;opacity:.85}
.onb-r-leyenda span::before{content:"";display:inline-block;width:14px;height:3px;margin-right:5px;vertical-align:middle;background:var(--c);border-radius:2px}
.onb-r-ciclos{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.onb-r-ciclo-col{display:flex;flex-direction:column;gap:6px;min-width:0}
.onb-r-ciclo-t{text-align:center;padding-bottom:5px;border-bottom:1px solid color-mix(in srgb,currentColor 16%,transparent);font-size:.75rem}
.onb-r-curso{display:flex;flex-direction:column;gap:2px;padding:6px 7px;border-radius:9px;border:1px solid var(--c,color-mix(in srgb,currentColor 30%,transparent));font-size:.66rem;line-height:1.15}
.onb-r-curso.ok{--c:#10b981;border-width:2px}.onb-r-curso.cur{--c:#f59e0b;border-width:2px}
.onb-r-cod{font-family:ui-monospace,monospace;opacity:.65;font-size:.58rem}
.onb-r-tiempo3{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:10px;padding:14px}
.onb-r-cajas{display:flex;flex-direction:column;gap:7px;align-items:center}
.onb-r-caja{width:100%;max-width:96px;text-align:center;padding:6px;border-radius:10px;background:color-mix(in srgb,currentColor 7%,transparent);border:1px solid color-mix(in srgb,currentColor 12%,transparent)}
.onb-r-caja b{display:block}.onb-r-caja small{opacity:.6;font-size:.62rem}
.onb-r-anillo{position:relative;width:112px;height:112px;border-radius:50%;box-sizing:border-box;border:11px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 18%,transparent);display:grid;place-items:center;text-align:center}
.onb-r-anillo::after{content:"";position:absolute;left:50%;top:-12px;width:13px;height:13px;margin-left:-6.5px;border-radius:50%;background:var(--accent-1,#8b5cf6)}
.onb-r-reloj{font-size:1.35rem;display:block}
.onb-r-estudiando{color:var(--accent-1,#8b5cf6);font-size:.58rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase}
.onb-r-btn.grande{padding:8px 12px;width:100%;text-align:center;box-sizing:border-box}
.onb-r-btn.r{background:transparent;border:1px solid #ef4444;color:#f87171}
.onb-r-curso2{display:flex;flex-direction:column;gap:7px;padding:9px 10px;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);border-left:4px solid var(--c)}
.onb-r-nota{display:flex;flex-direction:column;gap:3px;padding:9px 11px}
.onb-r-acc{display:flex;justify-content:flex-end;gap:14px;font-size:.7rem;font-weight:700}
.onb-r-acc .e{color:#38bdf8}.onb-r-acc .x{color:#f87171}
@media (max-width:760px){.onb-r-opc{display:none}.onb-r-ciclos{grid-template-columns:repeat(3,minmax(0,1fr))}}
.onb-r-aro{position:relative;width:104px;height:104px}
.onb-r-aro .onb-aro{position:absolute;inset:0}
.onb-r-tiempo{position:absolute;inset:0;display:grid;place-items:center;font-size:1.25rem;font-weight:800}
.onb-r-paleta{display:flex;gap:10px}
.onb-r-paleta i{width:24px;height:24px;border-radius:50%}
.onb-r-hilo{display:flex;flex-direction:column;gap:7px}
.onb-r-msg{max-width:80%;padding:7px 11px;border-radius:14px;border-bottom-left-radius:4px;align-self:flex-start;background:color-mix(in srgb,currentColor 10%,transparent)}
.onb-r-msg.yo{align-self:flex-end;border-radius:14px;border-bottom-right-radius:4px;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 30%,transparent)}
.onb-r-entrada{margin-top:auto;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 6px 6px 14px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent)}
/* Teléfono · recorrido: una página por sección (texto arriba, maqueta abajo), barra inferior fija. */
.onboarding-panel.onb-tour-movil{display:flex!important;flex-direction:column;height:100vh!important;height:100dvh!important;min-height:0!important;max-height:100dvh!important;overflow:hidden!important;padding:0!important;background:var(--onb-izq,#080808)!important}
.onb-tour-movil>.onboarding-top{position:static!important;width:100%!important;max-width:none!important;flex:none;padding:calc(12px + env(safe-area-inset-top)) 18px 4px!important}
.onb-tour-movil>.onboarding-layout{flex:1 1 auto;min-height:0!important;width:100%!important;max-width:none!important;height:auto!important;display:flex!important;flex-direction:column;gap:0!important;overflow:hidden!important;grid-template-rows:none!important;background:var(--onb-izq,#080808)!important}
.onb-tour-movil .onboarding-copy{flex:0 0 auto;height:auto!important;max-height:46%!important;display:block!important;overflow-y:auto!important;padding:2px 20px 12px!important}
.onb-tour-movil .onboarding-copy h1{font-size:1.5rem!important;line-height:1.15;margin:0 0 8px}
.onb-tour-movil .onboarding-lista{font-size:.92rem;line-height:1.4;gap:6px;padding-left:1.1em}
.onb-tour-movil .onboarding-preview-wrap{flex:1 1 0;min-height:0!important;height:auto!important;width:auto!important;margin:0 12px;border-radius:18px!important;overflow:hidden;display:block!important;position:relative}
.onb-tour-movil .onboarding-preview,.onb-tour-movil .onb-toca,.onb-tour-movil .onb-vivo{display:none!important}
.onb-tour-movil>.onboarding-acciones{position:static!important;width:100%!important;max-width:none!important;flex:none;display:grid!important;grid-template-columns:auto minmax(0,1fr);gap:6px 10px;padding:6px 16px calc(12px + env(safe-area-inset-bottom))!important}
.onb-tour-movil .onb-atras{grid-column:1;grid-row:1}
.onb-tour-movil .onb-sig{grid-column:2;grid-row:1}
.onb-tour-movil .onb-no{grid-column:1/-1;grid-row:2;background:none!important;border:0!important;box-shadow:none!important;min-height:0;padding:4px;opacity:.75;font-size:.85rem}
.onb-puntos{display:none}
.onb-tour-movil>.onb-puntos{display:flex;flex:none;justify-content:center;gap:6px;padding:10px 0 4px;background:var(--onb-izq,#080808)}
.onb-puntos i{width:6px;height:6px;border-radius:3px;background:color-mix(in srgb,currentColor 30%,transparent)}
.onb-puntos i.on{width:20px;background:var(--accent-1,#8b5cf6)}
.onb-esquema>.onb-marco{transform-origin:0 0}
.onb-r-estmat{display:flex;flex-direction:column;gap:3px}
.onb-r-card.acento{border-left:3px solid var(--accent-1,#8b5cf6)}
.onb-r-clase{padding:6px 9px}.onb-r-clase>b{flex:none;min-width:3.6em}
.onb-r-navsem{justify-content:center;gap:12px}
.onb-r-horario.est{flex:1;min-height:0;display:flex}
.onb-r-hor2{flex:1;min-height:0;display:grid;grid-template-columns:26px repeat(5,minmax(0,1fr));grid-template-rows:34px repeat(10,minmax(0,1fr));font-size:.6rem;position:relative}
.onb-r-ln{grid-column:1/-1;border-top:1px solid color-mix(in srgb,currentColor 9%,transparent);pointer-events:none}
.onb-r-hh2{display:flex;flex-direction:column;align-items:flex-end;padding-right:3px;opacity:.55;line-height:1;font-size:.58rem}
.onb-r-hh2 small{font-size:.5rem}
.onb-r-blq2{margin:1px;padding:3px 4px;border-radius:7px;overflow:hidden;color:#fff;display:flex;flex-direction:column;justify-content:space-between;font-size:.56rem;line-height:1.1;word-break:break-word;z-index:1}
.onb-r-blq2 b{font-weight:700}.onb-r-blq2 span{align-self:flex-end;font-size:.7rem}
.onb-r-ahora{grid-column:2/-1;align-self:center;border-top:2px solid #3b82f6;z-index:2;pointer-events:none}
.onb-r-botonesh{padding:0 4px}
.onb-r-cabte{border-top:3px solid #b91c1c}.onb-r-nomte{flex:1;text-align:center;font-size:.85rem;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.onb-r-principalte{align-items:stretch;gap:9px}
.onb-r-caja.ancha{max-width:none}
.onb-r-aro.g{width:128px;height:128px;margin:6px auto}
.onb-r-aro.g .onb-aro{-webkit-mask:radial-gradient(circle,transparent 62%,#000 63%);mask:radial-gradient(circle,transparent 62%,#000 63%)}
.onb-r-aro.g .onb-r-tiempo{font-size:1.5rem}
.onb-r-vacio{opacity:.6;font-size:.66rem;text-align:center;padding:26px 8px 4px}
.onb-r-semfila{padding:9px 10px}
.onb-r-cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:4px}
.onb-r-cal-h{text-align:center;opacity:.55;font-size:.6rem}
.onb-r-cal-d{aspect-ratio:1;border-radius:7px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;background:color-mix(in srgb,currentColor 7%,transparent);font-size:.62rem}
.onb-r-cal-d.fuera{opacity:.35}.onb-r-cal-d.hoy{outline:1.5px solid #3b82f6}
.onb-r-cal-p{display:flex;gap:2px;height:4px}.onb-r-cal-p em{width:4px;height:4px;border-radius:50%}
.onb-r-chips.centro{justify-content:center}
.onb-r-mat{display:flex;flex-direction:column;gap:5px;padding:7px 9px;border-radius:10px;background:color-mix(in srgb,currentColor 5%,transparent);border-left:4px solid var(--c)}
.onb-r-mat-n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.onb-r-mapa{position:relative}
.onb-r-lineas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
.onb-r-ciclos.tres{grid-template-columns:repeat(3,minmax(0,1fr))}
.onb-r-pct{font-size:1rem;min-width:3.2em}
.onb-r-pt{width:9px;height:9px;border-radius:50%;flex:none;display:inline-block}
.onb-r-bal{color:#10b981}
.onb-r-ajuste{padding:12px 14px}
.onb-r-cuerpo-aj{gap:8px;padding-top:6px}
.onb-r-navfila{padding:6px 8px;border-radius:10px;background:color-mix(in srgb,currentColor 6%,transparent)}
.onb-primario-movil{margin-top:16px;width:100%}
.onb-r-aro.g .onb-aro{width:100%;height:100%;-webkit-mask:radial-gradient(circle,transparent 54%,#000 55%);mask:radial-gradient(circle,transparent 54%,#000 55%)}
.onb-r-semwrap{display:flex;flex-direction:column;gap:6px;padding:8px}
.onb-r-semfila{padding:4px 2px;gap:8px}.onb-r-semn{flex:1;min-width:0}
.onb-r-botonesh.dos{gap:8px}.onb-r-botonesh.dos .onb-r-btn{flex:1;text-align:center;padding:9px 8px}
.onb-r-fin{display:grid;grid-template-columns:3.6em 1fr auto;align-items:center;gap:8px}.onb-r-fin>b:first-child{font-size:1rem}
.onb-r-balfila{justify-content:center;gap:6px}
.onb-r-ajuste{flex:1 1 auto;max-height:72px;padding:14px}.onb-primario-movil .btn{width:100%}
.onb-r-logo{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;background:color-mix(in srgb,currentColor 10%,transparent)}

@media (max-height:700px){.onb-tour-movil .onboarding-lista{font-size:.86rem}.onb-tour-movil .onboarding-copy h1{font-size:1.35rem!important}.onb-tour-movil .onboarding-copy{max-height:50%!important}}
/* Lado izquierdo del onboarding (progreso, texto y botones): fondo PLANO y fijo, igual que en Optimizado.
   Claro = #fbfbfe · Oscuro = #080808 · Color = el fondo liso de la paleta (--onb-izq, ver colorLadoIzquierdo). No cambia con Fancy. */
.onboarding-overlay .onboarding-copy,.onboarding-overlay .onboarding-top,.onboarding-overlay .onboarding-acciones{background:var(--onb-izq,#080808)!important;background-image:none!important;backdrop-filter:none!important;-webkit-backdrop-filter:none!important;box-shadow:none!important}
.onboarding-overlay .onboarding-copy,.onboarding-overlay .onboarding-copy *{text-shadow:none!important}
.onboarding-pregunta-botones{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px;margin-top:14px;padding:0;background:none!important;box-shadow:none!important;border:0}
.onb-bienvenida-avatar{position:relative;isolation:isolate;display:grid;place-items:center;width:92px;height:92px;margin:0 0 16px;border-radius:50%;padding:3px;font-size:2.3rem;font-weight:800;color:#fff;background:linear-gradient(135deg,var(--accent-1,#8b5cf6),var(--accent-2,#38bdf8));animation:onbAvEntra .7s cubic-bezier(.2,.9,.3,1.15) both}
.onb-bienvenida-avatar::before{content:"";position:absolute;inset:-12px;z-index:-1;border-radius:50%;background:radial-gradient(closest-side,color-mix(in srgb,var(--accent-1,#8b5cf6) 50%,transparent),transparent);filter:blur(10px);animation:onbAvPulso 3.6s ease-in-out infinite}
.onb-bienvenida-avatar img{width:100%;height:100%;border-radius:50%;object-fit:cover;box-sizing:border-box;border:3px solid var(--onb-izq,#080808);background:var(--onb-izq,#080808)}
.onb-bienvenida-lema{margin:0 0 22px;font-size:1.02rem;line-height:1.4;opacity:.78}
.onb-bienvenida-etiqueta{display:block;font-size:.82rem;font-weight:700;letter-spacing:.02em;opacity:.8;margin-bottom:8px}
.onb-bienvenida-campo{width:100%;font-size:1.15rem!important;font-weight:600;padding:.95rem 1.1rem!important;border-radius:16px!important}
.onb-chip{margin-top:10px;padding:.42rem .85rem;border-radius:999px;font:inherit;font-size:.84rem;font-weight:600;cursor:pointer;color:inherit;background:color-mix(in srgb,var(--accent-1,#8b5cf6) 16%,transparent);border:1px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 45%,transparent)}
@keyframes onbAvEntra{from{opacity:0;transform:scale(.6) translateY(8px)}to{opacity:1;transform:none}}
@keyframes onbAvPulso{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:1;transform:scale(1.12)}}
@media (prefers-reduced-motion:reduce){.onb-bienvenida-avatar,.onb-bienvenida-avatar::before{animation:none}}
.onb-ajustes{display:flex;flex-direction:column;gap:12px;margin-top:6px}
.onb-ajuste{display:flex;flex-direction:column;gap:10px;padding:14px;border-radius:16px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}
.onb-ajuste-cab{display:flex;align-items:center;gap:10px}
.onb-ajuste-cab b{display:block;font-size:.98rem}.onb-ajuste-cab small{display:block;margin-top:2px;font-size:.8rem;line-height:1.3;opacity:.7}
.onb-ajuste-ico{font-size:1.35rem;flex-shrink:0}
.onb-ajuste-fila{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:.92rem}
.onb-ajuste-nota{margin:0;font-size:.8rem;line-height:1.35;opacity:.7}
.onb-ajuste-campo{display:flex;flex-direction:column;gap:6px;font-size:.84rem;font-weight:600}
.onb-ajuste-detalle{display:flex;flex-direction:column;gap:10px}.onb-ajuste-detalle.apagado{opacity:.5;pointer-events:none}
.onb-moneda-input{width:100%}
.onb-moneda-lista{list-style:none;margin:6px 0 0;padding:4px;max-height:210px;overflow-y:auto;border-radius:12px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);background:var(--onb-izq,#080808)}
.onb-moneda-op,.onb-moneda-vacio{padding:.55rem .7rem;border-radius:8px;font-size:.9rem;cursor:pointer}
.onb-moneda-op.activa{background:color-mix(in srgb,var(--accent-1,#8b5cf6) 22%,transparent)}.onb-moneda-op.elegida{font-weight:700}
.onb-moneda-vacio{opacity:.65;cursor:default}
.onb-enlaces-lista{display:flex;flex-direction:column;gap:8px}.onb-enlace-fila{display:flex;align-items:center;gap:10px}.onb-enlace-ico{width:28px;height:28px;display:grid;place-items:center;flex-shrink:0;font-size:1.2rem}.onb-enlace-ico img{width:100%;height:100%;object-fit:cover;border-radius:6px}.onb-enlace-nombre{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.onb-nav-fila{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:.7rem .9rem;border-radius:14px;border:1px solid color-mix(in srgb,currentColor 14%,transparent);background:color-mix(in srgb,currentColor 4%,transparent)}
.onb-nav-fila span{display:flex;align-items:center;gap:10px}
.onb-gemini-pasos{margin:0 0 14px;padding-left:1.25rem;display:flex;flex-direction:column;gap:6px;font-size:.88rem;line-height:1.45}
.onb-gemini-campo{display:flex;flex-direction:column;gap:8px;margin-top:14px}
.onb-wapper-ok{display:flex;flex-direction:column;gap:6px;margin-top:10px;padding:16px;border-radius:16px;border:1px solid color-mix(in srgb,var(--accent-1,#8b5cf6) 50%,transparent);background:color-mix(in srgb,var(--accent-1,#8b5cf6) 12%,transparent)}
.onb-wapper-ok b{font-size:1.1rem}
.onboarding-panel[data-etapa^="ajustes"] .onboarding-copy,.onboarding-panel[data-etapa="wapper-config"] .onboarding-copy{overflow-y:auto;min-height:0}
.onboarding-panel[data-etapa^="ajustes"] .onboarding-layout,.onboarding-panel[data-etapa="wapper-config"] .onboarding-layout{min-height:0}
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
/* Mantiene la tarjeta de la guía fuera del elemento resaltado. Antes solo medía 3 veces
   (0, 450 y 900 ms): si el scroll suave terminaba después, o el objetivo quedaba al final de
   la página (p. ej. «Nueva Materia»), la tarjeta lo tapaba. Ahora vuelve a medir mientras
   dura el scroll y ante cualquier scroll/resize, y elige el lado (abajo o arriba) que no tape. */
function evitarSolape(pop, el) {
  const id = (pop._solapeId = (pop._solapeId || 0) + 1);   // un solo "vigilante" por paso
  const vivo = () => pop.isConnected && el?.isConnected && pop._solapeId === id;
  const choca = (r, top, bottom) => r.bottom > top - 8 && r.top < bottom + 8;
  const medir = () => {
    if (!vivo()) return;
    pop.style.top = ""; pop.style.bottom = "";
    const r = el.getBoundingClientRect(), p = pop.getBoundingClientRect();
    if (!choca(r, p.top, p.bottom)) return;                       // abajo (posición normal) no tapa
    if (!choca(r, 10, 10 + p.height)) { pop.style.top = "10px"; pop.style.bottom = "auto"; }   // arriba sí libra
  };
  const alMover = () => { if (vivo()) medir(); else limpiar(); };
  const limpiar = () => { removeEventListener("scroll", alMover, true); removeEventListener("resize", alMover); };
  addEventListener("scroll", alMover, { capture: true, passive: true });
  addEventListener("resize", alMover);
  const fin = performance.now() + 2500;
  const bucle = () => { if (!vivo()) { limpiar(); return; } medir(); if (performance.now() < fin) requestAnimationFrame(bucle); };
  bucle();
}
function asegurarEstiloGuias() {
  if (document.getElementById("onb-guias-css")) return;
  const e = document.createElement("style"); e.id = "onb-guias-css";
  // Un diálogo que se abra desde la guía debe quedar por ENCIMA de ella, nunca tapado.
  e.textContent = ".modal-overlay,#modal-bloque-flotante,.overlay-alta-semestre{z-index:2147483300!important}";
  document.head.append(e);
}
function crearResaltador() {
  asegurarEstiloGuias();
  const raiz = document.createElement("div");
  raiz.className = "guia-resaltador"; raiz.setAttribute("aria-hidden", "true"); raiz.style.display = "none";
  const lados = [0, 1, 2, 3].map(() => { const d = document.createElement("div"); d.className = "guia-resaltador-lado"; return d; });
  const anillo = document.createElement("div"); anillo.className = "guia-resaltador-anillo";
  raiz.append(...lados, anillo); document.body.append(raiz);
  let objetivo = null, raf = 0, ultimo = "", oculto = false, rebuscar = null, ultimaBusqueda = 0;
  const margen = 6;
  const poner = (el, x, y, w, h) => { el.style.left = x + "px"; el.style.top = y + "px"; el.style.width = Math.max(0, w) + "px"; el.style.height = Math.max(0, h) + "px"; };
  const medir = () => {
    raf = requestAnimationFrame(medir);
    if (objetivo && !oculto && rebuscar && performance.now() - ultimaBusqueda > 150) {
      // La app puede volver a dibujar la sección (p. ej. al sincronizar) y reemplazar el botón: el anillo debe seguirlo, no desaparecer.
      const r0 = objetivo.isConnected ? objetivo.getBoundingClientRect() : null;
      if (!r0 || (!r0.width && !r0.height)) {
        ultimaBusqueda = performance.now();
        let nuevo = null; try { nuevo = rebuscar(); } catch (_) {}
        if (nuevo && nuevo !== objetivo && nuevo.isConnected) { cambiar(nuevo); nuevo.scrollIntoView?.({ behavior: "smooth", block: "center" }); }
      }
    }
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
  const cambiar = (el) => {
    objetivo?.removeEventListener("click", alClic, true);
    objetivo = el || null; ultimo = "";
    objetivo?.addEventListener("click", alClic, true);
  };
  return {
    apuntar(el, buscar) {
      rebuscar = typeof buscar === "function" ? buscar : null;
      cambiar(el); oculto = false;
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
   Cada sección imita la pantalla real (mismos bloques, orden y textos, estado inicial real) con datos de la cuenta demo.
   SOLO DOM + CSS estático. Cada una devuelve { base, extras }: la base siempre se muestra y los extras se agregan,
   de arriba hacia abajo, mientras quepan en el alto disponible (ver llenarExtras). Un extra puede ser [padre, nodo]
   para insertarse dentro de una tarjeta. Los textos fijos pasan por traducirTextoInterfaz; las fechas/horas/montos salen de Intl. */
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

/* Textos con fecha/hora/monto: salen con Intl en el idioma de la interfaz, así no necesitan catálogo. */
const idiomaUI = () => (document.documentElement.lang || "es").toLowerCase();
function fechaUI(y, m, d, opciones) { try { return new Intl.DateTimeFormat(idiomaUI(), opciones).format(new Date(y, m, d)); } catch (e) { return ""; } }
function svgEl(tag, attrs, texto) {
  const e = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs || {}).forEach(([k, v]) => e.setAttribute(k, v));
  if (texto != null) e.textContent = texto;
  return e;
}
const PINK = "#ec4899", CIAN = "#06b6d4", NARANJA2 = "#f97316", INDIGO = "#6366f1", TEAL = "#14b8a6", PURPURA = "#a855f7", GRIS = "#6b7280", CELESTE = "#38bdf8";
const plano = (tag, clase, s) => { const e = document.createElement(tag); if (clase) e.className = clase; e.textContent = s; return e; };
function horaUI(h, m) { try { return new Intl.DateTimeFormat(idiomaUI(), { hour: "numeric", minute: "2-digit" }).format(new Date(2026, 9, 9, h, m || 0)); } catch (e) { return `${h}:${String(m || 0).padStart(2, "0")}`; } }
const mayus = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const rEtiqueta = (t) => nodo("small", "onb-r-etq up", t);
const rTit = (t) => nodo("b", "onb-r-tit", t);
function rPildora(t, color) { const e = nodo("span", "onb-r-chip", t); e.style.setProperty("--c", color); return e; }
function rEstrellas(pct) { const s = nodo("span", "onb-r-est"); const b = nodo("b", "", null); b.textContent = "★★★★★"; b.style.setProperty("--p", `${pct}%`); s.append(b); return s; }
function rBarraFina(pct, color) { const p = rProg(pct, color); p.classList.add("fina"); return p; }
function fmtMonto(n) { try { const i = idiomaUI(); return "₡" + new Intl.NumberFormat(i.startsWith("es") ? "es-CR" : i, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n); } catch (e) { return "₡" + n; } }
const LETRAS_DIAS_ES = ["L", "K", "M", "J", "V", "S", "D"];
const letraDia = (i) => idiomaUI().startsWith("es") ? LETRAS_DIAS_ES[i] : fechaUI(2026, 9, 5 + i, { weekday: "narrow" }).toUpperCase();

/* Datos de ejemplo de la cuenta demo (nombres, colores y metas), en un solo lugar. */
const DEMO = {
  estado: ["Estado Y Gestión Pública", INDIGO],
  derecho: ["Aspectos Políticos Del Derecho Constitucional", AMBAR],
  prog: ["Introducción A La Programación", CELESTE],
  macro: ["Aspectos Políticos De La Macroeconomía", TEAL],
  ideas: ["Ideas Políticas Y Sus Alcances I", PINK],
  analisis: ["Análisis Político Cuantitativo I", PURPURA],
  sistemas: ["Sistemas De Información", "#0e7490"],
  materia: ["Materia", CIAN],
};

function rClase(hora, mat) {
  const it = nodo("div", "onb-r-item onb-r-clase", null, [plano("b", "", hora), nodo("div", "", null, [nodo("b", "", mat[0])]), rSuave("Presencial")]);
  it.style.setProperty("--c", mat[1]); return it;
}
function rNavSemana(texto) { return nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", texto), nodo("span", "onb-r-eng", "›")]); }
function rEstudioMateria(mat, meta) {
  const it = rItem(mat[0], null, mat[1], rSuave(meta));
  return nodo("div", "onb-r-estmat", null, [it, rBarraFina(0, mat[1])]);
}

function esquemaHorario() {
  const g = nodo("div", "onb-r-hor2");
  for (let h = 8; h <= 17; h++) {
    const ln = nodo("span", "onb-r-ln"); ln.style.gridRow = String(h - 6); g.append(ln);
    const lab = nodo("span", "onb-r-hh2"); lab.style.gridColumn = "1"; lab.style.gridRow = String(h - 6);
    let periodo = "";
    try { periodo = new Intl.DateTimeFormat(idiomaUI(), { hour: "numeric", hour12: true }).formatToParts(new Date(2026, 9, 5, h)).find((p) => p.type === "dayPeriod")?.value || ""; } catch (e) {}
    lab.append(plano("b", "", String(periodo ? ((h + 11) % 12) + 1 : h)));
    if (periodo) lab.append(plano("small", "", periodo));
    g.append(lab);
  }
  [5, 6, 7, 8, 9].forEach((d, i) => {
    const c = nodo("span", "onb-r-hd");
    c.append(plano("b", "", letraDia(i)), plano("small", "", fechaUI(2026, 9, d, { day: "numeric", month: "short" })));
    c.style.gridColumn = String(i + 2); c.style.gridRow = "1"; g.append(c);
  });
  const M = DEMO;
  // [columna 1-5, hora inicio, hora fin, materia, ícono]
  [[1, 8, 10, M.estado], [1, 17, 18, M.sistemas], [2, 10, 12, M.derecho, "💻"], [2, 14, 16, M.materia, "💻"], [3, 13, 15, M.derecho],
   [3, 16, 18, M.prog], [4, 8, 10, M.estado], [4, 15, 17, M.analisis, "📖"], [5, 9, 11, M.ideas]].forEach(([col, a, b, mat, icono]) => {
    const bl = nodo("div", "onb-r-blq2", null, [nodo("b", "", mat[0])]);
    if (icono) bl.append(plano("span", "", icono));
    bl.style.gridColumn = String(col + 1); bl.style.gridRow = `${a - 6} / ${b - 6}`; bl.style.background = mat[1]; g.append(bl);
  });
  const ahora = nodo("span", "onb-r-ahora"); ahora.style.gridRow = "9"; g.append(ahora);
  return g;
}

function esquemaSerieFinanzas() {
  const w = 300, h = 140, xs = [40, 88, 136, 184, 232, 280], base = 112;
  const svg = svgEl("svg", { viewBox: `0 0 ${w} ${h}`, class: "onb-r-svg", "aria-hidden": "true" });
  [["600k", 18], ["400k", 46], ["200k", 79], ["0", base]].forEach(([t, y]) => {
    svg.append(svgEl("text", { x: 2, y: y + 3, "font-size": 8, fill: "currentColor", opacity: ".55" }, t));
    if (t !== "0") svg.append(svgEl("line", { x1: 28, x2: 292, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".15", "stroke-dasharray": "3 3" }));
  });
  [["#ef4444", [60, 62, 84, 50, 98, 36]], ["#10b981", [base, base, base, 108, base, 104]], ["#3b82f6", [base, 100, base, 94, 106, base]]].forEach(([color, ys]) => {
    svg.append(svgEl("polyline", { points: xs.map((x, i) => `${x},${ys[i]}`).join(" "), fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round" }));
    xs.forEach((x, i) => svg.append(svgEl("circle", { cx: x, cy: ys[i], r: 2.6, fill: color })));
  });
  ["2023-1", "2023-2", "2024-1", "2024-2", "2025-1", "2025-2"].forEach((t, i) => svg.append(svgEl("text", { x: xs[i], y: 130, "font-size": 7, fill: "currentColor", opacity: ".6", "text-anchor": "middle" }, t)));
  return svg;
}
function esquemaGraficoMetas() {
  const svg = svgEl("svg", { viewBox: "0 0 300 84", class: "onb-r-svg", "aria-hidden": "true" });
  [10, 34, 58].forEach((y) => svg.append(svgEl("line", { x1: 20, x2: 292, y1: y, y2: y, stroke: "currentColor", "stroke-opacity": ".15" })));
  svg.append(svgEl("polyline", { points: "24,70 64,70 104,70 144,70 184,70 224,12 284,12", fill: "none", stroke: "currentColor", "stroke-opacity": ".55", "stroke-width": 1.4, "stroke-dasharray": "4 3" }));
  svg.append(svgEl("polyline", { points: "24,70 284,70", fill: "none", stroke: "#ef4444", "stroke-width": 1.6 }));
  return svg;
}
function rMiniCalendario() {
  const card = rCard(nodo("div", "onb-r-centro", null, [plano("b", "onb-r-tit", mayus(fechaUI(2026, 9, 1, { month: "long", year: "numeric" }))), nodo("small", "onb-r-etq", "Volver a hoy")]));
  const g = nodo("div", "onb-r-cal");
  LETRAS_DIAS_ES.forEach((_, i) => g.append(plano("span", "onb-r-cal-h", letraDia(i))));
  const puntos = { 3: [AZUL, VERDE, NARANJA], 5: [ROJO, AZUL, VERDE], 7: [AZUL], 8: [AZUL, VERDE], 9: [ROJO, NARANJA], 10: [CIAN], 12: [AZUL, VERDE, PURPURA], 16: [ROJO, NARANJA], 19: [GRIS, VERDE, CIAN] };
  [28, 29, 30, ...Array.from({ length: 31 }, (_, i) => i + 1), 1].forEach((n, i) => {
    const fuera = i < 3 || i === 34;
    const c = nodo("span", `onb-r-cal-d${fuera ? " fuera" : ""}${n === 10 && !fuera ? " hoy" : ""}`);
    c.append(plano("b", "", String(n)));
    if (!fuera && puntos[n]) { const p = nodo("i", "onb-r-cal-p"); puntos[n].forEach((col) => { const d = document.createElement("em"); d.style.background = col; p.append(d); }); c.append(p); }
    g.append(c);
  });
  card.append(g); return card;
}
function rMateriaPlan(cod, nombre, color) {
  const m = nodo("div", "onb-r-mat", null, [
    rFila("", nodo("span", "onb-punto"), plano("small", "onb-r-cod", cod), nodo("b", "onb-r-mat-n", nombre), nodo("span", "onb-r-m", "▼")),
    rFila("onb-r-sp", rPildora("Aprobada", "#10b981"), nodo("span", "onb-r-m", "Horas: 6"), rPildora("Créditos: 3", "#6366f1"))]);
  m.style.setProperty("--c", color); return m;
}
function rMapaPlan() {
  const cur = (cod, nombre, estado) => nodo("div", `onb-r-curso ${estado}`, null, [nodo("small", "onb-r-cod", cod), nodo("b", "", nombre)]);
  const col = (t, ...cs) => nodo("div", "onb-r-ciclo-col", null, [nodo("b", "onb-r-ciclo-t", t), ...cs]);
  const cols = nodo("div", "onb-r-ciclos tres", null, [
    col("Ciclo 1", cur("EG-I", "Humanidades I", "ok"), cur("CP-1504", "El poder desde la ciencia política", "ok"), cur("CP-1501", "Epistemología y lógica", "ok")),
    col("Ciclo 2", cur("EG-II", "Humanidades II", "ok"), cur("CP-1502", "Instituciones públicas", "ok"), cur("CP-1503", "Diseño de investigación", "ok")),
    col("Ciclo 3", cur("SR-I", "Realidad nacional I", "pen"), cur("CP-2004", "Análisis cuantitativo I", "cur"), cur("CP-2005", "Ideas políticas I", "cur"))]);
  const svg = svgEl("svg", { class: "onb-r-lineas", "aria-hidden": "true" });
  const mapa = nodo("div", "onb-r-mapa", null, [cols, svg]);
  // Las líneas se miden sobre las tarjetas reales (antes eran porcentajes fijos y quedaban torcidas o cruzando texto).
  const CONEXIONES = [[0, 0, 1, 0], [0, 1, 1, 1], [0, 2, 1, 2], [1, 0, 2, 0], [1, 1, 2, 1]]; // [ciclo, fila] → [ciclo, fila]
  let pendiente = 0;
  const dibujar = () => {
    pendiente = 0;
    if (!mapa.isConnected || !mapa.offsetWidth || !mapa.offsetHeight) return;
    const caja = mapa.getBoundingClientRect(), k = caja.width / mapa.offsetWidth || 1;   // k corrige el scale() del teléfono
    const W = mapa.offsetWidth, H = mapa.offsetHeight;
    svg.setAttribute("viewBox", `0 0 ${W} ${H}`); svg.replaceChildren();
    const tarjeta = (c, f) => cols.children[c]?.querySelectorAll(".onb-r-curso")[f];
    CONEXIONES.forEach(([c1, f1, c2, f2]) => {
      const a = tarjeta(c1, f1), b = tarjeta(c2, f2); if (!a || !b) return;
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      const x1 = (ra.right - caja.left) / k, y1 = (ra.top + ra.height / 2 - caja.top) / k;
      const x2 = (rb.left - caja.left) / k, y2 = (rb.top + rb.height / 2 - caja.top) / k;
      if (x2 - x1 < 2) return;
      svg.append(svgEl("line", { x1, y1, x2, y2, stroke: "#3b82f6", "stroke-width": 1.6, "stroke-linecap": "round" }));
    });
  };
  const programar = () => { if (!pendiente) pendiente = requestAnimationFrame(dibujar); };
  if (typeof ResizeObserver === "function") new ResizeObserver(programar).observe(mapa); else setTimeout(programar, 60);
  return mapa;
}
function rFilaAjuste(t) { return nodo("div", "onb-bloque onb-r-fila onb-r-sp onb-r-ajuste", null, [nodo("b", "", t), nodo("span", "onb-r-m", "▾")]); }
function rFilaNav(t) { return nodo("div", "onb-r-fila onb-r-sp onb-r-navfila", null, [rFila("", nodo("span", "onb-r-m", "⋮⋮"), nodo("span", "", t)), nodo("span", "onb-interruptor")]); }

const fd = (d, o) => fechaUI(2026, 9, d, o);
const diaLargo = (d) => mayus(fd(d, { weekday: "long" }));
const diaCorto = (d) => fd(d, { day: "numeric", month: "short" });
function rDiaCard(d, hoy, ...h) {
  return rCard(rFila("onb-r-sp", nodo("span", "", null, [plano("b", "onb-r-tit", diaLargo(d)), plano("span", "onb-r-m", `  ${diaCorto(d)}`)]), hoy ? nodo("span", "onb-r-hoy", "Hoy") : null), ...h);
}
const rTarea = (t, mat, tipo, color, hora) => rItem(t, mat, color, rTag(tipo, color), hora ? rSuave(hora) : null);
function rLista(titulo, ...items) { return rCard(rTit(titulo), ...items); }

function contenidoEsquema(id) {
  const base = [], extras = [];
  const M = DEMO;
  switch (id) {
    case "resumen": {
      const semana = nodo("div", "onb-bloque onb-r-cab", null, [rProg(55), nodo("b", "onb-r-tit", "Semana 9"), rSuave("Faltan 51 días")]);
      semana.firstChild.style.width = "56px";
      const estudio = rCard(rFila("onb-r-sp", rTit("Estudio de hoy"), nodo("b", "onb-r-m", "0 min de 11 h")), rProg(0),
        rEstudioMateria(M.derecho, "0 min estudiados · meta 6 h"), rEstudioMateria(M.prog, "0 min estudiados · meta 5 h"));
      estudio.classList.add("acento");
      base.push(semana, estudio, rCard(rTit("Clases de hoy"), rEtiqueta("Clases"), rClase(horaUI(8), M.estado), rClase(horaUI(10), M.macro), rClase(horaUI(12), M.derecho)));
      const fechaEx = mayus(fd(16, { weekday: "short", day: "numeric", month: "short" }));
      extras.push(
        rLista("Exámenes próximos", rFila("onb-r-sp", plano("b", "", fechaEx), rSuave("En 6 días")),
          rTarea("Examen: entrega final", M.derecho[0], "Examen", ROJO, horaUI(23, 59)), rTarea("Quiz: entrega final", M.prog[0], "Quiz", NARANJA2, horaUI(23, 59))),
        rLista("Tareas de hoy", rTarea("Lectura capítulo 4", M.ideas[0], "Tarea", AZUL, horaUI(18)), rTarea("Informe de laboratorio", M.analisis[0], "Proyecto", PURPURA, horaUI(23, 59))),
        rLista("Próximas tareas", rTarea("Ensayo corto", M.estado[0], "Tarea", AZUL), rTarea("Taller en grupo", M.macro[0], "Evento", CIAN), rTarea("Cuestionario 3", M.prog[0], "Quiz", NARANJA2)),
        rLista("Próximo evento", rTarea("Charla de orientación", null, "Evento", CIAN, horaUI(14))),
        rLista("Atrasadas", rTarea("Lectura atrasada", M.ideas[0], "Tarea", ROJO)),
        rLista("Requiere atención", rItem("2 tareas pendientes", null, NARANJA, rSuave("›")), rItem("1 examen esta semana", null, ROJO, rSuave("›"))));
      break;
    }
    case "agenda": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cab3", null, [nodo("div", "onb-r-centro", null, [nodo("b", "onb-r-ciclo", "II Ciclo 2026"),
        rFila("onb-r-sp", nodo("span", "onb-r-mas", "+"),
          nodo("div", "onb-r-centro", null, [nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", "Semana 9"), nodo("span", "onb-r-eng", "›")]),
            nodo("span", "onb-r-m", null, [plano("span", "", `5 - 11 ${fd(11, { month: "short" })} · `), nodo("u", "", "Hoy")])]),
          nodo("span", "onb-r-eng", "⚙️"))])]);
      base.push(rPills(["Lista", "Calendario", "Cronograma"], 0), cab, nodo("div", "onb-r-buscar", "Buscar en toda la Agenda..."));
      const tinte = (m, meta) => { const e = rItem(m[0], null, m[1], rSuave(meta)); e.classList.add("tinte"); return e; };
      extras.push(
        nodo("div", "onb-r-chips centro", null, [["Clase", PINK], ["Completado", "#3b82f6"], ["Perdida", GRIS], ["Pendiente", "#f59e0b"], ["Tarea", "#3b82f6"], ["Examen", ROJO], ["Evento", CIAN], ["Feriado", "#10b981"], ["Proyecto", PURPURA], ["Quiz", NARANJA2]].map(([t, col]) => rPildora(t, col))),
        nodo("div", "onb-bloque onb-r-fila", null, [rSuave("‹  5 días anteriores")]),
        rDiaCard(10, true, rEtiqueta("Estudio para hoy"), tinte(M.derecho, "0 min de 6 h"), tinte(M.prog, "0 min de 5 h"),
          rEtiqueta("Clases"), rClase(horaUI(8), M.estado), rClase(horaUI(10), M.macro), rEtiqueta("Examen"), rTarea("Examen: avance grupal", M.derecho[0], "Examen", ROJO, horaUI(12))),
        rDiaCard(11, false, rEtiqueta("Tarea"), rTarea("Lectura capítulo 4", M.ideas[0], "Tarea", AZUL, horaUI(18)), rEtiqueta("Proyecto"), rTarea("Informe de laboratorio", M.analisis[0], "Proyecto", PURPURA)),
        rDiaCard(12, false, rEtiqueta("Evento"), rTarea("Charla de orientación", null, "Evento", CIAN, horaUI(14)), rEtiqueta("Quiz"), rTarea("Quiz: capítulos 1 a 3", M.prog[0], "Quiz", NARANJA2, horaUI(9))),
        rDiaCard(13, false, rEtiqueta("Feriado"), rTarea("Día festivo", null, "Feriado", "#10b981")),
        rMiniCalendario());
      break;
    }
    case "horario": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cab3", null, [nodo("div", "onb-r-centro", null, [nodo("span", "onb-r-m", "II Ciclo 2026"),
        nodo("div", "onb-r-fila onb-r-navsem", null, [nodo("span", "onb-r-eng", "‹"), nodo("b", "onb-r-tit", "Semana 9"), nodo("span", "onb-r-eng", "›")]),
        plano("span", "onb-r-m", diaCorto(10))])]);
      const botones = rFila("onb-r-sp onb-r-botonesh", rBoton("+ Agregar"), nodo("span", "onb-r-eng", "⬇"), nodo("span", "onb-r-eng", "⛶"), rBoton("Amigos", true));
      base.push(cab, botones, nodo("div", "onb-bloque onb-r-horario est", null, [esquemaHorario()]));
      break;
    }
    case "tiempo-estudio": {
      const cab = nodo("div", "onb-bloque onb-r-cab onb-r-cabte", null, [nodo("span", "onb-r-eng", "⏮"), nodo("b", "onb-r-tit onb-r-nomte", "CP-2004 · Análisis cuantitativo I"), nodo("span", "onb-r-eng", "⚙️")]);
      const aro = nodo("div", "onb-aro"); aro.style.background = "color-mix(in srgb,var(--accent-1,#8b5cf6) 22%,transparent)";
      const anillo = nodo("div", "onb-r-aro g", null, [aro, nodo("b", "onb-r-tiempo", null)]); anillo.lastChild.textContent = "00:00";
      const caja = (v, t) => nodo("div", "onb-r-caja ancha", null, [nodo("b", "", v), nodo("small", "", t)]);
      base.push(cab, nodo("div", "onb-bloque onb-r-card onb-r-principalte", null, [nodo("div", "onb-r-centro", null, [anillo]), nodo("span", "onb-r-btn grande", "▷ Iniciar"), caja("0 min", "Estudiado"), caja("5 h", "Faltan"), caja("5 h", "Meta")]));
      const ses = (d, dur, m) => rItem(d, m[0], m[1], rSuave(dur));
      const mat = (m, meta) => rItem(m[0], meta, m[1], nodo("span", "onb-r-mas", "▶"));
      const stat = (v, t) => nodo("div", "onb-r-caja ancha", null, [plano("b", "", v), nodo("small", "", t)]);
      const comp = (t, pc, c) => nodo("div", "onb-r-estmat", null, [rFila("onb-r-sp", nodo("span", "", t), plano("span", "onb-r-m", `${pc}%`)), rBarraFina(pc, c)]);
      extras.push(
        rCard(rTit("Resumen de metas"), rNavSemana("Semana 9"), esquemaGraficoMetas(),
          nodo("div", "onb-r-leyenda", null, [["Estudiado: 0 min", "#ef4444"], ["Meta semana: 5 h", GRIS]].map(([t, col]) => { const e = nodo("span", "", t); e.style.setProperty("--c", col); return e; }))),
        rCard(rTit("Horas estudiadas"), rPills(["Semana", "Semestre"], 0), rNavSemana("Semana 9"),
          nodo("div", "onb-r-vacio", "Sin sesiones registradas en este período: prueba con el navegador de arriba.")),
        rCard(rTit("Estadísticas"), nodo("div", "onb-fila3", null, [stat("🔥 0", "Racha"), stat("0 h", "Total"), stat("0", "Sesiones")])),
        rLista("Competencias", comp("Constancia", 20, TEAL), comp("Enfoque", 35, AZUL), comp("Cumplimiento de metas", 10, AMBAR)),
        rLista("Sesiones recientes", ses(diaCorto(9), "45 min", M.estado), ses(diaCorto(8), "1 h 20 min", M.prog), ses(diaCorto(7), "30 min", M.derecho)),
        rLista("Materias", mat(M.estado, "0 min de 4 h"), mat(M.macro, "0 min de 5 h"), mat(M.derecho, "0 min de 6 h")));
      break;
    }
    case "semestres": {
      const fila = (n, cred) => nodo("div", "onb-r-fila onb-r-semfila", null, [nodo("b", "onb-r-semn", n), nodo("span", "onb-r-m", "···"), rPildora(cred, INDIGO), nodo("span", "onb-r-m", "▼")]);
      const caja = (n, cred) => nodo("div", "onb-bloque onb-r-semwrap", null, [fila(n, cred)]);
      const semActual = caja("II Ciclo 2026", "Créditos: 21");
      const actual = rCard(rTit("Semestre actual"), semActual, rFila("onb-r-sp onb-r-botonesh dos", rBoton("+ Agregar", true), rBoton("Editar semestres", true)));
      const p1 = caja("I Ciclo 2026", "Créditos: 18"), p2 = caja("Verano 2025", "Créditos: 6"), p3 = caja("II Ciclo 2025", "Créditos: 20");
      const pasados = rCard(rTit("Semestres pasados"), p1, p2, p3);
      base.push(nodo("div", "onb-bloque onb-r-fila onb-r-sp", null, [rTit("Historial académico"), nodo("span", "onb-r-m", "▼")]), actual, pasados);
      const mat = (cod, nombre, nota, color, est) => {
        const m = nodo("div", "onb-r-curso2", null, [
          rFila("onb-r-sp", nodo("span", "", null, [nodo("small", "onb-r-cod", cod), nodo("b", "", `  ${nombre}`)]), nodo("b", "", `Nota: ${nota}`)),
          rFila("onb-r-sp", rPildora(est || "Cursando", est ? "#10b981" : "#f59e0b"), rPildora("Créditos: 3", "#3b82f6"))]);
        m.style.setProperty("--c", color); return m;
      };
      extras.push([semActual, mat("CP-2001", M.estado[0], 85, INDIGO)], [semActual, mat("CP-2002", M.macro[0], 70, TEAL)], [semActual, mat("CP-2003", M.derecho[0], 78, AMBAR)],
        [p1, mat("EG-I", "Humanidades I", 90, PINK, "Aprobada")], [pasados, caja("I Ciclo 2025", "Créditos: 17")], [pasados, caja("II Ciclo 2024", "Créditos: 19")]);
      break;
    }
    case "finanzas": {
      const aro = nodo("div", "onb-aro"); aro.style.background = "conic-gradient(#ef4444 0 82%,color-mix(in srgb,currentColor 16%,transparent) 82% 100%)";
      const anillo = nodo("div", "onb-r-aro g", null, [aro]);
      const lin = (pct, t, monto, color) => { const f = nodo("div", "onb-r-fin", null, [plano("b", "", pct), nodo("span", "", t), plano("b", "", monto)]); f.firstChild.style.color = color; return f; };
      const par = (t, monto, color) => { const d = nodo("i", "onb-r-pt"); d.style.background = color; return nodo("span", "onb-r-fila", null, [d, nodo("span", "", t), plano("b", "", monto)]); };
      const bal = nodo("div", "onb-r-fila onb-r-balfila", null, [nodo("span", "onb-r-m", "Balance total:"), plano("b", "onb-r-bal", fmtMonto(180700))]);
      base.push(rCard(rTit("Resumen"), nodo("div", "onb-r-centro", null, [anillo]), lin("82%", "Gastado", fmtMonto(842300), "#ef4444"), lin("18%", "Disponible", fmtMonto(180700), "#10b981"),
          rFila("onb-r-sp", par("Beca:", fmtMonto(400000), "#10b981"), par("Ingresos:", fmtMonto(623000), "#3b82f6")), bal),
        rCard(rTit("Por semestre"), esquemaSerieFinanzas(),
          nodo("div", "onb-r-leyenda", null, [["Gastos", "#ef4444"], ["Beca", "#10b981"], ["Ingresos", "#3b82f6"]].map(([t, col]) => { const e = nodo("span", "", t); e.style.setProperty("--c", col); return e; }))));
      const mov = (n, d, monto, col) => rItem(n, diaCorto(d), col, plano("b", "", monto));
      const cat = (n, pct, monto, col) => nodo("div", "onb-r-estmat", null, [rFila("onb-r-sp", nodo("span", "", n), plano("b", "", monto)), rBarraFina(pct, col)]);
      extras.push(
        rLista("Por categoría", cat("Matrícula", 70, fmtMonto(310000), "#ef4444"), cat("Alimentación", 40, fmtMonto(168000), "#f59e0b"), cat("Transporte", 22, fmtMonto(94500), "#3b82f6"), cat("Materiales", 12, fmtMonto(52000), "#a855f7")),
        rLista("Movimientos recientes", mov("Matrícula", 2, `-${fmtMonto(310000)}`, "#ef4444"), mov("Beca", 1, `+${fmtMonto(400000)}`, "#10b981"), mov("Almuerzo", 8, `-${fmtMonto(4200)}`, "#ef4444"), mov("Transporte", 7, `-${fmtMonto(24500)}`, "#ef4444"), mov("Trabajo freelance", 5, `+${fmtMonto(85000)}`, "#10b981")));
      break;
    }
    case "plan-estudios": {
      const lista = nodo("div", "onb-bloque onb-r-card", null, [rFila("onb-r-sp", rTit("Bloque 1"), nodo("span", "onb-r-m", "▲"))]);
      base.push(nodo("div", "onb-bloque onb-r-card", null, [rMapaPlan()]), lista);
      [["EG-I", "Humanidades I", "#f59e0b"], ["EG-II", "Humanidades II", "#dc2626"], ["CP-1501", "Epistemología y lógica", "#d946ef"], ["CP-1502", "Instituciones públicas", "#34d399"], ["CP-1503", "Diseño de investigación", "#a855f7"], ["CP-1504", "El poder desde la ciencia política", "#3b82f6"], ["SE-1100", "Actividad cultural I", "#ec4899"]]
        .forEach(([cod, n, col], i) => { const m = rMateriaPlan(cod, n, col); if (i < 2) lista.append(m); else extras.push([lista, m]); });
      const blq = (n) => nodo("div", "onb-bloque onb-r-fila onb-r-sp", null, [rTit(n), nodo("span", "onb-r-m", "▼")]);
      extras.push(blq("Bloque 2"), blq("Bloque 3"), blq("Optativas"));
      break;
    }
    case "comunidad": {
      const doc = (n, pct, ok) => nodo("div", "onb-bloque onb-r-doc", null, [nodo("b", "", n), rEstrellas(pct), rPildora(ok ? "✓ Recomendado" : "✕ No recomendado", ok ? "#10b981" : ROJO), nodo("span", "onb-r-m", "▼")]);
      const docAbierto = nodo("div", "onb-bloque onb-r-card", null, [
        rFila("onb-r-sp", nodo("b", "", "Prof. Sofía Chacón"), rEstrellas(70), rPildora("✓ Recomendado", "#10b981"), nodo("span", "onb-r-m", "▲")),
        rFila("onb-r-sp", rSuave("Tu valoración"), rEstrellas(70)), rFila("onb-r-sp", rSuave("Materia"), nodo("span", "", M.estado[0])),
        nodo("small", "onb-r-etq", "Comentario: explica con claridad y deja ejemplos de repaso.")]);
      base.push(rCard(rTit("Comunidad"), nodo("small", "onb-r-etq", "Profesores y compañeros con los que compartiste clase."), rPills(["Profesores", "Compañeros"], 0)),
        nodo("div", "onb-bloque onb-r-card", null, [nodo("div", "onb-r-buscar", "Buscar profesor por nombre..."), rPills(["Todos", "Fue profe", "No fue profe"], 0), rPills(["Todos", "Recomendado", "No recomendado"], 0), rPills(["Alfabético", "Por bloque"], 0)]));
      extras.push(doc("Prof. Natalia Vega", 92, true), docAbierto, doc("Prof. Esteban Rojas", 60, false), doc("Prof. Laura Jiménez", 84, true), doc("Prof. Pablo Araya", 80, true),
        doc("Prof. Marcos Alvarado", 0, true), doc("Prof. Elena Mora", 76, true), doc("Prof. Diego Salas", 48, false));
      break;
    }
    case "asistente": {
      const burb = (clase, t) => nodo("div", `onb-r-msg ${clase}`.trim(), t);
      const tarjeta = (emoji, t, sub) => nodo("div", "onb-bloque onb-r-nota", null, [nodo("b", "", `${emoji} ${traducirTextoInterfaz(t)}`), nodo("small", "onb-r-etq", sub),
        nodo("small", "onb-r-etq", "Agregado por asistente"), nodo("span", "onb-r-acc", null, [nodo("span", "e", "Editar"), nodo("span", "x", "Eliminar")])]);
      const largo = (d) => `${fd(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · ${traducirTextoInterfaz("Todo el día")}`;
      const hilo = nodo("div", "onb-r-hilo", null, [
        burb("", "¡Hola! Soy Wapper 👋, tu asistente académico. ¿Tienes alguna tarea, examen o evento que quieras agregar?"),
        burb("yo", "Tengo laboratorio la próxima semana y acuérdame del quiz del viernes"),
        burb("", "Guardé 2 cosas en tu Agenda:"), tarjeta("✅", "Laboratorio", largo(12)), tarjeta("📝", "Quiz", largo(16))]);
      base.push(hilo, nodo("div", "onb-r-entrada", null, [nodo("span", "onb-r-m", "Ejemplo: Reunión de grupo el sábado a las 10am"), nodo("span", "onb-r-mas", "➤")]));
      extras.push([hilo, burb("yo", "¿Qué tengo pendiente esta semana?")], [hilo, burb("", "Esta semana tienes 3 pendientes:")], [hilo, tarjeta("📌", "Informe de lectura", largo(13))],
        [hilo, burb("yo", "Mueve el quiz para el lunes")], [hilo, burb("", "Listo, moví el quiz al lunes.")]);
      break;
    }
    case "configuracion": {
      base.push(rFilaAjuste("Ajustes generales"), rFilaAjuste("Asistente IA (Gemini)"), rFilaAjuste("Notificaciones"), rFilaAjuste("Personalizar"),
        rFilaAjuste("Horario"), rFilaAjuste("Plan de Estudios activo"), rFilaAjuste("Enlaces rápidos"), rFilaAjuste("Datos"));
      extras.push(rFilaAjuste("Créditos"));
      break;
    }
    default:
      base.push(rCard(rProg(70), rProg(50)));
  }
  return { base, extras };
}

function construirEsquema(id, nombre, conEncabezado) {
  const { base, extras } = contenidoEsquema(id);
  const cuerpo = nodo("div", "onb-r", null, base);
  const marco = elDiv("onb-marco");
  // En teléfono no hay encabezado (era espacio muerto); en pantallas grandes se conserva.
  if (conEncabezado) { const titulo = document.createElement("span"); titulo.textContent = traducirTextoInterfaz(nombre); marco.append(elDiv("onb-es-top", document.createElement("i"), titulo)); }
  marco.append(cuerpo);
  marco._extras = extras;
  return marco;
}
/* Relleno progresivo: agrega extras de arriba hacia abajo mientras quepan en el alto disponible. */
function llenarExtras(marco) {
  const cuerpo = marco.querySelector(".onb-r"); if (!cuerpo) return;
  const lista = marco._extras || [];
  lista.forEach((e) => (Array.isArray(e) ? e[1] : e).remove());
  for (const e of lista) {
    const [padre, n] = Array.isArray(e) ? e : [cuerpo, e];
    padre.append(n);
    if (cuerpo.scrollHeight > cuerpo.clientHeight + 1) { n.remove(); continue; }
  }
}

/* ── Piezas de «Bienvenida», «Activa Wapper» y «Últimos ajustes» ─────────── */
const sinTildes = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
// Sinónimos para buscar la moneda por país o por código (CRC, USD…); si una moneda no está aquí se busca por su código y nombre.
const ALIAS_MONEDAS = {
  CRC: "costa rica colon colones", USD: "dolar dolares estados unidos eeuu usa united states ecuador el salvador panama puerto rico",
  EUR: "euro euros europa union europea espana alemania francia italia portugal irlanda", MXN: "mexico peso mexicano",
  COP: "colombia peso colombiano", ARS: "argentina peso argentino", CLP: "chile peso chileno", PEN: "peru sol soles",
  BRL: "brasil real reales", GBP: "reino unido inglaterra libra esterlina", CAD: "canada dolar canadiense",
  GTQ: "guatemala quetzal", HNL: "honduras lempira", NIO: "nicaragua cordoba", DOP: "republica dominicana peso dominicano",
  UYU: "uruguay peso uruguayo", PYG: "paraguay guarani", BOB: "bolivia boliviano", VES: "venezuela bolivar",
  JPY: "japon yen", CNY: "china yuan renminbi", CHF: "suiza franco suizo", AUD: "australia dolar australiano",
  CUP: "cuba peso cubano", KRW: "corea won", INR: "india rupia",
};
function filtrarMonedas(consulta) {
  const lista = MONEDAS_DISPONIBLES || [], q = sinTildes(consulta).trim();
  if (!q) return lista.slice();
  const tokens = q.split(/\s+/);
  const puntaje = (m) => { const id = sinTildes(m.id); return id === q ? 0 : id.startsWith(q) ? 1 : 2; };
  return lista
    .map((m) => ({ m, h: sinTildes(`${m.id} ${m.simbolo} ${m.etiqueta} ${ALIAS_MONEDAS[m.id] || ""}`) }))
    .filter(({ h }) => tokens.every((t) => h.includes(t)))
    .sort((a, b) => puntaje(a.m) - puntaje(b.m)).map((x) => x.m);
}
// Selector de moneda con teclado: escribe «USD», «CRC» o el país («Estados Unidos», «Costa Rica») y filtra al instante.
function construirBuscadorMoneda({ valorInicial, onElegir }) {
  const monedas = MONEDAS_DISPONIBLES || [];
  const rotulo = (m) => `${m.simbolo} ${m.etiqueta} · ${m.id}`;
  let actual = monedas.find((m) => m.id === valorInicial) || monedas.find((m) => m.id === "CRC") || monedas[0];
  const raiz = document.createElement("div"); raiz.className = "onb-moneda";
  const input = document.createElement("input");
  input.type = "text"; input.className = "form-input onb-moneda-input"; input.autocomplete = "off"; input.spellcheck = false;
  input.autocapitalize = "off"; input.enterKeyHint = "done";
  input.setAttribute("role", "combobox"); input.setAttribute("aria-expanded", "false");
  input.setAttribute("aria-label", traducirTextoInterfaz("Moneda local"));
  input.placeholder = traducirTextoInterfaz("Busca por país o código (CRC, USD…)");
  const lista = document.createElement("ul"); lista.className = "onb-moneda-lista"; lista.setAttribute("role", "listbox"); lista.hidden = true;
  let visibles = [], activo = 0;
  const pintarLista = () => {
    lista.replaceChildren();
    if (!visibles.length) { const v = document.createElement("li"); v.className = "onb-moneda-vacio"; v.textContent = traducirTextoInterfaz("Sin resultados"); lista.append(v); return; }
    visibles.forEach((m, i) => {
      const li = document.createElement("li"); li.setAttribute("role", "option");
      li.className = `onb-moneda-op${i === activo ? " activa" : ""}${m.id === actual?.id ? " elegida" : ""}`; li.textContent = rotulo(m);
      li.addEventListener("pointerdown", (ev) => { ev.preventDefault(); elegir(m); });
      lista.append(li);
    });
    lista.querySelector(".activa")?.scrollIntoView({ block: "nearest" });
  };
  const abrir = (q = "") => { visibles = filtrarMonedas(q); activo = 0; lista.hidden = false; input.setAttribute("aria-expanded", "true"); pintarLista(); };
  const cerrar = () => { lista.hidden = true; input.setAttribute("aria-expanded", "false"); if (actual) input.value = rotulo(actual); };
  const elegir = (m) => { actual = m; cerrar(); input.blur(); onElegir?.(m.id); };
  if (actual) input.value = rotulo(actual);
  input.addEventListener("focus", () => { input.select(); abrir(""); });
  input.addEventListener("input", () => abrir(input.value));
  input.addEventListener("blur", cerrar);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowDown") { ev.preventDefault(); if (lista.hidden) abrir(input.value); else { activo = Math.min(visibles.length - 1, activo + 1); pintarLista(); } }
    else if (ev.key === "ArrowUp") { ev.preventDefault(); activo = Math.max(0, activo - 1); pintarLista(); }
    else if (ev.key === "Enter") { ev.preventDefault(); if (visibles[activo]) elegir(visibles[activo]); }
    else if (ev.key === "Escape") { ev.preventDefault(); cerrar(); input.blur(); }
  });
  raiz.append(input, lista); return raiz;
}
function construirInterruptor(activo, onCambiar, etiquetaAria) {
  const label = document.createElement("label"); label.className = "switch switch-tema";
  const chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = Boolean(activo);
  if (etiquetaAria) chk.setAttribute("aria-label", traducirTextoInterfaz(etiquetaAria));
  const track = document.createElement("span"); track.className = "track"; track.innerHTML = '<span class="thumb"></span>';
  chk.addEventListener("change", () => onCambiar(chk.checked, chk));
  label.append(chk, track); return { label, chk };
}
function bloqueAjuste(icono, titulo, descripcion, ...hijos) {
  const b = document.createElement("section"); b.className = "onb-ajuste";
  const cab = document.createElement("div"); cab.className = "onb-ajuste-cab";
  const ico = document.createElement("span"); ico.className = "onb-ajuste-ico"; ico.textContent = icono;
  const t = document.createElement("div"); const h = document.createElement("b"); h.textContent = traducirTextoInterfaz(titulo); t.append(h);
  if (descripcion) { const s = document.createElement("small"); s.textContent = traducirTextoInterfaz(descripcion); t.append(s); }
  cab.append(ico, t); b.append(cab, ...hijos); return b;
}
const etiquetaHora12 = (h) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? "am" : "pm"}`;
function notaAjuste(texto) { const p = document.createElement("p"); p.className = "onb-ajuste-nota"; p.textContent = traducirTextoInterfaz(texto); return p; }
function campoConEtiqueta(texto, control) {
  const l = document.createElement("label"); l.className = "onb-ajuste-campo";
  const s = document.createElement("span"); s.textContent = traducirTextoInterfaz(texto); l.append(s, control); return l;
}
// Notificaciones: mismos campos de configuración que Ajustes. Recordatorios y resumen solo funcionan con Google Calendar conectado.
function construirBloqueNotificaciones({ cfg, borrador, demo }) {
  const calActiva = () => { try { return Boolean(sincronizacionCalendarActiva()); } catch (_) { return false; } };
  const detalle = document.createElement("div"); detalle.className = "onb-ajuste-detalle";
  const marcar = () => detalle.classList.toggle("apagado", !calActiva());
  const guardado = cfg.notificaciones_recordatorios?.tarea;
  const inicial = borrador.recordatorio || (Array.isArray(guardado) ? guardado[0] : guardado) || "1_dia";
  const selAntes = document.createElement("select"); selAntes.className = "form-input";
  (OFFSETS_RECORDATORIO_AGENDA || []).forEach((o) => { const op = document.createElement("option"); op.value = o.id; op.textContent = traducirTextoInterfaz(o.etiqueta); selAntes.append(op); });
  selAntes.value = inicial; if (selAntes.value !== inicial && selAntes.options[0]) selAntes.value = selAntes.options[0].value;
  selAntes.addEventListener("change", () => { borrador.recordatorio = selAntes.value; borrador.tocado = true; });
  const r0 = cfg.notificaciones_resumen_diario || { activo: false, hora: "20:00" };
  const resumen = borrador.resumen || { activo: Boolean(r0.activo), hora: r0.hora || "20:00" };
  const selHora = document.createElement("select"); selHora.className = "form-input";
  for (let h = 0; h < 24; h++) { const op = document.createElement("option"); op.value = `${String(h).padStart(2, "0")}:00`; op.textContent = etiquetaHora12(h); selHora.append(op); }
  selHora.value = resumen.hora;
  const campoHora = campoConEtiqueta("Hora del resumen", selHora); campoHora.hidden = !resumen.activo;
  selHora.addEventListener("change", () => { resumen.hora = selHora.value; borrador.resumen = resumen; borrador.tocado = true; });
  const swResumen = construirInterruptor(resumen.activo, (v) => { resumen.activo = v; borrador.resumen = resumen; borrador.tocado = true; campoHora.hidden = !v; }, "Resumen diario");
  const filaResumen = document.createElement("div"); filaResumen.className = "onb-ajuste-fila";
  const tr = document.createElement("span"); tr.textContent = traducirTextoInterfaz("Resumen diario de tus pendientes"); filaResumen.append(tr, swResumen.label);
  detalle.append(campoConEtiqueta("Avisarme antes de tareas, exámenes y eventos", selAntes), filaResumen, campoHora);
  const swCal = construirInterruptor(calActiva(), async (v, chk) => {
    chk.disabled = true;
    try {
      if (v) { const ok = await activarSincronizacionCalendario(); if (!ok) chk.checked = false; }
      else await desactivarSincronizacionCalendario();
    } catch (_) { chk.checked = calActiva(); }
    chk.disabled = false; marcar();
  }, "Recordatorios en Google Calendar");
  const fila = document.createElement("div"); fila.className = "onb-ajuste-fila";
  const t = document.createElement("span"); t.textContent = traducirTextoInterfaz("Recordatorios en Google Calendar"); fila.append(t, swCal.label);
  const envoltura = document.createElement("div"); envoltura.className = "onb-ajuste-detalle";
  if (demo) { swCal.chk.disabled = true; envoltura.append(fila, notaAjuste("Disponible al iniciar sesión con tu cuenta de Google.")); detalle.classList.add("apagado"); }
  else { envoltura.append(fila, notaAjuste("Conecta Google Calendar para recibir avisos nativos de tus tareas, exámenes y eventos.")); marcar(); }
  envoltura.append(detalle); return envoltura;
}
const SECCIONES_NAV = [
  { id: "agenda", etiqueta: "Agenda", icono: "📖" }, { id: "horario", etiqueta: "Horario", icono: "🗓️" },
  { id: "semestres", etiqueta: "Semestres", icono: "📅" }, { id: "comunidad", etiqueta: "Comunidad", icono: "👥" },
  { id: "finanzas", etiqueta: "Finanzas", icono: "💰" }, { id: "plan-estudios", etiqueta: "Plan de Estudios", icono: "📚" },
  { id: "tiempo-estudio", etiqueta: "Tiempo", icono: "⏱️" }, { id: "asistente", etiqueta: "Asistente", icono: "✨" },
];
function fotoPerfilGoogle() {
  const src = document.getElementById("perfil-foto")?.getAttribute("src") || "";
  if (src.trim()) return src;
  const p = estado.datos?.perfil || {};
  return p.foto || p.foto_url || p.picture || p.avatar || p.imagen || "";
}
function construirAvatarBienvenida(nombre) {
  const caja = document.createElement("div"); caja.className = "onb-bienvenida-avatar"; caja.setAttribute("aria-hidden", "true");
  const conInicial = () => { caja.replaceChildren(); const s = document.createElement("span"); s.textContent = (String(nombre || "").trim()[0] || "✨").toUpperCase(); caja.append(s); };
  const src = MODO_DEMO ? "" : fotoPerfilGoogle();
  if (!src) { conInicial(); return caja; }
  const img = document.createElement("img"); img.alt = ""; img.referrerPolicy = "no-referrer"; img.decoding = "async"; img.onerror = conInicial; img.src = src;
  caja.append(img); return caja;
}
// Texto EXACTO de Ajustes → Asistente IA (Gemini), para que el usuario vea las mismas instrucciones.
const GEMINI_INTRO = "Creá tareas, exámenes y eventos hablando o escribiendo en lenguaje natural, sin llenar el formulario a mano. Usa Gemini, el modelo de IA de Google, con tu propia clave. Es gratis y solo vos la ves (no la vemos nosotros, solo Google).";
const GEMINI_PASOS = [
  "Tocá el botón \"Abrir Google AI Studio\" de abajo.",
  "Iniciá sesión con tu cuenta de Google si te lo pide.",
  "En la esquina superior derecha vas a ver un botón de clave de API. Tocalo.",
  "Se abre una ventana que pide un nombre para la clave y un proyecto. Podés dejar los dos con el valor que aparece por defecto, no hace falta cambiar nada.",
  "Tocá \"Crear\".",
  "Te va a aparecer la clave con un botón \"Copiar\" abajo. Tocalo para copiarla.",
  "Volvé a esta pantalla, pegala en el campo de abajo y tocá \"Guardar\".",
];
function botonDesdeCero() { return [...document.querySelectorAll("#seccion-plan-estudios button")].find((b) => /desde cero|da zero|from scratch/i.test(b.textContent)); }
function grupoMetodosImportar() { const g = [...document.querySelectorAll("#seccion-plan-estudios .pill-group")]; return g.find((x) => x.querySelectorAll("button").length >= 3) || g.find((x) => x.querySelectorAll("button").length >= 2); }
function seccionNavegacionAjustes() {
  const lista = document.getElementById("lista-nav-oculta"), sec = lista?.closest(".ajuste-seccion");
  if (sec?.classList.contains("colapsada")) sec.querySelector(".ajuste-seccion-cabecera")?.click();
  return lista || sec || null;
}

// Enlaces rápidos dentro del onboarding: mismos datos que Ajustes (nombre, URL, emoji o imagen comprimida). Se guardan al terminar.
function construirBloqueEnlaces({ cfg, borrador }) {
  const limite = LIMITE_ENLACES_RAPIDOS || 20;
  const existentes = Array.isArray(cfg.enlaces_rapidos) ? cfg.enlaces_rapidos.length : 0;
  const caja = document.createElement("div"); caja.className = "onb-ajuste-detalle";
  const lista = document.createElement("div"); lista.className = "onb-enlaces-lista";
  const nombre = document.createElement("input"); nombre.className = "form-input"; nombre.maxLength = 40; nombre.placeholder = traducirTextoInterfaz("Nombre (ej. Matrícula)");
  const url = document.createElement("input"); url.className = "form-input"; url.type = "url"; url.inputMode = "url"; url.autocapitalize = "off"; url.placeholder = "https://";
  let tipo = "emoji";
  const bEmoji = document.createElement("button"), bImg = document.createElement("button");
  [bEmoji, bImg].forEach((b) => { b.type = "button"; });
  bEmoji.textContent = traducirTextoInterfaz("Emoji"); bImg.textContent = traducirTextoInterfaz("Imagen");
  const emoji = document.createElement("input"); emoji.className = "form-input"; emoji.value = "🔗"; emoji.maxLength = 4; emoji.setAttribute("aria-label", "Emoji");
  const archivo = document.createElement("input"); archivo.type = "file"; archivo.accept = "image/*"; archivo.className = "form-input"; archivo.hidden = true;
  const marcarTipo = () => {
    bEmoji.className = `btn ${tipo === "emoji" ? "btn-primary" : "btn-secondary"}`; bImg.className = `btn ${tipo === "imagen" ? "btn-primary" : "btn-secondary"}`;
    emoji.hidden = tipo !== "emoji"; archivo.hidden = tipo !== "imagen";
  };
  bEmoji.addEventListener("click", () => { tipo = "emoji"; marcarTipo(); });
  bImg.addEventListener("click", () => { tipo = "imagen"; marcarTipo(); });
  const filaTipo = document.createElement("div"); filaTipo.className = "onb-ajuste-fila"; filaTipo.append(bEmoji, bImg);
  const error = document.createElement("p"); error.className = "onboarding-nota-error"; error.hidden = true; error.setAttribute("role", "alert");
  const agregar = document.createElement("button"); agregar.type = "button"; agregar.className = "btn btn-secondary"; agregar.textContent = traducirTextoInterfaz("+ Añadir enlace");
  const pintar = () => {
    lista.replaceChildren();
    borrador.enlaces.forEach((e, i) => {
      const fila = document.createElement("div"); fila.className = "onb-enlace-fila";
      const ico = document.createElement("span"); ico.className = "onb-enlace-ico";
      if (e.icono_tipo === "emoji") ico.textContent = e.icono_valor;
      else { const img = document.createElement("img"); img.alt = ""; img.src = e.icono_valor; img.addEventListener("error", () => { ico.textContent = "🔗"; }); ico.append(img); }
      const n = document.createElement("span"); n.className = "onb-enlace-nombre"; n.textContent = e.nombre;
      const quitar = document.createElement("button"); quitar.type = "button"; quitar.className = "btn btn-secondary"; quitar.textContent = "×"; quitar.setAttribute("aria-label", traducirTextoInterfaz("Quitar enlace"));
      quitar.addEventListener("click", () => { borrador.enlaces.splice(i, 1); pintar(); });
      fila.append(ico, n, quitar); lista.append(fila);
    });
    agregar.disabled = existentes + borrador.enlaces.length >= limite;
  };
  agregar.addEventListener("click", async () => {
    const nom = nombre.value.trim(); let u = url.value.trim();
    const fallo = (m) => { error.textContent = traducirTextoInterfaz(m); error.hidden = false; };
    if (!nom || !u) return fallo("El nombre y la URL son obligatorios.");
    if (!/^[a-z][a-z0-9+.-]*:/i.test(u)) u = `https://${u}`;
    let icono_tipo = "emoji", icono_valor = emoji.value.trim() || "🔗";
    if (tipo === "imagen") {
      const f = archivo.files?.[0]; if (!f) return fallo("Selecciona una imagen.");
      try { icono_valor = await convertirImagenABase64Comprimida(f); icono_tipo = "imagen"; } catch (_) { return fallo("No se pudo leer la imagen, intenta con otra."); }
    }
    borrador.enlaces.push({ nombre: nom, url: u, icono_tipo, icono_valor }); borrador.tocado = true;
    nombre.value = ""; url.value = ""; archivo.value = ""; error.hidden = true; pintar();
  });
  nombre.addEventListener("input", () => { error.hidden = true; }); url.addEventListener("input", () => { error.hidden = true; });
  marcarTipo(); pintar();
  caja.append(lista, nombre, url, filaTipo, emoji, archivo, error, agregar, notaAjuste(`Hasta ${limite} accesos directos. Se guardan al terminar.`));
  return caja;
}
function mostrarOnboardingNuevoUsuario({ navegar, toast } = {}) {
  // Nunca dentro del iframe de vista previa (evita onboarding anidado) ni duplicado.
  if (PREVIEW_DEMO || document.querySelector(".onboarding-overlay") || !estado.datos?.configuracion || (estado.datos.configuracion.onboarding_v1_completado !== false && !(MODO_DEMO && !PREVIEW_DEMO))) return false;
  const cfg = estado.datos.configuracion;
  const secciones = SECCIONES_TUTORIAL.filter(({id}) => id !== "configuracion" && document.getElementById(`seccion-${id}`));
  // «Últimos ajustes»: se guardan en este borrador y se aplican AL TERMINAR el onboarding.
  const borrador = { tocado: false, navTocada: false, moneda: null, ocultas: new Set(cfg.navegacion_oculta || []), recordatorio: null, resumen: null, enlaces: [] };
  let claveRecien = false;
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
  panel.querySelector(".onboarding-cerrar").setAttribute("aria-label",traducirTextoInterfaz("Cerrar"));panel.querySelector("iframe").title=traducirTextoInterfaz("Vista previa real de App Académica");
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
    if((navigator.deviceMemory||4)<4||(navigator.hardwareConcurrency||4)<4||esMovil())return false;
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
      esquema.replaceChildren(construirEsquema(sec,secciones.find(x=>x.id===sec)?.nombre||"App Académica",!esMovil()));
      aplicarModoVista("esquema");requestAnimationFrame(ajustarEscalaEsquema);
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
  // Si ya hay clave real, la vista previa (que corre en memoria, sin guardar nada) debe mostrarla como activa.
  const sincronizarClaveGeminiPreview=()=>{
    if(etapa!=="wapper-config"||!cfg.gemini_api_key)return;
    let win;try{win=preview.contentWindow;void win.document;}catch(_){return;}
    try{const c=win.estado?.datos?.configuracion;if(c)c.gemini_api_key=cfg.gemini_api_key;}catch(_){}
    try{win.aplicarVisibilidadBotonAsistente?.();}catch(_){}
    try{if(typeof win.renderizarAsistente==="function")win.renderizarAsistente();else if(typeof win.mostrarSeccion==="function"&&preview.dataset.seccion==="asistente")win.mostrarSeccion("asistente");}catch(_){}
  };
  const actualizarPreview=()=>{
    bloquearNavegacionPreview();
    sincronizarClaveGeminiPreview();
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
  const hayVista=()=>etapa==="personalizar";
  let animDir=0;
  const puntosTour=document.createElement("div");puntosTour.className="onb-puntos";puntosTour.setAttribute("aria-hidden","true");
  let vistaMovil="info",claveVistaMovil="";
  const pager=document.createElement("div");pager.className="onboarding-pager";
  const puntosPager=["info","preview"].map((v)=>{const b=document.createElement("button");b.type="button";b.setAttribute("role","tab");b.setAttribute("aria-label",traducirTextoInterfaz(v==="info"?"Información":"Vista previa"));b.addEventListener("click",()=>cambiarVista(v));return b;});
  const textoPager=document.createElement("span");textoPager.className="onboarding-pager-texto";
  pager.append(...puntosPager,textoPager);panel.querySelector(".onboarding-acciones").before(pager,puntosTour);
  const ajustarEscalaEsquema=()=>{
    // Teléfono: se dibuja a 440px de ancho y se reduce por ANCHO (letra legible); el alto sobrante se llena con extras.
    const marco=esquema.firstElementChild;if(!marco)return;
    marco.style.width="";marco.style.height="";marco.style.transform="";
    if(esquema.hidden)return;
    if(!esMovil()){llenarExtras(marco);return;}
    const ANCHO=440,dispW=esquema.clientWidth,dispH=esquema.clientHeight;
    if(!dispW||!dispH)return;
    const k=Math.max(.6,Math.min(1,dispW/ANCHO));
    marco.style.width=`${dispW/k}px`;marco.style.height=`${dispH/k}px`;
    if(k<.995)marco.style.transform=`scale(${k})`;
    llenarExtras(marco);
  };
  const alRedimensionar=()=>requestAnimationFrame(ajustarEscalaEsquema);
  addEventListener("resize",alRedimensionar);
  const aplicarVistaMovil=()=>{
    panel.classList.toggle("onb-tour-movil",esMovil()&&etapa==="tour");
    requestAnimationFrame(ajustarEscalaEsquema);
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
    if(!esMovil()||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.6)return;
    if(etapa==="tour"){ // recorrido: izquierda = siguiente sección, derecha = anterior (sin tocar tus preferencias)
      if(dx<0){animDir=1;siguiente();}else if(indice>0){indice--;animDir=-1;pintar();}else{etapa="personalizar";pintar();}
      return;
    }
    if(!hayVista())return;
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
  const colocarPrimario=(b)=>{if(esMovil()){const w=document.createElement("div");w.className="onb-primario-movil";w.append(b);contenido.append(w);}else acciones.append(b);};
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
  const aplicarAjustesFinales=()=>{
    if(!borrador.tocado)return;
    if(borrador.moneda)cfg.moneda_preferida=borrador.moneda;
    if(borrador.navTocada)cfg.navegacion_oculta=[...borrador.ocultas];
    if(borrador.recordatorio){const r=borrador.recordatorio,previo=cfg.notificaciones_recordatorios&&typeof cfg.notificaciones_recordatorios==="object"?cfg.notificaciones_recordatorios:{};cfg.notificaciones_recordatorios={feriado:["1_dia"],...previo,tarea:[r],examen:[r],evento:[r]};}
    if(borrador.enlaces.length){
      if(!Array.isArray(cfg.enlaces_rapidos))cfg.enlaces_rapidos=[];
      borrador.enlaces.forEach((e)=>{if(cfg.enlaces_rapidos.length>=(LIMITE_ENLACES_RAPIDOS||20))return;const nuevo=crearEnlaceRapido(e);sellarTimestamp(nuevo);cfg.enlaces_rapidos.push(nuevo);});
      import("../config/config-enlaces.js").then((m)=>m.renderizarEnlacesRapidos()).catch(()=>{});
    }
    if(borrador.resumen)cfg.notificaciones_resumen_diario={activo:borrador.resumen.activo,hora:borrador.resumen.hora};
    guardar();window.aplicarVisibilidadNavegacion?.();
    try{if(borrador.resumen&&sincronizacionCalendarActiva())sincronizarResumenDiario();}catch(_){}
  };
  const fin=(irAlPlan=false,irASemestres=false)=>{aplicarAjustesFinales();ctrlTour?.abort();fondo.detener();timersChat.forEach(clearTimeout);timersChat=[];cancelarPrecarga();consultaMovil.removeEventListener?.("change",aplicarVistaMovil);removeEventListener("resize",alRedimensionar);clearTimeout(temporizadorReveal);clearTimeout(vigilanteReveal);timersPreview.forEach(clearTimeout);timersPreview=[];clearTimeout(temporizadorTour);cfg.onboarding_v1_completado=true;cfg.tutoriales_secciones_vistas=cfg.tutoriales_secciones_vistas||{};if(irAlPlan)cfg.tutoriales_secciones_vistas["plan-estudios"]=true;if(irASemestres)cfg.tutoriales_secciones_vistas.semestres=true;guardar();overlay.remove();if(irAlPlan||irASemestres){const destino=irASemestres?"semestres":"plan-estudios";navegar?.(destino);setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:irASemestres,yaEnSemestres:irASemestres}),450);}else toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes generales."));};
  if (MODO_DEMO && !PREVIEW_DEMO) {
    const saltar=boton("Saltar inicio","btn-secondary",()=>{cfg.tutoriales_secciones_vistas=Object.fromEntries(SECCIONES_TUTORIAL.map(s=>[s.id,true]));fin(false);});
    saltar.className += " onboarding-saltar-demo";
    panel.querySelector(".onboarding-top")?.append(saltar);
    panel.querySelector(".onboarding-cerrar").style.display="none";
  }
  const preguntarPorOtroPlan=()=>{
    const pregunta=document.createElement("div");pregunta.className="onboarding-pregunta-plan";
    const tarjeta=document.createElement("section");tarjeta.setAttribute("role","dialog");tarjeta.setAttribute("aria-modal","true");
    tarjeta.append(texto("h2","","Ya tienes un plan guardado"),texto("p","","¿Quieres guardar otro plan de estudios o continuar con el que ya tienes?"));
    const botones=document.createElement("div");botones.className="onboarding-pregunta-botones";
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
    const esTour=etapa==="tour";panel.classList.toggle("onboarding-con-tour",esTour||etapa==="personalizar");panel.dataset.etapa=etapa;panel.querySelectorAll(".onb-bienvenida-avatar").forEach((e)=>e.remove());
    // En teléfono, cada pantalla nueva arranca en «información»; la vista previa se desliza.
    const claveVista=`${etapa}:${etapa==="tour"?indice:""}`;if(claveVista!==claveVistaMovil){claveVistaMovil=claveVista;vistaMovil="info";}
    panel.querySelector(".onboarding-cerrar").classList.toggle("oculto",!cuentaConDatos&&(etapa==="nombre"||etapa==="personalizar"));
    const nombres={nombre:"Te damos la bienvenida",personalizar:"Personaliza tu app",instalar:"Llévala contigo",tour:`Conoce ${secciones[indice]?.nombre||"App Académica"}`,"wapper-config":"Activa Wapper",ajustes1:"Últimos ajustes antes de iniciar",ajustes2:"Elige qué secciones usarás",flujo:"Todo conectado, paso a paso"};
    titulo.textContent=etapa==="tour"?`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(secciones[indice]?.nombre||"App Académica")}`:traducirTextoInterfaz(nombres[etapa]||"App Académica");
    progreso.textContent=etapa==="tour"?traducirTextoInterfaz(`${indice+1} de ${secciones.length} secciones`):traducirTextoInterfaz({nombre:"Bienvenida",personalizar:"Personalización",instalar:"Instalación",ajustes1:"Últimos ajustes (1 de 2)",ajustes2:"Últimos ajustes (2 de 2)",flujo:"Cómo empezar"}[etapa]||"");
    preview.closest(".onboarding-preview-wrap").classList.toggle("oculto",!esTour&&etapa!=="personalizar");
    aplicarVistaMovil();
    puntosTour.replaceChildren(...secciones.map((_,i)=>{const d=document.createElement("i");if(i===indice)d.className="on";return d;}));
    if(animDir&&esMovil()&&etapa==="tour"&&typeof panel.querySelector(".onboarding-layout").animate==="function"&&!matchMedia("(prefers-reduced-motion: reduce)").matches)panel.querySelector(".onboarding-layout").animate([{opacity:0,transform:`translateX(${animDir*26}px)`},{opacity:1,transform:"none"}],{duration:230,easing:"ease-out"});
    animDir=0;
    if(etapa==="nombre"){
      const nombreGoogle=(estado.datos.perfil?.nombre||estado.datos.perfil?.nombre_preferido||"").trim();
      const valorInicial=MODO_DEMO?"":(estado.datos.perfil?.nombre_preferido||estado.datos.perfil?.nombre||"");
      titulo.before(construirAvatarBienvenida(valorInicial||nombreGoogle));
      contenido.append(texto("p","onb-bienvenida-lema","Tu carrera, tu agenda y tu tiempo, en un solo lugar."));
      const input=document.createElement("input");input.className="form-input onb-bienvenida-campo";input.maxLength=60;input.autocomplete="given-name";input.value=valorInicial;input.placeholder=traducirTextoInterfaz("Tu nombre");input.setAttribute("aria-label",traducirTextoInterfaz("¿Cómo quieres que te llamemos?"));
      const etiqueta=texto("label","onb-bienvenida-etiqueta","¿Cómo quieres que te llamemos?");etiqueta.append(input);
      const aviso=texto("p","onboarding-nota-error","Escribe cómo quieres que te llamemos para continuar.");aviso.hidden=true;aviso.setAttribute("role","alert");
      contenido.append(etiqueta,aviso);
      const primero=nombreGoogle.split(/\s+/)[0]||"";
      let chip=null;
      if(!MODO_DEMO&&primero){
        chip=boton(`${traducirTextoInterfaz("Usar")} «${primero}»`,"onb-chip",()=>{input.value=primero;actualizarChip();input.focus({preventScroll:true});});
        chip.className="onb-chip";contenido.append(chip);
      }
      const actualizarChip=()=>{if(chip)chip.hidden=input.value.trim()===primero;};actualizarChip();
      const continuar=()=>{
        const v=input.value.trim();
        // En la demo el nombre es opcional; en una cuenta real se pide con un aviso visible.
        if(!v&&!MODO_DEMO){aviso.hidden=false;input.setAttribute("aria-invalid","true");input.focus();return;}
        if(v){estado.datos.perfil=estado.datos.perfil||{};estado.datos.perfil.nombre_preferido=v;guardar();window.renderizarPerfil?.();}
        etapa=cuentaConDatos&&cfg.paleta&&cfg.modo?"tour":"personalizar";pintar();
      };
      input.addEventListener("input",()=>{aviso.hidden=true;input.removeAttribute("aria-invalid");actualizarChip();});
      input.addEventListener("keydown",(ev)=>{if(ev.key==="Enter"){ev.preventDefault();continuar();}});
      acciones.append(boton("Continuar","btn-primary",continuar));
      if(!esMovil())requestAnimationFrame(()=>input.focus({preventScroll:true})); // en teléfono no se abre el teclado solo: taparía el avatar
      return;
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
      const archivo=document.createElement("input");archivo.type="file";archivo.accept="image/png,image/jpeg,image/webp";archivo.className="onboarding-file-input";archivo.setAttribute("aria-label",traducirTextoInterfaz("Elegir logo desde archivos"));archivo.onchange=async()=>{let url=null;try{url=await prepararImagenLogo(archivo.files?.[0]);}catch(_){}if(url){cfg.logo_app="personalizado";cfg.logo_app_url=url;guardar();aplicarLogoApp();actualizarPreview();marcarLogos();}else if(archivo.files?.length)toast?.(traducirTextoInterfaz("No se pudo usar esa imagen. Prueba con PNG, JPG o WebP."));archivo.value="";};etiquetaArchivo.append(archivo);
      const toggleLogos=boton("Logos de la app  ⌄","btn-secondary",()=>{const abierto=toggleLogos.getAttribute("aria-expanded")==="true";toggleLogos.setAttribute("aria-expanded",String(!abierto));toggleLogos.textContent=traducirTextoInterfaz(`Logos de la app  ${abierto?"⌄":"⌃"}`);logos.hidden=abierto;});toggleLogos.setAttribute("aria-expanded","false");logos.hidden=true;
      const filaLogo=document.createElement("div");filaLogo.className="onboarding-logo-heading";filaLogo.append(toggleLogos,etiquetaArchivo);
      contenido.append(modos,calidades,notaFancy,colores);if(PERMITIR_LOGO_ONBOARDING)contenido.append(filaLogo,logos);prepararMaqueta();
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="nombre";pintar();}),boton("Continuar","btn-primary",()=>{cfg.personalizacion_inicial_completada=true;guardar();etapa=etapaTrasPersonalizar();indice=0;pintar();}));return;
    }
    if(etapa==="instalar"){
      contenido.append(texto("p","onboarding-lead","Instala App Académica para abrirla como una app en tu teléfono o computadora."));
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="personalizar";pintar();}),boton("Ahora no","btn-secondary",()=>{etapa="tour";indice=0;pintar();}));colocarPrimario(boton("Instalar app","btn-primary",()=>{window.instalarAppAcademica?.();etapa="tour";indice=0;pintar();}));return;
    }
    if(etapa==="tour"){
      const sec=secciones[indice];if(!sec){etapa="ajustes1";pintar();return;}
      const bloqueConoce=document.createElement("section");bloqueConoce.className="onboarding-conoce";
      const lista=document.createElement("ul");lista.className="onboarding-lista";sec.puntos.forEach((p)=>lista.append(texto("li","",p)));bloqueConoce.append(lista);contenido.append(bloqueConoce);
      const duracionCadena=esMovil()?0:revelarEnCadena(lista); // en teléfono se desliza entre secciones: sin esperas
      prepararEsquema(sec.id);
      if(indice>0)acciones.append(boton("Atrás","btn-secondary onb-atras",()=>{indice--;animDir=-1;pintar();}));
      const usarSeccion=()=>{animDir=1;siguiente();};
      if(sec.id==="asistente"){
        // En la demo no tiene sentido pedir la clave de Gemini: se muestra una conversación de ejemplo.
        if(!MODO_DEMO){const accionesWapper=document.createElement("div");accionesWapper.className="onboarding-wapper-cta-wrap";accionesWapper.append(boton("Configurar Wapper","btn-primary onboarding-wapper-cta",()=>{etapa="wapper-config";pintar();}));contenido.append(accionesWapper);}
      }
      if(indice===0)acciones.append(boton("Atrás","btn-secondary onb-atras",()=>{etapa="personalizar";pintar();}));
      acciones.append(boton(indice===secciones.length-1?"Seguir":"Siguiente","btn-primary onb-sig",usarSeccion));return;
    }
    if(etapa==="wapper-config"){
      const listo=Boolean(cfg.gemini_api_key);
      contenido.append(texto("p","onboarding-lead",GEMINI_INTRO));
      if(listo){
        const ok=document.createElement("div");ok.className="onb-wapper-ok";ok.setAttribute("role","status");
        ok.append(texto("b","","✓ Wapper está activo"),texto("span","","Clave de Gemini guardada. Ahora puedes dictar tareas, exámenes y eventos desde Asistente."));contenido.append(ok);
        if(claveRecien){claveRecien=false;timersChat.push(setTimeout(()=>{if(etapa==="wapper-config"){etapa="tour";siguiente();}},1600));}
        acciones.append(boton("Atrás","btn-secondary",()=>{etapa="tour";pintar();}),boton("Continuar con la guía","btn-primary",()=>{etapa="tour";siguiente();}));return;
      }
      const pasosGemini=document.createElement("ol");pasosGemini.className="onb-gemini-pasos";GEMINI_PASOS.forEach((t)=>pasosGemini.append(texto("li","",t)));contenido.append(pasosGemini);
      const enlace=document.createElement("a");enlace.href="https://aistudio.google.com/app/apikey";enlace.target="_blank";enlace.rel="noopener";enlace.className="btn btn-secondary";enlace.textContent=traducirTextoInterfaz("Abrir Google AI Studio ↗");contenido.append(enlace);
      const campo=document.createElement("div");campo.className="onb-gemini-campo";
      const etiqueta=texto("span","form-label","Clave de API de Gemini");
      const input=document.createElement("input");input.type="password";input.className="form-input";input.autocomplete="off";input.placeholder=traducirTextoInterfaz("Pegá tu clave acá");input.setAttribute("aria-label",traducirTextoInterfaz("Clave de API de Gemini"));
      const error=texto("p","onboarding-nota-error","Pegá una clave antes de guardar.");error.hidden=true;error.setAttribute("role","alert");
      const guardarClave=()=>{
        const clave=input.value.trim();
        if(!clave){error.hidden=false;input.focus();return;}
        cfg.gemini_api_key=clave;guardar();window.aplicarVisibilidadBotonAsistente?.();toast?.(traducirTextoInterfaz("✓ Clave de Gemini guardada"));
        claveRecien=true;pintar();
      };
      input.addEventListener("input",()=>{error.hidden=true;});
      input.addEventListener("keydown",(ev)=>{if(ev.key==="Enter"){ev.preventDefault();guardarClave();}});
      campo.append(etiqueta,input,error,boton("Guardar","btn-primary",guardarClave));contenido.append(campo);
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="tour";pintar();}),boton("Hacerlo después","btn-secondary",()=>{etapa="tour";siguiente();}));return;
    }
    if(etapa==="ajustes1"){
      contenido.append(texto("p","onboarding-lead","Tres cosas rápidas para dejar la app lista. Todo se aplica al terminar y puedes cambiarlo luego en Ajustes."));
      const lista=document.createElement("div");lista.className="onb-ajustes";
      const monedaActual=borrador.moneda||cfg.moneda_preferida||"CRC";
      lista.append(bloqueAjuste("💱","Moneda local","Finanzas usa este símbolo en tus importes.",construirBuscadorMoneda({valorInicial:monedaActual,onElegir:(id)=>{borrador.moneda=id;borrador.tocado=true;}}),notaAjuste("Escribe el código (USD, CRC…) o el país para encontrarla rápido.")));
      lista.append(bloqueAjuste("🔗","Enlaces importantes","Matrícula, TEC Digital, pagos… con emoji o imagen.",construirBloqueEnlaces({cfg,borrador})));
      if(!MODO_DEMO)lista.append(bloqueAjuste("🔔","Notificaciones","Recordatorios de tu agenda y un resumen diario.",construirBloqueNotificaciones({cfg,borrador,demo:false})));
      contenido.append(lista);
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="tour";indice=Math.max(0,secciones.length-1);pintar();}),boton("Continuar","btn-primary",()=>{etapa="ajustes2";pintar();}));return;
    }
    if(etapa==="ajustes2"){
      contenido.append(texto("p","onboarding-lead","Desactiva las secciones que no vayas a utilizar. Puedes volver a activarlas cuando quieras en Ajustes → Personalizar."));
      const lista=document.createElement("div");lista.className="onb-ajustes";
      const orden=typeof window.obtenerOrdenNavegacion==="function"?window.obtenerOrdenNavegacion():SECCIONES_NAV.map((x)=>x.id);
      orden.forEach((id)=>{
        const sec=SECCIONES_NAV.find((x)=>x.id===id);if(!sec)return;
        if(id==="asistente"&&!cfg.gemini_api_key)return;
        const fila=document.createElement("div");fila.className="onb-nav-fila";
        const izq=document.createElement("span");izq.append(texto("span","",sec.icono),texto("span","",sec.etiqueta));
        const sw=construirInterruptor(!borrador.ocultas.has(id),(activa)=>{if(activa)borrador.ocultas.delete(id);else borrador.ocultas.add(id);borrador.tocado=true;borrador.navTocada=true;},`${sec.etiqueta}`);
        fila.append(izq,sw.label);lista.append(fila);
      });
      contenido.append(lista);
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="ajustes1";pintar();}),boton("Continuar","btn-primary",()=>{etapa="flujo";pintar();}));return;
    }
    const pasos=document.createElement("ol");pasos.className="onboarding-dependencias";["Agrega tu plan de estudios.","Crea un semestre y matricula tus materias.","Usa esas materias en Horario, Agenda y Tiempo.","Wapper trabaja con tu Agenda; Comunidad y Finanzas funcionan por separado."].forEach(t=>pasos.append(texto("li","",t)));contenido.append(pasos);
    acciones.append(boton("Atrás","btn-secondary",()=>{etapa="ajustes2";pintar();}),boton("Lo haré después","btn-secondary",()=>fin(false)));colocarPrimario(boton(tienePlanArmado?"Continuar":"Agregar plan y ver la guía","btn-primary",()=>tienePlanArmado?preguntarPorOtroPlan():fin(true)));
  };
  const siguiente=()=>{indice++;if(indice>=secciones.length)etapa="ajustes1";pintar();};
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
  const botonRegistrarSemestre = botonAgregarSemestre;
  const botonGestionPlan = () => [...document.querySelectorAll("#seccion-plan-estudios button")].find((b) => /gestionar plan|gestisci piano|manage plan/i.test(b.textContent)) || document.getElementById("btn-gestion-planes") || document.getElementById("btn-gestionar-planes");
  const navVisible = () => { const b = document.getElementById("nav-semestres"); const r = b?.getBoundingClientRect(); return b && r.width && r.left >= 0 && r.right <= innerWidth ? b : null; };
  const pasosSemestre = [
    ...(yaEnSemestres ? [] : [{ accion: "navegar", selector: navVisible,
      texto: "Tu plan ya quedó guardado ✓. Ahora falta decirle a la app qué estás cursando este semestre. Toca Semestres para continuar." }]),
    { selector: () => null,
      texto: "¿Por qué un semestre? Tu plan es la lista completa de materias de la carrera; el semestre es lo que cursas ahora. Al matricular materias aquí, Horario, Agenda y Tiempo de estudio ya pueden usarlas, y aquí llevarás tus notas y tu promedio." },
    { accion: "abrirAlta", selector: botonRegistrarSemestre,
      texto: "Toca «+ Agregar» (el botón resaltado). Se abre un formulario: 1) escribe el período, por ejemplo 2026-II; 2) marca las materias que cursas ahora; 3) guarda. Cuando termines, te sigo guiando." },
  ];
  const flujoSemestre = posteriorImportacion || yaTienePlan;
  const pasos = posteriorImportacion ? pasosSemestre : yaTienePlan ? [
    { selector: botonGestionPlan, texto: "Ya tienes un plan. Para añadir otra carrera toca «Gestionar plan» (el botón resaltado)." },
    ...pasosSemestre,
  ] : [
    { selector: botonDesdeCero, texto: "Opción 1 · Empieza desde cero: toca el botón resaltado y agrega tus materias a mano, una por una." },
    { selector: grupoMetodosImportar, texto: "Opción 2 · Importa tu plan ya hecho: elige Pegar link, Adjuntar PDF/Imagen o Tomar foto (los botones resaltados) y luego envíalo a Claude para que lo convierta al formato CSV." },
    { selector: () => document.getElementById("btn-enviar-import-claude"), texto: "Pulsa Enviar a Claude y sigue la guía para adjuntar tu plan. Cuando Claude devuelva el CSV, vuelve a esta app." },
    { selector: () => document.getElementById("textarea-csv-importar"), texto: "Copia el bloque CSV completo, desde CARRERA hasta la última materia, y pégalo aquí. Luego toca Importar." },
    { selector: () => [...document.querySelectorAll("#seccion-plan-estudios button")].find((b) => /^(importar|importa|import)$/i.test(b.textContent.trim())), texto: "Pulsa Importar para guardar y revisar las materias. Cuando termine, la guía te llevará a Semestres para continuar." },
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
    if (i >= pasos.length) { cerrar({ continuarSemestres: flujoSemestre }); return; }
    if (!posteriorImportacion && !yaTienePlan && i >= 2 && !document.getElementById("textarea-csv-importar")) {
      const link = grupoMetodosImportar()?.querySelector("button");
      if (link) link.click(); setTimeout(pintar, 80); return;
    }
    const paso = pasos[i];
    resaltado = paso.selector();
    resaltado?.scrollIntoView({ behavior: "smooth", block: "center" });
    resaltador.apuntar(resaltado, paso.selector); // anillo + bloqueo de todo lo demás (solo si hay objetivo)
    pop.replaceChildren();
    const titulo = document.createElement("strong"); titulo.textContent = `${i + 1} / ${pasos.length}`;
    const p = document.createElement("p"); p.textContent = traducirTextoInterfaz(paso.texto);
    pop.append(titulo, p);
    const acciones = document.createElement("div"); acciones.className = "row";
    const seguir = document.createElement("button"); seguir.className = "btn btn-primary";
    seguir.textContent = traducirTextoInterfaz(paso.accion === "abrirAlta" ? "Abrir formulario" : i === pasos.length - 1 ? "Entendido" : "Siguiente");
    seguir.onclick = () => {
      if (paso.accion === "navegar") { marcarSemestresVisto(); navegar?.("semestres"); i++; setTimeout(pintar, 350); return; }
      if (paso.accion === "abrirAlta") {
        marcarSemestresVisto(); pasoAlta = i; resaltador.ocultar();
        (resaltado || botonRegistrarSemestre())?.click(); pop.classList.add("oculto"); esperandoAlta = true;
        setTimeout(revisarAlta, 700); return;
      }
      i++; pintar();
    };
    const saltar = document.createElement("button"); saltar.className = "btn btn-secondary"; saltar.textContent = traducirTextoInterfaz("Saltar guía"); saltar.onclick = () => cerrar();
    acciones.append(seguir, saltar); pop.append(acciones); pop.classList.remove("oculto"); evitarSolape(pop, resaltado);
  };
  pintar();
  window.continuarTutorialDespuesDeImportarPlan = () => { if (!cerrarGuiaPlanActiva) return; marcarSemestresVisto(); cerrar(); navegar?.("semestres"); setTimeout(() => iniciarGuiaPlan({ navegar, posteriorImportacion: true, yaEnSemestres: true }), 350); };
}

function inicializarTutorialDesdeAjustes({ navegar, toast } = {}) {
  const btn=document.getElementById("btn-repetir-tutorial");if(!btn||btn.dataset.inicializado)return;btn.dataset.inicializado="1";btn.addEventListener("click",()=>{if(!estado.datos?.configuracion)return;estado.datos.configuracion.onboarding_v1_completado=false;mostrarOnboardingNuevoUsuario({navegar,toast});});
}

function botonAgregarSemestre() { return [...document.querySelectorAll("#seccion-semestres button")].find((b) => /registrar semestre|crear semestre|agregar semestre|^\s*\+?\s*agregar\s*$/i.test(b.textContent.trim())); }
function filaDocenteComunidad() { const raiz = document.getElementById("seccion-comunidad"); if (!raiz) return null; for (const el of raiz.querySelectorAll("*")) { if (el.children.length < 2 || !/[✓✕]/.test(el.textContent || "")) continue; const r = el.getBoundingClientRect(); if (r.height > 20 && r.height < 140) return el; } return null; }
function tarjetaMateriaTiempo() { const raiz = document.getElementById("seccion-tiempo-estudio"); if (!raiz) return null; for (const el of raiz.querySelectorAll("*")) { if (el.children.length < 2) continue; const t = el.textContent || ""; if (!/\d+\s*min\s*de\s*\d+/i.test(t) || !/[A-Z]{2,4}-\d{3,4}/.test(t)) continue; const r = el.getBoundingClientRect(); if (r.height > 0 && r.height < 220) return el; } return null; }
const SELECTORES_GUIA_SECCION = {
  resumen: [
    () => document.querySelector("#seccion-resumen .resumen-semana-tarjeta") || document.querySelector("#seccion-resumen .resumen-bloque"),
    () => document.querySelector("#seccion-resumen .resumen-estudio-hoy-tarjeta") || document.querySelector("#seccion-resumen .resumen-bloque"),
    () => document.querySelector("#seccion-resumen .resumen-bloque:last-child") || document.getElementById("seccion-resumen"),
  ],
  agenda: [
    () => document.getElementById("pills-agenda-vista"),
    () => document.getElementById("btn-agenda-agregar"),
    () => { const n = document.getElementById("agenda-nombre-semestre"); return (n && n.getBoundingClientRect().width ? n : null) || document.getElementById("agenda-header"); },
  ],
  horario: [
    () => document.getElementById("btn-horario-agregar"),
    () => document.querySelector("#horario-grid [class*='bloque']") || document.getElementById("horario-grid"),
    () => document.getElementById("btn-horario-amigos"),
  ],
  "tiempo-estudio": [
    () => tarjetaMateriaTiempo() || document.getElementById("seccion-tiempo-estudio"),
    () => { const t = [...document.querySelectorAll("#seccion-tiempo-estudio *")].find((el) => el.children.length === 0 && /^\+?\s*(nueva|nuova|new)\s+(materia|subject)$/i.test(el.textContent.trim())); return t?.closest("button,[role='button'],a") || t || document.getElementById("seccion-tiempo-estudio"); },
    () => [...document.querySelectorAll("#seccion-tiempo-estudio button")].find((b) => /^materias$/i.test(b.textContent.trim()))?.parentElement || document.getElementById("seccion-tiempo-estudio"),
  ],
 semestres: [
    () => botonAgregarSemestre() || document.getElementById("seccion-semestres"),
    () => document.querySelector("#seccion-semestres [data-semestre-id]") || document.getElementById("seccion-semestres"),
    () => [...document.querySelectorAll("#seccion-semestres button")].find(b => /nota|historial|editar/i.test(b.textContent)) || document.querySelector("#seccion-semestres [data-semestre-id]") || document.getElementById("seccion-semestres"),
  ],
  comunidad: [
    () => document.querySelector("#seccion-comunidad .pill-group") || document.getElementById("seccion-comunidad"),
    () => filaDocenteComunidad() || [...document.querySelectorAll("#seccion-comunidad .pill-group")][2] || document.getElementById("seccion-comunidad"),
  ],
 finanzas: [
    () => document.querySelector("#seccion-finanzas .finanzas-tabs-contenedor") || document.getElementById("seccion-finanzas"),
    () => [...document.querySelectorAll("#seccion-finanzas button")].find(b => /agregar|nuevo|gasto|ingreso/i.test(b.textContent)) || document.getElementById("seccion-finanzas"),
    () => document.getElementById("finanzas-contenido") || document.getElementById("seccion-finanzas"),
  ],
  asistente: [
    () => document.querySelector("#seccion-asistente .glass-card") || document.getElementById("seccion-asistente"),
    () => document.querySelector("#seccion-asistente textarea, #seccion-asistente input:not([type='hidden'])") || document.getElementById("seccion-asistente"),
    () => null,
  ],
  configuracion: [
    () => document.getElementById("ajuste-tamano-texto"),
    () => seccionNavegacionAjustes(),
    () => document.getElementById("btn-repetir-tutorial"),
  ],
};

function iniciarGuiaSeccion(info) {
  const objetivos=SELECTORES_GUIA_SECCION[info.id]||[];
  let indice=0,resaltado=null;const resaltador=crearResaltador();
  const pop=document.createElement("aside");pop.className="guia-plan-flotante guia-seccion-flotante";pop.setAttribute("role","dialog");pop.setAttribute("aria-live","polite");pop.setAttribute("aria-label",`${traducirTextoInterfaz("Tutorial")}: ${traducirTextoInterfaz(info.nombre)}`);document.body.append(pop);
  const cerrar=()=>{resaltador.quitar();pop.remove();};
  const total=info.puntos.length+(info.id==="asistente"?1:0);
  const marcarVista=(id)=>{const c=estado.datos?.configuracion;if(!c)return;c.tutoriales_secciones_vistas=c.tutoriales_secciones_vistas||{};c.tutoriales_secciones_vistas[id]=true;guardar();};
  const armar=(tituloTxt,cuerpoTxt,botones)=>{
    pop.replaceChildren();
    const titulo=document.createElement("strong");titulo.textContent=tituloTxt;
    const texto=document.createElement("p");texto.textContent=traducirTextoInterfaz(cuerpoTxt);
    const acciones=document.createElement("div");acciones.className="guia-seccion-acciones";acciones.append(...botones);pop.append(titulo,texto,acciones);
  };
  const btn=(txt,clase,fn)=>{const b=document.createElement("button");b.type="button";b.className=`btn ${clase}`;b.textContent=traducirTextoInterfaz(txt);b.onclick=fn;return b;};
  // Último paso de Wapper: va a Ajustes, baja suave hasta «Asistente IA (Gemini)», abre la tarjeta y la resalta.
  const pasoClave=()=>{
    marcarVista("configuracion");resaltador.ocultar();pop.replaceChildren();
    window.mostrarSeccion?.("configuracion");
    setTimeout(()=>{
      const sec=[...document.querySelectorAll("#seccion-configuracion .ajuste-seccion")].find((x)=>/asistente ia/i.test(x.querySelector("h2")?.textContent||""));
      if(sec){if(sec.classList.contains("colapsada"))sec.querySelector(".ajuste-seccion-cabecera")?.click();setTimeout(()=>sec.scrollIntoView({behavior:"smooth",block:"start"}),150);}
      resaltador.apuntar(sec||document.getElementById("seccion-configuracion"));
      armar(`${traducirTextoInterfaz(info.nombre)} · ${total}/${total}`,"Pega tu clave de Gemini en el campo y toca «Guardar». Con eso Wapper queda activo.",[btn("Entendido","btn-primary",cerrar)]);evitarSolape(pop,sec);
    },500);
  };
  const pintar=()=>{
    if(indice>=info.puntos.length){cerrar();return;}
    const buscar=objetivos[indice];resaltado=buscar?.()||document.getElementById(`seccion-${info.id}`);
    resaltado?.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});resaltador.apuntar(resaltado,()=>buscar?.()||document.getElementById(`seccion-${info.id}`));
    const esUltimoWapper=info.id==="asistente"&&indice===info.puntos.length-1;
    const botones=[];
    if(indice>0)botones.push(btn("Anterior","btn-secondary",()=>{indice--;pintar();}));
    botones.push(esUltimoWapper?btn("Ir a Ajustes","btn-primary",pasoClave):btn(indice===info.puntos.length-1?"Entendido":"Siguiente","btn-primary",()=>{indice++;pintar();}),btn("Saltar guía","btn-secondary",cerrar));
    armar(`${traducirTextoInterfaz(info.nombre)} · ${indice+1}/${total}`,info.puntos[indice],botones);evitarSolape(pop,resaltado);
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
if (MODO_DEMO) {
  // Controles de prueba que no deben verse en la demo (se ocultan por texto; lo ideal es quitarlos de su pantalla de origen).
  let pendiente = 0;
  const ocultarControlesDemo = () => { pendiente = 0; document.querySelectorAll("button").forEach((b) => { if (/simular\s+(victoria|derrota)|(agregar|borrar)\s+racha/i.test(b.textContent)) b.style.display = "none"; }); };
  new MutationObserver(() => { if (!pendiente) pendiente = requestAnimationFrame(ocultarControlesDemo); }).observe(document.documentElement, { childList: true, subtree: true });
  ocultarControlesDemo();
}
export { mostrarOnboardingNuevoUsuario, inicializarTutorialDesdeAjustes, mostrarTutorialPrimeraVez };
