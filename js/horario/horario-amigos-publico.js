/* =========================================================================
   HORARIO ENTRE AMIGOS — Parte 2: vista pública (amigos.html)
   -------------------------------------------------------------------------
   A propósito NO importa nada de js/core ni js/horario del resto de la
   app: esta página la abre gente SIN sesión, así que no debe cargar el
   stack de auth/sync/schema. Todo lo que necesita (matemática del grid,
   días de la semana, resolución de clases efectivas por semana) está
   portado acá mismo, en versión de solo lectura.

   NO incluye todavía (prompt aparte): la escritura real de
   horario_amigos_vinculados — eso pasa en index.html/main.js después del
   redirect de "Asociar a mi cuenta" (ver el bloque al final de este
   archivo, y el localStorage que se deja para que lo recoja esa parte).
   ========================================================================= */

// Restringida por dominio a este mismo GitHub Pages y a Drive API
// únicamente (ver nota del prompt) — es seguro que viva en el cliente.
const API_KEY = "AIzaSyDfpExr25F972ur_fztdELmU6MCxJOVBmg";

// Mismo listado que DIAS_SEMANA_CONFIG en js/config/config-ajustes.js —
// duplicado a propósito (ver cabecera del archivo, esta página no importa
// nada del resto de la app). Si ese archivo cambia, replicar acá también.
const DIAS_SEMANA_CONFIG = [
  { id: "lunes", etiqueta: "Lunes", abrevDefault: "L" },
  { id: "martes", etiqueta: "Martes", abrevDefault: "K" },
  { id: "miercoles", etiqueta: "Miércoles", abrevDefault: "M" },
  { id: "jueves", etiqueta: "Jueves", abrevDefault: "J" },
  { id: "viernes", etiqueta: "Viernes", abrevDefault: "V" },
  { id: "sabado", etiqueta: "Sábado", abrevDefault: "S" },
  { id: "domingo", etiqueta: "Domingo", abrevDefault: "D" },
];

const PX_POR_MIN = 0.84; // mismo valor que PX_POR_MIN_EXPANDIDO en horario.js

const KEY_LOCALSTORAGE_PENDIENTE = "horario_amigo_pendiente";

/* ===================== Helpers portados de horario.js (solo lectura) ===================== */

