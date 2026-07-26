/* =========================================================================
   PLAN DE ESTUDIOS — MODAL DE DETALLE UNIFICADO
   Modal de requisito navegable, búsqueda inversa ("Desbloquea"), e
   historial.
   ========================================================================= */

import { estado } from "../core/storage.js";
import { aplicarFormatoTexto, estiloBadgeCategoria, formatearHoras, formatearHorasCompactoIniciales } from "../core/utils.js";
import { agregarLongPress } from "../ui/componentes.js";
import { buscarMateriaPorCodigoEnPlanes } from "./plan-esquema.js";
import { ESTADOS_MATERIA, abrirMenuRapidoCategoria, materiaDisponible, obtenerMateriasQueDesbloquea } from "./plan-vista-lista-tarjetas.js";

/** Requisitos/correquisitos agrupados: "o" dentro de un grupo, grupos en líneas separadas ("y" implícito). */

/**
 * B (v9)/v8 punto 2: Línea 2 del encabezado, compartida entre la tarjeta
 * (colapsada y expandida) y el modal — Estado a la izquierda, Horas al
 * centro, Créditos a la derecha. `compacto=true` usa las iniciales de cada
 * tipo de hora (tarjeta colapsada); `compacto=false` usa la palabra
 * completa (tarjeta expandida y modal, que siempre se consideran "el
 * detalle completo").
 */

function construirLinea2Materia(materia, compacto) {
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];

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
  btnEsRequisito.className = "link-plano";
  btnEsRequisito.textContent = "Es requisito";
  btnEsRequisito.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalDesbloquea(materia, plan);
  });
  fila.appendChild(btnEsRequisito);

  const btnHistorial = document.createElement("button");
  btnHistorial.type = "button";
  btnHistorial.className = "link-plano";
  btnHistorial.textContent = "Historial";
  btnHistorial.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalHistorial(materia);
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

function construirFilaRequisito(codigo) {
  const fila = document.createElement("div");
  fila.className = "requisito-fila";

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);

  const colNombre = document.createElement("a");
  colNombre.href = "#";
  colNombre.className = "requisito-col-nombre link-plano";
  const textoNombre = encontrada
    ? `${codigo} - ${aplicarFormatoTexto(encontrada.materia.nombre)}`
    : `${codigo} - (no encontrada en ningún plan visible)`;
  colNombre.title = textoNombre;
  colNombre.textContent = textoNombre;
  colNombre.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    abrirModalRequisito(codigo);
  });
  fila.appendChild(colNombre);

  const colCreditos = document.createElement("span");
  colCreditos.className = "requisito-col-creditos";
  colCreditos.textContent = encontrada ? String(encontrada.materia.creditos) : "—";
  fila.appendChild(colCreditos);

  return fila;
}

function construirBloqueRequisitos(etiqueta, grupos) {
  const cont = document.createElement("div");
  const sinItems = !grupos || grupos.length === 0;

  // v5 #6 / v7 Bug 3: "Correquisitos" se omite POR COMPLETO si la materia no
  // tiene ninguno (nada de "Correquisitos: Ninguno"). La condición es
  // exactamente `grupos.length === 0` — nunca se compara contra "" ni contra
  // ningún otro tipo de dato, así que solo se oculta cuando de verdad está
  // vacío. "Requisitos" sí conserva el texto "Ninguno" cuando está vacío,
  // porque ahí siempre aplica.
  if (sinItems) {
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

  grupos.forEach((grupo) => {
    (grupo || []).forEach((codigo, i) => {
      cont.appendChild(construirFilaRequisito(codigo));
      // Alternativas dentro del mismo grupo ("O"): un separador entre filas.
      // Entre grupos distintos no hay separador (el "Y" queda implícito).
      if (i < grupo.length - 1) {
        const divisorO = document.createElement("div");
        divisorO.className = "requisito-divisor-o";
        divisorO.textContent = "o";
        cont.appendChild(divisorO);
      }
    });
  });

  return cont;
}

function construirBloqueCompletoRequisitos(materia, plan) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos));
  cont.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos));
  return cont;
}

