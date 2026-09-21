/* =========================================================================
   TIEMPO — Celebración de resultados de Competencias (2026-09-17, Parte 3)
   -------------------------------------------------------------------------
   Tres cosas, en este orden de disparo:

     1) AVISO (punto 3.3) — un banner corto y discreto arriba de la lista de
        competencias: "Tenés un resultado nuevo de <competencia>, tocá para
        verlo (trae sonido)". NUNCA suena nada acá. Es el único punto de
        entrada a la pantalla completa, justamente para no sorprender a
        nadie con música en un mal momento (ni al abrir la app, ni en clase,
        ni en una reunión).

     2) CELEBRACIÓN (puntos 3.2 + el confeti/animación) — recién al tocar el
        aviso: overlay a pantalla completa, confeti (victoria) o lluvia
        apagada (derrota), animación de entrada de la tarjeta, y el audio.

     3) AUDIO CON CARGA SEGURA (punto 3.2) — `audio/ganador.mp3` y
        `audio/perdedor.mp3`, en la carpeta `audio/` de la raíz del repo. Si
        el archivo no existe, no carga, o el navegador bloquea la
        reproducción, la celebración se muestra IGUAL, sin sonido y sin
        ningún mensaje de error: `reproducirAudioSeguro()` se traga todo.

   Cómo se detecta un resultado real: el Worker cierra la semana solo (cron
   por hora, anclado a la hora local del creador) y deja una fila en
   `historial_ganadores`. Este archivo pide `GET /competencias/:id/historial`,
   mira la entrada más reciente y la compara contra el último
   `semana_cerrada_en` que ESTE dispositivo ya mostró (localStorage, ver
   CLAVE_RESULTADO_VISTO). Si avanzó, hay resultado nuevo: victoria si el
   `participante_id` ganador es el propio, derrota si no.

   2026-09-21 (rediseño): el aviso ahora se pinta con el diseño del
   prototipo (medalla, "Quedaste 2.º · a 1 h 20 min de Iva"). Para saber
   el puesto se pide GET /competencias/:id/podios (podio completo); si el
   Worker no lo tiene o no hay datos de ESTE usuario en esa semana, se cae
   al aviso de siempre con /historial. La pantalla de celebración NO se
   tocó: sigue siendo lo que abre el aviso, y al cerrarla se puede abrir el
   podio de esa semana (gancho opcional `alCerrar`).

   El "ya lo vi" es local al dispositivo a propósito (mismo criterio que el
   snapshot del timer): que te avise en el celular y en la notebook no es un
   bug, es lo esperable — el resultado es el mismo.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";
// 2026-09-21 — Rediseño: el aviso con posición/podio lo dibuja el módulo visual
// (sin ciclos: ese módulo no importa nada de este proyecto).
import { construirAvisoPodio, resumenPosicion } from "./tiempo-estudio-competencias-visual.js";

const TIMEOUT_MS = 12000;
const CLAVE_RESULTADO_VISTO = "te_comp_resultado_visto_"; // + id de competencia
const RUTA_AUDIO_VICTORIA = "audio/ganador.mp3";
const RUTA_AUDIO_DERROTA = "audio/perdedor.mp3";

/**
 * INTERRUPTOR DE LOS BOTONES DE PRUEBA ("Simular victoria (prueba)" y
 * "Simular derrota (prueba)", arriba de la lista de competencias).
 *
 *   false → no aparecen (lo normal). Con esto apagado NO se puede encolar
 *           ningún resultado falso: la celebración solo sale de un cierre
 *           de semana real.
 *   true  → aparecen, para volver a ver o ajustar las animaciones sin
 *           esperar a que el Worker cierre una semana.
 *
 * Es lo ÚNICO que hay que tocar. tiempo-estudio-competencias.js sigue
 * llamando a `construirBotonesSimulacion()` siempre, y esa función decide
 * sola si dibuja algo (mismo criterio de "el módulo dueño de la
 * funcionalidad es el que decide si se muestra").
 */
const MOSTRAR_BOTONES_PRUEBA = true; // 2026-09-21: activados para probar el rediseño — volver a false al aprobarlo

/**
 * Resultados "de prueba" encolados por los botones de prueba (3.1). Viven
 * en memoria y a nivel de módulo (no en localStorage, no en estado.datos):
 * sobreviven a un re-render de la sección pero se van solos al recargar la
 * página, que es exactamente lo que se quiere de algo temporal de prueba.
 */
let resultadosDePrueba = [];

/** Mismo blindaje de timeout que fetchConTimeout de competencias.js — se
 * duplica acá (10 líneas) en vez de importarlo para no crear un ciclo
 * celebracion ↔ competencias, ya que competencias.js sí importa de acá. */
async function fetchConTimeout(url, opciones = {}) {
  const controlador = new AbortController();
  const idTimeout = setTimeout(() => controlador.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...opciones, signal: controlador.signal });
  } finally {
    clearTimeout(idTimeout);
  }
}

