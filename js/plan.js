/* =========================================================================
   PLAN.JS — Iteración 1: Plan de Estudios e Ingesta
   Encargado de: importar el CSV generado por Claude (o pegado a mano),
   crear el Plan de Estudios si no existe, la vista completa por bloques
   (móvil compacta / escritorio expandida), el modal de requisito, el flujo
   completo de categorías 100% manuales, el marcado manual de estado y la
   exportación a CSV.
   Depende de: js/schema.js (estructuras) y js/app.js (estado global,
   marcarCambioPendiente, mostrarSeccion, etc. — se cargan antes que este).
   ========================================================================= */

/** Texto EXACTO que se copia al portapapeles con el botón "Enviar a Claude". */
const PROMPT_IMPORTACION_PLAN = `Actúa como un estructurador de datos académicos. Te voy a adjuntar el plan de estudios de mi carrera (puede venir como PDF o como varias capturas de pantalla consecutivas — en ese caso, léelas todas como una sola malla curricular continua, sin perder ninguna materia). Extrae la información y devuélveme ÚNICAMENTE un bloque de código plano en formato CSV, sin texto adicional antes o después, con esta estructura exacta:

Bloque,Codigo,Nombre,Creditos,Horas_Teoria,Horas_Practica,Horas_Laboratorio,Horas_TeoriaPractica,Requisitos,Correquisitos

Reglas:
- Bloque: número de nivel/semestre/cuatrimestre tal como aparece en el plan (ej. 1, 2, 3...).
- Las columnas de Horas: usa 0 si esa universidad no maneja esa categoría de horas.
- Requisitos y Correquisitos: códigos separados por guion si son varios (ej. MA-1001-QU-0100), o "Ninguno" si no aplica.
- No agregues columna de categoría ni de ningún otro dato — solo las columnas indicadas arriba.`;

const COLUMNAS_CSV_IMPORTACION = 10; // Bloque..Correquisitos

/* Estado propio de esta sección, colgado del `estado` global de app.js. */
estado.ordenPlanEstudios = "bloque"; // "bloque" | "categoria"
estado.planImportandoId = null;       // "principal" | "secundario", elegido antes de importar
estado.csvPendienteDeImportar = null; // texto CSV en espera mientras se crea el plan
estado.categoriaEditandoId = null;
estado.planCategoriaEditandoId = null; // a qué plan pertenece la categoría que se edita

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

/* ===================== Render principal de la sección ===================== */

function renderizarPlanEstudios() {
  const cont = document.getElementById("seccion-plan-estudios");
  if (!cont) return;

  const principal = obtenerPlanActivo();
  cont.innerHTML = "";
  cont.appendChild(construirPanelImportacion());

  if (!principal) {
    const aviso = document.createElement("section");
    aviso.className = "glass-card stack";
    aviso.innerHTML = `<p class="muted">Todavía no tienes ningún Plan de Estudios importado. Usa el panel de arriba para traer tu malla curricular.</p>`;
    cont.appendChild(aviso);
    return;
  }

  cont.appendChild(construirEncabezadoPlan(principal));
  cont.appendChild(construirBarraAcciones());
  cont.appendChild(construirPanelCategorias());
  cont.appendChild(construirContenidoBloques());
}

/* ===================== B.1 — Panel de importación ===================== */

