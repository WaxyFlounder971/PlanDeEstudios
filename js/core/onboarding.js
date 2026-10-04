import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp, PALETAS_DISPONIBLES } from "./schema.js";
import { aplicarPaleta, obtenerModoTemaLocal, guardarModoTemaLocal, COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO } from "../ui/tema.js";
import { traducirTextoInterfaz } from "./i18n.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";
import { aplicarLogoApp, prepararImagenLogo } from "./marca.js";

const SECCIONES_TUTORIAL = [
  { id:"resumen", nombre:"Resumen", cuerpo:"Tu punto de partida diario: clases, entregas, exámenes y tiempo de estudio en un mismo vistazo. Los datos aparecen conforme conectas las demás secciones; puedes reorganizar qué módulos ves primero." },
  { id:"agenda", nombre:"Agenda", cuerpo:"Aquí conviven tareas, exámenes, proyectos, eventos y feriados. Cambia entre lista, calendario y cronograma; filtra por tipo, completa pendientes y abre una tarjeta para editarla. Agenda se vuelve más útil al vincular actividades con una materia y semestre." },
  { id:"horario", nombre:"Horario", cuerpo:"Arma tus clases por día y hora con profesor, aula, modalidad y enlaces. Abre cada clase para ver sus detalles y, si quieres, compara el horario con amistades. Las materias matriculadas desde Semestres alimentan las opciones." },
  { id:"tiempo-estudio", nombre:"Tiempo de estudio", cuerpo:"Inicia una sesión de estudio desde una materia: abre la materia y elige iniciar sesión. También puedes crear bloques personalizados sin tener un plan. El historial, rachas y estadísticas conservan sesiones de distintos semestres." },
  { id:"semestres", nombre:"Semestres", cuerpo:"Crea un semestre y matricula en él materias de tu plan. Registra criterios, asignaciones y notas; la nota final y la proyección se calculan con esos datos. Al terminar un semestre podrás revisar su Wrapped." },
  { id:"comunidad", nombre:"Comunidad", cuerpo:"Guarda profesores y compañeros, sus contactos y valoraciones, y conecta amistades para comparar horarios. Comunidad es independiente: puedes usarla aunque todavía no tengas plan o semestre." },
  { id:"finanzas", nombre:"Finanzas", cuerpo:"Registra ingresos y gastos desde el inicio, sin depender de otras secciones. Asociar movimientos a un semestre es opcional y ayuda a comparar tus gastos por periodo." },
  { id:"plan-estudios", nombre:"Plan de estudios", cuerpo:"Añade una o varias carreras, pega o importa una malla y marca el avance de sus materias. El plan alimenta Semestres, donde decides qué cursos llevas ahora y ahí comienzan las conexiones con Agenda, Horario y estadísticas." },
  { id:"configuracion", nombre:"Ajustes", cuerpo:"Cambia idioma, apariencia, paleta, tamaño de texto, navegación y preferencias. Puedes regresar a esta bienvenida desde Ajustes generales cuando quieras." },
];

const TEXTO_FLUJO = "El orden recomendado es: 1) agrega uno o más planes; 2) crea un semestre y matricula materias del plan; 3) con esas materias arma Horario y vincula actividades en Agenda; 4) inicia sesiones desde materias para tener estadísticas ordenadas por periodo. Tiempo también admite bloques personalizados. Wapper necesita Agenda y una clave de Gemini para automatizar tareas. Comunidad y Finanzas funcionan por separado; en Finanzas, el semestre es una clasificación opcional.";

function guardar() {
  const cfg = estado.datos?.configuracion;
  if (cfg) sellarTimestamp(cfg);
  marcarCambioPendiente();
}

