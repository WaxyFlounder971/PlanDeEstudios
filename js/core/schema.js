/* =========================================================================
   ESQUEMA DE DATOS — App Académica
   Este archivo NO valida nada por ahora, solo documenta y crea la
   estructura inicial ("de fábrica") de los datos de un usuario nuevo.
   Todo el proyecto (iteraciones 1-7) va a ir llenando estas mismas llaves,
   así que este archivo es el mapa de referencia de todo el modelo.
   ========================================================================= */

/**
 * Devuelve el objeto de datos "vacío" para un usuario que recién inicia
 * sesión por primera vez. Esto es lo que se guarda como el archivo JSON
 * único dentro de su Google Drive (ver js/auth.js).
 */
function crearDatosUsuarioNuevo() {
  return {
    version_esquema: 1,

    perfil: {
      nombre: null,          // viene de la cuenta de Google
      correo: null,          // viene de la cuenta de Google
      foto_url: null,        // viene de la cuenta de Google (userinfo picture)
      carnet: null,          // dato opcional de perfil, ya NO se usa para iniciar sesión
    },

    configuracion: {
      paleta: "azul",              // una de las 10 paletas
      modo: "dark",                 // "dark" | "light"
      paleta_personalizada: null,   // v1.13: { basadaEn, colores: { fondoCanvas, fondoCard, borde, accent1, accent2, luz } }
                                     // v1.15: colores también incluye degradado: { activo, color, intensidad (0-100, % del stop medio), angulo (0-360) }
      escala_notas_global: 100,     // 10 o 100 (1-10 ó 1-100)
      formato_texto_nombres: "titulo", // "titulo" | "mayusculas" | "oracion" (v5 #9)
      modo_rendimiento: false,      // v1.14.1: reduce blur/sombras/animaciones para laptops con GPU integrada
      plan_activo_id: null,         // id del Plan de Estudios seleccionado como activo
      enlaces_rapidos: [],          // ver estructura de "enlace" abajo (máx. 20)

      // --- Modo Hardcore 💀 (hasta 3 carreras simultáneas) ---
      modo_hardcore: false,             // si está activo, se combinan hasta 3 Planes de Estudio a la vez
      plan_activo_secundario_id: null,  // 2do Plan de Estudios (solo relevante si modo_hardcore = true)
      plan_activo_terciario_id: null,   // 3er Plan de Estudios (solo relevante si modo_hardcore = true)
    },

    // Un usuario puede tener más de un Plan de Estudios (ej. cambio de carrera/universidad).
    planes_estudio: [
      /*
      {
        id: "plan_001",
        nombre_carrera: "Ingeniería en Tecnologías de Información",
        universidad: "TEC",              // "TEC" | "UCR" | otra
        codigo_plan: "420501, plan 01",  // texto libre, tal cual lo trae la universidad
        parametros_universidad: {
          nombre_bloque: "Semestre",     // "Semestre" | "Cuatrimestre" | "Trimestre"
          semanas_por_bloque: 16,        // 16, 18 o 20
          escala_notas: 100,             // puede ser distinta al global si se necesita
          formula_ponderado: "creditos", // "creditos" = Σ(nota*creditos)/Σcreditos
          horario_inicio_default: "07:30",
          horario_duracion_bloque_min: 50,
        },
        categorias: [
          // { id, nombre, color } — 100% creadas por el usuario, nunca precargadas
        ],
        materias: [
          /*
          {
            id: "MA1102",
            codigo: "MA1102",
            nombre: "Cálculo Diferencial e Integral",
            creditos: 4,
            // Llaves EXACTAS de tipos_horas de este plan (ver parametros_universidad).
            // Ej. TEC: { "Horas": 5 } — UCR: { "Teoría": 5, "Práctica": 0, "Laboratorio": 0, "Teoría-Práctica": 0 }
            horas: { "Horas": 5 },
            bloque: 1,                      // bloque/nivel original del plan
            // v1.12: árbol de expresión Y/O (ver ARBOL_REQUISITOS más abajo).
            // null = sin requisitos. Puede ser una hoja simple o un árbol
            // anidado de cualquier profundidad. Ejemplo con anidamiento:
            // { tipo:"O", hijos:[
            //     { tipo:"Y", hijos:[{tipo:"codigo",valor:"QU-0102"},{tipo:"codigo",valor:"QU-0103"}] },
            //     { tipo:"Y", hijos:[{tipo:"codigo",valor:"QU-0114"},{tipo:"codigo",valor:"QU-0115"}] },
            // ]}
            requisitos: { tipo: "codigo", valor: "MA0101" },
            correquisitos: null,
            categoria_id: null,             // se asigna luego manualmente
            estado: "pendiente",            // "pendiente" | "cursando" | "aprobado" | "reprobado"
            escala_notas_override: null,    // null = usa la global/universidad
          }
          *//*
        ],
      }
      */
    ],

    // Historial de semestres cursados, de cualquiera de los planes de estudio.
    semestres: [
      /*
      {
        id: "sem_001",
        plan_estudio_id: "plan_001",
        nombre: "I Semestre",          // o "Verano 2025", etc.
        fecha_inicio: "2026-01-12",
        semanas_totales: 16,
        materias_matriculadas: [
          {
            materia_id: "MA1102",
            plan_estudio_id: "plan_001", // de cuál de los dos planes viene (relevante en Modo Hardcore)
            profesor_id: null,
            criterios: [
              // { id, nombre, valor_total_porcentaje }
            ],
            asignaciones: [
              // { id, criterio_id, nombre, nota, agregado_a_agenda: true/false, agenda_evento_id }
            ],
            nota_final: null,           // calculada en JS local, redondeada al 5
            calificacion_profesor: null // 1-10, evaluación subjetiva del usuario al profesor
          }
        ],
        horario: [
          // { materia_id, dia: "L"|"K"|"M"|"J"|"V"|"S"|"D", hora_inicio, hora_fin, aula, modalidad, color }
        ],
      }
      */
    ],

    profesores: [
      /*
      { id, nombre, materias_impartidas: [{ materia_id, semestre_id, nota_obtenida, calificacion_dada }] }
      */
    ],

    agenda: [
      /*
      { id, tipo: "tarea"|"examen"|"recordatorio", titulo, fecha, hora, materia_id, semestre_id,
        completado: false, archivado: false, notas: "" }
      */
    ],
  };
}

/** Estructura de referencia de un "enlace rápido" (máx. 20 por usuario). */
function crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor }) {
  // icono_tipo: "emoji" | "imagen" ; icono_valor: el emoji o la URL/base64 de la imagen
  return { id: crypto.randomUUID(), nombre, url, icono_tipo, icono_valor };
}

