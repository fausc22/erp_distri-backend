const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { buildSerieClave } = require('../services/arcaSeriesCoordinator');
const { buildEventoClave } = require('../services/eventoClaveEfectos');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  assert.strictEqual(
    buildSerieClave({ cuit: '20304050607', entorno: 'homo', cbteTipo: 6, ptoVta: 3 }),
    '20304050607:homo:6:3'
  );

  assert.strictEqual(buildEventoClave('movimiento_stock', 42, 'facturacion'), 'movimiento_stock:42:facturacion');
  assert.strictEqual(buildEventoClave('remito', 42), 'remito:42');

  const eventoClaveEfectos = read('services/eventoClaveEfectos.js');
  assert.ok(!/INSERT\s+IGNORE/i.test(eventoClaveEfectos), 'eventoClaveEfectos.js no debe usar INSERT IGNORE');

  console.log('✅ e2_coordinator.test.js OK');
}

run().catch((error) => {
  console.error('❌ e2_coordinator.test.js FAIL', error);
  process.exit(1);
});
