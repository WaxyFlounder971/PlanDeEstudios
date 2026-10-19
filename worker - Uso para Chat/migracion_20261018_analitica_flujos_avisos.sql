-- Nuevas funciones de analítica de procesos y avisos generales.
-- Ejecutar una sola vez contra DB_NOTIFICACIONES antes de desplegar el Worker.
-- No contiene datos ni claves secretas. Los eventos detallados se retienen 90 días.

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