// Semestres y Notas — Fase 1: tope real de un semestre. Los programas duran
// como máximo ~20 semanas; se deja un margen de 5 semanas de holgura (clases
// que arrancan tarde, prórrogas, etc.) antes de que la app lo dé por
// terminado sola. Se usa tanto para capar duracion_semanas en el formulario
// de alta como para el auto-cierre por fecha (ver obtenerEstadoEfectivoSemestre).
const LIMITE_SEMANAS_SEMESTRE = 25;
const LIMITE_ENLACES_RAPIDOS = 20;
/* Orden "azucarado": neutros primero (blanco → gris → negro) y luego el
 * espectro cromático completo (rojo → dorado → amarillo → verde → cyan →
 * azul → índigo → morado → rosado), cerrando con "azucarado" (combinación
 * de varios colores pastel) como pieza destacada al final. */
const PALETAS_DISPONIBLES = [
  "blanco", "gris", "negro",
  "rojo", "dorado", "amarillo", "verde", "cyan", "azul", "indigo", "morado", "rosado",
  "azucarado",
];

/* ===================== Árbol de expresión Y/O (requisitos/correquisitos) =====================
   v1.12: reemplaza el modelo plano de "grupos de alternativas". Cada nodo es
   uno de dos tipos: hoja ({tipo:"codigo", valor}) o operador ({tipo:"Y"|"O",
   hijos:[...]}). `materia.requisitos` / `materia.correquisitos` son `null`
   (sin requisitos) o un único nodo raíz. Estas funciones son la ÚNICA forma
   de construir/evaluar/recorrer nodos — el parser (Parte C), la evaluación
   de disponibilidad (Parte D), la UI (Parte E), la búsqueda inversa (Parte F)
   y el exportador (Parte G) deben reutilizarlas en vez de reimplementar la
   lógica de árbol cada uno por su lado. */

function crearNodoCodigo(valor) {
  return { tipo: "codigo", valor };
}

/** hijos: arreglo de 2+ nodos. Si solo llega 1 hijo, lo retorna tal cual
 *  (un operador de un solo hijo es redundante y complica la UI/migración). */
function crearNodoY(hijos) {
  const lista = (hijos || []).filter(Boolean);
  if (lista.length === 1) return lista[0];
  return { tipo: "Y", hijos: lista };
}

function crearNodoO(hijos) {
  const lista = (hijos || []).filter(Boolean);
  if (lista.length === 1) return lista[0];
  return { tipo: "O", hijos: lista };
}

/** Recorre el árbol completo y ejecuta `callback(nodoHoja)` por cada hoja
 *  encontrada, sin importar la profundidad. Usada por Parte F (búsqueda
 *  inversa "Es requisito de") y por Parte G (exportar) para no reescribir
 *  el recorrido recursivo en cada lugar que lo necesita. */
function recorrerHojasArbol(nodo, callback) {
  if (!nodo) return;
  if (nodo.tipo === "codigo") {
    callback(nodo);
    return;
  }
  if (nodo.tipo === "Y" || nodo.tipo === "O") {
    (nodo.hijos || []).forEach((hijo) => recorrerHojasArbol(hijo, callback));
  }
}

/** true/false: ¿existe en algún nivel del árbol una hoja con este código?
 *  Base de la Parte F — funciona sin importar la profundidad de anidamiento. */
function arbolContieneCodigo(nodo, codigo) {
  let encontrado = false;
  recorrerHojasArbol(nodo, (hoja) => {
    if (hoja.valor === codigo) encontrado = true;
  });
  return encontrado;
}

/** Evaluación recursiva de disponibilidad (candado/luz) — Parte D.
 *  `estaAprobada(codigo)` es un callback que decide si un código puntual
 *  cuenta como cumplido (normalmente: buscar la materia en el plan y
 *  chequear materia.estado === "aprobado"). */
function evaluarNodoRequisito(nodo, estaAprobada) {
  if (!nodo) return true; // sin requisitos
  if (nodo.tipo === "codigo") return !!estaAprobada(nodo.valor);
  if (nodo.tipo === "Y") return (nodo.hijos || []).every((h) => evaluarNodoRequisito(h, estaAprobada));
  if (nodo.tipo === "O") return (nodo.hijos || []).some((h) => evaluarNodoRequisito(h, estaAprobada));
  return false;
}

/** Migra el formato viejo de requisitos/correquisitos al árbol nuevo.
 *  Detecta dos formatos viejos posibles y hace lo mejor posible con cada uno
 *  (los datos viejos no tienen por qué ser perfectos — lo que importa es que
 *  de aquí en adelante todo lo nuevo se genere ya como árbol):
 *   - Arreglo plano de strings (ej. ["MA0101", "CE1101"]): se asume que cada
 *     código es un requisito independiente y TODOS son necesarios → nodo "Y".
 *   - Arreglo de arreglos (ej. [["MA0101"], ["MA0102","MA0103"]]) — el viejo
 *     modelo de "grupos de alternativas": cada grupo se vuelve un nodo "O" de
 *     sus códigos, y si hay más de un grupo, se combinan bajo un nodo "Y" raíz.
 *  Si el valor ya es un nodo del árbol nuevo (tiene `tipo`), se retorna intacto.
 */
function migrarRequisitoAArbol(valorViejo) {
  if (valorViejo === null || valorViejo === undefined) return null;

  // Ya es un nodo nuevo (hoja u operador) — nada que migrar.
  if (!Array.isArray(valorViejo) && typeof valorViejo === "object" && valorViejo.tipo) {
    return valorViejo;
  }

  if (!Array.isArray(valorViejo)) return null;
  if (valorViejo.length === 0) return null;

  const esArregloDeArreglos = valorViejo.every((el) => Array.isArray(el));
  if (esArregloDeArreglos) {
    const gruposO = valorViejo
      .map((grupo) => crearNodoO(grupo.filter((c) => typeof c === "string" && c).map(crearNodoCodigo)))
      .filter(Boolean);
    return crearNodoY(gruposO);
  }

  // Arreglo plano de strings: todos requeridos.
  const codigos = valorViejo.filter((c) => typeof c === "string" && c);
  return crearNodoY(codigos.map(crearNodoCodigo));
}

/* ===================== Plan de Estudios / Materias / Categorías ===================== */

/** Valores por defecto sugeridos según universidad (editables por el usuario).
 *  `tipos_horas`: llaves EXACTAS que va a tener materia.horas para planes de esa
 *  universidad. TEC solo maneja un total; UCR desglosa en 4 tipos. Para
 *  cualquier otra universidad, el usuario escribe su propia lista (ver
 *  PRESETS_TIPOS_HORAS y el modal "Nuevo Plan" en js/plan.js). */
