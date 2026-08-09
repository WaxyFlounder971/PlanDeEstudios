/* =========================================================================
   COMUNIDAD — Parte 3b (Profesores completo)
   Responsable de: la sección #seccion-comunidad completa.

   PROFESORES — ya incluye:
   - Alta / edición (nombre, correo, teléfono, materias que da como tags
     libres — de referencia general, no atadas a ningún semestre tuyo).
   - Tarjeta expandible: contacto, materias generales, link(s) a MisProfes
     (según en qué universidad(es) diste clase con él — la escuela completa,
     no un profesor puntual, ver LINKS_MISPROFES), historial de vinculaciones
     reales y botones Vincular/Editar/Eliminar.
   - "Vincular a una materia tuya": selector semestre → materia (de TUS
     semestres) que guarda profesor_id + calificación 1-10 (decimal) +
     "¿volverías a llevarlo?" directo en esa materia_matriculada puntual —
     es lo único que hace que el filtro "Tuyos" lo cuente.
   - Eliminar un profesor limpia también la referencia (profesor_id,
     calificación, volvería_a_llevar) en cualquier materia_matriculada que
     apuntara a él, para no dejar ids huérfanos sueltos.

   COMPAÑEROS — todavía en esqueleto (alta real es la siguiente parte):
   - Tabs, filtro Recomendados/No recomendados y listado ya funcionan.
   - "+ Agregar compañero" todavía solo avisa que viene en la próxima parte.
   ========================================================================= */

