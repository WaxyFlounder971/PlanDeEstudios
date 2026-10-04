import { estado } from "./storage.js";
import { marcarCambioPendiente } from "./storage-sync.js";
import { sellarTimestamp, PALETAS_DISPONIBLES } from "./schema.js";
import { aplicarPaleta, obtenerModoTemaLocal, guardarModoTemaLocal, COLORES_PREVIEW_PALETA, FONDO_PREVIEW_AZUCARADO } from "../ui/tema.js";
import { traducirTextoInterfaz } from "./i18n.js";
import { iniciarFlujoPaletaPersonalizada } from "../ui/paleta-personalizada.js";
import { aplicarLogoApp, prepararImagenLogo } from "./marca.js";

const SECCIONES_TUTORIAL = [
  { id:"resumen", nombre:"Resumen", puntos:["Clases, entregas y exámenes próximos.","Avance de estudio del día.","Accesos rápidos a lo que requiere atención."] },
  { id:"agenda", nombre:"Agenda", puntos:["Alterna entre lista, calendario y cronograma.","Organiza tareas, exámenes, proyectos y eventos.","Vincula cada actividad con su materia y semestre."] },
  { id:"horario", nombre:"Horario", puntos:["Guarda hora, aula, profesor y modalidad.","Abre una clase para ver todos sus detalles.","Compara horarios con tus amistades."] },
  { id:"tiempo-estudio", nombre:"Tiempo de estudio", puntos:["Abre una materia y toca Iniciar sesión.","Usa bloques personalizados aunque no tengas plan.","Consulta historial y estadísticas de todos tus semestres."] },
  { id:"semestres", nombre:"Semestres", puntos:["Matricula materias de tu plan.","Registra criterios, asignaciones y notas.","Revisa proyecciones y el Wrapped al finalizar."] },
  { id:"comunidad", nombre:"Comunidad", puntos:["Guarda profesores y compañeros.","Añade contactos y valoraciones.","Compara horarios con amistades."] },
  { id:"finanzas", nombre:"Finanzas", puntos:["Registra ingresos y gastos desde el inicio.","Clasifica movimientos por categoría.","Asociarlos a un semestre es opcional."] },
  { id:"plan-estudios", nombre:"Plan de estudios", puntos:["Añade una o varias carreras.","Pega o importa la malla completa.","El plan alimenta la matrícula de Semestres."] },
  { id:"configuracion", nombre:"Ajustes", puntos:["Cambia idioma, apariencia, paleta y tamaño de texto.","Ordena la navegación y tus preferencias.","Puedes volver a esta guía cuando quieras."] },
];

const TEXTO_FLUJO = "El orden recomendado es: 1) agrega uno o más planes; 2) crea un semestre y matricula materias del plan; 3) con esas materias arma Horario y vincula actividades en Agenda; 4) inicia sesiones desde materias para tener estadísticas ordenadas por periodo. Tiempo también admite bloques personalizados. Wapper necesita Agenda y una clave de Gemini para automatizar tareas. Comunidad y Finanzas funcionan por separado; en Finanzas, el semestre es una clasificación opcional.";
let cerrarGuiaPlanActiva = null;

function guardar() {
  const cfg = estado.datos?.configuracion;
  if (cfg) sellarTimestamp(cfg);
  marcarCambioPendiente();
}

