import { manejarSoporte } from "./soporte.js";
/* =========================================================================
   worker-notificaciones-agenda — Cloudflare Worker (proyecto SEPARADO de
   la app)
   -------------------------------------------------------------------------
   Ronda 2026-08-25 — Migración a Calendario Secundario de Google, reemplaza
   Web Push por completo:
     Este Worker YA NO procesa envíos push ni guarda recordatorios. Toda la
     entrega de avisos pasa a ser un Calendario Secundario de Google
     ("AppAcademica") por usuario — la app habla DIRECTO contra la API de
     Google Calendar con el propio access_token del usuario (ver
     notificaciones-calendario.js y auth.js en el cliente), sin pasar por
     este Worker para nada de eso. Se eliminaron:
       - Los endpoints POST /programar, DELETE /programar/:id,
         DELETE /programar-evento/:id, POST /resumen-config,
         DELETE /resumen-config, POST /prueba.
       - Los handlers manejarProgramar, manejarCancelar,
         manejarCancelarEvento, manejarResumenConfig,
         manejarBorrarResumenConfig, manejarPrueba,
         manejarRecordatoriosVencidos, enviarRecordatorio,
         manejarResumenDiario y los helpers de fecha/hora local que solo
         usaba ese cron (calcularFechaManiana/calcularFechaHoy/
         calcularHoraLocalActual).
       - El cron original de recordatorios se retiró. El cron actual es NUEVO
         y atiende exclusivamente el cierre semanal de Competencias; no
         borres `[triggers]` ni `scheduled()`.
       - El import de "./web-push.js" y las funciones de envío quedaron
         desconectados. El módulo antiguo se conserva en
         `archivadas/codigo-deprecado/web-push.js`.
     Las tablas de recordatorios y bandeja que aún aparezcan en el esquema
     son históricas y este código no las usa. No las borres de D1 sin revisar
     primero el entorno y tener un respaldo.

   Funciones activas del Worker:
     - Relevo OAuth sin memoria (`POST /oauth/exchange`, `POST /oauth/refresh`).
     - Competencias compartidas y su cierre semanal horario (`/competencias`).
     - Analítica agregada (`/analitica/*`).
     - Soporte público (`/soporte/chat`, `/soporte/ticket`).
   Ronda 2026-08-25 (anterior, sin relación) — Se eliminó la Bandeja
   pendiente (captura por voz/Atajo de Siri): la tabla `bandeja_pendiente`
   de D1 sigue huérfana desde entonces (no la toca esta ronda tampoco).

   Ronda 2026-09-07 — Competencias de Tiempo de Estudio (Parte 4/4 del spec
   de Tiempo de Estudio, PARTE A): primera vez que este Worker guarda
   estado COMPARTIDO entre usuarios distintos (todo lo anterior es
   por-usuario o infraestructura). Agrega:
     - 3 tablas D1 nuevas: `competencias`, `participantes`,
       `historial_ganadores` (ver schema.sql para el detalle completo y el
       razonamiento del corte semanal anclado al creador).
     - Endpoints: POST /competencias, GET /competencias/:id, POST
       /competencias/:id/unirse, POST /competencias/:id/actualizar-horas,
       DELETE /competencias/:id, DELETE
       /competencias/:id/participantes/:participanteId, GET
       /competencias/:id/historial.
     - Un `scheduled()` NUEVO (Cloudflare vuelve a invocar el cron — ver
       wrangler.toml, reinstalado solo para esto, cron distinto al que se
       borró en la ronda 2026-08-25, para una tabla distinta): corre cada
       hora, cierra la semana de cada competencia cuando le toca su lunes
       00:00 en la hora local de su creador (no de cada participante —
       simplifica quién es "el ganador de la semana" entre gente en husos
       distintos), logueando el ganador y reseteando `horas_semana_actual`
       de TODOS los participantes de esa competencia a la vez.
     - `identificador_usuario` = el correo de Google del usuario (mismo
       valor que `estado.datos.perfil.correo` en el cliente), guardado tal
       cual — decisión explícita del dueño del proyecto ("entre amigos,
       no es un riesgo"). Ningún endpoint GET lo devuelve igual: el
       marcador solo expone `apodo` + horas, no hace falta más para
       pintarlo.

   Ronda 2026-09-17 — Gestión de competencias + Registro de finalizadas
   (Partes 4 y 5 del prompt). Agrega:
     - 2 columnas nuevas (ver migracion_competencias_gestion.sql, hay que
       aplicarla ANTES de desplegar este archivo):
         competencias.estado                      TEXT  'activa' | 'finalizada'
         participantes.horas_totales_historicas   REAL  acumulado de por vida
     - Endpoints nuevos:
         POST /competencias/:id/renombrar                       (token_creador)
         POST /competencias/:id/estado                          (token_creador)
         POST /competencias/:id/participantes/:pid/apodo        (identificador_usuario)
         GET  /competencias/:id/resumen                         (público, como el marcador)
     - DELETE /competencias/:id/participantes/:pid ahora acepta TAMBIÉN
       `token_creador` en el body, además de `identificador_usuario`: es lo
       que permite que el creador saque a otra persona ("Sacar usuario")
       sin abrir una segunda ruta que borre participantes.
     - Una competencia `finalizada` no acepta gente nueva (`/unirse` → 403),
       no guarda horas (`/actualizar-horas` responde 200 pero ignora), y el
       cron la saltea. NADA se borra: es reversible con /estado.
     - `procesarCierreCompetencia` ahora acumula lo trabajado en
       `horas_totales_historicas` antes de resetear la semana — es la única
       forma de poder mostrar el total de por vida de TODOS los
       participantes en el Registro (`historial_ganadores` solo guarda al
       ganador de cada semana).

   Ronda 2026-09-21 — Rediseño visual de Competencias (podio + fotos).
   Ver migracion_competencias_podio.sql (aplicar ANTES de desplegar):
     - participantes.foto_url  TEXT NULL  (URL https de la foto de Google).
     - Tabla nueva `historial_resultados`: el podio COMPLETO de cada semana
       cerrada (todos los participantes, con su puesto), no solo el ganador.
       `historial_ganadores` sigue escribiéndose igual (compatibilidad con
       clientes viejos y con el Registro de finalizadas).
   Endpoints nuevos / cambiados:
     GET  /competencias/:id/podios                          (público)
     POST /competencias/:id/participantes/:pid/foto         (identificador_usuario)
     POST /competencias, /unirse                            aceptan foto_url opcional
     GET  /competencias/:id y /resumen                      devuelven foto_url
   Ronda 2026-09-21 (2.ª) — color propio en el podio:
     - participantes.color TEXT NULL  (hex #rrggbb: el color de acento de la
       paleta de cada usuario). Ver migracion_competencias_color.sql.
     - POST /competencias, /unirse aceptan `color` opcional; GET marcador,
       /resumen y /podios lo devuelven (en /podios es VIVO, como la foto).
     - POST /competencias/:id/participantes/:pid/perfil  { identificador_usuario,
       foto_url?, color? } — actualiza lo que venga (null/"" borra). Es el que
       usa ahora el cliente para refrescar foto y color juntos; /foto se deja
       por compatibilidad.

   Ronda 2026-09-22 — Recuperar historial perdido (Registro de finalizadas).
     El cliente solo guarda un PUNTERO local ("a qué competencias estoy
     unido", `estado.datos.competencias_unidas`, sincronizado por Drive) — el
     contenido real siempre vivió acá. Si ese puntero se pierde (tumba vieja
     de antes del fix de `podarTumbasSuperadasPorAltas`, dispositivo nuevo,
     bug de sync), la competencia desaparece de "Registro de competencias"
     sin ningún camino para traerla de vuelta: todos los endpoints existentes
     piden un `id` de competencia puntual, que es justo lo que el cliente ya
     no tiene. Nuevo endpoint de solo lectura:
       GET /identificadores/:correo/competencias — todas las filas de
         `participantes` de ese `identificador_usuario` (activas y
         finalizadas), con nombre/estado/participante_id/apodo. No modifica
         nada — el cliente decide si repuebla su lista local con lo que
         devuelve (ver `recuperarCompetenciasPerdidas`,
         tiempo-estudio-competencias-gestion.js).
   ========================================================================= */

// Dominio real de la app (GitHub Pages) — único origen que puede llamar a
// este Worker; cualquier otro se rechaza antes de tocar nada.
// 2026-10-14: lista de orígenes válidos. Se aceptan el sitio viejo (GitHub
// Pages) y el nuevo (Cloudflare Pages) a la vez, así ninguno falla mientras
// los usuarios migran. Si un origen deja de usarse, simplemente nunca llega
// y no pasa nada. Para sumar otro (dominio propio, preview), agregarlo acá.
const ORIGENES_PERMITIDOS = new Set([
  "https://waxyflounder971.github.io",
  "https://wapper.pages.dev",
]);

function origenPermitido(origen) {
  if (ORIGENES_PERMITIDOS.has(origen)) return true;
  // Vistas previas de ramas de Cloudflare Pages: https://<rama>.wapper.pages.dev
  return /^https:\/\/[a-z0-9-]+\.wapper\.pages\.dev$/.test(origen);
}

// OAuth (2026-08-25) — flujo de código + refresh_token, ver spec Parte A/B
// de la migración de Calendario Secundario. El CLIENT_ID NO es secreto
// (Google lo documenta como público, va incluso en el HTML del cliente) —
// se duplica acá con el MISMO valor que CLIENT_ID en auth.js, mismo
// criterio que URL_WORKER_OAUTH duplicada del otro lado: más simple que
// forzar un export cruzado entre dos proyectos separados. El
// client_secret, en cambio, NUNCA va acá — vive únicamente como secret de
// Cloudflare (env.CLIENT_SECRET_GOOGLE, ver `wrangler secret put
// CLIENT_SECRET_GOOGLE`).
const CLIENT_ID_GOOGLE = "906522073616-7ofa7i3emqocojhlkh9ot9i0itljmd50.apps.googleusercontent.com";
const URL_TOKEN_GOOGLE = "https://oauth2.googleapis.com/token";

function encabezadosCors(origen) {
  const permitido = origenPermitido(origen);
  return {
    "Access-Control-Allow-Origin": permitido ? origen : "null",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    // Como el valor cambia según el origen, las cachés deben distinguirlo.
    "Vary": "Origin",
  };
}

function respuestaJson(cuerpo, status, origen) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: { "Content-Type": "application/json", ...encabezadosCors(origen) },
  });
}

async function manejarRegistrarAperturaDemo(env, origen) {
  await env.DB_NOTIFICACIONES.prepare(
    `INSERT INTO analitica_demo (id, aperturas)
     VALUES (1, 1)
     ON CONFLICT(id) DO UPDATE SET aperturas = aperturas + 1`
  ).run();
  return respuestaJson({ ok: true }, 200, origen);
}

