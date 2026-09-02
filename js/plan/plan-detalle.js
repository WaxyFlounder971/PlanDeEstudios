/* =========================================================================
   PLAN DE ESTUDIOS — DETALLE DE MATERIA (tarjeta de lista + modal)
   Modal de requisito navegable, búsqueda inversa ("Desbloquea"), e
   historial.

   v1.9.8: hasta v1.9.7 el cuerpo de detalle (Bloque·Código, Categoría,
   Requisitos, Correquisitos, botones finales) era EXACTAMENTE el mismo
   diseño para la tarjeta expandida (en la lista) y para el modal flotante.
   Desde v1.9.8 son diseños DISTINTOS: la tarjeta usa un grid de 2 columnas
   propio (construirCuerpoDetalleTarjeta) y el modal conserva el layout de
   1 columna de siempre (construirCuerpoDetalleModal). Ambas siguen
   compartiendo construirLinea2Materia y construirBloqueRequisitos (esta
   última parametrizada con `modo`), pero ya no una única función de cuerpo
   completo — ver construirCuerpoDetalleMateria como punto de entrada que
   decide cuál armar.

   v1.11 (SOLO modal): Bloque·Código y Categoría se separaron del "cuerpo"
   (construirCuerpoDetalleModal) hacia una Línea 1 propia (construirLinea1Materia),
   que ahora vive ANTES del título/Nombre en el DOM (#requisito-linea1 en
   index.html, ver abrirModalRequisito) — antes quedaban después de la
   Línea 3 (Estado/Horas/Créditos) y encima en 2 líneas separadas por bug.
   Este cambio es exclusivo del modal; la tarjeta de lista no se toca.
   ========================================================================= */

import {
  obtenerEstadoEfectivoMateria,
  obtenerEstadoEfectivoSemestre,
  obtenerIntentosMateria,
  sellarTimestamp,
} from "../core/schema.js";
import { estado } from "../core/storage.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { aplicarFormatoTexto, estiloBadgeCategoria, formatearHoras, formatearHorasCompactoIniciales } from "../core/utils.js";
import { agregarLongPress } from "../ui/componentes.js";
import { buscarMateriaPorCodigoEnPlanes } from "./plan-esquema.js";
import { ESTADOS_MATERIA, abrirMenuRapidoCategoria, materiaDisponible, obtenerMateriasQueDesbloquea } from "./plan-vista-lista-tarjetas.js";
import { navegarASemestre } from "../semestres/semestres.js";

/** Formatea una nota numérica con máximo 2 decimales SIN redondear (trunca,
 *  no redondea — 8.666 debe mostrar "8.66", no "8.67"). Duplicado a
 *  propósito de comunidad.js (misma lógica) — no se importa de ahí porque
 *  comunidad.js ya importa de este archivo (abrirModalRequisito) y una
 *  importación en el otro sentido crearía un ciclo. */
function formatearNotaTruncada(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return String(valor);
  const [enteros, decimales = ""] = numero.toFixed(10).split(".");
  const decimalesTruncados = decimales.slice(0, 2).replace(/0+$/, "");
  return decimalesTruncados ? `${enteros}.${decimalesTruncados}` : enteros;
}

/** Requisitos/correquisitos agrupados: "o" dentro de un grupo, grupos en líneas separadas ("y" implícito). */

/**
 * B (v9)/v8 punto 2: Línea 2 del encabezado, compartida entre la tarjeta
 * (colapsada y expandida) y el modal — Estado a la izquierda, Horas al
 * centro, Créditos a la derecha. `compacto=true` usa las iniciales de cada
 * tipo de hora (tarjeta colapsada); `compacto=false` usa la palabra
 * completa (tarjeta expandida y modal, que siempre se consideran "el
 * detalle completo").
 */

function construirLinea2Materia(materia, compacto, plan) {
  // D/E/F: badge de Estado con el valor EFECTIVO (deriva "Cursando"), no
  // materia.estado crudo — ver obtenerEstadoEfectivoMateria en schema.js.
  const efectivo = obtenerEstadoEfectivoMateria(materia, plan.id, estado.datos);
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === efectivo) || ESTADOS_MATERIA[0];

  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";

  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  linea2.appendChild(badgeEstado);

  const spanHoras = document.createElement("span");
  spanHoras.className = "materia-linea2-horas";
  spanHoras.textContent = compacto ? formatearHorasCompactoIniciales(materia) : formatearHoras(materia);
  linea2.appendChild(spanHoras);

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
  linea2.appendChild(badgeCreditos);

  return linea2;
}

/** B (v9)/v8 punto 2: línea pequeña "Bloque X · Código", texto plano (no
 *  badge), al 75% del tamaño del nombre — va justo debajo del encabezado,
 *  antes de "Requisitos:". C.4 (v9): una materia electiva/optativa no
 *  pertenece a un Bloque numérico fijo, así que aquí se muestra "Optativa"
 *  en su lugar. */

function construirMetaLineaMateria(materia, plan) {
  const p = document.createElement("p");
  p.className = "materia-meta-linea";
  const etiquetaBloque = materia.es_optativa ? "Optativa" : `${plan.parametros_universidad.nombre_bloque} ${materia.bloque}`;
  p.textContent = `${etiquetaBloque} · ${materia.codigo}`;
  return p;
}

/** B (v9)/v8 punto 2: badge de Categoría pegado a la derecha — se omite POR
 *  COMPLETO (devuelve null) si la materia no tiene ninguna asignada. */

function construirLineaCategoriaMateria(materia, plan) {
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  if (!categoria) return null;

  const fila = document.createElement("div");
  fila.className = "materia-categoria-linea";

  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.cssText = estiloBadgeCategoria(categoria.color) + " cursor:pointer;";
  badge.textContent = categoria.nombre;
  badge.title = "Mantén presionado (o clic derecho) para cambiar la categoría";
  agregarLongPress(badge, () => abrirMenuRapidoCategoria(materia, plan, badge));
  fila.appendChild(badge);

  return fila;
}

