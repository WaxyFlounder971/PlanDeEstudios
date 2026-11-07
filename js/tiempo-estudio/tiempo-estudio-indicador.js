/* =========================================================================
   TIEMPO DE ESTUDIO — Indicador de sesión activa (rediseño 2026-09-19)
   -------------------------------------------------------------------------
   Reemplaza al badge fijo "⏱ IC-1010 · Cálculo I · 12:34" de la esquina
   inferior izquierda, que tapaba el perfil de la barra lateral y se veía
   como un parche. Ahora la MISMA información vive en el lugar que le toca a
   cada tamaño de pantalla (el CSS decide cuál se ve, ver design-system.css,
   sección "Tiempo de Estudio"):

     · >= 1500px  → tarjeta anclada al fondo de la columna derecha
                    (#timer-tarjeta-lateral, variante --lateral)
     · 900–1499px → tarjeta flotante abajo a la derecha, sobre el botón de
                    Enlaces rápidos (#badge-tiempo-estudio, variante
                    --flotante) — no hay columna derecha en ese rango
     · < 900px    → segunda línea bajo "App Académica" en la barra superior
                    (#timer-linea-topbar, variante --linea)

   Diseño: una lucecita que parpadea del COLOR DE LA MATERIA (el mismo que ya
   usa Horario/Agenda, ver obtenerColorMateria en tiempo-estudio.js), el
   nombre de la materia SIN código, y el tiempo. En pausa la luz se queda
   fija y se agrega "En pausa"; en un descanso de Pomodoro, "Descanso".

   Este archivo es DOM puro: no importa nada del resto de la app. Quién es la
   materia, su color y el texto del tiempo se los da tiempo-estudio.js por
   `resolverInfo` — así se puede probar con el CSS real sin levantar la app.
   ========================================================================= */

import { mostrarToast } from "../ui/componentes.js";

const COLOR_POR_DEFECTO = "var(--accent-1)";

function esColorHex(valor) {
  return typeof valor === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(valor.trim());
}

function crearSpan(clase, texto) {
  const s = document.createElement("span");
  s.className = clase;
  if (texto !== undefined) s.textContent = texto;
  return s;
}

/**
 * Arma la estructura interna de un indicador (idéntica en las 3 variantes;
 * lo que cambia entre ellas es solo el CSS). Devuelve las referencias que
 * después se actualizan cada segundo — así el tick solo toca `textContent`,
 * nunca reconstruye nodos.
 */
function construirContenidoIndicador(el) {
  el.classList.add("timer-indicador");
  el.textContent = "";

  const luz = crearSpan("timer-luz");
  luz.setAttribute("aria-hidden", "true");

  const materia = crearSpan("timer-materia");
  const separador = crearSpan("timer-sep", "·");
  separador.setAttribute("aria-hidden", "true");
  const tiempo = crearSpan("timer-tiempo");
  tiempo.setAttribute("aria-hidden", "true"); // cambia cada segundo: no se anuncia
  const estado = crearSpan("timer-estado");

  const fila = crearSpan("timer-fila-tiempo");
  fila.append(tiempo, estado);
  const textos = crearSpan("timer-textos");
  textos.append(materia, separador, fila);
  el.setAttribute("role", "button");
  el.setAttribute("tabindex", "0");
  const pip = document.createElement("button");
  pip.type = "button";
  pip.className = "timer-pip-boton";
  pip.textContent = "▣";
  pip.title = "Mantener timer siempre visible";
  pip.setAttribute("aria-label", pip.title);
  el.append(luz, textos, pip);
  return { materia, tiempo, estado, pip };
}

function actualizarTexto(nodo, texto) {
  if (nodo.textContent !== texto) nodo.textContent = texto;
}

