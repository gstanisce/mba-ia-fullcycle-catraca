-- Harness baseline. Features add files prefixed with their feature number to avoid
-- name collisions between parallel branches: F01 -> 01x_*.sql, F02 -> 02x_*.sql, ..., F07 -> 07x_*.sql.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
