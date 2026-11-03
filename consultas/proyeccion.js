// Usar legacyAdapter (pool de la app) — no cargar dotenv productivo desde aquí.
const db = require('../db/legacyAdapter');

const { FECHA_FISCAL_SQL, FECHA_REPORTE_SQL } = require('./fechas');

const TIPOS_DOCUMENTO_SQL = "('FACTURA','NOTA_DEBITO','NOTA_CREDITO')";

function buildProyeccionBaseSQL({ where = '', orderBy = 'v.id ASC' } = {}) {
  const whereClause = where ? `AND (${where})` : '';

  return `
    WITH detalle AS (
      SELECT
        vc.venta_id,
        COUNT(*) AS lineas,
        SUM(CASE WHEN UPPER(COALESCE(vc.producto_nombre, '')) LIKE '%FLETE%' THEN 1 ELSE 0 END) AS lineas_flete,
        SUM(CASE WHEN TRIM(COALESCE(vc.producto_nombre, '')) = '' THEN 1 ELSE 0 END) AS lineas_sin_nombre,
        SUM(COALESCE(vc.subtotal, 0)) AS neto_lineas,
        SUM(COALESCE(vc.IVA, 0)) AS iva_lineas
      FROM ventas_cont vc
      GROUP BY vc.venta_id
    ),
    referencia_detalle AS (
      SELECT
        vc.venta_id,
        COUNT(*) AS lineas,
        SUM(CASE WHEN UPPER(COALESCE(vc.producto_nombre, '')) LIKE '%FLETE%' THEN 1 ELSE 0 END) AS lineas_flete,
        SUM(CASE WHEN TRIM(COALESCE(vc.producto_nombre, '')) = '' THEN 1 ELSE 0 END) AS lineas_sin_nombre
      FROM ventas_cont vc
      GROUP BY vc.venta_id
    )
    SELECT
      v.id AS venta_id,
      v.venta_referencia_id,
      v.numero_factura,
      DATE_FORMAT(v.fecha, '%Y-%m-%d') AS fecha_comercial,
      DATE_FORMAT(v.fecha, '%Y-%m-%d %H:%i:%s') AS fecha_comercial_hora,
      DATE_FORMAT(${FECHA_FISCAL_SQL}, '%Y-%m-%d') AS fecha_fiscal_acreditada,
      DATE_FORMAT(${FECHA_REPORTE_SQL}, '%Y-%m-%d') AS fecha_imputacion,
      CASE WHEN UPPER(TRIM(v.tipo_f)) IN ('A','B') AND ${FECHA_FISCAL_SQL} IS NULL
        THEN 1 ELSE 0 END AS fecha_provisional,
      UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) AS tipo_doc,
      UPPER(TRIM(COALESCE(v.tipo_f, 'SIN_TIPO'))) AS tipo_f,
      v.estado AS estado_venta,
      CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) = 'X' THEN 'NO_APLICA'
        WHEN NULLIF(TRIM(COALESCE(v.cae_id, '')), '') IS NOT NULL
          AND UPPER(TRIM(COALESCE(v.cae_resultado, ''))) IN ('A', 'AUTORIZADO') THEN 'AUTORIZADO'
        WHEN UPPER(TRIM(COALESCE(v.cae_resultado, ''))) IN ('R', 'RECHAZADO') THEN 'RECHAZADO'
        WHEN v.cae_solicitud_fecha IS NOT NULL THEN 'EN_CURSO'
        WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) IN ('A', 'B') THEN 'SIN_SOLICITUD'
        ELSE 'DESCONOCIDO'
      END AS estado_fiscal,
      'NO_EVALUADO' AS estado_conciliacion,
      CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) = 'NOTA_CREDITO' THEN -1
        ELSE 1
      END AS signo,
      COALESCE(v.subtotal, 0) AS subtotal,
      COALESCE(v.iva_total, 0) AS iva_total,
      COALESCE(v.exento, 0) AS exento,
      COALESCE(v.total, 0) AS total,
      COALESCE(v.total, 0) AS importe_comercial,
      NULL AS importe_fiscal_respaldado,
      NULL AS neto_fiscal_respaldado,
      NULL AS iva_fiscal_respaldado,
      COALESCE(v.importe_afip, NULL) AS importe_afip,
      NULL AS calidad_evidencia,
      'SIN_EVIDENCIA' AS calidad_importe_fiscal,
      NULL AS diferencia_comercial_fiscal,
      COALESCE(v.total, 0) * CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) = 'NOTA_CREDITO' THEN -1
        ELSE 1
      END AS total_firmado,
      COALESCE(v.subtotal, 0) * CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) = 'NOTA_CREDITO' THEN -1
        ELSE 1
      END AS subtotal_firmado,
      COALESCE(v.iva_total, 0) * CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) = 'NOTA_CREDITO' THEN -1
        ELSE 1
      END AS iva_firmado,
      NULL AS total_fiscal_firmado,
      NULL AS neto_fiscal_firmado,
      NULL AS iva_fiscal_firmado,
      d.neto_lineas,
      d.iva_lineas,
      (COALESCE(v.total, 0) - COALESCE(d.neto_lineas, 0) - COALESCE(d.iva_lineas, 0)) AS diferencia_lineas,
      v.cliente_id,
      v.cliente_nombre,
      v.cliente_cuit,
      v.cliente_condicion,
      v.cliente_ciudad,
      v.cliente_provincia,
      v.empleado_id AS vendedor_emisor_id,
      v.empleado_nombre AS vendedor_emisor_nombre,
      CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_DEBITO', 'NOTA_CREDITO')
          AND v.venta_referencia_id IS NOT NULL THEN vr.empleado_id
        ELSE v.empleado_id
      END AS vendedor_id,
      CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_DEBITO', 'NOTA_CREDITO')
          AND v.venta_referencia_id IS NOT NULL THEN vr.empleado_nombre
        ELSE COALESCE(v.empleado_nombre, 'Sin vendedor')
      END AS vendedor_nombre,
      CASE
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_DEBITO', 'NOTA_CREDITO')
          AND v.venta_referencia_id IS NOT NULL THEN 'referencia'
        WHEN v.empleado_id IS NOT NULL THEN 'propio'
        ELSE 'sin_atribucion'
      END AS vendedor_atribuible_origen,
      CASE
        WHEN COALESCE(d.lineas_flete, 0) > 0 THEN 'flete'
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) <> 'FACTURA'
          AND (v.venta_referencia_id IS NULL OR COALESCE(rd.lineas, 0) = 0 OR COALESCE(rd.lineas_sin_nombre, 0) > 0) THEN 'pendiente'
        WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) <> 'FACTURA'
          AND COALESCE(rd.lineas_flete, 0) > 0 THEN 'flete'
        WHEN COALESCE(d.lineas, 0) = 0 OR COALESCE(d.lineas_sin_nombre, 0) > 0 THEN 'pendiente'
        ELSE 'normal'
      END AS segmento,
      CONCAT_WS(',',
        IF(COALESCE(d.lineas, 0) = 0, 'SIN_DETALLE', NULL),
        IF(COALESCE(d.lineas_sin_nombre, 0) > 0, 'LINEA_SIN_NOMBRE', NULL),
        IF(ABS(COALESCE(v.total, 0) - COALESCE(d.neto_lineas, 0) - COALESCE(d.iva_lineas, 0)) > 0.01, 'DIFERENCIA_CABECERA_LINEAS', NULL),
        IF(UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_DEBITO', 'NOTA_CREDITO') AND v.venta_referencia_id IS NULL, 'NOTA_SIN_REFERENCIA', NULL)
      ) AS alertas,
      COALESCE(v.cae_id, '') AS cae_id,
      v.cae_resultado,
      v.cae_solicitud_fecha,
      NULL AS autorizacion_id,
      'legacy' AS regla_version
    FROM ventas v
    LEFT JOIN detalle d ON d.venta_id = v.id
    LEFT JOIN ventas vr ON vr.id = v.venta_referencia_id
    LEFT JOIN referencia_detalle rd ON rd.venta_id = vr.id
    WHERE UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ${TIPOS_DOCUMENTO_SQL}
      ${whereClause}
    ORDER BY ${orderBy}
  `;
}

async function consultarProyeccion({ desde, hasta, connection = db } = {}) {
  const filtros = [];
  const params = [];

  if (desde) {
    filtros.push(`${FECHA_REPORTE_SQL} >= ?`);
    params.push(desde);
  }
  if (hasta) {
    filtros.push(`${FECHA_REPORTE_SQL} <= ?`);
    params.push(hasta);
  }

  const result = await connection.query(buildProyeccionBaseSQL({ where: filtros.join(' AND ') }), params);
  // Compat: pool mysql2 → [rows,fields]; legacyAdapter promise → rows
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

/** Consulta libre con where/params (usada por listados/libro IVA). */
async function fetchProyeccion({ where = '', params = [], connection = db, orderBy } = {}) {
  const sql = buildProyeccionBaseSQL({ where, orderBy });
  const result = await connection.query(sql, params);
  return Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
}

module.exports = {
  FECHA_REPORTE_SQL,
  buildProyeccionBaseSQL,
  consultarProyeccion,
  fetchProyeccion
};
