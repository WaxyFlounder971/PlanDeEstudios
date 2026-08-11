/* =========================================================================
   FINANZAS — Pestaña Semestres (2026-08-10)
   Lista TODOS los semestres del historial (actuales y pasados) y permite
   crear/editar el registro financiero de cada uno: costo total, beca +
   porcentaje, desglose mensual (manual o automático) y pago confirmado
   (auto-calculado, editable a mano).
   ========================================================================= */

import { calcularNetoSugeridoFinanzas, crearRegistroFinancieroSemestre, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearMonto } from "./finanzas.js";

/**
 * Reparte `total` entre `cantidadMeses` meses lo más parejo posible,
 * trabajando en centavos para evitar errores de redondeo — el residuo (si
 * el total no divide exacto) se lo lleva el último mes, para que la suma
 * de los meses siempre cuadre EXACTO con el total, sin importar cuántos
 * meses sean.
 */
function repartirMontoEnMeses(total, cantidadMeses) {
  const n = Math.max(1, Math.floor(Number(cantidadMeses)) || 1);
  const totalCentavos = Math.round((Number(total) || 0) * 100);
  const baseCentavos = Math.floor(totalCentavos / n);
  const resto = totalCentavos - baseCentavos * n;
  const meses = [];
  for (let i = 0; i < n; i++) {
    const centavos = baseCentavos + (i === n - 1 ? resto : 0);
    meses.push({ id: "dm_" + crypto.randomUUID(), mes: `Mes ${i + 1}`, monto: centavos / 100 });
  }
  return meses;
}

function obtenerRegistroDeSemestre(semestreId) {
  return (estado.datos.finanzas_semestre || []).find((r) => r.semestre_id === semestreId) || null;
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
    const registro = obtenerRegistroDeSemestre(semestre.id);
    const fila = document.createElement("div");
    fila.className = "glass-card row-between";

    const info = document.createElement("div");
    info.innerHTML = `
      <p style="margin:0; font-weight:600;">${semestre.nombre}</p>
      <p class="muted" style="margin:2px 0 0;">${semestre.fecha_inicio || ""}</p>
    `;

    const derecha = document.createElement("div");
    derecha.className = "row";

    if (registro) {
      const badge = document.createElement("span");
      badge.className = "badge " + (Number(registro.pago_confirmado) < 0 ? "badge-success" : "badge-neutral");
      badge.textContent = formatearMonto(registro.pago_confirmado);
      derecha.appendChild(badge);
    }

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary";
    btn.textContent = registro ? "Editar registro" : "Crear registro";
    btn.addEventListener("click", () => abrirModalRegistroFinanciero(semestre, registro, contenedor));
    derecha.appendChild(btn);

    fila.appendChild(info);
    fila.appendChild(derecha);
    contenedor.appendChild(fila);
  });
}

