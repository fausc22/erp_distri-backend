/**
 * Tests de contención E1 (source-guards + comportamiento unitario).
 * No conecta a producción. No emite comprobantes.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

async function run() {
  const ventasRoutes = read('routes/ventasRoutes.js');
  const arcaRoutes = read('routes/arcaRoutes.js');
  const ventasSvc = read('services/ventasService.js');
  const arcaCtrl = read('controllers/arcaIntegrationController.js');
  const appInit = read('../frontend/components/AppInitializer.jsx');
  const inicio = read('../frontend/pages/inicio.jsx');
  const offlineHook = read('../frontend/hooks/useOfflineCatalog.js');
  const m001 = read('migrations/M001_schema_migrations.sql');
  const m002 = read('migrations/M002_arca_log_fk_restrict.sql');

  // Auth + flag en duplicar-venta
  assert.ok(ventasRoutes.includes("router.post('/duplicar-venta/:id'"));
  const dupBlock = ventasRoutes.slice(
    ventasRoutes.indexOf("router.post('/duplicar-venta/:id'"),
    ventasRoutes.indexOf("router.post('/duplicar-venta/:id'") + 350
  );
  assert.ok(dupBlock.includes('requireManager'), 'duplicar-venta debe exigir requireManager');
  assert.ok(ventasSvc.includes('DUPLICAR_VENTA_HABILITADO'));
  assert.ok(ventasSvc.includes('FUNCIONALIDAD_DESHABILITADA'));
  assert.ok(ventasSvc.includes('status(503)'));

  // Rutas ARCA sin lock protegidas por gerente
  for (const route of [
    '/facturas/consumidor-final',
    '/facturas/responsable-inscripto',
    '/notas-credito/tipo-a',
    '/notas-credito/tipo-b',
    '/notas-credito',
    '/notas-debito/tipo-a',
    '/notas-debito/tipo-b',
    '/notas-debito'
  ]) {
    const idx = arcaRoutes.indexOf(`'${route}'`);
    assert.ok(idx > 0, `ruta ${route} presente`);
    const snippet = arcaRoutes.slice(idx, idx + 180);
    assert.ok(snippet.includes('requireManager'), `${route} debe usar requireManager`);
  }

  // Pedido anulado
  assert.ok(ventasSvc.includes("PEDIDO_ANULADO"));
  assert.ok(/anulado/i.test(ventasSvc));

  // Checks de duplicado antes de descontar stock en facturarPedido
  const facturarStart = ventasSvc.indexOf('const facturarPedido = async');
  const facturarEnd = ventasSvc.indexOf('const queryPromiseWithConnection', facturarStart);
  const facturarBody = ventasSvc.slice(facturarStart, facturarEnd);
  const idxHash = facturarBody.indexOf('verificarVentaExistentePorHash');
  const idxPedido = facturarBody.indexOf('verificarVentaExistentePorPedido');
  const idxStockUpdate = facturarBody.indexOf('UPDATE productos SET stock_actual = stock_actual -');
  assert.ok(idxHash > 0 && idxPedido > 0 && idxStockUpdate > 0);
  assert.ok(idxHash < idxStockUpdate, 'hash check debe preceder al descuento de stock');
  assert.ok(idxPedido < idxStockUpdate, 'pedido check debe preceder al descuento de stock');

  // stockAntes capturado antes del descuento en venta directa
  const vdStart = ventasSvc.indexOf('stockAntesPorProducto');
  assert.ok(vdStart > 0, 'ventaDirecta debe capturar stockAntesPorProducto');
  assert.ok(ventasSvc.includes('stockAntesPorProducto.set'));

  // EN_PROCESO → IN_PROGRESS / RECOVERY_REQUIRED
  assert.ok(arcaCtrl.includes("error: 'IN_PROGRESS'"));
  assert.ok(arcaCtrl.includes("error: 'RECOVERY_REQUIRED'"));
  assert.ok(arcaCtrl.includes("estado = 'DESCONOCIDO'"));
  assert.ok(arcaCtrl.includes('requiere_recuperacion'));

  // Offline: auto-sync solo en AppInitializer
  assert.ok(appInit.includes('enableAutoSync: true'));
  assert.ok(inicio.includes('enableAutoSync: false'));
  assert.ok(offlineHook.includes('enableAutoSync = true'));

  // Migraciones E1 presentes
  assert.ok(m001.includes('schema_migrations'));
  assert.ok(m002.includes('ON DELETE RESTRICT'));
  assert.ok(m002.includes('FK_arca_log_venta_restrict'));

  console.log('✅ e1_contencion.test.js OK');
}

run().catch((error) => {
  console.error('❌ e1_contencion.test.js FAIL', error);
  process.exit(1);
});
