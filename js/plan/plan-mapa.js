/* =========================================================================
   PLAN DE ESTUDIOS — MAPA INTERACTIVO (Ajuste 3, v8/v9-B.3)
   Tarjeta "Vista" (switch Lista/Mapa), columnas por bloque + Optativas,
   coloreo por Simbología/Categoría, zoom, camino de desbloqueo con efecto
   neón, y exportación a PNG.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, hexARgba } from "../core/utils.js";
import { abrirModalRequisito } from "./plan-detalle.js";
import { abrirModalResolverConflicto, obtenerMateriasQueDesbloquea } from "./plan-vista-lista-tarjetas.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

// V1.x: el botón de pantalla completa usaba emoji "🗗" (RESTORE DOWN,
// U+1F5D7) para el estado "activo" — ese carácter no está en la fuente de
// emoji de muchos teléfonos (Android sobre todo) y se ve como un cuadrado
// de "carácter desconocido". Se reemplaza por dos íconos SVG propios
// (trazo, sin depender de ninguna fuente de emoji) — iguales en cualquier
// dispositivo. "⛶" (entrar) se mantenía porque ese sí es un carácter
// tipográfico normal (U+26F6, no emoji) con buen soporte, pero para que
// ambos estados luzcan consistentes se pasan los dos a SVG.
const SVG_PANTALLA_COMPLETA_ENTRAR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;">' +
  '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M16 3h3a2 2 0 0 1 2 2v3"/>' +
  '<path d="M8 21H5a2 2 0 0 1-2-2v-3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/></svg>';
const SVG_PANTALLA_COMPLETA_SALIR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;">' +
  '<path d="M9 3v4a2 2 0 0 1-2 2H3"/><path d="M15 3v4a2 2 0 0 0 2 2h4"/>' +
  '<path d="M9 21v-4a2 2 0 0 0-2-2H3"/><path d="M15 21v-4a2 2 0 0 1 2-2h4"/></svg>';
// V1.x: chevrón ⌃/⌄ del bloque de controles — antes era un glyph de texto
// ("⌃"/"⌄", font-size 0.95rem) que no se alineaba bien con los íconos SVG
// de al lado (quedaba visualmente más abajo, distinto tamaño de línea). Se
// pasa a SVG con el MISMO viewBox/tamaño/trazo que el ícono de pantalla
// completa para que ambos queden centrados a la misma altura.
const SVG_CHEVRON_ARRIBA =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;">' +
  '<path d="M18 15l-6-6-6 6"/></svg>';
const SVG_CHEVRON_ABAJO =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;">' +
  '<path d="M6 9l6 6 6-6"/></svg>';
// V1.x: "girar pantalla" usaba el emoji "🔄" (se ve distinto en cada
// dispositivo/fuente y no combina con el trazo fino de los otros dos
// íconos). Se reemplaza por un ícono SVG de flecha circular, mismo estilo
// (trazo, sin relleno) y mismo tamaño que los demás.
const SVG_GIRAR =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" style="display:block;">' +
  '<path d="M3 12a9 9 0 0 1 15.3-6.5L21 8"/><path d="M21 3v5h-5"/>' +
  '<path d="M21 12a9 9 0 0 1-15.3 6.5L3 16"/><path d="M3 21v-5h5"/></svg>';

/* ---- B.3 (v8/v9): Vista de Mapa interactivo del Plan de Estudios ---- */
estado.vistaPlanEstudios = "lista";        // "lista" | "mapa"
estado.colorMapaPor = "simbologia";        // "simbologia" (por Estado) | "categoria"
estado.zoomMapa = 1;                       // 0.5 a 2
estado.materiaSeleccionadaMapa = null;     // código de la materia con camino de desbloqueo dibujado
estado._refsMapaActual = null;             // referencias DOM del mapa ya renderizado (para zoom/recolorear sin re-render completo)
// V10: cómo se dibuja el camino de desbloqueo — "libre" (curva Bézier, como
// siempre) o "recta" (tramos ortogonales rectos a través del gap entre bloques).
estado.trazadoMapaPor = "libre";           // "libre" | "recta"
// V1.10: tamaño horizontal de cada tarjeta del mapa.
estado.tamanioTarjetaMapa = "normal";      // "compacto" | "normal" | "extendido"
// V1.10: tema SOLO del interior de las tarjetas (independiente del tema
// general de la app). null = todavía no se ha elegido, se usa el modo
// actual de la app como punto de partida.
estado.temaTarjetaMapa = null;             // "clara" | "oscura" | null
// V1.x: pantalla completa nativa (Fullscreen API) sobre la tarjeta "Vista"
// completa (no solo el mapa) — así los controles de color/tamaño/tema/zoom
// siguen accesibles adentro. Se sincroniza con el estado REAL del navegador
// vía el listener de "fullscreenchange" de abajo (única fuente de verdad:
// nunca se asume `true` solo porque se llamó a requestFullscreen, porque esa
// llamada es async y puede fallar o ser cancelada por el usuario con Esc).
estado.mapaPantallaCompleta = false;
// V1.x (rediseño 2 — sin duplicado): un solo bloque de controles, siempre
// el mismo nodo del DOM, tanto adentro como afuera de pantalla completa.
// La fila 4 (⛶ / ⌃⌄ / 🔄 / Zoom) queda SIEMPRE visible pase lo que pase.
// Lo único que se puede ocultar son las filas 2 y 3 (colorear, trazado,
// tamaño, tema) — y solo mediante el chevrón ⌃/⌄ de la fila 4, que a su vez
// SOLO existe/funciona mientras estado.mapaPantallaCompleta es true (pedido
// explícito original: "el exterior no debe tener eso"). Este flag es el
// estado de visibilidad de esas filas 2/3.
// V1.x (rediseño 3): dentro de pantalla completa, "Descargar" ya NO queda
// fijo/siempre visible — se ata a este mismo flag, así que solo aparece
// mientras las filas 2/3 están extendidas (chevrón ⌃). Afuera de pantalla
// completa este flag nunca se activa, así que Descargar sigue siempre
// visible ahí (sin cambios).
estado.controlesMapaOcultosFullscreen = false;

/** Referencias vivas del ÚNICO bloque de controles (se reasignan en cada
 *  construirTarjetaVista()). El listener de fullscreenchange (registrado
 *  UNA sola vez a nivel de módulo, no por render) las usa para reflejar el
 *  estado real sin tener que re-renderizar nada. */
let btnPantallaCompletaRef = null;
let btnGirarRef = null;
let btnChevronRef = null;
let btnDescargarRef = null;
let contFilasSuperioresRef = null;
// V1.x: encabezado "Vista" + switch Lista/Mapa — se oculta por completo
// SOLO dentro de pantalla completa (afuera siempre visible, sin cambios).
let encabezadoRef = null;

// Tarjeta y plan actuales — necesarios para el handler de ⛶ (requestFullscreen
// apunta siempre a la tarjeta real, no a un nodo desconectado).
let cardRef = null;
let planActualRef = null;

/**
 * El bloque de controles expone, tras construirse, un `refrescar()` que
 * actualiza IN PLACE (sin reconstruir nodos) qué pill está `.active` y qué
 * dice la etiqueta de zoom, según el estado ACTUAL de `estado`. Se guarda
 * acá la función vigente del render actual.
 */
