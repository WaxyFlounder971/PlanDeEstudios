/* =========================================================================
   HORARIO — Modal de creación/edición de bloque (2do tap sobre el flotante,
   o tap directo sobre una tarjeta existente / botón "+ Agregar").
   ========================================================================= */

import {
  crearBloqueHorario,
  crearModalidadHorario,
  crearDiaCronograma,
  obtenerClasesEfectivasSemana,
  calcularNumeroSemanaSemestre,
  sellarTimestamp,
} from "../core/schema.js";
import { marcarCambioPendiente } from "../core/storage-sync.js";
import { estado } from "../core/storage.js";
import { mostrarToast } from "../ui/componentes.js";
import { DIAS_SEMANA_CONFIG } from "../config/config-ajustes.js";
import { buscarSemestreVivoPorId, vincularProfesorAMateriaMatriculada } from "../semestres/semestres.js";
import { abrirModalAltaProfesor } from "../comunidad/comunidad.js";

const ETIQUETAS_MODALIDAD = { presencial: "Presencial", virtual: "Virtual", asincronica: "Asincrónica" };

// Editor de color de materia/bloque (pendiente de la ronda anterior): el
// schema ya soporta bloque.color (override propio, independiente del color
// de categoría) — acá se habilita la UI. Selector totalmente libre (input
// type="color" nativo), sin paleta predefinida — ver construirSelectorColor
// más abajo.

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

function limpiarSelectsFlotantes() {
  // Los selects personalizados abiertos "escapan" temporalmente al <body>
  // para posicionarse con position:fixed — si el modal se cierra con uno
  // abierto (X, click en el fondo, ESC), no pasan por cerrarModalBloqueHorario
  // y quedan flotando invisibles pero presentes en el DOM. Por eso se
  // observa el modal directamente en vez de depender de un solo punto de
  // cierre.
  document.querySelectorAll(".select-custom-lista").forEach((l) => {
    if (l.parentElement === document.body) l.remove();
  });
}

let observadorModalInstalado = false;
function instalarObservadorCierreModal() {
  if (observadorModalInstalado) return;
  const overlay = document.getElementById("modal-bloque-horario");
  if (!overlay) return;
  observadorModalInstalado = true;
  new MutationObserver(() => {
    if (overlay.classList.contains("oculto")) {
      limpiarSelectsFlotantes();
      contextoActual = null;
    }
  }).observe(overlay, { attributes: true, attributeFilter: ["class"] });
}

/**
 * Select personalizado (mismo patrón que "Escala de notas" en Ajustes):
 * un <select> real oculto como dueño del valor, y un botón + lista propios
 * como parte visible, para que el fondo/letras se vean bien en cualquier
 * tema en vez del popup nativo del navegador. `opciones` es [{valor, etiqueta}].
 */