async function manejarConsultarAperturasDemo(env) {
  const fila = await env.DB_NOTIFICACIONES.prepare(
    `SELECT COALESCE((SELECT aperturas FROM analitica_demo WHERE id = 1), 0)
       + COALESCE((SELECT conteo_general FROM analitica_uso WHERE seccion = 'demo' AND funcion = 'Apertura'), 0)
       AS aperturas`
  ).first();
  const aperturas = Number(fila?.aperturas || 0);
  return new Response(`Aperturas de Demo Académico\n${aperturas}\n`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

const SECCIONES_ANALITICA = new Set([
  "demo", "resumen", "agenda", "horario", "tiempo-estudio",
  "semestres", "comunidad", "finanzas", "plan-estudios", "asistente", "notas",
  "configuracion",
]);
const FUNCIONES_ANALITICA = new Set([
  "Apertura", "Abrir sección", "Agregar", "Guardar", "Editar", "Eliminar",
  "Completar", "Buscar", "Importar", "Exportar o descargar", "Compartir",
  "Iniciar", "Pausar o detener", "Abrir elemento", "Cerrar o cancelar",
  "Proyectar", "Enviar", "Cambiar vista", "Cambiar ajuste",
  "Enviar formulario", "Otra interacción",
  // 2026-10-14: categorías nuevas para reducir "Otra interacción" (deben
  // coincidir con CATEGORIAS_ACCION/SIMBOLOS_ACCION en js/core/analitica.js).
  "Expandir o contraer", "Abrir ajustes", "Navegar", "Seleccionar opción",
  // Notas rápidas: nombres de eventos solamente; nunca se aceptan títulos
  // ni contenido de las notas en la ruta de analítica.
  "Crear nota", "Recibir compartido", "Restaurar nota", "Enviar a Wapper", "Compartir nota",
]);

// Flujo + pasos permitidos. No se aceptan texto libre, nombres, IDs de datos,
// contenido de formularios ni etiquetas provenientes de la persona.
const PASOS_ANALITICA = Object.freeze({
  "agenda.tarea": new Set(["formulario_abierto", "validacion_fallida", "adjunto_agregado", "guardado", "cancelado"]),
  "plan.importacion": new Set(["flujo_abierto", "fuente_elegida", "instrucciones_vistas", "prompt_copiado", "enviado_a_ia", "archivo_seleccionado", "validacion_fallida", "materias_previsualizadas", "confirmado", "guardado", "cancelado"]),
  "wapper.mensaje": new Set(["compositor_abierto", "mensaje_enviado", "en_cola", "respuesta_recibida", "cancelado"]),
  "notas.editor": new Set(["editor_abierto", "guardado", "duplicado", "compartido", "cancelado"]),
});
const SECCIONES_AVISO = new Set(["resumen", "agenda", "horario", "tiempo-estudio", "semestres", "comunidad", "finanzas", "plan-estudios", "notas", "asistente", "configuracion"]);
const ACCIONES_AVISO = new Set(["entendido", "aceptar", "continuar", "cerrar"]);

async function hashUsuarioAnalitica(correo, env) {
  const secreto = String(env.ANALITICA_HASH_SECRET || "");
  if (secreto.length < 32) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(String(correo).trim().toLowerCase())));
  return Array.from(firma, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function verificarUsuarioAnalitica(request, env, origen) {
  const identidad = await verificarUsuarioGoogle(request);
  if (!identidad.ok) return { error: respuestaJson({ error: identidad.error }, identidad.status, origen) };
  const usuarioHash = await hashUsuarioAnalitica(identidad.correo, env);
  if (!usuarioHash) return { error: respuestaJson({ error: "Falta configurar el secreto ANALITICA_HASH_SECRET en el Worker." }, 503, origen) };
  return { usuarioHash, correo: identidad.correo };
}

async function manejarConsentimientoAnalitica(request, env, origen) {
  const identidad = await verificarUsuarioAnalitica(request, env, origen);
  if (identidad.error) return identidad.error;
  let cuerpo;
  try { cuerpo = await request.json(); } catch (_) { return respuestaJson({ error: "Se esperaba JSON válido." }, 400, origen); }
  if (typeof cuerpo?.aceptado !== "boolean") return respuestaJson({ error: "El consentimiento debe ser verdadero o falso." }, 400, origen);
  const ahora = Date.now();
  if (!cuerpo.aceptado) {
    await env.DB_NOTIFICACIONES.batch([
      env.DB_NOTIFICACIONES.prepare("INSERT INTO analitica_consentimientos (usuario_hash, aceptado, actualizado_en) VALUES (?, 0, ?) ON CONFLICT(usuario_hash) DO UPDATE SET aceptado=0, actualizado_en=excluded.actualizado_en").bind(identidad.usuarioHash, ahora),
      env.DB_NOTIFICACIONES.prepare("DELETE FROM analitica_flujo_eventos WHERE usuario_hash = ?").bind(identidad.usuarioHash),
      env.DB_NOTIFICACIONES.prepare("DELETE FROM analitica_flujos WHERE usuario_hash = ?").bind(identidad.usuarioHash),
    ]);
  } else {
    await env.DB_NOTIFICACIONES.prepare("INSERT INTO analitica_consentimientos (usuario_hash, aceptado, actualizado_en) VALUES (?, 1, ?) ON CONFLICT(usuario_hash) DO UPDATE SET aceptado=1, actualizado_en=excluded.actualizado_en").bind(identidad.usuarioHash, ahora).run();
  }
  return respuestaJson({ ok: true, aceptado: cuerpo.aceptado }, 200, origen);
}

async function manejarRegistrarFlujoAnalitica(request, env, origen) {
  const identidad = await verificarUsuarioAnalitica(request, env, origen);
  if (identidad.error) return identidad.error;
  let cuerpo;
  try {
    if (Number(request.headers.get("Content-Length") || 0) > 4096) return respuestaJson({ error: "Evento demasiado grande." }, 413, origen);
    cuerpo = await request.json();
  } catch (_) { return respuestaJson({ error: "Se esperaba JSON válido." }, 400, origen); }
  const proceso = typeof cuerpo?.proceso === "string" ? cuerpo.proceso : "";
  const tipo = typeof cuerpo?.tipo === "string" ? cuerpo.tipo : "";
  const paso = typeof cuerpo?.paso === "string" ? cuerpo.paso : "";
  const flowId = typeof cuerpo?.flujo_id === "string" ? cuerpo.flujo_id : "";
  const eventId = typeof cuerpo?.evento_id === "string" ? cuerpo.evento_id : "";
  const sessionId = typeof cuerpo?.sesion_id === "string" ? cuerpo.sesion_id : "";
  const pasos = PASOS_ANALITICA[proceso];
  if (!pasos || !pasos.has(paso) || !["iniciado", "paso", "completado", "cancelado", "error"].includes(tipo) || !/^[a-zA-Z0-9_-]{16,80}$/.test(flowId) || !/^[a-zA-Z0-9_-]{16,80}$/.test(eventId) || !/^[a-zA-Z0-9_-]{16,80}$/.test(sessionId)) {
    return respuestaJson({ error: "Evento de proceso no permitido." }, 400, origen);
  }
  const consentimiento = await env.DB_NOTIFICACIONES.prepare("SELECT aceptado FROM analitica_consentimientos WHERE usuario_hash = ?").bind(identidad.usuarioHash).first();
  if (Number(consentimiento?.aceptado) !== 1) return respuestaJson({ ok: true, omitido: true }, 200, origen);
  const ahora = Date.now();
  const version = typeof cuerpo.version === "string" && /^[0-9.]{1,20}$/.test(cuerpo.version) ? cuerpo.version : null;
  if (tipo === "iniciado") {
    await env.DB_NOTIFICACIONES.prepare(
      `INSERT OR IGNORE INTO analitica_flujos (id, usuario_hash, sesion_id, proceso, seccion, estado, iniciado_en, ultimo_evento_en, version_app)
       VALUES (?, ?, ?, ?, ?, 'iniciado', ?, ?, ?)`
    ).bind(flowId, identidad.usuarioHash, sessionId, proceso, proceso.startsWith("plan.") ? "plan-estudios" : proceso.startsWith("notas.") ? "notas" : proceso.startsWith("wapper.") ? "asistente" : "agenda", ahora, ahora, version).run();
  }
  const flujo = await env.DB_NOTIFICACIONES.prepare("SELECT id, usuario_hash, estado, iniciado_en FROM analitica_flujos WHERE id = ?").bind(flowId).first();
  if (!flujo || flujo.usuario_hash !== identidad.usuarioHash) return respuestaJson({ error: "Proceso no encontrado." }, 404, origen);
  const insertado = await env.DB_NOTIFICACIONES.prepare(
    "INSERT OR IGNORE INTO analitica_flujo_eventos (id, flujo_id, usuario_hash, proceso, tipo, paso, ocurrido_en, duracion_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(eventId, flowId, identidad.usuarioHash, proceso, tipo, paso, ahora, tipo === "iniciado" ? 0 : Math.max(0, ahora - Number(flujo.iniciado_en))).run();
  if (!insertado.meta?.changes) return respuestaJson({ ok: true, duplicado: true }, 200, origen);
  const cierre = { completado: "completado", cancelado: "cancelado", error: "error" }[tipo];
  if (cierre) {
    await env.DB_NOTIFICACIONES.prepare(
      "UPDATE analitica_flujos SET estado = ?, ultimo_evento_en = ?, finalizado_en = ?, duracion_ms = ? WHERE id = ? AND usuario_hash = ? AND estado = 'iniciado'"
    ).bind(cierre, ahora, ahora, Math.max(0, ahora - Number(flujo.iniciado_en)), flowId, identidad.usuarioHash).run();
  } else if (tipo !== "iniciado") {
    await env.DB_NOTIFICACIONES.prepare("UPDATE analitica_flujos SET ultimo_evento_en = ? WHERE id = ? AND usuario_hash = ? AND estado = 'iniciado'").bind(ahora, flowId, identidad.usuarioHash).run();
  }
  return respuestaJson({ ok: true }, 200, origen);
}

async function obtenerResumenFlujos(env, dias = 30) {
  const limite = Date.now() - dias * 86400000;
  const [porProceso, porPaso] = await Promise.all([
    env.DB_NOTIFICACIONES.prepare(
      `SELECT proceso, COUNT(*) AS iniciados,
        SUM(CASE WHEN estado = 'completado' THEN 1 ELSE 0 END) AS completados,
        SUM(CASE WHEN estado = 'cancelado' THEN 1 ELSE 0 END) AS cancelados,
        SUM(CASE WHEN estado = 'abandonado' THEN 1 ELSE 0 END) AS abandonados,
        SUM(CASE WHEN estado = 'error' THEN 1 ELSE 0 END) AS errores,
        SUM(CASE WHEN estado = 'iniciado' THEN 1 ELSE 0 END) AS en_curso,
        COUNT(DISTINCT usuario_hash) AS usuarios,
        AVG(CASE WHEN estado = 'completado' THEN duracion_ms END) AS duracion_media_ms
       FROM analitica_flujos WHERE iniciado_en >= ? GROUP BY proceso ORDER BY iniciados DESC`
    ).bind(limite).all(),
    env.DB_NOTIFICACIONES.prepare(
      `SELECT proceso, paso, tipo, COUNT(*) AS cantidad, COUNT(DISTINCT flujo_id) AS flujos
       FROM analitica_flujo_eventos WHERE ocurrido_en >= ? GROUP BY proceso, paso, tipo ORDER BY proceso, cantidad DESC`
    ).bind(limite).all(),
  ]);
  return { dias, procesos: porProceso.results || [], pasos: porPaso.results || [], generado_en: Date.now() };
}

async function manejarPanelFlujos(request, env, origen) {
  const acceso = await verificarAdminAnalitica(request, env);
  if (!acceso.ok) return respuestaJson({ error: acceso.error }, acceso.status, origen);
  const dias = [7, 30, 90].includes(Number(new URL(request.url).searchParams.get("dias"))) ? Number(new URL(request.url).searchParams.get("dias")) : 30;
  return respuestaJson({ usuario: acceso.correo, ...(await obtenerResumenFlujos(env, dias)) }, 200, origen);
}

async function manejarAnalisisIA(request, env, origen) {
  const acceso = await verificarAdminAnalitica(request, env);
  if (!acceso.ok) return respuestaJson({ error: acceso.error }, acceso.status, origen);
  const anthropicKey = String(env.ANTHROPIC_API_KEY || "");
  const openaiKey = String(env.OPENAI_API_KEY || "");
  let proveedor = anthropicKey ? "claude" : openaiKey ? "openai" : "";
  if (!proveedor) return respuestaJson({ error: "Configura ANTHROPIC_API_KEY (preferido) u OPENAI_API_KEY como secreto del Worker." }, 503, origen);
  const diaUtc = new Date().toISOString().slice(0, 10);
  const usuarioHash = await hashUsuarioAnalitica(acceso.correo, env);
  const usoPrevio = await env.DB_NOTIFICACIONES.prepare("SELECT cantidad FROM analitica_ia_usos WHERE dia = ? AND usuario_hash = ?").bind(diaUtc, usuarioHash).first();
  if (Number(usoPrevio?.cantidad || 0) >= 10) return respuestaJson({ error: "Límite de 10 análisis por día alcanzado." }, 429, origen);
  const incrementoUso = await env.DB_NOTIFICACIONES.prepare("INSERT INTO analitica_ia_usos (dia, usuario_hash, cantidad) VALUES (?, ?, 1) ON CONFLICT(dia, usuario_hash) DO UPDATE SET cantidad=cantidad+1 WHERE cantidad < 10").bind(diaUtc, usuarioHash).run();
  if (!incrementoUso.meta?.changes) return respuestaJson({ error: "Límite de 10 análisis por día alcanzado." }, 429, origen);
  let dias = 30;
  try { const c = await request.clone().json(); if ([7, 30, 90].includes(Number(c?.dias))) dias = Number(c.dias); } catch (_) {}
  const [resumen7, resumen30, resumen90] = await Promise.all([7, 30, 90].map((ventana) => obtenerResumenFlujos(env, ventana)));
  // Solo métricas agregadas; no se incluyen hashes de usuarios ni filas individuales.
  const datos = JSON.stringify({ enfoque_dias: dias, periodos: { "7": resumen7, "30": resumen30, "90": resumen90 } });
  const instrucciones = "Analiza estos datos agregados de recorridos de una app académica. Prioriza la ventana indicada en enfoque_dias y usa las ventanas mayores como contexto acumulado; no las presentes como series temporales ni infieras tendencias causales. Identifica tasas de finalización, abandono, pasos con fricción y 3 mejoras priorizadas. Distingue cifras observadas de hipótesis. No solicites ni infieras datos personales. Responde en español con secciones Resumen, Hallazgos con cifras, Hipótesis y Experimentos recomendados.";
  let respuesta;
  const llamarClaude = () => fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "Content-Type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model: env.ANTHROPIC_MODEL || "claude-sonnet-5", max_tokens: 1600, system: instrucciones, messages: [{ role: "user", content: datos }] }) });
  const llamarOpenAI = () => fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${openaiKey}` }, body: JSON.stringify({ model: env.OPENAI_MODEL || "gpt-4.1-mini", max_tokens: 1600, messages: [{ role: "system", content: instrucciones }, { role: "user", content: datos }] }) });
  try {
    if (proveedor === "claude") {
      try { respuesta = await llamarClaude(); } catch (_) { respuesta = null; }
      if ((!respuesta || !respuesta.ok) && openaiKey) { proveedor = "openai"; respuesta = await llamarOpenAI(); }
      else if (!respuesta) return respuestaJson({ error: "No se pudo conectar con Claude." }, 502, origen);
    } else respuesta = await llamarOpenAI();
  } catch (_) { return respuestaJson({ error: `No se pudo conectar con ${proveedor}.` }, 502, origen); }
  const payload = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) return respuestaJson({ error: `El proveedor de IA respondió con error ${respuesta.status}.` }, 502, origen);
  const analisis = proveedor === "claude" ? (payload.content || []).filter((x) => x.type === "text").map((x) => x.text).join("\n") : payload.choices?.[0]?.message?.content || "";
  if (!analisis) return respuestaJson({ error: "La IA devolvió un análisis vacío." }, 502, origen);
  return respuestaJson({ ok: true, proveedor, modelo: proveedor === "claude" ? env.ANTHROPIC_MODEL || "claude-sonnet-5" : env.OPENAI_MODEL || "gpt-4.1-mini", dias, analisis }, 200, origen);
}

function validarAviso(c) {
  const titulo = typeof c?.titulo === "string" ? c.titulo.trim() : "";
  const cuerpo = typeof c?.cuerpo === "string" ? c.cuerpo.trim() : "";
  const inicia = Number(c?.inicia_en), termina = Number(c?.termina_en), max = Number(c?.max_vistas);
  const accion = String(c?.accion || "entendido"), destino = c?.destino ? String(c.destino) : null;
  if (!titulo || titulo.length > 100 || !cuerpo || cuerpo.length > 3000) return { error: "El título debe tener hasta 100 caracteres y el mensaje hasta 3000." };
  if (!Number.isSafeInteger(inicia) || !Number.isSafeInteger(termina) || termina <= inicia) return { error: "Revisa las fechas de inicio y fin." };
  if (!Number.isInteger(max) || max < 1 || max > 20 || !ACCIONES_AVISO.has(accion)) return { error: "Frecuencia o acción no válida." };
  if (accion === "continuar" && !SECCIONES_AVISO.has(destino)) return { error: "El destino de Continuar no es válido." };
  return { titulo, cuerpo, inicia, termina, max, accion, destino: accion === "continuar" ? destino : null };
}

async function manejarAdminAvisos(request, env, origen, id = null) {
  const acceso = await verificarAdminAnalitica(request, env);
  if (!acceso.ok) return respuestaJson({ error: acceso.error }, acceso.status, origen);
  if (request.method === "GET") {
    const { results } = await env.DB_NOTIFICACIONES.prepare("SELECT id, titulo, cuerpo, inicia_en, termina_en, max_vistas, accion, destino, activo, creado_en, actualizado_en FROM avisos_globales ORDER BY actualizado_en DESC LIMIT 200").all();
    return respuestaJson({ avisos: results || [] }, 200, origen);
  }
  if (request.method === "DELETE") {
    if (!id || !/^[a-zA-Z0-9_-]{16,80}$/.test(id)) return respuestaJson({ error: "Aviso inválido." }, 400, origen);
    await env.DB_NOTIFICACIONES.prepare("UPDATE avisos_globales SET activo = 0, actualizado_en = ? WHERE id = ?").bind(Date.now(), id).run();
    return respuestaJson({ ok: true }, 200, origen);
  }
  if (request.method !== "POST") return respuestaJson({ error: "Método no permitido." }, 405, origen);
  let cuerpo; try { cuerpo = await request.json(); } catch (_) { return respuestaJson({ error: "Se esperaba JSON válido." }, 400, origen); }
  const v = validarAviso(cuerpo);
  if (v.error) return respuestaJson({ error: v.error }, 400, origen);
  const avisoId = id || (typeof cuerpo.id === "string" && /^[a-zA-Z0-9_-]{16,80}$/.test(cuerpo.id) ? cuerpo.id : crypto.randomUUID());
  const ahora = Date.now();
  const activo = cuerpo.activo === false ? 0 : 1;
  await env.DB_NOTIFICACIONES.prepare(
    `INSERT INTO avisos_globales (id, titulo, cuerpo, inicia_en, termina_en, max_vistas, accion, destino, activo, creado_en, actualizado_en, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET titulo=excluded.titulo, cuerpo=excluded.cuerpo, inicia_en=excluded.inicia_en, termina_en=excluded.termina_en, max_vistas=excluded.max_vistas, accion=excluded.accion, destino=excluded.destino, activo=excluded.activo, actualizado_en=excluded.actualizado_en`
  ).bind(avisoId, v.titulo, v.cuerpo, v.inicia, v.termina, v.max, v.accion, v.destino, activo, ahora, ahora, acceso.correo).run();
  return respuestaJson({ ok: true, id: avisoId }, 200, origen);
}

async function manejarAvisosActivos(request, env, origen) {
  const identidad = await verificarUsuarioAnalitica(request, env, origen);
  if (identidad.error) return identidad.error;
  const ahora = Date.now();
  const { results } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT a.id, a.titulo, a.cuerpo, a.accion, a.destino, a.max_vistas,
        COALESCE(s.vistas, 0) AS vistas
     FROM avisos_globales a LEFT JOIN aviso_estado_usuario s
       ON s.aviso_id = a.id AND s.usuario_hash = ?
     WHERE a.activo = 1 AND a.inicia_en <= ? AND a.termina_en > ?
       AND COALESCE(s.vistas, 0) < a.max_vistas AND COALESCE(s.confirmado_en, 0) = 0
     ORDER BY a.inicia_en DESC LIMIT 3`
  ).bind(identidad.usuarioHash, ahora, ahora).all();
  return respuestaJson({ avisos: results || [] }, 200, origen);
}

async function manejarEstadoAviso(request, env, origen) {
  const identidad = await verificarUsuarioAnalitica(request, env, origen);
  if (identidad.error) return identidad.error;
  let c; try { c = await request.json(); } catch (_) { return respuestaJson({ error: "Se esperaba JSON válido." }, 400, origen); }
  const id = typeof c?.aviso_id === "string" ? c.aviso_id : "";
  const accion = String(c?.accion || "");
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(id) || !["vista", "entendido", "aceptar", "continuar", "cerrar"].includes(accion)) return respuestaJson({ error: "Estado de aviso no válido." }, 400, origen);
  const aviso = await env.DB_NOTIFICACIONES.prepare("SELECT id, accion, inicia_en, termina_en, max_vistas FROM avisos_globales WHERE id = ? AND activo = 1").bind(id).first();
  if (!aviso) return respuestaJson({ error: "Aviso no disponible." }, 404, origen);
  const ahora = Date.now();
  if (ahora < Number(aviso.inicia_en) || ahora >= Number(aviso.termina_en)) return respuestaJson({ error: "Aviso fuera de vigencia." }, 409, origen);
  if (accion === "vista") {
    const actual = await env.DB_NOTIFICACIONES.prepare("SELECT vistas, confirmado_en FROM aviso_estado_usuario WHERE aviso_id = ? AND usuario_hash = ?").bind(id, identidad.usuarioHash).first();
    if (actual?.confirmado_en || Number(actual?.vistas || 0) >= Number(aviso.max_vistas)) return respuestaJson({ error: "Límite de vistas alcanzado." }, 409, origen);
    await env.DB_NOTIFICACIONES.prepare(
      `INSERT INTO aviso_estado_usuario (aviso_id, usuario_hash, vistas, ultima_vista_en)
       VALUES (?, ?, 1, ?) ON CONFLICT(aviso_id, usuario_hash)
       DO UPDATE SET vistas=vistas+1, ultima_vista_en=excluded.ultima_vista_en`
    ).bind(id, identidad.usuarioHash, ahora).run();
  } else {
    if (accion !== aviso.accion) return respuestaJson({ error: "La acción no corresponde a este aviso." }, 400, origen);
    await env.DB_NOTIFICACIONES.prepare(
      `INSERT INTO aviso_estado_usuario (aviso_id, usuario_hash, vistas, ultima_vista_en, confirmado_en)
       VALUES (?, ?, 0, NULL, ?) ON CONFLICT(aviso_id, usuario_hash)
       DO UPDATE SET confirmado_en=excluded.confirmado_en`
    ).bind(id, identidad.usuarioHash, ahora).run();
  }
  return respuestaJson({ ok: true }, 200, origen);
}

function obtenerCorreosStakeholders(env) {
  const lista = String(env.ANALITICA_CORREOS_STAKEHOLDERS || "")
    .split(",")
    .map((correo) => correo.trim().toLowerCase())
    .filter((correo) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(correo));
  return [...new Set(lista)].slice(0, 11);
}

function escaparCampoCsv(valor) {
  return `"${String(valor ?? "").replace(/"/g, '""')}"`;
}

// Nombres que se muestran en las cabeceras del CSV (nunca los correos). Vienen
// del secreto ANALITICA_NOMBRES_STAKEHOLDERS, separados por coma y EN EL MISMO
// ORDEN que ANALITICA_CORREOS_STAKEHOLDERS. Si falta un nombre, esa columna
// conserva "CorreoN".
function nombresColumnasStakeholders(env) {
  const nombres = String(env.ANALITICA_NOMBRES_STAKEHOLDERS || "")
    .split(",")
    .map((nombre) => nombre.trim());
  return Array.from({ length: 11 }, (_, indice) => nombres[indice] || `Correo${indice + 1}`);
}

function respuestaCsv(texto) {
  return new Response(texto, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Cache-Control": "no-store, max-age=0",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// Correos autorizados a ver el panel (secreto ANALITICA_ADMIN_CORREOS, separados
// por coma). Es una lista aparte de la del equipo a propósito: salir en las
// estadísticas no da permiso para verlas.
function obtenerCorreosAdmin(env) {
  return String(env.ANALITICA_ADMIN_CORREOS || "")
    .split(",")
    .map((c) => c.trim().toLowerCase())
    .filter((c) => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(c))
    .slice(0, 1); // El dashboard de administración es estrictamente para una cuenta personal.
}

// Verifica el access_token de Google contra Google mismo (tokeninfo): que sea
// vigente, que lo haya emitido ESTE cliente OAuth y que el correo esté
// verificado y en la lista de administradores.
async function verificarUsuarioGoogle(request) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Inicia sesión para continuar." };
  let respuesta;
  try { respuesta = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token)); }
  catch (_) { return { ok: false, status: 502, error: "No se pudo verificar la sesión con Google." }; }
  if (!respuesta.ok) return { ok: false, status: 401, error: "Sesión inválida o vencida." };
  const info = await respuesta.json().catch(() => ({}));
  const correo = String(info.email || "").trim().toLowerCase();
  if (info.aud !== CLIENT_ID_GOOGLE || String(info.email_verified) !== "true" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return { ok: false, status: 401, error: "Sesión no válida." };
  }
  return { ok: true, correo };
}

async function verificarAdminAnalitica(request, env) {
  const auth = request.headers.get("Authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { ok: false, status: 401, error: "Inicia sesión para ver la analítica." };

  let respuesta;
  try {
    respuesta = await fetch("https://oauth2.googleapis.com/tokeninfo?access_token=" + encodeURIComponent(token));
  } catch (e) {
    return { ok: false, status: 502, error: "No se pudo verificar la sesión con Google." };
  }
  if (!respuesta.ok) return { ok: false, status: 401, error: "Sesión inválida o vencida." };

  const info = await respuesta.json().catch(() => ({}));
  const correo = String(info.email || "").toLowerCase();
  if (info.aud !== CLIENT_ID_GOOGLE || String(info.email_verified) !== "true" || !correo) {
    return { ok: false, status: 401, error: "Sesión no válida para este panel." };
  }
  const admins = obtenerCorreosAdmin(env);
  if (admins.length === 0) {
    return { ok: false, status: 403, error: "Falta configurar el secreto ANALITICA_ADMIN_CORREOS en el Worker." };
  }
  if (!admins.includes(correo)) {
    return { ok: false, status: 403, error: "Esta cuenta no tiene acceso al panel." };
  }
  return { ok: true, correo };
}

/**
 * GET /analitica/panel — todos los conteos en un solo viaje, solo para
 * administradores. Devuelve { usuario, columnas, filas:[{seccion, funcion,
 * valores}] } donde columnas[0] es el conteo general y el resto los nombres del
 * equipo, en el mismo orden que ANALITICA_CORREOS_STAKEHOLDERS.
 */
async function manejarPanelAnalitica(request, env, origen) {
  const acceso = await verificarAdminAnalitica(request, env);
  if (!acceso.ok) return respuestaJson({ error: acceso.error }, acceso.status, origen);

  const { results } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT seccion, funcion, conteo_general, conteo_correo_1, conteo_correo_2, conteo_correo_3,
            conteo_correo_4, conteo_correo_5, conteo_correo_6, conteo_correo_7,
            conteo_correo_8, conteo_correo_9, conteo_correo_10, conteo_correo_11
     FROM analitica_uso ORDER BY seccion, funcion COLLATE NOCASE`
  ).all();

  const filas = (results || []).map((f) => ({
    seccion: f.seccion,
    funcion: f.funcion,
    valores: [
      f.conteo_general, f.conteo_correo_1, f.conteo_correo_2, f.conteo_correo_3, f.conteo_correo_4,
      f.conteo_correo_5, f.conteo_correo_6, f.conteo_correo_7, f.conteo_correo_8, f.conteo_correo_9,
      f.conteo_correo_10, f.conteo_correo_11,
    ].map((n) => Number(n) || 0),
  }));

  // Aperturas históricas de la demo (tabla anterior a la analítica por sección).
  const historico = await env.DB_NOTIFICACIONES.prepare("SELECT aperturas FROM analitica_demo WHERE id = 1").first();
  const extra = Number(historico?.aperturas || 0);
  if (extra > 0) {
    const fila = filas.find((f) => f.seccion === "demo" && f.funcion === "Apertura");
    if (fila) fila.valores[0] += extra;
    else filas.push({ seccion: "demo", funcion: "Apertura", valores: [extra, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  }

  return respuestaJson(
    { usuario: acceso.correo, columnas: ["General", ...nombresColumnasStakeholders(env)], filas },
    200,
    origen
  );
}

async function manejarRegistrarEventoAnalitica(request, env, origen) {
  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch (_) {
    return respuestaJson({ error: "Se esperaba JSON." }, 400, origen);
  }

  const seccion = typeof cuerpo?.seccion === "string" ? cuerpo.seccion : "";
  const funcion = typeof cuerpo?.funcion === "string" ? cuerpo.funcion : "";
  if (!SECCIONES_ANALITICA.has(seccion) || !FUNCIONES_ANALITICA.has(funcion)) {
    return respuestaJson({ error: "Sección o función no permitida." }, 400, origen);
  }

  // El correo solo se compara en memoria. Nunca se escribe en D1 ni se
  // devuelve en la respuesta: cada evento incrementa exactamente una columna.
  const correo = typeof cuerpo?.correo === "string" ? cuerpo.correo.trim().toLowerCase() : "";
  const indiceStakeholder = obtenerCorreosStakeholders(env).indexOf(correo);
  const columna = indiceStakeholder >= 0 ? `conteo_correo_${indiceStakeholder + 1}` : "conteo_general";
  await env.DB_NOTIFICACIONES.prepare(
    `INSERT INTO analitica_uso (seccion, funcion, ${columna})
     VALUES (?, ?, 1)
     ON CONFLICT(seccion, funcion) DO UPDATE SET ${columna} = ${columna} + 1`
  ).bind(seccion, funcion).run();
  return respuestaJson({ ok: true }, 200, origen);
}

async function manejarConsultarAnaliticaSeccion(seccion, env) {
  if (!SECCIONES_ANALITICA.has(seccion)) return respuestaCsv("Error\nSección no disponible\n");
  const filas = await env.DB_NOTIFICACIONES.prepare(
    `SELECT funcion, conteo_general, conteo_correo_1, conteo_correo_2, conteo_correo_3,
            conteo_correo_4, conteo_correo_5, conteo_correo_6, conteo_correo_7,
            conteo_correo_8, conteo_correo_9, conteo_correo_10, conteo_correo_11
     FROM analitica_uso WHERE seccion = ? ORDER BY funcion COLLATE NOCASE`
  ).bind(seccion).all();
  const filasSeccion = filas.results || [];
  if (seccion === "demo") {
    const historico = await env.DB_NOTIFICACIONES.prepare(
      "SELECT aperturas FROM analitica_demo WHERE id = 1"
    ).first();
    const aperturasHistoricas = Number(historico?.aperturas || 0);
    const filaApertura = filasSeccion.find((fila) => fila.funcion === "Apertura");
    if (filaApertura) filaApertura.conteo_general = Number(filaApertura.conteo_general || 0) + aperturasHistoricas;
    else if (aperturasHistoricas > 0) filasSeccion.push({
      funcion: "Apertura",
      conteo_general: aperturasHistoricas,
      conteo_correo_1: 0,
      conteo_correo_2: 0,
      conteo_correo_3: 0,
      conteo_correo_4: 0,
      conteo_correo_5: 0,
      conteo_correo_6: 0,
      conteo_correo_7: 0,
      conteo_correo_8: 0,
      conteo_correo_9: 0,
      conteo_correo_10: 0,
      conteo_correo_11: 0,
    });
  }
  const encabezados = ["Funcion", "conteoGeneral", ...nombresColumnasStakeholders(env)];
  const lineas = [encabezados.map(escaparCampoCsv).join(",")];
  for (const fila of filasSeccion) {
    lineas.push([
      fila.funcion,
      fila.conteo_general,
      fila.conteo_correo_1,
      fila.conteo_correo_2,
      fila.conteo_correo_3,
      fila.conteo_correo_4,
      fila.conteo_correo_5,
      fila.conteo_correo_6,
      fila.conteo_correo_7,
      fila.conteo_correo_8,
      fila.conteo_correo_9,
      fila.conteo_correo_10,
      fila.conteo_correo_11,
    ].map(escaparCampoCsv).join(","));
  }
  return respuestaCsv(`${lineas.join("\n")}\n`);
}


/**
 * POST /oauth/exchange — Parte A.2 del spec de migración a refresh_token.
 * Recibe { code, redirect_uri } de auth.js (justo después del popup de
 * Google) y hace el canje real contra Google usando el client_secret, que
 * SOLO vive acá (env.CLIENT_SECRET_GOOGLE). Devuelve la respuesta de Google
 * tal cual al cliente (access_token, refresh_token si Google lo emitió,
 * expires_in, scope, token_type) — el Worker no guarda nada en D1, es un
 * relevo sin memoria (ver cabecera del archivo con el contexto completo).
 */
async function manejarOAuthExchange(request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { code, redirect_uri } = body || {};
  if (!code || typeof code !== "string" || !redirect_uri || typeof redirect_uri !== "string") {
    return respuestaJson({ error: "Falta code o redirect_uri." }, 400, origen);
  }

  const parametros = new URLSearchParams({
    code,
    client_id: CLIENT_ID_GOOGLE,
    client_secret: env.CLIENT_SECRET_GOOGLE,
    redirect_uri,
    grant_type: "authorization_code",
  });

  let respuestaGoogle;
  try {
    respuestaGoogle = await fetch(URL_TOKEN_GOOGLE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: parametros.toString(),
    });
  } catch (e) {
    console.error("Fallo de red al canjear el code contra Google:", e?.name || "Error");
    return respuestaJson({ error: "No se pudo contactar a Google." }, 502, origen);
  }

  const datosGoogle = await respuestaGoogle.json().catch(() => ({}));
  if (!respuestaGoogle.ok) {
    // Se propaga el status y el error tal cual los manda Google (ej.
    // "invalid_grant" si el code ya se usó o venció — tienen vida corta) —
    // auth.js solo necesita saber que falló, no interpreta el detalle.
    console.warn(`Google rechazó el canje de code (status ${respuestaGoogle.status}).`);
    return respuestaJson(
      { error: datosGoogle.error_description || datosGoogle.error || "Google rechazó el code." },
      respuestaGoogle.status,
      origen
    );
  }

  return respuestaJson(datosGoogle, 200, origen);
}

/**
 * POST /oauth/refresh — Parte A.3 del spec. Recibe { refresh_token } y pide
 * un access_token nuevo a Google — llamada servidor-a-servidor pura, nunca
 * involucra un popup del lado del cliente. Igual que /oauth/exchange, no
 * guarda nada: si Google rota el refresh_token (no es lo común, pero puede
 * pasar) se lo devuelve al cliente para que actualice su localStorage.
 */
async function manejarOAuthRefresh(request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { refresh_token } = body || {};
  if (!refresh_token || typeof refresh_token !== "string") {
    return respuestaJson({ error: "Falta refresh_token." }, 400, origen);
  }

  const parametros = new URLSearchParams({
    refresh_token,
    client_id: CLIENT_ID_GOOGLE,
    client_secret: env.CLIENT_SECRET_GOOGLE,
    grant_type: "refresh_token",
  });

  let respuestaGoogle;
  try {
    respuestaGoogle = await fetch(URL_TOKEN_GOOGLE, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: parametros.toString(),
    });
  } catch (e) {
    console.error("Fallo de red al refrescar el token contra Google:", e?.name || "Error");
    return respuestaJson({ error: "No se pudo contactar a Google." }, 502, origen);
  }

  const datosGoogle = await respuestaGoogle.json().catch(() => ({}));
  if (!respuestaGoogle.ok) {
    // "invalid_grant" acá es el caso esperado de refresh_token vencido/
    // revocado (ej. límite de 7 días en modo Prueba) — auth.js/
    // storage-sync.js lo usan como señal para borrar el token guardado y
    // pedir reconectar, así que se propaga tal cual, sin suavizarlo.
    console.warn(`Google rechazó el refresh (status ${respuestaGoogle.status}).`);
    return respuestaJson(
      { error: datosGoogle.error_description || datosGoogle.error || "Google rechazó el refresh_token." },
      respuestaGoogle.status,
      origen
    );
  }

  return respuestaJson(datosGoogle, 200, origen);
}



/**
 * Genera un id con el mismo estilo "prefijo_uuid" que usa el cliente en
 * schema.js (ej. "sesest_"+uuid) — prefijos elegidos para este Worker
 * (cpt_/part_/hg_) no colisionan a propósito con ningún prefijo que ya use
 * el cliente (ej. "comp_" ahí es "companero", una entidad sin ninguna
 * relación con esto), aunque técnicamente da lo mismo porque son espacios
 * de ids completamente separados (D1 acá vs. JSON de Drive allá).
 */
function generarId(prefijo) {
  return prefijo + crypto.randomUUID();
}

/**
 * Devuelve el epoch ms REAL (UTC) del lunes 00:00:00 más reciente, medido
 * en la hora LOCAL de `offsetMinutos` (minutos a sumarle a UTC para
 * obtener la hora local — mismo signo que usa `Date.getTimezoneOffset()`
 * invertido, o sea "offsetMinutos > 0" = está adelantado respecto a UTC).
 *
 * Truco: se corre el reloj hacia adelante `offsetMinutos`, se lee el día
 * de la semana con los métodos getUTC* (el runtime de Workers siempre
 * corre en UTC, así que getUTCDay()/getUTCHours() sobre el timestamp ya
 * corrido representan fielmente la hora local de esa persona), se calcula
 * la medianoche del lunes en ese reloj corrido, y se deshace el corrimiento
 * al final para volver a un epoch UTC real y comparable.
 */
function calcularUltimoLunesLocalUtcMs(ahoraMs, offsetMinutos) {
  const corrimientoMs = offsetMinutos * 60000;
  const local = new Date(ahoraMs + corrimientoMs);
  const diaSemana = local.getUTCDay(); // 0=domingo ... 6=sábado
  const diasDesdeLunes = (diaSemana + 6) % 7; // lunes=0, martes=1, ..., domingo=6
  const lunesMedianocheLocal = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - diasDesdeLunes,
    0, 0, 0, 0
  );
  return lunesMedianocheLocal - corrimientoMs;
}

/**
 * POST /competencias — crea la competencia Y de una vez inscribe a quien
 * la crea como su primer participante (el cliente ya tiene el apodo y el
 * offset a mano en el mismo momento en que arma el formulario de "crear",
 * así que evita un segundo viaje POST .../unirse innecesario). El
 * `offset_minutos_utc` que manda acá el creador es el que ancla el corte
 * semanal de TODA la competencia — ver cabecera de schema.sql.
 * Devuelve `token_creador` UNA sola vez: es lo único que autoriza borrar
 * la competencia más adelante, el cliente lo guarda en localStorage y el
 * Worker no lo vuelve a exponer en ningún otro endpoint.
 */
/**
 * 2026-09-21 — Valida/normaliza una URL de foto. Solo https y de largo
 * razonable (las de Google miden ~100-200 chars): evita guardar
 * `javascript:`/`data:` o basura enorme que el cliente luego pondría en un
 * <img src>. Devuelve null si no sirve (la fila queda sin foto y el cliente
 * cae a la inicial).
 */
function normalizarFotoUrl(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim();
  if (!v || v.length > 2048) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" ? u.toString() : null;
  } catch (e) {
    return null;
  }
}

/** Color en hex de 6 dígitos (#rrggbb, en minúsculas) o null. Se guarda tal
 * cual y el cliente lo pone en estilos inline: por eso NADA que no sea
 * exactamente ese formato pasa. */
function normalizarColor(valor) {
  if (typeof valor !== "string") return null;
  const v = valor.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(v) ? v : null;
}

async function manejarCrearCompetencia(request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { nombre, apodo, identificador_usuario, offset_minutos_utc, foto_url, color } = body || {};
  if (!nombre || typeof nombre !== "string" || !nombre.trim() || nombre.trim().length > 80) {
    return respuestaJson({ error: "El nombre es obligatorio y debe tener 80 caracteres o menos." }, 400, origen);
  }
  if (!apodo || typeof apodo !== "string" || !apodo.trim() || apodo.trim().length > 40) {
    return respuestaJson({ error: "El apodo es obligatorio y debe tener 40 caracteres o menos." }, 400, origen);
  }
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }
  if (offset_minutos_utc != null && (!Number.isInteger(offset_minutos_utc) || Math.abs(offset_minutos_utc) > 840)) return respuestaJson({ error: "Zona horaria inválida." }, 400, origen);
  const offset = Number.isFinite(offset_minutos_utc) ? offset_minutos_utc : 0;
  // 2026-09-21 (rediseño visual, fotos de participantes): opcional a
  // propósito — un dispositivo viejo sin este campo sigue creando
  // competencias normal, solo que esa fila queda sin foto (respaldo con
  // inicial del lado del cliente).
  const fotoUrl = normalizarFotoUrl(foto_url);
  const colorPropio = normalizarColor(color);

  const ahora = Date.now();
  const competenciaId = generarId("cpt_");
  const tokenCreador = crypto.randomUUID();
  const participanteId = generarId("part_");

  try {
    await env.DB_NOTIFICACIONES.batch([
      env.DB_NOTIFICACIONES.prepare(
        "INSERT INTO competencias (id, nombre, token_creador, offset_minutos_utc, ultimo_cierre_en, creado_en, estado) VALUES (?, ?, ?, ?, ?, ?, 'activa')"
      ).bind(competenciaId, nombre.trim(), tokenCreador, offset, calcularUltimoLunesLocalUtcMs(ahora, offset), ahora),
      env.DB_NOTIFICACIONES.prepare(
        "INSERT INTO participantes (id, competencia_id, apodo, identificador_usuario, horas_semana_actual, offset_minutos_utc, foto_url, color) VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
      ).bind(participanteId, competenciaId, apodo.trim(), identificador_usuario, offset, fotoUrl, colorPropio),
    ]);
  } catch (e) {
    console.error("Error creando competencia:", e?.name || "Error");
    return respuestaJson({ error: "No se pudo crear la competencia." }, 500, origen);
  }

  return respuestaJson({ id: competenciaId, token_creador: tokenCreador, participante_id: participanteId }, 200, origen);
}

/**
 * GET /competencias/:id — marcador en vivo. Nunca devuelve
 * `identificador_usuario` ni `token_creador`/`offset_minutos_utc` de nadie
 * — lo único que necesita pintar un marcador es apodo + horas.
 */
async function manejarObtenerCompetencia(competenciaId, env, origen) {
  const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT id, nombre, estado FROM competencias WHERE id = ?")
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);

  const { results: participantes } = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, apodo, horas_semana_actual, foto_url, color FROM participantes WHERE competencia_id = ? ORDER BY horas_semana_actual DESC"
  )
    .bind(competenciaId)
    .all();

  return respuestaJson(
    {
      id: competencia.id,
      nombre: competencia.nombre,
      // 2026-09-17: `estado` es "activa" | "finalizada" (punto 4.3). El
      // DEFAULT de la columna cubre las filas viejas anteriores a la
      // migración, pero se normaliza igual acá por si alguna quedó NULL.
      estado: competencia.estado === "finalizada" ? "finalizada" : "activa",
      participantes: participantes || [],
    },
    200,
    origen
  );
}

/**
 * POST /competencias/:id/unirse — el UNIQUE(competencia_id,
 * identificador_usuario) de la tabla garantiza una sola fila por persona.
 * Una persona nueva arranca siempre en 0 horas (no hay forma de "rellenar"
 * retroactivo lo que ya estudió esta semana antes de unirse — asumible para
 * un uso casual entre amigos).
 *
 * FIX 2026-09-19 (Parte A, "estado fantasma"): ya NO responde 409 cuando la
 * persona ya tiene fila — ahora es IDEMPOTENTE: actualiza el apodo y le
 * devuelve el `participante_id` que ya tenía (200, con `ya_estaba: true`).
 * Antes el 409 dejaba trabada a una persona con una fila "fantasma" (por
 * ejemplo, si su DELETE de "salir" nunca llegó al Worker): el cliente no
 * tenía forma de recuperar el id de esa fila, así que no podía volver a
 * unirse ni salir de verdad. La identidad ya es `identificador_usuario` en
 * todos los demás endpoints (decisión del dueño del proyecto: "entre
 * amigos"), así que quien manda el mismo correo puede reclamar su propia
 * fila sin abrir ningún permiso nuevo. Las horas de la fila existente NO se
 * tocan acá: el cliente llama a /actualizar-horas apenas se une y las
 * corrige solo.
 */
async function manejarUnirseCompetencia(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { apodo, identificador_usuario, offset_minutos_utc, foto_url, color } = body || {};
  if (!apodo || typeof apodo !== "string" || !apodo.trim() || apodo.trim().length > 40) {
    return respuestaJson({ error: "El apodo es obligatorio y debe tener 40 caracteres o menos." }, 400, origen);
  }
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }
  const fotoUrl = normalizarFotoUrl(foto_url);
  const colorPropio = normalizarColor(color);

  const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT id, estado FROM competencias WHERE id = ?")
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
  // 2026-09-17 (punto 4.3): una competencia archivada no acepta gente nueva.
  if (competencia.estado === "finalizada") {
    return respuestaJson({ error: "Esta competencia está finalizada." }, 403, origen);
  }

  if (offset_minutos_utc != null && (!Number.isInteger(offset_minutos_utc) || Math.abs(offset_minutos_utc) > 840)) return respuestaJson({ error: "Zona horaria inválida." }, 400, origen);
  const offset = Number.isFinite(offset_minutos_utc) ? offset_minutos_utc : 0;
  const participanteId = generarId("part_");

  try {
    await env.DB_NOTIFICACIONES.prepare(
      "INSERT INTO participantes (id, competencia_id, apodo, identificador_usuario, horas_semana_actual, offset_minutos_utc, foto_url, color) VALUES (?, ?, ?, ?, 0, ?, ?, ?)"
    )
      .bind(participanteId, competenciaId, apodo.trim(), identificador_usuario, offset, fotoUrl, colorPropio)
      .run();
  } catch (e) {
    // Lo más probable: UNIQUE(competencia_id, identificador_usuario) — ya
    // hay una fila de esta persona. Se confirma con un SELECT en vez de
    // asumirlo (un fallo de otro tipo NO debe disfrazarse de "ya estás").
    const existente = await env.DB_NOTIFICACIONES.prepare(
      "SELECT id FROM participantes WHERE competencia_id = ? AND identificador_usuario = ?"
    )
      .bind(competenciaId, identificador_usuario)
      .first();
    if (!existente) {
      console.error("[competencias] Error al registrar participante:", e?.name || "Error");
      return respuestaJson({ error: "No se pudo registrar la unión." }, 500, origen);
    }
    // Reclamo de la fila propia: se refresca apodo/huso (lo que la persona
    // acaba de escribir manda) y se devuelve el id que ya tenía.
    await env.DB_NOTIFICACIONES.prepare(
      "UPDATE participantes SET apodo = ?, offset_minutos_utc = ?, foto_url = COALESCE(?, foto_url), color = COALESCE(?, color) WHERE id = ? AND competencia_id = ? AND identificador_usuario = ?"
    )
      .bind(apodo.trim(), offset, fotoUrl, colorPropio, existente.id, competenciaId, identificador_usuario)
      .run();
    return respuestaJson({ participante_id: existente.id, ya_estaba: true }, 200, origen);
  }

  return respuestaJson({ participante_id: participanteId }, 200, origen);
}

/**
 * POST /competencias/:id/actualizar-horas — best-effort desde el cliente
 * tras CADA sesión de estudio (timer/Pomodoro/manual), manda el total
 * recalculado de la semana en curso, nunca un delta (evita que un fallo
 * de red puntual desalinee el contador — cada llamada es la verdad
 * completa, no un incremento).
 *
 * También hace de "buzón" para la delegación de `token_creador` (ver
 * manejarDelegarBorrado): como YA se identifica acá con
 * `identificador_usuario` en cada sesión de estudio, es el lugar más
 * frecuente donde el dispositivo del destinatario pasa solo — si tiene
 * algo pendiente en `participantes.token_creador_pendiente`, se lo manda
 * en la misma respuesta y se limpia esa columna (entrega de una sola
 * vez, no se vuelve a mandar en la siguiente llamada).
 */
async function manejarActualizarHoras(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { identificador_usuario, horas_semana_actual } = body || {};
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }
  if (typeof horas_semana_actual !== "number" || !Number.isFinite(horas_semana_actual) || horas_semana_actual < 0 || horas_semana_actual > 168) {
    return respuestaJson({ error: "horas_semana_actual inválido." }, 400, origen);
  }

  const participante = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, token_creador_pendiente FROM participantes WHERE competencia_id = ? AND identificador_usuario = ?"
  )
    .bind(competenciaId, identificador_usuario)
    .first();

  if (!participante) {
    return respuestaJson({ error: "No sos participante de esta competencia." }, 404, origen);
  }

  // FIX blindaje 2026-09-17 (punto 4.5 de la auditoría): antes había un
  // SELECT de `estado` separado del UPDATE de abajo. Si la competencia se
  // finalizaba en el Worker justo EN EL MEDIO de esas dos llamadas (el
  // caso concreto que pide auditar el prompt: el creador toca "Finalizar"
  // justo después de que el cliente armó la lista de competencias a las
  // que mandar horas, pero antes de que este request llegue), las horas se
  // escribían igual — el filtro del cliente (competencias `finalizada` no
  // se les manda horas) es correcto pero no alcanza por sí solo, porque el
  // cliente decide con la foto que tenía ANTES de que el servidor cambiara
  // de estado. Ahora el guard "solo si sigue activa" vive DENTRO del propio
  // UPDATE, como subquery correlacionada — una única sentencia atómica sin
  // ninguna ventana entre "leer estado" y "escribir horas" en la que algo
  // pueda cambiar por el medio.
  const resultado = await env.DB_NOTIFICACIONES.prepare(
    `UPDATE participantes SET horas_semana_actual = ?
     WHERE id = ?
       AND (SELECT estado FROM competencias WHERE id = ?) != 'finalizada'`
  )
    .bind(horas_semana_actual, participante.id, competenciaId)
    .run();

  // cambios === 0 significa que el guard de arriba bloqueó la escritura
  // (la competencia ya estaba, o quedó, finalizada) — se sigue respondiendo
  // 200 con `ignorado: true`, mismo contrato que antes, best-effort a
  // propósito (un 4xx acá solo ensuciaría la consola en cada sesión
  // guardada normal).
  const finalizada = !resultado.meta || resultado.meta.changes === 0;

  const respuesta = { ok: true, estado: finalizada ? "finalizada" : "activa", ignorado: finalizada };
  if (participante.token_creador_pendiente) {
    respuesta.token_creador_delegado = participante.token_creador_pendiente;
    await env.DB_NOTIFICACIONES.prepare("UPDATE participantes SET token_creador_pendiente = NULL WHERE id = ?")
      .bind(participante.id)
      .run();
  }

  return respuestaJson(respuesta, 200, origen);
}

/**
 * DELETE /competencias/:id — exige `token_creador` en el body, el mismo
 * que se devolvió UNA vez en POST /competencias. Borra en cascada a mano
 * (D1/SQLite no tiene ON DELETE CASCADE activado acá) — competencia,
 * participantes e historial de esa competencia, en ese orden dentro de un
 * mismo batch.
 */
async function manejarBorrarCompetencia(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { token_creador } = body || {};
  if (!token_creador || typeof token_creador !== "string") {
    return respuestaJson({ error: "Falta token_creador." }, 400, origen);
  }

  const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT token_creador FROM competencias WHERE id = ?")
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
  if (competencia.token_creador !== token_creador) {
    return respuestaJson({ error: "token_creador inválido." }, 403, origen);
  }

  await env.DB_NOTIFICACIONES.batch([
    env.DB_NOTIFICACIONES.prepare("DELETE FROM historial_resultados WHERE competencia_id = ?").bind(competenciaId),
    env.DB_NOTIFICACIONES.prepare("DELETE FROM historial_ganadores WHERE competencia_id = ?").bind(competenciaId),
    env.DB_NOTIFICACIONES.prepare("DELETE FROM participantes WHERE competencia_id = ?").bind(competenciaId),
    env.DB_NOTIFICACIONES.prepare("DELETE FROM competencias WHERE id = ?").bind(competenciaId),
  ]);

  return respuestaJson({ ok: true }, 200, origen);
}

/**
 * POST /competencias/:id/delegar-borrado — le pasa el `token_creador` de
 * esta competencia a OTRO participante ya existente, invalidando de una
 * el que tenía quien delega (se pisa la misma columna, no hace falta
 * borrar nada aparte). Pensado para "me voy de la competencia pero no
 * quiero que quede sin nadie que la pueda borrar para todos" — ver
 * salirDeCompetencia()/abrirModalDelegarAntesDeSalir() del lado del
 * cliente, que exige pasar por acá antes de dejar salir a quien tenga el
 * permiso si hay más gente adentro.
 *
 * El token nuevo NO se devuelve acá — nadie más que el destinatario debe
 * llegar a verlo, y el que llama a este endpoint sigue siendo quien se
 * está yendo. En cambio, queda "estacionado" en
 * `participantes.token_creador_pendiente` de la fila elegida, y se lo
 * entrega su propio dispositivo la próxima vez que sincronice (ver
 * manejarActualizarHoras) — cero acción manual para esa persona.
 */
async function manejarDelegarBorrado(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { token_creador, participante_id } = body || {};
  if (!token_creador || typeof token_creador !== "string") {
    return respuestaJson({ error: "Falta token_creador." }, 400, origen);
  }
  if (!participante_id || typeof participante_id !== "string") {
    return respuestaJson({ error: "Falta participante_id." }, 400, origen);
  }

  const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT token_creador FROM competencias WHERE id = ?")
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
  if (competencia.token_creador !== token_creador) {
    return respuestaJson({ error: "token_creador inválido." }, 403, origen);
  }

  const participante = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id FROM participantes WHERE id = ? AND competencia_id = ?"
  )
    .bind(participante_id, competenciaId)
    .first();
  if (!participante) return respuestaJson({ error: "Ese participante no existe en esta competencia." }, 404, origen);

  const tokenNuevo = crypto.randomUUID();
  await env.DB_NOTIFICACIONES.batch([
    env.DB_NOTIFICACIONES.prepare("UPDATE competencias SET token_creador = ? WHERE id = ?").bind(tokenNuevo, competenciaId),
    env.DB_NOTIFICACIONES.prepare("UPDATE participantes SET token_creador_pendiente = ? WHERE id = ?").bind(
      tokenNuevo,
      participante_id
    ),
  ]);

  return respuestaJson({ ok: true }, 200, origen);
}

/**
 * DELETE /competencias/:id/participantes/:participanteId — saca a un
 * participante. Dos usos, un solo endpoint:
 *
 *   a) SALIRSE uno mismo (el de siempre): body con `identificador_usuario`,
 *      que se valida contra la fila real. El `:participanteId` de la URL
 *      por sí solo NO alcanza como prueba de identidad — GET
 *      /competencias/:id ya devuelve esos ids en el marcador público, así
 *      que sin este chequeo cualquiera con el link podría echar a un amigo
 *      copiándole el id.
 *
 *   b) SACAR A OTRO (2026-09-17, punto 4.2): body con `token_creador`, el
 *      mismo que autoriza borrar/renombrar/finalizar. Se agregó como
 *      autorización ALTERNATIVA en vez de crear una ruta nueva
 *      (/expulsar), para no tener dos lugares distintos que borren filas de
 *      `participantes` y se puedan desincronizar más adelante.
 *
 * Alcanza con UNA de las dos: se prueba primero el token (es el caso
 * estricto, lo tiene una sola persona) y si no vino, el identificador.
 */
async function manejarSalirCompetencia(competenciaId, participanteId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { identificador_usuario, token_creador } = body || {};

  if (token_creador && typeof token_creador === "string") {
    const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT token_creador FROM competencias WHERE id = ?")
      .bind(competenciaId)
      .first();
    if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
    if (competencia.token_creador !== token_creador) {
      return respuestaJson({ error: "token_creador inválido." }, 403, origen);
    }

    const resultado = await env.DB_NOTIFICACIONES.prepare(
      "DELETE FROM participantes WHERE id = ? AND competencia_id = ?"
    )
      .bind(participanteId, competenciaId)
      .run();
    // FIX blindaje 2026-09-17 (punto 4.3 de la auditoría): antes
    // `changes === 0` respondía 404 con `error`, tratando "ya no existe"
    // como un fallo. Pero el caso real que pide auditar el prompt es
    // justo este: el creador saca a alguien (esta rama) en el mismo
    // instante en que esa persona toca "Salir" sola (la otra rama, más
    // abajo) — el que llega segundo, sea cual sea, encuentra la fila ya
    // borrada. El estado final deseado ("ese participante ya no está") se
    // cumplió igual; un 404 ahí solo rompe la UI del segundo request sin
    // razón. `changes === 0` ahora es éxito idempotente.
    if (!resultado.meta || resultado.meta.changes === 0) {
      return respuestaJson({ ok: true, ya_no_estaba: true }, 200, origen);
    }
    return respuestaJson({ ok: true }, 200, origen);
  }

  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario o token_creador." }, 400, origen);
  }

  if (body?.eliminar_datos_cuenta === true) {
    const identidad = await verificarUsuarioGoogle(request);
    if (!identidad.ok || identidad.correo !== identificador_usuario.toLowerCase()) return respuestaJson({ error: "No se pudo verificar la cuenta que solicita el borrado." }, identidad.status || 403, origen);
    await env.DB_NOTIFICACIONES.batch([
      env.DB_NOTIFICACIONES.prepare("UPDATE historial_ganadores SET apodo = 'Usuario eliminado' WHERE participante_id = ?").bind(participanteId),
      env.DB_NOTIFICACIONES.prepare("UPDATE historial_resultados SET apodo = 'Usuario eliminado' WHERE participante_id = ?").bind(participanteId),
    ]);
  }
  const resultado = await env.DB_NOTIFICACIONES.prepare(
    "DELETE FROM participantes WHERE id = ? AND competencia_id = ? AND identificador_usuario = ?"
  )
    .bind(participanteId, competenciaId, identificador_usuario)
    .run();

  // FIX blindaje 2026-09-17 (punto 4.3, mismo criterio que la rama de
  // arriba): confirmado en el cliente (tiempo-estudio-competencias.js,
  // ejecutarSalidaCompetencia) que un 404 acá YA se trataba como éxito
  // ("el Worker ya no lo tiene como participante... igual se saca de la
  // lista local"). Devolver 200 de entrada es más honesto con lo que
  // realmente pasó (el estado deseado se cumplió) y evita que la UI tenga
  // que conocer este caso especial del 404 en absoluto.
  if (!resultado.meta || resultado.meta.changes === 0) {
    return respuestaJson({ ok: true, ya_no_estaba: true }, 200, origen);
  }

  return respuestaJson({ ok: true }, 200, origen);
}

/** GET /competencias/:id/historial — salón de la fama, más reciente primero. */
async function manejarHistorialCompetencia(competenciaId, env, origen) {
  const { results } = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, participante_id, apodo, horas, semana_cerrada_en FROM historial_ganadores WHERE competencia_id = ? ORDER BY semana_cerrada_en DESC LIMIT 52"
  )
    .bind(competenciaId)
    .all();

  return respuestaJson({ historial: results || [] }, 200, origen);
}

/**
 * GET /identificadores/:correo/competencias — (2026-09-22, "recuperar
 * historial perdido") todas las filas de `participantes` de ese
 * `identificador_usuario`, activas y finalizadas por igual, con el
 * nombre/estado de su competencia. Es el único endpoint que busca por
 * persona en vez de por `id` de competencia — existe puntualmente para que
 * el cliente pueda repoblar `competencias_unidas` cuando su puntero local
 * se perdió (ver nota de cabecera de este archivo). De solo lectura: no
 * toca D1 en ningún momento.
 */
async function manejarListarCompetenciasDeUsuario(correo, env, origen) {
  if (!correo || typeof correo !== "string") {
    return respuestaJson({ error: "Falta identificador de usuario." }, 400, origen);
  }

  const { results } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT c.id, c.nombre, c.estado, p.id AS participante_id, p.apodo
     FROM participantes p
     JOIN competencias c ON c.id = p.competencia_id
     WHERE p.identificador_usuario = ?
     ORDER BY c.creado_en DESC`
  )
    .bind(correo)
    .all();

  const competencias = (results || []).map((fila) => ({
    id: fila.id,
    nombre: fila.nombre,
    // Mismo criterio de normalización que en manejarObtenerCompetencia:
    // el DEFAULT de la columna cubre filas viejas, se normaliza igual acá.
    estado: fila.estado === "finalizada" ? "finalizada" : "activa",
    participante_id: fila.participante_id,
    apodo: fila.apodo,
  }));

  return respuestaJson({ competencias }, 200, origen);
}

/**
 * POST /competencias/:id/renombrar — body { token_creador, nombre }.
 * Solo el creador (punto 4.2). El nombre es lo único que cambia: el `id`
 * (y por lo tanto el link de invitación) queda igual, así que un link ya
 * repartido sigue funcionando después de renombrar.
 */
async function manejarRenombrarCompetencia(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { token_creador, nombre } = body || {};
  if (!token_creador || typeof token_creador !== "string") {
    return respuestaJson({ error: "Falta token_creador." }, 400, origen);
  }
  if (!nombre || typeof nombre !== "string" || !nombre.trim()) {
    return respuestaJson({ error: "Falta nombre." }, 400, origen);
  }

  const competencia = await env.DB_NOTIFICACIONES.prepare("SELECT token_creador FROM competencias WHERE id = ?")
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
  if (competencia.token_creador !== token_creador) {
    return respuestaJson({ error: "token_creador inválido." }, 403, origen);
  }

  await env.DB_NOTIFICACIONES.prepare("UPDATE competencias SET nombre = ? WHERE id = ?")
    .bind(nombre.trim(), competenciaId)
    .run();

  return respuestaJson({ ok: true, nombre: nombre.trim() }, 200, origen);
}

/**
 * POST /competencias/:id/estado — body { token_creador, estado }, con
 * `estado` = "activa" | "finalizada" (punto 4.3). Solo el creador.
 * REVERSIBLE a propósito: nunca borra nada, solo mueve la bandera.
 *
 * Al FINALIZAR se hace además un cierre de semana final: lo que cada uno
 * lleve trabajado en la semana en curso se pliega a
 * `horas_totales_historicas` y, si alguien tiene horas, esa semana parcial
 * queda registrada en el historial. Sin esto, la última semana de toda
 * competencia se perdería justo en el momento de archivarla, que es
 * exactamente cuando el Registro (Parte 5) la va a mostrar.
 *
 * Al REACTIVAR se arranca semana limpia: horas en 0 y `ultimo_cierre_en`
 * movido al lunes actual. Si no, el cron de la próxima corrida vería un
 * `ultimo_cierre_en` viejo de cuando se archivó y cerraría de golpe,
 * generando una entrada de historial por una semana que la competencia
 * pasó entera archivada.
 *
 * Idempotente: pedir el estado en el que ya está no hace nada (evita que
 * un doble toque dispare dos cierres finales seguidos).
 */
async function manejarCambiarEstadoCompetencia(competenciaId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { token_creador, estado } = body || {};
  if (!token_creador || typeof token_creador !== "string") {
    return respuestaJson({ error: "Falta token_creador." }, 400, origen);
  }
  if (estado !== "activa" && estado !== "finalizada") {
    return respuestaJson({ error: 'estado debe ser "activa" o "finalizada".' }, 400, origen);
  }

  const competencia = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, token_creador, offset_minutos_utc, estado, ultimo_cierre_en FROM competencias WHERE id = ?"
  )
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);
  if (competencia.token_creador !== token_creador) {
    return respuestaJson({ error: "token_creador inválido." }, 403, origen);
  }

  const estadoActual = competencia.estado === "finalizada" ? "finalizada" : "activa";
  if (estadoActual === estado) {
    return respuestaJson({ ok: true, estado }, 200, origen);
  }

  const ahora = Date.now();
  const lunesUtcMs = calcularUltimoLunesLocalUtcMs(ahora, competencia.offset_minutos_utc);

  if (estado === "finalizada") {
    // FIX blindaje 2026-09-17 (punto 4.2 de la auditoría, defensa extra
    // para 4.4): reclamo atómico de `estado` — una sola sentencia con el
    // guard en el WHERE (no el SELECT de arriba, que ya quedó viejo apenas
    // termina de leerse) — antes de correr el cierre final. Cubre el
    // doble-toque desde dos dispositivos del mismo creador (4.4): el que
    // pierde el reclamo (`changes === 0`) ni siquiera intenta el cierre —
    // se ahorra el trabajo y, sobre todo, no vuelve a disparar
    // procesarCierreCompetencia sin necesidad (que igual está blindado por
    // separado, ver el comentario grande ahí — esto es además, no en vez
    // de).
    const claimEstado = await env.DB_NOTIFICACIONES.prepare(
      "UPDATE competencias SET estado = 'finalizada' WHERE id = ? AND estado != 'finalizada'"
    )
      .bind(competenciaId)
      .run();

    if (claimEstado.meta && claimEstado.meta.changes === 1) {
      try {
        await procesarCierreCompetencia(env, competencia, lunesUtcMs);
      } catch (e) {
        // Que falle el cierre final no debe impedir archivar: a lo sumo se
        // pierde del historial la última semana parcial.
        console.error("Error en cierre final de competencia:", e?.name || "Error");
      }
    }
    // changes === 0: otro request (u otra pestaña/dispositivo) ya la
    // finalizó entre el SELECT de arriba y este UPDATE — la competencia ya
    // está finalizada, responder igual de éxito es lo idempotente y
    // correcto acá.
    return respuestaJson({ ok: true, estado: "finalizada" }, 200, origen);
  }

  await env.DB_NOTIFICACIONES.batch([
    env.DB_NOTIFICACIONES.prepare("UPDATE participantes SET horas_semana_actual = 0 WHERE competencia_id = ?").bind(
      competenciaId
    ),
    env.DB_NOTIFICACIONES.prepare("UPDATE competencias SET estado = 'activa', ultimo_cierre_en = ? WHERE id = ?").bind(
      lunesUtcMs,
      competenciaId
    ),
  ]);

  return respuestaJson({ ok: true, estado: "activa" }, 200, origen);
}