function formatearHorasCelebracion(horas) {
  const totalMin = Math.max(0, Math.round((Number(horas) || 0) * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/* ===================== "Ya vi este resultado" ===================== */

function leerResultadoVisto(competenciaId) {
  try {
    return Number(localStorage.getItem(CLAVE_RESULTADO_VISTO + competenciaId)) || 0;
  } catch (e) {
    return 0;
  }
}

function marcarResultadoVisto(competenciaId, semanaCerradaEn) {
  try {
    localStorage.setItem(CLAVE_RESULTADO_VISTO + competenciaId, String(semanaCerradaEn));
  } catch (e) {
    // localStorage bloqueado (modo privado agresivo) — a lo sumo el aviso
    // vuelve a aparecer la próxima vez. No vale la pena molestar con esto.
  }
}

/* ===================== Audio (punto 3.2) ===================== */

/**
 * Intenta reproducir `ruta`. Devuelve SIEMPRE un objeto con `detener()`,
 * aunque no haya sonado nada — así quien llama no tiene que preguntarse si
 * hubo audio o no.
 *
 * Todo puede fallar y todo está contemplado, en silencio:
 *   - el archivo no existe todavía (404)  → evento "error" del <audio>
 *   - el formato no lo soporta el equipo  → mismo evento
 *   - autoplay bloqueado por el navegador → la promesa de play() rechaza
 * En los 3 casos la celebración ya está en pantalla y se queda ahí; lo
 * único que falta es el sonido. Nunca se le muestra un error al usuario.
 */
function reproducirAudioSeguro(ruta) {
  let audio = null;
  try {
    audio = new Audio(ruta);
    audio.volume = 0.7;
    audio.addEventListener("error", () => {
      console.warn(`[celebracion] No se pudo cargar ${ruta} — la celebración sigue sin sonido.`);
    });
    const promesa = audio.play();
    if (promesa && typeof promesa.catch === "function") {
      promesa.catch((e) => {
        console.warn(`[celebracion] El navegador no dejó reproducir ${ruta}:`, e && e.name);
      });
    }
  } catch (e) {
    console.warn(`[celebracion] Falló el audio ${ruta} — la celebración sigue sin sonido:`, e);
    audio = null;
  }

  return {
    detener() {
      if (!audio) return;
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (e) {
        /* nada que hacer */
      }
    },
  };
}

/* ===================== Confeti / animación =====================
   Dos rutas, misma firma (`lanzarConfeti(contenedor, tipo)` → `{ detener }`):

     victoria → DOS CAÑONES 🎉 (uno en cada esquina de abajo). Guion:
                  1) entran deslizándose desde afuera de la pantalla, con
                     un pequeño rebote al llegar;
                  2) se AGITAN cada vez más fuerte (cargando);
                  3) ¡PUUUM! — retroceso del cañón, destello en la boca y el
                     confeti sale en abanico hacia el centro-arriba, en dos
                     tandas (una grande y una chica un instante después);
                  4) el confeti flota y cae; los cañones se retiran solos.
     derrota  → lluvia inclinada hacia la izquierda, bajo una neblina, que no para.

   Todo se dibuja en UN solo <canvas> que va DETRÁS de la tarjeta (el
   overlay lo agrega antes que la caja): cañones, destello y confeti quedan
   por debajo de ella.

   Por qué ya no se ve "un cuadrado" al empezar: antes las 140 piezas nacían
   en el mismo cuadro, en un mismo rectángulo y con velocidades parecidas.
   Ahora nacen en la BOCA del cañón, repartidas durante ~160 ms, cada una con
   su ángulo (abanico) y su velocidad (de lenta a muy rápida), y con
   resistencia del aire: salen disparadas, frenan en seco y flotan.
   La física usa tiempo real (dt), no "por cuadro": en una pantalla de
   120 Hz se ve igual que en una de 60 Hz. */

const COLORES_CONFETI = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];
const EMOJI_CANON = "🎉";
const FUENTE_EMOJI = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

// Guion de la victoria (ms desde que se abre la celebración).
const T_ENTRADA = 550; // los cañones se deslizan hasta su esquina
const T_AGITE = 800; // se agitan, cada vez más fuerte
const T_DISPARO = T_ENTRADA + T_AGITE; // ¡PUUUM!
const T_RETIRADA = T_DISPARO + 1800; // los cañones se van…
const T_RETIRADA_DUR = 500; // …en este tiempo
const T_TOTAL = T_DISPARO + 5000; // fin de todo (con fundido)
const T_FUNDIDO = 900;

// Física del confeti (por segundo). Velocidad final de caída = GRAVEDAD /
// ARRASTRE ≈ 250 px/s: cae flotando, no como piedra.
const ARRASTRE = 1.5;
const GRAVEDAD = 380;

function limitar(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

/** Se pasa un poquito y vuelve — da el "rebote" al llegar del cañón. */
function easeOutBack(x) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}

/**
 * Crea el <canvas> (a resolución real de pantalla, para que el emoji y el
 * confeti no se vean borrosos en pantallas de alta densidad) y devuelve lo
 * necesario para dibujar, o `null` si el navegador no tiene canvas (la
 * tarjeta se ve igual, solo sin confeti).
 */
function prepararCanvas(contenedor) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute; inset:0; width:100%; height:100%; pointer-events:none;";
  contenedor.appendChild(canvas);

  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return null;

  const tam = { ancho: 0, alto: 0 };
  function ajustarTamano() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    tam.ancho = contenedor.clientWidth || window.innerWidth;
    tam.alto = contenedor.clientHeight || window.innerHeight;
    canvas.width = Math.round(tam.ancho * dpr);
    canvas.height = Math.round(tam.alto * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // asignar width reinicia la transformación
  }
  ajustarTamano();
  window.addEventListener("resize", ajustarTamano);

  return { ctx, tam, quitarResize: () => window.removeEventListener("resize", ajustarTamano) };
}

/* ---------- Derrota: lluvia inclinada ---------- */

/**
 * Lluvia de verdad: rayitas azul-grisáceas que caen en diagonal hacia la
 * IZQUIERDA (como empujadas por el viento), bajo una neblina fría arriba.
 *
 *   - Dos "distancias" mezcladas: las lejanas son más cortas, lentas y
 *     tenues; las cercanas más largas, rápidas y nítidas. Eso da profundidad.
 *   - Velocidad constante por gota (≈290–520 px/s): rápida como lluvia, pero
 *     sin llegar a ser un chubasco. Ya no hay gravedad acumulativa (antes las
 *     piezas aceleraban cuanto más caían).
 *   - La cantidad sigue al tamaño de la pantalla (más pantalla, más gotas).
 *   - Tiempo real (`dt`): se ve igual en 60 Hz y en 120 Hz.
 *   - Entra con un fundido de 1,2 s y no termina hasta que se cierra el
 *     overlay (`detener()` corta el rAF desde afuera).
 */
function lanzarLluvia(contenedor) {
  const base = prepararCanvas(contenedor);
  if (!base) return { detener() {} };
  const { ctx, tam, quitarResize } = base;

  const INCLINACION = 0.3; // rad (~17°) desde la vertical, cayendo hacia la izquierda
  const tangente = Math.tan(INCLINACION);
  const FUNDIDO_ENTRADA_MS = 1200;

  // Las gotas nacen en una franja más ancha que la pantalla hacia la derecha:
  // como derivan a la izquierda, así la esquina de arriba-derecha no queda vacía.
  const anchoEmision = () => tam.ancho + tam.alto * tangente + 40;
  const cantidad = limitar(Math.round((tam.ancho * tam.alto) / 6000), 90, 320);

  function crearGota(alturaInicial) {
    const z = 0.55 + 0.45 * Math.random(); // 0.55 = lejana · 1 = cercana
    const vy = 520 * z;
    return {
      x: Math.random() * anchoEmision(),
      y: alturaInicial,
      vy,
      vx: -vy * tangente,
      largo: (18 + Math.random() * 14) * z,
      grosor: 0.9 + 0.9 * z,
      alfa: 0.22 + 0.38 * z,
    };
  }

  const gotas = [];
  for (let i = 0; i < cantidad; i++) gotas.push(crearGota(Math.random() * (tam.alto + 20) - 20));

  const inicio = Date.now();
  let ultimo = inicio;
  let rafId = null;
  let vivo = true;

  function cuadro() {
    if (!vivo) return;
    const ahora = Date.now();
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    ultimo = ahora;

    ctx.clearRect(0, 0, tam.ancho, tam.alto);
    ctx.globalAlpha = limitar((ahora - inicio) / FUNDIDO_ENTRADA_MS, 0, 1);

    // Neblina: un velo frío que se disuelve hacia abajo.
    const velo = ctx.createLinearGradient(0, 0, 0, tam.alto * 0.55);
    velo.addColorStop(0, "rgba(71,85,105,0.32)");
    velo.addColorStop(1, "rgba(71,85,105,0)");
    ctx.fillStyle = velo;
    ctx.fillRect(0, 0, tam.ancho, tam.alto * 0.55);

    ctx.lineCap = "round";
    gotas.forEach((g, i) => {
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      // Sale por abajo o por la izquierda → vuelve a nacer arriba.
      if (g.y - g.largo > tam.alto || g.x < -30) gotas[i] = crearGota(-g.largo - Math.random() * 60);

      // La rayita va a lo largo de la dirección de caída: la cola queda arriba a la derecha.
      const velocidad = Math.hypot(g.vx, g.vy);
      ctx.strokeStyle = `rgba(150,175,215,${g.alfa})`;
      ctx.lineWidth = g.grosor;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g.x - (g.vx / velocidad) * g.largo, g.y - (g.vy / velocidad) * g.largo);
      ctx.stroke();
    });
    ctx.globalAlpha = 1;
    rafId = requestAnimationFrame(cuadro);
  }
  rafId = requestAnimationFrame(cuadro);

  return {
    detener() {
      vivo = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      quitarResize();
    },
  };
}

