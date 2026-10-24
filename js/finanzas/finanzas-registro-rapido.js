/* =========================================================================
   FINANZAS 2.0 — Registro rápido, Ajustar saldo y Deshacer (sesión 1, F3)
   Registrar un gasto común toma 2 toques: monto + Guardar (o monto + una
   plantilla). Lo demás (fecha, nota, semestre, fuente del ahorro) queda
   plegado en "Más opciones"; recurrencia, pagar con una meta y separar para
   ahorro siguen en el formulario completo. Toda la lógica vive en
   core/finanzas-registro.js; aquí solo hay pantalla. Sin innerHTML.
   ========================================================================= */

import { hoyIso } from "../core/finanzas-modelo.js";
import { calcularTotalesMovimientos } from "../core/finanzas-derivados.js";
import {
  ajustarSaldo, calcularDiferenciaSaldo, crearGuardReentrada, parsearMonto, plantillasRecientes,
  puedeAjustarSaldo, quitarMovimiento, registrarMovimientoRapido, tiposDisponiblesRegistroRapido, ultimoTipoUsado,
} from "../core/finanzas-registro.js";
import { asignarCategoria, listarCategorias, sugerirCategoria } from "../core/finanzas-categorias.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { traducirTextoInterfaz as t } from "../core/i18n.js";
import { mostrarToast } from "../ui/componentes.js";
import { formatearMonto, renderizarFinanzas } from "./finanzas.js";
import { obtenerTodosLosSemestres } from "./finanzas-gastos.js";
import { construirSelectorCategoria } from "./finanzas-categorias-ui.js";

const ID_OVERLAY = "registro-rapido-overlay";
const ID_BARRA_DESHACER = "registro-rapido-deshacer";
const MS_DESHACER = 6000;
const ETIQUETA_TIPO = { gasto: "Gasto", ingreso: "Ingreso", ahorro: "Ahorro" };

/* ===================== Piezas pequeñas ===================== */

function crearCampo(etiqueta, control, ayuda) {
  const caja = document.createElement("label");
  caja.className = "stack";
  caja.style.gap = "4px";
  const span = document.createElement("span");
  span.className = "form-label";
  span.textContent = t(etiqueta);
  caja.append(span, control);
  if (ayuda) {
    const p = document.createElement("span");
    p.className = "muted";
    p.style.fontSize = "0.78rem";
    p.textContent = t(ayuda);
    caja.appendChild(p);
  }
  return caja;
}

function crearEntrada(tipo, { valor = "", placeholder = "", etiquetaAria = "" } = {}) {
  const input = document.createElement("input");
  input.type = tipo;
  input.className = "form-input";
  input.value = valor;
  if (placeholder) input.placeholder = placeholder;
  if (etiquetaAria) input.setAttribute("aria-label", etiquetaAria);
  if (tipo === "number") { input.step = "any"; input.inputMode = "decimal"; }
  return input;
}

function crearBoton(texto, clase, onClick) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = clase;
  b.textContent = texto;
  b.addEventListener("click", onClick);
  return b;
}

function crearLineaError() {
  const p = document.createElement("p");
  p.className = "muted oculto";
  p.setAttribute("role", "alert");
  p.style.cssText = "margin:0; color:var(--color-danger, #ef4444);";
  return p;
}

function mostrarError(linea, texto) {
  linea.textContent = texto;
  linea.classList.remove("oculto");
}

/** Capa modal con foco inicial, Escape y clic fuera para cerrar. Devuelve { overlay, caja, cerrar }. */
function abrirCapa(tituloTexto) {
  const previa = document.getElementById(ID_OVERLAY);
  if (previa) previa.remove();

  const overlay = document.createElement("div");
  overlay.id = ID_OVERLAY;
  overlay.className = "modal-overlay";
  overlay.style.cssText = "position:fixed; inset:0; z-index:300; display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:440px; width:100%; padding:18px; max-height:90vh; overflow-y:auto;";
  caja.setAttribute("role", "dialog");
  caja.setAttribute("aria-modal", "true");
  caja.addEventListener("click", (e) => e.stopPropagation());

  const h2 = document.createElement("h2");
  h2.style.margin = "0";
  h2.id = ID_OVERLAY + "-titulo";
  h2.textContent = t(tituloTexto);
  caja.setAttribute("aria-labelledby", h2.id);
  caja.appendChild(h2);

  const alTeclear = (e) => { if (e.key === "Escape") cerrar(); };
  const cerrar = () => {
    document.removeEventListener("keydown", alTeclear);
    overlay.remove();
  };
  document.addEventListener("keydown", alTeclear);
  overlay.addEventListener("click", cerrar);
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
  return { overlay, caja, cerrar };
}

