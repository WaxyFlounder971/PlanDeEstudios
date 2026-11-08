/* =========================================================================
   DEMO — datos RELATIVOS A HOY (fix10)
   El dataset (demo/datos-demo.json) tiene fechas fijas de septiembre–octubre, así que con el paso del
   tiempo Agenda, Tiempo de estudio y Finanzas se veían vacíos. Esto agrega, al abrir la demo, datos
   alrededor de la fecha actual para que cada sección tenga algo que ver: tareas, exámenes y eventos
   pasados y próximos, sesiones de estudio de los últimos días, movimientos recientes y mensajes
   semanales en la competencia. Solo suma datos (ids "demo-rel-*"); nunca borra ni cambia los existentes.
   ========================================================================= */

const DIA_MS = 86400000;

function iso(fecha) {
  const p = (n) => String(n).padStart(2, "0");
  return `${fecha.getFullYear()}-${p(fecha.getMonth() + 1)}-${p(fecha.getDate())}`;
}

function fechaRelativa(hoy, dias) {
  return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() + dias, 12, 0, 0, 0);
}

const TIPOS = {
  tarea: { nombre: "Tarea", color: "#3b82f6" },
  examen: { nombre: "Examen", color: "#ef4444" },
  evento: { nombre: "Evento", color: "#06b6d4" },
};

// [días desde hoy, tipo, título, materia, hora, completada]
const AGENDA = [
  [-6, "tarea", "Resumen del capítulo 4", "mm-cp2001", "10:00", true],
  [-5, "examen", "Quiz de cálculo", "mm-cp2002", "08:00", true],
  [-4, "tarea", "Laboratorio de programación", "mm-cp2003", "14:00", true],
  [-3, "evento", "Charla de orientación vocacional", "mm-ati100", "13:00", false],
  [-2, "tarea", "Entrega de reporte (se pasó la fecha)", "mm-cp2004", "23:00", false],
  [-1, "tarea", "Ejercicios de práctica", "mm-cp2001", "16:00", true],
  [0, "tarea", "Preparar exposición", "mm-cp2002", "15:00", false],
  [0, "evento", "Reunión del grupo de estudio", "mm-cp2003", "18:00", false],
  [1, "examen", "Examen parcial I", "mm-cp2001", "09:00", false],
  [2, "tarea", "Informe de laboratorio", "mm-cp2005", "20:00", false],
  [3, "evento", "Feria de empleo universitaria", "mm-ati120", "10:00", false],
  [4, "tarea", "Lectura asignada", "mm-opt1019", "19:00", false],
  [6, "examen", "Examen corto de redes", "mm-cp2003", "07:30", false],
  [7, "tarea", "Proyecto: avance 2", "mm-cp2004", "23:30", false],
  [9, "evento", "Tutoría con profesor", "mm-cp2002", "11:00", false],
  [11, "examen", "Examen parcial II", "mm-cp2002", "13:00", false],
  [14, "tarea", "Presentación final: borrador", "mm-cp2005", "17:00", false],
  [18, "evento", "Entrega de notas del parcial", "mm-ati100", "12:00", false],
];

function agregarAgenda(datos, hoy) {
  if (!Array.isArray(datos.agenda)) datos.agenda = [];
  const semestre = (datos.semestres || []).find((s) => s.id === "sem-demo-actual") || (datos.semestres || [])[0];
  AGENDA.forEach(([dias, tipo, titulo, materia, hora, completada], i) => {
    const t = TIPOS[tipo];
    const perdida = !completada && dias < 0;
    datos.agenda.push({
      id: `demo-rel-ag-${i + 1}`,
      tipo,
      tipo_etiqueta_id: tipo,
      tipo_etiqueta_nombre: t.nombre,
      tipo_etiqueta_color: t.color,
      nombre: titulo,
      fecha: iso(fechaRelativa(hoy, dias)),
      hora,
      materia_matriculada_id: materia,
      semestre_id: semestre ? semestre.id : null,
      notas: "Dato de ejemplo de la demo.",
      completada,
      perdida,
      es_feriado: false,
    });
  });
}