/**
 * POST /competencias/:id/participantes/:participanteId/apodo — body
 * { identificador_usuario, apodo }. Cualquier participante puede cambiar
 * EL SUYO (punto 4.2), nunca el de otro: igual que en
 * manejarSalirCompetencia, el `:participanteId` de la URL no alcanza como
 * prueba de identidad porque el marcador público ya expone esos ids, así
 * que el UPDATE exige que coincidan las tres cosas a la vez (id +
 * competencia + identificador_usuario).
 *
 * El historial NO se toca a propósito: `historial_ganadores.apodo` es una
 * copia congelada del apodo al momento del cierre, no un FK vivo (ver la
 * nota de esa tabla en schema.sql) — una semana ganada hace 3 meses tiene
 * que seguir diciendo el apodo de entonces.
 */
async function manejarCambiarApodo(competenciaId, participanteId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { identificador_usuario, apodo } = body || {};
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }
  if (!apodo || typeof apodo !== "string" || !apodo.trim() || apodo.trim().length > 40) {
    return respuestaJson({ error: "El apodo es obligatorio y debe tener 40 caracteres o menos." }, 400, origen);
  }

  const resultado = await env.DB_NOTIFICACIONES.prepare(
    "UPDATE participantes SET apodo = ? WHERE id = ? AND competencia_id = ? AND identificador_usuario = ?"
  )
    .bind(apodo.trim(), participanteId, competenciaId, identificador_usuario)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return respuestaJson({ error: "No se encontró ese participante (¿identificador_usuario correcto?)." }, 404, origen);
  }

  return respuestaJson({ ok: true, apodo: apodo.trim() }, 200, origen);
}