const PARAMETROS_UNIVERSIDAD_DEFAULT = {
  TEC: { nombre_bloque: "Semestre", semanas_por_bloque: 16, horario_inicio_default: "07:30", horario_duracion_bloque_min: 50, tipos_horas: ["Horas"] },
  UCR: { nombre_bloque: "Semestre", semanas_por_bloque: 16, horario_inicio_default: "07:00", horario_duracion_bloque_min: 50, tipos_horas: ["Teoría", "Práctica", "Laboratorio", "Teoría-Práctica"] },
};

/** Presets rápidos de tipos_horas, usados tanto por el modal "Nuevo Plan" como
 *  por el selector de universidad que aparece en el panel de importación
 *  (antes de que el plan exista) — ver js/plan.js. */
const PRESETS_TIPOS_HORAS = {
  TEC: ["Horas"],
  UCR: ["Teoría", "Práctica", "Laboratorio", "Teoría-Práctica"],
};

function crearPlanEstudio({ nombre_carrera, universidad, codigo_plan, tipo_titulo, parametros_universidad }) {
  return sellarTimestamp({
    id: "plan_" + crypto.randomUUID(),
    nombre_carrera,
    universidad,
    codigo_plan: codigo_plan || null,
    // v1.12.5: detectado por la IA al importar (línea TIPO_TITULO:, ver
    // extraerMetadatosImportacion) — antes se leía y se descartaba sin
    // guardarse en ningún lado; ahora viaja con el plan para que la
    // exportación CSV de fidelidad completa pueda incluirlo de vuelta.
    tipo_titulo: tipo_titulo || null,
    parametros_universidad: {
      nombre_bloque: "Semestre",
      semanas_por_bloque: 16,
      escala_notas: 100,
      formula_ponderado: "creditos",
      horario_inicio_default: "07:30",
      horario_duracion_bloque_min: 50,
      nota_aprobacion: 70,           // por universidad/plan, editable en Ajustes
      umbral_pasar_raspando: 70,     // umbral real para "pasar raspando" (ej. 67.5)
      tipos_horas: ["Horas"], // se sobrescribe abajo con lo que traiga parametros_universidad
      ...(parametros_universidad || {}),
    },
    categorias: [],
    materias: [],
    // C.4 (v9): electivas/optativas detectadas al importar pero que el
    // usuario todavía NO agregó formalmente a la malla — mismo formato que
    // un objeto de materia (ver crearMateria), pero viven fuera de
    // `materias` a propósito, así nunca cuentan en ningún total mientras
    // estén aquí. Se mueven a `materias` (con es_optativa:true) al hacer
    // clic en "Agregar al plan de estudios".
    optativas_disponibles: [],
    // v1.12.15: mismo mecanismo que optativas_disponibles, pero para
    // materias que el import NO pudo ubicar en un bloque numérico claro Y
    // que tampoco parecen optativa/electiva (bloque "REVISAR" que la IA
    // escribe cuando no tiene certeza) — viven fuera de `materias` a
    // propósito, así tampoco cuentan en ningún total mientras estén aquí.
    // Se mueven a `materias` (con un bloque numerado real) al vincularlas
    // desde el bloque especial "Revisar" (ver plan-esquema.js).
    materias_revisar: [],
    // FIX sync (categorías): tumba de categorías eliminadas, mismo patrón
    // que _eliminados_materias — ver storage-merge.js / plan-categorias.js.
    _eliminados_categorias: [],
  });
}

/**
 * FIX CRÍTICO — bug real encontrado, no venía en el reporte original:
 * storage-merge.js y main.js tienen comentarios que describen esta función
 * ("ver sellarTimestamp en schema.js") como la pieza que sella
 * `_actualizadoEn`/`_dispositivoId` en cada entidad al crearla o editarla —
 * pero nunca se había escrito. En la práctica, NINGUNA materia, plan, etc.
 * tenía jamás un `_actualizadoEn` real: siempre quedaba en 0/undefined.
 * Con ambos lados en 0, esMasReciente() (storage-merge.js) nunca detecta un
 * "más reciente" real en ningún conflicto — el resultado neto es que la
 * fusión siempre conservaba la versión LOCAL y descartaba la REMOTA sin
 * importar cuál se editó de verdad más tarde, así que un cambio hecho en
 * el teléfono nunca llegaba a imponerse en la PC (ni viceversa), sin
 * importar cuánto se esperara — no era un problema de "cada cuánto
 * sincroniza", era que el desempate nunca tuvo datos reales con qué decidir.
 *
 * Debe llamarse sobre cualquier entidad (materia, plan, semestre, profesor,
 * evento de agenda, enlace, categoría, etc.) justo antes de
 * marcarCambioPendiente(), tanto al crearla como al editar cualquiera de
 * sus campos.
 */

/**
 * REVISIÓN 2 (reloj lógico — reemplaza Date.now() como base del orden):
 * `_actualizadoEn` empezó como Date.now() (milisegundos de pared). Eso
 * funciona mientras los relojes de los dispositivos estén bien puestos y
 * sincronizados, pero en la práctica NUNCA hay garantía de eso — un
 * teléfono con la hora mal puesta, una zona horaria distinta, o un simple
 * desvío de NTP puede hacer que una edición genuinamente MÁS NUEVA en el
 * tiempo real cargue un timestamp MÁS CHICO que una edición vieja del otro
 * dispositivo, y pierda la comparación sin que nadie se entere. Es un bug
 * de raíz distinto (y más traicionero) que el de "nunca se llamaba
 * sellarTimestamp": ese al menos era consistente (siempre 0); este fallaría
 * de forma silenciosa y solo en el peor momento (relojes desincronizados).
 *
 * La solución estándar para esto (Git, CRDTs, Lamport clocks) es dejar de
 * usar tiempo de PARED y usar un CONTADOR LÓGICO: un entero que cada
 * dispositivo solo sube, nunca baja, y que además se ajusta hacia arriba
 * cada vez que el dispositivo VE un contador más alto que el propio
 * (viniendo de otro dispositivo, al fusionar). Esto garantiza que el orden
 * relativo entre dos ediciones que un mismo dispositivo pudo haber visto
 * una después de otra SIEMPRE se refleje correctamente, sin depender de
 * ningún reloj de pared. Nunca hay ambigüedad de "mi reloj está adelantado"
 * porque no hay reloj — solo hay un contador que nunca miente sobre el
 * orden causal que el dispositivo mismo observó.
 */

const CLAVE_DISPOSITIVO_ID = "app_academica_dispositivo_id";
const CLAVE_RELOJ_LOGICO = "app_academica_reloj_logico";

