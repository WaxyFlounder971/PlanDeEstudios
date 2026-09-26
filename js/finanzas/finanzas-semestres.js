/* =========================================================================
   FINANZAS — Pestaña Semestres (2026-08-10, simplificado en v2.8.8)
   Lista TODOS los semestres del historial (actuales y pasados). Cada fila
   se puede expandir con una flechita para ver/editar el detalle financiero
   de ese semestre: pagos de matrícula e ingresos de beca, cada uno como
   su propia tarjeta.

   Becas y Pagos de Matrícula — Parte B (2026-09-12): se retira el modal
   "Editar/Crear registro" (un solo input de costo + un solo input de
   beca) que existía desde Parte A como parche transicional. Ahora la fila
   de cada semestre se expande in-place (sin modal) mostrando dos columnas
   — Pagos de matrícula / Ingresos de beca — cada una con sus tarjetas
   individuales (B.1/B.3), un total de texto simple arriba, y un botón
   "+ Agregar" que abre un modal chico solo para ESE ítem. El registro
   financiero del semestre (finanzas_semestre) ya no se crea con un botón
   aparte ("Crear registro"): se crea solo, en silencio, la primera vez
   que se agrega un pago o un ingreso (ver obtenerOCrearRegistroDeSemestre).
   ========================================================================= */

