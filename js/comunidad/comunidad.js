/* =========================================================================
   COMUNIDAD — Parte 3d (Profesores rediseñados + Compañeros)
   Responsable de: la sección #seccion-comunidad completa.

   PROFESORES — rediseño (2026-08-08, pedido explícito):
   - Tarjeta colapsada: SOLO Nombre · Estrellas (centradas) · badge
     Recomendado/No recomendado (ancla derecha) · flecha ▼/▲. Ya no hay
     badge "Tuyo" (el filtro Tuyo/No tuyo sigue existiendo, solo se quitó
     el badge visual de la tarjeta).
   - La calificación 1-10 (con medias estrellas) y "¿volverías a
     llevarlo?" (mostrado como Recomendado/No recomendado, badge verde/
     rojo) DEJARON de vivir por vinculación materia+semestre — ahora son
     UNA sola calificación general del profesor, se editan desde el modal
     de alta/edición.
   - Tarjeta expandida: mini-tarjetas de cada vinculación materia+semestre
     (barra de categoría a la izquierda + nombre de la materia + badge de
     semestre anclado al final), luego una fila con 3 elementos que
     reparten TODO el ancho disponible: logo MisProfes (según la
     universidad de la materia vinculada) · Editar · Eliminar.
   - Vincular materias pasa a vivir DENTRO del modal de Editar (ya no hay
     botón "Vincular a una materia tuya" en la tarjeta) — ahí mismo se
     reemplaza el viejo campo de tags de materias por un botón que abre el
     selector de semestre → materias (mismo lenguaje visual que el
     selector de escala en Ajustes: dropdown propio, no <select> nativo).
   - Universidad (TEC/UCR) se sigue heredando de la materia vinculada
     dentro de semestres → arma el link directo a MisProfes, ahora como
     imagen (imagenes/MisProfes.png) en vez de texto, sin deformar su
     relación de aspecto.

   COMPAÑEROS (sin cambios en esta ronda):
   - Alta / edición (nombre, carné, teléfono —con importar opcional desde
     los contactos del dispositivo vía Contacts Picker API, solo si el
     navegador lo soporta—, switch Recomendado/No recomendado, nota libre).
   - Tarjeta expandible: contacto, nota, materias compartidas vinculadas,
     botones Vincular materia compartida / Editar / Eliminar.
   - "Vincular materia compartida": a diferencia de profesores (vínculo
     1 a 1 por materia+semestre), acá un compañero puede compartir VARIAS
     materias — el modal deja marcar/desmarcar varias de un semestre y
     persiste todo junto al tocar "Listo".
   - Eliminar un compañero no requiere limpieza en otro lado: sus materias
     compartidas viven adentro del propio registro, no hay ningún mm que
     apunte de vuelta a él.
   ========================================================================= */

