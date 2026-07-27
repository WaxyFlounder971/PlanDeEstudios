/* =========================================================================
   PLAN DE ESTUDIOS — CATEGORÍAS
   CRUD de categorías y el modal de asignación masiva a materias.
   ========================================================================= */

import { crearCategoria } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { estiloBadgeCategoria } from "../core/utils.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { obtenerPlanActivo } from "./plan-esquema.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

estado.categoriaEditandoId = null;
estado.planCategoriaEditandoId = null;     // a qué plan pertenece la categoría que se edita
estado.busquedaCategoriaMaterias = "";
estado.ordenCategoriaMaterias = "bloque";
// FIX (v1.9.6, bug "el buscador borra la selección"): fuente de verdad de
// qué materias están marcadas MIENTRAS se arma la asignación — antes el
// checked de cada checkbox se derivaba en cada re-render de
// `materia.categoria_id === categoria.id`, pero categoria_id recién se
// actualiza al confirmar. Como el buscador (y el cambio de orden) volvían a
// dibujar la lista completa desde cero en cada tecla, cualquier marca hecha
// en la sesión actual (todavía no guardada) se perdía. Ahora el checked se
// lee de este Set, que persiste durante todo el flujo del modal sin
// importar cuántas veces se re-renderice la lista.
estado.materiasCategoriaSeleccionadas = new Set();

/* ===================== Categorías: crear / filtrar / editar ===================== */

function construirPanelCategorias() {
  const principal = obtenerPlanActivo();
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const fila = document.createElement("div");
  fila.className = "row-between";
  const h3 = document.createElement("h2");
  h3.style.margin = "0";
  h3.textContent = "Categorías";
  fila.appendChild(h3);

  const btnAgregar = document.createElement("button");
  btnAgregar.className = "btn btn-primary";
  btnAgregar.textContent = "+ Agregar categoría";
  btnAgregar.addEventListener("click", () => abrirModalCategoria(null, principal));
  fila.appendChild(btnAgregar);
  sec.appendChild(fila);

  if (estado.filtroCategoriaId) {
    const cat = principal.categorias.find((c) => c.id === estado.filtroCategoriaId);
    const filtroActivo = document.createElement("div");
    filtroActivo.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge badge-accent";
    badge.textContent = `Filtrando: ${cat ? cat.nombre : "—"}`;
    const btnX = document.createElement("button");
    btnX.className = "btn btn-secondary";
    btnX.textContent = "× Quitar filtro";
    btnX.addEventListener("click", () => {
      estado.filtroCategoriaId = null;
      renderizarPlanEstudios();
    });
    filtroActivo.appendChild(badge);
    filtroActivo.appendChild(btnX);
    sec.appendChild(filtroActivo);
  }

  if (principal.categorias.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Todavía no has creado ninguna categoría (son 100% manuales).";
    sec.appendChild(p);
  } else {
    const items = principal.categorias.map((cat) => construirChipCategoria(cat, principal));

    // v1.9.8: en vez de un solo flex-wrap (donde el corte cae donde el
    // navegador alcance, ej. 6 items → 5+1), se arman filas explícitas con
    // reparto parejo (6 → 3+3, 9 → 5+4, etc.). Para eso hace falta el ancho
    // real de cada chip, así que primero se montan todos juntos en una fila
    // con flex-wrap (para que el layout les dé su ancho real) y luego, ya
    // con eso medido, se redistribuyen — ver distribuirCategoriasEnFilas().
    const contFilas = document.createElement("div");
    contFilas.className = "stack";
    contFilas.style.gap = "6px";

    const filaMedicion = document.createElement("div");
    filaMedicion.className = "row";
    filaMedicion.style.flexWrap = "wrap";
    filaMedicion.style.gap = "8px";
    items.forEach((item) => filaMedicion.appendChild(item));
    contFilas.appendChild(filaMedicion);
    sec.appendChild(contFilas);

    // ResizeObserver dispara una vez con el tamaño inicial apenas se llama
    // observe(), así que no hace falta un requestAnimationFrame aparte para
    // la primera medición. Se desconecta solo cuando el panel deja de estar
    // en el DOM (se re-renderiza en cada renderizarPlanEstudios()).
    const resizeObserver = new ResizeObserver(() => {
      if (!contFilas.isConnected) {
        resizeObserver.disconnect();
        return;
      }
      distribuirCategoriasEnFilas(contFilas, items);
    });
    resizeObserver.observe(sec);
  }

  return sec;
}