function construirSelectPersonalizado({ opciones, valorInicial, etiquetaVacia, onCambiar, anchoMinimoLista }) {
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
    const ancho = Math.max(r.width, anchoMinimoLista || 0);
    lista.style.position = "fixed";
    lista.style.top = `${r.bottom + 6}px`;
    // Si la lista quedó más ancha que el botón, centrarla contra el botón
    // en vez de desalinearla hacia la derecha.
    lista.style.left = `${r.left - (ancho - r.width) / 2}px`;
    lista.style.width = `${ancho}px`;
  }
  function cerrarSiExterno(e) {
    if (lista.contains(e.target) || boton.contains(e.target)) return;
    cerrar();
  }
  function cerrar() {
    lista.classList.add("oculto");
    boton.setAttribute("aria-expanded", "false");
    if (lista.parentElement === document.body) wrap.appendChild(lista);
    window.removeEventListener("scroll", cerrarSiExterno, true);
    window.removeEventListener("resize", cerrar);
    document.removeEventListener("click", cerrarSiExterno, true);
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
    setTimeout(() => document.addEventListener("click", cerrarSiExterno, true), 0);
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

function abrirModalBloqueHorario({ semestreId, bloqueId, diaPreseleccionado, horaInicioPreseleccionada, horaFinPreseleccionada, numeroSemanaVista }) {
  instalarObservadorCierreModal();
  const semestre = buscarSemestreVivoPorId(semestreId);
  if (!semestre) {
    mostrarToast("Ese semestre ya no existe");
    return;
  }
  // numeroSemanaVista: la semana que el usuario estaba viendo en el grid
  // cuando abrió este editor (viene de horario.js). Ya no se usa para
  // ningún prompt de alcance (ese flujo se eliminó) — ahora solo sirve
  // para dejar preseleccionada esa semana en la sección Cronograma, así
  // el usuario no tiene que ir a buscarla de nuevo si la abre.
  contextoActual = { semestreId, bloqueId: bloqueId || null, numeroSemanaVista: numeroSemanaVista || null };
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
      <label class="form-label">Color</label>
      <div id="hb-color-zona"></div>
    </div>

    <div>
      <label class="form-label">Notas</label>
      <textarea id="hb-notas" class="form-textarea" style="resize:none; overflow:hidden; min-height:44px;">${estadoForm.notas}</textarea>
    </div>

    <div id="hb-cronograma-cont"></div>

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
        renderizarZonaColor(estadoForm);
      }
    },
  });
  document.getElementById("hb-select-materia-zona").appendChild(selectorMateria.elemento);
  if (!valorMateriaInicial) inputNombrePersonalizado.classList.remove("oculto");
  else inputNombrePersonalizado.classList.add("oculto");

  // Días + horas por día (cada día trae su propia modalidad, ver abajo)
  renderizarDiasYHoras(dias, estadoForm);

  // Profesor
  renderizarZonaProfesor(semestre, estadoForm);

  // Color del bloque (override propio, independiente de la categoría)
  renderizarZonaColor(estadoForm);

  // Notas: se agranda solo hacia abajo, nunca a lo ancho ni con handle de resize.
  const textareaNotas = document.getElementById("hb-notas");
  const autoAjustarNotas = () => {
    textareaNotas.style.height = "auto";
    textareaNotas.style.height = `${textareaNotas.scrollHeight}px`;
  };
  textareaNotas.addEventListener("input", autoAjustarNotas);
  requestAnimationFrame(autoAjustarNotas);

  // Cronograma de clases (widget autocontenido, reusado también en la
  // tarjeta de info de solo-lectura del grid — ver construirZonaCronograma)
  document.getElementById("hb-cronograma-cont").appendChild(
    construirZonaCronograma(semestre, bloque, { semanaInicial: contextoActual?.numeroSemanaVista })
  );

  // Botones
  document.getElementById("hb-btn-cancelar").addEventListener("click", cerrarModalBloqueHorario);
  document.getElementById("hb-btn-guardar").addEventListener("click", () => guardarBloque(semestre, bloque, estadoForm));
  const btnBorrar = document.getElementById("hb-btn-borrar");
  if (btnBorrar) btnBorrar.addEventListener("click", () => borrarBloque(semestre, bloque));
}

/**
 * Selector de color del bloque: hereda el color de categoría por defecto
 * (mismo criterio que obtenerColorBloque en horario.js) — el primer swatch
 * ("↺") vuelve a ese heredado; los demás son overrides propios del bloque.
 */
function renderizarZonaColor(estadoForm) {
  const zona = document.getElementById("hb-color-zona");
  if (!zona) return;
  zona.innerHTML = "";
  const colorHeredado = estadoForm.materiaId
    ? obtenerColorHeredadoDeCategoria(estadoForm.materiaId, estadoForm.planEstudioId)
    : "#a78bfa";
  const selector = construirSelectorColor({
    colorActual: estadoForm.color,
    colorHeredado,
    onCambiar: (valor) => {
      estadoForm.color = valor;
    },
  });
  zona.appendChild(selector.elemento);
}

function obtenerColorHeredadoDeCategoria(materiaId, planEstudioId) {
  const plan = obtenerPlanPorId(planEstudioId);
  const materia = plan && plan.materias.find((m) => m.id === materiaId);
  const categoria = plan && materia && plan.categorias.find((c) => c.id === materia.categoria_id);
  return (categoria && categoria.color) || "#a78bfa";
}

/**
 * Selector de color del bloque: hereda el color de categoría por defecto
 * (mismo criterio que obtenerColorBloque en horario.js) — el círculo "↺"
 * vuelve a ese heredado; el círculo con el input de color nativo permite
 * elegir CUALQUIER color (sin paleta predefinida ni swatches curados).
 */
