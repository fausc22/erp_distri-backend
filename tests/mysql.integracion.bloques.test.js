/**
 * Integración real MySQL aislado (socket local). NO usa .env productivo.
 * Cubre: proyección fiscal, libro secciones, motor v1 persistencia, liberarSerie propietario.
 */
const assert = require('assert');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

const SOCK = '/tmp/erp-reportes-mysql/mysql.sock';
// Lectura/validación sobre copia del dump; escrituras en transacción con rollback.
const DB = process.env.ERP_TEST_DB || 'erp_reportes_nov2026';

async function run() {
  if (!fs.existsSync(SOCK)) {
    console.log('⏭️  mysql.integracion.bloques.test.js OMITIDO: no hay MySQL aislado en', SOCK);
    return;
  }

  let conn;
  try {
    conn = await mysql.createConnection({
      socketPath: SOCK,
      user: 'root',
      database: DB,
    });
  } catch (e) {
    console.log('⏭️  mysql.integracion.bloques.test.js OMITIDO: no conecta', e.message);
    return;
  }

  try {
    const dbName = (await conn.query('SELECT DATABASE() AS d'))[0][0].d;
    console.log('DB:', dbName);

    // --- Proyección sin multiplicación + columnas fiscales ---
    const { buildProyeccionBaseSQL } = require('../consultas/proyeccion');
    const { libroIvaRevision } = require('../consultas/vistas');

    const [[tableCheck]] = await conn.query(
      `SELECT COUNT(*) AS c FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name = 'arca_autorizaciones_canonicas'`
    );
    assert.ok(tableCheck.c > 0, 'Falta arca_autorizaciones_canonicas — aplicar migraciones');

    const sql = buildProyeccionBaseSQL({
      where: `DATE(COALESCE(v.fecha_fiscal, v.fecha)) BETWEEN ? AND ? AND UPPER(TRIM(v.tipo_f)) IN ('A','B')`,
    });
    const [rows] = await conn.query(sql, ['2026-10-01', '2026-10-31']);
    assert.ok(rows.length > 0, 'proyección octubre vacía');
    const ids = new Set(rows.map((r) => r.venta_id));
    assert.strictEqual(ids.size, rows.length, 'multiplicación por JOIN');
    assert.ok('importe_comercial' in rows[0], 'falta importe_comercial');
    assert.ok('calidad_importe_fiscal' in rows[0], 'falta calidad_importe_fiscal');
    assert.ok('importe_fiscal_respaldado' in rows[0], 'falta importe_fiscal_respaldado');

    const libro = libroIvaRevision(rows);
    assert.ok(Array.isArray(libro.acreditados));
    assert.ok(Array.isArray(libro.seccionPendientes));
    assert.ok(Array.isArray(libro.discrepantes));
    console.log(
      'libro oct',
      'acr', libro.acreditados.length,
      'disc', libro.discrepantes.length,
      'pend', libro.seccionPendientes.length,
      'evid', libro.evidenciaIncompleta.length
    );

    // Ningún pendiente debe tener verificado=true
    assert.ok(libro.seccionPendientes.every((r) => !r.verificado));

    // --- Motor v1: persistencia venta_calculos en transacción rollback ---
    process.env.MOTOR_CALCULO_VERSION = 'v1';
    delete require.cache[require.resolve('../dominio/calculo/sombra')];
    const { resolverImportes, persistirResultadoMotor } = require('../dominio/calculo/sombra');

    const resolved = resolverImportes({
      productos: [{ linea_id: 't1', precio: 1000, cantidad: 1, porcentaje_iva: 21 }],
    });
    assert.strictEqual(resolved.usarMotor, true);
    assert.strictEqual(resolved.importes.total, 1210); // pesos
    assert.strictEqual(String(resolved.resultado.totales.total), '121000'); // centavos

    await conn.beginTransaction();
    const [ventasSample] = await conn.query(`SELECT id FROM ventas ORDER BY id DESC LIMIT 1`);
    const ventaId = ventasSample[0]?.id;
    assert.ok(ventaId, 'sin ventas en DB de prueba');

    await persistirResultadoMotor(conn, ventaId, resolved.resultado, 'v1');
    const [calcRows] = await conn.query(
      `SELECT id, regla_version, total_centavos, ok, resultado_json FROM venta_calculos WHERE venta_id = ? ORDER BY creado_en DESC LIMIT 1`,
      [ventaId]
    );
    assert.ok(calcRows.length === 1);
    assert.strictEqual(calcRows[0].regla_version, 'v1');
    assert.strictEqual(Number(calcRows[0].ok), 1);
    assert.strictEqual(String(calcRows[0].total_centavos), '121000');
    await conn.rollback();
    console.log('motor v1 persistencia OK (rollback)');

    // --- liberarSerie propietario en MySQL real ---
    const { buildSerieClave, reservarSerie, liberarSerie } = require('../services/arcaSeriesCoordinator');
    const clave = buildSerieClave({
      cuit: '30999999991',
      entorno: 'homologacion',
      cbteTipo: 99,
      ptoVta: 99,
    });
    await conn.beginTransaction();
    await conn.query(`DELETE FROM arca_series_estado WHERE serie_clave = ?`, [clave]);
    await reservarSerie(conn, { serieClave: clave, intentoId: 7001 });
    const libBad = await liberarSerie(conn, { serieClave: clave, estadoFinal: 'LIBRE', intentoId: 7002 });
    assert.strictEqual(libBad.liberado, false);
    const [st1] = await conn.query(`SELECT estado, intento_activo_id FROM arca_series_estado WHERE serie_clave = ?`, [clave]);
    assert.strictEqual(st1[0].estado, 'EN_CURSO');
    assert.strictEqual(Number(st1[0].intento_activo_id), 7001);
    const libOk = await liberarSerie(conn, { serieClave: clave, estadoFinal: 'LIBRE', intentoId: 7001 });
    assert.strictEqual(libOk.liberado, true);
    await conn.query(`DELETE FROM arca_series_estado WHERE serie_clave = ?`, [clave]);
    await conn.commit();
    console.log('liberarSerie propietario OK');

    // --- Idempotencia UUID conflicto ---
    const operacionesIdempotencia = require('../services/operacionesIdempotencia');
    await conn.beginTransaction();
    const uuid = crypto.randomUUID();
    await operacionesIdempotencia.beginOperacion(conn, {
      operacionId: uuid,
      tipoOperacion: 'test_bloque',
      payload: { a: 1 },
    });
    await operacionesIdempotencia.completeOperacion(conn, {
      operacionId: uuid,
      ventaId: null,
      resultado: { ok: true },
    });
    let conflict = false;
    try {
      await operacionesIdempotencia.beginOperacion(conn, {
        operacionId: uuid,
        tipoOperacion: 'test_bloque',
        payload: { a: 2 },
      });
    } catch (e) {
      conflict = e.code === 'OPERACION_CONFLICTO';
    }
    assert.ok(conflict);
    await conn.rollback();

    console.log('✅ mysql.integracion.bloques.test.js OK');
  } finally {
    await conn.end();
  }
  // legacyAdapter puede dejar pool abierto al require de proyección
  process.exit(0);
}

run().catch((e) => {
  console.error('❌ mysql.integracion.bloques.test.js FAIL', e);
  process.exit(1);
});
