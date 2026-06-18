const assert = require('assert');
const crypto = require('crypto');

function generarHashPedido(pedidoData) {
  const datosNormalizados = {
    cliente_id: pedidoData.cliente_id,
    subtotal: parseFloat(pedidoData.subtotal || 0).toFixed(2),
    iva_total: parseFloat(pedidoData.iva_total || 0).toFixed(2),
    total: parseFloat(pedidoData.total || 0).toFixed(2),
    empleado_id: pedidoData.empleado_id || 1,
    fecha: '2026-01-01',
    productos: (pedidoData.productos || [])
      .map((p) => ({
        id: p.id,
        cantidad: parseFloat(p.cantidad || 0),
        precio: parseFloat(p.precio || 0).toFixed(2),
        subtotal: parseFloat(p.subtotal || 0).toFixed(2),
        descuento_porcentaje: parseFloat(p.descuento_porcentaje || 0).toFixed(2)
      }))
      .sort((a, b) => a.id - b.id)
  };
  return crypto.createHash('sha256').update(JSON.stringify(datosNormalizados)).digest('hex');
}

async function run() {
  const pedido = {
    cliente_id: 10,
    subtotal: 100,
    iva_total: 21,
    total: 121,
    empleado_id: 2,
    productos: [
      { id: 2, cantidad: 1, precio: 70, subtotal: 70, descuento_porcentaje: 0 },
      { id: 1, cantidad: 2, precio: 15, subtotal: 30, descuento_porcentaje: 0 }
    ]
  };

  const hashA = generarHashPedido(pedido);
  const hashB = generarHashPedido({
    ...pedido,
    productos: [...pedido.productos].reverse()
  });

  assert.strictEqual(hashA, hashB);
  console.log('✅ pedidos.nuevoPedido.test.js OK');
}

run().catch((error) => {
  console.error('❌ pedidos.nuevoPedido.test.js FAIL', error);
  process.exit(1);
});
