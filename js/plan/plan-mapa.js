/* =========================================================================
   PLAN DE ESTUDIOS — MAPA INTERACTIVO (Ajuste 3, v8/v9-B.3)
   Tarjeta "Vista" (switch Lista/Mapa), columnas por bloque + Optativas,
   coloreo por Simbología/Categoría, zoom, camino de desbloqueo con efecto
   neón, y exportación a PNG.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { abrirModalRequisito } from "./plan-detalle.js";
import { obtenerMateriasQueDesbloquea } from "./plan-vista-lista-tarjetas.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

/* ---- B.3 (v8/v9): Vista de Mapa interactivo del Plan de Estudios ---- */
estado.vistaPlanEstudios = "lista";        // "lista" | "mapa"
estado.colorMapaPor = "simbologia";        // "simbologia" (por Estado) | "categoria"
estado.zoomMapa = 1;                       // 0.5 a 2
estado.materiaSeleccionadaMapa = null;     // código de la materia con camino de desbloqueo dibujado
estado._refsMapaActual = null;             // referencias DOM del mapa ya renderizado (para zoom/recolorear sin re-render completo)

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

function construirTarjetaVista(plan) {
  const card = document.createElement("section");
  card.className = "glass-card stack vista-card";

  const encabezado = document.createElement("div");
  encabezado.className = "vista-encabezado";
  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Vista";
  encabezado.appendChild(titulo);

  const switchVista = document.createElement("div");
  switchVista.className = "pill-group";
  [
    { valor: "lista", texto: "Lista" },
    { valor: "mapa", texto: "Mapa" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.vistaPlanEstudios === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      if (estado.vistaPlanEstudios === op.valor) return;
      estado.vistaPlanEstudios = op.valor;
      estado.materiaSeleccionadaMapa = null;
      renderizarPlanEstudios();
    });
    switchVista.appendChild(btn);
  });
  encabezado.appendChild(switchVista);
  card.appendChild(encabezado);

  if (estado.vistaPlanEstudios === "mapa") {
    const controles = document.createElement("div");
    controles.className = "vista-controles";

    const switchColor = document.createElement("div");
    switchColor.className = "pill-group";
    [
      { valor: "simbologia", texto: "Colorear por Simbología" },
      { valor: "categoria", texto: "Colorear por Categoría" },
    ].forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (estado.colorMapaPor === op.valor ? " active" : "");
      btn.textContent = op.texto;
      btn.addEventListener("click", () => {
        if (estado.colorMapaPor === op.valor) return;
        estado.colorMapaPor = op.valor;
        switchColor.querySelectorAll(".pill-item").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        recolorearNodosMapa(plan);
      });
      switchColor.appendChild(btn);
    });
    controles.appendChild(switchColor);

    const zoomGrupo = document.createElement("div");
    zoomGrupo.className = "mapa-zoom-controles";
    const btnMenos = document.createElement("button");
    btnMenos.type = "button";
    btnMenos.className = "btn btn-secondary mapa-zoom-btn";
    btnMenos.textContent = "−";
    btnMenos.setAttribute("aria-label", "Alejar mapa");
    const etiquetaZoom = document.createElement("span");
    etiquetaZoom.className = "muted mapa-zoom-etiqueta";
    etiquetaZoom.textContent = Math.round(estado.zoomMapa * 100) + "%";
    const btnMas = document.createElement("button");
    btnMas.type = "button";
    btnMas.className = "btn btn-secondary mapa-zoom-btn";
    btnMas.textContent = "+";
    btnMas.setAttribute("aria-label", "Acercar mapa");
    btnMenos.addEventListener("click", () => ajustarZoomMapa(-0.15, etiquetaZoom));
    btnMas.addEventListener("click", () => ajustarZoomMapa(0.15, etiquetaZoom));
    zoomGrupo.appendChild(btnMenos);
    zoomGrupo.appendChild(etiquetaZoom);
    zoomGrupo.appendChild(btnMas);
    controles.appendChild(zoomGrupo);

    const btnDescargar = document.createElement("button");
    btnDescargar.type = "button";
    btnDescargar.className = "btn btn-secondary";
    btnDescargar.textContent = "⬇ Descargar mapa como PNG";
    btnDescargar.addEventListener("click", () => abrirSelectorDescargaMapa());
    controles.appendChild(btnDescargar);

    card.appendChild(controles);
    card.appendChild(construirMapaInteractivo(plan));
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
    if (materia) nodo.style.setProperty("--nodo-color", colorNodoMapa(materia, plan));
  });
}

/** Construye el contenedor completo del mapa: columnas por bloque + overlay SVG de caminos. */