function pintarUno(indicador, info) {
  const { el, refs, ultimo } = indicador;

  el.classList.remove("oculto");
  el.classList.toggle("timer-en-pausa", Boolean(info.pausado));

  const color = esColorHex(info.color) ? info.color.trim() : COLOR_POR_DEFECTO;
  if (ultimo.color !== color) {
    el.style.setProperty("--te-color", color);
    ultimo.color = color;
  }

  actualizarTexto(refs.materia, info.nombre);
  actualizarTexto(refs.tiempo, info.tiempo);
  actualizarTexto(refs.estado, info.estado || "");
  refs.estado.hidden = !info.estado;
  refs.pip.hidden = false;

  // Etiqueta accesible: solo cambia con la materia/estado, no cada segundo.
  const etiqueta = `Estudiando ${info.nombre}${info.estado ? `, ${info.estado.toLowerCase()}` : ""}. Abrir la materia`;
  if (ultimo.etiqueta !== etiqueta) {
    el.setAttribute("aria-label", etiqueta);
    el.title = "Ir a la materia para ver, pausar o detener la sesión";
    ultimo.etiqueta = etiqueta;
  }
}

/**
 * Conecta los elementos del indicador y devuelve la función `pintar(activo)`
 * que hay que pasarle a `suscribirseATimer`. Los elementos que no existan
 * en el HTML (`null`) se ignoran, así que el módulo tolera un index.html
 * viejo sin romper nada. Devuelve `null` si no encontró ninguno.
 *
 * @param {Object} opciones
 * @param {Array<HTMLElement|null>} opciones.elementos  los 3 contenedores
 * @param {(activo:Object)=>{nombre:string,color:string,tiempo:string,pausado:boolean,estado:string}} opciones.resolverInfo
 * @param {()=>void} opciones.alTocar  navegar al detalle de la materia
 */
