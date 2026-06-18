const BaseRepository = require('./BaseRepository');
const {
  construirWhereVentas,
  TOTAL_NETO,
  GANANCIA_LINEA,
  COSTO_LINEA,
  CANTIDAD_LINEA,
  INGRESO_LINEA
} = require('../utils/finanzasSql');

class ReportesRepository extends BaseRepository {
  construirWhereVentas(filtros, alias = 'v') {
    return construirWhereVentas(filtros, alias);
  }

  async obtenerResumenFinanciero(filtros) {
    const { whereSql, params } = this.construirWhereVentas(filtros, 'v');
    const fechaParams = [filtros.desde, filtros.hasta];

    const queryVentas = `
      SELECT
        SUM(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_total_ventas,
        ROUND(AVG(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
    `;

    const queryCostos = `
      SELECT
        ROUND(SUM(${COSTO_LINEA('vc', 'p', 'v')}), 2) AS costo_total,
        ROUND(SUM(${GANANCIA_LINEA('vc', 'p', 'v')}), 2) AS ganancia_estimada,
        COUNT(DISTINCT CASE WHEN p.costo > 0 THEN p.id END) AS productos_con_costo,
        COUNT(DISTINCT p.id) AS productos_totales
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
    `;

    const queryCompras = `
      SELECT
        COUNT(*) AS cantidad_compras,
        ROUND(COALESCE(SUM(total), 0), 2) AS monto_total_compras
      FROM compras
      WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?
      AND estado != 'Anulada'
    `;

    const queryGastos = `
      SELECT
        COUNT(*) AS cantidad_gastos,
        ROUND(COALESCE(SUM(monto), 0), 2) AS monto_total_gastos
      FROM gastos
      WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?
    `;

    const [ventasRows, costosRows, comprasRows, gastosRows] = await Promise.all([
      this.query(queryVentas, params),
      this.query(queryCostos, params),
      this.query(queryCompras, fechaParams),
      this.query(queryGastos, fechaParams)
    ]);

    return {
      ventasRow: ventasRows?.[0] || {},
      costosRow: costosRows?.[0] || {},
      comprasRow: comprasRows?.[0] || {},
      gastosRow: gastosRows?.[0] || {}
    };
  }

  async obtenerDashboardSimplificado(filtros) {
    const { whereSql, params } = this.construirWhereVentas(filtros, 'v');
    const fechaDesde = new Date(filtros.desde);
    const fechaHasta = new Date(filtros.hasta);
    const diasPeriodo = Math.ceil((fechaHasta - fechaDesde) / (1000 * 60 * 60 * 24)) + 1;
    const fechaDesdeAnterior = new Date(fechaDesde);
    fechaDesdeAnterior.setDate(fechaDesdeAnterior.getDate() - diasPeriodo);
    const fechaHastaAnterior = new Date(fechaDesde);
    fechaHastaAnterior.setDate(fechaHastaAnterior.getDate() - 1);

    const filtrosAnterior = {
      ...filtros,
      desde: fechaDesdeAnterior.toISOString().split('T')[0],
      hasta: fechaHastaAnterior.toISOString().split('T')[0]
    };
    const whereAnterior = this.construirWhereVentas(filtrosAnterior, 'v');

    const queryVentas = `
      SELECT
        SUM(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_ventas,
        ROUND(AVG(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
    `;
    const queryVentasAnterior = `
      SELECT ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_ventas
      FROM ventas v
      WHERE ${whereAnterior.whereSql}
    `;
    const queryCostos = `
      SELECT
        ROUND(SUM(${COSTO_LINEA('vc', 'p', 'v')}), 2) AS costo_ventas,
        ROUND(SUM(${GANANCIA_LINEA('vc', 'p', 'v')}), 2) AS ganancia_estimada
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
    `;
    const queryComprasYGastos = `
      SELECT
        (SELECT ROUND(COALESCE(SUM(total), 0), 2) FROM compras WHERE DATE(fecha) >= ? AND DATE(fecha) <= ? AND estado != 'Anulada') AS compras_total,
        (SELECT ROUND(COALESCE(SUM(monto), 0), 2) FROM gastos WHERE DATE(fecha) >= ? AND DATE(fecha) <= ?) AS gastos_total
    `;
    const queryTopProductos = `
      SELECT
        vc.producto_nombre,
        ROUND(SUM(${CANTIDAD_LINEA('vc', 'v')}), 2) AS cantidad_vendida,
        ROUND(SUM(${INGRESO_LINEA('vc', 'v')}), 2) AS ingresos_generados,
        ROUND(SUM(${GANANCIA_LINEA('vc', 'p', 'v')}), 2) AS ganancia_generada
      FROM ventas v
      JOIN ventas_cont vc ON vc.venta_id = v.id
      LEFT JOIN productos p ON p.id = vc.producto_id
      WHERE ${whereSql}
      GROUP BY vc.producto_nombre
      HAVING cantidad_vendida > 0
      ORDER BY ganancia_generada DESC, vc.producto_nombre ASC
      LIMIT 5
    `;
    const queryVendedores = `
      SELECT
        COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor') AS empleado_nombre,
        SUM(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_total_ventas,
        ROUND(AVG(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(NULLIF(v.empleado_nombre, ''), 'Sin vendedor')
      ORDER BY monto_total_ventas DESC, empleado_nombre ASC
      LIMIT 10
    `;
    const queryClientes = `
      SELECT
        COALESCE(NULLIF(v.cliente_nombre, ''), 'Sin cliente') AS cliente_nombre,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_total,
        SUM(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN 1 ELSE 0 END) AS cantidad_ventas,
        ROUND(AVG(CASE WHEN ${TOTAL_NETO('v')} > 0 THEN v.total END), 2) AS ticket_promedio
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(NULLIF(v.cliente_nombre, ''), 'Sin cliente')
      ORDER BY monto_total DESC, cliente_nombre ASC
      LIMIT 10
    `;
    const queryCiudades = `
      SELECT
        COALESCE(v.cliente_ciudad, 'Sin ciudad') AS ciudad,
        COALESCE(v.cliente_provincia, 'Sin provincia') AS provincia,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS monto_total,
        COUNT(DISTINCT v.cliente_id) AS clientes_unicos
      FROM ventas v
      WHERE ${whereSql}
      GROUP BY COALESCE(v.cliente_ciudad, 'Sin ciudad'), COALESCE(v.cliente_provincia, 'Sin provincia')
      ORDER BY monto_total DESC, ciudad ASC, provincia ASC
      LIMIT 10
    `;
    const queryCuentas = `
      SELECT
        cf.id,
        cf.nombre,
        ROUND(SUM(${TOTAL_NETO('v')}), 2) AS facturacion_neta
      FROM ventas v
      JOIN cuenta_fondos cf ON cf.id = v.cuenta_id
      WHERE ${whereSql}
      GROUP BY cf.id, cf.nombre
      ORDER BY facturacion_neta DESC, cf.id ASC
    `;

    const [ventasRows, ventasAnteriorRows, costosRows, comprasGastosRows, topProductos, vendedores, clientes, ciudades, cuentas] = await Promise.all([
      this.query(queryVentas, params),
      this.query(queryVentasAnterior, whereAnterior.params),
      this.query(queryCostos, params),
      this.query(queryComprasYGastos, [filtros.desde, filtros.hasta, filtros.desde, filtros.hasta]),
      this.query(queryTopProductos, params),
      this.query(queryVendedores, params),
      this.query(queryClientes, params),
      this.query(queryCiudades, params),
      this.query(queryCuentas, params)
    ]);

    return {
      ventasRow: ventasRows?.[0] || {},
      ventasAnteriorRow: ventasAnteriorRows?.[0] || {},
      costosRow: costosRows?.[0] || {},
      comprasGastosRow: comprasGastosRows?.[0] || {},
      topProductos,
      vendedores,
      clientes,
      ciudades,
      cuentas
    };
  }

