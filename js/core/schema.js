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
      formato_texto_nombres: "titulo", // "titulo" | "mayusculas" | "oracion" (v5 #9)
      // v1.16 (2026-08-21): "Modo rendimiento" pasa a ser el default para
      // TODOS los usuarios nuevos (antes había que activarlo a mano). El
      // modo "normal" de siempre se renombra a "fancy" de cara al usuario
      // y queda como la opción manual, en el mismo switch pero invertido
      // (ver el bloque del switch en config-ajustes.js). El nombre interno
      // del campo se mantiene igual para no tocar el modelo de datos ni el
      // merge de sync — ver migrarDatosAntiguos más abajo para el flip
      // equivalente en cuentas ya existentes.
      modo_rendimiento: true,       // v1.14.1: reduce blur/sombras/animaciones para laptops con GPU integrada

      // Selector de moneda (Ajustes generales, 2026-08-10): preferencia
      // GLOBAL del usuario (NO por universidad/plan) — la usa Finanzas para
      // formatear montos con el símbolo/formato correspondiente. Ver
      // MONEDAS_DISPONIBLES más abajo para la lista completa de opciones.
      moneda_preferida: "CRC",

      // Backup de seguridad rotativo a Drive (Ajustes generales, 2026-08-10):
      // además del archivo vigente que ya se sincroniza (ver auth.js/
      // storage-sync.js), se guardan hasta 2 copias rotativas dentro de una
      // carpeta "AppAcademica" del Drive del usuario (backup_reciente.json /
      // backup_anterior.json). El ciclo corre solo, enganchado al sync
      // normal (ver ejecutarBackupSiToca en storage-sync.js) — acá solo
      // vive la preferencia de frecuencia y la fecha del último éxito, para
      // poder calcular cuándo toca el próximo sin depender de un timer
      // propio. Ver FRECUENCIAS_BACKUP_DRIVE más abajo para las opciones.
      backup_drive: crearBackupDriveDefault(),

      // Notificaciones — Recordatorios configurables por tipo (2026-08-20):
      // reemplaza el modelo de "1 solo recordatorio implícito por evento"
      // — ahora cada tipo (tarea/examen/evento/feriado) tiene su propio
      // conjunto de offsets activos, multi-selección (ej. tarea puede tener
      // "15 min antes" Y "1 día antes" a la vez). Default: 1 día antes en
      // los 4 tipos, para que funcione sin que el usuario tenga que entrar
      // a configurar nada (pedido explícito). Ver OFFSETS_RECORDATORIO_AGENDA
      // más abajo para la lista completa de offsets válidos — cualquier
      // valor fuera de esa lista se ignora silenciosamente al programar
      // (ver programarRecordatorioPush en notificaciones-push.js).
      notificaciones_recordatorios: {
        tarea: ["1_dia"],
        examen: ["1_dia"],
        evento: ["1_dia"],
        feriado: ["1_dia"],
      },

      // Notificaciones — Resumen diario (2026-08-20): aviso condicional
      // ("tenés pendientes para mañana") a una hora fija elegida acá. El
      // contenido real NUNCA se arma en el cliente en el momento del envío
      // (el Worker lo manda solo, genérico, sin detalle — ver diseño en
      // worker-notificaciones/README.md) porque la app puede estar cerrada
      // a esa hora. `hora` es "HH:MM" en la hora LOCAL de este dispositivo.
      notificaciones_resumen_diario: {
        activo: false,
        hora: "20:00",
      },

      plan_activo_id: null,         // id del Plan de Estudios seleccionado como activo
      enlaces_rapidos: [],          // ver estructura de "enlace" abajo (máx. 20)
      // Fix (2026-08-08 — enlaces borrados "resucitando" entre dispositivos):
      // storage-merge.js/fusionarDatos ya esperaba esta tumba
      // (datosLocal.configuracion._eliminados_enlaces) desde que se agregó
      // enlaces_rapidos como colección fundida aparte — pero acá nunca se
      // creaba, así que siempre llegaba undefined. Sin una tumba real,
      // borrar un enlace en un dispositivo no dejaba ningún rastro
      // explícito: al fusionar con otro dispositivo que todavía tuviera esa
      // versión vieja (por no haber sincronizado el borrado todavía),
      // fusionarColeccion no tenía forma de saber que había que excluirlo —
      // el enlace "resucitaba" solo. Mismo patrón ya usado para
      // materias/categorías/profesores/compañeros.
      _eliminados_enlaces: [],

      // Ajustes — ocultar botones de navegación (2026-08-04): ids de sección
      // ("plan-estudios" | "semestres" | "comunidad") que el usuario decidió
      // ocultar del nav principal. "configuracion" nunca se guarda acá —
      // aplicarVisibilidadNavegacion() (main.js) la filtra igual por las
      // dudas, pero la UI de Ajustes ni siquiera ofrece esa opción.
      navegacion_oculta: [],

      // Ajustes — orden personalizable de navegación (2026-08-06): ids de
      // sección en el orden que el usuario armó arrastrando en Ajustes.
      // Vacío = orden por defecto (DEFAULT_ORDEN_NAV en main.js). Arreglo
      // real desde la creación del usuario, nunca undefined — mismo
      // motivo que navegacion_oculta.
      navegacion_orden: [],

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
        // universidad (2026-08-22, separación nombre_completo/siglas): ya
        // NO es un string plano — ver NOMBRES_UNIVERSIDAD_PRESET y el
        // comentario completo sobre crearPlanEstudio más abajo.
        universidad: { nombre_completo: "Instituto Tecnológico de Costa Rica", siglas: "TEC" },
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
            profesor_ids: [], // 2026-08-09: pasó de escalar (profesor_id) a arreglo — una materia puede tener 2+ profesores vinculados
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

    // Comunidad — Parte 1: ver crearProfesor(). El vínculo Profesor↔Semestre
    // (calificación, ¿volvería a llevar?) NO vive acá — vive embebido en cada
    // materia_matriculada (profesor_id/calificacion_profesor/
    // volveria_a_llevar_profesor, ver crearMateriaMatriculada) para que un
    // mismo profesor pueda tener 2+ materias distintas en el MISMO semestre
    // (ej. correquisitos) cada una con su propia calificación, sin chocar.
    profesores: [
      /* ver crearProfesor() */
    ],
    // Comunidad — Parte 1: ver crearCompanero().
    companeros: [
      /* ver crearCompanero() */
    ],

    // Horario entre Amigos — Parte 1: registro de los enlaces de horario que
    // ESTE usuario generó al compartir (colección top-level plana, tumba
    // propia _eliminados_horario_enlaces — mismo patrón que profesores/
    // companeros). Ver crearEnlaceHorarioCompartido(). No confundir con
    // configuracion.horario_amigos_vinculados (los horarios de AMIGOS que
    // este usuario vinculó al suyo, prompt aparte) — son las dos direcciones
    // opuestas del mismo feature, cada una con su propia colección.
    horario_enlaces_compartidos: [
      /* ver crearEnlaceHorarioCompartido() */
    ],

    // Agenda — Núcleo: colección PLANA de nivel superior (no anidada por
    // semestre) — un evento de Agenda puede existir sin relación a ningún
    // semestre (ej. un recordatorio personal). Cuando SÍ está vinculado a
    // una materia, se guarda junto el id de esa materia_matriculada Y el
    // semestre al que pertenece (`materia_matriculada_id` + `semestre_id`)
    // para poder resolver el nombre de la materia con una búsqueda directa
    // en vez de recorrer TODOS los semestres del usuario — el formulario de
    // alta (agenda.js) solo deja elegir materias del semestre activo, así
    // que en la práctica `semestre_id` siempre es el semestre activo al
    // momento de crear/editar el vínculo. Ver crearEventoAgenda().
    agenda: [
      /* ver crearEventoAgenda() */
    ],

    // Adjuntos (2026-08-08): colección PLANA de nivel superior (no anidada
    // dentro de cada materia/evento) — así se funde con una sola llamada a
    // fusionarColeccion, igual que profesores/companeros/agenda, en vez de
    // necesitar una función de fusión nueva por cada tipo de entidad que
    // pueda tener adjuntos. `entidadTipo`+`entidadId` (ver crearAdjunto) es
    // lo que conecta cada adjunto con lo que corresponda; renderizar es
    // solo filtrar por esos dos campos.
    adjuntos: [
      /* ver crearAdjunto() */
    ],

    // Tumbas top-level (regla obligatoria de sincronización — ver
    // storage-merge.js/fusionarDatos, que ya las esperaba). BUG encontrado en
    // esta ronda: _eliminados_profesores/_eliminados_planes/_eliminados_agenda
    // nunca se inicializaban acá — sobrevivían solo porque fusionarTumbas
    // tolera undefined. Se agregan explícitas para profesores/companeros (las
    // que sí necesita este prompt); _eliminados_semestres ya se auto-crea de
    // forma perezosa en semestres.js al primer borrado.
    _eliminados_profesores: [],
    _eliminados_companeros: [],
    _eliminados_adjuntos: [],
    // Agenda — Núcleo: tumba propia — storage-merge.js/fusionarDatos ya la
    // esperaba (_eliminados_agenda) desde que "agenda" existe como colección
    // placeholder, pero nunca se inicializaba acá — mismo bug exacto ya
    // cazado y corregido arriba para profesores/companeros (ver comentario
    // de esta ronda). Se agrega explícita para no depender de que
    // fusionarTumbas tolere undefined para siempre.
    _eliminados_agenda: [],
    // Horario entre Amigos — Parte 1: tumba de horario_enlaces_compartidos,
    // inicializada explícita desde el día 1 (mismo motivo que las de arriba
    // — evitar el bug de "tumba nunca creada" ya cazado con enlaces_rapidos).
    _eliminados_horario_enlaces: [],

    // Finanzas (2026-08-10): dos colecciones planas de nivel superior, mismo
    // patrón que profesores/companeros/adjuntos — se funden con una sola
    // llamada a fusionarColeccion cada una (ver fusionarDatos en
    // storage-merge.js), nada de lógica de fusión nueva que escribir.
    // finanzas_semestre se vincula a un semestre por semestre_id (no vive
    // embebido dentro del semestre a propósito, ver crearRegistroFinancieroSemestre).
    finanzas_semestre: [
      /* ver crearRegistroFinancieroSemestre() */
    ],
    // Gastos generales de la universidad, no vinculados a ningún semestre
    // puntual (carné, seguro estudiantil, materiales, etc.).
    gastos_u: [
      /* ver crearGastoU() */
    ],
    _eliminados_finanzas_semestre: [],
    _eliminados_gastos_u: [],
  };
}

/** Estructura de referencia de un "enlace rápido" (máx. 20 por usuario). */
function crearEnlaceRapido({ nombre, url, icono_tipo, icono_valor }) {
  // icono_tipo: "emoji" | "imagen" ; icono_valor: el emoji o la URL/base64 de la imagen
  return { id: crypto.randomUUID(), nombre, url, icono_tipo, icono_valor };
}

/**
 * Adjuntos (2026-08-08 → ampliado 2026-08-19): a diferencia de todo lo
 * demás en este archivo, el CONTENIDO real de un adjunto tipo "archivo"
 * nunca vive dentro de este JSON — se sube como su propio archivo aparte
 * en una carpeta dedicada del Drive del usuario (ver subirArchivoBinarioADrive
 * + buscarOCrearCarpetaEnDrive en auth.js). Esto es solo la REFERENCIA
 * liviana que sí vive acá: qué es, a qué pertenece, y dónde encontrarlo
 * (driveFileId). Se funde igual que cualquier otra entidad con id
 * (fusionarColeccion en storage-merge.js), por eso NO se sella acá —
 * mismo criterio que crearEnlaceRapido: quien la crea (core/storage-
 * adjuntos.js) llama a sellarTimestamp() después, una vez decidido el
 * contenido final.
 *
 * `entidadTipo`/`entidadId` son la única relación con lo que sea que
 * adjunta este archivo (una materia, un evento de agenda, etc.) — se deja
 * como referencia libre por texto en vez de una lista fija de tipos, para
 * no tener que tocar este archivo cada vez que una pantalla nueva quiera
 * soportar adjuntos.
 *
 * `driveFileId: null` + `subidaPendiente: true` es el estado inicial
 * mientras el binario todavía no terminó de subirse (ver core/storage-
 * adjuntos.js) — la UI ya puede mostrar la referencia de inmediato (con un
 * indicador de "subiendo"), sin esperar a que la subida real termine.
 *
 * Ampliación 2026-08-19 (pedido: cronograma/reglas/libros de una materia +
 * adjuntos por evento de Agenda, con reordenamiento y "desactivar sin
 * borrar"):
 *
 * - `tipo: "archivo" | "enlace"` — un adjunto "enlace" es solo una URL
 *   externa (ej. el PDF del cronograma ya vive en otro lado, o un link a
 *   la librería del curso): nunca pasa por Drive, así que `driveFileId`
 *   queda `null` para siempre y `subidaPendiente` en `false` desde que se
 *   crea (no hay nada que subir). `url` es el campo que se usa en ese caso;
 *   queda `null` en un adjunto tipo "archivo".
 * - `orden` — número (por defecto `Date.now()` al crearlo, así los nuevos
 *   quedan al final sin tener que leer el resto de la colección) que decide
 *   el orden de los botones/pills en la UI; el drag-and-drop reescribe este
 *   campo en los adjuntos afectados en vez de depender del orden de
 *   inserción en el array.
 * - `activo` — `true` por defecto. En `false` el adjunto se sigue
 *   fusionando y sincronizando como cualquier otro (no es una tumba), pero
 *   la UI lo oculta de la vista normal — permite "desactivar" (esconder sin
 *   perder el acceso) como algo distinto de `eliminarAdjunto` (que sí borra
 *   de verdad, referencia + archivo en Drive).
 */
function crearAdjunto({ nombre, mimeType, tamanoBytes, entidadTipo, entidadId, tipo, url }) {
  const esEnlace = tipo === "enlace";
  return {
    id: crypto.randomUUID(),
    nombre,
    tipo: esEnlace ? "enlace" : "archivo",
    mimeType: esEnlace ? null : mimeType || "application/octet-stream",
    tamanoBytes: esEnlace ? 0 : Number(tamanoBytes) || 0,
    url: esEnlace ? url : null,
    entidadTipo,
    entidadId,
    driveFileId: null,
    subidaPendiente: !esEnlace, // un enlace no sube nada — nunca queda "pendiente"
    orden: Date.now(),
    activo: true,
  };
}

/* ===================== Agenda ===================== */

const TIPOS_EVENTO_AGENDA = ["evento", "tarea", "examen"];

/**
 * Notificaciones — Recordatorios configurables (2026-08-20): offsets
 * disponibles para "cuándo avisar" antes de un evento/tarea/examen/
 * feriado. `id` es el valor que se guarda en
 * configuracion.notificaciones_recordatorios[tipo] (arreglo de estos ids,
 * multi-selección) y también el sufijo que arma el id compuesto que el
 * Worker persiste por cada recordatorio individual — ver
 * SEPARADOR_ID_RECORDATORIO_OFFSET y programarRecordatorioPush en
 * notificaciones-push.js. `minutosAntes` es lo único que ese archivo
 * necesita para calcular fecha_hora_utc de cada recordatorio a partir de
 * la fecha/hora real del evento — 0 = al momento exacto.
 */
const OFFSETS_RECORDATORIO_AGENDA = [
  { id: "al_momento", etiqueta: "Al momento", minutosAntes: 0 },
  { id: "15_min", etiqueta: "15 min antes", minutosAntes: 15 },
  { id: "1_hora", etiqueta: "1 hora antes", minutosAntes: 60 },
  { id: "1_dia", etiqueta: "1 día antes", minutosAntes: 60 * 24 },
  { id: "3_dias", etiqueta: "3 días antes", minutosAntes: 60 * 24 * 3 },
];

/** Separador del id compuesto "eventoId::offset" que persiste el Worker —
 *  mismo valor que SEPARADOR_ID_OFFSET en worker-notificaciones/index.js;
 *  vive acá también porque notificaciones-push.js arma esos ids del lado
 *  del cliente antes de mandarlos. Un solo lugar en el cliente para no
 *  repetir el literal "::" suelto en varios archivos. */
const SEPARADOR_ID_RECORDATORIO_OFFSET = "::";

