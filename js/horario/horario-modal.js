/* =========================================================================
   HORARIO — Modal de creación/edición de bloque (2do tap sobre el flotante,
   o tap directo sobre una tarjeta existente / botón "+ Agregar").
   ========================================================================= */

import { crearBloqueHorario, crearModalidadHorario, sellarTimestamp } from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { buscarSemestreVivoPorId, vincularProfesorAMateriaMatriculada } from "../semestres/semestres.js";
import { abrirModalAltaProfesor } from "../comunidad/comunidad.js";

const ETIQUETAS_MODALIDAD = { presencial: "Presencial", semipresencial: "Semipresencial", virtual: "Virtual", personalizado: "Personalizado" };

let contextoActual = null; // { semestreId, bloqueId } de la sesión de edición abierta

function obtenerPlanPorId(planId) {
  return (estado.datos.planes_estudio || []).find((p) => p.id === planId) || null;
}

function obtenerDiasConfig() {
  const cfg = estado.datos.configuracion;
  const nombres = cfg.nombres_dias_personalizados || {};
  return DIAS_SEMANA_CONFIG.map((d) => ({ ...d, etiquetaCorta: nombres[d.id] || d.abrevDefault }));
}

function cerrarModalBloqueHorario() {
  document.getElementById("modal-bloque-horario")?.classList.add("oculto");
  contextoActual = null;
}

/**
 * Select personalizado (mismo patrón que "Escala de notas" en Ajustes):
 * un <select> real oculto como dueño del valor, y un botón + lista propios
 * como parte visible, para que el fondo/letras se vean bien en cualquier
 * tema en vez del popup nativo del navegador. `opciones` es [{valor, etiqueta}].
 */
function construirSelectPersonalizado({ opciones, valorInicial, etiquetaVacia, onCambiar }) {
  const wrap = document.createElement("div");
  wrap.className = "select-custom";

  const oculto = document.createElement("select");
  oculto.hidden = true;
  oculto.setAttribute("aria-hidden", "true");
  oculto.tabIndex = -1;

  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "form-input select-custom-boton";
  const lista = document.createElement("ul");
  lista.className = "select-custom-lista oculto";

  function etiquetaDe(valor) {
    const opt = opciones.find((o) => o.valor === valor);
    return opt ? opt.etiqueta : etiquetaVacia;
  }
  boton.textContent = etiquetaDe(valorInicial);

  function posicionar() {
    const r = boton.getBoundingClientRect();
    lista.style.position = "fixed";
    lista.style.top = `${r.bottom + 6}px`;
    lista.style.left = `${r.left}px`;
    lista.style.width = `${r.width}px`;
  }
  function cerrarSiExterno(e) {
    if (lista.contains(e.target)) return;
    cerrar();
  }
  function cerrar() {
    lista.classList.add("oculto");
    boton.setAttribute("aria-expanded", "false");
    if (lista.parentElement === document.body) wrap.appendChild(lista);
    window.removeEventListener("scroll", cerrarSiExterno, true);
    window.removeEventListener("resize", cerrar);
  }
  function abrir() {
    document.querySelectorAll(".select-custom-lista").forEach((l) => {
      if (l !== lista) {
        l.classList.add("oculto");
        if (l.parentElement === document.body && l._volverA) l._volverA.appendChild(l);
      }
    });
    lista._volverA = wrap;
    document.body.appendChild(lista);
    posicionar();
    lista.classList.remove("oculto");
    boton.setAttribute("aria-expanded", "true");
    window.addEventListener("scroll", cerrarSiExterno, true);
    window.addEventListener("resize", cerrar);
  }

  function redibujarOpciones() {
    lista.innerHTML = "";
    opciones.forEach((op) => {
      const item = document.createElement("li");
      item.className = "select-custom-opcion" + (op.valor === oculto.value ? " activa" : "");
      item.textContent = op.etiqueta;
      item.addEventListener("click", () => {
        oculto.value = op.valor;
        boton.textContent = op.etiqueta;
        lista.querySelectorAll(".select-custom-opcion").forEach((li) => li.classList.remove("activa"));
        item.classList.add("activa");
        cerrar();
        onCambiar(op.valor);
      });
      lista.appendChild(item);
    });
  }

  oculto.value = valorInicial || "";
  redibujarOpciones();
  boton.setAttribute("aria-expanded", "false");
  boton.addEventListener("click", (e) => {
    e.stopPropagation();
    if (lista.classList.contains("oculto")) abrir();
    else cerrar();
  });

  wrap.appendChild(oculto);
  wrap.appendChild(boton);
  wrap.appendChild(lista);

  return {
    elemento: wrap,
    setValor: (valor) => {
      oculto.value = valor || "";
      boton.textContent = etiquetaDe(valor);
      redibujarOpciones();
    },
  };
}

