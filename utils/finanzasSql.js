/**
 * Reglas SQL compartidas para reportes financieros.
 * Fuente de verdad para filtros, signos y expresiones de fecha/costo.
 */

const FECHA_REF = (alias = 'v') => `DATE(COALESCE(${alias}.fecha_fiscal, ${alias}.fecha))`;

const SIGNO_DOC = (alias = 'v') =>
  `(CASE WHEN ${alias}.tipo_doc = 'NOTA_CREDITO' THEN -1 ELSE 1 END)`;

const TOTAL_NETO = (alias = 'v') => `${SIGNO_DOC(alias)} * ${alias}.total`;

const WHERE_VENTAS_BASE = (alias = 'v') => [
  `${alias}.estado = 'Facturada'`,
  `${alias}.tipo_doc IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO')`
];

/**
 * Ganancia por línea: usa costo actual del producto; si no hay costo, estima 25% del ingreso.
 */
const GANANCIA_LINEA = (vcAlias = 'vc', pAlias = 'p', vAlias = 'v') => `
  CASE
    WHEN COALESCE(${pAlias}.costo, 0) > 0
    THEN (${vcAlias}.precio - ${pAlias}.costo) * ${vcAlias}.cantidad * ${SIGNO_DOC(vAlias)}
    ELSE ${vcAlias}.precio * ${vcAlias}.cantidad * 0.25 * ${SIGNO_DOC(vAlias)}
  END
`;

const COSTO_LINEA = (vcAlias = 'vc', pAlias = 'p', vAlias = 'v') =>
  `COALESCE(${pAlias}.costo, 0) * ${vcAlias}.cantidad * ${SIGNO_DOC(vAlias)}`;

const INGRESO_LINEA = (vcAlias = 'vc', vAlias = 'v') =>
  `${vcAlias}.precio * ${vcAlias}.cantidad * ${SIGNO_DOC(vAlias)}`;

/** Líneas de flete (producto plantilla o descripción con FLETE) */
const ES_LINEA_FLETE = (vcAlias = 'vc') =>
  `UPPER(${vcAlias}.producto_nombre) LIKE '%FLETE%'`;

/** Ingreso de línea excluyendo fletes — para totales por vendedor */
const INGRESO_LINEA_SIN_FLETE = (vcAlias = 'vc', vAlias = 'v') =>
  `CASE WHEN ${ES_LINEA_FLETE(vcAlias)} THEN 0 ELSE ${INGRESO_LINEA(vcAlias, vAlias)} END`;

const CANTIDAD_LINEA = (vcAlias = 'vc', vAlias = 'v') =>
  `${vcAlias}.cantidad * ${SIGNO_DOC(vAlias)}`;

/** CTE reutilizable: costo y ganancia neta por venta */
const CTE_COSTO_POR_VENTA = (whereSql, vAlias = 'v', vcAlias = 'vc', pAlias = 'p') => `
  costo_por_venta AS (
    SELECT
      ${vAlias}.id AS venta_id,
      ROUND(SUM(${COSTO_LINEA(vcAlias, pAlias, vAlias)}), 2) AS costo_neto,
      ROUND(SUM(${GANANCIA_LINEA(vcAlias, pAlias, vAlias)}), 2) AS ganancia_neta
    FROM ventas ${vAlias}
    JOIN ventas_cont ${vcAlias} ON ${vcAlias}.venta_id = ${vAlias}.id
    LEFT JOIN productos ${pAlias} ON ${pAlias}.id = ${vcAlias}.producto_id
    WHERE ${whereSql}
    GROUP BY ${vAlias}.id
  )
`;

const construirWhereVentas = (filtros, alias = 'v') => {
  const where = [
    ...WHERE_VENTAS_BASE(alias),
    `${FECHA_REF(alias)} >= ?`,
    `${FECHA_REF(alias)} <= ?`
  ];
  const params = [filtros.desde, filtros.hasta];

  if (filtros.cuenta_id && filtros.cuenta_id !== 'todas') {
    where.push(`${alias}.cuenta_id = ?`);
    params.push(filtros.cuenta_id);
  }
  if (filtros.tipo_fiscal) {
    where.push(`${alias}.tipo_f = ?`);
    params.push(filtros.tipo_fiscal);
  }
  if (filtros.empleado_id) {
    where.push(`${alias}.empleado_id = ?`);
    params.push(filtros.empleado_id);
  }
  if (filtros.ciudad) {
    where.push(`${alias}.cliente_ciudad = ?`);
    params.push(filtros.ciudad);
  }
  if (filtros.cliente_id) {
    where.push(`${alias}.cliente_id = ?`);
    params.push(filtros.cliente_id);
  }

  return { whereSql: where.join(' AND '), params };
};

const normalizarFiltrosReportes = (query = {}) => {
  const hoy = new Date();
  const primerDiaMes = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
  const desde = query.desde || primerDiaMes.toISOString().split('T')[0];
  const hasta = query.hasta || hoy.toISOString().split('T')[0];

  return {
    desde,
    hasta,
    periodo: query.periodo || 'mensual',
    cuenta_id: query.cuenta_id || '',
    tipo_fiscal: query.tipo_fiscal || query.tipo_f || '',
    empleado_id: query.empleado_id || '',
    ciudad: query.ciudad || '',
    cliente_id: query.cliente_id || '',
    limite: Math.min(200, Math.max(1, Number(query.limite || 50))),
    comparativo: query.comparativo || 'periodo_anterior'
  };
};

const validarRangoFechas = (desde, hasta) => {
  const d = new Date(desde);
  const h = new Date(hasta);
  if (isNaN(d.getTime()) || isNaN(h.getTime())) {
    return { ok: false, message: 'Formato de fecha inválido. Use YYYY-MM-DD' };
  }
  if (d > h) {
    return { ok: false, message: 'La fecha "desde" no puede ser mayor que "hasta"' };
  }
  return { ok: true, d, h };
};

module.exports = {
  FECHA_REF,
  SIGNO_DOC,
  TOTAL_NETO,
  GANANCIA_LINEA,
  COSTO_LINEA,
  INGRESO_LINEA,
  INGRESO_LINEA_SIN_FLETE,
  ES_LINEA_FLETE,
  CANTIDAD_LINEA,
  CTE_COSTO_POR_VENTA,
  WHERE_VENTAS_BASE,
  construirWhereVentas,
  normalizarFiltrosReportes,
  validarRangoFechas
};
