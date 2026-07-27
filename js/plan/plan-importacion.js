/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (prompt + panel)
   Construcción del prompt oficial para la IA, el panel de importación
   (Universidad / modo Link-PDF-Capturas), y el modal de instrucciones
   antes de enviar.
   ========================================================================= */

import { PRESETS_TIPOS_HORAS } from "../core/schema.js";
import { mostrarCargando, ocultarCargando } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { abrirModalGestionPlanes } from "./plan-gestionar.js";
import { manejarClickImportar, mostrarErroresImportacion } from "./plan-importacion-csv.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

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
    instruccionEntrada = `Te voy a adjuntar un PDF armado a partir de varias capturas de pantalla de mi plan de estudios (una captura por página). Trátalo igual que si fuera un PDF real de mi plan de estudios: lee todas las páginas como una sola malla curricular continua, uniendo la información entre todas, sin perder ninguna materia, sin importar el orden de las páginas.`;
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
- IMPORTANTE — Nombre: varios nombres de materias reales incluyen una coma (ej. "Ética, Persona y Sociedad"). Si el Nombre de una materia trae una coma real, envuelve ESA CELDA completa entre comillas dobles, así: "Ética, Persona y Sociedad". Esto aplica a cualquier otra columna que también pueda traer una coma real. Si tienes dudas, mejor usar comillas de más que de menos.
- No dejes ninguna columna vacía sin su coma correspondiente: si Correquisitos (o cualquier otra columna) no aplica, escribe igual "Ninguno" — nunca cortes la línea antes de completar todas las columnas del encabezado.
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
estado.planImportandoId = null;            // "principal" | "secundario", elegido antes de importar (primer plan)
estado.csvPendienteDeImportar = null;      // texto CSV en espera mientras se crea el plan
estado.panelImportacionAbierto = false;   // v5 1.2/1.3: import/actualizar malla, siempre inline

/* ---- B.2: flujo de importación de 3 modos (Link / PDF / Capturas) ----
 * Estas llaves viven en `estado` (no en los datos del usuario) porque son
 * solo del momento de importar, antes de que exista el plan. */