/**
 * v1.11 — SOLO MODAL: Línea 1 del modal, "Bloque X · Código" (izquierda) y
 * el badge de Categoría (derecha), ambos en la MISMA fila y centrados
 * verticalmente entre sí (antes quedaban en 2 líneas separadas por bug).
 * Si la materia no tiene categoría, construirLineaCategoriaMateria
 * devuelve null y esta línea muestra solo el Bloque·Código, pegado a la
 * izquierda (gracias a justify-content:space-between con un solo hijo).
 * Exclusiva del modal: la tarjeta de lista no muestra esta línea.
 */

function construirLinea1Materia(materia, plan) {
  const fila = document.createElement("div");
  fila.className = "requisito-linea1";

  fila.appendChild(construirMetaLineaMateria(materia, plan));

  const lineaCategoria = construirLineaCategoriaMateria(materia, plan);
  if (lineaCategoria) fila.appendChild(lineaCategoria);

  return fila;
}

/**
 * B (v9)/v8 punto 2: fila final del bloque de detalle, con "Es requisito" y
 * "Historial" siempre juntos — y "Cerrar" solo cuando es el modal (en la
 * tarjeta expandida, cerrar es simplemente volver a hacer clic en la fila
 * para colapsarla, así que ese botón no aplica ahí).
 */

function construirBotonesFinalesDetalle(materia, plan, opciones) {
  const esModal = !!(opciones && opciones.esModal);

  const fila = document.createElement("div");
  fila.className = "row detalle-botones-finales";

  const btnEsRequisito = document.createElement("button");
  btnEsRequisito.type = "button";
  // v1.11: mismo estilo que "Cerrar" (btn btn-primary) — ya no link de texto plano.
  btnEsRequisito.className = "btn btn-primary";
  btnEsRequisito.textContent = "Es requisito";
  btnEsRequisito.addEventListener("click", (ev) => {
    ev.stopPropagation();
    // Bug Mochi (2026-08-21): si este botón vive dentro de #modal-requisito
    // (esModal), hay que cerrarlo ANTES de abrir Desbloquea — si no, quedan
    // dos overlays de modal apilados a la vez (mismo patrón que ya usa
    // abrirModalDesbloquea al navegar a un resultado, y el clic de "Ir a
    // este semestre" en el historial, más abajo en este archivo). Se marca
    // el flag de "volver" para no perder la tarjeta de origen si Desbloquea
    // se cierra sin elegir nada (ver cerrarModalDesbloquea).
    if (esModal) {
      document.getElementById("modal-requisito").classList.add("oculto");
      volverAModalRequisitoAlCerrar = true;
    }
    abrirModalDesbloquea(materia, plan);
  });
  fila.appendChild(btnEsRequisito);

  const btnHistorial = document.createElement("button");
  btnHistorial.type = "button";
  // v1.11: mismo estilo que "Cerrar" (btn btn-primary) — ya no link de texto plano.
  btnHistorial.className = "btn btn-primary";
  btnHistorial.textContent = "Historial";
  btnHistorial.addEventListener("click", (ev) => {
    ev.stopPropagation();
    // Bug Mochi (2026-08-21): mismo problema que "Es requisito" arriba —
    // cerrar #modal-requisito antes de abrir Historial si este botón vive
    // dentro de ese modal, para no apilar dos overlays. Mismo flag de
    // "volver" que en "Es requisito" (ver cerrarModalHistorial).
    if (esModal) {
      document.getElementById("modal-requisito").classList.add("oculto");
      volverAModalRequisitoAlCerrar = true;
    }
    abrirModalHistorial(materia, plan);
  });
  fila.appendChild(btnHistorial);

  if (esModal) {
    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.className = "btn btn-primary";
    btnCerrar.textContent = "Cerrar";
    btnCerrar.addEventListener("click", (ev) => {
      ev.stopPropagation();
      document.getElementById("modal-requisito").classList.add("oculto");
    });
    fila.appendChild(btnCerrar);
  }

  return fila;
}

/**
 * Fila de 2 columnas para un código de requisito/correquisito (v8 punto 2 —
 * reemplaza el diseño de 3 columnas de v7):
 * 1) Código - Nombre: el texto mismo ES el link, abre el detalle de esa
 *    materia (ya NO hay un link "Ir a materia" aparte).
 * 2) Créditos, alineados estrictamente a la derecha de la fila.
 */

/**
 * v1.9.8: mide texto sin forzar reflow del DOM (Canvas 2D en vez de leer
 * .scrollWidth de elementos reales) — se reusa un único contexto para todas
 * las mediciones. El font se copia del propio elemento destino para que la
 * medición sea exacta a lo que en verdad se va a renderizar.
 */
let ctxMedicionTexto = null;
function medirAnchoTexto(texto, elReferenciaEstilo) {
  if (!ctxMedicionTexto) ctxMedicionTexto = document.createElement("canvas").getContext("2d");
  const estilo = getComputedStyle(elReferenciaEstilo);
  ctxMedicionTexto.font = `${estilo.fontWeight} ${estilo.fontSize} ${estilo.fontFamily}`;
  return ctxMedicionTexto.measureText(texto).width;
}

/**
 * v1.9.8: en la tarjeta de lista (modo "tarjeta") el nombre de un requisito
 * nunca se corta con "…" (eso es exclusivo del nombre de la materia en el
 * encabezado — ver design-system.css). Si el ancho disponible no alcanza
 * NI PARA UNA PALABRA del nombre, se reemplaza el texto por solo el código;
 * si alcanza al menos una palabra, se deja el texto completo tal cual (el
 * `text-overflow:clip` del CSS lo recorta de forma limpia si aun así
 * desborda, sin puntos suspensivos). Se mide después de que la fila ya está
 * en el DOM real (requestAnimationFrame), para tener un ancho disponible
 * confiable.
 */
function programarAjusteAnchoRequisito(colNombreEl, codigo, textoCompleto) {
  requestAnimationFrame(() => {
    if (!colNombreEl.isConnected) return;
    const disponible = colNombreEl.clientWidth;
    if (disponible <= 0) return;

    const anchoCompleto = medirAnchoTexto(textoCompleto, colNombreEl);
    if (anchoCompleto <= disponible) {
      colNombreEl.textContent = textoCompleto; // cabe entero (ej. tras un resize que agrandó la pantalla)
      return;
    }

    const primeraPalabra = textoCompleto.split(" - ")[1]?.split(" ")[0] || "";
    const textoMinimo = primeraPalabra ? `${codigo} - ${primeraPalabra}` : codigo;
    const anchoMinimo = medirAnchoTexto(textoMinimo, colNombreEl);
    colNombreEl.textContent = anchoMinimo > disponible ? codigo : textoCompleto;
  });
}

