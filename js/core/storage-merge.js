/* =========================================================================
   FUSIÓN DE DATOS ENTRE DISPOSITIVOS
   -------------------------------------------------------------------------
   Bug crítico (v1.15): al no comparar por fecha, cualquier lectura remota
   (login, pull-to-refresh, sondeo) sobrescribía TODO estado.datos con el
   blob completo de Drive o de la caché local — el que "llegara último" a
   escribir ganaba siempre, sin importar cuál era realmente más reciente.
   En el peor caso (abrir la app en el teléfono con datos viejos en su
   caché local, después de trabajar mucho en PC) esto borraba trabajo real.

   Este archivo reemplaza ese "reemplazo total" por una FUSIÓN por entidad:
   cada materia, semestre, profesor, evento de agenda, enlace rápido, plan
   y categoría se compara individualmente por su `_actualizadoEn` (ver
   sellarTimestamp en schema.js) — nunca se descarta una entidad completa
   solo porque el otro lado "llegó después" a nivel de archivo.

   Reglas:
   1. Una entidad que existe solo en un lado (local o remoto) SIEMPRE se
      conserva — nunca se pierde por omisión.
   2. Una entidad que existe en ambos lados con el mismo id: gana la de
      `_actualizadoEn` más reciente. La que pierde se descarta pero se
      loguea en consola (nunca queda visible en la UI, a petición del
      usuario — ver conversación del 2026-07-28).
   3. Los BORRADOS son explícitos: borrar algo no es "dejar de mandarlo",
      es agregar su id a una lista de tumbas (`_eliminados`) con su propio
      timestamp. Sin esto, cualquier fusión "resucitaría" lo borrado en
      cuanto el otro dispositivo mandara su copia vieja.
   4. configuracion y perfil son objetos únicos (no colecciones) — se
      funden campo por campo, cada uno con su propio timestamp implícito
      a nivel de objeto completo (ver fusionarBloqueUnico).
   ========================================================================= */

import { observarRelojLogico } from "./schema.js";

/**
 * Compara dos entidades por su contador lógico de última modificación
 * (_actualizadoEn — ver REVISIÓN 2 en schema.js: ya NO es Date.now(), es un
 * reloj de Lamport). Nunca debería haber contadores iguales entre
 * dispositivos distintos (el _dispositivoId desempata como último recurso,
 * de forma determinista y arbitraria, solo para que el resultado sea
 * estable y no dependa del orden de fusión).
 */
function esMasReciente(a, b) {
  const ta = Number(a && a._actualizadoEn) || 0;
  const tb = Number(b && b._actualizadoEn) || 0;
  if (ta !== tb) return ta > tb;
  const da = String((a && a._dispositivoId) || "");
  const db = String((b && b._dispositivoId) || "");
  return da > db; // desempate arbitrario pero determinista
}

/**
 * REVISIÓN 2 (detección de conflicto real — caso "cambié el estado a Y en
 * el teléfono y a Z en la PC casi al mismo tiempo, offline"): esMasReciente
 * decide un ganador SIEMPRE, incluso cuando en la realidad ninguna edición
 * "vino después" de la otra — fueron dos ediciones concurrentes genuinas,
 * hechas cada una sin saber de la otra. Adivinar un ganador ahí (por
 * timestamp o por dispositivo) es descartar en silencio un cambio real que
 * el usuario hizo a propósito.
 *
 * La forma de distinguir "A es una evolución real de B" de "A y B son dos
 * ramas distintas que parten del mismo punto" es comparar `_version_base`
 * (ver sellarTimestamp en schema.js): cada entidad guarda de qué contador
 * partió al editarse. Si local.base === remoto.base pero
 * local._actualizadoEn !== remoto._actualizadoEn, ambas ediciones partieron
 * EXACTAMENTE del mismo punto y terminaron distinto — eso es un choque real
 * (el equivalente a un merge conflict de Git), no una simple carrera de
 * timestamps. En ese caso no se elige ganador: se conserva la versión "base"
 * (la que ya estaba, para no romper nada en la UI que no sabe de conflictos)
 * y se adjunta la otra en `_version_alterna` + `_conflicto: true`, para que
 * la UI se lo muestre al usuario y él decida — nunca se pierde el dato.
 *
 * Si las bases son distintas (el caso normal: una edición sí partió de una
 * versión más nueva que la otra, aunque sea por segundos), no hay conflicto
 * real — es una línea causal continua y esMasReciente() decide bien.
 */