/**
 * Agenda — Núcleo: crea un evento/tarea/examen. Colección plana top-level
 * (ver comentario en crearDatosUsuarioNuevo) — se sella acá mismo (a
 * diferencia de crearAdjunto/crearEnlaceRapido) porque no hay ningún paso
 * intermedio entre "el usuario llena el formulario" y "esto ya es la
 * versión final a guardar".
 *
 * `nombre`: libre en los 3 tipos — para "tarea"/"examen" la UI puede
 * sugerir un placeholder según el tipo, pero el campo real siempre es
 * texto libre (ver spec: "también libre pero con sugerencia de
 * placeholder").
 * `hora`: null = evento de día completo, sin hora puntual.
 * `materiaMatriculadaId`/`semestreId`: SIEMPRE juntos o SIEMPRE null — un
 * evento vinculado a una materia solo tiene sentido si se sabe de qué
 * semestre es esa materia matriculada (ver comentario en
 * crearDatosUsuarioNuevo). El formulario de alta (agenda.js) es quien
 * garantiza que ambos vengan de la materia realmente elegida.
 *
 * `completada` (rediseño núcleo Agenda): solo tiene sentido para tipo
 * "tarea" — nace siempre en `false` (no existe forma de crear una tarea ya
 * completada desde el alta). Se deja el campo presente en los 3 tipos (en
 * vez de solo en "tarea") para no tener que ramificar el objeto según tipo
 * en cada lugar que lo lea; simplemente se ignora en "evento"/"examen".
 * `esFeriado` (rediseño núcleo Agenda): solo tiene sentido para tipo
 * "evento" (subtipo especial, se pinta distinto — ver design-system.css).
 * Mismo criterio: presente siempre, se ignora fuera de "evento". Si el tipo
 * elegido no es "evento", se fuerza a `false` acá mismo para que nunca
 * quede un examen/tarea con `es_feriado: true` colgado de una edición vieja
 * (ej. el usuario cambió el tipo de un evento-feriado a "tarea").
 */
function crearEventoAgenda({ tipo, nombre, fecha, hora, materiaMatriculadaId, semestreId, notas, esFeriado }) {
  const tipoValido = TIPOS_EVENTO_AGENDA.includes(tipo) ? tipo : "evento";
  const vinculada = Boolean(materiaMatriculadaId && semestreId);
  return sellarTimestamp({
    id: "ag_" + crypto.randomUUID(),
    tipo: tipoValido,
    nombre: nombre || "",
    fecha, // "YYYY-MM-DD"
    hora: hora || null, // "HH:MM" | null (día completo)
    materia_matriculada_id: vinculada ? materiaMatriculadaId : null,
    semestre_id: vinculada ? semestreId : null,
    notas: notas || "",
    completada: false,
    es_feriado: tipoValido === "evento" ? Boolean(esFeriado) : false,
  });
}

/* ===================== Finanzas ===================== */

/**
 * Finanzas (2026-08-10, simplificado en v2.8.8): registro financiero de UN
 * semestre. Entidad separada vinculada por `semestre_id` (no embebida
 * dentro del semestre) — así un semestre puede no tener registro todavía
 * sin que crearSemestre tenga que saber nada de dinero.
 *
 * v2.8.8: se sacó el flujo de switch de beca + porcentaje + autocálculo de
 * neto (costo_total/beca_activa/porcentaje_beca/pago_confirmado/
 * pago_confirmado_manual desaparecen por completo). Ahora son DOS montos
 * directos, sin ninguna fórmula entre ellos — el usuario los escribe a
 * mano, cada uno por su lado:
 *   - `costo_matricula`: lo que efectivamente pagaste de matrícula.
 *   - `beca_monto`: lo que cayó de beca. Funciona como INGRESO/ahorro
 *     dentro de las estadísticas generales (Resumen), no como un gasto
 *     más — ver calcularTotalesResumenFinanzas en finanzas.js.
 * Cambiar uno de los dos campos NUNCA recalcula el otro.
 *
 * `desglose_mensual` sigue aplicando sobre `costo_matricula` (para
 * semestres pagados en varias cuotas/pagos, no de una sola vez) — no se
 * movió de lugar. `desglose_mensual.modo` guarda cuál de los dos modos se
 * usó para poder re-editar después con el mismo modo por defecto (manual:
 * array cargado mes por mes; automatico: total repartido entre
 * `automatico_cantidad_meses`, con el residuo de la división absorbido por
 * el último mes para que la suma de los meses siempre cuadre exacto con
 * el total).
 */
function crearRegistroFinancieroSemestre({ semestreId, costoMatricula, becaMonto }) {
  return sellarTimestamp({
    id: "finsem_" + crypto.randomUUID(),
    semestre_id: semestreId,
    costo_matricula: Number(costoMatricula) || 0,
    beca_monto: Number(becaMonto) || 0,
    desglose_mensual: {
      modo: "manual", // "manual" | "automatico"
      meses: [], // [{ id, mes: "Enero"/"2026-01"/lo que el usuario escriba, monto }]
      automatico_cantidad_meses: null, // solo relevante si modo === "automatico"
    },
  });
}

/**
 * Finanzas (2026-08-10): un gasto general de la universidad, NO vinculado
 * obligatoriamente a ningún semestre (carné, seguro estudiantil,
 * materiales sueltos, etc.) — colección plana propia (`gastos_u`), mismo
 * patrón que crearAdjunto.
 *
 * v2.8.8:
 *  - `semestre_id` (opcional, 2026-08-11): vínculo opcional a UN
 *    semestre, puramente organizativo — no cambia el cálculo de totales
 *    (el gasto ya se cuenta una sola vez dentro de `gastos_u`; vincularlo
 *    no lo duplica ni lo mueve a otro total). `null` = sin vincular
 *    (comportamiento de siempre, sigue siendo el default).
 *  - `recurrente` (opcional, 2026-08-11): si no es `null`, este gasto
 *    representa un pago que se repite en el tiempo (ej. abono de
 *    transporte, alquiler de casillero, suscripción) en vez de un monto
 *    único. Cuando está activo, `costo` deja de usarse para los totales —
 *    ver calcularPagosRecurrentesTranscurridos, que calcula cuánto se ha
 *    pagado hasta HOY (nunca pagos futuros) a partir de fecha_inicio/
 *    fecha_fin/frecuencia/monto_por_pago.
 *
 * v2.8.9: `recurrente.frecuencia` suma la opción "personalizado" (pedido
 * explícito — no todos los gastos recurrentes caen limpio en semanal/
 * quincenal/mensual/anual). Cuando la frecuencia es "personalizado",
 * `recurrente.personalizado` manda y define CÓMO se repite, con 3 modos:
 *   - "diario": todos los días, sin excepción.
 *   - "dias_semana": solo ciertos días de la semana (ej. lunes/miércoles/
 *     viernes) — `dias_semana` es un array de 0-6 (0=domingo ... 6=sábado,
 *     mismo criterio que Date.prototype.getDay()).
 *   - "cada_n_dias": cada N días exactos desde fecha_inicio, con N 100%
 *     libre (no limitado a 2/3/4 — el usuario pone lo que necesite).
 */
function crearGastoU({ nombre, costo, nota, semestreId, recurrente }) {
  return sellarTimestamp({
    id: "gastou_" + crypto.randomUUID(),
    nombre,
    costo: Number(costo) || 0,
    nota: nota || null,
    semestre_id: semestreId || null,
    recurrente: recurrente
      ? {
          frecuencia: recurrente.frecuencia || "mensual", // "semanal" | "quincenal" | "mensual" | "anual" | "personalizado"
          monto_por_pago: Number(recurrente.montoPorPago) || 0,
          fecha_inicio: recurrente.fechaInicio || null, // "YYYY-MM-DD"
          fecha_fin: recurrente.fechaFin || null, // "YYYY-MM-DD" o null = sigue activo, sin fecha de fin todavía
          personalizado:
            recurrente.frecuencia === "personalizado"
              ? {
                  modo: (recurrente.personalizado && recurrente.personalizado.modo) || "diario", // "diario" | "dias_semana" | "cada_n_dias"
                  dias_semana: (recurrente.personalizado && recurrente.personalizado.diasSemana) || [], // solo si modo === "dias_semana"
                  cada_n_dias: (recurrente.personalizado && Number(recurrente.personalizado.cadaNDias)) || null, // solo si modo === "cada_n_dias"
                }
              : null,
        }
      : null,
  });
}

/**
 * Cuenta cuántos pagos de un gasto recurrente ya "cayeron" entre
 * fecha_inicio y HOY (o fecha_fin, lo que sea antes) — SIN contar pagos
 * futuros, para que el total del Resumen refleje lo que de verdad ya se
 * pagó hasta ahora, no el compromiso completo hacia adelante.
 *
 * "Mensual"/"anual" cuentan por mes/año calendario real (no por bloques
 * fijos de 30/365 días) para que un inicio un día 31, por ejemplo, no
 * genere pagos fantasma por redondeo de días. "Semanal"/"quincenal" sí
 * cuentan por bloques fijos de 7/14 días porque no tienen un equivalente
 * calendario natural como mes o año.
 *
 * "Personalizado" (v2.8.9) delega en su propio `modo`: "diario" y
 * "cada_n_dias" son bloques fijos de 1/N días (mismo mecanismo que
 * semanal/quincenal); "dias_semana" recorre día por día el rango completo
 * contando solo los días de la semana elegidos — un poco más caro en CPU
 * que una fórmula cerrada, pero el rango nunca es tan largo (como mucho
 * unos pocos años) como para que importe en la práctica.
 */
function calcularPagosRecurrentesTranscurridos(recurrente) {
  if (!recurrente || !recurrente.fecha_inicio) return { cantidadPagos: 0, totalPagado: 0 };

  const inicio = new Date(recurrente.fecha_inicio + "T00:00:00");
  const hoy = new Date();
  const limite = recurrente.fecha_fin ? new Date(recurrente.fecha_fin + "T00:00:00") : hoy;
  const fin = limite < hoy ? limite : hoy;
  if (fin < inicio) return { cantidadPagos: 0, totalPagado: 0 };

  let cantidadPagos;
  if (recurrente.frecuencia === "personalizado" && recurrente.personalizado) {
    const p = recurrente.personalizado;
    if (p.modo === "dias_semana" && Array.isArray(p.dias_semana) && p.dias_semana.length > 0) {
      cantidadPagos = 0;
      const cursor = new Date(inicio);
      while (cursor <= fin) {
        if (p.dias_semana.includes(cursor.getDay())) cantidadPagos++;
        cursor.setDate(cursor.getDate() + 1);
      }
    } else {
      const pasoDias = p.modo === "cada_n_dias" ? Math.max(1, Number(p.cada_n_dias) || 1) : 1; // "diario" = paso de 1
      const diffMs = fin.getTime() - inicio.getTime();
      cantidadPagos = Math.floor(diffMs / (pasoDias * 24 * 60 * 60 * 1000)) + 1;
    }
  } else if (recurrente.frecuencia === "semanal" || recurrente.frecuencia === "quincenal") {
    const pasoDias = recurrente.frecuencia === "semanal" ? 7 : 14;
    const diffMs = fin.getTime() - inicio.getTime();
    cantidadPagos = Math.floor(diffMs / (pasoDias * 24 * 60 * 60 * 1000)) + 1;
  } else if (recurrente.frecuencia === "anual") {
    let anios = fin.getFullYear() - inicio.getFullYear();
    const aniversarioEsteAnio = new Date(inicio);
    aniversarioEsteAnio.setFullYear(inicio.getFullYear() + anios);
    if (aniversarioEsteAnio > fin) anios -= 1; // el aniversario de este año todavía no llegó
    cantidadPagos = Math.max(0, anios) + 1;
  } else {
    // "mensual" (default)
    let meses = (fin.getFullYear() - inicio.getFullYear()) * 12 + (fin.getMonth() - inicio.getMonth());
    if (fin.getDate() < inicio.getDate()) meses -= 1; // el día del mes de inicio todavía no llegó este mes
    cantidadPagos = Math.max(0, meses) + 1;
  }

  const monto = Number(recurrente.monto_por_pago) || 0;
  return { cantidadPagos, totalPagado: redondearDecimales(cantidadPagos * monto, 2) };
}

// Límite defensivo de tamaño por adjunto — Drive en sí no lo necesita (su
// cuota es mucho mayor), pero subir algo muy pesado desde una conexión
// móvil lenta puede colgar la app sin feedback claro. 25MB es holgado para
// PDFs de enunciados/comprobantes o fotos de apuntes, y deja margen para
// que Wagner lo ajuste después si hace falta un tipo de adjunto más pesado.
const LIMITE_MB_ADJUNTO = 25;

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

/* Selector de moneda (Ajustes generales, 2026-08-10): preferencia GLOBAL
 * del usuario que usa Finanzas para formatear montos. CRC primero porque
 * TEC/UCR (las universidades que ya maneja el resto del schema, ver
 * PARAMETROS_UNIVERSIDAD_DEFAULT) son costarricenses.
 *
 * v1.15.13 (2026-08-10, pedido explícito): la lista se amplió para cubrir
 * TODOS los símbolos de moneda distintos en los que se pudo pensar, no
 * solo los países de la región — un símbolo por entrada, sin repetir.
 * Cuando varios países comparten el mismo símbolo (ej. USD/MXN/COP/ARS
 * comparten "$", o la mayoría de coronas nórdicas comparten "kr"), se
 * incluye UNA sola moneda representativa de ese símbolo — a propósito,
 * como pidió el usuario ("si se repiten 5 países con dólares, con uno
 * solo es válido"). El país elegido para representar cada símbolo no
 * necesariamente es el único que lo usa, es solo el más reconocible. */
const MONEDAS_DISPONIBLES = [
  { id: "CRC", etiqueta: "Colón costarricense", simbolo: "₡" },
  { id: "USD", etiqueta: "Dólar estadounidense", simbolo: "$" },
  { id: "EUR", etiqueta: "Euro", simbolo: "€" },
  { id: "GBP", etiqueta: "Libra esterlina", simbolo: "£" },
  { id: "JPY", etiqueta: "Yen japonés", simbolo: "¥" },
  { id: "INR", etiqueta: "Rupia india", simbolo: "₹" },
  { id: "KRW", etiqueta: "Won surcoreano", simbolo: "₩" },
  { id: "RUB", etiqueta: "Rublo ruso", simbolo: "₽" },
  { id: "TRY", etiqueta: "Lira turca", simbolo: "₺" },
  { id: "UAH", etiqueta: "Grivna ucraniana", simbolo: "₴" },
  { id: "NGN", etiqueta: "Naira nigeriana", simbolo: "₦" },
  { id: "VND", etiqueta: "Dong vietnamita", simbolo: "₫" },
  { id: "ILS", etiqueta: "Shékel israelí", simbolo: "₪" },
  { id: "THB", etiqueta: "Baht tailandés", simbolo: "฿" },
  { id: "PHP", etiqueta: "Peso filipino", simbolo: "₱" },
  { id: "PLN", etiqueta: "Zloty polaco", simbolo: "zł" },
  { id: "CZK", etiqueta: "Corona checa", simbolo: "Kč" },
  { id: "HUF", etiqueta: "Forint húngaro", simbolo: "Ft" },
  { id: "SEK", etiqueta: "Corona sueca", simbolo: "kr" },
  { id: "CHF", etiqueta: "Franco suizo", simbolo: "CHF" },
  { id: "PEN", etiqueta: "Sol peruano", simbolo: "S/" },
  { id: "GTQ", etiqueta: "Quetzal guatemalteco", simbolo: "Q" },
  { id: "BRL", etiqueta: "Real brasileño", simbolo: "R$" },
  { id: "ZAR", etiqueta: "Rand sudafricano", simbolo: "R" },
  { id: "PKR", etiqueta: "Rupia pakistaní", simbolo: "₨" },
  { id: "BDT", etiqueta: "Taka bangladesí", simbolo: "৳" },
  { id: "PYG", etiqueta: "Guaraní paraguayo", simbolo: "₲" },
  { id: "GHS", etiqueta: "Cedi ghanés", simbolo: "₵" },
  { id: "KZT", etiqueta: "Tenge kazajo", simbolo: "₸" },
  { id: "AZN", etiqueta: "Manat azerbaiyano", simbolo: "₼" },
  { id: "GEL", etiqueta: "Lari georgiano", simbolo: "₾" },
  { id: "MNT", etiqueta: "Tugrik mongol", simbolo: "₮" },
  { id: "LAK", etiqueta: "Kip laosiano", simbolo: "₭" },
  { id: "AMD", etiqueta: "Dram armenio", simbolo: "֏" },
  { id: "BGN", etiqueta: "Lev búlgaro", simbolo: "лв" },
  { id: "MYR", etiqueta: "Ringgit malayo", simbolo: "RM" },
  { id: "IDR", etiqueta: "Rupia indonesia", simbolo: "Rp" },
];

