-- E0: Revalidación solo lectura sobre erp_reportes_nov2026
-- Socket: /tmp/erp-reportes-mysql/mysql.sock
-- Sin .env productivo. Solo SELECTs.

USE erp_reportes_nov2026;

-- 1. Conteos reales
SELECT 'ventas' t, COUNT(*) n FROM ventas
UNION ALL SELECT 'ventas_cont', COUNT(*) FROM ventas_cont
UNION ALL SELECT 'pedidos', COUNT(*) FROM pedidos
UNION ALL SELECT 'pedidos_cont', COUNT(*) FROM pedidos_cont
UNION ALL SELECT 'movimiento_fondos', COUNT(*) FROM movimiento_fondos
UNION ALL SELECT 'arca_solicitudes_log', COUNT(*) FROM arca_solicitudes_log
UNION ALL SELECT 'remitos', COUNT(*) FROM remitos
UNION ALL SELECT 'movimiento_stock', COUNT(*) FROM movimiento_stock;

-- 2. Zona horaria y rango temporal
SELECT @@session.time_zone AS session_tz, @@global.time_zone AS global_tz;
SELECT MIN(fecha) min_fecha, MAX(fecha) max_fecha,
       MIN(fecha_fiscal) min_fecha_fiscal, MAX(fecha_fiscal) max_fecha_fiscal
FROM ventas;

-- 3. Formas del log ARCA (sin datos sensibles)
SELECT
  DATE_FORMAT(fecha_solicitud,'%Y-%m') mes,
  estado,
  JSON_KEYS(request_data) req_keys,
  JSON_KEYS(response_data) res_keys,
  COUNT(*) n
FROM arca_solicitudes_log
GROUP BY mes, estado, req_keys, res_keys
ORDER BY mes, estado;

-- 4. Intentos EN_PROCESO huérfanos (posible H05)
SELECT COUNT(*) intentos_desconocidos_posibles,
  MIN(fecha_solicitud) min_fs, MAX(fecha_solicitud) max_fs
FROM arca_solicitudes_log
WHERE estado = 'EN_PROCESO'
  AND fecha_solicitud < NOW() - INTERVAL 65 SECOND;

-- 5. EN_PROCESO con response_data que contiene CAE (H07)
SELECT COUNT(*) n
FROM arca_solicitudes_log
WHERE estado = 'EN_PROCESO'
  AND (
    JSON_EXTRACT(response_data, '$.data.autorizacion.cae') IS NOT NULL
    OR JSON_EXTRACT(response_data, '$.CAE') IS NOT NULL
    OR JSON_EXTRACT(response_data, '$.cae') IS NOT NULL
  );

-- 6. Distribución de fecha_fiscal por origen inferido (heurística, no certificación)
SELECT
  CASE
    WHEN fecha_fiscal IS NULL THEN 'NULL'
    WHEN tipo_f IN ('X') THEN 'X_sin_arca'
    WHEN cae_id IS NOT NULL AND ABS(DATEDIFF(fecha_fiscal, DATE(cae_solicitud_fecha))) <= 1 THEN 'cercano_a_solicitud'
    WHEN cae_id IS NULL AND fecha_fiscal = DATE(fecha) THEN 'igual_a_fecha_comercial'
    ELSE 'otro'
  END origen,
  COUNT(*) n
FROM ventas
GROUP BY origen;

-- 7. Caso 6009: neto de líneas vs importe en log
SELECT v.id, v.total, v.subtotal, v.iva_total, v.importe_afip,
  SUM(vc.subtotal) sum_sub, SUM(vc.IVA) sum_iva,
  SUM(vc.precio * vc.cantidad) sum_precio_cant
FROM ventas v
JOIN ventas_cont vc ON vc.venta_id = v.id
WHERE v.id = 6009
GROUP BY v.id, v.total, v.subtotal, v.iva_total, v.importe_afip;

SELECT
  id,
  estado,
  fecha_solicitud,
  JSON_EXTRACT(request_data, '$.impTotal') req_impTotal,
  JSON_EXTRACT(request_data, '$.impNeto') req_impNeto,
  JSON_EXTRACT(response_data, '$.data.datosARCA.ImpTotal') res_ImpTotal
FROM arca_solicitudes_log
WHERE venta_id = 6009
ORDER BY id;

-- 8. Clasificación estado_fiscal inferida (columna aún no existe)
SELECT
  tipo_f,
  CASE
    WHEN tipo_f = 'X' THEN 'NO_APLICA'
    WHEN cae_id IS NOT NULL THEN 'TIENE_CAE'
    WHEN EXISTS (
      SELECT 1 FROM arca_solicitudes_log l
      WHERE l.venta_id = v.id AND l.estado = 'EN_PROCESO'
        AND l.fecha_solicitud < NOW() - INTERVAL 65 SECOND
    ) THEN 'EN_PROCESO_ANTIGUO'
    WHEN EXISTS (
      SELECT 1 FROM arca_solicitudes_log l WHERE l.venta_id = v.id
    ) THEN 'TIENE_LOG_SIN_CAE'
    ELSE 'SIN_SOLICITUD'
  END clasificacion,
  COUNT(*) n
FROM ventas v
WHERE tipo_f IN ('A','B','X')
GROUP BY tipo_f, clasificacion
ORDER BY tipo_f, clasificacion;

-- 9. FK actual de arca_solicitudes_log
SELECT CONSTRAINT_NAME, DELETE_RULE, UPDATE_RULE
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = 'erp_reportes_nov2026'
  AND TABLE_NAME = 'arca_solicitudes_log';