function hayConflictoReal(local, remoto) {
  if (!local || !remoto) return false;

  // Guarda 1: si el contenido es idéntico (misma foto, distinta instancia
  // de objeto — típico de perfil/configuracion, que viajan enteros en cada
  // sync aunque no hayan cambiado), no hay NADA que resolver, sin importar
  // qué digan los metadatos de versión. Evita marcar "conflicto" en algo
  // que ni siquiera es una edición real.
  try {
    if (JSON.stringify(local) === JSON.stringify(remoto)) return false;
  } catch (e) {
    // Objeto no serializable (raro) — se sigue con la comparación normal.
  }

  // Guarda 2: _version_base solo tiene sentido para entidades que SÍ pasan
  // por sellarTimestamp() (materias, categorías, planes). Objetos que nunca
  // se sellan (ej. perfil/configuracion en archivos que no gestionan este
  // proyecto todavía) tendrían _version_base undefined en ambos lados, y
  // `Number(undefined) || 0` colapsaría ambos a 0 — marcando conflicto en
  // CUALQUIER par de objetos distintos sin sellar, incluso sin que haya
  // habido nunca una edición doble real. Sin metadata real de sellado en
  // ninguno de los dos lados, no hay forma honesta de detectar conflicto:
  // se cae al comportamiento anterior (gana el más "reciente" por
  // esMasReciente, o si tampoco hay eso, es indistinguible y se deja como
  // estaba). Mejor un desempate arbitrario ocasional que un falso conflicto
  // permanente en cada sync.
  const localTieneVersion = local._version_base !== undefined;
  const remotoTieneVersion = remoto._version_base !== undefined;
  if (!localTieneVersion || !remotoTieneVersion) return false;

  const baseLocal = Number(local._version_base) || 0;
  const baseRemota = Number(remoto._version_base) || 0;
  // Mismo punto de partida = ambas son ediciones directas de la MISMA
  // versión previa, hechas sin que ninguna conociera a la otra. Esto es
  // cierto sin importar en qué contador haya terminado cada una — incluso
  // si por coincidencia ambos dispositivos avanzaron su reloj lógico al
  // mismo número exacto (caso límite: dos dispositivos que nunca se habían
  // sincronizado antes, cada uno partiendo de "0 ediciones vistas"), eso NO
  // los vuelve la misma edición — son dos ediciones distintas de contenido
  // que casualmente comparten número de contador. La única señal confiable
  // de "es la misma edición, no hay nada que resolver" es que sean
  // literalmente el mismo objeto (ver el `existente === item` en
  // fusionarColeccion, que ya se revisa ANTES de llegar aquí) o tener
  // contenido idéntico (Guarda 1, arriba).
  return baseLocal === baseRemota;
}

/**
 * Construye la entidad resultante cuando hay un conflicto real: conserva
 * los campos de `base` tal cual (para que nada que no sepa de conflictos —
 * cálculos, filtros, exportación — se rompa por un campo inesperado) y le
 * agrega la marca de conflicto + la alternativa completa para que la UI
 * decida qué mostrar. `_conflicto` nunca se sincroniza como "resuelto"
 * solo — se limpia explícitamente cuando el usuario elige (ver
 * resolverConflicto más abajo).
 */
function marcarConflictoSiCorresponde(entidadLocal, entidadRemota, etiqueta) {
  if (!hayConflictoReal(entidadLocal, entidadRemota)) return null;
  console.warn(
    `[conflicto real] ${etiqueta} id="${entidadLocal.id}": se editó de forma distinta en dos ` +
      `dispositivos a partir de la misma versión (base=${entidadLocal._version_base}). ` +
      `Se necesita que el usuario elija cuál dejar.`,
    { local: entidadLocal, remoto: entidadRemota }
  );
  return {
    ...entidadLocal,
    _conflicto: true,
    _version_alterna: { ...entidadRemota },
  };
}