import {
  crearCompanero,
  crearProfesor,
  obtenerHistorialProfesor,
  obtenerMateriasCompartidasValidas,
  obtenerUniversidadesDeProfesor,
  sellarTimestamp,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { estiloBadgeCategoria } from "../core/utils.js";
import { abrirConfirmacion, mostrarToast } from "../ui/componentes.js";
import { obtenerSemestresActuales, obtenerSemestresPasados } from "../semestres/semestres.js";

// Transitorio (no persistido, no sincronizado) — mismo patrón que
// estado.modoEdicionSemestres en semestres.js: vive en memoria, se resetea
// solo al recargar la página.
estado.tabComunidad = "profesores"; // "profesores" | "companeros"
estado.filtroComunidadProfesores = "todos"; // "todos" | "tuyos" | "no-tuyos"
estado.filtroComunidadCompaneros = "todos"; // "todos" | "recomendados" | "no-recomendados"
estado.profesoresExpandidos = estado.profesoresExpandidos || new Set(); // ids con la tarjeta abierta
estado.companerosExpandidos = estado.companerosExpandidos || new Set(); // ids con la tarjeta abierta

// Escuela completa en misprofesores.com (no un profesor puntual — pedido
// explícito: los profesores suelen estar duplicados/mal cargados ahí, así
// que el link lleva a la escuela y el usuario busca a mano desde ahí).
const LINKS_MISPROFES = {
  TEC: "https://costarica.misprofesores.com/escuelas/ITCR-Instituto-Tecnologico-de-Costa-Rica_1135",
  UCR: "https://costarica.misprofesores.com/escuelas/UCR-Universidad-de-Costa-Rica_1126",
};

// Rediseño: el botón de "ir a MisProfes" ahora es la imagen del logo de la
// página (imagenes/MisProfes.png, misma carpeta que el resto de assets de
// la app — ver imagenes/LogoApp.png en index.html) en vez de texto — pedido
// explícito de no deformar su relación de aspecto (ver <img> más abajo,
// sin width/height fijos por separado, solo height + width:auto).
const RUTA_LOGO_MISPROFES = "imagenes/MisProfes.png";

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

/** Igual que obtenerNombreMateria, pero además devuelve la materia y el
 *  plan (para leer categoria_id/color y universidad) — evita repetir la
 *  misma búsqueda dos veces en las mini-tarjetas nuevas. */
function obtenerContextoMateria(mm) {
  const plan = obtenerPlanPorId(mm.plan_estudio_id);
  const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
  return { plan, materia };
}

function buscarProfesorVivoPorId(id) {
  return (estado.datos.profesores || []).find((p) => p.id === id) || null;
}

function buscarCompaneroVivoPorId(id) {
  return (estado.datos.companeros || []).find((c) => c.id === id) || null;
}

/** Contacts Picker API (navigator.contacts) — soporte limitado, en la
 *  práctica solo Chrome/Edge en Android con gesto del usuario. Es a
 *  propósito una opción más, nunca la base de datos: si no está disponible
 *  o el usuario cancela, el formulario sigue siendo 100% editable a mano. */
function contactsPickerDisponible() {
  return typeof navigator !== "undefined" && "contacts" in navigator && typeof window !== "undefined" && "ContactsManager" in window;
}

/** Abre el picker nativo, y si el usuario elige un contacto, rellena
 *  inputTelefono (y inputNombre solo si venía vacío, para no pisar un
 *  nombre que la persona ya haya escrito a mano). Dispara "input" a mano
 *  en los campos tocados para que el modal los marque como "sucio" — mismo
 *  mecanismo que usa el resto del formulario. */
async function importarContactoTelefono(inputTelefono, inputNombre) {
  if (!contactsPickerDisponible()) {
    mostrarToast("Tu navegador no soporta importar contactos acá — escribilo a mano.");
    return;
  }
  try {
    const propiedadesSoportadas = await navigator.contacts.getProperties();
    const propiedades = ["name", "tel"].filter((p) => propiedadesSoportadas.includes(p));
    if (!propiedades.includes("tel")) {
      mostrarToast("Tu navegador no comparte el teléfono de los contactos.");
      return;
    }
    const seleccion = await navigator.contacts.select(propiedades, { multiple: false });
    if (!seleccion || seleccion.length === 0) return; // el usuario cerró el picker sin elegir nada
    const contacto = seleccion[0];
    if (contacto.tel && contacto.tel.length > 0) {
      inputTelefono.value = contacto.tel[0];
      inputTelefono.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (inputNombre && !inputNombre.value.trim() && contacto.name && contacto.name.length > 0) {
      inputNombre.value = contacto.name[0];
      inputNombre.dispatchEvent(new Event("input", { bubbles: true }));
    }
  } catch (e) {
    // AbortError = el usuario canceló el picker a propósito, no es un error real.
    if (e && e.name !== "AbortError") {
      console.warn("Comunidad: no se pudo importar el contacto:", e);
      mostrarToast("No se pudo importar el contacto.");
    }
  }
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
 *  manual, se deriva solo de si vos lo vinculaste alguna vez a una materia.
 *  El filtro sigue existiendo (pedido explícito: "quita el badge, deja el
 *  filtro"), solo se quitó el badge visual de la tarjeta. */
function esProfesorTuyo(profesor, datos) {
  return obtenerHistorialProfesor(profesor.id, datos).length > 0;
}

/* ===================== Estrellas (calificación 1-10, medias estrellas) ===================== */

/**
 * Rediseño: calificación general del profesor, 1-10 con medias estrellas,
 * mostrada como 5 estrellas visuales (cada estrella = 2 puntos). Amarillas
 * (pedido explícito) — se fija el color a mano en vez de usar --accent-1,
 * porque en varias paletas el acento no es amarillo y "estrella" como
 * símbolo universal de calificación se espera dorado/amarillo sin importar
 * la paleta activa de la app.
 */
const COLOR_ESTRELLA = "#FBBF24";
const COLOR_ESTRELLA_VACIA = "rgba(255,255,255,0.18)";

/** Construye el SVG de una estrella, rellena en la fracción indicada
 *  (0, 0.5 o 1) usando un <linearGradient> con paradas duras — mismo truco
 *  estándar para "media estrella" sin necesitar dos capas superpuestas.
 *  `tamano` en px (default 18, el usado en las tarjetas de lectura). */
function construirSvgEstrella(fraccion, idUnico, tamano = 18) {
  const pct = Math.round(Math.max(0, Math.min(1, fraccion)) * 100);
  const puntosPoligono = "10,1 12.6,6.9 19,7.6 14.2,11.9 15.6,18.2 10,14.9 4.4,18.2 5.8,11.9 1,7.6 7.4,6.9";
  const alto = Math.round(tamano * 0.95); // mismo ratio que 18/19 del viewBox original
  return `
    <svg viewBox="0 0 20 19" width="${tamano}" height="${alto}" aria-hidden="true">
      <defs>
        <linearGradient id="${idUnico}">
          <stop offset="${pct}%" stop-color="${COLOR_ESTRELLA}"></stop>
          <stop offset="${pct}%" stop-color="${COLOR_ESTRELLA_VACIA}"></stop>
        </linearGradient>
      </defs>
      <polygon points="${puntosPoligono}" fill="url(#${idUnico})"></polygon>
    </svg>
  `;
}

let contadorIdEstrella = 0;

/**
 * Estrellas de SOLO LECTURA (tarjeta colapsada/expandida) — 5 estrellas,
 * cada una representa 2 puntos de la escala 1-10. Siempre centradas
 * (pedido explícito), sin interacción.
 */
function construirEstrellasLectura(calificacion) {
  const cont = document.createElement("span");
  cont.className = "row";
  cont.style.cssText = "gap:2px; justify-content:center; flex-shrink:0;";
  const valor = Number(calificacion) || 0;
  for (let i = 0; i < 5; i++) {
    const fraccionEstrella = Math.max(0, Math.min(1, valor / 2 - i));
    contadorIdEstrella++;
    const span = document.createElement("span");
    span.style.cssText = "display:inline-flex; line-height:0;";
    span.innerHTML = construirSvgEstrella(fraccionEstrella, `estrella-lectura-${contadorIdEstrella}`);
    cont.appendChild(span);
  }
  return cont;
}

/**
 * Estrellas INTERACTIVAS (modal de edición) — clic en la mitad izquierda de
 * una estrella = media (X.5), clic en la mitad derecha = completa (X.0),
 * tal como se pidió. `onCambiar(valor)` se dispara en cada clic; `obtenerValor`
 * permite leer el valor actual desde afuera al guardar.
 *
 * Pedido explícito: "dentro de editar profesor resizea las estrellas un
 * 100%, basicamente el doble de grande" — TAMANO_ESTRELLA_EDITABLE es
 * exactamente el doble del tamaño de las estrellas de solo lectura (18px).
 */
const TAMANO_ESTRELLA_EDITABLE = 36;

function construirEstrellasEditables(valorInicial, onCambiar) {
  let valorActual = Number(valorInicial) || 0;

  const cont = document.createElement("div");
  cont.style.cssText = "display:flex; gap:8px; justify-content:center; padding:6px 0;";

  const estrellas = [];
  for (let i = 0; i < 5; i++) {
    const boton = document.createElement("button");
    boton.type = "button";
    boton.style.cssText = "background:none; border:none; padding:4px; cursor:pointer; line-height:0;";
    boton.setAttribute("aria-label", `Calificar ${i + 1} de 5 estrellas`);

    // Mitad izquierda = X.5, mitad derecha = X.0 en puntos de escala 1-10
    // (cada estrella vale 2 puntos) — se detecta con la posición X del
    // clic dentro del propio botón, sin necesitar dos elementos separados.
    boton.addEventListener("click", (ev) => {
      const rect = boton.getBoundingClientRect();
      const mitadIzquierda = ev.clientX - rect.left < rect.width / 2;
      const base = i * 2; // puntos que ya cubren las estrellas anteriores
      valorActual = mitadIzquierda ? base + 1 : base + 2;
      repintar();
      onCambiar(valorActual);
    });

    cont.appendChild(boton);
    estrellas.push(boton);
  }

  function repintar() {
    estrellas.forEach((boton, i) => {
      const fraccionEstrella = Math.max(0, Math.min(1, valorActual / 2 - i));
      contadorIdEstrella++;
      boton.innerHTML = construirSvgEstrella(fraccionEstrella, `estrella-editable-${contadorIdEstrella}`, TAMANO_ESTRELLA_EDITABLE);
    });
  }
  repintar();

  return { elemento: cont, obtenerValor: () => valorActual, establecerValor: (v) => { valorActual = v; repintar(); } };
}

/* ===================== Selector custom de semestre (mismo patrón que Ajustes) ===================== */

/**
 * Mismo lenguaje visual que el selector de "Escala de notas" en Ajustes
 * (ver config-ajustes.js / .select-custom en design-system.css): un
 * <select> real oculto como única fuente de valor/evento, y un botón +
 * lista propios 100% CSS del tema, reparentados a document.body mientras
 * están abiertos (para no quedar atrapados detrás de otra tarjeta con su
 * propio contexto de apilamiento por backdrop-filter).
 *
 * `opciones` es un arreglo de { valor, etiqueta }. `onCambiar(valor)` se
 * dispara cada vez que se elige una opción distinta a la actual.
 */
function construirSelectorCustom(opciones, valorInicial, onCambiar) {
  const wrap = document.createElement("div");
  wrap.className = "select-custom";

  const selectOculto = document.createElement("select");
  selectOculto.hidden = true;
  selectOculto.setAttribute("aria-hidden", "true");
  selectOculto.tabIndex = -1;
  opciones.forEach((op) => {
    const opt = document.createElement("option");
    opt.value = String(op.valor);
    opt.textContent = op.etiqueta;
    selectOculto.appendChild(opt);
  });
  selectOculto.value = String(valorInicial);

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-input select-custom-boton";
  const opcionInicial = opciones.find((o) => String(o.valor) === String(valorInicial));
  boton.textContent = opcionInicial ? opcionInicial.etiqueta : "Elegir semestre";
  boton.setAttribute("aria-expanded", "false");

  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";

  function posicionarLista() {
    const r = boton.getBoundingClientRect();
    lista.style.position = "fixed";
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
  }
  function cerrarLista() {
    lista.classList.add("oculto");
    boton.setAttribute("aria-expanded", "false");
    if (lista.parentElement === document.body) wrap.appendChild(lista);
    window.removeEventListener("scroll", cerrarSiScrollExterno, true);
    window.removeEventListener("resize", cerrarLista);
  }
  function cerrarSiScrollExterno(e) {
    if (lista.contains(e.target)) return;
    cerrarLista();
  }
  function abrirLista() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== lista) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    lista._volverA = wrap;
    document.body.appendChild(lista);
    posicionarLista();
    lista.classList.remove("oculto");
    boton.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", cerrarSiScrollExterno, true);
    window.addEventListener("resize", cerrarLista);
  }

  function repintarOpciones() {
    lista.innerHTML = "";
    opciones.forEach((op) => {
      const item = document.createElement("li");
      item.className = "select-custom-opcion";
      item.textContent = op.etiqueta;
      if (String(op.valor) === selectOculto.value) item.classList.add("activa");
      item.addEventListener("click", () => {
        const cambio = selectOculto.value !== String(op.valor);
        selectOculto.value = String(op.valor);
        boton.textContent = op.etiqueta;
        lista.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
        item.classList.add("activa");
        cerrarLista();
        if (cambio) onCambiar(op.valor);
      });
      lista.appendChild(item);
    });
  }
  repintarOpciones();

  boton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lista.classList.contains("oculto")) abrirLista();
    else cerrarLista();
  });
  document.addEventListener("click", (e) => {
    if (!wrap.contains(e.target) && !lista.contains(e.target)) cerrarLista();
  });

  wrap.appendChild(boton);
  wrap.appendChild(lista);
  wrap.appendChild(selectOculto);

  return {
    elemento: wrap,
    obtenerValor: () => selectOculto.value,
    // Por si hace falta reconstruir las opciones (no se usa hoy, pero deja
    // la puerta abierta sin tener que rehacer todo el selector).
    actualizarOpciones: (nuevasOpciones) => {
      opciones = nuevasOpciones;
      repintarOpciones();
    },
  };
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