/* ===================== Apertura ===================== */

function abrirModalBloqueHorario({ semestreId, bloqueId, diaPreseleccionado, horaInicioPreseleccionada, horaFinPreseleccionada }) {
  const semestre = buscarSemestreVivoPorId(semestreId);
  if (!semestre) {
    mostrarToast("Ese semestre ya no existe");
    return;
  }
  contextoActual = { semestreId, bloqueId: bloqueId || null };
  const bloque = bloqueId ? (semestre.bloques_horario || []).find((b) => b.id === bloqueId) : null;

  const diasIniciales = bloque
    ? bloque.dias
    : diaPreseleccionado
    ? [{ dia: diaPreseleccionado, hora_inicio: horaInicioPreseleccionada, hora_fin: horaFinPreseleccionada }]
    : [];

  const estadoForm = {
    materiaId: bloque ? bloque.materia_id : null,
    planEstudioId: bloque ? bloque.plan_estudio_id : null,
    apodo: bloque ? bloque.apodo || "" : "",
    grupo: bloque ? bloque.grupo || "" : "",
    nombrePersonalizado: bloque ? bloque.nombre || "" : "",
    dias: diasIniciales.map((d) => ({ ...d })),
    modalidad: bloque ? bloque.modalidad : crearModalidadHorario("presencial"),
    aula: bloque ? bloque.aula || "" : "",
    profesorId: bloque ? bloque.profesor_id : null,
    enlace: bloque ? bloque.enlace || "" : "",
    notas: bloque ? bloque.notas || "" : "",
    color: bloque ? bloque.color : null,
  };

  renderizarFormulario(semestre, bloque, estadoForm);
  document.getElementById("modal-bloque-horario")?.classList.remove("oculto");
}

/* ===================== Render del formulario ===================== */

function obtenerMateriasMatriculadasDelSemestre(semestre) {
  return (semestre.materias_matriculadas || []).map((mm) => {
    const plan = obtenerPlanPorId(mm.plan_estudio_id);
    const materia = plan && plan.materias.find((m) => m.id === mm.materia_id);
    return { mm, materia, plan };
  }).filter((x) => x.materia);
}