/* ---------- Victoria: dos cañones 🎉 ---------- */

/**
 * Dónde está y cómo se ve un cañón en el instante `t` (ms). `lado` = 1 es el
 * de la izquierda (boca hacia arriba-derecha, el 🎉 tal cual), -1 el de la
 * derecha (el mismo emoji espejado). Cada cañón se gira para apuntar hacia
 * arriba del centro de la pantalla: en un celular angosto queda casi
 * vertical, en una pantalla ancha más tendido.
 */
function estadoCanon(lado, t, tam, s) {
  const margen = s * 0.45;
  const cx0 = lado > 0 ? margen + s / 2 : tam.ancho - margen - s / 2;
  const cy0 = tam.alto - margen - s / 2;

  const ejeNatural = lado > 0 ? -Math.PI / 4 : (-3 * Math.PI) / 4; // hacia dónde "mira" el emoji
  const apuntado = Math.atan2(tam.alto * 0.3 - cy0, tam.ancho / 2 - cx0);
  let rot = limitar(apuntado - ejeNatural, -0.45, 0.45);
  let dx = 0;
  let dy = 0;
  let escala = 1;
  let alfa = 1;

  // 1) Entrada: desliza desde afuera de la esquina y rebota un poco al llegar.
  const k = 1 - easeOutBack(limitar(t / T_ENTRADA, 0, 1)); // 1 → 0 (pasa a negativo un instante)
  dx = -lado * k * s * 1.6;
  dy = k * s * 3.2;

  if (t >= T_ENTRADA && t < T_DISPARO) {
    // 2) Agite: cada vez más fuerte, y se "hincha" un poco cargando. 7 ciclos
    //    exactos, así que termina justo en el ángulo de reposo (sin salto).
    const u = (t - T_ENTRADA) / T_AGITE;
    rot += (0.04 + 0.16 * u * u) * Math.sin(u * Math.PI * 2 * 7);
    dx += Math.sin(u * Math.PI * 2 * 11) * s * 0.03 * u;
    escala = 1 + 0.12 * u;
  } else if (t >= T_DISPARO) {
    // 3) Retroceso: un resorte que oscila hacia atrás sobre su propio eje y
    //    se asienta, más una patada de giro que se apaga.
    const tau = (t - T_DISPARO) / 1000;
    const amortiguado = Math.exp(-9 * tau);
    const retroceso = amortiguado * Math.cos(24 * tau);
    const ejeReal = ejeNatural + rot;
    dx -= Math.cos(ejeReal) * s * 0.34 * retroceso;
    dy -= Math.sin(ejeReal) * s * 0.34 * retroceso;
    rot -= lado * 0.18 * amortiguado * Math.sin(20 * tau);
    escala = 1 + 0.12 * Math.exp(-14 * tau);
  }

  // 4) Retirada: baja y se desvanece.
  if (t > T_RETIRADA) {
    const r = limitar((t - T_RETIRADA) / T_RETIRADA_DUR, 0, 1);
    alfa = 1 - r;
    dy += r * r * s * 2.5;
  }

  const x = cx0 + dx;
  const y = cy0 + dy;
  const eje = ejeNatural + rot; // hacia dónde apunta AHORA
  const boca = { x: x + Math.cos(eje) * s * 0.4, y: y + Math.sin(eje) * s * 0.4 };
  return { x, y, rot, escala, alfa, eje, boca };
}

