// Fechas de Notas: formato legible ("Lun 19, oct 2026, 12:54 pm") y campo propio que abre el selector nativo.
const dos = (n) => String(n).padStart(2, "0");
const idioma = () => document.documentElement.lang || "es";

/** ms -> "YYYY-MM-DD" (hora local). */
function aValorFecha(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
/** "YYYY-MM-DD" -> ms (mediodía local, para no cruzar de día por zona horaria). */
function deValorFecha(iso) {
  const t = new Date(`${String(iso).slice(0, 10)}T12:00:00`).getTime();
  return Number.isFinite(t) ? t : Date.now();
}
function aValorLocal(ms) {
  const d = new Date(ms);
  return `${aValorFecha(ms)}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

function formatear(ms, conHora) {
  const d = new Date(ms), l = idioma();
  const partes = new Intl.DateTimeFormat(l, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).formatToParts(d);
  const g = (t) => partes.find((x) => x.type === t)?.value || "";
  const sem = g("weekday").replace(".", "").replace(/^./, (c) => c.toUpperCase());
  let s = `${sem} ${g("day")}, ${g("month").replace(".", "")} ${g("year")}`;
  if (conHora) {
    const h = new Intl.DateTimeFormat(l, { hour: "numeric", minute: "2-digit", hour12: true }).format(d)
      .replace(/[\u202f\u00a0]/g, " ")
      .replace(/\s*([ap])\.?\s*m\.?/i, (_, x) => ` ${x.toLowerCase()}m`);
    s += `, ${h}`;
  }
  return s;
}

/** Campo de fecha con botón en forma de píldora. tipo: "date" | "datetime-local". Devuelve { el, establecer(ms), abrir() }. */
function crearCampoFecha({ etiqueta = "", tipo = "date", ms, alCambiar, clase = "" }) {
  const conHora = tipo === "datetime-local";
  const wrap=document.createElement("span");wrap.className=`nt-fecha ${clase}`.trim();
  const btn=document.createElement("button");btn.type="button";btn.className="nt-fecha-btn";
  if(etiqueta){const e=document.createElement("span");e.className="nt-fecha-etq";e.textContent=etiqueta;btn.append(e);}
  const val=document.createElement("span");val.className="nt-fecha-val";btn.append(val);
  const pop=document.createElement("div");pop.className="nt-calendario nt-oculto";pop.setAttribute("role","dialog");pop.setAttribute("aria-label","Elegir fecha");
  const cab=document.createElement("div");cab.className="nt-cal-cab";const prev=document.createElement("button");prev.type="button";prev.textContent="‹";prev.setAttribute("aria-label","Mes anterior");const mes=document.createElement("strong");const next=document.createElement("button");next.type="button";next.textContent="›";next.setAttribute("aria-label","Mes siguiente");cab.append(prev,mes,next);
  const dias=document.createElement("div");dias.className="nt-cal-dias";["L","M","M","J","V","S","D"].forEach(n=>{const x=document.createElement("span");x.textContent=n;dias.append(x);});const grilla=document.createElement("div");grilla.className="nt-cal-grid";
  const horaWrap=document.createElement("label");horaWrap.className="nt-cal-hora";horaWrap.append(document.createTextNode("Hora"));const selectorHora=document.createElement("span");selectorHora.className="nt-reloj-selectores";const hora=document.createElement("select");for(let h=0;h<24;h++){const o=document.createElement("option");o.value=String(h).padStart(2,"0");o.textContent=o.value;hora.append(o);}const minuto=document.createElement("select");for(let m=0;m<60;m++){const o=document.createElement("option");o.value=String(m).padStart(2,"0");o.textContent=o.value;minuto.append(o);}selectorHora.append(hora,document.createTextNode(":"),minuto);horaWrap.append(selectorHora);const aplicar=document.createElement("button");aplicar.type="button";aplicar.className="nt-cal-aplicar";aplicar.textContent="Aplicar";pop.append(cab,dias,grilla);if(conHora)pop.append(horaWrap,aplicar);wrap.append(btn,pop);
  let actual=new Date(Number.isFinite(ms)?ms:Date.now()),elegido=new Date(actual),vista=new Date(actual.getFullYear(),actual.getMonth(),1);
  const pintar=()=>{val.textContent=formatear(+actual,conHora);btn.setAttribute("aria-label",`${etiqueta?etiqueta+": ":""}${val.textContent}`);};
  const pintarCalendario=()=>{mes.textContent=new Intl.DateTimeFormat(idioma(),{month:"long",year:"numeric"}).format(vista);grilla.replaceChildren();const primero=new Date(vista.getFullYear(),vista.getMonth(),1),desfase=(primero.getDay()+6)%7,total=new Date(vista.getFullYear(),vista.getMonth()+1,0).getDate();for(let i=0;i<desfase;i++){const v=document.createElement("span");grilla.append(v);}for(let d=1;d<=total;d++){const b=document.createElement("button");b.type="button";b.textContent=String(d);b.className="nt-cal-dia";if(d===elegido.getDate()&&vista.getMonth()===elegido.getMonth()&&vista.getFullYear()===elegido.getFullYear())b.classList.add("seleccionado");const hoy=new Date();if(d===hoy.getDate()&&vista.getMonth()===hoy.getMonth()&&vista.getFullYear()===hoy.getFullYear())b.classList.add("hoy");b.onclick=()=>{elegido=new Date(vista.getFullYear(),vista.getMonth(),d,actual.getHours(),actual.getMinutes());pintarCalendario();if(!conHora){actual=elegido;pop.classList.add("nt-oculto");pintar();alCambiar?.(+actual);}};grilla.append(b);}};
  const abrir=()=>{elegido=new Date(actual);vista=new Date(actual.getFullYear(),actual.getMonth(),1);hora.value=dos(elegido.getHours());minuto.value=dos(elegido.getMinutes());pintarCalendario();pop.classList.remove("nt-oculto");};
  prev.onclick=()=>{vista.setMonth(vista.getMonth()-1);pintarCalendario();};next.onclick=()=>{vista.setMonth(vista.getMonth()+1);pintarCalendario();};btn.onclick=()=>pop.classList.contains("nt-oculto")?abrir():pop.classList.add("nt-oculto");
  aplicar.onclick=()=>{const h=Number(hora.value),m=Number(minuto.value);elegido.setHours(h||0,m||0,0,0);actual=elegido;pop.classList.add("nt-oculto");pintar();alCambiar?.(+actual);};
  const fuera=e=>{if(!wrap.contains(e.target))pop.classList.add("nt-oculto");};document.addEventListener("pointerdown",fuera);
  pintar();return{el:wrap,establecer(v){if(Number.isFinite(v)){actual=new Date(v);elegido=new Date(actual);pintar();}},abrir(){if(pop.classList.contains("nt-oculto"))abrir();},destruir(){document.removeEventListener("pointerdown",fuera);}};
}
export { crearCampoFecha, aValorFecha, deValorFecha, formatear };
