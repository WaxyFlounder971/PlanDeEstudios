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
  return (tiposHoras && tiposHoras.length ? tiposHoras : ["Horas"])
    .map((t) => `Horas_${t.replace(/\s+/g, "")}`)
    .join(",");
}

function construirEncabezadoCSV(tiposHoras) {
  return `Bloque,Codigo,Nombre,Creditos,${construirColumnasHoras(tiposHoras)},Requisitos,Correquisitos`;
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

  if (modo === "link") {
    instruccionEntrada = `Visita esta página pública y extrae el plan de estudios completo desde su contenido: ${link}
Es una página institucional sin inicio de sesión. Si la página organiza las materias en pestañas o bloques mediante controles de navegador (JavaScript) que no se reflejen con claridad en el contenido que puedas leer, y no puedes determinar con certeza a qué Bloque pertenece cada materia, escribe "REVISAR" en la columna Bloque de esa fila en vez de adivinar.`;
  } else if (modo === "pdf") {
    instruccionEntrada = `Te voy a adjuntar el plan de estudios de mi carrera en un archivo PDF (puede tener tablas de texto real, o ser páginas escaneadas como imágenes — trátalo igual en ambos casos).`;
  } else if (modo === "capturas") {
    instruccionEntrada = `Te voy a adjuntar una o varias fotos/capturas de pantalla de mi plan de estudios. Léelas todas como una sola malla curricular continua, uniendo la información entre todas, sin perder ninguna materia, sin importar el orden en que las adjunte.`;
  }

  return `Actúa como un estructurador de datos académicos. ${instruccionEntrada}

Devuélveme ÚNICAMENTE un bloque de código plano en formato CSV, sin texto adicional antes o después, con esta estructura EXACTA:

Bloque,Codigo,Nombre,Creditos,${columnasHoras},Requisitos,Correquisitos

Reglas:
- Bloque: número de nivel/semestre/cuatrimestre tal como aparece en el documento/página. Si usa nombres en vez de números, conviértelo al número secuencial correspondiente. Si no puedes determinarlo con certeza, escribe "REVISAR".
- Codigo: la sigla tal como aparece; si no tiene, genera uno corto y consistente a partir del nombre.
- Horas: usa 0 si el documento no maneja esa categoría — nunca las dejes vacías.
- Requisitos y Correquisitos: usa coma "," para separar requisitos distintos que se necesitan TODOS ("Y"), y diagonal "/" para separar materias equivalentes/alternativas dentro de un mismo requisito ("O"). Ejemplo: "MA-1001,FS-0210/FS-0227/FS-0250" significa MA-1001 Y (una de las tres alternativas). Si no hay requisitos, usa "Ninguno".
- No agregues columna de categoría ni ninguna otra fuera de las columnas indicadas.
- No omitas ninguna materia, incluidas optativas/electivas.
- Si una celda es ilegible, ambigua, o no puedes confirmarla con certeza, escribe "REVISAR" en vez de inventar un dato.`;
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

/* ===================== Parser de grupos de requisitos ("," = Y, "/" = O) ===================== */

function parsearGrupoRequisitos(texto) {
  const limpio = (texto || "").trim();
  if (!limpio || limpio.toLowerCase() === "ninguno") return [];
  return limpio
    .split(",")
    .map((grupo) => grupo.split("/").map((c) => c.trim()).filter(Boolean))
    .filter((g) => g.length > 0);
}

function serializarGrupoRequisitos(grupos) {
  if (!grupos || grupos.length === 0) return "Ninguno";
  return grupos.map((g) => g.join("/")).join(",");
}

/* ===================== Render principal de la sección ===================== */

function renderizarPlanEstudios() {
  const cont = document.getElementById("seccion-plan-estudios");
  if (!cont) return;

  const principal = obtenerPlanActivo();
  cont.innerHTML = "";

  if (!principal) {
    cont.appendChild(construirPanelImportacion());
    return;
  }

  cont.appendChild(construirEncabezadoPlan(principal));
  cont.appendChild(construirBarraAcciones());
  cont.appendChild(construirPanelCategorias());
  cont.appendChild(construirContenidoBloques());
}

/* ===================== B.2 — Panel de importación (solo cuando no hay plan) ===================== */

/** Textos de instrucción breve, uno por modo de importación (sección B.2). */
const INSTRUCCIONES_POR_MODO_IMPORTACION = {
  link: '1) Pega el link de tu plan de estudios arriba. 2) Copia el prompt con el botón de la IA que prefieras (asegúrate de tener su navegación web activada). 3) Copia el CSV que te devuelva y pégalo abajo.',
  pdf: "1) Copia el prompt con el botón de la IA que prefieras. 2) Adjunta ahí tu PDF. 3) Copia el CSV que te devuelva y pégalo abajo.",
  capturas: "1) Copia el prompt con el botón de la IA que prefieras. 2) Adjunta ahí tus fotos o capturas de pantalla. 3) Copia el CSV que te devuelva y pégalo abajo.",
};

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
    enviarPromptAClaude(construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras));
  });
  filaBotones.appendChild(btnClaude);

  const btnChatGPT = document.createElement("button");
  btnChatGPT.className = "btn btn-secondary";
  btnChatGPT.style.flex = "1";
  btnChatGPT.textContent = "Enviar a ChatGPT";
  btnChatGPT.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(estado.tiposHorasImportacion);
    enviarPromptAChatGPT(construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras));
  });
  filaBotones.appendChild(btnChatGPT);

  sec.appendChild(filaBotones);

  const instrucciones = document.createElement("p");
  instrucciones.className = "muted";
  instrucciones.textContent = INSTRUCCIONES_POR_MODO_IMPORTACION[estado.modoImportacion];
  sec.appendChild(instrucciones);

  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.id = "textarea-csv-importar";
  textarea.rows = 8;
  textarea.placeholder = "Pega aquí el CSV que te devolvió la IA…";
  sec.appendChild(textarea);

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