function construirSelectorColor({ colorActual, colorHeredado, onCambiar }) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  wrap.style.cssText = "gap:10px; align-items:center; flex-wrap:wrap;";

  let seleccionado = colorActual || null;

  const btnHeredar = document.createElement("button");
  btnHeredar.type = "button";
  btnHeredar.title = "Usar color de categoría";
  btnHeredar.innerHTML = `<span style="font-size:0.7rem; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,0.5);">↺</span>`;

  // El <input type="color"> nativo abre la rueda de color del sistema
  // operativo/navegador: cualquier color es válido, no solo los de una
  // paleta curada. Se envuelve en un círculo con overflow:hidden y el
  // input se agranda/desplaza (-25% / 150%) por encima porque el swatch
  // interno del input no siempre respeta border-radius directo entre
  // navegadores — así se ve igual de redondo que el botón "↺" de al lado.
  const wrapPicker = document.createElement("div");
  wrapPicker.title = "Elegir color libre";
  const inputColor = document.createElement("input");
  inputColor.type = "color";
  inputColor.style.cssText = "position:absolute; top:-25%; left:-25%; width:150%; height:150%; border:none; padding:0; margin:0; cursor:pointer; background:none;";
  wrapPicker.appendChild(inputColor);

  function actualizarEstilos() {
    const heredadoActivo = !seleccionado;
    btnHeredar.style.cssText = `
      width:28px; height:28px; border-radius:50%; cursor:pointer;
      background:${colorHeredado};
      border:2px solid ${heredadoActivo ? "var(--text-primary)" : "transparent"};
      box-shadow:0 1px 3px rgba(0,0,0,0.3);
      display:flex; align-items:center; justify-content:center;
      flex-shrink:0; padding:0;
    `;
    wrapPicker.style.cssText = `
      width:28px; height:28px; border-radius:50%; overflow:hidden; position:relative;
      cursor:pointer; box-shadow:0 1px 3px rgba(0,0,0,0.3);
      border:2px solid ${heredadoActivo ? "transparent" : "var(--text-primary)"};
      flex-shrink:0; background:${seleccionado || colorHeredado};
    `;
    inputColor.value = seleccionado || colorHeredado;
  }

  btnHeredar.addEventListener("click", () => {
    seleccionado = null;
    onCambiar(null);
    actualizarEstilos();
  });
  inputColor.addEventListener("input", () => {
    seleccionado = inputColor.value;
    onCambiar(seleccionado);
    actualizarEstilos();
  });

  actualizarEstilos();
  wrap.appendChild(btnHeredar);
  wrap.appendChild(wrapPicker);

  return {
    elemento: wrap,
    setValor: (valor) => {
      seleccionado = valor || null;
      actualizarEstilos();
    },
  };
}

/**
 * Selector de hora personalizado: mismo look que el selector de materia
 * (2 dropdowns propios lado a lado, HH y MM) en vez del <input type="time">
 * nativo — evita el ícono de reloj negro invisible en modo oscuro y hace
 * que se vea EXACTAMENTE igual al resto de selects de la app.
 */
function construirSelectorHora({ valorInicial, onCambiar }) {
  const [hIni, mIni] = String(valorInicial || "").split(":");
  const opcionesHora = Array.from({ length: 24 }, (_, h) => ({ valor: String(h).padStart(2, "0"), etiqueta: String(h).padStart(2, "0") }));
  const opcionesMinuto = Array.from({ length: 12 }, (_, i) => {
    const m = String(i * 5).padStart(2, "0");
    return { valor: m, etiqueta: m };
  });

  const wrap = document.createElement("div");
  wrap.className = "horario-selector-hora";

  let horaActual = hIni || "";
  let minutoActual = mIni || "";
  const emitir = () => {
    if (horaActual && minutoActual) onCambiar(`${horaActual}:${minutoActual}`);
  };

  const selectorH = construirSelectPersonalizado({
    opciones: opcionesHora,
    valorInicial: horaActual,
    etiquetaVacia: "HH",
    anchoMinimoLista: 68,
    onCambiar: (v) => {
      horaActual = v;
      emitir();
    },
  });
  const separador = document.createElement("span");
  separador.className = "horario-selector-hora-separador";
  separador.textContent = ":";
  const selectorM = construirSelectPersonalizado({
    opciones: opcionesMinuto,
    valorInicial: minutoActual,
    etiquetaVacia: "MM",
    anchoMinimoLista: 68,
    onCambiar: (v) => {
      minutoActual = v;
      emitir();
    },
  });

  wrap.appendChild(selectorH.elemento);
  wrap.appendChild(separador);
  wrap.appendChild(selectorM.elemento);

  return {
    elemento: wrap,
    setValor: (valor) => {
      const [h, m] = String(valor || "").split(":");
      horaActual = h || "";
      minutoActual = m || "";
      selectorH.setValor(horaActual);
      selectorM.setValor(minutoActual);
    },
  };
}

