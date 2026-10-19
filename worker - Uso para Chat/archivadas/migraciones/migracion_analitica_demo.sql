-- Un único total agregado. No se guardan datos por visita.
CREATE TABLE IF NOT EXISTS analitica_demo (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  aperturas INTEGER NOT NULL DEFAULT 0
);