/* ===================== Barra "Deshacer" ===================== */

/**
 * Aviso temporal con "Deshacer" tras guardar. Una sola a la vez (la nueva reemplaza a la anterior).
 * Deshacer quita el movimiento con tumba (nunca queda a medias) y repinta Finanzas. Con `accionDeshacer`
 * se hace otra cosa en su lugar (por ejemplo, deshacer la confirmación de un compromiso del Plan).
 */
function mostrarBarraDeshacer(movimiento, textoResumen, accionDeshacer) {
  const previa = document.getElementById(ID_BARRA_DESHACER);
  if (previa) previa._cancelar();

  const barra = document.createElement("div");
  barra.id = ID_BARRA_DESHACER;
  barra.setAttribute("role", "status");
  barra.setAttribute("aria-live", "polite");
  barra.className = "rr-deshacer";

  const texto = document.createElement("span");
  texto.className = "rr-deshacer-texto";
  texto.textContent = textoResumen;

  const guard = crearGuardReentrada(1000);
  let temporizador = null;
  const quitar = () => { clearTimeout(temporizador); barra.remove(); };
  barra._cancelar = quitar;

  const deshacer = crearBoton(t("Deshacer"), "btn btn-secondary rr-deshacer-boton", () => guard(() => {
    // `accionDeshacer` (opcional) reemplaza la acción por defecto; debe devolver true si deshizo algo.
    const hecho = accionDeshacer ? accionDeshacer() : quitarMovimiento(estado.datos, movimiento.id);
    if (hecho) {
      marcarCambioPendiente();
      renderizarFinanzas();
    }
    quitar();
    mostrarToast(t("Movimiento deshecho"));
  }));

  barra.append(texto, deshacer);
  document.body.appendChild(barra);
  temporizador = setTimeout(quitar, MS_DESHACER);
}

function resumenGuardado(movimiento) {
  const base = movimiento.tipo === "ajuste" ? t("Ajuste de saldo") : t(ETIQUETA_TIPO[movimiento.tipo] || "Movimiento");
  const signo = movimiento.tipo === "ajuste" ? (movimiento.sentido === "resta" ? "−" : "+") : "";
  return `${t("Guardado")}: ${base} ${signo}${formatearMonto(movimiento.monto)}`;
}

/* ===================== Registro rápido ===================== */

/**
 * Abre el registro rápido. `alGuardar` repinta la pantalla de quien lo abrió
 * (si falta, se repinta todo Finanzas). `abrirFormularioCompleto` es el enlace a
 * "Formulario completo" (el modal de siempre) y es opcional.
 */