/* Frecuencias de backup rotativo a Drive (Ajustes generales, 2026-08-10) —
 * `dias` es el intervalo MÍNIMO entre dos backups exitosos consecutivos;
 * lo usa ejecutarBackupSiToca (storage-sync.js) para decidir si ya toca
 * correr el ciclo. "semanal" es el default (ver crearDatosUsuarioNuevo). */
const FRECUENCIAS_BACKUP_DRIVE = [
  { id: "diaria", etiqueta: "Diaria", dias: 1 },
  { id: "cada_3_dias", etiqueta: "Cada 3 días", dias: 3 },
  { id: "semanal", etiqueta: "Semanal", dias: 7 },
  { id: "quincenal", etiqueta: "Quincenal", dias: 14 },
  { id: "mensual", etiqueta: "Mensual", dias: 30 },
];

/* Valor default de configuracion.backup_drive — extraído a helper
 * (2026-08-10) porque se necesitaba construir el mismo objeto en varios
 * lugares (crearDatosUsuarioNuevo, migrarDatosAntiguos, y los puntos de
 * relleno defensivo en storage-sync.js/config-ajustes.js que asumen que el
 * campo puede no existir todavía); repetir el literal en cada uno de esos
 * lugares es justo el tipo de duplicación que hace fácil que un campo
 * nuevo (como archivo_vigente_migrado) se agregue en un lugar y se quede
 * afuera en los demás sin que nadie lo note. */
function crearBackupDriveDefault() {
  return {
    frecuencia: "semanal",          // "diaria" | "cada_3_dias" | "semanal" | "quincenal" | "mensual"
    ultimo_backup_iso: null,        // fecha ISO del último backup exitoso, o null si nunca corrió uno
    // Migración única del archivo vigente (2026-08-10): el JSON central de
    // la app (estado.fileId) se crea originalmente en la raíz del Drive,
    // antes de que exista la carpeta "AppAcademica". La primera vez que el
    // ciclo de backup corre de verdad, ese archivo se MUEVE (no se copia)
    // adentro de la carpeta, conservando el mismo nombre y el mismo
    // fileId — ver migrarArchivoVigenteSiHaceFalta en storage-sync.js. Esta
    // bandera evita reintentar la mudanza en cada ciclo una vez que ya se
    // hizo una vez.
    archivo_vigente_migrado: false,
  };
}

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

/** Nombres completos de los 2 presets rápidos (2026-08-22, separación
 *  universidad en nombre_completo/siglas) — TEC/UCR siguen siendo atajos
 *  con un clic en el modal "Nuevo Plan"; acá vive el nombre completo real
 *  que se guarda junto a la sigla, así el usuario nunca tiene que tipearlo
 *  para esos 2 casos. Cualquier otra universidad ("Otra") lo escribe el
 *  usuario a mano (ver bloque-universidad-otra-nombre en index.html). */
const NOMBRES_UNIVERSIDAD_PRESET = {
  TEC: "Instituto Tecnológico de Costa Rica",
  UCR: "Universidad de Costa Rica",
};

/** Presets rápidos de tipos_horas, usados tanto por el modal "Nuevo Plan" como
 *  por el selector de universidad que aparece en el panel de importación
 *  (antes de que el plan exista) — ver js/plan.js. */
const PRESETS_TIPOS_HORAS = {
  TEC: ["Horas"],
  UCR: ["Teoría", "Práctica", "Laboratorio", "Teoría-Práctica"],
};

/**
 * `universidad` (2026-08-22, separación nombre_completo/siglas): ya NO es
 * un string plano — es { nombre_completo, siglas }. `siglas` es lo que se
 * usa en TODOS los badges/subtítulos cortos de la app (encabezado del
 * plan, selector de plan, carrusel de Semestres, Modo Hardcore);
 * `nombre_completo` queda disponible para búsquedas o contexto donde hace
 * falta el nombre real sin abreviar (ej. prompt del Asistente IA). Quien
 * llama es responsable de armar este objeto completo — ver
 * abrirModalCrearPlan/btn-confirmar-crear-plan en plan-esquema.js.
 */
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
      nota_aprobacion: 70,           // por universidad/plan, editable en Ajustes — única fuente de verdad para aprobar/reprobar
      redondeo_activo: true,         // Fase 6.2: no toda universidad redondea al 5 más cercano — editable en Ajustes
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

    // Horario — Núcleo: colección propia por semestre, mismo patrón que
    // materias_matriculadas (tumba hermana _eliminados_bloques_horario). Se
    // anida acá (y no top-level como profesores/companeros) porque un
    // bloque de horario no tiene sentido fuera de un semestre concreto —
    // así Cronograma (prompt futuro) puede recorrer semestre.bloques_horario
    // directo, sin necesitar cruzar por semestre_id.
    bloques_horario: [],
    _eliminados_bloques_horario: [],
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
 * "pasado" en esta fase — al llegar a (duracion_semanas + 2) desde
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
  // FIX (2026-08-02): antes el tope era el límite plano LIMITE_SEMANAS_SEMESTRE
  // (25) para CUALQUIER semestre, sin importar su duración real. Ahora usa la
  // duración propia de este semestre + 2 semanas de colchón — el mismo
  // margen que ya se aplica al elegir la duración en el formulario (ver
  // semestres.js) — para que el cierre automático sea consistente con lo que
  // el usuario configuró, no con un número global fijo.
  const topeSemanas = (Number(semestre.duracion_semanas) || 16) + 2;
  return semanasTranscurridas >= topeSemanas ? "pasado" : "actual";
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
    // Comunidad — Parte 1: vínculo Profesor↔Semestre, embebido acá a
    // propósito (decisión confirmada 2026-08-04) en vez de vivir como
    // entidad/tumba separada — así un mismo profesor con 2+ materias en el
    // MISMO semestre (ej. correquisitos) tiene una calificación independiente
    // por cada una, sin necesidad de decidir "cuál gana" a nivel semestre.
    // Se sincroniza gratis: al ser campos de mm, ya heredan su propio
    // sellado/_version_base y la tumba _eliminados_materias_matriculadas del
    // semestre — nada nuevo que fusionar en storage-merge.js.
    //
    // 2026-08-09 (pedido explícito): pasó de escalar (profesor_id, un solo
    // profesor por materia) a arreglo (profesor_ids) — una misma materia
    // matriculada puede tener 2+ profesores vinculados a la vez (ej. clase
    // con más de un docente). obtenerHistorialProfesor ya lee este arreglo;
    // la migración de datos viejos vive en migrarDatosAntiguos más abajo.
    profesor_ids: [],
    calificacion_profesor: null,       // 1-10, o null = sin calificar
    volveria_a_llevar_profesor: null,  // true | false | null = neutro/sin contestar
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
function crearCriterio({ nombre, valorTotal, orden, esExtra }) {
  return sellarTimestamp({
    id: "crit_" + crypto.randomUUID(),
    nombre,
    valor_total: Number(valorTotal) || 0,
    asignaciones: [],
    _eliminados_asignaciones: [],
    // Fase 8 — Drag and drop (2026-08-04): posición visual dentro de la
    // materia. No se infiere del índice del array porque la fusión de sync
    // (fusionarColeccion) no garantiza mantener el orden del array entre
    // dispositivos — solo decide, por id, qué versión de CADA item gana.
    // Con un campo propio, reordenar es una edición de campo más, que se
    // sincroniza y resuelve conflictos igual que cualquier otro cambio.
    orden: Number.isFinite(orden) ? orden : 0,
    // Reemplaza a mm.puntos_extra (Fase 7, un único bono plano): ahora
    // "✨ Extra" es un criterio real, así se pueden tener varios a la vez
    // (examen de reposición, puntos regalados, tarea extra, lo que sea),
    // cada uno con sus propias asignaciones. `es_extra` es la única marca
    // que lo distingue de un criterio normal — NO se infiere del nombre
    // (el usuario puede renombrarlo sin que deje de comportarse como
    // extra). Efecto de la marca: sumaValorTotalCriterios (ver
    // semestres-tarjetas.js) lo excluye del 100% de la materia, así estos
    // puntos se suman aparte, sin quitarle espacio a los criterios
    // normales — mismo resultado que el viejo mm.puntos_extra, pero
    // repartido en criterios/asignaciones reales en vez de un solo número.
    es_extra: !!esExtra,
  });
}

/**
 * Una asignación puntual dentro de un criterio (ej. "Examen I", 15% de la
 * materia). `valor` está expresado en los MISMOS puntos que valor_total
 * del criterio (no relativo al criterio) — así una tarea de 5% y un
 * examen de 15% se suman directo sin conversión. `nota` queda en null
 * hasta que el usuario la registra (según la escala activa).
 *
 * `modoCalificacion` (2026-08-07, criterio "✨ Extra" simplificado): además
 * de "nota"/"puntos" (ver comentario abajo), acepta "extra" — usado SOLO
 * por asignaciones dentro de un criterio es_extra:true. En ese modo
 * `valor` ES la calificación (los puntos que efectivamente te dieron, ej.
 * "+5 pts"), sin pasar por nota/escala ni por un estado "pendiente" — ver
 * calcularPuntosAsignacion y obtenerAsignacionesPendientes más abajo.
 */
function crearAsignacion({ nombre, valor, orden, modoCalificacion }) {
  return sellarTimestamp({
    id: "asig_" + crypto.randomUUID(),
    nombre,
    valor: Number(valor) || 0,
    nota: null,
    // Fase 6.1 (2026-08-02): "automatico" = participa del reparto
    // equitativo (ver repartirEquitativoCriterio); "personalizado" = el
    // usuario fijó el valor a mano y nunca se toca. "nota" = calificación en
    // escala 0-escalaActiva (comportamiento de siempre); "puntos" = la
    // calificación son puntos directos, con tope en `valor`; "extra" = ver
    // comentario de `modoCalificacion` arriba.
    modo_valor: "automatico",
    modo_calificacion: modoCalificacion || "nota",
    // FIX (2026-08-06 — "la pill de Nota muestra el puntaje crudo, no la
    // nota equivalente"): en modo "puntos" el usuario tipea cuánto obtuvo
    // de un examen/tarea (ej. 27 de un máximo de 30) — eso vive acá,
    // crudo, SIN pasar por la escala. `nota` ya no guarda ese crudo:
    // siempre guarda la nota convertida a la escala activa de la materia
    // (ver recalcularNotaDesdePuntaje), así la pill de Nota muestra algo
    // que de verdad es una nota, consistente con el modo "nota". null
    // mientras no se cargó ningún puntaje todavía.
    puntaje_obtenido: null,
    // Fase 8 — Drag and drop: ver comentario de `orden` en crearCriterio.
    orden: Number.isFinite(orden) ? orden : 0,
  });
}

/** Fase 8 — Drag and drop: próximo valor de `orden` para agregar algo al
 *  final de una colección (criterios de una materia, asignaciones de un
 *  criterio) — el máximo actual + 1, o 0 si está vacía. */
function siguienteOrden(coleccion) {
  const items = coleccion || [];
  if (items.length === 0) return 0;
  return Math.max(...items.map((it) => Number(it.orden) || 0)) + 1;
}

/**
 * Fase 8 — Drag and drop: reasigna `orden` de forma secuencial (0, 1, 2…)
 * según `idsEnNuevoOrden` (el orden visual tras soltar el drag) y sella
 * timestamp SOLO en los items cuyo `orden` realmente cambió — así un drag
 * que no modificó la posición de un item no dispara un conflicto de sync
 * falso en él.
 */
