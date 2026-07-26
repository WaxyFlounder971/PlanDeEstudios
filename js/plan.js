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
 * B (v9)/v8 punto 2: versión compacta de formatearHoras para la tarjeta
 * COLAPSADA — con más de un tipo de horas, muestra solo la inicial de cada
 * uno (ej. "T4 P0 L0 TP0" para Teoría/Práctica/Laboratorio/Teoría-Práctica).
 * Con un solo tipo (ej. TEC: "Horas"), mantiene la etiqueta completa porque
 * ahí no hay ambigüedad que evitar ni espacio que ahorrar.
 */
function formatearHorasCompactoIniciales(materia) {
  const entradas = Object.entries(materia.horas || {});
  if (entradas.length === 0) return "";
  if (entradas.length === 1) return `${entradas[0][0]}: ${entradas[0][1]}`;
  return entradas
    .map(([tipo, valor]) => {
      const inicial = tipo.split(/[\s-]+/).map((palabra) => palabra.charAt(0) || "").join("").toUpperCase();
      return `${inicial}${valor}`;
    })
    .join(" ");
}

/* ===================== Flechas de scroll horizontal reutilizables ===================== */

/**
 * Bug 3 (v8): envuelve `elementoScroll` (cualquier contenedor con
 * `overflow-x` scrolleable, ej. un .pill-group) con flechitas "‹ ›" de solo
 * símbolo (mismo estilo que la navegación entre Planes de Estudio), que
 * solo se muestran cuando el contenido realmente desborda el ancho
 * disponible, y se ocultan solas al llegar a cada extremo. Se reutiliza
 * también en Ajuste 3 (scroll horizontal del mapa curricular).
 */
function envolverConFlechasScroll(elementoScroll) {
  const wrapper = document.createElement("div");
  wrapper.className = "scroll-con-flechas";
  elementoScroll.parentNode.insertBefore(wrapper, elementoScroll);

  // B.2 (v9): en vez de un scrollBy() de distancia fija (que dejaba el
  // siguiente elemento a medio mostrar), se calcula cuál es el próximo
  // elemento realmente oculto en esa dirección y se desliza hasta que
  // quede completamente visible (scrollIntoView), nunca a medias.
  const crearFlecha = (simbolo, direccion, etiqueta) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "flecha-plan flecha-scroll";
    btn.textContent = simbolo;
    btn.setAttribute("aria-label", etiqueta);
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const hijos = Array.from(elementoScroll.children);
      if (hijos.length === 0) return;
      const scrollActual = elementoScroll.scrollLeft;
      const anchoVisible = elementoScroll.clientWidth;
      if (direccion > 0) {
        const objetivo = hijos.find((h) => h.offsetLeft + h.offsetWidth > scrollActual + anchoVisible + 1);
        if (objetivo) objetivo.scrollIntoView({ behavior: "smooth", inline: "end", block: "nearest" });
      } else {
        const objetivo = hijos.slice().reverse().find((h) => h.offsetLeft < scrollActual - 1);
        if (objetivo) objetivo.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
      }
    });
    return btn;
  };
  const btnPrev = crearFlecha("‹", -1, "Desplazar hacia la izquierda");
  const btnNext = crearFlecha("›", 1, "Desplazar hacia la derecha");

  wrapper.appendChild(btnPrev);
  wrapper.appendChild(elementoScroll);
  wrapper.appendChild(btnNext);

  const actualizarFlechas = () => {
    const desborda = elementoScroll.scrollWidth > elementoScroll.clientWidth + 1;
    btnPrev.classList.toggle("oculto", !desborda || elementoScroll.scrollLeft <= 1);
    btnNext.classList.toggle(
      "oculto",
      !desborda || elementoScroll.scrollLeft + elementoScroll.clientWidth >= elementoScroll.scrollWidth - 1
    );
  };
  elementoScroll.addEventListener("scroll", actualizarFlechas);
  // ResizeObserver (no un listener en window) para que, si esta tarjeta se
  // vuelve a renderizar y se descarta, el observer no siga acumulándose
  // indefinidamente: al perder toda referencia al nodo desconectado, tanto
  // el observer como su callback quedan libres para recolectarse.
  if (window.ResizeObserver) {
    new ResizeObserver(actualizarFlechas).observe(elementoScroll);
  }
  requestAnimationFrame(actualizarFlechas);

  return wrapper;
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
- Bloque: número de nivel/semestre/cuatrimestre tal como aparece en el documento/página. Si usa nombres en vez de números, conviértelo al número secuencial correspondiente. Si no puedes determinarlo con certeza, escribe "REVISAR". Si la materia es una OPTATIVA/ELECTIVA (de las que el estudiante elige entre varias, no una materia fija de un bloque específico), escribe "ELECTIVA" en esta columna en vez de un número — esto aplica sin importar en qué bloque/nivel del documento original aparezca listada.
- Codigo: la sigla tal como aparece; si no tiene, genera uno corto y consistente a partir del nombre.
- Horas: usa 0 si el documento no maneja esa categoría — nunca las dejes vacías.
- Requisitos y Correquisitos: usa punto y coma ";" para separar requisitos distintos que se necesitan TODOS ("Y"), y diagonal "/" para separar materias equivalentes/alternativas dentro de un mismo requisito ("O"). NUNCA uses coma "," dentro de esta celda — la coma ya se usa para separar las columnas del CSV y mezclarla aquí rompe el archivo. Ejemplo: "MA-1001;FS-0210/FS-0227/FS-0250" significa MA-1001 Y (una de las tres alternativas). Si no hay requisitos, usa "Ninguno".
- IMPORTANTE — Nombre: varios nombres de materias reales incluyen una coma (ej. "Ética, Persona y Sociedad"). Si el Nombre de una materia trae una coma real, envuelve ESA CELDA completa entre comillas dobles, así: "Ética, Persona y Sociedad". Esto aplica a cualquier otra columna que también pueda traer una coma real. Si tienes dudas, mejor usar comillas de más que de menos.
- No dejes ninguna columna vacía sin su coma correspondiente: si Correquisitos (o cualquier otra columna) no aplica, escribe igual "Ninguno" — nunca cortes la línea antes de completar todas las columnas del encabezado.
- No agregues columna de categoría ni ninguna otra fuera de las columnas indicadas.
- No omitas ninguna materia, incluidas optativas/electivas (usa "ELECTIVA" en Bloque para esas, como se explicó arriba — no las omitas ni las mezcles con las demás).
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
estado.ordenPlanEstudios = "bloque";       // "bloque" | "categoria" | "estado"
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
estado.modoActualizarMalla = "agregar";   // C.5 (v9): "agregar" | "reemplazar" — al reimportar CSV sobre un plan existente

/* ---- B.3 (v8/v9): Vista de Mapa interactivo del Plan de Estudios ---- */
estado.vistaPlanEstudios = "lista";        // "lista" | "mapa"
estado.colorMapaPor = "simbologia";        // "simbologia" (por Estado) | "categoria"
estado.zoomMapa = 1;                       // 0.5 a 2
estado.materiaSeleccionadaMapa = null;     // código de la materia con camino de desbloqueo dibujado
estado._refsMapaActual = null;             // referencias DOM del mapa ya renderizado (para zoom/recolorear sin re-render completo)

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
/**
 * B.2 (v9)/Bug 9 (v8): valida si un token es un número romano válido
 * (I, II, III, IV, ..., XII, etc.), sin importar mayúsculas/minúsculas de
 * origen. Se usa para que "Inglés II" nunca se convierta en "Inglés Ii" al
 * aplicar el formato de nombres — el token romano se deja siempre en
 * mayúsculas completas, sin importar cuál de las 3 opciones esté activa.
 */
function esTokenNumeroRomano(token) {
  if (!token) return false;
  if (!/^[IVXLCDM]+$/i.test(token)) return false;
  return /^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/i.test(token);
}

/**
 * Aplica la transformación de UNA palabra según el formato elegido, dejando
 * los números romanos siempre en mayúsculas completas sin importar el
 * formato ni su posición en la frase.
 */
