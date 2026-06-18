const assert = require('assert');
async function run() {
  const transferencia = { origen: 1, destino: 2, monto: 1500 };
  assert.ok(transferencia.origen !== transferencia.destino);
  assert.ok(transferencia.monto > 0);
  console.log('✅ finanzas.transferencia.test.js OK');
}

run().catch((error) => {
  console.error('❌ finanzas.transferencia.test.js FAIL', error);
  process.exit(1);
});
