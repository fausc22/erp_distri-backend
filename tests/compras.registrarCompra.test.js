const assert = require('assert');
const AppError = require('../errors/AppError');

async function run() {
  const error = new AppError('Datos inválidos', 'VALIDATION_ERROR', 400, {
    campo: 'proveedor_id'
  });
  assert.strictEqual(error.code, 'VALIDATION_ERROR');
  assert.strictEqual(error.statusCode, 400);
  assert.deepStrictEqual(error.details, { campo: 'proveedor_id' });
  console.log('✅ compras.registrarCompra.test.js OK');
}

run().catch((error) => {
  console.error('❌ compras.registrarCompra.test.js FAIL', error);
  process.exit(1);
});
