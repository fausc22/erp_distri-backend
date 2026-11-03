CREATE TABLE IF NOT EXISTS operaciones_idempotencia (
  operacion_id CHAR(36) NOT NULL PRIMARY KEY,
  tipo_operacion VARCHAR(40) NOT NULL,
  content_hash VARCHAR(64) NOT NULL,
  resultado_json JSON NULL,
  venta_id INT NULL,
  estado ENUM('EN_CURSO','COMPLETADA','CONFLICTO') NOT NULL DEFAULT 'EN_CURSO',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_operacion_content (operacion_id, content_hash),
  KEY idx_operacion_venta (venta_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
