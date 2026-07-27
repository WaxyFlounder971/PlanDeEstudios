/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (prompt + panel)
   Construcción del prompt oficial para la IA (v1.12: universal, detecta
   HORAS_COLUMNAS automáticamente en vez de preguntar la universidad), el
   panel de importación (modo Link-PDF-Capturas), y el modal de instrucciones
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
 * mismas siempre. Cualquier flujo del proyecto que necesite este texto
 * (import inicial, re-importar/actualizar malla desde gestión de planes)
 * debe reutilizar esta función — nunca generar un texto distinto a mano.
 *
 * v1.12: ya NO recibe `columnasHoras` — el documento a importar puede ser de
 * cualquier universidad y ya no se le pregunta al usuario por adelantado qué
 * tipos de hora usa (eso obligaba a preseleccionar TEC/UCR/Otra antes de
 * poder generar el prompt). En su lugar, el propio prompt le pide a la IA
 * que DETECTE los tipos de hora leyendo el documento (línea HORAS_COLUMNAS:
 * en los metadatos) y arme el CSV con las columnas correspondientes. El
 * parser (plan-importacion-csv.js) deriva `tipos_horas` de esa línea.
 */

function construirPromptImportacion(modo, link) {
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

  return `${avisoNavegacion}Actúa como un estructurador de datos académicos UNIVERSAL, capaz de procesar mallas curriculares
de cualquier universidad (ejemplos de referencia: UCR, UNA, TEC, Universidad Tecnológica del Perú,
UNAM, y cualquier otra con formato distinto), sin importar si vienen en tabla, en cuadrícula gráfica
tipo diagrama de flujo, o en listado por bloques/ciclos/niveles/años/semestres.

${instruccionEntrada}

=== PASO 1: METADATOS (antes del CSV, una línea por dato, solo si hay certeza) ===
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, si se identifica)
HORAS_COLUMNAS: lista separada por comas de los tipos de hora que usa ESTE documento específico,
  usando las siglas tal como aparecen (ej: T,P,L,EI,HT,HD  o  T,P,L,TP  o  Horas  o  T,P).
  Si el documento no maneja el concepto de horas en absoluto, escribe: HORAS_COLUMNAS: Ninguna

Detecta estas columnas leyendo el propio documento — NO asumas que todas las universidades usan
T/P/L/TP. Si un documento no distingue tipos de hora y solo da un total, usa una sola columna "Horas".

=== PASO 2: CSV ===
Devuélveme ÚNICAMENTE un bloque de código plano en formato CSV (con las líneas de metadatos antes,
si las tienes), sin texto adicional antes o después, con esta estructura EXACTA:

Bloque,Codigo,Nombre,Creditos,[una columna por cada valor listado en HORAS_COLUMNAS],Requisitos,Correquisitos

(Si HORAS_COLUMNAS es "Ninguna", omite esas columnas del encabezado y de cada fila.)

REGLAS:

1. BLOQUE: número de nivel/ciclo/año/semestre/cuatrimestre convertido a un ENTERO SECUENCIAL único
   y creciente según el orden real en que se cursan (ej: si el documento organiza por "Año" y dentro
   por "Ciclo I/II", o por "Verano", cada uno de esos sub-bloques cronológicos es un número distinto:
   1, 2, 3, 4... no reinicies el conteo al cambiar de año). Si el documento usa nombres en vez de
   números, conviértelo al secuencial correspondiente. Si no puedes determinarlo con certeza,
   escribe "REVISAR".

2. CODIGO: la sigla/código tal como aparece en el documento. Si la materia no tiene código propio
   (ej: "Optativa", "Electivo 1", "Idioma Intensivo"), genera uno corto y consistente a partir del
   nombre y el bloque (ej: OPT-B7, ELEC-B9), para que no se dupliquen entre bloques distintos.

3. HORAS: usa 0 si el documento no reporta ese tipo de hora para esa materia puntual — nunca dejes
   la celda vacía. Si el documento presenta las horas dentro de una cuadrícula gráfica (cajas de
   colores, diagramas tipo escalera, etc.) en vez de una tabla, extrae el mismo dato de cada caja
   como si fuera una fila de tabla.

4. REQUISITOS y CORREQUISITOS — sintaxis para relaciones lógicas, SIN usar nunca coma "," dentro
   de la celda (la coma rompe el CSV):
   - ";" separa requisitos que se necesitan TODOS (Y / AND).
   - "/" separa alternativas equivalentes dentro de un mismo requisito, incluyendo tanto
     disyunciones explícitas ("Materia A o Materia B") como equivalencias declaradas
     ("Equiv.: MateriaB", "PS-0002 o PS-0128").
   - Si hay que combinar Y/O en la misma celda, usa paréntesis para agrupar y evitar ambigüedad:
     "(A;B)/(C;D)" significa (A Y B) O (C Y D).
     Ejemplo real: "QU-0102, QU-0103 o (QU-0114, QU-0115)" → "(QU-0102;QU-0103)/(QU-0114;QU-0115)"
   - Si no hay requisitos o correquisitos, escribe "Ninguno" (nunca dejes la celda vacía ni cortes
     la fila antes de completar todas las columnas del encabezado).
   - Si el documento no maneja el concepto de "correquisitos" en absoluto, escribe igual "Ninguno"
     en esa columna para todas las filas (mantén la columna por consistencia del esquema).

5. NOMBRE (y cualquier otra columna): si el nombre real de la materia trae una coma
   (ej. "Ética, Persona y Sociedad"), envuelve ESA CELDA completa entre comillas dobles.
   Ante la duda, usa comillas de más y no de menos.

6. No agregues columnas de categoría, área, color, ni ninguna otra fuera de las indicadas.
7. No omitas ninguna materia, incluidas optativas, electivas, idiomas, seminarios, prácticas,
   trabajos finales de graduación y cursos de nivelación/precálculo (aunque tengan 0 créditos).
8. Si el documento incluye tablas separadas de "cursos optativos" o "electivas disponibles" fuera
   de la malla principal, inclúyelas también, usando como Bloque el ciclo donde se indica que se
   puede cursar esa optativa (o "REVISAR" si no se especifica).
9. Si una celda es ilegible, ambigua, o no puedes confirmarla con certeza, escribe "REVISAR" en
   vez de inventar un dato — nunca inventes códigos, créditos u horas que no estén en el documento.
10. Ignora tablas resumen de totales generales (ej. "Créditos totales de la carrera: 448") — esas
    no son filas de materias, son metadatos de resumen y no van en el CSV.`;
}