/* ===================== Mini-tarjeta de materia vinculada (profesor) ===================== */

/**
 * Rediseño: reemplaza la línea de texto plano del historial por una
 * mini-tarjeta delgada, ocupando todo el ancho disponible — barra de
 * categoría a la izquierda (mismo patrón que las tarjetas de materia en
 * Semestres: box-shadow inset con el color de la categoría), nombre de la
 * materia vinculada con la tipografía clásica de materias (.materia-nombre,
 * font-display 700), y un badge de semestre anclado al final de la
 * mini-tarjeta.
 */
function construirMiniTarjetaMateriaVinculada(mm, semestre) {
  const { plan, materia } = obtenerContextoMateria(mm);
  const categoria = plan && materia ? plan.categorias.find((c) => c.id === materia.categoria_id) : null;

  const mini = document.createElement("div");
  mini.className = "glass-panel";
  // Pedido explícito: NOTA centrada respecto a TODA la tarjeta (no solo al
  // espacio libre entre nombre y semestre) — con row/flex eso no se puede
  // lograr de verdad porque el ancho de cada extremo es distinto. Con un
  // grid de 3 columnas simétricas (1fr / auto / 1fr) el nombre empuja desde
  // la 1ra 1fr, el badge de semestre empuja desde la 2da 1fr, y la Nota (en
  // la columna del medio, "auto") queda exactamente en el centro geométrico
  // de la tarjeta, sin importar cuánto midan nombre o semestre.
  mini.style.cssText =
    "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px; padding:8px 12px; width:100%; box-sizing:border-box;" +
    (categoria ? ` box-shadow: inset 4px 0 0 0 ${categoria.color};` : "");

  const nombre = document.createElement("span");
  nombre.className = "materia-nombre truncada";
  nombre.style.cssText = "min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:0.85rem; top:0;"; // top:0 anula el ajuste -3px pensado para su contexto original
  nombre.textContent = materia ? materia.nombre : "Materia eliminada";
  mini.appendChild(nombre);

  // Pedido explícito: la NOTA que el estudiante sacó en esa materia
  // (mm.nota_final, el mismo dato que vive y se calcula en Semestres) — no
  // es una calificación del profesor, es el resultado real del estudiante
  // en ese intento puntual. Si esa materia matriculada no tiene nota_final
  // cargada todavía, no se muestra nada (no hay "Nota: —" ni placeholder,
  // se omite el elemento entero — la columna del medio queda vacía y el
  // grid sigue centrando igual al badge de semestre en su propia columna).
  if (mm.nota_final !== null && mm.nota_final !== undefined) {
    const badgeNota = document.createElement("span");
    badgeNota.className = "muted";
    badgeNota.style.cssText = "justify-self:center; flex-shrink:0; white-space:nowrap; font-size:0.78rem;";
    badgeNota.textContent = `Nota: ${mm.nota_final}`;
    mini.appendChild(badgeNota);
  } else {
    // Placeholder vacío para no perder la 2da columna del grid (si no se
    // agrega ningún nodo ahí, el badge de semestre "hereda" la columna del
    // medio y deja de estar anclado a la derecha real de la tarjeta).
    mini.appendChild(document.createElement("span"));
  }

  const badgeSemestre = document.createElement("span");
  badgeSemestre.className = "badge badge-neutral";
  badgeSemestre.style.cssText = "justify-self:end; flex-shrink:0; white-space:nowrap;";
  badgeSemestre.textContent = semestre.nombre;
  mini.appendChild(badgeSemestre);

  return mini;
}

/* ===================== Enlace a MisProfes con copia de nombre ===================== */

/**
 * Pedido explícito: al tocar el logo de MisProfes, primero se copia el
 * nombre del profesor al portapapeles (para pegarlo en el buscador de
 * MisProfes, ya que el link lleva a la escuela completa, no a un profesor
 * puntual — ver LINKS_MISPROFES) y se avisa con un toast; recién 3
 * segundos después se abre la página en una pestaña nueva, dando tiempo a
 * leer el aviso antes de que el foco salte fuera de la app.
 * navigator.clipboard requiere contexto seguro (https/localhost) — si no
 * está disponible (http plano, navegador viejo), se avisa igual y se
 * continúa con la apertura del link sin bloquear el flujo por eso.
 */
function abrirEnlaceMisProfesConAviso(nombreProfesor, url) {
  const avisar = () => mostrarToast(`"${nombreProfesor}" copiado en el portapapeles`);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard
      .writeText(nombreProfesor)
      .then(avisar)
      .catch(() => mostrarToast("No se pudo copiar el nombre — igual te llevamos a MisProfes"));
  } else {
    mostrarToast("No se pudo copiar el nombre — igual te llevamos a MisProfes");
  }
  setTimeout(() => {
    window.open(url, "_blank", "noopener,noreferrer");
  }, 3000);
}

/* ===================== Badges de contacto (correo / WhatsApp) ===================== */

/**
 * Pedido explícito: tap corto = copiar; mantener presionado = ejecutar la
 * acción "fuerte" (abrir el cliente de correo o WhatsApp). Funciona con
 * mouse (desktop) y touch (mobile) — un solo helper para no duplicar la
 * lógica de temporizador en cada badge. `contextmenu` se bloquea porque en
 * mobile un press largo sobre texto suele disparar el menú nativo de
 * "copiar/seleccionar", que taparía nuestro propio flujo.
 */
function adjuntarPressLargo(el, { onTap, onLongPress, umbralMs = 550 }) {
  let temporizador = null;
  let fueLargo = false;

  function iniciar() {
    fueLargo = false;
    temporizador = setTimeout(() => {
      fueLargo = true;
      onLongPress();
    }, umbralMs);
  }
  function soltar() {
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
    if (!fueLargo) onTap();
  }
  function cancelar() {
    if (temporizador) {
      clearTimeout(temporizador);
      temporizador = null;
    }
  }

  el.addEventListener("mousedown", (ev) => {
    ev.stopPropagation();
    iniciar();
  });
  el.addEventListener("mouseup", (ev) => {
    ev.stopPropagation();
    soltar();
  });
  el.addEventListener("mouseleave", cancelar);
  el.addEventListener(
    "touchstart",
    (ev) => {
      ev.stopPropagation();
      iniciar();
    },
    { passive: true }
  );
  el.addEventListener("touchend", (ev) => {
    ev.stopPropagation();
    soltar();
  });
  el.addEventListener("touchcancel", cancelar);
  el.addEventListener("contextmenu", (ev) => ev.preventDefault());
}

/** Copia texto al portapapeles y avisa con un toast (éxito o falla) —
 *  mismo patrón defensivo que abrirEnlaceMisProfesConAviso (clipboard
 *  requiere contexto seguro, no todos los navegadores lo soportan). */