function abrirRegistroRapido({ alGuardar, abrirFormularioCompleto } = {}) {
  const datos = estado.datos;
  const tipos = tiposDisponiblesRegistroRapido(datos);
  if (!tipos.length) {
    mostrarToast(t("Enciende Gastos e ingresos o Ahorros en Ajustes para registrar movimientos."));
    return;
  }

  const { caja, cerrar } = abrirCapa("Añadir movimiento");
  let tipoActual = tipos.includes(ultimoTipoUsado(datos)) ? ultimoTipoUsado(datos) : tipos[0];

  // ----- Tipo -----
  const grupoTipos = document.createElement("div");
  grupoTipos.className = "rr-tipos";
  grupoTipos.setAttribute("role", "group");
  grupoTipos.setAttribute("aria-label", t("Tipo de movimiento"));
  const botonesTipo = new Map();
  tipos.forEach((tipo) => {
    const b = crearBoton(t(ETIQUETA_TIPO[tipo]), "pill-item", () => elegirTipo(tipo));
    botonesTipo.set(tipo, b);
    grupoTipos.appendChild(b);
  });
  grupoTipos.style.gridTemplateColumns = `repeat(${tipos.length}, 1fr)`;

  // ----- Monto y nombre -----
  const monto = crearEntrada("number", { placeholder: "0", etiquetaAria: t("Monto") });
  monto.classList.add("rr-monto");
  monto.min = "0";
  const nombre = crearEntrada("text", { placeholder: t("Ej. Almuerzo, pasaje") });
  nombre.maxLength = 80;
  nombre.autocomplete = "off";

  // ----- Meta (solo ahorro) -----
  const metasActivas = (datos.metas || []).filter((m) => !m.archivada);
  const selectMeta = document.createElement("select");
  selectMeta.className = "form-input";
  metasActivas.forEach((m) => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.emoji || "🎯"} ${m.nombre || t("Meta sin nombre")}`;
    selectMeta.appendChild(o);
  });
  const campoMeta = crearCampo("¿A qué meta?", selectMeta);

  // ----- Plantillas -----
  const usaPlantillas = !datos.configuracion || datos.configuracion.plantillas_rapidas !== false;
  const metasValidas = new Set(metasActivas.map((m) => m.id));
  const plantillas = usaPlantillas
    ? plantillasRecientes(datos, 12).filter((p) => tipos.includes(p.tipo) && (p.tipo !== "ahorro" || metasValidas.has(p.metaId))).slice(0, 6)
    : [];
  const filaPlantillas = document.createElement("div");
  filaPlantillas.className = "rr-chips";
  filaPlantillas.setAttribute("role", "group");
  filaPlantillas.setAttribute("aria-label", t("Plantillas recientes"));
  plantillas.forEach((p) => {
    const chip = crearBoton(`${p.nombre}`, "rr-chip", () => usarPlantilla(p));
    chip.title = `${t(ETIQUETA_TIPO[p.tipo])} · ${formatearMonto(p.monto)}`;
    filaPlantillas.appendChild(chip);
  });

  // ----- Más opciones (plegado) -----
  const mas = document.createElement("details");
  mas.className = "rr-mas";
  const resumenMas = document.createElement("summary");
  resumenMas.className = "muted";
  resumenMas.textContent = t("Más opciones");
  const cuerpoMas = document.createElement("div");
  cuerpoMas.className = "stack";
  cuerpoMas.style.marginTop = "8px";

  const fecha = crearEntrada("date", { valor: hoyIso() });
  const nota = crearEntrada("text", { placeholder: t("Opcional") });
  nota.maxLength = 200;

  const selectSemestre = document.createElement("select");
  selectSemestre.className = "form-input";
  const sinSemestre = document.createElement("option");
  sinSemestre.value = "";
  sinSemestre.textContent = t("Sin semestre");
  selectSemestre.appendChild(sinSemestre);
  obtenerTodosLosSemestres().forEach((s) => {
    const o = document.createElement("option");
    o.value = s.id;
    o.textContent = t(s.nombre);
    selectSemestre.appendChild(o);
  });
  const campoSemestre = crearCampo("Semestre", selectSemestre);

  const selectFuente = document.createElement("select");
  selectFuente.className = "form-input";
  [["liquido", "De mi dinero"], ["nuevo", "Dinero nuevo"]].forEach(([valor, texto]) => {
    const o = document.createElement("option");
    o.value = valor;
    o.textContent = t(texto);
    selectFuente.appendChild(o);
  });
  const campoFuente = crearCampo("¿De dónde sale?", selectFuente);

  // Sesión 5: categoría opcional (gasto e ingreso). Si la persona no elige, y ya clasificó ese nombre antes con claridad,
  // se usa esa categoría. Nunca bloquea el guardado: sin categoría sigue siendo un movimiento válido.
  let selectCategoria = construirSelectorCategoria({ tipo: tipoActual === "ingreso" ? "ingreso" : "gasto" });
  const campoCategoria = crearCampo("Categoría", selectCategoria);
  const avisoSugerida = document.createElement("span");
  avisoSugerida.className = "muted";
  avisoSugerida.style.fontSize = "0.78rem";
  campoCategoria.appendChild(avisoSugerida);
  let categoriaTocada = false;
  const usaCategorias = () => listarCategorias(datos, { tipo: tipoActual === "ingreso" ? "ingreso" : "gasto" }).length > 0;
  function reconstruirSelectorCategoria() {
    const nuevo = construirSelectorCategoria({ tipo: tipoActual === "ingreso" ? "ingreso" : "gasto" });
    nuevo.addEventListener("change", () => { categoriaTocada = true; avisoSugerida.textContent = ""; });
    campoCategoria.replaceChild(nuevo, selectCategoria);
    selectCategoria = nuevo;
    categoriaTocada = false;
    avisoSugerida.textContent = "";
    sugerirPorNombre();
  }
  function sugerirPorNombre() {
    if (categoriaTocada || tipoActual === "ahorro") return;
    const s = sugerirCategoria(datos, nombre.value, tipoActual);
    selectCategoria.value = s ? s.categoriaId : "";
    avisoSugerida.textContent = s ? t("Sugerida por el nombre.") : "";
  }
  selectCategoria.addEventListener("change", () => { categoriaTocada = true; avisoSugerida.textContent = ""; });
  nombre.addEventListener("input", sugerirPorNombre);

  cuerpoMas.append(crearCampo("Fecha", fecha), crearCampo("Nota", nota), campoCategoria, campoSemestre, campoFuente);
  if (abrirFormularioCompleto) {
    cuerpoMas.appendChild(crearBoton(t("Formulario completo (recurrente, pagar con una meta…)"), "btn btn-secondary", () => {
      cerrar();
      abrirFormularioCompleto();
    }));
  }
  mas.append(resumenMas, cuerpoMas);

  const error = crearLineaError();

  // ----- Guardar -----
  const guard = crearGuardReentrada(700);
  const guardar = (plantilla) => guard(() => {
    const p = plantilla || null;
    const r = registrarMovimientoRapido(estado.datos, {
      tipo: p ? p.tipo : tipoActual,
      monto: monto.value,
      nombre: p ? p.nombre : nombre.value,
      fecha: fecha.value || hoyIso(),
      nota: nota.value,
      metaId: p ? p.metaId : selectMeta.value,
      fuente: p ? p.fuente : selectFuente.value,
      semestreId: selectSemestre.value || null,
    });
    if (!r.ok) {
      mostrarError(error, t(r.motivo === "meta" ? "Elige una meta para el ahorro." : "Escribe un monto mayor que cero."));
      (r.motivo === "meta" ? selectMeta : monto).focus();
      return;
    }
    // Sesión 5: categoría elegida, o la sugerida por el nombre (plantilla incluida). Falla en silencio: nunca impide guardar.
    const tipoGuardado = p ? p.tipo : tipoActual;
    if (tipoGuardado === "gasto" || tipoGuardado === "ingreso") {
      const sug = p ? sugerirCategoria(datos, p.nombre, tipoGuardado) : null;
      const categoriaId = p ? (sug ? sug.categoriaId : "") : selectCategoria.value;
      if (categoriaId) asignarCategoria(datos, r.movimiento.id, categoriaId);
    }
    marcarCambioPendiente();
    cerrar();
    (alGuardar || renderizarFinanzas)();
    mostrarBarraDeshacer(r.movimiento, resumenGuardado(r.movimiento));
  });

  function usarPlantilla(p) {
    // Con monto ya escrito, la plantilla guarda de una vez (2 toques). Sin monto, la rellena y deja editarlo.
    if (parsearMonto(monto.value) > 0) { guardar(p); return; }
    elegirTipo(p.tipo);
    nombre.value = p.nombre;
    if (p.tipo === "ahorro" && p.metaId) { selectMeta.value = p.metaId; selectFuente.value = p.fuente || "liquido"; }
    monto.value = p.monto > 0 ? String(p.monto) : "";
    monto.focus();
    monto.select();
  }

  function elegirTipo(tipo) {
    tipoActual = tipo;
    botonesTipo.forEach((b, k) => {
      b.classList.toggle("active", k === tipo);
      b.setAttribute("aria-pressed", k === tipo ? "true" : "false");
    });
    campoMeta.classList.toggle("oculto", tipo !== "ahorro");
    campoFuente.classList.toggle("oculto", tipo !== "ahorro");
    campoSemestre.classList.toggle("oculto", tipo === "ahorro");
    campoCategoria.classList.toggle("oculto", tipo === "ahorro" || !usaCategorias());
    if (tipo !== "ahorro") reconstruirSelectorCategoria();
    error.classList.add("oculto");
  }

  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  botones.append(
    crearBoton(t("Cancelar"), "btn btn-secondary", cerrar),
    crearBoton(t("Guardar"), "btn btn-primary", () => guardar(null)),
  );

  [monto, nombre].forEach((el) => el.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(null); } }));
  monto.addEventListener("input", () => error.classList.add("oculto"));

  caja.append(grupoTipos, crearCampo("Monto", monto), crearCampo("Nombre (opcional)", nombre), campoMeta);
  if (plantillas.length) caja.appendChild(filaPlantillas);
  caja.append(mas, error, botones);
  elegirTipo(tipoActual);
  setTimeout(() => monto.focus(), 0);
}

/* ===================== Ajustar saldo ===================== */

/** Texto de la diferencia: con signo y palabras, nunca solo color. */
function describirDiferencia(diferencia) {
  if (diferencia === 0) return t("Ya coincide con lo que calcula la app.");
  return diferencia > 0
    ? t("Faltaba {monto} en la app. Se suma a Mi dinero.").replace("{monto}", formatearMonto(diferencia))
    : t("Sobraba {monto} en la app. Se resta de Mi dinero.").replace("{monto}", formatearMonto(Math.abs(diferencia)));
}

/** Modal "Ajustar saldo": deja Mi dinero igual a lo que la persona tiene de verdad, con un ajuste aparte. */
function abrirAjustarSaldo({ alGuardar } = {}) {
  if (!puedeAjustarSaldo(estado.datos)) {
    mostrarToast(t("Enciende Gastos e ingresos, Matrícula o Beca en Ajustes para ajustar tu saldo."));
    return;
  }
  const { caja, cerrar } = abrirCapa("Ajustar saldo");
  const actual = calcularTotalesMovimientos(estado.datos).saldoLiquido;

  const explica = document.createElement("p");
  explica.className = "muted";
  explica.style.margin = "0";
  explica.textContent = t("Si olvidaste anotar algo, aquí corriges Mi dinero. Queda como un ajuste aparte: no cuenta como gasto ni como ingreso.");

  const filaActual = document.createElement("div");
  filaActual.className = "row-between";
  const etiquetaActual = document.createElement("span");
  etiquetaActual.textContent = t("Mi dinero según la app");
  const cifraActual = document.createElement("strong");
  cifraActual.style.fontVariantNumeric = "tabular-nums";
  cifraActual.textContent = formatearMonto(actual);
  filaActual.append(etiquetaActual, cifraActual);

  const real = crearEntrada("number", { placeholder: String(actual), etiquetaAria: t("Lo que tienes de verdad") });
  real.classList.add("rr-monto");
  const vista = document.createElement("p");
  vista.className = "muted";
  vista.style.margin = "0";
  vista.setAttribute("aria-live", "polite");
  const error = crearLineaError();

  real.addEventListener("input", () => {
    error.classList.add("oculto");
    vista.textContent = real.value === "" ? "" : describirDiferencia(calcularDiferenciaSaldo(estado.datos, real.value));
  });

  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    if (real.value === "" || !Number.isFinite(Number(real.value))) {
      mostrarError(error, t("Escribe cuánto tienes de verdad."));
      real.focus();
      return;
    }
    const r = ajustarSaldo(estado.datos, { saldoReal: real.value });
    cerrar();
    if (!r.movimiento) { mostrarToast(t("Tu saldo ya coincide.")); return; }
    marcarCambioPendiente();
    (alGuardar || renderizarFinanzas)();
    mostrarBarraDeshacer(r.movimiento, resumenGuardado(r.movimiento));
  });
  real.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });

  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  botones.append(crearBoton(t("Cancelar"), "btn btn-secondary", cerrar), crearBoton(t("Ajustar"), "btn btn-primary", guardar));

  caja.append(explica, filaActual, crearCampo("¿Cuánto tienes de verdad?", real), vista, error, botones);
  setTimeout(() => real.focus(), 0);
}

/* ===================== Saldo inicial (onboarding) ===================== */

/**
 * Paso del onboarding, después de elegir perfil: "¿Cuánto dinero tienes hoy?".
 * `alTerminar` se llama al guardar o al omitir. Guardar 0 o dejarlo vacío equivale a omitir.
 */
function construirPasoSaldoInicial(alTerminar) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  const h = document.createElement("h2");
  h.className = "texto-encabezado-seccion";
  h.style.margin = "0";
  h.textContent = t("¿Cuánto dinero tienes hoy?");
  const p = document.createElement("p");
  p.className = "muted";
  p.style.margin = "0";
  p.textContent = t("Es tu punto de partida: sin él, lo que ves como Mi dinero puede quedar corto. Lo puedes cambiar después con Ajustar saldo.");

  const monto = crearEntrada("number", { placeholder: "0", etiquetaAria: t("Dinero que tienes hoy") });
  monto.classList.add("rr-monto");
  const error = crearLineaError();

  const guard = crearGuardReentrada(700);
  const guardar = () => guard(() => {
    if (monto.value !== "" && !Number.isFinite(Number(monto.value))) {
      mostrarError(error, t("Escribe un monto válido."));
      monto.focus();
      return;
    }
    if (monto.value !== "") {
      const r = ajustarSaldo(estado.datos, { saldoReal: monto.value, saldoInicial: true });
      if (r.movimiento) marcarCambioPendiente();
    }
    alTerminar();
  });
  monto.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); guardar(); } });

  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.cssText = "display:grid; grid-template-columns:1fr 1fr; gap:8px;";
  botones.append(crearBoton(t("Omitir por ahora"), "btn btn-secondary", () => alTerminar()), crearBoton(t("Guardar"), "btn btn-primary", guardar));

  sec.append(h, p, crearCampo("Saldo inicial", monto), error, botones);
  setTimeout(() => monto.focus(), 0);
  return sec;
}

export {
  abrirAjustarSaldo, abrirCapa, abrirRegistroRapido, construirPasoSaldoInicial, crearBoton, crearCampo, crearEntrada,
  crearLineaError, mostrarBarraDeshacer, mostrarError,
};