import { crearProfesor, obtenerHistorialProfesor, obtenerUniversidadesDeProfesor, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";

// Transitorio (no persistido, no sincronizado) — mismo patrón que
// estado.modoEdicionSemestres en semestres.js: vive en memoria, se resetea
// solo al recargar la página.
estado.tabComunidad = "profesores"; // "profesores" | "companeros"
estado.filtroComunidadProfesores = "todos"; // "todos" | "tuyos" | "no-tuyos"
estado.filtroComunidadCompaneros = "todos"; // "todos" | "recomendados" | "no-recomendados"
estado.profesoresExpandidos = estado.profesoresExpandidos || new Set(); // ids con la tarjeta abierta

// Escuela completa en misprofesores.com (no un profesor puntual — pedido
// explícito: los profesores suelen estar duplicados/mal cargados ahí, así
// que el link lleva a la escuela y el usuario busca a mano desde ahí).
const LINKS_MISPROFES = {
  TEC: "https://costarica.misprofesores.com/escuelas/ITCR-Instituto-Tecnologico-de-Costa-Rica_1135",
  UCR: "https://costarica.misprofesores.com/escuelas/UCR-Universidad-de-Costa-Rica_1126",
};

/* ===================== Helpers de datos ===================== */

/** Sanitiza cualquier string de usuario antes de insertarla vía innerHTML
 *  (nombre, correo, materias, nota, etc.) — nunca se confía en que venga
 *  limpia solo porque es "nuestros propios datos" (pudo importarse o
 *  sincronizarse desde otro dispositivo). */
function escaparHtml(texto) {
  const div = document.createElement("div");
  div.textContent = texto === null || texto === undefined ? "" : String(texto);
  return div.innerHTML;
}

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

function obtenerNombreMateria(mm) {
  const plan = obtenerPlanPorId(mm.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
  return materia ? materia.nombre : "Materia eliminada";
}

function buscarProfesorVivoPorId(id) {
  return (estado.datos.profesores || []).find((p) => p.id === id) || null;
}

/** Mismo patrón que buscarSemestreVivoPorId en semestres.js: releer por id
 *  justo antes de mutar, por si de por medio pasó un sondeo remoto que
 *  reemplazó estado.datos entero mientras el modal estaba abierto. */
function buscarMmVivaPorId(mmId) {
  for (const semestre of estado.datos.semestres || []) {
    const mm = (semestre.materias_matriculadas || []).find((m) => m.id === mmId);
    if (mm) return { semestre, mm };
  }
  return null;
}

/** "Tuyo" = tiene al menos una vinculación real a una materia_matriculada de
 *  TUS semestres (ver obtenerHistorialProfesor en schema.js) — no es un flag
 *  manual, se deriva solo de si vos lo vinculaste alguna vez a una materia. */
function esProfesorTuyo(profesor, datos) {
  return obtenerHistorialProfesor(profesor.id, datos).length > 0;
}

/* ===================== Pills reusables (tabs y filtros) ===================== */

function construirGrupoPills(opciones, valorActivo, onCambiar) {
  const grupo = document.createElement("div");
  grupo.className = "pill-group";
  grupo.style.cssText = "display:flex; width:100%; gap:8px;";
  opciones.forEach(({ valor, texto }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (valorActivo === valor ? " active" : "");
    btn.style.flex = "1";
    btn.textContent = texto;
    btn.addEventListener("click", () => onCambiar(valor));
    grupo.appendChild(btn);
  });
  return grupo;
}

/* ===================== Tarjetas ===================== */

function construirTarjetaProfesor(profesor, datos) {
  const tuyo = esProfesorTuyo(profesor, datos);
  const universidades = obtenerUniversidadesDeProfesor(profesor.id, datos);
  const expandido = estado.profesoresExpandidos.has(profesor.id);

  const card = document.createElement("div");
  card.className = "glass-panel stack";
  card.style.cssText = "gap:6px; cursor:pointer;";

  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";
  encabezado.innerHTML = `
    <strong>${escaparHtml(profesor.nombre)}</strong>
    <span style="display:flex; align-items:center; gap:6px;">
      ${tuyo ? '<span class="badge-warning" style="font-size:11px; white-space:nowrap;">Tuyo</span>' : ""}
      <span class="muted" style="font-size:12px;">${expandido ? "▲" : "▼"}</span>
    </span>
  `;
  encabezado.addEventListener("click", () => {
    if (expandido) estado.profesoresExpandidos.delete(profesor.id);
    else estado.profesoresExpandidos.add(profesor.id);
    renderizarComunidad();
  });
  card.appendChild(encabezado);

  const datosContacto = [profesor.correo, profesor.telefono].filter(Boolean);
  if (datosContacto.length > 0) {
    const contacto = document.createElement("p");
    contacto.className = "muted";
    contacto.style.margin = "0";
    contacto.textContent = datosContacto.join(" · ");
    card.appendChild(contacto);
  }

  if (!expandido) return card;

  if ((profesor.materias || []).length > 0) {
    const tags = document.createElement("p");
    tags.style.margin = "0";
    tags.innerHTML = profesor.materias
      .map((m) => `<span class="pill-item" style="display:inline-block; margin:2px 4px 2px 0; cursor:default;">${escaparHtml(m)}</span>`)
      .join("");
    card.appendChild(tags);
  }

  const universidadesConLink = universidades.filter((u) => LINKS_MISPROFES[u]);
  if (universidadesConLink.length > 0) {
    const filaLinks = document.createElement("div");
    filaLinks.className = "row";
    filaLinks.style.gap = "8px";
    universidadesConLink.forEach((u) => {
      const a = document.createElement("a");
      a.href = LINKS_MISPROFES[u];
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.className = "btn btn-secondary";
      a.style.flex = "1";
      a.style.textAlign = "center";
      a.textContent = `Buscar en MisProfes ${u}`;
      a.addEventListener("click", (e) => e.stopPropagation());
      filaLinks.appendChild(a);
    });
    card.appendChild(filaLinks);
  }

  const historial = obtenerHistorialProfesor(profesor.id, datos);
  const bloqueHistorial = document.createElement("div");
  bloqueHistorial.className = "stack";
  bloqueHistorial.style.gap = "4px";
  if (historial.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.margin = "0";
    p.textContent = "Todavía no lo vinculaste a ninguna materia tuya.";
    bloqueHistorial.appendChild(p);
  } else {
    historial.forEach(({ semestre, mm }) => {
      const fila = document.createElement("p");
      fila.style.margin = "0";
      const calif = mm.calificacion_profesor != null ? `${mm.calificacion_profesor}/10` : "sin calificar";
      const volveria =
        mm.volveria_a_llevar_profesor === true
          ? "✓ volvería a llevarlo"
          : mm.volveria_a_llevar_profesor === false
          ? "✕ no volvería a llevarlo"
          : "sin contestar";
      fila.innerHTML = `<strong>${escaparHtml(obtenerNombreMateria(mm))}</strong> <span class="muted">— ${escaparHtml(
        semestre.nombre
      )} · ${calif} · ${volveria}</span>`;
      bloqueHistorial.appendChild(fila);
    });
  }
  card.appendChild(bloqueHistorial);

  const filaAcciones = document.createElement("div");
  filaAcciones.className = "row";
  filaAcciones.style.gap = "8px";

  const btnVincular = document.createElement("button");
  btnVincular.type = "button";
  btnVincular.className = "btn btn-secondary";
  btnVincular.style.flex = "1";
  btnVincular.textContent = "Vincular a una materia tuya";
  btnVincular.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalVincularProfesor(profesor);
  });
  filaAcciones.appendChild(btnVincular);

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn btn-secondary";
  btnEditar.textContent = "Editar";
  btnEditar.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalAltaProfesor(profesor);
  });
  filaAcciones.appendChild(btnEditar);

  const btnBorrar = document.createElement("button");
  btnBorrar.type = "button";
  btnBorrar.className = "btn btn-secondary";
  btnBorrar.textContent = "Eliminar";
  btnBorrar.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirConfirmacionBorrarProfesor(profesor);
  });
  filaAcciones.appendChild(btnBorrar);

  card.appendChild(filaAcciones);

  return card;
}