/** Construye un chip de categoría (badge + botón editar) con sus listeners. */
function construirChipCategoria(cat, principal) {
  const item = document.createElement("div");
  item.className = "row";
  item.style.gap = "4px";
  item.style.flex = "0 0 auto";

  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = "badge";
  chip.style.cssText = estiloBadgeCategoria(cat.color) + "cursor:pointer;" +
    (estado.filtroCategoriaId === cat.id ? "box-shadow:0 0 0 2px var(--text-primary);" : "");
  chip.textContent = cat.nombre;

  // Click corto = filtra. Mantener presionado (~500ms) o click derecho = editar.
  let timerLongPress = null;
  let disparoLargo = false;
  chip.addEventListener("pointerdown", () => {
    disparoLargo = false;
    timerLongPress = setTimeout(() => {
      disparoLargo = true;
      abrirModalCategoria(cat, principal);
    }, 500);
  });
  chip.addEventListener("pointerup", () => {
    clearTimeout(timerLongPress);
    if (!disparoLargo) {
      estado.filtroCategoriaId = estado.filtroCategoriaId === cat.id ? null : cat.id;
      renderizarPlanEstudios();
    }
  });
  chip.addEventListener("pointerleave", () => clearTimeout(timerLongPress));
  chip.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    abrirModalCategoria(cat, principal);
  });

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn btn-secondary";
  btnEditar.style.cssText = "padding:2px 8px; font-size:0.75rem;";
  btnEditar.title = "Editar categoría";
  btnEditar.textContent = "⚙️";
  btnEditar.addEventListener("click", () => abrirModalCategoria(cat, principal));

  item.appendChild(chip);
  item.appendChild(btnEditar);
  return item;
}

/**
 * Reparte `items` (elementos ya construidos, con sus listeners intactos) en
 * filas explícitas dentro de `contFilas`, balanceando la cantidad por fila.
 *
 * Paso 1 — mide cuántas filas resultan "naturalmente" al ancho actual:
 * empaquetado voraz de izquierda a derecha usando el ancho real de cada
 * item (ya montado y con layout real, por eso hace falta medir después de
 * que el navegador les dio tamaño, no antes).
 * Paso 2 — con ese número de filas N, reparte los items lo más parejo
 * posible: total/N con resto, dando el sobrante a las primeras filas
 * (6 → 3+3, 9 → 5+4, 7 en 2 filas → 4+3, etc.).
 */
function distribuirCategoriasEnFilas(contFilas, items) {
  if (!contFilas.isConnected || items.length === 0) return;

  const GAP = 8; // debe calzar con el gap usado en cada fila más abajo
  const anchoDisponible = contFilas.clientWidth;
  if (!anchoDisponible) return;

  const anchos = items.map((el) => el.getBoundingClientRect().width || el.offsetWidth);

  let filasNaturales = 1;
  let anchoAcumulado = 0;
  anchos.forEach((w) => {
    const anchoConGap = anchoAcumulado === 0 ? w : anchoAcumulado + GAP + w;
    if (anchoConGap > anchoDisponible && anchoAcumulado > 0) {
      filasNaturales++;
      anchoAcumulado = w;
    } else {
      anchoAcumulado = anchoConGap;
    }
  });

  const N = Math.max(1, filasNaturales);
  const total = items.length;
  const base = Math.floor(total / N);
  const resto = total % N;

  contFilas.innerHTML = "";
  let indice = 0;
  for (let f = 0; f < N; f++) {
    const cantidadEnEstaFila = base + (f < resto ? 1 : 0);
    if (cantidadEnEstaFila === 0) continue;
    const filaEl = document.createElement("div");
    filaEl.className = "row";
    filaEl.style.gap = `${GAP}px`;
    for (let j = 0; j < cantidadEnEstaFila; j++) {
      filaEl.appendChild(items[indice]);
      indice++;
    }
    contFilas.appendChild(filaEl);
  }
}

