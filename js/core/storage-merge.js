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

/**
 * Compara dos entidades por su timestamp de última modificación.
 * Nunca debería haber timestamps iguales entre dispositivos distintos (el
 * _dispositivoId desempata como último recurso, de forma determinista y
 * arbitraria, solo para que el resultado sea estable y no dependa del
 * orden de fusión).
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
    const existente = porId.get(item.id);
    if (!existente) {
      porId.set(item.id, item);
      return;
    }
    if (existente === item) return; // mismo objeto, nada que decidir
    if (esMasReciente(item, existente)) {
      console.warn(
        `[fusión] Conflicto en ${etiqueta} id="${item.id}": se descarta la versión local ` +
          `(actualizada ${new Date(Number(existente._actualizadoEn) || 0).toISOString()}) ` +
          `a favor de la remota (actualizada ${new Date(Number(item._actualizadoEn) || 0).toISOString()}).`,
        { local: existente, remota: item }
      );
      porId.set(item.id, item);
    } else if (esMasReciente(existente, item)) {
      console.warn(
        `[fusión] Conflicto en ${etiqueta} id="${item.id}": se conserva la versión local ` +
          `(actualizada ${new Date(Number(existente._actualizadoEn) || 0).toISOString()}) ` +
          `sobre la remota (actualizada ${new Date(Number(item._actualizadoEn) || 0).toISOString()}).`,
        { local: existente, remota: item }
      );
    }
    // Si ninguna es "más reciente" (timestamps y dispositivo iguales), se
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

  return {
    ...base,
    materias: fusionarColeccion(planLocal.materias, planRemoto.materias, tumbasMaterias, "materia"),
    categorias: fusionarColeccion(planLocal.categorias, planRemoto.categorias, [], "categoría"),
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

export { esMasReciente, fusionarColeccion, fusionarDatos, fusionarPlan, fusionarTumbas };