function renderizarDiasYHoras(dias, estadoForm) {
  const pillsCont = document.getElementById("hb-dias-pills");
  const horariosCont = document.getElementById("hb-horarios-por-dia");
  if (!pillsCont || !horariosCont) return;

  const estaActivo = (diaCodigo) => estadoForm.dias.some((d) => d.dia === diaCodigo);

  const redibujarHorarios = () => {
    estadoForm.dias.sort(
      (a, b) => dias.findIndex((x) => x.abrevDefault === a.dia) - dias.findIndex((x) => x.abrevDefault === b.dia)
    );
    horariosCont.innerHTML = "";
    estadoForm.dias.forEach((d) => {
      const fila = document.createElement("div");
      fila.className = "stack";
      fila.style.cssText = "gap:6px; padding:8px 0; border-bottom:1px solid rgba(150,150,170,0.15);";
      const filaSuperior = document.createElement("div");
      filaSuperior.className = "row-between";
      const etiquetaDia = document.createElement("span");
      etiquetaDia.className = "muted";
      etiquetaDia.style.minWidth = "70px";
      etiquetaDia.textContent = dias.find((x) => x.abrevDefault === d.dia)?.etiqueta || d.dia;
      filaSuperior.appendChild(etiquetaDia);

      const zonaHoraInicio = document.createElement("div");
      const zonaHoraFin = document.createElement("div");
      filaSuperior.appendChild(zonaHoraInicio);
      filaSuperior.appendChild(zonaHoraFin);
      fila.appendChild(filaSuperior);

      const zonaModalidad = document.createElement("div");
      zonaModalidad.style.width = "100%";
      fila.appendChild(zonaModalidad);

      let finTocadoAMano = !!d.hora_fin;
      const selectorInicio = construirSelectorHora({
        valorInicial: d.hora_inicio,
        onCambiar: (valor) => {
          d.hora_inicio = valor;
          if (!finTocadoAMano) {
            d.hora_fin = valor;
            selectorFin.setValor(valor);
          }
        },
      });
      const selectorFin = construirSelectorHora({
        valorInicial: d.hora_fin,
        onCambiar: (valor) => {
          d.hora_fin = valor;
          finTocadoAMano = true;
        },
      });
      zonaHoraInicio.appendChild(selectorInicio.elemento);
      zonaHoraFin.appendChild(selectorFin.elemento);

      const opcionesModalidad = Object.entries(ETIQUETAS_MODALIDAD).map(([valor, etiqueta]) => ({ valor, etiqueta }));
      const selectorModalidadDia = construirSelectPersonalizado({
        opciones: opcionesModalidad,
        valorInicial: d.modalidad || "presencial",
        etiquetaVacia: "Modalidad",
        onCambiar: (tipo) => {
          d.modalidad = tipo;
        },
      });
      if (!d.modalidad) d.modalidad = "presencial";
      zonaModalidad.appendChild(selectorModalidadDia.elemento);

      horariosCont.appendChild(fila);
    });
  };

  // Etiquetas configuradas en Ajustes (respeta lo que el usuario haya
  // puesto ahí, ej. "Mar" en vez de "M") — si no caben todas en una sola
  // fila sin cortarse, se pasa a grid de 4, 3 o 2 columnas (nunca trunca).
  const construirPills = () => {
    pillsCont.innerHTML = "";
    pillsCont.className = "pill-group";
    pillsCont.style.cssText = "";
    dias.forEach((dia) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pill-item" + (estaActivo(dia.abrevDefault) ? " active" : "");
      btn.textContent = dia.etiquetaCorta;
      btn.addEventListener("click", () => {
        if (estaActivo(dia.abrevDefault)) {
          estadoForm.dias = estadoForm.dias.filter((d) => d.dia !== dia.abrevDefault);
        } else {
          // Autorelleno: si ya hay al menos un día con horas puestas, se
          // copian como punto de partida (igual queda editable después).
          const referencia = estadoForm.dias.find((d) => d.hora_inicio && d.hora_fin);
          estadoForm.dias.push({
            dia: dia.abrevDefault,
            hora_inicio: referencia ? referencia.hora_inicio : "",
            hora_fin: referencia ? referencia.hora_fin : "",
            modalidad: referencia ? referencia.modalidad : "presencial",
          });
        }
        btn.classList.toggle("active");
        redibujarHorarios();
      });
      pillsCont.appendChild(btn);
    });

    // Mide si entran todas en una fila; si no, arma el grid 4-3 / 3-3-1 / 2-2-2-1.
    requestAnimationFrame(() => {
      const botones = Array.from(pillsCont.children);
      if (botones.length === 0) return;
      const anchoNecesario = botones.reduce((suma, b) => suma + b.offsetWidth + 8, 0);
      const anchoDisponible = pillsCont.parentElement.clientWidth || pillsCont.clientWidth;
      if (anchoNecesario <= anchoDisponible) return; // entran bien en una fila, no tocar nada
      const anchoPromedio = anchoNecesario / botones.length;
      let columnas = Math.max(2, Math.min(4, Math.floor(anchoDisponible / anchoPromedio)));
      const gap = 8;
      const anchoPill = `calc((100% - ${gap * (columnas - 1)}px) / ${columnas})`;
      pillsCont.classList.add("horario-dias-pill-grid");
      botones.forEach((b) => {
        b.style.flexBasis = anchoPill;
      });
    });
  };

  construirPills();
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
        <button type="button" class="btn-discreto" id="hb-btn-quitar-profesor">Quitar</button>
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


