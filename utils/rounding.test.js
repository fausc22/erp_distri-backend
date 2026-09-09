/**
 * Tests unitarios para la utilidad de redondeo de facturación.
 * Regla: redondeo estándar (>= 0.50 sube, < 0.50 baja).
 * Ejecutar desde la raíz del backend: node utils/rounding.test.js
 */

const assert = require('assert');
const { roundFacturacion, redondearImportes, resolvePorcentajeIva, obtenerPorcentajeIva, inferPorcentajeIvaDesdeLinea, resolvePorcentajeIvaLinea, mapAlicuotaArca } = require('./rounding');

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

console.log('resolvePorcentajeIva:');
test('preserva IVA 0%', () => {
  assert.strictEqual(resolvePorcentajeIva(0), 0);
  assert.strictEqual(resolvePorcentajeIva('0'), 0);
  assert.strictEqual(resolvePorcentajeIva('0.00'), 0);
  assert.strictEqual(resolvePorcentajeIva(0.0), 0);
});

test('preserva 10.5 y 21', () => {
  assert.strictEqual(resolvePorcentajeIva(10.5), 10.5);
  assert.strictEqual(resolvePorcentajeIva('10.50'), 10.5);
  assert.strictEqual(resolvePorcentajeIva(21), 21);
  assert.strictEqual(resolvePorcentajeIva('21.00'), 21);
});

test('fallback solo si falta o es inválido', () => {
  assert.strictEqual(resolvePorcentajeIva(null), 21);
  assert.strictEqual(resolvePorcentajeIva(undefined), 21);
  assert.strictEqual(resolvePorcentajeIva(''), 21);
  assert.strictEqual(resolvePorcentajeIva(NaN), 21);
  assert.strictEqual(resolvePorcentajeIva(-1), 21);
  assert.strictEqual(resolvePorcentajeIva(null, 10.5), 10.5);
});

console.log('obtenerPorcentajeIva:');
test('usa porcentaje_iva aunque iva (importe) exista', () => {
  assert.strictEqual(obtenerPorcentajeIva({ porcentaje_iva: 0, iva: 2.52 }), 0);
  assert.strictEqual(obtenerPorcentajeIva({ porcentaje_iva: 21, iva: 2.10 }), 21);
});

test('usa iva de catálogo si no hay porcentaje_iva', () => {
  assert.strictEqual(obtenerPorcentajeIva({ iva: 0 }), 0);
  assert.strictEqual(obtenerPorcentajeIva({ iva: 10.5 }), 10.5);
  assert.strictEqual(obtenerPorcentajeIva({}), 21);
});

console.log('inferPorcentajeIvaDesdeLinea / resolvePorcentajeIvaLinea:');
test('infiere 0% y 21% desde montos', () => {
  assert.strictEqual(inferPorcentajeIvaDesdeLinea(0, 120000), 0);
  assert.strictEqual(inferPorcentajeIvaDesdeLinea(292572, 1393200), 21);
  assert.strictEqual(inferPorcentajeIvaDesdeLinea(20826.45, 99173.55), 21);
});

test('resolvePorcentajeIvaLinea prioriza columna', () => {
  assert.strictEqual(resolvePorcentajeIvaLinea({ porcentaje_iva: 0, iva: 100, subtotal: 100 }), 0);
  assert.strictEqual(resolvePorcentajeIvaLinea({ iva: 0, subtotal: 48000 }), 0);
});

console.log('mapAlicuotaArca:');
test('mapea a Ids AFIP', () => {
  assert.strictEqual(mapAlicuotaArca(0), 3);
  assert.strictEqual(mapAlicuotaArca(10.5), 4);
  assert.strictEqual(mapAlicuotaArca(21), 5);
  assert.strictEqual(mapAlicuotaArca(27), 6);
});

console.log('\n✅ Todos los tests pasaron.');