function copiarAlPortapapeles(texto, mensajeExito) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(texto).then(
      () => mostrarToast(mensajeExito),
      () => mostrarToast("No se pudo copiar")
    );
  } else {
    mostrarToast("No se pudo copiar");
  }
}

/** wa.me solo acepta dígitos puros (sin +, espacios, guiones ni
 *  paréntesis) — pedido explícito: la app debe aceptar cualquiera de esos
 *  formatos al escribir el teléfono, así que acá se limpia todo lo que no
 *  sea número justo antes de armar el link. */
function sanitizarTelefonoWhatsapp(telefono) {
  return (telefono || "").replace(/[^\d]/g, "");
}

/** Badge de correo (ancla izquierda, expandida): tap copia el correo,
 *  mantener presionado abre el cliente de correo (mailto:). Sin logo de
 *  terceros — usa un emoji de sobre. Si el profesor no tiene correo
 *  cargado, quien llama a esta función directamente no debe hacerlo (ver
 *  construirTarjetaProfesor, que ya filtra por profesor.correo antes). */
function construirBadgeCorreo(correo) {
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.cssText =
    "background:#1C4BBF; color:#fff; cursor:pointer; user-select:none; -webkit-user-select:none;" +
    " display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  badge.textContent = `✉️ ${correo}`;
  badge.title = "Tocá para copiar · mantené presionado para enviar un correo";
  adjuntarPressLargo(badge, {
    onTap: () => copiarAlPortapapeles(correo, "Correo copiado al portapapeles"),
    onLongPress: () => {
      window.location.href = `mailto:${correo}`;
    },
  });
  return badge;
}

/** Badge de WhatsApp (ancla derecha, expandida): tap copia el número tal
 *  cual está guardado, mantener presionado abre https://wa.me/<dígitos>
 *  (sin logo de terceros — usa un emoji de burbuja de chat). */
function construirBadgeWhatsapp(telefono) {
  const digitos = sanitizarTelefonoWhatsapp(telefono);
  const badge = document.createElement("span");
  badge.className = "badge";
  badge.style.cssText =
    "background:#25D366; color:#fff; cursor:pointer; user-select:none; -webkit-user-select:none;" +
    " display:inline-block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  badge.textContent = `💬 ${telefono}`;
  badge.title = "Tocá para copiar · mantené presionado para abrir WhatsApp";
  adjuntarPressLargo(badge, {
    onTap: () => copiarAlPortapapeles(telefono, "Número copiado al portapapeles"),
    onLongPress: () => {
      if (!digitos) return;
      window.open(`https://wa.me/${digitos}`, "_blank", "noopener,noreferrer");
    },
  });
  return badge;
}

/* ===================== Tarjetas ===================== */

function construirTarjetaProfesor(profesor, datos) {
  const expandido = estado.profesoresExpandidos.has(profesor.id);
  const recomendado = profesor.volveria_a_llevar !== false; // default true (sin badge rojo hasta que se marque explícito que no)

  const card = document.createElement("div");
  card.className = "glass-panel stack";
  card.style.cssText = "gap:6px; cursor:pointer; padding:14px 16px;";

  /* ---------- Colapsada: Nombre · Estrellas (centro REAL de la tarjeta) · Recomendado (der.) · flecha ----------
     Pedido explícito: "las estrellas [...] esten bien centradas con
     respecto a la tarjeta, los demas items ahi estan bien" — con el grid
     de 4 columnas 1fr/auto/auto/auto de antes, la columna de estrellas
     medía solo lo que las estrellas ocupan y quedaba corrida hacia la
     izquierda (su "centro" no era el centro de la tarjeta, sino el centro
     de esa columna angosta). Ahora es un grid de 3 columnas simétricas
     (1fr / auto / 1fr): nombre a la izquierda empujado por la 1ra 1fr,
     estrellas en la columna del medio (su ancho natural, sin crecer),
     badge+flecha agrupados a la derecha empujados por la 2da 1fr — con
     las dos columnas 1fr midiendo lo mismo, el centro de "estrellas" cae
     exactamente en el centro geométrico de la tarjeta. */
  const encabezado = document.createElement("div");
  encabezado.style.cssText = "display:grid; grid-template-columns:1fr auto 1fr; align-items:center; gap:10px;";

  const nombre = document.createElement("strong");
  nombre.style.cssText = "min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;";
  nombre.textContent = profesor.nombre;
  encabezado.appendChild(nombre);

  encabezado.appendChild(construirEstrellasLectura(profesor.calificacion));

  const derechaEncabezado = document.createElement("div");
  derechaEncabezado.className = "row";
  derechaEncabezado.style.cssText = "justify-self:end; align-items:center; gap:10px; min-width:0;";

  const badgeRecomendado = document.createElement("span");
  badgeRecomendado.className = "badge " + (recomendado ? "badge-success" : "badge-danger");
  badgeRecomendado.style.cssText = "flex-shrink:0; white-space:nowrap;";
  badgeRecomendado.textContent = recomendado ? "✓ Recomendado" : "✕ No recomendado";
  derechaEncabezado.appendChild(badgeRecomendado);

  const flecha = document.createElement("span");
  flecha.className = "muted";
  flecha.style.fontSize = "0.9rem";
  flecha.textContent = expandido ? "▲" : "▼";
  derechaEncabezado.appendChild(flecha);

  encabezado.appendChild(derechaEncabezado);

  encabezado.addEventListener("click", () => {
    if (expandido) estado.profesoresExpandidos.delete(profesor.id);
    else estado.profesoresExpandidos.add(profesor.id);
    renderizarComunidad();
  });
  card.appendChild(encabezado);

  if (!expandido) return card;

  /* ---------- Fila de contacto: correo (izq.) / WhatsApp (der.) ----------
     Pedido explícito: justo debajo del nombre y antes de las materias.
     Cada slot (izquierda/derecha) se crea siempre para que la ancla no se
     mueva según cuál dato exista — si falta uno de los dos, ese lado
     queda vacío y no se agrega nada ahí (nunca un placeholder). Si el
     profesor no tiene NI correo NI teléfono, la fila entera no se agrega. */
  if (profesor.correo || profesor.telefono) {
    const filaContacto = document.createElement("div");
    filaContacto.style.cssText = "display:flex; justify-content:space-between; align-items:center; gap:8px;";

    const slotCorreo = document.createElement("div");
    slotCorreo.style.cssText = "flex:1; min-width:0; overflow:hidden;";
    if (profesor.correo) slotCorreo.appendChild(construirBadgeCorreo(profesor.correo));
    filaContacto.appendChild(slotCorreo);

    const slotWhatsapp = document.createElement("div");
    slotWhatsapp.style.cssText = "flex-shrink:0; min-width:0; overflow:hidden;";
    if (profesor.telefono) slotWhatsapp.appendChild(construirBadgeWhatsapp(profesor.telefono));
    filaContacto.appendChild(slotWhatsapp);

    card.appendChild(filaContacto);
  }

  /* ---------- Expandida: mini-tarjetas de vinculación ---------- */
  const historial = obtenerHistorialProfesor(profesor.id, datos);
  const bloqueHistorial = document.createElement("div");
  bloqueHistorial.className = "stack";
  bloqueHistorial.style.gap = "6px";
  if (historial.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.margin = "0";
    p.textContent = "Todavía no lo vinculaste a ninguna materia tuya.";
    bloqueHistorial.appendChild(p);
  } else {
    historial.forEach(({ semestre, mm }) => {
      bloqueHistorial.appendChild(construirMiniTarjetaMateriaVinculada(mm, semestre));
    });
  }
  card.appendChild(bloqueHistorial);

  /* ---------- Fila final: logo(s) MisProfes (sin forma de botón) + Editar anclado a la derecha, pequeño ----------
     Rediseño (pedido explícito):
     - "Eliminar" ya no vive en la vista pública — pasa a vivir dentro del
       modal de Editar (ver abrirModalAltaProfesor).
     - El logo de MisProfes deja de tener pinta de botón (sin fondo/borde/
       padding de .btn) — es solo la imagen, clickeable.
     - MisProfes SOLO cubre TEC y UCR (ninguna otra universidad tiene
       sentido ahí) — se filtra `universidades` contra LINKS_MISPROFES en
       vez de asumir que la única universidad del profesor ya es una de
       esas dos. Si el profesor tiene materias vinculadas en AMBAS TEC y
       UCR (dato real, sacado de las materias vinculadas — nunca
       adivinado), se muestran los DOS logos, cada uno con su propio label
       ("TEC"/"UCR") centrado justo encima de su imagen para diferenciarlos
       — si solo tiene una, el logo va solo, sin label (no hace falta
       aclarar cuál es si no hay ambigüedad).
     - "Editar" queda anclado a la derecha, chico/discreto (no flex:1) —
       ya no reparte el ancho con nada más, porque ya no hay "Eliminar" al
       lado y los logos ocupan su espacio natural a la izquierda. */
  const universidadesConLink = obtenerUniversidadesDeProfesor(profesor.id, datos).filter((u) => LINKS_MISPROFES[u]);

  const filaAcciones = document.createElement("div");
  filaAcciones.className = "row";
  filaAcciones.style.cssText = "justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;";

  const contLogos = document.createElement("div");
  contLogos.className = "row";
  contLogos.style.cssText = "gap:16px; align-items:flex-end; min-width:0;";

  universidadesConLink.forEach((u) => {
    const bloqueLogo = document.createElement("div");
    bloqueLogo.className = "stack";
    bloqueLogo.style.cssText = "gap:2px; align-items:center;";

    if (universidadesConLink.length > 1) {
      const label = document.createElement("span");
      label.className = "muted";
      label.style.cssText = "font-size:0.7rem; font-weight:700; text-align:center;";
      label.textContent = u;
      bloqueLogo.appendChild(label);
    }

    const img = document.createElement("img");
    img.src = RUTA_LOGO_MISPROFES;
    img.alt = `MisProfes ${u}`;
    img.title = `Ir a MisProfes ${u}`;
    // Pedido explícito: sin forma de botón (ni fondo ni borde ni padding) —
    // solo la imagen misma es clickeable. No se deforma su relación de
    // aspecto: solo se fija la altura, el ancho queda "auto".
    img.style.cssText = "height:22px; width:auto; max-width:100%; display:block; cursor:pointer;";
    img.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirEnlaceMisProfesConAviso(profesor.nombre, LINKS_MISPROFES[u]);
    });
    bloqueLogo.appendChild(img);

    contLogos.appendChild(bloqueLogo);
  });

  filaAcciones.appendChild(contLogos);

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn btn-secondary";
  btnEditar.style.cssText = "flex-shrink:0; padding:6px 14px; font-size:0.82rem;";
  btnEditar.textContent = "Editar";
  btnEditar.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalAltaProfesor(profesor);
  });
  filaAcciones.appendChild(btnEditar);

  card.appendChild(filaAcciones);

  return card;
}

