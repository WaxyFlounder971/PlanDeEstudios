/* =========================================================================
   TIEMPO DE ESTUDIO — Registro manual de bloques pasados (Parte 3, punto 1)
   Modal para cargar a mano una sesión que ya pasó (no se hizo con el timer
   ni con Pomodoro). Cuenta EXACTAMENTE igual que una sesión en vivo para
   meta semanal y felicitación — mismo crearSesionEstudio, mismo origen que
   ya contemplaba el comentario de Parte 1 ("manual").

   Sin validación anti-trampa: se puede cargar cualquier fecha/hora, incluso
   futura o duplicada — pedido explícito de Wagner (uso entre amigos,
   confianza total). Lo único que se valida es que la duración sea > 0,
   para no crear sesiones de 0 minutos sin querer.
   ========================================================================= */

import { crearSesionEstudio, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { revisarFelicitacionMeta, notificarSesionesEstudioActualizadas } from "./tiempo-estudio-timer.js";
import { sincronizarHorasCompetencias } from "./tiempo-estudio-competencias.js";

/**
 * Abre el modal. `items` es el mismo arreglo que ya arma
 * obtenerMateriasParaTiempoEstudio() en tiempo-estudio.js (se recibe por
 * parámetro, no se recalcula acá, para no crear un import circular solo
 * por esto). `onGuardar` se llama sin argumentos después de guardar, para
 * que quien abrió el modal re-renderice.
 */
function abrirModalRegistroManual(items, onGuardar) {
  if (!items || items.length === 0) {
    mostrarToast("No tenés materias matriculadas en tus semestres actuales");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:420px; width:100%; max-height:85vh; overflow-y:auto; gap:14px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  const ahora = new Date();
  const fechaHoyStr = `${ahora.getFullYear()}-${String(ahora.getMonth() + 1).padStart(2, "0")}-${String(ahora.getDate()).padStart(2, "0")}`;
  const horaHoyStr = `${String(ahora.getHours()).padStart(2, "0")}:${String(ahora.getMinutes()).padStart(2, "0")}`;
  const finDefault = new Date(ahora.getTime() + 30 * 60000);
  const horaFinDefaultStr = `${String(finDefault.getHours()).padStart(2, "0")}:${String(finDefault.getMinutes()).padStart(2, "0")}`;

  // Rediseño 2026-09-22 (pedido explícito): reemplaza el <select> nativo
  // (se veía gris/roto sobre fondo oscuro) por tarjetas seleccionables —
  // mismo patrón visual que .agenda-semestre-tarjeta (design-system.css),
  // pero de selección ÚNICA: un solo click cambia cuál tarjeta queda
  // .active, nunca se acumulan varias marcadas.
  const tarjetasMateria = items
    .map(
      (item, i) => `
      <button type="button" class="agenda-semestre-tarjeta${i === 0 ? " active" : ""}" data-materia-id="${item.mm.id}">
        <span class="agenda-semestre-tarjeta-check">✓</span>
        <span>${item.nombreMateria}</span>
      </button>`
    )
    .join("");

  caja.innerHTML = `
    <h2 style="margin:0;">Registrar sesión pasada</h2>

    <div>
      <span class="form-label">Materia</span>
      <div class="stack" id="te-manual-materia-lista" style="gap:6px; max-height:200px; overflow-y:auto;">${tarjetasMateria}</div>
    </div>

    <div>
      <span class="form-label">Fecha</span>
      <input type="date" id="te-manual-fecha" class="form-input" value="${fechaHoyStr}" autocomplete="off">
    </div>

    <div class="fila-pill-switch">
      <span class="fila-pill-switch-titulo">¿Cómo lo cargás?</span>
      <div class="pill-group pill-switch-binario" id="te-manual-modo-switch">
        <div class="pill-switch-thumb" id="te-manual-modo-thumb"></div>
        <button type="button" class="pill-item active" data-modo="hora">Hora</button>
        <button type="button" class="pill-item" data-modo="tiempo">Tiempo</button>
      </div>
    </div>

    <div class="row-between" style="gap:10px;" id="te-manual-campos-hora">
      <div style="flex:1;">
        <span class="form-label">Hora inicio</span>
        <input type="time" id="te-manual-hora-inicio" class="form-input" value="${horaHoyStr}" autocomplete="off">
      </div>
      <div style="flex:1;">
        <span class="form-label">Hora fin</span>
        <input type="time" id="te-manual-hora-fin" class="form-input" value="${horaFinDefaultStr}" autocomplete="off">
      </div>
    </div>

    <div class="row-between oculto" style="gap:10px;" id="te-manual-campos-tiempo">
      <div style="flex:1;">
        <span class="form-label">Horas</span>
        <input type="number" id="te-manual-horas" class="form-input" min="0" value="0" autocomplete="off">
      </div>
      <div style="flex:1;">
        <span class="form-label">Minutos</span>
        <input type="number" id="te-manual-minutos" class="form-input" min="0" max="59" value="30" autocomplete="off">
      </div>
    </div>

    <div class="oculto" id="te-manual-toggle-hora-inicio-wrap">
      <label class="checkbox">
        <input type="checkbox" id="te-manual-toggle-hora-inicio">
        <span class="box"></span>
        <span>Agregar hora de inicio</span>
      </label>
    </div>

    <div class="oculto" id="te-manual-campo-hora-inicio-opcional">
      <span class="form-label">Hora de inicio</span>
      <input type="time" id="te-manual-hora-inicio-opcional" class="form-input" value="${horaHoyStr}" autocomplete="off">
    </div>

    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-manual-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-manual-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  // ---- Selección de materia (única) ----
  let materiaSeleccionadaId = items[0].mm.id;
  const listaMateria = caja.querySelector("#te-manual-materia-lista");
  listaMateria.querySelectorAll(".agenda-semestre-tarjeta").forEach((btn) => {
    btn.addEventListener("click", () => {
      materiaSeleccionadaId = btn.dataset.materiaId;
      listaMateria.querySelectorAll(".agenda-semestre-tarjeta").forEach((b) => b.classList.toggle("active", b === btn));
    });
  });

  // ---- Pill switch Hora / Tiempo ----
  let modo = "hora";
  const switchModo = caja.querySelector("#te-manual-modo-switch");
  const thumbModo = caja.querySelector("#te-manual-modo-thumb");
  const camposHora = caja.querySelector("#te-manual-campos-hora");
  const camposTiempo = caja.querySelector("#te-manual-campos-tiempo");
  const toggleHoraInicioWrap = caja.querySelector("#te-manual-toggle-hora-inicio-wrap");
  const campoHoraInicioOpcional = caja.querySelector("#te-manual-campo-hora-inicio-opcional");
  const checkHoraInicioOpcional = caja.querySelector("#te-manual-toggle-hora-inicio");

  function sincronizarModo() {
    thumbModo.classList.toggle("pill-switch-thumb--derecha", modo === "tiempo");
    switchModo.querySelectorAll(".pill-item").forEach((b) => b.classList.toggle("active", b.dataset.modo === modo));
    camposHora.classList.toggle("oculto", modo !== "hora");
    camposTiempo.classList.toggle("oculto", modo !== "tiempo");
    // El toggle "Agregar hora de inicio" solo existe en modo Tiempo — en
    // modo Hora, la hora de inicio ya se pide en su propio campo de arriba.
    toggleHoraInicioWrap.classList.toggle("oculto", modo !== "tiempo");
    campoHoraInicioOpcional.classList.toggle("oculto", !(modo === "tiempo" && checkHoraInicioOpcional.checked));
  }

  switchModo.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      modo = btn.dataset.modo;
      sincronizarModo();
    });
  });
  checkHoraInicioOpcional.addEventListener("change", sincronizarModo);
  sincronizarModo();

  function cerrar() {
    overlay.remove();
  }
  // Pedido 2.2 (2026-09-17): en toda la sección Tiempo, tocar el fondo del
  // overlay NO cierra el modal — se cierra únicamente con su botón
  // explícito de Cancelar/Cerrar, para no perder lo tipeado de un toque al
  // descuido. (El handler de "clic afuera" que había acá se removió.)
  caja.querySelector("#te-manual-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-manual-guardar").addEventListener("click", () => {
    const materiaMatriculadaId = materiaSeleccionadaId;
    const fecha = caja.querySelector("#te-manual-fecha").value;

    if (!fecha) {
      mostrarToast("Completá la fecha");
      return;
    }

    let inicio, fin, minutosTotales;

    if (modo === "hora") {
      // Modo "Hora": la duración se calcula sola a partir de inicio y fin.
      const horaInicio = caja.querySelector("#te-manual-hora-inicio").value;
      const horaFin = caja.querySelector("#te-manual-hora-fin").value;
      if (!horaInicio || !horaFin) {
        mostrarToast("Completá la hora de inicio y de fin");
        return;
      }
      inicio = construirTimestampLocalReg(fecha, horaInicio);
      fin = construirTimestampLocalReg(fecha, horaFin);
      if (!Number.isFinite(inicio) || !Number.isFinite(fin)) {
        mostrarToast("La fecha u hora no es válida — revisala e intentá de nuevo");
        return;
      }
      if (fin <= inicio) {
        mostrarToast("La hora de fin tiene que ser después de la de inicio");
        return;
      }
      minutosTotales = Math.round((fin - inicio) / 60000);
    } else {
      // Modo "Tiempo": duración directa, sin calcular nada. La hora de
      // inicio opcional es puramente informativa — nunca se usa para
      // derivar una hora de fin ni afecta la duración cargada.
      const h = Math.max(0, Number(caja.querySelector("#te-manual-horas").value) || 0);
      const m = Math.max(0, Number(caja.querySelector("#te-manual-minutos").value) || 0);
      minutosTotales = h * 60 + m;
      if (minutosTotales <= 0) {
        mostrarToast("La duración tiene que ser mayor a 0");
        return;
      }
      const horaInicio = checkHoraInicioOpcional.checked ? caja.querySelector("#te-manual-hora-inicio-opcional").value : horaHoyStr;
      inicio = construirTimestampLocalReg(fecha, horaInicio);
      if (!Number.isFinite(inicio)) {
        mostrarToast("La hora de inicio no es válida — revisala e intentá de nuevo");
        return;
      }
      fin = inicio + minutosTotales * 60000;
    }

    const sesion = crearSesionEstudio({ materiaMatriculadaId, inicio, fin, origen: "manual" });
    estado.datos.sesiones_estudio.push(sesion);
    marcarCambioPendiente();
    // FIX 2026-09-19 (Parte B): antes el aviso era solo "Sesión registrada".
    // Si la sesión no cae en la semana en curso, o la materia no tiene meta,
    // la vista de tarjetas no cambia en nada y la persona no tenía cómo
    // saber si se guardó (y la volvía a cargar). Ahora el aviso dice CUÁL
    // materia, QUÉ día y cuánto — y dónde verla.
    const itemElegido = items.find((it) => it.mm.id === materiaMatriculadaId);
    const nombreElegido = itemElegido ? itemElegido.nombreMateriaCorto || itemElegido.nombreMateria : "la materia";
    mostrarToast(`✓ Registrada: ${formatearMinutosReg(minutosTotales)} de ${nombreElegido} · ${formatearFechaHoraReg(inicio)}. La ves en el detalle de la materia.`);
    revisarFelicitacionMeta(materiaMatriculadaId);
    sincronizarHorasCompetencias();
    notificarSesionesEstudioActualizadas(); // repinta Estadísticas al instante (registro manual)

    cerrar();
    if (onGuardar) onGuardar();
  });
}

/* =========================================================================
   Historial editable de sesiones (pedido 2026-09-07): "todas las sesiones
   deben aparecer como un registro dentro de su propia materia, como
   tarjeta editable (cambiar horas y borrar), debe permitir varios días
   (ej. iniciaste 10pm terminaste 2am)".

   Vive en este archivo (y no en tiempo-estudio.js) porque es la misma
   familia de operación que el registro manual de arriba: las dos tocan
   sesiones de estudio "cerradas" a mano, con el mismo criterio de
   sin-validación-anti-trampa. Edición y borrado usan fecha+hora
   SEPARADAS para inicio y fin (en vez de fecha única + duración, como
   hace el registro manual) — es lo que permite que una sesión cruce
   medianoche sin ningún truco especial: `fin` simplemente cae en el día
   siguiente, la resta de timestamps para `duracion_minutos` no le importa.
   ========================================================================= */

const NOMBRES_DIA_CORTO_REG = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const NOMBRES_MES_CORTO_REG = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];

function formatearMinutosReg(minutosTotales) {
  const totales = Math.max(0, Math.round(minutosTotales));
  const h = Math.floor(totales / 60);
  const m = totales % 60;
  if (h > 0 && m > 0) return `${h} h ${m} min`;
  if (h > 0) return `${h} h`;
  return `${m} min`;
}

/** "lun 7 sep · 22:00" — usado para inicio y fin de la fila de una sesión. */
function formatearFechaHoraReg(ms) {
  if (!Number.isFinite(ms)) return "fecha inválida";
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${NOMBRES_DIA_CORTO_REG[d.getDay()]} ${d.getDate()} ${NOMBRES_MES_CORTO_REG[d.getMonth()]} · ${hh}:${mm}`;
}

/** Valor para un <input type="date">, en hora local. */
function fechaInputReg(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Valor para un <input type="time">, en hora local. */
function horaInputReg(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * FIX 2026-09-19 (Parte B): construye el epoch ms de una fecha+hora LOCAL a
 * partir de los valores de un <input type="date"> y uno <input type="time">,
 * o `NaN` si alguno no se puede interpretar.
 *
 * Antes se armaba con `new Date(`${fecha}T${hora}:00`)`, que da "Invalid
 * Date" si el navegador entrega la hora CON segundos ("09:30:00" →
 * "09:30:00:00"). Y como ni el registro manual ni la edición validaban el
 * resultado, la sesión se guardaba con `inicio = NaN`: quedaba en
 * `sesiones_estudio` pero ningún filtro por fecha la encontraba
 * (`NaN >= x` siempre es false) — no contaba en ninguna estadística ni
 * meta, y en el historial aparecía como "undefined NaN". Justo el caso
 * "la registré y no aparece". Acá se parsea a mano y se ignoran los
 * segundos si vienen.
 */
function construirTimestampLocalReg(fechaStr, horaStr) {
  const f = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaStr || "").trim());
  const h = /^(\d{1,2}):(\d{2})/.exec(String(horaStr || "").trim());
  if (!f || !h) return NaN;
  const ms = new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]), Number(h[1]), Number(h[2]), 0, 0).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Modal de edición — fecha+hora de inicio Y fecha+hora de fin por
 * separado (a diferencia del registro manual de arriba, que solo pide
 * una fecha + duración), justamente para poder mover una punta a otro
 * día sin perder precisión. `sesion` llega del render que abrió el modal
 * y puede quedar vieja si en el medio corrió un sync (relectura de
 * entidad viva, ver fix 2026-09-17 más abajo): al guardar se releé por
 * id en `estado.datos.sesiones_estudio` y se muta esa referencia fresca,
 * nunca el objeto del closure directamente. Re-sella su timestamp para
 * que la sincronización sepa que cambió.
 */
