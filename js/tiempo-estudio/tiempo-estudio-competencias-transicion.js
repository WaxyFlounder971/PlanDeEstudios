/* =========================================================================
   COMPETENCIAS — transición suave de la tarjeta (v3.28.0 C, COMP1)
   -------------------------------------------------------------------------
   Antes cada actualización (marcador que llega de la red, mensaje nuevo, vuelta
   a primer plano) llamaba a pintarTarjeta, que reconstruye TODA la tarjeta con
   innerHTML. Consecuencias que se veían:
     · si llegaba un dato mientras corría la animación de entrada del podio, la
       tarjeta se volvía a dibujar sin la clase .cp-anim y la animación se cortaba;
     · los mensajes (globos y líneas) aparecían o desaparecían de golpe y la
       tarjeta cambiaba de altura de un salto.
   Este módulo envuelve a pintarTarjeta (la del módulo visual no cambia):
     1. Si la entrada animada sigue en curso y solo llegan datos nuevos, espera a que
        termine y dibuja una sola vez con lo más reciente.
     2. Si no, antes de reemplazar el contenido deja una copia del anterior encima
        que se desvanece (opacidad) y anima la altura de la tarjeta hacia la nueva.
   Las acciones de la persona (cambiar vista, mostrar/ocultar mensajes, escribir el
   suyo) nunca se retrasan. Sin movimiento (prefers-reduced-motion o modo Optimizado)
   todo se dibuja al instante, como antes. No hay temporizadores permanentes.
   ========================================================================= */

import { pintarTarjeta as pintarTarjetaBase } from "./tiempo-estudio-competencias-visual.js";

const ENTRADA_BASE_MS = 3600; // la entrada animada del podio/filas dura menos que esto
const ENTRADA_POR_PERSONA_MS = 150;
const SUAVE_MS = 320;

function sinMovimiento() {
  const reducido = typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  const optimizado = typeof document !== "undefined" && document.documentElement?.getAttribute("data-rendimiento") === "reducido";
  return reducido || optimizado;
}

// ¿Cambian solo los datos (marcador, mensajes de otros) y no algo que la persona acaba de pedir?
function esSoloDatos(previo, o) {
  return Boolean(previo) && previo.estadoCuerpo === "ok" && o.estadoCuerpo === "ok"
    && previo.vista === o.vista && previo.mensajes === o.mensajes && previo.tieneMensaje === o.tieneMensaje;
}

function crearFantasma(tarjeta) {
  const cs = window.getComputedStyle(tarjeta);
  const f = document.createElement("div");
  f.className = "cp-fantasma";
  f.setAttribute("aria-hidden", "true");
  f.inert = true;
  f.style.padding = `${cs.paddingTop} ${cs.paddingRight} ${cs.paddingBottom} ${cs.paddingLeft}`;
  f.style.backgroundImage = cs.backgroundImage;
  f.style.backgroundColor = cs.backgroundColor;
  for (const hijo of tarjeta.children) if (!hijo.classList.contains("cp-fantasma")) f.append(hijo.cloneNode(true));
  return f;
}

function crearPintorTarjeta(pintarBase, deps = {}) {
  const ahora = deps.ahora || (() => performance.now());
  const programar = deps.programar || ((fn, ms) => setTimeout(fn, ms));
  const cancelar = deps.cancelar || ((id) => clearTimeout(id));
  const sinMov = deps.sinMovimiento || sinMovimiento;
  const entradaBase = deps.entradaBaseMs ?? ENTRADA_BASE_MS;
  const entradaPorPersona = deps.entradaPorPersonaMs ?? ENTRADA_POR_PERSONA_MS;

  const limpiarAlto = (tarjeta) => {
    if (tarjeta.__cpAltoId != null) { cancelar(tarjeta.__cpAltoId); tarjeta.__cpAltoId = null; }
    for (const p of ["height", "overflow", "transition", "box-sizing"]) tarjeta.style.removeProperty(p);
  };
  // Única animación que toca layout (altura), acotada a 320 ms y solo cuando el contenido cambia de alto.
  const animarAlto = (tarjeta, desde, hasta) => {
    tarjeta.style.boxSizing = "border-box";
    tarjeta.style.overflow = "hidden";
    tarjeta.style.height = `${desde}px`;
    void tarjeta.offsetHeight;
    tarjeta.style.transition = `height ${SUAVE_MS}ms cubic-bezier(.3,.8,.2,1)`;
    tarjeta.style.height = `${hasta}px`;
    tarjeta.__cpAltoId = programar(() => limpiarAlto(tarjeta), SUAVE_MS + 80);
  };

  function pintar(tarjeta, o, cb) {
    const previo = tarjeta.__cpUltimo || null;
    const t = ahora();

    // 1. Entrada animada en curso y solo llegan datos: se espera (gana el dato más reciente).
    if (!o.animar && tarjeta.isConnected && esSoloDatos(previo, o) && t < (tarjeta.__cpEntradaHasta || 0)) {
      tarjeta.__cpPendiente = { o, cb };
      if (tarjeta.__cpPendienteId == null) {
        tarjeta.__cpPendienteId = programar(() => {
          tarjeta.__cpPendienteId = null;
          const p = tarjeta.__cpPendiente;
          tarjeta.__cpPendiente = null;
          if (p && tarjeta.isConnected) pintar(tarjeta, p.o, p.cb);
        }, tarjeta.__cpEntradaHasta - t + 30);
      }
      return;
    }
    // Cualquier otro dibujo ya trae los datos más nuevos (salen del mismo estado): se descarta el pendiente.
    if (tarjeta.__cpPendienteId != null) { cancelar(tarjeta.__cpPendienteId); tarjeta.__cpPendienteId = null; }
    tarjeta.__cpPendiente = null;

    // 2. Cambio sin entrada animada: disolvencia del contenido anterior y altura suave.
    const suave = !o.animar && Boolean(previo) && previo.vista === o.vista && tarjeta.isConnected
      && Boolean(tarjeta.firstElementChild) && tarjeta.getClientRects().length > 0 && !sinMov();
    let alto0 = 0;
    let fantasma = null;
    if (suave) {
      limpiarAlto(tarjeta);
      alto0 = tarjeta.offsetHeight;
      fantasma = crearFantasma(tarjeta);
    }

    pintarBase(tarjeta, o, cb);
    tarjeta.__cpUltimo = { estadoCuerpo: o.estadoCuerpo, vista: o.vista, mensajes: o.mensajes, tieneMensaje: o.tieneMensaje };
    tarjeta.__cpEntradaHasta = o.animar ? ahora() + entradaBase + entradaPorPersona * (o.participantes ? o.participantes.length : 0) : 0;

    if (fantasma) {
      tarjeta.append(fantasma);
      const quitar = () => fantasma.remove();
      fantasma.addEventListener("animationend", quitar, { once: true });
      programar(quitar, SUAVE_MS + 150); // red de seguridad si el navegador no emite animationend
      const alto1 = tarjeta.offsetHeight;
      if (Math.abs(alto1 - alto0) > 2) animarAlto(tarjeta, alto0, alto1);
    }
  }
  return pintar;
}

const pintarTarjeta = crearPintorTarjeta(pintarTarjetaBase);

export { pintarTarjeta, crearPintorTarjeta };