function transformarPalabraFormato(palabra, formato, esPrimeraPalabra) {
  if (!palabra) return palabra;
  if (esTokenNumeroRomano(palabra)) return palabra.toUpperCase();

  if (formato === "mayusculas") return palabra.toUpperCase();

  if (formato === "oracion") {
    const p = palabra.toLowerCase();
    return esPrimeraPalabra ? p.charAt(0).toUpperCase() + p.slice(1) : p;
  }

  // "titulo" (default): Cada Palabra Capitalizada.
  const p = palabra.toLowerCase();
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function aplicarFormatoTexto(texto) {
  const original = texto || "";
  if (!original) return "";
  const formato = (estado.datos && estado.datos.configuracion && estado.datos.configuracion.formato_texto_nombres) || "titulo";

  return original
    .split(" ")
    .map((palabra, i) => transformarPalabraFormato(palabra, formato, i === 0))
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
    // C.3 (v9): si el plan activo no tiene ninguna materia todavía, no tiene
    // sentido mostrar Estadísticas/Buscador/Categorías (no hay nada que
    // medir, buscar ni categorizar) — se ocultan hasta que exista al menos
    // una. (La tarjeta de Semestres todavía no existe dentro de esta
    // sección — queda pendiente para cuando se construya esa parte.)
    const hayMaterias = obtenerMateriasVisibles().length > 0;
    if (hayMaterias) {
      cont.appendChild(construirPanelEstadisticas(principal));
      // B.3 (v8/v9): tarjeta "Vista" (switch Lista/Mapa) — en modo Mapa,
      // Buscador/Categorías se ocultan y el mapa reemplaza el listado de
      // bloques (vive dentro de esta misma tarjeta, expandida).
      cont.appendChild(construirTarjetaVista(principal));
      if (estado.vistaPlanEstudios !== "mapa") {
        cont.appendChild(construirBarraAcciones());
        cont.appendChild(construirPanelCategorias());
      }
    }
    if (!hayMaterias || estado.vistaPlanEstudios !== "mapa") {
      cont.appendChild(construirContenidoBloques());
    }
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
        // B.2 (v9): "No aplica" ahora es un concepto exclusivo de universidad
        // "Otra" — al elegir TEC/UCR se usa siempre su preset completo.
        estado.horasNoAplicaImportacion = false;
        estado.tiposHorasImportacion = PRESETS_TIPOS_HORAS[op.valor].slice();
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

    // B.2 (v9): "No aplica" solo tiene sentido para universidad "Otra" — TEC y
    // UCR siempre manejan Horas con su preset fijo, así que el checkbox ya
    // no se muestra para ellas (antes aparecía siempre, contradiciendo lo
    // pedido — comentario "v7.1: independiente de la universidad elegida").
    const labelNoAplica = document.createElement("label");
    labelNoAplica.className = "checkbox";
    labelNoAplica.innerHTML = `<input type="checkbox" id="checkbox-horas-no-aplica-importacion" ${estado.horasNoAplicaImportacion ? "checked" : ""}><span class="box"></span><span>No aplica — este plan no maneja Horas</span>`;
    labelNoAplica.querySelector("input").addEventListener("change", (e) => {
      estado.horasNoAplicaImportacion = e.target.checked;
      estado.tiposHorasImportacion = e.target.checked
        ? []
        : estado.tiposHorasPersonalizadoTexto.split(",").map((t) => t.trim()).filter(Boolean);
      renderizarPlanEstudios();
    });
    sec.appendChild(labelNoAplica);
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
  // v7.1: un arreglo vacío es "No aplica" a propósito (ver crearMateria en
  // schema.js) — solo se usa el default ["Horas"] cuando tiposHoras
  // realmente no vino (undefined/null), nunca cuando vino vacío queriendo
  // decir "este plan no maneja horas". El chequeo anterior (`&& .length`)
  // convertía silenciosamente [] de vuelta a ["Horas"], lo que rompía el
  // cálculo de columnasEsperadas para planes "No aplica" (esperaba una
  // columna de Horas que el CSV real, generado sin esa columna, nunca trae).
  const tipos = tiposHoras !== undefined && tiposHoras !== null ? tiposHoras : ["Horas"];

  const lineas = textoCrudo
    .replace(/```[a-zA-Z]*\n?/g, "") // por si el usuario pegó el bloque con los ``` incluidos
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) return { materias: [], electivas: [], errores: ["El CSV está vacío."] };

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
  const electivas = [];
  const errores = [];

  filas.forEach((linea, indice) => {
    const numeroFila = indice + 2; // +2 = +1 por el encabezado, +1 por ser 1-indexado
    let columnas = parsearLineaCSV(linea);

    // v7.1 (causa raíz real de "faltan materias"): aunque el prompt le pide a
    // la IA nunca usar comas sueltas, en la práctica el campo Nombre trae
    // comas reales con bastante frecuencia (ej. "Ética, Persona y Sociedad")
    // y la IA externa no siempre las envuelve en comillas. Antes, cualquier
    // desajuste de columnas descartaba la fila entera sin más. Ahora se
    // intenta reparar automáticamente antes de darse por vencido:
    if (columnas.length > columnasEsperadas) {
      // Sobran columnas: lo más probable es que el Nombre (índice 2) se haya
      // partido en varios pedazos por comas internas sin comillas. Se vuelven
      // a unir esos pedazos de más, asumiendo que el resto de columnas
      // (Bloque, Codigo, Creditos, horas, Requisitos, Correquisitos) están
      // en su lugar correcto contando desde el final de la fila.
      const sobran = columnas.length - columnasEsperadas;
      const nombreReconstruido = columnas.slice(2, 2 + sobran + 1).join(", ");
      columnas = [
        columnas[0],
        columnas[1],
        nombreReconstruido,
        ...columnas.slice(2 + sobran + 1),
      ];
    } else if (columnas.length < columnasEsperadas) {
      // Faltan columnas: normalmente porque la IA omitió campos vacíos al
      // final de la línea (Correquisitos, a veces también Requisitos) en vez
      // de dejar la coma. Se rellenan con "" al final en vez de perder toda
      // la fila — como máximo 2 columnas de diferencia, si falta más que eso
      // ya es un error real que sí hay que reportar.
      const faltan = columnasEsperadas - columnas.length;
      if (faltan <= 2) {
        columnas = [...columnas, ...Array(faltan).fill("")];
      }
    }

    if (columnas.length !== columnasEsperadas) {
      errores.push(`Fila ${numeroFila}: se esperaban ${columnasEsperadas} columnas y se encontraron ${parsearLineaCSV(linea).length} (no se pudo reparar automáticamente). Contenido: "${linea}"`);
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

    // C.4 (v9): "ELECTIVA"/"OPTATIVA" en la columna Bloque (en vez de un
    // número) marca esta materia como electiva/optativa — se detecta como
    // tal y se enruta al arreglo separado en vez de al de materias fijas.
    const esOptativa = /^(ELECTIVA|OPTATIVA)S?$/i.test(String(bloque).trim());

    const materiaCreada = crearMateria({
      codigo,
      nombre,
      creditos: Number(creditos) || 0,
      horas,
      tiposHoras: tipos,
      bloque: esOptativa ? null : (Number(bloque) || bloque),
      requisitos: parsearGrupoRequisitos(requisitos),
      correquisitos: parsearGrupoRequisitos(correquisitos),
      esOptativa,
    });

    if (esOptativa) electivas.push(materiaCreada);
    else materias.push(materiaCreada);
  });

  return { materias, electivas, errores };
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
  const { materias, electivas, errores } = parsearCSVPlanEstudios(textoCSV, planDestino.parametros_universidad.tipos_horas);

  // Se combina por código: si ya existía, se actualiza; si es nueva, se agrega.
  materias.forEach((nueva) => {
    const existente = planDestino.materias.find((m) => m.codigo === nueva.codigo);
    if (existente) {
      Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
    } else {
      planDestino.materias.push(nueva);
    }
  });

  // C.4 (v9): las electivas detectadas se combinan por código contra lo que
  // YA exista (formalmente agregado en `materias`, o todavía "disponible"
  // en `optativas_disponibles`) — si ya está en cualquiera de los dos
  // lados, no se duplica; si es nueva, se agrega como disponible.
  if (!Array.isArray(planDestino.optativas_disponibles)) planDestino.optativas_disponibles = [];
  electivas.forEach((nueva) => {
    const yaAgregada = planDestino.materias.some((m) => m.codigo === nueva.codigo);
    if (yaAgregada) return;
    const existenteDisponible = planDestino.optativas_disponibles.find((m) => m.codigo === nueva.codigo);
    if (existenteDisponible) {
      Object.assign(existenteDisponible, nueva);
    } else {
      planDestino.optativas_disponibles.push(nueva);
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
  const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
  const inputUniOtraNombre = document.getElementById("input-universidad-otra-nombre");
  const bloqueNoAplica = document.getElementById("bloque-horas-no-aplica-plan");
  const checkboxNoAplica = document.getElementById("checkbox-horas-no-aplica");
  inputUniOtraNombre.value = estado.nombreUniversidadImportacion || "";
  if (btnInicial.dataset.valor === "Otra") {
    bloquePersonalizado.classList.remove("oculto");
    bloqueUniOtraNombre.classList.remove("oculto");
    bloqueNoAplica.classList.remove("oculto");
    inputPersonalizado.value = estado.tiposHorasPersonalizadoTexto || "";
    // v7.1: continúa desde lo elegido en el panel de importación (universidad
    // libre y "No aplica"), en vez de reiniciar ambos campos siempre.
    checkboxNoAplica.checked = !!estado.horasNoAplicaImportacion;
    inputPersonalizado.disabled = checkboxNoAplica.checked;
    // v7.1: si vino detectada por la IA (metadatos.universidad) y no coincidió
    // con TEC/UCR, se precarga como valor real editable (nunca genérico).
    if (metadatos.universidad && !["TEC", "UCR"].includes(mapearUniversidadDetectada(metadatos.universidad))) {
      inputUniOtraNombre.value = metadatos.universidad;
    }
  } else {
    bloquePersonalizado.classList.add("oculto");
    bloqueUniOtraNombre.classList.add("oculto");
    bloqueNoAplica.classList.add("oculto");
    // B.2 (v9): "No aplica" solo existe para "Otra" — para TEC/UCR queda
    // siempre desmarcado, así el plan usa el preset de horas completo.
    checkboxNoAplica.checked = false;
    inputPersonalizado.disabled = false;
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
 *  (según el pill de universidad activo), sin importar si es TEC/UCR/Personalizada.
 *  v7.1: el checkbox "No aplica" tiene prioridad sobre cualquier preset —
 *  el usuario puede marcar que este plan no maneja horas sin importar la
 *  universidad elegida. */
function leerTiposHorasDelModalCrearPlan() {
  if (document.getElementById("checkbox-horas-no-aplica").checked) return [];
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
      const bloqueUniOtraNombre = document.getElementById("bloque-universidad-otra-nombre");
      const bloqueNoAplica = document.getElementById("bloque-horas-no-aplica-plan");
      const checkboxNoAplica = document.getElementById("checkbox-horas-no-aplica");
      const inputPersonalizado = document.getElementById("input-tipos-horas-personalizados");
      if (btn.dataset.valor === "TEC" || btn.dataset.valor === "UCR") {
        bloquePersonalizado.classList.add("oculto");
        bloqueUniOtraNombre.classList.add("oculto");
        bloqueNoAplica.classList.add("oculto");
        // B.2 (v9): al salir de "Otra" se desmarca "No aplica" — para TEC/UCR
        // el plan siempre usa el preset de horas completo.
        checkboxNoAplica.checked = false;
        inputPersonalizado.disabled = false;
        aplicarDefaultsUniversidad(btn.dataset.valor);
      } else {
        bloquePersonalizado.classList.remove("oculto");
        bloqueUniOtraNombre.classList.remove("oculto");
        bloqueNoAplica.classList.remove("oculto");
      }
    });
  });

  // v7.1: marcar/desmarcar "No aplica" solo deshabilita visualmente el campo
  // de tipos de horas personalizados (si está visible) para dejar claro que
  // no se va a usar, sin perder lo que el usuario ya había escrito ahí.
  document.getElementById("checkbox-horas-no-aplica").addEventListener("change", (e) => {
    document.getElementById("input-tipos-horas-personalizados").disabled = e.target.checked;
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
    const universidadPill = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
    // v7.1: si el pill activo es "Otra", se guarda el nombre real que el
    // usuario escribió (nunca la palabra genérica "Otra"); si lo dejó
    // vacío, se cae de vuelta a "Otra" para no guardar un campo vacío.
    const universidad = universidadPill === "Otra"
      ? (document.getElementById("input-universidad-otra-nombre").value.trim() || "Otra")
      : universidadPill;
    const tiposHoras = leerTiposHorasDelModalCrearPlan();
    if (universidadPill === "Otra") {
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

  // C.5 (v9): por defecto se AGREGA/actualiza sobre lo que ya existe (nunca
  // se pierden estados, notas ni categorías); "Reemplazar" es una elección
  // explícita, con confirmación antes de ejecutarla porque sí borra datos.
  // Solo tiene sentido mostrar el switch si ya hay algo que agregar-o-
  // reemplazar; con el plan vacío, "Agregar" y "Reemplazar" son lo mismo.
  if (plan.materias.length > 0) {
    const etiquetaModoActualizar = document.createElement("span");
    etiquetaModoActualizar.className = "form-label";
    etiquetaModoActualizar.textContent = "Al importar este CSV:";
    sec.appendChild(etiquetaModoActualizar);

    const grupoModoActualizar = document.createElement("div");
    grupoModoActualizar.className = "pill-group";
    [
      { valor: "agregar", texto: "Agregar" },
      { valor: "reemplazar", texto: "Reemplazar" },
    ].forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (estado.modoActualizarMalla === op.valor ? " active" : "");
      btn.textContent = op.texto;
      btn.addEventListener("click", () => {
        estado.modoActualizarMalla = op.valor;
        renderizarPlanEstudios();
      });
      grupoModoActualizar.appendChild(btn);
    });
    sec.appendChild(grupoModoActualizar);

    const notaModoActualizar = document.createElement("p");
    notaModoActualizar.className = "muted";
    notaModoActualizar.style.color = estado.modoActualizarMalla === "reemplazar" ? "var(--color-danger)" : "";
    notaModoActualizar.textContent = estado.modoActualizarMalla === "reemplazar"
      ? "⚠️ Esto borrará todas las materias actuales de este plan (estados, notas y categorías incluidas) y las sustituirá por completo con lo que traiga este CSV."
      : "Se agregan las materias nuevas y se actualizan las existentes por código — nada de lo que ya tienes (estados, notas, categorías) se pierde.";
    sec.appendChild(notaModoActualizar);
  }

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
  const ejecutarImportacionMalla = () => {
    // v5 1.3: si la IA detectó carrera/código/universidad, se leen aquí
    // (sin romperse si no vienen) — solo se usan para actualizar los datos
    // de encabezado del plan si el usuario los dejó vacíos originalmente.
    const { metadatos, csv } = extraerMetadatosImportacion(textarea.value);
    if (metadatos.carrera && !plan.nombre_carrera) plan.nombre_carrera = metadatos.carrera;
    if (metadatos.codigo_plan && !plan.codigo_plan) plan.codigo_plan = metadatos.codigo_plan;

    // C.5 (v9): "Reemplazar" borra lo que había ANTES de aplicar el CSV
    // nuevo; "Agregar" (default) combina por código como ya se hacía.
    // C.4 (v9): "Reemplazar" también limpia las optativas disponibles
    // pendientes — es un reinicio completo del plan a partir del CSV nuevo.
    if (estado.modoActualizarMalla === "reemplazar") {
      plan.materias = [];
      plan.optativas_disponibles = [];
    }

    const { materias, electivas, errores } = parsearCSVPlanEstudios(csv, plan.parametros_universidad.tipos_horas);
    materias.forEach((nueva) => {
      const existente = plan.materias.find((m) => m.codigo === nueva.codigo);
      if (existente) Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
      else plan.materias.push(nueva);
    });

    // C.4 (v9): igual que en importarCSVEnPlan — una electiva nueva se
    // agrega a "disponibles"; si ya estaba agregada formalmente o ya estaba
    // en disponibles, se actualiza en su lugar en vez de duplicarse.
    if (!Array.isArray(plan.optativas_disponibles)) plan.optativas_disponibles = [];
    electivas.forEach((nueva) => {
      const yaAgregada = plan.materias.some((m) => m.codigo === nueva.codigo);
      if (yaAgregada) return;
      const existenteDisponible = plan.optativas_disponibles.find((m) => m.codigo === nueva.codigo);
      if (existenteDisponible) Object.assign(existenteDisponible, nueva);
      else plan.optativas_disponibles.push(nueva);
    });

    marcarCambioPendiente();
    resultado.innerHTML = errores.length
      ? `<p class="muted" style="color:var(--color-danger);">Algunas filas no se pudieron importar:</p>` +
        errores.map((e) => `<p class="muted" style="color:var(--color-danger);">• ${e}</p>`).join("")
      : `<p class="muted" style="color:#34d399;">¡Listo! ${materias.length + electivas.length} materias procesadas.</p>`;
    estado.panelImportacionAbierto = false;
    renderizarPlanEstudios();
  };

  btnImportar.addEventListener("click", () => {
    if (!textarea.value.trim()) {
      resultado.innerHTML = `<p class="muted" style="color:var(--color-danger);">Pega primero el CSV.</p>`;
      return;
    }
    if (estado.modoActualizarMalla === "reemplazar" && plan.materias.length > 0) {
      abrirConfirmacion({
        titulo: "¿Reemplazar toda la malla?",
        mensaje: "Vas a borrar todas las materias actuales de este plan (estados, notas y categorías incluidas) y sustituirlas por completo con el nuevo CSV. Esta acción no se puede deshacer.",
        textoConfirmar: "Sí, reemplazar",
        claseConfirmar: "btn-danger",
        onConfirmar: ejecutarImportacionMalla,
      });
    } else {
      ejecutarImportacionMalla();
    }
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
  const tipos = plan && Array.isArray(plan.parametros_universidad.tipos_horas)
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

    const tiposHoras = Array.isArray(plan.parametros_universidad.tipos_horas)
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
    // C.5 (v9): siempre arranca en "Agregar" (el modo seguro/no-destructivo)
    // cada vez que se abre el panel, para no arrastrar "Reemplazar" elegido
    // en una sesión anterior sin que el usuario lo note.
    estado.modoActualizarMalla = "agregar";
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
    { valor: "estado", texto: "Ordenar por estado" },
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
  let hayOptativasAgregadas = false;
  obtenerMateriasVisibles().forEach((f) => {
    // C.4 (v9): las optativas ya agregadas no tienen un Bloque numérico
    // real (materia.bloque queda null) — no participan de esta agrupación,
    // se cuentan aparte para agregar la clave del bloque especial abajo.
    if (f.materia.es_optativa) { hayOptativasAgregadas = true; return; }
    claves.add(estado.ordenPlanEstudios === "categoria" ? f.materia.categoria_id || "sin_categoria" : String(f.materia.bloque));
  });
  if (hayOptativasAgregadas || obtenerOptativasDisponibles().length > 0) claves.add("__optativas__");
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

  const tipos = Array.isArray(principal.parametros_universidad.tipos_horas)
    ? principal.parametros_universidad.tipos_horas
    : ["Horas"];

  const encabezado = `${construirEncabezadoCSV(tipos)},Estado,CategoriaId`;
  const filas = principal.materias.map((m) => {
    const columnasHoras = tipos.map((tipo) => (m.horas || {})[tipo] || 0);
    const campos = [
      m.es_optativa ? "ELECTIVA" : m.bloque,
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
    .sort((a, b) => (estado.ordenCategoriaMaterias === "bloque" ? (a.bloque ?? 999) - (b.bloque ?? 999) : a.codigo.localeCompare(b.codigo)));

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

/** C.4 (v9): todas las electivas/optativas detectadas pero NO agregadas
 *  formalmente todavía (staging, fuera de plan.materias — por eso nunca
 *  cuentan en ningún total, ver obtenerMateriasVisibles). */
function obtenerOptativasDisponibles() {
  const principal = obtenerPlanActivo();
  const secundario = obtenerPlanSecundario();
  const filas = [];
  if (principal) (principal.optativas_disponibles || []).forEach((m) => filas.push({ materia: m, plan: principal, origen: "principal" }));
  if (secundario) (secundario.optativas_disponibles || []).forEach((m) => filas.push({ materia: m, plan: secundario, origen: "secundario" }));
  return filas;
}

function construirContenidoBloques() {
  const contenedor = document.createElement("div");
  contenedor.className = "stack";

  const todasLasFilas = obtenerMateriasVisibles();
  const todasOptativasDisponibles = obtenerOptativasDisponibles();
  if (todasLasFilas.length === 0 && todasOptativasDisponibles.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Este plan todavía no tiene materias. Impórtalas o añádelas manualmente desde el panel de arriba.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  // C.4 (v9): las optativas YA agregadas nunca entran en la agrupación
  // normal por bloque/categoría/estado — siempre viven en su propio bloque
  // "Optativas" al final (ver más abajo), sin importar el orden activo.
  const filas = filasFiltradas().filter((f) => !f.materia.es_optativa);
  const filasOptativasAgregadas = filasFiltradas().filter((f) => f.materia.es_optativa);

  // El filtro de búsqueda de texto también aplica a las disponibles; el de
  // Categoría no (todavía no tienen ninguna asignada, así que un filtro de
  // categoría activo las oculta por completo — es el comportamiento
  // esperado, no un descuido).
  let disponibles = estado.filtroCategoriaId ? [] : todasOptativasDisponibles;
  const q = (estado.busquedaPlanEstudios || "").trim().toLowerCase();
  if (q) {
    disponibles = disponibles.filter(
      (f) => f.materia.nombre.toLowerCase().includes(q) || f.materia.codigo.toLowerCase().includes(q)
    );
  }

  if (filas.length === 0 && filasOptativasAgregadas.length === 0 && disponibles.length === 0) {
    const sec = document.createElement("section");
    sec.className = "glass-card";
    sec.innerHTML = `<p class="muted">Ninguna materia coincide con la búsqueda o el filtro actual.</p>`;
    contenedor.appendChild(sec);
    return contenedor;
  }

  const cfg = estado.datos.configuracion;
  const esEscritorio = window.innerWidth >= 900;

  if (filas.length > 0) {
    const grupos = new Map();
    const nombreGrupo = new Map();

    filas.forEach((fila) => {
      let clave, nombre;
      if (estado.ordenPlanEstudios === "categoria") {
        clave = fila.materia.categoria_id || "sin_categoria";
        const cat = fila.plan.categorias.find((c) => c.id === fila.materia.categoria_id);
        nombre = cat ? cat.nombre : "Sin categoría";
      } else if (estado.ordenPlanEstudios === "estado") {
        clave = fila.materia.estado;
        const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === fila.materia.estado);
        nombre = infoEstado ? infoEstado.texto : fila.materia.estado;
      } else {
        clave = String(fila.materia.bloque);
        nombre = `${fila.plan.parametros_universidad.nombre_bloque} ${fila.materia.bloque}`;
      }
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(fila);
      nombreGrupo.set(clave, nombre);
    });

    const clavesOrdenadas = Array.from(grupos.keys()).sort((a, b) => {
      if (estado.ordenPlanEstudios === "estado") {
        // Orden lógico (Pendiente → Cursando → Aprobada → Reprobada), no alfabético.
        const ia = ESTADOS_MATERIA.findIndex((e) => e.valor === a);
        const ib = ESTADOS_MATERIA.findIndex((e) => e.valor === b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      const na = Number(a), nb = Number(b);
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return String(nombreGrupo.get(a)).localeCompare(String(nombreGrupo.get(b)));
    });

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
  }

  // C.4 (v9): bloque "Optativas", siempre al final, sin importar el orden
  // activo — combina las ya agregadas formalmente (tarjeta completa) con
  // las detectadas y aún no agregadas (tarjeta simplificada + botón).
  if (filasOptativasAgregadas.length > 0 || disponibles.length > 0) {
    contenedor.appendChild(construirBloqueOptativas(filasOptativasAgregadas, disponibles, esEscritorio, cfg.modo_hardcore));
  }

  return contenedor;
}

/**
 * C.4 (v9): bloque especial "Optativas" — nunca participa del orden por
 * bloque/categoría/estado, siempre se dibuja al final. Muestra primero la
 * etiqueta "Electivas u optativas disponibles: N" + las tarjetas
 * simplificadas con botón "Agregar al plan de estudios", y debajo las que
 * ya fueron agregadas formalmente (tarjeta completa, igual que cualquier
 * otra materia — ya cuentan en los totales).
 */
function construirBloqueOptativas(filasAgregadas, filasDisponibles, esEscritorio, mostrarOrigen) {
  const bloqueCard = document.createElement("section");
  bloqueCard.className = "glass-card bloque-card";

  const clave = "__optativas__";
  const colapsado = estado.bloquesColapsados.has(clave);

  const encabezado = document.createElement("div");
  encabezado.className = "bloque-encabezado";
  encabezado.innerHTML = `<h3>Optativas</h3><span style="opacity:0.7;">${colapsado ? "▼" : "▲"}</span>`;
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

    if (filasDisponibles.length > 0) {
      const etiquetaDisponibles = document.createElement("p");
      etiquetaDisponibles.className = "muted";
      etiquetaDisponibles.textContent = `Electivas u optativas disponibles: ${filasDisponibles.length}`;
      cuerpoBloque.appendChild(etiquetaDisponibles);

      filasDisponibles.forEach((fila) => {
        cuerpoBloque.appendChild(construirTarjetaOptativaDisponible(fila.materia, fila.plan));
      });
    }

    filasAgregadas.forEach((fila) => {
      cuerpoBloque.appendChild(construirTarjetaMateria(fila, esEscritorio, mostrarOrigen));
    });

    bloqueCard.appendChild(cuerpoBloque);
  }

  return bloqueCard;
}

/**
 * C.4 (v9): tarjeta simplificada de solo-lectura para una electiva
 * detectada pero todavía NO agregada al plan — nombre, código, créditos,
 * horas y requisitos/correquisitos (informativos), más el botón "+ Agregar
 * al plan de estudios". Mientras esté aquí no cuenta en ningún total (ver
 * obtenerOptativasDisponibles/obtenerMateriasVisibles).
 */
function construirTarjetaOptativaDisponible(materiaTemplate, plan) {
  const card = document.createElement("div");
  card.className = "glass-panel materia-card";

  const linea1 = document.createElement("div");
  linea1.className = "materia-linea1";
  linea1.style.cursor = "default";

  const prefijo = document.createElement("span");
  prefijo.className = "materia-prefijo";
  const spanCodigo = document.createElement("span");
  spanCodigo.className = "materia-codigo";
  spanCodigo.style.cursor = "default";
  spanCodigo.textContent = materiaTemplate.codigo;
  prefijo.appendChild(spanCodigo);
  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  spanNombre.className = "materia-nombre completa";
  spanNombre.textContent = aplicarFormatoTexto(materiaTemplate.nombre);
  linea1.appendChild(spanNombre);
  card.appendChild(linea1);

  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";
  const spanHoras = document.createElement("span");
  spanHoras.className = "materia-linea2-horas";
  spanHoras.textContent = formatearHoras(materiaTemplate);
  linea2.appendChild(spanHoras);
  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materiaTemplate.creditos}`;
  linea2.appendChild(badgeCreditos);
  card.appendChild(linea2);

  const cuerpo = document.createElement("div");
  cuerpo.className = "materia-cuerpo stack";
  cuerpo.appendChild(construirBloqueCompletoRequisitos(materiaTemplate, plan));

  const btnAgregar = document.createElement("button");
  btnAgregar.type = "button";
  btnAgregar.className = "btn btn-secondary btn-block";
  btnAgregar.textContent = "+ Agregar al plan de estudios";
  btnAgregar.addEventListener("click", () => agregarOptativaAlPlan(materiaTemplate, plan));
  cuerpo.appendChild(btnAgregar);

  card.appendChild(cuerpo);
  return card;
}

/**
 * C.4 (v9): mueve una electiva de la lista "disponible" (staging, fuera de
 * plan.materias) a la malla formal — desde este momento SÍ cuenta en los
 * totales globales y se comporta como cualquier otra materia (con estado
 * editable, etc.), pero sigue viviendo dentro del bloque especial
 * "Optativas" (nunca se le asigna un Bloque numérico).
 */
function agregarOptativaAlPlan(materiaTemplate, plan) {
  plan.optativas_disponibles = (plan.optativas_disponibles || []).filter((m) => m.codigo !== materiaTemplate.codigo);
  materiaTemplate.es_optativa = true;
  plan.materias.push(materiaTemplate);
  marcarCambioPendiente();
  renderizarPlanEstudios();
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

  // ---- Línea 1: luz · código · nombre (prefijo de ancho fijo, flotante,
  // para la indentación colgante real — ver .materia-prefijo / .materia-nombre.completa) ----
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
  spanCodigo.title = "Clic: ver detalle · Mantén presionado (o clic derecho): cambiar categoría";
  // v8 punto 2 / B (v9): clic en el Código abre la ventana de detalle
  // unificada de esta materia — igual que al hacer clic en un requisito.
  spanCodigo.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalRequisito(materia.codigo);
  });
  agregarLongPress(spanCodigo, () => abrirMenuRapidoCategoria(materia, plan, spanCodigo));
  prefijo.appendChild(spanCodigo);

  linea1.appendChild(prefijo);

  const spanNombre = document.createElement("span");
  // Colapsada: trunca con "…". Expandida: nombre completo con indentación
  // colgante REAL (Bug 4 v8) — .materia-prefijo flota a la izquierda dentro
  // del mismo flujo de texto que este span, así que el navegador ya
  // resuelve el ajuste de línea 1 alrededor del float de forma nativa, y
  // padding-left/text-indent (en CSS) alinean las líneas siguientes.
  spanNombre.className = "materia-nombre " + (expandida ? "completa" : "truncada");
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  linea1.appendChild(spanNombre);

  const iconoExpandir = document.createElement("span");
  iconoExpandir.className = "materia-expandir";
  iconoExpandir.textContent = expandida ? "▲" : "▼";
  linea1.appendChild(iconoExpandir);

  filaPrincipal.appendChild(linea1);

  // ---- Línea 2 (v8 punto 2): Estado (izq) · Horas (centro) · Créditos (der).
  // Colapsada usa iniciales compactas de horas; expandida, palabra completa.
  const linea2 = construirLinea2Materia(materia, !expandida);
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

    // v8 punto 2 / B (v9): mismo detalle unificado que usa el modal —
    // Bloque·Código, Categoría (si tiene), Requisitos, Correquisitos y la
    // fila final de botones ("Es requisito"/"Historial"; sin "Cerrar" aquí,
    // eso es exclusivo del modal). Las horas ya no van sueltas en el cuerpo:
    // viven en la Línea 2 del encabezado, arriba.
    cuerpo.appendChild(construirCuerpoDetalleMateria(materia, plan, { esModal: false }));

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
    // Bug 3 (v8): respaldo de scroll horizontal + flechitas si los 4 pills
    // de Estado no caben en una fila (pantallas muy angostas) — nunca se
    // acomodan en 2 líneas ni en grid 2x2.
    envolverConFlechasScroll(grupoEstado);

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

/**
 * B (v9)/v8 punto 2: Línea 2 del encabezado, compartida entre la tarjeta
 * (colapsada y expandida) y el modal — Estado a la izquierda, Horas al
 * centro, Créditos a la derecha. `compacto=true` usa las iniciales de cada
 * tipo de hora (tarjeta colapsada); `compacto=false` usa la palabra
 * completa (tarjeta expandida y modal, que siempre se consideran "el
 * detalle completo").
 */
function construirLinea2Materia(materia, compacto) {
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];

  const linea2 = document.createElement("div");
  linea2.className = "materia-linea2";

  const badgeEstado = document.createElement("span");
  badgeEstado.className = `badge ${infoEstado.badge}`;
  badgeEstado.textContent = infoEstado.texto;
  linea2.appendChild(badgeEstado);

  const spanHoras = document.createElement("span");
  spanHoras.className = "materia-linea2-horas";
  spanHoras.textContent = compacto ? formatearHorasCompactoIniciales(materia) : formatearHoras(materia);
  linea2.appendChild(spanHoras);

  const badgeCreditos = document.createElement("span");
  badgeCreditos.className = "badge badge-accent";
  badgeCreditos.textContent = `Créditos: ${materia.creditos}`;
  linea2.appendChild(badgeCreditos);

  return linea2;
}

/** B (v9)/v8 punto 2: línea pequeña "Bloque X · Código", texto plano (no
 *  badge), al 75% del tamaño del nombre — va justo debajo del encabezado,
 *  antes de "Requisitos:". C.4 (v9): una materia electiva/optativa no
 *  pertenece a un Bloque numérico fijo, así que aquí se muestra "Optativa"
 *  en su lugar. */
function construirMetaLineaMateria(materia, plan) {
  const p = document.createElement("p");
  p.className = "materia-meta-linea";
  const etiquetaBloque = materia.es_optativa ? "Optativa" : `${plan.parametros_universidad.nombre_bloque} ${materia.bloque}`;
  p.textContent = `${etiquetaBloque} · ${materia.codigo}`;
  return p;
}

/** v10 (reemplaza construirLineaCategoriaMateria): badge de Categoría
 *  reutilizable — a diferencia de la versión anterior, ahora SIEMPRE se
 *  muestra (con "Sin categoría" en gris si no tiene ninguna asignada), ya
 *  que es el primer elemento fijo de la columna derecha del detalle de la
 *  tarjeta y de la línea 1 del modal, y esos layouts necesitan que siempre
 *  esté presente. */
function construirBadgeCategoria(materia, plan) {
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);

  const badge = document.createElement("span");
  badge.className = "badge";
  if (categoria) {
    badge.style.cssText = estiloBadgeCategoria(categoria.color) + " cursor:pointer;";
    badge.textContent = categoria.nombre;
  } else {
    badge.classList.add("badge-neutral");
    badge.style.cursor = "pointer";
    badge.textContent = "Sin categoría";
  }
  badge.title = "Mantén presionado (o clic derecho) para cambiar la categoría";
  agregarLongPress(badge, () => abrirMenuRapidoCategoria(materia, plan, badge));

  return badge;
}

/** v10: botón real (no un link de texto) para "Es requisito"/"Historial" en
 *  la columna derecha del detalle de la tarjeta expandida — mismo
 *  ancho/alto que el badge de Categoría (ver .detalle-col-derecha en
 *  design-system.css). */
function construirBotonPillLateral(texto, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn-lateral";
  btn.textContent = texto;
  btn.addEventListener("click", onClick);
  return btn;
}

/**
 * v10 (reemplaza la versión v8/v9): fila final EXCLUSIVA del modal —
 * "Es requisito" / "Historial" / "Cerrar", los 3 como botones REALES del
 * mismo estilo (antes solo "Cerrar" era un botón real y los otros 2 eran
 * enlaces de texto plano). En la tarjeta expandida esos mismos 2 botones ya
 * no viven aquí: se movieron a la columna derecha del detalle, junto al
 * badge de Categoría (ver construirCuerpoDetalleMateria/
 * construirBotonPillLateral) — ahí "cerrar" no aplica porque colapsar es
 * simplemente volver a hacer clic en la fila.
 */
function construirBotonesFinalesDetalle(materia, plan) {
  const fila = document.createElement("div");
  fila.className = "row detalle-botones-finales";

  const btnEsRequisito = document.createElement("button");
  btnEsRequisito.type = "button";
  btnEsRequisito.className = "btn btn-primary";
  btnEsRequisito.textContent = "Es requisito";
  btnEsRequisito.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalDesbloquea(materia, plan);
  });
  fila.appendChild(btnEsRequisito);

  const btnHistorial = document.createElement("button");
  btnHistorial.type = "button";
  btnHistorial.className = "btn btn-primary";
  btnHistorial.textContent = "Historial";
  btnHistorial.addEventListener("click", (ev) => {
    ev.stopPropagation();
    abrirModalHistorial(materia);
  });
  fila.appendChild(btnHistorial);

  const btnCerrar = document.createElement("button");
  btnCerrar.type = "button";
  btnCerrar.className = "btn btn-primary";
  btnCerrar.textContent = "Cerrar";
  btnCerrar.addEventListener("click", (ev) => {
    ev.stopPropagation();
    document.getElementById("modal-requisito").classList.add("oculto");
  });
  fila.appendChild(btnCerrar);

  return fila;
}

/**
 * Fila de 2 columnas para un código de requisito/correquisito (v8 punto 2 —
 * reemplaza el diseño de 3 columnas de v7):
 * 1) Código - Nombre: el texto mismo ES el link, abre el detalle de esa
 *    materia (ya NO hay un link "Ir a materia" aparte).
 * 2) Créditos, alineados estrictamente a la derecha de la fila.
 */
function construirFilaRequisito(codigo, opciones) {
  // v10: `mostrarCreditos` es true por defecto (modal, y cualquier otro uso
  // existente que no pase opciones) — la tarjeta expandida del plan la pasa
  // en false explícitamente, para no repetir los créditos de la MATERIA
  // requisito/correquisito en esa columna (ver construirCuerpoDetalleMateria).
  const mostrarCreditos = !opciones || opciones.mostrarCreditos !== false;

  const fila = document.createElement("div");
  fila.className = "requisito-fila" + (mostrarCreditos ? "" : " sin-creditos");

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

  if (mostrarCreditos) {
    const colCreditos = document.createElement("span");
    colCreditos.className = "requisito-col-creditos";
    colCreditos.textContent = encontrada ? String(encontrada.materia.creditos) : "—";
    fila.appendChild(colCreditos);
  }

  return fila;
}

function construirBloqueRequisitos(etiqueta, grupos, opcionesFila) {
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
      cont.appendChild(construirFilaRequisito(codigo, opcionesFila));
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

function construirBloqueCompletoRequisitos(materia, plan, opcionesFila) {
  const cont = document.createElement("div");
  cont.className = "stack";
  cont.appendChild(construirBloqueRequisitos("Requisitos", materia.requisitos, opcionesFila));
  cont.appendChild(construirBloqueRequisitos("Correquisitos", materia.correquisitos, opcionesFila));
  return cont;
}

/**
 * v10 (reemplaza la versión v8/v9 que compartía un único diseño lineal
 * entre tarjeta y modal): ahora cada contexto tiene su propio layout.
 *
 * - Modal (`opciones.esModal`): Bloque·Código y Categoría ya NO se arman
 *   aquí — se muestran arriba, en su propia línea 1, antes del título (ver
 *   abrirModalRequisito). Aquí solo van Requisitos/Correquisitos (con
 *   créditos, como siempre) y la fila final de 3 botones reales.
 * - Tarjeta expandida (`esModal: false`): ya NO se muestra Bloque·Código
 *   (es redundante, el Código ya está visible en el encabezado). El cuerpo
 *   es un grid de 2 columnas totalmente independientes: izquierda =
 *   Requisitos/Correquisitos (sin créditos); derecha = badge de Categoría +
 *   botones "Es requisito"/"Historial", ancladas arriba a la derecha.
 */
function construirCuerpoDetalleMateria(materia, plan, opciones) {
  const esModal = !!(opciones && opciones.esModal);
  const cont = document.createElement("div");
  cont.className = "stack";

  if (esModal) {
    cont.appendChild(construirBloqueCompletoRequisitos(materia, plan, { mostrarCreditos: true }));
    cont.appendChild(construirBotonesFinalesDetalle(materia, plan));
  } else {
    const grid = document.createElement("div");
    grid.className = "detalle-grid";

    const colIzq = document.createElement("div");
    colIzq.className = "detalle-col-izquierda";
    colIzq.appendChild(construirBloqueCompletoRequisitos(materia, plan, { mostrarCreditos: false }));

    const colDer = document.createElement("div");
    colDer.className = "detalle-col-derecha";
    colDer.appendChild(construirBadgeCategoria(materia, plan));
    colDer.appendChild(construirBotonPillLateral("Es requisito", (ev) => {
      ev.stopPropagation();
      abrirModalDesbloquea(materia, plan);
    }));
    colDer.appendChild(construirBotonPillLateral("Historial", (ev) => {
      ev.stopPropagation();
      abrirModalHistorial(materia);
    }));

    grid.appendChild(colIzq);
    grid.appendChild(colDer);
    cont.appendChild(grid);
  }

  return cont;
}

/* ===================== Modal de requisito (navegable) ===================== */

function abrirModalRequisito(codigo) {
  const modalCard = document.querySelector("#modal-requisito .modal-card");
  const franjaVieja = modalCard.querySelector(".franja-categoria");
  if (franjaVieja) franjaVieja.remove();

  const contenedorFinal = document.getElementById("requisito-contenedor-final");
  contenedorFinal.innerHTML = "";

  // v10: línea 1 nueva (Bloque·Código + Categoría), antes del título — se
  // limpia siempre y solo se rellena cuando sí se encontró la materia.
  const contenedorMeta = document.getElementById("requisito-linea-meta");
  contenedorMeta.innerHTML = "";

  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);

  if (!encontrada) {
    document.getElementById("requisito-titulo").textContent = "Materia no encontrada";

    const p = document.createElement("p");
    p.className = "materia-req-linea";
    p.textContent = `${codigo} — no está importada en ningún plan visible todavía.`;
    contenedorFinal.appendChild(p);

    const filaCerrar = document.createElement("div");
    filaCerrar.className = "row";
    filaCerrar.style.justifyContent = "flex-end";
    const btnCerrar = document.createElement("button");
    btnCerrar.type = "button";
    btnCerrar.className = "btn btn-primary";
    btnCerrar.textContent = "Cerrar";
    btnCerrar.addEventListener("click", () => document.getElementById("modal-requisito").classList.add("oculto"));
    filaCerrar.appendChild(btnCerrar);
    contenedorFinal.appendChild(filaCerrar);
  } else {
    const { materia, plan } = encontrada;
    const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);
    const disponible = materiaDisponible(materia, plan.materias);

    const franja = document.createElement("div");
    franja.className = "franja-categoria";
    franja.style.background = categoria ? categoria.color : "var(--gradient-accent)";
    modalCard.insertBefore(franja, modalCard.firstChild);

    // ---- Línea 1 (v10): Bloque·Código (izq) + Categoría (der), al mismo
    // nivel vertical entre sí. Va ANTES del título/encabezado. ----
    contenedorMeta.appendChild(construirMetaLineaMateria(materia, plan));
    contenedorMeta.appendChild(construirBadgeCategoria(materia, plan));

    // ---- Línea 2: luz + nombre (encabezado/título), igual que antes ----
    const luzTitulo = document.createElement("span");
    luzTitulo.className = "luz-punto " + (disponible ? "disponible" : "bloqueada");
    luzTitulo.style.marginRight = "8px";
    const tituloEl = document.getElementById("requisito-titulo");
    tituloEl.textContent = "";
    tituloEl.appendChild(luzTitulo);
    tituloEl.appendChild(document.createTextNode(aplicarFormatoTexto(materia.nombre)));

    // Línea 2: el modal siempre muestra el detalle completo (nunca compacto).
    contenedorFinal.appendChild(construirLinea2Materia(materia, false));

    // Bloque·Código, Categoría, Requisitos, Correquisitos y la fila final de
    // botones ("Es requisito"/"Historial"/"Cerrar") — mismo bloque que usa
    // la tarjeta expandida.
    contenedorFinal.appendChild(construirCuerpoDetalleMateria(materia, plan, { esModal: true }));
  }

  document.getElementById("modal-requisito").classList.remove("oculto");
}

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

/* ===================== B.3 (v8/v9) — Vista de Mapa interactivo ===================== */

/** Colores fijos de los 5 estados de Simbología (mismos que usan los badges). */
const COLOR_ESTADO_MAPA = {
  pendiente: "#94a3b8",
  cursando: "#f59e0b",
  aprobado: "#10b981",
  reprobado: "#ef4444",
  retirado: "#a855f7", // reservado: el esquema actual no tiene este 5º estado todavía
};

/** Tarjeta "Vista" — switch Lista/Mapa; en modo Mapa se expande con el mapa completo. */
function construirTarjetaVista(plan) {
  const card = document.createElement("section");
  card.className = "glass-card stack vista-card";

  const encabezado = document.createElement("div");
  encabezado.className = "vista-encabezado";
  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Vista";
  encabezado.appendChild(titulo);

  const switchVista = document.createElement("div");
  switchVista.className = "pill-group";
  [
    { valor: "lista", texto: "Lista" },
    { valor: "mapa", texto: "Mapa" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estado.vistaPlanEstudios === op.valor ? " active" : "");
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      if (estado.vistaPlanEstudios === op.valor) return;
      estado.vistaPlanEstudios = op.valor;
      estado.materiaSeleccionadaMapa = null;
      renderizarPlanEstudios();
    });
    switchVista.appendChild(btn);
  });
  encabezado.appendChild(switchVista);
  card.appendChild(encabezado);

  if (estado.vistaPlanEstudios === "mapa") {
    const controles = document.createElement("div");
    controles.className = "vista-controles";

    const switchColor = document.createElement("div");
    switchColor.className = "pill-group";
    [
      { valor: "simbologia", texto: "Colorear por Simbología" },
      { valor: "categoria", texto: "Colorear por Categoría" },
    ].forEach((op) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (estado.colorMapaPor === op.valor ? " active" : "");
      btn.textContent = op.texto;
      btn.addEventListener("click", () => {
        if (estado.colorMapaPor === op.valor) return;
        estado.colorMapaPor = op.valor;
        switchColor.querySelectorAll(".pill-item").forEach((p) => p.classList.remove("active"));
        btn.classList.add("active");
        recolorearNodosMapa(plan);
      });
      switchColor.appendChild(btn);
    });
    controles.appendChild(switchColor);

    const zoomGrupo = document.createElement("div");
    zoomGrupo.className = "mapa-zoom-controles";
    const btnMenos = document.createElement("button");
    btnMenos.type = "button";
    btnMenos.className = "btn btn-secondary mapa-zoom-btn";
    btnMenos.textContent = "−";
    btnMenos.setAttribute("aria-label", "Alejar mapa");
    const etiquetaZoom = document.createElement("span");
    etiquetaZoom.className = "muted mapa-zoom-etiqueta";
    etiquetaZoom.textContent = Math.round(estado.zoomMapa * 100) + "%";
    const btnMas = document.createElement("button");
    btnMas.type = "button";
    btnMas.className = "btn btn-secondary mapa-zoom-btn";
    btnMas.textContent = "+";
    btnMas.setAttribute("aria-label", "Acercar mapa");
    btnMenos.addEventListener("click", () => ajustarZoomMapa(-0.15, etiquetaZoom));
    btnMas.addEventListener("click", () => ajustarZoomMapa(0.15, etiquetaZoom));
    zoomGrupo.appendChild(btnMenos);
    zoomGrupo.appendChild(etiquetaZoom);
    zoomGrupo.appendChild(btnMas);
    controles.appendChild(zoomGrupo);

    const btnDescargar = document.createElement("button");
    btnDescargar.type = "button";
    btnDescargar.className = "btn btn-secondary";
    btnDescargar.textContent = "⬇ Descargar mapa como PNG";
    btnDescargar.addEventListener("click", () => abrirSelectorDescargaMapa());
    controles.appendChild(btnDescargar);

    card.appendChild(controles);
    card.appendChild(construirMapaInteractivo(plan));
  }

  return card;
}

/** Color del nodo según el switch activo (Simbología por Estado, o Categoría). */
function colorNodoMapa(materia, plan) {
  if (estado.colorMapaPor === "categoria") {
    const cat = (plan.categorias || []).find((c) => c.id === materia.categoria_id);
    return cat ? cat.color : "#64748b";
  }
  return COLOR_ESTADO_MAPA[materia.estado] || "#94a3b8";
}

/** Recolorea los nodos ya renderizados sin reconstruir el mapa (conserva zoom/scroll/camino). */
function recolorearNodosMapa(plan) {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  refs.nodosPorCodigo.forEach((nodo, codigo) => {
    const materia = plan.materias.find((m) => m.codigo === codigo);
    if (materia) nodo.style.setProperty("--nodo-color", colorNodoMapa(materia, plan));
  });
}

/** Construye el contenedor completo del mapa: columnas por bloque + overlay SVG de caminos. */
function construirMapaInteractivo(plan) {
  const materias = plan.materias.slice();
  const grupos = new Map();
  materias.forEach((m) => {
    const clave = m.es_optativa ? "__optativas__" : (m.bloque === null || m.bloque === undefined ? "__sin_bloque__" : String(m.bloque));
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(m);
  });
  const clavesNumericas = Array.from(grupos.keys())
    .filter((k) => k !== "__optativas__" && k !== "__sin_bloque__")
    .sort((a, b) => Number(a) - Number(b));
  const clavesFinal = [...clavesNumericas];
  if (grupos.has("__sin_bloque__")) clavesFinal.push("__sin_bloque__");
  if (grupos.has("__optativas__")) clavesFinal.push("__optativas__");

  const wrapper = document.createElement("div");
  wrapper.className = "mapa-wrapper";

  const scroll = document.createElement("div");
  scroll.className = "mapa-scroll";
  scroll.tabIndex = 0;

  const sizer = document.createElement("div");
  sizer.className = "mapa-sizer";

  const track = document.createElement("div");
  track.className = "mapa-track";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "mapa-caminos");
  track.appendChild(svg);

  const columnasEl = document.createElement("div");
  columnasEl.className = "mapa-columnas";

  const nodosPorCodigo = new Map();

  clavesFinal.forEach((clave) => {
    const columna = document.createElement("div");
    columna.className = "mapa-columna";
    const tituloCol = document.createElement("div");
    tituloCol.className = "mapa-columna-titulo";
    tituloCol.textContent =
      clave === "__optativas__" ? "Optativas" : clave === "__sin_bloque__" ? "Sin bloque" : `${plan.parametros_universidad.nombre_bloque} ${clave}`;
    columna.appendChild(tituloCol);

    grupos.get(clave).forEach((materia) => {
      const nodo = construirNodoMapa(materia, plan);
      nodosPorCodigo.set(materia.codigo, nodo);
      columna.appendChild(nodo);
    });
    columnasEl.appendChild(columna);
  });

  track.appendChild(columnasEl);
  sizer.appendChild(track);
  scroll.appendChild(sizer);

  const btnPrev = document.createElement("button");
  btnPrev.type = "button";
  btnPrev.className = "flecha-plan flecha-scroll";
  btnPrev.textContent = "‹";
  btnPrev.setAttribute("aria-label", "Desplazar mapa a la izquierda");
  const btnNext = document.createElement("button");
  btnNext.type = "button";
  btnNext.className = "flecha-plan flecha-scroll";
  btnNext.textContent = "›";
  btnNext.setAttribute("aria-label", "Desplazar mapa a la derecha");
  btnPrev.addEventListener("click", () => scroll.scrollBy({ left: -scroll.clientWidth * 0.8, behavior: "smooth" }));
  btnNext.addEventListener("click", () => scroll.scrollBy({ left: scroll.clientWidth * 0.8, behavior: "smooth" }));

  wrapper.appendChild(btnPrev);
  wrapper.appendChild(scroll);
  wrapper.appendChild(btnNext);

  // Flechas del teclado (cuando el mapa tiene foco) — scroll exclusivo del mapa.
  scroll.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowRight") { scroll.scrollBy({ left: 140, behavior: "smooth" }); ev.preventDefault(); }
    else if (ev.key === "ArrowLeft") { scroll.scrollBy({ left: -140, behavior: "smooth" }); ev.preventDefault(); }
  });

  // Ctrl + rueda del mouse = zoom (sin Ctrl, la rueda hace scroll normal).
  scroll.addEventListener(
    "wheel",
    (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      ajustarZoomMapa(ev.deltaY < 0 ? 0.1 : -0.1, wrapper.querySelector(".mapa-zoom-etiqueta"));
    },
    { passive: false }
  );

  // Pellizco táctil = zoom.
  let distanciaInicialToque = null;
  let zoomInicialToque = 1;
  const distanciaEntreToques = (toques) => Math.hypot(toques[0].clientX - toques[1].clientX, toques[0].clientY - toques[1].clientY);
  scroll.addEventListener(
    "touchstart",
    (ev) => {
      if (ev.touches.length === 2) {
        distanciaInicialToque = distanciaEntreToques(ev.touches);
        zoomInicialToque = estado.zoomMapa;
      }
    },
    { passive: true }
  );
  scroll.addEventListener(
    "touchmove",
    (ev) => {
      if (ev.touches.length === 2 && distanciaInicialToque) {
        ev.preventDefault();
        const factor = distanciaEntreToques(ev.touches) / distanciaInicialToque;
        estado.zoomMapa = Math.min(2, Math.max(0.5, zoomInicialToque * factor));
        aplicarZoomMapa();
        const etiqueta = wrapper.querySelector(".mapa-zoom-etiqueta");
        if (etiqueta) etiqueta.textContent = Math.round(estado.zoomMapa * 100) + "%";
      }
    },
    { passive: false }
  );
  scroll.addEventListener("touchend", (ev) => { if (ev.touches.length < 2) distanciaInicialToque = null; });

  estado._refsMapaActual = { scroll, sizer, track, svg, columnasEl, nodosPorCodigo, plan };

  requestAnimationFrame(() => {
    aplicarZoomMapa();
    dibujarCaminoDesbloqueo(plan);
  });
  if (window.ResizeObserver) new ResizeObserver(() => aplicarZoomMapa()).observe(columnasEl);

  return wrapper;
}

/** Recalcula el tamaño real del track y aplica el zoom actual (transform: scale). */
function aplicarZoomMapa() {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  const { sizer, track, svg, columnasEl } = refs;
  track.style.transform = "none";
  const anchoNatural = columnasEl.scrollWidth;
  const altoNatural = columnasEl.scrollHeight;
  track.style.width = anchoNatural + "px";
  track.style.height = altoNatural + "px";
  const zoom = estado.zoomMapa || 1;
  track.style.transform = `scale(${zoom})`;
  sizer.style.width = anchoNatural * zoom + "px";
  sizer.style.height = altoNatural * zoom + "px";
  svg.setAttribute("viewBox", `0 0 ${anchoNatural} ${altoNatural}`);
}

/** Botones +/- de zoom (no re-renderiza nada, conserva scroll y camino dibujado). */
function ajustarZoomMapa(delta, etiquetaEl) {
  estado.zoomMapa = Math.min(2, Math.max(0.5, Math.round((estado.zoomMapa + delta) * 100) / 100));
  aplicarZoomMapa();
  if (etiquetaEl) etiquetaEl.textContent = Math.round(estado.zoomMapa * 100) + "%";
}

/** Tarjeta compacta de una materia dentro del mapa: tap = camino; mantener presionada = detalle. */
function construirNodoMapa(materia, plan) {
  const nodo = document.createElement("div");
  nodo.className = "mapa-nodo";
  nodo.style.setProperty("--nodo-color", colorNodoMapa(materia, plan));

  const spanCodigo = document.createElement("span");
  spanCodigo.className = "mapa-nodo-codigo";
  spanCodigo.textContent = materia.codigo;
  const spanNombre = document.createElement("span");
  spanNombre.className = "mapa-nodo-nombre";
  spanNombre.textContent = aplicarFormatoTexto(materia.nombre);
  nodo.appendChild(spanCodigo);
  nodo.appendChild(spanNombre);

  let temporizador = null;
  let fueLongPress = false;
  const iniciar = () => {
    fueLongPress = false;
    temporizador = setTimeout(() => {
      fueLongPress = true;
      abrirModalRequisito(materia.codigo);
    }, 500);
  };
  const cancelar = () => clearTimeout(temporizador);
  nodo.addEventListener("mousedown", iniciar);
  nodo.addEventListener("touchstart", iniciar, { passive: true });
  ["mouseup", "mouseleave", "touchend", "touchcancel", "touchmove"].forEach((ev) => nodo.addEventListener(ev, cancelar));
  nodo.addEventListener("click", () => {
    if (fueLongPress) { fueLongPress = false; return; }
    estado.materiaSeleccionadaMapa = estado.materiaSeleccionadaMapa === materia.codigo ? null : materia.codigo;
    dibujarCaminoDesbloqueo(plan);
  });

  return nodo;
}

/**
 * Dibuja (o borra) el "camino" de desbloqueo detrás de las tarjetas: la
 * cadena completa de materias que la seleccionada desbloquea, transitiva
 * (reutiliza obtenerMateriasQueDesbloquea() nivel por nivel). Coordenadas en
 * el espacio local NO escalado del track (offsetLeft/offsetTop no se ven
 * afectados por el transform: scale, así que el mismo dibujo sirve para
 * cualquier nivel de zoom sin tener que recalcular nada al hacer zoom).
 */
function dibujarCaminoDesbloqueo(plan) {
  const refs = estado._refsMapaActual;
  if (!refs) return;
  const { svg, nodosPorCodigo } = refs;
  svg.innerHTML = "";
  refs.nodosPorCodigo.forEach((nodo) => nodo.classList.remove("mapa-nodo-en-camino"));

  const codigoInicial = estado.materiaSeleccionadaMapa;
  if (!codigoInicial) return;
  const materiaInicial = plan.materias.find((m) => m.codigo === codigoInicial);
  if (!materiaInicial) return;

  const visitados = new Set([codigoInicial]);
  const aristas = [];
  let frontera = [materiaInicial];
  while (frontera.length) {
    const siguiente = [];
    frontera.forEach((m) => {
      obtenerMateriasQueDesbloquea(m, plan).forEach((d) => {
        aristas.push([m.codigo, d.codigo]);
        if (!visitados.has(d.codigo)) {
          visitados.add(d.codigo);
          siguiente.push(d);
        }
      });
    });
    frontera = siguiente;
  }

  const centroDe = (codigo) => {
    const nodo = nodosPorCodigo.get(codigo);
    if (!nodo) return null;
    return { x: nodo.offsetLeft + nodo.offsetWidth / 2, y: nodo.offsetTop + nodo.offsetHeight / 2 };
  };

  aristas.forEach(([desde, hasta]) => {
    const c1 = centroDe(desde);
    const c2 = centroDe(hasta);
    if (!c1 || !c2) return;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const medioX = (c1.x + c2.x) / 2;
    path.setAttribute("d", `M ${c1.x} ${c1.y} C ${medioX} ${c1.y}, ${medioX} ${c2.y}, ${c2.x} ${c2.y}`);
    path.setAttribute("class", "mapa-camino-linea");
    svg.appendChild(path);
  });

  visitados.forEach((codigo) => {
    const nodo = nodosPorCodigo.get(codigo);
    if (nodo) nodo.classList.add("mapa-nodo-en-camino");
  });
}

/** Modal chico (100% construido en JS) para elegir cómo exportar el PNG del mapa. */
function abrirSelectorDescargaMapa() {
  document.querySelectorAll(".modal-descarga-mapa").forEach((el) => el.remove());

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-descarga-mapa";

  const caja = document.createElement("div");
  caja.className = "glass-card modal-card stack";

  const titulo = document.createElement("h3");
  titulo.style.margin = "0";
  titulo.textContent = "Descargar mapa como imagen";
  caja.appendChild(titulo);

  const texto = document.createElement("p");
  texto.className = "muted";
  texto.textContent = "¿Cómo quieres exportar la imagen?";
  caja.appendChild(texto);

  const cerrar = () => overlay.remove();

  [
    { texto: "Con mi tema actual", valor: "actual" },
    { texto: "Modo claro, fondo transparente", valor: "claro_transparente" },
  ].forEach((op) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-block";
    btn.textContent = op.texto;
    btn.addEventListener("click", () => {
      cerrar();
      exportarMapaComoPNG(op.valor);
    });
    caja.appendChild(btn);
  });

  const btnCancelar = document.createElement("button");
  btnCancelar.type = "button";
  btnCancelar.className = "btn btn-secondary btn-block";
  btnCancelar.textContent = "Cancelar";
  btnCancelar.addEventListener("click", cerrar);
  caja.appendChild(btnCancelar);

  overlay.appendChild(caja);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) cerrar(); });
  document.body.appendChild(overlay);
}

/**
 * Exporta el mapa COMPLETO (no solo lo visible por el scroll) a PNG, usando
 * html2canvas (cargado por CDN en index.html). "Con mi tema actual" captura
 * tal cual se ve; "Modo claro, fondo transparente" cambia momentáneamente
 * data-mode a "light" en <html> (de donde salen todas las variables CSS de
 * color) solo mientras dura la captura, y pide fondo transparente a
 * html2canvas — se restaura el modo real apenas termina.
 */
function exportarMapaComoPNG(opcion) {
  const refs = estado._refsMapaActual;
  if (!refs || typeof html2canvas === "undefined") {
    console.error("No se pudo exportar el mapa: html2canvas no está disponible o el mapa no está renderizado.");
    return;
  }
  const { scroll, sizer, track } = refs;

  // Estilos originales a restaurar tras la captura.
  const estiloOriginalScroll = { overflow: scroll.style.overflow, width: scroll.style.width };
  const modoOriginal = document.documentElement.dataset.mode;

  const restaurar = () => {
    scroll.style.overflow = estiloOriginalScroll.overflow;
    scroll.style.width = estiloOriginalScroll.width;
    if (opcion === "claro_transparente") document.documentElement.dataset.mode = modoOriginal;
  };

  // Se muestra el sizer completo (sin recorte por overflow) para capturar
  // el mapa entero, incluso la parte que hoy está fuera del scroll visible.
  scroll.style.overflow = "visible";
  scroll.style.width = sizer.style.width;
  if (opcion === "claro_transparente") document.documentElement.dataset.mode = "light";

  const colorFondoActual = getComputedStyle(document.documentElement).getPropertyValue("--bg-canvas").trim() || "#101114";

  requestAnimationFrame(() => {
    html2canvas(sizer, {
      backgroundColor: opcion === "claro_transparente" ? null : colorFondoActual,
      scale: 2,
      useCORS: true,
    })
      .then((canvas) => {
        restaurar();
        const enlace = document.createElement("a");
        enlace.download = "mapa-plan-de-estudios.png";
        enlace.href = canvas.toDataURL("image/png");
        enlace.click();
      })
      .catch((e) => {
        restaurar();
        console.error("Error al generar la imagen del mapa:", e);
      });
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

  document.getElementById("btn-cerrar-historial").addEventListener("click", () => {
    document.getElementById("modal-historial").classList.add("oculto");
  });
  document.getElementById("modal-historial").addEventListener("click", (e) => {
    if (e.target.id === "modal-historial") e.target.classList.add("oculto");
  });

  // v8 punto 2 / B (v9): "Es requisito", "Historial" y "Cerrar" ahora se
  // arman dinámicamente dentro de #requisito-contenedor-final cada vez que
  // se abre el modal (ver construirBotonesFinalesDetalle/abrirModalRequisito)
  // — agrupados juntos al final del bloque, ya no como botones estáticos.
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