function minutosDesdeHora(horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

function fechaLocalDesdeISO(str) {
  const soloFecha = String(str || "").slice(0, 10);
  const [y, m, d] = soloFecha.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function calcularNumeroSemanaSemestre(fechaInicio, duracionSemanas) {
  const inicio = new Date(fechaInicio);
  if (isNaN(inicio.getTime())) return 1;
  const semanasTranscurridas = Math.floor((Date.now() - inicio.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const total = Number(duracionSemanas) || 16;
  return Math.min(Math.max(semanasTranscurridas + 1, 1), total);
}

// Idéntico a calcularFechaDelDia en horario.js: ANCLADA al día de la
// semana REAL de fecha_inicio (vía Date.getDay()), no a la config de
// "inicio de semana" — si no, una fecha_inicio que no cae justo en el día
// configurado como inicio deja toda la fila de encabezados corrida.
function calcularFechaDelDia(fechaInicio, numeroSemana, diaCodigo) {
  const inicio = fechaLocalDesdeISO(fechaInicio);
  if (isNaN(inicio.getTime())) return null;
  const idxCanonico = DIAS_SEMANA_CONFIG.findIndex((d) => d.abrevDefault === diaCodigo);
  if (idxCanonico === -1) return null;
  // DIAS_SEMANA_CONFIG va lunes→domingo (índices 0-6); Date.getDay() usa
  // domingo=0..sábado=6 — de ahí el +1 % 7 para pasar de un sistema al otro.
  const pesoObjetivo = (idxCanonico + 1) % 7;
  const diffDentroDeSemana = (pesoObjetivo - inicio.getDay() + 7) % 7;
  const fecha = new Date(inicio);
  fecha.setDate(inicio.getDate() + (numeroSemana - 1) * 7 + diffDentroDeSemana);
  return fecha;
}

function esHoy(fecha) {
  if (!fecha) return false;
  const hoy = new Date();
  return fecha.getDate() === hoy.getDate() && fecha.getMonth() === hoy.getMonth() && fecha.getFullYear() === hoy.getFullYear();
}

function obtenerEmojiModalidad(modalidad) {
  if (modalidad === "sin_clase") return "✖️";
  const normalizado = String(modalidad || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalizado.startsWith("virtual")) return "💻";
  if (normalizado.startsWith("asincron")) return "📖";
  return "";
}

function obtenerDiasVisiblesOrdenados(configDias) {
  const visiblesIds = new Set(configDias.dias_visibles || DIAS_SEMANA_CONFIG.map((d) => d.id));
  const nombres = configDias.nombres_dias_personalizados || {};
  const inicioId = configDias.dia_inicio_semana || "lunes";
  const idxInicio = Math.max(0, DIAS_SEMANA_CONFIG.findIndex((d) => d.id === inicioId));
  const rotado = [...DIAS_SEMANA_CONFIG.slice(idxInicio), ...DIAS_SEMANA_CONFIG.slice(0, idxInicio)];
  return rotado.filter((d) => visiblesIds.has(d.id)).map((d) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault }));
}

/** Mismo criterio que obtenerClasesEfectivasSemana en schema.js, pero leyendo del snapshot ya resuelto (nombre/color planos, no materia_id). */
function construirClasesEfectivasSemana(bloques, numeroSemana) {
  const lista = [];
  (bloques || []).forEach((bloque) => {
    const overridesEstaSemana = (bloque.cronograma_dias || []).filter((cd) => cd.numero_semana === numeroSemana);
    (bloque.dias || []).forEach((diaBloque) => {
      const override = overridesEstaSemana.find((cd) => cd.dia === diaBloque.dia);
      const modalidad = override ? override.modalidad : diaBloque.modalidad || "presencial";
      lista.push({
        id: bloque.id,
        nombre: bloque.nombre,
        color: bloque.color,
        // Aula por día (2026-08-26, mismo cambio que schema.js): ya no es
        // fija por bloque, viene de diaBloque igual que modalidad.
        aula: diaBloque.aula || null,
        universidad: bloque.universidad || null,
        dia: diaBloque.dia,
        hora_inicio: diaBloque.hora_inicio,
        hora_fin: diaBloque.hora_fin,
        modalidad,
        tiene_ajuste_cronograma: !!override,
      });
    });
  });
  return lista;
}

function calcularLanesDia(bloquesDia) {
  const ordenados = [...bloquesDia].sort((a, b) => a.inicioMin - b.inicioMin);
  const finesLane = [];
  ordenados.forEach((b) => {
    let lane = finesLane.findIndex((fin) => fin <= b.inicioMin);
    if (lane === -1) {
      lane = finesLane.length;
      finesLane.push(b.finMin);
    } else {
      finesLane[lane] = b.finMin;
    }
    b.lane = lane;
  });
  return ordenados;
}

function construirColumnaHoras(pxPorMin, altoGrid, minInicioRango, minFinRango) {
  const col = document.createElement("div");
  col.className = "horario-col-horas";
  col.style.cssText = `position:relative; width:38px; flex-shrink:0; height:${altoGrid}px;`;
  const horaInicio = Math.ceil(minInicioRango / 60);
  const horaFin = Math.floor(minFinRango / 60);
  for (let h = horaInicio; h <= horaFin; h++) {
    const top = (h * 60 - minInicioRango) * pxPorMin;
    const horaMod = h % 24;
    const hora12 = horaMod % 12 === 0 ? 12 : horaMod % 12;
    const periodo = horaMod < 12 ? "am" : "pm";
    const etiqueta = document.createElement("div");
    etiqueta.className = "muted";
    etiqueta.style.cssText = `position:absolute; top:${top}px; right:6px; transform:translateY(-50%); text-align:center; line-height:1.1;`;
    etiqueta.innerHTML = `<div style="font-size:0.68rem; font-weight:600;">${hora12}</div><div style="font-size:0.56rem;">${periodo}</div>`;
    col.appendChild(etiqueta);
  }
  return col;
}

function construirLineasHorarias(pxPorMin, minInicioRango, minFinRango) {
  const stops = [];
  for (let min = minInicioRango; min <= minFinRango; min += 30) {
    const y = (min - minInicioRango) * pxPorMin;
    const opacidad = min % 60 === 0 ? 0.28 : 0.1;
    stops.push(`linear-gradient(rgba(150,150,170,${opacidad}), rgba(150,150,170,${opacidad})) 0 ${y}px / 100% 1px no-repeat`);
  }
  return stops.join(",\n");
}

/* Línea de "hora actual" — Núcleo, portada de horario.js. Mismo criterio:
   abarca TODO el ancho del grid de días (no solo el día de hoy), se
   posiciona relativa a filaGrid (padre real, ver position:relative que se
   le agrega en renderizarGridPublico), y usa la MISMA clase CSS
   (.horario-linea-hora-actual, definida en design-system.css, compartida
   con el horario propio) — así hereda el glow "brillante pero discreta"
   sin duplicar esos estilos acá.
   OJO: el left offset es 38px, NO 28px como en horario.js — esta página
   tiene su propia columna de horas con OTRO ancho (ver
   construirColumnaHoras más arriba: width:38px). Copiar el 28px de la app
   principal a ciegas volvería a meter la línea encima de los números de
   hora, mismo bug que se corrigió en horario.js. */
function construirLineaHoraActualGrid(pxPorMin, minInicioRango, minFinRango) {
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutosAhora < minInicioRango || minutosAhora > minFinRango) return null;
  const top = (minutosAhora - minInicioRango) * pxPorMin;
  const linea = document.createElement("div");
  linea.className = "horario-linea-hora-actual";
  linea.style.top = `${top}px`;
  linea.style.left = "38px";
  linea.innerHTML = `<span class="horario-linea-hora-actual-punto"></span>`;
  return linea;
}

/* Mueve la línea cada 60s sin re-renderizar todo el grid (mismo motivo que
   en horario.js: perdería la posición de scroll del usuario). Guarda el
   rango de horas en un closure porque acá no hay "estado" global — se
   arma una sola vez en iniciar() con el rango del snapshot ya cargado. */
function actualizarPosicionLineaHoraActualPublico(minInicioRango, minFinRango, pxPorMin) {
  const linea = document.querySelector(".horario-linea-hora-actual");
  if (!linea) return;
  const ahora = new Date();
  const minutosAhora = ahora.getHours() * 60 + ahora.getMinutes();
  if (minutosAhora < minInicioRango || minutosAhora > minFinRango) {
    linea.remove();
    return;
  }
  linea.style.top = `${(minutosAhora - minInicioRango) * pxPorMin}px`;
}

function construirColumnaDia(dia, bloquesDia, pxPorMin, altoGrid, minInicioRango, minFinRango) {
  const col = document.createElement("div");
  col.className = "horario-col-dia";
  col.style.cssText = `position:relative; flex:1; min-width:56px; height:${altoGrid}px; background:${construirLineasHorarias(pxPorMin, minInicioRango, minFinRango)}; border-left:1px solid rgba(150,150,170,0.15);`;

  const conLanes = calcularLanesDia(bloquesDia);
  // Antes, cuando 2+ clases se cruzaban en horario (lanes>0), cada una se
  // dibujaba con el MISMO ancho que la columna completa, solo corrida
  // offsetPx a la derecha (12px) y con más z-index — la de encima terminaba
  // tapando casi todo el nombre de la que quedaba debajo (se veía como si
  // el nombre se hubiera "cortado a la mitad"). Ahora se reparte el ancho
  // real de la columna entre TODAS las lanes que se usan ese día (mismo
  // criterio visual que Google Calendar: clases que se cruzan quedan una
  // al lado de la otra, no una tapando a la otra) — cada lane ve
  // completo su propio nombre, aunque la tarjeta quede más angosta.
  const totalLanes = conLanes.length > 0 ? Math.max(...conLanes.map((b) => b.lane)) + 1 : 1;
  conLanes.forEach((b) => {
    const inicioClamp = Math.max(b.inicioMin, minInicioRango);
    const finClamp = Math.min(b.finMin, minFinRango);
    if (finClamp <= inicioClamp) return;
    const top = Math.max(0, (inicioClamp - minInicioRango) * pxPorMin);
    const alto = Math.max(24, (finClamp - inicioClamp) * pxPorMin);
    const GAP_ENTRE_LANES = 2;
    const anchoLanePct = 100 / totalLanes;
    const leftPct = b.lane * anchoLanePct;
    const tarjeta = document.createElement("div");
    tarjeta.className = "horario-bloque-tarjeta";
    const esSinClase = b.modalidad === "sin_clase";
    tarjeta.style.cssText = `position:absolute; top:${top}px; left:calc(${leftPct}% + ${b.lane > 0 ? GAP_ENTRE_LANES : 0}px); width:calc(${anchoLanePct}% - ${GAP_ENTRE_LANES}px); height:${alto}px; z-index:${10 + b.lane};
      background:${b.color}; color:#fff; border-radius:8px; padding:3px 6px; overflow:hidden;
      box-shadow:0 2px 6px rgba(0,0,0,0.25); border:1px solid rgba(255,255,255,0.25);
      ${esSinClase ? "opacity:0.45;" : ""}`;
    const emojiModalidad = obtenerEmojiModalidad(b.modalidad);
    // Mismo criterio de espacio que en horario.js: título + una línea por
    // aula/universidad si existen, para no forzarlas si la tarjeta quedó
    // muy angosta/baja.
    const lineasTexto = 1 + (b.universidad ? 1 : 0) + (b.aula ? 1 : 0);
    const cabeExtra = alto >= lineasTexto * 15 + 6;
    tarjeta.innerHTML = `
      <div style="font-size:0.85rem; font-weight:600; line-height:1.15; display:flex; align-items:center; gap:4px; overflow-wrap:break-word; word-break:break-word;">
        <span>${b.nombreCorto}</span>
      </div>
      ${cabeExtra && b.universidad ? `<div style="font-size:0.72rem; opacity:0.9; overflow-wrap:break-word; word-break:break-word;">${b.universidad}</div>` : ""}
      ${cabeExtra && b.aula ? `<div style="font-size:0.72rem; opacity:0.85; overflow-wrap:break-word; word-break:break-word;">${b.aula}</div>` : ""}
      ${emojiModalidad ? `<span title="${b.modalidad}" style="position:absolute; right:5px; bottom:3px; font-size:1.17rem; line-height:1;">${emojiModalidad}</span>` : ""}
    `;
    col.appendChild(tarjeta);
  });

  return col;
}

/* ===================== Fetch del snapshot público ===================== */

function obtenerFileIdDesdeHash() {
  // Fragmento (#fileId=...), NUNCA query param — así nunca se envía a
  // ningún servidor ni queda indexable (ver nota de privacidad del prompt).
  const hash = window.location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash);
  return params.get("fileId");
}

