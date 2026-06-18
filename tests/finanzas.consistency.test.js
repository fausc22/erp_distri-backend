const assert = require('assert');
require('dotenv').config();
const {
  construirWhereVentas,
  TOTAL_NETO,
  GANANCIA_LINEA,
  normalizarFiltrosReportes
} = require('../utils/finanzasSql');

async function run() {
  const filtros = normalizarFiltrosReportes({ desde: '2026-06-01', hasta: '2026-06-16', limite: 20 });
  const { whereSql, params } = construirWhereVentas(filtros, 'v');

  assert.ok(whereSql.includes("estado = 'Facturada'"));
  assert.ok(whereSql.includes('NOTA_CREDITO'));
  assert.strictEqual(params.length, 2);
  assert.strictEqual(filtros.limite, 20);

  assert.ok(TOTAL_NETO('v').includes('NOTA_CREDITO'));
  assert.ok(GANANCIA_LINEA().includes('0.25'));

  if (!process.env.DB_HOST) {
    console.log('⏭️  finanzas.consistency.test.js SKIP queries (sin DB_HOST)');
    console.log('✅ finanzas.consistency.test.js OK (helpers)');
    return;
  }

  const db = require('../db/legacyAdapter');
  const ejecutar = (sql, p) =>
    new Promise((resolve, reject) => {
      db.query(sql, p, (err, rows) => (err ? reject(err) : resolve(rows)));
    });

  const filtrosEstrechos = { ...filtros, desde: filtros.hasta, hasta: filtros.hasta };
  const narrow = construirWhereVentas(filtrosEstrechos, 'v');

  const queryFacturacion = `
    SELECT ROUND(SUM(${TOTAL_NETO('v')}), 2) AS facturacion
    FROM ventas v WHERE ${narrow.whereSql}
  `;
  const queryGanancia = `
    SELECT ROUND(SUM(${GANANCIA_LINEA('vc', 'p', 'v')}), 2) AS ganancia
    FROM ventas v
    JOIN ventas_cont vc ON vc.venta_id = v.id
    LEFT JOIN productos p ON p.id = vc.producto_id
    WHERE ${narrow.whereSql}
  `;

  const [factRow, ganRow] = await Promise.all([
    ejecutar(queryFacturacion, narrow.params),
    ejecutar(queryGanancia, narrow.params)
  ]);

  const facturacion = Number(factRow[0]?.facturacion || 0);
  const ganancia = Number(ganRow[0]?.ganancia || 0);

  assert.ok(Number.isFinite(facturacion), 'facturación debe ser numérica');
  assert.ok(Number.isFinite(ganancia), 'ganancia debe ser numérica');
  if (facturacion > 0) {
    assert.ok(ganancia <= facturacion + 0.01, 'ganancia no puede superar facturación neta');
  }

  console.log('✅ finanzas.consistency.test.js OK', { facturacion, ganancia });
  const dbIndex = require('../db');
  if (dbIndex.end) await dbIndex.end();
}

run().catch((error) => {
  console.error('❌ finanzas.consistency.test.js FAIL', error);
  process.exit(1);
});
