-- Idempotencia atómica de pedidos (PWA offline + reintentos concurrentes).
-- Agrega UNIQUE en pedidos.hash_pedido solo si no hay duplicados previos.
-- InnoDB permite múltiples NULL en UNIQUE: pedidos históricos sin hash no se ven afectados.
-- Ejecutar manualmente contra la base (local / producción). No se corre automáticamente.

-- Verificar si ya existe el índice UNIQUE
SET @has_uk_hash := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'pedidos'
    AND index_name = 'uk_pedidos_hash_pedido'
);

-- Contar hashes duplicados no nulos
SET @dupes_hash := (
  SELECT COUNT(*)
  FROM (
    SELECT hash_pedido
    FROM pedidos
    WHERE hash_pedido IS NOT NULL
      AND hash_pedido <> ''
    GROUP BY hash_pedido
    HAVING COUNT(*) > 1
  ) dupes
);

SET @sql_add_uk_hash := IF(
  @has_uk_hash > 0,
  'SELECT ''uk_pedidos_hash_pedido ya existe'' AS info',
  IF(
    @dupes_hash > 0,
    'SELECT ''No se crea UNIQUE(hash_pedido): hay duplicados no nulos en pedidos.hash_pedido. Limpiar y reintentar.'' AS warning',
    'ALTER TABLE pedidos ADD UNIQUE KEY uk_pedidos_hash_pedido (hash_pedido)'
  )
);
PREPARE stmt_add_uk_hash FROM @sql_add_uk_hash;
EXECUTE stmt_add_uk_hash;
DEALLOCATE PREPARE stmt_add_uk_hash;

-- Opcional: eliminar índices no-únicos redundantes (el UNIQUE ya sirve para búsquedas).
-- Descomentar solo si se desea limpiar índices duplicados.
--
-- SET @has_idx_hash := (
--   SELECT COUNT(*)
--   FROM information_schema.statistics
--   WHERE table_schema = DATABASE()
--     AND table_name = 'pedidos'
--     AND index_name = 'idx_hash_pedido'
-- );
-- SET @sql_drop_idx_hash := IF(
--   @has_idx_hash > 0,
--   'ALTER TABLE pedidos DROP INDEX idx_hash_pedido',
--   'SELECT ''idx_hash_pedido no existe'' AS info'
-- );
-- PREPARE stmt_drop_idx_hash FROM @sql_drop_idx_hash;
-- EXECUTE stmt_drop_idx_hash;
-- DEALLOCATE PREPARE stmt_drop_idx_hash;
--
-- SET @has_idx_pedidos_hash := (
--   SELECT COUNT(*)
--   FROM information_schema.statistics
--   WHERE table_schema = DATABASE()
--     AND table_name = 'pedidos'
--     AND index_name = 'idx_pedidos_hash_pedido'
-- );
-- SET @sql_drop_idx_pedidos_hash := IF(
--   @has_idx_pedidos_hash > 0,
--   'ALTER TABLE pedidos DROP INDEX idx_pedidos_hash_pedido',
--   'SELECT ''idx_pedidos_hash_pedido no existe'' AS info'
-- );
-- PREPARE stmt_drop_idx_pedidos_hash FROM @sql_drop_idx_pedidos_hash;
-- EXECUTE stmt_drop_idx_pedidos_hash;
-- DEALLOCATE PREPARE stmt_drop_idx_pedidos_hash;

-- Verificar resultado
SELECT
  INDEX_NAME,
  NON_UNIQUE,
  COLUMN_NAME
FROM information_schema.statistics
WHERE table_schema = DATABASE()
  AND table_name = 'pedidos'
  AND column_name = 'hash_pedido'
ORDER BY INDEX_NAME, SEQ_IN_INDEX;