function abrirModalRegistroFinanciero(semestre, registroExistente, contenedorLista) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:520px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", cerrar);

  caja.innerHTML = `<h2 style="margin:0;">${registroExistente ? "Editar" : "Registrar"} finanzas de ${semestre.nombre}</h2>`;

  // ----- Costo total -----
  const bloqueCosto = document.createElement("div");
  bloqueCosto.innerHTML = `<span class="form-label">Costo total (puede ser negativo)</span>`;
  const inputCosto = document.createElement("input");
  inputCosto.type = "number";
  inputCosto.step = "0.01";
  inputCosto.className = "form-input";
  inputCosto.value = registroExistente ? registroExistente.costo_total : "";
  bloqueCosto.appendChild(inputCosto);
  caja.appendChild(bloqueCosto);

  // ----- Beca -----
  const filaBeca = document.createElement("div");
  filaBeca.className = "row-between";
  filaBeca.innerHTML = `
    <span>¿Tiene beca?</span>
    <label class="switch switch-tema">
      <input type="checkbox" id="switch-beca-finanzas">
      <span class="track"><span class="thumb"></span></span>
    </label>
  `;
  caja.appendChild(filaBeca);
  const switchBeca = filaBeca.querySelector("#switch-beca-finanzas");
  switchBeca.checked = registroExistente ? !!registroExistente.beca_activa : false;

  const bloquePorcentaje = document.createElement("div");
  bloquePorcentaje.innerHTML = `<span class="form-label">Porcentaje de la beca</span>`;
  const inputPorcentaje = document.createElement("input");
  inputPorcentaje.type = "number";
  inputPorcentaje.min = "0";
  inputPorcentaje.max = "100";
  inputPorcentaje.step = "1";
  inputPorcentaje.className = "form-input";
  inputPorcentaje.value = registroExistente ? registroExistente.porcentaje_beca : "";
  bloquePorcentaje.appendChild(inputPorcentaje);
  caja.appendChild(bloquePorcentaje);

  const actualizarVisibilidadPorcentaje = () => {
    bloquePorcentaje.classList.toggle("oculto", !switchBeca.checked);
  };
  actualizarVisibilidadPorcentaje();
  switchBeca.addEventListener("change", () => {
    actualizarVisibilidadPorcentaje();
    recalcularPagoSugeridoSiCorresponde();
  });

  // ----- Pago confirmado (auto + editable) -----
  const bloquePago = document.createElement("div");
  bloquePago.innerHTML = `<span class="form-label">Pago confirmado (neto sugerido, editable a mano)</span>`;
  const inputPago = document.createElement("input");
  inputPago.type = "number";
  inputPago.step = "0.01";
  inputPago.className = "form-input";
  inputPago.value = registroExistente
    ? registroExistente.pago_confirmado
    : calcularNetoSugeridoFinanzas(0, false, 0);
  bloquePago.appendChild(inputPago);
  caja.appendChild(bloquePago);

  // Si el usuario ya editó pago_confirmado a mano en esta sesión, dejar de
  // recalcularlo solo al tocar costo/beca — mismo criterio que
  // pago_confirmado_manual en el dato persistido.
  let pagoTocadoAMano = registroExistente ? !!registroExistente.pago_confirmado_manual : false;
  inputPago.addEventListener("input", () => {
    pagoTocadoAMano = true;
  });

  function recalcularPagoSugeridoSiCorresponde() {
    if (pagoTocadoAMano) return;
    const sugerido = calcularNetoSugeridoFinanzas(
      Number(inputCosto.value) || 0,
      switchBeca.checked,
      Number(inputPorcentaje.value) || 0
    );
    inputPago.value = sugerido;
  }
  inputCosto.addEventListener("input", recalcularPagoSugeridoSiCorresponde);
  inputPorcentaje.addEventListener("input", recalcularPagoSugeridoSiCorresponde);

  // ----- Desglose mensual -----
  const bloqueDesglose = document.createElement("div");
  bloqueDesglose.className = "stack";
  bloqueDesglose.innerHTML = `<span class="form-label">Desglose mensual</span>`;

  const pillModo = document.createElement("div");
  pillModo.className = "pill-group";
  pillModo.innerHTML = `
    <button type="button" class="pill-item" data-valor="manual">Manual</button>
    <button type="button" class="pill-item" data-valor="automatico">Automático</button>
  `;
  bloqueDesglose.appendChild(pillModo);

  let desgloseActual = registroExistente
    ? JSON.parse(JSON.stringify(registroExistente.desglose_mensual))
    : { modo: "manual", meses: [], automatico_cantidad_meses: null };

  const contenedorDesglose = document.createElement("div");
  contenedorDesglose.className = "stack";
  bloqueDesglose.appendChild(contenedorDesglose);
  caja.appendChild(bloqueDesglose);

  function marcarPillActivo() {
    pillModo.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === desgloseActual.modo));
  }

  function renderizarFilasManual() {
    contenedorDesglose.innerHTML = "";
    desgloseActual.meses.forEach((mesEntry, idx) => {
      const fila = document.createElement("div");
      fila.className = "row";
      const inputMes = document.createElement("input");
      inputMes.type = "text";
      inputMes.className = "form-input";
      inputMes.style.flex = "1";
      inputMes.placeholder = "Ej. Enero";
      inputMes.value = mesEntry.mes;
      inputMes.addEventListener("input", () => (mesEntry.mes = inputMes.value));

      const inputMonto = document.createElement("input");
      inputMonto.type = "number";
      inputMonto.step = "0.01";
      inputMonto.className = "form-input";
      inputMonto.style.width = "120px";
      inputMonto.value = mesEntry.monto;
      inputMonto.addEventListener("input", () => (mesEntry.monto = Number(inputMonto.value) || 0));

      const btnQuitar = document.createElement("button");
      btnQuitar.type = "button";
      btnQuitar.className = "btn btn-danger";
      btnQuitar.textContent = "✕";
      btnQuitar.addEventListener("click", () => {
        desgloseActual.meses.splice(idx, 1);
        renderizarFilasManual();
      });

      fila.appendChild(inputMes);
      fila.appendChild(inputMonto);
      fila.appendChild(btnQuitar);
      contenedorDesglose.appendChild(fila);
    });

    const btnAgregar = document.createElement("button");
    btnAgregar.type = "button";
    btnAgregar.className = "btn btn-secondary btn-block";
    btnAgregar.textContent = "+ Agregar mes";
    btnAgregar.addEventListener("click", () => {
      desgloseActual.meses.push({ id: "dm_" + crypto.randomUUID(), mes: "", monto: 0 });
      renderizarFilasManual();
    });
    contenedorDesglose.appendChild(btnAgregar);
  }

  function renderizarBloqueAutomatico() {
    contenedorDesglose.innerHTML = "";
    const filaCantidad = document.createElement("div");
    filaCantidad.className = "row";
    const inputCantidad = document.createElement("input");
    inputCantidad.type = "number";
    inputCantidad.min = "1";
    inputCantidad.className = "form-input";
    inputCantidad.placeholder = "Cantidad de meses";
    inputCantidad.value = desgloseActual.automatico_cantidad_meses || "";
    const btnRepartir = document.createElement("button");
    btnRepartir.type = "button";
    btnRepartir.className = "btn btn-primary";
    btnRepartir.textContent = "Repartir";
    btnRepartir.addEventListener("click", () => {
      const cantidad = Number(inputCantidad.value) || 0;
      if (cantidad < 1) return;
      desgloseActual.automatico_cantidad_meses = cantidad;
      desgloseActual.meses = repartirMontoEnMeses(inputPago.value, cantidad);
      renderizarBloqueAutomatico();
    });
    filaCantidad.appendChild(inputCantidad);
    filaCantidad.appendChild(btnRepartir);
    contenedorDesglose.appendChild(filaCantidad);

    if (desgloseActual.meses.length > 0) {
      const lista = document.createElement("div");
      lista.className = "stack";
      lista.style.gap = "4px";
      desgloseActual.meses.forEach((m) => {
        const l = document.createElement("p");
        l.className = "muted";
        l.style.margin = "0";
        l.textContent = `${m.mes}: ${formatearMonto(m.monto)}`;
        lista.appendChild(l);
      });
      contenedorDesglose.appendChild(lista);
    }
  }

  function renderizarSegunModo() {
    marcarPillActivo();
    if (desgloseActual.modo === "manual") renderizarFilasManual();
    else renderizarBloqueAutomatico();
  }

  pillModo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      desgloseActual.modo = btn.dataset.valor;
      renderizarSegunModo();
    });
  });

  renderizarSegunModo();

  // ----- Botones -----
  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.marginTop = "8px";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.style.flex = "1";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  if (registroExistente) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger";
    btnEliminar.style.flex = "1";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar registro financiero",
        mensaje: `Se va a borrar el registro financiero de ${semestre.nombre}. Esta acción no se puede deshacer.`,
        textoConfirmar: "Eliminar registro",
        onConfirmar: () => {
          estado.datos.finanzas_semestre = (estado.datos.finanzas_semestre || []).filter(
            (r) => r.id !== registroExistente.id
          );
          if (!Array.isArray(estado.datos._eliminados_finanzas_semestre)) {
            estado.datos._eliminados_finanzas_semestre = [];
          }
          estado.datos._eliminados_finanzas_semestre.push({ id: registroExistente.id, eliminadoEn: Date.now() });
          marcarCambioPendiente();
          cerrar();
          contenedorLista.innerHTML = "";
          renderizarPestanaSemestresFinanzas(contenedorLista);
        },
      });
    });
    filaBotones.appendChild(btnEliminar);
  }

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.style.flex = "1";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    const costo = Number(inputCosto.value) || 0;
    const becaActiva = switchBeca.checked;
    const porcentaje = Number(inputPorcentaje.value) || 0;
    const pago = Number(inputPago.value) || 0;

    if (registroExistente) {
      registroExistente.costo_total = costo;
      registroExistente.beca_activa = becaActiva;
      registroExistente.porcentaje_beca = porcentaje;
      registroExistente.pago_confirmado = pago;
      registroExistente.pago_confirmado_manual = pagoTocadoAMano;
      registroExistente.desglose_mensual = desgloseActual;
      sellarTimestamp(registroExistente);
    } else {
      const nuevo = crearRegistroFinancieroSemestre({
        semestreId: semestre.id,
        costoTotal: costo,
        becaActiva,
        porcentajeBeca: porcentaje,
      });
      nuevo.pago_confirmado = pago;
      nuevo.pago_confirmado_manual = pagoTocadoAMano;
      nuevo.desglose_mensual = desgloseActual;
      if (!Array.isArray(estado.datos.finanzas_semestre)) estado.datos.finanzas_semestre = [];
      estado.datos.finanzas_semestre.push(nuevo);
    }
    marcarCambioPendiente();
    cerrar();
    contenedorLista.innerHTML = "";
    renderizarPestanaSemestresFinanzas(contenedorLista);
  });
  filaBotones.appendChild(btnGuardar);

  caja.appendChild(filaBotones);
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

export { renderizarPestanaSemestresFinanzas };
