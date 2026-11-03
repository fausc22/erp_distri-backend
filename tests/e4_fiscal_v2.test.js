const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { lineaNeta } = require('../dominio/calculo/decimal');
const fiscalV2 = require('../services/fiscalV2');
const sombra = require('../dominio/calculo/sombra');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  assert.strictEqual(lineaNeta(2500000n, 3000n), 750n);
  assert.strictEqual(lineaNeta(1333333n, 1500n), 200n);

  assert.ok(typeof fiscalV2.isFiscalV2Enabled === 'function');
  assert.ok(typeof fiscalV2.reservarNumeroYPersistirIntento === 'function');
  assert.ok(typeof fiscalV2.registrarRespuestaTardia === 'function');
  assert.ok(typeof fiscalV2.insertarAutorizacionCanonica === 'function');

  const hash = fiscalV2.hashEvidencia({
    cbteTipo: 1,
    ptoVta: 4,
    cbteNro: 10,
    cae: '123',
    impTotal: '100.00',
    emisor: '20111111112',
    entorno: 'homologacion'
  });
  assert.ok(/^[a-f0-9]{64}$/.test(hash));

  const arcaCtrl = read('controllers/arcaIntegrationController.js');
  assert.ok(arcaCtrl.includes('recuperarCAE'));
  assert.ok(arcaCtrl.includes('registrarRespuestaTardia'));
  assert.ok(arcaCtrl.includes('isFiscalV2Enabled'));

  const arcaRoutes = read('routes/arcaRoutes.js');
  assert.ok(arcaRoutes.includes("/recuperar-cae"));
  assert.ok(arcaRoutes.includes('requireManager'));

  assert.strictEqual(sombra.motorMode(), 'legacy');
  process.env.MOTOR_CALCULO_VERSION = 'sombra';
  assert.strictEqual(sombra.motorMode(), 'sombra');
  delete process.env.MOTOR_CALCULO_VERSION;

  console.log('✅ e4_fiscal_v2.test.js OK');
}

run().catch((err) => {
  console.error('❌ e4_fiscal_v2.test.js FAIL', err);
  process.exit(1);
});
