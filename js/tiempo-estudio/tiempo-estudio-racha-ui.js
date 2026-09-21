/* =========================================================================
   TIEMPO — Racha de estudio: INTERFAZ y coordinación (2026-09-19)

   El cálculo (reglas, 2 descansos por semana, recuperación) vive en
   tiempo-estudio-racha.js y es puro. Este archivo:
     1) lee `estado.datos.sesiones_estudio` y le pide el estado a ese cálculo;
     2) dibuja el chip 🔥 + número del encabezado de la sección Tiempo;
     3) muestra los avisos: "Has iniciado una racha", "¡Racha recuperada!" y
        "¿Quieres recuperar tu racha?";
     4) decide CUÁNDO celebrar;
     5) al tocar el chip abre la ventana de detalle (tipo "detalle": llama
        animada, minutos de hoy, semana día por día, descansos restantes).

   CUÁNDO CELEBRA (lo importante del diseño): solo reacciona al evento
   `te:sesiones-actualizadas` (lo disparan los puntos que ESCRIBEN sesiones en
   ESTE dispositivo: detener timer, registro manual, editar, borrar, descanso
   de Pomodoro, salvavidas). Un dato que llega por sincronización desde otro
   dispositivo NUNCA celebra — solo actualiza en silencio la referencia
   (`alFusionarDatosRacha`). Y celebra únicamente cuando HOY pasa de "sin
   cumplir" a "cumplido"; editar o cargar un día viejo cambia el chip pero no
   dispara ningún aviso.

   Para volver a ver la animación de "Has perdido tu racha": con la racha en
   cero, mantener pulsado el chip 3 segundos (es una vista previa: no toca
   ninguna preferencia ni gasta el aviso real). Con racha viva no hace nada.

   Al abrir la app (primera fusión con datos reales) hay una revisión única:
     - si hay una racha larga recién perdida y hoy es el día de recuperarla,
       muestra la oferta (una vez por día y por dispositivo);
     - si la persona ya tiene una racha viva que nunca vio anunciada (la gente
       que ya venía estudiando esta semana), le muestra "Has iniciado una
       racha" una vez, con el número subiendo desde 0;
     - si perdió su racha y ya no hay vuelta atrás (`rachaPerdida` del
       cálculo), le muestra la llama extinguiéndose con "Has perdido tu racha".
       Sale UNA sola vez por pérdida: se identifica por el día en que se rompió
       y se recuerda en `racha_perdida_avisada` (más un respaldo en
       localStorage). Si la racha era recuperable, primero va la oferta y este
       aviso llega recién cuando la oferta venció.

   Preferencias (en `configuracion`, mismo patrón que
   `mostrar_tiempo_estudio_en_agenda`). `configuracion` se funde entera por
   `_actualizadoEn` y, sin sellar, en empate gana el local: en la práctica
   son por dispositivo (ver nota en schema.js):
     - racha_aviso_inicio_oculto   → casilla "No volver a mostrar".
     - racha_ultimo_inicio_avisado → ISO del día en que empezó la racha ya
                                     anunciada (así el aviso sale una vez por
                                     racha, no en cada apertura).
     - racha_perdida_avisada       → ISO del día en que se rompió la última
                                     racha cuya pérdida ya se mostró.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { mostrarToast } from "../ui/componentes.js";
import {
  DESCANSOS_POR_SEMANA,
  MINUTOS_DIA_CUMPLIDO,
  RACHA_DESDE_ISO,
  calcularRacha,
  indiceDesdeISO,
  minutosSemana,
} from "./tiempo-estudio-racha.js";

const NS_SVG = "http://www.w3.org/2000/svg";
const CLAVE_OFERTA_VISTA = "te_racha_oferta_dia_v1"; // por dispositivo, a propósito
const CLAVE_PERDIDA_VISTA = "te_racha_perdida_dia_v1"; // respaldo por si `configuracion` no guarda la clave nueva
const DURACION_PULSACION_LARGA_MS = 3000; // mantener el chip con racha cero → repite la animación de racha perdida
const TIRA_DIGITOS = 30; // 3 vueltas de 0–9: alcanza para el giro más largo

/* ------------------------- Estado de módulo ------------------------- */

let inicializado = false;
let ultimoEstado = null; // último estado conocido — base para detectar "hoy pasó a cumplido"
let diaCelebrado = null; // hoyIdx ya celebrado (no repetir si se borra y se vuelve a cargar)
let revisionAlAbrirHecha = false;
let diaRevisado = null;
let overlayAbierto = false;
let animacionChip = null; // { desde, hasta, vence } — la consume el próximo chip que se dibuje
let contadorIds = 0;
let pulsacionLargaHecha = false; // la pulsación larga ya abrió la animación: el "click" que sigue se ignora

/* ------------------------- Lectura del estado ------------------------- */

function datosListos() {
  return Boolean(
    estado && estado.datos && Array.isArray(estado.datos.sesiones_estudio) && estado.datos.configuracion
  );
}

/** Estado de la racha ahora mismo. `ahora` existe para poder probarlo. */
export function obtenerEstadoRacha(ahora = Date.now()) {
  const desdeIdx = RACHA_DESDE_ISO ? indiceDesdeISO(RACHA_DESDE_ISO) : null;
  return calcularRacha(estado && estado.datos ? estado.datos.sesiones_estudio : [], { ahora, desdeIdx });
}

/* ------------------------- Textos ------------------------- */

