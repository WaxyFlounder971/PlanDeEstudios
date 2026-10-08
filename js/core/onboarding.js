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
  estilo.textContent =
    ".onboarding-overlay .onboarding-top,.onboarding-overlay .onboarding-layout,.onboarding-overlay .onboarding-copy{background:transparent}" +
    ".onboarding-nota-error{margin:.5rem 0 0;font-size:.9rem;color:var(--danger,#e5484d)}" +
    ".onboarding-nota-error[hidden]{display:none}";
  document.head.append(estilo);
}

function esColorVisible(color) {
  if (!color || color === "transparent") return false;
  const m = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return true;
  const partes = m[1].split(/[,/\s]+/).filter(Boolean);
  return !(partes.length >= 4 && parseFloat(partes[3]) === 0);
}

function leerFondoDeLaApp() {
  const estilos = [document.body, document.documentElement].map((el) => getComputedStyle(el));
  const fuente = estilos.find((e) => esColorVisible(e.backgroundColor) || e.backgroundImage !== "none") || estilos[0];
  const color = esColorVisible(fuente.backgroundColor)
    ? fuente.backgroundColor
    : (getComputedStyle(document.documentElement).getPropertyValue("--bg-header-solido").trim() || "Canvas");
  return { color, imagen: fuente.backgroundImage, tamano: fuente.backgroundSize, posicion: fuente.backgroundPosition, repetir: fuente.backgroundRepeat };
}

