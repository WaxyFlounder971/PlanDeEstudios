/* =========================================================================
   FINANZAS 2.0 — Formulario único de movimientos (etapa 0B)
   Un solo modal para gasto, ingreso, ahorro y transferencia. Escribe en
   `estado.datos.movimientos` (nunca en gastos_u). Orden pensado para
   registrar rápido: Tipo → Monto → Nombre → lo propio del tipo → Fecha;
   Semestre y Nota quedan plegados en "Más opciones".
   Textos: todo pasa por t(); las claves nuevas se extraen con
   scripts/extraer-textos-finanzas.mjs.
   ========================================================================= */

import { crearMeta, crearMovimiento, hoyIso } from "../core/finanzas-modelo.js";
import { obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, construirPillSwitchBinario, mostrarToast } from "../ui/componentes.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { construirSeccionRecurrencia } from "./finanzas-recurrencia.js";
import { construirSelectorFinanzas } from "./finanzas-selector.js";

const TIPOS_FORM = [
  { id: "gasto", etiqueta: "Gasto", modulo: "gastos" },
  { id: "ingreso", etiqueta: "Ingreso", modulo: "gastos" },
  { id: "ahorro", etiqueta: "Ahorro", modulo: "ahorros" },
  { id: "transferencia", etiqueta: "Transferencia", modulo: "ahorros" },
];
const NUEVA_META = "__nueva__";

/** Nombre a mostrar: el que escribió la persona o, si lo dejó vacío, uno según el tipo/origen. */
function nombreMostradoMovimiento(mov) {
  if (mov.nombre) return mov.nombre;
  if (mov.origen === "matricula") return t("Matrícula");
  if (mov.origen === "beca") return t("Beca");
  if (mov.tipo === "ahorro") return t("Aporte a meta");
  if (mov.tipo === "transferencia") return t("Transferencia");
  return t("(sin nombre)");
}

function obtenerMetasActivas(incluirId) {
  return (estado.datos.metas || []).filter((m) => !m.archivada || m.id === incluirId);
}

function crearCampo(etiqueta, control) {
  const bloque = document.createElement("div");
  const span = document.createElement("span");
  span.className = "form-label";
  span.textContent = t(etiqueta);
  bloque.append(span, control);
  return bloque;
}

function crearInput(tipo, valor = "", placeholder = "") {
  const input = document.createElement("input");
  input.type = tipo;
  input.className = "form-input";
  input.value = valor;
  if (placeholder) input.placeholder = placeholder;
  return input;
}

function crearInputMonto(valor) {
  const input = crearInput("number", valor);
  input.step = "0.01";
  input.min = "0";
  input.setAttribute("inputmode", "decimal");
  return input;
}

/**
 * @param {{movimiento?: object|null, tipoInicial?: string, alGuardar?: () => void}} cfg
 *   movimiento: objeto existente (editar) o null (crear).
 */