function dibujarCanon(ctx, lado, e, s) {
  if (e.alfa <= 0) return;
  ctx.save();
  ctx.globalAlpha *= e.alfa;
  ctx.translate(e.x, e.y);
  ctx.rotate(e.rot);
  ctx.scale(lado * e.escala, e.escala); // lado = -1 espeja el emoji
  ctx.font = `${Math.round(s)}px ${FUENTE_EMOJI}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(EMOJI_CANON, 0, 0);
  ctx.restore();
}

/** Destello del disparo: un anillo que se expande y un resplandor cálido. */
function dibujarDestello(ctx, boca, tau, s) {
  const duracion = 0.35;
  if (tau < 0 || tau >= duracion) return;
  const p = tau / duracion;
  const salida = 1 - Math.pow(1 - p, 3);

  const radioBrillo = s * (0.3 + 1.5 * salida);
  const brillo = ctx.createRadialGradient(boca.x, boca.y, 0, boca.x, boca.y, radioBrillo);
  brillo.addColorStop(0, `rgba(255,236,170,${0.75 * (1 - p)})`);
  brillo.addColorStop(1, "rgba(255,200,80,0)");
  ctx.fillStyle = brillo;
  ctx.beginPath();
  ctx.arc(boca.x, boca.y, radioBrillo, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = `rgba(255,255,255,${0.5 * (1 - p)})`;
  ctx.lineWidth = 3 * (1 - p) + 0.5;
  ctx.beginPath();
  ctx.arc(boca.x, boca.y, s * (0.2 + 1.4 * salida), 0, Math.PI * 2);
  ctx.stroke();
}

function crearPiezaConfeti(boca, angulo, velocidad, escalaTam, avanceMs) {
  const azar = Math.random();
  const forma = azar < 0.5 ? "rect" : azar < 0.8 ? "tira" : "circulo";
  const p = {
    x: boca.x + (Math.random() - 0.5) * 6,
    y: boca.y + (Math.random() - 0.5) * 6,
    vx: Math.cos(angulo) * velocidad,
    vy: Math.sin(angulo) * velocidad,
    forma,
    ancho: (forma === "tira" ? 3 : 6 + Math.random() * 4) * escalaTam,
    alto: (forma === "tira" ? 12 + Math.random() * 6 : 9 + Math.random() * 5) * escalaTam,
    radio: (3 + Math.random() * 1.6) * escalaTam,
    giro: Math.random() * Math.PI * 2,
    velGiro: (Math.random() - 0.5) * 14,
    volteo: Math.random() * Math.PI * 2, // el "dar la vuelta" en 3D: achata y estira la pieza
    velVolteo: 5 + Math.random() * 9,
    swayFase: Math.random() * Math.PI * 2,
    swayFreq: 2 + Math.random() * 3,
    swayAmp: 30 + Math.random() * 50,
    color: COLORES_CONFETI[Math.floor(Math.random() * COLORES_CONFETI.length)],
  };
  // Las que nacen "a mitad de cuadro" ya avanzaron un poco: así la emisión es
  // un chorro continuo y no una tanda de piezas todas en la misma posición.
  const adelanto = (avanceMs / 1000) * Math.random();
  p.x += p.vx * adelanto;
  p.y += p.vy * adelanto;
  return p;
}

function lanzarCanones(contenedor) {
  const base = prepararCanvas(contenedor);
  if (!base) return { detener() {} };
  const { ctx, tam, quitarResize } = base;

  const lados = [1, -1];
  const piezas = [];
  // Tandas: cada una emite `total` piezas por cañón repartidas en `durMs`.
  const tandas = [
    { desde: T_DISPARO, durMs: 160, total: 95, abanico: 0.42, fuerza: 1 }, // el PUUUM
    { desde: T_DISPARO + 200, durMs: 120, total: 35, abanico: 0.6, fuerza: 0.6 }, // el "pop" de remate
  ].map((t) => ({ ...t, emitidas: { 1: 0, "-1": 0 } }));
  const destellos = {}; // boca de cada cañón en el instante del disparo

  const inicio = Date.now();
  let ultimo = inicio;
  let rafId = null;
  let vivo = true;

  function cuadro() {
    if (!vivo) return;
    const ahora = Date.now();
    const t = ahora - inicio;
    const dt = Math.min(0.05, (ahora - ultimo) / 1000);
    const dtMs = dt * 1000;
    ultimo = ahora;

    const s = limitar(tam.ancho * 0.09, 48, 96); // tamaño del cañón
    const escalaTam = limitar(Math.min(tam.ancho, tam.alto) / 700, 0.8, 1.3);

    ctx.clearRect(0, 0, tam.ancho, tam.alto);
    ctx.globalAlpha = limitar((T_TOTAL - t) / T_FUNDIDO, 0, 1);

    const estados = { 1: estadoCanon(1, t, tam, s), "-1": estadoCanon(-1, t, tam, s) };

    // --- Emisión ---
    tandas.forEach((tanda) => {
      if (t < tanda.desde) return;
      const avance = limitar((t - tanda.desde) / tanda.durMs, 0, 1);
      lados.forEach((lado) => {
        const debidas = Math.round(tanda.total * avance);
        const canon = estados[lado];
        const objetivoX = tam.ancho / 2;
        const objetivoY = tam.alto * 0.3;
        const distancia = Math.hypot(objetivoX - canon.boca.x, objetivoY - canon.boca.y);
        const vMax = distancia * ARRASTRE * 1.9 * tanda.fuerza;
        while (tanda.emitidas[lado] < debidas) {
          tanda.emitidas[lado] += 1;
          const desvio = Math.random() + Math.random() - 1; // triangular: más piezas al centro del abanico
          const velocidad = vMax * (0.28 + 0.72 * Math.pow(Math.random(), 0.65));
          piezas.push(crearPiezaConfeti(canon.boca, canon.eje + desvio * tanda.abanico, velocidad, escalaTam, dtMs));
        }
      });
    });

    // Guardar dónde estaba la boca justo al disparar, para el destello.
    if (t >= T_DISPARO && !destellos.listo) {
      lados.forEach((lado) => {
        destellos[lado] = { ...estados[lado].boca };
      });
      destellos.listo = true;
    }

    // --- Dibujo: cañones, destello y, encima, el confeti ---
    lados.forEach((lado) => dibujarCanon(ctx, lado, estados[lado], s));
    if (destellos.listo) lados.forEach((lado) => dibujarDestello(ctx, destellos[lado], (t - T_DISPARO) / 1000, s));

    const seg = t / 1000;
    const arrastre = Math.exp(-ARRASTRE * dt);
    for (let i = piezas.length - 1; i >= 0; i--) {
      const p = piezas[i];
      p.vx *= arrastre;
      p.vy = p.vy * arrastre + GRAVEDAD * dt;
      const lento = limitar(1 - Math.hypot(p.vx, p.vy) / 500, 0, 1); // el vaivén solo cuando ya flota
      p.x += (p.vx + Math.sin(seg * p.swayFreq + p.swayFase) * p.swayAmp * lento) * dt;
      p.y += p.vy * dt;
      p.giro += p.velGiro * dt;
      p.volteo += p.velVolteo * dt;

      if (p.y > tam.alto + 30) {
        piezas.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.scale(1, Math.cos(p.volteo));
      ctx.fillStyle = p.color;
      if (p.forma === "circulo") {
        ctx.beginPath();
        ctx.arc(0, 0, p.radio, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto);
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (t < T_TOTAL) rafId = requestAnimationFrame(cuadro);
    else ctx.clearRect(0, 0, tam.ancho, tam.alto);
  }
  rafId = requestAnimationFrame(cuadro);

  return {
    detener() {
      vivo = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      quitarResize();
    },
  };
}

/**
 * Punto de entrada. `tipo` "victoria" → cañones; cualquier otro → lluvia.
 * Devuelve `detener()` para cortar el requestAnimationFrame cuando se cierra
 * el overlay (si no, el rAF sigue vivo con el canvas ya removido).
 */
function lanzarConfeti(contenedor, tipo) {
  return tipo === "victoria" ? lanzarCanones(contenedor) : lanzarLluvia(contenedor);
}

/** Keyframes de la animación de entrada de la tarjeta — se inyectan una
 * sola vez (guard por id), mismo patrón que asegurarEstilosBotonesCompetencia
 * en tiempo-estudio-competencias.js. */
function asegurarEstilosCelebracion() {
  if (document.getElementById("te-estilos-celebracion")) return;
  const estilo = document.createElement("style");
  estilo.id = "te-estilos-celebracion";
  estilo.textContent = `
    @keyframes te-celebracion-entrada {
      0%   { opacity: 0; transform: scale(0.7) translateY(24px); }
      60%  { opacity: 1; transform: scale(1.04) translateY(0); }
      100% { opacity: 1; transform: scale(1) translateY(0); }
    }
    @keyframes te-celebracion-entrada-suave {
      0%   { opacity: 0; transform: translateY(16px); }
      100% { opacity: 1; transform: translateY(0); }
    }
    @keyframes te-celebracion-latido {
      0%, 100% { transform: scale(1); }
      50%      { transform: scale(1.12); }
    }
    .te-celebracion-caja {
      animation: te-celebracion-entrada 0.55s cubic-bezier(0.18, 0.89, 0.32, 1.28) both;
    }
    .te-celebracion-caja[data-tipo="derrota"] {
      animation: te-celebracion-entrada-suave 0.45s ease-out both;
    }
    .te-celebracion-emoji {
      font-size: 3.6rem;
      line-height: 1;
      animation: te-celebracion-latido 1.4s ease-in-out 0.5s 3;
    }
    .te-aviso-resultado {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border-radius: 12px;
      border: 1px solid var(--borde-sutil, rgba(255,255,255,0.14));
      background: var(--fondo-sutil, rgba(255,255,255,0.05));
      color: inherit;
      font: inherit;
      cursor: pointer;
      transition: background 0.15s ease, transform 0.1s ease;
    }
    .te-aviso-resultado:hover { background: var(--fondo-hover, rgba(255,255,255,0.1)); }
    .te-aviso-resultado:active { transform: scale(0.99); }
    .te-aviso-resultado-emoji { font-size: 1.5rem; line-height: 1; flex: none; }
  `;
  document.head.appendChild(estilo);
}

/* ===================== Pantalla de celebración ===================== */

/**
 * Overlay a pantalla completa con confeti + animación + audio. Se llama
 * SOLO desde el aviso (punto 3.3) o desde los botones de prueba (3.1) —
 * nunca automáticamente al abrir la app.
 *
 * `resultado`: { tipo, nombreCompetencia, apodoGanador, horas, esPrueba }
 * `alCerrar` (opcional, 2026-09-21): se llama al tocar "Listo", cuando la
 * pantalla ya se fue — el aviso lo usa para abrir el podio de esa semana.
 */
function mostrarCelebracionResultado(resultado, alCerrar) {
  asegurarEstilosCelebracion();
  const esVictoria = resultado.tipo === "victoria";

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:600; background:rgba(0,0,0,0.72); " +
    "display:flex; align-items:center; justify-content:center; padding:16px; overflow:hidden;";

  const confeti = lanzarConfeti(overlay, resultado.tipo);
  const audio = reproducirAudioSeguro(esVictoria ? RUTA_AUDIO_VICTORIA : RUTA_AUDIO_DERROTA);

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack te-celebracion-caja";
  caja.dataset.tipo = resultado.tipo;
  caja.style.cssText =
    "position:relative; max-width:380px; width:100%; gap:10px; text-align:center; padding:30px 22px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const detalleHoras =
    resultado.horas !== null && resultado.horas !== undefined
      ? `<p class="muted" style="margin:0; font-size:0.85rem;">${formatearHorasCelebracion(resultado.horas)} esa semana</p>`
      : "";

  caja.innerHTML = `
    ${resultado.esPrueba ? `<p class="muted" style="margin:0; font-size:0.72rem; text-transform:uppercase; letter-spacing:0.08em;">Vista de prueba</p>` : ""}
    <div class="te-celebracion-emoji">${esVictoria ? "🏆" : "💪"}</div>
    <h2 style="margin:0; font-size:1.35rem;">${esVictoria ? "¡Ganaste la semana!" : "Esta semana no se dio"}</h2>
    <p class="muted" style="margin:0; font-size:0.9rem;">${resultado.nombreCompetencia || "Competencia"}</p>
    ${
      esVictoria
        ? detalleHoras
        : `<p class="muted" style="margin:0; font-size:0.85rem;">Ganó ${resultado.apodoGanador || "otra persona"}${
            resultado.horas !== null && resultado.horas !== undefined
              ? ` con ${formatearHorasCelebracion(resultado.horas)}`
              : ""
          }. La semana que viene arrancan todos de cero.</p>`
    }
    <button type="button" class="btn btn-primary" id="te-celebracion-cerrar" style="width:100%; margin-top:8px;">Listo</button>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  function cerrar() {
    confeti.detener();
    audio.detener();
    overlay.remove();
    if (typeof alCerrar === "function") alCerrar();
  }
  // Pedido 2.2: tocar el fondo no cierra — solo el botón "Listo". (Además
  // acá evita que un toque al azar corte el audio a los 2 segundos.)
  caja.querySelector("#te-celebracion-cerrar").addEventListener("click", cerrar);
}

