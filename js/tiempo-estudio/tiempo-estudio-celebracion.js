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

   El "ya lo vi" es local al dispositivo a propósito (mismo criterio que el
   snapshot del timer): que te avise en el celular y en la notebook no es un
   bug, es lo esperable — el resultado es el mismo.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { URL_WORKER_OAUTH } from "../core/auth.js";

const TIMEOUT_MS = 12000;
const CLAVE_RESULTADO_VISTO = "te_comp_resultado_visto_"; // + id de competencia
const RUTA_AUDIO_VICTORIA = "audio/ganador.mp3";
const RUTA_AUDIO_DERROTA = "audio/perdedor.mp3";

/**
 * Resultados "de prueba" encolados por los botones temporales de 3.1. Viven
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

/* ===================== Confeti / animación ===================== */

const COLORES_CONFETI = ["#f59e0b", "#ef4444", "#22c55e", "#3b82f6", "#a855f7", "#ec4899"];

/**
 * Confeti en un <canvas> a pantalla completa, sin ninguna librería — misma
 * política que el resto del proyecto (las gráficas de Estadísticas también
 * son SVG a mano). `tipo` cambia el carácter de la animación:
 *   victoria → estallido hacia arriba, colores vivos, mucha rotación
 *   derrota  → caída lenta y apagada, gris/azul, sin estallido
 *
 * Devuelve `detener()` para cortar el requestAnimationFrame cuando se
 * cierra el overlay (si no, el rAF sigue vivo con el canvas ya removido).
 */
function lanzarConfeti(contenedor, tipo) {
  const canvas = document.createElement("canvas");
  canvas.style.cssText = "position:absolute; inset:0; width:100%; height:100%; pointer-events:none;";
  contenedor.appendChild(canvas);

  const ctx = canvas.getContext && canvas.getContext("2d");
  if (!ctx) return { detener() {} }; // navegador sin canvas: la tarjeta se ve igual

  function ajustarTamano() {
    canvas.width = contenedor.clientWidth || window.innerWidth;
    canvas.height = contenedor.clientHeight || window.innerHeight;
  }
  ajustarTamano();
  window.addEventListener("resize", ajustarTamano);

  const esVictoria = tipo === "victoria";
  const cantidad = esVictoria ? 140 : 70;
  const particulas = [];
  for (let i = 0; i < cantidad; i++) {
    particulas.push(
      esVictoria
        ? {
            x: canvas.width / 2 + (Math.random() - 0.5) * canvas.width * 0.4,
            y: canvas.height * 0.55,
            vx: (Math.random() - 0.5) * 9,
            vy: -Math.random() * 13 - 4,
            ancho: 6 + Math.random() * 6,
            alto: 8 + Math.random() * 8,
            giro: Math.random() * Math.PI,
            velGiro: (Math.random() - 0.5) * 0.3,
            color: COLORES_CONFETI[i % COLORES_CONFETI.length],
          }
        : {
            x: Math.random() * canvas.width,
            y: -Math.random() * canvas.height,
            vx: (Math.random() - 0.5) * 0.6,
            vy: 1 + Math.random() * 1.6,
            ancho: 3 + Math.random() * 3,
            alto: 3 + Math.random() * 3,
            giro: Math.random() * Math.PI,
            velGiro: (Math.random() - 0.5) * 0.05,
            color: "rgba(148,163,184,0.55)",
          }
    );
  }

  const gravedad = esVictoria ? 0.32 : 0.02;
  const inicio = Date.now();
  const duracionMs = esVictoria ? 5000 : 7000;
  let rafId = null;
  let vivo = true;

  function cuadro() {
    if (!vivo) return;
    const transcurrido = Date.now() - inicio;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Se desvanece al final en vez de cortarse de golpe.
    ctx.globalAlpha = Math.max(0, Math.min(1, (duracionMs - transcurrido) / 900));

    particulas.forEach((p) => {
      p.vy += gravedad;
      p.x += p.vx;
      p.y += p.vy;
      p.giro += p.velGiro;
      // La lluvia de derrota da la vuelta por arriba: cae sin parar.
      if (!esVictoria && p.y > canvas.height) {
        p.y = -10;
        p.x = Math.random() * canvas.width;
        p.vy = 1 + Math.random() * 1.6;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.giro);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.ancho / 2, -p.alto / 2, p.ancho, p.alto);
      ctx.restore();
    });

    if (transcurrido < duracionMs) rafId = requestAnimationFrame(cuadro);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  rafId = requestAnimationFrame(cuadro);

  return {
    detener() {
      vivo = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", ajustarTamano);
    },
  };
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
 */
function mostrarCelebracionResultado(resultado) {
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
  }
  // Pedido 2.2: tocar el fondo no cierra — solo el botón "Listo". (Además
  // acá evita que un toque al azar corte el audio a los 2 segundos.)
  caja.querySelector("#te-celebracion-cerrar").addEventListener("click", cerrar);
}