function reordenarPorArrastre(coleccion, idsEnNuevoOrden) {
  const items = coleccion || [];
  idsEnNuevoOrden.forEach((id, idx) => {
    const item = items.find((it) => it.id === id);
    if (item && item.orden !== idx) {
      item.orden = idx;
      sellarTimestamp(item);
    }
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

/* ===================== Horario — Núcleo ===================== */

/**
 * Horario — Núcleo: valores fijos de modalidad. "personalizado" es el único
 * que además lleva texto libre (ver crearModalidadHorario) — los otros
 * ignoran texto_libre aunque venga seteado, para no arrastrar basura si el
 * usuario cambia de opción y regresa.
 * "sin_clase" (Cronograma, 2026-08-14): reemplaza al viejo switch booleano
 * `cancelada` de excepciones_semana — ahora "no hay clase" es una opción de
 * modalidad más, seleccionable por día individual desde el Cronograma. Ver
 * obtenerClasesEfectivasSemana.
 */
const MODALIDADES_HORARIO = ["presencial", "semipresencial", "virtual", "personalizado", "sin_clase"];

/**
 * Horario — Núcleo: constructor del valor de modalidad, usado tanto en el
 * bloque base como en cada excepción de semana. Se guarda como objeto (no
 * string plano) para que "personalizado" pueda cargar su propio texto sin
 * necesitar un segundo campo suelto a nivel de bloque.
 */
function crearModalidadHorario(tipo, textoPersonalizado) {
  const tipoValido = MODALIDADES_HORARIO.includes(tipo) ? tipo : "presencial";
  return {
    tipo: tipoValido,
    texto_personalizado: tipoValido === "personalizado" ? (textoPersonalizado || "") : null,
  };
}

/**
 * Horario — Núcleo: un bloque es la PLANTILLA base del semestre, no una
 * clase de una semana puntual. Se define una sola vez y se proyecta a todas
 * las semanas del semestre (ver obtenerClasesEfectivasSemana) — todo campo
 * (aula, profesor, enlace, notas, color, horario) es fijo para todo el
 * semestre y solo se edita acá, en la plantilla. La única excepción puntual
 * por semana que soporta el modelo es la Modalidad de un día individual —
 * ver cronograma_dias / crearDiaCronograma.
 *
 * `materiaId` null = bloque "Crear personalizado", usa `nombre` propio en vez
 * de heredar el de una materia matriculada real.
 * `color` null = hereda el color de la categoría de la materia (resuelto en
 * el render, ver obtenerContextoMateria en comunidad.js para el mismo
 * patrón de lookup); string = color propio editado a mano, independiente.
 */
function crearBloqueHorario({ materiaId, planEstudioId, nombre, apodo, grupo, dias, modalidad, aula, profesorId, enlace, notas, color }) {
  return sellarTimestamp({
    id: "bh_" + crypto.randomUUID(),
    materia_id: materiaId || null,
    plan_estudio_id: materiaId ? (planEstudioId || null) : null,
    // Solo aplica en modo "Crear personalizado" (materia_id null).
    nombre: materiaId ? null : (nombre || ""),
    apodo: apodo || null,
    grupo: grupo || null,
    // [{ dia: "L"|"K"|"M"|"J"|"V"|"S"|"D", hora_inicio: "HH:MM", hora_fin: "HH:MM" }, ...]
    dias: Array.isArray(dias) ? dias : [],
    modalidad: modalidad || crearModalidadHorario("presencial"),
    aula: aula || null,
    // Un solo profesor por bloque, a propósito (distinto de mm.profesor_ids,
    // que sí es arreglo) — un bloque es una sesión de clase concreta, no
    // toda la materia, así que no necesita soportar 2+ docentes a la vez.
    profesor_id: profesorId || null,
    enlace: enlace || null,
    notas: notas || null,
    color: color || null,
    // Cronograma de clases (reemplaza al viejo excepciones_semana, que
    // aplicaba a TODOS los días de un bloque en una semana dada). Ahora es
    // granular por día individual: una entrada por (numero_semana, dia),
    // y lo único que guarda es la Modalidad efectiva de ese día puntual —
    // ver crearDiaCronograma y obtenerClasesEfectivasSemana. Tumba propia,
    // mismo patrón que cualquier otra colección anidada del proyecto — ver
    // fusionarBloqueHorario en storage-merge.js.
    cronograma_dias: [],
    _eliminados_cronograma_dias: [],
  });
}

/**
 * Horario — Cronograma: ajuste de Modalidad de UN día individual de UNA
 * semana puntual (ej. "el jueves de la semana 6 esta materia es virtual" o
 * "el lunes de la semana 3 no hay clase"). `numeroSemana` es 1-based, igual
 * que el resto de la app calcula semanas del semestre. `dia` es el mismo
 * código de un día en bloque.dias ("L"|"K"|"M"|"J"|"V"|"S"|"D") — junto con
 * numeroSemana identifican de forma única qué clase puntual se está
 * ajustando (un bloque lunes+jueves guarda hasta 2 entradas de cronograma
 * distintas para la misma semana, una por día).
 * `modalidad` es un STRING plano (ej. "presencial"/"virtual"/"asincronica"/
 * "sin_clase"), NO el objeto de crearModalidadHorario — a propósito, para
 * que sea el mismo formato que ya usa bloque.dias[].modalidad (el valor que
 * REALMENTE se pinta en cada tarjetita del grid, ver obtenerEmojiModalidad
 * en horario.js). bloque.modalidad (el campo objeto a nivel de bloque) es
 * un campo aparte que hoy no participa del render — el Cronograma no lo
 * toca.
 * A propósito esto es lo ÚNICO editable por día — aula/profesor/enlace/
 * notas/color/horario siguen siendo responsabilidad exclusiva de la
 * plantilla base (crearBloqueHorario). "Sin clase" ya no es un switch
 * booleano aparte: es un valor más de modalidad, así que cancelar un día
 * puntual es simplemente crear/editar su entrada de cronograma con
 * modalidad "sin_clase".
 */
function crearDiaCronograma({ numeroSemana, dia, modalidad }) {
  return sellarTimestamp({
    id: "cd_" + crypto.randomUUID(),
    numero_semana: Number(numeroSemana),
    dia,
    modalidad: modalidad || "presencial",
  });
}

/**
 * Horario — Núcleo: lista de clases EFECTIVAS de un bloque para una semana
 * concreta — una entrada por cada día en bloque.dias, con su Modalidad
 * resuelta (override de cronograma_dias para ese (numeroSemana, dia) si
 * existe, si no la modalidad ya definida por día en la plantilla —
 * diaBloque.modalidad). Único punto de verdad que debe usar tanto el grid
 * semanal como la sección Cronograma para saber qué modalidad mostrar —
 * nunca leer diaBloque.modalidad directo si lo que importa es "qué pasa
 * este día puntual de esta semana".
 * A diferencia del viejo obtenerBloqueEfectivoSemana, esto NUNCA devuelve
 * null ni oculta nada: modalidad "sin_clase" es solo un valor más de
 * modalidad, la tarjetita sigue existiendo en el grid (atenuada/transparente
 * a criterio de la UI, ver horario.js) — así se evita recalcular layout del
 * grid cada vez que cambia una modalidad puntual.
 * Todo campo que NO sea `dia`/`hora_inicio`/`hora_fin`/`modalidad` viene
 * siempre de la plantilla (aula, profesor, enlace, notas, color, materia_id,
 * nombre, plan_estudio_id) — el Cronograma no los puede tocar.
 */
function obtenerClasesEfectivasSemana(bloque, numeroSemana) {
  const overridesEstaSemana = (bloque.cronograma_dias || []).filter((cd) => cd.numero_semana === numeroSemana);

  return (bloque.dias || []).map((diaBloque) => {
    const override = overridesEstaSemana.find((cd) => cd.dia === diaBloque.dia);
    const modalidad = override ? override.modalidad : diaBloque.modalidad || "presencial";
    return {
      id: bloque.id,
      materia_id: bloque.materia_id,
      plan_estudio_id: bloque.plan_estudio_id,
      nombre: bloque.nombre,
      apodo: bloque.apodo,
      grupo: bloque.grupo,
      dia: diaBloque.dia,
      hora_inicio: diaBloque.hora_inicio,
      hora_fin: diaBloque.hora_fin,
      modalidad,
      aula: bloque.aula,
      profesor_id: bloque.profesor_id,
      enlace: bloque.enlace,
      notas: bloque.notas,
      color: bloque.color,
      // Referencia para la UI: "esta tarjeta tiene un ajuste de Cronograma
      // solo para este día puntual" (ej. mostrar un pequeño ícono), sin
      // tener que comparar campo por campo contra la plantilla.
      tiene_ajuste_cronograma: !!override,
    };
  });
}

/**
 * Horario — Núcleo: número de semana 1-based dentro de un semestre, a partir
 * de fecha_inicio — mismo cálculo de "semanas transcurridas" que ya usa
 * obtenerEstadoEfectivoSemestre, pero acá se necesita el NÚMERO exacto (no
 * solo actual/pasado), para direccionar cronograma_dias y para el header
 * de Horario ("mostrado de forma clara y visible"). Clampeado entre 1 y
 * duracion_semanas — antes de que arranque el semestre muestra semana 1,
 * después de que termine se queda pegado en la última.
 */
function calcularNumeroSemanaSemestre(semestre) {
  const inicio = new Date(semestre.fecha_inicio);
  if (isNaN(inicio.getTime())) return 1;
  const semanasTranscurridas = Math.floor((Date.now() - inicio.getTime()) / (7 * 24 * 60 * 60 * 1000));
  const total = Number(semestre.duracion_semanas) || 16;
  return Math.min(Math.max(semanasTranscurridas + 1, 1), total);
}

/**
 * Horario entre Amigos — Parte 1: registro de UN enlace de horario
 * compartido por el usuario (uno nuevo cada vez que presiona "Compartir
 * horario" — presionarlo de nuevo genera OTRO enlace independiente, no
 * reemplaza el anterior). Vive en datos.horario_enlaces_compartidos
 * (colección top-level, tumba propia _eliminados_horario_enlaces — ver
 * fusionarColeccion en storage-merge.js, mismo patrón que profesores/
 * companeros).
 *
 * `file_id` es el archivo real en Drive (h_<uuid>.json, nombre no
 * descriptivo a propósito — ver auth.js). `permission_id` es el id que
 * devuelve Drive al crear el permiso público de solo lectura
 * (permissions.create) — se guarda para poder revocarlo después con una
 * sola llamada a permissions.delete, sin tener que listar los permisos del
 * archivo primero para encontrarlo.
 *
 * `activo` se apaga al revocar — el registro NUNCA se borra del todo (así
 * la lista de "enlaces que generaste" conserva el historial completo,
 * incluyendo los ya revocados, para que el usuario nunca pierda el rastro
 * de qué compartió alguna vez, aunque ya no esté vivo).
 */
function crearEnlaceHorarioCompartido({ fileId, permissionId, semestreId, apodoPropietario }) {
  return sellarTimestamp({
    id: "hec_" + crypto.randomUUID(),
    file_id: fileId,
    permission_id: permissionId || null,
    semestre_id: semestreId || null,
    fecha_creacion: new Date().toISOString(),
    activo: true,
    // Apodo opcional que el propio usuario escribe al compartir (nunca su
    // nombre real por defecto) — se guarda en el ENLACE, no solo en el
    // snapshot, porque el hook de sync reconstruye el snapshot en cada
    // ciclo (ver actualizarArchivosHorarioCompartidosSiHaceFalta en
    // horario-amigos.js) y necesita poder volver a leerlo sin que el
    // usuario tenga que volver a escribirlo cada vez.
    apodo_propietario: apodoPropietario ? String(apodoPropietario).trim().slice(0, 30) : null,
  });
}

/**
 * Horario entre Amigos — Parte 3: registro de UN horario de AMIGO que este
 * usuario asoció al suyo (dirección opuesta de crearEnlaceHorarioCompartido
 * — ver comentario en configuracion.horario_amigos_vinculados). Vive DENTRO
 * de configuracion (colección propia, tumba `_eliminados_horario_amigos_
 * vinculados`, mismo patrón que enlaces_rapidos — ver fusionarDatos en
 * storage-merge.js).
 *
 * `activo` controla la superposición en el grid (switch "Horarios Activos",
 * Parte 3b) sin desvincular — desvincular de verdad es un borrado real
 * (tumba), no solo apagar `activo`. `color` se asigna una sola vez, al
 * vincular (hash determinístico del id — ver asignarColorAmigo en
 * horario-amigos.js), y quedaría fijo aunque después cambien los otros
 * amigos vinculados, para que el color de cada amigo no "salte" con cada
 * vinculación/desvinculación nueva.
 */
function crearAmigoVinculado({ fileId, nombre, color }) {
  return sellarTimestamp({
    id: "hav_" + crypto.randomUUID(),
    file_id: fileId,
    nombre: nombre ? String(nombre).trim().slice(0, 30) : "Amigo",
    color: color || "#a78bfa",
    activo: true,
    fecha_vinculacion: new Date().toISOString(),
  });
}

/**
 * Escala de notas activa (10 o 100) para una materia matriculada: override
 * propio > escala del plan/universidad > default 100. Único punto de
 * verdad — reutilizar en vez de leer los 2 campos por separado.
 *
 * El valor devuelto es siempre un número (7, 10, 12, 15, 20, 100, "gpa4"...).
 * Ver ESCALAS_DISPONIBLES para la lista completa y
 * obtenerEscalaPorId para ir de este valor crudo al descriptor completo
 * (tipo, max, valores).
 *
 * Ajustes por Universidad (2026-08-08): `configuracion` queda como
 * parámetro por compatibilidad de firma con todos los callers existentes
 * (semestres.js, semestres-tarjetas.js, etc. la siguen pasando), pero ya
 * NO se lee — escala_notas_global se eliminó del modelo, la escala es
 * 100% responsabilidad de cada plan desde ahora. Sin `plan` (caso raro:
 * referencia huérfana) o sin `escala_notas` seteada, cae a 100 directo.
 */
function obtenerEscalaNotasMateria(materia, plan, configuracion) {
  return (
    (materia && materia.escala_notas_override) ||
    (plan && plan.parametros_universidad && plan.parametros_universidad.escala_notas) ||
    100
  );
}

/**
 * Fase 6.2 — Escalas de calificación. Los ids numéricos son los mismos
 * números que ya se guardaban desde siempre (10, 100) — así los datos
 * viejos siguen funcionando sin migración: un plan con escala_notas=100
 * de antes de este cambio sigue encontrando su descriptor acá mismo.
 *
 * QUITADO (2026-08-08, pedido explícito "no nos hace sentido a lo que
 * necesitamos"): existió acá un tipo "letras" (A+ a F, con tabla de
 * equivalencia en %) — se eliminó por completo de esta lista. Un plan
 * viejo que ya tenía escala_notas="letras" guardado simplemente cae al
 * fallback de obtenerEscalaPorId (0-100) la próxima vez que se lea, sin
 * romper nada — no hace falta migrar datos a mano. Varias funciones más
 * abajo (obtenerFraccionNota, notaMinimaParaFraccion,
 * recalcularNotaDesdePuntaje, migrarNotasAsignacionesEscalaPlan,
 * convertirA100/convertirDesde100) todavía tienen una rama genérica
 * `if (escala.tipo === "letras")` — quedan como código muerto inofensivo
 * (nunca se van a disparar, ningún descriptor de acá abajo tiene ese
 * tipo), no se tocaron para no arriesgar el resto de la lógica numérica
 * que sí está viva en esas mismas funciones.
 */
const ESCALAS_DISPONIBLES = [
  { id: 7, etiqueta: "0 – 7", tipo: "numerica", max: 7 },
  { id: 10, etiqueta: "0 – 10", tipo: "numerica", max: 10 },
  { id: 12, etiqueta: "0 – 12", tipo: "numerica", max: 12 },
  { id: 15, etiqueta: "0 – 15", tipo: "numerica", max: 15 },
  { id: 20, etiqueta: "0 – 20", tipo: "numerica", max: 20 },
  { id: 100, etiqueta: "0 – 100", tipo: "numerica", max: 100 },
  // Ajustes por Universidad (2026-08-08): GPA estilo EE.UU. (4.0, 3.7,
  // 3.3...). Unificado (pedido explícito "no tiene sentido que existan 2
  // GPA distintos") — antes había una variante "con decimales" y otra
  // "sin decimales" (solo enteros); se dejó una sola. `paso` es opcional
  // y solo es una pista para el input numérico de la UI (ver
  // config-ajustes.js) — obtenerEscalaPorId/obtenerFraccionNota no lo usan
  // para ningún cálculo (siempre es nota/max, sin importar el paso), así
  // que igual se puede tipear un GPA entero (ej. "3") sin problema.
  //
  // Un plan viejo que haya quedado guardado con escala_notas="gpa4_entero"
  // (el id que existía acá antes de unificar) cae solo al fallback de
  // obtenerEscalaPorId (0-100) la próxima vez que se lea — mismo
  // comportamiento ya documentado arriba para cuando se sacó el tipo
  // "letras", no hace falta migrar datos a mano.
  { id: "gpa4", etiqueta: "GPA 0 – 4", tipo: "numerica", max: 4, paso: 0.1 },
];

/** Descriptor completo de una escala a partir de su id crudo (lo que se
 * guarda en escala_notas/escala_notas_override — ver obtenerEscalaNotasMateria).
 * Si el id no existe (dato corrupto o escala vieja que ya no está en la
 * lista), cae de vuelta a 0-100 en vez de romper cualquier cálculo. */
function obtenerEscalaPorId(escalaId) {
  return ESCALAS_DISPONIBLES.find((e) => e.id === escalaId) || ESCALAS_DISPONIBLES.find((e) => e.id === 100);
}

/**
 * Ajustes por Universidad, ronda 3 (2026-08-08 — bug "un 37 se muestra como
 * 370"): estas dos funciones ya existían DUPLICADAS solo dentro de
 * config-ajustes.js para nota_aprobacion/raspando_override. El mismo
 * problema apareció en semestres-tarjetas.js: la nota final de una materia
 * (calcularNotaFinalMateria) es SIEMPRE 0-100 internamente — es una suma
 * ponderada de pesos de criterios, que son porcentajes (0-100) sin importar
 * la escala de notas del plan — pero se estaba MOSTRANDO ese crudo 0-100
 * directo al usuario en vez de convertirlo a la escala elegida (0-10,
 * 0-20, etc.), igual que antes pasaba con nota_aprobacion. Se centralizan
 * acá para que ambos archivos (config-ajustes.js y semestres-tarjetas.js)
 * puedan compartir la misma conversión probada, en vez de que cada uno
 * mantenga su propia copia. config-ajustes.js sigue con su copia local
 * (ya funcionando, no se tocó para no arriesgar una regresión ahí) —
 * semestres-tarjetas.js importa estas.
 *
 * Reciben el DESCRIPTOR de escala completo (el objeto que devuelve
 * obtenerEscalaPorId), no el id crudo — igual que el resto de las
 * funciones de esta sección. "letras" no tiene conversión numérica
 * razonable (A+/A/... no son un rango 0-N), así que ahí se devuelve el
 * número sin tocar, mismo criterio que ya usaba config-ajustes.js.
 */
function convertirA100(valorEnEscala, escala) {
  const n = Number(valorEnEscala);
  if (!Number.isFinite(n)) return NaN;
  if (!escala || escala.tipo === "letras" || !escala.max) return n;
  return (n / escala.max) * 100;
}
function convertirDesde100(valorEn100, escala) {
  const n = Number(valorEn100);
  if (!Number.isFinite(n)) return NaN;
  if (!escala || escala.tipo === "letras" || !escala.max) return n;
  return (n / 100) * escala.max;
}

/**
 * Ajustes por Universidad, ronda 4 (2026-08-08 — bug real: "cambio de
 * escala no migra las notas ya cargadas"). Hasta ahora, cambiar
 * escala_notas de un plan NO tocaba ninguna nota ya cargada — era una
 * decisión de diseño explícita (documentada en config-ajustes.js: "solo
 * cambia con qué escala se reinterpretan de acá en adelante"). En la
 * práctica eso deja las notas viejas sin sentido: un 8/10 pasa a leerse
 * como 8/100 si el plan cambia a esa escala, y el cálculo de puntos
 * ponderados se rompe porque fraccion = nota/escala.max deja de estar
 * entre 0 y 1 (síntoma reportado: "puntaje x10" al cambiar de escala 100
 * a escala 10). Esta función reemplaza esa decisión: migra de verdad.
 *
 * Recorre TODAS las materias matriculadas de TODOS los semestres que
 * pertenecen a este plan (mm.plan_estudio_id) y convierte cada
 * asignación:
 *   - modo "puntos": se re-deriva `nota` desde puntaje_obtenido/valor con
 *     la escala NUEVA vía recalcularNotaDesdePuntaje — más preciso que
 *     convertir la nota vieja, porque puntaje_obtenido nunca dependió de
 *     la escala (siempre fueron puntos crudos).
 *   - modo "nota": conversión lineal escala vieja → escala nueva
 *     (mismo principio que convertirA100/convertirDesde100 de arriba).
 *   - modo "extra": no se toca — `valor` ahí ES la calificación directa,
 *     nunca pasó por ninguna escala.
 *
 * Si CUALQUIERA de las dos escalas (vieja o nueva) es "letras", no hay
 * conversión lineal razonable entre letras y números — se deja la nota
 * como estaba (el usuario deberá revisarla a mano al cambiar desde/hacia
 * una escala de letras; es un caso borde real, no algo que se pueda
 * inventar con una fórmula).
 */
function migrarNotasAsignacionesEscalaPlan(datos, planId, escalaIdVieja, escalaIdNueva) {
  const escalaVieja = obtenerEscalaPorId(escalaIdVieja);
  const escalaNueva = obtenerEscalaPorId(escalaIdNueva);
  if (escalaVieja.id === escalaNueva.id) return;
  const puedeConvertirLineal = escalaVieja.tipo !== "letras" && escalaNueva.tipo !== "letras";

  (datos.semestres || []).forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      if (mm.plan_estudio_id !== planId) return;
      (mm.criterios || []).forEach((criterio) => {
        (criterio.asignaciones || []).forEach((asig) => {
          if (asig.modo_calificacion === "puntos") {
            if (asig.puntaje_obtenido === null || asig.puntaje_obtenido === undefined) return;
            recalcularNotaDesdePuntaje(asig, escalaIdNueva);
            sellarTimestamp(asig);
          } else if (asig.modo_calificacion === "nota") {
            if (asig.nota === null || asig.nota === undefined) return;
            if (!puedeConvertirLineal) return;
            const fraccion = Number(asig.nota) / escalaVieja.max;
            asig.nota = redondearDecimales(fraccion * escalaNueva.max, 6);
            sellarTimestamp(asig);
          }
          // modo "extra": nunca pasó por escala, no se toca.
        });
      });
    });
  });
}

