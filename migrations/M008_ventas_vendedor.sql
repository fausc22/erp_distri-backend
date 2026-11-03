SET @col_ventas_vendedor_atribuible_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'vendedor_atribuible_id'
);

SET @sql_add_ventas_vendedor_atribuible_id := IF(
  @col_ventas_vendedor_atribuible_id = 0,
  'ALTER TABLE ventas ADD COLUMN vendedor_atribuible_id INT NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_vendedor_atribuible_id FROM @sql_add_ventas_vendedor_atribuible_id;
EXECUTE stmt_add_ventas_vendedor_atribuible_id;
DEALLOCATE PREPARE stmt_add_ventas_vendedor_atribuible_id;

SET @col_ventas_vendedor_atribuible_origen := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'vendedor_atribuible_origen'
);

SET @sql_add_ventas_vendedor_atribuible_origen := IF(
  @col_ventas_vendedor_atribuible_origen = 0,
  'ALTER TABLE ventas ADD COLUMN vendedor_atribuible_origen ENUM(''propio'',''referencia'',''asignacion_explicita'',''sin_atribucion'') NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_vendedor_atribuible_origen FROM @sql_add_ventas_vendedor_atribuible_origen;
EXECUTE stmt_add_ventas_vendedor_atribuible_origen;
DEALLOCATE PREPARE stmt_add_ventas_vendedor_atribuible_origen;

SET @col_ventas_usuario_emisor_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'usuario_emisor_id'
);

SET @sql_add_ventas_usuario_emisor_id := IF(
  @col_ventas_usuario_emisor_id = 0,
  'ALTER TABLE ventas ADD COLUMN usuario_emisor_id INT NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_usuario_emisor_id FROM @sql_add_ventas_usuario_emisor_id;
EXECUTE stmt_add_ventas_usuario_emisor_id;
DEALLOCATE PREPARE stmt_add_ventas_usuario_emisor_id;

SET @idx_ventas_vendedor_atribuible := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND INDEX_NAME = 'idx_ventas_vendedor_atribuible'
);

SET @sql_add_idx_ventas_vendedor_atribuible := IF(
  @idx_ventas_vendedor_atribuible = 0,
  'ALTER TABLE ventas ADD KEY idx_ventas_vendedor_atribuible (vendedor_atribuible_id)',
  'SELECT 1'
);
PREPARE stmt_add_idx_ventas_vendedor_atribuible FROM @sql_add_idx_ventas_vendedor_atribuible;
EXECUTE stmt_add_idx_ventas_vendedor_atribuible;
DEALLOCATE PREPARE stmt_add_idx_ventas_vendedor_atribuible;