/* ===================== Botones de prueba (punto 3.1) ===================== */

/**
 * BOTÓN TEMPORAL DE PRUEBA - remover cuando el diseño de celebración esté aprobado
 *
 * Encola un resultado FALSO como si el Worker hubiera cerrado una semana.
 * Respeta el punto 3.3 igual que un resultado real: no abre la celebración
 * de una, deja el aviso arriba de la lista para que se toque cuando se
 * quiera (y así se prueba también el aviso, no solo el confeti).
 */
function simularResultado(tipo, nombreCompetencia) {
  resultadosDePrueba.push({
    id: `prueba_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    tipo,
    nombreCompetencia: nombreCompetencia || "Competencia de prueba",
    apodoGanador: tipo === "victoria" ? "Vos" : "Otra persona",
    horas: tipo === "victoria" ? 7.5 : 9.25,
    esPrueba: true,
  });
}

/**
 * BOTÓN TEMPORAL DE PRUEBA - remover cuando el diseño de celebración esté aprobado
 *
 * Los 2 botones en sí. Se marcan como prueba de 3 formas para que nadie los
 * confunda con funcionalidad real: estilo "outline" propio (no usa .btn del
 * resto de la app), la etiqueta "(prueba)" en el texto, y este comentario.
 */
function construirBotonesSimulacion(cont, refrescar) {
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

/** BOTÓN TEMPORAL DE PRUEBA - remover cuando el diseño de celebración esté aprobado */
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
function construirAvisosResultados(cont, refrescar) {
  const caja = document.createElement("div");
  caja.className = "stack";
  caja.style.cssText = "gap:8px; margin-bottom:12px;";
  cont.appendChild(caja);

  resultadosDePrueba.forEach((resultado) => {
    caja.appendChild(
      construirAvisoResultado(resultado, () => {
        resultadosDePrueba = resultadosDePrueba.filter((r) => r.id !== resultado.id);
        mostrarCelebracionResultado(resultado);
        if (refrescar) refrescar();
      })
    );
  });

  cargarAvisosReales(caja, refrescar);
}

async function cargarAvisosReales(caja, refrescar) {
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

      caja.appendChild(
        construirAvisoResultado(resultado, () => {
          marcarResultadoVisto(competencia.id, resultado.semanaCerradaEn);
          mostrarCelebracionResultado(resultado);
          if (refrescar) refrescar();
        })
      );
    })
  );
}

/**
 * `null` si no hay nada nuevo que avisar. Compara la entrada más reciente
 * de `historial_ganadores` contra lo último que este dispositivo ya mostró.
 */
async function detectarResultadoNuevo(competencia) {
  const respuesta = await fetchConTimeout(
    `${URL_WORKER_OAUTH}/competencias/${encodeURIComponent(competencia.id)}/historial`
  );
  if (!respuesta.ok) return null;
  const { historial } = await respuesta.json();
  if (!historial || historial.length === 0) return null;

  // El Worker ya devuelve ordenado por semana_cerrada_en DESC.
  const ultima = historial[0];
  const yaVisto = leerResultadoVisto(competencia.id);
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