/**
 * Fracción (0 a 1, o más de 1 si la nota está mal cargada) que representa
 * una nota cruda dentro de su escala — el único lugar donde "nota" deja de
 * ser un número o una letra sueltos y se vuelve algo comparable/sumable.
 * Devuelve null si la nota no es válida para esa escala (letra que no
 * existe, número no finito, etc.) — quien llama decide qué hacer con eso.
 */
function obtenerFraccionNota(nota, escalaId) {
  if (nota === null || nota === undefined || nota === "") return null;
  const escala = obtenerEscalaPorId(escalaId);
  if (escala.tipo === "letras") {
    const encontrada = escala.valores.find((v) => v.letra === nota);
    return encontrada ? encontrada.fraccion : null;
  }
  const n = Number(nota);
  if (!Number.isFinite(n)) return null;
  return n / escala.max;
}

/**
 * Camino inverso: dada una fracción (0 a 1+) necesaria, ¿qué nota "cruda"
 * hay que sacarse en esta escala para llegarle? Usado por el simulador
 * "Proyectar". Para numéricas es directo (fracción × máximo, redondeado
 * hacia arriba para no subestimar). Para letras se busca la letra MÁS BAJA
 * que todavía cubre esa fracción — si ni la mejor letra (A+, fracción 1.0)
 * alcanza, devuelve null (lo mismo que "ni con nota máxima se puede").
 */
function notaMinimaParaFraccion(fraccion, escalaId) {
  const escala = obtenerEscalaPorId(escalaId);
  if (escala.tipo === "letras") {
    const ordenAscendente = [...escala.valores].sort((a, b) => a.fraccion - b.fraccion);
    const encontrada = ordenAscendente.find((v) => v.fraccion >= fraccion);
    return encontrada ? encontrada.letra : null;
  }
  return Math.ceil(fraccion * escala.max * 100) / 100;
}

/**
 * Redondeo "decimal-safe": la corrección anterior (sumar Number.EPSILON,
 * ~2.22e-16) era demasiado pequeña para corregir el arrastre real que deja
 * una cadena de sumas/divisiones (típicamente de orden 1e-10 a 1e-13) —
 * por eso 67.594999999999 seguía mostrando 67.60. toPrecision(12) limpia
 * ese ruido de binario ANTES de redondear (un double solo garantiza ~15-17
 * dígitos significativos reales; lo que sobra después del dígito 12 casi
 * siempre es basura de cálculo, no precisión real), y recién sobre ese
 * valor limpio se aplica Math.round. Si el valor real cae justo en .5,
 * esto sigue redondeando hacia arriba (correcto) — no fuerza el resultado
 * hacia abajo, solo evita que el arrastre invente un .5 que no existe.
 */
function redondearDecimales(num, decimales) {
  const n = Number(num);
  if (!isFinite(n)) return 0;
  const limpio = Number(n.toPrecision(12));
  const factor = Math.pow(10, decimales);
  return Math.round(limpio * factor) / factor;
}

/**
 * Ajuste (pedido explícito, "por ahora"): la nota final se redondea al
 * múltiplo de 5 más cercano (0, 5, 10, ..., 100) antes de decidir si
 * aprobó — así un 67.5 redondea a 70 y cuenta como aprobado. Reemplaza la
 * lógica anterior de "raspando" (que usaba un umbral_pasar_raspando
 * guardado aparte); con este redondeo general ese campo dejó de existir
 * (limpiado en Fase 6, punto 5) — nota_aprobacion es ahora la única fuente
 * de verdad, y "pasar raspando" se calcula al vuelo desde ella (ver
 * calcularObjetivoPasarRaspando) solo para el simulador "Proyectar".
 */
function redondearNotaFinalAlCincoMasCercano(nota) {
  if (nota === null || nota === undefined) return nota;
  return Math.round(Number(nota) / 5) * 5;
}

/**
 * FIX (2026-08-06 — "la pill de Nota muestra el puntaje crudo, no la nota
 * equivalente"): dado el puntaje crudo que el usuario tipeó
 * (asignacion.puntaje_obtenido, de 0 a asignacion.valor), calcula la nota
 * REAL equivalente en la escala activa de la materia y la deja en
 * asignacion.nota — la misma nota que se mostraría si el usuario hubiera
 * elegido modo "nota" directamente. Sin redondeo al 5 más cercano (ese
 * redondeo es exclusivo de nota_final de toda la materia, ver
 * redondearNotaFinalAlCincoMasCercano — acá aplicaría de más, dos veces).
 *
 * Para escalas numéricas es una simple regla de tres. Para letras se busca
 * la letra cuya fracción de corte sea la más alta que el puntaje SÍ
 * alcanza (a diferencia de notaMinimaParaFraccion, que busca la mínima
 * letra NECESARIA para un objetivo — acá se quiere la letra que el
 * desempeño real ya ganó, no una meta).
 *
 * Muta la asignación en el lugar (mismo patrón que sellarTimestamp) y la
 * devuelve, para poder encadenar `sellarTimestamp(recalcularNotaDesdePuntaje(...))`.
 */
function recalcularNotaDesdePuntaje(asignacion, escalaActiva) {
  if (asignacion.puntaje_obtenido === null || asignacion.puntaje_obtenido === undefined) {
    asignacion.nota = null;
    return asignacion;
  }
  const puntaje = Number(asignacion.puntaje_obtenido) || 0;
  const valor = Number(asignacion.valor) || 0;
  const fraccion = valor > 0 ? puntaje / valor : 0;
  const escala = obtenerEscalaPorId(escalaActiva);
  if (escala.tipo === "letras") {
    const ordenDescendente = [...escala.valores].sort((a, b) => b.fraccion - a.fraccion);
    const encontrada = ordenDescendente.find((v) => fraccion >= v.fraccion);
    // Si ni la letra más baja (F) se alcanza, igual se asigna la más baja
    // disponible — no queda "sin nota" solo porque el desempeño fue peor
    // que el piso de la tabla.
    asignacion.nota = encontrada ? encontrada.letra : ordenDescendente[ordenDescendente.length - 1].letra;
  } else {
    asignacion.nota = fraccion * escala.max;
  }
  return asignacion;
}

/**
 * Motor de cálculo (punto 3): puntos ponderados reales que aporta una
 * asignación calificada, normalizados a escala 0-100. Sin nota todavía
 * (null) no aporta puntos — se trata como pendiente, nunca como un cero.
 *
 * FIX (2026-08-06): antes, el modo "puntos" capaba `nota` contra `valor`
 * directo, tratando ese campo como puntaje crudo — nunca pasaba por la
 * escala de notas. Ahora `nota` SIEMPRE guarda la nota ya convertida a la
 * escala activa (ver recalcularNotaDesdePuntaje, que se llama al guardar
 * la asignación), sin importar el modo — así los dos modos convergen a un
 * único camino de cálculo acá. El resultado final (puntos aportados a la
 * materia) da matemáticamente igual que antes para datos ya migrados —
 * cambia que ahora `nota` es una nota real, no puntaje disfrazado.
 */
function calcularPuntosAsignacion(asignacion, escalaActiva) {
  // Criterio "✨ Extra" simplificado (2026-08-07): estas asignaciones no
  // tienen "nota" — `valor` ES directamente los puntos que aporta, sin
  // pasar por la escala ni por un estado "pendiente" (se cuentan apenas
  // se cargan). Ver comentario de `modoCalificacion` en crearAsignacion.
  if (asignacion.modo_calificacion === "extra") return Number(asignacion.valor) || 0;
  if (asignacion.nota === null || asignacion.nota === undefined) return 0;
  // Fase 6.2: obtenerFraccionNota entiende tanto escalas numéricas (nota/max)
  // como letras (A+, B-, etc. → su fracción de la tabla) — un solo camino
  // para las dos, en vez de duplicar la lógica de conversión acá.
  const fraccion = obtenerFraccionNota(asignacion.nota, escalaActiva);
  if (fraccion === null) return 0;
  // Redondeo epsilon-safe a 6 decimales: sin esto, sumar muchas asignaciones
  // con divisiones no exactas (ej. nota/escala) va acumulando basura de
  // coma flotante que después, al mostrar solo 2 decimales, hace que el
  // total se vea redondeado "de más" (ver redondearDecimales arriba).
  return redondearDecimales(fraccion * asignacion.valor, 6);
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
  return redondearDecimales(total, 6);
}

/**
 * Fase 6 — Simulador "Proyectar" (What If). Todo lo de acá abajo es cálculo
 * puro: nunca muta materiaMatriculada ni llama a sellarTimestamp/
 * marcarCambioPendiente. "Pendiente" = cualquier asignación con nota null
 * o undefined, sin importar en qué criterio esté.
 */
function obtenerAsignacionesPendientes(materiaMatriculada) {
  const pendientes = [];
  (materiaMatriculada.criterios || []).forEach((criterio) => {
    (criterio.asignaciones || []).forEach((asignacion) => {
      // Las asignaciones de "✨ Extra" (modo_calificacion:"extra") no tienen
      // concepto de "pendiente" — ya cuentan completas apenas se cargan
      // (ver calcularPuntosAsignacion), así que nunca entran acá. Sin este
      // filtro, "Máximo posible" y "Nota necesaria" del simulador Proyectar
      // las tratarían como una nota que falta por sacar, inflando el
      // cálculo con puntos que ya están contados en lo obtenido.
      if (asignacion.modo_calificacion === "extra") return;
      if (asignacion.nota === null || asignacion.nota === undefined) {
        pendientes.push({ criterio, asignacion });
      }
    });
  });
  return pendientes;
}

/**
 * Nota final si se saca la nota máxima en absolutamente todo lo pendiente
 * (modo "Máximo posible"): lo ya obtenido + el 100% del peso pendiente.
 */
function calcularMaximoPosibleMateria(materiaMatriculada, escalaActiva) {
  const puntosObtenidos = calcularNotaFinalMateria(materiaMatriculada, escalaActiva);
  const pesoPendienteTotal = obtenerAsignacionesPendientes(materiaMatriculada).reduce(
    (total, p) => total + (Number(p.asignacion.valor) || 0),
    0
  );
  return redondearDecimales(puntosObtenidos + pesoPendienteTotal, 6);
}

/**
 * Fracción uniforme necesaria en CADA asignación pendiente para que la
 * nota final llegue a `objetivo` (0-100, mismas unidades que
 * nota_aprobacion). "Uniforme" = mismo % de desempeño en todas las
 * pendientes — así el peso real de cada una (punto 3) ya queda respetado
 * solo, sin repartir puntos a mano ni caer en un reparto ingenuo 1:1.
 *
 * Fase 6.2: devuelve una FRACCIÓN (0 a 1+), no una nota cruda — porque la
 * nota cruda depende de la escala (número o letra), y esa conversión le
 * toca a la UI vía notaMinimaParaFraccion(). fraccionNecesaria > 1 =
 * imposible sin importar la escala (nadie saca más del 100% de nada).
 * Devuelve:
 *  - { estado: "ya_alcanzado" } si lo ya obtenido alcanza sin necesitar más.
 *  - { estado: "imposible", fraccionNecesaria } si ni con nota máxima
 *    alcanza (fraccionNecesaria > 1, informativo).
 *  - { estado: "posible", fraccionNecesaria } en el caso normal.
 */
function calcularNotaNecesariaUniforme(materiaMatriculada, escalaActiva, objetivo) {
  const puntosObtenidos = calcularNotaFinalMateria(materiaMatriculada, escalaActiva);
  if (puntosObtenidos >= objetivo) return { estado: "ya_alcanzado" };

  const pesoPendienteTotal = obtenerAsignacionesPendientes(materiaMatriculada).reduce(
    (total, p) => total + (Number(p.asignacion.valor) || 0),
    0
  );
  if (pesoPendienteTotal <= 0) return { estado: "imposible", fraccionNecesaria: null };

  const puntosFaltantes = objetivo - puntosObtenidos;
  const fraccionNecesaria = puntosFaltantes / pesoPendienteTotal;

  if (fraccionNecesaria > 1) return { estado: "imposible", fraccionNecesaria };
  return { estado: "posible", fraccionNecesaria };
}

/**
 * Objetivo real de "Pasar raspando": el mínimo valor CRUDO de nota_final
 * que, redondeado al 5 más cercano (mismo criterio que
 * redondearNotaFinalAlCincoMasCercano), ya alcanza `notaAprobacion` — ej.
 * notaAprobacion=70 -> 67.5, porque Math.round(67.5/5)*5 = 70. Reemplaza
 * al viejo umbral_pasar_raspando (ya no se lee en ningún otro lado del
 * proyecto): a nivel de sistema, 67.5 y 72.4 aprueban exactamente igual,
 * así que este modo existe aparte de "Mínimo pasable" solo para el caso
 * de "ya no da para más" — no es la meta que se persigue normalmente.
 */
function calcularObjetivoPasarRaspando(notaAprobacion) {
  const multiploSuperior = Math.ceil(Number(notaAprobacion) / 5) * 5;
  return multiploSuperior - 2.5;
}

/**
 * Ajustes por Universidad (ronda 2, 2026-08-08): "Pasar raspando" ahora
 * admite un override manual por plan (`parametros_universidad.raspando_override`,
 * en la MISMA unidad 0-100 que nota_aprobacion) — la persona puede fijar a
 * mano con qué nota exacta considera que "raspó", en vez de aceptar siempre
 * el cálculo automático de calcularObjetivoPasarRaspando. Esta función es el
 * único punto que decide cuál de los dos usar, así que reemplaza a
 * calcularObjetivoPasarRaspando en cualquier lugar que necesite el
 * objetivo REAL (config-ajustes.js para mostrarlo, semestres-tarjetas.js
 * para el simulador Proyectar).
 *
 * La AUSENCIA del campo (no null, no 0) es la señal de "sin override,
 * calculalo solo" — por eso se chequea undefined/null explícito y no un
 * simple `if (params.raspando_override)`, que trataría un override
 * legítimo de 0 como "no hay override".
 */