let refrescarRef = null;

function sincronizarControlesMapa() {
  if (refrescarRef) refrescarRef();
}

/** V1.x: `renderizarPlanEstudios()` reconstruye la tarjeta "Vista" entera
 *  desde cero (nodo nuevo) — como el nodo en pantalla completa queda
 *  desconectado del documento al reemplazarlo, el navegador sale de
 *  pantalla completa automáticamente (evento fullscreenchange). Para que
 *  cambios como "Tamaño" o "Tarjeta clara/oscura" (que SÍ necesitan
 *  reconstrucción completa) no boten al usuario afuera, se detecta si se
 *  estaba en pantalla completa ANTES del re-render y, de ser así, se
 *  vuelve a pedir pantalla completa sobre la tarjeta NUEVA de inmediato —
 *  todo dentro del mismo click, así el navegador lo sigue permitiendo sin
 *  pedir un nuevo gesto del usuario. Puede verse un parpadeo brevísimo
 *  (sale y re-entra), pero el usuario nunca queda afuera. */
function renderizarPlanEstudiosPreservandoFullscreen() {
  const estabaEnPantallaCompleta = estado.mapaPantallaCompleta;
  renderizarPlanEstudios();
  if (estabaEnPantallaCompleta && cardRef && cardRef.requestFullscreen) {
    cardRef.requestFullscreen().catch((err) => {
      console.error("No se pudo mantener pantalla completa tras el cambio:", err);
    });
  }
}

function actualizarControlesPantallaCompleta() {
  const activo = estado.mapaPantallaCompleta;

  if (btnPantallaCompletaRef && btnPantallaCompletaRef.isConnected) {
    btnPantallaCompletaRef.innerHTML = activo ? SVG_PANTALLA_COMPLETA_SALIR : SVG_PANTALLA_COMPLETA_ENTRAR;
    btnPantallaCompletaRef.setAttribute("aria-label", activo ? "Salir de pantalla completa" : "Ver el mapa en pantalla completa");
  }
  // V1.x: girar pantalla — solo tiene sentido (y la Screen Orientation API
  // solo lo permite) mientras se está en pantalla completa.
  if (btnGirarRef && btnGirarRef.isConnected) {
    btnGirarRef.style.display = activo ? "" : "none";
  }
  // V1.x (rediseño 2): el chevrón ⌃/⌄ (oculta/muestra colorear, trazado,
  // tamaño y tema) solo existe mientras se está en pantalla completa.
  if (btnChevronRef && btnChevronRef.isConnected) {
    btnChevronRef.style.display = activo ? "" : "none";
  }
  // V1.x (rediseño 3): al ENTRAR a pantalla completa, "Descargar" arranca
  // visible solo si las filas 2/3 están extendidas (chevrón ⌃, es decir
  // controlesMapaOcultosFullscreen === false). Afuera de pantalla completa
  // siempre visible (ver el bloque `if (!activo)` más abajo, que lo fuerza).
  if (btnDescargarRef && btnDescargarRef.isConnected) {
    btnDescargarRef.style.display = activo && estado.controlesMapaOcultosFullscreen ? "none" : "";
  }
  // V1.x: encabezado "Vista"/switch Lista-Mapa — se esconde solo dentro de
  // pantalla completa (pedido explícito), afuera siempre visible.
  if (encabezadoRef && encabezadoRef.isConnected) {
    encabezadoRef.style.display = activo ? "none" : "";
  }
  // V1.x: dentro de pantalla completa, si el contenido de la tarjeta (mapa
  // + controles) es más alto que la pantalla, antes quedaba recortado sin
  // forma de verlo — se habilita scroll vertical de la tarjeta mientras
  // está en pantalla completa (se quita al salir, para no afectar el
  // layout normal fuera de fullscreen).
  if (cardRef && cardRef.isConnected) {
    cardRef.style.overflowY = activo ? "auto" : "";
    cardRef.style.maxHeight = activo ? "100vh" : "";
  }
  // Al SALIR de pantalla completa, se fuerza todo visible de nuevo — afuera
  // nunca queda nada oculto (pedido explícito original).
  if (!activo) {
    estado.controlesMapaOcultosFullscreen = false;
    if (contFilasSuperioresRef) contFilasSuperioresRef.style.display = "";
    if (btnChevronRef) {
      btnChevronRef.innerHTML = SVG_CHEVRON_ARRIBA;
      btnChevronRef.setAttribute("aria-label", "Ocultar controles del mapa");
    }
    if (btnDescargarRef) btnDescargarRef.style.display = "";
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("fullscreenchange", () => {
    estado.mapaPantallaCompleta = !!document.fullscreenElement;
    actualizarControlesPantallaCompleta();
  });
}

/* ===================== B.3 (v8/v9) — Vista de Mapa interactivo ===================== */

/** Colores fijos de los 5 estados de Simbología (mismos que usan los badges). */

const COLOR_ESTADO_MAPA = {
  pendiente: "#94a3b8",
  cursando: "#f59e0b",
  aprobado: "#10b981",
  reprobado: "#ef4444",
  retirado: "#a855f7", // reservado: el esquema actual no tiene este 5º estado todavía
};

/** Tarjeta "Vista" — switch Lista/Mapa; en modo Mapa se expande con el mapa completo. */

/** Construye un pill-group de selección exclusiva. Los pill-item de estos
 *  grupos NUNCA truncan su texto (ver .pill-group-vista en el CSS): si no
 *  caben a tamaño legible, el propio grupo se vuelve scrolleable en vez de
 *  cortar las letras.
 *
 *  V1.x: cada pill se marca con `dataset.valor` — la función de refresco
 *  de cada bloque (ver construirBloqueControles) necesita, dado el valor
 *  actual en `estado`, encontrar y marcar `.active` la pill correcta sin
 *  reconstruir nada, y ese dataset es la forma más simple de identificarlas. */
function construirPillGroupVista(opciones, valorActual, onSeleccionar) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group pill-group-vista";
  opciones.forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valorActual === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.dataset.valor = op.valor;
    btn.addEventListener("click", () => onSeleccionar(op.valor, btn, grupo));
    grupo.appendChild(btn);
  });
  return grupo;
}

/** Repinta un pill-group ya construido para que `.active` quede en la pill
 *  cuyo dataset.valor coincide con `valorActivo` — usado por el refresco
 *  in-place de cada bloque de controles. */
function refrescarPillGroupVista(grupo, valorActivo) {
  grupo.querySelectorAll(".pill-item").forEach((p) => {
    p.classList.toggle("active", p.dataset.valor === String(valorActivo));
  });
}

