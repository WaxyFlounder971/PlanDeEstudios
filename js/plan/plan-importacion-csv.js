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

estado.modoActualizarMalla = "agregar";   // C.5 (v9): "agregar" | "reemplazar" — al reimportar CSV sobre un plan existente

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
 * Parsea el CSV completo para un plan con estos `tiposHoras` (array de
 * llaves ya fijado en `plan.parametros_universidad.tipos_horas`, derivado a
 * su vez de HORAS_COLUMNAS al crear el plan — ver derivarTiposHorasDeHorasColumnas).
 * Devuelve { materias: [...], electivas: [...], errores: [...] }. Nunca
 * lanza excepción: una fila mala se reporta y se salta, sin romper el resto
 * del import.
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

  if (lineas.length === 0) return { materias: [], electivas: [], errores: ["El CSV está vacío."] };

  const encabezado = parsearLineaCSV(lineas[0]);

  // v1.12: ya no se busca un prefijo "Horas_" (el nuevo prompt le pide a la
  // IA usar los códigos de HORAS_COLUMNAS tal cual, ej. "T","P","L") — las
  // columnas de horas se ubican por POSICIÓN: justo después de Creditos
  // (índice 4), tantas como tiposHoras.length ya fijado para este plan.
  const idxHorasInicio = 4;
  const cantidadHoras = tipos.length;
  const columnasEsperadas = 4 + cantidadHoras + 2; // Bloque,Codigo,Nombre,Creditos + horas + Requisitos,Correquisitos

  const errores = [];
  // Aviso no-fatal (Parte C, punto 3): si el encabezado real trae una
  // cantidad de columnas de horas distinta a la esperada, no se falla en
  // silencio — se avisa y se sigue intentando parsear con lo que hay.
  const cantidadHorasEnEncabezado = Math.max(0, encabezado.length - 6);
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
      requisitos: parsearRequisitoArbol(requisitos),
      correquisitos: parsearRequisitoArbol(correquisitos),
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

  const { materias, electivas, errores } = parsearCSVPlanEstudios(csv, planDestino.parametros_universidad.tipos_horas);

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
    // importación inicial — este modo no siempre funciona bien en todas las
    // universidades/plataformas.
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
      abrirModalInstruccionesImportacion(
        estado.modoImportacion,
        "claude",
        construirPromptImportacion(estado.modoImportacion, estado.linkImportacion)
      );
    });
    const btnChatGPT = document.createElement("button");
    btnChatGPT.id = "btn-enviar-import-chatgpt";
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

      // v1.12: igual que en importarCSVEnPlan — si el plan queda vacío (ya
      // sea porque nunca tuvo materias, o porque "Reemplazar" lo acaba de
      // vaciar) y esta respuesta trae HORAS_COLUMNAS, se actualiza
      // tipos_horas antes de parsear. Si el plan ya tiene materias (modo
      // "Agregar" sobre un plan con contenido), se respeta lo que ya estaba.
      const planVacio = plan.materias.length === 0 && (plan.optativas_disponibles || []).length === 0;
      if (planVacio && metadatos.horas_columnas) {
        plan.parametros_universidad.tipos_horas = derivarTiposHorasDeHorasColumnas(metadatos.horas_columnas);
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
  }

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

export {
  actualizarEstadoBotonesEnvioImportacion,
  construirMiniPanelImportacion,
  derivarTiposHorasDeHorasColumnas,
  importarCSVEnPlan,
  manejarClickImportar,
  mostrarErroresImportacion,
  parsearCSVPlanEstudios,
  parsearLineaCSV,
  parsearRequisitoArbol,
  serializarRequisitoArbol,
};
