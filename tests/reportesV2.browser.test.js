// Prueba de interfaz contra Next local. Toda solicitud ajena al frontend se intercepta.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
const { fixture } = require('./fixtures/reportesV2');
const { createSnapshotStore } = require('../reportes/snapshots');
const enabled = process.env.REPORTES_UI_URL;
test(
  'UI: siete pestañas, detalle, actualización real, error, PDF vencido y móvil',
  { skip: !enabled, timeout: 90000 },
  async () => {
    const base = new URL(enabled);
    assert.ok(['127.0.0.1', 'localhost'].includes(base.hostname));
    const browser = await puppeteer.launch({
      headless: true,
      executablePath:
        process.env.PUPPETEER_EXECUTABLE_PATH ||
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      args: ['--no-sandbox'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 1000 });
      let reads = 0,
        pdfReads = 0,
        fail = false;
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.evaluateOnNewDocument(() => {
        localStorage.setItem('token', 'local-test-only');
        localStorage.setItem('tokenExpiry', String(Date.now() + 3600000));
        localStorage.setItem(
          'empleado',
          JSON.stringify({
            id: 1,
            rol: 'GERENTE',
            usuario: 'prueba',
            nombre: 'Gerente de prueba',
          })
        );
        localStorage.setItem('role', 'GERENTE');
      });
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = new URL(req.url());
        if (url.origin === base.origin) return req.continue();
        const headers = {
          'access-control-allow-origin': base.origin,
          'access-control-allow-headers': '*',
          'access-control-allow-methods': 'GET,POST,OPTIONS',
        };
        if (req.method() === 'OPTIONS')
          return req.respond({ status: 204, headers });
        if (url.pathname === '/finanzas/reportes-v2') {
          reads++;
          const report = createSnapshotStore().put(
            1,
            buildReport(
              {
                ...fixture(),
                documents: fixture().documents.map((r) => ({
                  ...r,
                  fecha_fiscal: url.searchParams.get('desde'),
                  fecha_comercial: url.searchParams.get('desde'),
                })),
              },
              period({
                desde: url.searchParams.get('desde'),
                hasta: url.searchParams.get('hasta'),
              })
            )
          );
          return req.respond({
            status: fail ? 500 : 200,
            contentType: 'application/json',
            headers,
            body: JSON.stringify(
              fail
                ? { success: false, message: 'Fallo de prueba' }
                : { success: true, data: report }
            ),
          });
        }
        if (
          url.pathname.includes('/reportes-v2/') &&
          url.pathname.endsWith('/pdf')
        ) {
          pdfReads++;
          return req.respond({
            status: 410,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({ message: 'Versión vencida' }),
          });
        }
        if (['127.0.0.1', 'localhost'].includes(url.hostname))
          return req.respond({
            status: 200,
            headers,
            contentType: 'application/json',
            body: JSON.stringify({
              success: true,
              ok: true,
              empleado: { id: 1, rol: 'GERENTE', usuario: 'prueba' },
              data: [],
            }),
          });
        return req.abort();
      });
      await page.goto(enabled + '/finanzas/reportes', {
        waitUntil: 'networkidle0',
      });
      await page.waitForFunction(() =>
        document.body.innerText.includes(
          'Facturación conciliada aritméticamente'
        )
      );
      const click = async (label) => {
        await page.evaluate((label) => {
          const b = [...document.querySelectorAll('button')].find(
            (b) => b.textContent.trim() === label
          );
          if (!b) throw Error('Botón no encontrado: ' + label);
          b.click();
        }, label);
      };
      assert.ok(
        (await page.$eval('body', (el) => el.innerText)).includes('$ 363,00')
      );
      const baseline = reads;
      await page.evaluate(() =>
        [...document.querySelectorAll('button')]
          .find(
            (b) =>
              b.textContent.includes('Documentos con flete') &&
              b.textContent.includes('Ver comprobantes')
          )
          .click()
      );
      await page.waitForFunction(() =>
        document.body.innerText.includes('Comprobante')
      );
      assert.ok(
        (await page.$eval('body', (el) => el.innerText)).includes('PRUEBA-2')
      );
      await click('Cerrar detalle');
      for (const label of [
        'Análisis de Ventas',
        'Facturación y egresos',
        'Movimientos de fondos',
        'Análisis de Productos',
        'Consulta comercial',
        'Análisis Geográfico',
        'Reporte Gerencial',
      ])
        await click(label);
      assert.equal(
        reads,
        baseline,
        'Cambiar de pestaña conserva la misma versión'
      );
      await click('Actualizar lectura');
      await page.waitForFunction(
        () => !document.body.innerText.includes('Cargando...')
      );
      await page.waitForNetworkIdle();
      assert.equal(reads, baseline + 1);
      await click('Descargar PDF gerencial');
      await page.waitForFunction(() =>
        document.body.innerText.includes('La versión anterior venció')
      );
      assert.equal(pdfReads, 1);
      assert.equal(reads, baseline + 2);
      fail = true;
      await click('Actualizar lectura');
      await page.waitForFunction(() =>
        document.body.innerText.includes('Se conserva la lectura anterior')
      );
      assert.equal(
        await page.evaluate(
          () =>
            [...document.querySelectorAll('button')].find((b) =>
              b.textContent.includes('Descargar PDF gerencial')
            ).disabled
        ),
        true
      );
      fail = false;
      await click('Actualizar lectura');
      await page.waitForNetworkIdle();
      await page.screenshot({
        path: '/tmp/erp-reportes-desktop.png',
        fullPage: true,
      });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({
        path: '/tmp/erp-reportes-mobile.png',
        fullPage: true,
      });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      assert.equal(
        overflow,
        false,
        'No debe desbordar horizontalmente en móvil'
      );
      assert.deepEqual(errors, []);
    } finally {
      await browser.close();
    }
  }
);