function construirTarjetaCompanero(companero) {
  const recomendado = companero.lista !== "blacklist";

  const card = document.createElement("div");
  card.className = "glass-panel stack";
  card.style.gap = "4px";

  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";
  encabezado.innerHTML = `
    <strong>${escaparHtml(companero.nombre_completo)}</strong>
    <span class="muted" style="font-size:11px; white-space:nowrap;">${recomendado ? "✓ Recomendado" : "✕ No recomendado"}</span>
  `;
  card.appendChild(encabezado);

  const datosContacto = [companero.carnet, companero.telefono].filter(Boolean);
  if (datosContacto.length > 0) {
    const contacto = document.createElement("p");
    contacto.className = "muted";
    contacto.style.margin = "0";
    contacto.textContent = datosContacto.join(" · ");
    card.appendChild(contacto);
  }

  if (companero.nota) {
    const nota = document.createElement("p");
    nota.style.margin = "0";
    nota.textContent = companero.nota;
    card.appendChild(nota);
  }

  return card;
}

/* ===================== Modal: alta / edición de profesor ===================== */

function abrirModalAltaProfesor(profesorExistente = null) {
  document.querySelectorAll(".overlay-alta-profesor").forEach((el) => el.remove());
  const esEdicion = !!profesorExistente;

  const overlay = document.createElement("div");
  overlay.className = "overlay-alta-profesor";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  // Mismo patrón "sucio" que abrirModalAltaSemestre: tocar fuera sin datos
  // cambiados cierra directo, con datos cambiados pide confirmar.
  let sucio = false;
  caja.addEventListener("input", () => {
    sucio = true;
  });

  function cerrar() {
    if (!sucio) {
      overlay.remove();
      return;
    }
    abrirConfirmacion({
      titulo: "¿Cerrar sin guardar?",
      mensaje: `Vas a perder los datos que ingresaste para ${esEdicion ? "este profesor" : "el nuevo profesor"}.`,
      textoConfirmar: "Cerrar sin guardar",
      onConfirmar: () => overlay.remove(),
    });
  }

  caja.innerHTML = `<h2 style="margin:0;">${esEdicion ? "Editar profesor" : "Agregar profesor"}</h2>`;

  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Nombre completo";
  inputNombre.value = esEdicion ? profesorExistente.nombre : "";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  const bloqueCorreo = document.createElement("div");
  bloqueCorreo.innerHTML = `<span class="form-label">Correo (opcional)</span>`;
  const inputCorreo = document.createElement("input");
  inputCorreo.type = "email";
  inputCorreo.className = "form-input";
  inputCorreo.placeholder = "nombre@correo.com";
  inputCorreo.value = esEdicion ? profesorExistente.correo || "" : "";
  bloqueCorreo.appendChild(inputCorreo);
  caja.appendChild(bloqueCorreo);

  const bloqueTelefono = document.createElement("div");
  bloqueTelefono.innerHTML = `<span class="form-label">Teléfono (opcional)</span>`;
  const inputTelefono = document.createElement("input");
  inputTelefono.type = "tel";
  inputTelefono.className = "form-input";
  inputTelefono.placeholder = "8888-8888";
  inputTelefono.value = esEdicion ? profesorExistente.telefono || "" : "";
  bloqueTelefono.appendChild(inputTelefono);
  caja.appendChild(bloqueTelefono);

  const bloqueMaterias = document.createElement("div");
  bloqueMaterias.innerHTML = `<span class="form-label">Materias que da (opcional, de referencia general)</span>`;
  const filaTagInput = document.createElement("div");
  filaTagInput.className = "row";
  filaTagInput.style.gap = "6px";
  const inputTag = document.createElement("input");
  inputTag.type = "text";
  inputTag.className = "form-input";
  inputTag.placeholder = "Ej. Cálculo I";
  inputTag.style.flex = "1";
  const btnAgregarTag = document.createElement("button");
  btnAgregarTag.type = "button";
  btnAgregarTag.className = "btn btn-secondary";
  btnAgregarTag.textContent = "+";
  const contenedorTags = document.createElement("div");
  contenedorTags.style.cssText = "display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;";

  const materiasTags = esEdicion ? [...(profesorExistente.materias || [])] : [];

  function repintarTags() {
    contenedorTags.innerHTML = "";
    materiasTags.forEach((tag, i) => {
      const chip = document.createElement("span");
      chip.className = "pill-item active";
      chip.style.cssText = "display:inline-flex; align-items:center; gap:6px; cursor:default;";
      chip.textContent = tag;
      const btnX = document.createElement("button");
      btnX.type = "button";
      btnX.textContent = "✕";
      btnX.setAttribute("aria-label", "Quitar");
      btnX.style.cssText = "background:none; border:none; color:inherit; cursor:pointer; font-size:11px; padding:0;";
      btnX.addEventListener("click", () => {
        materiasTags.splice(i, 1);
        sucio = true;
        repintarTags();
      });
      chip.appendChild(btnX);
      contenedorTags.appendChild(chip);
    });
  }
  repintarTags();

  function agregarTag() {
    const valor = inputTag.value.trim();
    if (!valor) return;
    materiasTags.push(valor);
    inputTag.value = "";
    sucio = true;
    repintarTags();
  }
  btnAgregarTag.addEventListener("click", agregarTag);
  inputTag.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      agregarTag();
    }
  });

  filaTagInput.appendChild(inputTag);
  filaTagInput.appendChild(btnAgregarTag);
  bloqueMaterias.appendChild(filaTagInput);
  bloqueMaterias.appendChild(contenedorTags);
  caja.appendChild(bloqueMaterias);

  const error = document.createElement("p");
  error.className = "muted oculto";
  error.style.color = "var(--color-danger)";
  caja.appendChild(error);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.justifyContent = "flex-end";
  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = esEdicion ? "Guardar cambios" : "Guardar";
  btnGuardar.addEventListener("click", () => {
    const nombre = inputNombre.value.trim();
    if (!nombre) {
      error.textContent = "El nombre es obligatorio.";
      error.classList.remove("oculto");
      return;
    }
    const correo = inputCorreo.value.trim();
    const telefono = inputTelefono.value.trim();

    if (esEdicion) {
      const vivo = buscarProfesorVivoPorId(profesorExistente.id);
      if (!vivo) {
        mostrarToast("Este profesor se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        renderizarComunidad();
        return;
      }
      vivo.nombre = nombre;
      vivo.correo = correo || null;
      vivo.telefono = telefono || null;
      vivo.materias = [...materiasTags];
      sellarTimestamp(vivo);
    } else {
      estado.datos.profesores = estado.datos.profesores || [];
      estado.datos.profesores.push(crearProfesor({ nombre, correo, telefono, materias: materiasTags }));
    }
    marcarCambioPendiente();
    overlay.remove();
    renderizarComunidad();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !sucio) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/* ===================== Modal: vincular profesor a una materia tuya ===================== */

function abrirModalVincularProfesor(profesor) {
  document.querySelectorAll(".overlay-vincular-profesor").forEach((el) => el.remove());

  const semestres = [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];

  const overlay = document.createElement("div");
  overlay.className = "overlay-vincular-profesor";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  caja.innerHTML = `<h2 style="margin:0;">Vincular a una materia tuya</h2><p class="muted" style="margin:0;">${escaparHtml(
    profesor.nombre
  )}</p>`;

  if (semestres.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent = "Todavía no tenés ningún semestre registrado.";
    caja.appendChild(vacio);
    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.className = "btn btn-secondary btn-block";
    btnCerrar.textContent = "Cerrar";
    btnCerrar.addEventListener("click", () => overlay.remove());
    caja.appendChild(btnCerrar);
    overlay.appendChild(caja);
    document.body.appendChild(overlay);
    return;
  }

  let sucio = false;
  let mmSeleccionadaId = null;
  let volveriaValor = null; // true | false | null

  function cerrar() {
    if (!sucio) {
      overlay.remove();
      return;
    }
    abrirConfirmacion({
      titulo: "¿Cerrar sin guardar?",
      mensaje: "Vas a perder la vinculación que estabas armando.",
      textoConfirmar: "Cerrar sin guardar",
      onConfirmar: () => overlay.remove(),
    });
  }

  const bloqueSemestre = document.createElement("div");
  bloqueSemestre.innerHTML = `<span class="form-label">Semestre</span>`;
  const selectSemestre = document.createElement("select");
  selectSemestre.className = "form-input";
  semestres.forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s.id;
    opt.textContent = s.nombre;
    selectSemestre.appendChild(opt);
  });
  bloqueSemestre.appendChild(selectSemestre);
  caja.appendChild(bloqueSemestre);

  const bloqueMateria = document.createElement("div");
  bloqueMateria.innerHTML = `<span class="form-label">Materia</span>`;
  const contenedorMaterias = document.createElement("div");
  contenedorMaterias.style.cssText = "display:flex; flex-direction:column; gap:6px;";
  bloqueMateria.appendChild(contenedorMaterias);
  caja.appendChild(bloqueMateria);

  const bloqueCalificacion = document.createElement("div");
  bloqueCalificacion.innerHTML = `<span class="form-label">Calificación (1-10, opcional)</span>`;
  const inputCalificacion = document.createElement("input");
  inputCalificacion.type = "number";
  inputCalificacion.className = "form-input";
  inputCalificacion.min = "1";
  inputCalificacion.max = "10";
  inputCalificacion.step = "0.1";
  inputCalificacion.placeholder = "Ej. 8.5";
  inputCalificacion.addEventListener("input", () => {
    sucio = true;
  });
  bloqueCalificacion.appendChild(inputCalificacion);
  caja.appendChild(bloqueCalificacion);

  const bloqueVolveria = document.createElement("div");
  bloqueVolveria.innerHTML = `<span class="form-label">¿Volverías a llevarlo?</span>`;
  const contenedorVolveria = document.createElement("div");
  function repintarVolveria() {
    contenedorVolveria.innerHTML = "";
    contenedorVolveria.appendChild(
      construirGrupoPills(
        [
          { valor: "si", texto: "Sí" },
          { valor: "no", texto: "No" },
          { valor: "sin-contestar", texto: "Sin contestar" },
        ],
        volveriaValor === true ? "si" : volveriaValor === false ? "no" : "sin-contestar",
        (valor) => {
          volveriaValor = valor === "si" ? true : valor === "no" ? false : null;
          sucio = true;
          repintarVolveria();
        }
      )
    );
  }
  repintarVolveria();
  bloqueVolveria.appendChild(contenedorVolveria);
  caja.appendChild(bloqueVolveria);

  function repintarMaterias(semestreId) {
    contenedorMaterias.innerHTML = "";
    const semestre = semestres.find((s) => s.id === semestreId);
    const mms = (semestre && semestre.materias_matriculadas) || [];
    if (mms.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.textContent = "Este semestre no tiene materias matriculadas.";
      contenedorMaterias.appendChild(p);
      mmSeleccionadaId = null;
      return;
    }
    mms.forEach((mm) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (mmSeleccionadaId === mm.id ? " active" : "");
      btn.style.cssText = "text-align:left; width:100%;";
      const yaConOtro = mm.profesor_id && mm.profesor_id !== profesor.id;
      const yaConEste = mm.profesor_id === profesor.id;
      btn.textContent = obtenerNombreMateria(mm) + (yaConOtro ? " (ya tiene otro profesor)" : yaConEste ? " (ya vinculada a este)" : "");
      btn.addEventListener("click", () => {
        mmSeleccionadaId = mm.id;
        sucio = true;
        if (yaConEste) {
          inputCalificacion.value = mm.calificacion_profesor != null ? mm.calificacion_profesor : "";
          volveriaValor = mm.volveria_a_llevar_profesor;
        } else {
          inputCalificacion.value = "";
          volveriaValor = null;
        }
        repintarVolveria();
        repintarMaterias(semestreId);
      });
      contenedorMaterias.appendChild(btn);
    });
  }
  repintarMaterias(selectSemestre.value);
  selectSemestre.addEventListener("change", () => {
    mmSeleccionadaId = null;
    sucio = true;
    repintarMaterias(selectSemestre.value);
  });

  const error = document.createElement("p");
  error.className = "muted oculto";
  error.style.color = "var(--color-danger)";
  caja.appendChild(error);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.justifyContent = "flex-end";
  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = "Guardar";
  btnGuardar.addEventListener("click", () => {
    if (!mmSeleccionadaId) {
      error.textContent = "Elegí una materia.";
      error.classList.remove("oculto");
      return;
    }
    const encontrada = buscarMmVivaPorId(mmSeleccionadaId);
    if (!encontrada) {
      mostrarToast("Esa materia matriculada ya no existe — no se pudo vincular");
      overlay.remove();
      renderizarComunidad();
      return;
    }
    const crudo = inputCalificacion.value.trim();
    let calificacion = null;
    if (crudo !== "") {
      const numero = Number(crudo);
      calificacion = Number.isNaN(numero) ? null : Math.min(10, Math.max(1, numero));
    }
    encontrada.mm.profesor_id = profesor.id;
    encontrada.mm.calificacion_profesor = calificacion;
    encontrada.mm.volveria_a_llevar_profesor = volveriaValor;
    sellarTimestamp(encontrada.mm);
    marcarCambioPendiente();
    overlay.remove();
    renderizarComunidad();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && !sucio) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/* ===================== Borrar profesor ===================== */

function abrirConfirmacionBorrarProfesor(profesor) {
  abrirConfirmacion({
    titulo: "Eliminar profesor",
    mensaje: `¿Seguro que querés eliminar a "${profesor.nombre}"? Se borra también su vínculo con las materias que le hayas asignado (la calificación y el "volvería a llevarlo" de esas materias se pierden).`,
    textoConfirmar: "Eliminar definitivamente",
    onConfirmar: () => {
      // Limpieza defensiva (regla obligatoria de sincronización): ninguna
      // materia_matriculada debe quedar apuntando a un profesor_id que ya
      // no existe — mismo criterio que ya usa obtenerMateriasCompartidasValidas
      // para materias_compartidas huérfanas, pero acá se limpia de una vez
      // en vez de solo filtrarse al renderizar (el link es 1 a 1, no una lista).
      (estado.datos.semestres || []).forEach((semestre) => {
        (semestre.materias_matriculadas || []).forEach((mm) => {
          if (mm.profesor_id === profesor.id) {
            mm.profesor_id = null;
            mm.calificacion_profesor = null;
            mm.volveria_a_llevar_profesor = null;
            sellarTimestamp(mm);
          }
        });
      });
      estado.datos.profesores = (estado.datos.profesores || []).filter((p) => p.id !== profesor.id);
      estado.datos._eliminados_profesores = estado.datos._eliminados_profesores || [];
      estado.datos._eliminados_profesores.push({ id: profesor.id, eliminadoEn: Date.now() });
      estado.profesoresExpandidos.delete(profesor.id);
      marcarCambioPendiente();
      renderizarComunidad();
    },
  });
}

/* ===================== Secciones por tab ===================== */

function construirSeccionProfesores() {
  const datos = estado.datos;
  const seccion = document.createElement("section");
  seccion.className = "glass-card stack";

  seccion.appendChild(
    construirGrupoPills(
      [
        { valor: "todos", texto: "Todos" },
        { valor: "tuyos", texto: "Tuyos" },
        { valor: "no-tuyos", texto: "No tuyos" },
      ],
      estado.filtroComunidadProfesores,
      (valor) => {
        estado.filtroComunidadProfesores = valor;
        renderizarComunidad();
      }
    )
  );

  const todos = datos.profesores || [];
  const filtrados = todos
    .filter((p) => {
      if (estado.filtroComunidadProfesores === "todos") return true;
      const tuyo = esProfesorTuyo(p, datos);
      return estado.filtroComunidadProfesores === "tuyos" ? tuyo : !tuyo;
    })
    .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));

  if (filtrados.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent =
      todos.length === 0 ? "Todavía no tenés ningún profesor registrado." : "No hay profesores que coincidan con el filtro.";
    seccion.appendChild(vacio);
  } else {
    filtrados.forEach((p) => seccion.appendChild(construirTarjetaProfesor(p, datos)));
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary btn-block";
  btnAgregar.textContent = "+ Agregar profesor";
  btnAgregar.addEventListener("click", () => abrirModalAltaProfesor());
  seccion.appendChild(btnAgregar);

  return seccion;
}