import {
  crearRegistroFinancieroSemestre,
  crearPagoMatricula,
  crearIngresoBeca,
  calcularTotalPagosMatricula,
  calcularTotalIngresosBeca,
  sellarTimestamp,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, construirPillSwitchBinario, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

/**
 * Qué semestres están expandidos ahora mismo (solo estado de UI, vive en
 * memoria — no se persiste ni se sincroniza, se reinicia al recargar la
 * página, igual que cualquier otro estado de "pestaña activa" del
 * proyecto). Guarda semestre.id.
 */
const semestresExpandidosFinanzas = new Set();

/**
 * Becas y Pagos de Matrícula — Parte B.2: reparte `total` entre
 * `cantidadPartes` partes iguales lo más parejo posible, trabajando en
 * centavos para que la suma de las partes cuadre EXACTO con el total sin
 * importar cuántas partes sean — el residuo de redondeo (si lo hay) se lo
 * lleva la última parte. Reemplaza a la vieja `repartirMontoEnMeses` de
 * Parte A (mismo algoritmo, pero esa generaba entradas de
 * `desglose_mensual.meses`, estructura que ya no existe desde la
 * migración A.2) — acá se devuelven solo los montos; el caller arma cada
 * `pago_matricula` con su descripción "Pago N de M".
 */
function repartirMontoEnPartes(total, cantidadPartes) {
  const n = Math.max(1, Math.floor(Number(cantidadPartes)) || 1);
  const totalCentavos = Math.round((Number(total) || 0) * 100);
  const baseCentavos = Math.floor(totalCentavos / n);
  const resto = totalCentavos - baseCentavos * n;
  const montos = [];
  for (let i = 0; i < n; i++) {
    const centavos = baseCentavos + (i === n - 1 ? resto : 0);
    montos.push(centavos / 100);
  }
  return montos;
}

function obtenerRegistroDeSemestre(semestreId) {
  return (estado.datos.finanzas_semestre || []).find((r) => r.semestre_id === semestreId) || null;
}

/**
 * Devuelve el registro financiero del semestre, CREÁNDOLO primero (vacío,
 * sin ningún pago/ingreso todavía) si todavía no existe uno. Reemplaza al
 * botón "Crear registro" de Parte A: ahora la creación es invisible, pasa
 * sola la primera vez que se guarda un pago o un ingreso desde el modal
 * chico de abrirModalItemFinanzas.
 */
function obtenerOCrearRegistroDeSemestre(semestreId) {
  let registro = obtenerRegistroDeSemestre(semestreId);
  if (!registro) {
    registro = crearRegistroFinancieroSemestre({ semestreId });
    if (!Array.isArray(estado.datos.finanzas_semestre)) estado.datos.finanzas_semestre = [];
    estado.datos.finanzas_semestre.push(registro);
  }
  return registro;
}

function refrescarListaFinanzas(contenedorLista) {
  contenedorLista.innerHTML = "";
  renderizarPestanaSemestresFinanzas(contenedorLista);
}

function renderizarPestanaSemestresFinanzas(contenedor) {
  const semestres = [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];

  if (semestres.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Todavía no tenés ningún semestre registrado en Semestres.";
    contenedor.appendChild(vacio);
    return;
  }

  semestres.forEach((semestre) => {
    contenedor.appendChild(construirTarjetaSemestreFinanzas(semestre, contenedor));
  });
}

/** Fila de un semestre (glass-card): encabezado siempre visible + panel
 *  de detalle desplegable si está en semestresExpandidosFinanzas. */
function construirTarjetaSemestreFinanzas(semestre, contenedorLista) {
  const registro = obtenerRegistroDeSemestre(semestre.id);
  const expandido = semestresExpandidosFinanzas.has(semestre.id);

  const tarjeta = document.createElement("div");
  tarjeta.className = "glass-card";

  const fila = document.createElement("div");
  fila.className = "row-between";

  const info = document.createElement("div");
  info.innerHTML = `
    <p style="margin:0; font-weight:600;">${semestre.nombre}</p>
    <p class="muted" style="margin:2px 0 0;">${formatearFechaLarga(semestre.fecha_inicio)}</p>
  `;

  const derecha = document.createElement("div");
  derecha.className = "row";
  derecha.style.alignItems = "center";
  derecha.style.gap = "10px";

  if (registro) {
    // v2.8.9: matrícula (rojo, es gasto) arriba, beca (verde, es ingreso)
    // abajo — mismo código de color que el resto de Finanzas
    // (badge-danger/badge-success).
    const columnaMontos = document.createElement("div");
    columnaMontos.className = "stack";
    columnaMontos.style.cssText = "gap:4px; align-items:flex-end;";

    const totalMatricula = calcularTotalPagosMatricula(registro);
    const totalBeca = calcularTotalIngresosBeca(registro);

    if (totalMatricula > 0 || registro.pagos_matricula.length > 0) {
      const badgeMatricula = document.createElement("span");
      badgeMatricula.className = "badge badge-danger";
      badgeMatricula.textContent = formatearMonto(totalMatricula);
      columnaMontos.appendChild(badgeMatricula);
    }

    if (totalBeca > 0) {
      const badgeBeca = document.createElement("span");
      badgeBeca.className = "badge badge-success";
      badgeBeca.title = "Beca";
      badgeBeca.textContent = formatearMonto(totalBeca);
      columnaMontos.appendChild(badgeBeca);
    }
    derecha.appendChild(columnaMontos);
  }

  // Becas y Pagos de Matrícula — Parte B.4: flechita ▾/▴ que expande/
  // colapsa el detalle de este semestre in-place, en vez del botón
  // "Editar/Crear registro" de Parte A que abría un modal aparte.
  const btnFlecha = document.createElement("button");
  btnFlecha.type = "button";
  btnFlecha.className = "btn-discreto";
  btnFlecha.setAttribute("aria-label", expandido ? "Contraer detalle" : "Ver detalle");
  btnFlecha.style.fontSize = "1rem";
  btnFlecha.textContent = expandido ? "▴" : "▾";
  btnFlecha.addEventListener("click", () => {
    if (expandido) semestresExpandidosFinanzas.delete(semestre.id);
    else semestresExpandidosFinanzas.add(semestre.id);
    refrescarListaFinanzas(contenedorLista);
  });
  derecha.appendChild(btnFlecha);

  fila.appendChild(info);
  fila.appendChild(derecha);
  tarjeta.appendChild(fila);

  if (expandido) {
    const panel = document.createElement("div");
    panel.style.cssText =
      "margin-top:12px; padding-top:12px; border-top:1px solid rgba(255,255,255,0.12);";
    panel.appendChild(construirPanelDetalleFinanzasSemestre(semestre, registro, contenedorLista));
    tarjeta.appendChild(panel);
  }

  return tarjeta;
}

/**
 * Becas y Pagos de Matrícula — Parte B.1/B.3: las dos columnas del detalle
 * expandido — Pagos de matrícula / Ingresos de beca. Grid con
 * `auto-fit`/`minmax` (no un breakpoint fijo): si el ancho disponible
 * alcanza para las dos columnas lado a lado se muestran así, si no se
 * apilan en una sola columna — pedido explícito de que el texto de la
 * descripción nunca se corte/trunque, así que ninguna columna tiene un
 * ancho mínimo tan chico como para forzar eso.
 */
function construirPanelDetalleFinanzasSemestre(semestre, registro, contenedorLista) {
  const grid = document.createElement("div");
  grid.style.cssText =
    "display:grid; grid-template-columns:repeat(auto-fit, minmax(240px, 1fr)); gap:16px; align-items:start;";

  grid.appendChild(
    construirColumnaListaFinanzas({
      tipo: "matricula",
      titulo: "Pagos de matrícula",
      textoAgregar: "+ Agregar pago",
      claseBadge: "badge-danger",
      textoVacio: "Todavía no hay pagos cargados.",
      registro,
      semestre,
      contenedorLista,
    })
  );

  grid.appendChild(
    construirColumnaListaFinanzas({
      tipo: "beca",
      titulo: "Ingresos de beca",
      textoAgregar: "+ Agregar ingreso",
      claseBadge: "badge-success",
      textoVacio: "Todavía no hay ingresos de beca cargados.",
      registro,
      semestre,
      contenedorLista,
    })
  );

  const envoltorio = document.createElement("div");
  envoltorio.className = "stack";
  envoltorio.style.gap = "12px";
  envoltorio.appendChild(grid);

  // Se conserva la posibilidad de borrar el registro financiero COMPLETO
  // del semestre (existía en el modal de Parte A) — ahora como link
  // discreto al fondo, para no competir visualmente con las tarjetas de
  // arriba. Solo se muestra si ya hay algo cargado.
  if (registro && (registro.pagos_matricula.length > 0 || registro.ingresos_beca.length > 0)) {
    const btnEliminarTodo = document.createElement("button");
    btnEliminarTodo.type = "button";
    btnEliminarTodo.className = "btn-discreto";
    btnEliminarTodo.style.cssText = "align-self:center; font-size:0.8rem; opacity:0.75;";
    btnEliminarTodo.textContent = "Eliminar todo el registro financiero de este semestre";
    btnEliminarTodo.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar registro financiero",
        mensaje: `Se van a borrar TODOS los pagos de matrícula e ingresos de beca de ${semestre.nombre}. Esta acción no se puede deshacer.`,
        textoConfirmar: "Eliminar todo",
        onConfirmar: () => {
          estado.datos.finanzas_semestre = (estado.datos.finanzas_semestre || []).filter(
            (r) => r.id !== registro.id
          );
          if (!Array.isArray(estado.datos._eliminados_finanzas_semestre)) {
            estado.datos._eliminados_finanzas_semestre = [];
          }
          estado.datos._eliminados_finanzas_semestre.push({ id: registro.id, eliminadoEn: Date.now() });
          marcarCambioPendiente();
          refrescarListaFinanzas(contenedorLista);
        },
      });
    });
    envoltorio.appendChild(btnEliminarTodo);
  }

  return envoltorio;
}

