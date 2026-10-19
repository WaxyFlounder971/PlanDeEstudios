-- Amplía la tabla de analítica para nueve columnas de stakeholders.
-- Ejecutar una sola vez, después de migracion_analitica_uso.sql.
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_4 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_5 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_6 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_7 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_8 INTEGER NOT NULL DEFAULT 0;
ALTER TABLE analitica_uso ADD COLUMN conteo_correo_9 INTEGER NOT NULL DEFAULT 0;
