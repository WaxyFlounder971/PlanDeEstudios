/* =========================================================================
   SEMESTRES — PROYECTAR Y SEMESTRES PLANEADOS
   Lo que se agrega a la tarjeta del semestre actual y a los semestres
   futuros (ver semestres-tarjetas.js, construirTarjetaSemestre):
     · botón "Proyectar" al final de las materias del semestre actual
     · vista Proyectar: cada materia con botones Aprobada / Reprobada
       (simulación: NUNCA se guarda ni toca materia.estado ni mm.resultado)
     · "Materias desbloqueadas" cuando todas las materias están marcadas
     · "Armar semestre futuro": elegir entre TODAS las disponibles y guardar
       un semestre planeado (semestre.planeado = true, ver schema.js)
     · cuerpo de un semestre planeado (materias sin nota ni "Cursando",
       Editar / Eliminar)
   La lógica de requisitos vive en plan/plan-proyeccion.js (pura, con
   pruebas en tests/plan-proyeccion-logica.mjs) y reutiliza las mismas
   reglas que la luz de disponibilidad del plan.
   Estado de UI en `estado.proyectarSemestre` (no se guarda). Las notas no
   aparecen en ningún lado de esta función. Todo el DOM se arma con
   createElement/textContent y los textos pasan por traducirTextoInterfaz.
   ========================================================================= */

import {
  crearMateriaMatriculada,
  crearSemestre,
  obtenerEstadoEfectivoMateria,
  obtenerEstadoEfectivoSemestre,
  sellarTimestamp,
} from "../core/schema.js";
import { obtenerIdiomaActual, traducirTextoInterfaz } from "../core/i18n.js";
import { marcarCambioPendiente } from "../core/storage/storage-sync.js";
import { estado } from "../core/storage/storage.js";
import { aplicarFormatoTexto } from "../core/utils.js";
import { mostrarToast } from "../ui/componentes.js";
import {
  MESES_EN,
  MESES_ES,
  calcularDesbloqueo,
  clasificarCreditos,
  crearContexto,
  crearPeriodosPorDefecto,
  fechaISO,
  generarPeriodos,
  normalizarPeriodos,
  semanasDelPeriodo,
  siguientePeriodoLibre,
} from "../plan/plan-proyeccion.js";

/* ===================== Utilidades ===================== */

const t = (es, en) => traducirTextoInterfaz(es, en);
const esIngles = () => obtenerIdiomaActual() === "en";

function el(etiqueta, clase, texto) {
  const nodo = document.createElement(etiqueta);
  if (clase) nodo.className = clase;
  if (texto !== undefined) nodo.textContent = texto;
  return nodo;
}

function boton(clase, texto, alClick) {
  const b = el("button", clase, texto);
  b.type = "button";
  b.addEventListener("click", alClick);
  return b;
}

function fmtFecha(fecha) {
  const mes = esIngles() ? MESES_EN[fecha.getMonth()] : MESES_ES[fecha.getMonth()];
  return esIngles() ? `${mes} ${fecha.getDate()}, ${fecha.getFullYear()}` : `${fecha.getDate()} de ${mes} de ${fecha.getFullYear()}`;
}

const claveMateria = (planId, codigo) => `${planId}::${codigo}`;

/** Estado de UI: un solo semestre a la vez está en Proyectar (o editándose). */
function estadoUI() {
  return estado.proyectarSemestre || null;
}

function estaProyectando(semestreId) {
  const st = estadoUI();
  return !!st && st.semestreId === semestreId;
}

function salir(onCambiar) {
  estado.proyectarSemestre = null;
  onCambiar();
}

function semestreVivo(semestreId) {
  return (estado.datos.semestres || []).find((s) => s.id === semestreId) || null;
}

/* ===================== Datos del plan ===================== */

/** Filas {mm, plan, materia} del semestre, en el orden del plan de estudios. */
function filasDelSemestre(semestre, obtenerPlanPorId) {
  return (semestre.materias_matriculadas || [])
    .map((mm) => {
      const plan = obtenerPlanPorId(mm.plan_estudio_id);
      const indice = plan ? (plan.materias || []).findIndex((m) => m.id === mm.materia_id) : -1;
      return { mm, plan, materia: indice === -1 ? null : plan.materias[indice], indice };
    })
    .filter((f) => f.plan && f.materia)
    .sort((a, b) => a.indice - b.indice);
}

