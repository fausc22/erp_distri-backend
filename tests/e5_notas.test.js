const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');

function read(rel) {
  const fullPath = path.join(root, rel);
  assert.ok(fs.existsSync(fullPath), `${rel} debe existir`);
  return fs.readFileSync(fullPath, 'utf8');
}

function includesAll(rel, expected) {
  const content = read(rel);
  for (const text of expected) {
    assert.ok(content.includes(text), `${rel} debe contener ${text}`);
  }
}

async function run() {
  includesAll('services/notasService.js', [
    'DOCUMENTO_MIXTO_NO_PERMITIDO',
    'DEVOLUCION',
    'AJUSTE_PRECIO',
    'operacion_id',
    'FOR UPDATE',
    'vendedor_atribuible_origen',
  ]);

  includesAll('services/ventasService.js', [
    'DOCUMENTO_MIXTO_NO_PERMITIDO',
    'operacion_id',
    'es_flete',
  ]);

  includesAll('middlewares/clientVersionMiddleware.js', [
    'CLIENT_UPDATE_REQUIRED',
    'X-App-Version',
    'MIN_CLIENT_VERSION_UUID_REQUIRED',
  ]);

  includesAll('routes/notasRoutes.js', ['requireClientVersionWhenUuidRequired']);
  includesAll('routes/ventasRoutes.js', ['requireClientVersionWhenUuidRequired']);
  includesAll('migrations/M014_productos_es_flete.sql', ['es_servicio_flete']);
  includesAll('migrations/M015_ventas_cont_es_flete.sql', ['es_flete']);

  console.log('✅ e5_notas.test.js OK');
}

run().catch((error) => {
  console.error('❌ e5_notas.test.js FAIL', error);
  process.exit(1);
});