/**
 * Id único y estable de ESTE navegador/dispositivo (no de la persona — la
 * misma persona en PC y en teléfono tiene dos ids distintos, cada uno
 * generado una sola vez y guardado en localStorage). Se usa como desempate
 * determinista en sellarTimestamp() para el caso rarísimo de dos ediciones
 * con el mismo contador lógico exacto, y como identificador de "quién
 * escribió esto" para el detector de conflictos reales (ver
 * marcarConflictoSiCorresponde en storage-merge.js).
 */
function obtenerDispositivoId() {
  try {
    let id = localStorage.getItem(CLAVE_DISPOSITIVO_ID);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLAVE_DISPOSITIVO_ID, id);
    }
    return id;
  } catch (e) {
    return "desconocido";
  }
}

/**
 * Lee el reloj lógico actual de ESTE dispositivo (0 si nunca se usó).
 * Nunca revienta si localStorage no está disponible (ej. modo privado con
 * restricciones) — en ese caso el contador simplemente vive solo en memoria
 * durante la sesión, degradando con seguridad en vez de tronar la app.
 */
let _relojLogicoMemoria = 0;

function leerRelojLogico() {
  try {
    const crudo = localStorage.getItem(CLAVE_RELOJ_LOGICO);
    const n = Number(crudo);
    return Number.isFinite(n) && n > 0 ? n : _relojLogicoMemoria;
  } catch (e) {
    return _relojLogicoMemoria;
  }
}

function guardarRelojLogico(valor) {
  _relojLogicoMemoria = valor;
  try {
    localStorage.setItem(CLAVE_RELOJ_LOGICO, String(valor));
  } catch (e) {
    // Sin localStorage disponible: el contador sigue funcionando en memoria
    // para el resto de esta sesión (degradación segura, nunca un throw).
  }
}

/**
 * Sube el reloj lógico de este dispositivo en 1 y devuelve el nuevo valor.
 * Se usa cada vez que se sella una entidad NUEVA o EDITADA localmente.
 */
function avanzarRelojLogico() {
  const nuevo = leerRelojLogico() + 1;
  guardarRelojLogico(nuevo);
  return nuevo;
}

/**
 * Regla estándar de reloj de Lamport: cada vez que este dispositivo VE un
 * contador ajeno (viniendo de una entidad remota, al fusionar), su propio
 * reloj se adelanta para quedar siempre por delante de cualquier cosa que
 * ya haya visto. Así, la PRÓXIMA vez que este dispositivo edite algo, su
 * contador es garantizado más alto que cualquier edición ajena que ya
 * conoce — el orden causal nunca se pierde. Se expone para que
 * storage-merge.js la llame al procesar cada entidad remota.
 */
function observarRelojLogico(valorAjeno) {
  const ajeno = Number(valorAjeno) || 0;
  const propio = leerRelojLogico();
  if (ajeno > propio) guardarRelojLogico(ajeno);
}

/**
 * Sella una entidad con el contador lógico (reemplaza Date.now()),
 * el id de dispositivo (desempate) y `_version_base`: el contador que
 * tenía la entidad ANTES de este sellado (su "padre" causal). Esa base es
 * la pieza clave que permite a storage-merge.js distinguir dos casos que
 * antes se trataban igual pero son muy distintos:
 *   - Edición secuencial real: alguien editó la versión que YA conocía del
 *     otro dispositivo → hay una línea causal continua, no hay conflicto.
 *   - Edición concurrente real (tu caso: mismo campo cambiado en ambos
 *     dispositivos sin que ninguno supiera del otro) → ambas ediciones
 *     parten de la MISMA base pero terminan en valores distintos → eso SÍ
 *     es un choque real, y en vez de que uno se pierda en silencio, se
 *     marca `_conflicto: true` (ver marcarConflictoSiCorresponde).
 * `entidad._actualizadoEn` (si ya existía, ej. una edición sobre algo que
 * vino de sync) es la base; si es una creación nueva, la base es 0.
 */
function sellarTimestamp(entidad) {
  const baseAnterior = Number(entidad._actualizadoEn) || 0;
  entidad._version_base = baseAnterior;
  entidad._actualizadoEn = avanzarRelojLogico();
  entidad._dispositivoId = obtenerDispositivoId();
  return entidad;
}

/**
 * Semestres y Notas — Fase 1: devuelve, en orden, los ids de los planes que
 * cuentan como "activos" ahora mismo según Modo Hardcore. Con Hardcore
 * apagado siempre es un solo id (o vacío si todavía no hay plan activo).
 * Único punto de verdad para "cuáles planes participan" — lo reutilizan
 * tanto el selector de materias al dar de alta un semestre como cualquier
 * otro lugar que necesite saber "en qué carreras estoy ahora".
 */
function obtenerPlanesActivos(configuracion) {
  if (!configuracion) return [];
  if (!configuracion.modo_hardcore) {
    return configuracion.plan_activo_id ? [configuracion.plan_activo_id] : [];
  }
  return [
    configuracion.plan_activo_id,
    configuracion.plan_activo_secundario_id,
    configuracion.plan_activo_terciario_id,
  ].filter(Boolean);
}

/**
 * Semestres y Notas — Fase 1: crea un Semestre nuevo, sellado igual que
 * cualquier otra entidad (ver sellarTimestamp). `planesEstudioIds` siempre
 * se guarda como arreglo — incluso con Hardcore apagado y un solo plan —
 * para no tener dos formatos distintos (valor suelto vs. arreglo) según el
 * modo; así cualquier código que lo consuma después solo tiene que manejar
 * un caso.
 *
 * NO incluye todavía: horario, criterios/asignaciones de nota, ni el botón
 * "Terminar semestre" (mover a historial + revisión pasó/no-pasó por
 * materia, con sugerencia según la nota) — todo eso depende del motor de
 * notas de la Fase 6 y queda fuera de esta entrega a propósito.
 */
function crearSemestre({ nombre, fecha_inicio, duracion_semanas, planesEstudioIds }) {
  const semanas = Math.min(Number(duracion_semanas) || 16, LIMITE_SEMANAS_SEMESTRE);
  const planes = Array.isArray(planesEstudioIds) ? planesEstudioIds.filter(Boolean) : [planesEstudioIds].filter(Boolean);

  return sellarTimestamp({
    id: "sem_" + crypto.randomUUID(),
    plan_estudio_id: planes,
    nombre,
    fecha_inicio, // "YYYY-MM-DD"
    duracion_semanas: semanas,
    // null = calcular "actual"/"pasado" por fecha (ver obtenerEstadoEfectivoSemestre).
    // "actual" | "pasado" = el usuario lo forzó a mano porque la detección
    // automática le falló (ej. fecha de inicio mal puesta).
    estado_manual: null,
    materias_matriculadas: [],
    // Semestres y Notas — Fase 1 (regla obligatoria de sincronización): tumba
    // propia para materias matriculadas borradas, igual que
    // plan._eliminados_materias — ver fusionarSemestre en storage-merge.js.
    _eliminados_materias_matriculadas: [],
  });
}