/**
 * V1.x (rediseño 2 — sin duplicado): construye el ÚNICO bloque de
 * controles — filas 2 (colorear/trazado) y 3 (tamaño/tema), agrupadas en un
 * contenedor ocultable, más la fila 4 (descargar / ⛶ / ⌃⌄ / 🔄 / zoom) que
 * queda SIEMPRE visible, sin importar pantalla completa ni el estado del
 * chevrón.
 *
 * El chevrón ⌃/⌄ vive DENTRO de la fila 4 (entre ⛶ y 🔄) y solo se muestra
 * mientras estado.mapaPantallaCompleta es true — ver
 * actualizarControlesPantallaCompleta(), que lo oculta/reaparece y fuerza
 * las filas 2/3 visibles de nuevo al salir de pantalla completa.
 *
 * Devuelve { raiz, refrescar, btnPantallaCompleta, btnGirar, btnChevron,
 * contFilasSuperiores }:
 * - raiz: nodo a insertar en el DOM.
 * - refrescar(): actualiza in-place qué pill está activa y qué dice el
 *   zoom, según el estado ACTUAL.
 * - btnPantallaCompleta/btnGirar/btnChevron/contFilasSuperiores: refs para
 *   que actualizarControlesPantallaCompleta() los mantenga al día.
 */
