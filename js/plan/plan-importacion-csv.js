/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (parser CSV + aplicar import)
   Parser de CSV tolerante a errores, aplicar el resultado sobre un plan
   (crear o actualizar), y el mini-panel de reimportación desde Gestionar planes.
   ========================================================================= */

import { crearMateria, crearNodoCodigo, crearNodoO, crearNodoY } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { abrirModalCrearPlan } from "./plan-esquema.js";
import { abrirModalCapturasPDF, abrirModalInstruccionesImportacion, construirInputArchivoCSV, construirPromptImportacion, extraerMetadatosImportacion } from "./plan-importacion.js";
import { renderizarPlanEstudios } from "./plan-vista-lista.js";

/* ===================== Parser de CSV ===================== */

/**
 * FIX (bug de arranque "Cannot access 'estado' before initialization",
 * mismo patrón que plan-categorias.js/plan-modo-edicion.js): este default
 * estaba a nivel de módulo. Se mueve a una función lazy, llamada al
 * principio de construirMiniPanelImportacion (el único punto de entrada
 * real que lee/dibuja este campo) — a diferencia de modoEdicionPlan, acá
 * SÍ importa el valor por defecto real ("agregar", no solo "algo falsy"),
 * porque decide qué pill aparece marcada como activa.
 */
function inicializarEstadoModoActualizarMallaSiHaceFalta() {
  if (estado.modoActualizarMalla === undefined) estado.modoActualizarMalla = "agregar";
}

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
 * v1.12 (Parte C): parser recursivo de Requisitos/Correquisitos — entiende
 * paréntesis anidados de cualquier profundidad y produce directamente un
 * nodo del árbol Y/O de schema.js (o `null`). Reemplaza al viejo
 * `parsearGrupoRequisitos` (plano, sin soporte de anidamiento) de
 * `core/utils.js`.
 *
 * Reglas (las mismas que le pedimos a la IA en el prompt de importación):
 *  - Celda vacía o "Ninguno" (sin importar mayúsculas) -> null.
 *  - ";" en un nivel (fuera de paréntesis) -> nodo "Y" en ese nivel.
 *  - "/" en un nivel (fuera de paréntesis) -> nodo "O" en ese nivel.
 *  - Los paréntesis agrupan un sub-árbol que se resuelve primero, de forma
 *    recursiva, antes de aplicar el operador del nivel exterior.
 *  - Un código suelto sin separadores ni paréntesis -> nodo hoja.
 */

function parsearRequisitoArbol(celdaCruda) {
  const texto = (celdaCruda || "").trim();
  if (!texto || /^ninguno$/i.test(texto)) return null;

  // Separa `str` por `separador` respetando el nivel de anidamiento: nunca
  // corta dentro de un grupo `(...)` todavía sin resolver.
  function partirNivelSuperior(str, separador) {
    const partes = [];
    let actual = "";
    let profundidad = 0;
    for (const c of str) {
      if (c === "(") profundidad++;
      else if (c === ")") profundidad--;
      if (c === separador && profundidad === 0) {
        partes.push(actual);
        actual = "";
      } else {
        actual += c;
      }
    }
    partes.push(actual);
    return partes.map((p) => p.trim()).filter((p) => p.length > 0);
  }

  // ¿El paréntesis que abre en la posición 0 es el mismo que cierra en la
  // última posición? (y no un grupo interno que solo coincide por casualidad
  // con el inicio/fin del string, ej. "(A;B)/(C;D)").
  function envuelveTodo(str) {
    if (!str.startsWith("(") || !str.endsWith(")")) return false;
    let profundidad = 0;
    for (let i = 0; i < str.length; i++) {
      if (str[i] === "(") profundidad++;
      else if (str[i] === ")") {
        profundidad--;
        if (profundidad === 0) return i === str.length - 1;
      }
    }
    return false;
  }

  function resolver(strOriginal) {
    let s = strOriginal.trim();
    while (envuelveTodo(s)) s = s.slice(1, -1).trim();
    if (!s) return null;

    // ";" es el separador de nivel EXTERIOR (agrupa "requisitos distintos,
    // todos necesarios"); "/" es el de nivel INTERIOR (alternativas dentro
    // de un mismo requisito) — así "A;B/C/D" sin paréntesis se interpreta
    // como A Y (B O C O D), igual que en el prompt/documentación del proyecto.
    const partesY = partirNivelSuperior(s, ";");
    if (partesY.length > 1) return crearNodoY(partesY.map(resolver));

    const partesO = partirNivelSuperior(s, "/");
    if (partesO.length > 1) return crearNodoO(partesO.map(resolver));

    return crearNodoCodigo(s);
  }

  return resolver(texto);
}