function textoDias(n) {
  return `${n} ${n === 1 ? "día" : "días"}`;
}

function textoMinutos(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Frase corta con el estado — sirve de tooltip, de etiqueta accesible del chip y de toast de avance. */
export function describirEstadoRacha(est) {
  if (est.recuperable) {
    const r = est.recuperable;
    return (
      `Perdiste tu racha de ${textoDias(r.longitud)}. Estudia ${textoMinutos(r.minutosNecesarios)} hoy ` +
      `para recuperarla (llevas ${textoMinutos(r.minutosHoy)}).`
    );
  }
  if (!est.activa) {
    return `Sin racha todavía. Estudia ${MINUTOS_DIA_CUMPLIDO} minutos hoy para iniciarla (llevas ${textoMinutos(est.minutosHoy)}).`;
  }
  const base = `Racha de ${textoDias(est.racha)}.`;
  const descansos = `Descansos disponibles esta semana: ${est.descansosRestantes} de ${DESCANSOS_POR_SEMANA}.`;
  if (est.hoyCumplido) return `${base} Hoy ya cumpliste tus ${MINUTOS_DIA_CUMPLIDO} minutos. ${descansos}`;
  if (est.enRiesgo) {
    return (
      `${base} ¡Hoy es clave! Ya usaste tus ${DESCANSOS_POR_SEMANA} descansos de la semana: ` +
      `estudia ${MINUTOS_DIA_CUMPLIDO} minutos para mantenerla (llevas ${textoMinutos(est.minutosHoy)}).`
    );
  }
  return `${base} Hoy llevas ${textoMinutos(est.minutosHoy)} de ${MINUTOS_DIA_CUMPLIDO} min. ${descansos}`;
}

/* ------------------------- Piezas visuales ------------------------- */

function crearElemento(tag, clase, texto) {
  const el = document.createElement(tag);
  if (clase) el.className = clase;
  if (texto !== undefined) el.textContent = texto;
  return el;
}

/**
 * La llama: SVG en 3 capas (naranja, ámbar, núcleo claro), solo rellenos
 * planos y sin ids (así se pueden tener varias a la vez en el documento sin
 * que choquen los gradientes). Los colores y la animación los pone el CSS.
 */
function crearLlama(clase) {
  const svg = document.createElementNS(NS_SVG, "svg");
  svg.setAttribute("viewBox", "0 0 48 64");
  svg.setAttribute("class", "te-llama" + (clase ? " " + clase : ""));
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const capas = [
    ["te-llama-capa te-llama-capa--exterior", "M24 1 C25.5 12 41 21 41 38 C41 52 34 62.5 24 62.5 C14 62.5 7 52 7 38 C7 30 11 24 15.5 19 C16.5 25.5 19.5 28.5 23 28.5 C20.5 18 20.5 9 24 1 Z"],
    ["te-llama-capa te-llama-capa--medio", "M24 62.5 C17.5 62.5 13 56.5 13 49 C13 41.5 18.5 38 21.8 31 C24.5 37 35 41 35 49 C35 56.5 30.5 62.5 24 62.5 Z"],
    ["te-llama-capa te-llama-capa--nucleo", "M24 62.5 C20.8 62.5 18.6 59.5 18.6 55.6 C18.6 51.6 22 49.6 24 45.5 C26 49.6 29.4 51.6 29.4 55.6 C29.4 59.5 27.2 62.5 24 62.5 Z"],
  ];
  for (const [c, d] of capas) {
    const path = document.createElementNS(NS_SVG, "path");
    path.setAttribute("class", c);
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Llama que se extingue (aviso "Has perdido tu racha"). La llama de siempre va
 * dentro de una caja que es lo único que se anima —así no se pisa con el
 * parpadeo propio de la llama—: se encoge peleando por seguir encendida, se
 * va poniendo gris, y al final queda una brasa que late y se apaga con un
 * hilo de humo. Todo ocurre una sola vez (~6 s) y termina en reposo.
 */
function crearLlamaQueSeApaga() {
  asegurarEstilosLlamaApagada();
  const fuego = crearElemento("div", "te-perd-fuego");
  fuego.setAttribute("aria-hidden", "true");
  const caja = crearElemento("div", "te-perd-caja");
  caja.appendChild(crearLlama("te-llama--grande"));
  fuego.appendChild(caja);
  fuego.appendChild(crearElemento("span", "te-perd-brasa"));
  for (let i = 0; i < 3; i++) {
    const humo = crearElemento("span", "te-perd-humo");
    humo.style.setProperty("--i", String(i));
    fuego.appendChild(humo);
  }
  return fuego;
}

// Estilos de la animación. Van aquí (y no en la hoja de estilos de Tiempo)
// para que el aviso funcione con solo estos dos archivos; si prefieres
// tenerlos en el CSS, copia el texto tal cual. Solo usa animaciones de
// transform/opacity/filter, sin ids ni dependencias del tema.
const CSS_LLAMA_APAGADA = `
.te-perd-fuego, .te-perd-caja { position: absolute; inset: 0; pointer-events: none; }
.te-perd-caja { display: flex; justify-content: center; align-items: center;
  transform-origin: var(--fx, 50%) var(--fb, 100%); will-change: transform, filter, opacity;
  animation: te-perd-apagar 3.4s cubic-bezier(.4, 0, .6, 1) .6s both; }
.te-racha-card--perdida .te-racha-halo { animation: te-perd-halo 3.2s ease-in .6s both; }
.te-perd-brasa { position: absolute; left: var(--fx, 50%); top: var(--fb, 100%); width: 12px; height: 12px;
  margin: -9px 0 0 -6px; border-radius: 50%; opacity: 0;
  background: radial-gradient(circle, #ffc07a 0%, #ff6a1f 42%, rgba(255, 106, 31, 0) 72%);
  animation: te-perd-brasa 3.4s ease-out 2.9s both; }
.te-perd-humo { position: absolute; left: var(--fx, 50%); top: var(--fb, 100%); width: 14px; height: 34px;
  margin: -40px 0 0 -7px; border-radius: 50%; opacity: 0; filter: blur(3px);
  background: radial-gradient(ellipse at 50% 80%, rgba(165, 170, 180, .6), rgba(165, 170, 180, 0) 70%);
  animation: te-perd-humo 3.2s ease-out calc(2.9s + var(--i) * .75s) 2 both; }
@keyframes te-perd-apagar {
  0%   { transform: scale(1, 1); filter: grayscale(0) brightness(1); opacity: 1; }
  14%  { transform: scale(.97, .86); }
  26%  { transform: scale(1, .96); }
  48%  { transform: scale(.9, .6); filter: grayscale(.35) brightness(.85); }
  60%  { transform: scale(.94, .72); }
  82%  { transform: scale(.7, .24); filter: grayscale(.9) brightness(.55); opacity: .8; }
  100% { transform: scale(.4, .04); filter: grayscale(1) brightness(.4); opacity: 0; }
}
@keyframes te-perd-halo { to { opacity: 0; transform: scale(.55); } }
@keyframes te-perd-brasa {
  0%   { opacity: 0; transform: scale(.4); }
  16%  { opacity: 1; transform: scale(1); }
  40%  { opacity: .7; transform: scale(.85); }
  64%  { opacity: .95; transform: scale(1); }
  100% { opacity: 0; transform: scale(.3); }
}
@keyframes te-perd-humo {
  0%   { opacity: 0; transform: translate(0, 0) scale(.6, .6); }
  20%  { opacity: .6; }
  60%  { transform: translate(calc(var(--i) * 6px - 6px), -34px) scale(1.1, 1.2); }
  100% { opacity: 0; transform: translate(calc(var(--i) * -8px + 8px), -78px) scale(1.5, 1.6); }
}
@media (prefers-reduced-motion: reduce) {
  .te-perd-caja { animation: none; transform: none; filter: grayscale(1) brightness(.55); opacity: .5; }
  .te-racha-card--perdida .te-racha-halo { animation: none; opacity: 0; }
  .te-perd-brasa, .te-perd-humo { animation: none; opacity: 0; }
}
`;

/**
 * Mide dónde quedó la llama dentro de la escena (en %) para que la brasa, el
 * humo y el punto desde donde se encoge coincidan con su base, sea cual sea el
 * CSS de la llama. Usa proporciones, así no le afecta la animación de entrada
 * de la tarjeta. Se llama con el aviso ya insertado en el documento.
 */
function ubicarLlamaApagada(escena) {
  const fuego = escena.querySelector(".te-perd-fuego");
  const svg = fuego && fuego.querySelector(".te-llama");
  if (!svg) return;
  if (getComputedStyle(escena).position === "static") escena.style.position = "relative";
  const e = escena.getBoundingClientRect();
  const l = svg.getBoundingClientRect();
  if (!e.width || !e.height || !l.width) return;
  fuego.style.setProperty("--fx", `${(((l.left + l.width / 2 - e.left) / e.width) * 100).toFixed(2)}%`);
  fuego.style.setProperty("--fb", `${(((l.bottom - e.top) / e.height) * 100).toFixed(2)}%`);
}

function asegurarEstilosLlamaApagada() {
  if (document.getElementById("te-racha-perdida-css")) return;
  const style = document.createElement("style");
  style.id = "te-racha-perdida-css";
  style.textContent = CSS_LLAMA_APAGADA;
  document.head.appendChild(style);
}

/**
 * Odómetro: cada dígito es una columna con una tira vertical de 0–9 que rueda
 * hasta el valor final (como un contador mecánico), con leve rebote al llegar.
 *   - `desde` → `hasta` (n-1 → n en una subida normal; 0 → n al iniciar).
 *   - Solo se mueven las columnas cuyo dígito cambia (12 → 13 solo mueve el 2).
 *   - Una columna nueva (9 → 10) aparece desde abajo con fundido.
 *   - `giro` agrega una vuelta completa antes de aterrizar (para el aviso
 *     grande); sin él, un +1 es un solo paso.
 * Con "reducir movimiento" el CSS anula la transición y salta directo al final.
 */
export function construirOdometro(desde, hasta, { retrasoMs = 0, giro = false } = {}) {
  const sHasta = String(Math.max(0, Math.floor(hasta)));
  const sDesde = String(Math.max(0, Math.floor(desde)));
  const largo = Math.max(sHasta.length, sDesde.length);
  const a = sDesde.padStart(largo, " ");
  const b = sHasta.padStart(largo, " ");

  const cont = crearElemento("span", "te-odo" + (giro ? " te-odo--giro" : ""));
  cont.setAttribute("role", "img");
  cont.setAttribute("aria-label", sHasta);
  cont.style.setProperty("--odo-retraso", `${retrasoMs}ms`);

  const finales = [];
  for (let i = 0; i < largo; i++) {
    const nueva = a[i] === " ";
    const dDesde = nueva ? 0 : Number(a[i]);
    const dHasta = Number(b[i]);
    const cambia = a[i] !== b[i];

    let fin = dDesde;
    if (cambia) {
      fin = dHasta;
      if (fin < dDesde || (fin === dDesde && cambia)) fin += 10; // siempre hacia adelante
      if (giro) fin += 10;
    }

    const col = crearElemento("span", "te-odo-col" + (nueva ? " te-odo-col--nueva" : ""));
    col.setAttribute("aria-hidden", "true");
    const tira = crearElemento("span", "te-odo-tira");
    for (let n = 0; n < TIRA_DIGITOS; n++) tira.appendChild(crearElemento("span", "", String(n % 10)));
    const desdeDerecha = largo - 1 - i;
    tira.style.setProperty("--i", String(dDesde));
    tira.style.setProperty("--odo-dur", `${1100 + desdeDerecha * 380}ms`);
    tira.style.setProperty("--odo-retraso", `${retrasoMs}ms`);
    col.appendChild(tira);
    cont.appendChild(col);
    finales.push({ tira, col, fin, mueve: cambia, nueva });
  }

  // Dos frames: primero se pinta el estado inicial y recién después se fija
  // el final, si no el navegador se saltea la transición.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      for (const f of finales) {
        if (f.mueve) f.tira.style.setProperty("--i", String(f.fin));
        if (f.nueva) f.col.classList.add("te-odo-col--visible");
      }
    })
  );
  return cont;
}