/**
 * POST /competencias/:id/participantes/:pid/foto — body
 * { identificador_usuario, foto_url }. 2026-09-21. Mismo criterio de
 * identidad que /apodo (id + competencia + identificador_usuario a la
 * vez). Las URLs de foto de Google pueden cambiar o vencer: el cliente
 * llama a esto para refrescarla. `foto_url` vacío/null la borra (vuelve la
 * inicial). Una URL inválida (no https, enorme) responde 400, no se ignora
 * en silencio, para que el cliente se entere.
 */
async function manejarCambiarFoto(competenciaId, participanteId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }

  const { identificador_usuario, foto_url } = body || {};
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }
  const quiereBorrar = foto_url === null || foto_url === "" || foto_url === undefined;
  const fotoUrl = quiereBorrar ? null : normalizarFotoUrl(foto_url);
  if (!quiereBorrar && !fotoUrl) {
    return respuestaJson({ error: "foto_url inválida (se espera una URL https)." }, 400, origen);
  }

  const resultado = await env.DB_NOTIFICACIONES.prepare(
    "UPDATE participantes SET foto_url = ? WHERE id = ? AND competencia_id = ? AND identificador_usuario = ?"
  )
    .bind(fotoUrl, participanteId, competenciaId, identificador_usuario)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return respuestaJson({ error: "No se encontró ese participante (¿identificador_usuario correcto?)." }, 404, origen);
  }

  return respuestaJson({ ok: true, foto_url: fotoUrl }, 200, origen);
}

