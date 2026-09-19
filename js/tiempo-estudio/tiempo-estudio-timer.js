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

   -------------------------------------------------------------------------
   RONDA 2026-09-17 — bugfix de pérdida de tiempo + avisos en 2do plano
   -------------------------------------------------------------------------
   BUG REAL (reporte: "inicié a las 2pm, detuve a las 10pm, estuve afuera de
   la app entre 5pm y 7pm, y solo contó 3 horas"). Causa raíz: el snapshot
   de localStorage se usaba ÚNICAMENTE para el salvavidas — no existía en
   ningún lado la operación inversa de "volver a levantar el timer en
   memoria al reabrir la app". Los 3 caminos de
   `revisarSesionOlvidadaAlAbrir()` terminaban en `removeItem()`:
     a) fase de menos de 3 h  → se borraba el snapshot EN SILENCIO y la
        sesión desaparecía entera (recarga de pestaña, el navegador móvil
        descartando la pestaña por memoria, cerrar y volver a abrir).
     b) fase de 3+ h          → se abría el modal de corrección… pero
        precargado en 0h 0m, sin restaurar el timer; al cerrarlo (o al
        tocar fuera del modal, que también descartaba) el timer ya no
        existía, así que el "Detener" de las 10pm no tenía nada que cerrar.
     c) descanso de Pomodoro  → se descartaba en silencio.
   En el escenario reportado se dio (b): a las 7pm la app arrancó de cero,
   el modal apareció, quedaron registradas las ~3 h que la persona escribió
   a mano (o las que se descartaron), y de 7pm a 10pm el timer directamente
   no estaba corriendo.

   FIX: `restaurarTimerDesdeSnapshot()` — al arrancar la app, el timer se
   vuelve a levantar SIEMPRE tal cual estaba (mismos `sesionInicio` /
   `inicioFase` / fase de Pomodoro / estado de pausa). El salvavidas dejó
   de ser destructivo: ya no descarta nada, solo PREGUNTA cuando la fase
   venía corriendo hace 3+ horas, con la duración real precargada y con
   "Seguir contando" como opción (ver abrirAvisoSesionOlvidada).

   Ojo con la expectativa del reporte: bajo el modelo timestamp-inicio/fin
   (que es el diseñado y el que pide el punto 1.2), estar fuera de la app
   NO descuenta tiempo — 2pm→10pm son 8 h, no 6. Las 2 h "afuera" cuentan
   igual; lo que había que arreglar era la pérdida total, no el descuento.

   -------------------------------------------------------------------------
   CAMBIO DE COMPORTAMIENTO 2026-09-19 — "las fases ya NO avanzan solas"
   -------------------------------------------------------------------------
   Antes: al cumplirse el tiempo de un bloque el motor guardaba la sesión y
   arrancaba el descanso solo; al cumplirse el descanso volvía solo al
   trabajo. Resultado: revisar la app y encontrarla en un descanso que nadie
   pidió (o saltando de fase sin que la persona estuviera ahí).

   Ahora el tiempo configurado es un HITO, no un corte:
     · Cuando el bloque (o el descanso) llega a su duración, suena UN aviso
       y la fase SIGUE corriendo. Lo que pasa de ahí en más es "tiempo
       extra" (ver tiempoDeFase: el cronómetro principal se queda clavado
       en la duración configurada, ej. 40:00, y el extra cuenta aparte).
     · El tiempo extra de un bloque de TRABAJO sí es estudio: al tocar
       "Descanso" (iniciarDescansoPomodoro) la sesión se guarda completa,
       bloque + extra.
     · El tiempo extra de un DESCANSO nunca suma (igual que el descanso
       mismo). Se sale con "Terminar descanso" (saltarDescansoPomodoro).
     · Nada cambia de fase sin un toque de la persona. Por eso ya no existe
       `avanzarFasePomodoro` ni el bucle de "ponerse al día" de tick().
   El aviso de fin de fase se dispara una sola vez por fase
   (`avisoFaseDisparado`, va en el snapshot para que recargar no lo repita).
   ========================================================================= */

