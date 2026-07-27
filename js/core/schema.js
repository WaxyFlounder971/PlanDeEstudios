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
      escala_notas_global: 100,     // 10 o 100 (1-10 ó 1-100)
      formato_texto_nombres: "titulo", // "titulo" | "mayusculas" | "oracion" (v5 #9)
      plan_activo_id: null,         // id del Plan de Estudios seleccionado como activo
      enlaces_rapidos: [],          // ver estructura de "enlace" abajo (máx. 20)

      // --- Modo Hardcore 💀 (doble carrera) ---
      modo_hardcore: false,          // si está activo, se combina un plan principal + uno secundario
      plan_activo_secundario_id: null, // id del segundo Plan de Estudios (solo relevante si modo_hardcore = true)
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

function crearPlanEstudio({ nombre_carrera, universidad, codigo_plan, parametros_universidad }) {
  return {
    id: "plan_" + crypto.randomUUID(),
    nombre_carrera,
    universidad,
    codigo_plan: codigo_plan || null,
    parametros_universidad: {
      nombre_bloque: "Semestre",
      semanas_por_bloque: 16,
      escala_notas: 100,
      formula_ponderado: "creditos",
      horario_inicio_default: "07:30",
      horario_duracion_bloque_min: 50,
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
  };
}

function crearCategoria({ nombre, color }) {
  return { id: "cat_" + crypto.randomUUID(), nombre, color };
}

/**
 * Crea una materia a partir de una fila ya parseada del CSV o del formulario
 * manual (ver js/plan.js). `horas` debe venir como un objeto con EXACTAMENTE
 * las llaves de `tiposHoras` (mismo orden no importa, solo las llaves);
 * cualquier llave ausente se rellena en 0 y cualquier llave que no esté en
 * `tiposHoras` se descarta — así materia.horas nunca tiene campos de más ni
 * de menos respecto al plan al que pertenece.
 */
function crearMateria({ codigo, nombre, creditos, horas, tiposHoras, bloque, requisitos, correquisitos, esOptativa }) {
  // v7 #1: un arreglo vacío es una elección válida ("No aplica" — el plan no
  // maneja horas). Solo se usa el default ["Horas"] cuando tiposHoras
  // realmente no vino (undefined/null), nunca cuando vino vacío a propósito.
  const tipos = tiposHoras || ["Horas"];
  const horasFinal = {};
  tipos.forEach((tipo) => {
    horasFinal[tipo] = Number((horas || {})[tipo]) || 0;
  });

  return {
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
  };
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
  if (!datos || !Array.isArray(datos.planes_estudio)) return datos;

  datos.planes_estudio.forEach((plan) => {
    // C.4 (v9): planes creados antes de esta versión no tienen este arreglo
    // — se rellena vacío para que push()/filter() nunca truene con undefined.
    if (!Array.isArray(plan.optativas_disponibles)) plan.optativas_disponibles = [];

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
    });
  });

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
  recorrerHojasArbol,
};
