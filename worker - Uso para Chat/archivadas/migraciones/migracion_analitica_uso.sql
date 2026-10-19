-- Contadores agregados por sección y categoría de función.
-- No contiene datos identificables ni guarda eventos individuales.
CREATE TABLE IF NOT EXISTS analitica_uso (
  seccion TEXT NOT NULL,
  funcion TEXT NOT NULL,
  conteo_general INTEGER NOT NULL DEFAULT 0,
  conteo_correo_1 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_2 INTEGER NOT NULL DEFAULT 0,
  conteo_correo_3 INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (seccion, funcion)
);