function abrirModalCategoria(categoria, plan) {
  estado.categoriaEditandoId = categoria ? categoria.id : null;
  estado.planCategoriaEditandoId = plan.id;

  document.getElementById("titulo-modal-categoria").textContent = categoria ? "Editar categoría" : "Nueva categoría";
  document.getElementById("input-categoria-nombre").value = categoria ? categoria.nombre : "";
  document.getElementById("input-categoria-color").value = categoria ? categoria.color : "#38BDF8";
  document.getElementById("error-modal-categoria").classList.add("oculto");
  document.getElementById("btn-eliminar-categoria").classList.toggle("oculto", !categoria);
  document.getElementById("modal-categoria").classList.remove("oculto");
}

function inicializarModalCategoria() {
  document.getElementById("btn-cancelar-categoria").addEventListener("click", () => {
    document.getElementById("modal-categoria").classList.add("oculto");
  });

  document.getElementById("btn-eliminar-categoria").addEventListener("click", () => {
    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.planCategoriaEditandoId);
    if (!plan || !estado.categoriaEditandoId) return;
    const catId = estado.categoriaEditandoId;
    document.getElementById("modal-categoria").classList.add("oculto");
    abrirConfirmacion({
      titulo: "Eliminar categoría",
      mensaje: "Las materias asignadas quedarán sin categoría. Esta acción no se puede deshacer.",
      textoConfirmar: "Eliminar categoría",
      onConfirmar: () => {
        plan.categorias = plan.categorias.filter((c) => c.id !== catId);
        plan.materias.forEach((m) => {
          if (m.categoria_id === catId) m.categoria_id = null;
        });
        if (estado.filtroCategoriaId === catId) estado.filtroCategoriaId = null;
        marcarCambioPendiente();
        renderizarPlanEstudios();
      },
    });
  });

  document.getElementById("btn-guardar-categoria").addEventListener("click", () => {
    const nombre = document.getElementById("input-categoria-nombre").value.trim();
    const color = document.getElementById("input-categoria-color").value;
    if (!nombre) {
      const err = document.getElementById("error-modal-categoria");
      err.textContent = "El nombre es obligatorio.";
      err.classList.remove("oculto");
      return;
    }

    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.planCategoriaEditandoId);
    let categoria;

    if (estado.categoriaEditandoId) {
      categoria = plan.categorias.find((c) => c.id === estado.categoriaEditandoId);
      categoria.nombre = nombre;
      categoria.color = color;
    } else {
      categoria = crearCategoria({ nombre, color });
      plan.categorias.push(categoria);
    }
    marcarCambioPendiente();
    document.getElementById("modal-categoria").classList.add("oculto");
    abrirModalCategoriaMaterias(plan, categoria);
  });

  // v11 (migración a módulos): antes suelto en el DOMContentLoaded de plan.js.
  document.getElementById("modal-categoria").addEventListener("click", (e) => {
    if (e.target.id === "modal-categoria") e.target.classList.add("oculto");
  });
}

/** Paso 2 del flujo de categorías: elegir qué materias entran, con buscador + orden. */

function abrirModalCategoriaMaterias(plan, categoria) {
  estado.busquedaCategoriaMaterias = "";
  estado.ordenCategoriaMaterias = "bloque";
  estado.materiasCategoriaSeleccionadas = new Set(
    plan.materias.filter((m) => m.categoria_id === categoria.id).map((m) => m.codigo)
  );
  document.getElementById("nombre-categoria-materias").textContent = categoria.nombre;
  document.getElementById("modal-categoria-materias").dataset.planId = plan.id;
  document.getElementById("modal-categoria-materias").dataset.categoriaId = categoria.id;
  renderizarControlesCategoriaMaterias(plan, categoria);
  document.getElementById("modal-categoria-materias").classList.remove("oculto");
}

