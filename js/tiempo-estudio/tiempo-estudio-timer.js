/* =========================================================================
   TIEMPO DE ESTUDIO — Motor del timer (Parte 2)
   Sobre la base de la Parte 1 (cronómetro simple en memoria), esta parte
   agrega:
     1) Motor de Pomodoro (bloques de trabajo + descansos, cíclico).
     2) Alertas de cambio de bloque (beep + toast + Notification API local).
     3) Excedente en vivo al llegar a la meta semanal (timer simple).
     4) Salvavidas de sesión olvidada (>3h sin detenerse, se pregunta al
        reabrir la app).

   Sigue siendo el ÚNICO punto de entrada real para iniciar/detener un
   timer — la regla de "una sola sesión activa" se sigue haciendo cumplir
   acá adentro, no en la UI.

   Persistencia del timer activo (nuevo en esta parte): se guarda un
   snapshot en localStorage (CLAVE_TIMER_ACTIVO), LOCAL a este dispositivo
   — nunca se sincroniza vía estado.datos/storage-sync, mismo criterio que
   CLAVE_SIDEBAR_COLAPSADA o CLAVE_FILTRO_VISTA_TE en tiempo-estudio.js. Es
   lo único que permite detectar, al reabrir la app, que quedó una sesión
   corriendo sin detenerse (punto 4) — sin esto la Parte 1 simplemente
   perdía ese tiempo en silencio, como aclaraba su propio comentario.
   ========================================================================= */

import { crearSesionEstudio, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";

// Fácil de ajustar para pruebas (ver caso de prueba del plan) — límite de
// horas sin detenerse antes de considerar una sesión "olvidada".
const SALVAVIDAS_HORAS_LIMITE = 3;

// Clave de localStorage del snapshot del timer activo — local al
// dispositivo, ver nota de cabecera.
const CLAVE_TIMER_ACTIVO = "te_timer_activo_v1";

/**
 * Timer en memoria. Forma:
 * {
 *   materiaMatriculadaId,
 *   origen: "timer" | "pomodoro",
 *   sesionInicio,    // epoch ms — inicio de TODA la sesión, sobrevive cambios de fase
 *   inicioFase,      // epoch ms — inicio del bloque/descanso actual (== sesionInicio si origen "timer")
 *   pomodoro: null | { config: {duracion_bloque_min, cantidad_bloques, descanso_corto_min, descanso_largo_min}, bloqueActual, fase },
 *   metaAlarmaDisparada, // timer simple: para que la vibración de "llegaste a la meta" dispare 1 sola vez por sesión
 * } | null
 * `fase` es "trabajo" | "descanso_corto" | "descanso_largo".
 */
let timerActivo = null;
let intervaloId = null;
const suscriptores = new Set();

/* ===================== Helpers de datos ===================== */

/** Busca una materia matriculada por id recorriendo estado.datos.semestres
 * — duplicado a propósito de un helper equivalente que ya existe en
 * tiempo-estudio.js (obtenerMateriasParaTiempoEstudio): ese archivo YA
 * importa de acá, así que importar de vuelta crearía un ciclo. Es una
 * búsqueda simple de un solo campo, no vale la pena romper el ciclo por
 * esto. */
function buscarMateriaMatriculada(materiaMatriculadaId) {
  for (const semestre of estado.datos.semestres || []) {
    const mm = (semestre.materias_matriculadas || []).find((m) => m.id === materiaMatriculadaId);
    if (mm) return mm;
  }
  return null;
}

/** Mismo cálculo de "lunes 00:00 → domingo 24:00" que ya usa
 * tiempo-estudio.js (obtenerRangoSemanaActual) — duplicado por el mismo
 * motivo anti-ciclo de arriba. Si el día de inicio de semana configurable
 * de Horario llega a aplicarse acá también, hay que actualizar los DOS
 * lugares a la vez. */
function calcularMinutosEstaSemana(materiaMatriculadaId) {
  const ahora = new Date();
  const diasDesdeLunes = (ahora.getDay() + 6) % 7;
  const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes, 0, 0, 0, 0);
  const inicioSemanaSiguiente = new Date(lunes.getFullYear(), lunes.getMonth(), lunes.getDate() + 7, 0, 0, 0, 0);
  const inicio = lunes.getTime();
  const fin = inicioSemanaSiguiente.getTime();
  return (estado.datos.sesiones_estudio || [])
    .filter((s) => s.materia_matriculada_id === materiaMatriculadaId && s.inicio >= inicio && s.inicio < fin)
    .reduce((acc, s) => acc + (Number(s.duracion_minutos) || 0), 0);
}

