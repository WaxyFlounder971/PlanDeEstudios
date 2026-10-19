-- =========================================================================
-- schema.sql — tabla única del Worker de notificaciones (D1)
-- -------------------------------------------------------------------------
-- Se aplica una sola vez, contra la base D1 ya creada, con:
--   npx wrangler d1 execute DB_NOTIFICACIONES --remote --file=./schema.sql
-- (ver README.md, paso 3).
-- =========================================================================

CREATE TABLE IF NOT EXISTS recordatorios (
  id TEXT PRIMARY KEY,
  suscripcion_push TEXT NOT NULL,   -- JSON.stringify() de la PushSubscription completa
  fecha_hora_utc INTEGER NOT NULL,  -- timestamp Unix (segundos) de cuándo debe dispararse
  titulo TEXT NOT NULL,
  cuerpo TEXT,
  enviado INTEGER DEFAULT 0
);

-- El cron consulta siempre por (enviado, fecha_hora_utc) juntos — ver
-- src/index.js, manejadorProgramado() — así que un índice compuesto evita
-- un table scan completo en cada corrida (cada 1 minuto).
CREATE INDEX IF NOT EXISTS idx_recordatorios_pendientes
  ON recordatorios (enviado, fecha_hora_utc);

-- =========================================================================
-- Ronda 2026-08-23 — Bandeja pendiente (captura por voz/Atajo de Siri)
-- -------------------------------------------------------------------------
-- NOTA: este archivo, tal como estaba antes de esta ronda, ya no reflejaba
-- el esquema real de la base (faltaban `eventos_activos` y
-- `resumen_config`, agregadas en la ronda 2025-08-20 — ver src/index.js
-- para su definición real). Si vas a aplicar este archivo contra una base
-- NUEVA desde cero, agregá también esas dos tablas a mano antes de correr
-- el Worker; si es la base que ya tenés en producción, con aplicar solo
-- el bloque de abajo alcanza (CREATE TABLE/INDEX son idempotentes con
-- IF NOT EXISTS).
-- =========================================================================

CREATE TABLE IF NOT EXISTS bandeja_pendiente (
  id TEXT PRIMARY KEY,
  id_bandeja TEXT NOT NULL,
  texto TEXT,
  audio_base64 TEXT,
  creado_en INTEGER NOT NULL  -- timestamp Unix (segundos), misma convención que fecha_hora_utc de arriba
);

-- GET /bandeja/:id_bandeja filtra por id_bandeja y ordena por creado_en; la
-- limpieza (manejarLimpiezaBandeja) filtra solo por creado_en — este índice
-- compuesto cubre bien el primer caso (el más frecuente, corre en cada
-- apertura/sync de la app) y sigue sirviendo de índice parcial para el
-- segundo.
CREATE INDEX IF NOT EXISTS idx_bandeja_pendiente_buzon
  ON bandeja_pendiente (id_bandeja, creado_en);