  async obtenerBalanceGeneral(filtros = {}) {
    const params = [];
    const where = [];

    if (filtros.anio) {
      where.push('YEAR(fecha) = ?');
      params.push(filtros.anio);
    }
    if (filtros.desde) {
      where.push('DATE(fecha) >= ?');
      params.push(filtros.desde);
    }
    if (filtros.hasta) {
      where.push('DATE(fecha) <= ?');
      params.push(filtros.hasta);
    }

    const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
    const query = `
      SELECT
        DATE_FORMAT(fecha, '%Y-%m') AS mes,
        ROUND(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END), 2) AS ingresos,
        ROUND(SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 2) AS egresos,
        ROUND(SUM(CASE WHEN tipo = 'INGRESO' THEN monto ELSE 0 END) - SUM(CASE WHEN tipo = 'EGRESO' THEN monto ELSE 0 END), 2) AS balance
      FROM movimiento_fondos
      ${whereSql}
      GROUP BY mes
      ORDER BY mes ASC
    `;

    return this.query(query, params);
  }

  async obtenerFlujoDeFondos(filtros = {}) {
    const params = [];
    let filtro = filtros.cuenta_id ? 'WHERE mf.cuenta_id = ?' : 'WHERE 1=1';
    if (filtros.cuenta_id) params.push(filtros.cuenta_id);
    if (filtros.desde) {
      filtro += ' AND mf.fecha >= ?';
      params.push(filtros.desde);
    }
    if (filtros.hasta) {
      filtro += ' AND mf.fecha <= ?';
      params.push(filtros.hasta);
    }

    const query = `
      SELECT
        DATE_FORMAT(mf.fecha, '%Y-%m-%d') AS fecha,
        cf.nombre AS cuenta,
        mf.tipo,
        mf.origen,
        mf.monto,
        (CASE WHEN mf.tipo = 'INGRESO' THEN mf.monto ELSE 0 END) AS ingreso,
        (CASE WHEN mf.tipo = 'EGRESO' THEN mf.monto ELSE 0 END) AS egreso
      FROM movimiento_fondos mf
      JOIN cuenta_fondos cf ON mf.cuenta_id = cf.id
      ${filtro}
      ORDER BY mf.fecha DESC, mf.id DESC
    `;

    return this.query(query, params);
  }
}

module.exports = new ReportesRepository();
