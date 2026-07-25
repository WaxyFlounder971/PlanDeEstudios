/* =========================================================================
   PLAN.JS — Iteración 1 (Parte 1-B + Parte 2 FINAL)
   Encargado de: importar el CSV generado por IA (formato-agnóstico, con
   grupos de requisitos "Y"/"O"), gestión de hasta 3 Planes de Estudio,
   añadir materias manualmente, la vista completa por bloques colapsables,
   candados, badges de categoría/estado, botón "Desbloquea" (búsqueda
   inversa), modal de requisito navegable, flujo completo de categorías
   (crear/filtrar/editar), buscador general y exportación a CSV.
   Depende de: js/schema.js (estructuras) y js/app.js (estado global,
   marcarCambioPendiente, mostrarSeccion, abrirConfirmacion, etc.).
   ========================================================================= */

/**
 * Arma la lista de columnas de horas para el encabezado del CSV, según los
 * tipos_horas del plan (dinámico — TEC trae 1 columna, UCR trae 4, una
 * universidad personalizada trae las que el usuario haya definido).
 * Ej.: ["Horas"] -> "Horas_Horas" ; ["Teoría","Práctica"] -> "Horas_Teoría,Horas_Práctica"
 */
function construirColumnasHoras(tiposHoras) {
  const tipos = tiposHoras || ["Horas"];
  if (tipos.length === 0) return ""; // v7 #1: "No aplica" -> sin columnas de horas en el CSV
  return tipos.map((t) => `Horas_${t.replace(/\s+/g, "")}`).join(",");
}

function construirEncabezadoCSV(tiposHoras) {
  const columnasHoras = construirColumnasHoras(tiposHoras);
  const partes = ["Bloque", "Codigo", "Nombre", "Creditos"];
  if (columnasHoras) partes.push(columnasHoras);
  partes.push("Requisitos", "Correquisitos");
  return partes.join(",");
}

/**
 * Línea compacta de horas para mostrar en tarjeta/modal, iterando las
 * llaves REALES de materia.horas (nunca nombres fijos como teoria/practica).
 * Una sola llave -> "Horas: N". Varias llaves -> "Tipo1 N · Tipo2 N · …".
 * v7 #1: si el plan es "No aplica" para horas, materia.horas queda vacío y
 * no hay nada que mostrar — se devuelve "" para que el llamador simplemente
 * no pinte esa línea.
 */
function formatearHoras(materia) {
  const entradas = Object.entries(materia.horas || {});
  if (entradas.length === 0) return "";
  if (entradas.length === 1) return `Horas: ${entradas[0][1]}`;
  return entradas.map(([tipo, valor]) => `${tipo} ${valor}`).join(" · ");
}

/**
 * Prompt oficial y único del proyecto para pedirle a una IA externa (Claude o
 * ChatGPT) que estructure el plan de estudios en CSV. `modo` cambia solo el
 * párrafo de instrucción de entrada; las reglas de formato CSV son las
 * mismas siempre. `columnasHoras` ya viene armado por construirColumnasHoras().
 * Cualquier flujo del proyecto que necesite este texto (import inicial,
 * re-importar/actualizar malla desde gestión de planes) debe reutilizar esta
 * función — nunca generar un texto distinto a mano.
 */
function construirPromptImportacion(modo, link, columnasHoras) {
  let instruccionEntrada = "";
  let avisoNavegacion = "";

  if (modo === "link") {
    // v5 1.3: el aviso de navegación web se refuerza DENTRO del propio texto
    // del prompt (no solo en la UI), como primera línea — en pruebas reales
    // la IA a veces respondía "es imposible" sin aclarar que el problema era
    // que su navegación no estaba activada.
    avisoNavegacion = `Si no tienes activada la navegación/búsqueda web y no puedes visitar este link, dímelo y usaré otro método en su lugar — no asumas que es imposible sin intentarlo primero.\n\n`;
    instruccionEntrada = `Visita esta página pública y extrae el plan de estudios completo desde su contenido: ${link}
Es una página institucional sin inicio de sesión. Si la página organiza las materias en pestañas o bloques mediante controles de navegador (JavaScript) que no se reflejen con claridad en el contenido que puedas leer, y no puedes determinar con certeza a qué Bloque pertenece cada materia, escribe "REVISAR" en la columna Bloque de esa fila en vez de adivinar.`;
  } else if (modo === "pdf") {
    instruccionEntrada = `Te voy a adjuntar el plan de estudios de mi carrera en un archivo PDF (puede tener tablas de texto real, o ser páginas escaneadas como imágenes — trátalo igual en ambos casos).`;
  } else if (modo === "capturas") {
    instruccionEntrada = `Te voy a adjuntar una o varias fotos/capturas de pantalla de mi plan de estudios. Léelas todas como una sola malla curricular continua, uniendo la información entre todas, sin perder ninguna materia, sin importar el orden en que las adjunte.`;
  }

  return `${avisoNavegacion}Actúa como un estructurador de datos académicos. ${instruccionEntrada}

Si logras identificar el nombre de la carrera, su código de plan, y la universidad, inclúyelos en las primeras 3 líneas así: CARRERA: ..., CODIGO_PLAN: ..., UNIVERSIDAD: ... (una por línea, antes del CSV). Si no puedes identificar alguno con certeza, omite esa línea.

Devuélveme ÚNICAMENTE un bloque de código plano en formato CSV (con esas líneas de metadatos antes, si las tienes), sin texto adicional antes o después, con esta estructura EXACTA:

Bloque,Codigo,Nombre,Creditos,${columnasHoras},Requisitos,Correquisitos

Reglas:
- Bloque: número de nivel/semestre/cuatrimestre tal como aparece en el documento/página. Si usa nombres en vez de números, conviértelo al número secuencial correspondiente. Si no puedes determinarlo con certeza, escribe "REVISAR".
- Codigo: la sigla tal como aparece; si no tiene, genera uno corto y consistente a partir del nombre.
- Horas: usa 0 si el documento no maneja esa categoría — nunca las dejes vacías.
- Requisitos y Correquisitos: usa punto y coma ";" para separar requisitos distintos que se necesitan TODOS ("Y"), y diagonal "/" para separar materias equivalentes/alternativas dentro de un mismo requisito ("O"). NUNCA uses coma "," dentro de esta celda — la coma ya se usa para separar las columnas del CSV y mezclarla aquí rompe el archivo. Ejemplo: "MA-1001;FS-0210/FS-0227/FS-0250" significa MA-1001 Y (una de las tres alternativas). Si no hay requisitos, usa "Ninguno".
- No agregues columna de categoría ni ninguna otra fuera de las columnas indicadas.
- No omitas ninguna materia, incluidas optativas/electivas.
- Si una celda es ilegible, ambigua, o no puedes confirmarla con certeza, escribe "REVISAR" en vez de inventar un dato.`;
}

/** Lee las líneas opcionales CARRERA:/CODIGO_PLAN:/UNIVERSIDAD: al inicio de
 *  la respuesta de la IA (v5 1.3), sin romperse si no existen. Devuelve
 *  { metadatos: {...}, csv: "texto sin esas líneas" }. */