function renderizarFormulario(semestre, bloque, estadoForm) {
  const cont = document.getElementById("modal-bloque-horario-contenido");
  if (!cont) return;
  const materiasDisponibles = obtenerMateriasMatriculadasDelSemestre(semestre);
  const dias = obtenerDiasConfig();

  cont.innerHTML = `
    <h3>${bloque ? "Editar bloque" : "Nuevo bloque"}</h3>

    <div>
      <label class="form-label">Materia</label>
      <div id="hb-select-materia-zona"></div>
      <input type="text" id="hb-nombre-personalizado" class="form-input oculto" placeholder="Nombre del bloque" value="${estadoForm.nombrePersonalizado}" style="margin-top:8px;" />
    </div>

    <div>
      <label class="form-label">Apodo (opcional)</label>
      <input type="text" id="hb-apodo" class="form-input" value="${estadoForm.apodo}" placeholder="Ej. AP" />
    </div>

    <div>
      <label class="form-label">Grupo (opcional)</label>
      <input type="text" id="hb-grupo" class="form-input" value="${estadoForm.grupo}" placeholder="Ej. Grupo 2" />
    </div>

    <div>
      <label class="form-label">Días</label>
      <div id="hb-dias-pills" class="pill-group"></div>
      <div id="hb-horarios-por-dia" class="stack" style="margin-top:10px;"></div>
    </div>

    <div>
      <label class="form-label">Modalidad</label>
      <div id="hb-selector-modalidad"></div>
      <input type="text" id="hb-modalidad-personalizada" class="form-input oculto" placeholder="Ej. Virtual asincrónica" maxlength="60" style="margin-top:8px;" value="${estadoForm.modalidad?.tipo === "personalizado" ? estadoForm.modalidad.texto_personalizado || "" : ""}" />
    </div>

    <div>
      <label class="form-label">Aula (opcional)</label>
      <input type="text" id="hb-aula" class="form-input" value="${estadoForm.aula}" />
    </div>

    <div>
      <label class="form-label">Enlace (opcional)</label>
      <input type="text" id="hb-enlace" class="form-input" value="${estadoForm.enlace}" placeholder="https://..." />
    </div>

    <div>
      <label class="form-label">Profesor</label>
      <div id="hb-profesor-zona"></div>
    </div>

    <div>
      <label class="form-label">Notas</label>
      <textarea id="hb-notas" class="form-textarea" style="resize:none; overflow:hidden; min-height:44px;">${estadoForm.notas}</textarea>
    </div>

    <div class="row-between" style="margin-top:12px;">
      ${bloque ? `<button type="button" class="btn btn-danger" id="hb-btn-borrar">Borrar</button>` : "<span></span>"}
      <div class="row" style="gap:8px;">
        <button type="button" class="btn btn-secondary" id="hb-btn-cancelar">Cancelar</button>
        <button type="button" class="btn btn-primary" id="hb-btn-guardar">Guardar</button>
      </div>
    </div>
  `;

  // Materia / personalizado (select propio, mismo look que Ajustes)
  const inputNombrePersonalizado = document.getElementById("hb-nombre-personalizado");
  const opcionesMateria = [
    { valor: "", etiqueta: "— Crear personalizado —" },
    ...materiasDisponibles.map(({ mm, materia }) => ({ valor: mm.id, etiqueta: materia.nombre })),
  ];
  const valorMateriaInicial = estadoForm.materiaId
    ? materiasDisponibles.find((x) => x.materia.id === estadoForm.materiaId)?.mm.id || ""
    : "";
  const selectorMateria = construirSelectPersonalizado({
    opciones: opcionesMateria,
    valorInicial: valorMateriaInicial,
    etiquetaVacia: "— Crear personalizado —",
    onCambiar: (mmId) => {
      if (!mmId) {
        estadoForm.materiaId = null;
        estadoForm.planEstudioId = null;
        inputNombrePersonalizado.classList.remove("oculto");
      } else {
        const encontrada = materiasDisponibles.find((x) => x.mm.id === mmId);
        estadoForm.materiaId = encontrada ? encontrada.materia.id : null;
        estadoForm.planEstudioId = encontrada ? encontrada.mm.plan_estudio_id : null;
        inputNombrePersonalizado.classList.add("oculto");
        if (encontrada && (encontrada.mm.profesor_ids || []).length > 0 && !estadoForm.profesorId) {
          estadoForm.profesorId = encontrada.mm.profesor_ids[0];
        }
        renderizarZonaProfesor(semestre, estadoForm);
      }
    },
  });
  document.getElementById("hb-select-materia-zona").appendChild(selectorMateria.elemento);
  if (!valorMateriaInicial) inputNombrePersonalizado.classList.remove("oculto");
  else inputNombrePersonalizado.classList.add("oculto");

  // Días + horas por día
  renderizarDiasYHoras(dias, estadoForm);

  // Modalidad (dropdown propio, en vez de pills, para que nunca se corte)
  const inputModalidadPersonalizada = document.getElementById("hb-modalidad-personalizada");
  const opcionesModalidad = Object.entries(ETIQUETAS_MODALIDAD).map(([valor, etiqueta]) => ({ valor, etiqueta }));
  const selectorModalidad = construirSelectPersonalizado({
    opciones: opcionesModalidad,
    valorInicial: estadoForm.modalidad?.tipo || "presencial",
    etiquetaVacia: "Elegir modalidad",
    onCambiar: (tipo) => {
      estadoForm.modalidad = crearModalidadHorario(tipo, tipo === "personalizado" ? inputModalidadPersonalizada.value : null);
      inputModalidadPersonalizada.classList.toggle("oculto", tipo !== "personalizado");
      if (tipo === "personalizado") inputModalidadPersonalizada.focus();
    },
  });
  document.getElementById("hb-selector-modalidad").appendChild(selectorModalidad.elemento);
  inputModalidadPersonalizada.classList.toggle("oculto", estadoForm.modalidad?.tipo !== "personalizado");
  inputModalidadPersonalizada.addEventListener("input", () => {
    estadoForm.modalidad = crearModalidadHorario("personalizado", inputModalidadPersonalizada.value);
  });

  // Profesor
  renderizarZonaProfesor(semestre, estadoForm);

  // Notas: se agranda solo hacia abajo, nunca a lo ancho ni con handle de resize.
  const textareaNotas = document.getElementById("hb-notas");
  const autoAjustarNotas = () => {
    textareaNotas.style.height = "auto";
    textareaNotas.style.height = `${textareaNotas.scrollHeight}px`;
  };
  textareaNotas.addEventListener("input", autoAjustarNotas);
  requestAnimationFrame(autoAjustarNotas);

  // Botones
  document.getElementById("hb-btn-cancelar").addEventListener("click", cerrarModalBloqueHorario);
  document.getElementById("hb-btn-guardar").addEventListener("click", () => guardarBloque(semestre, bloque, estadoForm));
  const btnBorrar = document.getElementById("hb-btn-borrar");
  if (btnBorrar) btnBorrar.addEventListener("click", () => borrarBloque(semestre, bloque));
}

