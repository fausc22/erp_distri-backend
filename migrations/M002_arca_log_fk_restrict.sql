-- M002: impedir borrado en cascada de evidencia fiscal
-- Requiere que la BD tenga la FK arca_solicitudes_log_ibfk_1.
-- Verificar con: SELECT CONSTRAINT_NAME, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS
--   WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'arca_solicitudes_log';

SET @fk_exists := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'arca_solicitudes_log'
    AND CONSTRAINT_NAME = 'arca_solicitudes_log_ibfk_1'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql_drop := IF(
  @fk_exists > 0,
  'ALTER TABLE arca_solicitudes_log DROP FOREIGN KEY arca_solicitudes_log_ibfk_1',
  'SELECT 1'
);
PREPARE stmt_drop FROM @sql_drop;
EXECUTE stmt_drop;
DEALLOCATE PREPARE stmt_drop;

SET @fk_new := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'arca_solicitudes_log'
    AND CONSTRAINT_NAME = 'FK_arca_log_venta_restrict'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql_add := IF(
  @fk_new = 0,
  'ALTER TABLE arca_solicitudes_log ADD CONSTRAINT FK_arca_log_venta_restrict FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE RESTRICT ON UPDATE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_add FROM @sql_add;
EXECUTE stmt_add;
DEALLOCATE PREPARE stmt_add;
