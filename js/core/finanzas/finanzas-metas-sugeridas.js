/* =========================================================================
   FINANZAS 2.0: Metas sugeridas de 3 meses (sesión 8). Lógica pura sin DOM.
   Ideas para empezar con una meta pequeña y de corto plazo. Solo rellenan el formulario:
   la persona edita todo y nada se crea hasta que guarda. Ninguna depende de un país ni de una moneda.
   ========================================================================= */

const MESES_SUGERIDOS = 3;

const SUGERENCIAS_META = [
  { id: "emergencia", nombre: "Fondo de emergencia", emoji: "🛟" },
  { id: "estudio", nombre: "Materiales de estudio", emoji: "📚" },
  { id: "paseo", nombre: "Un paseo", emoji: "🧳" },
  { id: "regalo", nombre: "Un regalo", emoji: "🎁" },
];

const esIso = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x || ""));

/** Suma meses a una fecha ISO. Si el día no existe en el mes de llegada (31 de enero + 1), usa el último día de ese mes. */
function fechaEnMeses(iso, meses = MESES_SUGERIDOS) {
  if (!esIso(iso)) return null;
  const [a, m, d] = iso.split("-").map(Number);
  const destino = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(destino.getUTCFullYear(), destino.getUTCMonth() + 1, 0)).getUTCDate();
  destino.setUTCDate(Math.min(d, ultimo));
  return destino.toISOString().slice(0, 10);
}

/** Sugerencias con su fecha objetivo ya calculada a 3 meses desde `hoy`, sin las que la persona ya tiene activas con ese nombre. */
function sugerirMetas(datos, hoy) {
  const usados = new Set((datos.metas || []).filter((m) => !m.archivada).map((m) => String(m.nombre || "").trim().toLowerCase()));
  const fecha = fechaEnMeses(hoy, MESES_SUGERIDOS);
  return SUGERENCIAS_META.filter((s) => !usados.has(s.nombre.toLowerCase())).map((s) => ({ ...s, fechaObjetivo: fecha }));
}

export { MESES_SUGERIDOS, SUGERENCIAS_META, fechaEnMeses, sugerirMetas };
