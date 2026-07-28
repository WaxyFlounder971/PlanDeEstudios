/* =========================================================================
   PLAN DE ESTUDIOS — MAPA INTERACTIVO (Ajuste 3, v8/v9-B.3)
   Tarjeta "Vista" (switch Lista/Mapa), columnas por bloque + Optativas,
   coloreo por Simbología/Categoría, zoom, camino de desbloqueo con efecto
   neón, y exportación a PNG.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, hexARgba } from "../core/utils.js";
import { abrirModalRequisito } from "./plan-detalle.js";
import { obtenerMateriasQueDesbloquea } from "./plan-vista-lista-tarjetas.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

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
 *  cortar las letras con "…". */
function construirPillGroupVista(opciones, valorActual, onSeleccionar) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group pill-group-vista";
  opciones.forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valorActual === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => onSeleccionar(op.valor, btn, grupo));
    grupo.appendChild(btn);
  });
  return grupo;
}

function construirTarjetaVista(plan) {
  const card = document.createElement("section");
  card.className = "glass-card stack vista-card";

  /* ---- Línea 1: título "Vista" (izq.) + switch Lista/Mapa (der.) ---- */
  const encabezado = document.createElement("div");
  encabezado.className = "vista-encabezado";
  const titulo = document.createElement("h2");
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
    /* ---- Línea 2: Colorear por (izq.) | Líneas libres/rectas (der.) ---- */
    const fila2 = document.createElement("div");
    fila2.className = "vista-fila";

    const switchColor = construirPillGroupVista(
      [
        { valor: "simbologia", texto: "Colorear por Simbología" },
        { valor: "categoria", texto: "Colorear por Categoría" },
      ],
      estado.colorMapaPor,
      (valor, btn, grupo) => {
        if (estado.colorMapaPor === valor) return;
        estado.colorMapaPor = valor;
        grupo.querySelectorAll(".pill-item").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        recolorearNodosMapa(plan);
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
      (valor, btn, grupo) => {
        if (estado.trazadoMapaPor === valor) return;
        estado.trazadoMapaPor = valor;
        grupo.querySelectorAll(".pill-item").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        dibujarCaminoDesbloqueo(plan);
      }
    );
    fila2.appendChild(switchTrazado);
    card.appendChild(fila2);

    /* ---- Línea 3: tamaño de tarjeta (izq.) | tema de tarjeta (der.) ---- */
    const fila3 = document.createElement("div");
    fila3.className = "vista-fila";

    // V1.10: tamaño horizontal de cada tarjeta del mapa. Cambia la
    // estructura interna en modo "extendido", así que se reconstruye todo
    // el mapa (no basta con recolorear/redibujar el camino).
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
        renderizarPlanEstudios();
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
        renderizarPlanEstudios();
      }
    );
    fila3.appendChild(switchTemaTarjeta);
    card.appendChild(fila3);

    /* ---- Línea 4: Descargar (izq.) | Control de zoom (der.) ---- */
    const fila4 = document.createElement("div");
    fila4.className = "vista-fila";

    const btnDescargar = document.createElement("button");
    btnDescargar.type = "button";
    btnDescargar.className = "btn btn-secondary";
    btnDescargar.textContent = "Descargar";
    btnDescargar.addEventListener("click", () => abrirSelectorDescargaMapa());
    fila4.appendChild(btnDescargar);

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
    fila4.appendChild(zoomGrupo);

    card.appendChild(fila4);
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