function crearSincronizadorFondo(...elementos) {
  let raf = 0, timer = 0;
  const aplicar = () => {
    const f = leerFondoDeLaApp();
    elementos.forEach((el) => {
      el.style.backgroundColor = f.color; el.style.backgroundImage = f.imagen;
      el.style.backgroundSize = f.tamano; el.style.backgroundPosition = f.posicion;
      el.style.backgroundRepeat = f.repetir; el.style.backgroundAttachment = "fixed";
    });
  };
  // Se relee en el siguiente frame y otra vez tras las transiciones CSS de color.
  const programar = () => { cancelAnimationFrame(raf); clearTimeout(timer); raf = requestAnimationFrame(aplicar); timer = setTimeout(aplicar, 450); };
  const observador = new MutationObserver(programar);
  observador.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-palette", "data-rendimiento", "style", "class"] });
  if (document.body) observador.observe(document.body, { attributes: true, attributeFilter: ["class", "style", "data-mode"] });
  aplicar();
  return { programar, detener() { observador.disconnect(); cancelAnimationFrame(raf); clearTimeout(timer); } };
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
  let panelPersonalizacion = "opciones";
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
  const fondo=crearSincronizadorFondo(overlay,panel);
  const aplicarTemaAhora=()=>{aplicarPaleta(paletaActual(),modoPersonalizacion,coloresActuales());document.documentElement.setAttribute("data-mode",modoPersonalizacion);aplicarLogoApp();fondo.programar();};
  const progreso=panel.querySelector(".onboarding-progreso"), titulo=panel.querySelector("h1"), contenido=panel.querySelector(".onboarding-contenido"), acciones=panel.querySelector(".onboarding-acciones"), preview=panel.querySelector("iframe");
  let timersPreview=[], cerrarListaTour=null, temporizadorTour=null, ctrlTour=null;
  const bloquearNavegacionDeResumen=()=>{
    let doc;try{doc=preview.contentDocument;}catch(_){return;}
    if(!doc)return;
    const bloquear=etapa==="tour"&&preview.dataset.seccion==="resumen";
    doc.querySelectorAll(".btn-nav[data-seccion]").forEach((b)=>{
      const deshabilitar=bloquear&&b.dataset.seccion!=="resumen";
      b.disabled=deshabilitar;
      if(deshabilitar){b.setAttribute("aria-disabled","true");b.title="Durante esta parte de la guía, explora solo Resumen.";}
      else{b.removeAttribute("aria-disabled");b.removeAttribute("title");}
    });
  };
  const actualizarPreview=()=>{
    bloquearNavegacionDeResumen();
    preview.contentWindow?.postMessage({
    type:"APP_PREVIEW_UPDATE", paleta:cfg.paleta||"azul", modo:modoPersonalizacion,
    calidad:calidadPersonalizacion,
    colores:cfg.paleta==="personalizada"?cfg.paleta_personalizada?.colores:null,
    logo:cfg.logo_app||"folder", logoData:cfg.logo_app_url||null,
    geminiKey:etapa==="wapper-config"?(cfg.gemini_api_key||null):null
    },location.origin);
  };
  let inicioDeslizamiento=null;
  const comenzarDeslizamiento=(ev)=>{if(ev.touches.length===1)inicioDeslizamiento=ev.touches[0].clientX;};
  const terminarDeslizamiento=(ev)=>{
    if(inicioDeslizamiento===null)return;
    const delta=ev.changedTouches[0].clientX-inicioDeslizamiento;inicioDeslizamiento=null;
    if(!matchMedia("(max-width:760px)").matches||etapa!=="personalizar"||Math.abs(delta)<55)return;
    panelPersonalizacion=delta<0?"preview":"opciones";pintar();
  };
  panel.addEventListener("touchstart",comenzarDeslizamiento,{passive:true});
  panel.addEventListener("touchend",terminarDeslizamiento,{passive:true});
  preview.addEventListener("load",()=>{
    actualizarPreview();
    bloquearNavegacionDeResumen();
    timersPreview.forEach(clearTimeout);timersPreview=[];
    let docTour;try{docTour=preview.contentDocument;}catch(_){}
    if(docTour){
      docTour.addEventListener("touchstart",comenzarDeslizamiento,{passive:true});
      docTour.addEventListener("touchend",terminarDeslizamiento,{passive:true});
      const iniciarExploracao=()=>{if(etapa==="tour"&&matchMedia("(orientation:portrait)").matches)cerrarListaTour?.();};
      ["pointerdown","keydown","touchstart","wheel"].forEach(tipo=>docTour.addEventListener(tipo,iniciarExploracao,{once:true,capture:true}));
    }
    if(preview.dataset.seccion==="semestres"){
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
  const fin=(irAlPlan=false,irASemestres=false)=>{ctrlTour?.abort();fondo.detener();timersPreview.forEach(clearTimeout);timersPreview=[];clearTimeout(temporizadorTour);cfg.onboarding_v1_completado=true;cfg.tutoriales_secciones_vistas=cfg.tutoriales_secciones_vistas||{};if(irAlPlan)cfg.tutoriales_secciones_vistas["plan-estudios"]=true;if(irASemestres)cfg.tutoriales_secciones_vistas.semestres=true;guardar();overlay.remove();if(irAlPlan||irASemestres){const destino=irASemestres?"semestres":"plan-estudios";navegar?.(destino);setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:irASemestres,yaEnSemestres:irASemestres}),450);}else toast?.(traducirTextoInterfaz("¡Listo! Puedes volver a ver la guía desde Ajustes generales."));};
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
    preview.dataset.seccion=seccion;preview.src=u.href;
  };
  // Carga la vista previa en segundo plano mientras la persona escribe su nombre.
  const precalentarPreview=()=>{
    if(preview.dataset.seccion||navigator.connection?.saveData)return;
    const cargar=()=>{if(overlay.isConnected&&!preview.dataset.seccion)cargarPreview("resumen");};
    if("requestIdleCallback" in window)requestIdleCallback(cargar,{timeout:2500});else setTimeout(cargar,900);
  };
  const pintar=()=>{
    ctrlTour?.abort();ctrlTour=null;
    contenido.replaceChildren();acciones.replaceChildren();
    const esTour=etapa==="tour";panel.classList.toggle("onboarding-con-tour",esTour||etapa==="personalizar"||etapa==="wapper-config");
    panel.classList.toggle("onboarding-mostrar-preview",etapa==="personalizar"&&panelPersonalizacion==="preview");
    panel.querySelector(".onboarding-cerrar").classList.toggle("oculto",!cuentaConDatos&&(etapa==="nombre"||etapa==="personalizar"));
    const nombres={nombre:"Tu cuenta, a tu manera",personalizar:"Personaliza tu app",instalar:"Llévala contigo",tour:`Conoce ${secciones[indice]?.nombre||"App Académica"}`,"wapper-config":"Activa Wapper",flujo:"Todo conectado, paso a paso"};
    titulo.textContent=etapa==="tour"?`${traducirTextoInterfaz("Conoce")} ${traducirTextoInterfaz(secciones[indice]?.nombre||"App Académica")}`:traducirTextoInterfaz(nombres[etapa]||"App Académica");
    progreso.textContent=etapa==="tour"?`${indice+1} de ${secciones.length} secciones`:({nombre:"Bienvenida",personalizar:"Personalización",instalar:"Instalación",flujo:"Cómo empezar"}[etapa]||"");
    preview.closest(".onboarding-preview-wrap").classList.toggle("oculto",!esTour&&etapa!=="personalizar"&&etapa!=="wapper-config");
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
      requestAnimationFrame(()=>input.focus({preventScroll:true}));precalentarPreview();return;
    }
    if(etapa==="personalizar"){
      contenido.append(texto("p","onboarding-lead","Elige tema, paleta y logo. Puedes cambiarlos luego en Personalizar."));
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
      contenido.append(modos,calidades,notaFancy,colores,filaLogo,logos);cargarPreview("resumen");
      const esMovil=matchMedia("(max-width:760px)").matches;
      acciones.append(boton("Atrás","btn-secondary",()=>{if(panelPersonalizacion==="preview"){panelPersonalizacion="opciones";pintar();}else{etapa="nombre";pintar();}}));
      if(esMovil&&panelPersonalizacion==="preview"){
        acciones.append(boton("Continuar","btn-primary",()=>{cfg.personalizacion_inicial_completada=true;guardar();etapa=etapaTrasPersonalizar();indice=0;pintar();}));
      }else{
        acciones.append(boton("Continuar","btn-primary",()=>{if(esMovil){panelPersonalizacion="preview";actualizarPreview();pintar();return;}cfg.personalizacion_inicial_completada=true;guardar();etapa=etapaTrasPersonalizar();indice=0;pintar();}));
      }return;
    }
    if(etapa==="instalar"){
      contenido.append(texto("p","onboarding-lead","Instala App Académica para abrirla como una app en tu teléfono o computadora. Si ya está instalada, este paso se omite."));
      acciones.append(boton("Atrás","btn-secondary",()=>{etapa="personalizar";pintar();}),boton("Ahora no","btn-secondary",()=>{etapa="tour";indice=0;pintar();}),boton("Instalar app","btn-primary",()=>{window.instalarAppAcademica?.();etapa="tour";indice=0;pintar();}));return;
    }
    if(etapa==="tour"){
      const sec=secciones[indice];if(!sec){etapa="flujo";pintar();return;}
      const bloqueConoce=document.createElement("section");bloqueConoce.className="onboarding-conoce";
      const botonConoce=boton("Conoce "+sec.nombre+" ⌄","btn-secondary",()=>{bloqueConoce.classList.toggle("plegado");botonConoce.textContent="Conoce "+sec.nombre+" "+(bloqueConoce.classList.contains("plegado")?"⌄":"⌃");});
      const lista=document.createElement("ul");lista.className="onboarding-lista";sec.puntos.forEach((p)=>lista.append(texto("li","",p)));bloqueConoce.append(botonConoce,lista);contenido.append(bloqueConoce);
      cerrarListaTour=()=>{clearTimeout(temporizadorTour);bloqueConoce.classList.add("plegado");botonConoce.textContent="Conoce "+sec.nombre+" ⌄";};
      clearTimeout(temporizadorTour);if(matchMedia("(max-width:760px) and (orientation: portrait)").matches)temporizadorTour=setTimeout(()=>{if(etapa==="tour"&&bloqueConoce.isConnected)cerrarListaTour?.();},5000);
      const detectarInteraccion=(ev)=>{if(etapa==="tour"&&matchMedia("(orientation: portrait)").matches&&!ev.target.closest(".onboarding-conoce"))cerrarListaTour?.();};
      ctrlTour=new AbortController();["pointerdown","keydown","touchstart","wheel"].forEach(tipo=>overlay.addEventListener(tipo,detectarInteraccion,{once:true,capture:true,signal:ctrlTour.signal}));
      cargarPreview(sec.id);
      if(indice>0)acciones.append(boton("Atrás","btn-secondary",()=>{indice--;pintar();}));
      const usarSeccion=()=>{cfg.navegacion_oculta=(cfg.navegacion_oculta||[]).filter(id=>id!==sec.id);guardar();window.aplicarVisibilidadNavegacion?.();siguiente();};
      if(sec.id==="asistente"){
        const accionesWapper=document.createElement("div");accionesWapper.className="onboarding-wapper-cta-wrap";
        accionesWapper.append(boton("Configurar Wapper","btn-primary onboarding-wapper-cta",()=>{etapa="wapper-config";pintar();}));contenido.append(accionesWapper);
      }
      if(indice===0)acciones.append(boton("Atrás","btn-secondary",()=>{etapa="personalizar";pintar();}));
      acciones.append(boton("No me interesa","btn-secondary",()=>{cfg.navegacion_oculta=[...new Set([...(cfg.navegacion_oculta||[]),sec.id])];guardar();window.aplicarVisibilidadNavegacion?.();siguiente();}),boton(indice===secciones.length-1?"Seguir":"Siguiente", "btn-primary",usarSeccion));return;
    }
    if(etapa==="wapper-config"){
      const pasosWapper=document.createElement("ol");pasosWapper.className="onboarding-dependencias";["Wapper usa tu Agenda para crear y consultar pendientes.","Guarda aquí tu clave personal de Gemini para activarlo.","Después podrás dictar tareas, exámenes y eventos desde Asistente."].forEach(t=>pasosWapper.append(texto("li","",t)));contenido.append(pasosWapper);
      contenido.append(texto("p","onboarding-wapper-estado",cfg.gemini_api_key?"Wapper está activo: ya hay una clave de Gemini guardada.":"Wapper necesita una clave personal de Gemini para funcionar."));
      if(!cfg.gemini_api_key){const label=texto("label","onboarding-wapper-etiqueta","Clave de Gemini");const input=document.createElement("input");input.type="password";input.className="form-input";input.autocomplete="new-password";input.placeholder="Pega tu clave personal";input.setAttribute("aria-label","Clave de Gemini");label.append(input);contenido.append(label);contenido.append(boton("Guardar y activar Wapper","btn-primary onboarding-wapper-cta",()=>{const clave=input.value.trim();if(!clave){input.focus();return;}cfg.gemini_api_key=clave;guardar();window.aplicarVisibilidadBotonAsistente?.();actualizarPreview();pintar();}));}
      cargarPreview("asistente");
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
  const semestresIniciales=new Set((estado.datos?.semestres||[]).map(s=>s.id));
  let semestreCreadoEnGuia=false;
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
  ];let i=0;const pop=document.createElement("aside");pop.className="guia-plan-flotante";pop.setAttribute("role","dialog");document.body.append(pop);let resaltado=null;let esperaAlta=null;
  const cerrar=({continuarSemestres=false}={})=>{resaltado?.classList.remove("guia-plan-resaltado");pop.remove();if(cerrarGuiaPlanActiva===cerrar)cerrarGuiaPlanActiva=null;if(continuarSemestres&&semestreCreadoEnGuia){const info=SECCIONES_TUTORIAL.find(s=>s.id==="semestres");setTimeout(()=>iniciarGuiaSeccion(info),180);}};
  cerrarGuiaPlanActiva=cerrar;
  const revisarAlta=()=>{if(!pop.isConnected||i!==1)return;const nuevos=(estado.datos?.semestres||[]).filter(s=>!semestresIniciales.has(s.id));if(nuevos.length){semestreCreadoEnGuia=true;estado.datos.configuracion.tutoriales_secciones_vistas=estado.datos.configuracion.tutoriales_secciones_vistas||{};estado.datos.configuracion.tutoriales_secciones_vistas.semestres=true;guardar();const semestre=nuevos.sort((a,b)=>(b._actualizadoEn||0)-(a._actualizadoEn||0))[0];pasos.splice(2,0,{selector:()=>document.querySelector(`[data-semestre-id="${semestre.id}"]`)||document.getElementById("seccion-semestres"),texto:"Listo: el semestre ya está registrado con sus materias. Abre la tarjeta para revisar asignaciones y notas; luego conecta estas materias con Horario, Agenda y Tiempo."});i=2;pintar();return;}if(!document.querySelector(".overlay-alta-semestre")){if(esperaAlta)clearInterval(esperaAlta);esperaAlta=null;setTimeout(pintar,150);return;}setTimeout(revisarAlta,500);};
  const pintar=()=>{resaltado?.classList.remove("guia-plan-resaltado");if(i>=pasos.length){cerrar({continuarSemestres:posteriorImportacion&&yaEnSemestres});return;}if(!posteriorImportacion&&!yaTienePlan&&i>=1&&!document.getElementById("textarea-csv-importar")){const link=[...document.querySelectorAll("#seccion-plan-estudios .pill-group button")].find(b=>/Pegar link/i.test(b.textContent));if(link)link.click();setTimeout(pintar,80);return;}resaltado=pasos[i].selector();resaltado?.classList.add("guia-plan-resaltado");resaltado?.scrollIntoView({behavior:"smooth",block:"center"});pop.replaceChildren();const titulo=document.createElement("strong");titulo.textContent=`${i+1} / ${pasos.length}`;const p=document.createElement("p");p.textContent=traducirTextoInterfaz(pasos[i].texto);pop.append(titulo,p);const acciones=document.createElement("div");acciones.className="row";const seguir=document.createElement("button");seguir.className="btn btn-primary";seguir.textContent=traducirTextoInterfaz(i===pasos.length-1?"Continuar":"Siguiente");seguir.onclick=()=>{if(posteriorImportacion&&i===0){estado.datos.configuracion.tutoriales_secciones_vistas=estado.datos.configuracion.tutoriales_secciones_vistas||{};estado.datos.configuracion.tutoriales_secciones_vistas.semestres=true;guardar();navegar?.("semestres");}if(posteriorImportacion&&i===1){resaltado?.click();pop.classList.add("oculto");esperaAlta=setInterval(()=>{if(!document.querySelector(".overlay-alta-semestre")){clearInterval(esperaAlta);esperaAlta=null;}},500);setTimeout(revisarAlta,500);return;}i++;pintar();};const saltar=document.createElement("button");saltar.className="btn btn-secondary";saltar.textContent=traducirTextoInterfaz("Saltar guía");saltar.onclick=cerrar;acciones.append(seguir,saltar);pop.append(acciones);pop.classList.remove("oculto");};pintar();
  window.continuarTutorialDespuesDeImportarPlan=()=>{if(!cerrarGuiaPlanActiva)return;estado.datos.configuracion.tutoriales_secciones_vistas=estado.datos.configuracion.tutoriales_secciones_vistas||{};estado.datos.configuracion.tutoriales_secciones_vistas.semestres=true;guardar();cerrar();navegar?.("semestres");setTimeout(()=>iniciarGuiaPlan({navegar,posteriorImportacion:true,yaEnSemestres:true}),350);};
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
  let indice=0,resaltado=null;
  const pop=document.createElement("aside");pop.className="guia-plan-flotante guia-seccion-flotante";pop.setAttribute("role","dialog");pop.setAttribute("aria-live","polite");pop.setAttribute("aria-label",`${traducirTextoInterfaz("Tutorial")}: ${traducirTextoInterfaz(info.nombre)}`);document.body.append(pop);
  const cerrar=()=>{resaltado?.classList.remove("guia-plan-resaltado");pop.remove();};
  const pintar=()=>{
    resaltado?.classList.remove("guia-plan-resaltado");
    if(indice>=info.puntos.length){cerrar();return;}
    const buscar=objetivos[indice];resaltado=buscar?.()||document.getElementById(`seccion-${info.id}`);
    resaltado?.classList.add("guia-plan-resaltado");resaltado?.scrollIntoView({behavior:"smooth",block:"center",inline:"nearest"});
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