function resolverObjetivoPasarRaspando(params) {
  const p = params || {};
  const tieneOverride = p.raspando_override !== null && p.raspando_override !== undefined;
  if (tieneOverride) return Number(p.raspando_override);
  const notaAprobacion = Number(p.nota_aprobacion) || 70;
  return calcularObjetivoPasarRaspando(notaAprobacion);
}

/* =========================================================================
   Dashboard académico — Promedio ponderado (niveles a/b) + estadísticas de
   aprobación. Todo lo de acá abajo es cálculo puro (nunca muta nada, nunca
   llama a sellarTimestamp/marcarCambioPendiente) — se recalcula siempre al
   vuelo a partir de estado.datos, igual criterio que calcularNotaFinalMateria.

   Decisión confirmada (respuestas del prompt de diseño):
   - Se incluyen materias de semestres ACTUALES (en curso), usando su
     nota_final VIGENTE (respeta override manual) — no hace falta que el
     semestre esté "Terminado" ni que mm.resultado esté seteado.
   - La nota de cada materia se redondea al 5 más cercano ANTES de
     ponderar (mismo criterio que terminarSemestre en semestres.js),
     respetando el switch redondeo_activo de CADA plan — en Modo Hardcore
     dos materias del mismo semestre pueden pertenecer a planes con
     configuraciones de redondeo distintas.
   - Nivel (c) "combinado de TODO junto" queda EXPLÍCITAMENTE fuera de esta
     entrega (documentado como pendiente al final de este bloque) — (a) y
     (b) son la prioridad y deben quedar sólidos primero.
   ========================================================================= */

/**
 * nota_final VIGENTE de una materia matriculada, sin mutar nada — mismo
 * cálculo que calcularNotaFinalVigente en semestres-tarjetas.js (que sigue
 * siendo la fuente para la UI de esa tarjeta puntual; esta copia vive acá
 * para que el dashboard no tenga que importar desde un archivo de UI).
 * Respeta nota_final_manual y el viejo bono de mm.puntos_extra, igual que
 * el motor de notas real — así el promedio del dashboard nunca se
 * desalinea de lo que la persona ve en la tarjeta de cada materia.
 *
 * "✨ Extra" como criterio real (reemplaza a mm.puntos_extra — ver
 * crearCriterio): un criterio con es_extra:true ya suma sus puntos solo,
 * porque calcularNotaFinalMateria recorre TODOS los criterios de la
 * materia sin distinguirlos — no necesita tratamiento especial acá. El
 * bloque de mm.puntos_extra que sigue abajo es SOLO compatibilidad hacia
 * atrás: materias matriculadas de antes de este cambio que ya tenían ese
 * campo guardado con un valor > 0 lo siguen viendo aplicado, pero la UI ya
 * no lo escribe (reemplazado por el botón "✨ Extra" → nuevo criterio).
 */
function calcularNotaFinalVigenteMateria(mm, materia, plan, configuracion) {
  if (mm.nota_final_manual) return mm.nota_final;
  const escala = obtenerEscalaNotasMateria(materia, plan, configuracion);
  const base = calcularNotaFinalMateria(mm, escala);
  const extraLegado = Number(mm.puntos_extra) || 0;
  if (extraLegado > 0 && typeof base === "number") {
    // FIX (2026-08-08 — Ajustes por Universidad): antes se tapaba contra
    // `escala` (el id crudo: 10, 100, "letras"...), pero `base` viene de
    // calcularNotaFinalMateria, que YA es interno 0-100 sin importar la
    // escala de captura (criterios/asignaciones ponderan por peso, no por
    // escala — ver calcularPuntosAsignacion). Tapar contra `escala` daba
    // igual mientras esa escala fuera siempre 100 en la práctica (única
    // opción real hasta ahora); con escala_notas editable por plan, un
    // plan en 0-10 capaba la nota final en 10 en vez de 100, y en "letras"
    // Math.min(numero, "letras") da NaN. El tope real siempre es 100.
    return Math.min(base + extraLegado, 100);
  }
  return base;
}

/**
 * nota_final vigente de una materia YA redondeada al 5 más cercano si el
 * plan de esa materia tiene redondeo_activo (default true) — mismo switch
 * por plan que ya usa terminarSemestre (semestres.js) para decidir
 * aprobado/reprobado. Única puerta de entrada para "la nota que cuenta
 * para el promedio" — nunca se pondera la cruda sin pasar por acá primero.
 */
function calcularNotaParaPromedio(mm, materia, plan, configuracion) {
  const vigente = calcularNotaFinalVigenteMateria(mm, materia, plan, configuracion);
  if (vigente === null || vigente === undefined) return null;
  const redondeoActivo = !plan || !plan.parametros_universidad || plan.parametros_universidad.redondeo_activo !== false;
  return redondeoActivo ? redondearNotaFinalAlCincoMasCercano(vigente) : vigente;
}

/**
 * Recorre TODOS los semestres (actuales + pasados) y devuelve una lista
 * plana de "materias matriculadas resolubles" — con su materia/plan/
 * semestre ya unidos por join y su nota lista para ponderar. Filtra sola
 * cualquier mm huérfana (plan o materia borrados) sin explotar. Único
 * punto de entrada que recorren las funciones de agrupación de abajo,
 * para no repetir el mismo recorrido triple.
 */
/**
 * FIX (promedio ponderado — "el semestre actual no debe contar en el
 * promedio general de ninguna carrera"): `incluirActuales` decide si las
 * materias de semestres con estado efectivo "actual" entran o no en la
 * lista. El nivel (a) del dashboard ("Promedio por semestre") SÍ debe
 * seguir mostrando el semestre actual con sus notas en vivo (para ver
 * cómo va cambiando mientras se cursa) — pero los niveles (b) "por
 * carrera" y (c) "combinado" deben excluirlo por completo, sin importar
 * si ya tiene notas cargadas o no: mientras el semestre siga activo,
 * cualquier nota puede seguir cambiando, así que no es un promedio
 * "cerrado" todavía. Default true (comportamiento de siempre) para no
 * romper ningún otro caller que no pase el parámetro.
 */
function listarMatriculasResolubles(datos, incluirActuales = true) {
  const resultado = [];
  (datos.semestres || []).forEach((semestre) => {
    if (!incluirActuales && obtenerEstadoEfectivoSemestre(semestre) === "actual") return;
    (semestre.materias_matriculadas || []).forEach((mm) => {
      const plan = (datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
      const materia = plan && (plan.materias || []).find((m) => m.id === mm.materia_id);
      if (!plan || !materia) return; // referencia huérfana — se ignora, no rompe el cálculo
      const nota = calcularNotaParaPromedio(mm, materia, plan, datos.configuracion);
      const creditos = Number(materia.creditos) || 0;
      resultado.push({ semestre, mm, materia, plan, nota, creditos });
    });
  });
  return resultado;
}

/**
 * Promedio ponderado por créditos: Σ(nota×créditos) / Σcréditos, sobre una
 * lista ya filtrada de entradas { nota, creditos } (ver
 * listarMatriculasResolubles). Ignora entradas sin nota todavía (nota
 * null = nunca se calificó nada en esa materia) — no cuentan como 0, se
 * excluyen del todo, igual criterio que "pendiente" en el resto del motor
 * de notas (ver calcularPuntosAsignacion). Devuelve { promedio: null, ... }
 * si no hay ninguna entrada válida (nada que promediar todavía) — un 0
 * real sería engañoso ahí.
 */
function calcularPromedioPonderado(entradas) {
  let sumaPonderada = 0;
  let sumaCreditos = 0;
  let materiasContadas = 0;
  (entradas || []).forEach(({ nota, creditos }) => {
    if (nota === null || nota === undefined) return;
    if (!(creditos > 0)) return; // sin créditos válidos no aporta al ponderado
    sumaPonderada += nota * creditos;
    sumaCreditos += creditos;
    materiasContadas += 1;
  });
  if (sumaCreditos <= 0) return { promedio: null, creditos: 0, materias: materiasContadas };
  return { promedio: redondearDecimales(sumaPonderada / sumaCreditos, 2), creditos: sumaCreditos, materias: materiasContadas };
}

/**
 * Nivel (a) — Promedio por semestre, separado por universidad. Relevante
 * en Modo Hardcore: si un semestre tiene materias de más de un plan (y
 * esos planes son de universidades distintas), cada universidad obtiene
 * su propio promedio independiente — nunca se mezclan automáticamente.
 * Agrupa por `plan.universidad` (no por plan_estudio_id) a propósito: dos
 * planes de la MISMA universidad dentro del mismo semestre sí deben
 * combinarse en un solo número, ya que la separación real que pide el
 * usuario es por universidad, no por carrera.
 *
 * Devuelve, por cada semestre (más reciente primero), { semestre,
 * universidades: [{ universidad, promedio, creditos, materias }] } — una
 * entrada por cada universidad presente en ese semestre.
 */
function calcularPromedioPorSemestreYUniversidad(datos) {
  const entradas = listarMatriculasResolubles(datos);
  const porSemestre = new Map(); // semestre.id -> Map(universidad -> entradas[])

  entradas.forEach((e) => {
    if (!porSemestre.has(e.semestre.id)) porSemestre.set(e.semestre.id, new Map());
    const porUniversidad = porSemestre.get(e.semestre.id);
    // Universidad — separación nombre_completo/siglas (2026-08-22): se
    // agrupa/etiqueta por siglas (mismo criterio "badge" que el resto de
    // la app) para que semestres-dashboard.js siga recibiendo un string
    // corto tal cual lo esperaba antes de este cambio, sin tener que
    // tocar ese archivo.
    const universidad = (e.plan.universidad && (e.plan.universidad.siglas || e.plan.universidad.nombre_completo)) || "Sin universidad";
    if (!porUniversidad.has(universidad)) porUniversidad.set(universidad, []);
    porUniversidad.get(universidad).push(e);
  });

  const semestresOrdenados = (datos.semestres || [])
    .filter((s) => porSemestre.has(s.id))
    .sort((a, b) => String(b.fecha_inicio).localeCompare(String(a.fecha_inicio)));

  return semestresOrdenados.map((semestre) => {
    const porUniversidad = porSemestre.get(semestre.id);
    const universidades = Array.from(porUniversidad.entries()).map(([universidad, entradasU]) => {
      const resultado = calcularPromedioPonderado(entradasU);
      // escalaId (2026-08-08, coherencia de escala en el dashboard): solo
      // tiene sentido convertir este promedio a una escala si TODOS los
      // planes agrupados bajo esta universidad usan la MISMA escala_notas
      // — caso borde real: 2 carreras de la misma universidad con
      // reglamentos de notas distintos (una en 0-10, otra en 0-100). Si no
      // coinciden, se devuelve null y quien llama (semestres-dashboard.js)
      // muestra el 0-100 crudo en vez de adivinar con la escala de un plan
      // que no corresponde a todo el grupo.
      const escalasDelGrupo = new Set(entradasU.map((e) => (e.plan.parametros_universidad || {}).escala_notas ?? 100));
      const escalaId = escalasDelGrupo.size === 1 ? [...escalasDelGrupo][0] : null;
      return { universidad, escalaId, ...resultado };
    });
    return { semestre, universidades };
  });
}

/**
 * Nivel (b) — Promedio general por carrera/plan, acumulado a lo largo de
 * TODA la trayectoria (todos los semestres, actuales y pasados, de ese
 * plan de estudios) — a diferencia de (a), acá no importa en qué semestre
 * puntual estuvo cada materia, se junta todo por plan_estudio_id.
 *
 * Devuelve un arreglo de { plan, promedio, creditos, materias } — uno por
 * cada plan que tenga al menos una materia matriculada en algún semestre.
 * Incluye planes ya no-activos (ej. carrera que se dejó de cursar) siempre
 * que tengan historial real — así el promedio de una carrera pausada no
 * desaparece solo por desactivarla.
 */
function calcularPromedioPorPlan(datos) {
  const entradas = listarMatriculasResolubles(datos, false)
  const porPlan = new Map(); // plan.id -> entradas[]

  entradas.forEach((e) => {
    if (!porPlan.has(e.plan.id)) porPlan.set(e.plan.id, []);
    porPlan.get(e.plan.id).push(e);
  });

  return Array.from(porPlan.entries()).map(([planId, entradasP]) => {
    const plan = entradasP[0].plan;
    const resultado = calcularPromedioPonderado(entradasP);
    return { plan, ...resultado };
  });
}

/**
 * Nivel (c) — Promedio combinado de TODO junto, mezclando universidades/
 * carreras distintas en un solo número total (caso: 2 carreras en
 * paralelo, se quiere ver un total único).
 *
 * Decisión confirmada (respuesta del prompt de diseño, misma sesión que
 * (a)/(b)): el "general" se arma a partir de lo que aportó cada semestre
 * en concreto, ponderando siempre sobre valores SIN redondear a mitad de
 * camino — nunca se promedia el número YA redondeado que se muestra en
 * los niveles (a)/(b), porque eso compondría error de redondeo. En la
 * práctica esto significa lo mismo que hacen calcularPromedioPorPlan y
 * calcularPromedioPorSemestreYUniversidad: se pondera directo sobre
 * listarMatriculasResolubles (notas crudas ya redondeadas al 5 más
 * cercano por materia — eso SÍ corresponde, es la nota real de esa
 * materia — pero nunca sobre un promedio ya agregado). No hay
 * agrupamiento acá: es calcularPromedioPonderado sobre TODAS las
 * entradas, sin separar por plan ni por universidad.
 *
 * Una materia repetida (reprobada y vuelta a cursar) cuenta las veces que
 * aparece como mm real en el historial — mismo criterio ya confirmado
 * para (b), sin deduplicar intentos.
 */
function calcularPromedioTotalCombinado(datos) {
  const entradas = listarMatriculasResolubles(datos, false)
  return calcularPromedioPonderado(entradas);
}

/**
 * Punto 2 — Porcentaje de cursos aprobados/reprobados. Basado en
 * mm.resultado (independiente de materia.estado, que es manual/sticky del
 * Plan de Estudios) — SOLO cuenta materias ya CERRADAS (resultado !==
 * null); una materia en curso o con notas incompletas no cuenta en
 * ninguno de los dos lados, no se adivina. `planId` es opcional: si se
 * pasa, filtra solo las matrículas de ese plan; sin él, es global (toda la
 * trayectoria, todos los planes).
 *
 * Devuelve { totalCursos, aprobadas: {cantidad, creditos, promedio,
 * porcentaje}, reprobadas: {...} } — el "promedio" de cada lado es el
 * promedio ponderado (mismo cálculo que arriba) SOLO de las materias de
 * ese lado, para el texto tipo "80.6 promedio de cursos aprobados".
 */
function calcularEstadisticasAprobacion(datos, planId) {
  const entradas = listarMatriculasResolubles(datos).filter((e) => {
    if (planId && e.plan.id !== planId) return false;
    // FIX (2026-08-07 — "si el semestre está marcado como actual no debe
    // aparecer en las estadísticas hasta que esté guardado como pasado"):
    // obtenerEstadoEfectivoSemestre ya colapsa manual-forzado vs.
    // automático-por-fecha en un solo valor de salida — "actual" y
    // "actual forzado" son equivalentes acá (ambos devuelven "actual"),
    // igual que "pasado" y "pasado forzado" (ambos devuelven "pasado").
    // mm.resultado se puede marcar a mano de forma independiente del
    // estado del semestre (ver semestres-tarjetas.js), así que sin este
    // filtro un semestre todavía en curso podría colarse acá si alguien
    // marcó alguna materia como aprobada/reprobada antes de tiempo.
    if (obtenerEstadoEfectivoSemestre(e.semestre) === "actual") return false;
    return e.mm.resultado === "aprobada" || e.mm.resultado === "reprobada";
  });

  const aprobadasEntradas = entradas.filter((e) => e.mm.resultado === "aprobada");
  const reprobadasEntradas = entradas.filter((e) => e.mm.resultado === "reprobada");

  const resumen = (lista) => {
    const ponderado = calcularPromedioPonderado(lista);
    return { cantidad: lista.length, creditos: ponderado.creditos, promedio: ponderado.promedio };
  };

  const totalCursos = entradas.length;
  const aprobadas = resumen(aprobadasEntradas);
  const reprobadas = resumen(reprobadasEntradas);

  return {
    totalCursos,
    aprobadas: { ...aprobadas, porcentaje: totalCursos > 0 ? redondearDecimales((aprobadas.cantidad / totalCursos) * 100, 1) : 0 },
    reprobadas: { ...reprobadas, porcentaje: totalCursos > 0 ? redondearDecimales((reprobadas.cantidad / totalCursos) * 100, 1) : 0 },
  };
}

/**
 * Punto 3 — Detalle por estado, usando ÚNICAMENTE los 4 estados que ya
 * existen en la app (Aprobada, Cursando, Reprobada, Pendiente — ver
 * ESTADOS_MATERIA en plan-vista-lista-tarjetas.js). A propósito NO cuenta
 * mm.resultado ni nada de Semestres — este conteo es sobre materia.estado
 * del PLAN (el campo manual/sticky), recorriendo TODAS las materias de
 * TODOS los planes (o de un solo plan si se pasa `planId`), incluyendo las
 * que nunca se han matriculado todavía. "Cursando" se lee vía
 * obtenerEstadoEfectivoMateria (nunca materia.estado crudo), para que
 * coincida exactamente con lo que ya muestra el Plan de Estudios en su
 * propia UI.
 */
function calcularDetallePorEstado(datos, planId) {
  const conteo = { pendiente: 0, cursando: 0, aprobado: 0, reprobado: 0 };
  const planes = planId ? (datos.planes_estudio || []).filter((p) => p.id === planId) : datos.planes_estudio || [];

  planes.forEach((plan) => {
    (plan.materias || []).forEach((materia) => {
      const efectivo = obtenerEstadoEfectivoMateria(materia, plan.id, datos);
      if (efectivo === "cursando") conteo.cursando += 1;
      else if (efectivo === "aprobado") conteo.aprobado += 1;
      else if (efectivo === "reprobado") conteo.reprobado += 1;
      else conteo.pendiente += 1;
    });
  });

  return conteo;
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

/* ===================== Comunidad — Parte 1: Profesor y Compañero ===================== */

/**
 * Comunidad — Parte 2 (conecta el botón "Historial" de Plan de Estudios,
 * que hasta ahora era un stub fijo — ver plan-detalle.js): todos los
 * intentos reales de cursar `materiaId` dentro de `planEstudioId`, cruzando
 * TODOS los semestres del historial. Devuelve [{ semestre, mm }], más
 * reciente primero — mismo criterio de orden que obtenerHistorialProfesor.
 */
function obtenerIntentosMateria(materiaId, planEstudioId, datos) {
  const resultado = [];
  (datos.semestres || []).forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      if (mm.materia_id === materiaId && mm.plan_estudio_id === planEstudioId) {
        resultado.push({ semestre, mm });
      }
    });
  });
  resultado.sort((a, b) => new Date(b.semestre.fecha_inicio) - new Date(a.semestre.fecha_inicio));
  return resultado;
}

