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
import { crearEnlaceHorarioCompartido, crearAmigoVinculado, sellarTimestamp } from "../core/schema.js";
import { crearArchivoJsonEnDrive, crearPermisoPublicoLectura, eliminarPermisoDrive, guardarDatos, leerDatos } from "../core/auth.js";
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
  const btnConfirmar = document.getElementById("btn-confirmar-aviso-privacidad-horario");
  const btnCancelar = document.getElementById("btn-cancelar-aviso-privacidad-horario");
  if (!modal || !check || !btnConfirmar || !btnCancelar) return;

  check.checked = false;
  btnConfirmar.disabled = true;
  btnConfirmar.style.opacity = "0.45";
  btnConfirmar.style.cursor = "not-allowed";
  // .onchange/.onclick (no addEventListener) a propósito: este modal se
  // reabre cada vez que se comparte de nuevo, con addEventListener se
  // irían acumulando listeners duplicados, mismo criterio que ya usa
  // actualizarBadgeConflictosGlobales en storage-sync.js.
  check.onchange = () => {
    btnConfirmar.disabled = !check.checked;
    btnConfirmar.style.opacity = check.checked ? "1" : "0.45";
    btnConfirmar.style.cursor = check.checked ? "pointer" : "not-allowed";
  };
  btnCancelar.onclick = () => modal.classList.add("oculto");
  btnConfirmar.onclick = () => {
    if (!check.checked) return; // defensivo, el botón ya debería estar disabled
    modal.classList.add("oculto");
    // El apodo ya NO se pide acá: quien comparte no lo elige por sí mismo.
    // Se pide del lado de quien RECIBE el enlace (modal-confirmar-asociar-amigo),
    // así no queda duplicado en los dos flujos.
    onConfirmar();
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
  abrirModalAvisoPrivacidad(() => generarEnlaceCompartido(semestre, null));
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
    // eliminarPermisoDrive, ver comentario en auth.js.
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
 * Solo borra el REGISTRO local del enlace ya revocado, para que no quede
 * dando vueltas en la lista si la persona no quiere verlo más. A propósito
 * NO toca Drive (el archivo y el permiso ya se eliminaron/revocaron en
 * revocarEnlaceCompartido antes de llegar acá) ni deja borrar un enlace
 * todavía activo, esa es la línea de defensa real (revocar primero).
 */
function eliminarRegistroEnlace(enlaceId) {
  const lista = estado.datos.horario_enlaces_compartidos || [];
  const enlace = lista.find((e) => e.id === enlaceId);
  if (!enlace || enlace.activo) return; // defensivo, el botón ya debería estar oculto para uno activo
  estado.datos.horario_enlaces_compartidos = lista.filter((e) => e.id !== enlaceId);
  marcarCambioPendiente();
  renderizarListaEnlacesCompartidos();
  mostrarToast("Registro eliminado");
}

function confirmarEliminarRegistroEnlace(enlaceId) {
  abrirConfirmacion({
    titulo: "¿Eliminar este registro?",
    mensaje: "Ya está revocado, esto solo borra el registro de la lista. No afecta a nadie que lo haya tenido guardado.",
    textoConfirmar: "Eliminar",
    claseConfirmar: "btn-danger",
    onConfirmar: () => eliminarRegistroEnlace(enlaceId),
  });
}

/**
 * Punto obligatorio del prompt: TODOS los enlaces que el usuario generó a
 * lo largo del tiempo, no solo el más reciente, incluidos los ya
 * revocados (para que nunca se pierda el rastro de qué se llegó a
 * compartir alguna vez, salvo que la persona borre el registro a mano con
 * el botón de papelera). Vive en Ajustes → "Horario compartido".
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
    } else {
      const btnEliminar = document.createElement("button");
      btnEliminar.type = "button";
      btnEliminar.title = "Eliminar registro";
      btnEliminar.setAttribute("aria-label", "Eliminar registro");
      btnEliminar.style.cssText = "background:none; border:none; cursor:pointer; padding:4px; color:#e05252; display:flex; align-items:center; justify-content:center;";
      btnEliminar.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg>`;
      btnEliminar.addEventListener("click", () => confirmarEliminarRegistroEnlace(enlace.id));
      fila.querySelector(".row").appendChild(btnEliminar);
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
  // Se repinta cada vez que se abre (no solo una vez al cargar) para que un
  // cambio hecho en otro dispositivo (ej. te desvincularon, o el enlace de
  // un amigo se cayó) se refleje sin depender del ciclo de 5 min.
  renderizarListaAmigosVinculados();
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
  // iniciarRefrescoPeriodicoAmigos() NO se llama acá a propósito: esta
  // función corre en el primer DOMContentLoaded, antes de que estado.datos/
  // estado.token existan (mismo motivo documentado en
  // procesarAsociacionPendienteDeAmigo, más abajo). Se llama en cambio
  // desde mostrarApp() (main.js), junto a procesarAsociacionPendienteDeAmigo().
  // Agregar ahí: `iniciarRefrescoPeriodicoAmigos();`
}

/* ===================== Parte 3: asociar el horario de un amigo (localStorage → cuenta) ===================== */

const KEY_LOCALSTORAGE_PENDIENTE = "horario_amigo_pendiente";
const MS_EXPIRACION_PENDIENTE = 60 * 60 * 1000; // 1h — ver amigos.html/horario-amigos-publico.js
const MAX_AMIGOS_VINCULADOS = 10;

// Paleta fija, no colores random en cada carga: así el color de un amigo se
// mantiene estable a través del tiempo (se elige UNA vez, al vincular, con
// un hash determinístico de su id — ver crearAmigoVinculado en schema.js —
// y de ahí en adelante ese amigo siempre se ve con el mismo color, sin
// depender del orden en que se vincularon los demás).
const PALETA_COLORES_AMIGOS = [
  "#f472b6", "#60a5fa", "#34d399", "#fbbf24", "#a78bfa",
  "#fb923c", "#22d3ee", "#f87171", "#4ade80", "#c084fc",
];

function asignarColorAmigo(semilla) {
  let hash = 0;
  const str = String(semilla || "");
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PALETA_COLORES_AMIGOS.length;
  return PALETA_COLORES_AMIGOS[idx];
}

function abrirModalConfirmarAsociarAmigo(apodoDefault, onConfirmar) {
  const modal = document.getElementById("modal-confirmar-asociar-amigo");
  const input = document.getElementById("input-apodo-confirmar-asociar-amigo");
  const btnCancelar = document.getElementById("btn-cancelar-confirmar-asociar-amigo");
  const btnConfirmar = document.getElementById("btn-confirmar-confirmar-asociar-amigo");
  if (!modal || !input || !btnCancelar || !btnConfirmar) return;

  input.value = apodoDefault || "";
  // .onclick (no addEventListener): mismo motivo que el resto de los
  // modales de este archivo — este también puede reabrirse (aunque en la
  // práctica solo debería disparar una vez por login, no está de más).
  btnCancelar.onclick = () => modal.classList.add("oculto");
  modal.onclick = (e) => { if (e.target === modal) modal.classList.add("oculto"); };
  btnConfirmar.onclick = () => {
    modal.classList.add("oculto");
    onConfirmar(input.value.trim().slice(0, 30) || "Amigo");
  };

  document.body.appendChild(modal);
  modal.style.zIndex = "99999";
  modal.classList.remove("oculto");
}

/**
 * Se llama una vez por carga, desde mostrarApp() (main.js) — NO desde
 * inicializarHorarioAmigos(), porque esa corre en el primer DOMContentLoaded,
 * antes de que estado.datos exista (ver inicializarHorario() en horario.js,
 * que se llama antes del login). Acá ya hay datos cargados sí o sí.
 */
function procesarAsociacionPendienteDeAmigo() {
  const crudo = localStorage.getItem(KEY_LOCALSTORAGE_PENDIENTE);
  if (!crudo) return;
  // Se limpia siempre de una vez, se resuelva o no — así nunca vuelve a
  // preguntar por el mismo pendiente en la próxima carga (ej. si la
  // persona cierra el modal sin decidir, o si ya expiró).
  localStorage.removeItem(KEY_LOCALSTORAGE_PENDIENTE);

  let pendiente;
  try {
    pendiente = JSON.parse(crudo);
  } catch (e) {
    return;
  }
  if (!pendiente || !pendiente.fileId) return;
  if (Date.now() - Number(pendiente.guardado_en || 0) > MS_EXPIRACION_PENDIENTE) return; // muy viejo, se descarta en silencio

  const vinculados = estado.datos.configuracion.horario_amigos_vinculados || [];
  if (vinculados.some((a) => a.file_id === pendiente.fileId)) {
    mostrarToast("Ya tenías vinculado este horario.");
    return;
  }
  if (vinculados.length >= MAX_AMIGOS_VINCULADOS) {
    mostrarToast(`Ya tenés el máximo de ${MAX_AMIGOS_VINCULADOS} horarios vinculados. Desvinculá alguno primero.`);
    return;
  }

  abrirModalConfirmarAsociarAmigo(pendiente.apodo, (apodoFinal) => {
    const amigo = crearAmigoVinculado({
      fileId: pendiente.fileId,
      nombre: apodoFinal,
      color: asignarColorAmigo(pendiente.fileId),
    });
    estado.datos.configuracion.horario_amigos_vinculados.push(amigo);
    sellarTimestamp(estado.datos.configuracion);
    marcarCambioPendiente();
    mostrarToast(`Vinculado el horario de ${amigo.nombre}.`);
  });
}

/* =========================================================================
   Parte 3b: superponer los horarios de amigos vinculados sobre el grid
   propio, panel "Horarios Activos" (switches mostrar/ocultar + desvincular)
   y refresco periódico de los archivos públicos externos.
   ========================================================================= */

/**
 * Visibilidad (mostrar/ocultar en el grid) es una preferencia de VISTA, no
 * un dato del horario en sí. Se guarda en localStorage, NO en
 * estado.datos.configuracion. Motivo: no tiene sentido que viaje al sync
 * (nadie espera que ocultar un amigo en el teléfono lo oculte también en la
 * PC), y así se evita tocar el esquema sincronizado (schema.js) para algo
 * que es puramente de UI local. Guarda solo los file_id OCULTOS (no los
 * visibles) para que un amigo recién vinculado aparezca visible por
 * default sin tener que sembrar nada al vincularlo.
 */
const KEY_LOCALSTORAGE_OCULTOS = "horario_amigos_ocultos_vista";

function obtenerFileIdsOcultos() {
  try {
    const crudo = localStorage.getItem(KEY_LOCALSTORAGE_OCULTOS);
    const arr = crudo ? JSON.parse(crudo) : [];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) {
    return new Set();
  }
}

function guardarFileIdsOcultos(set) {
  try {
    localStorage.setItem(KEY_LOCALSTORAGE_OCULTOS, JSON.stringify([...set]));
  } catch (e) {
    console.warn("No se pudo guardar la preferencia de amigos ocultos:", e);
  }
}

function alternarVisibilidadAmigo(fileId) {
  const ocultos = obtenerFileIdsOcultos();
  if (ocultos.has(fileId)) ocultos.delete(fileId);
  else ocultos.add(fileId);
  guardarFileIdsOcultos(ocultos);
}

/* ----------------- Snapshots remotos: caché + refresco periódico ----------------- */

// file_id -> { snapshot, caida: bool }, en memoria de esta sesión nada
// más. `caida` marca un amigo cuyo enlace ya no responde (404: lo revocó,
// o borró el archivo). Se sigue mostrando en la lista para que la persona
// pueda desvincularlo a mano, pero no se dibuja nada de él en el grid.
const cacheSnapshotsAmigos = new Map();

async function refrescarSnapshotsAmigos() {
  if (!estado.datos || !estado.token) return;
  const vinculados = estado.datos.configuracion?.horario_amigos_vinculados || [];
  await Promise.all(
    vinculados.map(async (amigo) => {
      try {
        const snapshot = await leerDatos(estado.token, amigo.file_id);
        cacheSnapshotsAmigos.set(amigo.file_id, { snapshot, caida: false });
      } catch (e) {
        // 404/403 (enlace revocado del otro lado) se trata distinto de un
        // fallo de red transitorio: se marca "caída" para avisar en el
        // panel, pero no se descarta el vínculo. Desvincular es siempre
        // una decisión explícita de la persona, nunca automática.
        const status = e && e.status;
        cacheSnapshotsAmigos.set(amigo.file_id, { snapshot: null, caida: status === 404 || status === 403 });
        console.warn(`No se pudo refrescar el horario de ${amigo.nombre}:`, e);
      }
    })
  );
  if (typeof window.renderizarHorario === "function") window.renderizarHorario();
  renderizarListaAmigosVinculados();
}

let intervaloRefrescoAmigos = null;

function iniciarRefrescoPeriodicoAmigos() {
  refrescarSnapshotsAmigos();
  clearInterval(intervaloRefrescoAmigos);
  // Cada 5 min mientras la pestaña siga abierta, mismo espíritu que el
  // sondeo de storage-sync.js, pero un intervalo propio y más largo: esto
  // no es data propia (no hay nada que "perder" por tardar un poco más en
  // notarlo), así que no vale la pena sondear tan seguido como el sync
  // normal ni gastar cuota de Drive en archivos ajenos.
  intervaloRefrescoAmigos = setInterval(refrescarSnapshotsAmigos, 5 * 60 * 1000);
}

/* ----------------- Resolver clases de un amigo para un día real ----------------- */

function parseFechaLocalAmigo(str) {
  const soloFecha = String(str || "").slice(0, 10);
  const [y, m, d] = soloFecha.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

/**
 * Semana del snapshot del amigo (1-based) a la que pertenece `fecha`.
 * Simple diferencia de días entre semanas de 7 días reales desde su
 * fecha_inicio, sin importar en qué día de la semana caiga esa fecha
 * (misma idea que calcularNumeroSemanaSemestre en schema.js, pero
 * reimplementada acá porque el snapshot no es un semestre local real).
 */
function calcularNumeroSemanaAmigo(snapshot, fecha) {
  const inicio = parseFechaLocalAmigo(snapshot.fecha_inicio);
  if (isNaN(inicio.getTime()) || isNaN(fecha.getTime())) return null;
  const diffDias = Math.round((fecha - inicio) / 86400000);
  const numero = Math.floor(diffDias / 7) + 1;
  const total = Number(snapshot.duracion_semanas) || 16;
  if (numero < 1 || numero > total) return null; // fuera del rango de su semestre
  return numero;
}

/**
 * Bloques de TODOS los amigos visibles (no ocultos, con snapshot cargado)
 * que caen en `diaCodigo` para la fecha real `fecha`. Se le pasa `fecha`
 * (no numeroSemana local) porque el amigo tiene su PROPIO semestre,
 * distinto fecha_inicio/duración que el semestre que se esté mirando acá.
 * Así que lo único que de verdad se puede alinear entre los dos horarios
 * es la fecha calendario real, nunca el número de semana.
 */
function obtenerBloquesAmigosPorDia(fecha, diaCodigo) {
  if (!fecha || isNaN(fecha.getTime())) return [];
  const ocultos = obtenerFileIdsOcultos();
  const vinculados = estado.datos?.configuracion?.horario_amigos_vinculados || [];
  const resultado = [];

  vinculados.forEach((amigo) => {
    if (ocultos.has(amigo.file_id)) return;
    const entrada = cacheSnapshotsAmigos.get(amigo.file_id);
    if (!entrada || !entrada.snapshot) return;
    const snapshot = entrada.snapshot;
    const numeroSemana = calcularNumeroSemanaAmigo(snapshot, fecha);
    if (numeroSemana == null) return;

    (snapshot.bloques || []).forEach((bloque) => {
      const diaBase = (bloque.dias || []).find((d) => d.dia === diaCodigo);
      if (!diaBase) return;
      // Excepción puntual de esa semana (mismo patrón que
      // obtenerClasesEfectivasSemana en schema.js): si existe, su
      // modalidad manda; "sin_clase" se omite del todo acá (a diferencia
      // del grid propio, no vale la pena dibujar una tarjeta ajena
      // atenuada solo para decir "hoy no tiene clase").
      const excepcion = (bloque.cronograma_dias || []).find(
        (cd) => cd.numero_semana === numeroSemana && cd.dia === diaCodigo
      );
      const modalidad = excepcion ? excepcion.modalidad : diaBase.modalidad;
      if (modalidad === "sin_clase") return;

      resultado.push({
        inicioMin: minutosDesdeHoraAmigo(diaBase.hora_inicio),
        finMin: minutosDesdeHoraAmigo(diaBase.hora_fin),
        color: amigo.color,
        nombreAmigo: amigo.nombre,
        nombreBloque: bloque.nombre,
        modalidad,
      });
    });
  });

  return resultado;
}

function minutosDesdeHoraAmigo(horaStr) {
  const [h, m] = String(horaStr || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/* ----------------- Panel "Horarios Activos" (switches + desvincular) ----------------- */

function renderizarListaAmigosVinculados() {
  const cont = document.getElementById("lista-amigos-vinculados");
  if (!cont || !estado.datos) return;

  const vinculados = estado.datos.configuracion?.horario_amigos_vinculados || [];
  if (vinculados.length === 0) {
    cont.innerHTML = `<p class="muted" style="font-size:0.82rem;">Todavía no vinculaste el horario de ningún amigo. Pedile que te comparta su enlace.</p>`;
    return;
  }

  const ocultos = obtenerFileIdsOcultos();
  cont.innerHTML = "";
  vinculados.forEach((amigo) => {
    const entrada = cacheSnapshotsAmigos.get(amigo.file_id);
    const caida = entrada?.caida === true;
    const oculto = ocultos.has(amigo.file_id);

    const fila = document.createElement("div");
    fila.className = "row-between";
    fila.style.cssText = "padding:8px 10px; border-radius:10px; background:rgba(150,150,170,0.08); gap:8px;";
    fila.innerHTML = `
      <div class="row" style="align-items:center; gap:8px; min-width:0;">
        <span style="width:12px; height:12px; border-radius:50%; flex-shrink:0; background:${amigo.color};"></span>
        <span style="font-size:0.85rem; font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${amigo.nombre}</span>
        ${caida ? `<span class="badge badge-danger" style="font-size:0.68rem;" title="El enlace ya no responde, puede que lo hayan revocado">Enlace caído</span>` : ""}
      </div>
    `;
    const controles = document.createElement("div");
    controles.className = "row";
    controles.style.cssText = "align-items:center; gap:8px; flex-shrink:0;";

    const labelSwitch = document.createElement("label");
    labelSwitch.className = "switch switch-tema";
    labelSwitch.title = oculto ? "Mostrar en el horario" : "Ocultar del horario";
    labelSwitch.innerHTML = `<input type="checkbox" ${oculto ? "" : "checked"}><span class="track"><span class="thumb"></span></span>`;
    labelSwitch.querySelector("input").addEventListener("change", () => {
      alternarVisibilidadAmigo(amigo.file_id);
      renderizarListaAmigosVinculados();
      if (typeof window.renderizarHorario === "function") window.renderizarHorario();
    });
    controles.appendChild(labelSwitch);

    const btnQuitar = document.createElement("button");
    btnQuitar.type = "button";
    btnQuitar.className = "btn btn-danger";
    btnQuitar.style.cssText = "padding:6px 10px; font-size:0.75rem;";
    btnQuitar.textContent = "Desvincular";
    btnQuitar.addEventListener("click", () => confirmarDesvincularAmigo(amigo.file_id, amigo.nombre));
    controles.appendChild(btnQuitar);

    fila.appendChild(controles);
    cont.appendChild(fila);
  });
}

function confirmarDesvincularAmigo(fileId, nombre) {
  abrirConfirmacion({
    titulo: `¿Desvincular a ${nombre}?`,
    mensaje: "Ya no vas a ver su horario superpuesto. Podés volver a vincularlo si te comparte el enlace de nuevo.",
    textoConfirmar: "Desvincular",
    claseConfirmar: "btn-danger",
    onConfirmar: () => {
      const lista = estado.datos.configuracion.horario_amigos_vinculados || [];
      estado.datos.configuracion.horario_amigos_vinculados = lista.filter((a) => a.file_id !== fileId);
      sellarTimestamp(estado.datos.configuracion);
      marcarCambioPendiente();
      cacheSnapshotsAmigos.delete(fileId);
      const ocultos = obtenerFileIdsOcultos();
      ocultos.delete(fileId);
      guardarFileIdsOcultos(ocultos);
      renderizarListaAmigosVinculados();
      if (typeof window.renderizarHorario === "function") window.renderizarHorario();
      mostrarToast(`Desvinculado el horario de ${nombre}.`);
    },
  });
}

export {
  inicializarHorarioAmigos,
  abrirPanelAmigos,
  renderizarListaEnlacesCompartidos,
  procesarAsociacionPendienteDeAmigo,
  asignarColorAmigo,
  iniciarRefrescoPeriodicoAmigos,
  obtenerBloquesAmigosPorDia,
  renderizarListaAmigosVinculados,
};