-- =========================================================================
-- Ronda 2026-09-07 — Competencias de tiempo de estudio (Parte 4/4 del spec
-- de Tiempo de Estudio, PARTE A del prompt)
-- -------------------------------------------------------------------------
-- Primera vez que este Worker guarda estado COMPARTIDO entre usuarios
-- distintos (todo lo demás en este archivo es por-usuario o
-- infraestructura). Info de bajo riesgo nada más: apodo + horas totales de
-- la semana + el correo de Google como llave de identidad interna (el
-- cliente nunca manda qué materia se estudió, ni notas, ni nada del JSON
-- de Drive) — `identificador_usuario` se guarda tal cual (decisión del
-- dueño del proyecto: "entre amigos", ver hilo de diseño), pero ningún
-- endpoint GET lo devuelve — el marcador solo expone `apodo`.
--
-- El corte semanal está ANCLADO AL CREADOR de cada competencia, no a cada
-- participante por separado (simplifica quién es "el ganador de la
-- semana" cuando hay gente en husos horarios distintos): por eso
-- `offset_minutos_utc` y `ultimo_cierre_en` viven en `competencias`, no en
-- `participantes`. El `offset_minutos_utc` de cada PARTICIPANTE se guarda
-- igual (informativo, ej. para mostrar "tu hora local" más adelante) pero
-- el cron de `scheduled()` en src/index.js nunca lo lee para decidir
-- cuándo cerrar.
-- =========================================================================

CREATE TABLE IF NOT EXISTS competencias (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  token_creador TEXT NOT NULL,        -- generado server-side al crear, se devuelve UNA vez en la respuesta de POST /competencias; el cliente lo guarda en localStorage y es lo único que autoriza DELETE /competencias/:id
  offset_minutos_utc INTEGER NOT NULL DEFAULT 0,  -- huso horario LOCAL del creador al momento de crear la competencia; ancla el corte semanal de TODA la competencia
  ultimo_cierre_en INTEGER NOT NULL,  -- epoch ms del último lunes 00:00 (hora local del creador) ya procesado por el cron — evita reprocesar el mismo cierre 2 veces si scheduled() corre más de una vez en la ventana
  creado_en INTEGER NOT NULL,
  estado TEXT NOT NULL DEFAULT 'activa'  -- 'activa' | 'finalizada' (2026-09-17, punto 4.3) — finalizada NO borra nada: deja de aceptar horas/gente nueva y el cron la saltea, y se puede volver a 'activa' cuando se quiera
);

CREATE TABLE IF NOT EXISTS participantes (
  id TEXT PRIMARY KEY,
  competencia_id TEXT NOT NULL,
  apodo TEXT NOT NULL,
  identificador_usuario TEXT NOT NULL,  -- estado.datos.perfil.correo del cliente, tal cual
  horas_semana_actual REAL NOT NULL DEFAULT 0,
  horas_totales_historicas REAL NOT NULL DEFAULT 0,  -- 2026-09-17 (Parte 5): acumulado de POR VIDA. Se incrementa en procesarCierreCompetencia() en el mismo UPDATE que resetea horas_semana_actual — `historial_ganadores` solo guarda al ganador de cada semana, así que sin esto no hay forma de sumar las horas de todos los participantes en toda la vida de la competencia
  offset_minutos_utc INTEGER NOT NULL DEFAULT 0,  -- informativo, ver nota de arriba — el cron NO lo usa
  token_creador_pendiente TEXT,  -- buzón de delegación del permiso de borrado (ver migracion_delegacion.sql y manejarDelegarBorrado en src/index.js); NULL salvo que haya una delegación esperando a que ese dispositivo sincronice
  UNIQUE (competencia_id, identificador_usuario)  -- una persona no puede unirse 2 veces a la misma competencia
);

CREATE INDEX IF NOT EXISTS idx_participantes_competencia
  ON participantes (competencia_id);

CREATE TABLE IF NOT EXISTS historial_ganadores (
  id TEXT PRIMARY KEY,
  competencia_id TEXT NOT NULL,
  participante_id TEXT NOT NULL,
  apodo TEXT NOT NULL,   -- se copia tal cual estaba al momento del cierre, no es un FK vivo — si el participante se sale o cambia de apodo después, el historial no se altera
  horas REAL NOT NULL,
  semana_cerrada_en INTEGER NOT NULL  -- epoch ms del lunes 00:00 local-del-creador que cerró esa semana (mismo valor que quedó en competencias.ultimo_cierre_en en ese momento)
);

-- GET /competencias/:id/historial ordena por semana_cerrada_en DESC — este
-- índice cubre esa consulta sin table scan.
CREATE INDEX IF NOT EXISTS idx_historial_competencia
  ON historial_ganadores (competencia_id, semana_cerrada_en);

-- Conteo acumulado de aperturas de la demo pública. No guarda IP, usuario,
-- fecha individual ni navegación: solo un contador global.
CREATE TABLE IF NOT EXISTS analitica_demo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  aperturas INTEGER NOT NULL DEFAULT 0
);

-- Contadores agregados por sección y tipo de función. Cada interacción
-- incrementa una sola columna; no guarda correos ni filas por visita.
CREATE TABLE IF NOT EXISTS analitica_uso (
  seccion TEXT NOT NULL,
  funcion TEXT NOT NULL,
  conteo_general INTEGER NOT NULL DEFAULT 0,
  conteo_correo_1 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_2 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_3 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_4 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_5 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_6 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_7 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_8 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_9 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (seccion, funcion)
);