function colorMateria(plan, materia) {
  const categoria = (plan.categorias || []).find((c) => c.id === materia.categoria_id);
  return categoria && categoria.color ? categoria.color : "var(--text-muted)";
}

/** Códigos ya planeados en OTROS semestres futuros (no se ofrecen de nuevo). */
function codigosPlaneadosEnOtros(planId, semestreId) {
  const codigos = new Set();
  (estado.datos.semestres || []).forEach((s) => {
    if (s.id === semestreId || obtenerEstadoEfectivoSemestre(s) !== "futuro") return;
    (s.materias_matriculadas || []).forEach((mm) => {
      if (mm.plan_estudio_id !== planId) return;
      const plan = (estado.datos.planes_estudio || []).find((p) => p.id === planId);
      const m = plan && (plan.materias || []).find((x) => x.id === mm.materia_id);
      if (m) codigos.add(m.codigo);
    });
  });
  return codigos;
}

function estadosReales(plan, ctx) {
  const aprobadas = new Set();
  const cursando = new Set();
  ctx.materias.forEach((m) => {
    const efectivo = obtenerEstadoEfectivoMateria(m, plan.id, estado.datos);
    if (efectivo === "aprobado") aprobadas.add(m.codigo);
    else if (efectivo === "cursando") cursando.add(m.codigo);
  });
  return { aprobadas, cursando };
}

/** Períodos que configuró la persona en Estadísticas → Proyección (o los de ejemplo si nunca los definió). */
function periodosConfigurados(planes) {
  for (const plan of planes) {
    const guardado = (plan.parametros_universidad || {}).proyeccion_periodos;
    if (Array.isArray(guardado)) return { periodos: normalizarPeriodos(guardado), deEjemplo: false };
  }
  return { periodos: crearPeriodosPorDefecto(), deEjemplo: true };
}

function planesDeLasFilas(filas) {
  const vistos = new Map();
  filas.forEach((f) => vistos.set(f.plan.id, f.plan));
  return [...vistos.values()];
}

/* ===================== Tarjetas de materia ===================== */

/**
 * Tarjeta igual a la de la app (línea de color a la izquierda, código pequeño
 * y nombre en negrita). `derecha` va al final de la línea (p. ej. créditos).
 */
function tarjetaMateria(plan, materia, derecha) {
  const card = el("div", "glass-panel materia-card sp-card");
  card.style.boxShadow = `inset 6px 0 0 0 ${colorMateria(plan, materia)}`;
  const fila = el("div", "materia-fila-principal sp-fila");
  const linea = el("div", "materia-linea1");
  linea.style.alignItems = "center";
  const prefijo = el("span", "materia-prefijo");
  const codigo = el("span", "materia-codigo", materia.codigo);
  codigo.style.cursor = "default";
  prefijo.appendChild(codigo);
  linea.appendChild(prefijo);
  const nombre = el("span", "materia-nombre completa", aplicarFormatoTexto(materia.nombre));
  linea.appendChild(nombre);
  if (derecha) linea.appendChild(derecha);
  fila.appendChild(linea);
  card.appendChild(fila);
  card.__fila = fila;
  return card;
}

const badgeCreditos = (materia) => el("span", "badge badge-accent", t(`Créditos: ${Number(materia.creditos) || 0}`, `Credits: ${Number(materia.creditos) || 0}`));

/* ===================== Botón Proyectar ===================== */

/** Solo en el semestre actual y solo si tiene al menos una materia cursando. */
function construirBotonProyectar(semestre, obtenerPlanPorId, onCambiar) {
  if (obtenerEstadoEfectivoSemestre(semestre) !== "actual") return null;
  if (filasDelSemestre(semestre, obtenerPlanPorId).length === 0) return null;
  const b = boton("glass-panel sp-boton-centro", t("Proyectar", "Project"), (ev) => {
    ev.stopPropagation();
    const filas = filasDelSemestre(semestre, obtenerPlanPorId);
    // Materias que ya tienen resultado real salen premarcadas.
    const marcas = {};
    filas.forEach((f) => {
      if (f.mm.resultado === "aprobada" || f.mm.resultado === "reprobada") marcas[f.mm.id] = f.mm.resultado;
    });
    estado.proyectarSemestre = { semestreId: semestre.id, modo: "proyectar", marcas, armando: false, seleccion: new Set(), nombre: null };
    onCambiar();
  });
  return b;
}

/* ===================== Vista Proyectar ===================== */