/* ------------------------- Chip del encabezado ------------------------- */

/**
 * Chip 🔥 + número para el encabezado de Tiempo. Tres estados visuales:
 *   encendida  → hoy ya cumplió;
 *   pendiente  → la racha vive pero hoy falta estudiar (pulsa si es "clave");
 *   apagada    → sin racha (o con una recuperable).
 * Tocarlo muestra el detalle (minutos de hoy, descansos que quedan).
 */
export function construirChipRacha() {
  const est = obtenerEstadoRacha();
  const chip = crearElemento("button", "te-racha-chip");
  chip.type = "button";

  if (est.recuperable) chip.classList.add("te-racha-chip--apagada", "te-racha-chip--recuperable");
  else if (!est.activa) chip.classList.add("te-racha-chip--apagada");
  else if (est.hoyCumplido) chip.classList.add("te-racha-chip--encendida");
  else chip.classList.add("te-racha-chip--pendiente", ...(est.enRiesgo ? ["te-racha-chip--riesgo"] : []));

  const descripcion = describirEstadoRacha(est);
  chip.title = descripcion;
  chip.setAttribute("aria-label", descripcion);
  chip.appendChild(crearLlama("te-llama--chip"));

  const anim = animacionChip && animacionChip.vence > Date.now() && animacionChip.hasta === est.racha ? animacionChip : null;
  animacionChip = null;
  if (anim) {
    chip.classList.add("te-racha-chip--pop");
    const num = crearElemento("span", "te-racha-num");
    num.appendChild(construirOdometro(anim.desde, anim.hasta, { retrasoMs: 150 }));
    chip.appendChild(num);
  } else {
    chip.appendChild(crearElemento("span", "te-racha-num", String(est.racha)));
  }

  chip.addEventListener("click", (e) => {
    // Si el toque fue una pulsación larga que ya abrió la animación, no abrir además el detalle.
    if (pulsacionLargaHecha) {
      pulsacionLargaHecha = false;
      e.preventDefault();
      return;
    }
    abrirDetalleRacha();
  });
  activarPulsacionLargaRachaCero(chip);
  return chip;
}