/**
 * POST /competencias/:id/participantes/:pid/perfil — body
 * { identificador_usuario, foto_url?, color? }. 2026-09-21 (2.ª ronda).
 * Actualiza SOLO las claves presentes en el body: `null` o "" borra ese
 * campo, una clave ausente no lo toca. Valores inválidos → 400 (no se
 * ignoran en silencio). Misma identidad que /foto y /apodo.
 */
async function manejarActualizarPerfil(competenciaId, participanteId, request, env, origen) {
  let body;
  try {
    body = await request.json();
  } catch (e) {
    return respuestaJson({ error: "Body inválido (se esperaba JSON)." }, 400, origen);
  }
  const { identificador_usuario } = body || {};
  if (!identificador_usuario || typeof identificador_usuario !== "string") {
    return respuestaJson({ error: "Falta identificador_usuario." }, 400, origen);
  }

  const sets = [];
  const valores = [];
  const vacio = (v) => v === null || v === "";

  if (Object.prototype.hasOwnProperty.call(body, "foto_url")) {
    const f = vacio(body.foto_url) ? null : normalizarFotoUrl(body.foto_url);
    if (!vacio(body.foto_url) && !f) return respuestaJson({ error: "foto_url inválida (se espera una URL https)." }, 400, origen);
    sets.push("foto_url = ?");
    valores.push(f);
  }
  if (Object.prototype.hasOwnProperty.call(body, "color")) {
    const c = vacio(body.color) ? null : normalizarColor(body.color);
    if (!vacio(body.color) && !c) return respuestaJson({ error: "color inválido (se espera #rrggbb)." }, 400, origen);
    sets.push("color = ?");
    valores.push(c);
  }
  if (sets.length === 0) return respuestaJson({ error: "Nada que actualizar (mandá foto_url y/o color)." }, 400, origen);

  const resultado = await env.DB_NOTIFICACIONES.prepare(
    `UPDATE participantes SET ${sets.join(", ")} WHERE id = ? AND competencia_id = ? AND identificador_usuario = ?`
  )
    .bind(...valores, participanteId, competenciaId, identificador_usuario)
    .run();

  if (!resultado.meta || resultado.meta.changes === 0) {
    return respuestaJson({ error: "No se encontró ese participante (¿identificador_usuario correcto?)." }, 404, origen);
  }
  return respuestaJson({ ok: true }, 200, origen);
}