function construirVistaProyectar(semestre, obtenerPlanPorId, onCambiar) {
  const cuerpo = el("div", "sp-vista");
  const filas = filasDelSemestre(semestre, obtenerPlanPorId);
  const st = estadoUI();

  function pintar() {
    cuerpo.textContent = "";
    const lista = el("div", "sp-lista");
    filas.forEach((f) => {
      const card = tarjetaMateria(f.plan, f.materia, null);
      const botones = el("div", "sp-botones");
      [["aprobada", t("Aprobada", "Passed")], ["reprobada", t("Reprobada", "Failed")]].forEach(([valor, texto]) => {
        const activo = st.marcas[f.mm.id] === valor;
        const b = boton(`sp-btn ${valor}${activo ? " on" : ""}`, texto, () => {
          if (st.marcas[f.mm.id] === valor) delete st.marcas[f.mm.id];
          else st.marcas[f.mm.id] = valor;
          pintar();
        });
        b.setAttribute("aria-pressed", activo ? "true" : "false");
        botones.appendChild(b);
      });
      card.__fila.appendChild(botones);
      lista.appendChild(card);
    });
    cuerpo.appendChild(lista);

    const todasMarcadas = filas.length > 0 && filas.every((f) => st.marcas[f.mm.id]);
    if (todasMarcadas) cuerpo.appendChild(construirResultado(semestre, filas, st, obtenerPlanPorId, onCambiar, pintar));

    const volver = boton("glass-panel sp-boton-centro", t("Volver", "Back"), () => salir(onCambiar));
    cuerpo.appendChild(volver);
  }

  pintar();
  return cuerpo;
}

/** Calcula, por plan, lo desbloqueado según las marcas de la simulación. */
function calcularGrupos(semestre, filas, st) {
  return planesDeLasFilas(filas).map((plan) => {
    const ctx = crearContexto(plan.materias || []);
    const { aprobadas, cursando } = estadosReales(plan, ctx);
    const simA = new Set();
    const simR = new Set();
    filas.filter((f) => f.plan.id === plan.id).forEach((f) => {
      if (st.marcas[f.mm.id] === "aprobada") simA.add(f.materia.codigo);
      else if (st.marcas[f.mm.id] === "reprobada") simR.add(f.materia.codigo);
    });
    return { plan, ctx, ...calcularDesbloqueo(ctx, aprobadas, cursando, simA, simR, codigosPlaneadosEnOtros(plan.id, semestre.id)) };
  });
}

function construirResultado(semestre, filas, st, obtenerPlanPorId, onCambiar, repintarVista) {
  const caja = el("div", "sp-resultado");
  const grupos = calcularGrupos(semestre, filas, st);

  caja.appendChild(el("h4", "sp-titulo", t("Materias desbloqueadas:", "Unlocked courses:")));
  const lista = el("div", "sp-lista");
  let total = 0;
  grupos.forEach((g) =>
    g.nuevas.forEach((m) => {
      total += 1;
      lista.appendChild(tarjetaMateria(g.plan, m, badgeCreditos(m)));
    })
  );
  if (total === 0) caja.appendChild(el("p", "muted", t("Ninguna materia nueva se desbloquea.", "No new courses are unlocked.")));
  else caja.appendChild(lista);

  const hayParaArmar = grupos.some((g) => g.seleccionables.length > 0);
  if (!st.armando) {
    const b = boton("btn btn-primary sp-boton-armar", t("Armar semestre futuro", "Build a future semester"), () => {
      st.armando = true;
      st.seleccion = new Set();
      repintarVista();
    });
    caja.appendChild(b);
  } else {
    caja.appendChild(construirSeleccion({
      semestre,
      grupos,
      planes: grupos.map((g) => g.plan),
      st,
      edicion: null,
      hayParaArmar,
      onGuardado: () => salir(onCambiar),
      onCancelar: () => {
        st.armando = false;
        repintarVista();
      },
    }));
  }
  return caja;
}

/* ===================== Selección de materias (armar / editar) ===================== */

/**
 * Panel de selección: contador de créditos con color según el rango, nombre
 * editable del período, una tarjeta por materia (se elige tocándola) y
 * "Guardar semestre planeado". `edicion` = semestre planeado que se edita.
 */