function agregarSesiones(datos, hoy) {
  if (!Array.isArray(datos.sesiones_estudio)) datos.sesiones_estudio = [];
  const materias = ["mm-cp2001", "mm-cp2002", "mm-cp2003", "mm-cp2004", "mm-cp2005"];
  let n = 0;
  for (let d = -9; d <= 0; d++) {
    // 1–2 sesiones por día, más largas entre semana; el domingo queda libre (se ve la racha con un hueco real).
    const base = fechaRelativa(hoy, d);
    if (base.getDay() === 0) continue;
    const cantidad = d % 3 === 0 ? 2 : 1;
    for (let k = 0; k < cantidad; k++) {
      const minutos = 45 + ((n * 25) % 90);
      const inicio = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 8 + k * 6 + (n % 3), 0, 0, 0).getTime();
      if (inicio > Date.now()) continue;
      datos.sesiones_estudio.push({
        id: `demo-rel-ses-${++n}`,
        materia_matriculada_id: materias[n % materias.length],
        inicio,
        fin: inicio + minutos * 60000,
        duracion_minutos: minutos,
        origen: n % 4 === 0 ? "pomodoro" : "manual",
      });
    }
  }
}

function agregarMovimientos(datos, hoy) {
  if (!Array.isArray(datos.movimientos) || !datos.movimientos.length) return;
  const molde = datos.movimientos.find((m) => m.tipo === "gasto") || datos.movimientos[0];
  const cuentas = (datos.cuentas || []).filter((c) => !c.archivada).map((c) => c.id);
  const cuentaA = cuentas[0] || molde.cuenta_id;
  const cuentaB = cuentas[1] || cuentaA;
  const lista = [
    [-0, "gasto", "Café y empanada", 2900, cuentaB],
    [-1, "gasto", "Pasaje de bus", 1200, cuentaB],
    [-2, "gasto", "Fotocopias del curso", 3500, cuentaB],
    [-3, "ingreso", "Tutoría de matemática", 15000, cuentaA],
    [-4, "gasto", "Almuerzo con el grupo", 5600, cuentaA],
    [-6, "gasto", "Recarga del teléfono", 5000, cuentaA],
    [-8, "gasto", "Libro de apoyo", 18900, cuentaA],
    [-10, "ingreso", "Apoyo familiar", 30000, cuentaA],
  ];
  lista.forEach(([dias, tipo, nombre, monto, cuenta], i) => {
    datos.movimientos.push({
      ...molde,
      id: `demo-rel-mov-${i + 1}`,
      tipo,
      nombre,
      monto,
      fecha_registro: iso(fechaRelativa(hoy, dias)),
      nota: "",
      categoria_id: tipo === "ingreso" ? ((datos.categorias_finanzas || []).find((c) => c.tipo === "ingreso") || {}).id || molde.categoria_id : molde.categoria_id,
      cuenta_id: cuenta,
      origen: "manual",
    });
  });
}

function agregarMensajesCompetencia(datos) {
  const frases = ["¡Esta semana la gano!", "Vamos por el podio", "Café + estudio", "A no rendirse", "Última semana de parciales"];
  (datos.competencias_demo || []).forEach((comp) => {
    (comp.participantes || []).forEach((p, i) => {
      if (!p.mensaje && i < frases.length) p.mensaje = frases[(i + comp.nombre.length) % frases.length];
    });
  });
}

/** Punto de entrada: lo llama cargarDatosDemo() justo antes de migrar los datos. */
function agregarDatosRelativosDemo(datos, hoy = new Date()) {
  if (!datos || typeof datos !== "object") return datos;
  try {
    agregarAgenda(datos, hoy);
    agregarSesiones(datos, hoy);
    agregarMovimientos(datos, hoy);
    agregarMensajesCompetencia(datos);
  } catch (error) {
    console.warn("Demo: no se pudieron agregar los datos relativos a hoy.", error);
  }
  return datos;
}

export { agregarDatosRelativosDemo };
