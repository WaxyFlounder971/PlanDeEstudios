/* =========================================================================
   FINANZAS — Pestañas Gastos generales U y Beneficios (2026-08-10,
   renombrada de "Gastos estudiantiles" a "Beneficios" + pagos recurrentes
   y vínculo opcional a semestre en v2.8.8)
   La primera es un CRUD de gastos sueltos no vinculados a un semestre —
   simples (monto único) o recurrentes (se repiten en el tiempo), con
   vínculo opcional a un semestre puntual. La segunda vive el generador
   del prompt de descuentos estudiantiles: arma el texto, lo copia al
   portapapeles (blindado) y abre claude.ai en pestaña nueva.
   ========================================================================= */

import { calcularPagosRecurrentesTranscurridos, crearGastoU, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { copiarPromptConAviso } from "../core/clipboard.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { obtenerPlanActivo } from "../plan/plan-esquema.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";
import { formatearMonto } from "./finanzas.js";

const FRECUENCIAS_GASTO_RECURRENTE = [
  { id: "semanal", etiqueta: "Semanal" },
  { id: "quincenal", etiqueta: "Quincenal" },
  { id: "mensual", etiqueta: "Mensual" },
  { id: "anual", etiqueta: "Anual" },
];

/** Todos los semestres del historial (actuales + pasados), mismo orden que la pestaña Semestres. */
function obtenerTodosLosSemestres() {
  return [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];
}

function obtenerNombreSemestre(semestreId) {
  if (!semestreId) return null;
  const semestre = obtenerTodosLosSemestres().find((s) => s.id === semestreId);
  return semestre ? semestre.nombre : "semestre eliminado";
}

/** "YYYY-MM-DD" -> "DD/MM/AAAA" para mostrar; si viene vacío/null devuelve "". */
function formatearFechaCorta(fechaIso) {
  if (!fechaIso) return "";
  const [anio, mes, dia] = fechaIso.split("-");
  return `${dia}/${mes}/${anio}`;
}

/* ===================== Gastos generales U ===================== */

function renderizarPestanaGastosU(contenedor) {
  const cabecera = document.createElement("div");
  cabecera.className = "row-between";
  cabecera.innerHTML = `<h3 style="margin:0;">Gastos generales U</h3>`;
  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary";
  btnAgregar.textContent = "+ Añadir gasto";
  btnAgregar.addEventListener("click", () => abrirModalGastoU(null, contenedor));
  cabecera.appendChild(btnAgregar);
  contenedor.appendChild(cabecera);

  const gastos = estado.datos.gastos_u || [];
  if (gastos.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Carné, seguro estudiantil, materiales, pagos recurrentes... cualquier gasto que no pertenezca a un semestre puntual.";
    contenedor.appendChild(vacio);
    return;
  }

  gastos.forEach((gasto) => {
    const fila = document.createElement("div");
    fila.className = "glass-card row-between";

    const nombreSemestre = obtenerNombreSemestre(gasto.semestre_id);
    let subtextos = "";
    if (gasto.nota) subtextos += `<p class="muted" style="margin:2px 0 0;">${gasto.nota}</p>`;
    if (gasto.recurrente) {
      const etiquetaFrecuencia =
        FRECUENCIAS_GASTO_RECURRENTE.find((f) => f.id === gasto.recurrente.frecuencia)?.etiqueta || "Mensual";
      subtextos += `<p class="muted" style="margin:2px 0 0;">🔁 ${etiquetaFrecuencia} · ${formatearMonto(gasto.recurrente.monto_por_pago)} c/u · desde ${formatearFechaCorta(gasto.recurrente.fecha_inicio)}${gasto.recurrente.fecha_fin ? ` hasta ${formatearFechaCorta(gasto.recurrente.fecha_fin)}` : ""}</p>`;
    }
    if (nombreSemestre) subtextos += `<p class="muted" style="margin:2px 0 0;">📎 Vinculado a ${nombreSemestre}</p>`;

    fila.innerHTML = `
      <div>
        <p style="margin:0; font-weight:600;">${gasto.nombre}</p>
        ${subtextos}
      </div>
    `;
    const derecha = document.createElement("div");
    derecha.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge badge-neutral";
    if (gasto.recurrente) {
      const { totalPagado } = calcularPagosRecurrentesTranscurridos(gasto.recurrente);
      badge.textContent = formatearMonto(totalPagado) + " a la fecha";
    } else {
      badge.textContent = formatearMonto(gasto.costo);
    }
    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "btn btn-secondary";
    btnEditar.textContent = "Editar";
    btnEditar.addEventListener("click", () => abrirModalGastoU(gasto, contenedor));
    derecha.appendChild(badge);
    derecha.appendChild(btnEditar);
    fila.appendChild(derecha);
    contenedor.appendChild(fila);
  });
}

function abrirModalGastoU(gastoExistente, contenedorLista) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " +
    "display:flex; align-items:center; justify-content:center; padding:16px;";
  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:460px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (e) => e.stopPropagation());
  const cerrar = () => overlay.remove();
  overlay.addEventListener("click", cerrar);

  caja.innerHTML = `<h2 style="margin:0;">${gastoExistente ? "Editar" : "Nuevo"} gasto</h2>`;

  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Ej. Carné, seguro estudiantil, pase de transporte...";
  inputNombre.value = gastoExistente ? gastoExistente.nombre : "";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  // ----- ¿Es un pago recurrente? (2026-08-11, v2.8.8) -----
  const filaRecurrente = document.createElement("div");
  filaRecurrente.className = "row-between";
  filaRecurrente.innerHTML = `
    <span>¿Es un pago recurrente?</span>
    <label class="switch switch-tema">
      <input type="checkbox" id="switch-gasto-recurrente">
      <span class="track"><span class="thumb"></span></span>
    </label>
  `;
  caja.appendChild(filaRecurrente);
  const switchRecurrente = filaRecurrente.querySelector("#switch-gasto-recurrente");
  switchRecurrente.checked = !!(gastoExistente && gastoExistente.recurrente);

  // ----- Costo simple (monto único, gasto NO recurrente) -----
  const bloqueCosto = document.createElement("div");
  bloqueCosto.innerHTML = `<span class="form-label">Costo</span>`;
  const inputCosto = document.createElement("input");
  inputCosto.type = "number";
  inputCosto.step = "0.01";
  inputCosto.className = "form-input";
  inputCosto.value = gastoExistente && !gastoExistente.recurrente ? gastoExistente.costo : "";
  bloqueCosto.appendChild(inputCosto);
  caja.appendChild(bloqueCosto);

  // ----- Bloque de recurrencia (frecuencia + monto por pago + fechas) -----
  const bloqueRecurrente = document.createElement("div");
  bloqueRecurrente.className = "stack";

  const pillFrecuencia = document.createElement("div");
  pillFrecuencia.innerHTML = `<span class="form-label">Frecuencia</span>`;
  const grupoFrecuencia = document.createElement("div");
  grupoFrecuencia.className = "pill-group";
  FRECUENCIAS_GASTO_RECURRENTE.forEach((f) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item";
    btn.dataset.valor = f.id;
    btn.textContent = f.etiqueta;
    grupoFrecuencia.appendChild(btn);
  });
  pillFrecuencia.appendChild(grupoFrecuencia);
  bloqueRecurrente.appendChild(pillFrecuencia);

  let frecuenciaElegida = (gastoExistente && gastoExistente.recurrente && gastoExistente.recurrente.frecuencia) || "mensual";
  function marcarFrecuenciaActiva() {
    grupoFrecuencia.querySelectorAll(".pill-item").forEach((p) => p.classList.toggle("active", p.dataset.valor === frecuenciaElegida));
  }
  marcarFrecuenciaActiva();
  grupoFrecuencia.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      frecuenciaElegida = btn.dataset.valor;
      marcarFrecuenciaActiva();
      actualizarVistaPreviaRecurrente();
    });
  });

  const bloqueMontoPago = document.createElement("div");
  bloqueMontoPago.innerHTML = `<span class="form-label">Monto por pago</span>`;
  const inputMontoPago = document.createElement("input");
  inputMontoPago.type = "number";
  inputMontoPago.step = "0.01";
  inputMontoPago.className = "form-input";
  inputMontoPago.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.monto_por_pago : "";
  inputMontoPago.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueMontoPago.appendChild(inputMontoPago);
  bloqueRecurrente.appendChild(bloqueMontoPago);

  const filaFechas = document.createElement("div");
  filaFechas.className = "row";

  const bloqueFechaInicio = document.createElement("div");
  bloqueFechaInicio.style.flex = "1";
  bloqueFechaInicio.innerHTML = `<span class="form-label">Fecha de inicio</span>`;
  const inputFechaInicio = document.createElement("input");
  inputFechaInicio.type = "date";
  inputFechaInicio.className = "form-input";
  inputFechaInicio.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.fecha_inicio || "" : "";
  inputFechaInicio.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueFechaInicio.appendChild(inputFechaInicio);
  filaFechas.appendChild(bloqueFechaInicio);

  const bloqueFechaFin = document.createElement("div");
  bloqueFechaFin.style.flex = "1";
  bloqueFechaFin.innerHTML = `<span class="form-label">Fecha de fin (opcional)</span>`;
  const inputFechaFin = document.createElement("input");
  inputFechaFin.type = "date";
  inputFechaFin.className = "form-input";
  inputFechaFin.value = gastoExistente && gastoExistente.recurrente ? gastoExistente.recurrente.fecha_fin || "" : "";
  inputFechaFin.addEventListener("input", actualizarVistaPreviaRecurrente);
  bloqueFechaFin.appendChild(inputFechaFin);
  filaFechas.appendChild(bloqueFechaFin);

  bloqueRecurrente.appendChild(filaFechas);

  const vistaPrevia = document.createElement("p");
  vistaPrevia.className = "muted";
  vistaPrevia.style.margin = "0";
  bloqueRecurrente.appendChild(vistaPrevia);

  function actualizarVistaPreviaRecurrente() {
    if (!inputFechaInicio.value) {
      vistaPrevia.textContent = "Indicá la fecha de inicio para ver cuánto llevás pagado hasta hoy.";
      return;
    }
    const { cantidadPagos, totalPagado } = calcularPagosRecurrentesTranscurridos({
      frecuencia: frecuenciaElegida,
      monto_por_pago: Number(inputMontoPago.value) || 0,
      fecha_inicio: inputFechaInicio.value,
      fecha_fin: inputFechaFin.value || null,
    });
    vistaPrevia.textContent = `Llevás ${cantidadPagos} pago${cantidadPagos === 1 ? "" : "s"} = ${formatearMonto(totalPagado)} hasta hoy.`;
  }

  caja.appendChild(bloqueRecurrente);

  function actualizarVisibilidadRecurrente() {
    bloqueCosto.classList.toggle("oculto", switchRecurrente.checked);
    bloqueRecurrente.classList.toggle("oculto", !switchRecurrente.checked);
    if (switchRecurrente.checked) actualizarVistaPreviaRecurrente();
  }
  actualizarVisibilidadRecurrente();
  switchRecurrente.addEventListener("change", actualizarVisibilidadRecurrente);

  // ----- Vincular a un semestre (opcional, 2026-08-11, v2.8.8) -----
  const bloqueSemestre = document.createElement("div");
  bloqueSemestre.innerHTML = `<span class="form-label">Vincular a un semestre (opcional)</span>`;
  const selectSemestre = document.createElement("select");
  selectSemestre.className = "form-select";
  const opcionSinVincular = document.createElement("option");
  opcionSinVincular.value = "";
  opcionSinVincular.textContent = "Sin vincular";
  selectSemestre.appendChild(opcionSinVincular);
  obtenerTodosLosSemestres().forEach((semestre) => {
    const opt = document.createElement("option");
    opt.value = semestre.id;
    opt.textContent = semestre.nombre;
    selectSemestre.appendChild(opt);
  });
  selectSemestre.value = (gastoExistente && gastoExistente.semestre_id) || "";
  bloqueSemestre.appendChild(selectSemestre);
  caja.appendChild(bloqueSemestre);

  const bloqueNota = document.createElement("div");
  bloqueNota.innerHTML = `<span class="form-label">Nota (opcional)</span>`;
  const inputNota = document.createElement("textarea");
  inputNota.className = "form-textarea";
  inputNota.rows = 3;
  inputNota.value = gastoExistente ? gastoExistente.nota || "" : "";
  bloqueNota.appendChild(inputNota);
  caja.appendChild(bloqueNota);

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

  if (gastoExistente) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger";
    btnEliminar.style.flex = "1";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar gasto",
        mensaje: `Se va a borrar "${gastoExistente.nombre}". Esta acción no se puede deshacer.`,
        textoConfirmar: "Eliminar gasto",
        onConfirmar: () => {
          estado.datos.gastos_u = (estado.datos.gastos_u || []).filter((g) => g.id !== gastoExistente.id);
          if (!Array.isArray(estado.datos._eliminados_gastos_u)) estado.datos._eliminados_gastos_u = [];
          estado.datos._eliminados_gastos_u.push({ id: gastoExistente.id, eliminadoEn: Date.now() });
          marcarCambioPendiente();
          cerrar();
          contenedorLista.innerHTML = "";
          renderizarPestanaGastosU(contenedorLista);
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
    const nombre = inputNombre.value.trim();
    if (!nombre) return;
    const nota = inputNota.value.trim();
    const semestreId = selectSemestre.value || null;

    const recurrente = switchRecurrente.checked
      ? {
          frecuencia: frecuenciaElegida,
          montoPorPago: Number(inputMontoPago.value) || 0,
          fechaInicio: inputFechaInicio.value || null,
          fechaFin: inputFechaFin.value || null,
        }
      : null;
    const costo = switchRecurrente.checked ? 0 : Number(inputCosto.value) || 0;

    if (gastoExistente) {
      gastoExistente.nombre = nombre;
      gastoExistente.costo = costo;
      gastoExistente.nota = nota || null;
      gastoExistente.semestre_id = semestreId;
      gastoExistente.recurrente = recurrente
        ? {
            frecuencia: recurrente.frecuencia,
            monto_por_pago: recurrente.montoPorPago,
            fecha_inicio: recurrente.fechaInicio,
            fecha_fin: recurrente.fechaFin,
          }
        : null;
      sellarTimestamp(gastoExistente);
    } else {
      const nuevo = crearGastoU({ nombre, costo, nota: nota || null, semestreId, recurrente });
      if (!Array.isArray(estado.datos.gastos_u)) estado.datos.gastos_u = [];
      estado.datos.gastos_u.push(nuevo);
    }
    marcarCambioPendiente();
    cerrar();
    contenedorLista.innerHTML = "";
    renderizarPestanaGastosU(contenedorLista);
  });
  filaBotones.appendChild(btnGuardar);

  caja.appendChild(filaBotones);
  overlay.appendChild(caja);
  document.body.appendChild(overlay);
}