/**
 * Repetir la animación de "Has perdido tu racha": mantener pulsado el chip
 * 3 segundos, solo cuando la racha está en cero. Es una vista previa: no
 * cambia ninguna preferencia ni cuenta como el aviso real. Soltar antes, o
 * mover el dedo/mouse fuera del chip, cancela; un toque normal sigue
 * abriendo el detalle.
 */
function activarPulsacionLargaRachaCero(chip) {
  let timer = null;
  const cancelar = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  chip.style.webkitTouchCallout = "none"; // sin menú de "mantener pulsado" en iOS
  chip.style.userSelect = "none";
  chip.addEventListener("contextmenu", (e) => e.preventDefault()); // ni en Android/escritorio
  chip.addEventListener("pointerdown", (e) => {
    pulsacionLargaHecha = false;
    if (e.button !== undefined && e.button > 0) return; // solo botón principal
    cancelar();
    timer = setTimeout(() => {
      timer = null;
      const est = obtenerEstadoRacha();
      if (est.activa) return; // con racha viva no hace nada: el toque normal sigue igual
      pulsacionLargaHecha = true;
      abrirOverlayRacha({ tipo: "perdida", est: { ...est, rachaPerdida: null } });
    }, DURACION_PULSACION_LARGA_MS);
  });
  for (const ev of ["pointerup", "pointerleave", "pointercancel"]) chip.addEventListener(ev, cancelar);
}

/**
 * Tocar el chip: ventana con el detalle de la racha (antes era un toast). Si hay
 * una racha larga recuperable HOY, se abre directamente la oferta de recuperar
 * (es lo más importante que hay para decirle); si no, el detalle.
 */
export function abrirDetalleRacha() {
  const est = obtenerEstadoRacha();
  if (est.recuperable) return abrirOverlayRacha({ tipo: "oferta", est });
  return abrirOverlayRacha({ tipo: "detalle", est, desde: 0, hasta: est.racha });
}