/* ===================== Cronograma de clases ===================== *
 * Reemplaza al viejo sistema de "excepciones por semana completa" (ver
 * nota arriba de guardarBloque). Modelo de datos en schema.js:
 * cronograma_dias / crearDiaCronograma / obtenerClasesEfectivasSemana.
 * Acá solo vive la UI: lista de semanas del semestre, y al tocar una,
 * una tarjetita por cada día que el bloque tenga esa semana con su
 * Modalidad efectiva y un lápiz para ajustarla puntualmente. Nada más es
 * editable desde acá — horario/aula/profesor/enlace/notas/color siguen
 * siendo responsabilidad exclusiva de la plantilla base, arriba en este
 * mismo formulario.
 */

const ETIQUETAS_MODALIDAD_CRONOGRAMA = { ...ETIQUETAS_MODALIDAD, sin_clase: "Sin clase" };

// Duplicado deliberado de fechaLocalDesdeISO/obtenerEmojiModalidad (ver
// horario.js): evita un import circular, ya que horario.js importa de
// este archivo (abrirModalBloqueHorario). Son funciones puras de pocas
// líneas sin estado propio — si alguna cambia, replicar acá también.
function fechaLocalDesdeISOCronograma(str) {
  const soloFecha = String(str || "").slice(0, 10);
  const [y, m, d] = soloFecha.split("-").map(Number);
  if (!y || !m || !d) return new Date(NaN);
  return new Date(y, m - 1, d);
}

function obtenerEmojiModalidadCronograma(modalidad) {
  if (modalidad === "sin_clase") return "✖️";
  const normalizado = String(modalidad || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalizado.startsWith("virtual")) return "💻";
  if (normalizado.startsWith("asincron")) return "📖";
  return "";
}

/**
 * Fecha calendario real de un día/semana puntual — ANCLADA al día de la
 * semana REAL de fecha_inicio (vía Date.getDay()), no a la config de "día
 * de inicio de semana" (esa config es solo de orden visual, ver
 * DIAS_SEMANA_CONFIG). Mismo cálculo, mismo bug corregido en calcularFechaDelDia
 * de horario.js — antes ambos asumían que fecha_inicio caía justo en el
 * día configurado como inicio de semana, y cuando eso no se cumplía toda
 * fecha calculada quedaba corrida (bug real reportado: "hoy es viernes y
 * la app dice sábado").
 */
