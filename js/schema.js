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
      plan_activo_id: null,         // id del Plan de Estudios seleccionado como activo
      enlaces_rapidos: [],          // ver estructura de "enlace" abajo (máx. 20)
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
            horas: { teoria: 5, practica: 0, laboratorio: 0, teoria_practica: 0 },
            bloque: 1,                      // bloque/nivel original del plan
            requisitos: ["MA0101"],         // códigos
            correquisitos: [],
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
/* Orden "arcoiris": neutros primero (blanco → gris → negro) y luego el
 * espectro cromático completo (rojo → dorado → amarillo → verde → cyan →
 * azul → índigo → morado → rosado), cerrando con "arcoiris" (combinación
 * de varios colores) como pieza destacada al final. */
const PALETAS_DISPONIBLES = [
  "blanco", "gris", "negro",
  "rojo", "dorado", "amarillo", "verde", "cyan", "azul", "indigo", "morado", "rosado",
  "arcoiris",
];
