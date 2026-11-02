const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createController } = require('../reportes/controller');
const { createSnapshotStore } = require('../reportes/snapshots');
const { buildReport } = require('../reportes/buildReport');
const { period } = require('../reportes/period');
const { fixture } = require('./fixtures/reportesV2');
const { requireManager } = require('../middlewares/authMiddleware');
test('HTTP: acceso de gerente, propietario de PDF, expiración, filtros y contenido', async () => {
  const oldSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'reportes-test-only-not-a-production-secret';
  const store = createSnapshotStore();
  const report = store.put(
    1,
    buildReport(fixture(), period({ desde: '2026-11-01', hasta: '2026-11-30' }))
  );
  const controller = createController({
    store,
    getConnection: () => {
      throw new Error('No debe conectar con filtros inválidos');
    },
    renderPDF: async (data) =>
      Buffer.from(`%PDF-1.4 prueba ${data.resumen.total}`),
  });
  const app = express();
  app.get('/reportes', requireManager, controller.get);
  app.get('/reportes/:snapshotId/pdf', requireManager, controller.pdf);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const auth = (id, rol = 'GERENTE') => ({
    Authorization: `Bearer ${jwt.sign({ id, rol, usuario: 'prueba' }, process.env.JWT_SECRET)}`,
  });
  try {
    assert.equal((await fetch(`${base}/reportes`)).status, 401);
    assert.equal(
      (await fetch(`${base}/reportes`, { headers: auth(1, 'VENDEDOR') }))
        .status,
      403
    );
    assert.equal(
      (
        await fetch(`${base}/reportes?desde=2026-02-30&hasta=2026-03-01`, {
          headers: auth(1),
        })
      ).status,
      400
    );
    const valid = await fetch(`${base}/reportes/${report.snapshot_id}/pdf`, {
      headers: auth(1),
    });
    assert.equal(valid.status, 200);
    assert.match(valid.headers.get('cache-control'), /no-store/);
    assert.match(await valid.text(), /363.00/);
    assert.equal(
      (
        await fetch(`${base}/reportes/${report.snapshot_id}/pdf`, {
          headers: auth(2),
        })
      ).status,
      410
    );
    assert.equal(
      (await fetch(`${base}/reportes/expired/pdf`, { headers: auth(1) }))
        .status,
      410
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (oldSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = oldSecret;
  }
});
