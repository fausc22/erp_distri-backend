SET @col_arca_log_cbte_nro_reservado := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'arca_solicitudes_log'
    AND COLUMN_NAME = 'cbte_nro_reservado'
);

SET @sql_add_arca_log_cbte_nro_reservado := IF(
  @col_arca_log_cbte_nro_reservado = 0,
  'ALTER TABLE arca_solicitudes_log ADD COLUMN cbte_nro_reservado INT NULL',
  'SELECT 1'
);
PREPARE stmt_add_arca_log_cbte_nro_reservado FROM @sql_add_arca_log_cbte_nro_reservado;
EXECUTE stmt_add_arca_log_cbte_nro_reservado;
DEALLOCATE PREPARE stmt_add_arca_log_cbte_nro_reservado;

SET @col_arca_log_serie_clave := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'arca_solicitudes_log'
    AND COLUMN_NAME = 'serie_clave'
);

SET @sql_add_arca_log_serie_clave := IF(
  @col_arca_log_serie_clave = 0,
  'ALTER TABLE arca_solicitudes_log ADD COLUMN serie_clave VARCHAR(100) NULL',
  'SELECT 1'
);
PREPARE stmt_add_arca_log_serie_clave FROM @sql_add_arca_log_serie_clave;
EXECUTE stmt_add_arca_log_serie_clave;
DEALLOCATE PREPARE stmt_add_arca_log_serie_clave;
