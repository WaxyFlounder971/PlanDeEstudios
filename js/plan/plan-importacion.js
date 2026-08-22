/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (prompt + panel)
   Construcción del prompt oficial para la IA (v1.12: universal, detecta
   HORAS_COLUMNAS automáticamente en vez de preguntar la universidad), el
   panel de importación (modo Link-PDF-Capturas), y el modal de instrucciones
   antes de enviar.
   ========================================================================= */

import { abrirModalCopiaManualPortapapeles, copiarAlPortapapelesBlindado, copiarPromptConAviso } from "../core/clipboard.js";
import { PRESETS_TIPOS_HORAS } from "../core/schema.js";
import { mostrarCargando, ocultarCargando } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { abrirModalCrearPlan } from "./plan-esquema.js";
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

/**
 * v1.12: ya NO antepone "Horas_" a cada columna — el prompt de importación
 * universal (ver construirPromptImportacion) le pide a la IA que use el
 * código de HORAS_COLUMNAS tal cual como nombre de columna (ej. "T","P","L"),
 * y el parser (plan-importacion-csv.js) las detecta por POSICIÓN, no por
 * nombre. Se mantiene esta función (en vez de inlinear tipos.join(",")) para
 * que exportarPlanACSV (plan-vista-lista.js, Parte G) siga usando un único
 * punto de verdad para el formato del encabezado de horas.
 */
function construirColumnasHoras(tiposHoras) {
  const tipos = tiposHoras || ["Horas"];
  if (tipos.length === 0) return ""; // v7 #1: "No aplica" -> sin columnas de horas en el CSV
  return tipos.join(",");
}

function construirEncabezadoCSV(tiposHoras) {
  const columnasHoras = construirColumnasHoras(tiposHoras);
  const partes = ["Bloque", "Codigo", "Nombre", "Creditos"];
  if (columnasHoras) partes.push(columnasHoras);
  partes.push("Requisitos", "Correquisitos", "SinDefinir");
  return partes.join(",");
}