function construirMapaInteractivo(plan) {
  const materias = plan.materias.slice();
  const grupos = new Map();
  materias.forEach((m) => {
    const clave = m.es_optativa ? "__optativas__" : (m.bloque === null || m.bloque === undefined ? "__sin_bloque__" : String(m.bloque));
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(m);
  });
  const clavesNumericas = Array.from(grupos.keys())
    .filter((k) => k !== "__optativas__" && k !== "__sin_bloque__")
    .sort((a, b) => Number(a) - Number(b));
  const clavesFinal = [...clavesNumericas];
  if (grupos.has("__sin_bloque__")) clavesFinal.push("__sin_bloque__");
  if (grupos.has("__optativas__")) clavesFinal.push("__optativas__");

  const wrapper = document.createElement("div");
  wrapper.className = "mapa-wrapper";

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
      clave === "__optativas__" ? "Optativas" : clave === "__sin_bloque__" ? "Sin bloque" : `${plan.parametros_universidad.nombre_bloque} ${clave}`;
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
      }
    },
    { passive: false }
  );
  scroll.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) distanciaInicialToque = null; });

  estado._refsMapaActual = { scroll, sizer, track, svg, columnasEl, nodosPorCodigo, plan };

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
  nodo.style.setProperty("--nodo-color", colorNodoMapa(materia, plan));

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "mapa-nodo-codigo";
  spanCodigo.textContent = materia.codigo;
  const spanNombre = document.createElement("span");
  spanNombre.className = "mapa-nodo-nombre";
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  nodo.appendChild(spanCodigo);
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

function dibujarCaminoDesbloqueo(plan) {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  const { svg, nodosPorCodigo } = refs;
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

  const centroDe = (codigo) => {
    const nodo = nodosPorCodigo.get(codigo);
    if (!nodo) return null;
    return { x: nodo.offsetLeft + nodo.offsetWidth / 2, y: nodo.offsetTop + nodo.offsetHeight / 2 };
  };

  aristas.forEach(([desde, hasta]) => {
    const c1 = centroDe(desde);
    const c2 = centroDe(hasta);
    if (!c1 || !c2) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const medioX = (c1.x + c2.x) / 2;
    path.setAttribute("d", `M ${c1.x} ${c1.y} C ${medioX} ${c1.y}, ${medioX} ${c2.y}, ${c2.x} ${c2.y}`);
    path.setAttribute("class", "mapa-camino-linea");
    svg.appendChild(path);
  });

  visitados.forEach((codigo) => {
    const nodo = nodosPorCodigo.get(codigo);
    if (nodo) nodo.classList.add("mapa-nodo-en-camino");
  });
}

/** Modal chico (100% construido en JS) para elegir cómo exportar el PNG del mapa. */

function abrirSelectorDescargaMapa() {
  document.querySelectorAll(".modal-descarga-mapa").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-descarga-mapa";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";

  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Descargar mapa como imagen";
  caja.appendChild(titulo);

  const texto = document.createElement("p");
  texto.className = "muted";
  texto.textContent = "¿Cómo quieres exportar la imagen?";
  caja.appendChild(texto);

  const cerrar = () => overlay.remove();

  [
    { texto: "Con mi tema actual", valor: "actual" },
    { texto: "Modo claro, fondo transparente", valor: "claro_transparente" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-block";
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      cerrar();
      exportarMapaComoPNG(op.valor);
    });
    caja.appendChild(btn);
  });

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary btn-block";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  caja.appendChild(btnCancelar);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  document.body.appendChild(overlay);
}

/**
 * Exporta el mapa COMPLETO (no solo lo visible por el scroll) a PNG, usando
 * html2canvas (cargado por CDN en index.html). "Con mi tema actual" captura
 * tal cual se ve; "Modo claro, fondo transparente" cambia momentáneamente
 * data-mode a "light" en <html> (de donde salen todas las variables CSS de
 * color) solo mientras dura la captura, y pide fondo transparente a
 * html2canvas — se restaura el modo real apenas termina.
 */

function exportarMapaComoPNG(opcion) {
  const refs = estado._refsMapaActual;
  if (!refs || typeof html2canvas === "undefined") {
    console.error("No se pudo exportar el mapa: html2canvas no está disponible o el mapa no está renderizado.");
    return;
  }
  const { scroll, sizer, track } = refs;

  // Estilos originales a restaurar tras la captura.
  const estiloOriginalScroll = { overflow: scroll.style.overflow, width: scroll.style.width };
  const modoOriginal = document.documentElement.dataset.mode;

  const restaurar = () => {
    scroll.style.overflow = estiloOriginalScroll.overflow;
    scroll.style.width = estiloOriginalScroll.width;
    if (opcion === "claro_transparente") document.documentElement.dataset.mode = modoOriginal;
  };

  // Se muestra el sizer completo (sin recorte por overflow) para capturar
  // el mapa entero, incluso la parte que hoy está fuera del scroll visible.
  scroll.style.overflow = "visible";
  scroll.style.width = sizer.style.width;
  if (opcion === "claro_transparente") document.documentElement.dataset.mode = "light";

  const colorFondoActual = getComputedStyle(document.documentElement).getPropertyValue("--bg-canvas").trim() || "#101114";

  requestAnimationFrame(() => {
    html2canvas(sizer, {
      backgroundColor: opcion === "claro_transparente" ? null : colorFondoActual,
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