// v1.9.8: reprocesa los nombres de requisito de las tarjetas visibles cuando
// cambia el ancho de pantalla (ej. rotar el teléfono), para que el ajuste de
// arriba nunca quede "pegado" a la medición original.
let resizeTimeoutRequisitos = null;
window.addEventListener("resize", () => {
  clearTimeout(resizeTimeoutRequisitos);
  resizeTimeoutRequisitos = setTimeout(() => {
    document.querySelectorAll(".requisito-fila-tarjeta .requisito-col-nombre").forEach((el) => {
      const codigo = el.dataset.codigo;
      if (!codigo) return;
      programarAjusteAnchoRequisito(el, codigo, el.title);
    });
  }, 150);
});

function construirFilaRequisito(codigo, opciones) {
  const modo = (opciones && opciones.modo) || "modal";
  const esTarjeta = modo === "tarjeta";

  const fila = document.createElement("div");
  fila.className = "requisito-fila" + (esTarjeta ? " requisito-fila-tarjeta" : "");

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);
  // v1.14.1: un requisito de texto libre (ej. "Bloque 9 completo", "90
  // créditos aprobados" — ver regla 4a del prompt de importación) nunca es
  // un código de materia real, así que buscarMateriaPorCodigoEnPlanes nunca
  // lo va a encontrar — eso no es un error de datos, así que el mensaje no
  // debe sonar como uno. Heurística simple: un código de materia real casi
  // nunca trae espacios (ej. "CE-1234"); un requisito de texto libre sí.
  const pareceTextoLibre = /\s/.test(codigo);

  const colNombre = document.createElement(pareceTextoLibre ? "span" : "a");
  if (!pareceTextoLibre) colNombre.href = "#";
  colNombre.className = "requisito-col-nombre" + (pareceTextoLibre ? "" : " link-plano");
  const textoNombre = encontrada
    ? `${codigo} - ${aplicarFormatoTexto(encontrada.materia.nombre)}`
    : pareceTextoLibre
    ? codigo
    : `${codigo} - (no encontrada en ningún plan visible)`;
  colNombre.title = textoNombre;
  colNombre.textContent = textoNombre;
  if (!pareceTextoLibre) {
    colNombre.addEventListener("click", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      abrirModalRequisito(codigo);
    });
  }
  fila.appendChild(colNombre);

  if (esTarjeta) {
    // v1.9.8: en la tarjeta de lista no va columna de créditos por
    // requisito (simplificación pedida en el prompt) — en su lugar se
    // programa el ajuste de ancho sin ellipsis descrito arriba.
    colNombre.dataset.codigo = codigo;
    programarAjusteAnchoRequisito(colNombre, codigo, textoNombre);
  } else {
    const colCreditos = document.createElement("span");
    colCreditos.className = "requisito-col-creditos";
    colCreditos.textContent = encontrada ? String(encontrada.materia.creditos) : "—";
    fila.appendChild(colCreditos);
  }

  return fila;
}

/**
 * v1.12 (Parte E): renderiza recursivamente UN nodo del árbol Y/O de
 * requisitos (hoja, o operador con hijos) — reemplaza el recorrido plano de
 * "grupos de alternativas". `profundidad` > 0 indica que este nodo es un
 * SUB-grupo anidado dentro de otro operador (el caso UCR: "(A;B)/(C;D)") —
 * se le agrega una sangría/borde sutil para dejar claro que es un bloque
 * combinado, no una alternativa suelta más.
 */

function construirNodoRequisito(nodo, modo, profundidad) {
  if (!nodo) return document.createDocumentFragment();

  if (nodo.tipo === "codigo") {
    return construirFilaRequisito(nodo.valor, { modo });
  }

  const cont = document.createElement("div");
  cont.className = "requisito-grupo";
  if (profundidad > 0) {
    // Sangría/borde sutil para un sub-grupo Y/O anidado dentro de otro
    // operador — no hay clase de diseño previa para esto, así que se marca
    // inline (mismo patrón que ya usa el resto del archivo para detalles
    // puntuales, ej. abrirModalDesbloquea).
    cont.style.borderLeft = "2px solid var(--separator, rgba(148,163,184,.35))";
    cont.style.paddingLeft = "10px";
    cont.style.marginLeft = "2px";
  }

  if (nodo.tipo === "O") {
    const etiqueta = document.createElement("p");
    etiqueta.className = "materia-req-linea";
    etiqueta.style.marginBottom = "2px";
    etiqueta.innerHTML = `<em>Uno de estos:</em>`;
    cont.appendChild(etiqueta);
  }

  nodo.hijos.forEach((hijo, i) => {
    cont.appendChild(construirNodoRequisito(hijo, modo, profundidad + 1));
    // Divisor visual solo entre alternativas ("O") — entre requisitos
    // distintos ("Y") no hace falta, ya quedan implícitos al ir cada uno
    // en su propia línea/bloque, igual que siempre en este proyecto.
    if (nodo.tipo === "O" && i < nodo.hijos.length - 1) {
      const divisorO = document.createElement("div");
      divisorO.className = "requisito-divisor-o";
      divisorO.textContent = "o";
      cont.appendChild(divisorO);
    }
  });

  return cont;
}

function construirBloqueRequisitos(etiqueta, nodoRaiz, modo) {
  const cont = document.createElement("div");

  // v5 #6 / v7 Bug 3: "Correquisitos" se omite POR COMPLETO si la materia no
  // tiene ninguno (nada de "Correquisitos: Ninguno"). "Requisitos" sí
  // conserva el texto "Ninguno" cuando está vacío, porque ahí siempre aplica.
  if (!nodoRaiz) {
    if (etiqueta === "Correquisitos") return cont;
    const p = document.createElement("p");
    p.className = "materia-req-linea";
    p.innerHTML = `<strong>${etiqueta}:</strong> Ninguno`;
    cont.appendChild(p);
    return cont;
  }

  const tituloLinea = document.createElement("p");
  tituloLinea.className = "materia-req-linea";
  tituloLinea.style.marginBottom = "2px";
  tituloLinea.innerHTML = `<strong>${etiqueta}:</strong>`;
  cont.appendChild(tituloLinea);

  cont.appendChild(construirNodoRequisito(nodoRaiz, modo, 0));

  return cont;
}

