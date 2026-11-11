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
import { traducirTextoInterfaz } from "../core/i18n.js";

const COLOR_POR_DEFECTO = "var(--accent-1)";
const PIP_W = 440, PIP_H = 187;

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

  // PATCH 15: el botón redondo de la tarjeta flotante (si esta variante lo tiene) refleja color, pausa y tiempo extra.
  if (indicador.boton) {
    if (ultimo.colorBoton !== color) { indicador.boton.style.setProperty("--te-color", color); ultimo.colorBoton = color; }
    indicador.boton.classList.toggle("timer-en-pausa", Boolean(info.pausado));
    indicador.boton.classList.toggle("timer-extra", Boolean(info.extra));
  }

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
    .map((el) => ({ el, refs: construirContenidoIndicador(el), ultimo: {}, boton: null }));
  if (indicadores.length === 0) return null;

  // PATCH 15 (2026-11-07): tarjeta flotante plegable. Mantener ~500ms sobre la tarjeta (no sobre el botón ▣) la pliega a un
  // botón redondo con la luz de la materia; tocarlo la expande. Solo la variante --flotante (escritorio); la tarjeta lateral
  // y la línea de la barra superior no cambian. Reutiliza el patrón de long-press de las categorías del Plan (PATCH 4):
  // 500ms, se cancela si el puntero se mueve >10px, sin menú nativo ni selección, con feedback de escala (clase .timer-presionando).
  // El estado va ligado a la sesión del timer (sesionInicio): se recuerda en sessionStorage (con try/catch) y al detener el
  // timer y empezar otro (otra sesionInicio) la tarjeta vuelve expandida. No hay otro temporizador: lo pinta la misma suscripción.
  const CLAVE_TIMER_PLEGADO = "timer_flotante_plegado_v1";
  let activoActual = null;
  let sesionPlegada = null;
  try { sesionPlegada = Number(sessionStorage.getItem(CLAVE_TIMER_PLEGADO)) || null; } catch (_) { /* sin storage: solo en memoria */ }
  const aplicarPlegado = () => {
    const plegado = Boolean(activoActual) && sesionPlegada !== null && sesionPlegada === activoActual.sesionInicio;
    indicadores.forEach(({ el, boton }) => { if (boton) el.classList.toggle("timer-plegado", plegado); });
  };
  const fijarPlegado = (plegar) => {
    sesionPlegada = plegar && activoActual ? activoActual.sesionInicio : null;
    try {
      if (sesionPlegada !== null) sessionStorage.setItem(CLAVE_TIMER_PLEGADO, String(sesionPlegada));
      else sessionStorage.removeItem(CLAVE_TIMER_PLEGADO);
    } catch (_) { /* sin storage */ }
    aplicarPlegado();
  };
  indicadores.filter(({ el }) => el.classList.contains("timer-indicador--flotante")).forEach((indicador) => {
    const { el } = indicador;
    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "timer-plegado-boton";
    boton.setAttribute("role", "button");
    boton.title = "Mostrar timer";
    boton.setAttribute("aria-label", boton.title);
    const luz = crearSpan("timer-luz");
    luz.setAttribute("aria-hidden", "true");
    boton.append(luz);
    // <button> ya se activa con Enter/Espacio (dispara click). Si vino del teclado, el foco vuelve a la tarjeta.
    boton.addEventListener("click", (ev) => { fijarPlegado(false); if (ev.detail === 0) el.focus({ preventScroll: true }); });
    el.after(boton);
    indicador.boton = boton;

    let temporizador = null;
    let tipoPuntero = "mouse";
    let origenX = 0;
    let origenY = 0;
    let ultimoPliegue = -Infinity;
    const cancelar = () => {
      clearTimeout(temporizador);
      temporizador = null;
      el.classList.remove("timer-presionando");
    };
    el.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0 || ev.target.closest(".timer-pip-boton")) return;
      tipoPuntero = ev.pointerType || "mouse";
      origenX = ev.clientX;
      origenY = ev.clientY;
      el.classList.add("timer-presionando");
      clearTimeout(temporizador);
      temporizador = setTimeout(() => {
        temporizador = null;
        ultimoPliegue = performance.now();
        el.classList.remove("timer-presionando");
        fijarPlegado(true);
      }, 500);
    });
    el.addEventListener("pointermove", (ev) => {
      if (temporizador !== null && (Math.abs(ev.clientX - origenX) > 10 || Math.abs(ev.clientY - origenY) > 10)) cancelar();
    });
    el.addEventListener("pointerup", cancelar);
    el.addEventListener("pointerleave", cancelar);
    el.addEventListener("pointercancel", cancelar);
    // Sin menú nativo con el dedo (long-press táctil); el clic derecho del mouse conserva el suyo.
    el.addEventListener("contextmenu", (ev) => { if (tipoPuntero !== "mouse") ev.preventDefault(); });
    // Al soltar tras un long-press no debe contar como toque (alTocar navegaría a la materia). Se registra ANTES que el
    // listener de clic de más abajo, así que corta primero.
    el.addEventListener("click", (ev) => {
      if (performance.now() - ultimoPliegue < 800) { ev.stopImmediatePropagation(); ev.preventDefault(); }
    });
  });

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
  // PATCH 11 (2026-11-07): ventana Document PiP de escritorio rediseñada. La VENTANA es la tarjeta: sin fondo ni padding
  // detrás, sin degradado, sin esquinas redondeadas dentro de la ventana (la barra con candado y URL la dibuja el navegador
  // y no se puede quitar). Píldora horizontal: punto de color de la materia, nombre pequeño arriba (ellipsis), tiempo grande
  // en negrita debajo y a la derecha pausa/play (relleno) y detener (borde rojo), SOLO iconos con aria-label traducido.
  // El tiempo extra ("01:00 +00:25" + "Extra") se encoge de forma uniforme hasta caber: nunca desborda ni se corta.
  // La ventana es otro documento: el observador de i18n de la app no la alcanza, así que se traduce con traducirTextoInterfaz.
  const ICONOS_PIP = {
    pausa: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  };
  const CSS_PIP = `*{box-sizing:border-box}
html,body{margin:0!important;padding:0!important;width:100%;height:100%;min-height:0!important;overflow:hidden;background:var(--bg-header-solido,#191a25)!important;background-image:none!important;color:var(--text-primary,#f5f4fb);font:14px var(--font-body,system-ui,sans-serif)}
.pip-tarjeta{display:flex;align-items:center;gap:12px;width:100%;height:100%;padding:0 14px;background:color-mix(in srgb,var(--pip-color,#8b72e8) 13%,var(--bg-header-solido,#191a25));color:var(--text-primary,#f5f4fb);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--pip-color,#8b72e8) 42%,transparent)}
.pip-punto{flex:none;width:10px;height:10px;border-radius:50%;background:var(--pip-color,#8b72e8);box-shadow:0 0 8px 1px color-mix(in srgb,var(--pip-color,#8b72e8) 42%,transparent);animation:pip-luz 1.8s ease-in-out infinite}
.pip-tarjeta.pip-pausa .pip-punto{opacity:.5;box-shadow:none;animation:none}
@keyframes pip-luz{50%{box-shadow:0 0 12px 3px color-mix(in srgb,var(--pip-color,#8b72e8) 42%,transparent)}}
@media (prefers-reduced-motion:reduce){.pip-punto{animation:none}}
[data-rendimiento="reducido"] .pip-punto{animation:none}
.pip-info{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.pip-nombre{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:.8rem;font-weight:700;line-height:1.25;color:var(--text-primary,#f5f4fb)}
.pip-fila{display:flex;align-items:baseline;gap:8px;min-width:0;overflow:hidden;white-space:nowrap}
.pip-tiempo{font-size:30px;font-weight:800;line-height:1.1;letter-spacing:.01em;font-variant-numeric:tabular-nums}
.pip-extra{display:none;font-size:.78rem;font-weight:700;color:var(--color-danger,#ef4444);font-variant-numeric:tabular-nums}
.pip-extra.pip-extra-activo{display:inline}
.pip-estado{flex:none;font-size:.76rem;font-weight:600;color:var(--text-muted,#9a9aa8)}
.pip-estado.pip-estado-extra{color:var(--color-danger,#ef4444);font-variant-numeric:tabular-nums}
.pip-estado[hidden]{display:none}
.pip-controles{flex:none;display:flex;gap:8px}
.pip-controles button{display:grid;place-items:center;width:36px;height:36px;margin:0;padding:0;border-radius:10px;cursor:pointer;font:inherit;transition:background-color .15s ease,border-color .15s ease}
.pip-controles svg{width:19px;height:19px;fill:currentColor}
.pip-boton-pausa{border:1px solid color-mix(in srgb,var(--pip-color,#8b72e8) 42%,transparent);background:color-mix(in srgb,var(--pip-color,#8b72e8) 13%,transparent);color:var(--pip-color,#8b72e8)}
.pip-boton-stop{border:1px solid color-mix(in srgb,var(--color-danger,#f87171) 42%,transparent);background:color-mix(in srgb,var(--color-danger,#f87171) 10%,transparent);color:var(--color-danger,#f87171)}
.pip-controles button:hover{background:color-mix(in srgb,var(--pip-color,#8b72e8) 22%,transparent)}
.pip-controles .pip-boton-stop:hover{background:color-mix(in srgb,var(--color-danger,#f87171) 20%,transparent)}
.pip-controles button:focus-visible{outline:2px solid var(--text-primary,#fff);outline-offset:2px}`;
  const actualizarVentanaPiP = () => {
    if (!ventanaPiP || ventanaPiP.closed || !infoActual) return;
    const doc = ventanaPiP.document;
    let tarjeta = doc.getElementById("timer-pip-card");
    if (!tarjeta) {
      // v3.27.7: misma técnica que la ventana de Notas — se copian los estilos
      // reales de la app y el tema (atributos de <html>), en vez de colores propios.
      doc.title = traducirTextoInterfaz("Tiempo de estudio");
      for (const nodo of document.head.querySelectorAll('link[rel="stylesheet"],style')) {
        const copia = doc.importNode(nodo, true);
        if (copia.tagName === "LINK") copia.href = nodo.href;
        doc.head.append(copia);
      }
      const estilo = doc.createElement("style");
      estilo.textContent = CSS_PIP;
      doc.head.append(estilo);
      tarjeta = doc.createElement("div"); tarjeta.id = "timer-pip-card"; tarjeta.className = "pip-tarjeta";
      tarjeta.innerHTML = `<i class="pip-punto"></i><div class="pip-info"><span class="pip-nombre"></span><div class="pip-fila"><span class="pip-tiempo"></span><span class="pip-extra"></span><span class="pip-estado" hidden></span></div></div><div class="pip-controles"><button type="button" class="pip-boton-pausa"></button><button type="button" class="pip-boton-stop"></button></div>`;
      tarjeta.querySelector(".pip-boton-pausa").addEventListener("click", () => alTogglePausa?.());
      tarjeta.querySelector(".pip-boton-stop").addEventListener("click", () => alDetener?.());
      doc.body.replaceChildren(tarjeta);
      // Al cambiar el tamaño de la ventana, o cuando terminan de cargar los estilos copiados, se vuelve a medir.
      const remedir = () => { tarjeta._clave = ""; actualizarVentanaPiP(); };
      ventanaPiP.addEventListener("resize", remedir);
      setTimeout(remedir, 400);
    }
    const nombre = infoActual.nombre || traducirTextoInterfaz("Tiempo de estudio");
    const partesTiempo = String(infoActual.tiempo || "00:00").split(/\s+\+/);
    const extraTexto = partesTiempo.length > 1 ? `+${partesTiempo.slice(1).join("+")}` : "";
    const estadoTexto = infoActual.extra ? traducirTextoInterfaz("Extra") : infoActual.estado ? traducirTextoInterfaz(infoActual.estado) : "";
    const texto = (sel, valor) => { const n = tarjeta.querySelector(sel); if (n.textContent !== valor) n.textContent = valor; return n; };
    const colorPip = esColorHex(infoActual.color) ? infoActual.color.trim() : getComputedStyle(document.documentElement).getPropertyValue("--accent-1").trim() || "#8b72e8";
    tarjeta.style.setProperty("--pip-color", colorPip);
    tarjeta.classList.toggle("pip-pausa", Boolean(infoActual.pausado));
    texto(".pip-nombre", nombre);
    const tiempo = texto(".pip-tiempo", partesTiempo[0] || "00:00");
    const extra = texto(".pip-extra", extraTexto);
    extra.classList.toggle("pip-extra-activo", Boolean(extraTexto));
    const estado = texto(".pip-estado", estadoTexto);
    estado.classList.toggle("pip-estado-extra", Boolean(infoActual.extra));
    estado.hidden = !estadoTexto;
    // Pausa/play y detener: solo iconos; el nombre accesible cambia con el estado.
    const botonPausa = tarjeta.querySelector(".pip-boton-pausa"), botonStop = tarjeta.querySelector(".pip-boton-stop");
    const etiquetaPausa = traducirTextoInterfaz(infoActual.pausado ? "Reanudar" : "Pausar");
    if (botonPausa.getAttribute("aria-label") !== etiquetaPausa) {
      botonPausa.innerHTML = infoActual.pausado ? ICONOS_PIP.play : ICONOS_PIP.pausa;
      botonPausa.setAttribute("aria-label", etiquetaPausa); botonPausa.title = etiquetaPausa;
    }
    if (!botonStop.firstChild) {
      const etiquetaStop = traducirTextoInterfaz("Detener");
      botonStop.innerHTML = ICONOS_PIP.stop; botonStop.setAttribute("aria-label", etiquetaStop); botonStop.title = etiquetaStop;
    }
    // Ajuste del tiempo: baja el tamaño de letra (uniforme, sin estirar) hasta que la fila quepa. Solo se vuelve a medir
    // cuando cambia el largo del texto, el estado o el ancho de la ventana (los dígitos son de ancho fijo).
    const clave = `${tiempo.textContent.length}|${extraTexto.length}|${estadoTexto}|${ventanaPiP.innerWidth}`;
    if (tarjeta._clave !== clave) {
      tarjeta._clave = clave;
      const fila = tarjeta.querySelector(".pip-fila");
      let px = 30;
      tiempo.style.fontSize = `${px}px`;
      while (px > 15 && fila.scrollWidth > fila.clientWidth) { px -= 1; tiempo.style.fontSize = `${px}px`; }
    }
    // El tema (modo, paleta, tamaño de texto) vive en los atributos de <html>:
    // se copian en cada pintado para que un cambio de tema se vea sin reabrir.
    const origen = document.documentElement, destino = doc.documentElement;
    for (const { name, value } of [...origen.attributes]) if (destino.getAttribute(name) !== value) destino.setAttribute(name, value);
    for (const { name } of [...destino.attributes]) if (!origen.hasAttribute(name)) destino.removeAttribute(name);
  };
  // PATCH 6C (2026-11-06): ventana flotante de Android (PiP de video). El tamaño
  // lo decide el sistema, pero Android la estiraba (el canvas era 520x180, ~2.9:1,
  // fuera del rango que acepta) y el texto se veía deformado y enorme. Ahora el
  // canvas ahora es 440x187 (2.35:1, dentro de 1:2.39 a 2.39:1, dibujado al doble de
  // resolución) con la estructura de la píldora de diseño: punto de color de la
  // materia, nombre pequeño arriba, tiempo grande debajo, estado a la derecha.
  // El canvas no entiende var(): se leen los tokens reales de la app (fondo del
  // header, textos, fuente) con respaldo, así sigue el tema claro/oscuro/paleta.
  const leerToken = (nombre, respaldo) => getComputedStyle(document.documentElement).getPropertyValue(nombre).trim() || respaldo;
  const pintarCanvasPiP = () => {
    if (!canvasPiP || !infoActual) return;
    // C4 (v3.28.0): el lienzo mide siempre PIP_W×PIP_H (440×187; 2.35:1, dentro del rango Android) y se
    // dibuja a 2x. Antes el texto salía deformado: fillText(..., maxWidth) lo ESTIRA/aplasta en horizontal cuando no cabe, y el
    // tiempo extra se comprimía con scale(x,1). Ahora nada se deforma: lo largo se recorta con "…" (nombre) o se achica de forma
    // UNIFORME (tiempo y estado) hasta caber, así "01:00 +00:25" y "Extra" siempre entran.
    const ctx = canvasPiP.getContext("2d"), w = PIP_W, h = PIP_H;
    const fuente = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const colorMateria = esColorHex(infoActual.color) ? infoActual.color.trim() : "#8b72e8";
    const hex = colorMateria.replace("#", "");
    const rgb = hex.length === 3 ? [...hex].map((x) => parseInt(x + x, 16)) : [0,2,4].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const tinte = `rgba(${rgb.join(",")},0.13)`;
    ctx.fillStyle = leerToken("--bg-header-solido", "#101114"); ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = tinte; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = `rgba(${rgb.join(",")},0.42)`; ctx.lineWidth = 1; ctx.strokeRect(.5,.5,w-1,h-1);
    ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const poner = (peso, px) => { ctx.font = `${peso} ${px}px ${fuente}`; };
    const recortar = (texto, maxAncho) => {
      if (ctx.measureText(texto).width <= maxAncho) return texto;
      let t = texto;
      while (t.length > 1 && ctx.measureText(`${t}…`).width > maxAncho) t = t.slice(0, -1);
      return `${t.trimEnd()}…`;
    };
    // Mayor tamaño (≤ px) con el que `texto` cabe en maxAncho, sin bajar de minPx.
    const tamanoQueCabe = (texto, peso, px, maxAncho, minPx) => {
      poner(peso, px);
      const ancho = ctx.measureText(texto).width;
      return ancho <= maxAncho ? px : Math.max(minPx, Math.floor((px * maxAncho) / ancho));
    };
    // Punto de color de la materia (atenuado en pausa, igual que .timer-luz).
    ctx.globalAlpha = infoActual.pausado ? 0.5 : 1;
    ctx.fillStyle = colorMateria;
    ctx.beginPath(); ctx.arc(40, 56, 13, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(40, 56, 5, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = leerToken("--text-primary", "#f5f4fb"); poner(700, 22);
    ctx.fillText(recortar(String(infoActual.nombre || "Tiempo de estudio"), w - 62 - 28), 62, 56);
    // Estado a la derecha ("En pausa", "Descanso", "Extra"): se achica hasta caber en 140px y reserva ese ancho al tiempo.
    let anchoEstado = 0;
    const estado = infoActual.extra ? traducirTextoInterfaz("Extra") : infoActual.estado ? traducirTextoInterfaz(infoActual.estado) : "";
    if (estado) {
      const px = tamanoQueCabe(estado, 600, 22, 140, 15);
      poner(600, px);
      const texto = recortar(estado, 140);
      anchoEstado = ctx.measureText(texto).width;
      ctx.fillStyle = infoActual.extra ? leerToken("--color-danger", "#ef4444") : leerToken("--text-muted", "#9a9aa8"); ctx.textAlign = "right";
      ctx.fillText(texto, w - 28, 134);
      ctx.textAlign = "left";
    }
    // Tiempo grande con dígitos de ancho fijo (el canvas no tiene tabular-nums): así no "baila" cada segundo.
    const partesTiempoCanvas = String(infoActual.tiempo || "00:00").split(/\s+\+/);
    const texto = partesTiempoCanvas[0];
    const extraCanvas = partesTiempoCanvas.length > 1 ? `+${partesTiempoCanvas.slice(1).join("+")}` : "";
    poner(700, 22); const anchoExtra = extraCanvas ? ctx.measureText(extraCanvas).width + 8 : 0;
    const disponible = w - 40 - 28 - anchoExtra - (estado ? anchoEstado + 16 : 0);
    const medir = (px) => {
      poner(700, px);
      const ancho0 = ctx.measureText("0").width;
      const anchoDe = (c) => (/\d/.test(c) ? ancho0 : ctx.measureText(c).width);
      return { anchoDe, total: [...texto].reduce((a, c) => a + anchoDe(c), 0) };
    };
    let px = 64, m = medir(px);
    if (m.total > disponible) { px = Math.max(18, Math.floor((px * disponible) / m.total)); m = medir(px); }
    while (px > 18 && m.total > disponible) { px -= 1; m = medir(px); }
    ctx.fillStyle = leerToken("--text-primary", "#f5f4fb");
    let x = 40;
    for (const c of texto) { ctx.fillText(c, x + (m.anchoDe(c) - ctx.measureText(c).width) / 2, 128); x += m.anchoDe(c); }
    if (extraCanvas) { poner(700, 22); ctx.fillStyle = leerToken("--color-danger", "#ef4444"); ctx.fillText(extraCanvas, x + 8, 128); }
  };
  // Respaldo: sin Document PiP ni PiP de video el timer sigue a la vista en la
  // propia app (indicador de la barra o tarjeta flotante); se avisa en vez de no hacer nada.
  const avisarSinPiP = () => mostrarToast("Tu navegador no permite la ventana flotante. El timer sigue visible en la app.");
  const abrirPiP = async () => {
    if (!infoActual) return;
    // En escritorio se usa una ventana Document PiP interactiva con controles.
    if (window.documentPictureInPicture?.requestWindow) {
      try {
        // PATCH 11: ventana compacta (la píldora ocupa toda la ventana). Si ya hay una abierta solo se refresca:
        // pedir otra mientras existe una lanza error en Chrome.
        if (ventanaPiP && !ventanaPiP.closed) { actualizarVentanaPiP(); return; }
        ventanaPiP = await window.documentPictureInPicture.requestWindow({ width: 380, height: 96, preferInitialWindowPlacement: true });
        ventanaPiP.addEventListener("pagehide", () => { ventanaPiP = null; }, { once: true });
        actualizarVentanaPiP();
        return;
      } catch (_) { ventanaPiP = null; }
    }
    // En móviles Android el PiP de video muestra el contador en vivo; los
    // controles permanecen en la app para no exponer controles de video falsos.
    if (document.pictureInPictureEnabled && HTMLCanvasElement.prototype.captureStream && HTMLVideoElement.prototype.requestPictureInPicture) {
      const video = document.createElement("video"), canvas = document.createElement("canvas");
      canvas.width = PIP_W * 2; canvas.height = PIP_H * 2; video.muted = true; video.playsInline = true;
      video.style.cssText = "position:fixed;width:1px;height:1px;opacity:.01;pointer-events:none"; document.body.append(video);
      canvasPiP = canvas; videoPiP = video;
      try {
        pintarCanvasPiP(); video.srcObject = canvas.captureStream(2); await video.play();
        const ventanaVideoPiP = await video.requestPictureInPicture();
        if (new URLSearchParams(location.search).get("diag") === "pip") {
          const reportar = () => mostrarToast(`PiP ${video.videoWidth}×${video.videoHeight} → ventana ${ventanaVideoPiP.width}×${ventanaVideoPiP.height}`);
          reportar(); ventanaVideoPiP.addEventListener("resize", reportar);
          video.addEventListener("leavepictureinpicture", () => { ventanaVideoPiP.removeEventListener("resize", reportar); mostrarToast("Diagnóstico PiP finalizado."); }, { once: true });
        }
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
      activoActual = null;
      if (ventanaPiP && !ventanaPiP.closed) ventanaPiP.close();
      if (videoPiP && document.pictureInPictureElement === videoPiP) document.exitPictureInPicture().catch(() => {});
      return;
    }
    const info = resolverInfo(activo);
    infoActual = info;
    activoActual = activo;
    aplicarPlegado();
    indicadores.forEach((indicador) => pintarUno(indicador, info));
    actualizarVentanaPiP();
    pintarCanvasPiP();
    if (videoPiP && "mediaSession" in navigator) navigator.mediaSession.playbackState = info.pausado ? "paused" : "playing";
  };
}

export { montarIndicadoresTimer, esColorHex };