/**
 * Prompt oficial y único del proyecto para pedirle a Claude que estructure
 * el plan de estudios en CSV. `modo` cambia solo el
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

=== QUÉ DEVOLVER ===
Todo tu resultado va DENTRO DE UN ÚNICO bloque de código plano (formato CSV) — nada de esto es
opcional ni es un paso aparte: si algo queda fuera de ese bloque de código, se pierde por completo,
porque de tu respuesta solo se copia el bloque de código, nunca el texto que pongas antes o después.
No devuelvas texto explicativo antes o después del bloque (salvo el aviso de "hay más partes" de la
regla 11, si aplica).

Las PRIMERAS líneas de ese mismo bloque de código (nunca antes, nunca en un bloque separado) son los
metadatos, una línea por dato, SOLO si tienes certeza de cada uno (si no estás seguro de alguno,
simplemente omite esa línea puntual — nunca inventes un valor para rellenarla):
CARRERA: ...
CODIGO_PLAN: ...
UNIVERSIDAD: ...
TIPO_TITULO: ... (Diplomado/Bachillerato/Licenciatura/Maestría/Doctorado, si se identifica)
HORAS_COLUMNAS: lista separada por comas de los tipos de hora que usa ESTE documento específico,
  usando la PALABRA COMPLETA de cada tipo (nunca su sigla/abreviatura) tal como la nombra el
  documento — ej: Teoría,Práctica,Laboratorio,Teoría-Práctica  o  Horas  o  Teórico,Práctico
  (si el documento SOLO trae siglas como "T"/"P"/"L" sin decir en ningún lado qué significan,
  escribe la palabra completa más probable para esa sigla en el contexto académico: T→Teoría,
  P→Práctica, L→Laboratorio, TP→Teoría-Práctica, EI→Estudio Independiente, HT→Horas Teóricas,
  HD→Horas de Docencia — nunca dejes la sigla sola). Esto es importante: la app usa esta palabra
  completa tal cual para mostrarla en pantalla cuando hay espacio (ej. "Práctica: 4"), y deriva ella
  sola las iniciales para cuando no hay espacio (ej. "P4") — si acá se manda la sigla, después no hay
  forma de recuperar la palabra completa para mostrarla.
  Si el documento no maneja el concepto de horas en absoluto, escribe: HORAS_COLUMNAS: Ninguna
  (detéctalas leyendo el propio documento — NO asumas que todas las universidades usan T/P/L/TP;
  si no distingue tipos de hora y solo da un total, usa una sola columna "Horas")

Inmediatamente después, EN EL MISMO BLOQUE DE CÓDIGO (sin línea en blanco de más ni separador), el
encabezado y las filas de la malla, con esta estructura EXACTA:

Bloque,Codigo,Nombre,Creditos,[una columna por cada valor listado en HORAS_COLUMNAS],Requisitos,Correquisitos,SinDefinir

(Si HORAS_COLUMNAS es "Ninguna", omite esas columnas del encabezado y de cada fila. El resto de
columnas, incluida SinDefinir al final, van SIEMPRE, sin excepción.)

REGLAS:

1. BLOQUE: tiene TRES valores posibles — un ENTERO SECUENCIAL, la palabra "OPTATIVA" (o "ELECTIVA"),
   o la palabra "REVISAR". Decide entre los tres usando tu propio criterio, así:

   a) ENTERO SECUENCIAL — cuando la materia (o el espacio reservado de electiva/optativa dentro de un
      bloque, ver regla 2) está atada a un nivel/ciclo/año/semestre/cuatrimestre concreto y obligatorio
      del plan: aunque el CONTENIDO sea optativo (el estudiante elige cuál cursar), la UBICACIÓN no lo
      es (hay que cursar algo ahí, en ese punto específico de la carrera). Conviértelo a un entero único
      y creciente según el orden real en que se cursan (ej: si el documento organiza por "Año" y dentro
      por "Ciclo I/II", o por "Verano", cada uno de esos sub-bloques cronológicos es un número distinto:
      1, 2, 3, 4... no reinicies el conteo al cambiar de año). Si el documento usa nombres en vez de
      números, conviértelo al secuencial correspondiente.

   b) "OPTATIVA" (o "ELECTIVA") — cuando la materia es genuinamente opcional y NO está atada a un punto
      fijo obligatorio de la carrera: un curso de un banco/listado general de electivas que el
      estudiante puede tomar (o no) en varios momentos posibles, sin que el documento la exija en un
      ciclo específico. Esto es un juicio de contenido, no de dónde aparece impresa en el documento —
      si el propio documento sugiere un ciclo "recomendado" para cursarla pero deja claro que es
      flexible/opcional (a diferencia de una asignación fija de la malla), sigue siendo "OPTATIVA", no
      un número. Ver regla 8 para más detalle de este caso.

   c) "REVISAR" — ÚNICAMENTE cuando genuinamente no puedes determinar ninguna de las dos anteriores con
      certeza (ni a qué ciclo pertenece, ni si es opcional o no) — nunca lo uses como cajón de sastre
      para "esto es opcional" (para eso está (b)); resérvalo solo para ambigüedad real de ubicación/
      naturaleza de la fila. Confundir (b) y (c) hace que el estudiante no pueda distinguir "esto es una
      opción real para elegir" de "esto necesito revisarlo a mano porque no se entendió bien" — son
      cosas completamente distintas para la app que procesa este CSV, así que la distinción importa.

2. CODIGO: SIEMPRE el código EXACTO tal como aparece en el documento — SIN EXCEPCIÓN, incluso si la
   materia es un espacio reservado para una electiva/optativa sin contenido definido todavía (sin
   importar cómo la llame el documento en su propio idioma: "Optativa", "Electivo 1", "Elective",
   "Wahlfach", "Cours au choix", "Idioma Intensivo", etc.). NUNCA reemplaces, inventes, ni normalices
   un código real que el documento sí trae — aunque sea el código de un espacio todavía sin materia
   elegida — eso sería fabricar datos que no existen en la fuente. Marca estos espacios reservados
   con la columna SinDefinir (regla 4b más abajo); el CÓDIGO real queda intacto siempre.
   Solo si el documento genuinamente NO da ningún código para esa fila (ni siquiera uno administrativo/
   interno), y necesitas escribir algo porque la columna no puede quedar vacía, usa "SD-B" + el número
   de Bloque (ej: SD-B7) — ÚNICAMENTE en este caso de "no hay ningún código que preservar", nunca
   cuando el documento sí trae uno, así sea genérico. IMPORTANTE: si en ESE MISMO Bloque hay más de
   una fila sin código (ej. varias materias de un mismo cuatrimestre que el documento solo nombra, sin
   código alguno), agrégale a cada una un consecutivo distinto empezando en 1, en el mismo orden en que
   aparecen: "SD-B7-1", "SD-B7-2", "SD-B7-3"... — nunca repitas "SD-B7" solo para dos filas de ese
   bloque, porque la app identifica cada materia por su código y dos filas con el mismo código se
   pisarían entre sí, perdiendo todas menos la última.

3. HORAS: usa 0 si el documento no reporta ese tipo de hora para esa materia puntual — nunca dejes
   la celda vacía. Si el documento presenta las horas dentro de una cuadrícula gráfica (cajas de
   colores, diagramas tipo escalera, etc.) en vez de una tabla, extrae el mismo dato de cada caja
   como si fuera una fila de tabla.

4a. REQUISITOS y CORREQUISITOS — sintaxis para relaciones lógicas, SIN usar nunca coma "," dentro
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
   - Si un requisito/correquisito es "haber aprobado/cursado TODO un bloque/nivel/ciclo/año/semestre
     completo" (nunca una condición de créditos u otra cosa, solo esta), escríbelo EXACTAMENTE como
     "Bloque N" seguido opcionalmente de una palabra más (ej. "Bloque 9", "Bloque 9 completo",
     "Bloque 9 aprobado") — usando el mismo número secuencial de Bloque de la regla 1, no el nombre
     original del documento (ej. no "Año 3" ni "Nivel III", el número ya convertido). La app
     reemplaza esto automáticamente por TODAS las materias reales de ese bloque como requisitos — no
     hace falta (ni se debe) que vos enumeres los códigos a mano.
   - Para cualquier OTRA condición que no sea un código de materia ni "Bloque N" (ej. "tener 90
     créditos aprobados", "ser estudiante regular"), escríbela tal cual como texto plano dentro de la
     celda — no inventes un código de materia falso para representarla, y no la fuerces dentro de la
     sintaxis de códigos de arriba; un texto libre como único contenido de la celda es válido.

4b. SINDEFINIR (última columna, SIEMPRE presente): escribe exactamente "true" si esta fila es un
   espacio reservado de electiva/optativa sin materia real elegida todavía (sin importar si tiene
   código real o no — ver regla 2), o "false" para cualquier materia ya confirmada por el documento
   (incluidas las electivas ya definidas de listados aparte, regla 8). Nunca dejes esta celda vacía.

5. NOMBRE (y cualquier otra columna): si el nombre real de la materia trae una coma
   (ej. "Ética, Persona y Sociedad"), envuelve ESA CELDA completa entre comillas dobles.
   Ante la duda, usa comillas de más y no de menos.

6. No agregues columnas de categoría, área, color, ni ninguna otra fuera de las indicadas.
7. No omitas ninguna materia, incluidas optativas, electivas, idiomas, seminarios, prácticas,
   trabajos finales de graduación y cursos de nivelación/precálculo (aunque tengan 0 créditos).
8. Si el documento incluye tablas separadas de "cursos optativos" o "electivas disponibles" fuera
   de la malla principal, inclúyelas también, usando "OPTATIVA" (o "ELECTIVA") como Bloque — ver
   regla 1b: son cursos opcionales de un banco/listado general, no están atadas a un ciclo
   obligatorio de la malla, así que NUNCA les pongas el número de ciclo "recomendado" ni "REVISAR"
   solo porque el documento no menciona uno (eso sería confundir 1b con 1a o con 1c). Estas ya son
   materias reales y definidas (tienen código y nombre propios) — van con SinDefinir=false.
9. Si una celda es ilegible, ambigua, o no puedes confirmarla con certeza, escribe "REVISAR" en
   vez de inventar un dato — nunca inventes códigos, créditos u horas que no estén en el documento.
10. Ignora tablas resumen de totales generales (ej. "Créditos totales de la carrera: 448") — esas
    no son filas de materias, son metadatos de resumen y no van en el CSV.
11. Si el plan es tan grande que no te cabe en una sola respuesta, divídelo en varias respuestas
    consecutivas, pero SOLO la PRIMERA lleva las líneas de metadatos (CARRERA/CODIGO_PLAN/etc.) y el
    encabezado (Bloque,Codigo,Nombre,...); las respuestas siguientes deben traer ÚNICAMENTE filas de
    datos, en el mismo orden del plan, SIN repetir el encabezado ni los metadatos — esta app arma el
    CSV final pegando las partes una tras otra en el mismo cuadro de texto, en orden, así que un
    encabezado repetido en medio se leería como si fuera una materia más (rompe la importación).
    Avisa igual entre una parte y otra que hay más por venir, para que el usuario sepa que faltan.`;
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
    // Siglas — separación nombre_completo/siglas (2026-08-22): línea nueva
    // de metadato, solo la trae un CSV que esta misma app ya exportó con
    // fidelidad completa (ver exportarPlanACSV en plan-vista-lista.js). Un
    // CSV externo/nuevo no la trae y el campo de siglas queda vacío para
    // completar a mano en el modal "Nuevo Plan".
    siglas_universidad: /^SIGLAS_UNIVERSIDAD:\s*(.+)$/i,
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
 * v7 #3: texto final de la ventana "Antes de ir a Claude", con un salto de
 * línea entre cada instrucción. Es el mismo para los 3 modos (Link/PDF/
 * Capturas).
 * v-ajuste (2026-08-06): ahora copiar y enviar son dos acciones separadas
 * dentro de este mismo modal (ver botón "📋 Copiar prompt" más abajo), así
 * que las instrucciones reflejan ese orden explícito en vez de asumir que
 * la copia ya ocurrió sola en segundo plano.
 */