/**
 * Semestres y Notas — Fase 1: estado EFECTIVO de un semestre — nunca se lee
 * semestre.estado directamente porque ese campo no existe (a propósito, ver
 * comentario en crearSemestre): se calcula siempre en el momento, así nunca
 * queda desactualizado por no haberse re-guardado.
 *
 * Auto-cierre: sin el botón "Terminar semestre" todavía (Fase 6, depende de
 * notas), este cálculo por fecha es la ÚNICA forma en que un semestre pasa a
 * "pasado" en esta fase — al llegar a LIMITE_SEMANAS_SEMESTRE desde
 * fecha_inicio, se cierra solo, sin preguntarle nada al usuario (no hay
 * review de materias todavía). Cuando se construya "Terminar semestre", ese
 * botón va a poder cerrar el semestre ANTES de este límite; este cálculo
 * sigue funcionando igual como red de seguridad para quien nunca lo aprieta.
 */
function obtenerEstadoEfectivoSemestre(semestre) {
  if (semestre.estado_manual === "actual" || semestre.estado_manual === "pasado") {
    return semestre.estado_manual;
  }
  const inicio = new Date(semestre.fecha_inicio);
  if (isNaN(inicio.getTime())) return "actual"; // fecha inválida: no se puede calcular, no se fuerza a "pasado"
  const semanasTranscurridas = (Date.now() - inicio.getTime()) / (7 * 24 * 60 * 60 * 1000);
  return semanasTranscurridas >= LIMITE_SEMANAS_SEMESTRE ? "pasado" : "actual";
}

/**
 * D/E/F (Semestres y Notas): estado EFECTIVO de una materia del Plan — igual
 * que obtenerEstadoEfectivoSemestre, nunca se lee materia.estado solo cuando
 * importa mostrar "Cursando": ese valor YA NO se guarda en ningún lado (a
 * propósito, decisión confirmada 2026-08-02), se calcula siempre en el
 * momento. materia.estado queda 100% manual/sticky y solo puede valer
 * "pendiente" | "aprobado" | "reprobado" (ver el pill group de 3 opciones en
 * plan-vista-lista-tarjetas.js) — es la fuente de verdad de "¿ya la pasé
 * alguna vez?", y por eso nunca se pisa sola al matricular o repetir.
 * "Cursando" gana SIEMPRE que haya una mm real matriculando esta materia
 * (mismo materia_id + mismo plan_estudio_id, para no cruzar materias con
 * códigos coincidentes entre dos planes distintos en Modo Hardcore) dentro
 * de un semestre cuyo estado efectivo sea "actual" — sin importar qué diga
 * materia.estado debajo: es la forma en que repetir una "Aprobada" deja de
 * contar como aprobada mientras se está cursando de nuevo (decisión ya
 * confirmada), sin necesidad de tocar el campo sticky para lograrlo.
 */
function obtenerEstadoEfectivoMateria(materia, planEstudioId, datos) {
  const estaCursandoAhora = (datos.semestres || []).some((semestre) => {
    if (obtenerEstadoEfectivoSemestre(semestre) !== "actual") return false;
    return (semestre.materias_matriculadas || []).some(
      (mm) => mm.materia_id === materia.id && mm.plan_estudio_id === planEstudioId
    );
  });
  return estaCursandoAhora ? "cursando" : materia.estado;
}

/**
 * Semestres y Notas — Fase 1: matricula una materia real del Plan dentro de
 * un semestre. Deliberadamente mínima — sin criterios/asignaciones/
 * nota_final (Fase 6) — porque su "estado" nunca vive acá: se lee siempre en
 * vivo desde la materia real en plan.materias por materia_id (ver punto de
 * sincronía en semestres.js). Repetir una materia "Aprobada": está permitido
 * a propósito (no hay ninguna validación que lo bloquee) — matricularla
 * vuelve a poner esa materia en "cursando" en el Plan (mismo mecanismo que
 * cualquier cambio de estado manual), así que mientras se está repitiendo
 * deja de contar como aprobada en los totales, igual que decidiste.
 */
function crearMateriaMatriculada({ materiaId, planEstudioId }) {
  return sellarTimestamp({
    id: "mm_" + crypto.randomUUID(),
    materia_id: materiaId,
    plan_estudio_id: planEstudioId,
    // Fase 6 (motor de notas): criterios de ESTA matrícula puntual (nunca
    // de la materia del plan) — cada criterio trae su propio array de
    // asignaciones anidado (ver crearCriterio).
    criterios: [],
    // Calculado en vivo por calcularNotaFinalMateria; solo se asigna a
    // mano vía el override de abajo.
    nota_final: null,
    // true = override manual activo (caso excepcional). Mientras esté en
    // true, calcularNotaFinalMateria no debe pisar el valor — la UI debe
    // mostrar la marca "editado a mano" (badge-warning) y ofrecer volver
    // a modo automático.
    nota_final_manual: false,
    // D/E/F (Semestres y Notas): resultado REAL de este intento puntual —
    // independiente de materia.estado (que vive en el Plan y es 100%
    // manual/sticky, ver ESTADOS_MATERIA en plan-vista-lista-tarjetas.js).
    // Solo lo escribe "Terminar semestre" (semestres-tarjetas.js), comparando
    // nota_final contra el umbral del plan — nunca se toca a mano ni se
    // deriva en el render. null = todavía no se cerró el semestre, o se
    // cerró con notas incompletas (no se adivina, decisión ya confirmada).
    resultado: null,
    // Tumba de criterios borrados de esta matrícula (regla obligatoria de
    // sincronización) — ver fusionarMateriaMatriculada en storage-merge.js.
    _eliminados_criterios: [],
  });
}

/**
 * Fase 6: un criterio de evaluación dentro de una materia matriculada (ej.
 * "Exámenes", 75% de la materia). `valorTotal` es el peso del criterio
 * DENTRO de la materia (0-100). Trae su propio array de asignaciones y su
 * propia tumba, igual que cualquier otra colección anidada del proyecto.
 */
function crearCriterio({ nombre, valorTotal }) {
  return sellarTimestamp({
    id: "crit_" + crypto.randomUUID(),
    nombre,
    valor_total: Number(valorTotal) || 0,
    asignaciones: [],
    _eliminados_asignaciones: [],
  });
}