function construirSeccionCompaneros() {
  const datos = estado.datos;
  const seccion = document.createElement("section");
  seccion.className = "glass-card stack";

  seccion.appendChild(
    construirGrupoPills(
      [
        { valor: "todos", texto: "Todos" },
        { valor: "recomendados", texto: "Recomendados" },
        { valor: "no-recomendados", texto: "No recomendados" },
      ],
      estado.filtroComunidadCompaneros,
      (valor) => {
        estado.filtroComunidadCompaneros = valor;
        renderizarComunidad();
      }
    )
  );

  const todos = datos.companeros || [];
  const filtrados = todos
    .filter((c) => {
      if (estado.filtroComunidadCompaneros === "todos") return true;
      const recomendado = c.lista !== "blacklist";
      return estado.filtroComunidadCompaneros === "recomendados" ? recomendado : !recomendado;
    })
    .sort((a, b) => a.nombre_completo.localeCompare(b.nombre_completo, "es"));

  if (filtrados.length === 0) {
    const vacio = document.createElement("p");
    vacio.className = "muted";
    vacio.textContent =
      todos.length === 0 ? "Todavía no tenés ningún compañero registrado." : "No hay compañeros que coincidan con el filtro.";
    seccion.appendChild(vacio);
  } else {
    filtrados.forEach((c) => seccion.appendChild(construirTarjetaCompanero(c)));
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary btn-block";
  btnAgregar.textContent = "+ Agregar compañero";
  // TODO (siguiente parte de Comunidad): abrir el modal de alta real.
  btnAgregar.addEventListener("click", () => mostrarToast("El alta de compañeros viene en la próxima parte 🙂"));
  seccion.appendChild(btnAgregar);

  return seccion;
}

/* ===================== Entrada pública ===================== */

/**
 * Se llama UNA vez al arranque (main.js, ANTES de un posible mostrarApp()
 * por caché — ver comentario ahí) para dejar el contenedor de la sección
 * listo. #seccion-comunidad ya viene en index.html (mismo patrón que
 * #seccion-plan-estudios / #seccion-semestres, JS lo llena), así que acá no
 * hace falta crear ningún nodo.
 */
function inicializarComunidad() {
  const cont = document.getElementById("seccion-comunidad");
  if (!cont) {
    console.warn("Comunidad: no se encontró #seccion-comunidad en el HTML.");
  }
}

/**
 * Reconstruye #seccion-comunidad COMPLETO cada vez que se llama — mismo
 * patrón que renderizarSemestres/renderizarPlanEstudios. Requiere
 * estado.datos ya cargado (se llama desde mostrarApp() en main.js, después
 * del login/caché — nunca antes).
 */
function renderizarComunidad() {
  const cont = document.getElementById("seccion-comunidad");
  if (!cont || !estado.datos) return;

  cont.innerHTML = "";

  const encabezado = document.createElement("section");
  encabezado.className = "glass-card stack";
  encabezado.innerHTML = `
    <h2 style="margin:0;">Comunidad</h2>
    <p class="muted" style="margin:0;">Profesores y compañeros con los que compartiste clase.</p>
  `;
  encabezado.appendChild(
    construirGrupoPills(
      [
        { valor: "profesores", texto: "👨‍🏫 Profesores" },
        { valor: "companeros", texto: "🧑‍🎓 Compañeros" },
      ],
      estado.tabComunidad,
      (valor) => {
        estado.tabComunidad = valor;
        renderizarComunidad();
      }
    )
  );
  cont.appendChild(encabezado);

  cont.appendChild(estado.tabComunidad === "companeros" ? construirSeccionCompaneros() : construirSeccionProfesores());
}

export { inicializarComunidad, renderizarComunidad };