/* ===================== Persistencia local (salvavidas) ===================== */

function guardarSnapshotLocal() {
  try {
    if (timerActivo === null) {
      localStorage.removeItem(CLAVE_TIMER_ACTIVO);
      return;
    }
    localStorage.setItem(
      CLAVE_TIMER_ACTIVO,
      JSON.stringify({
        materiaMatriculadaId: timerActivo.materiaMatriculadaId,
        origen: timerActivo.origen,
        sesionInicio: timerActivo.sesionInicio,
        inicioFase: timerActivo.inicioFase,
        pomodoro: timerActivo.pomodoro,
      })
    );
  } catch (e) {
    console.error("[tiempo-estudio-timer] no se pudo guardar el snapshot local:", e);
  }
}

/** Epoch ms del lunes 00:00 de la semana que contiene "ahora" — mismo
 * cálculo que usa `calcularMinutosEstaSemana` de arriba, extraído aparte
 * porque acá solo hace falta el límite inferior. */
function calcularInicioSemanaActual() {
  const ahora = new Date();
  const diasDesdeLunes = (ahora.getDay() + 6) % 7;
  const lunes = new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate() - diasDesdeLunes, 0, 0, 0, 0);
  return lunes.getTime();
}

/**
 * Overlay de felicitación (Parte 3, punto 3) — auto-cierra solo a los
 * 3.5s, o al tocar en cualquier lado. Se muestra una sola vez por
 * materia por semana (ver revisarFelicitacionMeta), sin importar cuántas
 * veces se abra la app esa semana.
 */
function mostrarFelicitacionMeta() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:500; background:rgba(0,0,0,0.45); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:320px; width:100%; gap:6px; text-align:center; padding:28px 20px;";
  caja.innerHTML = `
    <div style="font-size:2.4rem;">🎉</div>
    <h2 style="margin:0; font-size:1.1rem;">¡Meta semanal cumplida!</h2>
    <p class="muted" style="margin:0; font-size:0.85rem;">Ya completaste tu meta de estudio de esta semana.</p>
  `;
  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  overlay.addEventListener("click", cerrar);
  setTimeout(cerrar, 3500);
}

/**
 * Revisa si `materiaMatriculadaId` cruzó su meta semanal (sumando todas
 * sus sesiones YA GUARDADAS de la semana — se llama siempre DESPUÉS de
 * guardar la sesión que podría haber cruzado el umbral, nunca antes) y, si
 * es así Y todavía no se felicitó por la semana actual, muestra el
 * overlay y marca `mm.tiempo_estudio.ultima_semana_felicitada` para que no
 * se repita en cada apertura de la app (punto 3 del plan). Se llama desde
 * los 3 lugares donde puede cerrarse una sesión real: detenerTimerEstudio,
 * avanzarFasePomodoro (bloque de trabajo), abrirAvisoSesionOlvidada, y
 * desde tiempo-estudio-registro.js tras un registro manual.
 */
function revisarFelicitacionMeta(materiaMatriculadaId) {
  const mm = buscarMateriaMatriculada(materiaMatriculadaId);
  if (!mm) return;
  const meta = mm.tiempo_estudio.meta_horas_semana;
  if (meta === null || meta === undefined || meta <= 0) return;

  const metaMinutos = meta * 60;
  const minutos = calcularMinutosEstaSemana(materiaMatriculadaId);
  if (minutos < metaMinutos) return;

  const inicioSemana = calcularInicioSemanaActual();
  if (mm.tiempo_estudio.ultima_semana_felicitada === inicioSemana) return; // ya felicitada esta semana

  mm.tiempo_estudio.ultima_semana_felicitada = inicioSemana;
  sellarTimestamp(mm);
  marcarCambioPendiente();
  mostrarFelicitacionMeta();
}

/* ===================== Alertas (punto 2) ===================== */

/** Beep generado con Web Audio (sin archivo de audio propio que mantener
 * ni requests) — tono corto, tipo "ding". Falla en silencio si el
 * navegador no soporta AudioContext. */
function reproducirBeep() {
  try {
    const ContextoAudio = window.AudioContext || window.webkitAudioContext;
    if (!ContextoAudio) return;
    const ctx = new ContextoAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, ctx.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.55);
    osc.onended = () => ctx.close();
  } catch (e) {
    console.error("[tiempo-estudio-timer] no se pudo reproducir el beep:", e);
  }
}