function extraerMetadatosImportacion(textoCrudo) {
  const lineas = textoCrudo.replace(/```[a-zA-Z]*\n?/g, "").split(/\r?\n/);
  const metadatos = {};
  let i = 0;
  const patrones = { carrera: /^CARRERA:\s*(.+)$/i, codigo_plan: /^CODIGO_PLAN:\s*(.+)$/i, universidad: /^UNIVERSIDAD:\s*(.+)$/i };
  while (i < lineas.length) {
    const linea = lineas[i].trim();
    if (!linea) { i++; continue; }
    let coincidio = false;
    for (const [clave, patron] of Object.entries(patrones)) {
      const m = linea.match(patron);
      if (m) { metadatos[clave] = m[1].trim(); coincidio = true; break; }
    }
    if (!coincidio) break;
    i++;
  }
  return { metadatos, csv: lineas.slice(i).join("\n") };
}

/** Placeholders variados de Carrera/Código según universidad (v5 1.3). */
const EJEMPLOS_PLACEHOLDER_PLAN = {
  TEC: [
    { carrera: "Administración de Tecnologías de Información", codigo: "2053" },
    { carrera: "Ingeniería en Computadores", codigo: "2103" },
  ],
  UCR: [
    { carrera: "Ingeniería Química", codigo: "420501, plan 01" },
    { carrera: "Física", codigo: "210201, plan 03" },
    { carrera: "Enfermería", codigo: "510109" },
    { carrera: "Educación Primaria", codigo: "320242, plan 02" },
  ],
};

function elegirPlaceholderPlan(universidad) {
  const lista = EJEMPLOS_PLACEHOLDER_PLAN[universidad] || EJEMPLOS_PLACEHOLDER_PLAN.TEC;
  return lista[Math.floor(Math.random() * lista.length)];
}

const LIMITE_PLANES_ESTUDIO = 3;

/* Estado propio de esta sección, colgado del `estado` global de app.js. */
estado.ordenPlanEstudios = "bloque";       // "bloque" | "categoria"
estado.planImportandoId = null;            // "principal" | "secundario", elegido antes de importar (primer plan)
estado.csvPendienteDeImportar = null;      // texto CSV en espera mientras se crea el plan
estado.categoriaEditandoId = null;
estado.planCategoriaEditandoId = null;     // a qué plan pertenece la categoría que se edita
estado.filtroCategoriaId = null;           // categoría por la que se está filtrando la vista
estado.busquedaPlanEstudios = "";          // texto del buscador general
estado.materiasExpandidas = new Map();     // codigo -> bool (override manual del expand/collapse)
estado.bloquesColapsados = new Set();      // claves de bloque/categoría colapsadas
estado.materiaManualPlanId = null;         // a qué plan se le está añadiendo materia manual
estado.planGestionImportandoId = null;     // qué fila del panel de gestión tiene el mini-import abierto
estado.reabrirGestionPlanesTrasCrear = false;
estado.busquedaCategoriaMaterias = "";
estado.ordenCategoriaMaterias = "bloque";
estado.panelImportacionAbierto = false;   // v5 1.2/1.3: import/actualizar malla, siempre inline
estado.estadisticasAbiertas = false;      // v5 #3: colapsada por defecto
estado.arrastrandoPlanId = null;          // v5 1.4: drag-and-drop en Gestionar plan

/* ---- B.2: flujo de importación de 3 modos (Link / PDF / Capturas) ----
 * Estas llaves viven en `estado` (no en los datos del usuario) porque son
 * solo del momento de importar, antes de que exista el plan. */
estado.modoImportacion = "capturas";       // "link" | "pdf" | "capturas"
estado.linkImportacion = "";               // URL pegada en el modo "link"
// Universidad/tipos_horas elegidos ANTES de que el plan exista (para poder
// construir el prompt con las columnas de horas correctas). Se resuelven acá
// primero y se copian al crear el plan real en abrirModalCrearPlan/confirmar.
estado.universidadImportacion = "TEC";
estado.tiposHorasImportacion = PRESETS_TIPOS_HORAS.TEC.slice();
estado.tiposHorasPersonalizadoTexto = "";  // texto crudo cuando universidadImportacion === "Otra"

/**
 * v5 #9: aplica el formato de nombres elegido en Configuración
 * (`configuracion.formato_texto_nombres`: "titulo" | "mayusculas" | "oracion")
 * a un texto de materia/carrera. Esta función faltaba por completo — se
 * llamaba desde 6 lugares distintos de este archivo pero nunca se definió,
 * lo cual provocaba un ReferenceError en cuanto se intentaba pintar el
 * encabezado del plan (construirEncabezadoPlan). Como ese error ocurre
 * DESPUÉS de que renderizarPlanEstudios() ya había limpiado el contenedor
 * (cont.innerHTML = ""), el resultado era una sección de Plan de Estudios
 * completamente vacía, sin ningún mensaje de error visible — esta era la
 * causa raíz del Bug 1 (crítico).
 *
 * Nunca revienta: si `texto` es null/undefined, devuelve "" en vez de tirar.
 */
function aplicarFormatoTexto(texto) {
  const original = texto || "";
  const formato = (estado.datos && estado.datos.configuracion && estado.datos.configuracion.formato_texto_nombres) || "titulo";

  if (formato === "mayusculas") return original.toUpperCase();

  if (formato === "oracion") {
    const t = original.toLowerCase();
    return t.charAt(0).toUpperCase() + t.slice(1);
  }

  // "titulo" (default): Cada Palabra Capitalizada.
  return original
    .toLowerCase()
    .split(" ")
    .map((palabra) => (palabra ? palabra.charAt(0).toUpperCase() + palabra.slice(1) : palabra))
    .join(" ");
}

/* ===================== Utilidades de acceso a los planes ===================== */

function obtenerPlanActivo() {
  const cfg = estado.datos.configuracion;
  return estado.datos.planes_estudio.find((p) => p.id === cfg.plan_activo_id) || null;
}

function obtenerPlanSecundario() {
  const cfg = estado.datos.configuracion;
  if (!cfg.modo_hardcore || !cfg.plan_activo_secundario_id) return null;
  return estado.datos.planes_estudio.find((p) => p.id === cfg.plan_activo_secundario_id) || null;
}

/** Todas las materias visibles ahora mismo, con una referencia a su plan de origen. */
function obtenerMateriasVisibles() {
  const principal = obtenerPlanActivo();
  const secundario = obtenerPlanSecundario();
  const filas = [];
  if (principal) principal.materias.forEach((m) => filas.push({ materia: m, plan: principal, origen: "principal" }));
  if (secundario) secundario.materias.forEach((m) => filas.push({ materia: m, plan: secundario, origen: "secundario" }));
  return filas;
}

function buscarMateriaPorCodigoEnPlanes(codigo) {
  const filas = obtenerMateriasVisibles();
  const encontrada = filas.find((f) => f.materia.codigo === codigo);
  return encontrada || null;
}

/** Aplica el buscador general y el filtro de categoría a las filas visibles. */
function filasFiltradas() {
  let filas = obtenerMateriasVisibles();
  if (estado.filtroCategoriaId) {
    filas = filas.filter((f) => f.materia.categoria_id === estado.filtroCategoriaId);
  }
  const q = (estado.busquedaPlanEstudios || "").trim().toLowerCase();
  if (q) {
    filas = filas.filter(
      (f) => f.materia.nombre.toLowerCase().includes(q) || f.materia.codigo.toLowerCase().includes(q)
    );
  }
  return filas;
}

/* ===================== Sección 2 — Candado (lógica de grupos) ===================== */

/** Disponible si no tiene requisitos, o si de CADA grupo hay al menos un código aprobado. */
function materiaDisponible(materia, materiasDelPlan) {
  if (!materia.requisitos || materia.requisitos.length === 0) return true;
  return materia.requisitos.every((grupo) =>
    (grupo || []).some((codigo) => {
      const req = materiasDelPlan.find((m) => m.codigo === codigo);
      return req && req.estado === "aprobado";
    })
  );
}

/** Sección 5 — búsqueda inversa: qué materias tienen a `materia` en algún grupo de requisitos/correquisitos. */
function obtenerMateriasQueDesbloquea(materia, plan) {
  return plan.materias.filter((m) => {
    const enReq = (m.requisitos || []).some((grupo) => (grupo || []).includes(materia.codigo));
    const enCorreq = (m.correquisitos || []).some((grupo) => (grupo || []).includes(materia.codigo));
    return enReq || enCorreq;
  });
}

/* ===================== Utilidades de color (badges de categoría) ===================== */

function hexARgba(hex, alpha) {
  const limpio = (hex || "#94a3b8").replace("#", "");
  const completo = limpio.length === 3 ? limpio.split("").map((c) => c + c).join("") : limpio;
  const num = parseInt(completo, 16) || 0x94a3b8;
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/** Mismo patrón visual que los badges semánticos: fondo en baja opacidad + borde + texto del color. */
function estiloBadgeCategoria(hex) {
  return `background:${hexARgba(hex, 0.15)}; border-color:${hex}; color:${hex};`;
}

/* ===================== Parser de grupos de requisitos (";" = Y, "/" = O) ===================== */

/**
 * Normaliza separadores "sueltos" que a veces llegan en la celda en vez del
 * punto y coma/diagonal oficial: " - " o " y " (con espacios) como separador
 * de GRUPOS distintos (equivalente a ";"), y " o " como separador de
 * ALTERNATIVAS dentro de un grupo (equivalente a "/"). Solo se normaliza
 * cuando el separador está rodeado de espacios — así un código como
 * "MA-1001" (guion pegado, sin espacios) nunca se parte por error.
 *
 * v7: el separador de "Y" se cambió de coma "," a punto y coma ";" porque la
 * coma choca con el separador de columnas del propio CSV — si una materia
 * tenía más de un requisito (ej. "MA0101,MA1403"), esa celda no quedaba
 * envuelta en comillas por la IA externa y la fila terminaba con más
 * columnas de las esperadas, causando que el parser la descartara. Esta era
 * la causa raíz de que se perdieran materias al importar.
 */
function normalizarSeparadoresRequisitos(texto) {
  return texto
    .replace(/\s+-\s+/g, ";")
    .replace(/\s+y\s+/gi, ";")
    .replace(/\s+o\s+/gi, "/")
    // Compatibilidad con datos/plantillas viejas que aún usan coma como "Y":
    // si después de todo lo anterior sigue habiendo una coma dentro de la
    // celda (que ya no debería tener columnas mezcladas, porque esto se usa
    // fila por fila sobre una celda ya aislada), se trata como "Y" también.
    .replace(/\s*,\s*/g, ";");
}

function parsearGrupoRequisitos(texto) {
  const limpio = normalizarSeparadoresRequisitos((texto || "").trim());
  if (!limpio || limpio.toLowerCase() === "ninguno") return [];
  return limpio
    .split(";")
    .map((grupo) => grupo.split("/").map((c) => c.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

function serializarGrupoRequisitos(grupos) {
  if (!grupos || grupos.length === 0) return "Ninguno";
  return grupos.map((g) => g.join("/")).join(";");
}

/* ===================== Render principal de la sección ===================== */

function renderizarPlanEstudios() {
  const cont = document.getElementById("seccion-plan-estudios");
  if (!cont) return;

  const principal = obtenerPlanActivo();
  cont.innerHTML = "";

  try {
    if (!principal) {
      cont.appendChild(construirPanelImportacion());
      return;
    }

    cont.appendChild(construirEncabezadoPlan(principal));
    if (estado.panelImportacionAbierto) {
      cont.appendChild(construirMiniPanelImportacion(principal));
    }
    cont.appendChild(construirPanelEstadisticas(principal));
    cont.appendChild(construirBarraAcciones());
    cont.appendChild(construirPanelCategorias());
    cont.appendChild(construirContenidoBloques());
  } catch (e) {
    // Bug 1 (v6): antes, un error aquí dejaba la sección completamente vacía
    // y sin ningún indicio de qué pasó (el error solo se veía en la consola
    // del navegador). Ahora se le muestra al usuario un mensaje visible y se
    // reporta el detalle en consola para diagnóstico.
    console.error("Error al renderizar el Plan de Estudios:", e);
    cont.innerHTML = "";
    const aviso = document.createElement("section");
    aviso.className = "glass-card stack";
    const titulo = document.createElement("h2");
    titulo.style.margin = "0";
    titulo.style.color = "var(--color-danger)";
    titulo.textContent = "⚠️ No se pudo mostrar el Plan de Estudios";
    const detalle = document.createElement("p");
    detalle.className = "muted";
    detalle.textContent =
      "Ocurrió un error inesperado al dibujar esta sección. Tus datos siguen guardados; " +
      "intenta recargar la página. Si el problema persiste, revisa la consola del navegador (F12) para más detalle.";
    const tecnico = document.createElement("p");
    tecnico.className = "muted";
    tecnico.style.fontFamily = "monospace";
    tecnico.style.fontSize = "0.8rem";
    tecnico.textContent = e && e.message ? e.message : String(e);
    aviso.appendChild(titulo);
    aviso.appendChild(detalle);
    aviso.appendChild(tecnico);
    cont.appendChild(aviso);
  }
}

/* ===================== B.2 — Panel de importación (solo cuando no hay plan) ===================== */

/**
 * v7 #3: texto final de la ventana "Antes de ir a la IA", con un salto de
 * línea entre cada instrucción. Es el mismo para los 3 modos (Link/PDF/
 * Capturas) — ya no varía por modo, solo por la IA elegida.
 */
function construirTextoInstruccionesImportacion(destino) {
  const nombreIA = NOMBRE_IA[destino] || "la IA seleccionada";
  return [
    `Cuando presiones Aceptar, se te enviará a ${nombreIA}.`,
    "Cuando estés en el chat, pega el prompt que se guardó en tu portapapeles.",
    "Adjunta el tipo de archivo que habías elegido.",
    "Guarda bien la respuesta que te entregue la IA para traerla de vuelta a esta página.",
  ].join("\n\n");
}

function construirPanelImportacion() {
  const cfg = estado.datos.configuracion;
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const titulo = document.createElement("h2");
  titulo.style.margin = "0";
  titulo.textContent = "Importar tu Plan de Estudios";
  sec.appendChild(titulo);

  if (cfg.modo_hardcore) {
    const etiqueta = document.createElement("span");
    etiqueta.className = "form-label";
    etiqueta.textContent = "Esta malla corresponde al plan:";
    const grupo = document.createElement("div");
    grupo.className = "pill-group";
    [
      { valor: "principal", texto: "Principal" },
      { valor: "secundario", texto: "Secundario 💀" },
    ].forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + ((estado.planImportandoId || "principal") === op.valor ? " active" : "");
      btn.textContent = op.texto;
      btn.addEventListener("click", () => {
        estado.planImportandoId = op.valor;
        renderizarPlanEstudios();
      });
      grupo.appendChild(btn);
    });
    sec.appendChild(etiqueta);
    sec.appendChild(grupo);
  } else {
    estado.planImportandoId = "principal";
  }

  // ---- Universidad / tipos de horas (necesario ANTES de generar el prompt,
  // porque las columnas de horas del CSV dependen de esto). ----
  const etiquetaUni = document.createElement("span");
  etiquetaUni.className = "form-label";
  etiquetaUni.textContent = "¿De qué universidad es este plan?";
  sec.appendChild(etiquetaUni);

  const grupoUni = document.createElement("div");
  grupoUni.className = "pill-group";
  [
    { valor: "TEC", texto: "TEC" },
    { valor: "UCR", texto: "UCR" },
    { valor: "Otra", texto: "Otra / Personalizada" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.universidadImportacion === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.universidadImportacion = op.valor;
      if (op.valor !== "Otra") {
        estado.tiposHorasImportacion = PRESETS_TIPOS_HORAS[op.valor].slice();
      }
      renderizarPlanEstudios();
    });
    grupoUni.appendChild(btn);
  });
  sec.appendChild(grupoUni);

  if (estado.universidadImportacion === "Otra") {
    const inputTipos = document.createElement("input");
    inputTipos.type = "text";
    inputTipos.className = "form-input";
    inputTipos.placeholder = "Tipos de horas separados por coma, ej. Teoría, Laboratorio";
    inputTipos.value = estado.tiposHorasPersonalizadoTexto;
    inputTipos.addEventListener("input", () => {
      estado.tiposHorasPersonalizadoTexto = inputTipos.value;
      estado.tiposHorasImportacion = inputTipos.value.split(",").map((t) => t.trim()).filter(Boolean);
    });
    sec.appendChild(inputTipos);
  }

  // ---- Modo de importación: Link / PDF / Capturas ----
  const etiquetaModo = document.createElement("span");
  etiquetaModo.className = "form-label";
  etiquetaModo.textContent = "¿Cómo quieres traer tu plan de estudios?";
  sec.appendChild(etiquetaModo);

  const grupoModo = document.createElement("div");
  grupoModo.className = "pill-group";
  [
    { valor: "link", texto: "Pegar link" },
    { valor: "pdf", texto: "Adjuntar PDF" },
    { valor: "capturas", texto: "Tomar capturas" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.modoImportacion === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.modoImportacion = op.valor;
      renderizarPlanEstudios();
    });
    grupoModo.appendChild(btn);
  });
  sec.appendChild(grupoModo);

  if (estado.modoImportacion === "link") {
    const inputLink = document.createElement("input");
    inputLink.type = "text";
    inputLink.className = "form-input";
    inputLink.placeholder = "https://tu-universidad.ac.cr/tu-plan-de-estudios";
    inputLink.value = estado.linkImportacion;
    inputLink.addEventListener("input", () => {
      estado.linkImportacion = inputLink.value;
    });
    sec.appendChild(inputLink);

    const avisoNavegacion = document.createElement("p");
    avisoNavegacion.className = "muted";
    avisoNavegacion.textContent = "Este modo requiere que tu IA tenga activada la navegación web.";
    sec.appendChild(avisoNavegacion);
  } else if (estado.modoImportacion === "pdf") {
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Vas a adjuntar tu PDF directamente en la ventana de Claude o ChatGPT que se abra.";
    sec.appendChild(nota);
  } else if (estado.modoImportacion === "capturas") {
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Vas a adjuntar una o varias fotos/capturas directamente en la ventana de Claude o ChatGPT que se abra.";
    sec.appendChild(nota);
  }

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";

  const btnClaude = document.createElement("button");
  btnClaude.className = "btn btn-primary";
  btnClaude.style.flex = "1";
  btnClaude.textContent = "Enviar a Claude";
  btnClaude.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(estado.tiposHorasImportacion);
    abrirModalInstruccionesImportacion(
      estado.modoImportacion,
      "claude",
      construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras)
    );
  });
  filaBotones.appendChild(btnClaude);

  const btnChatGPT = document.createElement("button");
  btnChatGPT.className = "btn btn-secondary";
  btnChatGPT.style.flex = "1";
  btnChatGPT.textContent = "Enviar a ChatGPT";
  btnChatGPT.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(estado.tiposHorasImportacion);
    abrirModalInstruccionesImportacion(
      estado.modoImportacion,
      "chatgpt",
      construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras)
    );
  });
  filaBotones.appendChild(btnChatGPT);

  sec.appendChild(filaBotones);

  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.id = "textarea-csv-importar";
  textarea.rows = 8;
  textarea.placeholder = "Pega aquí el CSV que te devolvió la IA…";
  sec.appendChild(textarea);

  sec.appendChild(construirInputArchivoCSV(textarea));

  const errores = document.createElement("div");
  errores.id = "errores-importacion-csv";
  errores.className = "stack oculto";
  sec.appendChild(errores);

  const btnImportar = document.createElement("button");
  btnImportar.className = "btn btn-secondary btn-block";
  btnImportar.textContent = "Importar";
  btnImportar.addEventListener("click", () => manejarClickImportar(textarea.value));
  sec.appendChild(btnImportar);

  return sec;
}

/** Ajuste v4 #8: además de pegar el CSV como texto, se puede subir un
 *  archivo .csv — se lee su contenido y se coloca en el textarea indicado,
 *  para que se procese exactamente igual que si se hubiera pegado a mano. */
function construirInputArchivoCSV(textareaDestino) {
  const wrap = document.createElement("div");
  wrap.className = "stack";
  wrap.style.gap = "4px";

  const etiqueta = document.createElement("span");
  etiqueta.className = "muted";
  etiqueta.textContent = "…o sube directamente el archivo .csv:";
  wrap.appendChild(etiqueta);

  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv";
  input.className = "form-input";
  input.addEventListener("change", () => {
    const archivo = input.files && input.files[0];
    if (!archivo) return;
    const lector = new FileReader();
    lector.onload = () => { textareaDestino.value = String(lector.result || ""); };
    lector.onerror = () => { mostrarErroresImportacion(["No se pudo leer el archivo. Intenta pegar el CSV como texto."]); };
    lector.readAsText(archivo);
  });
  wrap.appendChild(input);

  return wrap;
}

async function copiarPromptImportacion(texto) {
  try {
    await navigator.clipboard.writeText(texto);
    mostrarToast("✓ Prompt copiado en el portapapeles");
  } catch (e) {
    console.warn("No se pudo copiar automáticamente, el usuario deberá copiarlo a mano.", e);
  }
}

async function enviarPromptAClaude(texto) {
  await copiarPromptImportacion(texto);
  window.open("https://claude.ai/new", "_blank", "noopener");
}

async function enviarPromptAChatGPT(texto) {
  await copiarPromptImportacion(texto);
  window.open("https://chatgpt.com/", "_blank", "noopener");
}

/* ===================== Modal de instrucciones antes de enviar (v6) ===================== */

/** Guarda qué acción ejecutar si el usuario presiona "Aceptar" en el modal
 *  de instrucciones — null mientras el modal está cerrado. */
let instruccionesImportacionPendiente = null;

const NOMBRE_IA = { claude: "Claude", chatgpt: "ChatGPT" };

/**
 * v6 nuevo: en vez de copiar y redirigir de inmediato al presionar "Enviar a
 * Claude/ChatGPT", primero se muestra este modal con las instrucciones
 * completas (adaptadas al modo Link/PDF/Capturas). Solo al presionar
 * "Aceptar" se ejecuta la acción real (copiar + abrir la IA en pestaña nueva).
 */
function abrirModalInstruccionesImportacion(modo, destino, textoPrompt) {
  instruccionesImportacionPendiente = { destino, textoPrompt };
  document.getElementById("titulo-modal-instrucciones-importacion").textContent =
    `Antes de ir a ${NOMBRE_IA[destino] || "la IA"}…`;
  document.getElementById("cuerpo-modal-instrucciones-importacion").textContent =
    construirTextoInstruccionesImportacion(destino);
  document.getElementById("modal-instrucciones-importacion").classList.remove("oculto");
}

function cerrarModalInstruccionesImportacion() {
  instruccionesImportacionPendiente = null;
  document.getElementById("modal-instrucciones-importacion").classList.add("oculto");
}

function inicializarModalInstruccionesImportacion() {
  document.getElementById("btn-cancelar-instrucciones-importacion").addEventListener("click", cerrarModalInstruccionesImportacion);
  document.getElementById("modal-instrucciones-importacion").addEventListener("click", (e) => {
    if (e.target.id === "modal-instrucciones-importacion") cerrarModalInstruccionesImportacion();
  });
  document.getElementById("btn-aceptar-instrucciones-importacion").addEventListener("click", () => {
    if (!instruccionesImportacionPendiente) return;
    const { destino, textoPrompt } = instruccionesImportacionPendiente;
    document.getElementById("modal-instrucciones-importacion").classList.add("oculto");
    instruccionesImportacionPendiente = null;
    if (destino === "chatgpt") enviarPromptAChatGPT(textoPrompt);
    else enviarPromptAClaude(textoPrompt);
  });
}

/* ===================== Parser de CSV ===================== */

/** Parser simple de una línea CSV que sí respeta comillas dobles (por si algún nombre trae comas). */
function parsearLineaCSV(linea) {
  const campos = [];
  let actual = "";
  let dentroComillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (c === '"') {
      dentroComillas = !dentroComillas;
    } else if (c === "," && !dentroComillas) {
      campos.push(actual.trim());
      actual = "";
    } else {
      actual += c;
    }
  }
  campos.push(actual.trim());
  return campos;
}

/**
 * Parsea el CSV completo para un plan con estos `tiposHoras` (array de
 * llaves, ej. ["Horas"] para TEC o ["Teoría","Práctica","Laboratorio",
 * "Teoría-Práctica"] para UCR). Devuelve { materias: [...], errores: [...] }.
 * Nunca lanza excepción: una fila mala se reporta y se salta, sin romper el
 * resto del import.
 *
 * Las columnas de horas se leen dinámicamente: primero se busca en el
 * encabezado pegado cuántas columnas empiezan con "Horas_" y en qué
 * posición están; si por algún motivo la IA no las nombró así, se cae de
 * vuelta a la posición fija esperada (justo después de Creditos, tantas
 * como tiposHoras.length) para no romper el import.
 */
function parsearCSVPlanEstudios(textoCrudo, tiposHoras) {
  const tipos = tiposHoras && tiposHoras.length ? tiposHoras : ["Horas"];

  const lineas = textoCrudo
    .replace(/```[a-zA-Z]*\n?/g, "") // por si el usuario pegó el bloque con los ``` incluidos
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) return { materias: [], errores: ["El CSV está vacío."] };

  const encabezado = parsearLineaCSV(lineas[0]);
  const indicesHoras = [];
  encabezado.forEach((col, i) => {
    if (/^Horas_/i.test(col)) indicesHoras.push(i);
  });

  const idxHorasInicio = indicesHoras.length > 0 ? indicesHoras[0] : 4;
  const cantidadHoras = indicesHoras.length > 0 ? indicesHoras.length : tipos.length;
  const columnasEsperadas = 4 + cantidadHoras + 2; // Bloque,Codigo,Nombre,Creditos + horas + Requisitos,Correquisitos

  // La primera fila se asume encabezado y se descarta.
  const filas = lineas.slice(1);
  const materias = [];
  const errores = [];

  filas.forEach((linea, indice) => {
    const numeroFila = indice + 2; // +2 = +1 por el encabezado, +1 por ser 1-indexado
    const columnas = parsearLineaCSV(linea);

    if (columnas.length !== columnasEsperadas) {
      errores.push(`Fila ${numeroFila}: se esperaban ${columnasEsperadas} columnas y se encontraron ${columnas.length}. Contenido: "${linea}"`);
      return;
    }

    const bloque = columnas[0];
    const codigo = columnas[1];
    const nombre = columnas[2];
    const creditos = columnas[3];
    const columnasHorasFila = columnas.slice(idxHorasInicio, idxHorasInicio + cantidadHoras);
    const requisitos = columnas[idxHorasInicio + cantidadHoras];
    const correquisitos = columnas[idxHorasInicio + cantidadHoras + 1];

    if (!codigo || !nombre) {
      errores.push(`Fila ${numeroFila}: falta Código o Nombre.`);
      return;
    }

    const horas = {};
    tipos.forEach((tipo, i) => {
      horas[tipo] = Number(columnasHorasFila[i]) || 0;
    });

    materias.push(
      crearMateria({
        codigo,
        nombre,
        creditos: Number(creditos) || 0,
        horas,
        tiposHoras: tipos,
        bloque: Number(bloque) || bloque,
        requisitos: parsearGrupoRequisitos(requisitos),
        correquisitos: parsearGrupoRequisitos(correquisitos),
      })
    );
  });

  return { materias, errores };
}