estado.modoImportacion = null;             // null (sin selección) | "link" | "pdf" | "capturas"
estado.linkImportacion = "";               // URL pegada en el modo "link"
// Universidad/tipos_horas elegidos ANTES de que el plan exista (para poder
// construir el prompt con las columnas de horas correctas). Se resuelven acá
// primero y se copian al crear el plan real en abrirModalCrearPlan/confirmar.
estado.universidadImportacion = "TEC";
estado.tiposHorasImportacion = PRESETS_TIPOS_HORAS.TEC.slice();
estado.tiposHorasPersonalizadoTexto = "";  // texto crudo cuando universidadImportacion === "Otra"

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

  // v1.10.1 (punto 1): cuando este panel se muestra para agregar un plan
  // ADICIONAL (ya existe al menos uno activo), se ofrece volver atrás sin
  // crear nada — cuando es el primer plan de todos, no hay a dónde volver.
  if (estado.mostrarPanelImportacionNuevoPlan) {
    const btnCancelar = document.createElement("button");
    btnCancelar.type = "button";
    btnCancelar.className = "btn btn-secondary";
    btnCancelar.textContent = "← Cancelar";
    btnCancelar.addEventListener("click", () => {
      estado.mostrarPanelImportacionNuevoPlan = false;
      const reabrirGestion = estado.reabrirGestionPlanesTrasCrear;
      estado.reabrirGestionPlanesTrasCrear = false;
      renderizarPlanEstudios();
      if (reabrirGestion) abrirModalGestionPlanes();
    });
    sec.appendChild(btnCancelar);
  }

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
        estado.tiposHorasImportacion = estado.horasNoAplicaImportacion ? [] : PRESETS_TIPOS_HORAS[op.valor].slice();
      }
      renderizarPlanEstudios();
    });
    grupoUni.appendChild(btn);
  });
  sec.appendChild(grupoUni);

  if (estado.universidadImportacion === "Otra") {
    const inputNombreUni = document.createElement("input");
    inputNombreUni.type = "text";
    inputNombreUni.className = "form-input";
    inputNombreUni.style.marginBottom = "10px";
    inputNombreUni.placeholder = "Nombre de tu universidad (ej. Universidad Nacional)";
    inputNombreUni.value = estado.nombreUniversidadImportacion || "";
    inputNombreUni.addEventListener("input", () => {
      estado.nombreUniversidadImportacion = inputNombreUni.value;
    });
    sec.appendChild(inputNombreUni);

    const inputTipos = document.createElement("input");
    inputTipos.type = "text";
    inputTipos.className = "form-input";
    inputTipos.placeholder = "Tipos de horas separados por coma, ej. Teoría, Laboratorio";
    inputTipos.value = estado.tiposHorasPersonalizadoTexto;
    inputTipos.disabled = !!estado.horasNoAplicaImportacion;
    inputTipos.addEventListener("input", () => {
      estado.tiposHorasPersonalizadoTexto = inputTipos.value;
      estado.tiposHorasImportacion = inputTipos.value.split(",").map((t) => t.trim()).filter(Boolean);
    });
    sec.appendChild(inputTipos);
  }

  // v7.1: "No aplica" para Horas, independiente de la universidad elegida.
  const labelNoAplica = document.createElement("label");
  labelNoAplica.className = "checkbox";
  labelNoAplica.innerHTML = `<input type="checkbox" id="checkbox-horas-no-aplica-importacion" ${estado.horasNoAplicaImportacion ? "checked" : ""}><span class="box"></span><span>No aplica — este plan no maneja Horas</span>`;
  labelNoAplica.querySelector("input").addEventListener("change", (e) => {
    estado.horasNoAplicaImportacion = e.target.checked;
    if (e.target.checked) {
      estado.tiposHorasImportacion = [];
    } else {
      estado.tiposHorasImportacion = estado.universidadImportacion === "Otra"
        ? estado.tiposHorasPersonalizadoTexto.split(",").map((t) => t.trim()).filter(Boolean)
        : PRESETS_TIPOS_HORAS[estado.universidadImportacion].slice();
    }
    renderizarPlanEstudios();
  });
  sec.appendChild(labelNoAplica);

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
      // v1.10.1 (punto 4): presionar el modo ya activo lo desactiva y vuelve
      // al estado "sin selección" — así el usuario puede llegar ahí también
      // manualmente, no solo al abrir el panel por primera vez.
      estado.modoImportacion = estado.modoImportacion === op.valor ? null : op.valor;
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

    // Punto 6 (v1.10.1): aviso de compatibilidad — este modo depende de que
    // la IA pueda navegar y leer bien la página, lo cual no siempre funciona
    // igual de bien en todas las universidades/plataformas.
    const avisoCompatibilidad = document.createElement("p");
    avisoCompatibilidad.className = "muted";
    avisoCompatibilidad.style.color = "var(--color-warning, #f59e0b)";
    avisoCompatibilidad.textContent = "⚠️ Esta opción podría no ser compatible con algunos planes de estudios. Recomendamos usar la opción de PDF o la de adjuntar capturas de pantalla o imágenes.";
    sec.appendChild(avisoCompatibilidad);
  } else if (estado.modoImportacion === "pdf") {
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Vas a adjuntar tu PDF directamente en la ventana de Claude o ChatGPT que se abra.";
    sec.appendChild(nota);
  } else if (estado.modoImportacion === "capturas") {
    // v1.10.1 (puntos 3/5): ya no se muestra el input de imágenes ni el botón
    // de convertir aquí en el panel — ahora solo se muestra el botón que abre
    // la ventana flotante (modal-capturas-pdf), donde vive todo ese flujo.
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Primero hay que convertir tus capturas en un solo PDF antes de enviarlas a la IA.";
    sec.appendChild(nota);

    const btnAbrirConversion = document.createElement("button");
    btnAbrirConversion.type = "button";
    btnAbrirConversion.className = "btn btn-secondary btn-block";
    btnAbrirConversion.textContent = "Convertir imágenes a PDF";
    btnAbrirConversion.addEventListener("click", abrirModalCapturasPDF);
    sec.appendChild(btnAbrirConversion);
  }

  // Punto 4 (v1.10.1): sin modo elegido, o en modo "capturas" (donde primero
  // hay que terminar la conversión — al terminar, se autoselecciona "pdf" y
  // esto se vuelve a evaluar), no tiene sentido mostrar los botones de
  // enviar a la IA, el textarea del CSV, subir archivo, ni Importar.
  const mostrarBloqueEnvioYCsv = estado.modoImportacion === "link" || estado.modoImportacion === "pdf";

  if (mostrarBloqueEnvioYCsv) {
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
  }

  return sec;
}

/* ===================== v1.10.0 — Capturas -> un solo PDF (modo "capturas") =====================
 * Antes de esto, el usuario adjuntaba cada foto/captura suelta directamente
 * en Claude/ChatGPT. Ahora, en el modo "Tomar capturas", primero se arma UN
 * SOLO PDF (una imagen por página, sin backend, 100% en el navegador con
 * jsPDF vía CDN) y ESE PDF es lo que se adjunta en la IA. */

