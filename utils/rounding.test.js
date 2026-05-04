/**
 * Tests unitarios para la utilidad de redondeo de facturación.
 * Regla: redondeo estándar (>= 0.50 sube, < 0.50 baja).
 * Ejecutar desde la raíz del backend: node utils/rounding.test.js
 */

const assert = require('assert');
const { roundFacturacion, redondearImportes } = require('./rounding');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    throw err;
  }
}

console.log('roundFacturacion:');
test('entero se mantiene', () => {
  assert.strictEqual(roundFacturacion(10), 10);
  assert.strictEqual(roundFacturacion(0), 0);
});

test('decimal < 0.50 baja al entero', () => {
  assert.strictEqual(roundFacturacion(10.01), 10);
  assert.strictEqual(roundFacturacion(10.49), 10);
  assert.strictEqual(roundFacturacion(0.49), 0);
});

test('decimal >= 0.50 sube al siguiente entero', () => {
  assert.strictEqual(roundFacturacion(10.5), 11);
  assert.strictEqual(roundFacturacion(10.50), 11);
  assert.strictEqual(roundFacturacion(10.99), 11);
  assert.strictEqual(roundFacturacion(0.5), 1);
});

test('límite punto flotante 10.6', () => {
  const r = roundFacturacion(10.6);
  assert.strictEqual(r, 11, `10.6 debe redondear a 11, obtuvo ${r}`);
});

test('valores altos', () => {
  assert.strictEqual(roundFacturacion(99.5), 100);
  assert.strictEqual(roundFacturacion(99.6), 100);
});

test('string numérico', () => {
  assert.strictEqual(roundFacturacion('10.49'), 10);
  assert.strictEqual(roundFacturacion('10.50'), 11);
});

test('no numérico retorna 0', () => {
  assert.strictEqual(roundFacturacion(NaN), 0);
  assert.strictEqual(roundFacturacion(Infinity), 0);
  assert.strictEqual(roundFacturacion('abc'), 0);
});

console.log('redondearImportes:');
test('redondea todas las keys indicadas', () => {
  const out = redondearImportes(
    { subtotal: 100.5, iva_total: 21.6, exento: 0, total: 122.5 },
    ['subtotal', 'iva_total', 'exento', 'total']
  );
  assert.strictEqual(out.subtotal, 101);
  assert.strictEqual(out.iva_total, 22);
  assert.strictEqual(out.exento, 0);
  assert.strictEqual(out.total, 123);
});

test('solo incluye keys solicitadas', () => {
  const out = redondearImportes({ a: 1.6, b: 2.3 }, ['a']);
  assert.strictEqual(out.a, 2);
  assert.strictEqual('b' in out, false);
});

console.log('\n✅ Todos los tests pasaron.');
