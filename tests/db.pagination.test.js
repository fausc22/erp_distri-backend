const assert = require('assert');
require('dotenv').config();

async function run() {
  if (!process.env.DB_HOST) {
    console.log('⏭️  db.pagination.test.js SKIP (sin DB_HOST)');
    return;
  }

  const db = require('../db/legacyAdapter');

  const rows = await new Promise((resolve, reject) => {
    db.query(
      'SELECT id FROM pedidos ORDER BY fecha DESC LIMIT ? OFFSET ?',
      [5, 0],
      (err, results) => (err ? reject(err) : resolve(results))
    );
  });

  assert.ok(Array.isArray(rows), 'debe devolver un array');
  assert.ok(rows.length <= 5, 'debe respetar LIMIT');

  const finanzas = await new Promise((resolve, reject) => {
    db.query(
      `SELECT vc.producto_id FROM ventas v
       JOIN ventas_cont vc ON vc.venta_id = v.id
       WHERE v.estado = 'Facturada'
       GROUP BY vc.producto_id
       ORDER BY vc.producto_id DESC
       LIMIT ?`,
      [3],
      (err, results) => (err ? reject(err) : resolve(results))
    );
  });

  assert.ok(Array.isArray(finanzas));
  assert.ok(finanzas.length <= 3);

  console.log('✅ db.pagination.test.js OK');
  const dbIndex = require('../db');
  if (dbIndex.end) await dbIndex.end();
}

run().catch((error) => {
  console.error('❌ db.pagination.test.js FAIL', error);
  process.exit(1);
});