/**
 * Una asignación puntual dentro de un criterio (ej. "Examen I", 15% de la
 * materia). `valor` está expresado en los MISMOS puntos que valor_total
 * del criterio (no relativo al criterio) — así una tarea de 5% y un
 * examen de 15% se suman directo sin conversión. `nota` queda en null
 * hasta que el usuario la registra (según la escala activa).
 */
function crearAsignacion({ nombre, valor }) {
  return sellarTimestamp({
    id: "asig_" + crypto.randomUUID(),
    nombre,
    valor: Number(valor) || 0,
    nota: null,
    // Fase 6.1 (2026-08-02): "automatico" = participa del reparto
    // equitativo (ver repartirEquitativoCriterio); "personalizado" = el
    // usuario fijó el valor a mano y nunca se toca. "nota" = calificación en
    // escala 0-escalaActiva (comportamiento de siempre); "puntos" = la
    // calificación son puntos directos, con tope en `valor`.
    modo_valor: "automatico",
    modo_calificacion: "nota",
  });
}

/**
 * Reparto equitativo (Fase 6.1, decisión confirmada 2026-08-02): las
 * asignaciones en modo "personalizado" mantienen el valor que el usuario
 * fijó a mano y NUNCA se tocan acá. Las "automatico" se reparten en partes
 * iguales lo que SOBRA del criterio después de restar la suma de las
 * personalizadas — no el total completo (ej. criterio de 100pts con una
 * personalizada de 40 y dos automáticas → cada automática = 30, no 33.3).
 * Si no queda ninguna "automatico", no hay nada que repartir.
 */
function repartirEquitativoCriterio(criterio) {
  const automaticas = (criterio.asignaciones || []).filter((a) => a.modo_valor !== "personalizado");
  if (automaticas.length === 0) return;
  const sumaPersonalizadas = (criterio.asignaciones || [])
    .filter((a) => a.modo_valor === "personalizado")
    .reduce((total, a) => total + (Number(a.valor) || 0), 0);
  const restante = Math.max(criterio.valor_total - sumaPersonalizadas, 0);
  const partePlana = restante / automaticas.length;
  automaticas.forEach((asig) => {
    asig.valor = partePlana;
    sellarTimestamp(asig);
  });
}

/**
 * Escala de notas activa (10 o 100) para una materia matriculada: override
 * propio > escala del plan/universidad > escala global. Único punto de
 * verdad — reutilizar en vez de leer los 3 campos por separado.
 */
function obtenerEscalaNotasMateria(materia, plan, configuracion) {
  return (
    (materia && materia.escala_notas_override) ||
    (plan && plan.parametros_universidad && plan.parametros_universidad.escala_notas) ||
    (configuracion && configuracion.escala_notas_global) ||
    100
  );
}

/**
 * Motor de cálculo (punto 3): puntos ponderados reales que aporta una
 * asignación calificada, normalizados a escala 0-100. Sin nota todavía
 * (null) no aporta puntos — se trata como pendiente, nunca como un cero.
 */
function calcularPuntosAsignacion(asignacion, escalaActiva) {
  if (asignacion.nota === null || asignacion.nota === undefined) return 0;
  if (asignacion.modo_calificacion === "puntos") {
    // Puntos directos: el usuario ya reporta cuánto obtuvo, con tope en el
    // valor de la asignación (no se divide por escala — no aplica).
    return Math.min(Number(asignacion.nota) || 0, Number(asignacion.valor) || 0);
  }
  return (Number(asignacion.nota) / escalaActiva) * asignacion.valor;
}

/**
 * nota_final de una materia matriculada (0-100): suma de los puntos de
 * TODAS las asignaciones calificadas de TODOS sus criterios. Si
 * nota_final_manual está activo, esta función NO debe llamarse para pisar
 * el valor — la UI debe respetar el override hasta que el usuario lo
 * desactive explícitamente.
 */
function calcularNotaFinalMateria(materiaMatriculada, escalaActiva) {
  let total = 0;
  (materiaMatriculada.criterios || []).forEach((criterio) => {
    (criterio.asignaciones || []).forEach((asig) => {
      total += calcularPuntosAsignacion(asig, escalaActiva);
    });
  });
  return total;
}

/**
 * FIX sync (bug real encontrado en esta ronda de auditoría): a diferencia
 * de crearMateria y crearPlanEstudio, esta función NUNCA llamaba a
 * sellarTimestamp() — toda categoría nacía sin _actualizadoEn real. En
 * storage-merge.js, fusionarColeccion() para categorías queda igual de
 * ciego que estaba materias antes del fix: con ambos lados en 0/undefined,
 * un conflicto de categorías con el mismo id siempre se resolvía a favor
 * de la local, sin importar cuál se editó de verdad más tarde.
 */
function crearCategoria({ nombre, color }) {
  return sellarTimestamp({ id: "cat_" + crypto.randomUUID(), nombre, color });
}

/**
 * Crea una materia a partir de una fila ya parseada del CSV o del formulario
 * manual (ver js/plan.js). `horas` debe venir como un objeto con EXACTAMENTE
 * las llaves de `tiposHoras` (mismo orden no importa, solo las llaves);
 * cualquier llave ausente se rellena en 0 y cualquier llave que no esté en
 * `tiposHoras` se descarta — así materia.horas nunca tiene campos de más ni
 * de menos respecto al plan al que pertenece.
 */
function crearMateria({ codigo, nombre, creditos, horas, tiposHoras, bloque, requisitos, correquisitos, esOptativa, sinDefinir }) {
  // v7 #1: un arreglo vacío es una elección válida ("No aplica" — el plan no
  // maneja horas). Solo se usa el default ["Horas"] cuando tiposHoras
  // realmente no vino (undefined/null), nunca cuando vino vacío a propósito.
  const tipos = tiposHoras || ["Horas"];
  const horasFinal = {};
  tipos.forEach((tipo) => {
    horasFinal[tipo] = Number((horas || {})[tipo]) || 0;
  });

  return sellarTimestamp({
    id: codigo, // el código funciona como id único dentro del plan
    codigo,
    nombre,
    creditos,
    horas: horasFinal,
    bloque,
    // v1.12: null (sin requisitos) o un único nodo raíz del árbol Y/O.
    // No se migra aquí — quien llama a crearMateria (parser CSV, formulario
    // manual) ya debe entregar el nodo construido o null.
    requisitos: requisitos || null,
    correquisitos: correquisitos || null,
    categoria_id: null,
    estado: "pendiente",
    escala_notas_override: null,
    // C.4 (v9): true si esta materia se detectó como electiva/optativa al
    // importar. No cambia cómo se calcula nada por sí sola — lo que decide
    // si cuenta en los totales es si vive en `plan.materias` (cuenta) o en
    // `plan.optativas_disponibles` (no cuenta, ver js/plan.js).
    es_optativa: !!esOptativa,
    // v1.14.1: reemplaza por completo la detección por prefijo de código
    // (OPT-/ELEC-) que existía antes — aquella obligaba a la IA a inventar o
    // sobrescribir el código real de un espacio de electiva/optativa dentro
    // de un bloque numerado solo para poder detectarlo después, lo cual
    // manipulaba datos reales de la fuente. Ahora es un campo independiente:
    // true = esta fila todavía no representa una materia real elegida (es un
    // espacio reservado dentro de un bloque, ej. "Electivo 1"), sin importar
    // qué diga su Código o Nombre — el Código/Nombre reales del documento
    // NUNCA se tocan ni se inventan para marcar esto.
    sin_definir: !!sinDefinir,
    // v1.12.16 (Ajuste 2): si esta materia reemplazó a un cupo genérico de
    // electiva/optativa (ver reemplazarCupoOptativa en plan-esquema.js),
    // guarda acá el nombre que tenía el cupo antes de reemplazarse (ej.
    // "Repertorio", "Optativa") — null si esta materia nunca fue un cupo
    // genérico reemplazado. Se muestra en su tarjeta, debajo de Requisitos.
    cupo_generico_original: null,
  });
}