function construirSeleccion({ semestre, grupos, planes, st, edicion, hayParaArmar, onGuardado, onCancelar }) {
  const panel = el("div", "sp-seleccion");

  // Período: el siguiente libre de los configurados (o el del semestre que se edita).
  const { periodos, deEjemplo } = periodosConfigurados(planes);
  let periodo = null;
  if (edicion) {
    periodo = generarPeriodos(periodos, new Date(), true).find((p) => fechaISO(p.start) === edicion.fecha_inicio) || null;
  } else {
    const ocupados = new Set(
      (estado.datos.semestres || []).filter((s) => obtenerEstadoEfectivoSemestre(s) === "futuro").map((s) => s.fecha_inicio)
    );
    periodo = siguientePeriodoLibre(generarPeriodos(periodos, new Date()), ocupados);
  }

  // Opciones: todas las disponibles (+ las ya guardadas si se edita).
  const opciones = [];
  grupos.forEach((g) => {
    g.seleccionables.forEach((x) => opciones.push({ plan: g.plan, materia: x.materia, etiqueta: x.etiqueta, orden: g.ctx.orden.get(x.materia.codigo) }));
  });
  if (edicion) {
    filasGuardadas(edicion).forEach((f) => {
      if (!opciones.some((o) => o.plan.id === f.plan.id && o.materia.codigo === f.materia.codigo)) {
        opciones.push({ plan: f.plan, materia: f.materia, etiqueta: "disponible", orden: f.indice });
      }
    });
  }
  opciones.sort((a, b) => (a.plan.id === b.plan.id ? a.orden - b.orden : 0));

  // Lo elegido que ya no es una opción válida (porque cambiaron las marcas) se descarta.
  const validas = new Set(opciones.map((o) => claveMateria(o.plan.id, o.materia.codigo)));
  st.seleccion = new Set([...st.seleccion].filter((k) => validas.has(k)));

  const cab = el("div", "sp-sel-cab");
  cab.appendChild(el("h4", "sp-titulo", edicion ? t("Editar semestre planeado", "Edit planned semester") : t("Armar semestre futuro", "Build a future semester")));
  const contador = el("div", "sp-contador");
  cab.appendChild(contador);
  panel.appendChild(cab);

  if (!periodo) {
    panel.appendChild(el("p", "muted", t("No hay un período libre para planear.", "There is no free period to plan.")));
  } else {
    const campo = el("div", "sp-campo");
    campo.appendChild(el("label", "form-label", t("Nombre del semestre", "Semester name")));
    const entrada = el("input", "form-input");
    entrada.type = "text";
    entrada.value = st.nombre != null ? st.nombre : edicion ? edicion.nombre : periodo.nombre;
    entrada.maxLength = 60;
    entrada.addEventListener("input", () => {
      st.nombre = entrada.value;
    });
    campo.appendChild(entrada);
    campo.appendChild(el("small", "muted", `${fmtFecha(periodo.start)} – ${fmtFecha(periodo.end)}`));
    if (deEjemplo) {
      campo.appendChild(el("small", "muted", t("Períodos de ejemplo: defínelos en Plan de estudios → Estadísticas → Proyección.", "Sample periods: set yours in Study plan → Statistics → Projection.")));
    }
    panel.appendChild(campo);
  }

  const lista = el("div", "sp-lista");
  const tarjetas = [];
  if (opciones.length === 0) {
    panel.appendChild(el("p", "muted", hayParaArmar || edicion ? t("No hay materias disponibles.", "No courses available.") : t("No hay materias disponibles para armar un semestre.", "There are no courses available to build a semester.")));
  }
  opciones.forEach((o) => {
    const clave = claveMateria(o.plan.id, o.materia.codigo);
    const derecha = el("span", "sp-derecha");
    if (o.etiqueta === "repetir") derecha.appendChild(el("span", "badge badge-danger", t("Repetir", "Retake")));
    derecha.appendChild(badgeCreditos(o.materia));
    const card = tarjetaMateria(o.plan, o.materia, derecha);
    card.classList.add("sp-elegible");
    const luz = el("span", "sp-luz");
    luz.setAttribute("aria-hidden", "true");
    card.__fila.firstChild.insertBefore(luz, card.__fila.firstChild.firstChild);
    card.setAttribute("role", "checkbox");
    card.tabIndex = 0;
    const color = colorMateria(o.plan, o.materia);
    const pintarSel = () => {
      const on = st.seleccion.has(clave);
      card.classList.toggle("on", on);
      luz.classList.toggle("on", on);
      card.setAttribute("aria-checked", on ? "true" : "false");
      card.style.boxShadow = on ? `inset 6px 0 0 0 ${color}, 0 0 0 3px var(--accent-1-10)` : `inset 6px 0 0 0 ${color}`;
    };
    const alternar = () => {
      if (st.seleccion.has(clave)) st.seleccion.delete(clave);
      else st.seleccion.add(clave);
      pintarSel();
      actualizar();
    };
    card.addEventListener("click", alternar);
    card.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        alternar();
      }
    });
    pintarSel();
    tarjetas.push(card);
    lista.appendChild(card);
  });
  if (opciones.length) panel.appendChild(lista);

  const acciones = el("div", "sp-acciones");
  const guardar = boton("btn btn-primary", edicion ? t("Guardar cambios", "Save changes") : t("Guardar semestre planeado", "Save planned semester"), () => {
    if (!periodo || st.seleccion.size === 0) return;
    const nombre = (st.nombre != null ? st.nombre : edicion ? edicion.nombre : periodo.nombre).trim() || periodo.nombre;
    const elegidas = opciones.filter((o) => st.seleccion.has(claveMateria(o.plan.id, o.materia.codigo)));
    if (edicion) guardarEdicionPlaneado(edicion.id, nombre, elegidas);
    else guardarNuevoPlaneado(nombre, periodo, elegidas);
    mostrarToast(t("Semestre planeado guardado", "Planned semester saved"));
    onGuardado();
  });
  const cancelar = boton("btn btn-secondary", t("Cancelar", "Cancel"), onCancelar);
  acciones.append(guardar, cancelar);
  panel.appendChild(acciones);

  function actualizar() {
    const creditos = opciones
      .filter((o) => st.seleccion.has(claveMateria(o.plan.id, o.materia.codigo)))
      .reduce((s, o) => s + (Number(o.materia.creditos) || 0), 0);
    const clase = clasificarCreditos(creditos, periodo);
    const texto = !periodo
      ? ""
      : clase === "ok"
      ? t("dentro de tu rango", "within your range")
      : clase === "warn"
      ? t("fuera de tu rango deseado", "outside your preferred range")
      : creditos > periodo.lim
      ? t("sobre el máximo permitido", "above the allowed maximum")
      : t("bajo el mínimo permitido", "below the allowed minimum");
    contador.textContent = "";
    contador.appendChild(el("span", `badge ${clase === "ok" ? "badge-success" : clase === "warn" ? "badge-warning" : "badge-danger"}`, t(`Créditos: ${creditos}`, `Credits: ${creditos}`)));
    if (texto) contador.appendChild(el("small", "muted", texto));
    guardar.disabled = st.seleccion.size === 0 || !periodo;
  }
  actualizar();
  return panel;
}