function construirTarjetaCompanero(companero, datos) {
  const recomendado = companero.lista !== "blacklist";
  const expandido = estado.companerosExpandidos.has(companero.id);

  const card = document.createElement("div");
  card.className = "glass-panel stack";
  card.style.cssText = "gap:6px; cursor:pointer; padding:14px 16px;";

  const encabezado = document.createElement("div");
  encabezado.className = "row";
  encabezado.style.cssText = "justify-content:space-between; align-items:center; gap:8px;";
  encabezado.innerHTML = `
    <strong>${escaparHtml(companero.nombre_completo)}</strong>
    <span style="display:flex; align-items:center; gap:6px;">
      <span class="muted" style="font-size:11px; white-space:nowrap;">${recomendado ? "✓ Recomendado" : "✕ No recomendado"}</span>
      <span class="muted" style="font-size:12px;">${expandido ? "▲" : "▼"}</span>
    </span>
  `;
  encabezado.addEventListener("click", () => {
    if (expandido) estado.companerosExpandidos.delete(companero.id);
    else estado.companerosExpandidos.add(companero.id);
    renderizarComunidad();
  });
  card.appendChild(encabezado);

  const datosContacto = [companero.carnet, companero.telefono].filter(Boolean);
  if (datosContacto.length > 0) {
    const contacto = document.createElement("p");
    contacto.className = "muted";
    contacto.style.margin = "0";
    contacto.textContent = datosContacto.join(" · ");
    card.appendChild(contacto);
  }

  if (!expandido) return card;

  if (companero.nota) {
    const nota = document.createElement("p");
    nota.style.margin = "0";
    nota.textContent = companero.nota;
    card.appendChild(nota);
  }

  const compartidas = obtenerMateriasCompartidasValidas(companero, datos);
  const bloqueCompartidas = document.createElement("div");
  bloqueCompartidas.className = "stack";
  bloqueCompartidas.style.gap = "4px";
  if (compartidas.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.style.margin = "0";
    p.textContent = "Todavía no lo vinculaste a ninguna materia compartida.";
    bloqueCompartidas.appendChild(p);
  } else {
    compartidas.forEach(({ mm, semestre, materia }) => {
      const fila = document.createElement("p");
      fila.style.margin = "0";
      fila.innerHTML = `<strong>${escaparHtml(materia ? materia.nombre : "Materia eliminada")}</strong> <span class="muted">· ${escaparHtml(
        semestre.nombre
      )}</span>`;
      bloqueCompartidas.appendChild(fila);
    });
  }
  card.appendChild(bloqueCompartidas);

  const filaAcciones = document.createElement("div");
  filaAcciones.className = "row";
  filaAcciones.style.gap = "8px";

  const btnVincular = document.createElement("button");
  btnVincular.type = "button";
  btnVincular.className = "btn btn-secondary";
  btnVincular.style.flex = "1";
  btnVincular.textContent = "Vincular materia compartida";
  btnVincular.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalVincularMateriaCompanero(companero);
  });
  filaAcciones.appendChild(btnVincular);

  const btnEditar = document.createElement("button");
  btnEditar.type = "button";
  btnEditar.className = "btn btn-secondary";
  btnEditar.textContent = "Editar";
  btnEditar.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirModalAltaCompanero(companero);
  });
  filaAcciones.appendChild(btnEditar);

  const btnBorrar = document.createElement("button");
  btnBorrar.type = "button";
  btnBorrar.className = "btn btn-secondary";
  btnBorrar.textContent = "Eliminar";
  btnBorrar.addEventListener("click", (e) => {
    e.stopPropagation();
    abrirConfirmacionBorrarCompanero(companero);
  });
  filaAcciones.appendChild(btnBorrar);

  card.appendChild(filaAcciones);

  return card;
}

/* ===================== Modal: alta / edición de profesor ===================== */