function mostrarOnboardingNuevoUsuario({ navegar, toast } = {}) {
  if (!estado.datos?.configuracion || estado.datos.configuracion.onboarding_v1_completado !== false) return false;
  const cfg = estado.datos.configuracion;
  const secciones = SECCIONES_TUTORIAL.filter(({id}) => document.getElementById(`seccion-${id}`));
  const cuentaConDatos = Object.entries(estado.datos).some(([clave, valor]) =>
    Array.isArray(valor) && valor.length > 0 && clave !== "planes_estudio_demo"
  );
  const tienePlanArmado = Boolean(estado.datos.planes_estudio?.some((plan) => plan.materias?.length || plan.optativas_disponibles?.length));
  const faltaNombre = !(estado.datos.perfil?.nombre_preferido || estado.datos.perfil?.nombre || "").trim();
  let etapa = cuentaConDatos ? (faltaNombre ? "nombre" : (!cfg.paleta || !cfg.modo ? "personalizar" : "tour")) : "nombre", indice = 0;
  const overlay = document.createElement("div");
  overlay.className = "onboarding-overlay";
  overlay.setAttribute("role","dialog"); overlay.setAttribute("aria-modal","true"); overlay.setAttribute("aria-labelledby","onboarding-titulo");
  const panel = document.createElement("section"); panel.className = "onboarding-panel";
  panel.innerHTML = '<header class="onboarding-top"><span class="onboarding-progreso"></span><button class="onboarding-cerrar" type="button" aria-label="Cerrar">×</button></header><div class="onboarding-layout"><div class="onboarding-copy"><h1 id="onboarding-titulo"></h1><div class="onboarding-contenido"></div></div><div class="onboarding-preview-wrap"><iframe class="onboarding-preview" title="Vista previa real de App Académica" loading="lazy" data-analitica-ignorar></iframe></div></div><footer class="onboarding-acciones"></footer>';
  overlay.append(panel); document.body.append(overlay);
  const progreso=panel.querySelector(".onboarding-progreso"), titulo=panel.querySelector("h1"), contenido=panel.querySelector(".onboarding-contenido"), acciones=panel.querySelector(".onboarding-acciones"), preview=panel.querySelector("iframe");
  let timersPreview=[];
  preview.addEventListener("load",()=>{
    timersPreview.forEach(clearTimeout);timersPreview=[];
    if(preview.dataset.loaded?.startsWith("semestres:")){
      let interaccion=false;let doc;try{doc=preview.contentDocument;}catch(_){return;}
      if(!doc)return;
      ["pointerdown","keydown","touchstart","wheel"].forEach(tipo=>doc.addEventListener(tipo,()=>{interaccion=true;timersPreview.forEach(clearTimeout);timersPreview=[];},{once:true,capture:true}));
      const programar=(espera,accion)=>timersPreview.push(setTimeout(()=>{if(!interaccion)accion();},espera));
      const encontrarHistorial=()=>[...doc.querySelectorAll("h3")].find(e=>/historial académico/i.test(e.textContent));
      programar(1500,()=>{const h=encontrarHistorial();const card=h?.closest(".glass-card");if(h&&card&&!card.querySelector(".pill-group"))h.parentElement?.parentElement?.click();});
      programar(2900,()=>encontrarHistorial()?.scrollIntoView({behavior:"smooth",block:"center"}));
      programar(4100,()=>doc.querySelector("#seccion-semestres .materia-linea1")?.click());
    }
  });
  const boton=(texto,clase,fn)=>{const b=document.createElement("button");b.type="button";b.className=`btn ${clase}`;b.textContent=traducirTextoInterfaz(texto);b.addEventListener("click",fn);return b;};
  const texto=(tag,cls,value)=>{const e=document.createElement(tag);if(cls)e.className=cls;e.textContent=traducirTextoInterfaz(value);return e;};
  const fin=(irAlPlan=false)=>{timersPreview.forEach(clearTimeout);timersPreview=[];cfg.onboarding_v1_completado=true;guardar();overlay.remove();if(irAlPlan){const destino=tienePlanArmado?"semestres":"plan-estudios";navegar?.(destino);setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:tienePlanArmado,yaEnSemestres:tienePlanArmado}),450);}else toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes generales."));};
  const instalarYa=()=>Boolean(navigator.standalone)||matchMedia("(display-mode: standalone)").matches;
  const cargarPreview=(seccion="resumen")=>{const u=new URL(location.href);u.search="";u.searchParams.set("demo","1");u.searchParams.set("preview","1");u.searchParams.set("previewSection",seccion);u.searchParams.set("previewPalette",cfg.paleta||"azul");u.searchParams.set("previewMode",obtenerModoTemaLocal());u.searchParams.set("previewLogo",cfg.logo_app||"folder");if(cfg.paleta==="personalizada"&&cfg.paleta_personalizada)u.searchParams.set("previewCustom",JSON.stringify(cfg.paleta_personalizada));if(cfg.logo_app_url)u.searchParams.set("previewLogoData",cfg.logo_app_url);const key=`${seccion}:${u.search}`;if(preview.dataset.loaded!==key){preview.dataset.loaded=key;preview.src=u.href;}};
  const pintar=()=>{
    contenido.replaceChildren();acciones.replaceChildren();
    const esTour=etapa==="tour";panel.classList.toggle("onboarding-con-tour",esTour||etapa==="personalizar");
    panel.querySelector(".onboarding-cerrar").classList.toggle("oculto",!cuentaConDatos&&(etapa==="nombre"||etapa==="personalizar"));
    const nombres={nombre:"Tu cuenta, a tu manera",personalizar:"Personaliza tu app",instalar:"Llévala contigo",tour:`Conoce ${secciones[indice]?.nombre||"App Académica"}`,flujo:"Todo conectado, paso a paso"};
    titulo.textContent=etapa==="tour"?`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(secciones[indice]?.nombre||"App Académica")}`:traducirTextoInterfaz(nombres[etapa]||"App Académica");
    progreso.textContent=etapa==="tour"?`${indice+1} de ${secciones.length} secciones`:({nombre:"Bienvenida",personalizar:"Personalización",instalar:"Instalación",flujo:"Cómo empezar"}[etapa]||"");
    preview.closest(".onboarding-preview-wrap").classList.toggle("oculto",!esTour&&etapa!=="personalizar");
    if(etapa==="nombre"){
      contenido.append(texto("p","onboarding-lead","¿Cómo te llamas? Puedes cambiarlo después en Ajustes generales."));
      const input=document.createElement("input");input.className="form-input";input.maxLength=60;input.autocomplete="given-name";input.value=estado.datos.perfil?.nombre_preferido||estado.datos.perfil?.nombre||"";input.setAttribute("aria-label",titulo.textContent);contenido.append(input);
      acciones.append(boton("Continuar","btn-primary",()=>{const v=input.value.trim();if(!v){input.focus();return;}estado.datos.perfil.nombre_preferido=v;guardar();window.renderizarPerfil?.();etapa=cuentaConDatos?"tour":"personalizar";pintar();}));requestAnimationFrame(()=>input.focus());return;
    }
    if(etapa==="personalizar"){
      contenido.append(texto("p","onboarding-lead","Elige tema, paleta y logo. Puedes cambiarlos luego en Personalizar."));
      const modos=document.createElement("div");modos.className="onboarding-modos";
      [["light","Modo claro"],["dark","Modo color"],["true-dark","Modo oscuro"]].forEach(([v,l])=>{const b=boton(l,obtenerModoTemaLocal()===v?"btn-primary":"btn-secondary",()=>{cfg.modo=v;guardarModoTemaLocal(v);aplicarPaleta(cfg.paleta||"azul",v,cfg.paleta==="personalizada"?cfg.paleta_personalizada?.colores:undefined);aplicarLogoApp();guardar();pintar();});b.setAttribute("aria-pressed",String(obtenerModoTemaLocal()===v));modos.append(b);});
      const colores=document.createElement("div");colores.className="onboarding-paletas";
      PALETAS_DISPONIBLES.forEach((p)=>{const b=document.createElement("button");b.type="button";b.className="onboarding-color";b.title=traducirTextoInterfaz(p);b.setAttribute("aria-label",traducirTextoInterfaz(p));b.setAttribute("aria-pressed",String(cfg.paleta===p));const colors=COLORES_PREVIEW_PALETA[p]||[];b.style.background=p==="azucarado"?FONDO_PREVIEW_AZUCARADO:`linear-gradient(135deg,${colors.join(",")})`;b.addEventListener("click",()=>{cfg.paleta=p;aplicarPaleta(p,obtenerModoTemaLocal());aplicarLogoApp();guardar();pintar();});colores.append(b);});
      const paletaPersonal=document.createElement("button");paletaPersonal.className="btn btn-secondary";paletaPersonal.textContent=traducirTextoInterfaz("Más colores · Crear mi paleta");paletaPersonal.onclick=()=>iniciarFlujoPaletaPersonalizada({alGuardar:()=>{cfg.paleta="personalizada";cfg.paleta_personalizada=estado.datos.configuracion.paleta_personalizada;guardar();aplicarPaleta("personalizada",obtenerModoTemaLocal(),cfg.paleta_personalizada?.colores);aplicarLogoApp();}});
      const logos=document.createElement("div");logos.className="onboarding-logos";[["folder","imagenes/LogoAppFolder.png","Carpeta"],["birrete","imagenes/LogoAppBirrete.png","Birrete"]].forEach(([v,src,alt])=>{const b=document.createElement("button");b.type="button";b.className="onboarding-logo";b.setAttribute("aria-pressed",String(cfg.logo_app===v&&!cfg.logo_app_url));const img=document.createElement("img");img.src=src;img.alt=alt;b.append(img);b.onclick=()=>{cfg.logo_app=v;cfg.logo_app_url=null;guardar();aplicarLogoApp();pintar();};logos.append(b);});
      const etiquetaArchivo=document.createElement("label");etiquetaArchivo.className="btn btn-secondary onboarding-file-picker";etiquetaArchivo.append(texto("span","","Elegir archivo de logo"));
      const archivo=document.createElement("input");archivo.type="file";archivo.accept="image/png,image/jpeg,image/webp";archivo.className="onboarding-file-input";archivo.setAttribute("aria-label","Elegir logo desde archivos");archivo.onchange=async()=>{const url=await prepararImagenLogo(archivo.files?.[0]);if(url){cfg.logo_app="personalizado";cfg.logo_app_url=url;guardar();aplicarLogoApp();pintar();}};etiquetaArchivo.append(archivo);
      contenido.append(modos,colores,paletaPersonal,texto("h3","","Logo de la app"),logos,texto("small","muted","También puedes elegir aquí un archivo LogoApp de Descargas."),etiquetaArchivo);cargarPreview("resumen");
      acciones.append(boton("Continuar","btn-primary",()=>{cfg.personalizacion_inicial_completada=true;guardar();etapa=instalarYa()?"tour":"instalar";pintar();}));return;
    }
    if(etapa==="instalar"){
      contenido.append(texto("p","onboarding-lead","Instala App Académica para abrirla como una app en tu teléfono o computadora. Si ya está instalada, este paso se omite."));
      acciones.append(boton("Ahora no","btn-secondary",()=>{etapa="tour";indice=0;pintar();}),boton("Instalar app","btn-primary",()=>{window.instalarAppAcademica?.();etapa="tour";indice=0;pintar();}));return;
    }
    if(etapa==="tour"){
      const sec=secciones[indice];if(!sec){etapa="flujo";pintar();return;}
      const lista=document.createElement("ul");lista.className="onboarding-lista";sec.puntos.forEach((p)=>lista.append(texto("li","",p)));contenido.append(lista);
      cargarPreview(sec.id);acciones.append(boton("No me interesa","btn-secondary",()=>{cfg.navegacion_oculta=[...new Set([...(cfg.navegacion_oculta||[]),sec.id])];guardar();window.aplicarVisibilidadNavegacion?.();siguiente();}),boton(indice===secciones.length-1?"Seguir":"Lo usaré","btn-primary",siguiente));return;
    }
    const pasos=document.createElement("ol");pasos.className="onboarding-dependencias";["Agrega tu plan de estudios.","Crea un semestre y matricula tus materias.","Usa esas materias en Horario, Agenda y Tiempo.","Wapper trabaja con tu Agenda; Comunidad funciona por separado.","Finanzas funciona sola; vincularla a un semestre es opcional."].forEach(t=>pasos.append(texto("li","",t)));contenido.append(pasos);
    acciones.append(boton("Lo haré después","btn-secondary",()=>fin(false)),boton(tienePlanArmado?"Continuar con Semestres":"Agregar plan y ver la guía","btn-primary",()=>fin(true)));
  };
  const siguiente=()=>{indice++;if(indice>=secciones.length)etapa="flujo";pintar();};
  panel.querySelector(".onboarding-cerrar").addEventListener("click",()=>fin(false));
  pintar();return true;
}