function renderizarDiasYHoras(dias, estadoForm) {
  const pillsCont = document.getElementById("hb-dias-pills");
  const horariosCont = document.getElementById("hb-horarios-por-dia");
  if (!pillsCont || !horariosCont) return;

  const estaActivo = (diaCodigo) => estadoForm.dias.some((d) => d.dia === diaCodigo);

  const redibujarHorarios = () => {
    horariosCont.innerHTML = "";
    estadoForm.dias.forEach((d) => {
      const fila = document.createElement("div");
      fila.className = "row-between";
      fila.innerHTML = `
        <span class="muted" style="min-width:70px;">${dias.find((x) => x.abrevDefault === d.dia)?.etiqueta || d.dia}</span>
        <input type="time" class="form-input hb-hora-inicio" value="${d.hora_inicio || ""}" style="max-width:110px;" />
        <input type="time" class="form-input hb-hora-fin" value="${d.hora_fin || ""}" style="max-width:110px;" />
      `;
      const inputInicio = fila.querySelector(".hb-hora-inicio");
      const inputFin = fila.querySelector(".hb-hora-fin");
      let finTocadoAMano = !!d.hora_fin;
      inputInicio.addEventListener("change", () => {
        d.hora_inicio = inputInicio.value;
        if (!finTocadoAMano) {
          d.hora_fin = inputInicio.value;
          inputFin.value = inputInicio.value;
        }
      });
      inputFin.addEventListener("change", () => {
        d.hora_fin = inputFin.value;
        finTocadoAMano = true;
      });
      horariosCont.appendChild(fila);
    });
  };

  pillsCont.innerHTML = "";
  dias.forEach((dia) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pill-item" + (estaActivo(dia.abrevDefault) ? " active" : "");
    btn.textContent = dia.etiquetaCorta;
    btn.addEventListener("click", () => {
      if (estaActivo(dia.abrevDefault)) {
        estadoForm.dias = estadoForm.dias.filter((d) => d.dia !== dia.abrevDefault);
      } else {
        estadoForm.dias.push({ dia: dia.abrevDefault, hora_inicio: "", hora_fin: "" });
      }
      btn.classList.toggle("active");
      redibujarHorarios();
    });
    pillsCont.appendChild(btn);
  });

  redibujarHorarios();
}

/* ===================== Profesor: vincular existente / crear sin salir del flujo ===================== */