function calcularFechaClaseSemana(semestre, numeroSemana, diaCodigo) {
  const inicio = fechaLocalDesdeISOCronograma(semestre.fecha_inicio);
  if (isNaN(inicio.getTime())) return null;
  const idxCanonico = DIAS_SEMANA_CONFIG.findIndex((d) => d.abrevDefault === diaCodigo);
  if (idxCanonico === -1) return null;
  // DIAS_SEMANA_CONFIG va lunes→domingo (índices 0-6); Date.getDay() usa
  // domingo=0..sábado=6 — de ahí el +1 % 7 para pasar de un sistema al otro.
  const pesoObjetivo = (idxCanonico + 1) % 7;
  const diffDentroDeSemana = (pesoObjetivo - inicio.getDay() + 7) % 7;
  const fecha = new Date(inicio);
  fecha.setDate(inicio.getDate() + (numeroSemana - 1) * 7 + diffDentroDeSemana);
  return fecha;
}

/**
 * Aplica (o revierte) el ajuste puntual de Modalidad de un día concreto de
 * una semana concreta. Si la modalidad elegida coincide con la de la
 * plantilla, se interpreta como "volver a lo normal": si había un ajuste
 * guardado, se borra (con tumba real, mismo patrón que el resto de
 * colecciones anidadas). Si difiere, crea o actualiza la entrada de
 * cronograma_dias correspondiente. Esto NO pasa por el botón "Guardar"
 * del formulario — se persiste al toque, como cualquier otro cambio
 * puntual sincronizable.
 */
function aplicarModalidadDia(bloque, numeroSemana, diaCodigo, nuevaModalidad) {
  const diaPlantilla = (bloque.dias || []).find((d) => d.dia === diaCodigo);
  const modalidadPlantilla = (diaPlantilla && diaPlantilla.modalidad) || "presencial";
  bloque.cronograma_dias = bloque.cronograma_dias || [];
  bloque._eliminados_cronograma_dias = bloque._eliminados_cronograma_dias || [];
  const existente = bloque.cronograma_dias.find((cd) => cd.numero_semana === numeroSemana && cd.dia === diaCodigo);

  if (nuevaModalidad === modalidadPlantilla) {
    if (existente) {
      bloque.cronograma_dias = bloque.cronograma_dias.filter((cd) => cd.id !== existente.id);
      bloque._eliminados_cronograma_dias.push({ id: existente.id, eliminadoEn: Date.now() });
    }
  } else if (existente) {
    existente.modalidad = nuevaModalidad;
    sellarTimestamp(existente);
  } else {
    bloque.cronograma_dias.push(crearDiaCronograma({ numeroSemana, dia: diaCodigo, modalidad: nuevaModalidad }));
  }

  sellarTimestamp(bloque);
  marcarCambioPendiente();
  window.renderizarHorario?.();
}