/**
 * v1.12.16 (Ajuste 2): si esta materia reemplazó un cupo genérico de
 * electiva/optativa (ver reemplazarCupoOptativa en plan-esquema.js), esta
 * línea pequeña y aparte recuerda de cuál cupo venía (ej. "Cupo original:
 * Repertorio") — null si nunca fue un cupo reemplazado. Se usa tanto en el
 * modal/tarjeta normal (construirBloqueCompletoRequisitos) como en la
 * tarjeta normal de lista (construirCuerpoDetalleTarjeta), siempre justo
 * debajo de Requisitos/Correquisitos, nunca mezclada con ellos.
 */
function construirEtiquetaCupoOriginal(materia) {
  if (!materia.cupo_generico_original) return null;
  const p = document.createElement("p");
  p.className = "muted";
  p.style.cssText = "margin-top:4px; font-size:0.85em;";
  p.textContent = `Cupo original: ${materia.cupo_generico_original}`;
  return p;
}

function construirBloqueCompletoRequisitos(materia, plan) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos));
  cont.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos));
  const etiquetaCupo = construirEtiquetaCupoOriginal(materia);
  if (etiquetaCupo) cont.appendChild(etiquetaCupo);
  return cont;
}

/**
 * B (v9)/v8 punto 2 — SOLO MODAL: arma lo que va debajo de la Línea 3
 * (Estado/Horas/Créditos) — Requisitos → Correquisitos → fila final de
 * botones ("Es requisito"/"Historial"/"Cerrar", los 3 como btn btn-primary).
 * v1.11: Bloque·Código y Categoría ya NO se arman aquí — se movieron a su
 * propia Línea 1, antes del título (ver construirLinea1Materia y
 * abrirModalRequisito). Desde v1.9.8 este layout ya NO lo comparte la
 * tarjeta de lista (ver construirCuerpoDetalleTarjeta, más abajo) — quedó
 * exclusivo del modal.
 */

function construirCuerpoDetalleModal(materia, plan) {
  const cont = document.createElement("div");
  cont.className = "stack";

  cont.appendChild(construirBloqueCompletoRequisitos(materia, plan));
  cont.appendChild(construirBotonesFinalesDetalle(materia, plan, { esModal: true }));

  return cont;
}

/**
 * v1.9.8: columna derecha del cuerpo de la tarjeta de lista — exactamente 3
 * elementos en una hilera vertical (Categoría → "Es requisito" → "Historial"),
 * anclados arriba a la derecha del interior de la tarjeta, totalmente
 * independientes del contenido de la columna de Requisitos/Correquisitos
 * (ver .materia-cuerpo-grid en design-system.css). A diferencia del modal:
 * - El badge de Categoría SIEMPRE aparece, incluso sin categoría asignada
 *   ("Sin categoría") — el modal en cambio la omite por completo si no tiene.
 * - "Es requisito"/"Historial" son botones reales del sistema (btn
 *   btn-secondary), nunca links de texto — y no incluye "Cerrar" (eso sigue
 *   siendo exclusivo del modal).
 */

function construirColumnaAccionesTarjeta(materia, plan) {
  const columna = document.createElement("div");
  columna.className = "materia-cuerpo-acciones";

  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  const badge = document.createElement("span");
  if (categoria) {
    badge.className = "badge";
    badge.style.cssText = estiloBadgeCategoria(categoria.color) + " cursor:pointer;";
    badge.textContent = categoria.nombre;
  } else {
    badge.className = "badge badge-neutral";
    badge.style.cursor = "pointer";
    badge.textContent = "Sin categoría";
  }
  badge.title = "Mantén presionado (o clic derecho) para cambiar la categoría";
  agregarLongPress(badge, () => abrirMenuRapidoCategoria(materia, plan, badge));
  columna.appendChild(badge);

  const botones = document.createElement("div");
  botones.className = "materia-acciones-botones";

  const btnEsRequisito = document.createElement("button");
  btnEsRequisito.type = "button";
  btnEsRequisito.className = "btn btn-secondary";
  btnEsRequisito.textContent = "Es requisito";
  btnEsRequisito.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalDesbloquea(materia, plan);
  });
  botones.appendChild(btnEsRequisito);

  const btnHistorial = document.createElement("button");
  btnHistorial.type = "button";
  btnHistorial.className = "btn btn-secondary";
  btnHistorial.textContent = "Historial";
  btnHistorial.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalHistorial(materia, plan);
  });
  botones.appendChild(btnHistorial);

  columna.appendChild(botones);

  return columna;
}

/**
 * v1.9.8: cuerpo de la tarjeta de lista — grid de 2 columnas. Columna 1:
 * Requisitos/Correquisitos (sin créditos, sin "Bloque X · Código", que se
 * quita por completo aquí). Columna 2: construirColumnaAccionesTarjeta.
 * Ya NO comparte código de armado con el modal (construirCuerpoDetalleModal)
 * más allá de construirBloqueRequisitos, que sí siguen usando ambos con su
 * propio `modo`.
 */

function construirCuerpoDetalleTarjeta(materia, plan) {
  const grid = document.createElement("div");
  grid.className = "materia-cuerpo-grid";

  const colRequisitos = document.createElement("div");
  colRequisitos.className = "materia-cuerpo-requisitos stack";
  colRequisitos.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos, "tarjeta"));
  colRequisitos.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos, "tarjeta"));
  const etiquetaCupo = construirEtiquetaCupoOriginal(materia);
  if (etiquetaCupo) colRequisitos.appendChild(etiquetaCupo);
  grid.appendChild(colRequisitos);

  grid.appendChild(construirColumnaAccionesTarjeta(materia, plan));

  return grid;
}