function abrirModalMovimiento({ movimiento = null, tipoInicial = "gasto", alGuardar = () => {} } = {}) {
  const modulos = obtenerModulosFinanzas(estado.datos);
  const esExistente = !!movimiento;
  const esDeModulo = esExistente && movimiento.origen && movimiento.origen !== "manual"; // matrícula / beca
  const tiposDisponibles = TIPOS_FORM.filter((x) => modulos[x.modulo] || (esExistente && movimiento.tipo === x.id));
  if (!tiposDisponibles.length) {
    mostrarToast(t("Activa Gastos o Ahorros en Ajustes para registrar movimientos."));
    return;
  }

  let tipo = esExistente
    ? movimiento.tipo
    : (tiposDisponibles.find((x) => x.id === tipoInicial) || tiposDisponibles[0]).id;
  let fuente = (movimiento && movimiento.fuente) || "liquido";
  let sentido = (movimiento && movimiento.sentido) || "a_meta";

  // ----- Estructura del modal -----
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";
  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:460px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());
  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", cerrar);

  const titulo = document.createElement("h2");
  titulo.style.margin = "0";
  titulo.textContent = t(esExistente ? "Editar movimiento" : "Nuevo movimiento");
  caja.appendChild(titulo);

  // ----- Tipo (2x2) o aviso de origen -----
  const grupoTipo = document.createElement("div");
  grupoTipo.className = "pill-grid-2";
  let bloqueTipo;
  if (esDeModulo) {
    bloqueTipo = document.createElement("p");
    bloqueTipo.className = "muted";
    bloqueTipo.style.margin = "0";
    bloqueTipo.textContent = t(
      movimiento.origen === "matricula"
        ? "Es un pago de matrícula de un semestre. También lo ves en la pestaña Semestres."
        : "Es un ingreso de beca de un semestre. También lo ves en la pestaña Semestres."
    );
  } else {
    tiposDisponibles.forEach((x) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item";
      btn.dataset.valor = x.id;
      btn.textContent = t(x.etiqueta);
      btn.addEventListener("click", () => {
        tipo = x.id;
        actualizarVisibilidad();
      });
      grupoTipo.appendChild(btn);
    });
    bloqueTipo = crearCampo("Tipo", grupoTipo);
  }
  caja.appendChild(bloqueTipo);

  // ----- Monto y nombre (siempre arriba) -----
  const inputMonto = crearInputMonto(esExistente && !movimiento.recurrente ? movimiento.monto : "");
  const bloqueMonto = crearCampo("Monto", inputMonto);
  caja.appendChild(bloqueMonto);

  const inputNombre = crearInput("text", movimiento ? movimiento.nombre : "");
  caja.appendChild(crearCampo("Nombre", inputNombre));

  // ----- Recurrencia (gasto/ingreso manual) -----
  const recurrencia = construirSeccionRecurrencia({
    recurrenteInicial: movimiento ? movimiento.recurrente : null,
    esIngreso: tipo === "ingreso",
    alCambiar: () => actualizarVisibilidad(),
  });
  const bloqueRecurrencia = recurrencia.elemento;
  if (!esDeModulo) caja.appendChild(bloqueRecurrencia);

  // ----- Gasto: ¿de dónde sale? -----
  const metasIniciales = obtenerMetasActivas(movimiento && movimiento.pagado_con_meta_id);
  const selectorPagarCon = construirSelectorFinanzas({
    opciones: [{ valor: "", texto: t("Mi dinero") }, ...metasIniciales.map((m) => ({ valor: m.id, texto: `${m.emoji || "🎯"} ${m.nombre}` }))],
    valorInicial: (movimiento && movimiento.pagado_con_meta_id) || "",
  });
  const bloquePagarCon = crearCampo("Pagar con", selectorPagarCon.elemento);
  caja.appendChild(bloquePagarCon);

  // ----- Ahorro / transferencia: meta -----
  const metasSelect = obtenerMetasActivas(movimiento && movimiento.meta_id);
  const selectorMeta = construirSelectorFinanzas({
    opciones: [
      ...metasSelect.map((m) => ({ valor: m.id, texto: `${m.emoji || "🎯"} ${m.nombre}` })),
      { valor: NUEVA_META, texto: t("+ Nueva meta") },
    ],
    valorInicial: (movimiento && movimiento.meta_id) || (metasSelect[0] ? metasSelect[0].id : NUEVA_META),
    onCambiar: () => actualizarVisibilidad(),
  });
  const bloqueMeta = crearCampo("Meta", selectorMeta.elemento);
  caja.appendChild(bloqueMeta);

  const inputMetaNombre = crearInput("text", "", t("Ej. Laptop, viaje, fondo de emergencia"));
  const inputMetaObjetivo = crearInputMonto("");
  const inputMetaInicial = crearInputMonto("");
  const bloqueNuevaMeta = document.createElement("div");
  bloqueNuevaMeta.className = "stack";
  bloqueNuevaMeta.style.cssText = "padding:10px; border:1px solid var(--border-glass); border-radius:var(--radius-md);";
  bloqueNuevaMeta.append(
    crearCampo("Nombre de la meta", inputMetaNombre),
    crearCampo("¿Cuánto quieres juntar? (opcional)", inputMetaObjetivo),
    crearCampo("¿Cuánto llevas ya? (opcional)", inputMetaInicial)
  );
  caja.appendChild(bloqueNuevaMeta);

  const bloqueFuente = document.createElement("div");
  bloqueFuente.className = "stack";
  bloqueFuente.append(
    construirPillSwitchBinario(
      [{ valor: "liquido", texto: t("De mi dinero") }, { valor: "nuevo", texto: t("Dinero nuevo") }],
      fuente,
      (v) => { fuente = v; }
    )
  );
  const ayudaFuente = document.createElement("p");
  ayudaFuente.className = "muted";
  ayudaFuente.style.cssText = "margin:0; font-size:0.82rem;";
  ayudaFuente.textContent = t("Dinero nuevo entra directo a la meta y no resta de Mi dinero.");
  bloqueFuente.appendChild(ayudaFuente);
  caja.appendChild(bloqueFuente);

  const bloqueSentido = construirPillSwitchBinario(
    [{ valor: "a_meta", texto: t("A la meta") }, { valor: "desde_meta", texto: t("Desde la meta") }],
    sentido,
    (v) => { sentido = v; }
  );
  caja.appendChild(bloqueSentido);

  // ----- Fecha -----
  const inputFecha = crearInput("date", esExistente ? (movimiento.recurrente ? "" : movimiento.fecha_registro || "") : hoyIso());
  const bloqueFecha = crearCampo("Fecha", inputFecha);
  caja.appendChild(bloqueFecha);

  // ----- Más opciones (plegado): semestre y nota -----
  const detalles = document.createElement("details");
  const resumen = document.createElement("summary");
  resumen.style.cssText = "cursor:pointer; padding:6px 0;";
  resumen.textContent = t("Más opciones");
  detalles.appendChild(resumen);
  const cuerpoDetalles = document.createElement("div");
  cuerpoDetalles.className = "stack";

  const selectorSemestre = construirSelectorFinanzas({
    opciones: [{ valor: "", texto: t("Sin vincular") }, ...obtenerTodosLosSemestres().map((s) => ({ valor: s.id, texto: t(s.nombre) }))],
    valorInicial: (movimiento && movimiento.semestre_id) || "",
  });
  const bloqueSemestre = crearCampo("Vincular a un semestre (opcional)", selectorSemestre.elemento);
  cuerpoDetalles.appendChild(bloqueSemestre);

  const inputNota = document.createElement("textarea");
  inputNota.className = "form-textarea";
  inputNota.rows = 3;
  inputNota.value = (movimiento && movimiento.nota) || "";
  cuerpoDetalles.appendChild(crearCampo("Nota (opcional)", inputNota));
  detalles.appendChild(cuerpoDetalles);
  detalles.open = !!(movimiento && (movimiento.nota || movimiento.semestre_id));
  caja.appendChild(detalles);

  // ----- Visibilidad según tipo -----
  function actualizarVisibilidad() {
    const esMov = tipo === "gasto" || tipo === "ingreso";
    const esMeta = tipo === "ahorro" || tipo === "transferencia";
    const recurre = esMov && !esDeModulo && recurrencia.estaActivo();
    grupoTipo.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === tipo));
    recurrencia.fijarEsIngreso(tipo === "ingreso");
    bloqueRecurrencia.classList.toggle("oculto", !esMov);
    bloqueMonto.classList.toggle("oculto", recurre);
    bloqueFecha.classList.toggle("oculto", recurre);
    bloquePagarCon.classList.toggle("oculto", tipo !== "gasto" || !modulos.ahorros || metasIniciales.length === 0);
    bloqueMeta.classList.toggle("oculto", !esMeta);
    bloqueNuevaMeta.classList.toggle("oculto", !(esMeta && selectorMeta.obtenerValor() === NUEVA_META));
    bloqueFuente.classList.toggle("oculto", tipo !== "ahorro");
    bloqueSentido.classList.toggle("oculto", tipo !== "transferencia");
    bloqueSemestre.classList.toggle("oculto", !esMov || esDeModulo);
    inputNombre.placeholder = t(
      tipo === "gasto" ? "Ej. Almuerzo, pasaje, materiales..." : tipo === "ingreso" ? "Ej. Trabajo de medio tiempo, mesada..." : "Opcional"
    );
  }

  // ----- Botones -----
  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.cssText = "margin-top:8px; flex-wrap:nowrap; gap:8px;";
  const estiloBoton = "flex:1; min-width:0; white-space:nowrap; font-size:clamp(0.72rem,3vw,0.9rem); padding:clamp(6px,2vw,10px) clamp(6px,2vw,14px);";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.style.cssText = estiloBoton;
  btnCancelar.textContent = t("Cancelar");
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  if (esExistente) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger";
    btnEliminar.style.cssText = estiloBoton;
    btnEliminar.textContent = t("Eliminar");
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: t("Eliminar movimiento"),
        mensaje: t(`Se va a borrar "${nombreMostradoMovimiento(movimiento)}". Esta acción no se puede deshacer.`),
        textoConfirmar: t("Eliminar"),
        onConfirmar: () => {
          estado.datos.movimientos = (estado.datos.movimientos || []).filter((m) => m.id !== movimiento.id);
          if (!Array.isArray(estado.datos._eliminados_movimientos)) estado.datos._eliminados_movimientos = [];
          estado.datos._eliminados_movimientos.push({ id: movimiento.id, eliminadoEn: Date.now() });
          marcarCambioPendiente();
          cerrar();
          alGuardar();
        },
      });
    });
    filaBotones.appendChild(btnEliminar);
  }

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.style.cssText = estiloBoton;
  btnGuardar.textContent = t("Guardar");
  btnGuardar.addEventListener("click", () => {
    const esMov = tipo === "gasto" || tipo === "ingreso";
    const esMeta = tipo === "ahorro" || tipo === "transferencia";
    const nombre = inputNombre.value.trim();
    const recurrente = esMov && !esDeModulo ? recurrencia.obtenerValor() : null;
    const monto = recurrente ? 0 : Number(inputMonto.value) || 0;

    // Validar TODO antes de tocar los datos (así no queda una meta huérfana si algo falla).
    if (esMov && !nombre) return avisar(t("Escribe un nombre."), inputNombre);
    if (recurrente) {
      if (!recurrente.fecha_inicio) return avisar(t("Indica la fecha de inicio del pago recurrente."));
      if (!(recurrente.monto_por_pago > 0)) return avisar(t("Indica el monto por pago."));
    } else if (!(monto > 0)) {
      return avisar(t("Escribe un monto mayor a cero."), inputMonto);
    }
    const seleccionMeta = selectorMeta.obtenerValor();
    if (esMeta && seleccionMeta === NUEVA_META && !inputMetaNombre.value.trim()) {
      return avisar(t("Escribe un nombre para la meta."), inputMetaNombre);
    }

    if (!Array.isArray(estado.datos.movimientos)) estado.datos.movimientos = [];
    let metaId = null;
    if (esMeta) {
      if (seleccionMeta === NUEVA_META) {
        const meta = crearMeta({ nombre: inputMetaNombre.value.trim(), objetivo: inputMetaObjetivo.value, saldoInicial: inputMetaInicial.value });
        if (!Array.isArray(estado.datos.metas)) estado.datos.metas = [];
        estado.datos.metas.push(meta);
        metaId = meta.id;
      } else {
        metaId = seleccionMeta;
      }
    }

    const nuevo = crearMovimiento({
      id: esExistente ? movimiento.id : undefined,
      tipo,
      nombre,
      monto,
      fechaRegistro: recurrente ? recurrente.fecha_inicio : inputFecha.value || null,
      nota: inputNota.value.trim() || null,
      semestreId: esDeModulo ? movimiento.semestre_id : esMov ? selectorSemestre.obtenerValor() || null : null,
      origen: esExistente ? movimiento.origen : "manual",
      metaId,
      fuente,
      sentido,
      pagadoConMetaId: tipo === "gasto" ? selectorPagarCon.obtenerValor() || null : null,
      recurrente,
    });

    const indice = esExistente ? estado.datos.movimientos.findIndex((m) => m.id === movimiento.id) : -1;
    if (indice >= 0) estado.datos.movimientos[indice] = nuevo;
    else estado.datos.movimientos.push(nuevo);

    marcarCambioPendiente();
    cerrar();
    alGuardar();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  function avisar(mensaje, campo) {
    mostrarToast(mensaje);
    if (campo) campo.focus();
  }

  actualizarVisibilidad();
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
  if (!esExistente) setTimeout(() => inputMonto.focus(), 50);
}

export { abrirModalMovimiento, nombreMostradoMovimiento, obtenerMetasActivas };