/* ===================== Guardado ===================== */

function filasGuardadas(semestre) {
  const planes = estado.datos.planes_estudio || [];
  return (semestre.materias_matriculadas || [])
    .map((mm) => {
      const plan = planes.find((p) => p.id === mm.plan_estudio_id);
      const indice = plan ? (plan.materias || []).findIndex((m) => m.id === mm.materia_id) : -1;
      return { mm, plan, materia: indice === -1 ? null : plan.materias[indice], indice };
    })
    .filter((f) => f.plan && f.materia);
}

/** Crea el semestre planeado (solo esto se guarda; las marcas nunca). */
function guardarNuevoPlaneado(nombre, periodo, elegidas) {
  const planesIds = [...new Set(elegidas.map((o) => o.plan.id))];
  const semestre = crearSemestre({
    nombre,
    fecha_inicio: fechaISO(periodo.start),
    duracion_semanas: semanasDelPeriodo(periodo),
    planesEstudioIds: planesIds,
  });
  semestre.planeado = true;
  elegidas.forEach((o) => semestre.materias_matriculadas.push(crearMateriaMatriculada({ materiaId: o.materia.id, planEstudioId: o.plan.id })));
  estado.datos.semestres = estado.datos.semestres || [];
  estado.datos.semestres.push(semestre);
  if (estado.semestresExpandidos) estado.semestresExpandidos.set(semestre.id, true);
  marcarCambioPendiente();
}

/**
 * Edita un semestre planeado reconciliando la matrícula (igual que
 * guardarEdicionSemestre en semestres.js): lo que sigue conserva su id, lo
 * que se quita se borra con tumba y lo nuevo se agrega.
 */
