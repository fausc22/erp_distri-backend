SET @col_ventas_cont_es_flete := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas_cont'
    AND COLUMN_NAME = 'es_flete'
);

SET @sql_add_ventas_cont_es_flete := IF(
  @col_ventas_cont_es_flete = 0,
  'ALTER TABLE ventas_cont ADD COLUMN es_flete BOOL NOT NULL DEFAULT FALSE',
  'SELECT 1'
);
PREPARE stmt_add_ventas_cont_es_flete FROM @sql_add_ventas_cont_es_flete;
EXECUTE stmt_add_ventas_cont_es_flete;
DEALLOCATE PREPARE stmt_add_ventas_cont_es_flete;