/**
 * B (v9)/v8 punto 2: arma TODO lo que va debajo del encabezado de 2 líneas,
 * en el mismo orden y con el mismo diseño tanto en la tarjeta expandida
 * como en el modal — Bloque·Código → Categoría (si tiene) → Requisitos →
 * Correquisitos → fila final de botones. `opciones.esModal` solo cambia si
 * se agrega "Cerrar" al final (ver construirBotonesFinalesDetalle).
 */

function construirCuerpoDetalleMateria(materia, plan, opciones) {
  const cont = document.createElement("div");
  cont.className = "stack";

  cont.appendChild(construirMetaLineaMateria(materia, plan));

  const lineaCategoria = construirLineaCategoriaMateria(materia, plan);
  if (lineaCategoria) cont.appendChild(lineaCategoria);

  cont.appendChild(construirBloqueCompletoRequisitos(materia, plan));
  cont.appendChild(construirBotonesFinalesDetalle(materia, plan, opciones));

  return cont;
}

/* ===================== Modal de requisito (navegable) ===================== */

function abrirModalRequisito(codigo) {
  const modalCard = document.querySelector("#modal-requisito .modal-card");
  const franjaVieja = modalCard.querySelector(".franja-categoria");
  if (franjaVieja) franjaVieja.remove();

  const contenedorFinal = document.getElementById("requisito-contenedor-final");
  contenedorFinal.innerHTML = "";

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

    // ---- Encabezado de 2 líneas (B/v8 punto 2), igual que en la tarjeta ----
    const luzTitulo = document.createElement("span");
    luzTitulo.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
    luzTitulo.style.marginRight = "8px";
    const tituloEl = document.getElementById("requisito-titulo");
    tituloEl.textContent = "";
    tituloEl.appendChild(luzTitulo);
    tituloEl.appendChild(document.createTextNode(aplicarFormatoTexto(materia.nombre)));

    // Línea 2: el modal siempre muestra el detalle completo (nunca compacto).
    contenedorFinal.appendChild(construirLinea2Materia(materia, false));

    // Bloque·Código, Categoría, Requisitos, Correquisitos y la fila final de
    // botones ("Es requisito"/"Historial"/"Cerrar") — mismo bloque que usa
    // la tarjeta expandida.
    contenedorFinal.appendChild(construirCuerpoDetalleMateria(materia, plan, { esModal: true }));
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
 * v7 #4: muestra el registro de todas las veces que se ha cursado esta
 * materia (reprobada semestre X, aprobada semestre Y, etc.). El módulo de
 * Semestres todavía no existe, así que por ahora siempre muestra el estado
 * vacío — queda listo para conectarse en cuanto exista esa información, sin
 * dejar el botón "Historial" fuera del layout mientras tanto.
 */

function abrirModalHistorial(materia) {
  document.getElementById("titulo-modal-historial").textContent = `Historial — ${aplicarFormatoTexto(materia.nombre)}`;
  const cont = document.getElementById("cuerpo-modal-historial");
  cont.innerHTML = `<p class="muted">Aún no tienes semestres registrados.</p>`;
  document.getElementById("modal-historial").classList.remove("oculto");
}

function inicializarModalDesbloquea() {
  document.getElementById("btn-cerrar-desbloquea").addEventListener("click", () => {
    document.getElementById("modal-desbloquea").classList.add("oculto");
  });
  document.getElementById("modal-desbloquea").addEventListener("click", (e) => {
    if (e.target.id === "modal-desbloquea") e.target.classList.add("oculto");
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

/** v11 (migración a módulos): cierre del modal de historial, antes suelto en el DOMContentLoaded de plan.js. */
function inicializarModalHistorial() {
  document.getElementById("btn-cerrar-historial").addEventListener("click", () => {
    document.getElementById("modal-historial").classList.add("oculto");
  });
  document.getElementById("modal-historial").addEventListener("click", (e) => {
    if (e.target.id === "modal-historial") e.target.classList.add("oculto");
  });
}

export {
  abrirModalDesbloquea,
  abrirModalHistorial,
  abrirModalRequisito,
  construirBloqueCompletoRequisitos,
  construirBloqueRequisitos,
  construirBotonesFinalesDetalle,
  construirCuerpoDetalleMateria,
  construirFilaRequisito,
  construirLinea2Materia,
  construirLineaCategoriaMateria,
  construirMetaLineaMateria,
  inicializarModalDesbloquea,
  inicializarModalHistorial,
  inicializarModalRequisito,
};
