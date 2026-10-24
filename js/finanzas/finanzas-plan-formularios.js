/* =========================================================================
   FINANZAS 2.0: Plan: formularios (sesión 2, F1)
   Generador de cuotas ("Planificar pagos"), editor de un compromiso,
   confirmar con otro monto o fecha, y reajustar una serie. Toda la lógica
   vive en core/finanzas-compromisos.js; aquí solo hay pantalla (sin innerHTML).
   Un plan no mueve dinero del banco: es un registro propio de la app.
   ========================================================================= */

import { hoyIso } from "../core/finanzas-modelo.js";
import { obtenerModulosFinanzas } from "../core/finanzas-derivados.js";
import {
  MAX_CUOTAS, confirmarCompromiso, construirCuotas, deshacerConfirmacion, editarCompromiso,
  eliminarCompromiso, generarCuotas, omitirCompromiso, reajustarSerie,
} from "../core/finanzas-compromisos.js";
import { crearGuardReentrada, parsearMonto } from "../core/finanzas-registro.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { formatearFechaLarga, formatearMonto } from "./finanzas.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { abrirCapa, crearBoton, crearCampo, crearEntrada, crearLineaError, mostrarBarraDeshacer, mostrarError } from "./finanzas-registro-rapido.js";

/** Qué se puede planificar, y qué módulo lo gobierna. Ayuda familiar y trabajo viven en Gastos e ingresos. */
const TIPOS_PLAN = [
  { id: "matricula", tipo: "matricula", subtipo: null, etiqueta: "Matrícula", modulo: "matricula", nombreBase: "Cuota", modoInicial: "total" },
  { id: "beca", tipo: "ingreso_esperado", subtipo: "beca", etiqueta: "Beca", modulo: "beca", nombreBase: "Beca", modoInicial: "por_pago" },
  { id: "ayuda_familiar", tipo: "ingreso_esperado", subtipo: "ayuda_familiar", etiqueta: "Ayuda familiar", modulo: "gastos", nombreBase: "Ayuda familiar", modoInicial: "por_pago" },
  { id: "trabajo", tipo: "ingreso_esperado", subtipo: "trabajo", etiqueta: "Trabajo", modulo: "gastos", nombreBase: "Trabajo", modoInicial: "por_pago" },
];

const MENSAJES_ERROR = {
  monto: "Escribe un monto mayor que cero.",
  cantidad: "El número de pagos debe ser un entero entre 1 y {max}.",
  semestre: "Elige un semestre.",
  fecha: "Revisa la fecha.",
  tipo: "Elige qué quieres planificar.",
  no_existe: "Ese pago ya no existe.",
  sin_movimiento: "Ese pago ya se confirmó, pero su movimiento se eliminó. Vuelve a ponerlo en pendiente.",
  cumplido: "Ya está confirmado: no se puede editar desde el plan.",
};
const textoError = (motivo) => t(MENSAJES_ERROR[motivo] || "No se pudo guardar.").replace("{max}", String(MAX_CUOTAS));

function crearSelect(opciones, valor) {
  const s = document.createElement("select");
  s.className = "form-input";
  opciones.forEach(([v, texto]) => {
    const o = document.createElement("option");
    o.value = v;
    o.textContent = texto;
    s.appendChild(o);
  });
  s.value = valor;
  return s;
}

function crearInterruptor(texto, ayuda, marcado) {
  const caja = document.createElement("div");
  caja.className = "stack";
  caja.style.gap = "2px";
  const etiqueta = document.createElement("label");
  etiqueta.className = "row";
  etiqueta.style.cssText = "gap:8px; align-items:center; cursor:pointer;";
  const check = document.createElement("input");
  check.type = "checkbox";
  check.checked = !!marcado;
  const span = document.createElement("span");
  span.textContent = texto;
  etiqueta.append(check, span);
  caja.appendChild(etiqueta);
  if (ayuda) {
    const p = document.createElement("span");
    p.className = "muted";
    p.style.fontSize = "0.78rem";
    p.textContent = ayuda;
    caja.appendChild(p);
  }
  return { caja, check };
}

function filaBotones(...botones) {
  const fila = document.createElement("div");
  fila.className = "row";
  fila.style.cssText = `display:grid; grid-template-columns:repeat(${botones.length}, 1fr); gap:8px;`;
  fila.append(...botones);
  return fila;
}

const textoAyudaSaldo = () => t("Actívalo si tú pagas esta matrícula. Si te la paga otra persona, déjalo apagado.");

/* ===================== Generador de cuotas ===================== */