async function copiarPromptImportacion(texto) {
  try {
    await navigator.clipboard.writeText(texto);
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
    // No existe el plan todavía: se pide crearlo primero y se guarda el CSV en espera.
    estado.csvPendienteDeImportar = textoCSV;
    abrirModalCrearPlan(destinoEsSecundario);
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

function abrirModalCrearPlan(paraSecundario) {
  estado.planCrearParaSecundario = !!paraSecundario;
  document.getElementById("input-plan-nombre-carrera").value = "";
  document.getElementById("input-plan-codigo").value = "";
  document.getElementById("error-modal-crear-plan").classList.add("oculto");

  // Se preselecciona con lo que el usuario ya haya elegido en el selector de
  // universidad/tipos de horas del panel de importación (estado.universidadImportacion),
  // así no se le vuelve a preguntar dos veces lo mismo.
  const universidadInicial = estado.universidadImportacion || "TEC";
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  const btnInicial = pillUni.querySelector(`[data-valor="${universidadInicial}"]`) || pillUni.querySelector('[data-valor="TEC"]');
  btnInicial.classList.add("active");

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
  document.getElementById("modal-gestion-planes").classList.remove("oculto");
}

function renderizarListaGestionPlanes() {
  const cont = document.getElementById("lista-gestion-planes");
  cont.innerHTML = "";
  const planes = estado.datos.planes_estudio;

  if (planes.length === 0) {
    cont.innerHTML = `<p class="muted">Todavía no tienes ningún plan.</p>`;
  }

  planes.forEach((plan) => {
    const wrap = document.createElement("div");
    wrap.className = "stack";

    const fila = document.createElement("div");
    fila.className = "glass-panel row-between";
    fila.style.padding = "10px 14px";
    fila.style.flexWrap = "wrap";
    fila.style.gap = "8px";

    const info = document.createElement("span");
    info.textContent =
      `${plan.universidad} · ${plan.nombre_carrera}` +
      (plan.codigo_plan ? ` (${plan.codigo_plan})` : "") +
      (plan.materias.length === 0 ? " — sin materias" : ` — ${plan.materias.length} materias`);
    fila.appendChild(info);

    const botones = document.createElement("div");
    botones.className = "row";

    const btnImportar = document.createElement("button");
    btnImportar.className = "btn btn-secondary";
    const importAbierto = estado.planGestionImportandoId === plan.id;
    btnImportar.textContent = importAbierto ? "Cerrar" : plan.materias.length === 0 ? "Importar malla" : "Actualizar malla";
    btnImportar.addEventListener("click", () => {
      estado.planGestionImportandoId = importAbierto ? null : plan.id;
      renderizarListaGestionPlanes();
    });
    botones.appendChild(btnImportar);

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
    botones.appendChild(btnEliminar);

    fila.appendChild(botones);
    wrap.appendChild(fila);

    if (importAbierto) {
      wrap.appendChild(construirMiniPanelImportacion(plan));
    }

    cont.appendChild(wrap);
  });

  const btnAgregar = document.getElementById("btn-agregar-plan-gestion");
  const aviso = document.getElementById("aviso-limite-planes");
  const alcanzoLimite = planes.length >= LIMITE_PLANES_ESTUDIO;
  btnAgregar.disabled = alcanzoLimite;
  aviso.classList.toggle("oculto", !alcanzoLimite);
}

/** Mini panel de importación reutilizable, apuntando a un plan específico
 *  desde la lista de gestión (en vez del flujo principal/secundario). */
function construirMiniPanelImportacion(plan) {
  const sec = document.createElement("div");
  sec.className = "glass-card stack";
  sec.style.padding = "14px";

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
      renderizarListaGestionPlanes();
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
    inputLink.addEventListener("input", () => { estado.linkImportacion = inputLink.value; });
    sec.appendChild(inputLink);

    const avisoNavegacion = document.createElement("p");
    avisoNavegacion.className = "muted";
    avisoNavegacion.textContent = "Este modo requiere que tu IA tenga activada la navegación web.";
    sec.appendChild(avisoNavegacion);
  }

  const filaBotones = document.createElement("div");
  filaBotones.className = "row";
  const btnClaude = document.createElement("button");
  btnClaude.className = "btn btn-primary";
  btnClaude.style.flex = "1";
  btnClaude.textContent = "Enviar a Claude";
  btnClaude.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(plan.parametros_universidad.tipos_horas);
    enviarPromptAClaude(construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras));
  });
  const btnChatGPT = document.createElement("button");
  btnChatGPT.className = "btn btn-secondary";
  btnChatGPT.style.flex = "1";
  btnChatGPT.textContent = "Enviar a ChatGPT";
  btnChatGPT.addEventListener("click", () => {
    const columnasHoras = construirColumnasHoras(plan.parametros_universidad.tipos_horas);
    enviarPromptAChatGPT(construirPromptImportacion(estado.modoImportacion, estado.linkImportacion, columnasHoras));
  });
  filaBotones.appendChild(btnClaude);
  filaBotones.appendChild(btnChatGPT);
  sec.appendChild(filaBotones);

  const instrucciones = document.createElement("p");
  instrucciones.className = "muted";
  instrucciones.textContent = INSTRUCCIONES_POR_MODO_IMPORTACION[estado.modoImportacion];
  sec.appendChild(instrucciones);

  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.rows = 6;
  textarea.placeholder = "Pega aquí el CSV…";
  sec.appendChild(textarea);

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
    const { materias, errores } = parsearCSVPlanEstudios(textarea.value, plan.parametros_universidad.tipos_horas);
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
    renderizarListaGestionPlanes();
    if (plan.id === estado.datos.configuracion.plan_activo_id || plan.id === estado.datos.configuracion.plan_activo_secundario_id) {
      renderizarPlanEstudios();
    }
  });
  sec.appendChild(btnImportar);

  return sec;
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
  document.getElementById("btn-cerrar-gestion-planes").addEventListener("click", () => {
    document.getElementById("modal-gestion-planes").classList.add("oculto");
  });
  document.getElementById("modal-gestion-planes").addEventListener("click", (e) => {
    if (e.target.id === "modal-gestion-planes") e.target.classList.add("oculto");
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

  const tituloWrap = document.createElement("div");
  if (estado.datos.planes_estudio.length > 1) {
    const carrusel = document.createElement("div");
    carrusel.className = "carrusel-planes";
    const btnPrev = document.createElement("button");
    btnPrev.className = "btn btn-secondary";
    btnPrev.textContent = "‹";
    btnPrev.title = "Plan anterior";
    btnPrev.addEventListener("click", () => navegarPlanCarrusel(-1));
    const h2 = document.createElement("h2");
    h2.style.margin = "0";
    h2.textContent = planPrincipal.nombre_carrera;
    const btnNext = document.createElement("button");
    btnNext.className = "btn btn-secondary";
    btnNext.textContent = "›";
    btnNext.title = "Plan siguiente";
    btnNext.addEventListener("click", () => navegarPlanCarrusel(1));
    carrusel.appendChild(btnPrev);
    carrusel.appendChild(h2);
    carrusel.appendChild(btnNext);
    tituloWrap.appendChild(carrusel);
  } else {
    const h2 = document.createElement("h2");
    h2.style.margin = "0";
    h2.textContent = planPrincipal.nombre_carrera;
    tituloWrap.appendChild(h2);
  }

  const sub = document.createElement("p");
  sub.className = "muted";
  sub.style.margin = "0";
  sub.textContent = `${planPrincipal.universidad}` + (planPrincipal.codigo_plan ? ` · ${planPrincipal.codigo_plan}` : "");
  tituloWrap.appendChild(sub);
  filaTitulo.appendChild(tituloWrap);

  const botones = document.createElement("div");
  botones.className = "row";
  botones.style.flexWrap = "wrap";

  const btnMateria = document.createElement("button");
  btnMateria.className = "btn btn-secondary";
  btnMateria.textContent = "+ Añadir materia";
  btnMateria.addEventListener("click", abrirModalMateriaManual);
  botones.appendChild(btnMateria);

  const btnPlanes = document.createElement("button");
  btnPlanes.className = "btn btn-primary";
  btnPlanes.textContent = "+ Nuevo Plan";
  btnPlanes.addEventListener("click", abrirModalGestionPlanes);
  botones.appendChild(btnPlanes);

  filaTitulo.appendChild(botones);
  sec.appendChild(filaTitulo);
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

  const btnContraer = document.createElement("button");
  btnContraer.className = "btn btn-secondary";
  btnContraer.textContent = "Contraer todo";
  btnContraer.addEventListener("click", contraerTodo);
  filaBotones.appendChild(btnContraer);

  const btnExpandir = document.createElement("button");
  btnExpandir.className = "btn btn-secondary";
  btnExpandir.textContent = "Expandir todo";
  btnExpandir.addEventListener("click", expandirTodo);
  filaBotones.appendChild(btnExpandir);

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

function contraerTodo() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, false));
  estado.bloquesColapsados = obtenerClavesAgrupacionActuales();
  renderizarPlanEstudios();
}