function manejarClickImportar(textoCSV) {
  if (!textoCSV || !textoCSV.trim()) {
    mostrarErroresImportacion(["Pega primero el CSV que te devolvió la IA."]);
    return;
  }

  const cfg = estado.datos.configuracion;
  const destinoEsSecundario = cfg.modo_hardcore && estado.planImportandoId === "secundario";
  const planDestinoId = destinoEsSecundario ? cfg.plan_activo_secundario_id : cfg.plan_activo_id;
  const planDestino = estado.datos.planes_estudio.find((p) => p.id === planDestinoId);

  if (!planDestino) {
    // No existe el plan todavía: se lee CARRERA:/CODIGO_PLAN:/UNIVERSIDAD: si
    // la IA los detectó (v6 #3), se guarda el CSV YA LIMPIO de esas líneas
    // (si no, parsearCSVPlanEstudios las confundiría con el encabezado del
    // CSV) y se pide crear el plan primero, prellenado con lo detectado.
    const { metadatos, csv } = extraerMetadatosImportacion(textoCSV);
    estado.csvPendienteDeImportar = csv;
    abrirModalCrearPlan(destinoEsSecundario, metadatos);
    return;
  }

  importarCSVEnPlan(textoCSV, planDestino);
}

function importarCSVEnPlan(textoCSV, planDestino) {
  const { materias, errores } = parsearCSVPlanEstudios(textoCSV, planDestino.parametros_universidad.tipos_horas);

  // Se combina por código: si ya existía, se actualiza; si es nueva, se agrega.
  materias.forEach((nueva) => {
    const existente = planDestino.materias.find((m) => m.codigo === nueva.codigo);
    if (existente) {
      Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
    } else {
      planDestino.materias.push(nueva);
    }
  });

  marcarCambioPendiente();
  mostrarErroresImportacion(errores);
  renderizarPlanEstudios();
}

function mostrarErroresImportacion(lista) {
  const cont = document.getElementById("errores-importacion-csv");
  if (!cont) return;
  if (!lista || lista.length === 0) {
    cont.classList.add("oculto");
    cont.innerHTML = "";
    return;
  }
  cont.classList.remove("oculto");
  cont.innerHTML =
    `<p class="muted" style="color:var(--color-danger);">Algunas filas no se pudieron importar:</p>` +
    lista.map((e) => `<p class="muted" style="color:var(--color-danger);">• ${e}</p>`).join("");
}

/* ===================== Modal: crear Plan de Estudios ===================== */

/** v6 #2: aplica un ejemplo al azar (de EJEMPLOS_PLACEHOLDER_PLAN, ya
 *  definido más arriba) como placeholder de Carrera/Código — nunca como
 *  valor real precargado. Antes existía elegirPlaceholderPlan() pero nunca
 *  se llamaba desde ningún lado; esto es lo que faltaba conectar. */
function aplicarPlaceholdersAleatoriosPlan(universidad) {
  const ejemplo = elegirPlaceholderPlan(universidad);
  document.getElementById("input-plan-nombre-carrera").placeholder = `Ej. ${ejemplo.carrera}`;
  document.getElementById("input-plan-codigo").placeholder = `Ej. ${ejemplo.codigo}`;
}

/** Intenta mapear el texto libre de UNIVERSIDAD: (ej. "Tecnológico de Costa
 *  Rica", "TEC", "Universidad de Costa Rica") a uno de los pills conocidos.
 *  Si no reconoce nada, cae en "Otra" (nunca revienta, nunca inventa). */
function mapearUniversidadDetectada(texto) {
  const t = (texto || "").toUpperCase();
  if (t.includes("TEC") || t.includes("TECNOLÓGICO") || t.includes("TECNOLOGICO")) return "TEC";
  if (t.includes("UCR") || t.includes("COSTA RICA")) return "UCR";
  return "Otra";
}

function abrirModalCrearPlan(paraSecundario, metadatosDetectados) {
  estado.planCrearParaSecundario = !!paraSecundario;
  const inputCarrera = document.getElementById("input-plan-nombre-carrera");
  const inputCodigo = document.getElementById("input-plan-codigo");
  inputCarrera.value = "";
  inputCodigo.value = "";
  document.getElementById("error-modal-crear-plan").classList.add("oculto");

  // v6 #3: si la IA logró identificar carrera/código/universidad, se
  // prellenan aquí como VALOR real (editable), no como placeholder.
  const metadatos = metadatosDetectados || {};
  if (metadatos.carrera) inputCarrera.value = metadatos.carrera;
  if (metadatos.codigo_plan) inputCodigo.value = metadatos.codigo_plan;

  // Se preselecciona con la universidad detectada por la IA si vino; si no,
  // con lo que el usuario ya haya elegido en el selector del panel de
  // importación (estado.universidadImportacion), así no se le vuelve a
  // preguntar dos veces lo mismo.
  const universidadInicial = metadatos.universidad
    ? mapearUniversidadDetectada(metadatos.universidad)
    : (estado.universidadImportacion || "TEC");
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  const btnInicial = pillUni.querySelector(`[data-valor="${universidadInicial}"]`) || pillUni.querySelector('[data-valor="TEC"]');
  btnInicial.classList.add("active");
  aplicarPlaceholdersAleatoriosPlan(btnInicial.dataset.valor);

  const inputPersonalizado = document.getElementById("input-tipos-horas-personalizados");
  const bloquePersonalizado = document.getElementById("bloque-tipos-horas-personalizados");
  if (btnInicial.dataset.valor === "Otra") {
    bloquePersonalizado.classList.remove("oculto");
    inputPersonalizado.value = estado.tiposHorasPersonalizadoTexto || "";
  } else {
    bloquePersonalizado.classList.add("oculto");
    aplicarDefaultsUniversidad(btnInicial.dataset.valor);
  }

  document.getElementById("modal-crear-plan").classList.remove("oculto");
}

function aplicarDefaultsUniversidad(universidad) {
  const defaults = PARAMETROS_UNIVERSIDAD_DEFAULT[universidad] || PARAMETROS_UNIVERSIDAD_DEFAULT.TEC;
  document.getElementById("input-plan-nombre-bloque").value = defaults.nombre_bloque;
  document.getElementById("input-plan-semanas").value = defaults.semanas_por_bloque;
  document.getElementById("input-plan-hora-inicio").value = defaults.horario_inicio_default;
  document.getElementById("input-plan-duracion").value = defaults.horario_duracion_bloque_min;
}

/** Lee la lista de tipos de horas seleccionada en el modal en este momento
 *  (según el pill de universidad activo), sin importar si es TEC/UCR/Personalizada. */
function leerTiposHorasDelModalCrearPlan() {
  const universidad = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
  if (universidad === "Otra") {
    const texto = document.getElementById("input-tipos-horas-personalizados").value;
    const tipos = texto.split(",").map((t) => t.trim()).filter(Boolean);
    return tipos.length ? tipos : ["Horas"];
  }
  return (PRESETS_TIPOS_HORAS[universidad] || PRESETS_TIPOS_HORAS.TEC).slice();
}

