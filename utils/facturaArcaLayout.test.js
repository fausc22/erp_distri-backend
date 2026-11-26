/**
 * Test Puppeteer de layout multipágina ARCA: cobertura de ítems, solape y páginas.
 * Ejecutar: node utils/facturaArcaLayout.test.js
 * Opcional: SKIP_PDF_GENERATE=1 salta generación PDF + pdf-parse.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const pdfGenerator = require('./pdfGenerator');

function testAsync(name, fn) {
  return fn()
    .then(() => console.log(`  ✅ ${name}`))
    .catch((err) => {
      console.error(`  ❌ ${name}`);
      throw err;
    });
}

function buildFakeRows(n, { longName = false, prefix = 'ITEM' } = {}) {
  const nombre = longName
    ? 'PRODUCTO CON NOMBRE MUY LARGO PARA FORZAR DOS LINEAS EN LA CELDA DE DESCRIPCION DEL COMPROBANTE'
    : 'Producto corto';
  return Array.from({ length: n }, (_, i) =>
    pdfGenerator.construirFilaItemARCA({
      cantidadFormateada: String(i + 1),
      nombre: `${prefix}-${String(i + 1).padStart(3, '0')} ${nombre}`,
      um: 'Unidad',
      precioFinal: 100 + i,
      totalLinea: 100 + i,
      ocultarIvaDiscriminado: false,
      porcentajeIvaTexto: '21.00'
    })
  );
}

function buildFooterStub() {
  // Footer mínimo válido con totales + QR + CAE (mismo markup que producción).
  return pdfGenerator.construirFooterFacturaARCA({
    observacionesHTML: '<p><strong>OBSERVACIONES:</strong></p><p>Test layout</p>',
    subtotal: 1000,
    ivaTotal: 210,
    total: 1210,
    qrBase64: 'data:image/svg+xml;base64,' + Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#000"/></svg>'
    ).toString('base64'),
    logoARCABase64: pdfGenerator.obtenerLogoARCABase64(),
    cae: '71234567890123',
    fechaVencimientoCAE: '31/12/2026',
    esExento: false
  });
}

const commonReplacements = {
  tipo_comprobante: 'A',
  codigo_comprobante: '1',
  punto_venta: '0004',
  numero_comprobante: '00009999',
  fecha: '20/11/2026',
  cuit_emisor: process.env.AFIP_CUIT || '30714525030',
  ingresos_brutos: '251491/4',
  fecha_inicio_actividades: '01/02/2016',
  telefono: '2302-000000',
  email: 'test@example.com',
  cliente_cuit: '20111111112',
  cliente_nombre: 'Cliente Layout Test',
  cliente_condicion: 'Responsable Inscripto',
  cliente_direccion: 'Calle 1 N 100',
  observaciones_html: '',
  factura_asociada_tipo: 'A',
  factura_asociada_punto_venta: '0004',
  factura_asociada_numero: '00000001',
  factura_asociada_fecha: '01/11/2026',
  factura_asociada_total: '1.210,00'
};

async function assertLayoutHtml(html, pageCount, itemNames) {
  const browser = await require('puppeteer').launch(pdfGenerator.construirLaunchOptions());
  try {
    const page = await browser.newPage();
    await pdfGenerator.aplicarViewportPdf(page);
    await page.setContent(html, { waitUntil: 'load', timeout: 60000 });

    const report = await page.evaluate((expectedNames) => {
      const pages = Array.from(document.querySelectorAll('.factura-page'));
      const names = [];
      const overlaps = [];
      const footerFlags = [];
      const rowCounts = [];
      let hasCompacta = false;

      pages.forEach((pageEl, pageIndex) => {
        if (pageEl.classList.contains('densidad-compacta')) hasCompacta = true;
        const pageRect = pageEl.getBoundingClientRect();
        const footer = pageEl.querySelector('.factura-footer-wrapper');
        const footerVisible = footer && !footer.classList.contains('is-empty');
        footerFlags.push(!!footerVisible);

        const rows = Array.from(pageEl.querySelectorAll('.row-details tbody tr'));
        rowCounts.push(rows.length);
        rows.forEach((row) => {
          const nameCell = row.querySelectorAll('td')[1];
          if (nameCell) names.push(nameCell.textContent.trim());
        });

        if (rows.length > 0) {
          const lastRow = rows[rows.length - 1].getBoundingClientRect();
          if (lastRow.bottom > pageRect.bottom + 1) {
            overlaps.push({
              pageIndex,
              type: 'page',
              lastRowBottom: lastRow.bottom,
              pageBottom: pageRect.bottom
            });
          }
          if (footerVisible) {
            const footerRect = footer.getBoundingClientRect();
            if (lastRow.bottom > footerRect.top + 1) {
              overlaps.push({
                pageIndex,
                type: 'footer',
                lastRowBottom: lastRow.bottom,
                footerTop: footerRect.top
              });
            }
          }
        }
      });

      return {
        pageDomCount: pages.length,
        names,
        overlaps,
        footerFlags,
        rowCounts,
        hasCompacta,
        expectedOk: expectedNames.every((n, i) => names[i] === n) && names.length === expectedNames.length
      };
    }, itemNames);

    assert.strictEqual(report.pageDomCount, pageCount, 'DOM pages == pageCount');
    assert.deepStrictEqual(report.names, itemNames, 'ítems exactos en orden');
    assert.strictEqual(report.overlaps.length, 0, `sin solapes: ${JSON.stringify(report.overlaps)}`);

    report.footerFlags.forEach((visible, i) => {
      const shouldBeLast = i === report.footerFlags.length - 1;
      assert.strictEqual(visible, shouldBeLast, `footer visible solo en última (página ${i})`);
    });

    return report;
  } finally {
    await browser.close();
  }
}

async function run() {
  console.log('\n--- Layout ARCA (Puppeteer) ---');
  const footerContent = buildFooterStub();
  const tableHeader = pdfGenerator.construirTableHeaderARCA({ ocultarIvaDiscriminado: false });

  const facturaPath = path.join(__dirname, '../resources/documents/factura_arca.html');
  const ncPath = path.join(__dirname, '../resources/documents/nota_credito_arca.html');

  await testAsync('factura: 8 ítems — 1 hoja normal (sin compacta)', async () => {
    const names = Array.from({ length: 8 }, (_, i) => `ITEM-${String(i + 1).padStart(3, '0')} Producto corto`);
    const rowsByItem = buildFakeRows(8);
    const { html, pageCount, densidad } = await pdfGenerator.construirHtmlMultipaginaARCA({
      templatePath: facturaPath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    assert.strictEqual(pageCount, 1);
    assert.strictEqual(densidad, 'normal');
    const report = await assertLayoutHtml(html, pageCount, names);
    assert.strictEqual(report.hasCompacta, false);
  });

  await testAsync('factura: 12 ítems — 1 hoja compacta (evita huérfana)', async () => {
    const names = Array.from({ length: 12 }, (_, i) => `ITEM-${String(i + 1).padStart(3, '0')} Producto corto`);
    const rowsByItem = buildFakeRows(12);
    const { html, pageCount, densidad } = await pdfGenerator.construirHtmlMultipaginaARCA({
      templatePath: facturaPath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    assert.strictEqual(pageCount, 1, '12 ítems deben caber en 1 hoja compacta');
    assert.strictEqual(densidad, 'compacta');
    const report = await assertLayoutHtml(html, pageCount, names);
    assert.strictEqual(report.hasCompacta, true);
  });

  await testAsync('factura: 30 ítems — varias hojas, ninguna con 1 solo ítem', async () => {
    const names = Array.from({ length: 30 }, (_, i) => `ITEM-${String(i + 1).padStart(3, '0')} Producto corto`);
    const rowsByItem = buildFakeRows(30);
    const { html, pageCount, densidad } = await pdfGenerator.construirHtmlMultipaginaARCA({
      templatePath: facturaPath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    assert.ok(pageCount >= 2, '30 ítems abren más de 1 página');
    assert.ok(pageCount <= 3, `30 ítems en ≤3 páginas, got ${pageCount}`);
    assert.strictEqual(densidad, 'normal', 'varias hojas quedan en normal (más legible)');
    const report = await assertLayoutHtml(html, pageCount, names);
    report.rowCounts.forEach((count, i) => {
      assert.ok(count !== 1, `página ${i} no debe tener un solo ítem (got ${count})`);
      assert.ok(count > 0, `página ${i} no vacía`);
    });
  });

  await testAsync('nota crédito: 20 ítems — footer solo última, sin hoja de 1', async () => {
    const names = Array.from({ length: 20 }, (_, i) => `NC-${String(i + 1).padStart(3, '0')} Producto corto`);
    const rowsByItem = buildFakeRows(20, { prefix: 'NC' });
    const { html, pageCount } = await pdfGenerator.construirHtmlMultipaginaARCA({
      templatePath: ncPath,
      commonReplacements,
      rowsByItem,
      footerContent,
      tableHeader
    });
    const report = await assertLayoutHtml(html, pageCount, names);
    if (pageCount > 1) {
      report.rowCounts.forEach((count, i) => {
        assert.ok(count !== 1, `NC página ${i} no huérfana (got ${count})`);
      });
    }
  });

  if (process.env.SKIP_PDF_GENERATE === '1') {
    console.log('  ⏭️  SKIP_PDF_GENERATE=1 — omitiendo PDF + pdf-parse');
  } else {
    await testAsync('PDF factura 30 ítems: numpages y textos', async () => {
      const names = Array.from({ length: 30 }, (_, i) => `ITEM-${String(i + 1).padStart(3, '0')} Producto corto`);
      const rowsByItem = buildFakeRows(30);
      const { html, pageCount } = await pdfGenerator.construirHtmlMultipaginaARCA({
        templatePath: facturaPath,
        commonReplacements,
        rowsByItem,
        footerContent,
        tableHeader
      });
      const buffer = await pdfGenerator.generatePdfFromHtml(html);
      const parsed = await require('pdf-parse')(buffer);
      assert.strictEqual(parsed.numpages, pageCount, 'pdf-parse numpages == pageCount');
      for (const name of names) {
        assert.ok(parsed.text.includes(name.split(' ')[0]), `PDF contiene ${name.split(' ')[0]}`);
      }
      for (let i = 1; i <= pageCount; i++) {
        assert.ok(
          parsed.text.includes(`Página ${i}/${pageCount}`) || parsed.text.includes(`Pagina ${i}/${pageCount}`),
          `PDF contiene Página ${i}/${pageCount}`
        );
      }
      const outDir = path.resolve(__dirname, '../../output/pdf');
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(path.join(outDir, 'test-factura-arca-30.pdf'), buffer);
    });
  }

  console.log('\n✅ facturaArcaLayout.test.js OK\n');
}

run()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
