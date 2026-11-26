/**
 * Tests unitarios del paginador ARCA (sin Chrome).
 * Ejecutar: node utils/facturaArcaPaginacion.test.js
 */

const assert = require('assert');
const path = require('path');
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

function assertCoverage(pages, totalRows) {
  assert.ok(pages.length >= 1, 'debe haber al menos una página');
  assert.strictEqual(pages[0].start, 0, 'primera página empieza en 0');
  assert.strictEqual(pages[pages.length - 1].end, totalRows, 'última página termina en totalRows');
  assert.strictEqual(pages[pages.length - 1].isLast, true, 'última marcada isLast');

  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    assert.ok(p.end >= p.start, `página ${i}: end >= start`);
    if (i < pages.length - 1) {
      assert.strictEqual(p.isLast, false, `página intermedia ${i} no es last`);
      assert.strictEqual(p.end, pages[i + 1].start, `página ${i} conecta con ${i + 1}`);
      assert.ok(p.end > p.start, `página intermedia ${i} no vacía`);
    }
  }

  const covered = [];
  for (const p of pages) {
    for (let i = p.start; i < p.end; i++) covered.push(i);
  }
  assert.deepStrictEqual(covered, Array.from({ length: totalRows }, (_, i) => i));
}

function sumRange(heights, start, end) {
  let s = 0;
  for (let i = start; i < end; i++) s += heights[i];
  return s;
}

console.log('\n--- Paginación ARCA (paginarFilasFacturaARCA) ---');

test('0 filas → 1 página vacía con pie', () => {
  const pages = pdfGenerator.paginarFilasFacturaARCA([], 400, 200);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].start, 0);
  assert.strictEqual(pages[0].end, 0);
  assert.strictEqual(pages[0].isLast, true);
});

test('todo cabe en availableFinal → 1 página', () => {
  const heights = Array(8).fill(20);
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 400, 200);
  assert.strictEqual(pages.length, 1);
  assert.strictEqual(pages[0].end, 8);
  assert.strictEqual(pages[0].isLast, true);
  assertCoverage(pages, 8);
});

test('30 filas cortas: menos hojas que con tope 10 y última no queda en 1 si hay lugar', () => {
  const heights = Array(30).fill(20);
  const availableIntermedia = 440; // ~22 filas
  const availableFinal = 200; // ~10 filas
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, availableIntermedia, availableFinal, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });

  assertCoverage(pages, 30);
  assert.ok(pages.length <= 3, `esperaba ≤3 páginas, got ${pages.length}`);
  // Con tope viejo de 10 serían al menos 4 páginas (10+10+10+0)
  assert.ok(pages.length < 4, `debe mejorar el tope de 10: got ${pages.length}`);

  const last = pages[pages.length - 1];
  const lastCount = last.end - last.start;
  // Si hay lugar en availableFinal para más de 1, no debe quedar en 1
  assert.ok(lastCount > 1, `última hoja no debe quedar con 1 ítem si hay lugar: got ${lastCount}`);
  assert.ok(
    sumRange(heights, last.start, last.end) <= availableFinal + 0.01,
    'última hoja cabe en availableFinal'
  );
});

test('fila más alta que la hoja intermedia: se emite igual', () => {
  const heights = [500, 20, 20];
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 100, 80, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, 3);
  assert.strictEqual(pages[0].start, 0);
  assert.strictEqual(pages[0].end, 1);
});

test('alturas mixtas: cobertura exacta 0..n', () => {
  const heights = [25, 40, 25, 60, 25, 25, 45, 25, 30, 25, 25, 50];
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 150, 90, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, heights.length);

  for (let i = 0; i < pages.length - 1; i++) {
    const p = pages[i];
    const h = sumRange(heights, p.start, p.end);
    const rows = p.end - p.start;
    if (rows > 1) {
      assert.ok(h <= 150 + 0.01, `intermedia ${i} no debe superar availableIntermedia`);
    }
  }
});

test('12 filas / final cabe 11: última NO queda en 1 (máximo al pie)', () => {
  // Caso real: ~12 ítems a 24 px, availableFinal ~266 → caben 11 con pie.
  const heights = Array(12).fill(24);
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 588, 266, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, 12);
  const last = pages[pages.length - 1];
  const lastCount = last.end - last.start;
  assert.ok(lastCount >= 10, `última debe llevar ~11, got ${lastCount}`);
  assert.notStrictEqual(lastCount, 1, 'última no puede ser hoja huérfana de 1 ítem');
  assert.ok(sumRange(heights, last.start, last.end) <= 266 + 0.01);
});

test('18 filas: última llena al máximo del pie (~11), no 17+1', () => {
  const heights = Array(18).fill(24);
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 588, 266, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, 18);
  const last = pages[pages.length - 1];
  const lastCount = last.end - last.start;
  assert.ok(lastCount >= 10, `última ~11 ítems, got ${lastCount}`);
  assert.ok(pages[0].end - pages[0].start >= 5, 'prefijo con el resto');
});

test('remanente que no entra con pie: última al máximo que cabe', () => {
  // 12 filas de 30 = 360. intermedia=200 (~6), final=100 (~3).
  const heights = Array(12).fill(30);
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 200, 100, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, 12);
  const last = pages[pages.length - 1];
  assert.ok(last.end - last.start >= 3, `última al máximo (~3), got ${last.end - last.start}`);
  assert.ok(sumRange(heights, last.start, last.end) <= 100 + 0.01);
});

test('30 filas: última al máximo del pie y cobertura completa', () => {
  const heights = Array(30).fill(20);
  const pages = pdfGenerator.paginarFilasFacturaARCA(heights, 440, 200, {
    maxRowsIntermedia: 22,
    maxRowsFinal: 16
  });
  assertCoverage(pages, 30);
  const last = pages[pages.length - 1];
  assert.ok(last.end - last.start >= 8, `última aprovechada: got ${last.end - last.start}`);
  assert.notStrictEqual(last.end - last.start, 1);
});

test('defaults de techo: intermedia 22, final 16', () => {
  assert.strictEqual(pdfGenerator.maxRowsIntermediaARCA, 22);
  assert.strictEqual(pdfGenerator.maxRowsFinalARCA, 16);
});

test('construirTableHeaderARCA y fila con UM y descuento', () => {
  const thIva = pdfGenerator.construirTableHeaderARCA({ ocultarIvaDiscriminado: false });
  assert.ok(thIva.includes('UM'));
  assert.ok(thIva.includes('% IVA'));

  const thB = pdfGenerator.construirTableHeaderARCA({ ocultarIvaDiscriminado: true });
  assert.ok(thB.includes('UM'));
  assert.ok(!thB.includes('% IVA'));

  const row = pdfGenerator.construirFilaItemARCA({
    cantidadFormateada: '2',
    nombre: 'Producto Test',
    um: 'Caja',
    precioFinal: 90,
    precioOriginal: 100,
    descuentoPorcentaje: 10,
    totalLinea: 180,
    ocultarIvaDiscriminado: false,
    porcentajeIvaTexto: '21.00'
  });
  assert.ok(row.includes('Producto Test'));
  assert.ok(row.includes('Caja'));
  assert.ok(row.includes('Desc. 10%'));
  assert.ok(!row.includes('Producto Test - Caja'));
});

console.log('\n✅ facturaArcaPaginacion.test.js OK\n');
process.exit(0);
