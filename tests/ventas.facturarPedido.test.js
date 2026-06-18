const assert = require('assert');
const { roundFacturacion } = require('../utils/rounding');

async function run() {
  const subtotal = 100.6;
  const iva = 21.12;
  const total = subtotal + iva;

  assert.strictEqual(roundFacturacion(subtotal), 101);
  assert.strictEqual(roundFacturacion(iva), 21);
  assert.strictEqual(roundFacturacion(total), 122);

  console.log('✅ ventas.facturarPedido.test.js OK');
}

run().catch((error) => {
  console.error('❌ ventas.facturarPedido.test.js FAIL', error);
  process.exit(1);
});