/**
 * v1.9.8: punto de entrada único que decide cuál de los dos diseños armar
 * según `opciones.modo` ("tarjeta" | "modal") — ya NO arma un layout
 * compartido como antes (ver nota grande al inicio del archivo). Se
 * mantiene compatibilidad con el llamado viejo `{ esModal: false }` →
 * "tarjeta" / `{ esModal: true }` → "modal" por si queda algún otro
 * llamador de este archivo que aún no se haya actualizado.
 */

function construirCuerpoDetalleMateria(materia, plan, opciones) {
  const modo = (opciones && opciones.modo) || (opciones && opciones.esModal === false ? "tarjeta" : "modal");
  return modo === "tarjeta" ? construirCuerpoDetalleTarjeta(materia, plan) : construirCuerpoDetalleModal(materia, plan);
}

/* ===================== Modal de requisito (navegable) ===================== */

// Bug Mochi (2026-08-21): cuando "Es requisito"/"Historial" se disparan
// desde DENTRO de #modal-requisito, ese modal se cierra primero (ver
// construirBotonesFinalesDetalle) para no apilar dos overlays. Este flag
// recuerda que hay que "volver" a mostrarlo si Desbloquea/Historial se
// cierran sin elegir nada, para no perder la tarjeta de origen. Se resetea
// cada vez que abrirModalRequisito() abre contenido nuevo "en frío" (ya sea
// por navegación hacia adelante o por una apertura no relacionada), así
// nunca queda una reapertura fantasma pendiente de un flujo viejo.
let volverAModalRequisitoAlCerrar = false;

function abrirModalRequisito(codigo) {
  volverAModalRequisitoAlCerrar = false;

  const modalCard = document.querySelector("#modal-requisito .modal-card");
  const franjaVieja = modalCard.querySelector(".franja-categoria");
  if (franjaVieja) franjaVieja.remove();

  const contenedorFinal = document.getElementById("requisito-contenedor-final");
  contenedorFinal.innerHTML = "";

  // v1.11: Línea 1 (Bloque·Código + Categoría) vive fuera de contenedorFinal,
  // antes del título — se limpia/rearma en cada apertura del modal.
  const linea1Cont = document.getElementById("requisito-linea1");
  linea1Cont.innerHTML = "";

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);

  if (!encontrada) {
    document.getElementById("requisito-titulo").textContent = "Materia no encontrada";

    const p = document.createElement("p");
    p.className = "materia-req-linea";
    p.textContent = `${codigo} — no está importada en ningún plan visible todavía.`;
    contenedorFinal.appendChild(p);

    const filaCerrar = document.createElement("div");
    filaCerrar.className = "row";
    filaCerrar.style.justifyContent = "flex-end";
    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.className = "btn btn-primary";
    btnCerrar.textContent = "Cerrar";
    btnCerrar.addEventListener("click", () => document.getElementById("modal-requisito").classList.add("oculto"));
    filaCerrar.appendChild(btnCerrar);
    contenedorFinal.appendChild(filaCerrar);
  } else {
    const { materia, plan } = encontrada;
    const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
    const disponible = materiaDisponible(materia, plan.materias);

    const franja = document.createElement("div");
    franja.className = "franja-categoria";
    franja.style.background = categoria ? categoria.color : "var(--gradient-accent)";
    modalCard.insertBefore(franja, modalCard.firstChild);

    // v1.11: Línea 1 (Bloque·Código + Categoría), antes del título.
    linea1Cont.appendChild(construirLinea1Materia(materia, plan));

    // ---- Encabezado de 2 líneas (B/v8 punto 2), igual que en la tarjeta ----
    const luzTitulo = document.createElement("span");
    luzTitulo.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
    luzTitulo.style.marginRight = "8px";
    const tituloEl = document.getElementById("requisito-titulo");
    tituloEl.textContent = "";
    tituloEl.appendChild(luzTitulo);
    tituloEl.appendChild(document.createTextNode(aplicarFormatoTexto(materia.nombre)));

    // Línea 2: el modal siempre muestra el detalle completo (nunca compacto).
    contenedorFinal.appendChild(construirLinea2Materia(materia, false, plan));

    // Requisitos, Correquisitos y la fila final de botones ("Es requisito"/
    // "Historial"/"Cerrar") — diseño exclusivo del modal desde v1.9.8 (ver
    // construirCuerpoDetalleModal). Bloque·Código/Categoría van aparte,
    // en Línea 1 (ver arriba, construirLinea1Materia).
    contenedorFinal.appendChild(construirCuerpoDetalleMateria(materia, plan, { modo: "modal" }));
  }

  document.getElementById("modal-requisito").classList.remove("oculto");
}

/* ===================== Modal "Desbloquea" (búsqueda inversa) ===================== */

function abrirModalDesbloquea(materia, plan) {
  document.getElementById("titulo-modal-desbloquea").textContent = `${aplicarFormatoTexto(materia.nombre)} es requisito para:`;
  const cont = document.getElementById("lista-modal-desbloquea");
  cont.innerHTML = "";

  const resultado = obtenerMateriasQueDesbloquea(materia, plan);
  if (resultado.length === 0) {
    cont.innerHTML = `<p class="muted">Esta materia no es requisito de ninguna otra.</p>`;
  } else {
    resultado.forEach((m) => {
      const filaResultado = document.createElement("div");
      filaResultado.className = "glass-panel row";
      filaResultado.style.padding = "8px 12px";
      filaResultado.style.cursor = "pointer";
      filaResultado.innerHTML = `
        <strong style="font-family:var(--font-mono, monospace); width:80px; flex-shrink:0;">${m.codigo}</strong>
        <span style="flex:1;">${m.nombre}</span>
        <span class="badge badge-neutral">${plan.parametros_universidad.nombre_bloque} ${m.bloque}</span>
      `;
      filaResultado.addEventListener("click", () => {
        document.getElementById("modal-desbloquea").classList.add("oculto");
        abrirModalRequisito(m.codigo);
      });
      cont.appendChild(filaResultado);
    });
  }

  document.getElementById("modal-desbloquea").classList.remove("oculto");
}

