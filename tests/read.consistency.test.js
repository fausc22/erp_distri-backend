const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  const pedidosRepo = read('repositories/pedidosRepository.js');
  const ventasRepo = read('repositories/ventasRepository.js');
  const reportesRepo = read('repositories/reportesRepository.js');
  const finanzasSvc = read('services/finanzasService.js');

  assert.ok(pedidosRepo.includes('ORDER BY fecha DESC, id DESC'));
  assert.ok(ventasRepo.includes('ORDER BY fecha DESC, id DESC'));

  // Orden estable para listados financieros críticos
  assert.ok(finanzasSvc.includes('ORDER BY fecha DESC, id DESC LIMIT ?'));
  assert.ok(finanzasSvc.includes('ORDER BY fecha DESC, referencia DESC LIMIT ?'));

  // Reportes con orden explícito determinístico
  assert.ok(reportesRepo.includes('ORDER BY monto_total DESC, cliente_nombre ASC'));
  assert.ok(reportesRepo.includes('ORDER BY mf.fecha DESC, mf.id DESC'));

  console.log('✅ read.consistency.test.js OK');
}

run().catch((error) => {
  console.error('❌ read.consistency.test.js FAIL', error);
  process.exit(1);
});
