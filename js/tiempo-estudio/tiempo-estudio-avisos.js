/* =========================================================================
   TIEMPO DE ESTUDIO — avisos del timer (v3.28.0 C, C6)
   -------------------------------------------------------------------------
   Reemplazan a dos toasts (diseños aprobados en prototipo-toasts-timer.html):
     · «Timer iniciado en …»  →  animación «Onda» sobre el anillo del detalle de la
       materia: dos ondas del color de la materia salen del anillo, un play se
       transforma en el tiempo y «ESTUDIANDO» entra con fundido. Si el anillo no está
       en pantalla (inicio rápido desde la lista) se conserva el toast de siempre.
       Para lectores de pantalla se anuncia con aria-live en lugar del toast.
     · «Bloque guardado — arrancó el descanso»  →  píldora fría «Descanso · MM:SS»
       con un arco que se vacía. Dura 6 s, se cierra al tocarla y se cierra sola si
       el descanso termina. La cuenta sale del mismo timer (suscripción), sin reloj propio.
   El motor del timer no se toca: este archivo es solo UI y recibe por parámetro lo
   que necesita del timer, para no crear imports circulares. El CSS está en
   design-system.css (sección «Tiempo»).
   ========================================================================= */

import { traducirTextoInterfaz } from "../core/i18n.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const MS_ONDAS = 1500;
const MS_AVISO_DESCANSO = 6000;

function anunciar(texto) {
  let region = document.getElementById("te-anuncio");
  if (!region) {
    region = document.createElement("div");
    region.id = "te-anuncio";
    region.className = "te-anuncio-sr";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.append(region);
  }
  region.textContent = "";
  requestAnimationFrame(() => { region.textContent = texto; });
}

function limpiarInicio(anillo) {
  clearTimeout(anillo._teInicioId);
  anillo.classList.remove("te-inicio");
  anillo.querySelectorAll(".te-onda, .te-play-inicio").forEach((n) => n.remove());
}

/** Anima el arranque sobre el anillo del detalle. `false` si ese anillo no está a la vista. */
function reproducirInicioEnAnillo(nombreMateria) {
  const anillo = document.querySelector("#seccion-tiempo-estudio .te-timer-circular-wrap");
  if (!anillo || anillo.getClientRects().length === 0) return false;
  const svg = anillo.querySelector(".te-timer-circular-svg");
  const centro = anillo.querySelector(".te-timer-circular-centro");
  if (!svg || !centro) return false;
  limpiarInicio(anillo);
  const radio = anillo.querySelector(".te-timer-circular-progress")?.getAttribute("r") || "80";
  for (const clase of ["te-onda", "te-onda te-onda--2"]) {
    const onda = document.createElementNS(SVG_NS, "circle");
    onda.setAttribute("class", clase);
    onda.setAttribute("cx", "100");
    onda.setAttribute("cy", "100");
    onda.setAttribute("r", radio);
    svg.append(onda);
  }
  const play = document.createElement("div");
  play.className = "te-play-inicio";
  play.setAttribute("aria-hidden", "true");
  const icono = document.createElementNS(SVG_NS, "svg");
  icono.setAttribute("viewBox", "0 0 24 24");
  const forma = document.createElementNS(SVG_NS, "path");
  forma.setAttribute("d", "M8 5v14l11-7z");
  icono.append(forma);
  play.append(icono);
  centro.append(play);
  anillo.classList.add("te-inicio");
  anillo._teInicioId = setTimeout(() => limpiarInicio(anillo), MS_ONDAS);
  anunciar(traducirTextoInterfaz(`Timer iniciado en ${nombreMateria}`));
  return true;
}

/**
 * Llamar justo después de iniciar/cambiar el timer: espera a que se repinte la sección y elige animación o toast.
 * `mostrarToast` se recibe por parámetro (es el de ui/componentes.js) para que este archivo no dependa de la UI general.
 */
function anunciarInicioTimer(nombreMateria, mostrarToast) {
  requestAnimationFrame(() => {
    if (!reproducirInicioEnAnillo(nombreMateria)) mostrarToast(`Timer iniciado en ${nombreMateria}`);
  });
}

function formatoMinSeg(segundos) {
  const m = Math.floor(segundos / 60);
  const s = segundos % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Píldora fría «Descanso · MM:SS». `suscribir(cb)` y `leerFase()` son suscribirseATimer y tiempoDeFase del timer.
 * Devuelve el elemento (o null si no se pudo crear).
 */
function mostrarAvisoDescanso({ nombre, suscribir, leerFase }) {
  document.querySelectorAll(".te-aviso-descanso").forEach((n) => n._cerrar?.());
  const aviso = document.createElement("div");
  aviso.className = "te-aviso-descanso";
  aviso.setAttribute("role", "status");

  const arcoSvg = document.createElementNS(SVG_NS, "svg");
  arcoSvg.setAttribute("class", "te-aviso-arco-svg");
  arcoSvg.setAttribute("viewBox", "0 0 36 36");
  arcoSvg.setAttribute("aria-hidden", "true");
  const pista = document.createElementNS(SVG_NS, "circle");
  const arco = document.createElementNS(SVG_NS, "circle");
  for (const [c, clase] of [[pista, "te-aviso-pista"], [arco, "te-aviso-arco"]]) {
    c.setAttribute("class", clase);
    c.setAttribute("cx", "18");
    c.setAttribute("cy", "18");
    c.setAttribute("r", "15.9");
    c.setAttribute("pathLength", "100");
    arcoSvg.append(c);
  }

  const textos = document.createElement("div");
  textos.className = "te-aviso-textos";
  const lineaNombre = document.createElement("span");
  lineaNombre.className = "te-aviso-nombre";
  lineaNombre.textContent = nombre || "";
  const linea = document.createElement("span");
  linea.className = "te-aviso-linea";
  const etiqueta = document.createElement("span");
  etiqueta.textContent = traducirTextoInterfaz("Descanso");
  const tiempo = document.createElement("span");
  tiempo.className = "te-aviso-tiempo";
  tiempo.setAttribute("aria-hidden", "true"); // cambia cada segundo: no se anuncia
  linea.append(etiqueta, " · ", tiempo);
  textos.append(lineaNombre, linea);
  aviso.append(arcoSvg, textos);
  document.body.append(aviso);

  let cerrado = false;
  let quitarSuscripcion = null;
  let temporizador = null;
  const cerrar = () => {
    if (cerrado) return;
    cerrado = true;
    clearTimeout(temporizador);
    if (quitarSuscripcion) { quitarSuscripcion(); quitarSuscripcion = null; }
    aviso.remove();
  };
  aviso._cerrar = cerrar;
  aviso.addEventListener("click", cerrar);
  temporizador = setTimeout(cerrar, MS_AVISO_DESCANSO);

  quitarSuscripcion = suscribir((activo) => {
    const pomodoro = activo && activo.pomodoro;
    if (!pomodoro || pomodoro.fase === "trabajo") { cerrar(); return; }
    const fase = leerFase();
    const restante = Math.max(0, fase.duracion - fase.transcurridos);
    tiempo.textContent = formatoMinSeg(restante);
    arco.style.strokeDashoffset = String(fase.duracion ? Math.round(100 * (1 - restante / fase.duracion)) : 0);
  });
  if (cerrado && quitarSuscripcion) { quitarSuscripcion(); quitarSuscripcion = null; } // se cerró durante la suscripción inicial
  return aviso;
}

export { anunciarInicioTimer, reproducirInicioEnAnillo, mostrarAvisoDescanso };