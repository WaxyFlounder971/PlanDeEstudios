/* =========================================================================
   PLAN DE ESTUDIOS — IMPORTACIÓN (parser CSV + aplicar import)
   Parser de CSV tolerante a errores, aplicar el resultado sobre un plan
   (crear o actualizar), y el mini-panel de reimportación desde Gestionar planes.
   ========================================================================= */

import { crearMateria } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { parsearGrupoRequisitos } from "../core/utils.js";
import { abrirConfirmacion } from "../ui/componentes.js";
import { abrirModalCrearPlan } from "./plan-esquema.js";
import { abrirModalInstruccionesImportacion, construirColumnasHoras, construirInputArchivoCSV, construirPromptImportacion, extraerMetadatosImportacion } from "./plan-importacion.js";
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

export {
  actualizarEstadoBotonesEnvioImportacion,
  construirMiniPanelImportacion,
  importarCSVEnPlan,
  manejarClickImportar,
  mostrarErroresImportacion,
  parsearCSVPlanEstudios,
  parsearLineaCSV,
};
