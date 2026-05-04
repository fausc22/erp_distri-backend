-- Fase 2 + Fase 3 (mínimo impacto)
-- 1) Agrega ventas.fecha_fiscal
-- 2) Backfill inicial de fecha_fiscal
-- 3) Crea UNIQUE en ventas.cae_id solo si no hay duplicados

-- Agregar columna fecha_fiscal si no existe
SET @has_fecha_fiscal := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ventas'
    AND column_name = 'fecha_fiscal'
);

SET @sql_add_fecha_fiscal := IF(
  @has_fecha_fiscal = 0,
  'ALTER TABLE ventas ADD COLUMN fecha_fiscal DATE NULL COMMENT ''Fecha fiscal del comprobante usado para ARCA/PDF/QR/Libro IVA'' AFTER cae_solicitud_fecha',
  'SELECT ''fecha_fiscal ya existe'' AS info'
);
PREPARE stmt_add_fecha_fiscal FROM @sql_add_fecha_fiscal;
EXECUTE stmt_add_fecha_fiscal;
DEALLOCATE PREPARE stmt_add_fecha_fiscal;

-- Backfill inicial (sin pisar fecha_fiscal ya cargada)
UPDATE ventas
SET fecha_fiscal = DATE(COALESCE(cae_solicitud_fecha, fecha))
WHERE fecha_fiscal IS NULL;

-- Índice para reportes por fecha fiscal
SET @has_idx_fecha_fiscal := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'ventas'
    AND index_name = 'idx_ventas_fecha_fiscal'
);

SET @sql_idx_fecha_fiscal := IF(
  @has_idx_fecha_fiscal = 0,
  'ALTER TABLE ventas ADD KEY idx_ventas_fecha_fiscal (fecha_fiscal)',
  'SELECT ''idx_ventas_fecha_fiscal ya existe'' AS info'
);
PREPARE stmt_idx_fecha_fiscal FROM @sql_idx_fecha_fiscal;
EXECUTE stmt_idx_fecha_fiscal;
DEALLOCATE PREPARE stmt_idx_fecha_fiscal;

-- UNIQUE en cae_id si no existe y si no hay duplicados no nulos
SET @has_uk_cae := (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'ventas'
    AND index_name = 'uk_ventas_cae_id'
);

SET @dupes_cae := (
  SELECT COUNT(*)
  FROM (
    SELECT cae_id
    FROM ventas
    WHERE cae_id IS NOT NULL
      AND cae_id <> ''
    GROUP BY cae_id
    HAVING COUNT(*) > 1
  ) dupes
);

SET @sql_add_uk_cae := IF(
  @has_uk_cae > 0,
  'SELECT ''uk_ventas_cae_id ya existe'' AS info',
  IF(
    @dupes_cae > 0,
    'SELECT ''No se crea UNIQUE(cae_id): hay duplicados no nulos en ventas.cae_id'' AS warning',
    'ALTER TABLE ventas ADD UNIQUE KEY uk_ventas_cae_id (cae_id)'
  )
);
PREPARE stmt_add_uk_cae FROM @sql_add_uk_cae;
EXECUTE stmt_add_uk_cae;
DEALLOCATE PREPARE stmt_add_uk_cae;