/**
 * v1.12 (Parte G, adelantada): inversa exacta del parser de arriba — dado un
 * nodo del árbol (o null), genera el string ";"/"/"/paréntesis equivalente,
 * para que el CSV exportado (o el textarea de "Requisitos" del modal de
 * materia manual en plan-esquema.js) se pueda volver a importar sin pérdida.
 * Un hijo se envuelve entre paréntesis solo si es un operador DISTINTO al de
 * su padre (Y dentro de O, u O dentro de Y) — un hijo del mismo tipo no lo
 * necesita, porque ";" y "/" son cada uno asociativos entre sí.
 */

function serializarRequisitoArbol(nodo) {
  if (!nodo) return "Ninguno";

  function serializar(n) {
    if (n.tipo === "codigo") return n.valor;
    const separador = n.tipo === "Y" ? ";" : "/";
    return n.hijos
      .map((hijo) => {
        const texto = serializar(hijo);
        const necesitaParentesis = (hijo.tipo === "Y" || hijo.tipo === "O") && hijo.tipo !== n.tipo;
        return necesitaParentesis ? `(${texto})` : texto;
      })
      .join(separador);
  }

  return serializar(nodo);
}

/**
 * true si una materia (de un import, o ya viviendo en un bloque numerado del
 * plan) es un espacio reservado de electiva/optativa sin llenar todavía —
 * v1.14.1: se basa ÚNICAMENTE en materia.sin_definir (columna SinDefinir del
 * CSV), nunca en adivinar por el código. Antes se detectaba por un prefijo
 * de código (OPT-/ELEC-) que la IA tenía que inventar incluso cuando el
 * documento sí traía un código real para ese espacio — eso manipulaba datos
 * reales de la fuente. Ahora el Código/Nombre nunca se tocan para esto; la
 * reutiliza plan-esquema.js (flujo "Vincular Optativa/Electiva al plan").
 */
function materiaPareceOptativa(materia) {
  return !!(materia && materia.sin_definir);
}

/**
 * v1.14.1: palabra ("electiva" u "optativa") que mejor describe este cupo,
 * derivada SOLO del nombre (nunca del código, que ahora es siempre el dato
 * real intacto) — puramente cosmético para la UI, nunca afecta datos. Si el
 * nombre no da ninguna pista, cae en "optativa" por defecto.
 */
function obtenerPalabraOptativa(materia) {
  const nombre = String((materia && materia.nombre) || "").toLowerCase();
  if (/electiv/.test(nombre)) return "electiva";
  return "optativa";
}

/**
 * v1.12 (Parte C): convierte el string crudo de HORAS_COLUMNAS que devolvió
 * la IA (ej. "T,P,L,EI" o "Ninguna") en el arreglo `tipos_horas` que espera
 * el resto de la app. Raíz común usada tanto al crear un plan nuevo a partir
 * de un import (plan-esquema.js) como al derivar el encabezado esperado del
 * CSV acá mismo.
 */

function derivarTiposHorasDeHorasColumnas(horasColumnasCrudo) {
  const texto = (horasColumnasCrudo || "").trim();
  if (!texto || /^ninguna$/i.test(texto)) return [];
  return texto.split(",").map((t) => t.trim()).filter(Boolean);
}



/**
 * v1.18 (blindaje — reporte Ivanna "importo solo 2 optativas, no las 3"):
 * cuando dos filas del MISMO CSV comparten código (sin ser cupos genéricos
 * sin_definir, que ya están exentos de fusionarse por código), el paso de
 * aplicar al plan las combina en una sola fila con Object.assign — la
 * segunda pisa a la primera sin dejar ningún rastro visible. Esta función
 * detecta esos códigos repetidos DENTRO de un mismo lote (electivas,
 * materias o paraRevisar de UN solo import) para poder avisarlo en
 * `errores` en vez de dejar que desaparezca en silencio. No decide qué
 * hacer con la colisión — solo la hace visible.
 */
function codigosDuplicadosEnLote(lista) {
  const conteo = new Map();
  lista.forEach((m) => {
    if (!m || m.sin_definir || !m.codigo) return; // los cupos genéricos nunca colisionan por código
    conteo.set(m.codigo, (conteo.get(m.codigo) || 0) + 1);
  });
  const duplicados = [];
  conteo.forEach((n, codigo) => { if (n > 1) duplicados.push(codigo); });
  return duplicados;
}

