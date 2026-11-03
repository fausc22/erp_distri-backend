const mysql = require('mysql2/promise');

const args = new Set(process.argv.slice(2));
const apply = args.has('--apply');
const dryRun = !apply || args.has('--dry-run');

const socketPath =
  process.env.REPORTES_TEST_SOCKET || '/tmp/erp-reportes-mysql/mysql.sock';
const database = process.env.REPORTES_COPY_DATABASE || 'erp_reportes_nov2026';

async function printCounts(conn, title, sql) {
  const [rows] = await conn.query(sql);
  console.log(title);
  for (const row of rows) {
    console.log(`  ${row.clasificacion}: ${row.cantidad}`);
  }
}

async function run() {
  const conn = await mysql.createConnection({
    socketPath,
    user: 'root',
    database,
    multipleStatements: false,
  });

  try {
    await conn.beginTransaction();

    console.log(
      JSON.stringify({
        database,
        socketPath,
        mode: dryRun ? 'dry-run' : 'apply',
      })
    );

    await printCounts(
      conn,
      'estado_fiscal calculado',
      `SELECT clasificacion, COUNT(*) AS cantidad
       FROM (
         SELECT CASE
           WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) = 'X' THEN 'NO_APLICA'
           WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) IN ('A','B')
             AND NULLIF(TRIM(COALESCE(v.cae_id, '')), '') IS NOT NULL THEN 'AUTORIZADO'
           WHEN EXISTS (
             SELECT 1
             FROM arca_solicitudes_log asl
             WHERE asl.venta_id = v.id
               AND UPPER(TRIM(COALESCE(asl.estado, ''))) = 'EN_PROCESO'
               AND COALESCE(asl.fecha_solicitud, '1970-01-01') < DATE_SUB(NOW(), INTERVAL 65 SECOND)
           ) THEN 'DESCONOCIDO'
           ELSE 'SIN_SOLICITUD'
         END AS clasificacion
         FROM ventas v
       ) c
       GROUP BY clasificacion
       ORDER BY clasificacion`
    );

    const [estadoFiscalResult] = await conn.query(
      `UPDATE ventas v
       SET estado_fiscal = CASE
         WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) = 'X' THEN 'NO_APLICA'
         WHEN UPPER(TRIM(COALESCE(v.tipo_f, ''))) IN ('A','B')
           AND NULLIF(TRIM(COALESCE(v.cae_id, '')), '') IS NOT NULL THEN 'AUTORIZADO'
         WHEN EXISTS (
           SELECT 1
           FROM arca_solicitudes_log asl
           WHERE asl.venta_id = v.id
             AND UPPER(TRIM(COALESCE(asl.estado, ''))) = 'EN_PROCESO'
             AND COALESCE(asl.fecha_solicitud, '1970-01-01') < DATE_SUB(NOW(), INTERVAL 65 SECOND)
         ) THEN 'DESCONOCIDO'
         ELSE 'SIN_SOLICITUD'
       END
       WHERE v.estado_fiscal IS NULL`
    );
    console.log(`estado_fiscal filas afectadas: ${estadoFiscalResult.affectedRows}`);

    await printCounts(
      conn,
      'vendedor_atribuible calculado',
      `SELECT clasificacion, COUNT(*) AS cantidad
       FROM (
         SELECT CASE
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_CREDITO','NOTA_DEBITO')
             AND v.venta_referencia_id IS NOT NULL
             AND ref.empleado_id IS NOT NULL THEN 'referencia'
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) NOT IN ('NOTA_CREDITO','NOTA_DEBITO') THEN 'propio'
           ELSE 'sin_atribucion'
         END AS clasificacion
         FROM ventas v
         LEFT JOIN ventas ref ON ref.id = v.venta_referencia_id
       ) c
       GROUP BY clasificacion
       ORDER BY clasificacion`
    );

    const [vendedorResult] = await conn.query(
      `UPDATE ventas v
       LEFT JOIN ventas ref ON ref.id = v.venta_referencia_id
       SET
         v.vendedor_atribuible_id = CASE
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_CREDITO','NOTA_DEBITO')
             AND v.venta_referencia_id IS NOT NULL
             AND ref.empleado_id IS NOT NULL THEN ref.empleado_id
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) NOT IN ('NOTA_CREDITO','NOTA_DEBITO') THEN v.empleado_id
           ELSE NULL
         END,
         v.vendedor_atribuible_origen = CASE
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) IN ('NOTA_CREDITO','NOTA_DEBITO')
             AND v.venta_referencia_id IS NOT NULL
             AND ref.empleado_id IS NOT NULL THEN 'referencia'
           WHEN UPPER(TRIM(COALESCE(v.tipo_doc, 'FACTURA'))) NOT IN ('NOTA_CREDITO','NOTA_DEBITO') THEN 'propio'
           ELSE 'sin_atribucion'
         END
       WHERE v.vendedor_atribuible_origen IS NULL`
    );
    console.log(
      `vendedor_atribuible filas afectadas: ${vendedorResult.affectedRows}`
    );

    const [conciliacionResult] = await conn.query(
      `UPDATE ventas
       SET estado_conciliacion = 'NO_EVALUADO'
       WHERE estado_conciliacion IS NULL`
    );
    console.log(
      `estado_conciliacion filas afectadas: ${conciliacionResult.affectedRows}`
    );

    await printCounts(
      conn,
      'estado_fiscal final',
      `SELECT COALESCE(estado_fiscal, 'NULL') AS clasificacion, COUNT(*) AS cantidad
       FROM ventas
       GROUP BY clasificacion
       ORDER BY clasificacion`
    );

    await printCounts(
      conn,
      'vendedor_atribuible_origen final',
      `SELECT COALESCE(vendedor_atribuible_origen, 'NULL') AS clasificacion, COUNT(*) AS cantidad
       FROM ventas
       GROUP BY clasificacion
       ORDER BY clasificacion`
    );

    if (dryRun) {
      await conn.rollback();
      console.log('dry-run: cambios revertidos');
    } else {
      await conn.commit();
      console.log('apply: cambios confirmados');
    }
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    await conn.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
