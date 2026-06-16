-- Agrega ventas.importe_afip (ImpTotal exacto enviado a AFIP para QR)
-- Backfill desde arca_solicitudes_log para comprobantes ya autorizados

SET @has_importe_afip := (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'ventas'
    AND column_name = 'importe_afip'
);

SET @sql_add_importe_afip := IF(
  @has_importe_afip = 0,
  'ALTER TABLE ventas ADD COLUMN importe_afip DECIMAL(15,2) NULL COMMENT ''ImpTotal exacto enviado a AFIP (para QR)'' AFTER total',
  'SELECT ''importe_afip ya existe'' AS info'
);
PREPARE stmt_add_importe_afip FROM @sql_add_importe_afip;
EXECUTE stmt_add_importe_afip;
DEALLOCATE PREPARE stmt_add_importe_afip;

-- Backfill: último log EXITOSO por venta (evita duplicados si hubo reintentos)
UPDATE ventas v
INNER JOIN (
  SELECT l.venta_id, l.request_data
  FROM arca_solicitudes_log l
  INNER JOIN (
    SELECT venta_id, MAX(id) AS max_id
    FROM arca_solicitudes_log
    WHERE estado = 'EXITOSO'
    GROUP BY venta_id
  ) ult ON ult.max_id = l.id
) log ON log.venta_id = v.id
SET v.importe_afip = CAST(JSON_UNQUOTE(JSON_EXTRACT(log.request_data, '$.impTotal')) AS DECIMAL(15,2))
WHERE v.importe_afip IS NULL
  AND v.cae_id IS NOT NULL
  AND JSON_EXTRACT(log.request_data, '$.impTotal') IS NOT NULL;