/* ===================== Botones de prueba (punto 3.1) ===================== */

/** Podio inventado para los avisos de prueba: en victoria el usuario queda 1.º,
 * en derrota 2.º. `prueba_yo` es el id que se le pasa al aviso como "yo". */
function podioDePrueba(tipo) {
  const yo = { participante_id: "prueba_yo", apodo: "Vos", horas: tipo === "victoria" ? 7.5 : 6.5, foto_url: null };
  const otro = { participante_id: "prueba_2", apodo: "Otra persona", horas: tipo === "victoria" ? 5.25 : 9.25, foto_url: null };
  const tercero = { participante_id: "prueba_3", apodo: "Tercero", horas: 2, foto_url: null };
  const lista = tipo === "victoria" ? [yo, otro, tercero] : [otro, yo, tercero];
  return {
    semana_cerrada_en: Date.now(),
    completa: true,
    resultados: lista.map((r, i) => ({ ...r, puesto: i + 1 })),
  };
}

/**
 * BOTONES DE PRUEBA — solo funciona con MOSTRAR_BOTONES_PRUEBA en true.
 *
 * Encola un resultado FALSO como si el Worker hubiera cerrado una semana.
 * Respeta el punto 3.3 igual que un resultado real: no abre la celebración
 * de una, deja el aviso arriba de la lista para que se toque cuando se
 * quiera (y así se prueba también el aviso, no solo el confeti).
 */