/**
 * Profesor — vive en datos.profesores (colección top-level, tumba propia
 * _eliminados_profesores). "materias" es de referencia libre (qué imparte en
 * general, no ligado a un plan/semestre puntual) — la relación real con
 * semestres/materias cursadas vive en cada materia_matriculada (ver
 * crearMateriaMatriculada). Cada bloque de info se muestra en la UI solo si
 * tiene datos, así que acá no se fuerza ningún string vacío: null real.
 */
function crearProfesor({ nombre, materias, correo, telefono }) {
  return sellarTimestamp({
    id: "prof_" + crypto.randomUUID(),
    nombre,
    materias: Array.isArray(materias) ? materias : [],
    correo: correo || null,
    telefono: telefono || null,
  });
}

/**
 * Compañero — vive en datos.companeros (colección top-level, tumba propia
 * _eliminados_companeros). `lista` es un switch de 2 estados obligatorio, sin
 * neutral (a diferencia de volveria_a_llevar_profesor, que sí admite null) —
 * default "whitelist" si no se especifica. `materias_compartidas` guarda ids
 * de materia_matriculada puntuales (la instancia de un semestre concreto, no
 * la materia genérica del plan) — si esa mm se borra alguna vez, la
 * referencia queda huérfana silenciosamente (se filtra sola al renderizar,
 * ver obtenerMateriasCompartidasValidas), nunca revienta la UI.
 * `telefono` (Comunidad — Parte 3, agregado 2026-08-08): mismo patrón que en
 * crearProfesor — opcional, null si no se especifica. Puede llegar tipeado a
 * mano o importado desde los contactos del dispositivo (solo como atajo
 * puntual al llenar el formulario, nunca como fuente de verdad — ver
 * comunidad.js).
 */
function crearCompanero({ nombre_completo, carnet, lista, materias_compartidas, nota, telefono }) {
  return sellarTimestamp({
    id: "comp_" + crypto.randomUUID(),
    nombre_completo,
    carnet: carnet || null,
    lista: lista === "blacklist" ? "blacklist" : "whitelist",
    materias_compartidas: Array.isArray(materias_compartidas) ? materias_compartidas : [],
    nota: nota || "",
    telefono: telefono || null,
  });
}

/**
 * Recorre TODOS los semestres buscando materias_matriculadas ligadas a este
 * profesor (mm.profesor_ids.includes(profesorId) — 2026-08-09: una mm puede
 * tener 2+ profesores, así que la misma mm puede aparecer en el historial de
 * más de un profesor a la vez), y devuelve un arreglo plano { semestre, mm }
 * — una entrada por cada materia dada, no por semestre, así el caso de 2
 * materias correquisito con el mismo profesor en el mismo semestre aparece
 * como 2 entradas independientes con su propia calificación y
 * volveria_a_llevar. Único punto de verdad para armar la tarjeta expandida
 * de un profesor (semestres-tarjetas.js / la futura vista de Comunidad).
 */
function obtenerHistorialProfesor(profesorId, datos) {
  const resultado = [];
  (datos.semestres || []).forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      if (Array.isArray(mm.profesor_ids) && mm.profesor_ids.includes(profesorId)) {
        resultado.push({ semestre, mm });
      }
    });
  });
  // Más reciente primero, por fecha de inicio del semestre.
  resultado.sort((a, b) => new Date(b.semestre.fecha_inicio) - new Date(a.semestre.fecha_inicio));
  return resultado;
}

/**
 * Universidades ("TEC" | "UCR" | otra) de los planes asociados a los
 * semestres donde este profesor dio clases — puede devolver más de una (ej.
 * Modo Hardcore, o el profesor pasó de una carrera a otra). Único punto de
 * verdad para decidir qué botón(es) "Buscar en MisProfesX" mostrar (decisión
 * confirmada 2026-08-04: si trabaja en dos universidades, se muestran ambos).
 */
function obtenerUniversidadesDeProfesor(profesorId, datos) {
  const universidades = new Set();
  const planesPorId = new Map((datos.planes_estudio || []).map((p) => [p.id, p]));
  obtenerHistorialProfesor(profesorId, datos).forEach(({ mm }) => {
    const plan = planesPorId.get(mm.plan_estudio_id);
    // Universidad — separación nombre_completo/siglas (2026-08-22): mismo
    // criterio que calcularPromedioPorSemestreYUniversidad — se devuelve
    // la sigla (string corto, mismo contrato de siempre) para no tener
    // que tocar comunidad.js, que consume este arreglo para decidir qué
    // botón "Buscar en MisProfesX" mostrar.
    const sigla = plan && plan.universidad && (plan.universidad.siglas || plan.universidad.nombre_completo);
    if (sigla) universidades.add(sigla);
  });
  return Array.from(universidades);
}

/**
 * Filtra materias_compartidas de un compañero a solo las que todavía
 * apuntan a una materia_matriculada real (ver comentario en crearCompanero
 * sobre referencias huérfanas por borrado). Devuelve [{ mm, semestre,
 * materia }] listo para renderizar, en vez de solo los ids crudos —
 * `materia` puede ser null si la materia del plan también se borró.
 */