function construirBloqueControles(plan) {
  const raiz = document.createElement("div");
  raiz.className = "stack";
  raiz.style.cssText = "gap:0;";

  // Filas 2 y 3: lo único que el chevrón puede ocultar. Fila 4 (más abajo)
  // se agrega directo a `raiz`, fuera de este contenedor, para que nunca
  // se oculte junto con ellas.
  const contFilasSuperiores = document.createElement("div");
  contFilasSuperiores.className = "stack";
  contFilasSuperiores.style.cssText = "gap:0;";
  if (estado.controlesMapaOcultosFullscreen) contFilasSuperiores.style.display = "none";

  /* ---- Línea 2: Colorear por (izq.) | Líneas libres/rectas (der.) ---- */
  const fila2 = document.createElement("div");
  fila2.className = "vista-fila";

  const switchColor = construirPillGroupVista(
    [
      { valor: "simbologia", texto: "Colorear por Simbología" },
      { valor: "categoria", texto: "Colorear por Categoría" },
    ],
    estado.colorMapaPor,
    (valor) => {
      if (estado.colorMapaPor === valor) return;
      estado.colorMapaPor = valor;
      recolorearNodosMapa(plan);
      sincronizarControlesMapa();
    }
  );
  fila2.appendChild(switchColor);

  // V10: switch de trazado del camino — líneas libres (curva) o rectas
  // (tramos ortogonales por el centro del gap entre bloques).
  const switchTrazado = construirPillGroupVista(
    [
      { valor: "libre", texto: "Líneas libres" },
      { valor: "recta", texto: "Líneas rectas" },
    ],
    estado.trazadoMapaPor,
    (valor) => {
      if (estado.trazadoMapaPor === valor) return;
      estado.trazadoMapaPor = valor;
      dibujarCaminoDesbloqueo(plan);
      sincronizarControlesMapa();
    }
  );
  fila2.appendChild(switchTrazado);
  contFilasSuperiores.appendChild(fila2);

  /* ---- Línea 3: tamaño de tarjeta (izq.) | tema de tarjeta (der.) ---- */
  const fila3 = document.createElement("div");
  fila3.className = "vista-fila";

  // V1.10: tamaño horizontal de cada tarjeta del mapa. Cambia la
  // estructura interna en modo "extendido", así que se reconstruye TODO el
  // Plan de Estudios (no basta con recolorear/redibujar el camino) — eso
  // reconstruye esta tarjeta entera desde cero (ver construirTarjetaVista),
  // así que no hace falta sincronizar el otro bloque a mano acá: ambos
  // (exterior y duplicado, si sigue en pantalla completa) nacen de nuevo
  // ya al día.
  const switchTamanio = construirPillGroupVista(
    [
      { valor: "compacto", texto: "Compacto" },
      { valor: "normal", texto: "Normal" },
      { valor: "extendido", texto: "Extendido" },
    ],
    estado.tamanioTarjetaMapa,
    (valor) => {
      if (estado.tamanioTarjetaMapa === valor) return;
      estado.tamanioTarjetaMapa = valor;
      renderizarPlanEstudiosPreservandoFullscreen();
    }
  );
  fila3.appendChild(switchTamanio);

  // V1.10: tema SOLO del interior de las tarjetas. Si todavía no se ha
  // elegido, arranca igual al modo actual de la app (claro/oscuro).
  const temaTarjetaActual =
    estado.temaTarjetaMapa || (document.documentElement.dataset.mode === "light" ? "clara" : "oscura");
  const switchTemaTarjeta = construirPillGroupVista(
    [
      { valor: "clara", texto: "Tarjeta clara" },
      { valor: "oscura", texto: "Tarjeta oscura" },
    ],
    temaTarjetaActual,
    (valor) => {
      if (estado.temaTarjetaMapa === valor) return;
      estado.temaTarjetaMapa = valor;
      renderizarPlanEstudiosPreservandoFullscreen();
    }
  );
  fila3.appendChild(switchTemaTarjeta);
  contFilasSuperiores.appendChild(fila3);
  raiz.appendChild(contFilasSuperiores);

  /* ---- Línea 4: Zoom (izq.) | ⛶ / ⌃⌄ / 🔄 (centro, solo ícono) | Descargar (der.) ----
     Grid de 3 columnas (mismo truco que construirEncabezadoNotaFinal en
     semestres-tarjetas.js) en vez de space-between: con solo 3 ítems y
     anchos distintos, space-between NO centra de verdad el del medio. Como
     las columnas 1 y 3 son "1fr" cada una (reparten el espacio sobrante en
     PARTES IGUALES sin importar qué contengan, incluso si una queda vacía
     por display:none), la columna del medio queda SIEMPRE centrada de
     verdad — pedido explícito.
     Afuera de pantalla completa, Descargar SIEMPRE visible (sin cambios).
     Dentro de pantalla completa, Descargar sigue el mismo flag que las
     filas 2/3: solo aparece mientras esas filas están extendidas (chevrón
     ⌃) — ver btnChevron más abajo y actualizarControlesPantallaCompleta().
     Punto 1 (2026-08-07, corrección — el usuario se había confundido en el
     pedido anterior: el orden original real era Descargar a la izquierda,
     Zoom a la derecha, no al revés). Los botones se agregan al final de la
     función, en el orden descargar → centro → zoom, para que el grid los
     ubique en ese orden. */
  const fila4 = document.createElement("div");
  fila4.className = "vista-fila";
  // Ajuste (2026-08-07, pedido explícito): "1fr auto 1fr" no garantizaba
  // centrado real — en CSS Grid una columna "1fr" tiene un mínimo implícito
  // de "auto" (el ancho de su propio contenido), así que si Descargar (col
  // 1) y el grupo de Zoom (col 3) tienen contenidos de ancho distinto, las
  // dos columnas dejan de repartirse el espacio 50/50 y el grupo central
  // (salir pantalla completa + flecha + girar) se corre del centro real de
  // la fila. "minmax(0,1fr)" fuerza a que ambas columnas midan SIEMPRE lo
  // mismo (mínimo 0, no el ancho de su contenido), sin importar qué texto o
  // botones tengan adentro — así el centro queda matemáticamente centrado
  // y Zoom (justifySelf:end, col 3) queda siempre anclado al borde derecho
  // real de la fila, en cualquier estado (Descargar oculto o visible,
  // cualquier ancho de pantalla).
  fila4.style.cssText = "display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr); align-items:center; gap:8px;";

  const btnDescargar = document.createElement("button");
  btnDescargar.type = "button";
  btnDescargar.className = "btn btn-secondary";
  // FIX (2026-08-20): columna FIJA. Sin esto, al ocultar este botón con
  // display:none, CSS Grid saca el ítem de la lista de auto-placement y
  // renumera a los que quedan (el grupo central pasaba a ocupar la
  // columna 1 y el zoom la columna 2, dejando la columna 3 vacía) — todo
  // el bloque se corría a la izquierda. Fijar grid-column ancla cada
  // elemento a SU columna real pase lo que pase con sus hermanos: nunca
  // se mueven en el eje horizontal, solo pueden desaparecer/aparecer.
  btnDescargar.style.gridColumn = "1";
  btnDescargar.style.justifySelf = "start";
  btnDescargar.style.display = estado.mapaPantallaCompleta && estado.controlesMapaOcultosFullscreen ? "none" : "";
  btnDescargar.textContent = "Descargar";
  btnDescargar.addEventListener("click", () => abrirSelectorDescargaMapa());

  // V1.x (rediseño 2): pantalla completa, chevrón y girar — solo ícono, sin
  // fondo de botón, centrados entre Descargar y el zoom, EN ESTE ORDEN:
  // ⛶ (salir/entrar a pantalla completa) → ⌃⌄ (ocultar/mostrar
  // colorear/trazado/tamaño/tema) → 🔄 (girar). El chevrón y el girar solo
  // se muestran mientras se está en pantalla completa — ver
  // actualizarControlesPantallaCompleta(), que mantiene su
  // texto/visibilidad al día. V1.x (rediseño 3): el gap entre estos 3
  // íconos se define en la clase .mapa-controles-centro (design-system.css)
  // — 2px por defecto, y se duplica a 4px SOLO si hay ancho de pantalla de
  // sobra (media query), para no apretar el layout en celulares angostos.
  const contBotonesCentro = document.createElement("div");
  contBotonesCentro.className = "mapa-controles-centro";
  contBotonesCentro.style.gridColumn = "2"; // ver comentario de btnDescargar
  contBotonesCentro.style.justifySelf = "center";

  const btnPantallaCompleta = document.createElement("button");
  btnPantallaCompleta.type = "button";
  btnPantallaCompleta.className = "btn-icono-fantasma";
  btnPantallaCompleta.innerHTML = estado.mapaPantallaCompleta ? SVG_PANTALLA_COMPLETA_SALIR : SVG_PANTALLA_COMPLETA_ENTRAR;
  btnPantallaCompleta.setAttribute(
    "aria-label",
    estado.mapaPantallaCompleta ? "Salir de pantalla completa" : "Ver el mapa en pantalla completa"
  );
  btnPantallaCompleta.addEventListener("click", () => {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else if (cardRef && cardRef.requestFullscreen) {
      cardRef.requestFullscreen().catch((err) => {
        console.error("No se pudo activar pantalla completa:", err);
      });
    }
  });
  contBotonesCentro.appendChild(btnPantallaCompleta);

  // V1.x (rediseño 2): chevrón ⌃/⌄ — oculta/muestra las filas 2/3
  // (colorear, trazado, tamaño, tema). Solo existe visualmente mientras se
  // está en pantalla completa (display:none afuera); actualizarControles-
  // PantallaCompleta() lo muestra/oculta y, al salir, fuerza las filas de
  // vuelta a visibles.
  const btnChevron = document.createElement("button");
  btnChevron.type = "button";
  btnChevron.className = "btn-icono-fantasma";
  btnChevron.innerHTML = estado.controlesMapaOcultosFullscreen ? SVG_CHEVRON_ABAJO : SVG_CHEVRON_ARRIBA;
  btnChevron.style.display = estado.mapaPantallaCompleta ? "" : "none";
  btnChevron.setAttribute(
    "aria-label",
    estado.controlesMapaOcultosFullscreen ? "Mostrar controles del mapa" : "Ocultar controles del mapa"
  );
  btnChevron.addEventListener("click", () => {
    estado.controlesMapaOcultosFullscreen = !estado.controlesMapaOcultosFullscreen;
    contFilasSuperiores.style.display = estado.controlesMapaOcultosFullscreen ? "none" : "";
    // V1.x (rediseño 3): Descargar sigue al mismo flag — solo visible
    // dentro de pantalla completa mientras las filas 2/3 están extendidas.
    btnDescargar.style.display = estado.controlesMapaOcultosFullscreen ? "none" : "";
    btnChevron.innerHTML = estado.controlesMapaOcultosFullscreen ? SVG_CHEVRON_ABAJO : SVG_CHEVRON_ARRIBA;
    btnChevron.setAttribute(
      "aria-label",
      estado.controlesMapaOcultosFullscreen ? "Mostrar controles del mapa" : "Ocultar controles del mapa"
    );
  });
  contBotonesCentro.appendChild(btnChevron);

  let btnGirar = null;
  // Girar pantalla (Screen Orientation API): solo se arma el botón si el
  // navegador de verdad soporta bloquear orientación — Safari/iOS no lo
  // soporta en absoluto, así que ahí no tendría sentido mostrar un botón
  // muerto. Donde sí existe, además solo se MUESTRA mientras se está en
  // pantalla completa, porque la propia API exige estar en pantalla
  // completa para bloquear.
  if (typeof screen !== "undefined" && screen.orientation && typeof screen.orientation.lock === "function") {
    btnGirar = document.createElement("button");
    btnGirar.type = "button";
    btnGirar.className = "btn-icono-fantasma";
    btnGirar.innerHTML = SVG_GIRAR;
    btnGirar.style.display = estado.mapaPantallaCompleta ? "" : "none";
    btnGirar.setAttribute("aria-label", "Girar pantalla (bloquear orientación horizontal)");
    btnGirar.addEventListener("click", () => {
      const tipoActual = screen.orientation.type || "";
      if (tipoActual.startsWith("landscape")) {
        screen.orientation.unlock();
      } else {
        screen.orientation.lock("landscape").catch((err) => {
          console.error("No se pudo bloquear la orientación de pantalla:", err);
        });
      }
    });
    contBotonesCentro.appendChild(btnGirar);
  }

  const zoomGrupo = document.createElement("div");
  zoomGrupo.className = "mapa-zoom-controles";
  zoomGrupo.style.gridColumn = "3"; // ver comentario de btnDescargar
  zoomGrupo.style.justifySelf = "end";
  const btnMenos = document.createElement("button");
  btnMenos.type = "button";
  btnMenos.className = "btn-icono-fantasma mapa-zoom-btn";
  btnMenos.textContent = "−";
  btnMenos.setAttribute("aria-label", "Alejar mapa");
  const etiquetaZoom = document.createElement("span");
  etiquetaZoom.className = "muted mapa-zoom-etiqueta";
  etiquetaZoom.textContent = Math.round(estado.zoomMapa * 100) + "%";
  const btnMas = document.createElement("button");
  btnMas.type = "button";
  btnMas.className = "btn-icono-fantasma mapa-zoom-btn";
  btnMas.textContent = "+";
  btnMas.setAttribute("aria-label", "Acercar mapa");
  btnMenos.addEventListener("click", () => {
    ajustarZoomMapa(-0.1, etiquetaZoom);
    sincronizarControlesMapa();
  });
  btnMas.addEventListener("click", () => {
    ajustarZoomMapa(0.1, etiquetaZoom);
    sincronizarControlesMapa();
  });
  zoomGrupo.appendChild(btnMenos);
  zoomGrupo.appendChild(etiquetaZoom);
  zoomGrupo.appendChild(btnMas);

  // Orden de inserción = orden de columnas del grid: descargar (col 1,
  // izq.), íconos (col 2, centro), zoom (col 3, der.) — corrección del
  // pedido anterior (ver comentario arriba de fila4).
  fila4.appendChild(btnDescargar);
  fila4.appendChild(contBotonesCentro);
  fila4.appendChild(zoomGrupo);

  raiz.appendChild(fila4);

  // Refresco in-place: solo repinta `.active`/texto de zoom, nunca
  // reconstruye nada ni vuelve a llamar a los handlers (evita efectos
  // secundarios duplicados, ej. recolorearNodosMapa() llamándose dos veces).
  const refrescar = () => {
    refrescarPillGroupVista(switchColor, estado.colorMapaPor);
    refrescarPillGroupVista(switchTrazado, estado.trazadoMapaPor);
    refrescarPillGroupVista(switchTamanio, estado.tamanioTarjetaMapa);
    refrescarPillGroupVista(
      switchTemaTarjeta,
      estado.temaTarjetaMapa || (document.documentElement.dataset.mode === "light" ? "clara" : "oscura")
    );
    etiquetaZoom.textContent = Math.round(estado.zoomMapa * 100) + "%";
  };

  return { raiz, refrescar, btnPantallaCompleta, btnGirar, btnChevron, btnDescargar, contFilasSuperiores };
}