function expandirTodo() {
  obtenerMateriasVisibles().forEach((f) => estado.materiasExpandidas.set(f.materia.codigo, true));
  estado.bloquesColapsados = new Set();
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

function construirTarjetaMateria(fila, esEscritorio, mostrarOrigen) {
  const { materia, plan } = fila;
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
  const disponible = materiaDisponible(materia, plan.materias);
  const expandida = estaExpandida(materia.codigo, esEscritorio);

  const card = document.createElement("div");
  card.className = "glass-panel materia-card";
  if (categoria) card.style.borderLeft = `3px solid ${categoria.color}`;

  const filaPrincipal = document.createElement("div");
  filaPrincipal.className = "materia-fila-principal";
  filaPrincipal.addEventListener("click", () => {
    estado.materiasExpandidas.set(materia.codigo, !expandida);
    renderizarPlanEstudios();
  });

  const candado = document.createElement("span");
  candado.className = disponible ? "candado-disponible" : "candado-bloqueado";
  candado.textContent = disponible ? "🔓" : "🔒";
  filaPrincipal.appendChild(candado);

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.textContent = materia.codigo;
  filaPrincipal.appendChild(spanCodigo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre";
  spanNombre.textContent = materia.nombre;
  filaPrincipal.appendChild(spanNombre);

  const derecha = document.createElement("span");
  derecha.className = "materia-derecha";
  derecha.innerHTML = `<span class="badge badge-accent">${materia.creditos} cr.</span><span class="badge ${infoEstado.badge}">${infoEstado.texto}</span>`;
  filaPrincipal.appendChild(derecha);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandida ? "▲" : "▼";
  filaPrincipal.appendChild(iconoExpandir);

  card.appendChild(filaPrincipal);

  if (expandida) {
    const cuerpo = document.createElement("div");
    cuerpo.className = "materia-cuerpo stack";

    const filaBadgesExtra = document.createElement("div");
    filaBadgesExtra.className = "row";
    filaBadgesExtra.style.justifyContent = "flex-end";
    filaBadgesExtra.style.flexWrap = "wrap";
    if (mostrarOrigen) {
      const badgeOrigen = document.createElement("span");
      badgeOrigen.className = "badge badge-neutral";
      badgeOrigen.textContent = fila.origen === "principal" ? "Plan principal" : "Plan secundario";
      filaBadgesExtra.appendChild(badgeOrigen);
    }
    if (categoria) {
      const badgeCat = document.createElement("span");
      badgeCat.className = "badge";
      badgeCat.style.cssText = estiloBadgeCategoria(categoria.color);
      badgeCat.textContent = categoria.nombre;
      filaBadgesExtra.appendChild(badgeCat);
    }
    if (filaBadgesExtra.children.length > 0) cuerpo.appendChild(filaBadgesExtra);

    cuerpo.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos));
    cuerpo.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos));

    const horas = document.createElement("p");
    horas.className = "materia-req-linea";
    if (plan.parametros_universidad.horas_detalladas) {
      horas.textContent = `Horas — T ${materia.horas.teoria} · P ${materia.horas.practica} · L ${materia.horas.laboratorio} · TP ${materia.horas.teoria_practica}`;
    } else {
      const total = materia.horas.teoria + materia.horas.practica + materia.horas.laboratorio + materia.horas.teoria_practica;
      horas.textContent = `Horas: ${total}`;
    }
    cuerpo.appendChild(horas);

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

    const btnDesbloquea = document.createElement("button");
    btnDesbloquea.className = "btn btn-secondary";
    btnDesbloquea.style.alignSelf = "flex-start";
    btnDesbloquea.textContent = "🔓 Desbloquea";
    btnDesbloquea.addEventListener("click", (ev) => {
      ev.stopPropagation();
      abrirModalDesbloquea(materia, plan);
    });
    cuerpo.appendChild(btnDesbloquea);

    card.appendChild(cuerpo);
  }

  return card;
}