function construirTextoInstruccionesImportacion() {
  return [
    'Primero presiona "📋 Copiar prompt" para copiarlo a tu portapapeles.',
    'Después presiona "Aceptar" — se abrirá Claude en una pestaña nueva.',
    "Ya en el chat, pega el prompt copiado y adjunta el tipo de archivo que habías elegido.",
    "Guarda bien la respuesta que te entregue Claude para traerla de vuelta a esta página.",
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

  // v1.14.1: antes, la ÚNICA forma de crear un plan era importando un CSV
  // (abrirModalCrearPlan solo se llamaba desde manejarClickImportar, tras
  // pegar/procesar un CSV). Ahora también se puede saltar la importación por
  // completo y arrancar con un plan vacío, para armarlo materia por materia
  // con "+ Agregar materia" (abrirModalMateriaManual, ver plan-esquema.js).
  const btnEmpezarEnBlanco = document.createElement("button");
  btnEmpezarEnBlanco.type = "button";
  btnEmpezarEnBlanco.className = "btn btn-secondary btn-block";
  btnEmpezarEnBlanco.textContent = "✏️ Empezar en blanco (agregar materias a mano)";
  btnEmpezarEnBlanco.addEventListener("click", () => {
    abrirModalCrearPlan(estado.planImportandoId === "secundario", null);
  });
  sec.appendChild(btnEmpezarEnBlanco);

  const separador = document.createElement("p");
  separador.className = "muted";
  separador.textContent = "— o, si preferís, traé tu plan ya hecho —";
  sec.appendChild(separador);

  // ---- Modo de importación: Link / PDF / Capturas ----
  const etiquetaModo = document.createElement("span");
  etiquetaModo.className = "form-label";
  etiquetaModo.textContent = "¿Cómo quieres traer tu plan de estudios?";
  sec.appendChild(etiquetaModo);

  const grupoModo = document.createElement("div");
  grupoModo.className = "pill-group";
  [
    { valor: "link", texto: "Pegar link" },
    { valor: "pdf", texto: "Adjuntar PDF/Imagen" },
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
    // la IA pueda navegar y leer bien la página. Se confirmó que sí funciona
    // (2026-08-06: se corrige el tono alarmista anterior, que decía "muy
    // frágil"/"rara vez funciona" — ya no es cierto), pero como depende de
    // la navegación web de la IA, no está 100% garantizado en todos los
    // casos, así que se avisa igual sin desalentar su uso.
    const avisoCompatibilidad = document.createElement("p");
    avisoCompatibilidad.className = "muted";
    avisoCompatibilidad.textContent = "ℹ️ Este modo funciona bien en la gran mayoría de los casos. No es 100% infalible (depende de que Claude pueda navegar y leer la página tal cual la ves vos), así que si el resultado sale incompleto, probá con \"Adjuntar PDF/Imagen\" o \"Tomar capturas\" como alternativa.";
    sec.appendChild(avisoCompatibilidad);
  } else if (estado.modoImportacion === "pdf") {
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Vas a adjuntar tu PDF o imagen (todo el plan completo, en máximo 20 imágenes) directamente en la ventana de Claude que se abra.";
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
    const btnClaude = document.createElement("button");
    btnClaude.className = "btn btn-primary btn-block";
    btnClaude.textContent = "Enviar a Claude";
    btnClaude.addEventListener("click", () => {
      abrirModalInstruccionesImportacion(
        estado.modoImportacion,
        construirPromptImportacion(estado.modoImportacion, estado.linkImportacion)
      );
    });
    sec.appendChild(btnClaude);

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
 * en Claude. Ahora, en el modo "Tomar capturas", primero se arma UN
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
  // v1.12.6: por debajo de esto, el texto de una captura de plan de estudios
  // ya no se lee con confianza (ni por una persona haciendo zoom, ni por la
  // IA al importarlo) — se usa solo para armar la advertencia al usuario,
  // nunca para bloquear la conversión.
  const ANCHO_MINIMO_RECOMENDADO_PX = 1200;
  let doc = null;
  const imagenesBajaResolucion = [];

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
    // v1.12.6: el "1" al final es el fix de calidad — antes, una imagen más
    // chica que el espacio disponible (típico de una captura de pantalla de
    // PC, a diferencia de una foto de celular) se ESTIRABA para llenar la
    // hoja, agrandando los píxeles existentes en vez de agregar detalle
    // (se veía borrosa/pixelada). Ahora nunca se agranda más allá de su
    // tamaño real: si es más chica que la hoja, se centra en su tamaño
    // nativo en vez de estirarse.
    const proporcion = Math.min(anchoDisponible / img.width, altoDisponible / img.height, 1);
    const anchoFinal = img.width * proporcion;
    const altoFinal = img.height * proporcion;
    const x = (anchoPagina - anchoFinal) / 2;
    const y = (altoPagina - altoFinal) / 2;

    if (img.width < ANCHO_MINIMO_RECOMENDADO_PX) {
      imagenesBajaResolucion.push(archivos[i].name);
      console.warn(`[capturas→PDF] "${archivos[i].name}" tiene resolución baja (${img.width}×${img.height}px) — puede costar leerla bien.`);
    }

    doc.addImage(dataUrl, detectarFormatoImagen(dataUrl), x, y, anchoFinal, altoFinal);
    console.log(`[capturas→PDF] Imagen ${i + 1}/${archivos.length} agregada al PDF.`);
  }

  console.log("[capturas→PDF] Todas las imágenes procesadas — descargando PDF…");
  doc.save("plan-de-estudios-capturas.pdf");
  console.log("[capturas→PDF] doc.save() ejecutado.");

  return { imagenesBajaResolucion };
}

/* ===================== v1.10.1 — Ventana flotante: capturas -> PDF ===================== *
 * Reemplaza el input inline que vivía en el panel. Ahora el botón "Convertir
 * imágenes a PDF" del panel abre este modal aparte; al convertir con éxito
 * usa el overlay de carga global (mostrarCargando/ocultarCargando, las
 * mismas bolitas que ya existen para el resto de la app) y, al terminar,
 * autoselecciona el modo "Adjuntar PDF/Imagen" para que el usuario siga el flujo
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
      const { imagenesBajaResolucion } = await convertirCapturasAPDF(archivos);
      // Puntos 3/5: autoselecciona "Adjuntar PDF/Imagen" — el usuario ya tiene el
      // PDF descargado y solo falta que lo adjunte en la IA.
      estado.modoImportacion = "pdf";
      renderizarPlanEstudios();
      if (imagenesBajaResolucion.length > 0) {
        // v1.12.6: en vez de dejar que el usuario descubra hasta el final
        // (cuando la IA no puede leer bien el plan) que una o varias
        // capturas quedaron en baja resolución, se avisa apenas se genera
        // el PDF, mencionando cuáles, para que las vuelva a tomar mejor.
        mostrarToast(`✓ PDF descargado — ojo: ${imagenesBajaResolucion.length === 1 ? `"${imagenesBajaResolucion[0]}" quedó` : `${imagenesBajaResolucion.length} imágenes quedaron`} en baja resolución, puede costar leerlas bien`);
      } else {
        mostrarToast('✓ PDF descargado — se seleccionó "Adjuntar PDF/Imagen", adjúntalo ahí');
      }
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

/** Copia blindada del prompt: si ya se sabe (por
 *  comprobarPermisoPortapapelesAlIniciar, en main.js) que el permiso está
 *  denegado, ni siquiera se intenta la copia automática — se ahorra el
 *  intento fallido y se va directo al modal de copia manual. En cualquier
 *  otro caso ("otorgado" o "desconocido"), copiarPromptConAviso hace el
 *  intento real y decide sola si mostrar el toast de éxito o el modal. */

function copiarPromptImportacionBlindado(texto) {
  if (estado.permisoPortapapeles === "denegado") {
    abrirModalCopiaManualPortapapeles(texto);
    return;
  }
  copiarPromptConAviso(texto);
}

/**
 * Abre Claude en pestaña nueva y, además, intenta copiar el prompt como
 * RESPALDO SILENCIOSO (sin toast ni modal de copia manual): la experiencia
 * de copia con feedback completo ya vive en el botón dedicado "📋 Copiar
 * prompt" del modal de instrucciones (ver más abajo) — este intento extra
 * es solo por si el usuario presionó "Aceptar" sin haber usado ese botón
 * antes, para no dejarlo sin nada en el portapapeles en ese caso. Si este
 * intento silencioso falla, no pasa nada visible: el usuario ya vio (o
 * puede volver a ver) el prompt completo a través del botón dedicado.
 */

function enviarPromptAClaude(texto) {
  abrirVentanaNueva("https://claude.ai/new");
  copiarAlPortapapelesBlindado(texto);
}

/* ===================== Modal de instrucciones antes de enviar (v6) ===================== */

/** Guarda qué prompt copiar/enviar si el usuario usa los botones del modal
 *  de instrucciones — null mientras el modal está cerrado. */

let instruccionesImportacionPendiente = null;

/**
 * v6: en vez de copiar y redirigir de inmediato al presionar "Enviar a
 * Claude", primero se muestra este modal con las instrucciones completas
 * (adaptadas al modo Link/PDF/Capturas).
 * v-ajuste (2026-08-06): copiar y enviar ahora son dos botones separados
 * dentro del modal — "📋 Copiar prompt" copia (con su propio feedback: toast
 * de éxito o modal de copia manual si falla) y se puede presionar las veces
 * que haga falta sin cerrar nada; "Aceptar" recién ahí abre Claude en
 * pestaña nueva. Esto asegura que el usuario copie el prompt de forma
 * explícita y confirmada ANTES de irse a la pestaña de Claude, en vez de
 * que la copia ocurra en silencio justo cuando el foco ya se está yendo a
 * la ventana nueva (que es precisamente el escenario donde antes el
 * usuario podía no enterarse de que la copia había fallado).
 */

function abrirModalInstruccionesImportacion(modo, textoPrompt) {
  instruccionesImportacionPendiente = { textoPrompt };
  document.getElementById("titulo-modal-instrucciones-importacion").textContent = "Antes de ir a Claude…";
  document.getElementById("cuerpo-modal-instrucciones-importacion").textContent =
    construirTextoInstruccionesImportacion();
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
  // Botón dedicado de copia: usa copiarPromptImportacionBlindado (mismo
  // camino que ya respeta estado.permisoPortapapeles y abre el modal de
  // copia manual si hace falta) — no cierra este modal, para que el usuario
  // pueda copiar de nuevo si quiere antes de presionar "Aceptar".
  document.getElementById("btn-copiar-prompt-instrucciones-importacion").addEventListener("click", () => {
    if (!instruccionesImportacionPendiente) return;
    copiarPromptImportacionBlindado(instruccionesImportacionPendiente.textoPrompt);
  });
  document.getElementById("btn-aceptar-instrucciones-importacion").addEventListener("click", () => {
    if (!instruccionesImportacionPendiente) return;
    const { textoPrompt } = instruccionesImportacionPendiente;
    document.getElementById("modal-instrucciones-importacion").classList.add("oculto");
    instruccionesImportacionPendiente = null;
    enviarPromptAClaude(textoPrompt);
  });
}

export {
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
  enviarPromptAClaude,
  extraerMetadatosImportacion,
  inicializarModalCapturasPDF,
  inicializarModalInstruccionesImportacion,
  instruccionesImportacionPendiente,
};