/**
 * Rediseño: el viejo campo de tags libres de "materias que da" se
 * reemplaza por un botón "Vincular materias" que abre
 * abrirModalVincularProfesor (selector de semestre + mini-tarjetas de
 * materia como botones) — vincular ahora vive DENTRO de este modal, no
 * como acción propia de la tarjeta. También se agregan acá la calificación
 * general (estrellas 1-10, medias) y "¿volverías a llevarlo?"
 * (Recomendado/No recomendado).
 */
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
  bloqueTelefono.innerHTML = `<span class="form-label">Teléfono / WhatsApp (opcional)</span>`;
  const inputTelefono = document.createElement("input");
  inputTelefono.type = "tel";
  inputTelefono.className = "form-input";
  inputTelefono.placeholder = "+506 8888-8888";
  inputTelefono.value = esEdicion ? profesorExistente.telefono || "" : "";
  bloqueTelefono.appendChild(inputTelefono);
  // Pedido explícito: aclarar que hay que incluir el código de país, porque
  // el enlace de WhatsApp (wa.me) lo necesita para armar el número
  // completo. Podés escribirlo con +, con espacios, con guiones o con
  // paréntesis — sanitizarTelefonoWhatsapp() limpia todo eso antes de
  // armar el link, así que cualquiera de esos formatos funciona igual.
  const ayudaTelefono = document.createElement("p");
  ayudaTelefono.className = "muted";
  ayudaTelefono.style.cssText = "margin:4px 0 0; font-size:0.75rem;";
  ayudaTelefono.textContent = "Incluí el código de país (ej: +506) para que el botón de WhatsApp funcione.";
  bloqueTelefono.appendChild(ayudaTelefono);
  caja.appendChild(bloqueTelefono);

  // ---------- Calificación general (estrellas, 1-10 con medias) ----------
  const bloqueCalificacion = document.createElement("div");
  bloqueCalificacion.innerHTML = `<span class="form-label">Calificación general</span>`;
  let calificacionActual = esEdicion ? Number(profesorExistente.calificacion) || 0 : 0;
  const estrellasEditables = construirEstrellasEditables(calificacionActual, (valor) => {
    calificacionActual = valor;
    sucio = true;
  });
  bloqueCalificacion.appendChild(estrellasEditables.elemento);
  caja.appendChild(bloqueCalificacion);

  // ---------- ¿Volverías a llevarlo? (Recomendado / No recomendado) ----------
  const bloqueVolveria = document.createElement("div");
  bloqueVolveria.innerHTML = `<span class="form-label">¿Volverías a llevarlo?</span>`;
  let volveriaActual = esEdicion && profesorExistente.volveria_a_llevar === false ? false : true; // default Recomendado
  const contenedorVolveria = document.createElement("div");
  function repintarVolveria() {
    contenedorVolveria.innerHTML = "";
    contenedorVolveria.appendChild(
      construirGrupoPills(
        [
          { valor: "si", texto: "✓ Recomendado" },
          { valor: "no", texto: "✕ No recomendado" },
        ],
        volveriaActual ? "si" : "no",
        (valor) => {
          volveriaActual = valor === "si";
          sucio = true;
          repintarVolveria();
        }
      )
    );
  }
  repintarVolveria();
  bloqueVolveria.appendChild(contenedorVolveria);
  caja.appendChild(bloqueVolveria);

  // ---------- Vincular materias (reemplaza el viejo campo de tags) ----------
  const bloqueVincular = document.createElement("div");
  bloqueVincular.innerHTML = `<span class="form-label">Materias vinculadas</span>`;
  const listaVinculaciones = document.createElement("div");
  listaVinculaciones.className = "stack";
  listaVinculaciones.style.gap = "6px";

  function repintarVinculaciones() {
    listaVinculaciones.innerHTML = "";
    if (!esEdicion) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.style.fontSize = "0.8rem";
      p.textContent = "Guardá el profesor primero, después podés vincularlo a tus materias.";
      listaVinculaciones.appendChild(p);
      return;
    }
    const vivo = buscarProfesorVivoPorId(profesorExistente.id) || profesorExistente;
    const historial = obtenerHistorialProfesor(vivo.id, estado.datos);
    if (historial.length === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.style.margin = "0";
      p.style.fontSize = "0.8rem";
      p.textContent = "Todavía no lo vinculaste a ninguna materia tuya.";
      listaVinculaciones.appendChild(p);
    } else {
      historial.forEach(({ semestre, mm }) => {
        listaVinculaciones.appendChild(construirMiniTarjetaMateriaVinculada(mm, semestre));
      });
    }
  }
  repintarVinculaciones();
  bloqueVincular.appendChild(listaVinculaciones);

  const btnVincular = document.createElement("button");
  btnVincular.type = "button";
  btnVincular.className = "btn btn-secondary btn-block";
  btnVincular.style.marginTop = "8px";
  btnVincular.textContent = "+ Vincular a una materia tuya";
  btnVincular.disabled = !esEdicion;
  btnVincular.title = esEdicion ? "" : "Guardá el profesor primero";
  btnVincular.addEventListener("click", () => {
    abrirModalVincularProfesor(buscarProfesorVivoPorId(profesorExistente.id) || profesorExistente, () => {
      repintarVinculaciones();
    });
  });
  bloqueVincular.appendChild(btnVincular);
  caja.appendChild(bloqueVincular);

  const error = document.createElement("p");
  error.className = "muted oculto";
  error.style.color = "var(--color-danger)";
  caja.appendChild(error);

  // Pedido explícito: "el boton eliminar sacalo de la vista publica, que
  // viva dentro de editar [...] Cancelar en gris, Eliminar en rojo, Guardar
  // en el color de paleta [...] entre los 3 deben ocupar todo el espacio
  // disponible y NUNCA deben irse uno sobre otro, siempre en la misma
  // linea". flex-wrap:nowrap explícito (contrario al .row/.pill-group por
  // defecto de otras partes de la app, que sí pueden envolver) + flex:1 en
  // los 3 botones — así siempre están en una sola fila repartiendo el
  // ancho por igual, sin importar el ancho de pantalla ni el largo del
  // texto. "Eliminar" solo existe en modo edición (no hay nada que borrar
  // al dar de alta un profesor nuevo).
  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.cssText = "gap:8px; flex-wrap:nowrap; width:100%;";

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary";
  btnCancelar.style.cssText = "flex:1; min-width:0; padding:10px 6px; font-size:0.85rem;";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  filaBotones.appendChild(btnCancelar);

  if (esEdicion) {
    const btnEliminar = document.createElement("button");
    btnEliminar.type = "button";
    btnEliminar.className = "btn btn-danger";
    btnEliminar.style.cssText = "flex:1; min-width:0; padding:10px 6px; font-size:0.85rem;";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacionBorrarProfesor(profesorExistente, () => overlay.remove());
    });
    filaBotones.appendChild(btnEliminar);
  }

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.style.cssText = "flex:1; min-width:0; padding:10px 6px; font-size:0.85rem;";
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
      vivo.calificacion = calificacionActual || null;
      vivo.volveria_a_llevar = volveriaActual;
      sellarTimestamp(vivo);
      marcarCambioPendiente();
      overlay.remove();
      renderizarComunidad();
    } else {
      estado.datos.profesores = estado.datos.profesores || [];
      const nuevo = crearProfesor({ nombre, correo, telefono, materias: [] });
      nuevo.calificacion = calificacionActual || null;
      nuevo.volveria_a_llevar = volveriaActual;
      estado.datos.profesores.push(nuevo);
      marcarCambioPendiente();
      overlay.remove();
      renderizarComunidad();
      // Pedido explícito: "desde que agregas profesor te debe permitir
      // vincularlo" — apenas se crea, se reabre el modal ya en modo
      // edición para que el botón "Vincular" quede disponible al toque,
      // sin tener que buscarlo de nuevo en la lista.
      abrirModalAltaProfesor(nuevo);
    }
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

/**
 * Rediseño: el selector de semestre ya NO es un <select> nativo — usa
 * construirSelectorCustom (mismo patrón que "Escala de notas" en Ajustes).
 * Las materias del semestre elegido se muestran como mini-tarjetas
 * delgadas (barra de categoría + nombre con tipografía de materia) que
 * actúan como botones, en vez de la lista de pill-item de antes.
 *
 * La calificación y "¿volverías a llevarlo?" YA NO se piden acá — pasaron
 * a ser un dato general del profesor (ver abrirModalAltaProfesor). Este
 * modal ahora solo decide QUÉ materia+semestre se vincula.
 *
 * `onVinculado` (opcional) se llama tras guardar con éxito, para que el
 * modal de Editar profesor (que puede seguir abierto detrás) refresque su
 * propia lista de vinculaciones sin tener que cerrarse y reabrirse.
 */