/* ===================== Beneficios: generador de prompt de descuentos ===================== */

// Plantilla completa del prompt de descuentos — {UNIVERSIDAD} se interpola
// con el nombre real de la universidad del plan elegido antes de copiar.
const PLANTILLA_PROMPT_DESCUENTOS = `Necesito que uses tu herramienta de búsqueda web de forma activa para responder esto con información real y actual, no desde tu conocimiento general ni asumiendo que no podés buscar en internet, sí podés y necesito que lo hagas. No me respondas con advertencias tipo "no puedo verificar esto en tiempo real" ni te limites por precaución, buscá de verdad, confirmá lo que encuentres, y si algo no lo podés confirmar decímelo directamente sin rodeos ni disculpas innecesarias.

Tomate todo el tiempo y todas las búsquedas que necesites para hacer esto bien, no te apures ni te conformes con la primera página que encuentres. Al mismo tiempo, sé eficiente: no repitas la misma búsqueda con palabras casi idénticas, y no gastes búsquedas en cosas que ya confirmaste. Para cada categoría, buscá primero si existe una fuente oficial directa (por ejemplo, para IA: "GitHub Student Pack beneficios", luego "Claude descuento estudiantes", así uno por uno en vez de una búsqueda genérica que junte todo). Si una fuente oficial menciona un requisito (ej. correo institucional, carné vigente, verificación con SheerID u otro servicio), anotalo textualmente en tu respuesta, no lo resumas de forma vaga. Si encontrás una página de convenios o beneficios estudiantiles de {UNIVERSIDAD} en su sitio oficial, revisala completa, no te quedes solo con el resultado de búsqueda, entrá a la página real. Para cadenas o empresas costarricenses, verificá primero si tienen una página o publicación específica de "descuento estudiante" antes de asumir que no existe.

Necesito que investigues qué descuentos, beneficios o tarifas especiales existen actualmente para estudiantes activos de {UNIVERSIDAD}, en Costa Rica. Soy estudiante matriculado y busco esta información para aprovecharla activamente, no es una consulta teórica. Quiero una lista exhaustiva, no te dejes ninguna categoría a medias ni asumas que algo "no aplica" sin buscarlo primero.

Buscá información actual (no asumas que datos viejos siguen vigentes, verificá que sigan activos) organizada en las siguientes categorías. En cada categoría, los ejemplos que doy son solo punto de partida, buscá TODAS las opciones que encuentres, no te limites a los nombres que menciono.

INTELIGENCIA ARTIFICIAL (IMPORTANTE, no te saltes nada acá): planes pagos de IA con descuento o gratis para estudiantes (Claude, ChatGPT Plus, Gemini Advanced, Perplexity Pro, Copilot Pro, GitHub Copilot, Cursor, y cualquier otra), créditos gratuitos de API para estudiantes, convenios que {UNIVERSIDAD} tenga con empresas de IA, herramientas de IA para escritura/imágenes/transcripción/programación con tarifa estudiantil.
TECNOLOGÍA, SOFTWARE Y HERRAMIENTAS PROFESIONALES: licencias estudiantiles (Microsoft 365, Adobe, JetBrains, GitHub Student Pack, Autodesk, Figma, Notion, Canva), créditos de nube (AWS Educate, Google Cloud for Students, Azure for Students), software por carrera (CAD, MATLAB, SolidWorks), descuentos reales en compra de laptops y hardware (Apple, Lenovo, Dell, HP, ASUS, tiendas costarricenses), planes de datos/internet con tarifa estudiantil, seguro o reparación de celular.
TRANSPORTE (dentro de Costa Rica): buses, tren (INCOFER), apps de transporte, estacionamientos cerca de las sedes de {UNIVERSIDAD}, alquiler de vehículos y seguro vehicular con tarifa estudiantil.
ALIMENTACIÓN (a nivel nacional, no solo cerca de las sedes): sodas, restaurantes, cadenas de comida rápida, cafeterías o cualquier negocio de alimentación en Costa Rica con descuento por carné estudiantil, sin importar la provincia, esto debe cubrir todo el país. Cadenas con presencia nacional que tengan convenio recurrente. Delivery de comida con descuento estudiantil. Si encontrás algo específico de una zona, indicalo pero aclará que es local.
ENTRETENIMIENTO, CULTURA Y STREAMING: cines, TODOS los servicios de streaming de música/video/lectura/gaming con plan estudiantil en Costa Rica (no te limites a nombres específicos), museos, teatros, conciertos, festivales, eventos deportivos, boliche/arcades/escape rooms con tarifa estudiantil.
SALUD Y BIENESTAR: gimnasios, seguros médicos/dentales, farmacias, servicios de salud mental/psicología, ópticas, con descuento estudiantil.
BANCA Y FINANZAS: cuentas sin costo de mantenimiento, tarjetas estudiantiles, préstamos con tasa preferencial (BAC, BCR, BN, Scotiabank, Popular).
LIBRERÍAS, FOTOCOPIADO E IMPRESIÓN: librerías, fotocopiado, impresión 3D con tarifa estudiantil.
CERTIFICACIONES Y EXÁMENES PROFESIONALES: TOEFL, IELTS, certificaciones de AWS/Microsoft/Google, certificaciones contables/gestión de proyectos, cursos de idiomas con tarifa estudiantil.
VIAJES, TURISMO Y BENEFICIOS INTERNACIONALES (menor prioridad, pero igual buscala): carné internacional (ISIC), tarifas aéreas estudiantiles, hostales/alojamiento/seguros de viaje en el extranjero, programas de intercambio o convenios internacionales de {UNIVERSIDAD}, turismo de aventura y parques nacionales (SINAC), parques temáticos/acuáticos/zoológicos.
OTROS Y BENEFICIOS POCO OBVIOS (no dejes ninguno fuera): convenios institucionales de {UNIVERSIDAD} con comercios, tiendas de ropa/electrónica/peluquerías con carné universitario, cualquier otro beneficio que encuentres aunque sea pequeño o raro.

FORMATO DE RESPUESTA QUE NECESITO (esto es muy importante, seguilo al pie de la letra):

Mostrame SOLO los beneficios que SÍ encontraste y confirmaste. No escribas ninguna línea de "esto no existe" intercalada entre los resultados positivos. Organizá lo positivo por categoría, con títulos bien marcados. Para cada beneficio: qué es, qué descuento exacto da, qué se necesita para acceder (usualmente el carné vigente), y si es nacional, limitado a alguna sede, o internacional. Usá viñetas cortas, no párrafos densos. No omitas ningún beneficio real por considerarlo poco importante. Al final de TODO, un solo resumen corto (unas pocas líneas) de qué categorías no dieron resultado confiable y cuáles beneficios convendría confirmar directamente. Priorizá fuentes oficiales sobre foros.`;