/**
 * Migración del modelo viejo de horas ({teoria,practica,laboratorio,
 * teoria_practica} fijo + horas_detalladas boolean) al modelo dinámico
 * (tipos_horas + materia.horas con esas llaves exactas). Se llama una sola
 * vez, apenas se cargan los datos del usuario (cache local o Drive), antes
 * de renderizar nada. Es segura de llamar siempre: si los datos ya están en
 * el formato nuevo, no hace nada.
 */
const MAPEO_HORAS_VIEJO_A_NUEVO = {
  teoria: "Teoría",
  practica: "Práctica",
  laboratorio: "Laboratorio",
  teoria_practica: "Teoría-Práctica",
};

function migrarDatosAntiguos(datos) {
  if (!datos) return datos;

  // v1.15 (Parte 2): relleno defensivo para paletas personalizadas creadas
  // antes de que existiera el degradado configurable — quedan con
  // degradado.activo=false (blanco sólido, el mismo comportamiento de
  // siempre) hasta que el usuario entre al editor y lo active a propósito.
  // Nunca se cambia nada más de sus colores existentes.
  const paletaPersonalizada = datos.configuracion && datos.configuracion.paleta_personalizada;
  if (paletaPersonalizada && paletaPersonalizada.colores && !paletaPersonalizada.colores.degradado) {
    paletaPersonalizada.colores.degradado = {
      activo: false,
      color: paletaPersonalizada.colores.accent2 || null,
      intensidad: 50,
      angulo: 90,
    };
  }

  // Semestres y Notas — Fase 1: relleno defensivo para cuentas creadas antes
  // de que Hardcore soportara un 3er plan — sin esto, un usuario viejo con
  // Hardcore activo tendría plan_activo_terciario_id === undefined en vez de
  // null, lo cual rompería obtenerPlanesActivos() (undefined no es "vacío" de
  // forma consistente en todos lados) y confundiría al selector de 3 botones.
  if (datos.configuracion && datos.configuracion.plan_activo_terciario_id === undefined) {
    datos.configuracion.plan_activo_terciario_id = null;
  }

  // FIX sync (2026-08-02): materias matriculadas creadas antes del motor de
  // notas (Fase 6) no tienen criterios/_eliminados_criterios/nota_final/
  // nota_final_manual — ni siquiera como arreglo vacío o null explícito, el
  // campo directamente no existe en el objeto guardado. Sin este relleno,
  // en cuanto UN dispositivo abre esa materia y la re-renderiza, termina con
  // estos campos poblados en memoria mientras la copia remota (guardada por
  // el otro dispositivo, que nunca la tocó) sigue sin ellos — contenido
  // distinto con la MISMA _version_base, que storage-merge.js interpreta
  // como un conflicto real cuando no lo es. Esto pasaba con CUALQUIER
  // materia vieja, por eso salía "de la nada" en todas a la vez. Se aplica
  // siempre a los dos lados antes de comparar (ver fusionarDatos en
  // storage-merge.js), así ambos arrancan del mismo default y no hay nada
  // que comparar como "distinto" en materias que nadie editó de verdad.
  if (Array.isArray(datos.semestres)) {
    datos.semestres.forEach((semestre) => {
      if (!Array.isArray(semestre._eliminados_materias_matriculadas)) {
        semestre._eliminados_materias_matriculadas = [];
      }
      (semestre.materias_matriculadas || []).forEach((mm) => {
        if (!Array.isArray(mm.criterios)) mm.criterios = [];
        if (!Array.isArray(mm._eliminados_criterios)) mm._eliminados_criterios = [];
        if (mm.nota_final === undefined) mm.nota_final = null;
        if (mm.nota_final_manual === undefined) mm.nota_final_manual = false;
        // D/E/F (2026-08-02): mismo relleno defensivo para mm creadas antes
        // de que existiera resultado — sin esto, una mm vieja sin este campo
        // se ve "distinta" de su copia remota en cuanto un dispositivo la
        // toca, disparando el mismo tipo de conflicto falso que ya se
        // documentó arriba para criterios/nota_final.
        if (mm.resultado === undefined) mm.resultado = null;
        // Fase 6.1 (2026-08-02): asignaciones creadas antes del switch
        // Automático/Personalizado y Nota/Puntos se tratan como
        // "automatico" + "nota" — es exactamente el comportamiento que ya
        // tenían (reparto equitativo siempre, calificación siempre en
        // escala 0-escalaActiva). Mismo relleno defensivo que el resto de
        // esta función: sin esto, un lado sin estos campos se ve "distinto"
        // del otro lado que sí los tiene, y dispara un conflicto falso.
        mm.criterios.forEach((criterio) => {
          if (!Array.isArray(criterio.asignaciones)) criterio.asignaciones = [];
          if (!Array.isArray(criterio._eliminados_asignaciones)) criterio._eliminados_asignaciones = [];
          criterio.asignaciones.forEach((asig) => {
            if (asig.modo_valor === undefined) asig.modo_valor = "automatico";
            if (asig.modo_calificacion === undefined) asig.modo_calificacion = "nota";
          });
        });
      });
    });
  }

  if (!Array.isArray(datos.planes_estudio)) return datos;

  datos.planes_estudio.forEach((plan) => {
    // C.4 (v9): planes creados antes de esta versión no tienen este arreglo
    // — se rellena vacío para que push()/filter() nunca truene con undefined.
    if (!Array.isArray(plan.optativas_disponibles)) plan.optativas_disponibles = [];
    // v1.12.15: mismo relleno defensivo para planes creados antes de que
    // existiera el bloque especial "Revisar".
    if (!Array.isArray(plan.materias_revisar)) plan.materias_revisar = [];
    // FIX sync (categorías): mismo relleno defensivo para planes creados
    // antes de que existiera la tumba de categorías.
    if (!Array.isArray(plan._eliminados_categorias)) plan._eliminados_categorias = [];

    const params = plan.parametros_universidad || (plan.parametros_universidad = {});
    const esFormatoViejo = typeof params.horas_detalladas === "boolean" && !Array.isArray(params.tipos_horas);

    if (esFormatoViejo) {
      params.tipos_horas = params.horas_detalladas
        ? ["Teoría", "Práctica", "Laboratorio", "Teoría-Práctica"]
        : ["Horas"];
      delete params.horas_detalladas;
    } else if (!Array.isArray(params.tipos_horas)) {
      // Por si acaso: plan sin tipos_horas y sin el booleano viejo tampoco.
      params.tipos_horas = ["Horas"];
    }

    if (params.nota_aprobacion === undefined) params.nota_aprobacion = 70;
    if (params.umbral_pasar_raspando === undefined) params.umbral_pasar_raspando = params.nota_aprobacion;

    (plan.materias || []).forEach((materia) => {
      const horasViejas = materia.horas || {};
      const esObjetoViejo = "teoria" in horasViejas || "practica" in horasViejas ||
        "laboratorio" in horasViejas || "teoria_practica" in horasViejas;

      if (esObjetoViejo) {
        const nuevasHoras = {};
        params.tipos_horas.forEach((tipo) => {
          // Busca la llave vieja equivalente a este tipo nuevo (si tipos_horas
          // es el desglose UCR estándar); si no hay equivalencia, deja 0.
          const llaveVieja = Object.keys(MAPEO_HORAS_VIEJO_A_NUEVO).find(
            (k) => MAPEO_HORAS_VIEJO_A_NUEVO[k] === tipo
          );
          nuevasHoras[tipo] = Number(llaveVieja ? horasViejas[llaveVieja] : horasViejas[tipo]) || 0;
        });
        materia.horas = nuevasHoras;
      } else {
        // Ya está en formato "nuevo" pero puede que le falten/sobren llaves
        // respecto a tipos_horas actual del plan (ej. cambiaron el preset).
        const normalizado = {};
        params.tipos_horas.forEach((tipo) => {
          normalizado[tipo] = Number(horasViejas[tipo]) || 0;
        });
        materia.horas = normalizado;
      }

      // v1.12: requisitos/correquisitos de arreglo(s) plano(s) → árbol Y/O.
      // Seguro de llamar siempre: si ya es un nodo del árbol nuevo (o null),
      // migrarRequisitoAArbol lo retorna intacto sin tocarlo.
      materia.requisitos = migrarRequisitoAArbol(materia.requisitos);
      materia.correquisitos = migrarRequisitoAArbol(materia.correquisitos);

      // v1.14.1: migración de una sola vez para planes importados ANTES de
      // este campo, cuando la detección de "espacio reservado de electiva/
      // optativa" todavía dependía de que el CÓDIGO llevara el prefijo
      // OPT-/ELEC- (esquema viejo, ya no se usa más para esto — ver
      // crearMateria). Si el plan ya trae `sin_definir` no se toca nada; si
      // no lo trae, se infiere UNA VEZ de ese prefijo viejo para no perder
      // los cupos ya detectados con planes existentes, y de ahí en adelante
      // el campo vive independiente del código (que nunca más se inventa).
      if (materia.sin_definir === undefined) {
        materia.sin_definir = /^(OPT|ELEC)-/i.test(String(materia.codigo || "").trim());
      }

      // v1.12.16: relleno defensivo para materias de planes creados antes de
      // que existiera este campo.
      if (materia.cupo_generico_original === undefined) materia.cupo_generico_original = null;
    });
  });

  // 2026-08-02 ("marca el segundo y tercero aunque uno no existe"): si
  // plan_activo_secundario_id/terciario_id (o incluso plan_activo_id) quedan
  // apuntando a un plan que ya no está en datos.planes_estudio — por un
  // borrado que no pasó por eliminarPlan (plan-gestionar.js), o por un
  // choque de sincronización que trajo una config vieja — obtenerPlanesActivos
  // los sigue devolviendo igual (solo filtra "vacío", no "existe de verdad"),
  // así que ARMAN de más el conteo de planes activos con ids fantasma. Se
  // limpian acá, en la migración, para que la config nunca quede así de aquí
  // en adelante.
  const cfgLimpieza = datos.configuracion;
  if (cfgLimpieza) {
    const idsReales = new Set(datos.planes_estudio.map((p) => p.id));
    if (cfgLimpieza.plan_activo_id && !idsReales.has(cfgLimpieza.plan_activo_id)) {
      cfgLimpieza.plan_activo_id = datos.planes_estudio[0] ? datos.planes_estudio[0].id : null;
    }
    if (cfgLimpieza.plan_activo_secundario_id && !idsReales.has(cfgLimpieza.plan_activo_secundario_id)) {
      cfgLimpieza.plan_activo_secundario_id = null;
    }
    if (cfgLimpieza.plan_activo_terciario_id && !idsReales.has(cfgLimpieza.plan_activo_terciario_id)) {
      cfgLimpieza.plan_activo_terciario_id = null;
    }
  }

  return datos;
}

export {
  LIMITE_ENLACES_RAPIDOS,
  MAPEO_HORAS_VIEJO_A_NUEVO,
  PALETAS_DISPONIBLES,
  PARAMETROS_UNIVERSIDAD_DEFAULT,
  PRESETS_TIPOS_HORAS,
  arbolContieneCodigo,
  crearCategoria,
  crearDatosUsuarioNuevo,
  crearEnlaceRapido,
  crearMateria,
  crearNodoCodigo,
  crearNodoO,
  crearNodoY,
  crearPlanEstudio,
  evaluarNodoRequisito,
  migrarDatosAntiguos,
  migrarRequisitoAArbol,
  obtenerDispositivoId,
  observarRelojLogico,
  recorrerHojasArbol,
  sellarTimestamp,
  crearMateriaMatriculada,
  crearSemestre,
  LIMITE_SEMANAS_SEMESTRE,
  obtenerEstadoEfectivoSemestre,
  obtenerPlanesActivos,
  crearCriterio,
  crearAsignacion,
  repartirEquitativoCriterio,
  obtenerEscalaNotasMateria,
  calcularPuntosAsignacion,
  calcularNotaFinalMateria,
  obtenerEstadoEfectivoMateria,
};
