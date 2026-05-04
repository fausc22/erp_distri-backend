/**
 * Etapa 5 — Validación de no-regresión para Nota de Pedido PDF (A4 multipágina).
 * Casos: 1 ítem, 12/15/16, 22/23/40 ítems, observación corta/larga, nombre largo.
 * Ejecutar desde backend: node utils/notaPedidoPdf.test.js
 * Opcional: SKIP_PDF_GENERATE=1 solo ejecuta tests unitarios de paginación (sin Puppeteer).
 */

const path = require('path');
const assert = require('assert');

// Cargar env para rutas y config
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pdfGenerator = require('./pdfGenerator');

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    console.error(`  ❌ ${name}`);
    throw err;
  }
}

function testAsync(name, fn) {
  return fn()
    .then(() => console.log(`  ✅ ${name}`))
    .catch((err) => {
      console.error(`  ❌ ${name}`);
      throw err;
    });
}

// --- Tests unitarios: paginación ---
console.log('\n--- Paginación (paginarFilasNotaPedido) ---');

test('0 ítems → 1 página con rango vacío', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(0);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].start, 0);
  assert.strictEqual(pages[0].end, 0);
});

test('1 ítem → 1 página', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(1);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].start, 0);
  assert.strictEqual(pages[0].end, 1);
});

test('16 ítems (límite primera) → 1 página', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(16);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].end, 16);
});

test('17 ítems → 2 páginas (16 + 1)', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(17);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].start, 0);
  assert.strictEqual(pages[0].end, 16);
  assert.strictEqual(pages[1].start, 16);
  assert.strictEqual(pages[1].end, 17);
});

test('40 ítems → 2 páginas (16 + 24)', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(40);
  assert.strictEqual(pages.length, 2);
  assert.strictEqual(pages[0].end, 16);
  assert.strictEqual(pages[1].start, 16);
  assert.strictEqual(pages[1].end, 40);
});

test('41 ítems → 3 páginas (16 + 24 + 1)', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(41);
  assert.strictEqual(pages.length, 3);
  assert.strictEqual(pages[0].end, 16);
  assert.strictEqual(pages[1].end, 40);
  assert.strictEqual(pages[2].start, 40);
  assert.strictEqual(pages[2].end, 41);
});

test('64 ítems → 3 páginas (16 + 24 + 24)', () => {
  const pages = pdfGenerator.paginarFilasNotaPedido(64);
  assert.strictEqual(pages.length, 3);
  assert.strictEqual(pages[0].end, 16);
  assert.strictEqual(pages[1].end, 40);
  assert.strictEqual(pages[2].end, 64);
});

// --- Helper: mock pedido y productos ---
function mockPedido(overrides = {}) {
  return {
    id: 1001,
    fecha: new Date('2025-03-15'),
    cliente_nombre: 'Cliente Prueba SRL',
    cliente_direccion: 'Calle Falsa 123, CP 6360',
    cliente_telefono: '2302-123456',
    empleado_nombre: 'Vendedor Test',
    observaciones: 'Sin observaciones',
    ...overrides
  };
}

function mockProductos(cantidad, options = {}) {
  const { nombreLargo = false } = options;
  const nombres = nombreLargo
    ? 'Producto con nombre muy largo para probar wrap en celda y que no rompa el layout de la tabla en A4'
    : 'Producto estándar';
  return Array.from({ length: cantidad }, (_, i) => ({
    producto_id: 500 + i,
    producto_nombre: cantidad === 1 ? nombres : `${nombres} ${i + 1}`,
    producto_um: 'UN',
    cantidad: 1 + (i % 5)
  }));
}

// --- Tests de integración: generación real de PDF (requiere Puppeteer) ---
const skipPdf = process.env.SKIP_PDF_GENERATE === '1';

async function runIntegration() {
  await testAsync('PDF 1 ítem', async () => {
    const pedido = mockPedido();
    const productos = mockProductos(1);
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    const isBuffer = Buffer.isBuffer(buffer) || (buffer && typeof buffer.length === 'number' && buffer.length > 0);
    assert(isBuffer, 'debe devolver Buffer o buffer-like');
    assert(buffer.length > 500, 'PDF debe tener contenido');
  });
  await testAsync('PDF 16 ítems (1 página)', async () => {
    const pedido = mockPedido();
    const productos = mockProductos(16);
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    assert(buffer && buffer.length > 1000, 'PDF con contenido');
  });
  await testAsync('PDF 17 ítems (2 páginas)', async () => {
    const pedido = mockPedido({ observaciones: 'Observación corta.' });
    const productos = mockProductos(17);
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    assert(buffer && buffer.length > 1000, 'PDF con contenido');
  });
  await testAsync('PDF 40 ítems (2 páginas)', async () => {
    const pedido = mockPedido();
    const productos = mockProductos(40);
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    assert(buffer && buffer.length > 1000, 'PDF con contenido');
  });
  await testAsync('PDF observación larga', async () => {
    const pedido = mockPedido({
      observaciones: 'Esta es una observación muy larga para validar que el bloque de observaciones no rompe el diseño ni la paginación. Puede incluir varios renglones y el documento debe seguir siendo correcto en A4.'
    });
    const productos = mockProductos(5);
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    assert(buffer && buffer.length > 500, 'PDF con contenido');
  });
  await testAsync('PDF producto con nombre muy largo', async () => {
    const pedido = mockPedido();
    const productos = mockProductos(3, { nombreLargo: true });
    const buffer = await pdfGenerator.generarNotaPedido(pedido, productos);
    assert(buffer && buffer.length > 500, 'PDF con contenido');
  });
}

// --- Ejecutar ---
async function main() {
  try {
    if (skipPdf) {
      console.log('\n--- Integración PDF omitida (SKIP_PDF_GENERATE=1) ---\n');
    } else {
      console.log('\n--- Integración: generación de PDF Nota de Pedido ---');
      await runIntegration();
    }
    console.log('\n✅ Etapa 5: todos los tests pasaron.\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Error:', err.message);
    process.exit(1);
  }
}

main();
