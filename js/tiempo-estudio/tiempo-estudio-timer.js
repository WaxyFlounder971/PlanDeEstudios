/* =========================================================================
   TIEMPO DE ESTUDIO — Motor del timer (Parte 1)
   Cronómetro simple en memoria: sin ciclos de Pomodoro (eso es Parte 2) y
   sin salvavidas de sesión olvidada si se recarga la página (también Parte
   2, a propósito — ver nota en `timerActivo` más abajo).

   Este archivo es el ÚNICO punto de entrada real para iniciar/detener un
   timer: la regla de "una sola sesión activa" (punto 6 del plan) se hace
   cumplir ACÁ adentro, no confiando en que cada botón de la UI (tarjeta,
   detalle) la respete por su cuenta.
   ========================================================================= */

import { crearSesionEstudio } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";

/**
 * Timer en memoria: NUNCA se persiste en estado.datos. No existe el
 * concepto de "sesión en curso" en el modelo de datos (ver schema.js) —
 * solo sesiones ya CERRADAS, con inicio y fin conocidos. Si la página se
 * recarga con un timer corriendo, ese tiempo se pierde sin avisar; un
 * salvavidas que detecte esto y ofrezca recuperarlo es Parte 2 a propósito
 * (el plan de esta parte solo pide "que el timer simplemente siga
 * contando de largo").
 */
let timerActivo = null; // { materiaMatriculadaId, inicio (epoch ms) } | null
let intervaloId = null;
const suscriptores = new Set();

function notificar() {
  suscriptores.forEach((cb) => {
    try {
      cb(timerActivo);
    } catch (e) {
      console.error("[tiempo-estudio-timer] un suscriptor falló:", e);
    }
  });
}

function asegurarIntervalo() {
  if (intervaloId !== null) return;
  // 1 tick/seg: alcanza para un cronómetro MM:SS en vivo sin gastar de más
  // — tanto el indicador persistente como la pantalla de detalle escuchan
  // este mismo intervalo vía suscribirseATimer, así nunca hay 2+ setInterval
  // corriendo en paralelo por tener 2 pantallas abiertas a la vez.
  intervaloId = setInterval(notificar, 1000);
}

function detenerIntervaloSiNoHaceFalta() {
  if (timerActivo === null && intervaloId !== null) {
    clearInterval(intervaloId);
    intervaloId = null;
  }
}

/**
 * Se suscribe a cada tick del timer (1 vez por segundo mientras hay uno
 * activo, y una vez inmediata al suscribirse) — devuelve una función para
 * darse de baja. Usado por el indicador persistente y la pantalla de
 * detalle en tiempo-estudio.js.
 */
function suscribirseATimer(cb) {
  suscriptores.add(cb);
  cb(timerActivo); // primer valor inmediato, sin esperar el próximo tick
  return () => suscriptores.delete(cb);
}

function hayTimerActivo() {
  return timerActivo !== null;
}

function obtenerTimerActivo() {
  return timerActivo;
}

function segundosTranscurridos() {
  if (timerActivo === null) return 0;
  return Math.max(0, Math.floor((Date.now() - timerActivo.inicio) / 1000));
}

/**
 * Arranca un timer para `materiaMatriculadaId`. Devuelve `false` sin hacer
 * nada si ya hay un timer corriendo (para cualquier materia) — la UI es
 * responsable de avisar cuál está activa y ofrecer cambiarTimerEstudio()
 * en su lugar (punto 6 del plan: "no se puede iniciar otra desde ningún
 * lado").
 */
function iniciarTimerEstudio(materiaMatriculadaId) {
  if (timerActivo !== null) return false;
  timerActivo = { materiaMatriculadaId, inicio: Date.now() };
  asegurarIntervalo();
  notificar();
  return true;
}

/**
 * Detiene el timer activo (si hay uno), crea y guarda la sesión de estudio
 * correspondiente (origen "timer"), y marca el cambio pendiente de sync.
 * `duracionMinutos` se calcula adentro de crearSesionEstudio a partir de
 * los timestamps reales, nunca acá. Devuelve la sesión creada, o `null` si
 * no había ningún timer corriendo.
 */
function detenerTimerEstudio() {
  if (timerActivo === null) return null;
  const { materiaMatriculadaId, inicio } = timerActivo;
  const fin = Date.now();
  const sesion = crearSesionEstudio({ materiaMatriculadaId, inicio, fin, origen: "timer" });
  estado.datos.sesiones_estudio.push(sesion);
  marcarCambioPendiente();
  timerActivo = null;
  detenerIntervaloSiNoHaceFalta();
  notificar();
  return sesion;
}

/**
 * "Ofrecer cambiar" (decisión ya confirmada con Wagner): detiene el timer
 * en curso GUARDANDO su sesión (no la descarta) y arranca uno nuevo para
 * `materiaMatriculadaIdNueva`. La UI llama a esto solo después de que la
 * persona confirmó el diálogo de "ya hay un timer activo en <Materia X>".
 */
function cambiarTimerEstudio(materiaMatriculadaIdNueva) {
  detenerTimerEstudio();
  return iniciarTimerEstudio(materiaMatriculadaIdNueva);
}

/** "MM:SS" si dura menos de una hora, "H:MM:SS" si dura una hora o más. */
function formatearDuracion(segundosTotales) {
  const s = Math.max(0, Math.floor(segundosTotales));
  const horas = Math.floor(s / 3600);
  const minutos = Math.floor((s % 3600) / 60);
  const segundos = s % 60;
  if (horas > 0) {
    return `${horas}:${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
  }
  return `${String(minutos).padStart(2, "0")}:${String(segundos).padStart(2, "0")}`;
}

export {
  hayTimerActivo,
  obtenerTimerActivo,
  segundosTranscurridos,
  iniciarTimerEstudio,
  detenerTimerEstudio,
  cambiarTimerEstudio,
  suscribirseATimer,
  formatearDuracion,
};