function simularResultado(tipo, nombreCompetencia) {
  if (!MOSTRAR_BOTONES_PRUEBA) return;
  resultadosDePrueba.push({
    id: `prueba_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tipo,
    nombreCompetencia: nombreCompetencia || "Competencia de prueba",
    apodoGanador: tipo === "victoria" ? "Vos" : "Otra persona",
    horas: tipo === "victoria" ? 7.5 : 9.25,
    esPrueba: true,
    // 2026-09-21: podio inventado para el aviso nuevo (yo = "prueba_yo").
    semanaCerradaEn: Date.now(),
    podio: podioDePrueba(tipo),
  });
}

/**
 * BOTONES DE PRUEBA — se dibujan solo con MOSTRAR_BOTONES_PRUEBA en true; con
 * false esta función no hace nada (quien la llama no tiene que enterarse).
 *
 * Los 2 botones en sí. Se marcan como prueba de 2 formas para que nadie los
 * confunda con funcionalidad real: estilo "outline" propio (no usa .btn del
 * resto de la app) y la etiqueta "(prueba)" en el texto.
 */
function construirBotonesSimulacion(cont, refrescar) {
  if (!MOSTRAR_BOTONES_PRUEBA) return;
  asegurarEstilosBotonesPrueba();

  const fila = document.createElement("div");
  fila.className = "te-fila-botones-prueba";

  [
    { tipo: "victoria", texto: "Simular victoria (prueba)" },
    { tipo: "derrota", texto: "Simular derrota (prueba)" },
  ].forEach(({ tipo, texto }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "te-btn-prueba";
    btn.textContent = texto;
    btn.addEventListener("click", () => {
      simularResultado(tipo, null);
      if (refrescar) refrescar();
    });
    fila.appendChild(btn);
  });

  cont.appendChild(fila);
}

/** BOTONES DE PRUEBA — estilos; solo se inyectan si el interruptor está en true. */
function asegurarEstilosBotonesPrueba() {
  if (document.getElementById("te-estilos-botones-prueba")) return;
  const estilo = document.createElement("style");
  estilo.id = "te-estilos-botones-prueba";
  estilo.textContent = `
    .te-fila-botones-prueba {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 10px;
    }
    .te-btn-prueba {
      flex: 1 1 auto;
      padding: 7px 10px;
      border-radius: 10px;
      border: 1px dashed rgba(245,158,11,0.75);
      background: transparent;
      color: inherit;
      font: inherit;
      font-size: 0.76rem;
      opacity: 0.85;
      cursor: pointer;
    }
    .te-btn-prueba:hover { background: rgba(245,158,11,0.12); }
  `;
  document.head.appendChild(estilo);
}

/* ===================== Avisos (punto 3.3) ===================== */

function construirAvisoResultado(resultado, alTocar) {
  asegurarEstilosCelebracion();
  const esVictoria = resultado.tipo === "victoria";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "te-aviso-resultado";
  btn.innerHTML = `
    <span class="te-aviso-resultado-emoji">${esVictoria ? "🏆" : "📬"}</span>
    <span style="flex:1; min-width:0;">
      <span style="display:block; font-weight:600; font-size:0.88rem;">
        Tenés un resultado nuevo de ${resultado.nombreCompetencia}${resultado.esPrueba ? " (prueba)" : ""}
      </span>
      <span class="muted" style="display:block; font-size:0.78rem;">Tocá para verlo — trae sonido</span>
    </span>
  `;
  btn.addEventListener("click", alTocar);
  return btn;
}

/**
 * Dibuja los avisos pendientes arriba de la lista de competencias. Llamado
 * desde `construirVistaCompetencias` (tiempo-estudio-competencias.js).
 *
 * Dos fuentes de avisos:
 *   - los de prueba (3.1), que ya están en memoria y se pintan sincrónicos;
 *   - los reales, que necesitan un GET /historial por competencia unida y
 *     por eso se agregan después, sin bloquear el render de la sección
 *     (mismo criterio que `cargarMarcadorEnTarjeta`).
 */
function construirAvisosResultados(cont, refrescar, abrirHistorial) {
  const caja = document.createElement("div");
  caja.className = "stack";
  caja.style.cssText = "gap:8px; margin-bottom:12px;";
  cont.appendChild(caja);

  resultadosDePrueba.forEach((resultado) => {
    const quitar = () => {
      resultadosDePrueba = resultadosDePrueba.filter((r) => r.id !== resultado.id);
    };
    const aviso = construirAvisoPodio(
      { podio: resultado.podio, yoId: "prueba_yo", nombreCompetencia: `${resultado.nombreCompetencia} (prueba)`, cta: "Ver resultado" },
      {
        alAbrir: () => {
          quitar();
          mostrarCelebracionResultado(resultado);
          if (refrescar) refrescar();
        },
        alDescartar: quitar,
      }
    );
    caja.appendChild(aviso || construirAvisoResultado(resultado, () => {
      quitar();
      mostrarCelebracionResultado(resultado);
      if (refrescar) refrescar();
    }));
  });

  cargarAvisosReales(caja, refrescar, abrirHistorial);
}

async function cargarAvisosReales(caja, refrescar, abrirHistorial) {
  const competencias = estado.datos.competencias_unidas || [];
  if (competencias.length === 0) return;

  await Promise.all(
    competencias.map(async (competencia) => {
      let resultado = null;
      try {
        resultado = await detectarResultadoNuevo(competencia);
      } catch (e) {
        // Sin conexión o Worker caído: no hay aviso y listo — la próxima
        // vez que se abra la sección se vuelve a intentar. Nada que
        // mostrarle al usuario por esto.
        console.warn(`[celebracion] No se pudo revisar el resultado de "${competencia.nombre}":`, e);
        return;
      }
      if (!resultado || !caja.isConnected) return;

      // Al tocar el aviso: se marca visto, se muestra la celebración de
      // siempre y, al cerrarla, se abre el podio de esa semana (si hay).
      const alAbrir = () => {
        marcarResultadoVisto(competencia.id, resultado.semanaCerradaEn);
        mostrarCelebracionResultado(
          resultado,
          resultado.podio && abrirHistorial ? () => abrirHistorial(competencia, resultado.semanaCerradaEn) : undefined
        );
        if (refrescar) refrescar();
      };

      // Aviso nuevo (con puesto y brecha) si hay podio; si no, el de siempre.
      const aviso = resultado.podio
        ? construirAvisoPodio(
            { podio: resultado.podio, yoId: competencia.participante_id, nombreCompetencia: competencia.nombre, cta: "Ver resultado" },
            {
              alAbrir,
              // Descartar = "ya lo vi" sin celebración ni sonido.
              alDescartar: () => marcarResultadoVisto(competencia.id, resultado.semanaCerradaEn),
            }
          )
        : null;
      caja.appendChild(aviso || construirAvisoResultado(resultado, alAbrir));
    })
  );
}

/**
 * `null` si no hay nada nuevo que avisar. Compara la semana cerrada más
 * reciente contra lo último que este dispositivo ya mostró.
 *
 * 2026-09-21: primero se intenta GET /podios (podio completo → puesto y
 * brecha para el aviso nuevo). Si el Worker no responde bien ahí, o el
 * usuario no figura en esa semana (se unió después), se usa el camino de
 * siempre con /historial (solo ganador) y el aviso clásico.
 */
async function detectarResultadoNuevo(competencia) {
  const yaVisto = leerResultadoVisto(competencia.id);

  let podioReciente = null;
  try {
    const rp = await fetchConTimeout(`${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/podios`);
    if (rp.ok) {
      const { podios } = await rp.json();
      if (podios && podios.length > 0) podioReciente = podios[0]; // el Worker ya ordena por semana DESC
    }
  } catch (e) {
    // se sigue con /historial
  }

  let ultima;
  let podio = null;
  if (podioReciente && podioReciente.resultados && podioReciente.resultados.length > 0) {
    const g = podioReciente.resultados[0];
    ultima = { semana_cerrada_en: podioReciente.semana_cerrada_en, participante_id: g.participante_id, apodo: g.apodo, horas: g.horas };
    // Solo sirve para el aviso nuevo si este usuario figura en esa semana.
    if (resumenPosicion(podioReciente, competencia.participante_id)) podio = podioReciente;
  } else {
    const respuesta = await fetchConTimeout(
      `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/historial`
    );
    if (!respuesta.ok) return null;
    const { historial } = await respuesta.json();
    if (!historial || historial.length === 0) return null;
    ultima = historial[0]; // El Worker ya devuelve ordenado por semana_cerrada_en DESC.
  }

  if (!(ultima.semana_cerrada_en > yaVisto)) return null;

  // Primera vez que este dispositivo mira esta competencia (yaVisto === 0)
  // y ya hay historial viejo: se sella sin avisar, para no disparar una
  // celebración de una semana de hace un mes solo por entrar desde un
  // teléfono nuevo.
  if (yaVisto === 0) {
    marcarResultadoVisto(competencia.id, ultima.semana_cerrada_en);
    return null;
  }

  const gane = ultima.participante_id === competencia.participante_id;
  return {
    id: `real_${competencia.id}_${ultima.semana_cerrada_en}`,
    tipo: gane ? "victoria" : "derrota",
    nombreCompetencia: competencia.nombre,
    apodoGanador: ultima.apodo,
    horas: ultima.horas,
    semanaCerradaEn: ultima.semana_cerrada_en,
    podio,
    esPrueba: false,
  };
}

export {
  mostrarCelebracionResultado,
  construirAvisosResultados,
  construirBotonesSimulacion,
  simularResultado,
  marcarResultadoVisto,
};