/**
 * Comunidad — Parte 2: ya NO es un stub — cruza esta materia (materia.id +
 * plan.id) contra TODOS los semestres del historial (ver
 * obtenerIntentosMateria en schema.js) y muestra cada intento real:
 * semestre, estado efectivo de ESE intento (cursando/aprobada/reprobada —
 * mismo criterio que usa semestres-tarjetas.js, nunca materia.estado plano
 * porque eso es el estado STICKY del Plan, no de un intento puntual), nota
 * final si ya se calculó, y el profesor de esa materia en ese semestre —
 * con la posibilidad de asignar uno existente o crear uno nuevo al vuelo
 * (requerimiento "Comunidad" 4a: alta/asignación de profesor también desde
 * acá, además de la pestaña Profesores y el alta de semestre).
 */
function abrirModalHistorial(materia, plan) {
  // Pedido explícito (2026-08-09): antes el título era "Historial — Nombre"
  // en una sola línea de texto plano. Ahora el título vuelve a ser solo
  // "Historial" (misma fuente/tamaño de siempre, sin tocar el elemento) y
  // el nombre de la materia se muestra aparte, como una tarjetita compacta
  // justo debajo (ver construirTarjetaMateriaHistorial) — mismo lenguaje
  // visual que ya usan las materias vinculadas dentro de un profesor en
  // Comunidad (franja de color de categoría + nombre), pero simplificada.
  document.getElementById("titulo-modal-historial").textContent = "Historial";
  renderizarCuerpoModalHistorial(materia, plan);
  document.getElementById("modal-historial").classList.remove("oculto");
}

/**
 * Tarjetita compacta de la materia dentro del modal de Historial (pedido
 * explícito 2026-08-09): mismo lenguaje visual que
 * construirMiniTarjetaMateriaVinculada (comunidad.js) — franja de color de
 * la categoría a la izquierda (box-shadow inset) sobre un glass-panel — pero
 * simplificada a SOLO el nombre: acá no hay nota ni semestre que mostrar
 * (es un resumen de la materia en sí, no de un intento puntual como sí lo
 * son las filas de abajo).
 */
function construirTarjetaMateriaHistorial(materia, plan) {
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);

  const mini = document.createElement("div");
  mini.className = "glass-panel";
  mini.style.cssText =
    "padding:8px 12px; width:100%; box-sizing:border-box; margin-bottom:10px;" +
    (categoria ? ` box-shadow: inset 4px 0 0 0 ${categoria.color};` : "");

  const nombre = document.createElement("span");
  // Fix centrado vertical (ajuste pedido): .materia-nombre trae
  // "position:relative; top:-3px" calibrado para cuando comparte fila con
  // .materia-prefijo (la luz + código, con otra métrica de línea) — acá el
  // nombre va SOLO en la tarjetita, sin prefijo al lado, así que ese offset
  // ya no compensa nada y lo deja visualmente descentrado. Se resetea acá
  // mismo (no en la clase compartida, que sigue siendo correcta en el resto
  // de usos de .materia-nombre).
  nombre.className = "materia-nombre truncada";
  nombre.style.cssText = "display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; top:0;";
  nombre.textContent = aplicarFormatoTexto(materia.nombre);
  mini.appendChild(nombre);

  return mini;
}

function renderizarCuerpoModalHistorial(materia, plan) {
  const cont = document.getElementById("cuerpo-modal-historial");
  cont.innerHTML = "";
  cont.appendChild(construirTarjetaMateriaHistorial(materia, plan));

  const intentos = obtenerIntentosMateria(materia.id, plan.id, estado.datos);
  if (intentos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Aún no has cursado esta materia en ningún semestre registrado.";
    cont.appendChild(vacio);
    return;
  }

  const listaCont = document.createElement("div");
  listaCont.className = "stack";

  intentos.forEach(({ semestre, mm }) => {
    listaCont.appendChild(construirFilaIntentoHistorial(materia, plan, semestre, mm));
  });

  cont.appendChild(listaCont);
}

/** Una fila del historial: un semestre concreto en que se cursó esta materia. */
function construirFilaIntentoHistorial(materia, plan, semestre, mm) {
  const fila = document.createElement("div");
  fila.className = "glass-panel stack";
  fila.style.padding = "12px 14px";
  // Pedido explícito (2026-08-09): el gap por defecto de .stack (14px) se
  // sentía "muy grande" entre Semestre/Nota final y entre Nota final/
  // Profesor — se reduce un 50% (14px -> 7px). Como los 3 bloques
  // (encabezado, notaP, bloque de profesor) son hijos DIRECTOS de esta
  // misma fila-stack, un solo gap acá cubre ambos espacios pedidos a la vez.
  fila.style.gap = "7px";

  // Mismo criterio que semestres-tarjetas.js: mientras el semestre siga
  // "actual" es Cursando; si ya terminó, se lee mm.resultado (el resultado
  // REAL de ese intento puntual, que puede no coincidir con el estado
  // actual del Plan si la materia se repitió después).
  const semestreActual = obtenerEstadoEfectivoSemestre(semestre) === "actual";
  const infoEstado = semestreActual
    ? { texto: "Cursando", badge: "badge-warning" }
    : mm.resultado === "aprobada"
    ? { texto: "Aprobada", badge: "badge-success" }
    : mm.resultado === "reprobada"
    ? { texto: "Reprobada", badge: "badge-danger" }
    : { texto: "Sin cerrar", badge: "badge-neutral" };

  // Pedido explícito (2026-08-09): "Semestre" al 150% del tamaño de letra
  // normal, y clic en el nombre del semestre navega a Semestres con scroll
  // suave hasta esa tarjeta (navegarASemestre ya se encarga del scroll
  // animado — ver semestres.js). "Nota Final" arrancó también en 150% pero
  // se redujo un 30% después (pedido explícito, mismo día): 1.5em * 0.7 =
  // 1.05em — ver notaP más abajo y nombreProfesor en
  // construirBloqueProfesorIntento, que replica el mismo tamaño.
  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.justifyContent = "space-between";
  encabezado.style.alignItems = "center";

  const nombreSemestre = document.createElement("strong");
  nombreSemestre.style.cssText =
    "font-size:1.5em; cursor:pointer; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  nombreSemestre.textContent = aplicarFormatoTexto(semestre.nombre);
  nombreSemestre.title = "Ir a este semestre";
  nombreSemestre.addEventListener("click", (e) => {
    e.stopPropagation();
    document.getElementById("modal-requisito").classList.add("oculto");
    document.getElementById("modal-historial").classList.add("oculto");
    // Navegación explícita hacia otra sección (Semestres): no es un
    // "cerrar sin elegir nada", así que no debe quedar pendiente una
    // reapertura fantasma de modal-requisito la próxima vez que se cierre
    // algo (ver volverAModalRequisitoAlCerrar).
    volverAModalRequisitoAlCerrar = false;
    navegarASemestre(semestre.id);
  });
  encabezado.appendChild(nombreSemestre);

  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.style.flexShrink = "0";
  badgeEstado.textContent = infoEstado.texto;
  encabezado.appendChild(badgeEstado);

  fila.appendChild(encabezado);

  if (typeof mm.nota_final === "number") {
    const notaP = document.createElement("p");
    notaP.className = "muted";
    notaP.style.cssText = "margin:0; font-size:1.05em;"; // -30% sobre el 1.5em original
    notaP.textContent = `Nota final: ${formatearNotaTruncada(mm.nota_final)}`;
    fila.appendChild(notaP);
  }

  fila.appendChild(construirBloqueProfesorIntento(materia, plan, semestre, mm));

  return fila;
}

