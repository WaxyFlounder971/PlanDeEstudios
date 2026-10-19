-- =========================================================================
-- migracion_competencias_gestion.sql
-- Ronda 2026-09-17 — Gestión de competencias (Parte 4) + Registro de
-- competencias finalizadas (Parte 5).
-- -------------------------------------------------------------------------
-- Aplicar ANTES de desplegar la versión nueva de src/index.js: el Worker
-- nuevo hace SELECT/UPDATE de estas dos columnas desde el primer request
-- (GET /competencias/:id ya devuelve `estado`), así que si se despliega
-- primero el código, todos esos endpoints tiran error de SQL hasta que
-- corra esto.
--
--   npx wrangler d1 execute DB_NOTIFICACIONES --remote --file=./migracion_competencias_gestion.sql
--
-- Mismo criterio de una-sola-vez que migracion_delegacion.sql (SQLite no
-- tiene "ADD COLUMN IF NOT EXISTS": si ya se aplicó, la segunda corrida
-- falla con "duplicate column name" y hay que ignorar ese error puntual).
-- =========================================================================

-- Punto 4.3 — "Finalizar competencia" es REVERSIBLE y no borra nada: la
-- competencia archivada deja de aceptar horas/participantes nuevos y el
-- cron la saltea, pero sus filas de `participantes` e `historial_ganadores`
-- quedan intactas, que es justo lo que consume el Registro (Parte 5).
-- El DEFAULT cubre todas las competencias que ya existen: quedan activas,
-- exactamente como estaban antes de esta ronda.
ALTER TABLE competencias ADD COLUMN estado TEXT NOT NULL DEFAULT 'activa';

-- Parte 5 — acumulador de horas de por vida, por participante.
-- `historial_ganadores` solo guarda al GANADOR de cada semana, así que sin
-- esta columna no hay forma de responder "horas totales estudiadas entre
-- TODOS los participantes en toda la vida de la competencia": lo de los
-- perdedores se perdía en el reset semanal.
-- Se incrementa en `procesarCierreCompetencia` (src/index.js), en el mismo
-- UPDATE que resetea `horas_semana_actual`, para que no puedan quedar
-- desincronizados si algo falla entre medio.
-- OJO: arranca en 0 para todos — lo estudiado ANTES de esta migración no se
-- puede recuperar (ya se había reseteado sin guardarse en ningún lado). Las
-- competencias viejas van a mostrar un total de por vida que en realidad
-- cuenta desde acá en adelante.
ALTER TABLE participantes ADD COLUMN horas_totales_historicas REAL NOT NULL DEFAULT 0;
