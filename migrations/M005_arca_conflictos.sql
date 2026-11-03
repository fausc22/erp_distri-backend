CREATE TABLE IF NOT EXISTS arca_conflictos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  autorizacion_id INT NULL,
  venta_id INT NULL,
  intento_id INT NULL,
  emisor_cuit VARCHAR(20) NOT NULL,
  entorno ENUM('homologacion','produccion') NOT NULL,
  cbte_tipo SMALLINT NOT NULL,
  pto_vta SMALLINT NOT NULL,
  cbte_nro INT NOT NULL,
  evidencia_json JSON NOT NULL,
  motivo VARCHAR(80) NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_conflicto_identidad (emisor_cuit, entorno, cbte_tipo, pto_vta, cbte_nro)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @fk_conflicto_autorizacion := (
  SELECT COUNT(*)
  FROM information_schema.TABLE_CONSTRAINTS
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = 'arca_conflictos'
    AND CONSTRAINT_NAME = 'FK_conflicto_autorizacion'
    AND CONSTRAINT_TYPE = 'FOREIGN KEY'
);

SET @sql_add_fk_conflicto_autorizacion := IF(
  @fk_conflicto_autorizacion = 0,
  'ALTER TABLE arca_conflictos ADD CONSTRAINT FK_conflicto_autorizacion FOREIGN KEY (autorizacion_id) REFERENCES arca_autorizaciones_canonicas(id) ON DELETE RESTRICT',
  'SELECT 1'
);
PREPARE stmt_add_fk_conflicto_autorizacion FROM @sql_add_fk_conflicto_autorizacion;
EXECUTE stmt_add_fk_conflicto_autorizacion;
DEALLOCATE PREPARE stmt_add_fk_conflicto_autorizacion;