function montarIndicadoresTimer({ elementos, resolverInfo, alTocar, alPip, alTogglePausa, alDetener }) {
  const indicadores = elementos
    .filter(Boolean)
    .map((el) => ({ el, refs: construirContenidoIndicador(el), ultimo: {} }));
  if (indicadores.length === 0) return null;

  indicadores.forEach(({ el }) => {
    el.addEventListener("click", (ev) => { if (!ev.target.closest(".timer-pip-boton")) alTocar(); });
    el.addEventListener("keydown", (ev) => {
      if ((ev.key === "Enter" || ev.key === " ") && !ev.target.closest(".timer-pip-boton")) { ev.preventDefault(); alTocar(); }
    });
    el.querySelector(".timer-pip-boton")?.addEventListener("click", (ev) => { ev.stopPropagation(); abrirPiP(); });
  });

  let infoActual = null;
  let ventanaPiP = null;
  let videoPiP = null;
  let canvasPiP = null;
  let intervaloPiP = null;
  const actualizarVentanaPiP = () => {
    if (!ventanaPiP || ventanaPiP.closed || !infoActual) return;
    const doc = ventanaPiP.document;
    let tarjeta = doc.getElementById("timer-pip-card");
    if (!tarjeta) {
      // v3.27.7: misma técnica que la ventana de Notas — se copian los estilos
      // reales de la app y el tema (atributos de <html>), en vez de colores propios.
      doc.title = "Timer de estudio";
      for (const nodo of document.head.querySelectorAll('link[rel="stylesheet"],style')) {
        const copia = doc.importNode(nodo, true);
        if (copia.tagName === "LINK") copia.href = nodo.href;
        doc.head.append(copia);
      }
      const estilo = doc.createElement("style");
      estilo.textContent = `*{box-sizing:border-box}html,body{margin:0;padding:0;width:100%;height:100%;min-height:0;overflow:hidden}body{padding:10px;background-attachment:fixed;font:14px var(--font-body,system-ui)}.card{height:100%;padding:14px;border:1px solid var(--border-glass,#ffffff20);border-radius:16px;background:var(--bg-header-solido,#191a25);color:var(--text-primary,#f5f4fb);display:flex;flex-direction:column;justify-content:center;gap:11px}.row{display:flex;align-items:center;gap:10px;min-width:0}.dot{width:10px;height:10px;border-radius:50%;flex:none}.name{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.time{font-size:1.45rem;font-weight:750;font-variant-numeric:tabular-nums}.state{color:var(--text-muted,#aaa);font-size:.8rem}.controls{display:flex;gap:8px}.controls button{flex:1;border:1px solid var(--border-glass,#ffffff22);border-radius:10px;padding:8px;background:var(--bg-panel,#ffffff0d);color:inherit;font:inherit;cursor:pointer}.controls .stop{color:var(--color-danger,#ff8585)}`;
      doc.head.append(estilo);
      tarjeta = doc.createElement("div"); tarjeta.id = "timer-pip-card"; tarjeta.className = "card";
      tarjeta.innerHTML = `<div class="row"><i class="dot"></i><span class="name"></span></div><div class="time"></div><div class="state"></div><div class="controls"><button class="pause"></button><button class="stop">Detener</button></div>`;
      tarjeta.querySelector(".pause").addEventListener("click", () => alTogglePausa?.());
      tarjeta.querySelector(".stop").addEventListener("click", () => alDetener?.());
      doc.body.replaceChildren(tarjeta);
    }
    tarjeta.querySelector(".dot").style.background = infoActual.color || "#8b72e8";
    tarjeta.querySelector(".name").textContent = infoActual.nombre || "Tiempo de estudio";
    tarjeta.querySelector(".time").textContent = infoActual.tiempo || "00:00";
    tarjeta.querySelector(".state").textContent = infoActual.estado || "Sesión activa";
    tarjeta.querySelector(".pause").textContent = infoActual.pausado ? "Reanudar" : "Pausar";
    // El tema (modo, paleta, tamaño de texto) vive en los atributos de <html>:
    // se copian en cada pintado para que un cambio de tema se vea sin reabrir.
    const origen = document.documentElement, destino = doc.documentElement;
    for (const { name, value } of [...origen.attributes]) if (destino.getAttribute(name) !== value) destino.setAttribute(name, value);
    for (const { name } of [...destino.attributes]) if (!origen.hasAttribute(name)) destino.removeAttribute(name);
  };
  // PATCH 6C (2026-11-06): ventana flotante de Android (PiP de video). El tamaño
  // lo decide el sistema, pero Android la estiraba (el canvas era 520x180, ~2.9:1,
  // fuera del rango que acepta) y el texto se veía deformado y enorme. Ahora el
  // canvas es 440x200 (2.2:1, dentro de 1:2.39 a 2.39:1, dibujado al doble de
  // resolución) con la estructura de la píldora de diseño: punto de color de la
  // materia, nombre pequeño arriba, tiempo grande debajo, estado a la derecha.
  // El canvas no entiende var(): se leen los tokens reales de la app (fondo del
  // header, textos, fuente) con respaldo, así sigue el tema claro/oscuro/paleta.
  const leerToken = (nombre, respaldo) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || respaldo;
  const pintarCanvasPiP = () => {
    if (!canvasPiP || !infoActual) return;
    const ctx = canvasPiP.getContext("2d"), w = 440, h = 200;
    const fuente = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = leerToken("--bg-header-solido", "#101114"); ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    // Punto de color de la materia (atenuado en pausa, igual que .timer-luz).
    ctx.globalAlpha = infoActual.pausado ? 0.5 : 1;
    ctx.fillStyle = infoActual.color || leerToken("--accent-1", "#8b72e8");
    ctx.beginPath(); ctx.arc(40, 56, 9, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = leerToken("--text-secondary", "#c9c9d4"); ctx.font = `600 24px ${fuente}`;
    ctx.fillText(String(infoActual.nombre || "Tiempo de estudio"), 62, 56, w - 62 - 28);
    // Tiempo grande con dígitos de ancho fijo (el canvas no tiene tabular-nums):
    // así no "baila" cada segundo. Si no cabe, se comprime en horizontal.
    ctx.fillStyle = leerToken("--text-primary", "#f5f4fb"); ctx.font = `700 64px ${fuente}`;
    const texto = String(infoActual.tiempo || "00:00");
    const ancho0 = ctx.measureText("0").width;
    const anchoDe = (c) => (/\d/.test(c) ? ancho0 : ctx.measureText(c).width);
    const total = [...texto].reduce((a, c) => a + anchoDe(c), 0);
    ctx.save();
    ctx.translate(40, 128); ctx.scale(Math.min(1, (infoActual.estado ? 250 : w - 56) / total), 1);
    let x = 0;
    for (const c of texto) { ctx.fillText(c, x + (anchoDe(c) - ctx.measureText(c).width) / 2, 0); x += anchoDe(c); }
    ctx.restore();
    if (infoActual.estado) {
      ctx.fillStyle = leerToken("--text-muted", "#9a9aa8"); ctx.font = `600 22px ${fuente}`; ctx.textAlign = "right";
      ctx.fillText(infoActual.estado, w - 28, 134, 130);
    }
  };
  // Respaldo: sin Document PiP ni PiP de video el timer sigue a la vista en la
  // propia app (indicador de la barra o tarjeta flotante); se avisa en vez de no hacer nada.
  const avisarSinPiP = () => mostrarToast("Tu navegador no permite la ventana flotante. El timer sigue visible en la app.");
  const abrirPiP = async () => {
    if (!infoActual) return;
    // En escritorio se usa una ventana Document PiP interactiva con controles.
    if (window.documentPictureInPicture?.requestWindow) {
      try {
        ventanaPiP = await window.documentPictureInPicture.requestWindow({ width: 300, height: 190, preferInitialWindowPlacement: true });
        ventanaPiP.addEventListener("pagehide", () => { ventanaPiP = null; }, { once: true });
        actualizarVentanaPiP();
        return;
      } catch (_) { ventanaPiP = null; }
    }
    // En móviles Android el PiP de video muestra el contador en vivo; los
    // controles permanecen en la app para no exponer controles de video falsos.
    if (document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream && HTMLVideoElement.prototype.requestPictureInPicture) {
      const video = document.createElement("video"), canvas = document.createElement("canvas");
      canvas.width = 880; canvas.height = 400; video.muted = true; video.playsInline = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none"; document.body.append(video);
      canvasPiP = canvas; videoPiP = video;
      try {
        pintarCanvasPiP(); video.srcObject = canvas.captureStream(2); await video.play(); await video.requestPictureInPicture();
        intervaloPiP = setInterval(pintarCanvasPiP, 1000);
        // Pausa/reanudar/detener desde los controles del propio PiP: reusan las mismas
        // callbacks (alTogglePausa/alDetener) del timer principal, no hay otro temporizador.
        if ("mediaSession" in navigator) {
          try {
            const ms = navigator.mediaSession;
            ms.metadata = new MediaMetadata({ title: infoActual.nombre || "Tiempo de estudio" });
            ms.playbackState = infoActual.pausado ? "paused" : "playing";
            ms.setActionHandler("pause", () => { if (!infoActual?.pausado) alTogglePausa?.(); });
            ms.setActionHandler("play", () => { if (infoActual?.pausado) alTogglePausa?.(); });
            ms.setActionHandler("stop", () => alDetener?.());
          } catch (_) { /* controles opcionales: sin ellos el PiP solo muestra el contador */ }
        }
        video.addEventListener("leavepictureinpicture", () => { clearInterval(intervaloPiP); intervaloPiP = null; if ("mediaSession" in navigator) { try { for (const a of ["pause", "play", "stop"]) navigator.mediaSession.setActionHandler(a, null); navigator.mediaSession.metadata = null; } catch (_) {} } video.srcObject?.getTracks().forEach((t) => t.stop()); video.remove(); videoPiP = null; canvasPiP = null; }, { once: true });
      } catch (_) { video.srcObject?.getTracks().forEach((t) => t.stop()); video.remove(); videoPiP = null; canvasPiP = null; avisarSinPiP(); }
      return;
    }
    avisarSinPiP();
  };

  return function pintar(activo) {
    if (!activo) {
      indicadores.forEach(({ el, ultimo }) => {
        el.classList.add("oculto");
        el.classList.remove("timer-en-pausa");
        ultimo.etiqueta = undefined;
      });
      infoActual = null;
      if (ventanaPiP && !ventanaPiP.closed) ventanaPiP.close();
      if (videoPiP && document.pictureInPictureElement === videoPiP) document.exitPictureInPicture().catch(() => {});
      return;
    }
    const info = resolverInfo(activo);
    infoActual = info;
    indicadores.forEach((indicador) => pintarUno(indicador, info));
    actualizarVentanaPiP();
    pintarCanvasPiP();
    if (videoPiP && "mediaSession" in navigator) navigator.mediaSession.playbackState = info.pausado ? "paused" : "playing";
  };
}

export { montarIndicadoresTimer, esColorHex };