/** Si el permiso de Notification todavía está en "default" (nunca se
 * preguntó), lo pide — se llama solo al iniciar un timer con Pomodoro
 * (click de "Iniciar" ya es el gesto del usuario que el navegador exige).
 * Si el usuario nunca lo concede, simplemente no hay notificación del
 * sistema y queda el aviso visual+sonido de cuando vuelve a la pestaña. */
function pedirPermisoNotificacionSiHaceFalta() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** Notification API local (nunca push/Worker) — solo si la pestaña está
 * en 2do plano Y ya hay permiso concedido. */
function notificarSistemaSiCorresponde(cuerpo) {
  if (typeof Notification === "undefined") return;
  if (typeof document !== "undefined" && document.visibilityState !== "hidden") return;
  if (Notification.permission !== "granted") return;
  try {
    new Notification("Tiempo de Estudio", { body: cuerpo });
  } catch (e) {
    console.error("[tiempo-estudio-timer] no se pudo mostrar la notificación:", e);
  }
}

function dispararAlerta(mensaje) {
  reproducirBeep();
  mostrarToast(mensaje);
  notificarSistemaSiCorresponde(mensaje);
}

/* ===================== Notificar suscriptores + intervalo ===================== */

function notificar() {
  suscriptores.forEach((cb) => {
    try {
      cb(timerActivo);
    } catch (e) {
      console.error("[tiempo-estudio-timer] un suscriptor falló:", e);
    }
  });
}

function duracionFaseMs(pomodoro) {
  const { config, fase } = pomodoro;
  const minutos =
    fase === "trabajo" ? config.duracion_bloque_min : fase === "descanso_corto" ? config.descanso_corto_min : config.descanso_largo_min;
  return Math.max(0, Number(minutos) || 0) * 60000;
}

/**
 * Cierra la fase de Pomodoro actual y arranca la siguiente. Solo un
 * bloque de TRABAJO genera sesión de estudio real — los descansos (corto
 * y largo) nunca suman a la meta ni a competencias (punto 1 del plan).
 * Ciclo: trabajo(1) → descanso corto → trabajo(2) → ... → trabajo(N) →
 * descanso largo → trabajo(1) [arranca de nuevo], indefinidamente hasta
 * que el usuario detiene el timer a mano.
 */
function avanzarFasePomodoro() {
  const { materiaMatriculadaId, pomodoro } = timerActivo;
  const { config } = pomodoro;

  if (pomodoro.fase === "trabajo") {
    const inicio = timerActivo.inicioFase;
    const fin = inicio + config.duracion_bloque_min * 60000;
    const sesion = crearSesionEstudio({ materiaMatriculadaId, inicio, fin, origen: "pomodoro" });
    estado.datos.sesiones_estudio.push(sesion);
    marcarCambioPendiente();
    revisarFelicitacionMeta(materiaMatriculadaId);

    const esUltimoBloque = pomodoro.bloqueActual >= config.cantidad_bloques;
    pomodoro.fase = esUltimoBloque ? "descanso_largo" : "descanso_corto";
    dispararAlerta(esUltimoBloque ? "🎉 Completaste el ciclo — arrancó el descanso largo" : "✅ Bloque terminado — arrancó el descanso");
  } else {
    const eraDescansoLargo = pomodoro.fase === "descanso_largo";
    pomodoro.fase = "trabajo";
    pomodoro.bloqueActual = eraDescansoLargo ? 1 : pomodoro.bloqueActual + 1;
    dispararAlerta("⏱ Descanso terminado — volviste al bloque de trabajo");
  }

  timerActivo.inicioFase = Date.now();
  guardarSnapshotLocal();
}

/**
 * Timer simple (sin Pomodoro): al llegar a la meta semanal configurada
 * (considerando lo ya guardado esta semana + el tramo en vivo de la
 * sesión actual), dispara UNA sola vez la vibración + aviso — el timer
 * sigue contando de largo, nunca se detiene solo (punto 3 del plan).
 */
function revisarMetaSimple() {
  if (timerActivo.origen !== "timer" || timerActivo.metaAlarmaDisparada) return;
  const mm = buscarMateriaMatriculada(timerActivo.materiaMatriculadaId);
  const meta = mm && mm.tiempo_estudio.meta_horas_semana;
  if (meta === null || meta === undefined) return;
  const metaMinutos = meta * 60;
  if (metaMinutos <= 0) return;

  const minutosYaGuardados = calcularMinutosEstaSemana(timerActivo.materiaMatriculadaId);
  const minutosSesionActual = (Date.now() - timerActivo.sesionInicio) / 60000;

  if (minutosYaGuardados + minutosSesionActual >= metaMinutos) {
    timerActivo.metaAlarmaDisparada = true;
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      try {
        navigator.vibrate(200);
      } catch (e) {
        /* sin soporte real pese a existir el método: se ignora */
      }
    }
    dispararAlerta("🎉 Llegaste a tu meta de esta semana — seguís sumando en excedente");
  }
}

