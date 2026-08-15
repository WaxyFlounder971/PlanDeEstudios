/* =========================================================================
   HORARIO ENTRE AMIGOS — Parte 1: flujo de compartir
   -------------------------------------------------------------------------
   Compartir el horario propio por enlace público de solo lectura vía
   Google Drive, sin que quien lo recibe necesite cuenta. Esta entrega
   cubre: aviso de privacidad obligatorio, creación del archivo público en
   Drive, generación/copia del enlace, y la lista de "enlaces que
   generaste" (con revocar individual) — los 4 puntos obligatorios del
   prompt.

   NO incluye todavía (prompts aparte): la vista pública sin sesión
   (amigos.html), ni "Asociar a mi cuenta"/"Horarios Activos" (vincular el
   horario de un AMIGO al propio — dirección opuesta de este mismo feature,
   ver horario_amigos_vinculados en el prompt original).
   ========================================================================= */

import { estado } from "../core/storage.js";
import { marcarCambioPendiente, mostrarCargando, ocultarCargando, registrarHookPostGuardado } from "../core/storage-sync.js";
import { crearEnlaceHorarioCompartido, sellarTimestamp } from "../core/schema.js";
import { crearArchivoJsonEnDrive, crearPermisoPublicoLectura, eliminarPermisoDrive, guardarDatos } from "../core/auth.js";
import { mostrarToast, abrirConfirmacion, desplazarYResaltarElemento } from "../ui/componentes.js";
import { copiarAlPortapapelesBlindado } from "../core/clipboard.js";
import { obtenerSemestreHorarioActual, obtenerColorBloque, obtenerNombreBloque, obtenerRangoHorasHorario } from "./horario.js";

// Restringido por dominio en Google Cloud a este mismo GitHub Pages — ver
// nota de configuración del prompt. amigos.html vive en la raíz del repo,
// hermano de index.html.
const BASE_URL_AMIGOS = "https://waxyflounder971.github.io/PlanDeEstudios/amigos.html";

/* ===================== Snapshot público (privacidad: mínimo indispensable) ===================== */

/**
 * Arma el JSON que se sube a Drive como archivo público. A propósito NO es
 * un recorte de estado.datos: es un objeto nuevo con SOLO lo que el prompt
 * autoriza a exponer (bloques, días, horas, nombres/apodo ya resueltos) —
 * nunca aula, profesor, enlace de clase ni notas, aunque esos campos sí
 * vivan en el bloque real. Motivo: un horario ya es sensible de por sí
 * (revela dónde está una persona cada semana); exponer de más "porque ya
 * estaba ahí" sería fácil pero innecesario.
 *
 * `nombre`/`color` van RESUELTOS (no materia_id/plan_estudio_id) porque
 * quien abre el enlace nunca tiene sesión — no hay plan/categorías propias
 * contra qué resolverlos del otro lado.
 */
function construirSnapshotHorarioCompartido(semestre, apodoPropietario) {
  const cfg = estado.datos.configuracion || {};
  const { horaInicio, horaFin } = obtenerRangoHorasHorario();

  return {
    version: 1,
    generado_en: new Date().toISOString(),
    // Opcional, escrito a mano por quien comparte (nunca autocompletado con
    // su nombre real de cuenta) — amigos.html lo usa como default editable
    // al asociar. Puede ser null: el snapshot sigue sin ningún dato de
    // identidad si el usuario lo deja vacío.
    apodo_propietario: apodoPropietario || null,
    semestre_nombre: semestre.nombre,
    fecha_inicio: semestre.fecha_inicio,
    duracion_semanas: semestre.duracion_semanas,
    config_dias: {
      dia_inicio_semana: cfg.dia_inicio_semana || "lunes",
      dias_visibles: cfg.dias_visibles || null, // null = todas (mismo default que horario.js)
      nombres_dias_personalizados: cfg.nombres_dias_personalizados || {},
    },
    rango_horas: { horaInicio, horaFin },
    bloques: (semestre.bloques_horario || []).map((bloque) => ({
      id: bloque.id,
      nombre: obtenerNombreBloque(bloque),
      color: obtenerColorBloque(bloque),
      dias: (bloque.dias || []).map((d) => ({
        dia: d.dia,
        hora_inicio: d.hora_inicio,
        hora_fin: d.hora_fin,
        modalidad: d.modalidad || "presencial",
      })),
      // Se conserva el cronograma de excepciones puntuales (ej. "virtual
      // solo esta semana") para que la vista pública no se vea distinta de
      // la real — solo lleva numero_semana/dia/modalidad, nada nuevo.
      cronograma_dias: (bloque.cronograma_dias || []).map((cd) => ({
        numero_semana: cd.numero_semana,
        dia: cd.dia,
        modalidad: cd.modalidad,
      })),
    })),
  };
}

