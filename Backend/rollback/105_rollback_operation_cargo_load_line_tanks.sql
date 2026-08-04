-- Rollback companion for 105_operation_cargo_load_line_tanks.sql

BEGIN;

DROP TABLE IF EXISTS operation_cargo_load_line_tanks;

COMMIT;