function guardarEdicionPlaneado(semestreId, nombre, elegidas) {
  const semestre = semestreVivo(semestreId);
  if (!semestre) return;
  semestre.nombre = nombre;
  semestre.plan_estudio_id = [...new Set(elegidas.map((o) => o.plan.id))];
  const nuevas = new Set(elegidas.map((o) => `${o.plan.id}::${o.materia.id}`));
  const existentes = new Set();
  semestre.materias_matriculadas = (semestre.materias_matriculadas || []).filter((mm) => {
    const clave = `${mm.plan_estudio_id}::${mm.materia_id}`;
    existentes.add(clave);
    if (nuevas.has(clave)) return true;
    semestre._eliminados_materias_matriculadas = semestre._eliminados_materias_matriculadas || [];
    semestre._eliminados_materias_matriculadas.push({ id: mm.id, eliminadoEn: Date.now() });
    return false;
  });
  elegidas.forEach((o) => {
    if (!existentes.has(`${o.plan.id}::${o.materia.id}`)) {
      semestre.materias_matriculadas.push(crearMateriaMatriculada({ materiaId: o.materia.id, planEstudioId: o.plan.id }));
    }
  });
  sellarTimestamp(semestre);
  marcarCambioPendiente();
}

/* ===================== Semestre planeado (tarjeta del futuro) ===================== */

/** Abre la edición de un semestre planeado (desde su botón Editar o desde el modo "Editar semestres"). */
function iniciarEdicionPlaneado(semestre, onCambiar) {
  estado.proyectarSemestre = { semestreId: semestre.id, modo: "editar", marcas: {}, armando: true, seleccion: new Set(), nombre: null };
  if (estado.semestresExpandidos) estado.semestresExpandidos.set(semestre.id, true);
  const st = estadoUI();
  filasGuardadas(semestre).forEach((f) => st.seleccion.add(claveMateria(f.plan.id, f.materia.codigo)));
  onCambiar();
}

/** Cuerpo expandido de un semestre planeado: materias sin nota ni "Cursando", más Editar / Eliminar. */
function construirCuerpoPlaneado(semestre, obtenerPlanPorId, onCambiar, onBorrar) {
  const cuerpo = el("div", "sp-vista");
  const st = estadoUI();

  if (st && st.semestreId === semestre.id && st.modo === "editar") {
    const planes = (semestre.plan_estudio_id || []).map((id) => obtenerPlanPorId(id)).filter(Boolean);
    const grupos = planes.map((plan) => {
      const ctx = crearContexto(plan.materias || []);
      const { aprobadas, cursando } = estadosReales(plan, ctx);
      // Se planea suponiendo que lo que se cursa ahora se aprueba (igual que la pestaña Proyección).
      return { plan, ctx, ...calcularDesbloqueo(ctx, aprobadas, cursando, cursando, new Set(), codigosPlaneadosEnOtros(plan.id, semestre.id)) };
    });
    cuerpo.appendChild(
      construirSeleccion({
        semestre,
        grupos,
        planes,
        st,
        edicion: semestre,
        hayParaArmar: true,
        onGuardado: () => salir(onCambiar),
        onCancelar: () => salir(onCambiar),
      })
    );
    return cuerpo;
  }

  const filas = filasDelSemestre(semestre, obtenerPlanPorId);
  if (filas.length === 0) {
    cuerpo.appendChild(el("p", "muted", t("Este semestre todavía no tiene materias.", "This semester has no courses yet.")));
  } else {
    const lista = el("div", "sp-lista");
    filas.forEach((f) => lista.appendChild(tarjetaMateria(f.plan, f.materia, badgeCreditos(f.materia))));
    cuerpo.appendChild(lista);
  }
  const acciones = el("div", "sp-acciones");
  acciones.append(
    boton("btn btn-secondary", t("Editar", "Edit"), (ev) => {
      ev.stopPropagation();
      iniciarEdicionPlaneado(semestre, onCambiar);
    }),
    boton("btn btn-secondary", t("Eliminar", "Delete"), (ev) => {
      ev.stopPropagation();
      onBorrar(semestre);
    })
  );
  cuerpo.appendChild(acciones);
  return cuerpo;
}

/** Badge "Planeado" que se muestra bajo el nombre del semestre. */
function construirBadgePlaneado() {
  return el("span", "badge badge-info sp-badge-planeado", t("Planeado", "Planned"));
}

export {
  construirBadgePlaneado,
  construirBotonProyectar,
  construirCuerpoPlaneado,
  construirVistaProyectar,
  estaProyectando,
  iniciarEdicionPlaneado,
};