async function obtenerSnapshotPublico(fileId) {
  const url = `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&key=${API_KEY}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/* ===================== Render principal ===================== */

function renderizarGridPublico(snapshot) {
  const cont = document.getElementById("amigos-grid");
  const numeroSemana = calcularNumeroSemanaSemestre(snapshot.fecha_inicio, snapshot.duracion_semanas);

  document.getElementById("amigos-titulo-semestre").textContent = snapshot.semestre_nombre || "Horario";
  document.getElementById("amigos-subtitulo-semana").textContent = `Semana ${numeroSemana}`;

  const dias = obtenerDiasVisiblesOrdenados(snapshot.config_dias || {});
  const clasesEfectivas = construirClasesEfectivasSemana(snapshot.bloques, numeroSemana);

  const horaInicio = snapshot.rango_horas?.horaInicio ?? 0;
  const horaFin = snapshot.rango_horas?.horaFin ?? 24;
  const minInicioRango = horaInicio * 60;
  const minFinRango = horaFin * 60;
  const altoGrid = (minFinRango - minInicioRango) * PX_POR_MIN;

  cont.innerHTML = "";
  const columnaAncha = document.createElement("div");
  columnaAncha.style.cssText = "display:flex; flex-direction:column; min-width:100%; width:max-content;";

  const headerFila = document.createElement("div");
  headerFila.style.cssText = "display:flex; position:sticky; top:0; z-index:50; background:var(--bg-header-solido); border-bottom:1px solid rgba(150,150,170,0.15);";
  const espaciador = document.createElement("div");
  espaciador.style.cssText = "width:38px; flex-shrink:0;";
  headerFila.appendChild(espaciador);
  dias.forEach((dia) => {
    const fecha = calcularFechaDelDia(snapshot.fecha_inicio, numeroSemana, dia.abrevDefault);
    const h = document.createElement("div");
    h.style.cssText = "flex:1; min-width:56px; text-align:center; padding:4px 0;";
    h.innerHTML = `
      <div class="${esHoy(fecha) ? "horario-dia-actual-glow" : ""}" style="font-size:0.72rem; font-weight:600;">${dia.etiquetaCorta}</div>
      <div class="muted" style="font-size:0.6rem;">${fecha ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : ""}</div>
    `;
    headerFila.appendChild(h);
  });

  const filaGrid = document.createElement("div");
  filaGrid.style.cssText = "display:flex; position:relative;";
  filaGrid.appendChild(construirColumnaHoras(PX_POR_MIN, altoGrid, minInicioRango, minFinRango));
  let semanaIncluyeHoy = false;
  dias.forEach((dia) => {
    const fecha = calcularFechaDelDia(snapshot.fecha_inicio, numeroSemana, dia.abrevDefault);
    if (esHoy(fecha)) semanaIncluyeHoy = true;
    const bloquesDia = clasesEfectivas
      .filter((c) => c.dia === dia.abrevDefault)
      .map((c) => ({
        inicioMin: minutosDesdeHora(c.hora_inicio),
        finMin: minutosDesdeHora(c.hora_fin),
        color: c.color || "#a78bfa",
        nombreCorto: c.nombre || "Materia",
        aula: c.aula,
        universidad: c.universidad,
        modalidad: c.modalidad,
      }));
    filaGrid.appendChild(construirColumnaDia(dia, bloquesDia, PX_POR_MIN, altoGrid, minInicioRango, minFinRango));
  });
  // Línea de hora actual: solo si "hoy" es uno de los días de ESTA semana
  // que se está mostrando (mismo criterio que horario.js) — se agrega
  // DESPUÉS de las columnas para que su z-index quede por encima en el
  // orden natural del DOM.
  if (semanaIncluyeHoy) {
    const linea = construirLineaHoraActualGrid(PX_POR_MIN, minInicioRango, minFinRango);
    if (linea) filaGrid.appendChild(linea);
  }

  columnaAncha.appendChild(headerFila);
  columnaAncha.appendChild(filaGrid);
  cont.appendChild(columnaAncha);

  // Se devuelve el rango de horas de ESTE snapshot para que iniciar() pueda
  // armar el intervalo de actualización de la línea (cada 60s) sin tener
  // que volver a leer snapshot.rango_horas ni recalcular nada.
  return { minInicioRango, minFinRango, semanaIncluyeHoy };
}

/* ===================== Flujo "Asociar a mi cuenta" ===================== */

function inicializarFlujoAsociar(fileId, snapshot) {
  const btnAbrir = document.getElementById("btn-asociar-amigo");
  const modal = document.getElementById("amigos-modal-asociar");
  const input = document.getElementById("amigos-input-apodo-asociar");
  const btnCancelar = document.getElementById("amigos-btn-cancelar-asociar");
  const btnConfirmar = document.getElementById("amigos-btn-confirmar-asociar");

  // Defensivo: además de la clase "oculto" (CSS), se fuerza el estado
  // oculto/no-interactivo por inline style. Este modal vive estático en el
  // HTML (no se appendea desde JS como los otros modales de la app), así
  // que si por lo que sea el CSS no lo tapa bien (caché vieja del deploy,
  // orden de reglas, etc.) igual queda garantizado que no bloquea/blurea
  // el horario al entrar — solo se vuelve visible/clickeable con el click
  // explícito en "+ Asociar a mi cuenta".
  function cerrarModalAsociar() {
    modal.classList.add("oculto");
    modal.style.display = "none";
    modal.style.pointerEvents = "none";
  }
  function abrirModalAsociar() {
    input.value = snapshot.apodo_propietario || "";
    modal.classList.remove("oculto");
    modal.style.display = "flex";
    modal.style.pointerEvents = "auto";
  }
  cerrarModalAsociar(); // estado inicial garantizado, no solo confiado al CSS

  btnAbrir.addEventListener("click", abrirModalAsociar);
  btnCancelar.onclick = cerrarModalAsociar;
  modal.onclick = (e) => { if (e.target === modal) cerrarModalAsociar(); };
  btnConfirmar.onclick = () => {
    const apodo = input.value.trim().slice(0, 30) || "Amigo";
    // Se deja el pendiente en localStorage (NUNCA en la URL) para que
    // main.js lo recoja apenas termine de cargar los datos del usuario
    // (con o sin sesión ya abierta) — ver Horario entre Amigos, Parte 3.
    // guardado_en sirve para que esa parte descarte el pendiente si pasó
    // demasiado tiempo desde que se generó (evita una asociación sorpresa
    // si la persona vuelve a abrir la app días después por otro motivo).
    localStorage.setItem(KEY_LOCALSTORAGE_PENDIENTE, JSON.stringify({
      fileId,
      apodo,
      guardado_en: Date.now(),
    }));
    window.location.href = "index.html";
  };
}

/* ===================== Pantalla completa ===================== */

/* Mismo patrón que btnPantallaCompleta en horario.js: toggle sobre el
   contenedor con scroll (acá #amigos-grid-contenedor, que en el HTML
   arranca con max-height:70vh fijo — inline, no en la clase CSS). En
   fullscreen se cambia a 100vh para aprovechar toda la pantalla real, y al
   salir se vuelve al 70vh original. No hace falta re-renderizar el grid
   (a diferencia del horario propio, acá el ancho de columna no depende del
   alto disponible — es de solo lectura, sin auto-scroll a "la clase más
   temprana").
*/
function inicializarPantallaCompletaPublico() {
  const btn = document.getElementById("btn-amigos-pantalla-completa");
  const contenedor = document.getElementById("amigos-grid-contenedor");
  if (!btn || !contenedor) return;
  btn.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else contenedor.requestFullscreen?.();
  });

  // FIX (mismo problema que horario.js): `btn` (el ⛶ de arriba, dentro de
  // la glass-card del encabezado) vive AFUERA de `contenedor` (ver
  // amigos.html) — al entrar a fullscreen sobre `contenedor`, ese botón
  // queda fuera del árbol de document.fullscreenElement y se vuelve
  // invisible/inaccesible, sin forma de salir salvo Esc. Se agrega un
  // botón aparte, chico y discreto, colgado directo de `contenedor` para
  // que sobreviva dentro del árbol de fullscreen.
  contenedor.style.position = "relative";
  const btnSalirFS = document.createElement("button");
  btnSalirFS.type = "button";
  btnSalirFS.id = "amigos-btn-salir-pantalla-completa";
  btnSalirFS.className = "btn-icono-fantasma oculto";
  btnSalirFS.title = "Salir de pantalla completa";
  btnSalirFS.setAttribute("aria-label", "Salir de pantalla completa");
  btnSalirFS.textContent = "✕";
  btnSalirFS.style.cssText =
    "position:absolute; top:8px; right:8px; z-index:60; font-size:1rem; width:30px; height:30px; " +
    "display:flex; align-items:center; justify-content:center; border-radius:50%; " +
    "background:var(--bg-header-solido); opacity:0.55; transition:opacity 0.15s;";
  btnSalirFS.addEventListener("mouseenter", () => { btnSalirFS.style.opacity = "1"; });
  btnSalirFS.addEventListener("mouseleave", () => { btnSalirFS.style.opacity = "0.55"; });
  btnSalirFS.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
  });
  contenedor.appendChild(btnSalirFS);

  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement === contenedor) {
      contenedor.style.maxHeight = "100vh";
    } else {
      contenedor.style.maxHeight = "70vh";
    }
    btnSalirFS.classList.toggle("oculto", document.fullscreenElement !== contenedor);
  });
}

/* ===================== Arranque ===================== */

async function iniciar() {
  const elCargando = document.getElementById("amigos-cargando");
  const elError = document.getElementById("amigos-error");
  const elContenido = document.getElementById("amigos-contenido");

  const fileId = obtenerFileIdDesdeHash();
  if (!fileId) {
    elCargando.classList.add("oculto");
    elError.classList.remove("oculto");
    return;
  }

  try {
    const snapshot = await obtenerSnapshotPublico(fileId);
    elCargando.classList.add("oculto");
    elContenido.classList.remove("oculto");
    const { minInicioRango, minFinRango } = renderizarGridPublico(snapshot);
    inicializarFlujoAsociar(fileId, snapshot);
    // Línea de hora actual: se mueve sola cada minuto, mismo patrón que
    // inicializarHorario() en horario.js (setInterval de 60s, sin
    // re-renderizar el grid — eso perdería la posición de scroll). Acá no
    // hay que chequear visibilidad de sección (esta página SOLO muestra
    // el horario, no hay otras pestañas de la app que tapen esto).
    setInterval(() => actualizarPosicionLineaHoraActualPublico(minInicioRango, minFinRango, PX_POR_MIN), 60000);
    inicializarPantallaCompletaPublico();
  } catch (e) {
    console.warn("No se pudo cargar el horario compartido:", e);
    elCargando.classList.add("oculto");
    elError.classList.remove("oculto");
  }
}

iniciar();