function abrirModalVincularProfesor(profesor, onVinculado) {
  document.querySelectorAll(".overlay-vincular-profesor").forEach((el) => el.remove());

  const semestres = [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];

  const overlay = document.createElement("div");
  overlay.className = "overlay-vincular-profesor";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:310; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

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

  let mmSeleccionadaId = null;

  const bloqueSemestre = document.createElement("div");
  bloqueSemestre.innerHTML = `<span class="form-label">Semestre</span>`;
  const opcionesSemestre = semestres.map((s) => ({ valor: s.id, etiqueta: s.nombre }));
  const selectorSemestre = construirSelectorCustom(opcionesSemestre, semestres[0].id, (semestreId) => {
    mmSeleccionadaId = null;
    repintarMaterias(semestreId);
  });
  bloqueSemestre.appendChild(selectorSemestre.elemento);
  caja.appendChild(bloqueSemestre);

  const bloqueMateria = document.createElement("div");
  bloqueMateria.innerHTML = `<span class="form-label">Materias de ese semestre, tocá una para vincularla</span>`;
  const contenedorMaterias = document.createElement("div");
  contenedorMaterias.className = "stack";
  contenedorMaterias.style.gap = "6px";
  bloqueMateria.appendChild(contenedorMaterias);
  caja.appendChild(bloqueMateria);

  /**
   * Mini-tarjeta de materia usada COMO BOTÓN dentro del selector: misma
   * pinta que construirMiniTarjetaMateriaVinculada (barra de categoría +
   * tipografía .materia-nombre), pero clickeable, con estado "activa"
   * (borde/realce) cuando es la seleccionada, y sin badge de semestre
   * (acá el semestre ya está fijo arriba, sería redundante).
   */
  function construirMiniTarjetaSeleccionable(mm, seleccionada, onClick) {
    const { plan, materia } = obtenerContextoMateria(mm);
    const categoria = plan && materia ? plan.categorias.find((c) => c.id === materia.categoria_id) : null;

    const boton = document.createElement("button");
    boton.type = "button";
    boton.className = "glass-panel row";
    // Pedido explícito: el texto debe verse igual que el resto de la app.
    // Un <button> nativo NO hereda el color de texto del contenedor por
    // defecto (usa un color de sistema, de ahí que se viera negro) — se
    // fuerza color:inherit para que tome el mismo color que el resto de
    // la tarjeta (blanco/claro, según el tema).
    boton.style.cssText =
      "padding:8px 12px; align-items:center; gap:10px; width:100%; box-sizing:border-box; text-align:left; cursor:pointer; color:inherit; font:inherit; border:1px solid " +
      (seleccionada ? "var(--accent-1)" : "transparent") +
      ";" +
      (categoria ? ` box-shadow: inset 4px 0 0 0 ${categoria.color}${seleccionada ? ", 0 0 0 2px var(--accent-1)" : ""};` : "");

    const nombre = document.createElement("span");
    nombre.className = "materia-nombre truncada";
    nombre.style.cssText = "flex:1; min-width:0; font-size:0.85rem; top:0;";
    nombre.textContent = materia ? materia.nombre : "Materia eliminada";
    boton.appendChild(nombre);

    const yaConOtro = mm.profesor_id && mm.profesor_id !== profesor.id;
    const yaConEste = mm.profesor_id === profesor.id;
    if (yaConOtro || yaConEste) {
      const etiqueta = document.createElement("span");
      etiqueta.className = "muted";
      etiqueta.style.cssText = "font-size:0.72rem; flex-shrink:0; white-space:nowrap;";
      etiqueta.textContent = yaConEste ? "Ya vinculada a este" : "Ya tiene otro profesor";
      boton.appendChild(etiqueta);
    }

    boton.addEventListener("click", onClick);
    return boton;
  }

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
      return;
    }
    mms.forEach((mm) => {
      contenedorMaterias.appendChild(
        construirMiniTarjetaSeleccionable(mm, mmSeleccionadaId === mm.id, () => {
          mmSeleccionadaId = mm.id;
          repintarMaterias(semestreId);
        })
      );
    });
  }
  repintarMaterias(selectorSemestre.obtenerValor());

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
  btnCancelar.addEventListener("click", () => overlay.remove());
  filaBotones.appendChild(btnCancelar);

  const btnGuardar = document.createElement("button");
  btnGuardar.type = "button";
  btnGuardar.className = "btn btn-primary";
  btnGuardar.textContent = "Vincular";
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
    encontrada.mm.profesor_id = profesor.id;
    sellarTimestamp(encontrada.mm);
    marcarCambioPendiente();
    overlay.remove();
    if (onVinculado) onVinculado();
    renderizarComunidad();
  });
  filaBotones.appendChild(btnGuardar);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/* ===================== Borrar profesor ===================== */

/** `onEliminado` (opcional) se llama tras confirmar el borrado, antes de
 *  renderizarComunidad() — usado por el modal de Editar (ver arriba) para
 *  cerrarse a sí mismo, ya que "Eliminar" ahora vive DENTRO de ese modal en
 *  vez de en la tarjeta pública. */
