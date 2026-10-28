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
      doc.head.innerHTML = `<title>Timer de estudio</title><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#11131b;color:#f5f4fb;font:14px system-ui}body{padding:10px}.card{height:100%;padding:14px;border:1px solid #ffffff20;border-radius:16px;background:#191a25;display:flex;flex-direction:column;justify-content:center;gap:11px}.row{display:flex;align-items:center;gap:10px;min-width:0}.dot{width:10px;height:10px;border-radius:50%;flex:none}.name{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}.time{font-size:1.45rem;font-weight:750;font-variant-numeric:tabular-nums}.state{color:#aaa;font-size:.8rem}.controls{display:flex;gap:8px}.controls button{flex:1;border:1px solid #ffffff22;border-radius:10px;padding:8px;background:#ffffff0d;color:inherit;font:inherit;cursor:pointer}.controls .stop{color:#ff8585}</style>`;
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
    const referenciaVisual = document.querySelector(".glass-panel, .glass-card") || document.body;
    const colores = getComputedStyle(referenciaVisual);
    tarjeta.style.background = colores.backgroundColor || "#191a25";
    tarjeta.style.color = getComputedStyle(document.body).color || "#f5f4fb";
    tarjeta.style.borderColor = colores.borderColor || "#ffffff20";
    doc.body.style.background = getComputedStyle(document.body).backgroundColor || "#11131b";
  };
  const pintarCanvasPiP = () => {
    if (!canvasPiP || !infoActual) return;
    const ctx = canvasPiP.getContext("2d"), w = canvasPiP.width, h = canvasPiP.height;
    ctx.fillStyle = "#11131b"; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = infoActual.color || "#8b72e8"; ctx.beginPath(); ctx.arc(26, h / 2, 8, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.font = "600 22px system-ui";
    ctx.fillText(String(infoActual.nombre || "Tiempo de estudio").slice(0, 32), 48, h / 2 - 15, w - 62);
    ctx.font = "700 36px system-ui"; ctx.fillText(String(infoActual.tiempo || "00:00"), 48, h / 2 + 25);
    if (infoActual.estado) { ctx.font = "15px system-ui"; ctx.fillStyle = "#bbb"; ctx.fillText(infoActual.estado, w - 100, h / 2 + 23, 90); }
  };
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
      canvas.width = 520; canvas.height = 180; video.muted = true; video.playsInline = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none"; document.body.append(video);
      canvasPiP = canvas; videoPiP = video;
      try {
        pintarCanvasPiP(); video.srcObject = canvas.captureStream(2); await video.play(); await video.requestPictureInPicture();
        intervaloPiP = setInterval(pintarCanvasPiP, 1000);
        video.addEventListener("leavepictureinpicture", () => { clearInterval(intervaloPiP); intervaloPiP = null; video.srcObject?.getTracks().forEach((t) => t.stop()); video.remove(); videoPiP = null; canvasPiP = null; }, { once: true });
      } catch (_) { video.srcObject?.getTracks().forEach((t) => t.stop()); video.remove(); videoPiP = null; canvasPiP = null; }
    }
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
  };
}

export { montarIndicadoresTimer, esColorHex };