function construirTarjetaVista(plan) {
  const card = document.createElement("section");
  card.className = "glass-card stack vista-card";
  cardRef = card;
  planActualRef = plan;

  /* ---- Línea 1: título "Vista" (izq.) + switch Lista/Mapa (der.) ----
     V1.x: se oculta por completo SOLO dentro de pantalla completa (pedido
     explícito) — afuera del modo Mapa fullscreen, siempre visible sin
     cambios. Solo tiene sentido ocultarla mientras estado.vistaPlanEstudios
     es "mapa", que es el único caso en que puede haber pantalla completa
     activa (el botón ⛶ vive solo en los controles del mapa). */
  const encabezado = document.createElement("div");
  encabezado.className = "vista-encabezado";
  encabezadoRef = encabezado;
  if (estado.vistaPlanEstudios === "mapa" && estado.mapaPantallaCompleta) {
    encabezado.style.display = "none";
    // Ver comentario en actualizarControlesPantallaCompleta(): habilita
    // scroll vertical mientras se está en pantalla completa. Se aplica acá
    // también (no solo en el listener de fullscreenchange) para que no
    // haya un instante con contenido recortado al reconstruir la tarjeta
    // (ej. al cambiar "Tamaño"/"Tema") mientras ya se está en fullscreen.
    card.style.overflowY = "auto";
    card.style.maxHeight = "100vh";
  }
  const titulo = document.createElement("h2");
  titulo.className = "texto-encabezado-seccion";
  titulo.style.margin = "0";
  titulo.textContent = "Vista";
  encabezado.appendChild(titulo);

  const switchVista = construirPillGroupVista(
    [
      { valor: "lista", texto: "Lista" },
      { valor: "mapa", texto: "Mapa" },
    ],
    estado.vistaPlanEstudios,
    (valor) => {
      if (estado.vistaPlanEstudios === valor) return;
      estado.vistaPlanEstudios = valor;
      estado.materiaSeleccionadaMapa = null;
      renderizarPlanEstudios();
    }
  );
  encabezado.appendChild(switchVista);
  card.appendChild(encabezado);

  if (estado.vistaPlanEstudios === "mapa") {
    // V1.x (rediseño 2 — sin duplicado): un solo bloque de controles. La
    // fila 4 (⛶/⌃⌄/🔄/Zoom) queda siempre visible; el chevrón ⌃/⌄ que
    // oculta las filas 2/3 solo aparece mientras se está en pantalla
    // completa (actualizarControlesPantallaCompleta se encarga). Descargar
    // sigue el mismo flag que las filas 2/3 (rediseño 3): solo dentro de
    // pantalla completa deja de ser fijo y aparece/desaparece con ellas.
    const bloque = construirBloqueControles(plan);
    refrescarRef = bloque.refrescar;
    btnPantallaCompletaRef = bloque.btnPantallaCompleta;
    btnGirarRef = bloque.btnGirar;
    btnChevronRef = bloque.btnChevron;
    btnDescargarRef = bloque.btnDescargar;
    contFilasSuperioresRef = bloque.contFilasSuperiores;
    card.appendChild(bloque.raiz);

    card.appendChild(construirMapaInteractivo(plan));

    // Si la tarjeta se reconstruye (ej. cambiaste "Tamaño de tarjeta")
    // mientras se está en pantalla completa, las refs de arriba ya quedan
    // apuntando al bloque nuevo — no hace falta lógica extra, al no existir
    // más un segundo bloque que reinyectar.
  }

  return card;
}

/** Color del nodo según el switch activo (Simbología por Estado, o Categoría). */

function colorNodoMapa(materia, plan) {
  if (estado.colorMapaPor === "categoria") {
    const cat = (plan.categorias || []).find((c) => c.id === materia.categoria_id);
    return cat ? cat.color : "#64748b";
  }
  return COLOR_ESTADO_MAPA[materia.estado] || "#94a3b8";
}

/** Recolorea los nodos ya renderizados sin reconstruir el mapa (conserva zoom/scroll/camino). */

function recolorearNodosMapa(plan) {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  refs.nodosPorCodigo.forEach((nodo, codigo) => {
    const materia = plan.materias.find((m) => m.codigo === codigo);
    if (!materia) return;
    const color = colorNodoMapa(materia, plan);
    nodo.style.setProperty("--nodo-color", color);
    // Última instrucción V1.10: sombra sutil de cada tarjeta, tintada según
    // el color de su borde activo (mismo color, baja opacidad).
    nodo.style.setProperty("--nodo-color-sombra", hexARgba(color, 0.35));
  });
}

/** Construye el contenedor completo del mapa: columnas por bloque + overlay SVG de caminos. */