function tick() {
  if (timerActivo === null) return;
  if (timerActivo.pomodoro) {
    // Bucle acotado: si la pestaña estuvo en 2do plano y el intervalo se
    // atrasó más de una fase completa, avanza todas las fases que
    // corresponda en vez de quedar "una fase atrás" hasta el próximo tick.
    let seguridad = 0;
    while (timerActivo && Date.now() - timerActivo.inicioFase >= duracionFaseMs(timerActivo.pomodoro) && seguridad < 500) {
      avanzarFasePomodoro();
      seguridad++;
    }
  } else {
    revisarMetaSimple();
  }
  notificar();
}

function asegurarIntervalo() {
  if (intervaloId !== null) return;
  intervaloId = setInterval(tick, 1000);
}

function detenerIntervaloSiNoHaceFalta() {
  if (timerActivo === null && intervaloId !== null) {
    clearInterval(intervaloId);
    intervaloId = null;
  }
}

/* ===================== API pública ===================== */

function suscribirseATimer(cb) {
  suscriptores.add(cb);
  cb(timerActivo);
  return () => suscriptores.delete(cb);
}

function hayTimerActivo() {
  return timerActivo !== null;
}

function obtenerTimerActivo() {
  return timerActivo;
}

/** Segundos transcurridos de la FASE actual (no de toda la sesión) — para
 * timer simple es lo mismo (una sola fase = toda la sesión); para Pomodoro
 * es el avance del bloque/descanso en curso, que es lo que tiene sentido
 * mostrar en el cronómetro de la pantalla de detalle. */
function segundosTranscurridos() {
  if (timerActivo === null) return 0;
  return Math.max(0, Math.floor((Date.now() - timerActivo.inicioFase) / 1000));
}

function iniciarTimerEstudio(materiaMatriculadaId) {
  if (timerActivo !== null) return false;

  const mm = buscarMateriaMatriculada(materiaMatriculadaId);
  const pomodoroConfig = mm && mm.tiempo_estudio.pomodoro;
  const ahora = Date.now();

  timerActivo = {
    materiaMatriculadaId,
    origen: pomodoroConfig ? "pomodoro" : "timer",
    sesionInicio: ahora,
    inicioFase: ahora,
    pomodoro: pomodoroConfig ? { config: { ...pomodoroConfig }, bloqueActual: 1, fase: "trabajo" } : null,
    metaAlarmaDisparada: false,
  };

  if (pomodoroConfig) pedirPermisoNotificacionSiHaceFalta();

  guardarSnapshotLocal();
  asegurarIntervalo();
  notificar();
  return true;
}

/**
 * Detiene el timer activo (si hay uno). Solo guarda una sesión si la fase
 * en curso "cuenta" como estudio real: timer simple siempre, Pomodoro solo
 * si estaba en fase de trabajo — detener a mitad de un descanso nunca
 * genera sesión, igual que si ese descanso hubiera terminado solo.
 * Devuelve la sesión creada, o `null` si no había timer corriendo o si lo
 * que se detuvo fue un descanso (nada que guardar).
 */
function detenerTimerEstudio() {
  if (timerActivo === null) return null;
  const { materiaMatriculadaId, origen, pomodoro, inicioFase } = timerActivo;

  const cuentaComoTrabajo = origen === "timer" || (pomodoro && pomodoro.fase === "trabajo");
  let sesion = null;
  if (cuentaComoTrabajo) {
    const fin = Date.now();
    sesion = crearSesionEstudio({ materiaMatriculadaId, inicio: inicioFase, fin, origen });
    estado.datos.sesiones_estudio.push(sesion);
    marcarCambioPendiente();
    revisarFelicitacionMeta(materiaMatriculadaId);
  }

  timerActivo = null;
  guardarSnapshotLocal();
  detenerIntervaloSiNoHaceFalta();
  notificar();
  return sesion;
}

function cambiarTimerEstudio(materiaMatriculadaIdNueva) {
  detenerTimerEstudio();
  return iniciarTimerEstudio(materiaMatriculadaIdNueva);
}

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