/** Requisitos/correquisitos agrupados: "o" dentro de un grupo, grupos en líneas separadas ("y" implícito). */
function construirBloqueRequisitos(etiqueta, grupos) {
  const cont = document.createElement("div");

  if (!grupos || grupos.length === 0) {
    const p = document.createElement("p");
    p.className = "materia-req-linea";
    p.innerHTML = `<strong>${etiqueta}:</strong> Ninguno`;
    cont.appendChild(p);
    return cont;
  }

  const tituloLinea = document.createElement("p");
  tituloLinea.className = "materia-req-linea";
  tituloLinea.innerHTML = `<strong>${etiqueta}:</strong>`;
  cont.appendChild(tituloLinea);

  grupos.forEach((grupo) => {
    const p = document.createElement("p");
    p.className = "materia-req-linea";
    (grupo || []).forEach((codigo, i) => {
      const chip = document.createElement("span");
      chip.className = "chip-codigo";
      chip.textContent = codigo;
      chip.addEventListener("click", (e) => {
        e.stopPropagation();
        abrirModalRequisito(codigo);
      });
      p.appendChild(chip);
      if (i < grupo.length - 1) p.appendChild(document.createTextNode(" o "));
    });
    cont.appendChild(p);
  });

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

    document.getElementById("requisito-titulo").textContent = `${disponible ? "🔓" : "🔒"} ${materia.nombre}`;
    document.getElementById("requisito-bloque").textContent = `${plan.parametros_universidad.nombre_bloque} ${materia.bloque}`;
    document.getElementById("requisito-codigo").textContent = materia.codigo;
    document.getElementById("requisito-nombre").textContent = materia.nombre;
    document.getElementById("requisito-creditos").textContent = materia.creditos;

    const extra = document.createElement("div");
    extra.id = "requisito-extra";
    extra.className = "stack";
    extra.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos));
    extra.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos));

    const btnDesbloquea = document.createElement("button");
    btnDesbloquea.className = "btn btn-secondary";
    btnDesbloquea.style.alignSelf = "flex-start";
    btnDesbloquea.textContent = "🔓 Desbloquea";
    btnDesbloquea.addEventListener("click", () => abrirModalDesbloquea(materia, plan));
    extra.appendChild(btnDesbloquea);

    document.getElementById("btn-cerrar-requisito").parentElement.insertAdjacentElement("beforebegin", extra);
  }
  document.getElementById("modal-requisito").classList.remove("oculto");
}

/* ===================== Modal "Desbloquea" (búsqueda inversa) ===================== */

function abrirModalDesbloquea(materia, plan) {
  document.getElementById("titulo-modal-desbloquea").textContent = `${materia.nombre} desbloquea:`;
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

  document.getElementById("btn-cerrar-requisito").addEventListener("click", () => {
    document.getElementById("modal-requisito").classList.add("oculto");
  });
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