/**
 * Se llama sobre CUALQUIER entidad remota que se procese al fusionar
 * (gane o pierda la comparación) — mantiene el reloj lógico de este
 * dispositivo siempre por delante de todo lo que ya vio, que es la regla
 * que hace que un reloj de Lamport funcione (ver observarRelojLogico en
 * schema.js). Sin esto, el reloj local podría quedar "atrás" del remoto y
 * la próxima edición local terminaría con un contador más bajo que algo
 * que este mismo dispositivo ya sabía que existía.
 */
function observarEntidadRemota(entidad) {
  if (entidad && entidad._actualizadoEn !== undefined) {
    observarRelojLogico(entidad._actualizadoEn);
  }
}

/**
 * Resuelve un conflicto marcado por el usuario: aplica la versión elegida
 * (local o alterna) y la re-sella como una edición nueva y limpia (sin
 * _conflicto ni _version_alterna), para que en el próximo sync esta
 * resolución se propague como cualquier otra edición normal — nunca queda
 * "medio resuelta" ni puede volver a chocar contra la misma base vieja.
 * `entidad` es la que tiene `_conflicto: true`; `cual` es "local" o
 * "alterna". Requiere `sellarTimestamp` de schema.js — se recibe como
 * parámetro para no crear un import circular entre este archivo y schema.js.
 */
function resolverConflicto(entidadConConflicto, cual, sellarTimestampFn) {
  const elegida = cual === "alterna" ? entidadConConflicto._version_alterna : entidadConConflicto;
  const limpia = { ...elegida };
  delete limpia._conflicto;
  delete limpia._version_alterna;
  return sellarTimestampFn(limpia);
}

/**
 * Fusiona dos colecciones (arreglos de entidades con `id` propio),
 * respetando las tumbas de ambos lados. Devuelve el arreglo fusionado.
 * `etiqueta` es solo para los logs de consola (ej. "materia", "semestre").
 */
function fusionarColeccion(coleccionLocal, coleccionRemota, tumbas, etiqueta) {
  const local = Array.isArray(coleccionLocal) ? coleccionLocal : [];
  const remota = Array.isArray(coleccionRemota) ? coleccionRemota : [];
  const idsEliminados = new Set(tumbas.map((t) => t.id));

  const porId = new Map();

  local.forEach((item) => {
    if (item && item.id !== undefined) porId.set(item.id, item);
  });

  remota.forEach((item) => {
    if (!item || item.id === undefined) return;
    // Regla de Lamport: este dispositivo acaba de VER el contador de una
    // entidad remota — su propio reloj se adelanta si hace falta, sin
    // importar si esta entidad en particular gana, pierde o entra en
    // conflicto. Necesario para que la próxima edición LOCAL nunca quede
    // con un contador más bajo que algo que este dispositivo ya conoce.
    observarEntidadRemota(item);

    const existente = porId.get(item.id);
    if (!existente) {
      porId.set(item.id, item);
      return;
    }
    if (existente === item) return; // mismo objeto, nada que decidir

    // REVISIÓN 2: antes de dejar que esMasReciente() elija un ganador a
    // ciegas, se revisa si esto es un conflicto REAL (ambas ediciones
    // parten de la misma base — ver hayConflictoReal). Si lo es, no se
    // adivina: se conserva marcado con ambas versiones para que el usuario
    // decida (ver marcarConflictoSiCorresponde).
    const conConflicto = marcarConflictoSiCorresponde(existente, item, etiqueta);
    if (conConflicto) {
      porId.set(item.id, conConflicto);
      return;
    }

    if (esMasReciente(item, existente)) {
      console.warn(
        `[fusión] Conflicto en ${etiqueta} id="${item.id}": se descarta la versión local ` +
          `(contador ${Number(existente._actualizadoEn) || 0}) ` +
          `a favor de la remota (contador ${Number(item._actualizadoEn) || 0}).`,
        { local: existente, remota: item }
      );
      porId.set(item.id, item);
    } else if (esMasReciente(existente, item)) {
      console.warn(
        `[fusión] Conflicto en ${etiqueta} id="${item.id}": se conserva la versión local ` +
          `(contador ${Number(existente._actualizadoEn) || 0}) ` +
          `sobre la remota (contador ${Number(item._actualizadoEn) || 0}).`,
        { local: existente, remota: item }
      );
    }
    // Si ninguna es "más reciente" (contador y dispositivo iguales), se
    // asume que son la misma edición vista desde los dos lados: no hay nada
    // que resolver, se deja la que ya está.
  });

  // Los borrados ganan sobre cualquier entidad que llegue con ese id, sin
  // importar cuál timestamp traiga — un borrado es una decisión explícita
  // del usuario y no debe poder "resucitarse" con una edición vieja que
  // todavía no se había sincronizado en el otro dispositivo.
  const resultado = [];
  porId.forEach((item, id) => {
    if (idsEliminados.has(id)) return;
    resultado.push(item);
  });
  return resultado;
}