function abrirModalEditarSesion(sesion, refrescar) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); " + "display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";
  caja.style.cssText = "max-width:420px; width:100%; max-height:85vh; overflow-y:auto; gap:14px;";
  caja.addEventListener("click", (e) => e.stopPropagation());

  caja.innerHTML = `
    <h2 style="margin:0;">Editar sesión</h2>

    <div class="stack" style="gap:6px;">
      <span class="form-label" style="margin:0;">Inicio</span>
      <div class="row-between" style="gap:10px;">
        <input type="date" id="te-editar-fecha-inicio" class="form-input" style="flex:1;" value="${fechaInputReg(sesion.inicio)}" autocomplete="off">
        <input type="time" id="te-editar-hora-inicio" class="form-input" style="flex:1;" value="${horaInputReg(sesion.inicio)}" autocomplete="off">
      </div>
    </div>

    <div class="stack" style="gap:6px;">
      <span class="form-label" style="margin:0;">Fin</span>
      <div class="row-between" style="gap:10px;">
        <input type="date" id="te-editar-fecha-fin" class="form-input" style="flex:1;" value="${fechaInputReg(sesion.fin)}" autocomplete="off">
        <input type="time" id="te-editar-hora-fin" class="form-input" style="flex:1;" value="${horaInputReg(sesion.fin)}" autocomplete="off">
      </div>
    </div>
    <p class="muted" style="margin:0; font-size:0.78rem;">
      Si terminaste después de medianoche, poné la fecha de fin al día siguiente — se permite cruzar varios días.
    </p>

    <div class="row-between" style="gap:10px;">
      <button type="button" class="btn btn-secondary" id="te-editar-cancelar" style="flex:1;">Cancelar</button>
      <button type="button" class="btn btn-primary" id="te-editar-guardar" style="flex:1;">Guardar</button>
    </div>
  `;

  overlay.appendChild(caja);
  document.body.appendChild(overlay);

  function cerrar() {
    overlay.remove();
  }
  // Pedido 2.2 (2026-09-17): en toda la sección Tiempo, tocar el fondo del
  // overlay NO cierra el modal — se cierra únicamente con su botón
  // explícito de Cancelar/Cerrar, para no perder lo tipeado de un toque al
  // descuido. (El handler de "clic afuera" que había acá se removió.)
  caja.querySelector("#te-editar-cancelar").addEventListener("click", cerrar);

  caja.querySelector("#te-editar-guardar").addEventListener("click", () => {
    const fechaInicio = caja.querySelector("#te-editar-fecha-inicio").value;
    const horaInicio = caja.querySelector("#te-editar-hora-inicio").value;
    const fechaFin = caja.querySelector("#te-editar-fecha-fin").value;
    const horaFin = caja.querySelector("#te-editar-hora-fin").value;

    if (!fechaInicio || !horaInicio || !fechaFin || !horaFin) {
      mostrarToast("Completá las 4 fechas/horas");
      return;
    }

    const inicio = construirTimestampLocalReg(fechaInicio, horaInicio);
    const fin = construirTimestampLocalReg(fechaFin, horaFin);

    // FIX 2026-09-19 (Parte B): con NaN, `fin <= inicio` da false y la
    // validación de abajo se saltaba — se guardaba una sesión con fechas
    // inválidas. Se valida primero que ambas sean fechas reales.
    if (!Number.isFinite(inicio) || !Number.isFinite(fin)) {
      mostrarToast("Alguna fecha u hora no es válida — revisala e intentá de nuevo");
      return;
    }

    if (fin <= inicio) {
      mostrarToast("El fin tiene que ser después del inicio (¿te faltó mover la fecha de fin al día siguiente?)");
      return;
    }

    // FIX (relectura de entidad viva, auditoría 2026-09-17 punto 2.3): antes
    // se mutaba directo el `sesion` capturado en el closure, que puede venir
    // de un render viejo. Si en el medio bajó un sync (BroadcastChannel de
    // otra pestaña, sondeo remoto, o incluso el borrado de esta misma
    // sesión desde otro lado) esa referencia queda huérfana y el guardado
    // pisaba datos que ya no correspondían al estado real. Se relee por id
    // en estado.datos.sesiones_estudio justo antes de tocar nada, mismo
    // patrón que ya usan los 4 flujos de Gestionar Competencias.
    const sesionViva = estado.datos.sesiones_estudio.find((s) => s.id === sesion.id);
    if (!sesionViva) {
      mostrarToast("Esta sesión ya no existe (se borró o cambió en otro lado)");
      cerrar();
      if (refrescar) refrescar();
      return;
    }

    sesionViva.inicio = inicio;
    sesionViva.fin = fin;
    sesionViva.duracion_minutos = Math.max(0, Math.round((fin - inicio) / 60000));
    sellarTimestamp(sesionViva);
    marcarCambioPendiente();
    revisarFelicitacionMeta(sesionViva.materia_matriculada_id);
    mostrarToast("Sesión actualizada");
    sincronizarHorasCompetencias();
    notificarSesionesEstudioActualizadas(); // repinta Estadísticas al instante (edición)

    cerrar();
    if (refrescar) refrescar();
  });
}