/** Lee un archivo de imagen como Data URL (para poder cargarlo en un <img>
 *  y luego insertarlo en el PDF). */

function leerImagenComoDataURL(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result || ""));
    lector.onerror = () => reject(new Error("No se pudo leer la imagen."));
    lector.readAsDataURL(archivo);
  });
}

/** Carga una Data URL en un elemento <img> real, solo para poder leer sus
 *  dimensiones naturales (ancho/alto) antes de insertarla en el PDF.
 *  Incluye un timeout de seguridad: en algunos navegadores, si el archivo no
 *  es una imagen decodificable (formato no soportado, archivo corrupto),
 *  ni onload ni onerror llegan a dispararse — sin este timeout, la
 *  conversión completa se quedaba esperando para siempre, sin error visible
 *  y sin que el overlay de carga terminara nunca. */

function cargarDimensionesImagen(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const limite = setTimeout(() => {
      reject(new Error("La imagen tardó demasiado en procesarse (puede no ser un formato soportado)."));
    }, 15000);
    img.onload = () => { clearTimeout(limite); resolve(img); };
    img.onerror = () => { clearTimeout(limite); reject(new Error("No se pudo procesar la imagen.")); };
    img.src = dataUrl;
  });
}

/** jsPDF necesita saber el formato real de la imagen para insertarla bien;
 *  se detecta a partir del prefijo de la Data URL en vez de asumir JPEG. */

function detectarFormatoImagen(dataUrl) {
  if (dataUrl.startsWith("data:image/png")) return "PNG";
  if (dataUrl.startsWith("data:image/webp")) return "WEBP";
  return "JPEG";
}

/**
 * Arma un solo PDF a partir de las capturas seleccionadas: una página por
 * imagen, tamaño A4, con la imagen centrada y ajustada al espacio disponible
 * MANTENIENDO su proporción original (nunca se deforma). La orientación de
 * cada página (vertical/horizontal) se elige según la proporción de esa
 * imagen. Descarga el resultado como "plan-de-estudios-capturas.pdf".
 */

async function convertirCapturasAPDF(archivos) {
  if (!window.jspdf || !window.jspdf.jsPDF) {
    throw new Error("La librería jsPDF no está disponible todavía.");
  }
  const { jsPDF } = window.jspdf;
  const MARGEN_MM = 10;
  let doc = null;

  console.log(`[capturas→PDF] Iniciando conversión de ${archivos.length} imagen(es)…`);

  for (let i = 0; i < archivos.length; i++) {
    console.log(`[capturas→PDF] Procesando imagen ${i + 1}/${archivos.length}: "${archivos[i].name}" (${archivos[i].type || "tipo desconocido"}, ${Math.round(archivos[i].size / 1024)} KB)`);
    const dataUrl = await leerImagenComoDataURL(archivos[i]);
    const img = await cargarDimensionesImagen(dataUrl);
    const horizontal = img.width >= img.height;
    const anchoPagina = horizontal ? 297 : 210; // A4 en mm
    const altoPagina = horizontal ? 210 : 297;

    if (!doc) {
      doc = new jsPDF({ orientation: horizontal ? "landscape" : "portrait", unit: "mm", format: "a4" });
    } else {
      doc.addPage("a4", horizontal ? "landscape" : "portrait");
    }

    const anchoDisponible = anchoPagina - MARGEN_MM * 2;
    const altoDisponible = altoPagina - MARGEN_MM * 2;
    const proporcion = Math.min(anchoDisponible / img.width, altoDisponible / img.height);
    const anchoFinal = img.width * proporcion;
    const altoFinal = img.height * proporcion;
    const x = (anchoPagina - anchoFinal) / 2;
    const y = (altoPagina - altoFinal) / 2;

    doc.addImage(dataUrl, detectarFormatoImagen(dataUrl), x, y, anchoFinal, altoFinal);
    console.log(`[capturas→PDF] Imagen ${i + 1}/${archivos.length} agregada al PDF.`);
  }

  console.log("[capturas→PDF] Todas las imágenes procesadas — descargando PDF…");
  doc.save("plan-de-estudios-capturas.pdf");
  console.log("[capturas→PDF] doc.save() ejecutado.");
}

/* ===================== v1.10.1 — Ventana flotante: capturas -> PDF ===================== *
 * Reemplaza el input inline que vivía en el panel. Ahora el botón "Convertir
 * imágenes a PDF" del panel abre este modal aparte; al convertir con éxito
 * usa el overlay de carga global (mostrarCargando/ocultarCargando, las
 * mismas bolitas que ya existen para el resto de la app) y, al terminar,
 * autoselecciona el modo "Adjuntar PDF" para que el usuario siga el flujo
 * normal desde ahí (adjuntar el PDF recién descargado). */