/* ------------------------- Avisos a pantalla completa ------------------------- */

function persistirPreferenciasInicio({ oculto, inicioISO }) {
  const cfg = estado && estado.datos && estado.datos.configuracion;
  if (!cfg) return;
  let cambio = false;
  if (oculto === true && cfg.racha_aviso_inicio_oculto !== true) {
    cfg.racha_aviso_inicio_oculto = true;
    cambio = true;
  }
  if (inicioISO && cfg.racha_ultimo_inicio_avisado !== inicioISO) {
    cfg.racha_ultimo_inicio_avisado = inicioISO;
    cambio = true;
  }
  if (cambio) marcarCambioPendiente();
}

function crearChispas() {
  const cont = crearElemento("div", "te-racha-chispas");
  cont.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 9; i++) {
    const c = crearElemento("span", "te-racha-chispa");
    const lado = (i % 2 === 0 ? -1 : 1) * (10 + Math.random() * 46);
    c.style.setProperty("--dx", `${lado.toFixed(0)}px`);
    c.style.setProperty("--dy", `${-(70 + Math.random() * 70).toFixed(0)}px`);
    c.style.setProperty("--retraso", `${(0.15 + i * 0.16).toFixed(2)}s`);
    c.style.setProperty("--tam", `${(3 + Math.random() * 4).toFixed(1)}px`);
    cont.appendChild(c);
  }
  return cont;
}

const CONTENIDO_AVISO = {
  inicio: {
    titulo: "Has iniciado una racha",
    texto: () =>
      "Para mantenerla debes estudiar al menos 30 minutos al día durante 5 días a la semana, " +
      "puedes tomarte 2 días de descanso como máximo",
    boton: "Aceptar",
  },
  recuperada: {
    titulo: "¡Racha recuperada!",
    texto: (n) => `Tu racha de ${textoDias(n - 1)} sigue en pie y hoy sumó un día más. ¡Sigue así!`,
    boton: "Aceptar",
  },
  detalle: {
    titulo: (est) =>
      !est.activa ? "Aún no tienes racha" : est.hoyCumplido ? "¡Hoy ya cumpliste!" : est.enRiesgo ? "¡Hoy es clave!" : "Hoy falta estudiar",
    texto: (n, est) =>
      !est.activa
        ? `Estudia ${MINUTOS_DIA_CUMPLIDO} minutos hoy para iniciar tu racha.`
        : est.hoyCumplido
          ? "Tu racha está a salvo por hoy. ¡Sigue así!"
          : est.enRiesgo
            ? `Ya usaste tus ${DESCANSOS_POR_SEMANA} descansos de la semana: estudia ${MINUTOS_DIA_CUMPLIDO} minutos hoy para no perderla.`
            : `Estudia ${MINUTOS_DIA_CUMPLIDO} minutos hoy para sumar un día más.`,
    boton: "Cerrar",
  },
  oferta: {
    titulo: "¿Quieres recuperar tu racha?",
    texto: (n) => `Perdiste tu racha de ${textoDias(n)}. Estudia 1 hora y media hoy para recuperarla.`,
    boton: "Entendido",
  },
  perdida: {
    titulo: "Has perdido tu racha 🥀",
    texto: () => "Pero no te desanimes, empieza una nueva estudiando y echándole ganas al semestre :D",
    boton: "Entendido",
  },
};

/**
 * Aviso modal con llama animada. `tipo`:
 *   "inicio"     → número sube desde `desde` (0) hasta `hasta`, texto de reglas
 *                  y casilla "No volver a mostrar".
 *   "recuperada" → número sube de 0 a la racha restaurada.
 *   "detalle"    → (al tocar el chip) llama viva si hay racha, número que rueda,
 *                  semana día por día, minutos de hoy y descansos restantes.
 *   "oferta"     → llama apagada, número fijo (la longitud perdida), avance de hoy.
 *   "perdida"    → la llama se extingue (una vez) y queda una brasa con humo;
 *                  sin número. Recuerda que ya se mostró (ver marcarPerdidaAvisada).
 * Como el resto de los modales de Tiempo, NO se cierra al tocar fuera: solo
 * con el botón (o Escape).
 */