function eliminarSesion(sesion, refrescar) {
  abrirConfirmacion({
    titulo: "Borrar sesión",
    mensaje: `¿Borrar esta sesión de ${formatearMinutosReg(sesion.duracion_minutos)}? No se puede deshacer.`,
    textoConfirmar: "Borrar",
    claseConfirmar: "btn-danger",
    onConfirmar: () => {
      const idx = estado.datos.sesiones_estudio.findIndex((s) => s.id === sesion.id);
      if (idx !== -1) estado.datos.sesiones_estudio.splice(idx, 1);
      // Tumba (regla obligatoria de sync, ver MAPA_FUNCIONES.md "Borrado =
      // tumba"): se agrega el id acá y se filtra del arreglo vivo arriba,
      // para que la fusión sepa que el borrado fue intencional.
      //
      // FIX 2026-09-08 (bug real: "borrar no se mantenía guardado"): esto
      // empujaba `sesion.id` PELADO en vez de un objeto tumba. fusionarTumbas
      // y fusionarColeccion (storage-merge.js) esperan `{ id, eliminadoEn }`
      // — con un valor plano, `t.id` da `undefined` para toda entrada, así
      // que fusionarColeccion nunca reconocía el id como borrado (el Set de
      // eliminados quedaba lleno de `undefined`) y fusionarTumbas directamente
      // descartaba la entrada entera (`t.id === undefined`). Resultado: en
      // cuanto marcarCambioPendiente() disparaba el próximo sync — que
      // primero BAJA lo de Drive y funde antes de subir (ver
      // intentarSincronizar en storage-sync.js) — la sesión, todavía viva del
      // lado remoto, resucitaba en el fusionado. Mismo patrón que ya usa
      // agenda.js al borrar un evento (`_eliminados_agenda.push({ id, eliminadoEn })`).
      estado.datos._eliminados_sesiones_estudio.push({ id: sesion.id, eliminadoEn: Date.now() });
      marcarCambioPendiente();
      mostrarToast("Sesión borrada");
      sincronizarHorasCompetencias();
      notificarSesionesEstudioActualizadas(); // repinta Estadísticas al instante (borrado)
      if (refrescar) refrescar();
    },
  });
}