/**
 * configuracion y perfil no son colecciones con id — son objetos únicos.
 * Se funden completos por su propio `_actualizadoEn` (todo o nada dentro
 * de ese bloque): no tiene sentido, por ejemplo, mezclar la paleta de un
 * lado con el modo oscuro del otro campo por campo, porque el usuario
 * probablemente cambió varias cosas juntas en la misma sesión de ajustes.
 */
function fusionarBloqueUnico(local, remoto, etiqueta) {
  if (!local) return remoto;
  if (!remoto) return local;
  if (esMasReciente(remoto, local)) {
    console.warn(
      `[fusión] "${etiqueta}": se usa la versión remota (más reciente).`,
      { local, remoto }
    );
    return remoto;
  }
  return local;
}

/** Fusiona las tumbas de ambos lados (unión simple: un borrado nunca se pierde). */
function fusionarTumbas(tumbasLocal, tumbasRemota) {
  const local = Array.isArray(tumbasLocal) ? tumbasLocal : [];
  const remota = Array.isArray(tumbasRemota) ? tumbasRemota : [];
  const porId = new Map();
  [...local, ...remota].forEach((t) => {
    if (!t || t.id === undefined) return;
    const existente = porId.get(t.id);
    if (!existente || Number(t.eliminadoEn) > Number(existente.eliminadoEn)) {
      porId.set(t.id, t);
    }
  });
  return Array.from(porId.values());
}

/**
 * Fusiona un plan de estudios individual: sus colecciones internas
 * (materias, categorías, optativas_disponibles, materias_revisar) se
 * funden por separado, con sus propias tumbas (guardadas dentro del plan
 * mismo, en plan._eliminados_materias, etc. — ver schema.js).
 */
function fusionarPlan(planLocal, planRemoto) {
  if (!planLocal) return planRemoto;
  if (!planRemoto) return planLocal;

  const base = esMasReciente(planRemoto, planLocal) ? planRemoto : planLocal;
  const otro = base === planRemoto ? planLocal : planRemoto;

  if (base !== otro) {
    console.warn(
      `[fusión] Plan "${planLocal.id}": metadatos generales tomados de la versión ` +
        `${base === planRemoto ? "remota" : "local"} (más reciente); las materias se funden aparte.`
    );
  }

  const tumbasMaterias = fusionarTumbas(planLocal._eliminados_materias, planRemoto._eliminados_materias);
  // FIX sync (bug real encontrado en esta ronda de auditoría): antes las
  // categorías se fundían con `fusionarColeccion(..., [], "categoría")` —
  // un tercer argumento vacío en duro, a diferencia de materias/optativas
  // que sí usan su propia tumba. Sin tumba real, borrar una categoría en un
  // dispositivo no dejaba ningún rastro explícito: en el próximo sync, si
  // el otro dispositivo todavía traía esa categoría en su copia (porque no
  // había bajado el borrado todavía), fusionarColeccion no tenía forma de
  // saber que debía excluirla — la categoría "resucitaba".
  const tumbasCategorias = fusionarTumbas(planLocal._eliminados_categorias, planRemoto._eliminados_categorias);

  return {
    ...base,
    materias: fusionarColeccion(planLocal.materias, planRemoto.materias, tumbasMaterias, "materia"),
    categorias: fusionarColeccion(planLocal.categorias, planRemoto.categorias, tumbasCategorias, "categoría"),
    optativas_disponibles: fusionarColeccion(
      planLocal.optativas_disponibles,
      planRemoto.optativas_disponibles,
      tumbasMaterias,
      "optativa disponible"
    ),
    materias_revisar: fusionarColeccion(
      planLocal.materias_revisar,
      planRemoto.materias_revisar,
      tumbasMaterias,
      "materia por revisar"
    ),
    _eliminados_materias: tumbasMaterias,
    _eliminados_categorias: tumbasCategorias,
  };
}