export function abrirOverlayRacha({ tipo, est, desde = 0, hasta }) {
  if (overlayAbierto || !CONTENIDO_AVISO[tipo]) return null;
  overlayAbierto = true;
  const foco = document.activeElement;
  const cfg = CONTENIDO_AVISO[tipo];
  const numero = tipo === "oferta" ? est.recuperable.longitud : hasta;
  const idTitulo = `te-racha-titulo-${++contadorIds}`;

  const overlay = crearElemento("div", "modal-overlay te-racha-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-labelledby", idTitulo);
  const apagada = tipo === "detalle" && !est.activa;
  const card = crearElemento("div", `glass-card modal-card te-racha-card te-racha-card--${tipo}${apagada ? " te-racha-card--apagada" : ""}`);

  // Escena: halo + llama + chispas
  const escena = crearElemento("div", "te-racha-escena");
  escena.appendChild(crearElemento("div", "te-racha-halo"));
  escena.appendChild(tipo === "perdida" ? crearLlamaQueSeApaga() : crearLlama("te-llama--grande"));
  const conChispas = tipo === "inicio" || tipo === "recuperada" || (tipo === "detalle" && est.activa && est.hoyCumplido);
  if (conChispas) escena.appendChild(crearChispas());
  card.appendChild(escena);

  // Número + unidad
  if (tipo !== "perdida") {
    const fila = crearElemento("div", "te-racha-numero");
    if (tipo === "oferta") fila.appendChild(construirOdometro(numero, numero));
    else fila.appendChild(construirOdometro(desde, numero, { retrasoMs: 650, giro: true }));
    fila.appendChild(crearElemento("span", "te-racha-unidad", numero === 1 ? "día de racha" : "días de racha"));
    card.appendChild(fila);
  }

  const titulo = crearElemento("h2", "te-racha-titulo", typeof cfg.titulo === "function" ? cfg.titulo(est) : cfg.titulo);
  titulo.id = idTitulo;
  card.appendChild(titulo);
  card.appendChild(crearElemento("p", "te-racha-texto", cfg.texto(numero, est)));

  if (tipo === "oferta") {
    const r = est.recuperable;
    const avance = crearElemento("div", "te-racha-avance");
    const barra = crearElemento("div", "te-barra-progreso");
    const relleno = crearElemento("div", "te-barra-progreso-fill");
    relleno.style.width = `${Math.min(100, Math.round((r.minutosHoy / r.minutosNecesarios) * 100))}%`;
    barra.appendChild(relleno);
    avance.appendChild(barra);
    avance.appendChild(
      crearElemento("span", "muted", `Hoy llevas ${textoMinutos(r.minutosHoy)} de ${textoMinutos(r.minutosNecesarios)}`)
    );
    card.appendChild(avance);
  }

  if (tipo === "detalle") card.appendChild(construirDetalleRacha(est));

  // Casilla "No volver a mostrar" (solo el aviso de inicio)
  let casilla = null;
  if (tipo === "inicio") {
    const etiqueta = crearElemento("label", "checkbox te-racha-check");
    casilla = document.createElement("input");
    casilla.type = "checkbox";
    etiqueta.appendChild(casilla);
    etiqueta.appendChild(crearElemento("span", "box"));
    etiqueta.appendChild(crearElemento("span", "", "No volver a mostrar"));
    card.appendChild(etiqueta);
  }

  const boton = crearElemento("button", "btn btn-primary btn-block te-racha-aceptar", cfg.boton);
  boton.type = "button";
  card.appendChild(boton);
  overlay.appendChild(card);

  function cerrar() {
    document.removeEventListener("keydown", alTeclear, true);
    overlay.remove();
    overlayAbierto = false;
    if (tipo === "inicio" && casilla && casilla.checked) persistirPreferenciasInicio({ oculto: true });
    if (foco && typeof foco.focus === "function") foco.focus();
  }
  function alTeclear(e) {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar();
    } else if (e.key === "Tab") {
      // Trampa de foco mínima: dentro del aviso hay a lo sumo 2 controles.
      const items = [casilla, boton].filter(Boolean);
      const i = items.indexOf(document.activeElement);
      e.preventDefault();
      items[(i + (e.shiftKey ? items.length - 1 : 1)) % items.length].focus();
    }
  }
  boton.addEventListener("click", cerrar);
  document.addEventListener("keydown", alTeclear, true);

  document.body.appendChild(overlay);
  if (tipo === "perdida") ubicarLlamaApagada(escena);
  boton.focus();
  if (tipo === "inicio" && est && est.inicioISO) persistirPreferenciasInicio({ inicioISO: est.inicioISO });
  if (tipo === "perdida" && est && est.rachaPerdida) marcarPerdidaAvisada(est.rachaPerdida.diaISO);
  return overlay;
}

/* ------------------------- Detalle (al tocar el chip) ------------------------- */

const LETRAS_SEMANA = ["L", "M", "X", "J", "V", "S", "D"];
const NOMBRES_DIA = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const DESCRIPCION_TIPO_DIA = { cumplido: "cumplido", descanso: "día de descanso", hoy: "hoy, pendiente", riesgo: "hoy, clave", futuro: "por venir", previo: "sin racha" };

/**
 * Estado de cada día de la semana en curso para dibujarlo:
 *   cumplido / descanso / hoy (pendiente) / riesgo (hoy y sin descansos) /
 *   futuro / previo (antes de que naciera la racha).
 * Los descansos dibujados nunca superan `descansosUsados` (si la racha se
 * restauró, las faltas de antes de la ruptura no se cuentan).
 */
function estadosSemana(est, semana) {
  const dias = semana.map((d, i) => {
    let tipo;
    if (d.idx > est.hoyIdx) tipo = "futuro";
    else if (est.activa && d.idx < est.inicioIdx) tipo = "previo";
    else if (d.min >= MINUTOS_DIA_CUMPLIDO) tipo = "cumplido";
    else if (d.idx === est.hoyIdx) tipo = est.enRiesgo ? "riesgo" : "hoy";
    else tipo = est.activa ? "descanso" : "previo";
    return { ...d, tipo, letra: LETRAS_SEMANA[i], nombre: NOMBRES_DIA[i] };
  });
  let exceso = dias.filter((d) => d.tipo === "descanso").length - (est.descansosUsados || 0);
  for (const d of dias) {
    if (exceso > 0 && d.tipo === "descanso") {
      d.tipo = "previo";
      exceso--;
    }
  }
  return dias;
}

function formatearDiaISO(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return new Date(a, (m || 1) - 1, d || 1).toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });
}

