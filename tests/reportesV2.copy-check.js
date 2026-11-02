// Conciliación read-only de la copia local de septiembre. No carga .env.
const mysql = require('mysql2/promise');
const assert = require('node:assert/strict');
const { readReport, HEADER_SQL } = require('../reportes/repository');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
(async () => {
  const socketPath = process.env.REPORTES_TEST_SOCKET;
  if (!socketPath?.startsWith('/tmp/erp-reportes-mysql/'))
    throw Error('Requiere socket local de pruebas');
  const conn = await mysql.createConnection({
    socketPath,
    user: 'root',
    database: 'erp_reportes_copy',
  });
  try {
    const output = [];
    for (const [desde, hasta] of [
      ['2026-07-01', '2026-07-31'],
      ['2026-08-01', '2026-08-31'],
      ['2026-09-01', '2026-09-20'],
    ]) {
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
      output.push({
        desde,
        hasta,
        documentos: d.resumen.documentos,
        total: d.resumen.total,
        normal: d.resumen.normal,
        flete: d.resumen.flete,
        pendientes: d.resumen.documentos_pendientes,
        alertas: d.alertas.length,
        diferencia_iva: d.conciliacion.diferencia_iva,
        lectura_calculo_ms: ms,
        json_bytes: Buffer.byteLength(JSON.stringify(d)),
        validacion:
          'cabeceras, libro IVA y listado comercial coinciden con SQL independiente',
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
          fuente: 'data_sept2026.sql (copia aislada; no certifica noviembre)',
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