function mostrarOnboardingNuevoUsuario({ navegar, toast } = {}) {
  if (!estado.datos?.configuracion || estado.datos.configuracion.onboarding_v1_completado !== false) return false;
  const cfg = estado.datos.configuracion;
  const secciones = SECCIONES_TUTORIAL.filter(({id}) => document.getElementById(`seccion-${id}`));
  let etapa = "nombre", indice = 0;
  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  overlay.setAttribute("role","dialog"); overlay.setAttribute("aria-modal","true"); overlay.setAttribute("aria-labelledby","onboarding-titulo");
  const panel = document.createElement("section"); panel.className = "onboarding-panel";
  panel.innerHTML = '<header class="onboarding-top"><span class="onboarding-progreso"></span><button class="onboarding-cerrar" type="button" aria-label="Cerrar">×</button></header><div class="onboarding-layout"><div class="onboarding-copy"><h1 id="onboarding-titulo"></h1><div class="onboarding-contenido"></div></div><div class="onboarding-preview-wrap"><div class="onboarding-preview-caption">Así se ve la app con datos de ejemplo</div><iframe class="onboarding-preview" title="Vista previa real de App Académica" loading="lazy" data-analitica-ignorar></iframe></div></div><footer class="onboarding-acciones"></footer>';
  overlay.append(panel); document.body.append(overlay);
  const progreso=panel.querySelector(".onboarding-progreso"), titulo=panel.querySelector("h1"), contenido=panel.querySelector(".onboarding-contenido"), acciones=panel.querySelector(".onboarding-acciones"), preview=panel.querySelector("iframe");
  const boton=(texto,clase,fn)=>{const b=document.createElement("button");b.type="button";b.className=`btn ${clase}`;b.textContent=traducirTextoInterfaz(texto);b.addEventListener("click",fn);return b;};
  const texto=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=traducirTextoInterfaz(value);return e;};
  const fin=(irAlPlan=false)=>{cfg.onboarding_v1_completado=true;guardar();overlay.remove();if(irAlPlan){navegar?.("plan-estudios");setTimeout(iniciarGuiaPlan,450);}else toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes generales."));};
  const instalarYa=()=>Boolean(navigator.standalone)||matchMedia("(display-mode: standalone)").matches;
  const cargarPreview=(seccion="resumen")=>{const u=new URL(location.href);u.search="";u.searchParams.set("demo","1");u.searchParams.set("preview","1");u.searchParams.set("previewSection",seccion);u.searchParams.set("previewPalette",cfg.paleta||"azul");u.searchParams.set("previewMode",obtenerModoTemaLocal());u.searchParams.set("previewLogo",cfg.logo_app||"folder");if(cfg.paleta==="personalizada"&&cfg.paleta_personalizada)u.searchParams.set("previewCustom",JSON.stringify(cfg.paleta_personalizada));if(cfg.logo_app_url)u.searchParams.set("previewLogoData",cfg.logo_app_url);const key=`${seccion}:${u.search}`;if(preview.dataset.loaded!==key){preview.dataset.loaded=key;preview.src=u.href;}};
  const pintar=()=>{
    contenido.replaceChildren();acciones.replaceChildren();
    const esTour=etapa==="tour";panel.classList.toggle("onboarding-con-tour",esTour||etapa==="personalizar");
    panel.querySelector(".onboarding-cerrar").classList.toggle("oculto",etapa==="nombre"||etapa==="personalizar");
    const nombres={nombre:"Tu cuenta, a tu manera",personalizar:"Personaliza tu app",instalar:"Llévala contigo",tour:`Conoce ${secciones[indice]?.nombre||"App Académica"}`,flujo:"Todo conectado, paso a paso"};
    titulo.textContent=etapa==="tour"?`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(secciones[indice]?.nombre||"App Académica")}`:traducirTextoInterfaz(nombres[etapa]||"App Académica");
    progreso.textContent=etapa==="tour"?`${indice+1} de ${secciones.length} secciones`:({nombre:"Bienvenida",personalizar:"Personalización",instalar:"Instalación",flujo:"Cómo empezar"}[etapa]||"");
    preview.closest(".onboarding-preview-wrap").classList.toggle("oculto",!esTour&&etapa!=="personalizar");
    if(etapa==="nombre"){
      contenido.append(texto("p","onboarding-lead","¿Cómo te llamas? Puedes cambiarlo después en Ajustes generales."));
      const input=document.createElement("input");input.className="form-input";input.maxLength=60;input.autocomplete="given-name";input.value=estado.datos.perfil?.nombre_preferido||estado.datos.perfil?.nombre||"";input.setAttribute("aria-label",titulo.textContent);contenido.append(input);
      acciones.append(boton("Continuar","btn-primary",()=>{const v=input.value.trim();if(!v){input.focus();return;}estado.datos.perfil.nombre_preferido=v;guardar();window.renderizarPerfil?.();etapa="personalizar";pintar();}));requestAnimationFrame(()=>input.focus());return;
    }
    if(etapa==="personalizar"){
      contenido.append(texto("p","onboarding-lead","Elige tema, paleta y logo. Puedes cambiarlos luego en Personalizar."));
      const modos=document.createElement("div");modos.className="onboarding-modos";
      [["light","Modo claro"],["dark","Modo color"],["true-dark","Modo oscuro"]].forEach(([v,l])=>{const b=boton(l,obtenerModoTemaLocal()===v?"btn-primary":"btn-secondary",()=>{cfg.modo=v;guardarModoTemaLocal(v);aplicarPaleta(cfg.paleta||"azul",v,cfg.paleta==="personalizada"?cfg.paleta_personalizada?.colores:undefined);aplicarLogoApp();guardar();pintar();});b.setAttribute("aria-pressed",String(obtenerModoTemaLocal()===v));modos.append(b);});
      const colores=document.createElement("div");colores.className="onboarding-paletas";
      PALETAS_DISPONIBLES.forEach((p)=>{const b=document.createElement("button");b.type="button";b.className="onboarding-color";b.title=traducirTextoInterfaz(p);b.setAttribute("aria-label",traducirTextoInterfaz(p));b.setAttribute("aria-pressed",String(cfg.paleta===p));const colors=COLORES_PREVIEW_PALETA[p]||[];b.style.background=p==="azucarado"?FONDO_PREVIEW_AZUCARADO:`linear-gradient(135deg,${colors.join(",")})`;b.addEventListener("click",()=>{cfg.paleta=p;aplicarPaleta(p,obtenerModoTemaLocal());aplicarLogoApp();guardar();pintar();});colores.append(b);});
      const paletaPersonal=document.createElement("button");paletaPersonal.className="btn btn-secondary";paletaPersonal.textContent=traducirTextoInterfaz("Más colores · Crear mi paleta");paletaPersonal.onclick=()=>iniciarFlujoPaletaPersonalizada({alGuardar:()=>{cfg.paleta="personalizada";cfg.paleta_personalizada=estado.datos.configuracion.paleta_personalizada;guardar();aplicarPaleta("personalizada",obtenerModoTemaLocal(),cfg.paleta_personalizada?.colores);aplicarLogoApp();}});
      const logos=document.createElement("div");logos.className="onboarding-logos";[["folder","imagenes/LogoAppFolder.png","Carpeta"],["birrete","imagenes/LogoAppBirrete.png","Birrete"]].forEach(([v,src,alt])=>{const b=document.createElement("button");b.type="button";b.className="onboarding-logo";b.setAttribute("aria-pressed",String(cfg.logo_app===v&&!cfg.logo_app_url));const img=document.createElement("img");img.src=src;img.alt=alt;b.append(img);b.onclick=()=>{cfg.logo_app=v;cfg.logo_app_url=null;guardar();aplicarLogoApp();pintar();};logos.append(b);});
      const archivo=document.createElement("input");archivo.type="file";archivo.accept="image/png,image/jpeg,image/webp";archivo.className="form-input";archivo.setAttribute("aria-label","Elegir logo desde archivos");archivo.onchange=async()=>{const url=await prepararImagenLogo(archivo.files?.[0]);if(url){cfg.logo_app="personalizado";cfg.logo_app_url=url;guardar();aplicarLogoApp();pintar();}};
      contenido.append(modos,colores,paletaPersonal,texto("h3","","Logo de la app"),logos,texto("small","muted","También puedes elegir aquí un archivo LogoApp de Descargas."),archivo);cargarPreview("resumen");
      acciones.append(boton("Continuar","btn-primary",()=>{etapa=instalarYa()?"tour":"instalar";pintar();}));return;
    }
    if(etapa==="instalar"){
      contenido.append(texto("p","onboarding-lead","Instala App Académica para abrirla como una app en tu teléfono o computadora. Si ya está instalada, este paso se omite."));
      acciones.append(boton("Ahora no","btn-secondary",()=>{etapa="tour";indice=0;pintar();}),boton("Instalar app","btn-primary",()=>{window.instalarAppAcademica?.();etapa="tour";indice=0;pintar();}));return;
    }
    if(etapa==="tour"){
      const sec=secciones[indice];if(!sec){etapa="flujo";pintar();return;}
      contenido.append(texto("p","onboarding-lead",sec.cuerpo));
      if(sec.id==="tiempo-estudio")contenido.append(texto("p","onboarding-callout","Para registrar tiempo por materia, abre una materia y toca Iniciar sesión de estudio. También hay bloques personalizados."));
      cargarPreview(sec.id);acciones.append(boton("No me interesa","btn-secondary",()=>{cfg.navegacion_oculta=[...new Set([...(cfg.navegacion_oculta||[]),sec.id])];guardar();window.aplicarVisibilidadNavegacion?.();siguiente();}),boton(indice===secciones.length-1?"Seguir":"Lo usaré","btn-primary",siguiente));return;
    }
    contenido.append(texto("p","onboarding-lead",TEXTO_FLUJO));
    const pasos=document.createElement("ol");pasos.className="onboarding-dependencias";["Plan de estudios → Semestres → materias matriculadas.","Semestres → Horario, Agenda vinculada y estadísticas por materia.","Agenda → Wapper puede crear y consultar pendientes con Gemini.","Comunidad y Finanzas funcionan por separado; asociar Finanzas a semestres es opcional.","Tiempo acepta materias y bloques personalizados."].forEach(t=>pasos.append(texto("li","",t)));contenido.append(pasos);
    acciones.append(boton("Lo haré después","btn-secondary",()=>fin(false)),boton("Agregar plan y ver la guía","btn-primary",()=>fin(true)));
  };
  const siguiente=()=>{indice++;if(indice>=secciones.length)etapa="flujo";pintar();};
  panel.querySelector(".onboarding-cerrar").addEventListener("click",()=>fin(false));
  pintar();return true;
}

