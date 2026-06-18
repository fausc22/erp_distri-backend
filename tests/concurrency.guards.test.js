const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  const finanzasSvc = read('services/finanzasService.js');
  const pedidosRepo = read('repositories/pedidosRepository.js');
  const transaction = read('db/transaction.js');

  // Guardas de concurrencia / transacción
  assert.ok(finanzasSvc.includes('withTransaction'));
  assert.ok(finanzasSvc.includes('obtenerCuentaPorIdForUpdate'));
  assert.ok(finanzasSvc.includes('ER_LOCK_DEADLOCK'));
  assert.ok(finanzasSvc.includes('ER_LOCK_WAIT_TIMEOUT'));
  assert.ok(finanzasSvc.includes('ER_DUP_ENTRY'));

  // Bloqueo explícito para edición crítica
  assert.ok(pedidosRepo.includes('FOR UPDATE'));

  // Garantía de commit/rollback centralizada
  assert.ok(transaction.includes('await conn.beginTransaction()'));
  assert.ok(transaction.includes('await conn.commit()'));
  assert.ok(transaction.includes('await conn.rollback()'));

  console.log('✅ concurrency.guards.test.js OK');
}

run().catch((error) => {
  console.error('❌ concurrency.guards.test.js FAIL', error);
  process.exit(1);
});
