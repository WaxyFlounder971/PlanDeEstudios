/* =========================================================================
   TIEMPO — Racha de estudio: CÁLCULO PURO (2026-09-19)

   Sin imports a propósito: ni `estado`, ni DOM, ni nada de la app. Recibe el
   arreglo de sesiones y el "ahora" por parámetro, así se prueba en Node con
   cualquier fecha (mismo criterio que calcularHorasTotalesPeriodos). La parte
   visual y el acceso a `estado.datos` viven en tiempo-estudio-racha-ui.js.

   La racha es DERIVADA: no se guarda ningún número. Se recalcula desde
   `sesiones_estudio` cada vez que se necesita, así que editar, borrar o cargar
   una sesión vieja nunca la deja desincronizada. Costo medido (una pasada
   O(N) + un recorrido por días): ~1 ms con 1.000 sesiones, ~2 ms con 10.000.

   REGLAS
   - Un día es "cumplido" si la suma de TODAS las sesiones de ese día (todas
     las materias, todos los orígenes, incluidas materias/semestres ya
     borrados) llega a 30 min. El día es el día calendario LOCAL, y una
     sesión cuenta ENTERA en el día donde empieza (misma regla que "Horas
     totales" de Estadísticas, para que los dos números coincidan).
   - Cada SEMANA (lunes–domingo, igual que el resto de Tiempo) da 2 días de
     descanso, gastados cuando la persona quiera o no gastados. Un 3.er día sin
     cumplir en la misma semana rompe la racha.
   - Solo cuentan como descanso los días MIENTRAS la racha está viva: si la
     racha nace un jueves, lunes–miércoles no se cuentan como faltas.
   - Hoy es un día "pendiente": no cuenta como falta hasta que termina, así que
     quien todavía no estudió hoy no ve su racha en 0 a las 8 am.
   - La racha vale la cantidad de días CUMPLIDOS de la cadena; los días de
     descanso no suman ni cortan.
   - RECUPERACIÓN: si se rompe una racha de 30 días o más, durante el día
     siguiente a la ruptura (el primero donde ya se sabe que se perdió) estudiar
     90 min la restaura, con ese día contando como uno más (largo + 1). Pasado
     ese día la oferta expira. Es derivado y sin estado guardado: no hay nada
     que aceptar ni que sincronizar entre dispositivos.

   CONSECUENCIA CONOCIDA de "2 descansos por SEMANA": los descansos se
   cuentan por semana calendario, así que 2 al final de una semana y 2 al
   inicio de la siguiente (4 seguidos) no rompen la racha. Es lo que pidió la
   regla; si se quisiera evitar, se agrega un tope de días seguidos acá mismo.
   ========================================================================= */

const MS_DIA = 86400000;

export const MINUTOS_DIA_CUMPLIDO = 30;
export const DESCANSOS_POR_SEMANA = 2;
export const MINUTOS_PARA_RECUPERAR = 90;
/** Largo mínimo (en días cumplidos) para que una racha perdida se pueda recuperar. */
export const RACHA_MINIMA_RECUPERABLE = 30;

/**
 * Primer día (lunes) que se mira. Sirve para "darle la racha" a quien ya
 * estudió esta semana sin arrastrar historial viejo: sin esto, alguien con
 * 40 días seguidos hace dos meses recibiría al abrir la app una oferta de
 * "recuperar" una racha de hace mucho. `null` = todo el historial.
 */
export const RACHA_DESDE_ISO = "2026-09-14";

// Una sesión con `inicio` corrupto (0, negativo, NaN) no debe hacer que el
// recorrido arranque en 1970.
const INICIO_MINIMO_VALIDO_MS = Date.UTC(2000, 0, 1);

/** Día calendario LOCAL de un timestamp → entero (robusto ante cambios de hora). */
export function indiceDia(ms) {
  const d = new Date(ms);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / MS_DIA);
}

/** "YYYY-MM-DD" → índice de día (sin pasar por zonas horarias). */
export function indiceDesdeISO(iso) {
  const [a, m, d] = String(iso).split("-").map(Number);
  return Math.floor(Date.UTC(a, (m || 1) - 1, d || 1) / MS_DIA);
}

/** Índice de día → "YYYY-MM-DD". */
export function isoDesdeIndice(idx) {
  return new Date(idx * MS_DIA).toISOString().slice(0, 10);
}

// El día 0 (1970-01-01) fue jueves, así que idx + 3 es múltiplo de 7 en lunes.
function esLunes(idx) {
  return (((idx + 3) % 7) + 7) % 7 === 0;
}

