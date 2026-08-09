/* =========================================================================
   COMUNIDAD — Parte 3a (esqueleto)
   Responsable de: la sección #seccion-comunidad completa — tabs Profesores /
   Compañeros, filtros ("tuyos"/"no tuyos" y "recomendados"/"no recomendados")
   y el listado real de datos.profesores / datos.companeros.

   Todavía NO incluye (a propósito — siguiente parte de este mismo módulo):
   - Modal de alta/edición de profesor (nombre, materias, correo, teléfono).
   - Modal de alta/edición de compañero (nombre, carnet, teléfono —
     con opción de importar desde los contactos del dispositivo, solo como
     atajo puntual al llenar el formulario).
   - Selector semestre → materia para vincular un profesor a una
     materia_matriculada concreta (con su calificación 1-10 y "¿volvería a
     llevar?"), y el link directo a MisProfesTEC/MisProfesUCR.
   - Borrar / modo edición (mismo patrón que alternarModoEdicionSemestres).
   Los botones "+ Agregar..." de abajo ya están en su lugar final pero por
   ahora solo avisan que la función viene en la siguiente parte.
   ========================================================================= */

import { obtenerHistorialProfesor, obtenerUniversidadesDeProfesor } from "../core/schema.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";

// Transitorio (no persistido, no sincronizado) — mismo patrón que
// estado.modoEdicionSemestres en semestres.js: vive en memoria, se resetea
// solo al recargar la página.
estado.tabComunidad = "profesores"; // "profesores" | "companeros"
estado.filtroComunidadProfesores = "todos"; // "todos" | "tuyos" | "no-tuyos"
estado.filtroComunidadCompaneros = "todos"; // "todos" | "recomendados" | "no-recomendados"

/* ===================== Helpers de datos ===================== */

/** "Tuyo" = tiene al menos una vinculación real a una materia_matriculada de
 *  TUS semestres (ver obtenerHistorialProfesor en schema.js) — no es un flag
 *  manual, se deriva solo de si vos lo vinculaste alguna vez a una materia. */
function esProfesorTuyo(profesor, datos) {
  return obtenerHistorialProfesor(profesor.id, datos).length > 0;
}

/* ===================== Tarjetas ===================== */

function construirTarjetaProfesor(profesor, datos) {
  const tuyo = esProfesorTuyo(profesor, datos);
  const universidades = obtenerUniversidadesDeProfesor(profesor.id, datos);

  const card = document.createElement("div");
  card.className = "glass-panel stack";
  card.style.gap = "4px";

  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";
  encabezado.innerHTML = `
    <strong>${profesor.nombre}</strong>
    ${tuyo ? '<span class="badge-warning" style="font-size:11px; white-space:nowrap;">Tuyo</span>' : ""}
  `;
  card.appendChild(encabezado);

  const datosContacto = [profesor.correo, profesor.telefono].filter(Boolean);
  if (datosContacto.length > 0) {
    const contacto = document.createElement("p");
    contacto.className = "muted";
    contacto.style.margin = "0";
    contacto.textContent = datosContacto.join(" · ");
    card.appendChild(contacto);
  }

  if (universidades.length > 0) {
    const uniLinea = document.createElement("p");
    uniLinea.className = "muted";
    uniLinea.style.margin = "0";
    uniLinea.textContent = universidades.join(" · ");
    card.appendChild(uniLinea);
  }

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
    <strong>${companero.nombre_completo}</strong>
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
  // TODO (siguiente parte de Comunidad): abrir el modal de alta real.
  btnAgregar.addEventListener("click", () => mostrarToast("El alta de profesores viene en la próxima parte 🙂"));
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
 * listo. Por ahora #seccion-comunidad ya viene en index.html (mismo patrón
 * que #seccion-plan-estudios / #seccion-semestres, JS lo llena), así que acá
 * no hace falta crear ningún nodo — se deja la función igual porque la
 * siguiente parte (modales de alta) sí necesita engancharse acá, antes de
 * inicializarBotonesCerrarModal(), para que el botón "✕" automático los
 * encuentre.
 */
function inicializarComunidad() {
  const cont = document.getElementById("seccion-comunidad");
  if (!cont) {
    console.warn("Comunidad: no se encontró #seccion-comunidad en el HTML.");
  }
}

/**
 * Reconstruye #seccion-comunidad COMPLETO cada vez que se llama — mismo
 * patrón que renderizarSemestres/renderizarPlanEstudios (ver comentario ahí
 * sobre por qué es una reconstrucción total y no un parche incremental).
 * Requiere estado.datos ya cargado (se llama desde mostrarApp() en main.js,
 * después del login/caché — nunca antes).
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