import { crearSesionEstudio, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast, abrirConfirmacion } from "../ui/componentes.js";
import { sincronizarHorasCompetencias } from "./tiempo-estudio-competencias.js";

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
 *   pausado,         // Pausa (pedido 2026-09-07): true mientras está en pausa
 *   msPausaInicio,   // epoch ms en que empezó la pausa actual, o null si no está pausado
 *   avisoFaseDisparado, // Pomodoro: true una vez que ya sonó el aviso de "se cumplió el tiempo" de la fase actual
 * } | null
 * `fase` es "trabajo" | "descanso_corto" | "descanso_largo".
 *
 * Mecánica de pausa (pedido 2026-09-07, "necesito play/pause y botón de
 * detener sesión aparte"): en vez de llevar un acumulador de ms pausados
 * aparte, al REANUDAR se corren `sesionInicio` e `inicioFase` hacia
 * adelante exactamente la duración de la pausa. Así, mientras está
 * pausado, ningún reloj se mueve (ni el del bloque ni el de la meta) y al
 * reanudar todo el resto del código (tick, revisarMetaSimple,
 * iniciarDescansoPomodoro, detenerTimerEstudio) sigue funcionando exactamente
 * igual que si la pausa nunca hubiera pasado, sin tener que sumar/restar
 * un acumulador en cada lugar donde se usa sesionInicio/inicioFase.
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
        // 2026-09-17: antes NO se guardaba, así que al restaurar el timer
        // (restaurarTimerDesdeSnapshot) la alarma de "llegaste a la meta"
        // se volvía a disparar en la misma sesión.
        metaAlarmaDisparada: timerActivo.metaAlarmaDisparada,
        pausado: timerActivo.pausado,
        msPausaInicio: timerActivo.msPausaInicio,
        avisoFaseDisparado: timerActivo.avisoFaseDisparado,
      })
    );
  } catch (e) {
    console.error("[tiempo-estudio-timer] no se pudo guardar el snapshot local:", e);
  } finally {
    // Esta función se llama en cada momento en que cambia el estado del
    // timer (iniciar, empezar/terminar descanso, aviso de fin de fase,
    // pausar, reanudar, detener), así que es el único lugar donde hace falta
    // reprogramar la alarma de fin de fase — ver programarAlarmaFase().
    programarAlarmaFase();
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
 * iniciarDescansoPomodoro (bloque de trabajo), abrirAvisoSesionOlvidada, y
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
 * preguntó), lo pide — se llama al iniciar CUALQUIER timer (2026-09-17:
 * antes solo con Pomodoro, así que el aviso de "llegaste a la meta" del
 * timer simple nunca podía llegar en 2do plano si la persona jamás había
 * usado Pomodoro). El click de "Iniciar" ya es el gesto del usuario que
 * el navegador exige para poder preguntar.
 * Si el usuario nunca lo concede, simplemente no hay notificación del
 * sistema y queda el aviso visual+sonido de cuando vuelve a la pestaña. */
function pedirPermisoNotificacionSiHaceFalta() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/**
 * 2026-09-17 (reporte: "el aviso de fin de bloque solo me funciona con la
 * app abierta adelante"). Notification API LOCAL — nunca push, nunca
 * Worker, sigue sin haber backend de por medio.
 *
 * Tres cambios respecto a la versión anterior:
 *  1) Se dispara si la pestaña está oculta O si simplemente no tiene el
 *     foco (`document.hasFocus()` falso) — el caso "la ventana se ve pero
 *     estoy en otra app/pestaña" no es `visibilityState === "hidden"` en
 *     escritorio, y era justo el que la usuaria reportó.
 *  2) Prioriza `registration.showNotification()` del Service Worker sobre
 *     `new Notification(...)`: en Chrome de Android el constructor
 *     directo TIRA una excepción ("Illegal constructor"), así que en
 *     celular la notificación nunca llegaba aunque hubiera permiso. El
 *     SW ya está registrado en esta app (ver main.js / el listener de
 *     `serviceWorker` que salta a Agenda al tocar una notificación).
 *  3) `tag` fijo + `renotify`: si llegan 2 cambios de fase seguidos no se
 *     apilan 2 notificaciones, se reemplaza la anterior.
 *
 * LIMITACIÓN REAL DE PLATAFORMA, no se puede resolver del todo sin
 * backend (documentada también en el resumen del prompt): esto depende de
 * que el proceso del navegador siga vivo. Mientras la pestaña esté nada
 * más que en 2do plano, funciona. Si el sistema operativo SUSPENDE o
 * descarta la pestaña —iOS/Safari lo hace bastante rápido al minimizar,
 * Android lo hace bajo presión de memoria— no corre JS ninguno, así que
 * ni este aviso ni ningún otro puede dispararse a tiempo. La única forma
 * de garantizarlo sería Web Push con un backend que programe el envío
 * (justamente lo que se le sacó al Worker en 2026-08-25). Lo que sí está
 * garantizado es que NO se pierde tiempo: los tiempos salen de timestamps,
 * y desde 2026-09-19 ninguna fase cambia sola, así que al volver el
 * cronómetro y el tiempo extra ya están al día (ver el listener de
 * visibilitychange al final del archivo).
 */