/**
 * @param {Array} sesiones  `estado.datos.sesiones_estudio` (campos usados:
 *                          `inicio` epoch ms y `duracion_minutos`).
 * @param {Object} [opciones]
 * @param {number} [opciones.ahora=Date.now()]
 * @param {number|null} [opciones.desdeIdx=null] índice de día desde el cual mirar.
 * @returns {{
 *   racha:number, activa:boolean, hoyIdx:number, hoyCumplido:boolean,
 *   minutosHoy:number, inicioIdx:(number|null), inicioISO:(string|null),
 *   descansosUsados:(number|null), descansosRestantes:(number|null),
 *   enRiesgo:boolean, restauradaHoy:boolean,
 *   recuperable:(null|{longitud:number, minutosNecesarios:number, minutosHoy:number})
 * }}
 */
export function calcularRacha(sesiones, { ahora = Date.now(), desdeIdx = null } = {}) {
  const hoy = indiceDia(ahora);

  // 1) Minutos por día — una sola pasada sobre las sesiones.
  const porDia = new Map();
  let primero = Infinity;
  if (Array.isArray(sesiones)) {
    for (const s of sesiones) {
      const inicio = Number(s && s.inicio);
      if (!Number.isFinite(inicio) || inicio < INICIO_MINIMO_VALIDO_MS) continue;
      let min = Number(s.duracion_minutos);
      if (!Number.isFinite(min)) min = Math.round((Number(s.fin) - inicio) / 60000);
      if (!Number.isFinite(min) || min <= 0) continue;
      const dia = indiceDia(inicio);
      if (dia > hoy) continue; // una sesión "del futuro" no cuenta
      if (desdeIdx !== null && dia < desdeIdx) continue;
      porDia.set(dia, (porDia.get(dia) || 0) + min);
      if (dia < primero) primero = dia;
    }
  }

  const minutosHoy = porDia.get(hoy) || 0;
  const hoyCumplido = minutosHoy >= MINUTOS_DIA_CUMPLIDO;
  const vacio = {
    racha: 0,
    activa: false,
    hoyIdx: hoy,
    hoyCumplido,
    minutosHoy,
    inicioIdx: null,
    inicioISO: null,
    descansosUsados: null,
    descansosRestantes: null,
    enRiesgo: false,
    restauradaHoy: false,
    recuperable: null,
  };
  if (!porDia.size) return vacio;

  // 2) Recorrido día por día, del primero con datos hasta hoy.
  let activa = false;
  let racha = 0;
  let faltas = 0; // días sin cumplir de ESTA semana, ya terminados, con la racha viva
  let inicio = null;
  let perdida = null; // { longitud, dia, inicio } de la última racha recuperable
  let restauradaHoy = false;

  for (let d = primero; d <= hoy; d++) {
    if (esLunes(d)) faltas = 0;
    const min = porDia.get(d) || 0;
    const esHoy = d === hoy;

    // Recuperación: el día siguiente a la ruptura, con 90 min o más.
    if (perdida && d === perdida.dia + 1 && min >= MINUTOS_PARA_RECUPERAR) {
      activa = true;
      racha = perdida.longitud + 1;
      faltas = 0;
      inicio = perdida.inicio;
      perdida = null;
      if (esHoy) restauradaHoy = true;
      continue;
    }

    if (min >= MINUTOS_DIA_CUMPLIDO) {
      if (!activa) {
        activa = true;
        racha = 0;
        faltas = 0; // las faltas de una racha muerta no se heredan
        inicio = d;
      }
      racha++;
    } else if (!esHoy && activa) {
      // Día ya terminado sin cumplir: gasta un descanso de la semana.
      faltas++;
      if (faltas > DESCANSOS_POR_SEMANA) {
        perdida = racha >= RACHA_MINIMA_RECUPERABLE ? { longitud: racha, dia: d, inicio } : null;
        activa = false;
        racha = 0;
        faltas = 0;
        inicio = null;
      }
    }
    // Hoy sin cumplir: pendiente, no gasta nada todavía.
  }

  const recuperable =
    perdida && hoy === perdida.dia + 1 && minutosHoy < MINUTOS_PARA_RECUPERAR
      ? { longitud: perdida.longitud, minutosNecesarios: MINUTOS_PARA_RECUPERAR, minutosHoy }
      : null;

  return {
    racha: activa ? racha : 0,
    activa,
    hoyIdx: hoy,
    hoyCumplido,
    minutosHoy,
    inicioIdx: activa ? inicio : null,
    inicioISO: activa ? isoDesdeIndice(inicio) : null,
    descansosUsados: activa ? faltas : null,
    descansosRestantes: activa ? Math.max(0, DESCANSOS_POR_SEMANA - faltas) : null,
    // Ya gastó los 2 descansos de la semana y hoy todavía no cumplió: si el
    // día termina así, mañana la racha se rompe.
    enRiesgo: activa && !hoyCumplido && faltas >= DESCANSOS_POR_SEMANA,
    restauradaHoy,
    recuperable,
  };
}