/* ===================== Mantener los archivos públicos al día ===================== */

// Solo en memoria de esta sesión (no persistido): evita subir a Drive un
// contenido idéntico al que ya se subió la última vez, en cada ciclo de
// sync que corre por CUALQUIER cambio (no solo uno de Horario) — importante
// porque no hay billing vinculada al proyecto de Drive (ver nota del
// prompt): si se excede la cuota gratis, las peticiones fallan solas, así
// que conviene no gastarla en subidas que no cambian nada.
const cacheUltimoContenidoPorEnlace = new Map();

/**
 * Se registra como hook post-guardado (ver registrarHookPostGuardado en
 * storage-sync.js) — corre solo, después de cada subida exitosa a Drive,
 * sin que storage-sync.js tenga que importar este archivo (evita el import
 * circular: este archivo sí importa cosas de storage-sync.js). Así, editar
 * el horario compartido actualiza el/los archivo(s) públicos activos casi
 * en el mismo momento en que se sincroniza el resto de la app, sin
 * mecanismo aparte que el usuario tenga que disparar a mano.
 */
async function actualizarArchivosHorarioCompartidosSiHaceFalta() {
  if (!estado.datos || !estado.token) return;
  const enlaces = (estado.datos.horario_enlaces_compartidos || []).filter((e) => e.activo);

  for (const enlace of enlaces) {
    try {
      const semestre = (estado.datos.semestres || []).find((s) => s.id === enlace.semestre_id);
      if (!semestre) continue; // el semestre de origen ya no existe; se deja el archivo público tal cual quedó

      const snapshot = construirSnapshotHorarioCompartido(semestre, enlace.apodo_propietario);
      const contenidoStr = JSON.stringify(snapshot);
      if (cacheUltimoContenidoPorEnlace.get(enlace.file_id) === contenidoStr) continue; // sin cambios reales

      await guardarDatos(estado.token, enlace.file_id, snapshot);
      cacheUltimoContenidoPorEnlace.set(enlace.file_id, contenidoStr);
    } catch (e) {
      console.warn(`No se pudo actualizar el horario compartido (enlace ${enlace.id}):`, e);
    }
  }
}

registrarHookPostGuardado(actualizarArchivosHorarioCompartidosSiHaceFalta);

/* ===================== Aviso de privacidad (obligatorio, con checkbox) ===================== */

function abrirModalAvisoPrivacidad(onConfirmar) {
  const modal = document.getElementById("modal-aviso-privacidad-horario");
  const check = document.getElementById("check-entiendo-privacidad-horario");
  const inputApodo = document.getElementById("input-apodo-horario-compartido");
  const btnConfirmar = document.getElementById("btn-confirmar-aviso-privacidad-horario");
  const btnCancelar = document.getElementById("btn-cancelar-aviso-privacidad-horario");
  if (!modal || !check || !btnConfirmar || !btnCancelar) return;

  check.checked = false;
  btnConfirmar.disabled = true;
  if (inputApodo) inputApodo.value = "";
  // .onchange/.onclick (no addEventListener) a propósito: este modal se
  // reabre cada vez que se comparte de nuevo — con addEventListener se
  // irían acumulando listeners duplicados, mismo criterio que ya usa
  // actualizarBadgeConflictosGlobales en storage-sync.js.
  check.onchange = () => { btnConfirmar.disabled = !check.checked; };
  btnCancelar.onclick = () => modal.classList.add("oculto");
  btnConfirmar.onclick = () => {
    if (!check.checked) return; // defensivo, el botón ya debería estar disabled
    modal.classList.add("oculto");
    const apodo = inputApodo ? inputApodo.value.trim().slice(0, 30) : "";
    onConfirmar(apodo || null);
  };
  // .onclick (no addEventListener) por el mismo motivo que check/btnConfirmar
  // arriba: este modal se reabre, addEventListener acumularía un listener
  // de cierre-al-tocar-afuera por cada apertura.
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add("oculto");
  };

  document.body.appendChild(modal);
  modal.style.zIndex = "99999";
  modal.classList.remove("oculto");
}

/* ===================== Flujo de compartir ===================== */

