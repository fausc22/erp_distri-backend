SET @col_ventas_estado_fiscal := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'estado_fiscal'
);

SET @sql_add_ventas_estado_fiscal := IF(
  @col_ventas_estado_fiscal = 0,
  'ALTER TABLE ventas ADD COLUMN estado_fiscal ENUM(''NO_APLICA'',''SIN_SOLICITUD'',''EN_CURSO'',''RECHAZADO'',''DESCONOCIDO'',''AUTORIZADO'') NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_estado_fiscal FROM @sql_add_ventas_estado_fiscal;
EXECUTE stmt_add_ventas_estado_fiscal;
DEALLOCATE PREPARE stmt_add_ventas_estado_fiscal;

SET @col_ventas_estado_conciliacion := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'estado_conciliacion'
);

SET @sql_add_ventas_estado_conciliacion := IF(
  @col_ventas_estado_conciliacion = 0,
  'ALTER TABLE ventas ADD COLUMN estado_conciliacion ENUM(''NO_EVALUADO'',''CONCILIADO'',''DISCREPANTE'',''EVIDENCIA_INCOMPLETA'',''CONFLICTO'') NOT NULL DEFAULT ''NO_EVALUADO''',
  'SELECT 1'
);
PREPARE stmt_add_ventas_estado_conciliacion FROM @sql_add_ventas_estado_conciliacion;
EXECUTE stmt_add_ventas_estado_conciliacion;
DEALLOCATE PREPARE stmt_add_ventas_estado_conciliacion;

SET @col_ventas_autorizacion_id := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND COLUMN_NAME = 'autorizacion_id'
);

SET @sql_add_ventas_autorizacion_id := IF(
  @col_ventas_autorizacion_id = 0,
  'ALTER TABLE ventas ADD COLUMN autorizacion_id INT NULL',
  'SELECT 1'
);
PREPARE stmt_add_ventas_autorizacion_id FROM @sql_add_ventas_autorizacion_id;
EXECUTE stmt_add_ventas_autorizacion_id;
DEALLOCATE PREPARE stmt_add_ventas_autorizacion_id;

SET @idx_ventas_autorizacion_id := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND INDEX_NAME = 'idx_ventas_autorizacion_id'
);

SET @sql_add_idx_ventas_autorizacion_id := IF(
  @idx_ventas_autorizacion_id = 0,
  'ALTER TABLE ventas ADD KEY idx_ventas_autorizacion_id (autorizacion_id)',
  'SELECT 1'
);
PREPARE stmt_add_idx_ventas_autorizacion_id FROM @sql_add_idx_ventas_autorizacion_id;
EXECUTE stmt_add_idx_ventas_autorizacion_id;
DEALLOCATE PREPARE stmt_add_idx_ventas_autorizacion_id;

SET @fk_ventas_autorizacion := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'ventas'
    AND CONSTRAINT_NAME = 'FK_ventas_autorizacion'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

-- FOREIGN_KEY_CHECKS=0: ALTER que reconstruye la tabla revalida FKs existentes;
-- esta copia puede tener ventas.cliente_id huérfanos que no deben bloquear una FK nullable nueva.
SET @sql_add_fk_ventas_autorizacion := IF(
  @fk_ventas_autorizacion = 0,
  'ALTER TABLE ventas ADD CONSTRAINT FK_ventas_autorizacion FOREIGN KEY (autorizacion_id) REFERENCES arca_autorizaciones_canonicas(id) ON DELETE RESTRICT',
  'SELECT 1'
);
SET FOREIGN_KEY_CHECKS = 0;
PREPARE stmt_add_fk_ventas_autorizacion FROM @sql_add_fk_ventas_autorizacion;
EXECUTE stmt_add_fk_ventas_autorizacion;
DEALLOCATE PREPARE stmt_add_fk_ventas_autorizacion;
SET FOREIGN_KEY_CHECKS = 1;