function construirMapaInteractivo(plan) {
  // v1.12.15 (punto 3 del prompt): la Vista de Mapa dibuja ÚNICAMENTE los
  // bloques numerados reales del plan — ni "Optativas" ni "Revisar" se
  // dibujan aquí. "Revisar" nunca llega a plan.materias (vive en
  // plan.materias_revisar, igual que optativas_disponibles — ver
  // plan-importacion-csv.js/plan-esquema.js), así que se excluye solo con
  // que este mapa siga leyendo plan.materias; "Optativas" (es_optativa:true)
  // sí puede llegar a existir en plan.materias por datos de versiones
  // anteriores, así que se filtra explícitamente acá.
  const materias = plan.materias.filter((m) => !m.es_optativa);
  const grupos = new Map();
  materias.forEach((m) => {
    const clave = m.bloque === null || m.bloque === undefined ? "__sin_bloque__" : String(m.bloque);
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(m);
  });
  const clavesNumericas = Array.from(grupos.keys())
    .filter((k) => k !== "__sin_bloque__")
    .sort((a, b) => Number(a) - Number(b));
  const clavesFinal = [...clavesNumericas];
  if (grupos.has("__sin_bloque__")) clavesFinal.push("__sin_bloque__");

  const wrapper = document.createElement("div");
  wrapper.className = "mapa-wrapper";
  // V1.10: tamaño de tarjeta (compacto/normal/extendido) y tema SOLO del
  // interior de las tarjetas (clara/oscura) — ver reglas [data-tamanio]/
  // [data-tema-tarjeta] en design-system.css.
  wrapper.dataset.tamanio = estado.tamanioTarjetaMapa || "normal";
  wrapper.dataset.temaTarjeta =
    estado.temaTarjetaMapa || (document.documentElement.dataset.mode === "light" ? "clara" : "oscura");

  const scroll = document.createElement("div");
  scroll.className = "mapa-scroll";
  scroll.tabIndex = 0;

  const sizer = document.createElement("div");
  sizer.className = "mapa-sizer";

  const track = document.createElement("div");
  track.className = "mapa-track";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "mapa-caminos");
  track.appendChild(svg);

  const columnasEl = document.createElement("div");
  columnasEl.className = "mapa-columnas";

  const nodosPorCodigo = new Map();

  clavesFinal.forEach((clave) => {
    const columna = document.createElement("div");
    columna.className = "mapa-columna";
    const tituloCol = document.createElement("div");
    tituloCol.className = "mapa-columna-titulo";
    tituloCol.textContent =
      clave === "__sin_bloque__" ? "Sin bloque" : `${plan.parametros_universidad.nombre_bloque} ${clave}`;
    columna.appendChild(tituloCol);

    grupos.get(clave).forEach((materia) => {
      const nodo = construirNodoMapa(materia, plan);
      nodosPorCodigo.set(materia.codigo, nodo);
      columna.appendChild(nodo);
    });
    columnasEl.appendChild(columna);
  });

  track.appendChild(columnasEl);
  sizer.appendChild(track);
  scroll.appendChild(sizer);

  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "flecha-plan flecha-scroll";
  btnPrev.textContent = "‹";
  btnPrev.setAttribute("aria-label", "Desplazar mapa a la izquierda");
  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "flecha-plan flecha-scroll";
  btnNext.textContent = "›";
  btnNext.setAttribute("aria-label", "Desplazar mapa a la derecha");
  btnPrev.addEventListener("click", () => scroll.scrollBy({ left: -scroll.clientWidth * 0.8, behavior: "smooth" }));
  btnNext.addEventListener("click", () => scroll.scrollBy({ left: scroll.clientWidth * 0.8, behavior: "smooth" }));

  wrapper.appendChild(btnPrev);
  wrapper.appendChild(scroll);
  wrapper.appendChild(btnNext);

  // Flechas del teclado (cuando el mapa tiene foco) — scroll exclusivo del mapa.
  scroll.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight") { scroll.scrollBy({ left: 140, behavior: "smooth" }); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { scroll.scrollBy({ left: -140, behavior: "smooth" }); ev.preventDefault(); }
  });

  // Ctrl + rueda del mouse = zoom (sin Ctrl, la rueda hace scroll normal).
  scroll.addEventListener(
    "wheel",
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ajustarZoomMapa(ev.deltaY < 0 ? 0.1 : -0.1, wrapper.querySelector(".mapa-zoom-etiqueta"));
      sincronizarControlesMapa();
    },
    { passive: false }
  );

  // Pellizco táctil = zoom.
  let distanciaInicialToque = null;
  let zoomInicialToque = 1;
  const distanciaEntreToques = (toques) => Math.hypot(toques[0].clientX - toques[1].clientX, toques[0].clientY - toques[1].clientY);
  scroll.addEventListener(
    "touchstart",
    (ev) => {
      if (ev.touches.length === 2) {
        distanciaInicialToque = distanciaEntreToques(ev.touches);
        zoomInicialToque = estado.zoomMapa;
      }
    },
    { passive: true }
  );
  scroll.addEventListener(
    "touchmove",
    (ev) => {
      if (ev.touches.length === 2 && distanciaInicialToque) {
        ev.preventDefault();
        const factor = distanciaEntreToques(ev.touches) / distanciaInicialToque;
        estado.zoomMapa = Math.min(2, Math.max(0.5, zoomInicialToque * factor));
        aplicarZoomMapa();
        const etiqueta = wrapper.querySelector(".mapa-zoom-etiqueta");
        if (etiqueta) etiqueta.textContent = Math.round(estado.zoomMapa * 100) + "%";
        sincronizarControlesMapa();
      }
    },
    { passive: false }
  );
  scroll.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) distanciaInicialToque = null; });

  // V10: se mide el gap REAL (CSS `.mapa-columnas { gap: 28px }`) en vez de
  // hardcodearlo, para que el trazado recto nunca quede desincronizado si el
  // valor del CSS cambia más adelante.
  const gapColumnas = parseFloat(getComputedStyle(columnasEl).columnGap) || 28;

  estado._refsMapaActual = { scroll, sizer, track, svg, columnasEl, nodosPorCodigo, plan, gapColumnas };

  requestAnimationFrame(() => {
    aplicarZoomMapa();
    dibujarCaminoDesbloqueo(plan);
  });
  if (window.ResizeObserver) new ResizeObserver(() => aplicarZoomMapa()).observe(columnasEl);

  return wrapper;
}

/** Recalcula el tamaño real del track y aplica el zoom actual (transform: scale). */

function aplicarZoomMapa() {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  const { sizer, track, svg, columnasEl } = refs;
  track.style.transform = "none";
  const anchoNatural = columnasEl.scrollWidth;
  const altoNatural = columnasEl.scrollHeight;
  track.style.width = anchoNatural + "px";
  track.style.height = altoNatural + "px";
  const zoom = estado.zoomMapa || 1;
  track.style.transform = `scale(${zoom})`;
  sizer.style.width = anchoNatural * zoom + "px";
  sizer.style.height = altoNatural * zoom + "px";
  svg.setAttribute("viewBox", `0 0 ${anchoNatural} ${altoNatural}`);
}

/** Botones +/- de zoom (no re-renderiza nada, conserva scroll y camino dibujado). */

function ajustarZoomMapa(delta, etiquetaEl) {
  estado.zoomMapa = Math.min(2, Math.max(0.5, Math.round((estado.zoomMapa + delta) * 100) / 100));
  aplicarZoomMapa();
  if (etiquetaEl) etiquetaEl.textContent = Math.round(estado.zoomMapa * 100) + "%";
}

/** Tarjeta compacta de una materia dentro del mapa: tap = camino; mantener presionada = detalle. */