async function generarEnlaceCompartido(semestre, apodo) {
  mostrarCargando();
  try {
    const snapshot = construirSnapshotHorarioCompartido(semestre, apodo);
    // Nombre no descriptivo a propósito (punto obligatorio del prompt): no
    // lleva el nombre del usuario ni nada identificable, para que el
    // archivo en sí, visto suelto en Drive, no delate de quién es.
    const nombreArchivo = `h_${crypto.randomUUID()}.json`;
    const fileId = await crearArchivoJsonEnDrive(estado.token, nombreArchivo, snapshot);
    const permiso = await crearPermisoPublicoLectura(estado.token, fileId);

    const enlace = crearEnlaceHorarioCompartido({ fileId, permissionId: permiso.id, semestreId: semestre.id, apodoPropietario: apodo });
    estado.datos.horario_enlaces_compartidos = estado.datos.horario_enlaces_compartidos || [];
    estado.datos.horario_enlaces_compartidos.push(enlace);
    cacheUltimoContenidoPorEnlace.set(fileId, JSON.stringify(snapshot));
    marcarCambioPendiente();

    const url = `${BASE_URL_AMIGOS}#fileId=${fileId}`;
    await copiarAlPortapapelesBlindado(url); // best-effort: si falla, el modal de abajo igual deja copiar a mano
    mostrarModalEnlaceGenerado(url);
    renderizarListaEnlacesCompartidos();
  } catch (e) {
    console.warn("No se pudo generar el enlace de horario compartido:", e);
    mostrarToast("No se pudo generar el enlace. Intentá de nuevo.");
  } finally {
    ocultarCargando();
  }
}

function iniciarFlujoCompartir() {
  const semestre = obtenerSemestreHorarioActual();
  if (!semestre) {
    mostrarToast("Creá un semestre primero");
    return;
  }
  cerrarPanelAmigos();
  abrirModalAvisoPrivacidad((apodo) => generarEnlaceCompartido(semestre, apodo));
}

/** Modal de resultado: enlace ya copiado + botones de copiar de nuevo / compartir nativo. */
function mostrarModalEnlaceGenerado(url) {
  const modal = document.getElementById("modal-enlace-horario-generado");
  const input = document.getElementById("input-enlace-horario-generado");
  const btnCompartir = document.getElementById("btn-compartir-enlace-horario-generado");
  const btnCopiar = document.getElementById("btn-copiar-enlace-horario-generado");
  const btnCerrar = document.getElementById("btn-cerrar-enlace-horario-generado");
  if (!modal || !input || !btnCompartir || !btnCopiar || !btnCerrar) return;

  input.value = url;
  // El share sheet nativo no existe en todos los navegadores (ej. la
  // mayoría de escritorio) — el botón solo se ofrece cuando sí hay algo
  // real que abrir.
  btnCompartir.classList.toggle("oculto", !navigator.share);
  btnCompartir.onclick = () => {
    navigator.share({ title: "Mi horario", url }).catch(() => {});
  };
  btnCopiar.onclick = async () => {
    const ok = await copiarAlPortapapelesBlindado(url);
    if (ok) {
      mostrarToast("✓ Enlace copiado");
    } else {
      mostrarToast("No se pudo copiar — seleccionalo a mano");
      input.focus();
      input.select();
    }
  };
  btnCerrar.onclick = () => modal.classList.add("oculto");
  modal.onclick = (e) => {
    if (e.target === modal) modal.classList.add("oculto");
  };

  document.body.appendChild(modal);
  modal.style.zIndex = "99999";
  modal.classList.remove("oculto");
  mostrarToast("✓ Horario compartido, enlace copiado");
}

/* ===================== Lista "enlaces que generaste" (Ajustes) ===================== */

function confirmarRevocarEnlace(enlaceId) {
  abrirConfirmacion({
    titulo: "¿Revocar este enlace?",
    mensaje: "Quien lo tenga guardado ya no va a poder ver tu horario. Esto no se puede deshacer.",
    textoConfirmar: "Revocar",
    claseConfirmar: "btn-danger",
    onConfirmar: () => revocarEnlaceCompartido(enlaceId),
  });
}

async function revocarEnlaceCompartido(enlaceId) {
  const enlace = (estado.datos.horario_enlaces_compartidos || []).find((e) => e.id === enlaceId);
  if (!enlace) return;

  mostrarCargando();
  try {
    // 404 (permiso o archivo ya no existen) se trata como éxito dentro de
    // eliminarPermisoDrive — ver comentario en auth.js.
    if (enlace.permission_id) {
      await eliminarPermisoDrive(estado.token, enlace.file_id, enlace.permission_id);
    }
    enlace.activo = false;
    sellarTimestamp(enlace);
    cacheUltimoContenidoPorEnlace.delete(enlace.file_id);
    marcarCambioPendiente();
    renderizarListaEnlacesCompartidos();
    mostrarToast("Enlace revocado");
  } catch (e) {
    console.warn("No se pudo revocar el enlace:", e);
    mostrarToast("No se pudo revocar. Intentá de nuevo.");
  } finally {
    ocultarCargando();
  }
}

/**
 * Punto obligatorio del prompt: TODOS los enlaces que el usuario generó a
 * lo largo del tiempo, no solo el más reciente — incluidos los ya
 * revocados (para que nunca se pierda el rastro de qué se llegó a
 * compartir alguna vez). Vive en Ajustes → "Horario compartido".
 */