function iniciarGuiaPlan({ navegar, posteriorImportacion = false, yaEnSemestres = false } = {}){
  const yaTienePlan = Boolean(estado.datos?.planes_estudio?.some((plan) => plan.materias?.length || plan.optativas_disponibles?.length));
  const pasos=[
    ...(posteriorImportacion ? [
      {selector:()=>yaEnSemestres?document.getElementById("seccion-semestres"):document.getElementById("nav-semestres"),texto:"Tu plan ya está guardado. Ahora registra un semestre y matricula las materias que llevarás."},
      {selector:()=>[...document.querySelectorAll("#seccion-semestres button")].find(b=>/registrar semestre|crear semestre|agregar semestre/i.test(b.textContent)),texto:"Registra el semestre y selecciona materias de tu plan. Así podrás conectarlas con Horario, Agenda y Tiempo."},
    ] : yaTienePlan ? [
      {selector:()=>document.getElementById("btn-gestion-planes")||document.getElementById("btn-gestionar-planes")||document.querySelector("#seccion-plan-estudios button"),texto:"Ya tienes un plan. Puedes revisar sus materias o abrir Gestionar plan para añadir otra carrera."},
      {selector:()=>document.getElementById("nav-semestres"),texto:"El siguiente paso es crear un semestre y matricular materias de ese plan."},
    ] : [
      {selector:()=>[...document.querySelectorAll("#seccion-plan-estudios .pill-group button")].find(b=>/Pegar link|Adjuntar PDF/i.test(b.textContent)),texto:"Primero elige Pegar link o Adjuntar PDF/Imagen. Luego envía tu plan a Claude para que lo convierta al formato CSV."},
      {selector:()=>document.getElementById("btn-enviar-import-claude"),texto:"Pulsa Enviar a Claude y sigue la guía para adjuntar tu plan. Cuando Claude devuelva el CSV, vuelve a esta app."},
      {selector:()=>document.getElementById("textarea-csv-importar"),texto:"Copia el bloque CSV completo, desde CARRERA hasta la última materia, y pégalo aquí. Luego toca Importar."},
      {selector:()=>[...document.querySelectorAll("#seccion-plan-estudios button")].find(b=>/^importar$/i.test(b.textContent.trim())),texto:"Pulsa Importar para guardar y revisar las materias. Cuando termine, la guía te llevará a Semestres para continuar."},
    ])
  ];let i=0;const pop=document.createElement("aside");pop.className="guia-plan-flotante";pop.setAttribute("role","dialog");document.body.append(pop);let resaltado=null;
  const cerrar=()=>{resaltado?.classList.remove("guia-plan-resaltado");pop.remove();if(cerrarGuiaPlanActiva===cerrar)cerrarGuiaPlanActiva=null;};
  cerrarGuiaPlanActiva=cerrar;
  const pintar=()=>{resaltado?.classList.remove("guia-plan-resaltado");if(i>=pasos.length){cerrar();return;}if(!posteriorImportacion&&!yaTienePlan&&i>=1&&!document.getElementById("textarea-csv-importar")){const link=[...document.querySelectorAll("#seccion-plan-estudios .pill-group button")].find(b=>/Pegar link/i.test(b.textContent));if(link)link.click();setTimeout(pintar,80);return;}resaltado=pasos[i].selector();resaltado?.classList.add("guia-plan-resaltado");resaltado?.scrollIntoView({behavior:"smooth",block:"center"});pop.replaceChildren();const titulo=document.createElement("strong");titulo.textContent=`${i+1} / ${pasos.length}`;const p=document.createElement("p");p.textContent=traducirTextoInterfaz(pasos[i].texto);pop.append(titulo,p);const acciones=document.createElement("div");acciones.className="row";const seguir=document.createElement("button");seguir.className="btn btn-primary";seguir.textContent=traducirTextoInterfaz(i===pasos.length-1?"Entendido":"Siguiente");seguir.onclick=()=>{if(posteriorImportacion&&i===0)navegar?.("semestres");i++;pintar();};const saltar=document.createElement("button");saltar.className="btn btn-secondary";saltar.textContent=traducirTextoInterfaz("Saltar guía");saltar.onclick=cerrar;acciones.append(seguir,saltar);pop.append(acciones);};pintar();
  window.continuarTutorialDespuesDeImportarPlan=()=>{if(!cerrarGuiaPlanActiva)return;cerrar();navegar?.("semestres");setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:true,yaEnSemestres:true}),350);};
}

function inicializarTutorialDesdeAjustes({ navegar, toast } = {}) {
  const btn=document.getElementById("btn-repetir-tutorial");if(!btn||btn.dataset.inicializado)return;btn.dataset.inicializado="1";btn.addEventListener("click",()=>{if(!estado.datos?.configuracion)return;estado.datos.configuracion.onboarding_v1_completado=false;mostrarOnboardingNuevoUsuario({navegar,toast});});
}
export { mostrarOnboardingNuevoUsuario, inicializarTutorialDesdeAjustes };
