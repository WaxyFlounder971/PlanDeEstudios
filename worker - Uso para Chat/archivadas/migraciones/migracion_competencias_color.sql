-- =========================================================================
-- migracion_competencias_color.sql — 2026-09-21 (2.ª ronda: color en el podio)
-- Aplicar ANTES de desplegar el index.js nuevo. Una sola vez.
--   npx wrangler d1 execute db-notificaciones-agenda --remote --file=migracion_competencias_color.sql
-- =========================================================================

-- Color de acento de la paleta de cada usuario (hex #rrggbb). NULL = sin
-- color → el cliente usa los colores dorado/plata/bronce de siempre.
ALTER TABLE participantes ADD COLUMN color TEXT;