/**
 * Parsea el CSV completo para un plan con estos `tiposHoras` (array de
 * llaves ya fijado en `plan.parametros_universidad.tipos_horas`, derivado a
 * su vez de HORAS_COLUMNAS al crear el plan — ver derivarTiposHorasDeHorasColumnas).
 * Devuelve { materias: [...], electivas: [...], paraRevisar: [...],
 * errores: [...] }. Nunca lanza excepción: una fila mala se reporta y se
 * salta, sin romper el resto del import.
 *
 * v1.12.15: enrutamiento de cada fila, en orden — 1) si la columna Bloque
 * trae un número real, va a `materias` con ese bloque normal (aunque el
 * nombre/código también parezca electiva: eso es un cupo sin_definir dentro
 * de un bloque real, ver materiaPareceOptativa). 2) si NO hay bloque
 * numérico claro pero la columna Bloque dice ELECTIVA/OPTATIVA, va a
 * `electivas` (bloque especial "Optativas"). 3) si no hay bloque numérico
 * claro y tampoco es electiva/optativa (ej. la IA escribió "REVISAR" porque
 * no tuvo certeza), va a `paraRevisar` (bloque especial "Revisar"). Antes,
 * el paso 3 cae bajo `Number(bloque) || bloque`, dejando "REVISAR" como si
 * fuera un bloque numerado más, mezclado con los reales.
 *
 * v1.12: las columnas de horas ya NO tienen un prefijo fijo "Horas_" — el
 * nuevo prompt universal le pide a la IA que use los mismos códigos de
 * HORAS_COLUMNAS tal cual como nombre de columna (ej. "T","P","L"), y ese
 * conteo puede variar según la universidad. Se detectan por POSICIÓN: todo
 * lo que quede entre "Creditos" (columna 4) y las 2 columnas fijas finales
 * (Requisitos, Correquisitos) son las columnas de horas — se sigue usando
 * `tiposHoras.length` como la cantidad esperada (ya fijada al crear el
 * plan), y si el encabezado real trae una cantidad distinta se agrega un
 * aviso no-fatal a `errores` en vez de fallar en silencio.
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

  if (lineas.length === 0) return { materias: [], electivas: [], paraRevisar: [], errores: ["El CSV está vacío."], tieneEstadoCategoria: false };

  const encabezado = parsearLineaCSV(lineas[0]);

  // v1.12: ya no se busca un prefijo "Horas_" (el nuevo prompt le pide a la
  // IA usar los códigos de HORAS_COLUMNAS tal cual, ej. "T","P","L") — las
  // columnas de horas se ubican por POSICIÓN: justo después de Creditos
  // (índice 4), tantas como tiposHoras.length ya fijado para este plan.
  const idxHorasInicio = 4;
  const cantidadHoras = tipos.length;
  // v1.14.1: +1 al final por la nueva columna SinDefinir (ver rule/columna
  // nueva en construirEncabezadoCSV, plan-importacion.js) — reemplaza la
  // detección por prefijo de código que existía antes.
  //
  // v1.17 (fix bug crítico "export propio no se puede reimportar"): el CSV
  // que la IA genera SIEMPRE termina en SinDefinir (8 columnas fijas), pero
  // el CSV que exporta la propia app (plan-vista-lista.js, para respaldo/
  // restauración) le agrega 2 columnas más al final: Estado y CategoriaId
  // (datos que la IA jamás podría conocer). Sin detectar esto, esas 2
  // columnas de más se leían como si fueran parte del Nombre partido por
  // comas sin comillas (mismo mecanismo de "reparación automática" de más
  // abajo, pensado para nombres reales con comas) — corrompía Nombre,
  // Creditos y Horas, y perdía Estado/Categoria por completo. Se detecta
  // mirando los nombres reales de las 2 últimas columnas del encabezado
  // (no solo la cantidad), para no confundirse con un CSV de la IA que por
  // casualidad tuviera 2 columnas de horas de más.
  const ultimasDosEncabezado = encabezado.slice(-2).map((c) => c.trim().toLowerCase());
  const tieneEstadoCategoria =
    encabezado.length >= 2 &&
    ultimasDosEncabezado[0] === "estado" &&
    /^categoria ?id$/.test(ultimasDosEncabezado[1].replace(/_/g, " "));
  const columnasEsperadas = 4 + cantidadHoras + 2 + 1 + (tieneEstadoCategoria ? 2 : 0); // Bloque,Codigo,Nombre,Creditos + horas + Requisitos,Correquisitos + SinDefinir [+ Estado,CategoriaId]

  const errores = [];
  // Aviso no-fatal (Parte C, punto 3): si el encabezado real trae una
  // cantidad de columnas de horas distinta a la esperada, no se falla en
  // silencio — se avisa y se sigue intentando parsear con lo que hay.
  const cantidadHorasEnEncabezado = Math.max(0, encabezado.length - 7 - (tieneEstadoCategoria ? 2 : 0));
  if (cantidadHorasEnEncabezado !== cantidadHoras) {
    errores.push(
      `Aviso: se esperaban ${cantidadHoras} columna(s) de horas (${tipos.join(", ") || "ninguna"}) ` +
      `pero el encabezado del CSV trae ${cantidadHorasEnEncabezado}. Revisa que HORAS_COLUMNAS haya ` +
      `coincidido con las columnas reales — se intentó parsear igual con lo que hay.`
    );
  }

  // La primera fila se asume encabezado y se descarta.
  const filas = lineas.slice(1);
  const materias = [];
  const electivas = [];
  const paraRevisar = [];


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
    // v1.14.1: última columna del formato base — reemplaza la detección por
    // prefijo de código.
    const sinDefinirCruda = columnas[idxHorasInicio + cantidadHoras + 2];
    const sinDefinir = /^\s*true\s*$/i.test(String(sinDefinirCruda || ""));

    // v1.17: solo presentes en el formato extendido de export/backup propio
    // de la app (ver tieneEstadoCategoria más arriba) — nunca en el CSV que
    // genera la IA.
    let estadoValidado;
    let categoriaId;
    if (tieneEstadoCategoria) {
      const estadoCrudo = String(columnas[idxHorasInicio + cantidadHoras + 3] || "").trim().toLowerCase();
      // Solo se acepta un estado de la lista real de la app (ver
      // ESTADOS_MATERIA en plan-vista-lista-tarjetas.js) — cualquier otra
      // cosa (celda vacía, dato corrupto) cae al default "pendiente" de
      // crearMateria en vez de guardar basura.
      estadoValidado = /^(pendiente|cursando|aprobado|reprobado)$/.test(estadoCrudo) ? estadoCrudo : undefined;
      const categoriaIdCrudo = String(columnas[idxHorasInicio + cantidadHoras + 4] || "").trim();
      // No se valida contra plan.categorias acá (este parser no recibe el
      // plan) — si el id no existe más en este plan, la UI ya sabe mostrar
      // "Sin categoría" sin romperse; es un caso normal, no un error.
      categoriaId = categoriaIdCrudo || undefined;
    }

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
    const bloqueTexto = String(bloque).trim();
    const esOptativa = /^(ELECTIVA|OPTATIVA)S?$/i.test(bloqueTexto);
    // v1.12.15: un bloque "claro" es un número real y no vacío — así "" (o
    // cualquier texto no numérico que no sea ELECTIVA/OPTATIVA, típicamente
    // "REVISAR") nunca cae en Number(bloque) || bloque, que antes lo dejaba
    // como si fuera un bloque más (ver JSDoc de esta función).
    const numeroBloque = Number(bloqueTexto);
    const tieneBloqueClaro = !esOptativa && bloqueTexto !== "" && !isNaN(numeroBloque);
    const esParaRevisar = !esOptativa && !tieneBloqueClaro;

    // v1.18 (blindaje "que no se rompa con NADA"): antes, si crearMateria
    // lanzaba una excepción con esta fila (dato inesperado que no se validó
    // arriba), el error se propagaba fuera del forEach y abortaba TODO el
    // parseo — las filas siguientes ni se intentaban, y el import completo
    // fallaba en silencio (nunca se llegaba a mostrarErroresImportacion).
    // Ahora cada fila se procesa de forma aislada: una fila mala se reporta
    // como error puntual y se salta, sin afectar al resto.
    try {
      const materiaCreada = crearMateria({
        codigo,
        nombre,
        creditos: Number(creditos) || 0,
        horas,
        tiposHoras: tipos,
        bloque: tieneBloqueClaro ? numeroBloque : null,
        requisitos: parsearRequisitoArbol(requisitos),
        correquisitos: parsearRequisitoArbol(correquisitos),
        esOptativa,
        sinDefinir,
        estado: estadoValidado,
        categoriaId,
      });

      if (esOptativa) electivas.push(materiaCreada);
      else if (esParaRevisar) paraRevisar.push(materiaCreada);
      else materias.push(materiaCreada);
    } catch (err) {
      errores.push(`Fila ${numeroFila}: no se pudo procesar (${err && err.message ? err.message : "error inesperado"}). Se omitió esta fila para no interrumpir el resto del import.`);
    }
  });

  // v1.12.12: "Bloque N" como requisito/correquisito (texto libre, ver regla
  // 4a del prompt) se expande acá a TODAS las materias reales de ese bloque,
  // combinadas con Y — "aprobar el Bloque 9" funcionalmente significa
  // "aprobar cada materia del Bloque 9". Se hace en la app (no confiando en
  // que la IA enumere bien los códigos a mano en una sola celda, sin comas)
  // porque acá ya tenemos la lista real y exacta de qué materias quedaron en
  // cada bloque de ESTE mismo CSV. Nunca incluye cupos sin_definir (todavía
  // no son una materia real que se pueda "aprobar").
  materias.forEach((m) => {
    m.requisitos = expandirRequisitoBloque(m.requisitos, materias);
    m.correquisitos = expandirRequisitoBloque(m.correquisitos, materias);
  });

  return { materias, electivas, paraRevisar, errores, tieneEstadoCategoria };
}

/**
 * Recorre un nodo del árbol Y/O de requisitos y reemplaza cualquier hoja de
 * texto libre "Bloque N..." (ej. "Bloque 9 completo", "Bloque 9 aprobado")
 * por un nodo Y con el código de cada materia real (sin_definir=false) de
 * ese bloque. Si no encuentra ninguna materia en ese bloque, deja el nodo
 * de texto tal cual (mejor mostrar el texto original que perder el dato).
 */