function iniciarGuiaPlan(){
  const pasos=[
    {selector:()=>document.querySelector("#seccion-plan-estudios .glass-card .pill-group"),texto:"Elige cómo traer tu plan: pega el enlace oficial o adjunta un PDF/imagen. Para añadir materias manualmente puedes elegir Empezar en blanco."},
    {selector:()=>document.getElementById("textarea-csv-importar"),texto:"Cuando tengas el resultado en formato CSV, copia el bloque completo y pégalo en este campo. Después toca Importar y revisa las materias."},
    {selector:()=>[...document.querySelectorAll("#seccion-plan-estudios button")].find(b=>/^importar$/i.test(b.textContent.trim())),texto:"Pulsa Importar para revisar y guardar las materias del plan. Después podrás añadir más carreras desde Gestionar plan."},
  ];let i=0;const pop=document.createElement("aside");pop.className="guia-plan-flotante";pop.setAttribute("role","dialog");document.body.append(pop);let resaltado=null;
  const cerrar=()=>{resaltado?.classList.remove("guia-plan-resaltado");pop.remove();};
  const pintar=()=>{resaltado?.classList.remove("guia-plan-resaltado");if(i>=pasos.length){cerrar();return;}if(i>0&&!document.getElementById("textarea-csv-importar")){document.querySelector('#seccion-plan-estudios .pill-group button')?.click();setTimeout(pintar,60);return;}resaltado=pasos[i].selector();resaltado?.classList.add("guia-plan-resaltado");resaltado?.scrollIntoView({behavior:"smooth",block:"center"});pop.replaceChildren();const titulo=document.createElement("strong");titulo.textContent=`${i+1} / ${pasos.length}`;const p=document.createElement("p");p.textContent=traducirTextoInterfaz(pasos[i].texto);const extra=document.createElement("p");extra.textContent=traducirTextoInterfaz("Puedes agregar otros planes después desde Gestionar plan.");pop.append(titulo,p,extra);const acciones=document.createElement("div");acciones.className="row";const seguir=document.createElement("button");seguir.className="btn btn-primary";seguir.textContent=traducirTextoInterfaz(i===pasos.length-1?"Entendido":"Siguiente");seguir.onclick=()=>{i++;pintar();};const saltar=document.createElement("button");saltar.className="btn btn-secondary";saltar.textContent=traducirTextoInterfaz("Saltar guía");saltar.onclick=cerrar;acciones.append(seguir,saltar);pop.append(acciones);};pintar();
}

function inicializarTutorialDesdeAjustes({ navegar, toast } = {}) {
  const btn=document.getElementById("btn-repetir-tutorial");if(!btn||btn.dataset.inicializado)return;btn.dataset.inicializado="1";btn.addEventListener("click",()=>{if(!estado.datos?.configuracion)return;estado.datos.configuracion.onboarding_v1_completado=false;mostrarOnboardingNuevoUsuario({navegar,toast});});
}
export { mostrarOnboardingNuevoUsuario, inicializarTutorialDesdeAjustes };