-- Analítica de recorridos: eventos de proceso sin texto escrito ni correo.
-- El Worker calcula usuario_hash mediante HMAC y conserva detalle 90 días.
CREATE TABLE IF NOT EXISTS analitica_flujos (
  id TEXT PRIMARY KEY,
  usuario_hash TEXT NOT NULL,
  sesion_id TEXT NOT NULL,
  proceso TEXT NOT NULL,
  seccion TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'iniciado' CHECK (estado IN ('iniciado','completado','cancelado','error','abandonado')),
  iniciado_en INTEGER NOT NULL,
  ultimo_evento_en INTEGER NOT NULL,
  finalizado_en INTEGER,
  duracion_ms INTEGER,
  version_app TEXT
);
CREATE INDEX IF NOT EXISTS idx_analitica_flujos_fecha ON analitica_flujos (iniciado_en);
CREATE INDEX IF NOT EXISTS idx_analitica_flujos_reporte ON analitica_flujos (proceso, iniciado_en, estado);
CREATE INDEX IF NOT EXISTS idx_analitica_flujos_usuario ON analitica_flujos (usuario_hash, iniciado_en);

CREATE TABLE IF NOT EXISTS analitica_flujo_eventos (
  id TEXT PRIMARY KEY,
  flujo_id TEXT NOT NULL,
  usuario_hash TEXT NOT NULL,
  proceso TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('iniciado','paso','completado','cancelado','error')),
  paso TEXT NOT NULL,
  ocurrido_en INTEGER NOT NULL,
  duracion_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_analitica_eventos_flujo ON analitica_flujo_eventos (flujo_id, ocurrido_en);
CREATE INDEX IF NOT EXISTS idx_analitica_eventos_fecha ON analitica_flujo_eventos (ocurrido_en);

CREATE TABLE IF NOT EXISTS analitica_consentimientos (
  usuario_hash TEXT PRIMARY KEY,
  aceptado INTEGER NOT NULL DEFAULT 0 CHECK (aceptado IN (0,1)),
  actualizado_en INTEGER NOT NULL
);

-- Avisos generales visibles al iniciar/volver a abrir la app con conexión.
-- No es push: la app consulta este tablero al estar activa.
CREATE TABLE IF NOT EXISTS avisos_globales (
  id TEXT PRIMARY KEY,
  titulo TEXT NOT NULL,
  cuerpo TEXT NOT NULL,
  inicia_en INTEGER NOT NULL,
  termina_en INTEGER NOT NULL,
  max_vistas INTEGER NOT NULL DEFAULT 1 CHECK (max_vistas BETWEEN 1 AND 20),
  accion TEXT NOT NULL DEFAULT 'entendido' CHECK (accion IN ('entendido','aceptar','continuar','cerrar')),
  destino TEXT,
  activo INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0,1)),
  creado_en INTEGER NOT NULL,
  actualizado_en INTEGER NOT NULL,
  creado_por TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_avisos_globales_activos ON avisos_globales (activo, inicia_en, termina_en);

CREATE TABLE IF NOT EXISTS aviso_estado_usuario (
  aviso_id TEXT NOT NULL,
  usuario_hash TEXT NOT NULL,
  vistas INTEGER NOT NULL DEFAULT 0,
  ultima_vista_en INTEGER,
  confirmado_en INTEGER,
  PRIMARY KEY (aviso_id, usuario_hash)
);
CREATE INDEX IF NOT EXISTS idx_aviso_estado_usuario_hash ON aviso_estado_usuario (usuario_hash);

CREATE TABLE IF NOT EXISTS analitica_ia_usos (
  dia TEXT NOT NULL,
  usuario_hash TEXT NOT NULL,
  cantidad INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, usuario_hash)
);

-- =========================================================================
-- Ronda 2026-09-17 — Gestión de competencias (Parte 4) + Registro de
-- finalizadas (Parte 5)
-- -------------------------------------------------------------------------
-- Esta ronda NO agrega tablas: solo 2 columnas, que arriba ya quedaron
-- incorporadas a los CREATE TABLE de `competencias` (`estado`) y
-- `participantes` (`horas_totales_historicas`), más `token_creador_pendiente`
-- que venía suelta en migracion_delegacion.sql y faltaba reflejar acá.
--
-- Contra una base NUEVA: alcanza con este archivo, ya están todas.
-- Contra la base que YA está en producción: los CREATE TABLE de arriba son
-- no-ops (IF NOT EXISTS), así que las columnas hay que agregarlas con las
-- migraciones incrementales, en este orden:
--   1) migracion_delegacion.sql              (ronda anterior, si no se aplicó)
--   2) migracion_competencias_gestion.sql    (esta ronda)
-- =========================================================================