function expandirRequisitoBloque(nodo, materiasDelPlan) {
  if (!nodo) return nodo;
  if (nodo.tipo === "codigo") {
    const match = /^bloque\s+(\d+)\b/i.exec(String(nodo.valor).trim());
    if (!match) return nodo;
    const bloqueN = Number(match[1]);
    const codigosBloque = materiasDelPlan.filter((m) => !m.sin_definir && Number(m.bloque) === bloqueN).map((m) => m.codigo);
    if (codigosBloque.length === 0) return nodo;
    return crearNodoY(codigosBloque.map(crearNodoCodigo));
  }
  if (nodo.tipo === "Y" || nodo.tipo === "O") {
    return { tipo: nodo.tipo, hijos: nodo.hijos.map((h) => expandirRequisitoBloque(h, materiasDelPlan)) };
  }
  return nodo;
}

/**
 * v1.12.11: si el usuario le da "copiar" al MENSAJE completo de la IA (en
 * vez de al botón puntual de "copiar código"), el texto trae las marcas de
 * bloque de código de Markdown (``` o ```csv al inicio, ``` al final) — sin
 * esto, esa línea de más rompía la detección de metadatos (ya no calzaba
 * con ningún patrón CARRERA:/CODIGO_PLAN:/etc.) y la línea de cierre se
 * leía como si fuera una fila de materia más. Se quita CUALQUIER línea que
 * sea únicamente una marca de bloque de código, en cualquier posición del
 * texto (no solo la primera/última) — esto también cubre el caso de pegar
 * varias partes consecutivas (regla 11 del prompt) si cada una trae sus
 * propias marcas. Una fila real de CSV nunca empieza con "```", así que
 * esto es seguro de aplicar siempre, sin excepción.
 */