function renderizarZonaCronograma(zona, chevron, semestre, bloque, estadoLocal, repintar) {
  if (!zona) return;
  if (chevron) chevron.textContent = estadoLocal._cronogramaAbierto ? "▲" : "▼";

  if (!estadoLocal._cronogramaAbierto) {
    zona.innerHTML = "";
    return;
  }

  if (!bloque) {
    zona.innerHTML = `<p class="muted" style="font-size:0.82rem; padding:8px 0;">Disponible después de guardar este bloque por primera vez.</p>`;
    return;
  }

  const totalSemanas = Number(semestre.duracion_semanas) || 16;
  const semanaActual = calcularNumeroSemanaSemestre(semestre);
  const semanaAbierta = estadoLocal._cronogramaSemanaAbierta;

  const pillsHtml = Array.from({ length: totalSemanas }, (_, i) => i + 1)
    .map((n) => {
      const clases = "pill-item" + (n === semanaAbierta ? " active" : "");
      return `<button type="button" class="${clases}" data-semana="${n}">${n}${n === semanaActual ? " •" : ""}</button>`;
    })
    .join("");

  let tarjetasHtml = "";
  if (semanaAbierta) {
    const clases = obtenerClasesEfectivasSemana(bloque, semanaAbierta);
    if (clases.length === 0) {
      tarjetasHtml = `<p class="muted" style="font-size:0.8rem; margin-top:10px;">Este bloque no tiene días configurados.</p>`;
    } else {
      tarjetasHtml =
        `<div class="stack" style="gap:8px; margin-top:10px;">` +
        clases
          .map((c) => {
            const diaInfo = DIAS_SEMANA_CONFIG.find((x) => x.abrevDefault === c.dia);
            const nombreDia = (diaInfo && diaInfo.etiqueta) || c.dia;
            const fecha = calcularFechaClaseSemana(semestre, semanaAbierta, c.dia);
            const fechaTxt = fecha && !isNaN(fecha.getTime()) ? fecha.toLocaleDateString("es-CR", { day: "numeric", month: "short" }) : "";
            const clave = `${semanaAbierta}-${c.dia}`;
            const editando = estadoLocal._cronogramaEditando === clave;
            return `
          <div class="stack" style="gap:4px; padding:8px 10px; border-radius:8px; background:rgba(150,150,170,0.08);">
            <div class="row-between">
              <span style="font-weight:600; font-size:0.85rem;">Clase - ${nombreDia}${fechaTxt ? ` ${fechaTxt}` : ""}</span>
              <button type="button" class="btn-discreto" data-editar-dia="${clave}" title="Ajustar modalidad de este día">✎</button>
            </div>
            <div class="row-between" data-linea-modalidad="${clave}">
              ${editando ? "" : `<span class="muted" style="font-size:0.78rem;">${ETIQUETAS_MODALIDAD_CRONOGRAMA[c.modalidad] || c.modalidad}</span><span style="font-size:1rem;">${obtenerEmojiModalidadCronograma(c.modalidad)}</span>`}
            </div>
          </div>`;
          })
          .join("") +
        `</div>`;
    }
  }

  // Antes: .pill-group (scroll horizontal de una sola línea) — con más de
  // ~10 semanas, la mayoría quedaba fuera de vista sin indicio de que había
  // que deslizar, y al re-renderizar el scroll volvía a 0 así que la
  // semana realmente seleccionada podía quedar oculta (se veía como si el
  // highlight estuviera "en cualquier lado"). Ahora: grid que envuelve,
  // TODAS las semanas visibles de una, mismo número de columnas en cada
  // fila (las incompletas al final dejan casillas vacías, nunca desparejo).
  zona.innerHTML = `<div class="pill-grid-semanas">${pillsHtml}</div>${tarjetasHtml}`;

  zona.querySelectorAll("[data-semana]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.semana);
      estadoLocal._cronogramaSemanaAbierta = estadoLocal._cronogramaSemanaAbierta === n ? null : n;
      estadoLocal._cronogramaEditando = null;
      repintar();
    });
  });

  zona.querySelectorAll("[data-editar-dia]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const clave = btn.dataset.editarDia;
      estadoLocal._cronogramaEditando = estadoLocal._cronogramaEditando === clave ? null : clave;
      repintar();
    });
  });

  if (estadoLocal._cronogramaEditando && semanaAbierta) {
    const diaCodigo = estadoLocal._cronogramaEditando.split("-")[1];
    const lineaModalidad = zona.querySelector(`[data-linea-modalidad="${estadoLocal._cronogramaEditando}"]`);
    const claseActual = obtenerClasesEfectivasSemana(bloque, semanaAbierta).find((c) => c.dia === diaCodigo);
    if (lineaModalidad && claseActual) {
      const opciones = Object.entries(ETIQUETAS_MODALIDAD_CRONOGRAMA).map(([valor, etiqueta]) => ({ valor, etiqueta }));
      const selector = construirSelectPersonalizado({
        opciones,
        valorInicial: claseActual.modalidad,
        etiquetaVacia: "Modalidad",
        onCambiar: (valor) => {
          aplicarModalidadDia(bloque, semanaAbierta, diaCodigo, valor);
          estadoLocal._cronogramaEditando = null;
          repintar();
        },
      });
      lineaModalidad.appendChild(selector.elemento);
    }
  }
}

/**
 * Widget autocontenido (botón expandible + contenido) para poder reusar el
 * Cronograma tanto en el modal de editar bloque como en la tarjeta de info
 * de solo-lectura del grid (horario.js) — cada instancia lleva su propio
 * estado de UI (abierto/semana/editando), independiente entre sí.
 * `semanaInicial` deja esa semana preseleccionada (ej. la que se estaba
 * viendo en el grid) sin expandir la sección automáticamente — igual
 * criterio que numeroSemanaVista en abrirModalBloqueHorario.
 */