function abrirGeneradorCuotas({ alGuardar } = {}) {
  const modulos = obtenerModulosFinanzas(estado.datos);
  const tipos = TIPOS_PLAN.filter((x) => modulos[x.modulo]);
  if (!tipos.length) {
    mostrarToast(t("Enciende Matrícula, Beca o Gastos e ingresos en Ajustes para planificar pagos."));
    return;
  }
  const semestres = obtenerTodosLosSemestres();
  const { caja, cerrar } = abrirCapa("Planificar pagos");
  let actual = tipos[0];
  let modo = actual.modoInicial;

  const explica = document.createElement("p");
  explica.className = "muted";
  explica.style.margin = "0";
  explica.textContent = t("Planifica tus cuotas y desembolsos. Cuando llegue el día, confirmas cada uno con un toque y se vuelve un movimiento real. Es un registro tuyo: no mueve dinero del banco.");

  const grupoTipos = document.createElement("div");
  grupoTipos.className = "pill-grid-2";
  grupoTipos.setAttribute("role", "group");
  const botonesTipo = new Map();
  tipos.forEach((x) => {
    const b = crearBoton(t(x.etiqueta), "pill-item", () => elegirTipo(x));
    botonesTipo.set(x.id, b);
    grupoTipos.appendChild(b);
  });

  const selectSemestre = crearSelect([["", t("Sin semestre")], ...semestres.map((s) => [s.id, t(s.nombre)])], semestres[0] ? semestres[0].id : "");
  const campoSemestre = crearCampo("Semestre", selectSemestre);
  const nombre = crearEntrada("text", { valor: actual.nombreBase });
  nombre.maxLength = 60;

  const grupoModo = document.createElement("div");
  grupoModo.className = "pill-grid-2";
  const botonesModo = new Map();
  [["total", "Total a dividir"], ["por_pago", "Monto por pago"]].forEach(([id, texto]) => {
    const b = crearBoton(t(texto), "pill-item", () => { modo = id; marcarModo(); vista(); });
    botonesModo.set(id, b);
    grupoModo.appendChild(b);
  });

  const monto = crearEntrada("number", { placeholder: "0", etiquetaAria: t("Monto") });
  monto.min = "0";
  const cantidad = crearEntrada("number", { valor: "1" });
  cantidad.min = "1"; cantidad.max = String(MAX_CUOTAS); cantidad.step = "1"; cantidad.inputMode = "numeric";
  const primera = crearEntrada("date", { valor: "" });
  const selectFrecuencia = crearSelect([["mensual", t("Cada mes")], ["quincenal", t("Cada 15 días")], ["semanal", t("Cada semana")]], "mensual");
  const campoFrecuencia = crearCampo("¿Cada cuánto?", selectFrecuencia);
  const interruptor = crearInterruptor(t("Afecta mi saldo"), textoAyudaSaldo(), false);

  const previa = document.createElement("p");
  previa.className = "muted";
  previa.style.margin = "0";
  previa.setAttribute("aria-live", "polite");
  const error = crearLineaError();

  const parametros = () => ({
    tipo: actual.tipo, subtipo: actual.subtipo, semestreId: selectSemestre.value || null, nombreBase: nombre.value, modo,
    monto: monto.value, cantidad: Number(cantidad.value), fechaPrimera: primera.value, frecuencia: selectFrecuencia.value,
    afectaSaldo: actual.tipo === "matricula" ? interruptor.check.checked : false,
  });

  function vista() {
    error.classList.add("oculto");
    campoFrecuencia.classList.toggle("oculto", !(Number(cantidad.value) > 1));
    const r = construirCuotas(estado.datos, parametros());
    if (!r.ok) { previa.textContent = ""; return; }
    const lista = r.compromisos;
    const suma = lista.reduce((a, c) => a + c.monto, 0);
    const fechas = lista.map((c) => c.fecha_prevista).filter(Boolean);
    const cuando = !fechas.length ? t("sin fecha") : lista.length === 1 ? formatearFechaLarga(fechas[0]) : `${formatearFechaLarga(fechas[0])} → ${formatearFechaLarga(fechas[fechas.length - 1])}`;
    previa.textContent = lista.length === 1
      ? t("Se creará 1 pago de {monto} ({cuando}).").replace("{monto}", formatearMonto(lista[0].monto)).replace("{cuando}", cuando)
      : t("Se crearán {n} pagos, total {total} ({cuando}).").replace("{n}", String(lista.length)).replace("{total}", formatearMonto(suma)).replace("{cuando}", cuando);
  }

  function marcarModo() {
    botonesModo.forEach((b, id) => { b.classList.toggle("active", id === modo); b.setAttribute("aria-pressed", id === modo ? "true" : "false"); });
  }

  function elegirTipo(x) {
    actual = x;
    modo = x.modoInicial;
    nombre.value = x.nombreBase;
    botonesTipo.forEach((b, id) => { b.classList.toggle("active", id === x.id); b.setAttribute("aria-pressed", id === x.id ? "true" : "false"); });
    // Ayuda familiar y trabajo pueden ir sin semestre; matrícula y beca lo necesitan.
    const sinSemestreOk = x.tipo === "ingreso_esperado" && x.subtipo !== "beca";
    if (!sinSemestreOk && !selectSemestre.value && semestres[0]) selectSemestre.value = semestres[0].id;
    selectSemestre.querySelector("option[value='']").hidden = !sinSemestreOk;
    interruptor.caja.classList.toggle("oculto", x.tipo !== "matricula");
    marcarModo();
    vista();
  }

  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    const r = generarCuotas(estado.datos, parametros());
    if (!r.ok) {
      mostrarError(error, r.motivo === "semestre" && !semestres.length ? t("Primero registra un semestre en Semestres.") : textoError(r.motivo));
      return;
    }
    marcarCambioPendiente();
    cerrar();
    mostrarToast(r.compromisos.length === 1 ? t("Pago planificado") : t("{n} pagos planificados").replace("{n}", String(r.compromisos.length)));
    (alGuardar || (() => {}))();
  });

  [monto, cantidad, primera, nombre, selectSemestre, selectFrecuencia, interruptor.check].forEach((el) => el.addEventListener("input", vista));
  selectSemestre.addEventListener("change", vista);
  selectFrecuencia.addEventListener("change", vista);
  interruptor.check.addEventListener("change", vista);
  monto.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });

  caja.append(
    explica, crearCampo("¿Qué quieres planificar?", grupoTipos), campoSemestre, crearCampo("Nombre", nombre), grupoModo,
    crearCampo("Monto", monto), crearCampo("Número de pagos", cantidad), crearCampo("Fecha del primer pago (opcional)", primera),
    campoFrecuencia, interruptor.caja, previa, error,
    filaBotones(crearBoton(t("Cancelar"), "btn btn-secondary", cerrar), crearBoton(t("Planificar"), "btn btn-primary", guardar)),
  );
  elegirTipo(actual);
  setTimeout(() => monto.focus(), 0);
}