/**
 * Bloque de profesor DENTRO de un intento del historial. 2026-08-09
 * (pedido explícito, confirmado): "Calificación" y "¿Volverías a
 * llevarlo?" se eliminan por completo de acá — esa información ya se
 * guarda POR PROFESOR (profesor.calificacion / profesor.volveria_a_llevar,
 * ver comunidad.js), así que mm.calificacion_profesor y
 * mm.volveria_a_llevar_profesor quedan como campos legados sin UI (ya se
 * limpian defensivamente en otros lados cuando se desvincula el último
 * profesor de una mm — ver comunidad.js).
 *
 * El viejo <select> nativo "Agregar otro profesor" también se elimina —
 * reemplazado por un botón discreto "Vincular profe"/"+ Agregar profesor"
 * que abre abrirModalAsignarProfesorDesdeHistorial: una ventana con
 * tarjetitas de profesores existentes + "+ Nuevo profesor" (que abre el
 * alta de Comunidad con esta materia/semestre ya preseleccionados).
 */
function construirBloqueProfesorIntento(materia, plan, semestre, mm) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.style.marginTop = "4px";

  if (!Array.isArray(mm.profesor_ids)) mm.profesor_ids = [];
  const profesoresVinculados = mm.profesor_ids
    .map((id) => (estado.datos.profesores || []).find((p) => p.id === id))
    .filter(Boolean);

  const reRenderizar = () => renderizarCuerpoModalHistorial(materia, plan);

  // ---------- Lista de profesores ya vinculados, uno por línea ----------
  profesoresVinculados.forEach((profesor) => {
    const filaProfesor = document.createElement("div");
    filaProfesor.className = "row";
    filaProfesor.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";

    const nombreProfesor = document.createElement("span");
    // Mismo tamaño que "Nota Final" (pedido explícito) + truncado en vez
    // de saltar de línea cuando el nombre es largo. -30% aplicado igual que
    // en notaP (1.5em -> 1.05em) para mantenerlos idénticos entre sí.
    nombreProfesor.style.cssText =
      "font-size:1.05em; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
    nombreProfesor.textContent = `👤 ${profesor.nombre}`;
    filaProfesor.appendChild(nombreProfesor);

    // Botón discreto (ícono), NO el btn btn-secondary ancho de antes.
    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn-icono-quitar";
    btnQuitar.title = "Desvincular a este profesor";
    btnQuitar.setAttribute("aria-label", "Desvincular a este profesor");
    btnQuitar.textContent = "🗑";
    btnQuitar.addEventListener("click", () => {
      // Solo saca a ESTE profesor puntual — los demás vinculados a la
      // misma materia quedan intactos.
      mm.profesor_ids = mm.profesor_ids.filter((id) => id !== profesor.id);
      if (mm.profesor_ids.length === 0) {
        mm.calificacion_profesor = null;
        mm.volveria_a_llevar_profesor = null;
      }
      sellarTimestamp(mm);
      marcarCambioPendiente();
      reRenderizar();
    });
    filaProfesor.appendChild(btnQuitar);
    cont.appendChild(filaProfesor);
  });

  // ---------- Botón discreto para vincular (el primero) o agregar otro ----------
  // Pedido explícito (2026-08-09): "hazlo mas discreto, no tan gordo" — se
  // saca btn-block (ancho completo) y se achica a padding/font-size chicos,
  // alineado a la izquierda por su propio contenido (mismo criterio visual
  // que btnEditar en construirTarjetaProfesor, comunidad.js).
  const btnVincular = document.createElement("button");
  btnVincular.type = "button";
  btnVincular.className = "btn btn-secondary";
  btnVincular.style.cssText =
    `align-self:flex-start; padding:6px 14px; font-size:0.82rem; margin-top:${profesoresVinculados.length > 0 ? "6px" : "0"};`;
  btnVincular.textContent = profesoresVinculados.length === 0 ? "Vincular profe" : "+ Agregar profesor";
  btnVincular.addEventListener("click", () => {
    abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, reRenderizar);
  });
  cont.appendChild(btnVincular);

  return cont;
}

/**
 * Ventana de selección de profesor para vincular a esta materia/semestre
 * puntual (mm), reemplazo del viejo <select> nativo. Muestra los
 * profesores existentes como tarjetitas clickeables (elegir = vincular al
 * toque, sin botón de confirmar aparte) + "+ Nuevo profesor", que abre el
 * alta de profesor de Comunidad con esta materia ya preseleccionada (ver
 * registrarAbrirAltaProfesorPreseleccionado más abajo — evita un import
 * circular con comunidad.js). Exportada porque también la usa el ícono 👤
 * de la tarjeta de materia en Semestres (ver semestres-tarjetas.js,
 * abrirPopoverProfesoresMateria) — mismo flujo de vincular, dos puntos de
 * entrada distintos.
 */
let _abrirAltaProfesorPreseleccionado = null;
function registrarAbrirAltaProfesorPreseleccionado(fn) {
  _abrirAltaProfesorPreseleccionado = fn;
}

