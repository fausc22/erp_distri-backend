// Conciliación read-only de una copia local. No carga .env.
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const { readReport, HEADER_SQL } = require('../reportes/repository');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
(async () => {
  const socketPath = process.env.REPORTES_TEST_SOCKET;
  if (!socketPath?.startsWith('/tmp/erp-reportes-mysql/'))
    throw Error('Requiere socket local de pruebas');
  const database = process.env.REPORTES_COPY_DATABASE || 'erp_reportes_copy';
  assert.ok(['erp_reportes_copy', 'erp_reportes_nov2026'].includes(database));
  const conn = await mysql.createConnection({
    socketPath,
    user: 'root',
    database,
  });
  try {
    const output = [];
    const [months] = await conn.query(`SELECT
      DATE_FORMAT(COALESCE(fecha_fiscal,fecha),'%Y-%m-01') desde,
      DATE_FORMAT(LAST_DAY(COALESCE(fecha_fiscal,fecha)),'%Y-%m-%d') hasta
      FROM ventas GROUP BY desde,hasta ORDER BY desde`);
    assert.ok(months.length, 'La copia debe contener comprobantes');
    for (const { desde, hasta } of months) {
      const p = period({ desde, hasta });
      const start = Date.now();
      const raw = await readReport(conn, p);
      const d = buildReport(raw, p);
      const ms = Date.now() - start;
      const [[expected]] = await conn.query(
        `SELECT COALESCE(SUM(CASE WHEN tipo_doc='NOTA_CREDITO' THEN -total ELSE total END),0) AS total FROM ventas WHERE estado='Facturada' AND tipo_doc IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO') AND DATE(COALESCE(fecha_fiscal,fecha)) BETWEEN ? AND ?`,
        [desde, hasta]
      );
      const [[iva]] = await conn.query(
        `SELECT COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo_doc)) IN ('NOTA_CREDITO','NOTA CREDITO') THEN -total ELSE total END),0) AS total FROM ventas WHERE tipo_f IN ('A','B') AND DATE(COALESCE(fecha_fiscal,fecha)) BETWEEN ? AND ?`,
        [desde, hasta]
      );
      const [[commercial]] = await conn.query(
        `SELECT COALESCE(SUM((CASE WHEN UPPER(TRIM(COALESCE(v.tipo_doc,'FACTURA')))='NOTA_CREDITO' THEN -1 ELSE 1 END)*(CASE WHEN UPPER(TRIM(v.tipo_f)) IN ('A','B') THEN v.subtotal ELSE v.total END)),0) AS total FROM ventas v LEFT JOIN ventas vr ON vr.id=v.venta_referencia_id WHERE DATE(v.fecha) BETWEEN ? AND ? AND UPPER(TRIM(COALESCE(v.estado,'FACTURADA'))) IN ('FACTURADA','FACTURADO') AND UPPER(TRIM(COALESCE(v.tipo_doc,'FACTURA'))) IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO') AND ((UPPER(TRIM(COALESCE(v.tipo_doc,'FACTURA')))='FACTURA' AND v.empleado_id IS NOT NULL) OR (UPPER(TRIM(COALESCE(v.tipo_doc,'FACTURA'))) IN ('NOTA_DEBITO','NOTA_CREDITO') AND vr.empleado_id IS NOT NULL))`,
        [desde, hasta]
      );
      assert.equal(d.resumen.total, String(expected.total));
      assert.equal(d.conciliacion.libro_iva, String(iva.total));
      assert.equal(d.conciliacion.comercial, String(commercial.total));
      assert.ok(Object.values(d.conciliacion.controles).every(Boolean));
      const [[outflows]] = await conn.query(
        `SELECT
        (SELECT COALESCE(SUM(total),0) FROM compras WHERE estado IN ('Registrada','Confirmada') AND DATE(fecha) BETWEEN ? AND ?) compras,
        (SELECT COALESCE(SUM(monto),0) FROM gastos WHERE DATE(fecha) BETWEEN ? AND ?) gastos`,
        [desde, hasta, desde, hasta]
      );
      assert.equal(d.resultado.compras, String(outflows.compras));
      assert.equal(d.resultado.gastos, String(outflows.gastos));
      const [[cash]] = await conn.query(
        `SELECT
        COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo))='INGRESO' AND UPPER(TRIM(COALESCE(origen,'')))<>'TRANSFERENCIA' THEN monto ELSE 0 END),0) ingresos,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo))='EGRESO' AND UPPER(TRIM(COALESCE(origen,'')))<>'TRANSFERENCIA' THEN monto ELSE 0 END),0) egresos,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo))='INGRESO' AND UPPER(TRIM(COALESCE(origen,'')))='TRANSFERENCIA' THEN monto ELSE 0 END),0) transferencias_entrada,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo))='EGRESO' AND UPPER(TRIM(COALESCE(origen,'')))='TRANSFERENCIA' THEN monto ELSE 0 END),0) transferencias_salida,
        COALESCE(SUM(CASE WHEN UPPER(TRIM(tipo))='INGRESO' THEN monto ELSE -monto END),0) variacion
        FROM movimiento_fondos WHERE DATE(fecha) BETWEEN ? AND ?`,
        [desde, hasta]
      );
      for (const key of Object.keys(cash))
        assert.equal(d.caja[key], String(cash[key]));
      const [classified] = await conn.query(
        `SELECT v.id,
        CASE WHEN EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.id AND UPPER(c.producto_nombre) LIKE '%FLETE%') THEN 'flete'
        WHEN v.tipo_doc IN ('NOTA_CREDITO','NOTA_DEBITO') THEN
          CASE WHEN NOT EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.venta_referencia_id)
             OR EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.venta_referencia_id AND TRIM(COALESCE(c.producto_nombre,''))='') THEN 'pendiente'
          WHEN EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.venta_referencia_id AND UPPER(c.producto_nombre) LIKE '%FLETE%') THEN 'flete' ELSE 'normal' END
        WHEN NOT EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.id)
          OR EXISTS(SELECT 1 FROM ventas_cont c WHERE c.venta_id=v.id AND TRIM(COALESCE(c.producto_nombre,''))='') THEN 'pendiente'
        ELSE 'normal' END segmento,
        CASE WHEN v.tipo_doc='NOTA_CREDITO' THEN -v.total ELSE v.total END total
        FROM ventas v WHERE v.estado='Facturada' AND v.tipo_doc IN ('FACTURA','NOTA_DEBITO','NOTA_CREDITO')
        AND DATE(COALESCE(v.fecha_fiscal,v.fecha)) BETWEEN ? AND ? ORDER BY v.id`,
        [desde, hasta]
      );
      assert.deepEqual(
        d.documentos.map((r) => ({
          id: r.id,
          segmento: r.segmento,
          total: r.total,
        })),
        classified
      );
      output.push({
        desde,
        hasta,
        documentos: d.resumen.documentos,
        total: d.resumen.total,
        normal: d.resumen.normal,
        flete: d.resumen.flete,
        pendiente: d.resumen.pendiente,
        pendientes: d.resumen.documentos_pendientes,
        compras: d.resultado.compras,
        gastos: d.resultado.gastos,
        caja: cash,
        alertas: d.alertas.length,
        controles: d.conciliacion.controles,
        alertas_resumen: d.alertas_resumen,
        diferencia_iva: d.conciliacion.diferencia_iva,
        lectura_calculo_ms: ms,
        json_bytes: Buffer.byteLength(JSON.stringify(d)),
        validacion:
          'cabeceras, clasificación por comprobante, libro IVA, listado comercial, compras, gastos y caja coinciden con SQL independiente',
      });
    }
    const p = period({ desde: '2026-08-01', hasta: '2026-08-31' });
    const range = [p.anterior.desde, p.fin_exclusivo];
    const [explain] = await conn.query('EXPLAIN ' + HEADER_SQL, [
      ...range,
      ...range,
      ...range,
    ]);
    console.log(
      JSON.stringify(
        {
          base_aislada: database,
          comprobantes_verificados: output.reduce(
            (n, r) => n + r.documentos,
            0
          ),
          periodos: output,
          plan: explain.map((r) => ({
            tabla: r.table,
            tipo: r.type,
            filas: r.rows,
            indice: r.key,
          })),
        },
        null,
        2
      )
    );
  } finally {
    await conn.end();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