/* ===================== Confirmar con otro monto o fecha ===================== */

/** Confirma un compromiso mostrando el aviso Deshacer (que también lo devuelve a pendiente). */
function confirmarYAvisar(c, opciones, alGuardar) {
  const r = confirmarCompromiso(estado.datos, c.id, opciones);
  if (!r.ok) { mostrarToast(textoError(r.motivo)); return r; }
  marcarCambioPendiente();
  (alGuardar || (() => {}))();
  if (r.creado) {
    const signo = r.movimiento.tipo === "gasto" ? "−" : "+";
    mostrarBarraDeshacer(r.movimiento, `${t("Confirmado")}: ${c.nombre} ${signo}${formatearMonto(r.movimiento.monto)}`, () => deshacerConfirmacion(estado.datos, c.id));
  }
  return r;
}

function abrirConfirmarConDatos(c, { alGuardar } = {}) {
  const { caja, cerrar } = abrirCapa(c.tipo === "matricula" ? "Confirmar pago" : "Confirmar ingreso");
  const resumen = document.createElement("p");
  resumen.className = "muted";
  resumen.style.margin = "0";
  resumen.textContent = `${c.nombre} · ${t("planeado")}: ${formatearMonto(c.monto)}`;
  const monto = crearEntrada("number", { valor: String(c.monto), etiquetaAria: t("Monto") });
  monto.classList.add("rr-monto");
  monto.min = "0";
  const fecha = crearEntrada("date", { valor: hoyIso() });
  const error = crearLineaError();
  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    if (!(parsearMonto(monto.value) > 0)) { mostrarError(error, textoError("monto")); monto.focus(); return; }
    const r = confirmarYAvisar(c, { monto: monto.value, fecha: fecha.value || hoyIso() }, alGuardar);
    if (r.ok) cerrar();
    else mostrarError(error, textoError(r.motivo));
  });
  monto.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });
  caja.append(resumen, crearCampo("¿Cuánto fue de verdad?", monto), crearCampo("Fecha", fecha), error,
    filaBotones(crearBoton(t("Cancelar"), "btn btn-secondary", cerrar), crearBoton(t("Confirmar"), "btn btn-primary", guardar)));
  setTimeout(() => { monto.focus(); monto.select(); }, 0);
}

/* ===================== Reajustar una serie ===================== */

