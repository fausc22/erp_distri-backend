SET @col_productos_es_servicio_flete := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'productos'
    AND COLUMN_NAME = 'es_servicio_flete'
);

SET @sql_add_productos_es_servicio_flete := IF(
  @col_productos_es_servicio_flete = 0,
  'ALTER TABLE productos ADD COLUMN es_servicio_flete BOOL NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE stmt_add_productos_es_servicio_flete FROM @sql_add_productos_es_servicio_flete;
EXECUTE stmt_add_productos_es_servicio_flete;
DEALLOCATE PREPARE stmt_add_productos_es_servicio_flete;
