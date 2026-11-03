-- M001: tabla de control de migraciones
-- Idempotente. No registra migraciones previas sin verificación.

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(14) NOT NULL,
  nombre VARCHAR(255) NOT NULL,
  aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checksum VARCHAR(64) NULL,
  PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
