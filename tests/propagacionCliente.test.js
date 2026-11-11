const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  pedidoRecibeDatosCliente,
  ventaRecibeDatosCliente
} = require('../utils/propagacionCliente');

test('pedido Exportado y Anulado reciben datos; Facturado no', () => {
  assert.equal(pedidoRecibeDatosCliente('Exportado'), true);
  assert.equal(pedidoRecibeDatosCliente('Anulado'), true);
  assert.equal(pedidoRecibeDatosCliente('Facturado'), false);
  assert.equal(pedidoRecibeDatosCliente(''), true);
  assert.equal(pedidoRecibeDatosCliente(null), true);
});

test('venta X siempre recibe datos del cliente', () => {
  assert.equal(ventaRecibeDatosCliente('X', null, null), true);
  assert.equal(ventaRecibeDatosCliente('x', '123', 'A'), true);
});

test('venta A/B con CAE aprobado (resultado A) no recibe datos', () => {
  assert.equal(ventaRecibeDatosCliente('A', '86440824744476', 'A'), false);
  assert.equal(ventaRecibeDatosCliente('B', '86440824744476', 'a'), false);
});

test('venta A/B sin CAE o rechazada sí recibe datos', () => {
  assert.equal(ventaRecibeDatosCliente('A', null, null), true);
  assert.equal(ventaRecibeDatosCliente('B', '', ''), true);
  assert.equal(ventaRecibeDatosCliente('A', null, 'R'), true);
  assert.equal(ventaRecibeDatosCliente('B', '123', 'R'), true);
  assert.equal(ventaRecibeDatosCliente('A', '', 'A'), true);
});

test('tipos distintos de X/A/B no reciben propagación automática', () => {
  assert.equal(ventaRecibeDatosCliente('C', null, null), false);
  assert.equal(ventaRecibeDatosCliente('', null, null), false);
});
