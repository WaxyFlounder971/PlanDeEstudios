/* =========================================================================
   FINANZAS 2.0 — Perfiles y módulos (etapa 0C)
   Lógica pura, sin DOM: qué módulos enciende cada perfil, qué pestañas se
   ven con los módulos actuales y cuándo ofrecer el onboarding. Apagar un
   módulo solo oculta (ver finanzas-derivados.js); nunca borra datos.
   ========================================================================= */

import { sellarTimestamp } from "./schema.js";
import { MODULOS_FINANZAS_DEFAULT } from "./finanzas-modelo.js";
import { obtenerModulosFinanzas } from "./finanzas-derivados.js";

/** Los 4 módulos, en el orden en que se muestran. `detalle` es la frase corta bajo el interruptor. */
const MODULOS_INFO = [
  { id: "matricula", etiqueta: "Matrícula", detalle: "Pagos de matrícula por semestre" },
  { id: "beca", etiqueta: "Beca", detalle: "Ingresos de beca por semestre" },
  { id: "gastos", etiqueta: "Gastos e ingresos", detalle: "Tu día a día: lo que gastas y lo que entra" },
  { id: "ahorros", etiqueta: "Ahorros", detalle: "Metas con anillo y transferencias" },
];

/** Perfiles del onboarding. Cada uno solo decide qué módulos quedan encendidos. */
const PERFILES_FINANZAS = [
  { id: "ahorro", emoji: "🎯", etiqueta: "Solo ahorro", detalle: "Metas y cuánto llevas en cada una", modulos: { matricula: false, beca: false, gastos: false, ahorros: true } },
  { id: "universidad", emoji: "🎓", etiqueta: "Solo universidad", detalle: "Matrícula y beca por semestre", modulos: { matricula: true, beca: true, gastos: false, ahorros: false } },
  { id: "gastos", emoji: "🧾", etiqueta: "Gastos e ingresos", detalle: "Anotar lo que gastas y lo que te entra", modulos: { matricula: false, beca: false, gastos: true, ahorros: false } },
  { id: "todo", emoji: "✨", etiqueta: "Todo", detalle: "Universidad, día a día y metas juntos", modulos: { ...MODULOS_FINANZAS_DEFAULT } },
];

function normalizarModulos(m) {
  return {
    matricula: !!(m && m.matricula),
    beca: !!(m && m.beca),
    gastos: !!(m && m.gastos),
    ahorros: !!(m && m.ahorros),
  };
}

/** id del perfil cuyos módulos coinciden exactamente con `modulos`, o "personalizado". */
function perfilDeModulos(modulos) {
  const n = normalizarModulos(modulos);
  const p = PERFILES_FINANZAS.find((x) => MODULOS_INFO.every((mi) => x.modulos[mi.id] === n[mi.id]));
  return p ? p.id : "personalizado";
}

/**
 * Pestañas visibles según módulos. Resumen siempre. Semestres, Plan y Beneficios
 * viven de matrícula/beca; Movimientos de cualquier módulo; Metas de Ahorros.
 */
function pestanasVisiblesFinanzas(modulos) {
  const m = normalizarModulos(modulos);
  const universidad = m.matricula || m.beca;
  const ids = ["resumen"];
  if (universidad) ids.push("semestres", "plan");
  if (universidad || m.gastos || m.ahorros) ids.push("gastos-u");
  if (m.ahorros) ids.push("metas");
  if (universidad) ids.push("gastos-estudiantiles");
  return ids;
}

/** Guarda módulos (parcial o completo) y sella la configuración. El llamador marca el cambio pendiente. */
function aplicarModulosFinanzas(datos, cambios) {
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.finanzas_modulos = normalizarModulos({ ...obtenerModulosFinanzas(datos), ...cambios });
  sellarTimestamp(datos.configuracion);
  return datos.configuracion.finanzas_modulos;
}

/** Elige un perfil: enciende sus módulos y deja constancia de que el onboarding ya se resolvió. */
function aplicarPerfilFinanzas(datos, perfilId) {
  const perfil = PERFILES_FINANZAS.find((p) => p.id === perfilId);
  if (!perfil) return null;
  aplicarModulosFinanzas(datos, perfil.modulos);
  datos.configuracion.finanzas_onboarding_visto = true;
  sellarTimestamp(datos.configuracion);
  return perfil;
}

/** Salta el onboarding sin tocar módulos (quedan los de siempre: todo encendido). */
function omitirOnboardingFinanzas(datos) {
  if (!datos.configuracion) datos.configuracion = {};
  datos.configuracion.finanzas_onboarding_visto = true;
  sellarTimestamp(datos.configuracion);
}

/** ¿Ofrecer el onboarding? Solo a quien aún no lo vio y no tiene nada de Finanzas cargado. */
function debeMostrarOnboardingFinanzas(datos) {
  if (!datos || (datos.configuracion && datos.configuracion.finanzas_onboarding_visto)) return false;
  const hayDatos = ["movimientos", "metas", "gastos_u", "finanzas_semestre"].some((k) => Array.isArray(datos[k]) && datos[k].length > 0);
  return !hayDatos;
}

export {
  MODULOS_INFO,
  PERFILES_FINANZAS,
  aplicarModulosFinanzas,
  aplicarPerfilFinanzas,
  debeMostrarOnboardingFinanzas,
  omitirOnboardingFinanzas,
  perfilDeModulos,
  pestanasVisiblesFinanzas,
};
