/* =========================================================================
   FINANZAS — Pestaña Semestres (2026-08-10, simplificado en v2.8.8)
   Lista TODOS los semestres del historial (actuales y pasados) y permite
   crear/editar el registro financiero de cada uno: costo de matrícula,
   cobertura de beca (dos montos directos e independientes, sin fórmula
   entre ellos) y desglose mensual del pago de matrícula (manual o
   automático, para semestres pagados en varias cuotas).
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
import { abrirConfirmacion } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";

/**
 * Reparte `total` entre `cantidadMeses` meses lo más parejo posible,
 * trabajando en centavos para evitar errores de redondeo — el residuo (si
 * el total no divide exacto) se lo lleva el último mes, para que la suma
 * de los meses siempre cuadre EXACTO con el total, sin importar cuántos
 * meses sean.
 *
 * Becas y Pagos de Matrícula — Parte A (2026-09-12): esta función queda
 * SIN USO en este archivo por ahora (el desglose mensual del modelo viejo
 * se retira más abajo, ver notas junto al modal) — se deja intacta a
 * propósito porque es exactamente la lógica que pide la Parte B.2 ("Dividir
 * un monto en varias partes" al agregar un pago), solo que ahí generará
 * `pagos_matricula` en vez de entradas de `desglose_mensual.meses`.
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

      const totalMatricula = calcularTotalPagosMatricula(registro);
      const totalBeca = calcularTotalIngresosBeca(registro);

      const badgeMatricula = document.createElement("span");
      badgeMatricula.className = "badge badge-danger";
      badgeMatricula.textContent = formatearMonto(totalMatricula);
      columnaMontos.appendChild(badgeMatricula);

      if (totalBeca > 0) {
        const badgeBeca = document.createElement("span");
        badgeBeca.className = "badge badge-success";
        badgeBeca.title = "Beca";
        badgeBeca.textContent = formatearMonto(totalBeca);
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
  inputCosto.value = registroExistente ? calcularTotalPagosMatricula(registroExistente) : "";
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
  inputBeca.value = registroExistente ? calcularTotalIngresosBeca(registroExistente) : "";
  bloqueBeca.appendChild(inputBeca);
  caja.appendChild(bloqueBeca);

  // ----- Desglose mensual: RETIRADO en Parte A (2026-09-12) -----
  // `desglose_mensual` era la estructura que este bloque editaba — dejó de
  // existir en el modelo tras la migración de Parte A.2 (se convirtió en
  // entradas de `pagos_matricula`, ver migrarDatosAntiguos en schema.js).
  // Este modal entero es transitorio: sigue editando "un solo monto" de
  // matrícula y uno de beca (mapeado sobre el primer ítem de cada lista,
  // ver btnGuardar más abajo) hasta que la Parte B lo reemplace por las
  // tarjetas individuales de pagos_matricula/ingresos_beca. La Parte B.2
  // ("Dividir un monto en varias partes") es la que retoma esta idea de
  // repartir un pago en cuotas — ya sobre pagos_matricula reales, no sobre
  // esta estructura vieja — reutilizando repartirMontoEnMeses de arriba.
  const notaDesgloseRetirado = document.createElement("p");
  notaDesgloseRetirado.className = "muted";
  notaDesgloseRetirado.style.cssText = "font-size:0.78rem; margin:0;";
  notaDesgloseRetirado.textContent =
    "El pago por cuotas se va a poder dividir de nuevo (y editar cada cuota por separado) en la próxima entrega.";
  caja.appendChild(notaDesgloseRetirado);

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
    const costoMatricula = Number(inputCosto.value) || 0;
    const becaMonto = Number(inputBeca.value) || 0;

    if (registroExistente) {
      // Becas y Pagos de Matrícula — Parte A (transitorio): este modal
      // todavía edita "un solo monto" de cada lado — se mapea sobre el
      // PRIMER ítem de cada lista (se crea uno si no existía todavía).
      // Parte B reemplaza esto por tarjetas individuales de verdad.
      if (registroExistente.pagos_matricula.length > 0) {
        registroExistente.pagos_matricula[0].monto = costoMatricula;
        sellarTimestamp(registroExistente.pagos_matricula[0]);
      } else if (costoMatricula > 0) {
        registroExistente.pagos_matricula.push(crearPagoMatricula({ descripcion: "Matrícula", monto: costoMatricula }));
      }
      if (registroExistente.ingresos_beca.length > 0) {
        registroExistente.ingresos_beca[0].monto = becaMonto;
        sellarTimestamp(registroExistente.ingresos_beca[0]);
      } else if (becaMonto > 0) {
        registroExistente.ingresos_beca.push(crearIngresoBeca({ descripcion: "Beca", monto: becaMonto }));
      }
      sellarTimestamp(registroExistente);
    } else {
      const nuevo = crearRegistroFinancieroSemestre({
        semestreId: semestre.id,
        costoMatricula,
        becaMonto,
      });
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