/**
 * GET /competencias/:id/podios — 2026-09-21. El podio COMPLETO de cada
 * semana cerrada, más reciente primero (hasta 52 semanas), para el
 * Historial rediseñado y el aviso "Quedaste 2.º, a 1 h 20 min de Iva".
 *
 * Forma: { podios: [ { semana_cerrada_en, completa, resultados: [
 *   { participante_id, apodo, horas, puesto, foto_url, color } ] } ] }
 *
 * - `apodo` es la copia congelada de ese cierre (no cambia si la persona se
 *   renombra después); `foto_url` en cambio es VIVA (join con
 *   participantes): así una foto nueva se ve también en semanas viejas. Si
 *   la persona ya salió de la competencia, viene null (el cliente pone la
 *   inicial).
 * - Semanas cerradas ANTES de esta ronda solo tienen al ganador en
 *   `historial_ganadores`: se devuelven con `completa: false` y un solo
 *   resultado (puesto 1), para que el cliente no muestre un podio de
 *   mentira con puestos inventados.
 */
async function manejarPodiosCompetencia(competenciaId, env, origen) {
  const { results: filas } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT r.semana_cerrada_en, r.participante_id, r.apodo, r.horas, r.puesto, p.foto_url, p.color
       FROM historial_resultados r
       LEFT JOIN participantes p ON p.id = r.participante_id AND p.competencia_id = r.competencia_id
      WHERE r.competencia_id = ?
        AND r.semana_cerrada_en IN (
          SELECT DISTINCT semana_cerrada_en FROM historial_resultados
           WHERE competencia_id = ? ORDER BY semana_cerrada_en DESC LIMIT 52
        )
      ORDER BY r.semana_cerrada_en DESC, r.puesto ASC`
  )
    .bind(competenciaId, competenciaId)
    .all();

  const porSemana = new Map();
  for (const f of filas || []) {
    if (!porSemana.has(f.semana_cerrada_en)) {
      porSemana.set(f.semana_cerrada_en, { semana_cerrada_en: f.semana_cerrada_en, completa: true, resultados: [] });
    }
    porSemana.get(f.semana_cerrada_en).resultados.push({
      participante_id: f.participante_id,
      apodo: f.apodo,
      horas: f.horas,
      puesto: f.puesto,
      foto_url: f.foto_url || null,
      color: f.color || null,
    });
  }

  // Semanas anteriores a la migración: solo se sabe el ganador.
  const { results: viejas } = await env.DB_NOTIFICACIONES.prepare(
    `SELECT g.semana_cerrada_en, g.participante_id, g.apodo, g.horas, p.foto_url, p.color
       FROM historial_ganadores g
       LEFT JOIN participantes p ON p.id = g.participante_id AND p.competencia_id = g.competencia_id
      WHERE g.competencia_id = ?
      ORDER BY g.semana_cerrada_en DESC LIMIT 52`
  )
    .bind(competenciaId)
    .all();
  for (const g of viejas || []) {
    if (porSemana.has(g.semana_cerrada_en)) continue;
    porSemana.set(g.semana_cerrada_en, {
      semana_cerrada_en: g.semana_cerrada_en,
      completa: false,
      resultados: [
        { participante_id: g.participante_id, apodo: g.apodo, horas: g.horas, puesto: 1, foto_url: g.foto_url || null, color: g.color || null },
      ],
    });
  }

  const podios = [...porSemana.values()].sort((a, b) => b.semana_cerrada_en - a.semana_cerrada_en).slice(0, 52);
  return respuestaJson({ podios }, 200, origen);
}

/**
 * GET /competencias/:id/resumen — todo lo que necesita la ficha de una
 * competencia archivada (Parte 5) en UN solo viaje: datos de la
 * competencia, historial completo de semanas, y los participantes con su
 * acumulado de por vida.
 *
 * Es deliberadamente distinto de GET /competencias/:id (marcador en vivo,
 * se pide seguido y tiene que ser lo más liviano posible): este se pide
 * una sola vez, al abrir una ficha, y trae todo junto. Sigue sin devolver
 * `identificador_usuario` ni `token_creador` de nadie.
 *
 * `historial` viene sin LIMIT, a diferencia de GET .../historial (que
 * corta en 52): el sentido de la ficha es ver TODAS las semanas que tuvo.
 */
async function manejarResumenCompetencia(competenciaId, env, origen) {
  const competencia = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, nombre, estado, creado_en FROM competencias WHERE id = ?"
  )
    .bind(competenciaId)
    .first();
  if (!competencia) return respuestaJson({ error: "Competencia no encontrada." }, 404, origen);

  const { results: historial } = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, participante_id, apodo, horas, semana_cerrada_en FROM historial_ganadores WHERE competencia_id = ? ORDER BY semana_cerrada_en DESC"
  )
    .bind(competenciaId)
    .all();

  const { results: participantes } = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, apodo, horas_semana_actual, horas_totales_historicas, foto_url, color FROM participantes WHERE competencia_id = ? ORDER BY horas_totales_historicas DESC"
  )
    .bind(competenciaId)
    .all();

  return respuestaJson(
    {
      id: competencia.id,
      nombre: competencia.nombre,
      estado: competencia.estado === "finalizada" ? "finalizada" : "activa",
      creado_en: competencia.creado_en,
      historial: historial || [],
      participantes: participantes || [],
    },
    200,
    origen
  );
}

/**
 * Cierra la semana de UNA competencia: loguea el ganador (si alguien
 * estudió algo > 0 esta semana — si nadie tocó el timer, no se genera una
 * entrada vacía en el historial) y resetea `horas_semana_actual` de TODOS
 * sus participantes a la vez (corte anclado al creador, ver cabecera de
 * schema.sql — nunca se cierra "a medias").
 *
 * FIX blindaje 2026-09-17 (punto 4.2 de la auditoría — "el creador dispara
 * Finalizar justo en el instante en que el cron está corriendo esto mismo
 * sobre la misma fila"): las dos únicas rutas que llaman a esta función
 * (scheduled(), más abajo, y manejarCambiarEstadoCompetencia al finalizar)
 * leen `competencia.ultimo_cierre_en` en su propio SELECT, momentos antes
 * de llamar acá — ese valor leído (`valorLeido`) se usa como guarda
 * optimista (compare-and-swap) en las TRES sentencias del batch: si otro
 * proceso ya cambió `ultimo_cierre_en` desde que este llamador lo leyó
 * (porque el cron y el endpoint corrieron sobre la misma fila casi al
 * mismo tiempo, y uno de los dos ya cerró esta vuelta), la condición
 * `ultimo_cierre_en = ?` deja de cumplirse y las TRES sentencias se
 * convierten en no-ops (0 filas afectadas cada una) — nunca se duplica la
 * entrada de `historial_ganadores` ni se suman las horas dos veces a
 * `horas_totales_historicas`.
 *
 * Importante: NO ata el cierre a que `lunesUtcMs` sea mayor que
 * `ultimo_cierre_en` (esa comparación es la que usa el cron para decidir
 * SI debe cerrar — ver scheduled() — pero acá adentro habría roto el
 * cierre final de "Finalizar", que necesita poder plegar horas sueltas
 * del participante aunque el cron ya haya cerrado la semana actual hace
 * rato). Compara solo contra el valor que el llamador tenía en mano: en el
 * caso normal (nadie más tocando esta fila al mismo tiempo) el UPDATE de
 * `ultimo_cierre_en` "no cambia nada" si ya valía lo mismo, pero SQLite
 * igual cuenta la fila como afectada (el WHERE la encontró), así que el
 * camino sin carrera se comporta exactamente igual que antes.
 *
 * Las 3 sentencias van en el MISMO batch (D1 las corre como una sola
 * transacción) para que la guarda y el resto del cierre sean atómicos
 * juntos — si se hiciera el reclamo en una llamada aparte antes del
 * batch, una falla justo en el medio podría dejar `ultimo_cierre_en` ya
 * avanzado sin que el pliegue de horas/historial se haya escrito.
 */
async function procesarCierreCompetencia(env, competencia, lunesUtcMs) {
  const { results: participantes } = await env.DB_NOTIFICACIONES.prepare(
    "SELECT id, apodo, horas_semana_actual FROM participantes WHERE competencia_id = ? ORDER BY horas_semana_actual DESC, id ASC"
  )
    .bind(competencia.id)
    .all();

  const valorLeido = Number(competencia.ultimo_cierre_en) || 0;
  const sentencias = [];
  const ganador = participantes && participantes.length > 0 ? participantes[0] : null;
  if (ganador && ganador.horas_semana_actual > 0) {
    sentencias.push(
      env.DB_NOTIFICACIONES.prepare(
        `INSERT INTO historial_ganadores (id, competencia_id, participante_id, apodo, horas, semana_cerrada_en)
         SELECT ?, ?, ?, ?, ?, ?
         WHERE (SELECT ultimo_cierre_en FROM competencias WHERE id = ?) = ?`
      ).bind(
        generarId("hg_"),
        competencia.id,
        ganador.id,
        ganador.apodo,
        ganador.horas_semana_actual,
        lunesUtcMs,
        competencia.id,
        valorLeido
      )
    );
  }
  // 2026-09-21 (rediseño, podio completo): se guardan TODOS los
  // participantes con su puesto de esta semana (no solo el ganador), para
  // poder mostrar "quedaste 2.º, a X de Fulano". Un solo INSERT...SELECT
  // con ROW_NUMBER usa el mismo orden que el SELECT de arriba (horas DESC,
  // id ASC → los empates se desempatan igual que el ganador) y la misma
  // guarda optimista. Debe ir ANTES del UPDATE de abajo, que pone
  // horas_semana_actual en 0 — el batch corre las sentencias en orden.
  // Mismo criterio que el ganador: si nadie estudió nada, no se genera
  // entrada. UNIQUE(competencia_id, semana_cerrada_en, participante_id)
  // + OR IGNORE hacen inofensivo cualquier reintento.
  if (ganador && ganador.horas_semana_actual > 0) {
    sentencias.push(
      env.DB_NOTIFICACIONES.prepare(
        `INSERT OR IGNORE INTO historial_resultados (id, competencia_id, semana_cerrada_en, participante_id, apodo, horas, puesto)
         SELECT 'hr_' || p.id || '_' || ?, ?, ?, p.id, p.apodo, p.horas_semana_actual,
                ROW_NUMBER() OVER (ORDER BY p.horas_semana_actual DESC, p.id ASC)
           FROM participantes p
          WHERE p.competencia_id = ?
            AND (SELECT ultimo_cierre_en FROM competencias WHERE id = ?) = ?`
      ).bind(lunesUtcMs, competencia.id, lunesUtcMs, competencia.id, competencia.id, valorLeido)
    );
  }
  // 2026-09-17 (Parte 5): antes de resetear la semana, lo trabajado se
  // suma al acumulador de por vida de cada participante. Es la única forma
  // de poder mostrar "horas totales estudiadas entre todos los
  // participantes en toda la vida de la competencia" en el Registro:
  // `historial_ganadores` solo guarda al GANADOR de cada semana, no a
  // todos. Un solo UPDATE hace las dos cosas (acumular y resetear) para
  // que no puedan quedar a medias si falla entre medio — más la misma
  // guarda optimista de arriba, para que este UPDATE tampoco corra dos
  // veces si perdió la carrera.
  sentencias.push(
    env.DB_NOTIFICACIONES.prepare(
      `UPDATE participantes SET horas_totales_historicas = horas_totales_historicas + horas_semana_actual, horas_semana_actual = 0
       WHERE competencia_id = ?
         AND (SELECT ultimo_cierre_en FROM competencias WHERE id = ?) = ?`
    ).bind(competencia.id, competencia.id, valorLeido)
  );
  // El reclamo en sí: avanza ultimo_cierre_en SOLO si sigue valiendo lo
  // mismo que se leyó al entrar a esta función. El que pierde la carrera
  // ve esta sentencia (y las de arriba) afectar 0 filas.
  sentencias.push(
    env.DB_NOTIFICACIONES.prepare("UPDATE competencias SET ultimo_cierre_en = ? WHERE id = ? AND ultimo_cierre_en = ?").bind(
      lunesUtcMs,
      competencia.id,
      valorLeido
    )
  );

  await env.DB_NOTIFICACIONES.batch(sentencias);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origen = request.headers.get("Origin") || "";

    // Soporte con IA de la página de info (rutas /soporte/chat y /soporte/ticket).
    const respuestaSoporte = await manejarSoporte(request, env);
    if (respuestaSoporte) return respuestaSoporte;

    // 2026-10-14: los CSV públicos de analítica (que usaba Google Sheets con
    // IMPORTDATA) se cerraron. La lectura ahora es GET /analitica/panel y
    // exige iniciar sesión con Google con un correo de ANALITICA_ADMIN_CORREOS.

    // Preflight CORS.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: encabezadosCors(origen) });
    }

    // El origen debe coincidir exacto con el dominio real de la app en
    // CUALQUIER endpoint — se corta acá antes de nada si no matchea.
    if (!origenPermitido(origen)) {
      return respuestaJson({ error: "Origen no permitido." }, 403, origen);
    }

    // Autenticación de usuario para las rutas privadas de Competencias.
    const requiereIdentidad =
      (url.pathname.startsWith("/competencias") && request.method !== "GET") ||
      (url.pathname.startsWith("/identificadores/") && request.method === "GET");
    if (requiereIdentidad) {
      const identidad = await verificarUsuarioGoogle(request);
      if (!identidad.ok) return respuestaJson({ error: identidad.error }, identidad.status, origen);
      const claveLimite = `${identidad.correo}:${url.pathname.split("/").slice(0, 3).join("/")}`;
      const resultadoLimite = await env.COMPETENCIAS_RATE_LIMIT.limit({ key: claveLimite });
      if (!resultadoLimite.success) return respuestaJson({ error: "Demasiadas solicitudes. Intenta de nuevo en un minuto." }, 429, origen);
      if (url.pathname.startsWith("/identificadores/")) {
        let correoSolicitado = "";
        try { correoSolicitado = decodeURIComponent(url.pathname.split("/")[2]).toLowerCase(); } catch (_) {}
        if (correoSolicitado !== identidad.correo) return respuestaJson({ error: "No puedes consultar otra cuenta." }, 403, origen);
      } else if (request.method !== "GET") {
        let cuerpo;
        try { cuerpo = await request.clone().json(); } catch (_) { cuerpo = null; }
        if (cuerpo?.identificador_usuario && String(cuerpo.identificador_usuario).toLowerCase() !== identidad.correo) {
          return respuestaJson({ error: "La cuenta autenticada no coincide con el usuario solicitado." }, 403, origen);
        }
      }
    }

    if (request.method === "POST" && url.pathname === "/analitica/demo-apertura") {
      return manejarRegistrarAperturaDemo(env, origen);
    }

    if (request.method === "GET" && url.pathname === "/analitica/panel") {
      return manejarPanelAnalitica(request, env, origen);
    }

    if (request.method === "GET" && url.pathname === "/analitica/flujos") {
      return manejarPanelFlujos(request, env, origen);
    }

    if (request.method === "POST" && url.pathname === "/analitica/consentimiento") {
      const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
      const limiteAnalitica = await env.ANALITICA_RATE_LIMIT.limit({ key: ip });
      if (!limiteAnalitica.success) return respuestaJson({ error: "Demasiadas solicitudes." }, 429, origen);
      return manejarConsentimientoAnalitica(request, env, origen);
    }

    if (request.method === "POST" && url.pathname === "/analitica/flujo") {
      const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
      const limiteAnalitica = await env.ANALITICA_RATE_LIMIT.limit({ key: ip });
      if (!limiteAnalitica.success) return respuestaJson({ error: "Demasiadas solicitudes." }, 429, origen);
      return manejarRegistrarFlujoAnalitica(request, env, origen);
    }

    if (request.method === "POST" && url.pathname === "/analitica/ia") {
      return manejarAnalisisIA(request, env, origen);
    }

    if (request.method === "GET" && url.pathname === "/avisos/activos") return manejarAvisosActivos(request, env, origen);
    if (request.method === "POST" && url.pathname === "/avisos/estado") return manejarEstadoAviso(request, env, origen);
    if (url.pathname === "/avisos/admin" && ["GET", "POST"].includes(request.method)) return manejarAdminAvisos(request, env, origen);
    if (url.pathname.startsWith("/avisos/admin/") && ["POST", "DELETE"].includes(request.method)) {
      const avisoId = decodeURIComponent(url.pathname.slice("/avisos/admin/".length));
      return manejarAdminAvisos(request, env, origen, avisoId);
    }

    if (request.method === "POST" && url.pathname === "/analitica/evento") {
      const ip = request.headers.get("CF-Connecting-IP") || "desconocida";
      const limiteAnalitica = await env.ANALITICA_RATE_LIMIT.limit({ key: ip });
      if (!limiteAnalitica.success) return respuestaJson({ error: "Demasiadas solicitudes." }, 429, origen);
      return manejarRegistrarEventoAnalitica(request, env, origen);
    }

    if (request.method === "POST" && url.pathname === "/oauth/exchange") {
      return manejarOAuthExchange(request, env, origen);
    }

    if (request.method === "POST" && url.pathname === "/oauth/refresh") {
      return manejarOAuthRefresh(request, env, origen);
    }

    // Competencias (2026-09-07, Parte 4/4 del spec de Tiempo de Estudio) —
    // rutas con :id parseadas a mano (sin router, mismo estilo del resto
    // del archivo: si/else sobre url.pathname).
    const segmentos = url.pathname.split("/").filter(Boolean);

    if (request.method === "POST" && url.pathname === "/competencias") {
      return manejarCrearCompetencia(request, env, origen);
    }

    // /competencias/:id
    if (segmentos.length === 2 && segmentos[0] === "competencias") {
      const competenciaId = segmentos[1];
      if (request.method === "GET") return manejarObtenerCompetencia(competenciaId, env, origen);
      if (request.method === "DELETE") return manejarBorrarCompetencia(competenciaId, request, env, origen);
    }

    // /competencias/:id/unirse
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "unirse" && request.method === "POST") {
      return manejarUnirseCompetencia(segmentos[1], request, env, origen);
    }

    // /competencias/:id/actualizar-horas
    if (
      segmentos.length === 3 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "actualizar-horas" &&
      request.method === "POST"
    ) {
      return manejarActualizarHoras(segmentos[1], request, env, origen);
    }

    // /competencias/:id/historial
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "historial" && request.method === "GET") {
      return manejarHistorialCompetencia(segmentos[1], env, origen);
    }

    // /competencias/:id/podios — (2026-09-21, podio completo por semana)
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "podios" && request.method === "GET") {
      return manejarPodiosCompetencia(segmentos[1], env, origen);
    }

    // /competencias/:id/resumen — (2026-09-17, Parte 5)
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "resumen" && request.method === "GET") {
      return manejarResumenCompetencia(segmentos[1], env, origen);
    }

    // /competencias/:id/renombrar — (2026-09-17, punto 4.1)
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "renombrar" && request.method === "POST") {
      return manejarRenombrarCompetencia(segmentos[1], request, env, origen);
    }

    // /competencias/:id/estado — finalizar/reactivar (2026-09-17, punto 4.3)
    if (segmentos.length === 3 && segmentos[0] === "competencias" && segmentos[2] === "estado" && request.method === "POST") {
      return manejarCambiarEstadoCompetencia(segmentos[1], request, env, origen);
    }

    // /competencias/:id/delegar-borrado
    if (
      segmentos.length === 3 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "delegar-borrado" &&
      request.method === "POST"
    ) {
      return manejarDelegarBorrado(segmentos[1], request, env, origen);
    }

    // /competencias/:id/participantes/:participanteId — salir uno mismo, o
    // que el creador saque a otro (ver manejarSalirCompetencia).
    if (
      segmentos.length === 4 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "participantes" &&
      request.method === "DELETE"
    ) {
      return manejarSalirCompetencia(segmentos[1], segmentos[3], request, env, origen);
    }

    // /competencias/:id/participantes/:participanteId/apodo — (2026-09-17, punto 4.2)
    if (
      segmentos.length === 5 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "participantes" &&
      segmentos[4] === "apodo" &&
      request.method === "POST"
    ) {
      return manejarCambiarApodo(segmentos[1], segmentos[3], request, env, origen);
    }

    // /competencias/:id/participantes/:participanteId/foto — (2026-09-21)
    if (
      segmentos.length === 5 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "participantes" &&
      segmentos[4] === "foto" &&
      request.method === "POST"
    ) {
      return manejarCambiarFoto(segmentos[1], segmentos[3], request, env, origen);
    }

    // /competencias/:id/participantes/:participanteId/perfil — (2026-09-21, 2.ª ronda)
    if (
      segmentos.length === 5 &&
      segmentos[0] === "competencias" &&
      segmentos[2] === "participantes" &&
      segmentos[4] === "perfil" &&
      request.method === "POST"
    ) {
      return manejarActualizarPerfil(segmentos[1], segmentos[3], request, env, origen);
    }

    // /identificadores/:correo/competencias — (2026-09-22, recuperar
    // historial perdido). El correo va con encodeURIComponent del lado del
    // cliente (puede traer "@"/"." sin problema, pero se decodifica igual
    // por si el proveedor de hosting normaliza el path).
    if (
      segmentos.length === 3 &&
      segmentos[0] === "identificadores" &&
      segmentos[2] === "competencias" &&
      request.method === "GET"
    ) {
      return manejarListarCompetenciasDeUsuario(decodeURIComponent(segmentos[1]), env, origen);
    }

    return respuestaJson({ error: "Not found." }, 404, origen);
  },

  /**
   * Cron cada hora (ver wrangler.toml, reinstalado 2026-09-07 solo para
   * esto). Recorre TODAS las competencias — a la escala de "unos cuantos
   * grupos de amigos" es un table scan trivial, no hace falta indexar
   * nada especial para esta consulta. Por cada una, compara el lunes
   * 00:00 más reciente en la hora local del CREADOR contra
   * `ultimo_cierre_en`: si avanzó, le tocó cerrar semana.
   */
  async scheduled(event, env, ctx) {
    const ahora = Date.now();
    // Los procesos sin cierre tras 30 min se marcan como abandonados. Los
    // eventos detallados se conservan 90 días; los conteos agregados actuales
    // no expiran. Los avisos se activan por ventana de fechas al consultar.
    try {
      await env.DB_NOTIFICACIONES.batch([
        env.DB_NOTIFICACIONES.prepare("UPDATE analitica_flujos SET estado='abandonado', finalizado_en=?, duracion_ms=? - iniciado_en WHERE estado='iniciado' AND ultimo_evento_en <= ?")
          .bind(ahora, ahora, ahora - 30 * 60 * 1000),
        env.DB_NOTIFICACIONES.prepare("DELETE FROM analitica_flujo_eventos WHERE ocurrido_en < ?").bind(ahora - 90 * 86400000),
        env.DB_NOTIFICACIONES.prepare("DELETE FROM analitica_flujos WHERE iniciado_en < ?").bind(ahora - 90 * 86400000),
        env.DB_NOTIFICACIONES.prepare("DELETE FROM aviso_estado_usuario WHERE aviso_id IN (SELECT id FROM avisos_globales WHERE termina_en < ?)").bind(ahora - 90 * 86400000),
        env.DB_NOTIFICACIONES.prepare("DELETE FROM avisos_globales WHERE termina_en < ?").bind(ahora - 180 * 86400000),
        env.DB_NOTIFICACIONES.prepare("DELETE FROM analitica_ia_usos WHERE dia < ?").bind(new Date(ahora - 90 * 86400000).toISOString().slice(0, 10)),
      ]);
    } catch (e) {
      // No permitir que una migración aún no aplicada detenga el cierre de competencias.
      console.error("Error procesando retención de analítica/avisos:", e?.name || "Error");
    }
    // 2026-09-17 (punto 4.3): las finalizadas no cierran semana — están
    // archivadas, no aceptan horas nuevas, y cerrarles semanas vacías solo
    // ensuciaría su historial mientras están guardadas.
    const { results: competencias } = await env.DB_NOTIFICACIONES.prepare(
      "SELECT id, offset_minutos_utc, ultimo_cierre_en FROM competencias WHERE estado IS NULL OR estado != 'finalizada'"
    ).all();

    for (const competencia of competencias || []) {
      const lunesUtcMs = calcularUltimoLunesLocalUtcMs(ahora, competencia.offset_minutos_utc);
      if (lunesUtcMs > competencia.ultimo_cierre_en) {
        try {
          await procesarCierreCompetencia(env, competencia, lunesUtcMs);
        } catch (e) {
          // Una competencia rota no debe frenar el cierre de las demás en
          // la misma corrida.
          console.error("Error cerrando semana de competencia:", e?.name || "Error");
        }
      }
    }
  },
};




