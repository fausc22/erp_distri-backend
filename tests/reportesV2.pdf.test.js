const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
const { renderPDF } = require('../reportes/pdf');
const { createSnapshotStore } = require('../reportes/snapshots');
const { fixture, document, line } = require('./fixtures/reportesV2');
test(
  'PDF real: cifras de snapshot, vacío, negativos, textos extensos y paginación',
  { skip: process.env.REPORTES_PDF_TEST !== '1', timeout: 60000 },
  async () => {
    const parse = require('pdf-parse');
    const p = period({ desde: '2026-11-01', hasta: '2026-11-30' });
    const empty = {
      documents: [],
      lines: [],
      purchases: [],
      expenses: [],
      movements: [],
    };
    const stress = fixture();
    stress.documents = Array.from({ length: 65 }, (_, i) =>
      document(i + 1, {
        empleado_id: i + 1,
        empleado_nombre: `Vendedor ${i} de prueba con nombre largo`,
        cliente_ciudad: `Ciudad de prueba ${i}`,
        tipo_doc: i === 0 ? 'NOTA_CREDITO' : 'FACTURA',
        lineas: 1,
      })
    );
    stress.lines = stress.documents.map((r) =>
      line(r.id, {
        producto_id: r.id,
        producto_nombre:
          'Producto con una descripción extensa para probar el ajuste de líneas sin perder importes ni superponer columnas',
      })
    );
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-reportes-pdf-'));
    for (const [name, raw] of [
      ['normal', fixture()],
      ['empty', empty],
      ['stress', stress],
    ]) {
      const d = createSnapshotStore().put(
        1,
        buildReport(raw, p, '2026-12-01T12:00:00Z')
      );
      const buffer = await renderPDF(d);
      fs.writeFileSync(path.join(dir, `${name}.pdf`), buffer);
      assert.equal(buffer.subarray(0, 5).toString(), '%PDF-');
      const parsed = await parse(buffer);
      assert.ok(parsed.text.includes('VERTIMAR'));
      assert.ok(!parsed.text.includes('Reglas y trazabilidad'));
      assert.ok(!parsed.text.includes('Excepciones de integridad'));
      assert.ok(!parsed.text.includes('Pendiente de clasificación'));
      if (name === 'normal') {
        assert.match(parsed.text, /363,00/);
        assert.match(parsed.text, /242,00/);
      }
      if (name === 'empty') assert.match(parsed.text, /Sin operaciones/);
      if (name === 'stress') {
        assert.ok(parsed.numpages >= 2);
        assert.match(parsed.text, /-121,00/);
        assert.match(parsed.text, /Vendedor 64/);
      }
    }
    console.log('PDFs de validación:', dir);
  }
);