function crearFilaDetalle(etiqueta, valor) {
  const fila = crearElemento("div", "te-racha-fila");
  fila.appendChild(crearElemento("span", "te-racha-fila-etiqueta", etiqueta));
  const v = crearElemento("span", "te-racha-fila-valor");
  if (typeof valor === "string") v.textContent = valor;
  else v.appendChild(valor);
  fila.appendChild(v);
  return fila;
}

/** Cuerpo de la ventana de detalle: semana + filas (Hoy, Esta semana, Días de descanso restantes, Racha iniciada). */
function construirDetalleRacha(est) {
  const cont = crearElemento("div", "te-racha-detalle");
  let cumplidosSemana = 0;

  if (est.activa) {
    const semana = estadosSemana(est, minutosSemana(estado.datos.sesiones_estudio, { ahora: Date.now() }));
    cumplidosSemana = semana.filter((d) => d.tipo === "cumplido").length;
    const tira = crearElemento("div", "te-racha-semana");
    tira.setAttribute("role", "list");
    semana.forEach((d, i) => {
      const celda = crearElemento("div", `te-racha-dia te-racha-dia--${d.tipo}`);
      celda.setAttribute("role", "listitem");
      celda.setAttribute("aria-label", `${d.nombre}: ${DESCRIPCION_TIPO_DIA[d.tipo]}`);
      celda.style.setProperty("--n", String(i));
      celda.appendChild(crearElemento("span", "te-racha-dia-letra", d.letra));
      const marca = crearElemento("span", "te-racha-dia-marca");
      if (d.tipo === "cumplido") marca.appendChild(crearLlama("te-llama--mini"));
      else if (d.tipo === "descanso") marca.textContent = "☾";
      celda.appendChild(marca);
      tira.appendChild(celda);
    });
    cont.appendChild(tira);
    const leyenda = crearElemento("div", "te-racha-leyenda");
    leyenda.appendChild(crearElemento("span", "", "🔥 Cumplido"));
    leyenda.appendChild(crearElemento("span", "", "☾ Descanso"));
    cont.appendChild(leyenda);
  }

  const lista = crearElemento("div", "te-racha-filas");

  // Hoy: minutos + barra
  lista.appendChild(
    crearFilaDetalle("Hoy", est.hoyCumplido ? `✓ ${textoMinutos(est.minutosHoy)}` : `${textoMinutos(est.minutosHoy)} de ${MINUTOS_DIA_CUMPLIDO} min`)
  );
  const barra = crearElemento("div", "te-barra-progreso te-racha-barra-hoy");
  const relleno = crearElemento("div", "te-barra-progreso-fill" + (est.hoyCumplido ? " te-completada" : ""));
  relleno.style.width = `${Math.min(100, Math.round((est.minutosHoy / MINUTOS_DIA_CUMPLIDO) * 100))}%`;
  barra.appendChild(relleno);
  lista.appendChild(barra);

  if (est.activa) {
    lista.appendChild(crearFilaDetalle("Esta semana", `${cumplidosSemana} de 5 días`));

    const valorDescansos = crearElemento("span", "te-racha-descansos");
    valorDescansos.appendChild(crearElemento("span", "", `${est.descansosRestantes} de ${DESCANSOS_POR_SEMANA}`));
    const pips = crearElemento("span", "te-racha-pips");
    pips.setAttribute("aria-hidden", "true");
    for (let i = 0; i < DESCANSOS_POR_SEMANA; i++) {
      pips.appendChild(crearElemento("span", "te-racha-pip" + (i < est.descansosRestantes ? " te-racha-pip--llena" : "")));
    }
    valorDescansos.appendChild(pips);
    lista.appendChild(crearFilaDetalle("Días de descanso restantes", valorDescansos));

    lista.appendChild(crearFilaDetalle("Racha iniciada", formatearDiaISO(est.inicioISO)));
  }
  cont.appendChild(lista);
  return cont;
}

/* ------------------------- Cuándo celebrar ------------------------- */

function preferencias() {
  const cfg = (estado && estado.datos && estado.datos.configuracion) || {};
  return { oculto: cfg.racha_aviso_inicio_oculto === true, ultimoInicio: cfg.racha_ultimo_inicio_avisado || null };
}