function inicializarModalCrearPlan() {
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      aplicarPlaceholdersAleatoriosPlan(btn.dataset.valor);
      const bloquePersonalizado = document.getElementById("bloque-tipos-horas-personalizados");
      if (btn.dataset.valor === "TEC" || btn.dataset.valor === "UCR") {
        bloquePersonalizado.classList.add("oculto");
        aplicarDefaultsUniversidad(btn.dataset.valor);
      } else {
        bloquePersonalizado.classList.remove("oculto");
      }
    });
  });

  document.getElementById("btn-cancelar-crear-plan").addEventListener("click", () => {
    estado.csvPendienteDeImportar = null;
    document.getElementById("modal-crear-plan").classList.add("oculto");
    if (estado.reabrirGestionPlanesTrasCrear) {
      estado.reabrirGestionPlanesTrasCrear = false;
      abrirModalGestionPlanes();
    }
  });

  document.getElementById("btn-confirmar-crear-plan").addEventListener("click", () => {
    const nombreCarrera = document.getElementById("input-plan-nombre-carrera").value.trim();
    if (!nombreCarrera) {
      const err = document.getElementById("error-modal-crear-plan");
      err.textContent = "El nombre de la carrera es obligatorio.";
      err.classList.remove("oculto");
      return;
    }
    if (estado.datos.planes_estudio.length >= LIMITE_PLANES_ESTUDIO) {
      const err = document.getElementById("error-modal-crear-plan");
      err.textContent = `Ya tienes el máximo de ${LIMITE_PLANES_ESTUDIO} planes.`;
      err.classList.remove("oculto");
      return;
    }
    const universidad = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
    const tiposHoras = leerTiposHorasDelModalCrearPlan();
    if (universidad === "Otra") {
      // Se recuerda el texto crudo para la próxima vez que abran este modal.
      estado.tiposHorasPersonalizadoTexto = document.getElementById("input-tipos-horas-personalizados").value;
    }
    const codigoPlan = document.getElementById("input-plan-codigo").value.trim();

    const nuevoPlan = crearPlanEstudio({
      nombre_carrera: nombreCarrera,
      universidad,
      codigo_plan: codigoPlan,
      parametros_universidad: {
        nombre_bloque: document.getElementById("input-plan-nombre-bloque").value.trim() || "Semestre",
        semanas_por_bloque: Number(document.getElementById("input-plan-semanas").value) || 16,
        horario_inicio_default: document.getElementById("input-plan-hora-inicio").value || "07:30",
        horario_duracion_bloque_min: Number(document.getElementById("input-plan-duracion").value) || 50,
        tipos_horas: tiposHoras,
      },
    });

    estado.datos.planes_estudio.push(nuevoPlan);
    if (estado.planCrearParaSecundario) {
      estado.datos.configuracion.plan_activo_secundario_id = nuevoPlan.id;
    } else if (!estado.datos.configuracion.plan_activo_id) {
      estado.datos.configuracion.plan_activo_id = nuevoPlan.id;
    }

    marcarCambioPendiente();
    document.getElementById("modal-crear-plan").classList.add("oculto");

    if (estado.csvPendienteDeImportar) {
      importarCSVEnPlan(estado.csvPendienteDeImportar, nuevoPlan);
      estado.csvPendienteDeImportar = null;
    } else {
      renderizarSelectorPlan();
      renderizarModoHardcore();
      renderizarPlanEstudios();
    }

    if (estado.reabrirGestionPlanesTrasCrear) {
      estado.reabrirGestionPlanesTrasCrear = false;
      abrirModalGestionPlanes();
    }
  });
}

/* ===================== B.4 — Gestión de Planes de Estudio (máximo 3) ===================== */

function abrirModalGestionPlanes() {
  renderizarListaGestionPlanes();
  renderizarModoHardcore();
  document.getElementById("modal-gestion-planes").classList.remove("oculto");
}

/** v5 1.4: tarjetas arrastrables para reordenar los planes — la primera del
 *  orden es automáticamente la favorita/principal (estrella a la derecha,
 *  sin botón de estrella aparte). Reordenar NO cambia cuál es plan_activo_id
 *  (eso lo sigue controlando el carrusel del encabezado); solo cambia el
 *  orden de la lista y por lo tanto cuál queda marcada como favorita. */
