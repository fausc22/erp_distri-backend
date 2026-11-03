SET @col_movimiento_fondos_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'movimiento_fondos'
    AND COLUMN_NAME = 'evento_clave'
);

SET @sql_add_movimiento_fondos_evento_clave := IF(
  @col_movimiento_fondos_evento_clave = 0,
  'ALTER TABLE movimiento_fondos ADD COLUMN evento_clave VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt_add_movimiento_fondos_evento_clave FROM @sql_add_movimiento_fondos_evento_clave;
EXECUTE stmt_add_movimiento_fondos_evento_clave;
DEALLOCATE PREPARE stmt_add_movimiento_fondos_evento_clave;

SET @uq_movimiento_fondos_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'movimiento_fondos'
    AND INDEX_NAME = 'uq_movimiento_fondos_evento_clave'
);

SET @sql_add_uq_movimiento_fondos_evento_clave := IF(
  @uq_movimiento_fondos_evento_clave = 0,
  'ALTER TABLE movimiento_fondos ADD UNIQUE KEY uq_movimiento_fondos_evento_clave (evento_clave)',
  'SELECT 1'
);
PREPARE stmt_add_uq_movimiento_fondos_evento_clave FROM @sql_add_uq_movimiento_fondos_evento_clave;
EXECUTE stmt_add_uq_movimiento_fondos_evento_clave;
DEALLOCATE PREPARE stmt_add_uq_movimiento_fondos_evento_clave;

SET @col_movimiento_stock_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'movimiento_stock'
    AND COLUMN_NAME = 'evento_clave'
);

SET @sql_add_movimiento_stock_evento_clave := IF(
  @col_movimiento_stock_evento_clave = 0,
  'ALTER TABLE movimiento_stock ADD COLUMN evento_clave VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt_add_movimiento_stock_evento_clave FROM @sql_add_movimiento_stock_evento_clave;
EXECUTE stmt_add_movimiento_stock_evento_clave;
DEALLOCATE PREPARE stmt_add_movimiento_stock_evento_clave;

SET @uq_movimiento_stock_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'movimiento_stock'
    AND INDEX_NAME = 'uq_movimiento_stock_evento_clave'
);

SET @sql_add_uq_movimiento_stock_evento_clave := IF(
  @uq_movimiento_stock_evento_clave = 0,
  'ALTER TABLE movimiento_stock ADD UNIQUE KEY uq_movimiento_stock_evento_clave (evento_clave)',
  'SELECT 1'
);
PREPARE stmt_add_uq_movimiento_stock_evento_clave FROM @sql_add_uq_movimiento_stock_evento_clave;
EXECUTE stmt_add_uq_movimiento_stock_evento_clave;
DEALLOCATE PREPARE stmt_add_uq_movimiento_stock_evento_clave;

SET @col_remitos_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'remitos'
    AND COLUMN_NAME = 'evento_clave'
);

SET @sql_add_remitos_evento_clave := IF(
  @col_remitos_evento_clave = 0,
  'ALTER TABLE remitos ADD COLUMN evento_clave VARCHAR(80) NULL',
  'SELECT 1'
);
PREPARE stmt_add_remitos_evento_clave FROM @sql_add_remitos_evento_clave;
EXECUTE stmt_add_remitos_evento_clave;
DEALLOCATE PREPARE stmt_add_remitos_evento_clave;

SET @uq_remitos_evento_clave := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'remitos'
    AND INDEX_NAME = 'uq_remitos_evento_clave'
);

SET @sql_add_uq_remitos_evento_clave := IF(
  @uq_remitos_evento_clave = 0,
  'ALTER TABLE remitos ADD UNIQUE KEY uq_remitos_evento_clave (evento_clave)',
  'SELECT 1'
);
PREPARE stmt_add_uq_remitos_evento_clave FROM @sql_add_uq_remitos_evento_clave;
EXECUTE stmt_add_uq_remitos_evento_clave;
DEALLOCATE PREPARE stmt_add_uq_remitos_evento_clave;