function construirColumnaListaFinanzas({ tipo, titulo, textoAgregar, claseBadge, textoVacio, registro, semestre, contenedorLista }) {
  const esMatricula = tipo === "matricula";
  const lista = registro ? (esMatricula ? registro.pagos_matricula : registro.ingresos_beca) : [];
  const total = registro ? (esMatricula ? calcularTotalPagosMatricula(registro) : calcularTotalIngresosBeca(registro)) : 0;
  const etiquetaTotal = esMatricula ? "Total matrícula" : "Total beca";

  const columna = document.createElement("div");
  columna.className = "stack";
  columna.style.cssText = "gap:8px; min-width:0;"; // min-width:0 para que el grid deje envolver texto en vez de desbordar

  const encabezado = document.createElement("div");
  encabezado.innerHTML = `
    <p style="margin:0; font-weight:600;">${titulo}</p>
    <p class="muted" style="margin:2px 0 0; font-size:0.85rem;">${etiquetaTotal}: ${formatearMonto(total)}</p>
  `;
  columna.appendChild(encabezado);

  if (lista.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.cssText = "margin:0; font-size:0.85rem;";
    vacio.textContent = textoVacio;
    columna.appendChild(vacio);
  } else {
    lista.forEach((item) => {
      columna.appendChild(
        construirTarjetaItemFinanzas({ item, tipo, claseBadge, registro, semestre, contenedorLista })
      );
    });
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn-discreto";
  btnAgregar.style.cssText = "align-self:flex-start;";
  btnAgregar.textContent = textoAgregar;
  btnAgregar.addEventListener("click", () =>
    abrirModalItemFinanzas({ tipo, semestre, registro, itemExistente: null, contenedorLista })
  );
  columna.appendChild(btnAgregar);

  return columna;
}

/**
 * Becas y Pagos de Matrícula — Parte B.1/B.3: fila compacta tipo
 * glass-card por cada pago/ingreso — descripción (o "Sin descripción" en
 * gris) + fecha chica en muted debajo si tiene, monto en badge a la
 * derecha, y botones de editar/borrar discretos al final. Visibles
 * siempre (no solo en un "modo edición" — eso es Parte D, que agrega la
 * confirmación de guardar/descartar; acá cada edición/borrado se guarda
 * al toque, igual que el resto del proyecto).
 */
function construirTarjetaItemFinanzas({ item, tipo, claseBadge, registro, semestre, contenedorLista }) {
  const esMatricula = tipo === "matricula";

  const fila = document.createElement("div");
  fila.className = "glass-card row-between";
  fila.style.cssText = "padding:8px 10px; gap:8px;";

  const info = document.createElement("div");
  info.style.cssText = "min-width:0;";
  const descripcion = document.createElement("p");
  descripcion.style.cssText = "margin:0; font-weight:500; word-break:break-word;";
  if (item.descripcion) {
    descripcion.textContent = item.descripcion;
  } else {
    descripcion.className = "muted";
    descripcion.textContent = "Sin descripción";
  }
  info.appendChild(descripcion);

  if (item.fecha) {
    const fecha = document.createElement("p");
    fecha.className = "muted";
    fecha.style.cssText = "margin:2px 0 0; font-size:0.78rem;";
    fecha.textContent = formatearFechaLarga(item.fecha);
    info.appendChild(fecha);
  }

  const derecha = document.createElement("div");
  derecha.className = "row";
  derecha.style.cssText = "align-items:center; gap:6px; flex-shrink:0;";

  const badgeMonto = document.createElement("span");
  badgeMonto.className = "badge " + claseBadge;
  badgeMonto.textContent = formatearMonto(item.monto);
  derecha.appendChild(badgeMonto);

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn-discreto";
  btnEditar.setAttribute("aria-label", "Editar");
  btnEditar.textContent = "✎";
  btnEditar.addEventListener("click", () =>
    abrirModalItemFinanzas({ tipo, semestre, registro, itemExistente: item, contenedorLista })
  );
  derecha.appendChild(btnEditar);

  const btnBorrar = document.createElement("button");
  btnBorrar.type = "button";
  btnBorrar.className = "btn-discreto";
  btnBorrar.setAttribute("aria-label", "Eliminar");
  btnBorrar.textContent = "✕";
  btnBorrar.addEventListener("click", () => {
    abrirConfirmacion({
      titulo: esMatricula ? "Eliminar pago" : "Eliminar ingreso de beca",
      mensaje: `Se va a borrar "${item.descripcion || "Sin descripción"}" (${formatearMonto(item.monto)}). Esta acción no se puede deshacer.`,
      textoConfirmar: "Eliminar",
      onConfirmar: () => {
        eliminarItemFinanzas({ tipo, registro, itemId: item.id });
        marcarCambioPendiente();
        refrescarListaFinanzas(contenedorLista);
      },
    });
  });
  derecha.appendChild(btnBorrar);

  fila.appendChild(info);
  fila.appendChild(derecha);
  return fila;
}

/** Saca el ítem de la lista correspondiente y deja tumba, mismo patrón
 *  exacto que ya usa _eliminados_finanzas_semestre (ver
 *  fusionarFinanzasSemestre en storage-merge.js: espera {id, eliminadoEn}
 *  en _eliminados_pagos_matricula/_eliminados_ingresos_beca). */
function eliminarItemFinanzas({ tipo, registro, itemId }) {
  const claveLista = tipo === "matricula" ? "pagos_matricula" : "ingresos_beca";
  const claveEliminados = tipo === "matricula" ? "_eliminados_pagos_matricula" : "_eliminados_ingresos_beca";
  registro[claveLista] = registro[claveLista].filter((x) => x.id !== itemId);
  if (!Array.isArray(registro[claveEliminados])) registro[claveEliminados] = [];
  registro[claveEliminados].push({ id: itemId, eliminadoEn: Date.now() });
  sellarTimestamp(registro);
}

/**
 * Becas y Pagos de Matrícula — Parte B: modal chico para agregar/editar UN
 * pago de matrícula o UN ingreso de beca. Al AGREGAR un pago de matrícula
 * nuevo (nunca al editar uno existente, y nunca para beca) se puede elegir
 * "Dividir en partes" (B.2): monto total + número de partes -> genera esa
 * cantidad de pagos_matricula de una vez ("Pago 1 de N", editable cada uno
 * después, independiente del resto).
 */
function abrirModalItemFinanzas({ tipo, semestre, registro, itemExistente, contenedorLista }) {
  const esNuevo = !itemExistente;
  const esMatricula = tipo === "matricula";
  const permiteDividir = esMatricula && esNuevo;

  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", cerrar);

  const tituloTexto = esNuevo
    ? esMatricula
      ? "Agregar pago de matrícula"
      : "Agregar ingreso de beca"
    : esMatricula
    ? "Editar pago de matrícula"
    : "Editar ingreso de beca";

  caja.innerHTML = `<h2 style="margin:0;">${tituloTexto}</h2><p class="muted" style="margin:0 0 4px;">${semestre.nombre}</p>`;

  let modoDividir = false;

  if (permiteDividir) {
    caja.appendChild(
      construirPillSwitchBinario(
        [
          { valor: "unico", texto: "Un solo pago" },
          { valor: "dividir", texto: "Dividir en partes" },
        ],
        "unico",
        (valor) => {
          modoDividir = valor === "dividir";
          renderCuerpo();
        }
      )
    );
  }

  const cuerpo = document.createElement("div");
  cuerpo.className = "stack";
  cuerpo.style.marginTop = "8px";
  caja.appendChild(cuerpo);

  // ----- refs del modo "un solo pago" (también usado para editar y para beca) -----
  let inputDescripcion, inputMonto, inputFecha;
  // ----- refs del modo "dividir en partes" -----
  let inputMontoTotal, inputCantidadPartes, checkPersonalizar, contenedorPersonalizados, textoPreview;

  function renderCuerpo() {
    cuerpo.innerHTML = "";

    if (modoDividir) {
      const bloqueMonto = document.createElement("div");
      bloqueMonto.innerHTML = `<span class="form-label">Monto total</span>`;
      inputMontoTotal = document.createElement("input");
      inputMontoTotal.type = "number";
      inputMontoTotal.step = "0.01";
      inputMontoTotal.className = "form-input";
      bloqueMonto.appendChild(inputMontoTotal);
      cuerpo.appendChild(bloqueMonto);

      const bloquePartes = document.createElement("div");
      bloquePartes.innerHTML = `<span class="form-label">Número de partes</span>`;
      inputCantidadPartes = document.createElement("input");
      inputCantidadPartes.type = "number";
      inputCantidadPartes.min = "2";
      inputCantidadPartes.step = "1";
      inputCantidadPartes.value = "2";
      inputCantidadPartes.className = "form-input";
      bloquePartes.appendChild(inputCantidadPartes);
      cuerpo.appendChild(bloquePartes);

      const bloqueCheck = document.createElement("label");
      bloqueCheck.className = "row";
      bloqueCheck.style.cssText = "gap:8px; align-items:center; cursor:pointer;";
      checkPersonalizar = document.createElement("input");
      checkPersonalizar.type = "checkbox";
      bloqueCheck.appendChild(checkPersonalizar);
      const spanCheck = document.createElement("span");
      spanCheck.textContent = "Personalizar el monto de cada parte";
      bloqueCheck.appendChild(spanCheck);
      cuerpo.appendChild(bloqueCheck);

      contenedorPersonalizados = document.createElement("div");
      contenedorPersonalizados.className = "stack";
      contenedorPersonalizados.style.gap = "6px";
      cuerpo.appendChild(contenedorPersonalizados);

      textoPreview = document.createElement("p");
      textoPreview.className = "muted";
      textoPreview.style.cssText = "margin:0; font-size:0.82rem;";
      cuerpo.appendChild(textoPreview);

      function actualizarPersonalizados() {
        contenedorPersonalizados.innerHTML = "";
        if (!checkPersonalizar.checked) return;
        const n = Math.max(2, Math.floor(Number(inputCantidadPartes.value)) || 2);
        const montoTotal = Number(inputMontoTotal.value) || 0;
        const montosBase = repartirMontoEnPartes(montoTotal, n);
        montosBase.forEach((monto, i) => {
          const bloque = document.createElement("div");
          bloque.innerHTML = `<span class="form-label">Parte ${i + 1} de ${n}</span>`;
          const input = document.createElement("input");
          input.type = "number";
          input.step = "0.01";
          input.className = "form-input parte-personalizada";
          input.value = monto;
          input.addEventListener("input", actualizarPreview);
          bloque.appendChild(input);
          contenedorPersonalizados.appendChild(bloque);
        });
        actualizarPreview();
      }

      function actualizarPreview() {
        const n = Math.max(2, Math.floor(Number(inputCantidadPartes.value)) || 2);
        let montos;
        if (checkPersonalizar.checked) {
          montos = Array.from(contenedorPersonalizados.querySelectorAll(".parte-personalizada")).map(
            (inp) => Number(inp.value) || 0
          );
        } else {
          montos = repartirMontoEnPartes(Number(inputMontoTotal.value) || 0, n);
        }
        const suma = montos.reduce((acc, m) => acc + m, 0);
        textoPreview.textContent = `Se van a crear ${montos.length} pagos — total: ${formatearMonto(suma)}`;
      }

      inputMontoTotal.addEventListener("input", () => {
        if (checkPersonalizar.checked) actualizarPersonalizados();
        else actualizarPreview();
      });
      inputCantidadPartes.addEventListener("input", () => {
        if (checkPersonalizar.checked) actualizarPersonalizados();
        else actualizarPreview();
      });
      checkPersonalizar.addEventListener("change", actualizarPersonalizados);
      actualizarPreview();
    } else {
      const bloqueDescripcion = document.createElement("div");
      bloqueDescripcion.innerHTML = `<span class="form-label">Descripción (opcional)</span>`;
      inputDescripcion = document.createElement("input");
      inputDescripcion.type = "text";
      inputDescripcion.className = "form-input";
      inputDescripcion.value = itemExistente && itemExistente.descripcion ? itemExistente.descripcion : "";
      bloqueDescripcion.appendChild(inputDescripcion);
      cuerpo.appendChild(bloqueDescripcion);

      const bloqueMonto = document.createElement("div");
      bloqueMonto.innerHTML = `<span class="form-label">Monto</span>`;
      inputMonto = document.createElement("input");
      inputMonto.type = "number";
      inputMonto.step = "0.01";
      inputMonto.className = "form-input";
      inputMonto.value = itemExistente ? itemExistente.monto : "";
      bloqueMonto.appendChild(inputMonto);
      cuerpo.appendChild(bloqueMonto);

      const bloqueFecha = document.createElement("div");
      bloqueFecha.innerHTML = `<span class="form-label">Fecha (opcional)</span>`;
      inputFecha = document.createElement("input");
      inputFecha.type = "date";
      inputFecha.className = "form-input";
      inputFecha.value = itemExistente && itemExistente.fecha ? itemExistente.fecha : "";
      bloqueFecha.appendChild(inputFecha);
      cuerpo.appendChild(bloqueFecha);
    }
  }

  renderCuerpo();

  // ----- Botones -----
  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.marginTop = "12px";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.style.flex = "1";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.style.flex = "1";
  btnGuardar.textContent = esNuevo ? "Agregar" : "Guardar";
  btnGuardar.addEventListener("click", () => {
    if (modoDividir) {
      const n = Math.max(2, Math.floor(Number(inputCantidadPartes.value)) || 2);
      let montos;
      if (checkPersonalizar.checked) {
        montos = Array.from(contenedorPersonalizados.querySelectorAll(".parte-personalizada")).map(
          (inp) => Number(inp.value) || 0
        );
      } else {
        montos = repartirMontoEnPartes(Number(inputMontoTotal.value) || 0, n);
      }
      if (montos.length === 0 || montos.every((m) => m === 0)) {
        mostrarToast("Ingresá un monto total válido.");
        return;
      }
      const registroFinal = obtenerOCrearRegistroDeSemestre(semestre.id);
      montos.forEach((monto, i) => {
        registroFinal.pagos_matricula.push(
          crearPagoMatricula({ descripcion: `Pago ${i + 1} de ${montos.length}`, monto })
        );
      });
      sellarTimestamp(registroFinal);
    } else {
      const descripcion = inputDescripcion.value.trim();
      const monto = Number(inputMonto.value) || 0;
      const fecha = inputFecha.value || null;
      if (monto === 0) {
        mostrarToast("Ingresá un monto válido.");
        return;
      }
      if (itemExistente) {
        itemExistente.descripcion = descripcion || null;
        itemExistente.monto = monto;
        itemExistente.fecha = fecha;
        sellarTimestamp(itemExistente);
        sellarTimestamp(registro);
      } else {
        const registroFinal = obtenerOCrearRegistroDeSemestre(semestre.id);
        const nuevoItem = esMatricula
          ? crearPagoMatricula({ descripcion, monto, fecha })
          : crearIngresoBeca({ descripcion, monto, fecha });
        registroFinal[esMatricula ? "pagos_matricula" : "ingresos_beca"].push(nuevoItem);
        sellarTimestamp(registroFinal);
      }
    }

    marcarCambioPendiente();
    cerrar();
    // El semestre queda expandido (no se toca semestresExpandidosFinanzas)
    // para que se vea de una vez la tarjeta recién agregada/editada.
    refrescarListaFinanzas(contenedorLista);
  });
  filaBotones.appendChild(btnGuardar);

  caja.appendChild(filaBotones);
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

export { renderizarPestanaSemestresFinanzas };
