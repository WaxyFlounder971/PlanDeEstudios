/* =========================================================================
   FINANZAS — Pestaña Semestres (2026-08-10, simplificado en v2.8.8)
   Lista TODOS los semestres del historial (actuales y pasados) y permite
   crear/editar el registro financiero de cada uno: costo de matrícula,
   cobertura de beca (dos montos directos e independientes, sin fórmula
   entre ellos) y desglose mensual del pago de matrícula (manual o
   automático, para semestres pagados en varias cuotas).
   ========================================================================= */

import { crearRegistroFinancieroSemestre, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

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
      <p class="muted" style="margin:2px 0 0;">${formatearFechaLarga(semestre.fecha_inicio)}</p>
    `;

    const derecha = document.createElement("div");
    derecha.className = "row";
    derecha.style.alignItems = "center";
    derecha.style.gap = "10px";

    if (registro) {
      // v2.8.9: antes eran 2 badges lado a lado — ahora van apiladas, una
      // sobre la otra, en el mismo lugar: matrícula (rojo, es gasto) arriba,
      // beca (verde, es ingreso) abajo — mismo código de color que el resto
      // de Finanzas (badge-danger/badge-success), pedido explícito.
      const columnaMontos = document.createElement("div");
      columnaMontos.className = "stack";
      columnaMontos.style.cssText = "gap:4px; align-items:flex-end;";

      const badgeMatricula = document.createElement("span");
      badgeMatricula.className = "badge badge-danger";
      badgeMatricula.textContent = formatearMonto(registro.costo_matricula);
      columnaMontos.appendChild(badgeMatricula);

      if (Number(registro.beca_monto) > 0) {
        const badgeBeca = document.createElement("span");
        badgeBeca.className = "badge badge-success";
        badgeBeca.title = "Beca";
        badgeBeca.textContent = formatearMonto(registro.beca_monto);
        columnaMontos.appendChild(badgeBeca);
      }
      derecha.appendChild(columnaMontos);
    }

    // v2.8.9: "se ve feo" -> botón de texto discreto (sin caja/fondo propio)
    // en vez de .btn-secondary, para que no compita visualmente con los
    // badges de monto que están justo al lado.
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn-discreto";
    btn.textContent = registro ? "Editar" : "Crear registro";
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

  // ----- Costo de matrícula (v2.8.8: reemplaza costo total + pago
  // confirmado + beca% — ahora es UN solo input, lo que efectivamente
  // pagaste. Se quita a propósito la aclaración de "puede ser negativo":
  // el campo internamente sigue aceptando cualquier valor, solo se saca
  // el texto visible porque confundía. -----
  const bloqueCosto = document.createElement("div");
  bloqueCosto.innerHTML = `<span class="form-label">Costo de matrícula</span>`;
  const inputCosto = document.createElement("input");
  inputCosto.type = "number";
  inputCosto.step = "0.01";
  inputCosto.className = "form-input";
  inputCosto.value = registroExistente ? registroExistente.costo_matricula : "";
  bloqueCosto.appendChild(inputCosto);
  caja.appendChild(bloqueCosto);

  // ----- ¿Cuánto cayó de beca? (v2.8.9: se pregunta directo, así es como
  // la gente lo piensa de verdad — la matrícula se exonera aparte y sola;
  // esto es la plata que sí te depositan (transporte, comida, etc.). Monto
  // directo, sin switch ni porcentaje. Opcional: se puede dejar en 0/vacío
  // si no aplica. -----
  const bloqueBeca = document.createElement("div");
  bloqueBeca.innerHTML = `<span class="form-label">¿Cuánto cayó de beca?</span>`;
  const inputBeca = document.createElement("input");
  inputBeca.type = "number";
  inputBeca.step = "0.01";
  inputBeca.min = "0";
  inputBeca.className = "form-input";
  inputBeca.value = registroExistente ? registroExistente.beca_monto : "";
  bloqueBeca.appendChild(inputBeca);
  caja.appendChild(bloqueBeca);

  // ----- Desglose mensual (v2.8.8: se queda donde estaba — sobre el pago
  // de matrícula, no se movió — solo se le agrega texto aclaratorio de
  // para qué sirve: pagar el semestre en varias cuotas en vez de un solo
  // monto. v2.8.9: se saca "cayó" del texto (quedaba raro) y se agrega un
  // resumen en vivo de cuánto llevás repartido / cuánto queda, con
  // validación real: no se puede guardar un desglose manual que reparta
  // más de lo que cuesta la matrícula. -----
  const bloqueDesglose = document.createElement("div");
  bloqueDesglose.className = "stack";
  bloqueDesglose.innerHTML = `
    <span class="form-label">Desglose mensual del pago</span>
    <p class="muted" style="font-size:0.78rem; margin:2px 0 6px;">En caso de que pagués el semestre por pagos: indicá cuántos pagos hiciste y el monto de cada uno.</p>
  `;

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

  // Resumen en vivo de "cuánto llevás repartido / cuánto queda" — solo
  // aplica al modo manual (el automático siempre reparte EXACTO el total
  // que tenía inputCosto en el momento de tocar "Repartir", por
  // construcción de repartirMontoEnMeses, así que nunca puede pasarse).
  // Persiste fuera de contenedorDesglose para no perderse entre
  // re-renders del modo, y devuelve `false` cuando el desglose manual se
  // pasa del costo de matrícula — eso es lo que btnGuardar consulta al
  // hacer click para bloquear el guardado (ver más abajo).
  const resumenReparto = document.createElement("p");
  resumenReparto.className = "muted";
  resumenReparto.style.cssText = "font-size:0.82rem; margin:6px 0 0;";
  bloqueDesglose.appendChild(resumenReparto);
  caja.appendChild(bloqueDesglose);

  function estaDesgloseManualSobrepasado() {
    if (desgloseActual.modo !== "manual") {
      resumenReparto.textContent = "";
      return false;
    }
    const costoMatricula = Number(inputCosto.value) || 0;
    const sumaRepartida = desgloseActual.meses.reduce((acc, m) => acc + (Number(m.monto) || 0), 0);
    const restante = costoMatricula - sumaRepartida;
    if (restante < -0.005) {
      resumenReparto.innerHTML = `Repartiste ${formatearMonto(sumaRepartida)} de ${formatearMonto(costoMatricula)} — <strong style="color:#f87171;">te pasaste por ${formatearMonto(Math.abs(restante))}</strong>. No podés repartir más de lo que cuesta la matrícula.`;
      return true;
    }
    resumenReparto.innerHTML = `Repartiste ${formatearMonto(sumaRepartida)} de ${formatearMonto(costoMatricula)} — queda <strong>${formatearMonto(restante)}</strong> por repartir.`;
    return false;
  }

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
      inputMonto.addEventListener("input", () => {
        mesEntry.monto = Number(inputMonto.value) || 0;
        estaDesgloseManualSobrepasado();
      });

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
    btnAgregar.textContent = "+ Agregar pago";
    btnAgregar.addEventListener("click", () => {
      desgloseActual.meses.push({ id: "dm_" + crypto.randomUUID(), mes: "", monto: 0 });
      renderizarFilasManual();
    });
    contenedorDesglose.appendChild(btnAgregar);

    estaDesgloseManualSobrepasado();
  }

  function renderizarBloqueAutomatico() {
    contenedorDesglose.innerHTML = "";
    resumenReparto.textContent = "";
    const filaCantidad = document.createElement("div");
    filaCantidad.className = "row";
    const inputCantidad = document.createElement("input");
    inputCantidad.type = "number";
    inputCantidad.min = "1";
    inputCantidad.className = "form-input";
    inputCantidad.placeholder = "Cantidad de pagos";
    inputCantidad.value = desgloseActual.automatico_cantidad_meses || "";
    const btnRepartir = document.createElement("button");
    btnRepartir.type = "button";
    btnRepartir.className = "btn btn-primary";
    btnRepartir.textContent = "Repartir";
    btnRepartir.addEventListener("click", () => {
      const cantidad = Number(inputCantidad.value) || 0;
      if (cantidad < 1) return;
      desgloseActual.automatico_cantidad_meses = cantidad;
      // v2.8.8: se reparte el costo de matrícula (único monto de pago que
      // queda), ya no "pago confirmado" (campo que desapareció).
      desgloseActual.meses = repartirMontoEnMeses(inputCosto.value, cantidad);
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

  // Cambiar el costo de matrícula también recalcula en vivo cuánto queda
  // por repartir (si el desglose es manual) — sin reconstruir las filas,
  // para no perder el foco de lo que la persona esté editando.
  inputCosto.addEventListener("input", estaDesgloseManualSobrepasado);

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
    if (estaDesgloseManualSobrepasado()) {
      mostrarToast("El desglose manual reparte más de lo que cuesta la matrícula — ajustalo antes de guardar.");
      return;
    }
    const costoMatricula = Number(inputCosto.value) || 0;
    const becaMonto = Number(inputBeca.value) || 0;

    if (registroExistente) {
      registroExistente.costo_matricula = costoMatricula;
      registroExistente.beca_monto = becaMonto;
      registroExistente.desglose_mensual = desgloseActual;
      sellarTimestamp(registroExistente);
    } else {
      const nuevo = crearRegistroFinancieroSemestre({
        semestreId: semestre.id,
        costoMatricula,
        becaMonto,
      });
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
