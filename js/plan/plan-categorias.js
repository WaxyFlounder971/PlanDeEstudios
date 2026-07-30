/* =========================================================================
   PLAN DE ESTUDIOS — CATEGORÍAS
   CRUD de categorías y el modal de asignación masiva a materias.
   ========================================================================= */

import { crearCategoria, sellarTimestamp } from "../core/schema.js";
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

    // v1.13: v1.12 alineaba en columnas con `auto-fit`, pero eso reparte
    // por cuántas caben según el ancho disponible — no por cantidad total,
    // así que 6 chips podían salir 4+2 en vez de 3+3. Esta versión vuelve
    // al reparto EQUITATIVO por filas de v1.9.8 (nunca una fila casi vacía:
    // 6→3+3, 11→4+4+3, el sobrante siempre a las primeras filas) y además
    // los alinea en columnas reales — ver distribuirCategoriasEnGrid().
    const gridCategorias = document.createElement("div");
    gridCategorias.className = "categorias-grid";
    items.forEach((item) => gridCategorias.appendChild(item));
    sec.appendChild(gridCategorias);

    // A diferencia de v1.12 (que medía una sola vez y desconectaba), aquí
    // SÍ hace falta recalcular en cada resize: cuántas filas "caben
    // naturalmente" depende del ancho disponible del contenedor, igual que
    // en v1.9.8.
    const resizeObserver = new ResizeObserver(() => {
      if (!gridCategorias.isConnected) {
        resizeObserver.disconnect();
        return;
      }
      distribuirCategoriasEnGrid(gridCategorias, items);
    });
    resizeObserver.observe(sec);
  }

  return sec;
}

/**
 * v1.13: reparte `items` (elementos ya construidos, con sus listeners
 * intactos) en filas EQUITATIVAS dentro de un único CSS Grid compartido,
 * de forma que las filas completas queden alineadas en columnas de
 * verdad (a diferencia de v1.9.8, que armaba <div class="row"> sueltos por
 * fila, sin alinear columna a columna entre sí).
 *
 * Paso 1 (igual que v1.9.8) — mide cuántas filas resultan "naturalmente"
 * al ancho actual: empaquetado voraz de izquierda a derecha usando el
 * ancho REAL de cada item (no un ancho uniforme — por eso hace falta medir
 * después de que el navegador les dio tamaño, no antes).
 * Paso 2 (igual que v1.9.8) — con ese número de filas N, reparte los items
 * lo más parejo posible: total/N con resto, dando el sobrante a las
 * PRIMERAS filas (6 → 3+3, 11 → 4+4+3, 7 en 2 filas → 4+3, etc.).
 * Paso 3 (nuevo) — en vez de crear una fila <div> por cada grupo, se arma
 * UN solo grid con tantas columnas como la fila más larga, y cada item se
 * ubica de forma EXPLÍCITA (grid-row/grid-column) según ese reparto. Así,
 * mientras todas las filas tengan la misma cantidad, quedan perfectamente
 * alineadas en columnas; si el total no es múltiplo exacto del número de
 * filas, solo la última fila queda más corta y sin alinear su último
 * puesto — comportamiento aceptado.
 */
function distribuirCategoriasEnGrid(gridCategorias, items) {
  if (!gridCategorias.isConnected || items.length === 0) return;

  const GAP = 8; // debe calzar con el gap del CSS (.categorias-grid)
  const anchoDisponible = gridCategorias.clientWidth;
  if (!anchoDisponible) return;

  const anchos = items.map((el) => el.getBoundingClientRect().width || el.offsetWidth);
  const anchoMax = Math.max(...anchos);
  if (!anchoMax) return;

  // Paso 1: filas naturales por empaquetado voraz con el ancho real de cada item.
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

  // Paso 2: cantidad de items por fila — las primeras `resto` filas llevan 1 de más.
  const N = Math.max(1, filasNaturales);
  const total = items.length;
  const base = Math.floor(total / N);
  const resto = total % N;
  const columnasPorFila = [];
  for (let f = 0; f < N; f++) {
    const cantidad = base + (f < resto ? 1 : 0);
    if (cantidad > 0) columnasPorFila.push(cantidad);
  }
  const maxColumnas = Math.max(...columnasPorFila);

  // Paso 3: un solo grid, tantas columnas como la fila más larga, cada item
  // ubicado explícitamente para que el reparto equitativo del Paso 2 se
  // respete al pie de la letra (no el llenado secuencial por defecto del
  // grid, que no siempre coincide con "el sobrante a las primeras filas").
  gridCategorias.style.gridTemplateColumns = `repeat(${maxColumnas}, minmax(${Math.ceil(anchoMax)}px, max-content))`;
  let indice = 0;
  columnasPorFila.forEach((cantidad, filaIdx) => {
    for (let col = 0; col < cantidad; col++) {
      const item = items[indice];
      item.style.gridRow = String(filaIdx + 1);
      item.style.gridColumn = String(col + 1);
      indice++;
    }
  });
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
        // FIX sync (bug real encontrado en esta ronda de auditoría): antes
        // el borrado solo filtraba el arreglo local, sin dejar ningún
        // rastro explícito ("tumba"). Si el otro dispositivo todavía no
        // había bajado este borrado y mandaba su copia vieja de la
        // categoría, storage-merge.js no tenía forma de saber que debía
        // excluirla — la categoría "resucitaba" en el próximo sync. Mismo
        // patrón que ya usa la tumba de materias (_eliminados_materias).
        if (!Array.isArray(plan._eliminados_categorias)) plan._eliminados_categorias = [];
        plan._eliminados_categorias.push({ id: catId, eliminadoEn: Date.now() });
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
      // FIX sync: re-sella timestamp al editar una categoría existente,
      // mismo patrón que ya se aplicó a la edición manual de materias en
      // plan-esquema.js. Sin esto, una categoría editada seguía teniendo
      // el _actualizadoEn de cuando se CREÓ, no de la edición real.
      sellarTimestamp(categoria);
    } else {
      categoria = crearCategoria({ nombre, color }); // ya sella timestamp internamente
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
        sellarTimestamp(m);
      } else if (marcados.has(m.codigo)) {
        m.categoria_id = categoriaId;
        sellarTimestamp(m);
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
// construirChipCategoria, distribuirCategoriasEnGrid