function construirNodoMapa(materia, plan) {
  const nodo = document.createElement("div");
  nodo.className = "mapa-nodo";
  const color = colorNodoMapa(materia, plan);
  nodo.style.setProperty("--nodo-color", color);
  // Última instrucción V1.10: sombra sutil tintada según el color de borde activo.
  nodo.style.setProperty("--nodo-color-sombra", hexARgba(color, 0.35));

  // FIX sync (conflicto real invisible en Mapa): a diferencia de la tarjeta
  // de la vista Lista (ver construirTarjetaMateria en
  // plan-vista-lista-tarjetas.js), esta función nunca revisaba
  // materia._conflicto — un choque real (ver hayConflictoReal en
  // storage-merge.js) quedaba marcado en los datos pero completamente
  // invisible mientras la persona estuviera en la vista Mapa, sin ninguna
  // forma de notarlo ni resolverlo desde acá. Se agrega el mismo indicador,
  // como una esquina de aviso sobre el nodo (position:relative propio, para
  // no depender de que el CSS del proyecto ya tenga ese ajuste hecho).
  if (materia._conflicto) {
    nodo.style.position = "relative";
    const avisoConflicto = document.createElement("span");
    avisoConflicto.className = "mapa-nodo-aviso-conflicto";
    avisoConflicto.style.cssText =
      "position:absolute; top:-8px; right:-8px; width:20px; height:20px; border-radius:50%; " +
      "background:#ef4444; color:#fff; font-size:12px; line-height:20px; text-align:center; " +
      "cursor:pointer; z-index:5; box-shadow:0 0 0 2px var(--bg-canvas, #101114);";
    avisoConflicto.textContent = "⚠";
    avisoConflicto.title = "Se editó de forma distinta en dos dispositivos. Toca para elegir cuál dejar.";
    avisoConflicto.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalResolverConflicto(materia, plan);
    });
    avisoConflicto.addEventListener("mousedown", (ev) => ev.stopPropagation());
    avisoConflicto.addEventListener("touchstart", (ev) => ev.stopPropagation(), { passive: true });
    nodo.appendChild(avisoConflicto);
  }

  // V1.10: línea 1 = luz (::before, igual que siempre) + código + créditos.
  // En modo normal/compacto, "fila1" es invisible como contenedor (display:
  // contents) y el código se ve exactamente igual que antes; los créditos
  // solo se muestran en modo "extendido" (ver design-system.css).
  const fila1 = document.createElement("div");
  fila1.className = "mapa-nodo-fila1";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "mapa-nodo-codigo";
  spanCodigo.textContent = materia.codigo;
  const spanCreditos = document.createElement("span");
  spanCreditos.className = "mapa-nodo-creditos";
  spanCreditos.textContent = `${materia.creditos} cr.`;
  fila1.appendChild(spanCodigo);
  fila1.appendChild(spanCreditos);

  const spanNombre = document.createElement("span");
  spanNombre.className = "mapa-nodo-nombre";
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  nodo.appendChild(fila1);
  nodo.appendChild(spanNombre);

  let temporizador = null;
  let fueLongPress = false;
  const iniciar = () => {
    fueLongPress = false;
    temporizador = setTimeout(() => {
      fueLongPress = true;
      abrirModalRequisito(materia.codigo);
    }, 500);
  };
  const cancelar = () => clearTimeout(temporizador);
  nodo.addEventListener("mousedown", iniciar);
  nodo.addEventListener("touchstart", iniciar, { passive: true });
  ["mouseup", "mouseleave", "touchend", "touchcancel", "touchmove"].forEach((ev) => nodo.addEventListener(ev, cancelar));
  nodo.addEventListener("click", () => {
    if (fueLongPress) { fueLongPress = false; return; }
    estado.materiaSeleccionadaMapa = estado.materiaSeleccionadaMapa === materia.codigo ? null : materia.codigo;
    dibujarCaminoDesbloqueo(plan);
  });

  return nodo;
}

/**
 * Dibuja (o borra) el "camino" de desbloqueo detrás de las tarjetas: la
 * cadena completa de materias que la seleccionada desbloquea, transitiva
 * (reutiliza obtenerMateriasQueDesbloquea() nivel por nivel). Coordenadas en
 * el espacio local NO escalado del track (offsetLeft/offsetTop no se ven
 * afectados por el transform: scale, así que el mismo dibujo sirve para
 * cualquier nivel de zoom sin tener que recalcular nada al hacer zoom).
 */

/**
 * V10: punto de anclaje INVISIBLE de un nodo — ya no el centro de la
 * tarjeta (eso generaba líneas raras que cruzaban el texto), sino el centro
 * vertical del lado lateral pedido: "izquierda" (input — "se desbloqueó
 * con") o "derecha" (output — "es requisito de"). Mismo espacio local NO
 * escalado que offsetLeft/offsetTop (ver nota de la función que sigue).
 */

function puntoAnclajeLateral(nodo, lado) {
  const y = nodo.offsetTop + nodo.offsetHeight / 2;
  const x = lado === "izquierda" ? nodo.offsetLeft : nodo.offsetLeft + nodo.offsetWidth;
  return { x, y };
}

function dibujarCaminoDesbloqueo(plan) {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  const { svg, nodosPorCodigo, gapColumnas } = refs;
  svg.innerHTML = "";
  refs.nodosPorCodigo.forEach((nodo) => nodo.classList.remove("mapa-nodo-en-camino"));

  const codigoInicial = estado.materiaSeleccionadaMapa;
  if (!codigoInicial) return;
  const materiaInicial = plan.materias.find((m) => m.codigo === codigoInicial);
  if (!materiaInicial) return;

  const visitados = new Set([codigoInicial]);
  const aristas = [];
  let frontera = [materiaInicial];
  while (frontera.length) {
    const siguiente = [];
    frontera.forEach((m) => {
      obtenerMateriasQueDesbloquea(m, plan).forEach((d) => {
        aristas.push([m.codigo, d.codigo]);
        if (!visitados.has(d.codigo)) {
          visitados.add(d.codigo);
          siguiente.push(d);
        }
      });
    });
    frontera = siguiente;
  }

  aristas.forEach(([desde, hasta]) => {
    const nodoDesde = nodosPorCodigo.get(desde);
    const nodoHasta = nodosPorCodigo.get(hasta);
    if (!nodoDesde || !nodoHasta) return;

    // ¿Hacia dónde queda el destino? Decide qué lado de cada tarjeta se usa
    // como anclaje: salida (output) del lado que mira hacia el destino,
    // entrada (input) del lado de la tarjeta destino que mira hacia el origen.
    const centroDesdeX = nodoDesde.offsetLeft + nodoDesde.offsetWidth / 2;
    const centroHastaX = nodoHasta.offsetLeft + nodoHasta.offsetWidth / 2;
    const vaHaciaLaDerecha = centroHastaX >= centroDesdeX;

    const p1 = puntoAnclajeLateral(nodoDesde, vaHaciaLaDerecha ? "derecha" : "izquierda");
    const p2 = puntoAnclajeLateral(nodoHasta, vaHaciaLaDerecha ? "izquierda" : "derecha");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("class", "mapa-camino-linea");

    if (estado.trazadoMapaPor === "recta") {
      // V10: tramos ortogonales rectos — sale del anclaje, viaja en línea
      // recta vertical por el centro del gap que YA existe entre bloques
      // (no se separan más las columnas), y entra al anclaje del destino.
      const mitadGap = (gapColumnas || 28) / 2;
      const xGap = vaHaciaLaDerecha ? p1.x + mitadGap : p1.x - mitadGap;
      path.setAttribute("d", `M ${p1.x} ${p1.y} L ${xGap} ${p1.y} L ${xGap} ${p2.y} L ${p2.x} ${p2.y}`);
    } else {
      const medioX = (p1.x + p2.x) / 2;
      path.setAttribute("d", `M ${p1.x} ${p1.y} C ${medioX} ${p1.y}, ${medioX} ${p2.y}, ${p2.x} ${p2.y}`);
    }
    svg.appendChild(path);
  });

  visitados.forEach((codigo) => {
    const nodo = nodosPorCodigo.get(codigo);
    if (nodo) nodo.classList.add("mapa-nodo-en-camino");
  });
}