function abrirConfirmacionBorrarProfesor(profesor, onEliminado) {
  abrirConfirmacion({
    titulo: "Eliminar profesor",
    mensaje: `¿Seguro que querés eliminar a "${profesor.nombre}"? Se borra también su vínculo con las materias que le hayas asignado.`,
    textoConfirmar: "Eliminar definitivamente",
    onConfirmar: () => {
      // Limpieza defensiva (regla obligatoria de sincronización): ninguna
      // materia_matriculada debe quedar apuntando a un profesor_id que ya
      // no existe.
      (estado.datos.semestres || []).forEach((semestre) => {
        (semestre.materias_matriculadas || []).forEach((mm) => {
          if (mm.profesor_id === profesor.id) {
            mm.profesor_id = null;
            // Campos legados de la versión anterior del diseño (la
            // calificación/volvería ya no viven en la mm, ver arriba) — se
            // limpian igual por si quedó algo de una sincronización vieja.
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
      if (onEliminado) onEliminado();
      renderizarComunidad();
    },
  });
}

/* ===================== Modal: alta / edición de compañero (sin cambios) ===================== */

function abrirModalAltaCompanero(companeroExistente = null) {
  document.querySelectorAll(".overlay-alta-companero").forEach((el) => el.remove());
  const esEdicion = !!companeroExistente;

  const overlay = document.createElement("div");
  overlay.className = "overlay-alta-companero";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

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
      mensaje: `Vas a perder los datos que ingresaste para ${esEdicion ? "este compañero" : "el nuevo compañero"}.`,
      textoConfirmar: "Cerrar sin guardar",
      onConfirmar: () => overlay.remove(),
    });
  }

  caja.innerHTML = `<h2 style="margin:0;">${esEdicion ? "Editar compañero" : "Agregar compañero"}</h2>`;

  const bloqueNombre = document.createElement("div");
  bloqueNombre.innerHTML = `<span class="form-label">Nombre</span>`;
  const inputNombre = document.createElement("input");
  inputNombre.type = "text";
  inputNombre.className = "form-input";
  inputNombre.placeholder = "Nombre completo";
  inputNombre.value = esEdicion ? companeroExistente.nombre_completo : "";
  bloqueNombre.appendChild(inputNombre);
  caja.appendChild(bloqueNombre);

  const bloqueCarnet = document.createElement("div");
  bloqueCarnet.innerHTML = `<span class="form-label">Carné (opcional)</span>`;
  const inputCarnet = document.createElement("input");
  inputCarnet.type = "text";
  inputCarnet.className = "form-input";
  inputCarnet.placeholder = "Ej. 2023123456";
  inputCarnet.value = esEdicion ? companeroExistente.carnet || "" : "";
  bloqueCarnet.appendChild(inputCarnet);
  caja.appendChild(bloqueCarnet);

  const bloqueTelefono = document.createElement("div");
  bloqueTelefono.innerHTML = `<span class="form-label">Teléfono (opcional)</span>`;
  const filaTelefono = document.createElement("div");
  filaTelefono.className = "row";
  filaTelefono.style.gap = "6px";
  const inputTelefono = document.createElement("input");
  inputTelefono.type = "tel";
  inputTelefono.className = "form-input";
  inputTelefono.placeholder = "8888-8888";
  inputTelefono.style.flex = "1";
  inputTelefono.value = esEdicion ? companeroExistente.telefono || "" : "";
  filaTelefono.appendChild(inputTelefono);
  // El botón de importar solo aparece si el navegador lo soporta de verdad
  // (Contacts Picker API, en la práctica Chrome/Edge Android) — es un atajo
  // opcional, nunca la única forma de cargar el teléfono.
  if (contactsPickerDisponible()) {
    const btnImportar = document.createElement("button");
    btnImportar.type = "button";
    btnImportar.className = "btn btn-secondary";
    btnImportar.textContent = "Importar";
    btnImportar.addEventListener("click", () => importarContactoTelefono(inputTelefono, inputNombre));
    filaTelefono.appendChild(btnImportar);
  }
  bloqueTelefono.appendChild(filaTelefono);
  caja.appendChild(bloqueTelefono);

  const bloqueLista = document.createElement("div");
  bloqueLista.innerHTML = `<span class="form-label">¿Lo recomendás para volver a trabajar juntos?</span>`;
  const contenedorLista = document.createElement("div");
  let listaValor = esEdicion ? companeroExistente.lista : "whitelist"; // "whitelist" | "blacklist" — switch sin neutral
  function repintarLista() {
    contenedorLista.innerHTML = "";
    contenedorLista.appendChild(
      construirGrupoPills(
        [
          { valor: "whitelist", texto: "✓ Recomendado" },
          { valor: "blacklist", texto: "✕ No recomendado" },
        ],
        listaValor,
        (valor) => {
          listaValor = valor;
          sucio = true;
          repintarLista();
        }
      )
    );
  }
  repintarLista();
  bloqueLista.appendChild(contenedorLista);
  caja.appendChild(bloqueLista);

  const bloqueNota = document.createElement("div");
  bloqueNota.innerHTML = `<span class="form-label">Nota (opcional)</span>`;
  const inputNota = document.createElement("textarea");
  inputNota.className = "form-input";
  inputNota.rows = 3;
  inputNota.placeholder = "Ej. Muy responsable con las entregas, buena onda para dividir el trabajo...";
  inputNota.value = esEdicion ? companeroExistente.nota || "" : "";
  bloqueNota.appendChild(inputNota);
  caja.appendChild(bloqueNota);

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
    const nombre_completo = inputNombre.value.trim();
    if (!nombre_completo) {
      error.textContent = "El nombre es obligatorio.";
      error.classList.remove("oculto");
      return;
    }
    const carnet = inputCarnet.value.trim();
    const telefono = inputTelefono.value.trim();
    const nota = inputNota.value.trim();

    if (esEdicion) {
      const vivo = buscarCompaneroVivoPorId(companeroExistente.id);
      if (!vivo) {
        mostrarToast("Este compañero se eliminó desde otro dispositivo — no se pudo guardar");
        overlay.remove();
        renderizarComunidad();
        return;
      }
      vivo.nombre_completo = nombre_completo;
      vivo.carnet = carnet || null;
      vivo.telefono = telefono || null;
      vivo.lista = listaValor;
      vivo.nota = nota;
      sellarTimestamp(vivo);
    } else {
      estado.datos.companeros = estado.datos.companeros || [];
      estado.datos.companeros.push(
        crearCompanero({ nombre_completo, carnet, telefono, lista: listaValor, nota, materias_compartidas: [] })
      );
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

/* ===================== Modal: vincular materia compartida con un compañero (sin cambios) ===================== */

function abrirModalVincularMateriaCompanero(companero) {
  document.querySelectorAll(".overlay-vincular-companero").forEach((el) => el.remove());

  const semestres = [...obtenerSemestresActuales(), ...obtenerSemestresPasados()];

  const overlay = document.createElement("div");
  overlay.className = "overlay-vincular-companero";
  overlay.style.cssText =
    "position:fixed; inset:0; z-index:300; background:rgba(0,0,0,0.55); display:flex; align-items:center; justify-content:center; padding:16px;";

  const caja = document.createElement("div");
  caja.className = "glass-card stack";
  caja.style.cssText = "max-width:480px; width:100%; padding:18px; max-height:85vh; overflow-y:auto;";
  caja.addEventListener("click", (ev) => ev.stopPropagation());

  caja.innerHTML = `<h2 style="margin:0;">Vincular materia compartida</h2><p class="muted" style="margin:0;">${escaparHtml(
    companero.nombre_completo
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

  // Set en memoria, inicializado con lo que ya tenía guardado — se persiste
  // recién al tocar "Listo", como una sola escritura en vez de una por clic.
  const seleccionActual = new Set(companero.materias_compartidas || []);

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

  const bloqueMaterias = document.createElement("div");
  bloqueMaterias.innerHTML = `<span class="form-label">Materias de ese semestre (tocá para marcar/desmarcar)</span>`;
  const contenedorMaterias = document.createElement("div");
  contenedorMaterias.style.cssText = "display:flex; flex-direction:column; gap:6px;";
  bloqueMaterias.appendChild(contenedorMaterias);
  caja.appendChild(bloqueMaterias);

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
      return;
    }
    mms.forEach((mm) => {
      const btn = document.createElement("button");
      btn.type = "button";
      const marcada = seleccionActual.has(mm.id);
      btn.className = "pill-item" + (marcada ? " active" : "");
      btn.style.cssText = "text-align:left; width:100%;";
      btn.textContent = (marcada ? "✓ " : "") + obtenerNombreMateria(mm);
      btn.addEventListener("click", () => {
        if (marcada) seleccionActual.delete(mm.id);
        else seleccionActual.add(mm.id);
        repintarMaterias(semestreId);
      });
      contenedorMaterias.appendChild(btn);
    });
  }
  repintarMaterias(selectSemestre.value);
  selectSemestre.addEventListener("change", () => repintarMaterias(selectSemestre.value));

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.justifyContent = "flex-end";

  const btnListo = document.createElement("button");
  btnListo.type = "button";
  btnListo.className = "btn btn-primary";
  btnListo.textContent = "Listo";
  btnListo.addEventListener("click", () => {
    const vivo = buscarCompaneroVivoPorId(companero.id);
    if (!vivo) {
      mostrarToast("Este compañero se eliminó desde otro dispositivo — no se pudo guardar");
      overlay.remove();
      renderizarComunidad();
      return;
    }
    vivo.materias_compartidas = Array.from(seleccionActual);
    sellarTimestamp(vivo);
    marcarCambioPendiente();
    overlay.remove();
    renderizarComunidad();
  });
  filaBotones.appendChild(btnListo);
  caja.appendChild(filaBotones);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove(); // acá no hay "sucio": cada clic ya escribe en seleccionActual, y solo se persiste de verdad al tocar "Listo"
  });
  document.body.appendChild(overlay);
}

/* ===================== Borrar compañero (sin cambios) ===================== */

function abrirConfirmacionBorrarCompanero(companero) {
  abrirConfirmacion({
    titulo: "Eliminar compañero",
    mensaje: `¿Seguro que querés eliminar a "${companero.nombre_completo}"?`,
    textoConfirmar: "Eliminar definitivamente",
    onConfirmar: () => {
      // A diferencia del profesor, materias_compartidas vive DENTRO del
      // propio companero (no hay un mm.companero_id que limpiar en otro
      // lado) — borrar el registro alcanza, no queda ninguna referencia
      // huérfana en otra colección.
      estado.datos.companeros = (estado.datos.companeros || []).filter((c) => c.id !== companero.id);
      estado.datos._eliminados_companeros = estado.datos._eliminados_companeros || [];
      estado.datos._eliminados_companeros.push({ id: companero.id, eliminadoEn: Date.now() });
      estado.companerosExpandidos.delete(companero.id);
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
    filtrados.forEach((c) => seccion.appendChild(construirTarjetaCompanero(c, datos)));
  }

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-primary btn-block";
  btnAgregar.textContent = "+ Agregar compañero";
  btnAgregar.addEventListener("click", () => abrirModalAltaCompanero());
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
