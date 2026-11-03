SET @col_ventas_pedido_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'pedido_id'
);

SET @sql_add_ventas_pedido_id := IF(
  @col_ventas_pedido_id = 0,
  'ALTER TABLE ventas ADD COLUMN pedido_id INT NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_pedido_id FROM @sql_add_ventas_pedido_id;
EXECUTE stmt_add_ventas_pedido_id;
DEALLOCATE PREPARE stmt_add_ventas_pedido_id;

SET @idx_ventas_pedido_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND INDEX_NAME = 'idx_ventas_pedido_id'
);

SET @sql_add_idx_ventas_pedido_id := IF(
  @idx_ventas_pedido_id = 0,
  'ALTER TABLE ventas ADD KEY idx_ventas_pedido_id (pedido_id)',
  'SELECT 1'
);
PREPARE stmt_add_idx_ventas_pedido_id FROM @sql_add_idx_ventas_pedido_id;
EXECUTE stmt_add_idx_ventas_pedido_id;
DEALLOCATE PREPARE stmt_add_idx_ventas_pedido_id;

SET @uq_ventas_pedido_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND INDEX_NAME = 'uq_ventas_pedido_id'
);

SET @sql_add_uq_ventas_pedido_id := IF(
  @uq_ventas_pedido_id = 0,
  'ALTER TABLE ventas ADD UNIQUE KEY uq_ventas_pedido_id (pedido_id)',
  'SELECT 1'
);
PREPARE stmt_add_uq_ventas_pedido_id FROM @sql_add_uq_ventas_pedido_id;
EXECUTE stmt_add_uq_ventas_pedido_id;
DEALLOCATE PREPARE stmt_add_uq_ventas_pedido_id;