function construirZonaCronograma(semestre, bloque, { semanaInicial } = {}) {
  const wrap = document.createElement("div");
  const boton = document.createElement("button");
  boton.type = "button";
  boton.className = "btn-discreto row-between";
  boton.style.cssText = "width:100%; text-align:left; padding:8px 0;";
  boton.innerHTML = `<span>📅 Cronograma de clases</span><span class="hb-cronograma-chevron">▼</span>`;
  const zona = document.createElement("div");

  const estadoLocal = {
    _cronogramaAbierto: false,
    _cronogramaSemanaAbierta: semanaInicial || null,
    _cronogramaEditando: null,
  };

  const repintar = () => renderizarZonaCronograma(zona, boton.querySelector(".hb-cronograma-chevron"), semestre, bloque, estadoLocal, repintar);

  boton.addEventListener("click", () => {
    estadoLocal._cronogramaAbierto = !estadoLocal._cronogramaAbierto;
    estadoLocal._cronogramaEditando = null;
    repintar();
  });

  wrap.appendChild(boton);
  wrap.appendChild(zona);
  return wrap;
}

// Nota (2026-08-14): antes acá vivía el prompt "¿Aplicar a todas las
// semanas o solo a esta?" + la lógica de excepciones por semana completa.
// Reemplazado por el Cronograma de clases granular por día (ver
// cronograma_dias / crearDiaCronograma / obtenerClasesEfectivasSemana en
// schema.js) — este modal ahora edita únicamente la plantilla base del
// bloque, siempre para todas las semanas. La edición puntual de un día
// específico (solo modalidad) vive en la sección Cronograma aparte.

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

  const campos = {
    materiaId: estadoForm.materiaId,
    planEstudioId: estadoForm.materiaId ? estadoForm.planEstudioId : null,
    nombre: estadoForm.materiaId ? null : nombrePersonalizado,
    apodo: apodo || null,
    grupo: grupo || null,
    dias: diasValidos,
    modalidad: estadoForm.modalidad,
    aula: aula || null,
    profesorId: estadoForm.profesorId,
    enlace: enlace || null,
    notas: notas || null,
    color: estadoForm.color || null,
  };

  const finalizar = () => {
    sellarTimestamp(semestre);
    marcarCambioPendiente();
    cerrarModalBloqueHorario();
    window.renderizarHorario?.();
    // Bug modalidad → Agenda no actualiza: la Agenda deriva su vista de
    // clases de estos mismos bloques (modalidad incluida), así que si
    // queda montada en el DOM (aunque no sea la sección activa en este
    // momento) se quedaba con datos viejos hasta que la persona salía y
    // volvía a entrar manualmente a Agenda. Se refresca acá también, igual
    // que ya se hace al cambiar de sección en main.js.
    window.renderizarAgenda?.();
  };

  if (!bloque) {
    // Creación: al copiarse automáticamente todas las semanas (una sola
    // plantilla base recurrente), no hay nada que "elegir esta semana"
    // todavía — siempre aplica a todas por igual desde el primer momento.
    const nuevo = crearBloqueHorario(campos);
    semestre.bloques_horario = semestre.bloques_horario || [];
    semestre.bloques_horario.push(nuevo);
    finalizar();
    return;
  }

  // Siempre edita la plantilla base (todas las semanas) — la edición
  // puntual de un día específico vive en la sección Cronograma aparte.
  bloque.materia_id = campos.materiaId;
  bloque.plan_estudio_id = campos.planEstudioId;
  bloque.nombre = campos.nombre;
  bloque.apodo = campos.apodo;
  bloque.grupo = campos.grupo;
  bloque.dias = campos.dias;
  bloque.modalidad = campos.modalidad;
  bloque.aula = campos.aula;
  bloque.profesor_id = campos.profesorId;
  bloque.enlace = campos.enlace;
  bloque.notas = campos.notas;
  bloque.color = campos.color;

  sellarTimestamp(bloque);
  finalizar();
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

export { abrirModalBloqueHorario, cerrarModalBloqueHorario, construirZonaCronograma };