function abrirModalAsignarProfesorDesdeHistorial(mm, materia, plan, semestre, onVinculado) {
  document.querySelectorAll(".overlay-asignar-profesor-historial").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "overlay-asignar-profesor-historial";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:330; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:420px; width:100%; padding:18px; max-height:80vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  caja.innerHTML = `<h2 style="margin:0;">Vincular profesor</h2><p class="muted" style="margin:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${aplicarFormatoTexto(
    materia.nombre
  )} — ${aplicarFormatoTexto(semestre.nombre)}</p>`;

  const yaVinculados = Array.isArray(mm.profesor_ids) ? mm.profesor_ids : [];
  const disponibles = (estado.datos.profesores || [])
    .filter((p) => !yaVinculados.includes(p.id))
    .slice()
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  function elegir(profesorId) {
    if (!mm.profesor_ids.includes(profesorId)) mm.profesor_ids.push(profesorId);
    sellarTimestamp(mm);
    marcarCambioPendiente();
    overlay.remove();
    if (onVinculado) onVinculado();
  }

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "6px";

  if (disponibles.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.margin = "0";
    p.textContent = "No tenés más profesores registrados para elegir.";
    lista.appendChild(p);
  } else {
    disponibles.forEach((profesor) => {
      const tarjeta = document.createElement("button");
      tarjeta.type = "button";
      tarjeta.className = "glass-panel row";
      tarjeta.style.cssText =
        "padding:10px 12px; align-items:center; gap:10px; width:100%; box-sizing:border-box; text-align:left; cursor:pointer; color:inherit; font:inherit; border:1px solid transparent;";
      const nombre = document.createElement("span");
      nombre.style.cssText = "flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
      nombre.textContent = `👤 ${profesor.nombre}`;
      tarjeta.appendChild(nombre);
      tarjeta.addEventListener("click", () => elegir(profesor.id));
      lista.appendChild(tarjeta);
    });
  }
  caja.appendChild(lista);

  const btnNuevo = document.createElement("button");
  btnNuevo.type = "button";
  btnNuevo.className = "btn btn-secondary btn-block";
  btnNuevo.style.marginTop = "8px";
  btnNuevo.textContent = "+ Nuevo profesor";
  btnNuevo.addEventListener("click", () => {
    overlay.remove();
    if (_abrirAltaProfesorPreseleccionado) {
      _abrirAltaProfesorPreseleccionado(mm.id, onVinculado);
    }
  });
  caja.appendChild(btnNuevo);

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary btn-block";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", () => overlay.remove());
  caja.appendChild(btnCancelar);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// Bug Mochi (2026-08-21): cierre único de Desbloquea — si se llegó acá desde
// #modal-requisito (ver volverAModalRequisitoAlCerrar), reabre esa tarjeta
// en vez de dejar la pantalla sin ningún modal visible. Cubre las 3 formas
// de cerrar: botón "Cerrar", clic afuera, y el "X" genérico de
// componentes.js (que dispara un clic sintético sobre el propio overlay,
// atrapado por el listener de clic-afuera de más abajo).
function cerrarModalDesbloquea() {
  document.getElementById("modal-desbloquea").classList.add("oculto");
  if (volverAModalRequisitoAlCerrar) {
    volverAModalRequisitoAlCerrar = false;
    document.getElementById("modal-requisito").classList.remove("oculto");
  }
}

function inicializarModalDesbloquea() {
  document.getElementById("btn-cerrar-desbloquea").addEventListener("click", () => {
    cerrarModalDesbloquea();
  });
  document.getElementById("modal-desbloquea").addEventListener("click", (e) => {
    if (e.target.id === "modal-desbloquea") cerrarModalDesbloquea();
  });
}

/**
 * v11 (migración a módulos): antes vivía suelto dentro del
 * window.addEventListener("DOMContentLoaded", …) de plan.js. Desde v8
 * punto 2 / v9, "Es requisito", "Historial" y "Cerrar" ya NO son botones
 * estáticos del HTML — se arman dinámicamente dentro de
 * #requisito-contenedor-final cada vez que se abre el modal (ver
 * construirBotonesFinalesDetalle/abrirModalRequisito), cada uno con su
 * propio listener ya adjunto al crearse. Lo único que queda por wirear una
 * sola vez es el clic-afuera-cierra del modal en sí.
 */
function inicializarModalRequisito() {
  document.getElementById("modal-requisito").addEventListener("click", (e) => {
    if (e.target.id === "modal-requisito") e.target.classList.add("oculto");
  });
}

// Bug Mochi (2026-08-21): mismo mecanismo de "volver" que cerrarModalDesbloquea.
function cerrarModalHistorial() {
  document.getElementById("modal-historial").classList.add("oculto");
  if (volverAModalRequisitoAlCerrar) {
    volverAModalRequisitoAlCerrar = false;
    document.getElementById("modal-requisito").classList.remove("oculto");
  }
}

/** v11 (migración a módulos): cierre del modal de historial, antes suelto en el DOMContentLoaded de plan.js. */
function inicializarModalHistorial() {
  document.getElementById("btn-cerrar-historial").addEventListener("click", () => {
    cerrarModalHistorial();
  });
  document.getElementById("modal-historial").addEventListener("click", (e) => {
    if (e.target.id === "modal-historial") cerrarModalHistorial();
  });
}

export {
  abrirModalDesbloquea,
  abrirModalHistorial,
  abrirModalRequisito,
  construirBloqueCompletoRequisitos,
  construirBloqueRequisitos,
  construirBotonesFinalesDetalle,
  construirColumnaAccionesTarjeta,
  construirCuerpoDetalleMateria,
  construirCuerpoDetalleModal,
  construirCuerpoDetalleTarjeta,
  construirFilaRequisito,
  construirLinea1Materia,
  construirLinea2Materia,
  construirLineaCategoriaMateria,
  construirMetaLineaMateria,
  construirNodoRequisito,
  inicializarModalDesbloquea,
  inicializarModalHistorial,
  inicializarModalRequisito,
  abrirModalAsignarProfesorDesdeHistorial,
  registrarAbrirAltaProfesorPreseleccionado,
};