/**
 * Fusiona los planes de estudio (colección de nivel superior) — cada plan
 * se identifica por su `id` y, si existe en ambos lados, se funde con
 * fusionarPlan() en vez de que gane uno completo sobre el otro.
 */
function fusionarPlanesEstudio(local, remoto, tumbas) {
  const listaLocal = Array.isArray(local) ? local : [];
  const listaRemota = Array.isArray(remoto) ? remoto : [];
  const idsEliminados = new Set(tumbas.map((t) => t.id));

  const porId = new Map();
  listaLocal.forEach((p) => porId.set(p.id, p));
  listaRemota.forEach((p) => {
    const existente = porId.get(p.id);
    porId.set(p.id, existente ? fusionarPlan(existente, p) : p);
  });

  const resultado = [];
  porId.forEach((plan, id) => {
    if (!idsEliminados.has(id)) resultado.push(plan);
  });
  return resultado;
}

/**
 * Punto de entrada principal. Sustituye cualquier `estado.datos = X`
 * directo desde una fuente remota o de caché — a partir de ahora, TODA
 * lectura de datos externos (Drive, caché local del teléfono) pasa por
 * aquí antes de aplicarse. Si uno de los dos lados no existe (primera
 * carga, sin caché local todavía), se devuelve el otro tal cual, sin
 * fusión (no hay nada con qué comparar).
 */
function fusionarDatos(datosLocal, datosRemoto) {
  if (!datosLocal) return datosRemoto;
  if (!datosRemoto) return datosLocal;

  const tumbasPlanes = fusionarTumbas(datosLocal._eliminados_planes, datosRemoto._eliminados_planes);
  const tumbasSemestres = fusionarTumbas(datosLocal._eliminados_semestres, datosRemoto._eliminados_semestres);
  const tumbasProfesores = fusionarTumbas(datosLocal._eliminados_profesores, datosRemoto._eliminados_profesores);
  const tumbasAgenda = fusionarTumbas(datosLocal._eliminados_agenda, datosRemoto._eliminados_agenda);
  const tumbasEnlaces = fusionarTumbas(
    datosLocal.configuracion && datosLocal.configuracion._eliminados_enlaces,
    datosRemoto.configuracion && datosRemoto.configuracion._eliminados_enlaces
  );

  const configuracionFundida = fusionarBloqueUnico(datosLocal.configuracion, datosRemoto.configuracion, "configuración");
  // enlaces_rapidos vive DENTRO de configuracion pero se funde como
  // colección aparte (no tiene sentido que todo el bloque de configuración
  // "gane" y de paso descarte un enlace nuevo que el otro lado sí tenía).
  configuracionFundida.enlaces_rapidos = fusionarColeccion(
    datosLocal.configuracion && datosLocal.configuracion.enlaces_rapidos,
    datosRemoto.configuracion && datosRemoto.configuracion.enlaces_rapidos,
    tumbasEnlaces,
    "enlace rápido"
  );
  configuracionFundida._eliminados_enlaces = tumbasEnlaces;

  return {
    ...datosLocal,
    ...datosRemoto,
    version_esquema: Math.max(Number(datosLocal.version_esquema) || 1, Number(datosRemoto.version_esquema) || 1),
    perfil: fusionarBloqueUnico(datosLocal.perfil, datosRemoto.perfil, "perfil"),
    configuracion: configuracionFundida,
    planes_estudio: fusionarPlanesEstudio(datosLocal.planes_estudio, datosRemoto.planes_estudio, tumbasPlanes),
    semestres: fusionarColeccion(datosLocal.semestres, datosRemoto.semestres, tumbasSemestres, "semestre"),
    profesores: fusionarColeccion(datosLocal.profesores, datosRemoto.profesores, tumbasProfesores, "profesor"),
    agenda: fusionarColeccion(datosLocal.agenda, datosRemoto.agenda, tumbasAgenda, "evento de agenda"),
    _eliminados_planes: tumbasPlanes,
    _eliminados_semestres: tumbasSemestres,
    _eliminados_profesores: tumbasProfesores,
    _eliminados_agenda: tumbasAgenda,
  };
}

export {
  esMasReciente,
  fusionarColeccion,
  fusionarDatos,
  fusionarPlan,
  fusionarTumbas,
  hayConflictoReal,
  resolverConflicto,
};