function renderizarControlesCategoriaMaterias(plan, categoria) {
  const cont = document.getElementById("lista-categoria-materias");
  cont.innerHTML = "";

  const buscador = document.createElement("input");
  buscador.type = "text";
  buscador.className = "form-input";
  buscador.placeholder = "Buscar por nombre o código…";
  buscador.value = estado.busquedaCategoriaMaterias;
  buscador.addEventListener("input", () => {
    estado.busquedaCategoriaMaterias = buscador.value;
    renderizarListaMateriasCheckbox(plan, categoria);
  });
  cont.appendChild(buscador);

  const pillOrden = document.createElement("div");
  pillOrden.className = "pill-group";
  [
    { valor: "bloque", texto: "Ordenar por bloque" },
    { valor: "codigo", texto: "Ordenar por código" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.ordenCategoriaMaterias === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.ordenCategoriaMaterias = op.valor;
      pillOrden.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderizarListaMateriasCheckbox(plan, categoria);
    });
    pillOrden.appendChild(btn);
  });
  cont.appendChild(pillOrden);

  const listaMaterias = document.createElement("div");
  listaMaterias.id = "checkboxes-categoria-materias";
  listaMaterias.className = "stack";
  listaMaterias.style.maxHeight = "320px";
  listaMaterias.style.overflowY = "auto";
  cont.appendChild(listaMaterias);

  renderizarListaMateriasCheckbox(plan, categoria);
}

function renderizarListaMateriasCheckbox(plan, categoria) {
  const cont = document.getElementById("checkboxes-categoria-materias");
  if (!cont) return;
  cont.innerHTML = "";

  let materiasRelevantes = plan.materias.filter((m) => m.categoria_id === null || m.categoria_id === categoria.id);

  const q = estado.busquedaCategoriaMaterias.trim().toLowerCase();
  if (q) materiasRelevantes = materiasRelevantes.filter((m) => m.nombre.toLowerCase().includes(q) || m.codigo.toLowerCase().includes(q));

  materiasRelevantes = materiasRelevantes
    .slice()
    .sort((a, b) => (estado.ordenCategoriaMaterias === "bloque" ? a.bloque - b.bloque : a.codigo.localeCompare(b.codigo)));

  if (materiasRelevantes.length === 0) {
    cont.innerHTML = `<p class="muted">No hay materias que coincidan.</p>`;
    return;
  }

  materiasRelevantes.forEach((materia) => {
    const label = document.createElement("label");
    label.className = "checkbox";
    label.innerHTML = `
      <input type="checkbox" value="${materia.codigo}" ${estado.materiasCategoriaSeleccionadas.has(materia.codigo) ? "checked" : ""}>
      <span class="box"></span>
      <span>${materia.codigo} — ${materia.nombre}</span>
    `;
    // FIX (v1.9.6): cada cambio se refleja de inmediato en el Set, así que
    // sobrevive a que el buscador o el cambio de orden vuelvan a dibujar
    // esta lista desde cero.
    label.querySelector('input[type="checkbox"]').addEventListener("change", (e) => {
      if (e.target.checked) estado.materiasCategoriaSeleccionadas.add(materia.codigo);
      else estado.materiasCategoriaSeleccionadas.delete(materia.codigo);
    });
    cont.appendChild(label);
  });
}

function inicializarModalCategoriaMaterias() {
  document.getElementById("btn-cancelar-categoria-materias").addEventListener("click", () => {
    document.getElementById("modal-categoria-materias").classList.add("oculto");
    renderizarPlanEstudios();
  });

  document.getElementById("btn-confirmar-categoria-materias").addEventListener("click", () => {
    const modal = document.getElementById("modal-categoria-materias");
    const plan = estado.datos.planes_estudio.find((p) => p.id === modal.dataset.planId);
    const categoriaId = modal.dataset.categoriaId;
    const marcados = estado.materiasCategoriaSeleccionadas;

    plan.materias.forEach((m) => {
      if (m.categoria_id === categoriaId && !marcados.has(m.codigo)) {
        m.categoria_id = null; // se desmarcó
      } else if (marcados.has(m.codigo)) {
        m.categoria_id = categoriaId;
      }
    });

    marcarCambioPendiente();
    modal.classList.add("oculto");
    renderizarPlanEstudios();
  });
}

export {
  abrirModalCategoria,
  abrirModalCategoriaMaterias,
  construirPanelCategorias,
  inicializarModalCategoria,
  inicializarModalCategoriaMaterias,
  renderizarControlesCategoriaMaterias,
  renderizarListaMateriasCheckbox,
};

// No exportadas (uso interno del panel de categorías):
// construirChipCategoria, distribuirCategoriasEnFilas
