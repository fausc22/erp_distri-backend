-- =============================================================
-- PASO 1: Restaurar importe_afip para facturas A que quedaron
--         con decimales flotantes del backfill anterior
--         (ej: 82989.12 → 82989.00 = venta.total)
--
-- Condición: tipo_f = 'A' y la diferencia con venta.total es
-- menor a $1 (artefacto de aritmética flotante, no diferencia real)
-- =============================================================
UPDATE ventas
SET importe_afip = total
WHERE tipo_f IN ('A', 'C')
  AND importe_afip IS NOT NULL
  AND ABS(importe_afip - total) < 1;

-- =============================================================
-- PASO 2: Corregir fecha_fiscal e importe_afip usando los datos
--         reales enviados a AFIP (request_data del log EXITOSO)
--
-- Fuente de importe: request_data.impTotal = ImpTotal enviado.
--   Es más fiable que response_data que puede tener flotantes.
-- Fuente de fecha:   request_data.fecha = CbteFch enviado (YYYYMMDD).
--
-- Solo aplica a ventas que AÚN no tienen fecha_fiscal correcta
-- (NULL o que difieren del log) o cuyo importe_afip sea NULL.
-- =============================================================
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
SET
  v.fecha_fiscal = STR_TO_DATE(
    JSON_UNQUOTE(JSON_EXTRACT(log.request_data, '$.fecha')),
    '%Y%m%d'
  ),
  v.importe_afip = ROUND(
    CAST(JSON_UNQUOTE(JSON_EXTRACT(log.request_data, '$.impTotal')) AS DECIMAL(15,2)),
    2
  )
WHERE v.cae_id IS NOT NULL
  AND JSON_EXTRACT(log.request_data, '$.fecha') IS NOT NULL
  AND JSON_EXTRACT(log.request_data, '$.impTotal') IS NOT NULL
  AND (
    v.fecha_fiscal IS NULL
    OR v.importe_afip IS NULL
  );