function obtenerMateriasCompartidasValidas(companero, datos) {
  const idsBuscados = new Set(companero.materias_compartidas || []);
  const resultado = [];
  (datos.semestres || []).forEach((semestre) => {
    (semestre.materias_matriculadas || []).forEach((mm) => {
      if (!idsBuscados.has(mm.id)) return;
      const plan = (datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
      const materia = plan ? (plan.materias || []).find((m) => m.id === mm.materia_id) : null;
      resultado.push({ mm, semestre, materia: materia || null });
    });
  });
  return resultado;
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

  // Universidad — separación en nombre completo + siglas (2026-08-22):
  // planes creados antes de este cambio traen `universidad` como string
  // plano (ej. "TEC", "Universidad Nacional"). Se migra a
  // { nombre_completo, siglas } usando el string viejo como nombre
  // completo (es el dato más descriptivo que ya había) y dejando
  // `siglas` vacío A PROPÓSITO — no hay forma confiable de abreviar un
  // nombre libre sin arriesgar un badge sin sentido. `siglas: ""` es
  // justo la señal que usa mostrarApp() (main.js) para detectar planes
  // "incompletos" y abrir el modal bloqueante que pide completarlas antes
  // de seguir usando la app — ver abrirModalCompletarUniversidades.
  (datos.planes_estudio || []).forEach((plan) => {
    if (typeof plan.universidad === "string") {
      plan.universidad = { nombre_completo: plan.universidad, siglas: "" };
    } else if (!plan.universidad || typeof plan.universidad !== "object") {
      plan.universidad = { nombre_completo: "", siglas: "" };
    }
  });

  // Ajustes — ocultar botones de navegación (2026-08-04): mismo relleno
  // defensivo que el resto de esta función — cuentas creadas antes de este
  // ajuste no tienen navegacion_oculta ni como arreglo vacío, el campo
  // directamente no existe. Sin esto, aplicarVisibilidadNavegacion()
  // (main.js) igual funciona gracias al `|| []` de respaldo que trae, pero
  // el campo quedaría undefined en el objeto guardado — y en cuanto UN
  // dispositivo lo toque (oculta o muestra una sección), ese dispositivo
  // pasa a tener el arreglo mientras el otro (que nunca abrió Ajustes)
  // sigue sin él: mismo patrón de conflicto falso en storage-merge.js que
  // ya se documentó arriba para criterios/nota_final.
  if (datos.configuracion && !Array.isArray(datos.configuracion.navegacion_oculta)) {
    datos.configuracion.navegacion_oculta = [];
  }

  // Ajustes — orden personalizable de navegación (2026-08-06): mismo
  // patrón que navegacion_oculta justo arriba, para cuentas creadas antes
  // de que existiera el orden personalizable de navegación.
  if (datos.configuracion && !Array.isArray(datos.configuracion.navegacion_orden)) {
    datos.configuracion.navegacion_orden = [];
  }

  // Fix (2026-08-08 — tumba de enlaces faltante): mismo relleno defensivo
  // que el resto de esta función, para cuentas cuyo JSON en Drive se guardó
  // antes de que _eliminados_enlaces existiera en crearDatosUsuarioNuevo.
  if (datos.configuracion && !Array.isArray(datos.configuracion._eliminados_enlaces)) {
    datos.configuracion._eliminados_enlaces = [];
  }

  // Selector de moneda (2026-08-10): mismo relleno defensivo que el resto
  // de esta función — cuentas creadas antes de este ajuste no tienen
  // moneda_preferida en absoluto (el campo directamente no existe).
  if (datos.configuracion && !datos.configuracion.moneda_preferida) {
    datos.configuracion.moneda_preferida = "CRC";
  }

  // Backup rotativo a Drive (2026-08-10): mismo patrón — cuentas viejas no
  // tienen el objeto backup_drive en absoluto. Se rellena con el default
  // (semanal, sin backup previo todavía) para que ejecutarBackupSiToca
  // (storage-sync.js) sepa desde el primer sync que "toca" backear en
  // cuanto se cumpla el intervalo, en vez de reventar leyendo un campo
  // inexistente.
  if (datos.configuracion && (!datos.configuracion.backup_drive || typeof datos.configuracion.backup_drive !== "object")) {
    datos.configuracion.backup_drive = crearBackupDriveDefault();
  }
  // Cuentas que ya tenían backup_drive de ANTES de que existiera
  // archivo_vigente_migrado (2026-08-10) — se rellena por separado para no
  // pisar frecuencia/ultimo_backup_iso ya guardados.
  if (
    datos.configuracion &&
    datos.configuracion.backup_drive &&
    typeof datos.configuracion.backup_drive.archivo_vigente_migrado !== "boolean"
  ) {
    datos.configuracion.backup_drive.archivo_vigente_migrado = false;
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
      // Horario — Núcleo: relleno defensivo para semestres creados antes de
      // esta sección — mismo motivo que el resto de esta función (evitar
      // conflictos falsos de sync entre un dispositivo que ya tocó el
      // semestre, quedando con estas llaves, y uno viejo que no las tiene).
      if (!Array.isArray(semestre.bloques_horario)) semestre.bloques_horario = [];
      if (!Array.isArray(semestre._eliminados_bloques_horario)) semestre._eliminados_bloques_horario = [];
      semestre.bloques_horario.forEach((bloque) => {
        // Cronograma de clases (2026-08-14): reemplaza excepciones_semana.
        // No hay datos viejos que migrar (ver ARQUITECTURA.md / decisión del
        // prompt), así que este relleno solo cubre bloques creados antes de
        // esta fase con el mismo patrón defensivo del resto de esta función.
        if (!Array.isArray(bloque.cronograma_dias)) bloque.cronograma_dias = [];
        if (!Array.isArray(bloque._eliminados_cronograma_dias)) bloque._eliminados_cronograma_dias = [];
      });
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
        // FIX (2026-08-06 — "la pill de Nota muestra el puntaje crudo, no
        // la nota equivalente"): se resuelve la escala activa de ESTA
        // materia una sola vez acá afuera del loop de asignaciones (no
        // cambia entre criterios/asignaciones de la misma mm) — mismo
        // criterio que usa el resto de la app (ver obtenerEscalaNotasMateria).
        const planDeLaMateria = (datos.planes_estudio || []).find((p) => p.id === mm.plan_estudio_id);
        const escalaDeLaMateria = obtenerEscalaNotasMateria(mm, planDeLaMateria, datos.configuracion);
        mm.criterios.forEach((criterio, idxCriterio) => {
          if (!Array.isArray(criterio.asignaciones)) criterio.asignaciones = [];
          if (!Array.isArray(criterio._eliminados_asignaciones)) criterio._eliminados_asignaciones = [];
          // Fase 8 — Drag and drop (2026-08-04): mismo patrón de relleno
          // defensivo. `orden` no existía antes de esta fase — se rellena
          // con la posición que ya tenía en el array (el orden visual que
          // el usuario ya venía viendo no cambia con esta migración).
          if (criterio.orden === undefined) criterio.orden = idxCriterio;
          // "✨ Extra" como criterio real (reemplaza a mm.puntos_extra):
          // cualquier criterio de antes de este cambio no es extra.
          if (criterio.es_extra === undefined) criterio.es_extra = false;
          criterio.asignaciones.forEach((asig, idxAsig) => {
            if (asig.modo_valor === undefined) asig.modo_valor = "automatico";
            if (asig.modo_calificacion === undefined) asig.modo_calificacion = "nota";
            if (asig.orden === undefined) asig.orden = idxAsig;
            // FIX (2026-08-06): asignaciones en modo "puntos" creadas ANTES
            // de que existiera `puntaje_obtenido` tenían el puntaje crudo
            // guardado directo en `nota` (ver comentario viejo de
            // calcularPuntosAsignacion, ya reemplazado). La AUSENCIA de
            // puntaje_obtenido es la marca de "es de antes del fix" — se
            // corre una sola vez: se rescata ese crudo tal cual estaba,
            // y recién ahí se recalcula `nota` como la nota real
            // equivalente en la escala de la materia. Es naturalmente
            // idempotente: una vez migrada, la asignación ya tiene
            // puntaje_obtenido (aunque sea null, si nunca se cargó nada),
            // así que esta rama no la vuelve a tocar en la próxima carga.
            if (asig.modo_calificacion === "puntos" && asig.puntaje_obtenido === undefined) {
              asig.puntaje_obtenido = asig.nota === null || asig.nota === undefined ? null : Number(asig.nota) || 0;
              recalcularNotaDesdePuntaje(asig, escalaDeLaMateria);
              sellarTimestamp(asig);
            } else if (asig.puntaje_obtenido === undefined) {
              // Asignaciones en modo "nota" tampoco tenían este campo —
              // se rellena como null (nunca se usa en ese modo, pero
              // mismo patrón defensivo que el resto de esta función para
              // no dejar el campo undefined y disparar un conflicto falso
              // de sync entre dispositivos).
              asig.puntaje_obtenido = null;
            }
          });
        });
      });
    });
  }

  // Comunidad — Parte 1: relleno defensivo para datos guardados antes de que
  // existieran estas colecciones/tumbas top-level (mismo patrón que ya usa
  // el resto de esta función, ej. plan.optativas_disponibles más abajo).
  if (!Array.isArray(datos.profesores)) datos.profesores = [];
  if (!Array.isArray(datos.companeros)) datos.companeros = [];
  if (!Array.isArray(datos._eliminados_profesores)) datos._eliminados_profesores = [];
  if (!Array.isArray(datos._eliminados_companeros)) datos._eliminados_companeros = [];
  // Horario entre Amigos — Parte 1: relleno defensivo para cuentas creadas
  // antes de este feature (mismo patrón que profesores/companeros arriba).
  if (!Array.isArray(datos.horario_enlaces_compartidos)) datos.horario_enlaces_compartidos = [];
  if (!Array.isArray(datos._eliminados_horario_enlaces)) datos._eliminados_horario_enlaces = [];
  // Horario entre Amigos — Parte 3: horario_amigos_vinculados vive DENTRO de
  // configuracion (no top-level) porque es una preferencia del usuario sobre
  // qué horarios de amigos quiere ver superpuestos al suyo — mismo criterio
  // que enlaces_rapidos, que también vive en configuracion y se funde como
  // colección aparte (ver fusionarDatos en storage-merge.js). Relleno
  // defensivo con el mismo patrón que dias_visibles/horario_hora_inicio
  // (lazy, nunca en el objeto default de crearDatosUsuarioNuevo), guardado
  // con `datos.configuracion &&` igual que el resto de esta función.
  if (datos.configuracion && !Array.isArray(datos.configuracion.horario_amigos_vinculados)) {
    datos.configuracion.horario_amigos_vinculados = [];
  }
  if (datos.configuracion && !Array.isArray(datos.configuracion._eliminados_horario_amigos_vinculados)) {
    datos.configuracion._eliminados_horario_amigos_vinculados = [];
  }
  // Comunidad — Parte 3 (2026-08-08): companero.telefono es nuevo — los
  // compañeros guardados antes de este cambio no traen la llave para nada
  // (undefined, no null), mismo relleno defensivo de siempre.
  datos.companeros.forEach((companero) => {
    if (companero.telefono === undefined) companero.telefono = null;
  });

  // Adjuntos (2026-08-08): mismo relleno defensivo — cuentas cuyo JSON en
  // Drive se guardó antes de que existiera esta colección.
  if (!Array.isArray(datos.adjuntos)) datos.adjuntos = [];
  if (!Array.isArray(datos._eliminados_adjuntos)) datos._eliminados_adjuntos = [];

  // Agenda — Núcleo: mismo relleno defensivo. Además, cuentas que ya tenían
  // "agenda" desde el placeholder viejo (titulo/completado/archivado, sin
  // materia_matriculada_id) se migran una sola vez al esquema nuevo: se
  // preserva lo que sí sobrevive (nombre viene de "titulo") y se descarta
  // cualquier vínculo a materia viejo (materia_id/semestre_id sueltos, sin
  // relación con el formato materia_matriculada_id actual) en vez de
  // arrastrar una referencia que ya no aplica a nada.
  if (!Array.isArray(datos.agenda)) datos.agenda = [];
  if (!Array.isArray(datos._eliminados_agenda)) datos._eliminados_agenda = [];
  datos.agenda.forEach((ev) => {
    if (!TIPOS_EVENTO_AGENDA.includes(ev.tipo)) ev.tipo = "evento";
    if (ev.nombre === undefined) ev.nombre = ev.titulo || "";
    if (ev.hora === undefined) ev.hora = null;
    if (ev.notas === undefined) ev.notas = "";
    if (ev.materia_matriculada_id === undefined || ev.semestre_id === undefined) {
      ev.materia_matriculada_id = null;
      ev.semestre_id = null;
    }
    // Rediseño núcleo Agenda: relleno defensivo para eventos creados antes
    // de que existieran estos 2 campos — mismo criterio que el resto de
    // esta migración, nunca dejarlos en `undefined`. `es_feriado` además se
    // fuerza a `false` fuera de tipo "evento" (ver comentario en
    // crearEventoAgenda) por si algún dato viejo/corrupto trae ambas cosas
    // juntas.
    if (ev.completada === undefined) ev.completada = false;
    if (ev.es_feriado === undefined) ev.es_feriado = false;
    if (ev.tipo !== "evento") ev.es_feriado = false;
    delete ev.titulo;
    delete ev.materia_id;
    delete ev.completado;
    delete ev.archivado;
  });

  // Finanzas (2026-08-10): mismo relleno defensivo — cuentas cuyo JSON en
  // Drive se guardó antes de que existiera esta sección.
  if (!Array.isArray(datos.finanzas_semestre)) datos.finanzas_semestre = [];
  if (!Array.isArray(datos.gastos_u)) datos.gastos_u = [];
  if (!Array.isArray(datos._eliminados_finanzas_semestre)) datos._eliminados_finanzas_semestre = [];
  if (!Array.isArray(datos._eliminados_gastos_u)) datos._eliminados_gastos_u = [];

  // Finanzas (v2.8.8, 2026-08-11): se simplificó el registro financiero de
  // semestre — costo_total/beca_activa/porcentaje_beca/pago_confirmado/
  // pago_confirmado_manual desaparecen, reemplazados por costo_matricula +
  // beca_monto (dos montos directos, sin fórmula entre ellos). Se detecta
  // un registro viejo por la AUSENCIA de costo_matricula (campo que no
  // existía antes de v2.8.8) y se migra una única vez:
  //   - costo_matricula toma pago_confirmado si ya existía (es el último
  //     valor "real" que el usuario había confirmado que pagó) o, si no,
  //     costo_total.
  //   - beca_monto se deriva de costo_total × porcentaje_beca de antes
  //     (solo si beca_activa estaba prendida), para no perder de un
  //     vistazo cuánto representaba la beca en colones.
  datos.finanzas_semestre.forEach((registro) => {
    if (registro.costo_matricula === undefined) {
      const costoTotalViejo = Number(registro.costo_total) || 0;
      registro.costo_matricula =
        registro.pago_confirmado !== undefined ? Number(registro.pago_confirmado) || 0 : costoTotalViejo;
      registro.beca_monto = registro.beca_activa
        ? redondearDecimales(costoTotalViejo * ((Number(registro.porcentaje_beca) || 0) / 100), 2)
        : 0;
      delete registro.costo_total;
      delete registro.beca_activa;
      delete registro.porcentaje_beca;
      delete registro.pago_confirmado;
      delete registro.pago_confirmado_manual;
    }
  });

  // Gastos generales U (v2.8.8, 2026-08-11): relleno defensivo de los dos
  // campos nuevos — vínculo opcional a semestre y pago recurrente, ambos
  // ausentes en cuentas guardadas antes de este cambio.
  datos.gastos_u.forEach((gasto) => {
    if (gasto.semestre_id === undefined) gasto.semestre_id = null;
    if (gasto.recurrente === undefined) gasto.recurrente = null;
    // v2.8.9: gastos recurrentes creados antes de que existiera el modo
    // "personalizado" no traen la llave `personalizado` — se rellena en
    // null (no aplica, la frecuencia ya es semanal/quincenal/mensual/anual).
    if (gasto.recurrente && gasto.recurrente.personalizado === undefined) {
      gasto.recurrente.personalizado = null;
    }
  });

  if (Array.isArray(datos.semestres)) {
    datos.semestres.forEach((semestre) => {
      (semestre.materias_matriculadas || []).forEach((mm) => {
        // Comunidad — Parte 1: mm creadas antes de este prompt no traen el
        // vínculo Profesor↔Semestre embebido — se rellena para que ninguna
        // lectura posterior (obtenerHistorialProfesor, UI de tarjeta, etc.)
        // se tope con undefined donde espera null explícito.
        //
        // 2026-08-09: profesor_id (escalar) → profesor_ids (arreglo). Si la
        // mm viene de antes de este cambio y todavía no tiene profesor_ids,
        // se arma a partir del profesor_id viejo (si tenía uno, queda como
        // arreglo de 1; si no tenía, arreglo vacío) y se borra el campo
        // viejo para que no quede data muerta ni dispare falsos conflictos
        // de sync entre dispositivos en versiones distintas.
        if (!Array.isArray(mm.profesor_ids)) {
          mm.profesor_ids = mm.profesor_id ? [mm.profesor_id] : [];
        }
        if (mm.profesor_id !== undefined) delete mm.profesor_id;
        if (mm.calificacion_profesor === undefined) mm.calificacion_profesor = null;
        if (mm.volveria_a_llevar_profesor === undefined) mm.volveria_a_llevar_profesor = null;
      });
    });
  }

  // Notificaciones — Recordatorios configurables (2026-08-20): mismo
  // relleno defensivo que el resto de esta función — cuentas creadas antes
  // de este ajuste no tienen notificaciones_recordatorios en absoluto.
  // Default: 1 día antes en los 4 tipos (mismo default que
  // crearDatosUsuarioNuevo, para que una cuenta vieja migrada se comporte
  // igual que una nueva sin que el usuario tenga que configurar nada).
  if (datos.configuracion && (!datos.configuracion.notificaciones_recordatorios || typeof datos.configuracion.notificaciones_recordatorios !== "object")) {
    datos.configuracion.notificaciones_recordatorios = {
      tarea: ["1_dia"],
      examen: ["1_dia"],
      evento: ["1_dia"],
      feriado: ["1_dia"],
    };
  }
  // Relleno más fino: cuentas que ya tenían el objeto pero les falta algún
  // tipo puntual (ej. "feriado" se agregó después de que otros 3 ya
  // existieran en el objeto guardado) — mismo criterio, no se pisa lo que
  // ya existe.
  if (datos.configuracion && datos.configuracion.notificaciones_recordatorios) {
    ["tarea", "examen", "evento", "feriado"].forEach((tipo) => {
      if (!Array.isArray(datos.configuracion.notificaciones_recordatorios[tipo])) {
        datos.configuracion.notificaciones_recordatorios[tipo] = ["1_dia"];
      }
    });
  }

  // Notificaciones — Resumen diario (2026-08-20): mismo patrón — default
  // apagado (a diferencia de los recordatorios, este SÍ arranca inactivo:
  // es un canal nuevo, no un reemplazo de algo que ya funcionaba antes).
  if (datos.configuracion && (!datos.configuracion.notificaciones_resumen_diario || typeof datos.configuracion.notificaciones_resumen_diario !== "object")) {
    datos.configuracion.notificaciones_resumen_diario = { activo: false, hora: "20:00" };
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
    // Fase 6.2: universidades que no redondean al 5 más cercano — default
    // true porque es el comportamiento que ya existía antes de este campo.
    if (params.redondeo_activo === undefined) params.redondeo_activo = true;
    // Fase 6, punto 5: umbral_pasar_raspando queda eliminado del modelo —
    // ya no es un número guardado (ver calcularObjetivoPasarRaspando). Se
    // limpia acá mismo si viene de datos viejos, para no dejar un campo
    // muerto dando vueltas y que alguien lo lea por error en el futuro.
    if ("umbral_pasar_raspando" in params) delete params.umbral_pasar_raspando;
    // Ajustes por Universidad (2026-08-08): escala_notas_global se elimina
    // del modelo — la escala pasa a ser 100% por plan. Para no cambiarle
    // el comportamiento a nadie de un día para otro, cada plan que todavía
    // no tenga su propia escala_notas hereda como punto de partida la que
    // tenía la vieja global (o 100 si ni esa existía) — de ahí en más cada
    // plan queda independiente y editable por separado en Ajustes.
    if (params.escala_notas === undefined) {
      params.escala_notas = (datos.configuracion && datos.configuracion.escala_notas_global) || 100;
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

  // Ajustes por Universidad (2026-08-08): recién ACÁ, después de que el
  // forEach de arriba ya le repartió su valor a cada plan existente, se
  // borra la global — si se borrara antes o dentro del forEach, los planes
  // que todavía no se hubieran procesado la leerían ya vacía y caerían al
  // 100 por defecto en vez de heredar el valor real que tenía el usuario.
  if (datos.configuracion && "escala_notas_global" in datos.configuracion) {
    delete datos.configuracion.escala_notas_global;
  }

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

  // Modo Rendimiento como default (v1.16, 2026-08-21): cuentas creadas
  // ANTES de este cambio tienen modo_rendimiento GUARDADO explícitamente
  // (false, el default viejo) — a diferencia del resto de esta función,
  // acá no alcanza con "el campo no existe" para detectar quién falta
  // migrar, porque el campo siempre existió con un valor real. Por eso se
  // usa una bandera aparte (mismo patrón que
  // configuracion.backup_drive.archivo_vigente_migrado más arriba): se
  // fuerza rendimiento=true UNA sola vez por cuenta, y a partir de ahí la
  // bandera queda en true para siempre, así que cualquier cambio manual
  // que la persona haga después (activar "fancy" desde Ajustes) nunca se
  // vuelve a pisar en la próxima sincronización/carga.
  if (datos.configuracion && datos.configuracion.rendimiento_default_v2_aplicado !== true) {
    datos.configuracion.modo_rendimiento = true;
    datos.configuracion.rendimiento_default_v2_aplicado = true;
  }

  return datos;
}

export {
  LIMITE_ENLACES_RAPIDOS,
  LIMITE_MB_ADJUNTO,
  MAPEO_HORAS_VIEJO_A_NUEVO,
  MONEDAS_DISPONIBLES,
  FRECUENCIAS_BACKUP_DRIVE,
  crearBackupDriveDefault,
  PALETAS_DISPONIBLES,
  PARAMETROS_UNIVERSIDAD_DEFAULT,
  NOMBRES_UNIVERSIDAD_PRESET,
  PRESETS_TIPOS_HORAS,
  arbolContieneCodigo,
  crearAdjunto,
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
  recalcularNotaDesdePuntaje,
  calcularNotaFinalMateria,
  obtenerEstadoEfectivoMateria,
  redondearDecimales,
  redondearNotaFinalAlCincoMasCercano,
  obtenerAsignacionesPendientes,
  calcularMaximoPosibleMateria,
  calcularNotaNecesariaUniforme,
  calcularObjetivoPasarRaspando,
  resolverObjetivoPasarRaspando,
  ESCALAS_DISPONIBLES,
  obtenerEscalaPorId,
  convertirA100,
  convertirDesde100,
  migrarNotasAsignacionesEscalaPlan,
  obtenerFraccionNota,
  notaMinimaParaFraccion,
  crearProfesor,
  crearCompanero,
  obtenerHistorialProfesor,
  obtenerUniversidadesDeProfesor,
  obtenerMateriasCompartidasValidas,
  obtenerIntentosMateria,
  siguienteOrden,
  reordenarPorArrastre,
  calcularNotaFinalVigenteMateria,
  calcularNotaParaPromedio,
  listarMatriculasResolubles,
  calcularPromedioPonderado,
  calcularPromedioPorSemestreYUniversidad,
  calcularPromedioPorPlan,
  calcularPromedioTotalCombinado,
  calcularEstadisticasAprobacion,
  calcularDetallePorEstado,
  crearRegistroFinancieroSemestre,
  crearGastoU,
  calcularPagosRecurrentesTranscurridos,
  MODALIDADES_HORARIO,
  crearModalidadHorario,
  crearBloqueHorario,
  crearDiaCronograma,
  obtenerClasesEfectivasSemana,
  calcularNumeroSemanaSemestre,
  crearEnlaceHorarioCompartido,
  crearAmigoVinculado,
  TIPOS_EVENTO_AGENDA,
  crearEventoAgenda,
  OFFSETS_RECORDATORIO_AGENDA,
  SEPARADOR_ID_RECORDATORIO_OFFSET,
};