function renderizarZonaProfesor(semestre, estadoForm) {
  const zona = document.getElementById("hb-profesor-zona");
  if (!zona) return;
  const profesorActual = estadoForm.profesorId
    ? (estado.datos.profesores || []).find((p) => p.id === estadoForm.profesorId)
    : null;

  if (profesorActual) {
    zona.innerHTML = `
      <div class="row-between">
        <span>${profesorActual.nombre}</span>
        <button type="button" class="btn btn-secondary" id="hb-btn-quitar-profesor">Quitar</button>
      </div>
    `;
    document.getElementById("hb-btn-quitar-profesor").addEventListener("click", () => {
      estadoForm.profesorId = null;
      renderizarZonaProfesor(semestre, estadoForm);
    });
    return;
  }

  const profesores = estado.datos.profesores || [];
  zona.innerHTML = `
    <div class="stack" style="gap:6px;">
      ${profesores.length > 0 ? `<div id="hb-select-profesor-existente-zona"></div>` : ""}
      <button type="button" class="btn btn-secondary" id="hb-btn-crear-profesor">+ Crear profesor</button>
    </div>
  `;

  const zonaSelectExistente = document.getElementById("hb-select-profesor-existente-zona");
  if (zonaSelectExistente) {
    const selectorExistente = construirSelectPersonalizado({
      opciones: profesores.map((p) => ({ valor: p.id, etiqueta: p.nombre })),
      valorInicial: "",
      etiquetaVacia: "Elegir profesor existente…",
      onCambiar: (profesorId) => {
        estadoForm.profesorId = profesorId;
        // Deja también el vínculo guardado en la materia matriculada, si aplica.
        const mm = (semestre.materias_matriculadas || []).find((m) => m.materia_id === estadoForm.materiaId);
        if (mm) vincularProfesorAMateriaMatriculada(semestre.id, mm.id, profesorId);
        renderizarZonaProfesor(semestre, estadoForm);
      },
    });
    zonaSelectExistente.appendChild(selectorExistente.elemento);
  }

  document.getElementById("hb-btn-crear-profesor").addEventListener("click", () => {
    const mm = (semestre.materias_matriculadas || []).find((m) => m.materia_id === estadoForm.materiaId);
    // NOTA: requiere que comunidad.js llame onGuardado(nuevo) — hoy llama
    // onGuardado() sin argumento, hay que cambiar esa única línea ahí.
    abrirModalAltaProfesor(null, mm ? mm.id : null, (profesorCreado) => {
      if (!profesorCreado) return; // hasta que se aplique el fix de arriba, no rompe: solo no autocompleta
      estadoForm.profesorId = profesorCreado.id;
      renderizarZonaProfesor(semestre, estadoForm);
    });
  });
}

/* ===================== Guardar / Borrar ===================== */

function guardarBloque(semestre, bloque, estadoForm) {
  const diasValidos = estadoForm.dias.filter((d) => d.hora_inicio && d.hora_fin);
  if (diasValidos.length === 0) {
    mostrarToast("Elegí al menos un día con hora de inicio y fin");
    return;
  }
  const aula = document.getElementById("hb-aula").value.trim();
  const apodo = document.getElementById("hb-apodo").value.trim();
  const grupo = document.getElementById("hb-grupo").value.trim();
  const enlace = document.getElementById("hb-enlace").value.trim();
  const notas = document.getElementById("hb-notas").value.trim();
  const nombrePersonalizado = document.getElementById("hb-nombre-personalizado").value.trim();

  if (bloque) {
    bloque.materia_id = estadoForm.materiaId;
    bloque.plan_estudio_id = estadoForm.materiaId ? estadoForm.planEstudioId : null;
    bloque.nombre = estadoForm.materiaId ? null : nombrePersonalizado;
    bloque.apodo = apodo || null;
    bloque.grupo = grupo || null;
    bloque.dias = diasValidos;
    bloque.modalidad = estadoForm.modalidad;
    bloque.aula = aula || null;
    bloque.profesor_id = estadoForm.profesorId;
    bloque.enlace = enlace || null;
    bloque.notas = notas || null;
    sellarTimestamp(bloque);
  } else {
    const nuevo = crearBloqueHorario({
      materiaId: estadoForm.materiaId,
      planEstudioId: estadoForm.planEstudioId,
      nombre: nombrePersonalizado,
      apodo,
      grupo,
      dias: diasValidos,
      modalidad: estadoForm.modalidad,
      aula,
      profesorId: estadoForm.profesorId,
      enlace,
      notas,
    });
    semestre.bloques_horario = semestre.bloques_horario || [];
    semestre.bloques_horario.push(nuevo);
  }
  sellarTimestamp(semestre);
  marcarCambioPendiente();
  cerrarModalBloqueHorario();
  window.renderizarHorario?.();
}

function borrarBloque(semestre, bloque) {
  semestre.bloques_horario = (semestre.bloques_horario || []).filter((b) => b.id !== bloque.id);
  semestre._eliminados_bloques_horario = semestre._eliminados_bloques_horario || [];
  semestre._eliminados_bloques_horario.push({ id: bloque.id, eliminadoEn: Date.now() });
  sellarTimestamp(semestre);
  marcarCambioPendiente();
  cerrarModalBloqueHorario();
  window.renderizarHorario?.();
}

export { abrirModalBloqueHorario, cerrarModalBloqueHorario };
