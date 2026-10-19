-- =========================================================================
-- migracion_competencias_podio.sql — 2026-09-21 (rediseño: podio + fotos)
-- Aplicar ANTES de desplegar el nuevo index.js:
--   wrangler d1 execute <NOMBRE_DB> --remote --file=migracion_competencias_podio.sql
-- Correr UNA sola vez (el ALTER TABLE falla si la columna ya existe).
-- =========================================================================

-- 1) Foto de cada participante (URL https de la foto de Google). NULL = sin
--    foto → el cliente muestra la inicial.
ALTER TABLE participantes ADD COLUMN foto_url TEXT;

-- 2) Podio COMPLETO de cada semana cerrada (todos los participantes, con su
--    puesto). historial_ganadores sigue igual y sigue escribiéndose.
--    `apodo` y `horas` son copias congeladas del momento del cierre; la foto
--    NO se copia (se lee viva desde participantes, así se actualiza sola).
--    Sin FK a propósito: si alguien sale de la competencia, su fila del
--    historial se conserva (mismo criterio que historial_ganadores).
CREATE TABLE IF NOT EXISTS historial_resultados (
  id                TEXT PRIMARY KEY,
  competencia_id    TEXT NOT NULL,
  semana_cerrada_en INTEGER NOT NULL,
  participante_id   TEXT NOT NULL,
  apodo             TEXT NOT NULL,
  horas             REAL NOT NULL DEFAULT 0,
  puesto            INTEGER NOT NULL,
  UNIQUE (competencia_id, semana_cerrada_en, participante_id)
);

CREATE INDEX IF NOT EXISTS idx_historial_resultados_comp_semana
  ON historial_resultados (competencia_id, semana_cerrada_en DESC, puesto);