/* ===================== Salvavidas de sesión olvidada (punto 4) ===================== */

/**
 * Modal propio (mismo patrón overlay+.glass-card.modal-card que el resto
 * de la app) para corregir la duración real antes de guardar. Vive acá
 * (no en tiempo-estudio.js) porque está fuertemente acoplado a la forma
 * interna del snapshot — mantenerlo cerca evita que otro archivo tenga que
 * conocer esos detalles.
 */
function abrirAvisoSesionOlvidada(snapshot) {
  const inicioLegible = new Date(snapshot.sesionInicio).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:400; background:rgba(0,0,0,0.55); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:400px; width:100%; gap:14px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  caja.innerHTML = `
    <div>
      <h2 style="margin:0;">Dejaste una sesión corriendo</h2>
      <p class="muted" style="margin:6px 0 0; font-size:0.85rem;">
        Parece que iniciaste el timer y no lo detuviste. ¿Cuánto estudiaste en realidad?
      </p>
    </div>
    <div class="row-between" style="gap:10px;">
      <div style="flex:1;">
        <span class="form-label">Horas</span>
        <input type="number" id="te-olvidada-horas" class="form-input" min="0" value="0">
      </div>
      <div style="flex:1;">
        <span class="form-label">Minutos</span>
        <input type="number" id="te-olvidada-minutos" class="form-input" min="0" max="59" value="0">
      </div>
    </div>
    <p class="muted" style="font-size:0.78rem; margin:0;">Empezó a las ${inicioLegible}.</p>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-olvidada-descartar" style="flex:1;">Descartar sesión</button>
      <button type="button" class="btn btn-primary" id="te-olvidada-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  function cerrar() {
    overlay.remove();
    localStorage.removeItem(CLAVE_TIMER_ACTIVO);
  }
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) cerrar();
  });
  caja.querySelector("#te-olvidada-descartar").addEventListener("click", cerrar);

  caja.querySelector("#te-olvidada-guardar").addEventListener("click", () => {
    const h = Math.max(0, Number(caja.querySelector("#te-olvidada-horas").value) || 0);
    const m = Math.max(0, Number(caja.querySelector("#te-olvidada-minutos").value) || 0);
    const minutosTotales = h * 60 + m;
    if (minutosTotales > 0) {
      const inicio = snapshot.inicioFase;
      const fin = inicio + minutosTotales * 60000;
      const sesion = crearSesionEstudio({ materiaMatriculadaId: snapshot.materiaMatriculadaId, inicio, fin, origen: snapshot.origen });
      estado.datos.sesiones_estudio.push(sesion);
      marcarCambioPendiente();
      revisarFelicitacionMeta(snapshot.materiaMatriculadaId);
      mostrarToast("Sesión guardada");
    }
    cerrar();
  });

  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

/**
 * Se llama UNA vez al arrancar la app (ver inicializarTiempoEstudio en
 * tiempo-estudio.js). Si el snapshot local indica que quedó una fase que
 * "cuenta" como estudio (timer simple, o Pomodoro en trabajo) corriendo
 * por más de SALVAVIDAS_HORAS_LIMITE horas, abre el modal de corrección.
 * Una sesión corta (recarga normal de página) o que quedó a mitad de un
 * descanso se descarta en silencio — no hay nada que valga la pena
 * preguntar en esos casos.
 */
function revisarSesionOlvidadaAlAbrir() {
  let snapshot = null;
  try {
    const crudo = localStorage.getItem(CLAVE_TIMER_ACTIVO);
    if (!crudo) return;
    snapshot = JSON.parse(crudo);
  } catch (e) {
    localStorage.removeItem(CLAVE_TIMER_ACTIVO);
    return;
  }
  if (!snapshot || !snapshot.materiaMatriculadaId || !snapshot.inicioFase) {
    localStorage.removeItem(CLAVE_TIMER_ACTIVO);
    return;
  }

  const horasEnFaseActual = (Date.now() - snapshot.inicioFase) / 3600000;
  const faseActualCuenta = snapshot.origen === "timer" || (snapshot.pomodoro && snapshot.pomodoro.fase === "trabajo");

  if (horasEnFaseActual < SALVAVIDAS_HORAS_LIMITE || !faseActualCuenta) {
    localStorage.removeItem(CLAVE_TIMER_ACTIVO);
    return;
  }

  abrirAvisoSesionOlvidada(snapshot);
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
  revisarSesionOlvidadaAlAbrir,
  revisarFelicitacionMeta,
};