function abrirModalCapturasPDF() {
  const input = document.getElementById("input-capturas-pdf");
  if (input) input.value = ""; // limpia cualquier selección de una vez anterior
  document.getElementById("error-modal-capturas-pdf").classList.add("oculto");
  document.getElementById("modal-capturas-pdf").classList.remove("oculto");
}

function cerrarModalCapturasPDF() {
  document.getElementById("modal-capturas-pdf").classList.add("oculto");
}

function inicializarModalCapturasPDF() {
  document.getElementById("btn-cancelar-capturas-pdf").addEventListener("click", cerrarModalCapturasPDF);
  document.getElementById("modal-capturas-pdf").addEventListener("click", (e) => {
    if (e.target.id === "modal-capturas-pdf") cerrarModalCapturasPDF();
  });

  document.getElementById("btn-convertir-capturas-pdf").addEventListener("click", async () => {
    console.log("[capturas→PDF] Clic en 'Convertir a PDF' detectado.");
    const input = document.getElementById("input-capturas-pdf");
    const archivos = input.files;
    const err = document.getElementById("error-modal-capturas-pdf");
    err.classList.add("oculto");

    if (!archivos || archivos.length === 0) {
      console.log("[capturas→PDF] No hay archivos seleccionados — se muestra el aviso inline.");
      err.textContent = "Primero selecciona una o varias fotos/capturas.";
      err.classList.remove("oculto");
      return;
    }

    console.log(`[capturas→PDF] ${archivos.length} archivo(s) seleccionado(s), cerrando modal y mostrando loading…`);
    cerrarModalCapturasPDF();
    mostrarCargando();
    try {
      await convertirCapturasAPDF(archivos);
      // Puntos 3/5: autoselecciona "Adjuntar PDF" — el usuario ya tiene el
      // PDF descargado y solo falta que lo adjunte en la IA.
      estado.modoImportacion = "pdf";
      renderizarPlanEstudios();
      mostrarToast('✓ PDF descargado — se seleccionó "Adjuntar PDF", adjúntalo ahí');
    } catch (e) {
      console.warn("No se pudo convertir las capturas a PDF.", e);
      mostrarToast("No se pudo crear el PDF. Intenta de nuevo.");
      abrirModalCapturasPDF(); // deja al usuario reintentar sin perder el flujo
    } finally {
      ocultarCargando();
    }
  });
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

/**
 * Bug 1 (v8.3, LETAL): en móvil, `window.open()` llamado DESPUÉS de un
 * `await` (como el `await navigator.clipboard.writeText()` de antes) ya no
 * cuenta como parte del gesto síncrono del click original — los navegadores
 * móviles lo bloquean como pop-up la mayoría de las veces. La técnica
 * confiable es crear un <a target="_blank" rel="noopener"> real y disparar
 * `.click()` sobre él de forma síncrona, en el mismo tick del evento.
 */

function abrirVentanaNueva(url) {
  const enlace = document.createElement("a");
  enlace.href = url;
  enlace.target = "_blank";
  enlace.rel = "noopener";
  enlace.style.display = "none";
  document.body.appendChild(enlace);
  enlace.click();
  document.body.removeChild(enlace);
}

/** Ya NO son async: la apertura de la ventana ocurre primero y de forma
 *  síncrona (mismo tick del click); copiar al portapapeles es asíncrono
 *  pero ya no bloquea ni retrasa la apertura, así que el orden entre ambas
 *  cosas ya no importa para el bloqueador de pop-ups. */

function enviarPromptAClaude(texto) {
  abrirVentanaNueva("https://claude.ai/new");
  copiarPromptImportacion(texto);
}

function enviarPromptAChatGPT(texto) {
  abrirVentanaNueva("https://chatgpt.com/");
  copiarPromptImportacion(texto);
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

export {
  NOMBRE_IA,
  abrirModalCapturasPDF,
  abrirModalInstruccionesImportacion,
  abrirVentanaNueva,
  cerrarModalCapturasPDF,
  cerrarModalInstruccionesImportacion,
  construirColumnasHoras,
  construirEncabezadoCSV,
  construirInputArchivoCSV,
  construirPanelImportacion,
  construirPromptImportacion,
  construirTextoInstruccionesImportacion,
  convertirCapturasAPDF,
  copiarPromptImportacion,
  enviarPromptAChatGPT,
  enviarPromptAClaude,
  extraerMetadatosImportacion,
  inicializarModalCapturasPDF,
  inicializarModalInstruccionesImportacion,
  instruccionesImportacionPendiente,
};