/** Modal chico (100% construido en JS) para elegir cómo exportar el PNG del mapa. */

/**
 * V1.10: selector de descarga completo — "Descargar como imagen" con 3
 * switches independientes (Modo claro/oscuro, Tema default/actual, Fondo/Sin
 * fondo) y un botón de confirmación. Usa los colores/trazado que estén
 * visibles en el mapa en el momento de presionar "Descargar".
 */
function abrirSelectorDescargaMapa() {
  document.querySelectorAll(".modal-descarga-mapa").forEach((el) => el.remove());

  // Punto de partida de cada switch: sigue el modo/tema actuales de la app.
  const opciones = {
    modo: document.documentElement.dataset.mode === "light" ? "claro" : "oscuro",
    tema: "actual",
    fondo: "con",
  };

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-descarga-mapa";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";

  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Descargar como imagen";
  caja.appendChild(titulo);

  const texto = document.createElement("p");
  texto.className = "muted";
  texto.style.margin = "0";
  texto.textContent = "¿Cómo quieres descargarlo?";
  caja.appendChild(texto);

  const agregarSwitch = (opcionesPill, clave) => {
    const grupo = construirPillGroupVista(opcionesPill, opciones[clave], (valor, btn, g) => {
      opciones[clave] = valor;
      g.querySelectorAll(".pill-item").forEach((p) => p.classList.remove("active"));
      btn.classList.add("active");
    });
    caja.appendChild(grupo);
  };

  agregarSwitch(
    [
      { valor: "claro", texto: "Modo claro" },
      { valor: "oscuro", texto: "Modo oscuro" },
    ],
    "modo"
  );
  agregarSwitch(
    [
      { valor: "default", texto: "Tema default" },
      { valor: "actual", texto: "Tema actual" },
    ],
    "tema"
  );
  agregarSwitch(
    [
      { valor: "con", texto: "Fondo" },
      { valor: "sin", texto: "Sin fondo" },
    ],
    "fondo"
  );

  const cerrar = () => overlay.remove();

  const btnDescargar = document.createElement("button");
  btnDescargar.type = "button";
  btnDescargar.className = "btn btn-primary btn-block";
  btnDescargar.textContent = "Descargar";
  btnDescargar.addEventListener("click", () => {
    cerrar();
    exportarMapaComoPNG(opciones);
  });
  caja.appendChild(btnDescargar);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary btn-block";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  caja.appendChild(btnCancelar);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  // V1.x: pedido explícito — que las ventanas flotantes se vean aunque se
  // esté en pantalla completa. El Fullscreen API nativo solo pinta encima
  // el elemento en pantalla completa y SUS DESCENDIENTES DEL DOM; cualquier
  // nodo agregado a document.body (como este overlay) queda tapado detrás.
  // La solución es agregar el overlay como hijo del elemento que está
  // realmente en pantalla completa cuando corresponda — sigue siendo
  // position:fixed (cubre toda la pantalla igual), solo cambia DÓNDE cuelga
  // en el árbol del DOM.
  const contenedorModal = document.fullscreenElement || document.body;
  contenedorModal.appendChild(overlay);
}

/**
 * Exporta el mapa COMPLETO (no solo lo visible por el scroll) a PNG, usando
 * html2canvas (cargado por CDN en index.html). "Con mi tema actual" captura
 * tal cual se ve; "Modo claro, fondo transparente" cambia momentáneamente
 * data-mode a "light" en <html> (de donde salen todas las variables CSS de
 * color) solo mientras dura la captura, y pide fondo transparente a
 * html2canvas — se restaura el modo real apenas termina.
 */

/**
 * V1.10: `opciones` = { modo: "claro"|"oscuro", tema: "default"|"actual",
 * fondo: "con"|"sin" }.
 * - modo: fuerza data-mode="light"/"dark" solo durante la captura.
 * - tema "actual": conserva la paleta de colores real de la app (solo
 *   cambia claro/oscuro). tema "default": además pisa temporalmente las
 *   variables de color por una paleta neutra (blanco+grises en claro,
 *   negro+grises en oscuro) vía la clase .exportar-tema-default en <html>.
 * - fondo: "con" exporta con el color de fondo correspondiente; "sin"
 *   exporta con fondo transparente.
 * Los colores de nodo (por Simbología/Categoría) y el tipo de trazado del
 * camino son los que estén visibles en el mapa en ese momento — no se tocan
 * aquí, html2canvas simplemente captura el DOM tal cual se ve.
 */
function exportarMapaComoPNG(opciones) {
  const { modo, tema, fondo } = opciones || {};
  const refs = estado._refsMapaActual;
  if (!refs || typeof html2canvas === "undefined") {
    console.error("No se pudo exportar el mapa: html2canvas no está disponible o el mapa no está renderizado.");
    return;
  }
  const { scroll, sizer } = refs;

  // Estilos/atributos originales a restaurar tras la captura.
  const estiloOriginalScroll = { overflow: scroll.style.overflow, width: scroll.style.width };
  const modoOriginal = document.documentElement.dataset.mode;

  const restaurar = () => {
    scroll.style.overflow = estiloOriginalScroll.overflow;
    scroll.style.width = estiloOriginalScroll.width;
    document.documentElement.dataset.mode = modoOriginal;
    document.documentElement.classList.remove("exportar-tema-default");
  };

  // Se muestra el sizer completo (sin recorte por overflow) para capturar
  // el mapa entero, incluso la parte que hoy está fuera del scroll visible.
  scroll.style.overflow = "visible";
  scroll.style.width = sizer.style.width;
  document.documentElement.dataset.mode = modo === "claro" ? "light" : "dark";
  if (tema === "default") document.documentElement.classList.add("exportar-tema-default");

  requestAnimationFrame(() => {
    const colorFondoActual =
      getComputedStyle(document.documentElement).getPropertyValue("--bg-canvas").trim() ||
      (modo === "claro" ? "#ffffff" : "#101114");

    html2canvas(sizer, {
      backgroundColor: fondo === "sin" ? null : colorFondoActual,
      scale: 2,
      useCORS: true,
    })
      .then((canvas) => {
        restaurar();
        const enlace = document.createElement("a");
        enlace.download = "mapa-plan-de-estudios.png";
        enlace.href = canvas.toDataURL("image/png");
        enlace.click();
      })
      .catch((e) => {
        restaurar();
        console.error("Error al generar la imagen del mapa:", e);
      });
  });
}

export {
  COLOR_ESTADO_MAPA,
  abrirSelectorDescargaMapa,
  ajustarZoomMapa,
  aplicarZoomMapa,
  colorNodoMapa,
  construirMapaInteractivo,
  construirNodoMapa,
  construirTarjetaVista,
  dibujarCaminoDesbloqueo,
  exportarMapaComoPNG,
  recolorearNodosMapa,
};