function notificarSistemaSiCorresponde(cuerpo) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;

  const enPrimerPlano =
    typeof document !== "undefined" &&
    document.visibilityState === "visible" &&
    (typeof document.hasFocus !== "function" || document.hasFocus());
  if (enPrimerPlano) return; // ya lo ve: alcanza con el toast + beep

  const opciones = {
    body: cuerpo,
    tag: "tiempo-estudio-fase",
    renotify: true,
    silent: false,
  };

  // Camino preferido: Service Worker (único que funciona en Android).
  if (typeof navigator !== "undefined" && navigator.serviceWorker && navigator.serviceWorker.ready) {
    navigator.serviceWorker.ready
      .then((registro) => registro.showNotification("Tiempo", opciones))
      .catch(() => notificarConConstructorDirecto(cuerpo, opciones));
    return;
  }
  notificarConConstructorDirecto(cuerpo, opciones);
}

/** Fallback de escritorio para cuando no hay Service Worker disponible. */
function notificarConConstructorDirecto(cuerpo, opciones) {
  try {
    new Notification("Tiempo", opciones);
  } catch (e) {
    console.warn("[tiempo-estudio-timer] no se pudo mostrar la notificación:", e);
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
 * Estado del cronómetro de la FASE actual, listo para pintar.
 *   · `transcurridos`: segundos de la fase, TOPADOS a la duración
 *     configurada — el cronómetro principal llega a 40:00 y se queda ahí.
 *   · `extra`: segundos pasados de la duración (siempre 0 en timer simple,
 *     que no tiene duración fija).
 *   · `duracion`: segundos configurados de la fase (0 en timer simple).
 *   · `completa`: la fase ya cumplió su duración (habilita "Descanso" /
 *     "Terminar descanso" en la UI y en el motor).
 * Respeta la pausa (usa segundosTranscurridos, que se congela).
 */
function tiempoDeFase() {
  if (timerActivo === null) return { transcurridos: 0, extra: 0, duracion: 0, completa: false };
  const total = segundosTranscurridos();
  if (!timerActivo.pomodoro) return { transcurridos: total, extra: 0, duracion: 0, completa: false };
  const duracion = Math.round(duracionFaseMs(timerActivo.pomodoro) / 1000);
  return {
    transcurridos: Math.min(total, duracion),
    extra: Math.max(0, total - duracion),
    duracion,
    completa: total >= duracion,
  };
}

/**
 * Suena UN aviso cuando la fase de Pomodoro cumple su duración. NO cambia de
 * fase (ver cabecera): solo avisa y deja la fase corriendo como tiempo
 * extra. Si está en pausa no avisa (el reloj no avanza).
 */
function avisarFinDeFaseSiCorresponde() {
  const pomodoro = timerActivo && timerActivo.pomodoro;
  if (!pomodoro || timerActivo.avisoFaseDisparado || timerActivo.pausado) return;
  if (!tiempoDeFase().completa) return;

  timerActivo.avisoFaseDisparado = true;
  guardarSnapshotLocal();

  if (pomodoro.fase === "trabajo") {
    const esUltimoBloque = pomodoro.bloqueActual >= pomodoro.config.cantidad_bloques;
    dispararAlerta(
      esUltimoBloque
        ? "🎉 Completaste el ciclo — tocá «Descanso» cuando quieras. Mientras tanto suma tiempo extra"
        : "✅ Bloque terminado — tocá «Descanso» cuando quieras. Mientras tanto suma tiempo extra"
    );
  } else {
    dispararAlerta("⏱ Se cumplió el tiempo de descanso — tocá «Terminar descanso» cuando estés listo");
  }
}

/**
 * "Descanso" (pedido 2026-09-19): cierra el bloque de TRABAJO y arranca el
 * descanso. Es lo único que saca a un bloque de la fase de trabajo. La
 * sesión guardada va desde el inicio del bloque hasta AHORA, o sea incluye
 * el tiempo extra (es estudio real). Si estaba pausado, el fin es el
 * instante en que empezó la pausa y el descanso arranca corriendo (mismo
 * criterio que saltarDescansoPomodoro).
 *
 * Solo procede si el bloque ya cumplió su duración: el tiempo que la
 * persona configuró se respeta; para cortar antes está "Detener sesión".
 * `false` sin hacer nada si no hay timer, no es Pomodoro, no está en fase
 * de trabajo o el bloque todavía no termina.
 * Ciclo: trabajo(1) → descanso corto → trabajo(2) → ... → trabajo(N) →
 * descanso largo → trabajo(1), todo a toque de la persona.
 */
function iniciarDescansoPomodoro() {
  if (timerActivo === null || !timerActivo.pomodoro) return false;
  const { materiaMatriculadaId, pomodoro, inicioFase, pausado, msPausaInicio } = timerActivo;
  if (pomodoro.fase !== "trabajo" || !tiempoDeFase().completa) return false;

  const ahora = Date.now();
  const fin = pausado ? msPausaInicio : ahora;
  if (fin > inicioFase) {
    const sesion = crearSesionEstudio({ materiaMatriculadaId, inicio: inicioFase, fin, origen: "pomodoro" });
    estado.datos.sesiones_estudio.push(sesion);
    marcarCambioPendiente();
    revisarFelicitacionMeta(materiaMatriculadaId);
    sincronizarHorasCompetencias();
  }

  const esUltimoBloque = pomodoro.bloqueActual >= pomodoro.config.cantidad_bloques;
  pomodoro.fase = esUltimoBloque ? "descanso_largo" : "descanso_corto";

  if (pausado) {
    timerActivo.sesionInicio += ahora - msPausaInicio;
    timerActivo.pausado = false;
    timerActivo.msPausaInicio = null;
  }
  timerActivo.inicioFase = ahora;
  timerActivo.avisoFaseDisparado = false;

  guardarSnapshotLocal();
  mostrarToast(esUltimoBloque ? "🎉 Ciclo completo guardado — arrancó el descanso largo" : "☕ Bloque guardado — arrancó el descanso");
  notificar();
  return true;
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
  // Pausa: ningún reloj avanza mientras está pausado — ni fase de
  // Pomodoro ni la revisión de meta simple. inicioFase/sesionInicio se
  // corren hacia adelante recién al reanudar (ver reanudarTimerEstudio),
  // así que no hace falta tocar nada acá, solo no procesar este tick.
  if (timerActivo.pausado) return;
  if (timerActivo.pomodoro) {
    // Ya NO avanza de fase: solo avisa una vez que se cumplió el tiempo
    // (ver cabecera). Pasarse de la duración es tiempo extra, no un corte.
    avisarFinDeFaseSiCorresponde();
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
  if (timerActivo === null) cancelarAlarmaFase();
}

/* ===== Alarma de fin de fase en 2do plano (2026-09-17, punto 1.3) ===== */

let alarmaFaseId = null;

function cancelarAlarmaFase() {
  if (alarmaFaseId !== null) {
    clearTimeout(alarmaFaseId);
    alarmaFaseId = null;
  }
}

/**
 * `setInterval(tick, 1000)` alcanza de sobra con la pestaña adelante, pero
 * los navegadores lo estrangulan fuerte en 2do plano (Chrome lo lleva a
 * 1 vez por minuto tras unos minutos ocultos), así que el aviso de fin de
 * bloque podía llegar con bastante atraso — parte del reporte de la
 * usuaria. Un `setTimeout` ÚNICO apuntado al instante exacto en que
 * termina la fase actual sobrevive mucho mejor a ese estrangulamiento (el
 * navegador lo alinea al próximo despertar, no lo pospone un minuto
 * entero), así que se usan los dos en paralelo: el intervalo para pintar
 * el cronómetro y esta alarma para que el aviso salga a tiempo.
 *
 * NO detiene ni corta nada (punto 1.2): lo único que hace es llamar a
 * `tick()`, que es exactamente lo mismo que hubiera pasado con la pestaña
 * adelante (o sea, sacar el aviso de "se cumplió el tiempo"; la fase no
 * cambia sola).
 */
function programarAlarmaFase() {
  cancelarAlarmaFase();
  if (timerActivo === null || timerActivo.pausado || !timerActivo.pomodoro || timerActivo.avisoFaseDisparado) return;

  const faltaMs = timerActivo.inicioFase + duracionFaseMs(timerActivo.pomodoro) - Date.now();
  if (faltaMs <= 0) return; // ya venció: el próximo tick lo avisa
  alarmaFaseId = setTimeout(() => {
    alarmaFaseId = null;
    tick();
  }, faltaMs);
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

/**
 * Blindaje 2026-09-17 (punto 3.5 de la auditoría): puente por `window`, el
 * mismo patrón que ya usa el proyecto para llamadas cruzadas entre módulos
 * sin crear imports circulares (window.renderizarTiempoEstudio,
 * window.renderizarHorario, etc. — ver mostrarSeccion en main.js).
 * `pedirConfirmacionCerrarSesion()` (main.js) lo consulta para no dejar
 * cerrar sesión en silencio con una sesión de estudio corriendo: lo que
 * lleva el cronómetro todavía NO está en `estado.datos` (recién lo escribe
 * detenerTimerEstudio), así que `estado.pendienteSync` no lo refleja.
 */
if (typeof window !== "undefined") window.hayTimerActivo = hayTimerActivo;

function obtenerTimerActivo() {
  return timerActivo;
}

/** Segundos transcurridos de la FASE actual (no de toda la sesión) — para
 * timer simple es lo mismo (una sola fase = toda la sesión); para Pomodoro
 * es el avance del bloque/descanso en curso, que es lo que tiene sentido
 * mostrar en el cronómetro de la pantalla de detalle. */
function segundosTranscurridos() {
  if (timerActivo === null) return 0;
  // Pausado: se congela en el instante en que empezó la pausa, en vez de
  // seguir avanzando con Date.now() — es lo que hace que el display se
  // vea "detenido" mientras está en pausa.
  const referencia = timerActivo.pausado ? timerActivo.msPausaInicio : Date.now();
  return Math.max(0, Math.floor((referencia - timerActivo.inicioFase) / 1000));
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
    pausado: false,
    msPausaInicio: null,
    avisoFaseDisparado: false,
  };

  // 2026-09-17: se pide SIEMPRE, no solo con Pomodoro — el aviso de
  // "llegaste a la meta" del timer simple también tiene que poder llegar
  // con la app en 2do plano (punto 1.3).
  pedirPermisoNotificacionSiHaceFalta();

  guardarSnapshotLocal();
  asegurarIntervalo();
  notificar();
  return true;
}

/**
 * Pausa/reanuda (pedido 2026-09-07): "necesito que si le doy iniciar salga
 * botón tipo play/pause y botón de detener sesión" — separado del botón
 * de detener, que sigue siendo el único que cierra y guarda la sesión.
 * Aplica igual para timer simple y Pomodoro (pausar a mitad de un
 * descanso también congela ese descanso, no solo los bloques de trabajo).
 * No hace nada si no hay timer activo o si ya está en el estado pedido
 * (pausar dos veces, reanudar sin estar pausado).
 */
function pausarTimerEstudio() {
  if (timerActivo === null || timerActivo.pausado) return false;
  timerActivo.pausado = true;
  timerActivo.msPausaInicio = Date.now();
  guardarSnapshotLocal();
  notificar();
  return true;
}

function reanudarTimerEstudio() {
  if (timerActivo === null || !timerActivo.pausado) return false;
  // Correr sesionInicio/inicioFase hacia adelante la duración exacta de
  // la pausa — ver nota de cabecera sobre por qué no se usa un
  // acumulador aparte.
  const duracionPausaMs = Date.now() - timerActivo.msPausaInicio;
  timerActivo.inicioFase += duracionPausaMs;
  timerActivo.sesionInicio += duracionPausaMs;
  timerActivo.pausado = false;
  timerActivo.msPausaInicio = null;
  guardarSnapshotLocal();
  notificar();
  return true;
}

function timerEstaPausado() {
  return Boolean(timerActivo && timerActivo.pausado);
}

/**
 * Detiene el timer activo (si hay uno). Solo guarda una sesión si la fase
 * en curso "cuenta" como estudio real: timer simple siempre, Pomodoro solo
 * si estaba en fase de trabajo — detener a mitad de un descanso nunca
 * genera sesión, igual que si ese descanso hubiera terminado solo.
 * Si se detiene mientras está en pausa, el fin de la sesión guardada es el
 * instante en que empezó la pausa (no Date.now()) — el tiempo pausado
 * nunca cuenta como estudiado.
 * Devuelve la sesión creada, o `null` si no había timer corriendo, si lo
 * que se detuvo fue un descanso, o si la duración resultante es 0.
 */
function detenerTimerEstudio() {
  if (timerActivo === null) return null;
  const { materiaMatriculadaId, origen, pomodoro, inicioFase, pausado, msPausaInicio } = timerActivo;

  const cuentaComoTrabajo = origen === "timer" || (pomodoro && pomodoro.fase === "trabajo");
  let sesion = null;
  if (cuentaComoTrabajo) {
    const fin = pausado ? msPausaInicio : Date.now();
    if (fin > inicioFase) {
      sesion = crearSesionEstudio({ materiaMatriculadaId, inicio: inicioFase, fin, origen });
      estado.datos.sesiones_estudio.push(sesion);
      marcarCambioPendiente();
      revisarFelicitacionMeta(materiaMatriculadaId);
      sincronizarHorasCompetencias();
    }
  }

  timerActivo = null;
  guardarSnapshotLocal();
  detenerIntervaloSiNoHaceFalta();
  notificar();
  return sesion;
}

/**
 * "Saltar descanso" (pedido 1.4, 2026-09-17): corta el descanso en curso y
 * vuelve YA al bloque de trabajo siguiente, sin esperar a que se cumpla el
 * tiempo configurado. No hace nada si no hay timer, si no es Pomodoro, o
 * si ya está en fase de trabajo (el botón ni se muestra en esos casos,
 * pero se blinda igual acá — este archivo es el único punto de entrada
 * real del motor, no confía en que la UI respete la regla).
 *
 * Desde 2026-09-19 es TAMBIÉN el "Terminar descanso": el descanso ya no
 * termina solo, así que cuando se cumple el tiempo y sigue corriendo como
 * extra, esta es la única salida (la UI cambia el texto del botón según
 * `tiempoDeFase().completa`). Incluye el conteo de bloques y el reinicio
 * del ciclo después de un descanso largo.
 * Nunca genera sesión de estudio: los descansos no suman, se salten o no.
 */
function saltarDescansoPomodoro() {
  if (timerActivo === null || !timerActivo.pomodoro) return false;
  const { pomodoro } = timerActivo;
  if (pomodoro.fase === "trabajo") return false;

  // Se lee ANTES de cambiar de fase: distingue "Terminar descanso" (ya se
  // había cumplido el tiempo) de "Saltar descanso" (se corta antes).
  const descansoCumplido = tiempoDeFase().completa;
  const eraDescansoLargo = pomodoro.fase === "descanso_largo";
  pomodoro.fase = "trabajo";
  pomodoro.bloqueActual = eraDescansoLargo ? 1 : pomodoro.bloqueActual + 1;

  // Si estaba pausado a mitad del descanso, se reanuda solo: pedir
  // "saltar el descanso" y quedar congelado igual sería confuso. Se corre
  // `sesionInicio` igual que en reanudarTimerEstudio para que el tiempo
  // pausado no cuente como sesión.
  if (timerActivo.pausado) {
    timerActivo.sesionInicio += Date.now() - timerActivo.msPausaInicio;
    timerActivo.pausado = false;
    timerActivo.msPausaInicio = null;
  }
  timerActivo.inicioFase = Date.now();
  timerActivo.avisoFaseDisparado = false;

  guardarSnapshotLocal();
  mostrarToast(descansoCumplido ? "⏱ Descanso terminado — volviste al bloque de trabajo" : "⏭ Descanso salteado — volviste al bloque de trabajo");
  notificar();
  return true;
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
  // 2026-09-17: se precarga la duración REAL transcurrida en vez de 0h 0m.
  // Con 0 precargado, el camino de menor resistencia ("Guardar" sin tocar
  // nada) descartaba toda la sesión sin que se notara — parte del bug de
  // pérdida de tiempo reportado.
  const minutosReales = Math.max(0, Math.floor((Date.now() - snapshot.inicioFase) / 60000));
  const horasPrecargadas = Math.floor(minutosReales / 60);
  const minutosPrecargados = minutosReales % 60;

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
      <h2 style="margin:0;">Seguís con una sesión corriendo</h2>
      <p class="muted" style="margin:6px 0 0; font-size:0.85rem;">
        El timer arrancó a las ${inicioLegible} y sigue contando (salir de la app no lo corta).
        Si te olvidaste de detenerlo, podés cerrarlo acá con la duración real.
      </p>
    </div>
    <div class="row-between" style="gap:10px;">
      <div style="flex:1;">
        <span class="form-label">Horas</span>
        <input type="number" id="te-olvidada-horas" class="form-input" min="0" value="${horasPrecargadas}" autocomplete="off">
      </div>
      <div style="flex:1;">
        <span class="form-label">Minutos</span>
        <input type="number" id="te-olvidada-minutos" class="form-input" min="0" max="59" value="${minutosPrecargados}" autocomplete="off">
      </div>
    </div>
    <p class="muted" style="font-size:0.78rem; margin:0;">
      Viene precargado el tiempo real transcurrido. Cambialo solo si de verdad estudiaste menos.
    </p>
    <button type="button" class="btn btn-primary" id="te-olvidada-seguir" style="width:100%;">Seguir contando</button>
    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-olvidada-descartar" style="flex:1;">Descartar</button>
      <button type="button" class="btn btn-secondary" id="te-olvidada-guardar" style="flex:1;">Guardar y detener</button>
    </div>
  `;

  // Pedido 2.2 (y, antes que eso, blindaje contra pérdida de datos): tocar
  // fuera del modal NO lo cierra. Con el comportamiento anterior, un toque
  // al descuido en el fondo descartaba la sesión entera en silencio.
  function cerrar() {
    overlay.remove();
  }

  // "Seguir contando": no toca nada — el timer ya quedó restaurado y
  // corriendo por restaurarTimerDesdeSnapshot() antes de abrir esto.
  caja.querySelector("#te-olvidada-seguir").addEventListener("click", cerrar);

  caja.querySelector("#te-olvidada-descartar").addEventListener("click", () => {
    abrirConfirmacion({
      titulo: "Descartar la sesión",
      mensaje: "Se pierde todo el tiempo de esta sesión sin guardarlo. ¿Seguro?",
      textoConfirmar: "Descartar",
      claseConfirmar: "btn-danger",
      onConfirmar: () => {
        timerActivo = null;
        guardarSnapshotLocal();
        detenerIntervaloSiNoHaceFalta();
        notificar();
        cerrar();
      },
    });
  });

  caja.querySelector("#te-olvidada-guardar").addEventListener("click", () => {
    const h = Math.max(0, Number(caja.querySelector("#te-olvidada-horas").value) || 0);
    const m = Math.max(0, Number(caja.querySelector("#te-olvidada-minutos").value) || 0);
    const minutosTotales = h * 60 + m;

    // El timer vivo se corta SIEMPRE acá (es un "detener" explícito), haya
    // o no minutos que guardar.
    timerActivo = null;
    guardarSnapshotLocal();
    detenerIntervaloSiNoHaceFalta();
    notificar();

    const cuentaComoTrabajo = snapshot.origen === "timer" || (snapshot.pomodoro && snapshot.pomodoro.fase === "trabajo");
    if (minutosTotales > 0 && cuentaComoTrabajo) {
      const inicio = snapshot.inicioFase;
      const fin = inicio + minutosTotales * 60000;
      const sesion = crearSesionEstudio({ materiaMatriculadaId: snapshot.materiaMatriculadaId, inicio, fin, origen: snapshot.origen });
      estado.datos.sesiones_estudio.push(sesion);
      marcarCambioPendiente();
      revisarFelicitacionMeta(snapshot.materiaMatriculadaId);
      sincronizarHorasCompetencias();
      mostrarToast("Sesión guardada");
    }
    cerrar();
  });

  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

/**
 * Vuelve a poner en memoria el timer que describe `snapshot`, tal cual
 * estaba: mismos `sesionInicio`/`inicioFase` (o sea, el tiempo que pasó
 * con la app cerrada cuenta igual — punto 1.2), misma fase de Pomodoro,
 * mismo estado de pausa.
 *
 * `congelarAhora` (usado solo por el salvavidas): en vez de restaurarlo
 * corriendo, lo deja PAUSADO en este instante, hasta que la persona decida
 * qué hacer con una sesión de 3+ horas que quedó abierta. Si elige "Seguir
 * contando", reanudarTimerEstudio() lo destraba sin haber perdido nada.
 */
function restaurarTimerDesdeSnapshot(snapshot, { congelarAhora = false } = {}) {
  const ahora = Date.now();
  timerActivo = {
    materiaMatriculadaId: snapshot.materiaMatriculadaId,
    origen: snapshot.origen === "pomodoro" ? "pomodoro" : "timer",
    sesionInicio: snapshot.sesionInicio || snapshot.inicioFase,
    inicioFase: snapshot.inicioFase,
    pomodoro: snapshot.pomodoro || null,
    metaAlarmaDisparada: Boolean(snapshot.metaAlarmaDisparada),
    pausado: Boolean(snapshot.pausado) || congelarAhora,
    msPausaInicio: snapshot.pausado ? snapshot.msPausaInicio || ahora : congelarAhora ? ahora : null,
    avisoFaseDisparado: Boolean(snapshot.avisoFaseDisparado),
  };

  // Si la fase ya había cumplido su tiempo mientras la app estaba cerrada
  // (o el snapshot es de antes de este campo), NO se hace sonar el aviso al
  // reabrir: la persona ve el tiempo extra corriendo y listo.
  if (timerActivo.pomodoro && !timerActivo.avisoFaseDisparado && tiempoDeFase().completa) {
    timerActivo.avisoFaseDisparado = true;
  }

  guardarSnapshotLocal();
  asegurarIntervalo();
  notificar();
}

/**
 * Se llama UNA vez al arrancar la app (ver inicializarTiempoEstudio en
 * tiempo-estudio.js).
 *
 * REESCRITA 2026-09-17 — ver la nota de cabecera del archivo. Antes, los
 * 3 caminos de esta función terminaban borrando el snapshot sin restaurar
 * nada, o sea que cerrar/recargar la app MATABA la sesión activa en
 * silencio; esa era la causa real del reporte de "perdí horas". Ahora:
 *
 *   - Siempre que haya un snapshot válido, el timer se restaura y sigue
 *     corriendo desde donde estaba (incluidos los descansos de Pomodoro,
 *     que antes se descartaban).
 *   - El salvavidas dejó de ser destructivo: si la fase venía corriendo
 *     hace SALVAVIDAS_HORAS_LIMITE o más, se restaura CONGELADA y se abre
 *     el modal para decidir (seguir / guardar la duración real precargada
 *     / descartar a mano). Nunca descarta por su cuenta.
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
  // Ya hay un timer vivo en memoria (esta función se llamó dos veces, o la
  // app se re-inicializó sin recargar): no se pisa nada.
  if (timerActivo !== null) return;

  // Si quedó pausado, el reloj de referencia es el instante en que empezó
  // la pausa (mismo criterio que detenerTimerEstudio) — el tiempo pausado
  // no debe empujar a esta sesión hacia el salvavidas.
  const referencia = snapshot.pausado ? snapshot.msPausaInicio || Date.now() : Date.now();
  const horasEnFaseActual = (referencia - snapshot.inicioFase) / 3600000;

  if (horasEnFaseActual >= SALVAVIDAS_HORAS_LIMITE && !snapshot.pausado) {
    restaurarTimerDesdeSnapshot(snapshot, { congelarAhora: true });
    abrirAvisoSesionOlvidada(snapshot);
    return;
  }

  restaurarTimerDesdeSnapshot(snapshot);
}

/**
 * Punto 1.2 (a) — VERIFICADO: no existe en todo el proyecto ningún
 * listener de `visibilitychange`, `blur`, `pagehide` ni `beforeunload` que
 * detenga una sesión activa, ni ningún corte por inactividad. Este es el
 * único listener de visibilidad de Tiempo, y hace lo contrario: cuando la
 * pestaña vuelve a primer plano fuerza un `tick()` inmediato para sacar
 * el aviso de fin de fase que haya vencido mientras el navegador tenía el
 * temporizador estrangulado, en vez de esperar hasta un minuto al próximo
 * tick natural. Nunca detiene, descarta ni cambia de fase.
 */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && timerActivo !== null) {
      tick();
      programarAlarmaFase();
    }
  });
}

export {
  hayTimerActivo,
  obtenerTimerActivo,
  segundosTranscurridos,
  tiempoDeFase,
  iniciarTimerEstudio,
  detenerTimerEstudio,
  pausarTimerEstudio,
  reanudarTimerEstudio,
  saltarDescansoPomodoro,
  iniciarDescansoPomodoro,
  timerEstaPausado,
  cambiarTimerEstudio,
  suscribirseATimer,
  formatearDuracion,
  revisarSesionOlvidadaAlAbrir,
  revisarFelicitacionMeta,
};