function abrirReajuste(c, { alGuardar } = {}) {
  const { caja, cerrar } = abrirCapa("Reajustar los siguientes pagos");
  const explica = document.createElement("p");
  explica.className = "muted";
  explica.style.margin = "0";
  explica.textContent = c.fecha_prevista
    ? t("Cambia el monto de los pagos pendientes de esta serie desde el {fecha} en adelante. Los ya confirmados no se tocan.").replace("{fecha}", formatearFechaLarga(c.fecha_prevista))
    : t("Cambia el monto de todos los pagos pendientes de esta serie. Los ya confirmados no se tocan.");
  const monto = crearEntrada("number", { valor: String(c.monto), etiquetaAria: t("Monto nuevo") });
  monto.classList.add("rr-monto");
  monto.min = "0";
  const error = crearLineaError();
  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    if (!(parsearMonto(monto.value) > 0)) { mostrarError(error, textoError("monto")); monto.focus(); return; }
    const n = reajustarSerie(estado.datos, c.serie_id, monto.value, c.fecha_prevista || null);
    cerrar();
    if (n) { marcarCambioPendiente(); (alGuardar || (() => {}))(); }
    mostrarToast(n ? t("{n} pagos actualizados").replace("{n}", String(n)) : t("No había nada que cambiar."));
  });
  monto.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });
  caja.append(explica, crearCampo("Monto nuevo por pago", monto), error,
    filaBotones(crearBoton(t("Cancelar"), "btn btn-secondary", cerrar), crearBoton(t("Reajustar"), "btn btn-primary", guardar)));
  setTimeout(() => { monto.focus(); monto.select(); }, 0);
}

/* ===================== Eliminar del plan ===================== */

/** Pide confirmación y quita el compromiso del plan (el movimiento real, si lo hay, se queda). */
function pedirEliminarCompromiso(c, refrescar) {
  abrirConfirmacion({
    titulo: t("¿Eliminar este pago planificado?"),
    mensaje: t("Solo se quita del plan. Si ya lo habías confirmado, el movimiento real se queda en Movimientos."),
    textoConfirmar: t("Eliminar"),
    claseConfirmar: "btn-danger",
    onConfirmar: () => {
      if (eliminarCompromiso(estado.datos, c.id)) marcarCambioPendiente();
      mostrarToast(t("Pago eliminado del plan"));
      (refrescar || (() => {}))();
    },
  });
}

/* ===================== Editor de un compromiso ===================== */

function abrirEditorCompromiso(c, { alGuardar } = {}) {
  const refrescar = alGuardar || (() => {});
  const { caja, cerrar } = abrirCapa("Editar pago planificado");
  const nombre = crearEntrada("text", { valor: c.nombre });
  nombre.maxLength = 60;
  const monto = crearEntrada("number", { valor: String(c.monto), etiquetaAria: t("Monto") });
  monto.min = "0";
  const fecha = crearEntrada("date", { valor: c.fecha_prevista || "" });
  const interruptor = crearInterruptor(t("Afecta mi saldo"), textoAyudaSaldo(), c.afecta_saldo);
  const error = crearLineaError();

  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    const r = editarCompromiso(estado.datos, c.id, {
      nombre: nombre.value, monto: monto.value, fechaPrevista: fecha.value || null,
      afectaSaldo: c.tipo === "matricula" ? interruptor.check.checked : undefined,
    });
    if (!r.ok) { mostrarError(error, textoError(r.motivo)); return; }
    marcarCambioPendiente();
    cerrar();
    refrescar();
  });

  // Acciones secundarias (cada una cierra el editor).
  const acciones = document.createElement("div");
  acciones.className = "stack";
  acciones.style.gap = "6px";
  const accion = (texto, clase, onClick) => acciones.appendChild(crearBoton(texto, clase, () => { cerrar(); onClick(); }));
  if (c.estado === "pendiente") {
    accion(t("Confirmar con otro monto o fecha…"), "btn btn-secondary", () => abrirConfirmarConDatos(c, { alGuardar: refrescar }));
    accion(t("Omitir este pago"), "btn btn-secondary", () => {
      if (omitirCompromiso(estado.datos, c.id)) { marcarCambioPendiente(); refrescar(); mostrarToast(t("Pago omitido")); }
    });
    if (c.serie_id) accion(t("Reajustar los siguientes pagos…"), "btn btn-secondary", () => abrirReajuste(c, { alGuardar: refrescar }));
  }
  accion(t("Eliminar este pago planificado"), "btn btn-danger", () => pedirEliminarCompromiso(c, refrescar));

  caja.append(crearCampo("Nombre", nombre), crearCampo("Monto planeado", monto), crearCampo("Fecha prevista (opcional)", fecha));
  if (c.tipo === "matricula") caja.appendChild(interruptor.caja);
  caja.append(error, filaBotones(crearBoton(t("Cancelar"), "btn btn-secondary", cerrar), crearBoton(t("Guardar"), "btn btn-primary", guardar)), acciones);
  setTimeout(() => monto.focus(), 0);
}

export { TIPOS_PLAN, abrirConfirmarConDatos, abrirEditorCompromiso, abrirGeneradorCuotas, abrirReajuste, confirmarYAvisar, pedirEliminarCompromiso };