function limpiarBloqueDeCodigoCSV(texto) {
  return texto
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((linea) => !/^\s*```/.test(linea))
    .join("\n");
}

function manejarClickImportar(textoCSV) {
  if (!textoCSV || !textoCSV.trim()) {
    mostrarErroresImportacion(["Pega primero el CSV que te devolvió la IA."]);
    return;
  }

  textoCSV = limpiarBloqueDeCodigoCSV(textoCSV);

  const cfg = estado.datos.configuracion;
  const destinoEsSecundario = cfg.modo_hardcore && estado.planImportandoId === "secundario";
  const planDestinoId = destinoEsSecundario ? cfg.plan_activo_secundario_id : cfg.plan_activo_id;
  // v1.10.1 (punto 1): si se llegó aquí desde "+ Nuevo Plan" (Gestionar
  // Planes), se fuerza a tratar esto como "todavía no hay plan destino" —
  // sin esto, planDestinoId resolvería al plan YA activo y este CSV se
  // mezclaría ahí en vez de crear el plan nuevo que el usuario pidió.
  const planDestino = estado.mostrarPanelImportacionNuevoPlan
    ? null
    : estado.datos.planes_estudio.find((p) => p.id === planDestinoId);

  if (!planDestino) {
    // No existe el plan todavía: se lee CARRERA:/CODIGO_PLAN:/UNIVERSIDAD: si
    // la IA los detectó (v6 #3), se guarda el CSV YA LIMPIO de esas líneas
    // (si no, parsearCSVPlanEstudios las confundiría con el encabezado del
    // CSV) y se pide crear el plan primero, prellenado con lo detectado.
    const { metadatos, csv } = extraerMetadatosImportacion(textoCSV);
    estado.csvPendienteDeImportar = csv;
    estado.mostrarPanelImportacionNuevoPlan = false; // ya cumplió su propósito
    abrirModalCrearPlan(destinoEsSecundario, metadatos);
    return;
  }

  importarCSVEnPlan(textoCSV, planDestino);
}

function importarCSVEnPlan(textoCSV, planDestino) {
  // v1.12: se extraen (y descartan) las líneas de metadatos acá también —
  // este entry point recibe el texto CRUDO tal cual lo pegó el usuario
  // (a diferencia del flujo de "plan nuevo", que ya llega limpio vía
  // estado.csvPendienteDeImportar), así que sin este paso HORAS_COLUMNAS:
  // y compañía se colarían como si fueran el encabezado del CSV.
  const { metadatos, csv } = extraerMetadatosImportacion(textoCSV);

  // Si el plan destino todavía está vacío (recién creado, sin materias ni
  // optativas) y esta respuesta trae HORAS_COLUMNAS, se fija tipos_horas
  // ahora mismo — así el plan queda con el esquema de horas correcto desde
  // su primer import real, sin habérselo preguntado antes al usuario. Si el
  // plan YA tiene materias, no se toca (cambiarlo a mitad de camino
  // corrompería las llaves de materia.horas ya guardadas).
  const planVacio = planDestino.materias.length === 0 && (planDestino.optativas_disponibles || []).length === 0;
  if (planVacio && metadatos.horas_columnas) {
    planDestino.parametros_universidad.tipos_horas = derivarTiposHorasDeHorasColumnas(metadatos.horas_columnas);
  }

  const { materias, electivas, paraRevisar, errores, tieneEstadoCategoria } = parsearCSVPlanEstudios(csv, planDestino.parametros_universidad.tipos_horas);

  // v1.18 (blindaje): antes de aplicar nada al plan, se avisa si el propio
  // CSV trae el mismo código repetido en más de una fila — sin esto, el
  // merge por código de abajo las combina en una sola sin dejar ningún
  // rastro de que había más de una.
  [
    { lista: materias, etiqueta: "materias" },
    { lista: electivas, etiqueta: "optativas" },
    { lista: paraRevisar, etiqueta: "materias por revisar" },
  ].forEach(({ lista, etiqueta }) => {
    const duplicados = codigosDuplicadosEnLote(lista);
    if (duplicados.length > 0) {
      errores.push(
        `Advertencia: el CSV trae el mismo código repetido en más de una fila de ${etiqueta} ` +
        `(${duplicados.join(", ")}) — solo se conservó una fila por código. Si en realidad son ` +
        `materias distintas, revisa que cada una tenga un código único en el documento fuente.`
      );
    }
  });

  // Se combina por código: si ya existía, se actualiza; si es nueva, se agrega.
  // v1.16 (fix bug crítico "solo toma la última"): los cupos genéricos
  // (sin_definir=true) NUNCA se fusionan por código — un cupo vacío no es
  // "el mismo" que otro cupo vacío solo porque el documento fuente reutiliza
  // el mismo código real para varios cupos (ej. optativas repetidas entre
  // ciclos), o porque el fallback SD-B{bloque} de materias sin código
  // colisionó entre sí (ver construirPromptImportacion). Fusionarlos por
  // código pisaba cada fila nueva sobre la anterior, dejando solo la última
  // detectada. Los cupos siempre se agregan como fila nueva; solo las
  // materias ya confirmadas (sin_definir=false) siguen actualizándose por
  // código, que es donde sí tiene sentido (reimportar y actualizar sin
  // duplicar).
  //
  // v1.17: si el CSV es del formato extendido de export/backup (trae Estado
  // y CategoriaId reales, ver tieneEstadoCategoria en parsearCSVPlanEstudios),
  // se usa el estado/categoría que trae el CSV — es justo lo que se quiere
  // al restaurar un respaldo. Si es el CSV normal de la IA (nunca trae esos
  // datos), se sigue protegiendo el progreso ya guardado del usuario, igual
  // que siempre.
  materias.forEach((nueva) => {
    if (nueva.sin_definir) {
      planDestino.materias.push(nueva);
      return;
    }
    const existente = planDestino.materias.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
    if (existente) {
      if (tieneEstadoCategoria) {
        Object.assign(existente, nueva);
      } else {
        Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
      }
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
    // v1.16: mismo fix — un cupo genérico (sin_definir=true) nunca se fusiona
    // por código, siempre se agrega como fila nueva.
    if (nueva.sin_definir) {
      planDestino.optativas_disponibles.push(nueva);
      return;
    }
    const existenteDisponible = planDestino.optativas_disponibles.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
    if (existenteDisponible) {
      Object.assign(existenteDisponible, nueva);
    } else {
      planDestino.optativas_disponibles.push(nueva);
    }
  });

  // v1.12.15: mismo patrón para las materias sin bloque claro y sin pinta de
  // electiva/optativa — van a "materias_revisar" (bloque especial
  // "Revisar"), nunca a `materias` directamente.
  if (!Array.isArray(planDestino.materias_revisar)) planDestino.materias_revisar = [];
  paraRevisar.forEach((nueva) => {
    const yaAgregada = planDestino.materias.some((m) => m.codigo === nueva.codigo);
    if (yaAgregada) return;
    // v1.16: mismo fix — un cupo genérico (sin_definir=true) nunca se fusiona
    // por código, siempre se agrega como fila nueva.
    if (nueva.sin_definir) {
      planDestino.materias_revisar.push(nueva);
      return;
    }
    const existenteEnRevisar = planDestino.materias_revisar.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
    if (existenteEnRevisar) {
      Object.assign(existenteEnRevisar, nueva);
    } else {
      planDestino.materias_revisar.push(nueva);
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

/**
 * Componente de importación/actualización, SIEMPRE inline (v5 1.1/1.3):
 * exactamente el mismo componente visual se usa para el primer import de un
 * plan (ver construirPanelImportacion, antes de que el plan exista) y para
 * actualizar la malla de un plan ya existente — nunca en una ventana flotante.
 */

function construirMiniPanelImportacion(plan) {
  inicializarEstadoModoActualizarMallaSiHaceFalta();
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
      // v1.10.1 (punto 4): igual que en el panel de importación inicial —
      // presionar el modo ya activo lo desactiva y vuelve a "sin selección".
      estado.modoImportacion = estado.modoImportacion === op.valor ? null : op.valor;
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

  // v1.10.1 (puntos 2/3/5/6): mismas notas/comportamiento por modo que el
  // panel de importación inicial (construirPanelImportacion).
  if (estado.modoImportacion === "link") {
    const inputLink = document.createElement("input");
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

    // Punto 6 (v1.10.1): mismo aviso de compatibilidad que en el panel de
    // importación inicial. Corregido (2026-08-06): se confirmó que este modo
    // sí funciona — el mensaje anterior era alarmista y ya no era cierto;
    // ahora comunica "confiable pero no infalible" en vez de desalentar su uso.
    const avisoCompatibilidad = document.createElement("p");
    avisoCompatibilidad.className = "muted";
    avisoCompatibilidad.textContent = "ℹ️ Este modo funciona bien en la gran mayoría de los casos. No es 100% infalible (depende de que Claude pueda navegar y leer la página tal cual la ves vos), así que si el resultado sale incompleto, probá con la opción de PDF o la de adjuntar capturas de pantalla o imágenes como alternativa.";
    sec.appendChild(avisoCompatibilidad);
  } else if (estado.modoImportacion === "pdf") {
    const nota = document.createElement("p");
    nota.className = "muted";
    nota.textContent = "Vas a adjuntar tu PDF o imagen (todo el plan completo, en máximo 20 imágenes) directamente en la ventana de Claude que se abra.";
    sec.appendChild(nota);
  } else if (estado.modoImportacion === "capturas") {
    // Puntos 3/5 (v1.10.1): igual que en el panel inicial — solo se ofrece
    // el botón que abre la ventana flotante de conversión; al terminar, esa
    // ventana autoselecciona "Adjuntar PDF" y este panel se vuelve a
    // renderizar ya en ese modo.
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
  // hay que terminar la conversión), no tiene sentido mostrar los botones de
  // enviar a la IA, el textarea del CSV, subir archivo, ni Importar.
  const mostrarBloqueEnvioYCsv = estado.modoImportacion === "link" || estado.modoImportacion === "pdf";

  if (mostrarBloqueEnvioYCsv) {
    // v5 1.3: botón de envío deshabilitado si el modo es "link" y el campo
    // está vacío. Claude es la única IA soportada (ChatGPT se eliminó).
    const btnClaude = document.createElement("button");
    btnClaude.id = "btn-enviar-import-claude";
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
        plan.materias_revisar = [];
      }

      // v1.12: igual que en importarCSVEnPlan — si el plan queda vacío (ya
      // sea porque nunca tuvo materias, o porque "Reemplazar" lo acaba de
      // vaciar) y esta respuesta trae HORAS_COLUMNAS, se actualiza
      // tipos_horas antes de parsear. Si el plan ya tiene materias (modo
      // "Agregar" sobre un plan con contenido), se respeta lo que ya estaba.
      const planVacio = plan.materias.length === 0 && (plan.optativas_disponibles || []).length === 0;
      if (planVacio && metadatos.horas_columnas) {
        plan.parametros_universidad.tipos_horas = derivarTiposHorasDeHorasColumnas(metadatos.horas_columnas);
      }

      const { materias, electivas, paraRevisar, errores, tieneEstadoCategoria } = parsearCSVPlanEstudios(csv, plan.parametros_universidad.tipos_horas);
      // v1.18 (blindaje): mismo aviso que importarCSVEnPlan — ver comentario ahí.
      [
        { lista: materias, etiqueta: "materias" },
        { lista: electivas, etiqueta: "optativas" },
        { lista: paraRevisar, etiqueta: "materias por revisar" },
      ].forEach(({ lista, etiqueta }) => {
        const duplicados = codigosDuplicadosEnLote(lista);
        if (duplicados.length > 0) {
          errores.push(
            `Advertencia: el CSV trae el mismo código repetido en más de una fila de ${etiqueta} ` +
            `(${duplicados.join(", ")}) — solo se conservó una fila por código. Si en realidad son ` +
            `materias distintas, revisa que cada una tenga un código único en el documento fuente.`
          );
        }
      });
      // v1.16: mismo fix que importarCSVEnPlan — los cupos genéricos
      // (sin_definir=true) nunca se fusionan por código, siempre se agregan
      // como fila nueva (ver comentario completo en importarCSVEnPlan).
      // v1.17: mismo fix que importarCSVEnPlan — esta era la segunda copia de
      // esta lógica de fusión (la del mini-panel "Actualizar malla" dentro de
      // un plan ya abierto) y se había quedado sin el fix de tieneEstadoCategoria:
      // pisaba SIEMPRE estado/categoria_id con los que ya tenía la materia,
      // incluso cuando el CSV era el formato extendido de export/backup propio
      // (que sí trae estado/categoría reales y se está restaurando a propósito).
      materias.forEach((nueva) => {
        if (nueva.sin_definir) {
          plan.materias.push(nueva);
          return;
        }
        const existente = plan.materias.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
        if (existente) {
          if (tieneEstadoCategoria) {
            Object.assign(existente, nueva);
          } else {
            Object.assign(existente, nueva, { categoria_id: existente.categoria_id, estado: existente.estado });
          }
        } else {
          plan.materias.push(nueva);
        }
      });

      // C.4 (v9): igual que en importarCSVEnPlan — una electiva nueva se
      // agrega a "disponibles"; si ya estaba agregada formalmente o ya estaba
      // en disponibles, se actualiza en su lugar en vez de duplicarse.
      if (!Array.isArray(plan.optativas_disponibles)) plan.optativas_disponibles = [];
      electivas.forEach((nueva) => {
        const yaAgregada = plan.materias.some((m) => m.codigo === nueva.codigo);
        if (yaAgregada) return;
        // v1.16: cupo genérico -> siempre fila nueva, nunca fusionar por código.
        if (nueva.sin_definir) { plan.optativas_disponibles.push(nueva); return; }
        const existenteDisponible = plan.optativas_disponibles.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
        if (existenteDisponible) Object.assign(existenteDisponible, nueva);
        else plan.optativas_disponibles.push(nueva);
      });

      // v1.12.15: mismo patrón para "materias_revisar" (bloque especial "Revisar").
      if (!Array.isArray(plan.materias_revisar)) plan.materias_revisar = [];
      paraRevisar.forEach((nueva) => {
        const yaAgregada = plan.materias.some((m) => m.codigo === nueva.codigo);
        if (yaAgregada) return;
        // v1.16: cupo genérico -> siempre fila nueva, nunca fusionar por código.
        if (nueva.sin_definir) { plan.materias_revisar.push(nueva); return; }
        const existenteEnRevisar = plan.materias_revisar.find((m) => !m.sin_definir && m.codigo === nueva.codigo);
        if (existenteEnRevisar) Object.assign(existenteEnRevisar, nueva);
        else plan.materias_revisar.push(nueva);
      });

      marcarCambioPendiente();
      resultado.innerHTML = errores.length
        ? `<p class="muted" style="color:var(--color-danger);">Algunas filas no se pudieron importar:</p>` +
          errores.map((e) => `<p class="muted" style="color:var(--color-danger);">• ${e}</p>`).join("")
        : `<p class="muted" style="color:#34d399;">¡Listo! ${materias.length + electivas.length + paraRevisar.length} materias procesadas.</p>`;
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
  }

  setTimeout(actualizarEstadoBotonesEnvioImportacion, 0);
  return sec;
}

/** Deshabilita "Enviar a Claude" si el modo es "link" y el campo está vacío
 *  (v5 1.3). Se llama tras cada render del panel de importación. */

function actualizarEstadoBotonesEnvioImportacion() {
  const btnClaude = document.getElementById("btn-enviar-import-claude");
  if (!btnClaude) return;
  const bloqueado = estado.modoImportacion === "link" && !estado.linkImportacion.trim();
  btnClaude.disabled = bloqueado;
  btnClaude.style.opacity = bloqueado ? "0.5" : "";
}

export {
  actualizarEstadoBotonesEnvioImportacion,
  construirMiniPanelImportacion,
  derivarTiposHorasDeHorasColumnas,
  importarCSVEnPlan,
  manejarClickImportar,
  materiaPareceOptativa,
  mostrarErroresImportacion,
  obtenerPalabraOptativa,
  parsearCSVPlanEstudios,
  parsearLineaCSV,
  parsearRequisitoArbol,
  serializarRequisitoArbol,
};