/**
 * Lista de sesiones de ESTA matrícula puntual (materiaMatriculadaId),
 * más reciente primero, como tarjetas editables/borrables. Se llama desde
 * la pantalla de detalle de tiempo-estudio.js, después del panel de
 * progreso — nunca en la vista de tarjetas ni en Estadísticas (que es un
 * agregado de todas las materias, no el historial de una sola).
 */
function construirListaSesiones(cont, materiaMatriculadaId, color, refrescar) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  sec.style.gap = "12px";
  sec.innerHTML = `<h3 class="texto-encabezado-seccion" style="margin:0;">Sesiones registradas</h3>`;

  const sesiones = (estado.datos.sesiones_estudio || [])
    .filter((s) => s.materia_matriculada_id === materiaMatriculadaId)
    // FIX 2026-09-19 (Parte B): una sesión con `inicio` inválido (NaN — ver
    // construirTimestampLocalReg) hacía que `b.inicio - a.inicio` diera NaN y
    // el orden de TODA la lista quedara indefinido. Las inválidas van al
    // final, y se siguen mostrando (con "fecha inválida") para poder
    // editarlas o borrarlas en vez de quedar invisibles.
    .sort((a, b) => (Number.isFinite(b.inicio) ? b.inicio : -Infinity) - (Number.isFinite(a.inicio) ? a.inicio : -Infinity) || 0);

  if (sesiones.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.style.margin = "0";
    vacio.textContent = "Todavía no hay sesiones registradas en esta materia.";
    sec.appendChild(vacio);
    cont.appendChild(sec);
    return;
  }

  const ORIGEN_ETIQUETA = { timer: "⏱ Timer", pomodoro: "🍅 Pomodoro", manual: "✍️ Manual" };

  const lista = document.createElement("div");
  lista.className = "stack";
  lista.style.gap = "8px";

  sesiones.forEach((sesion) => {
    const fila = document.createElement("div");
    fila.className = "glass-panel";
    fila.style.cssText = `padding:10px 12px; display:flex; align-items:center; gap:10px; box-shadow: inset 3px 0 0 0 ${color};`;

    const info = document.createElement("div");
    info.style.cssText = "flex:1; min-width:0;";
    info.innerHTML = `
      <div style="font-size:0.85rem; font-weight:600;">${formatearFechaHoraReg(sesion.inicio)} → ${formatearFechaHoraReg(sesion.fin)}</div>
      <div class="muted" style="font-size:0.78rem;">${formatearMinutosReg(sesion.duracion_minutos)} · ${ORIGEN_ETIQUETA[sesion.origen] || sesion.origen}</div>
    `;

    const btnEditar = document.createElement("button");
    btnEditar.type = "button";
    btnEditar.className = "te-btn-icono te-btn-icono-fantasma";
    btnEditar.title = "Editar";
    btnEditar.setAttribute("aria-label", "Editar sesión");
    btnEditar.textContent = "✏️";
    btnEditar.addEventListener("click", () => abrirModalEditarSesion(sesion, refrescar));

    const btnBorrar = document.createElement("button");
    btnBorrar.type = "button";
    btnBorrar.className = "te-btn-icono te-btn-icono-fantasma";
    btnBorrar.title = "Borrar";
    btnBorrar.setAttribute("aria-label", "Borrar sesión");
    btnBorrar.textContent = "🗑️";
    btnBorrar.addEventListener("click", () => eliminarSesion(sesion, refrescar));

    fila.appendChild(info);
    fila.appendChild(btnEditar);
    fila.appendChild(btnBorrar);
    lista.appendChild(fila);
  });

  sec.appendChild(lista);
  cont.appendChild(sec);
}

export { abrirModalRegistroManual, construirListaSesiones };