function renderizarListaGestionPlanes() {
  const cont = document.getElementById("lista-gestion-planes");
  cont.innerHTML = "";
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún plan.</p>`;
  }

  planes.forEach((plan, indice) => {
    const fila = document.createElement("div");
    fila.className = "glass-panel row-between plan-gestion-fila";
    fila.style.padding = "10px 14px";
    fila.style.flexWrap = "wrap";
    fila.style.gap = "8px";
    fila.draggable = true;
    fila.dataset.planId = plan.id;

    const info = document.createElement("span");
    info.textContent =
      `${plan.universidad} · ${aplicarFormatoTexto(plan.nombre_carrera)}` +
      (plan.codigo_plan ? ` (${plan.codigo_plan})` : "") +
      (plan.materias.length === 0 ? " — sin materias" : ` — ${plan.materias.length} materias`);
    fila.appendChild(info);

    const derecha = document.createElement("div");
    derecha.className = "row";

    const btnEliminar = document.createElement("button");
    btnEliminar.className = "btn btn-danger";
    btnEliminar.textContent = "Eliminar";
    btnEliminar.addEventListener("click", () => {
      abrirConfirmacion({
        titulo: "Eliminar Plan de Estudios",
        mensaje: `¿Seguro que quieres eliminar "${plan.nombre_carrera}"? Se perderán todas sus materias y categorías.`,
        textoConfirmar: "Eliminar definitivamente",
        onConfirmar: () => eliminarPlanEstudio(plan.id),
      });
    });
    derecha.appendChild(btnEliminar);

    if (indice === 0) {
      const estrella = document.createElement("span");
      estrella.className = "plan-gestion-estrella";
      estrella.title = "Plan favorito/principal";
      estrella.textContent = "★";
      derecha.appendChild(estrella);
    }

    fila.appendChild(derecha);

    // ---- Drag and drop para reordenar ----
    fila.addEventListener("dragstart", () => {
      estado.arrastrandoPlanId = plan.id;
      fila.classList.add("arrastrando");
    });
    fila.addEventListener("dragend", () => {
      fila.classList.remove("arrastrando");
      estado.arrastrandoPlanId = null;
      document.querySelectorAll(".plan-gestion-fila.sobre-drop").forEach((el) => el.classList.remove("sobre-drop"));
    });
    fila.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (estado.arrastrandoPlanId && estado.arrastrandoPlanId !== plan.id) fila.classList.add("sobre-drop");
    });
    fila.addEventListener("dragleave", () => fila.classList.remove("sobre-drop"));
    fila.addEventListener("drop", (e) => {
      e.preventDefault();
      fila.classList.remove("sobre-drop");
      const origenId = estado.arrastrandoPlanId;
      if (!origenId || origenId === plan.id) return;
      const idxOrigen = estado.datos.planes_estudio.findIndex((p) => p.id === origenId);
      const idxDestino = estado.datos.planes_estudio.findIndex((p) => p.id === plan.id);
      if (idxOrigen === -1 || idxDestino === -1) return;
      const [movido] = estado.datos.planes_estudio.splice(idxOrigen, 1);
      estado.datos.planes_estudio.splice(idxDestino, 0, movido);
      marcarCambioPendiente();
      renderizarListaGestionPlanes();
    });

    cont.appendChild(fila);
  });

  const btnAgregar = document.getElementById("btn-agregar-plan-gestion");
  const aviso = document.getElementById("aviso-limite-planes");
  const alcanzoLimite = planes.length >= LIMITE_PLANES_ESTUDIO;
  btnAgregar.disabled = alcanzoLimite;
  aviso.classList.toggle("oculto", !alcanzoLimite);
}

/**
 * Componente de importación/actualización, SIEMPRE inline (v5 1.1/1.3):
 * exactamente el mismo componente visual se usa para el primer import de un
 * plan (ver construirPanelImportacion, antes de que el plan exista) y para
 * actualizar la malla de un plan ya existente — nunca en una ventana flotante.
 */
function construirMiniPanelImportacion(plan) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const titulo = document.createElement("h2");
  titulo.style.margin = "0";
  titulo.textContent = plan.materias.length === 0 ? "Importar malla" : "Actualizar malla";
  sec.appendChild(titulo);

  // Aquí el plan ya existe, así que las columnas de horas se toman
  // directamente de su tipos_horas — no hace falta preguntarlas de nuevo.
  const grupoModo = document.createElement("div");
  grupoModo.className = "pill-group";
  [
    { valor: "link", texto: "Pegar link" },
    { valor: "pdf", texto: "Adjuntar PDF" },
    { valor: "capturas", texto: "Tomar capturas" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.modoImportacion === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.modoImportacion = op.valor;
      renderizarPlanEstudios();
    });
    grupoModo.appendChild(btn);
  });
  sec.appendChild(grupoModo);

  let inputLink = null;
  if (estado.modoImportacion === "link") {
    inputLink = document.createElement("input");
    inputLink.type = "text";
    inputLink.className = "form-input";
    inputLink.placeholder = "https://tu-universidad.ac.cr/tu-plan-de-estudios";
    inputLink.value = estado.linkImportacion;
    inputLink.addEventListener("input", () => {
      estado.linkImportacion = inputLink.value;
      actualizarEstadoBotonesEnvioImportacion();
    });
    sec.appendChild(inputLink);

    const avisoNavegacion = document.createElement("p");
    avisoNavegacion.className = "muted";
    avisoNavegacion.textContent = "Este modo requiere que tu IA tenga activada la navegación web.";
    sec.appendChild(avisoNavegacion);
  }

  // v5 1.3: selector de IA destino + botón de envío deshabilitado si el
  // modo es "link" y el campo está vacío.
  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  const btnClaude = document.createElement("button");
  btnClaude.id = "btn-enviar-import-claude";
  btnClaude.className = "btn btn-primary";
  btnClaude.style.flex = "1";
  btnClaude.textContent = "Enviar a Claude";
  btnClaude.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(plan.parametros_universidad.tipos_horas);
    abrirModalInstruccionesImportacion(
      estado.modoImportacion,
      "claude",
      construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras)
    );
  });
  const btnChatGPT = document.createElement("button");
  btnChatGPT.id = "btn-enviar-import-chatgpt";
  btnChatGPT.className = "btn btn-secondary";
  btnChatGPT.style.flex = "1";
  btnChatGPT.textContent = "Enviar a ChatGPT";
  btnChatGPT.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(plan.parametros_universidad.tipos_horas);
    abrirModalInstruccionesImportacion(
      estado.modoImportacion,
      "chatgpt",
      construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras)
    );
  });
  filaBotones.appendChild(btnClaude);
  filaBotones.appendChild(btnChatGPT);
  sec.appendChild(filaBotones);

  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.rows = 6;
  textarea.placeholder = "Pega aquí el CSV que te devolvió la IA…";
  sec.appendChild(textarea);
  sec.appendChild(construirInputArchivoCSV(textarea));

  const resultado = document.createElement("div");
  resultado.className = "stack";
  sec.appendChild(resultado);

  const btnImportar = document.createElement("button");
  btnImportar.className = "btn btn-primary btn-block";
  btnImportar.textContent = "Importar";
  btnImportar.addEventListener("click", () => {
    if (!textarea.value.trim()) {
      resultado.innerHTML = `<p class="muted" style="color:var(--color-danger);">Pega primero el CSV.</p>`;
      return;
    }
    // v5 1.3: si la IA detectó carrera/código/universidad, se leen aquí
    // (sin romperse si no vienen) — solo se usan para actualizar los datos
    // de encabezado del plan si el usuario los dejó vacíos originalmente.
    const { metadatos, csv } = extraerMetadatosImportacion(textarea.value);
    if (metadatos.carrera && !plan.nombre_carrera) plan.nombre_carrera = metadatos.carrera;
    if (metadatos.codigo_plan && !plan.codigo_plan) plan.codigo_plan = metadatos.codigo_plan;

    const { materias, errores } = parsearCSVPlanEstudios(csv, plan.parametros_universidad.tipos_horas);
    materias.forEach((nueva) => {
      const existente = plan.materias.find((m) => m.codigo === nueva.codigo);
      if (existente) Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
      else plan.materias.push(nueva);
    });
    marcarCambioPendiente();
    resultado.innerHTML = errores.length
      ? `<p class="muted" style="color:var(--color-danger);">Algunas filas no se pudieron importar:</p>` +
        errores.map((e) => `<p class="muted" style="color:var(--color-danger);">• ${e}</p>`).join("")
      : `<p class="muted" style="color:#34d399;">¡Listo! ${materias.length} materias procesadas.</p>`;
    estado.panelImportacionAbierto = false;
    renderizarPlanEstudios();
  });
  sec.appendChild(btnImportar);

  setTimeout(actualizarEstadoBotonesEnvioImportacion, 0);
  return sec;
}

/** Deshabilita "Enviar a Claude/ChatGPT" si el modo es "link" y el campo
 *  está vacío (v5 1.3). Se llama tras cada render del panel de importación. */
function actualizarEstadoBotonesEnvioImportacion() {
  const btnClaude = document.getElementById("btn-enviar-import-claude");
  const btnChatGPT = document.getElementById("btn-enviar-import-chatgpt");
  if (!btnClaude || !btnChatGPT) return;
  const bloqueado = estado.modoImportacion === "link" && !estado.linkImportacion.trim();
  btnClaude.disabled = bloqueado;
  btnChatGPT.disabled = bloqueado;
  btnClaude.style.opacity = bloqueado ? "0.5" : "";
  btnChatGPT.style.opacity = bloqueado ? "0.5" : "";
}

function eliminarPlanEstudio(planId) {
  const cfg = estado.datos.configuracion;
  estado.datos.planes_estudio = estado.datos.planes_estudio.filter((p) => p.id !== planId);
  if (cfg.plan_activo_id === planId) {
    cfg.plan_activo_id = estado.datos.planes_estudio[0] ? estado.datos.planes_estudio[0].id : null;
  }
  if (cfg.plan_activo_secundario_id === planId) {
    cfg.plan_activo_secundario_id = null;
  }
  marcarCambioPendiente();
  renderizarListaGestionPlanes();
  renderizarSelectorPlan();
  renderizarModoHardcore();
  renderizarPlanEstudios();
}

function inicializarModalGestionPlanes() {
  const cerrarModalGestionPlanes = () => {
    document.getElementById("modal-gestion-planes").classList.add("oculto");
    // El cierre nunca debe depender de si una importación terminó bien o mal;
    // además se resetea el mini-panel abierto para que la próxima vez que se
    // abra la gestión de planes no aparezca "atascada" en modo importación.
    estado.planGestionImportandoId = null;
  };

  document.getElementById("btn-cerrar-gestion-planes").addEventListener("click", cerrarModalGestionPlanes);
  document.getElementById("modal-gestion-planes").addEventListener("click", (e) => {
    if (e.target.id === "modal-gestion-planes") cerrarModalGestionPlanes();
  });
  document.getElementById("btn-agregar-plan-gestion").addEventListener("click", () => {
    document.getElementById("modal-gestion-planes").classList.add("oculto");
    estado.csvPendienteDeImportar = null;
    estado.reabrirGestionPlanesTrasCrear = true;
    abrirModalCrearPlan(false);
  });
}

/* ===================== B.5 — Añadir materia manualmente ===================== */

function abrirModalMateriaManual() {
  const principal = obtenerPlanActivo();
  if (!principal) return;
  const secundario = obtenerPlanSecundario();
  const planesDisponibles = [principal, secundario].filter(Boolean);

  estado.materiaManualPlanId = principal.id;

  const bloquePlan = document.getElementById("bloque-materia-manual-plan");
  const pillPlan = document.getElementById("pill-materia-manual-plan");
  pillPlan.innerHTML = "";

  if (planesDisponibles.length > 1) {
    bloquePlan.classList.remove("oculto");
    planesDisponibles.forEach((plan) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (plan.id === estado.materiaManualPlanId ? " active" : "");
      btn.textContent = `${plan.universidad} · ${plan.nombre_carrera}`;
      btn.addEventListener("click", () => {
        estado.materiaManualPlanId = plan.id;
        pillPlan.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        actualizarFormatoHorasMateriaManual();
      });
      pillPlan.appendChild(btn);
    });
  } else {
    bloquePlan.classList.add("oculto");
  }

  ["input-materia-codigo", "input-materia-nombre", "input-materia-creditos", "input-materia-bloque",
   "input-materia-requisitos", "input-materia-correquisitos"
  ].forEach((id) => { document.getElementById(id).value = ""; });
  document.getElementById("error-modal-materia-manual").classList.add("oculto");

  actualizarFormatoHorasMateriaManual();
  document.getElementById("modal-materia-manual").classList.remove("oculto");
}

/**
 * Genera un <input type="number"> por cada tipo de hora definido en el plan
 * elegido (1 si es TEC, 4 si es UCR, o los que tenga una universidad
 * personalizada) — nunca asume nombres de campos fijos. Cada input queda
 * con id `input-materia-horas-<índice>` y su tipo guardado en un data-attr
 * para poder leerlo de vuelta al guardar.
 */
function actualizarFormatoHorasMateriaManual() {
  const plan = estado.datos.planes_estudio.find((p) => p.id === estado.materiaManualPlanId);
  const tipos = plan && plan.parametros_universidad.tipos_horas && plan.parametros_universidad.tipos_horas.length
    ? plan.parametros_universidad.tipos_horas
    : ["Horas"];

  const cont = document.getElementById("bloque-horas-dinamico");
  cont.innerHTML = "";
  tipos.forEach((tipo, i) => {
    const wrap = document.createElement("div");
    wrap.style.flex = "1";
    wrap.innerHTML = `<span class="form-label">${tipo}</span>`;
    const input = document.createElement("input");
    input.type = "number";
    input.className = "form-input";
    input.id = `input-materia-horas-${i}`;
    input.dataset.tipoHora = tipo;
    wrap.appendChild(input);
    cont.appendChild(wrap);
  });

  document.getElementById("label-materia-bloque").textContent = plan ? plan.parametros_universidad.nombre_bloque : "Bloque";
}

function inicializarModalMateriaManual() {
  document.getElementById("btn-cancelar-materia-manual").addEventListener("click", () => {
    document.getElementById("modal-materia-manual").classList.add("oculto");
  });
  document.getElementById("modal-materia-manual").addEventListener("click", (e) => {
    if (e.target.id === "modal-materia-manual") e.target.classList.add("oculto");
  });

  document.getElementById("btn-guardar-materia-manual").addEventListener("click", () => {
    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.materiaManualPlanId);
    const err = document.getElementById("error-modal-materia-manual");
    const codigo = document.getElementById("input-materia-codigo").value.trim();
    const nombre = document.getElementById("input-materia-nombre").value.trim();
    const creditos = Number(document.getElementById("input-materia-creditos").value) || 0;
    const bloque = Number(document.getElementById("input-materia-bloque").value) || 0;

    if (!plan || !codigo || !nombre) {
      err.textContent = "Código y nombre son obligatorios.";
      err.classList.remove("oculto");
      return;
    }
    if (plan.materias.some((m) => m.codigo === codigo)) {
      err.textContent = "Ya existe una materia con ese código en este plan.";
      err.classList.remove("oculto");
      return;
    }

    const tiposHoras = plan.parametros_universidad.tipos_horas && plan.parametros_universidad.tipos_horas.length
      ? plan.parametros_universidad.tipos_horas
      : ["Horas"];
    const horas = {};
    document.querySelectorAll("#bloque-horas-dinamico [data-tipo-hora]").forEach((input) => {
      horas[input.dataset.tipoHora] = Number(input.value) || 0;
    });

    const nuevaMateria = crearMateria({
      codigo,
      nombre,
      creditos,
      bloque,
      horas,
      tiposHoras,
      requisitos: parsearGrupoRequisitos(document.getElementById("input-materia-requisitos").value),
      correquisitos: parsearGrupoRequisitos(document.getElementById("input-materia-correquisitos").value),
    });

    plan.materias.push(nuevaMateria);
    marcarCambioPendiente();
    document.getElementById("modal-materia-manual").classList.add("oculto");
    renderizarPlanEstudios();
  });
}

/* ===================== Encabezado del plan (carrusel + acciones) ===================== */

function construirEncabezadoPlan(planPrincipal) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const filaTitulo = document.createElement("div");
  filaTitulo.className = "row-between";
  filaTitulo.style.flexWrap = "wrap";
  filaTitulo.style.gap = "10px";

  // v5 1.1: título de 2 líneas, la 2da alineada bajo la 1ra letra de la 1ra.
  const tituloWrap = document.createElement("div");
  tituloWrap.className = "encabezado-plan-titulo";

  const hayCarrusel = estado.datos.planes_estudio.length > 1;
  const linea1 = document.createElement("div");
  linea1.className = "encabezado-plan-linea1";

  if (hayCarrusel) {
    const btnPrev = document.createElement("button");
    btnPrev.className = "flecha-plan";
    btnPrev.type = "button";
    btnPrev.textContent = "‹";
    btnPrev.title = "Plan anterior";
    btnPrev.addEventListener("click", () => navegarPlanCarrusel(-1));
    linea1.appendChild(btnPrev);
  }

  const h2 = document.createElement("h2");
  h2.style.margin = "0";
  h2.textContent = aplicarFormatoTexto(planPrincipal.nombre_carrera);
  linea1.appendChild(h2);

  if (hayCarrusel) {
    const btnNext = document.createElement("button");
    btnNext.className = "flecha-plan";
    btnNext.type = "button";
    btnNext.textContent = "›";
    btnNext.title = "Plan siguiente";
    btnNext.addEventListener("click", () => navegarPlanCarrusel(1));
    linea1.appendChild(btnNext);
  }
  tituloWrap.appendChild(linea1);

  const sub = document.createElement("p");
  sub.className = "muted encabezado-plan-linea2" + (hayCarrusel ? "" : " sin-flechas");
  sub.style.margin = "0";
  sub.textContent = `${planPrincipal.universidad}` + (planPrincipal.codigo_plan ? ` · ${planPrincipal.codigo_plan}` : "");
  tituloWrap.appendChild(sub);
  filaTitulo.appendChild(tituloWrap);
  sec.appendChild(filaTitulo);

  // v5 1.2: fila de botones — Añadir materia / Importar-Actualizar malla (inline) / Gestionar plan.
  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.flexWrap = "wrap";

  const btnMateria = document.createElement("button");
  btnMateria.className = "btn btn-secondary";
  btnMateria.textContent = "+ Añadir materia";
  btnMateria.addEventListener("click", abrirModalMateriaManual);
  botones.appendChild(btnMateria);

  const btnImportar = document.createElement("button");
  btnImportar.className = "btn btn-secondary";
  btnImportar.textContent = estado.panelImportacionAbierto
    ? "Cerrar importación"
    : (planPrincipal.materias.length === 0 ? "Importar malla" : "Actualizar malla");
  btnImportar.addEventListener("click", () => {
    estado.panelImportacionAbierto = !estado.panelImportacionAbierto;
    renderizarPlanEstudios();
  });
  botones.appendChild(btnImportar);

  const btnPlanes = document.createElement("button");
  btnPlanes.className = "btn btn-primary";
  btnPlanes.textContent = "Gestionar plan";
  btnPlanes.addEventListener("click", abrirModalGestionPlanes);
  botones.appendChild(btnPlanes);

  sec.appendChild(botones);
  return sec;
}

function navegarPlanCarrusel(delta) {
  const planes = estado.datos.planes_estudio;
  const idxActual = planes.findIndex((p) => p.id === estado.datos.configuracion.plan_activo_id);
  const nuevoIdx = (idxActual + delta + planes.length) % planes.length;
  estado.datos.configuracion.plan_activo_id = planes[nuevoIdx].id;
  marcarCambioPendiente();
  renderizarSelectorPlan();
  renderizarPlanEstudios();
}

/* ===================== Barra de acciones (orden, buscador, contraer/expandir, exportar) ===================== */

function construirBarraAcciones() {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const grupoOrden = document.createElement("div");
  grupoOrden.className = "pill-group";
  [
    { valor: "bloque", texto: "Ordenar por bloque" },
    { valor: "categoria", texto: "Ordenar por categoría" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.ordenPlanEstudios === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.ordenPlanEstudios = op.valor;
      renderizarPlanEstudios();
    });
    grupoOrden.appendChild(btn);
  });
  sec.appendChild(grupoOrden);

  const buscador = document.createElement("input");
  buscador.type = "text";
  buscador.id = "input-busqueda-plan";
  buscador.className = "form-input";
  buscador.placeholder = "🔎 Buscar materia por nombre o código…";
  buscador.value = estado.busquedaPlanEstudios;
  buscador.addEventListener("input", () => {
    estado.busquedaPlanEstudios = buscador.value;
    const posicionCursor = buscador.selectionStart;
    renderizarPlanEstudios();
    const nuevo = document.getElementById("input-busqueda-plan");
    if (nuevo) {
      nuevo.focus();
      nuevo.setSelectionRange(posicionCursor, posicionCursor);
    }
  });
  sec.appendChild(buscador);

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  filaBotones.style.flexWrap = "wrap";

  const grupoBloques = document.createElement("div");
  grupoBloques.className = "pill-group";
  grupoBloques.title = "Bloques";
  const btnBloquesContraer = document.createElement("button");
  btnBloquesContraer.type = "button";
  btnBloquesContraer.className = "pill-item";
  btnBloquesContraer.textContent = "Bloques ▲";
  btnBloquesContraer.addEventListener("click", contraerTodosLosBloques);
  const btnBloquesExpandir = document.createElement("button");
  btnBloquesExpandir.type = "button";
  btnBloquesExpandir.className = "pill-item";
  btnBloquesExpandir.textContent = "Bloques ▼";
  btnBloquesExpandir.addEventListener("click", expandirTodosLosBloques);
  grupoBloques.appendChild(btnBloquesContraer);
  grupoBloques.appendChild(btnBloquesExpandir);
  filaBotones.appendChild(grupoBloques);

  const grupoMaterias = document.createElement("div");
  grupoMaterias.className = "pill-group";
  grupoMaterias.title = "Materias";
  const btnMateriasContraer = document.createElement("button");
  btnMateriasContraer.type = "button";
  btnMateriasContraer.className = "pill-item";
  btnMateriasContraer.textContent = "Materias ▲";
  btnMateriasContraer.addEventListener("click", contraerTodasLasMaterias);
  const btnMateriasExpandir = document.createElement("button");
  btnMateriasExpandir.type = "button";
  btnMateriasExpandir.className = "pill-item";
  btnMateriasExpandir.textContent = "Materias ▼";
  btnMateriasExpandir.addEventListener("click", expandirTodasLasMaterias);
  grupoMaterias.appendChild(btnMateriasContraer);
  grupoMaterias.appendChild(btnMateriasExpandir);
  filaBotones.appendChild(grupoMaterias);

  const btnExportar = document.createElement("button");
  btnExportar.className = "btn btn-primary";
  btnExportar.textContent = "Exportar CSV";
  btnExportar.addEventListener("click", exportarPlanACSV);
  filaBotones.appendChild(btnExportar);

  sec.appendChild(filaBotones);
  return sec;
}

function obtenerClavesAgrupacionActuales() {
  const claves = new Set();
  obtenerMateriasVisibles().forEach((f) => {
    claves.add(estado.ordenPlanEstudios === "categoria" ? f.materia.categoria_id || "sin_categoria" : String(f.materia.bloque));
  });
  return claves;
}

/* Ajuste 2: Bloques y Materias se contraen/expanden de forma INDEPENDIENTE
 * (antes era un solo par "Contraer todo"/"Expandir todo" que movía ambos
 * niveles a la vez). */
function contraerTodosLosBloques() {
  estado.bloquesColapsados = obtenerClavesAgrupacionActuales();
  renderizarPlanEstudios();
}

function expandirTodosLosBloques() {
  estado.bloquesColapsados = new Set();
  renderizarPlanEstudios();
}

function contraerTodasLasMaterias() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, false));
  renderizarPlanEstudios();
}

function expandirTodasLasMaterias() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, true));
  renderizarPlanEstudios();
}

function exportarPlanACSV() {
  const principal = obtenerPlanActivo();
  if (!principal) return;

  const tipos = principal.parametros_universidad.tipos_horas && principal.parametros_universidad.tipos_horas.length
    ? principal.parametros_universidad.tipos_horas
    : ["Horas"];

  const encabezado = `${construirEncabezadoCSV(tipos)},Estado,CategoriaId`;
  const filas = principal.materias.map((m) => {
    const columnasHoras = tipos.map((tipo) => (m.horas || {})[tipo] || 0);
    const campos = [
      m.bloque,
      m.codigo,
      `"${(m.nombre || "").replace(/"/g, '""')}"`,
      m.creditos,
      ...columnasHoras,
      serializarGrupoRequisitos(m.requisitos),
      serializarGrupoRequisitos(m.correquisitos),
      m.estado,
      m.categoria_id || "",
    ];
    return campos.join(",");
  });

  const csv = [encabezado, ...filas].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `plan_estudios_${(principal.nombre_carrera || "malla").replace(/\s+/g, "_")}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ===================== Estadísticas colapsables (donuts) — v5 #3 ===================== */

/**
 * Construye un anillo tipo "Instagram story ring" (donut sin centro) usando
 * dos <circle> superpuestos con stroke-dasharray: uno de fondo (track) y
 * uno de progreso. `porcentaje` va de 0 a 100.
 */
function construirAnilloDonut(porcentaje, colorProgreso) {
  const radio = 46;
  const circunferencia = 2 * Math.PI * radio;
  const pct = Math.max(0, Math.min(100, porcentaje));
  const offset = circunferencia * (1 - pct / 100);

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.setAttribute("width", "120");
  svg.setAttribute("height", "120");

  const track = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  track.setAttribute("cx", "60");
  track.setAttribute("cy", "60");
  track.setAttribute("r", String(radio));
  track.setAttribute("fill", "none");
  track.setAttribute("stroke", "var(--accent-1-10)");
  track.setAttribute("stroke-width", "12");

  const progreso = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  progreso.setAttribute("cx", "60");
  progreso.setAttribute("cy", "60");
  progreso.setAttribute("r", String(radio));
  progreso.setAttribute("fill", "none");
  progreso.setAttribute("stroke", colorProgreso);
  progreso.setAttribute("stroke-width", "12");
  progreso.setAttribute("stroke-linecap", "round");
  progreso.setAttribute("stroke-dasharray", `${circunferencia}`);
  progreso.setAttribute("stroke-dashoffset", `${offset}`);
  progreso.setAttribute("transform", "rotate(-90 60 60)");

  const texto = document.createElementNS("http://www.w3.org/2000/svg", "text");
  texto.setAttribute("x", "60");
  texto.setAttribute("y", "60");
  texto.setAttribute("text-anchor", "middle");
  texto.setAttribute("dominant-baseline", "central");
  texto.setAttribute("fill", "var(--text-primary)");
  texto.setAttribute("font-size", "22");
  texto.setAttribute("font-weight", "700");
  texto.textContent = `${Math.round(pct)}%`;

  svg.appendChild(track);
  svg.appendChild(progreso);
  svg.appendChild(texto);
  return svg;
}

/**
 * Sección colapsable "Estadísticas" (v5 #3): colapsada por defecto. Muestra
 * dos donuts — avance de Materias y avance de Créditos — comparando
 * aprobado vs. pendiente. Se coloca entre el encabezado del plan y el
 * buscador/categorías (ver orden en renderizarPlanEstudios).
 */
function construirPanelEstadisticas(plan) {
  const materias = plan.materias || [];
  const totalMaterias = materias.length;
  const materiasAprobadas = materias.filter((m) => m.estado === "aprobado").length;
  const totalCreditos = materias.reduce((sum, m) => sum + (Number(m.creditos) || 0), 0);
  const creditosAprobados = materias
    .filter((m) => m.estado === "aprobado")
    .reduce((sum, m) => sum + (Number(m.creditos) || 0), 0);

  const pctMaterias = totalMaterias ? (materiasAprobadas / totalMaterias) * 100 : 0;
  const pctCreditos = totalCreditos ? (creditosAprobados / totalCreditos) * 100 : 0;

  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const encabezado = document.createElement("div");
  encabezado.className = "estadisticas-encabezado";
  encabezado.addEventListener("click", () => {
    estado.estadisticasAbiertas = !estado.estadisticasAbiertas;
    renderizarPlanEstudios();
  });

  const h3 = document.createElement("h2");
  h3.style.margin = "0";
  h3.textContent = "Estadísticas";
  encabezado.appendChild(h3);

  const icono = document.createElement("span");
  icono.className = "materia-expandir";
  icono.textContent = estado.estadisticasAbiertas ? "▲" : "▼";
  encabezado.appendChild(icono);

  sec.appendChild(encabezado);

  if (estado.estadisticasAbiertas) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "estadisticas-cuerpo";

    if (totalMaterias === 0) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "Todavía no hay materias importadas para calcular el avance.";
      cuerpo.appendChild(p);
    } else {
      const bloqueMaterias = document.createElement("div");
      bloqueMaterias.className = "donut-bloque";
      bloqueMaterias.appendChild(construirAnilloDonut(pctMaterias, "#10b981"));
      const etiquetaM = document.createElement("span");
      etiquetaM.className = "donut-etiqueta";
      etiquetaM.textContent = "Materias";
      const subEtiquetaM = document.createElement("span");
      subEtiquetaM.className = "donut-subetiqueta";
      subEtiquetaM.textContent = `${materiasAprobadas} de ${totalMaterias} aprobadas`;
      bloqueMaterias.appendChild(etiquetaM);
      bloqueMaterias.appendChild(subEtiquetaM);

      const bloqueCreditos = document.createElement("div");
      bloqueCreditos.className = "donut-bloque";
      bloqueCreditos.appendChild(construirAnilloDonut(pctCreditos, "#10b981"));
      const etiquetaC = document.createElement("span");
      etiquetaC.className = "donut-etiqueta";
      etiquetaC.textContent = "Créditos";
      const subEtiquetaC = document.createElement("span");
      subEtiquetaC.className = "donut-subetiqueta";
      subEtiquetaC.textContent = `${creditosAprobados} de ${totalCreditos} aprobados`;
      bloqueCreditos.appendChild(etiquetaC);
      bloqueCreditos.appendChild(subEtiquetaC);

      cuerpo.appendChild(bloqueMaterias);
      cuerpo.appendChild(bloqueCreditos);
    }

    sec.appendChild(cuerpo);
  }

  return sec;
}

/* ===================== Categorías: crear / filtrar / editar ===================== */

function construirPanelCategorias() {
  const principal = obtenerPlanActivo();
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const fila = document.createElement("div");
  fila.className = "row-between";
  const h3 = document.createElement("h2");
  h3.style.margin = "0";
  h3.textContent = "Categorías";
  fila.appendChild(h3);

  const btnAgregar = document.createElement("button");
  btnAgregar.className = "btn btn-primary";
  btnAgregar.textContent = "+ Agregar categoría";
  btnAgregar.addEventListener("click", () => abrirModalCategoria(null, principal));
  fila.appendChild(btnAgregar);
  sec.appendChild(fila);

  if (estado.filtroCategoriaId) {
    const cat = principal.categorias.find((c) => c.id === estado.filtroCategoriaId);
    const filtroActivo = document.createElement("div");
    filtroActivo.className = "row";
    const badge = document.createElement("span");
    badge.className = "badge badge-accent";
    badge.textContent = `Filtrando: ${cat ? cat.nombre : "—"}`;
    const btnX = document.createElement("button");
    btnX.className = "btn btn-secondary";
    btnX.textContent = "× Quitar filtro";
    btnX.addEventListener("click", () => {
      estado.filtroCategoriaId = null;
      renderizarPlanEstudios();
    });
    filtroActivo.appendChild(badge);
    filtroActivo.appendChild(btnX);
    sec.appendChild(filtroActivo);
  }

  if (principal.categorias.length === 0) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "Todavía no has creado ninguna categoría (son 100% manuales).";
    sec.appendChild(p);
  } else {
    const cont = document.createElement("div");
    cont.className = "row";
    cont.style.flexWrap = "wrap";
    principal.categorias.forEach((cat) => {
      const item = document.createElement("div");
      item.className = "row";
      item.style.gap = "4px";

      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "badge";
      chip.style.cssText = estiloBadgeCategoria(cat.color) + "cursor:pointer;" +
        (estado.filtroCategoriaId === cat.id ? "box-shadow:0 0 0 2px var(--text-primary);" : "");
      chip.textContent = cat.nombre;

      // Click corto = filtra. Mantener presionado (~500ms) o click derecho = editar.
      let timerLongPress = null;
      let disparoLargo = false;
      chip.addEventListener("pointerdown", () => {
        disparoLargo = false;
        timerLongPress = setTimeout(() => {
          disparoLargo = true;
          abrirModalCategoria(cat, principal);
        }, 500);
      });
      chip.addEventListener("pointerup", () => {
        clearTimeout(timerLongPress);
        if (!disparoLargo) {
          estado.filtroCategoriaId = estado.filtroCategoriaId === cat.id ? null : cat.id;
          renderizarPlanEstudios();
        }
      });
      chip.addEventListener("pointerleave", () => clearTimeout(timerLongPress));
      chip.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        abrirModalCategoria(cat, principal);
      });

      const btnEditar = document.createElement("button");
      btnEditar.type = "button";
      btnEditar.className = "btn btn-secondary";
      btnEditar.style.cssText = "padding:2px 8px; font-size:0.75rem;";
      btnEditar.title = "Editar categoría";
      btnEditar.textContent = "⚙️";
      btnEditar.addEventListener("click", () => abrirModalCategoria(cat, principal));

      item.appendChild(chip);
      item.appendChild(btnEditar);
      cont.appendChild(item);
    });
    sec.appendChild(cont);
  }

  return sec;
}

function abrirModalCategoria(categoria, plan) {
  estado.categoriaEditandoId = categoria ? categoria.id : null;
  estado.planCategoriaEditandoId = plan.id;

  document.getElementById("titulo-modal-categoria").textContent = categoria ? "Editar categoría" : "Nueva categoría";
  document.getElementById("input-categoria-nombre").value = categoria ? categoria.nombre : "";
  document.getElementById("input-categoria-color").value = categoria ? categoria.color : "#38BDF8";
  document.getElementById("error-modal-categoria").classList.add("oculto");
  document.getElementById("btn-eliminar-categoria").classList.toggle("oculto", !categoria);
  document.getElementById("modal-categoria").classList.remove("oculto");
}

function inicializarModalCategoria() {
  document.getElementById("btn-cancelar-categoria").addEventListener("click", () => {
    document.getElementById("modal-categoria").classList.add("oculto");
  });

  document.getElementById("btn-eliminar-categoria").addEventListener("click", () => {
    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.planCategoriaEditandoId);
    if (!plan || !estado.categoriaEditandoId) return;
    const catId = estado.categoriaEditandoId;
    document.getElementById("modal-categoria").classList.add("oculto");
    abrirConfirmacion({
      titulo: "Eliminar categoría",
      mensaje: "Las materias asignadas quedarán sin categoría. Esta acción no se puede deshacer.",
      textoConfirmar: "Eliminar categoría",
      onConfirmar: () => {
        plan.categorias = plan.categorias.filter((c) => c.id !== catId);
        plan.materias.forEach((m) => {
          if (m.categoria_id === catId) m.categoria_id = null;
        });
        if (estado.filtroCategoriaId === catId) estado.filtroCategoriaId = null;
        marcarCambioPendiente();
        renderizarPlanEstudios();
      },
    });
  });

  document.getElementById("btn-guardar-categoria").addEventListener("click", () => {
    const nombre = document.getElementById("input-categoria-nombre").value.trim();
    const color = document.getElementById("input-categoria-color").value;
    if (!nombre) {
      const err = document.getElementById("error-modal-categoria");
      err.textContent = "El nombre es obligatorio.";
      err.classList.remove("oculto");
      return;
    }

    const plan = estado.datos.planes_estudio.find((p) => p.id === estado.planCategoriaEditandoId);
    let categoria;

    if (estado.categoriaEditandoId) {
      categoria = plan.categorias.find((c) => c.id === estado.categoriaEditandoId);
      categoria.nombre = nombre;
      categoria.color = color;
    } else {
      categoria = crearCategoria({ nombre, color });
      plan.categorias.push(categoria);
    }
    marcarCambioPendiente();
    document.getElementById("modal-categoria").classList.add("oculto");
    abrirModalCategoriaMaterias(plan, categoria);
  });
}

/** Paso 2 del flujo de categorías: elegir qué materias entran, con buscador + orden. */
function abrirModalCategoriaMaterias(plan, categoria) {
  estado.busquedaCategoriaMaterias = "";
  estado.ordenCategoriaMaterias = "bloque";
  document.getElementById("nombre-categoria-materias").textContent = categoria.nombre;
  document.getElementById("modal-categoria-materias").dataset.planId = plan.id;
  document.getElementById("modal-categoria-materias").dataset.categoriaId = categoria.id;
  renderizarControlesCategoriaMaterias(plan, categoria);
  document.getElementById("modal-categoria-materias").classList.remove("oculto");
}

function renderizarControlesCategoriaMaterias(plan, categoria) {
  const cont = document.getElementById("lista-categoria-materias");
  cont.innerHTML = "";

  const buscador = document.createElement("input");
  buscador.type = "text";
  buscador.className = "form-input";
  buscador.placeholder = "Buscar por nombre o código…";
  buscador.value = estado.busquedaCategoriaMaterias;
  buscador.addEventListener("input", () => {
    estado.busquedaCategoriaMaterias = buscador.value;
    renderizarListaMateriasCheckbox(plan, categoria);
  });
  cont.appendChild(buscador);

  const pillOrden = document.createElement("div");
  pillOrden.className = "pill-group";
  [
    { valor: "bloque", texto: "Ordenar por bloque" },
    { valor: "codigo", texto: "Ordenar por código" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.ordenCategoriaMaterias === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      estado.ordenCategoriaMaterias = op.valor;
      pillOrden.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderizarListaMateriasCheckbox(plan, categoria);
    });
    pillOrden.appendChild(btn);
  });
  cont.appendChild(pillOrden);

  const listaMaterias = document.createElement("div");
  listaMaterias.id = "checkboxes-categoria-materias";
  listaMaterias.className = "stack";
  listaMaterias.style.maxHeight = "320px";
  listaMaterias.style.overflowY = "auto";
  cont.appendChild(listaMaterias);

  renderizarListaMateriasCheckbox(plan, categoria);
}

function renderizarListaMateriasCheckbox(plan, categoria) {
  const cont = document.getElementById("checkboxes-categoria-materias");
  if (!cont) return;
  cont.innerHTML = "";

  let materiasRelevantes = plan.materias.filter((m) => m.categoria_id === null || m.categoria_id === categoria.id);

  const q = estado.busquedaCategoriaMaterias.trim().toLowerCase();
  if (q) materiasRelevantes = materiasRelevantes.filter((m) => m.nombre.toLowerCase().includes(q) || m.codigo.toLowerCase().includes(q));

  materiasRelevantes = materiasRelevantes
    .slice()
    .sort((a, b) => (estado.ordenCategoriaMaterias === "bloque" ? a.bloque - b.bloque : a.codigo.localeCompare(b.codigo)));

  if (materiasRelevantes.length === 0) {
    cont.innerHTML = `<p class="muted">No hay materias que coincidan.</p>`;
    return;
  }

  materiasRelevantes.forEach((materia) => {
    const label = document.createElement("label");
    label.className = "checkbox";
    label.innerHTML = `
      <input type="checkbox" value="${materia.codigo}" ${materia.categoria_id === categoria.id ? "checked" : ""}>
      <span class="box"></span>
      <span>${materia.codigo} — ${materia.nombre}</span>
    `;
    cont.appendChild(label);
  });
}

function inicializarModalCategoriaMaterias() {
  document.getElementById("btn-cancelar-categoria-materias").addEventListener("click", () => {
    document.getElementById("modal-categoria-materias").classList.add("oculto");
    renderizarPlanEstudios();
  });

  document.getElementById("btn-confirmar-categoria-materias").addEventListener("click", () => {
    const modal = document.getElementById("modal-categoria-materias");
    const plan = estado.datos.planes_estudio.find((p) => p.id === modal.dataset.planId);
    const categoriaId = modal.dataset.categoriaId;
    const marcados = new Set(
      Array.from(modal.querySelectorAll('input[type="checkbox"]:checked')).map((el) => el.value)
    );

    plan.materias.forEach((m) => {
      if (m.categoria_id === categoriaId && !marcados.has(m.codigo)) {
        m.categoria_id = null; // se desmarcó
      } else if (marcados.has(m.codigo)) {
        m.categoria_id = categoriaId;
      }
    });

    marcarCambioPendiente();
    modal.classList.add("oculto");
    renderizarPlanEstudios();
  });
}

/* ===================== Bloques colapsables + tarjetas de materia ===================== */

function construirContenidoBloques() {
  const contenedor = document.createElement("div");
  contenedor.className = "stack";

  const todasLasFilas = obtenerMateriasVisibles();
  if (todasLasFilas.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Este plan todavía no tiene materias. Impórtalas o añádelas manualmente desde el panel de arriba.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  const filas = filasFiltradas();
  if (filas.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Ninguna materia coincide con la búsqueda o el filtro actual.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  const cfg = estado.datos.configuracion;
  const grupos = new Map();
  const nombreGrupo = new Map();

  filas.forEach((fila) => {
    let clave, nombre;
    if (estado.ordenPlanEstudios === "categoria") {
      clave = fila.materia.categoria_id || "sin_categoria";
      const cat = fila.plan.categorias.find((c) => c.id === fila.materia.categoria_id);
      nombre = cat ? cat.nombre : "Sin categoría";
    } else {
      clave = String(fila.materia.bloque);
      nombre = `${fila.plan.parametros_universidad.nombre_bloque} ${fila.materia.bloque}`;
    }
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(fila);
    nombreGrupo.set(clave, nombre);
  });

  const clavesOrdenadas = Array.from(grupos.keys()).sort((a, b) => {
    const na = Number(a), nb = Number(b);
    if (!isNaN(na) && !isNaN(nb)) return na - nb;
    return String(nombreGrupo.get(a)).localeCompare(String(nombreGrupo.get(b)));
  });

  const esEscritorio = window.innerWidth >= 900;

  clavesOrdenadas.forEach((clave) => {
    const bloqueCard = document.createElement("section");
    bloqueCard.className = "glass-card bloque-card";

    const colapsado = estado.bloquesColapsados.has(clave);

    const encabezado = document.createElement("div");
    encabezado.className = "bloque-encabezado";
    encabezado.innerHTML = `<h3>${nombreGrupo.get(clave)}</h3><span style="opacity:0.7;">${colapsado ? "▼" : "▲"}</span>`;
    encabezado.addEventListener("click", () => {
      if (estado.bloquesColapsados.has(clave)) estado.bloquesColapsados.delete(clave);
      else estado.bloquesColapsados.add(clave);
      renderizarPlanEstudios();
    });
    bloqueCard.appendChild(encabezado);

    if (!colapsado) {
      const cuerpoBloque = document.createElement("div");
      cuerpoBloque.className = "stack";
      cuerpoBloque.style.marginTop = "12px";
      grupos.get(clave).forEach((fila) => {
        cuerpoBloque.appendChild(construirTarjetaMateria(fila, esEscritorio, cfg.modo_hardcore));
      });
      bloqueCard.appendChild(cuerpoBloque);
    }

    contenedor.appendChild(bloqueCard);
  });

  return contenedor;
}

const ESTADOS_MATERIA = [
  { valor: "pendiente", texto: "Pendiente", badge: "badge-neutral" },
  { valor: "cursando", texto: "Cursando", badge: "badge-warning" },
  { valor: "aprobado", texto: "Aprobada", badge: "badge-success" },
  { valor: "reprobado", texto: "Reprobada", badge: "badge-danger" },
];

function estaExpandida(codigo, esEscritorio) {
  if (estado.materiasExpandidas.has(codigo)) return estado.materiasExpandidas.get(codigo);
  return esEscritorio;
}

/**
 * Encabezado FINAL de 2 líneas (v5 #4/#5) — reemplaza el diseño v4 de una
 * sola fila con badge de Categoría visible.
 * Línea 1: Luz · Código · Nombre (con flecha de expandir/colapsar al final).
 * Línea 2: Estado (pegado a la izquierda) · Créditos (pegado a la derecha).
 * La Categoría NO aparece en ningún lado del encabezado — solo la franja
 * lateral de color (card.style.borderLeft) la indica. Luz y horas ya no van
 * sueltas/a la derecha: la luz vive en la línea 1, las horas se movieron al
 * detalle expandido (junto con la categoría en texto, para no perder la
 * función de reasignar categoría con mantener-presionado).
 */
function construirTarjetaMateria(fila, esEscritorio, mostrarOrigen) {
  const { materia, plan } = fila;
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  const disponible = materiaDisponible(materia, plan.materias);
  const expandida = estaExpandida(materia.codigo, esEscritorio);

  const card = document.createElement("div");
  card.className = "glass-panel materia-card";
  if (categoria) card.style.borderLeft = `6px solid ${categoria.color}`;

  const filaPrincipal = document.createElement("div");
  filaPrincipal.className = "materia-fila-principal";
  filaPrincipal.addEventListener("click", () => {
    estado.materiasExpandidas.set(materia.codigo, !expandida);
    renderizarPlanEstudios();
  });

  // ---- Línea 1: luz · código · nombre (prefijo de ancho fijo para la
  // indentación colgante, ver .materia-prefijo / .materia-nombre-col) ----
  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";

  // Ajuste v4 #3 / v5 #4: candado -> "luz" (encendida = disponible, apagada
  // = bloqueada). +50% de glow y fix de contraste en modo oscuro ya están
  // en design-system.css (.luz-punto.disponible / [data-mode="dark"] .luz-punto.bloqueada).
  const luzDisponibilidad = document.createElement("span");
  luzDisponibilidad.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
  luzDisponibilidad.title = disponible ? "Disponible" : "Bloqueada";
  prefijo.appendChild(luzDisponibilidad);

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  spanCodigo.title = "Mantén presionado (o clic derecho) para cambiar la categoría de esta materia";
  agregarLongPress(spanCodigo, () => abrirMenuRapidoCategoria(materia, plan, spanCodigo));
  prefijo.appendChild(spanCodigo);

  linea1.appendChild(prefijo);

  const nombreCol = document.createElement("span");
  nombreCol.className = "materia-nombre-col";
  const spanNombre = document.createElement("span");
  // Colapsada: trunca con "…". Expandida: nombre completo con indentación
  // colgante (v5 #5) — mismo truco de columna de ancho fijo que 1.1.
  spanNombre.className = "materia-nombre " + (expandida ? "completa" : "truncada");
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  nombreCol.appendChild(spanNombre);
  linea1.appendChild(nombreCol);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandida ? "▲" : "▼";
  linea1.appendChild(iconoExpandir);

  filaPrincipal.appendChild(linea1);

  // ---- Línea 2: estado (izquierda) · créditos (derecha) ----
  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";
  linea2.innerHTML =
    `<span class="badge ${infoEstado.badge}">${infoEstado.texto}</span>` +
    `<span class="badge badge-accent">Créditos: ${materia.creditos}</span>`;
  filaPrincipal.appendChild(linea2);

  if (mostrarOrigen) {
    const badgeOrigen = document.createElement("span");
    badgeOrigen.className = "badge badge-neutral";
    badgeOrigen.style.fontSize = "0.68rem";
    badgeOrigen.textContent = fila.origen === "principal" ? "Principal" : "Secundario";
    linea2.appendChild(badgeOrigen);
  }

  card.appendChild(filaPrincipal);

  if (expandida) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "materia-cuerpo stack";

    // v7 #4/#5: Requisitos + Correquisitos ahora comparten un solo bloque de
    // 3 columnas; la Categoría ya no se muestra como texto plano aquí (se
    // movió a un badge real en la columna 3, solo si existe — ver
    // construirFilaExtras). La capacidad de asignar/cambiar categoría por
    // mantener-presionado sigue disponible siempre desde el código de la
    // materia en el encabezado (spanCodigo, línea 1 de la tarjeta), incluso
    // cuando todavía no tiene ninguna asignada.
    cuerpo.appendChild(construirBloqueCompletoRequisitos(materia, plan));

    // v5 #4: las horas ya no van en el encabezado — viven aquí, en el detalle.
    const horasLinea = document.createElement("p");
    horasLinea.className = "materia-horas-detalle";
    horasLinea.textContent = formatearHoras(materia);
    cuerpo.appendChild(horasLinea);

    const grupoEstado = document.createElement("div");
    grupoEstado.className = "pill-group";
    ESTADOS_MATERIA.forEach((e) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (materia.estado === e.valor ? " active" : "");
      btn.textContent = e.texto;
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        materia.estado = e.valor; // siempre manual, nunca automático
        marcarCambioPendiente();
        renderizarPlanEstudios();
      });
      grupoEstado.appendChild(btn);
    });
    cuerpo.appendChild(grupoEstado);

    card.appendChild(cuerpo);
  }

  return card;
}

/** Ajuste v4 #7: menú rápido (lista de categorías del plan) para reasignar
 *  la categoría de una materia puntual, sin entrar al flujo completo de
 *  edición de categoría. Se muestra como un pequeño popover junto al badge. */
function abrirMenuRapidoCategoria(materia, plan, anclaEl) {
  document.querySelectorAll(".popover-categoria-rapida").forEach((el) => el.remove());

  const pop = document.createElement("div");
  pop.className = "glass-card stack popover-categoria-rapida";
  pop.style.cssText = "position:fixed; z-index:200; padding:8px; min-width:160px;";
  const rect = anclaEl.getBoundingClientRect();
  pop.style.top = `${rect.bottom + 6}px`;
  pop.style.left = `${Math.max(8, rect.left)}px`;

  const opciones = [{ id: null, nombre: "Sin categoría" }, ...plan.categorias];
  opciones.forEach((cat) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "btn btn-secondary btn-block";
    item.style.cssText = "text-align:left; padding:6px 10px; font-size:0.85rem;";
    item.textContent = cat.nombre;
    item.addEventListener("click", () => {
      materia.categoria_id = cat.id;
      marcarCambioPendiente();
      pop.remove();
      renderizarPlanEstudios();
    });
    pop.appendChild(item);
  });

  document.body.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", function cerrar(e) {
      if (!pop.contains(e.target)) {
        pop.remove();
        document.removeEventListener("click", cerrar);
      }
    });
  }, 0);
}

/** Requisitos/correquisitos agrupados: "o" dentro de un grupo, grupos en líneas separadas ("y" implícito). */
/** Versión compacta de formatearHoras (sin la etiqueta "Horas:"), pensada
 *  para una columna angosta y centrada. Un solo tipo -> solo el número;
 *  varios tipos -> valores unidos con "/" en el mismo orden del plan. */
function formatearHorasCompacto(materia) {
  const valores = Object.values(materia.horas || {});
  if (valores.length === 0) return "—";
  return valores.join("/");
}

/**
 * Fila de 3 columnas para un código de requisito/correquisito (v7 rediseño):
 * 1) Código - Nombre: el texto mismo ES el link, abre la tarjeta/modal de esa
 *    materia (ya NO hay un link "Ir a materia" aparte).
 * 2) Horas, centradas.
 * 3) `extraEl` opcional: elemento que llega desde afuera (badge de Categoría,
 *    link "Es requisito" o link "Historial" — son propiedades de la materia
 *    ACTUAL, no de este requisito puntual; se acomodan aquí por conveniencia
 *    de espacio, una por fila disponible — ver construirBloqueCompletoRequisitos).
 */
function construirFilaRequisito(codigo, extraEl) {
  const fila = document.createElement("div");
  fila.className = "requisito-fila";

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);

  const colNombre = document.createElement("a");
  colNombre.href = "#";
  colNombre.className = "requisito-col-nombre link-plano";
  const textoNombre = encontrada
    ? `${codigo} - ${aplicarFormatoTexto(encontrada.materia.nombre)}`
    : `${codigo} - (no encontrada en ningún plan visible)`;
  colNombre.title = textoNombre;
  colNombre.textContent = textoNombre;
  colNombre.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    abrirModalRequisito(codigo);
  });
  fila.appendChild(colNombre);

  const colHoras = document.createElement("span");
  colHoras.className = "requisito-col-horas";
  colHoras.textContent = encontrada ? formatearHorasCompacto(encontrada.materia) : "—";
  fila.appendChild(colHoras);

  const colExtra = document.createElement("span");
  colExtra.className = "requisito-col-extra";
  if (extraEl) colExtra.appendChild(extraEl);
  fila.appendChild(colExtra);

  return fila;
}

/** Fila "vacía" en columnas 1-2 (sin código de requisito que mostrar), usada
 *  solo para poder alojar un elemento de la columna 3 (extra) cuando ya no
 *  quedan filas de datos reales — así Categoría/Es requisito/Historial
 *  nunca quedan fuera del layout aunque la materia no tenga requisitos ni
 *  correquisitos. */
function construirFilaSoloExtra(extraEl) {
  const fila = document.createElement("div");
  fila.className = "requisito-fila";
  fila.appendChild(document.createElement("span")).className = "requisito-col-nombre";
  fila.appendChild(document.createElement("span")).className = "requisito-col-horas";
  const colExtra = document.createElement("span");
  colExtra.className = "requisito-col-extra";
  colExtra.appendChild(extraEl);
  fila.appendChild(colExtra);
  return fila;
}

/**
 * Arma, en orden, los elementos que van a ir en la columna 3 (v7 #4/#5):
 * badge de Categoría (SOLO si la materia tiene una asignada — nunca un
 * texto "Sin categoría"), link "Es requisito" y link "Historial".
 */
function construirFilaExtras(materia, plan) {
  const extras = [];
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);

  if (categoria) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.style.cssText = estiloBadgeCategoria(categoria.color) + " cursor:pointer;";
    badge.textContent = categoria.nombre;
    badge.title = "Mantén presionado (o clic derecho) para cambiar la categoría";
    agregarLongPress(badge, () => abrirMenuRapidoCategoria(materia, plan, badge));
    extras.push(badge);
  }

  const linkEsRequisito = document.createElement("a");
  linkEsRequisito.href = "#";
  linkEsRequisito.className = "requisito-fila-link link-plano";
  linkEsRequisito.textContent = "Es requisito";
  linkEsRequisito.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    abrirModalDesbloquea(materia, plan);
  });
  extras.push(linkEsRequisito);

  const linkHistorial = document.createElement("a");
  linkHistorial.href = "#";
  linkHistorial.className = "requisito-fila-link link-plano";
  linkHistorial.textContent = "Historial";
  linkHistorial.addEventListener("click", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    abrirModalHistorial(materia);
  });
  extras.push(linkHistorial);

  return extras;
}

function construirBloqueRequisitos(etiqueta, grupos, extrasQueue) {
  const cont = document.createElement("div");
  const sinItems = !grupos || grupos.length === 0;

  // v5 #6 / v7 Bug 3: "Correquisitos" se omite POR COMPLETO si la materia no
  // tiene ninguno (nada de "Correquisitos: Ninguno"). La condición es
  // exactamente `grupos.length === 0` — nunca se compara contra "" ni contra
  // ningún otro tipo de dato, así que solo se oculta cuando de verdad está
  // vacío. "Requisitos" sí conserva el texto "Ninguno" cuando está vacío,
  // porque ahí siempre aplica.
  if (sinItems) {
    if (etiqueta === "Correquisitos") return cont;
    const p = document.createElement("p");
    p.className = "materia-req-linea";
    p.innerHTML = `<strong>${etiqueta}:</strong> Ninguno`;
    cont.appendChild(p);
    return cont;
  }

  const tituloLinea = document.createElement("p");
  tituloLinea.className = "materia-req-linea";
  tituloLinea.style.marginBottom = "2px";
  tituloLinea.innerHTML = `<strong>${etiqueta}:</strong>`;
  cont.appendChild(tituloLinea);

  grupos.forEach((grupo) => {
    (grupo || []).forEach((codigo, i) => {
      const extra = extrasQueue && extrasQueue.length ? extrasQueue.shift() : null;
      cont.appendChild(construirFilaRequisito(codigo, extra));
      // Alternativas dentro del mismo grupo ("O"): un separador entre filas.
      // Entre grupos distintos no hay separador (el "Y" queda implícito).
      if (i < grupo.length - 1) {
        const divisorO = document.createElement("div");
        divisorO.className = "requisito-divisor-o";
        divisorO.textContent = "o";
        cont.appendChild(divisorO);
      }
    });
  });

  return cont;
}

/**
 * v7 #4: arma el bloque completo de Requisitos + Correquisitos de una
 * materia, compartiendo una sola cola de "extras" (badge de Categoría, link
 * "Es requisito", link "Historial") entre ambas secciones, para que se
 * repartan en las filas de datos disponibles en orden. Si sobran extras sin
 * fila real donde ir (ej. una materia sin requisitos ni correquisitos), se
 * agregan filas vacías solo para alojarlos — así nunca quedan fuera del
 * layout.
 */
function construirBloqueCompletoRequisitos(materia, plan) {
  const cont = document.createElement("div");
  cont.className = "stack";
  const extrasQueue = construirFilaExtras(materia, plan);

  cont.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos, extrasQueue));
  cont.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos, extrasQueue));

  while (extrasQueue.length) {
    cont.appendChild(construirFilaSoloExtra(extrasQueue.shift()));
  }

  return cont;
}

/* ===================== Modal de requisito (navegable) ===================== */

function abrirModalRequisito(codigo) {
  const modalCard = document.querySelector("#modal-requisito .modal-card");
  const franjaVieja = modalCard.querySelector(".franja-categoria");
  if (franjaVieja) franjaVieja.remove();
  const extraViejo = modalCard.querySelector("#requisito-extra");
  if (extraViejo) extraViejo.remove();

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);

  if (!encontrada) {
    document.getElementById("requisito-titulo").textContent = "Materia no encontrada";
    document.getElementById("requisito-bloque").textContent = "—";
    document.getElementById("requisito-codigo").textContent = codigo;
    document.getElementById("requisito-nombre").textContent = "No está importada en ningún plan visible todavía.";
    document.getElementById("requisito-creditos").textContent = "—";
  } else {
    const { materia, plan } = encontrada;
    const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
    const disponible = materiaDisponible(materia, plan.materias);

    const franja = document.createElement("div");
    franja.className = "franja-categoria";
    franja.style.background = categoria ? categoria.color : "var(--gradient-accent)";
    modalCard.insertBefore(franja, modalCard.firstChild);

    const luzTitulo = document.createElement("span");
    luzTitulo.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
    luzTitulo.style.marginRight = "8px";
    const tituloEl = document.getElementById("requisito-titulo");
    tituloEl.textContent = "";
    tituloEl.appendChild(luzTitulo);
    tituloEl.appendChild(document.createTextNode(materia.nombre));
    document.getElementById("requisito-bloque").textContent = `${plan.parametros_universidad.nombre_bloque} ${materia.bloque}`;
    document.getElementById("requisito-codigo").textContent = materia.codigo;
    document.getElementById("requisito-nombre").textContent = materia.nombre;
    document.getElementById("requisito-creditos").textContent = materia.creditos;

    const extra = document.createElement("div");
    extra.id = "requisito-extra";
    extra.className = "stack";
    extra.appendChild(construirBloqueCompletoRequisitos(materia, plan));

    const horas = document.createElement("p");
    horas.className = "materia-req-linea";
    horas.textContent = formatearHoras(materia);
    extra.appendChild(horas);

    document.getElementById("btn-cerrar-requisito").parentElement.insertAdjacentElement("beforebegin", extra);

    // v5 #7: el botón "Desbloquea" de aquí abajo se reemplaza por el link de
    // solo-texto "Es requisito" en la fila superior del modal (junto a
    // cerrar). Guardamos el contexto para que ese link sepa qué materia abrir.
    materiaModalRequisitoActual = { materia, plan };
  }
  if (!encontrada) materiaModalRequisitoActual = null;
  document.getElementById("modal-requisito").classList.remove("oculto");
}

/** Contexto de la materia que está mostrando #modal-requisito ahora mismo,
 *  usado por el link "Es requisito" (v5 #7) para saber qué abrir. */
let materiaModalRequisitoActual = null;

/* ===================== Modal "Desbloquea" (búsqueda inversa) ===================== */

function abrirModalDesbloquea(materia, plan) {
  document.getElementById("titulo-modal-desbloquea").textContent = `${aplicarFormatoTexto(materia.nombre)} es requisito para:`;
  const cont = document.getElementById("lista-modal-desbloquea");
  cont.innerHTML = "";

  const resultado = obtenerMateriasQueDesbloquea(materia, plan);
  if (resultado.length === 0) {
    cont.innerHTML = `<p class="muted">Esta materia no es requisito de ninguna otra.</p>`;
  } else {
    resultado.forEach((m) => {
      const filaResultado = document.createElement("div");
      filaResultado.className = "glass-panel row";
      filaResultado.style.padding = "8px 12px";
      filaResultado.style.cursor = "pointer";
      filaResultado.innerHTML = `
        <strong style="font-family:var(--font-mono, monospace); width:80px; flex-shrink:0;">${m.codigo}</strong>
        <span style="flex:1;">${m.nombre}</span>
        <span class="badge badge-neutral">${plan.parametros_universidad.nombre_bloque} ${m.bloque}</span>
      `;
      filaResultado.addEventListener("click", () => {
        document.getElementById("modal-desbloquea").classList.add("oculto");
        abrirModalRequisito(m.codigo);
      });
      cont.appendChild(filaResultado);
    });
  }

  document.getElementById("modal-desbloquea").classList.remove("oculto");
}

/**
 * v7 #4: muestra el registro de todas las veces que se ha cursado esta
 * materia (reprobada semestre X, aprobada semestre Y, etc.). El módulo de
 * Semestres todavía no existe, así que por ahora siempre muestra el estado
 * vacío — queda listo para conectarse en cuanto exista esa información, sin
 * dejar el botón "Historial" fuera del layout mientras tanto.
 */
function abrirModalHistorial(materia) {
  document.getElementById("titulo-modal-historial").textContent = `Historial — ${aplicarFormatoTexto(materia.nombre)}`;
  const cont = document.getElementById("cuerpo-modal-historial");
  cont.innerHTML = `<p class="muted">Aún no tienes semestres registrados.</p>`;
  document.getElementById("modal-historial").classList.remove("oculto");
}

function inicializarModalDesbloquea() {
  document.getElementById("btn-cerrar-desbloquea").addEventListener("click", () => {
    document.getElementById("modal-desbloquea").classList.add("oculto");
  });
  document.getElementById("modal-desbloquea").addEventListener("click", (e) => {
    if (e.target.id === "modal-desbloquea") e.target.classList.add("oculto");
  });
}

/* ===================== Arranque de este módulo ===================== */

window.addEventListener("DOMContentLoaded", () => {
  inicializarModalCrearPlan();
  inicializarModalCategoria();
  inicializarModalCategoriaMaterias();
  inicializarModalMateriaManual();
  inicializarModalGestionPlanes();
  inicializarModalDesbloquea();
  inicializarModalInstruccionesImportacion();

  document.getElementById("btn-cerrar-requisito").addEventListener("click", () => {
    document.getElementById("modal-requisito").classList.add("oculto");
  });

  document.getElementById("btn-cerrar-historial").addEventListener("click", () => {
    document.getElementById("modal-historial").classList.add("oculto");
  });
  document.getElementById("modal-historial").addEventListener("click", (e) => {
    if (e.target.id === "modal-historial") e.target.classList.add("oculto");
  });

  // v5 #7: "Es requisito" — link de solo texto que abre la búsqueda inversa
  // ("[materia] es requisito para:") para la materia que el modal está
  // mostrando en este momento.
  const btnEsRequisito = document.getElementById("btn-es-requisito");
  if (btnEsRequisito) {
    btnEsRequisito.addEventListener("click", () => {
      if (!materiaModalRequisitoActual) return;
      const { materia, plan } = materiaModalRequisitoActual;
      document.getElementById("modal-requisito").classList.add("oculto");
      abrirModalDesbloquea(materia, plan);
    });
  }
  document.getElementById("modal-requisito").addEventListener("click", (e) => {
    if (e.target.id === "modal-requisito") e.target.classList.add("oculto");
  });
  document.getElementById("modal-categoria").addEventListener("click", (e) => {
    if (e.target.id === "modal-categoria") e.target.classList.add("oculto");
  });
  document.getElementById("modal-crear-plan").addEventListener("click", (e) => {
    if (e.target.id === "modal-crear-plan") {
      estado.csvPendienteDeImportar = null;
      e.target.classList.add("oculto");
      if (estado.reabrirGestionPlanesTrasCrear) {
        estado.reabrirGestionPlanesTrasCrear = false;
        abrirModalGestionPlanes();
      }
    }
  });

  // Al cruzar el punto de quiebre de 900px, se ajusta el desplegable de cada
  // materia (móvil = colapsado, escritorio = siempre expandido) salvo que el
  // usuario ya lo haya alternado manualmente (estado.materiasExpandidas).
  let anchoEraEscritorio = window.innerWidth >= 900;
  window.addEventListener("resize", () => {
    const esEscritorioAhora = window.innerWidth >= 900;
    if (esEscritorioAhora !== anchoEraEscritorio) {
      anchoEraEscritorio = esEscritorioAhora;
      if (document.getElementById("seccion-plan-estudios") && !document.getElementById("seccion-plan-estudios").classList.contains("oculto")) {
        renderizarPlanEstudios();
      }
    }
  });
});