function construirPanelImportacion() {
  const cfg = estado.datos.configuracion;
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const titulo = document.createElement("h2");
  titulo.style.margin = "0";
  titulo.textContent = obtenerPlanActivo() ? "Importar / actualizar malla" : "Importar tu Plan de Estudios";
  sec.appendChild(titulo);

  if (cfg.modo_hardcore) {
    const etiqueta = document.createElement("span");
    etiqueta.className = "form-label";
    etiqueta.textContent = "Esta malla corresponde al plan:";
    const grupo = document.createElement("div");
    grupo.className = "pill-group";
    const opciones = [
      { valor: "principal", texto: "Principal" },
      { valor: "secundario", texto: "Secundario 💀" },
    ];
    opciones.forEach((op) => {
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

  const btnClaude = document.createElement("button");
  btnClaude.className = "btn btn-primary btn-block";
  btnClaude.textContent = "Enviar a Claude";
  btnClaude.addEventListener("click", enviarPromptAClaude);
  sec.appendChild(btnClaude);

  const instrucciones = document.createElement("p");
  instrucciones.className = "muted";
  instrucciones.textContent =
    "1) Copiamos el prompt y abrimos Claude. 2) Adjunta ahí tu PDF o tus capturas. 3) Copia el CSV que te devuelva y pégalo abajo.";
  sec.appendChild(instrucciones);

  const textarea = document.createElement("textarea");
  textarea.className = "form-textarea";
  textarea.id = "textarea-csv-importar";
  textarea.rows = 8;
  textarea.placeholder = "Pega aquí el CSV que te devolvió Claude…";
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

async function enviarPromptAClaude() {
  try {
    await navigator.clipboard.writeText(PROMPT_IMPORTACION_PLAN);
  } catch (e) {
    console.warn("No se pudo copiar automáticamente, el usuario deberá copiarlo a mano.", e);
  }
  window.open("https://claude.ai", "_blank", "noopener");
}

/* ===================== B.2 — Parser de CSV ===================== */

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

function parsearCodigosSeparados(texto) {
  const limpio = (texto || "").trim();
  if (!limpio || limpio.toLowerCase() === "ninguno") return [];
  return limpio.split("-").map((c) => c.trim()).filter(Boolean);
}

/**
 * Parsea el CSV completo. Devuelve { materias: [...], errores: ["fila 3: ..."] }.
 * Nunca lanza excepción: una fila mala se reporta y se salta, sin romper el resto.
 */
function parsearCSVPlanEstudios(textoCrudo) {
  const lineas = textoCrudo
    .replace(/```[a-zA-Z]*\n?/g, "") // por si el usuario pegó el bloque con los ``` incluidos
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lineas.length === 0) return { materias: [], errores: ["El CSV está vacío."] };

  // La primera fila se asume encabezado y se descarta.
  const filas = lineas.slice(1);
  const materias = [];
  const errores = [];

  filas.forEach((linea, indice) => {
    const numeroFila = indice + 2; // +2 = +1 por el encabezado, +1 por ser 1-indexado
    const columnas = parsearLineaCSV(linea);

    if (columnas.length !== COLUMNAS_CSV_IMPORTACION) {
      errores.push(`Fila ${numeroFila}: se esperaban ${COLUMNAS_CSV_IMPORTACION} columnas y se encontraron ${columnas.length}. Contenido: "${linea}"`);
      return;
    }

    const [bloque, codigo, nombre, creditos, hTeoria, hPractica, hLab, hTeoPrac, requisitos, correquisitos] = columnas;

    if (!codigo || !nombre) {
      errores.push(`Fila ${numeroFila}: falta Código o Nombre.`);
      return;
    }

    materias.push(
      crearMateria({
        codigo,
        nombre,
        creditos: Number(creditos) || 0,
        horas: {
          teoria: Number(hTeoria) || 0,
          practica: Number(hPractica) || 0,
          laboratorio: Number(hLab) || 0,
          teoria_practica: Number(hTeoPrac) || 0,
        },
        bloque: Number(bloque) || bloque,
        requisitos: parsearCodigosSeparados(requisitos),
        correquisitos: parsearCodigosSeparados(correquisitos),
      })
    );
  });

  return { materias, errores };
}

function manejarClickImportar(textoCSV) {
  if (!textoCSV || !textoCSV.trim()) {
    mostrarErroresImportacion(["Pega primero el CSV que te devolvió Claude."]);
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
  const { materias, errores } = parsearCSVPlanEstudios(textoCSV);

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

  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
  pillUni.querySelector('[data-valor="TEC"]').classList.add("active");
  aplicarDefaultsUniversidad("TEC");

  document.getElementById("modal-crear-plan").classList.remove("oculto");
}

function aplicarDefaultsUniversidad(universidad) {
  const defaults = PARAMETROS_UNIVERSIDAD_DEFAULT[universidad] || PARAMETROS_UNIVERSIDAD_DEFAULT.TEC;
  document.getElementById("input-plan-nombre-bloque").value = defaults.nombre_bloque;
  document.getElementById("input-plan-semanas").value = defaults.semanas_por_bloque;
  document.getElementById("input-plan-hora-inicio").value = defaults.horario_inicio_default;
  document.getElementById("input-plan-duracion").value = defaults.horario_duracion_bloque_min;
}

function inicializarModalCrearPlan() {
  const pillUni = document.getElementById("pill-plan-universidad");
  pillUni.querySelectorAll(".pill-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      pillUni.querySelectorAll(".pill-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      if (btn.dataset.valor === "TEC" || btn.dataset.valor === "UCR") {
        aplicarDefaultsUniversidad(btn.dataset.valor);
      }
    });
  });

  document.getElementById("btn-cancelar-crear-plan").addEventListener("click", () => {
    estado.csvPendienteDeImportar = null;
    document.getElementById("modal-crear-plan").classList.add("oculto");
  });

  document.getElementById("btn-confirmar-crear-plan").addEventListener("click", () => {
    const nombreCarrera = document.getElementById("input-plan-nombre-carrera").value.trim();
    if (!nombreCarrera) {
      const err = document.getElementById("error-modal-crear-plan");
      err.textContent = "El nombre de la carrera es obligatorio.";
      err.classList.remove("oculto");
      return;
    }
    const universidad = document.getElementById("pill-plan-universidad").querySelector(".pill-item.active").dataset.valor;
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
  });
}

/* ===================== B.3 — Encabezado y barra de acciones ===================== */

function construirEncabezadoPlan(planPrincipal) {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";
  const h2 = document.createElement("h2");
  h2.style.margin = "0";
  h2.textContent = planPrincipal.nombre_carrera;
  sec.appendChild(h2);
  if (planPrincipal.codigo_plan) {
    const sub = document.createElement("p");
    sub.className = "muted";
    sub.textContent = planPrincipal.codigo_plan;
    sec.appendChild(sub);
  }
  return sec;
}

function construirBarraAcciones() {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const filaOrden = document.createElement("div");
  filaOrden.className = "row-between";

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
  filaOrden.appendChild(grupoOrden);

  const btnExportar = document.createElement("button");
  btnExportar.className = "btn btn-secondary";
  btnExportar.textContent = "Exportar CSV";
  btnExportar.addEventListener("click", exportarPlanACSV);
  filaOrden.appendChild(btnExportar);

  sec.appendChild(filaOrden);
  return sec;
}

function exportarPlanACSV() {
  const principal = obtenerPlanActivo();
  if (!principal) return;

  const encabezado = "Bloque,Codigo,Nombre,Creditos,Horas_Teoria,Horas_Practica,Horas_Laboratorio,Horas_TeoriaPractica,Requisitos,Correquisitos,Estado,CategoriaId";
  const filas = principal.materias.map((m) => {
    const campos = [
      m.bloque,
      m.codigo,
      `"${(m.nombre || "").replace(/"/g, '""')}"`,
      m.creditos,
      m.horas.teoria,
      m.horas.practica,
      m.horas.laboratorio,
      m.horas.teoria_practica,
      m.requisitos.length ? m.requisitos.join("-") : "Ninguno",
      m.correquisitos.length ? m.correquisitos.join("-") : "Ninguno",
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

/* ===================== B.4 — Categorías ===================== */

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
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "badge";
      chip.style.borderColor = cat.color;
      chip.style.color = cat.color;
      chip.style.cursor = "pointer";
      chip.textContent = cat.nombre;
      chip.addEventListener("click", () => abrirModalCategoria(cat, principal));
      cont.appendChild(chip);
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
    plan.categorias = plan.categorias.filter((c) => c.id !== estado.categoriaEditandoId);
    plan.materias.forEach((m) => {
      if (m.categoria_id === estado.categoriaEditandoId) m.categoria_id = null;
    });
    marcarCambioPendiente();
    document.getElementById("modal-categoria").classList.add("oculto");
    renderizarPlanEstudios();
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
      marcarCambioPendiente();
      document.getElementById("modal-categoria").classList.add("oculto");
      abrirModalCategoriaMaterias(plan, categoria);
    } else {
      categoria = crearCategoria({ nombre, color });
      plan.categorias.push(categoria);
      marcarCambioPendiente();
      document.getElementById("modal-categoria").classList.add("oculto");
      abrirModalCategoriaMaterias(plan, categoria);
    }
  });
}

/** Paso 2 del flujo de categorías: elegir qué materias entran en ella. */
function abrirModalCategoriaMaterias(plan, categoria) {
  document.getElementById("nombre-categoria-materias").textContent = categoria.nombre;
  const cont = document.getElementById("lista-categoria-materias");
  cont.innerHTML = "";

  // Solo materias sin categoría, más las que ya pertenecen a ESTA categoría (para poder editarla).
  const materiasRelevantes = plan.materias.filter((m) => m.categoria_id === null || m.categoria_id === categoria.id);

  if (materiasRelevantes.length === 0) {
    cont.innerHTML = `<p class="muted">No quedan materias disponibles para asignar (todas ya tienen categoría).</p>`;
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

  document.getElementById("modal-categoria-materias").dataset.planId = plan.id;
  document.getElementById("modal-categoria-materias").dataset.categoriaId = categoria.id;
  document.getElementById("modal-categoria-materias").classList.remove("oculto");
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

/* ===================== B.3 / B.5 — Contenido por bloques ===================== */

function construirContenidoBloques() {
  const sec = document.createElement("section");
  sec.className = "glass-card stack";

  const filas = obtenerMateriasVisibles();
  const cfg = estado.datos.configuracion;

  if (filas.length === 0) {
    sec.innerHTML = `<p class="muted">Este plan todavía no tiene materias. Impórtalas desde el panel de arriba.</p>`;
    return sec;
  }

  const grupos = new Map(); // clave de agrupación -> filas[]
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
    const encabezado = document.createElement("h3");
    encabezado.textContent = nombreGrupo.get(clave);
    encabezado.style.marginBottom = "-4px";
    sec.appendChild(encabezado);

    grupos.get(clave).forEach((fila) => {
      sec.appendChild(construirFilaMateria(fila, esEscritorio, cfg.modo_hardcore));
    });
  });

  return sec;
}

const ESTADOS_MATERIA = [
  { valor: "pendiente", texto: "Pendiente", badge: "badge-neutral" },
  { valor: "cursando", texto: "Cursando", badge: "badge-warning" },
  { valor: "aprobado", texto: "Aprobada", badge: "badge-success" },
  { valor: "reprobado", texto: "Reprobada", badge: "badge-danger" },
];

function construirFilaMateria(fila, esEscritorio, mostrarOrigen) {
  const { materia, plan } = fila;
  const infoEstado = ESTADOS_MATERIA.find((e) => e.valor === materia.estado) || ESTADOS_MATERIA[0];
  const categoria = plan.categorias.find((c) => c.id === materia.categoria_id);

  const detalle = document.createElement("details");
  detalle.className = "glass-panel";
  detalle.style.padding = "10px 14px";
  detalle.open = esEscritorio;
  if (categoria) {
    detalle.style.setProperty("--color-categoria", categoria.color);
    detalle.style.borderLeft = "3px solid var(--color-categoria)";
  }

  const resumen = document.createElement("summary");
  resumen.style.cursor = esEscritorio ? "default" : "pointer";
  resumen.style.listStyle = esEscritorio ? "none" : "revert";
  resumen.innerHTML = `
    <span class="row" style="flex-wrap:wrap;">
      <strong>${materia.codigo}</strong>
      <span>${materia.nombre}</span>
      <span class="badge badge-accent">${materia.creditos} créditos</span>
      <span class="badge ${infoEstado.badge}">${infoEstado.texto}</span>
      ${mostrarOrigen ? `<span class="badge badge-neutral">${fila.origen === "principal" ? "Plan principal" : "Plan secundario"}</span>` : ""}
    </span>
  `;
  detalle.appendChild(resumen);

  const cuerpo = document.createElement("div");
  cuerpo.className = "stack";
  cuerpo.style.marginTop = "10px";

  cuerpo.appendChild(construirFilaChips("Requisitos", materia.requisitos));
  cuerpo.appendChild(construirFilaChips("Correquisitos", materia.correquisitos));

  const horas = document.createElement("p");
  horas.className = "muted";
  horas.textContent = `Horas — Teoría: ${materia.horas.teoria} · Práctica: ${materia.horas.practica} · Laboratorio: ${materia.horas.laboratorio} · Teoría-Práctica: ${materia.horas.teoria_practica}`;
  cuerpo.appendChild(horas);

  const grupoEstado = document.createElement("div");
  grupoEstado.className = "pill-group";
  ESTADOS_MATERIA.forEach((e) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (materia.estado === e.valor ? " active" : "");
    btn.textContent = e.texto;
    btn.addEventListener("click", () => {
      materia.estado = e.valor; // siempre manual, nunca automático
      marcarCambioPendiente();
      renderizarPlanEstudios();
    });
    grupoEstado.appendChild(btn);
  });
  cuerpo.appendChild(grupoEstado);

  detalle.appendChild(cuerpo);
  return detalle;
}

function construirFilaChips(etiqueta, codigos) {
  const p = document.createElement("p");
  const spanEtiqueta = document.createElement("strong");
  spanEtiqueta.textContent = etiqueta + ": ";
  p.appendChild(spanEtiqueta);

  if (codigos.length === 0) {
    p.appendChild(document.createTextNode("Ninguno"));
    return p;
  }

  codigos.forEach((codigo, i) => {
    const chip = document.createElement("a");
    chip.href = "javascript:void(0)";
    chip.textContent = codigo;
    chip.style.textDecoration = "underline";
    chip.addEventListener("click", () => abrirModalRequisito(codigo));
    p.appendChild(chip);
    if (i < codigos.length - 1) p.appendChild(document.createTextNode(", "));
  });
  return p;
}

/* ===================== Modal de requisito ===================== */

function abrirModalRequisito(codigo) {
  const encontrada = buscarMateriaPorCodigoEnPlanes(codigo);
  if (!encontrada) {
    document.getElementById("requisito-titulo").textContent = "Materia no encontrada";
    document.getElementById("requisito-bloque").textContent = "—";
    document.getElementById("requisito-codigo").textContent = codigo;
    document.getElementById("requisito-nombre").textContent = "No está importada en ningún plan visible todavía.";
    document.getElementById("requisito-creditos").textContent = "—";
  } else {
    const { materia, plan } = encontrada;
    document.getElementById("requisito-titulo").textContent = materia.nombre;
    document.getElementById("requisito-bloque").textContent = `${plan.parametros_universidad.nombre_bloque} ${materia.bloque}`;
    document.getElementById("requisito-codigo").textContent = materia.codigo;
    document.getElementById("requisito-nombre").textContent = materia.nombre;
    document.getElementById("requisito-creditos").textContent = materia.creditos;
  }
  document.getElementById("modal-requisito").classList.remove("oculto");
}

/* ===================== Arranque de este módulo ===================== */

window.addEventListener("DOMContentLoaded", () => {
  inicializarModalCrearPlan();
  inicializarModalCategoria();
  inicializarModalCategoriaMaterias();

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
    }
  });

  // Al cruzar el punto de quiebre de 900px, se ajusta el desplegable de cada
  // materia (móvil = colapsado, escritorio = siempre expandido).
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