function renderizarListaEnlacesCompartidos() {
  const cont = document.getElementById("lista-horario-enlaces-compartidos");
  if (!cont || !estado.datos) return;

  const enlaces = (estado.datos.horario_enlaces_compartidos || [])
    .slice()
    .sort((a, b) => new Date(b.fecha_creacion) - new Date(a.fecha_creacion));

  if (enlaces.length === 0) {
    cont.innerHTML = `<p class="muted" style="font-size:0.82rem;">Todavía no compartiste tu horario.</p>`;
    return;
  }

  cont.innerHTML = "";
  enlaces.forEach((enlace) => {
    const semestre = (estado.datos.semestres || []).find((s) => s.id === enlace.semestre_id);
    const fecha = new Date(enlace.fecha_creacion).toLocaleDateString("es-CR", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const fila = document.createElement("div");
    fila.className = "row-between";
    fila.style.cssText = "padding:8px 10px; border-radius:10px; background:rgba(150,150,170,0.08);";
    fila.innerHTML = `
      <div class="stack" style="gap:2px;">
        <span style="font-size:0.85rem; font-weight:600;">${semestre ? semestre.nombre : "Semestre eliminado"}</span>
        <span class="muted" style="font-size:0.72rem;">Compartido el ${fecha}</span>
      </div>
      <div class="row" style="align-items:center; gap:8px;">
        <span class="badge ${enlace.activo ? "badge-success" : "badge-danger"}">${enlace.activo ? "Activo" : "Revocado"}</span>
      </div>
    `;
    if (enlace.activo) {
      const btnRevocar = document.createElement("button");
      btnRevocar.type = "button";
      btnRevocar.className = "btn btn-danger";
      btnRevocar.style.cssText = "padding:6px 12px; font-size:0.78rem;";
      btnRevocar.textContent = "Revocar";
      btnRevocar.addEventListener("click", () => confirmarRevocarEnlace(enlace.id));
      fila.querySelector(".row").appendChild(btnRevocar);
    }
    cont.appendChild(fila);
  });
}

/* ===================== Panel "Amigos" (botón del header de Horario) ===================== */

function abrirPanelAmigos() {
  const modal = document.getElementById("modal-panel-amigos");
  if (!modal) return;
  document.body.appendChild(modal);
  modal.classList.remove("oculto");
}

function cerrarPanelAmigos() {
  document.getElementById("modal-panel-amigos")?.classList.add("oculto");
}

function inicializarPanelAmigos() {
  const modal = document.getElementById("modal-panel-amigos");
  const btnCompartir = document.getElementById("btn-compartir-horario");
  const btnIrEnlaces = document.getElementById("btn-ir-enlaces-generados");
  if (!modal) return;

  if (btnCompartir) btnCompartir.addEventListener("click", iniciarFlujoCompartir);

  if (btnIrEnlaces) {
    btnIrEnlaces.addEventListener("click", () => {
      cerrarPanelAmigos();
      // Navegación cruzada Horario → Ajustes: mismo patrón que el resto de
      // la app (window.mostrarSeccion + desplazarYResaltarElemento, ver
      // componentes.js) — se abre la tarjeta si estaba colapsada y se hace
      // scroll + destello para que sea imposible no verla.
      if (typeof window.mostrarSeccion === "function") window.mostrarSeccion("configuracion");
      const seccion = document.getElementById("ajuste-seccion-horario-enlaces");
      const cabecera = seccion?.querySelector(".ajuste-seccion-cabecera");
      if (seccion && seccion.classList.contains("colapsada") && cabecera) cabecera.click();
      requestAnimationFrame(() => desplazarYResaltarElemento("#ajuste-seccion-horario-enlaces"));
    });
  }

  modal.addEventListener("click", (e) => {
    if (e.target === modal) cerrarPanelAmigos();
  });

  // Refresca la lista cada vez que el usuario abre esta tarjeta puntual de
  // Ajustes a mano (no solo al cargar la app) — así un cambio hecho desde
  // otro dispositivo (ej. revocar un enlace en el teléfono) se ve
  // actualizado al volver a entrar acá en la PC, sin depender de un F5.
  const cabeceraAjustes = document.querySelector("#ajuste-seccion-horario-enlaces .ajuste-seccion-cabecera");
  if (cabeceraAjustes) cabeceraAjustes.addEventListener("click", renderizarListaEnlacesCompartidos);
}

function inicializarHorarioAmigos() {
  inicializarPanelAmigos();
  renderizarListaEnlacesCompartidos();
}

export { inicializarHorarioAmigos, abrirPanelAmigos, renderizarListaEnlacesCompartidos };