function armarPromptDescuentos(universidad) {
  return PLANTILLA_PROMPT_DESCUENTOS.split("{UNIVERSIDAD}").join(universidad);
}

/** Universidades distintas entre los planes activos (Hardcore) o solo la del plan activo. */
function obtenerUniversidadesElegibles() {
  const cfg = estado.datos.configuracion;
  if (!cfg.modo_hardcore) {
    const activo = obtenerPlanActivo();
    return activo ? [activo.universidad] : [];
  }
  const idsActivos = [cfg.plan_activo_id, cfg.plan_activo_secundario_id, cfg.plan_activo_terciario_id].filter(Boolean);
  const universidades = (estado.datos.planes_estudio || [])
    .filter((p) => idsActivos.includes(p.id))
    .map((p) => p.universidad);
  return [...new Set(universidades)];
}

async function generarYCopiarPromptDescuentos(universidad) {
  const prompt = armarPromptDescuentos(universidad);
  await copiarPromptConAviso(prompt);
  window.open("https://claude.ai", "_blank");
}

function renderizarPestanaBeneficios(contenedor) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.innerHTML = `
    <h3 style="margin:0;">Buscar descuentos para estudiantes</h3>
    <p class="muted" style="margin:0;">
      Copia un prompt listo para pegar en una sesión nueva de Claude, que investiga
      descuentos, beneficios y tarifas estudiantiles reales para tu universidad.
    </p>
  `;

  const universidades = obtenerUniversidadesElegibles();

  if (universidades.length === 0) {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.textContent = "Necesitás tener un Plan de Estudios activo con universidad definida.";
    sec.appendChild(aviso);
  } else if (universidades.length === 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-primary btn-block";
    btn.textContent = `Buscar descuentos para estudiantes de ${universidades[0]}`;
    btn.addEventListener("click", () => generarYCopiarPromptDescuentos(universidades[0]));
    sec.appendChild(btn);
  } else {
    const aviso = document.createElement("p");
    aviso.className = "muted";
    aviso.style.margin = "0";
    aviso.textContent = "Modo Hardcore activo con más de una universidad — elegí de cuál generar el prompt:";
    sec.appendChild(aviso);
    universidades.forEach((uni) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-secondary btn-block";
      btn.textContent = `Buscar descuentos para estudiantes de ${uni}`;
      btn.addEventListener("click", () => generarYCopiarPromptDescuentos(uni));
      sec.appendChild(btn);
    });
  }

  contenedor.appendChild(sec);
}

export { renderizarPestanaBeneficios, renderizarPestanaGastosU };