/** Lee las líneas opcionales CARRERA:/CODIGO_PLAN:/UNIVERSIDAD:/TIPO_TITULO:/
 *  HORAS_COLUMNAS: al inicio de la respuesta de la IA (v5 1.3, ampliado en
 *  v1.12 con los últimos dos), sin romperse si no existen. Devuelve
 *  { metadatos: {...}, csv: "texto sin esas líneas" }.
 *  `metadatos.horas_columnas` viaja como el string crudo tal cual lo mandó la
 *  IA (ej. "T,P,L,EI" o "Ninguna") — quien la consuma (plan-importacion-csv.js
 *  / plan-esquema.js) es quien la convierte a arreglo `tipos_horas`. */

function extraerMetadatosImportacion(textoCrudo) {
  const lineas = textoCrudo.replace(/```[a-zA-Z]*\n?/g, "").split(/\r?\n/);
  const metadatos = {};
  let i = 0;
  const patrones = {
    carrera: /^CARRERA:\s*(.+)$/i,
    codigo_plan: /^CODIGO_PLAN:\s*(.+)$/i,
    universidad: /^UNIVERSIDAD:\s*(.+)$/i,
    tipo_titulo: /^TIPO_TITULO:\s*(.+)$/i,
    horas_columnas: /^HORAS_COLUMNAS:\s*(.+)$/i,
  };
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

  // v1.12: ya NO se pregunta universidad ni tipos de horas por adelantado —
  // el nuevo prompt universal (construirPromptImportacion) le pide a la IA
  // que detecte HORAS_COLUMNAS leyendo el propio documento, y el parser
  // (plan-importacion-csv.js, extraerMetadatosImportacion + parsearCSVPlanEstudios)
  // deriva tipos_horas de esa línea al procesar la respuesta. Los campos
  // estado.universidadImportacion/tiposHorasImportacion/etc. quedan como
  // legado hasta terminar de limpiar su uso en plan-esquema.js (el modal
  // "Nuevo Plan" que crea el plan tras pegar el CSV).

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
      abrirModalInstruccionesImportacion(
        estado.modoImportacion,
        "claude",
        construirPromptImportacion(estado.modoImportacion, estado.linkImportacion)
      );
    });
    filaBotones.appendChild(btnClaude);

    const btnChatGPT = document.createElement("button");
    btnChatGPT.className = "btn btn-secondary";
    btnChatGPT.style.flex = "1";
    btnChatGPT.textContent = "Enviar a ChatGPT";
    btnChatGPT.addEventListener("click", () => {
      abrirModalInstruccionesImportacion(
        estado.modoImportacion,
        "chatgpt",
        construirPromptImportacion(estado.modoImportacion, estado.linkImportacion)
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