/** Se llama tras escribir sesiones en ESTE dispositivo. */
function alCambiarSesiones() {
  if (!datosListos()) return;
  const antes = ultimoEstado;
  const ahora = obtenerEstadoRacha();
  ultimoEstado = ahora;
  // Sin referencia previa no se puede saber si hoy "pasó" a cumplido: no se celebra.
  if (!antes) return;
  const mismoDia = antes.hoyIdx === ahora.hoyIdx;

  // Día de recuperación en curso (racha larga perdida, faltan minutos): NO es
  // "has iniciado una racha", aunque hoy ya pase de 30 min. Solo se informa el avance.
  if (ahora.recuperable) {
    if (!mismoDia || ahora.minutosHoy > antes.minutosHoy) mostrarToast(describirEstadoRacha(ahora), 4800);
    return;
  }

  // Recuperada: la oferta se cumple justo con esta escritura (ej. de 40 a 90 min).
  if (ahora.restauradaHoy) {
    if (mismoDia && antes.restauradaHoy) return;
    if (diaCelebrado === ahora.hoyIdx) return;
    diaCelebrado = ahora.hoyIdx;
    animacionChip = { desde: Math.max(0, ahora.racha - 1), hasta: ahora.racha, vence: Date.now() + 5000 };
    setTimeout(() => {
      abrirOverlayRacha({ tipo: "recuperada", est: ahora, desde: 0, hasta: ahora.racha });
      repintarChipSiEstaVisible();
    }, 350);
    return;
  }

  const hoyCumplidoAntes = mismoDia ? antes.hoyCumplido : false;
  if (!ahora.hoyCumplido || hoyCumplidoAntes) return;
  if (diaCelebrado === ahora.hoyIdx) return;
  diaCelebrado = ahora.hoyIdx;

  // Un pequeño margen para que el aviso de meta semanal (si salta en el mismo
  // guardado) aparezca primero y el nuestro quede encima, sin pisarse.
  setTimeout(() => {
    if (ahora.racha === 1) {
      const p = preferencias();
      if (!p.oculto && p.ultimoInicio !== ahora.inicioISO) {
        abrirOverlayRacha({ tipo: "inicio", est: ahora, desde: 0, hasta: 1 });
      } else {
        animacionChip = { desde: 0, hasta: 1, vence: Date.now() + 5000 };
        mostrarToast("🔥 ¡Has iniciado una racha!");
      }
    } else {
      animacionChip = { desde: ahora.racha - 1, hasta: ahora.racha, vence: Date.now() + 5000 };
      mostrarToast(`🔥 ¡Racha de ${textoDias(ahora.racha)}!`);
    }
    repintarChipSiEstaVisible();
  }, 350);
}

/** Si el chip está en pantalla, se repinta para que estrene su animación. */
function repintarChipSiEstaVisible() {
  if (animacionChip && typeof window.renderizarTiempoEstudio === "function" && document.querySelector(".te-racha-chip")) {
    window.renderizarTiempoEstudio();
  }
}

/** ¿Ya se le mostró la pérdida de la racha que se rompió el día `diaISO`? */
function perdidaYaAvisada(diaISO) {
  const cfg = estado && estado.datos && estado.datos.configuracion;
  if (cfg && cfg.racha_perdida_avisada === diaISO) return true;
  try {
    return localStorage.getItem(CLAVE_PERDIDA_VISTA) === diaISO;
  } catch (_) {
    return false;
  }
}

/** Recuerda (en `configuracion` y en localStorage) que esta pérdida ya se mostró. */
function marcarPerdidaAvisada(diaISO) {
  const cfg = estado && estado.datos && estado.datos.configuracion;
  if (cfg && cfg.racha_perdida_avisada !== diaISO) {
    cfg.racha_perdida_avisada = diaISO;
    marcarCambioPendiente();
  }
  try {
    localStorage.setItem(CLAVE_PERDIDA_VISTA, diaISO);
  } catch (_) {
    /* sin almacenamiento: puede repetirse, no es grave */
  }
}

function ofertaYaVistaHoy(hoyIdx) {
  try {
    return localStorage.getItem(CLAVE_OFERTA_VISTA) === String(hoyIdx);
  } catch (_) {
    return false;
  }
}
function marcarOfertaVista(hoyIdx) {
  try {
    localStorage.setItem(CLAVE_OFERTA_VISTA, String(hoyIdx));
  } catch (_) {
    /* sin almacenamiento: puede repetirse, no es grave */
  }
}

function revisarAlAbrir(est) {
  if (est.recuperable) {
    if (ofertaYaVistaHoy(est.hoyIdx)) return;
    marcarOfertaVista(est.hoyIdx);
    abrirOverlayRacha({ tipo: "oferta", est });
    return;
  }
  // Racha perdida sin vuelta atrás: la animación sale una sola vez por pérdida.
  if (est.rachaPerdida) {
    if (!perdidaYaAvisada(est.rachaPerdida.diaISO)) abrirOverlayRacha({ tipo: "perdida", est });
    return;
  }
  const p = preferencias();
  if (est.activa && !p.oculto && p.ultimoInicio !== est.inicioISO) {
    abrirOverlayRacha({ tipo: "inicio", est, desde: 0, hasta: est.racha });
  }
}

/**
 * Se llama tras CADA fusión de datos (sondeo, login, otra pestaña, syncs
 * propios). Siempre refresca la referencia en silencio (lo que llegó de otro
 * dispositivo no se celebra acá). La revisión "al abrir" corre UNA vez por
 * día, y solo cuando ya hay sesiones reales — no sobre el esqueleto vacío de
 * un login a medio cargar.
 */
export function alFusionarDatosRacha() {
  if (!datosListos()) return;
  ultimoEstado = obtenerEstadoRacha();
  if (revisionAlAbrirHecha && diaRevisado === ultimoEstado.hoyIdx) return;
  if (!estado.datos.sesiones_estudio.length) return;
  revisionAlAbrirHecha = true;
  diaRevisado = ultimoEstado.hoyIdx;
  revisarAlAbrir(ultimoEstado);
}

/** Cablea los listeners (una sola vez). Se llama desde inicializarTiempoEstudio(). */
export function inicializarRacha() {
  if (inicializado) return;
  inicializado = true;
  window.addEventListener("te:sesiones-actualizadas", alCambiarSesiones);
  // App abierta de un día para el otro: al volver a primer plano en un día
  // nuevo se repite la revisión de apertura.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && datosListos() && diaRevisado !== null && diaRevisado !== obtenerEstadoRacha().hoyIdx) {
      revisionAlAbrirHecha = false;
      alFusionarDatosRacha();
    }
  });
  if (datosListos()) ultimoEstado = obtenerEstadoRacha();
}
